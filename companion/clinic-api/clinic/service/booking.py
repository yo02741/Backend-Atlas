"""用例：查診次、掛號、讀取、列表、取消、報到。

這一層決定規則的順序、授權與交易邊界；不知道 HTTP，也不寫 SQL。
"""

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import date, datetime
from typing import Any

from clinic.domain.errors import (
    AlreadyBooked,
    CancelDeadlinePassed,
    DailyLimitExceeded,
    IdempotencyKeyReused,
    InvalidStatus,
    NotFound,
    PermissionDenied,
    SessionFull,
)
from clinic.domain.models import Appointment, BoardRow, Principal, Session
from clinic.domain.policy import can
from clinic.domain.rules import DAILY_LIMIT, TPE, can_cancel, current_period, session_start
from clinic.repository.clinic_repo import ClinicRepository
from clinic.repository.session_cache import SessionListCache


@dataclass(frozen=True)
class _BookingTarget:
    patient_id: int


@dataclass(frozen=True)
class Idempotency:
    """掛號請求帶的 Idempotency-Key 與請求內容的指紋（同一個鍵、不同內容要擋）。"""

    key: str
    fingerprint: str


@dataclass(frozen=True)
class BookingResult:
    """body 是要回給客戶端的內容；replayed 代表這是同一個冪等鍵第一次處理時存下的結果。"""

    body: dict[str, Any]
    replayed: bool = False


class BookingService:
    def __init__(self, repo: ClinicRepository, cache: SessionListCache) -> None:
        self.repo = repo
        self.cache = cache

    @contextmanager
    def _transaction(self) -> Iterator[None]:
        """一個用例一個交易：全部成功才 commit，任何例外都 rollback（扣掉的名額也一起還回去）。"""
        try:
            yield
            self.repo.commit()
        except BaseException:
            self.repo.rollback()
            raise

    # ---- 診次清單：cache-aside ----
    def list_sessions(self, doctor_id: int | None, day: date | None) -> list[Session]:
        cached = self.cache.get(doctor_id, day)
        if cached is not None:
            return cached
        sessions = self.repo.list_sessions(doctor_id, day)
        self.cache.set(doctor_id, day, sessions)
        return sessions

    # ---- 報到看板 ----
    def board(self, now: datetime) -> list[BoardRow]:
        """今天（台北時間）目前這個時段的每個診間。不經過快取：看板自己每 10 秒輪詢。"""
        return self.repo.board(now.astimezone(TPE).date(), current_period(now))

    # ---- 掛號 ----
    def book(
        self,
        user: Principal,
        session_id: int,
        patient_id: int | None,
        render: Callable[[Appointment], dict[str, Any]] = asdict,
        idempotency: Idempotency | None = None,
    ) -> BookingResult:
        """render 把掛號轉成回應的 body（要能存成 JSON）；帶了冪等鍵時，這份 body 和掛號寫在同一個交易裡。"""
        if patient_id is None:
            patient_id = user.patient_id  # 病患替自己掛：身分來自憑證
        if patient_id is None or not can(user, "book", _BookingTarget(patient_id)):
            raise PermissionDenied("這個角色不能替這位病患掛號")

        with self._transaction():
            if idempotency is not None:
                if not self.repo.claim_idempotency_key(user.id, idempotency.key, idempotency.fingerprint):
                    stored = self.repo.find_idempotency_key(user.id, idempotency.key)
                    assert stored is not None and stored.response is not None  # 登記與結果在同一個交易 COMMIT
                    if stored.fingerprint != idempotency.fingerprint:
                        raise IdempotencyKeyReused("這個 Idempotency-Key 已經用在內容不同的請求")
                    return BookingResult(stored.response, replayed=True)
            session = self.repo.find_session(session_id)
            if session is None:
                raise NotFound(f"診次 {session_id} 不存在")
            if not self.repo.lock_patient(patient_id):  # 之後同一位病患的掛號在這裡排隊
                raise NotFound(f"病患 {patient_id} 不存在")
            # 順序是規格：重複 → 名額 → 每日上限
            if self.repo.has_active_appointment(session_id, patient_id):
                raise AlreadyBooked(f"病患 {patient_id} 已掛診次 {session_id}")
            number = self.repo.take_number(session_id)  # 原子的 UPDATE；之後失敗會隨交易 rollback
            if number is None:
                raise SessionFull(f"診次 {session_id} 名額已滿")
            if self.repo.count_active_on_date(patient_id, session.session_date) >= DAILY_LIMIT:
                raise DailyLimitExceeded(f"病患 {patient_id} 在 {session.session_date} 已掛 {DAILY_LIMIT} 診")
            appointment_id = self.repo.insert_appointment(session_id, patient_id, number)
            appointment = self.repo.find_appointment(appointment_id)
            assert appointment is not None
            body = render(appointment)
            if idempotency is not None:
                self.repo.save_idempotent_response(user.id, idempotency.key, 201, body)
        self.cache.invalidate(session.doctor_id, session.session_date)  # COMMIT 之後才失效
        return BookingResult(body)

    # ---- 讀取 ----
    def _visible(self, user: Principal, appointment_id: int) -> Appointment:
        appointment = self.repo.find_appointment(appointment_id)
        if appointment is None:
            raise NotFound("掛號不存在")
        if not can(user, "read", appointment):
            # 看不到就當作不存在：回應和上面一樣，不洩漏 id 是否存在；日誌另記原因
            raise NotFound("掛號不存在", reason="not-visible")
        return appointment

    def get(self, user: Principal, appointment_id: int) -> Appointment:
        return self._visible(user, appointment_id)

    def list_visible(
        self, user: Principal, patient_id: int | None, after_id: int, limit: int, status: str | None = None
    ) -> tuple[list[Appointment], int | None]:
        """權限推進查詢：依角色決定 WHERE 條件，不是查出來再過濾。回傳 (這一頁, 下一頁的 cursor)。"""
        doctor_id: int | None = None
        if user.role == "patient" and user.patient_id is not None:
            if patient_id not in (None, user.patient_id):
                return [], None
            patient_id = user.patient_id
        elif user.role == "doctor" and user.doctor_id is not None:
            doctor_id = user.doctor_id
        elif user.role != "desk":
            return [], None  # 未知角色、缺欄位：不查
        rows = self.repo.list_appointments(
            patient_id=patient_id, doctor_id=doctor_id, status=status, after_id=after_id, limit=limit + 1
        )
        page = rows[:limit]
        return page, (page[-1].id if len(rows) > limit else None)

    # ---- 狀態轉換 ----
    def cancel(self, user: Principal, appointment_id: int, now: datetime) -> Appointment:
        with self._transaction():
            appointment = self._visible(user, appointment_id)
            if not can(user, "cancel", appointment):
                raise PermissionDenied("這個角色不能取消掛號")
            assert appointment.session_date is not None and appointment.period is not None
            if not can_cancel(session_start(appointment.session_date, appointment.period), now):
                raise CancelDeadlinePassed("已過取消期限（看診前一日 17:00）")
            if not self.repo.cancel_appointment(appointment_id):
                raise InvalidStatus("只有 booked 狀態的掛號可以取消")
            appointment.status = "cancelled"
        assert appointment.doctor_id is not None
        self.cache.invalidate(appointment.doctor_id, appointment.session_date)
        return appointment

    def check_in(self, user: Principal, appointment_id: int) -> Appointment:
        with self._transaction():
            appointment = self._visible(user, appointment_id)
            if not can(user, "check_in", appointment):
                raise PermissionDenied("只有櫃台可以報到")
            if not self.repo.check_in_appointment(appointment_id):
                raise InvalidStatus("只有 booked 狀態的掛號可以報到")
            appointment.status = "checked_in"
        return appointment

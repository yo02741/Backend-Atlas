"""資料存取：這裡知道 SQL 與資料表，不知道業務規則與 HTTP。

方法以用例命名，回傳領域物件（不讓 ORM 物件穿過邊界）；不在這裡 commit——
交易邊界由 service 決定，呼叫 commit() / rollback()。
"""

from dataclasses import dataclass
from datetime import date

from sqlalchemy import ColumnElement, Select, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from clinic.domain.errors import AlreadyBooked
from clinic.domain.models import Appointment, Session
from clinic.repository.tables import AppointmentRow, PatientRow, SessionRow, UserRow

A, S = AppointmentRow, SessionRow


@dataclass(frozen=True)
class UserRecord:
    id: int
    username: str
    password_hash: str
    role: str
    patient_id: int | None
    doctor_id: int | None
    is_active: bool


def _session(row: SessionRow) -> Session:
    return Session(row.id, row.doctor_id, row.session_date, row.capacity, row.period, row.booked)


def _appointment_query() -> Select:
    return select(A, S.doctor_id, S.session_date, S.period).join(S, S.id == A.session_id)


def _appointment(row: AppointmentRow, doctor_id: int, session_date: date, period: str) -> Appointment:
    return Appointment(
        id=row.id, session_id=row.session_id, patient_id=row.patient_id, number=row.number,
        status=row.status, doctor_id=doctor_id, session_date=session_date, period=period,
        created_at=row.created_at,
    )  # fmt: skip


class ClinicRepository:
    def __init__(self, db: DbSession) -> None:
        self.db = db

    def commit(self) -> None:
        self.db.commit()

    def rollback(self) -> None:
        self.db.rollback()

    # ---- 使用者 ----
    def _user(self, condition: ColumnElement[bool]) -> UserRecord | None:
        u = self.db.scalars(select(UserRow).where(condition)).one_or_none()
        if u is None:
            return None
        return UserRecord(u.id, u.username, u.password_hash, u.role, u.patient_id, u.doctor_id, u.is_active)

    def find_user_by_username(self, username: str) -> UserRecord | None:
        return self._user(UserRow.username == username)

    def find_user(self, user_id: int) -> UserRecord | None:
        return self._user(UserRow.id == user_id)

    # ---- 診次 ----
    def list_sessions(self, doctor_id: int, day: date) -> list[Session]:
        stmt = select(S).where(S.doctor_id == doctor_id, S.session_date == day).order_by(S.id)
        return [_session(r) for r in self.db.scalars(stmt)]

    def find_session(self, session_id: int) -> Session | None:
        row = self.db.get(S, session_id)
        return _session(row) if row else None

    # ---- 掛號（寫入）----
    def lock_patient(self, patient_id: int) -> bool:
        """鎖住病患那一列：同一位病患的掛號交易會排隊，每日上限才數得準（擋 write skew）。"""
        stmt = select(PatientRow.id).where(PatientRow.id == patient_id).with_for_update()
        return self.db.scalar(stmt) is not None

    def has_active_appointment(self, session_id: int, patient_id: int) -> bool:
        stmt = select(A.id).where(A.session_id == session_id, A.patient_id == patient_id, A.status != "cancelled")
        return self.db.scalar(stmt) is not None

    def take_number(self, session_id: int) -> int | None:
        """名額檢查、扣名額、取號在同一句 UPDATE 完成；名額已滿（或診次不存在）回 None。

        UPDATE sessions SET booked = booked + 1, next_no = next_no + 1
        WHERE id = :id AND booked < capacity RETURNING next_no - 1
        並行時第二個交易會等第一個放鎖，再用最新的 booked 重新檢查 WHERE。
        """
        stmt = (
            update(S)
            .where(S.id == session_id, S.booked < S.capacity)
            .values(booked=S.booked + 1, next_no=S.next_no + 1)
            .returning(S.next_no - 1)  # RETURNING 看到的是更新後的值
        )
        return self.db.scalar(stmt)

    def count_active_on_date(self, patient_id: int, day: date) -> int:
        stmt = (
            select(func.count())
            .select_from(A)
            .join(S, S.id == A.session_id)
            .where(A.patient_id == patient_id, A.status != "cancelled", S.session_date == day)
        )
        return self.db.scalar(stmt) or 0

    def insert_appointment(self, session_id: int, patient_id: int, number: int) -> int:
        row = AppointmentRow(session_id=session_id, patient_id=patient_id, number=number)
        self.db.add(row)
        try:
            self.db.flush()  # status、created_at 用資料庫的預設值
        except IntegrityError as exc:
            # 依約束名稱轉換，不只看 23505：號碼重複代表程式有 bug，應該是 500 而不是 409
            diag = getattr(exc.orig, "diag", None)  # psycopg 的錯誤診斷資訊
            if getattr(diag, "constraint_name", None) == "one_active_per_patient":
                raise AlreadyBooked(f"病患 {patient_id} 已掛診次 {session_id}") from exc
            raise
        return row.id

    def cancel_appointment(self, appointment_id: int) -> bool:
        """狀態條件寫在 WHERE：同時取消兩次只有一次更新到列，booked 只減一次。"""
        stmt = (
            update(A).where(A.id == appointment_id, A.status == "booked")
            .values(status="cancelled").returning(A.session_id)
        )  # fmt: skip
        session_id = self.db.scalar(stmt)
        if session_id is None:
            return False
        self.db.execute(update(S).where(S.id == session_id).values(booked=S.booked - 1))
        return True

    def check_in_appointment(self, appointment_id: int) -> bool:
        stmt = (
            update(A).where(A.id == appointment_id, A.status == "booked")
            .values(status="checked_in").returning(A.id)
        )  # fmt: skip
        return self.db.scalar(stmt) is not None

    # ---- 掛號（讀取）----
    def find_appointment(self, appointment_id: int) -> Appointment | None:
        row = self.db.execute(_appointment_query().where(A.id == appointment_id)).one_or_none()
        return _appointment(*row) if row else None

    def list_appointments(
        self, *, patient_id: int | None, doctor_id: int | None, after_id: int, limit: int
    ) -> list[Appointment]:
        """權限範圍是 WHERE 條件，由資料庫過濾；值一律走參數。cursor 分頁：id > after_id。"""
        stmt = _appointment_query().where(A.id > after_id).order_by(A.id).limit(limit)
        if patient_id is not None:
            stmt = stmt.where(A.patient_id == patient_id)
        if doctor_id is not None:
            stmt = stmt.where(S.doctor_id == doctor_id)
        return [_appointment(*row) for row in self.db.execute(stmt)]

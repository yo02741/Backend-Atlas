"""階段 2：掛號規則的單元測試。不需要資料庫，時間一律從參數給。"""

from datetime import UTC, date, datetime

import pytest

from clinic.domain.errors import AlreadyBooked, BookingError, DailyLimitExceeded, SessionFull
from clinic.domain.models import Appointment, Principal, Session
from clinic.domain.policy import can
from clinic.domain.rules import TPE, book, can_cancel, cancel_deadline, session_start

APPT = datetime(2026, 11, 3, 9, 0, tzinfo=TPE)
DAY = date(2026, 11, 2)


@pytest.mark.parametrize(
    ("now", "expected"),
    [
        (datetime(2026, 11, 2, 16, 59, 59, tzinfo=TPE), True),
        (datetime(2026, 11, 2, 17, 0, 0, tzinfo=TPE), False),  # 邊界：剛好 17:00 不能取消
        (datetime(2026, 11, 2, 8, 59, 59, tzinfo=UTC), True),  # 同一時間點的 UTC 表示
        (datetime(2026, 11, 2, 9, 0, 0, tzinfo=UTC), False),
        (datetime(2026, 11, 3, 8, 0, tzinfo=TPE), False),  # 看診當天
    ],
)
def test_can_cancel(now: datetime, expected: bool) -> None:
    assert can_cancel(APPT, now) is expected


def test_deadline_uses_taipei_date_not_utc_date() -> None:
    late = datetime(2026, 11, 2, 23, 30, tzinfo=UTC)  # 台北 11/03 07:30
    assert cancel_deadline(late) == datetime(2026, 11, 2, 17, 0, tzinfo=TPE)
    assert cancel_deadline(session_start(date(2026, 11, 3), "evening")) == datetime(2026, 11, 2, 17, 0, tzinfo=TPE)


def test_naive_datetime_is_rejected() -> None:
    with pytest.raises(ValueError):
        can_cancel(APPT, datetime(2026, 11, 2, 12, 0))
    with pytest.raises(ValueError):
        cancel_deadline(datetime(2026, 11, 3, 9, 0))


def _sessions(*capacities: int, day: date = DAY) -> dict[int, Session]:
    return {i: Session(id=i, doctor_id=1, session_date=day, capacity=c) for i, c in enumerate(capacities, start=1)}


def test_book_numbers_from_one_and_stops_at_capacity() -> None:
    sessions, appts = _sessions(2), []
    assert [book(sessions[1], p, appts, sessions).number for p in (101, 102)] == [1, 2]
    with pytest.raises(SessionFull):
        book(sessions[1], 103, appts, sessions)
    assert len(appts) == 2  # 失敗時不改動 list


def test_cancelled_frees_capacity_but_number_is_not_reused() -> None:
    sessions, appts = _sessions(2), []
    first = book(sessions[1], 101, appts, sessions)
    book(sessions[1], 102, appts, sessions)
    first.status = "cancelled"
    assert book(sessions[1], 101, appts, sessions).number == 3  # 取消後可以重掛，拿新號碼


def test_daily_limit_counts_only_active_on_same_day() -> None:
    sessions = _sessions(5, 5, 5, 5)
    sessions[5] = Session(id=5, doctor_id=1, session_date=date(2026, 11, 3), capacity=5)
    appts: list[Appointment] = []
    for sid in (1, 2, 3):
        book(sessions[sid], 101, appts, sessions)
    with pytest.raises(DailyLimitExceeded):
        book(sessions[4], 101, appts, sessions)
    book(sessions[5], 101, appts, sessions)  # 別天不算
    appts[0].status = "cancelled"
    book(sessions[4], 101, appts, sessions)  # 已取消的不算


def test_check_order_duplicate_then_full_then_daily_limit() -> None:
    sessions = _sessions(1, 5, 5, 1)
    appts: list[Appointment] = []
    book(sessions[1], 101, appts, sessions)
    with pytest.raises(AlreadyBooked):  # 已掛過而且名額也滿了：回「已掛過」
        book(sessions[1], 101, appts, sessions)
    book(sessions[2], 101, appts, sessions)
    book(sessions[3], 101, appts, sessions)
    book(sessions[4], 102, appts, sessions)
    with pytest.raises(SessionFull):  # 名額滿了而且超過每日上限：回「名額已滿」
        book(sessions[4], 101, appts, sessions)
    assert issubclass(AlreadyBooked, BookingError) and issubclass(DailyLimitExceeded, BookingError)


# ---- 階段 4：授權規則（角色 × 動作 × 範圍）----
APPOINTMENT = Appointment(session_id=1, patient_id=7, number=1, doctor_id=3)
DESK = Principal(1, "desk")
PATIENT7, PATIENT8 = Principal(2, "patient", patient_id=7), Principal(3, "patient", patient_id=8)
DOCTOR3, DOCTOR4 = Principal(4, "doctor", doctor_id=3), Principal(5, "doctor", doctor_id=4)


@pytest.mark.parametrize(
    ("user", "allowed"),
    [
        (DESK, {"read", "cancel", "check_in"}),
        (PATIENT7, {"read", "cancel"}),  # 自己的：能讀、能取消，不能報到
        (PATIENT8, set()),  # 別人的
        (DOCTOR3, {"read"}),  # 自己診次的：只能讀
        (DOCTOR4, set()),
        (Principal(6, "admin"), set()),  # 未知角色：預設拒絕
        (None, set()),
    ],
)
def test_policy_table(user: Principal | None, allowed: set[str]) -> None:
    assert {a for a in ("read", "cancel", "check_in", "delete") if can(user, a, APPOINTMENT)} == allowed


def test_missing_scope_value_never_matches() -> None:
    orphan = Appointment(session_id=1, patient_id=None, number=1, doctor_id=None)  # type: ignore[arg-type]
    assert not can(Principal(7, "patient"), "read", orphan)  # None == None 不算通過
    assert not can(Principal(8, "doctor"), "read", orphan)

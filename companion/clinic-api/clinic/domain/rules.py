"""掛號規則：不碰資料庫、不碰 HTTP、不自己讀時鐘（now 由呼叫端傳入）。"""

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from clinic.domain.errors import AlreadyBooked, DailyLimitExceeded, SessionFull
from clinic.domain.models import ACTIVE, Appointment, Session

TPE = ZoneInfo("Asia/Taipei")
DAILY_LIMIT = 3
PERIOD_START = {"morning": time(8, 30), "afternoon": time(13, 30), "evening": time(18, 0)}


def session_start(session_date: date, period: str) -> datetime:
    """診次開始看診的時間點（台北時間）。"""
    return datetime.combine(session_date, PERIOD_START[period], tzinfo=TPE)


def current_period(now: datetime) -> str:
    """報到看板要顯示的時段：依台北時間，下午診開始前是上午、晚上診開始前是下午，之後是晚上。"""
    t = now.astimezone(TPE).time()
    if t >= PERIOD_START["evening"]:
        return "evening"
    if t >= PERIOD_START["afternoon"]:
        return "afternoon"
    return "morning"


def cancel_deadline(appointment_time: datetime) -> datetime:
    """看診前一日 17:00（台北時間）。「前一日」用台北的日期算，不是 UTC 的日期。"""
    if appointment_time.tzinfo is None:
        raise ValueError("appointment_time 必須帶時區")
    local_day = appointment_time.astimezone(TPE).date()
    return datetime.combine(local_day - timedelta(days=1), time(17, 0), tzinfo=TPE)


def can_cancel(appointment_time: datetime, now: datetime) -> bool:
    if now.tzinfo is None:
        raise ValueError("now 必須帶時區")
    return now < cancel_deadline(appointment_time)  # 剛好 17:00:00 不能取消


def book(
    session: Session,
    patient_id: int,
    appointments: list[Appointment],
    sessions: dict[int, Session],
) -> Appointment:
    """規則的模型：拿一個 list 當作「目前所有掛號」。

    檢查順序是規格的一部分：重複 → 名額 → 每日上限；全部通過才修改 list。
    正式路徑（clinic/service/booking.py）的名額檢查是資料庫裡一句原子的 UPDATE，
    但錯誤的分類與順序和這裡相同。
    """
    in_session = [a for a in appointments if a.session_id == session.id]
    active_here = [a for a in in_session if a.status in ACTIVE]

    if any(a.patient_id == patient_id for a in active_here):
        raise AlreadyBooked(f"病患 {patient_id} 已掛診次 {session.id}")
    if len(active_here) >= session.capacity:
        raise SessionFull(f"診次 {session.id} 名額已滿")
    same_day = [
        a
        for a in appointments
        if a.patient_id == patient_id
        and a.status in ACTIVE
        and sessions[a.session_id].session_date == session.session_date
    ]
    if len(same_day) >= DAILY_LIMIT:
        raise DailyLimitExceeded(f"病患 {patient_id} 在 {session.session_date} 已掛 {DAILY_LIMIT} 診")

    number = max((a.number for a in in_session), default=0) + 1  # 含已取消：號碼不回收
    appointment = Appointment(session_id=session.id, patient_id=patient_id, number=number)
    appointments.append(appointment)
    return appointment

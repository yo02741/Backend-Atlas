"""領域物件：純資料，不 import 框架與資料庫。"""

from dataclasses import dataclass
from datetime import date, datetime

ACTIVE = frozenset({"booked", "checked_in"})  # 佔名額、算進每日上限的狀態


@dataclass(frozen=True)
class Session:
    id: int
    doctor_id: int
    session_date: date
    capacity: int
    period: str = "morning"
    booked: int = 0

    @property
    def remaining(self) -> int:
        return self.capacity - self.booked


@dataclass
class Appointment:
    session_id: int
    patient_id: int
    number: int
    status: str = "booked"
    id: int | None = None
    doctor_id: int | None = None  # 來自診次；醫師的授權範圍用
    session_date: date | None = None
    period: str | None = None
    created_at: datetime | None = None


@dataclass(frozen=True)
class Principal:
    """驗證之後代表「目前使用者」的物件。身分只來自驗證過的憑證。"""

    id: int
    role: str
    patient_id: int | None = None
    doctor_id: int | None = None


@dataclass(frozen=True)
class BoardRow:
    """報到看板的一列。只有診間與號碼，沒有病患資料，所以看板不需要登入。"""

    room: str
    doctor: str
    current_no: int  # 已報到的最大號碼；還沒有人報到是 0
    waiting: int  # 已掛號、還沒報到的人數

"""請求與回應的 schema。資料在邊界轉換：領域物件不直接當成回應。"""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

AppointmentStatus = Literal["booked", "cancelled", "checked_in"]


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "Bearer"
    expires_in: int


class BookIn(BaseModel):
    # strict：不做型別轉換，"7" 與 true 都不會被當成整數 7 或 1
    model_config = ConfigDict(strict=True)
    patient_id: int | None = Field(default=None, gt=0)  # 病患不用給；櫃台必填
    note: str | None = Field(default=None, max_length=200)  # 前端表單的備註：檢查長度，不儲存


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    doctor_id: int
    session_date: date
    period: str
    capacity: int
    remaining: int  # 僅供顯示，以掛號結果為準


class AppointmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    session_id: int
    patient_id: int
    number: int
    status: str
    created_at: datetime


class AppointmentPage(BaseModel):
    items: list[AppointmentOut]
    next_cursor: int | None


class BoardRowOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    room: str
    doctor: str
    current_no: int
    waiting: int

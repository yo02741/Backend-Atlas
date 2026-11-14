"""資料表對應（SQLAlchemy 2.0 宣告式）。

這裡只描述欄位，查詢時用；約束與索引以 alembic/versions 的 migration 為準。
有資料庫預設值的欄位標上 server_default，ORM 插入時才會省略該欄位、交給資料庫填。
"""

from datetime import date, datetime

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Text, func, true
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class PatientRow(Base):
    __tablename__ = "patients"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(Text)


class DoctorRow(Base):
    __tablename__ = "doctors"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    dept: Mapped[str] = mapped_column(Text)


class SessionRow(Base):
    __tablename__ = "sessions"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("doctors.id"))
    session_date: Mapped[date] = mapped_column(Date)
    period: Mapped[str] = mapped_column(Text)
    capacity: Mapped[int]
    booked: Mapped[int] = mapped_column(server_default="0")  # 目前有效掛號數；只能經由取號與取消那兩句 UPDATE 改動
    next_no: Mapped[int] = mapped_column(server_default="1")  # 下一個要發的號碼；號碼不回收


class AppointmentRow(Base):
    __tablename__ = "appointments"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"))
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))
    number: Mapped[int]
    status: Mapped[str] = mapped_column(Text, server_default="booked")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class UserRow(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    username: Mapped[str] = mapped_column(Text)
    password_hash: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(Text)
    patient_id: Mapped[int | None] = mapped_column(ForeignKey("patients.id"))
    doctor_id: Mapped[int | None] = mapped_column(ForeignKey("doctors.id"))
    is_active: Mapped[bool] = mapped_column(server_default=true())

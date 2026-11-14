"""階段 1：四張表與約束

Revision ID: 0001
Revises:
"""

import sqlalchemy as sa

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def _id() -> sa.Column:
    return sa.Column("id", sa.BigInteger, sa.Identity(always=False), primary_key=True)


def upgrade() -> None:
    op.create_table("patients", _id(), sa.Column("name", sa.Text, nullable=False))
    op.create_table(
        "doctors",
        _id(),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("dept", sa.Text, nullable=False),
    )
    op.create_table(
        "sessions",
        _id(),
        sa.Column("doctor_id", sa.BigInteger, sa.ForeignKey("doctors.id"), nullable=False),
        sa.Column("session_date", sa.Date, nullable=False),  # 診所當地的哪一天，不需要時區
        sa.Column("period", sa.Text, nullable=False),
        sa.Column("capacity", sa.Integer, nullable=False),
        sa.CheckConstraint("period IN ('morning', 'afternoon', 'evening')"),
        sa.CheckConstraint("capacity > 0"),
        sa.UniqueConstraint("doctor_id", "session_date", "period"),
    )
    op.create_table(
        "appointments",
        _id(),
        sa.Column("session_id", sa.BigInteger, sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("patient_id", sa.BigInteger, sa.ForeignKey("patients.id"), nullable=False),
        sa.Column("number", sa.Integer, nullable=False),
        sa.Column("status", sa.Text, nullable=False, server_default="booked"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("number > 0"),
        sa.CheckConstraint("status IN ('booked', 'cancelled', 'checked_in')"),
        sa.UniqueConstraint("session_id", "number"),  # 兩欄合起來唯一：appointments_session_id_number_key
        # 自己取名：階段 5 要把它換成部分唯一索引
        sa.UniqueConstraint("session_id", "patient_id", name="one_per_patient"),
    )
    # PostgreSQL 不會替外鍵的參照欄位建索引；「查某病患的所有掛號」要用到
    op.create_index("appointments_patient_id_idx", "appointments", ["patient_id"])


def downgrade() -> None:
    op.drop_table("appointments")
    op.drop_table("sessions")
    op.drop_table("doctors")
    op.drop_table("patients")

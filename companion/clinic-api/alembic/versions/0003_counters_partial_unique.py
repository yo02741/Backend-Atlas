"""階段 5：計數欄位、名額上限的 CHECK、部分唯一索引

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sessions", sa.Column("booked", sa.Integer, nullable=False, server_default="0"))
    op.add_column("sessions", sa.Column("next_no", sa.Integer, nullable=False, server_default="1"))
    # 既有資料回填：booked 是有效掛號數；next_no 要含已取消的（號碼不回收）
    op.execute(
        """
        UPDATE sessions s SET
          booked = (SELECT count(*) FROM appointments a
                    WHERE a.session_id = s.id AND a.status <> 'cancelled'),
          next_no = (SELECT coalesce(max(a.number), 0) + 1 FROM appointments a WHERE a.session_id = s.id)
        """
    )
    op.create_check_constraint("sessions_booked_check", "sessions", "booked >= 0")
    # 最後防線：哪天有人寫了忘記 WHERE booked < capacity 的 UPDATE，資料庫直接報錯
    op.create_check_constraint("sessions_check", "sessions", "booked <= capacity")

    # 「同一病患同一診次只能一筆」改成「未取消的只能一筆」：取消後才能重掛
    op.drop_constraint("one_per_patient", "appointments", type_="unique")
    op.create_index(
        "one_active_per_patient",
        "appointments",
        ["session_id", "patient_id"],
        unique=True,
        postgresql_where=sa.text("status <> 'cancelled'"),
    )


def downgrade() -> None:
    op.drop_index("one_active_per_patient", "appointments")
    op.create_unique_constraint("one_per_patient", "appointments", ["session_id", "patient_id"])
    op.drop_constraint("sessions_check", "sessions", type_="check")
    op.drop_constraint("sessions_booked_check", "sessions", type_="check")
    op.drop_column("sessions", "next_no")
    op.drop_column("sessions", "booked")

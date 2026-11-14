"""階段 4：登入帳號與角色

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger, sa.Identity(always=False), primary_key=True),
        sa.Column("username", sa.Text, nullable=False, unique=True),
        sa.Column("password_hash", sa.Text, nullable=False),  # Argon2id 雜湊，不存明文
        sa.Column("role", sa.Text, nullable=False),
        sa.Column("patient_id", sa.BigInteger, sa.ForeignKey("patients.id")),
        sa.Column("doctor_id", sa.BigInteger, sa.ForeignKey("doctors.id")),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.CheckConstraint("role IN ('patient', 'desk', 'doctor')", name="users_role_check"),
        # 角色與對應的 id 要一致：patient 一定有 patient_id、doctor 一定有 doctor_id，其他角色兩個都沒有
        sa.CheckConstraint(
            "(role = 'patient') = (patient_id IS NOT NULL) AND (role = 'doctor') = (doctor_id IS NOT NULL)",
            name="users_role_scope_check",
        ),
    )


def downgrade() -> None:
    op.drop_table("users")

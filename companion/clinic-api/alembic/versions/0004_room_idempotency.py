"""前後端接線：診間號碼（報到看板用）與掛號的冪等鍵

Revision ID: 0004
Revises: 0003
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 看板一列一個診間；沒填的醫師，看板用 doctor_id 代替
    op.add_column("doctors", sa.Column("room", sa.Text))

    # 冪等鍵：同一位使用者的同一個鍵只處理一次。和掛號寫在同一個交易裡，
    # 掛號失敗（409、422）時這一列跟著 rollback，重送會重新執行
    op.create_table(
        "idempotency_keys",
        sa.Column("user_id", sa.BigInteger, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key", sa.Text, nullable=False),
        sa.Column("fingerprint", sa.Text, nullable=False),  # 方法、路徑與 body 的 SHA-256：同鍵不同內容要擋
        sa.Column("status_code", sa.Integer),
        sa.Column("response", postgresql.JSONB),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("user_id", "key", name="idempotency_keys_pkey"),
    )


def downgrade() -> None:
    op.drop_table("idempotency_keys")
    op.drop_column("doctors", "room")

"""階段 1、5：約束由資料庫守住。直接下 SQL，確認每一種違規被擋下時的 SQLSTATE。"""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session as DbSession

from tests.conftest import World

APPT = "INSERT INTO appointments (session_id, patient_id, number) VALUES ({})"
SESS = "INSERT INTO sessions (doctor_id, session_date, period, capacity) VALUES ({})"
SAME_SLOT = "INSERT INTO sessions (doctor_id, session_date, period, capacity) SELECT 1, session_date, period, 5 FROM sessions WHERE id = 1"  # noqa: E501
VIOLATIONS = [
    ("號碼重複", APPT.format("1, 2, 1"), "23505"),
    ("同病患同診次第二筆有效掛號", APPT.format("1, 1, 2"), "23505"),
    ("診次不存在", APPT.format("99, 2, 2"), "23503"),
    ("病患不存在", APPT.format("1, 99, 2"), "23503"),
    ("病患為 NULL", APPT.format("1, NULL, 2"), "23502"),
    ("號碼 0", APPT.format("1, 2, 0"), "23514"),
    ("狀態不合法", "UPDATE appointments SET status = 'done'", "23514"),
    ("名額 0", SESS.format("1, '2030-01-01', 'morning', 0"), "23514"),
    ("時段不合法", SESS.format("1, '2030-01-01', 'night', 5"), "23514"),
    ("同醫師同天同時段", SAME_SLOT, "23505"),
    ("醫師不存在", SESS.format("99, '2030-01-01', 'morning', 5"), "23503"),
    ("booked 超過 capacity（忘了 WHERE 的 UPDATE）", "UPDATE sessions SET booked = capacity + 1 WHERE id = 1", "23514"),
    (
        "病患角色沒有 patient_id",
        "INSERT INTO users (username, password_hash, role) VALUES ('x', 'x', 'patient')",
        "23514",
    ),  # noqa: E501
]


@pytest.mark.parametrize(("label", "sql", "sqlstate"), VIOLATIONS, ids=[v[0] for v in VIOLATIONS])
def test_constraint_rejects(db: DbSession, world: World, label: str, sql: str, sqlstate: str) -> None:
    db.execute(text("INSERT INTO appointments (session_id, patient_id, number) VALUES (1, 1, 1)"))
    with pytest.raises(DBAPIError) as caught:
        db.execute(text(sql))
    assert caught.value.orig.sqlstate == sqlstate


def test_defaults_and_rebook_after_cancel(db: DbSession, world: World) -> None:
    db.execute(text("INSERT INTO appointments (session_id, patient_id, number) VALUES (1, 1, 1)"))
    row = db.execute(text("SELECT status, created_at FROM appointments")).one()
    assert row.status == "booked" and row.created_at.tzinfo is not None  # 預設值；TIMESTAMPTZ
    db.execute(text("UPDATE appointments SET status = 'cancelled'"))
    # 部分唯一索引：已取消的不擋，同一病患可以在同一診次再掛一筆
    db.execute(text("INSERT INTO appointments (session_id, patient_id, number) VALUES (1, 1, 2)"))
    index = db.execute(text("SELECT indexdef FROM pg_indexes WHERE indexname = 'one_active_per_patient'")).scalar_one()
    assert "UNIQUE" in index and "WHERE" in index

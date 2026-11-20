"""前後端接線：docs/contract.md 裡和前端課（假 API）對齊的部分。

/api 前綴、診次清單的選填條件、我的掛號的狀態篩選、Idempotency-Key、報到看板、授權拒絕的日誌原因。
"""

import json
import logging
from collections.abc import Callable, Iterator
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from redis import Redis
from sqlalchemy import text
from sqlalchemy.orm import Session as DbSession

from clinic.domain.rules import TPE, current_period
from clinic.logging_setup import JsonFormatter
from clinic.repository.tables import SessionRow
from tests.conftest import World

Auth = Callable[[str], dict[str, str]]
PROBLEMS = "https://clinic.example/problems/"


class ListHandler(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.setFormatter(JsonFormatter())
        self.entries: list[dict] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.entries.append(json.loads(self.format(record)))


@pytest.fixture
def logs() -> Iterator[list[dict]]:
    handler = ListHandler()
    logging.getLogger().addHandler(handler)
    yield handler.entries
    logging.getLogger().removeHandler(handler)


# ---- /api 前綴 ----


def test_business_routes_live_under_api_and_ops_routes_do_not(client: TestClient, auth: Auth, world: World) -> None:
    h = auth("patient1")
    assert client.get("/api/appointments", headers=h).status_code == 200
    for old in ("/appointments", "/sessions", "/board"):  # 沒有前綴的舊路徑不存在
        assert client.get(old, headers=h).status_code == 404, old
    assert client.post("/auth/login", json={"username": "patient1", "password": "x"}).status_code == 404
    for ops in ("/healthz", "/ready", "/metrics"):  # 探針與 Prometheus 打的路徑不變
        assert client.get(ops).status_code == 200, ops
        assert client.get("/api" + ops).status_code == 404, ops  # 也不從 /api（前端的 proxy）露出去


# ---- GET /api/sessions：doctor_id、date 都是選填 ----


def test_sessions_filters_are_optional(client: TestClient, auth: Auth, world: World) -> None:
    h = auth("patient1")

    def ids(**params: object) -> list[int]:
        r = client.get("/api/sessions", params=params, headers=h)
        assert r.status_code == 200, r.text
        return [s["id"] for s in r.json()]

    day = world.day.isoformat()
    assert ids(date=day, doctor_id=1) == [world.s_small, world.s_afternoon, world.s_evening]
    assert ids(date=day) == [world.s_small, world.s_afternoon, world.s_evening, world.s_other_doctor]  # 全部醫師
    assert ids(doctor_id=2) == [world.s_today, world.s_other_doctor]  # 全部日期：依日期、再依 id 排序
    assert len(ids()) == 5
    for bad in ({"doctor_id": "abc"}, {"doctor_id": 0}, {"date": "11/26"}):
        r = client.get("/api/sessions", params=bad, headers=h)
        assert r.status_code == 422 and r.json()["type"] == PROBLEMS + "validation-error", bad
        assert list(r.json()["errors"]) == [next(iter(bad))]  # errors 的 key 是參數名稱


def test_list_of_all_doctors_is_invalidated_after_booking(
    client: TestClient, auth: Auth, world: World, redis: Redis
) -> None:
    h = auth("patient1")
    params = {"date": world.day.isoformat()}

    def remaining() -> int:
        return next(s["remaining"] for s in client.get("/api/sessions", params=params, headers=h).json())

    assert remaining() == 2
    assert redis.get(f"sessions:v2:doctor:all:date:{world.day.isoformat()}") is not None
    assert client.post(f"/api/sessions/{world.s_small}/appointments", json={}, headers=h).status_code == 201
    assert remaining() == 1  # 「全部醫師」那份快取也失效了，不用等 30 秒


# ---- GET /api/appointments?status= ----


def test_appointments_can_be_filtered_by_status(client: TestClient, auth: Auth, world: World) -> None:
    p1, desk = auth("patient1"), auth("desk1")
    made = [
        client.post(f"/api/sessions/{sid}/appointments", json={"patient_id": pid}, headers=desk).json()["id"]
        for sid, pid in [(world.s_small, 1), (world.s_afternoon, 1), (world.s_evening, 1), (world.s_small, 2)]
    ]
    assert client.post(f"/api/appointments/{made[1]}/cancel", headers=p1).status_code == 200
    assert client.post(f"/api/appointments/{made[2]}/check-in", headers=desk).status_code == 200

    def ids(user: dict[str, str], **params: object) -> list[int]:
        r = client.get("/api/appointments", params=params, headers=user)
        assert r.status_code == 200, r.text
        return [a["id"] for a in r.json()["items"]]

    assert ids(p1) == made[:3]
    assert ids(p1, status="booked") == [made[0]]  # 權限範圍與狀態一起推進 WHERE
    assert ids(p1, status="cancelled") == [made[1]]
    assert ids(p1, status="checked_in") == [made[2]]
    assert ids(desk, status="booked") == [made[0], made[3]]
    page = client.get("/api/appointments", params={"status": "booked", "limit": 1}, headers=desk).json()
    assert [a["id"] for a in page["items"]] == [made[0]] and page["next_cursor"] == made[0]  # 分頁在篩選之後
    r = client.get("/api/appointments", params={"status": "done"}, headers=p1)
    assert r.status_code == 422 and "status" in r.json()["errors"]


# ---- POST /api/sessions/{id}/appointments 的 Idempotency-Key ----


def test_same_key_same_body_replays_the_first_result(
    client: TestClient, auth: Auth, world: World, db: DbSession
) -> None:
    h = {**auth("desk1"), "Idempotency-Key": "8d1f0c1e-4a7b-4a61-9e55-1f0e2d3c4b5a"}
    url = f"/api/sessions/{world.s_afternoon}/appointments"
    first = client.post(url, json={"patient_id": 3, "note": "初診"}, headers=h)
    again = client.post(url, json={"note": "初診", "patient_id": 3}, headers=h)  # 欄位順序不同也是同一個內容
    assert first.status_code == again.status_code == 201
    assert again.json() == first.json() and again.headers["Location"] == first.headers["Location"]
    assert "Idempotent-Replayed" not in first.headers and again.headers["Idempotent-Replayed"] == "true"
    count = db.execute(text("SELECT count(*) FROM appointments WHERE patient_id = 3")).scalar_one()
    booked = db.execute(text("SELECT booked FROM sessions WHERE id = :id"), {"id": world.s_afternoon}).scalar_one()
    assert (count, booked) == (1, 1)  # 只有一筆掛號，名額只扣一次


def test_same_key_different_body_is_422(client: TestClient, auth: Auth, world: World) -> None:
    h = {**auth("desk1"), "Idempotency-Key": "k-1"}
    url = f"/api/sessions/{world.s_afternoon}/appointments"
    assert client.post(url, json={"patient_id": 3}, headers=h).status_code == 201
    r = client.post(url, json={"patient_id": 2}, headers=h)
    assert r.status_code == 422 and r.headers["content-type"] == "application/problem+json"
    assert r.json()["type"] == PROBLEMS + "idempotency-key-reused"
    other = client.post(f"/api/sessions/{world.s_evening}/appointments", json={"patient_id": 3}, headers=h)
    assert other.status_code == 422  # 路徑不同也算內容不同


def test_failed_attempt_is_not_stored_and_keys_are_per_user(
    client: TestClient, auth: Auth, world: World, db: DbSession
) -> None:
    desk = auth("desk1")
    url = f"/api/sessions/{world.s_afternoon}/appointments"
    assert client.post(url, json={"patient_id": 3}, headers=desk).status_code == 201
    h = {**desk, "Idempotency-Key": "k-2"}
    assert client.post(url, json={"patient_id": 3}, headers=h).status_code == 409  # 已掛過：沒有存下結果
    db.execute(text("UPDATE appointments SET status = 'cancelled'"))
    db.execute(text("UPDATE sessions SET booked = 0"))
    db.commit()
    assert client.post(url, json={"patient_id": 3}, headers=h).status_code == 201  # 同一個鍵重新執行
    assert db.execute(text("SELECT count(*) FROM idempotency_keys")).scalar_one() == 1

    p1 = {**auth("patient1"), "Idempotency-Key": "k-2"}  # 別人用同一個字串：互不相干
    r = client.post(url, json={}, headers=p1)
    assert r.status_code == 201 and r.json()["patient_id"] == 1 and "Idempotent-Replayed" not in r.headers


@pytest.mark.parametrize("key", [b"", "é".encode(), b"a b", b"x" * 256])  # 空的、非 ASCII、含空白、太長
def test_malformed_key_is_422(client: TestClient, auth: Auth, world: World, key: bytes) -> None:
    h: dict = {**auth("patient1"), "Idempotency-Key": key}
    r = client.post(f"/api/sessions/{world.s_afternoon}/appointments", json={}, headers=h)
    assert r.status_code == 422 and "Idempotency-Key" in r.json()["errors"], r.text


def test_note_is_checked_but_not_required(client: TestClient, auth: Auth, world: World) -> None:
    h = auth("desk1")
    url = f"/api/sessions/{world.s_afternoon}/appointments"
    r = client.post(url, json={"patient_id": 3, "note": "x" * 201}, headers=h)
    assert r.status_code == 422 and list(r.json()["errors"]) == ["note"]
    assert client.post(url, json={"patient_id": 3, "note": "x" * 200}, headers=h).status_code == 201


# ---- GET /api/board ----


def test_current_period_follows_taipei_clock() -> None:
    at = lambda h, m: datetime(2026, 11, 26, h, m, tzinfo=TPE)  # noqa: E731
    assert [current_period(at(h, m)) for h, m in [(7, 0), (13, 29), (13, 30), (17, 59), (18, 0), (23, 0)]] == [
        "morning", "morning", "afternoon", "afternoon", "evening", "evening",
    ]  # fmt: skip
    assert current_period(datetime.fromisoformat("2026-11-26T05:30:00+00:00")) == "afternoon"  # UTC 05:30 = 台北 13:30


@pytest.fixture
def today_sessions(db: DbSession, world: World) -> dict[int, int]:
    """今天兩位醫師的三個時段都有診次（不管測試在幾點跑，目前的時段都有）。回傳 {醫師: 目前時段的診次 id}。"""
    db.execute(text("UPDATE doctors SET room = '101' WHERE id = 1"))  # 醫師 2 沒填診間：看板用 doctor_id
    db.execute(text("DELETE FROM sessions WHERE id = :id"), {"id": world.s_today})
    rows = [
        SessionRow(doctor_id=d, session_date=world.today, period=p, capacity=30)
        for d in (1, 2)
        for p in ("morning", "afternoon", "evening")
    ]
    db.add_all(rows)
    db.commit()
    period = current_period(datetime.now(TPE))
    return {r.doctor_id: r.id for r in rows if r.period == period}


def test_board_is_public_and_follows_check_ins(
    client: TestClient, auth: Auth, world: World, today_sessions: dict[int, int]
) -> None:
    r = client.get("/api/board")  # 不帶 token
    assert r.status_code == 200, r.text
    assert r.json() == [
        {"room": "101", "doctor": "林醫師", "current_no": 0, "waiting": 0},
        {"room": "2", "doctor": "張醫師", "current_no": 0, "waiting": 0},
    ]
    desk = auth("desk1")
    url = f"/api/sessions/{today_sessions[1]}/appointments"
    made = [client.post(url, json={"patient_id": p}, headers=desk).json()["id"] for p in (1, 2, 3)]
    assert client.post(f"/api/appointments/{made[1]}/cancel", headers=desk).status_code == 409  # 今天的：過了取消期限
    assert client.post(f"/api/appointments/{made[0]}/check-in", headers=desk).status_code == 200
    room = client.get("/api/board").json()[0]
    assert (room["current_no"], room["waiting"]) == (1, 2)  # 1 號報到了，2、3 號還沒到
    assert client.post(f"/api/appointments/{made[2]}/check-in", headers=desk).status_code == 200
    room = client.get("/api/board").json()[0]
    assert (room["current_no"], room["waiting"]) == (3, 1)  # 叫到 3 號；2 號還沒報到


def test_board_only_shows_todays_current_period(client: TestClient, world: World) -> None:
    # world 的今天只有一個晚上診，其他都是一週後的：只有在晚上時看板才有那一列
    expected = 1 if current_period(datetime.now(TPE)) == "evening" else 0
    assert len(client.get("/api/board").json()) == expected


# ---- 授權拒絕的日誌原因 ----


def test_not_found_and_not_visible_are_logged_differently(
    client: TestClient, auth: Auth, world: World, logs: list[dict]
) -> None:
    desk = auth("desk1")
    theirs = client.post(f"/api/sessions/{world.s_small}/appointments", json={"patient_id": 2}, headers=desk).json()
    p1 = auth("patient1")
    missing = client.get("/api/appointments/9999", headers=p1)
    hidden = client.get(f"/api/appointments/{theirs['id']}", headers=p1)
    assert missing.status_code == hidden.status_code == 404
    assert missing.json() == hidden.json()  # 對外完全一樣，不洩漏 id 是否存在
    rejected = [e for e in logs if e["msg"] == "request rejected" and e["status"] == 404]
    assert [(e["reason"], e["level"]) for e in rejected] == [("not-found", "INFO"), ("not-visible", "WARNING")]
    assert client.post(f"/api/appointments/{theirs['id']}/cancel", headers=p1).status_code == 404
    assert [e for e in logs if e["msg"] == "request rejected"][-1]["reason"] == "not-visible"

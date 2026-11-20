"""階段 3：REST 介面、狀態碼、Problem Details。"""

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session as DbSession

from tests.conftest import World

Auth = Callable[[str], dict[str, str]]
PROBLEM_JSON = "application/problem+json"


def test_book_returns_201_with_location_and_get_returns_same(client: TestClient, auth: Auth, world: World) -> None:
    h = auth("patient1")
    r = client.post(f"/api/sessions/{world.s_small}/appointments", json={}, headers=h)
    assert r.status_code == 201, r.text
    body = r.json()
    assert (body["session_id"], body["patient_id"], body["number"], body["status"]) == (world.s_small, 1, 1, "booked")
    assert r.headers["Location"] == f"/api/appointments/{body['id']}"  # 和其他路徑一樣帶 /api
    assert client.get(r.headers["Location"], headers=h).json() == body


def test_list_sessions_shows_remaining(client: TestClient, auth: Auth, world: World) -> None:
    h = auth("patient1")
    client.post(f"/api/sessions/{world.s_small}/appointments", json={}, headers=h)
    r = client.get("/api/sessions", params={"doctor_id": 1, "date": world.day.isoformat()}, headers=h)
    assert r.status_code == 200
    assert [(s["period"], s["capacity"], s["remaining"]) for s in r.json()] == [
        ("morning", 2, 1), ("afternoon", 30, 30), ("evening", 30, 30),
    ]  # fmt: skip
    assert client.get("/api/sessions", params={"doctor_id": 1, "date": "11/02"}, headers=h).status_code == 422


@pytest.mark.parametrize("raw", ["patient_id=7", "[7]", '"7"', ""])
def test_body_that_is_not_a_json_object_is_400(client: TestClient, auth: Auth, world: World, raw: str) -> None:
    h = {**auth("desk1"), "Content-Type": "application/json"}
    r = client.post(f"/api/sessions/{world.s_small}/appointments", content=raw, headers=h)
    assert r.status_code == 400 and r.json()["status"] == 400, r.text


@pytest.mark.parametrize("payload", [{}, {"patient_id": "1"}, {"patient_id": True}, {"patient_id": 0}])
def test_invalid_field_is_422_and_names_the_field(client: TestClient, auth: Auth, world: World, payload: dict) -> None:
    r = client.post(f"/api/sessions/{world.s_small}/appointments", json=payload, headers=auth("desk1"))
    assert r.status_code == 422, r.text
    assert r.json()["type"].endswith("validation-error") and r.json()["detail"] == "欄位格式錯誤"
    errors = r.json()["errors"]  # { 欄位: [訊息, …] }，和前端課的假 API 同一種格式
    assert isinstance(errors["patient_id"], list) and all(isinstance(m, str) for m in errors["patient_id"])


def test_missing_resources_are_404_and_wrong_method_is_405(client: TestClient, auth: Auth, world: World) -> None:
    h = auth("desk1")
    assert client.post("/api/sessions/999/appointments", json={"patient_id": 1}, headers=h).status_code == 404
    url = f"/api/sessions/{world.s_small}/appointments"
    assert client.post(url, json={"patient_id": 99}, headers=h).status_code == 404
    assert client.get("/api/appointments/999", headers=h).status_code == 404
    assert client.get("/api/appointments/abc", headers=h).status_code == 404
    assert client.get("/api/nothing", headers=h).status_code == 404
    assert client.delete(url, headers=h).status_code == 405
    assert client.put("/api/appointments/1", json={}, headers=h).status_code == 405


def test_business_conflicts_are_409_with_distinct_types(client: TestClient, auth: Auth, world: World) -> None:
    desk = auth("desk1")
    url = f"/api/sessions/{world.s_small}/appointments"  # 名額 2
    assert client.post(url, json={"patient_id": 1}, headers=desk).status_code == 201
    dup = client.post(url, json={"patient_id": 1}, headers=desk)
    assert dup.status_code == 409 and dup.json()["type"].endswith("/already-booked")
    assert client.post(url, json={"patient_id": 2}, headers=desk).status_code == 201
    full = client.post(url, json={"patient_id": 3}, headers=desk)
    assert full.status_code == 409 and full.json()["type"].endswith("/session-full")
    assert full.json()["title"] == "Session full" and "detail" in full.json()
    # 已掛過而且名額也滿了：先回「已掛過」
    assert client.post(url, json={"patient_id": 2}, headers=desk).json()["type"].endswith("/already-booked")


def test_daily_limit_is_409_and_rolls_back_the_taken_number(
    client: TestClient, auth: Auth, world: World, db: DbSession
) -> None:
    h = auth("patient1")
    for sid in (world.s_small, world.s_afternoon, world.s_evening):
        assert client.post(f"/api/sessions/{sid}/appointments", json={}, headers=h).status_code == 201
    r = client.post(f"/api/sessions/{world.s_other_doctor}/appointments", json={}, headers=h)  # 同一天第 4 診
    assert r.status_code == 409 and r.json()["type"].endswith("/daily-limit")
    row = db.execute(text("SELECT booked, next_no FROM sessions WHERE id = :id"), {"id": world.s_other_doctor}).one()
    assert (row.booked, row.next_no) == (0, 1)  # 取號那句 UPDATE 跟著交易撤銷
    assert client.post(f"/api/sessions/{world.s_today}/appointments", json={}, headers=h).status_code == 201  # 別天不算


def test_cancel_then_rebook_gets_a_new_number(client: TestClient, auth: Auth, world: World, db: DbSession) -> None:
    h = auth("patient1")
    url = f"/api/sessions/{world.s_small}/appointments"
    first = client.post(url, json={}, headers=h).json()
    r = client.post(f"/api/appointments/{first['id']}/cancel", headers=h)
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    again = client.post(f"/api/appointments/{first['id']}/cancel", headers=h)
    assert again.status_code == 409 and again.json()["type"].endswith("/invalid-status")
    assert db.execute(text("SELECT booked FROM sessions WHERE id = :id"), {"id": world.s_small}).scalar_one() == 0
    assert client.post(url, json={}, headers=h).json()["number"] == 2  # 號碼不回收


def test_cancel_after_deadline_is_409(client: TestClient, auth: Auth, world: World) -> None:
    h = auth("patient1")
    appt = client.post(f"/api/sessions/{world.s_today}/appointments", json={}, headers=h).json()  # 今天的診次
    r = client.post(f"/api/appointments/{appt['id']}/cancel", headers=h)
    assert r.status_code == 409 and r.json()["type"].endswith("/cancel-deadline-passed")


def test_check_in_only_from_booked(client: TestClient, auth: Auth, world: World) -> None:
    desk = auth("desk1")
    appt = client.post(f"/api/sessions/{world.s_small}/appointments", json={"patient_id": 2}, headers=desk).json()
    r = client.post(f"/api/appointments/{appt['id']}/check-in", headers=desk)
    assert r.status_code == 200 and r.json()["status"] == "checked_in"
    assert client.post(f"/api/appointments/{appt['id']}/check-in", headers=desk).status_code == 409
    assert client.post(f"/api/appointments/{appt['id']}/cancel", headers=desk).status_code == 409  # 已報到不能取消


def test_every_error_is_a_problem_document(client: TestClient, auth: Auth, world: World) -> None:
    desk = auth("desk1")
    responses = [
        client.get("/api/appointments/1"),  # 401
        client.post(f"/api/sessions/{world.s_small}/appointments", content="x", headers=desk),  # 400
        client.post(f"/api/sessions/{world.s_small}/appointments", json={}, headers=desk),  # 422
        client.get("/api/appointments/5", headers=desk),  # 404
        client.delete(f"/api/sessions/{world.s_small}/appointments", headers=desk),  # 405
        client.post(f"/api/sessions/{world.s_small}/appointments", json={}, headers=auth("doctor1")),  # 403
    ]
    assert [r.status_code for r in responses] == [401, 400, 422, 404, 405, 403]
    for r in responses:
        assert r.headers["content-type"] == PROBLEM_JSON
        assert {"type", "title", "status"} <= set(r.json()) and r.json()["status"] == r.status_code
    assert responses[0].headers["WWW-Authenticate"] == "Bearer"
    assert responses[3].json()["type"] == "about:blank" and responses[3].json()["title"] == "Not Found"

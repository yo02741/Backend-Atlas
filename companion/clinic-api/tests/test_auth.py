"""階段 4：登入、三種角色、擁有者檢查、把權限推進查詢。"""

from collections.abc import Callable
from datetime import datetime, timedelta

import jwt
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session as DbSession

from clinic.domain.rules import TPE
from clinic.service.auth import hash_password, verify_password
from tests.conftest import TEST_PASSWORD, World

Auth = Callable[[str], dict[str, str]]


def test_password_is_stored_as_argon2id_hash(db: DbSession, world: World) -> None:
    stored = db.execute(text("SELECT password_hash FROM users WHERE username = 'patient1'")).scalar_one()
    assert stored.startswith("$argon2id$") and TEST_PASSWORD not in stored
    assert verify_password(stored, TEST_PASSWORD) and not verify_password(stored, TEST_PASSWORD + "x")
    assert hash_password("a") != hash_password("a")  # 每次的 salt 不同


def test_login_failures_are_401_and_indistinguishable(client: TestClient, world: World) -> None:
    wrong = client.post("/api/auth/login", json={"username": "patient1", "password": "nope"})
    unknown = client.post("/api/auth/login", json={"username": "nobody", "password": "nope"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()  # 不透露是帳號還是密碼錯


def test_invalid_expired_or_disabled_credentials_are_401(
    client: TestClient, app: FastAPI, auth: Auth, world: World, db: DbSession
) -> None:
    secret = app.state.settings.jwt_secret.get_secret_value()
    past = datetime.now(TPE) - timedelta(hours=1)
    expired = jwt.encode({"sub": "1", "exp": past}, secret, algorithm="HS256")
    forged = jwt.encode({"sub": "3", "exp": datetime.now(TPE) + timedelta(hours=1)}, "x" * 32, algorithm="HS256")
    for token in (expired, forged, "not-a-jwt"):
        r = client.get("/api/appointments", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 401, token
    h = auth("patient1")
    assert client.get("/api/appointments", headers=h).status_code == 200
    db.execute(text("UPDATE users SET is_active = false WHERE username = 'patient1'"))
    db.commit()
    assert client.get("/api/appointments", headers=h).status_code == 401  # 停權立刻生效，不用等 token 過期


def test_roles_and_ownership(client: TestClient, auth: Auth, world: World) -> None:
    p1, p2, desk, doc1, doc2 = (auth(u) for u in ("patient1", "patient2", "desk1", "doctor1", "doctor2"))
    book_url = f"/api/sessions/{world.s_small}/appointments"  # 醫師 1 的診次

    # 掛號：病患只能替自己掛（身分來自 token）；櫃台可以替任何病患掛；醫師不行
    mine = client.post(book_url, json={}, headers=p1).json()
    assert mine["patient_id"] == 1
    assert client.post(book_url, json={"patient_id": 2}, headers=p1).status_code == 403
    assert client.post(book_url, json={"patient_id": 2}, headers=doc1).status_code == 403
    theirs = client.post(book_url, json={"patient_id": 2}, headers=desk).json()
    assert theirs["patient_id"] == 2

    # 讀取：自己的、自己診次的、全部；看不到就是 404（不洩漏 id 是否存在）
    other = f"/api/appointments/{theirs['id']}"
    assert client.get(other, headers=p2).status_code == 200
    assert client.get(other, headers=p1).status_code == 404
    assert client.get(other, headers=doc1).status_code == 200
    assert client.get(other, headers=doc2).status_code == 404
    assert client.get(other, headers=desk).status_code == 200

    # 取消：別人的 404；看得到但不能取消（醫師）403；報到只有櫃台
    assert client.post(f"{other}/cancel", headers=p1).status_code == 404
    assert client.post(f"{other}/cancel", headers=doc1).status_code == 403
    assert client.post(f"{other}/check-in", headers=p2).status_code == 403
    assert client.post(f"{other}/check-in", headers=doc1).status_code == 403
    assert client.post(f"{other}/cancel", headers=p2).status_code == 200
    assert client.post(f"/api/appointments/{mine['id']}/check-in", headers=desk).status_code == 200


def test_list_is_scoped_in_the_query_and_paginated(client: TestClient, auth: Auth, world: World) -> None:
    desk = auth("desk1")
    for sid, pid in [(world.s_small, 1), (world.s_small, 2), (world.s_other_doctor, 1), (world.s_other_doctor, 3)]:
        r = client.post(f"/api/sessions/{sid}/appointments", json={"patient_id": pid}, headers=desk)
        assert r.status_code == 201

    def ids(user: str, **params: int) -> list[int]:
        return [a["id"] for a in client.get("/api/appointments", params=params, headers=auth(user)).json()["items"]]

    assert ids("patient1") == [1, 3]
    assert ids("patient1", patient_id=2) == []  # 指定別人的 patient_id 也拿不到
    assert ids("doctor1") == [1, 2] and ids("doctor2") == [3, 4]
    assert ids("desk1") == [1, 2, 3, 4] and ids("desk1", patient_id=3) == [4]

    page1 = client.get("/api/appointments", params={"limit": 3}, headers=desk).json()
    assert [a["id"] for a in page1["items"]] == [1, 2, 3] and page1["next_cursor"] == 3
    page2 = client.get("/api/appointments", params={"limit": 3, "cursor": 3}, headers=desk).json()
    assert [a["id"] for a in page2["items"]] == [4] and page2["next_cursor"] is None
    # 分頁在過濾之後：病患的第一頁就是自己的兩筆，不會因為別人的資料而變短
    mine = client.get("/api/appointments", params={"limit": 2}, headers=auth("patient1")).json()
    assert [a["id"] for a in mine["items"]] == [1, 3] and mine["next_cursor"] is None

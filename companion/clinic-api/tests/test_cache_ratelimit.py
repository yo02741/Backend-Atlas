"""階段 6：cache-aside、token bucket、Redis 無法使用時的降級。"""

from collections.abc import Callable

from fastapi.testclient import TestClient
from redis import Redis
from sqlalchemy import text
from sqlalchemy.orm import Session as DbSession

from clinic.api.rate_limit import TokenBucket
from clinic.app import create_app
from clinic.config import Settings
from clinic.metrics import REDIS_ERRORS, REGISTRY
from tests.conftest import TEST_PASSWORD, World

Auth = Callable[[str], dict[str, str]]


class FakeClock:
    def __init__(self) -> None:
        self.t = 50.0

    def __call__(self) -> float:
        return self.t


def test_token_bucket_burst_refill_and_cap() -> None:
    clock = FakeClock()
    bucket = TokenBucket(5, 1, clock)
    assert [bucket.allow() for _ in range(6)] == [True] * 5 + [False]  # 一開始能連發 capacity 次
    clock.t += 0.25
    assert bucket.allow() is False and bucket.retry_after() == 0.75  # 被拒絕的請求不扣 token
    clock.t += 0.75
    assert bucket.allow() is True  # 小數累積：0.25 + 0.75 湊滿 1 個
    clock.t += 3600
    assert [bucket.allow() for _ in range(6)] == [True] * 5 + [False]  # 閒置很久也不超過容量


def test_session_list_is_cached_and_invalidated_after_booking(
    client: TestClient, auth: Auth, world: World, db: DbSession, redis: Redis
) -> None:
    h = auth("patient1")
    params = {"doctor_id": 1, "date": world.day.isoformat()}
    key = f"sessions:v2:doctor:1:date:{world.day.isoformat()}"

    def remaining() -> int:
        return client.get("/api/sessions", params=params, headers=h).json()[0]["remaining"]

    assert redis.get(key) is None
    assert remaining() == 2  # miss：查資料庫、寫進快取
    assert 0 < redis.ttl(key) <= 30
    db.execute(text("UPDATE sessions SET capacity = 10 WHERE id = :id"), {"id": world.s_small})
    db.commit()
    assert remaining() == 2  # hit：資料庫改了，TTL 內看到的還是舊值
    assert client.post(f"/api/sessions/{world.s_small}/appointments", json={}, headers=h).status_code == 201
    assert redis.get(key) is None  # 掛號 COMMIT 之後刪掉那位醫師那一天的 key
    assert remaining() == 9  # 重新載入
    appt = client.get("/api/appointments", headers=h).json()["items"][0]
    assert client.post(f"/api/appointments/{appt['id']}/cancel", headers=h).status_code == 200
    assert remaining() == 10  # 取消也會失效


def test_empty_result_is_cached_too(client: TestClient, auth: Auth, world: World, redis: Redis) -> None:
    h = auth("patient1")
    before = REGISTRY.get_sample_value("cache_requests_total", {"result": "hit"}) or 0
    for _ in range(2):
        assert client.get("/api/sessions", params={"doctor_id": 2, "date": "2031-01-01"}, headers=h).json() == []
    assert redis.get("sessions:v2:doctor:2:date:2031-01-01") == "[]"
    assert REGISTRY.get_sample_value("cache_requests_total", {"result": "hit"}) == before + 1  # 空清單也算命中


def test_booking_is_rate_limited_per_user(client: TestClient, auth: Auth, world: World) -> None:
    p1, p2 = auth("patient1"), auth("patient2")
    url = f"/api/sessions/{world.s_afternoon}/appointments"
    statuses = [client.post(url, json={}, headers=p1).status_code for _ in range(6)]
    assert statuses == [201, 409, 409, 409, 409, 429]  # 容量 5：第 6 次被擋（不管前 5 次的業務結果）
    blocked = client.post(url, json={}, headers=p1)
    assert blocked.status_code == 429 and blocked.headers["content-type"] == "application/problem+json"
    assert 1 <= int(blocked.headers["Retry-After"]) <= 6  # 整數秒；每 6 秒補 1 個
    assert client.post(url, json={}, headers=p2).status_code == 201  # 別的使用者不受影響
    assert client.post(url, content="not json", headers=p1).status_code == 429  # 限流在驗證 body 之前


def test_redis_down_degrades_instead_of_failing(settings: Settings, world: World) -> None:
    """快取：改查資料庫。掛號限流：放行。登入限流：退回行程內的 bucket。"""
    broken = settings.model_copy(update={"redis_url": "redis://127.0.0.1:1/0"})  # 沒有東西在聽的 port
    before = REGISTRY.get_sample_value("redis_errors_total", {"component": "rate_limit"}) or 0
    with TestClient(create_app(broken)) as client:
        login = {"username": "patient1", "password": TEST_PASSWORD}
        token = client.post("/api/auth/login", json=login).json()["access_token"]
        h = {"Authorization": f"Bearer {token}"}
        params = {"doctor_id": 1, "date": world.day.isoformat()}
        assert client.get("/api/sessions", params=params, headers=h).status_code == 200
        url = f"/api/sessions/{world.s_small}/appointments"
        assert [client.post(url, json={}, headers=h).status_code for _ in range(7)] == [201] + [409] * 6  # 沒有 429
        assert client.get("/api/sessions", params=params, headers=h).json()[0]["remaining"] == 1
        statuses = [client.post("/api/auth/login", json=login).status_code for _ in range(5)]
        assert statuses == [200, 200, 200, 200, 429]  # 連同上面那次共 6 次登入：第 6 次被行程內的 bucket 擋下
    assert REGISTRY.get_sample_value("redis_errors_total", {"component": "rate_limit"}) >= before + 8
    assert REDIS_ERRORS.labels(component="cache")._value.get() > 0

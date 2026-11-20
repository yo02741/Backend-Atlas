"""階段 8：JSON 日誌、request_id、遮罩、/metrics、/healthz 與 /ready。"""

import json
import logging
import sys
from collections.abc import Callable, Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from clinic.app import create_app
from clinic.config import Settings
from clinic.logging_setup import JsonFormatter, mask_national_id, request_id_var
from clinic.service.booking import BookingService
from tests.conftest import World

Auth = Callable[[str], dict[str, str]]


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


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("A123456789", "A*******89"),
        ("病患A123456789掛號", "病患A*******89掛號"),  # 中文緊鄰：\b 抓不到，這裡要抓到
        ("order-A1234567890", "order-A1234567890"),  # 後面還有數字：是更長的編號，不遮
        ("XA123456789", "XA123456789"),  # 前面是英數字：不是獨立的身分證字號
        ("a123456789", "a123456789"),
    ],
)
def test_mask_national_id(text: str, expected: str) -> None:
    assert mask_national_id(text) == expected


def test_json_formatter_fields_masking_and_exception() -> None:
    formatter = JsonFormatter()
    token = request_id_var.set("req-7f3a")
    try:
        try:
            raise RuntimeError("查不到 B234567890")
        except RuntimeError:
            record = logging.LogRecord(
                "clinic.test", logging.ERROR, __file__, 1, "查詢病患 %s", ("A123456789",), sys.exc_info()
            )
            record.fields = {"note": "C123456789 重複點擊", "nested": {"ids": ["D123456789"]}, "n": 3}
            line = formatter.format(record)
    finally:
        request_id_var.reset(token)
    assert "\n" not in line  # 一行一筆
    entry = json.loads(line)
    assert entry["level"] == "ERROR" and entry["logger"] == "clinic.test" and entry["request_id"] == "req-7f3a"
    assert entry["ts"].endswith("+00:00")  # UTC
    assert entry["msg"] == "查詢病患 A*******89" and entry["note"].startswith("C*******89") and entry["n"] == 3
    assert "RuntimeError" in entry["exc"]
    for raw in ("A123456789", "B234567890", "C123456789", "D123456789"):
        assert raw not in line  # 原文不出現在輸出的任何地方
    assert json.loads(formatter.format(logging.makeLogRecord({"msg": "x"})))["request_id"] is None


def test_request_id_is_echoed_and_attached_to_every_log_line(
    client: TestClient, auth: Auth, world: World, logs: list[dict]
) -> None:
    h = {**auth("patient1"), "X-Request-ID": "req-7f3a"}
    r = client.post(f"/api/sessions/{world.s_small}/appointments", json={}, headers=h)
    assert r.headers["X-Request-ID"] == "req-7f3a"
    mine = [e for e in logs if e["request_id"] == "req-7f3a"]
    assert [e["msg"] for e in mine] == ["appointment booked", "request"]
    assert mine[0]["patient_id"] == 1 and "王小明" not in json.dumps(mine, ensure_ascii=False)  # 記 id，不記姓名
    assert mine[1]["route"] == "/api/sessions/{id}/appointments" and mine[1]["status"] == 201

    generated = client.get("/healthz").headers["X-Request-ID"]
    assert generated.startswith("req-") and generated != "req-7f3a"
    unsafe = client.get("/healthz", headers={"X-Request-ID": 'x" injected="1'}).headers["X-Request-ID"]
    assert unsafe.startswith("req-")  # 不合格式的外部值不採用

    client.post(f"/api/sessions/{world.s_small}/appointments", json={}, headers=h)  # 重複掛號
    rejected = [e for e in logs if e["msg"] == "request rejected"][-1]
    assert (rejected["level"], rejected["status"], rejected["reason"]) == ("INFO", 409, "already-booked")
    client.post(f"/api/sessions/{world.s_small}/appointments", json={}, headers=auth("doctor1"))
    assert [e for e in logs if e["msg"] == "request rejected"][-1]["level"] == "WARNING"  # 授權拒絕


def test_unexpected_error_is_500_without_internals(
    client: TestClient, auth: Auth, world: World, logs: list[dict], monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(*args: object) -> None:
        raise RuntimeError("connection string postgresql://secret")

    monkeypatch.setattr(BookingService, "list_sessions", boom)
    r = client.get("/api/sessions", params={"doctor_id": 1, "date": "2030-01-01"}, headers=auth("desk1"))
    assert r.status_code == 500 and r.headers["content-type"] == "application/problem+json"
    assert "secret" not in r.text and r.headers["X-Request-ID"] in r.json()["detail"]
    error = next(e for e in logs if e["msg"] == "unhandled error")
    assert error["level"] == "ERROR" and "RuntimeError" in error["exc"]
    assert error["request_id"] == r.headers["X-Request-ID"]  # 從回應的 request id 找得到那筆堆疊


def test_metrics_endpoint(client: TestClient, auth: Auth, world: World) -> None:
    desk = auth("desk1")
    url = f"/api/sessions/{world.s_small}/appointments"
    for pid in (1, 1, 2, 3):  # ok、dup、ok、full
        client.post(url, json={"patient_id": pid}, headers=desk)
    client.get("/api/sessions", params={"doctor_id": 1, "date": world.day.isoformat()}, headers=desk)
    r = client.get("/metrics")  # 不需要登入
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/plain")
    text = r.text
    assert "# TYPE appointments_booked_total counter" in text
    for result in ("ok", "dup", "full"):
        assert f'appointments_booked_total{{result="{result}"}}' in text
    assert 'http_request_duration_seconds_bucket{le="0.1",route="/api/sessions/{id}/appointments"}' in text
    assert 'cache_requests_total{result="miss"}' in text
    assert f"/api/sessions/{world.s_small}/appointments" not in text  # 標籤是路由樣板，不是實際路徑


def test_healthz_and_ready(client: TestClient, app: FastAPI, settings: Settings) -> None:
    assert client.get("/healthz").json() == {"status": "ok"}
    assert client.get("/ready").status_code == 200
    app.state.shutting_down = True  # 收到 SIGTERM 之後的狀態
    assert client.get("/ready").status_code == 503 and client.get("/healthz").status_code == 200

    no_db = settings.model_copy(update={"database_url": "postgresql://clinic@127.0.0.1:1/clinic_test"})
    with TestClient(create_app(no_db)) as down:
        assert down.get("/healthz").status_code == 200  # liveness 不碰資料庫
        r = down.get("/ready")
        assert r.status_code == 503 and r.json()["detail"] == "database unavailable"

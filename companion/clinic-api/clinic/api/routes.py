"""HTTP 介面：把請求轉成 service 呼叫、把結果轉回 HTTP。規則與 SQL 都不在這裡。"""

import asyncio
import hashlib
import json
import logging
from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from clinic.api.deps import Auth, Booking, CurrentUser, booking_rate_limit
from clinic.api.errors import RateLimited, problem
from clinic.api.schemas import (
    AppointmentOut,
    AppointmentPage,
    AppointmentStatus,
    BoardRowOut,
    BookIn,
    LoginIn,
    SessionOut,
    TokenOut,
)
from clinic.db import ping
from clinic.domain import errors as e
from clinic.domain.models import Appointment
from clinic.domain.rules import TPE
from clinic.metrics import APPOINTMENTS_BOOKED, REGISTRY
from clinic.service.booking import Idempotency

log = logging.getLogger(__name__)
API_PREFIX = "/api"  # 前端、Vite proxy、nginx 都用這個前綴，轉送時不改寫路徑
router = APIRouter(prefix=API_PREFIX)
ops = APIRouter()  # 健康檢查與指標：不在 /api 底下、不需要登入；給探針與 Prometheus，不經過前端的 proxy
IDEMPOTENCY_KEY = r"^[\x21-\x7e]{1,255}$"  # 可見的 ASCII 字元，1–255 個（UUID 是 36 個）
BOOKING_RESULT = {e.SessionFull: "full", e.AlreadyBooked: "dup", e.DailyLimitExceeded: "daily_limit"}


@router.post("/auth/login")
def login(body: LoginIn, request: Request, auth: Auth) -> TokenOut:
    allowed, retry_after = request.app.state.login_limiter.check(body.username.lower())  # 以帳號為單位
    if not allowed:
        raise RateLimited(retry_after)
    token = auth.login(body.username, body.password, datetime.now(TPE))
    return TokenOut(access_token=token, expires_in=request.app.state.settings.token_ttl_seconds)


@router.get("/sessions")
def list_sessions(
    user: CurrentUser,
    service: Booking,
    doctor_id: Annotated[int | None, Query(gt=0)] = None,  # 省略：全部醫師
    day: Annotated[date | None, Query(alias="date")] = None,  # 省略：全部日期
) -> list[SessionOut]:
    return [SessionOut.model_validate(s) for s in service.list_sessions(doctor_id, day)]


@router.get("/board")
def board(service: Booking) -> list[BoardRowOut]:
    """報到看板：不需要登入（掛在候診區的電視上），只有診間、醫師與號碼。"""
    return [BoardRowOut.model_validate(r) for r in service.board(datetime.now(TPE))]


def _render(appointment: Appointment) -> dict:
    return AppointmentOut.model_validate(appointment).model_dump(mode="json")


@router.post("/sessions/{id}/appointments", status_code=201, dependencies=[Depends(booking_rate_limit)])
def book(
    id: int,
    body: BookIn,
    request: Request,
    response: Response,
    user: CurrentUser,
    service: Booking,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key", pattern=IDEMPOTENCY_KEY)] = None,
) -> AppointmentOut:
    if user.role == "desk" and body.patient_id is None:
        error = {"type": "missing", "loc": ("body", "patient_id"), "msg": "櫃台掛號必須指定 patient_id"}
        raise RequestValidationError([error])
    idempotency = None
    if idempotency_key is not None:
        canonical = json.dumps({"path": request.url.path, "body": body.model_dump()}, sort_keys=True)
        idempotency = Idempotency(idempotency_key, hashlib.sha256(canonical.encode()).hexdigest())
    try:
        result = service.book(user, id, body.patient_id, _render, idempotency)
    except e.BookingError as exc:
        APPOINTMENTS_BOOKED.labels(result=BOOKING_RESULT.get(type(exc), "other")).inc()
        raise
    appointment = AppointmentOut.model_validate(result.body)
    if result.replayed:
        APPOINTMENTS_BOOKED.labels(result="replayed").inc()
        response.headers["Idempotent-Replayed"] = "true"  # 本專案的約定：這是第一次的結果，沒有新增掛號
        log.info("appointment replayed", extra={"fields": {"appointment_id": appointment.id, "session_id": id}})
    else:
        APPOINTMENTS_BOOKED.labels(result="ok").inc()
        fields = {"appointment_id": appointment.id, "session_id": id, "patient_id": appointment.patient_id}
        log.info("appointment booked", extra={"fields": fields})  # 記內部 id，不記姓名
    response.headers["Location"] = f"{API_PREFIX}/appointments/{appointment.id}"
    return appointment


@router.get("/appointments")
def list_appointments(
    user: CurrentUser,
    service: Booking,
    patient_id: Annotated[int | None, Query(gt=0)] = None,
    status: Annotated[AppointmentStatus | None, Query()] = None,  # 省略：全部狀態
    cursor: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> AppointmentPage:
    items, next_cursor = service.list_visible(user, patient_id, cursor, limit, status)
    return AppointmentPage(items=[AppointmentOut.model_validate(a) for a in items], next_cursor=next_cursor)


@router.get("/appointments/{id}")
def get_appointment(id: int, user: CurrentUser, service: Booking) -> AppointmentOut:
    return AppointmentOut.model_validate(service.get(user, id))


@router.post("/appointments/{id}/cancel")
def cancel(id: int, user: CurrentUser, service: Booking) -> AppointmentOut:
    appointment = service.cancel(user, id, datetime.now(TPE))  # 整個請求只取一次「現在」
    log.info("appointment cancelled", extra={"fields": {"appointment_id": id}})
    return AppointmentOut.model_validate(appointment)


@router.post("/appointments/{id}/check-in")
def check_in(id: int, user: CurrentUser, service: Booking) -> AppointmentOut:
    appointment = service.check_in(user, id)
    log.info("appointment checked in", extra={"fields": {"appointment_id": id}})
    return AppointmentOut.model_validate(appointment)


@ops.get("/healthz", include_in_schema=False)
def healthz() -> dict[str, str]:
    """liveness：不碰外部依賴。資料庫不穩時不能讓所有 Pod 一起被重啟。"""
    return {"status": "ok"}


@ops.get("/ready", include_in_schema=False)
async def ready(request: Request) -> Response:
    """readiness：資料庫 SELECT 1（整體逾時 1 秒）；收到 SIGTERM 之後回 503。"""
    if request.app.state.shutting_down:
        return problem(503, detail="shutting down")
    try:
        await asyncio.wait_for(run_in_threadpool(ping, request.app.state.engine), timeout=1.0)
    except Exception as exc:
        log.warning("readiness check failed", extra={"fields": {"error": type(exc).__name__}})
        return problem(503, detail="database unavailable")
    return Response('{"status":"ready"}', media_type="application/json")


@ops.get("/metrics", include_in_schema=False)
def metrics() -> Response:
    return Response(generate_latest(REGISTRY), media_type=CONTENT_TYPE_LATEST)

"""例外 → Problem Details（RFC 9457）。所有錯誤 body 都從 problem() 這一個函式產生。"""

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from clinic.domain import errors as e

log = logging.getLogger(__name__)
PROBLEM_BASE = "https://clinic.example/problems/"  # type 是識別碼，不一定要能打開

# 業務錯誤一律 409，用 type 區分原因（完整的對照在 docs/contract.md）
BOOKING_PROBLEMS: dict[type[e.BookingError], tuple[str, str]] = {
    e.AlreadyBooked: ("already-booked", "Already booked"),
    e.SessionFull: ("session-full", "Session full"),
    e.DailyLimitExceeded: ("daily-limit", "Daily limit exceeded"),
    e.CancelDeadlinePassed: ("cancel-deadline-passed", "Cancel deadline passed"),
    e.InvalidStatus: ("invalid-status", "Invalid status"),
}
TITLES = {400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
          405: "Method Not Allowed", 422: "Unprocessable Content", 429: "Too Many Requests",
          500: "Internal Server Error", 503: "Service Unavailable"}  # fmt: skip


class RateLimited(Exception):
    def __init__(self, retry_after: int) -> None:
        self.retry_after = retry_after


def problem(
    status: int,
    title: str | None = None,
    code: str | None = None,
    detail: str | None = None,
    headers: dict[str, str] | None = None,
    **extra: Any,
) -> JSONResponse:
    body: dict[str, Any] = {
        "type": PROBLEM_BASE + code if code else "about:blank",
        "title": title or TITLES.get(status, "Error"),
        "status": status,
    }
    if detail:
        body["detail"] = detail
    body.update(extra)
    return JSONResponse(body, status_code=status, headers=headers, media_type="application/problem+json")


def _reject(request: Request, status: int, reason: str, level: int = logging.INFO) -> None:
    # 4xx 是客戶端的問題，記 INFO；授權拒絕記 WARNING（可能是攻擊，也可能是 bug）
    fields = {"status": status, "reason": reason, "path": request.url.path}
    log.log(level, "request rejected", extra={"fields": fields})


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(e.BookingError)
    async def booking_error(request: Request, exc: e.BookingError) -> JSONResponse:
        code, title = BOOKING_PROBLEMS.get(type(exc), ("booking-error", "Booking error"))
        _reject(request, 409, code)
        return problem(409, title, code, detail=str(exc))

    @app.exception_handler(e.NotFound)
    async def not_found(request: Request, exc: e.NotFound) -> JSONResponse:
        # 回應一樣是 404；日誌分得出「真的不存在」與「存在但看不到」，後者是授權拒絕，記 WARNING
        level = logging.WARNING if exc.reason == "not-visible" else logging.INFO
        _reject(request, 404, exc.reason, level)
        return problem(404, detail=str(exc))

    @app.exception_handler(e.IdempotencyKeyReused)
    async def idempotency_key_reused(request: Request, exc: e.IdempotencyKeyReused) -> JSONResponse:
        _reject(request, 422, "idempotency-key-reused")
        return problem(422, "Idempotency key reused", "idempotency-key-reused", detail=str(exc))

    @app.exception_handler(e.PermissionDenied)
    async def forbidden(request: Request, exc: e.PermissionDenied) -> JSONResponse:
        _reject(request, 403, "forbidden", logging.WARNING)
        return problem(403, detail=str(exc))

    @app.exception_handler(e.Unauthenticated)
    async def unauthenticated(request: Request, exc: e.Unauthenticated) -> JSONResponse:
        _reject(request, 401, "unauthenticated")
        return problem(401, detail=str(exc), headers={"WWW-Authenticate": "Bearer"})

    @app.exception_handler(RateLimited)
    async def rate_limited(request: Request, exc: RateLimited) -> JSONResponse:
        _reject(request, 429, "rate-limited")
        detail = f"請求太頻繁，{exc.retry_after} 秒後再試"
        return problem(429, detail=detail, headers={"Retry-After": str(exc.retry_after)})

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = exc.errors()
        if any(err["loc"][0] == "path" for err in errors):  # /appointments/abc：這個路徑上沒有資源
            _reject(request, 404, "not-found")
            return problem(404)
        if any(err["type"] == "json_invalid" or tuple(err["loc"]) == ("body",) for err in errors):
            _reject(request, 400, "bad-request")  # 讀不懂：不是 JSON，或不是 JSON 物件
            return problem(400, detail="body 必須是 JSON 物件")
        _reject(request, 422, "validation-error")  # 讀得懂但內容不對
        # errors 不是 RFC 9457 的標準欄位；格式和前端課的假 API 相同：{ 欄位: [訊息, …] }
        fields: dict[str, list[str]] = {}
        for err in errors:
            name = ".".join(str(p) for p in err["loc"][1:]) or str(err["loc"][0])
            fields.setdefault(name, []).append(err["msg"])
        return problem(422, code="validation-error", detail="欄位格式錯誤", errors=fields)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        # 路由層的 404（未知路徑）與 405（方法不支援）也用同一種格式
        return problem(exc.status_code, headers=dict(exc.headers or {}))

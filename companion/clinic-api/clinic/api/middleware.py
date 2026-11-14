"""最外層的 ASGI middleware：request_id、存取日誌、延遲指標、未預期例外的 500。"""

import logging
import re
import time
import uuid

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from clinic.api.errors import problem
from clinic.logging_setup import request_id_var
from clinic.metrics import HTTP_DURATION

log = logging.getLogger("clinic.access")
SAFE_REQUEST_ID = re.compile(r"[A-Za-z0-9._-]{1,64}")  # 來自外部的值要先檢查才寫進日誌與回應標頭


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = Headers(scope=scope).get("x-request-id", "")
        request_id = incoming if SAFE_REQUEST_ID.fullmatch(incoming) else f"req-{uuid.uuid4().hex[:12]}"
        token = request_id_var.set(request_id)  # 之後這個請求的每一筆日誌都帶得到
        started = time.perf_counter()
        status = 500
        response_started = False

        async def send_with_request_id(message: Message) -> None:
            nonlocal status, response_started
            if message["type"] == "http.response.start":
                status, response_started = message["status"], True
                MutableHeaders(scope=message)["X-Request-ID"] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        except Exception:
            # 未預期的例外：堆疊只寫進日誌，回應不帶內部資訊；用 request_id 對得回來
            log.exception("unhandled error", extra={"fields": {"path": scope["path"]}})
            if not response_started:
                await problem(500, detail=f"內部錯誤，回報時請附上 request id {request_id}")(
                    scope, receive, send_with_request_id
                )
        finally:
            route = scope.get("route")
            template = getattr(route, "path", None) or "unmatched"  # 路由樣板，不是實際路徑
            duration = time.perf_counter() - started
            HTTP_DURATION.labels(route=template).observe(duration)
            fields = {"method": scope["method"], "route": template, "status": status,
                      "duration_ms": round(duration * 1000, 1)}  # fmt: skip
            log.info("request", extra={"fields": fields})
            request_id_var.reset(token)

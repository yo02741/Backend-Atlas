"""建立應用程式：讀設定、建立連線、把 middleware、錯誤處理與路由接起來。"""

import logging
import signal
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from types import FrameType

from fastapi import FastAPI
from redis import Redis

from clinic.api.errors import install_error_handlers
from clinic.api.middleware import RequestContextMiddleware
from clinic.api.rate_limit import RateLimiter
from clinic.api.routes import ops, router
from clinic.config import Settings
from clinic.db import make_engine, make_session_factory
from clinic.logging_setup import configure_logging
from clinic.repository.session_cache import SessionListCache

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    previous = None

    def on_sigterm(signum: int, frame: FrameType | None) -> None:
        app.state.shutting_down = True  # 之後 /ready 回 503
        log.info("SIGTERM received, readiness set to 503")
        if callable(previous):
            previous(signum, frame)  # 交還給 uvicorn：停止接新連線、做完進行中的請求

    try:
        previous = signal.getsignal(signal.SIGTERM)
        signal.signal(signal.SIGTERM, on_sigterm)
    except ValueError:
        pass  # 不在主執行緒（例如測試用的 TestClient）：不接訊號
    yield
    app.state.engine.dispose()
    app.state.redis.close()


def create_app(settings: Settings | None = None) -> FastAPI:
    # 沒有傳入時從環境變數讀；缺必填項就在這裡失敗，行程不會啟動
    settings = settings or Settings()  # type: ignore[call-arg]
    configure_logging(settings.log_level)

    app = FastAPI(title="Clinic API", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.shutting_down = False
    app.state.engine = make_engine(settings.sqlalchemy_url, settings.db_pool_size)
    app.state.session_factory = make_session_factory(app.state.engine)
    # 逾時設短：Redis 掛掉時每個請求最多多等這麼久，然後走降級路徑
    app.state.redis = Redis.from_url(
        settings.redis_url, decode_responses=True, socket_connect_timeout=0.5, socket_timeout=0.5
    )
    app.state.session_cache = SessionListCache(app.state.redis, settings.session_cache_ttl)
    refill_per_sec = 1 / settings.rate_limit_refill_seconds
    app.state.booking_limiter = RateLimiter(
        app.state.redis, "book", settings.rate_limit_capacity, refill_per_sec, on_redis_error="allow"
    )
    app.state.login_limiter = RateLimiter(
        app.state.redis, "login", settings.rate_limit_capacity, refill_per_sec, on_redis_error="local"
    )

    install_error_handlers(app)
    app.add_middleware(RequestContextMiddleware)
    app.include_router(router)
    app.include_router(ops)
    return app

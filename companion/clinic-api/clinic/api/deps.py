"""Composition root：每個請求在這裡把連線、repository、service 組起來。"""

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session as DbSession

from clinic.api.errors import RateLimited
from clinic.api.rate_limit import RateLimiter
from clinic.config import Settings
from clinic.domain.errors import Unauthenticated
from clinic.domain.models import Principal
from clinic.repository.clinic_repo import ClinicRepository
from clinic.service.auth import AuthService
from clinic.service.booking import BookingService

bearer = HTTPBearer(auto_error=False)  # 沒帶標頭時回 None，由這裡決定一律回 401


def get_db(request: Request) -> Iterator[DbSession]:
    with request.app.state.session_factory() as db:  # 請求結束時歸還連線；沒 commit 的交易會 rollback
        yield db


def get_repo(db: Annotated[DbSession, Depends(get_db)]) -> ClinicRepository:
    return ClinicRepository(db)


Repo = Annotated[ClinicRepository, Depends(get_repo)]


def get_auth_service(request: Request, repo: Repo) -> AuthService:
    settings: Settings = request.app.state.settings
    return AuthService(repo, settings.jwt_secret.get_secret_value(), settings.token_ttl_seconds)


def get_booking_service(request: Request, repo: Repo) -> BookingService:
    return BookingService(repo, request.app.state.session_cache)


# ① 驗證：取出憑證 → 驗證 → 載入使用者。需要登入的 endpoint 都依賴它
def get_current_user(
    cred: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    auth: Annotated[AuthService, Depends(get_auth_service)],
) -> Principal:
    if cred is None:
        raise Unauthenticated("需要登入")
    return auth.authenticate(cred.credentials)


CurrentUser = Annotated[Principal, Depends(get_current_user)]
Auth = Annotated[AuthService, Depends(get_auth_service)]
Booking = Annotated[BookingService, Depends(get_booking_service)]


# ② 限流：在驗證身分之後（要知道是誰）、在驗證 body 與碰資料庫的寫入之前
def booking_rate_limit(request: Request, user: CurrentUser) -> None:
    limiter: RateLimiter = request.app.state.booking_limiter
    allowed, retry_after = limiter.check(str(user.id))
    if not allowed:
        raise RateLimited(retry_after)

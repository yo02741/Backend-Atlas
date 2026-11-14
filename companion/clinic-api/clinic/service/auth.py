"""登入與驗證：密碼用 Argon2id 雜湊，登入成功發短效 JWT（HS256）。

角色不寫進 token：每個請求用 token 的 sub 回資料庫讀使用者，停權與角色變更立刻生效。
"""

import secrets
from datetime import datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from clinic.domain.errors import Unauthenticated
from clinic.domain.models import Principal
from clinic.repository.clinic_repo import ClinicRepository

_hasher = PasswordHasher()  # argon2-cffi 的預設參數（Argon2id）
_DUMMY_HASH = _hasher.hash(secrets.token_hex(16))  # 帳號不存在時也跑一次驗證，回應時間不洩漏帳號是否存在
ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


class AuthService:
    def __init__(self, repo: ClinicRepository, secret: str, token_ttl_seconds: int) -> None:
        self.repo = repo
        self.secret = secret
        self.ttl = timedelta(seconds=token_ttl_seconds)

    def login(self, username: str, password: str, now: datetime) -> str:
        user = self.repo.find_user_by_username(username)
        ok = verify_password(user.password_hash if user else _DUMMY_HASH, password)
        if user is None or not ok or not user.is_active:
            raise Unauthenticated("帳號或密碼錯誤")  # 不區分是哪一個錯
        return jwt.encode({"sub": str(user.id), "iat": now, "exp": now + self.ttl}, self.secret, algorithm=ALGORITHM)

    def authenticate(self, token: str) -> Principal:
        try:
            claims = jwt.decode(token, self.secret, algorithms=[ALGORITHM], options={"require": ["exp", "sub"]})
            user = self.repo.find_user(int(claims["sub"]))
        except jwt.ExpiredSignatureError as exc:
            raise Unauthenticated("token 已過期") from exc
        except (jwt.InvalidTokenError, ValueError) as exc:
            raise Unauthenticated("token 無效") from exc
        if user is None or not user.is_active:
            raise Unauthenticated("帳號已停用")
        return Principal(user.id, user.role, user.patient_id, user.doctor_id)

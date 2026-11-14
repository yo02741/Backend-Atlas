"""設定只從環境變數讀（12-factor）。啟動時一次驗證，缺項或格式錯就不啟動。"""

from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


def to_sqlalchemy_url(url: str) -> str:
    """接受一般的 postgresql:// 連線字串，交給 SQLAlchemy 時指定 psycopg 3 driver。"""
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix) :]
    return url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore", hide_input_in_errors=True)  # 錯誤訊息不印出設定值

    database_url: str  # 必填，例：postgresql://clinic:...@localhost:5432/clinic
    jwt_secret: SecretStr = Field(min_length=32)  # 必填；SecretStr 印出來是 **********
    redis_url: str = "redis://localhost:6379/0"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    token_ttl_seconds: int = Field(default=900, ge=60, le=86400)
    session_cache_ttl: int = Field(default=30, ge=1, le=3600)
    rate_limit_capacity: int = Field(default=5, ge=1)
    rate_limit_refill_seconds: float = Field(default=6.0, gt=0)  # 每幾秒補 1 個 token
    db_pool_size: int = Field(default=5, ge=1, le=50)

    @property
    def sqlalchemy_url(self) -> str:
        return to_sqlalchemy_url(self.database_url)

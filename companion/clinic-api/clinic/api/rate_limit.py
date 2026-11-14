"""每位使用者一個 token bucket。狀態放 Redis：「讀 token 數、計算、寫回」用 Lua 腳本一次完成，
時間用 Redis 的 TIME，多個實例才會共用同一個上限。

Redis 無法使用時的降級行為由 on_redis_error 決定：
- "allow"：放行（fail open）。掛號用這個——核心功能不因為 Redis 掛掉而停擺。
- "local"：退回這個行程內的 token bucket。登入用這個——比較保守，但每個實例各算各的。
兩種都會記 WARNING 並累加 redis_errors_total{component="rate_limit"}。
"""

import logging
import math
import threading
import time
from collections.abc import Callable
from typing import Literal

from redis import Redis
from redis.exceptions import RedisError

from clinic.metrics import REDIS_ERRORS

log = logging.getLogger(__name__)

# 被拒絕的請求不扣 token；Retry-After 是整數秒，無條件進位
TOKEN_BUCKET_LUA = """
local capacity, rate = tonumber(ARGV[1]), tonumber(ARGV[2])
local t = redis.call('TIME')
local now = tonumber(t[1]) + tonumber(t[2]) / 1000000
local state = redis.call('HMGET', KEYS[1], 'tokens', 'updated')
local tokens = tonumber(state[1]) or capacity
local updated = tonumber(state[2]) or now
tokens = math.min(capacity, tokens + math.max(0, now - updated) * rate)
local allowed, retry_after = 0, 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  retry_after = math.ceil((1 - tokens) / rate)
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'updated', string.format('%.6f', now))
redis.call('EXPIRE', KEYS[1], math.ceil(capacity / rate) + 1)
return {allowed, retry_after}
"""


class TokenBucket:
    """單一行程內的 token bucket；時鐘從外面傳入，測試不用真的等。"""

    def __init__(self, capacity: int, refill_per_sec: float, clock: Callable[[], float] = time.monotonic) -> None:
        self.capacity = capacity
        self.rate = refill_per_sec
        self.clock = clock
        self.tokens = float(capacity)
        self.updated = clock()

    def _refill(self) -> None:
        now = self.clock()
        self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
        self.updated = now

    def allow(self) -> bool:
        self._refill()
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False

    def retry_after(self) -> float:
        self._refill()
        return 0 if self.tokens >= 1 else (1 - self.tokens) / self.rate


class RateLimiter:
    def __init__(
        self,
        redis: Redis,
        name: str,
        capacity: int,
        refill_per_sec: float,
        on_redis_error: Literal["allow", "local"],
    ) -> None:
        self.name = name
        self.capacity = capacity
        self.rate = refill_per_sec
        self.on_redis_error = on_redis_error
        self._script = redis.register_script(TOKEN_BUCKET_LUA)
        self._local: dict[str, TokenBucket] = {}
        self._lock = threading.Lock()

    def check(self, subject: str) -> tuple[bool, int]:
        """回傳 (是否放行, Retry-After 秒數)。"""
        try:
            allowed, retry_after = self._script(keys=[f"rl:v1:{self.name}:{subject}"], args=[self.capacity, self.rate])
            return bool(allowed), int(retry_after)
        except RedisError as exc:
            REDIS_ERRORS.labels(component="rate_limit").inc()
            fields = {"limiter": self.name, "fallback": self.on_redis_error, "error": type(exc).__name__}
            log.warning("rate limiter unavailable", extra={"fields": fields})
        if self.on_redis_error == "allow":
            return True, 0
        with self._lock:  # sync handler 跑在 thread pool，行程內的 bucket 要上鎖
            bucket = self._local.setdefault(subject, TokenBucket(self.capacity, self.rate))
            if bucket.allow():
                return True, 0
            return False, math.ceil(bucket.retry_after())

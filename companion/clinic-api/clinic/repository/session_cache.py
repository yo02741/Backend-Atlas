"""診次清單的快取（Redis）。只用在顯示；能不能掛號永遠由資料庫那句原子的 UPDATE 決定。

Redis 無法使用時 fail open：get 回 None（當作沒命中，改查資料庫）、set 與 invalidate 略過，
記一筆 WARNING 並累加 redis_errors_total{component="cache"}。
"""

import json
import logging
from dataclasses import asdict
from datetime import date

from redis import Redis
from redis.exceptions import RedisError

from clinic.domain.models import Session
from clinic.metrics import CACHE_REQUESTS, REDIS_ERRORS

log = logging.getLogger(__name__)


class SessionListCache:
    def __init__(self, redis: Redis, ttl: int) -> None:
        self.redis = redis
        self.ttl = ttl

    @staticmethod
    def key(doctor_id: int, day: date) -> str:
        return f"sessions:v1:doctor:{doctor_id}:date:{day.isoformat()}"  # 格式改變時換 v2，舊 key 自然過期

    def _degraded(self, op: str, exc: RedisError) -> None:
        REDIS_ERRORS.labels(component="cache").inc()
        log.warning("cache unavailable", extra={"fields": {"op": op, "error": type(exc).__name__}})

    def get(self, doctor_id: int, day: date) -> list[Session] | None:
        try:
            raw = self.redis.get(self.key(doctor_id, day))
        except RedisError as exc:
            self._degraded("get", exc)
            CACHE_REQUESTS.labels(result="error").inc()
            return None
        if raw is None:  # 用 is None：空清單存成 "[]"，也算命中
            CACHE_REQUESTS.labels(result="miss").inc()
            return None
        CACHE_REQUESTS.labels(result="hit").inc()
        return [Session(**{**d, "session_date": date.fromisoformat(d["session_date"])}) for d in json.loads(raw)]

    def set(self, doctor_id: int, day: date, sessions: list[Session]) -> None:
        try:
            payload = json.dumps([asdict(s) for s in sessions], default=str)  # date 存成 ISO 字串
            self.redis.set(self.key(doctor_id, day), payload, ex=self.ttl)
        except RedisError as exc:
            self._degraded("set", exc)

    def invalidate(self, doctor_id: int, day: date) -> None:
        """失效用刪除而不是更新；呼叫端要在資料庫 COMMIT 之後才呼叫。"""
        try:
            self.redis.delete(self.key(doctor_id, day))
        except RedisError as exc:
            self._degraded("invalidate", exc)  # 刪不掉：舊值最多留到 TTL 到期

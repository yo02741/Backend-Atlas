"""Prometheus 指標。標籤值的種類要有限：不放 patient_id、request_id、實際路徑。"""

from prometheus_client import CollectorRegistry, Counter, Histogram

REGISTRY = CollectorRegistry()

APPOINTMENTS_BOOKED = Counter(
    "appointments_booked_total", "掛號結果（ok／full／dup／daily_limit／replayed）", ["result"], registry=REGISTRY
)
HTTP_DURATION = Histogram("http_request_duration_seconds", "請求延遲；route 是路由樣板", ["route"], registry=REGISTRY)
CACHE_REQUESTS = Counter(
    "cache_requests_total", "診次清單快取讀取結果（hit／miss／error）", ["result"], registry=REGISTRY
)
REDIS_ERRORS = Counter(
    "redis_errors_total", "Redis 無法使用而降級的次數；告警接在這裡", ["component"], registry=REGISTRY
)

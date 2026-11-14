"""一行一筆 JSON 日誌寫到 stdout：帶 request_id，身分證字號集中遮罩。"""

import contextvars
import json
import logging
import re
import sys
from datetime import UTC, datetime
from typing import Any

request_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("request_id", default=None)

# 前後用「不是英數字」判斷，不用 \b：Python 的 \b 把中文字當成字元，「病患A123456789掛號」會抓不到
NATIONAL_ID = re.compile(r"(?<![A-Za-z0-9])[A-Z]\d{9}(?![0-9])")


def mask_national_id(text: str) -> str:
    return NATIONAL_ID.sub(lambda m: m.group()[0] + "*" * 7 + m.group()[-2:], text)


def scrub(value: Any) -> Any:
    if isinstance(value, str):
        return mask_national_id(value)
    if isinstance(value, dict):
        return {k: scrub(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [scrub(v) for v in value]
    return value


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": request_id_var.get(),
        }
        entry.update(getattr(record, "fields", None) or {})  # 事件欄位：extra={"fields": {...}}
        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)
        return json.dumps(scrub(entry), ensure_ascii=False, default=str)


def configure_logging(level: str = "INFO") -> None:
    """只在 root logger 設一個 handler；uvicorn 的 logger 改成往上傳，輸出才會全部是 JSON。"""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True
    logging.getLogger("uvicorn.access").disabled = True  # 存取紀錄由 middleware 寫，才帶得到 request_id

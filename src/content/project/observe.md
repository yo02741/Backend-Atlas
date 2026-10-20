## 這階段要做出什麼

服務上線之後，「有沒有在正常運作」「這位病患說掛號失敗，到底發生什麼事」都要從服務自己吐出來的資料回答。這一階段補上三種資料：

| 種類 | 回答的問題 | 這個系統的做法 |
|---|---|---|
| 日誌 log | 某一個請求發生了什麼 | 一行一筆 JSON 寫到 stdout，帶 `request_id`、`trace_id`；身分證字號一律遮罩 |
| 指標 metrics | 整體狀況如何、有沒有變糟 | 計數器 `appointments_booked_total{result}`、請求延遲直方圖、快取命中數；`/metrics` 用 Prometheus 文字格式輸出 |
| 追蹤 trace | 一個請求在各服務、各步驟花了多少時間 | OpenTelemetry；跨服務用 W3C `traceparent` 標頭傳遞 |

日誌的設定方式在 [日誌、錯誤處理與設定](#/skill/logging-config)；三種訊號的分工與工具在 [可觀測性：log、metrics、trace](#/skill/observability)。

## 設計決策與取捨

### 日誌寫到 stdout，一行一筆 JSON

容器平台會收集每個容器的 stdout，送進集中的日誌系統。應用程式自己寫檔案，就要自己處理輪替、磁碟空間，容器重建時檔案也跟著消失。所以日誌一律寫 stdout（第 7 階段的 `PYTHONUNBUFFERED=1` 讓它即時出現）。

格式用 JSON、一行一筆，日誌系統才能直接依欄位搜尋與統計：「`request_id = req-7f3a` 的所有紀錄」、「過去一小時 `event = booking_failed` 依 `reason` 分組」。純文字的日誌要靠正規表示式解析，格式一改就壞。

每一筆的固定欄位：

| 欄位 | 內容 |
|---|---|
| `ts` | UTC 的 ISO 8601 時間 |
| `level` | `INFO`、`WARNING`、`ERROR` |
| `logger` | 模組名稱 |
| `msg` | 人看的訊息 |
| `request_id` | 這個請求的 id，同一個請求的所有紀錄都相同 |
| 其他 | 事件相關欄位：`appointment_id`、`session_id`、`status`、`duration_ms`… |

### request_id 從哪裡來、怎麼傳

最外層的 middleware 讀請求的 `X-Request-ID` 標頭（如果反向代理已經產生），沒有就自己產生一個，放進 `contextvars.ContextVar`，回應時也寫回 `X-Request-ID` 標頭。日誌的 formatter 從 ContextVar 取值，所以 handler、領域函式、資料庫層都不用一路把 request_id 當參數傳。ContextVar 在 asyncio 裡也能用：每個 task 建立時會複製當下的 context，不同請求的值互不干擾。

用了 OpenTelemetry 之後，`trace_id` 本身就是跨服務的請求識別，日誌裡同時記錄 `trace_id`，就能從一筆錯誤日誌跳到那個請求完整的追蹤。

### 個資：不記錄，遮罩是最後一道防線

日誌會被複製到很多地方（日誌系統、備份、匯出給廠商除錯），存取控制通常比資料庫寬鬆。原則是：

1. **不記錄**：記內部的 `patient_id`，不記姓名、身分證字號、電話；不記錄整個請求 body
2. **集中遮罩**：在 formatter 裡掃過所有字串欄位，符合身分證字號格式的換成 `A*******89`。這是為了接住「某個工程師在除錯時把整個物件印出來」這種意外，而不是用來取代第 1 點
3. **限制存取與保存期限**：內部 id 仍然可以對應回真人，日誌本身也是需要保護的資料

遮罩規則要考慮中文的情況：Python 的 `\b` 會把中文字當成字元，「病患A123456789掛號」裡的身分證字號前後沒有字界，用 `\b` 寫的規則抓不到。驗收題用前後不是英數字的條件來判斷。

### 日誌等級的約定

| 狀況 | 等級 |
|---|---|
| 掛號成功、取消、報到（業務事件） | INFO |
| 業務規則拒絕（409）、驗證失敗（4xx） | INFO，帶 `reason` |
| 授權拒絕 | WARNING（可能是攻擊，也可能是 bug） |
| 未預期的例外（500） | ERROR，帶 `exc` 堆疊 |

4xx 是客戶端的問題，記成 ERROR 會讓真正的錯誤淹沒在大量正常的「名額已滿」裡。

### 指標：標籤的數量要有限

```
appointments_booked_total{result="ok"}       掛號成功
appointments_booked_total{result="full"}     名額已滿
appointments_booked_total{result="dup"}      重複掛號
http_request_duration_seconds_bucket{route="/sessions/{id}/appointments", le="0.1"}
cache_requests_total{result="hit"}
```

每一組不同的標籤值都是一條獨立的時間序列。`result` 只有幾種值沒問題；把 `patient_id` 或 `request_id` 當標籤，時間序列數量會跟著病患數或請求數無限增加，拖垮監控系統。要查單一病患或單一請求，用日誌和追蹤，不用指標。`route` 標籤要用路由樣板（`/sessions/{id}/appointments`），不是實際路徑（`/sessions/12/appointments`），理由相同。

計數器只增不減，服務重啟時歸零；Prometheus 的 `rate()` 會處理這種重設。看「過去 5 分鐘每秒掛號成功數」：

```
rate(appointments_booked_total{result="ok"}[5m])
```

看「掛號請求中名額已滿的比例」可以把兩個 `rate()` 相除。開放掛號的時段這個比例本來就高，告警要針對 5xx 比例或延遲，而不是業務拒絕。

### 追蹤：traceparent

W3C Trace Context 規範的 `traceparent` 標頭格式是：

```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
             版本 trace-id（32 個十六進位）     parent-id（16 個）  旗標
```

API 呼叫其他服務（例如簡訊通知）時帶上這個標頭，對方建立的 span 就會掛在同一個 trace 底下。實務上不用自己組字串，OpenTelemetry 的 SDK 與各框架的自動化套件會處理；需要知道的是，**跨服務時這個標頭要被轉送**，中間經過的代理或自己寫的 HTTP 客戶端不能把它丟掉。

## 關鍵程式

JSON formatter、request_id 與遮罩接在一起。下面這段可以直接執行，輸出就是寫到 stdout 的日誌：

```python run
import contextvars
import json
import logging
import re
import sys
import uuid
from datetime import datetime, timezone

request_id_var = contextvars.ContextVar("request_id", default=None)
NATIONAL_ID = re.compile(r"(?<![A-Za-z0-9])[A-Z]\d{9}(?![0-9])")


def mask(text):
    return NATIONAL_ID.sub(lambda m: m.group()[0] + "*" * 7 + m.group()[-2:], text)


def scrub(v):
    if isinstance(v, str):
        return mask(v)
    if isinstance(v, dict):
        return {k: scrub(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [scrub(x) for x in v]
    return v


class JsonFormatter(logging.Formatter):
    def format(self, record):
        entry = {
            "ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": request_id_var.get(),
        }
        entry.update(getattr(record, "fields", None) or {})
        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)
        return json.dumps(scrub(entry), ensure_ascii=False, default=str)


log = logging.getLogger("clinic.api")
log.handlers.clear()
log.propagate = False
handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(JsonFormatter())
log.addHandler(handler)
log.setLevel(logging.INFO)


def middleware(headers, handle):
    rid = headers.get("X-Request-ID") or f"req-{uuid.uuid4().hex[:8]}"
    token = request_id_var.set(rid)
    try:
        return handle()
    finally:
        request_id_var.reset(token)


def book_handler():
    log.info("booking requested", extra={"fields": {"session_id": 12, "patient_id": 7}})
    log.info("查詢病患 %s 的掛號", "A123456789")                  # 不小心記了身分證字號
    log.info("booking failed", extra={"fields": {"reason": "session-full", "note": "病患B234567890重複點擊"}})
    return 409


middleware({"X-Request-ID": "req-7f3a"}, book_handler)
middleware({}, lambda: log.info("no header, generated id"))
```

計數器的文字格式（`/metrics` 回傳的內容）也很簡單，驗收題要寫的就是這個：

```python run
counts = {("ok",): 27, ("full",): 5, ("dup",): 1}
lines = [
    "# HELP appointments_booked_total 掛號結果",
    "# TYPE appointments_booked_total counter",
]
for (result,), n in sorted(counts.items()):
    lines.append(f'appointments_booked_total{{result="{result}"}} {n}')
print("\n".join(lines))
```

正式專案通常用 `prometheus_client` 這類函式庫產生，不用自己寫；自己寫一次的價值在於知道標籤、跳脫與排序是怎麼回事。

## 常見錯誤與錯誤訊息

**extra 用了保留的名稱。** `logger.info("x", extra={"msg": "..."})` 會直接丟例外：

```
KeyError: "Attempt to overwrite 'msg' in LogRecord"
```

`msg`、`args`、`levelname` 等是 LogRecord 本身的屬性。把事件欄位統一包在 `extra={"fields": {...}}` 裡就不會撞名。

**無法序列化的值。** 欄位裡放了 `datetime` 或 `Decimal`：

```
TypeError: Object of type datetime is not JSON serializable
```

`json.dumps(..., default=str)` 把不認得的型別轉成字串。日誌 formatter 自己丟例外時，logging 會把錯誤印到 stderr，原本那筆紀錄就遺失了。

**日誌重複出現兩次。** 自己的 logger 加了 handler，又沒有關掉 `propagate`，紀錄往上傳到 root logger 再印一次。只在 root logger 設 handler，或設 `propagate = False`。

**用 f-string 組訊息。** `log.debug(f"payload {big_object}")` 即使 DEBUG 沒開，字串也已經組好了。用 `log.debug("payload %s", big_object)`，等級沒開時不會格式化。

**高基數標籤。** 把 `patient_id` 放進指標標籤，監控系統的記憶體隨病患數成長。這個錯誤不會立刻報錯，要到監控系統變慢或費用暴增才發現。

**跨服務時 trace 斷掉。** 自己用 `urllib` 呼叫下游服務，沒有轉送 `traceparent`，下游的 span 變成另一個 trace。用 OpenTelemetry 的 HTTP 客戶端自動化，或手動注入標頭。

## 驗收題在測什麼

**JSON 日誌**：`mask_national_id()` 的格式（含中文緊鄰、不誤遮更長的編號）；輸出是一行合法 JSON、含 `ts`（UTC）、`level`、`logger`、`msg`、`request_id`；request_id 來自 ContextVar，離開後回到 `null`；`extra` 的 fields 合併到最外層；訊息參數與欄位裡的身分證字號都被遮罩，原文不出現在輸出的任何地方；例外的堆疊寫進 `exc`。

**計數器**：累加與查詢；負數與標籤不符時 `ValueError`；`render()` 的 HELP、TYPE、標籤順序、排序、整數格式、結尾換行；沒有標籤的寫法；標籤值的跳脫。

追蹤需要 OpenTelemetry SDK 與收集端，不在瀏覽器驗收範圍內。到這裡，系統從資料表、規則、介面、權限、並行、快取限流、打包部署，到上線後看得見自己的狀態，八個階段都接起來了。

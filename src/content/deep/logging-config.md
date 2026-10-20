## 從一個具體問題開始：客戶給了錯誤代碼，log 裡卻找不到那個請求

客戶回報：「下午 3 點多付款失敗，畫面顯示『系統錯誤』。」服務有 4 台機器、每台 4 個 worker，log 長這樣：

```text
processing order
user not found
processing order
error!!! 'NoneType' object has no attribute 'id'
processing order
done
```

全部是 `print`：沒有時間、沒有是哪個請求、沒有是哪台機器；16 個 worker 的輸出交錯在一起。那行 `error!!!` 只有例外訊息，沒有 traceback，不知道是哪一行出錯。更糟的是，部分時段的 log 根本不見了：容器裡 stdout 不是終端機，Python 會**整塊緩衝**輸出，行程被重啟時緩衝區還沒寫出去的內容就遺失了。

同一週還有另一個事故：新環境部署時，環境變數名稱打成 `DATABSE_URL`。服務照常啟動、健康檢查也通過（它不碰資料庫），程式裡 `os.getenv("DATABASE_URL", "postgresql://localhost/app")` 默默用了預設值，直到第一個真實請求進來才連不上資料庫，而且是在流量已經切過去之後。

這兩個事故對應這一課的三件事：**log 要能查詢（結構化、帶 request id）**、**錯誤要分類處理**、**設定要在啟動時驗證，錯了就不要啟動**。

## logging 模組的四個角色

| 角色 | 決定什麼 | 例子 |
|---|---|---|
| Logger | 誰在記錄；有名字、有階層 | `logging.getLogger("app.orders")` |
| Level | 多重要；低於門檻的直接丟掉 | `DEBUG` 10、`INFO` 20、`WARNING` 30、`ERROR` 40、`CRITICAL` 50 |
| Handler | 寫到哪裡 | `StreamHandler`（stderr／stdout）、`FileHandler` |
| Formatter | 長什麼樣子 | 人看的文字，或一行一個 JSON |

另外還有 Filter：掛在 logger 或 handler 上，可以丟掉某些紀錄，或在紀錄上**加欄位**（request id 就是這樣加進去的）。

### 一筆 log 的路徑

```text
logger = logging.getLogger("app.orders")
logger.info("order created %s", order_id)
   │
   ├─ 1. 等級檢查：INFO >= 這個 logger 的有效等級？（沒設就往上找父 logger 的設定）
   │       不夠 → 直接結束，連字串格式化都不做
   ├─ 2. 建立 LogRecord（時間、logger 名稱、等級、訊息範本、參數、行號、例外資訊）
   ├─ 3. 經過 logger 上的 filter
   ├─ 4. 交給 "app.orders" 自己的 handler
   ├─ 5. propagate=True → 往上交給 "app" 的 handler，再往上到 root 的 handler
   │
   └─ 每個 handler：自己的等級檢查 → 自己的 filter → formatter 格式化 → 寫出
```

由此可以推出幾個實務規則：

- **每個模組用 `logging.getLogger(__name__)`**，logger 名稱就是模組路徑（`app.orders`），之後可以按模組調整等級，例如只把 `sqlalchemy.engine` 開到 INFO 看 SQL。
- **handler 只在應用程式入口設定一次**，掛在 root 或最上層的 logger 上；各模組只負責 `getLogger`，不加 handler。在子 logger 和 root 都掛了 handler，同一筆 log 會印兩次。
- **訊息用 `%s` 範本加參數**：`logger.info("order created %s", order_id)`。等級不夠時不會格式化；log 系統也能依同一個範本歸類，而 f-string 每次都是不同的字串。
- **在 `except` 裡用 `logger.exception(...)`**：等級是 ERROR，並自動附上完整 traceback。

完全沒設定任何 handler 時，`logging` 會用一個「最後手段」的 handler，把 WARNING 以上的訊息印到 stderr，只有訊息本身、沒有時間與等級。看到 log 只有光禿禿的訊息、INFO 全部不見，通常就是忘了設定。

### 為什麼不用 print

| | `print` | `logging` |
|---|---|---|
| 等級 | 沒有，只能全開或全關 | DEBUG～CRITICAL，可以依模組調整 |
| 時間、來源 | 自己加 | Formatter 統一加：時間、logger 名稱、行號、行程 ID |
| traceback | `print(e)` 只有訊息 | `logger.exception` 附完整 traceback |
| 輸出時機 | stdout 在非終端機時整塊緩衝，當機時可能遺失 | `StreamHandler` 每筆紀錄寫完就 flush |
| 結構化欄位 | 自己拼字串 | `extra={...}` 或 Filter 加欄位，交給 JSON formatter |
| 第三方套件 | 無法統一 | uvicorn、SQLAlchemy、httpx 都用 logging，一套設定管全部 |

在容器裡跑 Python 時，也常設 `PYTHONUNBUFFERED=1`，讓真的有用到 `print` 的地方（或第三方套件）不被緩衝。

## 結構化日誌與 request id

正式環境的 log 是給機器查詢的：一行一個 JSON，每個欄位都能過濾與聚合。

```json
{"ts": "2026-10-20T07:12:03.481Z", "level": "ERROR", "logger": "app.payments", "msg": "payment failed",
 "request_id": "9f2c41e0", "user_id": 1042, "path": "/orders/88/pay", "duration_ms": 1832, "exc": "Traceback ..."}
```

有了 `request_id`，客戶畫面上顯示的那串代碼，就能在 log 系統裡一次撈出這個請求在所有 worker、所有服務留下的每一行。做法：

1. **middleware 在請求開始時決定 request id**：上游（負載平衡器、API gateway、前端）有帶 `X-Request-ID` 就沿用，沒有就產生一個。
2. **存進 `contextvars.ContextVar`**：它對每個請求（每個 asyncio task、每個執行緒）各自獨立，並行的請求不會互相覆蓋。
3. **一個 logging Filter 把它加到每筆 LogRecord 上**：程式其他地方完全不用傳 request id。
4. **寫進回應標頭**，錯誤回應的 body 也帶上，客戶回報時就有線索。
5. **呼叫下游服務時往下傳**，讓跨服務的紀錄串得起來；更完整的做法是分散式追蹤（例如 W3C Trace Context 的 `traceparent` 標頭，見 [可觀測性：log、metrics、trace](#/skill/observability)）。

不要記進 log 的東西：密碼、token、完整的信用卡號、身分證字號；email、電話視規範遮罩。log 會被很多人、很多系統讀取，保存得也比資料庫久，細節見 [日誌與稽核紀錄裡的個資](#/skill/logs-pii)。

## 錯誤分三類處理

| 類型 | 例子 | 回應 | log |
|---|---|---|---|
| 預期內的商業錯誤 | 商品售完、找不到訂單、權限不足 | 4xx，清楚的錯誤代碼與訊息 | INFO 或 WARNING，不附 traceback，不告警 |
| 驗證錯誤 | 欄位型別錯、缺必填 | 422，列出每個欄位 | 通常不記，或 DEBUG |
| 預期外的例外 | `AttributeError`、資料庫斷線、bug | 500，只回通用訊息與 request id | `logger.exception`：ERROR 加完整 traceback，觸發告警 |

關鍵在第三類：traceback 只進 log，**不回給客戶端**（裡面有檔案路徑、SQL、甚至設定值）。客戶端拿到的是 `{"error": "internal_error", "request_id": "9f2c41e0"}`，工程師用 request id 查到完整內容。全域例外處理器在框架裡的位置見 [Web 框架與請求生命週期](#/skill/web-framework)。

## 設定：從環境變數來、啟動時驗證

12-factor 的原則是**設定與程式碼分開**：同一個映像檔，靠環境變數決定連哪個資料庫、log 等級、外部服務的金鑰，跑在 dev、staging、prod。secret 不寫進程式碼、不進 repo（完整討論見 [環境設定與 12-factor](#/skill/config-12factor)）。

讀設定的正確姿勢：

- **集中在一個地方、啟動時讀一次**，轉成有型別的設定物件；程式其他地方不直接 `os.getenv`。
- **必填的就是必填**，不給「看起來合理」的預設值：`DATABASE_URL` 沒設就是錯，預設成 localhost 只會讓錯誤延後出現。
- **一次回報所有問題**：缺三個變數就列出三個，不要修一個、重新部署、再發現下一個。
- **驗證失敗就讓行程以非零狀態結束**。新版本起不來，滾動更新就會卡住、舊版本繼續服務（Kubernetes 上會看到 Pod 反覆重啟的 `CrashLoopBackOff`），而不是讓壞掉的版本接到流量。

用 pydantic-settings 時（需要安裝套件，不能在瀏覽器執行）：

```python
from pydantic import Field, PostgresDsn, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # 環境變數名稱不分大小寫對應到欄位：DATABASE_URL → database_url
    model_config = SettingsConfigDict(env_file=".env")   # .env 只給本機開發用，不進版控

    database_url: PostgresDsn                             # 必填，而且要是 PostgreSQL 的 URL
    port: int = 8000
    log_level: str = Field(default="INFO", pattern="^(DEBUG|INFO|WARNING|ERROR)$")
    payment_api_key: SecretStr                            # 印出來是 '**********'


settings = Settings()   # 在應用程式啟動時建立；驗證失敗會丟 ValidationError，行程就此結束
```

缺 `DATABASE_URL`、`PORT=abc`、`LOG_LEVEL=verbose` 時，啟動就會失敗，而且一次列出全部：

```text
pydantic_core._pydantic_core.ValidationError: 3 validation errors for Settings
database_url
  Field required [type=missing, input_value={'port': 'abc', 'log_level': 'verbose'}, input_type=dict]
port
  Input should be a valid integer, unable to parse string as an integer [type=int_parsing, input_value='abc', input_type=str]
log_level
  String should match pattern '^(DEBUG|INFO|WARNING|ERROR)$' [type=string_pattern_mismatch, input_value='verbose', input_type=str]
```

## 實際程式

### logger 階層、等級與 traceback

```python run
import logging
import sys

# 只在應用程式入口設定一次：handler 掛在最上層的 "shop"
app_logger = logging.getLogger("shop")
app_logger.handlers.clear()                     # 讓這段可以重複執行
app_logger.propagate = False                    # 這個示範不往 root 傳
handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s", "%H:%M:%S"))
app_logger.addHandler(handler)
app_logger.setLevel(logging.INFO)

# 各模組只拿 logger，不加 handler；紀錄會往上傳到 "shop" 的 handler
orders_log = logging.getLogger("shop.orders")
db_log = logging.getLogger("shop.db")

orders_log.debug("看不到：DEBUG < INFO")
orders_log.info("order created id=%s qty=%s", 88, 2)
db_log.warning("slow query took %.0f ms", 1830.5)

# 只把某個模組開到 DEBUG，不影響其他模組
db_log.setLevel(logging.DEBUG)
db_log.debug("SELECT * FROM orders WHERE id = %s", 88)
orders_log.debug("仍然看不到")

# 等級不夠時，參數根本不會被轉成字串
class Expensive:
    def __str__(self):
        print("  （__str__ 被呼叫了）")
        return "expensive"
orders_log.debug("lazy: %s", Expensive())        # 什麼都沒發生
orders_log.info("lazy: %s", Expensive())         # 真的要輸出才格式化

# except 裡用 logger.exception：等級 ERROR，附完整 traceback
def charge(order):
    return order["user"]["id"]

try:
    charge({"user": None})
except Exception:
    orders_log.exception("charge failed order_id=%s", 88)
```

### JSON log、request id 與錯誤分類

```python run
import asyncio
import contextvars
import json
import logging
import sys
import uuid
from datetime import datetime, timezone

request_id_var = contextvars.ContextVar("request_id", default="-")

class RequestIdFilter(logging.Filter):
    # 每筆紀錄自動帶上目前請求的 request id，程式其他地方不用傳
    def filter(self, record):
        record.request_id = request_id_var.get()
        return True

class JsonFormatter(logging.Formatter):
    def format(self, record):
        data = {
            "ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": getattr(record, "request_id", "-"),
        }
        for key in ("user_id", "path", "status", "duration_ms"):   # extra= 傳進來的欄位
            if hasattr(record, key):
                data[key] = getattr(record, key)
        if record.exc_info:
            data["exc"] = self.formatException(record.exc_info).splitlines()[-1]   # 示範只留最後一行
        return json.dumps(data, ensure_ascii=False)

log = logging.getLogger("api")
log.handlers.clear()
log.propagate = False
h = logging.StreamHandler(sys.stdout)
h.addFilter(RequestIdFilter())
h.setFormatter(JsonFormatter())
log.addHandler(h)
log.setLevel(logging.INFO)

class NotFound(Exception):
    pass

async def handler(path):
    await asyncio.sleep(0.01)
    if path == "/orders/404":
        raise NotFound("order 404 not found")
    if path == "/orders/bug":
        return {}["user"]                       # 預期外的 bug
    log.info("order loaded", extra={"user_id": 1042})
    return {"ok": True}

async def middleware(path, incoming_request_id=None):
    # 沿用上游給的 X-Request-ID，沒有就產生一個；存進 contextvar
    request_id_var.set(incoming_request_id or uuid.uuid4().hex[:8])
    loop = asyncio.get_running_loop()
    start = loop.time()
    try:
        await handler(path)
        status = 200
    except NotFound as e:                       # 預期內：WARNING，不附 traceback
        status = 404
        log.warning(str(e))
    except Exception:                           # 預期外：ERROR + traceback，客戶端只拿到 request id
        status = 500
        log.exception("unhandled error")
    log.info("request done", extra={"path": path, "status": status,
                                    "duration_ms": round((loop.time() - start) * 1000)})
    return status, request_id_var.get()

# 三個請求同時處理：log 交錯，但每一行的 request_id 都正確
results = await asyncio.gather(
    middleware("/orders/1", "from-gateway-01"),
    middleware("/orders/404"),
    middleware("/orders/bug"),
)
print("\n回應（status, X-Request-ID）：", results)
```

`asyncio.gather` 會把每個協程包成 task，task 建立時複製當下的 context，所以三個請求各自 `set` 的 request id 互不干擾。執行緒池（`asyncio.to_thread`）同樣會複製 context。

### 啟動時驗證設定，錯了就不啟動

```python run
from dataclasses import dataclass, field

class ConfigError(Exception):
    pass

@dataclass(frozen=True)
class Settings:
    database_url: str
    port: int
    log_level: str
    debug: bool
    payment_api_key: str = field(repr=False)    # secret：不出現在 repr 與 log 裡

LEVELS = {"DEBUG", "INFO", "WARNING", "ERROR"}

def load_settings(env: dict) -> Settings:
    """env 在真實程式裡是 os.environ。所有問題收集起來一次回報。"""
    errors = []

    def required(name):
        value = env.get(name, "").strip()
        if not value:
            errors.append(f"{name}: 必填")
        return value

    database_url = required("DATABASE_URL")
    if database_url and not database_url.startswith(("postgresql://", "postgres://")):
        errors.append("DATABASE_URL: 要是 postgresql:// 開頭")
    api_key = required("PAYMENT_API_KEY")

    port_raw = env.get("PORT", "8000")
    try:
        port = int(port_raw)
        if not 1 <= port <= 65535:
            raise ValueError
    except ValueError:
        errors.append(f"PORT: 要是 1～65535 的整數（收到 {port_raw!r}）")
        port = 0

    log_level = env.get("LOG_LEVEL", "INFO").upper()
    if log_level not in LEVELS:
        errors.append(f"LOG_LEVEL: 要是 {sorted(LEVELS)} 之一（收到 {log_level!r}）")

    debug = env.get("DEBUG", "false").lower() in {"1", "true", "yes"}

    if errors:
        raise ConfigError("設定有誤，服務不啟動：\n  " + "\n  ".join(errors))
    return Settings(database_url, port, log_level, debug, api_key)

def main(env):
    try:
        settings = load_settings(env)
    except ConfigError as e:
        print(e)
        return 1                                 # 真實程式：sys.exit(1)，部署系統看到非零狀態
    print("啟動：", settings)                      # payment_api_key 不會被印出
    return 0

good = {"DATABASE_URL": "postgresql://app@db:5432/shop", "PAYMENT_API_KEY": "sk_test_123", "PORT": "8080"}
typo = {"DATABSE_URL": "postgresql://app@db:5432/shop", "PORT": "80a", "LOG_LEVEL": "verbose"}

print("exit code =", main(good), "\n")
print("exit code =", main(typo))
```

## 常見錯誤與錯誤訊息

**參數數量和範本對不上**：

```text
--- Logging error ---
Traceback (most recent call last):
  ...
TypeError: not all arguments converted during string formatting
Call stack:
  ...
Message: 'user'
Arguments: (42,)
```

`logger.warning("user", 42)`：範本裡沒有 `%s`，卻多給了參數。logging 不會讓程式因此中斷，而是把這段錯誤印到 stderr，原本的訊息就沒記到。`Message` 與 `Arguments` 兩行直接指出是哪一筆；範本寫 `%d` 卻傳了字串，則會看到 `TypeError: %d format: a real number is required, not str`。

**`extra` 用了保留的欄位名稱**：

```text
KeyError: "Attempt to overwrite 'message' in LogRecord"
```

`extra={"message": …}` 或 `"asctime"` 等名稱和 LogRecord 本身的屬性衝突，這個會直接丟例外。換個名稱，例如 `detail`。

| 現象 | 原因 | 怎麼修 |
|---|---|---|
| 每行 log 印兩次 | 子 logger 和 root 都掛了 handler，紀錄往上傳又印一次；或設定函式被呼叫兩次 | handler 只掛在一處；必要時對子 logger 設 `propagate = False` |
| INFO 全部不見，只剩光禿禿的 WARNING 訊息 | 沒有設定任何 handler，用到了「最後手段」handler | 在入口設定 handler 與等級 |
| `logging.basicConfig(...)` 好像沒作用 | root 已經有 handler（被某個套件或之前的呼叫設定過）時，`basicConfig` 什麼都不做 | 改用 `logging.config.dictConfig`，或 `basicConfig(force=True)`（3.8+） |
| uvicorn 的存取 log 格式和自己的不一樣 | uvicorn 用自己的 `uvicorn`、`uvicorn.access`、`uvicorn.error` logger 與設定 | 用 uvicorn 的 `--log-config` 或在 dictConfig 裡一併設定這幾個 logger |
| 容器裡的 log 延遲出現或當機時遺失 | stdout 在非終端機時整塊緩衝 | 用 logging；或設 `PYTHONUNBUFFERED=1` |
| 服務啟動成功，第一個請求才說連不上資料庫 | 設定有預設值或延遲讀取，打錯的變數名稱沒被發現 | 必填設定沒有預設值，啟動時就驗證 |

## 動手

1. 執行「logger 階層」那段，把 `app_logger.setLevel` 改成 `logging.WARNING`，預測哪些行會消失；再把 `db_log.setLevel(logging.DEBUG)` 那行刪掉看看。
2. 執行「JSON log」那段，在 `JsonFormatter` 加上 `"module": record.module` 與 `"line": record.lineno`；把 `exc` 改成完整的 traceback，想想 traceback 放進 JSON 的一個欄位，比多行文字好查在哪裡。
3. 執行「啟動時驗證」那段，替 `typo` 補上缺的變數，一次修完所有錯誤；再加一條規則「`DEBUG=true` 時 `DATABASE_URL` 不能指向名稱含 `prod` 的主機」。
4. 程式題 [從環境變數讀設定並驗證](#/exercise/logging-config-1)：實作 `load_settings`。
5. 延伸：設定與 secret 在部署流程裡怎麼管理，見 [環境設定與 12-factor](#/skill/config-12factor)；log 怎麼集中收集與告警，見 [可觀測性：log、metrics、trace](#/skill/observability)。

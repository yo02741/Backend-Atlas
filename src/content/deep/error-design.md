## 從一個具體問題開始：前端在解析錯誤訊息的字串

註冊 API 遇到重複的 Email 時，伺服器沒有特別處理，例外一路往上冒，最後回給瀏覽器的是：

```http
HTTP/1.1 500 Internal Server Error
Content-Type: text/plain

psycopg.errors.UniqueViolation: duplicate key value violates unique constraint "users_email_key"
DETAIL:  Key (email)=(a@example.com) already exists.
```

前端為了顯示「這個 Email 已經註冊過」，寫了 `if (body.includes("users_email_key"))`。接著：

- 資料庫的約束名稱、資料表結構、使用的驅動，全都公開給任何會打開開發者工具的人。
- 監控把它算成 500，半夜告警響了，但其實是使用者正常的操作。
- 某天 DBA 把約束改名成 `uq_users_email`，前端的判斷失效，所有人都只看到「發生錯誤」。

錯誤也是 API 的一部分，需要和成功回應一樣設計：**分清楚是哪一種錯誤**、**用穩定的格式與代碼回應**、**只說使用者該知道的事**、**讓維運能從回應追到 log**。

## 兩種錯誤：預期內的，與程式錯誤

| | 預期內的錯誤 | 程式錯誤（bug） |
|---|---|---|
| 例子 | Email 已註冊、餘額不足、找不到訂單、輸入格式不對、沒有權限 | `KeyError`、`AttributeError: 'NoneType' ...`、SQL 語法錯、資料庫連不上 |
| 誰能處理 | 使用者或前端：換個 Email、補欄位、重新登入 | 只有開發者能修 |
| HTTP 狀態 | 4xx | 5xx |
| 回應內容 | 具體說明哪裡不對、怎麼改 | 一句「伺服器錯誤」，加上 request id |
| 日誌 | info 或 warning，不必附 stack trace | error，完整 stack trace，觸發告警 |

處理方式也不一樣：

- **預期內的錯誤**用明確的例外類別表達（`EmailTaken`、`InsufficientBalance`），在業務邏輯裡丟出，在邊界轉成 HTTP 回應。
- **程式錯誤不要在中間接住**。`try: ... except Exception: return None` 會把 bug 變成一個靜悄悄的錯誤結果，往後擴散。讓它往上冒到最外層的全域處理器，由它統一回 500、記錄 stack trace。

只在「知道怎麼處理」的地方 `except`，而且只接你預期的那種例外。

## 例外階層：讓類別帶著語意

自訂一個應用程式的基底例外，往下依「HTTP 上的意義」分大類，再依業務細分：

```text
AppError                      500  internal_error
├── NotFound                  404  not_found
│   └── OrderNotFound         404  order_not_found
├── Conflict                  409  conflict
│   └── EmailTaken            409  email_taken
├── PermissionDenied          403  permission_denied
└── ValidationFailed          422  validation_failed
```

- 每個類別帶三樣東西：**HTTP 狀態**、**穩定的錯誤代碼**、**一句給人看的標題**。邊界的轉換程式只要讀這三個屬性，新增錯誤種類不必改轉換程式。
- 細分的類別繼承大類，所以 `except NotFound` 也接得到 `OrderNotFound`；前端如果不認得 `order_not_found`，至少能依 404 處理。
- **基礎設施的例外在 repository 邊界翻譯**。資料庫丟出的唯一鍵衝突，在 repository 裡接住、改丟 `EmailTaken`，並用 `raise EmailTaken(...) from e` 保留原本的例外（`__cause__`），log 裡還看得到根本原因。service 與 handler 都不需要知道 `psycopg.errors.UniqueViolation` 這個名字。
- 業務邏輯裡丟的是領域例外，不是 `HTTPException`。這樣同一個 service 被批次工作或 CLI 呼叫時，錯誤依然有意義（見 [專案分層與依賴注入](#/skill/project-layering)）。

## 在邊界轉成 HTTP 狀態碼

常用的狀態碼與它們的意思：

| 狀態碼 | 意思 | 例子 |
|---|---|---|
| `400 Bad Request` | 請求本身壞掉，伺服器無法理解 | JSON 語法錯誤 |
| `401 Unauthorized` | **沒有通過認證**：沒帶 token、token 過期或無效 | 未登入 |
| `403 Forbidden` | 認證過了，但**沒有權限** | 一般會員呼叫管理員 API |
| `404 Not Found` | 資源不存在（或不想讓對方知道它存在） | 查別人的訂單 |
| `409 Conflict` | 和資源目前的狀態衝突 | Email 已註冊、訂單已出貨不能取消 |
| `422 Unprocessable Content` | 格式正確，但內容不合規則 | Email 格式錯、數量為負數 |
| `429 Too Many Requests` | 超過速率限制 | 搭配 `Retry-After` 標頭 |
| `500 Internal Server Error` | 伺服器的 bug | 任何未預期的例外 |
| `503 Service Unavailable` | 暫時無法服務 | 維護中、下游掛掉，可搭配 `Retry-After` |

兩個常見的誤用：用 `200` 加上 `{"success": false}` 回錯誤（監控、快取、HTTP client 的重試邏輯全都會誤判成成功）；以及把使用者的輸入錯誤回成 `500`（告警被正常流量淹沒）。

## Problem Details（RFC 9457）

每個 API 自己發明錯誤格式，前端就要為每個服務寫一套解析。**RFC 9457「Problem Details for HTTP APIs」**定義了一個通用的錯誤格式，它在 2023 年取代了 RFC 7807，主要差異包括新增常見問題類型的註冊表、補充一次回報多個問題的寫法；欄位與媒體類型沿用。

回應的 `Content-Type` 是 `application/problem+json`，內容是一個 JSON 物件，標準欄位都是選填：

| 欄位 | 意思 | 規則 |
|---|---|---|
| `type` | 問題類型的 URI，類型的**主要識別** | 省略時視為 `about:blank`；用可以打開的網址時，最好指向說明文件 |
| `title` | 問題類型的簡短說明 | 同一種類型每次都一樣（翻譯除外），不放這一次的細節 |
| `status` | HTTP 狀態碼 | 只是方便閱讀，必須和實際回應的狀態碼相同 |
| `detail` | **這一次**發生了什麼、怎麼修正 | 給人看的；客戶端不應該解析它來取得資訊 |
| `instance` | 識別**這一次**事件的 URI | 常見做法是放請求的路徑 |

需要更多資訊時可以加**擴充欄位**，客戶端遇到不認得的欄位要忽略。RFC 9457 的範例用 `errors` 陣列一次回報多個欄位錯誤，每一筆有 `detail` 與指向欄位位置的 `pointer`（JSON Pointer，例如 `#/email`）：

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json
X-Request-ID: 7f3a9c21

{
  "type": "https://example.com/problems/validation_failed",
  "title": "輸入資料不正確",
  "status": 422,
  "instance": "/users",
  "code": "validation_failed",
  "request_id": "7f3a9c21",
  "errors": [
    {"pointer": "#/email", "detail": "格式不正確"},
    {"pointer": "#/age", "detail": "必須是正整數"}
  ]
}
```

### 穩定的錯誤代碼

前端要依錯誤種類決定行為（顯示哪段文字、要不要導去登入、哪個欄位標紅），判斷的依據必須**穩定**：

- `type` 本身就是規格裡的識別，可以直接用。
- 很多團隊另外加一個短的 `code` 擴充欄位（`email_taken`），和 `type` 一對一，前端寫 `switch (body.code)` 比較方便。這是常見慣例，不是 RFC 的要求。
- 代碼一旦公開就當成 API 合約：可以新增，不要改名或改意思。
- **不要讓前端依 `detail` 或 `title` 的文字判斷**。文字會改、會翻譯。

### 不要把內部資訊回給使用者

`detail` 寫的是使用者能採取的行動（「這個 Email 已經註冊過，可以直接登入或重設密碼」），不是內部原因。下列東西不出現在回應裡：例外的原始訊息、stack trace、SQL 與資料表名稱、檔案路徑、內部主機名稱、框架版本。它們幫不了使用者，卻能幫攻擊者了解系統。框架的除錯模式（會在錯誤頁顯示 stack trace）只能在本機開。

## 實際程式：例外階層與邊界轉換

下面這段把三種情況跑一次：預期內的衝突、輸入驗證失敗、程式 bug。注意 bug 的那一次，log 裡有完整原因，回應裡卻只有通用訊息與 request id。

```python run
import json
import traceback
import uuid


# ---- 例外階層：每一類對應一個 HTTP 狀態與一個穩定的錯誤代碼 ----
class AppError(Exception):
    status = 500
    code = "internal_error"
    title = "伺服器發生錯誤"

    def __init__(self, detail: str | None = None, **extra):
        super().__init__(detail or self.title)
        self.detail = detail
        self.extra = extra                   # 擴充欄位，例如 errors


class NotFound(AppError):
    status, code, title = 404, "not_found", "找不到資源"

class Conflict(AppError):
    status, code, title = 409, "conflict", "與目前狀態衝突"

class EmailTaken(Conflict):
    code, title = "email_taken", "Email 已被註冊"

class ValidationFailed(AppError):
    status, code, title = 422, "validation_failed", "輸入資料不正確"


PROBLEM_BASE = "https://example.com/problems/"      # 虛構的網域；正式環境換成自己的文件網址


def to_problem(exc: Exception, path: str, request_id: str) -> tuple[int, dict, dict]:
    """在邊界把例外轉成 (狀態碼, 標頭, Problem Details 內容)。"""
    if not isinstance(exc, AppError):
        # 未預期的錯誤：換成通用的 500，原本的訊息一個字都不回
        exc = AppError("請稍後再試；回報問題時請附上 request_id")
    body = {"type": PROBLEM_BASE + exc.code, "title": exc.title, "status": exc.status}
    if exc.detail:
        body["detail"] = exc.detail
    body |= {"instance": path, "code": exc.code, "request_id": request_id, **exc.extra}
    headers = {"Content-Type": "application/problem+json", "X-Request-ID": request_id}
    return exc.status, headers, body


# ---- 模擬「請求進來 → 執行 → 出錯就轉換」的邊界 ----
def log(level, **fields):
    print("LOG", json.dumps({"level": level, **fields}, ensure_ascii=False))

def handle(path, func):
    request_id = uuid.uuid4().hex[:8]
    try:
        return 200, {}, func()
    except AppError as e:                     # 預期內：記 info，不需要 stack trace
        log("info", request_id=request_id, path=path, code=e.code)
        return to_problem(e, path, request_id)
    except Exception as e:                    # 程式錯誤：完整記錄，但不回給使用者
        log("error", request_id=request_id, path=path, exc=type(e).__name__, msg=str(e),
            stack=traceback.format_exc().splitlines()[-3:])
        return to_problem(e, path, request_id)


def register():
    raise EmailTaken("這個 Email 已經註冊過，可以直接登入或重設密碼")

def bad_input():
    raise ValidationFailed(errors=[{"pointer": "#/email", "detail": "格式不正確"},
                                   {"pointer": "#/age", "detail": "必須是正整數"}])

def buggy():
    prices = {"basic": 990}
    return prices["premium"]                  # KeyError：這是 bug

for path, f in (("/users", register), ("/users", bad_input), ("/plans/premium", buggy)):
    status, headers, body = handle(path, f)
    print(status, headers["Content-Type"])
    print(json.dumps(body, ensure_ascii=False, indent=2))
    print()
```

在 FastAPI 裡，同樣的轉換寫成例外處理器（需要 FastAPI，不能在瀏覽器裡跑）：

```python
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

app = FastAPI()

def problem(status, body, request_id):
    return JSONResponse(body, status_code=status, media_type="application/problem+json",
                        headers={"X-Request-ID": request_id})

@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    status, _, body = to_problem(exc, request.url.path, request.state.request_id)
    return problem(status, body, request.state.request_id)

# FastAPI 預設的 422 格式是 {"detail": [...]}；改成 Problem Details，前端只需要一套解析
@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    errors = [{"pointer": "#/" + "/".join(str(p) for p in e["loc"][1:]), "detail": e["msg"]}
              for e in exc.errors()]
    status, _, body = to_problem(ValidationFailed(errors=errors), request.url.path, request.state.request_id)
    return problem(status, body, request.state.request_id)
```

`request.state.request_id` 假設有一個 middleware 先產生或沿用 `X-Request-ID`（見 [日誌、錯誤處理與設定](#/skill/logging-config)）。未預期例外的處理器可以註冊在 `Exception` 上；它在 middleware 堆疊的哪一層執行、回應之後例外是否還會往上交給伺服器記錄，依 Starlette 版本而定，上線前實際觸發一次 bug，確認 log 只出現一次、內容完整。

## 錯誤與日誌：用 request id 串起來

使用者看到的只有「伺服器錯誤」，維運要能從這一句找到原因。做法是讓每個請求有一個 **request id**：

1. 最外層的 middleware 讀取上游（負載平衡器、API gateway）傳來的 `X-Request-ID`，沒有就產生一個。
2. 這個 id 寫進該請求的**每一行 log**。
3. 回應的標頭與錯誤內容都帶著它。
4. 使用者或前端回報問題時附上 id，維運在 log 系統直接搜尋，就能看到這個請求從進來到出錯的完整過程與 stack trace。

日誌等級跟著錯誤種類走：

- 4xx（預期內）：info 或 warning。它們是正常流量的一部分；如果某種 4xx 突然暴增（例如 401），用指標監控比用告警適合。
- 5xx（bug、下游故障）：error，附 stack trace，觸發告警。
- 記錄時避開敏感資料：密碼、token、完整的信用卡號、身分證字號都不寫進 log。

## 常見錯誤與錯誤訊息

| 現象 | 原因 | 怎麼修 |
|---|---|---|
| 回應內容出現 `Traceback (most recent call last)` 或 SQL 錯誤原文 | 沒有全域例外處理器，或正式環境開著除錯模式 | 註冊 catch-all 處理器回通用 500；確認除錯模式只在本機開 |
| 前端用 `message.includes(...)` 判斷錯誤種類 | 回應沒有穩定的代碼 | 加 `type` / `code`，前端依代碼判斷 |
| 監控 500 很多，查下去全是使用者輸入錯誤 | 預期內的錯誤沒被分類，落到預設的 500 | 為它們定義例外類別並對應到 4xx |
| 錯誤回應是 `200` 加 `{"success": false}` | 用 body 表達失敗 | 用正確的狀態碼；body 用 Problem Details |
| log 裡的錯誤只有 `KeyError: 'premium'`，不知道是哪個請求 | log 沒有帶 request id | middleware 產生 id，寫進每行 log 與回應標頭 |
| 每個函式都 `try/except Exception` 再 `return None` | 在中間吞掉程式錯誤 | 只接預期的例外，其他的讓它冒到全域處理器 |
| 從 repository 丟出來的錯誤，log 裡看不到資料庫的原始錯誤 | 翻譯例外時沒有保留原因 | 用 `raise DomainError(...) from e` |
| 客戶端遇到錯誤就無限重試 | 沒有區分可重試與不可重試 | 4xx（429 除外）通常不該重試；429 / 503 搭配 `Retry-After` |

## 動手

1. 在 Playground 開啟上面那段，加一個 `OrderNotFound(NotFound)`，丟出它並確認回應是 404、`code` 是 `order_not_found`。
2. 把 `buggy` 改成丟 `ZeroDivisionError`，確認回應內容完全沒有 `ZeroDivisionError` 這個字，而 log 裡有。
3. 想想註冊流程：哪些錯誤該回 409、哪些該回 422？把它們寫成例外類別。
4. 做本課的程式題：實作 `to_problem`，讓預期內錯誤與 bug 各自轉成正確的 Problem Details。

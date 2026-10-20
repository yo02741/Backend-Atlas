## 從一個具體問題開始：後端明明回了 500，瀏覽器卻說是 CORS 錯誤

前端（`https://shop.example`）呼叫 API 建立訂單，瀏覽器的 console 顯示：

```text
Access to fetch at 'https://api.shop.example/orders' from origin 'https://shop.example' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

團隊先去檢查 CORS 設定：`CORSMiddleware` 好好地掛著，允許的來源也寫對了；其他 API 都正常。真正的原因在後端 log 裡：handler 丟出一個沒有被處理的例外，回了 500。

為什麼 500 會變成 CORS 錯誤？在 Starlette（FastAPI 的底層）裡，負責把「沒人處理的例外」變成 500 回應的那一層，位在**所有自己加的 middleware 外面**。例外一路往外冒，穿過 `CORSMiddleware`，它沒有機會在回應上加 `Access-Control-Allow-Origin`；最外層產生的 500 沒有這個標頭，瀏覽器就拒絕讓前端讀取回應，只回報 CORS 錯誤。實際用 `TestClient(app, raise_server_exceptions=False)` 帶 `Origin` 標頭打一個會丟例外的 endpoint，回應的標頭只有 `content-length` 和 `content-type`；同一個 client 打正常的 endpoint，才看得到 `access-control-allow-origin`。

這類問題只要知道「請求依序經過哪幾層、每一層出錯時誰負責回應」就能很快定位。這篇把那條路徑一層一層拆開。

## 一個請求經過的每一層

```text
TCP 連線
  │
  ▼
ASGI server（uvicorn）：解析 HTTP，把請求轉成 scope／receive／send
  │
  ▼
┌ ServerErrorMiddleware ───────── 最外層：未處理的例外在這裡變成 500
│ ┌ 自己加的 middleware ───────── CORS、request id、計時 log（最後加的在最外面）
│ │ ┌ ExceptionMiddleware ─────── HTTPException、自訂 exception_handler 在這裡處理
│ │ │ ┌ Router ────────────────── 比對路徑與方法：找不到 404、方法不對 405
│ │ │ │  依賴注入 ──────────────── Depends：DB session、目前使用者（認證失敗 401）
│ │ │ │  參數驗證 ──────────────── path／query／body 轉型與驗證（失敗 422）
│ │ │ │  handler ───────────────── 商業邏輯
│ │ │ │  回應序列化 ────────────── response_model 過濾欄位、轉成 JSON
│ │ │ └──────────────────────────
│ │ └ 回應往外走，經過每一層的「後半段」
│ └ middleware 可以在這裡加標頭、記錄耗時
└ ASGI server 把回應寫回 socket
```

每一層出錯時，回應長什麼樣：

| 層 | 典型失敗 | FastAPI 的預設回應 |
|---|---|---|
| Router | 路徑不存在 | `404 {"detail": "Not Found"}` |
| Router | 路徑存在、方法不對 | `405 {"detail": "Method Not Allowed"}` |
| 參數驗證 | `"qty": "abc"`、缺必填欄位 | `422`，`detail` 是每個欄位錯誤的清單 |
| 依賴 | 依賴裡 `raise HTTPException(401)` | `401 {"detail": …}` |
| handler | `raise HTTPException(404, "order not found")` | `404 {"detail": "order not found"}` |
| 回應序列化 | 回傳的資料不符合 `response_model` | `500`（伺服器的錯，不是客戶端的） |
| 任何地方 | 未處理的例外 | `500 Internal Server Error`（純文字，不經過自己加的 middleware） |

### ASGI 與 WSGI

框架和 server 之間有一個約定好的介面，Python 有兩套：

| | WSGI（PEP 3333） | ASGI |
|---|---|---|
| 應用程式的形狀 | `def app(environ, start_response)`，回傳 body 的 iterable | `async def app(scope, receive, send)` |
| 一個請求佔用 | 一個執行緒或行程，從頭到尾 | 一個協程，等 I/O 時讓出 |
| 長連線（WebSocket、SSE） | 不適合 | 原生支援 |
| 啟動／關閉事件 | 沒有標準 | `lifespan` |
| 常見 server | gunicorn、uWSGI | uvicorn、hypercorn |
| 常見框架 | Flask、Django（傳統部署） | FastAPI、Starlette、Django（ASGI 模式） |

FastAPI 是 ASGI 應用程式，所以用 uvicorn 啟動。框架做的事，就是把 `scope`（方法、路徑、標頭）與 `receive`（讀 body）包裝成方便的 `Request`，再把 handler 的回傳值透過 `send` 送回去。

### 路由比對：順序有意義

FastAPI 依**宣告順序**比對路由。下面兩個路由的順序寫反時：

```python
@app.get("/users/{user_id}")
def get_user(user_id: int): ...

@app.get("/users/me")          # 永遠到不了：/users/me 先被上面那條吃掉
def get_me(): ...
```

`GET /users/me` 會先比對到 `/users/{user_id}`，`"me"` 轉不成 int，於是回 422，`loc` 是 `["path", "user_id"]`。固定路徑要宣告在參數路徑之前。

### 依賴注入：一張每個請求重新解的圖

`Depends(get_db)` 的意思是「處理這個請求前，先呼叫 `get_db`，把結果當參數給我」。依賴可以再依賴別的依賴，形成一張圖：

```text
create_order(order, user, db)
   ├─ user ← get_current_user(token, db)
   │            ├─ token ← 從 Authorization 標頭取出
   │            └─ db    ← get_db()   ┐
   └─ db    ← get_db()                ┘ 同一個請求裡只呼叫一次，兩邊拿到同一個 session
```

幾個實際的性質：

- **同一個請求內預設會快取**：`get_db` 在圖裡出現兩次，只執行一次，所以 handler 與 `get_current_user` 拿到的是同一個 session、同一個交易。
- **用 `yield` 寫的依賴有清理階段**：`yield` 之前建立資源，之後關閉（例如關掉 session）。清理階段相對於回應送出的確切時間點，各版本 FastAPI 有調整過，需要時以所用版本的文件為準。
- **測試可以替換**：`app.dependency_overrides[get_db] = get_test_db`，不必改 handler（見 [測試金字塔與 pytest](#/skill/testing)）。
- **權限檢查適合寫成依賴**：只有需要的路由才掛 `Depends(require_admin)`，比寫在 middleware 裡用路徑判斷清楚。

### middleware 適合做什麼

middleware 包住**每一個**請求，適合做與路由無關的橫切工作：request id、存取 log 與耗時、CORS、壓縮、安全性標頭。不適合放在 middleware 的：

- **只跟部分路由有關的邏輯**（某些 API 要管理員權限）：用依賴。
- **讀取 request body**：body 是串流，在 middleware 讀掉之後，後面的處理要特別處理才讀得到。
- **商業邏輯**：middleware 裡沒有型別化的參數、也不在 OpenAPI 文件裡。

多個 middleware 的順序：Starlette 裡**最後加入的在最外層**，請求先經過它、回應最後經過它。

## 實際程式

### FastAPI：每一層各寫一段

需要安裝 fastapi 與 uvicorn，不能在瀏覽器執行。

```python
import time
import uuid
from collections.abc import Iterator

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

app = FastAPI()


# ── middleware：每個請求都經過；這裡加 request id 與耗時 ──
@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
    start = time.perf_counter()
    response = await call_next(request)          # 往內層走，拿到回應再回來
    response.headers["x-request-id"] = request_id
    response.headers["server-timing"] = f"app;dur={(time.perf_counter() - start) * 1000:.1f}"
    return response

# 最後加入的在最外層：CORS 包在 request_context 外面
app.add_middleware(CORSMiddleware, allow_origins=["https://shop.example"],
                   allow_methods=["*"], allow_headers=["*"])


# ── 自訂例外：service 層丟出，這裡統一轉成 HTTP ──
class OutOfStock(Exception):
    def __init__(self, product_id: int):
        self.product_id = product_id

@app.exception_handler(OutOfStock)
async def out_of_stock_handler(request: Request, exc: OutOfStock):
    return JSONResponse(status_code=409, content={"error": "out_of_stock", "product_id": exc.product_id})


# ── 依賴：DB session 與目前使用者 ──
def get_db() -> Iterator["Session"]:
    db = SessionLocal()
    try:
        yield db                                  # handler 執行期間用這個 session
    finally:
        db.close()                                # 請求結束後關閉

def get_current_user(request: Request, db=Depends(get_db)) -> "User":
    token = request.headers.get("authorization", "").removeprefix("Bearer ")
    user = find_user_by_token(db, token)
    if user is None:
        raise HTTPException(status_code=401, detail="invalid token")
    return user


# ── 請求與回應模型：驗證進來的、過濾出去的 ──
class OrderIn(BaseModel):
    product_id: int
    qty: int = Field(gt=0, le=10)

class OrderOut(BaseModel):
    id: int
    product_id: int
    qty: int
    status: str                                   # 內部欄位（成本價等）不在這裡，就不會被回傳


# ── handler：只剩商業邏輯 ──
@app.post("/orders", response_model=OrderOut, status_code=201)
def create_order(order: OrderIn, user=Depends(get_current_user), db=Depends(get_db)):
    return place_order(db, user, order.product_id, order.qty)   # 可能 raise OutOfStock
```

這裡 `create_order` 是 `def` 而不是 `async def`：裡面用的是同步的 DB session，FastAPI 會把它放到執行緒池執行，不會卡住 event loop（見 [同步、多執行緒與 async](#/skill/python-async)）。

### 在瀏覽器裡跑一個極小的框架

下面用標準函式庫寫一個一百行左右的框架，照真實框架的順序走一次生命週期：middleware → 路由 → 依賴 → 驗證 → handler → 序列化 → 例外處理。每一層都印出經過的紀錄。

```python run
import asyncio
import json
import re
import typing
from dataclasses import dataclass, asdict, fields

@dataclass
class Request:
    method: str
    path: str
    headers: dict
    body: dict | None = None

@dataclass
class Response:
    status: int
    body: str
    headers: dict

class HTTPError(Exception):
    def __init__(self, status: int, detail):
        self.status, self.detail = status, detail

class Depends:
    def __init__(self, fn):
        self.fn = fn

class App:
    def __init__(self):
        self.routes, self.middlewares, self.handlers = [], [], {}

    def route(self, method, pattern):
        # "/orders/{order_id}" → 具名群組的 regex
        regex = re.compile("^" + re.sub(r"{(\w+)}", r"(?P<\1>[^/]+)", pattern) + "$")
        def deco(fn):
            self.routes.append((method, regex, fn))
            return fn
        return deco

    def middleware(self, fn):
        self.middlewares.append(fn)
        return fn

    def exception_handler(self, exc_type):
        def deco(fn):
            self.handlers[exc_type] = fn
            return fn
        return deco

    async def __call__(self, req: Request) -> Response:
        # 最後註冊的 middleware 包在最外層（與 Starlette 相同）
        call = self.dispatch
        for mw in self.middlewares:
            call = (lambda mw, nxt: lambda r: mw(r, nxt))(mw, call)
        try:
            return await call(req)
        except Exception as e:                 # 最外層：沒人處理的例外 → 500
            print(f"  [server] 未處理的例外 {e!r} → 500")
            return Response(500, "Internal Server Error", {})

    async def dispatch(self, req: Request) -> Response:
        try:
            return await self.handle(req)
        except Exception as e:                 # 例外處理層：HTTPError 與自訂處理器
            for t, h in self.handlers.items():
                if isinstance(e, t):
                    return h(req, e)
            if isinstance(e, HTTPError):
                return json_response(e.status, {"detail": e.detail})
            raise

    async def handle(self, req: Request) -> Response:
        allowed = False
        for method, regex, fn in self.routes:
            m = regex.match(req.path)
            if not m:
                continue
            allowed = True
            if method != req.method:
                continue
            print(f"  [router] {req.method} {req.path} → {fn.__name__}")
            cache, kwargs, errors = {}, {}, []
            hints = typing.get_type_hints(fn)
            for name in fn.__code__.co_varnames[: fn.__code__.co_argcount]:
                if isinstance(_default_of(fn, name), Depends):   # 依賴
                    kwargs[name] = resolve(_default_of(fn, name).fn, req, cache)
                elif name in m.groupdict():                     # path 參數：依型別提示轉型
                    try:
                        kwargs[name] = hints[name](m.group(name))
                    except ValueError:
                        errors.append({"loc": ["path", name], "msg": f"不是合法的 {hints[name].__name__}"})
                else:                                           # 其餘參數：request body
                    kwargs[name] = validate_body(hints[name], req.body, errors)
            if errors:
                raise HTTPError(422, errors)
            print(f"  [handler] 參數 {kwargs}")
            result = fn(**kwargs)
            body = asdict(result) if hasattr(result, "__dataclass_fields__") else result
            return json_response(200, body)                       # 序列化
        raise HTTPError(405 if allowed else 404, "Method Not Allowed" if allowed else "Not Found")

def _default_of(fn, name):
    # 取出參數的預設值（Depends(...) 就放在預設值裡）
    names = fn.__code__.co_varnames[: fn.__code__.co_argcount]
    defaults = fn.__defaults__ or ()
    offset = len(names) - len(defaults)
    i = names.index(name)
    return defaults[i - offset] if i >= offset else None

def resolve(dep, req, cache):
    # 同一個請求內，同一個依賴只執行一次
    if dep not in cache:
        print(f"  [depends] 執行 {dep.__name__}")
        cache[dep] = dep(req)
    return cache[dep]

def validate_body(model, data, errors):
    data = data or {}
    values = {}
    for f in fields(model):
        if f.name not in data:
            errors.append({"loc": ["body", f.name], "msg": "必填"})
        elif not isinstance(data[f.name], f.type):
            errors.append({"loc": ["body", f.name], "msg": f"要是 {f.type.__name__}"})
        else:
            values[f.name] = data[f.name]
    return model(**values) if not errors else None

def json_response(status, body):
    return Response(status, json.dumps(body, ensure_ascii=False), {"content-type": "application/json"})

# ───────────── 應用程式 ─────────────
app = App()

@app.middleware
async def timing(req, call_next):
    print(f"[mw timing] → {req.method} {req.path}")
    resp = await call_next(req)
    print(f"[mw timing] ← {resp.status}")
    return resp

@app.middleware
async def request_id(req, call_next):              # 後註冊 → 最外層
    rid = req.headers.get("x-request-id", "rid-001")
    resp = await call_next(req)
    resp.headers["x-request-id"] = rid
    return resp

class OutOfStock(Exception):
    pass

@app.exception_handler(OutOfStock)
def out_of_stock(req, e):
    return json_response(409, {"error": "out_of_stock", "message": str(e)})

def get_user(req):
    if req.headers.get("authorization") != "Bearer good":
        raise HTTPError(401, "invalid token")
    return "alice"

@dataclass
class OrderIn:
    product_id: int
    qty: int

@dataclass
class OrderOut:
    id: int
    product_id: int
    qty: int
    owner: str

@app.route("POST", "/orders")
def create_order(order: OrderIn, user=Depends(get_user)):
    if order.product_id == 2:
        raise OutOfStock("商品 2 已售完")
    if order.product_id == 3:
        raise RuntimeError("資料庫連線斷了")
    return OrderOut(id=1, product_id=order.product_id, qty=order.qty, owner=user)

@app.route("GET", "/orders/{order_id}")
def get_order(order_id: int, user=Depends(get_user)):
    return {"id": order_id, "owner": user}

AUTH = {"authorization": "Bearer good"}
cases = [
    Request("POST", "/orders", AUTH, {"product_id": 1, "qty": 2}),
    Request("POST", "/orders", AUTH, {"product_id": "x"}),
    Request("POST", "/orders", {}, {"product_id": 1, "qty": 1}),
    Request("POST", "/orders", AUTH, {"product_id": 2, "qty": 1}),
    Request("POST", "/orders", AUTH, {"product_id": 3, "qty": 1}),
    Request("GET", "/orders/abc", AUTH),
    Request("DELETE", "/orders/7", AUTH),
    Request("GET", "/nope", AUTH),
]
for req in cases:
    print(f"=== {req.method} {req.path} {req.body or ''}")
    resp = await app(req)
    print(f"→ {resp.status} {resp.body} {resp.headers}\n")
```

注意第五個請求（handler 丟出 `RuntimeError`）：`timing` 的「←」那一行沒有印，`x-request-id` 標頭也沒有加上。例外直接穿過兩層 middleware 到最外層變成 500，這就是開頭 CORS 標頭消失的原因。

### 手動呼叫一個 WSGI 與一個 ASGI 應用程式

```python run
import asyncio
import io
from wsgiref.util import setup_testing_defaults

# WSGI：一個同步函式，拿 environ（dict），呼叫 start_response，回傳 body
def wsgi_app(environ, start_response):
    body = f"hello from WSGI, path={environ['PATH_INFO']}".encode()
    start_response("200 OK", [("Content-Type", "text/plain"), ("Content-Length", str(len(body)))])
    return [body]

environ = {"PATH_INFO": "/orders", "REQUEST_METHOD": "GET"}
setup_testing_defaults(environ)            # 補齊 WSGI 規定的其他欄位
captured = {}
def start_response(status, headers):
    captured["status"], captured["headers"] = status, headers
chunks = wsgi_app(environ, start_response)
print("WSGI:", captured["status"], b"".join(chunks).decode())

# ASGI：一個 async 函式，從 receive 讀事件、用 send 送事件
async def asgi_app(scope, receive, send):
    assert scope["type"] == "http"
    event = await receive()                # 讀 request body（可能分好幾段）
    body = f"hello from ASGI, path={scope['path']}, got {len(event['body'])} bytes".encode()
    await send({"type": "http.response.start", "status": 200,
                "headers": [(b"content-type", b"text/plain")]})
    await send({"type": "http.response.body", "body": body})

# 扮演 uvicorn：準備 scope，提供 receive／send
scope = {"type": "http", "method": "POST", "path": "/orders", "headers": []}
async def receive():
    return {"type": "http.request", "body": b'{"qty": 1}', "more_body": False}
sent = []
async def send(message):
    sent.append(message)

await asgi_app(scope, receive, send)
print("ASGI:", sent[0]["status"], sent[1]["body"].decode())
```

## 常見錯誤與錯誤訊息

**422 Unprocessable Entity**：FastAPI 的驗證錯誤，`detail` 會指出哪個欄位、在哪裡（`body`、`query`、`path`）：

```text
{"detail": [{"type": "int_parsing", "loc": ["body", "product_id"],
             "msg": "Input should be a valid integer, unable to parse string as an integer", "input": "abc"},
            {"type": "greater_than", "loc": ["body", "qty"],
             "msg": "Input should be greater than 0", "input": 0, "ctx": {"gt": 0}}]}
```

先看 `loc`：`["path", "user_id"]` 而請求明明打的是 `/users/me`，代表路由順序錯了；`["body", …]` 而前端確定有送，常見原因是沒有設 `Content-Type: application/json`，或欄位名稱大小寫、駝峰與底線不一致（`productId` 對 `product_id`）。

| 現象 | 原因 | 怎麼修 |
|---|---|---|
| 瀏覽器回報 CORS 錯誤，後端 log 有 500 | 未處理的例外在最外層變成 500，沒有經過 CORS middleware | 先修 500；為自訂例外註冊 `exception_handler`，讓它在內層就變成正常回應 |
| `405 Method Not Allowed` | 路徑對、方法錯（例如前端用 PUT，後端只定義 PATCH） | 對照 OpenAPI 文件（`/docs`） |
| 回應是 500，log 有 `ResponseValidationError` | handler 回傳的資料不符合 `response_model` | 這是後端的錯：修 handler 或模型 |
| 回應裡出現 `password_hash` 等不該外流的欄位 | 沒有設 `response_model`，直接回傳了 ORM 物件或 dict | 一律用專門的輸出模型 |
| 每個請求都變慢，CPU 很閒 | `async def` handler 裡呼叫了同步 I/O | 改成 `def`，或換成 async 的 client |
| 依賴裡開的 DB 連線越來越多 | 依賴沒有用 `yield` 加 `finally` 關閉 | 改成 `yield` 依賴 |

## 動手

1. 執行「極小的框架」那段，對照輸出找出每一個請求停在哪一層。接著把 `request_id` 與 `timing` 兩個 middleware 的註冊順序對調，觀察印出順序怎麼變。
2. 在同一段程式裡，讓最外層 `__call__` 的 500 回應也加上 `x-request-id`：想想要改哪一層，才能讓「出錯的請求」也帶著 request id（提示：把 request id 放在比例外處理更外面）。
3. 執行「WSGI 與 ASGI」那段，把 ASGI 的 `receive` 改成分兩段送 body（第一段 `more_body: True`），修改 `asgi_app` 讓它讀完所有片段。
4. 到實驗室 [HTTP 請求的一生](#/lab/HttpLab)，看請求在進到框架之前經過的 DNS、TCP、TLS。
5. 延伸：錯誤回應格式與 request id 的設計見 [日誌、錯誤處理與設定](#/skill/logging-config)；API 契約與自動產生的文件見 [OpenAPI 與 API 契約](#/skill/openapi)。

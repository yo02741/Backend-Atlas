## 從一個具體問題開始：第 37 個 endpoint 忘了檢查

一個 FastAPI 專案有 40 個 endpoint。早期每個 endpoint 自己處理登入：

```python
@app.get("/orders/{order_id}")
def get_order(order_id: int, request: Request):
    token = request.headers.get("Authorization", "").removeprefix("Bearer ")
    claims = jwt.decode(token, KEY, algorithms=["ES256"], audience=AUD, issuer=ISS)
    user = db.get_user(claims["sub"])
    order = db.get_order(order_id)
    if order.user_id != user.id:
        raise HTTPException(403)
    return order
```

同樣的六行被複製了 40 次，然後開始走樣：

- 有 3 個 endpoint 複製時漏了 `audience=`，別的服務的 token 也能用。
- 有 1 個新加的匯出 endpoint 根本忘了驗 token，未登入就能下載。
- token 過期時有的回 `401`、有的回 `500`（`jwt.decode` 丟出的例外沒被處理）、有的回 `403`。
- 帳號停用後，只有一半的 endpoint 檢查 `user.is_active`。

驗證與授權的邏輯本身不難（前幾課都講過），難的是**每個 endpoint 都一致、都沒漏**。框架提供的 middleware、dependency、decorator、guard 就是用來把這段邏輯寫一次、在每個 endpoint 用一行掛上，並且讓「漏掛」變得容易被發現。

## 運作原理：一個請求經過的關卡

一個受保護的請求，從進來到執行業務邏輯，依序經過：

| 關卡 | 做什麼 | 失敗時 |
|---|---|---|
| 1. 取出憑證 | 從 `Authorization: Bearer …` 或 cookie 取出 token / session id | 沒有憑證：`401` |
| 2. 驗證憑證 | 驗 JWT 簽章與聲明，或查 session 表 | 無效、過期：`401` |
| 3. 載入目前使用者 | 用 `sub` 或 session 裡的 user id 查使用者 | 不存在、已停用：`401` |
| 4. 粗粒度授權 | 角色或 scope 有沒有這個能力 | `403` |
| 5. 載入資源 + 資源層授權 | 查訂單，檢查是不是這個人的、狀態允不允許 | 不存在或不該知道其存在：`404`；知道存在但不能做：`403` |
| 6. 業務邏輯 | | |

1～3 是**驗證**，結果是「目前使用者是誰」；4～5 是**授權**（見 [RBAC 與 ABAC](#/skill/rbac-abac)）。框架裡的對應：

| 框架 | 驗證（1～3） | 授權（4～5） |
|---|---|---|
| FastAPI | dependency：`Depends(get_current_user)` | dependency 工廠：`Depends(require_role("admin"))`；資源層 dependency |
| Django REST framework | `authentication_classes` | `permission_classes`；物件層級用 `has_object_permission` |
| NestJS | Guard（常搭配 Passport） | Guard + 自訂 decorator（例如 `@Roles('admin')`） |
| Express | middleware：`(req, res, next)` 把使用者放到 `req.user` | 路由上掛的 middleware |

### middleware 還是 dependency

**middleware** 包住整個應用，每個請求都經過，適合做「與路由無關、每個請求都要做」的事：產生 request id、記錄 log、解析憑證後把結果附在請求上（可能是匿名）。

**dependency**（或 guard、decorator）掛在個別路由上，適合做「這個路由需要什麼」：必須登入、必須是 admin、必須是這張訂單的擁有者。

常見的分工是：middleware 只**解析**，不**拒絕**（沒有 token 就標成匿名），由 dependency 決定這個路由要不要拒絕匿名。原因是：middleware 很難知道哪些路由是公開的（健康檢查、登入頁、公開文件），在 middleware 裡維護一份「公開路由清單」很容易和實際路由不同步。

FastAPI 有一個細節：在 `@app.middleware("http")` 裡丟出 `HTTPException` 不會被轉成正常的 HTTP 錯誤回應，因為處理 `HTTPException` 的例外處理器位在使用者 middleware 的內層。middleware 要拒絕請求時，直接回傳 `JSONResponse`。

### 401、403、404

| 狀態碼 | 意思 | 什麼時候用 | 回應要帶 |
|---|---|---|---|
| `401 Unauthorized` | 不知道你是誰（未驗證，或憑證無效） | 沒有 token、token 過期、簽章錯、使用者已停用 | `WWW-Authenticate` header（HTTP 規格要求 401 一定要帶）；Bearer token 時可帶 `error="invalid_token"` |
| `403 Forbidden` | 知道你是誰，但你不能做這件事 | 角色或 scope 不足、資源狀態不允許 | 可以說明缺什麼權限；Bearer 時可帶 `error="insufficient_scope"` |
| `404 Not Found` | 這個資源（對你而言）不存在 | 資源不存在，**或**存在但你不該知道它存在（別人的訂單、別的租戶的資料） | 和真的不存在時一模一樣的回應 |

客戶端依狀態碼做不同的事：`401` 代表「重新取得憑證」（用 refresh token 換發或導去登入），`403` 代表「換發也沒用，不要重試」。如果權限不足卻回 401，客戶端會陷入「換發 → 再試 → 401 → 換發」的迴圈。

Bearer token 的錯誤回應長這樣（RFC 6750）：

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer error="invalid_token", error_description="token expired"
Content-Type: application/json

{"detail": "token expired"}
```

```http
HTTP/1.1 403 Forbidden
WWW-Authenticate: Bearer error="insufficient_scope", scope="orders.write"
Content-Type: application/json

{"detail": "requires scope orders.write"}
```

## 實際程式：FastAPI 的 dependency

以下需要安裝 `fastapi` 與 `PyJWT`，不能在瀏覽器裡跑。`db` 是示意用的資料存取物件。

```python
from typing import Annotated
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt  # PyJWT
# User、Order、db、PUBLIC_KEY 是應用程式自己的模型、資料存取與設定，這裡省略

app = FastAPI()
bearer = HTTPBearer(auto_error=False)   # 沒帶 header 時回傳 None，由我們決定回什麼

def unauthorized(msg: str, error: str = "invalid_token") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=msg,
        headers={"WWW-Authenticate": f'Bearer error="{error}"'},
    )

# ① 驗證：取出 → 驗證 → 載入使用者。所有需要登入的 endpoint 都依賴它
def get_current_user(
    cred: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> User:
    if cred is None:
        raise HTTPException(401, "not authenticated", headers={"WWW-Authenticate": "Bearer"})
    try:
        claims = jwt.decode(
            cred.credentials, PUBLIC_KEY, algorithms=["ES256"],
            audience="https://api.example.com", issuer="https://auth.example.com", leeway=30,
        )
    except jwt.ExpiredSignatureError:
        raise unauthorized("token expired")
    except jwt.InvalidTokenError:          # 其他所有 JWT 錯誤的共同父類別
        raise unauthorized("invalid token")
    user = db.get_user(claims["sub"])
    if user is None or not user.is_active:
        raise unauthorized("user disabled")
    return user

CurrentUser = Annotated[User, Depends(get_current_user)]

# ② 粗粒度授權：dependency 工廠，回傳一個新的 dependency
def require_role(*roles: str):
    def checker(user: CurrentUser) -> User:
        if not set(roles) & set(user.roles):
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"requires role {' or '.join(roles)}")
        return user
    return checker

# ③ 資源層授權：載入資源並檢查歸屬，endpoint 直接拿到「可以用的」訂單
def get_own_order(order_id: int, user: CurrentUser) -> Order:
    order = db.get_order(order_id)
    if order is None or order.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "order not found")
    return order

@app.get("/me")
def me(user: CurrentUser):
    return {"id": user.id, "roles": user.roles}

@app.get("/orders/{order_id}")
def read_order(order: Annotated[Order, Depends(get_own_order)]):
    return order

@app.get("/admin/users", dependencies=[Depends(require_role("admin"))])
def list_users():
    return db.list_users()
```

幾個設計重點：

- **dependency 會在同一個請求內快取**。`read_order` 依賴 `get_own_order`，`get_own_order` 又依賴 `get_current_user`；如果同一個請求裡有好幾個 dependency 都依賴 `get_current_user`，FastAPI 預設只執行它一次。
- **不需要使用者物件的 endpoint**，用 `dependencies=[Depends(...)]` 掛上檢查，不必在參數列宣告。
- **整組路由都要登入**時，掛在 router 上：`APIRouter(prefix="/admin", dependencies=[Depends(require_role("admin"))])`。新加的路由自動繼承，不會漏。
- **`HTTPBearer` 在缺少 header 時的預設行為**依 FastAPI 版本不同（舊版回 403），上面用 `auto_error=False` 自己決定，確保一律回 401。
- 支援 cookie session 與 Bearer 兩種時，在 `get_current_user` 裡依序嘗試，後面的 endpoint 完全不用知道差別。

### 測試：每個受保護的 endpoint 三種身分

```python
from fastapi.testclient import TestClient

client = TestClient(app)

def as_user(user):
    # 測試時直接替換「目前使用者」，不用真的簽 token
    app.dependency_overrides[get_current_user] = lambda: user

def teardown_function():
    app.dependency_overrides.clear()

def test_order_requires_login():
    assert client.get("/orders/1").status_code == 401          # 沒有覆寫：走真的驗證

def test_other_users_order_is_404():
    as_user(User(id=2, roles=["member"], is_active=True))
    assert client.get("/orders/1").status_code == 404          # 訂單 1 屬於 user 1

def test_owner_can_read():
    as_user(User(id=1, roles=["member"], is_active=True))
    assert client.get("/orders/1").status_code == 200

def test_admin_route_forbidden_for_member():
    as_user(User(id=1, roles=["member"], is_active=True))
    assert client.get("/admin/users").status_code == 403
```

`app.dependency_overrides` 是 FastAPI 給測試用的機制：把某個 dependency 換成另一個函式。授權測試用它換掉「目前使用者」，驗證本身（token 解析、過期、簽章）另外用少數幾個測試帶真的 token 驗。

還可以加一個**掃描型測試**：列出 `app.routes`，對每個不在「公開清單」裡的路由，不帶 token 發一次請求，斷言回 `401`。新加的 endpoint 忘了掛檢查，這個測試就會失敗——開頭那個匯出 endpoint 會在 CI 被抓到。

## 實際程式：用純函式模擬 middleware 鏈

框架裡的 middleware 與 dependency，本質上是一串函式：每一層拿到請求，決定要「往下傳」還是「直接回應」。下面不用任何框架，把上面的關卡寫成可以組合的函式，跑過各種身分的請求，最後用同樣的三種身分寫測試。

```python run
from dataclasses import dataclass, field

# ---------- 假資料 ----------
TOKENS = {"tok-alice": "alice", "tok-bob": "bob", "tok-carol": "carol", "tok-old": "EXPIRED"}
USERS = {"alice": {"roles": {"member"}, "active": True},
         "bob":   {"roles": {"member", "admin"}, "active": True},
         "carol": {"roles": {"member"}, "active": False}}
ORDERS = {1: {"id": 1, "owner": "alice", "total": 990}, 2: {"id": 2, "owner": "bob", "total": 120}}

@dataclass
class Request:
    path: str
    headers: dict = field(default_factory=dict)
    ctx: dict = field(default_factory=dict)      # middleware 在這裡放東西給後面用

@dataclass
class Response:
    status: int
    body: object = None
    headers: dict = field(default_factory=dict)

class HTTPError(Exception):
    def __init__(self, status, detail, headers=None):
        self.status, self.detail, self.headers = status, detail, headers or {}

# ---------- middleware：包住 handler，回傳新的 handler ----------
def error_middleware(next_handler):
    def handle(req):
        try:
            return next_handler(req)
        except HTTPError as e:                   # 把例外轉成回應，相當於框架的例外處理器
            return Response(e.status, {"detail": e.detail}, e.headers)
    return handle

def auth_middleware(next_handler):
    def handle(req):
        # 只解析、不拒絕：沒有 token 就是匿名，由路由自己決定
        h = req.headers.get("Authorization", "")
        req.ctx["token"] = h[7:] if h.startswith("Bearer ") else None
        return next_handler(req)
    return handle

def compose(handler, *middlewares):
    for m in reversed(middlewares):              # 第一個 middleware 在最外層
        handler = m(handler)
    return handler

# ---------- dependency：路由需要什麼就呼叫什麼 ----------
def current_user(req):
    if "user" in req.ctx:                        # 同一請求內快取
        return req.ctx["user"]
    tok = req.ctx.get("token")
    if tok is None:
        raise HTTPError(401, "not authenticated", {"WWW-Authenticate": "Bearer"})
    uid = TOKENS.get(tok)
    if uid is None or uid == "EXPIRED":
        raise HTTPError(401, "invalid token", {"WWW-Authenticate": 'Bearer error="invalid_token"'})
    u = USERS[uid]
    if not u["active"]:
        raise HTTPError(401, "user disabled", {"WWW-Authenticate": 'Bearer error="invalid_token"'})
    req.ctx["user"] = {"id": uid, **u}
    return req.ctx["user"]

def require_role(role):
    def dep(req):
        user = current_user(req)
        if role not in user["roles"]:
            raise HTTPError(403, f"requires role {role}")
        return user
    return dep

def own_order(req, order_id):
    user = current_user(req)
    order = ORDERS.get(order_id)
    if order is None or order["owner"] != user["id"]:
        raise HTTPError(404, "order not found")  # 別人的訂單和不存在的一樣
    return order

# ---------- 路由 ----------
def router(req):
    if req.path == "/health":
        return Response(200, "ok")                        # 公開，不呼叫 current_user
    if req.path == "/me":
        return Response(200, sorted(current_user(req)["roles"]))
    if req.path.startswith("/orders/"):
        return Response(200, own_order(req, int(req.path.split("/")[2])))
    if req.path == "/admin/users":
        require_role("admin")(req)
        return Response(200, sorted(USERS))
    raise HTTPError(404, "no such route")

app = compose(router, error_middleware, auth_middleware)

def call(path, token=None):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return app(Request(path, headers))

for path, tok in [("/health", None), ("/me", None), ("/me", "tok-old"), ("/me", "tok-carol"),
                  ("/me", "tok-alice"), ("/orders/1", "tok-alice"), ("/orders/2", "tok-alice"),
                  ("/orders/9", "tok-alice"), ("/admin/users", "tok-alice"), ("/admin/users", "tok-bob")]:
    r = call(path, tok)
    extra = f"  WWW-Authenticate: {r.headers['WWW-Authenticate']}" if "WWW-Authenticate" in r.headers else ""
    print(f"{path:13} {str(tok):10} → {r.status} {r.body}{extra}")

# ---------- 測試：每個受保護路由三種身分 ----------
PROTECTED = {"/orders/1": ("tok-bob", "tok-alice"),      # (登入但無權, 有權)
             "/admin/users": ("tok-alice", "tok-bob")}
for path, (no_perm, ok) in PROTECTED.items():
    assert call(path).status == 401, path
    assert call(path, no_perm).status in (403, 404), path
    assert call(path, ok).status == 200, path
print("\n三種身分的測試全部通過")
```

輸出裡值得對照的幾行：`/orders/2` 與 `/orders/9` 對 alice 回一樣的 `404`；停用的 carol 拿著有效 token 也是 `401`；alice 打 `/admin/users` 是 `403`。`error_middleware` 放在最外層，所以任何一層丟出的 `HTTPError` 都會被轉成回應，這就是框架的例外處理器在做的事。

## 常見錯誤與錯誤訊息

| 症狀 | 原因 | 怎麼修 |
|---|---|---|
| token 過期時 API 回 `500`，log 是 `jwt.exceptions.ExpiredSignatureError: Signature has expired` | `jwt.decode` 的例外沒被接住 | 在 `get_current_user` 接 `jwt.InvalidTokenError`（所有 JWT 驗證錯誤的父類別）轉成 401 |
| 前端收到 401 後無限重試 | 權限不足也回了 401，客戶端以為換發 token 就能解決 | 權限不足一律回 403 |
| FastAPI 回 `{"detail": "Not authenticated"}` 但狀態碼是 403 | 用了 `HTTPBearer()` 預設的 `auto_error=True`，部分版本在缺少 header 時回 403 | 用 `auto_error=False` 自己丟 401，或確認所用版本的行為 |
| middleware 裡 `raise HTTPException(401)`，客戶端卻收到 `500 Internal Server Error` | middleware 在例外處理器外層，`HTTPException` 沒被轉換 | middleware 直接 `return JSONResponse(status_code=401, …)` |
| 測試全過，正式環境卻有 endpoint 沒驗證 | 測試全部用 `dependency_overrides` 換掉了驗證，從來沒測過「沒覆寫」的情況 | 每個受保護路由至少一個不覆寫、不帶 token 的測試；加掃描所有路由的測試 |
| 改了使用者角色，要等一陣子才生效 | 角色寫在 JWT 裡，`get_current_user` 直接用 token 裡的角色 | 角色以資料庫為準（`get_current_user` 本來就查使用者）；token 裡的角色只當提示 |
| `CORS` 預檢請求（`OPTIONS`）被回 401 | 驗證 middleware 也攔了 `OPTIONS` | 讓 CORS middleware 放在驗證之前處理預檢；預檢不帶憑證 |

## 動手

1. 在上面的 `python run` 範例裡，把 `compose` 的 middleware 順序改成 `auth_middleware, error_middleware`，再跑一次，看結果有沒有變；然後讓 `auth_middleware` 在沒有 token 時直接 `raise HTTPError(401, …)`，看 `/health` 變成什麼——這就是「middleware 只解析、不拒絕」的原因。
2. 把 `own_order` 裡的 `order["owner"] != user["id"]` 拿掉，看哪一個 assert 失敗、失敗訊息指向哪個路由。
3. 加一個 `require_scope("orders.write")` dependency：token 對照表改成記錄 scope，權限不足時回 403 並帶 `WWW-Authenticate: Bearer error="insufficient_scope"`。
4. 在自己的專案裡，列出所有路由與它們掛的驗證／授權 dependency，找出沒有掛任何檢查、又不在公開清單上的路由。
5. 憑證本身的設計（session 還是 token、存在哪）回到 [驗證基礎](#/skill/authn-basics)；機器對機器的呼叫怎麼驗，見 [API key 與 MFA](#/skill/api-keys-mfa)。

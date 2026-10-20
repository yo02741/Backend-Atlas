## 從一個具體問題開始：想測「折扣碼過期」，卻得先架一台資料庫

結帳 API 一開始長這樣，所有事情都寫在 handler 裡：

```python
# 需要 FastAPI 與 psycopg，不能在瀏覽器裡跑
@app.post("/checkout")
def checkout(body: CheckoutIn, conn = Depends(get_conn)):
    row = conn.execute(
        "SELECT percent, expires_on, remaining FROM coupons WHERE code = %s", [body.coupon]
    ).fetchone()
    if row is None:
        raise HTTPException(404, "折扣碼不存在")
    if row[1] < date.today():
        raise HTTPException(409, "折扣碼已過期")
    conn.execute("UPDATE coupons SET remaining = remaining - 1 WHERE code = %s", [body.coupon])
    amount = body.amount * (100 - row[0]) // 100
    send_email(body.email, f"您的訂單金額 {amount} 元")   # 直接寄信
    return {"amount": amount}
```

能跑，但接著會遇到：

- **測一條規則要整套環境**。「過期的折扣碼要被拒絕」只是一個日期比較，測它卻要起資料庫、插測試資料、打 HTTP、擋掉寄信；`date.today()` 寫死在裡面，也沒辦法測「剛好在到期日那天」。
- **沒辦法重用**。每晚的批次工作也要套用同一套折扣規則，但規則跟 HTTP 例外、SQL 綁在一起，只能複製貼上，兩份之後就會漸漸不一樣。
- **改一處動全部**。資料表改名、換 ORM、把寄信改成丟進佇列，都要動到這個 handler，也就動到折扣規則本身。

問題不在程式寫得長，而在**不同理由會變的東西放在同一個地方**：HTTP 格式、業務規則、資料怎麼存，各自會因為不同的原因改。分層就是把它們拆開，讓每一種改動只影響一層。

## 三層各管什麼

| 層 | 負責 | 知道什麼 | 不該知道什麼 |
|---|---|---|---|
| router / handler | 把 HTTP 請求轉成函式呼叫、把結果或錯誤轉回 HTTP | 路徑、狀態碼、請求與回應的 schema（pydantic model） | SQL、業務規則的細節 |
| service（領域邏輯） | 業務規則：能不能用折扣、金額怎麼算、狀態怎麼轉換 | 領域物件、規則、要呼叫哪些 repository | HTTP、框架、SQL、用的是哪個資料庫 |
| repository（資料存取） | 把領域物件存進去、查出來 | SQL / ORM、資料表結構 | 業務規則、HTTP |

依賴的**方向**只有一個：

```text
handler  ──呼叫──▶  service  ──透過介面呼叫──▶  CouponRepository（介面）
                                                    ▲
                                       實作 ─────────┤
                                PostgresCouponRepository   InMemoryCouponRepository
```

service 依賴的是 **repository 的介面**（「我需要能 `get`、能 `save`」），不是某一個具體的資料庫實作。PostgreSQL 版和記憶體版都實作這個介面，由外層決定要塞哪一個。這是**依賴反轉**：高層的規則不依賴低層的細節，兩者都依賴同一個抽象。

幾個具體的界線：

- **領域層不 import 框架**。service 裡不出現 `fastapi`、`HTTPException`、`Request`；不出現 `psycopg`、`Session`。找不到折扣碼時丟的是自己定義的 `CouponError`，由 handler 或全域的例外處理器轉成 404 / 409（見 [錯誤設計](#/skill/error-design)）。
- **資料在邊界轉換**。handler 把 pydantic 的請求 model 拆成 service 需要的參數；service 回傳領域物件，handler 再轉成回應 model。資料庫的 row、ORM 物件不要穿過 service 一路回到 HTTP 回應。
- **交易邊界放在 service 這一層或更外面**。一個用例（「套用折扣並建立訂單」）裡的多個 repository 操作要在同一個交易，所以 repository 的單一方法裡不要自己 `commit`；常見做法是由 service 或一個 Unit of Work 物件控制開始與提交。
- **「現在幾點」「隨機值」也是依賴**。`date.today()`、`uuid4()`、`time.time()` 寫死在規則裡，測試就無法固定它們；把 `today` 或一個 clock 物件當參數傳進來。

## 依賴注入：把「要用什麼」從外面傳進去

**依賴注入**（dependency injection）講白了只有一句：物件不自己建立它需要的東西，而是由外面傳進來。

```python
# 自己建立：OrderService 和 PostgreSQL 綁死，測試時沒辦法換
class OrderService:
    def __init__(self):
        self.repo = PostgresOrderRepository(connect("postgresql://..."))

# 建構子注入：需要什麼寫在參數上，誰建立它、建立哪一種，由呼叫的人決定
class OrderService:
    def __init__(self, repo: OrderRepository, mailer: Mailer):
        self.repo = repo
        self.mailer = mailer
```

建構子注入的好處是依賴**一眼看得到**：看 `__init__` 就知道這個 service 需要什麼。對比之下，在模組最上面 `from app.db import repo` 用一個全域物件，依賴就藏起來了，測試只能靠 `mock.patch("app.services.orders.repo")` 這種依賴模組路徑的寫法去替換，搬一次檔案測試就壞。

所有東西在一個地方組裝起來，這個地方叫 **composition root**：應用啟動時（或每個請求開始時）建立連線、建立 repository、把它們傳給 service。整個程式只有這裡知道「正式環境用的是 PostgreSQL 版」。

### FastAPI 的 Depends

FastAPI 的 `Depends` 就是每個請求做一次的 composition root：handler 的參數宣告「我需要什麼」，框架在每個請求執行 provider 函式、把結果傳進來。provider 本身也可以有 `Depends`，形成一條鏈：

```python
# 需要 FastAPI，不能在瀏覽器裡跑
from fastapi import Depends, FastAPI

app = FastAPI()

def get_conn():
    conn = pool.getconn()
    try:
        yield conn                    # yield 之前是準備，之後是清理（請求結束才執行）
    finally:
        pool.putconn(conn)

def get_coupon_repo(conn = Depends(get_conn)) -> CouponRepository:
    return PostgresCouponRepository(conn)

def get_checkout_service(repo: CouponRepository = Depends(get_coupon_repo)) -> CheckoutService:
    return CheckoutService(repo, today=date.today())

@app.post("/checkout")
def checkout(body: CheckoutIn, service: CheckoutService = Depends(get_checkout_service)):
    return {"amount": service.apply_coupon(body.coupon, body.amount)}

# 測試：把 repository 換掉，handler 和 service 都不用改
app.dependency_overrides[get_coupon_repo] = lambda: InMemoryCouponRepository([...])
```

同一個請求裡，同一個依賴被好幾個地方需要時，FastAPI 預設只執行一次、共用結果。`app.dependency_overrides` 是 FastAPI 官方提供的測試機制：指定某個 provider 要換成哪個函式。

下面用幾十行純 Python 寫一個極簡版，說明 `Depends` 背後的概念（這不是 FastAPI 的實作，只示範「看參數、遞迴解出依賴、可以被 override」）：

```python run
import inspect


# 一個極簡版的 Depends：說明概念用，不是 FastAPI 的實作
class Depends:
    def __init__(self, provider):
        self.provider = provider


overrides = {}   # 對應 FastAPI 的 app.dependency_overrides


def call_with_deps(func, **request_params):
    """看 func 的參數：預設值是 Depends(...) 的，先遞迴解出 provider 的結果再傳進去。"""
    kwargs = {}
    for name, param in inspect.signature(func).parameters.items():
        if isinstance(param.default, Depends):
            provider = overrides.get(param.default.provider, param.default.provider)
            kwargs[name] = call_with_deps(provider, **request_params)
        elif name in request_params:
            kwargs[name] = request_params[name]
    return func(**kwargs)


# ---- 依賴鏈：連線 → repository → service ----
class PostgresOrderRepository:
    def __init__(self, conn):
        self.conn = conn
    def get(self, order_id):
        raise RuntimeError("這裡會真的查資料庫")

class InMemoryOrderRepository:
    def __init__(self, rows):
        self.rows = rows
    def get(self, order_id):
        return self.rows.get(order_id)

class OrderService:
    def __init__(self, repo):
        self.repo = repo
    def get_order(self, order_id):
        order = self.repo.get(order_id)
        if order is None:
            raise LookupError(f"訂單 {order_id} 不存在")
        return order

def get_conn():
    return "postgresql 連線"

def get_order_repo(conn=Depends(get_conn)):
    return PostgresOrderRepository(conn)

def get_order_service(repo=Depends(get_order_repo)):
    return OrderService(repo)

# handler 只宣告「我需要 OrderService」，不知道它怎麼組出來
def read_order(order_id: int, service=Depends(get_order_service)):
    return service.get_order(order_id)


# ---- 測試：把 repository 換成記憶體版，handler 與 service 一行都不用改 ----
overrides[get_order_repo] = lambda: InMemoryOrderRepository({7: {"id": 7, "amount": 990}})
print(call_with_deps(read_order, order_id=7))
try:
    call_with_deps(read_order, order_id=8)
except LookupError as e:
    print("LookupError:", e)

overrides.clear()
try:
    call_with_deps(read_order, order_id=7)
except RuntimeError as e:
    print("沒有 override 時用的是正式版：", e)
```

## 實際程式：用 Protocol 定義 repository 介面

Python 的 `typing.Protocol` 定義**結構型別**：只要一個類別有這些方法、簽名對得上，就被視為實作了這個介面，不需要繼承。pyright / mypy 會在你把物件傳給 `CheckoutService` 時檢查它是否符合。執行時 Protocol 不做檢查（除非加 `@runtime_checkable` 並自己用 `isinstance`），它主要是給型別檢查器與讀程式的人看的。

下面把開頭的結帳邏輯拆開：領域物件、repository 介面、service、記憶體版 repository，最後是幾個不需要資料庫的測試。

```python run
from dataclasses import dataclass
from datetime import date
from typing import Protocol


# ---- 領域層：資料與規則，不 import 任何框架或資料庫 ----
@dataclass(frozen=True)
class Coupon:
    code: str
    percent: int          # 折扣百分比
    expires_on: date
    remaining: int        # 剩餘可用次數


class CouponError(Exception):
    """預期內的業務錯誤：由外層決定怎麼回應（例如轉成 HTTP 409）。"""


# ---- repository 介面：只描述「需要什麼操作」，不管資料存在哪裡 ----
class CouponRepository(Protocol):
    def get(self, code: str) -> Coupon | None: ...
    def save(self, coupon: Coupon) -> None: ...


# ---- service：領域邏輯；依賴從建構子傳進來 ----
class CheckoutService:
    def __init__(self, coupons: CouponRepository, today: date):
        self.coupons = coupons
        self.today = today   # 「今天」也是依賴：測試才能固定日期

    def apply_coupon(self, code: str, amount: int) -> int:
        coupon = self.coupons.get(code)
        if coupon is None:
            raise CouponError(f"折扣碼 {code} 不存在")
        if coupon.expires_on < self.today:
            raise CouponError(f"折扣碼 {code} 已過期")
        if coupon.remaining <= 0:
            raise CouponError(f"折扣碼 {code} 已用完")
        self.coupons.save(Coupon(coupon.code, coupon.percent, coupon.expires_on, coupon.remaining - 1))
        return amount * (100 - coupon.percent) // 100


# ---- 記憶體版 repository：測試與原型用；正式環境換成 PostgreSQL 版 ----
class InMemoryCouponRepository:
    def __init__(self, coupons: list[Coupon] = ()):
        self._rows = {c.code: c for c in coupons}

    def get(self, code: str) -> Coupon | None:
        return self._rows.get(code)

    def save(self, coupon: Coupon) -> None:
        self._rows[coupon.code] = coupon


# ---- 測試：不需要資料庫、不需要 HTTP，一個測試幾微秒 ----
def make_service(*coupons, today=date(2026, 10, 20)):
    repo = InMemoryCouponRepository(list(coupons))
    return CheckoutService(repo, today=today), repo

svc, repo = make_service(Coupon("FALL15", 15, date(2026, 10, 31), remaining=2))
assert svc.apply_coupon("FALL15", 1000) == 850
assert repo.get("FALL15").remaining == 1            # 有扣掉一次

svc, _ = make_service(Coupon("OLD", 10, date(2026, 9, 30), remaining=5))
try:
    svc.apply_coupon("OLD", 1000)
    raise AssertionError("過期的折扣碼應該失敗")
except CouponError as e:
    print("如預期失敗：", e)

svc, _ = make_service(Coupon("ONCE", 50, date(2026, 12, 31), remaining=1))
svc.apply_coupon("ONCE", 1000)
try:
    svc.apply_coupon("ONCE", 1000)
    raise AssertionError("用完的折扣碼應該失敗")
except CouponError as e:
    print("如預期失敗：", e)

print("全部測試通過")
```

注意 `CheckoutService` 完全不知道資料存在哪裡。正式環境的 `PostgresCouponRepository` 只要有同樣的 `get` / `save` 方法就能直接換上。

記憶體版 repository 是 **fake**（有真實行為的簡化實作），不是 mock（預先寫好「被呼叫時回傳什麼」的替身）。fake 讓測試描述的是行為（「用過一次之後剩餘次數少 1」），而不是呼叫細節（「`save` 被呼叫了一次、參數是…」），重構時比較不會整片壞掉。

這不代表資料層不用測：`PostgresCouponRepository` 本身要用真的 PostgreSQL 做整合測試（SQL 寫錯、約束、交易，fake 都測不到），見 [測試金字塔與 pytest](#/skill/testing)。分層之後，這兩種測試各自變得小而清楚。

## 分層的代價與界線

分層不是越多越好：

- **小型 CRUD 不必硬拆**。一個只是「把表單存進資料表」的 endpoint，service 只會是一行轉呼叫。可以先合併，等出現真正的規則再拆；重點是腦中知道界線在哪。
- **不要做萬用的 generic repository**。`Repository[T]` 提供 `get_all` / `filter(**kwargs)` 這類方法，等於把 ORM 的查詢能力原封不動交給 service，界線就沒了。repository 的方法應該以用例命名：`find_active_by_user(user_id)`、`reserve_stock(product_id, qty)`。
- **不要讓 ORM 物件或 session 穿過邊界**。repository 回傳 ORM 物件後，service 在交易外讀它的關聯欄位會觸發延遲載入，產生難查的錯誤。回傳 dataclass 或明確轉換過的物件比較安全。
- **介面只在有兩個以上實作時才有價值**。Protocol 的第二個實作通常就是測試用的 fake，這已經足夠理由；但不需要替每個類別都先定義介面。

## 常見錯誤與錯誤訊息

| 訊息或現象 | 原因 | 怎麼修 |
|---|---|---|
| `ImportError: cannot import name 'OrderService' from partially initialized module 'app.services' (most likely due to a circular import)` | 兩個模組互相 import：常見是 repository import 了 service 的東西，或 models 與 services 互相引用 | 檢查依賴方向：只能 handler → service → repository 介面；共用的型別抽到獨立的領域模組 |
| `TypeError: CheckoutService.__init__() missing 1 required positional argument: 'today'` | 改用建構子注入後，有地方還在用舊的方式建立物件 | 所有建立都集中到 composition root（provider 函式），搜尋專案裡直接呼叫建構子的地方 |
| service 裡出現 `raise HTTPException(...)` | HTTP 的概念滲進領域層 | 改丟自訂例外，在邊界轉換狀態碼 |
| 測試要靠 `mock.patch("app.services.checkout.date")` 才能固定日期 | 時間寫死在函式裡 | 把 `today` 或 clock 當依賴傳入 |
| 測試只要換一個檔案位置就全部壞掉 | 測試 patch 的是模組路徑，而不是透過注入替換 | 用建構子注入或 `dependency_overrides`，測試直接傳 fake |
| 一個請求裡的兩次寫入，一次成功一次失敗，資料半套 | 每個 repository 方法自己 commit | 把交易邊界拉到 service 或 Unit of Work |

## 動手

1. 在 Playground 開啟 Protocol 那段，替 `CheckoutService` 加一條規則：「單筆金額低於 500 不能用折扣碼」，先寫測試再改 service，整個過程不需要碰 repository。
2. 在同一段加一個 `remaining` 剛好為 1 的折扣碼，連續套用兩次，確認第二次失敗；再把 `today` 改成到期日當天，確認仍然可以使用。
3. 在極簡版 Depends 那段，再加一層 `get_mailer` 依賴給 `OrderService`，並在測試時用 override 換成一個只記錄收件人的 fake。
4. 做本課的程式題：實作會員註冊的 service，依賴從建構子注入，用記憶體版 repository 與 fake mailer 測試。

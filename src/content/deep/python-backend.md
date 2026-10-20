## 從一個具體問題開始：第二個使用者看到了第一個人的購物車

購物車 API 有個輔助函式，沒有傳入購物車時就「開一個新的」：

```python
def add_to_cart(product_id: int, cart: list[int] = []) -> list[int]:
    cart.append(product_id)
    return cart

# handler 裡：新使用者還沒有購物車
items = add_to_cart(product_id)
```

本機開發只有自己一個人在點，一切正常。上線後客服開始收到回報：新註冊的使用者，購物車裡已經有別人的商品；更怪的是重新部署之後問題「消失」了一陣子，過幾個小時又出現。

兩件事疊在一起造成這個現象：

1. **預設值只在 `def` 執行時建立一次**。`cart=[]` 的那個 list 是函式物件的一部分（存在 `add_to_cart.__defaults__`），之後每次沒傳 `cart` 的呼叫都拿到**同一個** list。
2. **後端行程活很久**。腳本跑完就結束，那個 list 跟著消失；但 uvicorn 的 worker 會連續處理成千上萬個請求，那個 list 就一直長大，而且被所有請求共用。重新部署時行程重啟，list 歸零，所以問題「暫時消失」。

修法是預設 `None`、在函式裡建新 list。但更值得記住的是背後的心智模型：**後端的 Python 是長時間執行的行程，模組層級的東西會被所有請求共用**。這篇從這個模型出發，再談型別、資料模型與例外處理。

## Python 後端的行程模型

用 `uvicorn app.main:app --workers 4` 啟動時，會有 4 個獨立的 Python 行程，各自把 `app/main.py` import 一次。行程之間不共用記憶體，執行緒與 GIL 的細節見 [程式怎麼跑起來](#/skill/how-programs-run)，worker 數量怎麼定見 [應用伺服器與程序管理](#/skill/process-servers)。

```text
            ┌──────────── worker 1（PID 101）────────────┐
請求 ──→    │ import app.main（只執行一次）               │
負載平衡    │ 模組層級：app、設定、連線池、快取 dict       │
            │ 每個請求：呼叫 handler → 區域變數 → 結束     │
            └────────────────────────────────────────────┘
            ┌──────────── worker 2（PID 102）────────────┐
            │ 自己的一份模組層級物件，跟 worker 1 無關      │
            └────────────────────────────────────────────┘
```

東西放在哪裡，決定它活多久、誰看得到：

| 放在哪裡 | 生命週期 | 誰共用 | 適合放 |
|---|---|---|---|
| 函式的區域變數 | 一次呼叫 | 只有這次呼叫 | 請求資料、計算中間值 |
| 依賴注入產生的物件（例如 DB session） | 一個請求 | 這個請求內的函式 | 交易、目前使用者 |
| 模組層級變數、預設參數、類別屬性 | 整個 worker 行程 | 這個 worker 的所有請求 | 唯讀設定、連線池、編譯好的 regex |
| Redis、資料庫 | 獨立於行程 | 所有 worker、所有機器 | 計數器、session、快取 |

兩個常見的誤用都來自這張表：

- **把可變狀態放在模組層級**：`_cache = {}` 在單一 worker 時看起來是快取，開到 4 個 worker 就變成 4 份互不同步的快取；部署多台時更是各自為政。需要跨 worker 一致的狀態要放 Redis 或資料庫。
- **在 import 時做 I/O**：模組最上層直接連資料庫、讀遠端設定，每個 worker 啟動都會做一次，測試只要 import 這個模組就會去連資料庫。這類初始化放進框架的 lifespan（啟動／關閉事件）或依賴裡。

### import 做了什麼

`import app.models` 第一次執行時，Python 會找到檔案、建立模組物件、放進 `sys.modules`，然後**從上到下執行整個檔案**。之後任何地方再 import 同一個模組，直接從 `sys.modules` 拿，不會再執行。所以模組層級的程式碼「每個行程只跑一次」，這也是預設參數那個 list 能活那麼久的原因。

循環 import 就是這個機制的副作用：`a.py` 第一行 `from b import helper`，`b.py` 第一行又 `from a import a_func`。執行到 `b` 的時候，`a` 已經在 `sys.modules` 裡但還沒執行到 `def a_func`，於是拿不到。解法通常是把共用的東西抽到第三個模組，或是讓相依只往一個方向（router → service → repository，反過來不行）。

### `if __name__ == "__main__"`

每個模組都有 `__name__`：直接執行 `python app/seed.py` 時它是 `"__main__"`；被 import 時是模組路徑，例如 `"app.seed"`。把「直接執行才要做的事」（解析命令列、灌測試資料）放在這個判斷底下，模組就可以安全地被測試或其他程式 import，不會一 import 就開始灌資料。

套件內的腳本建議用 `python -m app.seed`（或 `uv run python -m app.seed`）執行：`-m` 會以模組身分載入，`from app.models import User` 這類絕對 import 才找得到套件；直接 `python app/seed.py` 時，`sys.path` 的第一項是 `app/` 這個資料夾，如果專案本身沒有安裝進虛擬環境，常見結果是 `ModuleNotFoundError: No module named 'app'`。

## 型別提示、dataclass、pydantic：三個層次

三者常被混為一談，其實分工很清楚：

| 工具 | 執行時會檢查嗎 | 做什麼 | 用在哪 |
|---|---|---|---|
| 型別提示 `def f(x: int)` | **不會**，直譯器幾乎完全忽略 | 給人與型別檢查器（pyright、mypy）看 | 所有函式簽名 |
| `@dataclass` | 不會驗證型別 | 自動產生 `__init__`、`__repr__`、`__eq__`；欄位有名字、打錯字會報錯 | 程式內部傳遞的資料 |
| pydantic `BaseModel` | **會**，而且會轉型 | 驗證、把 `"42"` 轉成 `42`、產生 JSON schema、序列化 | 系統邊界：HTTP body、環境變數、訊息佇列 |

型別提示不會在執行時擋下錯誤：`def price(p: int)` 被傳進 `"100"` 照樣執行。它的價值在型別檢查器，例如函式回傳 `str | None`，呼叫端直接 `.upper()` 時，pyright 會在存檔時就指出「None 沒有 `upper`」，不必等到正式環境丟出 `AttributeError`（見 [型別檢查、lint 與格式化](#/skill/code-quality)）。

`int | None`（Python 3.10 起的寫法）和 `Optional[int]` 意思完全一樣：可能是 int、也可能是 None。`list[str]`（3.9 起可以直接用內建型別加中括號）是「元素都是 str 的 list」。新程式碼用新寫法即可。

原則是**在邊界驗證一次，內部就信任型別**：外部進來的資料一律經過 pydantic（或其他驗證），轉成明確的物件；之後在 service、repository 之間傳遞的是有型別的物件，不再到處 `data.get("user_id")`、到處防禦。用 dict 一路傳到底，打錯 key 只會在執行到那一行時變成 `KeyError` 或靜悄悄的 `None`。

FastAPI 裡的 pydantic 模型長這樣（需要安裝 pydantic，不能在瀏覽器執行）：

```python
from pydantic import BaseModel, Field


class OrderIn(BaseModel):
    product_id: int                      # "42" 會被轉成 42；"abc" 會驗證失敗
    qty: int = Field(gt=0, le=10)        # 1～10
    note: str | None = None              # 選填


order = OrderIn.model_validate({"product_id": "42", "qty": 3})
print(order.product_id + 1)              # 43：已經是 int
print(order.model_dump())                # {'product_id': 42, 'qty': 3, 'note': None}
```

驗證失敗時，pydantic v2 丟出 `ValidationError`，訊息會列出每個欄位的錯誤，例如：

```text
2 validation errors for OrderIn
product_id
  Input should be a valid integer, unable to parse string as an integer [type=int_parsing, input_value='abc', input_type=str]
qty
  Input should be greater than 0 [type=greater_than, input_value=0, input_type=int]
```

## 實際程式

### 可變預設參數與 late binding

```python run
# 1) 預設值在 def 執行時建立一次，存在函式物件上
def add_to_cart(product_id, cart=[]):
    cart.append(product_id)
    return cart

print(add_to_cart(1))                 # [1]
print(add_to_cart(2))                 # [1, 2]：同一個 list
print(add_to_cart.__defaults__)       # ([1, 2],)：就是它

# 修法：預設 None，每次呼叫在函式內建立新的
def add_to_cart_fixed(product_id, cart=None):
    if cart is None:
        cart = []
    cart.append(product_id)
    return cart

print(add_to_cart_fixed(1), add_to_cart_fixed(2))   # [1] [2]

# 2) late binding：閉包記住的是「變數」，不是當下的值
handlers = [lambda: i for i in range(3)]
print([h() for h in handlers])        # [2, 2, 2]：呼叫時才去讀 i，迴圈早就跑完了

handlers = [lambda i=i: i for i in range(3)]   # 用預設參數在定義時把值綁住
print([h() for h in handlers])        # [0, 1, 2]
```

### 型別提示不檢查、邊界要自己驗

```python run
from dataclasses import dataclass


def total_price(unit: int, qty: int) -> int:
    return unit * qty

# 型別提示不會在執行時擋：字串乘以 int 是「重複字串」
print(repr(total_price("100", 3)))    # '100100100'，不是 300


@dataclass(frozen=True)
class OrderLine:
    product_id: int
    qty: int


def parse_order_line(data: dict) -> OrderLine:
    """系統邊界：外部資料在這裡轉型＋驗證，之後的程式只處理 OrderLine。"""
    try:
        product_id = int(data["product_id"])
        qty = int(data.get("qty", 1))
    except KeyError as e:
        raise ValueError(f"缺少欄位 {e.args[0]}") from e
    except (TypeError, ValueError) as e:
        raise ValueError("product_id、qty 必須是整數") from e
    if not 1 <= qty <= 10:
        raise ValueError("qty 要在 1～10 之間")
    return OrderLine(product_id, qty)


print(parse_order_line({"product_id": "42", "qty": "2"}))
for bad in ({"qty": 1}, {"product_id": "abc"}, {"product_id": 1, "qty": 0}):
    try:
        parse_order_line(bad)
    except ValueError as e:
        print("驗證失敗：", e)

# dataclass 至少擋得住打錯欄位名稱
try:
    OrderLine(product_id=1, qyt=2)
except TypeError as e:
    print("TypeError：", e)
```

### 模組只執行一次、`__name__` 決定要不要跑

```python run
import sys
import types

SOURCE = '''
print(f"  執行模組本體，__name__ = {__name__!r}")
CONFIG = {"loaded": True}

def main():
    print("  main()：解析命令列、灌資料…")

if __name__ == "__main__":
    main()
'''

def load(name):
    """模擬 import：建立模組物件、放進 sys.modules、從上到下執行一次。"""
    if name in sys.modules:
        print(f"{name}: 已在 sys.modules，直接回傳，不再執行")
        return sys.modules[name]
    mod = types.ModuleType(name)
    sys.modules[name] = mod
    print(f"{name}: 第一次載入")
    exec(SOURCE, mod.__dict__)
    return mod

load("demo_app.seed")     # 被 import：__name__ 是模組路徑，main() 不執行
load("demo_app.seed")     # 第二次：直接從 sys.modules 拿

print("直接執行（python seed.py）：")
exec(SOURCE, {"__name__": "__main__"})   # 直接執行時 __name__ 是 "__main__"
del sys.modules["demo_app.seed"]
```

### 例外：在一個地方轉成 HTTP 狀態碼

```python run
class AppError(Exception):
    """商業錯誤的基底：帶 HTTP 狀態碼與給客戶端看的代碼。"""
    status = 400
    code = "bad_request"

class NotFound(AppError):
    status, code = 404, "not_found"

class Conflict(AppError):
    status, code = 409, "conflict"


PRODUCTS = {1: {"name": "鍵盤", "stock": 0}}

def reserve(product_id: int) -> dict:
    # service 層只管丟出有意義的例外，不知道 HTTP 的存在
    product = PRODUCTS.get(product_id)
    if product is None:
        raise NotFound(f"商品 {product_id} 不存在")
    if product["stock"] <= 0:
        raise Conflict(f"「{product['name']}」已售完")
    product["stock"] -= 1
    return product


def handle(func, *args):
    """模擬框架最外層的例外處理器：唯一一個把例外翻成 HTTP 的地方。"""
    try:
        return 200, func(*args)
    except AppError as e:              # 預期內的錯誤：4xx，訊息可以給客戶端看
        return e.status, {"error": e.code, "message": str(e)}
    except Exception:                  # 預期外：500，細節只進 log，不回給客戶端
        return 500, {"error": "internal_error"}


print(handle(reserve, 1))
print(handle(reserve, 99))
print(handle(lambda: 1 / 0))
```

在 FastAPI 裡，最外層那一段是 `@app.exception_handler(AppError)` 註冊的處理器；service 和 repository 只需要 `raise`，不需要知道狀態碼怎麼對應（完整的分層見 [Web 框架與請求生命週期](#/skill/web-framework)）。

幾個寫例外時的習慣：

- **捕捉具體的例外**：`except KeyError` 而不是 `except Exception`，更不要寫裸的 `except:`，它連 `KeyboardInterrupt`、`SystemExit` 都會吞掉。
- **轉換時用 `raise … from e`**：保留原始原因，traceback 會顯示 `The above exception was the direct cause of the following exception:`，查問題時看得到根源。
- **不要吞掉之後回傳 None**：`except Exception: return None` 讓呼叫端拿到一個看不出原因的 None，錯誤往後延到別的地方才爆。

## 常見錯誤與錯誤訊息

traceback 從**最後一行**讀起：最後一行是例外型別與訊息；往上找第一個屬於自己程式碼的檔案與行號，通常就是出事的地方。

| 錯誤訊息 | 原因 | 怎麼修 |
|---|---|---|
| `ModuleNotFoundError: No module named 'fastapi'` | 用的 Python 不是專案虛擬環境裡那個（例如系統的 `python3`） | 用 `uv run python …` 或 `uv run uvicorn …` 執行（見 [uv 與專案管理](#/skill/uv-packaging)） |
| `ModuleNotFoundError: No module named 'app'` | 直接執行套件內的檔案，`sys.path` 指到子資料夾 | 在專案根目錄用 `python -m app.seed` |
| `ImportError: cannot import name 'a_func' from partially initialized module 'a' (most likely due to a circular import)` | 循環 import（3.12 的訊息；不同版本措辭可能略有差異） | 把共用的部分抽到第三個模組，讓相依單向 |
| `AttributeError: 'NoneType' object has no attribute 'upper'` | 某個函式回傳了 None（查無資料、忘了 `return`） | 回傳型別標成可能是 None，讓型別檢查器逼呼叫端處理 |
| `TypeError: can't subtract offset-naive and offset-aware datetimes` | 一邊是 `datetime.now()`（沒時區），一邊是帶時區的時間 | 一律用 `datetime.now(timezone.utc)`，存與比較都用 UTC |
| `TypeError: Object of type datetime is not JSON serializable` | 標準 `json.dumps` 不認得 datetime、Decimal | 序列化前轉成 ISO 字串，或交給 pydantic 的 `model_dump(mode="json")` |
| `KeyError: 'user_id'` | 用 dict 傳資料，key 不存在或拼錯 | 在邊界轉成 dataclass／pydantic 模型 |

還有一類不會丟錯，但一樣是事故：

- **狀態「偶爾」不對**：像開頭的購物車，多半是模組層級或預設參數的可變物件被跨請求共用；只有某些 worker 有問題時更是如此。
- **traceback 有兩段，中間寫 `During handling of the above exception, another exception occurred:`**：在 `except` 區塊裡又出錯了，真正的根源在**第一段**。

## 動手

1. 在 Playground 執行「可變預設參數與 late binding」那段，把 `cart=[]` 改成 `cart=()`（tuple 不可變、沒有 `append`），看錯誤訊息怎麼變，想想為什麼不可變的預設值就沒有這個問題。
2. 執行「例外」那段，新增一個 `class Forbidden(AppError)`（403），在 `reserve` 加一條「商品已下架」的規則丟出它；`handle` 不用改就能正確回應。
3. 程式題 [把 dict 轉成有型別的 User](#/exercise/python-backend-1)：在邊界做轉型與驗證。
4. 程式題 [可變預設參數的陷阱](#/exercise/python-backend-2)：修正共用 list 的 bug。
5. 延伸：[程式怎麼跑起來](#/skill/how-programs-run) 解釋行程、執行緒與 GIL；[應用伺服器與程序管理](#/skill/process-servers) 說明 worker 數量怎麼定。

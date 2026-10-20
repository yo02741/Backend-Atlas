## 從一個具體問題開始：測試全綠，上線第一個請求就 500

訂單服務的測試為了快，用 SQLite 記憶體資料庫代替 PostgreSQL。兩百個測試三秒跑完，全部通過。上線後第一個建立訂單的請求就失敗了，log 裡是 PostgreSQL 的錯誤：

```text
psycopg.errors.InvalidTextRepresentation: invalid input syntax for type integer: "abc"
```

前端在某個情況下把 `quantity` 送成了字串，驗證又剛好漏掉。SQLite 預設是「型別親和性」（type affinity）：宣告成 `INTEGER` 的欄位塞進 `'abc'`，它會照存不誤，所以測試從來沒有失敗過。同一類差異還有：`VARCHAR(20)` 在 SQLite 不檢查長度、PostgreSQL 會丟 `value too long for type character varying(20)`；`SELECT … FOR UPDATE` 在 SQLite 是語法錯誤；JSON、陣列、時區型別的行為也都不同。

測試的價值在於「失敗的地方和正式環境一樣」。用假的資料庫測自己的資料層，等於在測一個不存在的系統。這篇從測試的分層講起，再談 pytest 的 fixture、什麼時候該用假物件、怎麼讓測試碰真資料庫又不互相污染，以及為什麼有些測試時好時壞。

## 測試金字塔：每一層測什麼

```text
            ╱╲          端對端（E2E）：少量、慢、測關鍵流程
           ╱  ╲         「註冊 → 下單 → 付款」整條走一遍
          ╱────╲
         ╱      ╲       整合：中等數量，碰真的資料庫、Redis
        ╱        ╲      「repository 寫進 PostgreSQL 再讀回來」
       ╱──────────╲
      ╱            ╲    單元：大量、毫秒級，純邏輯
     ╱              ╲   「折扣規則、金額計算、狀態轉換」
    ╱────────────────╲
```

| 層 | 範圍 | 碰到的外部資源 | 一個測試的時間 | 抓得到 | 抓不到 |
|---|---|---|---|---|---|
| 單元 | 一個函式或類別 | 無（外部依賴用假的取代） | 毫秒以下 | 邏輯錯、邊界條件 | SQL 寫錯、設定錯、元件之間對不上 |
| 整合 | 自己的程式＋自己擁有的基礎設施 | 真的資料庫、Redis、佇列 | 數毫秒到數百毫秒 | SQL、交易、約束、序列化、框架設定 | 跨服務、部署環境的問題 |
| 端對端 | 部署起來的整個系統 | 全部（第三方通常換成沙盒） | 秒級 | 整條流程斷掉、設定與網路 | 很難精確指出哪裡壞 |

邊界怎麼劃，一個實用的判準是：**這個測試失敗時，能不能直接指出是哪段程式的錯？** 單元測試失敗應該一眼看出是哪個函式；整合測試失敗通常是某個查詢或某個元件的接合；端對端失敗只告訴你「這條流程壞了」，要再往下查。所以端對端只留給最關鍵的幾條路徑，細節交給下面兩層。

金字塔是比例的建議，不是規定。資料庫操作佔大部分邏輯的 CRUD 服務，整合測試多一些很合理；重點是**每一層都測它最擅長的東西**，不要用端對端去測折扣的十種邊界條件。

## pytest 怎麼運作

### 收集與 assert

pytest 會找 `test_*.py`（或 `*_test.py`）檔案裡 `test_` 開頭的函式與 `Test` 開頭類別裡的方法。斷言直接寫 `assert`：pytest 在載入測試模組時改寫 assert 敘述，失敗時能印出兩邊的值與差異，不需要 `assertEqual` 那一套方法。

### fixture：依名字注入

fixture 是一個用 `@pytest.fixture` 標記的函式。測試函式的參數名稱就是它要的 fixture，pytest 依名字找到、執行、把結果傳進去；fixture 也可以要求別的 fixture，形成一張依賴圖，概念和 FastAPI 的 `Depends` 一樣。

| 特性 | 說明 |
|---|---|
| `yield` | `yield` 之前是準備，之後是清理；測試失敗也會執行清理 |
| `scope` | `function`（預設，每個測試一次）、`class`、`module`、`package`、`session`（整次執行一次） |
| `conftest.py` | 放在這裡的 fixture，同資料夾與子資料夾的測試都能用，不必 import |
| 快取 | 同一個 scope 內，同一個 fixture 只建立一次，大家共用 |

scope 決定了成本與隔離的取捨：啟動 PostgreSQL 容器很貴，用 `session`；每個測試的交易要互相隔離，用 `function`。規則是**範圍大的 fixture 不能依賴範圍小的**：session 級的 fixture 要一個 function 級的 fixture 時，pytest 會報 `ScopeMismatch`。

### 參數化

同一段測試邏輯、多組輸入時，用 `@pytest.mark.parametrize`，每一組都是一個獨立的測試，報告裡會分別顯示（例如 `test_discount[100-0]`、`test_discount[1000-100]`），一組失敗不影響其他組。

## 假物件與依賴注入

測試替身（test double）有幾種，名稱常被混用，但意思不同：

| 種類 | 做什麼 | 例子 |
|---|---|---|
| stub | 回傳寫死的答案 | 匯率服務永遠回 `31.5` |
| fake | 簡化但能真的運作的實作 | 用 dict 實作的 `InMemoryMailer`，寄出的信存在 list 裡 |
| mock | 記錄被怎麼呼叫，讓測試斷言呼叫內容 | `payment.charge.assert_called_once_with(amount=990)` |
| spy | 包住真的物件，照常執行並記錄呼叫 | 包住真的 repository，事後檢查查了幾次 |

什麼該用替身：

- **該替換**：第三方 API（金流、簡訊、寄信）、時間（`now()`）、亂數、要花錢或有副作用的東西。用不到真的也測得到自己的邏輯，而且真的會讓測試慢又不穩。
- **不該替換**：自己的資料庫、自己的 SQL。這些正是最常出錯的地方，替換掉就測不到了。

讓替換可行的前提是**依賴注入**：函式不要自己去拿依賴（`datetime.now()`、`import` 全域的 client），而是由呼叫端傳進來。這樣正式環境傳真的、測試傳假的，不需要任何 patch 技巧。

`unittest.mock.patch` 是「沒有依賴注入時」的補救。它最常見的坑是**要 patch 被使用的地方，而不是被定義的地方**：`app/services.py` 寫了 `from app.email import send_email`，那麼要 patch 的是 `app.services.send_email`；patch `app.email.send_email` 沒有效果，因為 `services` 模組早就拿到原本那個函式的參考了。

過度使用 mock 的另一個問題：測試斷言的是「呼叫了哪些方法」而不是「結果對不對」，只要重構內部實作，測試就壞，但程式其實沒有錯。優先斷言輸出與狀態，只有「呼叫本身就是結果」時（例如確實寄出一封信）才斷言呼叫。

## 測資料庫：用真的，而且每個測試互不污染

兩種常見做法：

1. **CI 與本機都起一個真的 PostgreSQL**：用 docker compose 或 CI 的 service container，測試開始時跑 migration。
2. **testcontainers**：測試程式自己啟動一個臨時容器，結束時刪掉，不需要事先準備（需要能執行 Docker）。

隔離的做法是**每個測試在交易裡跑、結束時 rollback**：

```text
session 開始：啟動 PostgreSQL、跑 migration（一次）
 ├ test_a：BEGIN → 寫入、斷言 → ROLLBACK   （資料庫回到原狀）
 ├ test_b：BEGIN → 寫入、斷言 → ROLLBACK
 └ test_c：BEGIN → …                        → ROLLBACK
session 結束：停掉容器
```

rollback 比每次清空資料表快得多，也不會因為忘了清某張表而讓測試互相影響。要注意的是：被測的程式碼如果自己呼叫 `commit()`，外層交易就被結束了。SQLAlchemy 2.0 可以讓 Session 加入外層連線的交易，並把程式裡的 commit 變成 savepoint（`join_transaction_mode="create_savepoint"`）；其他工具要查各自的做法。另外，**多個連線、真的並行**的測試（例如驗證 `SELECT … FOR UPDATE` 會擋住另一個交易）沒辦法包在單一交易裡，這類測試要真的 commit，結束後自己清資料。

## 實際程式

### pytest：fixture、參數化、FastAPI 與資料庫

以下需要 pytest、FastAPI、SQLAlchemy、testcontainers 等套件，不能在瀏覽器執行。

```python
# tests/conftest.py
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from testcontainers.postgres import PostgresContainer

from app.main import app
from app.deps import get_db
from app.models import Base


@pytest.fixture(scope="session")
def engine():
    # 整次測試只啟動一個 PostgreSQL 容器（用的映像版本要和正式環境一致）
    with PostgresContainer("postgres:16") as pg:
        eng = create_engine(pg.get_connection_url())
        Base.metadata.create_all(eng)          # 實務上改成跑 migration
        yield eng
        eng.dispose()


@pytest.fixture
def db(engine):
    # 每個測試：開一個連線與交易，程式裡的 commit 變成 savepoint，結束時整個 rollback
    with engine.connect() as conn:
        trans = conn.begin()
        session = Session(bind=conn, join_transaction_mode="create_savepoint")
        yield session
        session.close()
        trans.rollback()


@pytest.fixture
def client(db):
    # 把 app 的 get_db 依賴換成測試用的 session
    app.dependency_overrides[get_db] = lambda: db
    yield TestClient(app)
    app.dependency_overrides.clear()
```

```python
# tests/test_orders.py
import pytest


def test_create_order(client, db):
    r = client.post("/orders", json={"product_id": 1, "qty": 2},
                    headers={"Authorization": "Bearer test-user"})
    assert r.status_code == 201
    assert r.json()["qty"] == 2


@pytest.mark.parametrize("payload, field", [
    ({"product_id": 1, "qty": 0}, "qty"),            # 數量太小
    ({"product_id": "abc", "qty": 1}, "product_id"), # 型別錯
    ({"qty": 1}, "product_id"),                      # 缺欄位
])
def test_create_order_validation(client, payload, field):
    r = client.post("/orders", json=payload, headers={"Authorization": "Bearer test-user"})
    assert r.status_code == 422
    assert r.json()["detail"][0]["loc"][-1] == field


def test_create_order_requires_auth(client):
    r = client.post("/orders", json={"product_id": 1, "qty": 1})
    assert r.status_code == 401
```

同一個 endpoint 的三種情況（正常、驗證失敗、未授權）各自一個測試，失敗時從測試名稱就知道是哪一種壞了。FastAPI 的 `TestClient` 直接呼叫 ASGI 應用程式，不需要真的啟動 server。

### 在瀏覽器裡用 unittest：依賴注入讓時間可以測

```python run
import sys
import unittest
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta

TW = timezone(timedelta(hours=8))

@dataclass
class Coupon:
    code: str
    percent_off: int
    expires_at: datetime

def apply_coupon(amount: int, coupon: Coupon, now: datetime) -> int:
    """now 由呼叫端傳入：正式環境傳 datetime.now(timezone.utc)，測試傳固定時間。"""
    if now >= coupon.expires_at:
        raise ValueError("coupon expired")
    if not 0 < coupon.percent_off <= 100:
        raise ValueError("invalid percent")
    return amount - amount * coupon.percent_off // 100

class ApplyCouponTest(unittest.TestCase):
    def setUp(self):
        # 每個測試前都重新建立，測試之間不共用狀態
        self.coupon = Coupon("OCT10", 10, datetime(2026, 10, 31, 23, 59, tzinfo=TW))

    def test_discount_cases(self):
        # subTest ≈ pytest 的 parametrize：每一組分開報告，一組失敗不會中斷其他組
        before = datetime(2026, 10, 1, tzinfo=TW)
        for amount, expected in [(1000, 900), (999, 900), (1, 1), (0, 0)]:
            with self.subTest(amount=amount):
                self.assertEqual(apply_coupon(amount, self.coupon, before), expected)

    def test_expired_exactly_at_deadline(self):
        with self.assertRaises(ValueError):
            apply_coupon(1000, self.coupon, self.coupon.expires_at)

    def test_timezone_boundary(self):
        # 台灣 11/1 00:30 = UTC 10/31 16:30：仍然已過期（台灣時間 10/31 23:59 截止）
        now_utc = datetime(2026, 10, 31, 16, 30, tzinfo=timezone.utc)
        with self.assertRaises(ValueError):
            apply_coupon(1000, self.coupon, now_utc)

    def test_invalid_percent(self):
        bad = Coupon("BAD", 0, self.coupon.expires_at)
        with self.assertRaisesRegex(ValueError, "invalid percent"):
            apply_coupon(1000, bad, datetime(2026, 10, 1, tzinfo=TW))

suite = unittest.defaultTestLoader.loadTestsFromTestCase(ApplyCouponTest)
result = unittest.TextTestRunner(stream=sys.stdout, verbosity=2).run(suite)
print("全部通過" if result.wasSuccessful() else "有測試失敗")
```

### 每個測試在交易裡跑、結束 rollback

瀏覽器裡沒有 PostgreSQL，下面用 sqlite3 示範**隔離模式本身**；真實專案要換成和正式環境同一種資料庫。

```python run
import sqlite3
import sys
import unittest

# 整個測試類別共用一個連線與 schema（相當於 session 級 fixture）
conn = sqlite3.connect(":memory:", isolation_level=None)   # 自己控制交易
conn.execute("CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, qty INTEGER NOT NULL CHECK (qty > 0))")

class OrderRepo:
    def __init__(self, conn):
        self.conn = conn
    def create(self, user_id: int, qty: int) -> int:
        return self.conn.execute("INSERT INTO orders (user_id, qty) VALUES (?, ?)", (user_id, qty)).lastrowid
    def count(self) -> int:
        return self.conn.execute("SELECT COUNT(*) FROM orders").fetchone()[0]

class OrderRepoTest(unittest.TestCase):
    def setUp(self):
        conn.execute("BEGIN")                 # 每個測試開一個交易（function 級 fixture）
        self.repo = OrderRepo(conn)

    def tearDown(self):
        conn.execute("ROLLBACK")              # 不論成功失敗都撤銷，下一個測試看到乾淨的表

    def test_create_two(self):
        self.repo.create(1, 2)
        self.repo.create(1, 3)
        self.assertEqual(self.repo.count(), 2)

    def test_starts_empty(self):
        # 不論執行順序，這裡都看不到別的測試寫入的資料
        self.assertEqual(self.repo.count(), 0)

    def test_check_constraint(self):
        # 約束是資料庫層的規則：這種測試換成假的 repository 就測不到
        with self.assertRaises(sqlite3.IntegrityError):
            self.repo.create(1, 0)

suite = unittest.defaultTestLoader.loadTestsFromTestCase(OrderRepoTest)
unittest.TextTestRunner(stream=sys.stdout, verbosity=2).run(suite)
print("測試結束後資料表筆數：", conn.execute("SELECT COUNT(*) FROM orders").fetchone()[0])

# SQLite 和 PostgreSQL 的差異：這兩句在 SQLite 都會成功，在 PostgreSQL 都會失敗
conn.execute("CREATE TABLE t (n INTEGER, name VARCHAR(5))")
conn.execute("INSERT INTO t VALUES ('abc', 'much longer than five')")
print("SQLite 照存：", conn.execute("SELECT n, typeof(n), name FROM t").fetchone())
```

## 常見錯誤與錯誤訊息

**fixture 名稱打錯或沒放在 conftest.py**：

```text
E       fixture 'db' not found
>       available fixtures: cache, capfd, capsys, client, monkeypatch, tmp_path, ...
>       use 'pytest --fixtures [testpath]' for help on them.
```

看 `available fixtures` 清單裡有沒有想要的那個；沒有的話，通常是 fixture 定義在另一個測試檔、而不是共用的 `conftest.py`，或 `conftest.py` 不在測試的上層資料夾。

**scope 衝突**：

```text
ScopeMismatch: You tried to access the function scoped fixture per_test with a session scoped request object.
```

session 級的 fixture 依賴了 function 級的 fixture。把依賴的那個改成更大的 scope，或讓大範圍的 fixture 不要依賴它。

**assert 失敗時的差異**：

```text
E       AssertionError: assert {'a': 1, 'b': 2} == {'a': 1, 'b': 3}
E         Omitting 1 identical items, use -vv to show
E         Differing items:
E         {'b': 2} != {'b': 3}
```

pytest 已經指出不同的那個 key；資料很大時加 `-vv` 看完整內容。

**不穩定（flaky）的測試**：同一份程式碼，有時過、有時不過。常見原因：

| 成因 | 典型症狀 | 修法 |
|---|---|---|
| 依賴現在時間 | 只在午夜、月底、跨時區時失敗 | 把時間當參數傳入（如上面的 `now`），或用固定時鐘 |
| 測試之間共用狀態 | 單獨跑會過，全部一起跑或換順序就失敗 | 每個測試自己準備資料；DB 用交易 rollback；不改全域變數 |
| 用 `sleep` 等非同步結果 | CI 機器比較慢時失敗 | 改成輪詢條件、加上限時間，或直接 await 結果 |
| 結果順序不固定 | 比對 list 偶爾不相等 | SQL 加 `ORDER BY`；比對時排序，或比較 set |
| 真的連外部網路 | 對方慢或掛掉時失敗 | 單元與整合測試把第三方換成 fake |
| 亂數 | 某些種子才失敗 | 固定種子，或讓亂數來源可注入 |

不穩定的測試不要用「重跑到過」解決。它會讓團隊習慣忽略紅燈，真正的錯誤混在裡面也會被重跑掉。

## 動手

1. 執行「依賴注入讓時間可以測」那段，把 `test_timezone_boundary` 的 `16, 30` 改成 `15, 30`（台灣時間 10/31 23:30），測試會失敗：讀懂失敗訊息後，改寫成一個「截止前一刻仍然有效」的正向測試。
2. 在同一段加一組 `(15, 13)` 到 `test_discount_cases`（「打九折後四捨五入」的期待），觀察 subTest 的失敗報告長什麼樣：程式用整數除法，折扣 1.5 元被捨成 1 元。想想哪一種捨入才符合商業需求，再決定要改測試還是改程式。
3. 執行「交易 rollback」那段，把 `tearDown` 裡的 `ROLLBACK` 改成 `COMMIT`，再看 `test_starts_empty` 是否還會通過、結尾的筆數變多少。
4. 為一個自己寫過的 API 設計三個測試：正常、驗證失敗、未授權，各自屬於金字塔的哪一層？
5. 延伸：測試要接進 CI，見 [CI 管線：lint、test、build](#/skill/ci-pipeline)；並行情境（兩個交易搶同一列）怎麼測，見 [交易、ACID 與隔離等級](#/skill/transactions)。

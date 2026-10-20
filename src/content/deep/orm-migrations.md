## 從一個具體問題開始：列表頁只有 50 筆，卻送了 51 句 SQL

後台的「最近訂單」頁一次顯示 50 張訂單，每列要印出下單者名字。用 ORM 寫起來很自然：

```python
orders = session.scalars(select(Order).order_by(Order.id.desc()).limit(50)).all()
for o in orders:
    print(o.id, o.user.name, o.amount)   # 看起來只是讀一個屬性
```

本機很快，上線後同一頁要 800 ms。打開 SQL log：

```text
SELECT orders.id, orders.user_id, orders.amount FROM orders ORDER BY orders.id DESC LIMIT 50
SELECT users.id, users.name FROM users WHERE users.id = 17
SELECT users.id, users.name FROM users WHERE users.id = 3
SELECT users.id, users.name FROM users WHERE users.id = 42
...（再 40 幾句，形狀一樣、只差參數）
```

第一句取訂單，之後迴圈每碰一次 `o.user`，ORM 就送一句查使用者。每句只要 1–2 ms，但每趟都要付一次網路來回。這就是 **N+1 查詢**：1 句取清單，再加 N 句取每一筆的關聯資料。程式碼裡看不到任何 SQL，問題只在 log 裡看得見。

## ORM 做了什麼

ORM（Object-Relational Mapping）把資料表映射成類別、把列映射成物件。以 SQLAlchemy 2.0 為例：

| 機制 | 做什麼 |
|---|---|
| 映射（mapping） | `class Order` 對應 `orders` 表，`relationship()` 對應外鍵關係 |
| Identity map | 同一個 session 裡，同一個主鍵只有一個 Python 物件；再取一次不一定再查 |
| Unit of work | 追蹤新增、修改、刪除的物件，`flush()` 時依相依順序產生 INSERT / UPDATE / DELETE；`session.add()` 不會立刻寫資料庫 |
| 延遲載入（lazy loading） | 關聯屬性第一次被讀取時才發 SELECT，N+1 的來源 |

延遲載入本身不是錯誤，問題是**在迴圈裡**觸發它。N 到底是多少，要看關聯方向。`o.user` 是多對一，SQLAlchemy 在發 SELECT 前會先查 identity map，同一個使用者只查一次，所以 50 張訂單如果來自 20 位使用者，就是 1 + 20 句。反過來的一對多 `user.orders`，每個使用者都得查一次，就是 1 + N。

### 兩種 eager loading

事先告訴 ORM 要用到哪些關聯、讓它一次取回，叫做 eager loading：

| 策略 | 產生的 SQL | 適合 | 注意 |
|---|---|---|---|
| `joinedload` | 主查詢加 `LEFT OUTER JOIN`，1 句 | 多對一（訂單 → 使用者） | 用在一對多會讓主表的列重複，2.0 要對結果呼叫 `.unique()` |
| `selectinload` | 主表 1 句 + `WHERE id IN (...)` 1 句 | 一對多、多層關聯 | IN 清單很長時會分批 |
| `raiseload` | 不載入，讀到就丟例外 | 不該用到的關聯 | 把 N+1 變成看得見的錯誤 |

## 實際程式：從 SQL log 認出 N+1

### 用 sqlite3 數查詢次數

下面用標準函式庫的 `sqlite3` 重現三種載入方式。`set_trace_callback` 會把每一句實際執行的 SQL 交給你，效果相當於打開 ORM 的 SQL log。延遲載入的版本用一個 dict 模擬 identity map：

```python run
# 用標準函式庫 sqlite3 重現 ORM 的三種載入方式，數一數各送出幾句 SQL
import sqlite3

conn = sqlite3.connect(":memory:")
conn.executescript("""
CREATE TABLE users  (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, amount INTEGER);
""")
conn.executemany("INSERT INTO users VALUES (?, ?)", [(i, f"user{i}") for i in range(1, 21)])
conn.executemany("INSERT INTO orders VALUES (?, ?, ?)",
                 [(i, (i % 20) + 1, 100 * i) for i in range(1, 51)])   # 50 張訂單、20 位使用者

log = []                                   # 相當於 create_engine(..., echo=True)
conn.set_trace_callback(log.append)

def run(label, fn):
    log.clear()
    rows = fn()
    print(f"{label}：查詢 {len(log)} 次，結果 {len(rows)} 列")
    for sql in log[:3]:
        print("   ", " ".join(sql.split())[:72])
    if len(log) > 3:
        print(f"    …另外 {len(log) - 3} 句形狀一樣，只差參數")

def lazy():
    # 延遲載入：迴圈裡每碰一次 order.user 就可能查一次；identity_map 模擬「同一個使用者只查一次」
    identity_map = {}
    orders = conn.execute("SELECT id, user_id, amount FROM orders ORDER BY id").fetchall()
    out = []
    for oid, uid, amount in orders:
        if uid not in identity_map:
            identity_map[uid] = conn.execute("SELECT id, name FROM users WHERE id = ?", (uid,)).fetchone()[1]
        out.append((oid, identity_map[uid], amount))
    return out

def joined():
    # joinedload：一句 JOIN 全部拿回來
    return conn.execute("""SELECT o.id, u.name, o.amount
                           FROM orders o LEFT JOIN users u ON u.id = o.user_id
                           ORDER BY o.id""").fetchall()

def selectin():
    # selectinload：先取訂單，再用一句 IN (...) 取回用到的使用者，在記憶體裡配對
    orders = conn.execute("SELECT id, user_id, amount FROM orders ORDER BY id").fetchall()
    ids = sorted({uid for _, uid, _ in orders})
    marks = ",".join("?" * len(ids))
    users = dict(conn.execute(f"SELECT id, name FROM users WHERE id IN ({marks})", ids).fetchall())
    return [(oid, users[uid], amount) for oid, uid, amount in orders]

run("延遲載入（N+1）", lazy)
run("joinedload", joined)
run("selectinload", selectin)
assert lazy() == joined() == selectin()     # 結果完全相同，差別只在查詢次數
```

從 log 認 N+1 的特徵很固定：**一句取清單，緊接著一大串形狀相同、只有 WHERE 參數不同的 SELECT**。正式環境要看的是「每個請求的查詢次數」：APM 工具通常會把一個請求內的 SQL 列成時間軸；沒有工具時，在測試裡數查詢次數，超過門檻就讓測試失敗。

### SQLAlchemy 2.0 的寫法

以下需要真的資料庫與 SQLAlchemy 套件，不能在瀏覽器裡跑：

```python
from decimal import Decimal
from sqlalchemy import ForeignKey, String, create_engine, select
from sqlalchemy.orm import (DeclarativeBase, Mapped, Session, mapped_column,
                            relationship, selectinload, joinedload, raiseload)

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    orders: Mapped[list["Order"]] = relationship(back_populates="user")

class Order(Base):
    __tablename__ = "orders"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    amount: Mapped[Decimal]
    user: Mapped[User] = relationship(back_populates="orders")

# echo=True：把每一句 SQL 印到 log，開發時找 N+1 最直接的方法
engine = create_engine("postgresql+psycopg://app@localhost/shop", echo=True)

with Session(engine) as session:
    # 多對一用 joinedload：一句 JOIN
    stmt = select(Order).options(joinedload(Order.user)).order_by(Order.id.desc()).limit(50)
    for o in session.scalars(stmt):
        print(o.id, o.user.name)

    # 一對多用 selectinload：兩句（users 一句、orders 一句 IN）
    stmt = select(User).options(selectinload(User.orders))
    for u in session.scalars(stmt):
        print(u.name, len(u.orders))

    # raiseload("*")：這次查詢的所有關聯都不准延遲載入，讀到就丟例外
    stmt = select(Order).options(raiseload("*"))
```

也可以用 `relationship(lazy="raise")` 把預設改成不准延遲載入：比較囉嗦，但 N+1 會在開發時以例外出現，而不是在正式環境變成慢。

## Session 與交易邊界

SQLAlchemy 2.0 的 `Session` 在送出第一句 SQL 時自動開始交易（autobegin），到 `commit()` 或 `rollback()` 才結束。session 的壽命要跟一個工作單位對齊，通常是一個 HTTP 請求：

```python
from sqlalchemy.orm import sessionmaker

SessionLocal = sessionmaker(engine, expire_on_commit=False)

def create_order(user_id: int, amount: Decimal) -> int:
    # session.begin()：區塊正常結束就 commit，丟例外就 rollback；外層 with 結束時關閉 session、歸還連線
    with SessionLocal() as session, session.begin():
        order = Order(user_id=user_id, amount=amount)
        session.add(order)
        session.flush()          # 送出 INSERT 拿到 order.id，但還沒 commit
        return order.id

# FastAPI 的常見寫法：每個請求一個 session，用 yield 依賴確保關閉
def get_session():
    with SessionLocal() as session:
        yield session
```

幾個容易誤會的地方：

- **`flush` 不是 `commit`**：flush 把變更送進資料庫，只有同一個交易看得到；commit 才讓別人看得到。
- **`expire_on_commit` 預設是 True**：commit 之後屬性全部過期，下次讀取會再查資料庫；session 已經關了就會失敗。物件要拿到 session 外使用時，設成 False 或先轉成 dict / pydantic model。
- **長壽的 session 是陷阱**：全域共用的 session 會一直握著舊交易的快照、identity map 越長越大、連線不歸還；它也不是執行緒安全的。
- **交易裡不要做外部呼叫**，理由見 [交易與隔離等級](#/skill/transactions)。
- **`AsyncSession` 不能延遲載入**：屬性存取時沒辦法偷偷 await，觸發就失敗，所以 async 程式幾乎一定要 eager loading。

## Migration：schema 的版本控制

Migration 工具把每次 schema 變更寫成有順序的腳本，並在資料庫裡記錄目前套用到哪一版。SQLAlchemy 生態系用 Alembic：

```bash
alembic init migrations                              # 建立 migrations/ 與 alembic.ini
alembic revision --autogenerate -m "add display_name to users"   # 比對 model 與資料庫，產生腳本
alembic upgrade head                                 # 套用到最新版
alembic current                                      # 目前資料庫在哪一版
alembic history                                      # 版本鏈
alembic downgrade -1                                 # 退回上一版
alembic upgrade head --sql                           # 不執行，只印出會跑的 SQL（給人審）
```

版本記在資料庫的 `alembic_version` 表；每個腳本記得自己的上一版（`down_revision`），串成一條鏈：

```python
"""add display_name to users"""
from alembic import op
import sqlalchemy as sa

revision = "3f2a9c1d7b10"
down_revision = "a81c04e5d2f3"

def upgrade() -> None:
    op.add_column("users", sa.Column("display_name", sa.Text(), nullable=True))

def downgrade() -> None:
    op.drop_column("users", "display_name")
```

**autogenerate 的結果一定要人工檢查**。它比對的是 model 與資料庫的差異，看不出意圖：

- 欄位 `name` 改名成 `full_name`，它看到的是少了一欄、多了一欄，產生**刪欄 + 加欄**，套用下去資料就沒了。改名要自己處理，而且通常不能直接改名（見下一節）。
- 有些變更偵測不到或不完整，以 Alembic 文件列出的限制為準；它也不會替你考慮鎖與大表。

## 可安全上線的 migration

在一張很大、很忙的表上執行 DDL，最大的風險不是執行多久，而是**鎖**。多數 `ALTER TABLE` 要拿 `ACCESS EXCLUSIVE` 鎖，這個鎖會擋住包括 SELECT 在內的所有操作。可以直接看到：

```sql run
-- 在交易裡做 DDL，然後看這張表上被拿了什麼鎖（ROLLBACK 之後一切復原）
BEGIN;
ALTER TABLE users ADD COLUMN phone text;
SELECT relation::regclass AS 表, mode AS 鎖模式, granted FROM pg_locks WHERE relation = 'users'::regclass;
ROLLBACK;

-- 一般的 CREATE INDEX 拿的是 SHARE 鎖：讀可以，寫（INSERT / UPDATE / DELETE）全部要等
BEGIN;
CREATE INDEX idx_orders_user ON orders (user_id);
SELECT relation::regclass AS 表, mode AS 鎖模式 FROM pg_locks WHERE relation = 'orders'::regclass;
ROLLBACK;
```

`ADD COLUMN` 本身瞬間完成，但要先**排隊拿到** ACCESS EXCLUSIVE 鎖。表上有一個跑了 3 分鐘的報表查詢，ALTER 就等 3 分鐘，而排在 ALTER 後面的一般查詢也全部跟著等。所以 migration 開頭通常設 `SET lock_timeout = '5s'`：拿不到鎖就放棄、稍後重試。排隊細節見 [鎖與死結](#/skill/locks-deadlocks)。

### 各種變更的安全做法

| 變更 | 直接做的問題 | 安全做法 |
|---|---|---|
| 加可為 NULL 的欄位 | 只改目錄 | 直接加（仍設 `lock_timeout`） |
| 加欄位帶 DEFAULT | PostgreSQL 11 起常數 DEFAULT 不重寫表；volatile 函數（如 `clock_timestamp()`）仍會重寫整張表 | 用常數 DEFAULT |
| 欄位改成 NOT NULL | `SET NOT NULL` 要在 ACCESS EXCLUSIVE 鎖下掃整張表確認沒有 NULL | 先加 `CHECK (col IS NOT NULL) NOT VALID`，再 `VALIDATE CONSTRAINT`，最後 `SET NOT NULL`（PostgreSQL 12 起看到已驗證的 CHECK 就跳過掃描） |
| 加外鍵 | 驗證既有資料時鎖住兩張表 | `ADD CONSTRAINT … NOT VALID`，修好髒資料後再 `VALIDATE CONSTRAINT` |
| 加索引 | `CREATE INDEX` 期間擋住所有寫入 | `CREATE INDEX CONCURRENTLY`：不擋寫入，但較慢、不能在交易區塊內執行 |
| 改欄位名、改型別 | 新舊程式碼同時在跑時，其中一方一定找不到欄位 | expand–contract（下面說明） |
| 大量回填資料 | 一句 UPDATE 千萬列：長交易、大量 WAL、表膨脹 | 分批（每批幾千列）、每批獨立 commit |

`VALIDATE CONSTRAINT` 拿的是 `SHARE UPDATE EXCLUSIVE` 鎖，掃描期間一般讀寫不受影響，這是「先 NOT VALID、再 VALIDATE」安全的關鍵。

### 加一個必填欄位：nullable → 回填 → 約束

下面在範例資料庫的 `users` 上加一個必填的 `display_name`，每一步在正式環境都是獨立的、可以中斷的步驟：

```sql run
-- 步驟 1：加可為 NULL 的欄位（只改目錄，瞬間完成）
ALTER TABLE users ADD COLUMN display_name text;

-- 步驟 2：分批回填（正式環境每批幾千列、每批各自 commit；這裡示意成兩批）
UPDATE users SET display_name = name WHERE id BETWEEN 1 AND 3 AND display_name IS NULL;
UPDATE users SET display_name = name WHERE id BETWEEN 4 AND 6 AND display_name IS NULL;

-- 步驟 3：加 CHECK 但先不驗證既有資料（NOT VALID：只擋之後的新資料，鎖很短）
ALTER TABLE users ADD CONSTRAINT users_display_name_not_null CHECK (display_name IS NOT NULL) NOT VALID;

-- 步驟 4：驗證既有資料（SHARE UPDATE EXCLUSIVE 鎖，不擋讀寫）
ALTER TABLE users VALIDATE CONSTRAINT users_display_name_not_null;

-- 步驟 5：SET NOT NULL 看到已驗證的 CHECK，不用再掃表；之後 CHECK 就可以拿掉
ALTER TABLE users ALTER COLUMN display_name SET NOT NULL;
ALTER TABLE users DROP CONSTRAINT users_display_name_not_null;

SELECT column_name, is_nullable FROM information_schema.columns
WHERE table_name = 'users' AND column_name = 'display_name';
```

外鍵同理。範例資料的訂單 105 的 `user_id = 9` 找不到使用者，直接加外鍵會失敗：

```sql run
-- NOT VALID：從現在起新寫入的資料要符合外鍵，但先不檢查既有資料
ALTER TABLE orders ADD CONSTRAINT orders_user_fk FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;

-- 找出既有的孤兒資料
SELECT o.id, o.user_id FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE u.id IS NULL;

-- 依業務決定怎麼修（這裡把找不到的使用者設成 NULL；外鍵允許 NULL）
UPDATE orders SET user_id = NULL WHERE user_id NOT IN (SELECT id FROM users);

-- 驗證既有資料，成功後約束就是完整有效的
ALTER TABLE orders VALIDATE CONSTRAINT orders_user_fk;
SELECT conname, convalidated FROM pg_constraint WHERE conname = 'orders_user_fk';
```

### 大表加索引：CONCURRENTLY

`CREATE INDEX CONCURRENTLY` 比一般建索引慢（掃表兩次、要等既有交易結束），但期間寫入照常。兩個限制：

- **不能在交易區塊裡執行**。Alembic 預設把每個 migration 包在交易裡，要用 `autocommit_block()` 跳出來：

```python
def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.create_index("ix_orders_user_id", "orders", ["user_id"], postgresql_concurrently=True)

def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.drop_index("ix_orders_user_id", table_name="orders", postgresql_concurrently=True)
```

- **失敗會留下 INVALID 索引**（例如唯一索引遇到重複值）：查詢不用它，寫入卻還要維護它。用 `SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;` 找出來，`DROP INDEX CONCURRENTLY` 後重建。

### 改欄位名：expand–contract

滾動部署時新舊版程式會同時跑幾分鐘，直接 `RENAME COLUMN` 會讓其中一方出錯。expand–contract 把一次不相容的變更拆成多次相容的變更：

| 階段 | Migration | 程式碼 | 這時新舊程式能共存嗎 |
|---|---|---|---|
| 1. Expand | 加 `full_name`（nullable） | 不變 | 能：舊程式不知道新欄位 |
| 2. 雙寫 | 無 | 寫入時同時寫 `name` 與 `full_name`，讀仍讀 `name` | 能 |
| 3. 回填 | 分批 `UPDATE … SET full_name = name WHERE full_name IS NULL` | 不變 | 能 |
| 4. 切讀取 | 必要時加 NOT NULL（用上一節的做法） | 改讀 `full_name`，仍雙寫 | 能 |
| 5. 停寫舊欄 | 無 | 從 model 拿掉 `name` | 能：資料庫還有 `name`，只是沒人用 |
| 6. Contract | 刪掉 `name` | 不變 | 能 |

雙寫也可以用 trigger 做，代價是多一段藏在資料庫裡的邏輯。改型別（`integer` 改 `bigint`）是同一個流程。

## Migration 與部署順序

規則只有一條：**每一次 migration 都要跟正在跑的程式碼相容**。實務上的順序：

1. **加東西（expand）先跑 migration，再部署程式**。新欄位、新表、新索引先存在，舊程式不受影響，新程式上線時就用得到。
2. **刪東西（contract）先部署程式，再跑 migration**。先讓程式完全不用某個欄位，下一次部署才刪它。
3. **ORM 會 SELECT model 上所有欄位**。從資料庫刪掉一個欄位，但正在跑的程式 model 裡還有它，每個查詢都會出現 `column "…" does not exist`。所以是「先從 model 拿掉 → 部署 → 再刪欄位」。

常見做法是在 CI/CD 部署步驟裡、新版上線前**跑一次**（獨立的 job）。每個實例啟動時自動 `upgrade head` 比較危險：十個實例就有十個程序搶著改 schema，migration 失敗還會變成服務起不來。

`downgrade` 寫得出來不代表能安全執行，刪掉的資料回不來；很多團隊選擇只往前修（再寫一個 migration）。正式環境跑 migration 前先確認有可用的備份，見 [資料庫維運](#/skill/db-operations)。

## 常見錯誤與錯誤訊息

| 錯誤訊息 | 來源 | 原因 | 怎麼修 |
|---|---|---|---|
| `DetachedInstanceError: Parent instance <Order at 0x…> is not bound to a Session; lazy load operation of attribute 'user' cannot proceed` | SQLAlchemy | session 關閉後才讀延遲載入的關聯 | 在 session 內用 eager loading 載好；或在 session 內轉成 DTO |
| `PendingRollbackError: This Session's transaction has been rolled back due to a previous exception during flush.` | SQLAlchemy | 前一次 flush 失敗後，沒有 rollback 就繼續用同一個 session | 找出第一個例外；出錯時 `session.rollback()`，或用 `session.begin()` 區塊自動處理 |
| `FAILED: Target database is not up to date.` | Alembic | 資料庫還沒升到最新版就執行 `revision --autogenerate` | 先 `alembic upgrade head` 再產生新腳本 |
| `Multiple head revisions are present for given argument 'head'` | Alembic | 兩個分支各自新增了 migration，版本鏈分岔 | `alembic merge heads -m "merge"` 產生合併版本，再檢查兩邊有沒有衝突 |
| `column "display_name" of relation "users" contains null values` | PostgreSQL | 還有 NULL 就 `SET NOT NULL` | 先回填，再用 CHECK NOT VALID → VALIDATE 的流程 |
| `CREATE INDEX CONCURRENTLY cannot run inside a transaction block` | PostgreSQL | 在交易裡（包含 Alembic 預設的 migration 交易）執行 CONCURRENTLY | Alembic 用 `autocommit_block()` |
| `canceling statement due to lock timeout` | PostgreSQL | `lock_timeout` 內拿不到鎖 | 這是設計好的保護；找出擋住的長查詢（`pg_stat_activity`），離峰再試 |

沒有錯誤訊息但同樣常見的情況：

- **N+1 只在資料多時才慢**，要在測試裡數查詢次數才抓得到回歸。
- **autogenerate 把改名變成刪欄 + 加欄**，沒 review 就套用，資料直接消失。
- **staging 很快、正式環境很久**：表的大小差好幾個量級，回填與驗證時間也是。

## 動手

1. 執行 sqlite3 那段，把使用者數從 20 改成 50（`range(1, 51)`，訂單的 `% 20` 改成 `% 50`），看延遲載入的查詢次數怎麼變；再想想一對多 `user.orders` 會是幾次。
2. 執行「nullable → 回填 → 約束」那段，然後在 Playground 拿掉回填的第二句 UPDATE 再跑一次，看在哪一步失敗、錯誤訊息是什麼。
3. 在 Playground 試 `CREATE INDEX CONCURRENTLY idx_orders_user ON orders (user_id);` 單獨執行會成功；前面加上 `BEGIN;` 就會得到上面表格裡的錯誤（之後記得執行 `ROLLBACK;` 或按重設）。
4. 寫下你專案裡一次「改欄位名」的 expand–contract 計畫：每一步的 migration、程式碼變更、部署順序各是什麼。

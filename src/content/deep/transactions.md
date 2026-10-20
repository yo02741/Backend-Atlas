## 從一個具體問題開始：最後一件商品賣給了兩個人

商品 `id = 1` 的庫存剩 1 件。兩位使用者幾乎同時按下「購買」，伺服器上兩個請求各自執行同一段程式：

```python
# 很常見、也很危險的寫法：讀出來、在程式裡判斷、再寫回去
stock = db.fetch_one("SELECT stock FROM products WHERE id = 1")
if stock > 0:
    db.execute("UPDATE products SET stock = %s WHERE id = 1", [stock - 1])
    db.execute("INSERT INTO orders (user_id, status, amount) VALUES (%s, 'paid', 990)", [user_id])
```

兩個請求交錯執行時，時間線是這樣：

| 時間 | 請求 A | 請求 B | 資料庫裡的 stock |
|---|---|---|---|
| t1 | 讀到 stock = 1 | | 1 |
| t2 | | 讀到 stock = 1 | 1 |
| t3 | 判斷 1 > 0，寫入 stock = 0 | | 0 |
| t4 | | 判斷 1 > 0，寫入 stock = 0 | 0 |
| t5 | 建立訂單 | 建立訂單 | 0 |

最後庫存是 0，看起來沒事，但成立了兩張訂單。B 在 t4 寫入的「0」是根據 t2 讀到的舊值算出來的，A 的扣減就這樣被蓋掉了。這叫做 **lost update（更新遺失）**。

這段程式就算包在交易裡（`BEGIN … COMMIT`）也一樣會出事。交易不是「把這段程式鎖起來」，它保證的是另外幾件事。要防住這種狀況，得先搞清楚交易到底保證了什麼、沒保證什麼。

## 交易保證什麼：ACID

| 字母 | 意思 | 具體來說 |
|---|---|---|
| A — Atomicity 原子性 | 全部成功或全部不算 | 扣庫存成功、建訂單失敗時，扣庫存也會被撤銷（ROLLBACK） |
| C — Consistency 一致性 | 約束永遠成立 | `CHECK (stock >= 0)`、外鍵、唯一鍵在交易結束時一定成立，否則整個交易失敗 |
| I — Isolation 隔離性 | 並行的交易彼此看得到多少 | 由**隔離等級**決定，不是「完全看不到」 |
| D — Durability 持久性 | COMMIT 之後就不會消失 | 回傳成功前已寫入 WAL（預寫日誌），斷電重開也還在 |

前面的超賣問題出在 **I**：PostgreSQL 預設的隔離等級是 `READ COMMITTED`，它允許兩個交易讀到同一個舊值。

## 運作原理：MVCC 與快照

PostgreSQL 不是讓讀取去等寫入的鎖，而是用 **MVCC（多版本並行控制）**：每次 `UPDATE` 都寫出這一列的新版本，舊版本留著，直到沒有交易需要它為止（之後由 `VACUUM` 清掉）。每一列都有兩個系統欄位：

- `xmin`：建立這個版本的交易編號
- `xmax`：刪除或更新掉這個版本的交易編號（還有效的版本是 0）

每個查詢拿著一份**快照**（snapshot）：「哪些交易已經 commit」。看到一列時，用 `xmin` / `xmax` 判斷這個版本對自己可不可見。所以讀不擋寫、寫不擋讀，只有**兩個交易寫同一列**時才需要排隊。

可以直接看到版本號怎麼變：

```sql run
-- xmin 是寫出這一版資料的交易編號；UPDATE 之後它會變，代表那一列換成了新版本
SELECT id, name, stock, xmin, xmax FROM products WHERE id = 1;
UPDATE products SET stock = stock - 1 WHERE id = 1;
SELECT id, name, stock, xmin, xmax FROM products WHERE id = 1;
```

### 隔離等級：快照什麼時候拍

| 隔離等級 | 快照的時機 | 同一交易內重讀 | 兩個交易更新同一列時 |
|---|---|---|---|
| `READ COMMITTED`（PostgreSQL 預設） | **每一句**開始時重拍 | 可能讀到別人剛 commit 的新值 | 後到的等前一個結束，然後**用最新版本重新檢查 WHERE** 再更新 |
| `REPEATABLE READ` | 交易的**第一句**時拍一次 | 一定讀到同樣的值 | 後到的等前一個 commit 後**直接失敗**：`could not serialize access due to concurrent update` |
| `SERIALIZABLE` | 同 REPEATABLE READ，另外追蹤讀寫相依 | 一定讀到同樣的值 | 只要結果無法等同某個先後順序執行，就有一方失敗（同樣是 SQLSTATE `40001`），要重試 |

`READ UNCOMMITTED` 在 PostgreSQL 裡的行為和 `READ COMMITTED` 一樣，永遠讀不到別人沒 commit 的資料。

### 把「讀 → 算 → 寫」換成一句

回到超賣。在 `READ COMMITTED` 下，最簡單也最可靠的做法，是讓資料庫在**同一句**裡完成判斷和扣減：

```sql run
-- 只有庫存還夠時才扣；RETURNING 讓應用程式知道到底有沒有扣成功
UPDATE products SET stock = stock - 1
WHERE id = 1 AND stock > 0
RETURNING id, stock;
```

兩個請求同時執行這一句時：

| 時間 | 交易 A | 交易 B |
|---|---|---|
| t1 | `UPDATE … WHERE stock > 0`：拿到列鎖，stock 1 → 0 | |
| t2 | | 同一句：這一列被 A 鎖著，**等待** |
| t3 | `COMMIT`，釋放鎖 | |
| t4 | | 拿到鎖，用**最新版本**（stock = 0）重新檢查 `stock > 0`，不成立，更新 0 列 |

B 收到「更新了 0 列」（`RETURNING` 回空），應用程式就知道售完了，不建立訂單。關鍵在 t4：READ COMMITTED 下，被擋住的 `UPDATE` 拿到鎖後，會用那一列的最新版本重新評估 WHERE 條件。

### 需要先讀再決定時：鎖住那一列

有時候判斷邏輯太複雜，沒辦法塞進一句 `WHERE`，例如要看會員等級、限購數量。這時用 `SELECT … FOR UPDATE` 先鎖住要改的列，其他想改（或也想 `FOR UPDATE`）同一列的交易會排隊，直到你 commit：

```sql
BEGIN;
SELECT stock FROM products WHERE id = 1 FOR UPDATE;   -- 鎖住這一列，別人要等
-- 應用程式在這裡做判斷（限購、會員等級…）
UPDATE products SET stock = stock - 1 WHERE id = 1;
INSERT INTO orders (user_id, status, amount) VALUES (42, 'paid', 990);
COMMIT;
```

第三種做法是**樂觀鎖**：資料表加一個 `version` 欄位，更新時寫 `WHERE id = 1 AND version = <讀到的版本>`。更新到 0 列就代表有人先改了，重讀再試。這種做法適合衝突很少、不想讓別人排隊的情況。

## 實際程式：交易要短，失敗要能重試

Python 裡用 psycopg（PostgreSQL 官方推薦的驅動）時，交易大致長這樣（需要真的資料庫，不能在瀏覽器裡跑）：

```python
import psycopg
from psycopg import errors

def buy(conn: psycopg.Connection, product_id: int, user_id: int) -> bool:
    # with conn.transaction()：區塊正常結束就 COMMIT，丟出例外就 ROLLBACK
    with conn.transaction():
        row = conn.execute(
            "UPDATE products SET stock = stock - 1 "
            "WHERE id = %s AND stock > 0 RETURNING stock",
            [product_id],
        ).fetchone()
        if row is None:          # 0 列：售完
            return False
        conn.execute(
            "INSERT INTO orders (user_id, status, amount) VALUES (%s, 'paid', 990)",
            [user_id],
        )
    return True

def buy_with_retry(conn, product_id, user_id, attempts=3):
    # REPEATABLE READ / SERIALIZABLE 下，序列化失敗（40001）是正常現象：整個交易重做
    for i in range(attempts):
        try:
            return buy(conn, product_id, user_id)
        except errors.SerializationFailure:
            if i == attempts - 1:
                raise
```

幾個原則：

- **交易越短越好**。交易期間握著列鎖和快照。在交易裡呼叫外部 API（金流、寄信）是很常見的事故來源：外部服務慢 10 秒，這一列就被鎖 10 秒，後面的請求全部排隊。外部呼叫放到交易之外，必要時用 outbox 模式（同一個交易寫入「待發送」表，交給背景工作處理）。
- **重試的單位是整個交易**，不是失敗的那一句。交易裡任何一句失敗後，整個交易已經作廢。
- **重試要有上限**，並且只重試可以重試的錯誤（`40001` 序列化失敗、`40P01` 死結），不要連違反唯一鍵這種邏輯錯誤也重試。

下面用一段純 Python 模擬兩種寫法交錯執行的結果，可以直接執行：

```python run
# 模擬兩個請求交錯執行：每個請求拆成「讀」「寫」兩步，依照指定順序跑
def simulate(order, atomic):
    db = {"stock": 1, "orders": 0}
    seen = {}
    for who, step in order:
        if atomic:
            # 一句完成：判斷和扣減之間不會插進別人的步驟
            if step == "write":
                if db["stock"] > 0:
                    db["stock"] -= 1
                    db["orders"] += 1
        else:
            if step == "read":
                seen[who] = db["stock"]            # 讀出來放在程式的變數裡
            elif step == "write" and seen[who] > 0:  # 用舊值判斷
                db["stock"] = seen[who] - 1
                db["orders"] += 1
    return db

interleaved = [("A", "read"), ("B", "read"), ("A", "write"), ("B", "write")]
print("讀→算→寫：", simulate(interleaved, atomic=False))   # 兩張訂單
print("一句完成：", simulate(interleaved, atomic=True))    # 一張訂單
```

## 常見錯誤與錯誤訊息

| 錯誤訊息（PostgreSQL） | SQLSTATE | 發生原因 | 怎麼處理 |
|---|---|---|---|
| `current transaction is aborted, commands ignored until end of transaction block` | `25P02` | 交易裡前面某一句已經失敗，之後送的每一句都會被拒絕 | 找出**第一個**錯誤；應用程式要在出錯時 `ROLLBACK`。用 `with conn.transaction()` 這類寫法就不會漏 |
| `could not serialize access due to concurrent update` | `40001` | REPEATABLE READ 以上，要改的列在你的快照之後被別人改了 | 重做整個交易 |
| `deadlock detected` | `40P01` | A 鎖了列 1 在等列 2，B 鎖了列 2 在等列 1，資料庫偵測到後中止其中一個 | 重做被中止的交易；長期解法是**固定上鎖順序**（例如一律依 id 由小到大） |
| `duplicate key value violates unique constraint` | `23505` | 違反唯一鍵；並行建立同一筆資料時常見 | 不要重試，改用 `INSERT … ON CONFLICT` 或回傳「已存在」 |

不會出現錯誤訊息、但同樣嚴重的情況：

- **忘了 COMMIT**：很多驅動預設關閉自動提交，程式結束連線關掉時，交易會被 rollback，資料就像沒寫過。
- **idle in transaction**：交易開了卻停在那裡（例如程式在交易中等使用者輸入或外部 API）。`SELECT pid, state, xact_start, query FROM pg_stat_activity WHERE state = 'idle in transaction';` 可以找到它們。它們握著鎖、還會阻止 `VACUUM` 清理舊版本，讓資料表越來越肥。
- **ORM 的延遲載入在交易外觸發**：取出物件後在交易外讀它的關聯欄位，會在另一個交易裡讀到不一致的資料。

## 動手

1. 按上面 MVCC 那段的「在 Playground 開啟」，觀察 `UPDATE` 前後的 `xmin`，再多跑幾次 `UPDATE` 看看它怎麼變。
2. 跑「一句完成」那段 SQL 兩次，第二次會回傳空結果：範例資料裡商品 1 的庫存夠多，先用 `UPDATE products SET stock = 1 WHERE id = 1;` 把它改成 1 再試。
3. 在 Playground 自己試原子性：`BEGIN; UPDATE products SET stock = 0; ROLLBACK; SELECT id, stock FROM products;`，確認 ROLLBACK 之後資料沒變。
4. 到設計情境 [秒殺：1,000 人搶 100 件](#/scenario/flash-sale)，用模擬器比較不同扣庫存做法在高並行下的結果。

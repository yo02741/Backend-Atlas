## 從一個具體問題開始：加一個欄位，整個服務停了 40 秒

下午三點部署，migration 只有一句：

```sql
ALTER TABLE orders ADD COLUMN note text;
```

在 PostgreSQL 11 之後，加一個沒有預設值（或預設值是常數）的欄位只改系統目錄，不會重寫整張表，平常幾毫秒就跑完。但這次部署後，所有跟訂單有關的 API 開始逾時，持續了 40 秒。事後查到的時間線：

| 時間 | 連線 1：報表工作 | 連線 2：migration | 連線 3…N：API 請求 |
|---|---|---|---|
| 14:59:20 | `BEGIN; SELECT … FROM orders …`（跑很久，交易沒結束），持有 orders 的 ACCESS SHARE | | 正常 |
| 15:00:00 | 還在跑 | `ALTER TABLE` 要 ACCESS EXCLUSIVE，跟 ACCESS SHARE 衝突，**開始等** | |
| 15:00:01 | | 等待中 | `SELECT * FROM orders WHERE id = …` 要 ACCESS SHARE，排在 ALTER 後面，**也開始等** |
| 15:00:40 | 報表 commit，釋放鎖 | 拿到鎖，幾毫秒完成 | 全部一起放行 |

ALTER 本身只花幾毫秒，卡住服務的是**它在排隊**：PostgreSQL 的鎖請求會排隊，一個在等強鎖的請求，會擋住後面所有跟它衝突的請求，即使那些請求跟目前持有鎖的人並不衝突。這一課講 PostgreSQL 有哪些鎖、誰會拿、怎麼設逾時、死結怎麼來，以及出事時怎麼查是誰擋住誰。交易與隔離等級的基礎在 [交易、ACID 與隔離等級](#/skill/transactions)。

## 運作原理：表鎖與列鎖是兩層

### 表鎖：每一句 SQL 都會拿

就算只是 `SELECT`，也會對表拿一個最弱的鎖，避免讀到一半表被刪掉。常見模式由弱到強：

| 表鎖模式 | 誰會拿 | 擋 SELECT？ | 擋 INSERT / UPDATE / DELETE？ |
|---|---|---|---|
| ACCESS SHARE | `SELECT` | 否 | 否 |
| ROW SHARE | `SELECT … FOR UPDATE / FOR SHARE` | 否 | 否 |
| ROW EXCLUSIVE | `INSERT`、`UPDATE`、`DELETE`、`MERGE` | 否 | 否 |
| SHARE UPDATE EXCLUSIVE | `VACUUM`（非 FULL）、`ANALYZE`、`CREATE INDEX CONCURRENTLY`、`ALTER TABLE … VALIDATE CONSTRAINT` | 否 | 否（但彼此互斥） |
| SHARE | `CREATE INDEX`（沒有 CONCURRENTLY） | 否 | **是** |
| ACCESS EXCLUSIVE | 多數 `ALTER TABLE`、`DROP TABLE`、`TRUNCATE`、`VACUUM FULL`、`LOCK TABLE` 預設 | **是** | **是** |

前三種彼此不衝突，所以一般的讀寫不會互相擋在表這一層。要注意的是最後三列：

- `CREATE INDEX` 拿 SHARE：建索引期間可以讀、**不能寫**。大表建索引要幾分鐘，寫入就停幾分鐘。
- `CREATE INDEX CONCURRENTLY` 拿 SHARE UPDATE EXCLUSIVE：讀寫都不擋，代價是要掃表兩次、比較慢，而且**不能放在交易區塊裡**。失敗時會留下一個標記為 INVALID 的索引，要手動 `DROP INDEX` 再重建。
- 多數 `ALTER TABLE` 拿 ACCESS EXCLUSIVE：就算本身很快，也會遇到上面的排隊問題。少數子命令拿比較弱的鎖（例如 `VALIDATE CONSTRAINT`），每個子命令拿什麼鎖，以官方文件 `ALTER TABLE` 頁為準。

### 列鎖：只有改資料或明確要求時才拿

列鎖決定「同一列能不能同時被兩個交易改」。四種強度：

| 列鎖 | 誰會拿 | 跟誰衝突 |
|---|---|---|
| `FOR KEY SHARE` | 插入子表時的外鍵檢查（鎖住父表那一列） | 只跟 `FOR UPDATE` |
| `FOR SHARE` | 明確寫 `SELECT … FOR SHARE` | `FOR NO KEY UPDATE`、`FOR UPDATE` |
| `FOR NO KEY UPDATE` | 不改唯一鍵欄位的 `UPDATE` | `FOR SHARE`、`FOR NO KEY UPDATE`、`FOR UPDATE` |
| `FOR UPDATE` | `DELETE`、改到唯一鍵欄位的 `UPDATE`、`SELECT … FOR UPDATE` | 全部 |

這個分級讓「插入一筆訂單明細（外鍵檢查鎖住商品列）」和「更新商品價格」不會互擋：前者是 KEY SHARE，後者是 NO KEY UPDATE，兩者不衝突。

一般的 `SELECT` 不拿列鎖。MVCC 讓它讀快照，不用等任何寫入。

列鎖記在資料列本身（列的標頭），不是記在記憶體的鎖表裡，所以 PostgreSQL 鎖一百萬列也不會耗盡鎖表，也**沒有**「鎖太多列就升級成表鎖」這回事。副作用是 `pg_locks` 平常看不到列鎖，只看得到表層級的 ROW SHARE 和自己的交易編號：

```sql run
-- 鎖住商品 1，看看自己這個連線持有哪些鎖
BEGIN;
SELECT id, stock FROM products WHERE id = 1 FOR UPDATE;

SELECT locktype, relation::regclass AS rel, mode, granted
FROM pg_locks
WHERE pid = pg_backend_pid() AND locktype IN ('relation', 'transactionid')
ORDER BY locktype, mode;
-- 會看到 products 與 products_pkey 的 RowShareLock、transactionid 的 ExclusiveLock，
-- 以及查 pg_locks 本身拿的 AccessShareLock；
-- 「鎖住第 1 列」這件事不在清單裡，它寫在那一列的標頭上
COMMIT;
```

當別的交易**在等**這一列時，pg_locks 裡才會出現它：它在等的是「持有者的交易編號」（`locktype = 'transactionid'`，`granted = false`）。

## 實際程式

### NOWAIT 與 SKIP LOCKED

`SELECT … FOR UPDATE` 遇到被鎖的列預設會等。兩個修飾詞改變這個行為：

- `NOWAIT`：拿不到就立刻報錯 `could not obtain lock on row in relation "…"`（SQLSTATE `55P03`）。適合「別人正在處理就告訴使用者稍後再試」的互動操作。
- `SKIP LOCKED`：直接跳過被鎖的列，回傳其他列。適合工作佇列：多個 worker 同時取工作，各自拿到不同的列，不會重複處理、也不會互相等待。

```sql run
-- 用資料表做工作佇列：status 標記狀態，worker 用 SKIP LOCKED 取下一件
CREATE TABLE jobs (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payload    text NOT NULL,
  status     text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  priority   int  NOT NULL DEFAULT 0,
  locked_at  timestamptz
);
INSERT INTO jobs (payload, priority) VALUES ('寄出訂單確認信 #101', 0), ('產生月報', 5), ('同步庫存', 0);

-- 一個 worker 取一件：優先度高的先、同優先度先進先出
-- 另一個 worker 同時跑同一句，會跳過這一列、拿到下一件
WITH next AS (
  SELECT id FROM jobs
  WHERE status = 'queued'
  ORDER BY priority DESC, id
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE jobs SET status = 'running', locked_at = now()
FROM next WHERE jobs.id = next.id
RETURNING jobs.id, jobs.payload;

SELECT id, payload, status, priority FROM jobs ORDER BY id;
```

兩個 worker 同時執行取工作那一句：

| 時間 | worker A | worker B |
|---|---|---|
| t1 | 掃到 id 2（priority 5），鎖住 | |
| t2 | | 掃到 id 2，已被鎖，**跳過**；掃到 id 1，鎖住 |
| t3 | 改成 running、commit | 改成 running、commit |

取到工作之後有兩種做法：

1. **改狀態後立刻 commit，再處理**（上面的寫法）。交易很短，但 worker 處理到一半當掉時，那件工作會永遠停在 `running`。需要一個排程把 `locked_at` 超過一段時間的工作改回 `queued`。
2. **整個處理過程都在交易裡**，處理完才 commit。worker 當掉時連線斷開、交易 rollback，工作自動回到可取的狀態。代價是處理多久就握著交易多久，不適合處理時間長或要呼叫外部服務的工作。

`SKIP LOCKED` 看到的是「刻意不一致」的資料，只適合佇列這類「拿到哪一件都可以」的場景，不要拿來做一般查詢。

### 逾時：讓等待有上限

| 設定 | 限制什麼 | 超過時的錯誤 |
|---|---|---|
| `lock_timeout` | **每一次**等鎖的時間 | `canceling statement due to lock timeout`（`55P03`） |
| `statement_timeout` | 單一句 SQL 的總執行時間（含等鎖） | `canceling statement due to statement timeout`（`57014`） |
| `idle_in_transaction_session_timeout` | 交易開著卻沒在執行任何查詢的時間 | 連線被中斷 |
| `transaction_timeout`（PostgreSQL 17 起） | 整個交易的總時間 | 連線被中斷 |

回到開頭的事故，migration 的標準寫法是先設 `lock_timeout`，拿不到鎖就放棄、稍後重試，而不是無限期排隊、拖住所有人：

```sql
-- migration 開頭：等鎖最多 3 秒，拿不到就失敗（之後由部署腳本重試幾次）
SET lock_timeout = '3s';
ALTER TABLE orders ADD COLUMN note text;

-- 建索引不擋寫入；不能放在 BEGIN … COMMIT 裡
CREATE INDEX CONCURRENTLY idx_orders_created_at ON orders (created_at);
```

應用程式用的帳號也可以設預設值，避免某句失控的查詢拖住連線池（數值依服務特性調整）：

```sql
ALTER ROLE app_user SET statement_timeout = '30s';
ALTER ROLE app_user SET idle_in_transaction_session_timeout = '60s';
```

## 死結：互相等對方

死結的形狀永遠一樣：A 握著 X 在等 Y，B 握著 Y 在等 X。最常見的例子是轉帳，兩筆方向相反的轉帳同時發生：

| 時間 | 交易 A：帳戶 1 → 2 | 交易 B：帳戶 2 → 1 |
|---|---|---|
| t1 | `UPDATE accounts … WHERE id = 1`，鎖住列 1 | |
| t2 | | `UPDATE accounts … WHERE id = 2`，鎖住列 2 |
| t3 | `UPDATE … WHERE id = 2`：等 B | |
| t4 | | `UPDATE … WHERE id = 1`：等 A（形成環） |
| t4 + 1 秒 | | PostgreSQL 偵測到死結，中止其中一個 |

PostgreSQL 不會在每次等鎖時都檢查死結（成本太高），而是等了 `deadlock_timeout`（預設 1 秒）之後才檢查。發現環就中止其中一個交易，另一個繼續執行。被中止的那邊收到：

```text
ERROR:  deadlock detected
DETAIL:  Process 4120 waits for ShareLock on transaction 9031; blocked by process 4127.
Process 4127 waits for ShareLock on transaction 9030; blocked by process 4120.
HINT:  See server log for query details.
CONTEXT:  while updating tuple (0,2) in relation "accounts"
```

讀法：`waits for ShareLock on transaction 9031` 表示在等交易 9031 結束（也就是在等它握著的列鎖）；兩行 DETAIL 互相指向對方，就是那個環。哪一邊會被中止無法預測，程式不能依賴這一點。

處理分兩層：

- **被中止的交易要整個重試**。`40P01` 跟序列化失敗 `40001` 一樣，屬於「重做就可能成功」的錯誤。
- **根治是固定上鎖順序**。所有程式碼都依同一個順序拿鎖（例如依 id 由小到大），就不可能形成環。轉帳時不管方向，一律先鎖 id 小的帳戶：

```sql
BEGIN;
-- 不管轉出還是轉入，先依 id 排序一次鎖住兩列
SELECT id FROM accounts WHERE id IN (1, 2) ORDER BY id FOR UPDATE;
UPDATE accounts SET balance = balance - 500 WHERE id = 2;
UPDATE accounts SET balance = balance + 500 WHERE id = 1;
COMMIT;
```

批次更新也會死結：`UPDATE products SET stock = stock - 1 WHERE id IN (3, 1, 2)` 實際碰到各列的順序取決於執行計畫，兩個批次的集合有重疊時就可能互相卡住。同樣的解法是先用 `SELECT … ORDER BY id FOR UPDATE` 依序鎖住，再更新。

下面用 Python 模擬兩種上鎖順序，看哪一種會形成等待的環：

```python run
# 模擬：兩個交易各要鎖兩列，依「步驟」交錯執行；鎖被別人握著就等待
def run(plans):
    holder = {}                       # 列 -> 握著它的交易
    waiting = {}                      # 交易 -> 正在等的列
    pos = {t: 0 for t in plans}       # 每個交易執行到第幾步
    for _ in range(10):
        for t, rows in plans.items():
            if pos[t] >= len(rows):
                continue
            row = rows[pos[t]]
            owner = holder.get(row)
            if owner in (None, t):
                holder[row] = t
                waiting.pop(t, None)
                pos[t] += 1
                if pos[t] == len(rows):           # 做完：commit 釋放所有鎖
                    for r in [r for r, o in holder.items() if o == t]:
                        del holder[r]
            else:
                waiting[t] = row
                # 順著「誰握著我在等的列」往下走；走回自己就是等待的環
                chain, x = [t], owner
                while x is not None and x not in chain:
                    chain.append(x)
                    x = holder.get(waiting.get(x))
                if x == t:
                    return "死結：" + " 等 ".join(chain + [t])
    return "全部完成，沒有死結" if all(pos[t] == len(r) for t, r in plans.items()) else "還沒跑完"

print("各自依轉帳方向上鎖：", run({"A": [1, 2], "B": [2, 1]}))
print("一律依 id 由小到大：", run({"A": [1, 2], "B": [1, 2]}))
```

## 常見錯誤與錯誤訊息

| 錯誤訊息 | SQLSTATE | 原因 | 怎麼處理 |
|---|---|---|---|
| `deadlock detected` | `40P01` | 兩個以上交易互等對方的鎖 | 重試整個交易；檢查 DETAIL 指出的兩邊，統一上鎖順序 |
| `canceling statement due to lock timeout` | `55P03` | 等鎖超過 `lock_timeout` | migration：稍後重試；線上請求：查是誰握著鎖太久 |
| `could not obtain lock on row in relation "…"` | `55P03` | 用了 `NOWAIT`，該列正被鎖 | 預期中的結果，回應「處理中，請稍後」 |
| `canceling statement due to statement timeout` | `57014` | 查詢（含等鎖）超過 `statement_timeout` | 先看是慢在執行還是慢在等鎖（`wait_event_type = 'Lock'`） |
| `CREATE INDEX CONCURRENTLY cannot run inside a transaction block` | `25001` | 把 CONCURRENTLY 放進 `BEGIN … COMMIT`，或 migration 工具預設包了交易 | 把這個 migration 設成不包交易 |

### 出事時：查誰擋住誰

服務卡住時，先看有哪些連線在等鎖、被誰擋住。`pg_blocking_pids(pid)` 直接回傳擋住某個連線的 pid 陣列：

```sql
SELECT pid,
       pg_blocking_pids(pid)       AS blocked_by,
       state,
       wait_event_type,            -- 'Lock' 表示在等鎖
       now() - xact_start          AS xact_age,
       left(query, 80)             AS query
FROM pg_stat_activity
WHERE datname = current_database()
ORDER BY xact_start NULLS LAST;
```

順著 `blocked_by` 往上找，最上游通常是一個 `state = 'idle in transaction'`、`xact_age` 很大的連線：程式開了交易卻沒有結束。處理方式：

- `SELECT pg_cancel_backend(<pid>);` 取消該連線目前執行的查詢（溫和）。
- `SELECT pg_terminate_backend(<pid>);` 直接中斷連線，交易 rollback（idle in transaction 的連線沒有正在跑的查詢可取消，要用這個）。

事後要修的是程式：找出為什麼交易沒結束（交易裡呼叫外部 API、例外路徑沒 rollback、在交易中等使用者操作），並設好 `idle_in_transaction_session_timeout`。

> 本站的 PostgreSQL 跑在瀏覽器裡、只有一個連線，沒辦法真的重現兩個交易互等；上面的鎖範例只能看到「自己」持有的鎖。要實際看到等待與死結，需要一個真的 PostgreSQL，開兩個 psql 視窗照轉帳的時間線輸入。

## 動手

1. 執行 pg_locks 那段，把 `FOR UPDATE` 改成 `FOR SHARE`，再改成 `UPDATE products SET stock = stock WHERE id = 1`，比較表層級的鎖模式（RowShareLock 與 RowExclusiveLock）。
2. 在同一段裡加一句 `ALTER TABLE products ADD COLUMN note text;`（放在 COMMIT 之前），看 products 多出 AccessExclusiveLock；再換成 `CREATE INDEX ON products (price);` 看到的是 ShareLock。
3. 執行工作佇列那段，把取工作那一句複製一次接在後面，確認第二次拿到的是 id 1（id 2 已經是 running）。
4. 改 Python 模擬的 `plans` 成三個交易 `{"A": [1, 2], "B": [3, 1], "C": [2, 3]}`，看三方怎麼繞成一個環；再把三個都改成由小到大的順序，確認環消失。
5. 程式題「找出擋住大家的源頭」練習從 `pg_stat_activity` 加 `pg_blocking_pids()` 的結果裡，找出最上游的那個連線。

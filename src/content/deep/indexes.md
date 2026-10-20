## 從一個具體問題開始：上線半年後變慢的「我的訂單」

「我的訂單」頁面背後只有一句查詢：

```sql
SELECT id, status, amount, created_at
FROM orders
WHERE user_id = $1
ORDER BY created_at DESC
LIMIT 20;
```

上線時 orders 只有幾千筆，回應時間幾毫秒。半年後表長到幾百萬筆，同一頁要 1 秒以上，資料庫 CPU 長期偏高，尖峰時連其他查詢也一起變慢。程式碼一行都沒改。

原因是這句查詢每次都要把 orders 從頭讀到尾，逐列檢查 `user_id`，最後才排序取 20 筆。資料量翻 100 倍，讀的量就翻 100 倍。修法是一行 `CREATE INDEX`，但要建對欄位、建對順序，並且知道怎麼確認資料庫真的用了它。

## 運作原理：B-tree 是一份排好序的目錄

沒有索引時，資料庫只能 **Seq Scan**（循序掃描）：把資料表的每一頁都讀進來、每一列都檢查條件。成本和表的大小成正比。

B-tree 索引是把某個欄位的值**排序後**另外存一份，每個值旁邊記著那一列在表裡的位置（TID，「第幾頁第幾格」）。為了不用從頭找，排好序的值被組成一棵樹：

```text
                       [ 根頁：  … 3000 … 6000 … ]
                      /             |              \
       [ 1 … 1000 … 2000 ]   [ 3000 … 4500 ]   [ 6000 … 8000 … ]     ← 內部頁：只存分界值
         /      |      \           …                  …
 [ 1 2 3 … 42 43 … ]  [ … ]                                          ← 葉頁：值 + TID，彼此用指標串起來
         │
         └─ user_id = 42 → (頁 17, 第 3 格)、(頁 911, 第 8 格)…
```

查 `user_id = 42`：從根頁開始，每一層比較分界值、往下走一頁，到葉頁就找到所有 42 的 TID，再去表裡讀那幾列。

- 每一頁預設 8 KB，可以放幾百個分界值，所以樹非常矮：幾百萬到幾億筆通常只有 3 到 4 層。查一個值只要讀幾頁索引，而不是幾萬頁資料。
- 葉頁彼此串連、而且排好序，所以範圍查詢（`BETWEEN`、`>`、`<`）找到起點後往右讀就好；`ORDER BY` 這個欄位時，照索引順序讀出來就已經排好，不用另外排序。
- 代價是每次 `INSERT`、更新索引欄位的 `UPDATE`、`DELETE`，都要同步維護每一棵索引樹。

這兩種讀法的差別，可以在 [索引實驗室](#/lab/IndexLab) 看循序掃描和 B-tree 走訪的比較次數。

## 讀 EXPLAIN

`EXPLAIN` 顯示規劃器打算怎麼執行一句查詢；`EXPLAIN ANALYZE` 會**真的執行**它，並把實際的時間和列數附上。

```text
Bitmap Heap Scan on big_orders  (cost=4.37..41.62 rows=10 width=49) (actual time=0.049..0.073 rows=10.00 loops=1)
  Recheck Cond: (user_id = 42)
  Heap Blocks: exact=10
  Buffers: shared hit=10 read=2
  ->  Bitmap Index Scan on big_orders_user_id_idx  (cost=0.00..4.37 rows=10 width=0) (actual time=0.029..0.029 rows=10.00 loops=1)
        Index Cond: (user_id = 42)
        Index Searches: 1
        Buffers: shared read=2
Planning Time: 0.224 ms
Execution Time: 0.145 ms
```

| 欄位 | 意思 |
|---|---|
| `cost=4.37..41.62` | 估計成本：產出第一列之前的成本 .. 產出全部列的成本。單位是規劃器自己的（約等於「循序讀一頁 = 1」），只能拿來比較同一句的不同計畫，不是毫秒 |
| `rows=10`（前面那組） | **估計**這個節點會產出幾列 |
| `width=49` | 估計每列的平均位元組數 |
| `actual time=0.049..0.073` | 實際：第一列出來的時間 .. 全部列出來的時間（毫秒，每次 loop 的平均） |
| `rows=10.00`（actual 那組） | **實際**產出幾列（每次 loop 的平均）。PostgreSQL 18 起顯示兩位小數 |
| `loops=1` | 這個節點被執行幾次；Nested Loop 的內側常常是很多次，總時間要乘上 loops |
| `Index Searches: 1` | 這個節點在索引裡從根往下找了幾次。PostgreSQL 18 新增的欄位；後面會看到 skip scan 時它大於 1 |
| `Buffers: shared hit=10 read=2` | 讀了幾頁：hit 是在共享記憶體裡找到、read 是要去讀檔案。PostgreSQL 18 起 `EXPLAIN ANALYZE` 預設附這行，舊版要寫 `EXPLAIN (ANALYZE, BUFFERS)` |

計畫是一棵樹，**從最內層（縮排最深）往外讀**：上面的例子是先 Bitmap Index Scan 從索引收集位置，再 Bitmap Heap Scan 去表裡讀。

最常見的節點：

| 節點 | 做什麼 | 什麼時候出現 |
|---|---|---|
| `Seq Scan` | 讀整張表，`Filter:` 逐列過濾 | 沒有可用的索引；或要讀的列佔很大比例，循序讀比跳著讀便宜；或表很小 |
| `Index Scan` | 沿索引找到 TID，逐一回表讀列 | 符合的列很少，或要照索引順序輸出（`ORDER BY … LIMIT`） |
| `Index Only Scan` | 只讀索引不回表，因為要的欄位全在索引裡 | `SELECT` 的欄位都包含在索引中；`Heap Fetches:` 是仍需回表確認可見性的次數 |
| `Bitmap Index Scan` + `Bitmap Heap Scan` | 先從索引收集所有 TID、依頁面排序，再把每一頁讀一次 | 符合的列不算少、而且散落在很多頁；或要合併多個索引（`BitmapAnd` / `BitmapOr`） |
| `Nested Loop` / `Hash Join` / `Merge Join` | 三種 JOIN 演算法 | 外側少、內側有索引時常見 Nested Loop；兩邊都大時常見 Hash Join |
| `Sort` / `Limit` / `Aggregate` | 排序、截斷、聚合 | 看 `Sort Method:` 有沒有寫 `external merge`（記憶體不夠，排序寫到磁碟） |

讀計畫時最重要的一件事：**比對估計的 rows 和實際的 rows**。差了十倍以上，代表規劃器對資料的認識是錯的（統計資料過期、條件之間有相關性、函數讓它猜不到），它選出的計畫就很可能不好。先跑 `ANALYZE 表名` 更新統計再看一次。

> `EXPLAIN ANALYZE` 會真的執行語句。分析 `UPDATE`、`DELETE` 時要包在交易裡：`BEGIN; EXPLAIN ANALYZE DELETE …; ROLLBACK;`。

## 實際程式：建索引前後的計畫

### 範例資料太小：規劃器不用索引是對的

範例資料庫的 orders 只有 6 列，全部在同一頁裡。這時讀一頁就看完整張表，走索引反而要多讀索引頁：

```sql run
-- 1. 沒有索引：只能 Seq Scan。rows=4 是猜的：這張表從沒 ANALYZE 過，規劃器用預設的估計
EXPLAIN SELECT * FROM orders WHERE user_id = 2;

-- 2. 建了索引、也更新統計：仍然是 Seq Scan，因為整張表只有 1 頁
CREATE INDEX orders_user_id_idx ON orders (user_id);
ANALYZE orders;
EXPLAIN SELECT * FROM orders WHERE user_id = 2;

-- 3. 只為了觀察：叫規劃器盡量別用 Seq Scan，看索引計畫長什麼樣（正式環境不要這樣設）
SET enable_seqscan = off;
EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = 2;
RESET enable_seqscan;
```

`enable_seqscan = off` 不是真的禁止 Seq Scan，而是讓規劃器只要有別的路就不選它；沒有其他可行的計畫時照樣會用。它只適合用來觀察「如果走索引會怎樣」，不能拿來修效能問題。

### 用 generate_series 做出 10 萬筆

要看索引真正的效果，需要夠多資料。下面用 `generate_series` 產生 10 萬筆訂單：1 萬位使用者、每人 10 筆、散落在整張表裡；狀態的分佈刻意不均（pending 只有 1%）。

```sql run
CREATE TABLE big_orders AS
SELECT g AS id,
       (g * 7919) % 10000 + 1 AS user_id,                          -- 1..10000，每人 10 筆，分散在表的各處
       CASE WHEN g % 100 = 0 THEN 'pending' WHEN g % 20 = 0 THEN 'cancelled'
            WHEN g % 3 = 0 THEN 'paid' ELSE 'shipped' END AS status,
       ((g * 37) % 100000) / 10.0 AS amount,
       timestamptz '2026-01-01 00:00+08' + g * interval '1 minute' AS created_at,
       'user' || ((g * 7919) % 10000 + 1) || '@example.com' AS email
FROM generate_series(1, 100000) AS g;
ALTER TABLE big_orders ADD PRIMARY KEY (id);
ANALYZE big_orders;

-- 沒有索引：Seq Scan，Rows Removed by Filter 約 99990（讀了 10 萬列只為了 10 列）
EXPLAIN ANALYZE SELECT * FROM big_orders WHERE user_id = 42;

-- 建索引後：Bitmap Index Scan + Bitmap Heap Scan，Execution Time 少一到兩個數量級
CREATE INDEX big_orders_user_id_idx ON big_orders (user_id);
EXPLAIN ANALYZE SELECT * FROM big_orders WHERE user_id = 42;

-- 主鍵本身就是 B-tree 索引：Index Scan
EXPLAIN ANALYZE SELECT * FROM big_orders WHERE id = 42;

-- 只要 id：欄位全在主鍵索引裡，Index Only Scan
EXPLAIN ANALYZE SELECT id FROM big_orders WHERE id BETWEEN 1 AND 100;
```

幾個值得注意的地方：

- 建索引後 `user_id = 42` 用的是 Bitmap 掃描而不是 Index Scan：這 10 列分散在 10 個不同的頁，規劃器選擇先收集位置、依頁排序後再讀。照主鍵查一筆時就是單純的 Index Scan。
- 最後一句是 Index Only Scan，但 `Heap Fetches: 100` 表示每一列仍然回表確認了可見性。資料表要經過 `VACUUM` 把頁面標成 all-visible，Index Only Scan 才真的不用回表。本站的 Playground 會把整個區塊當成一個交易執行，`VACUUM` 放在區塊裡會報 `VACUUM cannot run inside a transaction block`；在真的資料庫上單獨執行 `VACUUM big_orders;` 之後再看，Heap Fetches 會變成 0。
- 時間數字每次跑都不一樣，要看的是數量級和節點種類。

## 複合索引：欄位順序決定能服務哪些查詢

複合索引 `(user_id, created_at)` 是先依 `user_id` 排序、`user_id` 相同時再依 `created_at` 排序，像電話簿先依姓、再依名。所以：

| 查詢 | 能不能用 `(user_id, created_at)` |
|---|---|
| `WHERE user_id = 42` | 能：找到 42 那一段 |
| `WHERE user_id = 42 ORDER BY created_at DESC LIMIT 20` | 能，而且最好：那一段已經依時間排好，倒著讀 20 筆就停，不用排序 |
| `WHERE user_id = 42 AND created_at >= '2026-03-01'` | 能：在 42 那一段裡再定位起點 |
| `WHERE created_at >= '2026-03-01'` | 通常不能：符合的列散在每一個 user_id 的區段裡 |
| `WHERE user_id IN (1, 2, 3) ORDER BY created_at` | 可以找列，但三段的時間要合併後重排，通常還是要 Sort |

決定順序的原則：

1. **等值條件的欄位放前面，範圍條件或排序欄位放後面**。`(user_id, created_at)` 能服務「某人、某段時間」；反過來 `(created_at, user_id)` 遇到時間範圍時，要掃過範圍內所有人的資料。
2. 在等值欄位之間，把最常單獨出現在查詢裡的放第一個，這樣一個索引能服務更多種查詢。
3. 為一個查詢量身做的複合索引，最好能讓 `ORDER BY … LIMIT` 直接沿索引讀，省掉排序。

```sql run
CREATE TABLE big_orders AS
SELECT g AS id, (g * 7919) % 10000 + 1 AS user_id,
       CASE WHEN g % 100 = 0 THEN 'pending' WHEN g % 20 = 0 THEN 'cancelled'
            WHEN g % 3 = 0 THEN 'paid' ELSE 'shipped' END AS status,
       ((g * 37) % 100000) / 10.0 AS amount,
       timestamptz '2026-01-01 00:00+08' + g * interval '1 minute' AS created_at
FROM generate_series(1, 100000) AS g;
ANALYZE big_orders;

CREATE INDEX big_orders_user_created_idx ON big_orders (user_id, created_at);

-- 開頭的「我的訂單」：Index Scan Backward + Limit，沒有 Sort 節點
EXPLAIN ANALYZE
SELECT id, status, amount, created_at FROM big_orders
WHERE user_id = 42 ORDER BY created_at DESC LIMIT 3;

-- 只有 created_at 的條件：user_id 有 1 萬種值，這個索引幫不上忙，Seq Scan
EXPLAIN SELECT * FROM big_orders
WHERE created_at >= '2026-02-01' AND created_at < '2026-02-01 01:00';

-- 前導欄位只有 4 種值時：PostgreSQL 18 的 skip scan 可以逐一跳過每個 status 值使用索引
CREATE INDEX big_orders_status_created_idx ON big_orders (status, created_at);
EXPLAIN ANALYZE SELECT * FROM big_orders
WHERE created_at >= '2026-02-01' AND created_at < '2026-02-01 01:00';
```

最後一句會看到 `Index Searches:` 大於 1：PostgreSQL 18 新增了 B-tree **skip scan**，前導欄位沒有條件、但不同值很少時，可以對每個前導值各做一次搜尋。這讓「最左前綴」不再是絕對規則；但前導欄位的值一多（像 user_id），skip scan 就不划算，規劃器還是會選 Seq Scan。PostgreSQL 17 以前沒有這個功能，設計索引時仍以「等值欄位在前」為準。

## 選擇性：同一個索引，有時用、有時不用

**選擇性**是條件篩掉多少資料。只留下 0.01% 的條件選擇性高，索引很划算；留下 60% 的條件，走索引要跳著讀表裡大部分的頁，不如從頭循序讀。

常聽到「status 只有幾種值，不要建索引」，但更精確的說法是：**看你查的是哪個值**。範例的 status 有 63% 是 shipped、只有 1% 是 pending：

```sql run
CREATE TABLE big_orders AS
SELECT g AS id, (g * 7919) % 10000 + 1 AS user_id,
       CASE WHEN g % 100 = 0 THEN 'pending' WHEN g % 20 = 0 THEN 'cancelled'
            WHEN g % 3 = 0 THEN 'paid' ELSE 'shipped' END AS status,
       timestamptz '2026-01-01 00:00+08' + g * interval '1 minute' AS created_at
FROM generate_series(1, 100000) AS g;
ANALYZE big_orders;
CREATE INDEX big_orders_status_idx ON big_orders (status);

-- 統計資料裡記著每個常見值的比例，規劃器據此估計
SELECT most_common_vals, most_common_freqs FROM pg_stats
WHERE tablename = 'big_orders' AND attname = 'status';

EXPLAIN SELECT * FROM big_orders WHERE status = 'shipped';   -- 約 63%：Seq Scan
EXPLAIN SELECT * FROM big_orders WHERE status = 'pending';   -- 約 1%：走索引

-- 部分索引：只替 pending 的列建索引，背景工作「找出待處理訂單」用得到，索引小很多
CREATE INDEX big_orders_pending_idx ON big_orders (created_at) WHERE status = 'pending';
EXPLAIN SELECT id FROM big_orders WHERE status = 'pending' ORDER BY created_at LIMIT 50;

SELECT indexrelid::regclass AS index_name, pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_index WHERE indrelid = 'big_orders'::regclass ORDER BY 1;
```

**部分索引**（`WHERE` 子句的索引）只收錄符合條件的列。待處理訂單、未讀通知、沒被軟刪除的資料（`WHERE deleted_at IS NULL`）都很適合：查詢只關心一小部分列，索引也只需要那一部分。查詢的條件要能推論出索引的條件（寫 `WHERE status = 'pending'`），規劃器才會用它。部分唯一索引也能表達業務規則，例如「每位使用者只能有一個預設地址」，見 [資料建模與正規化](#/skill/data-modeling)。

## 索引沒被用的常見原因

| 寫法 | 為什麼用不到 `(email)` 或 `(user_id)` 的索引 | 改法 |
|---|---|---|
| `WHERE lower(email) = 'a@x.com'` | 索引裡存的是 `email`，不是 `lower(email)` | 建表達式索引 `CREATE INDEX ON t (lower(email))`，查詢寫法要一模一樣 |
| `WHERE email LIKE '%@example.com'` | B-tree 依開頭排序，萬用字元在前面就無從定位 | 前綴搜尋（`LIKE 'abc%'`）才能用 B-tree；中間比對用 `pg_trgm` 的 GIN 索引或全文檢索 |
| `WHERE user_id::text = '42'` | 欄位被轉型，等於被函數包住 | 轉換參數，不要轉換欄位：`WHERE user_id = 42` |
| `WHERE user_id = 42.0` | `bigint` 被提升成 `numeric` 來比較，索引的型別對不上 | 參數用跟欄位相同的型別；ORM 綁參數時特別注意 |
| `WHERE id + 1 = 43` | 運算在欄位那一側 | 移到常數那一側：`WHERE id = 42` |
| `WHERE created_at::date = '2026-03-01'` | 同樣是函數包住欄位 | 改成範圍：`created_at >= '2026-03-01' AND created_at < '2026-03-02'` |
| 表很小，或條件留下大部分列 | 規劃器估算後 Seq Scan 比較便宜 | 不用改，這是對的決定 |
| 估計列數離實際很遠 | 統計過期，規劃器以為條件會留很多列 | `ANALYZE 表名`；條件之間有相關性時考慮 `CREATE STATISTICS` |

```sql run
CREATE TABLE big_orders AS
SELECT g AS id, (g * 7919) % 10000 + 1 AS user_id,
       'user' || ((g * 7919) % 10000 + 1) || '@example.com' AS email
FROM generate_series(1, 100000) AS g;
ANALYZE big_orders;
CREATE INDEX big_orders_email_idx ON big_orders (email);
CREATE INDEX big_orders_user_id_idx ON big_orders (user_id);

EXPLAIN SELECT * FROM big_orders WHERE email = 'user42@example.com';          -- 用索引
EXPLAIN SELECT * FROM big_orders WHERE lower(email) = 'user42@example.com';   -- Seq Scan：函數包住欄位
EXPLAIN SELECT * FROM big_orders WHERE email LIKE '%42@example.com';          -- Seq Scan：前置萬用字元
EXPLAIN SELECT * FROM big_orders WHERE user_id::text = '42';                  -- Seq Scan：欄位被轉型
EXPLAIN SELECT * FROM big_orders WHERE user_id = 42.0;                        -- Seq Scan：型別不符

-- 表達式索引：查詢寫 lower(email) 時就能用
CREATE INDEX big_orders_email_lower_idx ON big_orders (lower(email));
ANALYZE big_orders;   -- 表達式索引也有自己的統計，建完 ANALYZE 讓估計準確
EXPLAIN SELECT * FROM big_orders WHERE lower(email) = 'user42@example.com';
```

關於 `LIKE 'abc%'`：B-tree 能不能服務前綴比對，取決於資料庫的 collation。本站的 PGlite 用 `C` collation，一般的 B-tree 索引就可以；資料庫用 `en_US.UTF-8` 這類 collation 時，要用 `text_pattern_ops` 運算子類別建索引（`CREATE INDEX ON t (email text_pattern_ops)`），或替欄位指定 `COLLATE "C"`。

## 索引的寫入成本

索引讓讀變快，代價落在寫入和空間：

- 每次 `INSERT` 要在**每一個**索引裡插入一筆；每次 `DELETE` 之後的清理也要處理每一個索引。
- `UPDATE` 時，如果改到的欄位有任何索引，或新版本放不進原本的頁，就要在所有索引裡新增指向新版本的項目。沒有改到索引欄位、而且同一頁還有空間時，PostgreSQL 可以做 HOT update，省掉索引維護。所以索引建在常被更新的欄位上（例如 `last_seen_at`）特別貴。
- 索引佔磁碟，也佔記憶體快取。常用的索引應該留在記憶體裡；多一個沒用的索引，就擠掉一部分有用的資料。

```sql run
-- 同樣插入 5 萬列：一張表沒有索引，另一張有主鍵 + 3 個索引
CREATE TABLE w0 (id BIGINT, user_id BIGINT, email TEXT, created_at TIMESTAMPTZ);
CREATE TABLE w4 (id BIGINT PRIMARY KEY, user_id BIGINT, email TEXT, created_at TIMESTAMPTZ);
CREATE INDEX ON w4 (user_id);
CREATE INDEX ON w4 (email);
CREATE INDEX ON w4 (created_at);

EXPLAIN (ANALYZE, BUFFERS OFF)
INSERT INTO w0 SELECT g, (g * 7919) % 10000, 'u' || (g * 7919) % 10000 || '@example.com', now() - g * interval '1 minute'
FROM generate_series(1, 50000) AS g;

EXPLAIN (ANALYZE, BUFFERS OFF)
INSERT INTO w4 SELECT g, (g * 7919) % 10000, 'u' || (g * 7919) % 10000 || '@example.com', now() - g * interval '1 minute'
FROM generate_series(1, 50000) AS g;

-- 四個索引加起來比資料表本身還大
SELECT c.relname, pg_size_pretty(pg_relation_size(c.oid)) AS size
FROM pg_class c WHERE c.relname = 'w0' OR c.relname LIKE 'w4%' ORDER BY c.relname;
```

在本站的環境裡，有四個索引的那張表插入時間通常是沒有索引的好幾倍；確切的比例取決於硬體、索引種類與資料的順序，要在自己的資料庫上量。

實務上的做法：

- 索引為**實際的查詢**建立，從慢查詢紀錄（例如 `pg_stat_statements`）找出最常跑、最耗時的查詢，再看它們的計畫。
- 定期找出從沒被用過的索引：`SELECT indexrelname, idx_scan FROM pg_stat_user_indexes ORDER BY idx_scan;`，`idx_scan` 長期是 0 的索引就是候選（主鍵與唯一索引即使沒被查詢用到，也在保證唯一性，不能刪）。
- 已經有 `(user_id, created_at)`，再建 `(user_id)` 通常是多餘的：前者就能服務只查 user_id 的查詢。
- 外鍵欄位通常要有索引：PostgreSQL 不會自動建立，沒有索引時 JOIN 慢，刪除被參照的列也要掃整張子表。
- 正式環境的大表加索引用 `CREATE INDEX CONCURRENTLY`：不會長時間擋住寫入，但比較慢，而且不能放在交易裡。大量匯入時，先匯入再建索引比邊寫邊維護快。

## 常見錯誤與錯誤訊息

| 錯誤訊息（PostgreSQL） | SQLSTATE | 發生原因 | 怎麼處理 |
|---|---|---|---|
| `functions in index expression must be marked IMMUTABLE` | `42P17` | `CREATE INDEX ON orders ((created_at::date))`：`timestamptz` 轉 `date` 的結果取決於連線時區，同一個值不保證得到同一個結果 | 明確指定時區：`((created_at AT TIME ZONE 'Asia/Taipei')::date)`；或改用範圍查詢，直接索引 `created_at` |
| `could not create unique index "users_lower_idx"` | `23505` | 建唯一索引時已有重複；DETAIL 會寫 `Key (lower(email))=(alice@example.com) is duplicated.` | 先清理重複資料再建 |
| `CREATE INDEX CONCURRENTLY cannot run inside a transaction block` | `25001` | 在 `BEGIN … COMMIT` 裡，或和其他語句一起送出（很多 migration 工具預設把每個檔案包成交易） | 單獨執行這一句；migration 工具通常有關閉交易包裝的設定 |
| `index row size 6416 exceeds btree version 4 maximum 2704 for index "t_s_idx"` | `54000` | B-tree 的單筆項目不能超過約一頁的 1/3；對很長的文字欄位建索引時會遇到 | HINT 建議改用雜湊值的表達式索引（例如 `md5(s)`）或全文檢索 |
| `VACUUM cannot run inside a transaction block` | `25001` | 在交易或多語句字串裡執行 VACUUM | 單獨執行 |

`CREATE INDEX CONCURRENTLY` 失敗（例如中途違反唯一性）時，會留下一個標成 INVALID 的索引：它不會被查詢使用，但寫入時仍要維護。用 `\d 表名` 或查 `pg_index.indisvalid` 找出來，`DROP INDEX` 後重建。

## 動手

1. 到 [索引實驗室](#/lab/IndexLab) 調整資料量，看循序掃描和 B-tree 走訪的比較次數怎麼隨資料量成長。
2. 在「用 generate_series 做出 10 萬筆」那段按「在 Playground 開啟」，把 `user_id = 42` 改成 `user_id < 5000`，看計畫從 Bitmap 變回 Seq Scan 的分界大概在哪裡。
3. 在複合索引那段把第一個索引改成 `(created_at, user_id)`，再跑「我的訂單」那句，比較兩種欄位順序的 `cost`、`Execution Time` 和 `Buffers`。
4. 程式題：[幫外鍵欄位建索引](#/exercise/indexes-1)、[複合索引的欄位順序](#/exercise/indexes-2)。
5. 設計情境 [分頁](#/scenario/pagination) 裡的 cursor 分頁，靠的就是 `(created_at, id)` 這類複合索引。

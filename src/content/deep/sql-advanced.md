## 從一個具體問題開始：「每位使用者最新一筆訂單」寫了三次才對

需求很單純：後台列表要顯示每位使用者最新一筆訂單的編號、狀態和金額。

第一次嘗試，GROUP BY 加 `max`：

```sql
SELECT user_id, max(created_at), status, amount FROM orders GROUP BY user_id;
-- ERROR:  column "orders.status" must appear in the GROUP BY clause or be used in an aggregate function
```

`max(created_at)` 只拿得到「最新的時間」，拿不到那一列的其他欄位。

第二次嘗試，用子查詢找最新時間：

```sql
SELECT * FROM orders WHERE created_at = (SELECT max(created_at) FROM orders);
```

不會報錯，但只回傳**全站**最新的一筆，因為子查詢沒有跟外層的使用者連起來。

第三次，子查詢加上「同一個使用者」：

```sql
SELECT * FROM orders o
WHERE created_at = (SELECT max(created_at) FROM orders o2 WHERE o2.user_id = o.user_id);
```

這次結果對了，但同一個使用者有兩筆訂單時間完全相同時會出現兩列，而且邏輯上對每一列訂單都要算一次子查詢。

這三次分別踩到了子查詢的三種性質：純量子查詢只能回一個值、非相關子查詢只算一次、相關子查詢逐列求值。這一課從子查詢講起，接著是把查詢拆成步驟的 CTE、走樹狀資料的遞迴 CTE、不縮列的視窗函數，最後是寫入時常用的 UPSERT 與 `RETURNING`。

## 子查詢：非相關與相關

子查詢可以出現在三個位置，各有回傳形狀的限制：

| 位置 | 例子 | 必須回傳 |
|---|---|---|
| 運算式（純量子查詢） | `WHERE amount > (SELECT avg(amount) FROM orders)` | 最多一列一欄；0 列時當成 NULL |
| `IN` / `EXISTS` / `ANY` | `WHERE id IN (SELECT user_id FROM orders)` | 一欄、任意列（EXISTS 不在乎欄位） |
| `FROM`（衍生資料表） | `FROM (SELECT user_id, sum(amount) … GROUP BY user_id) t` | 任意形狀，像一張暫時的表 |

**非相關子查詢**不引用外層的欄位，邏輯上只算一次，結果代入外層。**相關子查詢**引用外層的欄位（上面的 `o.user_id`），邏輯上對外層每一列都要重算。規劃器常常能把 `EXISTS` / `IN` 改寫成 semi-join、anti-join，不見得真的逐列執行；但 SELECT 清單裡的相關純量子查詢通常就是一個 `SubPlan`，外層每一列跑一次。

```sql run
-- 非相關：全站平均只算一次，再拿來比較每筆訂單
SELECT id, user_id, amount
FROM orders
WHERE amount > (SELECT avg(amount) FROM orders)
ORDER BY id;

-- 相關：每筆訂單跟「同一位使用者自己的平均」比較
SELECT o.id, o.user_id, o.amount
FROM orders o
WHERE o.amount > (SELECT avg(o2.amount) FROM orders o2 WHERE o2.user_id = o.user_id)
ORDER BY o.id;

-- 純量子查詢放在 SELECT 清單：每位使用者跑一次；沒有訂單時回 NULL，用 coalesce 換成 0
SELECT u.name,
       coalesce((SELECT sum(o.amount) FROM orders o WHERE o.user_id = u.id), 0) AS total
FROM users u
ORDER BY u.id;
```

純量子查詢回傳超過一列時會在執行時報錯（`more than one row returned by a subquery used as an expression`），而不是在寫查詢時。這種錯常在上線後才出現：開發時每位使用者剛好只有一筆資料，正式資料一多就爆。純量子查詢要用聚合（`max`、`sum`）或 `LIMIT 1` 加 `ORDER BY` 保證只有一列。

## CTE：把查詢拆成有名字的步驟

`WITH` 讓一個查詢裡先定義幾個暫時的結果集，後面的步驟可以引用前面的。巢狀子查詢要從最內層往外讀，CTE 則可以從上往下讀。

需求：「消費總額高於全體平均的使用者，以及他們所在城市」。巢狀寫法：

```sql
SELECT u.name, u.city, t.total
FROM users u
JOIN (SELECT user_id, sum(amount) AS total FROM orders WHERE status <> 'cancelled' GROUP BY user_id) t
  ON t.user_id = u.id
WHERE t.total > (SELECT avg(total) FROM (SELECT user_id, sum(amount) AS total FROM orders
                                         WHERE status <> 'cancelled' GROUP BY user_id) t2);
```

同一段「每人總額」寫了兩次，改條件時很容易只改到一處。用 CTE：

```sql run
WITH totals AS (                  -- 步驟 1：每位使用者的有效消費總額
  SELECT user_id, sum(amount) AS total
  FROM orders
  WHERE status <> 'cancelled'
  GROUP BY user_id
),
avg_total AS (                    -- 步驟 2：這些總額的平均
  SELECT avg(total) AS v FROM totals
)
SELECT u.name, u.city, t.total, round(a.v, 2) AS avg_total
FROM totals t
JOIN users u ON u.id = t.user_id
CROSS JOIN avg_total a            -- avg_total 只有一列，CROSS JOIN 等於把它接到每一列上
WHERE t.total > a.v
ORDER BY t.total DESC;
```

CTE 會不會被當成「先算完存起來」，跟版本有關：

- PostgreSQL 12 以前，CTE 一律先算完再給後面用（稱為 optimization fence），外層的條件推不進去，有時反而變慢。
- PostgreSQL 12 起，沒有副作用、不是遞迴、而且**只被引用一次**的 CTE 會被展開到外層查詢裡一起最佳化；被引用兩次以上的仍會先算完。可以用 `WITH x AS MATERIALIZED (…)` 或 `AS NOT MATERIALIZED (…)` 明確指定。

所以在目前的 PostgreSQL 裡，為了可讀性拆 CTE 通常不需要擔心效能；真的懷疑時用 `EXPLAIN` 看 CTE 有沒有出現成獨立的 `CTE Scan` 節點。

## 遞迴 CTE：走樹狀資料

分類有上下層（「周邊 > 輸入裝置 > 鍵盤」）、組織圖、留言的回覆串，都是一張表裡的列指向同一張表的另一列。自連接只能走固定層數；層數不固定時用 `WITH RECURSIVE`。

遞迴 CTE 由兩部分組成，用 `UNION ALL`（或 `UNION`）接起來：

1. **起始項**（non-recursive term）：只跑一次，產生第一批列。
2. **遞迴項**（recursive term）：引用 CTE 自己，每一輪只拿**上一輪新產生的列**當輸入，產生下一批。某一輪沒有產生新列時停止。

```sql run
CREATE TABLE categories (
  id        INT PRIMARY KEY,
  parent_id INT REFERENCES categories(id),
  name      TEXT NOT NULL
);
INSERT INTO categories VALUES
  (1, NULL, '周邊'), (2, 1, '輸入裝置'), (3, 2, '鍵盤'), (4, 2, '滑鼠'),
  (5, 1, '顯示'), (6, 5, '螢幕'), (7, NULL, '家具'), (8, 7, '椅子');

-- 從根往下走：每一列帶著深度與完整路徑
WITH RECURSIVE tree AS (
  SELECT id, name, 1 AS depth, name AS path        -- 起始項：沒有上層的分類
  FROM categories
  WHERE parent_id IS NULL
  UNION ALL
  SELECT c.id, c.name, t.depth + 1, t.path || ' > ' || c.name   -- 遞迴項：上一輪每個分類的子分類
  FROM categories c
  JOIN tree t ON c.parent_id = t.id
)
SELECT depth, path FROM tree ORDER BY path;

-- 反方向：從「鍵盤」往上找到根（麵包屑）
WITH RECURSIVE up AS (
  SELECT id, parent_id, name, 0 AS hops FROM categories WHERE name = '鍵盤'
  UNION ALL
  SELECT c.id, c.parent_id, c.name, up.hops + 1
  FROM categories c JOIN up ON c.id = up.parent_id
)
SELECT string_agg(name, ' > ' ORDER BY hops DESC) AS breadcrumb FROM up;
```

第一段的執行過程：

| 輪次 | 輸入（上一輪的新列） | 產生的新列 |
|---|---|---|
| 起始項 | | 周邊、家具（depth 1） |
| 第 1 輪 | 周邊、家具 | 輸入裝置、顯示、椅子（depth 2） |
| 第 2 輪 | 輸入裝置、顯示、椅子 | 鍵盤、滑鼠、螢幕（depth 3） |
| 第 3 輪 | 鍵盤、滑鼠、螢幕 | 沒有新列，停止 |

資料裡如果有循環（A 的上層是 B、B 的上層是 A），遞迴項永遠有新列，查詢就不會停。防護方式：

- 遞迴項加深度上限：`WHERE t.depth < 20`。
- 改用 `UNION`（去重）：產生的列跟之前完全相同時就不再加入。但上面帶著 `depth`、`path` 的列每輪都不同，`UNION` 擋不住。
- PostgreSQL 14 起可以在 CTE 後面加 `CYCLE id SET is_cycle USING visited`，由資料庫記錄走過的 id，遇到重複時標記並停止那條路。
- 從源頭避免：寫入時檢查不會形成循環。

## 視窗函數：計算跨列的值，但不縮列

聚合函數加 `GROUP BY` 會把一組縮成一列；**視窗函數**對每一列計算一個跨越「同一個視窗內其他列」的值，列數不變。語法是函數後面接 `OVER (…)`：

```text
函數() OVER (
  PARTITION BY 分組欄位     -- 視窗依什麼切開（像 GROUP BY，但不縮列）；省略就是整個結果
  ORDER BY 排序欄位         -- 視窗內的順序：排名、LAG、累計都靠它
  ROWS BETWEEN … AND …      -- 視窗框（frame）：累計、移動平均要算哪幾列
)
```

視窗函數在 `WHERE`、`GROUP BY`、`HAVING` **之後**才計算（邏輯執行順序見 [SQL 基礎](#/skill/sql-basics)），所以不能在 WHERE 裡用它的結果過濾，要包一層子查詢或 CTE。

### 排名：ROW_NUMBER、RANK、DENSE_RANK

```sql run
-- 加一筆跟 106 金額相同的訂單，製造平手
INSERT INTO orders (id, user_id, status, amount, created_at)
VALUES (107, 3, 'paid', 3290, '2026-03-14 10:00+08');

SELECT id, user_id, amount,
       row_number() OVER (ORDER BY amount DESC) AS row_number,  -- 一律 1, 2, 3…，平手時順序不保證
       rank()       OVER (ORDER BY amount DESC) AS rank,        -- 平手同名次，之後跳號：1, 2, 3, 3, 5
       dense_rank() OVER (ORDER BY amount DESC) AS dense_rank   -- 平手同名次，不跳號：1, 2, 3, 3, 4
FROM orders
ORDER BY amount DESC, id;
```

| 函數 | 平手時 | 適合 |
|---|---|---|
| `row_number()` | 給不同的號碼（誰先誰後沒有保證，要在 ORDER BY 加上 id 這類唯一欄位） | 每組剛好取 N 筆、分頁、去重 |
| `rank()` | 同名次，下一名跳號 | 比賽排名：「並列第三，下一位是第五」 |
| `dense_rank()` | 同名次，不跳號 | 「前三種價位」這類以「不同值」計數的需求 |

### LAG、LEAD、累計與佔比

```sql run
SELECT o.user_id, o.id, o.created_at::date::text AS day, o.amount,
       -- 同一位使用者的上一筆訂單時間：算回購間隔
       o.created_at - lag(o.created_at) OVER w                          AS since_prev,
       -- 依時間累計到這一筆為止的消費
       sum(o.amount) OVER (w ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_total,
       -- 這一筆佔這位使用者總消費的比例（沒有 ORDER BY 的視窗 = 整個分區）
       round(100 * o.amount / sum(o.amount) OVER (PARTITION BY o.user_id), 1) AS pct_of_user
FROM orders o
WHERE o.user_id IN (1, 2)
WINDOW w AS (PARTITION BY o.user_id ORDER BY o.created_at)   -- 具名視窗：多個函數共用同一個定義
ORDER BY o.user_id, o.created_at;
```

累計那一行明寫了 `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`。只寫 `ORDER BY` 時，預設的視窗框是 `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`：排序值相同的列（例如同一天、同一秒）會被當成同一個位置，一起算進「目前這列」，平手的列會得到相同的累計值。要每一列逐筆累計就寫 `ROWS`。

`lag()` 在每個分區的第一列沒有上一筆，回傳 NULL；可以給第三個參數當預設值（`lag(x, 1, 0)`）。

## 每組前 N 名

「每位使用者金額最高的 2 筆訂單」「每個分類銷量前 3 的商品」是最常見的視窗函數用途：

```sql run
WITH ranked AS (
  SELECT o.*,
         row_number() OVER (PARTITION BY o.user_id ORDER BY o.amount DESC, o.id) AS rn
  FROM orders o
)
SELECT user_id, id, amount, rn
FROM ranked
WHERE rn <= 2                      -- 視窗函數的結果要在外層才能過濾
ORDER BY user_id, rn;

-- 每位使用者最新的一筆：開頭那個問題，平手時用 id 決定，保證一人一列
WITH latest AS (
  SELECT o.*,
         row_number() OVER (PARTITION BY o.user_id ORDER BY o.created_at DESC, o.id DESC) AS rn
  FROM orders o
)
SELECT user_id, id, status, amount FROM latest WHERE rn = 1 ORDER BY user_id;
```

同一個需求的幾種寫法：

| 寫法 | 特點 |
|---|---|
| `row_number()` + 外層 `WHERE rn <= N` | 可攜（多數現代關聯式資料庫都支援）；一次掃完整張表再排名 |
| `rank()` 代替 `row_number()` | 平手的都留下，結果可能多於 N 筆 |
| `DISTINCT ON`（只能取 1 筆） | PostgreSQL 專屬、最短，見 [SQL 基礎](#/skill/sql-basics) |
| `LATERAL (… ORDER BY … LIMIT N)` | 對每個分組跑一次子查詢；有合適的複合索引、而且分組數不多時很快，見 [JOIN](#/skill/sql-joins) |

## UPSERT：INSERT … ON CONFLICT

購物車：「加入購物車」時，商品不在車裡就新增一列，已經在車裡就把數量加上去。先查再決定 INSERT 或 UPDATE 的寫法，在兩個請求同時加同一個商品時會撞在一起：兩邊都查到「不存在」，第二個 INSERT 違反主鍵（或在沒有唯一約束時產生兩列）。`INSERT … ON CONFLICT` 把判斷交給資料庫，在一句裡原子地完成：

```sql run
CREATE TABLE cart_items (
  user_id    BIGINT  NOT NULL REFERENCES users(id),
  product_id BIGINT  NOT NULL REFERENCES products(id),
  qty        INTEGER NOT NULL CHECK (qty > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)          -- ON CONFLICT 需要一個唯一約束或唯一索引來判斷「衝突」
);

-- 第一次：沒有衝突，新增
INSERT INTO cart_items (user_id, product_id, qty) VALUES (1, 2, 1)
ON CONFLICT (user_id, product_id)
DO UPDATE SET qty = cart_items.qty + EXCLUDED.qty,   -- EXCLUDED 是「原本想插入的那一列」
              updated_at = now()
RETURNING user_id, product_id, qty, (old.qty IS NULL) AS inserted;   -- PostgreSQL 18 起 RETURNING 可以用 old / new

-- 第二次：衝突，改成更新；old.qty 是更新前的值
INSERT INTO cart_items (user_id, product_id, qty) VALUES (1, 2, 2)
ON CONFLICT (user_id, product_id)
DO UPDATE SET qty = cart_items.qty + EXCLUDED.qty, updated_at = now()
RETURNING user_id, product_id, old.qty AS old_qty, new.qty AS new_qty, (old.qty IS NULL) AS inserted;

-- DO NOTHING：已存在就略過；RETURNING 只會回傳真的插入的列
INSERT INTO cart_items (user_id, product_id, qty) VALUES (1, 2, 5), (1, 3, 1)
ON CONFLICT (user_id, product_id) DO NOTHING
RETURNING product_id, qty;

-- DO UPDATE 也可以加 WHERE：只有在條件成立時才更新（這裡：數量上限 3，超過就不動）
INSERT INTO cart_items (user_id, product_id, qty) VALUES (1, 2, 1)
ON CONFLICT (user_id, product_id)
DO UPDATE SET qty = cart_items.qty + EXCLUDED.qty
WHERE cart_items.qty + EXCLUDED.qty <= 3
RETURNING product_id, qty;

SELECT user_id, product_id, qty FROM cart_items ORDER BY product_id;
```

使用時要知道的細節：

- 衝突目標 `(user_id, product_id)` 必須對應到一個**唯一約束或唯一索引**；對應到部分唯一索引時，要把索引的 `WHERE` 條件也寫上：`ON CONFLICT (user_id) WHERE is_default DO …`。也可以用約束名稱：`ON CONFLICT ON CONSTRAINT cart_items_pkey`。
- 同一句 INSERT 裡的多列，不能有兩列撞到同一個既有的列，否則報 `ON CONFLICT DO UPDATE command cannot affect row a second time`。批次匯入前要先在應用程式或子查詢裡去重。
- 主鍵是 identity / sequence 時，即使最後走了 UPDATE，序號也已經被取用，所以 id 會跳號。
- `old` / `new` 出現在 `RETURNING` 裡是 PostgreSQL 18 的新功能。舊版常見的替代寫法是 `RETURNING (xmax = 0) AS inserted`，它依賴系統欄位的實作細節，官方文件沒有保證這個用法。
- PostgreSQL 15 起也有 SQL 標準的 `MERGE`，可以在一句裡寫「配到就更新、配不到就新增、某些條件就刪除」。兩者不能互換：PostgreSQL 文件提到，`MERGE` 遇到並行的 INSERT 時不會自動改走 UPDATE，需要這種行為時可以考慮 `INSERT … ON CONFLICT`。

## RETURNING：寫入後直接拿到結果

`INSERT`、`UPDATE`、`DELETE` 都可以加 `RETURNING`，把被寫入的列（包含資料庫產生的值）直接傳回，不用再查一次：

```sql run
CREATE TABLE notes (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- INSERT：拿到資料庫產生的 id 與預設值，不用另外 SELECT，也不會拿錯別人的 id
INSERT INTO notes (body) VALUES ('第一則'), ('第二則') RETURNING id, body;

-- UPDATE：條件式扣庫存，回傳空結果就代表沒扣成功（原理見交易那課）
UPDATE products SET stock = stock - 1 WHERE id = 3 AND stock > 0 RETURNING id, stock;
UPDATE products SET stock = stock - 1 WHERE id = 4 AND stock > 0 RETURNING id, stock;  -- 耳機庫存 0：回傳 0 列

-- 搭配 CTE：把取消的訂單搬到封存表，一句完成「刪除並寫入」
-- 取消的訂單還有品項指向它（外鍵），所以品項要在同一句裡一起刪
CREATE TABLE orders_archive (LIKE orders);
WITH gone_items AS (
  DELETE FROM order_items
  WHERE order_id IN (SELECT id FROM orders WHERE status = 'cancelled')
  RETURNING order_id
),
moved AS (
  DELETE FROM orders WHERE status = 'cancelled'
  RETURNING *
)
INSERT INTO orders_archive SELECT * FROM moved
RETURNING id, status, amount;
```

最後那段是 **data-modifying CTE**：`WITH` 裡放 `DELETE … RETURNING`，外層用它的結果 INSERT。整句是一個語句，要嘛刪除和寫入都發生、要嘛都不發生。外鍵檢查在語句結束時進行，那時品項和訂單都已經刪掉，所以不會違反約束。要注意的是，`WITH` 裡的各個子語句使用同一份快照，彼此看不到對方對資料表的修改，只能透過 `RETURNING` 的結果傳遞資料；不要寫成兩個子語句修改同一列。

`UPDATE … RETURNING` 的條件式寫法是防超賣的基本工具，背後的並行行為在 [交易與隔離等級](#/skill/transactions) 有完整的時間線。

## 常見錯誤與錯誤訊息

| 錯誤訊息（PostgreSQL） | SQLSTATE | 觸發的寫法 | 怎麼修 |
|---|---|---|---|
| `more than one row returned by a subquery used as an expression` | `21000` | 純量子查詢回了多列，例如 `(SELECT id FROM orders WHERE user_id = u.id)` | 用聚合或 `ORDER BY … LIMIT 1`；或改成 JOIN / LATERAL |
| `window functions are not allowed in WHERE` | `42P20` | `WHERE row_number() OVER (…) = 1` | 包成子查詢或 CTE，在外層過濾 |
| `window functions are not allowed in HAVING` | `42P20` | 在 HAVING 裡用視窗函數 | 同上 |
| `column "r" does not exist` | `42703` | `SELECT rank() OVER (…) AS r … WHERE r <= 3`：別名在 WHERE 時還不存在 | 同上 |
| `recursive query "t" column 1 has type integer in non-recursive term but type bigint overall` | `42804` | 遞迴 CTE 起始項與遞迴項的欄位型別不同（`1` 是 integer，遞迴項算出 bigint） | HINT 會說要轉型起始項：`SELECT 1::bigint …` |
| `ORDER BY in a recursive query is not implemented` | `0A000` | 在遞迴 CTE 內部寫 ORDER BY | 排序放在最外層的 SELECT |
| `there is no unique or exclusion constraint matching the ON CONFLICT specification` | `42P10` | `ON CONFLICT (name)`，但 name 沒有唯一約束 | 建唯一約束或唯一索引；部分唯一索引要加上 WHERE |
| `ON CONFLICT DO UPDATE command cannot affect row a second time` | `21000` | 同一句 INSERT 有兩列的衝突鍵相同 | HINT：確保同一句裡要插入的列沒有重複的鍵；先去重 |

沒有錯誤訊息、但結果錯的情況：

- **`row_number()` 的 ORDER BY 沒有唯一鍵**：平手時誰是第一名每次可能不同，「最新一筆」就會飄。加上 `id` 當最後的排序鍵。
- **累計用了預設的 RANGE 框**：同時間的列得到相同的累計值。逐列累計寫 `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`。
- **遞迴 CTE 遇到循環資料**：查詢不會結束，直到逾時。加深度上限或 `CYCLE`。
- **在 `SELECT` 清單放相關子查詢處理大表**：每一列跑一次，列數一多就慢。改成先聚合再 JOIN。

## 動手

1. 「排名」那段按「在 Playground 開啟」，把三個函數的 `ORDER BY amount DESC` 都加上 `PARTITION BY user_id`，觀察每位使用者各自從 1 開始排。
2. 在 LAG 那段把累計的視窗框拿掉（只留 `OVER w`），再插入一筆跟 101 號訂單同一時間的 Alice 訂單，比較兩種框的累計值差在哪一列。
3. 在遞迴 CTE 那段的麵包屑查詢之前加一句 `UPDATE categories SET parent_id = 3 WHERE id = 1;` 製造循環（周邊的上層變成鍵盤）。先替遞迴項加上 `WHERE up.hops < 10` 再跑，看名稱怎麼一圈圈重複；再改成在 CTE 的括號後面加 `CYCLE id SET is_cycle USING visited`，看資料庫在第幾步標出循環。
4. 程式題：[每個使用者最新的一筆訂單](#/exercise/sql-advanced-1)、[用 CTE 找消費高於平均的人](#/exercise/sql-advanced-2)。

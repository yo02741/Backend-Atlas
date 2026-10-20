## 從一個具體問題開始：名單少了人，報表多了錢

行銷要寄一封「台北以外地區限定」的優惠信，有人寫了這句：

```sql
SELECT name, email FROM users WHERE city <> '台北';
```

名單出來，寄出去。幾天後客服發現：註冊時沒填城市的使用者一封都沒收到。資料庫沒有報錯，`city` 是 NULL 的列就這樣安靜地被排除了，因為 `NULL <> '台北'` 的結果不是 true，而是 NULL。

同一週，另一份報表要算「平均每筆訂單買幾件」，寫成 `sum(qty) / count(DISTINCT order_id)`，結果是 `1`。實際是 7 件除以 6 筆，約 1.17。兩邊都是整數，SQL 做的是整數除法，小數直接捨去。

這兩件事都不會出現錯誤訊息。SQL 寫起來像英文，但它有自己的求值規則：子句的執行順序、NULL 的三值邏輯、聚合之後剩下什麼、型別怎麼運算。下面一項一項拆開。

## 運作原理：一句 SELECT 的邏輯執行順序

SQL 的書寫順序是 `SELECT … FROM … WHERE … GROUP BY … HAVING … ORDER BY … LIMIT`，但**邏輯上**的求值順序是：

| 步驟 | 子句 | 這一步做什麼 | 這一步看得到什麼 |
|---|---|---|---|
| 1 | `FROM` / `JOIN` | 把來源資料表配對成一張中間表 | 所有來源欄位 |
| 2 | `WHERE` | 逐列過濾，只留條件為 **true** 的列 | 來源欄位（還沒有 SELECT 的別名、也還沒有聚合） |
| 3 | `GROUP BY` | 把列分組，每組縮成一列 | 來源欄位 |
| 4 | `HAVING` | 過濾**組** | 群組鍵、聚合函數 |
| 5 | `SELECT` | 計算輸出欄位、取別名 | 群組鍵、聚合（有 GROUP BY 時） |
| 6 | `DISTINCT` | 去除重複的輸出列 | 輸出欄位 |
| 7 | `ORDER BY` | 排序 | 輸出欄位與別名（PostgreSQL 也允許來源欄位） |
| 8 | `LIMIT` / `OFFSET` | 取其中一段 | 排好序的結果 |

這是「結果要等同於照這個順序做」的定義，不是引擎真的照這個順序跑：規劃器可以先用索引過濾、把條件推進 JOIN 之前，只要結果一樣。但**哪個子句能用什麼名字**是照這個順序決定的。

用範例資料庫走一遍「各城市未取消的訂單數與總額，只列至少 2 筆的」：

```sql run
-- 每一步的中間結果寫在下面的表格裡，可以把子句一個個拿掉重跑來對照
SELECT u.city, count(*) AS n, sum(o.amount) AS total
FROM orders o
JOIN users u ON u.id = o.user_id          -- 1. 訂單配上使用者（user_id = 9 的訂單 105 配不到，被 INNER JOIN 排除）
WHERE o.status <> 'cancelled'             -- 2. 逐列過濾
GROUP BY u.city                           -- 3. 依城市分組
HAVING count(*) >= 2                      -- 4. 過濾組
ORDER BY total DESC;                      -- 7. ORDER BY 可以用 SELECT 的別名
```

中間狀態：

| 階段 | 剩下的資料 |
|---|---|
| FROM + JOIN | 101 台北 2400、102 台北 890、103 台中 7990、104 高雄 3200、106 台中 3290（105 的 user_id 9 不存在，配不到） |
| WHERE | 同上，五筆都不是 cancelled |
| GROUP BY | 台北 {2400, 890}、台中 {7990, 3290}、高雄 {3200} |
| HAVING | 高雄只有 1 筆，整組去掉 |
| SELECT | 台北 2 3290、台中 2 11280 |
| ORDER BY | 台中 11280 在前，台北 3290 在後 |

從這張表可以直接推出幾條規則：

- `WHERE` 不能用 `SELECT` 取的別名，因為那時別名還不存在。
- `WHERE` 不能放聚合（`count(*) > 1`），因為那時還沒分組；過濾組要用 `HAVING`。
- `HAVING` 在 PostgreSQL 裡也**不能**用輸出別名（`HAVING total > 1` 會報 `column "total" does not exist`），要把聚合再寫一次：`HAVING sum(o.amount) > 1`。
- `ORDER BY` 在 SELECT 之後，所以可以用別名。PostgreSQL 的 `GROUP BY` 也接受輸出欄位名稱，但同名時優先當成來源欄位，容易混淆，別的資料庫也不一定支援。

> `LIMIT` 沒有搭配 `ORDER BY` 時，回傳哪幾列是沒有保證的。資料量小時看起來每次都一樣，表變大、計畫改變後就可能換一批。分頁、「前 10 名」一定要寫 `ORDER BY`，而且排序鍵要能分出唯一順序（例如 `ORDER BY created_at DESC, id DESC`）。

## NULL：三值邏輯

NULL 代表「不知道」或「不適用」，不是 0、也不是空字串。任何值跟 NULL 比較，結果都是 NULL（不知道），連 `NULL = NULL` 也是 NULL。布林運算因此有三個值：

| a | b | a AND b | a OR b | NOT a |
|---|---|---|---|---|
| true | NULL | NULL | true | false |
| false | NULL | false | NULL | true |
| NULL | NULL | NULL | NULL | NULL |

關鍵在 `WHERE` 的規則：**只留結果為 true 的列**，false 和 NULL 都會被丟掉。這就是開頭寄信名單漏人的原因：

```sql run
-- 加一位沒填城市的使用者
INSERT INTO users (id, name, email, city, created_at)
VALUES (6, 'Frank', 'frank@example.com', NULL, '2026-03-20');

-- 錯：Frank 的 city <> '台北' 是 NULL，不是 true，被過濾掉
SELECT name, city FROM users WHERE city <> '台北';

-- 對：把「不知道」明確放進來
SELECT name, city FROM users WHERE city <> '台北' OR city IS NULL;

-- 同樣意思、更短：IS DISTINCT FROM 把 NULL 當成一個可以比較的值
SELECT name, city FROM users WHERE city IS DISTINCT FROM '台北';

-- 比較 NULL 本身要用 IS NULL；= NULL 永遠不會是 true
SELECT count(*) AS eq_null FROM users WHERE city = NULL;
SELECT count(*) AS is_null FROM users WHERE city IS NULL;
```

聚合函數對 NULL 也有各自的規則：

| 寫法 | 對 NULL 的處理 | 範例資料加入 Frank 後 |
|---|---|---|
| `count(*)` | 數列數，不看欄位值 | 6 |
| `count(city)` | 只數不是 NULL 的值 | 5 |
| `count(DISTINCT city)` | 不同的非 NULL 值 | 5 |
| `sum(x)` / `avg(x)` | 忽略 NULL；**沒有任何非 NULL 值時回傳 NULL**，不是 0 | |
| `coalesce(x, 0)` | 把 NULL 換成給定的值 | |

`sum` 回 NULL 很容易在報表裡造成「應該顯示 0 卻顯示空白」，或在程式裡變成 `None + 1` 的錯誤。沒有資料時要顯示 0，就寫 `coalesce(sum(amount), 0)`。

排序時，PostgreSQL 把 NULL 當成比所有值都大：`ORDER BY x` 時 NULL 在最後，`ORDER BY x DESC` 時 NULL 在最前面。要改用 `NULLS FIRST` / `NULLS LAST` 明寫。

還有一個常見的 NULL 地雷是 `NOT IN`：子查詢回傳的值裡只要有一個 NULL，`x NOT IN (…)` 對每一列都不會是 true，整個結果變空。這和 anti-join 一起在 [JOIN](#/skill/sql-joins) 那課詳細講。

## 聚合、GROUP BY 與 HAVING

`GROUP BY` 把同一組的列縮成**一列**。縮完之後，SELECT 裡每個欄位都必須對每一組有唯一的值，所以只能是：

1. 群組鍵本身
2. 聚合函數（`count`、`sum`、`avg`、`min`、`max`、`string_agg`…）
3. 在功能上相依於群組鍵的欄位：PostgreSQL 允許 `GROUP BY users.id` 之後直接 SELECT `users.name`，因為 `id` 是主鍵，每個 id 只對應一個 name

寫 `SELECT name, count(*) FROM users GROUP BY city` 時，台北那一組可能有很多個 name，資料庫不知道要給哪一個，就會報錯，而不是隨便挑一個。

```sql run
-- 每位使用者的訂單統計：GROUP BY 主鍵後可以直接取 name、city
SELECT u.id, u.name, u.city,
       count(o.id)                                    AS orders,      -- LEFT JOIN 沒配到時 o.id 是 NULL，count 不算它
       count(*) FILTER (WHERE o.status = 'paid')      AS paid_orders, -- FILTER：只把符合條件的列餵給聚合
       coalesce(sum(o.amount), 0)                     AS total        -- 沒訂單時 sum 是 NULL，換成 0
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
GROUP BY u.id
ORDER BY total DESC, u.id;
```

注意 `count(o.id)` 而不是 `count(*)`：Dave、Eve 沒有訂單，LEFT JOIN 仍會為他們留一列（訂單欄位全是 NULL），`count(*)` 會把這一列算成 1 筆。

`WHERE` 和 `HAVING` 都能過濾，差在時機：

| | WHERE | HAVING |
|---|---|---|
| 過濾的對象 | 分組**前**的每一列 | 分組**後**的每一組 |
| 能不能用聚合 | 不能 | 能 |
| 效能 | 越早丟掉越少資料要分組 | 已經做完分組 |

所以「只算已付款的訂單」放 `WHERE status = 'paid'`；「只列總額超過 5,000 的使用者」放 `HAVING sum(amount) > 5000`。能放 WHERE 的條件就不要放 HAVING。

## 型別：存什麼就得到什麼

型別決定了值怎麼比較、怎麼運算、能不能用索引。範例資料庫的選擇各有理由：

| 用途 | 建議型別 | 理由 |
|---|---|---|
| 金額 | `NUMERIC(10,2)` | 十進位精確值；浮點數（`real`、`double precision`）是二進位近似，`0.1 + 0.2` 不等於 `0.3` |
| 時間點 | `TIMESTAMPTZ` | 存的是絕對時間點（內部以 UTC 保存），顯示時轉成連線的 `TimeZone` |
| 主鍵 | `BIGINT`（identity）或 `UUID` | `INTEGER` 上限約 21 億，量大的表會用完 |
| 文字 | `TEXT` | PostgreSQL 文件寫明 `text`、`varchar(n)` 沒有效能差異；長度限制需要的話用 `CHECK` 或 `varchar(n)` |
| 狀態 | `TEXT` + `CHECK (status IN (…))` 或 enum | 讓資料庫擋掉拼錯的狀態 |

```sql run
-- 浮點數 vs NUMERIC
SELECT 0.1::double precision + 0.2::double precision AS float_sum,
       0.1::numeric + 0.2::numeric                   AS numeric_sum;

-- 整數相除會捨去小數；要小數就先轉型
SELECT 7 / 2 AS int_div, 7::numeric / 2 AS numeric_div, avg(stock) AS avg_stock FROM products;

-- TIMESTAMPTZ：同一個時間點，換時區顯示（轉成 text 才看得到連線時區的效果）
SET TimeZone = 'Asia/Taipei';
SELECT id, created_at::text AS shown FROM orders WHERE id = 101;   -- 2026-03-01 10:00:00+08
SET TimeZone = 'UTC';
SELECT id, created_at::text AS shown FROM orders WHERE id = 101;   -- 2026-03-01 02:00:00+00，同一個時間點

-- 「按日」統計時，日界線取決於時區：台北早上 7 點在 UTC 還是前一天
INSERT INTO orders (id, user_id, status, amount, created_at)
VALUES (107, 4, 'paid', 890, '2026-03-09 07:30+08');
SELECT id,
       created_at::date::text                              AS utc_day,     -- 用連線時區（這裡是 UTC）切日
       (created_at AT TIME ZONE 'Asia/Taipei')::date::text AS taipei_day   -- 明確指定台北時區切日
FROM orders WHERE id = 107;
```

最後那段是報表常見的錯：伺服器或連線時區是 UTC，`created_at::date` 會把台北早上 8 點以前的訂單算到前一天。按日統計時要明確寫出業務所在的時區。

`TIMESTAMP`（不帶時區）只存「牆上的鐘幾點」，不知道是哪個時區的幾點；資料從不同時區寫進來時就無法比較先後。記錄「事情什麼時候發生」一律用 `TIMESTAMPTZ`。

`NUMERIC(10,2)` 的意思是總共 10 位數、其中 2 位小數，所以整數部分最多 8 位；超過會報錯而不是默默截斷。

## DISTINCT ON：每組取一列

「每位使用者最新的一筆訂單」不能只靠 GROUP BY：`max(created_at)` 只拿得到時間，拿不到那筆訂單的其他欄位。PostgreSQL 有一個專屬寫法 `DISTINCT ON`：

```sql run
-- 依 user_id 分組，每組只留 ORDER BY 排序後的第一列
SELECT DISTINCT ON (o.user_id)
       o.user_id, o.id, o.status, o.amount, o.created_at
FROM orders o
ORDER BY o.user_id, o.created_at DESC, o.id DESC;   -- 前導鍵必須跟 DISTINCT ON 相同；最後的 id 讓同時間的訂單也有確定順序
```

規則是：`ORDER BY` 最前面的運算式必須和 `DISTINCT ON (…)` 一樣，後面接的欄位決定「每組哪一列排第一」。沒有寫後面的排序，每組留下哪一列就沒有保證。

`DISTINCT ON` 是 PostgreSQL 擴充，MySQL、SQL Server 沒有。可攜的寫法是視窗函數 `ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC)`，也能延伸成「每組前 N 筆」，在 [子查詢、CTE 與視窗函數](#/skill/sql-advanced) 那課講。

## 常見錯誤與錯誤訊息

以下是 PostgreSQL 的錯誤原文，可以把對應的句子貼進 Playground 重現：

| 錯誤訊息 | SQLSTATE | 觸發的寫法 | 怎麼修 |
|---|---|---|---|
| `column "users.name" must appear in the GROUP BY clause or be used in an aggregate function` | `42803` | `SELECT name, count(*) FROM users GROUP BY city` | 把欄位加進 GROUP BY、包進聚合（`string_agg(name, ', ')`），或改成 GROUP BY 主鍵 |
| `aggregate functions are not allowed in WHERE` | `42803` | `WHERE count(*) > 1` | 條件搬到 `HAVING` |
| `column "doubled" does not exist` | `42703` | `SELECT amount * 2 AS doubled … WHERE doubled > 100` | WHERE / HAVING 裡重寫運算式，或包一層子查詢後再過濾 |
| `SELECT DISTINCT ON expressions must match initial ORDER BY expressions` | `42P10` | `DISTINCT ON (user_id) … ORDER BY created_at DESC` | ORDER BY 前面補上 `user_id` |
| `for SELECT DISTINCT, ORDER BY expressions must appear in select list` | `42P10` | `SELECT DISTINCT city FROM users ORDER BY created_at` | 去重之後每個 city 對應多個 created_at，沒辦法排；改排輸出欄位，或用 GROUP BY 搭配 `min(created_at)` |
| `operator does not exist: text = integer` | `42883` | `WHERE name = 1` | 兩邊型別對齊；這通常代表參數型別傳錯，不要只加轉型了事 |
| `numeric field overflow` | `22003` | 把 `123456789.99` 寫進 `NUMERIC(10,2)` | DETAIL 會寫出精度限制；確認欄位定義是否太小 |
| `division by zero` | `22012` | `amount / 0` | 分母用 `NULLIF(x, 0)` 包起來，讓結果變 NULL |

錯誤訊息裡的引號內容就是線索：`column "users.name"` 告訴你哪個欄位沒被分組，`column "doubled"` 是一個只在 SELECT 裡定義的名字。

不會報錯、但結果錯的寫法：

- `WHERE city = NULL`：永遠 0 筆。要寫 `IS NULL`。
- `WHERE status <> 'paid'`：會漏掉 status 是 NULL 的列（範例的 orders.status 有 `NOT NULL`，所以這張表不會發生；沒加約束的欄位都要想一下）。
- 整數相除：`count(*) / 3`、`stock / 2` 都會捨去小數。
- `created_at BETWEEN '2026-03-01' AND '2026-03-31'`：右界是 3 月 31 日 00:00，當天其餘時間全部漏掉。時間區間用半開區間 `created_at >= '2026-03-01' AND created_at < '2026-04-01'`。
- `LIMIT` 沒有 `ORDER BY`：結果順序沒有保證。
- LEFT JOIN 後用 `count(*)` 數右表：沒配到的列也會被算成 1。

## 動手

1. 開頭那段 NULL 範例按「在 Playground 開啟」，把 Frank 的 city 改成 `'台北'` 再跑，看三種寫法的結果怎麼變。
2. 在「各城市訂單數」那段把 `HAVING count(*) >= 2` 改成 `HAVING total >= 5000`，看錯誤訊息；再改成 `HAVING sum(o.amount) >= 5000`。
3. 型別那段把第二個 `SET TimeZone = 'UTC'` 改成 `'Asia/Tokyo'`，看 107 號訂單的 `utc_day` 變成哪一天：同一句 `::date`，換了連線時區就換了答案（欄位名稱也就不再名副其實）。
4. 程式題：[每個城市的訂單數與總金額](#/exercise/sql-basics-1)、[金額最高的三筆訂單](#/exercise/sql-basics-2)、[各狀態的訂單數](#/exercise/sql-basics-3)。

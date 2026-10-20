## 從一個具體問題開始：營收多算了 3,290 元

財務要一張「每位客戶的訂單總額，以及買了幾件商品」。有人寫了這句：

```sql
SELECT u.name, sum(o.amount) AS total, sum(oi.qty) AS items
FROM users u
JOIN orders o       ON o.user_id = u.id
JOIN order_items oi ON oi.order_id = o.id
GROUP BY u.name;
```

Bob 的 `total` 是 14,570。但 Bob 只有兩張訂單：103 號 7,990 元、106 號 3,290 元，加起來應該是 11,280。多出來的 3,290 正好是 106 號訂單的金額：這張訂單有兩個品項（滑鼠和鍵盤），JOIN `order_items` 之後它變成兩列，`sum(o.amount)` 就把它加了兩次。

查詢沒有報錯，數字看起來也很合理。這種錯在報表上線很久之後才會被對帳發現。要避開它，得先把 JOIN 的本質想清楚：**JOIN 是在配對列，配對結果有幾列，後面的聚合就看到幾列**。

## 運作原理：JOIN 是配對列

### 先想成「全部配一遍，再用 ON 篩」

邏輯上，`A JOIN B ON 條件` 等於：把 A 的每一列和 B 的每一列都配一次（笛卡兒積，`CROSS JOIN`），再只留下 ON 條件為 true 的組合。資料庫實際上不會真的產生笛卡兒積（它會用 Nested Loop、Hash Join、Merge Join 這些演算法），但結果和這個定義一致。

範例資料庫有 5 位使用者、6 張訂單：

| 寫法 | 結果列數 | 說明 |
|---|---|---|
| `users CROSS JOIN orders` | 30 | 5 × 6，全部配一遍 |
| `users JOIN orders ON o.user_id = u.id` | 5 | 只留配得上的組合；105 號訂單的 user_id 是 9，沒有這個使用者 |
| `users LEFT JOIN orders …` | 7 | 5 筆配對，加上沒有訂單的 Dave、Eve 各一列（訂單欄位填 NULL） |
| `users RIGHT JOIN orders …` | 6 | 5 筆配對，加上配不到使用者的 105 號訂單 |
| `users FULL JOIN orders …` | 8 | 5 筆配對 + Dave + Eve + 105 號訂單 |

從列數就能看出每種 JOIN 在做什麼：

- **INNER JOIN**：只留兩邊都配得上的組合。
- **LEFT JOIN**：左表每一列至少出現一次；配不到就用一列 NULL 補右邊。
- **RIGHT JOIN**：反過來，保右表。幾乎都可以把兩張表對調改寫成 LEFT JOIN，多數團隊統一只用 LEFT。
- **FULL JOIN**：兩邊配不到的都留。PostgreSQL 支援；MySQL 不支援 FULL JOIN，要用 LEFT 和 RIGHT 的結果 `UNION` 起來。
- 三種**排除式**：LEFT JOIN 再 `WHERE 右.鍵 IS NULL`（只留左邊配不到的）、RIGHT 對稱版、FULL JOIN 再 `WHERE 左.鍵 IS NULL OR 右.鍵 IS NULL`（只留兩邊配不到的）。這七種的文氏圖可以在 [JOIN 七兄弟實驗室](#/lab/SqlJoinLab) 切換對照。

### 一對多會讓列變多

配對的列數取決於關係的基數：

| 關係 | 例子 | JOIN 之後左表每一列變成 |
|---|---|---|
| 一對一 | users ↔ user_profiles | 0 或 1 列 |
| 一對多 | users → orders | 0 到 N 列（看這個人有幾張訂單） |
| 多對多（經過中介表） | orders → order_items → products | 每張訂單變成品項數那麼多列 |

把 users、orders、order_items 串起來時，每一列代表的是「**一個品項**」，不再是「一張訂單」。在這個粒度上 `sum(o.amount)` 就是錯的：同一張訂單的金額被每個品項重複了一次。

```sql run
-- 看清楚 JOIN 之後每一列代表什麼：106 號訂單出現了兩次
SELECT u.name, o.id AS order_id, o.amount, oi.product_id, oi.qty
FROM users u
JOIN orders o       ON o.user_id = u.id
JOIN order_items oi ON oi.order_id = o.id
WHERE u.name = 'Bob'
ORDER BY o.id;
```

## 先聚合再 JOIN

修法的原則是：**每個聚合要在它自己的粒度上算**。訂單金額在訂單的粒度上加總，品項數量在品項的粒度上加總，算完再接起來。

```sql run
-- 錯的寫法：amount 被品項數放大
SELECT u.name, sum(o.amount) AS total, sum(oi.qty) AS items
FROM users u
JOIN orders o       ON o.user_id = u.id
JOIN order_items oi ON oi.order_id = o.id
GROUP BY u.name
ORDER BY u.name;

-- 對的寫法：先把 order_items 縮成「每張訂單一列」，再跟 orders JOIN
SELECT u.name, sum(o.amount) AS total, sum(i.items) AS items
FROM users u
JOIN orders o ON o.user_id = u.id
JOIN (
  SELECT order_id, sum(qty) AS items     -- 先聚合：每張訂單只剩一列
  FROM order_items
  GROUP BY order_id
) i ON i.order_id = o.id
GROUP BY u.name
ORDER BY u.name;
```

第二句裡，子查詢 `i` 每張訂單只有一列，JOIN 之後不會讓訂單變多，`sum(o.amount)` 回到正確的 11,280。

有人會改用 `sum(DISTINCT o.amount)` 救急。這是錯的：同一個人兩張金額相同的訂單，會被當成一張。`count(DISTINCT o.id)` 可以正確數出訂單數，但金額的加總沒有對應的 DISTINCT 救法，還是要先聚合。

> 判斷 JOIN 有沒有放大列數的簡單方法：寫完 FROM / JOIN 後先 `SELECT count(*)`，和你預期的粒度（幾張訂單、幾位使用者）比對。數字不一樣就代表某段 JOIN 是一對多。

## LEFT JOIN 的條件：放 ON 還是 WHERE

INNER JOIN 時，條件放 ON 或 WHERE 結果一樣。LEFT JOIN 不一樣，因為兩者發生的時間不同：

- **ON** 決定「右表哪些列可以跟左表配對」。配不到時，左表那一列仍然保留，右邊填 NULL。
- **WHERE** 在配對**完成之後**才過濾。右邊被填成 NULL 的列，`o.status = 'paid'` 的結果是 NULL，不是 true，於是整列被丟掉。

需求：「列出所有使用者，以及他們已付款的訂單數（沒有就是 0）」。

```sql run
-- 條件放 ON：所有使用者都在，只有 paid 的訂單參與配對
SELECT u.name, count(o.id) AS paid_orders
FROM users u
LEFT JOIN orders o ON o.user_id = u.id AND o.status = 'paid'
GROUP BY u.id
ORDER BY u.id;

-- 條件放 WHERE：沒有 paid 訂單的人整列消失，LEFT JOIN 實質變成 INNER JOIN
SELECT u.name, count(o.id) AS paid_orders
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE o.status = 'paid'
GROUP BY u.id
ORDER BY u.id;
```

| 使用者 | 條件放 ON | 條件放 WHERE |
|---|---|---|
| Alice | 1 | 1 |
| Bob | 2 | 2 |
| Carol（只有 pending 訂單） | 0 | 不見了 |
| Dave（沒有訂單） | 0 | 不見了 |
| Eve（沒有訂單） | 0 | 不見了 |

反過來也有一個容易誤會的地方：把**左表**的條件放進 ON（例如 `ON o.user_id = u.id AND u.city = '台北'`），並不會過濾掉其他城市的使用者。它們仍然全部出現，只是右邊都配不到。要過濾左表就放 WHERE。

整理成規則：LEFT JOIN 時，**限制右表的條件放 ON，限制左表的條件放 WHERE**。只有在 WHERE 裡寫 `右.鍵 IS NULL` 是刻意的（那就是 anti-join）。

## Anti-join：找「沒有對應」的資料

「從未下單的使用者」「沒被任何商品使用的分類」「找不到使用者的孤兒訂單」，都是 anti-join。常見三種寫法：

```sql run
-- 1. NOT EXISTS：對每位使用者問「存在他的訂單嗎？」
SELECT u.id, u.name FROM users u
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id)
ORDER BY u.id;

-- 2. LEFT JOIN … IS NULL：配不到的那些列，右表欄位全是 NULL
--    檢查 ON 條件裡用到的欄位（o.user_id）：配得上時它一定不是 NULL
SELECT u.id, u.name FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE o.user_id IS NULL
ORDER BY u.id;

-- 3. NOT IN：現在結果一樣，但有一個陷阱，見下一段
SELECT u.id, u.name FROM users u
WHERE u.id NOT IN (SELECT user_id FROM orders)
ORDER BY u.id;
```

三句都回傳 Dave 和 Eve。接著加一張訪客訂單（沒有登入，`user_id` 是 NULL；範例的 orders.user_id 允許 NULL）：

```sql run
INSERT INTO orders (id, user_id, status, amount, created_at)
VALUES (107, NULL, 'paid', 890, '2026-03-15 12:00+08');

-- NOT EXISTS 不受影響：仍然是 Dave、Eve
SELECT u.name FROM users u
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id)
ORDER BY u.id;

-- NOT IN 變成 0 筆
SELECT u.name FROM users u
WHERE u.id NOT IN (SELECT user_id FROM orders);

-- 修 NOT IN 的方法：把 NULL 排除在子查詢外（但改用 NOT EXISTS 更不容易忘）
SELECT u.name FROM users u
WHERE u.id NOT IN (SELECT user_id FROM orders WHERE user_id IS NOT NULL)
ORDER BY u.id;
```

原因是三值邏輯。`4 NOT IN (1, 2, 3, 9, NULL)` 等於 `4 <> 1 AND 4 <> 2 AND 4 <> 3 AND 4 <> 9 AND 4 <> NULL`。最後一項是 NULL，`true AND NULL` 是 NULL，WHERE 只留 true，所以每一列都被丟掉。`NOT EXISTS` 只問「有沒有至少一列滿足 `o.user_id = u.id`」，NULL 那一列不滿足條件、不會被算進去，答案就正確。

| 寫法 | 遇到右表有 NULL | 語意 | 在範例資料上看到的計畫（PostgreSQL 18） |
|---|---|---|---|
| `NOT EXISTS` | 正確 | 存在性檢查，最直接 | `Hash Right Anti Join` |
| `LEFT JOIN … IS NULL` | 正確 | 要選對 IS NULL 的欄位 | 檢查 ON 裡的欄位（`o.user_id`）時是 Anti Join；改成檢查 `o.id` 時變成 Hash Join 之後再 Filter |
| `NOT IN (子查詢)` | **整個結果變空** | 只有子查詢欄位保證 NOT NULL 時才安全 | `hashed SubPlan`：對每一列查雜湊表；子查詢結果放不進 `work_mem` 時會退化成逐列比對 |

計畫會隨資料量和版本變，表格只是這份範例資料上 `EXPLAIN` 的結果，可以自己在 Playground 對三句加上 `EXPLAIN` 看。結論不受計畫影響：`NOT EXISTS` 語意最清楚、對 NULL 安全，是預設的選擇。

「存在」的版本（semi-join）也有同樣的選擇：「有已付款訂單的使用者」用 `EXISTS` 寫，每位使用者只出現一次；用 JOIN 寫，Bob 有兩張 paid 訂單就會出現兩次，還得加 DISTINCT。

## 自連接：同一張表 JOIN 自己

資料表裡的某一列指向同一張表的另一列時（推薦人、主管、上一層分類），就要自連接。同一張表出現兩次，靠**別名**區分角色：

```sql run
-- 加一個「推薦人」欄位，指向同一張 users 表
ALTER TABLE users ADD COLUMN referred_by BIGINT REFERENCES users(id);
UPDATE users SET referred_by = 1 WHERE id IN (2, 3);   -- Alice 推薦了 Bob、Carol
UPDATE users SET referred_by = 2 WHERE id = 4;         -- Bob 推薦了 Dave

-- u 是「被推薦的人」，r 是「推薦人」；LEFT JOIN 保留沒有推薦人的使用者
SELECT u.name AS member, r.name AS referrer
FROM users u
LEFT JOIN users r ON r.id = u.referred_by
ORDER BY u.id;

-- 自連接也能比較同一張表的兩列：同一位使用者 7 天內的兩張訂單
SELECT a.user_id, a.id AS first_order, b.id AS next_order,
       b.created_at - a.created_at AS gap
FROM orders a
JOIN orders b
  ON b.user_id = a.user_id
 AND b.id > a.id                                      -- 避免自己配自己，也避免 (a,b)、(b,a) 各出現一次
 AND b.created_at < a.created_at + interval '7 days'
ORDER BY a.user_id, a.id;
```

第二句的 `b.id > a.id` 很重要：少了它，每張訂單會跟自己配成一對，每一對也會正反各出現一次。

自連接只能往上或往下走固定層數。要一路走到樹根（整條推薦鏈、多層分類），用遞迴 CTE，在 [子查詢、CTE 與視窗函數](#/skill/sql-advanced) 那課。

## LATERAL：對左表每一列跑一次子查詢

「每位使用者最近的兩張訂單」：子查詢需要知道「現在是哪位使用者」，也就是引用外層的 `u.id`。一般放在 FROM 裡的子查詢看不到同一層其他表的欄位，加上 `LATERAL` 才可以：

```sql run
-- CROSS JOIN LATERAL：對每位使用者跑一次子查詢；子查詢沒結果的使用者會消失
SELECT u.name, recent.id, recent.amount, recent.created_at
FROM users u
CROSS JOIN LATERAL (
  SELECT o.id, o.amount, o.created_at
  FROM orders o
  WHERE o.user_id = u.id          -- 引用外層的 u：這就是 LATERAL 允許的事
  ORDER BY o.created_at DESC
  LIMIT 2
) AS recent
ORDER BY u.id, recent.created_at DESC;

-- LEFT JOIN LATERAL … ON true：保留沒有訂單的使用者
SELECT u.name, recent.id, recent.amount
FROM users u
LEFT JOIN LATERAL (
  SELECT o.id, o.amount
  FROM orders o
  WHERE o.user_id = u.id
  ORDER BY o.created_at DESC
  LIMIT 1
) AS recent ON true
ORDER BY u.id;
```

LATERAL 的 `ORDER BY … LIMIT N` 很直白地表達「每組前 N 筆」。`orders(user_id, created_at)` 有複合索引時，每位使用者的子查詢只要沿索引讀 N 筆，左表不大時效率很好；左表很大時，視窗函數一次掃完可能比較快。兩種寫法都該用 `EXPLAIN ANALYZE` 比較（見 [索引與查詢計畫](#/skill/indexes)）。LATERAL 是 SQL 標準，PostgreSQL 支援；MySQL 8.0.14 起也支援。

## 常見錯誤與錯誤訊息

| 錯誤訊息（PostgreSQL） | SQLSTATE | 觸發的寫法 | 怎麼修 |
|---|---|---|---|
| `column reference "id" is ambiguous` | `42702` | `SELECT id FROM users JOIN orders ON …`：兩張表都有 id | 每個欄位都加表別名（`u.id`、`o.id`） |
| `missing FROM-clause entry for table "o"` | `42P01` | 用了別名 `o`，但 FROM / JOIN 裡沒有這個別名（打錯字或忘了 JOIN） | 檢查別名拼寫、補上 JOIN |
| `invalid reference to FROM-clause entry for table "u"` | `42P01` | FROM 裡的子查詢引用了同層的 `u` | 訊息的 HINT 會直接寫 `To reference that table, you must mark this subquery with LATERAL.`：加上 LATERAL |
| `operator does not exist: bigint = text` | `42883` | ON 的兩邊型別不同（例如拿 user_id 去比 name） | 通常是 JOIN 錯欄位；確定沒錯才轉型 |
| `FULL JOIN is only supported with merge-joinable or hash-joinable join conditions` | `0A000` | FULL JOIN 的 ON 用了 `<`、`>` 這類不等式 | FULL JOIN 改用等值條件；不等式需求拆成 LEFT + RIGHT 再 UNION |
| `syntax error at end of input` | `42601` | `FROM users JOIN orders` 沒寫 ON | 補上 `ON …`；真的要全部配對就明寫 `CROSS JOIN` |

不會報錯、但結果錯的寫法：

- **一對多後直接 sum**：開頭的問題。先聚合再 JOIN。
- **LEFT JOIN 後在 WHERE 過濾右表**：LEFT 變 INNER。
- **`NOT IN` 遇到 NULL**：整個結果變空。用 `NOT EXISTS`。
- **逗號 JOIN 忘了條件**：`FROM users, orders` 沒有 WHERE 時就是 CROSS JOIN，30 列；大表會是幾億列。
- **`NATURAL JOIN`**：自動用「兩邊同名的欄位」配對。`users NATURAL JOIN orders` 會拿 `id` 和 `created_at` 兩個欄位比對，結果是 0 列；之後有人替某張表加了同名欄位，查詢會無聲地改變語意。明寫 ON。
- **LEFT JOIN 後用 `count(*)`**：沒配到的那一列也算 1。數右表要用 `count(右.id)`。

## 動手

1. 到 [JOIN 七兄弟實驗室](#/lab/SqlJoinLab) 切換七種 JOIN，對照上面的列數表；點掉某一列訂單，看哪些 JOIN 的結果跟著變。
2. 「先聚合再 JOIN」那段按「在 Playground 開啟」，把第一句改成 `count(DISTINCT o.id)`，確認訂單數正確但 total 仍然錯。
3. 在 anti-join 的 NULL 範例裡，再加一筆 `user_id = 4` 的訂單，看 Dave 從 `NOT EXISTS` 的結果中消失；`NOT IN` 那句不管怎麼加都是 0 筆，直到把訪客訂單刪掉。
4. 程式題：[從未下單的使用者](#/exercise/sql-joins-1)、[每個使用者的訂單數（含 0 筆）](#/exercise/sql-joins-2)、[找出孤兒訂單](#/exercise/sql-joins-3)、[條件放 ON 還是 WHERE](#/exercise/sql-joins-4)。

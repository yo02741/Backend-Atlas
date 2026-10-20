## 從一個具體問題開始：一張什麼都裝的訂單表

一個小商店一開始用一張表記錄所有訂單，欄位照著試算表抄：

| order_id | customer_name | customer_email | customer_city | products | total |
|---|---|---|---|---|---|
| 101 | Alice | alice@example.com | 台北 | 鍵盤 | 2400 |
| 102 | Alice | alice@example.com | 台北 | 滑鼠 | 890 |
| 106 | Bob | bob@example.com | 台中 | 滑鼠,鍵盤 | 3290 |

用了半年之後陸續出現這些狀況：

- Alice 改了 email，客服只更新了最新那一筆。現在 Alice 有兩個 email，寄出貨通知要用哪個沒人知道（**更新異常**）。
- 想先上架一個新商品「螢幕」，但這張表一列就是一張訂單，沒有訂單就沒地方放商品（**新增異常**）。
- Carol 唯一的訂單被刪了，她的姓名、email、城市跟著消失（**刪除異常**）。
- 要找「誰買過鍵盤」，只能寫 `products LIKE '%鍵盤%'`，連「鍵盤膜」也會被找到；「每個商品賣了幾件」根本算不出來。

這些問題的共同原因是：**同一件事實存了很多份，或是好幾件事實擠在同一格**。正規化就是把它們拆開，讓每件事實只存在一個地方。

## 正規化：一步一步拆

正規形式（1NF、2NF、3NF）的正式定義是用「函數相依」寫的，這裡直接用上面那張表一步步拆，每一步只問一個問題。

### 第一步（1NF）：一格只放一個值

`products` 欄位放了「滑鼠,鍵盤」，一格裡有兩個值。資料庫看不懂逗號，所以沒辦法對它 JOIN、加總、建外鍵。拆法是**一個品項一列**：

| order_id | product | qty |
|---|---|---|
| 106 | 滑鼠 | 1 |
| 106 | 鍵盤 | 1 |

同樣不符合 1NF 的還有「重複欄位」：`phone1`、`phone2`、`phone3`。第四支電話要加欄位、查「這支電話是誰的」要查三個欄位。改成一張 `user_phones(user_id, phone)`。

> PostgreSQL 有陣列與 JSONB 型別，一格放多個值在技術上可行。判斷標準是：需不需要對裡面的元素做 JOIN、加約束、單獨更新。需要的話就該拆成表；只是整包存取（例如一份設定、一組標籤只拿來顯示）才適合放陣列或 JSONB。

### 第二步（2NF）：每個欄位都要依賴「整個」主鍵

拆完之後，品項表的主鍵是 `(order_id, product_id)`。如果這張表還放了 `product_name`、`customer_email`：

- `product_name` 只由 `product_id` 決定，跟 `order_id` 無關。
- `customer_email` 只由 `order_id`（進而由客戶）決定，跟 `product_id` 無關。

只依賴主鍵一部分的欄位，每出現一次就重複一次。「鍵盤」這個名字在每張買了鍵盤的訂單裡都存一遍，改名時就要改很多列。把它們搬到各自的表：商品名稱放 `products`，訂單資訊放 `orders`。

### 第三步（3NF）：欄位不能透過別的欄位間接依賴主鍵

`orders(id, user_id, customer_email, customer_city, …)`：`customer_email` 不是由訂單決定的，而是由 `user_id` 決定（id → user_id → email）。這叫**遞移相依**。結果就是開頭的更新異常：同一位使用者的 email 分散在他每一張訂單上。

拆法：`orders` 只留 `user_id`，email、城市回到 `users`。需要時 JOIN。

拆完就是範例資料庫的樣子：

```text
users(id PK, name, email UNIQUE, city, created_at)
   │ 1
   │
   │ N
orders(id PK, user_id → users.id, status, amount, created_at)
   │ 1
   │
   │ N
order_items(order_id → orders.id, product_id → products.id, qty)   PK = (order_id, product_id)
                                       │ N
                                       │
                                       │ 1
                                  products(id PK, name, price, stock)
```

每件事實只有一個家：email 在 users、商品名稱與目前售價在 products、這張訂單買了什麼在 order_items。

```sql run
-- 原本的「大表」可以隨時用 JOIN 組回來，不需要真的存成那樣
SELECT o.id AS order_id, u.name AS customer_name, u.email AS customer_email, u.city AS customer_city,
       string_agg(p.name, ',' ORDER BY p.name) AS products,
       o.amount AS total
FROM orders o
JOIN users u        ON u.id = o.user_id
JOIN order_items oi ON oi.order_id = o.id
JOIN products p     ON p.id = oi.product_id
GROUP BY o.id, u.id
ORDER BY o.id;

-- Alice 改 email：只改一列，所有訂單看到的都是新的
UPDATE users SET email = 'alice.new@example.com' WHERE id = 1;
SELECT o.id, u.email FROM orders o JOIN users u ON u.id = o.user_id WHERE u.id = 1;
```

## 關係的三種形狀

| 關係 | 例子 | 怎麼建 |
|---|---|---|
| 一對多 | 一位使用者有多張訂單 | 外鍵放在「多」的那一邊：`orders.user_id REFERENCES users(id)` |
| 多對多 | 一張訂單有多個商品，一個商品出現在多張訂單 | 中介表 `order_items(order_id, product_id)`，複合主鍵防止同一對出現兩次 |
| 一對一 | 一位使用者最多一份詳細資料 | 子表的主鍵同時是外鍵：`user_profiles(user_id PRIMARY KEY REFERENCES users(id))` |

多對多的中介表常常不只是「連線」，它本身就是一件事實，會有自己的欄位：`order_items` 的 `qty`、`user_roles` 的 `granted_at` 與 `granted_by`。

一對一拆表要有理由（欄位很大、很少用到、權限不同），否則放同一張表比較簡單。

```sql run
-- 多對多：商品與標籤
CREATE TABLE tags (
  id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE product_tags (
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,  -- 商品刪了，它的標籤關聯也刪
  tag_id     BIGINT NOT NULL REFERENCES tags(id)     ON DELETE CASCADE,
  PRIMARY KEY (product_id, tag_id)                    -- 同一個商品不會被貼兩次同一個標籤
);
-- 複合主鍵的索引是 (product_id, tag_id)，只能服務「某商品有哪些標籤」；反方向的查詢需要另一個索引
CREATE INDEX ON product_tags (tag_id);

INSERT INTO tags (name) VALUES ('周邊'), ('辦公'), ('電競');
INSERT INTO product_tags (product_id, tag_id) VALUES (1, 1), (1, 3), (2, 1), (2, 3), (5, 2);

-- 「電競」標籤下有哪些商品
SELECT p.name FROM products p
JOIN product_tags pt ON pt.product_id = p.id
JOIN tags t          ON t.id = pt.tag_id
WHERE t.name = '電競'
ORDER BY p.id;
```

## 主鍵怎麼選

主鍵要滿足三件事：唯一、不是 NULL、**不會變**。第三點最常被忽略。

- **自然鍵**（業務上本來就唯一的值）：email、身分證字號、商品條碼。它們看起來唯一，但會變（換 email）、會有例外（外籍人士沒有身分證字號）、可能是個資。一旦當成主鍵，所有外鍵都存了一份，改起來牽動所有關聯表。
- **代理鍵**（沒有業務意義的編號）：自增整數或 UUID。不會變，外鍵也小。自然鍵仍然用 `UNIQUE` 約束保證唯一。

多數表用代理鍵當主鍵、自然鍵加 UNIQUE。中介表是例外，直接用兩個外鍵組成的複合主鍵。

代理鍵的型別：

| 選擇 | 優點 | 注意 |
|---|---|---|
| `BIGINT GENERATED ALWAYS AS IDENTITY` | 小（8 bytes）、有順序，B-tree 插入都在最右邊 | 編號連續，放在網址上會洩漏數量與成長速度；序號遇到 rollback 會跳號，不能當「沒有缺號」的流水號 |
| `UUID`（v4，`gen_random_uuid()`） | 不用問資料庫就能產生、不洩漏數量 | 16 bytes；完全隨機，插入散落在索引各處，大表的寫入與快取效率較差 |
| `UUID`（v7，PostgreSQL 18 起有 `uuidv7()`） | 前段是時間戳，大致依時間排序，兼顧上面兩者 | 從 id 可以讀出建立時間，敏感時要注意 |

`GENERATED ALWAYS` 會拒絕手動指定 id，比舊的 `SERIAL` 更不容易讓序號和資料不同步。`INTEGER`（上限約 21 億）對會長大的表不夠，直接用 `BIGINT`。

```sql run
-- PostgreSQL 18 內建 uuidv7()：前 48 bits 是 Unix 毫秒時間戳，所以大致依建立時間排序
SELECT uuidv7() AS v7, gen_random_uuid() AS v4;
SELECT uuid_extract_timestamp(uuidv7()) AS created_at_from_id;
```

## 外鍵與 ON DELETE

外鍵讓資料庫保證「指向的那一列存在」。範例資料庫的 `orders.user_id` 刻意**沒有**外鍵，結果就是 105 號訂單指向不存在的 9 號使用者，而且沒人擋。現在想補上外鍵時：

```sql
ALTER TABLE orders ADD FOREIGN KEY (user_id) REFERENCES users(id);
-- ERROR:  insert or update on table "orders" violates foreign key constraint "orders_user_id_fkey"
-- DETAIL:  Key (user_id)=(9) is not present in table "users".
```

既有的髒資料要先處理（補上使用者、改成 NULL、或刪掉），外鍵才加得上。大表上可以分兩步：先 `ADD CONSTRAINT … NOT VALID`（只檢查之後的寫入，不掃舊資料），清理完再 `VALIDATE CONSTRAINT`。

被參照的列要刪除時怎麼辦，由 `ON DELETE` 決定：

| 選項 | 刪除被參照的列時 | 適合 |
|---|---|---|
| `NO ACTION`（預設） | 還有參照就報錯；檢查可以用 `DEFERRABLE` 延到交易結束 | 大多數情況 |
| `RESTRICT` | 還有參照就報錯，而且立即檢查、不能延後 | 明確禁止刪除 |
| `CASCADE` | 參照它的列一起刪 | 子資料沒有獨立意義：訂單刪了，它的品項跟著刪 |
| `SET NULL` | 參照欄位改成 NULL | 關聯可以斷：負責的員工離職，工單保留但改成沒人負責 |
| `SET DEFAULT` | 參照欄位改成預設值 | 少用 |

`CASCADE` 要小心連鎖：users → orders → order_items 都設 CASCADE 時，刪一位使用者會把他所有訂單與品項一起刪掉，財務資料通常不該這樣消失。這類資料多半改用軟刪除（`deleted_at` 欄位），見設計情境 [軟刪除與稽核](#/scenario/soft-delete)。

```sql run
-- 一個小工具：執行一句 SQL，成功回 ok，失敗回「SQLSTATE 錯誤訊息」，讓錯誤也能顯示成結果
CREATE FUNCTION try_sql(stmt text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE stmt;
  RETURN 'ok';
EXCEPTION WHEN others THEN
  RETURN SQLSTATE || ' ' || SQLERRM;   -- 這一句的變更會被撤銷，其他照常
END $f$;

-- 範例的 order_items.product_id 外鍵沒寫 ON DELETE，所以是 NO ACTION：有人買過的商品刪不掉
SELECT try_sql($$DELETE FROM products WHERE id = 1$$) AS delete_product;

-- 把 order_items.order_id 的外鍵改成 CASCADE：刪訂單時品項一起刪
ALTER TABLE order_items DROP CONSTRAINT order_items_order_id_fkey;
ALTER TABLE order_items ADD CONSTRAINT order_items_order_id_fkey
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

DELETE FROM orders WHERE id = 106;
SELECT count(*) AS items_left_for_106 FROM order_items WHERE order_id = 106;   -- 0
```

PostgreSQL **不會**自動替外鍵欄位建索引（主鍵和 UNIQUE 會）。沒有索引時，刪除一位使用者要掃整張 orders 找參照，JOIN 也會慢。外鍵欄位通常都該有索引，見 [索引與查詢計畫](#/skill/indexes)。

## 用約束表達業務規則

應用程式的驗證只擋得住走那段程式的寫入；後台腳本、另一個服務、並行的兩個請求都可能繞過它。約束由資料庫在每次寫入時檢查，並行下也成立（兩個請求同時寫同一個 email，UNIQUE 只會讓一個成功）。

| 業務規則 | 約束 |
|---|---|
| 每位使用者都要有名字 | `name TEXT NOT NULL` |
| email 不能重複，大小寫不同也算重複 | `CREATE UNIQUE INDEX ON users (lower(email))` |
| 價格不能是負數 | `CHECK (price >= 0)` |
| 結束時間要晚於開始時間 | `CHECK (ends_at > starts_at)`（同一列的多個欄位） |
| 訂單狀態只能是幾種 | `CHECK (status IN ('pending','paid','shipped','cancelled'))` |
| 每位使用者最多一個預設地址 | 部分唯一索引 `UNIQUE (user_id) WHERE is_default` |
| 已出貨的訂單一定有出貨時間 | `CHECK (status <> 'shipped' OR shipped_at IS NOT NULL)` |

```sql run
CREATE FUNCTION try_sql(stmt text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN EXECUTE stmt; RETURN 'ok';
EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM;
END $f$;

CREATE TABLE addresses (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id),
  line       TEXT NOT NULL CHECK (length(line) BETWEEN 5 AND 200),
  is_default BOOLEAN NOT NULL DEFAULT false
);
-- 部分唯一索引：只對 is_default = true 的列要求 user_id 唯一
CREATE UNIQUE INDEX addresses_one_default ON addresses (user_id) WHERE is_default;

-- 已出貨必須有出貨時間：用具名約束，錯誤訊息裡會出現這個名字
ALTER TABLE orders ADD COLUMN shipped_at TIMESTAMPTZ;
UPDATE orders SET shipped_at = created_at + interval '1 day' WHERE status = 'shipped';
ALTER TABLE orders ADD CONSTRAINT orders_shipped_needs_time
  CHECK (status <> 'shipped' OR shipped_at IS NOT NULL);

SELECT * FROM (VALUES
  ('第一個預設地址', try_sql($$INSERT INTO addresses (user_id, line, is_default) VALUES (1, '台北市信義路一段 1 號', true)$$)),
  ('非預設地址可以很多個', try_sql($$INSERT INTO addresses (user_id, line) VALUES (1, '台北市仁愛路二段 2 號')$$)),
  ('第二個預設地址', try_sql($$INSERT INTO addresses (user_id, line, is_default) VALUES (1, '新北市板橋區 3 號', true)$$)),
  ('地址太短', try_sql($$INSERT INTO addresses (user_id, line) VALUES (2, '台中')$$)),
  ('不存在的使用者', try_sql($$INSERT INTO addresses (user_id, line) VALUES (99, '高雄市前鎮區 4 號')$$)),
  ('出貨但沒有時間', try_sql($$UPDATE orders SET status = 'shipped' WHERE id = 101$$)),
  ('拼錯的狀態', try_sql($$UPDATE orders SET status = 'shiped' WHERE id = 101$$))
) AS t(attempt, result);
```

約束取名（`orders_shipped_needs_time`）有實際用處：違反時錯誤訊息會帶這個名字，應用程式可以依名字轉成對使用者的訊息，看 log 的人也一眼知道是哪條規則。

約束表達不了的規則也要知道：

- **跨列、跨表的彙總**：「訂單 amount 必須等於品項小計加總」、「一個人最多 3 張未付款訂單」。CHECK 只看得到同一列。可以用 trigger、在交易裡由應用程式檢查並鎖住相關列，或定期對帳找出不一致。
- **時間區間不重疊**（同一間會議室的預約）：PostgreSQL 有 exclusion constraint（`EXCLUDE USING gist`），但「同一間會議室」這種純量欄位的相等比較需要 `btree_gist` 擴充；本站的 PGlite 沒有附這個擴充，所以這裡不示範。

## 何時刻意反正規化

正規化讓寫入正確，但讀取時要 JOIN。有些情況會刻意多存一份，前提是**知道哪一份是真相、誰負責同步**。

**快照不是反正規化。**範例的 `products.price` 是「目前售價」，但訂單成立時的價格是另一件事實：商品之後漲價，舊訂單的金額不能跟著變。所以 `order_items` 應該存 `unit_price`（成交價），`order_items` 也常存一份 `product_name`（商品之後改名，發票上的品名不能變）。它們看起來跟 products 重複，其實記錄的是不同時間點的值。

```sql run
-- 範例的 order_items 沒有成交價，只能拿「目前售價」去推算訂單金額
SELECT o.id, o.amount AS stored_amount,
       sum(p.price * oi.qty) AS recomputed_from_current_price
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN products p     ON p.id = oi.product_id
GROUP BY o.id ORDER BY o.id;

-- 鍵盤漲價之後，推算出來的金額就跟訂單對不上了
UPDATE products SET price = 2600 WHERE id = 1;
SELECT o.id, o.amount AS stored_amount,
       sum(p.price * oi.qty) AS recomputed_from_current_price
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN products p     ON p.id = oi.product_id
GROUP BY o.id ORDER BY o.id;

-- 修正的 schema：成交當下的單價存進品項
ALTER TABLE order_items ADD COLUMN unit_price NUMERIC(10,2);
```

**真正的反正規化**是存一份可以從別處算出來的值：

| 做法 | 例子 | 代價 |
|---|---|---|
| 彙總欄位 | `orders.amount`（可以從品項算出）、`products.review_count` | 每次寫入品項都要同步更新；漏了就不一致 |
| 冗餘欄位 | 在 orders 存 `user_city` 讓報表免 JOIN | 使用者搬家時要決定舊訂單改不改（這其實又變成快照的問題） |
| 物化視圖 | `CREATE MATERIALIZED VIEW daily_sales AS …` | 不會自動更新，要排程 `REFRESH MATERIALIZED VIEW` |

判斷順序：先正規化 → 加索引、改寫查詢 → 量測後仍然不夠快，才反正規化。反正規化的欄位要寫清楚來源，最好有一個對帳查詢（像上面那段）能定期找出不一致。

## 常見錯誤與錯誤訊息

| 錯誤訊息（PostgreSQL） | SQLSTATE | 原因 | 怎麼處理 |
|---|---|---|---|
| `insert or update on table "orders" violates foreign key constraint "orders_user_id_fkey"` | `23503` | 寫入的外鍵值不存在；DETAIL 會寫 `Key (user_id)=(9) is not present in table "users".` | 確認參照的列先建立；加外鍵前先清理孤兒資料 |
| `update or delete on table "products" violates foreign key constraint "order_items_product_id_fkey" on table "order_items"` | `23503` | 刪除還被參照的列（NO ACTION） | 決定業務上該怎麼辦：禁止、連帶刪除、改成軟刪除 |
| `duplicate key value violates unique constraint "users_email_key"` | `23505` | 違反 UNIQUE；DETAIL 寫出重複的值 | 回傳「已存在」，或用 `INSERT … ON CONFLICT` |
| `null value in column "name" of relation "users" violates not-null constraint` | `23502` | 必填欄位沒給值 | 應用程式補值，或檢查是否該有 DEFAULT |
| `new row for relation "products" violates check constraint "products_price_check"` | `23514` | 違反 CHECK；沒取名時名稱是自動產生的 `表_欄位_check` | 替約束取有意義的名字，應用程式依名字對應訊息 |
| `cannot insert a non-DEFAULT value into column "id"` | `428C9` | 對 `GENERATED ALWAYS` 的欄位手動給值 | 不要給 id；匯入資料時才用 `OVERRIDING SYSTEM VALUE` |
| `cannot drop table products because other objects depend on it` | `2BP01` | 有外鍵指向這張表 | HINT 建議 `DROP … CASCADE`，但它會把相依的外鍵約束一起刪掉，先確認 |

SQLSTATE 的前兩碼 `23` 都是「完整性約束違反」。應用程式可以據此把這類錯誤轉成 4xx（使用者送的資料有問題），而不是 500。

## 動手

1. 「用約束表達業務規則」那段按「在 Playground 開啟」，替 addresses 加一條 `CHECK`：`line` 不能包含「測試」兩個字（提示：`position('測試' in line) = 0`），再加一列測試看看。
2. 在外鍵那段把 CASCADE 改成 `ON DELETE SET NULL` 再跑：加外鍵本身會成功，到 `DELETE` 才報 `null value in column "order_id" of relation "order_items" violates not-null constraint`。從訊息推論原因（order_items.order_id 有 NOT NULL，又是主鍵的一部分），想想 SET NULL 適合哪種欄位。
3. 把開頭那張大表的需求，加上「優惠券（一張訂單最多用一張，一張券可以被很多張訂單用）」，自己畫出要加哪些表和外鍵。
4. 程式題：[多對多的中介表](#/exercise/data-modeling-1)。
5. 接著看 [Schema 設計實戰：從需求到資料表](#/skill/schema-design-practice)，用一段完整的需求從頭走一次建模與 migration。

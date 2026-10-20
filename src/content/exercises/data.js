// 程式題：資料儲存（SQL 在瀏覽器裡的 PostgreSQL 執行；資料見 schemas.js 的電商範例）
import { SHOP_SCHEMA } from '../schemas.js'

const S = SHOP_SCHEMA

export default [
  {
    id: 'sql-basics-1', skill: 'sql-basics', kind: 'sql', level: 1,
    title: '每個城市的訂單數與總金額',
    prompt: '列出每個城市（users.city）的訂單數與訂單總金額，只列出訂單數**超過 1 筆**的城市。欄位名稱要是 `city`、`orders`、`total`。\n\n提示：JOIN → GROUP BY → HAVING 的順序。',
    setup: S, setupKey: 'shop',
    starter: `SELECT u.city, COUNT(o.id) AS orders, SUM(o.amount) AS total
FROM users u
JOIN orders o ON o.user_id = u.id
-- TODO: 依城市分組，只留超過 1 筆的
;`,
    solution: `SELECT u.city, COUNT(o.id) AS orders, SUM(o.amount) AS total
FROM users u
JOIN orders o ON o.user_id = u.id
GROUP BY u.city
HAVING COUNT(o.id) > 1;`,
    expect: { columns: ['city', 'orders', 'total'], rows: [['台北', '2', '3290'], ['台中', '2', '11280']], ordered: false },
    hints: ['聚合函數（COUNT、SUM）要搭配 GROUP BY。', '對「分組後的結果」過濾要用 HAVING，不是 WHERE（WHERE 在分組之前執行）。'],
  },
  {
    id: 'sql-basics-2', skill: 'sql-basics', kind: 'sql', level: 1,
    title: '金額最高的三筆訂單',
    prompt: '列出金額最高的 3 筆訂單的 `id` 與 `amount`，由高到低排序。',
    setup: S, setupKey: 'shop',
    starter: `SELECT id, amount
FROM orders
-- TODO: 排序與限制筆數
;`,
    solution: `SELECT id, amount
FROM orders
ORDER BY amount DESC
LIMIT 3;`,
    expect: { columns: ['id', 'amount'], rows: [['105', '12000'], ['103', '7990'], ['106', '3290']], ordered: true },
    hints: ['ORDER BY 欄位 DESC 是由大到小。', 'LIMIT 放在最後。'],
  },
  {
    id: 'sql-basics-3', skill: 'sql-basics', kind: 'sql', level: 1,
    title: '各狀態的訂單數',
    prompt: '統計每種 `status` 有幾筆訂單，欄位名 `status`、`n`。依數量由多到少排序，數量相同時依 status 字母順序排序。',
    setup: S, setupKey: 'shop',
    starter: `SELECT status, COUNT(*) AS n
FROM orders
-- TODO
;`,
    solution: `SELECT status, COUNT(*) AS n
FROM orders
GROUP BY status
ORDER BY n DESC, status;`,
    expect: { columns: ['status', 'n'], rows: [['paid', '3'], ['cancelled', '1'], ['pending', '1'], ['shipped', '1']], ordered: true },
    hints: ['ORDER BY 可以放多個欄位，用逗號隔開，前面的優先。', 'ORDER BY 可以直接用 SELECT 裡的別名 n。'],
  },
  {
    id: 'sql-joins-1', skill: 'sql-joins', kind: 'sql', level: 1,
    title: '從未下單的使用者',
    prompt: '找出**從未下過任何訂單**的使用者名字（欄位 `name`）。這是經典的 anti-join。',
    setup: S, setupKey: 'shop',
    starter: `SELECT u.name
FROM users u
-- TODO: 用 LEFT JOIN + IS NULL，或 NOT EXISTS
;`,
    solution: `SELECT u.name
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE o.id IS NULL;`,
    expect: { columns: ['name'], rows: [['Dave'], ['Eve']], ordered: false },
    hints: ['LEFT JOIN 會保留所有使用者；沒有訂單的人，右表欄位會是 NULL。', 'WHERE o.id IS NULL 就是「右邊沒配到」。另一種寫法：WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id)。'],
  },
  {
    id: 'sql-joins-2', skill: 'sql-joins', kind: 'sql', level: 1,
    title: '每個使用者的訂單數（含 0 筆）',
    prompt: '列出每個使用者的 `name` 與訂單數 `orders`，沒有訂單的人也要出現、數量顯示 0。\n\n小心：`COUNT(*)` 會把「配到 NULL 的那一列」也算成 1。',
    setup: S, setupKey: 'shop',
    starter: `SELECT u.name, COUNT(*) AS orders
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
GROUP BY u.id, u.name;`,
    solution: `SELECT u.name, COUNT(o.id) AS orders
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
GROUP BY u.id, u.name;`,
    expect: { columns: ['name', 'orders'], rows: [['Alice', '2'], ['Bob', '2'], ['Carol', '1'], ['Dave', '0'], ['Eve', '0']], ordered: false },
    hints: ['執行一次看看 Dave 的數字——是 1 還是 0？', 'COUNT(欄位) 不會計算 NULL；COUNT(*) 計算所有列。'],
  },
  {
    id: 'sql-joins-3', skill: 'sql-joins', kind: 'sql', level: 2,
    title: '找出孤兒訂單',
    prompt: '有些訂單的 `user_id` 指向不存在的使用者（資料修復常見）。列出這些訂單的 `id`。',
    setup: S, setupKey: 'shop',
    starter: `SELECT o.id
FROM orders o
-- TODO
;`,
    solution: `SELECT o.id
FROM orders o
LEFT JOIN users u ON u.id = o.user_id
WHERE u.id IS NULL;`,
    expect: { columns: ['id'], rows: [['105']], ordered: false },
    hints: ['以 orders 為主表 LEFT JOIN users，配不到的就是孤兒。', '如果表有正確的外鍵約束，這種資料根本進不來——這正是 FOREIGN KEY 的價值。'],
  },
  {
    id: 'sql-joins-4', skill: 'sql-joins', kind: 'sql', level: 2,
    title: '條件放 ON 還是 WHERE',
    prompt: '列出每個使用者的 `name` 與**已付款（status = \'paid\'）**的訂單數 `paid_orders`，沒有的顯示 0，所有使用者都要出現。\n\n把 `status = \'paid\'` 放在 WHERE 會發生什麼事？試試看再改。',
    setup: S, setupKey: 'shop',
    starter: `SELECT u.name, COUNT(o.id) AS paid_orders
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE o.status = 'paid'
GROUP BY u.id, u.name;`,
    solution: `SELECT u.name, COUNT(o.id) AS paid_orders
FROM users u
LEFT JOIN orders o ON o.user_id = u.id AND o.status = 'paid'
GROUP BY u.id, u.name;`,
    expect: { columns: ['name', 'paid_orders'], rows: [['Alice', '1'], ['Bob', '2'], ['Carol', '0'], ['Dave', '0'], ['Eve', '0']], ordered: false },
    hints: ['WHERE 在 JOIN 之後過濾：右邊是 NULL 的列會被 o.status = \'paid\' 濾掉，LEFT JOIN 就退化成 INNER JOIN。', '對右表的過濾條件放在 ON 子句，才保得住左表的每一列。'],
  },
  {
    id: 'indexes-1', skill: 'indexes', kind: 'sql', level: 1,
    title: '幫外鍵欄位建索引',
    prompt: 'PostgreSQL 不會自動幫外鍵建索引。替 `orders.user_id` 建立一個 B-tree 索引，名稱必須是 `idx_orders_user_id`。\n\n建好後可以按「查詢計畫」比較 `SELECT * FROM orders WHERE user_id = 2` 前後的差別（資料太少時規劃器仍可能選 Seq Scan，這是正常的）。',
    setup: S, setupKey: 'shop',
    starter: `-- TODO: CREATE INDEX ...
`,
    solution: `CREATE INDEX idx_orders_user_id ON orders (user_id);`,
    expect: { query: `SELECT indexname FROM pg_indexes WHERE tablename = 'orders' AND indexname = 'idx_orders_user_id'`, columns: ['indexname'], rows: [['idx_orders_user_id']], ordered: false },
    hints: ['語法：CREATE INDEX 索引名 ON 表名 (欄位);', '索引名稱要完全一致：idx_orders_user_id。'],
  },
  {
    id: 'indexes-2', skill: 'indexes', kind: 'sql', level: 2,
    title: '複合索引的欄位順序',
    prompt: '這兩個查詢都很常跑：\n\n`SELECT * FROM orders WHERE user_id = ?`\n`SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC`\n\n建**一個**複合索引同時服務兩者（最左前綴原則）。名稱自訂。',
    setup: S, setupKey: 'shop',
    starter: `-- TODO: 一個索引、兩個欄位，順序是關鍵
`,
    solution: `CREATE INDEX idx_orders_user_created ON orders (user_id, created_at);`,
    expect: { query: `SELECT count(*) AS n FROM pg_indexes WHERE tablename = 'orders' AND indexdef LIKE '%(user_id, created_at%'`, columns: ['n'], rows: [['1']], ordered: false },
    hints: ['等值條件的欄位放前面、排序的欄位放後面：(user_id, created_at)。', '反過來 (created_at, user_id) 無法單獨服務 WHERE user_id = ?。'],
  },
  {
    id: 'transactions-1', skill: 'transactions', kind: 'sql', level: 2,
    title: '原子扣庫存：不能超賣',
    prompt: '商品 3（螢幕）庫存 3。寫**一句** UPDATE 扣 1 個庫存，但只有在庫存大於 0 時才扣，並用 `RETURNING stock` 回傳扣完後的庫存。\n\n這一句是原子的：兩個請求同時來，資料庫會排隊執行，不會扣成負的。',
    setup: S, setupKey: 'shop',
    starter: `UPDATE products
SET stock = stock - 1
WHERE id = 3
-- TODO: 加上庫存條件與 RETURNING
;`,
    solution: `UPDATE products
SET stock = stock - 1
WHERE id = 3 AND stock > 0
RETURNING stock;`,
    expect: { columns: ['stock'], rows: [['2']], ordered: false },
    hints: ['WHERE 裡加上 AND stock > 0，庫存不足時這句就影響 0 列，應用層看影響列數判斷「沒扣到」。', 'RETURNING 可以在 UPDATE 後直接拿回新值，不用再 SELECT 一次。'],
  },
  {
    id: 'transactions-2', skill: 'transactions', kind: 'sql', level: 2,
    title: '訂單與明細要一起成功',
    prompt: '在一個交易裡建立訂單 `107`（user_id 3、status \'paid\'、amount 4180、created_at now()）與兩筆明細：商品 1 數量 1、商品 2 數量 2。最後要 **COMMIT**。\n\n驗收會檢查 orders 有 107 且 order_items 有 2 筆。忘記 COMMIT 的話，交易會被收掉、什麼都不會留下。',
    setup: S, setupKey: 'shop',
    starter: `BEGIN;
-- TODO: INSERT 訂單
-- TODO: INSERT 兩筆明細
-- TODO: 結束交易
`,
    solution: `BEGIN;
INSERT INTO orders (id, user_id, status, amount, created_at) VALUES (107, 3, 'paid', 4180, now());
INSERT INTO order_items (order_id, product_id, qty) VALUES (107, 1, 1), (107, 2, 2);
COMMIT;`,
    expect: { query: `SELECT (SELECT count(*) FROM orders WHERE id = 107) AS orders_107, (SELECT count(*) FROM order_items WHERE order_id = 107) AS items_107`, columns: ['orders_107', 'items_107'], rows: [['1', '2']], ordered: false },
    hints: ['order_items 有外鍵指向 orders，所以訂單要先 INSERT。', 'BEGIN … COMMIT 之間任何一句失敗，整個交易都會被中止；成功則要 COMMIT 才會真的寫入。'],
  },
  {
    id: 'sql-advanced-1', skill: 'sql-advanced', kind: 'sql', level: 3,
    title: '每個使用者最新的一筆訂單',
    prompt: '列出每個有訂單的使用者的 `name` 與他最新一筆訂單的 `order_id`（依 created_at）。用視窗函數 ROW_NUMBER() 解。',
    setup: S, setupKey: 'shop',
    starter: `SELECT name, order_id
FROM (
  SELECT u.name, o.id AS order_id,
         -- TODO: ROW_NUMBER() OVER (...) AS rn
  FROM users u
  JOIN orders o ON o.user_id = u.id
) t
-- TODO: WHERE rn = 1
;`,
    solution: `SELECT name, order_id
FROM (
  SELECT u.name, o.id AS order_id,
         ROW_NUMBER() OVER (PARTITION BY u.id ORDER BY o.created_at DESC) AS rn
  FROM users u
  JOIN orders o ON o.user_id = u.id
) t
WHERE rn = 1;`,
    expect: { columns: ['name', 'order_id'], rows: [['Alice', '102'], ['Bob', '106'], ['Carol', '104']], ordered: false },
    hints: ['PARTITION BY u.id 讓每個使用者各自從 1 開始編號。', 'ORDER BY o.created_at DESC 讓最新的那筆拿到 1。視窗函數不能直接放在 WHERE，所以要包一層子查詢。'],
  },
  {
    id: 'sql-advanced-2', skill: 'sql-advanced', kind: 'sql', level: 3,
    title: '用 CTE 找消費高於平均的人',
    prompt: '用 `WITH` 先算出每個有訂單的使用者的消費總額，再列出總額**高於所有人平均**的使用者 `name`。',
    setup: S, setupKey: 'shop',
    starter: `WITH totals AS (
  -- TODO: 每個使用者的 name 與 total
)
SELECT name
FROM totals
-- TODO: WHERE total > (平均)
;`,
    solution: `WITH totals AS (
  SELECT u.id, u.name, SUM(o.amount) AS total
  FROM users u
  JOIN orders o ON o.user_id = u.id
  GROUP BY u.id, u.name
)
SELECT name
FROM totals
WHERE total > (SELECT AVG(total) FROM totals);`,
    expect: { columns: ['name'], rows: [['Bob']], ordered: false },
    hints: ['CTE 可以在後面的查詢裡被引用多次，包括子查詢裡。', '平均：(SELECT AVG(total) FROM totals)。'],
  },
  {
    id: 'data-modeling-1', skill: 'data-modeling', kind: 'sql', level: 2,
    title: '多對多的中介表',
    prompt: '使用者與角色是多對多。建立 `user_roles` 表：欄位 `user_id`、`role_id`，兩者組成**複合主鍵**，並各自設外鍵指向 `users(id)` 與 `roles(id)`。\n\n驗收會檢查這張表有 1 個主鍵與 2 個外鍵約束。',
    setup: S + `\nCREATE TABLE roles (id BIGINT PRIMARY KEY, name TEXT NOT NULL UNIQUE);\nINSERT INTO roles VALUES (1, 'admin'), (2, 'editor');\n`, setupKey: 'shop-roles',
    starter: `CREATE TABLE user_roles (
  -- TODO
);`,
    solution: `CREATE TABLE user_roles (
  user_id BIGINT NOT NULL REFERENCES users(id),
  role_id BIGINT NOT NULL REFERENCES roles(id),
  PRIMARY KEY (user_id, role_id)
);`,
    expect: { query: `SELECT contype FROM pg_constraint WHERE conrelid = 'user_roles'::regclass AND contype IN ('p', 'f') ORDER BY contype`, columns: ['contype'], rows: [['f'], ['f'], ['p']], ordered: true },
    hints: ['複合主鍵寫法：PRIMARY KEY (user_id, role_id)。', '外鍵可以寫在欄位後面：user_id BIGINT REFERENCES users(id)。'],
  },
  {
    id: 'orm-migrations-1', skill: 'orm-migrations', kind: 'python', level: 2,
    title: '把 N+1 改成 2 次查詢',
    prompt: '`posts_with_authors` 對每篇文章都查一次作者：10 篇文章就是 11 次查詢。改成**最多 2 次**查詢：先取全部文章，再用一次 `WHERE id IN (...)` 取所有作者，在 Python 裡用 dict 對應。回傳格式與順序不變。\n\n`FakeDB` 支援的查詢：`SELECT * FROM posts`、`SELECT id, name FROM users WHERE id = %s`（params=(id,)）、`SELECT id, name FROM users WHERE id IN %s`（params=(ids 的 list 或 tuple,)）。',
    starter: `class FakeDB:
    def __init__(self):
        self.calls = []
        self.posts = [{"id": i, "title": f"post {i}", "author_id": i % 3 + 1} for i in range(1, 11)]
        self.users = {1: "Alice", 2: "Bob", 3: "Carol"}

    def query(self, sql, params=()):
        self.calls.append(sql)
        if sql.startswith("SELECT * FROM posts"):
            return list(self.posts)
        if sql.startswith("SELECT id, name FROM users WHERE id = "):
            uid = params[0]
            return [{"id": uid, "name": self.users[uid]}]
        if sql.startswith("SELECT id, name FROM users WHERE id IN"):
            return [{"id": u, "name": self.users[u]} for u in params[0]]
        raise ValueError("unknown query: " + sql)


def posts_with_authors(db):
    posts = db.query("SELECT * FROM posts")
    result = []
    for p in posts:
        author = db.query("SELECT id, name FROM users WHERE id = %s", (p["author_id"],))[0]
        result.append({"title": p["title"], "author": author["name"]})
    return result


db = FakeDB()
print(posts_with_authors(db)[:3])
print("查詢次數：", len(db.calls))
`,
    solution: `class FakeDB:
    def __init__(self):
        self.calls = []
        self.posts = [{"id": i, "title": f"post {i}", "author_id": i % 3 + 1} for i in range(1, 11)]
        self.users = {1: "Alice", 2: "Bob", 3: "Carol"}

    def query(self, sql, params=()):
        self.calls.append(sql)
        if sql.startswith("SELECT * FROM posts"):
            return list(self.posts)
        if sql.startswith("SELECT id, name FROM users WHERE id = "):
            uid = params[0]
            return [{"id": uid, "name": self.users[uid]}]
        if sql.startswith("SELECT id, name FROM users WHERE id IN"):
            return [{"id": u, "name": self.users[u]} for u in params[0]]
        raise ValueError("unknown query: " + sql)


def posts_with_authors(db):
    posts = db.query("SELECT * FROM posts")
    ids = sorted({p["author_id"] for p in posts})
    users = db.query("SELECT id, name FROM users WHERE id IN %s", (ids,))
    name_by_id = {u["id"]: u["name"] for u in users}
    return [{"title": p["title"], "author": name_by_id[p["author_id"]]} for p in posts]


db = FakeDB()
print(posts_with_authors(db)[:3])
print("查詢次數：", len(db.calls))
`,
    tests: [
      { name: '結果內容與順序正確', code: `_db = FakeDB()\n_r = posts_with_authors(_db)\nassert len(_r) == 10, f"應有 10 筆，得到 {len(_r)}"\nassert _r[0] == {"title": "post 1", "author": "Bob"}, _r[0]\nassert _r[2] == {"title": "post 3", "author": "Alice"}, _r[2]` },
      { name: '查詢次數不超過 2 次', code: `_db = FakeDB()\nposts_with_authors(_db)\nassert len(_db.calls) <= 2, f"打了 {len(_db.calls)} 次查詢——還是 N+1"` },
    ],
    hints: ['先收集所有 author_id（去重），一次查回所有作者。', '把作者 list 轉成 {id: name} 的 dict，之後用 dict 查是 O(1)。'],
  },
  {
    id: 'db-operations-1', skill: 'db-operations', kind: 'sql', level: 2,
    title: '從 pg_stat_statements 找最該優化的查詢',
    prompt: '`pg_stat_statements` 擴充會把每種查詢（參數換成 `$1`）的呼叫次數與累計耗時記下來。這裡用一張欄位相同的表 `stat_statements` 代替（瀏覽器裡的 PostgreSQL 沒有這個擴充）。\n\n列出**累計耗時最高**的 3 種查詢，欄位：`query`、`calls`、`total_ms`（= `total_exec_time`）、`mean_ms`（平均每次毫秒數，四捨五入到小數 1 位），依 `total_ms` 由高到低。\n\n起始碼依平均耗時排序：平均很慢、但一天只跑幾十次的報表，對整體負載的影響可能遠小於每次 3 毫秒、一天跑十幾萬次的查詢。',
    setup: `CREATE TABLE stat_statements (
  queryid         bigint PRIMARY KEY,
  query           text    NOT NULL,
  calls           bigint  NOT NULL,
  total_exec_time numeric NOT NULL,  -- 毫秒，累計
  rows            bigint  NOT NULL
);
INSERT INTO stat_statements VALUES
  (1, 'SELECT * FROM orders WHERE user_id = $1',                 120000, 360000, 480000),
  (2, 'SELECT id, name FROM products WHERE name ILIKE $1',         9000, 270000,  45000),
  (3, 'UPDATE products SET stock = stock - $1 WHERE id = $2',     50000,  50000,  50000),
  (4, 'SELECT date_trunc($1, created_at), sum(amount) FROM orders GROUP BY 1', 30, 54000, 360),
  (5, 'DELETE FROM sessions WHERE expires_at < now()',               24,   9600, 120000),
  (6, 'INSERT INTO orders (user_id, status, amount) VALUES ($1, $2, $3)', 40000, 80000, 40000);
`,
    setupKey: 'stat-statements',
    starter: `SELECT query, calls,
       total_exec_time AS total_ms,
       round(total_exec_time / calls, 1) AS mean_ms
FROM stat_statements
ORDER BY mean_ms DESC
LIMIT 3;`,
    solution: `SELECT query, calls,
       total_exec_time AS total_ms,
       round(total_exec_time / calls, 1) AS mean_ms
FROM stat_statements
ORDER BY total_exec_time DESC
LIMIT 3;`,
    expect: { columns: ['query', 'calls', 'total_ms', 'mean_ms'], rows: [['SELECT * FROM orders WHERE user_id = $1', '120000', '360000', '3'], ['SELECT id, name FROM products WHERE name ILIKE $1', '9000', '270000', '30'], ['INSERT INTO orders (user_id, status, amount) VALUES ($1, $2, $3)', '40000', '80000', '2']], ordered: true },
    hints: ['優化的優先順序看的是「總共花掉多少資料庫時間」，也就是 total_exec_time，不是單次多慢。', '真的 pg_stat_statements 已經有 mean_exec_time 欄位；這裡自己算是為了看清楚兩者的關係。'],
  },
  {
    id: 'mongodb-1', skill: 'mongodb', kind: 'python', level: 1,
    title: '文件查詢的比對規則：巢狀欄位與陣列',
    prompt: 'MongoDB 的 filter 跟 SQL 的 `WHERE col = x` 有兩個重要差別，這題用 Python 在 dict 上重現：\n\n1. **dot notation**：`{"author.name": "Alice"}` 比對巢狀文件裡的欄位；路徑上遇到陣列時，對每個元素繼續往下找（`"comments.author"` 會找遍每則留言）\n2. **陣列語意**：欄位是陣列時，只要**任一元素**符合就算符合，所以 `{"tags": "db"}` 會找到 `tags` 含有 `"db"` 的文件\n\n實作 `get_values(doc, path)` 與 `matches(doc, flt)`，並支援兩個運算子：`{"$gt": 數字}`、`{"$in": [值, ...]}`。路徑不存在就是不符合。',
    starter: `POSTS = [
    {"_id": 1, "title": "MongoDB 入門", "tags": ["db", "nosql"], "author": {"name": "Alice", "level": 3},
     "comments": [{"author": "Bob", "likes": 2}, {"author": "Carol", "likes": 5}]},
    {"_id": 2, "title": "PostgreSQL 交易", "tags": ["db", "sql"], "author": {"name": "Bob", "level": 1},
     "comments": []},
    {"_id": 3, "title": "Redis 快取", "tags": ["cache"], "author": {"name": "Alice", "level": 3},
     "comments": [{"author": "Dave", "likes": 0}]},
]


def get_values(doc, path):
    """依 "a.b.c" 取值。路徑上遇到陣列時，對陣列的每個元素繼續往下走，回傳所有取到的值。"""
    # TODO
    return [doc.get(path)] if path in doc else []


def matches(doc, flt):
    """flt 例：{"author.name": "Alice", "tags": "db", "comments.likes": {"$gt": 3}}"""
    for path, cond in flt.items():
        values = get_values(doc, path)
        # TODO：陣列欄位要「任一元素符合」；支援 {"$gt": x} / {"$in": [...]}
        if not any(v == cond for v in values):
            return False
    return True


print([d["_id"] for d in POSTS if matches(d, {"tags": "db"})])
`,
    solution: `POSTS = [
    {"_id": 1, "title": "MongoDB 入門", "tags": ["db", "nosql"], "author": {"name": "Alice", "level": 3},
     "comments": [{"author": "Bob", "likes": 2}, {"author": "Carol", "likes": 5}]},
    {"_id": 2, "title": "PostgreSQL 交易", "tags": ["db", "sql"], "author": {"name": "Bob", "level": 1},
     "comments": []},
    {"_id": 3, "title": "Redis 快取", "tags": ["cache"], "author": {"name": "Alice", "level": 3},
     "comments": [{"author": "Dave", "likes": 0}]},
]


def get_values(doc, path):
    """依 "a.b.c" 取值。路徑上遇到陣列時，對陣列的每個元素繼續往下走，回傳所有取到的值。"""
    current = [doc]
    for key in path.split("."):
        nxt = []
        for value in current:
            if isinstance(value, list):
                value_items = value
            else:
                value_items = [value]
            for item in value_items:
                if isinstance(item, dict) and key in item:
                    nxt.append(item[key])
        current = nxt
    return current


def leaf_values(values):
    # 欄位本身是陣列時，陣列整體與每個元素都可以拿來比對
    out = []
    for v in values:
        out.append(v)
        if isinstance(v, list):
            out.extend(v)
    return out


def test(value, cond):
    if isinstance(cond, dict) and cond and all(k.startswith("$") for k in cond):
        for op, arg in cond.items():
            if op == "$gt" and not (isinstance(value, (int, float)) and value > arg):
                return False
            if op == "$in" and value not in arg:
                return False
            if op not in ("$gt", "$in"):
                raise ValueError("不支援的運算子 " + op)
        return True
    return value == cond


def matches(doc, flt):
    """flt 例：{"author.name": "Alice", "tags": "db", "comments.likes": {"$gt": 3}}"""
    for path, cond in flt.items():
        values = leaf_values(get_values(doc, path))
        if not any(test(v, cond) for v in values):
            return False
    return True


print([d["_id"] for d in POSTS if matches(d, {"tags": "db"})])
`,
    tests: [
      { name: '頂層欄位與陣列欄位', code: `assert matches(POSTS[0], {"_id": 1})
assert [d["_id"] for d in POSTS if matches(d, {"tags": "db"})] == [1, 2]
assert not matches(POSTS[2], {"tags": "db"})` },
      { name: 'dot notation 進入巢狀文件', code: `assert [d["_id"] for d in POSTS if matches(d, {"author.name": "Alice"})] == [1, 3]
assert [d["_id"] for d in POSTS if matches(d, {"author.name": "Alice", "tags": "cache"})] == [3]` },
      { name: 'dot notation 穿過陣列裡的子文件', code: `assert [d["_id"] for d in POSTS if matches(d, {"comments.author": "Carol"})] == [1]
assert [d["_id"] for d in POSTS if matches(d, {"comments.author": "Dave"})] == [3]` },
      { name: '$gt 與 $in', code: `assert [d["_id"] for d in POSTS if matches(d, {"comments.likes": {"$gt": 3}})] == [1]
assert [d["_id"] for d in POSTS if matches(d, {"author.level": {"$gt": 2}})] == [1, 3]
assert [d["_id"] for d in POSTS if matches(d, {"tags": {"$in": ["sql", "cache"]}})] == [2, 3]` },
      { name: '路徑不存在就不符合', code: `assert not matches(POSTS[1], {"comments.author": "Bob"})
assert not matches(POSTS[0], {"author.email": "x"})` },
    ],
    hints: ['get_values 從 [doc] 開始，每走一段 key 就把目前所有值往下展開；遇到 list 就對每個元素各走一次。', '比對時，若取到的值本身是 list，把 list 的元素也加進候選值，任一候選值符合即可。'],
  },
  {
    id: 'mongodb-ops-1', skill: 'mongodb-ops', kind: 'python', level: 2,
    title: '自己實作 aggregation pipeline',
    prompt: 'aggregation pipeline 是「一個階段的輸出是下一個階段的輸入」。用 Python 在 dict 列表上實作四個階段，行為比照 MongoDB：\n\n- `$match`：等值過濾（已完成）\n- `$group`：`_id` 用 `"$欄位"` 指定分組鍵；其他欄位是累加器，支援 `{"$sum": 1}`（計數）與 `{"$sum": "$欄位"}`（加總）\n- `$sort`：`{欄位: 1 或 -1}`，多個欄位時前面的優先\n- `$limit`：取前 n 筆（已完成）\n\n輸出文件的欄位：`_id` 加上各累加器名稱。對照 SQL：`$match` ≈ WHERE、`$group` ≈ GROUP BY、`$sort` ≈ ORDER BY、`$limit` ≈ LIMIT。',
    starter: `ARTICLES = [
    {"title": "索引入門", "author": "alice", "views": 120, "status": "published"},
    {"title": "交易與鎖", "author": "bob", "views": 300, "status": "published"},
    {"title": "聚合管線", "author": "alice", "views": 80, "status": "published"},
    {"title": "草稿：分片", "author": "carol", "views": 0, "status": "draft"},
    {"title": "快取策略", "author": "carol", "views": 210, "status": "published"},
    {"title": "嵌入或參照", "author": "alice", "views": 50, "status": "published"},
]


def aggregate(docs, pipeline):
    result = list(docs)
    for stage in pipeline:
        (op, spec), = stage.items()
        if op == "$match":
            result = [d for d in result if all(d.get(k) == v for k, v in spec.items())]
        elif op == "$limit":
            result = result[:spec]
        # TODO: $group（_id 用 "$欄位"；累加器支援 {"$sum": 1} 與 {"$sum": "$欄位"}）
        # TODO: $sort（{欄位: 1 或 -1}，可多個欄位，依序比較）
    return result


print(aggregate(ARTICLES, [
    {"$match": {"status": "published"}},
    {"$group": {"_id": "$author", "posts": {"$sum": 1}, "views": {"$sum": "$views"}}},
    {"$sort": {"posts": -1, "_id": 1}},
    {"$limit": 2},
]))
`,
    solution: `ARTICLES = [
    {"title": "索引入門", "author": "alice", "views": 120, "status": "published"},
    {"title": "交易與鎖", "author": "bob", "views": 300, "status": "published"},
    {"title": "聚合管線", "author": "alice", "views": 80, "status": "published"},
    {"title": "草稿：分片", "author": "carol", "views": 0, "status": "draft"},
    {"title": "快取策略", "author": "carol", "views": 210, "status": "published"},
    {"title": "嵌入或參照", "author": "alice", "views": 50, "status": "published"},
]


def field(doc, expr):
    # "$views" 代表取欄位值；其他值（例如 1）是常數
    if isinstance(expr, str) and expr.startswith("$"):
        return doc.get(expr[1:])
    return expr


def aggregate(docs, pipeline):
    result = list(docs)
    for stage in pipeline:
        (op, spec), = stage.items()
        if op == "$match":
            result = [d for d in result if all(d.get(k) == v for k, v in spec.items())]
        elif op == "$limit":
            result = result[:spec]
        elif op == "$group":
            groups = {}
            for d in result:
                key = field(d, spec["_id"])
                if key not in groups:
                    groups[key] = {"_id": key, **{name: 0 for name in spec if name != "_id"}}
                for name, acc in spec.items():
                    if name == "_id":
                        continue
                    (acc_op, expr), = acc.items()
                    if acc_op != "$sum":
                        raise ValueError("只支援 $sum")
                    groups[key][name] += field(d, expr) or 0
            result = list(groups.values())
        elif op == "$sort":
            # 多欄位排序：從最後一個鍵開始做穩定排序，前面的鍵優先
            for key, direction in reversed(list(spec.items())):
                result.sort(key=lambda d: d.get(key), reverse=direction == -1)
        else:
            raise ValueError("不支援的階段 " + op)
    return result


print(aggregate(ARTICLES, [
    {"$match": {"status": "published"}},
    {"$group": {"_id": "$author", "posts": {"$sum": 1}, "views": {"$sum": "$views"}}},
    {"$sort": {"posts": -1, "_id": 1}},
    {"$limit": 2},
]))
`,
    tests: [
      { name: '$group 計數與加總', code: `_r = aggregate(ARTICLES, [{"$group": {"_id": "$author", "posts": {"$sum": 1}, "views": {"$sum": "$views"}}}])
_m = {d["_id"]: d for d in _r}
assert len(_r) == 3, _r
assert _m["alice"] == {"_id": "alice", "posts": 3, "views": 250}, _m["alice"]
assert _m["carol"] == {"_id": "carol", "posts": 2, "views": 210}, _m["carol"]` },
      { name: '$match → $group → $sort → $limit', code: `_r = aggregate(ARTICLES, [{"$match": {"status": "published"}}, {"$group": {"_id": "$author", "posts": {"$sum": 1}, "views": {"$sum": "$views"}}}, {"$sort": {"posts": -1, "_id": 1}}, {"$limit": 2}])
assert _r == [{"_id": "alice", "posts": 3, "views": 250}, {"_id": "bob", "posts": 1, "views": 300}], _r` },
      { name: '$sort 多欄位：前面的鍵優先', code: `_r = aggregate(ARTICLES, [{"$match": {"status": "published"}}, {"$group": {"_id": "$author", "posts": {"$sum": 1}}}, {"$sort": {"posts": 1, "_id": -1}}])
assert [d["_id"] for d in _r] == ["carol", "bob", "alice"], _r` },
      { name: '依瀏覽數排序文章', code: `_r = aggregate(ARTICLES, [{"$sort": {"views": -1}}, {"$limit": 3}])
assert [d["title"] for d in _r] == ["交易與鎖", "快取策略", "索引入門"], _r` },
    ],
    hints: ['$group 用一個 dict 收集每個分組鍵的累加結果；"$views" 取 d["views"]，數字 1 就是常數 1。', '多欄位排序可以利用 Python 排序是穩定的：從最後一個鍵開始依序排，最後排的鍵優先。'],
  },
  {
    id: 'db-choice-1', skill: 'db-choice', kind: 'sql', level: 2,
    title: 'JSONB：在 PostgreSQL 裡查形狀不一的事件',
    prompt: '行為事件的欄位每種都不同，常被拿來當「該用文件資料庫」的理由。PostgreSQL 的 `jsonb` 也能存這種資料，並用 GIN 索引查詢。\n\n`events.payload` 裡，裝置資訊在巢狀的 `device.os`，有些事件沒有 `device`。統計**來自 iOS 裝置**的事件，每種 `type` 各幾筆。欄位：`type`、`n`，依 `n` 由多到少、同數量依 `type` 排序。\n\n提示：`payload @> \'{"device": {"os": "ios"}}\'` 是「包含」運算子，可以用到 `payload` 上的 GIN 索引；`payload->>\'type\'` 取出文字值。',
    setup: `CREATE TABLE events (
  id      bigint PRIMARY KEY,
  user_id bigint NOT NULL,
  payload jsonb  NOT NULL
);
INSERT INTO events VALUES
  (1, 1, '{"type": "page_view", "path": "/products/3", "device": {"os": "ios", "app_version": "5.2"}}'),
  (2, 1, '{"type": "add_to_cart", "product_id": 3, "qty": 1, "device": {"os": "ios", "app_version": "5.2"}}'),
  (3, 2, '{"type": "page_view", "path": "/", "device": {"os": "android"}}'),
  (4, 3, '{"type": "page_view", "path": "/cart", "device": {"os": "ios", "app_version": "5.1"}}'),
  (5, 3, '{"type": "checkout", "order_id": 104, "coupon": "AUTUMN", "device": {"os": "ios"}}'),
  (6, 4, '{"type": "page_view", "path": "/products/1", "referrer": "newsletter"}'),
  (7, 5, '{"type": "page_view", "path": "/", "device": {"os": "ios", "app_version": "5.2"}}');
CREATE INDEX events_payload_gin ON events USING gin (payload);
`,
    setupKey: 'events-jsonb',
    starter: `SELECT payload->>'type' AS type, count(*) AS n
FROM events
WHERE payload->>'os' = 'ios'
GROUP BY 1
ORDER BY n DESC, type;`,
    solution: `SELECT payload->>'type' AS type, count(*) AS n
FROM events
WHERE payload @> '{"device": {"os": "ios"}}'
GROUP BY 1
ORDER BY n DESC, type;`,
    expect: { columns: ['type', 'n'], rows: [['page_view', '3'], ['add_to_cart', '1'], ['checkout', '1']], ordered: true },
    hints: ['os 不在最外層：`payload->\'device\'->>\'os\'` 才取得到；或用 `@>` 寫出要包含的 JSON 片段。', '`->` 回傳 jsonb（可以繼續往下取），`->>` 回傳 text（用來比較字串或輸出）。'],
  },
  {
    id: 'locks-deadlocks-1', skill: 'locks-deadlocks', kind: 'python', level: 2,
    title: '找出擋住大家的源頭',
    prompt: '服務卡住時，`SELECT pid, pg_blocking_pids(pid) AS blocked_by, state, query FROM pg_stat_activity` 會列出每個連線被誰擋住。被擋的連線常常又擋住別人，要處理的是最上游那一個。\n\n實作 `root_blockers(snapshot)`：回傳 `[(pid, 被它直接或間接擋住的連線數), ...]`，只列「有擋住別人、自己沒被擋」的連線，依數量由多到少、同數量依 pid 由小到大。\n\n- 間接也要算：101 擋 102、102 擋 103，則 103 也算被 101 擋住\n- 同一個連線只算一次（可能同時經由兩條路徑被擋）\n- 正在形成死結的連線彼此互擋，沒有任何一個是「自己沒被擋」，不會出現在結果裡；走訪時要避免無窮迴圈',
    starter: `# 某個時間點的 pg_stat_activity + pg_blocking_pids(pid)（簡化過的欄位）
SNAPSHOT = [
    {"pid": 101, "blocked_by": [],    "state": "idle in transaction", "query": "UPDATE orders SET status = 'paid' WHERE id = 7"},
    {"pid": 102, "blocked_by": [101], "state": "active", "query": "ALTER TABLE orders ADD COLUMN note text"},
    {"pid": 103, "blocked_by": [102], "state": "active", "query": "SELECT * FROM orders WHERE id = 9"},
    {"pid": 104, "blocked_by": [102], "state": "active", "query": "SELECT * FROM orders WHERE user_id = 2"},
    {"pid": 105, "blocked_by": [101], "state": "active", "query": "UPDATE orders SET status = 'shipped' WHERE id = 7"},
    {"pid": 201, "blocked_by": [],    "state": "active", "query": "UPDATE products SET stock = stock - 1 WHERE id = 3"},
    {"pid": 202, "blocked_by": [201], "state": "active", "query": "UPDATE products SET stock = stock - 1 WHERE id = 3"},
    {"pid": 300, "blocked_by": [],    "state": "idle", "query": "SELECT 1"},
]


def root_blockers(snapshot):
    counts = {}
    for row in snapshot:
        for blocker in row["blocked_by"]:
            counts[blocker] = counts.get(blocker, 0) + 1
    return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))


print(root_blockers(SNAPSHOT))
`,
    solution: `# 某個時間點的 pg_stat_activity + pg_blocking_pids(pid)（簡化過的欄位）
SNAPSHOT = [
    {"pid": 101, "blocked_by": [],    "state": "idle in transaction", "query": "UPDATE orders SET status = 'paid' WHERE id = 7"},
    {"pid": 102, "blocked_by": [101], "state": "active", "query": "ALTER TABLE orders ADD COLUMN note text"},
    {"pid": 103, "blocked_by": [102], "state": "active", "query": "SELECT * FROM orders WHERE id = 9"},
    {"pid": 104, "blocked_by": [102], "state": "active", "query": "SELECT * FROM orders WHERE user_id = 2"},
    {"pid": 105, "blocked_by": [101], "state": "active", "query": "UPDATE orders SET status = 'shipped' WHERE id = 7"},
    {"pid": 201, "blocked_by": [],    "state": "active", "query": "UPDATE products SET stock = stock - 1 WHERE id = 3"},
    {"pid": 202, "blocked_by": [201], "state": "active", "query": "UPDATE products SET stock = stock - 1 WHERE id = 3"},
    {"pid": 300, "blocked_by": [],    "state": "idle", "query": "SELECT 1"},
]


def root_blockers(snapshot):
    # 反過來建圖：blocker -> 被它直接擋住的 pid
    blocks = {}
    blocked = set()
    for row in snapshot:
        for blocker in row["blocked_by"]:
            blocks.setdefault(blocker, []).append(row["pid"])
            blocked.add(row["pid"])

    def downstream(pid):
        seen, stack = set(), [pid]
        while stack:
            for nxt in blocks.get(stack.pop(), []):
                if nxt not in seen and nxt != pid:
                    seen.add(nxt)
                    stack.append(nxt)
        return seen

    roots = [pid for pid in blocks if pid not in blocked]
    result = [(pid, len(downstream(pid))) for pid in roots]
    return sorted(result, key=lambda kv: (-kv[1], kv[0]))


print(root_blockers(SNAPSHOT))
`,
    tests: [
      { name: '範例快照：101 擋住 4 個、201 擋住 1 個', code: `assert root_blockers(SNAPSHOT) == [(101, 4), (201, 1)], root_blockers(SNAPSHOT)` },
      { name: '被擋住的中間層不算源頭', code: `assert 102 not in [p for p, _ in root_blockers(SNAPSHOT)]` },
      { name: '兩條路徑擋到同一個連線只算一次', code: `_s = [{"pid": 1, "blocked_by": []}, {"pid": 2, "blocked_by": [1]}, {"pid": 3, "blocked_by": [1]}, {"pid": 4, "blocked_by": [2, 3]}]
assert root_blockers(_s) == [(1, 3)], root_blockers(_s)` },
      { name: '死結中的連線不是源頭，也不會無窮迴圈', code: `_s = [{"pid": 7, "blocked_by": [8]}, {"pid": 8, "blocked_by": [7]}, {"pid": 9, "blocked_by": [7]}, {"pid": 5, "blocked_by": []}, {"pid": 6, "blocked_by": [5]}]
assert root_blockers(_s) == [(5, 1)], root_blockers(_s)` },
      { name: '沒有人被擋時回傳空陣列', code: `assert root_blockers([{"pid": 1, "blocked_by": []}]) == []` },
    ],
    hints: ['先把「誰被誰擋」反過來，建成「blocker → 被它擋住的 pid 清單」。', '源頭 = 出現在 blocks 的鍵裡、但不在任何人的 blocked_by 被擋集合裡。數量用 DFS / BFS 走訪並用 set 去重。'],
  },
  {
    id: 'schema-design-practice-1', skill: 'schema-design-practice', kind: 'sql', level: 2,
    title: '門診掛號的約束',
    prompt: '`patients`、`doctors`、`clinic_sessions`（診次）已經建好。寫出 `appointments`（掛號）的 DDL，讓下面每一條業務規則都由**資料庫**擋下：\n\n1. 欄位：`id`（bigint identity 主鍵）、`session_id`、`patient_id`、`seq_no`（看診號）、`status`（預設 `\'booked\'`）、`created_at`（timestamptz，預設 `now()`）\n2. `session_id`、`patient_id` 是外鍵；掛號紀錄要保留，**有掛號的診次不能被刪除**\n3. 同一診次的看診號不能重複；看診號必須大於 0\n4. `status` 只能是 `booked`、`checked_in`、`cancelled`、`no_show`\n5. 同一位病患在同一診次只能有一筆**有效**（未取消）掛號，取消後可以重掛\n\n驗收會依序嘗試合法與不合法的寫入，結果表的 `ok` 全部要是 true。',
    setup: `CREATE TABLE patients (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chart_no text NOT NULL UNIQUE,
  name     text NOT NULL
);
CREATE TABLE doctors (
  id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE clinic_sessions (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doctor_id    bigint NOT NULL REFERENCES doctors (id),
  session_date date   NOT NULL,
  period       text   NOT NULL CHECK (period IN ('morning', 'afternoon', 'evening')),
  UNIQUE (doctor_id, session_date, period)
);
INSERT INTO patients (chart_no, name) VALUES ('A000123', '林小明'), ('A000456', '陳美華');
INSERT INTO doctors (name) VALUES ('王醫師');
INSERT INTO clinic_sessions (doctor_id, session_date, period) VALUES (1, '2026-11-03', 'morning'), (1, '2026-11-03', 'afternoon');
`,
    setupKey: 'clinic',
    starter: `CREATE TABLE appointments (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id bigint NOT NULL,
  patient_id bigint NOT NULL,
  seq_no     int    NOT NULL,
  status     text   NOT NULL DEFAULT 'booked',
  created_at timestamptz NOT NULL DEFAULT now()
);
-- TODO: 外鍵、CHECK、唯一約束，以及「有效掛號」的部分唯一索引
`,
    solution: `CREATE TABLE appointments (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id bigint NOT NULL REFERENCES clinic_sessions (id),
  patient_id bigint NOT NULL REFERENCES patients (id),
  seq_no     int    NOT NULL CHECK (seq_no > 0),
  status     text   NOT NULL DEFAULT 'booked'
             CHECK (status IN ('booked', 'checked_in', 'cancelled', 'no_show')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointments_seq_unique UNIQUE (session_id, seq_no)
);
CREATE UNIQUE INDEX appointments_one_active
  ON appointments (session_id, patient_id) WHERE status <> 'cancelled';
CREATE INDEX appointments_patient_id_idx ON appointments (patient_id);
`,
    expect: { query: `DROP TABLE IF EXISTS _r;
CREATE TABLE _r (k text PRIMARY KEY, ok boolean);
DO $$
BEGIN
  BEGIN
    INSERT INTO appointments (session_id, patient_id, seq_no) VALUES (1, 1, 1);
    INSERT INTO _r VALUES ('1 合法掛號可寫入，狀態預設 booked', (SELECT status = 'booked' AND created_at IS NOT NULL FROM appointments WHERE session_id = 1 AND seq_no = 1));
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('1 合法掛號可寫入，狀態預設 booked', false);
  END;
  BEGIN
    INSERT INTO appointments (session_id, patient_id, seq_no) VALUES (1, 2, 1);
    INSERT INTO _r VALUES ('2 同診次的看診號不能重複', false);
  EXCEPTION WHEN unique_violation THEN INSERT INTO _r VALUES ('2 同診次的看診號不能重複', true);
            WHEN OTHERS THEN INSERT INTO _r VALUES ('2 同診次的看診號不能重複', false);
  END;
  BEGIN
    INSERT INTO appointments (session_id, patient_id, seq_no) VALUES (1, 1, 2);
    INSERT INTO _r VALUES ('3 同病患同診次不能有兩筆有效掛號', false);
  EXCEPTION WHEN unique_violation THEN INSERT INTO _r VALUES ('3 同病患同診次不能有兩筆有效掛號', true);
            WHEN OTHERS THEN INSERT INTO _r VALUES ('3 同病患同診次不能有兩筆有效掛號', false);
  END;
  BEGIN
    UPDATE appointments SET status = 'cancelled' WHERE session_id = 1 AND seq_no = 1; INSERT INTO appointments (session_id, patient_id, seq_no) VALUES (1, 1, 3);
    INSERT INTO _r VALUES ('4 取消後可以重掛', true);
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('4 取消後可以重掛', false);
  END;
  BEGIN
    INSERT INTO appointments (session_id, patient_id, seq_no, status) VALUES (1, 2, 4, 'done');
    INSERT INTO _r VALUES ('5 狀態只能是四種之一', false);
  EXCEPTION WHEN check_violation THEN INSERT INTO _r VALUES ('5 狀態只能是四種之一', true);
            WHEN OTHERS THEN INSERT INTO _r VALUES ('5 狀態只能是四種之一', false);
  END;
  BEGIN
    INSERT INTO appointments (session_id, patient_id, seq_no) VALUES (1, 2, 0);
    INSERT INTO _r VALUES ('6 看診號必須大於 0', false);
  EXCEPTION WHEN check_violation THEN INSERT INTO _r VALUES ('6 看診號必須大於 0', true);
            WHEN OTHERS THEN INSERT INTO _r VALUES ('6 看診號必須大於 0', false);
  END;
  BEGIN
    INSERT INTO appointments (session_id, patient_id, seq_no) VALUES (1, 999, 5);
    INSERT INTO _r VALUES ('7 不存在的病患被擋下', false);
  EXCEPTION WHEN foreign_key_violation THEN INSERT INTO _r VALUES ('7 不存在的病患被擋下', true);
            WHEN OTHERS THEN INSERT INTO _r VALUES ('7 不存在的病患被擋下', false);
  END;
  BEGIN
    INSERT INTO appointments (session_id, patient_id, seq_no) VALUES (999, 2, 6);
    INSERT INTO _r VALUES ('8 不存在的診次被擋下', false);
  EXCEPTION WHEN foreign_key_violation THEN INSERT INTO _r VALUES ('8 不存在的診次被擋下', true);
            WHEN OTHERS THEN INSERT INTO _r VALUES ('8 不存在的診次被擋下', false);
  END;
  BEGIN
    DELETE FROM clinic_sessions WHERE id = 1;
    INSERT INTO _r VALUES ('9 有掛號的診次不能被刪除', false);
  EXCEPTION WHEN foreign_key_violation THEN INSERT INTO _r VALUES ('9 有掛號的診次不能被刪除', true);
            WHEN OTHERS THEN INSERT INTO _r VALUES ('9 有掛號的診次不能被刪除', false);
  END;
END $$;
SELECT k AS rule, ok FROM _r ORDER BY k;`, columns: ['rule', 'ok'], rows: [['1 合法掛號可寫入，狀態預設 booked', 'true'], ['2 同診次的看診號不能重複', 'true'], ['3 同病患同診次不能有兩筆有效掛號', 'true'], ['4 取消後可以重掛', 'true'], ['5 狀態只能是四種之一', 'true'], ['6 看診號必須大於 0', 'true'], ['7 不存在的病患被擋下', 'true'], ['8 不存在的診次被擋下', 'true'], ['9 有掛號的診次不能被刪除', 'true']], ordered: true },
    hints: ['外鍵不寫 ON DELETE 就是預設的 NO ACTION：還有掛號參照時，刪除診次會被拒絕。寫成 CASCADE 會讓規則 9 失敗。', '規則 5 用一般的 UNIQUE (session_id, patient_id) 會讓「取消後重掛」失敗；改用 CREATE UNIQUE INDEX … WHERE status <> \'cancelled\'。'],
  },
  {
    id: 'full-text-search-1', skill: 'full-text-search', kind: 'sql', level: 2,
    title: '用全文檢索取代 ILIKE',
    prompt: '`articles` 已經有 `tsv` 欄位（標題權重 A、內文權重 B，english 設定）與 GIN 索引。起始碼用 `ILIKE \'%index%\'` 搜尋：它會命中只出現 `reindex` 的文章，而且只能依 id 排序。\n\n改寫成全文檢索：用 `websearch_to_tsquery(\'english\', \'index\')` 比對 `tsv`，依 `ts_rank` 由高到低排序，欄位 `id`、`title`。',
    setup: `CREATE TABLE articles (
  id    bigint PRIMARY KEY,
  title text NOT NULL,
  body  text NOT NULL,
  tsv   tsvector GENERATED ALWAYS AS (
          setweight(to_tsvector('english', title), 'A') ||
          setweight(to_tsvector('english', body),  'B')
        ) STORED
);
CREATE INDEX articles_tsv_idx ON articles USING gin (tsv);
INSERT INTO articles (id, title, body) VALUES
  (1, 'Tuning autovacuum', 'Autovacuum removes dead tuples. Vacuuming large tables too rarely makes indexes bloat.'),
  (2, 'Choosing an index type', 'B-tree indexes handle equality and range queries. GIN indexes handle arrays and full text search.'),
  (3, 'Connection pooling with PgBouncer', 'A connection pool keeps a few server connections open and shares them between clients.'),
  (4, 'Reindexing bloated indexes', 'After heavy updates an index can bloat; REINDEX CONCURRENTLY rebuilds it without blocking writes. Run VACUUM first.'),
  (5, 'Catalog of blog posts', 'A list of every post on this blog, grouped by year.'),
  (6, 'Reindex schedule', 'Run REINDEX on the busiest tables once a month.');
`,
    setupKey: 'articles-fts',
    starter: `SELECT id, title
FROM articles
WHERE title ILIKE '%index%' OR body ILIKE '%index%'
ORDER BY id;`,
    solution: `SELECT id, title
FROM articles, websearch_to_tsquery('english', 'index') AS q
WHERE tsv @@ q
ORDER BY ts_rank(tsv, q) DESC;`,
    expect: { columns: ['id', 'title'], rows: [['2', 'Choosing an index type'], ['4', 'Reindexing bloated indexes'], ['1', 'Tuning autovacuum']], ordered: true },
    hints: ['FROM 後面接 `websearch_to_tsquery(...) AS q`，WHERE 與 ORDER BY 就能共用同一個 q。', '比對用 `tsv @@ q`；排序用 `ts_rank(tsv, q) DESC`。標題命中（權重 A）的文章會排在只有內文提到的前面。'],
  },
]

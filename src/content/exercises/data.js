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
]

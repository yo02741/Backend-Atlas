/* Playground 與 SQL 練習共用的範例資料庫：電商小世界（users / products / orders / order_items）。
   與 JOIN 實驗室的 users / orders 資料一致，方便對照。 */
export const SHOP_SCHEMA = `
CREATE TABLE users (
  id         BIGINT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  city       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE products (
  id    BIGINT PRIMARY KEY,
  name  TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0)
);
CREATE TABLE orders (
  id         BIGINT PRIMARY KEY,
  user_id    BIGINT,
  status     TEXT NOT NULL CHECK (status IN ('pending','paid','shipped','cancelled')),
  amount     NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE order_items (
  order_id   BIGINT NOT NULL REFERENCES orders(id),
  product_id BIGINT NOT NULL REFERENCES products(id),
  qty        INTEGER NOT NULL CHECK (qty > 0),
  PRIMARY KEY (order_id, product_id)
);
INSERT INTO users (id, name, email, city, created_at) VALUES
  (1, 'Alice', 'alice@example.com', '台北', '2026-01-05'),
  (2, 'Bob',   'bob@example.com',   '台中', '2026-01-12'),
  (3, 'Carol', 'carol@example.com', '高雄', '2026-02-01'),
  (4, 'Dave',  'dave@example.com',  '台南', '2026-02-14'),
  (5, 'Eve',   'eve@example.com',   '新竹', '2026-03-03');
INSERT INTO products (id, name, price, stock) VALUES
  (1, '鍵盤', 2400, 10),
  (2, '滑鼠', 890, 25),
  (3, '螢幕', 7990, 3),
  (4, '耳機', 3200, 0),
  (5, '椅子', 12000, 2);
INSERT INTO orders (id, user_id, status, amount, created_at) VALUES
  (101, 1, 'paid',      2400,  '2026-03-01 10:00+08'),
  (102, 1, 'shipped',   890,   '2026-03-05 14:30+08'),
  (103, 2, 'paid',      7990,  '2026-03-06 09:15+08'),
  (104, 3, 'pending',   3200,  '2026-03-08 20:00+08'),
  (105, 9, 'cancelled', 12000, '2026-03-09 11:00+08'),
  (106, 2, 'paid',      3290,  '2026-03-12 16:45+08');
INSERT INTO order_items (order_id, product_id, qty) VALUES
  (101, 1, 1), (102, 2, 1), (103, 3, 1), (104, 4, 1), (105, 5, 1), (106, 2, 1), (106, 1, 1);
`

export const SHOP_TABLES = [
  { name: 'users', cols: 'id, name, email, city, created_at' },
  { name: 'products', cols: 'id, name, price, stock' },
  { name: 'orders', cols: 'id, user_id, status, amount, created_at' },
  { name: 'order_items', cols: 'order_id, product_id, qty' },
]

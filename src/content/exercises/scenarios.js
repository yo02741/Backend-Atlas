// 程式題：設計情境的落地（每題對應一個情境的做法；情境頁「動手練習」連到這裡）
import { SHOP_SCHEMA } from '../schemas.js'

const CATALOG = `
CREATE TABLE products (
  id          BIGINT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  in_stock    BOOLEAN NOT NULL
);
INSERT INTO products (id, name, description, in_stock) VALUES
  (1, 'Bluetooth Keyboard',  'Compact wireless keyboard with quiet keys', true),
  (2, 'Mechanical Keyboard', 'Wired mechanical keyboard, blue switches', true),
  (3, 'Wireless Mouse',      'Bluetooth mouse with silent click', false),
  (4, 'USB-C Hub',           'Seven port hub with power delivery', true),
  (5, 'Keyboard Wrist Rest', 'Memory foam rest for any keyboard', true),
  (6, 'Bluetooth Speaker',   'Portable speaker, ten hour battery', true);
`

const SOFTDEL = `
CREATE TABLE users (
  id         BIGINT PRIMARY KEY,
  email      TEXT NOT NULL,
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX users_email_active ON users (email) WHERE deleted_at IS NULL;
CREATE TABLE orders (
  id      BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  amount  INTEGER NOT NULL
);
INSERT INTO users (id, email, deleted_at) VALUES
  (1, 'alice@example.com', NULL),
  (2, 'bob@example.com',   '2026-03-01 09:00+08'),
  (3, 'carol@example.com', NULL),
  (4, 'bob@example.com',   NULL);
INSERT INTO orders (id, user_id, amount) VALUES
  (1, 1, 100), (2, 2, 250), (3, 2, 50), (4, 3, 80);
`

const FLASH = SHOP_SCHEMA + `
INSERT INTO orders (id, user_id, status, amount, created_at) VALUES (107, 2, 'pending', 7990, now());
`

export default [
  /* ---------- API 快取：cache-aside ---------- */
  {
    id: 'redis-cache-1', skill: 'redis-cache', kind: 'python', level: 2,
    title: 'Cache-aside 含 TTL',
    prompt: '實作 `Cache.get_or_load(key, loader, now)`：\n\n- 快取裡有這個 key 且還沒過期（`expires_at > now`）→ 命中，直接回快取值，`hits` 加 1\n- 否則 → 呼叫 `loader()` 拿值，存進快取並設 `expires_at = now + ttl`，`misses` 加 1，回傳值\n- `now` 由呼叫者傳入（測試才能控制時間）',
    starter: `class Cache:
    def __init__(self, ttl: float):
        self.ttl = ttl
        self.store = {}      # key -> (value, expires_at)
        self.hits = 0
        self.misses = 0

    def get_or_load(self, key, loader, now: float):
        # TODO
        return loader()


calls = []
def load_user():
    calls.append(1)
    return {"id": 1, "name": "Alice"}

c = Cache(ttl=60)
print(c.get_or_load("user:1", load_user, now=0))
print(c.get_or_load("user:1", load_user, now=30), "loader 被叫了", len(calls), "次")
`,
    solution: `class Cache:
    def __init__(self, ttl: float):
        self.ttl = ttl
        self.store = {}      # key -> (value, expires_at)
        self.hits = 0
        self.misses = 0

    def get_or_load(self, key, loader, now: float):
        hit = self.store.get(key)
        if hit is not None and hit[1] > now:
            self.hits += 1
            return hit[0]
        value = loader()
        self.store[key] = (value, now + self.ttl)
        self.misses += 1
        return value


calls = []
def load_user():
    calls.append(1)
    return {"id": 1, "name": "Alice"}

c = Cache(ttl=60)
print(c.get_or_load("user:1", load_user, now=0))
print(c.get_or_load("user:1", load_user, now=30), "loader 被叫了", len(calls), "次")
`,
    tests: [
      { name: '第一次 miss、第二次 hit，loader 只叫一次', code: `_calls = []\n_c = Cache(ttl=10)\n_load = lambda: _calls.append(1) or "v"\nassert _c.get_or_load("a", _load, 0) == "v"\nassert _c.get_or_load("a", _load, 5) == "v"\nassert len(_calls) == 1, f"loader 被叫了 {len(_calls)} 次"\nassert (_c.hits, _c.misses) == (1, 1), (_c.hits, _c.misses)` },
      { name: '過了 TTL 要重新載入', code: `_calls = []\n_c = Cache(ttl=10)\n_load = lambda: _calls.append(1) or len(_calls)\nassert _c.get_or_load("a", _load, 0) == 1\nassert _c.get_or_load("a", _load, 10.5) == 2, "expires_at = 0 + 10，10.5 已過期"\nassert _c.get_or_load("a", _load, 12) == 2, "剛載入的要再快取 10 秒"` },
      { name: '不同 key 互不影響', code: `_c = Cache(ttl=10)\nassert _c.get_or_load("a", lambda: "A", 0) == "A"\nassert _c.get_or_load("b", lambda: "B", 0) == "B"\nassert _c.get_or_load("a", lambda: "X", 1) == "A"\nassert _c.misses == 2 and _c.hits == 1` },
    ],
    hints: ['store 裡存 (value, expires_at) 的 tuple，命中條件是 key 存在且 expires_at > now。', 'miss 的路徑要做三件事：呼叫 loader、寫回快取、計數。'],
  },

  /* ---------- 冪等鍵 ---------- */
  {
    id: 'api-patterns-2', skill: 'api-patterns', kind: 'python', level: 2,
    title: 'Idempotency-Key：同一把 key 只扣一次款',
    prompt: '實作 `Payments.charge(key, payload)`：\n\n- 沒看過的 key → 真的扣款（把 payload 加進 `charged`），回 `{"status": 201, "charge_id": <第幾筆>}`，並記住這把 key 對應的 payload 指紋與回應\n- 同 key、同 payload 再來 → **不扣款**，回上次一模一樣的回應\n- 同 key、不同 payload → 回 `{"status": 422, "error": "key reused with different payload"}`，也不扣款\n\npayload 指紋用 `json.dumps(payload, sort_keys=True)`，欄位順序不同也算同一份。',
    starter: `import json

class Payments:
    def __init__(self):
        self.charged = []      # 真的扣款的紀錄
        self.seen = {}         # key -> (fingerprint, response)

    def charge(self, key: str, payload: dict) -> dict:
        # TODO
        self.charged.append(payload)
        return {"status": 201, "charge_id": len(self.charged)}


p = Payments()
print(p.charge("k1", {"amount": 500, "card": "4242"}))
print(p.charge("k1", {"amount": 500, "card": "4242"}), "扣款次數", len(p.charged))
`,
    solution: `import json

class Payments:
    def __init__(self):
        self.charged = []      # 真的扣款的紀錄
        self.seen = {}         # key -> (fingerprint, response)

    def charge(self, key: str, payload: dict) -> dict:
        fp = json.dumps(payload, sort_keys=True)
        if key in self.seen:
            prev_fp, prev_resp = self.seen[key]
            if prev_fp == fp:
                return prev_resp
            return {"status": 422, "error": "key reused with different payload"}
        self.charged.append(payload)
        resp = {"status": 201, "charge_id": len(self.charged)}
        self.seen[key] = (fp, resp)
        return resp


p = Payments()
print(p.charge("k1", {"amount": 500, "card": "4242"}))
print(p.charge("k1", {"amount": 500, "card": "4242"}), "扣款次數", len(p.charged))
`,
    tests: [
      { name: '同 key 重送：回同一份回應、不重複扣款', code: `_p = Payments()\n_r1 = _p.charge("k1", {"amount": 500, "card": "4242"})\n_r2 = _p.charge("k1", {"card": "4242", "amount": 500})\nassert _r1 == {"status": 201, "charge_id": 1}, _r1\nassert _r2 == _r1, _r2\nassert len(_p.charged) == 1, f"扣了 {len(_p.charged)} 次"` },
      { name: '同 key 不同 payload：422、不扣款', code: `_p = Payments()\n_p.charge("k1", {"amount": 500})\n_r = _p.charge("k1", {"amount": 900})\nassert _r["status"] == 422, _r\nassert len(_p.charged) == 1` },
      { name: '不同 key 各扣一次', code: `_p = Payments()\nassert _p.charge("a", {"amount": 1})["charge_id"] == 1\nassert _p.charge("b", {"amount": 1})["charge_id"] == 2\nassert len(_p.charged) == 2` },
    ],
    hints: ['先算指紋，再查 seen：有 → 比指紋決定回舊回應或 422；沒有 → 扣款、組回應、存進 seen。', '回應要「存下來再回傳」，重送時才拿得到同一份。'],
  },

  /* ---------- 限流：依 key 的滑動視窗 ---------- */
  {
    id: 'rate-limiting-2', skill: 'rate-limiting', kind: 'js', level: 2,
    title: '依 key 的滑動視窗限流',
    prompt: '實作 `SlidingWindow(limit, windowMs)` 的 `allow(key, now)`：每個 key（帳號、IP…）在**過去 windowMs 毫秒內**最多 `limit` 次。\n\n- 每個 key 各自記錄通過的時間戳\n- 先丟掉 `<= now - windowMs` 的舊紀錄，剩下的少於 limit 才放行（並記下 now），否則拒絕\n- 被拒絕的請求**不**記錄時間戳',
    starter: `class SlidingWindow {
  constructor(limit, windowMs) {
    this.limit = limit
    this.windowMs = windowMs
    this.log = new Map()   // key -> 通過的時間戳陣列
  }

  allow(key, now) {
    // TODO
    return true
  }
}

const rl = new SlidingWindow(3, 1000)
console.log([0, 100, 200, 300, 1001].map((t) => rl.allow('user:1', t)))   // 預期 [true, true, true, false, true]
`,
    solution: `class SlidingWindow {
  constructor(limit, windowMs) {
    this.limit = limit
    this.windowMs = windowMs
    this.log = new Map()   // key -> 通過的時間戳陣列
  }

  allow(key, now) {
    const stamps = (this.log.get(key) || []).filter((t) => t > now - this.windowMs)
    const ok = stamps.length < this.limit
    if (ok) stamps.push(now)
    this.log.set(key, stamps)
    return ok
  }
}

const rl = new SlidingWindow(3, 1000)
console.log([0, 100, 200, 300, 1001].map((t) => rl.allow('user:1', t)))   // 預期 [true, true, true, false, true]
`,
    tests: [
      { name: '視窗內第 4 次被擋，舊紀錄滑出後放行', code: `const rl = new SlidingWindow(3, 1000)\nassertEqual([0, 100, 200, 300].map((t) => rl.allow('u', t)), [true, true, true, false])\nassertEqual(rl.allow('u', 999), false, 't=0 的紀錄在 999 還在視窗內')\nassertEqual(rl.allow('u', 1000), true, 't=0 <= 1000 - 1000，剛好過期')` },
      { name: '被拒絕的請求不佔名額', code: `const rl = new SlidingWindow(2, 1000)\nrl.allow('u', 0); rl.allow('u', 10)\nfor (let i = 0; i < 5; i++) rl.allow('u', 20 + i)   // 都被擋\nassertEqual(rl.allow('u', 1005), true, '被拒的請求若被記下來，這裡會誤判')` },
      { name: '不同 key 各算各的', code: `const rl = new SlidingWindow(1, 1000)\nassertEqual(rl.allow('a', 0), true)\nassertEqual(rl.allow('b', 0), true)\nassertEqual(rl.allow('a', 1), false)` },
    ],
    hints: ['先 filter 出還在視窗內的時間戳，用長度判斷，再決定要不要 push。', '過期條件是 t <= now - windowMs：t=0、window=1000，在 now=1000 時剛好過期。'],
  },

  /* ---------- 長任務：狀態機 ---------- */
  {
    id: 'queues-workers-2', skill: 'queues-workers', kind: 'python', level: 2,
    title: '長任務的狀態機',
    prompt: '實作 `Jobs`：`submit(kind)` 建一個 `queued` 的工作並回 id；`start(id)` 從 queued 變 running；`progress(id, pct)` 只有 running 能更新進度（夾在 0–100）；`finish(id, result_url)` 從 running 變 done、進度 100；`fail(id, error)` 從 running 變 failed。\n\n不合法的轉換（例如 queued 直接 finish、done 再 start）要 `raise ValueError`。`get(id)` 回 `{"id", "status", "progress", "result_url", "error"}`。',
    starter: `class Jobs:
    def __init__(self):
        self.jobs = {}
        self.next_id = 1

    def submit(self, kind: str) -> str:
        job_id = f"job_{self.next_id}"
        self.next_id += 1
        self.jobs[job_id] = {"id": job_id, "kind": kind, "status": "queued", "progress": 0, "result_url": None, "error": None}
        return job_id

    def start(self, job_id: str):
        self.jobs[job_id]["status"] = "running"

    def progress(self, job_id: str, pct: int):
        self.jobs[job_id]["progress"] = pct

    def finish(self, job_id: str, result_url: str):
        # TODO：只有 running 可以 finish
        self.jobs[job_id].update(status="done", progress=100, result_url=result_url)

    def fail(self, job_id: str, error: str):
        self.jobs[job_id].update(status="failed", error=error)

    def get(self, job_id: str) -> dict:
        j = self.jobs[job_id]
        return {k: j[k] for k in ("id", "status", "progress", "result_url", "error")}


jobs = Jobs()
jid = jobs.submit("export")
jobs.start(jid); jobs.progress(jid, 40); jobs.finish(jid, "/files/1.csv")
print(jobs.get(jid))
`,
    solution: `class Jobs:
    def __init__(self):
        self.jobs = {}
        self.next_id = 1

    def _expect(self, job_id: str, *allowed: str) -> dict:
        j = self.jobs[job_id]
        if j["status"] not in allowed:
            raise ValueError(f"{job_id} is {j['status']}, expected {allowed}")
        return j

    def submit(self, kind: str) -> str:
        job_id = f"job_{self.next_id}"
        self.next_id += 1
        self.jobs[job_id] = {"id": job_id, "kind": kind, "status": "queued", "progress": 0, "result_url": None, "error": None}
        return job_id

    def start(self, job_id: str):
        self._expect(job_id, "queued")["status"] = "running"

    def progress(self, job_id: str, pct: int):
        self._expect(job_id, "running")["progress"] = max(0, min(100, pct))

    def finish(self, job_id: str, result_url: str):
        self._expect(job_id, "running").update(status="done", progress=100, result_url=result_url)

    def fail(self, job_id: str, error: str):
        self._expect(job_id, "running").update(status="failed", error=error)

    def get(self, job_id: str) -> dict:
        j = self.jobs[job_id]
        return {k: j[k] for k in ("id", "status", "progress", "result_url", "error")}


jobs = Jobs()
jid = jobs.submit("export")
jobs.start(jid); jobs.progress(jid, 40); jobs.finish(jid, "/files/1.csv")
print(jobs.get(jid))
`,
    tests: [
      { name: '正常流程：queued → running → done', code: `_j = Jobs()\n_id = _j.submit("export")\nassert _j.get(_id)["status"] == "queued"\n_j.start(_id); _j.progress(_id, 40)\nassert _j.get(_id) == {"id": _id, "status": "running", "progress": 40, "result_url": None, "error": None}, _j.get(_id)\n_j.finish(_id, "/files/1.csv")\nassert _j.get(_id)["status"] == "done" and _j.get(_id)["progress"] == 100 and _j.get(_id)["result_url"] == "/files/1.csv"` },
      { name: 'queued 不能直接 finish；done 不能再 start', code: `_j = Jobs()\n_id = _j.submit("export")\ntry:\n    _j.finish(_id, "/x")\n    assert False, "queued 直接 finish 應該 raise ValueError"\nexcept ValueError:\n    pass\n_j.start(_id); _j.finish(_id, "/x")\ntry:\n    _j.start(_id)\n    assert False, "done 再 start 應該 raise ValueError"\nexcept ValueError:\n    pass` },
      { name: '進度只在 running 更新、夾在 0–100', code: `_j = Jobs()\n_id = _j.submit("export")\ntry:\n    _j.progress(_id, 10)\n    assert False, "queued 不能更新進度"\nexcept ValueError:\n    pass\n_j.start(_id)\n_j.progress(_id, 250)\nassert _j.get(_id)["progress"] == 100\n_j.progress(_id, -5)\nassert _j.get(_id)["progress"] == 0` },
      { name: 'fail 只能從 running', code: `_j = Jobs()\n_id = _j.submit("export")\n_j.start(_id); _j.fail(_id, "disk full")\nassert _j.get(_id)["status"] == "failed" and _j.get(_id)["error"] == "disk full"\ntry:\n    _j.fail(_id, "again")\n    assert False, "failed 之後不能再 fail"\nexcept ValueError:\n    pass` },
    ],
    hints: ['寫一個 _expect(job_id, *allowed) 檢查目前狀態，四個轉換方法都先呼叫它。', '進度用 max(0, min(100, pct)) 夾住。'],
  },

  /* ---------- 上傳檢查 ---------- */
  {
    id: 'input-validation-1', skill: 'input-validation', kind: 'python', level: 2,
    title: '上傳檢查：大小、magic bytes、副檔名',
    prompt: '實作 `check_upload(filename, declared_type, head, size) -> tuple[bool, str]`，依序檢查：\n\n1. `size > MAX_BYTES` → `(False, "too_large")`\n2. `declared_type` 不在 `ALLOWED` → `(False, "type_not_allowed")`\n3. `head`（檔案前幾個 byte）不是以該型別的 magic bytes 開頭 → `(False, "content_mismatch")`\n4. 都過 → `(True, ext)`，`ext` 由 **magic bytes 對應的型別**決定，**不看 filename**（`photo.php` 只要內容真的是 PNG 就存成 `.png`）',
    starter: `import os

ALLOWED = {
    "image/png": (b"\\x89PNG\\r\\n\\x1a\\n", ".png"),
    "image/jpeg": (b"\\xff\\xd8\\xff", ".jpg"),
    "application/pdf": (b"%PDF-", ".pdf"),
}
MAX_BYTES = 5 * 1024 * 1024

def check_upload(filename: str, declared_type: str, head: bytes, size: int) -> tuple[bool, str]:
    # TODO
    return True, os.path.splitext(filename)[1]


print(check_upload("avatar.png", "image/png", b"\\x89PNG\\r\\n\\x1a\\n....", 20_000))
print(check_upload("shell.png", "image/png", b"<?php echo 1;", 300))
`,
    solution: `import os

ALLOWED = {
    "image/png": (b"\\x89PNG\\r\\n\\x1a\\n", ".png"),
    "image/jpeg": (b"\\xff\\xd8\\xff", ".jpg"),
    "application/pdf": (b"%PDF-", ".pdf"),
}
MAX_BYTES = 5 * 1024 * 1024

def check_upload(filename: str, declared_type: str, head: bytes, size: int) -> tuple[bool, str]:
    if size > MAX_BYTES:
        return False, "too_large"
    if declared_type not in ALLOWED:
        return False, "type_not_allowed"
    magic, ext = ALLOWED[declared_type]
    if not head.startswith(magic):
        return False, "content_mismatch"
    return True, ext


print(check_upload("avatar.png", "image/png", b"\\x89PNG\\r\\n\\x1a\\n....", 20_000))
print(check_upload("shell.png", "image/png", b"<?php echo 1;", 300))
`,
    tests: [
      { name: '真的 PNG 通過，副檔名由內容決定', code: `assert check_upload("avatar.png", "image/png", b"\\x89PNG\\r\\n\\x1a\\n\\x00\\x00", 20_000) == (True, ".png")\nassert check_upload("photo.php", "image/png", b"\\x89PNG\\r\\n\\x1a\\n\\x00\\x00", 20_000) == (True, ".png"), "副檔名看內容不看檔名"\nassert check_upload("scan.pdf", "application/pdf", b"%PDF-1.7\\n", 1000) == (True, ".pdf")` },
      { name: '宣稱是 PNG 但內容不是', code: `assert check_upload("shell.png", "image/png", b"<?php echo 1;", 300) == (False, "content_mismatch")\nassert check_upload("x.jpg", "image/jpeg", b"\\x89PNG\\r\\n\\x1a\\n", 300) == (False, "content_mismatch")` },
      { name: '型別不允許、太大', code: `assert check_upload("a.exe", "application/x-msdownload", b"MZ\\x90\\x00", 10) == (False, "type_not_allowed")\nassert check_upload("big.png", "image/png", b"\\x89PNG\\r\\n\\x1a\\n", 5 * 1024 * 1024 + 1) == (False, "too_large")\nassert check_upload("ok.png", "image/png", b"\\x89PNG\\r\\n\\x1a\\n", 5 * 1024 * 1024) == (True, ".png"), "剛好等於上限要放行"` },
    ],
    hints: ['bytes 也有 startswith：head.startswith(magic)。', '四個檢查依題目順序寫成四個 return，最後一個回 (True, ext)。'],
  },

  /* ---------- 搜尋：全文檢索 ---------- */
  {
    id: 'sql-advanced-3', skill: 'sql-advanced', kind: 'sql', level: 2,
    title: '全文檢索：詞幹讓 keyboards 找得到 keyboard',
    prompt: '商品表 `products(id, name, description, in_stock)`。使用者搜尋 **`wireless keyboards`**（複數）。用 PostgreSQL 全文檢索找出**有貨**、名稱或描述含 wireless **或** keyboard 的商品，回 `id, name`。\n\n- 文件：`to_tsvector(\'english\', name || \' \' || description)`\n- 查詢：`to_tsquery(\'english\', \'wireless | keyboards\')`（`|` 是 OR；english 設定會把 keyboards 還原成 keyboard）\n- 比對用 `@@`\n\n`ILIKE \'%keyboards%\'` 什麼都找不到，這就是要全文檢索的原因。',
    setup: CATALOG, setupKey: 'catalog',
    starter: `SELECT id, name
FROM products
WHERE in_stock
  AND (name || ' ' || description) ILIKE '%keyboards%'   -- TODO：改成 tsvector @@ tsquery
;`,
    solution: `SELECT id, name
FROM products
WHERE in_stock
  AND to_tsvector('english', name || ' ' || description) @@ to_tsquery('english', 'wireless | keyboards');`,
    expect: { columns: ['id', 'name'], rows: [['1', 'Bluetooth Keyboard'], ['2', 'Mechanical Keyboard'], ['5', 'Keyboard Wrist Rest']], ordered: false },
    hints: ['WHERE to_tsvector(\'english\', name || \' \' || description) @@ to_tsquery(\'english\', \'wireless | keyboards\')。', '3 號 Wireless Mouse 沒貨，要被 in_stock 濾掉；6 號 Bluetooth Speaker 兩個詞都沒有。'],
  },

  /* ---------- API 改版：版本協商 ---------- */
  {
    id: 'rest-design-1', skill: 'rest-design', kind: 'js', level: 2,
    title: 'API 版本協商',
    prompt: '實作 `pickVersion(req, { latest, deprecated })`，`req = { path, headers, query }`。依優先序決定版本：\n\n1. 路徑前綴 `/v2/orders` → 2，回傳的 `path` 要去掉前綴（`/orders`）\n2. 標頭 `accept: application/vnd.atlas.v2+json` → 2\n3. 查詢字串 `query.version` → 該數字\n4. 都沒有 → `latest`\n\n版本必須是 1..latest 的整數，否則回 `{ error: \'unknown_version\' }`。正常回 `{ version, deprecated, path }`，`deprecated` 表示版本在 `deprecated` 清單裡。',
    starter: `function pickVersion(req, { latest = 3, deprecated = [1] } = {}) {
  // TODO
  return { version: latest, deprecated: false, path: req.path }
}

console.log(pickVersion({ path: '/v2/orders', headers: {}, query: {} }))
console.log(pickVersion({ path: '/orders', headers: { accept: 'application/vnd.atlas.v1+json' }, query: {} }))
`,
    solution: `function pickVersion(req, { latest = 3, deprecated = [1] } = {}) {
  let version = null
  let path = req.path
  const m = /^\\/v(\\d+)(\\/.*)?$/.exec(req.path)
  if (m) { version = Number(m[1]); path = m[2] || '/' }
  else {
    const h = /vnd\\.atlas\\.v(\\d+)\\+json/.exec(req.headers?.accept || '')
    if (h) version = Number(h[1])
    else if (req.query?.version !== undefined) version = Number(req.query.version)
    else version = latest
  }
  if (!Number.isInteger(version) || version < 1 || version > latest) return { error: 'unknown_version' }
  return { version, deprecated: deprecated.includes(version), path }
}

console.log(pickVersion({ path: '/v2/orders', headers: {}, query: {} }))
console.log(pickVersion({ path: '/orders', headers: { accept: 'application/vnd.atlas.v1+json' }, query: {} }))
`,
    tests: [
      { name: '路徑前綴優先，並去掉前綴', code: `assertEqual(pickVersion({ path: '/v2/orders/9', headers: { accept: 'application/vnd.atlas.v1+json' }, query: { version: '3' } }), { version: 2, deprecated: false, path: '/orders/9' })` },
      { name: '標頭其次、查詢字串再其次、最後預設 latest', code: `assertEqual(pickVersion({ path: '/orders', headers: { accept: 'application/vnd.atlas.v1+json' }, query: { version: '3' } }), { version: 1, deprecated: true, path: '/orders' })\nassertEqual(pickVersion({ path: '/orders', headers: {}, query: { version: '2' } }), { version: 2, deprecated: false, path: '/orders' })\nassertEqual(pickVersion({ path: '/orders', headers: {}, query: {} }), { version: 3, deprecated: false, path: '/orders' })` },
      { name: '不存在的版本', code: `assertEqual(pickVersion({ path: '/v9/orders', headers: {}, query: {} }), { error: 'unknown_version' })\nassertEqual(pickVersion({ path: '/orders', headers: {}, query: { version: 'abc' } }), { error: 'unknown_version' })\nassertEqual(pickVersion({ path: '/orders', headers: {}, query: { version: '0' } }), { error: 'unknown_version' })` },
      { name: '自訂 latest / deprecated', code: `assertEqual(pickVersion({ path: '/v2/x', headers: {}, query: {} }, { latest: 2, deprecated: [1, 2] }), { version: 2, deprecated: true, path: '/x' })` },
    ],
    hints: ['路徑用 /^\\/v(\\d+)(\\/.*)?$/ 抓版本與剩下的路徑。', 'Number("abc") 是 NaN、Number("3") 是 3：最後統一用 Number.isInteger 與範圍檢查。'],
  },

  /* ---------- 登入方案：session cookie ---------- */
  {
    id: 'cors-cookies-1', skill: 'cors-cookies', kind: 'js', level: 2,
    title: 'session cookie 的 Set-Cookie',
    prompt: '實作兩個函式：\n\n- `sessionCookie(sid, opts)` 回 `Set-Cookie` 的值，屬性順序固定：`sid=<sid>; Path=/; Domain=<domain>; HttpOnly; Secure; SameSite=<sameSite>; Max-Age=<maxAgeSec>`。沒給 `domain` 就不出現 Domain；`secure: false` 就不出現 Secure。預設 `maxAgeSec = 86400`、`secure = true`、`sameSite = \'Lax\'`\n- `parseCookies(header)` 把 `\'a=1; b=x%20y\'` 解析成 `{ a: \'1\', b: \'x y\' }`（值要 `decodeURIComponent`），沒有 header 回 `{}`',
    starter: `function sessionCookie(sid, { maxAgeSec = 86400, secure = true, sameSite = 'Lax', domain = null } = {}) {
  // TODO
  return 'sid=' + sid
}

function parseCookies(header) {
  // TODO
  return {}
}

console.log(sessionCookie('abc123'))
console.log(parseCookies('sid=abc123; theme=dark'))
`,
    solution: `function sessionCookie(sid, { maxAgeSec = 86400, secure = true, sameSite = 'Lax', domain = null } = {}) {
  const parts = ['sid=' + sid, 'Path=/']
  if (domain) parts.push('Domain=' + domain)
  parts.push('HttpOnly')
  if (secure) parts.push('Secure')
  parts.push('SameSite=' + sameSite, 'Max-Age=' + maxAgeSec)
  return parts.join('; ')
}

function parseCookies(header) {
  const out = {}
  if (!header) return out
  for (const pair of header.split(';')) {
    const i = pair.indexOf('=')
    if (i === -1) continue
    out[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim())
  }
  return out
}

console.log(sessionCookie('abc123'))
console.log(parseCookies('sid=abc123; theme=dark'))
`,
    tests: [
      { name: '預設：HttpOnly + Secure + SameSite=Lax + 一天', code: `assertEqual(sessionCookie('abc123'), 'sid=abc123; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400')` },
      { name: '本機開發不能 Secure；跨子網域要 Domain', code: `assertEqual(sessionCookie('x', { secure: false, maxAgeSec: 600 }), 'sid=x; Path=/; HttpOnly; SameSite=Lax; Max-Age=600')\nassertEqual(sessionCookie('x', { domain: 'example.com', sameSite: 'None' }), 'sid=x; Path=/; Domain=example.com; HttpOnly; Secure; SameSite=None; Max-Age=86400')` },
      { name: 'parseCookies', code: `assertEqual(parseCookies('sid=abc123; theme=dark'), { sid: 'abc123', theme: 'dark' })\nassertEqual(parseCookies('a=1; b=x%20y; c=k=v'), { a: '1', b: 'x y', c: 'k=v' })\nassertEqual(parseCookies(undefined), {})` },
    ],
    hints: ['把各段放進陣列再 join("; ")，順序就不會錯。', 'parseCookies 只切第一個等號（indexOf），值裡可能還有等號。'],
  },

  /* ---------- 軟刪除後的查詢 ---------- */
  {
    id: 'sql-advanced-4', skill: 'sql-advanced', kind: 'sql', level: 1,
    title: '軟刪除後：只列還在的使用者，沒訂單也要列',
    prompt: '`users(id, email, deleted_at)` 用 `deleted_at` 做軟刪除（bob 刪過帳號又用同一個 email 重新註冊，所以有兩筆 bob）。`orders(id, user_id, amount)`。\n\n列出**還在的**使用者（`deleted_at IS NULL`）的 `id, email, orders（訂單數）, total（總金額，沒訂單為 0）`。沒訂單的使用者也要出現。',
    setup: SOFTDEL, setupKey: 'softdel',
    starter: `SELECT u.id, u.email, count(o.id) AS orders, sum(o.amount) AS total
FROM users u
JOIN orders o ON o.user_id = u.id
GROUP BY u.id, u.email
ORDER BY u.id;`,
    solution: `SELECT u.id, u.email, count(o.id) AS orders, coalesce(sum(o.amount), 0) AS total
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE u.deleted_at IS NULL
GROUP BY u.id, u.email
ORDER BY u.id;`,
    expect: { columns: ['id', 'email', 'orders', 'total'], rows: [['1', 'alice@example.com', '1', '100'], ['3', 'carol@example.com', '1', '80'], ['4', 'bob@example.com', '0', '0']], ordered: false },
    hints: ['「沒訂單也要列」= LEFT JOIN；「還在的」= WHERE u.deleted_at IS NULL（條件在 users 那邊，放 WHERE 沒問題）。', 'sum 遇到全 NULL 會是 NULL，用 coalesce(sum(o.amount), 0)。count(o.id) 不算 NULL，所以沒訂單是 0。'],
  },

  /* ---------- 秒殺：一句 SQL 扣庫存並寫明細 ---------- */
  {
    id: 'transactions-3', skill: 'transactions', kind: 'sql', level: 2,
    title: '秒殺：扣庫存與寫明細要一起發生',
    prompt: '訂單 107 已存在。用**一個語句**（CTE）完成：商品 3 庫存 > 0 才扣 1，並在 `order_items` 插入 `(107, 3, 1)`；庫存不足時兩件事都不發生。\n\n```\nWITH dec AS (\n  UPDATE ... RETURNING id\n)\nINSERT INTO order_items (...) SELECT ... FROM dec;\n```\n\n驗收看：商品 3 庫存變 2、order_items 有 (107, 3)。',
    setup: FLASH, setupKey: 'shop-flash',
    starter: `UPDATE products SET stock = stock - 1 WHERE id = 3;
-- TODO：改成 WITH dec AS (UPDATE … RETURNING id) INSERT … SELECT … FROM dec
`,
    solution: `WITH dec AS (
  UPDATE products
  SET stock = stock - 1
  WHERE id = 3 AND stock > 0
  RETURNING id
)
INSERT INTO order_items (order_id, product_id, qty)
SELECT 107, id, 1 FROM dec;`,
    expect: { query: `SELECT (SELECT stock FROM products WHERE id = 3) AS stock, (SELECT count(*) FROM order_items WHERE order_id = 107 AND product_id = 3) AS items`, columns: ['stock', 'items'], rows: [['2', '1']], ordered: false },
    hints: ['UPDATE 的 RETURNING 可以當 CTE 的輸出；扣不到時 dec 是空的，INSERT … SELECT 就一列都不插。', 'WHERE id = 3 AND stock > 0 是關鍵，少了 stock > 0 就會超賣。'],
  },

  /* ---------- 讀寫分離：路由與 read-your-writes ---------- */
  {
    id: 'scaling-1', skill: 'scaling', kind: 'python', level: 3,
    title: '讀寫分離的路由：寫後一段時間讀主庫',
    prompt: '實作 `Router.route(user, op, now) -> str`：\n\n- `op == "write"` → 回 `"primary"`，並記住這個 user 最後一次寫的時間\n- `op == "read"` → 這個 user 在 `window` 秒內寫過（`now - last_write < window`）→ `"primary"`；否則依 round-robin 輪流回 `replicas` 裡的一台（全域輪流，不分 user）\n\n這就是「我剛存的怎麼不見了」的解法之一：寫後一小段時間內的讀都走主庫。',
    starter: `class Router:
    def __init__(self, replicas: list, window: float = 5.0):
        self.replicas = replicas
        self.window = window
        self.last_write = {}   # user -> now
        self.rr = 0            # round-robin 指標

    def route(self, user: str, op: str, now: float) -> str:
        # TODO
        return "primary"


r = Router(["replica-1", "replica-2"], window=5)
print(r.route("alice", "write", 0), r.route("alice", "read", 1), r.route("alice", "read", 6), r.route("bob", "read", 6))
`,
    solution: `class Router:
    def __init__(self, replicas: list, window: float = 5.0):
        self.replicas = replicas
        self.window = window
        self.last_write = {}   # user -> now
        self.rr = 0            # round-robin 指標

    def route(self, user: str, op: str, now: float) -> str:
        if op == "write":
            self.last_write[user] = now
            return "primary"
        last = self.last_write.get(user)
        if last is not None and now - last < self.window:
            return "primary"
        target = self.replicas[self.rr % len(self.replicas)]
        self.rr += 1
        return target


r = Router(["replica-1", "replica-2"], window=5)
print(r.route("alice", "write", 0), r.route("alice", "read", 1), r.route("alice", "read", 6), r.route("bob", "read", 6))
`,
    tests: [
      { name: '寫走主庫；寫後 window 內的讀也走主庫', code: `_r = Router(["r1", "r2"], window=5)\nassert _r.route("alice", "write", 0) == "primary"\nassert _r.route("alice", "read", 1) == "primary"\nassert _r.route("alice", "read", 4.9) == "primary"` },
      { name: 'window 過了就輪流讀副本', code: `_r = Router(["r1", "r2"], window=5)\n_r.route("alice", "write", 0)\nassert [_r.route("alice", "read", t) for t in (5, 6, 7)] == ["r1", "r2", "r1"]` },
      { name: '別的 user 不受影響、沒寫過的直接讀副本', code: `_r = Router(["r1", "r2"], window=5)\n_r.route("alice", "write", 0)\nassert _r.route("bob", "read", 0) == "r1"\nassert _r.route("alice", "read", 0) == "primary"\nassert _r.route("bob", "read", 0) == "r2"` },
    ],
    hints: ['write 只做兩件事：記時間、回 primary。', 'round-robin 用一個計數器：replicas[rr % len]，取完 rr += 1。'],
  },

  /* ---------- 邊緣快取：ETag / 304 / Cache-Control ---------- */
  {
    id: 'http-caching-1', skill: 'http-caching', kind: 'js', level: 2,
    title: 'ETag、304 與 Cache-Control',
    prompt: '實作 `respond(req, resource, { maxAge = 60, swr = 30 })`，`resource = { etag, body }`：\n\n- 回應一定帶 `headers.etag = resource.etag` 與 `headers[\'cache-control\'] = \'public, max-age=<maxAge>, stale-while-revalidate=<swr>\'`\n- 請求標頭 `if-none-match` 命中 etag → `{ status: 304, headers }`，**沒有 body**\n- `if-none-match` 可以是逗號分隔的多個值，也可能帶弱比對前綴 `W/`（`W/"abc"` 視同 `"abc"`）；`*` 一律命中\n- 沒命中 → `{ status: 200, headers, body: resource.body }`',
    starter: `function respond(req, resource, { maxAge = 60, swr = 30 } = {}) {
  const headers = { etag: resource.etag, 'cache-control': 'public, max-age=' + maxAge + ', stale-while-revalidate=' + swr }
  // TODO：看 req.headers['if-none-match'] 決定 304 還是 200
  return { status: 200, headers, body: resource.body }
}

console.log(respond({ headers: { 'if-none-match': '"v7"' } }, { etag: '"v7"', body: '...' }))
`,
    solution: `function respond(req, resource, { maxAge = 60, swr = 30 } = {}) {
  const headers = { etag: resource.etag, 'cache-control': 'public, max-age=' + maxAge + ', stale-while-revalidate=' + swr }
  const inm = req.headers?.['if-none-match']
  if (inm) {
    const tags = inm.split(',').map((t) => t.trim().replace(/^W\\//, ''))
    if (tags.includes('*') || tags.includes(resource.etag)) return { status: 304, headers }
  }
  return { status: 200, headers, body: resource.body }
}

console.log(respond({ headers: { 'if-none-match': '"v7"' } }, { etag: '"v7"', body: '...' }))
`,
    tests: [
      { name: '第一次：200 + 快取標頭', code: `assertEqual(respond({ headers: {} }, { etag: '"v7"', body: 'hello' }), { status: 200, headers: { etag: '"v7"', 'cache-control': 'public, max-age=60, stale-while-revalidate=30' }, body: 'hello' })\nassertEqual(respond({ headers: {} }, { etag: '"v7"', body: 'x' }, { maxAge: 5, swr: 0 }).headers['cache-control'], 'public, max-age=5, stale-while-revalidate=0')` },
      { name: 'ETag 命中：304、沒有 body', code: `const r = respond({ headers: { 'if-none-match': '"v7"' } }, { etag: '"v7"', body: 'hello' })\nassertEqual(r.status, 304)\nassertEqual(r.body, undefined)\nassertEqual(r.headers.etag, '"v7"')` },
      { name: '多個值、弱比對、星號', code: `assertEqual(respond({ headers: { 'if-none-match': '"v5", "v7"' } }, { etag: '"v7"', body: 'x' }).status, 304)\nassertEqual(respond({ headers: { 'if-none-match': 'W/"v7"' } }, { etag: '"v7"', body: 'x' }).status, 304)\nassertEqual(respond({ headers: { 'if-none-match': '*' } }, { etag: '"v7"', body: 'x' }).status, 304)\nassertEqual(respond({ headers: { 'if-none-match': '"v6"' } }, { etag: '"v7"', body: 'x' }).status, 200)` },
    ],
    hints: ['split(",") 之後 trim，再把開頭的 W/ 去掉，看陣列裡有沒有 "*" 或 resource.etag。', '304 的物件不要有 body 這個 key（undefined 也算有），直接回 { status, headers }。'],
  },
]

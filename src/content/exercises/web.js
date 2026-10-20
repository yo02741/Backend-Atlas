// 程式題：網路、HTTP 與 API 設計（JavaScript 在瀏覽器 Worker 裡執行）
export default [
  {
    id: 'http-basics-1', skill: 'http-basics', kind: 'js', level: 1,
    title: '解析一段原始 HTTP 請求',
    prompt: '實作 `parseRequest(raw)`：把原始 HTTP 請求文字解析成 `{ method, path, headers, body }`。\n\n- 第一行是 `METHOD PATH HTTP/1.1`\n- 標頭一行一個 `Name: value`，key 轉成**小寫**、value 去頭尾空白\n- 空行之後全部是 body（可能沒有，回空字串）\n- 行尾是 `\\r\\n`',
    starter: `function parseRequest(raw) {
  // TODO
  return { method: '', path: '', headers: {}, body: '' }
}

const raw = 'POST /orders HTTP/1.1\\r\\nHost: api.example.com\\r\\nContent-Type: application/json\\r\\n\\r\\n{"item":"鍵盤"}'
console.log(parseRequest(raw))
`,
    solution: `function parseRequest(raw) {
  const sep = raw.indexOf('\\r\\n\\r\\n')
  const head = sep === -1 ? raw : raw.slice(0, sep)
  const body = sep === -1 ? '' : raw.slice(sep + 4)
  const [requestLine, ...headerLines] = head.split('\\r\\n')
  const [method, path] = requestLine.split(' ')
  const headers = {}
  for (const line of headerLines) {
    if (!line) continue
    const i = line.indexOf(':')
    headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
  }
  return { method, path, headers, body }
}

const raw = 'POST /orders HTTP/1.1\\r\\nHost: api.example.com\\r\\nContent-Type: application/json\\r\\n\\r\\n{"item":"鍵盤"}'
console.log(parseRequest(raw))
`,
    tests: [
      { name: 'GET 無 body', code: `const r = parseRequest('GET /users/1?x=1 HTTP/1.1\\r\\nHost: api.example.com\\r\\nAccept: application/json\\r\\n\\r\\n')\nassertEqual(r, { method: 'GET', path: '/users/1?x=1', headers: { host: 'api.example.com', accept: 'application/json' }, body: '' })` },
      { name: 'POST 帶 JSON body', code: `const r = parseRequest('POST /orders HTTP/1.1\\r\\nHost: a\\r\\nContent-Type: application/json\\r\\n\\r\\n{"item":"鍵盤"}')\nassertEqual(r.method, 'POST')\nassertEqual(r.headers['content-type'], 'application/json')\nassertEqual(JSON.parse(r.body), { item: '鍵盤' })` },
      { name: 'header 值含冒號也要對', code: `const r = parseRequest('GET / HTTP/1.1\\r\\nAuthorization: Bearer abc:def\\r\\n\\r\\n')\nassertEqual(r.headers.authorization, 'Bearer abc:def')` },
    ],
    hints: ['先用 indexOf("\\r\\n\\r\\n") 把 head 與 body 切開。', '標頭只切第一個冒號：indexOf(":") 而不是 split(":")。'],
  },
  {
    id: 'api-patterns-1', skill: 'api-patterns', kind: 'js', level: 2,
    title: 'cursor 分頁',
    prompt: '實作 `page(items, limit, cursor)`：`items` 已依 `id` 遞增排序。`cursor` 是上一頁最後一筆 id 的 base64（`btoa(String(id))`），第一頁為 `null`。回傳 `{ items, next_cursor }`：取 id **大於** cursor 的前 `limit` 筆；還有下一頁才給 `next_cursor`，否則 `null`。',
    starter: `function page(items, limit, cursor = null) {
  // TODO
  return { items: items.slice(0, limit), next_cursor: null }
}

const all = [1, 2, 3, 4, 5].map((id) => ({ id, name: 'item' + id }))
const p1 = page(all, 2)
console.log(p1)
console.log(page(all, 2, p1.next_cursor))
`,
    solution: `function page(items, limit, cursor = null) {
  const after = cursor === null ? -Infinity : Number(atob(cursor))
  const rest = items.filter((it) => it.id > after)
  const slice = rest.slice(0, limit)
  const hasMore = rest.length > limit
  return { items: slice, next_cursor: hasMore ? btoa(String(slice[slice.length - 1].id)) : null }
}

const all = [1, 2, 3, 4, 5].map((id) => ({ id, name: 'item' + id }))
const p1 = page(all, 2)
console.log(p1)
console.log(page(all, 2, p1.next_cursor))
`,
    tests: [
      { name: '第一頁', code: `const all = [1, 2, 3, 4, 5].map((id) => ({ id }))\nconst p = page(all, 2)\nassertEqual(p.items.map((i) => i.id), [1, 2])\nassertEqual(p.next_cursor, btoa('2'))` },
      { name: '用 cursor 翻頁', code: `const all = [1, 2, 3, 4, 5].map((id) => ({ id }))\nconst p = page(all, 2, btoa('2'))\nassertEqual(p.items.map((i) => i.id), [3, 4])\nassertEqual(p.next_cursor, btoa('4'))` },
      { name: '最後一頁 next_cursor 為 null', code: `const all = [1, 2, 3, 4, 5].map((id) => ({ id }))\nassertEqual(page(all, 2, btoa('4')), { items: [{ id: 5 }], next_cursor: null })\nassertEqual(page(all, 5), { items: all, next_cursor: null })` },
    ],
    hints: ['atob / btoa 在 Worker 裡可以直接用。', '「還有下一頁」要看「大於 cursor 的筆數」是否超過 limit，不能只看這頁滿不滿。'],
  },
  {
    id: 'tcp-connections-1', skill: 'tcp-connections', kind: 'python', level: 1,
    title: '有上限、會淘汰閒置連線的連線池',
    prompt: '實作 `Pool` 的 `acquire()` 與 `release()`。`connect()` 建立一條新連線（有 `.close()`），`clock()` 回傳目前秒數（測試用假時間）。\n\n- `acquire()`：先從閒置連線中拿**最近歸還**的那一條重用；閒置超過 `idle_timeout` 秒（`clock() - 歸還時間 >= idle_timeout`）的連線要 `close()` 並丟掉，不能借出\n- 沒有可重用的：總數（閒置 + 借出中）小於 `max_size` 才新建，否則丟 `PoolExhausted`\n- `release(conn, broken=False)`：歸還並記下歸還時間；`broken=True` 代表連線已壞，`close()` 掉、不放回池子\n- `self.created` 記錄總共新建了幾條',
    starter: `class PoolExhausted(Exception):
    pass


class Pool:
    def __init__(self, connect, max_size, idle_timeout, clock):
        self.connect = connect
        self.max_size = max_size
        self.idle_timeout = idle_timeout
        self.clock = clock
        self.idle = []        # [(conn, released_at)]
        self.in_use = set()
        self.created = 0

    def acquire(self):
        # TODO：重用閒置連線、淘汰過期的、檢查上限
        conn = self.connect()
        self.created += 1
        self.in_use.add(conn)
        return conn

    def release(self, conn, broken=False):
        # TODO
        self.in_use.discard(conn)


class FakeConn:
    def __init__(self, n):
        self.n = n
        self.closed = False

    def close(self):
        self.closed = True


now = [0.0]
counter = [0]
def connect():
    counter[0] += 1
    return FakeConn(counter[0])

pool = Pool(connect, max_size=2, idle_timeout=30, clock=lambda: now[0])
c = pool.acquire()
pool.release(c)
print("第二次借到的是同一條嗎？", pool.acquire() is c, "新建了", pool.created, "條")
`,
    solution: `class PoolExhausted(Exception):
    pass


class Pool:
    def __init__(self, connect, max_size, idle_timeout, clock):
        self.connect = connect
        self.max_size = max_size
        self.idle_timeout = idle_timeout
        self.clock = clock
        self.idle = []        # [(conn, released_at)]
        self.in_use = set()
        self.created = 0

    def acquire(self):
        now = self.clock()
        # 從最近歸還的開始找（LIFO），過期的關掉丟棄
        while self.idle:
            conn, released_at = self.idle.pop()
            if now - released_at >= self.idle_timeout:
                conn.close()
                continue
            self.in_use.add(conn)
            return conn
        if len(self.in_use) + len(self.idle) >= self.max_size:
            raise PoolExhausted(f"pool full ({self.max_size})")
        conn = self.connect()
        self.created += 1
        self.in_use.add(conn)
        return conn

    def release(self, conn, broken=False):
        self.in_use.discard(conn)
        if broken:
            conn.close()
            return
        self.idle.append((conn, self.clock()))


class FakeConn:
    def __init__(self, n):
        self.n = n
        self.closed = False

    def close(self):
        self.closed = True


now = [0.0]
counter = [0]
def connect():
    counter[0] += 1
    return FakeConn(counter[0])

pool = Pool(connect, max_size=2, idle_timeout=30, clock=lambda: now[0])
c = pool.acquire()
pool.release(c)
print("第二次借到的是同一條嗎？", pool.acquire() is c, "新建了", pool.created, "條")
`,
    tests: [
      { name: '歸還後重用同一條連線', code: `_t = [0.0]\n_p = Pool(lambda: FakeConn(0), max_size=3, idle_timeout=30, clock=lambda: _t[0])\nfor _ in range(5):\n    _c = _p.acquire()\n    _p.release(_c)\n    _t[0] += 1\nassert _p.created == 1, f"借還 5 次應只新建 1 條，實際 {_p.created}"` },
      { name: '超過上限丟 PoolExhausted', code: `_p = Pool(lambda: FakeConn(0), max_size=2, idle_timeout=30, clock=lambda: 0)\n_a = _p.acquire(); _b = _p.acquire()\ntry:\n    _p.acquire()\n    assert False, "第 3 條應該丟 PoolExhausted"\nexcept PoolExhausted:\n    pass\n_p.release(_a)\nassert _p.acquire() is _a, "歸還後應能再借到"` },
      { name: '閒置過久的連線關掉不借出', code: `_t = [0.0]\n_p = Pool(lambda: FakeConn(0), max_size=2, idle_timeout=30, clock=lambda: _t[0])\n_a = _p.acquire(); _p.release(_a)\n_t[0] = 30\n_b = _p.acquire()\nassert _b is not _a and _a.closed, "閒置滿 30 秒的連線要 close 並換新的"\nassert _p.created == 2` },
      { name: '優先重用最近歸還的', code: `_t = [0.0]\n_p = Pool(lambda: FakeConn(0), max_size=3, idle_timeout=30, clock=lambda: _t[0])\n_a = _p.acquire(); _b = _p.acquire()\n_p.release(_a); _t[0] = 5; _p.release(_b)\nassert _p.acquire() is _b` },
      { name: '壞掉的連線不放回池子、不佔名額', code: `_p = Pool(lambda: FakeConn(0), max_size=1, idle_timeout=30, clock=lambda: 0)\n_a = _p.acquire()\n_p.release(_a, broken=True)\nassert _a.closed\n_b = _p.acquire()\nassert _b is not _a and _p.created == 2` },
    ],
    hints: ['閒置清單當堆疊用：append 歸還、pop 取出，就是「最近歸還的優先」。', '過期判斷用 `clock() - released_at >= idle_timeout`；過期的要 close 後繼續往下找。', '上限算的是「閒置 + 借出中」的總數。'],
  },
  {
    id: 'resilience-1', skill: 'resilience', kind: 'python', level: 2,
    title: '指數退避 + 抖動 + 次數上限的重試',
    prompt: '實作 `retry(fn, attempts, base, cap, retryable, sleep, rand)`：\n\n- 最多呼叫 `fn()` 共 `attempts` 次，成功就回傳結果\n- `fn()` 丟例外 `e` 時：`retryable(e)` 為 False 就**立刻**重新丟出；已經是最後一次也重新丟出\n- 否則等待 `rand() * min(cap, base * 2 ** i)` 秒再試（`i` 是第幾次失敗，從 0 開始；這是 full jitter），等待用 `sleep(delay)`\n\n`sleep` 與 `rand` 由參數傳入，測試會用假的來記錄等待時間。',
    starter: `import random, time


def retry(fn, attempts=4, base=0.5, cap=8.0, retryable=lambda e: True, sleep=time.sleep, rand=random.random):
    # TODO：失敗時退避重試
    return fn()


calls = []
def flaky():
    calls.append(1)
    if len(calls) < 3:
        raise TimeoutError("upstream timeout")
    return "ok"

waits = []
print(retry(flaky, sleep=waits.append, rand=lambda: 1.0), waits)
`,
    solution: `import random, time


def retry(fn, attempts=4, base=0.5, cap=8.0, retryable=lambda e: True, sleep=time.sleep, rand=random.random):
    for i in range(attempts):
        try:
            return fn()
        except Exception as e:
            if not retryable(e) or i == attempts - 1:
                raise
            sleep(rand() * min(cap, base * 2 ** i))


calls = []
def flaky():
    calls.append(1)
    if len(calls) < 3:
        raise TimeoutError("upstream timeout")
    return "ok"

waits = []
print(retry(flaky, sleep=waits.append, rand=lambda: 1.0), waits)
`,
    tests: [
      { name: '失敗兩次後成功', code: `_n = [0]\ndef _f():\n    _n[0] += 1\n    if _n[0] < 3:\n        raise TimeoutError()\n    return "ok"\n_w = []\nassert retry(_f, sleep=_w.append, rand=lambda: 1.0) == "ok"\nassert _w == [0.5, 1.0], _w` },
      { name: '用完次數就丟出最後的例外', code: `_n = [0]\ndef _f():\n    _n[0] += 1\n    raise ConnectionError(f"第 {_n[0]} 次")\n_w = []\ntry:\n    retry(_f, attempts=4, sleep=_w.append, rand=lambda: 1.0)\n    assert False, "應該丟出例外"\nexcept ConnectionError as e:\n    assert str(e) == "第 4 次", str(e)\nassert _n[0] == 4 and _w == [0.5, 1.0, 2.0], (_n, _w)` },
      { name: '等待時間有上限 cap', code: `def _f():\n    raise TimeoutError()\n_w = []\ntry:\n    retry(_f, attempts=6, base=1, cap=5, sleep=_w.append, rand=lambda: 1.0)\nexcept TimeoutError:\n    pass\nassert _w == [1, 2, 4, 5, 5], _w` },
      { name: '抖動：乘上 rand()', code: `_n = [0]\ndef _f():\n    _n[0] += 1\n    if _n[0] < 3:\n        raise TimeoutError()\n    return 1\n_w = []\nretry(_f, sleep=_w.append, rand=lambda: 0.25)\nassert _w == [0.125, 0.25], _w` },
      { name: '不可重試的錯誤立刻丟出、不等待', code: `_n = [0]\ndef _f():\n    _n[0] += 1\n    raise ValueError("400 Bad Request")\n_w = []\ntry:\n    retry(_f, retryable=lambda e: not isinstance(e, ValueError), sleep=_w.append, rand=lambda: 1.0)\n    assert False\nexcept ValueError:\n    pass\nassert _n[0] == 1 and _w == [], (_n, _w)` },
    ],
    hints: ['用 `for i in range(attempts)` 包 try / except。', '在 except 裡判斷「不可重試或最後一次」就 `raise`（不帶參數會重新丟出原本的例外）。', '等待時間：`rand() * min(cap, base * 2 ** i)`。'],
  },
  {
    id: 'openapi-1', skill: 'openapi', kind: 'python', level: 2,
    title: '檢查 OpenAPI 規格的常見錯誤',
    prompt: '實作 `lint(spec) -> set`，檢查 `spec["paths"]` 裡每個操作（`get` `put` `post` `delete` `patch` `head` `options` `trace`），回傳 `(規則, 方法大寫, 路徑)` 的集合：\n\n- `"missing-operation-id"`：沒有 `operationId`\n- `"duplicate-operation-id"`：`operationId` 與**先前**出現過的重複（依 paths 與方法的出現順序，第一次出現的不算）\n- `"undeclared-path-param"`：路徑裡的 `{name}` 沒有對應的 `in: "path"` 參數（路徑層級的 `parameters` 與操作層級的都算）\n- `"path-param-not-required"`：有宣告的路徑參數沒有 `required: True`\n- `"no-success-response"`：`responses` 裡沒有任何以 `2` 開頭的狀態碼',
    starter: `METHODS = ["get", "put", "post", "delete", "patch", "head", "options", "trace"]


def lint(spec: dict) -> set:
    problems = set()
    # TODO
    return problems


spec = {
    "openapi": "3.1.0",
    "paths": {
        "/orders/{order_id}": {
            "get": {"operationId": "getOrder", "responses": {"200": {"description": "ok"}}},
            "delete": {"responses": {"204": {"description": "deleted"}}},
        }
    },
}
print(lint(spec))
`,
    solution: `METHODS = ["get", "put", "post", "delete", "patch", "head", "options", "trace"]


def path_params(path: str) -> list:
    # "/orders/{order_id}/items/{item_id}" -> ["order_id", "item_id"]
    return [seg[1:-1] for seg in path.split("/") if seg.startswith("{") and seg.endswith("}")]


def lint(spec: dict) -> set:
    problems = set()
    seen_ids = set()
    for path, item in spec.get("paths", {}).items():
        shared = item.get("parameters", [])
        for method in METHODS:
            op = item.get(method)
            if op is None:
                continue
            key = (method.upper(), path)
            op_id = op.get("operationId")
            if not op_id:
                problems.add(("missing-operation-id", *key))
            elif op_id in seen_ids:
                problems.add(("duplicate-operation-id", *key))
            else:
                seen_ids.add(op_id)
            declared = {p["name"]: p for p in shared + op.get("parameters", []) if p.get("in") == "path"}
            for name in path_params(path):
                if name not in declared:
                    problems.add(("undeclared-path-param", *key))
                elif declared[name].get("required") is not True:
                    problems.add(("path-param-not-required", *key))
            if not any(str(code).startswith("2") for code in op.get("responses", {})):
                problems.add(("no-success-response", *key))
    return problems


spec = {
    "openapi": "3.1.0",
    "paths": {
        "/orders/{order_id}": {
            "get": {"operationId": "getOrder", "responses": {"200": {"description": "ok"}}},
            "delete": {"responses": {"204": {"description": "deleted"}}},
        }
    },
}
print(lint(spec))
`,
    tests: [
      { name: '正確的規格沒有問題', code: `_p = {"name": "order_id", "in": "path", "required": True, "schema": {"type": "integer"}}\n_s = {"paths": {"/orders": {"get": {"operationId": "listOrders", "responses": {"200": {}}}, "post": {"operationId": "createOrder", "responses": {"201": {}, "422": {}}}}, "/orders/{order_id}": {"parameters": [_p], "get": {"operationId": "getOrder", "responses": {"200": {}, "404": {}}}}}}\nassert lint(_s) == set(), lint(_s)` },
      { name: '缺 operationId 與重複 operationId', code: `_s = {"paths": {"/a": {"get": {"operationId": "x", "responses": {"200": {}}}, "post": {"responses": {"201": {}}}}, "/b": {"get": {"operationId": "x", "responses": {"200": {}}}}}}\nassert lint(_s) == {("missing-operation-id", "POST", "/a"), ("duplicate-operation-id", "GET", "/b")}, lint(_s)` },
      { name: '路徑參數沒宣告或不是 required', code: `_s = {"paths": {"/users/{uid}/orders/{oid}": {"get": {"operationId": "g", "parameters": [{"name": "uid", "in": "path", "required": True}, {"name": "oid", "in": "query", "required": True}], "responses": {"200": {}}}}, "/users/{uid}": {"get": {"operationId": "h", "parameters": [{"name": "uid", "in": "path"}], "responses": {"200": {}}}}}}\nassert lint(_s) == {("undeclared-path-param", "GET", "/users/{uid}/orders/{oid}"), ("path-param-not-required", "GET", "/users/{uid}")}, lint(_s)` },
      { name: '沒有 2xx 回應；2XX 範圍寫法也算', code: `_s = {"paths": {"/a": {"delete": {"operationId": "d", "responses": {"404": {}, "default": {}}}}, "/b": {"get": {"operationId": "b", "responses": {"2XX": {}}}}}}\nassert lint(_s) == {("no-success-response", "DELETE", "/a")}, lint(_s)` },
      { name: '路徑層級的 parameters 不是操作', code: `_s = {"paths": {"/a/{id}": {"parameters": [{"name": "id", "in": "path", "required": True}], "summary": "x"}}}\nassert lint(_s) == set(), lint(_s)` },
    ],
    hints: ['路徑參數可以用 `path.split("/")` 找出 `{` 開頭、`}` 結尾的段落。', '路徑層級的 `parameters` 要和操作層級的合併後再檢查。', '只走 METHODS 清單裡的 key，`parameters`、`summary` 不是操作。'],
  },
  {
    id: 'tls-dns-1', skill: 'tls-dns', kind: 'python', level: 2,
    title: '檢查憑證：效期與 SAN 是否涵蓋網域',
    prompt: '實作兩個函式：\n\n**`name_matches(pattern, host)`**：憑證 SAN 裡的一個名稱是否涵蓋 `host`。不分大小寫、忽略結尾的 `.`。萬用字元只有一種合法形式：最左邊的 label **整個**是 `*`，而且後面至少還有兩個 label（`*.example.com` 可以，`*.com` 不行）；`*` 只涵蓋**一層** label（涵蓋 `api.example.com`，不涵蓋 `example.com` 與 `a.b.example.com`）。其他位置的 `*` 不當萬用字元。\n\n**`cert_problems(cert, host, now, warn_days=14)`**：回傳問題清單（依此順序）：\n- `"not-yet-valid"`：`now < not_before`\n- `"expired"`：`now > not_after`\n- `"expiring-soon"`：沒過期，但 `not_after - now` 小於 `warn_days` 天\n- `"name-mismatch"`：`san` 裡沒有任何名稱涵蓋 `host`（不看 CN）',
    starter: `from datetime import datetime, timedelta, timezone


def name_matches(pattern: str, host: str) -> bool:
    # TODO：萬用字元規則
    return pattern.lower() == host.lower()


def cert_problems(cert: dict, host: str, now: datetime, warn_days: int = 14) -> list:
    # TODO
    return []


UTC = timezone.utc
cert = {
    "not_before": datetime(2026, 9, 1, tzinfo=UTC),
    "not_after": datetime(2026, 11, 30, tzinfo=UTC),
    "san": ["example.org", "*.example.org"],
}
print(cert_problems(cert, "api.example.org", datetime(2026, 11, 25, tzinfo=UTC)))
`,
    solution: `from datetime import datetime, timedelta, timezone


def name_matches(pattern: str, host: str) -> bool:
    p = pattern.lower().rstrip(".").split(".")
    h = host.lower().rstrip(".").split(".")
    if p[0] == "*" and len(p) >= 3:
        # 萬用字元只換掉最左邊一層：label 數要相同，其餘逐一相等
        return len(h) == len(p) and h[0] != "" and h[1:] == p[1:]
    return p == h


def cert_problems(cert: dict, host: str, now: datetime, warn_days: int = 14) -> list:
    problems = []
    if now < cert["not_before"]:
        problems.append("not-yet-valid")
    if now > cert["not_after"]:
        problems.append("expired")
    elif cert["not_after"] - now < timedelta(days=warn_days):
        problems.append("expiring-soon")
    if not any(name_matches(n, host) for n in cert.get("san", [])):
        problems.append("name-mismatch")
    return problems


UTC = timezone.utc
cert = {
    "not_before": datetime(2026, 9, 1, tzinfo=UTC),
    "not_after": datetime(2026, 11, 30, tzinfo=UTC),
    "san": ["example.org", "*.example.org"],
}
print(cert_problems(cert, "api.example.org", datetime(2026, 11, 25, tzinfo=UTC)))
`,
    tests: [
      { name: '完全相符：不分大小寫、忽略結尾的點', code: `assert name_matches("Example.ORG", "example.org.")\nassert not name_matches("example.org", "www.example.org")` },
      { name: '萬用字元只涵蓋一層', code: `assert name_matches("*.example.org", "api.example.org")\nassert not name_matches("*.example.org", "example.org"), "*.example.org 不涵蓋 example.org 本身"\nassert not name_matches("*.example.org", "a.b.example.org"), "萬用字元只涵蓋一層"` },
      { name: '不合法的萬用字元不生效', code: `assert not name_matches("*.org", "example.org"), "*.org 太寬，不當萬用字元"\nassert not name_matches("api.*.org", "api.example.org")\nassert not name_matches("a*.example.org", "api.example.org")` },
      { name: '效期：未生效、已過期、快過期', code: `_U = timezone.utc\n_c = {"not_before": datetime(2026, 9, 1, tzinfo=_U), "not_after": datetime(2026, 11, 30, tzinfo=_U), "san": ["example.org"]}\nassert cert_problems(_c, "example.org", datetime(2026, 8, 31, tzinfo=_U)) == ["not-yet-valid"]\nassert cert_problems(_c, "example.org", datetime(2026, 12, 1, tzinfo=_U)) == ["expired"]\nassert cert_problems(_c, "example.org", datetime(2026, 11, 20, tzinfo=_U)) == ["expiring-soon"]\nassert cert_problems(_c, "example.org", datetime(2026, 10, 1, tzinfo=_U)) == []` },
      { name: '名稱不符與多個問題的順序', code: `_U = timezone.utc\n_c = {"not_before": datetime(2026, 9, 1, tzinfo=_U), "not_after": datetime(2026, 11, 30, tzinfo=_U), "san": ["example.org", "*.example.org"]}\nassert cert_problems(_c, "shop.example.net", datetime(2026, 12, 5, tzinfo=_U)) == ["expired", "name-mismatch"]\nassert cert_problems(_c, "api.example.org", datetime(2026, 10, 1, tzinfo=_U)) == []` },
    ],
    hints: ['先把 pattern 與 host 都轉小寫、去掉結尾的點，再用 `.` 切成 label。', '合法萬用字元：`p[0] == "*"` 且 `len(p) >= 3`；這時 label 數要相同、除了第一個以外逐一相等。', '`datetime` 相減得到 `timedelta`，可以直接和 `timedelta(days=14)` 比較。'],
  },
  {
    id: 'realtime-choice-1', skill: 'realtime-choice', kind: 'js', level: 2,
    title: '照規格解析 Server-Sent Events',
    prompt: '實作 `parseSSE(text)`，回傳 `{ events, lastEventId, retry }`：\n\n- 行尾可能是 `\\n`、`\\r\\n` 或 `\\r`\n- 冒號開頭的行是註解，忽略\n- 有冒號：冒號前是欄位名、後面是值，值開頭的**一個**空白去掉；沒有冒號：整行是欄位名、值為空字串\n- `data`：把值加上 `\\n` 接到資料緩衝；`event`：設定事件類型；`id`：設定 lastEventId（會一直保留到下次被改）；`retry`：值全是數字時設成整數；其他欄位忽略\n- **空行**送出事件：資料緩衝是空的就不送；否則去掉最後一個 `\\n`，送出 `{ type, data, id }`（`type` 沒設定時是 `"message"`，`id` 是當下的 lastEventId，沒有就是 `""`），然後清空資料緩衝與事件類型\n- 結尾沒有空行的最後一段不送出\n- `retry` 沒出現過就是 `null`',
    starter: `function parseSSE(text) {
  const events = []
  // TODO
  return { events, lastEventId: '', retry: null }
}

const stream = ': 心跳\\n\\nid: 7\\nevent: progress\\ndata: {"progress": 40}\\n\\ndata: 第一行\\ndata: 第二行\\n\\n'
console.log(parseSSE(stream))
`,
    solution: `function parseSSE(text) {
  const events = []
  let data = ''
  let type = ''
  let lastEventId = ''
  let retry = null
  for (const line of text.split(/\\r\\n|\\r|\\n/)) {
    if (line === '') {
      if (data !== '') {
        events.push({ type: type || 'message', data: data.slice(0, -1), id: lastEventId })
      }
      data = ''
      type = ''
      continue
    }
    if (line.startsWith(':')) continue
    const i = line.indexOf(':')
    const field = i === -1 ? line : line.slice(0, i)
    let value = i === -1 ? '' : line.slice(i + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') data += value + '\\n'
    else if (field === 'event') type = value
    else if (field === 'id') lastEventId = value
    else if (field === 'retry' && /^\\d+$/.test(value)) retry = Number(value)
  }
  return { events, lastEventId, retry }
}

const stream = ': 心跳\\n\\nid: 7\\nevent: progress\\ndata: {"progress": 40}\\n\\ndata: 第一行\\ndata: 第二行\\n\\n'
console.log(parseSSE(stream))
`,
    tests: [
      { name: '單一事件，預設類型 message', code: `const r = parseSSE('data: hello\\n\\n')\nassertEqual(r.events, [{ type: 'message', data: 'hello', id: '' }])` },
      { name: 'event、id 與多行 data', code: `const r = parseSSE('id: 7\\nevent: progress\\ndata: a\\ndata: b\\n\\n')\nassertEqual(r.events, [{ type: 'progress', data: 'a\\nb', id: '7' }])\nassertEqual(r.lastEventId, '7')` },
      { name: 'id 保留到下一個事件；event 每次重設', code: `const r = parseSSE('id: 1\\nevent: x\\ndata: a\\n\\ndata: b\\n\\n')\nassertEqual(r.events, [{ type: 'x', data: 'a', id: '1' }, { type: 'message', data: 'b', id: '1' }])` },
      { name: '註解、空資料、未結束的最後一段', code: `const r = parseSSE(': ping\\n\\nevent: lonely\\n\\ndata: ok\\n\\ndata: 還沒結束')\nassertEqual(r.events, [{ type: 'message', data: 'ok', id: '' }])` },
      { name: '只去掉一個空白；沒有冒號的行', code: `const r = parseSSE('data:  two spaces\\ndata\\ndata:x\\n\\n')\nassertEqual(r.events[0].data, ' two spaces\\n\\nx')` },
      { name: 'CRLF / CR 行尾與 retry', code: `const r = parseSSE('retry: 3000\\r\\ndata: a\\r\\n\\r\\nretry: abc\\rdata: b\\r\\r')\nassertEqual(r.events.map((e) => e.data), ['a', 'b'])\nassertEqual(r.retry, 3000)` },
    ],
    hints: ['先用正規表示式 `/\\r\\n|\\r|\\n/` 切行（`\\r\\n` 要放最前面）。', '欄位名與值用第一個冒號切開，值開頭只去掉一個空白。', '資料緩衝每行都加 `\\n`，送出時去掉最後一個。'],
  },
  {
    id: 'beyond-rest-1', skill: 'beyond-rest', kind: 'python', level: 2,
    title: '驗證 Webhook：簽章、時間與去重',
    prompt: '實作 `verify_webhook(secret, headers, body, now, seen) -> str`。發送方的簽章是 `sign(secret, timestamp, body)`（已提供）：對 `"{timestamp}." + body` 做 HMAC-SHA256，放在 `x-signature: sha256=<hex>`，時間戳在 `x-timestamp`。依序檢查：\n\n1. 缺標頭、`x-timestamp` 不是整數、`x-signature` 沒有 `sha256=` 前綴、或簽章不符（用 `hmac.compare_digest`）→ `"bad-signature"`\n2. `abs(now - timestamp) > 300` → `"stale"`（擋重放）\n3. body 的 JSON `id` 已在 `seen` 裡 → `"duplicate"`\n4. 否則把 `id` 加進 `seen`，回傳 `"ok"`\n\n簽章要在解析 JSON **之前**驗。',
    starter: `import hashlib, hmac, json


def sign(secret: bytes, timestamp: int, body: bytes) -> str:
    return hmac.new(secret, f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()


def verify_webhook(secret: bytes, headers: dict, body: bytes, now: int, seen: set) -> str:
    # TODO
    return "ok"


secret = b"whsec_demo"
body = b'{"id": "evt_1", "type": "payment.succeeded", "order_id": 42}'
headers = {"x-timestamp": "1700000000", "x-signature": "sha256=" + sign(secret, 1700000000, body)}
seen = set()
print(verify_webhook(secret, headers, body, 1700000010, seen))
print(verify_webhook(secret, headers, body, 1700000020, seen))
`,
    solution: `import hashlib, hmac, json


def sign(secret: bytes, timestamp: int, body: bytes) -> str:
    return hmac.new(secret, f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()


def verify_webhook(secret: bytes, headers: dict, body: bytes, now: int, seen: set) -> str:
    ts_raw = headers.get("x-timestamp")
    sig = headers.get("x-signature", "")
    if ts_raw is None or not sig.startswith("sha256="):
        return "bad-signature"
    try:
        ts = int(ts_raw)
    except ValueError:
        return "bad-signature"
    if not hmac.compare_digest(sign(secret, ts, body), sig[len("sha256="):]):
        return "bad-signature"
    if abs(now - ts) > 300:
        return "stale"
    event_id = json.loads(body)["id"]
    if event_id in seen:
        return "duplicate"
    seen.add(event_id)
    return "ok"


secret = b"whsec_demo"
body = b'{"id": "evt_1", "type": "payment.succeeded", "order_id": 42}'
headers = {"x-timestamp": "1700000000", "x-signature": "sha256=" + sign(secret, 1700000000, body)}
seen = set()
print(verify_webhook(secret, headers, body, 1700000010, seen))
print(verify_webhook(secret, headers, body, 1700000020, seen))
`,
    tests: [
      { name: '正確的簽章回 ok', code: `_b = b'{"id": "evt_9"}'\n_h = {"x-timestamp": "1000", "x-signature": "sha256=" + sign(b"k", 1000, _b)}\n_s = set()\nassert verify_webhook(b"k", _h, _b, 1010, _s) == "ok"\nassert "evt_9" in _s` },
      { name: '內容被改、secret 不同、格式不對都是 bad-signature', code: `_b = b'{"id": "evt_9", "amount": 100}'\n_h = {"x-timestamp": "1000", "x-signature": "sha256=" + sign(b"k", 1000, _b)}\nassert verify_webhook(b"k", _h, b'{"id": "evt_9", "amount": 1}', 1000, set()) == "bad-signature"\nassert verify_webhook(b"other", _h, _b, 1000, set()) == "bad-signature"\nassert verify_webhook(b"k", {"x-timestamp": "1000", "x-signature": sign(b"k", 1000, _b)}, _b, 1000, set()) == "bad-signature"\nassert verify_webhook(b"k", {"x-signature": _h["x-signature"]}, _b, 1000, set()) == "bad-signature"\nassert verify_webhook(b"k", {"x-timestamp": "abc", "x-signature": _h["x-signature"]}, _b, 1000, set()) == "bad-signature"` },
      { name: '改了時間戳，簽章就不符', code: `_b = b'{"id": "e"}'\n_h = {"x-timestamp": "2000", "x-signature": "sha256=" + sign(b"k", 1000, _b)}\nassert verify_webhook(b"k", _h, _b, 2000, set()) == "bad-signature"` },
      { name: '超過 5 分鐘是 stale', code: `_b = b'{"id": "e"}'\n_h = {"x-timestamp": "1000", "x-signature": "sha256=" + sign(b"k", 1000, _b)}\nassert verify_webhook(b"k", _h, _b, 1301, set()) == "stale"\nassert verify_webhook(b"k", _h, _b, 699, set()) == "stale"\nassert verify_webhook(b"k", _h, _b, 1300, set()) == "ok"` },
      { name: '同一個事件第二次是 duplicate', code: `_b = b'{"id": "evt_x"}'\n_h = {"x-timestamp": "1000", "x-signature": "sha256=" + sign(b"k", 1000, _b)}\n_s = set()\nassert verify_webhook(b"k", _h, _b, 1000, _s) == "ok"\nassert verify_webhook(b"k", _h, _b, 1001, _s) == "duplicate"` },
      { name: '簽章不符時不解析 body', code: `_h = {"x-timestamp": "1000", "x-signature": "sha256=" + "0" * 64}\nassert verify_webhook(b"k", _h, b"not json", 1000, set()) == "bad-signature"` },
    ],
    hints: ['先處理標頭缺漏與格式，`int()` 失敗要接住。', '用 `sign(secret, ts, body)` 重算，與 `sha256=` 後面的部分用 `hmac.compare_digest` 比對。', '去重要在簽章與時間都通過之後才記錄，否則攻擊者可以用假請求佔掉事件 id。'],
  },
]

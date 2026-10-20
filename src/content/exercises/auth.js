// 程式題：驗證與授權
export default [
  {
    id: 'jwt-1', skill: 'jwt', kind: 'python', level: 2,
    title: '自己驗一次 JWT 簽章',
    prompt: '實作 `verify(token, secret, now=None) -> dict | None`：\n\n1. 用 `.` 拆成三段，格式不對回 `None`（不要拋例外）\n2. 用 `sign()` 重算簽章，與第三段比對（用 `hmac.compare_digest`）\n3. 解碼 payload（JSON）；若有 `exp` 且 `exp <= now`（`now` 預設 `time.time()`）回 `None`\n4. 通過就回傳 payload dict\n\n`make_token` 已經幫你寫好，可以用來產生測試用的 token。',
    starter: `import base64, hmac, hashlib, json, time


def b64url_encode(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def b64url_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def sign(header_b64: str, payload_b64: str, secret: str) -> str:
    msg = f"{header_b64}.{payload_b64}".encode()
    return b64url_encode(hmac.new(secret.encode(), msg, hashlib.sha256).digest())


def make_token(payload: dict, secret: str) -> str:
    h = b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    p = b64url_encode(json.dumps(payload, separators=(",", ":")).encode())
    return f"{h}.{p}.{sign(h, p, secret)}"


def verify(token: str, secret: str, now: float | None = None) -> dict | None:
    # TODO
    return None


t = make_token({"sub": "user_42", "role": "user", "exp": time.time() + 60}, "dev-secret")
print(t)
print(verify(t, "dev-secret"))
`,
    solution: `import base64, hmac, hashlib, json, time


def b64url_encode(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def b64url_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def sign(header_b64: str, payload_b64: str, secret: str) -> str:
    msg = f"{header_b64}.{payload_b64}".encode()
    return b64url_encode(hmac.new(secret.encode(), msg, hashlib.sha256).digest())


def make_token(payload: dict, secret: str) -> str:
    h = b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    p = b64url_encode(json.dumps(payload, separators=(",", ":")).encode())
    return f"{h}.{p}.{sign(h, p, secret)}"


def verify(token: str, secret: str, now: float | None = None) -> dict | None:
    parts = token.split(".")
    if len(parts) != 3:
        return None
    h, p, s = parts
    if not hmac.compare_digest(sign(h, p, secret), s):
        return None
    try:
        payload = json.loads(b64url_decode(p))
    except Exception:
        return None
    now = time.time() if now is None else now
    if "exp" in payload and payload["exp"] <= now:
        return None
    return payload


t = make_token({"sub": "user_42", "role": "user", "exp": time.time() + 60}, "dev-secret")
print(t)
print(verify(t, "dev-secret"))
`,
    tests: [
      { name: '正確的 token 回傳 payload', code: `_t = make_token({"sub": "u1", "role": "user", "exp": 2000}, "s3cret")\nassert verify(_t, "s3cret", now=1000) == {"sub": "u1", "role": "user", "exp": 2000}` },
      { name: '竄改 payload 後簽章失效', code: `_t = make_token({"sub": "u1", "role": "user"}, "s3cret")\n_h, _p, _s = _t.split(".")\n_p2 = b64url_encode(b'{"sub":"u1","role":"admin"}')\nassert verify(f"{_h}.{_p2}.{_s}", "s3cret") is None, "竄改後仍通過"` },
      { name: '不同 secret 驗不過', code: `_t = make_token({"sub": "u1"}, "s3cret")\nassert verify(_t, "other") is None` },
      { name: '過期的 token 回 None', code: `_t = make_token({"sub": "u1", "exp": 1000}, "s3cret")\nassert verify(_t, "s3cret", now=1001) is None\nassert verify(_t, "s3cret", now=999) is not None` },
      { name: '格式不對不拋例外', code: `assert verify("not.a.jwt.at.all", "s") is None\nassert verify("abc", "s") is None` },
    ],
    hints: ['token.split(".") 應該恰好 3 段。', '比對簽章要用 hmac.compare_digest(a, b)（常數時間），不要用 ==。', '解碼 payload 可能失敗（不是合法 base64 或 JSON），包在 try/except 裡回 None。'],
  },
  {
    id: 'rbac-abac-1', skill: 'rbac-abac', kind: 'js', level: 2,
    title: '角色 + 擁有權的授權函式',
    prompt: '實作 `can(user, action, resource)`：\n\n- `ROLE_PERMS` 定義每個角色能做的動作；使用者可能有多個角色，任一角色允許即可\n- **例外**：`delete` 除了角色要允許，還必須是資源擁有者（`resource.ownerId === user.id`）或 `admin`\n- 沒有任何規則允許就是 `false`（預設拒絕）',
    starter: `const ROLE_PERMS = {
  admin: ['read', 'write', 'delete', 'manage_users'],
  editor: ['read', 'write', 'delete'],
  viewer: ['read'],
}

function can(user, action, resource) {
  // user: { id, roles: string[] }，resource: { ownerId }
  // TODO
  return false
}

console.log(can({ id: 1, roles: ['editor'] }, 'write', { ownerId: 2 }))
`,
    solution: `const ROLE_PERMS = {
  admin: ['read', 'write', 'delete', 'manage_users'],
  editor: ['read', 'write', 'delete'],
  viewer: ['read'],
}

function can(user, action, resource) {
  const roles = user.roles || []
  const allowedByRole = roles.some((r) => (ROLE_PERMS[r] || []).includes(action))
  if (!allowedByRole) return false
  if (action === 'delete') {
    return roles.includes('admin') || resource.ownerId === user.id
  }
  return true
}

console.log(can({ id: 1, roles: ['editor'] }, 'write', { ownerId: 2 }))
`,
    tests: [
      { name: 'viewer 只能 read', code: `assertEqual(can({ id: 1, roles: ['viewer'] }, 'read', { ownerId: 2 }), true)\nassertEqual(can({ id: 1, roles: ['viewer'] }, 'write', { ownerId: 1 }), false)` },
      { name: 'editor 可以 write，delete 只能刪自己的', code: `assertEqual(can({ id: 1, roles: ['editor'] }, 'write', { ownerId: 2 }), true)\nassertEqual(can({ id: 1, roles: ['editor'] }, 'delete', { ownerId: 1 }), true)\nassertEqual(can({ id: 1, roles: ['editor'] }, 'delete', { ownerId: 2 }), false)` },
      { name: 'admin 什麼都能刪', code: `assertEqual(can({ id: 9, roles: ['admin'] }, 'delete', { ownerId: 2 }), true)\nassertEqual(can({ id: 9, roles: ['admin'] }, 'manage_users', { ownerId: 2 }), true)` },
      { name: '多角色取聯集；未知動作預設拒絕', code: `assertEqual(can({ id: 3, roles: ['viewer', 'editor'] }, 'write', { ownerId: 0 }), true)\nassertEqual(can({ id: 3, roles: ['editor'] }, 'deploy', { ownerId: 3 }), false)\nassertEqual(can({ id: 3, roles: [] }, 'read', { ownerId: 3 }), false)` },
    ],
    hints: ['先用 roles.some(...) 判斷「有沒有任一角色允許這個動作」。', 'delete 是「角色允許」且「是擁有者或 admin」——兩個條件都要成立。'],
  },
  {
    id: 'authn-basics-1', skill: 'authn-basics', kind: 'python', level: 1,
    title: '伺服器端 session：閒置逾時、絕對逾時、登出所有裝置',
    prompt: '實作 `SessionStore`：\n\n- `create(user_id, now)`：用 `secrets.token_urlsafe(32)` 產生 session id，記下使用者、建立時間、最後活動時間，回傳 id\n- `get(sid, now)`：回傳 user_id；不存在、閒置超過 `IDLE` 秒（`now - 最後活動 > IDLE`）、或建立後超過 `ABSOLUTE` 秒（`now - 建立 > ABSOLUTE`）回 `None`，失效的順便刪掉；有效時把最後活動時間更新成 `now`（滑動逾時）\n- `destroy(sid)`：登出這個 session\n- `destroy_all(user_id)`：登出這個使用者的所有 session（改密碼、「登出所有裝置」時用）',
    starter: `import secrets


class SessionStore:
    IDLE = 30 * 60          # 閒置 30 分鐘失效
    ABSOLUTE = 8 * 60 * 60  # 不論有沒有在用，登入 8 小時後失效

    def __init__(self):
        self.sessions = {}  # sid -> {"user_id", "created", "last_seen"}

    def create(self, user_id: int, now: float) -> str:
        # TODO
        return "sid"

    def get(self, sid: str, now: float):
        # TODO
        return None

    def destroy(self, sid: str):
        # TODO
        pass

    def destroy_all(self, user_id: int):
        # TODO
        pass


store = SessionStore()
sid = store.create(42, now=0)
print(store.get(sid, now=60))
`,
    solution: `import secrets


class SessionStore:
    IDLE = 30 * 60          # 閒置 30 分鐘失效
    ABSOLUTE = 8 * 60 * 60  # 不論有沒有在用，登入 8 小時後失效

    def __init__(self):
        self.sessions = {}  # sid -> {"user_id", "created", "last_seen"}

    def create(self, user_id: int, now: float) -> str:
        sid = secrets.token_urlsafe(32)
        self.sessions[sid] = {"user_id": user_id, "created": now, "last_seen": now}
        return sid

    def get(self, sid: str, now: float):
        s = self.sessions.get(sid)
        if s is None:
            return None
        if now - s["last_seen"] > self.IDLE or now - s["created"] > self.ABSOLUTE:
            del self.sessions[sid]
            return None
        s["last_seen"] = now
        return s["user_id"]

    def destroy(self, sid: str):
        self.sessions.pop(sid, None)

    def destroy_all(self, user_id: int):
        for sid in [k for k, v in self.sessions.items() if v["user_id"] == user_id]:
            del self.sessions[sid]


store = SessionStore()
sid = store.create(42, now=0)
print(store.get(sid, now=60))
`,
    tests: [
      { name: '建立後可以取回使用者；id 夠長且不重複', code: `_s = SessionStore()\n_a = _s.create(1, 0); _b = _s.create(1, 0)\nassert _s.get(_a, 10) == 1\nassert _a != _b and len(_a) >= 32` },
      { name: '閒置超過 30 分鐘失效', code: `_s = SessionStore()\n_a = _s.create(1, 0)\nassert _s.get(_a, 1800) == 1\nassert _s.get(_a, 1800 + 1801) is None\nassert _a not in _s.sessions, "失效的 session 要刪掉"` },
      { name: '持續使用會延長（滑動），但有絕對上限', code: `_s = SessionStore()\n_a = _s.create(1, 0)\n_t = 0\nwhile _t < 8 * 3600:\n    assert _s.get(_a, _t) == 1, f"{_t} 秒時應該還有效"\n    _t += 1200\nassert _s.get(_a, 8 * 3600 + 1) is None, "登入超過 8 小時要失效"` },
      { name: 'destroy 與 destroy_all', code: `_s = SessionStore()\n_a = _s.create(1, 0); _b = _s.create(1, 0); _c = _s.create(2, 0)\n_s.destroy(_a)\nassert _s.get(_a, 1) is None and _s.get(_b, 1) == 1\n_s.destroy_all(1)\nassert _s.get(_b, 2) is None\nassert _s.get(_c, 2) == 2, "別的使用者不受影響"\n_s.destroy("not-exist")` },
    ],
    hints: ['`secrets.token_urlsafe(32)` 產生約 43 個字元的隨機字串。', '兩個條件任一成立就失效：`now - last_seen > IDLE`、`now - created > ABSOLUTE`。', 'destroy_all 不要邊走訪 dict 邊刪除，先收集要刪的 key。'],
  },
  {
    id: 'oauth-oidc-1', skill: 'oauth-oidc', kind: 'python', level: 2,
    title: '授權碼流程的 client 端：state 與 PKCE',
    prompt: '實作 OAuth 授權碼流程中 client 端的兩步：\n\n**`pkce_challenge(verifier)`**：S256 方法 = 對 verifier（ASCII）取 SHA-256，再做 base64url 編碼並**去掉結尾的 `=`**。\n\n**`start_login(session)`**：用 `secrets.token_urlsafe(32)` 各產生一個 `state` 與 `code_verifier`，存進 `session`（dict）的 `"oauth_state"`、`"code_verifier"`，回傳要放進授權網址的參數 `{"state", "code_challenge", "code_challenge_method": "S256"}`。\n\n**`handle_callback(session, query)`**：授權伺服器導回時呼叫。先把 session 裡的 state 與 verifier **取出並刪除**（一次性），再檢查：`query` 有 `error`、session 沒有 state、`query` 的 state 不符（用 `hmac.compare_digest`）、沒有 `code`，都丟 `ValueError`。通過就回傳 `{"code", "code_verifier"}`，讓後端拿去換 token。',
    starter: `import base64, hashlib, hmac, secrets


def pkce_challenge(verifier: str) -> str:
    # TODO
    return verifier


def start_login(session: dict) -> dict:
    # TODO
    return {}


def handle_callback(session: dict, query: dict) -> dict:
    # TODO
    return {"code": query.get("code"), "code_verifier": None}


session = {}
params = start_login(session)
print(params)
print(handle_callback(session, {"code": "abc", "state": params.get("state")}))
`,
    solution: `import base64, hashlib, hmac, secrets


def pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def start_login(session: dict) -> dict:
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(32)
    session["oauth_state"] = state
    session["code_verifier"] = verifier
    return {"state": state, "code_challenge": pkce_challenge(verifier), "code_challenge_method": "S256"}


def handle_callback(session: dict, query: dict) -> dict:
    expected = session.pop("oauth_state", None)
    verifier = session.pop("code_verifier", None)
    if "error" in query:
        raise ValueError("authorization denied: " + str(query["error"]))
    if expected is None or verifier is None:
        raise ValueError("no login in progress")
    if not hmac.compare_digest(expected, str(query.get("state", ""))):
        raise ValueError("state mismatch")
    if not query.get("code"):
        raise ValueError("missing code")
    return {"code": query["code"], "code_verifier": verifier}


session = {}
params = start_login(session)
print(params)
print(handle_callback(session, {"code": "abc", "state": params.get("state")}))
`,
    tests: [
      { name: 'PKCE S256 的計算', code: `assert pkce_challenge("demo-verifier-0123456789-abcdefghijklmnopqrstu") == "XjNbHM3IuJ2nX3vb1-xZDWcFa2UYryJTMdYzhK9DWBo"\nassert "=" not in pkce_challenge("x" * 43)` },
      { name: 'start_login 存下 state 與 verifier', code: `_s = {}\n_p = start_login(_s)\nassert _p["code_challenge_method"] == "S256"\nassert _p["state"] == _s["oauth_state"] and len(_p["state"]) >= 32\nassert _p["code_challenge"] == pkce_challenge(_s["code_verifier"])\nassert _p["code_challenge"] != _s["code_verifier"], "網址裡只能放 challenge，不能放 verifier"\n_s2 = {}\nassert start_login(_s2)["state"] != _p["state"], "state 每次都要隨機"` },
      { name: '正確導回：回傳 code 與 verifier', code: `_s = {}\n_p = start_login(_s)\n_v = _s["code_verifier"]\nassert handle_callback(_s, {"code": "c1", "state": _p["state"]}) == {"code": "c1", "code_verifier": _v}` },
      { name: 'state 不符、沒有進行中的登入、error 都要拒絕', code: `def _rejects(s, q):\n    try:\n        handle_callback(s, q)\n    except ValueError:\n        return True\n    return False\n_s = {}; _p = start_login(_s)\nassert _rejects(_s, {"code": "c", "state": "attacker"}), "state 不符要拒絕"\nassert _rejects({}, {"code": "c", "state": "x"}), "沒有進行中的登入要拒絕"\n_s = {}; _p = start_login(_s)\nassert _rejects(_s, {"error": "access_denied", "state": _p["state"]})\n_s = {}; _p = start_login(_s)\nassert _rejects(_s, {"state": _p["state"]}), "沒有 code 要拒絕"` },
      { name: 'state 只能用一次', code: `_s = {}\n_p = start_login(_s)\nhandle_callback(_s, {"code": "c", "state": _p["state"]})\ntry:\n    handle_callback(_s, {"code": "c2", "state": _p["state"]})\n    assert False, "同一個 state 第二次要拒絕"\nexcept ValueError:\n    pass` },
    ],
    hints: ['base64url 用 `base64.urlsafe_b64encode`，再 `.rstrip(b"=")`。', '`session.pop(key, None)` 取出並刪除，失敗的情況也要先 pop，state 才是一次性的。', '比對 state 用 `hmac.compare_digest(a, b)`，兩邊都要是 str。'],
  },
  {
    id: 'auth-in-practice-1', skill: 'auth-in-practice', kind: 'python', level: 2,
    title: '401、403、404 用在對的地方',
    prompt: '實作兩個 endpoint 的處理函式，回傳 `(狀態碼, body)`。`current_user(authorization)` 已提供：從 `Authorization: Bearer <token>` 找出使用者，找不到回 `None`。\n\n**`get_order(authorization, order_id)`**：\n- 沒登入 → `(401, {"error": "unauthenticated"})`\n- 訂單不存在，或使用者不是擁有者也不是 `admin` → `(404, {"error": "not_found"})`（不要用 403 洩漏「這筆訂單存在」）\n- 否則 `(200, 訂單 dict)`\n\n**`refund(authorization, order_id)`**：只有 `admin` 能退款\n- 沒登入 → 401；登入但不是 admin（就算是擁有者）→ `(403, {"error": "forbidden"})`\n- admin 但訂單不存在 → 404；否則 `(200, {"refunded": order_id})`',
    starter: `TOKENS = {"tok-alice": 1, "tok-bob": 2, "tok-admin": 9}
USERS = {1: {"id": 1, "roles": ["member"]}, 2: {"id": 2, "roles": ["member"]}, 9: {"id": 9, "roles": ["admin"]}}
ORDERS = {100: {"id": 100, "owner_id": 1, "amount": 990}, 101: {"id": 101, "owner_id": 2, "amount": 450}}


def current_user(authorization):
    if not authorization or not authorization.startswith("Bearer "):
        return None
    user_id = TOKENS.get(authorization[len("Bearer "):])
    return USERS.get(user_id)


def get_order(authorization, order_id):
    # TODO
    return 200, ORDERS.get(order_id)


def refund(authorization, order_id):
    # TODO
    return 200, {"refunded": order_id}


print(get_order("Bearer tok-alice", 100))
print(get_order("Bearer tok-alice", 101))
print(refund("Bearer tok-alice", 100))
`,
    solution: `TOKENS = {"tok-alice": 1, "tok-bob": 2, "tok-admin": 9}
USERS = {1: {"id": 1, "roles": ["member"]}, 2: {"id": 2, "roles": ["member"]}, 9: {"id": 9, "roles": ["admin"]}}
ORDERS = {100: {"id": 100, "owner_id": 1, "amount": 990}, 101: {"id": 101, "owner_id": 2, "amount": 450}}


def current_user(authorization):
    if not authorization or not authorization.startswith("Bearer "):
        return None
    user_id = TOKENS.get(authorization[len("Bearer "):])
    return USERS.get(user_id)


def get_order(authorization, order_id):
    user = current_user(authorization)
    if user is None:
        return 401, {"error": "unauthenticated"}
    order = ORDERS.get(order_id)
    # 不存在與「不是你的」回一樣的 404，不洩漏存在性
    if order is None or (order["owner_id"] != user["id"] and "admin" not in user["roles"]):
        return 404, {"error": "not_found"}
    return 200, order


def refund(authorization, order_id):
    user = current_user(authorization)
    if user is None:
        return 401, {"error": "unauthenticated"}
    if "admin" not in user["roles"]:
        return 403, {"error": "forbidden"}
    if order_id not in ORDERS:
        return 404, {"error": "not_found"}
    return 200, {"refunded": order_id}


print(get_order("Bearer tok-alice", 100))
print(get_order("Bearer tok-alice", 101))
print(refund("Bearer tok-alice", 100))
`,
    tests: [
      { name: '沒登入或 token 無效是 401', code: `for _h in [None, "", "tok-alice", "Bearer nope", "Basic abc"]:\n    assert get_order(_h, 100)[0] == 401, _h\n    assert refund(_h, 100)[0] == 401, _h` },
      { name: '擁有者看得到自己的訂單', code: `assert get_order("Bearer tok-alice", 100) == (200, ORDERS[100])` },
      { name: '別人的訂單與不存在的訂單都是 404', code: `assert get_order("Bearer tok-alice", 101) == (404, {"error": "not_found"})\nassert get_order("Bearer tok-alice", 999) == (404, {"error": "not_found"})` },
      { name: 'admin 看得到所有訂單', code: `assert get_order("Bearer tok-admin", 101) == (200, ORDERS[101])` },
      { name: '退款：非 admin 是 403（擁有者也一樣）', code: `assert refund("Bearer tok-alice", 100) == (403, {"error": "forbidden"})\nassert refund("Bearer tok-bob", 100) == (403, {"error": "forbidden"})` },
      { name: '退款：admin 成功；訂單不存在是 404', code: `assert refund("Bearer tok-admin", 100) == (200, {"refunded": 100})\nassert refund("Bearer tok-admin", 999) == (404, {"error": "not_found"})` },
    ],
    hints: ['兩個函式的第一步都是 `current_user`，None 就 401。', 'get_order：「不存在」與「不是你的」合併成同一個 404。', 'refund：先看角色（403），再看訂單存不存在（404）。'],
  },
  {
    id: 'account-lifecycle-1', skill: 'account-lifecycle', kind: 'python', level: 2,
    title: '登入節流：擋住攻擊者，但鎖不住本人',
    prompt: '實作 `LoginThrottle`，在 `WINDOW` 秒的滑動視窗內計算登入失敗：\n\n- `record_failure(account, ip, now)`：記錄一次失敗\n- `record_success(account, ip, now)`：清掉這個「帳號 + IP」組合的失敗紀錄（其他紀錄不動）\n- `check(account, ip, now)` 回傳：\n  - `"block"`：這個「帳號 + IP」在視窗內失敗 ≥ `PAIR_LIMIT` 次，或這個 IP 在視窗內（對任何帳號）失敗 ≥ `IP_LIMIT` 次\n  - `"challenge"`：不是 block，但這個帳號在視窗內（所有 IP 加總）失敗 ≥ `ACCOUNT_LIMIT` 次——要求 CAPTCHA 之類的額外驗證，而不是鎖死\n  - 其他情況 `"ok"`\n- 帳號比對不分大小寫、忽略前後空白；視窗內指的是 `now - 失敗時間 < WINDOW`',
    starter: `class LoginThrottle:
    WINDOW = 15 * 60
    PAIR_LIMIT = 5
    IP_LIMIT = 20
    ACCOUNT_LIMIT = 50

    def __init__(self):
        self.failures = []   # [(account, ip, time)]

    def record_failure(self, account: str, ip: str, now: float):
        # TODO
        pass

    def record_success(self, account: str, ip: str, now: float):
        # TODO
        pass

    def check(self, account: str, ip: str, now: float) -> str:
        # TODO
        return "ok"


t = LoginThrottle()
for i in range(5):
    t.record_failure("alice@example.com", "203.0.113.7", now=i)
print("攻擊者：", t.check("alice@example.com", "203.0.113.7", now=10))
print("本人：", t.check("alice@example.com", "198.51.100.20", now=10))
`,
    solution: `class LoginThrottle:
    WINDOW = 15 * 60
    PAIR_LIMIT = 5
    IP_LIMIT = 20
    ACCOUNT_LIMIT = 50

    def __init__(self):
        self.failures = []   # [(account, ip, time)]

    @staticmethod
    def _norm(account: str) -> str:
        return account.strip().lower()

    def _recent(self, now: float):
        # 順便丟掉視窗外的舊紀錄
        self.failures = [f for f in self.failures if now - f[2] < self.WINDOW]
        return self.failures

    def record_failure(self, account: str, ip: str, now: float):
        self.failures.append((self._norm(account), ip, now))

    def record_success(self, account: str, ip: str, now: float):
        a = self._norm(account)
        self.failures = [f for f in self.failures if not (f[0] == a and f[1] == ip)]

    def check(self, account: str, ip: str, now: float) -> str:
        a = self._norm(account)
        recent = self._recent(now)
        pair = sum(1 for f in recent if f[0] == a and f[1] == ip)
        by_ip = sum(1 for f in recent if f[1] == ip)
        by_account = sum(1 for f in recent if f[0] == a)
        if pair >= self.PAIR_LIMIT or by_ip >= self.IP_LIMIT:
            return "block"
        if by_account >= self.ACCOUNT_LIMIT:
            return "challenge"
        return "ok"


t = LoginThrottle()
for i in range(5):
    t.record_failure("alice@example.com", "203.0.113.7", now=i)
print("攻擊者：", t.check("alice@example.com", "203.0.113.7", now=10))
print("本人：", t.check("alice@example.com", "198.51.100.20", now=10))
`,
    tests: [
      { name: '同一個帳號 + IP 失敗 5 次被擋', code: `_t = LoginThrottle()\nfor _i in range(4):\n    _t.record_failure("alice", "1.1.1.1", _i)\nassert _t.check("alice", "1.1.1.1", 5) == "ok"\n_t.record_failure("alice", "1.1.1.1", 5)\nassert _t.check("alice", "1.1.1.1", 6) == "block"` },
      { name: '攻擊者鎖不住本人（不同 IP）', code: `_t = LoginThrottle()\nfor _i in range(10):\n    _t.record_failure("alice", "1.1.1.1", _i)\nassert _t.check("alice", "2.2.2.2", 20) == "ok"` },
      { name: '視窗過了就恢復', code: `_t = LoginThrottle()\nfor _i in range(5):\n    _t.record_failure("alice", "1.1.1.1", 0)\nassert _t.check("alice", "1.1.1.1", 899) == "block"\nassert _t.check("alice", "1.1.1.1", 900) == "ok"` },
      { name: '帳號不分大小寫與前後空白', code: `_t = LoginThrottle()\nfor _n in ["Alice@Example.com", " alice@example.com", "ALICE@EXAMPLE.COM", "alice@example.com", "Alice@example.COM "]:\n    _t.record_failure(_n, "1.1.1.1", 0)\nassert _t.check("alice@example.com", "1.1.1.1", 1) == "block"` },
      { name: '登入成功只清掉該組合', code: `_t = LoginThrottle()\nfor _i in range(4):\n    _t.record_failure("alice", "1.1.1.1", 0)\n    _t.record_failure("bob", "1.1.1.1", 0)\n_t.record_success("alice", "1.1.1.1", 1)\n_t.record_failure("alice", "1.1.1.1", 2)\nassert _t.check("alice", "1.1.1.1", 3) == "ok"\n_t.record_failure("bob", "1.1.1.1", 2)\nassert _t.check("bob", "1.1.1.1", 3) == "block"` },
      { name: '同一個 IP 噴灑很多帳號被擋', code: `_t = LoginThrottle()\nfor _i in range(20):\n    _t.record_failure(f"user{_i}", "6.6.6.6", 0)\nassert _t.check("new-victim", "6.6.6.6", 1) == "block"\nassert _t.check("new-victim", "7.7.7.7", 1) == "ok"` },
      { name: '分散在很多 IP 的撞庫：要求額外驗證而非鎖死', code: `_t = LoginThrottle()\nfor _i in range(50):\n    _t.record_failure("alice", f"10.0.{_i // 250}.{_i % 250}", 0)\nassert _t.check("alice", "2.2.2.2", 1) == "challenge"\nassert _t.check("bob", "2.2.2.2", 1) == "ok"` },
    ],
    hints: ['帳號先 `.strip().lower()` 再存、再比。', '每次 check 先過濾掉 `now - t >= WINDOW` 的紀錄，再分別數「帳號 + IP」「IP」「帳號」三種。', 'block 的條件優先於 challenge。'],
  },
  {
    id: 'api-keys-mfa-1', skill: 'api-keys-mfa', kind: 'python', level: 3,
    title: '實作 TOTP（RFC 6238）',
    prompt: '實作 Authenticator App 用的一次性密碼：\n\n**`hotp(key, counter, digits=6)`**（RFC 4226）：\n1. 把 `counter` 編成 8 bytes 大端序（`struct.pack(">Q", counter)`）\n2. `h = hmac.new(key, 該 8 bytes, hashlib.sha1).digest()`（20 bytes）\n3. 動態截斷：`offset = h[-1] & 0x0F`，取 `h[offset:offset+4]` 當大端序整數，再 `& 0x7FFFFFFF`\n4. 取 `% 10**digits`，左邊補 0 成 `digits` 位的字串\n\n**`totp(key, t, digits=6, step=30)`**：`hotp(key, int(t // step), digits)`。\n\n**`verify_totp(key, code, t, window=1, digits=6)`**：允許前後 `window` 個時間步（時鐘誤差），任一相符就回 True；比對用 `hmac.compare_digest`；長度不對直接 False。\n\n測試用的是 RFC 4226 與 RFC 6238 附錄的標準測試向量。',
    starter: `import hashlib, hmac, struct


def hotp(key: bytes, counter: int, digits: int = 6) -> str:
    # TODO
    return "0" * digits


def totp(key: bytes, t: float, digits: int = 6, step: int = 30) -> str:
    # TODO
    return "0" * digits


def verify_totp(key: bytes, code: str, t: float, window: int = 1, digits: int = 6) -> bool:
    # TODO
    return False


KEY = b"12345678901234567890"   # RFC 附錄測試向量用的 key（ASCII）
print(hotp(KEY, 0), totp(KEY, 59, digits=8))
`,
    solution: `import hashlib, hmac, struct


def hotp(key: bytes, counter: int, digits: int = 6) -> str:
    h = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = h[-1] & 0x0F
    value = struct.unpack(">I", h[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(value % 10 ** digits).zfill(digits)


def totp(key: bytes, t: float, digits: int = 6, step: int = 30) -> str:
    return hotp(key, int(t // step), digits)


def verify_totp(key: bytes, code: str, t: float, window: int = 1, digits: int = 6) -> bool:
    if len(code) != digits:
        return False
    counter = int(t // 30)
    ok = False
    for c in range(counter - window, counter + window + 1):
        if c >= 0 and hmac.compare_digest(hotp(key, c, digits), code):
            ok = True
    return ok


KEY = b"12345678901234567890"   # RFC 附錄測試向量用的 key（ASCII）
print(hotp(KEY, 0), totp(KEY, 59, digits=8))
`,
    tests: [
      { name: 'HOTP：RFC 4226 測試向量', code: `_want = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"]\nassert [hotp(KEY, _i) for _i in range(10)] == _want` },
      { name: 'TOTP：RFC 6238 測試向量（SHA-1、8 位數）', code: `_cases = {59: "94287082", 1111111109: "07081804", 1111111111: "14050471", 1234567890: "89005924", 2000000000: "69279037", 20000000000: "65353130"}\nfor _t, _code in _cases.items():\n    assert totp(KEY, _t, digits=8) == _code, (_t, totp(KEY, _t, digits=8))` },
      { name: 'TOTP：6 位數與同一個時間步', code: `assert totp(KEY, 59) == "287082"\nassert totp(KEY, 30) == totp(KEY, 59) != totp(KEY, 60)` },
      { name: '驗證允許前後一個時間步', code: `_code = totp(KEY, 1000)\nassert verify_totp(KEY, _code, 1000)\nassert verify_totp(KEY, _code, 1000 + 30)\nassert verify_totp(KEY, _code, 1000 - 30)\nassert not verify_totp(KEY, _code, 1000 + 90), "差三個時間步不該通過"` },
      { name: '錯的或長度不對的 code 拒絕', code: `_code = totp(KEY, 1000)\n_bad = str((int(_code) + 1) % 1000000).zfill(6)\nassert not verify_totp(KEY, _bad, 1000)\nassert not verify_totp(KEY, _code[:5], 1000)\nassert not verify_totp(KEY, "", 1000)` },
    ],
    hints: ['`struct.pack(">Q", n)` 是 8 bytes 大端序；`struct.unpack(">I", b4)[0]` 把 4 bytes 轉回整數。', '補 0 用 `str(n).zfill(digits)`——RFC 6238 的第二組向量開頭就是 0。', '驗證時走過 `counter - window` 到 `counter + window`，每個都算一次 hotp 比對。'],
  },
]

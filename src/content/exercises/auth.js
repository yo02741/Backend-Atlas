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
]

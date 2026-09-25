// 程式題：資安
export default [
  {
    id: 'injection-1', skill: 'injection', kind: 'python', level: 1,
    title: '把字串拼接改成參數化查詢',
    prompt: '`find_user` 用 f-string 把 `username` 拼進 SQL，輸入 `alice\' OR \'1\'=\'1` 就能繞過。改成參數化：呼叫 `cursor.execute(sql, params)`，SQL 裡用 `%s` 佔位、值放在 `params`（tuple）裡，SQL 字串本身**不能**含使用者輸入。\n\n`FakeCursor` 只是紀錄你怎麼呼叫的。',
    starter: `class FakeCursor:
    def __init__(self):
        self.calls = []

    def execute(self, sql, params=None):
        self.calls.append((sql, params))
        return self

    def fetchone(self):
        return None


def find_user(cursor, username: str):
    cursor.execute(f"SELECT id, name FROM users WHERE username = '{username}'")
    return cursor.fetchone()


c = FakeCursor()
find_user(c, "alice' OR '1'='1")
print(c.calls[-1])
`,
    solution: `class FakeCursor:
    def __init__(self):
        self.calls = []

    def execute(self, sql, params=None):
        self.calls.append((sql, params))
        return self

    def fetchone(self):
        return None


def find_user(cursor, username: str):
    cursor.execute("SELECT id, name FROM users WHERE username = %s", (username,))
    return cursor.fetchone()


c = FakeCursor()
find_user(c, "alice' OR '1'='1")
print(c.calls[-1])
`,
    tests: [
      { name: 'SQL 字串不含使用者輸入', code: `_c = FakeCursor()\nfind_user(_c, "alice' OR '1'='1")\n_sql, _params = _c.calls[-1]\nassert "alice" not in _sql, "使用者輸入還是被拼進 SQL 了"` },
      { name: '值透過 params 傳', code: `_c = FakeCursor()\nfind_user(_c, "alice' OR '1'='1")\n_sql, _params = _c.calls[-1]\nassert _params is not None and "alice' OR '1'='1" in tuple(_params), "params 沒有帶到使用者輸入"` },
      { name: 'SQL 用佔位符', code: `_c = FakeCursor()\nfind_user(_c, "bob")\n_sql, _ = _c.calls[-1]\nassert "%s" in _sql or "?" in _sql, "沒有用 %s 或 ? 佔位"` },
    ],
    hints: ['psycopg 的寫法：cursor.execute("… WHERE username = %s", (username,))。', '注意 (username,) 的逗號——單元素 tuple 一定要有逗號。'],
  },
  {
    id: 'password-storage-1', skill: 'password-storage', kind: 'python', level: 1,
    title: '加鹽慢雜湊：存密碼與驗密碼',
    prompt: '實作 `hash_password(pw) -> str` 與 `verify_password(pw, stored) -> bool`：\n\n- 用已提供的 `pbkdf2_sha256(password, salt, iterations)`，每次產生 16 bytes 隨機 salt（`os.urandom`），iterations 至少 10,000（正式環境用 600,000 以上或 argon2；這裡為了在瀏覽器裡跑得動而調低）\n- `stored` 格式：`pbkdf2$<iterations>$<salt_hex>$<hash_hex>`\n- 驗證時從 `stored` 讀回 iterations 與 salt 重算，用 `hmac.compare_digest` 比對\n\n（瀏覽器裡的 Python 沒有 OpenSSL，所以 `hashlib.pbkdf2_hmac` 不可用，改用純 Python 實作的版本；正式專案請用 argon2 / bcrypt 函式庫。）',
    starter: `import hashlib, hmac, os


def pbkdf2_sha256(password: bytes, salt: bytes, iterations: int, dklen: int = 32) -> bytes:
    \"\"\"PBKDF2-HMAC-SHA256 純 Python 版（RFC 8018）。正式環境用 hashlib.pbkdf2_hmac / argon2。\"\"\"
    mac = hmac.new(password, None, hashlib.sha256)

    def prf(msg: bytes) -> bytes:
        m = mac.copy()
        m.update(msg)
        return m.digest()

    out, block = b"", 1
    while len(out) < dklen:
        u = prf(salt + block.to_bytes(4, "big"))
        t = int.from_bytes(u, "big")
        for _ in range(iterations - 1):
            u = prf(u)
            t ^= int.from_bytes(u, "big")
        out += t.to_bytes(len(u), "big")
        block += 1
    return out[:dklen]


def hash_password(pw: str) -> str:
    # TODO：隨機 salt + pbkdf2_sha256 + 組成 stored 字串
    return hashlib.sha256(pw.encode()).hexdigest()


def verify_password(pw: str, stored: str) -> bool:
    # TODO：拆出 iterations / salt / hash，重算後用 hmac.compare_digest 比對
    return hash_password(pw) == stored


s = hash_password("hunter2")
print(s)
print(verify_password("hunter2", s), verify_password("hunter3", s))
`,
    solution: `import hashlib, hmac, os

ITERATIONS = 10_000


def pbkdf2_sha256(password: bytes, salt: bytes, iterations: int, dklen: int = 32) -> bytes:
    mac = hmac.new(password, None, hashlib.sha256)

    def prf(msg: bytes) -> bytes:
        m = mac.copy()
        m.update(msg)
        return m.digest()

    out, block = b"", 1
    while len(out) < dklen:
        u = prf(salt + block.to_bytes(4, "big"))
        t = int.from_bytes(u, "big")
        for _ in range(iterations - 1):
            u = prf(u)
            t ^= int.from_bytes(u, "big")
        out += t.to_bytes(len(u), "big")
        block += 1
    return out[:dklen]


def hash_password(pw: str) -> str:
    salt = os.urandom(16)
    digest = pbkdf2_sha256(pw.encode(), salt, ITERATIONS)
    return f"pbkdf2\${ITERATIONS}\${salt.hex()}\${digest.hex()}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        algo, iters, salt_hex, hash_hex = stored.split("$")
        if algo != "pbkdf2":
            return False
        digest = pbkdf2_sha256(pw.encode(), bytes.fromhex(salt_hex), int(iters))
        return hmac.compare_digest(digest.hex(), hash_hex)
    except (ValueError, TypeError):
        return False


s = hash_password("hunter2")
print(s)
print(verify_password("hunter2", s), verify_password("hunter3", s))
`,
    tests: [
      { name: '正確密碼驗證通過、錯誤密碼不通過', code: `_s = hash_password("hunter2")\nassert verify_password("hunter2", _s) is True\nassert verify_password("hunter3", _s) is False` },
      { name: '同一組密碼兩次雜湊結果不同（有隨機 salt）', code: `assert hash_password("hunter2") != hash_password("hunter2"), "沒有 salt 或 salt 不是隨機的"` },
      { name: '格式與 work factor', code: `_p = hash_password("x").split("$")\nassert _p[0] == "pbkdf2" and len(_p) == 4, _p\nassert int(_p[1]) >= 10000, "iterations 太低"\nassert len(_p[2]) == 32, "salt 應為 16 bytes（32 個 hex 字元）"` },
      { name: '雜湊值真的是 PBKDF2（用已知 salt 重算）', code: `_salt = bytes.fromhex("000102030405060708090a0b0c0d0e0f")\n_ref = pbkdf2_sha256(b"hunter2", _salt, 10000).hex()\n_stored = f"pbkdf2$10000$" + _salt.hex() + "$" + _ref\nassert verify_password("hunter2", _stored) is True, "verify 沒有依 stored 裡的 salt / iterations 重算"` },
    ],
    hints: ['os.urandom(16).hex() 產生 salt 的 hex 字串；bytes.fromhex() 轉回來。', 'stored.split("$") 拆出四段，iterations 記得轉 int。'],
  },
]

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
  {
    id: 'owasp-top10-1', skill: 'owasp-top10', kind: 'js', level: 2,
    title: 'SSRF：伺服器端抓取 URL 的白名單',
    prompt: '「使用者提供 URL、伺服器去抓」的功能（webhook 設定、匯入圖片、連結預覽）要防 SSRF：攻擊者讓伺服器去請求內網位址或雲端的 metadata 端點（`169.254.169.254`）。2021 版 OWASP Top 10 的 A10 就是它（2025 版併入 A01 存取控制失效）。\n\n實作 `isAllowedUrl(input)`，只有全部條件成立才回 `true`：\n\n- 能被 `new URL()` 解析（解析失敗回 `false`，不要丟例外）\n- 協定是 `https:`\n- 主機名稱（不分大小寫）**完全等於** `ALLOWED_HOSTS` 其中之一，不能只比對開頭或結尾\n- 沒有帳密部分（`https://user@host/` 這種）\n- 沒有指定連接埠，或連接埠是 443\n\n起始碼用 `startsWith` 判斷，`https://api.partner.example@169.254.169.254/` 與 `https://api.partner.example.evil.test/` 都能騙過它。',
    starter: `const ALLOWED_HOSTS = ['api.partner.example', 'files.partner.example']

function isAllowedUrl(input) {
  return ALLOWED_HOSTS.some((h) => input.startsWith('https://' + h))
}

console.log(isAllowedUrl('https://api.partner.example/v1/rates'))
console.log(isAllowedUrl('https://api.partner.example@169.254.169.254/latest/meta-data/'))
`,
    solution: `const ALLOWED_HOSTS = ['api.partner.example', 'files.partner.example']

function isAllowedUrl(input) {
  let url
  try {
    url = new URL(input)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  // URL 會把預設連接埠正規化成空字串：https://host:443/ 的 url.port 是 ''
  if (url.port !== '' && url.port !== '443') return false
  return ALLOWED_HOSTS.includes(url.hostname.toLowerCase())
}

console.log(isAllowedUrl('https://api.partner.example/v1/rates'))
console.log(isAllowedUrl('https://api.partner.example@169.254.169.254/latest/meta-data/'))
`,
    tests: [
      { name: '白名單內的 https URL 可以', code: `assertEqual(isAllowedUrl('https://api.partner.example/v1/rates'), true)
assertEqual(isAllowedUrl('https://FILES.partner.example/a.png'), true)
assertEqual(isAllowedUrl('https://api.partner.example:443/x'), true)` },
      { name: '帳密部分把真正的主機藏在 @ 後面', code: `assertEqual(isAllowedUrl('https://api.partner.example@169.254.169.254/latest/meta-data/'), false)
assertEqual(isAllowedUrl('https://user:pw@api.partner.example/'), false)` },
      { name: '主機名稱要完全相等', code: `assertEqual(isAllowedUrl('https://api.partner.example.evil.test/'), false)
assertEqual(isAllowedUrl('https://evilapi.partner.example/'), false)` },
      { name: '協定與連接埠', code: `assertEqual(isAllowedUrl('http://api.partner.example/'), false)
assertEqual(isAllowedUrl('https://api.partner.example:8443/'), false)
assertEqual(isAllowedUrl('file:///etc/passwd'), false)` },
      { name: '無法解析的輸入回 false', code: `assertEqual(isAllowedUrl('not a url'), false)
assertEqual(isAllowedUrl(''), false)` },
    ],
    hints: ['先 `new URL(input)`（包在 try/catch），之後只看解析後的 `protocol`、`username`、`password`、`port`、`hostname`，不要再對原始字串做比對。', '這只是第一層。正式環境還要在 DNS 解析後檢查 IP 不在內網範圍、不跟隨轉址到白名單外，並讓出站流量經過有限制的代理。'],
  },
  {
    id: 'crypto-toolbox-1', skill: 'crypto-toolbox', kind: 'python', level: 2,
    title: '驗證 webhook 的 HMAC 簽章',
    prompt: '金流服務呼叫你的 webhook 時，會在標頭帶 `Signature: t=<unix 秒>,v1=<hex>`，其中 `v1 = HMAC-SHA256(secret, "<t>.<body>")`。實作 `verify_webhook(secret, body, header, now, tolerance=300)`：\n\n- 解析標頭取出 `t` 與 `v1`；格式不對（缺欄位、t 不是整數）回 `False`，不丟例外\n- `|now - t|` 超過 `tolerance` 秒回 `False`（防止攔截到的舊請求被重送）\n- 用同一把 secret 重算 HMAC，**用 `hmac.compare_digest` 比對**（一般的 `==` 比對時間會洩漏「前面有幾個字元相同」）\n\n起始碼只算了 body 的 SHA-256：沒有金鑰的雜湊，任何人都能算出來。',
    starter: `import hashlib
import hmac

SECRET = b"whsec_demo_only"


def sign(secret: bytes, timestamp: int, body: bytes) -> str:
    """發送端：簽 "<timestamp>.<body>"，放在標頭 Signature: t=<timestamp>,v1=<hex>"""
    mac = hmac.new(secret, f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={mac}"


def verify_webhook(secret: bytes, body: bytes, header: str, now: int, tolerance: int = 300) -> bool:
    parts = dict(item.split("=", 1) for item in header.split(","))
    return parts["v1"] == hashlib.sha256(body).hexdigest()


body = b'{"event": "payment.succeeded", "order_id": 104}'
header = sign(SECRET, 1760000000, body)
print(header)
print(verify_webhook(SECRET, body, header, now=1760000030))
`,
    solution: `import hashlib
import hmac

SECRET = b"whsec_demo_only"


def sign(secret: bytes, timestamp: int, body: bytes) -> str:
    """發送端：簽 "<timestamp>.<body>"，放在標頭 Signature: t=<timestamp>,v1=<hex>"""
    mac = hmac.new(secret, f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={mac}"


def verify_webhook(secret: bytes, body: bytes, header: str, now: int, tolerance: int = 300) -> bool:
    try:
        parts = dict(item.split("=", 1) for item in header.split(","))
        timestamp = int(parts["t"])
        received = parts["v1"]
    except (ValueError, KeyError):
        return False
    if abs(now - timestamp) > tolerance:
        return False
    expected = hmac.new(secret, f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, received)


body = b'{"event": "payment.succeeded", "order_id": 104}'
header = sign(SECRET, 1760000000, body)
print(header)
print(verify_webhook(SECRET, body, header, now=1760000030))
`,
    tests: [
      { name: '正確簽章通過', code: `_b = b'{"a": 1}'
assert verify_webhook(SECRET, _b, sign(SECRET, 1000, _b), now=1010) is True` },
      { name: 'body 被改、或用錯 secret 都不通過', code: `_b = b'{"a": 1}'
_h = sign(SECRET, 1000, _b)
assert verify_webhook(SECRET, b'{"a": 2}', _h, now=1010) is False
assert verify_webhook(b"other", _b, _h, now=1010) is False
import hashlib as _hl
assert verify_webhook(SECRET, _b, "t=1000,v1=" + _hl.sha256(_b).hexdigest(), now=1010) is False, "沒有金鑰的雜湊不能當簽章"` },
      { name: '超過時間容許範圍不通過（防重送）', code: `_b = b"{}"
assert verify_webhook(SECRET, _b, sign(SECRET, 1000, _b), now=1301) is False
assert verify_webhook(SECRET, _b, sign(SECRET, 1000, _b), now=700) is True
assert verify_webhook(SECRET, _b, sign(SECRET, 1000, _b), now=699) is False` },
      { name: '格式錯誤回 False 而不是丟例外', code: `for _h in ["", "t=abc,v1=00", "v1=00", "t=1000", "garbage"]:
    assert verify_webhook(SECRET, b"{}", _h, now=1000) is False, _h` },
      { name: '用 hmac.compare_digest 比對', code: `import hmac as _hmac
_orig = _hmac.compare_digest
_calls = []
def _spy(a, b):
    _calls.append(1)
    return _orig(a, b)
_hmac.compare_digest = _spy
try:
    verify_webhook(SECRET, b"{}", sign(SECRET, 1000, b"{}"), now=1000)
finally:
    _hmac.compare_digest = _orig
assert _calls, "沒有呼叫 hmac.compare_digest"` },
    ],
    hints: ['簽章的輸入是 f"{t}.".encode() + body，跟發送端完全一樣才算得出相同的值。', 'header.split(",") 之後每段再 split("=", 1)；整段解析包在 try/except (ValueError, KeyError)。'],
  },
  {
    id: 'xss-csrf-1', skill: 'xss-csrf', kind: 'js', level: 1,
    title: '輸出到 HTML 前的跳脫',
    prompt: '伺服器端把使用者輸入放進 HTML 時，要先跳脫成實體，瀏覽器才會把它當文字而不是標籤。實作 `escapeHtml(s)`，轉換這五個字元：\n\n- `&` → `&amp;`\n- `<` → `&lt;`\n- `>` → `&gt;`\n- `"` → `&quot;`\n- `\'` → `&#39;`\n\n要注意：`&` 必須最先處理（或一次對應替換），否則 `<` 變成的 `&lt;` 會再被轉成 `&amp;lt;`。引號也要跳脫，因為輸入可能被放進屬性值裡（`<input value="…">`）。不是字串的輸入先轉成字串，`null` / `undefined` 回空字串。\n\n這個函式只適用於 HTML 內文與**加了引號**的屬性值；放進 `<script>`、`href`、事件屬性、CSS 的值需要不同的處理。',
    starter: `function escapeHtml(s) {
  return String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const comment = '<img src=x onerror="alert(document.cookie)">'
console.log(\`<p>\${escapeHtml(comment)}</p>\`)
`,
    solution: `const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

function escapeHtml(s) {
  if (s === null || s === undefined) return ''
  // 一次掃過、逐字對應：不會把已經產生的 &lt; 再跳脫一次
  return String(s).replace(/[&<>"']/g, (ch) => ENTITIES[ch])
}

const comment = '<img src=x onerror="alert(document.cookie)">'
console.log(\`<p>\${escapeHtml(comment)}</p>\`)
`,
    tests: [
      { name: '標籤變成文字', code: `assertEqual(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;')` },
      { name: '屬性值裡的引號', code: `assertEqual(escapeHtml('" onfocus="alert(1)'), '&quot; onfocus=&quot;alert(1)')
assertEqual(escapeHtml("' autofocus onfocus='x"), '&#39; autofocus onfocus=&#39;x')` },
      { name: '& 最先處理，不會重複跳脫', code: `assertEqual(escapeHtml('a & b < c'), 'a &amp; b &lt; c')
assertEqual(escapeHtml('&lt;'), '&amp;lt;')` },
      { name: '非字串輸入', code: `assertEqual(escapeHtml(null), '')
assertEqual(escapeHtml(undefined), '')
assertEqual(escapeHtml(42), '42')` },
      { name: '一般文字不變', code: `assertEqual(escapeHtml('台北市 100 號'), '台北市 100 號')` },
    ],
    hints: ['`str.replace(/[&<>"\']/g, (ch) => 對照表[ch])` 一次處理全部字元，順序問題自然消失。', '實務上用模板引擎的自動跳脫（Jinja2 autoescape、React 的 JSX）而不是自己寫；這題是為了看清楚它在做什麼。'],
  },
  {
    id: 'secrets-1', skill: 'secrets', kind: 'python', level: 2,
    title: '掃描程式碼裡疑似金鑰的字串',
    prompt: 'gitleaks 這類工具在 commit 前掃描檔案，用規則找出疑似 secret。實作 `find_secrets(text)`，回傳 `[(行號, 種類), ...]`（行號從 1 開始，依行號排序；同一行只回報一次，取最先符合的規則）：\n\n- `aws_access_key`：`AKIA` 後面接 16 個大寫英文或數字\n- `github_token`：`ghp_` 後面接 36 個英數字\n- `private_key`：`-----BEGIN ` 開頭、`PRIVATE KEY-----` 結尾的標頭（中間可以有 `RSA ` 等字）\n- `hardcoded_password`：變數名稱含 `password` / `passwd` / `secret`（不分大小寫），後面接 `=` 或 `:` 與一個**引號包住的字串字面值**\n\n最後一條要避免誤報：`API_KEY = os.environ["API_KEY"]`（從環境變數讀）與 `PASSWORD_MIN_LENGTH = 12`（不是字串）都不算。\n\n起始碼只找了 `password` 這個字，誤報與漏報都有。',
    starter: `import re

# 假的測試資料：執行時才拼出完整字串（AKIAIOSFODNN7EXAMPLE 是 AWS 文件裡的範例金鑰）
FAKE_AWS = "AKIA" + "IOSFODNN7EXAMPLE"
FAKE_GH = "gh" + "p_" + "a1B2c3D4e5F6g7H8i9J0" * 2
FAKE_PEM = "-----BEGIN " + "RSA PRIVATE KEY-----"

SAMPLE = f"""# settings.py
DEBUG = False
AWS_ACCESS_KEY_ID = "{FAKE_AWS}"
GITHUB_TOKEN = '{FAKE_GH[:40]}'
DB_PASSWORD = "Tr0ub4dor&3"
API_KEY = os.environ["API_KEY"]
PASSWORD_MIN_LENGTH = 12
{FAKE_PEM}
"""


def find_secrets(text):
    hits = []
    for no, line in enumerate(text.splitlines(), start=1):
        if "password" in line.lower():
            hits.append((no, "hardcoded_password"))
    return hits


for hit in find_secrets(SAMPLE):
    print(hit)
`,
    solution: `import re

# 假的測試資料：執行時才拼出完整字串（AKIAIOSFODNN7EXAMPLE 是 AWS 文件裡的範例金鑰）
FAKE_AWS = "AKIA" + "IOSFODNN7EXAMPLE"
FAKE_GH = "gh" + "p_" + "a1B2c3D4e5F6g7H8i9J0" * 2
FAKE_PEM = "-----BEGIN " + "RSA PRIVATE KEY-----"

SAMPLE = f"""# settings.py
DEBUG = False
AWS_ACCESS_KEY_ID = "{FAKE_AWS}"
GITHUB_TOKEN = '{FAKE_GH[:40]}'
DB_PASSWORD = "Tr0ub4dor&3"
API_KEY = os.environ["API_KEY"]
PASSWORD_MIN_LENGTH = 12
{FAKE_PEM}
"""


RULES = [
    ("aws_access_key", re.compile(r"\\bAKIA[0-9A-Z]{16}\\b")),
    ("github_token", re.compile(r"\\bghp_[A-Za-z0-9]{36}\\b")),
    ("private_key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    # 名稱含 password / passwd / secret，接 = 或 :，再接引號包住的字串（至少 1 個字元）
    ("hardcoded_password", re.compile(r"""(?i)\\b\\w*(password|passwd|secret)\\w*['"]?\\s*[:=]\\s*(['"])[^'"]+\\2""")),
]


def find_secrets(text):
    hits = []
    for no, line in enumerate(text.splitlines(), start=1):
        for kind, pattern in RULES:
            if pattern.search(line):
                hits.append((no, kind))
                break
    return hits


for hit in find_secrets(SAMPLE):
    print(hit)
`,
    tests: [
      { name: '範例檔：四種都抓到、沒有誤報', code: `assert find_secrets(SAMPLE) == [(3, "aws_access_key"), (4, "github_token"), (5, "hardcoded_password"), (8, "private_key")], find_secrets(SAMPLE)` },
      { name: '從環境變數讀、非字串的設定不算', code: `assert find_secrets('API_KEY = os.environ["API_KEY"]\\nPASSWORD_MIN_LENGTH = 12\\npassword = input()') == []` },
      { name: '各種寫法的密碼字面值', code: `assert find_secrets('db_passwd: "hunter2"') == [(1, "hardcoded_password")]
assert find_secrets("CLIENT_SECRET='abc123'") == [(1, "hardcoded_password")]
assert find_secrets('{"password": "x"}') == [(1, "hardcoded_password")]` },
      { name: '長度不符的不算金鑰', code: `assert find_secrets("AKIA" + "SHORT") == []
assert find_secrets("gh" + "p_" + "abc") == []` },
      { name: '其他種類的私鑰標頭', code: `assert find_secrets("-----BEGIN " + "OPENSSH PRIVATE KEY-----") == [(1, "private_key")]
assert find_secrets("-----BEGIN " + "PUBLIC KEY-----") == []` },
    ],
    hints: ['每條規則一個 re.compile，逐行套用，找到第一個符合的就 break。', '密碼規則可以寫成 `(?i)\\b\\w*(password|passwd|secret)\\w*[\'"]?\\s*[:=]\\s*([\'"])[^\'"]+\\2`：名稱後面允許一個引號（JSON 的鍵），`\\2` 要求值的結尾引號與開頭相同。'],
  },
  {
    id: 'supply-chain-1', skill: 'supply-chain', kind: 'python', level: 2,
    title: '安裝前比對 lockfile 的雜湊',
    prompt: '`uv.lock`、`poetry.lock`、`pip install --require-hashes` 都會記下每個套件檔案的 sha256，安裝前比對：版本號相同不代表內容相同，檔案被掉包時只有雜湊會不一樣。\n\n實作 `verify_downloads(lock, downloads)`，回傳問題清單 `[(檔名, 問題), ...]`，依檔名排序：\n\n- `"hash_mismatch"`：檔案在 lockfile 裡，但內容的 sha256 跟記錄的不同\n- `"not_in_lock"`：下載了 lockfile 沒有列的檔案\n- `"missing"`：lockfile 列了，但沒有下載到\n\n全部正確時回傳空陣列。起始碼只比對版本號（從檔名猜），掉包的檔案照樣通過。',
    starter: `import hashlib

# 下載到的套件檔案（內容是假的，只是為了算雜湊）
DOWNLOADS = {
    "requests-2.32.3-py3-none-any.whl": b"requests wheel bytes",
    "idna-3.10-py3-none-any.whl": b"idna wheel bytes (tampered)",
    "certifi-2024.8.30-py3-none-any.whl": b"certifi wheel bytes",
    "colorama-0.4.6-py2.py3-none-any.whl": b"colorama wheel bytes",
}

# lockfile 記下的版本與 sha256（idna 的內容被換過；colorama 不在 lockfile 裡；urllib3 沒有下載到）
LOCK = {
    "requests": {"version": "2.32.3", "file": "requests-2.32.3-py3-none-any.whl",
                 "sha256": hashlib.sha256(b"requests wheel bytes").hexdigest()},
    "idna": {"version": "3.10", "file": "idna-3.10-py3-none-any.whl",
             "sha256": hashlib.sha256(b"idna wheel bytes").hexdigest()},
    "certifi": {"version": "2024.8.30", "file": "certifi-2024.8.30-py3-none-any.whl",
                "sha256": hashlib.sha256(b"certifi wheel bytes").hexdigest()},
    "urllib3": {"version": "2.2.3", "file": "urllib3-2.2.3-py3-none-any.whl",
                "sha256": hashlib.sha256(b"urllib3 wheel bytes").hexdigest()},
}


def verify_downloads(lock, downloads):
    problems = []
    for name, entry in lock.items():
        for filename in downloads:
            if filename.startswith(name + "-") and entry["version"] not in filename:
                problems.append((filename, "version_mismatch"))
    return sorted(problems)


for problem in verify_downloads(LOCK, DOWNLOADS):
    print(problem)
`,
    solution: `import hashlib

# 下載到的套件檔案（內容是假的，只是為了算雜湊）
DOWNLOADS = {
    "requests-2.32.3-py3-none-any.whl": b"requests wheel bytes",
    "idna-3.10-py3-none-any.whl": b"idna wheel bytes (tampered)",
    "certifi-2024.8.30-py3-none-any.whl": b"certifi wheel bytes",
    "colorama-0.4.6-py2.py3-none-any.whl": b"colorama wheel bytes",
}

# lockfile 記下的版本與 sha256（idna 的內容被換過；colorama 不在 lockfile 裡；urllib3 沒有下載到）
LOCK = {
    "requests": {"version": "2.32.3", "file": "requests-2.32.3-py3-none-any.whl",
                 "sha256": hashlib.sha256(b"requests wheel bytes").hexdigest()},
    "idna": {"version": "3.10", "file": "idna-3.10-py3-none-any.whl",
             "sha256": hashlib.sha256(b"idna wheel bytes").hexdigest()},
    "certifi": {"version": "2024.8.30", "file": "certifi-2024.8.30-py3-none-any.whl",
                "sha256": hashlib.sha256(b"certifi wheel bytes").hexdigest()},
    "urllib3": {"version": "2.2.3", "file": "urllib3-2.2.3-py3-none-any.whl",
                "sha256": hashlib.sha256(b"urllib3 wheel bytes").hexdigest()},
}


def verify_downloads(lock, downloads):
    expected = {entry["file"]: entry["sha256"] for entry in lock.values()}
    problems = []
    for filename, content in downloads.items():
        if filename not in expected:
            problems.append((filename, "not_in_lock"))
        elif hashlib.sha256(content).hexdigest() != expected[filename]:
            problems.append((filename, "hash_mismatch"))
    for filename in expected:
        if filename not in downloads:
            problems.append((filename, "missing"))
    return sorted(problems)


for problem in verify_downloads(LOCK, DOWNLOADS):
    print(problem)
`,
    tests: [
      { name: '範例：掉包、多出、缺少都找到', code: `assert verify_downloads(LOCK, DOWNLOADS) == [("colorama-0.4.6-py2.py3-none-any.whl", "not_in_lock"), ("idna-3.10-py3-none-any.whl", "hash_mismatch"), ("urllib3-2.2.3-py3-none-any.whl", "missing")], verify_downloads(LOCK, DOWNLOADS)` },
      { name: '全部相符時沒有問題', code: `_d = {"requests-2.32.3-py3-none-any.whl": b"requests wheel bytes"}
_l = {"requests": LOCK["requests"]}
assert verify_downloads(_l, _d) == []` },
      { name: '版本號相同、內容不同也要擋', code: `_d = {"requests-2.32.3-py3-none-any.whl": b"evil"}
_l = {"requests": LOCK["requests"]}
assert verify_downloads(_l, _d) == [("requests-2.32.3-py3-none-any.whl", "hash_mismatch")]` },
    ],
    hints: ['先把 lock 轉成 {檔名: sha256} 的 dict，之後兩個方向各掃一次：下載的檔案在不在 lock 裡、lock 的檔案有沒有下載到。', 'hashlib.sha256(content).hexdigest() 算出 64 個 hex 字元，直接跟記錄比。'],
  },
  {
    id: 'logs-pii-1', skill: 'logs-pii', kind: 'python', level: 2,
    title: '結構化日誌的敏感欄位處理',
    prompt: '實作 `sanitize(event)`，回傳一份可以安全寫進日誌的**新** dict（不要改到傳進來的原物件）：\n\n1. **欄位白名單**：只保留 `ALLOWED_FIELDS` 裡的鍵，其他（例如 `body`）整個丟掉\n2. **標頭**：`headers` 只保留 `ALLOWED_HEADERS` 裡的（比對時不分大小寫，輸出的鍵用小寫）；`authorization` 與 `cookie` 的值換成 `"[REDACTED]"`\n3. **query string**：`url` 裡的 `token`、`password`、`api_key`、`id_no` 參數值換成 `"REDACTED"`，其他參數與順序不變，沒有 query string 的 URL 原樣保留\n\n起始碼用黑名單只刪了 `password` 欄位，`body`、`Authorization` 與 URL 裡的 token 全都留著。',
    starter: `from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

ALLOWED_FIELDS = {"ts", "level", "event", "request_id", "method", "url", "status", "duration_ms", "headers"}
ALLOWED_HEADERS = {"user-agent", "content-type", "accept", "authorization", "cookie"}
REDACT_HEADERS = {"authorization", "cookie"}
SENSITIVE_PARAMS = {"token", "password", "api_key", "id_no"}


def sanitize(event):
    out = dict(event)
    out.pop("password", None)
    return out


event = {
    "ts": "2026-10-02T09:14:03+08:00", "level": "INFO", "event": "http_request",
    "request_id": "req-7d1c", "method": "GET", "status": 200, "duration_ms": 31,
    "url": "/reset?token=abc123&lang=zh-TW",
    "headers": {"User-Agent": "demo/1.0", "Authorization": "Bearer demo-token-0123456789", "X-Forwarded-For": "203.0.113.7"},
    "body": {"email": "alice@example.com"},
}
print(sanitize(event))
`,
    solution: `from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

ALLOWED_FIELDS = {"ts", "level", "event", "request_id", "method", "url", "status", "duration_ms", "headers"}
ALLOWED_HEADERS = {"user-agent", "content-type", "accept", "authorization", "cookie"}
REDACT_HEADERS = {"authorization", "cookie"}
SENSITIVE_PARAMS = {"token", "password", "api_key", "id_no"}


def redact_url(url):
    parts = urlsplit(url)
    if not parts.query:
        return url
    params = [(k, "REDACTED" if k.lower() in SENSITIVE_PARAMS else v)
              for k, v in parse_qsl(parts.query, keep_blank_values=True)]
    return urlunsplit(parts._replace(query=urlencode(params)))


def sanitize(event):
    out = {k: v for k, v in event.items() if k in ALLOWED_FIELDS}
    if isinstance(out.get("headers"), dict):
        headers = {}
        for name, value in out["headers"].items():
            key = name.lower()
            if key in ALLOWED_HEADERS:
                headers[key] = "[REDACTED]" if key in REDACT_HEADERS else value
        out["headers"] = headers
    if isinstance(out.get("url"), str):
        out["url"] = redact_url(out["url"])
    return out


event = {
    "ts": "2026-10-02T09:14:03+08:00", "level": "INFO", "event": "http_request",
    "request_id": "req-7d1c", "method": "GET", "status": 200, "duration_ms": 31,
    "url": "/reset?token=abc123&lang=zh-TW",
    "headers": {"User-Agent": "demo/1.0", "Authorization": "Bearer demo-token-0123456789", "X-Forwarded-For": "203.0.113.7"},
    "body": {"email": "alice@example.com"},
}
print(sanitize(event))
`,
    tests: [
      { name: '白名單之外的欄位被丟掉', code: `_r = sanitize({"event": "x", "body": {"email": "a@example.com"}, "password": "p", "status": 200})
assert _r == {"event": "x", "status": 200}, _r` },
      { name: '標頭：只留白名單、敏感值遮罩、鍵轉小寫', code: `_r = sanitize({"headers": {"User-Agent": "ua", "Authorization": "Bearer t", "Cookie": "sid=1", "X-Forwarded-For": "203.0.113.7"}})
assert _r["headers"] == {"user-agent": "ua", "authorization": "[REDACTED]", "cookie": "[REDACTED]"}, _r["headers"]` },
      { name: 'query string 的敏感參數被遮罩、其他不變', code: `_r = sanitize({"url": "/reset?token=abc123&lang=zh-TW"})
assert _r["url"] == "/reset?token=REDACTED&lang=zh-TW", _r["url"]
_r = sanitize({"url": "/search?q=db&api_key=k1&page=2"})
assert _r["url"] == "/search?q=db&api_key=REDACTED&page=2", _r["url"]` },
      { name: '沒有 query string 的 URL 原樣保留', code: `assert sanitize({"url": "/api/orders/104"})["url"] == "/api/orders/104"` },
      { name: '不改到原本的 event', code: `_e = {"url": "/x?token=t", "headers": {"Cookie": "sid=1"}, "body": "b"}
sanitize(_e)
assert _e == {"url": "/x?token=t", "headers": {"Cookie": "sid=1"}, "body": "b"}, _e` },
    ],
    hints: ['先用 dict comprehension 只挑白名單的鍵，產生新的 dict；headers 也重建一份新的 dict，不要在原物件上改。', 'urlsplit 拆出 query，parse_qsl 轉成 (鍵, 值) 清單、改值後 urlencode 回去，再用 parts._replace(query=…) 與 urlunsplit 組回 URL。'],
  },
]

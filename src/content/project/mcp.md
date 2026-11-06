## 這階段要做出什麼

前八個階段的掛號系統已經上線。資訊室接到一個需求：同仁想讓自己的 agent 或 CLI 直接查 **staging 環境**的掛號資料來驗證想法——「上週三早診的取消率」「某診次還剩幾個號」——而不是每次都開工單請人撈。條件寫得很清楚：

| 條件 | 做法 |
|---|---|
| 只能讀 | MCP server 只提供查詢工具；連資料庫用唯讀帳號 |
| 要知道是誰查的 | 用組織既有的 GitLab 當授權伺服器（OAuth），token 代表真人；每次查詢寫稽核紀錄 |
| 敏感欄位不能原樣輸出 | 身分證字號、電話、姓名在回傳前遮罩，agent 永遠拿不到原值 |
| 不同人能查的範圍不同 | 依使用者決定可查的表（allowlist） |

做出來的是一個走 HTTP 的 MCP server：`POST /mcp` 收 JSON-RPC，提供查詢工具。重點不在 MCP 的訊息格式，而在前面那道門與後面那層遮罩。

以下依 MCP 授權規格的概念寫；細節（client 註冊方式、metadata 欄位、各版本差異）以 modelcontextprotocol.io 的規格為準。相關的課：[MCP 的授權](#/skill/mcp-authorization)、[金鑰的範圍與壽命](#/skill/key-scope-lifetime)、[日誌與稽核紀錄裡的個資](#/skill/logs-pii)、[集中式身分閘道](#/skill/identity-gateway)。

## 資料流：四段

```text
 同仁的 agent / CLI            MCP server（clinic.example）          GitLab（gitlab.example）
        │                              │                                   │
 ① 發現 │ POST /mcp（沒帶 token）        │                                   │
        │─────────────────────────────▶│                                   │
        │ 401 WWW-Authenticate:         │                                   │
        │   Bearer resource_metadata=…  │                                   │
        │◀─────────────────────────────│                                   │
        │ GET /.well-known/oauth-protected-resource                         │
        │─────────────────────────────▶│                                   │
        │ {"resource": …, "authorization_servers": ["https://gitlab.example"]}
        │◀─────────────────────────────│                                   │
 ② 授權 │ 開瀏覽器到 GitLab：Authorization Code + PKCE                        │
        │◀──────────────────────── 登入、同意 ────────────────────────────▶│
        │ POST /oauth/token（code + code_verifier）                          │
        │──────────────────────────────────────────────────────────────────▶│
        │ access_token（短效）＋ refresh_token（存進本機 keyring）              │
        │◀──────────────────────────────────────────────────────────────────│
 ③ 呼叫 │ POST /mcp  Authorization: Bearer <access_token>                   │
        │─────────────────────────────▶│ 驗 token（簽章／或向 GitLab 查）     │
        │                              │ 檢查 aud、exp、scope                │
        │                              │ 這位使用者能查這張表嗎？             │
        │                              │ 用唯讀帳號查 staging 資料庫          │
        │                              │ 遮罩身分證字號、電話、姓名           │
        │                              │ 寫稽核：誰、何時、哪張表、幾列       │
        │ 結果（已遮罩）                 │                                   │
        │◀─────────────────────────────│                                   │
 ④ 更新 │ access_token 過期 → 401       │                                   │
        │ POST /oauth/token（grant_type=refresh_token）                       │
        │──────────────────────────────────────────────────────────────────▶│
        │ 新的 access_token（通常也換新的 refresh_token）                       │
        │◀──────────────────────────────────────────────────────────────────│
```

③ 是每個請求都要做的事；② ④ 發生在 client 與 GitLab 之間，MCP server 不參與。

## 設計決策與取捨

### 發現：401 要帶路標

client 第一次連上來不知道該去哪裡登入。server 的回應不能只是一個 401，要在 `WWW-Authenticate` 標頭帶 `resource_metadata`，指向這個受保護資源的 metadata（RFC 9728，https://www.rfc-editor.org/rfc/rfc9728）：

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://clinic.example/.well-known/oauth-protected-resource"
```

metadata 是一份靜態 JSON，說明「我是誰、我信任哪個授權伺服器」：

```json
{
  "resource": "https://clinic.example/mcp",
  "authorization_servers": ["https://gitlab.example"],
  "scopes_supported": ["clinic:read"],
  "bearer_methods_supported": ["header"]
}
```

`resource` 是這個 MCP server 的資源識別碼，驗 token 的 `aud` 就是對它。這份文件沒有祕密，不用驗證就能讀。

### 授權：公開客戶端、PKCE、refresh token 留在 keyring

agent 與 CLI 裝在同仁的電腦上，藏不住 client secret，是**公開客戶端**，授權碼流程一定搭配 PKCE：送出隨機 `code_verifier` 的 SHA-256 當 `code_challenge`，換 token 時再送原本的 verifier。攔到授權碼的人沒有 verifier，換不到 token。

GitLab 發回兩樣東西，去處不同：

| | 壽命 | 放哪裡 | 用途 |
|---|---|---|---|
| access token | 短（例如 15 分鐘到 2 小時，依 GitLab 設定） | 記憶體 | 每次 `POST /mcp` 帶在 `Authorization` 標頭 |
| refresh token | 長 | 作業系統的 keyring（macOS Keychain、Windows 憑證管理員、Linux Secret Service） | 過期時換新的 access token |

access token 短效，被 log 或 proxy 錄下來時可用的時間有上限。refresh token 才是長效祕密，不能寫在設定檔、不能進環境變數、不能被 agent 印到對話裡（見 [credential 隔離](#/skill/agent-credential-isolation)）。

GitLab 的 access token 是 JWT 還是不透明字串，依版本與設定而異：JWT 用 GitLab 的 JWKS 驗 RS256 簽章，不透明字串向 GitLab 查詢。兩種都要再做 claims 檢查。授權伺服器若無法把 token 綁到這個 MCP server（`aud`），常見作法是前面放一層身分閘道，換發自己簽的短效 token。這一點依組織 GitLab 的設定而定，不確定時先實測 token 內容。

### 呼叫：驗 token 的順序

每個 `POST /mcp` 都要走完這五步，順序固定、缺一不可：

| 步驟 | 失敗時 | 回應 |
|---|---|---|
| 1. 簽章（JWT）或向授權伺服器查有效性（不透明 token） | 偽造、竄改、已撤銷 | 401 `invalid_token` |
| 2. `iss` 是信任的授權伺服器 | 別的 IdP 簽的 | 401 `invalid_token` |
| 3. `aud` 包含 `https://clinic.example/mcp` | 發給別的服務的 token 被拿來重放 | 401 `invalid_token` |
| 4. `exp` 未過（容許幾十秒時鐘誤差） | 過期 | 401 `invalid_token` |
| 5. `scope` 包含工具需要的 `clinic:read` | 權限不足 | 403 `insufficient_scope` |

401 代表「這個 token 不能用」，client 該去拿新的；403 代表「token 沒問題，權限不夠」，client 要帶著 `scope` 提示去要更多權限。第 3 步最容易被省略：簽章只證明「這是 GitLab 發的」，不證明「這是發給掛號 MCP server 的」。

### 誰能查哪張表、用什麼帳號查

token 驗過之後知道「是誰」（`sub`），接著是「這個人能查什麼」。兩層：

- **使用者 allowlist**：`{"u_lin": {"sessions", "appointments"}, "u_chen": {"sessions"}}`。表名完全比對，不在清單就拒絕；清單從設定載入。
- **資料庫唯讀帳號**：只有 `SELECT`、只對允許的 schema。allowlist 寫錯或 SQL 組裝有漏洞時，資料庫層仍不讓它寫入。

allowlist 是依人區分的控制，唯讀帳號是兜底，兩層都要有。

### 遮罩在輸出前，不在查詢後

遮罩放在**送出回應之前**，依欄位名稱套規則：

| 欄位 | 規則 | 範例 |
|---|---|---|
| 身分證字號 | 留前 1 碼與後 2 碼 | `A123456789` → `A*******89` |
| 電話 | 留後 3 碼 | `0912345678` → `*******678` |
| 姓名 | 只留姓 | `王小明` → `王**` |
| 自由文字（備註） | 掃身分證字號與手機格式 | `病患A123456789來電` → `病患A*******89來電` |

規則由 policy 決定（欄位名稱 → 遮罩方式），不在 policy 裡的欄位原樣輸出，所以**新增敏感欄位要記得補 policy**；可以加一道測試，要求每張允許的表的每個欄位都在「已審過」清單裡。自由文字裡身分證字號緊鄰中文時，`\b` 抓不到，要用「前後不是英數字」的條件（第 8 階段踩過）。

### 稽核紀錄：誰、何時、哪張表、幾列

每一次查詢——放行或拒絕——都寫一筆稽核紀錄：`user`（token 的 `sub`）、`table`、`allowed`、`row_count`、`ts`。它和第 8 階段的一般日誌不同：

- **不能漏**：寫稽核失敗，查詢就算失敗。被拒絕的查詢也要記（`allowed: false`）。
- **不含內容**：不記查詢結果，也不記 `WHERE` 的值，否則稽核系統變成第二份病患資料。
- **只能新增**：MCP server 的帳號對稽核表只有 INSERT。

### 更新：refresh 換新 token

access token 過期後 server 回 401，client 用 keyring 裡的 refresh token 換新的再重送。授權伺服器若同時換發新的 refresh token（rotation），要存回 keyring；refresh 失敗就回到 ② 重新登入，不要無限重試。

## 關鍵程式

### 驗 claims 並回 401／403

下面用 HMAC（HS256）示範簽章，讓整段可以在瀏覽器裡跑；正式環境 GitLab 用 RS256 簽，MCP server 要從 GitLab 的 JWKS 取公鑰驗簽章，之後對 claims 的檢查完全相同。六種請求各走到哪一步被擋下，看輸出：

```python run
import base64
import hashlib
import hmac
import json
import time

# ── 示範用：授權伺服器用 HS256 簽 token。正式環境 GitLab 用 RS256 簽，
#    MCP server 從 GitLab 的 JWKS 取公鑰驗簽章；claims 的檢查方式完全相同 ──
SECRET = b"demo-secret-not-for-production"
ISSUER = "https://gitlab.example"
RESOURCE = "https://clinic.example/mcp"              # 這個 MCP server 的資源識別碼
METADATA = "https://clinic.example/.well-known/oauth-protected-resource"


def b64u(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def unb64u(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def sign(claims):
    head = b64u(json.dumps({"alg": "HS256", "typ": "at+jwt"}).encode())
    body = b64u(json.dumps(claims).encode())
    sig = hmac.new(SECRET, f"{head}.{body}".encode(), hashlib.sha256).digest()
    return f"{head}.{body}.{b64u(sig)}"


class Reject(Exception):
    def __init__(self, status, error, detail=None, scope=None):
        super().__init__(error)
        self.status, self.error, self.detail, self.scope = status, error, detail, scope

    def header(self):
        parts = [f'error="{self.error}"']
        if self.detail:
            parts.append(f'error_description="{self.detail}"')
        if self.scope:
            parts.append(f'scope="{self.scope}"')
        parts.append(f'resource_metadata="{METADATA}"')
        return "Bearer " + ", ".join(parts)


def verify(token, required_scope, now):
    try:
        head, body, sig = token.split(".")
        header = json.loads(unb64u(head))
        claims = json.loads(unb64u(body))
    except (ValueError, UnicodeDecodeError):
        raise Reject(401, "invalid_token", "malformed")
    if header.get("alg") != "HS256":                  # 允許清單，不接受 none 或別的演算法
        raise Reject(401, "invalid_token", "alg not allowed")
    want = hmac.new(SECRET, f"{head}.{body}".encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(want, unb64u(sig)):
        raise Reject(401, "invalid_token", "bad signature")
    if claims.get("iss") != ISSUER:
        raise Reject(401, "invalid_token", "unknown issuer")
    aud = claims.get("aud")
    if RESOURCE not in (aud if isinstance(aud, list) else [aud]):
        raise Reject(401, "invalid_token", "audience mismatch")
    if now > claims.get("exp", 0) + 30:              # 容許 30 秒時鐘誤差
        raise Reject(401, "invalid_token", "expired")
    if required_scope not in claims.get("scope", "").split():
        raise Reject(403, "insufficient_scope", scope=required_scope)
    return claims


def handle(headers, now):
    auth = headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        # 沒帶 token：401，只給路標，不洩漏其他資訊
        return 401, {"WWW-Authenticate": f'Bearer resource_metadata="{METADATA}"'}
    try:
        claims = verify(auth[len("Bearer "):], "clinic:read", now)
    except Reject as r:
        return r.status, {"WWW-Authenticate": r.header()}
    return 200, {"sub": claims["sub"], "scope": claims["scope"]}


now = int(time.time())
base = {"iss": ISSUER, "aud": RESOURCE, "sub": "u_lin", "scope": "clinic:read", "iat": now, "exp": now + 900}
good = sign(base)
head, _, sig = good.split(".")
cases = {
    "沒帶 token": {},
    "正常的 token": {"Authorization": f"Bearer {good}"},
    "aud 是別的服務": {"Authorization": "Bearer " + sign({**base, "aud": "https://hr.example/mcp"})},
    "過期 10 分鐘": {"Authorization": "Bearer " + sign({**base, "exp": now - 600})},
    "scope 只有 openid": {"Authorization": "Bearer " + sign({**base, "scope": "openid"})},
    "改了 payload": {"Authorization": f"Bearer {head}.{b64u(json.dumps({**base, 'sub': 'u_admin'}).encode())}.{sig}"},
}
for name, headers in cases.items():
    status, out = handle(headers, now)
    print(f"{status}  {name:<14} {out}")
```

「改了 payload」只換中間一段、沿用原本的簽章，簽章對整串算，所以驗不過。

### 授權與更新（client 端，需要真的 GitLab）

PKCE 的 verifier 與 challenge 用標準函式庫就能算；之後的授權頁、換 token、refresh 都要連 GitLab，這段不能在瀏覽器執行，列出骨架：

```python
import base64
import hashlib
import json
import secrets
import urllib.parse
import urllib.request

GITLAB = "https://gitlab.example"
CLIENT_ID = "clinic-mcp-cli"                 # 公開客戶端：沒有 client secret
REDIRECT = "http://127.0.0.1:53682/callback"

# ② 授權：PKCE
verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
auth_url = f"{GITLAB}/oauth/authorize?" + urllib.parse.urlencode({
    "response_type": "code", "client_id": CLIENT_ID, "redirect_uri": REDIRECT,
    "scope": "openid", "state": secrets.token_urlsafe(16),
    "code_challenge": challenge, "code_challenge_method": "S256",
})
# 開瀏覽器到 auth_url；本機的 callback 接到 code 之後：
def exchange(code):
    body = urllib.parse.urlencode({
        "grant_type": "authorization_code", "code": code, "redirect_uri": REDIRECT,
        "client_id": CLIENT_ID, "code_verifier": verifier,
    }).encode()
    with urllib.request.urlopen(f"{GITLAB}/oauth/token", body) as resp:
        tokens = json.load(resp)
    keyring_set("clinic-mcp", "refresh_token", tokens["refresh_token"])   # 長效祕密進 keyring
    return tokens["access_token"]                                          # 短效的留在記憶體

# ④ 更新：收到 401 invalid_token 時
def refresh():
    body = urllib.parse.urlencode({
        "grant_type": "refresh_token", "client_id": CLIENT_ID,
        "refresh_token": keyring_get("clinic-mcp", "refresh_token"),
    }).encode()
    with urllib.request.urlopen(f"{GITLAB}/oauth/token", body) as resp:
        tokens = json.load(resp)
    if "refresh_token" in tokens:                                          # rotation：存新的、丟舊的
        keyring_set("clinic-mcp", "refresh_token", tokens["refresh_token"])
    return tokens["access_token"]
```

`keyring_set`／`keyring_get` 代表作業系統 keyring 的介面；scope 名稱以組織 GitLab 的設定為準。

### 遮罩與稽核

遮罩依 policy 對每一列套用；稽核紀錄只有五個欄位。最後一行 `assert` 確認原始的身分證字號沒有出現在任何輸出裡：

```python run
import json
import re
from datetime import datetime, timezone

# 遮罩規則：欄位名稱 → 遮罩方式。沒列在這裡的欄位原樣輸出，所以新加一個敏感欄位時要記得補
POLICY = {"national_id": "id", "phone": "phone", "name": "name", "note": "text"}

# 自由文字裡的身分證字號與手機：前後不是英數字就算（不能用 \b，中文緊鄰時 \b 抓不到）
ID_IN_TEXT = re.compile(r"(?<![A-Za-z0-9])[A-Z]\d{9}(?![0-9])")
MOBILE_IN_TEXT = re.compile(r"(?<![0-9])09\d{8}(?![0-9])")


def mask_value(value, kind):
    if value is None:
        return None
    s = str(value)
    if kind == "id":                       # A123456789 → A*******89
        return s if len(s) < 4 else s[0] + "*" * (len(s) - 3) + s[-2:]
    if kind == "phone":                    # 0912345678 → *******678
        return "*" * max(len(s) - 3, 0) + s[-3:]
    if kind == "name":                     # 王小明 → 王**
        return s[:1] + "*" * (len(s) - 1)
    if kind == "text":
        s = ID_IN_TEXT.sub(lambda m: mask_value(m.group(), "id"), s)
        return MOBILE_IN_TEXT.sub(lambda m: mask_value(m.group(), "phone"), s)
    raise ValueError(f"不認得的遮罩方式 {kind!r}")


def mask_row(row, policy):
    return {k: (mask_value(v, policy[k]) if k in policy else v) for k, v in row.items()}


def audit(user, table, rows, allowed=True):
    # 只記「誰、何時、哪張表、幾列、有沒有放行」。不記查詢結果，也不記 WHERE 條件裡的值
    return {
        "user": user["sub"],
        "table": table,
        "allowed": allowed,
        "row_count": len(rows),
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


rows = [
    {"id": 41, "name": "王小明", "national_id": "A123456789", "phone": "0912345678", "note": "病患A123456789來電0912345678改期", "status": "booked"},
    {"id": 42, "name": "陳小華", "national_id": "B234567890", "phone": None, "note": None, "status": "cancelled"},
]
masked = [mask_row(r, POLICY) for r in rows]
for r in masked:
    print(json.dumps(r, ensure_ascii=False))

entry = audit({"sub": "u_lin", "scope": "clinic:read"}, "appointments", rows)
print(json.dumps(entry, ensure_ascii=False))
assert "A123456789" not in json.dumps(masked + [entry], ensure_ascii=False)
print("原始資料沒有出現在輸出或稽核紀錄裡")
```

## 常見錯誤

**401 沒帶 `WWW-Authenticate`。** client 不知道去哪裡登入，使用者只看到「連線失敗」。用 curl 不帶 token 打一次 `POST /mcp`，確認標頭在。

**`aud` 不對。** token 是發給組織裡另一個服務的，簽章、期限都正確。沒有錯誤訊息，要用測試釘住：`aud` 是別的網址，預期 401 `audience mismatch`。

**token 過期。** client 收到 401 沒有走 refresh，或 server 沒容許時鐘誤差，造成時好時壞。主機跑 NTP，容許值約 30 秒。

**agent 把 token 寫進設定檔。** agent 把 token 寫進專案的 `.mcp.json`，接著被 commit。設定檔只放 server 網址，refresh token 只進 keyring；grep 專案目錄的 `Bearer ` 與 `refresh_token`。

**遮罩漏掉。** 新欄位沒補 policy、自由文字用 `\b`、某個工具的輸出路徑沒經過遮罩。遮罩放在所有回應共用的出口，用「原值不得出現在回應任何地方」的整體測試。

**稽核沒寫到。** 寫失敗只記 WARNING 照常回結果，或只記放行的。稽核失敗要讓查詢失敗。

## 驗收題在測什麼

**401／403 與錯誤碼**：沒帶 Bearer 回 401 與 `resource_metadata`；簽章、`aud`、`exp` 各回 401 `invalid_token` 與固定的 `error_description`；scope 不足回 403 `insufficient_scope`。

**遮罩**：三種欄位的格式、中文緊鄰、`None`、不誤遮、不改原 row、未列在 policy 的欄位原樣。

**allowlist 與稽核**：不在清單的表或使用者一律拒絕且不碰資料庫；每次查詢一筆稽核，裡面不出現結果的任何值。

對 GitLab 的實際 OAuth 往返與 keyring 不在瀏覽器驗收範圍內。

## 動手

1. 在 Playground 執行「驗 claims」那段，把 `aud` 那段檢查註解掉，看「aud 是別的服務」變成 200。
2. 執行遮罩那段，刪掉 policy 的 `"note": "text"`，看 `assert` 失敗。
3. 做下面三道驗收題。

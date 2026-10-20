## 從一個具體問題開始：寫給天氣 server 的 token，打開了工單 server

公司內部有兩個走 HTTP 的 MCP server，都接同一個授權伺服器 `auth.example.com`：

- `https://tickets.example.com/mcp`：工單系統，工具有 `list_tickets`、`close_ticket`
- `https://weather.example.com/mcp`：某個團隊順手做的天氣查詢

工單 server 驗 token 的程式只做了一件事：用授權伺服器的公鑰驗簽章。簽章對，就放行。

某天天氣 server 的主機被入侵。攻擊者在 log 裡撿到使用者連線時帶的 access token。這些 token 是同一個授權伺服器簽的，簽章完全正確，於是攻擊者把它們拿去打工單 server：

```http
POST /mcp HTTP/1.1
Host: tickets.example.com
Authorization: Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6IjIwMjYtMTAifQ.eyJhdWQiOiJodHRwczovL3dlYXRoZXIuZXhhbXBsZS5jb20vbWNwIi…
Content-Type: application/json

{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"close_ticket","arguments":{"id":"OPS-1182"}}}
```

成功了。token 的 `aud`（audience，受眾）寫的明明是 `https://weather.example.com/mcp`，但工單 server 沒有檢查。**簽章只證明「這是授權伺服器發的」，不證明「這是發給我的」**。

這一課講 MCP 規範怎麼把 OAuth 用在 MCP 上：client 怎麼從一個 401 一路找到該去哪裡登入、token 怎麼綁到特定的 MCP server、server 收到 token 要檢查哪幾件事，以及為什麼收到的 token 絕對不能往下游轉傳。

## 角色：MCP server 是受保護資源

MCP 規範的 Authorization 章節（[modelcontextprotocol.io](https://modelcontextprotocol.io) 的 specification）以 OAuth 2.1 為基礎，把角色對應成這樣：

| OAuth 角色 | 在 MCP 裡是誰 | 例子 |
|---|---|---|
| Resource Server（受保護資源） | MCP server | `tickets.example.com/mcp` |
| Client | MCP client（跑在 IDE、桌面 App、CLI agent 裡） | 代表使用者呼叫工具的那個程式 |
| Authorization Server | 簽發 token 的身分系統 | 公司 IdP 或專用授權伺服器 |
| Resource Owner | 使用者 | 在瀏覽器上按「同意」的人 |

幾個先講清楚的前提：

- 授權在 MCP 裡是選用的；規範的授權流程是針對 **HTTP 傳輸**。用 stdio 在本機啟動的 MCP server 不走這套流程，憑證通常由環境提供（這時 token 怎麼存，見 [CLI 與 Agent 的 token 存哪裡](#/skill/cli-token-storage)）。
- MCP client 多半是**公開客戶端**：裝在使用者電腦上，藏不住 client secret，所以授權碼流程一定要搭配 PKCE（細節見 [Device Code、PKCE、Client Credentials](#/skill/oauth-device-pkce)）。
- 規範會隨版本調整細節（例如 client 註冊的方式）。下面講的是穩定的骨架；實作時以官方最新版為準。

## 發現流程：從一個 401 開始

MCP client 第一次連到一個 server 時，什麼都不知道：不知道要不要登入、去哪裡登入、要什麼 scope。整條發現鏈靠三份 metadata 串起來：

```text
 MCP client                     MCP server                    授權伺服器
     │ ① POST /mcp（沒帶 token）      │                               │
     │─────────────────────────────▶│                               │
     │ ② 401 + WWW-Authenticate      │                               │
     │    resource_metadata=…        │                               │
     │◀─────────────────────────────│                               │
     │ ③ GET 受保護資源 metadata（RFC 9728）                          │
     │─────────────────────────────▶│                               │
     │   authorization_servers: [auth.example.com]                   │
     │◀─────────────────────────────│                               │
     │ ④ GET 授權伺服器 metadata（RFC 8414）                          │
     │──────────────────────────────────────────────────────────────▶│
     │   authorization_endpoint、token_endpoint、jwks_uri …           │
     │◀──────────────────────────────────────────────────────────────│
     │ ⑤（沒有 client_id 時）註冊 client，例如 RFC 7591               │
     │ ⑥ 授權碼 + PKCE，帶 resource=https://tickets.example.com/mcp   │
     │◀─────────────────── 瀏覽器登入、同意 ─────────────────────────▶│
     │ ⑦ POST /token（code + code_verifier + resource）               │
     │──────────────────────────────────────────────────────────────▶│
     │   access_token（aud = tickets.example.com/mcp）                │
     │◀──────────────────────────────────────────────────────────────│
     │ ⑧ POST /mcp，Authorization: Bearer …                           │
     │─────────────────────────────▶│ 驗 token → 執行工具              │
```

### ① ② 被拒絕，同時拿到線索

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://tickets.example.com/.well-known/oauth-protected-resource/mcp"
```

`resource_metadata` 這個參數由 RFC 9728 定義，指向這個受保護資源的 metadata。這個 401 是整條鏈的起點：server 如果只回 401、不帶 `WWW-Authenticate`，client 就無從得知該去哪裡登入。

### ③ 受保護資源 metadata：我信任哪個授權伺服器

```http
GET /.well-known/oauth-protected-resource/mcp HTTP/1.1
Host: tickets.example.com
```

```json
{
  "resource": "https://tickets.example.com/mcp",
  "authorization_servers": ["https://auth.example.com"],
  "scopes_supported": ["tickets.read", "tickets.write"],
  "bearer_methods_supported": ["header"]
}
```

`resource` 是這個 MCP server 的**資源識別碼**，後面申請 token 時要原封不動放進 `resource` 參數。client 要確認它和自己連的網址相符，避免被別的 server 冒用身分。

### ④ 授權伺服器 metadata：去哪登入、去哪換 token

```http
GET /.well-known/oauth-authorization-server HTTP/1.1
Host: auth.example.com
```

```json
{
  "issuer": "https://auth.example.com",
  "authorization_endpoint": "https://auth.example.com/authorize",
  "token_endpoint": "https://auth.example.com/token",
  "registration_endpoint": "https://auth.example.com/register",
  "jwks_uri": "https://auth.example.com/.well-known/jwks.json",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"]
}
```

RFC 8414 定義了這份文件的位置與欄位。client 從這裡拿到所有端點，不需要寫死；`code_challenge_methods_supported` 裡有 `S256`，代表支援 PKCE。

### ⑤ client 註冊

MCP client 和 MCP server 之間通常沒有事先的關係：使用者今天裝了一個新的 server，client 不可能預先在每個授權伺服器上都有 `client_id`。Dynamic Client Registration（RFC 7591）讓 client 自己到 `registration_endpoint` 註冊：

```http
POST /register HTTP/1.1
Host: auth.example.com
Content-Type: application/json

{
  "client_name": "Example Agent CLI",
  "redirect_uris": ["http://127.0.0.1:53682/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_method": "none"
}
```

`token_endpoint_auth_method: none` 表示這是沒有 secret 的公開客戶端。規範也描述了其他取得 client 身分的方式，各版本不同；企業環境常見的做法是關掉開放註冊，由管理員預先登記允許的 client。

### ⑥ ⑦ 授權碼 + PKCE，加上 resource

授權請求與 token 請求都要帶 `resource` 參數（RFC 8707 Resource Indicators），值就是第 ③ 步拿到的資源識別碼：

```http
GET /authorize?response_type=code
  &client_id=agent-cli-7f3a
  &redirect_uri=http%3A%2F%2F127.0.0.1%3A53682%2Fcallback
  &scope=tickets.read%20tickets.write
  &state=Qm9vbXN0YXRl
  &code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
  &code_challenge_method=S256
  &resource=https%3A%2F%2Ftickets.example.com%2Fmcp HTTP/1.1
Host: auth.example.com
```

```http
POST /token HTTP/1.1
Host: auth.example.com
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=SplxlOBeZQQYbYS6WxSbIA
&redirect_uri=http%3A%2F%2F127.0.0.1%3A53682%2Fcallback
&client_id=agent-cli-7f3a
&code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
&resource=https%3A%2F%2Ftickets.example.com%2Fmcp
```

`resource` 的作用是讓授權伺服器把 token 的 `aud` 設成這個 MCP server。拿到的 token 只對 `tickets.example.com/mcp` 有效；開頭那個「天氣 server 的 token 打開工單 server」的事件，靠的就是這一步加上 server 端的 audience 檢查來擋。

## 驗 token：簽章之外還有四件事

授權伺服器簽發的 JWT access token，解開 payload 大概長這樣：

```json
{
  "iss": "https://auth.example.com",
  "aud": "https://tickets.example.com/mcp",
  "sub": "u_4821",
  "client_id": "agent-cli-7f3a",
  "scope": "tickets.read tickets.write",
  "iat": 1792483200,
  "exp": 1792486800
}
```

MCP server 收到每一個請求都要依序檢查：

| 順序 | 檢查 | 失敗時代表什麼 |
|---|---|---|
| 1 | header 的 `alg` 在允許清單內（例如只收 `ES256`） | 有人想用 `none` 或演算法混淆攻擊繞過簽章（見 [JWT 解剖](#/skill/jwt)） |
| 2 | 用 header 的 `kid` 在 JWKS 找到對應公鑰 | 金鑰剛輪替（重新抓一次 JWKS），或 token 根本不是這個授權伺服器簽的 |
| 3 | 簽章正確 | 內容被竄改 |
| 4 | `iss` 是信任的授權伺服器 | 別的授權伺服器簽的 token |
| 5 | `aud` 是**自己的資源識別碼** | 發給別的服務的 token，被拿來重放 |
| 6 | `exp`（與 `nbf`）在有效時間內 | 過期 token；容許幾十秒的時鐘誤差即可 |
| 7 | `scope` 涵蓋這個工具需要的權限 | 權限不足，回 403 而不是 401 |

第 5 項就是開頭事件少掉的那一項。第 7 項要做到**每個工具**：`list_tickets` 要 `tickets.read`，`close_ticket` 要 `tickets.write`，在 `tools/call` 時依工具名稱檢查。

### JWKS 與金鑰輪替

授權伺服器把簽章用的公鑰以 JWK Set（RFC 7517）公布在 `jwks_uri`：

```json
{
  "keys": [
    { "kty": "EC", "crv": "P-256", "kid": "2026-10", "alg": "ES256", "use": "sig",
      "x": "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU",
      "y": "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0" },
    { "kty": "EC", "crv": "P-256", "kid": "2026-11", "alg": "ES256", "use": "sig",
      "x": "…", "y": "…" }
  ]
}
```

JWT header 裡的 `kid` 指出用哪一把簽的。輪替的順序是：

1. 授權伺服器產生新金鑰 `2026-11`，**先**加進 JWKS，但還不用它簽。
2. 等所有資源伺服器的 JWKS 快取都更新過（快取時間過了）。
3. 開始用 `2026-11` 簽新 token。
4. 舊 token 全部過期之後，才把 `2026-10` 從 JWKS 移除。

資源伺服器這一側：JWKS 要快取（不能每個請求都去抓），遇到不認得的 `kid` 時重新抓一次，並且限制重抓頻率，否則攻擊者送一堆亂編 `kid` 的 token 就能讓你一直打授權伺服器。

如果授權伺服器發的是不透明的 token（隨機字串，不是 JWT），資源伺服器無法自己驗，要呼叫授權伺服器的 introspection 端點（RFC 7662）查詢，檢查項目一樣：有效、`aud`、`scope`。

### 錯誤回應

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer error="invalid_token", error_description="audience mismatch", resource_metadata="https://tickets.example.com/.well-known/oauth-protected-resource/mcp"
```

```http
HTTP/1.1 403 Forbidden
WWW-Authenticate: Bearer error="insufficient_scope", scope="tickets.write"
```

`invalid_token` 與 `insufficient_scope` 是 RFC 6750（Bearer Token）定義的錯誤碼。401 代表「這個 token 不能用」，client 應該重新取得 token；403 代表「token 沒問題，但權限不夠」，client 可以帶著 `scope` 提示重新要求更多權限。

## 不要轉傳 token

工單 MCP server 的 `close_ticket` 最後要呼叫真正的工單系統 API（`api.tickets.internal`）。最省事的寫法是把收到的 Bearer token 原封不動帶過去：

```text
MCP client ──Bearer T（aud=tickets.example.com/mcp）──▶ MCP server ──同一個 T──▶ 工單 API
```

這叫 **token passthrough**，MCP 規範明確禁止。原因：

- **audience 對不上**。工單 API 如果有好好檢查 `aud`，會拒絕；如果它照單全收，代表它接受「發給任何人的 token」，開頭的事件就會在它身上重演。
- **MCP server 的控制被繞過**。速率限制、工具層的授權、稽核紀錄都在 MCP server。token 能直接打下游，攻擊者偷到之後就不必經過 MCP server。
- **稽核分不清是誰**。下游看到的是使用者的 token，不知道請求其實是經過某個 MCP server、由 agent 發出的。
- **權限混淆**（confused deputy）。MCP server 用使用者給它的憑證去做事，沒有自己的身分，出事時無法限縮。

正確的做法有兩種：

| 做法 | 下游看到的身分 | 適合 |
|---|---|---|
| MCP server 用**自己的憑證**（例如 Client Credentials 拿的服務 token），自己在應用層記錄「代表哪個使用者」 | MCP server 這個服務 | 下游不需要知道是哪個使用者，或由 MCP server 負責使用者層級的授權 |
| **Token Exchange**（RFC 8693）：MCP server 拿收到的 token 向授權伺服器換一個 `aud` 是下游的新 token | 使用者，經由 MCP server | 下游需要依使用者授權，而且要能分辨中間經過誰 |

Token Exchange 的請求：

```http
POST /token HTTP/1.1
Host: auth.example.com
Authorization: Basic dGlja2V0cy1tY3A6ZXhhbXBsZS1zZWNyZXQ=
Content-Type: application/x-www-form-urlencoded

grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Atoken-exchange
&subject_token=eyJhbGciOiJFUzI1NiIsImtpZCI6IjIwMjYtMTAifQ…
&subject_token_type=urn%3Aietf%3Aparams%3Aoauth%3Atoken-type%3Aaccess_token
&resource=https%3A%2F%2Fapi.tickets.internal
&scope=tickets.write
```

MCP server 用自己的 client 身分認證（`Authorization: Basic`），授權伺服器檢查「這個 MCP server 是否被允許代表使用者存取 `api.tickets.internal`」之後，簽一個新 token。新 token 的 `aud` 是下游，壽命可以更短，scope 不會比原本的大。

## 實際程式：用 JWKS 驗一個 ES256 token

下面在瀏覽器的 WebCrypto 裡完整跑一次：授權伺服器產生 ES256 金鑰、公布 JWKS、簽 token；MCP server 用 JWKS 驗證，並依序檢查 `alg`、`kid`、簽章、`iss`、`aud`、`exp`、`scope`。最後模擬一次金鑰輪替。

```js run
const enc = new TextEncoder(), dec = new TextDecoder()
const b64u = (buf) => { let s = ''; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
const unb64u = (str) => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4)), (c) => c.charCodeAt(0))
const b64uJson = (obj) => b64u(enc.encode(JSON.stringify(obj)))
const ES256 = { name: 'ECDSA', namedCurve: 'P-256' }
const SIG = { name: 'ECDSA', hash: 'SHA-256' }

// ── 授權伺服器：產生金鑰、公布 JWKS、簽 token ──
async function newKey(kid) {
  const pair = await crypto.subtle.generateKey(ES256, true, ['sign', 'verify'])
  const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', pair.publicKey)
  return { kid, privateKey: pair.privateKey, jwk: { kty, crv, x, y, kid, alg: 'ES256', use: 'sig' } }
}
async function sign(key, claims) {
  const input = b64uJson({ alg: 'ES256', typ: 'at+jwt', kid: key.kid }) + '.' + b64uJson(claims)
  return input + '.' + b64u(await crypto.subtle.sign(SIG, key.privateKey, enc.encode(input)))
}
const k1 = await newKey('2026-10')
const published = { keys: [k1.jwk] }               // 授權伺服器的 jwks_uri 目前的內容

// ── MCP server：快取 JWKS，遇到不認得的 kid 重抓一次 ──
const ME = 'https://tickets.example.com/mcp', ISSUER = 'https://auth.example.com'
let jwksCache = structuredClone(published)
async function verify(token, requiredScope, now) {
  const [h, p, s] = token.split('.')
  const header = JSON.parse(dec.decode(unb64u(h)))
  if (header.alg !== 'ES256') throw new Error(`invalid_token：不接受 alg=${header.alg}`)
  let jwk = jwksCache.keys.find((k) => k.kid === header.kid)
  if (!jwk) { jwksCache = structuredClone(published); jwk = jwksCache.keys.find((k) => k.kid === header.kid); console.log(`  （kid=${header.kid} 不在快取，重抓 JWKS）`) }
  if (!jwk) throw new Error(`invalid_token：JWKS 裡沒有 kid=${header.kid}`)
  const pub = await crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, ES256, false, ['verify'])
  if (!(await crypto.subtle.verify(SIG, pub, unb64u(s), enc.encode(h + '.' + p)))) throw new Error('invalid_token：簽章不符')
  const c = JSON.parse(dec.decode(unb64u(p)))
  if (c.iss !== ISSUER) throw new Error(`invalid_token：iss=${c.iss}`)
  if (![].concat(c.aud).includes(ME)) throw new Error(`invalid_token：aud=${c.aud}，不是這個 MCP server`)
  if (now > c.exp + 30) throw new Error('invalid_token：已過期')       // 容許 30 秒時鐘誤差
  if (!c.scope.split(' ').includes(requiredScope)) throw new Error(`insufficient_scope：需要 ${requiredScope}`)
  return c
}

// ── 各種 token 打 close_ticket（需要 tickets.write） ──
const now = Math.floor(Date.now() / 1000)
const base = { iss: ISSUER, aud: ME, sub: 'u_4821', client_id: 'agent-cli-7f3a', scope: 'tickets.read tickets.write', iat: now, exp: now + 3600 }
const good = await sign(k1, base)
const [gh, , gs] = good.split('.')
const cases = {
  '正常的 token': good,
  '發給天氣 server 的 token': await sign(k1, { ...base, aud: 'https://weather.example.com/mcp' }),
  '過期的 token': await sign(k1, { ...base, iat: now - 7200, exp: now - 3600 }),
  '只有 tickets.read': await sign(k1, { ...base, scope: 'tickets.read' }),
  '改了 payload 的 token': gh + '.' + b64uJson({ ...base, sub: 'u_0001' }) + '.' + gs,
}
for (const [name, t] of Object.entries(cases)) {
  try { const c = await verify(t, 'tickets.write', now); console.log(`✔ ${name}：放行 sub=${c.sub}`) }
  catch (e) { console.log(`✘ ${name}：${e.message}`) }
}

// ── 金鑰輪替：新金鑰先加進 JWKS，再開始用它簽 ──
const k2 = await newKey('2026-11')
published.keys.push(k2.jwk)
const rotated = await sign(k2, base)
try { await verify(rotated, 'tickets.write', now); console.log('✔ 新金鑰簽的 token：放行') } catch (e) { console.log('✘', e.message) }
```

改了 payload 的那個 token 只換掉中間一段，header 與簽章保持原樣：簽章是對「header.payload」整串算的，任何一個字元變了都驗不過。

## 常見錯誤與錯誤訊息

| 現象 | 原因 | 怎麼修 |
|---|---|---|
| client 連上去只看到 401，沒有跳出登入 | server 的 401 沒帶 `WWW-Authenticate` 的 `resource_metadata`，或 metadata 網址打不開 | 補上標頭；用 curl 依序打 ③ ④ 兩個 metadata 網址確認都回 JSON |
| token 端點回 `{"error":"invalid_target"}` | `resource` 值不是授權伺服器認得的資源（RFC 8707 定義的錯誤碼） | 用受保護資源 metadata 裡的 `resource` 原值；注意結尾斜線、大小寫、路徑都要一致 |
| server 回 `invalid_token`，log 寫 audience mismatch | token 是發給別的資源的；或 client 申請時沒帶 `resource`，授權伺服器給了預設 audience | client 在授權與 token 請求都帶 `resource`；server 端確認自己的資源識別碼設定正確 |
| 某個時間點起所有請求都 `invalid_token`，log 寫找不到 `kid` | 授權伺服器輪替金鑰，資源伺服器的 JWKS 快取沒更新、或不支援未知 `kid` 時重抓 | 實作「未知 kid 重抓一次」；授權伺服器要先公布再使用新金鑰 |
| 偶發的「token 尚未生效」或「已過期」 | 機器時鐘不同步，`nbf`、`iat`、`exp` 判斷錯 | 主機跑 NTP；驗證時給幾十秒的容許誤差，不要給到幾分鐘 |
| 403 `insufficient_scope` | token 沒有這個工具要的 scope | client 依 `WWW-Authenticate` 的 `scope` 重新授權；server 端回應要帶出需要的 scope |
| 下游 API 收到使用者的 MCP token | token passthrough | 改用 MCP server 自己的憑證或 Token Exchange |

還有一個不會報錯的設計錯誤：**一個 MCP server 接受 audience 是「整個公司」的 token**（例如 `aud` 寫成 `https://example.com`）。這等於所有服務共用一種 token，任何一個服務外洩，全部都能被打。每個 MCP server 都該有自己的資源識別碼。

## 動手

1. 執行「用 JWKS 驗一個 ES256 token」，對照輸出確認五種 token 各在哪一項檢查被擋下。
2. 在 [Playground](#/playground?lang=js) 把 `verify` 裡 `aud` 那行註解掉再跑，看「發給天氣 server 的 token」變成放行：這就是開頭的事件。
3. 把金鑰輪替那段的 `published.keys.push(k2.jwk)` 刪掉，模擬「還沒公布就開始簽」，看錯誤訊息；再想想授權伺服器應該等多久才能開始用新金鑰。
4. 一個組織有十幾個 MCP server 時，每個 server 各做一次這套驗證、使用者各登入十幾次，管理上的問題見 [MCP Gateway](#/skill/mcp-gateway)。

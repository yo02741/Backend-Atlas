## 從一個具體問題開始：改一個字，變成管理員

某個 API 用 JWT 當 access token。一位使用者在瀏覽器 DevTools 裡看到自己的 token，貼到解碼工具，看到 payload 裡有 `"role": "member"`。他把 `member` 改成 `admin`，重新編碼 payload，換掉 token 中間那一段，送出請求：

- 如果伺服器有正確驗簽章：簽章是對原本的內容算的，內容變了簽章就對不上，回 `401`。
- 如果伺服器的程式寫成「先解開 payload 拿 role，簽章之後再說」，或用了一個預設不驗簽章的解碼函式：他就是管理員了。
- 如果他把 header 改成 `"alg": "none"`、刪掉簽章，而伺服器的函式庫照 header 指定的演算法驗證：同樣是管理員。

JWT 的安全性不在格式本身，而在**驗證端有沒有照規矩檢查每一項**。這一課把格式拆開，看簽章保證了什麼、沒保證什麼，以及驗證時一項都不能少的清單。

## 運作原理：三段字串

一個 JWT（RFC 7519）長這樣，用 `.` 分成三段：

```text
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjIwMjYtMTAifQ
.eyJpc3MiOiJodHRwczovL2F1dGguZXhhbXBsZS5jb20iLCJhdWQiOiJodHRwczovL2FwaS5leGFtcGxlLmNvbSIsInN1YiI6InVfNDIiLCJyb2xlIjoibWVtYmVyIiwiaWF0IjoxNzkyNDgzMjAwLCJleHAiOjE3OTI0ODQxMDB9
.1yXoSlEyv4B0c-_tTYUrEmHxBqhttCZ76GUw4-zZYXo
```

（實際上是一行，這裡為了閱讀斷開。）前兩段各自是一個 JSON 物件經過 **Base64URL** 編碼：

```json
{ "alg": "HS256", "typ": "JWT", "kid": "2026-10" }
```

```json
{
  "iss": "https://auth.example.com",
  "aud": "https://api.example.com",
  "sub": "u_42",
  "role": "member",
  "iat": 1792483200,
  "exp": 1792484100
}
```

第三段是簽章：`HMAC-SHA256(secret, "<第一段>.<第二段>")` 的結果，同樣做 Base64URL 編碼。注意簽的是**編碼後的字串**，不是 JSON 物件，所以驗證時也要用收到的原始字串去算，不要解開後重新序列化（鍵的順序、空白不同，結果就不同）。

### Base64URL 是編碼，不是加密

Base64URL 和一般 Base64 的差別只有三點：`+` 換成 `-`、`/` 換成 `_`、去掉結尾的 `=`。這樣字串可以直接放進網址和 HTTP header。它沒有任何金鑰，**任何拿到 token 的人都能讀出 payload**。這是簽章型 JWT（JWS，RFC 7515）的本質：保證完整性（沒被改過）與來源（是持有金鑰的人簽的），不保證機密性。

所以 payload 裡不要放密碼、身分證號、信用卡、內部系統的細節，也不要放「被看到會出事」的東西，例如其他使用者的 id 清單。token 會出現在瀏覽器、log、錯誤回報工具、代理伺服器裡。真的需要加密內容的格式是 JWE（RFC 7516），但多數情況下更簡單的做法是：payload 只放識別碼，敏感資料留在伺服器端查。

### 標準聲明（registered claims）

| 聲明 | 意思 | 驗證端怎麼用 |
|---|---|---|
| `iss` | 發行者（issuer） | 必須等於信任的發行者，否則可能是別的系統簽的 |
| `sub` | 主體（subject），通常是使用者 id | 當作使用者識別碼；搭配 `iss` 才是全域唯一 |
| `aud` | 受眾（audience），這張 token 是發給誰用的 | 必須包含**自己**的識別碼，否則可能是發給別的服務的 token 被拿來重放 |
| `exp` | 到期時間（Unix 秒） | 現在時間 ≥ `exp` 就拒絕 |
| `nbf` | 在此之前無效（not before） | 現在時間 < `nbf` 就拒絕 |
| `iat` | 簽發時間 | 可用來拒絕「比某個時間點更早簽發」的 token（例如使用者改密碼的時間） |
| `jti` | token 的唯一 id | 撤銷清單、防重放用 |

時間比較要容許一點時鐘誤差（leeway），常見 30～60 秒；設成幾小時等於沒有到期檢查。

### 簽章演算法：HS256、RS256、ES256

| 演算法 | 類型 | 簽章用 | 驗證用 | 適合 |
|---|---|---|---|---|
| `HS256` | HMAC-SHA256（對稱） | 共享 secret | 同一把 secret | 簽發者與驗證者是同一個服務；能驗的人就能簽 |
| `RS256` | RSA PKCS#1 v1.5 + SHA-256（非對稱） | 私鑰 | 公鑰 | 一個授權伺服器簽、很多服務驗；簽章較長（2048-bit 金鑰時 256 bytes） |
| `ES256` | ECDSA P-256 + SHA-256（非對稱） | 私鑰 | 公鑰 | 同 RS256，但金鑰與簽章都短很多（簽章 64 bytes） |

HS256 的限制在於「驗證者也能簽」：如果五個服務都拿到同一把 secret 來驗 token，其中任何一個被入侵，攻擊者就能簽出任意使用者的 token。多個服務要驗同一種 token 時用非對稱演算法，只有授權伺服器持有私鑰。

### 驗證的固定順序

收到 token 時，伺服器依序檢查，任何一項失敗就拒絕：

1. 格式：剛好三段、每段都是合法的 Base64URL、header 與 payload 是 JSON 物件。
2. `alg` 在**伺服器設定的允許清單**裡（例如只收 `ES256`）。不是從 header 讀了就照做。
3. 依 `kid` 找到對應的金鑰；找不到就拒絕（或在允許的範圍內重新抓一次公鑰清單）。
4. 簽章正確。
5. `exp`、`nbf` 在有效時間內。
6. `iss` 等於信任的發行者。
7. `aud` 包含自己。
8. 之後才是業務層的檢查：`sub` 對應的使用者還存在、沒被停用；`scope` 或角色足夠做這件事（見 [RBAC 與 ABAC](#/skill/rbac-abac)）。

第 2 項是兩種經典攻擊的防線。

## 兩種經典攻擊：都出在「信任 header 的 alg」

### `alg: none`

JWT 規格定義了 `none`：不簽章的 JWT（Unsecured JWT），第三段是空字串。它原本是給「外層已經有其他保護」的情境用的。有些早期的函式庫在驗證時讀 header 的 `alg`，看到 `none` 就跳過簽章檢查。攻擊者只要把 header 改成 `{"alg":"none"}`、改 payload、刪掉簽章：

```text
eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1XzQyIiwicm9sZSI6ImFkbWluIn0.
```

防禦：驗證時明確指定允許的演算法，`none` 永遠不在清單裡。現在主流函式庫多半要求呼叫端指定，例如 PyJWT 2.x 的 `jwt.decode` 沒傳 `algorithms` 會直接報錯。

### 演算法混淆（RS256 → HS256）

伺服器用 RS256：私鑰簽、公鑰驗，公鑰是公開的。某些函式庫的介面是 `verify(token, key)`，演算法依 header 決定。攻擊者把 header 改成 `HS256`，然後**用伺服器的公鑰當作 HMAC 的 secret** 來簽。伺服器呼叫 `verify(token, public_key)` 時，函式庫看到 HS256，就拿 `public_key` 這串位元組當 HMAC secret 去驗——攻擊者用的正是同一串位元組，驗證通過。

防禦和前一個一樣：伺服器決定演算法，而且一把金鑰只對應一種演算法。比較新的函式庫會把金鑰物件與演算法綁在一起（例如 RSA 公鑰物件不能拿去做 HMAC），從介面上排除這種錯誤。整理這類陷阱的文件是 RFC 8725（JWT Best Current Practices）。

## 金鑰輪替與 `kid`

簽章金鑰不可能永遠不換：可能外洩、可能有使用年限的規定。輪替時有一段期間，舊 token（舊金鑰簽的）還沒過期，新 token 已經用新金鑰簽。`kid`（key id）讓驗證端知道該用哪一把：

| 階段 | 簽發用的金鑰 | 驗證端接受的金鑰 |
|---|---|---|
| 平常 | `2026-09` | `2026-09` |
| 預告：先公布新公鑰 | `2026-09` | `2026-09`、`2026-10` |
| 切換簽發 | `2026-10` | `2026-09`、`2026-10` |
| 舊 token 全部過期後（至少等一個 access token 效期） | `2026-10` | `2026-10` |

非對稱演算法的公鑰通常用 JWK Set（RFC 7517）公布在一個網址（OIDC 叫 `jwks_uri`），驗證端快取起來，遇到不認得的 `kid` 再重新抓一次（要限流，避免攻擊者用亂填的 `kid` 讓你一直打 JWKS）。順序很重要：**先讓驗證端認得新金鑰，再開始用新金鑰簽**，反過來會有一段時間新 token 全部驗證失敗。JWKS 的實際驗證程式見 [MCP 的授權](#/skill/mcp-authorization)。

`kid` 是攻擊者可以控制的輸入，只能拿來在**已知的金鑰清單**裡查，不能拿去組檔案路徑或 SQL 查詢。

## 撤銷的難題

自帶型 token 的優點是不查表，缺點也是不查表：發出去之後，伺服器沒有地方可以「刪掉它」。常見的補法，各有代價：

| 做法 | 怎麼做 | 代價 |
|---|---|---|
| 短效期 + refresh token | access token 5～15 分鐘；refresh token 存在伺服器端、可撤銷、每次使用就換一張新的（rotation） | 最常見。撤銷後最多延遲一個 access token 效期 |
| 撤銷清單（denylist） | 撤銷時把 `jti` 放進 Redis，TTL 設成 token 剩下的效期；每次驗證查一下 | 每個請求多一次查詢，但清單很小（只有被撤銷、還沒過期的） |
| 使用者層級的「最早有效時間」 | 使用者表存 `tokens_valid_after`；`iat` 早於它就拒絕 | 要查使用者資料（很多系統本來就會查）；一次撤銷該使用者全部 token |
| 改用 opaque token + introspection | token 只是隨機字串，資源伺服器呼叫授權伺服器的 introspection 端點（RFC 7662）查狀態 | 每次（或每次快取過期）一個網路往返；撤銷即時 |

refresh token rotation 與重放偵測的完整做法見 [身分閘道](#/skill/identity-gateway)。一個判斷原則：如果你的需求是「停用帳號要在一分鐘內生效」，而 access token 效期是一小時，那就必須在驗證時查某個伺服器端狀態——這時要誠實地承認它不是無狀態的，並選上表中的一種。

## 實際程式：用 WebCrypto 簽 HS256，再驗證

下面的程式不用任何套件，用瀏覽器內建的 `crypto.subtle` 做 HMAC-SHA256。它實作上面「驗證的固定順序」：檢查格式、`alg` 允許清單、`kid`、簽章、時間、`iss`、`aud`。然後試五種 token：正常的、竄改 payload 的、`alg: none` 的、發給別的服務的、過期的。

```js run
const enc = new TextEncoder()
const dec = new TextDecoder()

// Base64URL：Base64 把 + / 換成 - _，去掉結尾的 =
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64url = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}
const encJson = (obj) => b64url(enc.encode(JSON.stringify(obj)))
const decJson = (seg) => JSON.parse(dec.decode(fromB64url(seg)))

// 伺服器的金鑰清單：kid → secret（輪替期間會有兩把）
const KEYS = { '2026-10': 'dev-secret-change-me' }
const hmacKey = (secret) =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])

async function sign(payload, kid = '2026-10') {
  const head = encJson({ alg: 'HS256', typ: 'JWT', kid })
  const body = encJson(payload)
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(KEYS[kid]), enc.encode(`${head}.${body}`))
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`
}

const ALLOWED_ALGS = ['HS256']          // 伺服器決定，不看 header 想用什麼
async function verify(token, { iss, aud, now, leeway = 30 }) {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('格式錯誤：不是三段')
  const [h, p, s] = parts
  const header = decJson(h)
  if (!ALLOWED_ALGS.includes(header.alg)) throw new Error(`不接受的 alg：${header.alg}`)
  const secret = KEYS[header.kid]
  if (!secret) throw new Error(`不認得的 kid：${header.kid}`)
  // 對「收到的原始字串」驗章；crypto.subtle.verify 內部做比較，不要自己用 === 比字串
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(s), enc.encode(`${h}.${p}`))
  if (!ok) throw new Error('簽章不符')
  const c = decJson(p)
  if (typeof c.exp !== 'number' || now >= c.exp + leeway) throw new Error('已過期')
  if (typeof c.nbf === 'number' && now < c.nbf - leeway) throw new Error('尚未生效（nbf）')
  if (c.iss !== iss) throw new Error(`iss 不符：${c.iss}`)
  const auds = Array.isArray(c.aud) ? c.aud : [c.aud]
  if (!auds.includes(aud)) throw new Error(`aud 不符：${c.aud}`)
  return c
}

const NOW = 1792483500                  // 固定的「現在」
const base = { iss: 'https://auth.example.com', aud: 'https://api.example.com', sub: 'u_42', role: 'member', iat: 1792483200, exp: 1792484100 }
const expect = { iss: 'https://auth.example.com', aud: 'https://api.example.com', now: NOW }

const good = await sign(base)
const [h, , s] = good.split('.')
const cases = {
  '正常的 token': good,
  '竄改 payload（role 改成 admin、沿用舊簽章）': `${h}.${encJson({ ...base, role: 'admin' })}.${s}`,
  'alg: none、拿掉簽章': `${encJson({ alg: 'none' })}.${encJson({ ...base, role: 'admin' })}.`,
  '發給別的服務的 token': await sign({ ...base, aud: 'https://billing.example.com' }),
  '過期的 token': await sign({ ...base, exp: NOW - 3600 }),
}

console.log('payload 不用金鑰就能讀：', JSON.stringify(decJson(good.split('.')[1])))
for (const [name, token] of Object.entries(cases)) {
  try {
    const c = await verify(token, expect)
    console.log(`通過  ${name} → sub=${c.sub} role=${c.role}`)
  } catch (e) {
    console.log(`拒絕  ${name} → ${e.message}`)
  }
}
```

第一行輸出刻意示範：沒有金鑰也能讀出 payload。五個案例中只有第一個通過。可以把 `ALLOWED_ALGS` 改成從 header 讀（`[header.alg]`）再看 `alg: none` 那一行會發生什麼——這個簡化的實作在 `KEYS` 找得到 kid 之前就會擋下來，但真實世界裡出事的函式庫就是在這一步放行。

伺服器端的 Python 通常用 PyJWT（需要安裝套件，不能在瀏覽器裡跑）：

```python
import jwt  # PyJWT

claims = jwt.decode(
    token,
    public_key,                       # RS256 / ES256 用公鑰；HS256 用 secret
    algorithms=["ES256"],             # 必填，只列自己用的演算法
    audience="https://api.example.com",
    issuer="https://auth.example.com",
    leeway=30,                        # 容許 30 秒時鐘誤差
    options={"require": ["exp", "iss", "aud", "sub"]},  # 少了這些聲明就拒絕
)
```

注意 PyJWT 只在你**傳了** `issuer` 時才檢查 `iss`；沒傳就不檢查。`audience` 則相反：token 裡有 `aud` 而你沒傳，會丟 `InvalidAudienceError`。

## 常見錯誤與錯誤訊息

以 PyJWT 2.x 為例（訊息文字以 2.7 版為準，不同版本可能略有差異）：

| 例外與訊息 | 原因 | 怎麼處理 |
|---|---|---|
| `DecodeError: It is required that you pass in a value for the "algorithms" argument when calling decode().` | 呼叫 `jwt.decode` 時沒指定演算法 | 補上 `algorithms=[...]`，只列自己用的那一種 |
| `DecodeError: Not enough segments` | 字串裡沒有兩個 `.`：拿到的其實是 opaque token、空字串，或 token 被截斷 | 印出收到的字串長度與前幾個字元（不要印整張 token），確認來源 |
| `DecodeError: Invalid header string: …` | 第一段解不出 JSON；常見原因是把 `Bearer ` 前綴連同 token 一起傳進 `decode`，前綴被當成第一段的一部分 | 先去掉 `Bearer ` 前綴再解 |
| `InvalidAlgorithmError: The specified alg value is not allowed` | token header 的 `alg` 不在你的允許清單 | 確認發行端用的演算法；如果是攻擊嘗試，維持拒絕 |
| `InvalidSignatureError: Signature verification failed` | 金鑰不對、內容被改、或用了錯的 `kid` 對應的金鑰 | 確認環境變數裡的 secret 或公鑰；輪替期間檢查 `kid` 對應 |
| `ExpiredSignatureError: Signature has expired` | 超過 `exp` | 客戶端用 refresh token 換新的；若大量發生，檢查伺服器時鐘（NTP） |
| `ImmatureSignatureError: The token is not yet valid (nbf)` | 驗證端的時鐘比簽發端慢 | 設 `leeway`，並校正時鐘 |
| `InvalidAudienceError: Audience doesn't match` | token 的 `aud` 不包含你傳的 `audience` | 這張 token 是發給別的服務的，應該拒絕；若是設定錯誤，對齊授權伺服器的 audience 設定 |
| `InvalidAudienceError: Invalid audience` | token 有 `aud`，但呼叫時沒傳 `audience` | 補上 `audience=`；不要用 `verify_aud: False` 關掉 |
| `InvalidIssuerError: Invalid issuer` | `iss` 和你傳的 `issuer` 不同 | 常見是結尾斜線或 http/https 不一致；字串必須完全相同 |

不會報錯、但同樣危險的寫法：

- 用 `jwt.decode(token, options={"verify_signature": False})` 讀 payload 後直接拿來做授權判斷。這個選項只適合在**已經驗證過**之後除錯用。
- 把 JWT 當 session 存一大包資料（購物車、權限清單），token 變成好幾 KB，每個請求都帶著；而且權限變了 token 不會跟著變。

## 動手

1. 開 [JWT 解剖](#/lab/JwtLab) 實驗室：改 `role`、開「竄改」、開「不同 secret」，觀察哪一段變了、簽章為什麼對不上。
2. 在上面的 `js run` 範例裡，把 `KEYS` 加一把 `'2026-11': 'next-secret'`，用 `sign(base, '2026-11')` 簽一張，確認兩把都能驗；再把 `'2026-10'` 刪掉，看舊 token 變成「不認得的 kid」。這就是輪替的最後一步。
3. 把 `verify` 的 `leeway` 改成 `0`，把 `NOW` 改成 `base.exp`，看邊界上的行為；再想想時鐘差 2 分鐘的兩台伺服器會發生什麼。
4. 拿一個真實的 JWT（例如自己開發環境的 access token），手動把中間那段做 Base64URL 解碼，列出它有哪些聲明、缺了哪些（`aud`？`jti`？）。不要把正式環境的 token 貼到第三方網站。
5. 接著讀 [OAuth 2.0 與 OIDC](#/skill/oauth-oidc)：ID token 也是 JWT，但驗證規則多了 `nonce` 與 `aud = client_id`。

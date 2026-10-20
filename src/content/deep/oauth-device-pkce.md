## 從一個具體問題開始：三個用戶端，三種「沒辦法」

同一個授權伺服器（`auth.example.com`）要服務三種用戶端：

| 用戶端 | 情況 | 標準授權碼流程卡在哪 |
|---|---|---|
| `atlas` 命令列工具，跑在 SSH 進去的伺服器上 | 沒有瀏覽器，也收不到 redirect | 授權碼流程要把使用者導到登入頁、再導回 `redirect_uri`，這台機器兩件事都做不到 |
| 單頁應用（SPA）與手機 App | 程式碼會被下載到使用者的裝置上 | 授權碼換 token 時要帶 `client_secret`，但放進 JavaScript 或 App 安裝檔的 secret 任何人都拆得出來 |
| 每晚跑的對帳服務 | 根本沒有使用者 | 沒有人可以按「同意」 |

常見的錯誤解法各有後果：CLI 要使用者把密碼直接打進終端機（工具拿到了明文密碼，MFA 也用不上）；SPA 把 `client_secret` 寫進前端程式碼（secret 等於公開，任何人都能冒充這個 client）；對帳服務借用某位工程師的帳號（那個人離職或改密碼，服務就壞掉，稽核紀錄上也分不出是人還是服務）。

OAuth 為這三種情況各有一個標準流程：

- **Device Authorization Grant（RFC 8628）**：沒有瀏覽器或不方便輸入的裝置。登入在另一台有瀏覽器的裝置上完成。
- **授權碼 + PKCE（RFC 7636）**：存不住 secret 的**公開客戶端**（public client）。用一次性的隨機值取代 secret。
- **Client Credentials（RFC 6749 §4.4）**：服務對服務，沒有使用者，client 用自己的身分拿 token。

授權碼流程本身、`state` 防 CSRF、OAuth 與 OIDC 的差別在 [OAuth 2.0 與 OIDC](#/skill/oauth-oidc) 講過，這裡專注在三種變形各自的 HTTP 往返。

## Device Code：在另一台裝置上登入

### 流程

```text
 CLI（沒有瀏覽器）                授權伺服器                     手機或筆電上的瀏覽器
      │ ① POST /device_authorization   │                                  │
      │──────────────────────────────▶│                                  │
      │ ② device_code、user_code、      │                                  │
      │    verification_uri、interval  │                                  │
      │◀──────────────────────────────│                                  │
      │ ③ 印出：請到 …/device 輸入 WDJB-MJHT                              │
      │                                │ ④ 使用者打開網址、登入、輸入 user_code、按同意
      │                                │◀─────────────────────────────────│
      │ ⑤ 每 interval 秒 POST /token（帶 device_code）                    │
      │──────────────────────────────▶│                                  │
      │   authorization_pending …      │                                  │
      │◀──────────────────────────────│                                  │
      │ ⑥ 使用者同意後：access_token   │                                  │
      │◀──────────────────────────────│                                  │
```

關鍵是兩個碼的分工：`device_code` 只有 CLI 知道，用來輪詢；`user_code` 短、好唸、給人輸入，用來把「瀏覽器上的這次登入」和「那台 CLI 的請求」接起來。

### ① ② 申請 device code

```http
POST /device_authorization HTTP/1.1
Host: auth.example.com
Content-Type: application/x-www-form-urlencoded

client_id=atlas-cli&scope=repo.read
```

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "device_code": "GmRhmhcxhwAzkoEqiMEg_DnyEysNkuNhszIySk9eS",
  "user_code": "WDJB-MJHT",
  "verification_uri": "https://auth.example.com/device",
  "verification_uri_complete": "https://auth.example.com/device?user_code=WDJB-MJHT",
  "expires_in": 1800,
  "interval": 5
}
```

| 欄位 | 意思 |
|---|---|
| `device_code` | CLI 輪詢時帶的憑證，不顯示給使用者 |
| `user_code` | 給人輸入的短碼。通常避開容易看錯的字元（0 和 O、1 和 I） |
| `verification_uri` | 使用者要去的網址 |
| `verification_uri_complete` | 選填，已經帶好 `user_code` 的網址，適合做成 QR code |
| `expires_in` | 兩個碼的有效秒數，過了就要重來 |
| `interval` | 輪詢的最短間隔秒數；沒給的話 RFC 規定用 5 秒 |

### ⑤ ⑥ 輪詢 token 端點

```http
POST /token HTTP/1.1
Host: auth.example.com
Content-Type: application/x-www-form-urlencoded

grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code
&device_code=GmRhmhcxhwAzkoEqiMEg_DnyEysNkuNhszIySk9eS
&client_id=atlas-cli
```

`grant_type` 是一個 URN：`urn:ietf:params:oauth:grant-type:device_code`（上面是 URL 編碼後的樣子）。使用者還沒完成時，授權伺服器回 `400` 加上錯誤碼：

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json
Cache-Control: no-store

{ "error": "authorization_pending" }
```

| 錯誤碼 | 意思 | CLI 該怎麼做 |
|---|---|---|
| `authorization_pending` | 使用者還沒完成 | 等 `interval` 秒再問 |
| `slow_down` | 問太快了 | 把間隔**加 5 秒**，之後每次都用新間隔 |
| `access_denied` | 使用者按了拒絕 | 停止輪詢，告訴使用者 |
| `expired_token` | `device_code` 過期 | 停止輪詢，重新跑整個流程 |

使用者同意後，同一個請求會拿到一般的 token 回應：

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "access_token": "eyJhbGciOiJFUzI1NiIsImtpZCI6IjIwMjYtMTAifQ.eyJ…",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "rt_8xLOxBtZp8",
  "scope": "repo.read"
}
```

是否發 `refresh_token` 由授權伺服器決定。CLI 拿到後要存在安全的地方，見 [CLI 與 Agent 的 token 存哪裡](#/skill/cli-token-storage)。

### 時間線：守規矩與不守規矩的 CLI

授權伺服器以每個 `device_code` 為單位記錄上次輪詢時間。假設使用者在第 23 秒按下同意：

| 時間 | 守規矩的 CLI（每 5 秒） | 每 2 秒問一次的 CLI |
|---|---|---|
| t=2 | | `authorization_pending` |
| t=4 | | `slow_down`，伺服器把這個 device_code 的間隔調成 10 秒 |
| t=5 | `authorization_pending` | |
| t=6 | | 距上次 2 秒 < 10 秒，又是 `slow_down`，間隔變 15 秒 |
| t=10 … t=20 | 每 5 秒一次 `authorization_pending` | 繼續 `slow_down`，間隔越拉越長 |
| t=25 | 拿到 token | 永遠在 `slow_down`，直到 `expired_token` |

不理會 `slow_down` 的 CLI 不只拿不到 token，還會把授權伺服器的負載拉高。後面的「實際程式」有可以執行的版本。

### 釣魚風險：攻擊者發 user_code 給你

Device Code 流程有一個結構上的弱點：**發起流程的裝置和完成登入的人之間沒有任何綁定**。攻擊者可以：

1. 自己對授權伺服器發起 device 流程，拿到 `user_code` 與 `device_code`。
2. 寄信或傳訊息給受害者：「請到 https://auth.example.com/device 輸入 WDJB-MJHT 完成驗證」。網址是真的官方網址，所以檢查網址的習慣擋不住。
3. 受害者登入（連 MFA 都正常通過）、按同意。
4. 攻擊者一直在輪詢，拿到的是**受害者的** token。

防禦都在授權伺服器與組織政策這一側：

- **驗證頁要講清楚是誰在要權限**：顯示 client 名稱、要求的 scope，並提醒「如果這不是你剛剛自己在裝置上發起的，請不要繼續」。
- **`expires_in` 不要太長**：攻擊者要在碼過期前騙到人，時間越短越難。
- **限制誰能用這個流程**：只有真正需要的 client（CLI、電視 App）才開 device grant；有些 IdP 可以用條件式政策限制哪些使用者或應用能用 device code 流程。
- **事後可查**：token 發出時記錄是哪個 client、哪個 device 流程；異常地點的 refresh 要能撤銷。

## 授權碼 + PKCE：沒有 secret 的公開客戶端

### PKCE 防的是什麼

授權碼流程中，授權碼會經過一段不受 client 控制的路：瀏覽器網址列、作業系統把自訂 URL scheme 交給 App、本機 loopback port。手機上別的 App 可以註冊同一個 URL scheme 攔到 `code`；瀏覽器擴充套件、log、Referer 也可能看到它。

沒有 client secret 的公開客戶端，換 token 時只需要 `code`、`client_id`、`redirect_uri`，這三個攔截者都拿得到。**PKCE 讓「換 token 的人」必須證明自己就是「發起授權的人」**：

1. 發起前，client 產生一個隨機的 `code_verifier`（43–128 個字元，只能用英數與 `-._~`），只留在自己的記憶體。
2. 算出 `code_challenge = BASE64URL(SHA-256(code_verifier))`，放進授權請求。授權伺服器把它和這次授權綁在一起。
3. 換 token 時帶上 `code_verifier` 原文。授權伺服器重算一次 SHA-256，和當初的 `code_challenge` 比對。

攔截者拿到了 `code`，也看得到網址裡的 `code_challenge`，但 SHA-256 不能反推，所以算不出 `code_verifier`，換不到 token。`code_challenge_method` 有 `S256` 與 `plain` 兩種，`plain` 直接把 verifier 當 challenge，只在無法計算 SHA-256 時才用，實務上一律 `S256`。

OAuth 2.1 草案把 PKCE 列為所有授權碼流程都要用，連有 secret 的機密型 client 也一樣：PKCE 也能防「授權碼注入」（攻擊者把自己拿到的 code 塞進受害者的流程）。

### HTTP 往返

```http
GET /authorize?response_type=code
  &client_id=atlas-spa
  &redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback
  &scope=orders.read
  &state=af0ifjsldkj
  &code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
  &code_challenge_method=S256 HTTP/1.1
Host: auth.example.com
```

（實際請求是一行，這裡為了閱讀換行。）使用者登入、同意後，授權伺服器把瀏覽器導回：

```http
HTTP/1.1 302 Found
Location: https://app.example.com/callback?code=SplxlOBeZQQYbYS6WxSbIA&state=af0ifjsldkj
```

client 先比對 `state`，再拿 `code` 和 `code_verifier` 換 token。注意這裡**沒有** `client_secret`：

```http
POST /token HTTP/1.1
Host: auth.example.com
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=SplxlOBeZQQYbYS6WxSbIA
&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback
&client_id=atlas-spa
&code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
```

上面的 verifier 與 challenge 是 RFC 7636 附錄 B 的測試向量，可以用下面的程式驗算。

### CLI 也能用授權碼 + PKCE

有瀏覽器的桌機 CLI 不一定要用 Device Code。常見做法是 CLI 在本機開一個臨時的 HTTP 伺服器（`http://127.0.0.1:<隨機 port>/callback`），打開系統瀏覽器去授權頁，`redirect_uri` 指回這個 loopback 位址，收到 `code` 後關掉伺服器。這種原生應用的做法寫在 [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252)。它的好處是使用者不用切換裝置、不用輸入碼；Device Code 留給 SSH、容器、電視這類真的沒有瀏覽器的環境。

## Client Credentials：沒有使用者的服務

對帳服務沒有使用者，它用自己的 `client_id` 與憑證直接向 token 端點要 token：

```http
POST /token HTTP/1.1
Host: auth.example.com
Authorization: Basic YmlsbGluZy1zdmM6czNjcjN0LWRlbW8=
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&scope=invoices.write
```

`Authorization: Basic` 是 `client_id:client_secret` 的 base64（這裡是 `billing-svc:s3cr3t-demo`，虛構的值）。回應：

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "access_token": "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJiaWxsaW5nLXN2YyJ9…",
  "token_type": "Bearer",
  "expires_in": 900,
  "scope": "invoices.write"
}
```

幾個和使用者流程不同的地方：

- **沒有 refresh token**。RFC 6749 規定這個流程不應該發 refresh token：client 隨時可以用自己的憑證再要一次，不需要它。
- **token 裡的 `sub` 是服務本身**，不是某個人。下游 API 依據它做授權與稽核，才分得出「人做的」和「服務做的」。
- **client 必須是機密型**：它要有地方安全地放憑證（伺服器的 secret 管理，見 [秘密管理](#/skill/secrets)）。比 `client_secret` 更好的選擇是不傳共享 secret 的認證方式，例如用私鑰簽一個 JWT 來證明身分（RFC 7523）或 mTLS（RFC 8705），授權伺服器只存公鑰或憑證資訊。
- **scope 照樣要最小化**。服務 token 沒有使用者在旁邊看，被偷時的影響範圍完全由 scope 決定。

### 三種流程對照

| | Device Code | 授權碼 + PKCE | Client Credentials |
|---|---|---|---|
| 有沒有使用者 | 有 | 有 | 沒有 |
| 用戶端類型 | 公開（CLI、電視） | 公開（SPA、App、桌機 CLI），機密型也建議加 | 機密（後端服務） |
| 使用者在哪登入 | 另一台裝置的瀏覽器 | 同一台裝置的瀏覽器 | 不登入 |
| 證明 client 身分的方式 | 只有 `client_id`（公開） | `code_verifier` 證明是同一個發起者 | client secret、私鑰 JWT 或 mTLS |
| 拿 token 的方式 | 輪詢 token 端點 | 用 code + verifier 換 | 直接要 |
| 主要風險 | user_code 釣魚 | 攔截授權碼（PKCE 擋）、redirect_uri 設定過寬 | 憑證外洩、scope 過大 |

## 實際程式

### 計算 PKCE 的 code_challenge

用 WebCrypto 算 SHA-256，再轉成 base64url（`+` 換 `-`、`/` 換 `_`、去掉結尾的 `=`）。先用 RFC 7636 的測試向量確認算法，再產生一組新的：

```js run
// base64url：標準 base64 再換掉兩個字元、去掉 padding
function base64url(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// code_challenge = BASE64URL(SHA-256(ASCII(code_verifier)))
async function challengeFor(verifier) {
  const data = new TextEncoder().encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', data)   // 32 bytes
  return base64url(new Uint8Array(hash))
}

// 1. RFC 7636 附錄 B 的測試向量
const rfcVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const rfcChallenge = await challengeFor(rfcVerifier)
console.log('RFC 範例 challenge：', rfcChallenge)
console.log('與 RFC 一致：', rfcChallenge === 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')

// 2. 實際使用：32 bytes 密碼學亂數 → base64url 後剛好 43 個字元
const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
const challenge = await challengeFor(verifier)
console.log('verifier 長度：', verifier.length, '（規範要求 43 到 128）')
console.log('放進授權請求的 challenge：', challenge)

// 3. 授權伺服器在 token 端點做的事：重算一次再比對
async function tokenEndpointCheck(storedChallenge, receivedVerifier) {
  return (await challengeFor(receivedVerifier)) === storedChallenge
}
console.log('發起者帶正確 verifier：', await tokenEndpointCheck(challenge, verifier))
const guess = base64url(crypto.getRandomValues(new Uint8Array(32)))
console.log('攔截者只有 code，亂猜 verifier：', await tokenEndpointCheck(challenge, guess))
```

`crypto.getRandomValues` 是密碼學等級的亂數；不要用 `Math.random()` 產生 verifier，它可以被預測。

### 模擬 Device Code 的輪詢

用虛擬時鐘模擬授權伺服器與 CLI，不真的等待。可以改 `approveAt`、`step` 看結果怎麼變：

```js run
// 授權伺服器：以 device_code 為單位記住上次輪詢時間與目前要求的間隔
function makeServer({ approveAt, denied = false, expiresIn = 60 }) {
  let lastPoll = -Infinity
  let interval = 5
  return function token(now) {
    if (now >= expiresIn) return { error: 'expired_token' }
    if (now - lastPoll < interval) {          // 問得比允許的間隔還快
      lastPoll = now
      interval += 5                            // RFC 8628：slow_down 時間隔加 5 秒
      return { error: 'slow_down' }
    }
    lastPoll = now
    if (now < approveAt) return { error: 'authorization_pending' }
    if (denied) return { error: 'access_denied' }
    return { access_token: 'at_demo', token_type: 'Bearer', expires_in: 3600 }
  }
}

// CLI：honorSlowDown 決定收到 slow_down 時要不要拉長間隔；step 固定時代表不看 interval
function runCli(server, { honorSlowDown = true, step = null } = {}) {
  let interval = 5, now = 0
  const log = []
  for (;;) {
    now += step ?? interval
    const r = server(now)
    log.push(`t=${now}s ${r.error ?? '拿到 access_token'}`)
    if (r.error === 'slow_down') { if (honorSlowDown) interval += 5; continue }
    if (r.error === 'authorization_pending') continue
    return log                                 // 成功、拒絕或過期都結束
  }
}

console.log('守規矩的 CLI：\n' + runCli(makeServer({ approveAt: 23 })).join('\n'))
const impatient = runCli(makeServer({ approveAt: 23 }), { honorSlowDown: false, step: 2 })
console.log('\n每 2 秒問一次的 CLI（共 ' + impatient.length + ' 次）：\n' + impatient.slice(0, 4).join('\n') + '\n…\n' + impatient.at(-1))
console.log('\n使用者按拒絕：\n' + runCli(makeServer({ approveAt: 12, denied: true })).join('\n'))
```

## 常見錯誤與錯誤訊息

token 端點的錯誤都是 JSON：`{"error": "…", "error_description": "…"}`。`error` 是規範定義的固定值，`error_description` 是授權伺服器自己寫的說明，每家不同，所以程式要判斷 `error`，`error_description` 只拿來給人看。

| `error` | 常見原因 | 怎麼修 |
|---|---|---|
| `invalid_grant` | 授權碼已經用過或過期；`code_verifier` 和當初的 challenge 對不上；`redirect_uri` 和授權請求時不一樣；refresh token 已失效 | 授權碼只能用一次、壽命很短，失敗就重跑授權；確認 verifier 是同一次流程產生的（多分頁同時登入時最容易拿錯） |
| `invalid_request` | 缺必要參數，例如授權伺服器要求 PKCE 但請求沒帶 `code_challenge` | 補參數；檢查 `code_challenge_method` 是 `S256` |
| `invalid_client` | client 認證失敗（secret 錯、Basic 編碼錯、公開客戶端被設定成要 secret） | 確認 client 類型設定；Basic 要先對 id 與 secret 做 URL 編碼再 base64 |
| `unauthorized_client` | 這個 client 沒被允許用這種 grant type | 在授權伺服器的 client 設定打開對應的 grant（例如 device grant） |
| `unsupported_grant_type` | `grant_type` 拼錯，或伺服器不支援 | Device Code 的 grant_type 是完整 URN，常見錯誤是只寫 `device_code` |
| `invalid_scope` | 要求的 scope 不存在或超出允許範圍 | 對照授權伺服器公布的 `scopes_supported` |
| `slow_down` 不斷出現 | CLI 沒有在收到 `slow_down` 後拉長間隔 | 每次 `slow_down` 都把間隔加 5 秒，並持續使用新間隔 |

不會有錯誤訊息、但同樣危險的情況：

- **SPA 或 App 裡藏了 client_secret**：功能正常，但 secret 已經公開。公開客戶端在授權伺服器上要設成「不需要 secret」，改用 PKCE。
- **`redirect_uri` 用萬用字元或只比對前綴**：攻擊者可以讓授權碼被導到他控制的路徑。授權伺服器應該完全比對註冊過的 `redirect_uri`（原生 App 的 loopback 位址允許 port 不同）。
- **服務用人的帳號跑 Device Code 拿 token**：能動，但又回到「人離職服務就壞」的問題。沒有使用者的情境就用 Client Credentials。

## 動手

1. 執行「計算 PKCE 的 code_challenge」，確認 RFC 測試向量一致。把 `rfcVerifier` 改掉一個字元，看 challenge 整串都變了。
2. 在 [Playground](#/playground?lang=js) 把 verifier 改成用 `crypto.getRandomValues(new Uint8Array(96))` 產生，確認長度變成 128（規範上限）；再試 `Uint8Array(16)`，長度只有 22，低於 43 的下限，授權伺服器應該拒絕。
3. 執行「模擬 Device Code 的輪詢」，把 `approveAt` 改成 70（超過 `expiresIn`），看守規矩的 CLI 最後收到什麼；再把不守規矩那個 CLI 的 `step` 改成 5，確認只要間隔不小於 `interval` 就不會收到 `slow_down`。
4. 對照 [API key、服務間驗證、MFA 與 SSO](#/skill/api-keys-mfa) 的服務對服務段落，想想對帳服務的 token 被偷時，scope 和 `expires_in` 各限制了什麼。這些 token 由誰統一簽發與管理，見 [集中式身分閘道](#/skill/identity-gateway)。

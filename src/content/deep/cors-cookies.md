## 從一個具體問題開始：curl 打得通，瀏覽器說被擋

前端跑在 `https://app.shop.example`，API 在 `https://api.shop.example`。用 curl 打 `POST /orders` 一切正常，回 201。同樣的請求從前端的 `fetch` 送出，Chrome 的 console 出現：

```
Access to fetch at 'https://api.shop.example/orders' from origin 'https://app.shop.example'
has been blocked by CORS policy: Response to preflight request doesn't pass access control
check: No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

後端看 log，發現根本沒有收到 `POST`，只收到一個 `OPTIONS /orders`，而且回了 405。

修好 CORS 之後，下一個問題接著來：使用者登入後，前端呼叫 API 一直回 401，因為登入時種下的 session cookie 沒有被帶上。

這兩個問題都來自瀏覽器的同一套規則：**同源政策**決定一個網頁能不能讀取另一個來源的回應，**CORS** 是伺服器放寬這個限制的方式，**cookie 的屬性**決定瀏覽器什麼時候自動帶上 cookie。三者都只存在於瀏覽器裡，所以 curl 完全不受影響。

## 同源政策

**origin（來源）** 是 scheme、主機、port 三者的組合。三者全部相同才是同源：

| 比較對象（相對於 `https://app.shop.example`） | 同源嗎 | 原因 |
|---|---|---|
| `https://app.shop.example/orders` | 是 | 路徑不影響 |
| `http://app.shop.example` | 否 | scheme 不同 |
| `https://app.shop.example:8443` | 否 | port 不同（https 預設 443） |
| `https://api.shop.example` | 否 | 主機不同，即使是同一個網域的子網域 |
| `http://localhost:5173` 對 `http://localhost:8000` | 否 | port 不同：本機開發最常遇到 |

瀏覽器預設允許網頁**送出**跨來源的請求（表單、圖片、script 本來就可以），但不讓 JavaScript **讀取**跨來源的回應。否則，任何網站都能在背景用你的登入狀態呼叫你的網銀 API，讀出餘額。

這裡有一個很重要的推論：**CORS 擋的是讀取，不一定擋得住送出**。一個「簡單請求」（下面會定義）會真的送到伺服器、真的被執行，瀏覽器只是不把回應交給 JavaScript。所以 CORS 不是防止跨站請求偽造（CSRF）的機制，伺服器的授權檢查、cookie 的 `SameSite`、CSRF token 才是。

## CORS 怎麼運作

### 簡單請求：直接送，看回應決定給不給讀

符合以下全部條件的請求是「簡單請求」，瀏覽器直接送出，不先詢問：

- 方法是 `GET`、`HEAD`、`POST` 之一
- 只帶瀏覽器允許的標頭（例如 `Accept`、`Accept-Language`、`Content-Language`、`Content-Type`）
- `Content-Type` 只能是 `application/x-www-form-urlencoded`、`multipart/form-data`、`text/plain`

```http
GET /products HTTP/1.1
Host: api.shop.example
Origin: https://app.shop.example

HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://app.shop.example
Vary: Origin
Content-Type: application/json
```

瀏覽器自動加上 `Origin` 標頭。收到回應後檢查 `Access-Control-Allow-Origin`：等於自己的 origin（或是 `*`），就把回應交給 JavaScript；否則丟棄並在 console 報錯。

### 預檢請求（preflight）：先問能不能送

`Content-Type: application/json`、帶 `Authorization` 標頭、用 `PUT`／`PATCH`／`DELETE`，都不符合簡單請求的條件。這時瀏覽器先送一個 `OPTIONS` 詢問：

```http
OPTIONS /orders HTTP/1.1
Host: api.shop.example
Origin: https://app.shop.example
Access-Control-Request-Method: POST
Access-Control-Request-Headers: authorization, content-type
```

伺服器要回 2xx，並列出允許的來源、方法、標頭：

```http
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.shop.example
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE
Access-Control-Allow-Headers: Authorization, Content-Type
Access-Control-Max-Age: 600
Vary: Origin
```

通過之後瀏覽器才送出真正的 `POST`，而真正的回應**也要再帶一次** `Access-Control-Allow-Origin`。

```
瀏覽器                                      api.shop.example
  |--- OPTIONS /orders --------------------->|  只有 Origin 與 Access-Control-Request-*，不帶 body
  |<-- 204 + Access-Control-Allow-* ---------|  逐項檢查：origin、方法、每個標頭
  |--- POST /orders（帶 body、Authorization）->|  通過才送
  |<-- 201 + Access-Control-Allow-Origin ----|  沒帶這個標頭，回應一樣讀不到
```

各標頭的作用：

| 標頭 | 出現在 | 作用 |
|---|---|---|
| `Origin` | 請求 | 瀏覽器自動帶，網頁改不了 |
| `Access-Control-Request-Method`、`-Headers` | 預檢請求 | 真正的請求要用什麼方法、帶哪些標頭 |
| `Access-Control-Allow-Origin` | 回應 | 允許的來源：單一 origin 或 `*`，**不能列多個** |
| `Access-Control-Allow-Methods`、`-Headers` | 預檢回應 | 允許的方法、標頭 |
| `Access-Control-Allow-Credentials` | 回應 | `true` 才允許帶 cookie 的請求讀取回應 |
| `Access-Control-Max-Age` | 預檢回應 | 預檢結果快取幾秒；瀏覽器各有上限（Chrome 為 2 小時，Firefox 為 24 小時） |
| `Access-Control-Expose-Headers` | 回應 | 讓 JavaScript 讀得到額外的回應標頭，例如 `Location`、`X-Request-Id` |

`Allow-Origin` 只能放一個值，要允許多個來源時，伺服器要讀請求的 `Origin`，比對白名單，**命中才原樣回傳那個 origin**，並加上 `Vary: Origin`。少了 `Vary`，CDN 或快取可能把給 A 來源的回應拿去給 B 來源用，B 就會看到「origin 不符」的錯誤。

### 帶憑證的請求

`fetch` 預設只在同源時帶 cookie。跨來源要帶 cookie，前端要明確開啟：

```js
// fetch
fetch('https://api.shop.example/me', { credentials: 'include' })
// axios
axios.get('https://api.shop.example/me', { withCredentials: true })
```

這時伺服器的規則更嚴格：

- 回應要有 `Access-Control-Allow-Credentials: true`
- `Access-Control-Allow-Origin` **不能是 `*`**，必須是確切的 origin
- `Allow-Headers`、`Allow-Methods`、`Expose-Headers` 的 `*` 在帶憑證時不再代表「全部」，要明列

規則這麼嚴，是因為「任何網站都能讀取帶著使用者 cookie 的回應」就等於沒有同源政策。

用 `Authorization: Bearer` 標頭帶 token 不算瀏覽器意義上的「憑證模式」，不需要 `Allow-Credentials`，但 `Authorization` 會觸發預檢，要列在 `Allow-Headers` 裡。

### 伺服器端的設定

以 FastAPI（Starlette 的 `CORSMiddleware`）為例：

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://app.shop.example", "http://localhost:5173"],  # 明列，不用 "*"
    allow_credentials=True,                       # 要帶 cookie
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
    expose_headers=["Location", "X-Request-Id"],
    max_age=600,
)
```

middleware 會處理 `OPTIONS` 預檢、比對 origin、加上 `Vary: Origin`。如果 CORS 是在 nginx 或 API 閘道設定，就不要在應用程式再設一次：兩層都加 `Access-Control-Allow-Origin`，回應會出現兩個值，瀏覽器一樣會拒絕。

另一種做法是**不要跨來源**：讓前端與 API 走同一個 origin（例如 `https://shop.example/` 給前端、`https://shop.example/api/` 由反向代理轉到後端）。同源就沒有 CORS，也沒有預檢的額外來回。本機開發時，Vite 等開發伺服器的 proxy 功能就是這個做法。

## Cookie 的屬性

伺服器用 `Set-Cookie` 種 cookie，之後瀏覽器在符合條件時**自動**帶上：

```http
Set-Cookie: __Host-sid=k8Jf2...; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=1209600
```

| 屬性 | 作用 | 不設的後果 |
|---|---|---|
| `HttpOnly` | JavaScript（`document.cookie`）讀不到 | XSS 時 session id 被直接偷走 |
| `Secure` | 只在 HTTPS 送出 | 在 HTTP 連線上以明文傳送 |
| `SameSite` | 跨站請求時要不要送（見下表） | 多數瀏覽器有預設值，但各家不一致，要明確設定 |
| `Domain` | 送給哪些主機 | 不設：只送給種下它的那個主機（host-only）；設 `Domain=shop.example`：送給它和**所有子網域** |
| `Path` | 送給哪些路徑 | 預設是種 cookie 那個請求的路徑目錄；`Path` 不是安全邊界，同源的頁面都能讀 |
| `Max-Age`／`Expires` | 有效期限 | 不設：瀏覽器關閉時刪除（session cookie；但瀏覽器的「還原分頁」功能可能讓它留著） |
| `Partitioned` | 第三方情境下，依頂層網站分開儲存（CHIPS） | 見下方第三方 cookie |

名稱前綴是瀏覽器強制的規則：`__Host-` 開頭的 cookie 必須 `Secure`、`Path=/`、不能設 `Domain`；`__Secure-` 開頭的必須 `Secure`。用 `__Host-` 可以防止子網域種下同名的 cookie 來覆蓋 session。

### SameSite 與「site」

`SameSite` 比較的是 **site**，不是 origin。site 大致是 scheme 加上「可註冊網域」（例如 `shop.example`）。所以：

| 從 → 到 | 同源？ | 同站？ |
|---|---|---|
| `https://app.shop.example` → `https://api.shop.example` | 否 | 是 |
| `https://shop.example` → `https://evil.example` | 否 | 否 |
| `http://shop.example` → `https://shop.example` | 否 | 否（scheme 不同；現代瀏覽器採用含 scheme 的判斷） |

`app` 呼叫 `api` 是**跨來源但同站**：要過 CORS，但 `SameSite=Lax` 甚至 `Strict` 的 cookie 都會被帶上（前提是前端用了 `credentials: 'include'`）。

| SameSite 值 | 跨站時會不會送 |
|---|---|
| `Strict` | 不送。從別的網站點連結進來，第一個頁面也沒有登入狀態 |
| `Lax` | 只在「頂層導覽且方法安全」（點連結、網址列輸入的 GET）時送；跨站的 `fetch`、iframe、表單 POST 都不送 |
| `None` | 都送，**必須同時設 `Secure`**，否則瀏覽器會拒絕這個 cookie |

沒有設 `SameSite` 時，Chrome 當作 `Lax` 處理；其他瀏覽器的預設不完全相同，所以要明確寫出來。

### 第三方 cookie

「第三方」是指 cookie 所屬的站和網址列上的頂層網站不同，例如 `shop.example` 的頁面裡嵌了 `widget.other.example` 的 iframe。這類 cookie 正在被各瀏覽器限制：Safari 預設封鎖、Firefox 預設依頂層網站分區儲存；Chrome 的計畫幾經調整，以 Chrome 官方公告為準。

設計上的結論是：**不要依賴第三方 cookie**。前端與 API 放在同一個站（不同子網域即可）或同一個 origin；嵌入式元件需要獨立狀態時，評估 `Partitioned`（CHIPS）。

## 實際程式：模擬瀏覽器的 CORS 判斷

下面這段 JavaScript 照著上面的規則，判斷一個請求要不要預檢、伺服器的回應能不能通過，並產生類似 Chrome 的錯誤訊息（訊息是依常見格式改寫的，實際措辭依瀏覽器版本可能不同）：

```js run
const SAFE_HEADERS = ['accept', 'accept-language', 'content-language', 'content-type']
const SIMPLE_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain']

function needsPreflight(req) {
  if (!['GET', 'HEAD', 'POST'].includes(req.method)) return true
  for (const [k, v] of Object.entries(req.headers)) {
    if (!SAFE_HEADERS.includes(k.toLowerCase())) return true
    if (k.toLowerCase() === 'content-type' && !SIMPLE_TYPES.includes(v.split(';')[0].trim())) return true
  }
  return false
}

function checkAllowOrigin(req, res) {
  const allow = res['access-control-allow-origin']
  if (!allow) return "No 'Access-Control-Allow-Origin' header is present on the requested resource."
  if (req.credentials === 'include') {
    if (allow === '*') return "The value of the 'Access-Control-Allow-Origin' header in the response must not be the wildcard '*' when the request's credentials mode is 'include'."
    if (res['access-control-allow-credentials'] !== 'true') return "The value of the 'Access-Control-Allow-Credentials' header in the response is '" + (res['access-control-allow-credentials'] || '') + "' which must be 'true' when the request's credentials mode is 'include'."
  }
  if (allow !== '*' && allow !== req.origin) return `The 'Access-Control-Allow-Origin' header has a value '${allow}' that is not equal to the supplied origin.`
  return null
}

function browserFetch(req, server) {
  const prefix = `Access to fetch at '${req.url}' from origin '${req.origin}' has been blocked by CORS policy: `
  if (needsPreflight(req)) {
    const pre = server({ method: 'OPTIONS', origin: req.origin })
    if (pre.status < 200 || pre.status > 299) return prefix + "Response to preflight request doesn't pass access control check: It does not have HTTP ok status."
    const err = checkAllowOrigin(req, pre.headers)
    if (err) return prefix + "Response to preflight request doesn't pass access control check: " + err
    const methods = (pre.headers['access-control-allow-methods'] || '').split(',').map((s) => s.trim().toUpperCase())
    if (!['GET', 'HEAD', 'POST'].includes(req.method) && !methods.includes(req.method)) return prefix + `Method ${req.method} is not allowed by Access-Control-Allow-Methods in preflight response.`
    const allowed = (pre.headers['access-control-allow-headers'] || '').split(',').map((s) => s.trim().toLowerCase())
    for (const h of Object.keys(req.headers)) {
      const name = h.toLowerCase()
      if (needsPreflight({ method: 'GET', headers: { [h]: req.headers[h] } }) && !allowed.includes(name)) return prefix + `Request header field ${name} is not allowed by Access-Control-Allow-Headers in preflight response.`
    }
  }
  const res = server(req)
  const err = checkAllowOrigin(req, res.headers)
  return err ? prefix + err : `OK：JavaScript 讀得到 ${res.status} 的回應`
}

// 伺服器：可以改這裡的設定，看哪一種組合會過
function makeServer({ origins, credentials, methods, headers, optionsStatus = 204 }) {
  return (req) => {
    const h = {}
    if (origins.includes('*')) h['access-control-allow-origin'] = '*'
    else if (origins.includes(req.origin)) h['access-control-allow-origin'] = req.origin
    if (credentials) h['access-control-allow-credentials'] = 'true'
    if (req.method === 'OPTIONS') {
      h['access-control-allow-methods'] = methods.join(', ')
      h['access-control-allow-headers'] = headers.join(', ')
      return { status: optionsStatus, headers: h }
    }
    return { status: 201, headers: h }
  }
}

const req = {
  url: 'https://api.shop.example/orders', origin: 'https://app.shop.example', method: 'POST',
  credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'r-1' },
}
const cases = [
  ['OPTIONS 沒有路由，回 405', { origins: ['https://app.shop.example'], credentials: true, methods: ['POST'], headers: ['Content-Type'], optionsStatus: 405 }],
  ['Allow-Origin 用 *', { origins: ['*'], credentials: true, methods: ['POST'], headers: ['Content-Type', 'X-Request-Id'] }],
  ['忘了 Allow-Credentials', { origins: ['https://app.shop.example'], credentials: false, methods: ['POST'], headers: ['Content-Type', 'X-Request-Id'] }],
  ['漏列 X-Request-Id', { origins: ['https://app.shop.example'], credentials: true, methods: ['POST'], headers: ['Content-Type'] }],
  ['設定正確', { origins: ['https://app.shop.example'], credentials: true, methods: ['POST'], headers: ['Content-Type', 'X-Request-Id'] }],
]
console.log('需要預檢嗎？', needsPreflight(req))
for (const [name, cfg] of cases) console.log(`\n[${name}]\n` + browserFetch(req, makeServer(cfg)))
```

## 常見錯誤與錯誤訊息

CORS 失敗時，`fetch` 只會丟出很籠統的錯誤（Chrome 是 `TypeError: Failed to fetch`，Firefox 是 `TypeError: NetworkError when attempting to fetch resource.`），程式拿不到狀態碼，**原因只寫在 console**。Chrome 的訊息都以 `Access to fetch at '…' from origin '…' has been blocked by CORS policy:` 開頭，後半段才是重點：

| 訊息後半段 | 意思 | 怎麼修 |
|---|---|---|
| `No 'Access-Control-Allow-Origin' header is present on the requested resource.` | 回應沒有 `Allow-Origin` | 伺服器加 CORS 設定。也要檢查：**錯誤回應**（500、404、proxy 回的 502）是不是沒經過 CORS middleware |
| `Response to preflight request doesn't pass access control check: It does not have HTTP ok status.` | `OPTIONS` 回了非 2xx（常見 401、404、405） | 讓 `OPTIONS` 不經過認證、有對應的處理；預檢請求不會帶 `Authorization` |
| `Method PATCH is not allowed by Access-Control-Allow-Methods in preflight response.` | `Allow-Methods` 沒列這個方法 | 補上 |
| `Request header field authorization is not allowed by Access-Control-Allow-Headers in preflight response.` | 自訂標頭沒列進 `Allow-Headers` | 補上；常漏的是 `Authorization`、`Idempotency-Key`、`X-Request-Id` |
| `The value of the 'Access-Control-Allow-Origin' header in the response must not be the wildcard '*' when the request's credentials mode is 'include'.` | 帶 cookie 卻回 `*` | 改成比對白名單後回確切的 origin，加 `Vary: Origin` |
| `The value of the 'Access-Control-Allow-Credentials' header in the response is '' which must be 'true' when the request's credentials mode is 'include'.` | 帶 cookie 但伺服器沒回 `Allow-Credentials: true` | 補上 |
| `The 'Access-Control-Allow-Origin' header has a value '…' that is not equal to the supplied origin.` | 回的 origin 和請求的不同 | 常見原因：寫死了正式環境的 origin、快取少了 `Vary: Origin`、`http`／`https` 或 port 不同 |
| `… contains multiple values '…, …', but only one is allowed.` | 回應有兩個 `Allow-Origin` | nginx 與應用程式都加了 CORS 標頭，只留一層 |

Firefox 的訊息格式不同，例如 `Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at … (Reason: CORS header 'Access-Control-Allow-Origin' missing).`，括號裡的 Reason 對應上表的原因。

cookie 相關的問題不會出現在 CORS 錯誤裡，要到開發者工具的 Application（或 Storage）分頁看 cookie 有沒有被存下來，以及 Network 分頁裡請求的 Cookie 標頭。Chrome 會在被拒絕的 `Set-Cookie` 旁顯示警告圖示，滑過去可以看到原因，例如 `SameSite=None` 卻沒有 `Secure`。

其他常見錯誤：

- **用 `mode: 'no-cors'` 消除錯誤**：請求會送出，但回應變成 opaque，JavaScript 讀不到任何內容，`response.ok` 是 `false`、狀態是 0。這只是把錯誤藏起來。
- **把 CORS 當成授權**：只允許自己的前端 origin，就以為別人呼叫不了 API。curl、腳本、伺服器都不受 CORS 限制，授權還是要靠 token 或 session 檢查。
- **反射任意 origin 又允許憑證**：把請求的 `Origin` 不經比對就回傳，等於允許所有網站帶著使用者的 cookie 讀取回應。
- **登入後 cookie 沒被帶上**：前端忘了 `credentials: 'include'`；或 cookie 設了 `Domain=api.shop.example` 卻期待在 `app.shop.example` 收到；或本機用 `http://localhost` 卻設了 `Secure`（多數瀏覽器把 `localhost` 視為安全環境而允許，但不要假設所有環境都一樣，要實際確認）。
- **CSRF 只靠 CORS**：跨站表單 POST 是簡單請求，不需要預檢就會送到伺服器並執行。改變狀態的 API 要用 `SameSite=Lax`（或 `Strict`）的 cookie，加上 CSRF token 或只接受 JSON（觸發預檢）。

## 動手

1. 按 JavaScript 那段的「在 Playground 開啟」，把 `req.headers` 的 `Content-Type` 改成 `text/plain`、刪掉 `X-Request-Id`，看「需要預檢嗎？」變成 `false`；再把 `credentials` 改成 `'omit'`，看 `*` 那個案例是否通過。
2. 在 `makeServer` 加一個情境：`origins` 寫成 `['https://shop.example']`，對照 console 訊息找出原因。
3. 打開任一個網站的開發者工具，在 Application 分頁看它的 cookie 各設了哪些屬性，判斷哪些是 session、哪些是第三方。
4. 登入方案（cookie session、token 存哪裡、BFF）的整體取捨，到設計情境 [SPA 加手機 App 的登入方案](#/scenario/auth-scheme) 比較。

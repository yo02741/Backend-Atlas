## 從一個具體問題開始：本機好好的，上線就壞

用 AI 產生的門診前端，API 的位址寫在一個常數裡：

```js
const API = 'http://localhost:8000'
const res = await fetch(`${API}/api/appointments?date=2026-11-20`)
```

開發時前端跑在 `http://localhost:5173`，後端在 `http://localhost:8000`。第一次執行，Console 出現：

```
Access to fetch at 'http://localhost:8000/api/appointments?date=2026-11-20' from origin
'http://localhost:5173' has been blocked by CORS policy: No 'Access-Control-Allow-Origin'
header is present on the requested resource.
```

接下來的幾個「修法」各自引出新的問題：

1. 加上 `mode: 'no-cors'`：錯誤訊息不見了，但 `res.status` 是 `0`，`await res.json()` 丟出 `SyntaxError: Unexpected end of JSON input`。
2. 請後端把 CORS 設成允許所有來源 `*`：清單出來了。登入之後，需要 session cookie 的 API 一直回 401。
3. 前端補上 `credentials: 'include'`：Console 換成另一個錯誤，`… must not be the wildcard '*' when the request's credentials mode is 'include'.`
4. 部署到 `https://clinic.example` 之後全部失敗：程式還寫著 `http://localhost:8000`，每位使用者的瀏覽器都去連自己電腦上的 8000 port。

前端與 API 不同源，才有這一連串的 CORS 與 cookie 問題。開發時讓 Vite 代為轉送 `/api`、正式環境讓前端與 `/api` 在同一個網域，程式一律寫相對路徑，這四件事都不會發生。

## 運作原理

### origin 怎麼比

origin 是 scheme、主機、port 三者的組合，路徑不算在內。三者都相同才是同源：

| 頁面 | 請求 | 同源嗎 | 差在哪 |
|---|---|---|---|
| `http://localhost:5173/appointments` | `http://localhost:5173/api/appointments` | 是 | 只差路徑 |
| `http://localhost:5173` | `http://localhost:8000` | 否 | port |
| `http://localhost:5173` | `http://127.0.0.1:5173` | 否 | 主機名稱不同，即使指向同一台電腦 |
| `https://clinic.example` | `https://clinic.example:443` | 是 | https 的預設 port 是 443 |
| `https://clinic.example` | `https://api.clinic.example` | 否 | 子網域也是不同的主機 |
| `http://clinic.example` | `https://clinic.example` | 否 | scheme |

在 Console 執行 `location.origin` 看目前頁面的 origin；`new URL(網址).origin` 看任意網址的 origin。

### 從瀏覽器這一側看一個跨來源請求

```
fetch('http://localhost:8000/api/appointments', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
  │
  ├─ 同源？ ── 是 ──► 直接送出，回應交給 JavaScript（狀態碼是什麼都一樣）
  │
  └─ 否 ─► 需要 preflight？（方法、標頭、Content-Type 不在簡單請求的範圍內）
             │
             ├─ 要 ─► 先送 OPTIONS ─► 回應不是 2xx、或沒有允許這個 origin／方法／標頭
             │                          └─► 真正的請求不送，TypeError
             │
             └─ 不用，或 preflight 通過 ─► 送出真正的請求（伺服器會執行它）
                                           └─► 回應沒有 Access-Control-Allow-Origin
                                                 └─► 丟掉回應，TypeError
```

兩個從前端看容易誤會的地方：

- **擋的是讀取**：不需要 preflight、或 preflight 通過的請求，會照樣送到伺服器並執行。一個 `POST` 被 CORS 擋下，掛號可能已經建立了，只是前端讀不到回應。
- **程式拿不到原因**：CORS 失敗時 `fetch` 丟出的是一般的網路錯誤，Chrome 是 `TypeError: Failed to fetch`、Firefox 是 `TypeError: NetworkError when attempting to fetch resource.`、Safari 是 `TypeError: Load failed`，和伺服器沒開、斷線時一模一樣。原因只寫在開發者工具裡。

伺服器要回哪些標頭、preflight 的完整規則，見後端的 [CORS、Cookie 與同源](#/skill/cors-cookies)。

### 幾種失敗在開發者工具裡長得不一樣

| 情況 | Network 分頁的狀態欄 | Console | 程式拿到 |
|---|---|---|---|
| 回應少了 CORS 標頭 | `CORS error` | `… has been blocked by CORS policy: …` | `TypeError` |
| preflight 失敗 | Type 是 `preflight` 的那一筆回 4xx，真正的請求是 `CORS error` | `… Response to preflight request doesn't pass access control check: …` | `TypeError` |
| 連不上伺服器 | `(failed)` | `GET … net::ERR_CONNECTION_REFUSED` | `TypeError` |
| 同源請求回 4xx、5xx | `404`、`500` | 列出這筆請求與它的狀態碼，沒有 CORS 字樣 | `Response`，`res.ok` 是 `false` |
| Vite proxy 連不上後端 | `502`（Vite 8；Vite 7 以前是 `500`） | 同上 | `Response`，`res.ok` 是 `false`；原因在執行 `vite` 的終端機 |

程式裡只能分出「拿到回應」與「沒拿到回應」兩類；沒拿到回應時是 CORS 還是斷線，要打開 Network 與 Console 才分得出來。回報給後端時附上 Console 那一行的全文與 Network 分頁的 `Copy as cURL`。

:::stop 讀到這裡可以先停：會判斷兩個網址同不同源，從 Network 與 Console 分出 CORS、preflight 與連線失敗。後面的 cookie、回應標頭與 Vite proxy，在登入後 API 回 401 或要設定開發環境時再回來讀。

### `credentials`：帶不帶 cookie

| `credentials` | 同源請求 | 跨來源請求 | 跨來源時伺服器要回 |
|---|---|---|---|
| `'omit'` | 不帶 cookie | 不帶 | |
| `'same-origin'`（預設） | 帶 | 不帶 | |
| `'include'` | 帶 | 帶 | `Access-Control-Allow-Credentials: true`，`Allow-Origin` 是確切的 origin（不能是 `*`） |

axios 對應的設定是 `withCredentials: true`。即使三方面都設好，cookie 本身的 `SameSite`、`Secure`、`Domain` 不允許時，瀏覽器照樣不帶；被擋下的 cookie 在 Network 分頁點開請求的 Cookies 分頁，勾 `Show filtered-out request cookies` 可以看到原因。

同源的請求不必寫 `credentials`，預設就會帶 cookie。這也是讓前端與 API 同源的另一個好處。

### 讀得到哪些回應標頭

跨來源時，JavaScript 只讀得到幾個基本的回應標頭：`Cache-Control`、`Content-Language`、`Content-Length`、`Content-Type`、`Expires`、`Last-Modified`、`Pragma`。分頁 API 回的 `X-Total-Count`、建立資源後的 `Location`，Network 分頁看得到，`res.headers.get()` 卻是 `null`，要後端列進 `Access-Control-Expose-Headers`。同源時沒有這個限制。

### 開發：Vite 的 `server.proxy`

```
瀏覽器                       Vite dev server（localhost:5173）           後端（localhost:8000）
  │ GET /api/appointments           │                                          │
  │ ── 同源，沒有 CORS ────────────►│ 路徑以 /api 開頭：轉送 ─────────────────►│
  │                                 │ （伺服器對伺服器，不經過瀏覽器的規則）     │
  │◄──────────── 回應 ──────────────│◄──────────────── 回應 ────────────────────│
```

瀏覽器只看到 `localhost:5173`，請求是同源的：沒有 CORS、沒有 preflight，同源的 cookie 也照常帶上。Vite 把符合規則的請求轉給後端，這段是伺服器對伺服器，不受同源政策限制。常用的選項：

| 選項 | 作用 |
|---|---|
| `target` | 轉送到哪裡，例如 `http://localhost:8000` |
| `changeOrigin` | 把 `Host` 標頭改成 target 的主機；後端依 `Host` 判斷時要開。用字串簡寫（`'/api': 'http://localhost:8000'`）時 Vite 自動設為 `true` |
| `rewrite` | 改寫路徑，例如拿掉 `/api` 前綴；後端的路由本來就有 `/api` 時不要加 |
| `ws` | 一併轉送 WebSocket |
| `cookieDomainRewrite` | 改寫後端 `Set-Cookie` 的 `Domain`，讓 cookie 存在 `localhost` 底下 |

`server.proxy` 只在 `vite`（開發）與 `vite preview` 有作用（後者沒設 `preview.proxy` 時沿用同一份），`vite build` 產出的靜態檔不包含任何轉送設定，正式環境要由前面的伺服器處理。

### 正式環境：同網域的 `/api`

把前端與 API 放在同一個網域，由反向代理依路徑分流：`https://clinic.example/` 給前端的靜態檔，`https://clinic.example/api/` 轉給後端。前端程式和開發時一樣寫 `/api/...`，同一份建置結果不用改。nginx 的寫法與 Kubernetes 上的做法見後端的 [前端與 nginx 上 K8s](#/skill/spa-containers) 與 [nginx 反向代理](#/skill/nginx)。

API 一定要放在另一個網域（例如 `https://api.clinic.example` 同時服務手機 App）時，就得跨來源：後端設定 CORS 白名單，要帶 cookie 時前端加 `credentials: 'include'`，API 的網址用建置時的環境變數傳入，不寫死在程式裡。

## 一段可以跑的判斷

下面用 `URL` 物件照上面的規則判斷：網址解析成什麼、和頁面同不同源、`fetch` 預設會不會帶 cookie、需不需要 preflight（簡單請求的規則有簡化，完整條件見後端的課）：

```js run
// 從某個頁面送出一個 fetch：網址解析成什麼、同不同源、預設帶不帶 cookie、要不要 preflight（簡化版規則）
const SIMPLE_METHODS = ['GET', 'HEAD', 'POST']
const SIMPLE_HEADERS = ['accept', 'accept-language', 'content-language', 'content-type']
const SIMPLE_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain']

function analyze(pageUrl, req) {
  const page = new URL(pageUrl)
  const url = new URL(req.url, page)                     // 相對路徑以目前頁面的網址為基準
  const sameOrigin = url.origin === page.origin
  const credentials = req.credentials ?? 'same-origin'   // fetch 的預設值
  const cookies = credentials === 'include' || (credentials === 'same-origin' && sameOrigin)
  const headers = Object.keys(req.headers ?? {}).map((h) => h.toLowerCase())
  const type = (req.headers?.['Content-Type'] ?? '').split(';')[0].trim()
  const preflight = !sameOrigin && (
    !SIMPLE_METHODS.includes(req.method ?? 'GET') ||
    headers.some((h) => !SIMPLE_HEADERS.includes(h)) ||
    (type !== '' && !SIMPLE_TYPES.includes(type)))
  return `${(req.method ?? 'GET').padEnd(5)} ${url.href}\n      同源：${sameOrigin ? '是' : '否'}  帶 cookie：${cookies ? '會' : '不會'}  preflight：${preflight ? '要' : '不用'}${sameOrigin ? '' : '  → 回應要有 CORS 標頭才讀得到'}`
}

console.log('— origin 比較 —')
for (const [a, b] of [
  ['http://localhost:5173/appointments', 'http://localhost:5173/api/appointments'],
  ['http://localhost:5173', 'http://localhost:8000'],
  ['http://localhost:5173', 'http://127.0.0.1:5173'],
  ['https://clinic.example', 'https://clinic.example:443/api'],
  ['https://clinic.example', 'https://api.clinic.example'],
  ['http://clinic.example', 'https://clinic.example'],
]) console.log(`${new URL(a).origin.padEnd(26)} vs ${new URL(b).origin.padEnd(28)} ${new URL(a).origin === new URL(b).origin ? '同源' : '不同源'}`)

console.log('\n— 開發：頁面在 http://localhost:5173 —')
const dev = 'http://localhost:5173/appointments'
console.log(analyze(dev, { url: '/api/appointments' }))                                    // 走 Vite proxy
console.log(analyze(dev, { url: 'http://localhost:8000/api/appointments' }))               // 寫死後端位址
console.log(analyze(dev, { url: 'http://localhost:8000/api/appointments', method: 'POST',
  headers: { 'Content-Type': 'application/json' } }))

console.log('\n— 正式：頁面在 https://clinic.example —')
const prod = 'https://clinic.example/appointments?date=2026-11-20'
console.log(analyze(prod, { url: '/api/appointments', method: 'POST', headers: { 'Content-Type': 'application/json' } }))
console.log(analyze(prod, { url: 'https://api.clinic.example/appointments', credentials: 'include',
  headers: { Authorization: 'Bearer …' } }))
console.log(analyze('https://clinic.example/appointments/42', { url: 'api/appointments' }))     // 少了開頭的斜線
```

最後一行是相對路徑少了開頭的 `/`：在 `/appointments/42` 這一頁送出 `fetch('api/appointments')`，網址會解析成 `/appointments/api/appointments`。

## 實際程式碼

### `vite.config.js`

```js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      // /api 開頭的請求轉給本機的後端；瀏覽器只看到 localhost:5173
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        // 後端的路由沒有 /api 前綴時才需要：
        // rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // 叫號看板的即時更新
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
})
```

### 共用的 API 函式

```js
// src/api/client.js：所有請求都經過這裡
// 同網域部署時 VITE_API_BASE 留空，網址就是相對路徑 /api/...
const BASE = import.meta.env.VITE_API_BASE ?? ''

export class ApiError extends Error {
  constructor(status, problem) {
    super(problem?.title || `HTTP ${status}`)
    this.status = status
    this.problem = problem
  }
}

export async function api(path, { body, ...init } = {}) {
  let res
  try {
    res = await fetch(`${BASE}/api${path}`, {
      ...init,
      // 跨網域部署才需要 'include'；同網域時預設的 'same-origin' 已經會帶 cookie
      credentials: BASE ? 'include' : 'same-origin',
      headers: body ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    // CORS、斷線、伺服器沒開都會到這裡，程式分不出來：給使用者一個統一的訊息
    throw new ApiError(0, { title: '無法連線到伺服器' })
  }
  if (!res.ok) {
    const isJson = (res.headers.get('Content-Type') || '').includes('json')
    throw new ApiError(res.status, isJson ? await res.json() : null)
  }
  return res.status === 204 ? null : res.json()
}

// 使用：await api('/appointments?date=2026-11-20')
```


## 常見錯誤與錯誤訊息

Console 的 CORS 訊息都以 `Access to fetch at '…' from origin '…' has been blocked by CORS policy:` 開頭，看後半段：

| 訊息後半段或現象 | 原因 | 誰修、怎麼修 |
|---|---|---|
| `No 'Access-Control-Allow-Origin' header is present on the requested resource.` | 跨來源的回應沒有 CORS 標頭；也可能是後端的 500、401 錯誤回應沒經過 CORS 設定 | 開發時改走 proxy、程式用相對路徑；必須跨來源時請後端設定，並查後端 log 的實際狀態碼 |
| `Response to preflight request doesn't pass access control check: It does not have HTTP ok status.` | 後端的 `OPTIONS` 回了 401、404 或 405 | 後端讓 `OPTIONS` 不經過驗證 |
| `Request header field authorization is not allowed by Access-Control-Allow-Headers in preflight response.` | 前端送的標頭沒被允許 | 後端列進 `Allow-Headers`；或確認前端是否真的需要這個標頭 |
| `The value of the 'Access-Control-Allow-Origin' header in the response must not be the wildcard '*' when the request's credentials mode is 'include'.` | 前端 `credentials: 'include'`，後端回 `*` | 後端改成比對白名單、回確切的 origin |
| `res.headers.get('X-Total-Count')` 是 `null`，Network 卻看得到這個標頭 | 跨來源，後端沒有 `Access-Control-Expose-Headers` | 後端加上；或改成同源 |
| `res.status` 是 `0`，`res.json()` 丟出 `SyntaxError: Unexpected end of JSON input` | 用了 `mode: 'no-cors'`，回應變成讀不到內容的 opaque response | 拿掉 `mode: 'no-cors'`，回到上面幾列處理 |
| `SyntaxError: Unexpected token '<', "<!doctype "... is not valid JSON` | 請求打到前端的 `index.html`：proxy 沒設定、路徑少了 `/api` 或開頭的 `/`，SPA fallback 回了 HTML | 檢查 Network 裡的 Request URL 與 proxy 規則 |
| 終端機出現 `http proxy error: /api/appointments` 與 `Error: connect ECONNREFUSED 127.0.0.1:8000` | 後端沒啟動，或 port 不對 | 啟動後端、核對 `target`；錯誤裡的位址是 `::1` 時，代表 `localhost` 解析成 IPv6、後端只聽 IPv4，`target` 改成 `http://127.0.0.1:8000` |
| 後端回 404，log 裡的路徑少了 `/api` | `rewrite` 拿掉了前綴，後端的路由卻有 `/api` | 拿掉 `rewrite` |
| 登入成功，之後的 API 都回 401 | 跨來源請求沒帶 cookie | 改成同源；或前端 `include`、後端允許憑證、cookie 的 `SameSite` 與 `Secure` 正確 |


## 動手

1. 按上面判斷程式的「在 Playground 開啟」，把正式環境的頁面改成 `https://www.clinic.example`，看哪些請求變成跨來源；再把 POST 的 `Content-Type` 改成 `text/plain`，看 preflight 那一欄怎麼變。
2. 在自己的 Vite 專案設定 `server.proxy`，Network 分頁確認 Request URL 是 `localhost:5173`；把後端關掉再發一次請求，對照瀏覽器拿到的狀態碼與終端機的 `http proxy error`。
3. 打開任何一個會呼叫其他網域 API 的網站，Network 分頁找 Type 是 `preflight` 的請求，看它的 `Access-Control-Request-Method`、`Access-Control-Request-Headers` 與回應的 `Access-Control-Allow-*`。
4. 讀後端的 [CORS、Cookie 與同源](#/skill/cors-cookies)，看伺服器那一側怎麼回這些標頭；再讀 [瀏覽器裡的儲存](#/skill/browser-storage)，比較 cookie 與 localStorage 的範圍。

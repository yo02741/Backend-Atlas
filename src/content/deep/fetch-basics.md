## 從一個具體問題開始：伺服器回 422，畫面說「掛號成功」

掛號按鈕的程式是這樣寫的：

```js
async function book(sessionId) {
  try {
    await fetch('/api/appointments', { method: 'POST', body: { sessionId } })
    toast('掛號成功')
  } catch {
    toast('掛號失敗')
  }
}
```

測試時一切正常，上線後病患抱怨「明明說成功，報到時卻查不到」。打開 Network 分頁，每一筆 `POST /api/appointments` 都是 422。有兩個錯：

1. `body` 直接放了物件。fetch 把它轉成字串 `[object Object]`，`Content-Type` 是 `text/plain;charset=UTF-8`，後端解析不出 `sessionId`，回 422。
2. fetch 收到 422 不會 reject。`await` 拿到一個 `Response`，程式繼續往下跑到「掛號成功」；`catch` 只會在網路層失敗時執行。

## 運作原理

### fetch 在哪裡 reject、在哪裡 resolve

```
fetch(url, options)
 ├─ 組成請求：方法、標頭、body          參數不合法（GET 帶 body）→ reject TypeError
 ├─ 跨網域時做 CORS 檢查（可能先送 OPTIONS） 被擋 → reject TypeError，細節只在 Console
 ├─ 建立連線：DNS、TCP、TLS               失敗、離線 → reject TypeError
 ├─ 等待回應                              signal 取消 → reject AbortError；逾時 → TimeoutError
 └─ 收到狀態行與標頭 → resolve(Response)   不管 200、404 還是 500
      └─ res.json() 讀 body               不是合法的 JSON → reject SyntaxError
```

| 情況 | `await fetch()` 的結果 | `res.ok` | 怎麼判斷 |
|---|---|---|---|
| 200、201 | Response | `true` | 讀 body |
| 204 | Response | `true` | 不讀 body |
| 400、401、403、404、409、422 | Response | `false` | `res.status`，讀 Problem Details |
| 500、502、503、504 | Response | `false` | `res.status`；body 可能是 HTML |
| 離線、DNS 失敗、連線被拒 | reject `TypeError` | 無 | `err.name === 'TypeError'` |
| 被 CORS 擋下 | reject `TypeError` | 無 | 和網路錯誤分不出來，看 Console |
| `controller.abort()` | reject `DOMException` | 無 | `err.name === 'AbortError'` |
| `AbortSignal.timeout()` 到時間 | reject `DOMException` | 無 | `err.name === 'TimeoutError'` |

`res.ok` 在狀態碼 200–299 時為 `true`。狀態碼的意思與每個類別該怎麼反應，見 [一個 HTTP 請求的一生](#/skill/http-basics)。

### 請求：方法、標頭、body

```js
fetch('/api/appointments', {
  method: 'POST',                                   // 預設 GET
  headers: { 'Content-Type': 'application/json' },  // body 是 JSON 時要自己設
  body: JSON.stringify({ sessionId: 42 }),          // 物件要先轉成字串
  credentials: 'same-origin',                       // 預設值：只有同源請求帶 cookie
  signal: AbortSignal.timeout(8000),                // 8 秒逾時
})
```

`body` 的型別決定瀏覽器自動帶的 `Content-Type`：

| `body` 的值 | 自動帶的 `Content-Type` | 備註 |
|---|---|---|
| 字串（包含 `JSON.stringify` 的結果） | `text/plain;charset=UTF-8` | 送 JSON 要自己改成 `application/json` |
| `URLSearchParams` | `application/x-www-form-urlencoded;charset=UTF-8` | 傳統表單格式 |
| `FormData` | `multipart/form-data; boundary=…` | 上傳檔案；不要自己設 `Content-Type`，會少了 boundary |
| 一般物件 | `text/plain;charset=UTF-8`，內容是 `[object Object]` | 開頭那個錯 |

`GET` 與 `HEAD` 不能帶 body。跨網域請求帶了 `Content-Type: application/json`，瀏覽器會先送一個 `OPTIONS` preflight，伺服器要回應對的 CORS 標頭，正式請求才會送出；伺服器那一側怎麼設定見 [CORS、Cookie 與同源](#/skill/cors-cookies)。

### query string 要編碼

網址裡的中文會被自動轉成 `%E7%8E%8B…`，但 `&`、`#`、`+` 這類有特殊意義的字元不會被當成值的一部分。搜尋字串是 `2#診間` 時，`/api/appointments?q=${q}` 送出去的 `q` 只剩 `2`，`#` 之後被當成網址的 fragment。用 `URLSearchParams` 組 query string：

```js
const params = new URLSearchParams({ date: '2026-11-20', q: '2#診間' })
fetch(`/api/appointments?${params}`)   // q=2%23%E8%A8%BA%E9%96%93
```

### 回應：狀態、標頭、body

- `res.status`：數字狀態碼。`res.statusText` 在 HTTP/2 與 HTTP/3 是空字串，不要拿來判斷。
- `res.headers.get('Content-Type')`：決定怎麼讀 body。錯誤回應用 Problem Details 時是 `application/problem+json`。
- `res.json()`、`res.text()`、`res.blob()`：讀 body，回傳 Promise。body 是一個串流，只能讀一次；要讀兩次先 `res.clone()`。
- 204 No Content 沒有 body，呼叫 `res.json()` 會丟 `SyntaxError`。

### Problem Details

RFC 9457 定義的錯誤格式，`Content-Type` 是 `application/problem+json`：

```json
{
  "type": "https://clinic.example/problems/session-full",
  "title": "這個診次已額滿",
  "status": 409,
  "detail": "11/20 上午 陳醫師的門診已額滿，可以改掛其他時段。"
}
```

`title` 是這類錯誤的簡短說明，`detail` 是這一次的具體說明。規格允許加擴充欄位，例如欄位驗證錯誤放 `errors: { phone: ['請輸入 10 碼手機號碼'] }`；這個欄位名不是標準的一部分，要和後端約定。後端怎麼設計錯誤格式見 [錯誤設計](#/skill/error-design)。

### 逾時與取消

fetch 沒有 `timeout` 選項。請求卡住時，瀏覽器的等待時間依瀏覽器與網路狀況而定，使用者只看到一直在轉。逾時與取消都靠 `signal`：

- `AbortSignal.timeout(8000)`：8 秒後自動取消，錯誤的 `name` 是 `TimeoutError`。2024 年 4 月進入 Baseline。
- `new AbortController()`：自己呼叫 `controller.abort()` 取消，錯誤的 `name` 是 `AbortError`。用在使用者離開頁面、換了搜尋條件時。
- `AbortSignal.any([controller.signal, AbortSignal.timeout(8000)])`：任一個觸發就取消，錯誤的 `name` 跟著觸發的那一個。2024 年 3 月進入 Baseline。

被取消的請求在 Network 分頁顯示 `(canceled)`。

## 實際程式

### 先看 Response 的行為

下面這段在 Worker 裡建立 `Response` 與 `Request` 物件，不需要連網，可以直接看到 `res.ok`、204、HTML 錯誤頁、重複讀 body、物件當 body 各自的結果：

```js run
// fetch 對 4xx、5xx 不會 reject：Response 照樣回來，要看 res.ok
const notFound = new Response('{"title":"找不到這筆預約"}', { status: 404 })
console.log('404 →', notFound.status, notFound.ok)

// 204 沒有 body，呼叫 res.json() 會丟 SyntaxError
try { await new Response(null, { status: 204 }).json() } catch (e) { console.log('204 →', e.name, e.message) }

// 反向代理的錯誤頁或 SPA fallback 回了 HTML，卻當 JSON 解析
try { await new Response('<!doctype html><html><body>502</body></html>').json() } catch (e) { console.log('HTML →', e.name, e.message) }

// body 只能讀一次
const once = new Response('{"id":1}')
await once.json()
try { await once.json() } catch (e) { console.log('讀第二次 →', e.name, e.message) }

// 物件直接放進 body：送出去的是字串 [object Object]
const req = new Request('https://api.example.com/appointments', { method: 'POST', body: { sessionId: 42 } })
console.log('物件當 body →', req.headers.get('Content-Type'), await req.text())
```

### 一個分類清楚的 apiFetch

專案裡所有請求都經過同一個函式，畫面只需要處理三類錯誤：回應不是 2xx（`ApiError`，帶狀態碼與 Problem Details）、逾時、網路錯誤。下面用假的 fetch 模擬六種回應，`apiFetch` 本身的寫法和真的專案相同（把 `fakeFetch` 換成 `fetch`）：

```js run
// 假的後端：依路徑回不同的 Response；/api/slow 永遠不回應
const routes = {
  '/api/appointments/1': () => new Response(JSON.stringify({ id: 1, patientName: '王○明' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  '/api/appointments/1/cancel': () => new Response(null, { status: 204 }),
  '/api/appointments/999': () => new Response(JSON.stringify({ type: 'about:blank', title: '找不到這筆預約', status: 404, detail: '預約 999 不存在' }), { status: 404, headers: { 'Content-Type': 'application/problem+json' } }),
  '/api/report': () => new Response('<html><body>502 Bad Gateway</body></html>', { status: 502, headers: { 'Content-Type': 'text/html' } }),
  '/api/offline': () => { throw new TypeError('Failed to fetch') },
  '/api/slow': null,
}
function fakeFetch(path, { signal } = {}) {
  return new Promise((resolve, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason))   // 取消或逾時：reject signal.reason
    const route = routes[path]
    if (route === null) return
    setTimeout(() => { try { resolve(route()) } catch (e) { reject(e) } }, 50)
  })
}

class ApiError extends Error {
  constructor(status, problem) {
    super(problem?.title || `HTTP ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.problem = problem
  }
}

async function apiFetch(path, { timeout = 300, ...options } = {}) {
  const res = await fakeFetch(path, { ...options, signal: AbortSignal.timeout(timeout) })
  if (res.status === 204) return null                       // 沒有 body
  const type = res.headers.get('Content-Type') || ''
  const isJson = type.includes('json')                      // application/json 或 application/problem+json
  if (!res.ok) throw new ApiError(res.status, isJson ? await res.json() : null)
  if (!isJson) throw new ApiError(res.status, { title: `預期 JSON，收到 ${type}` })
  return res.json()
}

for (const path of Object.keys(routes)) {
  try {
    console.log(`${path} → 成功`, await apiFetch(path))
  } catch (err) {
    const kind = err.name === 'TimeoutError' ? '逾時' : err.name === 'TypeError' ? '網路錯誤' : `ApiError ${err.status}`
    console.log(`${path} → ${kind}：${err.message}`)
  }
}
```

六行輸出依序是：成功、成功（`null`）、`ApiError 404：找不到這筆預約`、`ApiError 502：HTTP 502`、`網路錯誤：Failed to fetch`、`逾時：…`。畫面依這三類決定顯示什麼：`ApiError` 看狀態碼（4xx 顯示原因、5xx 給重試），網路錯誤與逾時給「無法連線」與重試。

開頭的掛號程式改成：

```js
async function book(sessionId) {
  try {
    await apiFetch('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    toast('掛號成功')
  } catch (err) {
    if (err.name === 'ApiError' && err.status === 409) showAlert(err.problem.detail)   // 額滿：顯示原因
    else showAlert('掛號沒有送出，請再試一次')
  }
}
```

## 常見錯誤與錯誤訊息

| Console 的訊息（Chrome） | 原因 | 修法 |
|---|---|---|
| `TypeError: Failed to fetch` | 離線、DNS 失敗、連線被拒，或被 CORS 擋下 | 看 Console 有沒有 CORS 訊息、Network 分頁的狀態是不是 `(failed)` |
| `Access to fetch at '…' from origin '…' has been blocked by CORS policy: …` | 跨網域請求，伺服器沒回對的 CORS 標頭 | 伺服器設定，或開發時用同網域的 `/api` 代理 |
| `SyntaxError: Unexpected token '<', "<!doctype "... is not valid JSON` | 回應是 HTML：反向代理的錯誤頁、SPA fallback 回了 `index.html`、路徑打錯 | Network 的 Response 分頁看實際內容；先檢查 `Content-Type` 再解析 |
| `SyntaxError: Unexpected end of JSON input` | body 是空的（204，或後端沒寫 body） | 204 不呼叫 `res.json()` |
| `TypeError: Failed to execute 'json' on 'Response': body stream already read` | 同一個 Response 讀了兩次 body | 讀一次存起來，或先 `res.clone()` |
| `TypeError: Failed to execute 'fetch' on 'Window': Request with GET/HEAD method cannot have body.` | GET 帶了 body | 條件放 query string |
| `Uncaught (in promise) …` | `await fetch()` 或 `res.json()` 沒有 `try/catch`，也沒有 `.catch()` | 統一經過 `apiFetch`，呼叫端處理錯誤 |
| `Mixed Content: The page at 'https://…' was loaded over HTTPS, but requested an insecure resource 'http://…'. This request has been blocked…` | HTTPS 頁面呼叫 `http://` 的 API | API 網址改成 `https://`，或用相對路徑 `/api/…` |

Firefox 與 Safari 的訊息不同：網路錯誤在 Firefox 是 `TypeError: NetworkError when attempting to fetch resource.`，在 Safari 是 `TypeError: Load failed`。判斷錯誤類型時看 `err.name`，不要比對訊息文字。

沒有錯誤訊息、但結果不對的情況：

- **4xx、5xx 當成功**：沒有檢查 `res.ok`，把 Problem Details 當成資料渲染，畫面出現 `undefined`。
- **後端收到 `[object Object]`**：body 沒有 `JSON.stringify`。Network 分頁的 Payload 看得到。
- **後端說沒收到 JSON**：`Content-Type` 還是 `text/plain;charset=UTF-8`，後端回 415 或 422。
- **搜尋字串被截斷**：query string 沒有用 `URLSearchParams` 或 `encodeURIComponent`。
- **跨網域的請求沒帶 cookie**：`credentials` 是預設的 `same-origin`；要帶就設 `include`，伺服器也要允許。

## 動手

1. 按上面兩段程式的「在 Playground 開啟」，在第二段加一條 `'/api/forbidden'` 路由回 403 Problem Details，看它被歸到哪一類；把 `timeout` 改成 `30`，看哪幾個請求變成逾時。
2. 打開任何一個會呼叫 API 的頁面，在 Network 分頁選 `Fetch/XHR`，點開一個請求，依序看 Headers（方法、狀態碼、`Content-Type`）、Payload（送出的 body）、Response（回來的 body）、Timing（等了多久）。
3. 節流選 `Offline` 再觸發一次請求，看 Console 的 `TypeError` 與 Network 的 `(failed)`；改用 `3G` 並把逾時設成 2 秒，看請求變成 `(canceled)`。
4. 請求的結果怎麼對應到畫面上的 loading、success、empty、error，接著讀 [API 的四種狀態](#/skill/api-states)。

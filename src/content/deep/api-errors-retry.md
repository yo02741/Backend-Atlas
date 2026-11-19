## 從一個具體問題開始：伺服器重啟的那一分鐘

門診系統中午部署新版，後端重啟期間有 30 秒回 `503`。前端的寫法是「失敗就每秒重試，直到成功」：

```js
async function load() {
  while (true) {
    try { return await apiFetch('/appointments') } catch { await sleep(1000) }
  }
}
```

全院約 800 個分頁開著，每個分頁每秒一個請求。後端第一台恢復的那一刻，同時湧進來的請求把它又打掛，重啟拖了 5 分鐘。同一段時間裡還發生了兩件事：

- 掛號的 `POST` 走同一段重試，第一次已經寫進資料庫、只是回應逾時，重送之後病患多了一筆掛號。
- 有一個畫面把錯誤直接塞進文字，櫃台看到「載入失敗：[object Object]」。

重試本身沒有錯，錯在沒有分類：哪些錯誤該重試、哪些請求能重試、重試的間隔與次數、使用者最後看到什麼。

## 運作原理

### 四類錯誤

| 類別 | 程式裡怎麼認 | 例子 | 自動重試 | 畫面 |
|---|---|---|---|---|
| 網路錯誤 | fetch reject，`err.name === 'TypeError'` | 離線、DNS 失敗、連線被拒、被 CORS 擋下 | 可以（冪等的請求） | 「無法連線」＋重試 |
| 逾時 | `err.name === 'TimeoutError'`（`AbortSignal.timeout()`） | 伺服器太慢 | 可以（冪等的請求） | 「回應逾時」＋重試 |
| 4xx | `res.ok` 為 `false`，`res.status` 在 400–499 | 400、403、404、409、422 | 不行（429 例外） | 原因與下一步 |
| 5xx | `res.status` 在 500–599 | 500、502、503、504 | 502、503、504 可以；500 看情況 | 「系統暫時無法處理」＋重試 |

Chrome 的網路錯誤訊息是 `TypeError: Failed to fetch`，Firefox 是 `TypeError: NetworkError when attempting to fetch resource.`，Safari 是 `TypeError: Load failed`；程式裡判斷 `name`，不要比對訊息文字。401 與 403 的處理見 [登入狀態與 401](#/skill/auth-frontend)，422 與 409 對回表單見 [表單送出與驗證錯誤](#/skill/form-submit)。

502、503、504 多半是暫時的：閘道後面的服務沒回應、正在重啟、過載。500 是伺服器自己的程式出錯，同樣的請求重送常常得到同樣的 500，自動重試一次就夠，或乾脆不重試。

### 哪些請求可以自動重試

逾時與網路錯誤有一個麻煩：前端不知道請求有沒有到過伺服器。連線在送出之前就斷了，伺服器什麼都沒做；回應在回程丟了，伺服器已經做完。

| 方法 | 冪等 | 自動重試 |
|---|---|---|
| `GET`、`HEAD` | 是，而且不改資料 | 可以 |
| `PUT`、`DELETE` | 是：送兩次的結果和送一次一樣 | 可以 |
| `POST`、`PATCH` | 否：送兩次可能建立兩筆 | 只有帶 `Idempotency-Key` 且後端支援時 |

沒有冪等鍵的 `POST` 失敗時，交給使用者決定要不要再送，並在畫面上提醒「如果掛號清單裡已經有這筆，不用再送」。伺服器那一側怎麼實作冪等鍵，見 [分頁、篩選、版本與冪等鍵](#/skill/api-patterns)。

`429` 例外：伺服器明確說「這次沒處理，等一下再來」，所以即使是 `POST`，照 `Retry-After` 等待後重送也安全。

### 退避與抖動

固定間隔重試的問題在開頭看到了：所有客戶端同時失敗、同時等 1 秒、同時重送。退避讓間隔越拉越長，抖動讓每個客戶端的時間錯開：

```
第 n 次重試前的等待 = base × 2^n × 隨機(0.5 ~ 1)
```

| 重試 | 不抖動（base 500 ms） | 加抖動的範圍 |
|---|---|---|
| 第 1 次 | 500 ms | 250–500 ms |
| 第 2 次 | 1000 ms | 500–1000 ms |
| 第 3 次 | 2000 ms | 1000–2000 ms |

再加上上限：前端的重試通常 2 到 3 次就停，之後顯示錯誤與「重試」按鈕。使用者正在等畫面，自動重試拖太久，不如讓他知道出了什麼事。伺服器之間呼叫的重試預算與斷路器，見 [呼叫外部服務的韌性](#/skill/resilience)。

### 429 與 Retry-After

`Retry-After` 有兩種寫法：秒數（`Retry-After: 30`）或 HTTP 日期（`Retry-After: Wed, 19 Nov 2026 08:30:00 GMT`）。等待期間停用會觸發同一個請求的按鈕，並顯示還要等多久。等待時間太長（例如超過 10 秒）就不自動等，直接顯示訊息。

跨網域時有一個陷阱：`Retry-After` 不在 CORS 預設允許前端讀取的回應標頭裡。Network 分頁的 Response Headers 看得到它，程式裡 `res.headers.get('Retry-After')` 卻是 `null`，要伺服器加上 `Access-Control-Expose-Headers: Retry-After`。後端回的 `X-Request-ID` 也一樣。限流在伺服器那一側怎麼做，見 [限流演算法](#/skill/rate-limiting)。

### 給使用者看的與給 log 的

| 錯誤 | 使用者看到 | 送進 log 或錯誤監控 |
|---|---|---|
| 網路錯誤 | 「無法連線，請檢查網路」 | 錯誤名稱、網址、`navigator.onLine` |
| 逾時 | 「伺服器回應逾時，請稍後再試」 | 網址、逾時秒數 |
| 4xx（有 Problem Details） | 依 `type` 對應的文案，對不到就用 `detail` | 狀態碼、`type`、request id |
| 5xx | 「系統暫時無法處理，請稍後再試」 | 狀態碼、request id、回應 body |

不給使用者看的：狀態碼數字、`TypeError`、stack trace、整段 JSON。回報問題時最有用的是 request id：本站後端在每個回應加 `X-Request-ID` 標頭，錯誤畫面可以小字顯示「錯誤代碼 req-3f9c2a1b4e5d」，客服拿這串字就能在後端日誌找到那一個請求。後端怎麼產生與記錄它，見 [錯誤設計](#/skill/error-design)。

### 離線

`navigator.onLine` 為 `false` 時一定沒有網路，可以直接顯示「目前沒有網路」，不用等逾時。為 `true` 只代表有網路介面，不代表連得到伺服器。`online` 事件在恢復連線時觸發，適合自動重抓一次。

## 實際程式

### 可以注入 fetch 的重試函式

下面把 `fetchWithRetry` 的 fetch 換成一個照腳本回應的假伺服器（`base` 調成 50 ms 方便觀察），跑幾種情境，看每次請求的時間與最後的結果：

```js run
const sleep = (ms, signal) => new Promise((ok, fail) => {
  if (signal?.aborted) return fail(signal.reason)
  const t = setTimeout(ok, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); fail(signal.reason) }, { once: true })
})
class ApiError extends Error {
  constructor(status, problem) { super(problem?.title ?? `HTTP ${status}`); this.name = 'ApiError'; this.status = status }
}
const backoff = (attempt, base) => base * 2 ** attempt * (0.5 + Math.random() / 2)   // 指數退避加抖動
function retryAfterMs(v) {
  if (v === null) return null
  if (/^\d+$/.test(v)) return Number(v) * 1000                 // 秒數
  const t = Date.parse(v)                                       // 或 HTTP 日期
  return Number.isNaN(t) ? null : Math.max(0, t - Date.now())
}

async function fetchWithRetry(fetchImpl, path, { method = 'GET', headers, signal, retries = 2, base = 500, timeout = 8000, maxWait = 10_000 } = {}) {
  const h = new Headers(headers)
  const canRetry = ['GET', 'HEAD', 'PUT', 'DELETE'].includes(method) || h.has('Idempotency-Key')
  for (let attempt = 0; ; attempt++) {
    let res
    try {
      const s = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)
      res = await fetchImpl(path, { method, headers: h, signal: s })
    } catch (err) {
      if (signal?.aborted) throw err                             // 使用者取消：不重試
      if (!canRetry || attempt >= retries) throw err             // 網路錯誤或逾時
      await sleep(backoff(attempt, base), signal)
      continue
    }
    if (res.ok) return res
    if (res.status === 429) {                                    // 伺服器沒處理，照它說的等
      const wait = retryAfterMs(res.headers.get('Retry-After'))
      if (wait !== null && wait <= maxWait && attempt < retries) { await sleep(wait, signal); continue }
    } else if ([502, 503, 504].includes(res.status) && canRetry && attempt < retries) {
      await sleep(backoff(attempt, base), signal)
      continue
    }
    throw new ApiError(res.status, await res.json().catch(() => null))
  }
}

// 假伺服器：依序回應腳本裡的狀態；'net' 是網路錯誤，'429:1' 是 429 加 Retry-After: 1
function fakeServer(script) {
  const t0 = Date.now(), log = []
  const impl = async (path, { method, signal }) => {
    const step = script[Math.min(log.length, script.length - 1)]
    log.push(`${String(Date.now() - t0).padStart(5)} ms  ${method} ${path} → ${step}`)
    if (signal.aborted) throw signal.reason
    if (step === 'net') throw new TypeError('Failed to fetch')
    const [status, after] = String(step).split(':')
    const body = status === '200' ? '[]' : JSON.stringify({ title: `示意錯誤 ${status}`, status: +status })
    return new Response(body, { status: +status, headers: after ? { 'Retry-After': after } : {} })
  }
  return { impl, log }
}

async function scenario(name, script, opts = {}, abortAfter) {
  const { impl, log } = fakeServer(script)
  const controller = new AbortController()
  if (abortAfter) setTimeout(() => controller.abort(), abortAfter)
  let result
  try {
    const res = await fetchWithRetry(impl, '/api/appointments', { base: 50, signal: controller.signal, ...opts })
    result = `成功 ${res.status}`
  } catch (err) {
    result = `失敗：${err.name}${err.status ? ' ' + err.status : ''}`
  }
  console.log(`\n${name}：${result}（共 ${log.length} 次請求）\n${log.join('\n')}`)
}

await scenario('GET，503 兩次後恢復', [503, 503, 200])
await scenario('GET，網路錯誤一次', ['net', 200])
await scenario('GET，403 不重試', [403])
await scenario('POST 沒有冪等鍵，503 不自動重試', [503, 200], { method: 'POST' })
await scenario('POST 帶冪等鍵，503 之後重試', [503, 200], { method: 'POST', headers: { 'Idempotency-Key': 'k-1' } })
await scenario('429，照 Retry-After 等 1 秒', ['429:1', 200])
await scenario('一直 503，重試用完', [503])
await scenario('一直 503，120 ms 時使用者取消', [503], { base: 200 }, 120)
```

看輸出的時間欄：503 的兩次重試間隔大約是 25–50 ms 與 50–100 ms（`base` 是 50），429 那一組等了整整 1 秒。最後一組在等待中被取消，請求數停在 1。

### 錯誤轉成畫面上的訊息

```js
// errors.js：所有錯誤畫面都從這裡拿文案
const TYPE_TEXT = {
  'https://clinic.example/problems/session-full': '這個診次已額滿',
  'https://clinic.example/problems/cancel-deadline-passed': '已超過可取消的時間',
}

export function toUserMessage(err) {
  if (err.name === 'AbortError') return null                               // 使用者自己取消，不顯示
  if (err.name === 'TimeoutError') return { text: '伺服器回應逾時，請稍後再試', retry: true }
  if (err.name === 'TypeError') {
    return { text: navigator.onLine ? '無法連線到伺服器' : '目前沒有網路', retry: true }
  }
  const p = err.problem ?? {}
  if (err.status === 429) return { text: '操作太頻繁，請稍後再試', retry: false }
  if (err.status >= 500) return { text: '系統暫時無法處理，請稍後再試', retry: true, requestId: err.requestId }
  return { text: TYPE_TEXT[p.type] ?? p.detail ?? '無法完成這個操作', retry: false, requestId: err.requestId }
}

export function report(err, context) {
  // 給 log 與錯誤監控：技術細節都在這裡，不進畫面
  console.error('[api]', context, { name: err.name, status: err.status, type: err.problem?.type, requestId: err.requestId })
}
```

`err.requestId` 由 `apiFetch` 在建立 `ApiError` 時從 `res.headers.get('X-Request-ID')` 取得；跨網域時記得請後端把它列進 `Access-Control-Expose-Headers`。

### 在元件裡用

```js
// <script setup> 節錄：清單載入失敗時的處理
const controller = new AbortController()
onUnmounted(() => controller.abort())          // 離開頁面時，等待中的重試一起停止

async function load() {
  status.value = 'loading'
  try {
    const res = await fetchWithRetry(fetch, '/api/appointments', { signal: controller.signal })
    items.value = await res.json()
    status.value = items.value.length ? 'success' : 'empty'
  } catch (err) {
    const msg = toUserMessage(err)
    if (!msg) return                            // 被取消
    report(err, 'load appointments')
    error.value = msg                           // 畫面顯示 msg.text，msg.retry 決定有沒有「重試」
    status.value = 'error'
  }
}

window.addEventListener('online', () => { if (status.value === 'error') load() })   // 恢復連線自動重抓
```

`online` 的監聽要在元件卸載時移除，寫法見 [Vue 的生命週期](#/skill/lifecycle)。

### 現成的工具

TanStack Query v5 的查詢預設在瀏覽器重試 3 次，間隔是 `min(1000 × 2^n, 30000)` 毫秒；mutation 預設不重試。它不分辨 4xx 與 5xx，403 也會重試 3 次，通常要自己傳 `retry: (count, err) => err.status >= 500 && count < 2`。用了工具，上面的分類與文案仍然要自己定。

## 常見錯誤與錯誤訊息

| 現象或訊息 | 原因 | 修法 |
|---|---|---|
| 伺服器恢復的瞬間又被打掛 | 固定間隔、沒有上限的重試 | 指數退避加抖動，最多 2 到 3 次 |
| 一筆操作建立了兩筆資料 | 逾時後自動重送沒有冪等鍵的 `POST` | `POST` 不自動重試，或帶 `Idempotency-Key` |
| 403、404 被重試了好幾次 | 所有錯誤都重試 | 只重試網路錯誤、逾時、502、503、504、429 |
| 畫面顯示 `[object Object]` 或 `TypeError: Failed to fetch` | 把錯誤物件直接放進文字 | 經過 `toUserMessage` 轉成文案 |
| `res.headers.get('Retry-After')` 是 `null`，Network 分頁卻看得到 | 跨網域，後端沒有 `Access-Control-Expose-Headers` | 後端列出要給前端讀的標頭 |
| 換頁之後 Network 分頁還在出現重試 | 等待中的重試沒有接上 `signal` | 等待用可以被 abort 的 `sleep`，卸載時 abort |
| 重試期間畫面一直轉圈，使用者不知道發生什麼 | 重試次數多、間隔長 | 縮短上限；必要時顯示「連線不穩，重試中（第 2 次）」 |
| 網路斷了，等了 8 秒才顯示錯誤 | 沒看 `navigator.onLine` | `false` 時立即顯示「目前沒有網路」 |

## 動手

1. 按上面程式的「在 Playground 開啟」，把 `scenario('GET，503 兩次後恢復', …)` 的腳本改成 `[500, 200]`，決定 500 要不要重試，改 `fetchWithRetry` 讓結果符合你的決定。
2. 在 `scenario` 加一個 `'429:Wed, 19 Nov 2026 08:30:00 GMT'`（過去的時間），確認 `retryAfterMs` 回傳 0、立即重送。
3. 在自己的專案把 Network 分頁的節流設成 `Offline`，操作一次，確認畫面說「目前沒有網路」；恢復後是否自動重抓。
4. 錯誤畫面的四種狀態與「重試」按鈕的樣子，見 [API 的四種狀態](#/skill/api-states)。

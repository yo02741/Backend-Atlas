## 從一個具體問題開始：上線了，使用者還在跑舊版

週四下午部署新版前端，修了結帳按鈕的 bug。一小時後客服仍陸續收到同樣的回報。工程師自己打開網站是新版，請使用者「重新整理」也沒用，要「清除快取」才好。

追查後發現兩件事：

1. `index.html` 的回應帶著 `Cache-Control: max-age=86400`，瀏覽器在一天內直接用存著的舊 `index.html`，而舊的 `index.html` 引用的是舊的 `app.js`。
2. 另一個 API `GET /me/orders` 回應帶了 `Cache-Control: public, max-age=60`，CDN 把 A 使用者的訂單列表存起來，60 秒內回給了其他使用者。

第一個問題讓修正遲遲送不到使用者手上，第二個問題是資料外洩。兩個都只是一個標頭的值寫錯。HTTP 快取的規則決定**誰可以存回應、存多久、過期後怎麼確認是否還能用**，寫對了能省下大部分流量，寫錯了就是上面這兩種事故。

## 運作原理：快取在哪裡

```
瀏覽器 ──→ [瀏覽器快取] ──→ [CDN／反向代理快取] ──→ 原站（你的伺服器）
          private cache       shared cache
          只服務這一個使用者    服務所有使用者
          你無法主動清除        通常可以 purge
```

| | 瀏覽器快取 | CDN、反向代理快取 |
|---|---|---|
| 服務誰 | 單一使用者 | 所有使用者 |
| 能存個人化資料嗎 | 可以（`private`） | **不可以** |
| 你能主動清掉嗎 | 不能，只能等它過期或靠檔名改變 | 通常可以呼叫 CDN 的 purge API |
| 用哪個指令控制時間 | `max-age` | `s-maxage` 優先，沒有才用 `max-age` |

這個差別決定了策略：**瀏覽器快取的時間要保守**（一旦存了就收不回來），CDN 可以存久一點，內容更新時主動 purge。

## Cache-Control 的指令

### 回應的指令

| 指令 | 意思 |
|---|---|
| `max-age=N` | 回應在 N 秒內是「新鮮的」，可以不問原站直接用 |
| `s-maxage=N` | 只對共用快取（CDN、proxy）生效，覆蓋 `max-age` |
| `no-cache` | **可以存**，但每次使用前都要向原站確認（條件請求） |
| `no-store` | **不要存**，任何快取都不行 |
| `private` | 只有瀏覽器可以存，共用快取不能存 |
| `public` | 共用快取也可以存，即使請求帶了 `Authorization` |
| `must-revalidate` | 過期之後一定要確認，不能在原站連不上時拿過期的版本頂著用 |
| `immutable` | 新鮮期間內內容不會變，重新整理時也不必確認（支援程度依瀏覽器而異） |
| `stale-while-revalidate=N` | 過期後 N 秒內可以先回舊的，同時在背景向原站確認 |

最常被搞混的一組：

- **`no-cache` 不是「不要快取」**。它是「存著，但每次都要問」。搭配 ETag，原站回 304 時不用傳 body。
- **`no-store` 才是不要存**。用在含敏感資料、絕不能留在磁碟上的回應。

### 沒有寫 Cache-Control 會怎樣

回應沒有 `Cache-Control` 也沒有 `Expires`，但有 `Last-Modified` 時，快取**可以自己估一個新鮮時間**（heuristic freshness，RFC 9111 允許；常見的估法是「距離上次修改時間的 10%」）。一個 10 天前修改的檔案，可能被存上一天。所以「沒寫」不等於「不快取」，每個回應都應該明確寫出 `Cache-Control`。

另外，共用快取預設**不會**存「請求帶有 `Authorization` 標頭」的回應，除非回應明確寫了 `public`、`s-maxage` 或 `must-revalidate`。在 API 回應上隨手加 `public`，就是開頭第二個事故的成因。

## 新鮮度與年齡

快取拿到回應時，用兩個數字判斷能不能直接用：

```
新鮮期限（freshness lifetime）= s-maxage 或 max-age（或 Expires − Date，或估計值）
目前年齡（current age）      ≈ 回應的 Age 標頭 + 在本地放了多久

年齡 < 期限 → 新鮮：直接用，不發請求
年齡 ≥ 期限 → 過期：帶條件請求向原站確認
```

CDN 回應給瀏覽器時會加上 `Age` 標頭，表示這份回應在 CDN 已經放了幾秒。`max-age=300` 的回應在 CDN 放了 280 秒才送到瀏覽器，瀏覽器只能再新鮮地用 20 秒。

## 條件請求：ETag、Last-Modified 與 304

過期不代表內容變了。客戶端可以問「我手上的這份還是最新的嗎」，沒變的話原站回 `304 Not Modified`，不帶 body：

```http
GET /products/1 HTTP/1.1
Host: api.shop.example

HTTP/1.1 200 OK
Cache-Control: no-cache
ETag: "p1-v42"
Last-Modified: Mon, 19 Oct 2026 08:00:00 GMT
Content-Type: application/json

{"id": 1, "name": "保溫杯", "price": 590}
```

之後要使用時：

```http
GET /products/1 HTTP/1.1
Host: api.shop.example
If-None-Match: "p1-v42"
If-Modified-Since: Mon, 19 Oct 2026 08:00:00 GMT

HTTP/1.1 304 Not Modified
Cache-Control: no-cache
ETag: "p1-v42"
```

| 驗證器 | 請求標頭 | 特性 |
|---|---|---|
| `ETag` | `If-None-Match` | 伺服器給的版本識別字串；精確，任何內容變化都能反映 |
| `Last-Modified` | `If-Modified-Since` | 時間戳，精度只到秒；一秒內改兩次會判斷錯 |

兩者都有時，`If-None-Match` 優先，`If-Modified-Since` 會被忽略。

ETag 有強弱之分：`"p1-v42"` 是強 ETag（位元組完全相同），`W/"p1-v42"` 是弱 ETag（語意相同即可，例如壓縮方式不同）。`If-None-Match` 用**弱比較**（忽略 `W/`），`If-Match` 用**強比較**（弱 ETag 永遠不相符）。

ETag 怎麼產生：

- 用資料的版本號或 `updated_at`：`"p1-v42"`。最便宜，不用先組出回應。
- 對回應 body 算雜湊。最通用，但伺服器還是要查資料庫、組出整個回應才能比對，省的只有頻寬。

304 的回應要帶上 200 時會帶的 `Cache-Control`、`ETag`、`Vary` 等標頭，快取用它們更新存著的那份。

`If-Match` 是同一套機制的另一個用途：寫入時帶上版本，版本不對回 `412 Precondition Failed`，用來防止覆蓋別人的修改（見 [REST API 設計](#/skill/rest-design)）。

## Vary：同一個網址，不同的回應

`/products/1` 對 `Accept-Encoding: br` 的請求回 Brotli 壓縮的 body，對不支援的客戶端回未壓縮的。快取若只用網址當 key，就可能把 Brotli 的 body 給了不支援的客戶端。`Vary` 告訴快取：「key 要加上這些請求標頭」：

```http
Vary: Accept-Encoding
```

| Vary 的值 | 效果 |
|---|---|
| `Accept-Encoding` | 依壓縮方式分開存；幾乎所有壓縮過的回應都該有 |
| `Origin` | CORS 回應依來源不同而不同時必須有（見 [CORS、Cookie 與同源](#/skill/cors-cookies)） |
| `Accept-Language` | 依語言分開存；值的組合很多，命中率會下降 |
| `Cookie`、`Authorization` | 每個使用者一份，CDN 等於沒在快取；這種回應通常應該直接 `private` |
| `*` | 每個請求都視為不同，實際上無法快取 |

CDN 對 `Vary` 的支援程度不一，有些只支援特定幾個標頭，或用自己的 cache key 設定取代 `Vary`，上線前要查所用 CDN 的文件。

## 幾種典型的設定

| 回應 | 設定 | 理由 |
|---|---|---|
| 檔名帶雜湊的靜態資產 `app.3f9a1c.js` | `Cache-Control: public, max-age=31536000, immutable` | 內容一變，檔名就變；同一個檔名的內容永遠不變，可以存一年 |
| `index.html`（入口） | `Cache-Control: no-cache` 加 ETag | 每次都確認，部署後下一次載入就拿到新版，再引用新檔名的資產 |
| 公開、變動慢的 API（商品目錄） | `Cache-Control: public, max-age=30, s-maxage=300` | 瀏覽器存 30 秒、CDN 存 5 分鐘；商品更新時 purge CDN |
| 個人化 API（我的訂單） | `Cache-Control: private, no-cache` 加 ETag | 不能進共用快取；瀏覽器可以存但每次確認 |
| 敏感資料（付款資訊、一次性 token） | `Cache-Control: no-store` | 不留在任何地方 |

開頭的第一個事故，就是把 `index.html` 當成了第一列。部署工具（Vite、webpack 等）產出的資產檔名本來就帶雜湊，只要入口檔不要長快取，新版就能立刻生效。

部分 CDN 支援 `CDN-Cache-Control`（RFC 9213），讓 CDN 和瀏覽器的設定可以完全分開；各家 CDN 也有自己的設定方式。快取到期瞬間大量請求打回原站（雪崩、擊穿）的處理，見 [快取到期的瞬間](#/scenario/edge-cache)；API 層要用 HTTP 快取還是 Redis，見 [API 快取](#/scenario/cache)。

## 實際程式：模擬快取與條件請求

下面這段 JavaScript 實作原站對條件請求的判斷（依 RFC 9110 的順序：`If-Match` → `If-None-Match` → `If-Modified-Since`），再模擬一個瀏覽器快取依 `max-age` 決定直接用、確認還是重抓：

```js run
// ---------- 原站：判斷條件請求 ----------
const strip = (t) => t.replace(/^W\//, '')
const weakMatch = (list, etag) => list === '*' || list.split(',').some((t) => strip(t.trim()) === strip(etag))
const strongMatch = (list, etag) => list === '*' || (!etag.startsWith('W/') && list.split(',').some((t) => t.trim() === etag))

function evaluate(req, current) {
  const h = req.headers
  // 1. If-Match：寫入時用，強比較；不符 → 412
  if (h['if-match'] !== undefined && !strongMatch(h['if-match'], current.etag)) return 412
  // 2. If-None-Match：弱比較；相符時 GET/HEAD → 304，其他方法 → 412
  if (h['if-none-match'] !== undefined) {
    if (weakMatch(h['if-none-match'], current.etag)) return ['GET', 'HEAD'].includes(req.method) ? 304 : 412
  } else if (h['if-modified-since'] !== undefined && ['GET', 'HEAD'].includes(req.method)) {
    // 3. 只在沒有 If-None-Match 時才看 If-Modified-Since（精度到秒）
    if (Date.parse(current.lastModified) <= Date.parse(h['if-modified-since'])) return 304
  }
  return req.method === 'GET' ? 200 : 204
}

const product = { etag: '"p1-v42"', lastModified: 'Mon, 19 Oct 2026 08:00:00 GMT' }
const tests = [
  ['沒有條件', { method: 'GET', headers: {} }],
  ['If-None-Match 相符', { method: 'GET', headers: { 'if-none-match': '"p1-v41", "p1-v42"' } }],
  ['If-None-Match 弱 ETag 也算相符', { method: 'GET', headers: { 'if-none-match': 'W/"p1-v42"' } }],
  ['If-None-Match 不符，If-Modified-Since 被忽略', { method: 'GET', headers: { 'if-none-match': '"p1-v40"', 'if-modified-since': 'Tue, 20 Oct 2026 00:00:00 GMT' } }],
  ['只有 If-Modified-Since，之後沒改過', { method: 'GET', headers: { 'if-modified-since': 'Mon, 19 Oct 2026 08:00:00 GMT' } }],
  ['PUT 帶舊版本的 If-Match', { method: 'PUT', headers: { 'if-match': '"p1-v41"' } }],
  ['PUT 帶目前版本的 If-Match', { method: 'PUT', headers: { 'if-match': '"p1-v42"' } }],
]
for (const [name, req] of tests) console.log(String(evaluate(req, product)).padEnd(4), name)

// ---------- 瀏覽器快取：依 max-age 決定 ----------
function makeCache() {
  const store = new Map()
  return function get(url, now, origin) {
    const hit = store.get(url)
    if (hit) {
      const age = now - hit.storedAt + hit.ageAtStore
      if (!hit.noCache && age < hit.maxAge) return `t=${now}s 新鮮（age ${age}s），直接用，不發請求`
      const status = evaluate({ method: 'GET', headers: { 'if-none-match': hit.etag } }, origin.current())
      if (status === 304) { hit.storedAt = now; hit.ageAtStore = 0; return `t=${now}s 過期 → 條件請求 → 304，沿用舊 body` }
    }
    const res = origin.current()
    store.set(url, { etag: res.etag, maxAge: res.maxAge, noCache: res.noCache, storedAt: now, ageAtStore: res.age || 0 })
    return `t=${now}s ${hit ? '過期 → 條件請求 → 200，換成新內容' : '沒有快取 → 200'}（ETag ${res.etag}）`
  }
}

let version = 42
const origin = { current: () => ({ etag: `"p1-v${version}"`, lastModified: product.lastModified, maxAge: 60, age: 20 }) }
const get = makeCache()
console.log('\nmax-age=60，CDN 送來時 Age: 20')
console.log(get('/products/1', 0, origin))
console.log(get('/products/1', 30, origin))
console.log(get('/products/1', 45, origin))   // 20 + 45 > 60：過期
version = 43                                    // 商品被修改：快取還新鮮的期間，客戶端看不到這個變化
console.log(get('/products/1', 50, origin))
console.log(get('/products/1', 200, origin))
```

## 常見錯誤

| 現象 | 原因 | 修正 |
|---|---|---|
| 部署後使用者一直拿到舊版 | `index.html` 有長快取 | 入口檔改 `no-cache`；長快取只給檔名帶雜湊的資產 |
| 使用者看到別人的資料 | 個人化回應被 CDN 存了：寫了 `public`，或 CDN 設定成忽略原站標頭全部快取 | 改 `private`；檢查 CDN 的快取規則是否覆蓋了原站的 `Cache-Control` |
| 每次都 200，從來沒有 304 | 回應沒有 `ETag`／`Last-Modified`；或 ETag 每次都不同（例如把時間戳、隨機 id 算進雜湊）；或多台伺服器各自產生不同的 ETag | 用資料版本產生 ETag；確認多台伺服器對同一內容產生相同的值 |
| 304 之後畫面還是舊的 | 原站判斷錯，資料已變但 ETag 沒變（ETag 只依據部分欄位） | ETag 要涵蓋回應裡所有會變的內容 |
| CDN 命中率很低 | `Vary: Cookie`、`Vary: User-Agent`；查詢字串裡有追蹤參數讓每個網址都不同 | 移除不必要的 `Vary`；在 CDN 設定忽略特定查詢參數 |
| 改了 `max-age` 卻沒有立即生效 | 已經被存的回應照舊的規則到期 | 快取設定的變更只影響之後的回應；要立即生效只能換網址或 purge CDN |
| 瀏覽器開發者工具顯示 `(disk cache)` 或 `(memory cache)` | 這是新鮮的快取命中，沒有發出請求 | 正常現象；要看條件請求，勾選 Disable cache 前後比較 |
| 敏感頁面登出後按「上一頁」還看得到 | 頁面被存在瀏覽器快取 | 含敏感資料的頁面用 `no-store` |

## 動手

1. 按 JavaScript 那段的「在 Playground 開啟」，把 `origin` 的 `maxAge` 改成 0、或加上 `noCache: true`，觀察每次都變成條件請求；再把 `age` 改成 70，看第一次拿到的回應就已經過期。
2. 在 `tests` 加一個案例：`If-None-Match: *` 搭配 `PUT`（「只在資源不存在時建立」的寫法），預期會是 412。
3. 打開任一個用 Vite 建置的網站，在 Network 分頁比較 `index.html` 和 `assets/*.js` 的 `Cache-Control`，以及重新整理時哪些變成 304、哪些是 `(disk cache)`。
4. 到 [快取到期的瞬間](#/scenario/edge-cache) 看 CDN 快取同時到期時原站會遇到什麼，以及 `stale-while-revalidate` 怎麼幫上忙。

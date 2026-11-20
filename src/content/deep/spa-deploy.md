## 從一個具體問題開始：上線後的三種白畫面

門診前端第一次部署到院內入口網站的子路徑 `https://portal.example/clinic/`，一天內出了三種白畫面：

1. **一打開就白**：Console 一排 404，`index.html` 要的是 `/assets/index-*.js`，少了 `/clinic`。`vite.config.js` 沒有設 `base`。
2. **重新整理就 404**：在 `/clinic/appointments/42` 按 F5，看到 nginx 的 404 頁。伺服器上沒有 `appointments/42` 這個檔案，也沒有設定 fallback。
3. **中午部署後，開著的頁面點不動**：早上就開著系統的櫃台，下午點「報表」沒有反應。Console 寫著：

```
Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html". Strict MIME type checking is enforced for module scripts per HTML spec.
TypeError: Failed to fetch dynamically imported module: https://portal.example/clinic/assets/ReportsView-BiVi8Bpn.js
```

早上載入的舊版要舊的報表 chunk，中午的部署把它刪了；伺服器把找不到的檔案一律回成 `index.html`，瀏覽器拿到 HTML 當 JavaScript，拒絕執行。

三個問題都不在程式邏輯裡，在「建置產物怎麼放到伺服器上」。

## 運作原理

### SPA 對伺服器的要求

`vite build` 的產物是一包靜態檔：`index.html`、`assets/` 底下帶 hash 的 JS 與 CSS、`public/` 複製過來的檔案。伺服器不用執行任何程式，只要照下表回應：

| 請求 | 回應 | 快取 |
|---|---|---|
| `/clinic/` 或 `/clinic/index.html` | `index.html` | `no-cache` |
| `/clinic/appointments/42`（頁面路徑，沒有這個檔案） | `index.html`（fallback） | `no-cache` |
| `/clinic/assets/index-CmXrpQpe.js`（存在） | 檔案本身 | `max-age=31536000, immutable` |
| `/clinic/assets/ReportsView-OLD.js`（不存在） | 404 | 不快取 |
| `/clinic/config.js`（執行時設定） | 檔案本身 | `no-cache` |

nginx、物件儲存加 CDN、GitHub Pages、Firebase Hosting 都放得了 SPA，差別在能不能做到這張表的每一列。nginx 的完整設定與容器化，見 [前端與 nginx 上 K8s](#/skill/spa-containers)。

### base：網站不在根目錄時

Vite 的 `base` 預設是 `/`，建置出的 `index.html` 寫的是 `/assets/index-*.js`。放在 `/clinic/` 底下，瀏覽器去要 `https://portal.example/assets/…`，那是入口網站自己的路徑，拿到 404 或別人的檔案。

設 `base: '/clinic/'` 之後，Vite 改寫三個地方：`index.html` 裡的 script 與 link、程式裡 `import.meta.env.BASE_URL` 的值、`public/` 檔案在 `index.html` 裡的參照（實測 `/config.js` 會變成 `/clinic/config.js`）。Vue Router 用 `createWebHistory(import.meta.env.BASE_URL)`，路由才知道 `/clinic/appointments` 裡的 `/clinic` 是前綴。三處（Vite、Vue Router、伺服器上的目錄）要對同一個前綴。

`base: './'`（相對路徑）讓同一份建置放在任何子路徑都能跑，本站就是這樣設定。它只適合 hash 路由：用 history 模式時，從 `/clinic/appointments/42` 重新整理，`./assets/x.js` 會被解析成 `/clinic/appointments/assets/x.js`。

### history 模式與 hash 模式

| | history 模式（`createWebHistory`） | hash 模式（`createWebHashHistory`） |
|---|---|---|
| 網址 | `/clinic/appointments/42` | `/clinic/#/appointments/42` |
| 重新整理時送給伺服器的路徑 | `/clinic/appointments/42` | `/clinic/`（`#` 後面不送出） |
| 伺服器要 fallback | 要 | 不用 |
| 伺服器的 log 看得到使用者在哪一頁 | 看得到 | 看不到 |
| 適合 | 能設定伺服器的環境 | GitHub Pages 這類不能設定 rewrite 的靜態主機 |

本站用 hash 路由（`#/skill/…`），所以放在 GitHub Pages 與 Firebase Hosting 都不需要 fallback。GitHub Pages 不能設定 rewrite 與回應標頭；用 history 模式時，常見的做法是把 `index.html` 複製成 `404.html`，深層連結會顯示正確的畫面，但 HTTP 狀態碼是 404，監控與搜尋引擎會當成錯誤。

### fallback 只給頁面

「找不到檔案就回 `index.html`」很容易寫成套用到所有路徑。後果是開頭的第三個問題：

| 伺服器設定 | 舊的 chunk 不見時，瀏覽器收到 | Console |
|---|---|---|
| 所有路徑都 fallback | 200，`Content-Type: text/html` | `Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html"…`，接著 `Failed to fetch dynamically imported module` |
| 只有頁面路徑 fallback，`/assets/` 回 404 | 404 | `Failed to load resource: the server responded with a status of 404 (Not Found)`，接著 `Failed to fetch dynamically imported module` |

（Chrome 141 實測。舊版 Chrome 的第一行寫 `Expected a JavaScript module script`；Firefox 與 Safari 的文字不同。）兩種都會失敗，但 404 一眼看得出是「檔案不在」，MIME 錯誤常被誤會成伺服器設定壞了。更糟的情況：`/assets/` 設了一年的快取，fallback 回的那份 HTML 被快取在 `.js` 的網址下一整年。

### 兩種快取

`index.html` 決定要載入哪一版的 chunk。它被快取，使用者就一直拿舊版，一直要舊的 chunk；所以它用 `Cache-Control: no-cache`，每次向伺服器確認（沒變時回 304，只傳標頭）。`assets/` 底下的檔名帶內容 hash，內容變了檔名就變，所以可以快取一年並標 `immutable`。檔名 hash 的原理見 [bundle、chunk 與 hash](#/skill/bundles-chunks)。

### 部署後，開著的舊頁面

| 時間 | 事件 |
|---|---|
| 09:00 | 櫃台打開系統，載入 v1 的 `index.html` 與入口 chunk，還沒進過報表頁 |
| 12:00 | 部署 v2，伺服器上只剩 v2 的 assets |
| 14:00 | 點「報表」，v1 的程式去要 `ReportsView-<v1 的 hash>.js`，伺服器上沒有 |

Vite 在動態 import（包含路由懶載入）失敗時，在 `window` 上發出 `vite:preloadError` 事件，`event.payload` 是原本的錯誤。沒有人呼叫 `event.preventDefault()`，錯誤照常丟出；呼叫了就不丟出，交給事件處理。常見的處理是重新載入整頁，拿到 v2 的 `index.html`。兩個細節：

- 重新載入會丟掉畫面上還沒送出的表單，先把草稿存進 sessionStorage。
- 限制自動重載的次數。新版本身有問題、chunk 一直載不到時，無條件重載會變成無限重新整理。

另一個方向的做法是讓伺服器保留前幾版的 assets（例如部署時不刪舊檔、定期清理），這要伺服器或部署流程配合，見 [前端與 nginx 上 K8s](#/skill/spa-containers) 的「滾動更新時的 chunk 404」。

## 實際程式

### 伺服器規則的模擬

下面把上面那張表寫成一個函式，比較「全部 fallback」與「只給頁面 fallback」對同一批請求的回應：

```js run
// dist 裡實際有的檔案（v2）；Reports 的舊 chunk 已經不在
const files = new Set([
  '/clinic/index.html', '/clinic/config.js',
  '/clinic/assets/index-CmXrpQpe.js', '/clinic/assets/vendor-C8Rcc4dC.js', '/clinic/assets/Reports-Ck84vTFL.js',
])
const typeOf = (p) => (p.endsWith('.html') ? 'text/html' : p.endsWith('.js') ? 'text/javascript' : 'text/plain')

function serve(path, rule) {
  if (path.endsWith('/')) path += 'index.html'
  const isAsset = path.startsWith('/clinic/assets/')
  if (files.has(path)) return `200 ${typeOf(path)}  ${isAsset ? 'max-age=31536000, immutable' : 'no-cache'}`
  if (rule === 'pages-only' && isAsset) return '404'
  return '200 text/html  no-cache  ← fallback 回 index.html'
}

const requests = [
  '/clinic/',
  '/clinic/appointments/42',               // 深層連結
  '/clinic/assets/index-CmXrpQpe.js',      // 存在的 asset
  '/clinic/assets/Reports-BiVi8Bpn.js',    // v1 的舊 chunk
  '/clinic/config.js',
]
for (const rule of ['all-fallback', 'pages-only']) {
  console.log(`\n[${rule}]`)
  for (const r of requests) console.log(r.padEnd(38), serve(r, rule))
}
```

`all-fallback` 下，舊 chunk 拿到的是 200 與 `text/html`；`pages-only` 下是 404。把 `serve` 的快取規則改成「`/clinic/assets/` 開頭一律 immutable」，再看 fallback 那一列會變成什麼：那就是 HTML 被快取一年的情況。

### Vite 與 Vue Router

```js
// vite.config.js
export default defineConfig({
  plugins: [vue()],
  base: '/clinic/',                        // 結尾的斜線要有
})
```

```js
// router.js
import { createRouter, createWebHistory } from 'vue-router'
export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),   // '/clinic/'，和 base 同一個來源
  routes,
})
```

### nginx 的最小設定

```nginx
# dist/ 的內容放在 /usr/share/nginx/html/clinic/
root /usr/share/nginx/html;

location /clinic/assets/ {
    try_files $uri =404;                                   # 找不到就 404，不 fallback
    add_header Cache-Control "public, max-age=31536000, immutable" always;
}

location /clinic/ {
    try_files $uri $uri/ /clinic/index.html;               # 頁面路徑找不到檔案：回 index.html
    add_header Cache-Control "no-cache" always;
}
```

`/api` 的轉發、`config.js`、容器與 K8s 的部分見 [前端與 nginx 上 K8s](#/skill/spa-containers) 與 [nginx 反向代理](#/skill/nginx)。Firebase Hosting、Netlify 這類平台用設定檔的 rewrite 規則做 fallback，原則相同：確認不存在的 assets 不會被改寫成 `index.html`。

:::stop 讀到這裡可以先停：會設定 `base`、history fallback 與兩種快取，深層連結與重新整理都正常。後面的舊分頁 chunk 處理與部署檢查，在發版後有人回報點頁面變白畫面時再回來讀。

### 處理 vite:preloadError

```js
// main.js：放在 createApp 之前
const KEY = 'chunkReloadAt'

window.addEventListener('vite:preloadError', (event) => {
  const last = Number(sessionStorage.getItem(KEY) || 0)
  if (Date.now() - last < 10_000) return   // 10 秒內已經自動重載過：不再重載，讓錯誤照常丟出
  event.preventDefault()                    // 不丟出錯誤，改成重新載入
  saveDrafts()                              // 把表單草稿存進 sessionStorage（自己實作）
  sessionStorage.setItem(KEY, String(Date.now()))
  window.location.reload()                  // 拿到新版的 index.html
})
```

重載之後如果又失敗，第二次事件發生在 10 秒內，錯誤照常丟出，畫面可以顯示「系統更新中，請稍後重新整理」，不會一直自動重新整理。

### 部署完的檢查

```bash
BASE=https://portal.example/clinic
curl -sI "$BASE/" | grep -iE '^(HTTP|cache-control)'                  # 200、no-cache
curl -sI "$BASE/appointments/42" | grep -iE '^(HTTP|content-type)'    # 200、text/html（fallback）
curl -sI "$BASE/assets/nope.js" | grep -i '^HTTP'                     # 404
ASSET=$(curl -s "$BASE/" | grep -o 'assets/index-[^"]*\.js' | head -1)
curl -sI "$BASE/$ASSET" | grep -iE '^(HTTP|cache-control|content-type)'   # 200、immutable、javascript
```

這幾行可以放進部署流程的最後一步，任何一行不符就讓部署失敗。

## 常見錯誤與錯誤訊息

| 現象或訊息 | 原因 | 修法 |
|---|---|---|
| 一打開就白畫面，Console 一排 `/assets/…` 的 404 | 子路徑部署沒設 `base` | `base: '/clinic/'`，打開 `dist/index.html` 確認路徑 |
| 首頁正常，換頁後點連結 404 或回到首頁 | Vue Router 沒有用 `BASE_URL` | `createWebHistory(import.meta.env.BASE_URL)` |
| 深層連結重新整理是伺服器的 404 頁 | history 模式沒有 fallback | 頁面路徑 fallback 到 `index.html`，或改 hash 模式 |
| `Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html"` | 不存在的 JS 被 fallback 成 `index.html` | `/assets/` 底下找不到回 404 |
| `TypeError: Failed to fetch dynamically imported module: …` | 部署後舊頁面要的 chunk 不在了 | 監聽 `vite:preloadError` 重新載入；或保留舊版 assets |
| 部署後部分使用者一直看到舊版 | `index.html` 被快取 | `index.html` 設 `no-cache` |
| 頁面一直自動重新整理 | `vite:preloadError` 無條件 `reload()`，新版本身載不到 chunk | 限制重載次數與間隔 |
| 用 `base: './'` 搭 history 模式，深層連結的 JS 404 | 相對路徑在 `/clinic/appointments/` 底下被解析成錯的位置 | history 模式用絕對的 `base`；`./` 只配 hash 模式 |
| 在 `vite preview` 上一切正常，上線就壞 | preview 的 fallback 與快取規則和正式伺服器不同 | 部署後用上面的 `curl` 檢查正式環境 |

## 動手

1. 按上面模擬的「在 Playground 開啟」，把 `/clinic/assets/` 的快取規則改成不管檔案存不存在都回 `immutable`，看 `all-fallback` 下舊 chunk 那一列：HTML 被長效快取在 `.js` 的網址下。
2. 在自己的專案設 `base: '/clinic/'` 建置一次，打開 `dist/index.html` 看每個路徑；再用 `createWebHistory(import.meta.env.BASE_URL)` 跑 `npm run preview`，打開 `http://localhost:4173/clinic/` 測一個深層連結。
3. 模擬部署後的舊頁面：開著 preview 的頁面，重新建置一次（chunk 換了檔名），再點一個還沒進過的頁面，看 Console 的錯誤與 `vite:preloadError` 的處理。
4. 執行時設定（`config.js`）怎麼讀，見 [建置時設定與執行時設定](#/skill/env-config)。

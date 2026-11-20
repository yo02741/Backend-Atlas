## 這階段要做出什麼

前端要部署到院內入口網站的子路徑 `https://portal.example/clinic/`，`/api/` 由同一台 nginx 轉給後端。同一份建置先放到測試環境驗證，再原封不動放到正式環境。這一階段要讓：

1. 建置產物裡的每個路徑都帶 `/clinic/` 前綴：Vite 的 `base`、Vue Router 的 history、nginx 上的目錄三處對同一個前綴。
2. 在任何頁面（`/clinic/appointments/42`）按重新整理都拿到 `index.html`，不存在的 `/clinic/assets/*.js` 回 404。
3. `index.html` 與 `config.js` 每次向伺服器確認，檔名帶 hash 的 assets 快取一年。
4. 環境不同的值（API 前綴、環境名稱、除錯開關）在執行時從 `config.js` 讀，換環境不用重新建置。
5. 部署後還開著舊版的頁面，載入不到舊 chunk 時重新載入一次。

dev server、`vite build`、`vite preview` 各做什麼在 [Vite：開發與建置](#/skill/vite-basics)；`VITE_` 變數在建置時被換成字串、`config.js` 怎麼讀在 [建置時設定與執行時設定](#/skill/env-config)；`base`、fallback、兩種快取與部署後的 chunk 404 在 [SPA 的部署](#/skill/spa-deploy)。nginx 放進容器、上 Kubernetes 的部分在 [前端與 nginx 上 K8s](#/skill/spa-containers)。

## 設計決策與取捨

### 三處對同一個前綴

| 地方 | 設定 | 沒設的後果 |
|---|---|---|
| `vite.config.js` | `base: '/clinic/'`（結尾要有斜線） | `index.html` 要 `/assets/index-*.js`，拿到入口網站自己的 404，一打開就白畫面 |
| Vue Router | `createWebHistory(import.meta.env.BASE_URL)` | 首頁正常，點連結後網址少了 `/clinic` |
| nginx | `location /clinic/`，fallback 到 `/clinic/index.html` | 重新整理深層連結時 404，或內部轉址繞成迴圈 |

`base: './'` 讓同一份建置放在任何子路徑都能跑，但只配 hash 路由：用 history 模式時，從 `/clinic/appointments/42` 重新整理，`./assets/x.js` 會被解析成 `/clinic/appointments/assets/x.js`。這個專案用 history 模式，所以寫絕對的 `/clinic/`。

### fallback 只給頁面

「找不到檔案就回 `index.html`」只能用在頁面路徑。`/clinic/assets/` 底下找不到的檔案要回 404：部署後還開著的舊頁面去要舊的 chunk，伺服器回 `index.html` 的話，瀏覽器拿到 `text/html` 當 JavaScript，Console 出現 `Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html"`；`/clinic/assets/` 又設了一年的快取，那份 HTML 會被存在 `.js` 的網址下一整年。回 404 時錯誤一眼看得出是「檔案不在」。

### 兩種快取

`index.html` 決定要載入哪一版的 chunk，被快取就一直拿舊版，所以 `Cache-Control: no-cache`（可以存，但每次先向伺服器確認，沒變時回 304）。`assets/` 的檔名帶內容 hash，內容變了檔名就變，可以 `max-age=31536000, immutable`。`config.js` 沒有 hash，改了設定要馬上生效，也是 `no-cache`。

### 環境不同的值在執行時讀

`import.meta.env.VITE_API_BASE` 在建置時被整段換成字串常數，測試環境建出來的 bundle 放到正式環境，連的還是測試的網址；值一律是字串，`VITE_SHOW_DEBUG=false` 讀進來是 truthy 的 `'false'`。所以只有「每次建置本來就不同」的值（版本號、commit）用 `VITE_` 變數，環境不同的值放 `config.js`：

- `index.html` 在應用程式之前用一般的 `<script src="/config.js">` 載入，它設定 `window.__CLINIC_CONFIG__`。`public/` 裡放一份開發用的 `config.js`，Vite 會把 `index.html` 裡的路徑改寫成 `/clinic/config.js`（Vite 7.3.8 實測；`public/` 裡沒有這個檔案時不改寫）。
- 程式裡只有 `src/config.js` 讀它：缺欄位用預設值並在 Console 警告，布林值只認 `true` 與 `'true'`。`apiFetch` 與登入頁的網址前綴改用 `config.apiBase`。
- 前端沒有秘密：bundle 與 `config.js` 都是公開的靜態檔，金鑰、client secret 不能放進任何一個。

### 部署後的舊頁面

09:00 打開系統的櫃台，12:00 部署了新版，14:00 點一個還沒進過的頁面：舊版的程式去要舊的 chunk，伺服器上已經沒有。Vite 在動態 import 失敗時對 `window` 發出 `vite:preloadError`；呼叫 `event.preventDefault()` 並重新載入整頁，拿到新版的 `index.html`。限制 10 秒內只自動重載一次，新版本身有問題時才不會一直重新整理。

## 關鍵程式

```js
// vite.config.js
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: '/clinic/',                                   // 結尾的斜線要有
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    proxy: { '/api': 'http://localhost:8000' },        // 開發時 /api 轉給後端；正式環境由 nginx 在同網域提供
  },
})
```

```html
<!-- index.html：config.js 是一般的 script，放在應用程式之前 -->
<!doctype html>
<html lang="zh-Hant-TW">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>門診系統</title>
  </head>
  <body>
    <div id="app"></div>
    <script src="/config.js"></script>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

```js
// public/config.js：開發用的值；每個環境的伺服器放各自的版本
window.__CLINIC_CONFIG__ = {
  apiBase: '/api',
  envName: '開發',
  showDebug: true,
}
```

```js
// src/config.js：執行時設定。index.html 在應用程式之前載入 /config.js（設定 window.__CLINIC_CONFIG__）
const DEFAULTS = { apiBase: '/api', envName: '正式', showDebug: false }

function readConfig(raw) {
  const cfg = { ...DEFAULTS }
  if (!raw || typeof raw !== 'object') {
    console.warn('[config] 找不到 __CLINIC_CONFIG__，全部使用預設值')
    return cfg
  }
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in raw)) { console.warn(`[config] 缺少 ${key}，使用預設值 ${JSON.stringify(DEFAULTS[key])}`); continue }
    cfg[key] = typeof DEFAULTS[key] === 'boolean' ? raw[key] === true || raw[key] === 'true' : String(raw[key])
  }
  return cfg
}

export const config = Object.freeze(readConfig(window.__CLINIC_CONFIG__))
export const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? 'dev'   // 建置時就確定的值才用 VITE_ 變數
```

```js
// src/main.js
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import './focus'

// 部署後，開著的舊頁面要載入已經不存在的 chunk：重新載入一次拿新版的 index.html，10 秒內不重複
window.addEventListener('vite:preloadError', (event) => {
  const last = Number(sessionStorage.getItem('chunkReloadAt') || 0)
  if (Date.now() - last < 10_000) return
  event.preventDefault()
  sessionStorage.setItem('chunkReloadAt', String(Date.now()))
  window.location.reload()
})

createApp(App).use(createPinia()).use(router).mount('#app')
```

nginx（`dist/` 的內容放在 `/usr/share/nginx/html/clinic/`）：

```nginx
server {
    listen 8080;
    server_name _;
    root /usr/share/nginx/html;     # dist/ 的內容放在 /usr/share/nginx/html/clinic/

    # 檔名帶 hash：存一年；找不到就 404，不要換成 index.html
    location /clinic/assets/ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    # 頁面路徑找不到檔案時回 /clinic/index.html；index.html 與 config.js 每次都要向伺服器確認
    location /clinic/ {
        try_files $uri $uri/ /clinic/index.html;
        add_header Cache-Control "no-cache" always;
    }

    location /api/ {
        proxy_pass http://clinic-api:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

`location /clinic/assets/` 和 `location /clinic/` 都是前綴比對，nginx 選最長的那一個，所以 assets 的請求落在前者，不會被 fallback 換成 `index.html`。`try_files` 最後一項寫 `/clinic/index.html`；寫成 `/index.html` 會內部轉址到根目錄，那裡沒有這個檔案，又落回 `location /`，nginx 回 500（`rewrite or internal redirection cycle`）。

部署完用 `curl` 檢查正式環境，任何一行不符就讓部署失敗：

```bash
BASE=https://portal.example/clinic
curl -sI "$BASE/" | grep -iE '^(HTTP|cache-control)'                      # 200、no-cache
curl -sI "$BASE/appointments/42" | grep -iE '^(HTTP|content-type)'        # 200、text/html（fallback）
curl -sI "$BASE/assets/nope.js" | grep -i '^HTTP'                         # 404
curl -sI "$BASE/config.js" | grep -iE '^(HTTP|cache-control)'             # 200、no-cache
ASSET=$(curl -s "$BASE/" | grep -o 'assets/index-[^"]*\.js' | head -1)
curl -sI "$BASE/$ASSET" | grep -iE '^(HTTP|cache-control)'                # 200、immutable
```

用一個空專案在 Vite 7.3.8 實測過：`base: '/clinic/'` 時，`dist/index.html` 裡的入口是 `/clinic/assets/index-*.js`、`<script src="/config.js">` 變成 `/clinic/config.js`；`VITE_APP_VERSION=abc123 npx vite build` 之後 bundle 裡是字串 `"abc123"`，`import.meta.env.BASE_URL` 是 `"/clinic/"`。

## 常見錯誤

**一打開就白畫面，Console 一排 `/assets/…` 的 404。** 子路徑部署沒設 `base`。打開 `dist/index.html` 看路徑。

**首頁正常，點連結後網址少了 `/clinic`。** Vue Router 沒用 `BASE_URL`。

**深層連結重新整理是 nginx 的 404，或 500。** 沒有 fallback，或 fallback 寫成 `/index.html`。

**`Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html"`。** 不存在的 JS 被 fallback 成 `index.html`。`/clinic/assets/` 找不到回 404。

**`TypeError: Failed to fetch dynamically imported module`。** 部署後舊頁面要的 chunk 不在了。處理 `vite:preloadError`，或部署時保留前一版的 assets。

**部署後部分使用者一直看到舊版。** `index.html` 被快取。設 `no-cache`。

**正式環境連到測試的 API。** 網址用 `VITE_` 變數，建置時寫死。改成 `config.js`。

**`VITE_SHOW_DEBUG=false` 時除錯面板還在。** 值是字串 `'false'`。比對 `=== 'true'`。

**在 `vite preview` 上一切正常，上線就壞。** preview 對不存在的 asset 也回 `index.html`、所有檔案都 `no-cache`（Vite 7.3.8 實測），和正式伺服器的規則不同。部署後用 `curl` 檢查正式環境。

## 驗收題在測什麼

**nginx 設定**（config 題）：檢查器是一個小型的 nginx 直譯器，照 nginx 的規則選 location、處理 `try_files` 與內部轉址、套用 `add_header` 的繼承規則，檔案系統是一份放在 `/usr/share/nginx/html/clinic/` 的假 dist。`/clinic/`、`/clinic/index.html`、`/clinic/appointments/42` 都要送出 `/clinic/index.html` 且是 `no-cache`；三個 assets 送出檔案本身、`max-age=31536000` 加 `immutable`；不存在的 `/clinic/assets/ReportsView-BiVi8Bpn.js` 回 404；`/clinic/config.js` 是 `no-cache`；`/api/sessions` 轉給 `http://clinic-api:8000`、nginx 不加 `Cache-Control`。起始的設定是部署在根目錄時寫的，fallback 指向 `/index.html`，直譯器會回報內部轉址繞成迴圈。

**執行時設定**（vue 題）：測試在應用程式之前放好不同的 `window.__CLINIC_CONFIG__`。`apiBase` 是 `/api/v2` 時請求打到 `/api/v2/sessions`；`envName` 是「測試」時顯示「測試環境」、「正式」時不顯示；`showDebug` 是字串 `'false'` 時沒有除錯面板、是 `'true'` 時有；缺 `apiBase` 與 `showDebug` 時用預設值，Console 的警告提到這兩個欄位名稱；整個物件不存在時也能啟動、用預設值並警告。

`vite.config.js` 與 Vue Router 的部分沒有驗收題，上面的程式在 Vite 7.3.8 建置過。走完七個階段，前端從登入到部署的每一段都有一份能對照的程式與驗收條件；後端的同一個系統在 [從零做完一個門診掛號後端](#/project?track=backend)。

## 串接驗收

**1. 用真的前綴跑起來。** `base: '/clinic/'` 建置之後，用 nginx 容器照正式環境的路徑擺放 `dist/`。本機測試時把上面 nginx 設定裡 `location /api/` 的 `proxy_pass` 換成 `http://api:8000`：`api` 是後端參考專案 compose 的服務名稱；結尾不加 `/`，路徑原樣轉送（參考專案的業務介面本來就在 `/api` 底下）。容器加入參考專案的網路（`companion/clinic-web/nginx.conf` 是改好的版本）：

```bash
docker run --rm -p 8080:8080 --network clinic_default \
  -v "$PWD/dist:/usr/share/nginx/html/clinic:ro" \
  -v "$PWD/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:1.27
```

預期：上面那組部署後的 `curl` 檢查（把 `BASE` 換成 `http://localhost:8080/clinic`）每一行都符合註解；`curl -s http://localhost:8080/api/board` 回看板的 JSON（不用登入），`curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/api/appointments` 是 401。`/healthz`、`/metrics` 不在 `/api` 底下，從 8080 打不到：探針與 Prometheus 直接連 API，不經過前端的 nginx。

**2. 在瀏覽器重新整理深層頁面。** 打開 `http://localhost:8080/clinic/appointments`，登入後按重新整理，Network 只看 JS、CSS 與 `config.js`。預期：頁面照常顯示；每個 asset 都在 `/clinic/assets/` 底下、狀態 200；`config.js` 的回應標頭是 `no-cache`。在 `vite preview` 上做同一件事也全部正常，所以它代替不了這一步。

**3. 部署時開著的舊頁面。** 開著第 2 步的分頁，改一個還沒點進去過的懶載入頁面（例如報到看板）的文字，重新建置並換掉 `dist/`，然後在舊分頁點進那個頁面。預期：Network 先出現一個舊 chunk 的 404，接著整頁重新載入一次、拿到新版；10 秒內再發生不會重複重新載入。前面六個階段的畫面在這個前綴下要再走一次：[無障礙與 RWD](#/project/fe-a11y-rwd) 的回歸測試把 `baseURL` 換成 `http://localhost:8080/clinic/`。

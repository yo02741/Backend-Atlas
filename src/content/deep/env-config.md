## 從一個具體問題開始：正式環境的登入，導去了測試的 SSO

門診前端的 CI 只建置一次：在測試環境驗證過的那一份 `dist/`，原封不動部署到正式環境。上線當天，正式環境的「登入」按鈕把使用者導去 `https://sso-test.example/authorize`。程式裡寫的是：

```js
const SSO_URL = import.meta.env.VITE_SSO_URL
```

CI 建置時讀的是測試環境的 `.env`，這一行在建置的那一刻就變成了 `const SSO_URL = "https://sso-test.example/authorize"`。同一次檢查還發現兩件事：

- `.env` 裡有 `VITE_MAPS_API_KEY=…`，在 `dist/assets/index-*.js` 裡搜得到整串金鑰。打開網頁的人都拿得到它。
- `.env.production` 寫了 `VITE_SHOW_DEBUG=false`，正式環境卻出現除錯面板：程式寫 `if (import.meta.env.VITE_SHOW_DEBUG)`，而字串 `'false'` 是 truthy。

## 運作原理

### import.meta.env 在建置時被換掉

`import.meta.env.VITE_SSO_URL` 不是在瀏覽器裡讀環境變數。瀏覽器沒有環境變數可讀；Vite 在建置時把這個運算式整段換成字串常數。用一個小專案實測（Vite 8.3），`.env` 寫：

```bash
VITE_API_BASE=https://api.example.com
SECRET_KEY=should-not-leak
```

程式 `console.log(import.meta.env.VITE_API_BASE, import.meta.env.MODE, import.meta.env.BASE_URL, import.meta.env.SECRET_KEY)` 建置後變成：

```js
console.log(`https://api.example.com`,`production`,`/clinic/`,void 0)
```

- `VITE_` 開頭的變數被換成字串，寫死在 bundle 裡。
- 沒有前綴的 `SECRET_KEY` 變成 `void 0`，不會進 bundle。前綴就是「這個值可以公開」的標記，可以用 `envPrefix` 設定改成別的字，但不要設成空字串。
- 值一律是字串。`VITE_SHOW_DEBUG=false` 進來是 `'false'`；實測 `typeof import.meta.env.VITE_FLAG` 在建置後直接被算成 `'string'`、條件判斷被算成 truthy。

dev server 的做法相同，只是在轉換每個模組時把 `import.meta.env` 換成當下的值。

### 內建變數

| 變數 | 值 |
|---|---|
| `import.meta.env.MODE` | 目前的 mode，例如 `development`、`production`、`staging` |
| `import.meta.env.BASE_URL` | 設定的 `base`，例如 `/` 或 `/clinic/` |
| `import.meta.env.PROD` | 正式建置時 `true` |
| `import.meta.env.DEV` | `PROD` 的相反 |
| `import.meta.env.SSR` | 是否在伺服器端渲染 |

### .env 檔與 mode

| 檔案 | 什麼時候載入 | 進版控 |
|---|---|---|
| `.env` | 每次 | 可以（只放可以公開的預設值） |
| `.env.local` | 每次 | 不要 |
| `.env.[mode]` | 只有該 mode | 可以 |
| `.env.[mode].local` | 只有該 mode | 不要 |

同一個變數出現在好幾個檔案時，mode 專屬的優先於通用的，`.local` 優先於非 `.local` 的。執行 Vite 時 shell 裡已經存在的環境變數優先於所有檔案：實測 `VITE_API_BASE=https://from-shell.example npx vite build --mode staging`，bundle 裡是 `from-shell.example`，`.env.staging` 的值被蓋過。`.env` 檔在 Vite 啟動時讀一次，dev server 開著時改了 `.env` 要重啟。

mode 由指令決定：`vite`（dev server）預設 `development`，`vite build` 預設 `production`，`--mode staging` 讓它載入 `.env.staging`。mode 和 `NODE_ENV` 是兩件事：`vite build --mode staging` 建出來的 `import.meta.env.MODE` 是 `'staging'`，`PROD` 仍然是 `true`（實測）。判斷「是不是測試環境」看 `MODE` 或自己定義的變數，不看 `PROD`。

`vite.config.js` 本身不會自動拿到 `.env` 的值；要在設定檔裡用，呼叫 `loadEnv(mode, process.cwd(), '')`。

### 建置時，還是執行時

| 值 | 建置時（`VITE_` 變數） | 執行時（`/config.js`） |
|---|---|---|
| 版本號、建置時間、git commit | 適合：每次建置本來就不同 | |
| API 網址、SSO 網址、環境名稱 | 每個環境要各建一次 | 適合：同一份建置跑每個環境 |
| 功能開關 | 改開關要重建 | 改設定檔、重新整理就生效 |
| 金鑰、client secret | 不行 | 也不行 |

「同一份建置部署到每個環境」是 12-factor 的做法：測試過的東西就是上線的東西，不會因為重建而混進別的變更。伺服器那一側怎麼提供設定檔（nginx、K8s 的 ConfigMap），見 [前端與 nginx 上 K8s](#/skill/spa-containers) 與 [環境設定與 12-factor](#/skill/config-12factor)；這一課講前端怎麼讀它。

### 執行時設定，從前端看

最常見的做法是一支一般的（非 module）script，在 `index.html` 裡放在應用程式之前：

```html
<script src="/config.js"></script>
<script type="module" src="/src/main.js"></script>
```

一般的 script 同步下載並執行，module script 預設延後到 HTML 解析完才執行，所以 `main.js` 跑的時候 `window.__CLINIC_CONFIG__` 已經在了。幾個細節（實測 Vite 6.4 與 8.3 相同）：

- `public/config.js` 放開發用的值，Vite 原樣複製到 `dist/config.js`；這時 `index.html` 裡的 `/config.js` 會依 `base` 改寫，`base: '/clinic/'` 時變成 `/clinic/config.js`。
- `public/` 裡沒有這個檔案時，Vite 不改它，建置時印出 `<script src="/config.js"> in "/index.html" can't be bundled without type="module" attribute`，路徑也不會帶上 `base`。
- 伺服器送 `config.js` 時要 `Cache-Control: no-cache`，否則改了設定，使用者的瀏覽器還拿著舊的。

另一種做法是在掛載 Vue 之前 `fetch('/config.json')`。JSON 不會被當成程式執行，格式也比較好驗證；代價是多一個請求，首頁要等它回來才開始渲染。

不管哪一種，程式裡只從一個模組讀設定，缺欄位時給預設值並在 Console 警告；不要每個元件各自去讀 `window.__CLINIC_CONFIG__`。

### 前端沒有秘密

bundle 與 `config.js` 都是公開的靜態檔案，Network 分頁點開就看得到。所有寫在前端的值都要假設會被看到：

- 地圖、翻譯這類需要金鑰的服務，金鑰放後端，由後端代為呼叫；或使用服務商提供的「限定網域的瀏覽器金鑰」，並理解它仍然是公開的。
- OAuth 的 client secret 不能出現在前端；SPA 用 Authorization Code 加 PKCE，不需要 secret。
- 已經進過 bundle 的秘密，從程式裡刪掉不夠：舊的 `dist/`、CDN 快取、使用者的瀏覽器快取裡都還有，要到服務商那邊作廢重發。

:::stop 讀到這裡可以先停：會分辨建置時與執行時設定，確認 `VITE_` 變數裡沒有秘密。後面的讀設定程式、檔案擺放與錯誤訊息，在要讓同一份建置部署到多個環境時再回來讀。

## 實際程式

### 讀設定：預設值、型別轉換與警告

下面這段把各種 `config.js` 的內容丟給讀取函式，看缺欄位、型別不對、字串的 `'false'` 怎麼處理：

```js run
// 執行時設定的讀取：只在這裡讀 window.__CLINIC_CONFIG__，其他地方 import 這個模組
const DEFAULTS = { apiBase: '/api', envName: '開發', ssoUrl: null, showDebug: false }

function readConfig(raw) {
  const warnings = []
  const cfg = { ...DEFAULTS }
  if (!raw || typeof raw !== 'object') {
    warnings.push('找不到 __CLINIC_CONFIG__，全部使用預設值')
    return { cfg, warnings }
  }
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in raw)) { warnings.push(`缺少 ${key}，使用預設值 ${JSON.stringify(DEFAULTS[key])}`); continue }
    const v = raw[key]
    if (typeof DEFAULTS[key] === 'boolean') cfg[key] = v === true || v === 'true'   // 'false' 不能當成 true
    else cfg[key] = v
  }
  if (cfg.ssoUrl && !/^https:\/\//.test(cfg.ssoUrl)) warnings.push(`ssoUrl 不是 https：${cfg.ssoUrl}`)
  return { cfg, warnings }
}

const samples = {
  '正式環境': { apiBase: '/api', envName: '正式', ssoUrl: 'https://sso.example/authorize', showDebug: false },
  '字串的 false': { apiBase: '/api', envName: '測試', ssoUrl: 'https://sso-test.example/authorize', showDebug: 'false' },
  '缺欄位': { envName: '測試' },
  '沒有載入 config.js': undefined,
}
for (const [name, raw] of Object.entries(samples)) {
  const { cfg, warnings } = readConfig(raw)
  console.log(`${name}：${JSON.stringify(cfg)}`)
  for (const w of warnings) console.log(`  警告：${w}`)
}

// 對照：import.meta.env 的值一律是字串
const VITE_SHOW_DEBUG = 'false'                 // .env 裡寫 VITE_SHOW_DEBUG=false，讀進來長這樣
console.log(`\nif (VITE_SHOW_DEBUG) 會成立嗎？${VITE_SHOW_DEBUG ? '會（字串 "false" 是 truthy）' : '不會'}`)
console.log(`VITE_SHOW_DEBUG === 'true'：${VITE_SHOW_DEBUG === 'true'}`)
```

### 檔案擺放

```html
<!-- index.html：config.js 在 module script 之前 -->
<!doctype html>
<html lang="zh-Hant-TW">
  <head><meta charset="utf-8"><title>門診系統</title></head>
  <body>
    <div id="app"></div>
    <script src="/config.js"></script>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

```js
// public/config.js：開發用的值；正式環境由伺服器送各自的版本
window.__CLINIC_CONFIG__ = {
  apiBase: '/api',
  envName: '開發',
  ssoUrl: 'http://localhost:5174/authorize',
  showDebug: true,
}
```

```js
// src/runtime-config.js：程式裡只從這裡拿設定
const { cfg, warnings } = readConfig(window.__CLINIC_CONFIG__)   // readConfig 同上
for (const w of warnings) console.warn('[config]', w)
export const config = Object.freeze(cfg)
export const APP_VERSION = import.meta.env.VITE_APP_VERSION      // 建置時就確定的值，用 VITE_ 變數
```

```ts
// src/vite-env.d.ts：宣告自己的 VITE_ 變數，拼錯名字時 TypeScript 會報錯
/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

CI 建置時帶入版本號：`VITE_APP_VERSION=$(git rev-parse --short HEAD) npm run build`。shell 的環境變數優先於 `.env` 檔，不用另外寫檔案。

### 掛載前 fetch /config.json

```js
// src/main.js
import { createApp } from 'vue'
import App from './App.vue'
import { setConfig } from './runtime-config'   // 這個版本的 runtime-config 匯出 setConfig，內部同樣呼叫 readConfig

fetch('/config.json', { cache: 'no-cache' })
  .then((res) => (res.ok ? res.json() : {}))
  .catch(() => ({}))                       // 讀不到也要能啟動，用預設值
  .then((raw) => {
    setConfig(raw)
    createApp(App).mount('#app')
  })
```

這裡用 `.then()`，沒有在 `main.js` 頂層寫 `await`：Vite 6 預設的建置目標（`'modules'`，Chrome 87、Safari 14 等）不支援 top-level await，實測建置會失敗，訊息是 `Top-level await is not available in the configured target environment ("chrome87", "edge88", "es2020", "firefox78", "safari14" + 2 overrides)`。Vite 8 的預設目標是 `'baseline-widely-available'`，同一段建置得過。

## 常見錯誤與錯誤訊息

| 現象或訊息 | 原因 | 修法 |
|---|---|---|
| 部署到正式環境後還連到測試的網址 | 網址用 `VITE_` 變數，在建置時寫死 | 改成執行時設定，或每個環境各建一次 |
| 讀到 `undefined` | 變數少了 `VITE_` 前綴；或改了 `.env` 沒重啟 dev server | 加前綴、重啟 |
| `VITE_X=false` 時功能還是打開 | 值是字串 `'false'` | 比對 `=== 'true'` |
| `--mode staging` 時 `import.meta.env.PROD` 是 `true`，判斷錯環境 | mode 與 `NODE_ENV` 是兩件事 | 看 `MODE` 或自己的變數 |
| 在 `dist/` 搜得到金鑰 | 金鑰放在 `VITE_` 變數或 `config.js` | 移到後端；已經外流的要作廢重發 |
| `<script src="/config.js"> in "/index.html" can't be bundled without type="module" attribute` | `public/` 裡沒有 `config.js` | 放一份開發用的 `public/config.js` |
| 子路徑部署時 `config.js` 404 | `index.html` 裡的路徑沒帶 `base` | 讓 Vite 改寫（`public/` 裡要有檔案），或自己寫完整路徑 |
| 改了正式環境的設定，部分使用者還是舊值 | `config.js` 被長效快取 | 伺服器對它設 `Cache-Control: no-cache` |
| `Top-level await is not available in the configured target environment` | Vite 6 的預設建置目標不支援 top-level await | 改用 `.then()`，或調高 `build.target` |

## 動手

1. 按上面程式的「在 Playground 開啟」，在 `samples` 加一個 `showDebug: 'TRUE'`（大寫）的樣本，決定要不要當成開啟，修改 `readConfig`。
2. 在自己的專案跑 `npm run build`，然後在 `dist/` 搜尋每一個 `VITE_` 變數的值（`grep -r "<值的一段>" dist/`），確認每一個都可以公開。
3. 跑 `npx vite build --mode staging` 前後各看一次 `dist/assets` 裡的網址，確認 `.env.staging` 有被載入。
4. 部署時 `config.js`、`index.html` 與 assets 各自的快取設定，見 [SPA 的部署](#/skill/spa-deploy)。

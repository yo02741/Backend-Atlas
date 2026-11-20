## 從一個具體問題開始：首頁要下載整個系統

門診前端越做越大：今日門診、掛號、報表、管理後台。櫃台反應首頁打開要好幾秒。打開 Network 分頁，首頁只下載了一個 `index-*.js`，但它有 1.4 MB。

原因寫在 `router.js` 與 `main.js` 裡：

```js
import TodayView from './views/TodayView.vue'
import ReportsView from './views/ReportsView.vue'     // 報表頁，裡面 import 了圖表套件
import AdminView from './views/AdminView.vue'
import { Chart } from 'chart.js'                      // 有人在 main.js 註冊全域元件
```

每一個 `import` 都是靜態的，打包器把它們全部放進入口 chunk。建置時有警告：

```
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
```

（Vite 8 的原文；Vite 6 的第二行是 `build.rollupOptions.output.manualChunks`。）前一位工程師把 `chunkSizeWarningLimit` 調到 2000，警告消失，問題留著。每次部署，連沒改到的 Vue 與圖表套件也跟著換檔名，所有人重新下載 1.4 MB。

## 運作原理

### 從模組圖到 chunk

打包器從 `index.html` 引用的 `main.js` 出發，沿著每一個 `import` 走，畫出模組圖。靜態的 `import`（檔案頂端那種）表示「我一開始就需要它」，被放進同一個 chunk；動態的 `import()` 表示「執行到這裡才需要」，它指向的模組被切成另一個 chunk，用到時才下載。

```
main.js ──► App.vue ──► router.js
                          ├─ import('./views/TodayView.vue')    ─► TodayView-*.js
                          ├─ import('./views/ReportsView.vue')  ─► ReportsView-*.js ──► chart.js（跟著報表頁）
                          └─ import('./views/AdminView.vue')    ─► AdminView-*.js
main.js ──► vue、vue-router、pinia（靜態）                       ─► 入口或 vendor chunk
```

兩個懶載入的頁面都 import 同一個模組（例如共用的 `DataTable.vue`）時，打包器把它切成一個共用 chunk，誰先用到誰下載，下載過的第二頁直接用快取。

一個靜態的 `import` 就能把整個套件拉回入口：圖表套件只在報表頁 import，它就跟著報表頁；有人在 `main.js` 或所有頁面都用的 `AppHeader.vue` 裡 import 了它，它就進了首頁。

### tree-shaking

打包時拿掉「被 import 了、但沒被用到」的匯出。打包器靠 ES modules 靜態的 `import`／`export` 判斷誰用了什麼：

| 寫法 | 拿得掉沒用的部分嗎 |
|---|---|
| `import { debounce } from 'lodash-es'` | 可以：ES modules、具名匯入 |
| `import _ from 'lodash'` | 不行：`lodash` 是 CommonJS，整包進來 |
| `import * as dateFns from 'date-fns'`，之後只用 `dateFns.format` | 多半可以；改成用變數當屬性名稱（`dateFns[name]`）就不行 |
| 套件的 `package.json` 沒有 `"sideEffects": false` | 打包器不敢刪「看起來沒用、但 import 時可能有副作用」的模組 |

AI 產生的程式常常整包引入（`import _ from 'lodash'`），因為範例比較短。驗收時看建置輸出的大小，或用視覺化工具看每個套件占多少。

### 內容 hash 與快取

`vite build` 輸出的檔名是 `[name]-[hash].js`，hash 由檔案內容算出。內容不變，檔名就不變；內容一變，檔名就變。於是伺服器可以對 `assets/` 下的檔案設一年的快取：

```
Cache-Control: public, max-age=31536000, immutable
```

更新時，新版的 `index.html` 指向新的檔名，瀏覽器發現是沒看過的網址，自然下載新的；沒變的檔案檔名相同，直接用快取。`index.html` 自己沒有 hash，它要用 `Cache-Control: no-cache`，否則使用者一直拿著舊的 `index.html`、一直要舊的檔案。伺服器那一側的快取規則見 [HTTP 快取與條件請求](#/skill/http-caching)。

改一個頁面，哪些檔名會變？實測 Vite 8：只改 `ReportsView.vue` 的一行，重新建置後

| 檔案 | 檔名變了嗎 | 原因 |
|---|---|---|
| `Reports-*.js`、`Reports-*.css` | 變 | 內容變了 |
| `index-*.js`（入口） | 變 | 它的內容裡寫著 `Reports-*.js` 的檔名 |
| `Home-*.js` | 變 | 它從入口 chunk import 共用的小工具，入口改名，它裡面的 import 路徑也跟著變 |
| `vendor-*.js` | 不變 | Vue 與 Vue Router 沒有改 |

所以把 `node_modules` 切成獨立的 vendor chunk，效果最明顯：改自己的程式時，最大的那一塊不用重新下載。Vite 8 另有實驗性的 `build.chunkImportMap`，用 import map 減少這種連鎖改名，目前標為 experimental。

### modulepreload

入口 chunk 靜態 import 了 vendor，瀏覽器要先下載並解析入口，才知道要去拿 vendor，兩個請求是一前一後。Vite 在 `index.html` 加上 `<link rel="modulepreload" href="/assets/vendor-*.js">`，讓兩個檔案同時開始下載。懶載入的頁面也一樣：載入 `ReportsView` 時，Vite 同時預先載入它依賴的共用 chunk 與 CSS。這段預先載入失敗時發出的 `vite:preloadError` 事件，見 [SPA 的部署](#/skill/spa-deploy)。

## 實際程式

### 路由懶載入

```js
// router.js：首頁靜態載入，其他頁面用到才下載
import TodayView from './views/TodayView.vue'

export const routes = [
  { path: '/', component: TodayView },
  { path: '/reports', component: () => import('./views/ReportsView.vue') },
  { path: '/admin', component: () => import('./views/AdminView.vue') },
]
```

```vue
<!-- ReportsView.vue：圖表套件只在這一頁 import，它就跟著這一頁的 chunk -->
<script setup>
import Chart from 'chart.js/auto'
// ...
</script>
```

只有某個按鈕按下才需要的大元件（例如富文字編輯器），可以用 `defineAsyncComponent(() => import('./RichEditor.vue'))`，在元件層級再切一次。

:::stop 讀到這裡可以先停：會用路由懶載入把頁面移出首頁，說得出帶 hash 的檔名為什麼能長效快取。後面的 vendor 切法、建置報表與 hash 模擬，在首頁的 chunk 仍然太大或要調整快取時再回來讀。

### 切出 vendor：Vite 8 與 Vite 6

```js
// vite.config.js（Vite 8）
export default defineConfig({
  plugins: [vue()],
  build: {
    rolldownOptions: {
      output: {
        // 只收框架：整個 node_modules 都收進來的話，只有報表頁用到的圖表套件也會進 vendor，首頁跟著下載
        codeSplitting: { groups: [{ name: 'vendor', test: /[\\/]node_modules[\\/](vue|vue-router|pinia|@vue)[\\/]/ }] },
      },
    },
  },
})
```

```js
// vite.config.js（Vite 6）
export default defineConfig({
  plugins: [vue()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](vue|vue-router|pinia|@vue)[\\/]/.test(id)) return 'vendor'
        },
      },
    },
  },
})
```

Rollup 的 `manualChunks` 另有物件寫法 `{ vendor: ['vue', 'vue-router'] }`，Vite 6 可以用。拿到 Vite 8 會失敗，實測訊息：

```
Warning: Invalid output options (1 issue found)
- For the "manualChunks". Invalid type: Expected Function but received Object.
...
error during build:
TypeError: manualChunks is not a function
```

Vite 8 的 `manualChunks` 只剩函式寫法，而且標為 deprecated；新設定用 `codeSplitting`。反過來，把 `rolldownOptions` 寫進 Vite 6 的專案，Vite 6 不認得它，沒有錯誤也沒有效果，vendor 不會切出來。

### 看建置結果

`vite build` 最後列出每個檔案與 gzip 後的大小，這是第一個要看的地方。要看「這個 chunk 裡有哪些套件、各占多少」，用 `rollup-plugin-visualizer`（7.1 版的 peerDependencies 同時列了 rollup 與 rolldown）：

```js
// vite.config.js
import { visualizer } from 'rollup-plugin-visualizer'

export default defineConfig({
  plugins: [vue(), visualizer({ filename: 'stats.html', gzipSize: true })],
})
```

建置後打開 `stats.html`，每個方塊是一個模組，面積代表大小。找三件事：入口 chunk 裡有沒有只在某一頁用到的套件、同一個套件有沒有出現兩個版本、整包引入的 CommonJS 套件。

### 內容 hash 的模擬

下面用 SHA-256 模擬「檔名由內容算出」：入口 chunk 的內容裡寫著其他 chunk 的檔名，所以頁面一改，入口也跟著改名：

```js run
// 檔名 = 名稱 + 內容 hash 的前 8 碼
async function hash(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join('')
}
async function build(src) {
  const out = {}
  for (const name of ['vendor', 'Home', 'Reports']) out[name] = `${name}-${await hash(src[name])}.js`
  // 入口 chunk 裡寫著其他 chunk 的檔名，所以它的內容跟著它們變
  const entry = `${src.index}\nimport './${out.vendor}'\nimport('./${out.Home}')\nimport('./${out.Reports}')`
  out.index = `index-${await hash(entry)}.js`
  return out
}

const v1 = { vendor: 'vue 與 vue-router', Home: '今日門診頁 v1', Reports: '報表頁 v1', index: 'main.js 與 App.vue' }
const v2 = { ...v1, Reports: '報表頁 v2：多一個欄位' }
const a = await build(v1)
const b = await build(v2)
for (const k of Object.keys(a)) {
  console.log(k.padEnd(8), a[k].padEnd(20), '→', b[k].padEnd(20), a[k] === b[k] ? '不變，用快取' : '改名，重新下載')
}
```

這個模擬裡 `Home` 沒有 import 入口，所以不變；真實的建置中，頁面 chunk 常從入口 import 共用的小工具，會像上面實測表那樣跟著改名。

## 常見錯誤與錯誤訊息

| 現象或訊息 | 原因 | 修法 |
|---|---|---|
| `(!) Some chunks are larger than 500 kB after minification.` | 所有頁面或大型套件都進了同一個 chunk | 路由懶載入、把大套件留在用到它的頁面；不要只調高 `chunkSizeWarningLimit` |
| 首頁的 Network 分頁出現報表頁的程式 | 某個共用檔案靜態 import 了報表用的模組 | 找出那個 import，改成動態 `import()` 或搬進報表頁 |
| `lodash` 整包進了 bundle，只用了一個函式 | CommonJS 套件拿不掉沒用的部分 | 改用 `lodash-es` 的具名 import，或原生寫法 |
| 每次部署，所有檔案都換了檔名 | vendor 沒有切出來，和自己的程式混在一起 | 設定 vendor chunk |
| `TypeError: manualChunks is not a function` | Vite 8 用了 `manualChunks` 的物件寫法 | 改用 `codeSplitting.groups` |
| 設定了 `rolldownOptions`，建置結果沒變 | 專案是 Vite 6 | 照版本寫：Vite 6 用 `rollupOptions` |
| 使用者一直拿到舊版 | `index.html` 被快取 | `index.html` 設 `no-cache`，只有帶 hash 的檔案長效快取 |
| 帶 hash 的檔案每次都重新下載 | 伺服器沒給長效快取標頭，或 DevTools 勾著 `Disable cache` | 檢查 Response Headers；驗快取時取消勾選 `Disable cache` |

## 動手

1. 按上面模擬的「在 Playground 開啟」，讓 `Home` 的內容也包含入口的檔名（模擬它 import 共用的小工具），看改 `Reports` 時 `Home` 是否跟著改名；想一想入口與 `Home` 互相引用時要怎麼算 hash。
2. 在自己的專案跑 `npm run build`，記下入口 chunk 的大小；把一個頁面改成懶載入，再建置一次比較。
3. Network 分頁勾 `Disable cache`、篩選 `JS`，重新整理首頁，確認沒有其他頁面的 chunk；取消勾選再重新整理，帶 hash 的檔案在 Size 欄要顯示 `(memory cache)` 或 `(disk cache)`。
4. 只改一個頁面再建置一次，比較 `dist/assets` 前後的檔名，看哪些變了。

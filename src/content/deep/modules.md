## 從一個具體問題開始：加了一個日期函式，整頁變白

門診報表頁要顯示「11/20（四）09:00」這種格式的時間。AI 新增了 `src/utils/date.js`：

```js
// src/utils/date.js（AI 產生的版本）
export default function formatDate(d) {
  return d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', weekday: 'short' })
}
```

報表頁這樣用它：

```js
// src/views/ReportView.vue 的 <script setup>
import { formatDate } from '@/utils/date.js'
```

存檔後整頁變白，Console 只有一行：`SyntaxError: The requested module '/src/utils/date.js' does not provide an export named 'formatDate'`。`date.js` 用的是預設匯出，`ReportView.vue` 卻用大括號要一個叫 `formatDate` 的具名匯出。瀏覽器在下載完所有模組、還沒執行任何一行之前就檢查匯入與匯出對不對得上，對不上就整個模組圖都不執行，所以畫面什麼都沒有。

同一次改動還加了一個圖表套件：AI 在本機跑了 `npm install`，`package.json` 多了一行，`package-lock.json` 卻沒有提交。CI 的 `npm ci` 停在 `can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync`。圖表套件又被寫在 `main.js` 裡 import，首頁也得下載它。

這一課整理 ES modules 的匯出與匯入、`'vue'` 這種名字怎麼對到實際的檔案、`package.json` 與 lock 檔各管什麼，以及動態 `import()` 怎麼把一頁拆出去。

## 運作原理

### 一個檔案一個模組

- 每個模組有自己的作用域。檔案裡的 `const`、`function` 不會變成全域變數，別的檔案要用就得 `export` 出去、在那邊 `import` 進來。
- 同一個模組不管被 import 幾次，都只下載、執行一次，大家拿到同一份。`store.js` 裡的 `const cache = new Map()` 在整個應用程式裡只有一個。
- 模組預設是 strict mode，最上層的 `this` 是 `undefined`。
- 瀏覽器用 `<script type="module">` 載入，行為像 `defer`：不擋 HTML 解析，解析完才執行。沒有 `type="module"` 的 `<script>` 裡寫 `import`，會得到 `SyntaxError: Cannot use import statement outside a module`。

### 匯出與匯入的對照

| 匯出（`date.js`） | 匯入 |
|---|---|
| `export function formatDate(d) {}` | `import { formatDate } from './date.js'` |
| `export const TZ = 'Asia/Taipei'` | `import { TZ } from './date.js'` |
| `export { formatDate as fmt }` | `import { fmt } from './date.js'` |
| `export default function (d) {}` | `import formatDate from './date.js'`（名字自己取） |
| 以上全部 | `import * as date from './date.js'`，用 `date.formatDate`、`date.default` |
| `export { formatDate } from './date.js'` | 轉匯出，常用在資料夾的 `index.js` |
| （不需要匯出） | `import './styles.css'`：只執行，不取任何東西 |

具名匯出一個檔可以有很多個，名字是約定：拼錯、大小寫不同都對不上。預設匯出一個檔最多一個，匯入時可以隨意命名，壞處是同一個東西在不同檔案可能叫不同名字。`.vue` 單檔元件的預設匯出就是那個元件，所以寫 `import ReportView from './ReportView.vue'`。

匯入拿到的是唯讀的綁定。原模組之後改了變數，匯入端讀到的是新值；匯入端自己指定 `count = 1` 會丟出 `TypeError: Assignment to constant variable.`。

### 模組圖與循環匯入

```
main.js
 ├─ import App from './App.vue'
 │    ├─ import { useClinicStore } from './stores/clinic.js'
 │    │    └─ import { api } from './api/index.js'
 │    └─ import ReportView from './views/ReportView.vue'
 │         └─ import { formatDate } from './utils/date.js'
 └─ import { createPinia } from 'pinia'
```

瀏覽器（或 Vite）從入口開始，把所有 `import` 連成一張模組圖：先全部下載、檢查匯出與匯入對得上，再從最深的模組開始依序執行，每個模組只執行一次。

兩個模組互相 import 時（`a.js` import `b.js`，`b.js` 又 import `a.js`），先執行的那一個會讀到另一個還沒初始化的 `const`，得到 `ReferenceError: Cannot access 'A' before initialization`。常見的情況是 store 與 API 模組互相引用，修法是把共用的部分抽到第三個檔案。

### 匯入路徑怎麼找到檔案

| 寫法 | 由誰解析 | 對到哪裡 |
|---|---|---|
| `./date.js`、`../api/index.js` | 瀏覽器或 Vite | 相對於目前這個檔案 |
| `/src/utils/date.js` | 瀏覽器或 Vite | 從網站根目錄算起 |
| `@/utils/date.js` | Vite 的 `resolve.alias` | 專案自己設定的別名，常見的設定是把 `@` 對到 `src/` |
| `vue`、`pinia`（bare specifier） | Vite；不經打包時靠 import map | `node_modules/vue/package.json` 的 `exports` 指定的入口檔 |
| `vue/dist/某個檔案` | Vite | 只能用 `exports` 有列出的路徑，沒列出的會出現 `Missing "./…" specifier in "vue" package` |

瀏覽器只認完整的網址，副檔名一定要寫。Vite 會幫忙補副檔名，預設依序試 `.mjs`、`.js`、`.mts`、`.ts`、`.jsx`、`.tsx`、`.json`（Vite 8 的 `resolve.extensions`）；`.vue` 不在裡面，匯入元件一定要寫 `.vue`。

不經打包、直接給瀏覽器的頁面要用 bare specifier，就在 HTML 寫 import map（Baseline 2023）：

```html
<script type="importmap">
  { "imports": { "vue": "https://unpkg.com/vue@3.5.45/dist/vue.esm-browser.prod.js" } }
</script>
<script type="module">
  import { createApp, ref } from 'vue'   // 由上面的 import map 對到網址
</script>
```

沒有 import map 時，瀏覽器丟出 `TypeError: Failed to resolve module specifier "vue". Relative references must start with either "/", "./", or "../".`。

### `package.json`

create-vite 9.3 的 Vue + TypeScript 範本產生的 `package.json`：

```json
{
  "name": "vite-vue-typescript-starter",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "vue": "^3.5.44"
  },
  "devDependencies": {
    "@types/node": "^24.19.2",
    "@vitejs/plugin-vue": "^6.0.10",
    "@vue/tsconfig": "^0.9.1",
    "typescript": "~6.0.3",
    "vite": "^8.3.6",
    "vue-tsc": "^3.3.14"
  }
}
```

| 欄位 | 管什麼 |
|---|---|
| `private: true` | 不會被誤發布到 npm |
| `type: "module"` | Node 把專案裡的 `.js` 檔（包含 `vite.config.js`）當成 ESM；沒有這一行時預設當 CommonJS，Node 22 遇到 `import` 語法會改用 ESM 重新解析，並印出 `MODULE_TYPELESS_PACKAGE_JSON` 警告 |
| `scripts` | `npm run dev`、`npm run build` 實際執行的指令 |
| `dependencies` | 應用程式執行時 import 的套件：`vue`、`vue-router`、`pinia` |
| `devDependencies` | 開發與建置用的工具：`vite`、`typescript`、`vue-tsc`、ESLint、測試工具 |

前端專案最後是 Vite 打包出來的檔案，程式 import 了什麼就打包什麼，放在哪一區不影響 bundle 的內容。分開放的用處在於讀的人一眼看得出哪些會進到使用者的瀏覽器，以及只裝執行所需套件的情況（例如 `npm ci --omit=dev`）。

### 版本範圍與 lock 檔

| 寫法 | 允許的版本 | 例子 |
|---|---|---|
| `^3.5.0` | `>=3.5.0 <4.0.0` | 3.5.45、3.6.0 可以，4.0.0 不行 |
| `~6.0.3` | `>=6.0.3 <6.1.0` | 6.0.9 可以，6.1.0 不行 |
| `^0.9.1` | `>=0.9.1 <0.10.0` | 0.x 時 `^` 只放寬到同一個 minor |
| `3.5.45` | 只有這一版 | |

`package.json` 寫的是範圍，同一份範圍在不同時間安裝可能裝到不同版本。`package-lock.json` 記下這次實際裝了哪一版（連同依賴的依賴），提交進版控之後，每個人與 CI 才裝得到同一組。`npm install` 會依範圍更新 lock 檔；`npm ci` 先刪掉 `node_modules`，完全照 lock 檔安裝，lock 檔與 `package.json` 對不上就直接失敗，所以 CI 用它。

### 動態 `import()`

```js
// router/index.js
import HomeView from '../views/HomeView.vue'      // 靜態：打進一開始就下載的 bundle

const routes = [
  { path: '/', component: HomeView },
  { path: '/reports', component: () => import('../views/ReportView.vue') },   // 進這一頁才下載
]
```

`import()` 是一個回傳 Promise 的運算式，可以寫在任何地方。Vite 建置時把它指到的模組（以及只有它用到的套件）拆成獨立的 chunk，`dist/assets/` 會多出 `ReportView-<hash>.js`。程式裡也可以直接用：

```js
async function exportPdf() {
  const { buildPdf } = await import('../utils/pdf.js')   // 按下按鈕才下載
  await buildPdf(report.value)
}
```

拿預設匯出要讀 `.default`：`const mod = await import('./ReportView.vue'); mod.default`。

部署新版本之後，舊的 chunk 檔通常會被刪掉。使用者還開著舊頁面，點進報表頁時要的是舊檔名，請求失敗，Console 出現 `TypeError: Failed to fetch dynamically imported module: …`；伺服器若把不存在的路徑都回成 `index.html`，則出現 MIME type 的錯誤（見下方表格）。Vite 在這種情況會在 `window` 上觸發 `vite:preloadError` 事件，可以在那裡重新整理頁面。

### CommonJS

Node 早期的模組格式是 `const fs = require('fs')` 與 `module.exports = {…}`。瀏覽器不認得它：直接執行會得到 `ReferenceError: require is not defined`。在 `"type": "module"` 的專案裡，Node 也不准 `.js` 檔用 `require`，訊息是 `ReferenceError: require is not defined in ES module scope, you can use import instead`。

npm 上還有不少只提供 CommonJS 的套件。Vite 開發時會先把依賴預先打包（dependency pre-bundling），順便轉成 ESM，所以在 Vue 元件裡 `import` 它們通常沒問題；AI 產出的前端程式碼裡出現 `require(…)`，多半是照抄了 Node 的寫法，要改成 `import`。

## 實際程式碼

### 共用函式用具名匯出

```js
// src/utils/date.js
const TZ = 'Asia/Taipei'

export function formatDate(d) {
  return d.toLocaleDateString('zh-TW', { timeZone: TZ, month: 'numeric', day: 'numeric', weekday: 'short' })
}

export function formatTime(d) {
  return d.toLocaleTimeString('zh-TW', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
}
```

```js
// src/views/ReportView.vue 的 <script setup>
import { formatDate, formatTime } from '@/utils/date.js'   // 名字和 export 一樣
import BarChart from '@/components/BarChart.vue'           // .vue 檔：預設匯出，副檔名要寫
```

具名匯出讓每個檔案用同一個名字，編輯器的自動匯入與重新命名也比較準。很多團隊的慣例是「元件用預設匯出，其他都用具名匯出」。

:::stop 讀到這裡可以先停：會對上具名與預設匯出、讀懂 `package.json` 與 lock 檔、用 `import()` 拆出頁面。後面的 alias、新增套件的步驟與錯誤表，在設定路徑別名或加新套件時再回來讀。

### `vite.config.js` 的 alias

```js
// vite.config.js
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },   // @/xxx 對到 src/xxx
  },
})
```

這個檔案能用 `import`，是因為 `package.json` 有 `"type": "module"`。用 TypeScript 的專案，alias 還要在 `tsconfig` 的 `paths` 寫一次，型別檢查才找得到檔案。

### 新增套件的步驟

```bash
npm install some-chart-lib      # 寫進 dependencies，並更新 package-lock.json
npm install -D some-lint-tool   # -D：寫進 devDependencies
git add package.json package-lock.json
git diff --cached --stat        # 兩個檔都要有變更
npm ci                          # 照 lock 檔重裝一次，確認 CI 也裝得起來
```

## 常見錯誤與錯誤訊息

| 訊息 | 原因 | 修法 |
|---|---|---|
| `SyntaxError: The requested module './date.js' does not provide an export named 'formatDate'` | 匯入的具名匯出不存在：對方是預設匯出，或名字拼錯 | 對照兩邊的寫法；預設匯出就不加大括號 |
| `TypeError: Failed to resolve module specifier "vue". Relative references must start with either "/", "./", or "../".` | 瀏覽器直接載入了含 bare specifier 的檔案，沒經過 Vite，也沒有 import map | 用 Vite 開發與建置，或加 import map |
| `SyntaxError: Cannot use import statement outside a module` | `<script>` 少了 `type="module"` | 加上 `type="module"` |
| `[plugin:vite:import-analysis] Failed to resolve import "@/utils/dates" from "src/views/ReportView.vue". Does the file exist?` | 路徑或檔名錯、alias 沒設、`.vue` 漏了副檔名 | 對照實際檔名與 `resolve.alias` |
| `Missing "./dist/xxx" specifier in "某套件" package` | 匯入了套件 `exports` 沒有公開的路徑 | 改用套件文件寫的匯入路徑 |
| `ReferenceError: Cannot access 'A' before initialization` | 循環匯入，或在宣告之前就用了變數 | 把共用的部分抽到第三個檔案 |
| `TypeError: Assignment to constant variable.` | 對匯入的綁定重新指定 | 呼叫原模組匯出的函式去改 |
| `ReferenceError: require is not defined` | 前端程式碼裡用了 CommonJS 的 `require` | 改成 `import` |
| `Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html".` | 要的 JS 檔不存在，伺服器回了 `index.html`：`base` 設錯，或部署後舊頁面要了已刪除的 chunk | 檢查 `base` 與部署的檔案；處理 `vite:preloadError` |
| `TypeError: Failed to fetch dynamically imported module: …` | 動態 import 的 chunk 下載失敗（404 或網路斷了） | 同上；在路由切換失敗時提示重新整理 |
| `npm ci` 停在 `can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync` | 改了 `package.json` 沒更新或沒提交 lock 檔 | 本機 `npm install` 後一起提交 |

訊息裡的模組路徑是瀏覽器實際要的網址，在 Vite 開發環境是 `/src/...`，對回專案裡的檔案很直接；正式環境是 `/assets/xxx-<hash>.js`，要靠 source map 才看得出原始檔，見 [錯誤與除錯](#/skill/js-debugging)。

## 動手

- 在自己的 Vite 專案裡把一個具名匯出改成預設匯出、匯入端不改，看 Console 的錯誤；再把匯入端改成不加大括號。
- 把一個頁面的路由改成 `() => import(…)`，執行 `npm run build`，看 `dist/assets/` 多了哪個檔、大小多少；`npm run preview` 後在 Network 分頁確認首頁沒有下載它。
- 讀 `package.json` 的 `dependencies` 與 `devDependencies`，每個套件說得出是誰在用；`npm ls vue` 看實際裝到的版本，和 `package.json` 寫的範圍對照。
- 錯誤訊息怎麼對回原始碼，接著讀 [錯誤與除錯](#/skill/js-debugging)；`await import()` 回傳的 Promise，見 [非同步：Promise 與 async/await](#/skill/async-js)。

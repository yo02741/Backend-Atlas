## 從一個具體問題開始：本機好好的，CI 建置失敗

一個用 AI 建立的門診前端專案，在開發者的 Mac 上 `npm run dev` 一切正常。推上去之後：

1. CI（Linux）的 `npm run build` 失敗：`Could not resolve "./components/button.vue" from "src/App.vue"`。檔案叫 `Button.vue`，import 寫成小寫；macOS 預設的檔案系統不分大小寫，Linux 分。
2. 修好之後建置成功，但 vendor 沒有切出來。`vite.config.js` 裡的 `build.rolldownOptions` 是從 Vite 8 的文件抄來的，專案裝的是 Vite 6，Vite 6 不認得這個選項，沒有警告也沒有作用。
3. 有人為了「快速上線」，在正式環境的容器裡跑 `vite preview`。

三件事都源自同一個誤會：以為 dev server、建置、預覽是同一件事，以為 Vite 各版本的設定可以混用。

## 運作原理

### dev server：不打包，用到才轉換

`npm run dev` 執行 `vite`，啟動一個開發用的伺服器，預設在 `http://localhost:5173`（被占用時自動換下一個埠，加 `--strictPort` 則直接失敗）。瀏覽器打開首頁之後：

```
瀏覽器                                   Vite dev server
GET /                          ──►      回 index.html，插入 /@vite/client（HMR 用）
GET /src/main.js               ──►      即時轉換：裸 import 'vue' 改寫成 /node_modules/.vite/deps/vue.js?v=…
                                         import.meta.env 換成目前的值
GET /src/App.vue               ──►      即時把 SFC 編譯成 JS
GET /node_modules/.vite/deps/vue.js ─►   回預打包好的 vue
```

瀏覽器原生支援 ES modules，Vite 不用先把整個專案打包，瀏覽器要哪個檔案才轉換哪個。專案再大，啟動時間也不太會變長。代價是第一次打開頁面時，瀏覽器要發出很多個模組請求；Network 分頁裡看得到一長串 `.js`、`.vue` 的請求，這在開發時是正常的。

### 依賴預打包

`node_modules` 裡的套件不直接送給瀏覽器，Vite 在 dev server 第一次啟動時先把它們打包好，放在 `node_modules/.vite/deps/`：

- 有些套件是 CommonJS，瀏覽器不能直接 `import`，先轉成 ES modules。
- 有些套件由幾百個小檔案組成，打包成一個檔，瀏覽器就不用發幾百個請求。

`package.json` 或 lock 檔變了，Vite 會重做一次預打包，終端機印出 `optimized dependencies changed. reloading`，頁面重新載入。換了套件版本後行為怪異時，`vite --force` 會忽略快取重新打包。

### HMR

dev server 開著時，存檔會觸發 HMR（Hot Module Replacement）：

1. Vite 偵測到檔案改變，找出受影響的模組。
2. 透過 WebSocket 通知瀏覽器裡的 `/@vite/client`。
3. 瀏覽器重新載入那個模組，替換掉舊的，頁面不重新整理。

Vue 的 SFC 由 `@vitejs/plugin-vue` 處理：只改 `<template>` 時重新渲染，元件的狀態（輸入框的字、ref 的值）通常保留；改了 `<script setup>`，元件重新建立，狀態回到初始值。改到沒有「接受更新」邊界的檔案（例如 `main.js`），只能整頁重新載入，終端機印出 `page reload src/main.js`；更新成功時印出 `hmr update /src/…`。

瀏覽器的 Console 裡，連上時有 `[vite] connecting...` 與 `[vite] connected.`；dev server 停了會出現 `[vite] server connection lost. Polling for restart...`。HMR 成功的 `[vite] hot updated: /src/App.vue` 是 debug 等級，Console 的等級要勾 Verbose 才看得到。

### vite build

`npm run build` 執行 `vite build`，做 dev server 沒做的事：

- 從 `index.html` 出發找出所有模組，打包成幾個 chunk。
- 壓縮 JS 與 CSS，拿掉沒用到的程式碼。
- 檔名加上內容 hash，例如 `index-DKeOfM_j.js`。
- 改寫 `index.html`，指向打包後的檔案；`public/` 的檔案原樣複製。
- 輸出到 `dist/`，預設先清空。

dev server 不打包、不做型別檢查，所以「dev 能跑」不代表「build 會過」。路徑大小寫、只在建置時才被打包器檢查的循環引用、`import.meta.env` 在建置時的值，都只有 build 會暴露。交付前一定跑一次 build。chunk 怎麼切、hash 怎麼影響快取，見 [bundle、chunk 與 hash](#/skill/bundles-chunks)。

### vite preview

`npm run preview` 執行 `vite preview`，在本機開一個簡單的靜態伺服器送 `dist/`，預設埠 4173。它用來確認建置結果能跑，不是正式環境的伺服器。實測 Vite 6.4 與 8.3 的 preview：

| 請求 | preview 的回應 | 正式環境應該 |
|---|---|---|
| `/appointments/42`（頁面路徑） | `index.html` | `index.html`（fallback） |
| `/assets/nope.js`（不存在的 asset） | `index.html`，200 | 404 |
| `/assets/index-DKeOfM_j.js` | `Cache-Control: no-cache` | `max-age=31536000, immutable` |

在 preview 上正常，不代表伺服器的 fallback 與快取設定是對的。正式環境的設定見 [SPA 的部署](#/skill/spa-deploy)。

### Vite 6 與 Vite 8

2026 年 11 月，npm 上 vite 的最新版是 8.3.8；本站自己用的是 Vite 6（`package.json` 寫 `^6.0.0`，實際安裝 6.4.3）。兩者的主要差別：

| | Vite 6 | Vite 8 |
|---|---|---|
| 建置的打包器 | Rollup | Rolldown |
| 轉換與壓縮 | esbuild | Oxc（`esbuild` 選項標為 deprecated，改用 `oxc`） |
| 打包選項 | `build.rollupOptions` | `build.rolldownOptions`（`rollupOptions` 還能用，標為 deprecated） |
| chunk 的手動切法 | `output.manualChunks`（物件或函式） | `output.codeSplitting`；`manualChunks` 只剩函式寫法，標為 deprecated |
| Node 版本 | 18、20、22 以上 | 20.19 以上或 22.12 以上 |
| `build.target` 預設 | `'modules'`（Chrome 87+、Firefox 78+、Safari 14+、Edge 88+） | `'baseline-widely-available'`（Chrome 111+、Edge 111+、Firefox 114+、Safari 16.4+） |

`npm create vite@latest` 建立的新專案是最新版；網路上的教學與 AI 的產出常常是舊版的寫法。看到設定時先確認 `package.json` 的 `vite` 版本。舊版不認得新選項時不會報錯，只是沒有作用，這類錯誤最難發現。升級的細節以官方的 Migration 文件為準。

Vue CLI（`@vue/cli`，底層是 webpack）是 Vite 之前 Vue 官方的工具，現在處於維護模式；舊專案裡看到 `vue.config.js`、`npm run serve`，就是它。

## 實際程式

### Vite 8 的專案設定

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

```js
// vite.config.js（Vite 8）
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],                     // 讓 Vite 認得 .vue 檔
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',  // 開發時 /api 轉給後端；正式環境由 nginx 在同網域提供
    },
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: { groups: [{ name: 'vendor', test: /node_modules/ }] },   // 套件切成 vendor
      },
    },
  },
})
```

同樣的設定在 Vite 6：

```js
// vite.config.js（Vite 6）
export default defineConfig({
  plugins: [vue()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8000' } },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) return 'vendor'
        },
      },
    },
  },
})
```

`server.proxy` 讓前端在開發時也用同網域的 `/api`，不用處理 CORS；正式環境怎麼對應，見 [從前端看同源與 CORS](#/skill/same-origin-frontend)。

### 建置的輸出

上面的 Vite 8 設定加上 `base: '/clinic/'`、兩個懶載入的頁面（`Home`、`Reports`），`vite build` 實際印出：

```bash
$ npx vite build
vite v8.3.8 building client environment for production...
transforming...
✓ 26 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                    0.32 kB │ gzip:  0.21 kB
dist/assets/Reports-DSZzMA48.css   0.03 kB │ gzip:  0.05 kB
dist/assets/Home-C9T0O8e2.js       0.19 kB │ gzip:  0.17 kB
dist/assets/Reports-rKyvxhmO.js    0.26 kB │ gzip:  0.22 kB
dist/assets/index-CmXrpQpe.js      3.19 kB │ gzip:  1.53 kB
dist/assets/vendor-C8Rcc4dC.js    86.58 kB │ gzip: 33.61 kB

✓ built in 114ms
```

`dist/index.html` 裡原本的 `<script type="module" src="/src/main.js">` 被換成 `<script type="module" crossorigin src="/clinic/assets/index-CmXrpQpe.js">`，另外多了一行 `<link rel="modulepreload" crossorigin href="/clinic/assets/vendor-C8Rcc4dC.js">`，讓瀏覽器同時開始下載 vendor。Vue 與 Vue Router 在 `vendor` 裡，約 87 kB（gzip 後 34 kB）。

## 常見錯誤與錯誤訊息

| 訊息或現象 | 原因 | 修法 |
|---|---|---|
| `Could not resolve "./components/button.vue" from "src/App.vue"`（只在 CI 出現） | import 路徑的大小寫和檔名不同，macOS 與 Windows 不分大小寫 | 路徑照檔名寫；CI 用 Linux 跑 build |
| `[plugin:vite:import-analysis] Failed to resolve import "…" from "src/…". Does the file exist?` | dev server 找不到 import 的檔案或套件：路徑打錯、套件沒安裝 | 檢查路徑；`npm ls <套件>` 確認有裝 |
| 設定了 vendor 切分，建置結果沒有 vendor chunk | Vite 6 專案寫了 Vite 8 的 `rolldownOptions`，被忽略 | 照安裝的版本寫設定 |
| Vite 8 建置失敗：`TypeError: manualChunks is not a function`，前面有 `Invalid type: Expected Function but received Object` | 用了 Rollup 的物件寫法 `manualChunks: { vendor: [...] }` | 改用 `codeSplitting.groups` |
| `Port 5173 is in use, trying another one...` | 另一個 dev server 還開著 | 關掉它，或用 `--port`；需要固定埠時加 `--strictPort` |
| 存檔後整頁重新載入，表單的內容不見 | 改到的檔案沒有 HMR 邊界（例如 `main.js`、被很多地方 import 的設定檔） | 正常行為；常改的值放進元件或 store |
| Console 出現 `[vite] server connection lost. Polling for restart...` | dev server 停了或重啟中 | 回終端機看是不是當掉了 |
| 換了套件版本，dev 時還在跑舊版 | 預打包的快取沒更新 | `vite --force`，或刪掉 `node_modules/.vite` |
| 正式環境用 `vite preview`，快取與 404 都不對 | preview 不是正式環境的伺服器 | 用 nginx、CDN 或其他靜態檔伺服器 |

## 動手

1. 在自己的 Vite 專案執行 `npx vite --version`，對照 `vite.config.js`：有沒有不屬於這個版本的選項。
2. 開著 dev server，在一個元件的輸入框打幾個字，分別改它的 `<template>` 與 `<script setup>` 存檔，看輸入框的字哪一次還在；再改 `main.js`，看終端機印出 `page reload`。
3. 跑 `npm run build && npm run preview`，打開 Network 分頁看 assets 的 `Cache-Control`，再用 `curl -I http://localhost:4173/assets/nope.js` 看 preview 對不存在的檔案回什麼。
4. 建置時與執行時的設定怎麼分，接著讀 [建置時設定與執行時設定](#/skill/env-config)。

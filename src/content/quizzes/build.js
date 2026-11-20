// 題庫：建置與部署
export default [
  {
    skill: 'vite-basics',
    questions: [
      {
        q: '`npm run dev` 一切正常，為什麼交付前還要跑 `npm run build`？',
        options: [
          'dev server 把建置結果放在記憶體裡，內容和 `dist/` 相同；跑 build 只是為了拿到檔案去部署',
          'dev server 不打包也不做型別檢查，路徑大小寫、建置目標不支援的語法這類錯，只有 build 會暴露',
          '`npm run build` 會順便把網站部署到正式環境',
          'dev server 只把程式轉成 Chrome 認得的格式，build 之後才依 `build.target` 支援 Safari 與 Firefox',
        ],
        answer: 1,
        explain: 'dev server 讓瀏覽器直接載入 ES modules、用到才轉換；`vite build` 才從頭打包、壓縮、依建置目標轉換語法。macOS 不分大小寫的 import 路徑在 Linux 的 CI 上會 `Could not resolve`，Vite 6 的預設目標不支援 top-level await，都只有 build 會失敗。dev server 的內容不在記憶體裡等著輸出，它根本沒有打包；build 不會部署；dev server 也不限瀏覽器。',
      },
      {
        q: '這個專案的 `package.json` 寫 `"vite": "^6.0.0"`。執行 `vite build` 的結果是？',
        code: `export default defineConfig({
  plugins: [vue()],
  build: {
    rolldownOptions: {
      output: { codeSplitting: { groups: [{ name: 'vendor', test: /node_modules/ }] } },
    },
  },
})`,
        lang: 'js',
        options: [
          '建置失敗，提示 `rolldownOptions` 是不認得的選項',
          '切出 vendor chunk，和 Vite 8 一樣',
          'Vite 自動把它轉成 `rollupOptions.output.manualChunks`',
          '建置成功、沒有任何警告，但 `dist/assets` 裡沒有 vendor chunk',
        ],
        answer: 3,
        explain: '`build.rolldownOptions` 是 Vite 8 的選項（打包器換成 Rolldown）。Vite 6 用 Rollup，選項叫 `build.rollupOptions`，切 vendor 用 `manualChunks`。Vite 6 遇到不認得的設定不報錯也不轉換，直接忽略，所以這種錯最難發現。看設定之前先確認安裝的版本。',
      },
      {
        q: '同事想在正式環境的容器裡直接跑 `vite preview` 送前端，理由是「本機預覽都正常」。最主要的問題是？',
        options: [
          '它是本機確認 `dist/` 用的：找不到的 assets 也回 `index.html`，快取標頭也不對',
          '`vite preview` 只能在 macOS 與 Windows 上執行，Linux 容器裡啟動會失敗',
          '`vite preview` 每次啟動都會重跑一次 `vite build`，容器重啟要等好幾分鐘',
          '`vite preview` 預設開著 HMR 的 WebSocket，使用者的頁面會在部署後自動重新整理',
        ],
        answer: 0,
        explain: 'preview 是方便在本機看 `dist/` 能不能跑的小伺服器，官方說明它不是正式環境用的伺服器。它的 SPA fallback 連不存在的 `/assets/*.js` 也回 `index.html`，assets 的 `Cache-Control` 是 `no-cache`，快取標頭也不是 `index.html` 不快取、assets 長效快取那一套。正式環境用 nginx、CDN 或其他靜態檔伺服器。preview 不重新建置、沒有 HMR、各平台都能跑。',
      },
    ],
  },
  {
    skill: 'env-config',
    questions: [
      {
        q: '`import.meta.env.VITE_API_BASE` 在 `vite build` 之後是什麼？',
        options: [
          '執行時從瀏覽器的環境變數讀取',
          '建置時被換成字串常數寫進 bundle，換環境就要重建',
          '每次載入頁面時，向伺服器要一次 `.env` 檔',
          '只在 dev server 有值，建置之後一律是 `undefined`',
        ],
        answer: 1,
        explain: '瀏覽器沒有環境變數可讀。Vite 在建置時把 `import.meta.env.VITE_API_BASE` 整段換成字串，寫死在 JS 檔裡，所以同一份建置搬到別的環境，值不會變。`.env` 檔只在建置機上讀，不會送到瀏覽器；有 `VITE_` 前綴的變數在建置後有值，沒有前綴的才是 `undefined`。',
      },
      {
        q: '`.env.production` 裡寫的是 `VITE_SHOW_DEBUG=false`。正式建置後，除錯面板會不會出現？',
        code: `if (import.meta.env.VITE_SHOW_DEBUG) {
  showDebugPanel()
}`,
        lang: 'js',
        options: [
          '不會：Vite 讀 `.env` 時把 `true`、`false` 轉成布林，`false` 是 falsy',
          '不會，正式建置會略過值是布林的 `VITE_` 變數',
          '會：讀到的是字串 `\'false\'`，非空字串是 truthy',
          '建置失敗：`.env` 的值不能是 `true`、`false` 這類保留字，要加引號',
        ],
        answer: 2,
        explain: '`.env` 裡的值一律是字串，`false` 讀進來是 `\'false\'`，而非空字串在 `if` 裡是 true。實測 Vite 建置後，這個判斷直接被算成成立。布林與數字要自己轉換，例如 `import.meta.env.VITE_SHOW_DEBUG === \'true\'`；Vite 不會轉成布林，也不會略過或拒絕這種值。',
      },
      {
        q: '前端要呼叫第三方地圖服務，需要一把 API 金鑰。工程師打算寫成 `VITE_MAPS_KEY` 放進 `.env.production`。該怎麼看這件事？',
        options: [
          '可以，只要 `.env.production` 加進 `.gitignore`、不進版控，金鑰就不會外流',
          '改成放在執行時載入的 `/config.js`，金鑰就不在 bundle 裡、不會被看到',
          '把 `VITE_` 前綴拿掉，變數就只留在建置機，前端程式還是能安全地讀到',
          '`VITE_` 變數會寫進公開的 bundle；金鑰留在後端，由後端代為呼叫地圖服務',
        ],
        answer: 3,
        explain: '建置之後金鑰就在 `dist/assets/*.js` 裡，打開網頁的人用 Network 分頁就看得到，`.env` 有沒有進版控無關。`config.js` 一樣是公開檔案。拿掉前綴，前端讀到的是 `undefined`，不是安全地讀到。需要保密的金鑰只能留在後端；另一條路是用服務商限定網域的瀏覽器金鑰，並接受它是公開的。',
      },
    ],
  },
  {
    skill: 'bundles-chunks',
    questions: [
      {
        q: '為什麼 `assets/` 底下的檔案可以設 `Cache-Control: max-age=31536000, immutable`，`index.html` 卻要 `no-cache`？',
        options: [
          'assets 檔名帶內容 hash，內容變了網址就變；`index.html` 網址固定，又決定載入哪一版',
          'JS 與 CSS 壓縮後很少變動，HTML 每次部署都會被 Vite 重新產生',
          '瀏覽器規定 HTML 文件不能被快取，`max-age` 對 HTML 沒有作用',
          '`immutable` 只能用在 `.js` 與 `.css` 這類靜態資源，用在 HTML 會被瀏覽器忽略',
        ],
        answer: 0,
        explain: '帶 hash 的檔名等於版本號：新版本是新網址，瀏覽器自然會下載，舊網址的內容永遠不變，可以快取一年。`index.html` 沒有 hash，它被快取時使用者一直拿著舊的 `index.html`，一直去要舊的 chunk，所以要每次向伺服器確認。JS 與 CSS 改一行就會換檔名，和「很少變動」無關；HTML 可以被快取，`immutable` 也不限副檔名。',
      },
      {
        q: '這段設定在 Vite 8.3 執行 `vite build` 會怎樣？',
        code: `// Vite 8
export default defineConfig({
  build: {
    rolldownOptions: {
      output: { manualChunks: { vendor: ['vue', 'vue-router'] } },
    },
  },
})`,
        lang: 'js',
        options: [
          '切出 vendor chunk，和 Vite 6 用 Rollup 時的結果一樣',
          '建置失敗：Rolldown 的 `manualChunks` 只接受函式',
          '設定被忽略，沒有任何訊息，vendor 留在入口 chunk 裡',
          'Vite 自動把它轉成 `codeSplitting.groups`，並印出 deprecated 警告',
        ],
        answer: 1,
        explain: 'Rollup 的 `manualChunks` 有物件與函式兩種寫法，Vite 6 都能用。Vite 8 換成 Rolldown，`manualChunks` 只剩函式寫法而且標為 deprecated，物件寫法先警告 `Expected Function but received Object`，接著 `TypeError: manualChunks is not a function`，建置失敗。Vite 8 的新寫法是 `output.codeSplitting: { groups: [{ name: \'vendor\', test: /node_modules/ }] }`。',
      },
      {
        q: '`vite build` 印出 `(!) Some chunks are larger than 500 kB after minification.`，入口 chunk 有 1.4 MB。報表頁用的圖表套件在 `main.js` 裡 import 並註冊成全域元件。最有效的第一步是？',
        options: [
          '把 `chunkSizeWarningLimit` 調到 2000，讓警告消失',
          '報表頁改成路由懶載入，圖表套件只在報表頁的元件裡 import',
          '關掉 minify，讓建置快一點',
          '把每一個套件各自切成一個 chunk',
        ],
        answer: 1,
        explain: '在 `main.js` 靜態 import 的東西一定進入口 chunk，每個使用者打開首頁都要下載。只在報表頁 import，它就跟著報表頁的 chunk，用到才下載。調高門檻只是讓警告消失；關掉 minify 讓檔案更大；每個套件一個 chunk 不減少首頁要下載的量，還多了很多請求。',
      },
    ],
  },
  {
    skill: 'spa-deploy',
    questions: [
      {
        q: '用 `createWebHistory` 的 SPA，使用者在 `/clinic/appointments/42` 按 F5。伺服器需要怎麼回應？',
        options: [
          '回 404，SPA 會自己處理',
          '轉址到 `/clinic/`，前端路由再導回原頁',
          '回 `index.html`（fallback），由前端路由決定顯示哪一頁',
          '回 `appointments/42.html`，Vite 建置時會產生每一頁的 HTML',
        ],
        answer: 2,
        explain: 'history 模式下重新整理，瀏覽器向伺服器要 `/clinic/appointments/42`，伺服器上沒有這個檔案。伺服器要回 `index.html`，載入 SPA 之後由 Vue Router 依網址顯示對的頁面。回 404 時瀏覽器只會顯示伺服器的錯誤頁；轉址會丟掉原本的路徑；Vite 建置 SPA 只產生一個 `index.html`。',
      },
      {
        q: '部署新版後，開著舊版頁面的使用者點「報表」，Console 出現 `Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html"`。和這段設定的關係是？',
        code: `location /clinic/ {
    try_files $uri $uri/ /clinic/index.html;
    add_header Cache-Control "no-cache" always;
}`,
        lang: 'nginx',
        options: [
          '沒有關係，這是 Vite 產生的 chunk 少了 `type="module"` 的 bug',
          '舊 chunk 已刪，`try_files` 把它也 fallback 成 `index.html`，瀏覽器拿到 HTML',
          '`no-cache` 讓瀏覽器每次重新驗證，舊分頁拿不到 JS；改成 `immutable` 就好',
          '`.js` 的 MIME type 沒設定，nginx 要加 `types { application/javascript js; }`',
        ],
        answer: 1,
        explain: '這段設定讓所有找不到的路徑都回 `index.html`，包含已經被刪掉的舊 chunk。瀏覽器拿到 HTML 當 JavaScript，拒絕執行。`/clinic/assets/` 用 `try_files $uri =404;` 回 404，錯誤訊息一看就知道是檔案不在；前端監聽 `vite:preloadError` 重新載入，拿到新版。改快取或 MIME type 都不會讓不存在的檔案出現；chunk 也不需要 `type="module"` 標記，是 `import()` 載入的。',
      },
      {
        q: '前端要部署在 `portal.example` 的 `/clinic/` 子路徑，用 history 模式。建置後一打開就白畫面，Console 一排 `/assets/index-*.js` 的 404。要改哪些地方？',
        options: [
          'Vite 的 `base`、Router 的 `createWebHistory(BASE_URL)` 與伺服器目錄都對上 `/clinic/`',
          '只在 nginx 加一條把 `/assets/` rewrite 到 `/clinic/assets/` 的規則',
          '改用 `base: \'./\'` 相對路徑，history 模式下的深層連結也能載入資源',
          '把 `index.html` 改名成 `clinic.html`，並在 nginx 的 `index` 指令指向它',
        ],
        answer: 0,
        explain: '`base: \'/clinic/\'` 讓建置出的資源網址帶上 `/clinic/`，`createWebHistory(import.meta.env.BASE_URL)` 讓路由知道前綴，伺服器的目錄要對上同一個前綴，三處一致才不會白畫面或深層連結 404。在 nginx 補 rewrite 會搶走入口網站自己的 `/assets/`；`./` 在 history 模式下會讓深層連結的資源路徑算錯；改檔名和路徑無關。',
      },
    ],
  },
  {
    skill: 'rendering-modes',
    questions: [
      {
        q: '醫院對外的「科別介紹」頁：內容每季更新一次、要被搜尋引擎收錄，主機只能放靜態檔。最合適的渲染方式是？',
        options: [
          'CSR：沿用門診系統的 SPA，進頁面後再呼叫 API 取得內容',
          'SSR：每個請求由 Node.js 伺服器渲染成 HTML',
          'SSG：建置時把每一頁渲染成 HTML，內容更新時重新建置',
          'CSR 加上 Skeleton，讓搜尋引擎看到版面的輪廓',
        ],
        answer: 2,
        explain: '內容在建置時就能確定，SSG 讓 HTML 裡直接有內容，搜尋引擎看得到，部署出去仍然是靜態檔。SSR 也能讓內容出現在 HTML 裡，但需要一台跑 Node.js 的伺服器，和「只能放靜態檔」衝突。CSR 的 HTML 裡沒有內容，爬蟲不會等非同步請求回來；Skeleton 只是版面輪廓，沒有文字可以收錄。',
      },
      {
        q: '這個元件在 SSR 的頁面上，開發版的 Console 出現 `[Vue warn]: Hydration text content mismatch on <p>`，`rendered on server: 09:00`、`expected on client: 09:01`。比較好的修法是？',
        code: `<script setup>
const now = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <p>現在時間 {{ now }}</p>
</template>`,
        lang: 'vue',
        options: [
          '`now` 先設成 `null`、顯示 `--:--`，到 `onMounted` 才算時間並開始更新',
          '把 `createSSRApp` 改成 `createApp`，讓瀏覽器丟掉伺服器的 HTML 重新渲染',
          '把 `toLocaleTimeString` 換成 `toLocaleString`，伺服器與瀏覽器的格式就會一致',
          '在 `<p>` 加上 `v-once`，讓它只渲染一次，hydration 時就不再比對',
        ],
        answer: 0,
        explain: '伺服器與瀏覽器各渲染一次，「現在時間」在兩個時間點算，結果一定不同。`onMounted` 只在瀏覽器執行，而且在 hydration 之後，兩邊第一次渲染都是 `--:--`，不會不一致。改用 `createApp` 會丟掉伺服器的 HTML 從頭建立 DOM，失去 SSR 的意義；換成 `toLocaleString` 一樣含時間，還多了時區差異；`v-once` 管的是之後的更新，第一次 hydration 照樣比對。',
      },
      {
        q: '團隊用 Nuxt 把「我的掛號」頁設成 `routeRules: { \'/my-appointments\': { swr: 600 } }`。上線後有病患看到別人的掛號紀錄。最可能的原因是？',
        options: [
          'hydration mismatch，Vue 修正 DOM 時把兩個人的資料搞混了',
          '`swr` 把整份 HTML 快取起來，TTL 內送給每個請求這個網址的人',
          '瀏覽器快取了 `index.html`，看到的是上一個登入者的頁面',
          'SSR 在伺服器上讀不到瀏覽器的 cookie，不知道是誰在請求',
        ],
        answer: 1,
        explain: '`swr` 讓伺服器或反向代理快取整個回應，在 TTL 內把同一份 HTML 送給所有請求這個網址的人，含個人資料的頁面就被當成每個人都一樣的內容；它只適合每個人看到的內容都一樣的頁面。個人化的頁面要維持 CSR，或回應 `Cache-Control: private, no-store`、不套用共用快取。hydration mismatch 只會讓 DOM 改成瀏覽器渲染的結果，不會換成別人的資料；SSR 收得到請求的 cookie；`index.html` 被快取不會帶進別人的掛號。',
      },
    ],
  },
  {
    skill: 'browser-support',
    questions: [
      {
        q: '`vite.config.js` 設了 `build.target: \'chrome109\'`，程式用到 `Object.groupBy()`（Chrome 117 起才有）。在 Chrome 109 上會發生什麼事？',
        options: [
          'Vite 依 `build.target` 自動加上 `Object.groupBy` 的 polyfill，正常執行',
          '`vite build` 失敗，提示 `chrome109` 不支援 `Object.groupBy`',
          '建置成功、沒有警告，執行到那一行時丟出 `TypeError`',
          'Vite 依 target 把 `Object.groupBy()` 改寫成 `reduce`，正常執行',
        ],
        answer: 2,
        explain: '`build.target` 只做語法轉換，Vite 的說明寫明它不包含 polyfill。`Object.groupBy` 是執行時才存在的函式，產物裡原樣保留，建置不會失敗，到 Chrome 109 執行那一行才丟出 `TypeError: Object.groupBy is not a function`。要支援就自己改寫，或另外載入 polyfill（例如用 `@vitejs/plugin-legacy` 或 core-js）。',
      },
      {
        q: 'web-features 資料裡 Popover API 的狀態如下。對門診系統來說，這代表什麼？',
        code: `{
  "name": "Popover",
  "status": {
    "baseline": "low",
    "baseline_low_date": "2025-01-27",
    "support": { "chrome": "116", "firefox": "125", "safari": "17", "safari_ios": "18.3" }
  }
}`,
        lang: 'json',
        options: [
          'Widely available：核心瀏覽器支援已滿 30 個月，不必考慮舊版直接用',
          'Newly available：核心瀏覽器都支援了，但舊版 iOS 與 Chrome 沒有',
          'Limited availability：還有核心瀏覽器完全不支援，目前不能在正式環境使用',
          '已被 web-features 標為不建議使用（discouraged），之後會從瀏覽器移除',
        ],
        answer: 1,
        explain: '`baseline: "low"` 是 Newly available，`baseline_low_date` 是它在所有核心瀏覽器（含手機版）都支援的那一天；滿 30 個月才會變成 `"high"`（Widely available）。`support` 列出各瀏覽器的最低版本，舊版 iOS 或停在舊版 Chrome 的院內電腦都不支援，要看使用者的版本。Limited availability 是 `baseline: false`；這裡也沒有任何棄用的標記。',
      },
      {
        q: '專案從 Vite 6 升級到 Vite 8，沒有改任何程式。院內幾台 iPad（Safari 15）打開就白畫面，Console 出現 `SyntaxError`。最可能的原因與處理方式是？',
        options: [
          'Vite 8 的預設 target 提高到 Safari 16.4，要明確設定 `build.target`',
          'iPad 快取了升級前的 `index.html`，清除 Safari 的網站資料就會恢復',
          'Vite 8 改用 Rolldown 後不再支援 iOS 上的 Safari，要換建置工具',
          '在 `main.js` 最上面 `import \'core-js\'` 補上全部 polyfill，語法錯誤就會消失',
        ],
        answer: 0,
        explain: 'Vite 6 預設 `modules`（Chrome 87、Safari 14 起），Vite 8 預設 `baseline-widely-available`（Chrome 111、Safari 16.4 起）。升級主版本等於提高最低支援版本，Safari 16.4 才支援的語法（例如 class 的 static 區塊）不再被改寫，舊版 Safari 解析失敗就整頁空白。快取的 `index.html` 會指向舊檔案，不會產生新的語法錯誤；Vite 8 仍然能為 Safari 15 建置，只是要明確設定；polyfill 補的是 API，補不了語法。',
      },
    ],
  },
  {
    skill: 'frontend-ci',
    questions: [
      {
        q: 'CI 裡安裝套件為什麼用 `npm ci`，不用 `npm install`？',
        options: [
          '`npm ci` 下載比較快，因為它會略過 `devDependencies`',
          '照 lock 檔安裝、不改 lock 檔，兩者對不上就失敗',
          '`npm install` 在 CI 的唯讀檔案系統上無法寫入 `node_modules`',
          '`npm ci` 安裝完會依序執行 `lint` 與 `test` 這兩個 scripts',
        ],
        answer: 1,
        explain: '`npm install` 會在需要時解析新版本並更新 lock 檔，同一個 commit 在不同時間可能裝到不同版本。`npm ci` 先刪掉 `node_modules`，只照 lock 檔安裝，對不上時以 `can only install packages when your package.json and package-lock.json ... are in sync` 失敗，提醒有人忘了 commit lock 檔，每次裝出來的版本都一樣。CI 的檔案系統可以寫入；`npm ci` 預設會安裝 `devDependencies`，也不會執行任何檢查。',
      },
      {
        q: '一個 PR 有型別錯誤，還有三個 ESLint 的 warning。CI 依序執行 `npm run lint` 與 `npm run typecheck`，結果全部綠燈。原因是？',
        code: `{
  "scripts": {
    "lint": "eslint .",
    "typecheck": "vue-tsc --noEmit || true",
    "build": "vite build"
  }
}`,
        lang: 'json',
        options: [
          '`vite build` 會先做型別檢查，所以 `vue-tsc` 的錯誤在這一步被略過',
          'ESLint 預設只檢查 `.js` 檔，`.vue` 檔裡的 warning 與錯誤都不會被抓',
          'GitHub Actions 只把 exit code 1 當失敗，`vue-tsc` 回傳的 2 被忽略',
          '`|| true` 讓型別檢查永遠成功；ESLint 只有 warning 時回傳 0',
        ],
        answer: 3,
        explain: 'CI 只看每一步的 exit code。`vue-tsc` 有錯誤時回傳 2，但 `|| true` 把整行的結果改成成功；ESLint 只有 warning 時本來就回傳 0。拿掉 `|| true`、ESLint 加上 `--max-warnings 0` 才會擋。`vite build` 不做型別檢查；eslint-plugin-vue 會檢查 `.vue` 檔；Actions 對任何非 0 的 exit code 都會讓那一步失敗。',
      },
      {
        q: '自動更新套件的機器人把 `typescript` 從 6.0 升到 7.0 之後，CI 的型別檢查開始失敗，訊息是 `Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath \'./lib/tsc\' is not defined by "exports"`，程式本身沒有改。該怎麼處理？',
        options: [
          '先把 `typecheck` 從 CI 拿掉，等 vue-tsc 更新之後再加回來',
          '刪掉 `package-lock.json` 重新 `npm install`，讓套件重新解析版本',
          '把 `typescript` 固定在 `~6.0`，等 vue-tsc 支援 TypeScript 7 再升級',
          '在 workflow 設 `NODE_OPTIONS=--experimental-modules` 讓 Node 找到舊路徑',
        ],
        answer: 2,
        explain: '這個錯誤來自 vue-tsc 去載入 `typescript/lib/tsc`；TypeScript 7 是原生編譯器，套件裡已經沒有這個 JavaScript 進入點（實測 vue-tsc 3.3.14 搭 TypeScript 7.0.2 失敗，搭 6.0.3 正常）。把主版本固定住並在更新設定裡排除它，是最小的修法。拿掉型別檢查會讓錯誤溜進 main；重建 lock 檔還是會裝到 7.0；Node 的參數和套件的 exports 無關。',
      },
    ],
  },
]

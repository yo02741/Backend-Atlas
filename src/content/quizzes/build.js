// 題庫：建置與部署
export default [
  {
    skill: 'vite-basics',
    questions: [
      {
        q: '`npm run dev` 一切正常，為什麼交付前還要跑 `npm run build`？',
        options: [
          'dev server 把建置結果放在記憶體裡，兩者完全相同，跑 build 只是習慣',
          'dev server 不打包也不做型別檢查，路徑大小寫、建置目標不支援的語法這類錯，只有 build 會暴露',
          '`npm run build` 會順便把網站部署到正式環境',
          'dev server 只支援 Chrome，build 之後才支援其他瀏覽器',
        ],
        answer: 1,
        explain: 'dev server 讓瀏覽器直接載入 ES modules、用到才轉換；`vite build` 才從頭打包、壓縮、依建置目標轉換語法。macOS 不分大小寫的 import 路徑在 Linux 的 CI 上會 `Could not resolve`，Vite 6 的預設目標不支援 top-level await，都只有 build 會失敗。build 不會部署，dev server 也不限瀏覽器。',
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
          '建置成功、沒有警告，但 vendor 沒有切出來：Vite 6 不認得 `rolldownOptions`',
        ],
        answer: 3,
        explain: '`build.rolldownOptions` 是 Vite 8 的選項（打包器換成 Rolldown）。Vite 6 用 Rollup，選項叫 `build.rollupOptions`，切 vendor 用 `manualChunks`。Vite 6 遇到不認得的設定不報錯也不轉換，直接忽略，所以這種錯最難發現。看設定之前先確認安裝的版本。',
      },
      {
        q: '同事想在正式環境的容器裡直接跑 `vite preview` 送前端，理由是「本機預覽都正常」。最主要的問題是？',
        options: [
          '`vite preview` 是本機確認建置結果用的；它對不存在的 `/assets/*.js` 也回 `index.html`，assets 的 `Cache-Control` 是 `no-cache`，和正式環境需要的規則不同',
          '`vite preview` 只能在 macOS 上執行',
          '`vite preview` 每次啟動都會重新建置，要好幾分鐘',
          '`vite preview` 會開啟 HMR，使用者的頁面會自動重新整理',
        ],
        answer: 0,
        explain: 'preview 是方便在本機看 `dist/` 能不能跑的小伺服器，官方說明它不是正式環境用的伺服器。它的 SPA fallback 連 assets 也套用，快取標頭也不是 `index.html` 不快取、assets 長效快取那一套。正式環境用 nginx、CDN 或其他靜態檔伺服器。preview 不重新建置、沒有 HMR、各平台都能跑。',
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
          '不會，`false` 是 falsy',
          '不會，正式建置會略過值是布林的 `VITE_` 變數',
          '會：值是字串 `\'false\'`，非空字串是 truthy；要寫成 `=== \'true\'`',
          '建置失敗，`.env` 不能寫布林值',
        ],
        answer: 2,
        explain: '`.env` 裡的值一律是字串，`false` 讀進來是 `\'false\'`，而非空字串在 `if` 裡是 true。實測 Vite 建置後，這個判斷直接被算成成立。布林與數字要自己轉換，例如 `import.meta.env.VITE_SHOW_DEBUG === \'true\'`；Vite 不會略過或拒絕這種值。',
      },
      {
        q: '前端要呼叫第三方地圖服務，需要一把 API 金鑰。工程師打算寫成 `VITE_MAPS_KEY` 放進 `.env.production`。該怎麼看這件事？',
        options: [
          '可以，只要 `.env.production` 不進版控就安全',
          '改成放在執行時的 `/config.js`，就不會被看到',
          '把變數名稱的 `VITE_` 拿掉，前端程式就能安全地讀到它',
          '`VITE_` 變數會寫進公開的 bundle，誰都讀得到；金鑰放後端由後端代為呼叫，或只用服務商限定網域的瀏覽器金鑰並接受它是公開的',
        ],
        answer: 3,
        explain: '建置之後金鑰就在 `dist/assets/*.js` 裡，打開網頁的人用 Network 分頁就看得到，`.env` 有沒有進版控無關。`config.js` 一樣是公開檔案。拿掉前綴，前端讀到的是 `undefined`，不是安全地讀到。需要保密的金鑰只能留在後端。',
      },
    ],
  },
  {
    skill: 'bundles-chunks',
    questions: [
      {
        q: '為什麼 `assets/` 底下的檔案可以設 `Cache-Control: max-age=31536000, immutable`，`index.html` 卻要 `no-cache`？',
        options: [
          'assets 的檔名帶內容 hash，內容一變檔名就變；`index.html` 檔名固定，又決定要載入哪一版的 chunk',
          'JS 檔比 HTML 小，快取比較省空間',
          '瀏覽器規定 HTML 不能被快取',
          '`immutable` 只能用在 `.js` 與 `.css` 檔',
        ],
        answer: 0,
        explain: '帶 hash 的檔名等於版本號：新版本是新網址，瀏覽器自然會下載，舊網址的內容永遠不變，可以快取一年。`index.html` 沒有 hash，它被快取時使用者一直拿著舊的 `index.html`，一直去要舊的 chunk，所以要每次向伺服器確認。HTML 可以被快取，`immutable` 也不限副檔名。',
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
          '切出 vendor chunk，和 Vite 6 一樣',
          '建置失敗：Rolldown 的 `manualChunks` 只接受函式，先警告 `Expected Function but received Object`，接著 `TypeError: manualChunks is not a function`',
          '設定被忽略，沒有任何訊息',
          'Vite 自動把它轉成 `codeSplitting.groups`',
        ],
        answer: 1,
        explain: 'Rollup 的 `manualChunks` 有物件與函式兩種寫法，Vite 6 都能用。Vite 8 換成 Rolldown，`manualChunks` 只剩函式寫法而且標為 deprecated，物件寫法會讓建置失敗。Vite 8 的新寫法是 `output.codeSplitting: { groups: [{ name: \'vendor\', test: /node_modules/ }] }`。',
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
          '沒有關係，這是 Vite 的 bug',
          '舊的報表 chunk 已經不在，`try_files` 把它也 fallback 成 `index.html`；`/clinic/assets/` 要另外設成找不到就 404，前端再用 `vite:preloadError` 重新載入',
          '`no-cache` 讓瀏覽器拿不到 JS，改成 `immutable` 就好',
          '要在 nginx 加一條設定，把 `.js` 的 MIME type 也設成 `text/html`',
        ],
        answer: 1,
        explain: '這段設定讓所有找不到的路徑都回 `index.html`，包含已經被刪掉的舊 chunk。瀏覽器拿到 HTML 當 JavaScript，拒絕執行。`/clinic/assets/` 用 `try_files $uri =404;` 回 404，錯誤訊息一看就知道是檔案不在；前端監聽 `vite:preloadError` 重新載入，拿到新版。改快取或 MIME type 都不會讓不存在的檔案出現。',
      },
      {
        q: '前端要部署在 `portal.example` 的 `/clinic/` 子路徑，用 history 模式。建置後一打開就白畫面，Console 一排 `/assets/index-*.js` 的 404。要改哪些地方？',
        options: [
          'Vite 設 `base: \'/clinic/\'`，Vue Router 用 `createWebHistory(import.meta.env.BASE_URL)`，伺服器把 dist 放在 `/clinic/` 底下',
          '只要在 nginx 加一條把 `/assets/` 轉到 `/clinic/assets/` 的 rewrite',
          '改用 `base: \'./\'`，history 模式下的深層連結也沒問題',
          '把 `index.html` 改名成 `clinic.html`',
        ],
        answer: 0,
        explain: '`base` 讓建置出的資源網址帶上 `/clinic/`，`BASE_URL` 讓路由知道前綴，伺服器的目錄要對上同一個前綴，三處一致才不會白畫面或深層連結 404。在 nginx 補 rewrite 會搶走入口網站自己的 `/assets/`；`./` 在 history 模式下會讓深層連結的資源路徑算錯；改檔名和路徑無關。',
      },
    ],
  },
]

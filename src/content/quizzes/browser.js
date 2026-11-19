// 題庫：瀏覽器與網頁怎麼運作
export default [
  {
    skill: 'how-browsers-render',
    questions: [
      {
        q: '下列哪一種改動，瀏覽器可以跳過 layout 與 paint，只重跑樣式計算與合成？',
        options: [
          '改一張卡片的 `width`，讓卡片變寬',
          '改一段文字的 `color`，讓文字變紅',
          '改一個已經有自己合成層的元素的 `transform`',
          '在候診清單的最後新增一個 `<li>`',
        ],
        answer: 2,
        explain: '有自己合成層的元素，`transform` 與 `opacity` 的變化由合成器處理，不必重新算版面或重畫。`width` 影響盒子大小，layout、paint、composite 都要重跑；`color` 不改大小，跳過 layout 但仍要重畫；新增節點會改 DOM，後面每一段都要重跑。',
      },
      {
        q: '`analytics.js` 下載要 2 秒。瀏覽器解析到這段 `<head>` 時，HTML 解析會怎樣？',
        code: `<head>
  <link rel="stylesheet" href="/main.css">
  <script src="/analytics.js"></script>
</head>
<body>
  <h1>今日門診</h1>
  …`,
        lang: 'html',
        options: [
          '解析照常進行，`analytics.js` 等整份 HTML 解析完才依序執行',
          '解析停在這個 `<script>`，等它下載並執行完才繼續建後面的 DOM',
          '解析照常進行，`analytics.js` 一下載完就執行，和其他 script 的順序不保證',
          '瀏覽器先略過這個 script，等 `load` 事件之後才開始下載它',
        ],
        answer: 1,
        explain: '沒有 `defer`、`async` 的一般 script 會擋住解析：解析器停在這一行，等它下載、執行完才繼續，而且它還要等前面的 `main.css` 載完才會執行。第一個選項描述的是 `defer`，第三個是 `async`；瀏覽器不會自動把 script 延到 `load` 之後。',
      },
      {
        q: '叫號提示 Toast 從右側滑入時看板會頓一下，Performance 分頁顯示動畫期間每一格都有 `Layout` 與 `Paint`，CSS 寫的是 `transition: right 0.4s`。最直接的修法是？',
        options: [
          '動畫改用 `transform: translateX()` 與 `opacity`，Toast 加 `will-change: transform`',
          '把 `transition` 從 0.4 秒拉長到 1 秒，讓每一格的變化小一點',
          '幫看板上所有卡片都加 `will-change: transform`，讓每張卡片各自成為一層',
          '改用 `setInterval` 每 16 ms 改一次 `right`，自己控制每一格',
        ],
        answer: 0,
        explain: '`right` 會改變元素位置，每一格都要重算 layout 再重畫；`transform` 加上自己的合成層後只需要合成。拉長時間不會減少每一格的工作；所有卡片都加 `will-change` 只會多吃 GPU 記憶體，Toast 仍在改 `right`；`setInterval` 同樣每格觸發 layout，時機還對不上畫面更新。',
      },
    ],
  },
  {
    skill: 'devtools',
    questions: [
      {
        q: 'Network 分頁裡一個 API 請求的狀態欄顯示 `CORS error`，這代表什麼？',
        options: [
          '請求還沒送出，瀏覽器在發出前就判斷網址的格式不合法',
          '伺服器回了 4xx，瀏覽器把所有 4xx 統一顯示成 CORS error',
          '跨來源請求的回應（或預檢回應）少了允許這個來源的 CORS 標頭，瀏覽器不讓 JavaScript 讀取',
          '開發者工具的 `Block request URL` 擋下了這個請求',
        ],
        answer: 2,
        explain: '`CORS error` 表示瀏覽器依 CORS 規則拒絕把回應交給 JavaScript，Console 會同時出現 `has been blocked by CORS policy` 並說明少了哪個標頭，要在後端修。網址不合法或斷線顯示 `(failed)`；4xx 會直接顯示狀態碼；被開發者工具擋下的請求顯示 `(blocked:devtools)`。',
      },
      {
        q: '在 Console 執行這行，數字隨著切換頁面一直增加。最可能的原因是？',
        code: `getEventListeners(window).resize.length
// 第一次進看板頁：1
// 在看板頁與其他頁之間來回切換 5 次後：6`,
        lang: 'js',
        options: [
          '瀏覽器在每次換頁時會自動複製事件監聽，數字增加是正常的',
          '看板元件掛載時在 `window` 加了 `resize` 監聽，卸載時沒有 `removeEventListener`',
          '`getEventListeners` 會把已經移除的監聽也一起算進去',
          '視窗大小改變了 5 次，每次改變都會自動新增一個監聽',
        ],
        answer: 1,
        explain: '`getEventListeners` 是 Chrome Console 專用的函式，列出目前仍掛在物件上的監聽。每切換一次多一個，代表每次掛載都加、卸載時沒移除，舊元件的處理函式還在執行。瀏覽器不會自己複製監聽，已移除的也不會被算進去；改變視窗大小只會觸發監聽，不會新增監聽。',
      },
      {
        q: 'AI 改好「我的掛號」頁後回報「已完成」。驗收時先做哪一件事，最快判斷問題在前端還是後端？',
        options: [
          '先跑 Lighthouse 拿到效能分數，分數夠高就代表功能沒問題',
          '在 Elements 的 Styles 逐條比對 CSS 是否和設計稿一致',
          '用裝置模式切到 390px，看版面有沒有跑掉',
          '先看 Console 有沒有錯誤，再到 Network 篩 `Fetch/XHR` 對照每個操作送出的請求與狀態碼',
        ],
        answer: 3,
        explain: 'Console 告訴你前端程式有沒有出錯，Network 告訴你請求有沒有送、送了什麼、後端回什麼：請求送錯是前端的問題，送對了卻回 `500` 是後端的問題。Lighthouse 的分數不檢查功能是否正確；樣式與寬度要看，但排在確認資料與請求之後。',
      },
    ],
  },
]

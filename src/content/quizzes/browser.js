// 題庫：瀏覽器與網頁怎麼運作
export default [
  {
    skill: 'how-browsers-render',
    questions: [
      {
        q: '下列哪一種改動，瀏覽器可以跳過 layout 與 paint，只重跑樣式計算與合成？',
        options: [
          '改一張卡片的 `width`，從 240px 改成 280px',
          '改一段文字的 `color`，讓過號的號碼變成紅色',
          '改一個已經有自己合成層的元素的 `transform`',
          '在候診清單的最後新增一個 `<li>`，放剛報到的病患',
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
          '改成動 `transform: translateX()` 與 `opacity`',
          '把 `transition` 從 0.4 秒拉長到 1 秒，讓每一格的變化小一點',
          '幫看板上所有卡片都加 `will-change: transform`，讓每張卡片各自成為一層',
          '改用 `setInterval` 每 16 ms 改一次 `right`，自己控制每一格',
        ],
        answer: 0,
        explain: '`right` 會改變元素位置，每一格都要重算 layout 再重畫；`transform` 加上自己的合成層後只需要合成。Toast 可以再加 `will-change: transform`，先給它自己的合成層。拉長時間不會減少每一格的工作；所有卡片都加 `will-change` 只會多吃 GPU 記憶體，Toast 仍在改 `right`；`setInterval` 同樣每格觸發 layout，時機還對不上畫面更新。',
      },
    ],
  },
  {
    skill: 'devtools',
    questions: [
      {
        q: 'Network 分頁裡一個 API 請求的狀態欄顯示 `CORS error`，這代表什麼？',
        options: [
          '請求還沒送出，瀏覽器在發出前就判斷網址的格式不合法，所以沒有狀態碼',
          '伺服器回了 4xx，跨來源請求的 4xx 一律被瀏覽器統一顯示成 CORS error',
          '回應或預檢回應少了允許這個來源的 CORS 標頭，JavaScript 讀不到',
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
          '每次換頁時 Vue Router 會把 `window` 上的監聽複製一份給新頁面，數字增加是正常的',
          '看板元件掛載時加了 `resize` 監聽，卸載時沒有移除',
          '`getEventListeners` 也會列出已經移除、還沒被垃圾回收的監聽',
          '視窗大小改變了 5 次，每次改變都會自動新增一個監聽',
        ],
        answer: 1,
        explain: '`getEventListeners` 是 Chrome Console 專用的函式，列出目前仍掛在物件上的監聽。每切換一次多一個，代表每次掛載都加、卸載時沒移除，舊元件的處理函式還在執行。瀏覽器與 Vue Router 都不會複製監聽，已移除的也不會被算進去；改變視窗大小只會觸發監聽，不會新增監聽。',
      },
      {
        q: 'AI 改好「我的掛號」頁後回報「已完成」。驗收時先做哪一件事，最快判斷問題在前端還是後端？',
        options: [
          '先跑 Lighthouse 的 Performance，分數在 90 以上就代表功能沒有問題',
          '在 Elements 的 Styles 逐條比對 CSS 屬性值是否和設計稿的標註一致',
          '用裝置模式切到 390px 與 1280px，看版面有沒有跑掉或出現橫向捲軸',
          '先看 Console 的錯誤，再到 Network 篩 `Fetch/XHR` 看請求',
        ],
        answer: 3,
        explain: 'Console 告訴你前端程式有沒有出錯，Network 告訴你請求有沒有送、送了什麼、後端回什麼：請求送錯是前端的問題，送對了卻回 `500` 是後端的問題。Lighthouse 的分數不檢查功能是否正確；樣式與寬度要看，但排在確認資料與請求之後。',
      },
    ],
  },
  {
    skill: 'page-loading',
    questions: [
      {
        q: '`<head>` 裡依序有 `<script defer src="/js/jquery.js">` 與 `<script defer src="/js/app.js">`，app.js 依賴 jQuery，而 jquery.js 比較晚下載完。兩支 script 什麼時候執行？',
        options: [
          'app.js 先下載完就先執行，jquery.js 下載完之後才執行，所以會出現 `$ is not defined`',
          'jquery.js 先、app.js 後，都在 HTML 解析完之後、`DOMContentLoaded` 之前',
          '兩支都等圖片也載完、`load` 事件之後才執行，順序依下載完成的先後',
          '解析器停在 jquery.js，等它下載並執行完才繼續往下解析',
        ],
        answer: 1,
        explain: '`defer` 的 script 下載時不擋解析，整份 HTML 解析完才依出現在 HTML 裡的順序執行，執行完才觸發 `DOMContentLoaded`，所以下載的快慢不影響順序。「下載完就先執行」是 `async` 的行為；`defer` 不必等到 `load`；停在 script 等它下載與執行是沒有 `defer`、`async` 的一般 script。',
      },
      {
        q: '載入這個頁面時，Console 出現 `Uncaught TypeError: Cannot read properties of null (reading \'addEventListener\')`，錯誤指向 app.js 的第一行。最合適的修法是？',
        code: `<head>
  <link rel="stylesheet" href="/css/main.css">
  <script src="/js/app.js"></script>
  <!-- app.js 第一行：document.querySelector('#booking-form').addEventListener('submit', onSubmit) -->
</head>
<body>
  <form id="booking-form">…</form>
</body>`,
        lang: 'html',
        options: [
          '在 app.js 前面加 `<link rel="preload" href="/js/app.js" as="script">`',
          '把 `main.css` 移到 app.js 後面，讓 script 早一點執行',
          '幫 app.js 加上 `async`，讓它下載完就立刻執行',
          '幫 app.js 加上 `defer`，或改成 `type="module"`',
        ],
        answer: 3,
        explain: '一般的 script 在 `<head>` 裡執行時，`<body>` 還沒解析，`querySelector` 找不到表單而回傳 `null`。`defer` 與 module script 等 HTML 解析完才執行，表單已經在 DOM 裡。preload 只讓下載提早，執行時機不變；調整 CSS 的位置不影響 DOM 有沒有建好；`async` 下載完就執行，可能仍在解析到表單之前。',
      },
      {
        q: '門診首頁的院區主圖很晚才出現。Network 分頁的 `Priority` 欄顯示這張圖是 `Low`，HTML 是 `<img src="/img/hero.webp" loading="lazy" alt="院區外觀">`。最直接的改法是？',
        options: [
          '拿掉 `loading="lazy"`，改加 `fetchpriority="high"`',
          '為頁面上每一張圖片都加一個 `<link rel="preload" as="image">`',
          '把這個 `<img>` 移到 `<body>` 的最後面，讓其他內容先載入',
          '在 `<img>` 加上 `async`，讓圖片下載時不擋住 HTML 解析',
        ],
        answer: 0,
        explain: '首屏主圖加了 `loading="lazy"`，瀏覽器要等版面算完、確定它在畫面附近才下載；拿掉之後加 `fetchpriority="high"` 讓它一開始就用高優先順序下載，另外寫出 `width` 與 `height`，讓瀏覽器先保留位置。每張圖都 preload 會互相搶頻寬；移到最後只會更晚被發現；`async` 不是 `<img>` 的屬性，圖片本來就不擋解析。',
      },
    ],
  },
  {
    skill: 'dom-events',
    questions: [
      {
        q: '預約清單用事件委派：`ul` 上掛一個 `click` 監聽。使用者點了某一列「取消」按鈕裡的 `<svg>` 圖示，在這個監聽裡 `event.target` 與 `event.currentTarget` 各是什麼？',
        options: [
          '兩個都是 `<button>`，因為事件只會停在可以點的元素上',
          '`target` 是 `<ul>`，`currentTarget` 是 `<svg>`',
          '`target` 是 `<svg>`，`currentTarget` 是 `<ul>`',
          '`target` 是 `<li>`，`currentTarget` 是 `<button>`',
        ],
        answer: 2,
        explain: '`target` 是實際被點到的最內層元素，這裡是按鈕裡的 `<svg>`；`currentTarget` 是目前執行的監聽掛在哪個元素上，委派時就是 `ul`。所以委派時要用 `event.target.closest(\'button\')` 或 `closest(\'[data-id]\')` 往上找，不能直接讀 `target` 的 `dataset`。事件不會自動停在可以點的元素上。',
      },
      {
        q: '`cancelBtn` 是放在 `<form>` 裡、沒寫 `type` 的 `<button>`，它在某一列 `li` 裡面。按下 `cancelBtn` 之後會發生什麼？',
        code: `form.addEventListener('submit', () => console.log('form submit'))
li.addEventListener('click', () => openDetail(12))
cancelBtn.addEventListener('click', (e) => {
  e.stopPropagation()
  cancel(12)
})`,
        lang: 'js',
        options: [
          '只執行 `cancel(12)`：Drawer 不會打開，表單也不會送出',
          '執行 `cancel(12)`，Drawer 不會打開，但表單照樣送出、印出 `form submit`',
          '執行 `cancel(12)` 與 `openDetail(12)`，表單不會送出',
          '`stopPropagation()` 讓這次 click 整個取消，連 `cancel(12)` 也不會執行',
        ],
        answer: 1,
        explain: '`stopPropagation()` 讓 click 不再往上傳到 `li`，所以 `openDetail` 不會執行；但它不取消預設動作，表單裡沒寫 `type` 的 `button` 是送出鈕，click 之後表單照樣送出。要取消送出得另外呼叫 `preventDefault()`，或把按鈕寫成 `type="button"`。`stopPropagation()` 不影響目前這個監聽本身的執行。',
      },
      {
        q: '一個沒有用框架的舊頁面，每次 `fetch` 回新的掛號資料後，程式用迴圈對每個新的 `li` 呼叫 `addEventListener(\'click\', …)`。結果有些列點了沒反應、有些列點一次執行兩次。比較好的改法是？',
        options: [
          '每個 `li` 的監聽裡都呼叫 `stopImmediatePropagation()`，避免同一列執行兩次',
          '把綁定的程式放進 `setTimeout(…, 0)`，等列表畫完再綁',
          '每個 `li` 的監聽都改成 `{ capture: true }`，讓它比較早執行',
          '在 `ul` 上掛一個監聽，用 `event.target.closest(\'li[data-id]\')` 找出被點的那一列',
        ],
        answer: 3,
        explain: '事件委派只在不會被替換的 `ul` 上掛一次監聽，靠冒泡收到每一列的 click，之後新增的列也處理得到，也不會因為重複綁定而執行兩次。`stopImmediatePropagation()` 只是把重複的監聽擋掉，沒解決重複綁定；延後綁定解決不了漏綁與重綁；改成捕獲階段只改變執行的時機。',
      },
    ],
  },
  {
    skill: 'browser-storage',
    questions: [
      {
        q: '掛號表單的草稿：重新整理頁面時要還在，同時開兩個分頁各填各的，關掉分頁就不需要了。放哪裡最合適？',
        options: [
          'localStorage，關掉分頁時再用 `beforeunload` 事件刪掉',
          'sessionStorage',
          '設了 `Max-Age=3600` 的 cookie',
          'IndexedDB 裡的一個 object store',
        ],
        answer: 1,
        explain: 'sessionStorage 以來源加上分頁區分：重新整理還在、每個分頁各一份、關掉分頁就清掉，正好符合需求。localStorage 是所有分頁共用一份，兩個分頁會互相覆蓋，`beforeunload` 也不保證會執行；cookie 會跟著每個請求送到伺服器，而且同樣是分頁共用；IndexedDB 也是分頁共用，還要自己處理清除。',
      },
      {
        q: '執行這段程式後會發生什麼？',
        code: `localStorage.setItem('notify', false)
localStorage.setItem('prefs', { darkMode: true })

const notify = localStorage.getItem('notify')
if (notify) startNotify()

const prefs = JSON.parse(localStorage.getItem('prefs'))`,
        lang: 'js',
        options: [
          '`startNotify()` 不會執行，`prefs` 是 `{ darkMode: true }`',
          '`startNotify()` 不會執行，`JSON.parse` 丟出 `SyntaxError`',
          '`startNotify()` 會執行，`prefs` 是 `{ darkMode: true }`',
          '`startNotify()` 會執行，`JSON.parse` 丟出 `SyntaxError`',
        ],
        answer: 3,
        explain: 'Web Storage 只存字串：`false` 被存成 `\'false\'`，非空字串是真值，所以 `startNotify()` 會執行；物件沒有先 `JSON.stringify`，被存成 `\'[object Object]\'`，`JSON.parse` 丟出 `SyntaxError: "[object Object]" is not valid JSON`。存讀都要經過 `JSON.stringify` 與 `JSON.parse`，並包 `try/catch`。',
      },
      {
        q: '櫃檯的電腦由多位人員共用。目前登入後前端把 access token 與「最近查詢的病患」存在 localStorage，登出只呼叫 `POST /api/logout`。資安檢測指出 token 會被第三方 script 讀走、下一位使用者看得到前一位查過的病患。哪個改法同時處理這兩件事？',
        options: [
          'token 改存 sessionStorage，最近查詢維持 localStorage，關掉分頁 token 就消失',
          'token 先用前端程式裡寫好的金鑰加密，再存回 localStorage，讀取時再解密',
          '改用伺服器設的 `HttpOnly` cookie，最近查詢不寫進儲存，登出時清掉殘留的 key',
          '把 token 的有效期限從 1 小時延長到 8 小時，減少登入次數',
        ],
        answer: 2,
        explain: '`HttpOnly` cookie 讓 JavaScript 讀不到 session，注入的 script 偷不走；病患資料不寫進瀏覽器，登出時再清掉殘留的 key，下一位使用者就看不到。sessionStorage 一樣讀得到，最近查詢也還在；金鑰寫在前端程式裡，讀得到 token 的 script 也讀得到金鑰；延長期限只會讓外洩的 token 能用更久。',
      },
    ],
  },
  {
    skill: 'same-origin-frontend',
    questions: [
      {
        q: '開發中的頁面網址是 `localhost:5173/appointments`（http）。從這個頁面發出的下列請求，哪一個是同源請求？',
        options: [
          '`fetch(\'/api/appointments\')`，相對路徑',
          '`localhost:8000/api/appointments`（http）',
          '`127.0.0.1:5173/api/appointments`（http）',
          '`localhost:5173/api/appointments`，但改用 https',
        ],
        answer: 0,
        explain: 'origin 是 scheme、主機、port 三者的組合。相對路徑以目前頁面為基準，解析後三者都相同，是同源。`localhost:8000` 的 port 不同；`127.0.0.1` 和 `localhost` 是不同的主機名稱，即使指向同一台電腦；http 改 https 是 scheme 不同。',
      },
      {
        q: '前端呼叫另一個網域的 API，程式與 Console 訊息如下。應該怎麼修？',
        code: `const res = await fetch(\`\${API_BASE}/me\`, { credentials: 'include' })
// Console:
// Access to fetch at '…/me' from origin '…' has been blocked by CORS policy:
// The value of the 'Access-Control-Allow-Origin' header in the response must not be
// the wildcard '*' when the request's credentials mode is 'include'.`,
        lang: 'js',
        options: [
          '前端改成 `mode: \'no-cors\'`，瀏覽器就不檢查 CORS，帶著 cookie 也讀得到回應',
          '後端比對白名單、回傳確切的 origin，並回 `Access-Control-Allow-Credentials: true`',
          '前端在 `fetch` 的 `headers` 加上 `Access-Control-Allow-Origin: *` 與 `Allow-Credentials: true`',
          '前端把 `credentials` 改成 `same-origin`，cookie 一樣會帶上',
        ],
        answer: 1,
        explain: '帶 cookie 的跨來源請求，回應的 `Access-Control-Allow-Origin` 不能是 `*`，必須是確切的 origin，還要有 `Allow-Credentials: true`，這是伺服器的設定。`no-cors` 得到的是讀不到內容的 opaque 回應；`Access-Control-Allow-Origin` 是回應標頭，前端加在請求上沒有作用；`same-origin` 在跨來源時不會帶 cookie。',
      },
      {
        q: '本機開發時前端跑在 port 5173、後端在 port 8000，正式環境前端與 API 在同一個網域，API 路徑都以 `/api` 開頭。後端還沒設定 CORS。開發環境最合適的做法是？',
        options: [
          '程式裡寫死 port 8000 的完整網址，請後端把 CORS 設成允許所有來源 `*`，上線時再換網址',
          '開發時裝一個停用 CORS 的瀏覽器擴充功能，程式照樣寫 port 8000 的完整網址',
          '所有請求加上 `mode: \'no-cors\'`，避免 Console 出現 CORS 錯誤',
          '在 Vite 的 `server.proxy` 把 `/api` 轉給 port 8000，程式一律用相對路徑 `/api/…`',
        ],
        answer: 3,
        explain: 'proxy 讓瀏覽器只看到 5173 這個來源，請求是同源的，不需要 CORS；程式用相對路徑，部署到同網域的正式環境不用改。寫死完整網址到了正式環境會失效，允許所有來源也帶不了 cookie；擴充功能只在自己的瀏覽器有效；`no-cors` 讓回應完全讀不到。',
      },
    ],
  },
  {
    skill: 'urls-history',
    questions: [
      {
        q: '在 SPA 裡執行 `history.pushState({}, \'\', \'/appointments/42\')` 之後，下列哪一個描述正確？',
        options: [
          '網址列變成 `/appointments/42`，新增一筆瀏覽紀錄，不向伺服器發請求，也不觸發 `popstate`',
          '網址列變成 `/appointments/42`，換掉目前這一筆紀錄，並觸發 `popstate` 讓路由重新渲染畫面',
          '瀏覽器向伺服器要 `/appointments/42`，拿到 HTML 後整頁重新載入',
          '網址列不變，直到使用者按上一頁時才換成 `/appointments/42`',
        ],
        answer: 0,
        explain: '`pushState` 只改網址列並新增一筆紀錄，不載入頁面、不觸發 `popstate`；畫面要由程式（例如 Vue Router）自己換。換掉目前這一筆的是 `replaceState`；`popstate` 只在使用者按上一頁、下一頁時觸發；整頁重新載入是 `location.assign()` 或一般連結的行為。',
      },
      {
        q: '兩種寫法組出的網址，用 `new URL(網址, location.origin).searchParams.get(\'dept\')` 讀回來各是什麼？',
        code: `const dept = '耳鼻喉&頭頸'
const a = '/appointments?dept=' + dept + '&page=2'
const b = '/appointments?' + new URLSearchParams({ dept, page: 2 })`,
        lang: 'js',
        options: [
          '兩個都是 `耳鼻喉&頭頸`',
          'a 是 `耳鼻喉&頭頸`，b 是 `耳鼻喉%26頭頸`',
          'a 是 `耳鼻喉`，b 是 `耳鼻喉&頭頸`',
          'a 是 `耳鼻喉`，b 是 `null`',
        ],
        answer: 2,
        explain: 'a 是手動拼接，`&` 沒有編碼，被當成參數之間的分隔，`dept` 只剩「耳鼻喉」，「頭頸」變成一個沒有值的參數。`URLSearchParams` 會把 `&` 編成 `%26`、中文也一併編碼，讀回來時自動解碼，得到原本的字串。讀取時拿到的是解碼後的值，不會是 `%26`。',
      },
      {
        q: 'Vue 專案用 `createWebHistory()`，本機的 `vite` 與 `vite preview` 都正常。部署到 nginx 後，在 `/appointments/42` 按重新整理出現 `404 Not Found`。正確的處理是？',
        options: [
          '把 Vite 的 `appType` 改成 `mpa`，讓每個路由在建置時各產生一個 HTML 檔',
          '伺服器對找不到的路徑回 `index.html`，不能設定伺服器時改用 hash 模式',
          '改用 `createMemoryHistory()`，讓網址不再出現在網址列',
          '在 `index.html` 加上 `<base href="/appointments/">`',
        ],
        answer: 1,
        explain: '重新整理時瀏覽器向伺服器要 `/appointments/42`，伺服器上沒有這個檔案；SPA fallback 讓它回 `index.html`，前端路由再接手；`/assets/` 底下找不到的檔案仍要回 404，不能回 HTML。`vite` 與 `vite preview` 預設就有這個 fallback，所以本機測不出來。`mpa` 不會替動態路由產生 HTML；memory history 讓網址失去意義、上一頁也不能用；改 `<base>` 只會讓所有資源的相對路徑錯掉。',
      },
    ],
  },
  {
    skill: 'frontend-security',
    questions: [
      {
        q: '`note` 的值是 `<img src=x onerror=alert(1)>`。下面四種寫法，哪幾種會執行 `onerror`？',
        code: `<p>{{ note }}</p>            <!-- ① -->
<p :title="note">備註</p>     <!-- ② -->
<div v-html="note"></div>     <!-- ③ -->
<p v-text="note"></p>         <!-- ④ -->`,
        lang: 'vue',
        options: [
          '只有 ③',
          '① 和 ③，插值與 `v-html` 都會解析 HTML',
          '③ 和 ④，`v-text` 等同 `innerHTML`',
          '都不會，Vue 會跳脫所有綁定',
        ],
        answer: 0,
        explain: '`{{ }}` 與 `v-text` 用 `textContent`，標籤原樣顯示成文字；`:title` 是屬性值，引號會被處理。只有 `v-html` 把字串當 HTML 解析，建出的 `<img>` 載入失敗時執行 `onerror`。Vue 不會跳脫 `v-html`，也不檢查 `:href` 這類網址屬性的 scheme。',
      },
      {
        q: '醫師個人頁要把 API 給的網址顯示成連結。哪一種檢查擋得住 `javascript:` 網址？',
        options: [
          '先做 HTML 跳脫（把 `<`、`>`、`"`、`&` 換成實體）再綁到 `:href`',
          '用 `new URL()` 解析，`protocol` 是 `https:` 才當成連結',
          '用 `raw.startsWith()` 檢查是否以 `javascript:` 開頭，是的話就改成顯示純文字',
          '連結加上 `target="_blank" rel="noopener"`，新分頁裡就不能執行程式',
        ],
        answer: 1,
        explain: '`javascript:alert(1)` 沒有任何要跳脫的字元，HTML 跳脫之後原樣不變。只比對開頭會漏掉 `  JavaScript:…` 這種前面有空白、大小寫混用的寫法；`new URL()` 會去掉空白並把 scheme 轉成小寫，再用允許清單比對。`noopener` 只切斷新分頁與原頁面的 `window.opener`，和 `javascript:` 網址無關。',
      },
      {
        q: '正式環境加上 `Content-Security-Policy: script-src \'self\'` 之後，Console 出現下面的訊息。該怎麼修？',
        code: `Executing inline event handler violates the following Content Security Policy directive 'script-src 'self''. Either the 'unsafe-inline' keyword, a hash ('sha256-...'), or a nonce ('nonce-...') is required to enable inline execution. Note that hashes do not apply to event handlers, style attributes and javascript: navigations unless the 'unsafe-hashes' keyword is present. The action has been blocked.`,
        lang: 'http',
        options: [
          '在 `script-src` 加上 `\'unsafe-inline\'`，讓 inline 程式碼都能執行',
          '改送 `Content-Security-Policy-Report-Only`，錯誤就不會再出現',
          '在那個 `<button>` 加上伺服器每次產生的 `nonce` 屬性，和 CSP 標頭的 nonce 對上',
          '把 HTML 裡的 `onclick="…"` 改成 Vue 的 `@click` 或 `addEventListener`',
        ],
        answer: 3,
        explain: '訊息說被擋的是 inline event handler，也就是 HTML 屬性裡的 `onclick="…"`。改成事件處理函式就符合 `script-src \'self\'`。加 `\'unsafe-inline\'` 等於讓注入的 `onerror` 也能執行；Report-Only 只是不阻擋，問題還在；`nonce` 只適用於 `<script>` 與 `<style>` 元素，對事件屬性沒有作用。',
      },
    ],
  },
]

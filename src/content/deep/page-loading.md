## 從一個具體問題開始：白畫面停了三秒

門診網站的首頁在醫院的 Wi-Fi 下打開，白畫面停了將近三秒才出現內容，院區照片又再晚一秒才跑出來。`<head>` 是這樣寫的：

```html
<head>
  <link rel="stylesheet" href="/css/main.css">
  <link rel="stylesheet" href="/css/print.css">
  <script src="/js/jquery.min.js"></script>
  <script src="/js/analytics.js"></script>
  <script src="/js/chat-widget.js"></script>
  <script src="/js/app.js"></script>
</head>
<body>
  <img src="/img/hero.webp" loading="lazy" alt="院區外觀">
  …
```

用 Performance 分頁的 `Record and reload` 錄一次載入，加上 Network 節流 `Slow 4G`，可以看到三件事：

1. Main 軌道上的 `Parse HTML` 被切成五段，中間夾著四段 `Evaluate script`。四支 script 都沒有 `defer` 或 `async`，解析器每遇到一支就停下來等它下載、執行；客服聊天的 `chat-widget.js` 來自另一個網域，光下載就花了一秒多。
2. Insights 的 `Render-blocking requests` 除了那四支 script，還列出 `main.css` 與 `print.css`。列印樣式沒寫 `media="print"`，瀏覽器把它當成畫面要用的樣式，等它載完才畫第一個畫面。
3. `hero.webp` 在 Network 分頁的 `Priority` 欄是 `Low`，而且等版面算完才開始下載；`LCP request discovery` 這個 insight 提示 `LCP resources shouldn’t use loading=lazy`。

三個問題各自對應瀏覽器載入頁面的一條規則：樣式表擋住第一個畫面、一般的 script 擋住解析、圖片的下載有先後順序。

## 運作原理

### 邊收邊解析

瀏覽器不等整份 HTML 下載完。收到一段就解析一段，把標籤變成 DOM 節點；遇到 `<link>`、`<script src>`、`<img>` 就送出請求。解析器因為 script 停下來的時候，另一個叫 preload scanner 的元件會繼續往後掃描還沒解析的 HTML，提早送出後面那些資源的請求。所以資源在 HTML 裡出現得越早，越早開始下載；JavaScript 執行之後才插入的資源，preload scanner 看不到。

### 兩種「擋」

| 資源 | 擋 HTML 解析嗎 | 擋第一個畫面嗎 | 說明 |
|---|---|---|---|
| `<head>` 裡的 `<link rel="stylesheet">` | 不擋 | 擋 | 後面的一般 script 要等它載完才執行 |
| `<link rel="stylesheet" media="print">` | 不擋 | 不擋 | 照樣下載，優先順序較低 |
| `<script src>` | 擋 | 擋（後面的 DOM 出不來） | 下載、等前面的樣式表、執行，三者都完成才繼續解析 |
| `<script defer src>` | 不擋 | 不擋 | 解析完才依出現順序執行 |
| `<script async src>` | 執行的那一刻擋 | 依執行時機 | 下載完就執行，多支之間順序不保證 |
| `<script type="module" src>` | 不擋 | 不擋 | 預設和 `defer` 相同；`import` 的模組也要下載完才執行 |
| `<img>` | 不擋 | 不擋 | 下載完再畫上去；沒寫寬高會讓版面跳動 |

樣式表擋第一個畫面，是為了不先畫出沒有樣式的內容再跳一次。一般的 script 擋解析，是因為它可能用 `document.write` 寫入 HTML、或讀取還沒建好的 DOM，瀏覽器只好停下來等。它還要等前面的樣式表，因為 script 可能讀取元素的樣式（例如 `getComputedStyle`）。

### 四種 script 的時間線

下面是同一支 script 用四種寫法時，解析（`=`）、下載（`-`）、執行（`#`）的先後。時間是示意：

```
時間 →                0         10        20        30        40
一般 <script>   解析   ======|                 |===========
               下載         ------------
               執行                     ####
defer          解析   ================================
               下載         ------------
               執行                                     ####   ← 解析完才執行
async          解析   ===================|    |=========
               下載         ------------
               執行                     ####                   ← 下載完立刻執行
type="module"  和 defer 相同；加上 async 就和 async 相同
```

- 一般 script：解析在 script 的位置停住，等下載與執行都完成。
- `defer`：下載和解析同時進行，執行排在解析結束之後，多支 `defer` 依照在 HTML 裡出現的順序執行。
- `async`：下載完的那一刻就執行，可能在解析中途、也可能在解析結束後；兩支 `async` 誰先下載完誰先跑。
- `type="module"`：瀏覽器還要下載它 `import` 的所有模組，整棵依賴樹都下載完才執行。依賴一層層往下時，瀏覽器要等上一層下載並解析完，才知道下一層要抓什麼。

`defer` 與 `async` 只對有 `src` 的一般 script 有作用，寫在行內 script 上會被忽略；用 JavaScript 建立再插入的 script 預設就是 async 的行為。

### DOMContentLoaded 與 load

頁面載入過程的幾個時間點，依先後順序：

1. 解析 HTML，遇到一般 script 就停下來執行。`document.readyState` 是 `'loading'`。
2. 解析結束，`readyState` 變成 `'interactive'`。
3. 依序執行所有 `defer` 與 module script。
4. 觸發 `DOMContentLoaded`。
5. 圖片、iframe、樣式表等資源全部載完，`readyState` 變成 `'complete'`。
6. 觸發 `load`。

`async` script 在第 1 到第 5 步之間任何時候都可能執行，所以它可能在 `DOMContentLoaded` 之前或之後。Network 分頁最下面的狀態列會顯示這次載入的 `DOMContentLoaded` 與 `Load` 時間。

### 下載的優先順序

瀏覽器會替每個請求排優先順序：`<head>` 裡的樣式表與 script 最高；圖片預設較低，Chrome 要等算完版面、知道圖片在畫面內，才把它調高（各瀏覽器的規則不完全相同）。三個屬性可以改變這個順序：

| 寫法 | 作用 | 用在哪裡 |
|---|---|---|
| `<img fetchpriority="high">` | 一開始就用高優先順序下載 | 首屏最大的那張圖（通常是 LCP 元素） |
| `<img loading="lazy">` | 等圖片接近畫面時才下載 | 首屏以下的圖片；首屏的主圖不能加 |
| `<link rel="preload" href as>` | 提早下載晚才會被發現的資源 | CSS 裡指定的字型、JS 才會插入的主圖 |
| `<link rel="modulepreload">` | 提早下載並解析 module | 入口依賴的 chunk（Vite 自動加） |

`fetchpriority` 在 2024 年 10 月成為 Baseline（Chrome 103、Firefox 132、Safari 17.2 起支援）。字型的 preload 要加 `crossorigin`：字型一律用 CORS 模式下載，preload 沒加 `crossorigin` 時兩個請求的模式不同，瀏覽器用不到預先下載的那一份，同一個字型會下載兩次。

### SPA 的首屏

Vue 的 SPA 把畫面交給 JavaScript 畫。`index.html` 只有一個空的 `<div id="app">`，第一個有內容的畫面要等：入口 JS 下載與解析 → 執行並掛載 Vue → 元件呼叫 API → 資料回來再渲染。入口 JS 越大，白畫面越久；常見的做法是把不在首頁的路由改成懶載入（`() => import('./views/Report.vue')`），讓入口只帶首頁要的程式。更進一步是在伺服器先把 HTML 產生好（SSR 或 SSG）。

## 實際程式碼

### 修好的 `<head>`

```html
<head>
  <!-- 字型在 CSS 裡才被發現：提早下載，crossorigin 不能省 -->
  <link rel="preload" href="/fonts/clinic-sans.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/css/main.css">
  <!-- 列印時才用：照樣下載，但不擋第一個畫面 -->
  <link rel="stylesheet" href="/css/print.css" media="print">
  <!-- app.js 依賴 jQuery：兩支都用 defer，保證依出現順序執行 -->
  <script defer src="/js/jquery.min.js"></script>
  <script defer src="/js/app.js"></script>
  <!-- 獨立的分析工具：async，誰先下載完都沒關係 -->
  <script async src="/js/analytics.js"></script>
</head>
<body>
  <!-- 首屏主圖：高優先順序、不 lazy，寬高讓瀏覽器先留好位置 -->
  <img src="/img/hero.webp" fetchpriority="high" width="1200" height="600" alt="院區外觀">
  …
  <img src="/img/doctor-wang.webp" loading="lazy" width="240" height="240" alt="王醫師">
  <script>
    // 客服聊天不影響首屏：等 load 之後才插入
    window.addEventListener('load', () => {
      const s = document.createElement('script')
      s.src = 'https://chat.example/widget.js'
      document.body.append(s)
    })
  </script>
</body>
```

改完之後再錄一次：`Parse HTML` 一路解析到底，`Render-blocking requests` 只剩 `main.css`，`hero.webp` 的 `Priority` 是 `High` 並且和 CSS 同時開始下載。

### Vite 建置出的 `index.html`

開發時寫的是 `<script type="module" src="/src/main.js">`。`vite build` 之後的 `index.html` 長這樣（檔名的 hash 每次建置都不同）：

```html
<head>
  <script type="module" crossorigin src="/assets/index-BIIqQslc.js"></script>
  <link rel="modulepreload" crossorigin href="/assets/vendor-DYQoPpps.js">
  <link rel="stylesheet" crossorigin href="/assets/index-W1erjkBN.css">
</head>
<body>
  <div id="app"></div>
</body>
```

- 入口被移進 `<head>`：它是 module，行為和 `defer` 相同，不擋解析。
- 入口 `import` 的其他 chunk（這裡是 `vendor`）寫成 `modulepreload`，和入口同時下載，不必等入口解析完才發現。
- 樣式表照樣擋第一個畫面；不過 SPA 的畫面本來就要等 JS，影響不大。
- 路由懶載入的 chunk 不在這裡，要切到那個路由時才下載。

建置出的 `dist/index.html` 不能直接用檔案總管雙擊打開：網址變成 `file://`，module script 會被瀏覽器擋下。用 `npx vite preview` 或任何 HTTP 伺服器開。

### 在 Console 觀察時間點

在頁面最前面加一段行內 script，或打開 Console 後重新整理（Console 要先勾 `Preserve log`，新版 Chrome 叫 `Keep log`）：

```js
// 各時間點距離這次導覽開始幾毫秒
console.log('readyState', document.readyState, performance.now().toFixed(0), 'ms')
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOMContentLoaded', performance.now().toFixed(0), 'ms')
})
window.addEventListener('load', () => {
  console.log('load', performance.now().toFixed(0), 'ms')
  // 每個資源各花了多久：只看 script 與 CSS
  for (const r of performance.getEntriesByType('resource')) {
    if (['script', 'link', 'css'].includes(r.initiatorType)) {
      console.log(r.name.split('/').pop(), Math.round(r.startTime), '→', Math.round(r.responseEnd), 'ms')
    }
  }
})
```

## 常見錯誤與錯誤訊息

| 錯誤訊息或現象 | 原因 | 修法 |
|---|---|---|
| `Uncaught TypeError: Cannot read properties of null (reading 'addEventListener')` | `<head>` 裡的一般 script 執行時，`<body>` 還沒解析，`querySelector` 回傳 `null` | 加 `defer`，或改成 `type="module"` |
| `Uncaught ReferenceError: $ is not defined` | 依賴 jQuery 的 script 用了 `async`，比 jQuery 先執行 | 有依賴關係的 script 都改用 `defer` |
| `Uncaught SyntaxError: Cannot use import statement outside a module` | 用了 `import` 的檔案沒有 `type="module"` | 加上 `type="module"` |
| `Access to script at 'file:///…' from origin 'null' has been blocked by CORS policy` | 直接用檔案打開建置後的 `index.html` | 用 `vite preview` 或 HTTP 伺服器開 |
| `The resource … was preloaded using link preload but not used within a few seconds from the window's load event` | preload 的 `as` 寫錯、少了 `crossorigin`，或頁面沒用到 | 改正屬性，或拿掉這個 preload |
| `Failed to execute 'write' on 'Document': It isn't possible to write into a document from an asynchronously-loaded external script unless it is explicitly opened.` | 舊的第三方 script 用 `document.write`，卻被改成 `async` 載入 | 換成供應商的非同步版本 |
| Network 分頁同一個 `.woff2` 出現兩次 | 字型的 preload 少了 `crossorigin` | 補上 `crossorigin` |
| 首屏主圖的 `Priority` 是 `Low`，很晚才出現 | 主圖加了 `loading="lazy"`，或由 JS 插入 | 拿掉 `lazy`，加 `fetchpriority="high"` |

「`defer` 之後畫面沒變快」也很常見：SPA 的內容本來就要等 JS 執行，`defer` 只讓解析不被擋住。這時要看的是入口 JS 的大小與 API 的回應時間，不是 script 的屬性。

## 動手

1. 打開 [渲染管線實驗室](#/lab/RenderPipelineLab)，切換「`<head>` 的 script 沒有 `defer`」，對照上面的時間線，看解析在哪裡停下、第一個畫面往後延了多少。
2. 找一個常用的網站，Network 分頁設 `Slow 4G` 並勾 `Disable cache`，在欄位標題按右鍵加上 `Priority` 與 `Render-blocking` 欄，重新整理後排序，看哪些資源擋住了第一個畫面、主圖的優先順序是什麼。
3. 用 Performance 分頁的 `Record and reload` 錄同一個網站，展開 Insights 的 `Render-blocking requests` 與 `LCP request discovery`，對照上面的表找出原因。
4. 在自己的 Vite 專案跑 `npx vite build`，打開 `dist/index.html`，找出入口 module、`modulepreload` 與樣式表，再把一個路由改成懶載入、重新建置，看 `assets/` 多出哪個 chunk。
5. 接著讀 [開發者工具：驗收前端的固定路線](#/skill/devtools)，把「擋住第一個畫面的資源」放進每次驗收的檢查項目。

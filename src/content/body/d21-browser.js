// 前端路線：瀏覽器與網頁怎麼運作 的技能內文（以技能 id 為 key）
export default {
  'how-browsers-render': {
    map: {
      names: [
        { n: 'DOM', t: 'HTML 解析出來的節點樹，JavaScript 透過它讀寫畫面。解析器遇到沒有 `defer`、`async` 的 `<script>` 會停下來，等它下載並執行完才繼續往下建。' },
        { n: 'CSSOM', t: '所有樣式表解析後的規則。CSS 會擋住渲染（render-blocking）：`<head>` 裡的樣式表還沒載完，瀏覽器不畫第一個畫面，避免先畫出沒有樣式的內容再跳一次。' },
        { n: 'render tree', t: 'DOM 加上每個節點計算後的樣式，只留要畫的節點（Chrome 的文件叫 layout tree）。`display: none` 的元素不在裡面；`visibility: hidden` 的在，佔位置但不畫。' },
        { n: 'layout（reflow）', t: '算出每個盒子的位置與大小。改 `width`、`padding`、`font-size`、增刪節點都會讓它重跑；改了樣式後馬上讀 `offsetHeight`，會強迫瀏覽器當場重算（forced reflow）。' },
        { n: 'paint', t: '把文字、顏色、背景、邊框、陰影畫成像素（先記錄成繪製指令，再點陣化）。只改 `color`、`background-color` 時跳過 layout，從這一段開始重跑。' },
        { n: 'composite（合成）與合成層', t: '把各個圖層依疊放順序組成最後的畫面，由合成器執行緒（compositor thread）負責。元素已經有自己的合成層時（例如設了 `will-change: transform`），改 `transform`、`opacity` 只需要重跑這一段。' },
        { n: '`defer` 與 `async`', t: '讓 `<script>` 下載時不擋 HTML 解析。`defer` 等解析完才依出現順序執行；`async` 下載完就執行，順序不保證；`type="module"` 預設的行為和 `defer` 相同。' },
      ],
      ask: [
        '動畫與轉場動哪些屬性：位移與縮放用 `transform`、淡入淡出用 `opacity`，不拿 `top`、`left`、`width`、`height` 做動畫。',
        '要隱藏的元素保不保留位置：保留用 `visibility: hidden`，整個拿掉用 `display: none`（Vue 的 `v-if` 則連 DOM 節點都不建）。',
        '`<head>` 裡每個 script 用 `defer`、`async` 還是 `type="module"`，以及哪些 CSS 必須在第一個畫面之前載完。',
        '一次更新大量節點時的寫法：先讀完所有需要的尺寸再一次寫入，不在迴圈裡讀一次寫一次。',
        '效能用什麼條件量：Performance 分頁錄製時的 CPU 降速（例如 `4× slowdown`）與網路節流（例如 `Slow 4G`），以及要看的事件。',
      ],
      prompt: '門診看板 `ClinicBoard` 的叫號提示 Toast 從右側滑入：`transition` 只動 `transform: translateX()` 與 `opacity`，不改 `right`，Toast 設 `will-change: transform`。已取消的掛號用 `display: none` 從清單拿掉；目前沒有叫號時，號碼欄位用 `visibility: hidden` 保留位置，叫號時版面不跳動。`<head>` 裡的 `analytics.js` 加 `defer`。每 30 秒更新 20 個診間的候診人數時，先算好全部資料再一次寫進 DOM，迴圈裡不讀 `offsetHeight`。',
      verify: [
        { c: '動畫只走合成', t: 'Performance 分頁錄一次 Toast 滑入：動畫期間 Main 軌道每一格都出現 `Layout` 與 `Paint`，代表動畫改的是 `right` 或 `width`，不是 `transform`。' },
        { c: '重繪範圍', t: '打開 Rendering 面板（主選單 More tools → Rendering）勾 `Paint flashing`，被重繪的區域會閃綠色：更新候診人數時只有數字那一小塊在閃才對，整個清單都在閃代表一個小改動讓大範圍重繪。' },
        { c: '合成層數量', t: 'Rendering 面板勾 `Layer borders`，或開 Layers 分頁：Toast 是獨立的一層；每張卡片都變成一層，代表 `will-change` 加太多，會多吃 GPU 記憶體。' },
        { c: '強制同步 layout', t: 'Performance 分頁的 Insights 出現 `Forced reflow`，或點開 `Layout` 事件看到 `Forced reflow is a likely performance bottleneck`：程式在改樣式之後馬上讀了 `offsetHeight`、`getBoundingClientRect()` 這類尺寸。' },
        { c: 'script 擋住解析', t: '用 Performance 分頁的 `Record and reload` 錄一次載入：Main 軌道上的 `Parse HTML` 被一段 `Evaluate script` 切開，代表 `<head>` 裡有沒加 `defer` 的 script。' },
      ],
    },
    points: [
      { b: '七段管線', t: '取得 HTML → 解析成 DOM → 解析 CSS 成 CSSOM → 合成 render tree → layout 算位置與大小 → paint 畫成像素 → composite 把圖層疊成畫面。首次載入每一段都跑，之後的更新從被改到的那一段往後重跑。' },
      { b: '改什麼重跑什麼', t: '改 `width`、`margin`、`font-size` 或增刪節點：layout、paint、composite 都要重跑。只改 `color`、`background-color`：跳過 layout。改有自己合成層的元素的 `transform`、`opacity`：只重跑合成，主執行緒在忙時動畫也順。' },
      { b: 'CSS 擋渲染、script 擋解析', t: '`<head>` 的樣式表沒載完不會畫第一個畫面；沒有 `defer`、`async` 的 `<script>` 讓 HTML 解析停下來等它下載與執行，而且它還要等前面的 CSS 載完才會執行。' },
      { b: '`display: none` 與 `visibility: hidden`', t: '前者不進 render tree、不佔位置，切換時周圍的版面要重新 layout；後者還在 render tree，佔位置只是不畫。Vue 的 `v-show` 切的是 `display`，`v-if` 連 DOM 節點都不建。' },
      { b: '讀寫交錯會強迫同步 layout', t: '改了樣式後馬上讀 `offsetHeight`、`getBoundingClientRect()`，瀏覽器只好當場把 layout 算完再回答；迴圈裡交錯讀寫就會重算很多次（layout thrashing）。先全部讀、再全部寫。' },
    ],
    checklist: [
      '能說出從收到 HTML 到畫面出現的七個階段，以及 `<script>` 沒有 `defer` 時解析在哪裡停下',
      '能判斷改 `color`、改 `width`、改 `transform`、新增節點各要重跑哪幾段',
      '能用 Performance 分頁與 Rendering 面板找出動畫或互動有沒有觸發 layout 或大範圍重繪',
    ],
    refs: [
      { label: 'web.dev：Rendering performance', url: 'https://web.dev/articles/rendering-performance' },
      { label: 'web.dev：Stick to compositor-only properties and manage layer count', url: 'https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count' },
      { label: 'MDN：will-change', url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/will-change' },
      { label: 'HTML Standard：Parsing HTML documents', url: 'https://html.spec.whatwg.org/multipage/parsing.html' },
    ],
  },
  'devtools': {
    map: {
      names: [
        { n: 'Elements', t: 'DOM 樹與每個元素套到的 CSS。Styles 看哪條規則被劃掉、Computed 看最後的值與盒模型、`:hov` 強制 `:hover` 或 `:focus-visible` 狀態、Event Listeners 看綁了哪些事件。' },
        { n: 'Console', t: 'JavaScript 錯誤、警告（包含 `[Vue warn]`）與自己印的 log；也能直接執行程式，`$0` 是 Elements 目前選取的元素。' },
        { n: 'Network', t: '每個請求的方法、狀態碼、標頭、Payload、回應與時間。`Fetch/XHR` 篩出 API 請求，`Disable cache` 停用快取，節流選單模擬 `Slow 4G`、`3G`、`Offline`。' },
        { n: 'Application', t: 'cookie（含 `HttpOnly`、`Secure`、`SameSite`）、localStorage、sessionStorage、IndexedDB、Service Worker；`Clear site data` 一次清掉這個網站存的東西。' },
        { n: 'Performance', t: '錄下一段時間主執行緒在做什麼：執行 script、`Layout`、`Paint`、長任務；可以加 CPU 降速模擬較慢的手機。' },
        { n: 'Lighthouse', t: '對頁面跑效能、無障礙、最佳做法、SEO 的自動檢查，產生分數與待修項目清單。' },
        { n: '裝置模式（Device Mode）', t: '`Toggle device toolbar` 把頁面切成指定的寬度並模擬觸控，用來看 390、768、1280 三種寬度。' },
        { n: 'Vue DevTools', t: '另外安裝的瀏覽器擴充功能，看元件樹、props、Pinia store 與目前路由；這些 Chrome DevTools 本身看不到。' },
      ],
      ask: [
        '驗收要切過的狀態：載入中、成功、空資料、錯誤，以及按鈕的 hover、focus、disabled。',
        '要在哪些寬度看：至少 390、768、1280，各寬度的版面差異。',
        '網路條件：`Slow 4G` 或 `Offline` 時畫面長怎樣、請求失敗時顯示什麼。',
        'Console 的標準：不能有紅色錯誤與 `[Vue warn]`，允許的警告要列出來。',
        '每個操作預期送出的請求：方法、路徑、次數與 body，例如送出掛號只送一次 `POST`。',
      ],
      prompt: '驗收「我的掛號」頁：在 390、768、1280 三個寬度各看一次。Network 分頁勾 `Disable cache`、篩 `Fetch/XHR`：進頁只送一次 `GET /api/appointments?page=1`，取消掛號只送一次 `POST /api/appointments/{id}/cancel`；節流切到 `Offline` 時畫面顯示錯誤訊息與「重試」按鈕。Console 不能有紅色錯誤或 `[Vue warn]`；Application 分頁裡的 session cookie 要帶 `HttpOnly` 與 `Secure`。',
      verify: [
        { c: '請求次數', t: 'Network 分頁篩 `Fetch/XHR` 後重新整理：同一支 API 出現兩次，常見原因是 `watch` 加了 `immediate` 又在 `onMounted` 再抓一次；狀態欄顯示 `(canceled)` 代表請求被取消，或發出請求的頁面已經離開。' },
        { c: 'Console 乾淨', t: '重新整理並把每個狀態切一遍，錯誤計數維持 0。`Uncaught (in promise)` 代表有 Promise 失敗沒人處理，`[Vue warn]` 代表元件用法有錯（例如 props 型別不符）。' },
        { c: '樣式從哪來', t: 'Elements 的 Styles 裡你要的規則被劃掉，代表有權重更高或順序更後面的規則蓋掉它；Computed 分頁展開屬性，可以跳到實際生效的那一條。' },
        { c: '三種寬度', t: '`Toggle device toolbar` 切到 390px 後頁面左右滑得動：在 Console 執行 `[...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > innerWidth)` 找出超出視窗的元素。' },
        { c: 'cookie 屬性', t: 'Application 分頁的 Cookies：登入用的 cookie 沒勾 `HttpOnly`，代表前端 JavaScript 讀得到它；Local storage 出現 token 時，要確認這是團隊同意的做法。' },
        { c: '無障礙項目', t: 'Lighthouse 只勾 Accessibility 跑一次：`Buttons do not have an accessible name`、`Form elements do not have associated labels` 這類項目要清空。' },
      ],
    },
    points: [
      { b: '固定的驗收順序', t: 'Console（有沒有錯）→ Network（請求對不對）→ Elements（結構與樣式）→ 裝置模式（三種寬度）→ Application（cookie 與儲存）→ Lighthouse（無障礙與效能）。每個畫面照同一個順序走，不靠印象。' },
      { b: 'Network 是前後端的分界', t: '請求沒送出、參數送錯是前端的問題；送對了卻回 `500` 或資料不對是後端的問題。Headers 看方法、狀態碼與標頭，Payload 看送出的 body，Response 看原始回應，Timing 看時間花在哪一段。' },
      { b: '讓問題重現', t: '`Disable cache` 排除快取；節流（`Slow 4G`、`3G`、`Offline`）讓載入中與錯誤狀態看得到；`Preserve log`（新版 Chrome 叫 `Keep log`）讓換頁或重新整理前的請求與 log 留著。' },
      { b: '在 Elements 試改', t: '在 Styles 直接改值、勾掉規則、用 `:hov` 強制 `:hover` 或 `:focus-visible`，確定要改哪一行再回原始碼改。這裡的修改重新整理就消失。' },
      { b: 'Console 能下指令', t: '`$0` 是 Elements 選取的元素，`copy()` 把值複製到剪貼簿，`getEventListeners(window)` 列出物件上的事件監聽（Chrome 專屬）。錯誤訊息右邊的檔名與行號點下去會跳到 Sources 的那一行。' },
    ],
    checklist: [
      '能用固定順序驗收一個畫面，並說出每個分頁要看什麼、看到什麼代表錯',
      '能從 Network 分頁判斷一個錯誤是前端送錯請求，還是後端回錯',
      '能用節流與 `Offline` 讓載入中與錯誤狀態出現，並用裝置模式檢查三種寬度',
    ],
    refs: [
      { label: 'Chrome DevTools 官方文件', url: 'https://developer.chrome.com/docs/devtools' },
      { label: 'Chrome DevTools：Network panel', url: 'https://developer.chrome.com/docs/devtools/network' },
      { label: 'Chrome DevTools：Console', url: 'https://developer.chrome.com/docs/devtools/console' },
      { label: 'Firefox DevTools User Docs', url: 'https://firefox-source-docs.mozilla.org/devtools-user/' },
    ],
  },
}

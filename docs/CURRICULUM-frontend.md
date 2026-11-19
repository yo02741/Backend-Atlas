# 前端課綱：18 週主線

> 範圍：瀏覽器怎麼畫出畫面、HTML 與 CSS 版面、JavaScript 與 TypeScript、Vue 3 元件（React 作對照）、UI 元件詞彙、呼叫後端、建置與部署、測試與靜態檢查、效能與錯誤監控、用 AI 寫前端。
> 技術選型：Vue 3.5（Composition API、`<script setup>`）、Vite、Chrome DevTools。範例是虛構的醫院門診系統：掛號、看診進度、預約清單。
> 每週的課都有「地圖」：叫得出名字、說得出要求、驗得出對錯。驗收用選擇題、實驗室、DevTools 的檢查與在瀏覽器裡執行的程式題（HTML、CSS、Vue 在沙箱 iframe 裡跑）。

---

## 一、週次

### 第 1 週｜瀏覽器與驗收工具

- **對應技能**：`how-browsers-render`、`devtools`、`page-loading`
- **學習目標**
  1. 能說出網址到畫面的七段（請求、DOM、CSSOM、render tree、layout、paint、composite），並指出改 `color`、`width`、`transform` 各要重跑哪幾段
  2. 能用固定順序驗收一個頁面：Console 沒有錯誤、Network 的請求與狀態碼、Elements 的結構與樣式、Application 的儲存、Lighthouse 的報告
  3. 能說明 CSS 為什麼擋住畫面、script 為什麼擋住解析，以及 `defer`、`async`、`type="module"` 的差別
- **動手作業**：在 RenderPipelineLab 切換「script 沒有 defer」與四種屬性變更，記下每一種重跑的階段；打開一個門診系統的頁面，照 `devtools` 課的順序寫一份驗收紀錄，並在 Network 找出 render-blocking 的資源。
- **驗收標準**：三課的選擇題全對；驗收紀錄裡每個分頁至少一條具體發現（請求、錯誤或樣式）。
- **預估時數**：7 小時

### 第 2 週｜HTML 與 CSS 基礎

- **對應技能**：`semantic-html`、`css-cascade`、`box-model`、`a11y-basics`、`units-typography`
- **學習目標**
  1. 能為掛號表單選對元素：地標、`button` 與 `label`、`input` 的 `type` 與 `inputmode`
  2. 能說出兩條規則誰勝出（`!important`、`@layer`、權重、出現順序），以及一個盒子實際多寬
  3. 能用鍵盤走完一個頁面，檢查每個控制項都有名稱、文字對比至少 4.5:1
  4. 能為字級、間距選對單位（rem、em、dvh、不帶單位的行高），說出網頁字型的 `font-display` 怎麼影響第一次顯示
- **動手作業**：把一份掛號表單的需求寫成 `semantic-html` 課「說得出要求」的格式；用 DevTools 的 Styles 與 Computed 分頁解釋一條被蓋掉的規則；只用鍵盤操作表單並記下卡住的地方。
- **驗收標準**：五課的選擇題全對；Lighthouse 的無障礙分數沒有紅色項目；瀏覽器字級調到 200% 時文字不被截斷。
- **預估時數**：9 小時

### 第 3 週｜版面

- **對應技能**：`flexbox`、`grid`、`positioning`、`rwd`、`images-media`、`layout-patterns`
- **學習目標**
  1. 能用主軸、交叉軸、剩餘空間描述一個 Flexbox 排列，並說出 `min-width` 造成溢出的原因
  2. 能用 `fr`、`minmax`、`auto-fill` 寫出不同寬度下自動換欄的卡片網格
  3. 能分辨 stacking context、`sticky` 失效的原因，並寫 mobile-first 的 media query 與有寬高的圖片
  4. 能說出 app shell、側欄收合、清單與詳細這幾種頁面版面，並寫成 390、768、1024、1280 的斷點表
- **動手作業**：在 FlexboxLab 與 GridLab 排出「看診進度卡片」的三種寬度版面，用 GridLab 的三寬度表記下每種寬度排成幾欄。
- **驗收標準**：六課的選擇題全對；390px、768px、1280px 三種寬度下沒有橫向捲動，圖片不造成版面跳動（DevTools 的 Layout shift regions）。
- **預估時數**：10 小時

### 第 4 週｜JavaScript 語法、資料與模組

- **對應技能**：`js-essentials`、`values-references`、`modules`
- **學習目標**
  1. 讀得懂 AI 產出的語法：解構、展開、`?.` 與 `??`，以及哪些陣列方法會改到原陣列
  2. 能分辨參考與複本，寫出不可變更新，並說明 `structuredClone` 遇到 Vue reactive 物件的問題
  3. 看得懂 `import`、`export`、`package.json` 與 lock 檔
- **動手作業**：跑完三課深入內容裡標「在 Playground 開啟」的範例，把一段直接改陣列的程式改成不可變更新。
- **驗收標準**：三課的選擇題全對；能口頭說明展開運算子只複製一層的後果。
- **預估時數**：6 小時

### 第 5 週｜非同步、事件與除錯

- **對應技能**：`async-js`、`event-loop`、`dom-events`、`js-debugging`
- **學習目標**
  1. 能分辨依序與平行的 `await`，選 `Promise.all` 或 `Promise.allSettled`，並在 `finally` 收掉 loading
  2. 能排出 task、microtask 與渲染的順序，找出讓畫面凍結的長任務
  3. 能說明捕獲、冒泡與事件委派，並從 stack trace 與 breakpoint 找到錯
- **動手作業**：在 EventLoopLab 跑完四個範例，再用 Performance 分頁錄一次長任務；在 EventPropagationLab 比較三種掛監聽的方式。
- **驗收標準**：四課的選擇題全對；能說明三個請求依序與平行各要多久。
- **預估時數**：7 小時

### 第 6 週｜元件與模板

- **對應技能**：`components-sfc`、`template-syntax`、`props-emits-model`、`slots-provide`
- **學習目標**
  1. 能把一個頁面拆成元件樹，說出每個元件的 props 與 emit，子元件不改 props
  2. 能讀懂 `v-bind`、`v-on`、`v-if` 與 `v-show`、`v-for` 的 `key`
  3. 能判斷可客製的區塊該用 slot、跨好幾層的資料該用 provide
- **動手作業**：把「今日掛號清單」頁畫成元件樹，標出資料從哪裡來、事件往哪裡送、哪些區塊用 slot。
- **驗收標準**：四課的選擇題全對；元件樹裡每個元件都寫了 props 與 emit。
- **預估時數**：7 小時

### 第 7 週｜響應式與生命週期

- **對應技能**：`reactivity`、`lifecycle`、`watchers`、`composables`
- **學習目標**
  1. 能說明 `ref`、`reactive`、`computed` 的差別，以及解構之後失去響應式的原因
  2. 能說出 `onMounted` 與 `onUnmounted` 各放什麼，並先問「能不能用 computed」再寫 `watch`
  3. 能把重複的邏輯抽成 `useXxx`，並在元件離開時收掉計時器、監聽與請求
- **動手作業**：在 ReactivityLab 切過三種模式；照 `lifecycle` 課「驗得出對錯」的步驟，檢查一個會輪詢看診進度的元件，切換頁面十次後請求與監聽不會變多。
- **驗收標準**：四課的選擇題全對；檢查紀錄寫出用了哪個分頁、看到什麼。
- **預估時數**：7 小時

### 第 8 週｜UI 元件詞彙（一）：狀態與輸入

- **對應技能**：`ui-states`、`buttons-inputs`、`select-combobox`、`feedback`
- **學習目標**
  1. 能為一個按鈕或輸入框列出狀態表：hover、`focus-visible`、disabled、loading，以及停用時焦點的去向
  2. 能分辨 Checkbox、Radio、Switch、Select、Combobox 的用途與鍵盤操作
  3. 能分辨 Toast、Alert、Skeleton、Empty state，並為空清單寫出下一步的操作
- **動手作業**：在 UiStatesLab 切過四種元件的狀態；為「送出掛號」按鈕寫狀態表與驗收條件。
- **驗收標準**：四課的選擇題全對；狀態表每一列都有「怎麼觸發」與「看到什麼」。
- **預估時數**：7 小時

### 第 9 週｜UI 元件詞彙（二）：浮層、導覽與資料

- **對應技能**：`overlays`、`navigation-ui`、`data-display`、`design-tokens`、`a11y-components`
- **學習目標**
  1. 能說出 Dialog、Drawer、Popover、Tooltip 擋不擋操作，以及焦點怎麼進、怎麼回來
  2. 能把 Tabs、Breadcrumb、Pagination 的狀態寫進網址，並標出 `aria-current`
  3. 能為表格與清單寫出排序、篩選、全選的規格，並用 design token 寫出亮暗主題
  4. 能用 WAI-ARIA APG 的鍵盤表與屬性表驗收自己做的 Tabs、Menu Button、Combobox
- **動手作業**：用 UiStatesLab 的 Dialog 練習焦點移入、Esc 關閉、焦點回到觸發按鈕；在 OverlayLab 疊開 Dialog 與 Toast，說明誰在上面、Esc 關掉哪一個；為「我的掛號」表格寫一份元件規格。
- **驗收標準**：五課的選擇題全對；規格涵蓋鍵盤操作與手機上的呈現。
- **預估時數**：9 小時

### 第 10 週｜呼叫後端

- **對應技能**：`fetch-basics`、`api-states`、`cancel-race`、`api-errors-retry`、`ts-basics`、`ts-runtime-boundary`
- **學習目標**
  1. 能用 `res.ok` 分辨 HTTP 錯誤，讀 Problem Details 的錯誤 body，替請求加上逾時
  2. 能把一次 API 呼叫對應到畫面的四種狀態，取消舊請求，只讓最後的條件反映在畫面上
  3. 能分辨哪些錯誤給重試，並為 API 回應寫 TypeScript 的 interface 與 union
  4. 能說出型別只存在於編譯時，在資料進來的地方用 schema 在執行時檢查
- **動手作業**：在 ApiStatesLab 切過六種回應與競態模式，為預約清單寫出每一種的畫面與驗收條件。
- **驗收標準**：六課的選擇題全對；驗收條件涵蓋 403、500、逾時、斷線與欄位缺少。
- **預估時數**：9 小時

### 第 11 週｜瀏覽器的邊界與資料流

- **對應技能**：`same-origin-frontend`、`browser-storage`、`urls-history`、`pagination-filter`、`realtime-frontend`、`data-caching`
- **學習目標**
  1. 能讀懂 Console 的 CORS 錯誤，說出開發時的 proxy 與正式環境同網域 `/api` 的做法
  2. 能分辨 cookie、localStorage、sessionStorage 各適合放什麼，以及哪些東西不能放
  3. 能把篩選與分頁條件放進網址，並為看板即時更新選輪詢、SSE 或 WebSocket
  4. 能說出查詢 key、stale-while-revalidate 與失效的規則，分辨前端快取與 HTTP 快取
- **動手作業**：把預約清單的篩選、排序、分頁全部寫進網址，重新整理與上一頁都還原得回來。
- **驗收標準**：六課的選擇題全對；DevTools 的 Application 分頁裡沒有存放 token 以外的敏感資料。
- **預估時數**：9 小時

### 第 12 週｜表單、登入、全域狀態與路由

- **對應技能**：`forms`、`form-submit`、`file-upload-frontend`、`auth-frontend`、`pinia`、`vue-router`、`react-mapping`
- **學習目標**
  1. 能決定錯誤顯示的時機，把 422 的欄位錯誤對回表單，並防止重複送出；上傳檔案時先在前端檢查大小與類型、顯示進度
  2. 能處理 401 導向登入再導回、403 顯示沒有權限，登出時清乾淨
  3. 能判斷狀態放元件、網址還是 Pinia，寫出動態路由與守衛，並對照 React 的寫法
- **動手作業**：做出掛號表單的完整流程：驗證、送出、422 與 409 的處理、成功後導向「我的掛號」。
- **驗收標準**：七課的選擇題全對；表單只用鍵盤就能完成，錯誤訊息念得出來。
- **預估時數**：10 小時

### 第 13 週｜建置與部署

- **對應技能**：`vite-basics`、`env-config`、`bundles-chunks`、`spa-deploy`、`npm-packages`、`rendering-modes`
- **學習目標**
  1. 能說明 dev server、HMR 與 `vite build` 的產物，以及 Vite 6 與 8 的差別
  2. 能分辨建置時與執行時的設定，說出 `VITE_` 變數會被寫進產物
  3. 能設定子路徑與 history fallback，說明 hash 檔名與 `index.html` 不快取的原因
  4. 能讀懂版本範圍與 lock 檔、新增套件前先檢查；能說出 CSR、SSR、SSG 各自的第一次顯示與 hydration
- **動手作業**：把門診前端建置後放到子路徑，確認重新整理任一頁都不會 404，部署新版本後舊分頁不會出現 chunk 404；在 BundleLab 比較三種 vendor 切法的首頁下載量。
- **驗收標準**：六課的選擇題全對；能從建置產物指出哪個 chunk 最大、為什麼。
- **預估時數**：9 小時

### 第 14 週｜CSS 的組織、動態與支援範圍

- **對應技能**：`css-architecture`、`css-motion`、`browser-support`
- **學習目標**
  1. 能說出 BEM、scoped CSS、CSS Modules、Tailwind 各自怎麼避免樣式衝突，並用 `@layer` 與 design token 接起來
  2. 能寫只動 `transform` 與 `opacity` 的轉場，用 Vue 的 `<Transition>` 做進出場，並尊重 `prefers-reduced-motion`
  3. 能分辨 `build.target` 只轉語法、不補 API，用 Baseline 判斷一個功能能不能直接用
- **動手作業**：為門診前端寫一份支援範圍（Baseline 年份與要留退路的功能），並把一個 Dialog 的開關加上轉場，在減少動態的設定下確認只剩淡入淡出。
- **驗收標準**：三課的選擇題全對；DevTools 的 Rendering 分頁模擬 `prefers-reduced-motion: reduce` 時沒有位移動畫。
- **預估時數**：6 小時

### 第 15 週｜品質：靜態檢查與測試

- **對應技能**：`lint-typecheck`、`test-layers`、`component-tests`、`e2e-playwright`、`frontend-ci`
- **學習目標**
  1. 能設定 ESLint、Prettier 與 `vue-tsc`，說出 `tsc` 為什麼看不到 `.vue` 的錯
  2. 能把驗收條件分到單元、元件、E2E 三層，說出 jsdom 沒有的行為要到真瀏覽器測
  3. 能用角色與名稱找元素、在網路層 mock API，寫出改壞會變紅的元件測試與 Playwright 測試
  4. 能在每個 PR 跑 `npm ci`、lint、型別檢查、測試、建置與 E2E，並部署預覽網址
- **動手作業**：替掛號表單寫一個元件測試（422 的欄位錯誤顯示在欄位旁）與一個 Playwright 測試（掛號到「我的掛號」看得到），故意改壞一行確認兩者都會失敗。
- **驗收標準**：五課的選擇題全對；CI 的每一步都有對應的 npm script，本機跑得出同樣的結果。
- **預估時數**：10 小時

### 第 16 週｜效能、錯誤監控與資安

- **對應技能**：`web-vitals`、`render-performance`、`error-monitoring`、`frontend-security`
- **學習目標**
  1. 能說出 LCP、INP、CLS 的門檻與 p75，分辨 Lighthouse 的實驗室數據與實際使用者的資料
  2. 能用 Performance 分頁找到長任務與大量 DOM，選分頁、虛擬捲動、debounce 或拆任務
  3. 能收回使用者瀏覽器裡的錯誤，上傳 source map 但不公開，送出的資料不含個資
  4. 能指出 `v-html`、`innerHTML`、`javascript:` 網址造成的 XSS，說出 CSP 擋下哪些寫法、token 放哪裡的取捨
- **動手作業**：在 VitalsLab 把看板頁的三個指標都調到良好，記下每一步的修法；為門診前端寫一份 CSP，確認 Console 沒有被擋下的項目。
- **驗收標準**：四課的選擇題全對；能從一筆壓縮後的錯誤 stack 對回原始檔與行號。
- **預估時數**：9 小時

### 第 17 週｜用 AI 寫前端（一）：描述畫面

- **對應技能**：`describe-ui`、`wireframes-screenshots`、`component-breakdown`、`screen-spec`、`ai-common-mistakes`
- **學習目標**
  1. 能把一個畫面寫成文字：版面、元件、狀態、資料、互動五段，加上斷點與文案，必要時附截圖或線框
  2. 能先拆元件與 props／emits 表，再把整個畫面寫成一頁規格：狀態表、文案表、斷點表與驗收條件
  3. 能用工具抓 AI 產出的固定幾類錯
- **動手作業**：把第 10–12 週的預約清單寫成一頁畫面規格，交給 AI 產生元件，記下它錯在哪幾類。
- **驗收標準**：五課的選擇題全對；規格的每一格都具體到能拿來驗收。
- **預估時數**：8 小時

### 第 18 週｜用 AI 寫前端（二）：規範、契約與審查

- **對應技能**：`ai-project-rules`、`openapi-types`、`ai-api-contract`、`ai-acceptance`、`ai-review-diff`
- **學習目標**
  1. 能在 AGENTS.md 這類規範檔寫下技術與版本、瀏覽器目標、元件與 token 的規則，以及交付前要跑的指令
  2. 能從 OpenAPI 產生型別與 client，把型別檔與每種回應的範例交給 AI，要求缺的欄位列出來不自己補
  3. 能用固定的清單驗收（每個狀態、三個寬度、只用鍵盤、Console 與 Network），先看改了哪些檔案再讀邏輯
- **動手作業**：替門診前端寫一份 AGENTS.md，讓 AI 依規範與型別檔改寫預約清單，再用 `ai-acceptance` 的清單與 `ai-review-diff` 的順序審過它的改動。
- **驗收標準**：五課的選擇題全對；檢查清單每一條都標了「通過」或「修了什麼」，規範檔的每一條都能檢查。
- **預估時數**：9 小時

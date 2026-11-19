# 前端課綱：8 週主線（第一批）

> 範圍：瀏覽器怎麼畫出畫面、HTML 與 CSS 版面、非同步 JavaScript、Vue 3 元件（React 作對照）、UI 元件詞彙、呼叫後端、用 AI 寫前端。
> 技術選型：Vue 3.5（Composition API、`<script setup>`）、Vite、Chrome DevTools。範例是虛構的醫院門診系統：掛號、看診進度、預約清單。
> 每週的課都有「地圖」：叫得出名字、說得出要求、驗得出對錯。HTML、CSS、Vue 的程式題要等瀏覽器裡的沙箱執行環境，下一批補上；這一批的驗收用選擇題、實驗室與 DevTools 的檢查。

---

## 一、週次

### 第 1 週｜瀏覽器與驗收工具

- **對應技能**：`how-browsers-render`、`devtools`
- **學習目標**
  1. 能說出網址到畫面的七段（請求、DOM、CSSOM、render tree、layout、paint、composite），並指出改 `color`、`width`、`transform` 各要重跑哪幾段
  2. 能用固定順序驗收一個頁面：Console 沒有錯誤、Network 的請求與狀態碼、Elements 的結構與樣式、Application 的儲存、Lighthouse 的報告
- **動手作業**：在 RenderPipelineLab 切換「script 沒有 defer」與四種屬性變更，記下每一種重跑的階段；打開一個門診系統的頁面，照 `devtools` 課的順序寫一份驗收紀錄。
- **驗收標準**：兩課的選擇題全對；驗收紀錄裡每個分頁至少一條具體發現（請求、錯誤或樣式）。
- **預估時數**：6 小時

### 第 2 週｜HTML 與版面

- **對應技能**：`semantic-html`、`flexbox`、`rwd`
- **學習目標**
  1. 能為掛號表單選對元素：地標、`button` 與 `label`、`input` 的 `type` 與 `inputmode`
  2. 能用主軸、交叉軸、剩餘空間描述一個 Flexbox 排列，並說出 `min-width` 造成溢出的原因
  3. 能寫 mobile-first 的 media query，並分辨 media query 與 container query 的用途
- **動手作業**：在 FlexboxLab 排出「看診進度卡片」的三種寬度版面；把一份掛號表單的需求寫成 `semantic-html` 課「說得出要求」的格式。
- **驗收標準**：三課的選擇題全對；390px 與 1280px 兩種寬度下沒有橫向捲動（DevTools 的裝置模式檢查）。
- **預估時數**：8 小時

### 第 3 週｜非同步 JavaScript

- **對應技能**：`async-js`
- **學習目標**
  1. 能分辨依序與平行的 `await`，並選 `Promise.all` 或 `Promise.allSettled`
  2. 能在 `finally` 收掉 loading，讓成功與失敗都回到可操作的狀態
- **動手作業**：跑完深入內容裡標「在 Playground 開啟」的範例，改成平行、改成其中一個失敗，觀察結果。
- **驗收標準**：選擇題全對；能口頭說明三個請求依序與平行各要多久。
- **預估時數**：4 小時

### 第 4 週｜元件與模板

- **對應技能**：`components-sfc`、`template-syntax`
- **學習目標**
  1. 能把一個頁面拆成元件樹，說出每個元件的 props 與 emit
  2. 能讀懂 `v-bind`、`v-on`、`v-if` 與 `v-show`、`v-for` 的 `key`，並指出 `v-if` 與 `v-for` 寫在同一個元素上的問題
- **動手作業**：把「今日掛號清單」頁畫成元件樹，標出資料從哪裡來、事件往哪裡送。
- **驗收標準**：兩課的選擇題全對；元件樹裡每個元件都寫了 props 與 emit。
- **預估時數**：6 小時

### 第 5 週｜響應式與生命週期

- **對應技能**：`reactivity`、`lifecycle`
- **學習目標**
  1. 能說明 `ref`、`reactive`、`computed` 的差別，以及解構之後失去響應式的原因
  2. 能說出 `onMounted` 與 `onUnmounted` 各放什麼，並檢查計時器、事件監聽與請求在元件離開時有沒有收掉
- **動手作業**：照 `lifecycle` 課「驗得出對錯」的步驟，檢查一個會輪詢看診進度的元件，切換頁面十次後請求與監聽不會變多。
- **驗收標準**：兩課的選擇題全對；檢查紀錄寫出用了哪個分頁、看到什麼。
- **預估時數**：6 小時

### 第 6 週｜UI 元件詞彙

- **對應技能**：`ui-states`、`feedback`
- **學習目標**
  1. 能為一個按鈕或輸入框列出狀態表：hover、`focus-visible`、disabled、loading
  2. 能分辨 Toast、Alert、Skeleton、Empty state 的用途，並為空清單寫出下一步的操作
- **動手作業**：為「送出掛號」按鈕寫狀態表與驗收條件；為「沒有符合的預約」寫 Empty state 的文案與按鈕。
- **驗收標準**：兩課的選擇題全對；狀態表每一列都有「怎麼觸發」與「看到什麼」。
- **預估時數**：5 小時

### 第 7 週｜呼叫後端

- **對應技能**：`fetch-basics`、`api-states`
- **學習目標**
  1. 能用 `res.ok` 分辨 HTTP 錯誤，讀 Problem Details 的錯誤 body，替請求加上逾時
  2. 能把一次 API 呼叫對應到畫面的四種狀態（loading、success、empty、error），並決定哪些錯誤給重試
- **動手作業**：在 ApiStatesLab 切過六種回應與競態模式，為預約清單寫出每一種的畫面與驗收條件。
- **驗收標準**：兩課的選擇題全對；驗收條件涵蓋 403、500、逾時與斷線。
- **預估時數**：6 小時

### 第 8 週｜用 AI 寫前端

- **對應技能**：`describe-ui`、`ai-common-mistakes`
- **學習目標**
  1. 能把一個畫面寫成文字：版面、元件、狀態、資料、互動五段，加上斷點與文案
  2. 能用工具抓 AI 產出的固定幾類錯：Vue 2 寫法、混用 API、多餘的 `watch`、錯的 `key`
- **動手作業**：把第 6、7 週的預約清單寫成一段完整的描述交給 AI 產生元件，再用 `ai-common-mistakes` 課的清單逐條檢查。
- **驗收標準**：兩課的選擇題全對；檢查清單每一條都標了「通過」或「修了什麼」。
- **預估時數**：6 小時

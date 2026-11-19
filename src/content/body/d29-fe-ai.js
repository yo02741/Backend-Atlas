// 前端路線：用 AI 寫前端 的技能內文（以技能 id 為 key）
export default {
  'describe-ui': {
    map: {
      names: [
        { n: '版面（layout）', t: '畫面分成哪些區域、彼此的位置：頁首、側欄、主內容、底部操作列；每個區域在不同寬度下怎麼排。' },
        { n: '元件清單', t: '每個區域用哪些元件，寫元件的名字（Data table、Tabs、Dialog、Toast），不寫「一個框」「一個彈出來的東西」。' },
        { n: '狀態', t: '每個元件與整頁有哪些狀態：loading、empty、error、disabled、selected，各自長什麼樣。' },
        { n: '資料', t: '每塊資料從哪個 API 來、欄位名稱、一筆範例值，以及排序與顯示格式（日期、金額、遮罩）。' },
        { n: '互動', t: '使用者做什麼（點、輸入、按鍵）、畫面怎麼變、送出什麼請求、焦點移到哪；寫成「按下…之後…」。' },
        { n: '斷點', t: '390、768、1280 這幾個寬度下版面怎麼變：欄數、側欄收合、表格改成卡片。' },
        { n: '文案（microcopy）', t: '按鈕、標題、空狀態、錯誤訊息的實際文字；不寫「適當的提示」。' },
        { n: '驗收條件', t: '每段描述對應一條能檢查的條件，例如「390px 沒有水平捲軸」「切換 Tab 後重新整理停在同一個 Tab」。' },
      ],
      ask: [
        '畫面有哪些區域、各區域放哪些元件，以及在三個寬度下怎麼排',
        '每個元件的狀態，至少 loading、empty、error',
        '資料來源：API 路徑、欄位名稱、一筆範例回應與顯示格式',
        '每個操作改變什麼、送出什麼請求、焦點移到哪裡',
        '實際的文案，以及可以用的元件庫、token 與禁止事項（例如不新增套件）',
        '能在瀏覽器與開發者工具裡逐條檢查的驗收條件',
      ],
      prompt: '「今日門診」頁：上方是日期列與診間 Tabs，下面是預約 Data table（時間、病患姓名遮成「王○明」、狀態 Badge、操作），資料來自 `GET /api/appointments?date=YYYY-MM-DD&clinic=…`，回傳 `[{ id, time, patientName, status }]`。載入中顯示 5 列 Skeleton，沒有預約顯示「這個診間今天沒有預約」，失敗顯示 inline Alert 與「重試」。切換 Tab 時網址的 `clinic` 跟著變；按「報到」送 `POST /api/appointments/{id}/check-in`，成功後該列變成「已報到」並顯示 Toast。390px 時表格改成卡片清單，Tabs 可以橫向捲動。',
      verify: [
        { c: '五段都有實作', t: '拿描述逐段對照產出：版面、元件、狀態、資料、互動各有對應的程式；最常缺的是狀態，產出只畫了成功的畫面。' },
        { c: '三個寬度', t: '開發者工具的裝置模式切到 390、768、1280，對照描述的斷點；390 時 Console 執行 `document.documentElement.scrollWidth > innerWidth` 得到 `true`，代表有水平捲軸。' },
        { c: '欄位對得上', t: 'Network 分頁看實際回應的欄位名，和程式裡用的一致；產出自己編的欄位（例如 `patient.fullName`）會在畫面上顯示空白或 `undefined`。' },
        { c: '文案照描述', t: '畫面上每段文字都和描述一致；出現 Lorem ipsum 或「Something went wrong」代表描述沒給文案。' },
        { c: '互動與網址', t: '切換 Tab 後重新整理，要停在同一個 Tab；Network 分頁的請求要帶對的 `clinic` 與 `date`。' },
      ],
    },
    points: [
      { b: '五段加兩項', t: '版面、元件、狀態、資料、互動，再補斷點與文案。哪一段沒寫，產出就在那一段自己決定。' },
      { b: '用元件名稱', t: '「右下角出現、幾秒後消失的訊息」是 Toast，「蓋住整頁、要按確定的框」是確認 Dialog。名稱對了，產出的鍵盤操作與 ARIA 屬性也比較接近該元件的慣例。' },
      { b: '給真實的資料形狀', t: '附上 API 路徑與一筆範例回應，欄位名照抄。沒給時模型會自己編欄位，接上實際的 API 才發現對不起來。' },
      { b: '狀態寫成表', t: '每個區塊列出 loading、empty、error 與各自的文案。描述只寫成功的畫面，產出也只有成功的畫面。' },
      { b: '每段配一條驗收', t: '寫得出「390px 沒有水平捲軸」這種條件，描述才夠具體；驗收時也照這份清單一條一條看。' },
    ],
    checklist: [
      '能把一個現有畫面寫成五段描述，加上斷點、文案與驗收條件',
      '能把「一個框」「彈出來的東西」這類描述改成元件名稱',
      '能拿描述逐段驗收一份 AI 產出，指出缺了哪一段',
    ],
    refs: [
      { label: 'WAI-ARIA Authoring Practices：Patterns', url: 'https://www.w3.org/WAI/ARIA/apg/patterns/' },
      { label: 'web.dev：Responsive web design basics', url: 'https://web.dev/articles/responsive-web-design-basics' },
      { label: 'Chrome DevTools：Device mode', url: 'https://developer.chrome.com/docs/devtools/device-mode' },
    ],
  },
  'ai-common-mistakes': {
    map: {
      names: [
        { n: 'Vue 2 寫法', t: '`new Vue({…})`、`this.$set`、filters（`{{ price | currency }}`）、`beforeDestroy`、`.sync`、`$listeners`；Vue 2 在 2023 年底停止維護，這些在 Vue 3 已移除或改名。' },
        { n: 'Options 與 Composition 混用', t: '同一個元件有 `<script setup>`，又有 `data()`、`methods`、`mounted()`；兩套都能跑，但狀態分在兩處，難讀也難測。' },
        { n: '不必要的 watch', t: '用 `watch` 把 A 的值算好抄到 B，應該寫成 `computed`；或監聽 props 再複製成本地狀態，兩份資料遲早不同步。' },
        { n: '列表沒有 key 或用 index', t: '`v-for` 沒寫 `:key`，或寫 `:key="index"`；刪除、排序之後，輸入框內容與展開狀態會對錯列。' },
        { n: '直接改 props', t: '在子元件裡 `props.items.push()` 或 `v-model="props.value"`；資料流變成雙向，父元件不知道資料被改了。' },
        { n: '編造的 API', t: '`import { useFetch } from \'vue\'`（Vue 沒有這個函式，Nuxt 與 VueUse 才有）、元件庫不存在的 props、沒安裝的套件。' },
        { n: '只寫成功的情況', t: 'fetch 不檢查 `res.ok`、沒有 loading 與 error 畫面、`setInterval` 沒在 `onUnmounted` 清掉。' },
      ],
      ask: [
        '專案的 Vue 版本（3.5），一律 `<script setup>` 與 Composition API，不用 Options API 與 Vue 2 寫法',
        '可以用的套件清單，不新增依賴',
        '衍生資料一律用 `computed`，`watch` 只用在副作用（呼叫 API、寫入 localStorage）',
        '列表的 `key` 用哪個欄位',
        '子元件不改 props，要改就 emit 給父元件',
        '交付前要通過的檢查：`npx eslint .`、`npx vue-tsc --noEmit`、操作一輪 Console 沒有 `[Vue warn]`',
      ],
      prompt: '專案是 Vue 3.5 + Vite + TypeScript，元件一律用 `<script setup lang="ts">`，不寫 `data()`、`methods`、`mounted()`，也不用 `this`；只能用 `package.json` 裡已有的套件。衍生資料用 `computed`，`watch` 只放副作用；列表的 `key` 用資料的 `id`；子元件不改 props，用 `defineEmits` 通知父元件。交付前 `npx eslint .` 與 `npx vue-tsc --noEmit` 都要通過，操作每個畫面一輪後 Console 沒有 `[Vue warn]`。',
      verify: [
        { c: 'lint', t: 'eslint-plugin-vue 的 `flat/recommended` 會擋下 `vue/require-v-for-key`、`vue/no-mutating-props`、`vue/no-deprecated-filter`、`vue/no-deprecated-destroyed-lifecycle` 這類錯；只准 `<script setup>` 要另外開 `vue/component-api-style`。' },
        { c: '型別檢查', t: '`npx vue-tsc --noEmit` 抓不存在的 props、拼錯的欄位與 import 不到的函式；`import { useFetch } from \'vue\'` 會報 `Module \'"vue"\' has no exported member \'useFetch\'`。' },
        { c: 'Console 的 `[Vue warn]`', t: '操作每個畫面一輪：`Set operation on key "date" failed: target is readonly` 代表重新指定了 props；`Duplicate keys found during update` 代表 key 重複。改 props 內部（`push`）不會有警告，要靠 lint。' },
        { c: '沒有多出套件', t: '看 diff 裡的 `package.json` 與 import；dev server 出現 `Failed to resolve import "…" from "src/…". Does the file exist?` 代表 import 了沒安裝的套件或打錯路徑。' },
        { c: '多餘的 watch', t: '搜尋 `watch(`：callback 裡只把結果指定給另一個 ref 的，改成 `computed`，並確認畫面行為不變。' },
      ],
    },
    points: [
      { b: '先講版本與寫法', t: '沒指定時，產出可能混著 Vue 2、Options API 與 Composition API 的寫法。專案規範檔寫明 Vue 3.5、`<script setup>`、TypeScript 與禁止事項。' },
      { b: 'computed 優先於 watch', t: '「A 變了就更新 B」是 computed；watch 留給副作用。用 watch 抄資料會多一份狀態，第一次的值也常漏掉（沒加 `immediate`）。' },
      { b: 'key 用 id', t: '沒有 key 或用 index，刪除、排序、插入之後，輸入框內容與元件狀態會對錯列。' },
      { b: 'props 是唯讀的', t: '重新指定 `props.x` 會出 `[Vue warn]`；改陣列或物件內部（`props.items.push()`）不會警告，但父元件的資料已經被子元件改掉，要靠 `vue/no-mutating-props` 抓。' },
      { b: '工具先抓、人再看', t: 'lint、`vue-tsc`、Console 的 `[Vue warn]`、Network 分頁依序檢查，比逐行讀快；人工審查留給狀態與互動是否符合描述。' },
    ],
    checklist: [
      '能在一段 AI 產出的元件裡指出 Vue 2 寫法、混用、多餘的 watch 與錯的 key',
      '能設定 eslint-plugin-vue 與 `vue-tsc`，讓這些錯在 CI 被擋下',
      '能把禁止事項與驗收指令寫進專案規範檔',
    ],
    refs: [
      { label: 'eslint-plugin-vue：Available rules', url: 'https://eslint.vuejs.org/rules/' },
      { label: 'Vue 3 Migration Guide', url: 'https://v3-migration.vuejs.org/' },
      { label: 'Vue：Watchers', url: 'https://vuejs.org/guide/essentials/watchers.html' },
      { label: 'Vue：Style Guide', url: 'https://vuejs.org/style-guide/' },
    ],
  },
}

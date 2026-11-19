// 題庫：用 AI 寫前端
export default [
  {
    skill: 'describe-ui',
    questions: [
      {
        q: '給 AI 的畫面描述裡，下列哪一句最能拿來驗收產出？',
        options: [
          '「錯誤時顯示適當的提示」',
          '「頁面要簡潔、有現代感」',
          '「390px 時預約表格改成卡片清單，頁面沒有水平捲軸」',
          '「手機上也要好用」',
        ],
        answer: 2,
        explain: '能驗收的描述指名了條件與結果：390px 這個寬度、表格改成卡片、沒有水平捲軸，用裝置模式切過去就看得出對錯。「適當的提示」「簡潔」「好用」沒有可以檢查的內容，產出怎麼做都說得通，等於把決定交給了模型。',
      },
      {
        q: '後端實際回傳如下，AI 產出的清單卻用 `a.patient.fullName` 顯示姓名，畫面那一欄整欄空白。描述漏了哪一段？',
        code: `GET /api/appointments?date=2026-11-20&clinic=101

[
  { "id": 501, "time": "09:00", "patientName": "王○明", "status": "booked" }
]`,
        lang: 'http',
        options: [
          '資料：沒有附 API 路徑與一筆範例回應，模型自己編了欄位名稱',
          '版面：沒有畫出表格的欄位順序',
          '斷點：沒有寫手機上表格怎麼排',
          '文案：沒有寫姓名那一欄的標題',
        ],
        answer: 0,
        explain: '欄位名稱只能從描述或規格得知；沒給時模型會依常見的命名猜一個（`patient.fullName`），接上實際的 API 才發現對不起來。附上路徑與一筆實際的回應、欄位名照抄，就能避免。版面、斷點、文案影響的是排法與文字，不會讓資料讀不到。',
      },
      {
        q: '描述寫「點了報到會跳出一個框確認」，產出用一個絕對定位的 `<div>`，按 Esc 關不掉，Tab 會跑到後面的表格。下一版描述該怎麼改？',
        options: [
          '改成「做一個好看一點的彈出框」',
          '改成「確認 Dialog（原生 `<dialog>` 的 `showModal()`）：Esc 關閉，開啟時焦點在『確定』，關閉後焦點回到原本的按鈕」',
          '附上一張其他網站對話框的截圖，不另外說明',
          '只加一句「不要用 div」',
        ],
        answer: 1,
        explain: '用元件名稱（確認 Dialog、`<dialog>` 的 `showModal()`）帶出一整套慣例，再把鍵盤與焦點的行為寫成可以驗收的條件。「好看一點」沒有可以檢查的內容；截圖看得出外觀，看不出 Esc 與焦點的行為；「不要用 div」沒有說要用什麼、要有什麼行為。',
      },
    ],
  },
  {
    skill: 'ai-common-mistakes',
    questions: [
      {
        q: 'AI 產出的 Vue 3.5 元件用 Options API 的 `beforeDestroy()` 清掉計時器。元件卸載時會發生什麼？',
        options: [
          'Vue 3 不會呼叫 `beforeDestroy`，計時器在卸載後繼續跑，Console 沒有任何警告',
          'Vue 3 把 `beforeDestroy` 自動對應到 `beforeUnmount`，計時器正常清掉',
          '編譯失敗，提示改用 `onUnmounted`',
          'Console 出現 `[Vue warn]` 提示已改名，但仍然會執行',
        ],
        answer: 0,
        explain: 'Vue 3 把 `beforeDestroy`、`destroyed` 改名為 `beforeUnmount`、`unmounted`，舊名稱在一般的 Vue 3 建置裡直接被忽略，沒有錯誤也沒有警告，所以計時器一直跑。只有 Vue 的相容建置（compat build）會處理舊名稱。lint 規則 `vue/no-deprecated-destroyed-lifecycle` 抓得到；改成 `<script setup>` 的 `onUnmounted` 更好。',
      },
      {
        q: '`room.code` 是 `\'a101\'`，`upper` 是 AI 以為存在的 filter。這段模板在 Vue 3 畫面上顯示什麼？',
        code: `<p>{{ room.code | upper }}</p>`,
        lang: 'vue',
        options: [
          '`A101`，Vue 3 仍支援 filter 語法',
          '`0`，Console 有 `Property "upper" was accessed during render but is not defined on instance.` 的警告',
          '編譯錯誤，提示 Vue 3 不支援 filters',
          '原樣顯示 `{{ room.code | upper }}`',
        ],
        answer: 1,
        explain: 'Vue 3 移除了 filter，`|` 回到 JavaScript 的意思：位元 OR。`upper` 不存在，Vue 警告並當成 `undefined`，`\'a101\' | undefined` 算出 `0`。編譯會通過，所以要靠 Console 的警告或 lint 規則 `vue/no-deprecated-filter` 抓。改成 `{{ upper(room.code) }}` 或 computed。',
      },
      {
        q: '團隊想在 CI 擋下 AI 寫出的 Options API 與 Vue 2 寫法。最直接的做法是？',
        options: [
          '在 PR 範本加一條「請確認沒有使用 Options API」',
          '只跑 `npm run build`，能建置成功就代表寫法正確',
          '每次產出後請 AI 自己再檢查一次有沒有用 Options API',
          '用 eslint-plugin-vue 的 `flat/recommended`，另外開 `vue/component-api-style: [\'error\', [\'script-setup\']]`，CI 跑 `npx eslint .`',
        ],
        answer: 3,
        explain: '`flat/recommended` 擋下多數 Vue 2 的過時寫法（filter、`beforeDestroy`、`.sync`、`$listeners`），`vue/component-api-style` 不在預設組合裡，開了之後只准 `<script setup>`；放進 CI，人與 AI 的改動都要通過。PR 範本與請 AI 自查都靠人或模型記得；Options API 與 `beforeDestroy` 都能建置成功，build 抓不到。',
      },
    ],
  },
  {
    skill: 'wireframes-screenshots',
    questions: [
      {
        q: '只給 AI 一張「今日門診」1280px、有資料時的截圖，下列哪一項最可能被做錯或漏掉？',
        options: [
          '表格欄位的左右順序',
          '頁首與表格的上下位置',
          '載入中、沒有資料、錯誤時的畫面，以及 390px 時的版面',
          '主要按鈕大概是什麼顏色',
        ],
        answer: 2,
        explain: '截圖拍到的是一個狀態、一個寬度：欄位順序、區域位置、大概的顏色都看得到。沒拍到的狀態與寬度，產出只能自己猜，最常見的結果是只有成功的畫面、手機上被壓扁。截圖要搭配狀態表與 390 的文字線框。',
      },
      {
        q: '描述只附了截圖，產出的 CSS 長這樣。專案有 `--color-primary`、`--space-*` 這些 token。這段最主要的問題是？',
        code: `.tabs { gap: 14px; }
.tab.active { color: #2f6fe4; border-bottom: 2px solid #2f6fe4; }
.badge { background: #e8eef9; font-size: 13px; }`,
        lang: 'css',
        options: [
          'CSS 不能用 `px` 當單位',
          '顏色與間距是從截圖估出來的值，和專案的 token 對不上，深色主題也不會跟著變；描述要列出 token 並寫明不要從圖上量',
          '`border-bottom` 在 Safari 不支援',
          '`.tab.active` 的選擇器權重太低',
        ],
        answer: 1,
        explain: '截圖經過縮放與壓縮，從像素估出來的色碼與間距接近但不一致，一個專案裡就會出現好幾種差不多的藍。改用 `var(--color-primary)`、`var(--space-3)`，主題切換時才會一起變。驗收時用 Elements 分頁看樣式是不是 `var(--…)`。`px`、`border-bottom` 與這個選擇器本身都沒問題。',
      },
      {
        q: '要把舊系統的畫面交給外部的 AI 服務改寫，手邊的截圖是正式環境的，上面有病患姓名與病歷號。該怎麼做？',
        options: [
          '用測試環境的假資料重新截圖，或先把姓名、編號遮蓋，並檢查分頁標題、網址列與通知',
          '直接上傳，AI 服務不會保存圖片',
          '把截圖縮小，文字看不清楚就沒關係',
          '轉成黑白再上傳，個資就不明顯了',
        ],
        answer: 0,
        explain: '截圖一旦上傳，裡面的個資就離開了院內，無法收回；是否保存、怎麼使用由對方的條款決定。縮小或轉黑白，文字仍可能被辨識。用假資料截圖最乾淨；只能用真實畫面時先遮蓋，連角落的分頁標題、網址參數、內部主機名稱一起檢查。',
      },
    ],
  },
  {
    skill: 'component-breakdown',
    questions: [
      {
        q: '「今日門診」頁的日期要能重新整理後還在，也能把連結傳給同事。日期這份狀態放哪裡最合適？',
        options: [
          'Pinia store，所有元件都讀得到',
          '`DateBar` 元件自己的 ref',
          '網址的 query（`?date=2026-11-20`），頁面元件從網址讀，子元件透過 `v-model` 改',
          'localStorage，重新整理後還在',
        ],
        answer: 2,
        explain: '「重新整理後還在、能分享連結」是網址的工作。Pinia 與元件的 ref 在重新整理後都會消失；localStorage 雖然留得住，但同事打開連結看不到你的日期，兩個分頁也會互相覆蓋。日期放網址之後，頁面元件是唯一讀寫它的地方，`DateBar` 只透過 `v-model` 回報。',
      },
      {
        q: '這段要顯示「沒有取消的預約」。最好的改法是？',
        code: `const appointments = ref([])
const visible = ref([])
watch(appointments, (list) => {
  visible.value = list.filter((a) => a.status !== 'cancelled')
})`,
        lang: 'js',
        options: [
          '加上 `{ immediate: true }` 就完全沒問題',
          '改成 `const visible = computed(() => appointments.value.filter((a) => a.status !== \'cancelled\'))`',
          '把 `visible` 搬進 Pinia，讓其他元件也能用',
          '改用 `watchEffect`，效能比較好',
        ],
        answer: 1,
        explain: '能從 `appointments` 算出來的就用 computed，永遠一致。這段 watch 還有兩個坑：一開始不會執行（沒有 `immediate`），而且 watch 一個 ref 預設不是 deep，`appointments.value.push()` 或改某一筆的 `status` 都不會觸發（實測）。加 `immediate` 只修了第一個；搬進 Pinia 或換成 `watchEffect` 仍然是多一份要同步的狀態。',
      },
      {
        q: '想讓 `AppointmentTable` 放進另一個「預約查詢」頁重用，也能單獨寫元件測試。它目前在 `onMounted` 裡自己 `fetch(\'/api/appointments\')`。該怎麼改？',
        options: [
          '把 fetch 從 `onMounted` 搬到 `setup` 的頂層',
          '在兩個頁面各複製一份 `AppointmentTable`',
          '讓 `AppointmentTable` 改從 Pinia 讀資料，兩個頁面都把資料寫進同一個 store',
          '資料由頁面元件抓好，用 props（`items`、`status`）傳進來；報到、重試用 emit 通知頁面元件',
        ],
        answer: 3,
        explain: '展示元件不自己抓資料，才能放進不同的頁面、接不同的 API，測試時也只要給 props、檢查畫面與 emit。搬動 fetch 的位置沒有解決耦合；複製兩份之後要改兩次；兩個頁面共用一個 store，查詢頁的條件會蓋掉今日門診的清單。',
      },
    ],
  },
  {
    skill: 'ai-acceptance',
    questions: [
      {
        q: '驗收一份 AI 產出的前端，第一步做什麼最划算？',
        options: [
          '跑 lint、型別檢查、測試與 build，沒過就退回',
          '打開瀏覽器，從首頁開始手動點過每個功能',
          '逐行閱讀所有程式碼',
          '請 AI 再檢查一次自己的產出',
        ],
        answer: 0,
        explain: '自動檢查幾十秒就有結果，型別錯誤、lint 規則、建置失敗這類錯不用進瀏覽器就能擋下。手動操作與讀程式留給工具抓不到的：狀態、寬度、鍵盤、互動是否符合描述。請 AI 自查不算驗收，它說「沒問題」不是證據。',
      },
      {
        q: '產出附的元件測試只有這一個，而且通過了。它能抓到「empty 狀態沒有顯示文字」這個錯嗎？',
        code: `import { mount } from '@vue/test-utils'
import AppointmentTable from './AppointmentTable.vue'

test('renders', () => {
  const wrapper = mount(AppointmentTable, { props: { items: [], status: 'empty' } })
  expect(wrapper.exists()).toBe(true)
})`,
        lang: 'ts',
        options: [
          '能，傳了 `status: \'empty\'`，測試就會檢查空狀態',
          '能，只要元件有錯，`mount` 就會失敗',
          '不能：它只檢查元件掛得起來；要斷言「這個診間今天沒有預約」出現，並故意拿掉那段模板，確認測試會變紅',
          '不能，元件測試沒辦法檢查畫面上的文字，要改用 E2E',
        ],
        answer: 2,
        explain: '`wrapper.exists()` 只要掛載成功就是 true，畫面內容完全沒被檢查。改成 `expect(wrapper.text()).toContain(\'這個診間今天沒有預約\')`，再把元件改壞跑一次，測試變紅才代表它有在檢查。模板少一段不會讓 `mount` 失敗；Vue Test Utils 可以讀文字與觸發事件。',
      },
      {
        q: '驗收時在 Network 分頁發現，進入頁面時 `GET /api/appointments` 出現兩次，參數一樣。最可能的原因是？',
        options: [
          '瀏覽器的預先載入，屬於正常現象',
          '`onMounted` 抓了一次，`immediate: true` 的 watch 又抓了一次',
          'HTTP/2 會把每個請求送兩次',
          'Vue 的開發模式會讓每個請求送兩次',
        ],
        answer: 1,
        explain: 'AI 產出常同時寫了兩個入口：`onMounted(load)` 與 `watch(條件, load, { immediate: true })`，掛載時各跑一次。留一個就好，通常是 immediate 的 watch，因為條件改變時也要重抓。Vue 沒有「開發模式送兩次」的行為（React 18 起開發模式的 StrictMode 會讓 effect 跑兩次）；HTTP/2 不會重送；預先載入不會用同一個 fetch。',
      },
    ],
  },
  {
    skill: 'ai-project-rules',
    questions: [
      {
        q: '下面四條要寫進前端專案的 AGENTS.md，哪一條寫法最能被遵守與檢查？',
        options: [
          '寫出乾淨、好維護的程式',
          '顏色與間距只用 `src/styles/tokens.css` 的變數，不寫 hex 與任意 px',
          '注意無障礙與使用者體驗',
          '遵守團隊的設計規範',
        ],
        answer: 1,
        explain: '規範要寫成「答案」：具體的檔案、變數、指令，看得出有沒有遵守，也能進一步交給 Stylelint 的 `color-no-hex` 這類規則。其他三條是願望，模型不知道具體要做什麼，審查時也無從判斷。',
      },
      {
        q: 'ESLint 的設定有下面兩條規則。AI 交回的改動裡，哪一種違規會讓 `npx eslint .` 直接報錯？',
        code: `rules: {
  'vue/component-api-style': ['error', ['script-setup']],
  'no-restricted-globals': ['error', { name: 'fetch', message: '請用 src/api/client.ts 的 api' }],
}`,
        lang: 'js',
        options: [
          '在 `package.json` 新增了一個 npm 套件',
          '手動修改了產生的 `src/api/schema.d.ts`',
          '新元件用 `data()` 與 `methods` 寫成 Options API',
          '把既有測試的期望值從 3 筆改成 2 筆',
        ],
        answer: 2,
        explain: '`vue/component-api-style` 設成只允許 `script-setup`，寫了 `data()` 的元件會報「Options API is not allowed in your project. Use `<script setup>` instead」；另一條擋的是元件直接呼叫 `fetch`。新增套件、手改產生的檔、改測試期望值，這兩條規則都擋不到，要靠規範檔、CI 的比對與審查。',
      },
      {
        q: 'AI 每次改完都先跑 `npm test` 失敗一次，再去 `package.json` 找到 `npm run test:unit`。最好的處理方式是什麼？',
        options: [
          '每次對話開頭都提醒一次正確的指令',
          '在 `package.json` 加一個 `test` 指令，內容是 `echo ok`',
          '叫 AI 以後不要跑測試，節省時間',
          '把規範檔「交付前」的指令改成實際的 `npm run test:unit`，並在乾淨的 clone 上照著跑一次確認',
        ],
        answer: 3,
        explain: '這是規範檔過期：寫的指令和 `package.json` 對不上。改正規範檔並實際跑過一次，之後每個對話都會讀到對的指令。每次口頭提醒在新對話就失效；`echo ok` 讓「測試通過」變成假的；不跑測試等於放棄驗證。',
      },
    ],
  },
  {
    skill: 'ai-api-contract',
    questions: [
      {
        q: '讓 AI 寫「我的掛號」元件，並順便寫 MSW 的 mock。本機測試全部通過，接上真的後端後一半欄位空白。最可能的原因是什麼？',
        options: [
          'mock 的回應比真的後端快，測試沒有等到資料',
          'mock 和元件出自同一個猜測，形狀彼此一致卻和 API 不同；mock 要用實際的範例回應，並用 `satisfies` 綁住產生的型別',
          '真的後端被 CORS 擋下，回應是空的',
          'MSW 的版本太舊，攔截不到請求',
        ],
        answer: 1,
        explain: '沒有拿到契約時，模型用常見的命名補欄位，自己寫的 mock 也照同樣的猜測，所以測試全綠。mock 改用從 Network 分頁或後端測試資料複製的範例，並加上 `satisfies components[\'schemas\'][…]`，猜錯的欄位在型別檢查就會失敗。CORS 被擋時是網路錯誤，不是欄位空白。',
      },
      {
        q: '`AppointmentPage` 是從 OpenAPI 產生的型別，`AppointmentOut` 裡沒有 `doctorName`。這個 MSW handler 會怎樣？',
        code: `http.get('/api/appointments', () =>
  HttpResponse.json({
    items: [{ id: 501, session_id: 12, patient_id: 7, number: 3,
              status: 'booked', created_at: '2026-11-18T09:12:00+08:00',
              doctorName: '林醫師' }],
    next_cursor: null,
  } satisfies AppointmentPage),
)`,
        lang: 'ts',
        options: [
          '型別檢查報 TS2353：物件只能有已知的屬性，`doctorName` 不在型別裡',
          '型別檢查通過，畫面上會顯示「林醫師」',
          'MSW 在執行時丟出錯誤，拒絕回傳多餘的欄位',
          '沒有任何影響，`satisfies` 只是給人看的註解',
        ],
        answer: 0,
        explain: '`satisfies` 要求物件符合型別，物件字面值多出型別沒有的屬性時，TypeScript 報 TS2353（Object literal may only specify known properties）。這讓 mock 跟著規格走：規格沒有的欄位進不了 mock。MSW 執行時不檢查型別；`satisfies` 是編譯時的檢查，不只是註解。',
      },
      {
        q: '設計稿上每筆預約要顯示醫師姓名，但 `GET /appointments` 回的 `AppointmentOut` 只有 `session_id`。交給 AI 的指示該怎麼寫這件事？',
        options: [
          '讓 AI 從 `session_id` 推算出醫師，畫面先完整呈現',
          '請 AI 在 `schema.d.ts` 加上 `doctor_name`，讓型別檢查通過',
          '要求 AI 不要自己加欄位或猜 API，把這項列在回報的「缺口」一節，交給後端決定',
          '先寫死一個假的醫師姓名，之後再換',
        ],
        answer: 2,
        explain: '規格沒有的資料要列成缺口，由後端決定加欄位或另開端點。讓模型推算或寫死假資料，畫面看起來完整，接上真的後端才出錯；手改產生的型別檔會讓型別說謊，下次產生就消失。在限制裡寫明「列出來、不要補」，模型才知道這是可以接受的答案。',
      },
    ],
  },
  {
    skill: 'ai-review-diff',
    questions: [
      {
        q: '任務是「修掉清單閃爍」，AI 交回的分支 `git diff --stat main...HEAD` 如下。照由外往內的順序，下一步是什麼？',
        code: ` package-lock.json                      | 41 +++++
 package.json                           |  1 +
 src/api/schema.d.ts                    |  2 +
 src/components/AppointmentList.spec.ts |  6 +-
 src/components/AppointmentList.vue     |  3 +-
 5 files changed, 49 insertions(+), 4 deletions(-)`,
        lang: 'bash',
        options: [
          '從 `package-lock.json` 開始逐行讀，每個檔案都讀完再判斷',
          '直接跑測試，綠燈就合併',
          '只讀 `AppointmentList.vue`，其他檔案都是工具自動產生的，不用看',
          '先問為什麼動了 `package.json` 與產生的 `schema.d.ts`，再看測試檔的 diff，最後才讀元件的邏輯',
        ],
        answer: 3,
        explain: '修閃爍不需要新套件，也不該手改產生的型別檔，這兩項不用讀內容就要先問原因；測試檔的改動是第二個要看的，可能是改期望值讓測試通過。逐行從 lock 檔讀起最耗時間又最容易漏；測試可能已經被改過，綠燈不代表正確。',
      },
      {
        q: '審查分支時，`git diff main...HEAD`（三個點）和 `git diff main..HEAD`（兩個點）差在哪裡？',
        options: [
          '三個點比的是分支岔出去的那一點到 `HEAD`，只有這個分支的改動；兩個點直接比兩邊的最新狀態，`main` 之後合進去的改動也會混進來',
          '兩者完全相同，只是寫法不同',
          '三個點會包含尚未 commit 的改動，兩個點不會',
          '兩個點只比較檔名，三個點才比較內容',
        ],
        answer: 0,
        explain: '`git diff A...B` 比的是 A 與 B 的共同祖先（merge base）到 B，也就是這個分支自己的改動；`git diff A..B` 等於 `git diff A B`，直接比兩個 commit。用兩個點審查時，別人在 `main` 新合進來的改動會看起來像被這個分支刪掉。兩者都比較內容，也都不含未 commit 的改動。',
      },
      {
        q: '`AppointmentPage.vue` 已經 640 行，要請 AI 把取消 Dialog 與篩選拆出去。哪一種做法最能確認拆完之後行為沒變？',
        options: [
          '請 AI 一次拆成五個元件，順便修掉發現的 bug',
          '先拆完，再請 AI 補測試確認拆完的版本能動',
          '先寫特徵測試記下現在的行為，再一次拆一塊，每一步跑測試、各自一個 commit',
          '拆完之後在瀏覽器點一遍，看起來一樣就好',
        ],
        answer: 2,
        explain: '特徵測試記錄的是拆分前的行為，拆完仍要通過，才證明行為沒變；一次拆一塊、各自 commit，壞了也知道是哪一步。拆完才補的測試描述的是拆完的版本，看不出差異；順便修 bug 會把行為改變藏在搬移裡；在瀏覽器點一遍容易漏掉請求參數與邊界狀態。',
      },
    ],
  },
]

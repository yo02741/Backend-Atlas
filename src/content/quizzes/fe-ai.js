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
]

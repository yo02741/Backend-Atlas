// 前端路線：UI 元件詞彙 的技能內文（以技能 id 為 key）
export default {
  'ui-states': {
    map: {
      names: [
        { n: 'default、hover、active', t: '平常的樣子、滑鼠移上去（`:hover`）、按下去的那一刻（`:active`）；觸控裝置沒有 hover，只在 hover 才出現的資訊在手機上看不到。' },
        { n: 'focus 與 `:focus-visible`', t: '用鍵盤 Tab 到元件時的外框；`:focus-visible` 只在瀏覽器判斷需要顯示焦點時套用（多半是鍵盤操作），滑鼠點按鈕時不出現。' },
        { n: 'disabled 與 `aria-disabled`', t: '`disabled` 屬性讓元件不能操作、Tab 也會跳過；要讓使用者知道它存在與停用原因時，改用 `aria-disabled="true"`，元素仍拿得到焦點，點擊要自己擋。' },
        { n: 'loading（送出中）', t: '按鈕送出後顯示 spinner 或「送出中…」、停用、寬度不變；區塊載入中顯示 Skeleton，並在容器加 `aria-busy="true"`。' },
        { n: 'error（invalid）', t: '欄位驗證失敗：紅框之外要有文字訊息，欄位加 `aria-invalid="true"`，用 `aria-describedby` 指向那段訊息。' },
        { n: 'selected、current、pressed', t: '被選取的那一筆、導覽列的目前頁（`aria-current="page"`）、切換按鈕的開關（`aria-pressed`）；除了顏色還要有勾選、色條或文字。' },
        { n: '狀態表', t: '元件 × 狀態的表格，每格寫外觀（token、邊框、游標）與行為（能不能點、焦點去哪），規格與驗收都照它。' },
      ],
      ask: [
        '每個元件有哪些狀態，以及每個狀態的外觀：顏色 token、邊框、游標、文字',
        '每個狀態能不能操作：停用時拿不拿得到焦點、停用原因怎麼告訴使用者',
        '送出中的按鈕怎麼呈現、連點會不會送出第二次',
        '焦點外框的樣式與對比，不能只寫 `outline: none` 而沒有替代樣式',
        '觸控裝置沒有 hover 時，原本 hover 才顯示的資訊放在哪裡',
      ],
      prompt: '「確認掛號」按鈕的狀態表：default 用 `--color-primary` 底；hover 加深一階；`:focus-visible` 顯示 2px 外框，和背景的對比至少 3:1；active 往下位移 1px；送出中顯示 spinner 與「送出中…」，寬度不變、設成 `disabled`，連點只送出一次。表單有欄位錯誤時按鈕維持可按，送出後把焦點移到第一個錯誤欄位，欄位加 `aria-invalid` 與 `aria-describedby`。病患清單的選取列用左側色條與勾選圖示表示，不只換底色。',
      verify: [
        { c: '強制狀態', t: 'Elements 分頁選取按鈕，在 Styles 窗格按 `:hov`，逐一勾 `:hover`、`:active`、`:focus-visible` 看樣式；勾了沒有變化，代表那個狀態沒寫樣式。' },
        { c: '只用鍵盤走一遍', t: '只用 Tab、Shift+Tab、Enter、Space 操作整個畫面，每一步都要看得到焦點在哪；看不到時在 Styles 窗格找 `outline: none`。' },
        { c: '連點只送一次', t: '送出時連點三次，Network 分頁的 `Fetch/XHR` 只能有一筆 POST；出現兩筆，代表只改了樣式沒停用，或停用寫在 `await` 之後。' },
        { c: '不只靠顏色', t: 'Rendering 分頁的 `Emulate vision deficiencies` 選 `Achromatopsia (no color)`，選取、錯誤、停用仍要分得出來。' },
        { c: '輔助科技讀得到狀態', t: 'Elements 分頁的 Accessibility 窗格看元件的 Name 與狀態（disabled、pressed、invalid），和畫面上的狀態要一致；AI 產生的元件常常只換了 class。' },
      ],
    },
    points: [
      { b: '至少五個狀態', t: '可操作的元件都有 default、hover、focus、active、disabled；和資料有關的再加 loading、error、selected。規格少寫一個，寫程式的人或 AI 就會自己決定它長什麼樣。' },
      { b: '`:focus-visible` 取代拿掉外框', t: '`outline: none` 讓鍵盤使用者找不到焦點。改寫 `:focus-visible` 的樣式：滑鼠點擊時不顯示、鍵盤操作時顯示（Baseline：2022 年 3 月起主要瀏覽器都支援）。' },
      { b: '停用要說原因', t: '原生 `disabled` 的按鈕拿不到焦點，螢幕閱讀器使用者 Tab 不到，也不知道它存在。需要說明時用 `aria-disabled="true"`，原因寫在旁邊。' },
      { b: '送出中先停用再等待', t: '按下送出時同步把狀態設成 submitting，再 `await` 請求；停用寫在 `await` 之後，第二次點擊在那之前就送出了。' },
      { b: '狀態不只靠顏色', t: '錯誤加圖示與文字、選取加勾選或色條。元件邊界與焦點外框和相鄰顏色的對比至少 3:1（WCAG 2.2 的 1.4.11 Non-text Contrast）。' },
    ],
    checklist: [
      '能為一個按鈕寫出完整的狀態表：每個狀態的外觀與能不能操作',
      '能用 `:hov` 強制狀態與鍵盤操作，逐一驗收每個狀態',
      '能說明 `disabled` 與 `aria-disabled` 的差別與各自的使用時機',
    ],
    refs: [
      { label: 'MDN：:focus-visible', url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible' },
      { label: 'MDN：aria-disabled', url: 'https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-disabled' },
      { label: 'W3C：Understanding SC 2.4.7 Focus Visible', url: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html' },
      { label: 'W3C：Understanding SC 1.4.11 Non-text Contrast', url: 'https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html' },
    ],
  },
  'feedback': {
    map: {
      names: [
        { n: 'Toast（Snackbar）', t: '畫面角落短暫出現的訊息，確認剛完成的操作，例如「已取消 11/20 的預約」；幾秒後自動消失，可附「復原」；不擋操作，不適合放需要讀完或處理的錯誤。' },
        { n: 'Alert（inline）與 Banner', t: '留在相關內容旁邊、不會自己消失的訊息，寫出發生什麼事與怎麼處理；整頁層級的放在頁面上方，叫 Banner。' },
        { n: 'Skeleton', t: '資料回來前用灰色區塊畫出接近最終版面的輪廓，資料進來時版面不跳動；適合版面已知的清單與卡片。' },
        { n: 'Spinner 與 Progress bar', t: 'Spinner 表示「在等，不知道要多久」，用在按鈕內或短暫的等待；Progress bar 有百分比，用在上傳、匯出這類知道進度的工作。' },
        { n: 'Empty state', t: '沒有資料時的畫面：說明為什麼空（第一次使用、篩選後沒有結果、全部處理完）與下一步的按鈕，不留一張空白表格。' },
        { n: '確認 Dialog', t: '擋住其他操作、要使用者做決定的浮層，例如「確定取消預約？」；只用在不可逆或代價高的操作。' },
        { n: '`role="status"` 與 `role="alert"`', t: 'live region：內容改變時螢幕閱讀器會念出來；`status` 等使用者閒下來再念（polite），`alert` 立刻打斷（assertive），只給錯誤用。' },
      ],
      ask: [
        '每種操作結果（成功、失敗、等待、沒有資料）各用哪個元件、放在畫面哪裡',
        '訊息停多久、會不會自己消失、有沒有復原或重試',
        '錯誤訊息的文案：發生什麼事、使用者能做什麼，不顯示錯誤碼原文或 stack trace',
        'Empty state 分成哪幾種情況，各自的文案與按鈕',
        '等待超過多久才顯示 Spinner 或 Skeleton，避免閃一下就消失',
      ],
      prompt: '取消預約成功時右下角顯示 Toast「已取消 11/20 09:30 的預約」，5 秒後消失，附「復原」按鈕；滑鼠移上去或取得焦點時暫停倒數，容器用 `role="status"` 並在頁面載入時就放好。取消失敗不用 Toast，在該列下方顯示 inline Alert，寫出原因（例如「已過可取消時間」）與「重新整理」按鈕，用 `role="alert"`。清單載入中顯示 5 列 Skeleton，列高與真實資料相同；篩選後沒有結果顯示 Empty state「沒有符合條件的預約」與「清除篩選」按鈕，和「這天沒有預約」分開。',
      verify: [
        { c: '版面不跳動', t: '用 Lighthouse 或 Performance 分頁看載入時的 CLS；Skeleton 換成資料時下面的內容被往下推，代表 Skeleton 的高度和真實列不同。' },
        { c: 'live region 先放好', t: 'Elements 分頁確認 Toast 容器在第一次出現訊息之前就在 DOM 裡、帶 `role="status"`；訊息出現時才插入整個帶 `role="status"` 的元素，部分螢幕閱讀器不會念。' },
        { c: '訊息停得夠久', t: 'Toast 出現後按 Tab 移到「復原」，倒數要暫停；還沒移到就消失，代表時間太短或沒有暫停。' },
        { c: '空與錯分開', t: 'Network 分頁在清單 API 上按右鍵選 `Block request URL` 再重新整理，畫面要是錯誤訊息加重試，不能是「這天沒有預約」。' },
        { c: '錯誤文案', t: '讓 API 回 500，畫面上不該出現 `Internal Server Error`、`TypeError` 或 JSON 原文。' },
      ],
    },
    points: [
      { b: '依「要不要處理」選元件', t: '只需要知道結果用 Toast；需要讀完或處理用 inline Alert；需要做決定用 Dialog；等待中用 Skeleton 或 Spinner。' },
      { b: '錯誤留在原處', t: 'Toast 幾秒就消失，使用者可能沒看到。錯誤訊息放在出錯的區塊旁邊，留到使用者處理或重試為止。' },
      { b: 'Skeleton 和真實版面一樣高', t: '列數、列高、欄寬接近實際的資料，資料進來時不推動下面的內容；Spinner 換成整張表格時，版面通常會跳。' },
      { b: 'Empty state 分三種', t: '第一次使用（引導建立第一筆）、篩選後沒有結果（清除篩選）、全部處理完（說明已完成）。三種的文案與按鈕不同，也都和錯誤畫面不同。' },
      { b: 'live region 先放好', t: '`role="status"`、`role="alert"` 的容器在頁面載入時就在 DOM 裡，之後只換內容。WCAG 2.1 起的 4.1.3 Status Messages 要求狀態訊息不搶焦點也能被輔助科技讀到。' },
    ],
    checklist: [
      '能為成功、失敗、等待、沒有資料四種結果各選一個元件，說出放的位置與停留方式',
      '能寫出三種 Empty state 的文案與按鈕',
      '能用 Network 與 Elements 分頁驗證錯誤和空狀態沒有混在一起、訊息念得出來',
    ],
    refs: [
      { label: 'MDN：ARIA status role', url: 'https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/status_role' },
      { label: 'MDN：ARIA alert role', url: 'https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/alert_role' },
      { label: 'W3C：Understanding SC 4.1.3 Status Messages', url: 'https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html' },
      { label: 'web.dev：Cumulative Layout Shift (CLS)', url: 'https://web.dev/articles/cls' },
    ],
  },
}

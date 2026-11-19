// 題庫：UI 元件詞彙
export default [
  {
    skill: 'ui-states',
    questions: [
      {
        q: '設計師要求「滑鼠點了按鈕之後不要留一圈外框」，同時鍵盤使用者要看得到焦點。焦點樣式該怎麼寫？',
        options: [
          '`button:focus { outline: none; }`，鍵盤使用者靠 hover 樣式辨認目前位置',
          '在 `mousedown` 事件裡呼叫 `blur()`，讓按鈕點完就失去焦點',
          '只對 `:focus-visible` 寫明顯的外框：鍵盤操作時顯示，滑鼠點按鈕時通常不顯示',
          '外框顏色改成和背景相同，看不到但焦點仍然存在',
        ],
        answer: 2,
        explain: '`:focus-visible` 由瀏覽器判斷該不該顯示焦點，用 Tab 移動時成立、滑鼠點按鈕時通常不成立，正好符合兩邊的要求（Baseline：2022 年起主要瀏覽器都支援）。拿掉 outline 或讓外框和背景同色，鍵盤使用者都找不到焦點；鍵盤操作不會觸發 hover；用 `blur()` 硬把焦點拿掉，焦點會離開使用者正在操作的元件，接下來的鍵盤操作與螢幕閱讀器都跟著受影響。',
      },
      {
        q: '按鈕寫成 `<button :disabled="submitting" @click="submit">`。Network 分頁的節流選 `3G`，快速點兩次會怎樣？',
        code: `async function submit() {
  const res = await fetch('/api/appointments', { method: 'POST', body: payload })
  submitting.value = true
  // …處理回應
  submitting.value = false
}`,
        lang: 'js',
        options: [
          '送出兩筆 POST：停用寫在 `await` 之後，第一個請求回來前按鈕都還能按',
          '只送一筆，瀏覽器會合併內容相同的 POST',
          '只送一筆，`:disabled` 會在第一次點擊時立刻生效',
          '第二次點擊會自動取消第一個請求，最後只有一筆成功',
        ],
        answer: 0,
        explain: '`submitting.value = true` 在 `await fetch(…)` 之後，請求進行中的那幾秒按鈕沒有停用，第二次點擊又送了一筆。停用要在 `await` 之前同步設定，處理函式開頭再檢查一次。瀏覽器不會合併 POST；fetch 也不會自己取消前一個請求。跨分頁或重新整理後的重送，還要靠伺服器的冪等鍵。',
      },
      {
        q: '「確認掛號」在必填欄位沒填完時不能送出。原因要讓滑鼠、鍵盤與螢幕閱讀器使用者都知道，哪種做法最合適？',
        options: [
          '加上 `disabled` 屬性，滑鼠移上去時用 Tooltip 說明原因',
          '按鈕保持可按；按下後列出缺少的欄位，把焦點移到第一個錯誤欄位',
          '加上 `disabled` 屬性，並把按鈕改成灰色',
          '欄位填完之前隱藏按鈕，填完才顯示',
        ],
        answer: 1,
        explain: '`disabled` 的按鈕拿不到焦點，鍵盤與螢幕閱讀器使用者 Tab 不到它，也看不到 Tooltip；只換成灰色是只靠顏色、沒有原因；隱藏按鈕讓使用者不知道下一步在哪。保持可按、送出時指出缺什麼並移動焦點，三種使用者都知道原因。另一個做法是 `aria-disabled="true"` 加上旁邊寫出原因。',
      },
    ],
  },
  {
    skill: 'feedback',
    questions: [
      {
        q: '取消預約失敗，原因是「已過可取消時間」。這個訊息用哪個元件呈現？',
        options: [
          'Toast，3 秒後自動消失，不打擾使用者',
          '確認 Dialog，使用者按「確定」才能繼續操作',
          '頁面標題旁閃一下紅色的圖示',
          '在該列下方的 inline Alert，寫出原因，留到使用者處理為止',
        ],
        answer: 3,
        explain: '失敗而且使用者需要知道原因的訊息，放在出錯的位置、不自己消失，用 inline Alert（`role="alert"`）。Toast 幾秒就消失，使用者可能沒看到而以為成功；Dialog 用在需要使用者做決定的情況；只閃一下圖示沒有說明原因，也只靠顏色。',
      },
      {
        q: '網路斷掉時，這段程式會讓畫面顯示什麼？',
        code: `async function load() {
  status.value = 'loading'
  try {
    const res = await fetch('/api/appointments?date=2026-11-20')
    items.value = await res.json()
  } catch {
    items.value = []
  }
  status.value = items.value.length ? 'success' : 'empty'
}`,
        lang: 'js',
        options: [
          '錯誤訊息，因為 fetch reject 時 Vue 會把 `status` 設成 error',
          'Empty state「這天沒有預約」：`catch` 把清單設成空陣列，最後被判斷成 empty',
          '一直停在 loading，因為 `catch` 之後的程式不會執行',
          '上一次成功載入的清單，因為 `items` 不會被改動',
        ],
        answer: 1,
        explain: '網路錯誤讓 fetch reject，進到 `catch` 把清單設成 `[]`，`catch` 之後的程式照常執行，`status` 被判斷成 empty。使用者看到「沒有預約」，會以為是休診日。錯誤要有自己的狀態與畫面：`catch` 裡設 `status.value = \'error\'`，不改資料。Vue 不會自己改 `status`。',
      },
      {
        q: 'Toast 用 `v-if` 在有訊息時才插入 `<div role="status">訊息</div>`。使用者回報螢幕閱讀器有時沒有念出 Toast。怎麼修？',
        options: [
          '容器在頁面載入時就放好並帶 `role="status"`，之後只更換裡面的內容',
          '改成 `role="alert"`，讓每一則訊息都立刻打斷朗讀',
          'Toast 出現時把焦點移到 Toast 上',
          '在 Toast 上加 `aria-hidden="true"`，避免重複朗讀',
        ],
        answer: 0,
        explain: 'live region 要在內容改變之前就存在，螢幕閱讀器才會監看它；訊息出現時才插入整個 `role="status"` 元素，部分螢幕閱讀器不會念。`role="alert"` 會打斷使用者，只給錯誤用；把焦點移到 Toast 會打斷正在做的事；`aria-hidden="true"` 讓它完全不被念出。',
      },
    ],
  },
  {
    skill: 'buttons-inputs',
    questions: [
      {
        q: '使用者在這個掛號表單按「回上一步」，會發生什麼事？',
        code: `<form @submit.prevent="book">
  <label for="phone">手機</label>
  <input id="phone" type="tel" autocomplete="tel">
  <button @click="step--">回上一步</button>
  <button type="submit">確認掛號</button>
</form>`,
        lang: 'html',
        options: [
          '只回到上一步，`<button>` 沒寫 `type` 時不做任何事',
          '回到上一步，接著也送出表單：表單裡沒寫 `type` 的 `<button>` 會送出表單',
          '什麼都不會發生，`@click` 在表單裡會被 `@submit.prevent` 擋下',
          '只送出表單，`@click` 的處理函式不會執行',
        ],
        answer: 1,
        explain: '表單裡沒寫 `type` 的 `<button>` 是送出按鈕：點擊時先執行 `@click`（`step--`），接著觸發表單的 `submit` 事件，`book` 也被呼叫。`.prevent` 只取消瀏覽器重新載入頁面的預設行為，不會擋住 `submit` 事件本身。不送出的按鈕要寫 `type="button"`。',
      },
      {
        q: '設定頁的「接收簡訊提醒」，需求是使用者一切換就立即生效。哪個元件最合適？',
        options: [
          'Checkbox，下方再放一顆「儲存」按鈕',
          '兩個 Radio：「接收」與「不接收」，加上「儲存」按鈕',
          'Select，選項是「開」與「關」',
          'Switch（`role="switch"` 加 `aria-checked`），切換後立即儲存並顯示結果',
        ],
        answer: 3,
        explain: 'Switch 表示一個立即生效的開關，螢幕閱讀器會念出它是開關以及目前開或關。Checkbox 加「儲存」適合要按下儲存才生效的設定，和需求不符；只有兩個值時用 Radio 或 Select 多一層操作，也同樣暗示要另外確認。Switch 的 label 不隨狀態改變（APG 的 Switch 模式）。',
      },
      {
        q: '「手機」欄位只寫了 `<input type="tel" placeholder="例如 0912345678">`，沒有 `<label>`。這樣寫實際的問題是什麼？',
        options: [
          '開始輸入後提示文字消失，回頭檢查時看不出這格是什麼；點文字聚焦欄位、說明連結這些 label 提供的東西也都沒有',
          'placeholder 的文字會跟著表單一起送出，後端收到的值會多一段範例',
          '手機上會跳出英文鍵盤，因為 placeholder 會蓋過 `type="tel"` 的設定',
          '瀏覽器會把 placeholder 當成預設值，必填驗證永遠不會失敗',
        ],
        answer: 0,
        explain: 'placeholder 只在欄位空白時顯示，輸入後就看不到這格的名稱。部分瀏覽器會拿 placeholder 當最後的備用名稱，但它不是可靠的 label，也沒有點文字聚焦欄位的效果。placeholder 不會被送出、不影響 `type` 決定的鍵盤，也不是欄位的值。',
      },
    ],
  },
  {
    skill: 'select-combobox',
    questions: [
      {
        q: '可輸入的「看診醫師」Combobox 清單開著，使用者按 ↓ 移到第三個選項。照 WAI-ARIA APG 的做法，這時 DOM 焦點在哪裡？',
        options: [
          '第三個選項上，每個 `role="option"` 都設了 `tabindex="0"`',
          '清單容器（`role="listbox"`）上，由它記住反白的是哪一項',
          '仍在輸入框；輸入框的 `aria-activedescendant` 指向第三個選項的 id',
          '頁面的 `body`，選項只靠 CSS 的 `:hover` 樣式反白',
        ],
        answer: 2,
        explain: 'APG 的 Combobox 讓 DOM 焦點留在輸入框，使用者可以繼續打字；輔助科技靠 `aria-activedescendant` 知道反白的是哪個選項。每個選項都設 `tabindex="0"` 會讓 Tab 一格一格走進清單；焦點掉到 `body` 或只靠樣式，螢幕閱讀器完全不知道目前在哪一項。',
      },
      {
        q: '病患搜尋的 Autocomplete 寫成下面這樣。使用者快速輸入「王小明」，會出什麼問題？',
        code: `watch(keyword, async (q) => {
  const res = await fetch(\`/api/patients?q=\${encodeURIComponent(q)}\`)
  options.value = await res.json()
  expanded.value = true
})`,
        lang: 'js',
        options: [
          '`encodeURIComponent` 會把中文編成亂碼，伺服器查不到資料',
          '每打一個字送一個請求、沒有最少字數，慢的舊回應晚到時會蓋掉「王小明」的結果',
          '`watch` 只在元件掛載時執行一次，之後的輸入不會觸發查詢',
          '`fetch` 會自動取消前一個還沒回來的請求，只會顯示第一個字的結果',
        ],
        answer: 1,
        explain: '每次 `keyword` 改變都送出請求，回應的順序不保證，「王」的結果晚到就會蓋掉「王小明」。要加 debounce 與最少字數，並用 `AbortController` 取消前一個請求或只採用最後一次的回應。`encodeURIComponent` 會把中文正確編成 UTF-8；`watch` 每次改變都會執行；`fetch` 不會自己取消前一個請求。',
      },
      {
        q: '掛號頁的「科別」有 12 個固定選項、只能選一個，外觀不需要特別設計，使用者多半用手機。哪個做法最合適？',
        options: [
          '用 `div` 自己畫一個下拉選單，外觀才能完全照設計稿',
          '可輸入的 Combobox，讓使用者打字篩選科別',
          'Autocomplete，每次開啟清單時向 API 查詢科別',
          '原生 `<select>`：鍵盤、螢幕閱讀器與手機的系統選單都內建',
        ],
        answer: 3,
        explain: '選項固定、只能選一個、外觀沒有特別要求時，原生 `<select>` 最省事也最穩：手機上會跳出系統的選單，鍵盤與螢幕閱讀器都不用額外處理。自己畫要照 APG 補齊鍵盤與 ARIA；12 個固定選項不需要打字篩選，更不需要每次查 API。',
      },
    ],
  },
  {
    skill: 'overlays',
    questions: [
      {
        q: '確認 Dialog 寫成下面這樣。Dialog 開著時，使用者按 Tab 與 Esc 會怎樣？',
        code: `<button @click="open = true">取消預約</button>
<dialog :open="open">
  <p>確定取消 11/20 的預約？</p>
  <button @click="open = false">保留預約</button>
</dialog>`,
        lang: 'html',
        options: [
          '焦點留在 Dialog 裡，按 Esc 會關閉，和 `showModal()` 的效果一樣',
          'Tab 會走到 Dialog 後面的頁面元素、Esc 不會關閉：設定 `open` 屬性開出的是非 modal 的 Dialog',
          '瀏覽器丟出 `InvalidStateError`，Dialog 不會出現',
          'Dialog 不會顯示，`<dialog>` 只能用 JavaScript 的方法開啟',
        ],
        answer: 1,
        explain: '直接設定 `open` 屬性開出的是非 modal 的 Dialog：不在 top layer、沒有 `::backdrop`、背景沒有 inert，Esc 也不會關閉它。要 modal 的行為，用 template ref 呼叫 `showModal()`，關閉用 `close()`。`InvalidStateError` 是對已經用 `open` 打開的 Dialog 再呼叫 `showModal()` 時才會出現。',
      },
      {
        q: '使用者在確認 Dialog 按下「確定取消」，那一列預約從清單上移除，開啟 Dialog 的「取消預約」按鈕也不在了。焦點應該放在哪裡？',
        options: [
          '`body`，讓使用者自己從頭開始 Tab',
          '頁首的第一個連結，讓使用者重新選擇要去哪裡',
          '留在已經關閉的 Dialog 裡的「確定取消」按鈕上',
          '清單的標題或下一列，這類接得上工作流程的元素',
        ],
        answer: 3,
        explain: 'APG 的 Dialog 模式：關閉後焦點回到開啟它的元素；那個元素不存在時，移到接得上工作流程的元素，例如清單標題（`tabindex="-1"`）或下一列。焦點掉到 `body` 或頁首，鍵盤使用者要從頭 Tab 回來；關閉的 Dialog 不在畫面上，焦點留在裡面會變成看不見的位置。',
      },
      {
        q: '科別名稱旁的 ⓘ 要顯示「本科每週三休診」與一個「查看門診表」連結。用哪種浮層？',
        options: [
          'Popover（或非 modal 的 Dialog）：裡面的連結拿得到焦點，點外面或按 Esc 關閉',
          'Tooltip（`role="tooltip"`），hover 與 focus 時出現',
          'modal Dialog，開啟時擋住整個頁面',
          '用 `title` 屬性，讓瀏覽器顯示內建的提示',
        ],
        answer: 0,
        explain: '內容裡有連結就需要能把焦點移進去，APG 建議這種情況用非 modal 的 Dialog，原生的 `popover` 也適合。Tooltip 本身拿不到焦點，連結鍵盤到不了；modal Dialog 對一段補充說明太重；`title` 的提示多半只在滑鼠停留時出現，鍵盤與觸控使用者看不到，也不能放連結。',
      },
    ],
  },
  {
    skill: 'navigation-ui',
    questions: [
      {
        q: '後台頂端有「預約」「病患」「報表」三個項目，點了會換網址、載入不同頁面。哪個寫法最合適？',
        options: [
          '`role="tablist"` 加三個 `role="tab"`，因為外觀看起來像分頁',
          '`<nav>` 裡的連結清單，目前頁的連結加 `aria-current="page"`',
          '三個 `<button>`，點擊時用 JavaScript 改 `location.href`',
          '三個 `<div>` 加 `@click`，目前頁換一個底色',
        ],
        answer: 1,
        explain: '會換網址的導覽用連結：可以在新分頁開、可以複製網址，`aria-current="page"` 告訴輔助科技目前在哪一頁。Tabs 是同一頁切換內容，用在主選單會讓螢幕閱讀器使用者以為頁面沒換；按鈕改 `location.href` 失去連結的行為；`div` 拿不到焦點，也沒有角色。',
      },
      {
        q: '照 WAI-ARIA APG 的 Tabs 模式（並用 JavaScript 實作方向鍵），焦點在「預約」時按 → 與按 Tab 分別會怎樣？',
        code: `<div role="tablist" aria-label="預約狀態">
  <button role="tab" aria-selected="true"  tabindex="0">預約</button>
  <button role="tab" aria-selected="false" tabindex="-1">已報到</button>
  <button role="tab" aria-selected="false" tabindex="-1">已取消</button>
</div>`,
        lang: 'html',
        options: [
          '→ 沒有作用；Tab 移到「已報到」',
          '→ 與 Tab 都移到「已報到」',
          '→ 移到「已報到」（自動切換時也顯示它的內容）；Tab 離開分頁列、進入目前的 tabpanel',
          '→ 讓頁面往右捲動；Tab 依序走過三個分頁',
        ],
        answer: 2,
        explain: 'APG 的 Tabs：左右方向鍵在分頁之間移動，Tab 鍵離開分頁列進入內容。只有目前的分頁是 `tabindex="0"`，其他是 `-1`（roving tabindex），所以 Tab 鍵不會一格一格走過每個分頁。方向鍵的行為要自己用 JavaScript 實作，瀏覽器不會因為 `role="tab"` 就自動處理。',
      },
      {
        q: '預約清單在第 4 頁，點進一筆詳細資料再按瀏覽器的上一頁，畫面回到第 1 頁。最可能的原因與修法是什麼？',
        options: [
          '頁碼只存在元件的 `ref` 裡，回來時元件重建就重設；把頁碼寫進網址 `?page=4`',
          '瀏覽器的上一頁會清掉所有 JavaScript 狀態，前端沒有辦法處理',
          'API 沒有回傳總頁數，前端不知道該回到第幾頁',
          '要改成無限捲動，按上一頁才會回到原位',
        ],
        answer: 0,
        explain: '頁碼只放在元件狀態裡，離開頁面時元件被卸載，回來重建就是預設的第 1 頁。寫進網址的 query，上一頁、重新整理、分享連結都會帶著頁碼。總頁數與回到第幾頁無關；無限捲動回上一頁時更難還原位置。',
      },
    ],
  },
  {
    skill: 'data-display',
    questions: [
      {
        q: '預約表格每頁 20 筆、共 134 筆。前端拿到這一頁的 20 筆後，用 `items.value.sort()` 依姓名排序。使用者按「姓名」排序後看到什麼？',
        options: [
          '全部 134 筆依姓名排序後的前 20 筆',
          '這一頁的 20 筆在頁內重新排列，其他頁的資料沒有參與排序',
          '瀏覽器自動向 API 要其他頁的資料，合併後再排序',
          '排序會失敗，因為 `sort()` 不能排中文字串',
        ],
        answer: 1,
        explain: '前端手上只有這一頁，`sort()` 只能排這 20 筆，第 2 頁可能有排在更前面的姓名。有分頁時排序要交給 API（例如 `?sort=name&order=asc`），Network 分頁會看到新的請求。`sort()` 可以排中文，只是預設依 UTF-16 碼位排，需要語系排序時用 `localeCompare`。',
      },
      {
        q: '想讓表頭的全選框在部分勾選時顯示 indeterminate（橫線），在 HTML 寫了下面這段。結果會怎樣？',
        code: `<th>
  <input type="checkbox" aria-label="全選" indeterminate>
</th>`,
        lang: 'html',
        options: [
          '顯示 indeterminate，直到使用者點擊為止',
          '顯示成已勾選，任何多出來的屬性都會讓 checkbox 變成 checked',
          '顯示成未勾選：`indeterminate` 沒有對應的 HTML 屬性，要用 JavaScript 設 `el.indeterminate = true`',
          '瀏覽器丟出錯誤，checkbox 不會顯示',
        ],
        answer: 2,
        explain: '`indeterminate` 只是 DOM 的 property，寫在 HTML 裡沒有作用，checkbox 照常顯示成未勾選。要用 JavaScript 設定；Vue 的 `:indeterminate="…"` 綁定會設這個 property。未知的 HTML 屬性不會讓 checkbox 變成 checked，也不會丟錯。',
      },
      {
        q: '預約表格有 6 欄，在 390px 寬的手機上超出畫面。下列哪個做法違反「整頁不能左右滑」的驗收條件？',
        options: [
          '表格包在 `overflow-x: auto` 的容器裡，第一欄用 `position: sticky` 固定',
          '隱藏病歷號等次要欄位，點一列再看完整資料',
          '每一列改排成一張卡片，每個值旁邊顯示欄名',
          '把 `body` 設成 `min-width: 720px`，讓表格維持桌機版面',
        ],
        answer: 3,
        explain: '`body` 設最小寬度會讓整頁都要左右滑，連文字段落也是。前三種是手機表格的常見做法：橫向捲動只發生在表格自己的容器裡（WCAG 1.4.10 Reflow 允許資料表這樣做）、隱藏次要欄位、改成卡片。',
      },
    ],
  },
  {
    skill: 'design-tokens',
    questions: [
      {
        q: '切到暗色主題（`<html data-theme="dark">`）後，`.btn-primary` 的背景是什麼顏色？',
        code: `:root {
  --blue-600: #1d4ed8;
  --color-primary: var(--blue-600);
}
[data-theme="dark"] { --color-primary: #60a5fa; }
.btn-primary { background: var(--blue-600); }`,
        lang: 'css',
        options: [
          '`#60a5fa`，暗色主題覆寫了主色',
          '`#1d4ed8`：按鈕直接用了基礎 token `--blue-600`，暗色主題只覆寫了語意 token',
          '透明，`var()` 在 `[data-theme]` 底下會失效',
          '兩個值的中間色，瀏覽器會自動混色',
        ],
        answer: 1,
        explain: '暗色主題覆寫的是 `--color-primary`，按鈕卻直接引用 `--blue-600`，所以換主題時它不會變。元件改用 `var(--color-primary)` 就會跟著主題走。custom property 在任何選擇器底下都能覆寫與讀取，瀏覽器也不會混色。',
      },
      {
        q: '品牌主色要從藍色改成綠色，設計師希望只改一個地方。token 怎麼分層才做得到？',
        options: [
          '元件只引用語意 token `--color-primary`，它指向某個基礎色票；只改 `--color-primary` 指向的色票',
          '把 `--blue-600` 的值改成綠色，名字維持不動',
          '每個元件各自寫 hex，用編輯器全域取代',
          '每個元件建立自己的 `--button-blue`、`--link-blue`，再各自改值',
        ],
        answer: 0,
        explain: '語意 token 描述用途，換品牌色時只改它指向哪個基礎色票，所有元件一起變。把 `--blue-600` 改成綠色雖然也會生效，但名字和值對不上，用在資訊提示的藍色也會一起變綠。全域取代 hex 容易漏改或誤改；每個元件一組變數，就要改很多地方。',
      },
      {
        q: '專案已有完整的設計稿與 token，需要 Combobox、Dialog、Tabs，鍵盤與 ARIA 要照 WAI-ARIA APG，外觀必須完全照設計稿。哪個選擇最合適？',
        options: [
          '全部用 `div` 從零自己寫，外觀最自由',
          '用元件庫的預設主題，讓設計稿配合元件庫修改',
          'headless 元件（例如 Reka UI）提供行為、鍵盤與 ARIA，外觀用專案的 token 寫',
          '只用 CSS 框架的 utility class，不需要元件',
        ],
        answer: 2,
        explain: 'headless 元件處理焦點、鍵盤與 ARIA，不帶外觀，正好符合「行為照 APG、外觀照設計稿」。從零自己寫最自由，但 Combobox 與 Dialog 的鍵盤行為要全部自己補；元件庫的預設主題要改設計稿去配合；utility class 只處理樣式，不提供鍵盤與 ARIA。',
      },
    ],
  },
  {
    skill: 'element-plus',
    questions: [
      {
        q: '院方主色是深綠。在 `:root` 寫了 `--el-color-primary: #0b6e4f`，主按鈕變綠了，滑鼠移上去卻是淺藍。原因是什麼？',
        options: [
          '`:root` 的權重比 Element Plus 的規則低，hover 時被元件庫的樣式蓋掉',
          'hover 用的 `--el-color-primary-light-3` 是預先算好的固定色，不會跟著主色重算',
          'Element Plus 的 hover 顏色寫死在 `.el-button:hover` 裡，不能用 CSS 變數改',
          '瀏覽器快取了舊的 `index.css`，重新整理就會變綠',
        ],
        answer: 1,
        explain: '按鈕的 `--el-button-hover-bg-color` 引用 `--el-color-primary-light-3`，這個值是 SCSS 編譯時算好的色碼（預設 `#79bbff`），只改 `--el-color-primary` 不會讓它重算。要把 `light-3` 到 `light-9`、`dark-2` 一起覆寫，或用 SCSS 變數重新產生。主色有變綠，代表變數已經生效，不是權重或快取問題；hover 色也是變數，不是寫死的。',
      },
      {
        q: '使用者第一次送出後，病歷號欄位顯示後端的「查無此病歷號」。他改了病歷號再送，後端回了同一則訊息，這次欄位下沒有字。下面的程式缺了什麼？',
        code: `async function onSubmit() {
  const ok = await formRef.value.validate().catch(() => false)
  if (!ok) return
  const res = await fetch('/api/registrations', { method: 'POST', body: JSON.stringify(payload()) })
  if (res.status === 422) {
    const body = await res.json()
    for (const e of body.errors) serverErrors[FIELD_MAP[e.field]] = e.message
  }
}
// <el-form-item prop="patientNo" :error="serverErrors.patientNo">`,
        lang: 'js',
        options: [
          '`validate()` 之後要呼叫 `formRef.value.clearValidate()`，否則前端驗證會蓋掉後端錯誤',
          '`error` 只能在 `el-form` 的 `rules` 裡設定，不能從 prop 傳入',
          '送出前沒有把 `serverErrors` 清成空字串：`error` 的值沒變，`el-form-item` 不會重新顯示',
          '要用 `nextTick` 包住指定 `serverErrors` 的那一行，畫面才會更新',
        ],
        answer: 2,
        explain: '`el-form-item` 用 `watch` 監看 `error`，值改變時才進入錯誤狀態。第二次送出時 `validate()` 通過、欄位變成 success，紅字消失；後端再回同一則訊息，`error` 從「查無此病歷號」設成「查無此病歷號」，值沒變，`watch` 不觸發。送出前先清空就好。`clearValidate()` 清的是驗證狀態，不會讓同一個值重新觸發；`error` 是 `el-form-item` 的 prop；`nextTick` 不改變「值沒有改變」這件事。',
      },
      {
        q: '櫃台的舊電腦開掛號頁很慢。`vite build` 的輸出有一支 1 MB 的 JS 與 363 KB 的 CSS，頁面只用到表單、按鈕、表格與 Dialog。`main.js` 裡有 `app.use(ElementPlus)` 與 `import \'element-plus/dist/index.css\'`。先做哪件事？',
        options: [
          '改成按需引入：拿掉這兩行，用 unplugin-vue-components 與 unplugin-auto-import 加 `ElementPlusResolver`',
          '保留全量引入，把 Element Plus 切成獨立的 vendor chunk，第二次進頁就有快取',
          '換成 CDN 的 `index.full.min.js`，讓瀏覽器從 CDN 下載比較快',
          '把 `index.css` 改成 `<link rel="preload">`，讓它和 JS 平行下載',
        ],
        answer: 0,
        explain: '全量引入把所有元件與整份樣式放進 bundle；按需引入只帶入模板與 script 用到的元件和它們的 CSS，同一個畫面實測 JS 約 368 KB、CSS 約 93 KB。切 vendor chunk 只改善第二次之後的快取，第一次仍然下載全部；CDN 的完整版一樣是全部元件；preload 改的是下載順序，不改大小。',
      },
    ],
  },
  {
    skill: 'layout-patterns',
    questions: [
      {
        q: '側欄與漢堡按鈕的樣式如下。視窗寬 900px 時，畫面上的導覽是什麼樣子？',
        code: `.nav-toggle { display: none; }
@media (max-width: 767px) {
  .nav-toggle { display: block; }   /* 漢堡按鈕 */
}
@media (max-width: 1023px) {
  .sidebar { display: none; }       /* 側欄 */
}`,
        lang: 'css',
        options: [
          '側欄與漢堡按鈕都看得到，兩者同時存在',
          '側欄隱藏、漢堡按鈕也沒出現，畫面上沒有任何導覽',
          '側欄顯示、漢堡按鈕隱藏，和 1280px 時一樣',
          '只有漢堡按鈕，側欄收進 Drawer',
        ],
        answer: 1,
        explain: '900px 符合 `max-width: 1023px`，側欄被隱藏；但不符合 `max-width: 767px`，漢堡按鈕維持 `display: none`。兩個元件各自決定斷點，中間留下 768 到 1023 的空隙。斷點表上「側欄」一列每一格都填（390 Drawer、768 icon rail…），並在 767、768、1023、1024 各驗收一次，就不會漏。',
      },
      {
        q: '斷點表的四欄寫著 390、768、1024、1280。照 mobile-first 的寫法，「768」那一欄代表什麼？',
        options: [
          '只有視窗剛好 768px 時的樣子，其他寬度由瀏覽器自動縮放',
          '768px 平板的實體解析度，CSS 要用裝置像素來判斷',
          '從 768px 起、到下一個斷點 1024px 之前的樣子；390 是不包在 media query 裡的基礎樣式',
          '用 `max-width: 768px` 寫成的一組樣式，比 768 窄的畫面都套用',
        ],
        answer: 2,
        explain: 'mobile-first 時 390 那一欄是基礎樣式，768、1024、1280 用 `min-width` 往上加，每一欄管「從這個寬度起，到下一個斷點之前」。只用 `min-width`（或範圍語法），邊界就不會重疊；`max-width: 768px` 與 `min-width: 768px` 混用時，剛好 768px 兩條都成立。斷點用的是 CSS 像素，不是裝置的實體像素。',
      },
      {
        q: '只用鍵盤操作長表單，Tab 移到中段的欄位時，焦點框被 `position: sticky` 的頁首蓋住。最直接的修法是什麼？',
        options: [
          '把頁首改成 `position: static`，捲動時不再固定',
          '把每個欄位的 `z-index` 設得比頁首高',
          '每次 `focus` 時用 JavaScript 呼叫 `window.scrollTo(0, 0)`',
          '在 `html` 設 `scroll-padding-top`，數值至少是頁首的高度',
        ],
        answer: 3,
        explain: '`scroll-padding-top` 讓瀏覽器把元素捲進畫面時（Tab 移動焦點、錨點跳轉）預留頂端的空間，焦點不會落在頁首底下，對應 WCAG 2.2 的 2.4.11 Focus Not Obscured。改成 static 是拿掉需求；欄位的 `z-index` 蓋過頁首會讓欄位浮在頁首上面；捲回頂端會讓使用者看不到正在填的欄位。',
      },
    ],
  },
  {
    skill: 'screen-spec',
    questions: [
      {
        q: '畫面規格裡的狀態表（區域 × 狀態），最主要的用途是什麼？',
        options: [
          '列出每個區域在 loading、empty、error 等狀態下出現什麼；空格一眼看出還沒決定的事，驗收時逐格造出來比對',
          '讓設計師不用畫 loading 與 error 的設計稿，由前端自己決定',
          '取代 API 規格，由前端定義每個錯誤的格式',
          '記錄每個元件的 CSS 選擇器，方便寫樣式',
        ],
        answer: 0,
        explain: '狀態表把「每個區域在每個狀態長什麼樣」排成格子，沒想過的狀態就是空格，在動工前就看得出來；驗收時用 Network 的 `Offline`、mock 回空陣列等方式逐格造出來比對。它不取代設計稿或 API 規格，也不是樣式表。',
      },
      {
        q: '取消超過期限時，API 回了下面的 Problem Details。畫面規格的文案表該怎麼寫這一列？',
        code: `{
  "type": "/problems/cancel-deadline-passed",
  "title": "Cancel deadline passed",
  "status": 409,
  "detail": "..."
}`,
        lang: 'json',
        options: [
          '直接顯示 `title`，後端已經寫好說明',
          '顯示「發生錯誤，請稍後再試」，所有錯誤共用一句',
          '依 `type` 對應一句文案，例如「已超過取消期限，請致電櫃台」，不直接顯示英文的 `title`',
          '顯示 HTTP 狀態碼 409，讓使用者自己查原因',
        ],
        answer: 2,
        explain: 'Problem Details 的 `type` 是穩定的識別碼，文案表用它對應畫面上的文字與下一步；`title` 是給開發者看的英文摘要。所有錯誤共用一句話，使用者分不出是期限過了還是系統壞了，也不知道要打給櫃台；狀態碼對使用者沒有意義。',
      },
      {
        q: '「我的掛號」規格的驗收條件，下面哪一條可以直接拿來驗收？',
        options: [
          '手機上的畫面要好看、符合設計稿的風格',
          '390px 寬時 `document.documentElement.scrollWidth > innerWidth` 為 `false`，取消確認改成從底部滑出的 Sheet',
          '操作要流暢，使用者不會覺得卡',
          '錯誤處理要完善，各種情況都要考慮到',
        ],
        answer: 1,
        explain: '可以驗收的條件寫出情況、操作、結果與檢查方法：寬度、指令、看到什麼算通過。「好看」「流暢」「完善」沒有工具能判定通過與否，驗收時只能憑感覺；要改寫成具體的寬度、按鍵、文字或請求數。',
      },
    ],
  },
]

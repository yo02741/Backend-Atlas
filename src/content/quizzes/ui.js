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
]

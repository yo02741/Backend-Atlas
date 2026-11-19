// 題庫：品質：測試、效能、無障礙
export default [
  {
    skill: 'a11y-basics',
    questions: [
      {
        q: '把「儲存」做成 `<div role="button" @click="save">儲存</div>`，和原生的 `<button type="button">` 相比，差在哪裡？',
        options: [
          '沒有差別，`role="button"` 會讓瀏覽器自動補上按鈕的所有行為',
          '螢幕閱讀器念不出「按鈕」，但 Tab 停得到，Enter 也能觸發',
          '螢幕閱讀器會念成按鈕，但 Tab 停不到、Enter 與 Space 沒反應，要自己補 `tabindex="0"` 與按鍵處理',
          '只有樣式不同，換成 `button` 後要重寫所有 CSS',
        ],
        answer: 2,
        explain: 'ARIA 只改變 accessibility tree 裡的資訊：`role="button"` 讓它被念成按鈕，但不會加上任何行為，`div` 不在 Tab 順序裡，也不會因為 Enter、Space 觸發 click。原生的 `button` 這些都有，所以能用原生元素就不用 ARIA。第二個選項把兩件事說反了。',
      },
      {
        q: 'Lighthouse 對這個按鈕報出 `Buttons do not have an accessible name`。最合適的修法是？',
        code: `<button class="icon-btn" type="button" @click="clearDate">
  <svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" /></svg>
</button>`,
        lang: 'html',
        options: [
          '按鈕加 `aria-label="清除日期"`，`svg` 加 `aria-hidden="true"`',
          '按鈕加 `role="button"`，讓螢幕閱讀器知道它是按鈕',
          '按鈕加 `tabindex="0"`，讓它可以被聚焦',
          '按鈕加 `alt="清除日期"`，和圖片一樣提供替代文字',
        ],
        answer: 0,
        explain: '按鈕的名稱預設取自它的文字內容，這顆按鈕只有圖示，所以名稱是空的，螢幕閱讀器只念「按鈕」。`aria-label` 提供名稱，圖示加 `aria-hidden` 避免被當成內容。`button` 本來就是按鈕、本來就能聚焦，`role` 與 `tabindex` 都是多餘的；`alt` 是 `img` 的屬性，放在 `button` 上沒有作用。',
      },
      {
        q: '掛號送出成功後，畫面右上角用 `v-if` 插入一個 `<div role="status">已完成掛號</div>` 的 Toast，3 秒後移除。測試時 NVDA 常常沒有念出這句話。比較可靠的改法是？',
        options: [
          '把 Toast 停留的時間從 3 秒延長到 10 秒',
          '把整個表單加上 `role="alert"`，送出後整個表單都會被念一次',
          '頁面一開始就放一個一直存在的 `role="status"` 容器，送出成功時才改它的文字',
          'Toast 加上 `aria-hidden="true"`，避免和表單的內容一起被念',
        ],
        answer: 2,
        explain: '螢幕閱讀器監聽的是已經存在的 live region 裡的內容變化；容器和訊息同時插進 DOM 時，很多螢幕閱讀器不會念。讓容器一直在、只改文字最可靠。停留更久不會讓它被念出來；`role="alert"` 加在整個表單上會打斷使用者並念出不相干的內容；`aria-hidden` 會讓它完全不被念。',
      },
    ],
  },
  {
    skill: 'a11y-components',
    questions: [
      {
        q: '用 roving tabindex 做的 Tabs，焦點在「預約」時按 →。哪一個檢查最能確認焦點真的移到了「已報到」？',
        options: [
          'Lighthouse 的 Accessibility 分數維持 100',
          '「已報到」加上了 `.is-active` 的 class，畫面上反白',
          'Console 的 live expression `document.activeElement` 變成「已報到」，而且它是唯一 `tabindex="0"` 的 tab',
          '「已報到」的 `aria-controls` 指向一個存在的 tabpanel',
        ],
        answer: 2,
        explain: 'roving tabindex 會真的移動 DOM 焦點，所以 `document.activeElement` 要換成新的 tab，`tabindex="0"` 也跟著換人。class 只代表樣式變了，焦點可能還留在原地；Lighthouse 不會按鍵盤；`aria-controls` 檢查的是結構，和按鍵後焦點去哪無關。',
      },
      {
        q: '這個選單用 axe 掃描是 0 個違規，只用鍵盤卻打不開、走不進去。照 APG 的 Menu Button 模式，最主要缺的是什麼？',
        code: `<button type="button" aria-haspopup="menu" aria-expanded="false" @click="open = !open">更多操作</button>
<ul v-show="open" role="menu" aria-label="更多操作">
  <li role="menuitem" @click="reschedule">改期</li>
  <li role="menuitem" @click="cancel">取消預約</li>
</ul>`,
        lang: 'html',
        options: [
          '`role="menu"` 只能放在 `div` 上，`ul` 要換掉',
          '開選單時把焦點移到第一項（項目要有 `tabindex="-1"` 才能 `focus()`）、方向鍵移動、Esc 關閉並回到按鈕，`aria-expanded` 跟著開關改變',
          '每個 `li` 加 `tabindex="0"`，讓 Tab 鍵可以一項一項走進選單',
          '按鈕改成 `aria-haspopup="true"`，螢幕閱讀器才知道它會開選單',
        ],
        answer: 1,
        explain: 'role 是承諾：寫了 `menu`、`menuitem`，就要兌現 APG 的鍵盤行為，瀏覽器不會自動補上。這段沒有移動焦點、沒有處理方向鍵與 Esc，`aria-expanded` 也寫死成 `false`；axe 只檢查結構，所以掃不出來。每項都 `tabindex="0"` 違反「整組只佔一個 Tab 停留點」；`aria-haspopup` 的 `menu` 與 `true` 都合法。',
      },
      {
        q: '從「更多操作」選單選「取消預約」會開確認用的 `<dialog>`，按 Esc 關掉後焦點掉到 `body`。這個元件的 jsdom 測試全部通過。比較合理的處理是？',
        options: [
          '在 jsdom 裡補一個假的 `showModal()`，讓元件測試也能開 Dialog',
          'Dialog 關閉後一律呼叫 `document.body.focus()`，確保焦點有地方去',
          '在 Dialog 加上 `aria-modal="true"`，讓瀏覽器記住開啟它的按鈕',
          '先關選單、把焦點還給「更多操作」，再開 Dialog；用 Playwright 或 Vitest Browser Mode 測 Esc 之後按鈕是否 `toBeFocused()`',
        ],
        answer: 3,
        explain: '`showModal()` 記下的是開啟當下有焦點的元素；先開 Dialog 再關選單，記下的是之後被隱藏的選單項目，關閉時焦點無處可回。jsdom 的 `<dialog>` 沒有 `showModal()`，這段流程要在真的瀏覽器測。假的 `showModal()` 只測到自己寫的替身；`body.focus()` 就是問題本身；`aria-modal` 不影響焦點還給誰。',
      },
    ],
  },
  {
    skill: 'web-vitals',
    questions: [
      {
        q: '門診看板頁在 Lighthouse 拿到效能 100 分，用 web-vitals 收到的實際數據卻是手機 p75 的 INP 450 毫秒。最合理的解釋是？',
        options: [
          'Lighthouse 沒有人操作、量不到 INP，實際數據來自較慢的手機與真實點擊',
          'web-vitals 套件把 INP 的單位算錯了，數值應該除以 10',
          'Lighthouse 量的是 p75，web-vitals 量的是平均，所以兩者不同',
          'INP 只對桌機有意義，手機上的數值可以忽略不看',
        ],
        answer: 0,
        explain: 'INP 量的是點擊、觸控、按鍵到下一次畫面更新的時間，沒有操作就沒有 INP；Lighthouse 的一般報告用 Total Blocking Time 當替代指標。實際使用者的手機 CPU 比開發用的筆電慢很多，事件處理函式裡的長任務在那裡才明顯。評等看實際數據的 p75，手機與桌機分開算，兩邊都要看。',
      },
      {
        q: '用 web-vitals 6 的評等規則，這三個值各是什麼評等？',
        code: `const thresholds = { LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25] }
const rating = (name, v) =>
  v > thresholds[name][1] ? 'poor'
  : v > thresholds[name][0] ? 'needs-improvement'
  : 'good'

rating('LCP', 2500)
rating('INP', 230)
rating('CLS', 0.26)`,
        lang: 'js',
        options: [
          'needs-improvement、needs-improvement、poor',
          'good、good、needs-improvement',
          'good、needs-improvement、poor',
          'needs-improvement、poor、poor',
        ],
        answer: 2,
        explain: '規則是「大於」門檻才降級：LCP 剛好 2500 不大於 2500，是 good；INP 230 大於 200、不大於 500，是 needs-improvement；CLS 0.26 大於 0.25，是 poor。web-vitals 回報的 `metric.rating` 就是這樣算的，不需要自己再算一次。',
      },
      {
        q: '颱風停診公告由 API 回來後才插在看板上方，高 120px，把整個看板往下推。DevTools 的 `Layout shift culprits` 指向這個公告。最合適的修法是？',
        options: [
          '公告改用 `transform: translateY()` 從上方滑進來，看板不動',
          '公告的 `<div>` 加上 `loading="lazy"`，讓它晚一點出現',
          '等公告的 API 回來之後才顯示整個看板',
          '公告的容器一開始就用 `min-height: 120px` 留好位置，有公告時再填入內容',
        ],
        answer: 3,
        explain: 'CLS 計算的是沒有預期的位移：既有內容被推開才算。先保留空間，公告晚到也不會推動看板。用 `transform` 疊在看板上方會蓋住內容，看板該讓位時還是要改版面；`loading` 只對圖片與 iframe 有作用；整個看板等公告回來，LCP 跟著變慢，用一個指標換另一個。',
      },
    ],
  },
  {
    skill: 'test-layers',
    questions: [
      {
        q: '元件測試跑在 jsdom 31。下列哪一項在 jsdom 裡測不準，應該移到真的瀏覽器（Playwright 或 Vitest Browser Mode）？',
        options: [
          '按 Enter 送出表單後，`role="status"` 顯示的文字',
          '按 → 之後 `document.activeElement` 變成下一個 tab',
          '390px 寬時「送出掛號」被固定在底部的提示列蓋住',
          '送出成功時 emit 的事件與參數',
        ],
        answer: 2,
        explain: 'jsdom 不計算版面，元素的尺寸與位置都是 0，「被蓋住」這種問題在 jsdom 裡永遠看不出來；Playwright 點擊時會回報哪個元素 intercepts pointer events。文字、焦點與 emit 在 jsdom 裡都測得準，放在元件測試比較快也比較穩。',
      },
      {
        q: '這個測試一直是綠的，元件卻把錯的 id 傳給 API。測試最大的問題是什麼？',
        code: `vi.mock('../api.js')

it('取消預約', async () => {
  const wrapper = mount(AppointmentRow, { props: { appt } })
  await wrapper.find('button').trigger('click')
  expect(api.cancelAppointment).toHaveBeenCalled()
})`,
        lang: 'js',
        options: [
          '按鈕只能用 E2E 測，元件測試不該點按鈕',
          '只驗證替身有被呼叫，沒檢查傳了什麼參數，也沒檢查畫面變成什麼',
          '`trigger` 不能用在 `button` 上，要改用 `setValue`',
          '`mount` 要改成 `shallowMount`，測試才會檢查參數',
        ],
        answer: 1,
        explain: '整個 API 模組被換成替身，斷言只問「有沒有呼叫」，傳錯 id、畫面沒更新都會通過。至少要斷言 `toHaveBeenCalledWith(appt.id)` 與畫面上的結果；用 MSW 在網路層 mock，連網址與 body 都在測試範圍內。`trigger(\'click\')` 用在按鈕上沒問題，`shallowMount` 只會換掉更多東西。',
      },
      {
        q: '規則是「看診前 2 小時（含）以前才能取消」。這條規則的測試放哪裡最合適？',
        options: [
          '抽成 `canCancel(appt, now)` 寫單元測試，2 小時整與 1 小時 59 分各一個；元件測試只確認按鈕依結果停用',
          '每一種時間邊界各寫一支 Playwright 測試，最接近使用者',
          '只在元件測試裡用 `vi.useFakeTimers()` 調時間，看按鈕會不會停用',
          '不用測，後端也會擋下太晚的取消',
        ],
        answer: 0,
        explain: '時間計算不需要 DOM，抽成接收 `now` 參數的函式，單元測試幾毫秒就能把邊界測完，`>=` 寫成 `>` 會立刻變紅。每個邊界一支 E2E 慢又容易不穩；只在元件裡測要假造時間，邊界一多就難維護。後端會擋不代表畫面可以顯示錯的按鈕狀態。',
      },
    ],
  },
  {
    skill: 'unit-tests',
    questions: [
      {
        q: '`parseQueueNo(\'A012\')` 回傳 `{ prefix: \'A\', n: 12 }`。測試寫成 `expect(parseQueueNo(\'A012\')).toBe({ prefix: \'A\', n: 12 })`，結果是什麼？',
        options: [
          '通過：兩個物件的內容一樣',
          '通過：Vitest 遇到物件會自動改成深度比較',
          '失敗：`toBe` 用 `Object.is`，兩個不同的物件不相等，要改 `toEqual`',
          '失敗：`toBe` 只能比數字，物件要用 `toMatch`',
        ],
        answer: 2,
        explain: '`toBe` 用 `Object.is`，比的是不是同一個值；函式回傳的新物件和測試裡寫的物件是兩個不同的物件。Vitest 不會自動改成深度比較，只在訊息裡提示 `Compared values have no visual difference` 與改用 `toStrictEqual`。`toBe` 也能比字串、布林；`toMatch` 是比字串與正規表示式。',
      },
      {
        q: '搜尋框的 debounce 是 300ms。下面的測試哪裡會出問題？',
        code: `it('停止輸入 300ms 後搜尋一次', () => {
  vi.useFakeTimers()
  const search = vi.fn()
  const onInput = debounce(search, 300)
  onInput('王')
  onInput('王小')
  expect(search).toHaveBeenCalledTimes(1)
})`,
        lang: 'js',
        options: [
          '會失敗：fake timers 下計時器不會自己觸發，要先 `vi.advanceTimersByTime(300)`',
          '會通過：`vi.fn()` 會記錄 debounce 排好的呼叫',
          '會失敗：fake timers 只能在 `async` 測試裡用',
          '會通過，但要在最後呼叫 `vi.useRealTimers()` 才會把呼叫送出去',
        ],
        answer: 0,
        explain: '`vi.useFakeTimers()` 之後，`setTimeout` 只排進假時鐘，時間不推就不會執行，所以呼叫次數是 0，訊息是 `expected "vi.fn()" to be called 1 times, but got 0 times`。`vi.fn()` 只記錄已經發生的呼叫；fake timers 在同步測試就能用；`useRealTimers()` 是換回真的計時器，不會補跑排好的計時器，它該放在 `afterEach`。',
      },
      {
        q: '`estimateWait` 的測試覆蓋率四欄都是 100%，有人把 `Math.ceil` 改成 `Math.round`，測試還是全綠。下一步做什麼最有效？',
        options: [
          '把覆蓋率門檻提高到 100%，讓 CI 擋下這種改動',
          '加一張 `test.each` 邊界表，含「前面 1 位、每位 6 分鐘，預期 10 分鐘」這種進位與捨去結果不同的值，再故意改壞一次確認會變紅',
          '在函式裡加 `console.log`，讓測試輸出看得到計算過程',
          '把受測函式用 `vi.mock` 換掉，測試它有被呼叫',
        ],
        answer: 1,
        explain: '覆蓋率只說每一行跑過，不說結果有沒有被檢查；門檻已經是 100% 還是抓不到。要加一個「改了就會得到不同答案」的輸入：6 分鐘無條件進位是 10，四捨五入是 5。改壞一次看有沒有變紅，就是突變測試的做法。`console.log` 不會讓測試失敗；mock 掉受測函式之後，測到的是替身，不是規則。',
      },
    ],
  },
  {
    skill: 'component-tests',
    questions: [
      {
        q: '送出後要等 API 回來，畫面才會出現「已完成掛號，號碼 A012」。用 Testing Library 斷言這段文字，該用哪個查詢？',
        options: [
          '`screen.getByText(\'已完成掛號，號碼 A012\')`',
          '`screen.queryByText(\'已完成掛號，號碼 A012\')`',
          '`await screen.findByText(\'已完成掛號，號碼 A012\')`',
          '`screen.getByTestId(\'status\')`',
        ],
        answer: 2,
        explain: '`findBy` 回傳 Promise，會重試到元素出現（預設最多 1 秒），適合等非同步的結果。`getBy` 只找一次，API 還沒回來就丟錯；`queryBy` 找不到回 `null`，用來斷言「不存在」；`getByTestId` 綁住實作，也沒有等待。',
      },
      {
        q: '專案用 MSW 3.0。元件呼叫了沒有 handler 的 `GET /api/doctors`，輸出只有 `[MSW] Warning: intercepted a request without a matching request handler`，接著 `TypeError: fetch failed`。最可能的原因是？',
        code: `// src/test-setup.js
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())`,
        lang: 'js',
        options: [
          'MSW 3 把這個選項改名為 `onUnhandledFrame`，`onUnhandledRequest` 被忽略，維持預設的 `warn`，請求照常送到網路',
          '`\'error\'` 只在瀏覽器的 `setupWorker` 有效，`setupServer` 不支援',
          'jsdom 沒有 `fetch`，所以請求一定失敗',
          'handler 要寫成包含主機名稱的完整網址，相對路徑攔截不到',
        ],
        answer: 0,
        explain: 'MSW 2.x 的選項叫 `onUnhandledRequest`，3.x 改成 `onUnhandledFrame`；照舊寫法傳進去不會報錯，只是沒有作用，所以印的是 Warning 而不是 Error，請求還真的送出去（jsdom 環境的預設網址是 localhost:3000）。`setupServer` 支援 `\'error\'`；Vitest 的 jsdom 環境有 Node 的 `fetch`；相對路徑的 handler 攔得到。',
      },
      {
        q: '單獨跑每個測試都過，一起跑時第二個測試出現 `Found multiple elements with the role "button" and name "送出掛號"`。Vitest 設定沒有開 `globals`。該怎麼修？',
        options: [
          '元件裡一定有兩顆送出按鈕，刪掉其中一顆',
          '改成 `getAllByRole(\'button\', { name: \'送出掛號\' })[0]`',
          '每個測試檔只寫一個測試',
          '在 setup 檔加上 `afterEach(() => cleanup())`，或在 Vitest 設定開 `globals: true`',
        ],
        answer: 3,
        explain: 'Testing Library 只在偵測到全域的 `afterEach` 時自動清理，Vitest 預設 `globals: false`，上一個測試掛的元件留在 DOM 裡，畫面上就有兩顆按鈕。補上 `cleanup` 就好。取第一個會測到上一個測試留下的元件，問題被藏起來；元件本身只有一顆按鈕。',
      },
    ],
  },
  {
    skill: 'render-performance',
    questions: [
      {
        q: '搜尋框每輸入一個字就呼叫一次 `/api/patients?q=`。要讓使用者停下來才送出請求，該用哪一種？',
        options: [
          'throttle：每 300 毫秒最多送一次',
          'debounce：停止輸入 300 毫秒後才送一次',
          '`requestAnimationFrame`：每一格畫面送一次',
          '`v-memo`：輸入值沒變時跳過渲染',
        ],
        answer: 1,
        explain: 'debounce 在連續觸發時一直延後，停下來超過指定時間才執行一次，正好是「打完才搜尋」。throttle 會在打字過程中每 300 毫秒送一次，請求還是很多；`requestAnimationFrame` 是和畫面同步，頻率更高；`v-memo` 管的是渲染，不影響請求次數。搭配取消前一個請求，避免慢的回應蓋掉新的結果。',
      },
      {
        q: '3,000 列的清單，點一列設為選取時有一個 400 毫秒的長任務，Vue 的效能標記顯示 3,000 個 `ClinicRow` 都 patch 了一次。最直接的修法是？',
        code: `<ClinicRow
  v-for="row in rows"
  :key="row.id"
  :row="row"
  :selected-id="selectedId"
  @select="selectedId = row.id"
/>`,
        lang: 'vue',
        options: [
          '把 `:key="row.id"` 改成 `:key="index"`，讓 Vue 重用元件',
          '在 `ClinicRow` 裡用 `watch` 監聽 `selectedId`，只有自己被選中時才更新',
          '改傳 `:selected="row.id === selectedId"`，換選取時只有兩列的 props 改變',
          '把 `rows` 改成 `reactive`，讓 Vue 追蹤得更精準',
        ],
        answer: 2,
        explain: '子元件在 props 改變時更新。每一列都收 `selectedId`，它一變，3,000 列的 props 都變了。在父元件算好布林值再傳下去，只有原本選中與新選中的兩列從 `true`、`false` 互換，其餘不更新（Vue 官方文件 Props Stability 的例子）。改成 index 當 key 會讓列表在排序或刪除時出錯；在子元件 watch 同一個值，每一列仍然收到它；`reactive` 不會減少 props 的變動。',
      },
      {
        q: '櫃台要在同一個畫面上下捲動瀏覽 3,000 筆掛號，每列高度固定 48px。打開頁面要兩秒才捲得動，Console 顯示頁面有 36,000 個 DOM 節點。比較好的做法是？',
        options: [
          '每一列包在 `v-once` 裡，第一次渲染之後就不再更新',
          '每一列加 `v-show`，捲出視窗的列用 `display: none` 隱藏',
          '用 `setTimeout` 把 3,000 列分成十批，一批一批渲染',
          '用虛擬捲動只渲染視窗內與前後幾列，另外提供搜尋框',
        ],
        answer: 3,
        explain: '問題在 DOM 太多，虛擬捲動讓實際的節點數維持在幾十列，列高固定時最容易做對；代價是瀏覽器的搜尋找不到沒渲染的列，要自己提供搜尋。`v-once` 讓狀態改變時畫面不更新；`v-show` 只是 `display: none`，節點都還在；分批渲染讓頁面早一點能動，但最後還是 36,000 個節點。',
      },
    ],
  },
  {
    skill: 'e2e-playwright',
    questions: [
      {
        q: '送出後畫面要等 API 回來才會更新。下列哪一行在 CI 比較慢的機器上仍然可靠？',
        options: [
          '`expect(await page.getByRole(\'status\').textContent()).toBe(\'已完成掛號，號碼 A012\')`',
          '先 `await page.waitForTimeout(2000)`，再讀 `textContent()` 比較',
          '`await expect(page.getByRole(\'status\')).toHaveText(\'已完成掛號，號碼 A012\')`',
          '`expect(await page.getByRole(\'status\').isVisible()).toBe(true)`',
        ],
        answer: 2,
        explain: '`await expect(locator).toHaveText()` 是 web-first assertion，會重試到文字出現或超過 `expect` 的逾時（預設 5 秒）。`textContent()` 與 `isVisible()` 只讀一次，畫面還沒更新就失敗；固定等 2 秒在慢的機器上可能不夠，在快的機器上浪費時間。',
      },
      {
        q: '預約清單有三列，每列都有「取消預約」，執行後出現下面的錯誤。要點「11/20 09:00」那一列的按鈕，最好的寫法是？',
        code: `await page.getByRole('button', { name: '取消預約' }).click()
// Error: locator.click: Error: strict mode violation:
//   getByRole('button', { name: '取消預約' }) resolved to 3 elements`,
        lang: 'js',
        options: [
          '`await page.getByRole(\'button\', { name: \'取消預約\' }).first().click()`',
          '`await page.getByRole(\'row\', { name: /11\\/20 09:00/ }).getByRole(\'button\', { name: \'取消預約\' }).click()`',
          '`await page.locator(\'.appt-row:nth-child(2) .btn-danger\').click()`',
          '`await page.getByRole(\'button\', { name: \'取消預約\' }).click({ force: true })`',
        ],
        answer: 1,
        explain: '先用這一列的名稱縮小範圍，再找列裡的按鈕，意圖清楚，也不受排序與 class 影響。`.first()` 依賴目前的順序，清單排序一變就點錯列；CSS 選擇器綁住 DOM 結構與 class；`force` 只略過可操作性檢查，對 strict mode 沒有幫助，還會藏起真的問題。',
      },
      {
        q: '一支 E2E 在本機每次都過，在 CI 大約五次失敗一次，訊息只有一行 `Timeout 5000ms exceeded`。比較好的處理順序是？',
        options: [
          '設定 `trace: \'on-first-retry\'`，下載失敗的 trace 看那一步的 DOM 與 Network，把固定等待與只讀一次的斷言換成 web-first assertion，再用 `--repeat-each=10` 確認',
          '把 `retries` 調到 5，重跑到過為止',
          '在每個動作後面加 `await page.waitForTimeout(1000)`',
          '只在 Chromium 跑，關掉 webkit 的 project',
        ],
        answer: 0,
        explain: 'trace 錄下每一步的 DOM 快照、Network 與 Console，看得出是在等哪個元素、API 回了什麼，才知道該改哪裡。調高 retries 只是把不穩定藏起來；固定等待讓測試更慢，也不保證夠久；關掉 webkit 和這個時序問題無關。',
      },
    ],
  },
  {
    skill: 'lint-typecheck',
    questions: [
      {
        q: 'CI 的型別檢查是 `tsc --noEmit`，一直是綠的，元件模板裡拼錯的 `{{ appt.patientNmae }}` 卻沒被抓到。原因是？',
        options: [
          '`tsc` 不處理 `.vue` 檔，要改用 `vue-tsc`，模板裡的運算式才會一起檢查',
          '模板裡的錯只有 ESLint 抓得到，型別檢查本來就不看模板',
          '`tsconfig.json` 沒有開 `strict`，所以拼錯的屬性不會報錯',
          'Vite 建置時才檢查模板，要看 `vite build` 的輸出',
        ],
        answer: 0,
        explain: '`tsc` 只認得 `.ts`、`.tsx`、`.js` 這類副檔名，`.vue` 不在範圍裡。`vue-tsc` 把 SFC 轉成 TypeScript 看得懂的形式，會報 `TS2551: Property \'patientNmae\' does not exist`。不存在的屬性和 `strict` 無關；Vite 只轉譯、不檢查型別。',
      },
      {
        q: '存檔時 Prettier 把屬性排成一行，`eslint --fix` 又改回每個屬性一行，兩邊來回打架。這份設定最可能的問題是？',
        code: `import skipFormatting from 'eslint-config-prettier/flat'

export default defineConfigWithVueTs(
  skipFormatting,
  ...pluginVue.configs['flat/strongly-recommended'],
  vueTsConfigs.recommended,
)`,
        lang: 'js',
        options: [
          'flat config 不能同時用 eslint-plugin-vue 與 typescript-eslint',
          'Prettier 不支援 `.vue` 檔，模板只能交給 ESLint 排版',
          '要改回 `.eslintrc.cjs`，`eslint-config-prettier` 才會生效',
          '`skipFormatting` 放在最前面，後面的 `strongly-recommended` 又打開了 `vue/max-attributes-per-line` 這類格式規則；要放在陣列最後',
        ],
        answer: 3,
        explain: 'flat config 由前往後套用，後面的設定覆蓋前面的。`strongly-recommended` 多出來的規則大多是模板格式，和 Prettier 重疊；`eslint-config-prettier` 放在最後才關得掉它們。兩個 plugin 可以並用；Prettier 支援 `.vue`；ESLint 10 已經不讀 `.eslintrc`。',
      },
      {
        q: 'lint-staged 設成 `"*.{vue,ts}": ["eslint --fix", "vue-tsc --noEmit"]` 之後，每次 commit 都失敗，訊息是 `error TS5112: tsconfig.json is present but will not be loaded if files are specified on commandline.`。比較好的修法是？',
        options: [
          '加上 `--ignoreConfig`，讓它只檢查暫存的檔案',
          '型別檢查移到 CI 跑整個專案；真要放 pre-commit，就用 JS 設定的函式回傳不帶檔名的 `vue-tsc --build`',
          '把 `vue-tsc` 換成 `tsc`，速度比較快',
          '用 `git commit --no-verify` 跳過，等 CI 再檢查',
        ],
        answer: 1,
        explain: 'lint-staged 把暫存的檔名接在指令後面，檔名一出現，TypeScript 就不讀 `tsconfig.json`；TypeScript 6 直接報 TS5112。型別錯誤常出現在沒改到的檔案，要看整個專案。`--ignoreConfig` 會用錯的設定檢查；`tsc` 看不到 `.vue`；`--no-verify` 等於拿掉 pre-commit。',
      },
    ],
  },
  {
    skill: 'error-monitoring',
    questions: [
      {
        q: '正式環境只掛了 `window.addEventListener(\'error\', report)`，沒有設 `app.config.errorHandler`。報到按鈕的 `@click` 處理函式丟出 `TypeError`，會發生什麼事？',
        options: [
          '`window` 的 `error` 事件收到它，`report` 正常回報',
          'Vue 接住錯誤後只 `console.error`，不會再丟出去，`report` 收不到',
          '整個 Vue 應用程式卸載，畫面變成空白',
          '瀏覽器跳出錯誤對話框，請使用者重新整理',
        ],
        answer: 1,
        explain: '模板裡的事件處理函式由 Vue 呼叫，錯誤先交給 `app.config.errorHandler`；正式版沒有設時，Vue 只會 `console.error(err)`，不會再丟出去，所以全域的 `error` 事件看不到（開發版會再丟出去，容易誤以為收得到）。應用程式不會卸載，瀏覽器也不會跳對話框。要兩層都掛：`errorHandler` 收 Vue 的，`error` 與 `unhandledrejection` 收其他的。',
      },
      {
        q: '看板的 script 放在另一個網域，錯誤監控收到的訊息全是 `Script error.`，沒有檔名與行號。要看到完整的錯誤，需要怎麼改？',
        code: `<!-- 頁面在 clinic.example，script 在 cdn.clinic.example -->
<script src="//cdn.clinic.example/board.js"></script>`,
        lang: 'html',
        options: [
          '把 `window.onerror` 改成 `window.addEventListener(\'error\')`',
          '在 `board.js` 裡加 `"use strict"`',
          '`<script>` 加 `crossorigin="anonymous"`，CDN 回應允許 `clinic.example` 的 `Access-Control-Allow-Origin`',
          '把 `board.js` 改成 `type="module"` 就會自動帶上錯誤細節',
        ],
        answer: 2,
        explain: '瀏覽器不讓頁面讀到其他網域 script 的錯誤細節，只給 `Script error.`。`crossorigin="anonymous"` 讓瀏覽器用 CORS 模式載入它，伺服器回應允許的 `Access-Control-Allow-Origin` 之後，錯誤的訊息、檔名、行號與 `error` 物件才會交給頁面。換監聽方式或加 strict mode 都不影響這個限制；module script 跨網域本來就要 CORS，但沒有對方的標頭照樣載入失敗。',
      },
      {
        q: '目前 `vite.config.js` 設 `build.sourcemap: true`，部署後任何人都能打開 `/assets/index-*.js.map` 看到原始碼。錯誤監控又需要 source map 才讀得懂 stack。比較好的做法是？',
        options: [
          '改成 `false`，監控服務裡直接看壓縮後的位置就好',
          '改成 `\'inline\'`，map 寫進 JS 檔裡就不會有 `.map` 檔',
          '保持 `true`，在 nginx 對 `.map` 檔加上密碼保護',
          '改成 `\'hidden\'`，上傳 `.map` 給監控服務後從部署檔案刪掉',
        ],
        answer: 3,
        explain: '`hidden` 照樣產生 `.map`，但 JS 裡不留 `sourceMappingURL`，瀏覽器不會去要；上傳給監控服務並對上 release 之後刪掉，原始碼不公開，stack 也能對回原始檔。關掉 source map 會讓 stack 只剩 `index-*.js:1:48211`；`inline` 把整份 map 塞進 JS，原始碼一樣公開，檔案還變大；在 nginx 加密碼可以，但 `true` 會在 JS 裡留下 map 的網址，而且每次部署都要記得維護這條規則。',
      },
    ],
  },
]

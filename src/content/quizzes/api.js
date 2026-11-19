// 題庫：呼叫後端
export default [
  {
    skill: 'fetch-basics',
    questions: [
      {
        q: '下列哪一種情況，`await fetch(url)` 會 reject（進到 `catch`）？',
        options: [
          '伺服器回 500 Internal Server Error',
          '伺服器回 404，body 是 Problem Details',
          '使用者離線，瀏覽器連不上伺服器',
          '伺服器回 204 No Content',
        ],
        answer: 2,
        explain: 'fetch 只在網路層失敗時 reject：離線、DNS 失敗、連線被拒、被 CORS 擋下、被取消或逾時。只要收到 HTTP 回應，不管 404、500 還是 204，fetch 都 resolve 成 `Response`，要自己看 `res.ok` 或 `res.status`。204 的陷阱在下一步：沒有 body，呼叫 `res.json()` 會丟 SyntaxError。',
      },
      {
        q: '這個請求送出去，後端收到的是什麼？',
        code: `await fetch('/api/appointments', {
  method: 'POST',
  body: { sessionId: 42 },
})`,
        lang: 'js',
        options: [
          '`Content-Type: application/json`，body 是 `{"sessionId":42}`',
          '`Content-Type: text/plain;charset=UTF-8`，body 是字串 `[object Object]`',
          '`Content-Type: application/x-www-form-urlencoded`，body 是 `sessionId=42`',
          'fetch 直接丟出 TypeError，請求不會送出',
        ],
        answer: 1,
        explain: '一般物件不是 fetch 認得的 body 型別，會被轉成字串 `[object Object]`，`Content-Type` 是字串預設的 `text/plain;charset=UTF-8`。fetch 不會自動轉成 JSON，也不會報錯；要寫 `body: JSON.stringify({ sessionId: 42 })` 並設 `Content-Type: application/json`。表單格式要傳 `URLSearchParams` 才會是 urlencoded。',
      },
      {
        q: 'Console 出現 `SyntaxError: Unexpected token \'<\', "<!doctype "... is not valid JSON`。第一步該做什麼？',
        options: [
          '把 `res.json()` 改成 `JSON.parse(await res.text())`',
          '在 `catch` 裡忽略這個錯誤，回傳空陣列',
          '在請求加上 `Accept: application/json` 標頭',
          '打開 Network 分頁看這個請求的 Response 與 `Content-Type`，確認拿到的是不是 HTML',
        ],
        answer: 3,
        explain: '訊息說回應的第一個字是 `<`，拿到的多半是 HTML：反向代理的錯誤頁、SPA fallback 回了 `index.html`，或路徑打錯。先在 Network 分頁看實際內容與狀態碼，才知道要修路徑、代理設定還是後端。換成 `JSON.parse` 是同一個錯；忽略錯誤會把故障藏成空清單；加 `Accept` 標頭不會改變代理或 fallback 回的內容。',
      },
    ],
  },
  {
    skill: 'api-states',
    questions: [
      {
        q: '把 `isLoading`、`hasError`、`isEmpty` 三個布林值換成一個 `status`（`idle`、`loading`、`success`、`empty`、`error`），主要的好處是什麼？',
        options: [
          '畫面一次只會處在一種狀態，不會出現「loading 與 error 同時成立」這種組合',
          '少了兩個 ref，渲染效能明顯提升',
          'Vue 對字串型別的 ref 追蹤得比布林值準確',
          '可以省掉錯誤處理，請求失敗時 `status` 會自動變成 error',
        ],
        answer: 0,
        explain: '三個布林值可以組出 8 種組合，其中好幾種沒有意義（例如同時 loading 又 error），重試時忘了清掉 `hasError` 就會同時出現 Skeleton 與錯誤訊息。單一 `status` 加 `v-if`／`v-else-if`，畫面一次只有一種。效能差異可以忽略；Vue 追蹤所有型別都一樣；`status` 要由程式在 `catch` 裡設定。',
      },
      {
        q: '依這段判斷，下列哪個錯誤的畫面不會出現「重試」按鈕？',
        code: `function canRetry(err) {
  if (err.name === 'TypeError' || err.name === 'TimeoutError') return true
  return err.status >= 500
}`,
        lang: 'js',
        options: [
          '使用者離線，fetch reject 了 `TypeError`',
          '`AbortSignal.timeout(8000)` 到時間，錯誤是 `TimeoutError`',
          '後端回 403，Problem Details 的 `title` 是「沒有權限查看這個診間」',
          '後端回 503 Service Unavailable',
        ],
        answer: 2,
        explain: '403 代表請求本身沒有權限，原封不動重送結果一樣，所以只顯示原因、不給重試。網路錯誤、逾時與 5xx 都可能是暫時的，重試有機會成功。注意 `TypeError` 也可能是程式自己的 bug，所以判斷網路錯誤時只把 `fetch` 本身包在 `try` 裡。',
      },
      {
        q: '預約清單每 30 秒自動更新一次，櫃台抱怨每次更新畫面都閃一下、捲動位置跑回頂端。怎麼改？',
        options: [
          '把自動更新的間隔拉長到 5 分鐘',
          '已經有資料時不回到 loading：保留舊清單，用 `refreshing` 旗標在標題旁顯示小 spinner',
          '更新時用 `v-show` 把清單藏起來，資料回來再顯示',
          '每次更新前先把清單設成空陣列，再填入新資料',
        ],
        answer: 1,
        explain: '閃動與捲動跑掉，是因為每次更新都把畫面換回 Skeleton，清單被移除又重建。已經有資料時，狀態維持 success、保留舊清單，只在角落顯示更新中；更新失敗時也保留舊資料並加一行說明。拉長間隔只是減少發生的次數；藏起清單或先清空，一樣會讓清單消失再出現。',
      },
    ],
  },
  {
    skill: 'cancel-race',
    questions: [
      {
        q: '病患搜尋框加了 300 ms 的 debounce。關於競態，下列哪個說法正確？',
        options: [
          '請求變少了，但兩次停頓之間送出的請求仍可能晚到、蓋掉新結果，還是要取消或比對序號',
          'debounce 保證回應照送出的順序回來，不會再有競態',
          'debounce 會在送出新請求時自動 abort 前一個請求',
          'debounce 時間只要長於伺服器的回應時間，就不用處理取消',
        ],
        answer: 0,
        explain: 'debounce 只決定「什麼時候送」，不管已經送出的請求。使用者停頓超過 300 ms 再改字，兩個請求一樣同時在路上，慢的那個晚到就蓋掉新結果。它不會 abort 任何東西，也無法保證回應順序；伺服器的回應時間會變，拿它和 debounce 時間比較沒有意義。',
      },
      {
        q: '這段想在 `keyword` 改變時取消前一個請求，實際會怎樣？',
        code: `watch(keyword, async (q) => {
  const res = await fetch(\`/api/patients?q=\${q}\`)
  const controller = new AbortController()
  onWatcherCleanup(() => controller.abort())
  results.value = await res.json()
})`,
        lang: 'js',
        options: [
          '正常：條件一變，前一個請求就被取消',
          'fetch 沒有接上 signal，而且 `onWatcherCleanup` 在 `await` 之後才呼叫，Vue 警告找不到 watcher，前一個請求不會被取消',
          '`onWatcherCleanup` 只能用在 `watchEffect`，元件掛載時直接丟出錯誤',
          '請求會被取消，但取消後畫面一定顯示錯誤訊息',
        ],
        answer: 1,
        explain: '兩個錯：controller 建在 fetch 之後，`signal` 根本沒傳給 fetch；`onWatcherCleanup` 要在 callback 的第一個 `await` 之前呼叫，之後才呼叫時 Vue 印出 `[Vue warn] onWatcherCleanup() was called when there was no active watcher to associate with.`，清理函式沒有登記。修法是先建 controller、登記清理、再 `fetch(url, { signal })`。它在 `watch` 與 `watchEffect` 裡都能用。',
      },
      {
        q: '取消時寫了 `controller.abort(\'換條件\')`，快速打字時畫面偶爾閃出「搜尋失敗」。`catch` 裡寫的是 `if (err.name === \'AbortError\') return`。原因與修法是？',
        options: [
          'fetch 被取消時不會 reject，要改用 `res.ok` 判斷',
          'AbortError 只有 Chrome 有，其他瀏覽器的名稱不同',
          '要在 `finally` 裡把 `status` 設回 `success`',
          '帶了理由的 abort 會讓 fetch 丟出那個字串本身，`err.name` 是 `undefined`；改用 `signal.aborted` 判斷',
        ],
        answer: 3,
        explain: '`abort()` 不帶理由時，fetch 以 `name` 為 `AbortError` 的 DOMException reject；帶了理由，reject 的就是那個理由（這裡是字串），字串沒有 `name`，判斷落空，被當成真的錯誤。`signal.aborted` 不管理由是什麼都是 `true`。fetch 被取消一定會 reject；`AbortError` 是標準名稱；在 `finally` 改狀態會蓋掉真正的錯誤。',
      },
    ],
  },
  {
    skill: 'pagination-filter',
    questions: [
      {
        q: '後端的列表 API 是 cursor 分頁，回應是 `{ items, next_cursor }`。前端用哪一種分頁元件最合適？',
        options: [
          '有總頁數、可以跳到任一頁的 Pagination',
          '「載入更多」按鈕或無限捲動，每次帶上一次的 `next_cursor`',
          '把頁碼寫進網址 `?page=7`，打開就直接是第 7 頁',
          '先把全部資料抓回來，在前端自己切頁',
        ],
        answer: 1,
        explain: 'cursor 只能一批一批往下接：拿到 `next_cursor` 才知道下一批從哪裡開始，沒有「第 7 頁」可以直接跳，也通常沒有總頁數。所以元件是「載入更多」或無限捲動，`next_cursor` 為 `null` 時停止。想要跳頁與頁碼，後端要提供 offset 分頁；全部抓回來在資料量大時不可行。',
      },
      {
        q: '網址是 `?page=3` 時一切正常。下列哪個網址會讓請求送出 `offset=NaN`？',
        code: `const page = route.query.page || 1
const offset = (page - 1) * 20
fetch(\`/api/appointments?offset=\${offset}&limit=20\`)`,
        lang: 'js',
        options: [
          '`?page=0`',
          '`?page=`（空值）',
          '`?page=2&page=3`',
          '沒有 `page` 參數',
        ],
        answer: 2,
        explain: '重複的參數讓 `route.query.page` 變成陣列 `[\'2\', \'3\']`，減法時被轉成字串 `\'2,3\'`，得到 `NaN`。其他選項也有問題：`?page=0` 的 `\'0\'` 是非空字串、是 truthy，算出 `offset=-20`；空值與沒有參數會落到 `|| 1`。query 讀進來要先解析：取第一個值、轉數字、檢查是正整數，不合法就用預設值。',
      },
      {
        q: '「我的掛號」的關鍵字框，每打一個字就用 `router.push` 更新網址的 `q`。使用者打完「王小明」後按瀏覽器的上一頁，會發生什麼？該怎麼改？',
        options: [
          '網址變回 `q=王小`，要按好幾次才離開列表；打字中的更新改用 `router.replace`，並加上 debounce',
          '直接回到進入列表前的頁面，不用改',
          '瀏覽器只保留最後一次 push，其他的自動丟掉',
          'Vue Router 會合併同一個路徑的紀錄，只是捲動位置會跑掉',
        ],
        answer: 0,
        explain: '每次 `push` 都新增一筆瀏覽紀錄，打三個字就是三筆，上一頁一筆一筆往回退。打字中的條件用 `replace` 取代目前這筆，換篩選、換頁這種「使用者會想退回」的操作才用 `push`。瀏覽器與 Vue Router 都不會自動合併紀錄。',
      },
    ],
  },
  {
    skill: 'form-submit',
    questions: [
      {
        q: '前端已經用 `required`、`pattern` 檢查過病歷號。後端還需要再驗證嗎？',
        options: [
          '不用，前端擋下的資料根本不會送到後端',
          '只有在沒有 HTTPS 的環境才需要',
          '要；請求可以繞過前端直接送（例如用 curl），前端驗證只是讓使用者早點知道錯在哪',
          '要，但只需要驗證前端沒有檢查的那些欄位',
        ],
        answer: 2,
        explain: '前端驗證在使用者的瀏覽器裡執行，關掉 JavaScript、改 DOM、直接打 API 都能繞過。所以後端要把前端檢查過的規則全部再驗一次，加上要查資料庫的規則（名額、重複掛號），畫面也要能顯示後端回來的 422 與 409。HTTPS 只保護傳輸過程，和驗證無關。',
      },
      {
        q: '病歷號已經填好，使用者按「返回」時會發生什麼？',
        code: `<form @submit.prevent="submit">
  <input v-model="patientId" required>
  <button @click="router.back()">返回</button>
  <button type="submit" :disabled="submitting">掛號</button>
</form>`,
        lang: 'vue',
        options: [
          '只回到上一頁，表單不會送出',
          '除了 `router.back()`，表單也會送出一次：`<form>` 裡沒寫 type 的 `<button>` 預設是 `type="submit"`，要加 `type="button"`',
          '`submitting` 是 `false`，所以「返回」按鈕被停用',
          'Vue 在 Console 警告按鈕缺少 type，並忽略這次點擊',
        ],
        answer: 1,
        explain: '`<button>` 的 type 預設是 `submit`。按下「返回」會先執行 click 的 `router.back()`，接著觸發表單的 submit，`submit()` 送出一次掛號。非送出用的按鈕都要寫 `type="button"`。`:disabled` 只綁在「掛號」按鈕上；Vue 不會對缺少 type 發出警告。',
      },
      {
        q: '後端回 422，body 是 `{"title":"Unprocessable Content","status":422,"errors":[{"field":"patient_id","message":"櫃台掛號必須指定 patient_id"}]}`，表單的輸入框綁的是 `patientId`。畫面該怎麼處理？',
        options: [
          '在表單上方顯示 `title`「Unprocessable Content」',
          '清空表單，讓使用者重新填寫',
          '自動重送一次，422 通常是暫時的',
          '把 `patient_id` 對到 `patientId` 欄位，訊息放在輸入框下方並加 `aria-invalid`、`aria-describedby`，焦點移過去',
        ],
        answer: 3,
        explain: '422 代表欄位內容不對，`errors` 指出是哪一欄。後端與前端的欄位名稱不同時要有對照，否則訊息永遠找不到位置；對到之後放在欄位旁並讓螢幕閱讀器讀得到。`title` 是給開發者看的英文，使用者看不出錯在哪；清空表單逼使用者重填；422 重送多少次結果都一樣。',
      },
    ],
  },
  {
    skill: 'auth-frontend',
    questions: [
      {
        q: '已登入的護理師打開管理頁，API 回 403。前端該怎麼做？',
        options: [
          '清掉登入狀態並導向登入頁',
          '顯示「沒有權限」，登入狀態不動',
          '用 refresh token 換一個新的 access token 再重送',
          '每隔 5 秒重試一次，直到成功',
        ],
        answer: 1,
        explain: '403 表示伺服器知道你是誰，但這個帳號不能做這件事；重新登入、換 token、重試結果都一樣。把 403 當成 401 導去登入，使用者登入後又被擋，形成迴圈。401（沒登入或過期）才清掉登入狀態並導向登入。',
      },
      {
        q: '登入成功後用這行導回原本的頁面。哪一個網址會讓使用者被帶到別的網站？',
        code: `// LoginView.vue：登入成功後
location.href = route.query.redirect || '/'`,
        lang: 'js',
        options: [
          '`/login?redirect=/appointments/42`',
          '`/login`',
          '`/login?redirect=%2Fappointments%3Ftab%3Dnotes`',
          '`/login?redirect=//evil.example/login`',
        ],
        answer: 3,
        explain: '`//evil.example/login` 是「沿用目前協定」的網址，瀏覽器會前往 evil.example。攻擊者寄出這種登入連結，使用者在本站登入完被送到假網站。檢查 `redirect`：只接受 `/` 開頭、不是 `//` 開頭的路徑，解析後確認 origin 相同，否則導回首頁。另外三個都留在本站，第三個只是編碼過的站內路徑。',
      },
      {
        q: 'access token 過期後，頁面同時送出 3 個請求，都收到 401。refresh token 每用一次就換新的。如果每個請求各自去換 token，會發生什麼？',
        options: [
          '第一次換成功；另外兩次拿已經失效的舊 refresh token，失敗，使用者可能被登出。應該共用同一個更新中的 Promise',
          '3 個請求都成功，只是多送了兩次 refresh',
          '瀏覽器會自動合併相同的 refresh 請求',
          '伺服器回 409，前端再重送一次就好',
        ],
        answer: 0,
        explain: '3 個請求同時拿同一把 refresh token 去換。輪替的設計下，第一次換完舊的就失效，後兩次被拒絕。共用一次更新：第一個 401 開始更新並存下 Promise，其他請求等同一個 Promise，完成後各自重送一次。瀏覽器不會合併 POST，伺服器也不會因此回 409。',
      },
    ],
  },
  {
    skill: 'api-errors-retry',
    questions: [
      {
        q: '下列哪一種失敗，適合由前端自動重試（加退避、有上限）？',
        options: [
          '`GET /api/appointments` 回 503',
          '沒有冪等鍵的 `POST /api/sessions/7/appointments` 逾時',
          '`GET /api/appointments/42` 回 404',
          '`POST /api/auth/login` 回 401',
        ],
        answer: 0,
        explain: '503 是暫時的（重啟、過載），GET 送幾次都不會改資料，自動重試合適。逾時的 POST 可能已經在伺服器建立了掛號，沒有冪等鍵時自動重送會多一筆；404 與 401 是請求本身的問題，重送結果一樣。',
      },
      {
        q: 'Network 分頁的 Response Headers 看得到 `Retry-After: 30`，這段卻立刻重送。原因是？',
        code: `// 頁面在 clinic.example，API 在 api.clinic.example（跨網域）
const res = await fetch(\`\${API}/appointments\`)
if (res.status === 429) {
  const wait = Number(res.headers.get('Retry-After')) * 1000
  setTimeout(load, wait)
}`,
        lang: 'js',
        options: [
          '`Retry-After` 的單位是毫秒，30 毫秒很快就到了',
          'fetch 會自動照 `Retry-After` 重送，程式又多送一次',
          '跨網域時 `Retry-After` 沒有列在 `Access-Control-Expose-Headers`，`get()` 回 `null`，`Number(null)` 是 0',
          '`setTimeout` 在背景分頁會被忽略',
        ],
        answer: 2,
        explain: 'CORS 預設只讓前端讀到幾個安全的回應標頭，`Retry-After` 不在其中。DevTools 看得到，程式讀到的是 `null`，乘起來等 0 毫秒。後端要加 `Access-Control-Expose-Headers: Retry-After`，前端也要處理讀不到的情況。`Retry-After` 的單位是秒（或 HTTP 日期）；fetch 不會自動重試；背景分頁的計時器會被節流，但不會被忽略。',
      },
      {
        q: '後端重啟期間回 503。前端的寫法是「失敗就每秒重試，直到成功」，全院 800 個分頁開著。最該先改的是？',
        options: [
          '把間隔改成 0.5 秒，讓使用者更快看到資料',
          '改成指數退避加隨機抖動並設重試上限，用完後顯示錯誤與「重試」按鈕',
          '把 503 當成成功，先顯示空清單',
          '改用 POST，避免回應被快取',
        ],
        answer: 1,
        explain: '固定間隔讓所有分頁同時重試，後端一恢復就被 800 個請求同時打到，可能又倒下。退避讓間隔越拉越長，抖動把各分頁的時間錯開，上限讓使用者知道出了問題。縮短間隔只會更糟；把錯誤當成空清單會誤導使用者；換成 POST 和快取無關，還失去了冪等性。',
      },
    ],
  },
  {
    skill: 'realtime-frontend',
    questions: [
      {
        q: '看板用 `EventSource` 接叫號。後端部署時回了一次 502，之後看板就不再更新，Console 也沒有新的錯誤。原因是？',
        options: [
          'EventSource 預設只重連 3 次',
          '連線中斷時 EventSource 會自己重連，但伺服器回非 200 時它就放棄，`readyState` 變成 2，要自己排重連',
          '502 讓瀏覽器把這個網址封鎖 24 小時',
          'EventSource 從來不會自動重連',
        ],
        answer: 1,
        explain: 'EventSource 在連線中斷時會自動重連（`readyState` 為 0）並帶上 `Last-Event-ID`；但重連時伺服器回了非 200，或 `Content-Type` 不是 `text/event-stream`，它就進入 CLOSED（2）不再嘗試。`error` 事件裡要檢查 `readyState`，CLOSED 時自己用退避排一次重建。沒有次數限制或封鎖機制。',
      },
      {
        q: '看板元件這樣輪詢。櫃台離開看板再回來，重複 4 次之後（看板一共掛載了 5 次），Network 分頁會看到什麼？',
        code: `onMounted(() => {
  setInterval(async () => {
    board.value = await (await fetch('/api/queue')).json()
  }, 5000)
})`,
        lang: 'js',
        options: [
          '每 5 秒一筆請求，和進出次數無關',
          '切走時瀏覽器自動清掉 interval，所以只有看板開著時有請求',
          '每 5 秒 4 筆，最早的那個 interval 在第 5 次掛載時自動停止',
          '每 5 秒約 5 筆：每次掛載都新開一個 interval，卸載時沒有清掉；網路慢時舊回應還可能晚到蓋掉新的',
        ],
        answer: 3,
        explain: '`setInterval` 和元件無關，元件卸載後它照樣跑，每掛載一次就多一個。要在 `onUnmounted` 裡 `clearInterval`。更好的寫法是上一次回來後才用 `setTimeout` 排下一次，請求不會疊在一起，再加上 `visibilitychange` 讓背景分頁暫停。',
      },
      {
        q: '看板改用 WebSocket，斷線後會退避重連。測試時 Wi-Fi 斷了 20 秒再恢復，看板接上了，但有一個診間的號碼停在斷線前的數字，直到下一次叫號才更新。最直接的修法是？',
        options: [
          '每次連上（包含重連）先抓一次完整的快照，再套用之後的事件；事件帶序號，比快照舊的丟掉',
          '把重連間隔縮短到 100 ms，斷線時間短就不會漏',
          '每秒送一次 ping，讓連線不會斷',
          '把 WebSocket 的 `bufferedAmount` 調大，讓伺服器替斷線的客戶端排隊',
        ],
        answer: 0,
        explain: '斷線期間伺服器送出的事件不會補到前端，重連得再快也已經漏了。重連後重抓快照，畫面才和伺服器一致；快照與新事件可能交錯，用序號丟掉舊的。ping 只能偵測斷線，擋不住 Wi-Fi 中斷；`bufferedAmount` 是唯讀的、代表前端還沒送出的資料量。',
      },
    ],
  },
]

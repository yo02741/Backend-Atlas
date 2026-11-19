// 前端路線：呼叫後端 的技能內文（以技能 id 為 key）
export default {
  'fetch-basics': {
    map: {
      names: [
        { n: '`fetch(url, options)`', t: '瀏覽器內建的 HTTP 請求函式，回傳 `Promise<Response>`；`options` 放 `method`、`headers`、`body`、`signal`、`credentials`。' },
        { n: '`Response` 與 `res.ok`', t: '`res.status` 是狀態碼，`res.ok` 在 200–299 時為 `true`；4xx、5xx 一樣會 resolve，要自己判斷。' },
        { n: '`res.json()`', t: '把 body 讀成 JSON，回傳 Promise；body 只能讀一次，空的 body（204）或 HTML 錯誤頁會丟 `SyntaxError`。' },
        { n: 'JSON body 與 `Content-Type`', t: '送 JSON 要 `JSON.stringify(data)` 並設 `Content-Type: application/json`；直接把物件放進 `body`，送出去的是字串 `[object Object]`。' },
        { n: '網路錯誤（`TypeError`）', t: '連不上、DNS 失敗、被 CORS 擋下時 fetch 會 reject，Chrome 的訊息都是 `TypeError: Failed to fetch`；是哪一種要看 Console 的其他訊息與 Network 分頁。' },
        { n: '`AbortController` 與 `AbortSignal.timeout()`', t: 'fetch 沒有 timeout 選項，取消與逾時都靠 `signal`：取消時 reject 的錯誤 `name` 是 `AbortError`，逾時是 `TimeoutError`。`AbortSignal.timeout()` 在 2024 年 4 月進入 Baseline。' },
        { n: 'Problem Details（RFC 9457）', t: '錯誤回應的標準格式，`Content-Type` 是 `application/problem+json`，欄位有 `type`、`title`、`status`、`detail`；畫面通常顯示 `title` 或 `detail`。' },
        { n: '`credentials`', t: '預設 `same-origin`：只有同源請求帶 cookie；跨網域要帶 cookie 時設 `include`，伺服器也要回對應的 CORS 標頭。' },
      ],
      ask: [
        '每個呼叫的方法、路徑、query 參數與 body 的格式',
        '哪些狀態碼算成功，4xx 與 5xx 各自怎麼處理',
        '錯誤 body 的格式（Problem Details）與畫面要顯示哪個欄位',
        '逾時幾秒、使用者離開畫面時要不要取消請求',
        '跨網域時要不要帶 cookie（`credentials`），CORS 由誰設定',
      ],
      prompt: '寫一個 `apiFetch(path, options)` 包住 fetch：路徑一律 `/api/` 開頭；`body` 是物件時自動 `JSON.stringify` 並加 `Content-Type: application/json`；用 `AbortSignal.timeout(8000)` 設 8 秒逾時。`res.ok` 為 `false` 時讀 Problem Details，丟出帶 `status`、`title` 的 `ApiError`；回應 204 時不呼叫 `res.json()`。網路錯誤與逾時丟不同的錯誤，讓畫面能分別顯示「無法連線」與「伺服器回應逾時」。',
      verify: [
        { c: '送出的 body', t: 'Network 分頁點開請求看 Payload：要是 JSON 物件；看到 `[object Object]` 代表少了 `JSON.stringify`。Headers 裡的 `Content-Type` 要是 `application/json`。' },
        { c: '4xx 有被當成錯誤', t: '查一個不存在的 id 讓後端回 404：畫面要顯示「找不到」，不能把 Problem Details 的 JSON 當成資料渲染出 `undefined`。' },
        { c: '網路錯誤', t: 'Network 分頁的節流選 `Offline` 再操作：畫面要顯示「無法連線」與重試；Console 出現 `Uncaught (in promise) TypeError: Failed to fetch` 代表沒有 `catch`。' },
        { c: '回應不是 JSON', t: 'Console 出現 `SyntaxError: Unexpected token \'<\', "<!doctype "... is not valid JSON`，代表拿到的是 HTML（反向代理的錯誤頁，或 SPA fallback 回了 `index.html`）；先看 Network 的 Response 分頁。' },
        { c: '逾時與取消', t: '節流選 `3G` 讓請求變慢，到了逾時秒數請求要顯示 `(canceled)`、畫面顯示逾時訊息；請求進行中離開畫面，也應該看到 `(canceled)`。' },
      ],
    },
    points: [
      { b: 'fetch 只在網路層失敗時 reject', t: '404、500 都會 resolve 成 `Response`，`if (!res.ok)` 要自己寫。只用 `try/catch` 包住 fetch，抓不到 500。' },
      { b: 'body 只能讀一次', t: '`res.json()`、`res.text()` 只能呼叫一次，要讀兩次先 `res.clone()`。204 沒有 body，呼叫 `res.json()` 會丟 `SyntaxError: Unexpected end of JSON input`。' },
      { b: '送 JSON 要兩件事', t: '`JSON.stringify` 加上 `Content-Type: application/json`。跨網域時這個 `Content-Type` 會讓瀏覽器先送 `OPTIONS` preflight，伺服器要回應它。' },
      { b: '逾時自己設', t: 'fetch 沒有 timeout 選項。用 `AbortSignal.timeout(ms)`，逾時時 `err.name === \'TimeoutError\'`；同時要讓使用者取消時，用 `AbortSignal.any([controller.signal, AbortSignal.timeout(ms)])`（2024 年 3 月進入 Baseline）。' },
      { b: '錯誤分三類', t: '網路錯誤與逾時、5xx 重試可能成功；4xx 代表請求本身有問題，重送結果一樣，要改請求或把原因告訴使用者。' },
    ],
    checklist: [
      '能寫出一個判斷 `res.ok`、讀 Problem Details、處理 204 的 fetch 包裝函式',
      '能在 Network 分頁看懂一個請求的 Headers、Payload、Response 與狀態',
      '能從 Console 的錯誤訊息分辨網路錯誤、CORS、回應不是 JSON 三種情況',
    ],
    refs: [
      { label: 'MDN：Using the Fetch API', url: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch' },
      { label: 'MDN：Response.ok', url: 'https://developer.mozilla.org/en-US/docs/Web/API/Response/ok' },
      { label: 'MDN：AbortSignal.timeout()', url: 'https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static' },
      { label: 'RFC 9457：Problem Details for HTTP APIs', url: 'https://datatracker.ietf.org/doc/html/rfc9457' },
      { label: 'Chrome DevTools：Network panel', url: 'https://developer.chrome.com/docs/devtools/network' },
    ],
  },
  'api-states': {
    map: {
      names: [
        { n: '四種狀態', t: 'loading（等回應）、success（有資料）、empty（成功但沒有資料）、error（失敗）；加上送出前的 idle，畫面一次只處於其中一種。' },
        { n: '`status` 變數', t: '一個 `ref<\'idle\' | \'loading\' | \'success\' | \'empty\' | \'error\'>` 表示目前的狀態，模板用 `v-if`／`v-else-if` 分開畫；不用 `isLoading`、`isError` 幾個布林值拼。' },
        { n: '不可能的狀態', t: '幾個布林值各自設定時，會出現「loading 與 error 同時為 true」這種組合，畫面同時出現 Skeleton 與錯誤訊息；單一 `status` 不會。' },
        { n: '能重試與不能重試', t: '網路錯誤、逾時、5xx 給「重試」按鈕；4xx（沒權限、找不到、參數錯）重試結果一樣，改顯示原因與下一步。' },
        { n: '重新整理（refreshing）', t: '已經有資料時再抓一次：保留舊清單、在標題旁顯示小 spinner，不整個換回 Skeleton。' },
        { n: '狀態轉換', t: 'idle → loading → success／empty／error，error 按重試回到 loading；每個轉換由什麼觸發（進入頁面、按重試、改條件）要寫清楚。' },
        { n: '驗收條件', t: '每個狀態一組能檢查的條件：出現哪個元件、哪段文字、按鈕能不能按、Network 分頁有幾筆請求。' },
      ],
      ask: [
        '每個請求的四種狀態各長什麼樣、用哪個元件',
        'empty 與 error 的文案與按鈕，兩者不共用同一個畫面',
        '哪些錯誤顯示重試、哪些只顯示原因（4xx 與 5xx 分開）',
        '已經有資料時重新抓，保留舊資料還是回到 Skeleton',
        '逾時幾秒算失敗、loading 太久時要不要提示',
      ],
      prompt: '`AppointmentList` 呼叫 `GET /api/appointments?date=2026-11-20`，用一個 `status` ref 表示 `loading`、`success`、`empty`、`error`。loading 顯示 5 列 Skeleton；empty 顯示「這天沒有預約」與「選擇其他日期」；error 依原因分開：網路錯誤、逾時與 5xx 顯示「重試」，403 顯示 Problem Details 的 `title` 且不給重試。重試與改日期都回到 loading；已經有清單時保留舊資料，只在標題旁顯示 spinner；請求逾時設 8 秒。',
      verify: [
        { c: '四種狀態都切得到', t: '用 MSW 或後端的測試資料分別回空陣列、500、403，再把 Network 分頁的節流設成 `Offline`；每一種都要有對應的畫面，出現一塊空白代表少寫一種。' },
        { c: 'empty 不等於 error', t: '在 Network 分頁的請求上按右鍵選 `Block request URL` 再重新整理，畫面不能顯示「這天沒有預約」。' },
        { c: '不會同時出現兩種', t: 'Vue DevTools 裡只有一個 `status` 值；畫面同時看到 Skeleton 與錯誤訊息，代表狀態用了好幾個布林值。' },
        { c: '重試有重送', t: '錯誤畫面按「重試」，Network 分頁多一筆請求、畫面先回到 loading；連按兩次只送出一筆。' },
        { c: '4xx 不給重試', t: '讓 API 回 403：畫面顯示原因、沒有重試按鈕；按重試能成功的錯誤才給重試。' },
      ],
    },
    points: [
      { b: '四種狀態都要有畫面', t: '只寫 success 的元件在請求失敗時留下一塊空白，使用者分不出是在等、沒有資料還是壞了。' },
      { b: '一個 status 取代幾個布林值', t: '`isLoading`、`hasError`、`isEmpty` 各自設定，遲早出現互相矛盾的組合。單一 `status` 加 `v-if`／`v-else-if`，畫面一次只有一種。' },
      { b: 'empty 是成功', t: '`[]` 是正常回應，給 Empty state 與下一步；失敗才給錯誤訊息。兩者共用一個畫面，網路斷掉時使用者會以為「今天沒有預約」。' },
      { b: '錯誤分能不能重試', t: '網路錯誤、逾時、5xx 重試可能成功；4xx 重試結果一樣，顯示原因與下一步，例如重新登入、回上一頁。' },
      { b: '重新整理保留舊資料', t: '已經有清單時再抓一次，保留舊清單並顯示小 spinner；整個換回 Skeleton 會讓畫面閃一下、捲動位置跑掉。' },
    ],
    checklist: [
      '能為一個清單寫出四種狀態的畫面、文案與驗收條件',
      '能用一個 `status` 變數寫出四種狀態，說出哪些錯誤給重試',
      '能用 Network 分頁的節流、`Offline` 與 `Block request URL` 切出每一種狀態',
    ],
    refs: [
      { label: 'Vue：Conditional Rendering', url: 'https://vuejs.org/guide/essentials/conditional.html' },
      { label: 'MDN：aria-busy', url: 'https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-busy' },
      { label: 'RFC 9457：Problem Details for HTTP APIs', url: 'https://datatracker.ietf.org/doc/html/rfc9457' },
    ],
  },
}

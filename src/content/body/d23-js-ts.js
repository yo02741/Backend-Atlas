// 前端路線：JavaScript 與 TypeScript 的技能內文（以技能 id 為 key）
export default {
  'async-js': {
    map: {
      names: [
        { n: 'Promise', t: '代表「之後才會有結果」的物件。狀態從 pending 變成 fulfilled（成功，有值）或 rejected（失敗，有原因），只會變一次。' },
        { n: '`async` 與 `await`', t: '`async` 函式一定回傳 Promise；`await` 讓這個函式暫停到 Promise 有結果，失敗時在這一行丟出錯誤，可以用 `try`/`catch` 接住。' },
        { n: '依序與平行', t: '一行一個 `await` 是依序，總時間是全部相加；先把請求都送出再一起等（`Promise.all`）是平行，總時間約等於最慢的那一個。' },
        { n: '`Promise.all`', t: '全部成功才成功，結果陣列的順序和輸入相同；任何一個失敗就馬上 reject，其他請求不會被取消，成功的結果也拿不到。' },
        { n: '`Promise.allSettled`', t: '等全部結束，逐一回報 `{ status: \'fulfilled\', value }` 或 `{ status: \'rejected\', reason }`；適合「部分失敗也要顯示其他區塊」。' },
        { n: '`Promise.race` 與 `Promise.any`', t: '`race` 取第一個結束的（成功或失敗都算），常拿來做逾時；`any` 取第一個成功的，全部失敗才丟出 `AggregateError`。' },
        { n: '`finally`', t: '不論成功、失敗都會執行，關掉 loading 放這裡。沒有被 `await` 的 Promise 失敗時不會進外層的 `catch`。' },
        { n: 'unhandled rejection', t: '失敗了卻沒有人處理的 Promise。Chrome 的 Console 顯示 `Uncaught (in promise)`，畫面多半停在 loading、沒有錯誤提示。' },
      ],
      ask: [
        '哪些請求彼此獨立可以平行送（`Promise.all`），哪些要等前一個的結果才能送。',
        '其中一個請求失敗時，整頁顯示錯誤，還是其他區塊照常顯示（`Promise.allSettled`）。',
        'loading 什麼時候開、什麼時候關（放在 `finally`），失敗時顯示什麼訊息、能不能重試。',
        '逾時多久算失敗，逾時後要不要取消請求（`AbortController`、`AbortSignal.timeout()`）。',
        '使用者連續觸發時（重複點擊、快速切換條件），還沒回來的舊請求怎麼處理。',
      ],
      prompt: '病患首頁 `PatientHome` 進頁時平行抓三支 API：`GET /api/me`、`GET /api/appointments?status=booked`、`GET /api/notices`，用 `Promise.allSettled` 等三個都結束。`/api/me` 失敗時整頁顯示錯誤與「重試」按鈕；另外兩支失敗時只在各自的區塊顯示錯誤，其他區塊照常顯示。每個請求用 `AbortSignal.timeout(8000)` 設 8 秒逾時，`loading` 在 `finally` 裡設回 `false`。不在 `forEach` 裡寫 `async` 回呼，也不留沒有處理的 Promise。',
      verify: [
        { c: '請求同時送出', t: 'Network 分頁節流切到 `Slow 4G` 後重新整理：三支 API 在 Waterfall 欄的長條應該同時開始；一條接一條排成階梯，代表程式寫成依序 `await`。' },
        { c: '部分失敗', t: '在 Network 分頁對 `/api/notices` 按右鍵選 `Block request URL` 再重新整理：只有公告區塊顯示錯誤、其他區塊正常；整頁變成錯誤，代表用了 `Promise.all`。' },
        { c: '沒處理的 Promise', t: 'Console 出現 `Uncaught (in promise) TypeError: Failed to fetch` 這類訊息，代表有 Promise 失敗沒有 `catch`；畫面通常同時卡在 loading。' },
        { c: 'loading 會關掉', t: '節流切到 `Offline` 再觸發一次：loading 消失並出現錯誤訊息才對；一直轉圈，代表關 loading 的程式只寫在成功的分支，沒有放進 `finally`。' },
        { c: '少了 await', t: '畫面上出現 `[object Promise]`，或 Console 出現 `TypeError: data.map is not a function`，代表拿到的是 Promise 本身，呼叫時少了 `await`。' },
      ],
    },
    points: [
      { b: 'Promise 只會定案一次', t: 'pending 之後變成 fulfilled 或 rejected 就不再改變。`await` 一個成功的 Promise 拿到值，失敗的則在那一行丟出錯誤，所以 `try`/`catch` 接得住 `await` 的失敗。' },
      { b: '依序還是平行', t: '`const a = await f(); const b = await g();` 等 `f` 結束才開始 `g`，總時間相加。兩者互不相依時寫 `const [a, b] = await Promise.all([f(), g()])`，總時間約等於較慢的那一個。' },
      { b: 'all、allSettled、race、any', t: '`all` 一個失敗就整體失敗，適合缺一不可；`allSettled` 等全部結束再逐一回報，適合各區塊獨立；`race` 取第一個結束的，常用來加逾時；`any` 取第一個成功的。`all` 失敗時其他請求仍在跑，要停掉得另外用 `AbortController`。' },
      { b: 'finally 關 loading', t: '`loading = true` 之後的請求不論成功、失敗或被取消，都要在 `finally` 把它設回 `false`；只寫在成功分支，網路一斷畫面就一直轉圈。' },
      { b: 'forEach 不會等 await', t: '`items.forEach(async (x) => { await save(x) })` 把所有呼叫一次丟出去、馬上往下執行，失敗也接不到。要依序用 `for...of` 加 `await`，要平行用 `await Promise.all(items.map(save))`。' },
    ],
    checklist: [
      '能把三個獨立的請求從依序 `await` 改成 `Promise.all`，並說出總時間的差別',
      '能依「缺一不可」或「各區塊獨立」選 `Promise.all` 或 `Promise.allSettled`，並寫出失敗時的畫面',
      '能找出 `forEach` 加 `async`、少了 `await`、loading 沒放 `finally` 這三種錯',
    ],
    refs: [
      { label: 'MDN：Using promises', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises' },
      { label: 'MDN：async function', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function' },
      { label: 'MDN：Promise.all()', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all' },
      { label: 'MDN：Promise.allSettled()', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled' },
      { label: 'MDN：AbortSignal.timeout()', url: 'https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static' },
    ],
  },
}

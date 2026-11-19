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
]

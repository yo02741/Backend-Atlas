// 題庫：JavaScript 與 TypeScript
export default [
  {
    skill: 'async-js',
    questions: [
      {
        q: '三支 API 互不相依。這個 `load()` 大約要多久，怎麼改最直接？',
        code: `async function load() {
  const me = await getMe()                // 約 300 ms
  const list = await getAppointments()    // 約 500 ms
  const notices = await getNotices()      // 約 200 ms
  return { me, list, notices }
}`,
        lang: 'js',
        options: [
          '約 500 ms；`await` 會讓三個請求自動平行',
          '約 1000 ms；先呼叫三個函式送出請求，再用 `Promise.all` 一起等',
          '約 1000 ms；把三個 `await` 拿掉就會平行，結果也拿得到',
          '約 200 ms；`await` 只會等最快的那一個',
        ],
        answer: 1,
        explain: '一行一個 `await` 時，下一個請求等上一個回來才送出，總時間是相加的約 1000 ms。先把三個函式都呼叫（請求同時送出）再用 `Promise.all` 一起等，總時間約等於最慢的 500 ms。拿掉 `await` 雖然會平行，但變數拿到的是 Promise 本身，不是資料。',
      },
      {
        q: '首頁的公告服務失敗時，掛號清單與個人資料仍要照常顯示。三個請求該用哪一個組合函式？',
        options: [
          '`Promise.all`，失敗時其他成功的結果仍會放在陣列裡',
          '`Promise.race`，取最快回來的那一個結果',
          '`Promise.any`，取第一個成功的結果',
          '`Promise.allSettled`，等全部結束後逐一看每個結果的 `status`',
        ],
        answer: 3,
        explain: '`allSettled` 不會失敗，等每個請求都結束後回傳 `fulfilled` 或 `rejected` 與各自的值或原因，各區塊可以分別處理。`Promise.all` 只要一個失敗就整體失敗，拿不到其他結果；`race` 與 `any` 都只給一個結果，另外兩份資料就沒了。',
      },
      {
        q: '這段儲存多筆掛號的程式有什麼問題？',
        code: `async function saveAll(items) {
  loading.value = true
  items.forEach(async (item) => {
    await api.post('/api/appointments', item)
  })
  loading.value = false
  toast('全部已儲存')
}`,
        lang: 'js',
        options: [
          '`forEach` 不等 `async` 回呼：loading 立刻關掉，Toast 在請求完成前就出現，失敗也接不到',
          '沒有問題，`forEach` 會依序等每一個 `await` 完成才往下',
          '`api.post` 不能放在迴圈裡，瀏覽器一次只允許送一個請求',
          '`async` 箭頭函式不能當 `forEach` 的回呼，執行時會出現 SyntaxError',
        ],
        answer: 0,
        explain: '`forEach` 呼叫每個回呼後不管它回傳的 Promise，所有請求一起丟出去，接著馬上關 loading、顯示「全部已儲存」，任何一筆失敗都會變成 `Uncaught (in promise)`。要依序用 `for...of` 加 `await`，要平行用 `await Promise.all(items.map(...))`，再把 loading 放進 `finally`。瀏覽器可以同時送多個請求，語法上也沒有錯。',
      },
    ],
  },
]

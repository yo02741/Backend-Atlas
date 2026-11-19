## 從一個具體問題開始：病患首頁要等 1 秒多才出現

病患首頁 `PatientHome` 進頁時要三份資料：病患本人（`/api/me`）、已預約的掛號（`/api/appointments?status=booked`）、醫院公告（`/api/notices`）。AI 產生的程式是這樣：

```js
async function load() {
  loading.value = true
  me.value = await api.get('/api/me')
  appointments.value = await api.get('/api/appointments?status=booked')
  notices.value = await api.get('/api/notices')
  loading.value = false
}
```

三支 API 各要 300、500、200 ms，畫面卻要等 1 秒才出現。打開 Network 分頁，三個請求在 Waterfall 欄排成階梯：第二個等第一個回來才送，第三個等第二個。這三份資料互不相依，同時送出的話，等最慢的 500 ms 就夠了。

這段程式還有兩個問題。公告服務掛掉時，`await` 在第三行丟出錯誤，`loading.value = false` 永遠不會執行，整頁停在轉圈；而且錯誤沒人接，Console 出現 `Uncaught (in promise)`。要寫對，得知道 Promise 的狀態怎麼變、`await` 暫停的是什麼，以及幾個組合多個 Promise 的函式各自在什麼條件下成功或失敗。

## 運作原理

### Promise 的三種狀態

```
            ┌── 成功 ──→ fulfilled（有 value）
pending ────┤
            └── 失敗 ──→ rejected（有 reason）
```

Promise 建立時是 pending，之後變成 fulfilled 或 rejected 其中之一，變了就不會再變。`fetch()`、`api.get()` 這類函式立刻回傳一個 pending 的 Promise，請求在背景進行。

### `async` 與 `await`

- `async function` 一定回傳 Promise。函式裡 `return x` 等於讓這個 Promise 以 `x` 成功；函式裡丟出錯誤等於讓它失敗。
- `await p` 讓目前這個 `async` 函式暫停，等 `p` 有結果：成功時取得值，失敗時在這一行丟出錯誤，所以外面的 `try`/`catch` 接得住。
- 暫停的只有這個函式。瀏覽器的主執行緒沒有被卡住，畫面、其他事件照常處理。

### 依序與平行

依序 `await` 時，下一個請求在上一個回來之後才送出：

```
依序：  /api/me            |=====300=====|
       /api/appointments                |=========500=========|
       /api/notices                                           |==200==|
                                                                總共約 1000 ms

平行：  /api/me            |=====300=====|
       /api/appointments  |=========500=========|
       /api/notices       |==200==|
                          總共約 500 ms（最慢的那一個）
```

平行的寫法是先呼叫三個函式（三個請求同時送出），手上拿到三個 pending 的 Promise，再用 `Promise.all` 一起等。`await` 寫在每個呼叫前面，就變回依序。

### 組合多個 Promise 的四個函式

| 函式 | 什麼時候成功 | 什麼時候失敗 | 適合 |
|---|---|---|---|
| `Promise.all` | 全部成功，值是結果陣列（順序同輸入） | 任何一個失敗就馬上失敗，原因是第一個失敗的 | 缺一不可的資料 |
| `Promise.allSettled` | 全部結束就成功，值是每一個的 `{ status, value }` 或 `{ status, reason }` | 不會失敗 | 各區塊獨立，部分失敗也要顯示其他 |
| `Promise.race` | 第一個結束的是成功 | 第一個結束的是失敗 | 加上逾時 |
| `Promise.any` | 第一個成功的 | 全部失敗，丟出 `AggregateError` | 多個來源取最快可用的 |

`Promise.all` 失敗時，其他還在進行的請求**不會被取消**，它們照樣跑完，只是結果沒人拿。要停掉請求，得在送出時帶 `AbortController` 的 `signal`（見下面的程式）。`allSettled` 是 ES2020、`any` 是 ES2021，主要瀏覽器都已支援。

## 實際程式碼

下面幾段在本站的 JavaScript 執行環境（Web Worker）裡跑，沒有網路，用 `setTimeout` 模擬 API 的延遲。按「在 Playground 開啟」可以改數字再跑。

### 依序與平行

```js run
// 用 setTimeout 模擬三支 API，各自延遲不同的毫秒數
const wait = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms))
const getMe = () => wait(300, { name: '王小明' })
const getAppointments = () => wait(500, [{ id: 1, dept: '內科' }, { id: 2, dept: '眼科' }])
const getNotices = () => wait(200, ['週六上午門診照常'])

// 依序：一行一個 await，總時間是三者相加
let t0 = Date.now()
const me1 = await getMe()
const list1 = await getAppointments()
const notices1 = await getNotices()
console.log('依序', Date.now() - t0, 'ms')   // 約 1000 ms

// 平行：先把三個請求都送出，再一起等
t0 = Date.now()
const [me2, list2, notices2] = await Promise.all([getMe(), getAppointments(), getNotices()])
console.log('平行', Date.now() - t0, 'ms')   // 約 500 ms，等於最慢的那一個
console.log(me2.name, '有', list2.length, '筆掛號；公告：', notices2[0])
```

### 一個失敗時：`all` 與 `allSettled`

```js run
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function getNotices() {
  await wait(100)
  throw new Error('503 Service Unavailable')   // 公告服務掛了
}
async function getAppointments() {
  await wait(200)
  return [{ id: 1, dept: '內科' }]
}

// Promise.all：一個失敗，整體馬上失敗，成功的那一份也拿不到
try {
  const [notices, list] = await Promise.all([getNotices(), getAppointments()])
  console.log('不會執行到這裡', notices, list)
} catch (err) {
  console.log('Promise.all 失敗：', err.message)
}

// Promise.allSettled：等全部結束，逐一回報
const results = await Promise.allSettled([getNotices(), getAppointments()])
for (const r of results) {
  if (r.status === 'fulfilled') console.log('成功', JSON.stringify(r.value))
  else console.log('失敗', r.reason.message)
}
```

### `forEach` 不會等 `await`

```js run
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const saved = []
async function save(id) {
  await wait(50 * id)
  saved.push(id)
}
const ids = [3, 1, 2]

// forEach 不等 async 回呼：這行執行完時一筆都還沒存
ids.forEach(async (id) => { await save(id) })
console.log('forEach 之後', JSON.stringify(saved))   // []

await wait(400)   // 等背景的呼叫跑完
console.log('等一下之後', JSON.stringify(saved))     // [1,2,3]：完成順序依延遲，不依陣列順序
saved.length = 0

// 依序：for...of 加 await
for (const id of ids) await save(id)
console.log('for...of', JSON.stringify(saved))       // [3,1,2]
saved.length = 0

// 平行：Promise.all 加 map
await Promise.all(ids.map(save))
console.log('Promise.all', JSON.stringify(saved))    // [1,2,3]，全部完成才往下
```

### `finally` 與逾時

```js run
const wait = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms))
const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error(`逾時 ${ms} ms`)), ms))

const state = { loading: false, error: null, data: null }
async function load(apiDelay) {
  state.loading = true
  state.error = null
  try {
    // race：誰先結束就用誰的結果；API 比 500 ms 慢就算失敗
    state.data = await Promise.race([wait(apiDelay, ['內科 101 診']), timeout(500)])
  } catch (err) {
    state.error = err.message
  } finally {
    state.loading = false   // 成功、失敗都會執行
  }
  console.log(`延遲 ${apiDelay} ms →`, JSON.stringify(state))
}

await load(200)
await load(900)
```

`Promise.race` 做的逾時只是「不等了」，背景的請求還在跑。瀏覽器裡呼叫實際的 API 時，讓 `fetch` 自己在逾時後中止比較完整：

```js
// AbortSignal.timeout()：8 秒後自動中止，fetch 以 name 為 'TimeoutError' 的錯誤失敗
const res = await fetch('/api/notices', { signal: AbortSignal.timeout(8000) })

// AbortController：自己決定何時取消，例如使用者換了搜尋條件；被取消的 fetch 以 'AbortError' 失敗
let controller = null
async function search(q) {
  controller?.abort()                 // 取消上一次還沒回來的搜尋
  controller = new AbortController()
  try {
    const res = await fetch(`/api/appointments?q=${encodeURIComponent(q)}`, { signal: controller.signal })
    return await res.json()
  } catch (err) {
    if (err.name === 'AbortError') return null   // 被新的搜尋取代：不顯示錯誤
    throw err
  }
}
```

`AbortSignal.timeout()` 是 Baseline 2024。取消請求與「舊回應蓋掉新結果」的處理，在呼叫後端的課裡細講。

### 寫成 Vue 元件裡的載入函式

```js
// PatientHome 的載入：三支平行、各自處理失敗、loading 一定會關
async function load() {
  loading.value = true
  try {
    const [meRes, apptRes, noticeRes] = await Promise.allSettled([
      api.get('/api/me'),
      api.get('/api/appointments?status=booked'),
      api.get('/api/notices'),
    ])
    if (meRes.status === 'rejected') throw meRes.reason   // 本人資料缺一不可：整頁錯誤
    me.value = meRes.value
    appointments.value = apptRes.status === 'fulfilled' ? apptRes.value : null
    apptError.value = apptRes.status === 'rejected'        // 只有這個區塊顯示錯誤
    notices.value = noticeRes.status === 'fulfilled' ? noticeRes.value : []
  } catch (err) {
    pageError.value = err
  } finally {
    loading.value = false
  }
}
```

`fetch` 收到 `404`、`500` 這類回應時不會失敗，要自己檢查 `res.ok` 再決定要不要丟出錯誤，見 [fetch 與 HTTP](#/skill/fetch-basics)。上面的 `api.get` 假設已經做了這件事。

## 常見錯誤與錯誤訊息

| 訊息或現象 | 原因 | 修法 |
|---|---|---|
| Console：`Uncaught (in promise) Error: …` | Promise 失敗沒有人處理：沒有 `try`/`catch`、`.then()` 後面沒有 `.catch()`、或在 `forEach` 的 `async` 回呼裡丟出錯誤 | 在 `await` 外包 `try`/`catch`，或在呼叫端接住 |
| Console：`Uncaught (in promise) TypeError: Failed to fetch` | Chrome 的網路錯誤（斷線、DNS 失敗、被 CORS 擋下）。Firefox 是 `NetworkError when attempting to fetch resource.`，Safari 是 `Load failed` | 網路錯誤要有自己的畫面與重試按鈕 |
| `SyntaxError: await is only valid in async functions and the top level bodies of modules` | 在一般函式裡寫了 `await` | 把外層函式改成 `async`；回呼也要各自加 `async` |
| `TypeError: data.map is not a function` | 少了 `await`，`data` 是 Promise 本身 | 呼叫時加 `await` |
| 畫面上出現 `[object Promise]` | 把 Promise 直接放進模板或字串 | 先 `await` 拿到值，存進狀態再顯示 |
| `AggregateError: All promises were rejected` | `Promise.any` 的每一個都失敗了 | 讀 `err.errors` 陣列看各自的原因 |
| 畫面一直轉圈 | 關 loading 的程式寫在成功分支，失敗時跳過了 | 移到 `finally` |
| 三個請求在 Waterfall 排成階梯 | 每個呼叫前面都寫了 `await` | 先呼叫、再用 `Promise.all` 一起等 |

有一種錯不會出現任何訊息：`try { return api.get(url) } catch {}`。`return` 一個 Promise 時沒有 `await`，函式在 Promise 失敗之前就離開了 `try`，`catch` 永遠接不到。在 `try` 裡回傳 Promise 時寫成 `return await api.get(url)`。

## 動手

- 按第一段程式的「在 Playground 開啟」，把 `getAppointments` 的延遲改成 2000，看依序與平行的時間差多少。
- 在第二段把 `Promise.all` 換成 `Promise.any`，再把 `getAppointments` 也改成丟出錯誤，看 `AggregateError` 長什麼樣。
- 在第四段把 `timeout(500)` 改成 `timeout(1000)`，看 `load(900)` 的結果怎麼變。
- 在本站任一技能頁打開 Network 分頁、節流切到 `3G`，重新整理後看 Waterfall 欄：哪些請求同時開始、哪些排在別人後面。
- 呼叫後端時的狀態與畫面，接著讀 [API 的四種狀態](#/skill/api-states)。

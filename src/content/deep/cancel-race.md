## 從一個具體問題開始：搜尋框寫「王小」，清單卻有王○同

掛號櫃台的病患搜尋框，每改一次文字就呼叫一次 `GET /api/patients?q=…`。櫃台人員打了「王」，停了一下，接著打成「王小」。畫面最後顯示三筆：王○明、王○同、王○玲。搜尋框寫的是「王小」，清單卻是「王」的結果。

Console 沒有任何錯誤，Network 分頁兩個請求都是 200。重新整理再試一次，又正常了。這類問題很難在開發機上重現：本機的 API 回得很快，兩個請求幾乎同時回來；到了正式環境，「王」比對到的資料多、查得慢，「王小」反而先回來。

| 時間 | 事件 | 畫面上的結果 |
|---|---|---|
| 0 ms | 送出 A：`q=王` | （loading） |
| 200 ms | 使用者改成「王小」，送出 B：`q=王小` | （loading） |
| 600 ms | B 回來，1 筆 | 王○明（對） |
| 1200 ms | A 回來，3 筆 | 王○明、王○同、王○玲（錯，條件是「王小」） |

兩個請求同時在路上，誰後回來誰決定畫面。這種情況叫競態（race condition）：結果取決於回應抵達的順序，而這個順序不受程式控制。

## 運作原理

### 三種做法各解決什麼

| 做法 | 怎麼做 | 解決競態 | 減少請求 | 適用 |
|---|---|---|---|---|
| 取消前一個請求 | 每個請求一個 `AbortController`，送新的之前 `abort()` 舊的 | 是 | 否（已送出的仍然送出） | fetch 與支援 `signal` 的函式庫 |
| 只採用最後一次的回應 | 送出時記下序號，回來時比對，不是最新的就丟掉 | 是 | 否 | 第三方 SDK 不收 `signal`、結果要寫進共用的 store |
| debounce | 停止輸入一段時間（例如 300 ms）才送 | 否 | 是 | 打字中的搜尋框、會觸發請求的拉桿 |

debounce 常被當成競態的解法。它讓請求變少，但「王」與「王小」之間如果停頓超過 300 ms，兩個請求一樣會同時在路上，一樣可能晚到。搜尋框通常 debounce 與取消一起用：前者省請求，後者保證畫面只反映最後的條件。

### AbortController 的幾個細節

- **一次性**：一個 controller 只能 abort 一次。已經 abort 過的 `signal` 再傳給 fetch，fetch 會立刻 reject，Network 分頁連請求都看不到。所以每個請求各建一個 controller，不要整個元件共用一個。
- **錯誤長什麼樣**：`controller.abort()` 之後，`await fetch()` 丟出 `DOMException`，`name` 是 `AbortError`，Chrome 的 `message` 是 `signal is aborted without reason`。如果回應的標頭已經回來、正在讀 body 時才 abort，`await res.json()` 一樣丟 `AbortError`。
- **帶理由的 abort**：`controller.abort('換了條件')` 會讓 fetch 丟出那個字串本身，`err.name` 是 `undefined`，判斷 `err.name === 'AbortError'` 會失敗。判斷「是不是被取消」用 `signal.aborted` 最穩。
- **同時要逾時與取消**：`AbortSignal.any([controller.signal, AbortSignal.timeout(8000)])` 合併兩個 signal，任一個觸發都會中止；逾時丟出的是 `TimeoutError`，可以和使用者取消分開處理。`AbortSignal.any()` 在 2024 年 3 月進入 Baseline。
- **Network 分頁**：被取消的請求在 Status 欄顯示 `(canceled)`。

### 取消之後，伺服器那邊

取消只代表瀏覽器不再等這個回應，請求可能早已抵達伺服器。查詢類的 `GET` 被取消沒有副作用，頂多浪費一次查詢。`POST` 被取消時，伺服器可能已經建立了掛號，前端卻以為沒送出；所以「取消」不能拿來當「撤銷」用，建立資料的請求要靠冪等鍵防止重送（見 [表單送出與驗證錯誤](#/skill/form-submit)）。

### Vue 的清理時機

`watch` 的 callback 每次條件改變都會執行一次。Vue 3.5 加入的 `onWatcherCleanup(fn)` 在 callback 裡登記一個清理函式，Vue 在兩個時機呼叫它：

1. 條件再次改變、callback 下一次執行之前。
2. watcher 停止時；在 `<script setup>` 裡同步建立的 watcher，元件卸載時會自動停止。

把「取消計時器」與「abort 請求」都放進清理函式，debounce、換條件取消、卸載取消三件事就由同一段程式處理。`onWatcherCleanup` 要在 callback 的第一個 `await` 之前呼叫：Vue 只在 callback 同步執行的那一段知道「目前是哪個 watcher」，`await` 之後才呼叫，Console 會出現 `[Vue warn] onWatcherCleanup() was called when there was no active watcher to associate with.`，清理函式也不會被登記。3.5 以前的寫法是 callback 的第三個參數 `onCleanup`，效果相同。

## 實際程式

### 三種做法的模擬

下面用 `setTimeout` 模擬一個收 `signal` 的 fetch：「王」要 300 ms、「王小」要 100 ms，使用者在 50 ms 時改成「王小」。分別跑三種寫法，看最後畫面停在哪個結果：

```js run
// 模擬的 API：和 fetch 一樣，signal 被 abort 時以 AbortError reject
const delays = { '王': 300, '王小': 100 }
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))
function fakeFetch(q, signal) {
  return new Promise((resolve, reject) => {
    const rows = q === '王' ? ['王○明', '王○同', '王○玲'] : ['王○明']
    const timer = setTimeout(() => resolve({ q, rows }), delays[q])
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
  })
}

async function run(strategy) {
  let shown = null, seq = 0, controller = null
  async function search(q) {
    const mine = ++seq                                        // 序號：這是第幾次搜尋
    if (strategy === 'abort') { controller?.abort(); controller = new AbortController() }
    try {
      const data = await fakeFetch(q, strategy === 'abort' ? controller.signal : undefined)
      if (strategy === 'seq' && mine !== seq) return console.log(`  丟掉「${q}」的回應：已經有更新的搜尋`)
      shown = data
      console.log(`  畫面改成「${q}」的 ${data.rows.length} 筆`)
    } catch (err) {
      if (err.name === 'AbortError') return console.log(`  「${q}」已取消`)
      throw err
    }
  }
  console.log(`[${strategy}]`)
  search('王')
  await sleep(50)
  search('王小')
  await sleep(400)                                            // 等兩個請求都結束
  console.log(`  搜尋框是「王小」，畫面是「${shown.q}」的結果${shown.q === '王小' ? '' : '  ← 不一致'}`)
}

await run('naive')   // 什麼都不做
await run('seq')     // 只採用最後一次的回應
await run('abort')   // 取消前一個請求
```

`naive` 的最後一行會標出不一致；`seq` 讓「王」的請求跑完但丟掉結果；`abort` 讓「王」在 50 ms 時就結束。把 `delays` 改成「王」比較快（例如 50），三種寫法的結果都對：競態只在慢的請求先送出時出現，這也是它在開發機上看不到的原因。

### Vue 元件：debounce 加取消

```vue
<script setup>
import { ref, watch, onWatcherCleanup } from 'vue'

const keyword = ref('')
const results = ref([])
const status = ref('idle')                  // idle | loading | success | error

watch(keyword, (q) => {
  const term = q.trim()
  if (term.length < 2) {                    // 太短不查，清掉舊結果
    results.value = []
    status.value = 'idle'
    return
  }
  const controller = new AbortController()
  const timer = setTimeout(() => search(term, controller.signal), 300)   // debounce 300 ms
  // 下一次 keyword 改變、或元件卸載時執行：還沒送出的取消計時，已經送出的 abort
  onWatcherCleanup(() => {
    clearTimeout(timer)
    controller.abort()
  })
})

async function search(term, signal) {
  status.value = 'loading'
  try {
    const res = await fetch(`/api/patients?q=${encodeURIComponent(term)}`, { signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    results.value = await res.json()        // 讀 body 時被 abort 也會丟 AbortError
    status.value = 'success'
  } catch (err) {
    if (signal.aborted) return              // 被取消：不改畫面，交給最新的那個請求
    status.value = 'error'
  }
}
</script>

<template>
  <input v-model="keyword" type="search" placeholder="病患姓名或病歷號" aria-label="搜尋病患">
  <p v-if="status === 'loading'">搜尋中…</p>
  <p v-else-if="status === 'error'" role="alert">搜尋失敗，請稍後再試</p>
  <ul v-else-if="status === 'success'">
    <li v-for="p in results" :key="p.id">{{ p.name }}</li>
  </ul>
</template>
```

幾個細節：

- 計時器與 controller 都在 callback 裡建立，每一輪各自一組；清理函式關住的是這一輪的那一組。
- `catch` 裡用 `signal.aborted` 判斷，不看 `err.name`，前面提過帶理由的 abort 會讓 `err.name` 變成 `undefined`。
- 不用另外寫 `onUnmounted`：watcher 在 `<script setup>` 裡同步建立，元件卸載時 Vue 停止它並執行最後一次清理。

:::stop 讀到這裡可以先停：會說出取消、序號、debounce 各解決什麼，並在 Vue 的 `watch` 裡用 debounce 加 `AbortController`。後面的舊版寫法、序號與現成工具，在專案是 Vue 3.4 以前、SDK 不收 `signal` 或改用 TanStack Query 時再回來讀。

Vue 3.4 以前的專案沒有 `onWatcherCleanup`，改用 callback 的第三個參數：

```js
watch(keyword, (q, _old, onCleanup) => {
  const controller = new AbortController()
  const timer = setTimeout(() => search(q, controller.signal), 300)
  onCleanup(() => { clearTimeout(timer); controller.abort() })
})
```

### 取消不了的時候：序號

第三方 SDK 不收 `signal`，或搜尋結果寫進好幾個元件共用的 Pinia store 時，用序號判斷回應還算不算數：

```js
// stores/patientSearch.js（setup store 節錄）
let latest = 0
async function search(term) {
  const mine = ++latest                       // 這次搜尋的序號
  const data = await sdk.searchPatients(term) // 不收 signal，取消不了
  if (mine !== latest) return                 // 已經有更新的搜尋，這個回應丟掉
  results.value = data
}
```

序號擋住了錯的畫面，請求本身仍然跑完，伺服器與網路的成本沒有省下來。能取消就取消，序號是補位用的。

### 現成的工具

TanStack Query 用 queryKey 區分結果：`['patients', keyword]` 換了條件就是另一筆快取，舊條件晚到的回應寫進舊的那一筆，不會出現在新條件的畫面上；queryFn 收到的 `signal` 在查詢不再被需要時會被 abort。VueUse 的 `watchDebounced` 提供 debounce 版的 watch。用了工具，「被取消不算錯誤」「畫面只反映最後的條件」這兩條驗收條件一樣要檢查。

## 常見錯誤與錯誤訊息

| 現象或訊息 | 原因 | 修法 |
|---|---|---|
| 搜尋框與結果不一致，Console 沒有錯誤 | 舊請求晚到，蓋掉新結果 | 換條件時 abort 舊請求，或用序號比對 |
| `Uncaught (in promise) AbortError: signal is aborted without reason` | abort 之後沒有 `catch` | `catch` 裡遇到取消直接 `return` |
| 快速打字時畫面閃出「搜尋失敗」 | `catch` 沒有區分取消與故障 | 用 `signal.aborted` 判斷，取消時不改 `status` |
| 第二次搜尋立刻失敗，Network 分頁看不到請求 | 整個元件共用一個 controller，已經 abort 過的 signal 再用 | 每個請求 `new AbortController()` |
| 取消被當成錯誤，`err.name` 是 `undefined` | `abort('換條件')` 帶了字串理由 | 用 `signal.aborted` 判斷 |
| `[Vue warn] onWatcherCleanup() was called when there was no active watcher to associate with.` | 在 `await` 之後才呼叫 | 移到 callback 的第一個 `await` 之前 |
| 加了 debounce，結果還是偶爾錯亂 | debounce 只減少請求，不處理晚到的回應 | 再加上取消或序號 |
| 離開頁面後跳出前一頁的錯誤 Toast | 卸載後回應才回來，照樣執行後續程式 | 卸載時 abort；用 `onWatcherCleanup` 時 watcher 停止會自動執行 |

## 動手

1. 打開 [API 狀態實驗室](#/lab/ApiStatesLab)，切到「競態」：關掉「用 AbortController 取消前一個請求」逐步播放，看 A 在第 4 步蓋掉 B；打開後再播一次，A 在第 2 步就被取消。
2. 按上面模擬的「在 Playground 開啟」，把 `delays` 改成 `{ '王': 50, '王小': 100 }`，確認三種寫法都正確；再把 `sleep(50)` 改成 `sleep(500)`（兩次輸入之間停頓更久），看競態消失的條件。
3. 在自己的專案把 Network 分頁節流選 `3G`，對任何「改條件就重抓」的畫面快速切換兩次條件，檢查最後的畫面與條件一致、較早的請求顯示 `(canceled)`。
4. 換條件時頁碼與已載入的資料怎麼處理，接著讀 [分頁、篩選與網址](#/skill/pagination-filter)。

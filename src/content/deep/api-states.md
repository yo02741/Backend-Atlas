## 從一個具體問題開始：一邊轉圈，一邊說「載入失敗」

預約清單的程式用三個變數表示請求的狀況：

```js
const isLoading = ref(true)
const error = ref(null)
const appointments = ref([])

async function load() {
  isLoading.value = true
  try {
    const res = await fetch('/api/appointments?date=2026-11-20')
    appointments.value = await res.json()
  } catch (e) {
    error.value = e
    appointments.value = []
  }
  isLoading.value = false
}
```

上線後出現三種奇怪的畫面：

1. 第一次失敗後按「重試」，畫面同時出現轉圈與「載入失敗」：`error` 沒有在重試時清掉，`isLoading` 與 `error` 同時成立。
2. 網路斷掉時，畫面寫「這天沒有預約」：`catch` 把清單設成空陣列，模板只看 `appointments.length === 0`。
3. 後端回 403 時，畫面顯示 `undefined` 組成的清單：沒有檢查 `res.ok`，Problem Details 被當成資料。

三個布林值與陣列可以組合出 8 種以上的狀況，模板只處理了其中幾種。改成一個變數、只允許五個值，畫面一次只會處在其中一種。

## 運作原理

### 五個值：idle 加四種狀態

| status | 什麼時候 | 畫面 | 元件 |
|---|---|---|---|
| `idle` | 還沒送出請求（例如等使用者選日期） | 提示要做什麼 | 說明文字 |
| `loading` | 請求進行中，還沒有任何資料 | 列數與列高接近真實資料的佔位 | Skeleton、停用的「重新整理」 |
| `success` | 2xx 且有資料 | 清單 | List 或 Table |
| `empty` | 2xx 但資料是空的 | 為什麼空、下一步 | Empty state、次要按鈕 |
| `error` | 網路錯誤、逾時、4xx、5xx | 發生什麼事、能不能重試 | inline Alert、「重試」 |

`empty` 是成功的一種：伺服器明確回答「沒有資料」。`error` 是「不知道有沒有資料」。兩者共用畫面，使用者會把故障當成沒有資料。

### 狀態轉換

```
idle            ──（進入頁面、選了日期）──────────► loading
loading         ──（2xx，有資料）─────────────────► success
loading         ──（2xx，空陣列）─────────────────► empty
loading         ──（網路錯誤、逾時、4xx、5xx）────► error
error           ──（按重試、改條件）──────────────► loading
success、empty  ──（改條件、重新整理）────────────► loading
```

上面沒有列出的轉換不該發生。例如狀態已經是 error，一個早先送出、現在才回來的請求不該把它改成 success，那代表舊請求沒有被取消。

### 錯誤分成能不能重試

| 錯誤 | 例子 | 重試有用嗎 | 畫面 |
|---|---|---|---|
| 網路錯誤 | 離線、DNS 失敗（`TypeError`） | 可能有用 | 「無法連線，請檢查網路」＋重試 |
| 逾時 | `TimeoutError` | 可能有用 | 「伺服器回應逾時」＋重試 |
| 5xx | 500、502、503、504 | 可能有用 | 「系統暫時無法處理」＋重試 |
| 429 | 請求太頻繁 | 等一下再試有用 | 依 `Retry-After` 停用重試一段時間 |
| 401 | 登入過期 | 沒用 | 導向登入，回來後重送 |
| 403 | 沒有權限 | 沒用 | Problem Details 的 `title`，不給重試 |
| 404 | 資源不存在 | 沒用 | 「找不到這筆資料」＋回上一頁 |

4xx 的意思是「請求本身有問題」，原封不動重送會得到一樣的結果；給一個按了沒用的重試按鈕，使用者會一直按。伺服器那一側怎麼決定狀態碼與錯誤格式，見 [錯誤設計](#/skill/error-design) 與 [呼叫外部服務的韌性](#/skill/resilience)。

### 已經有資料時：重新整理

使用者按「重新整理」或每 30 秒自動更新時，畫面上已經有清單。這時回到 loading（整個換成 Skeleton）會讓畫面閃一下、捲動位置跑掉。做法是狀態維持 success，另外用一個 `refreshing` 旗標在標題旁顯示小 spinner；更新失敗時保留舊清單，加一行「更新失敗，以下是 09:30 的資料」。

### 一個可以跑的狀態機

下面把轉換表寫成程式，送進一連串事件，看哪些轉換被接受、哪些被忽略；最後依錯誤種類判斷要不要給重試：

```js run
// 清單請求的狀態機：只有表裡列出的轉換會發生，其他事件忽略
const transitions = {
  idle:    { FETCH: 'loading' },
  loading: { OK: (data) => (data.length ? 'success' : 'empty'), FAIL: 'error' },
  success: { FETCH: 'loading' },
  empty:   { FETCH: 'loading' },
  error:   { RETRY: 'loading', FETCH: 'loading' },
}
function next(state, event, payload) {
  const t = transitions[state][event]
  if (!t) return state                                   // 不合法的事件：維持原狀態
  return typeof t === 'function' ? t(payload) : t
}
function isRetryable(err) {
  if (err.name === 'TypeError' || err.name === 'TimeoutError') return true   // 網路錯誤、逾時
  return err.status >= 500 || err.status === 429
}

let state = 'idle'
function send(event, payload) {
  const from = state
  state = next(state, event, payload)
  console.log(`${from.padEnd(7)} --${event}--> ${state}${from === state ? '（忽略）' : ''}`)
}
send('FETCH'); send('OK', [])                // 成功但沒有資料 → empty
send('FETCH'); send('FAIL')                  // 失敗 → error
send('OK', [{ id: 1 }])                      // 舊請求晚到：error 不接受 OK
send('RETRY'); send('OK', [{ id: 1 }])       // 重試成功 → success

for (const err of [{ name: 'TypeError' }, { name: 'TimeoutError' }, { name: 'ApiError', status: 503 }, { name: 'ApiError', status: 403 }, { name: 'ApiError', status: 404 }]) {
  console.log(`${err.name} ${err.status ?? ''} → ${isRetryable(err) ? '顯示重試' : '顯示原因，不給重試'}`)
}
```

## 實際程式：預約清單元件

```vue
<script setup>
import { ref, watch, onUnmounted } from 'vue'

const props = defineProps({ date: { type: String, required: true } })
const emit = defineEmits(['pick-date'])

const status = ref('idle')        // idle | loading | success | empty | error
const items = ref([])
const error = ref(null)           // { title, retryable }
const refreshing = ref(false)     // 已經有資料時的重新整理
let controller = null

function describe(err) {
  if (err.name === 'TimeoutError') return { title: '伺服器回應逾時', retryable: true }
  if (err.name === 'TypeError') return { title: '無法連線，請檢查網路', retryable: true }
  return { title: err.message, retryable: err.status >= 500 || err.status === 429 }
}

async function load() {
  controller?.abort()                                 // 換了日期：舊的請求不要了
  controller = new AbortController()
  const hasData = status.value === 'success'
  if (hasData) refreshing.value = true
  else status.value = 'loading'

  let res
  try {
    res = await fetch(`/api/appointments?date=${encodeURIComponent(props.date)}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
    })
  } catch (err) {
    if (err.name === 'AbortError') return             // 被取消：不改畫面
    return fail(err, hasData)                         // 網路錯誤或逾時
  }

  if (!res.ok) {
    const isJson = (res.headers.get('Content-Type') || '').includes('json')
    const problem = isJson ? await res.json() : null  // Problem Details
    return fail({ name: 'ApiError', status: res.status, message: problem?.title || `HTTP ${res.status}` }, hasData)
  }

  try {
    items.value = await res.json()
  } catch {
    return fail({ name: 'ApiError', status: res.status, message: '回應不是預期的格式' }, hasData)   // 例如拿到 HTML
  }
  status.value = items.value.length ? 'success' : 'empty'
  error.value = null
  refreshing.value = false
}

function fail(err, hasData) {
  error.value = describe(err)
  refreshing.value = false
  if (!hasData) status.value = 'error'                // 有舊資料就保留，只顯示更新失敗
}

watch(() => props.date, load, { immediate: true })   // 第一次與每次改日期都載入
onUnmounted(() => controller?.abort())
</script>

<template>
  <section :aria-busy="status === 'loading' || refreshing">
    <header class="head">
      <h2>{{ date }} 的預約</h2>
      <span v-if="refreshing" class="spinner" aria-hidden="true"></span>
      <button type="button" :disabled="status === 'loading' || refreshing" @click="load">重新整理</button>
    </header>

    <p v-if="status === 'success' && error" role="alert">更新失敗（{{ error.title }}），以下是先前的資料。</p>

    <div v-if="status === 'loading'">
      <div v-for="n in 5" :key="n" class="skeleton-row"></div>
    </div>
    <div v-else-if="status === 'error'" role="alert" class="alert">
      <p>{{ error.title }}</p>
      <button v-if="error.retryable" type="button" @click="load">重試</button>
      <p v-else>需要這份資料時，請聯絡系統管理者。</p>
    </div>
    <div v-else-if="status === 'empty'" class="empty">
      <p>這天沒有預約</p>
      <button type="button" @click="emit('pick-date')">選擇其他日期</button>
    </div>
    <ul v-else-if="status === 'success'">
      <li v-for="a in items" :key="a.id">{{ a.time }} {{ a.patientName }}</li>
    </ul>
  </section>
</template>
```

幾個細節：

- `fetch` 本身包在一個 `try` 裡，`res.json()` 與後面的處理在外面。`TypeError` 也可能是程式自己的錯（讀了 `undefined` 的屬性），全部包在同一個 `try` 裡，程式的 bug 會被顯示成「無法連線」。
- 初始值是 `idle`，不是 `success` 加空陣列；後者會在第一次請求送出前閃出「這天沒有預約」。
- `controller.abort()` 讓換日期時的舊請求不會晚到、蓋掉新日期的結果。快速切換條件的競態，實驗室的第二個模式可以看到。

### 每個狀態的驗收條件

| 狀態 | 驗收條件 |
|---|---|
| loading | 5 列 Skeleton，列高與真實資料相同；「重新整理」停用；容器有 `aria-busy="true"` |
| success | 每筆一列，`key` 是預約 id；Network 分頁只有一筆請求 |
| empty | 顯示「這天沒有預約」與「選擇其他日期」；沒有空白表頭 |
| error（可重試） | 顯示原因與「重試」；按下後回到 loading，Network 多一筆請求 |
| error（不可重試） | 顯示 Problem Details 的 `title`；沒有重試按鈕 |
| 重新整理失敗 | 舊清單還在，上方一行「更新失敗」 |

:::stop 讀到這裡可以先停：會用一個 `status` 表示五個值、分出能不能重試的錯誤，並照表驗收每個狀態。後面的現成工具與常見錯誤，在改用 TanStack Query 或排查畫面錯亂時再回來讀。

### 現成的工具

同樣的狀態有現成的函式庫處理：TanStack Query v5 的 `status` 是 `pending`、`error`、`success`，另外用 `fetchStatus`（`fetching`、`paused`、`idle`）表示背景更新，對應上面的 `refreshing`；空陣列仍然是 `success`，empty 要自己判斷。用不用工具，四種畫面與驗收條件都要自己定。

## 常見錯誤

| 現象 | 原因 | 修法 |
|---|---|---|
| 同時出現 Skeleton 與錯誤訊息 | 用好幾個布林值，重試時沒清掉 `error` | 改成單一 `status` |
| 網路斷了卻顯示「這天沒有預約」 | `catch` 裡把清單設成 `[]` | 錯誤進 `error` 狀態 |
| 畫面出現 `undefined` 或空白列 | 沒檢查 `res.ok`，把 Problem Details 當資料 | `if (!res.ok)` 進錯誤處理 |
| 403 的畫面有重試，按了沒反應 | 沒有區分能不能重試 | 4xx 不給重試，顯示原因 |
| 第一次進頁面閃一下「這天沒有預約」 | 初始狀態是空陣列 | 初始 `status` 用 `idle` 或 `loading` |
| 快速換日期後，清單顯示的是前一個日期 | 舊請求晚到，蓋掉新結果 | 換條件時 `abort()` 舊請求 |
| 程式的 bug 顯示成「無法連線」 | 把 `res.json()` 之後的處理也包進判斷網路錯誤的 `try` | 只包住 `fetch` 本身 |
| 自動更新時畫面每 30 秒閃一次 | 已有資料時也回到 loading | 用 `refreshing` 旗標保留舊資料 |
| loading 時連按「重新整理」送出好幾筆 | 按鈕沒有停用 | loading 與 refreshing 時停用 |

## 動手

1. 打開 [API 狀態實驗室](#/lab/ApiStatesLab)，依序切換成功、空清單、403、500、逾時、斷線，對照每個狀態的畫面、用到的元件與驗收條件；把延遲拉到 3 秒，看 loading 太久時的提示。
2. 切到實驗室的競態模式，關掉「取消前一個請求」，看較慢的舊回應蓋掉新結果；打開後再播一次。
3. 按上面狀態機的「在 Playground 開啟」，在 `transitions.success` 加一個 `REFRESH` 事件，讓它轉到新的 `refreshing` 狀態，再補上 `refreshing` 收到 `OK` 與 `FAIL` 的轉換。
4. 在自己的專案用 Network 分頁切出每一種狀態：`Offline`（網路錯誤）、節流 `3G` 加上較短的逾時（逾時）、在請求上按右鍵 `Block request URL`（網路錯誤），4xx 與 5xx 用後端的測試資料或 MSW 產生，逐條對照上面的驗收條件。

## 這階段要做出什麼

診次清單 `/sessions` 是登入後的第一頁：選日期與醫師，列出每個診次與剩餘名額，從這裡點進掛號。這一階段要讓它在每一種情況下都有正確的畫面：

| 狀態 | 什麼時候 | 畫面 |
|---|---|---|
| `loading` | 請求進行中，還沒有資料 | 三列 Skeleton，容器 `aria-busy="true"` |
| `success` | 2xx 且有資料 | 每個診次一張卡片，剩餘名額或「額滿」 |
| `empty` | 2xx 但陣列是空的 | 「這天沒有門診」加下一步的提示 |
| `error` | 網路錯誤、4xx、5xx | 原因；網路錯誤與 5xx 才給「重試」 |

另外兩件事：已經有清單時按「重新整理」，清單留在畫面上、按鈕停用，失敗了也只多一行提示；篩選條件（`date`、`doctor_id`）放在網址的 query 裡，重新整理、按上一頁、把網址傳給同事都看得到同一份清單。

API 是 `GET /api/sessions?date=2026-11-26&doctor_id=1`，回傳 `[{ id, doctor_id, session_date, period, capacity, remaining }]`。四種狀態與狀態轉換在 [API 的四種狀態：loading、success、empty、error](#/skill/api-states)；每種狀態用哪個元件在 [回饋：Toast、Alert、Skeleton、Empty state](#/skill/feedback)；條件放網址、push 與 replace 的選擇在 [分頁、篩選與網址](#/skill/pagination-filter) 與 [網址與瀏覽紀錄](#/skill/urls-history)。

## 設計決策與取捨

### 用一個 status 表示狀態

`isLoading`、`error`、`sessions.length === 0` 三個值可以組出八種以上的狀況，模板只處理了其中幾種：重試時沒清 `error` 就同時出現 Skeleton 與錯誤，`catch` 裡把清單設成 `[]` 就把故障顯示成「這天沒有門診」。改成一個 `status`，只允許四個值，模板用 `v-if`／`v-else-if` 一個接一個，畫面一次只會在其中一種。初始值是 `loading`：用 `success` 加空陣列開始，第一次請求送出前會閃出「這天沒有門診」。

### 錯誤分成能不能重試

網路錯誤與 5xx 可能是暫時的，給「重試」；403、404、422 這類 4xx 重送結果一樣，只顯示原因。401 已經由 `apiFetch` 換到登入頁，清單這裡不處理。

### 重新整理不回到 loading

已經有清單時回到 loading，整個清單換成 Skeleton，畫面閃一下、捲動位置跑掉。重新整理另外用 `refreshing` 旗標：清單留著、按鈕停用；失敗時 `refreshFailed` 加一行「更新失敗，以下是先前的資料」，舊清單照樣可以點。

### 網址是唯一的來源

| 放網址 | 不放網址 |
|---|---|
| 日期、醫師 | 輸入到一半的文字、哪一張卡片展開了 |

條件放進網址之後，元件不再有自己的 `date`、`doctorId` ref：`filters` 是從 `route.query` 算出來的 `computed`，輸入框用 `:value` 加 `@change`，改變時只呼叫 `router.push` 改網址，`watch` 看到網址變了才重新請求。同時存在兩份條件時，總有一個操作只改到其中一份。

`route.query` 的值都是字串，也可能是 `null` 或陣列（`?doctor_id=1&doctor_id=2`），手改的網址、舊的書籤會帶來不合法的值。`parseQuery` 先轉型與檢查，不合法就用預設值；`toQuery` 反過來，和預設值相同的條件不寫，「今天、全部醫師」的網址就是 `/sessions`。網址上的參數不合法時用 `router.replace` 改成解析後的條件，不合法的網址不留在瀏覽紀錄裡。

換日期、換醫師用 `push`：按上一頁要能回到前一組條件。只有修正網址用 `replace`。

### 換條件時取消上一輪

`watch` 的 callback 裡建一個 `AbortController`，用 `onWatcherCleanup` 登記 `abort()`（Vue 3.5 起；要在第一個 `await` 之前呼叫）。條件又變了或元件卸載時，Vue 先執行清理，舊的請求被取消，晚到的舊回應不會蓋掉新條件的清單。被取消的請求在 `catch` 裡用 `signal.aborted` 判斷，不顯示錯誤。完整的競態處理在第 4 階段。

## 關鍵程式

網址參數與條件的轉換，寫成純函式，可以單獨測：

```js
// src/lib/sessionQuery.js：網址參數 ↔ 診次清單的條件
export const DOCTORS = [{ id: 1, name: '林醫師' }, { id: 2, name: '張醫師' }]

export function today() {
  const d = new Date()
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
}
const first = (v) => (Array.isArray(v) ? v[0] : v)   // ?doctor_id=1&doctor_id=2 時取第一個

// route.query 的值都是字串（或 null、陣列）：轉型、檢查、給預設值
export function parseQuery(query) {
  const date = first(query.date) ?? ''
  const doctor = first(query.doctor_id) ?? ''
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today(),
    doctorId: DOCTORS.some((d) => String(d.id) === doctor) ? doctor : '',
  }
}

// 和預設值相同的條件不寫進網址
export function toQuery(filters) {
  const q = {}
  if (filters.date !== today()) q.date = filters.date
  if (filters.doctorId) q.doctor_id = filters.doctorId
  return q
}
```

清單頁：

```vue
<script setup>
import { ref, computed, watch, onWatcherCleanup } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiFetch } from '@/api/client'
import { DOCTORS, parseQuery, toQuery } from '@/lib/sessionQuery'

const PERIODS = { morning: '上午', afternoon: '下午', evening: '夜間' }
const route = useRoute()
const router = useRouter()
const filters = computed(() => parseQuery(route.query))   // 網址是唯一的來源

const status = ref('loading')        // loading | success | empty | error
const sessions = ref([])
const error = ref(null)              // { text, retryable }
const refreshing = ref(false)
const refreshFailed = ref(false)

function describe(err) {
  if (err.status === 403) return { text: '沒有權限查看診次', retryable: false }
  if (err.status >= 400 && err.status < 500) return { text: err.problem?.detail ?? '查詢條件有誤', retryable: false }
  if (err.status >= 500) return { text: '系統暫時無法處理', retryable: true }
  return { text: '無法連線，請檢查網路', retryable: true }              // 網路錯誤（TypeError）
}

function fetchSessions(signal) {
  const params = new URLSearchParams({ date: filters.value.date })
  if (filters.value.doctorId) params.set('doctor_id', filters.value.doctorId)
  return apiFetch(`/sessions?${params}`, { signal })
}

async function load(signal) {
  status.value = 'loading'
  try {
    sessions.value = await fetchSessions(signal)
    status.value = sessions.value.length ? 'success' : 'empty'
  } catch (err) {
    if (signal?.aborted || err.status === 401) return   // 換了條件，或 apiFetch 已經換到登入頁
    error.value = describe(err)
    status.value = 'error'
  }
}

async function refresh() {
  if (status.value !== 'success') return load()
  if (refreshing.value) return
  refreshing.value = true
  refreshFailed.value = false
  try {
    const data = await fetchSessions()
    sessions.value = data
    status.value = data.length ? 'success' : 'empty'
  } catch {
    refreshFailed.value = true                          // 舊清單留著
  } finally {
    refreshing.value = false
  }
}

// 只在這個路由時才看條件；條件換了就取消上一輪
watch(() => (route.name === 'sessions' ? JSON.stringify(filters.value) : null), (key) => {
  if (key === null) return
  const controller = new AbortController()
  onWatcherCleanup(() => controller.abort())
  load(controller.signal)
}, { immediate: true })

// 輸入框只改網址：換條件用 push（上一頁回得去），不合法的網址用 replace 修正
function setFilter(patch) {
  const next = { ...filters.value, ...patch }
  router.push({ query: toQuery(parseQuery({ date: next.date, doctor_id: next.doctorId })) })
}
watch(() => route.query, (q) => {
  if (route.name !== 'sessions') return
  const normalized = toQuery(parseQuery(q))
  if (JSON.stringify(normalized) !== JSON.stringify(q)) router.replace({ query: normalized })
}, { immediate: true })
</script>

<template>
  <main>
    <h1 tabindex="-1">診次清單</h1>
    <div class="filters">
      <label for="date">日期</label>
      <input id="date" type="date" :value="filters.date" @change="setFilter({ date: $event.target.value })">
      <label for="doctor">醫師</label>
      <select id="doctor" :value="filters.doctorId" @change="setFilter({ doctorId: $event.target.value })">
        <option value="">全部醫師</option>
        <option v-for="d in DOCTORS" :key="d.id" :value="String(d.id)">{{ d.name }}</option>
      </select>
      <button type="button" :disabled="status === 'loading' || refreshing" @click="refresh">重新整理</button>
    </div>

    <section :aria-busy="status === 'loading' || refreshing">
      <ul v-if="status === 'loading'" class="skeleton" aria-hidden="true">
        <li v-for="n in 3" :key="n"></li>
      </ul>
      <div v-else-if="status === 'error'" role="alert">
        <p>{{ error.text }}</p>
        <button v-if="error.retryable" type="button" @click="load()">重試</button>
      </div>
      <p v-else-if="status === 'empty'" class="empty">這天沒有門診，換一天或換一位醫師看看</p>
      <template v-else>
        <p v-if="refreshFailed" role="alert">更新失敗，以下是先前的資料</p>
        <ul class="sessions">
          <li v-for="s in sessions" :key="s.id" class="session">
            <h2>{{ s.session_date }} {{ PERIODS[s.period] }}診</h2>
            <p>{{ s.remaining > 0 ? `剩 ${s.remaining} 名` : '額滿' }}</p>
            <RouterLink v-if="s.remaining > 0" :to="{ name: 'book', params: { id: s.id } }">掛號</RouterLink>
          </li>
        </ul>
      </template>
    </section>
  </main>
</template>
```

watch 的來源是「只在這個路由時才有值」的字串：路由換到別頁時是 `null`，callback 直接 return；`JSON.stringify` 讓 push 了一組相同條件時不會重抓。

這段程式和第 1 階段的程式一起在 Chromium 裡跑過（Vue Router 5.5.1）：換醫師後網址多了 `doctor_id`、清單跟著變；打開 `/sessions?doctor_id=abc&date=xx` 時網址被改回 `/sessions`。

## 常見錯誤

**錯誤變成空清單。** `catch` 裡寫 `sessions.value = []`，伺服器 502 時畫面寫「這天沒有門診」，櫃台以為休診。錯誤進 `error` 狀態。

**沒檢查 `res.ok`。** `fetch` 遇到 4xx、5xx 不會 reject，Problem Details 被當成資料，畫面出現 `undefined` 組成的列。`apiFetch` 統一檢查。

**403 也給重試。** 按幾次結果都一樣。4xx 只顯示原因。

**重新整理時整個換成 Skeleton。** 每按一次畫面閃一下。用 `refreshing` 旗標。

**篩選只在 ref 裡。** 重新整理後回到今天、全部醫師；傳給同事的網址打開是預設的清單。條件放網址。

**只在 `onMounted` 讀一次網址。** 按上一頁網址變了，清單沒變。`watch` 從網址算出來的條件。

**`route.query.doctor_id` 直接拿去組請求。** 送出 `doctor_id=undefined` 或 `doctor_id=abc`。先經過 `parseQuery`。

**每次輸入都 `push`。** 日期欄每改一次留一筆紀錄，上一頁要按很多次才離開。日期與選單在 `change` 時才 push；打字中的搜尋框 debounce 之後用 `replace`。

## 驗收題在測什麼

**四種狀態與重新整理**：載入中只有 `data-test="loading"`；成功時三個診次，`remaining` 為 0 的顯示「額滿」；空陣列顯示「這天沒有門診」；500 時顯示「重試」且不顯示 empty，按重試後先回到 loading 再成功；重新整理時清單留著、按鈕停用；重新整理失敗時清單留著，上方出現「更新失敗，以下是先前的資料」。

**篩選放網址**：沙箱的文件網址是 `about:srcdoc`，`history.replaceState` 只能改 hash，所以題目把 hash 當成 query（和 `createWebHashHistory` 的網址相同，`#/sessions?date=…`），附上代替 `route.query` 的 `readQuery()` 與代替 `router.replace` 的 `replaceQuery()`。沙箱 iframe 的瀏覽紀錄和網站共用（實測在 iframe 裡改 hash，外殼的 `history.length` 跟著增加，iframe 移除後也不會減少），所以題目只用 replace，push 與上一頁的行為在上面的程式裡。測試打開帶條件的網址時第一個請求要用那組條件、選單跟著顯示；不合法的參數落回預設值，網址上不留 `date`、`doctor_id`；改條件後網址與請求一起變，選回全部醫師時網址拿掉 `doctor_id`；網址從外面改變並觸發 `hashchange` 時重新載入。

下一階段從卡片上的「掛號」進到掛號表單。

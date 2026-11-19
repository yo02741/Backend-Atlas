## 從一個具體問題開始：一個頁面送了三次同樣的請求

「今日門診」頁有三個元件用到今天的預約：頁首的「今天 32 筆掛號」、主內容的預約清單、側欄的各診間小計。三個元件各自在 `onMounted` 呼叫 `fetch('/api/appointments?date=2026-11-20')`。打開 Network 分頁：

- 進頁時同一個網址出現三次。
- 點進一筆預約再按上一頁，清單又回到 Skeleton，等 600 ms 才出現；剛剛明明已經看過這些資料。
- 在清單上取消一筆，清單少了一列，頁首還是「32 筆」，側欄的小計也沒變。
- 有人把清單存進 Pinia 解決重複請求，結果換成另一個帳號登入時，畫面先閃出上一個帳號的預約。

這幾個問題的原因相同：從 API 來的資料被當成元件自己的狀態。它是伺服器上某份資料在某個時間點的複本，會過期、會被別人改掉、會被好幾個元件同時需要，要當成快取來管。

## 運作原理

### 伺服器狀態與前端狀態

| | 前端狀態 | 伺服器狀態 |
|---|---|---|
| 例子 | Dialog 開了沒、表單正在輸入的值、目前的 Tab | 預約清單、病患資料、診間名額 |
| 誰擁有 | 這個瀏覽器分頁 | 伺服器；前端拿到的是某個時間點的複本 |
| 會不會過期 | 不會 | 會，別人隨時可能改掉 |
| 放哪裡 | 元件、Pinia、網址 | 查詢快取（TanStack Query、Pinia Colada） |

前端狀態的工具（`ref`、Pinia）不管「這份資料多舊了」「別的元件是不是正在抓同一份」「改了之後誰要重抓」。查詢快取專門管這些事。

### 一份快取的一生

以 key `['appointments', { date: '2026-11-20', clinic: 101 }]` 為例：

```text
時間 →
請求中 ──→ fresh ─────────→ stale ──────────────────→ inactive ──────→ 清除
 第一次     剛回來           過了 staleTime              沒有元件在用      過了 gcTime
 顯示       不重抓           照樣顯示；                  仍留在快取裡      （預設 5 分鐘）
 Skeleton                    掛載、回到分頁、網路恢復時   回來時先顯示它
                             在背景重抓
```

- **fresh**：在 `staleTime` 內，不論多少元件來要，都直接給快取，不送請求。
- **stale**：照樣顯示，只是遇到「元件掛載、視窗重新取得焦點、網路恢復」時，會在背景重抓。這就是 stale-while-revalidate：先給舊的，同時去拿新的。
- **inactive**：沒有任何元件在用。資料仍留著，`gcTime` 到了才清掉；在那之前回到頁面，畫面可以先顯示它。
- **重複請求合併**：同一個 key 已經有請求在路上時，第二個、第三個元件等同一個結果，不再送新請求。

### 查詢 key

key 是快取資料的名字，通常是一個陣列：資源名稱在前，參數放在後面的物件裡。規則只有兩條：

1. **請求用到的每個參數都要在 key 裡**。少了 `clinic`，切換診間時拿到的是同一份快取，畫面顯示的是另一個診間的預約。
2. **同一份資料的 key 寫法要一致**。一個元件寫 `clinic: 101`、另一個寫 `clinic: '101'`，就是兩份快取、兩個請求。把 key 集中寫在一個函式裡（例如 `appointmentKeys.list(date, clinic)`）可以避免。

失效時用前綴比對：讓 `['appointments']` 失效，所有開頭是 `'appointments'` 的 key 都會被標成過期。

### 兩種「載入中」

| | 意思 | 畫面 | TanStack Query | Pinia Colada |
|---|---|---|---|---|
| 還沒有資料 | 這個 key 第一次抓 | Skeleton | `isPending` | `status === 'pending'` |
| 有請求在路上 | 第一次抓或背景重抓 | 已經有資料時：標題旁的小 spinner | `isFetching` | `asyncStatus === 'loading'` |

把 Skeleton 綁在 `isFetching` 上，每次回到分頁、每次背景重抓，整個清單都會閃回 Skeleton。這和 [API 的四種狀態](#/skill/api-states) 裡「重新整理時保留舊資料」是同一件事。

### 資料被改了之後

取消一筆預約之後，至少三份快取過期：清單、頁首的筆數、側欄的小計。三種同步方式：

| 做法 | 怎麼做 | 代價 |
|---|---|---|
| 失效並重抓 | `invalidateQueries({ queryKey: ['appointments'] })` | 多一個請求；最不容易出錯 |
| 用回應改寫快取 | `setQueryData(key, (old) => …)` | 省一個請求；要自己保證改出來的形狀和 API 一樣 |
| 樂觀更新 | 送出前先改快取，失敗時還原 | 最快；要處理失敗的還原，見 [表單送出與驗證錯誤](#/skill/form-submit) |

### 兩個工具的預設值

依 npm 上 `@tanstack/query-core` 5.108.0 與 `@pinia/colada` 1.4.9 的原始碼：

| | TanStack Query 5 | Pinia Colada 1.4 |
|---|---|---|
| `staleTime` | 0：抓回來立刻就是 stale | 5 秒 |
| `gcTime` | 5 分鐘 | 5 分鐘 |
| 掛載、回到視窗、網路恢復時重抓 | 開（只重抓 stale 的） | 開（只重抓 stale 的） |
| 失敗自動重試 | 3 次，間隔 1、2、4 秒（上限 30 秒） | 沒有內建，另裝 `@pinia/colada-plugin-retry` |
| 同一個 key 的請求合併 | 有 | 有 |

TanStack Query 的 `staleTime: 0` 讓「切到別的分頁再切回來就重抓一次」成為預設行為；重試的預設讓一個一定會失敗的請求要等大約 7 秒（加上每次請求本身的時間）才顯示錯誤。這兩件事常被當成 bug 回報。

### 和瀏覽器的 HTTP 快取是兩層

瀏覽器另外有一層 HTTP 快取，由回應的 `Cache-Control` 決定。`Cache-Control: max-age=60, stale-while-revalidate=300` 是 HTTP 版的同一個概念（RFC 5861；依 MDN 的相容性資料，Chrome 75、Firefox 68、Safari 14 起支援這個指令）。

兩層疊在一起時要注意：查詢快取決定「重抓」，送出的 `fetch` 仍然可能被 HTTP 快取直接回答，拿到的還是舊資料。會被使用者修改的 API（預約清單）通常回 `Cache-Control: no-store` 或 `no-cache`；前端也可以在這個請求加 `fetch(url, { cache: 'no-store' })` 略過 HTTP 快取。伺服器端的規則見 [HTTP 快取與條件請求](#/skill/http-caching)。

## 實際程式

### 一個最小的查詢快取

把上面的規則寫成三十行，看 fresh、stale、合併與失效各自發生什麼：

```js run
// 最小的查詢快取：key、staleTime、重複請求合併、stale-while-revalidate、失效
let onServer = ['09:00 王○明', '09:15 陳○華', '09:30 林○安']   // 伺服器上的預約
let requests = 0
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))

async function fetchAppointments(key) {          // 假的 API：300 ms 後回來
  const n = ++requests
  console.log(`    → 請求 #${n} ${key}`)
  await sleep(300)
  return [...onServer]
}

function createQueryCache({ staleTime }) {
  const entries = new Map()                       // key → { data, updatedAt, promise }
  function query(key, fn) {
    if (!entries.has(key)) entries.set(key, {})
    const e = entries.get(key)
    const fresh = e.updatedAt !== undefined && Date.now() - e.updatedAt < staleTime
    if (!fresh && !e.promise) {                   // 過期或沒有資料：送請求，但同一個 key 只送一個
      e.promise = fn(key)
        .then((data) => { e.data = data; e.updatedAt = Date.now(); return data })
        .finally(() => { e.promise = null })
    }
    if (e.data !== undefined) {                   // 有資料就先給（fresh 或 stale-while-revalidate）
      return Promise.resolve({ data: e.data, note: fresh ? '快取，fresh' : '快取，stale：先顯示、背景重抓' })
    }
    return e.promise.then((data) => ({ data, note: '第一次：等請求回來' }))
  }
  function invalidate(prefix) {                   // 開頭相同的 key 都標成過期
    for (const [key, e] of entries) if (key.startsWith(prefix)) e.updatedAt = undefined
  }
  return { query, invalidate }
}

const cache = createQueryCache({ staleTime: 500 })
const KEY = 'appointments?date=2026-11-20&clinic=101'
const show = (who, r) => console.log(`  ${who}：${r.data.length} 筆（${r.note}）`)

console.log('1. 頁首與清單同時掛載')
const [a, b] = await Promise.all([cache.query(KEY, fetchAppointments), cache.query(KEY, fetchAppointments)])
show('頁首', a); show('清單', b)

console.log('2. 100 ms 後切回清單（還在 staleTime 內）')
await sleep(100)
show('清單', await cache.query(KEY, fetchAppointments))

console.log('3. 600 ms 後再回來（已經 stale）')
await sleep(600)
show('清單', await cache.query(KEY, fetchAppointments))
await sleep(350)                                  // 等背景重抓結束

console.log('4. 取消 09:15 的預約，成功後讓 appointments 失效')
onServer = onServer.filter((x) => !x.startsWith('09:15'))
cache.invalidate('appointments')
show('清單', await cache.query(KEY, fetchAppointments))
await sleep(350)
show('清單', await cache.query(KEY, fetchAppointments))
console.log(`總共送出 ${requests} 個請求`)
```

第 4 步失效後的第一次讀取仍然是 3 筆：先顯示舊資料、背景重抓，新資料回來後才變成 2 筆。TanStack Query 的 `invalidateQueries` 會立刻重抓畫面上正在使用的 key，所以實際畫面在重抓回來的那一刻就更新，不用等下一次讀取。

### Vue 加 TanStack Query

```js
// main.js
import { createApp } from 'vue'
import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query'
import App from './App.vue'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },   // 30 秒內不重抓；預設是 0
})
createApp(App).use(VueQueryPlugin, { queryClient }).mount('#app')
```

```vue
<script setup>
import { toRefs } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
const props = defineProps({ date: String, clinic: Number })
const { date, clinic } = toRefs(props)        // ref 放進 key，值一變就換一份快取
const qc = useQueryClient()

const { data, isPending, isFetching, isError, refetch } = useQuery({
  queryKey: ['appointments', { date, clinic }],
  queryFn: async ({ signal }) => {             // signal：key 換掉或元件卸載時取消舊請求
    const res = await fetch(`/api/appointments?date=${date.value}&clinic=${clinic.value}`, { signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)   // 丟出錯誤，查詢才會進入 error
    return res.json()
  },
})

const cancel = useMutation({
  mutationFn: async (id) => {
    const res = await fetch(`/api/appointments/${id}/cancel`, { method: 'POST' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
  onSuccess: () => qc.invalidateQueries({ queryKey: ['appointments'] }),   // 清單、筆數、小計一起重抓
})
</script>

<template>
  <h2>今日門診 <span v-if="isFetching && !isPending" class="spinner" aria-label="更新中" /></h2>
  <SkeletonList v-if="isPending" :rows="5" />
  <Alert v-else-if="isError">預約清單暫時無法載入 <button @click="refetch()">重試</button></Alert>
  <AppointmentTable v-else :rows="data" @cancel="cancel.mutate" />
</template>
```

範例省略了 empty 狀態，完整的四種狀態見 [API 的四種狀態](#/skill/api-states)。

登出時呼叫 `queryClient.clear()` 清掉所有快取，下一個登入的人不會先看到上一個人的資料。

### Pinia Colada 的寫法

Pinia Colada 是 Vue 生態系的查詢快取，用 Pinia 存放快取，API 名稱不同、概念相同：

```js
import { useQuery, useMutation, useQueryCache } from '@pinia/colada'

const queryCache = useQueryCache()
const { state, asyncStatus, refresh } = useQuery({
  key: () => ['appointments', { date: date.value, clinic: clinic.value }],   // getter，值變就換 key
  query: ({ signal }) => fetchAppointments(date.value, clinic.value, signal),
  staleTime: 30_000,
})
const { mutate: cancel } = useMutation({
  mutation: (id) => cancelAppointment(id),
  onSettled: () => queryCache.invalidateQueries({ key: ['appointments'] }),
})
```

選哪一個：TanStack Query 跨 React、Vue、Svelte 等框架，文件與範例多；Pinia Colada 只給 Vue 用，和 Pinia 的開發工具整合，預設值比較保守（`staleTime` 5 秒、不內建重試）。兩者都比自己用 Pinia 寫一套快取省事。

## 常見錯誤

- **key 少了參數**：切換診間或日期時，畫面停在舊條件的資料。在 TanStack Query 的 Devtools 裡看，每個條件都應該有自己的一份快取。
- **key 寫法不一致**：同一份資料出現兩份快取、兩個請求。Network 分頁看到同樣的網址在進頁時出現兩次，先檢查 key。
- **Skeleton 綁在 `isFetching` 上**：回到分頁、背景重抓時整個清單閃一下，捲動位置跑掉。Skeleton 用 `isPending`。
- **忘了失效或打錯 key**：改了資料，畫面上其他地方沒更新。改資料的請求成功後，Network 分頁應該緊接著出現重抓的請求。
- **`queryFn` 沒有在 `!res.ok` 時丟錯誤**：fetch 遇到 4xx、5xx 不會 reject，查詢就把錯誤的 body 當成資料存進快取，畫面顯示 `undefined` 或空清單。
- **HTTP 快取回答了重抓**：失效後明明送了請求，資料還是舊的；Network 分頁的 Size 欄是 `(disk cache)`。檢查 API 回的 `Cache-Control`。
- **把 API 資料複製進 Pinia 再自己改**：兩份資料各自過期，又要自己寫同步。伺服器資料留在查詢快取，Pinia 放前端狀態。
- **測試等錯誤等很久**：TanStack Query 預設重試 3 次，測試裡錯誤狀態要好幾秒才出現。測試用的 `QueryClient` 設 `retry: false`。

## 動手

1. 執行上面「最小的查詢快取」，把 `staleTime` 改成 2000，看第 3 步變成什麼；再把第 1 步的兩個查詢改成不同的 key，看請求數怎麼變。
2. 在自己的專案打開一個列表頁，Network 分頁篩選 API 的路徑，記下進頁、離開再回來、切到別的分頁再回來時各送了幾次請求。
3. 找一個「改了資料、別處沒更新」的地方，寫出應該失效的 key 清單。
4. 讀 [API 的四種狀態](#/skill/api-states) 的「重新整理保留舊資料」，再到 [API 狀態實驗室](#/lab/ApiStatesLab) 看舊回應蓋掉新結果的競態，查詢快取用 `signal` 處理的就是這件事。

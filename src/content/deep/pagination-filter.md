## 從一個具體問題開始：按了上一頁，篩選全沒了

櫃台在「掛號清單」選了狀態「已掛號」、日期從 11 月 1 日起，按了兩次「載入更多」，捲到第 47 筆，點進去看詳細資料。看完按瀏覽器的上一頁：篩選回到「全部」，清單只剩第一批 20 筆，捲軸停在最上面。她把網址貼給同事請他幫忙看第 47 筆，同事打開看到的也是預設的清單。

篩選條件只存在元件的 `ref` 裡。元件卸載時這些 ref 跟著消失，網址上也沒有任何線索，重新進來只能從預設值開始。

## 運作原理

### 哪些東西放網址

| 放網址 | 不放網址 |
|---|---|
| 關鍵字、狀態、日期區間、科別這類篩選 | 輸入框打到一半、還沒按搜尋的文字 |
| 排序欄位與方向 | 展開了哪幾列、hover 在哪 |
| offset 分頁的頁碼 | cursor 分頁的 cursor（見下一節） |
| 目前的 Tab（「今日」「本週」） | 登入者、權限、token |

判斷方式：重新整理後要還在、貼給別人要看到同一個畫面、按上一頁要回得去的，放網址。條件放進網址之後，網址就是唯一的來源：元件從網址讀條件，按鈕與輸入框只改網址，不另外存一份。兩份同時存在時，總有一個操作只改了其中一份。

### offset 與 cursor：前端看到的差別

| | offset 分頁 | cursor 分頁 |
|---|---|---|
| 請求 | `?page=3&size=20` 或 `?offset=40&limit=20` | `?limit=20&cursor=…` |
| 回應 | 這一頁的資料，常附總筆數 | 這一批的資料與 `next_cursor` |
| 畫面元件 | Pagination（頁碼、上一頁、下一頁、跳頁） | 「載入更多」按鈕或無限捲動 |
| 跳到第 7 頁 | 可以 | 不行，只能一批一批往下 |
| 頁碼放網址 | 放，`?page=3` 打開就是第 3 頁 | cursor 不放；它是不透明的字串，過一陣子可能失效 |
| 翻頁之間有新資料 | 會重複或漏掉 | 不會 |

offset 的重複怎麼發生：清單依建立時間新到舊排列，第 1 頁是最新的 20 筆。使用者看第 1 頁時，櫃台新增了一筆掛號。這時要第 2 頁（`offset=20`），伺服器重新排序，原本的第 20 筆被擠到第 21 筆，於是出現在第 2 頁的第一列：同一筆在兩頁各出現一次。刪除資料時則反過來，會漏掉一筆。cursor 記的是「上一批最後一筆的位置」，下一批從那之後接著拿，不受前面新增或刪除影響。

用哪一種由後端的 API 決定，前端跟著選元件。本站後端參考專案的 `GET /appointments` 是 cursor 分頁：回應 `{ items, next_cursor }`，`next_cursor` 為 `null` 代表沒有下一批。伺服器那一側怎麼設計 cursor，見 [分頁、篩選、版本與冪等鍵](#/skill/api-patterns)。

### query 讀進來都是字串

Vue Router 的 `route.query` 型別是 `Record<string, string | null | (string | null)[]>`：

| 網址 | `route.query.page` |
|---|---|
| `?page=2` | `'2'`（字串） |
| `?page` | `null` |
| `?page=2&page=3` | `['2', '3']` |
| 沒有這個參數 | `undefined` |

`route.query.page + 1` 得到的是 `'21'`。所以讀進來的第一件事是解析：轉型、檢查範圍與允許的值，不合法就用預設值。使用者手改網址、舊的書籤、別的系統產生的連結，都可能帶來不合法的值；直接拿去組請求，送出的就是 `page=NaN`。

### push 還是 replace

| 操作 | 用 | 理由 |
|---|---|---|
| 換篩選、換排序、換頁碼 | `router.push` | 上一頁要能回到前一組條件 |
| 關鍵字輸入框（debounce 之後） | `router.replace` | 每打一個字就一筆紀錄，上一頁要按很多次才離開 |
| 解析後發現參數不合法，改成預設值 | `router.replace` | 不合法的網址不該留在瀏覽紀錄裡 |

### 回到原位：捲動位置與已載入的資料

從詳細頁按上一頁回來，Vue Router 的 `scrollBehavior` 會收到 `savedPosition`（離開時的捲動位置），回傳它就會捲回去。前提是那個位置在當下存在：如果清單要重新抓資料，捲動發生時頁面只有 Skeleton，高度不夠，只能停在頂端。

兩種做法：

- **保留清單元件**：用 `<KeepAlive>` 包住列表頁，離開時元件不卸載，已載入的三批資料與 DOM 都還在，捲動位置也還原得回去。cursor 分頁的「載入更多」通常用這個做法，因為重新抓只拿得到第一批。
- **等資料畫好再捲動**：`scrollBehavior` 可以回傳 Promise，等清單渲染完再 resolve 捲動位置。offset 分頁回到第 3 頁只要抓一頁，適合這個做法。

Vue Router 5.5 的型別定義把 `scrollBehavior` 標成 deprecated，建議改用 `vue-router/experimental` 的 `useScrollRestoration()`；新的 API 還在實驗階段，`scrollBehavior` 目前照常運作，Vue Router 4 的專案也都用它。

## 實際程式

### 解析與寫回網址

把「網址參數 → 條件」與「條件 → 網址參數」寫成兩個純函式，列表元件只呼叫它們。下面這段可以直接執行，看各種奇怪的網址被解析成什麼：

```js run
// 網址參數 → 畫面用的條件：轉型、檢查、給預設值
const STATUSES = ['all', 'booked', 'checked_in', 'cancelled']
const DEFAULTS = { status: 'all', from: null, page: 1 }

const first = (v) => (Array.isArray(v) ? v[0] : v)       // ?status=a&status=b 時取第一個
function parseQuery(query) {
  const status = first(query.status)
  const from = first(query.from) ?? ''
  const page = Number(first(query.page))
  return {
    status: STATUSES.includes(status) ? status : DEFAULTS.status,
    from: /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : DEFAULTS.from,
    page: Number.isInteger(page) && page >= 1 ? page : DEFAULTS.page,
  }
}

// 條件 → 網址參數：和預設值相同的不寫，網址保持乾淨
function toQuery(filters) {
  const q = {}
  for (const [k, v] of Object.entries(filters)) if (v !== DEFAULTS[k] && v !== null) q[k] = String(v)
  return q
}

const cases = [
  {},
  { status: 'booked', page: '3' },
  { status: 'unknown', page: 'abc' },
  { page: '-1', from: '2026-11-01' },
  { status: ['booked', 'cancelled'], page: '2.5' },
  { from: '11/01' },
]
for (const q of cases) {
  const f = parseQuery(q)
  const url = new URLSearchParams(toQuery(f)).toString() || '（沒有參數）'
  console.log(JSON.stringify(q).padEnd(42), '→', JSON.stringify(f), '→', url)
}
```

`toQuery` 把預設值省略，所以「全部、第 1 頁」的網址就是 `/appointments`，和第一次進來的網址相同。`parseQuery(toQuery(f))` 要等於 `f`，這是可以寫成單元測試的性質。

:::stop 讀到這裡可以先停：會決定哪些條件放網址、選 `push` 或 `replace`，並把網址解析成條件。後面的「載入更多」列表、`<KeepAlive>` 與 offset 頁碼，在動手做清單頁時再回來讀。

### 列表元件：cursor 分頁加「載入更多」

```vue
<script setup>
import { ref, computed, watch, onWatcherCleanup } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { parseQuery, toQuery } from '@/lib/appointmentQuery'

const route = useRoute()
const router = useRouter()
const filters = computed(() => parseQuery(route.query))   // 網址是唯一的來源

const items = ref([])
const nextCursor = ref(null)
const status = ref('idle')          // idle | loading | success | empty | error
const loadingMore = ref(false)
const loadMoreFailed = ref(false)

async function fetchBatch(cursor, signal) {
  const params = new URLSearchParams({ limit: '20' })
  if (filters.value.status !== 'all') params.set('status', filters.value.status)
  if (filters.value.from) params.set('from', filters.value.from)
  if (cursor) params.set('cursor', cursor)
  const res = await fetch(`/api/appointments?${params}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()                 // { items, next_cursor }
}

// 只在列表頁時才有 key；離開列表頁（KeepAlive 保留著元件）時是 null
const queryKey = computed(() => (route.name === 'appointments' ? JSON.stringify(filters.value) : null))
let loadedKey = null

watch(queryKey, async (key) => {
  if (key === null || key === loadedKey) return   // 去了別頁，或回來時條件沒變：保留已載入的資料
  loadedKey = key
  const controller = new AbortController()
  onWatcherCleanup(() => controller.abort())      // 條件又變了：取消這一輪
  items.value = []                                // 換條件：清空、從第一批開始
  nextCursor.value = null
  status.value = 'loading'
  try {
    const page = await fetchBatch(null, controller.signal)
    items.value = page.items
    nextCursor.value = page.next_cursor
    status.value = page.items.length ? 'success' : 'empty'
  } catch (err) {
    if (loadedKey === key) loadedKey = null       // 沒抓成功（失敗或中途離開）：同樣的條件下次要重抓
    if (controller.signal.aborted) return
    status.value = 'error'
  }
}, { immediate: true })

async function loadMore() {
  const key = loadedKey                           // 記下這一批屬於哪一組條件
  loadingMore.value = true
  loadMoreFailed.value = false
  try {
    const page = await fetchBatch(nextCursor.value)
    if (key !== loadedKey) return                 // 等待期間換了條件：這一批是舊條件的，丟掉
    items.value.push(...page.items)
    nextCursor.value = page.next_cursor
  } catch {
    loadMoreFailed.value = true                   // 顯示「載入失敗，再試一次」，已載入的保留
  } finally {
    loadingMore.value = false
  }
}

function setFilter(patch) {
  router.push({ query: toQuery({ ...filters.value, ...patch }) })   // 只改網址，畫面跟著 watch 走
}
</script>

<template>
  <select :value="filters.status" @change="setFilter({ status: $event.target.value })" aria-label="狀態">
    <option value="all">全部</option>
    <option value="booked">已掛號</option>
    <option value="checked_in">已報到</option>
    <option value="cancelled">已取消</option>
  </select>
  <!-- loading、empty、error 的畫面見「API 的四種狀態」 -->
  <ul v-if="status === 'success'">
    <li v-for="a in items" :key="a.id">
      <RouterLink :to="`/appointments/${a.id}`">{{ a.number }} 號，{{ a.status }}</RouterLink>
    </li>
  </ul>
  <p v-if="loadMoreFailed" role="alert">載入失敗，再按一次「載入更多」</p>
  <button v-if="nextCursor" type="button" :disabled="loadingMore" @click="loadMore">載入更多</button>
</template>
```

幾個重點：

- `queryKey` 用字串比對，`route.query` 換了物件但值相同時（例如 push 了同樣的條件）不會重抓。
- 「載入更多」等待回應時使用者換了條件，回來的那一批屬於舊條件；比對 `loadedKey` 丟掉它，和 [取消請求與競態](#/skill/cancel-race) 的序號是同一個做法。
- 列表頁被 `<KeepAlive>` 保留時，元件在使用者看詳細頁的期間仍然活著，`route` 已經換成詳細頁的。`route.name` 的判斷與 `loadedKey` 讓它回來時不重抓、保留已經載入的三批。
- 這個元件沒有自己的 `status` 篩選 ref；`<select>` 的值來自 `filters`，改變時呼叫 `setFilter` 改網址。
- cursor 沒有放進網址。重新整理後回到第一批是 cursor 分頁的取捨；要「重新整理後還在第 47 筆」就需要 offset 分頁，或伺服器提供「從某筆開始」的查詢。

`App.vue` 用 `<KeepAlive>` 只保留列表頁（`<script setup>` 的元件名稱由檔名推得，`AppointmentListPage.vue` 就是 `AppointmentListPage`）：

```vue
<template>
  <RouterView v-slot="{ Component }">
    <KeepAlive include="AppointmentListPage">
      <component :is="Component" />
    </KeepAlive>
  </RouterView>
</template>
```

`router.js` 回傳離開時的位置：

```js
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(to, from, savedPosition) {
    return savedPosition ?? { top: 0 }   // 上一頁、下一頁回到離開時的位置；其他導航捲到頂端
  },
})
```

### offset 分頁：頁碼放網址

後端是 offset 分頁時，頁碼放進網址，Pagination 元件的每個頁碼都是一次 `router.push`：

```js
function goPage(n) {
  router.push({ query: toQuery({ ...filters.value, page: n }) })
}
function setFilter(patch) {
  router.push({ query: toQuery({ ...filters.value, ...patch, page: 1 }) })   // 換條件回到第 1 頁
}
// 請求：offset = (page - 1) * size
```

伺服器回總筆數時，最後一頁之後的頁碼要停用；使用者手改成 `?page=999` 時，API 回空陣列，畫面顯示「沒有這一頁」與「回到第 1 頁」，不要顯示成「沒有任何掛號」。

## 常見錯誤

| 現象 | 原因 | 修法 |
|---|---|---|
| 重新整理或分享連結後，篩選回到預設 | 條件只存在元件的 ref | 條件放網址，元件從 `route.query` 讀 |
| 按上一頁網址變了，清單沒變 | 只在 `onMounted` 讀一次網址 | `watch` 網址解析出來的條件 |
| 換篩選後顯示「沒有資料」 | 沿用舊的頁碼或 cursor | 換條件時 `page` 回到 1、清空 cursor 與已載入的資料 |
| 請求帶 `page=NaN`、`status=undefined` | 沒解析就用 `route.query` | 用 `parseQuery` 轉型、檢查、給預設值 |
| 打完關鍵字要按好幾次上一頁才離開 | 每次輸入都 `router.push` | debounce 後用 `router.replace` |
| 同一筆在第 1 頁與第 2 頁都出現 | offset 分頁，翻頁之間有新資料 | 改用 cursor，或至少依 `id` 去除重複 |
| 「載入更多」之後清單重複一批 | 改篩選時沒清空 `items`，或連按兩次「載入更多」 | 換條件時清空；載入中停用按鈕 |
| 上一頁回到頂端 | 清單重新抓資料，還原捲動時頁面還不夠高 | `<KeepAlive>` 保留列表，或 `scrollBehavior` 等資料畫好 |
| 從詳細頁回來，清單整個重抓 | KeepAlive 下 `watch(route.query)` 在離開時也觸發 | 只在列表路由時比對條件，條件沒變就不抓 |

## 動手

1. 按上面解析函式的「在 Playground 開啟」，加一個 `sort` 參數（允許 `time`、`-time`，預設 `time`），補上 `cases` 驗證不合法的值會落回預設。
2. 在自己的專案挑一個列表，把篩選與頁碼搬進網址，然後照地圖的檢查逐條驗：F5、上一頁與下一頁、手改網址、分享連結。
3. 打字中的搜尋要再加上取消與 debounce，見 [取消請求與競態](#/skill/cancel-race)；清單的 loading、empty、error 畫面見 [API 的四種狀態](#/skill/api-states)。

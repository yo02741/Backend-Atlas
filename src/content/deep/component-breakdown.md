## 從一個具體問題開始：一個 640 行的 TodayClinic.vue

「今日門診」頁交給 AI 一次做完，產出是一個 640 行的 `TodayClinic.vue`：呼叫三支 API、14 個 ref、3 個 watch、表格的每一列直接寫在模板裡。畫面能動，接著要改需求時問題一個個出現：

- 日期同時存在三個地方：元件的 `selectedDate` ref、Pinia 的 `ui.date`、網址的 `?date=`。日期列改了 store，表格讀的是 ref，兩邊差一天。
- 要在「預約查詢」頁重用那張表格，只能整段複製，因為表格的模板裡直接呼叫了 `fetch`。
- 想替「報到」按鈕寫元件測試，得先 mock 三支 API、路由與 store。
- 一個 watch 把 `appointments` 篩選後抄到 `filtered`，另一個 watch 再算 `checkedInCount`；改了報到狀態，數字要等下一次 watch 才更新。

先決定元件怎麼拆、每個元件收什麼、送什麼、狀態放在哪裡，再請 AI 寫程式。拆分是設計，寫程式是實作，兩件事分開做，各自都容易驗收。

## 運作原理

### 由外到內拆

1. **區域**：照 [把畫面描述成文字](#/skill/describe-ui) 的版面段落，一個區域通常是一個元件：日期列、診間 Tabs、預約表格。
2. **重複的東西**：表格的每一列、卡片清單的每一張卡，各是一個元件。
3. **有自己行為的小東西**：狀態 Badge、可以展開的備註，有自己的狀態或互動時才拆；只是一段 HTML 就留在父元件。
4. **頁面元件在最外層**：它對應一個路由，負責把資料拿進來、分給下面的元件。

拆完得到一棵元件樹：

```text
TodayClinicPage                 頁面元件：讀網址、抓資料、處理錯誤
├── DateBar                     v-model:date
├── ClinicTabs                  props: clinics；v-model: 目前的診間
└── AppointmentTable            props: items, status；emits: check-in
    └── AppointmentRow ×N       props: appointment；emits: check-in
        └── StatusBadge         props: status
```

### 每個元件的介面：props 與 emits

元件之間只透過 props 與 emits 溝通：資料往下、事件往上。把每個元件的輸入與輸出寫成一張表，就是元件的規格：

| 元件 | props（輸入） | emits（輸出） | 自己持有的狀態 |
|---|---|---|---|
| `DateBar` | `date`（`'YYYY-MM-DD'`，必填） | `update:date` | 無 |
| `ClinicTabs` | `clinics`（`{ id, name }[]`）、`modelValue`（診間 id） | `update:modelValue` | 無 |
| `AppointmentTable` | `items`（預約陣列）、`status`（`loading`／`success`／`empty`／`error`） | `check-in`（預約 id）、`retry` | 無 |
| `AppointmentRow` | `appointment` | `check-in`（預約 id） | 報到中（按鈕停用） |
| `StatusBadge` | `status` | 無 | 無 |

沒有這張表時，AI 會自己決定介面：有時把 store 直接 import 進 `AppointmentRow`，有時讓子元件自己抓資料，有時多出一個表上沒有的 prop。有了表，驗收時一個一個對 `defineProps` 與 `defineEmits` 就好。

`v-model` 是一個 prop 加一個 `update:` 事件的簡寫。Vue 3.4 起穩定的 `defineModel()` 讓子元件少寫這兩段：`const date = defineModel('date')` 就宣告了 `date` prop 與 `update:date` 事件，父元件用 `v-model:date` 接。它沒有改變資料流的方向：值仍然由父元件持有。

### 狀態放哪一層

| 問題 | 放這裡 | 例子 |
|---|---|---|
| 重新整理後要還在、要能分享連結 | 網址的 query 或路徑 | 日期、診間、篩選條件 |
| 跨好幾個頁面共用 | Pinia store | 登入者、權限、全站設定 |
| 一個頁面裡好幾個元件要用 | 這些元件最近的共同父元件（通常是頁面元件） | 預約清單、載入狀態 |
| 只有一個元件用 | 那個元件自己 | 展開了哪一列、報到中的按鈕、輸入框打到一半的字 |
| 能從其他狀態算出來 | 不存，用 `computed` | 篩選後的清單、已報到人數 |

由上往下問，第一個答「是」的那一列決定放哪裡。最常見的錯是放太高：什麼都放進 Pinia，每個元件都能改，出了錯不知道是誰改的。其次是同一份資料放兩個地方，例如開頭的日期。網址的讀寫方式見 [分頁、篩選與網址](#/skill/pagination-filter)，Pinia 的用法見 [Pinia：全域狀態](#/skill/pinia)。

### 頁面元件與展示元件

| | 頁面元件（`TodayClinicPage`） | 展示元件（`AppointmentTable` 等） |
|---|---|---|
| 對應 | 一個路由 | 畫面上的一塊 |
| 讀網址、呼叫 API、讀 store | 會 | 不會 |
| 處理錯誤與重試 | 會 | 只把「使用者按了重試」emit 出去 |
| 測試 | 要 mock API 與路由 | 給 props、檢查畫面與 emit，不用 mock |
| 重用 | 通常不重用 | 可以放進別的頁面 |

展示元件只看 props，所以能單獨測試，也能在 Storybook 這類工具裡把 loading、empty、error 各畫一次給人看。所有的「資料從哪來」集中在頁面元件，要換 API 或加快取時只改一個地方。

### 能算出來的不要存

```js
// 多一份狀態：appointments 改了，要等 watch 執行完 filtered 才跟上，第一次還可能漏掉
const filtered = ref([])
watch(appointments, (list) => { filtered.value = list.filter((a) => a.status !== 'cancelled') })

// 衍生資料：永遠和 appointments 一致
const visible = computed(() => appointments.value.filter((a) => a.status !== 'cancelled'))
const checkedInCount = computed(() => visible.value.filter((a) => a.status === 'checked_in').length)
```

「A 變了就更新 B」是 computed 的工作；watch 留給副作用，例如呼叫 API、寫入 localStorage。這也是 [AI 寫前端的常見錯誤](#/skill/ai-common-mistakes) 裡的一項。

### 該再拆的訊號

- 模板裡有好幾段互不相關的區塊，各自有自己的 `v-if` 與事件。
- `<script setup>` 裡的 ref 分成幾群，每群只被模板的某一段用到。
- 同一段模板複製了兩次以上。
- props 多到一眼看不完，或很多 prop 只是往下傳給孫元件（這時考慮 slot 或 `provide`）。

這些是經驗上的訊號，不是行數規則。反過來也有拆過頭的情況：一個只被用一次、沒有狀態也沒有行為的三行元件，拆出去只是多一個檔案要跳。

## 實際程式

### 先要元件樹與介面表

給 AI 的第一步只要規格，先不要程式：

```text
「今日門診」頁先不要寫程式。請輸出：
1. 元件樹（名稱與層級）。
2. 每個元件的 props（名稱、型別、必填）、emits（事件名稱與 payload）、自己持有的狀態。
3. 每份狀態放在哪裡：網址、Pinia、頁面元件或子元件，附一句理由。
限制：只有頁面元件可以呼叫 API、讀寫網址；登入者資訊從 Pinia 的 auth store 讀；子元件不 import fetch、router 或 store。
```

確認或修改這份輸出之後，再請它照這份規格實作，並且一個元件一個元件交付。

### 頁面元件

```vue
<!-- TodayClinicPage.vue -->
<script setup>
import { ref, computed, watch, onWatcherCleanup } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DateBar from './DateBar.vue'
import ClinicTabs from './ClinicTabs.vue'
import AppointmentTable from './AppointmentTable.vue'

const route = useRoute()
const router = useRouter()
const today = new Date().toISOString().slice(0, 10)    // 示意；實際要用院所的時區

// 網址是日期與診間的唯一來源；子元件透過 v-model 改，這裡寫回網址
const date = computed({
  get: () => route.query.date ?? today,
  set: (v) => router.push({ query: { ...route.query, date: v } }),
})
const clinic = computed({
  get: () => route.query.clinic ?? '101',
  set: (v) => router.push({ query: { ...route.query, clinic: v } }),
})

const clinics = ref([])            // 實際從 GET /api/clinics 取得，這裡省略
const items = ref([])
const status = ref('loading')
const reloadKey = ref(0)           // 按「重試」時加一，讓下面的 watch 再跑一次

async function load(signal) {
  status.value = 'loading'
  try {
    const res = await fetch(`/api/appointments?date=${date.value}&clinic=${clinic.value}`, { signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    items.value = await res.json()
    status.value = items.value.length ? 'success' : 'empty'
  } catch (err) {
    if (!signal.aborted) status.value = 'error'
  }
}

watch([date, clinic, reloadKey], () => {
  const controller = new AbortController()
  onWatcherCleanup(() => controller.abort())
  load(controller.signal)
}, { immediate: true })

async function checkIn(id) {
  const res = await fetch(`/api/appointments/${id}/check-in`, { method: 'POST' })
  if (res.ok) {
    const updated = await res.json()
    items.value = items.value.map((a) => (a.id === id ? updated : a))   // 只換掉這一筆
  }
}
</script>

<template>
  <DateBar v-model:date="date" />
  <ClinicTabs v-model="clinic" :clinics="clinics" />
  <AppointmentTable :items="items" :status="status" @check-in="checkIn" @retry="reloadKey++" />
</template>
```

### 展示元件

```vue
<!-- DateBar.vue：用 defineModel 宣告 v-model:date -->
<script setup>
const date = defineModel('date', { type: String, required: true })

function shift(days) {
  const d = new Date(date.value)
  d.setDate(d.getDate() + days)
  date.value = d.toISOString().slice(0, 10)   // 等於 emit('update:date', …)，值由父元件持有
}
</script>

<template>
  <div class="date-bar">
    <button type="button" @click="shift(-1)">前一天</button>
    <strong>{{ date }}</strong>
    <button type="button" @click="shift(1)">後一天</button>
  </div>
</template>
```

```vue
<!-- AppointmentTable.vue：只看 props，只往上 emit -->
<script setup>
import AppointmentRow from './AppointmentRow.vue'

defineProps({
  items: { type: Array, required: true },
  status: { type: String, required: true },   // loading | success | empty | error
})
const emit = defineEmits(['check-in', 'retry'])
</script>

<template>
  <div v-if="status === 'loading'" aria-busy="true">
    <div v-for="n in 5" :key="n" class="skeleton-row"></div>
  </div>
  <div v-else-if="status === 'error'" role="alert">
    <p>無法載入預約</p>
    <button type="button" @click="emit('retry')">重試</button>
  </div>
  <p v-else-if="status === 'empty'">這個診間今天沒有預約</p>
  <table v-else>
    <thead><tr><th>時間</th><th>病患</th><th>狀態</th><th>操作</th></tr></thead>
    <tbody>
      <AppointmentRow v-for="a in items" :key="a.id" :appointment="a" @check-in="emit('check-in', $event)" />
    </tbody>
  </table>
</template>
```

`AppointmentTable` 沒有 import 任何 API、router 或 store。它的元件測試只要給 `items` 與 `status`，檢查畫面與 `check-in` 事件的 payload。

:::stop 讀到這裡可以先停：會由外到內拆出元件樹、寫出介面表，分清頁面元件與展示元件。後面的常見錯誤，在拆完的元件又開始變大或互相牽動時再回來對照。

## 常見錯誤

| 現象 | 原因 | 修法 |
|---|---|---|
| 一個頁面一個幾百行的元件 | 直接要整頁的程式 | 先要元件樹與介面表，確認後再實作 |
| 同一份資料兩處不同步（日期差一天） | 同一個狀態放在 ref、store、網址三處 | 選一個來源，其他地方從它讀 |
| 子元件裡出現 `fetch`、`useRouter`、store | 展示元件自己抓資料 | 資料由頁面元件給，子元件只 emit |
| `[Vue warn] Set operation on key "date" failed: target is readonly.` | 子元件直接改了 props | 用 `defineModel` 或 emit 讓父元件改 |
| 子元件 `props.items.push(…)`，Console 沒有警告但父元件的資料被改了 | 改 props 內部的陣列或物件，Vue 不會警告 | 開 `vue/no-mutating-props`；改成 emit |
| 數字晚一拍才更新 | 用 watch 抄一份衍生資料 | 改成 computed |
| props 一路往下傳了四層 | 中間的元件只是轉手 | 用 slot 讓父元件直接放內容，或 `provide`／`inject` |
| 什麼都放 Pinia | 沒有判斷狀態的範圍 | 照上面的表，由網址往下問 |

## 動手

1. 挑一個自己做過的頁面，畫出元件樹與 props／emits 表，標出每份狀態放在哪裡；找出同一份資料放了兩處的地方。
2. 用上面「先要元件樹與介面表」的描述交給 AI，對照它的輸出與這一課的表，修改不合理的地方後再請它實作。
3. 在 Vue DevTools 的 Components 分頁打開產出，確認元件樹的層級與名稱；在展示元件的檔案裡搜尋 `fetch(`、`useRouter`，應該找不到。
4. 驗收整個頁面的流程，見 [驗收 AI 產出的前端](#/skill/ai-acceptance)。

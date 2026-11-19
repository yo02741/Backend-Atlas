## 從一個具體問題開始：600 行的 App.vue

門診預約頁一開始只有一個 `App.vue`：抓今天的預約、日期篩選、表格、每列的「取消」按鈕、確認對話框、成功後的 Toast，全部寫在同一個檔裡。三個月後這個檔有 600 行，出現了幾個狀況：

- 改「取消」按鈕的樣式，報到頁的按鈕也跟著變，因為兩邊都用了 `.btn` 而且樣式是全域的。
- 抓預約的 `fetch` 被複製到三個地方（初次載入、改日期、取消後重新整理），其中一處少了錯誤處理。
- 請 AI 修「取消後清單沒更新」，它改了其中一處的 `fetch`，另外兩處照舊。

把畫面拆成元件之後，每個檔只管一件事：一個元件抓資料並持有清單，一個元件排版，一個元件顯示一筆並在按下按鈕時通知上層。描述需求、讀產出、找 bug 時都能指著某個檔說「問題在這裡」。

## 運作原理：元件樹、props 與事件

### 元件樹

```
AppointmentPage            持有 appointments、date；呼叫 API
├─ DateFilter              props: date　　　emit: update:date
├─ AppointmentList         props: items　　 emit: cancel
│  └─ AppointmentRow × N   props: item　　　emit: cancel
└─ ToastHost               props: messages
```

資料只有一個擁有者：`appointments` 放在 `AppointmentPage`，往下用 props 傳；子元件要改資料時發出事件，由擁有者決定怎麼改（例如呼叫 `POST /api/appointments/{id}/cancel` 後重新抓）。這叫單向資料流。子元件直接改 props，父元件不知道資料被改了，畫面與伺服器的資料就分岔。

| 層 | 負責 | 不做 |
|---|---|---|
| 頁面元件（`AppointmentPage`） | 呼叫 API、持有狀態、處理事件 | 排版細節 |
| 清單元件（`AppointmentList`） | 排版、空狀態、把事件往上傳 | 呼叫 API |
| 列元件（`AppointmentRow`） | 顯示一筆、按鈕的狀態、發出事件 | 呼叫 API、改 props |

這是常見的分法，不是規定。判斷的方式：同一份資料只在一個地方被抓、被改。

### 一個 .vue 檔的三段

單檔元件（Single-File Component，SFC）把一個元件的模板、邏輯、樣式放在同一個 `.vue` 檔：

- `<template>`：畫面的結構，用 Vue 的模板語法（`{{ }}`、`v-if`、`v-for`、`@click`）。
- `<script setup>`：Composition API 的簡寫。頂層宣告的變數、函式、import 進來的元件，模板裡直接能用，不必 `return`，也不必在 `components` 裡註冊。
- `<style scoped>`：只套到這個元件的樣式。

一個 `.vue` 檔最多一個 `<template>`、一個 `<script setup>`（可以再加一個普通的 `<script>`），`<style>` 可以有好幾個。瀏覽器看不懂 `.vue`，由 Vite 的 `@vitejs/plugin-vue` 在開發與建置時呼叫 `@vue/compiler-sfc` 編譯：模板變成 render 函式，`<script setup>` 變成元件的 `setup()`，樣式抽出成 CSS。

`defineProps`、`defineEmits`、`defineModel` 是編譯器巨集：只在 `<script setup>` 的頂層有意義，編譯時被換成元件選項，不用 import。寫了 `import { defineProps } from 'vue'`，編譯器會提示「defineProps is a compiler macro and no longer needs to be imported.」（訊息裡的 defineProps 前後有反引號）。

### scoped 樣式怎麼做到「只套到自己」

編譯器替這個元件產生一個 id（例如 `7ba5bd90`），做兩件事：

1. 模板裡每個元素加上屬性 `data-v-7ba5bd90`。
2. 樣式的選擇器加上同一個屬性：`.row { … }` 變成 `.row[data-v-7ba5bd90] { … }`。

別的元件的 `.row` 沒有這個屬性，選不到。有兩個邊界要知道：

- 子元件的根元素同時帶父元件與子元件的 id，所以父元件的 scoped 樣式選得到子元件的根元素，選不到子元件內部。
- 要改子元件內部（例如元件庫的某個元素），用 `:deep(.badge)`，編譯成 `[data-v-7ba5bd90] .badge`。舊的 `>>>`、`/deep/`、`::v-deep` 寫法在 Vue 3 已棄用，編譯器會警告。

scoped 管的是「這段 CSS 選得到誰」，CSS 的權重與繼承規則照舊：字型、顏色這類會繼承的屬性，照樣從父元素傳到子元件裡。

### 屬性透傳

父元件寫 `<AppointmentRow class="highlight" :item="a" />`，`item` 是宣告過的 prop，`class` 不是。沒宣告的屬性（`class`、`style`、`id`、沒宣告的事件監聽）會自動加到子元件的根元素上。子元件的模板有好幾個根元素時，Vue 不知道要加在哪個上面，會發出警告，這時要自己在某個元素上寫 `v-bind="$attrs"`。

## 實際程式：拆成三個元件

型別定義放在一處，三個元件共用：

```ts
// src/types.ts
export type AppointmentStatus = 'booked' | 'checked_in' | 'cancelled'
export interface Appointment {
  id: number
  time: string          // '09:30'
  patientName: string   // 已遮罩，例如 '王○明'
  status: AppointmentStatus
}
```

列元件只顯示一筆、在按下按鈕時發出事件：

```vue
<!-- src/components/AppointmentRow.vue -->
<script setup lang="ts">
import type { Appointment } from '../types'

// 編譯器巨集：不用 import
const props = defineProps<{ item: Appointment; busy?: boolean }>()
const emit = defineEmits<{ cancel: [id: number] }>()
</script>

<template>
  <li class="row">
    <span class="time">{{ props.item.time }}</span>
    <span>{{ props.item.patientName }}</span>
    <span class="badge" :class="props.item.status">{{ props.item.status }}</span>
    <button
      type="button"
      :disabled="props.busy || props.item.status !== 'booked'"
      @click="emit('cancel', props.item.id)"
    >取消</button>
  </li>
</template>

<style scoped>
.row { display: grid; grid-template-columns: 4rem 1fr auto auto; gap: 0.75rem; align-items: center; }
.time { font-variant-numeric: tabular-nums; }
</style>
```

清單元件負責排版與空狀態，把事件往上傳：

```vue
<!-- src/components/AppointmentList.vue -->
<script setup lang="ts">
import type { Appointment } from '../types'
import AppointmentRow from './AppointmentRow.vue'   // import 之後模板就能用

defineProps<{ items: Appointment[]; busyId: number | null }>()
const emit = defineEmits<{ cancel: [id: number] }>()
</script>

<template>
  <p v-if="items.length === 0" class="empty">這天沒有預約</p>
  <ul v-else class="list">
    <AppointmentRow
      v-for="a in items"
      :key="a.id"
      :item="a"
      :busy="busyId === a.id"
      @cancel="(id) => emit('cancel', id)"
    />
  </ul>
</template>
```

頁面元件持有資料、呼叫 API：

```vue
<!-- src/pages/AppointmentPage.vue -->
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { Appointment } from '../types'
import AppointmentList from '../components/AppointmentList.vue'

const date = ref('2026-11-20')
const appointments = ref<Appointment[]>([])
const busyId = ref<number | null>(null)

async function load() {
  const res = await fetch(`/api/appointments?date=${date.value}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)   // 錯誤畫面見 API 的四種狀態一課
  appointments.value = await res.json()
}

async function cancel(id: number) {
  busyId.value = id
  try {
    const res = await fetch(`/api/appointments/${id}/cancel`, { method: 'POST' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await load()   // 資料的擁有者負責更新
  } finally {
    busyId.value = null
  }
}

onMounted(load)
</script>

<template>
  <h1>{{ date }} 的預約</h1>
  <AppointmentList :items="appointments" :busy-id="busyId" @cancel="cancel" />
</template>
```

`AppointmentList` 的根層是 `v-if`／`v-else`，一次只渲染其中一個元素，算單一根元素，父元件傳的 `class` 會套到出現的那個元素上；如果在 `<ul>` 前面再加一個 `<h2>`，就變成兩個根元素，要自己寫 `v-bind="$attrs"`。prop 在 script 裡叫 `busyId`，在模板屬性裡寫 `busy-id` 或 `busyId` 都可以。錯誤與載入中的畫面在 [API 的四種狀態](#/skill/api-states) 補上。

## React 對照

| Vue 3.5 | React 19 |
|---|---|
| `.vue` 單檔元件：template、script、style 三段 | 函式元件回傳 JSX，樣式另外處理 |
| `defineProps<{ item: Appointment }>()` | 函式參數 `function Row({ item })` |
| `emit('cancel', id)` | 父元件傳下來的 callback：`onCancel(id)` |
| `<style scoped>` | CSS Modules（`styles.row`）或 CSS-in-JS |
| 沒宣告的屬性自動加到根元素（屬性透傳） | 沒有自動透傳，要自己 `{...rest}` |
| import 元件後模板直接用 | import 元件後 JSX 直接用 |

同一個列元件用 React 寫：

```jsx
// AppointmentRow.jsx（React 19）
import styles from './AppointmentRow.module.css'

export function AppointmentRow({ item, busy, onCancel }) {
  return (
    <li className={styles.row}>
      <span className={styles.time}>{item.time}</span>
      <span>{item.patientName}</span>
      <span className={`badge ${item.status}`}>{item.status}</span>
      <button type="button" disabled={busy || item.status !== 'booked'} onClick={() => onCancel(item.id)}>
        取消
      </button>
    </li>
  )
}
```

React 的事件是 props 裡的函式；Vue 的事件是另一個管道，要用 `defineEmits` 宣告，父元件用 `@cancel` 監聽。

## 常見錯誤與錯誤訊息

| Console 或終端機的訊息 | 原因 | 修法 |
|---|---|---|
| `[Vue warn]: Failed to resolve component: AppointmentRow` | 模板用了元件，但 `<script setup>` 沒有 import（或拼錯） | 補 `import AppointmentRow from './AppointmentRow.vue'` |
| `[Vue warn]: Missing required prop: "item"` | 必填的 prop 沒傳 | 檢查父元件的屬性名稱與大小寫 |
| `[Vue warn]: Invalid prop: type check failed for prop "item". Expected Object, got String with value "a".` | 寫成 `item="a"`，少了冒號，傳進去的是字串 `"a"` | 改成 `:item="a"` |
| `[Vue warn]: Extraneous non-props attributes (class) were passed to component but could not be automatically inherited because component renders fragment or text or teleport root nodes.` | 子元件有多個根元素 | 在要接收的元素上寫 `v-bind="$attrs"` |
| `[Vue warn]: Component emitted event "cancel" but it is neither declared in the emits option nor as an "onCancel" prop.` | 發出事件但沒有宣告 | 補 `defineEmits` |
| 編譯器提示「defineProps is a compiler macro and no longer needs to be imported.」 | import 了編譯器巨集 | 刪掉 import |
| `<script setup> cannot contain ES module exports.` | 在 `<script setup>` 裡寫了 `export` | 要匯出的型別或常數搬到另一個檔，或放進普通的 `<script>` |

沒有訊息、但畫面不對的情況：

- **樣式漏到別的元件**：少寫了 `scoped`。Elements 分頁選取元素，Styles 窗格裡的選擇器沒有 `[data-v-…]`。
- **改不到子元件內部**：父元件的 scoped 樣式選不到子元件的內部元素。用 `:deep()`，或讓子元件提供 prop、CSS 變數。
- **改了 props**：子元件 `props.item.status = 'cancelled'` 改的是物件內部，Vue 不會警告，但父元件的資料已經變了，伺服器卻沒有。lint 規則 `vue/no-mutating-props` 會抓到。

## 動手

1. 用 `npm create vue@latest` 建一個專案，照上面的三個檔案拆出元件，在 Vue DevTools 的元件樹確認層級與每個元件的 props。
2. 在 `AppointmentList` 把 `:item="a"` 改成 `item="a"`，看 Console 的型別警告；改回來後，把 `AppointmentRow` 的 `defineEmits` 刪掉，看事件警告。
3. 把 `AppointmentRow` 的 `<style scoped>` 改成 `<style>`，在頁面別處放一個 `class="row"` 的元素，看樣式漏過去；再加回 `scoped`，在 Elements 分頁比對選擇器。
4. 接著讀 [響應式](#/skill/reactivity) 與 [模板語法](#/skill/template-syntax)，再回來把清單的空狀態與錯誤畫面補齊。

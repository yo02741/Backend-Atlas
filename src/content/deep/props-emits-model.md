## 從一個具體問題開始：點了日期，清單沒有重抓

掛號頁 `AppointmentPage` 持有 `selectedDate`，往下傳給日期選擇元件 `DatePicker`，自己用 `watch(selectedDate, …)` 抓當天的預約。請 AI 寫 `DatePicker`，前後拿到三個版本：

1. 點日期時寫 `props.date = day`。Console 出現 `[Vue warn] Set operation on key "date" failed: target is readonly.`，畫面上的日期沒變。
2. 改成 `const date = ref(props.date)`，點日期時改這個本地 ref。選擇器上的日期變了，可是清單還是舊的那天：父元件的 `selectedDate` 沒變，`watch` 沒有觸發。之後父元件按「回到今天」改了 `selectedDate`，選擇器也不會跟著變，因為本地 ref 只在建立時讀過一次 props。
3. 父元件改傳物件 `:filters="filters"`，子元件寫 `props.filters.date = day`。沒有任何警告，清單也重抓了。但父元件沒有機會在改之前檢查（例如休診日不能選），同一個 `filters` 物件也傳給了另外兩個元件，它們的畫面跟著變，查 bug 時找不到是誰改的。

三個版本錯在同一件事：子元件想改不屬於它的資料。正確的做法是子元件發事件，由持有資料的父元件改。

## 運作原理：資料往下、事件往上

### 單向資料流

```
AppointmentPage    selectedDate = '2026-11-20'（擁有者）
   │ :date="selectedDate"              ▲ @update:date="(v) => (selectedDate = v)"
   ▼                                   │
DatePicker         props.date（唯讀）   emit('update:date', '2026-11-21')
```

一份資料只有一個擁有者。擁有者把值用 props 傳下去，子元件要改就發出事件，擁有者收到後決定要不要改、改完要不要打 API。父元件的值一改，Vue 重新渲染父元件，新的 props 傳給子元件，子元件跟著更新。

### props 為什麼改不動

`<script setup>` 裡 `defineProps` 回傳的物件，在開發模式是一個淺層唯讀的 Proxy：

| 寫法 | 結果（Vue 3.5） |
|---|---|
| `props.date = '2026-11-21'` | 開發模式警告 `Set operation on key "date" failed: target is readonly.`，值不變 |
| 解構後指定 `date = …`（`const { date } = defineProps(…)`） | 編譯錯誤 `Cannot assign to destructured props as they are readonly.` |
| 模板裡 `<input v-model="date">`（`date` 是 prop） | 編譯錯誤 `v-model cannot be used on a prop, because local prop bindings are not writable.` |
| `props.item.status = 'cancelled'` | 沒有警告，父元件的物件被改了 |

最後一列最危險。唯讀只管第一層，物件裡面的屬性仍然是父元件那一份 reactive 物件，改了會觸發父元件與所有用到它的元件更新。lint 規則 `vue/no-mutating-props` 預設也會報這一種，訊息是 `Unexpected mutation of "item" prop.`。

### 事件

```ts
const emit = defineEmits<{
  confirm: [date: string]              // 事件名稱：參數的型別
  'update:date': [value: string]
}>()

emit('confirm', '2026-11-21')
```

- 父元件用 `@confirm="onConfirm"` 接。在 script 裡發 camelCase 的事件（`emit('checkIn', id)`），模板裡可以用 `@check-in` 接，Vue 會自動轉換。
- 元件事件不會冒泡，只送到直接的父元件。隔好幾層要溝通，用 [provide／inject](#/skill/slots-provide) 或 [Pinia](#/skill/pinia)。
- 沒宣告就 `emit`，開發模式警告 `Component emitted event "confirm" but it is neither declared in the emits option nor as an "onConfirm" prop.`。宣告過的事件也不會被當成透傳屬性加到根元素上。

### 元件上的 v-model

```vue
<DatePicker v-model:date="selectedDate" />

<!-- Vue 展開成 -->
<DatePicker :date="selectedDate" @update:date="(v) => (selectedDate = v)" />
```

不寫名稱的 `v-model="x"` 用 `modelValue` 這個 prop 與 `update:modelValue` 事件。一個元件可以有好幾個：`v-model:date`、`v-model:dept`。

子元件這一側，Vue 3.4 起用 `defineModel`：

```ts
const date = defineModel<string>('date', { required: true })
```

編譯器把這一行換成三樣東西：prop `date`、prop `dateModifiers`（接 `v-model:date.trim` 這類修飾符）、事件 `update:date`，再回傳一個自訂的 ref。這個 ref 的行為：

| 情況 | 讀 `date.value` | 寫 `date.value = x` |
|---|---|---|
| 父元件寫 `v-model:date` | 父元件傳的值 | 發出 `update:date`，等父元件更新 prop 後 `date.value` 才變成 `x` |
| 父元件只寫 `:date`，沒接事件 | 父元件傳的值 | 改子元件自己的本地值並發出事件，父元件的值不變，兩邊從此不一致 |
| 父元件什麼都沒傳 | 預設值 | 當成子元件自己的狀態 |

第一列的時間差會造成一個不容易看出來的錯：`date.value = d` 之後立刻 `emit('confirm', date.value)`，送出去的是舊日期。要送新值就用參數 `d`。

### props 解構與預設值（Vue 3.5）

```ts
// Vue 3.5 起：解構保持響應式，預設值直接寫在解構裡
const { days, closedDays = [] } = defineProps<{ days: string[]; closedDays?: string[] }>()

// Vue 3.4 以前：用 withDefaults，物件與陣列的預設值要寫成函式
const props = withDefaults(defineProps<{ days: string[]; closedDays?: string[] }>(), {
  closedDays: () => [],
})
```

3.5 的編譯器把同一個 `<script setup>` 裡對 `closedDays` 的讀取改寫成 `props.closedDays`，所以模板與 computed 會跟著更新；陣列預設值也會自動包成工廠函式。要把解構出來的 prop 交給 `watch`，寫成 getter：`watch(() => closedDays, …)`，直接傳 `closedDays` 是編譯錯誤 `"closedDays" is a destructured prop and should not be passed directly to watch(). Pass a getter () => closedDays instead.`。

## 實際程式：日期選擇元件

```vue
<!-- DatePicker.vue -->
<script setup lang="ts">
const date = defineModel<string>('date', { required: true })     // 父元件用 v-model:date 綁
const { days, closedDays = [] } = defineProps<{ days: string[]; closedDays?: string[] }>()
const emit = defineEmits<{ confirm: [date: string] }>()

function pick(d: string) {
  date.value = d              // 發出 update:date，由父元件改 selectedDate
}
function confirm() {
  emit('confirm', date.value) // 這裡讀得到新值：父元件早在上一次點擊後就更新了
}
</script>

<template>
  <div role="group" aria-label="掛號日期">
    <button v-for="d in days" :key="d" type="button"
            :disabled="closedDays.includes(d)" :aria-pressed="d === date" @click="pick(d)">
      {{ d.slice(5) }}
    </button>
    <button type="button" @click="confirm">確定</button>
  </div>
</template>
```

```vue
<!-- AppointmentPage.vue -->
<script setup lang="ts">
import { ref, watch } from 'vue'
import DatePicker from './DatePicker.vue'

const days = ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23']
const closedDays = ['2026-11-22']                 // 休診日（示意）
const selectedDate = ref('2026-11-20')
const appointments = ref([])

// selectedDate 只在這一層改，抓資料也只寫在這裡
watch(selectedDate, async (d) => {
  const res = await fetch(`/api/appointments?date=${d}`)
  appointments.value = res.ok ? await res.json() : []
}, { immediate: true })

function onConfirm(d: string) {
  console.log('確認日期', d)
}
</script>

<template>
  <DatePicker v-model:date="selectedDate" :days="days" :closed-days="closedDays" @confirm="onConfirm" />
  <p>{{ selectedDate }} 共 {{ appointments.length }} 筆預約</p>
</template>
```

需要「先改草稿、按確定才生效」的元件（例如編輯病患資料的 Dialog），子元件複製一份本地狀態來編輯，按儲存時把整份交給父元件：

```ts
// PatientEditDialog.vue（script setup 節錄）
import { ref } from 'vue'

const props = defineProps<{ patient: { name: string; phone: string } }>()
const emit = defineEmits<{ save: [patient: { name: string; phone: string }]; cancel: [] }>()

const draft = ref({ ...props.patient })   // 淺拷貝：取消時父元件的資料完全沒動
function save() { emit('save', { ...draft.value }) }
```

巢狀物件要深拷貝；`structuredClone(props.patient)` 遇到 reactive Proxy 會丟出 `DataCloneError`（`could not be cloned`），先用 `toRaw()` 取出原始物件再複製。

## React 對照

| Vue 3.5 | React 19 |
|---|---|
| `defineProps<{ date: string }>()` | 函式參數 `function DatePicker({ date })` |
| `emit('confirm', d)` | 父元件傳下來的函式：`onConfirm(d)` |
| `v-model:date` 加 `defineModel('date')` | 受控元件：`date` 與 `onDateChange` 兩個 props |
| 指定 `props.date` 會警告、不生效 | 開發模式下 props 物件被凍結，指定會丟出 `TypeError` |
| 解構預設值 `const { closedDays = [] } = defineProps(…)` | 參數預設值 `function DatePicker({ closedDays = [] })` |

```jsx
// DatePicker.jsx（React 19）
export function DatePicker({ date, onDateChange, days, closedDays = [], onConfirm }) {
  return (
    <div role="group" aria-label="掛號日期">
      {days.map((d) => (
        <button key={d} type="button" disabled={closedDays.includes(d)}
                aria-pressed={d === date} onClick={() => onDateChange(d)}>
          {d.slice(5)}
        </button>
      ))}
      <button type="button" onClick={() => onConfirm(date)}>確定</button>
    </div>
  )
}

// 父元件：<DatePicker date={date} onDateChange={setDate} days={days} onConfirm={handleConfirm} />
```

React 沒有雙向綁定的語法，「值加改值的函式」是 React 版的 `v-model`。兩邊都遵守同一條規則：子元件不改收到的資料。

## 常見錯誤與錯誤訊息

| 訊息或現象 | 原因 | 修法 |
|---|---|---|
| `[Vue warn] Set operation on key "date" failed: target is readonly.` | 在 script 裡指定 prop | 改成 `emit('update:date', v)` 或 `defineModel` |
| 編譯錯誤 `v-model cannot be used on a prop, because local prop bindings are not writable.` | 模板裡對 prop 用 `v-model` | 改用 `defineModel`，或綁本地 ref |
| 編譯錯誤 `Cannot assign to destructured props as they are readonly.` | 對 3.5 解構出來的 prop 指定值 | 同上 |
| 沒有訊息，父元件的資料被改了 | 改了物件 prop 的內部屬性 | 複製一份本地狀態，或發事件；開 `vue/no-mutating-props` |
| 子元件的值變了，父元件沒變 | 父元件寫 `:date` 而不是 `v-model:date` | 補上 `v-model`，或接 `@update:date` |
| `confirm` 送出的值慢一步 | 寫入 `defineModel` 的 ref 後立刻讀 `.value` | 用參數裡的新值 |
| `[Vue warn]: Missing required prop: "days"` | 父元件沒傳必填 prop | 補上；跑 `npx vue-tsc --noEmit` 提早抓 |
| `Component emitted event "confirm" but it is neither declared in the emits option nor as an "onConfirm" prop.` | `emit` 前沒有 `defineEmits` | 補宣告 |
| `defineProps is a compiler macro and no longer needs to be imported.` | import 了 `defineProps` | 刪掉 import |

## 動手

1. 在自己的 Vue 專案寫出上面的 `DatePicker`，父元件先寫 `:date="selectedDate"`（沒有 `v-model`），點日期後用 Vue DevTools 比對父子兩邊的值；改成 `v-model:date` 再比一次。
2. 在 `pick` 裡加一行 `console.log(date.value)`，印出來的是點擊前的日期；說明為什麼，再改成印參數 `d`。
3. 把 `props.item.status = 'cancelled'` 加進一個列元件，確認 Console 沒有警告、父元件的資料卻被改了，接著開 `vue/no-mutating-props` 看 lint 的訊息。
4. 元件之間隔了三層以上才需要同一份資料時，接著讀 [slots 與元件組合](#/skill/slots-provide)；表單欄位的 `v-model` 細節在 [表單綁定與驗證](#/skill/forms)。

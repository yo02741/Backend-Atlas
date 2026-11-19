## 從一個具體問題開始：表格元件長出第十五個 prop

門診系統有一個 `AppointmentTable`，一開始只收 `rows`。之後每個頁面都有自己的需求：

- 預約清單要把狀態欄畫成 Badge，加了 `statusAsBadge`。
- 報到頁要在每列最後放「報到」按鈕，加了 `showCheckIn` 與 `checkInLabel`。
- 醫師頁要在姓名旁放大頭貼，加了 `showAvatar`、`avatarSize`。
- 沒有資料時，有的頁面要「這天沒有預約」，有的要「請先選擇科別」，加了 `emptyText`、`emptyAction`。

半年後元件有十五個 prop、二十幾個 `v-if`，改一個頁面的顯示方式，另外三個頁面跟著壞。

同一個專案裡還有另一種痛：院區名稱與時區從 `App.vue` 一路經過 `Layout`、`Page`、`AppointmentTable` 傳到 `TimeCell`，中間三層元件自己用不到，只是轉手。加一個「院區電話」欄位要改五個檔。

前一個問題用 slot 解決：表格只管列與欄，每一格長什麼樣子交給使用它的頁面。後一個問題用 provide／inject：院區設定在最上層提供一次，需要的後代直接拿。

## 運作原理

### slot：子元件留位置，父元件填內容

```vue
<!-- AppCard.vue -->
<template>
  <section class="card">
    <header><slot name="header">未命名</slot></header>   <!-- 具名 slot，括號裡是備用內容 -->
    <slot />                                              <!-- 預設 slot -->
    <footer v-if="$slots.footer"><slot name="footer" /></footer>
  </section>
</template>
```

```vue
<!-- 使用的一方 -->
<AppCard>
  <template #header>內科 101 診</template>
  <p>目前看診：12 號</p>                     <!-- 沒有包 template 的內容進預設 slot -->
  <template #footer><button type="button">叫號</button></template>
</AppCard>
```

編譯後，父元件傳給 `AppCard` 的是一組函式（每個 slot 一個），`AppCard` 渲染到 `<slot>` 的位置時呼叫對應的函式。這帶來三個結果：

- 沒給內容的 slot，顯示 `<slot>` 標籤裡的備用內容（上例的「未命名」）。
- `#footer` 是 `v-slot:footer` 的縮寫，`#default` 是預設 slot。`v-slot` 只能寫在 `<template>` 或元件本身上。
- `$slots.footer`（或 `useSlots().footer`）在父元件沒給時是 `undefined`，可以用來決定要不要畫外框。

### 渲染作用域

slot 內容寫在父元件的模板裡，編譯時屬於父元件，所以只讀得到父元件的變數。在 `AppointmentTable` 的 slot 內容裡直接寫 `{{ row.time }}`，`row` 是表格內部 `v-for` 的變數，父元件沒有它，Console 會出現 `Property "row" was accessed during render but is not defined on instance.`。

### 作用域 slot：子元件把資料交出去

子元件在 `<slot>` 上綁屬性，這些屬性成為 slot 函式的參數：

```vue
<!-- DataTable.vue（模板節錄） -->
<tr v-for="row in rows" :key="row.id">
  <td v-for="col in columns" :key="col.key">
    <slot :name="'cell-' + col.key" :row="row" :value="row[col.key]">{{ row[col.key] }}</slot>
  </td>
</tr>
```

```vue
<!-- 預約清單頁：只覆寫狀態欄，其他欄用備用內容 -->
<DataTable :rows="appointments" :columns="columns">
  <template #cell-status="{ value }"><StatusBadge :status="value" /></template>
</DataTable>
```

分工變成：`DataTable` 決定有哪些列、欄位順序、排序與空狀態；頁面決定某一格怎麼畫。新的頁面需求不用改表格元件。

### 舊語法

Vue 2.6 以前寫 `<span slot="footer">` 與 `slot-scope="{ row }"`。Vue 3 不認得它們，會當成一般的 HTML 屬性：內容跑進預設 slot，頁尾只顯示備用內容，Console 沒有任何警告。AI 產出裡出現這兩個屬性，代表它用了 Vue 2 的寫法。

### provide／inject

```
App.vue            provide(clinicKey, readonly(clinic))
└─ Layout
   └─ AppointmentPage
      └─ DataTable
         └─ TimeCell    inject(clinicKey) → { name: '內科總院', timeZone: 'Asia/Taipei' }
```

- `inject(key)` 往上找最近一個提供這個 key 的祖先，中間的元件不需要知道。
- 整個 App 都要的值可以在 `main.ts` 用 `app.provide(key, value)`。
- 找不到提供者時回傳 `undefined` 並警告 `injection "Symbol(clinic)" not found.`；`inject(key, 預設值)` 給第二個參數就不會警告。
- `provide` 與 `inject` 要在 setup 期間呼叫。放進 click 處理函式或 `setTimeout` 會警告 `inject() can only be used inside setup() or functional components.`。

響應式要靠提供的東西本身：

| 提供什麼 | 後代拿到什麼 |
|---|---|
| `provide(key, clinic)`（`clinic` 是 ref） | 同一個 ref，提供者改值，後代跟著更新 |
| `provide(key, clinic.value)` | 當下的物件；整個換掉 `clinic.value` 後，後代還拿著舊的 |
| `provide(key, count.value)`（數字） | 一個數字，永遠不會更新 |
| `provide(key, readonly(clinic))` | 唯讀的 ref；後代指定值時警告 `Set operation on key "value" failed: target is readonly.` |

Vue 官方文件建議把修改留在提供者：一起 provide 一個 `setClinic()` 之類的函式，後代只能呼叫它。

### 該用哪一種

| 需求 | 用 |
|---|---|
| 父元件給子元件資料 | props |
| 子元件通知父元件 | emit、`v-model` |
| 元件的一塊畫面交給使用的人決定 | slot（要用子元件的資料就用作用域 slot） |
| 很多層後代都要的設定（院區、主題、表單群組） | provide／inject |
| 好幾個頁面共用、換頁後還要在的狀態 | [Pinia](#/skill/pinia) |

## 實際程式：表格元件與院區設定

```ts
// src/keys.ts：injection key 集中在一個檔，用 Symbol 避免撞名
import type { InjectionKey, Ref } from 'vue'

export interface Clinic { name: string; timeZone: string }
export const clinicKey: InjectionKey<Readonly<Ref<Clinic>>> = Symbol('clinic')
```

```vue
<!-- App.vue -->
<script setup lang="ts">
import { ref, readonly, provide } from 'vue'
import { clinicKey, type Clinic } from './keys'

const clinic = ref<Clinic>({ name: '內科總院', timeZone: 'Asia/Taipei' })
provide(clinicKey, readonly(clinic))   // 後代只能讀；要改就在這裡改
</script>
```

```vue
<!-- DataTable.vue -->
<script setup lang="ts" generic="Row extends { id: number }">
defineProps<{ rows: Row[]; columns: { key: keyof Row & string; label: string }[] }>()
</script>

<template>
  <div class="toolbar" v-if="$slots.toolbar"><slot name="toolbar" /></div>
  <table v-if="rows.length">
    <thead><tr><th v-for="col in columns" :key="col.key" scope="col">{{ col.label }}</th></tr></thead>
    <tbody>
      <tr v-for="row in rows" :key="row.id">
        <td v-for="col in columns" :key="col.key">
          <slot :name="'cell-' + col.key" :row="row" :value="row[col.key]">{{ row[col.key] }}</slot>
        </td>
      </tr>
    </tbody>
  </table>
  <slot v-else name="empty"><p>沒有資料</p></slot>
</template>
```

```vue
<!-- TimeCell.vue：隔了好幾層，直接 inject -->
<script setup lang="ts">
import { inject, computed } from 'vue'
import { clinicKey } from './keys'

const { iso } = defineProps<{ iso: string }>()
const clinic = inject(clinicKey)!        // 少了提供者時是 undefined，開發模式會警告
const text = computed(() =>
  new Date(iso).toLocaleTimeString('zh-TW', { timeZone: clinic.value.timeZone, hour: '2-digit', minute: '2-digit' }),
)
</script>

<template><time :datetime="iso">{{ text }}</time></template>
```

使用的頁面：

```vue
<DataTable :rows="appointments" :columns="columns">
  <template #toolbar><DeptFilter v-model="dept" /></template>
  <template #cell-time="{ value }"><TimeCell :iso="value" /></template>
  <template #cell-status="{ value }"><StatusBadge :status="value" /></template>
  <template #empty><p>這天沒有預約。<a href="#/appointments/new">新增預約</a></p></template>
</DataTable>
```

`<script setup generic="…">` 是 Vue 3.3 起的泛型元件寫法，讓 `columns` 的 `key` 只能是 `Row` 的欄位名。用 TypeScript 時可以再加 `defineSlots<{ … }>()` 宣告每個 slot 的參數型別。

## React 對照

| Vue 3.5 | React 19 |
|---|---|
| 預設 slot | `children` |
| 具名 slot `#footer` | 放 JSX 的 prop：`footer={<button>叫號</button>}` |
| 作用域 slot `#cell-status="{ value }"` | 回傳 JSX 的函式 prop（render props）：`renderCell={(row, key) => …}` |
| `$slots.footer` 判斷有沒有給 | 判斷 prop 是不是 `undefined` |
| `provide(key, value)` | `const ClinicContext = createContext(null)`，`<ClinicContext value={clinic}>` |
| `inject(key)` | `useContext(ClinicContext)` |

```jsx
// React 19：Context 直接當 provider 用，不必寫 .Provider
import { createContext, useContext } from 'react'

const ClinicContext = createContext({ name: '', timeZone: 'Asia/Taipei' })

export function App({ clinic, appointments }) {
  return (
    <ClinicContext value={clinic}>
      <DataTable rows={appointments} renderCell={(row, key) => (key === 'time' ? <TimeCell iso={row.time} /> : row[key])} />
    </ClinicContext>
  )
}

function TimeCell({ iso }) {
  const { timeZone } = useContext(ClinicContext)
  return <time dateTime={iso}>{new Date(iso).toLocaleTimeString('zh-TW', { timeZone })}</time>
}
```

React 的 Context 值一變，所有讀它的元件都重新渲染；Vue 的 inject 拿到 ref，只有讀到 `.value` 的地方跟著更新。

## 常見錯誤與錯誤訊息

| 訊息或現象 | 原因 | 修法 |
|---|---|---|
| 給了 `<template #footer>`，畫面上沒有 | 子元件沒有 `<slot name="footer">`，或名字不一致 | 對齊名字；Vue 不會警告多給的 slot |
| 頁尾顯示備用內容，自訂內容跑到內文 | 用了 Vue 2 的 `slot="footer"` | 改成 `<template #footer>` |
| `Property "row" was accessed during render but is not defined on instance.` | 在 slot 內容裡直接讀子元件的變數 | 從作用域 slot 參數取：`#default="{ row }"` |
| `v-slot can only be used on components or <template> tags.` | `v-slot` 寫在一般 HTML 元素上 | 包一層 `<template #name>` |
| `[Vue warn]: injection "Symbol(clinic)" not found.` | 祖先沒有 provide、key 不是同一個 Symbol、或元件不在提供者底下 | 確認 key 從同一個檔匯入；需要時給預設值 |
| `inject() can only be used inside setup() or functional components.` | 在事件處理函式或 `setTimeout` 裡呼叫 `inject` | 在 setup 頂層呼叫，把結果存起來 |
| 提供者改了值，後代沒更新 | provide 的是 `.value` 或普通值 | provide ref 本身 |
| `Set operation on key "value" failed: target is readonly.` | 後代想改 readonly 的注入值 | 呼叫提供者給的修改函式 |

## 動手

1. 照上面的 `AppCard` 寫一個卡片，父元件只給預設 slot，確認頁首顯示「未命名」、沒有頁尾的框線；再加上 `#footer`。
2. 在使用 `DataTable` 的頁面把 `#cell-status="{ value }"` 改成直接寫 `{{ row.status }}`，看 Console 的警告，再改回來。
3. 把 `provide(clinicKey, readonly(clinic))` 改成 `provide(clinicKey, clinic.value)`，接著在 `App.vue` 整個換掉 `clinic.value`，確認 `TimeCell` 沒有更新。
4. 院區設定之外，如果好幾個頁面都要讀「目前登入的醫師」，比較 provide 與 [Pinia](#/skill/pinia) 的寫法；元件之間只隔一層時回到 [props、emits 與 v-model](#/skill/props-emits-model)。

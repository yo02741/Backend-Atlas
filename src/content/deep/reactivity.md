## 從一個具體問題開始：搜尋框打了字，清單沒變

預約清單上方有一個搜尋框，輸入病患姓名就篩選。拿到的程式長這樣：

```vue
<script setup>
import { reactive } from 'vue'

const state = reactive({ keyword: '', appointments: [] })
const { keyword, appointments } = state                    // ① 解構
const filtered = appointments.filter((a) => a.patientName.includes(keyword))   // ② 只算一次

fetch('/api/appointments?date=2026-11-20')
  .then((res) => res.json())
  .then((data) => { state.appointments = data })
</script>

<template>
  <input v-model="state.keyword" placeholder="病患姓名">
  <ul><li v-for="a in filtered" :key="a.id">{{ a.patientName }}</li></ul>
</template>
```

畫面一直是空的，打字也沒有反應，Console 沒有任何錯誤。兩個地方斷了：

1. 解構出來的 `keyword` 是空字串、`appointments` 是當下那個空陣列，之後 `state` 改了，它們不會跟著變。
2. `filtered` 是一個普通變數，在 setup 執行時算了一次（對空陣列篩選），之後不會重算。

要改對，得知道 Vue 怎麼知道「哪些資料變了、要重畫哪裡」。

## 運作原理：讀的時候記下來，寫的時候通知

### 追蹤與觸發

Vue 3 的響應式建立在 JavaScript 的 `Proxy` 上：

- `reactive(obj)` 回傳一個 Proxy。讀屬性時（get）Vue 記下「目前正在執行的 effect 讀了這個物件的這個屬性」，這叫 **track**；寫屬性時（set）Vue 找出讀過這個屬性的 effect，重新執行，這叫 **trigger**。
- 元件的渲染本身是一個 effect。渲染時模板讀了哪些響應式資料，就訂閱了哪些；之後只有這些資料改變，元件才重新渲染。
- `ref(value)` 是一個帶 `.value` getter／setter 的物件，`.value` 的讀寫一樣會 track、trigger。

一般的區域變數沒辦法被攔截，所以 ref 要包一層，用 `.value` 讀寫。模板裡 Vue 會自動拆開頂層的 ref，不用寫 `.value`。

把開頭的例子改對以後，一次輸入的過程：

| 步驟 | 發生什麼 | 誰被通知 |
|---|---|---|
| 1. 第一次渲染 | 模板讀 `filtered.value`，computed 讀 `keyword.value` 與 `appointments.value` | 渲染 effect 訂閱 `filtered`；`filtered` 訂閱另外兩個 |
| 2. API 回來 | `appointments.value = data` | `filtered` 標記成需要重算，渲染 effect 排進更新佇列 |
| 3. 同一輪更新 | 渲染時讀 `filtered.value`，computed 重算一次 | 畫面出現 30 筆 |
| 4. 輸入「王」 | `v-model` 寫入 `keyword.value = '王'` | 同上，`filtered` 重算，畫面剩 3 筆 |

同一個事件裡連改好幾個值，Vue 會合併成一次渲染；要在改完之後讀新的 DOM，用 `nextTick()`（見 [生命週期](#/skill/lifecycle)）。

### 一個可以跑的極簡模型

下面用 30 行 JavaScript 做出 track、trigger 與 effect，可以看到解構為什麼會斷。這是示意，Vue 實際的實作多了陣列、Map、巢狀物件、排程與清除舊依賴：

```js run
// 極簡的依賴追蹤（示意，不是 Vue 的原始碼）
let activeEffect = null
const deps = new WeakMap()   // 物件 → Map(屬性 → Set(effect))

function track(target, key) {
  if (!activeEffect) return
  let byKey = deps.get(target)
  if (!byKey) deps.set(target, (byKey = new Map()))
  let effects = byKey.get(key)
  if (!effects) byKey.set(key, (effects = new Set()))
  effects.add(activeEffect)
}
function trigger(target, key) {
  deps.get(target)?.get(key)?.forEach((run) => run())
}
function reactive(obj) {
  return new Proxy(obj, {
    get(t, k, r) { track(t, k); return Reflect.get(t, k, r) },
    set(t, k, v, r) { const ok = Reflect.set(t, k, v, r); trigger(t, k); return ok },
  })
}
function effect(fn) {
  const run = () => { const prev = activeEffect; activeEffect = run; try { fn() } finally { activeEffect = prev } }
  run()
}

const state = reactive({ keyword: '王', checkedIn: 1 })
effect(() => console.log(`render：搜尋「${state.keyword}」`))   // 這個 effect 只讀了 keyword

state.keyword = '王小'   // 讀過 → 重新執行
state.checkedIn = 2      // 沒讀過 → 什麼都不發生

const { keyword } = state   // 解構：拿到字串 '王小'，不是 Proxy
effect(() => console.log(`解構後：${keyword}`))
state.keyword = '陳'        // 只有第一個 effect 重新執行
```

輸出是四行：`render：搜尋「王」`、`render：搜尋「王小」`、`解構後：王小`、`render：搜尋「陳」`。第二個 effect 讀的是區域變數，沒有經過 Proxy 的 get，所以沒有訂閱任何東西。

### ref 與 reactive

| | `ref()` | `reactive()` |
|---|---|---|
| 能放什麼 | 任何值：數字、字串、陣列、物件 | 只能是物件、陣列、Map、Set |
| 在 script 裡 | `count.value` | `state.count` |
| 在模板裡 | 頂層的 ref 自動拆開：`{{ count }}` | `{{ state.count }}` |
| 整個換掉 | `list.value = newList`，訂閱還在 | `state = reactive({…})` 換掉的是變數，模板還連著舊物件 |
| 解構 | 解構 `.value` 得到普通值 | 解構得到普通值，要先 `toRefs(state)` |

Vue 官方文件建議以 `ref` 為主要的宣告方式。ref 放物件時，內部一樣是深層的響應式，`items.value.push(x)`、`items.value[0].status = 'cancelled'` 都會觸發更新。Vue 2 時代的 `Vue.set`、`this.$set` 在 Vue 3 已經移除。

### computed：有快取的衍生值

`computed(() => …)` 回傳一個唯讀的 ref。它記下 getter 讀了哪些響應式資料，依賴沒變時重複讀 `.value` 直接回傳上次的結果；依賴一變，下次讀取時才重算。

和在模板裡呼叫方法的差別：`{{ visibleAppointments() }}` 每次元件重新渲染都會重算，就算改的是不相干的資料；computed 只在依賴改變時重算。computed 的 getter 只計算、回傳值，不呼叫 API、不改別的狀態，那些放在事件處理或 `watch`。

### 什麼時候會失去響應式

1. 解構 `reactive` 物件：`const { keyword } = state`。
2. 把 `.value` 存進普通變數：`const list = appointments.value` 之後又整個換掉 `appointments.value`，`list` 還指著舊陣列。
3. 整個換掉 `reactive` 物件：`let state = reactive({…}); state = reactive({…})`。
4. 把 prop 存進區域變數：`const date = props.date`。Vue 3.5 起，寫在 `defineProps` 那一行的解構（`const { date } = defineProps(…)`）會被編譯器改寫成 `props.date`，保持響應式；另外寫一行 `const date = props.date` 不會。

## 實際程式：改好的搜尋清單

```vue
<script setup>
import { ref, computed, onMounted } from 'vue'

const keyword = ref('')
const appointments = ref([])

// 衍生值用 computed：依賴 keyword 與 appointments，任一個改變就重算
const filtered = computed(() =>
  appointments.value.filter((a) => a.patientName.includes(keyword.value.trim())),
)
const checkedInCount = computed(() =>
  appointments.value.filter((a) => a.status === 'checked_in').length,
)

onMounted(async () => {
  const res = await fetch('/api/appointments?date=2026-11-20')
  if (res.ok) appointments.value = await res.json()   // 整個換掉 .value，訂閱還在
})

function markCheckedIn(id) {
  const a = appointments.value.find((x) => x.id === id)
  if (a) a.status = 'checked_in'   // 改內部屬性也會觸發，checkedInCount 跟著變
}
</script>

<template>
  <input v-model="keyword" placeholder="病患姓名">
  <p>已報到 {{ checkedInCount }} 人</p>
  <ul>
    <li v-for="a in filtered" :key="a.id">
      {{ a.patientName }}
      <button type="button" @click="markCheckedIn(a.id)">報到</button>
    </li>
  </ul>
</template>
```

模板裡沒有 `.value`；script 裡每個 ref 都有。`filtered` 與 `checkedInCount` 不另外存一份，也不用 `watch` 去同步。

如果狀態一定要包成一個物件（例如表單），用 `reactive` 再 `toRefs` 解構：

```js
import { reactive, toRefs } from 'vue'

const form = reactive({ name: '', phone: '' })
const { name, phone } = toRefs(form)   // name、phone 是 ref，和 form.name、form.phone 連動
```

圖表或地圖套件的實例、上萬筆的唯讀資料，不需要被轉成深層 Proxy：實例用 `markRaw()` 標記或放進 `shallowRef()`，大量唯讀資料用 `shallowRef()`，只在整個換掉 `.value` 時觸發更新。

## React 對照

| Vue 3.5 | React 19 |
|---|---|
| `const keyword = ref('')`，改值寫 `keyword.value = '王'` | `const [keyword, setKeyword] = useState('')`，改值呼叫 `setKeyword('王')` |
| 自動追蹤依賴，資料一改就重新渲染讀過它的元件 | 呼叫 setter 後重新執行整個元件函式 |
| `computed(() => …)`，依賴自動收集 | 直接在函式裡計算；成本高時用 `useMemo(() => …, [deps])`，依賴陣列自己列 |
| 可以直接改：`items.value.push(x)` | 要產生新陣列：`setItems([...items, x])`，直接 `push` 不會重新渲染 |

同一個篩選清單用 React 寫：

```jsx
import { useEffect, useMemo, useState } from 'react'

export function AppointmentSearch() {
  const [keyword, setKeyword] = useState('')
  const [appointments, setAppointments] = useState([])

  useEffect(() => {
    fetch('/api/appointments?date=2026-11-20')
      .then((res) => (res.ok ? res.json() : []))
      .then(setAppointments)
  }, [])

  const filtered = useMemo(
    () => appointments.filter((a) => a.patientName.includes(keyword.trim())),
    [appointments, keyword],   // 依賴要自己列；漏了就會用到舊值
  )

  return (
    <>
      <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="病患姓名" />
      <ul>{filtered.map((a) => <li key={a.id}>{a.patientName}</li>)}</ul>
    </>
  )
}
```

## 常見錯誤與錯誤訊息

| 現象或訊息 | 原因 | 修法 |
|---|---|---|
| 畫面不更新，沒有任何訊息 | 解構了 `reactive`，或把 `.value` 存進普通變數 | 直接用 ref，或 `toRefs` |
| `[Vue warn]: value cannot be made reactive: 0` | 把原始值傳給 `reactive()` | 改用 `ref(0)` |
| `TypeError: Assignment to constant variable.` | 對 `const count = ref(0)` 寫 `count++` | 寫 `count.value++` |
| 數字變成 `NaN` | `let count = ref(0)` 之後 `count++`，把 ref 物件轉成數字 | 同上；lint 規則 `vue/no-ref-as-operand` 會抓 |
| 畫面上一片空白 | 模板裡寫 `{{ count.value }}`：頂層 ref 已經拆開，`(0).value` 是 `undefined` | 模板裡不寫 `.value` |
| 畫面顯示 `[object Object]1` | ref 放在普通物件裡（`{ n: ref(1) }`），模板寫 `{{ obj.n + 1 }}`，這種 ref 不會自動拆開 | 把 ref 放在頂層，或寫 `obj.n.value` |
| `[Vue warn]: Write operation failed: computed value is readonly` | 對 computed 指定值 | 改它依賴的來源；需要寫入時用有 `get`、`set` 的 computed |
| 編譯錯誤 `"date" is a destructured prop and should not be passed directly to watch(). Pass a getter () => date instead.` | Vue 3.5 的 props 解構直接傳給 `watch` | 寫 `watch(() => date, …)` |
| `TypeError: Cannot read private member #… from an object whose class did not declare it` | 有 `#private` 欄位的 class 實例被包成 Proxy（例如放進 `ref`） | 用 `markRaw()` 或 `shallowRef()` |

讀 AI 產出時另外留意：

- 用 `watch` 把 A 算好抄到 B（`watch(a, () => { b.value = f(a.value) })`），改成 `const b = computed(() => f(a.value))`。
- computed 裡呼叫 API、`push` 進別的陣列：lint 規則 `vue/no-async-in-computed-properties`、`vue/no-side-effects-in-computed-properties` 會報錯。
- 出現 `this.$set`、`Vue.set`、`data()` 回傳物件：這是 Vue 2 或 Options API 的寫法，在 `<script setup>` 裡不需要。

## 動手

1. 按上面極簡模型的「在 Playground 開啟」，把最後一行改成 `state.checkedIn = 3`，確認沒有任何輸出；再加一個讀 `state.checkedIn` 的 effect，改一次值看它重新執行。
2. 在自己的 Vue 專案貼上本課開頭的錯誤版本，用 Vue DevTools 看 `state.keyword` 有變、清單卻沒變；照「實際程式」改完再看一次。
3. 在 `filtered` 的 computed 裡加一行 `console.log('filter')`，在頁面上點不相干的按鈕（例如切換篩選面板），確認不會印出；改成模板裡呼叫方法 `filtered()`，比較印出的次數。
4. 接著讀 [模板語法](#/skill/template-syntax)，看 `v-for` 的 `key` 怎麼跟響應式資料配合。

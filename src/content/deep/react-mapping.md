## 從一個具體問題開始：改成 React 之後，請求停不下來

合作的院所用 React，要把 Vue 寫的時段選擇元件 `SlotPicker` 搬過去。原本的 Vue 版本：

```js
const dept = ref('內科')
const slots = ref([])
const available = computed(() => slots.value.filter((s) => s.left > 0))
watch(dept, async (d) => {
  slots.value = await (await fetch(`/api/slots?dept=${d}`)).json()
}, { immediate: true })
```

逐行翻成 React 的第一版：

```jsx
const [dept, setDept] = useState('內科')
const [slots, setSlots] = useState([])
const [available, setAvailable] = useState([])

useEffect(() => {
  fetch(`/api/slots?dept=${dept}`).then((r) => r.json()).then(setSlots)
})                                                     // ✗ 沒有依賴陣列

useEffect(() => {
  setAvailable(slots.filter((s) => s.left > 0))        // ✗ 用 effect 同步衍生值
}, [slots])
```

一打開頁面，Network 分頁的 `/api/slots` 一直增加。第一個 effect 沒有依賴陣列，每次渲染後都執行；請求回來 `setSlots` 觸發重新渲染，effect 又送一次請求，停不下來。第二個 effect 讓畫面先用舊的 `available` 渲染一次，再更新一次。

兩個錯誤都來自同一個差別：Vue 的 `<script setup>` 只執行一次，`watch` 只在指定的來源改變時觸發；React 的元件函式每次渲染都整個重新執行，effect 預設每次渲染後都跑。

## 運作原理

### 重跑的範圍

```
Vue 3.5                                  React 19
建立元件：<script setup> 執行一次          每次渲染：整個元件函式重新執行
  ref、computed、watch 各建立一次            useState 取回目前的值
  ↓                                         函式內的變數、函式全部重新建立
資料改變：只重跑讀過它的 render 與 computed   ↓
  watch 只在來源改變時執行 callback          渲染完成後：依賴有變的 effect 執行
```

React 的很多規則由這一點推出來：

- 每次渲染都重新建立變數，所以需要 `useState` 把值留到下一次。
- 每次渲染都重新建立函式，傳給子元件的 callback 每次都是新的，必要時用 `useCallback` 保持同一個參考。
- effect 讀到的是「那一次渲染」的值，所以要用依賴陣列告訴 React 哪些值變了要重跑。
- React 靠呼叫順序認出哪個 `useState` 是哪個，所以 hook 不能放在 `if` 裡。

Vue 的依賴由執行時自動追蹤，這些規則都不需要。

### 對照表

| 需求 | Vue 3.5 | React 19 |
|---|---|---|
| 元件的狀態 | `const date = ref('')`，`date.value = x` | `const [date, setDate] = useState('')`，`setDate(x)` |
| 物件、陣列的更新 | 直接改：`items.value.push(x)` | 換成新的：`setItems([...items, x])` |
| 衍生值 | `computed(() => …)` | 在函式裡直接算；成本高才 `useMemo(() => …, [deps])` |
| 狀態改變時做事 | `watch(source, cb)` | `useEffect(() => { … }, [deps])` |
| 第一次掛載後 | `onMounted` | `useEffect(() => { … }, [])` |
| 卸載時清理 | `onUnmounted`、`onWatcherCleanup` | effect 回傳的函式 |
| 讀 DOM 元素 | `useTemplateRef('el')` | `useRef(null)` 加 `ref={el}` |
| 父傳子 | `defineProps` | 函式參數 |
| 子通知父 | `emit('confirm', d)` | 呼叫 callback prop：`onConfirm(d)` |
| 雙向綁定 | `v-model`、`defineModel` | `value` 加 `onChange`（受控元件） |
| 預設 slot | `<slot />` | `children` |
| 作用域 slot | `<slot :row="row">` | 回傳 JSX 的函式 prop |
| 跨層共用 | `provide`／`inject` | `createContext`、`<Context value>`（React 19）、`useContext` |
| 重用邏輯 | composable `useXxx` | 自訂 hook `useXxx` |
| 條件渲染 | `v-if`、`v-show` | `{cond && <X />}`、三元運算子；沒有 `v-show`，用 `style`／`hidden` |
| 列表 | `v-for` 加 `:key` | `items.map((x) => <li key={x.id}>…</li>)` |
| 全域狀態 | Pinia | Zustand、Redux Toolkit 等第三方套件 |
| 路由 | Vue Router | React Router 等第三方套件 |

### 狀態更新與舊的閉包

Vue 的 `ref` 是一個物件，任何時候讀 `.value` 都是最新的值。React 的 `count` 是那一次渲染時拿到的數字，存進 callback 之後就固定了：

```jsx
// React：每秒加一，畫面卻停在 1
function Counter() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setCount(count + 1), 1000)   // count 永遠是第一次渲染的 0
    return () => clearInterval(id)
  }, [])
  return <p>{count}</p>
}
```

修法是改用更新函式 `setCount((c) => c + 1)`，由 React 傳入目前的值。同樣的事 Vue 寫成 `setInterval(() => count.value++, 1000)` 就正確，因為每次執行都重新讀 `.value`。

React 的 setter 也不會改變這一次渲染裡的變數：`setDate('2026-11-21'); console.log(date)` 印出的還是舊日期，新值要到下一次渲染才看得到。

### hooks 規則

React 文件的兩條規則：

1. 只在元件或自訂 hook 的最上層呼叫 hook，不放在條件、迴圈、巢狀函式、`try`／`catch`／`finally` 裡，也不放在提早 `return` 之後。
2. 只在 React 的函式元件或自訂 hook 裡呼叫。

`eslint-plugin-react-hooks` 的 `rules-of-hooks` 會報 `React Hook "useEffect" is called conditionally. React Hooks must be called in the exact same order in every component render.`；`exhaustive-deps` 會報 `React Hook useEffect has a missing dependency: 'dept'. Either include it or remove the dependency array.`。執行時違反規則，React 會丟出 `Rendered more hooks than during the previous render.`。

Vue 的 composable 沒有呼叫順序的限制，但要在 setup 期間呼叫（見 [composables](#/skill/composables)）。

### effect 的開發模式行為

React 18 起，`<StrictMode>` 在開發模式會讓每個 effect 多跑一輪 setup 加 cleanup，用來檢查清理有沒有寫好。所以開發時同一個請求出現兩次、第一個被取消，是正常的；兩個都成功回來，代表 effect 沒有清理。Vue 沒有這個機制。

### React Compiler

React Compiler 1.0（2025-10 發布）是建置時的工具，自動替元件與 hook 加上 memo，減少手寫 `useMemo`、`useCallback` 的需要。它不改變上面的規則：依賴陣列與 hooks 規則仍然要遵守，effect 的清理仍然要自己寫。

## 實際程式：同一個 SlotPicker，兩種寫法

```vue
<!-- SlotPicker.vue（Vue 3.5） -->
<script setup>
import { ref, computed, watch, onWatcherCleanup } from 'vue'

const { dept } = defineProps({ dept: { type: String, required: true } })
const selected = defineModel('selected')           // 父元件：v-model:selected="slotId"
const slots = ref([])

const available = computed(() => slots.value.filter((s) => s.left > 0))

watch(() => dept, async (d) => {
  const controller = new AbortController()
  onWatcherCleanup(() => controller.abort())
  try {
    const res = await fetch(`/api/slots?dept=${encodeURIComponent(d)}`, { signal: controller.signal })
    slots.value = res.ok ? await res.json() : []
  } catch (err) {
    if (err.name !== 'AbortError') throw err
  }
}, { immediate: true })
</script>

<template>
  <ul>
    <li v-for="s in available" :key="s.id">
      <button type="button" :aria-pressed="s.id === selected" @click="selected = s.id">
        <slot name="option" :item="s">{{ s.time }}（剩 {{ s.left }}）</slot>
      </button>
    </li>
  </ul>
</template>
```

```jsx
// SlotPicker.jsx（React 19）
import { useEffect, useState } from 'react'

export function SlotPicker({ dept, selected, onSelectedChange, renderOption }) {
  const [slots, setSlots] = useState([])
  const available = slots.filter((s) => s.left > 0)          // computed → 直接算

  useEffect(() => {                                          // watch(() => dept, …, { immediate: true })
    const controller = new AbortController()
    fetch(`/api/slots?dept=${encodeURIComponent(dept)}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : []))
      .then(setSlots)
      .catch((err) => { if (err.name !== 'AbortError') throw err })
    return () => controller.abort()                          // onWatcherCleanup → 清理函式
  }, [dept])

  return (
    <ul>
      {available.map((s) => (
        <li key={s.id}>
          <button type="button" aria-pressed={s.id === selected} onClick={() => onSelectedChange(s.id)}>
            {renderOption ? renderOption(s) : `${s.time}（剩 ${s.left}）`}
          </button>
        </li>
      ))}
    </ul>
  )
}

// 父元件：<SlotPicker dept={dept} selected={slotId} onSelectedChange={setSlotId} renderOption={(s) => <b>{s.time}</b>} />
```

逐項對照：`defineModel('selected')` 拆成 `selected` 與 `onSelectedChange`；`computed` 變成一行直接計算；`watch` 加 `immediate` 變成依賴 `[dept]` 的 effect（React 的 effect 第一次渲染後一定會執行，相當於 `immediate`）；`onWatcherCleanup` 變成 effect 回傳的函式；作用域 slot `#option="{ item }"` 變成 `renderOption` 函式 prop。

:::stop 讀到這裡可以先停：說得出 React 每次渲染重跑整個元件、閉包會留住舊值，會把 Vue 的 computed、watch 與 v-model 對到 React 的寫法。後面的錯誤訊息表，在 React 的 Console 出現 hooks 警告時再回來查。

## 常見錯誤與錯誤訊息

| 訊息或現象 | 原因 | 修法 |
|---|---|---|
| Network 分頁的請求不斷增加 | `useEffect` 沒有依賴陣列，抓完 `setState` 又觸發 effect | 加上依賴陣列 `[dept]` |
| `Maximum update depth exceeded. This can happen when a component calls setState inside useEffect…` | effect 裡同步 `setState`，而且依賴每次都變（或沒有依賴陣列） | 衍生值改成直接計算；確認依賴陣列 |
| `Too many re-renders. React limits the number of renders to prevent an infinite loop.` | 渲染時就呼叫 setter，例如 `onClick={setOpen(true)}` | 改成 `onClick={() => setOpen(true)}` |
| `Rendered more hooks than during the previous render.` | hook 寫在條件式或提早 `return` 之後 | 移到元件最上層 |
| `React Hook useEffect has a missing dependency: 'dept'.`（lint） | effect 用到的值沒列進依賴陣列 | 補上；不想因它重跑時看 `useEffectEvent`（React 19.2） |
| `push` 之後畫面沒變 | React 要新的陣列才會重新渲染 | `setItems([...items, x])` |
| 計時器裡的值一直是舊的 | callback 記住了第一次渲染的值 | 用更新函式 `setCount((c) => c + 1)` |
| 開發時請求送兩次 | `<StrictMode>` 多跑一輪 effect | 寫好清理，第一個會顯示 `(canceled)` |
| React 元件裡出現 `.value`、`v-model`，或 Vue 元件裡出現 `useState` | 產出混用了兩個框架 | 指定框架與版本重新產生 |

## 動手

1. 用 `npm create vite@latest` 各建一個 Vue 與 React 專案，把上面的 `SlotPicker` 兩個版本放進去，用 Network 分頁比較：React 開發模式下第一個請求被取消，Vue 只送一次。
2. 把 React 版的依賴陣列刪掉，看請求不斷增加；再加回 `[dept]`。
3. 寫出上面的 `Counter`，確認畫面停在 1；改成 `setCount((c) => c + 1)`，再用 Vue 寫同樣的計時器比較。
4. 拿一個自己的 Vue 元件，照對照表逐項寫出 React 版本；各項的 Vue 寫法分別在 [props、emits 與 v-model](#/skill/props-emits-model)、[slots 與元件組合](#/skill/slots-provide)、[watch 與 watchEffect](#/skill/watchers)。

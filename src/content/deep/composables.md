## 從一個具體問題開始：三個元件、三份抓資料的程式

門診系統有三個頁面都要抓資料：看板抓今天的診間、掛號頁抓可掛號的時段、病人頁抓病歷。每個元件各自寫了一份：

```js
const data = ref(null)
const loading = ref(false)
const error = ref(null)

async function load() {
  loading.value = true
  try {
    const res = await fetch(url)
    data.value = await res.json()
  } catch (e) {
    error.value = e
  } finally {
    loading.value = false
  }
}
onMounted(load)
```

三份程式碼慢慢長得不一樣：看板版本會檢查 `res.ok`，另外兩份不會，500 的錯誤頁 HTML 被當成 JSON 解析，丟出 `SyntaxError: Unexpected token '<'`。掛號頁換日期時要重抓，有人在 `watch` 裡又複製了一次 `load`，切日期太快時舊回應蓋掉新結果。修一個 bug 要改三個檔，而且常常漏掉一個。

把這段邏輯抽成 `useFetch`，三個元件各呼叫一次，bug 只修一處。

## 運作原理

### composable 只是函式

composable 是名稱以 `use` 開頭、在 setup 裡呼叫的函式。它裡面可以用任何 Composition API：

```js
// useNow.js：每秒更新一次的目前時間
import { ref, onMounted, onUnmounted } from 'vue'

export function useNow() {
  const now = ref(new Date())
  let timer
  onMounted(() => { timer = setInterval(() => (now.value = new Date()), 1000) })
  onUnmounted(() => clearInterval(timer))
  return { now }
}
```

元件呼叫 `useNow()` 時：

1. `ref(new Date())` 在這次呼叫裡建立，所以每個元件拿到自己的一份 `now`。
2. `onMounted`、`onUnmounted` 註冊到「目前正在建立的元件」上，元件卸載時計時器跟著清掉。
3. `watch`、`computed` 也綁在這個元件上，卸載時自動停止。

第 2、3 點要求 composable 在 setup 期間呼叫。Vue 只在執行 `<script setup>`（或 `setup()`）時知道目前是哪個元件；放在 click 處理函式或 `setTimeout` 裡，鉤子找不到元件，Console 出現 `[Vue warn]: onMounted is called when there is no active component instance to be associated with.`。`<script setup>` 頂層的 `await` 之後是例外，編譯器會替你接回元件的上下文。

### 回傳值：ref 組成的一般物件

| composable 回傳 | 元件寫 `const { now } = useNow()` 之後 |
|---|---|
| `{ now }`，`now` 是 ref | `now` 是 ref，會更新 |
| `reactive({ now: new Date() })` | 解構拿到當下的 `Date`，之後不更新 |
| `{ now: now.value }` | 拿到當下的值，之後不更新 |

慣例是回傳一般物件、每個值是 ref。元件可以解構、可以改名（`const { data: slots } = useFetch(…)`）；想用 `obj.x` 的寫法，就自己包一層 `reactive(useFetch(…))`，ref 會被自動拆開。

### 參數：值、ref 或 getter

composable 要在參數改變時重新執行，就不能只收一個當下的值：

| 呼叫方式 | composable 收到 | 參數改變時 |
|---|---|---|
| `useFetch('/api/slots?date=2026-11-20')` | 字串 | 不會變，只抓一次 |
| `useFetch(url)`，`url` 是 ref | ref | 在 watch 裡讀 `url.value` 就會追蹤 |
| `useFetch(() => '/api/slots?date=' + date.value)` | getter | 在 watch 裡呼叫它就會追蹤 |
| `useFetch('/api/slots?date=' + date.value)` | 當下的字串 | 不會重抓：呼叫時就算好了 |

Vue 3.3 起的 `toValue()` 把三種情況統一：是 ref 就讀 `.value`，是函式就呼叫它，其他原樣回傳。關鍵是在哪裡呼叫它：在 `watchEffect` 或 `watch` 的 getter 裡呼叫，讀取才會被追蹤；在 composable 的最外層呼叫，只會拿到當下的值。TypeScript 的型別寫成 `MaybeRefOrGetter<string>`。

### 和 mixin、元件、Pinia 的差別

Vue 2 用 mixin 共用邏輯：把一包 `data`、`methods`、鉤子混進元件。Vue 官方文件列出它的三個問題：用了好幾個 mixin 時看不出 `loading` 是誰提供的；兩個 mixin 用了同一個名稱會互相蓋掉；mixin 之間只能靠共用的屬性名互相溝通。composable 是一般的函式呼叫，回傳值自己命名，一個 composable 的輸出可以當成另一個的參數。Vue 3 只為了遷移保留 mixin。

| 要共用的是 | 用 |
|---|---|
| 有狀態的邏輯，每個元件各一份（抓資料、計時、監聽視窗大小） | composable |
| 一塊畫面加上它的行為 | 元件（需要客製畫面就加 slot） |
| 好幾個頁面共用同一份狀態 | [Pinia](#/skill/pinia) store |
| 沒有狀態的計算（格式化日期、算年齡） | 一般函式，不用 `use` 開頭 |

在 composable 函式外面（模組頂層）宣告的 `ref`，所有元件共用同一份。小專案拿它當簡易的全域狀態可以，但它不會出現在 Vue DevTools 的 Pinia 分頁，伺服器端渲染時還會被不同使用者的請求共用。

## 實際程式：useFetch

```ts
// src/composables/useFetch.ts
import { ref, shallowRef, watchEffect, toValue, onWatcherCleanup, type MaybeRefOrGetter } from 'vue'

export function useFetch<T>(url: MaybeRefOrGetter<string>) {
  const data = shallowRef<T | null>(null)      // 整包換掉，不需要深層響應式
  const error = ref<string | null>(null)
  const loading = ref(false)
  const version = ref(0)                       // 改它就重抓一次

  watchEffect(async () => {
    version.value                              // 讀一次，讓 refresh() 觸發重新執行
    const target = toValue(url)                // 在 watchEffect 裡讀，網址的依賴才會被追蹤
    const controller = new AbortController()
    onWatcherCleanup(() => controller.abort()) // 下一次執行前取消這次的請求；要在 await 之前

    loading.value = true
    error.value = null
    try {
      const res = await fetch(target, { signal: controller.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)   // 4xx、5xx 不會讓 fetch reject
      data.value = (await res.json()) as T
    } catch (e) {
      if ((e as Error).name === 'AbortError') return       // 被取消：不改狀態
      error.value = (e as Error).message
    } finally {
      if (!controller.signal.aborted) loading.value = false
    }
  })

  const refresh = () => { version.value++ }
  return { data, error, loading, refresh }
}
```

```vue
<!-- SlotList.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { useFetch } from '@/composables/useFetch'

const date = ref('2026-11-20')
const { data: slots, error, loading, refresh } = useFetch<{ id: number; time: string }[]>(
  () => `/api/slots?date=${date.value}`,      // getter：date 一變就重抓
)
</script>

<template>
  <input type="date" v-model="date">
  <p v-if="loading">載入中…</p>
  <p v-else-if="error">無法載入（{{ error }}）<button type="button" @click="refresh">重試</button></p>
  <ul v-else><li v-for="s in slots ?? []" :key="s.id">{{ s.time }}</li></ul>
</template>
```

`watchEffect` 依賴兩樣東西：`version` 與 `toValue(url)` 裡讀到的 `date`。改日期或按重試都會重新執行，上一次還沒回來的請求被 `onWatcherCleanup` 取消。

很多常見需求不用自己寫。VueUse（`@vueuse/core`，2026-09 發布 15.0）有 `useLocalStorage`、`useEventListener`、`useDebounceFn`、`watchDebounced`、`useWindowSize` 等，元件卸載時都會自己清理；它也有自己的 `useFetch`，選項比上面這個多。

:::stop 讀到這裡可以先停：會把重複的狀態與副作用抽成 composable，回傳 ref 組成的物件，參數接受 getter。後面的 React 對照與錯誤訊息表，在讀自訂 hook 時再回來讀。

## React 對照

| Vue 3.5 composable | React 19 自訂 hook |
|---|---|
| `useXxx()`，在 setup 裡呼叫一次 | `useXxx()`，每次渲染都呼叫一次 |
| 裡面用 `ref`、`computed`、`watch`、`onMounted` | 裡面用 `useState`、`useMemo`、`useEffect` |
| 回傳 ref，元件解構後仍會更新 | 回傳當次渲染的值；狀態改變時元件重新渲染、hook 重新執行 |
| 參數接受 getter，用 `toValue` 讀 | 參數是當次的值，放進 `useEffect` 的依賴陣列 |
| 可以放在條件式後面（setup 只跑一次） | 要遵守 hooks 規則：只能在頂層、不能放在 `if` 裡 |

```jsx
import { useEffect, useState } from 'react'

export function useFetch(url) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  useEffect(() => {
    const controller = new AbortController()
    setState((s) => ({ ...s, loading: true, error: null }))
    fetch(url, { signal: controller.signal })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json() })
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((e) => { if (e.name !== 'AbortError') setState({ data: null, error: e.message, loading: false }) })
    return () => controller.abort()
  }, [url])
  return state
}
```

Vue 官方文件比較兩者時提到：composable 只執行一次，不受呼叫順序限制，也不需要依賴陣列；React 的 hook 每次渲染都重跑，所以有這兩條規則。

## 常見錯誤與錯誤訊息

| 訊息或現象 | 原因 | 修法 |
|---|---|---|
| `[Vue warn]: onMounted is called when there is no active component instance to be associated with.` | composable 在 click 處理函式、`setTimeout` 或 `.then()` 裡呼叫 | 移到 `<script setup>` 頂層 |
| 解構後畫面不更新 | composable 回傳 `reactive` 物件或 `.value` | 回傳 ref |
| 參數變了沒有重抓 | 傳了當下的字串，或在 watch 外呼叫 `toValue` | 傳 getter；在 `watchEffect` 裡 `toValue` |
| `SyntaxError: Unexpected token '<'` | 沒檢查 `res.ok`，把 HTML 錯誤頁當 JSON 解析 | `if (!res.ok) throw …` |
| 舊回應蓋掉新結果 | 沒有取消上一次的請求 | `onWatcherCleanup(() => controller.abort())` |
| 兩個元件的狀態互相影響 | `ref` 宣告在 composable 函式外面 | 移進函式；要全域共用就用 Pinia |
| 換頁後監聽與計時器還在 | composable 開了監聽，沒有在 `onUnmounted` 移除 | 成對寫清理，或改用 VueUse 的 `useEventListener` |

## 動手

1. 把專案裡兩個元件重複的抓資料程式換成上面的 `useFetch`，用 Network 分頁的節流 `3G` 快速切日期，確認舊請求顯示 `(canceled)`。
2. 把呼叫改成 `useFetch('/api/slots?date=' + date.value)`（沒有 getter），改日期後確認不會重抓，再改回 getter。
3. 寫一個 `useNow()`，在兩個元件各呼叫一次，用 Vue DevTools 確認兩份 `now` 各自更新；把 `const now = ref(...)` 搬到函式外面，再比較一次。
4. 好幾個頁面要讀同一份「登入的醫師」時，接著讀 [Pinia](#/skill/pinia)；`onWatcherCleanup` 與 `watchEffect` 的觸發規則在 [watch 與 watchEffect](#/skill/watchers)。

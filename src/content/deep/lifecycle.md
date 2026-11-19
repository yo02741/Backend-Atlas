## 從一個具體問題開始：離開看板之後，請求還在送

門診看板 `ClinicBoard` 每 30 秒抓一次各診間的看診號碼。櫃台人員切到「掛號」頁一段時間後，打開 Network 分頁：`/api/clinics/today` 還是每 30 秒出現一次。來回切換五次之後，變成每 30 秒五次。又過了一陣子，掛號頁上突然跳出「看板已更新」的 Toast。

原因有三個，都和元件的生命週期有關：

1. `setInterval` 在元件掛載時開始，卸載時沒有 `clearInterval`。元件不見了，計時器還在，每次重新進入看板又多開一個。
2. 看板在 `window` 上監聽 `resize` 調整字級，卸載時沒有移除，監聽一樣越積越多。
3. 請求送出後使用者就離開了，回應回來時程式照樣往下跑，跳出 Toast。

## 運作原理：一個元件的一生

### 時間線

```
建立      setup（<script setup> 裡的程式碼，只執行一次）
  │       onBeforeMount
  │       （渲染；子元件依序建立、掛載）
插進 DOM  onMounted                    ← 從這裡開始拿得到 DOM 元素
  │
資料改變  onBeforeUpdate → 重新渲染 → onUpdated
  │       （可以發生很多次）
  │
移除      onBeforeUnmount → 子元件卸載 → onUnmounted
```

| 鉤子 | 什麼時候執行 | 放什麼 |
|---|---|---|
| `setup`（`<script setup>` 本體） | 元件建立時，一次 | 宣告 ref、computed、函式；註冊其他鉤子；可以開始送請求（不碰 DOM） |
| `onMounted` | 第一次渲染完、插進 DOM 後 | 量尺寸、聚焦、初始化圖表或地圖套件、`addEventListener`、開始輪詢 |
| `onUpdated` | 每次因響應式資料改變而重新渲染後 | 讀更新後的 DOM（例如捲到最新一筆）；不改狀態 |
| `onBeforeUnmount` | 卸載前，DOM 還在 | 需要讀 DOM 的清理（例如記下捲動位置） |
| `onUnmounted` | 卸載後 | `clearInterval`、`removeEventListener`、`abort()`、關 WebSocket、銷毀第三方實例 |

### 父子元件的順序

一個父元件 `Parent` 裡有一個子元件 `Child`，實際執行的順序（Vue 3.5）：

```
掛載：Parent setup → Parent beforeMount → Child setup → Child beforeMount → Child mounted → Parent mounted
卸載：Parent beforeUnmount → Child beforeUnmount → Child unmounted → Parent unmounted
```

父元件的 `onMounted` 執行時，同步的子元件都已經掛載完成，所以在父元件的 `onMounted` 裡可以讀到子元件的 DOM。非同步元件（`defineAsyncComponent`）與 `<Suspense>` 裡的元件不在此列。

### 鉤子要在 setup 期間同步註冊

`onMounted(fn)` 會把 `fn` 掛到「目前正在建立的元件」上。Vue 只在 setup 執行期間知道目前是哪個元件，所以鉤子要在 setup 裡同步呼叫。寫在 `setTimeout` 的 callback 裡、或某個之後才被呼叫的函式裡，Vue 找不到元件，Console 會出現：

```
[Vue warn]: onMounted is called when there is no active component instance to be associated with. Lifecycle injection APIs can only be used during execution of setup(). If you are using async setup(), make sure to register lifecycle hooks before the first await statement.
```

`watch` 也有同樣的規則：在 setup 裡同步建立的 watcher 綁在元件上，卸載時自動停止；在 `setTimeout` 或 `await` 之後才建立的不會自動停止，要自己呼叫 `watch` 回傳的停止函式。

### template ref 與 nextTick

`useTemplateRef('search')`（Vue 3.5 加入）回傳一個 ref，對應模板裡 `ref="search"` 的元素。setup 執行時元素還不存在，值是 `null`；`onMounted` 之後才指到真的 DOM 元素。3.5 以前的寫法是宣告一個同名的 `ref(null)`，效果相同。

改了資料後，Vue 先把更新排進佇列，等同一輪的同步程式跑完再一次套用到 DOM。要在改完資料後立刻讀新的 DOM（例如新增一筆後捲到它），先 `await nextTick()`。

### KeepAlive 換一組鉤子

`<KeepAlive>` 包住的元件切走時不卸載，留在記憶體裡，切回來時狀態還在：

```
第一次出現：setup → onBeforeMount → onMounted → onActivated
切走：      onDeactivated               （onUnmounted 不會執行）
切回來：    onActivated
```

輪詢放在 `onMounted`／`onUnmounted` 的元件被放進 `<KeepAlive>` 後，切走時輪詢不會停。暫停與恢復改放 `onDeactivated` 與 `onActivated`；`onActivated` 第一次掛載也會執行，不用在 `onMounted` 再開一次。

## 實際程式：會自己收拾的看板

```vue
<script setup>
import { ref, onMounted, onUnmounted, useTemplateRef } from 'vue'

const clinics = ref([])
const status = ref('loading')        // loading | success | error
const fontScale = ref(1)
const search = useTemplateRef('search')

let timer = null
let controller = null

async function load() {
  controller?.abort()                // 上一次還沒回來就取消，避免舊回應蓋掉新的
  controller = new AbortController()
  try {
    const res = await fetch('/api/clinics/today', { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    clinics.value = await res.json()
    status.value = 'success'
  } catch (err) {
    if (err.name === 'AbortError') return   // 被取消（卸載或下一輪開始）就不改畫面
    status.value = 'error'
  }
}

function onResize() {
  fontScale.value = window.innerWidth >= 1920 ? 1.5 : 1
}

onMounted(() => {
  load()
  timer = setInterval(load, 30_000)
  window.addEventListener('resize', onResize)
  onResize()
  search.value?.focus()              // DOM 在這裡才拿得到
})

onUnmounted(() => {
  clearInterval(timer)               // 開了什麼，就關什麼
  window.removeEventListener('resize', onResize)   // 傳入同一個函式參考才移除得掉
  controller?.abort()                // 還在路上的請求一起取消
})
</script>

<template>
  <input ref="search" type="search" placeholder="診間或醫師">
  <p v-if="status === 'loading'">載入中…</p>
  <p v-else-if="status === 'error'">看板暫時無法更新</p>
  <ul v-else :style="{ fontSize: `${fontScale}rem` }">
    <li v-for="c in clinics" :key="c.id">{{ c.room }}：目前 {{ c.currentNo }} 號</li>
  </ul>
</template>
```

清理的寫法有兩個重點：`removeEventListener` 要傳入和 `addEventListener` 同一個函式參考，寫成兩個箭頭函式就移除不掉；`abort()` 之後 fetch 會 reject 一個 `name` 為 `AbortError` 的錯誤，要在 `catch` 裡跳過，否則卸載時會把狀態改成 error。

同樣的「開始、清理」成對出現很多次時，可以抽成 composable：

```js
// usePolling.js：在 setup 裡呼叫，生命週期跟著呼叫它的元件
import { onMounted, onUnmounted } from 'vue'

export function usePolling(fn, ms) {
  let timer = null
  onMounted(() => { fn(); timer = setInterval(fn, ms) })
  onUnmounted(() => clearInterval(timer))
}
```

composable 裡的 `onMounted` 一樣要在 setup 期間同步呼叫，所以 `usePolling(load, 30_000)` 要寫在 `<script setup>` 的頂層，不能放在 callback 裡。

## React 對照

| Vue 3.5 | React 19 |
|---|---|
| `<script setup>` 本體只執行一次 | 元件函式每次渲染都執行 |
| `onMounted(fn)` | `useEffect(fn, [])` |
| `onUnmounted(cleanup)` | `useEffect` 回傳的清理函式 |
| `onUpdated` | `useEffect(fn)`（不給依賴陣列） |
| `useTemplateRef('search')` | `useRef(null)` 加上 `ref={search}` |
| `nextTick()` | 沒有直接對應；需要讀更新後的版面時用 `useLayoutEffect` |
| `<KeepAlive>` | 沒有內建；要保留狀態就把狀態往上提或存起來 |

同一個輪詢用 React 寫，開始與清理寫在同一個 effect 裡：

```jsx
import { useEffect, useState } from 'react'

export function ClinicBoard() {
  const [clinics, setClinics] = useState([])

  useEffect(() => {
    const controller = new AbortController()
    const load = () =>
      fetch('/api/clinics/today', { signal: controller.signal })
        .then((res) => res.json())
        .then(setClinics)
        .catch((err) => { if (err.name !== 'AbortError') console.error(err) })
    load()
    const timer = setInterval(load, 30_000)
    return () => { clearInterval(timer); controller.abort() }   // 卸載時執行
  }, [])

  return <ul>{clinics.map((c) => <li key={c.id}>{c.room}</li>)}</ul>
}
```

React 18 起，開發模式的 `<StrictMode>` 會讓元件掛載、卸載、再掛載一次，少寫清理的 effect 會在開發時就看到請求送兩次。Vue 沒有這個機制，要靠 Network 分頁與 Console 檢查。

## 常見錯誤與錯誤訊息

| 訊息或現象 | 原因 | 修法 |
|---|---|---|
| `TypeError: Cannot read properties of null (reading 'focus')` | 在 setup 頂層操作 template ref，元素還不存在 | 搬到 `onMounted`，或在改資料後 `await nextTick()` |
| `[Vue warn]: onMounted is called when there is no active component instance…` | 鉤子在 callback 裡或 setup 結束後才註冊 | 在 setup 頂層同步呼叫 |
| 離開頁面後 Network 分頁還在定時出現請求 | `setInterval` 沒有清掉 | `onUnmounted` 裡 `clearInterval` |
| `getEventListeners(window).resize` 的長度隨切換次數增加 | 卸載時沒有 `removeEventListener`，或傳入的不是同一個函式 | 用具名函式，加上移除 |
| 離開頁面後跳出前一頁的 Toast 或錯誤訊息 | 請求還在路上，回來後照樣執行後續程式 | 卸載時 `abort()`，`catch` 裡跳過 `AbortError` |
| `[Vue warn]: Maximum recursive updates exceeded in component <ClinicBoard>…` | `onUpdated` 或 watcher 裡改了自己依賴的狀態 | 改用 computed，或在事件處理裡改 |
| `[Vue warn]: Component <Anonymous>: setup function returned a promise, but no <Suspense> boundary was found in the parent component tree…` | `<script setup>` 頂層寫了 `await`，元件變成非同步元件 | 改成在 `onMounted` 裡呼叫 async 函式，或在外層包 `<Suspense>` |
| 放進 `<KeepAlive>` 後切走，輪詢沒停 | `onUnmounted` 不會執行 | 用 `onDeactivated` 暫停、`onActivated` 恢復 |

## 動手

1. 在自己的 Vue 專案寫一個只有 `setInterval` 沒有清理的元件，用 `v-if` 切換它五次，在 Network 分頁數每 30 秒的請求數；加上 `onUnmounted` 後再數一次。
2. 在 Chrome 的 Console 對同一個元件執行 `getEventListeners(window).resize`，比較加上 `removeEventListener` 前後的長度。
3. Network 分頁的節流選 `3G`，請求送出後馬上切走：沒有 `abort()` 時請求跑完並執行後續程式，有 `abort()` 時請求顯示 `(canceled)`。
4. 把元件包進 `<KeepAlive>`，在每個鉤子裡 `console.log`，對照上面的順序；再把輪詢搬到 `onActivated`／`onDeactivated`。
5. 請求的 loading、error 畫面怎麼設計，接著讀 [API 的四種狀態](#/skill/api-states)。

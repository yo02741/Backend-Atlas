## 從一個具體問題開始：切科別切太快，顯示錯的時段

預約查詢頁有科別與日期兩個選項，選好後列出可掛號的時段。AI 產出的程式：

```js
const dept = ref('內科')
const slots = ref([])
const slotCount = ref(0)

watch(dept, async (d) => {
  const res = await fetch(`/api/slots?dept=${d}`)
  slots.value = await res.json()
})
watch(slots, (list) => { slotCount.value = list.length })
```

測試時出現三個狀況：

1. 第一次進頁面，清單是空的，要切一次科別才有資料。
2. 櫃台人員從內科快速切到骨科再切到眼科，畫面標題寫「眼科」，列出的卻是骨科的時段。
3. 「共 N 個時段」有時對、有時慢一步。

第一個是 `watch` 預設不會在建立時執行；第二個是三個請求同時在路上，最慢回來的那個最後寫入；第三個是用 watch 抄了一份可以算出來的值。三個都和 watch 的觸發規則有關。

## 運作原理

### watch、watchEffect 與 computed 的分工

| 需求 | 用 | 原因 |
|---|---|---|
| 從狀態算出另一個值（數量、篩選結果、格式化文字） | `computed` | 有快取、沒有第二份狀態要同步、第一次就算好 |
| 狀態變了要做一件事（打 API、寫網址、存草稿、操作圖表套件） | `watch` | 明確指定來源，拿得到新值與舊值 |
| 同上，而且依賴很多、不想一一列出 | `watchEffect` | 執行時讀到什麼就依賴什麼 |
| 使用者按了按鈕要做一件事 | 事件處理函式 | 觸發點是那個事件，不用繞一圈監看狀態 |

上面第三個狀況，`slotCount` 改成 `computed(() => slots.value.length)` 就沒有「慢一步」的問題。

### 來源的寫法

```js
watch(dept, cb)                         // ref
watch(() => form.phone, cb)             // getter：監看 reactive 物件的某個屬性
watch([dept, date], cb)                 // 陣列：任一個改變就觸發，cb 拿到新值陣列
watch(form, cb)                         // reactive 物件：自動深層
watch(form.phone, cb)                   // ✗ 傳進去的是當下的字串
```

最後一行在開發模式警告：`[Vue warn]: Invalid watch source:  0 A watch source can only be a getter/effect function, a ref, a reactive object, or an array of these types.`（`0` 換成當下的值）。要監看 reactive 物件的某個屬性，寫成 getter。

Vue 3.5 的 props 解構也一樣：`const { date } = defineProps(…)` 之後寫 `watch(date, …)` 是編譯錯誤，要寫 `watch(() => date, …)`。

### 什麼時候觸發

用 Vue 3.5 實際跑過的結果：

| 寫法 | 動作 | callback 有沒有執行 |
|---|---|---|
| `watch(list, cb)`，`list` 是 `ref([])` | `list.value.push(1)` | 沒有：只比較 `.value` 本身，陣列還是同一個 |
| 同上 | `list.value = [1]` | 有 |
| `watch(list, cb, { deep: true })` | `list.value.push(1)` | 有 |
| `watch(form, cb)`，`form` 是 `reactive({ patient: { name: '' } })` | `form.patient.name = '王'` | 有：reactive 物件自動深層 |
| `watch(() => st.items, cb)` | `st.items.push(1)` | 沒有：getter 回傳的還是同一個陣列 |
| `watch(keyword, cb)` | 同步連改三次 | 一次，拿到最後的新值與最初的舊值 |
| `watch(date, cb, { immediate: true })` | 建立時 | 有，舊值是 `undefined` |
| `watch(date, cb, { once: true })`（3.4 起） | 改兩次 | 只有第一次 |

`deep` 在 Vue 3.5 起可以給數字，例如 `deep: 1` 只往下看一層。深層監看要走過整個物件，大陣列很耗時，能用 getter 指定欄位（`() => items.value.length`）就不要整包 deep。

### callback 在什麼時候執行

改了資料之後，Vue 把 watcher 的 callback 與元件的重新渲染排進同一個佇列，等這一輪同步程式跑完再一起執行。預設（`flush: 'pre'`）的順序是：父元件更新之後、這個元件自己的 DOM 更新之前。所以在 callback 裡讀自己的 DOM，看到的是更新前的樣子：

| 選項 | 執行時機 | 用途 |
|---|---|---|
| `flush: 'pre'`（預設） | 元件 DOM 更新前 | 多數情況 |
| `flush: 'post'`、`watchPostEffect` | 元件 DOM 更新後 | 要量新的元素尺寸、捲到新加的那一列 |
| `flush: 'sync'`、`watchSyncEffect` | 資料一改就同步執行，不合併 | 很少用；對會被連改很多次的陣列不要用 |

### watchEffect 追蹤到哪裡

`watchEffect` 立刻執行一次，執行期間同步讀到的響應式資料都成為依賴。`await` 之後才讀的不算：

```js
watchEffect(async () => {
  const res = await fetch(`/api/slots?dept=${dept.value}`)   // dept 在 await 之前讀：會追蹤
  slots.value = (await res.json()).filter((s) => s.date === date.value)   // date 在 await 之後讀：不會追蹤
})
```

改 `date` 不會重新執行。要讓兩個都成為依賴，在第一個 `await` 之前先把值讀出來，或改用 `watch([dept, date], …)` 明確列出來源。

### 清理：取消上一次的副作用

callback 是非同步的，新的觸發可能在舊的還沒結束時就來了。Vue 3.5 的 `onWatcherCleanup(fn)` 註冊一個清理函式，在下一次 callback 執行前、或 watcher 停止時呼叫；3.5 以前用 callback 的第三個參數 `onCleanup`，效果相同。`onWatcherCleanup` 要在第一個 `await` 之前呼叫，寫在後面會警告 `[Vue warn] onWatcherCleanup() was called when there was no active watcher to associate with.`。

下面用純 JavaScript 模擬同一件事：三個科別的回應時間不同（示意），使用者最後選眼科。

```js run
// 模擬「切換科別就抓時段」：回應時間各不相同（示意），看沒有清理與有清理的差別
const delay = { 內科: 300, 骨科: 500, 眼科: 100 }   // 每個科別的回應毫秒數
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function fakeFetch(dept, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(`${dept}的時段`), delay[dept])
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('請求已取消', 'AbortError'))
    })
  })
}

// 版本一：每次切換就送請求，回來就寫進畫面
async function runWithoutCleanup() {
  let screen = ''
  const onChange = async (dept) => { screen = await fakeFetch(dept) }
  onChange('內科'); await wait(50)
  onChange('骨科'); await wait(50)
  onChange('眼科')                    // 使用者最後選的是眼科
  await wait(600)
  console.log('沒有清理：最後選眼科，畫面顯示「' + screen + '」')
}

// 版本二：下一次觸發前取消上一個請求（watch 的 onWatcherCleanup 做的是同一件事）
async function runWithCleanup() {
  let screen = ''
  let cleanup = null
  const onChange = async (dept) => {
    cleanup?.()                       // 先執行上一次留下的清理
    const controller = new AbortController()
    cleanup = () => controller.abort()
    try {
      screen = await fakeFetch(dept, controller.signal)
    } catch (err) {
      if (err.name !== 'AbortError') throw err
      console.log('  取消：' + dept)
    }
  }
  onChange('內科'); await wait(50)
  onChange('骨科'); await wait(50)
  onChange('眼科')
  await wait(600)
  console.log('有清理：最後選眼科，畫面顯示「' + screen + '」')
}

await runWithoutCleanup()
await runWithCleanup()
```

沒有清理時，眼科在 200 ms 先回來，內科在 300 ms、骨科在 550 ms 依序蓋過去，畫面停在骨科。有清理時，內科與骨科在下一次切換時就被取消，只有眼科寫進畫面。

### 停止

`watch` 與 `watchEffect` 都回傳一個停止函式（Vue 3.5 起還有 `pause()`、`resume()`）。在 `<script setup>` 或 `setup()` 裡同步建立的 watcher 綁在元件上，卸載時自動停止；在 `setTimeout` 或 `.then()` 裡建立的不會，要自己呼叫停止函式，否則元件不見了它還在跑。

## 實際程式：預約查詢頁

```vue
<script setup>
import { ref, computed, watch, onWatcherCleanup } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const dept = ref(route.query.dept ?? '內科')
const date = ref(route.query.date ?? '2026-11-20')
const keyword = ref('')
const slots = ref([])
const status = ref('idle')                         // idle | loading | success | error

// 衍生值用 computed，不用 watch 抄
const available = computed(() => slots.value.filter((s) => s.left > 0))

// 條件一變就抓資料；immediate 讓第一次進頁面也抓
watch([dept, date], async ([d, dt]) => {
  const controller = new AbortController()
  onWatcherCleanup(() => controller.abort())       // 必須在第一個 await 之前
  router.replace({ query: { ...route.query, dept: d, date: dt } })   // 條件寫進網址，重新整理還在
  status.value = 'loading'
  try {
    const res = await fetch(`/api/slots?dept=${encodeURIComponent(d)}&date=${dt}`, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    slots.value = await res.json()
    status.value = 'success'
  } catch (err) {
    if (err.name === 'AbortError') return          // 被下一次觸發取消，不改畫面
    status.value = 'error'
  }
}, { immediate: true })

// 搜尋框：停止輸入 300 毫秒才搜尋
watch(keyword, (q) => {
  const timer = setTimeout(() => search(q), 300)
  onWatcherCleanup(() => clearTimeout(timer))      // 300 毫秒內又打字，取消上一次的計時
})

function search(q) {
  console.log('搜尋病患', q)
}
</script>
```

搜尋框這段用清理函式做 debounce：每打一個字觸發一次 callback，下一次觸發前清掉上一次的計時器，只有停下來 300 毫秒的那一次會送出。VueUse 的 `watchDebounced` 把同樣的事包成一個函式。

:::stop 讀到這裡可以先停：分得出 `watch`、`watchEffect` 與 `computed` 的用途，會用 `onWatcherCleanup` 取消上一次的請求。後面的 React 對照與錯誤訊息表，在讀 `useEffect` 的依賴陣列時再回來讀。

## React 對照

| Vue 3.5 | React 19 |
|---|---|
| `watch([dept, date], cb)` | `useEffect(() => { … }, [dept, date])` |
| 預設在來源第一次改變時才執行；`immediate: true` 建立時先跑 | 每次渲染後，依賴有變就執行，第一次渲染後一定會跑 |
| `onWatcherCleanup(fn)` | effect 回傳的清理函式 |
| `computed` | 在函式裡直接算；成本高才 `useMemo` |
| watcher 只在來源變化時觸發，callback 裡讀到的其他值不影響 | 依賴陣列要列出 effect 用到的所有值；React 19.2 的 `useEffectEvent` 處理「要讀最新值但不想因它重跑」 |

```jsx
import { useEffect, useState } from 'react'

export function SlotSearch({ dept, date }) {
  const [slots, setSlots] = useState([])
  const available = slots.filter((s) => s.left > 0)       // 衍生值直接算

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/slots?dept=${encodeURIComponent(dept)}&date=${date}`, { signal: controller.signal })
      .then((res) => res.json())
      .then(setSlots)
      .catch((err) => { if (err.name !== 'AbortError') console.error(err) })
    return () => controller.abort()                      // 依賴改變或卸載時取消
  }, [dept, date])

  return <p>可掛號 {available.length} 個時段</p>
}
```

React 文件〈You Might Not Need an Effect〉列的反模式，和 Vue 裡「用 watch 抄資料」是同一件事：能在渲染時算出來的，就不要放進副作用。

## 常見錯誤與錯誤訊息

| 訊息或現象 | 原因 | 修法 |
|---|---|---|
| `[Vue warn]: Invalid watch source: …` | 傳了 `state.count` 這種當下的值 | 改成 getter `() => state.count` |
| 編譯錯誤 `"date" is a destructured prop and should not be passed directly to watch(). Pass a getter () => date instead.` | Vue 3.5 解構出來的 prop 直接傳給 `watch` | 寫 `() => date` |
| 第一次進頁面沒有資料 | `watch` 預設不在建立時執行 | 加 `immediate: true`，或改用 `watchEffect` |
| 對陣列 `push` 後 callback 沒執行 | 監看 ref 時只比較 `.value` 本身 | 加 `deep: true`，或監看 `() => list.value.length` |
| 畫面顯示的是前一個條件的結果 | 舊請求比新請求晚回來 | `onWatcherCleanup` 裡 `abort()`，`catch` 略過 `AbortError` |
| `[Vue warn] onWatcherCleanup() was called when there was no active watcher to associate with.` | 寫在 `await` 之後 | 移到第一個 `await` 之前 |
| `Maximum recursive updates exceeded in component <SlotSearch>. This means you have a reactive effect that is mutating its own dependencies…` | callback 改了自己監看的來源 | 改成 computed，或確認只在條件成立時才寫入 |
| 換頁後 callback 還在執行 | watcher 在 `setTimeout` 或 `.then()` 裡建立 | 在 setup 裡同步建立，或保存停止函式並在 `onUnmounted` 呼叫 |

## 動手

1. 按上面模擬程式的「在 Playground 開啟」，把 `delay` 改成 `{ 內科: 100, 骨科: 200, 眼科: 500 }`，沒有清理的版本這次會顯示哪一科？再說明為什麼「回應順序不保證」比「哪一科最慢」更重要。
2. 在自己的專案寫 `watch(list, cb)` 再 `list.value.push(…)`，確認 callback 沒有執行；加上 `deep: true`，再改成監看 `() => list.value.length` 比較兩種寫法。
3. Network 分頁的節流選 `3G`，在預約查詢頁連續切三個科別，看前兩個請求變成 `(canceled)`；把 `onWatcherCleanup` 那一行註解掉再試一次。
4. [ReactivityLab](#/lab/ReactivityLab) 裡改科別時，看 watch 在渲染前觸發、computed 在渲染時重算的順序；用 computed 就夠的情況回到 [響應式](#/skill/reactivity)。

## 從一個具體問題開始：三千筆掛號，點一下卡半秒

「今日掛號清單」一開始只有幾十筆，後來整個院區合併成一頁，尖峰時段有 3,000 筆。櫃台反應三件事：

1. 打開頁面要等一兩秒才捲得動。
2. 點一列把它設為「目前選取」，要半秒左右才變色。
3. 在搜尋框打字，字一個一個慢慢出現。

用 DevTools 的 Performance 分頁加 `4× slowdown` 錄一次「點一列」，Main 軌道上有一個 480 毫秒的 task，上面畫著紅色三角形；展開來，大部分時間在 Vue 的 `patch`。再開 Vue 的效能標記看，一次點擊讓 3,000 個 `ClinicRow` 全部重新渲染了。

原因在這幾行：

```vue
<!-- 每一列都收到 selectedId，換選取時 3,000 列的 props 全部變了 -->
<ClinicRow
  v-for="row in rows"
  :key="row.id"
  :row="row"
  :selected-id="selectedId"
  @select="selectedId = row.id"
/>
```

```js
// 搜尋框每打一個字就重新篩選並排序 3,000 筆
watch(keyword, (q) => { visible.value = sortRows(filterRows(rows.value, q)) })
```

這一課處理頁面載入完成之後的卡頓：大量 DOM、不必要的重新渲染、觸發太頻繁的處理。載入階段的速度見 [Core Web Vitals](#/skill/web-vitals)，主執行緒為什麼一忙畫面就凍結見 [事件迴圈](#/skill/event-loop)。

## 運作原理

### 一次更新的成本從哪裡來

Vue 的一次更新大致是：響應式資料改變 → 找出依賴它的元件 → 每個元件重新執行 render 產生新的 virtual DOM → 和舊的比對（patch）→ 改真正的 DOM → 瀏覽器重新算樣式、版面、繪製。成本跟三個數字成正比：

| 數字 | 例子 | 降低的方法 |
|---|---|---|
| 渲染的 DOM 節點數 | 3,000 列 × 每列 12 個節點 = 36,000 個 | 分頁、虛擬捲動 |
| 每次更新要重新渲染的元件數 | 換一次選取，3,000 個 `ClinicRow` 全部更新 | 讓 props 穩定、`v-memo` |
| 每次觸發的工作量與頻率 | 每打一個字就篩選、排序一次 | debounce、throttle、把計算移出主執行緒 |

任何一個 task 超過 50 毫秒，DevTools 就把它標成長任務。長任務期間，點擊與輸入要排隊，畫面也停在原地，INP 跟著變差。

### 子元件什麼時候會重新渲染

Vue 的子元件在「收到的 props 有任何一個變了」時才更新。官方文件的 Props Stability 一節用的就是上面的例子：每一列都收 `selectedId`，`selectedId` 一變，3,000 列的 props 都變了。把比較移到父元件，只傳一個布林值：

```vue
<ClinicRow
  v-for="row in rows"
  :key="row.id"
  :row="row"
  :selected="row.id === selectedId"
  @select="selectedId = row.id"
/>
```

換選取時，只有原本選中的那列（`true` → `false`）和新選中的那列（`false` → `true`）的 props 變了，其他 2,998 列不更新。

同樣的道理也適用在 computed。Vue 3.4 起，computed 的值沒變就不觸發依賴它的更新；但如果 computed 每次都回傳新的物件或陣列，即使內容相同，Vue 也視為改變。

### 大量資料：分頁、虛擬捲動與 content-visibility

| 做法 | 怎麼做 | 適合 | 限制 |
|---|---|---|---|
| 伺服器分頁 | 一次只向 API 要 50 筆 | 多數管理介面 | 要翻頁；網址要記住頁數（見 [分頁、篩選與網址](#/skill/pagination-filter)） |
| 虛擬捲動 | 只渲染視窗內加前後幾列，捲動時重用 DOM | 要在同一個畫面連續捲動瀏覽 | Ctrl+F 找不到沒渲染的列；列高要固定或要量；鍵盤與螢幕閱讀器要另外處理 |
| `content-visibility: auto` | DOM 都在，視窗外的區塊跳過版面與繪製 | 長文件、區塊數量中等 | 只省渲染不省 DOM；只加在一開始就在視窗外的區塊；一定要配 `contain-intrinsic-size`，否則區塊在視窗外被當成 0 高度，捲軸會跳；要用鍵盤確認還走得到視窗外的內容；Baseline 2025（2025-09 起 Safari 也支援） |

虛擬捲動的原理：容器的總高度設成「筆數 × 列高」，讓捲軸看起來像全部都在；根據 `scrollTop` 算出目前該顯示第幾到第幾筆，只渲染這一小段，再用 `transform` 或 padding 把它們放到正確的位置。

```
捲軸總高度 = 3,000 × 48px = 144,000px
scrollTop = 24,000px → 第一筆可見的是第 500 筆
視窗高 600px → 一次看得到 13 列，前後各多渲染 5 列 → 實際只有 23 個 ClinicRow
```

Vue 官方文件列出 vue-virtual-scroller、vue-virtual-scroll-grid、vueuc 的 VVirtualList；另外常見的有 @tanstack/vue-virtual 與 VueUse 的 `useVirtualList`。

### 大量唯讀資料不需要深層響應式

`ref([...3000 筆])` 預設是深層響應式：每一筆、每個欄位都包成 Proxy，渲染時每讀一個欄位都要記錄依賴。從 API 拿回來、只會整批換掉的資料，用 `shallowRef`：

```js
import { shallowRef } from 'vue'

const rows = shallowRef([])

async function load() {
  rows.value = await fetchRows()            // 整個換掉：觸發更新
}
function markArrived(id) {
  // rows.value.find(...).status = '已報到' 不會觸發更新
  rows.value = rows.value.map((r) => (r.id === id ? { ...r, status: '已報到' } : r))
}
```

官方文件提醒這通常在「一次渲染要讀十萬個以上的屬性」時才看得出差別，先量再用。`v-memo` 與 `v-once` 也一樣：前者在指定的值沒變時跳過整個子樹，後者只渲染一次；它們解決的是量到的問題，不是預設寫法。

### debounce 與 throttle

| | debounce | throttle |
|---|---|---|
| 行為 | 停止觸發 N 毫秒後才執行一次 | N 毫秒內最多執行一次 |
| 適合 | 搜尋框送請求、輸入完才驗證 | 拖曳時存位置、連續觸發的事件要定時回報 |
| 連續觸發 5 秒的結果 | 只在最後執行一次 | 每 N 毫秒執行一次 |

和畫面同步的工作（例如拖曳時移動一個元素）用 `requestAnimationFrame`，每一格畫面最多做一次。

### 進出畫面與尺寸改變：交給 observer

AI 產出的「回到頂端」按鈕、無限捲動、圖表重繪，常寫成 `window.addEventListener('scroll', throttle(…))` 或 `resize` 監聽，每次觸發都呼叫 `getBoundingClientRect()` 算位置。這些需求瀏覽器有現成的 API，判斷交給瀏覽器、只在狀態改變時呼叫回呼：

| 需求 | 舊寫法 | 現在的寫法 | 支援 |
|---|---|---|---|
| 捲到底再載入下一頁、「回到頂端」何時出現 | throttle 的 `scroll` 監聽加 `getBoundingClientRect()` | `IntersectionObserver` 觀察清單尾端或頂端的標記元素 | Baseline Widely available（2019-03 起） |
| 容器變寬變窄時重排圖表 | `window` 的 `resize` 監聽 | `ResizeObserver` 觀察容器本身（側欄收合時視窗沒變，容器變了） | Baseline Widely available（2020-07 起） |
| 捲動停下來才做事 | `scroll` 加 debounce | `scrollend` 事件 | Baseline 2025（2025-12 起），舊瀏覽器退回 debounce |

```js
// 清單尾端放一個空的 <li class="sentinel">，它進入畫面時才載入下一頁
const io = new IntersectionObserver(([entry]) => {
  if (entry.isIntersecting) loadNextPage()
}, { rootMargin: '200px' })          // 離畫面還有 200px 就先載入
io.observe(document.querySelector('.sentinel'))
// 元件卸載時 io.disconnect()；VueUse 的 useIntersectionObserver 會自動處理
```

Chrome 團隊的 Modern Web Guidance 對「回到頂端」更進一步建議 CSS 的 scroll-state container query（`container-type: scroll-state`），完全不用 JavaScript；這個功能目前只有 Chrome、Edge 144 起支援（Limited availability），要先寫好「一直顯示」或 `IntersectionObserver` 的退路，不能當成唯一寫法。一定要在主執行緒跑完的大量計算（排序、統計），每做 50 毫秒就 `await` 讓出一次主執行緒，寫法見 [Core Web Vitals](#/skill/web-vitals) 的 INP 一節。

## 實際程式

### 用 vue-virtual-scroller 渲染三千筆

```vue
<script setup>
import { shallowRef, ref, computed } from 'vue'
import { RecycleScroller } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/index.css'
import { watchDebounced } from '@vueuse/core'

const rows = shallowRef([])          // 3,000 筆，從 API 整批拿回
const selectedId = ref(null)
const keyword = ref('')
const filtered = shallowRef([])

// 停止輸入 300 毫秒才篩選；輸入框本身立刻顯示打的字
watchDebounced(keyword, (q) => {
  filtered.value = q ? rows.value.filter((r) => r.name.includes(q)) : rows.value
}, { debounce: 300, immediate: true })
</script>

<template>
  <input v-model="keyword" type="search" aria-label="搜尋病患">
  <!-- 每列固定 48px；容器一定要有高度 -->
  <RecycleScroller
    class="list"
    :items="filtered"
    :item-size="48"
    key-field="id"
    v-slot="{ item }"
  >
    <ClinicRow :row="item" :selected="item.id === selectedId" @select="selectedId = item.id" />
  </RecycleScroller>
</template>

<style scoped>
.list { height: 600px; }
</style>
```

`RecycleScroller` 適合列高固定或事先知道的情況；列高要渲染後才知道時用 `DynamicScroller`（vue-virtual-scroller 3.0.5）。

### 找出誰重新渲染了

```js
// main.js：只在開發版有作用
const app = createApp(App)
if (import.meta.env.DEV) app.config.performance = true
```

打開後在 Performance 分頁錄一次操作，Timings 軌道會出現 `<ClinicRow> render`、`<ClinicRow> patch` 這類標記（名稱取自 Vue 原始碼的 `<元件名> 類型`），一眼看出一次點擊更新了幾個元件。Vue DevTools 的時間軸也有元件渲染的紀錄。

### debounce 與 throttle 的行為

下面兩個函式是最小的實作（正式專案用 VueUse 的 `useDebounceFn`、`useThrottleFn` 或 lodash-es），模擬一邊打字一邊捲動：

```js run
// debounce：停止觸發 wait 毫秒後才執行一次（最後一次的參數）
function debounce(fn, wait) {
  let timer
  const wrapped = (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
  wrapped.cancel = () => clearTimeout(timer)   // 元件卸載時呼叫
  return wrapped
}

// throttle：wait 毫秒內最多執行一次；期間的最後一次在時間到時補做
function throttle(fn, wait) {
  let last = -Infinity, timer, pending
  const wrapped = (...args) => {
    const now = Date.now()
    if (now - last >= wait) { last = now; fn(...args) }
    else {
      pending = args
      clearTimeout(timer)
      timer = setTimeout(() => { last = Date.now(); fn(...pending) }, wait - (now - last))
    }
  }
  wrapped.cancel = () => clearTimeout(timer)
  return wrapped
}

const t0 = Date.now()
const at = () => `${Math.round((Date.now() - t0) / 10) * 10}ms`
const search = debounce((q) => console.log(`[debounce] ${at()} 送出搜尋「${q}」`), 300)
const onScroll = throttle((y) => console.log(`[throttle] ${at()} 更新捲動位置 ${y}`), 100)

// 模擬：每 50 毫秒輸入一個字；同時每 20 毫秒觸發一次捲動，共 20 次
const word = '王小明內科'
let i = 0
const typing = setInterval(() => {
  i++
  search(word.slice(0, i))
  if (i === word.length) clearInterval(typing)
}, 50)
let n = 0
const scrolling = setInterval(() => {
  n++
  onScroll(n * 40)
  if (n === 20) { clearInterval(scrolling); console.log(`捲動事件 ${n} 次`) }
}, 20)
setTimeout(() => console.log(`輸入 ${word.length} 次`), 900)
```

20 次捲動事件只更新了 5 次左右；5 次輸入只送出 1 次搜尋，而且是完整的「王小明內科」。實際時間會因計時器的誤差差個幾毫秒。

## 常見錯誤與錯誤訊息

效能問題多半沒有錯誤訊息，要從 Performance 分頁與畫面的行為判斷：

| 現象 | 原因 | 修法 |
|---|---|---|
| 一次點擊產生幾百毫秒的長任務，大部分在 `patch` | 一個值改變讓整串列表重新渲染 | 把 `selectedId` 這類值換成每列的布林 props |
| 打開頁面就有很長的 `Recalculate style` 與 `Layout` | DOM 太多 | 分頁或虛擬捲動；Console 執行 `document.querySelectorAll('*').length` 看總數 |
| 輸入框打字一頓一頓 | 每次輸入都同步做重的篩選或排序 | debounce 篩選，輸入框本身維持即時 |
| Network 分頁每打一個字就一個請求 | 搜尋沒有 debounce | `watchDebounced` 或 `useDebounceFn`，並取消前一個請求（見 [取消請求與競態](#/skill/cancel-race)） |
| 虛擬捲動的清單捲動時跳動、出現空白 | `item-size` 和實際列高不同，或容器沒有高度 | 讓 CSS 的列高等於 `item-size`；容器設高度 |
| 用 Ctrl+F 找不到某位病患 | 虛擬捲動沒渲染視窗外的列 | 提供自己的搜尋框；這是虛擬捲動的已知限制 |
| 改了 `shallowRef` 陣列裡的欄位，畫面沒更新 | `shallowRef` 只追蹤 `.value` 被換掉 | 建立新陣列再指定給 `.value` |
| Performance 分頁錄一段捲動，Main 軌道上滿是 `Scroll` 事件的處理函式 | 用捲動事件判斷元素是否進入畫面 | 換成 `IntersectionObserver` 觀察標記元素 |
| 離開頁面後 Console 還有 debounce 的輸出 | 卸載時沒有取消還在等的計時器 | 在 `onUnmounted` 呼叫 `cancel()`；用套件時確認它在卸載時會不會自動取消 |
| 開了 `app.config.performance` 看不到標記 | 它只在開發版有作用 | 用 `npm run dev` 的頁面錄製 |

## 動手

1. 在自己的列表頁打開 Performance 分頁，CPU 選 `4× slowdown`，錄一次最常用的操作，找出紅色三角形的 task，展開 Bottom-Up 看前三名的函式。
2. 開發版設 `app.config.performance = true`，錄一次「換選取」，數 Timings 軌道上有幾個 `patch`；照「子元件什麼時候會重新渲染」改 props，再錄一次比較。
3. 按上面 `js run` 區塊的「在 Playground 開啟」，把 throttle 的 `wait` 改成 200、debounce 改成 100，看輸出的次數怎麼變。
4. 在 Console 執行 `document.querySelectorAll('*').length` 記下 DOM 節點數，換成虛擬捲動後再看一次。

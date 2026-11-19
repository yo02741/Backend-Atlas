## 從一個具體問題開始：按了「取消」，Drawer 也打開了

「我的掛號」頁的清單放在一個篩選表單裡，點一整列會打開右側的詳細資料 Drawer，每一列另有一顆「取消」按鈕：

```vue
<template>
  <form @submit="search">
    <input v-model="keyword" placeholder="搜尋病患姓名">
    <ul>
      <li v-for="a in appointments" :key="a.id" @click="openDetail(a.id)">
        <span>{{ a.time }} {{ a.patientName }}</span>
        <button @click="cancel(a.id)">取消</button>
      </li>
    </ul>
  </form>
</template>
```

使用者按「取消」，發生了三件事：

1. 取消的請求送出了，這是預期的。
2. Drawer 也跟著打開，顯示剛被取消的那一筆。
3. 一秒後整頁重新載入，網址多了 `?`，剛輸入的搜尋字不見了。

第 2 件來自事件的冒泡：按鈕上的 click 處理完之後，事件繼續往上傳到 `li`，`li` 的監聽也執行了。第 3 件來自瀏覽器的預設動作：`form` 裡沒寫 `type` 的 `button` 是送出鈕，click 之後瀏覽器把表單送出去。兩件事要用兩個不同的方法處理。

## 運作原理

### 傳遞路徑與三個階段

DOM 是一棵樹。使用者點了按鈕，瀏覽器先算出從 `window` 到按鈕的路徑，接著讓事件沿著這條路徑走一趟來回：

```
window
 └ document
    └ html › body
       └ form
          └ ul
             └ li
                └ button   ← target（被點到的元素）

① 捕獲（capture）：window → document → … → li         由外往內
② 目標（target）  ：button                              在被點的元素上
③ 冒泡（bubble）  ：li → ul → form → … → window        由內往外
```

每經過一個元素，就執行掛在這個元素、這個階段的監聽：

| 階段 | `event.eventPhase` | 執行哪些監聽 |
|---|---|---|
| 捕獲 | `1` | `addEventListener(type, fn, { capture: true })` |
| 目標 | `2` | 目標元素上的監聽（`capture: true` 的先執行） |
| 冒泡 | `3` | 一般的 `addEventListener(type, fn)`，也是 Vue `@click` 用的 |

大部分監聽在冒泡階段執行，所以「內層先、外層後」。捕獲階段用在需要比所有人都早看到事件的地方，例如記錄所有點擊的分析工具。

路徑在事件發出的那一刻就決定了。監聽裡把元素從 DOM 移走，事件照樣沿著原本的路徑傳完。

### `target` 與 `currentTarget`

- `event.target`：被點到的最內層元素，整趟傳遞都不變。按鈕裡有 `<svg>` 圖示時，點到圖示的話 `target` 就是那個 `<svg>`。
- `event.currentTarget`：目前執行的監聽掛在哪個元素上，每經過一個元素就換一次。

事件委派就靠這兩個的差別：監聽掛在 `ul` 上（`currentTarget` 是 `ul`），再從 `target` 往上找到被點的那一列。

### 預設動作

很多事件有瀏覽器自己會做的事，在所有監聽都跑完之後才執行；監聽裡呼叫 `preventDefault()` 就取消它：

| 事件 | 在哪裡 | 預設動作 |
|---|---|---|
| `click` | `<a href>` | 換到那個網址 |
| `click` | `form` 裡的送出鈕（含沒寫 `type` 的 `button`） | 送出表單 |
| `submit` | `<form>` | 依 `action` 與 `method` 送出並換頁 |
| `click` | checkbox、radio | 切換勾選（取消的話會恢復原狀） |
| `keydown` | 輸入框 | 輸入字元 |
| `wheel`、`touchmove` | 可捲動的區域 | 捲動 |
| `contextmenu` | 任何元素 | 跳出右鍵選單 |

`event.cancelable` 是 `false` 的事件（例如 `scroll`）呼叫 `preventDefault()` 沒有作用。

### 停止傳遞與取消預設，四種組合

回到開頭的按鈕，四種寫法的結果：

| 按鈕的處理函式裡 | 外層 `li` 的監聽 | 表單送出 |
|---|---|---|
| 什麼都不呼叫 | 執行（Drawer 打開） | 送出 |
| `stopPropagation()` | 不執行 | 照樣送出 |
| `preventDefault()` | 照樣執行 | 不送出 |
| 兩個都呼叫 | 不執行 | 不送出 |

`stopPropagation()` 只管事件還要不要傳給下一個元素，同一個元素上的其他監聽照樣執行；要連它們一起擋用 `stopImmediatePropagation()`。`preventDefault()` 只管預設動作，事件照樣往上冒泡，外層可以用 `event.defaultPrevented` 知道它被取消了。

### 不冒泡的事件

| 不冒泡 | 會冒泡的替代 | 用途 |
|---|---|---|
| `focus`、`blur` | `focusin`、`focusout` | 委派處理表單欄位的聚焦 |
| `mouseenter`、`mouseleave` | `mouseover`、`mouseout` | 委派處理 hover（要自己判斷有沒有真的離開） |
| 元素上的 `scroll` | 沒有 | 監聽要掛在會捲動的元素本身 |
| `<img>` 的 `load`、`error` | 沒有 | 掛在 `img` 上，或用捕獲階段在外層監聽 |

不冒泡的事件仍然有捕獲階段，所以在外層用 `{ capture: true }` 監聽得到。

Vue 元件用 `emit('cancel')` 送出的事件不是 DOM 事件，只送給直接使用這個元件的父元件，不會一路往上冒泡；要跨好幾層傳資料，用 props 與 emit 一層層接，或改用 `provide`／`inject` 或 store。

### `addEventListener` 的選項

```js
el.addEventListener('click', handler, {
  capture: false,   // true：在捕獲階段執行
  once: true,       // 執行一次後自動移除
  passive: true,    // 保證不呼叫 preventDefault()，瀏覽器可以不等它跑完就先捲動
  signal,           // 傳入 AbortController 的 signal，abort() 時自動移除
})
```

`passive` 用在 `touchstart`、`touchmove`、`wheel` 這類會擋住捲動的事件。Chrome 從 55 版起，掛在 `window`、`document`、`body` 上的 `touchstart`、`touchmove` 監聽預設就是 passive，`wheel` 從 73 版起也是。這些監聽裡呼叫 `preventDefault()` 會被忽略，Console 印出警告。

`signal` 選項在 Chrome 90、Firefox 86、Safari 15 起支援。一個元件加了好幾個監聽時，共用一個 `AbortController`，卸載時呼叫一次 `abort()` 就全部移除。

## 一段可以跑的模擬

下面照規範的順序（捕獲由外往內、冒泡由內往外，目標上的 capture 監聽先執行）寫了一個迷你版的 dispatch，用物件代替 DOM 元素，模擬開頭那個頁面：`document` 上有一個捕獲階段的記錄、`ul` 用事件委派打開 Drawer、按鈕執行取消。依序點按鈕（三種寫法）、列裡的文字、清單的空白處：

```js run
// 照 DOM 規範的順序寫的迷你版 dispatch：捕獲、目標、冒泡，加上 stopPropagation 與 preventDefault
function el(name, parent = null) { return { name, parent, listeners: [] } }
function on(node, label, fn, capture = false) { node.listeners.push({ label, fn, capture }) }
function closest(node, name) { for (let n = node; n; n = n.parent) if (n.name.startsWith(name)) return n; return null }

function dispatch(target) {
  const path = []
  for (let n = target; n; n = n.parent) path.unshift(n)          // [window, document, …, target]
  const ev = {
    target, currentTarget: null, eventPhase: 0, stopped: false, defaultPrevented: false,
    stopPropagation() { this.stopped = true },
    preventDefault() { this.defaultPrevented = true },
  }
  const PHASE = { 1: '捕獲', 2: '目標', 3: '冒泡' }
  const invoke = (n, capture) => {
    if (ev.stopped) return
    ev.currentTarget = n
    ev.eventPhase = n === target ? 2 : capture ? 1 : 3
    for (const l of n.listeners.filter((x) => x.capture === capture)) {
      console.log(`  ${PHASE[ev.eventPhase]}  ${n.name.padEnd(8)} ${l.label}`)
      l.fn(ev)
    }
  }
  for (const n of path) invoke(n, true)                        // 捕獲：由外往內（目標上的 capture 監聽也在這一輪）
  for (const n of [...path].reverse()) invoke(n, false)        // 冒泡：由內往外（目標上的一般監聽先執行）
  return ev
}

// 頁面：window > document > form > ul > li#12 > span、button「取消」
const win = el('window'), doc = el('document', win), form = el('form', doc)
const ul = el('ul', form), li = el('li#12', ul), span = el('span', li), btn = el('button', li)

function setup({ stop = false, prevent = false } = {}) {
  for (const n of [win, doc, form, ul, li, span, btn]) n.listeners = []
  on(doc, '記錄點擊（capture）', (e) => {}, true)
  on(ul, '委派：closest("li") → 打開 Drawer', (e) => {
    const row = closest(e.target, 'li')
    console.log(`           → closest 找到 ${row ? row.name : 'null'}${row ? '，打開詳細資料' : '，不處理'}`)
  })
  on(btn, '取消掛號', (e) => {
    if (stop) e.stopPropagation()
    if (prevent) e.preventDefault()
  })
}
function click(target, opts) {
  setup(opts)
  console.log(`點 ${target.name}  stopPropagation=${!!opts?.stop} preventDefault=${!!opts?.prevent}`)
  const ev = dispatch(target)
  const isSubmit = target === btn                                // form 裡沒寫 type 的 button 預設是 submit
  console.log(`  預設動作：${isSubmit ? (ev.defaultPrevented ? '已取消，表單不送出' : '送出表單，頁面重新載入') : '沒有'}\n`)
}

click(btn)                                   // 冒泡到 ul：Drawer 也打開了，表單還送出
click(btn, { stop: true })                   // 外層收不到，但表單照樣送出
click(btn, { stop: true, prevent: true })    // 兩件事都擋下
click(span)                                  // 點列裡的文字：target 是 span，closest 往上找到 li
click(ul)                                    // 點清單的空白處：closest 找不到 li
```

第二次點擊說明了最常見的誤解：`stopPropagation()` 讓 Drawer 不再打開，表單卻照樣送出。

## 實際程式碼

### 原生寫法：事件委派加上 `closest`

```html
<ul id="appointments">
  <li data-id="12">
    <span>09:30 王小明</span>
    <button type="button" class="cancel"><svg aria-hidden="true">…</svg>取消</button>
  </li>
  <!-- 其他列由程式加入 -->
</ul>
<script type="module">
  const list = document.querySelector('#appointments')
  list.addEventListener('click', (event) => {
    // target 可能是 svg 或 span：往上找到帶 data-id 的那一列
    const row = event.target.closest('li[data-id]')
    if (!row || !list.contains(row)) return          // 點到空白處
    const id = Number(row.dataset.id)
    if (event.target.closest('button.cancel')) {
      cancelAppointment(id)                           // 按鈕：只取消，不開 Drawer
      return
    }
    openDetail(id)                                     // 其他地方：打開 Drawer
  })
</script>
```

這個寫法沒有用到 `stopPropagation()`：外層自己判斷點的是按鈕還是列。`document` 上「點外面關閉選單」或分析工具的監聽照樣收得到這次點擊。按鈕寫了 `type="button"`，不會送出表單。

### Vue 寫法

```vue
<script setup>
import { ref, watch, onUnmounted } from 'vue'

const keyword = ref('')
const detailId = ref(null)
const appointments = ref([])

function search() { /* 呼叫 fetch，不換頁 */ }
function cancel(id) { /* POST /api/appointments/{id}/cancel */ }

// Drawer 打開時才監聽 Esc：用 AbortController 一次移除
let controller = null
watch(detailId, (id) => {
  controller?.abort()
  if (id == null) return
  controller = new AbortController()
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') detailId.value = null
  }, { signal: controller.signal })
})
onUnmounted(() => controller?.abort())
</script>

<template>
  <!-- @submit.prevent：取消瀏覽器送出表單的預設動作 -->
  <form @submit.prevent="search">
    <input v-model="keyword" placeholder="搜尋病患姓名">
    <ul>
      <li v-for="a in appointments" :key="a.id" @click="detailId = a.id">
        <span>{{ a.time }} {{ a.patientName }}</span>
        <!-- type="button"：不是送出鈕；.stop：不再冒泡到 li -->
        <button type="button" @click.stop="cancel(a.id)">取消</button>
      </li>
    </ul>
  </form>
</template>
```

Vue 的修飾符對應的原生寫法：

| Vue | 等於 |
|---|---|
| `@click.stop` | `event.stopPropagation()` |
| `@click.prevent` | `event.preventDefault()` |
| `@click.self` | 只在 `event.target === event.currentTarget` 時執行 |
| `@click.capture` | `{ capture: true }` |
| `@click.once` | `{ once: true }` |
| `@scroll.passive` | `{ passive: true }` |
| `@keydown.esc` | 只在 `event.key` 是 Escape 時執行 |

修飾符的順序有意義：`@click.prevent.self` 會取消元素與它所有子元素的預設動作，`@click.self.prevent` 只取消點在元素本身時的預設動作。`.passive` 與 `.prevent` 不要一起用。

模板上的 `@click` 在元件卸載時由 Vue 自動移除；自己在 `window`、`document` 上加的監聽，Vue 不會幫忙移除，上面用 `AbortController` 處理。

## 常見錯誤與錯誤訊息

| 錯誤訊息或現象 | 原因 | 修法 |
|---|---|---|
| 按列裡的按鈕，外層的動作也執行 | click 冒泡到外層的監聽 | 外層用 `event.target.closest()` 判斷，或按鈕加 `@click.stop` |
| 按了按鈕整頁重新載入，網址多了 `?` | `form` 裡的 `button` 預設是 `submit` | 按鈕加 `type="button"`，表單用 `@submit.prevent` |
| 加了 `stopPropagation()`，頁面還是重新載入 | 停止傳遞不會取消預設動作 | 另外呼叫 `preventDefault()` |
| Network 分頁出現 `/api/appointments/undefined/cancel` | 讀了 `event.target.dataset.id`，`target` 是按鈕裡的 `svg` 或 `span` | 改用 `closest('[data-id]')` 或 `currentTarget` |
| `Uncaught TypeError: Cannot read properties of null (reading 'addEventListener')` | `querySelector` 沒找到元素：script 比元素早執行，或選擇器打錯 | script 加 `defer`；Vue 裡改用 template ref 並在 `onMounted` 之後取用 |
| `removeEventListener` 之後監聽還在 | 傳入的不是同一個函式（匿名函式、每次 `.bind()` 產生的新函式），或 `capture` 值不同 | 把函式存在變數裡，或改用 `signal` |
| 同一個操作執行兩次 | 每次掛載都 `addEventListener`、卸載時沒移除 | `onUnmounted` 移除，或用 `AbortController` |
| `Unable to preventDefault inside passive event listener invocation.` | 在 `passive: true` 的監聽裡呼叫 `preventDefault()` | 拿掉 `passive`；只想禁止觸控捲動時改用 CSS 的 `touch-action` |
| `[Violation] Added non-passive event listener to a scroll-blocking 'touchstart' event. …` | Console 的 Verbose 層級提示，`touchstart` 監聽沒設 `passive` | 監聽裡不呼叫 `preventDefault()` 的話加 `{ passive: true }` |
| 點「外面關閉下拉選單」失效 | 某個元件在 click 上呼叫了 `stopPropagation()`，事件傳不到 `document` | 拿掉那個 `stopPropagation()`，改在外層判斷 `target` |

找不出是哪個監聽在動作時：Elements 選取元素，右側的 Event Listeners 分頁勾 `Ancestors`，列出它和所有祖先元素上綁的監聽，點檔名跳到程式碼；或在 Sources 分頁的 `Event listener breakpoints` 勾 Mouse 底下的 `click`，下一次點擊會停在第一個執行的監聽上。

## 動手

1. 打開 [事件傳遞實驗室](#/lab/EventPropagationLab)，點「取消」按鈕，逐步看事件經過哪些元素；依序打開 `stopPropagation()`、`preventDefault()`，對照「Drawer 打開了嗎」「表單送出了嗎」兩個結果。
2. 按上面模擬的「在 Playground 開啟」，在 `setup` 裡幫 `li` 加一個 `capture` 為 `true` 的監聽，看它在捕獲階段比按鈕先執行；再讓 `doc` 的記錄監聽呼叫 `e.stopPropagation()`，看後面所有監聽都不再執行。
3. 在任何一個網站的 Console 執行 `monitorEvents(document.body, 'click')`，點幾下頁面，看每次點擊的 `target`；結束時執行 `unmonitorEvents(document.body)`。
4. 在 Elements 選一個按鈕，Event Listeners 分頁勾 `Ancestors`，數一數一次點擊會經過多少個 `click` 監聽。
5. 接著讀 [Vue 的生命週期](#/skill/lifecycle)，看在 `window` 上加的監聽要在哪個鉤子移除。

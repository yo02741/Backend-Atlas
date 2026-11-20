## 從一個具體問題開始：刪掉一筆，備註跑到下一位病人身上

櫃台的預約清單每列有一個「備註」輸入框。早上櫃台人員在陳美華那一列打了「需要輪椅」，接著王小明打電話來取消，櫃台按了王小明那列的「取消」。清單少了一列，畫面上「需要輪椅」卻出現在林志明那一列。

清單是這樣寫的：

```vue
<li v-for="(a, index) in appointments" :key="index">
  {{ a.patientName }}
  <input placeholder="備註">
  <button type="button" @click="cancel(a.id)">取消</button>
</li>
```

`key` 用了陣列的 index。刪掉第 0 筆後，原本 index 1 的陳美華變成 index 0，Vue 依 key 判斷「key 0 的元素還在、內容換了」，於是重用原本第 0 列的 DOM，只把姓名換掉；輸入框裡使用者打的字屬於 DOM，不在資料裡，就留在原本的位置。最後一列（key 2）消失。

模板語法看起來像 HTML，背後的規則（運算式怎麼求值、元素何時重用、指令的先後）決定了這類 bug 會不會出現。

## 運作原理

### 模板會被編譯成 render 函式

`<template>` 不會原封不動放進頁面。`@vue/compiler-sfc` 把它編譯成一個 render 函式，每次渲染時執行，產生虛擬 DOM；Vue 比對新舊兩棵虛擬 DOM，只把差異套到真的 DOM 上。模板裡的 `{{ }}` 與指令的值都是 JavaScript 運算式，在元件的作用域求值，能讀 `<script setup>` 頂層的變數與函式。

只能寫單一運算式：`{{ a.time }}`、`{{ ok ? '是' : '否' }}`、`{{ list.length }}` 可以；`{{ if (ok) { … } }}`、`{{ const x = 1 }}` 會編譯失敗。

### 插值與 v-bind

- `{{ note }}` 把結果當文字放進去，`<`、`>` 會被跳脫，`<b>` 顯示成字面上的 `<b>`。
- `v-html="note"` 把字串當 HTML 插進去，不跳脫。字串來自使用者輸入或 API 時，`<img src=x onerror=…>` 這種內容會執行，造成 XSS。伺服器那一側的防線見 [XSS、CSRF 與安全標頭](#/skill/xss-csrf)。
- 屬性要綁資料用 `v-bind:href="url"`，簡寫 `:href="url"`。屬性裡寫 `{{ }}` 不會被求值，`id="{{ id }}"` 在 DOM 裡是字面上的 `{{ id }}`。
- 布林屬性：`:disabled="busy"` 在 `busy` 為 `false` 時整個屬性被拿掉。
- class 與 style 可以給物件或陣列：`:class="{ active: isActive, cancelled: a.status === 'cancelled' }"`、`:class="['badge', a.status]"`。
- Vue 3.4 起，屬性名與變數名相同時可以簡寫：`:id="id"` 寫成 `:id`。

### v-on 與修飾符

`v-on:click="handler"` 簡寫 `@click`。值可以是函式名（`@click="save"`，Vue 把事件物件當第一個參數傳進去），也可以是一個呼叫（`@click="cancel(a.id)"`）。

| 修飾符 | 效果 | 用在哪 |
|---|---|---|
| `.prevent` | 呼叫 `event.preventDefault()` | `<form @submit.prevent="save">`，避免整頁重新載入 |
| `.stop` | 呼叫 `event.stopPropagation()` | 列裡的按鈕，不想觸發整列的點擊 |
| `.once` | 只觸發一次 | 一次性的提示 |
| `.self` | 只有事件發生在元素本身時才觸發 | Dialog 的背景遮罩：點背景關閉，點內容不關 |
| `.enter`、`.esc` 等按鍵修飾符 | 只在按下特定鍵時觸發 | `@keyup.enter="search"` |

### v-if 與 v-show

| | `v-if` | `v-show` |
|---|---|---|
| 條件為假時 | 元素不在 DOM 裡 | 元素在，`style="display: none;"` |
| 子元件 | 被卸載，狀態歸零；再出現時重新建立，`onMounted` 再跑一次 | 一直存在，狀態保留 |
| 成本 | 切換時建立或銷毀 | 初次渲染就建立；切換只改樣式 |
| 限制 | 可以接 `v-else-if`、`v-else`，可以用在 `<template>` | 不能用在 `<template>`，沒有 `v-else` |

很少出現或條件一開始就不成立的區塊用 `v-if`；頻繁開關、要保留裡面輸入值的區塊（篩選面板）用 `v-show`。

### v-for 與 key

Vue 更新列表時，用 `key` 配對新舊元素：key 相同就重用並更新內容，新的 key 建立新元素，消失的 key 移除元素。沒有 `key` 時，Vue 依位置就地更新，效果和用 index 一樣。

下面這段模擬「依 key 重用元素」，比較 key 用 index 與用 id 時，刪掉第一筆後每個輸入框裡留著誰的備註：

```js run
// 示意：依 key 重用舊元素。typed 代表使用者打在輸入框裡的字，屬於 DOM，不在資料裡
const before = [
  { id: 11, name: '王小明' },
  { id: 12, name: '陳美華' },
  { id: 13, name: '林志明' },
]
const after = before.slice(1)   // 王小明取消了

function patch(oldList, newList, keyOf) {
  const elements = oldList.map((item, i) => ({ key: keyOf(item, i), typed: `給${item.name}的備註` }))
  return newList.map((item, i) => {
    const reused = elements.find((el) => el.key === keyOf(item, i))   // 找得到就重用，保留輸入框的字
    return { label: item.name, typed: reused ? reused.typed : '' }
  })
}

console.log('key 用 index：')
for (const r of patch(before, after, (_, i) => i)) console.log(`  ${r.label}｜輸入框：${r.typed}`)
console.log('key 用 id：')
for (const r of patch(before, after, (item) => item.id)) console.log(`  ${r.label}｜輸入框：${r.typed}`)
```

用 index 時，陳美華那列的輸入框留著「給王小明的備註」；用 id 時每列都對。同樣的錯位會發生在子元件的內部狀態（展開或收合、正在編輯）、CSS 轉場與焦點上。key 要穩定（同一筆資料每次都一樣）且在同一個列表裡唯一，資料的 id 最合適；`Math.random()` 每次渲染都不同，等於每次都重建整個列表。

### v-if 與 v-for 不放在同一個元素

同一個元素同時有 `v-for` 與 `v-if` 時，Vue 3 先執行 `v-if`，這時 `v-for` 的變數還不存在（Vue 2 的順序相反）。編譯出來的 render 函式長這樣（節錄）：

```js
return (a.active)                                  // 先判斷 v-if，這時還沒有 a
  ? (_openBlock(true), _createElementBlock(_Fragment, { key: 0 }, _renderList(list, (a) => { … })))
  : _createCommentVNode("v-if", true)
```

要篩選就先用 computed 算好，要整個列表有條件地出現就把 `v-if` 放外層：

```vue
<!-- 篩選：用 computed -->
<li v-for="a in activeAppointments" :key="a.id">{{ a.patientName }}</li>

<!-- 整個列表有條件：v-if 放外層的 <template> 或容器 -->
<template v-if="showList">
  <li v-for="a in appointments" :key="a.id">{{ a.patientName }}</li>
</template>
```

## 實際程式：預約清單的模板

```vue
<script setup>
import { ref, computed } from 'vue'

const props = defineProps({ appointments: { type: Array, required: true } })
const emit = defineEmits(['cancel', 'save-note'])

const showFilters = ref(false)
const hideCancelled = ref(true)
const cancellingId = ref(null)

// 篩選放 computed，不在 <li> 上寫 v-if
const visible = computed(() =>
  hideCancelled.value ? props.appointments.filter((a) => a.status !== 'cancelled') : props.appointments,
)
</script>

<template>
  <button type="button" :aria-expanded="showFilters" @click="showFilters = !showFilters">篩選</button>

  <!-- 頻繁開關、要保留勾選狀態：v-show -->
  <fieldset v-show="showFilters">
    <label><input v-model="hideCancelled" type="checkbox"> 隱藏已取消</label>
  </fieldset>

  <p v-if="visible.length === 0">沒有符合條件的預約</p>
  <ul v-else>
    <li v-for="a in visible" :key="a.id" :class="['row', a.status]">
      <span>{{ a.time }}</span>
      <span>{{ a.patientName }}</span>
      <!-- 使用者輸入的備註當純文字顯示，不用 v-html -->
      <input :value="a.note" placeholder="備註" @change="emit('save-note', a.id, $event.target.value)">
      <button
        type="button"
        :disabled="cancellingId === a.id || a.status !== 'booked'"
        @click.stop="emit('cancel', a.id)"
      >取消</button>
    </li>
  </ul>
</template>
```

`$event` 是模板裡拿到原生事件物件的寫法。`emit('save-note', …)` 的事件名用 kebab-case，父元件寫 `@save-note` 監聽。

:::stop 讀到這裡可以先停：會用插值、`v-bind`、`v-on`、`v-if`、`v-show` 與帶 key 的 `v-for` 寫出清單。後面的 React 對照與錯誤訊息表，在讀 JSX 或遇到模板警告時再回來讀。

## React 對照

| Vue 模板 | React JSX |
|---|---|
| `{{ a.patientName }}` | `{a.patientName}` |
| `:href="url"`、`:disabled="busy"` | `href={url}`、`disabled={busy}` |
| `:class="{ active: isActive }"` | `className={isActive ? 'active' : ''}` |
| `@click="cancel(a.id)"` | `onClick={() => cancel(a.id)}` |
| `@submit.prevent="save"` | `onSubmit={(e) => { e.preventDefault(); save() }}` |
| `v-if` ／ `v-else` | `cond ? <A /> : <B />` 或 `cond && <A />` |
| `v-show` | `style={{ display: open ? '' : 'none' }}` 或 `hidden` 屬性 |
| `v-for="a in list" :key="a.id"` | `list.map((a) => <li key={a.id}>…</li>)` |
| `v-html="html"` | `dangerouslySetInnerHTML={{ __html: html }}` |

React 的 `key` 規則與 Vue 相同：用穩定的 id，不用 index。JSX 裡寫 `{count && <Badge />}`，`count` 為 `0` 時會在畫面上印出 `0`；Vue 的 `v-if="count"` 沒有這個問題。

## 常見錯誤與錯誤訊息

| 訊息或現象 | 原因 | 修法 |
|---|---|---|
| `[Vue warn]: Property "a" was accessed during render but is not defined on instance.` 接著 `TypeError: Cannot read properties of undefined (reading 'active')` | 同一個元素寫了 `v-for` 與 `v-if`，`v-if` 先執行 | 篩選用 computed，或把 `v-if` 移到外層 |
| `[Vue warn]: Duplicate keys found during update: 12 Make sure keys are unique.` | 兩筆資料的 key 相同（例如用了會重複的 `patientId`） | 用唯一的欄位（預約 id） |
| 編譯錯誤 `<template v-for> key should be placed on the <template> tag.` | `<template v-for>` 的 key 寫在子元素上 | 把 `:key` 搬到 `<template>` |
| 編譯錯誤 `v-else/v-else-if has no adjacent v-if or v-else-if.` | `v-else` 和 `v-if` 中間隔了別的元素 | 讓它們相鄰 |
| DOM 裡出現 `id="{{ id }}"` | 屬性裡用了插值 | 改成 `:id="id"` |
| 請求網址變成 `/api/appointments/[object PointerEvent]/cancel`（Chrome） | 寫成 `@click="cancel"`，事件物件被當成 id 傳進去 | 寫 `@click="cancel(a.id)"` |
| 送出表單後整頁重新載入、輸入的資料不見 | `<form @submit="save">` 沒有 `.prevent` | `@submit.prevent="save"` |
| 刪除或排序後輸入框內容、展開狀態對錯列 | `key` 用 index 或沒寫 | 用資料的 id |
| 備註欄輸入 HTML 後被執行 | 用 `v-html` 顯示使用者內容 | 改成 `{{ }}`；一定要顯示 HTML 時先在伺服器或用 DOMPurify 這類函式庫過濾 |

eslint-plugin-vue 的 `flat/essential` 與 `flat/recommended` 會抓到其中幾項：`vue/require-v-for-key`、`vue/no-use-v-if-with-v-for`、`vue/valid-v-for`；`vue/no-v-html` 在 `flat/recommended`。

## 動手

1. 按上面 key 模擬的「在 Playground 開啟」，把 `after` 改成 `[before[2], before[0], before[1]]`（排序），比較兩種 key 的結果。
2. 在自己的 Vue 專案貼上本課開頭的清單，在第二列輸入框打字後刪掉第一筆，重現錯位；把 `:key` 改成 `a.id` 再試一次。
3. 在同一個 `<li>` 上加 `v-if="a.status !== 'cancelled'"`，看 Console 的警告與錯誤；改成 computed 後確認消失。
4. 把篩選面板的 `v-show` 改成 `v-if`，勾選後收合再打開，看勾選狀態有沒有保留；在 Elements 分頁比較兩者的 DOM。
5. 接著讀 [生命週期](#/skill/lifecycle)：`v-if` 讓子元件卸載時，它的 `onUnmounted` 會執行。

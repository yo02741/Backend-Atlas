## 從一個具體問題開始：找醫師的下拉選單只能用滑鼠

掛號頁原本用原生 `<select>` 選醫師。設計稿改版後要求每個選項顯示醫師照片與專長，於是改成用 `div` 畫的下拉選單。改版後的回報：

- 用鍵盤的使用者 Tab 不到它；就算點開了，方向鍵也沒反應。
- 螢幕閱讀器只念「群組」，不知道這是一個可以選的欄位，也不知道目前選了誰。
- 同一頁的「病患姓名」搜尋改成邊打邊查，每打一個字送一次請求。網路慢的時候，清單先顯示「王小明」的結果，一秒後被「王」的結果蓋掉。
- 日期欄位自己做了一個日曆，送出的日期偶爾比畫面上早一天。

選擇類元件的外觀容易做，難的是鍵盤操作、焦點與 ARIA 屬性，以及資料怎麼來。描述需求時把這幾項寫出來，驗收時逐項切過。

## 運作原理

### 五種元件的差別

| 元件 | 能不能輸入 | 能選幾個 | 選項從哪裡來 | 原生元素 | 門診系統的例子 |
|---|---|---|---|---|---|
| Select | 不能 | 一個 | 固定清單 | `<select>` | 科別 |
| Combobox（可輸入） | 能，用來篩選 | 一個 | 一次載入的清單 | 沒有完整對應 | 看診醫師 |
| Autocomplete | 能 | 一個 | 邊打邊查 API | 沒有 | 病患姓名 |
| Multi-select | 視設計 | 多個 | 固定或查 API | `<select multiple>`（少用） | 過敏藥物 |
| Date picker | 視設計 | 一個日期 | 日曆 | `<input type="date">` | 看診日期 |

`<datalist>` 可以替 `<input>` 提供建議清單，但到 2026-11 依 web-features 的資料還不是 Baseline（Android 版 Firefox 不支援），外觀也幾乎不能調整，正式畫面少用。

WAI-ARIA APG 把這幾種都歸在 Combobox 模式底下：一個輸入元件加一個彈出層，彈出層可以是 listbox、grid、tree 或 dialog。不能輸入、只能從清單選的叫 select-only combobox，行為和原生 `<select>` 相近；可以輸入的叫 editable combobox。

### Combobox 的組成

```text
<label for="doctor">看診醫師</label>
<input id="doctor"
       role="combobox"                    ← 這個元素一直拿著 DOM 焦點
       aria-expanded="true"               ← 清單開著
       aria-controls="doctor-list"        ← 清單是哪個元素
       aria-autocomplete="list"           ← 清單會依輸入的字篩選
       aria-activedescendant="doc-3">     ← 目前反白的選項
<ul id="doctor-list" role="listbox">
  <li id="doc-1" role="option">王醫師</li>
  <li id="doc-3" role="option" aria-selected="true">林醫師</li>   ← 反白（選取跟著焦點）
</ul>
```

幾個重點（出自 APG 的 Combobox 模式）：

- DOM 焦點一直留在輸入框，使用者可以繼續打字。清單裡的反白是「視覺焦點」，用 `aria-activedescendant` 告訴輔助科技。
- 清單關著時 `aria-expanded="false"`，開著時 `"true"`；`aria-controls` 指向清單。
- 彈出層是 listbox 時不用另外寫 `aria-haspopup`，`combobox` 角色預設就是 listbox。
- 輸入框、彈出按鈕、清單裡的選項之中，只有輸入框在 Tab 順序裡。

### 鍵盤操作

依 APG 的 Combobox 模式（標「選用」的是 APG 列為 optional 的行為）：

| 按鍵 | 焦點在輸入框時 | 焦點在清單時 |
|---|---|---|
| ↓ | 開啟清單並移到第一個選項 | 移到下一個選項 |
| ↑ | （選用）移到最後一個選項 | 移到上一個選項 |
| Enter | 可輸入的版本：接受反白的建議 | 選取反白的選項並關閉清單 |
| Esc | 關閉清單；（選用）清單本來就關著時清空輸入 | 關閉清單，焦點回輸入框 |
| Alt + ↓ | （選用）只開清單，不移動焦點 | |
| Alt + ↑ | | （選用）關閉清單，焦點回輸入框 |
| Home、End | | （選用）第一個、最後一個選項 |
| 一般字元 | 可輸入的版本：打字並篩選 | 回到輸入框繼續打字 |

APG 的 select-only combobox 範例還有兩個細節：清單關著時按 ↓、Enter 或 Space 都只開清單、不改變選取；清單開著時按 Tab 會選取反白的選項、關閉清單並移到下一個元素。範例頁也註明，原生 `<select>` 在 Tab 時只關清單、焦點不動，範例刻意和其他 Combobox 一致。

Esc 只關清單不改值，這點和 listbox 不同：APG 指出 Combobox 讓使用者可以用方向鍵瀏覽選項、按 Esc 放棄，原本的選擇不變。

### Autocomplete 的請求

Autocomplete 每一次輸入都可能變成一個請求，規格要寫清楚：

| 項目 | 寫法範例 |
|---|---|
| debounce | 停止輸入 250 ms 後才查詢 |
| 最少字數 | 至少 1 個中文字或 2 個英數字才查 |
| 取消舊請求 | 新請求送出前 `abort()` 前一個 |
| 載入中 | 清單第一列顯示「搜尋中…」，`aria-busy="true"` |
| 查無結果 | 清單顯示「沒有符合的病患」，不直接關閉清單 |
| 錯誤 | 清單顯示「搜尋失敗，稍後再試」，不顯示成查無結果 |

沒有取消舊請求時，三個請求同時在跑，最後回來的那一個決定畫面，和使用者最後打的字不一定一致。時間線與 `AbortController` 的寫法見 [取消請求與競態](#/skill/cancel-race)。

### Multi-select

選中的值通常顯示成輸入框裡的 Tag（Chip），每個 Tag 有一個移除按鈕。規格要寫：

- Tag 的移除按鈕的名稱（`aria-label="移除 盤尼西林"`），以及移除後焦點去哪（下一個 Tag 或輸入框）。
- 清單裡已選的選項怎麼表示：打勾並加 `aria-selected="true"`，清單加 `aria-multiselectable="true"`。
- 選項不多（例如 6 個常見過敏藥）時，一組 Checkbox 比 Multi-select 好用：全部攤開，一眼看得到選了什麼。

### Date picker

`<input type="date">` 是 Baseline 2021，桌機與手機都會跳出系統的日期選擇介面。幾個常被誤會的地方：

- `value` 有值時一定是 `2026-11-20` 這種格式（沒選是空字串），和畫面依語系顯示的格式（`2026/11/20`、`11/20/2026`）無關。
- `min`、`max` 限制可選範圍，但使用者仍可能用鍵盤輸入範圍外的日期，送出時瀏覽器的驗證會擋；用 `novalidate` 自己驗證時要自己檢查。
- 用 JavaScript 打開日曆的 `showPicker()` 到 2026-11 還不是 Baseline。

自己做日期選擇器時，APG 的 Date Picker Dialog 範例是一個按鈕開一個 modal Dialog，裡面是日曆格：方向鍵移動一天或一週、Home 與 End 到這週的第一天與最後一天、Page Up 與 Page Down 換月、Shift 加 Page Up 與 Page Down 換年，Enter 或 Space 選取並關閉，Esc 關閉並把焦點還給按鈕。

日期在 JavaScript 裡還有一個時區陷阱：只有日期的字串（`'2026-11-20'`）被當成 UTC 午夜解析，帶時間但沒有時區的字串（`'2026-11-20T00:00'`）被當成當地時間。在 UTC 以西的時區，前者用當地時間顯示會變成前一天。

```js run
// 只有日期：當成 UTC 午夜
const a = new Date('2026-11-20')
// 有時間、沒有時區：當成執行環境的當地時間
const b = new Date('2026-11-20T00:00')

console.log('a 的 UTC 時間：', a.toISOString())
console.log('b 的 UTC 時間：', b.toISOString())
console.log('執行環境和 UTC 差幾分鐘：', b.getTimezoneOffset())

// 用當地時間讀日期：UTC 以西的時區，a 會變成 19 日
console.log('a 的當地日期：', a.getDate(), '日')

// <input type="date"> 的值直接當字串送給 API，不轉成 Date 再轉回來
const fromInput = '2026-11-20'
console.log('送給 API：', JSON.stringify({ date: fromInput }))
```

輸出的第二、三行依執行環境的時區而不同。台灣是 UTC+8，`getTimezoneOffset()` 回傳 `-480`，`b` 的 UTC 時間是前一天的 16:00。

## 實際程式

一個可輸入的 Combobox（列表篩選、手動選取），照 APG 的 Editable Combobox with List Autocomplete 簡化：

```vue
<script setup>
import { ref, computed, useId } from 'vue'

const props = defineProps({ doctors: { type: Array, required: true } })   // [{ id, name, dept }]
const model = defineModel()           // 已選的醫師 id

const id = useId()                    // Vue 3.5：產生不重複的 id 前綴
const query = ref('')
const open = ref(false)
const active = ref(-1)                // 反白的選項索引，-1 表示沒有

const filtered = computed(() =>
  props.doctors.filter((d) => d.name.includes(query.value.trim())))
const activeId = computed(() =>
  active.value >= 0 ? `${id}-opt-${filtered.value[active.value].id}` : undefined)

function onKeydown(e) {
  if (e.isComposing || e.keyCode === 229) return   // 注音、倉頡組字中的按鍵交給輸入法
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (!open.value) { open.value = true; active.value = 0; return }
    active.value = Math.min(active.value + 1, filtered.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    active.value = Math.max(active.value - 1, 0)
  } else if (e.key === 'Enter' && open.value && active.value >= 0) {
    e.preventDefault()                // 清單開著時 Enter 選取，不送出表單
    pick(filtered.value[active.value])
  } else if (e.key === 'Escape') {
    open.value = false                // 只關清單，已選的值不變
    active.value = -1
  }
}

function pick(doc) {
  model.value = doc.id
  query.value = doc.name
  open.value = false
  active.value = -1
}
</script>

<template>
  <label :for="`${id}-input`">看診醫師</label>
  <input :id="`${id}-input`" v-model="query" role="combobox" autocomplete="off"
         :aria-expanded="open" :aria-controls="`${id}-list`"
         aria-autocomplete="list" :aria-activedescendant="open ? activeId : undefined"
         @input="open = true; active = -1" @keydown="onKeydown" @blur="open = false">
  <ul v-show="open" :id="`${id}-list`" role="listbox" aria-label="醫師">
    <li v-for="(d, i) in filtered" :id="`${id}-opt-${d.id}`" :key="d.id"
        role="option" :aria-selected="i === active"
        :class="{ active: i === active }"
        @mousedown.prevent="pick(d)">
      {{ d.name }}（{{ d.dept }}）
    </li>
  </ul>
  <!-- live region 一直在 DOM 裡，只換文字；查無結果時念出來，畫面上也看得到 -->
  <p role="status" class="combo-status">{{ open && filtered.length === 0 ? '沒有符合的醫師' : '' }}</p>
</template>
```

- 用注音或倉頡輸入時，組字中的按鍵也會觸發 `keydown`。各瀏覽器送出的值不一致（`key` 可能是 `Process` 或 `Enter`，部分版本的 Safari 在選字的 Enter 上 `isComposing` 已經是 `false`），沒擋住時按 Enter 選字會同時選走反白的選項；常見的保險寫法是同時檢查 `isComposing` 與 `keyCode === 229`，驗收時用注音實際打一次。`v-model` 在組字結束（`compositionend`）後才更新 `query`，清單在選完字之後才開始篩選。
- `@mousedown.prevent` 讓點選項時輸入框不會先失去焦點（否則 `blur` 先把清單關掉，`click` 永遠點不到）。
- `aria-activedescendant` 只在清單開著時設定；指到的 id 一定要存在於 DOM。
- 查無結果的訊息放在一直存在的 `role="status"` 裡，不塞一個假的選項進 listbox。
- `.active` 是視覺焦點的樣式，要有和背景 3:1 以上的對比，不能只靠很淡的底色。

:::stop 讀到這裡可以先停：會分辨五種選擇類元件，照 APG 做出焦點留在輸入框的 Combobox。後面的 Autocomplete 請求在選項要邊打邊查 API 時再回來讀。

Autocomplete 的查詢部分，debounce 與取消舊請求：

```js
let timer = null
let controller = null

watch(query, (q) => {
  clearTimeout(timer)
  if (q.trim().length < 1) { options.value = []; return }   // 最少字數
  timer = setTimeout(() => search(q), 250)                    // debounce 250 ms
})

async function search(q) {
  controller?.abort()                  // 取消前一個還沒回來的請求
  controller = new AbortController()
  status.value = 'loading'
  try {
    const res = await fetch(`/api/patients?q=${encodeURIComponent(q)}`, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    options.value = await res.json()
    status.value = options.value.length ? 'success' : 'empty'
  } catch (err) {
    if (err.name !== 'AbortError') status.value = 'error'   // 被取消的不算錯誤
  }
}
```

## 常見錯誤

- **用 `div` 畫的下拉選單沒有角色**：Accessibility 窗格的 Role 是 `generic`，螢幕閱讀器不知道能選。補 `role="combobox"`、`role="listbox"`、`role="option"`，或換回原生 `<select>`。
- **`aria-expanded` 沒跟著變**：清單開了，屬性還是 `false`；在 Elements 分頁開關清單時看屬性有沒有閃一下。
- **`aria-activedescendant` 指到不存在的 id**：選項用 `v-if` 重繪後 id 變了，屬性還指著舊的。
- **把焦點移進清單**：每個選項 `tabindex="0"` 並呼叫 `focus()`，使用者打不了字，Tab 也會一格一格走過選項。
- **Enter 送出了表單**：清單開著時按 Enter 選取選項，沒有 `preventDefault()`，表單跟著送出。
- **blur 搶先關清單**：用滑鼠點選項時沒反應，原因是 `blur` 先執行把清單收掉了。
- **查無結果時清單直接消失**：使用者不知道是沒有結果還是壞了。
- **Autocomplete 的錯誤顯示成查無結果**：API 回 500 時清單顯示「沒有符合的病患」，櫃台以為這個人沒有病歷。
- **日期送出前轉成 `Date`**：`new Date('2026-11-20').toISOString()` 在 UTC 以西的時區前後轉換會差一天；只有日期的值直接用字串。

AI 產生的自訂下拉選單，最常見的是只寫了滑鼠點擊：沒有角色、沒有 `aria-expanded`、方向鍵沒反應。描述需求時直接寫「照 WAI-ARIA APG 的 Combobox 模式」，並列出上面那張鍵盤表。

## 動手

1. 打開 [互動狀態實驗室](#/lab/UiStatesLab)，選「下拉選單」，切過開啟、反白選項、已選、停用與錯誤，對照每個狀態下 `aria-expanded`、`aria-activedescendant`、`aria-selected` 的值；在舞台上的下拉選單用 ↓、↑、Enter、Esc 操作一次。
2. 跑上面的日期程式，把 `'2026-11-20'` 改成 `'2026-11-20T00:00+08:00'`，比較 `toISOString()` 的結果。
3. 在自己的專案找一個自訂下拉選單，只用鍵盤操作一次，記下哪幾個按鍵沒有反應。
4. 用 Network 分頁的節流（`3G`）測 Autocomplete：快速打三個字，數 `Fetch/XHR` 的請求數，確認最後的清單和輸入框一致。
5. 選項很多、需要分頁或虛擬捲動時，清單本身的顯示方式接著讀 [資料顯示元件](#/skill/data-display)。

## 從一個具體問題開始：排序只排了這一頁

內科 101 診的今日預約有 134 筆，表格每頁 20 筆。護理師按「時間」排序，想找最晚的那一位，第一列是 11:40。可是第 6 頁還有一位 16:20 的加號病人。表格的排序寫成 `items.value.sort(…)`，前端手上只有這一頁的 20 筆，排序只在這 20 筆裡排。

同一張表格還有其他問題：

- 表格是用 `div` 加 CSS Grid 排出來的。螢幕閱讀器使用者聽到一串「09:00 王○明 已報到 09:15 陳○華 候診…」，不知道哪個值屬於哪一欄。
- 狀態只用顏色區分：綠色是已報到、橘色是候診。色覺障礙的護理師分不出來。
- 全選框只有勾與不勾兩種。勾了三列之後，全選框看起來和完全沒勾一樣。
- 在手機上整頁都可以左右滑，連頁首也跟著滑出畫面。

資料顯示元件要先決定用哪一種（Table、List、Card），再把每一欄、每個互動的範圍講清楚：排序與篩選在哪裡做、勾選選到哪些資料、手機上怎麼排。

## 運作原理

### Table、List、Card 怎麼選

| 元件 | 適合 | 不適合 | 門診系統的例子 |
|---|---|---|---|
| Table | 要沿著欄位比較、排序、批次操作 | 每筆內容長、有圖片 | 今日預約、檢驗結果 |
| List | 一欄逐筆瀏覽，每筆一兩行 | 要比較很多欄位 | 候診名單、通知 |
| Card | 一筆資料有幾個欄位加一個主要動作、可能有圖片 | 要逐欄比較 | 醫師介紹、診間看板 |

判斷的問題是：使用者會不會「往下掃一欄」比較？會的話用 Table。

### 表格的結構

```html
<table>
  <caption>11/20 內科 101 預約</caption>
  <thead>
    <tr>
      <th scope="col" aria-sort="ascending"><button type="button">時間</button></th>
      <th scope="col">病歷號</th>
      <th scope="col"><button type="button">姓名</button></th>
      <th scope="col">狀態</th>
      <th scope="col"><span class="visually-hidden">操作</span></th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>09:00</td><td>A00123</td><td>王○明</td>
      <td><span class="badge done">✓ 已報到</span></td>
      <td><button type="button">詳細</button></td>
    </tr>
  </tbody>
</table>
```

- `<caption>` 是表格的名稱，螢幕閱讀器進入表格時會念。
- `<th scope="col">` 讓每一格知道自己屬於哪一欄；在表格裡移動時，螢幕閱讀器會先念欄名再念值。
- 原生 `<table>` 優先。APG 的 Table 模式也強烈建議盡量用原生元素，ARIA 的 `role="table"` 是給沒辦法用原生表格的情況。
- APG 區分 table 與 grid：table 是靜態結構，格子不能聚焦，裡面的按鈕各自是一個 Tab 停留點；grid 是互動元件，用方向鍵在格子間移動。每列有好幾個按鈕、Tab 停留點多到難以操作時，才考慮 grid。

### 排序

APG 的 Sortable Table 範例：可排序的欄把表頭文字包在 `<button>` 裡，目前排序的那一欄設 `aria-sort`，值是 `ascending` 或 `descending`；換排序欄時，把舊欄的 `aria-sort` 拿掉，設到新的那一欄。不能排序的欄沒有按鈕。

排序在哪裡做，看資料在哪裡：

| 情況 | 排序在哪 | 網址 |
|---|---|---|
| 全部資料一次載入（例如 50 筆以內） | 前端 | 可以寫進 query，重新整理後還在 |
| 有分頁 | API（`?sort=time&order=desc&page=1`） | 寫進 query |
| 有虛擬捲動、資料很多 | API | 寫進 query |

換排序或篩選時，頁碼回到第 1 頁。

前端排序要注意空值與型別：時間字串 `'09:00'` 可以直接比字串，金額要比數字；空值統一排在最後，不要讓 `null` 被當成字串 `'null'` 排進中間。下面這段比較「只排這一頁」與「排全部」的差別：

```js run
// 134 筆中的示意資料：第 1 頁 3 筆、其他頁 2 筆（一筆沒有時間，是現場掛號待排）
const page1 = [
  { time: '09:00', name: '王○明' },
  { time: '11:40', name: '陳○華' },
  { time: '10:15', name: '林○明' },
]
const otherPages = [
  { time: '16:20', name: '張○婷' },
  { time: null, name: '李○安' },
]

// 依時間排序：空值一律排最後，方向只影響有值的部分
function byTime(order) {
  return (a, b) => {
    if (a.time === b.time) return 0
    if (a.time === null) return 1
    if (b.time === null) return -1
    return order === 'asc' ? a.time.localeCompare(b.time) : b.time.localeCompare(a.time)
  }
}

const onlyThisPage = [...page1].sort(byTime('desc'))
const allRows = [...page1, ...otherPages].sort(byTime('desc'))

console.log('只排這一頁，最晚的是：', onlyThisPage[0].time)   // 11:40，漏掉 16:20
console.log('排全部，最晚的是：', allRows[0].time)            // 16:20
console.log('排全部的順序：', allRows.map((r) => r.time ?? '（未排）').join(' → '))
```

真實情況裡 `otherPages` 在伺服器上，前端拿不到，所以有分頁時排序要交給 API。

:::stop 讀到這裡可以先停：會在 Table、List、Card 之間選一種，寫出有 `th scope` 的表格，並判斷排序要在前端還是 API 做。後面的篩選、固定表頭、全選與手機版表格，在做到那個功能時再回來讀。

### 篩選

篩選條件列放在表格上方，規格要寫：

- 每個條件的元件（日期用 Date picker、狀態用 Checkbox 群組或 Select、姓名用搜尋框）。
- 套用時機：改了就套用，還是按「套用」才送出。改了就套用時，文字搜尋要 debounce。
- 已套用的條件顯示成 Tag，每個可以單獨移除，旁邊有「清除全部」。
- 篩選後沒有資料：Empty state「沒有符合條件的預約」加「清除篩選」，和「這天沒有預約」分開（見 [回饋](#/skill/feedback)）。
- 條件寫進網址的 query。

### 固定表頭與固定欄

```css
.table-wrap { overflow: auto; max-block-size: 70vh; }      /* 捲動發生在容器裡 */
thead th { position: sticky; inset-block-start: 0; background: var(--color-surface); z-index: 1; }
tbody th[scope="row"], thead th:first-child { position: sticky; inset-inline-start: 0; background: var(--color-surface); }
```

`position: sticky` 以最近的捲動容器為準。容器沒有設 `overflow`，表頭會黏在整頁的頂端；表格的某個祖先設了 `overflow: hidden`，sticky 就會失效。固定的格子要有背景色，否則捲動時底下的內容會透出來。

### 勾選與全選

| 已勾選 | 全選框 | `checked` | `indeterminate` |
|---|---|---|---|
| 0 列 | 空白 | false | false |
| 部分 | 一條橫線 | false | true |
| 全部 | 打勾 | true | false |

`indeterminate` 只是 DOM 的 property，沒有對應的 HTML 屬性，寫在 HTML 裡沒有作用；要用 JavaScript 設定，Vue 的 `:indeterminate` 綁定會設這個 property。自己做的勾選框用 `aria-checked="mixed"`（APG 的 Checkbox 模式）。

全選的範圍要寫進規格：只選這一頁，還是全部符合條件的資料？常見做法是先選這一頁，再顯示「已選這頁 20 筆，選取全部 134 筆」讓使用者擴大範圍。批次操作送給 API 時，「全部符合條件」要送篩選條件，而不是 134 個 id。

### Badge 與 Tag

| | Badge | Tag（Chip） |
|---|---|---|
| 表示 | 狀態或數量 | 分類、標籤、已套用的條件 |
| 例子 | 候診、已報到、未讀 3 | 初診、慢性病、科別：內科 |
| 互動 | 通常沒有 | 可以點選篩選、可以移除 |

不能只靠顏色：「已報到」前面加 ✓ 或直接寫字，「已取消」加刪除線或圖示。WCAG 的 1.4.1 Use of Color（A）要求顏色不能是傳達資訊的唯一方式。

### 手機上的表格

| 做法 | 怎麼做 | 適合 |
|---|---|---|
| 容器內橫向捲動 | 表格包在 `overflow-x: auto` 的容器裡，第一欄固定 | 要保留比較功能的表格 |
| 隱藏次要欄位 | 窄螢幕只留時間、姓名、狀態，點一列看完整資料 | 欄位有明顯主次 |
| 改成卡片 | 每列排成一張卡片，值旁邊顯示欄名 | 每筆欄位不多、不需要橫向比較 |

WCAG 2.1 的 1.4.10 Reflow（AA）要求內容在 320 CSS px 寬時不需要兩個方向捲動，但把資料表列為例外：需要二維版面才有意義的內容可以二維捲動。例外只限表格本身，整頁仍然不能左右滑。

## 實際程式

```vue
<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const rows = ref([])          // 這一頁的資料：[{ id, time, chartNo, name, status }]
const total = ref(0)
const selected = ref(new Set())

const sort = computed(() => ({ by: route.query.sort || 'time', order: route.query.order === 'desc' ? 'desc' : 'asc' }))
const allChecked = computed(() => rows.value.length > 0 && rows.value.every((r) => selected.value.has(r.id)))
const someChecked = computed(() => !allChecked.value && rows.value.some((r) => selected.value.has(r.id)))

function sortBy(col) {
  const order = sort.value.by === col && sort.value.order === 'asc' ? 'desc' : 'asc'
  router.push({ query: { ...route.query, sort: col, order, page: undefined } })   // 排序交給 API，頁碼重設
}
const ariaSort = (col) => (sort.value.by === col ? (sort.value.order === 'asc' ? 'ascending' : 'descending') : undefined)

function toggleAll() {
  const next = new Set(selected.value)
  for (const r of rows.value) allChecked.value ? next.delete(r.id) : next.add(r.id)
  selected.value = next
}
function toggle(id) {
  const next = new Set(selected.value)
  next.has(id) ? next.delete(id) : next.add(id)
  selected.value = next
}

watch(() => route.query, async (q) => {
  const params = new URLSearchParams({ date: '2026-11-20', sort: sort.value.by, order: sort.value.order, page: q.page || 1 })
  const res = await fetch(`/api/appointments?${params}`)
  const body = await res.json()
  rows.value = body.items
  total.value = body.total
}, { immediate: true })

const STATUS = { waiting: { label: '候診', icon: '●' }, done: { label: '已報到', icon: '✓' }, cancelled: { label: '已取消', icon: '✕' } }
</script>

<template>
  <p v-if="selected.size" role="status">已選 {{ selected.size }} 筆 <button type="button">批次報到</button></p>
  <div class="table-wrap">
    <table>
      <caption>11/20 內科 101 預約（共 {{ total }} 筆）</caption>
      <thead>
        <tr>
          <th scope="col">
            <input type="checkbox" aria-label="全選這一頁"
                   :checked="allChecked" :indeterminate="someChecked" @change="toggleAll">
          </th>
          <th scope="col" :aria-sort="ariaSort('time')"><button type="button" @click="sortBy('time')">時間</button></th>
          <th scope="col">病歷號</th>
          <th scope="col" :aria-sort="ariaSort('name')"><button type="button" @click="sortBy('name')">姓名</button></th>
          <th scope="col">狀態</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id">
          <td><input type="checkbox" :aria-label="`選取 ${r.time} ${r.name}`" :checked="selected.has(r.id)" @change="toggle(r.id)"></td>
          <td data-label="時間">{{ r.time ?? '—' }}</td>
          <td data-label="病歷號">{{ r.chartNo }}</td>
          <td data-label="姓名">{{ r.name }}</td>
          <td data-label="狀態"><span :class="['badge', r.status]"><span aria-hidden="true">{{ STATUS[r.status].icon }}</span> {{ STATUS[r.status].label }}</span></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.table-wrap { overflow: auto; max-block-size: 70vh; container-type: inline-size; }
thead th { position: sticky; inset-block-start: 0; background: var(--color-surface); }
td[data-label="時間"] { font-variant-numeric: tabular-nums; }

/* 容器窄於 480px：每列改排成卡片，欄名用 data-label 顯示 */
@container (max-width: 480px) {
  thead { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); }
  tr { display: grid; gap: var(--space-1); padding: var(--space-3); border-block-end: 1px solid var(--color-border); }
  td[data-label]::before { content: attr(data-label) "："; color: var(--color-text-muted); }
}
</style>
```

- 排序與頁碼都在網址裡，`watch` 盯著 `route.query` 重新抓資料；按上一頁也會回到上一次的排序。
- `aria-sort` 只在目前排序的欄出現，其他欄是 `undefined`（Vue 不輸出這個屬性）。
- 每列勾選框的 `aria-label` 帶上時間與姓名，螢幕閱讀器使用者不會聽到 20 個一樣的「選取」。
- 卡片版把 `<thead>` 視覺上藏起來但留給輔助科技。改了 `display` 的表格元素，部分瀏覽器會讓輔助科技失去表格結構；改成卡片後用 Accessibility 窗格確認，必要時在卡片版改用 List 的結構。

## 常見錯誤

- **用 `div` 排表格**：Accessibility 窗格只看到 `generic`，螢幕閱讀器念不出欄名。
- **前端排序有分頁的資料**：只排了這一頁。Network 分頁按排序時沒有新請求就是這個問題。
- **`aria-sort` 寫在每一欄**：只有目前排序的那一欄要有；其他欄寫 `none` 或留著舊值，會讓人以為好幾欄都排過。
- **表頭文字沒包按鈕**：在 `<th>` 上直接 `@click`，鍵盤 Tab 不到，也沒有按鈕角色。
- **全選只有兩種狀態**：部分勾選時看起來和沒勾一樣。
- **換篩選不清勾選**：篩選後畫面上只剩 5 筆，但 `selected` 還留著先前的 20 筆，批次操作動到看不見的資料。
- **sticky 失效**：祖先有 `overflow: hidden`，或捲動容器不是你以為的那一個。Elements 分頁從表頭往上找第一個設了 `overflow` 的祖先。
- **整頁可以左右滑**：寬表格直接放在頁面裡，沒有自己的捲動容器。
- **空值顯示成 `null` 或 `undefined`**：模板直接輸出可能是空值的欄位。統一用「—」，並在說明寫出它的意思。

AI 產生的表格常見三件事：用 `div` 排、前端 `sort()` 有分頁的資料、狀態只用顏色。描述需求時寫明排序與篩選交給 API、狀態 Badge 的文字，以及手機上的處理方式。

## 動手

1. 跑上面的排序程式，把 `byTime('desc')` 改成 `'asc'`，看空值是不是仍然排在最後。
2. 在自己的專案找一張表格，Accessibility 窗格選一格資料，看 Role 是 `cell` 還是 `generic`。
3. 有分頁的表格按一次排序，看 Network 分頁有沒有新的請求、請求帶了哪些參數。
4. 裝置模式切到 390px，看表格是在容器裡捲動還是整頁左右滑；試著把它改成卡片版。
5. 表格用到的顏色、間距與 Badge 的顏色怎麼統一，接著讀 [design token 與主題](#/skill/design-tokens)。

## 這階段要做出什麼

「我的掛號」`/appointments` 列出掛過的號，可以依狀態篩選、往下載入更多、取消還沒看診的掛號。介面：

| 請求 | 回應 |
|---|---|
| `GET /api/appointments?limit=20&status=booked&cursor=…` | `{ items, next_cursor }`；`next_cursor` 是 `null` 代表沒有下一批；`status` 選填，由後端篩選 |
| `POST /api/appointments/{id}/cancel` | 200 與取消後的掛號；409：已過取消期限或狀態不能取消 |

這一階段要做到：

1. **cursor 分頁**：「載入更多」把下一批接在後面；最後一批之後按鈕消失；載入中停用；「載入更多」失敗時已載入的保留、可以再按。
2. **取消前確認**：用原生 `<dialog>` 的 `showModal()`，開啟時焦點在「保留掛號」，Esc 或「保留掛號」關閉後焦點回到觸發按鈕；確定取消後只更新那一列，觸發按鈕消失時焦點移到清單標題。
3. **競態**：換篩選時取消上一組條件的請求、從第一批開始；「載入更多」還沒回來就換了條件，那一批丟掉。

cursor 與 offset 從前端看的差別、換條件時頁碼與資料怎麼處理在 [分頁、篩選與網址](#/skill/pagination-filter)；Dialog 的焦點規則、`showModal()` 做了哪些事在 [浮層：Dialog、Drawer、Popover、Tooltip](#/skill/overlays)；`AbortController` 與序號在 [取消請求與競態](#/skill/cancel-race)。

## 設計決策與取捨

### 用「載入更多」，不用頁碼

後端是 cursor 分頁，cursor 是不透明的字串，只能一批一批往下拿，沒辦法跳到第 7 頁，所以元件選「載入更多」。cursor 不放進網址：重新整理後回到第一批是 cursor 分頁的取捨。狀態篩選放網址（`?status=cancelled`），和第 2 階段一樣用 `router.push`，上一頁回得到前一個篩選。

櫃台版要看大量資料時改成表格，表格在 390px 時放進可以左右捲動的容器。容器加 `role="region"`、`aria-labelledby` 指向表格標題、`tabindex="0"`，只用鍵盤的人才捲得動它；這一階段的病患版維持清單。

### 確認用原生 `<dialog>`

`confirm()` 擋住整個瀏覽器、樣式不能改、文字不能排版；`div` 加 `z-index` 做的視窗沒有焦點移動、沒有 Esc、背景還能點。`showModal()` 開出來的 Dialog 由瀏覽器處理這些：

| 行為 | 誰處理 |
|---|---|
| 背景不能點、不能聚焦（inert）、放在 top layer、`::backdrop` 遮罩 | 瀏覽器 |
| 開啟時焦點移到有 `autofocus` 的元素 | 瀏覽器；確認刪除這類操作把 `autofocus` 放在比較安全的「保留掛號」 |
| Esc 關閉、關閉後焦點回到開啟前的元素 | 瀏覽器 |
| 名稱：`aria-labelledby` 指向標題 | 自己寫 |
| 觸發按鈕被移除時焦點去哪 | 自己寫：移到清單標題 `h1[tabindex="-1"]` |
| 後面的頁面跟著捲動 | 自己寫 CSS：`dialog:modal` 與 `dialog::backdrop` 的 `overscroll-behavior: contain` |

`<form method="dialog">` 讓兩顆按鈕直接關閉視窗，按下的按鈕的 `value` 成為 `returnValue`；Esc 關閉時不設定 `returnValue`，所以開啟前先清成空字串，`close` 事件裡只認 `'confirm'`。不加 `role="dialog"`、`aria-modal`，也不自己寫焦點陷阱與 Esc 的處理：`showModal()` 已經提供，自己再寫一次會和瀏覽器的行為打架。

點背景關閉（`closedby="any"`）這裡不開：確認視窗要使用者明確選一個。`closedby` 在 2026 年 11 月還不是 Baseline（Chrome 134、Firefox 141 起支援，Safari 尚未支援），沒有它時 Esc 照樣能關。`overscroll-behavior` 對內容沒有溢出的捲動容器生效是較新的行為（Chrome 144、Firefox 150 起；Safari 尚未支援），不支援時背景頁面可能跟著捲，但點不到、聚焦不到，算是漸進增強。不要用 `body { overflow: hidden }` 鎖捲動：捲軸消失會讓版面左右跳動。

### 取消後只更新那一列

成功的回應就是取消後的掛號，用它換掉清單裡那一筆。整份重抓會丟掉已經載入的三批、捲動位置回到頂端。樂觀更新（先改畫面再送出）這裡不用：取消有期限，409 的機率不低，畫面先寫「已取消」再改回來會讓人誤會。

### 一組條件一個 AbortController

`watch` 篩選條件的 callback 裡建一個 `AbortController`，第一批與之後的「載入更多」都用它的 `signal`；`onWatcherCleanup` 在條件又變了或元件卸載時呼叫 `abort()`。「載入更多」開始時記下當時的 controller，回應回來時比對：已經換成別的 controller，就是舊條件的一批，丟掉。被取消的請求在 `catch` 裡用 `signal.aborted` 判斷，不顯示錯誤。

## 關鍵程式

確認視窗，寫成一個元件：

```vue
<script setup>
import { useTemplateRef } from 'vue'

const props = defineProps({ appointment: { type: Object, default: null } })
const emit = defineEmits(['confirm'])
const dialog = useTemplateRef('dialog')

function open() {
  dialog.value.returnValue = ''        // Esc 關閉時不會設定 returnValue：先清掉上一次的值
  dialog.value.showModal()             // 背景 inert、焦點移到有 autofocus 的「保留掛號」
}
function onClose() {
  if (dialog.value.returnValue === 'confirm') emit('confirm', props.appointment)
  // 「保留掛號」或 Esc：什麼都不做，瀏覽器把焦點還給開啟前的「取消掛號」
}
defineExpose({ open })
</script>

<template>
  <dialog ref="dialog" aria-labelledby="cancel-title" aria-describedby="cancel-desc" @close="onClose">
    <h2 id="cancel-title">取消第 {{ appointment?.number }} 號的掛號？</h2>
    <p id="cancel-desc">取消後名額會開放給其他人，無法復原。</p>
    <form method="dialog">
      <button value="keep" autofocus>保留掛號</button>
      <button value="confirm" class="danger">確定取消</button>
    </form>
  </dialog>
</template>

<style scoped>
dialog:modal { overscroll-behavior: contain; }                 /* 在視窗裡捲動不帶動後面的頁面 */
dialog::backdrop { background: rgb(0 0 0 / 0.5); overflow: hidden; overscroll-behavior: contain; }
</style>
```

清單頁：

```vue
<script setup>
import { ref, watch, nextTick, onWatcherCleanup, useTemplateRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiFetch } from '@/api/client'
import CancelDialog from '@/components/CancelDialog.vue'

const STATUS_TEXT = { booked: '已掛號', cancelled: '已取消', checked_in: '已報到' }
const STATUSES = ['all', 'booked', 'cancelled']
const LIMIT = 20
const route = useRoute()
const router = useRouter()

const status = ref('loading')        // 第一批：loading | success | empty | error
const items = ref([])
const nextCursor = ref(null)
const loadingMore = ref(false)
const loadMoreFailed = ref(false)
const cancelError = ref('')
const target = ref(null)
const cancelDialog = useTemplateRef('cancelDialog')
let controller = null                // 目前這一組條件的請求

const filter = () => (STATUSES.includes(route.query.status) ? route.query.status : 'all')

function fetchBatch(cursor, signal) {
  const params = new URLSearchParams({ limit: String(LIMIT) })
  if (filter() !== 'all') params.set('status', filter())
  if (cursor) params.set('cursor', cursor)
  return apiFetch(`/appointments?${params}`, { signal })   // { items, next_cursor }
}

watch(() => (route.name === 'appointments' ? filter() : null), async (key) => {
  if (key === null) return
  const c = (controller = new AbortController())
  onWatcherCleanup(() => c.abort())   // 條件又變了或元件卸載：這一輪的請求都取消（第一個 await 之前登記）
  items.value = []                    // 換條件：從第一批開始，cursor 不沿用
  nextCursor.value = null
  loadMoreFailed.value = false
  status.value = 'loading'
  try {
    const page = await fetchBatch(null, c.signal)
    items.value = page.items
    nextCursor.value = page.next_cursor
    status.value = page.items.length ? 'success' : 'empty'
  } catch (err) {
    if (c.signal.aborted || err.status === 401) return   // 被取消不算錯誤
    status.value = 'error'
  }
}, { immediate: true })

async function loadMore() {
  if (loadingMore.value || !nextCursor.value) return
  const c = controller                // 記下這一批屬於哪一組條件
  loadingMore.value = true
  loadMoreFailed.value = false
  try {
    const page = await fetchBatch(nextCursor.value, c.signal)
    if (c !== controller) return      // 等待期間換了條件：舊條件的一批，丟掉
    items.value.push(...page.items)
    nextCursor.value = page.next_cursor
  } catch (err) {
    if (!c.signal.aborted && err.status !== 401) loadMoreFailed.value = true   // 已載入的留著
  } finally {
    loadingMore.value = false
  }
}

function ask(a) {
  target.value = a
  cancelDialog.value.open()
}

async function cancel(a) {
  cancelError.value = ''
  try {
    const updated = await apiFetch(`/appointments/${a.id}/cancel`, { method: 'POST' })
    const i = items.value.findIndex((x) => x.id === a.id)
    if (i >= 0) items.value[i] = updated             // 只換這一列，不重抓整份清單
    await nextTick()
    document.getElementById('list-title')?.focus()   // 觸發按鈕跟著消失了：焦點移到清單標題
  } catch (err) {
    if (err.status !== 401) cancelError.value = err.problem?.detail ?? '取消失敗，請稍後再試'
  }
}
</script>

<template>
  <main>
    <h1 id="list-title" tabindex="-1">我的掛號</h1>
    <label for="status">狀態</label>
    <select id="status" :value="filter()" @change="router.push({ query: $event.target.value === 'all' ? {} : { status: $event.target.value } })">
      <option value="all">全部</option>
      <option value="booked">已掛號</option>
      <option value="cancelled">已取消</option>
    </select>

    <p v-if="cancelError" role="alert">{{ cancelError }}</p>
    <p v-if="status === 'loading'">載入中…</p>
    <div v-else-if="status === 'error'" role="alert"><p>讀取失敗</p></div>
    <p v-else-if="status === 'empty'">沒有符合條件的掛號</p>
    <template v-else>
      <ul>
        <li v-for="a in items" :key="a.id">
          第 {{ a.number }} 號　{{ STATUS_TEXT[a.status] }}
          <button v-if="a.status === 'booked'" type="button" @click="ask(a)">取消掛號</button>
        </li>
      </ul>
      <p v-if="loadMoreFailed" role="alert">載入失敗，請再按一次「載入更多」</p>
      <button v-if="nextCursor" type="button" :disabled="loadingMore" @click="loadMore">
        {{ loadingMore ? '載入中…' : '載入更多' }}
      </button>
    </template>
    <CancelDialog ref="cancelDialog" :appointment="target" @confirm="cancel" />
  </main>
</template>
```

這兩個檔案在 Chromium 裡和前兩階段的程式一起跑過：25 筆掛號分兩批載入；選「已取消」後網址多了 `?status=cancelled`、清單只剩已取消的，按上一頁回到全部；用鍵盤在「取消掛號」按 Enter，開出的是 modal、焦點在「保留掛號」，按 Esc 關閉後焦點回到「取消掛號」；確定取消後那一列變成已取消，焦點在 `#list-title`。

## 常見錯誤

**每批換掉上一批。** `items.value = page.items`，按「載入更多」之後前面的不見了。用 `push(...page.items)`。

**最後一批之後還有「載入更多」。** 沒看 `next_cursor`。是 `null` 就不顯示。

**「載入更多」失敗時清單被清空。** 第一批的失敗與「載入更多」的失敗要分開記。

**用 `:open` 開 Dialog。** `<dialog :open="show">` 是非 modal 的 Dialog：背景能操作、沒有遮罩、Esc 不關。用 `showModal()`。

**對已經開著的 Dialog 再呼叫 `showModal()`。** 丟出 `InvalidStateError`。

**關閉後焦點掉到 `body`。** 自己做的浮層沒記下觸發元素；或觸發按鈕被移除了。原生 Dialog 處理前者，後者要自己把焦點移到清單標題。

**`returnValue` 留著上一次的值。** 上一次按了「確定取消」，這次按 Esc，`close` 事件讀到的還是 `'confirm'`。開啟前清空。

**取消後整份重抓。** 捲動位置與已載入的資料都不見。用回應更新那一列。

**換篩選後畫面是舊條件的結果。** 慢的舊請求晚到。換條件時 abort。

**快速換篩選時閃出「讀取失敗」。** `catch` 沒區分取消與故障。用 `signal.aborted` 判斷。

## 驗收題在測什麼

**cursor 分頁**：第一個請求是 `limit=5` 不帶 cursor；「載入更多」帶 `cursor=5`，清單是第 1 到第 10 號、不重複；12 筆載完之後沒有「載入更多」；同步連點兩下只送一個請求、載入中按鈕 `disabled`；「載入更多」回 503 時 5 筆保留、出現「載入失敗」、可以再按且再按會成功。

**取消確認**：按下後 `dialog` 符合 `:modal`、`aria-labelledby` 指到含號碼的標題、焦點在「保留掛號」；按「保留掛號」不送請求、焦點回到觸發按鈕；確定取消只送一個 POST、不重抓清單、那一列顯示已取消、焦點在 `#list-title`；409 時顯示 `detail`、那一列不變、視窗關閉。沙箱會攔下所有表單送出，`<form method="dialog">` 在題目裡關不掉視窗，所以題目的按鈕用 `type="button"` 加 `close()`。沙箱 iframe 是跨來源的子框架，Chromium 會擋下裡面的 `autofocus`（Console 出現 `Blocked autofocusing on a <button> element in a cross-origin subframe.`），題目在 `showModal()` 之後自己呼叫 `focus()`；上面的程式在一般頁面用 `autofocus`。

**競態**：「已取消」的查詢 400 ms、「已掛號」80 ms，先選已取消再選已掛號，最後清單全部是已掛號，已取消的請求被標成已取消（`aborted`），沒有 `role="alert"`；載入兩批後換條件，請求不帶 cursor、清單回到 5 筆；「載入更多」還沒回來就換條件，清單只有新條件的第一批。

下一階段是掛在候診區的報到看板，資料要自己定時更新。

## 串接驗收

**1. 取消後列表與明細一致。** 用[登入](#/project/fe-login)串接驗收的接線，`patient1` 在診次 1、2 各掛一筆，在「我的掛號」取消第一筆。預期：那一列顯示已取消，Network 只有一個 `POST …/cancel`，沒有重抓清單；取消的回應 body 與重新整理之後清單裡那一列，`status` 都是 `cancelled`、`number` 相同。

**2. 篩選條件和清單的關係。** 篩選選「已掛號」再取消一筆，先預測那一列會留著還是消失、重新整理之後呢。預期：取消後那一列留著、顯示已取消（只更新那一列，不重抓）；重新整理後它不見了，因為 `GET /api/appointments?status=booked` 由後端篩選（契約裡 `status` 是 `booked`、`cancelled`、`checked_in`，其他值回 422）。再選「已取消」，那一筆出現在這裡。

**3. 診次清單跟著變。** 取消前後各看一次[診次清單](#/project/fe-sessions)那個診次的剩餘名額。預期：取消後馬上多 1，不用等 30 秒，因為取消成功後後端讓那一天的快取失效（[第 6 階段](#/project/cache-ratelimit)）。下一階段的報到看板不經過這份快取，資料由輪詢更新。

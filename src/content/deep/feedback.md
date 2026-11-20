## 從一個具體問題開始：伺服器掛了，畫面寫「今天沒有預約」

週一早上，櫃台打開預約清單，畫面寫著「今天沒有預約」。櫃台以為是休診日，把第一位來報到的病人請回家。半小時後才發現，清單 API 回的是 502，程式在 `catch` 裡寫了 `appointments.value = []`，錯誤就這樣變成了空清單。

同一個畫面還有兩個回饋的問題：

- 取消預約失敗時，右下角跳出 Toast「取消失敗」，三秒後消失。櫃台當時正低頭看病歷，沒看到，以為取消成功了。
- 清單載入時先顯示一個置中的 Spinner，資料回來後換成 20 列的表格，下方的「新增預約」按鈕被往下推，櫃台正要按它，結果按到了第三列的「取消」。

成功、失敗、等待、沒有資料，各自要用對的元件，放在對的地方，停留對的時間。

## 運作原理：依「使用者要不要處理」選元件

| 情況 | 元件 | 放哪裡 | 會自己消失 | 輔助科技 |
|---|---|---|---|---|
| 等資料，知道版面 | Skeleton | 資料將出現的位置 | 資料回來時 | 容器 `aria-busy="true"` |
| 等一個操作，時間短 | 按鈕內的 Spinner | 按鈕裡 | 操作完成時 | 按鈕文字改成「送出中…」 |
| 等一個操作，知道進度 | Progress bar（`<progress>`） | 操作的區塊 | 完成時 | `<progress>` 本身就有 progressbar 角色 |
| 操作成功，不需要處理 | Toast | 固定角落 | 是，幾秒後 | `role="status"` |
| 操作失敗，要處理 | inline Alert | 出錯的區塊旁邊 | 否，處理或重試後才消失 | `role="alert"` |
| 整頁的狀況（離線、維護） | Banner | 頁面上方 | 否，狀況解除後 | `role="status"` 或 `role="alert"` |
| 要使用者做決定 | 確認 Dialog | 畫面中央，擋住其他操作 | 否，選了才關 | `<dialog>` 的 `showModal()` |
| 成功但沒有資料 | Empty state | 原本放資料的位置 | 有資料時 | 一般文字 |

判斷的順序：使用者需要做決定嗎（Dialog）？需要讀完或處理嗎（Alert）？只需要知道嗎（Toast）？還在等嗎（Skeleton、Spinner、Progress bar）？

### 等待：Skeleton、Spinner、Progress bar

Skeleton 用灰色區塊畫出接近最終版面的輪廓：列數、列高、欄寬都接近實際的資料。資料回來時，內容直接填進同樣大小的位置，下面的元素不會被推動。Spinner 不佔版面，換成資料時版面一定會變，適合放在按鈕裡或固定大小的區域。

內容在載入後移動，叫版面位移（layout shift）。Core Web Vitals 用 CLS（Cumulative Layout Shift）量它，web.dev 把 0.1 以下列為良好。

請求很快時（幾百毫秒內），Skeleton 一閃而過反而像畫面在跳。常見的做法是請求超過一個門檻（例如 300 ms）才顯示 loading；門檻多少是設計決定，沒有標準值。

### Toast 的規則

- 只放「知道就好」的訊息：「已取消 11/20 09:30 的預約」「已複製」。需要處理的錯誤不用 Toast。
- 停留時間依文字長度定，帶「復原」這類操作的要讓人來得及按；滑鼠移上去或焦點移進去時暫停倒數。
- 不搶焦點：Toast 出現時焦點留在原處，使用者要按「復原」時再 Tab 過去。
- 整個 app 只有一個 Toast 容器，同時出現好幾則時排隊或堆疊，設上限。
- modal Dialog 開著時不顯示 Toast：Dialog 以外的內容都是 inert，Toast 的「復原」按不到，螢幕閱讀器也念不到。先排著，等 Dialog 關閉再顯示。
- 容器加 `popover="manual"`，頁面載入時就呼叫 `showPopover()` 打開（空的時候不畫外框與內距），Toast 就在 top layer，不會被 sticky 頁首或其他浮層蓋住；`manual` 不會因為點了頁面其他地方就關掉。等到第一則訊息才打開，等於訊息出現時才插入 live region，部分螢幕閱讀器不會念。Popover 是 Baseline 2025（Newly available），沒有 `popover` 的舊瀏覽器裡容器仍是一般的 `position: fixed` 元素，所以 `z-index` 照樣要設。

### live region：讓螢幕閱讀器念出來

畫面上出現新訊息，看得到的使用者會注意到，用螢幕閱讀器的使用者不會，除非訊息放在 live region 裡：

- `role="status"`：內容改變時，螢幕閱讀器等目前念的東西告一段落再念（polite）。成功訊息、搜尋結果筆數用它。
- `role="alert"`：立刻打斷正在念的內容（assertive）。只給錯誤與需要馬上注意的訊息。

live region 的容器要在內容改變之前就在 DOM 裡，之後只換裡面的文字或子元素。訊息出現時才把整個 `<div role="status">` 插進去，部分螢幕閱讀器不會念。WCAG 2.1 起的 4.1.3 Status Messages（AA）要求狀態訊息不搶焦點也能被輔助科技讀到。

`document.ariaNotify('已取消 11/20 09:30 的預約')` 不需要 live region，直接請螢幕閱讀器念一段文字。它在 2026 年 9 月才成為 Baseline（Newly available），舊瀏覽器沒有這個方法：用 `if ('ariaNotify' in document)` 判斷，沒有時照樣寫進事先放好的 live region。

### Empty state 的三種情況

| 情況 | 例子 | 文案 | 按鈕 |
|---|---|---|---|
| 第一次使用 | 新診所還沒建立任何診次 | 「還沒有診次」 | 「新增診次」 |
| 篩選後沒有結果 | 搜尋「王」找不到 | 「沒有符合條件的預約」 | 「清除篩選」 |
| 全部處理完 | 今天的病人都報到了 | 「今天的病人都已報到」 | 不一定需要 |

三種都是「請求成功、資料是空的」。請求失敗是另一個畫面：說明發生什麼事、能不能重試，絕不能顯示成 Empty state。

### 錯誤訊息的寫法

- 寫發生什麼事，用使用者看得懂的話：「已過可取消的時間（看診前 2 小時）」，不寫 `HTTP 409` 或 `TypeError: Failed to fetch`。
- 寫使用者能做什麼：重試、改日期、聯絡櫃台。重試沒有用的錯誤（403、409）不放重試按鈕。
- 後端回 Problem Details 時，`title` 與 `detail` 是給人看的欄位；要不要直接顯示，和後端約定好文案由誰負責。

## 實際程式

### 一直在 DOM 裡的 Toast 容器

```vue
<!-- ToastHost.vue：整個 app 放一個，容器從頁面載入就在 -->
<script setup>
import { ref } from 'vue'

const toasts = ref([])        // [{ id, text, action }]
const timers = new Map()
let seq = 0

function show(text, { action = null, duration = 5000 } = {}) {
  const id = ++seq
  toasts.value.push({ id, text, action })
  if (toasts.value.length > 3) dismiss(toasts.value[0].id)   // 最多同時 3 則
  start(id, duration)
}
function start(id, ms) { timers.set(id, setTimeout(() => dismiss(id), ms)) }
function pause(id) { clearTimeout(timers.get(id)) }
function dismiss(id) {
  pause(id)
  timers.delete(id)
  toasts.value = toasts.value.filter((t) => t.id !== id)
}

defineExpose({ show })
</script>

<template>
  <!-- role="status"：內容改變時螢幕閱讀器會念，不打斷 -->
  <div class="toast-host" role="status">
    <div
      v-for="t in toasts" :key="t.id" class="toast"
      @mouseenter="pause(t.id)" @mouseleave="start(t.id, 3000)"
      @focusin="pause(t.id)" @focusout="start(t.id, 3000)"
    >
      <span>{{ t.text }}</span>
      <button v-if="t.action" type="button" @click="t.action.run(); dismiss(t.id)">{{ t.action.label }}</button>
      <button type="button" aria-label="關閉訊息" @click="dismiss(t.id)">×</button>
    </div>
  </div>
</template>
```

呼叫端：`toastHost.value.show('已取消 11/20 09:30 的預約', { action: { label: '復原', run: undo } })`。多個頁面要共用同一個容器時，常見做法是用 `provide`／`inject` 或 Pinia 把 `show` 提供出去。

### 清單的等待、空、錯誤

```vue
<script setup>
import { ref, onMounted } from 'vue'

const status = ref('loading')     // loading | success | empty | error
const items = ref([])
const showSkeleton = ref(false)

async function load() {
  status.value = 'loading'
  const delay = setTimeout(() => { showSkeleton.value = true }, 300)   // 超過 300 ms 才顯示
  try {
    const res = await fetch('/api/appointments?date=2026-11-20')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    items.value = await res.json()
    status.value = items.value.length ? 'success' : 'empty'
  } catch {
    status.value = 'error'        // 失敗進 error 狀態，不把清單設成 []
  } finally {
    clearTimeout(delay)
    showSkeleton.value = false
  }
}
onMounted(load)
</script>

<template>
  <section :aria-busy="status === 'loading'">
    <template v-if="status === 'loading'">
      <div v-for="n in 5" v-show="showSkeleton" :key="n" class="skeleton-row"></div>
    </template>
    <div v-else-if="status === 'error'" role="alert" class="alert">
      <p>預約清單暫時無法載入。</p>
      <button type="button" @click="load">重試</button>
    </div>
    <div v-else-if="status === 'empty'" class="empty">
      <p>這天沒有預約</p>
      <button type="button">選擇其他日期</button>
    </div>
    <ul v-else>
      <li v-for="a in items" :key="a.id" class="row">{{ a.time }} {{ a.patientName }}</li>
    </ul>
  </section>
</template>

<style scoped>
.row, .skeleton-row { height: 3rem; }   /* Skeleton 和真實的列同高，資料進來時不推動下面的內容 */
.skeleton-row { margin-block: 0.25rem; border-radius: var(--radius); background: var(--color-skeleton); }
@media (prefers-reduced-motion: no-preference) {
  .skeleton-row { animation: pulse 1.2s ease-in-out infinite; }
}
@keyframes pulse { 50% { opacity: 0.5; } }
</style>
```

這裡的 `role="alert"` 元素在錯誤發生時才插入。帶 `alert` 角色的元素插入時，多數螢幕閱讀器會念出；要在各種螢幕閱讀器都穩定，可以事先放一個空的 `role="alert"` 容器，錯誤發生時再填入文字。四種狀態的完整寫法（重試、哪些錯誤不能重試、重新整理時保留舊資料）在 [API 的四種狀態](#/skill/api-states)。

:::stop 讀到這裡可以先停：會依使用者要不要處理選 Toast、Alert、Skeleton 或 Empty state，並把讀取失敗和空清單分成兩個畫面。後面的對照表在驗收別人的畫面、找「沒看到訊息」的原因時再回來查。

## 常見錯誤

| 現象 | 原因 | 修法 |
|---|---|---|
| 網路斷了，畫面顯示「這天沒有預約」 | `catch` 裡把清單設成 `[]` | 錯誤用獨立的 error 狀態與畫面 |
| 使用者說「沒看到錯誤訊息」 | 錯誤放在幾秒就消失的 Toast | 改成留在原處的 inline Alert |
| 成功訊息要按「確定」才能繼續 | 用 Dialog 顯示「儲存成功」 | 改用 Toast |
| 資料回來時下方的按鈕被推走 | Spinner 換成表格，或 Skeleton 高度和真實列不同 | Skeleton 與列同高；Lighthouse 看 CLS |
| 載入很快時畫面閃一下 | 一開始就顯示 Skeleton | 超過門檻才顯示 |
| 螢幕閱讀器沒念出 Toast | 訊息出現時才插入整個 `role="status"` 容器 | 容器事先放好，只換內容 |
| 螢幕閱讀器一直被打斷 | 所有訊息都用 `role="alert"` | 成功與一般狀態改用 `role="status"` |
| 錯誤訊息顯示 `TypeError: Failed to fetch` | 直接把 `err.message` 放上畫面 | 依錯誤類型寫給人看的文案 |
| 篩選後沒有結果與「這天沒有預約」同一句話 | Empty state 沒有分情況 | 分開寫，篩選後的空狀態附「清除篩選」 |

## 動手

1. 在 Network 分頁的清單請求上按右鍵選 `Block request URL`，重新整理：畫面要是錯誤訊息與重試，不能是「這天沒有預約」。
2. Network 分頁的節流選 `3G`，重新整理清單頁，看 Skeleton 換成資料時下方的內容有沒有被推動；用 Lighthouse 跑一次，看 CLS。
3. 打開作業系統的螢幕閱讀器（macOS 的 VoiceOver、Windows 的 NVDA），觸發一次 Toast 與一次錯誤，確認兩者都被念出，而且 Toast 沒有打斷正在念的內容。
4. Rendering 分頁把 `prefers-reduced-motion` 模擬成 `reduce`，Skeleton 的閃動動畫要停掉。
5. 對照 [API 的四種狀態](#/skill/api-states) 的實驗室，切換成功、空清單、錯誤，看每種狀態用了哪些元件。

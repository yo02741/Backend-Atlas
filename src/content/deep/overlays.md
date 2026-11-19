## 從一個具體問題開始：關掉 Dialog 之後，焦點回到頁首

預約清單每一列有「取消預約」，按下去跳出確認視窗。視窗是一個 `div`，`position: fixed` 加 `z-index: 1000`，蓋在頁面中央。用滑鼠操作一切正常，換成鍵盤：

- 按 Enter 開啟後，焦點還留在後面那一列的「取消預約」上。要按好幾次 Tab，焦點才走得到視窗裡的按鈕，中途經過的全是被遮住的連結。
- 按 Esc 沒有反應。
- 按「保留預約」關閉後，焦點掉到 `body`，下一次 Tab 從頁首的 Logo 重新開始。清單有 40 列，使用者剛才在第 32 列。
- 頁首是 `position: sticky` 的導覽列，在某幾頁會蓋在視窗上面，原因是視窗被放在一個有 `transform` 的容器裡。
- 手機上，在視窗裡往下滑，後面的清單跟著捲。

這幾個問題都是浮層的基本行為：焦點去哪、Esc 怎麼關、背景能不能操作、誰蓋在誰上面。原生的 `<dialog>` 與 `popover` 已經處理掉大部分。

## 運作原理

### 浮層的種類

| 元件 | 擋住其他操作 | 開啟時焦點 | 怎麼關 | 原生做法 | ARIA |
|---|---|---|---|---|---|
| Dialog（modal） | 擋 | 移進 Dialog | Esc、關閉按鈕 | `<dialog>` + `showModal()` | `dialog`（`aria-modal`） |
| Alert dialog | 擋 | 移到比較安全的按鈕 | Esc、選擇其中一個 | 同上 | `alertdialog` |
| Drawer（Sheet） | 通常擋 | 移進 Drawer | Esc、關閉按鈕、（選用）點背景 | 同上，改位置 | `dialog` |
| Popover | 不擋 | 不移動（除非裡面有 `autofocus`） | 點外面、Esc | `popover` 屬性 | 依內容而定 |
| Tooltip | 不擋 | 留在觸發元素 | 移開滑鼠、失去焦點、Esc | 沒有完整對應 | `tooltip` |

選擇的順序：使用者一定要處理才能繼續嗎（Dialog、Drawer）？是附屬在某個按鈕旁的設定或資訊，而且裡面有可以點的東西嗎（Popover）？只是一句說明嗎（Tooltip）？

### Dialog 的焦點：開啟、留在裡面、還回去

WAI-ARIA APG 的 Dialog (Modal) 模式：

1. 開啟時焦點移到 Dialog 裡的元素，通常是第一個可聚焦的元素。內容很長時，先聚焦開頭的標題或段落（加 `tabindex="-1"`）；確認刪除這類不容易復原的操作，可以先聚焦比較安全的按鈕。
2. 開著的時候，Tab 與 Shift+Tab 只在 Dialog 裡移動，到了最後一個再按 Tab 回到第一個。
3. Esc 關閉。
4. 關閉後焦點回到開啟它的元素；那個元素不存在了，就移到接得上工作流程的地方。
5. 建議 Tab 順序裡一定有一顆看得見的關閉或取消按鈕。

APG 也提醒：`aria-modal="true"` 會讓部分輔助科技看不到 Dialog 以外的內容，所以只有在程式真的擋住了外面所有操作、外面也被遮暗時才標。用 `div` 做卻沒擋住背景，標了反而更糟。

### 原生 `<dialog>` 做了哪些事

照 WHATWG HTML 規範，呼叫 `showModal()` 時：

```text
showModal()
 ├─ 加上 open 屬性
 ├─ 文件被這個 Dialog「擋住」：Dialog 以外的內容變成 inert（不能點、不能聚焦）
 ├─ Dialog 放進 top layer，後面有一層 ::backdrop
 ├─ 記下目前有焦點的元素（previously focused element）
 └─ dialog focusing steps：Dialog 本身有 autofocus 就聚焦 Dialog，
    否則聚焦裡面有 autofocus 的元素，再不然是第一個可聚焦的元素

按 Esc（close request）
 ├─ 觸發 cancel 事件（可以 preventDefault 擋下；
 │   為了不讓頁面困住使用者，連按 Esc 時瀏覽器可能略過這一步）
 └─ 關閉：移除 open、離開 top layer、觸發 close 事件
     └─ 焦點還給剛才記下的元素
```

規範要求關閉 modal Dialog 時把焦點還給開啟前的元素；這一課沒有逐一實測各瀏覽器，驗收時照樣檢查。

幾個常用的部分：

- `close(value)` 關閉並把 `returnValue` 設成 `value`。
- Dialog 裡的 `<form method="dialog">` 送出時直接關閉 Dialog，按下的按鈕的 `value` 成為 `returnValue`，不會發出網路請求。
- `::backdrop` 是後面那層遮罩的樣式；`:modal` 選得到目前以 modal 開啟的 Dialog（Baseline 2022）。
- 在最後一個元素再按 Tab，焦點不會走到頁面其他元素；依瀏覽器而定，可能移到網址列這類瀏覽器介面，而不是繞回 Dialog 的第一個元素。

`<dialog>` 是 Baseline 2022。較新的屬性要看支援狀態（依 2026-11 的 web-features 資料）：

| 功能 | 做什麼 | 狀態 |
|---|---|---|
| `closedby="any"` | 點背景也能關閉 Dialog | 還不是 Baseline（Chrome 134、Firefox 141 起，Safari 尚未支援） |
| `command="show-modal"`、`commandfor` | 按鈕不寫 JavaScript 就能開關 Dialog 或 popover | Baseline 2025（2025 年 12 月） |

### Popover

`popover` 屬性讓任何元素變成浮層，`popovertarget` 指定由哪顆按鈕開關（Baseline 2025，2025 年 1 月）：

```html
<button popovertarget="filters">篩選</button>
<div id="filters" popover>
  <label><input type="checkbox" name="status" value="waiting"> 只看候診</label>
</div>
```

| `popover` 的值 | 點外面或 Esc 會關（light dismiss） | 開啟時關掉其他 popover |
|---|---|---|
| `auto`（寫 `popover` 不帶值就是這個） | 會 | 會（祖先除外） |
| `manual` | 不會，要自己關 | 不會 |
| `hint` | 會 | 只關其他 `hint`；還不是 Baseline |

Popover 同樣放在 top layer，但不會讓頁面其他部分 inert，也不困住焦點。開啟時焦點不會自動移進去，除非裡面有 `autofocus` 的元素；`auto` popover 關閉時，如果焦點在 popover 裡，會還給開啟前有焦點的元素。

把 popover 定位在按鈕旁邊的 CSS anchor positioning，依 2026-11 的 web-features 資料還不是 Baseline，目前多半用 Floating UI 這類函式庫，或自己用 `getBoundingClientRect()` 計算位置。

### Tooltip

APG 的 Tooltip 模式頁面標明「仍在進行中，還沒有工作小組的共識」，以下是它目前的說法：Tooltip 在觸發元素取得焦點或滑鼠移上去時出現，通常有一點延遲；Tooltip 本身拿不到焦點；Esc 關閉；觸發元素用 `aria-describedby` 指向 `role="tooltip"` 的元素。需要放可聚焦元素時，改用非 modal 的 Dialog。

WCAG 2.1 的 1.4.13 Content on Hover or Focus（AA）對 hover 或 focus 才出現的內容有三個要求：

- **可以關掉**：不移動滑鼠或焦點也能關（例如 Esc）。
- **滑鼠移得上去**：滑鼠從觸發元素移到 Tooltip 上，Tooltip 不能消失。
- **不自己消失**：直到移開、關掉或資訊失效之前都留著。

瀏覽器內建的 `title` 提示是這條的例外，但它多半只在滑鼠停留時出現，鍵盤與觸控使用者看不到，重要的說明不要只放在 `title`。

### Drawer 與手機

Drawer 是位置不同的 Dialog：從側邊或底部滑出，擋住頁面時規則和 modal Dialog 完全一樣。手機上常把置中的 Dialog 改成從底部滑出的 Sheet，只改 CSS，不改行為。

### 背景捲動與 top layer

`showModal()` 讓背景不能點、不能聚焦，但滾輪與觸控捲動仍可能捲到後面的頁面。常見的做法：

```css
body:has(dialog[open]) { overflow: hidden; }    /* Dialog 開著時，頁面不捲動 */
dialog { overscroll-behavior: contain; }         /* Dialog 自己捲到底時，不把捲動傳給頁面 */
```

`:has()` 是 Baseline 2023。

用 `position: fixed` 加 `z-index` 做的浮層，只要某個祖先建立了 stacking context（`transform`、`filter`、`opacity` 小於 1、有 `z-index` 的定位元素…），它的 `z-index` 就只在那個祖先裡比較，蓋不過祖先外面的 sticky 導覽列。祖先有 `transform` 或 `filter` 時，`position: fixed` 還會改成以那個祖先定位，祖先的 `overflow: hidden` 也會把它切掉。top layer 的元素不受祖先的 stacking context、`transform` 與 `overflow` 影響，這些問題都不會發生。

## 實際程式

確認取消預約的 Dialog，用原生 `<dialog>`：

```vue
<script setup>
import { useTemplateRef, nextTick } from 'vue'

const props = defineProps({ appt: { type: Object, required: true } })   // { id, date, time }
const emit = defineEmits(['cancelled'])
const dialog = useTemplateRef('dialog')            // Vue 3.5

function open() {
  dialog.value.returnValue = ''                    // Esc 關閉時不會改 returnValue，先清掉上一次的值
  dialog.value.showModal()                         // 焦點移到有 autofocus 的「保留預約」
}

async function onClose() {
  if (dialog.value.returnValue !== 'confirm') return   // Esc 或「保留預約」：焦點自動回到觸發按鈕
  await fetch(`/api/appointments/${props.appt.id}`, { method: 'DELETE' })
  emit('cancelled', props.appt.id)                 // 父元件移除這一列，觸發按鈕跟著消失
  await nextTick()
  document.getElementById('appt-list-title')?.focus()   // 觸發按鈕不在了：移到清單標題（tabindex="-1"）
}
</script>

<template>
  <button type="button" class="btn danger ghost" @click="open">取消預約</button>

  <dialog ref="dialog" aria-labelledby="cancel-title" aria-describedby="cancel-desc"
          role="alertdialog" @close="onClose">
    <h2 id="cancel-title">取消 {{ appt.date }} {{ appt.time }} 的預約？</h2>
    <p id="cancel-desc">取消後名額會開放給其他人，無法復原。</p>
    <form method="dialog">
      <button value="keep" autofocus>保留預約</button>
      <button value="confirm" class="btn danger">確定取消</button>
    </form>
  </dialog>
</template>

<style scoped>
dialog { border: 0; border-radius: var(--radius-md); padding: var(--space-6); max-inline-size: min(28rem, 100vw - 2rem); }
dialog::backdrop { background: rgb(0 0 0 / 0.5); }
@media (max-width: 600px) {                         /* 手機：從底部滑出的 Sheet，行為不變 */
  dialog { margin: auto 0 0; inline-size: 100%; max-inline-size: 100%; border-radius: var(--radius-md) var(--radius-md) 0 0; }
}
</style>
```

- `<form method="dialog">` 讓兩顆按鈕都直接關閉 Dialog，按下的按鈕的 `value` 進到 `returnValue`；按 Esc 關閉時 `returnValue` 維持原值，所以 `open()` 先把它清成空字串。
- `role="alertdialog"` 用在要使用者確認的 Dialog；一般的表單 Dialog 不用寫，`<dialog>` 預設的角色就是 `dialog`。
- 不寫 `aria-modal`：`showModal()` 開的 Dialog，背景的 inert 與 modal 狀態由瀏覽器處理。

在 `setup` 頂層、也就是元件掛載前呼叫 `dialog.value.showModal()`，`dialog.value` 還是 `null`，錯誤訊息是 `Cannot read properties of null (reading 'showModal')`。只在使用者操作（`@click`）或 `onMounted` 之後呼叫。

## 常見錯誤

- **用 `:open` 綁定開關 Dialog**：`<dialog :open="show">` 開出的是非 modal 的 Dialog，背景能操作、沒有 `::backdrop`、Esc 不會關。要用 `showModal()`。
- **對已經開著的 Dialog 呼叫 `showModal()`**：用 `open` 屬性或 `show()` 開過的 Dialog 再呼叫 `showModal()`，會丟出 `InvalidStateError`；Dialog 不在 DOM 裡時呼叫也一樣。
- **關閉後焦點掉到 `body`**：自己做的 Dialog 沒記下觸發元素。Console 建立 live expression `document.activeElement` 一看就知道。
- **在 `keydown` 自己處理 Esc，又用了原生 `<dialog>`**：兩邊都關一次，或 `preventDefault()` 擋掉了原生的關閉。取消原生行為請聽 `cancel` 事件。
- **Tooltip 裡放連結**：滑鼠移過去 Tooltip 就消失，鍵盤也到不了。改用 Popover。
- **Tooltip 只聽 `mouseenter`**：Tab 到觸發元素時不出現，鍵盤使用者看不到說明。
- **`z-index: 9999` 還是被蓋住**：浮層在一個建立了 stacking context 的祖先裡。改用 top layer，或把浮層用 `<Teleport to="body">` 搬到 `body` 底下。
- **點背景關閉，填到一半的表單不見了**：有輸入內容的 Dialog，點背景不要關閉，或關閉前確認。

AI 產生的 Dialog 最常見的是 `div` 加 `v-if` 加 `z-index`：沒有焦點移動、沒有 Esc、背景沒有 inert。描述需求時指定「用原生 `<dialog>` 的 `showModal()`」，並寫出開啟與關閉時焦點的位置。

## 動手

1. 打開 [互動狀態實驗室](#/lab/UiStatesLab)，選「Dialog」：點舞台上的「取消預約」或用 Tab 移過去按 Enter，看焦點紀錄；在 Dialog 裡連按 Tab，看焦點怎麼繞回第一個；按 Esc，確認焦點回到「取消預約」；再試「確定取消」，看觸發按鈕不在時焦點去哪。
2. 在自己的專案找一個 Dialog，Console 建立 live expression `document.activeElement`，開啟、Tab 三次、Esc，記下每一步的值。
3. Elements 分頁打開一個用 `showModal()` 開的 Dialog，找到 `#top-layer`；再找一個用 `z-index` 做的浮層，比較兩者在 DOM 樹裡的位置。
4. 打開 [浮層疊放實驗室](#/lab/OverlayLab)：先開 Dialog 再推播 Toast，看 Toast 為什麼點不到；切到「div + z-index」並打開「main 有 transform」，看 `z-index: 9999` 為什麼蓋不過頁首；按 Esc，看關掉的是哪一層。
5. 把一個用 `title` 寫的說明改成 Tooltip，照 1.4.13 的三個要求逐一驗收。
6. Dialog 裡的表單送出與錯誤怎麼顯示，接著讀 [回饋：Toast、Alert、Skeleton、Empty state](#/skill/feedback)。

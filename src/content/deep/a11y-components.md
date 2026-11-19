## 從一個具體問題開始：Lighthouse 0 個錯誤的選單，鍵盤打不開

預約清單每一列右邊有一顆「更多操作」，按下去出現「改期」「列印掛號單」「取消預約」三項。這個元件是請 AI 產生的，標記看起來很完整：

```html
<button type="button" aria-haspopup="menu" aria-expanded="false" @click="open = !open">更多操作</button>
<ul v-show="open" role="menu" aria-label="更多操作">
  <li role="menuitem" @click="reschedule">改期</li>
  <li role="menuitem" @click="print">列印掛號單</li>
  <li role="menuitem" @click="cancel">取消預約</li>
</ul>
```

Lighthouse 的 Accessibility 項目沒有報任何錯，用 `@axe-core/playwright` 掃也是 0 個違規。換成只用鍵盤操作：

1. Tab 到「更多操作」按 Enter，選單出現了，焦點還停在按鈕上。
2. 按 ↓，頁面往下捲了一段，選單裡沒有任何一項被反白。
3. 按 Tab，焦點跳過整個選單，直接到下一列；選單還開著。
4. 按 Esc 沒有反應。
5. 用 Elements 分頁看按鈕，選單開著時 `aria-expanded` 仍然是 `"false"`。

螢幕閱讀器使用者的狀況更糟：按鈕被念成類似「更多操作，選單按鈕，已收合」的句子，按了 Enter 之後聽不到任何變化，選單裡的項目也走不進去。

修好鍵盤之後，測試又抓到第二個問題：從選單選「取消預約」會開一個確認用的 `<dialog>`，按 Esc 關掉 Dialog 後，焦點掉到了 `body`，下一次 Tab 從頁首重新開始。

兩個問題都不在 axe 的檢查範圍裡。axe 檢查的是結構：角色的父子關係、屬性值合不合法、有沒有名稱；它不按鍵盤，也不知道 `aria-expanded` 該在什麼時候變。這一課處理的是「怎麼驗收」：把 WAI-ARIA Authoring Practices Guide（APG）的模式頁變成一張驗收表，再決定每一條用什麼工具驗。各元件的完整規則在其他課：Dialog 在 [浮層](#/skill/overlays)、Combobox 在 [選擇類元件](#/skill/select-combobox)、Tabs 在 [導覽元件](#/skill/navigation-ui)。

## 運作原理

### role 是承諾

APG 的 Read Me First 頁開頭有兩條原則。第一條是「A role is a promise」：寫下 `<div role="button">`，等於承諾也寫好了按鈕該有的鍵盤操作，因為 ARIA 角色不會讓瀏覽器提供任何鍵盤行為或樣式。同一頁的標題是「No ARIA is better than Bad ARIA」：角色寫錯或沒兌現，對螢幕閱讀器使用者的傷害比完全不寫還大。

上面的選單把三件事承諾給輔助科技：這是一顆會開出選單的按鈕（`aria-haspopup="menu"`），它目前是收合的（`aria-expanded`），選單裡的項目要用方向鍵移動（`role="menu"`、`role="menuitem"`）。程式一件都沒做到。

### 把模式頁改寫成驗收表

APG 每個模式頁都有固定的兩節：

- **Keyboard Interaction**：每一列是「焦點在哪裡時，按什麼鍵，會發生什麼」。標了 Optional 的是選用行為。
- **WAI-ARIA Roles, States, and Properties**：用哪些角色、哪些屬性要跟著狀態改變、名稱從哪裡來。

把這兩節改寫成三欄（按鍵、焦點去哪、屬性變成什麼），就是驗收表。Menu Button 模式加上 Menu 模式裡和它有關的部分：

| 起點 | 按鍵 | 焦點去哪 | 屬性 |
|---|---|---|---|
| 按鈕 | Enter、Space | 選單第一項 | 按鈕 `aria-expanded="true"` |
| 按鈕 | ↓（選用） | 選單第一項 | 同上 |
| 按鈕 | ↑（選用） | 選單最後一項 | 同上 |
| 選單項目 | ↓、↑ | 下一項、上一項（到頭時可以繞回） | 不變 |
| 選單項目 | Home、End | 第一項、最後一項（APG 寫在方向鍵不繞回的情況） | 不變 |
| 選單項目 | Enter | 執行這一項、關閉選單 | `aria-expanded="false"` |
| 選單項目 | Esc | 關閉選單，焦點回到按鈕 | `aria-expanded="false"` |
| 選單項目 | Tab | 關閉選單，焦點照常移到頁面上的下一個元素 | `aria-expanded="false"` |

屬性的部分：按鈕是 `button`（原生 `<button>` 就好）、有 `aria-haspopup`（值是 `menu` 或 `true`）；選單是 `role="menu"`，名稱來自 `aria-labelledby` 指向按鈕，或 `aria-label`；每一項是 `menuitem`，用 roving tabindex 時 `tabindex="-1"`。`aria-controls` 指向選單是選用的。

寫成表之後，每一列都是一個能自動化的測試：「焦點在按鈕，按 ↑，最後一項取得焦點，按鈕的 `aria-expanded` 是 `true`」。標 Optional 的列先決定做不做，寫進規格，驗收時才不會各說各話。

### composite widget：整組只佔一個 Tab 停留點

APG 的 Developing a Keyboard Interface 頁說明了所有模式共用的慣例：Tab 與 Shift+Tab 在元件之間移動，方向鍵在元件裡面移動。含有多個可聚焦項目的元件（Tabs、Menu、Listbox、Radio group、Grid）在 ARIA 規格裡叫 composite widget，整組在 Tab 順序裡只有一個位置。

Tab 進入時停在哪一項，依元件而定：

| 元件 | Tab 進入時的焦點 |
|---|---|
| Tabs、Listbox、Radio group | 目前選取（勾選）的那一項；沒有就第一項 |
| Grid | 上一次離開時的那一格；第一次進入是第一格 |
| Menubar、Toolbar | 第一項 |
| Menu（由按鈕開出來） | Tab 不會進入選單，開選單時由程式把焦點移進去 |

驗收時最容易看出問題的一招：從元件前一個元素開始連按 Tab。每個 tab、每個選單項目都停一次，代表整組都設成了 `tabindex="0"`（或全是原生按鈕），沒照模式做。

### 兩種管理焦點的方法

元件內的焦點有兩種做法，驗收的方法不一樣：

```text
roving tabindex（Tabs、Menu、Radio group 常用）
  <button role="tab" tabindex="-1">預約</button>
  <button role="tab" tabindex="0">已報到</button>   ← 目前的項目；document.activeElement 就是它
  <button role="tab" tabindex="-1">已取消</button>
  按 → ：已報到改成 -1，已取消改成 0，呼叫 已取消.focus()

aria-activedescendant（Combobox 常用）
  <input role="combobox" aria-activedescendant="doc-3">   ← DOM 焦點一直在這裡
  <ul role="listbox">
    <li id="doc-1" role="option">王醫師</li>
    <li id="doc-3" role="option">林醫師</li>              ← 輔助科技視為目前的項目，畫面要畫出反白
  按 ↓ ：只改 aria-activedescendant 的值，DOM 焦點不動
```

| | roving tabindex | `aria-activedescendant` |
|---|---|---|
| `document.activeElement` | 跟著方向鍵換人 | 一直是容器或輸入框 |
| 要檢查的屬性 | 只有一項是 `tabindex="0"` | 屬性值有沒有換、指到的 id 存不存在 |
| 捲動 | 瀏覽器會把取得焦點的元素捲進畫面 | 程式要自己捲動 |
| 反白樣式 | 用 `:focus-visible` | 程式自己加 class，焦點框不會自動出現 |

`aria-activedescendant` 指到的元素有位置限制：要在容器的 DOM 裡面、或被 `aria-owns` 收進來；Combobox 這類輸入框的例外是透過 `aria-controls` 指到清單，選項在清單裡。

### 焦點與選取是兩件事

APG 特別區分 focus 與 selection。焦點是目前操作的位置，同一時間只有一個（`document.activeElement`）；選取是一種狀態，例如 `aria-selected="true"` 的 tab、`aria-checked="true"` 的選項，離開元件後仍然保留。

單選的 Tabs 與 Listbox 可以讓「選取跟著焦點」：→ 移到下一個 tab 時直接顯示它的內容。APG 的建議是內容已經在 DOM 裡、切換沒有延遲時才這樣做；每切一次就要等 API 的內容，改成方向鍵只移動焦點、按 Enter 或 Space 才切換，否則鍵盤使用者每按一次方向鍵就要等一次載入。驗收時兩件事分開看：焦點有沒有移動、`aria-selected` 有沒有換到對的那一個。

### 各模式的驗收重點

| 模式 | 焦點方法 | 一定要測的按鍵 | 一定要查的屬性 | 完整規則 |
|---|---|---|---|---|
| Tabs | roving tabindex | Tab 只停目前的 tab；←→ 繞回；再按 Tab 進入 tabpanel | 只有一個 `aria-selected="true"`；`aria-controls` 與 tabpanel 的 `aria-labelledby` 互相對得到 | [導覽元件](#/skill/navigation-ui) |
| Menu Button | roving tabindex | Enter 開選單焦點到第一項；Esc 關閉焦點回按鈕；Tab 關閉 | `aria-expanded` 跟著開關；menu 有名稱 | 本課 |
| Combobox | `aria-activedescendant` | ↓ 開清單；Enter 選取；Esc 關清單、保留值 | `aria-expanded`；`aria-activedescendant` 指到存在的 option | [選擇類元件](#/skill/select-combobox) |
| Dialog（modal） | 焦點移進 Dialog | Tab 不會走到背景；Esc 關閉；焦點回到觸發的按鈕 | Role 是 `dialog`、Name 是標題 | [浮層](#/skill/overlays) |
| Disclosure、Accordion | 每顆按鈕都在 Tab 順序裡 | Enter、Space 切換 | `aria-expanded` 跟著切換；Accordion 的按鈕包在標題元素裡 | 本課 |

Disclosure 是最簡單也最常被做壞的一個：一顆按鈕控制一塊內容顯示與否，按鈕有 `aria-expanded`，選用的 `aria-controls` 指向那塊內容。Accordion 是一組 disclosure，APG 要求每顆標題按鈕包在一個標題元素裡（例如 `<h3><button aria-expanded="false">看診須知</button></h3>`），而且按鈕是標題裡唯一的元素。AI 常見的寫法是 `<div class="accordion-header" @click>`：不在 Tab 順序裡，也沒有 `aria-expanded`。

不需要客製行為時，Disclosure 與 Accordion 直接用原生的 `<details>` 與 `<summary>`：`<summary>` 本身可以聚焦、Enter 與 Space 會切換、展開狀態由瀏覽器提供給輔助科技，不必寫 `aria-expanded` 與按鍵處理（Baseline Widely available）。同一組只能開一個時，每個 `<details>` 寫同樣的 `name="faq"`，這是 Baseline 2024（2024-09 起），舊瀏覽器上退化成可以同時展開幾個，內容照樣看得到。要驗的只剩 `<summary>` 的文字念不念得懂，以及標題層級合不合理。

### 每種工具抓得到什麼

| 工具 | 抓得到 | 抓不到 |
|---|---|---|
| Lighthouse、axe（`@axe-core/playwright`） | 角色的父子關係錯誤、屬性值不合法（包含指到不存在的 id）、缺少必要屬性、缺少名稱 | 按鍵有沒有作用、屬性有沒有跟著狀態改變、焦點去哪 |
| DevTools 的 Accessibility 分頁 | 某個元素此刻的 Role、Name、狀態；整棵 accessibility tree | 操作過程中的變化（要自己一邊按一邊看） |
| 元件測試（jsdom 加 user-event） | 按鍵後的焦點、`aria-*` 的值、emit 的事件 | `<dialog>` 的 `showModal()`、top layer、版面、捲動 |
| Playwright、Vitest Browser Mode | 上面全部，加上真的 `<dialog>`、焦點回復、可見性 | 念出來聽不聽得懂 |
| NVDA、VoiceOver 實測 | 角色、名稱、狀態變化念出來的樣子，跨元件的操作流程 | 不會留下可以重跑的紀錄 |

開頭那個選單，用 `@axe-core/playwright` 對它掃描得到 0 個違規；同一個測試裡按 Enter 再按 ↓，`document.activeElement` 仍然是按鈕。axe 的結果只能當「結構沒錯」的證據。

## 實際程式碼

### 照驗收表寫的 Menu Button

```vue
<script setup>
import { ref, useTemplateRef, nextTick, useId } from 'vue'

const props = defineProps({ items: { type: Array, required: true } })   // [{ key, label }]
const emit = defineEmits(['select'])
const open = ref(false)
const current = ref(0)
const button = useTemplateRef('button')
const itemEls = useTemplateRef('item')       // v-for 裡的 ref 是陣列
const uid = useId()                           // Vue 3.5：產生穩定的 id，給 aria-controls 用

async function openMenu(index) {
  open.value = true
  current.value = index
  await nextTick()                            // 等 v-show 讓選單出現，才能 focus()
  itemEls.value[index].focus()
}
function closeMenu({ restoreFocus = true } = {}) {
  open.value = false
  if (restoreFocus) button.value.focus()
}
function onButtonKeydown(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); openMenu(0) }
  if (e.key === 'ArrowUp') { e.preventDefault(); openMenu(props.items.length - 1) }
}
function onMenuKeydown(e) {
  const n = props.items.length
  const moves = { ArrowDown: current.value + 1, ArrowUp: current.value - 1, Home: 0, End: n - 1 }
  if (e.key in moves) {
    e.preventDefault()                        // 方向鍵不要捲動頁面
    current.value = (moves[e.key] + n) % n    // 到頭時繞回
    itemEls.value[current.value].focus()
  } else if (e.key === 'Escape') {
    closeMenu()
  } else if (e.key === 'Tab') {
    closeMenu({ restoreFocus: false })        // 不 preventDefault：讓 Tab 照常移到下一個元素
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    choose(current.value)
  }
}
function choose(i) {
  closeMenu()                                 // 先把焦點還給按鈕，再通知父元件（父元件可能接著開 Dialog）
  emit('select', props.items[i].key)
}
</script>

<template>
  <button ref="button" :id="`${uid}-btn`" type="button" aria-haspopup="menu"
          :aria-expanded="open ? 'true' : 'false'" :aria-controls="`${uid}-menu`"
          @click="open ? closeMenu() : openMenu(0)" @keydown="onButtonKeydown">
    更多操作
  </button>
  <ul v-show="open" :id="`${uid}-menu`" role="menu" :aria-labelledby="`${uid}-btn`" @keydown="onMenuKeydown">
    <li v-for="(it, i) in items" :key="it.key" ref="item" role="menuitem" tabindex="-1" @click="choose(i)">
      {{ it.label }}
    </li>
  </ul>
</template>
```

Enter 與 Space 在原生 `<button>` 上本來就會觸發 `click`，所以按鈕只需要另外處理 ↓ 與 ↑。`aria-expanded` 寫成 `'true'`、`'false'` 字串。Vue 3 綁定 `false` 到 `aria-*` 這類非布林屬性時，會輸出成 `aria-expanded="false"`（要移除屬性得綁 `null`），寫成字串讀起來比較不會誤會。

這個版本用 `v-show` 藏選單，點選單外面不會關閉，選單也可能被外層的 `overflow: hidden` 裁掉。選單容器改成 `<ul popover>`（Popover API，Baseline 2025-01 起），瀏覽器提供點外面關閉（light dismiss）與 top layer；開關改呼叫 `showPopover()`、`hidePopover()`，在 `toggle` 事件裡更新 `aria-expanded` 並把焦點移進選單。方向鍵、Home、End 仍然要自己寫：Chrome 團隊的 Modern Web Guidance 建議的 `focusgroup` 屬性目前只有 Chrome、Edge 150 起支援（Limited availability），不支援的瀏覽器要照上面的方式補 `role="menu"` 與按鍵處理。Popover 到 2025-01 才在 iOS Safari 18.3 補齊，要支援更舊的瀏覽器時也要退路（例如 `@oddbird/popover-polyfill`，只在 `HTMLElement.prototype` 沒有 `popover` 時載入），或維持上面的 `v-show` 寫法。

`choose()` 裡兩行的順序是開頭第二個問題的修法。原本先 `emit` 再 `closeMenu()`：父元件收到事件立刻呼叫 `showModal()`，瀏覽器把當時有焦點的選單項目記成「開啟前的元素」；接著選單被 `v-show` 藏起來，`button.focus()` 也因為 Dialog 讓背景 inert 而沒有作用。關閉 Dialog 時，瀏覽器想把焦點還給那個已經隱藏的選單項目，焦點就掉到了 `body`。

### 元件測試：一列驗收表一個斷言

```js
// src/components/__tests__/MoreActions.spec.js
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import MoreActions from '../MoreActions.vue'

const items = [
  { key: 'reschedule', label: '改期' },
  { key: 'print', label: '列印掛號單' },
  { key: 'cancel', label: '取消預約' },
]

describe('MoreActions：APG 的 Menu Button 模式', () => {
  it('Enter 開選單、焦點到第一項；↑ 繞到最後一項；Esc 關閉並回到按鈕', async () => {
    const user = userEvent.setup()
    render(MoreActions, { props: { items } })
    const btn = screen.getByRole('button', { name: '更多操作' })
    expect(btn).toHaveAttribute('aria-expanded', 'false')

    await user.tab()                                   // 從頁面開頭 Tab 進來
    await user.keyboard('{Enter}')
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menuitem', { name: '改期' })).toHaveFocus()

    await user.keyboard('{ArrowUp}')                   // 第一項再往上：繞到最後一項
    expect(screen.getByRole('menuitem', { name: '取消預約' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(btn).toHaveFocus()
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()   // v-show 隱藏的元素不在 accessibility tree
  })

  it('按鈕上按 ↑ 聚焦最後一項，Enter 選取並 emit', async () => {
    const user = userEvent.setup()
    const { emitted } = render(MoreActions, { props: { items } })
    await user.tab()
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: '取消預約' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(emitted().select).toEqual([['cancel']])
    expect(screen.getByRole('button', { name: '更多操作' })).toHaveFocus()
  })
})
```

`screen.queryByRole('menu')` 在選單用 `v-show` 藏起來時回傳 `null`：Testing Library 預設排除不在 accessibility tree 裡的元素（`display: none`、`hidden`、`aria-hidden="true"`），和螢幕閱讀器看到的一致。

這兩個測試在 `choose()` 順序寫錯的版本上也會通過：jsdom 31 的 `<dialog>` 沒有 `showModal()`，元件測試開不了 Dialog。焦點回復要在真的瀏覽器裡測。

### Playwright：跨元件的焦點回復

```js
// e2e/appointment-actions.spec.js
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('從選單取消預約：Esc 關掉 Dialog 後焦點回到「更多操作」', async ({ page }) => {
  await page.goto('/appointments')
  const more = page.getByRole('button', { name: '更多操作' })
  await more.focus()
  await page.keyboard.press('ArrowUp')
  await expect(page.getByRole('menuitem', { name: '取消預約' })).toBeFocused()
  await page.keyboard.press('Enter')

  const dialog = page.getByRole('dialog', { name: '取消 11/20 09:00 的預約？' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: '保留預約' })).toBeFocused()   // autofocus
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(more).toBeFocused()
})

test('Tabs 的結構', async ({ page }) => {
  await page.goto('/appointments')
  await expect(page.getByRole('tablist', { name: '掛號狀態' })).toMatchAriaSnapshot(`
    - tablist "掛號狀態":
      - tab "預約" [selected]
      - tab "已報到"
      - tab "已取消"
  `)
})

test('axe：選單打開的狀態也掃一次', async ({ page }) => {
  await page.goto('/appointments')
  await page.getByRole('button', { name: '更多操作' }).click()
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(results.violations).toEqual([])
})
```

`toMatchAriaSnapshot` 比對的是 accessibility tree 的角色、名稱與狀態（`[selected]`），結構寫錯（tab 不在 tablist 底下、少了名稱）會直接失敗。axe 只掃當下的 DOM，選單、Dialog、錯誤訊息這類要操作才出現的部分，要先操作到那個狀態再掃。

## 常見錯誤與錯誤訊息

axe（Lighthouse 也用它）對常見結構錯誤的訊息，左欄是規則 id，下面的訊息取自 axe-core 4.14.1 的實際輸出：

| 規則 | 訊息 | 原因 |
|---|---|---|
| `aria-required-parent` | `Certain ARIA roles must be contained by particular parents`，細節 `Required ARIA parent role not present: tablist` | `role="tab"` 沒有包在 `role="tablist"` 裡 |
| `aria-required-children` | `Certain ARIA roles must contain particular children`，細節 `Element has children which are not allowed: li` | `role="menu"` 底下有沒標 `menuitem` 的 `li` |
| `aria-valid-attr-value` | `ARIA attributes must conform to valid values`，細節 `Invalid ARIA attribute value: aria-activedescendant="doc-9"` | 指到不存在的 id；`aria-selected="yes"` 這種不合法的值也是這條 |
| `aria-required-attr` | `Required ARIA attributes must be provided`，細節 `Required ARIA attribute not present: aria-checked` | `role="switch"` 沒有 `aria-checked` |
| `aria-dialog-name` | `ARIA dialog and alertdialog nodes should have an accessible name` | Dialog 沒有 `aria-labelledby` 或 `aria-label` |

axe 沒有訊息、要靠測試或手動抓的：

- **`aria-expanded` 寫死**：`aria-expanded="false"` 寫成靜態屬性，開關時不變。Elements 分頁一邊按一邊看；測試裡斷言開啟後是 `"true"`。
- **每個 tab 都是 `tabindex="0"`**：Tab 鍵要一格一格走過每個 tab。測試裡 `await user.tab()` 兩次，第二次焦點應該已經在 tabpanel。
- **選單項目沒有 `tabindex="-1"`**：`li` 不能被 `focus()`，呼叫了也沒效果，焦點留在原地。Testing Library 的訊息會是 `expect(element).toHaveFocus()` 失敗，列出目前有焦點的元素。
- **方向鍵沒有 `preventDefault()`**：按 ↓ 時焦點移到下一項，頁面也跟著捲一段。
- **焦點回到 `body`**：觸發的元素被隱藏或移除。Playwright 的訊息是：

```text
Error: expect(locator).toBeFocused() failed

Locator:  getByRole('button', { name: '更多操作' })
Expected: focused
Received: inactive
```

  在 Console 建立 live expression `document.activeElement`，一步一步操作，就能看到它在哪一步變成 `body`。

- **`role="menu"` 用在網站導覽**：一般的導覽列用連結加 disclosure 按鈕，APG 的 Disclosure Navigation Menu 範例特別註明沒有用 menu 角色。寫成 menu，螢幕閱讀器使用者會照應用程式選單的方式操作，Tab 卻又走得進去。
- **Accordion 的標題按鈕不在標題元素裡**：螢幕閱讀器的使用者常用「跳到下一個標題」瀏覽頁面，按鈕沒有包在 `h2`、`h3` 裡就跳不到。
- **自動化全綠就收工**：axe、元件測試都過了，仍然要用 NVDA 或 VoiceOver 念一遍。APG 的 Read Me First 也提醒，各瀏覽器與螢幕閱讀器的支援程度不同，上線前要在目標使用者會用的組合上實測。

## 動手

1. 在自己的專案挑一個自製的元件（選單、Tabs、手風琴），打開 APG 對應的模式頁，把 Keyboard Interaction 與 Roles, States, and Properties 改寫成本課那種三欄的驗收表，標出 Optional 的列決定做不做。
2. 在 Console 建立 live expression `document.activeElement`，照驗收表一列一列按，記下哪一列的焦點或屬性不對。
3. Elements 分頁選取元件，打開 Accessibility 分頁勾 `Show accessibility tree`，確認 tab 在 tablist 底下、menuitem 在 menu 底下、每個節點都有 Name。
4. 跑一次 Lighthouse 的 Accessibility，再用 `@axe-core/playwright` 在「選單打開」「Dialog 打開」的狀態各掃一次，比較兩者抓到的東西。
5. 把驗收表的每一列寫成測試：鍵盤與屬性用 Testing Library 加 user-event（寫法見 [元件測試的寫法](#/skill/component-tests)），牽涉 `<dialog>` 與焦點回復的用 Playwright（見 [Playwright E2E](#/skill/e2e-playwright)）。寫完故意刪掉 `focus()` 或 `aria-expanded` 的綁定，確認測試會變紅。
6. 開 VoiceOver（macOS 按 Cmd+F5）或 NVDA，操作一次選單，記下按鈕念了什麼、開關時有沒有念出「已展開」。基本的名稱與 live region 回頭看 [無障礙基礎](#/skill/a11y-basics)。

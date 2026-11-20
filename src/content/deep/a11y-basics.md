## 從一個具體問題開始：滑鼠點得完，鍵盤走不完

線上掛號表單上線後，Lighthouse 的 Accessibility 分數是 92。幾週後，醫院收到一位視障病患的陳情：他用 NVDA 螢幕閱讀器與鍵盤，完成不了掛號。請同事只用鍵盤、開著 VoiceOver 走一遍，問題一個接一個出現：

1. 看診日期用的是自製的日曆，每一天是一個 `div` 加 `@click`。按 Tab 會直接跳過整個日曆，選不了日期。
2. 日期欄旁邊只有圖示的「清除」按鈕，螢幕閱讀器念出來只有「按鈕」。
3. 手機欄位沒有 `<label>`，只有淺灰色的 placeholder「請輸入手機號碼」，一開始輸入提示就不見了；淺灰色和白底的對比只有 2.85:1。
4. 欄位格式錯誤時只把邊框變紅。螢幕閱讀器什麼都沒念，紅綠色弱的使用者也看不出哪一格錯了。
5. 全站的 CSS 有一行 `*:focus { outline: none; }`，按 Tab 時看不到焦點停在哪裡。
6. 送出成功只在右上角跳出 3 秒的 Toast，螢幕閱讀器沒有念出來，使用者不知道掛號成功了沒有。

Lighthouse 只報了第 2 個（`Buttons do not have an accessible name`）。第 3 個它沒有報：Lighthouse 用的 axe 規則把非空的 `placeholder` 當成欄位有名稱，對比檢查也不包含 placeholder 的文字。其他四個要靠鍵盤與螢幕閱讀器實際操作才發現得了。

## 運作原理

### accessibility tree：輔助科技看到的頁面

瀏覽器除了把 DOM 畫成畫面，還會整理出一棵 accessibility tree 交給作業系統，螢幕閱讀器、語音控制、切換裝置都讀這棵樹。每個節點有三樣東西：

- **role**：它是什麼（`button`、`link`、`textbox`、`heading`、`checkbox`）。
- **name**：它叫什麼，螢幕閱讀器念出來的那串字。
- **state 與 property**：現在的狀態（勾選、展開、停用、無效）與描述。

同一段畫面，寫法不同，樹也不同：

```
DOM                                                          accessibility tree
<div class="day" @click="pick(20)">20</div>                  generic "20"            ← 不是按鈕、Tab 不會停
<button type="button" @click="pick(20)">20</button>          button "20"
<button class="icon"><svg>…</svg></button>                   button ""               ← 沒有名稱
<button aria-label="清除日期"><svg aria-hidden="true">…</svg></button>
                                                             button "清除日期"
<label for="phone">手機</label>
<input id="phone" aria-invalid="true" aria-describedby="phone-err">
<p id="phone-err">格式不正確，例如 0912345678</p>
                                                             textbox "手機"  invalid: true
                                                               description: "格式不正確，例如 0912345678"
```

Chrome 開發者工具在 Elements 選取元素後，右側 Accessibility 分頁的 Computed properties 顯示這個節點的 `Name`、`Role` 與狀態。

### 名稱從哪裡來

一個元素的名稱依下面的順序決定，找到就停：

| 順序 | 來源 | 例子 |
|---|---|---|
| 1 | `aria-labelledby` 指到的元素的文字 | `<dialog aria-labelledby="dlg-title">` |
| 2 | `aria-label` | `<button aria-label="清除日期">` |
| 3 | HTML 本身的標示 | `<label for>`、`<img alt>`、`<fieldset>` 的 `<legend>`、`<table>` 的 `<caption>` |
| 4 | 元素的文字內容（按鈕、連結、標題等） | `<button>送出掛號</button>` |
| 5 | `title`、`placeholder` | 最後的備案，不該依賴 |

`aria-label` 與 `aria-labelledby` 會蓋過元素原本的文字：按鈕寫著「送出」卻加了 `aria-label="submit"`，螢幕閱讀器念的是 submit。語音控制的使用者說「按送出」也點不到它。看得到的文字和名稱要一致。

圖片的 `alt`：

| 圖片 | `alt` |
|---|---|
| 傳達資訊（院區平面圖、看診流程圖） | 寫出圖片要傳達的內容，例如「門診大樓 2 樓，內科診間在電梯右側」 |
| 純裝飾（背景插圖、分隔花紋） | `alt=""`：螢幕閱讀器直接跳過 |
| 放在連結或按鈕裡、是唯一內容（Logo 連回首頁） | 寫出連結或按鈕的作用，例如「回到首頁」 |
| 圖片旁邊已經有同樣的文字 | `alt=""`，避免念兩次 |

完全沒寫 `alt` 和 `alt=""` 不一樣：沒寫時，部分螢幕閱讀器會念出檔名，例如「hero 底線 final 點 webp」。

### 鍵盤操作與焦點

鍵盤使用者（包含螢幕閱讀器、切換裝置的使用者）用這幾個鍵完成所有操作：

| 按鍵 | 作用 |
|---|---|
| Tab、Shift+Tab | 移到下一個、上一個可聚焦的元素 |
| Enter | 觸發連結與按鈕、送出表單 |
| Space | 觸發按鈕、勾選 checkbox |
| 方向鍵 | 在 radio 群組、選單、Tabs、日曆的格子之間移動 |
| Esc | 關閉 Dialog、選單、Popover |

原生的 `button`、`a href`、`input`、`select`、`textarea` 自動加入 Tab 順序、處理 Enter 與 Space。`div` 加 `@click` 這些都沒有。`tabindex` 的三種值：

| `tabindex` | 效果 | 用在哪裡 |
|---|---|---|
| `0` | 加入 Tab 順序，位置照 DOM 順序 | 自製元件且沒辦法用原生元素時 |
| `-1` | 不在 Tab 順序裡，但可以用 `el.focus()` 聚焦 | 換頁後要接住焦點的標題、錯誤摘要 |
| `1` 以上 | 排到所有元素前面，打亂整頁順序 | 不要用 |

要達到 WCAG 2.2 AA，焦點方面有三條：焦點順序要合理（2.4.3）、焦點框要看得見（2.4.7）、被聚焦的元素不能被固定的頁首或 Cookie 橫幅整個蓋住（2.4.11，2.2 新增）。

### 對比與「不只靠顏色」

對比值的算法是把兩個顏色換算成相對亮度 L，再算 (較亮的 L + 0.05) ÷ (較暗的 L + 0.05)，範圍從 1:1（同色）到 21:1（黑白）。WCAG 2.2 的 AA 等級：

| 對象 | 最低對比 |
|---|---|
| 一般文字 | 4.5:1 |
| 大字：18pt（約 24px）以上，或 14pt（約 18.66px）以上的粗體 | 3:1 |
| 非文字的元件與圖形：輸入框的邊框、焦點框、圖示、圖表的線 | 3:1 |
| 停用的元件、純裝飾、Logo | 沒有要求 |

另一條 A 等級的規定是不能只用顏色傳達資訊：錯誤欄位除了紅框還要有文字訊息，必填除了紅色星號還要有「（必填）」或在 label 裡說明，「可預約」與「額滿」除了綠紅兩色還要有文字或圖示。

WCAG 2.2 另外新增了點擊目標的最小尺寸（2.5.8，AA）：可以點的目標至少 24×24 CSS px，或彼此之間留夠間距。

### ARIA：補 HTML 沒有的東西

ARIA 屬性只改變 accessibility tree 裡的資訊，不會替元素加上任何行為：`<div role="button">` 被念成「按鈕」，但 Tab 停不到、按 Enter 沒反應，要自己補 `tabindex="0"` 與按鍵處理。W3C 的 Using ARIA 文件把這件事列為第一條規則：能用原生 HTML 元素就不要用 ARIA。

ARIA 該用的地方是 HTML 沒有對應元素或屬性的狀態與關係：

| 屬性 | 用途 |
|---|---|
| `aria-expanded` | 收合區塊、下拉選單的按鈕：目前展開了沒 |
| `aria-controls` | 這個按鈕控制哪個區塊 |
| `aria-invalid` | 欄位目前的值無效 |
| `aria-describedby` | 補充說明或錯誤訊息，念完名稱之後念 |
| `aria-current="page"` | 導覽列裡目前所在的頁面 |
| `aria-hidden="true"` | 從 accessibility tree 拿掉（裝飾用的圖示）。裡面不能有可以聚焦的元素 |
| `aria-live`、`role="status"`、`role="alert"` | 內容變化時念出來 |

### live region：讓變化被念出來

畫面上的內容改變時，螢幕閱讀器預設不會主動念。`role="status"`（等於 `aria-live="polite"`）會等目前的朗讀結束後念出新內容；`role="alert"`（`aria-live="assertive"`）會立刻打斷，用在需要馬上處理的錯誤。

螢幕閱讀器監聽的是「已經存在的容器裡的內容變化」。容器和訊息同時插進 DOM，很多螢幕閱讀器不會念。所以容器要從頁面一開始就在，之後只改它的文字。

### SPA 換頁時的焦點

一般網站換頁時整頁重新載入，焦點回到頁面開頭，螢幕閱讀器念出新的標題。SPA 用 History API 換頁，DOM 只換了一部分，焦點還停在剛剛點的連結上（或連結已經消失、焦點掉到 `body`），螢幕閱讀器的使用者不知道頁面換了。Vue Router 不會自動處理，常見做法是換頁後把焦點移到新頁面的 `h1`（給它 `tabindex="-1"`），並更新 `document.title`。Vue 官方文件的 Accessibility 頁建議換頁後把焦點移回頁面開頭的「跳到主要內容」連結前面。

:::stop 讀到這裡可以先停：會用 Accessibility 分頁查名稱與角色，只用鍵盤走完一個表單。後面的對比計算、修好的表單與錯誤訊息，在要修一個具體元件或對照 Lighthouse 報告時再回來讀。

## 一段可以跑的對比計算

下面照 WCAG 的公式計算幾組常見顏色的對比值，最後找出白底上最淺、仍然達到 4.5:1 的灰色：

```js run
// WCAG 2.x 的相對亮度與對比值：(較亮 + 0.05) / (較暗 + 0.05)
function luminance(hex) {
  const [r, g, b] = hex.replace('#', '').match(/../g)
    .map((h) => parseInt(h, 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))   // sRGB 轉成線性
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(fg, bg) {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const pairs = [
  ['#000000', '#ffffff', '黑字白底'],
  ['#767676', '#ffffff', '灰色說明文字'],
  ['#999999', '#ffffff', 'placeholder'],
  ['#ffffff', '#1565c0', '主要按鈕（白字藍底）'],
  ['#ffffff', '#e53935', '錯誤 Badge（白字紅底）'],
  ['#43a047', '#ffffff', '「可預約」綠字'],
  ['#e53935', '#43a047', '紅字綠底'],
]
for (const [fg, bg, label] of pairs) {
  const r = contrast(fg, bg)
  const normal = r >= 4.5 ? '過' : '不過'
  const large = r >= 3 ? '過' : '不過'
  console.log(`${fg} / ${bg}  ${r.toFixed(2).padStart(5)}:1  一般文字 ${normal.padEnd(2, '　')}  大字與元件 ${large.padEnd(2, '　')}  ${label}`)
}

// 找出白底上，灰色要多深才夠 4.5:1
for (let v = 0x99; v >= 0x60; v--) {
  const hex = '#' + v.toString(16).repeat(3)
  if (contrast(hex, '#ffffff') >= 4.5) { console.log(`\n白底上最淺的合格灰：${hex}（${contrast(hex, '#ffffff').toFixed(2)}:1）`); break }
}
```

`#999999` 這類常見的 placeholder 顏色只有 2.85:1；白字紅底的錯誤 Badge 拿來放一般大小的字也不夠。公式裡 sRGB 的門檻值 `0.04045` 是 WCAG 2.x 勘誤後的數字，舊版文件寫 `0.03928`，兩者算出的結果幾乎相同。

## 實際程式碼

### 修好的掛號表單

```vue
<script setup>
import { ref, nextTick, useTemplateRef } from 'vue'

const form = ref({ phone: '', date: '' })
const errors = ref({})
const status = ref('')                       // 寫進一直存在的 role="status" 容器
const phoneInput = useTemplateRef('phone')

async function submit() {
  errors.value = validate(form.value)
  if (errors.value.phone) {
    await nextTick()
    phoneInput.value.focus()                  // 焦點移到第一個錯誤的欄位
    return
  }
  const res = await createAppointment(form.value)
  status.value = `已完成掛號，號碼 ${res.number}`
}
</script>

<template>
  <form novalidate @submit.prevent="submit">
    <label for="phone">手機（必填）</label>
    <input id="phone" ref="phone" v-model="form.phone" type="tel" autocomplete="tel"
           :aria-invalid="errors.phone ? 'true' : undefined"
           :aria-describedby="errors.phone ? 'phone-err' : undefined">
    <p v-if="errors.phone" id="phone-err" class="error">
      <span aria-hidden="true">⚠</span> {{ errors.phone }}
    </p>

    <label for="date">看診日期（必填）</label>
    <input id="date" v-model="form.date" type="date">
    <button type="button" aria-label="清除日期" @click="form.date = ''">
      <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">…</svg>
    </button>

    <button type="submit">送出掛號</button>
  </form>

  <!-- 一開始就在 DOM 裡，之後只改文字：螢幕閱讀器才會念 -->
  <p role="status" class="status">{{ status }}</p>
</template>

<style scoped>
.error { color: #b3261e; }                    /* 白底上 6.5:1 */
button:focus-visible, input:focus-visible {
  outline: 2px solid currentColor;            /* 拿掉預設樣式就要補一個看得見的 */
  outline-offset: 2px;
}
</style>
```

- 日期改用原生的 `<input type="date">`：鍵盤、螢幕閱讀器、手機的選擇器都由瀏覽器處理。設計上非要自製日曆時，照 WAI-ARIA APG 的 Date Picker 範例處理方向鍵與焦點，工作量大很多。
- 錯誤訊息有文字與圖示，不只有紅框；`aria-describedby` 讓螢幕閱讀器在念完「手機」之後念出錯誤訊息。
- `novalidate` 關掉瀏覽器內建的驗證泡泡，改用自己的訊息；兩套同時出現會念兩次。
- `.error` 的顏色是 `#b3261e`，算出來在白底上約 6.5:1。

### 換頁後移動焦點

```js
// src/router/index.js：每次換頁後，把焦點移到新頁面的 h1，並更新標題
router.afterEach(async (to, from) => {
  if (to.path === from.path) return             // 只改 query（篩選、分頁）時不移動焦點
  document.title = `${to.meta.title ?? '門診服務'}｜Clinic`
  await nextTick()
  const h1 = document.querySelector('main h1')
  if (h1) {
    h1.setAttribute('tabindex', '-1')           // 讓標題可以被 focus()，但不加入 Tab 順序
    h1.focus()
  }
})
```

`nextTick` 從 `vue` 匯入。標題被聚焦時瀏覽器可能畫出焦點框，可以用 `h1:focus:not(:focus-visible) { outline: none; }` 只在滑鼠操作時隱藏。

## 常見錯誤與錯誤訊息

Lighthouse 的 Accessibility 類別由 axe-core 的規則產生，下表左欄是它列出的項目名稱：

| Lighthouse 的項目或現象 | 原因 | 修法 |
|---|---|---|
| `Buttons do not have an accessible name` | 只有圖示的按鈕沒有文字 | 加 `aria-label`，圖示加 `aria-hidden="true"` |
| `Image elements do not have [alt] attributes` | `<img>` 沒寫 `alt` | 依用途寫內容，或裝飾圖寫 `alt=""` |
| `Form elements do not have associated labels` | 欄位沒有 `label`、`aria-label`，也沒有 placeholder | 加 `<label for>`。只有 placeholder 時 Lighthouse 不會報，要人工抓 |
| `Background and foreground colors do not have a sufficient contrast ratio.` | 文字對比低於 4.5:1（大字 3:1） | 用顏色選擇器調整到合格 |
| `[aria-hidden="true"] elements contain focusable descendents` | 隱藏的區塊裡還有按鈕或連結，Tab 會停在念不出來的地方 | 不要對可互動的內容用 `aria-hidden`；整塊停用改用 `inert` |
| `Some elements have a [tabindex] value greater than 0` | 用正數的 `tabindex` 調整順序 | 改成 `0`，順序靠 DOM 的位置 |
| `<html> element does not have a [lang] attribute` | 沒有語言標示，螢幕閱讀器用錯的語音念 | `<html lang="zh-Hant-TW">` |
| `Touch targets do not have sufficient size or spacing.` | 點擊目標太小或擠在一起 | 至少 24×24 CSS px，或拉開間距 |
| Tab 會跳過某個看起來能點的東西 | `div`、`span` 加 `@click` | 改用 `button` 或 `a href` |
| 按 Tab 看不到焦點 | `outline: none` 沒有補樣式 | 用 `:focus-visible` 畫焦點框 |
| 操作後螢幕閱讀器沒念出結果 | 訊息只在 Toast 裡，或 live region 和訊息同時插入 | 一直存在的 `role="status"` 容器 |
| 換頁後螢幕閱讀器沒有反應 | SPA 換頁沒有移動焦點 | 換頁後聚焦 `h1` 並更新 `document.title` |

Lighthouse 拿到 100 分，代表它檢查得到的規則都過了。焦點順序合不合理、替代文字對不對、念出來聽不聽得懂、自製元件的鍵盤操作，都在它的範圍之外。

## 動手

1. 拔掉滑鼠，只用 Tab、Shift+Tab、Enter、Space、Esc 走一遍本站的任一課：每一步都看得到焦點停在哪裡嗎？有沒有停不到或停在看不見的地方？
2. 按上面對比計算的「在 Playground 開啟」，加入自己專案的主色與文字色，找出不合格的組合；再改寫最後一段，找出深色背景 `#1e1e1e` 上最暗、仍然合格的灰色。
3. 在 Elements 選幾個按鈕與欄位，看 Accessibility 分頁的 `Name` 與 `Role`；勾 `Show accessibility tree`，把 Elements 面板切換成 accessibility tree 的檢視，對照 DOM。
4. 開 macOS 的 VoiceOver（Cmd+F5）或 Windows 的 NVDA，用螢幕閱讀器填一次自己的表單，記下每個欄位念了什麼、錯誤訊息有沒有被念出來。
5. 回頭讀 [語意化 HTML 與表單元素](#/skill/semantic-html)（地標、標題、`label`、`fieldset`）與 [互動狀態](#/skill/ui-states)（`:focus-visible` 與停用狀態），把這一課的檢查加進每個元件的驗收條件。

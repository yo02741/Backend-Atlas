## 從一個具體問題開始：照著 Dev Mode 抄，卻和設計稿差一截

門診系統要做「門診時段」頁，設計師在 Figma 畫了兩個 frame：手機 390 寬、桌機 1280 寬。每張時段卡片上面是時段與狀態徽章，中間是醫師與診間，下面是「預約」按鈕。

工程師打開 Dev Mode，一個圖層一個圖層把面板上的 CSS 貼進專案。第一次 demo 時，大家看到這些問題：

- 卡片寫成 `width: 358px`，在 390 剛好，換到 414 的手機右邊多出一條空白，到 1280 時三張卡片擠在左邊。
- 狀態徽章寫成 `width: 60px`。「已額滿」三個字放得下，「候補中（3）」被截掉一半。
- 顏色是 `#2f6fd6`、`#2e6fd5`、`#3070d6` 三種，間距有 12、13、14px；設計稿的 variable 叫 `primary` 與 `space-3`，抄 hex 的時候名字都丟了。
- 醫師名字很長時把按鈕擠出卡片；載入中、沒有時段、按鈕 hover 的樣子，設計稿沒畫，畫面上也沒有。

這些問題都出在「照抄數值」：Dev Mode 給的是某一個寬度、某一筆資料下每個圖層的結果，設計師心裡的規則（這塊跟著內容伸縮、那塊吃掉剩下的空間、這個值來自哪個 token）要從 Auto layout 的設定與 variables 讀出來，再寫成 CSS。

## 運作原理

### 切版的順序

```text
1. 看全部 frame（390、1280，還有沒有其他狀態的 frame）
2. 框區塊：頁首／篩選列／卡片清單／底部操作列
3. 每個區塊：列還是欄？一維用 flex，要對齊欄與列用 grid
4. 抽 token：色、字級與行高、間距、圓角，對到 CSS 變數
5. 寫 HTML 結構（語意元素），再寫 CSS
6. 補設計稿沒畫的：中間寬度、互動狀態、資料狀態、文字過長
7. 驗收：DevTools 量值、390 與 1280 對照、疊圖或截圖比對
```

第 2、3 步決定結構。從左上角一個元素一個元素往下寫，HTML 會長得像 Figma 的圖層清單：多一層沒有意義的 `div`、少一層需要的容器，之後要加 RWD 時拆不開。

### Auto layout 對到 flex

Figma 的 Auto layout frame 本身就是一個 flex 容器。面板上的每個欄位都有對應的 CSS：

| Auto layout 的設定 | CSS |
|---|---|
| 方向：水平／垂直 | `flex-direction: row` ／ `column` |
| 項目間距（spacing between items） | `gap` |
| 間距設成 Auto | `justify-content: space-between` |
| 內距（上右下左） | `padding` |
| 對齊（九宮格） | 主軸 `justify-content`，交叉軸 `align-items` |
| Wrap | `flex-wrap: wrap`，列與列的間距是 `row-gap` |
| 子項設成 Absolute position | 子項 `position: absolute`，容器 `position: relative` |

方向轉成 `column` 時，`justify-content` 管垂直、`align-items` 管水平，和水平時相反（見 [Flexbox：一維排列](#/skill/flexbox)）。

### Hug、Fill、Fixed

每個圖層在寬與高各有一個尺寸規則。這三個值描述的是「這個元素的尺寸從哪裡來」，CSS 沒有一對一的屬性，要看它在父層的主軸還是交叉軸：

| 規則 | 在父層的主軸 | 在父層的交叉軸 | 用在容器自己 |
|---|---|---|---|
| Hug contents | 不寫寬度，flex 子項預設就跟著內容（`flex: 0 1 auto`） | `align-self` 不是 `stretch`，或容器 `align-items: flex-start` | 不寫寬度；在 block 版面裡要 `width: fit-content` |
| Fill container | `flex: 1`（或 `flex: 1 1 0`），加 `min-width: 0` 讓它縮得下去 | `align-self: stretch`（flex 交叉軸的預設） | 在 block 版面裡就是預設的填滿 |
| Fixed | `flex: none` 加 `width` | `width` 或 `height` | `width`、`height` |

兩個常見的轉換錯誤：

- 把 Fill 寫成 `width: 100%`。在水平的 flex 容器裡，旁邊還有別的子項時，`100%` 加上兄弟元素的寬度會超出容器，再靠 `flex-shrink` 壓回來，結果和設計稿不同。
- 把 Hug 寫成 Dev Mode 顯示的寬度（`width: 60px`）。面板顯示的是目前文字下的結果，換一段文字就錯。

Grid 版面（Figma 在 2025 年替 Auto layout 加了 grid 模式）對到 `display: grid` 與 `grid-template-columns`，欄距與列距對 `column-gap`、`row-gap`，見 [Grid：二維版面](#/skill/grid)。

### 量值：Dev Mode 與盒模型

Dev Mode 選取圖層時顯示寬高與 padding，按住 Option（Windows 是 Alt）滑到另一個圖層，顯示兩者之間的距離。讀數前先確定三件事：

1. **框到的是哪一層**。文字圖層的高度是行高乘以行數，不是字的高度；Figma 的文字框有時設成 fixed，比字還寬。
2. **padding 與 gap 分開看**。兩張卡片之間 12px，可能是父層的 gap，也可能是卡片自己的 margin；Auto layout 的設定告訴你是哪一個，CSS 用 `gap`，不要在子項加 margin。
3. **邊框算在哪裡**。Figma 的 stroke 可以設在內側、中間、外側，預設多半是內側；CSS 用 `box-sizing: border-box` 時，border 算在寬度裡，和內側 stroke 的結果一致（見 [盒模型](#/skill/box-model)）。

### token：先把值整理成表

| 種類 | 設計稿 | CSS 變數 |
|---|---|---|
| 主色 | `primary` #2f6fd6 | `--color-primary` |
| 淡主色（徽章底） | `primary/soft` #e6effc | `--color-primary-soft` |
| 文字次要 | `text/muted` #5b6472 | `--color-text-muted` |
| 邊框 | `border` #d0d7e2 | `--color-border` |
| 間距 | 4、8、12、16、24 | `--space-1` … `--space-6` |
| 字級／行高 | 14/20、16/24、20/28 | `--font-sm`、`--font-md`、`--font-lg` 加對應的行高 |
| 圓角 | 8、12、999 | `--radius-md`、`--radius-lg`、`--radius-full` |

Figma 的 variables 有名字時，CSS 變數沿用同一套名字，設計師與工程師講的是同一個東西（命名與分層見 [design token 與主題](#/skill/design-tokens)）。整理時出現 13px、`#2e6fd5` 這種刻度以外的值，先問設計師：多半是拖曳時的誤差，少數是故意的例外。

### 素材

| 素材 | 匯出 | 在程式裡 |
|---|---|---|
| 單色圖示 | SVG，拿掉固定的 `fill` 顏色 | `fill="currentColor"`，顏色跟著文字；放在按鈕裡時按鈕要有文字或 `aria-label` |
| 照片、插圖 | 1x、2x，或幾個寬度（400、800、1200） | `<img srcset sizes width height>`，見 [圖片與媒體](#/skill/images-media) |
| 純色塊、漸層、陰影 | 不匯出 | CSS 畫 |

Figma 的匯出可以在同一個圖層加好幾組設定（1x、2x、SVG），一次輸出。匯出前把圖示的 frame 對齊整數像素，SVG 才不會有半像素的模糊邊。

### 固定寬、流動寬與沒畫的寬度

設計稿只畫了 390 與 1280，裝置寬度卻從 360 到 2560 都有。每個區塊要決定一種規則：

- **流動**：跟著父層寬度伸縮，`flex: 1`、`fr`、`%`。卡片清單、表單欄位多半是這種。
- **有上限**：流動，但不超過某個寬度，`max-inline-size: 1080px; margin-inline: auto`。長文字與表單在寬螢幕上不拉成整個畫面寬。
- **固定**：側欄 240px、頭像 40px、按鈕高 44px。
- **換排法**：在某個寬度從一欄變三欄，這就是斷點，寫進斷點表（見 [版面模式與斷點表](#/skill/layout-patterns) 與 [RWD 與斷點](#/skill/rwd)）。

規則不確定時要問，問法要具體：「768 寬時卡片要兩欄還是維持一欄？」「1440 以上內容要置中還是繼續撐開？」

### 設計稿沒畫的東西

動手前列出來，一次問完，答案寫進 [一個畫面的完整規格](#/skill/screen-spec) 的狀態表與待決事項：

- 互動狀態：hover、focus-visible、active、disabled。
- 資料狀態：載入中、沒有資料、錯誤、送出中（見 [UI 的狀態](#/skill/ui-states)）。
- 內容極端值：名字很長、數字很大、沒有照片、翻譯後變長的文字。
- 中間寬度：上一節的規則。

## 實際程式

### 門診時段卡片

設計規格：卡片是垂直 Auto layout（padding 16、項目間距 12、圓角 12、1px 邊框）；第一列水平、間距 Auto（space-between）、垂直置中，徽章 hug；按鈕高 44、填滿。下面這段可以直接在 Playground 執行，最後一段 script 把量到的值印到 Console 面板。

```html run
<style>
  :root {
    --color-surface: #ffffff;
    --color-border: #d0d7e2;
    --color-text: #1d2330;
    --color-text-muted: #5b6472;
    --color-primary: #2f6fd6;
    --color-primary-soft: #e6effc;
    --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-6: 24px;
    --font-sm: 14px; --font-md: 16px; --font-lg: 20px;
    --radius-lg: 12px; --radius-full: 999px;
  }
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; color: var(--color-text); }

  /* 清單：390 一欄、左右 16；768 起兩欄；1280 起三欄、內容寬 1080 置中 */
  .slots {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4);
    max-inline-size: calc(1080px + 2 * var(--space-4));
    margin-inline: auto;
  }
  @media (min-width: 768px) { .slots { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-6); } }
  @media (min-width: 1280px) { .slots { grid-template-columns: repeat(3, minmax(0, 1fr)); } }

  /* 卡片：垂直 Auto layout */
  .slot-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
  }
  /* 第一列：水平、space-between、垂直置中 */
  .slot-head { display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); }
  .slot-time { margin: 0; font-size: var(--font-lg); line-height: 28px; font-weight: 700; }
  /* 徽章 hug：不寫寬度，flex 子項預設跟著內容 */
  .slot-badge {
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-full);
    font-size: var(--font-sm); line-height: 20px;
    background: var(--color-primary-soft); color: var(--color-primary);
    white-space: nowrap;
  }
  .slot-doctor { margin: 0; font-size: var(--font-md); line-height: 24px; color: var(--color-text-muted); overflow-wrap: anywhere; }
  /* 按鈕 fill：在垂直的卡片裡，交叉軸預設 stretch，不寫寬度就填滿 */
  .slot-action {
    block-size: 44px; padding-inline: var(--space-4);
    border: 0; border-radius: var(--radius-full);
    background: var(--color-primary); color: #fff; font: inherit;
  }
</style>

<section class="slots">
  <article class="slot-card">
    <div class="slot-head"><h3 class="slot-time">09:00–09:30</h3><span class="slot-badge">可預約</span></div>
    <p class="slot-doctor">林醫師・家醫科・101 診</p>
    <button class="slot-action" type="button">預約</button>
  </article>
  <article class="slot-card">
    <div class="slot-head"><h3 class="slot-time">09:30–10:00</h3><span class="slot-badge">候補中（3）</span></div>
    <p class="slot-doctor">歐陽醫師・小兒科・102 診（名字很長時換行，不把按鈕擠出卡片）</p>
    <button class="slot-action" type="button">候補</button>
  </article>
</section>

<script>
  // 量值：和設計稿的標註比對
  const card = document.querySelector('.slot-card').getBoundingClientRect()
  const badge = document.querySelector('.slot-badge').getBoundingClientRect()
  const cs = getComputedStyle(document.querySelector('.slot-card'))
  console.log('視窗寬', innerWidth, '卡片寬', card.width, 'padding', cs.paddingTop, '圓角', cs.borderTopLeftRadius)
  console.log('徽章寬（hug，跟著文字）', Math.round(badge.width))
</script>
```

把第二張卡片的徽章文字改成「已額滿」，重新執行，徽章寬度跟著變窄；把 `.slot-badge` 加上 `width: 60px`，「候補中（3）」就放不下了。

### 量值的小工具

在要驗收的頁面打開 Console，貼上這段，列出每個指定元素的位置與尺寸，和設計稿的標註並排比：

```js
// 在 DevTools 的 Console 執行：列出元素的位置、尺寸與主要樣式
const pick = (sel) => [...document.querySelectorAll(sel)].map((el) => {
  const r = el.getBoundingClientRect(), s = getComputedStyle(el)
  return { sel, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
           padding: s.padding, gap: s.gap, font: `${s.fontSize}/${s.lineHeight} ${s.fontWeight}`, color: s.color }
})
console.table(['.slot-card', '.slot-badge', '.slot-action'].flatMap(pick))
```

### 截圖比對

疊圖比對可以用瀏覽器外掛，也可以把設計稿匯出成和視窗同寬的 PNG，暫時當成頁面的半透明背景。要放進 CI 的話用 Playwright 的截圖比對，基準圖第一次由測試產生，之後每次和它比：

```js
// tests/slots.spec.js（@playwright/test）
import { test, expect } from '@playwright/test'

for (const width of [390, 1280]) {
  test(`門診時段 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/slots')
    // 容許 1% 的像素不同：字型反鋸齒在不同機器上會有細微差異
    await expect(page).toHaveScreenshot(`slots-${width}.png`, { maxDiffPixelRatio: 0.01 })
  })
}
```

這比的是「和上一次的畫面」，基準圖要先由人和設計稿對過一次。字型在不同作業系統渲染不同，基準圖要在 CI 同一個環境（例如同一個 Docker 映像）產生。

## 常見錯誤與錯誤訊息

| 現象或訊息 | 原因 | 修法 |
|---|---|---|
| 390 剛好，414 右邊多一條空白 | 把 Fill 寫成 Dev Mode 顯示的固定寬 `width: 358px` | 不寫寬度，讓區塊在父層裡填滿；需要上限時用 `max-inline-size` |
| 徽章或按鈕的文字被截斷 | 把 Hug 寫成固定寬 | 拿掉 `width`，用 padding 撐出空間，必要時 `white-space: nowrap` |
| 長名字把按鈕擠出卡片 | flex 子項的 `min-width` 預設是 `auto`，不會縮到比內容窄 | 文字加 `min-width: 0` 與 `overflow-wrap: anywhere`，Grid 的欄寫 `minmax(0, 1fr)` |
| 卡片間距比設計稿多一倍 | 父層有 `gap`，子項又加了 margin | Auto layout 的間距只對 `gap`，子項不加 margin |
| 文字位置差 2–4px | 行高沒照設計稿，或用了 `line-height: normal` | 照設計稿寫行高（20、24、28px 或倍數） |
| 間距是 0；Styles 窗格裡的 `var(--space-4)` 變灰，滑過去提示變數沒有定義 | 變數名稱拼錯，或 token 檔沒載入 | 對照 token 表修正名稱，確認 `tokens.css` 有被匯入 |
| Styles 窗格的宣告被劃掉並出現 `Invalid property value` | 從 Dev Mode 貼了不完整或不合法的值 | 改成合法的 CSS 值；面板的程式碼只當參考 |
| Playwright 顯示 `1234 pixels (ratio 0.02 of all image pixels) are different.` | 畫面和基準圖不同，超過 `maxDiffPixelRatio` | 打開報告的 diff 圖看差在哪個區塊；確定是預期的改動才用 `--update-snapshots` 更新基準圖 |
| `A snapshot doesn't exist at …` | 第一次執行，還沒有基準圖 | 這次會寫出基準圖，人工對過設計稿後 commit |
| 圖示在暗色主題看不見 | SVG 裡寫死了 `fill="#1d2330"` | 改成 `fill="currentColor"`，顏色交給 CSS |

## 動手

1. 在 Playground 執行上面的卡片範例，把預覽寬度切到 390 與 1280，看 Console 印出的卡片寬與 padding；再把 `.slot-action` 加上 `align-self: flex-end`，按鈕從 Fill 變成 Hug 並靠右。
2. 找一個自己的畫面，照「切版的順序」寫出區塊清單與 token 表，標出刻度以外的值與沒畫的狀態，各列一個要問設計師的問題。
3. 做本課的程式題：題目給固定的 HTML 與一段文字寫的設計規格，測試在 390 與 1280 量盒子的位置、尺寸與計算後的樣式。
4. 斷點表的寫法見 [版面模式與斷點表](#/skill/layout-patterns)，字級與行高的單位見 [單位與文字](#/skill/units-typography)。

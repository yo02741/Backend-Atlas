## 從一個具體問題開始：卡片比欄寬多出 32px

掛號清單的卡片在 1280px 寬時看起來沒問題。換到 390px 的手機，頁面多了一條橫向捲軸，卡片的右側被切掉；標題緊貼著卡片的上緣，原本要留在卡片裡的空白跑到了卡片上方。AI 產生的 CSS 是這樣：

```css
.appointment-list { padding: 0 16px; }
.appointment-card {
  width: 100%;
  padding: 0 16px 16px;
  background: #fff;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.2);
}
.appointment-card h3 { margin-top: 20px; }
```

在 DevTools 選取卡片，Computed 分頁的盒模型圖寫著 content 寬 358、左右 padding 各 16：卡片實際佔了 390px，比 358px 的欄寬多出 32px。標題的 20px `margin-top` 則穿過卡片，推開的是卡片本身。

兩個問題都出在盒模型：`width` 算的是哪一層，以及上下的 margin 怎麼合併。

## 運作原理

### 四層

每個元素都是一個長方形的盒子，由內往外四層：

```
┌─────────────── margin（外距，透明）───────────────┐
│  ┌──────────── border（邊框）──────────────────┐  │
│  │  ┌───────── padding（內距，有背景色）──────┐ │  │
│  │  │                                          │ │  │
│  │  │        content（文字、圖片、子元素）       │ │  │
│  │  │                                          │ │  │
│  │  └──────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

- **content**：放內容的區域，`width`、`height` 預設指的是它。
- **padding**：內容和邊框之間的距離，背景色與背景圖會畫到這裡。
- **border**：邊框，有粗細，佔空間。
- **margin**：和旁邊元素之間的距離，透明，背景色不會畫到這裡。

### `box-sizing`：`width` 算到哪一層

預設的 `box-sizing: content-box` 讓 `width` 只算 content，padding 與 border 另外加上去：

| 寫法 | 實際佔的寬度（Chromium 實測） |
|---|---|
| `width: 300px; padding: 16px; border: 1px solid` | 300 + 16 × 2 + 1 × 2 = 334px |
| 同上，加 `box-sizing: border-box` | 300px（content 縮成 266px） |
| 欄寬 358px 裡 `width: 100%; padding: 16px; border: 1px solid` | 358 + 32 + 2 = 392px |

`border-box` 讓 `width` 等於看得到的寬度，padding 與 border 往內吃掉 content 的空間，`width: 100%` 就不會撐破父元素。多數專案在 reset 裡全站設定：

```css
*, *::before, *::after { box-sizing: border-box; }
```

Tailwind CSS 的 preflight 也是這樣設定（4.3.5 版的 `preflight.css` 第一條規則），用 Tailwind 的專案不必再寫。

### margin 合併

上下相鄰的兩個 block 元素，中間的距離不是兩個 margin 相加：

| 情況 | 結果（Chromium 實測） |
|---|---|
| 上面 `margin-bottom: 24px`，下面 `margin-top: 16px` | 距離 24px，取較大的 |
| 上面 `margin-bottom: 24px`，下面 `margin-top: -10px` | 距離 14px，一正一負時相加 |
| 父元素沒有 padding、border，第一個子元素 `margin-top: 20px` | 子元素貼齊父元素頂端，20px 跑到父元素外面 |
| 同上，父元素加 `padding-top: 1px` 或 `border-top` | 不合併，子元素在父元素裡往下 20px |
| 父元素是 flex 或 grid 容器，或設 `display: flow-root` | 不合併 |
| 父元素設 `overflow: hidden` | 不合併 |
| 父元素設 `overflow: clip` | 仍然合併 |
| flex 直排的兩個子項，24px 與 16px | 距離 40px，flex 子項的 margin 不合併 |

只有垂直方向會合併，左右的 margin 一律相加。開頭的問題屬於第三種：卡片沒有 `padding-top` 也沒有 `border-top`，標題的 20px `margin-top` 和卡片合併、跑到卡片外面，標題就貼齊卡片的上緣。滑鼠移到 Elements 面板裡的標題上，頁面上塗成橘色的 margin 區域落在卡片的外面。

最穩的做法是不讓子元素用 margin 決定和父元素邊緣的距離：父層用 padding 留邊，子元素之間用 flex 或 grid 的 `gap`。

### block、inline 與 inline-block

`display` 決定盒子怎麼參與排版：

| `display` | 例子 | `width`、`height` | 上下的 margin、padding |
|---|---|---|---|
| `block` | `div`、`p`、`h1`、`section` | 有作用，預設佔滿一整行 | 有作用，推開上下的元素 |
| `inline` | `span`、`a`、`strong` | 沒有作用，寬度由文字決定 | padding 會畫出背景，但不推開上下行；margin 沒有作用 |
| `inline-block` | 預設的 `button`、`input` | 有作用，和文字排在同一行 | 有作用 |

實測：`<span style="width: 200px; height: 50px; padding: 10px">ab</span>` 量出來寬 35px（兩個字加左右 padding），`width` 被忽略。要做成有尺寸的標籤或按鈕，改成 `inline-block`、`inline-flex`，或放進 flex 容器（flex 子項會變成 block 盒子）。

padding 與 margin 寫百分比時，**上下的百分比也相對於父元素的寬度**：在 400px 寬的父元素裡，`padding-top: 50%` 是 200px。以前用它做固定比例的框，現在改用 `aspect-ratio`。

### `overflow`：內容比盒子大的時候

| 值 | 超出的內容 | 捲軸 |
|---|---|---|
| `visible`（預設） | 畫在盒子外面，可能蓋到別的元素 | 沒有 |
| `hidden` | 裁掉 | 沒有，但程式設定 `scrollTop` 仍然捲得動 |
| `clip` | 裁掉 | 沒有，`scrollTop` 也捲不動（Baseline 2022） |
| `scroll` | 裁掉 | 一律顯示，內容不多時也有 |
| `auto` | 裁掉 | 需要時才出現 |

兩個常見的陷阱：

- `overflow-x` 與 `overflow-y` 一個是 `visible`、另一個不是時，`visible` 會被改成 `auto`。只寫 `overflow-x: hidden`，Computed 分頁的 `overflow-y` 顯示 `auto`，內容一高就多出一條直向捲軸。
- `hidden`、`auto`、`scroll` 讓元素變成捲動容器，裡面的 `position: sticky` 只在它裡面黏（見 [定位與疊放](#/skill/positioning)）。只是要裁掉溢出時用 `clip`。

### `outline` 不佔空間

`outline` 畫在 border 外面，不參與排版，加上去旁邊的元素不會被推動。選取狀態或焦點框改 border 的粗細（1px 變 2px）會讓卡片變大，整列跟著跳一下；用 `outline` 加 `outline-offset` 就不會。

## 實際程式碼

```css
/* reset：全站 border-box */
*, *::before, *::after { box-sizing: border-box; }

/* 清單：間距交給 gap，卡片自己不加 margin */
.appointment-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0 16px;
  margin: 0;
  list-style: none;
}

.appointment-card {
  width: 100%;                 /* border-box：padding 與 border 包含在內 */
  padding: 16px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #fff;
}
.appointment-card h3 {
  margin: 0 0 4px;             /* 標題不靠 margin-top 和卡片頂端保持距離 */
}

/* 姓名一行放不下時顯示省略號：三個屬性要一起寫 */
.appointment-card .patient {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 備註最高 120px，超出時在卡片內捲動 */
.appointment-card .note {
  max-height: 120px;
  overflow-y: auto;
}

/* 選取與焦點：outline 不佔空間，切換時版面不跳 */
.appointment-card.is-selected,
.appointment-card:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}
```

390px 寬時，清單左右各 16px 的 padding，卡片寬 358px，含 padding 與 border；備註超過 120px 時在卡片內出現捲軸，姓名太長顯示省略號，選取時卡片大小不變。

## 常見錯誤與錯誤訊息

- **`width: 100%` 加 padding 撐破父元素**：盒模型圖的數字加起來比父元素寬，頁面出現橫向捲軸。全站設定 `box-sizing: border-box`。
- **`100vw` 造成的橫向捲軸**：`100vw` 包含直向捲軸的寬度，在顯示傳統捲軸的桌機（例如 Windows）上，`width: 100vw` 比可用寬度多出捲軸的那一截。滿版用 `width: 100%`。
- **沒作用的 `width`**：Styles 分頁裡屬性旁出現提示圖示，訊息是 `The display: inline property prevents width from having an effect.`，下面附 `Try setting display to something other than inline.`。表格的列也有類似的提示：`The display: table-row property prevents padding from having an effect.`。
- **`height: 100%` 沒作用**：百分比高度相對於父元素的高度，父元素的高度是 `auto`（由內容決定）時，百分比算不出來。改用 flex 或 grid 讓子元素撐滿，或 `min-height`。
- **margin 跑到外面**：父元素上方多出空白、背景沒包住子元素。父元素加 padding、`display: flow-root`，或改成 flex、grid 用 `gap`。
- **寫死 `height`**：內容一多就溢出，文字疊到下一張卡片上。用 `min-height`；需要上限時用 `max-height` 加 `overflow: auto`。
- **捲軸一直都在**：寫成 `overflow: scroll`。改成 `auto`。
- **只寫 `text-overflow: ellipsis` 沒有省略號**：還要 `white-space: nowrap` 與 `overflow: hidden`，三個一起才有作用。

## 動手

- 在任何頁面選取一張卡片，打開 Computed 分頁，滑鼠依序移到盒模型圖的 margin、border、padding、content，看頁面上塗色的範圍；在 Styles 分頁把 `box-sizing` 切成 `content-box`，看寬度的數字怎麼變。
- 把上面「實際程式碼」的 `box-sizing` 那行拿掉，在裝置模式 390px 看橫向捲軸出現在哪裡。
- 在 `.appointment-card` 裡放一個沒有 padding 的 `div`，裡面的第一個元素加 `margin-top: 20px`，用盒模型圖找出那 20px 跑到哪裡，再用 `display: flow-root` 修好。
- 間距交給父層之後，卡片怎麼排成一列或多欄，看 [Flexbox](#/skill/flexbox) 與 [Grid](#/skill/grid)。

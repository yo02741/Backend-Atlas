## 從一個具體問題開始：卡片牆對不齊

「今日門診」頁的主欄要放一面診間卡片牆：寬螢幕多排幾欄，窄螢幕少排幾欄，每張卡片一樣寬、上下對齊。AI 先給了 Flexbox 的版本：

```css
.rooms { display: flex; flex-wrap: wrap; gap: 16px; }
.room  { flex: 1 1 240px; }
```

欄數會跟著寬度變，但 7 張卡片排成 3 + 3 + 1 時，最後一張被拉得和整列一樣寬。Flexbox 每一行各自分配空間，最後一行只有一張，就獨佔整行。

改成固定四欄的 Grid：

```css
.rooms { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
```

1280px 時整齊了，390px 的手機上卡片被擠成四條不到 80px 的窄欄，診間名稱幾個字就換一行。

需求是「每欄至少 240px，放得下幾欄就排幾欄，所有卡片對齊同一組欄線」，Grid 的 `repeat(auto-fill, minmax(240px, 1fr))` 寫得出來。要用好它，得知道軌道的大小怎麼算、欄數怎麼決定。

## 運作原理

### 名詞

```
        格線 1     格線 2          格線 3          格線 4
          │          │               │               │
格線 1 ── ┌──────────┬───┬───────────┬───┬───────────┐
          │  格子     │gap│           │gap│           │  ← 列軌道 1
格線 2 ── ├──────────┼───┼───────────┼───┼───────────┤
          │          │   │   區域 main（跨兩欄）       │  ← 列軌道 2
格線 3 ── └──────────┴───┴───────────────────────────┘
            欄軌道 1        欄軌道 2         欄軌道 3
```

- **軌道（track）**：一欄或一列。
- **格線（grid line）**：軌道之間的線，從 1 開始編號；也能用負數從尾端數，`-1` 是最後一條。三欄的 Grid 有 4 條欄格線。
- **格子（cell）**：一欄與一列交會的地方。
- **區域（area）**：連在一起的長方形格子，可以命名。
- **gap**：軌道之間的距離，只在軌道之間，不在外圍。

`display: grid` 的元素是 grid 容器，它的直接子元素是 grid 項目。

### 軌道的大小怎麼算

以欄為例，瀏覽器大致這樣分配容器的寬度：

1. 先扣掉所有 `gap`。
2. 固定大小的軌道（`240px`）、依內容的軌道（`auto`、`min-content`）先拿走它們要的寬度。
3. 剩下的空間按 `fr` 的比例分。

容器 1000px、`grid-template-columns: 240px 1fr 2fr`、`column-gap: 16px`：扣掉 240 與兩段 16，剩 728px，按 1 : 2 分成 242.67 與 485.33。Chromium 實測三欄是 240px、242.656px、485.344px。

`1fr` 有一個容易忽略的下限：它等於 `minmax(auto, 1fr)`，最窄不會小於內容的最小寬度。600px 的容器、三欄 `1fr`，中間那欄放一個不能斷開的網址 `https://clinic.example/appointments/2026-11-20/very-long-path-name`，實測三欄是 164.7、270.6、164.7px，中間那欄被撐寬。改成 `repeat(3, minmax(0, 1fr))` 後三欄都是 200px，網址溢出自己的格子，再用 `overflow-wrap: anywhere` 讓它換行。

`minmax(min, max)` 指定軌道的下限與上限：

| 寫法 | 意思 |
|---|---|
| `minmax(240px, 1fr)` | 至少 240px，有空間就一起分 |
| `minmax(0, 1fr)` | 硬性平分，不被內容撐寬 |
| `minmax(100px, auto)` | 列至少 100px，內容多時長高 |
| `minmax(min(240px, 100%), 1fr)` | 至少 240px，但容器比 240px 窄時以容器寬為準 |

### `repeat()`、`auto-fill` 與 `auto-fit`

`repeat(3, 1fr)` 等於 `1fr 1fr 1fr`。第一個參數改成 `auto-fill` 或 `auto-fit`，瀏覽器依容器寬度決定重複幾次：

```css
grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
gap: 16px;
```

上限是 `1fr`，不是固定長度，瀏覽器用下限 240px 算放得下幾條：欄數 =（容器寬 + gap）÷（240 + gap）取整數，至少 1。算出欄數後，每欄再平分剩下的空間。Chromium 實測：

| 容器寬 | 欄數 | 每欄 |
|---|---|---|
| 358px（390px 手機扣掉左右 16px） | 1 | 358px |
| 736px（768px 平板） | 2 | 360px |
| 1000px | 3 | 322.67px |
| 1248px（1280px 桌機） | 4 | 300px |

不用寫任何 media query，欄數就跟著寬度變，最後一列的卡片也和上面對齊。

`auto-fill` 與 `auto-fit` 只在項目不夠填滿一列時有差別。容器 1000px 排得下三欄，只有兩張卡片：

- `auto-fill`：保留第三條空軌道，兩張卡片各 322.67px，右邊留一個空欄。
- `auto-fit`：空的軌道收成 0（computed 值是 `492px 492px 0px`），兩張卡片各拉到 492px。

卡片牆通常用 `auto-fill`，卡片數量變少時大小不變；只有兩三個項目、要撐滿整列時用 `auto-fit`。

容器比下限還窄時（例如 200px 的側欄裡放 `minmax(240px, 1fr)`），那一欄仍是 240px，溢出 40px。下限寫成 `min(240px, 100%)` 就會縮成容器寬。

### 放置項目：格線、span 與區域

沒有指定位置的項目照 DOM 順序一格一格填。要指定時：

```css
.notice { grid-column: 1 / -1; }       /* 從第 1 條格線到最後一條：佔滿整列 */
.featured { grid-column: span 2; }     /* 從自動放置的位置起跨兩欄 */
.side { grid-row: 2 / 4; }             /* 從第 2 條列格線到第 4 條 */
```

`-1` 是最後一條**明確定義**的格線（`grid-template-columns` 定義出來的），`repeat(auto-fill, …)` 算出來的軌道也算明確定義。

整頁版面用區域名稱更好讀：

```css
.page {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  grid-template-areas:
    "header header"
    "side   main";
}
.page > header { grid-area: header; }
.page > aside  { grid-area: side; }
.page > main   { grid-area: main; }
```

每個字串是一列，同名的格子組成一個區域，`.` 代表空格。規則有兩條：每個區域必須是長方形，每一列的格數必須相同。違反任何一條，整條 `grid-template-areas` 宣告無效，computed 值變成 `none`。實測 `"header header" "side main" "header foot"`（`header` 不是長方形）時，四個寫了 `grid-area` 的項目全部疊在同一個位置，擠進格線外新長出的隱式軌道。

定義區域時，瀏覽器也替它建立具名格線：`main` 區域的左右兩條欄格線叫 `main-start`、`main-end`，所以 `grid-column: main-start` 會把項目放到 main 那一欄。

### 隱式軌道與自動放置

項目比定義的格子多時，瀏覽器自動加軌道，這些叫隱式軌道，大小由 `grid-auto-rows`（或 `grid-auto-columns`）決定：

```css
grid-template-rows: 50px;
grid-auto-rows: 80px;     /* 第 2 列之後都是 80px */
```

兩欄、五個項目，實測列高是 `50px 80px 80px`。卡片牆通常只定義欄，列交給 `grid-auto-rows`；寫成 `minmax(100px, auto)` 讓每列至少 100px、內容多時長高。寫成固定的 `100px` 時，內容超過的卡片會溢出到下一列上。

`grid-auto-flow: dense` 讓後面的小項目回填前面留下的空洞。三欄的 Grid，第三個項目跨兩欄放不下第一列剩下的一格，`dense` 會把第四個項目拉上去填那一格。畫面順序變成 1、2、4、3，但 Tab 鍵與螢幕閱讀器照 DOM 順序走，焦點會跳來跳去。

### 對齊

Grid 項目在格子裡預設 `stretch`：沒有寫死高度的項目被拉滿整個格子，所以同一列的卡片等高（實測一張 120px 高的卡片旁邊，內容很少的卡片也是 120px）。

| 屬性 | 寫在 | 管什麼 |
|---|---|---|
| `justify-items`、`align-items`（縮寫 `place-items`） | 容器 | 所有項目在自己格子裡的水平、垂直對齊 |
| `justify-self`、`align-self` | 項目 | 單一項目在格子裡的對齊 |
| `justify-content`、`align-content` | 容器 | 所有軌道加起來比容器小時，整組軌道怎麼擺 |

`place-items: center` 讓每個項目在格子裡置中，常用在圖示格。

### subgrid

卡片裡有標題、內文、按鈕三段，內文長短不同時，各卡片的按鈕高度對不齊。`subgrid` 讓卡片沿用外層 Grid 的列軌道：

```css
.rooms { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
.room {
  display: grid;
  grid-row: span 3;                 /* 每張卡片佔外層的三列 */
  grid-template-rows: subgrid;      /* 卡片內的三段對齊外層的列 */
}
```

同一列的卡片，標題、內文、按鈕三段各自對齊。subgrid 是 Baseline 2023，2026 年 3 月起 Widely available。

## 實際程式碼

「今日門診」頁：外層用區域排整頁，主欄的卡片牆用 `auto-fill`。

```html
<div class="page">
  <header class="page-header">今日門診 · 總院區</header>
  <aside class="page-side">科別與時段篩選</aside>
  <main class="page-main">
    <ul class="rooms">
      <li class="room notice">骨科 203 診今日停診</li>
      <li class="room">內科 101 診 · 王醫師 · 看診 23 號</li>
      <li class="room">眼科 305 診 · 陳醫師 · 看診 8 號</li>
      <!-- …其餘診間 -->
    </ul>
  </main>
</div>
```

```css
/* 手機：單欄，側欄收進 Drawer（這裡先隱藏） */
.page {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas:
    "header"
    "main";
  gap: 16px;
  padding: 0 16px;
}
.page-header { grid-area: header; }
.page-main   { grid-area: main; }
.page-side   { display: none; }

/* 1280px 起：左側常駐側欄 */
@media (min-width: 1280px) {
  .page {
    grid-template-columns: 240px minmax(0, 1fr);
    grid-template-areas:
      "header header"
      "side   main";
  }
  .page-side { display: block; grid-area: side; }
}

/* 卡片牆：每張至少 240px，容器比 240px 窄時縮成容器寬 */
.rooms {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(240px, 100%), 1fr));
  grid-auto-rows: minmax(100px, auto);
  gap: 16px;
  padding: 0;
  margin: 0;
  list-style: none;
}
.room { min-width: 0; overflow-wrap: anywhere; }
.notice { grid-column: 1 / -1; }   /* 停診公告佔滿整列 */
```

換斷點時只改容器的 `grid-template-columns` 與 `grid-template-areas`，子項的 `grid-area` 不用動。

### 算欄數

下面用同樣的算法，列出卡片牆在幾種容器寬度下排成幾欄、每欄多寬，以及 `auto-fill` 與 `auto-fit` 的差別：

```js run
// repeat(auto-fill | auto-fit, minmax(MIN, 1fr)) 在不同容器寬度下排成幾欄、每欄多寬
// 上限是 1fr（不是固定長度），瀏覽器用下限 MIN 算放得下幾條軌道
function autoColumns(width, min, gap, items, mode) {
  const tracks = Math.max(1, Math.floor((width + gap) / (min + gap)))     // 至少一條
  const empty = Math.max(0, tracks - items)                                 // 沒有卡片的軌道
  const sized = mode === 'auto-fit' ? tracks - empty : tracks               // auto-fit：空軌道收成 0，不分空間
  const colWidth = Math.max(min, (width - gap * (sized - 1)) / sized)       // 下限比容器寬時就溢出
  const overflow = Math.max(0, Math.round(colWidth * sized + gap * (sized - 1) - width))
  return { tracks, empty, colWidth: Math.round(colWidth * 100) / 100, overflow }
}

const MIN = 240, GAP = 16
console.log('auto-fill，6 張卡片')
for (const w of [200, 358, 736, 1000, 1248]) {
  const r = autoColumns(w, MIN, GAP, 6, 'auto-fill')
  console.log(`容器 ${String(w).padStart(4)}px：${r.tracks} 欄，每欄 ${r.colWidth}px${r.overflow ? `，溢出 ${r.overflow}px` : ''}`)
}
console.log('\n容器 1000px，只有 2 張卡片')
for (const mode of ['auto-fill', 'auto-fit']) {
  const r = autoColumns(1000, MIN, GAP, 2, mode)
  console.log(`${mode.padEnd(9)}：${r.tracks} 條軌道，${mode === 'auto-fill' ? `留 ${r.empty} 個空欄` : `${r.empty} 條空軌道收成 0`}，卡片各 ${r.colWidth}px`)
}
```

輸出的數字和上面表格的 Chromium 實測值相同。把 `MIN` 改成 300、`GAP` 改成 24，看 1280px 的桌機少排幾欄。

## 常見錯誤與錯誤訊息

- **屬性寫在不是 grid 容器的元素上**：Styles 分頁的提示是 `The display: block property prevents grid-template-columns from having an effect.`，建議 `Try setting the display: block property to display: grid`。
- **`grid-area` 寫在子項，父元素卻不是 grid**：提示是 `The display: block property on the parent element prevents grid-area from having an effect`。常見於中間多包了一層 `div`，或 Vue 元件的根元素多了一層。Grid 只認直接子元素。
- **區域字串寫錯**：`grid-template-areas` 被劃掉並出現警告圖示，滑鼠移上去顯示 `Invalid property value`；項目全部疊在同一個位置。檢查每個區域是不是長方形、每一列的格數是不是相同。
- **`1fr` 被撐寬**：Layout 分頁的 `Show track sizes` 顯示同樣是 `1fr` 的欄寬度不同。改成 `minmax(0, 1fr)`，項目加 `min-width: 0` 與 `overflow-wrap: anywhere`。
- **手機上出現橫向捲軸**：`minmax(240px, 1fr)` 的下限比容器寬。改成 `minmax(min(240px, 100%), 1fr)`。
- **固定欄數在手機上擠成一團**：`repeat(4, 1fr)` 在 358px 的容器裡每欄不到 80px。改用 `auto-fill`，或用 media query 在窄螢幕換成一欄。
- **卡片內容溢出到下一列**：`grid-auto-rows` 寫死成固定高度。改成 `minmax(100px, auto)`。
- **Tab 順序和畫面對不上**：用了 `dense`、`order` 或手動指定 `grid-row` 把項目搬到前面。讓 DOM 順序等於閱讀順序，需要重排時改 DOM。

## 動手

- 打開 [Grid 實驗室](#/lab/GridLab)：切換 `auto-fill` 與 `auto-fit`、把卡片數量拉到 2 張，看空軌道收成 0 的差別；把容器寬度拉到最小，對照下方 390、768、1280 三種寬度各排成幾欄；切到命名區域，選「無效」看整條宣告被丟掉時項目跑到哪裡。
- 按上面算欄數的「在 Playground 開啟」，把 `items` 改成 1、`mode` 改成 `auto-fit`，算出卡片會多寬。
- 在任何一個用 Grid 的頁面，Elements 面板點 `grid` 標記，再到 Layout 分頁的 `Overlay display settings` 選 `Show line numbers`、勾 `Show area names`，對照 CSS 找出每條格線與區域。
- 一維的工具列與按鈕列回到 [Flexbox](#/skill/flexbox)；版面在不同寬度怎麼切換，看 [RWD 與斷點](#/skill/rwd)。

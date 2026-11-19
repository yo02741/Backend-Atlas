## 從一個具體問題開始：叫號提示一滑出來，看板就卡一下

門診看板 `ClinicBoard` 在候診區的電視上全螢幕顯示，每次叫號時右下角滑出一個 Toast。桌機上看起來沒事，換到電視盒內建的瀏覽器後，Toast 滑出的那半秒整個看板會頓一下，候診人數的數字也跟著閃。

打開 Performance 分頁錄一次叫號，Main 軌道在動畫的每一格都有 `Recalculate style`、`Layout`、`Paint`，加起來超過一格的時間預算（60 fps 時約 16.7 ms）。原因在 Toast 的 CSS：

```css
.toast { position: fixed; right: -320px; transition: right 0.4s; }
.toast.show { right: 24px; }
```

動畫改的是 `right`，`right` 會改變元素的位置，瀏覽器每一格都得重新算版面、重新畫。同樣的效果改用 `transform: translateX()`，瀏覽器可以跳過前面幾段，只在最後一段把已經畫好的圖層移過去。要判斷「改這個屬性要付出多少代價」，得知道瀏覽器從 HTML 到畫面經過哪幾段，以及每一段的輸入是什麼。

## 運作原理：七段管線

| 階段 | 輸入 | 產出 | 在 DevTools 的 Performance 分頁看到的名稱 |
|---|---|---|---|
| 1. 取得 HTML | 網址 | HTML 的位元組 | Network 軌道上的請求 |
| 2. 建 DOM | HTML | 節點樹 | `Parse HTML` |
| 3. 建 CSSOM | 樣式表 | 樣式規則 | `Parse stylesheet` |
| 4. 樣式計算與 render tree | DOM + CSSOM | 每個要畫的節點與它最後的樣式 | `Recalculate style` |
| 5. layout | render tree | 每個盒子的位置與大小 | `Layout` |
| 6. paint | 盒子與樣式 | 繪製指令，再點陣化成像素 | `Paint` |
| 7. composite | 各個圖層 | 螢幕上的畫面 | 新版 Chrome 是 `Layerize`、`Commit`，舊版是 `Composite Layers` |

前三段處理「收到什麼」，後四段處理「怎麼畫」。第 1 段的細節（DNS、TCP、TLS、快取）在 [一個 HTTP 請求的一生](#/skill/http-basics)。

### 首次載入的時間線

瀏覽器邊收 HTML 邊解析，不等整份下載完。下面是一份 `<head>` 裡有一個樣式表、一個沒加 `defer` 的 script 的頁面（時間是示意）：

```
時間 →        0      20      40      60      80     100 ms
網路           |HTML===|
                      |main.css=====|
                      |analytics.js=========|
主執行緒        |Parse HTML|                 |Eval|Parse HTML|
                         ↑ 遇到 <script>：解析停下，等 JS 下載完、    ↑ DOM 約在 90 ms 建完
                           也等 main.css 載完（script 可能讀樣式），執行後才繼續
```

同一個 script 加上 `defer`：

```
時間 →        0      20      40      60      80     100 ms
網路           |HTML===|
                      |main.css=====|
                      |analytics.js=========|
主執行緒        |Parse HTML 一路解析完|       |Eval|
                                   ↑ DOM 約在 40 ms 建完；JS 下載完、解析也完成後才執行
```

加了 `defer` 之後，DOM 提早建完；CSS 一載完，瀏覽器就可以算樣式、layout、paint，第一個畫面不必等 `analytics.js`（實際先畫還是先執行 script，依瀏覽器的排程而定）。兩件事決定第一個畫面多快出現：

- **CSS 擋渲染**：`<head>` 裡的樣式表沒載完，瀏覽器不畫第一個畫面，否則會先畫出沒有樣式的內容再跳一次。
- **沒有 `defer`、`async` 的 script 擋解析**：解析器停在 `<script>` 那一行，後面的 DOM 都晚建好。解析器停下時，瀏覽器的 preload scanner 仍會往後掃描、先送出後面圖片與 script 的請求，所以下載沒有完全停擺，但 DOM 與執行都要等。

`type="module"` 的 script 預設行為和 `defer` 相同；`async` 是下載完就執行，執行的那一刻仍會打斷解析，多個 `async` 之間的順序也不保證。

### render tree 裡有誰

render tree（Chrome 的文件叫 layout tree）由 DOM 與計算後的樣式合成，只留下要畫的東西：

| DOM 裡的節點 | 在 render tree 嗎 | 佔版面位置嗎 |
|---|---|---|
| `<head>`、`<script>`、`<meta>` | 不在 | 不佔 |
| `display: none` 的元素（含 Vue `v-show` 為假時） | 不在，子孫也都不在 | 不佔 |
| `visibility: hidden` 的元素 | 在 | 佔，只是不畫 |
| `opacity: 0` 的元素 | 在 | 佔，還接得到點擊 |
| `::before`、`::after` | 在（DOM 裡沒有它們） | 佔 |

Vue 的 `v-if` 為假時，連 DOM 節點都不會建立。

### 改一個屬性，從哪一段重跑

頁面載入後，JavaScript 或使用者互動改了東西，瀏覽器不會從頭來過，而是從被影響的那一段往後重跑：

| 改了什麼 | 樣式計算 | layout | paint | composite |
|---|---|---|---|---|
| 新增或移除節點 | 重跑 | 重跑 | 重跑 | 重跑 |
| `width`、`height`、`padding`、`margin`、`font-size`、`top`、`left` | 重跑 | 重跑 | 重跑 | 重跑 |
| `color`、`background-color`、`box-shadow`、`visibility` | 重跑 | 跳過 | 重跑 | 重跑 |
| 有自己合成層的元素的 `transform`、`opacity` | 重跑 | 跳過 | 跳過 | 重跑 |

最後一列有個前提：元素要已經有自己的**合成層**（compositing layer）。設了 `will-change: transform`、正在跑 `transform` 或 `opacity` 的 CSS 動畫的元素，瀏覽器通常會把它放到獨立的圖層；沒有獨立圖層時，它的像素畫在父層裡，移動它就得重畫那一層。合成由合成器執行緒負責，所以主執行緒在跑 JavaScript 時，這類動畫仍然順暢。

圖層不是越多越好：每一層都要占 GPU 記憶體，幫上百張卡片都加 `will-change`，在記憶體少的裝置上反而更慢。只給會動的元素加，動完可以拿掉。

## 實際程式碼

### 只走合成的 Toast

```css
.toast {
  position: fixed;
  right: 24px;
  bottom: 24px;
  transform: translateX(calc(100% + 24px)); /* 先推到畫面外 */
  opacity: 0;
  transition: transform 0.4s ease, opacity 0.4s ease;
  will-change: transform; /* 先給它自己的合成層 */
}
.toast.show {
  transform: translateX(0);
  opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
  .toast { transition: none; }
}
```

### `<head>` 裡的 script

```html
<head>
  <link rel="stylesheet" href="/assets/main.css">
  <!-- 不需要等的追蹤程式：defer，解析完才執行，順序照出現的順序 -->
  <script defer src="/analytics.js"></script>
  <!-- Vite 產生的入口是 module，預設就和 defer 一樣不擋解析 -->
  <script type="module" src="/assets/index.js"></script>
</head>
```

### 先讀後寫，避免強迫同步 layout

更新 20 個診間的候診人數，同時把每張卡片的高度記下來給動畫用。下面的寫法每一圈都先寫再讀：

```js
// 錯：每一圈改了內容就讀 offsetHeight，瀏覽器每次都得當場重算 layout
for (const room of rooms) {
  const card = document.getElementById(`room-${room.id}`)
  card.querySelector('.waiting').textContent = room.waiting
  heights[room.id] = card.offsetHeight
}
```

改成先全部寫完、再全部讀：

```js
// 對：寫入集中在前面，讀取集中在後面，layout 只算一次
const cards = rooms.map((room) => document.getElementById(`room-${room.id}`))
rooms.forEach((room, i) => {
  cards[i].querySelector('.waiting').textContent = room.waiting
})
cards.forEach((card, i) => {
  heights[rooms[i].id] = card.offsetHeight
})
```

會強迫 layout 的讀取不只 `offsetHeight`，`offsetWidth`、`clientHeight`、`scrollTop`、`getBoundingClientRect()`、`getComputedStyle()` 的部分屬性都會。用 Vue 時通常不會直接這樣寫，但在 `onUpdated` 或 `watch` 裡量尺寸、再改狀態，效果相同。

## 常見錯誤與錯誤訊息

- **動畫改 `top`、`left`、`width`**：Performance 分頁的 Main 軌道在動畫期間每一格都有 `Layout`。改成 `transform` 與 `opacity`。
- **強迫同步 layout**：Performance 分頁的 Insights 列出 `Forced reflow`，點開 `Layout` 事件會看到 `Forced reflow is a likely performance bottleneck`，下面附了觸發它的程式位置。Console 的層級打開 Verbose 時，Chrome 也可能印出 `[Violation] Forced reflow while executing JavaScript took 45ms` 這類訊息（數字依實際情況）。
- **整頁重繪**：Rendering 面板的 `Paint flashing` 會把重繪的區域標成綠色。改一個數字卻整個清單在閃，常見原因是那個元素和大範圍的區塊在同一層、或改到了影響整個區塊的樣式（例如父元素的 class）。
- **`display: none` 的元素量不到尺寸**：它不在 render tree，`offsetHeight` 是 0、`getBoundingClientRect()` 全是 0。要量尺寸改用 `visibility: hidden`，或等它顯示出來（Vue 裡在 `nextTick` 之後）再量。
- **script 擋住第一個畫面**：用 `Record and reload` 錄載入，`Parse HTML` 被 `Evaluate script` 切成兩段，且第一個 `Paint` 很晚才出現。在 `<head>` 的 script 加 `defer`，或改成 `type="module"`。
- **`will-change` 加在所有元素上**：Layers 分頁看到上百個圖層。只留給會動的元素。

## 動手

- 打開 [渲染管線實驗室](#/lab/RenderPipelineLab)：逐步播放首次渲染，切換「`<head>` 的 script 沒有 `defer`」看解析在哪裡停下；再選 `color`、`width`、`transform`、新增節點，看哪幾段亮起。
- 在任何一個頁面打開 Rendering 面板勾 `Paint flashing`，捲動、hover、輸入文字，看哪些區域被重畫。
- 用 Performance 分頁加 `4× slowdown` 錄一次本站首頁的載入，找出 `Parse HTML`、`Recalculate style`、`Layout`、`Paint` 各出現在哪裡。
- 接著讀 [開發者工具：驗收前端的固定路線](#/skill/devtools)，把這些檢查放進每次驗收的順序裡。

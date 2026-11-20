## 從一個具體問題開始：字放大之後，候診清單疊在一起

候診清單的樣式是這樣寫的：

```css
.queue        { font-size: 14px; line-height: 20px; }
.queue-item   { height: 48px; }
.queue-item h3 { font-size: 1.5em; }
.checkin      { height: 100vh; }   /* 報到頁：按鈕列固定在畫面底部 */
```

一位病患家屬在 Chrome 的設定把字型調大，清單的字完全沒變。開發者把 `14px` 改成 `0.875rem`，這次字變大了，卻出現新的問題：病患姓名（`h3`）的兩行疊在一起，第二行被 `height: 48px` 切掉一半。同一天另一個回報：手機上報到頁最下面的「確認報到」按鈕被瀏覽器的網址列蓋住，要往上滑才按得到。

三個問題各來自一個單位：

1. `px` 不跟著使用者的字型設定變；改成 `rem` 之後，字會變大，但寫死高度的容器沒跟上。
2. `line-height: 20px` 是固定值，子元素 `h3` 繼承的也是 20px，字級變成 1.5 倍時兩行就重疊。
3. 手機上的 `100vh` 是網址列收起來時的高度，網址列展開時比看得到的區域高。

寫需求或審 AI 的 CSS 時，看到一個長度要先問：它以什麼為基準，基準變了它會怎樣。

## 運作原理

### 長度單位以什麼為基準

| 單位 | 基準 | 適合 |
|---|---|---|
| `px` | 固定的 CSS 像素 | 邊框、陰影、圖示等不該縮放的尺寸 |
| `rem` | 根元素 `html` 的字級（預設 16px，使用者可以改） | 字級、間距、元件尺寸 |
| `em` | 目前元素的字級（用在 `font-size` 時是父元素的字級） | 要跟著自己字級變的內距，例如按鈕的 padding |
| `%` | 父元素；寬度依包含區塊的寬，`padding` 與 `margin` 的百分比也依寬 | 欄寬、流動版面 |
| `vw`、`vh` | 視窗寬、高的 1% | 和視窗成比例的裝飾性尺寸 |
| `svh`、`lvh`、`dvh` | 最小、最大、目前的視窗高 | 手機上的全螢幕區塊（Baseline 2022） |
| `ch` | 數字「0」的寬度 | 英數欄位的寬度，例如病歷號 `width: 9ch` |
| `ic` | 中日文字「水」的寬度 | 中文段落的每行字數，例如 `max-width: 40ic`（Baseline 2022） |
| `lh` | 目前元素的行高 | 和行數對齊的高度，例如 `max-height: 3lh` 顯示三行（Baseline 2023） |

`em` 會一層層相乘：每層清單都寫 `font-size: 0.9em`，第二層是 0.81 倍、第三層是 0.729 倍。字級用 `rem` 就不會有這個問題，`em` 留給要跟著自己字級變化的內距與圖示大小。

### 使用者的字型設定與縮放

瀏覽器有兩種放大方式，對單位的影響不同：

- **縮放**（Ctrl 或 Cmd 加上 `+`）：所有東西一起放大，包含 `px`；視窗的 CSS 寬度變小，所以 media query 也跟著換斷點。
- **字型大小設定**（Chrome 的 `chrome://settings/fonts`）：只改預設字級，也就是 `rem`、`em`、`%` 的基準。寫死 `px` 的字不會變。

WCAG 2.2 的 1.4.4 Resize Text（AA）要求文字放大到 200% 時內容與功能不能遺失。字級用 `rem`，加上不寫死高度（用 `min-height` 或讓內容撐開），兩種放大方式都能通過。

有些專案在根元素寫 `html { font-size: 62.5%; }`，讓 `1rem` 在預設設定下等於 10px，方便換算；它是百分比，所以仍然跟著使用者的設定。寫成 `html { font-size: 10px; }` 就把使用者的設定蓋掉了。

media query 裡的 `em` 例外：`@media (min-width: 48em)` 的 `em` 用的是瀏覽器的預設字級，不受 `html { font-size }` 影響，所以在預設設定下仍然是 768px。

### 行高要寫成倍數

```css
.card    { font-size: 1rem; line-height: 1.5em; }   /* 算成 24px，子元素繼承的是 24px */
.card h3 { font-size: 2rem; }                        /* 32px 的字配 24px 的行高：兩行重疊 */

.card    { font-size: 1rem; line-height: 1.5; }     /* 不帶單位：子元素繼承的是「1.5 倍」 */
.card h3 { font-size: 2rem; }                        /* 32px × 1.5 = 48px */
```

`line-height` 不帶單位時，繼承的是倍數，每個子元素用自己的字級去乘；帶單位（`em`、`px`、`%`）時，父元素先算成固定值再往下傳。中文內文常用 1.6 到 1.8，標題 1.2 到 1.4；每行的長度控制在 35 到 40 個字左右，用 `max-width: 40ic` 或 `40em`（中文字寬大約是 1em）。

### clamp() 與流動字級

`clamp(最小, 偏好, 最大)` 在上下限之間取偏好值。標題常寫成 `clamp(1.5rem, 1.2rem + 1.2vw, 2rem)`：窄螢幕停在 1.5rem，寬螢幕停在 2rem，中間跟著視窗寬度變。

偏好值要同時有 `rem` 與 `vw`。只寫 `5vw` 的字級不跟著字型大小設定變；使用者用瀏覽器縮放時，視窗的 CSS 寬度跟著變小，`vw` 算出來的字也變小，兩者抵銷，放大 200% 字看起來也沒變大，過不了 1.4.4。上下限用 `rem`，至少保證使用者的設定有作用。下面這段算出三個寬度、兩種預設字級下的結果：

```js run
// 計算 clamp(min, base + slope*vw, max) 在不同視窗寬度與預設字級下的 px 值
function clampPx({ minRem, baseRem, vw, maxRem }, viewport, rootPx) {
  const preferred = baseRem * rootPx + (vw / 100) * viewport
  return Math.min(Math.max(preferred, minRem * rootPx), maxRem * rootPx)
}

const title = { minRem: 1.5, baseRem: 1.2, vw: 1.2, maxRem: 2 }   // clamp(1.5rem, 1.2rem + 1.2vw, 2rem)
const vwOnly = { minRem: 0, baseRem: 0, vw: 5, maxRem: 100 }      // font-size: 5vw

for (const rootPx of [16, 24]) {            // 預設字級：16px，以及使用者調大成 24px
  for (const viewport of [390, 768, 1280]) {
    const a = clampPx(title, viewport, rootPx).toFixed(1)
    const b = clampPx(vwOnly, viewport, rootPx).toFixed(1)
    console.log(`root ${rootPx}px  寬 ${String(viewport).padStart(4)}px  clamp 標題 ${a}px  只用 vw ${b}px`)
  }
}
```

只用 `vw` 的那一欄，不論使用者把預設字級調到多大都一樣。

### 視窗單位

- **`100vw`**：桌機有傳統捲軸（例如 Windows）時，`vw` 包含捲軸的寬度，`width: 100vw` 的區塊比可用寬度多出捲軸那一截，頁面出現橫向捲軸。滿版寬度用 `width: 100%`。
- **`100vh`**：手機瀏覽器的網址列會隨捲動展開與收起。`vh` 用的是網址列收起時的高度（等於 `lvh`），網址列展開時區塊比看得到的區域高，底部被蓋住。
- **`dvh`、`svh`、`lvh`**：`dvh` 跟著網址列即時變化；`svh` 固定用網址列展開時（最小）的高度。全螢幕的報到頁用 `min-height: 100dvh`；捲動時不希望跟著變高變矮的區塊用 `svh`。三者是 Baseline 2022，2025 年起 Widely available。

:::stop 讀到這裡可以先停：會依基準選長度單位、把行高寫成倍數、讓字級跟著使用者的設定變。後面的網頁字型與中文字型，在要自架字型或處理換字位移時再回來讀。

### 網頁字型怎麼載入

`@font-face` 只是宣告。瀏覽器排版時發現某段文字要用這個字型，才去下載；有 `unicode-range` 時，只下載涵蓋頁面上實際用到的字元的那幾片。字型還沒到的這段時間怎麼辦，由 `font-display` 決定：

| 值 | 字型還沒到時 | 之後到了 |
|---|---|---|
| `block` | 文字先隱形一段時間（規範建議約 3 秒），再用備用字型 | 換成網頁字型 |
| `swap` | 幾乎立刻用備用字型顯示 | 換成網頁字型（會看到字形跳一下） |
| `fallback` | 隱形很短（規範建議約 100ms），再用備用字型 | 在一段時間內（約 3 秒）到了才換，太晚就這次不換 |
| `optional` | 隱形很短，沒到就這次不用 | 不換，下次從快取拿到才用 |

文字隱形叫 FOIT（flash of invisible text），先顯示備用字型再跳成網頁字型叫 FOUT（flash of unstyled text）。內文與介面用 `swap`；只是裝飾、換了會讓版面跳的用 `optional`。

首屏一定會用到的字型可以預先下載：

```html
<link rel="preload" href="/fonts/board-digits.woff2" as="font" type="font/woff2" crossorigin>
```

字型一律以 CORS 模式下載，`preload` 少了 `crossorigin`，兩邊的請求對不上。在 Chromium 實測：同一個檔案下載兩次，Console 出現 `A preload for '…' is found, but is not used because the request credentials mode does not match. Consider taking a look at crossorigin attribute.`；預先下載了卻沒有任何文字用到時，則是 `… was preloaded using link preload but not used within a few seconds from the window's load event.`。

備用字型和網頁字型的字寬不同，換字時文字重新排版，下面的內容跟著位移（CLS）。`@font-face` 的 `size-adjust` 可以把備用字型縮放到接近網頁字型的寬度（Chrome 92、Firefox 92、Safari 17 起支援）；`ascent-override` 這類行高相關的設定 Safari 還不支援。

### 中文字型

一個中文字型的單一字重就有數 MB。本站標題用的圓體，800 字重的 `woff2` 合計約 5.6 MB，由 Fontsource 切成 118 個 `unicode-range` 片段，平均每片約 48 KB，頁面用到哪些字才下載哪幾片。自架字型時用這種已經切好片的套件，或用工具只保留需要的字；不要把整個字型檔放進 `@font-face`。

不下載字型時用系統字型堆疊：

```css
font-family: system-ui, "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif;
```

macOS 與 iOS 會用到蘋方（PingFang TC），Windows 是微軟正黑體，Android 的系統中文字型由系統提供。不同平台的字形與字寬不完全一樣，版面要能容納這個差異。

從公用 CDN 載入字型，不會因為別的網站載過就比較快：主要瀏覽器的 HTTP 快取已經依網站分開（Chrome 86 起）。

### 和中文介面有關的幾個屬性

- **`font-variant-numeric: tabular-nums`**：數字等寬，叫號號碼、時間、金額在表格裡對齊，數字跳動時寬度不變。
- **`text-wrap: balance`**：讓標題各行長度接近，不會留下一個字單獨在第二行；Baseline 2024。`text-wrap: pretty` 在 2026 年 11 月只有 Chromium 與 Safari 26 支援，不是 Baseline。
- **`overflow-wrap: anywhere`**：中文可以在任何字之間換行，但英文網址、Email 與病歷號不會，窄卡片裡一串網址會撐破版面，加這個屬性讓它在必要時斷開。
- **輸入框字級**：iOS Safari 在輸入框字級小於 16px 時，聚焦會自動放大整個頁面。表單元件的字級至少 `1rem`，或寫 `max(1rem, 16px)`。

## 實際程式

### 全站的文字設定

```css
/* 根元素不寫死字級，保留使用者在瀏覽器的設定 */
html { font-size: 100%; }

body {
  font: 1rem/1.7 system-ui, "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif;
}

h1 {
  font-size: clamp(1.5rem, 1.2rem + 1.2vw, 2rem);   /* 上下限用 rem */
  line-height: 1.3;                                 /* 不帶單位 */
  text-wrap: balance;
}

.prose { max-width: 40ic; }                         /* 每行大約 40 個中文字 */
.hint  { font-size: 0.875rem; }

.queue-no, .wait-time { font-variant-numeric: tabular-nums; }
.doctor-site { overflow-wrap: anywhere; }

input, select, textarea { font: inherit; font-size: max(1rem, 16px); }
```

### 候診清單：不寫死高度

```css
.queue-item {
  min-height: 3rem;          /* 原本是 height: 48px：字放大後內容被切掉 */
  padding: 0.75em 1em;       /* 用 em：內距跟著項目自己的字級 */
  display: grid;
  align-content: center;
}
.queue-item h3 { font-size: 1.25rem; line-height: 1.3; }
```

### 報到頁：底部按鈕不被網址列蓋住

```css
.checkin {
  min-height: 100dvh;                      /* 原本是 height: 100vh */
  display: grid;
  grid-template-rows: auto 1fr auto;       /* 標題、內容、按鈕列 */
}
```

### 叫號看板的數字字型

```css
@font-face {
  font-family: "Board Digits";
  src: url("/fonts/board-digits.woff2") format("woff2");
  font-display: swap;
  unicode-range: U+0030-0039, U+002D;      /* 只有數字與連字號，其他字用堆疊裡的下一個 */
}

/* 換字型時位移小一點：把備用字型調整到接近的寬度 */
@font-face {
  font-family: "Board Digits Fallback";
  src: local("Arial");
  size-adjust: 104%;                       /* 實際數值要對照兩個字型量出來 */
}

.board-number { font-family: "Board Digits", "Board Digits Fallback", sans-serif; }
```

```html
<!-- index.html 的 <head>：看板頁首屏一定用到，預先下載 -->
<link rel="preload" href="/fonts/board-digits.woff2" as="font" type="font/woff2" crossorigin>
```

## 常見錯誤與錯誤訊息

| 現象 | 原因 | 修法 |
|---|---|---|
| 調大瀏覽器字型，畫面上的字沒變 | 字級寫死 `px`，或根元素寫了 `font-size: 10px` | 字級用 `rem`；根元素用百分比或不設定 |
| 字放大後文字被切掉 | 容器寫死 `height` | 改 `min-height`，或讓內容撐開 |
| 標題換行後兩行疊在一起 | 父元素的 `line-height` 帶單位，子元素繼承固定值 | 行高寫不帶單位的倍數 |
| 第三層清單的字特別小 | 每層都用 `em` 縮小，倍數相乘 | 字級用 `rem` |
| 桌機出現橫向捲軸 | 滿版區塊寫 `width: 100vw`，包含了捲軸寬度 | 改 `width: 100%` |
| 手機底部按鈕被網址列蓋住 | 全螢幕區塊用 `100vh` | 改 `100dvh` 或 `100svh` |
| 字型下載兩次，Console 出現 `… request credentials mode does not match` | `preload` 少了 `crossorigin` | 加上 `crossorigin` |
| Console 出現 `… was preloaded using link preload but not used within a few seconds …` | 預先下載的字型沒有文字用到，或網址、`as`、`type` 不一致 | 只 preload 首屏用到的檔案，網址與 `@font-face` 的 `src` 一致 |
| `Rendered fonts` 顯示的是備用字型 | `@font-face` 的 `font-family` 名稱拼錯，或 `src` 路徑 404 | 對照名稱，在 Network 分頁看字型請求的狀態碼 |
| 換字型時下方內容跳動 | 備用字型與網頁字型字寬不同 | `size-adjust`，或改用 `font-display: optional` |
| iPhone 上點輸入框整頁放大 | 輸入框字級小於 16px | 表單元件字級至少 `1rem` |
| 中文標題的最後一個字掉到第二行 | 自動換行沒有平衡各行長度 | `text-wrap: balance` |

AI 產生的 CSS 常見的是：到處寫 `px`（尤其是從設計稿量出來的數字）、`height: 100vh`、帶單位的 `line-height`，以及用 `vw` 單獨決定字級。

## 動手

1. 按上面那段 `clamp()` 計算的「在 Playground 開啟」，把標題改成 `{ minRem: 1.25, baseRem: 1, vw: 2, maxRem: 2.5 }`，看 390px 與 1280px 時的字級；再把預設字級改成 20，確認上下限跟著變。
2. 打開自己的專案，在 Chrome 的 `chrome://settings/fonts` 把字型大小調到最大，逐頁檢查：哪些字沒變（寫死 `px`）、哪些地方被切掉（寫死高度）。
3. 選一個中文段落，在 Elements 分頁的 Computed 看 `Rendered fonts`：Mac 與 Windows 各看一次，比較實際用到的字型。
4. 版面的寬度與斷點見 [RWD 與斷點](#/skill/rwd)；字級、間距寫成 token 見 [design token 與主題](#/skill/design-tokens)。

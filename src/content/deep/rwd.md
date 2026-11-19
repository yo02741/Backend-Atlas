## 從一個具體問題開始：手機上字很小，還多一條橫向捲軸

「今日門診」頁在桌機上排得很好。用手機打開，整頁像一張縮小的桌機截圖，字小到要用兩指放大；放大之後，診間表格又比螢幕寬，要左右滑才看得到「候診人數」。

這裡有兩個獨立的問題：

1. `<head>` 少了 viewport meta。手機瀏覽器不知道這個頁面為手機設計過，就用大約 980px 的虛擬寬度排版，再把整頁縮小塞進螢幕。寫好的 `@media (max-width: 600px)` 永遠不會成立，因為頁面以為自己有 980px 寬。
2. 表格寫死了 `width: 960px`，圖片沒有最大寬度限制。就算寬度判斷正確，它們還是比螢幕寬。

RWD（Responsive Web Design）處理這兩層：讓 CSS 拿到正確的寬度，再讓版面依寬度改變排法。

## 運作原理

### viewport meta

```html
<meta name="viewport" content="width=device-width, initial-scale=1">
```

- `width=device-width`：版面寬度（layout viewport）等於裝置的寬度，以 CSS 像素計。一支 390 CSS 像素寬的手機，CSS 看到的寬度是 390px，實際的螢幕像素是它乘上 `devicePixelRatio`（例如 3 倍）。
- `initial-scale=1`：一開始不縮放。

不要加 `user-scalable=no` 或 `maximum-scale=1`。它們讓使用者不能放大，視力不好的人就看不清楚；Lighthouse 的 Accessibility 會列出這一項。

### media query 與 mobile-first

media query 依視窗的條件套用樣式，最常用的是寬度：

```css
/* 基本樣式：最窄的螢幕 */
.rooms { display: grid; grid-template-columns: 1fr; gap: 12px; }

/* 768px 以上：兩欄 */
@media (min-width: 768px) {
  .rooms { grid-template-columns: 1fr 1fr; }
}

/* 1280px 以上：三欄 */
@media (min-width: 1280px) {
  .rooms { grid-template-columns: repeat(3, 1fr); }
}
```

這是 mobile-first：沒有 media query 的樣式給手機，越寬的螢幕疊加越多規則。反過來從桌機版開始、用 `max-width` 往下覆寫也能做，但手機要先載入桌機的規則再一條條蓋掉，斷點一多就很難追哪一條生效。

範圍寫法 `@media (width >= 768px)` 和 `(min-width: 768px)` 意思相同，是 Baseline 2023，2025 年起列為 Widely available。除了寬度，常用的條件還有 `prefers-color-scheme: dark`（暗色主題）、`prefers-reduced-motion: reduce`（減少動態效果）、`hover: hover` 與 `pointer: coarse`（有沒有滑鼠、是不是觸控）。

### 斷點表

斷點是版面改變的寬度。先依內容決定（卡片放不下第二張、一行文字超過大約 70 個字），再整理成團隊共用的表。本站驗收用的三個寬度：

| 寬度 | 代表 | 「今日門診」頁的版面 |
|---|---|---|
| 390px | 手機直拿 | 卡片一欄；篩選收進 Drawer；表格改成每列一張卡 |
| 768px | 平板直拿、窄的桌機視窗 | 卡片兩欄；篩選列固定在上方 |
| 1280px | 筆電與桌機 | 左側常駐篩選側欄；卡片三欄 |

斷點的數字集中定義一次（CSS 變數不能用在 media query 的條件裡，所以通常放在 Sass 變數、PostCSS 設定或 Tailwind 的設定檔），元件不各自發明。

### container query：依父容器的寬度

media query 只看視窗。同一張「醫師卡片」放在 1280px 頁面的窄側欄裡只有 280px 寬，放在主欄有 600px 寬，用視窗寬度判斷就會選錯版面。container query 改看父容器：

```css
.doctor-slot {
  container-type: inline-size;   /* 這個元素成為容器，子孫可以查它的寬度 */
  container-name: doctor;
}

.doctor-card { display: grid; gap: 8px; }   /* 窄：照片在上、文字在下 */

@container doctor (min-width: 400px) {
  .doctor-card { grid-template-columns: 96px 1fr; }   /* 寬：照片在左 */
}
```

`@container` 裡的規則套用在容器的**子孫**上，容器本身不能查自己的寬度。container size query 是 Baseline 2023，2025 年起列為 Widely available。

### 流動寬度與圖片

固定的 `width: 960px` 換成會跟著變的寫法：

| 寫法 | 用途 |
|---|---|
| `max-width: 1200px; margin-inline: auto;` | 內容區最寬 1200px、置中，窄螢幕時自動變窄 |
| `width: min(100%, 640px)` | 取兩者較小的一個 |
| `font-size: clamp(1rem, 2.5vw, 1.5rem)` | 字級隨視窗寬度縮放，但不小於 1rem、不大於 1.5rem |
| `grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))` | 欄數依寬度自動決定，不用寫斷點 |

圖片的三件事：

```html
<img src="/img/clinic-800.jpg"
     srcset="/img/clinic-400.jpg 400w, /img/clinic-800.jpg 800w, /img/clinic-1600.jpg 1600w"
     sizes="(min-width: 768px) 50vw, 100vw"
     width="800" height="450" alt="第二門診大樓候診區">
```

```css
img { max-width: 100%; height: auto; }
```

- `max-width: 100%` 讓圖片不超過容器，`height: auto` 讓高度依比例縮。
- `width` 與 `height` 屬性讓瀏覽器在圖片下載完成前就知道比例，先留好空間，載入時版面不會往下跳。
- `srcset` 列出不同寬度的檔案，`sizes` 告訴瀏覽器圖片在版面上會占多寬，瀏覽器再依螢幕密度挑一個檔案下載。

### 視窗高度：`vh` 與 `dvh`

手機的網址列會隨捲動收合或展開，可見的高度跟著變。`100vh` 在多數手機瀏覽器上等於網址列收合時的高度，網址列展開時就比可見區域高，貼在底部的按鈕被蓋住。`dvh`（dynamic viewport height）跟著網址列變化；`svh` 固定取網址列展開時的較小高度，`lvh` 取收合時的較大高度。這組單位是 Baseline 2022，2025 年起列為 Widely available。

## 實際程式碼

「今日門診」頁的骨架：

```html
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="/assets/main.css">
</head>
<body>
  <header class="topbar">…</header>
  <div class="page">
    <aside class="filters">…</aside>
    <main>
      <ul class="rooms">
        <li class="doctor-slot"><article class="doctor-card">…</article></li>
      </ul>
    </main>
  </div>
</body>
```

```css
.page { display: grid; gap: 16px; padding-inline: 16px; }
.filters { display: none; }                 /* 手機：篩選收進 Drawer */
.rooms { display: grid; gap: 12px; padding: 0; list-style: none; }

@media (min-width: 768px) {
  .filters { display: flex; flex-wrap: wrap; gap: 8px; position: sticky; top: 0; }   /* 篩選列固定在上方 */
  .rooms { grid-template-columns: 1fr 1fr; }
}

@media (min-width: 1280px) {
  .page { grid-template-columns: 280px 1fr; max-width: 1440px; margin-inline: auto; }
  .filters { display: block; top: 16px; align-self: start; }                       /* 改成左側常駐側欄 */
  .rooms { grid-template-columns: repeat(3, 1fr); }
}

.doctor-slot { container-type: inline-size; }
.doctor-card { display: grid; gap: 8px; }
@container (min-width: 400px) {
  .doctor-card { grid-template-columns: 96px 1fr; }
}

.flow { min-height: 100dvh; display: flex; flex-direction: column; }   /* 全螢幕的掛號流程 */
.flow .actions { margin-top: auto; }                                     /* 「下一步」貼在底部 */
```

## 常見錯誤與錯誤訊息

- **沒有 viewport meta**：實機上字很小、media query 不生效；開發者工具的裝置模式不一定看得出來，最後要用實機確認。
- **`width: 100vw` 造成橫向捲軸**：在有傳統捲軸的桌機上，`100vw` 包含垂直捲軸的寬度，比內容區寬十幾個像素。全寬的區塊用 `width: 100%`。
- **`min-width` 與 `max-width` 混用時重疊**：`@media (max-width: 768px)` 與 `@media (min-width: 768px)` 在剛好 768px 時兩條都成立。全站統一用 mobile-first 的 `min-width`。
- **表格撐破版面**：寬表格包一層 `overflow-x: auto` 的容器，或在窄螢幕改成卡片。頁面本身不能左右滑。
- **`container-type` 讓元素縮成 0**：設了 `container-type: inline-size` 的元素，寬度不再由內容決定；放在沒有寬度的 inline-block 或 flex 子項裡時可能縮得很窄。容器要有來自外面的寬度（例如 grid 的欄或 `width: 100%`）。
- **忘了 `container-type`**：`@container` 找不到容器，裡面的規則永遠不生效，Styles 分頁也看不到它們。
- **圖片沒寫 `width`、`height`**：Rendering 面板勾 `Layout shift regions`，重新整理時位移的區域會閃藍色。Lighthouse 的效能報告也會列出造成版面位移（CLS）的元素。
- **觸控目標太小**：Lighthouse 的 Accessibility 出現 `Touch targets do not have sufficient size or spacing.`，代表按鈕或連結太小、靠得太近。

## 動手

- 打開本站首頁，用裝置模式選 `Responsive`，寬度依序輸入 390、768、1280，看路線圖與卡片怎麼換排法；工具列選單打開 `Show media queries`，點色條跳到斷點兩側。
- 在 Console 執行 `innerWidth` 與 `devicePixelRatio`，比較裝置模式選不同手機時的值。
- 把一個頁面的 viewport meta 刪掉，用實機或裝置模式開，看字變多小。
- 版面怎麼在一個方向上排，回頭看 [Flexbox：一維排列](#/skill/flexbox)；元件在不同寬度的驗收，照 [開發者工具：驗收前端的固定路線](#/skill/devtools) 的順序走。

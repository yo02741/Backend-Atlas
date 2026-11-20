## 從一個具體問題開始：醫師介紹頁在手機上又慢又跳

醫師介紹頁有 12 位醫師的照片，AI 產生的寫法是：

```html
<img src="/photos/doctor-wang.jpg" class="photo" loading="lazy">
```

照片是相機拍的原圖，2400 × 3200、一張 1.8 MB。用手機打開，出現了四個問題：

1. 頁面一共下載了二十多 MB，照片在畫面上只有 390px 寬。
2. 照片一張張載入時，下面的文字被往下推，正在讀的段落跳走。
3. 第一位醫師的照片在首屏，卻最後才出現。
4. 科別圖示在暗色主題裡還是黑色，看不見。

四個問題各有對應的寫法：`srcset` 與 `sizes` 讓瀏覽器挑合適大小的檔案；`width`、`height` 讓瀏覽器先保留空間；`loading="lazy"` 只給畫面下方的圖；圖示用內嵌 SVG 加 `currentColor`。

## 運作原理

### 瀏覽器怎麼挑檔案：`srcset` 與 `sizes`

```html
<img
  src="doctor-960.webp"
  srcset="doctor-480.webp 480w, doctor-960.webp 960w, doctor-1440.webp 1440w"
  sizes="(min-width: 1280px) 320px, (min-width: 768px) 50vw, 100vw"
  alt="王醫師，內科">
```

- `srcset` 列出同一張圖的幾個版本，`480w` 表示這個檔案寬 480 像素。
- `sizes` 告訴瀏覽器這張圖在版面上顯示多寬：由左往右找第一個符合的條件，`1280px` 以上顯示 320px，`768px` 以上顯示視窗寬的一半，其他情況佔滿視窗寬。
- `src` 是不支援 `srcset` 時的備援。

瀏覽器的步驟：

1. 用 `sizes` 算出顯示寬度（CSS 像素）。
2. 乘上螢幕密度（`devicePixelRatio`），得到需要的實際像素。
3. 通常挑寬度大於等於它的最小檔案。規格允許瀏覽器依快取、網路狀況調整，例如快取裡已經有較大的版本就直接用。

Chromium 實測（只換視窗寬度與密度）：

| 視窗 | 密度 | 顯示寬度 | 需要 | 下載 |
|---|---|---|---|---|
| 390px | 3 | 390px（100vw） | 1170 | 1440w |
| 390px | 2 | 390px | 780 | 960w |
| 800px | 1 | 400px（50vw） | 400 | 480w |
| 1280px | 1 | 320px | 320 | 480w |
| 1280px | 2 | 320px | 640 | 960w |
| 1280px，**沒寫 `sizes`** | 1 | 當成 1280px（100vw） | 1280 | 1440w |

最後一列是最常見的錯：照片在版面上只有 320px，但沒寫 `sizes`，瀏覽器以為它佔滿視窗，下載了最大的檔案。

`sizes` 一定要寫在 HTML 裡。瀏覽器在 CSS 還沒下載、版面還沒算出來之前就開始下載圖片（preload scanner 掃 HTML 時就發出請求），這時它只知道視窗寬度與 `sizes` 寫的數字。`sizes` 寫得比實際小，畫面會模糊；寫得比實際大，浪費流量。

`sizes="auto"` 搭配 `loading="lazy"` 可以讓瀏覽器用實際的版面寬度。2026 年 11 月時 Chrome 126、Firefox 150 起支援，Safari 27 只有部分支援（SVG 同時設了 `object-fit` 時會變形），web-features 還沒有把它標成 Baseline，目前仍要自己寫 `sizes`；寫成 `sizes="auto, (min-width: 768px) 50vw, 100vw"`，不支援的瀏覽器會略過 `auto`、改用後面的值。

固定大小的圖（例如 48px 的頭像）用 `x` 描述子，依密度挑：

```html
<img src="avatar-48.webp" srcset="avatar-48.webp 1x, avatar-96.webp 2x" width="48" height="48" alt="">
```

2 倍密度的螢幕下載 `avatar-96.webp`（實測）。

### `<picture>`：換格式、換構圖

`<picture>` 裡放幾個 `<source>`，瀏覽器用**第一個符合**的，都不符合時用 `<img>`：

```html
<!-- 換格式：支援 AVIF 的用 AVIF，再來 WebP，最後是 JPEG -->
<picture>
  <source type="image/avif" srcset="doctor-480.avif 480w, doctor-960.avif 960w" sizes="(min-width: 768px) 50vw, 100vw">
  <source type="image/webp" srcset="doctor-480.webp 480w, doctor-960.webp 960w" sizes="(min-width: 768px) 50vw, 100vw">
  <img src="doctor-960.jpg" srcset="doctor-480.jpg 480w, doctor-960.jpg 960w" sizes="(min-width: 768px) 50vw, 100vw"
       width="960" height="1280" alt="王醫師，內科">
</picture>

<!-- 換構圖（art direction）：寬螢幕用橫的團隊合照，手機用裁成方形的版本 -->
<picture>
  <source media="(min-width: 768px)" srcset="team-wide.webp">
  <img src="team-square.webp" width="800" height="800" alt="內科門診團隊">
</picture>
```

`type` 不認得的 `<source>` 會被跳過（實測一個 `type="image/x-unknown"` 的 source 被略過，用了 `<img>` 的 JPEG）。WebP 是 Baseline 2020，AVIF 是 Baseline 2024、2026 年 7 月起 Widely available；只支援新瀏覽器的專案，`srcset` 直接用 WebP 或 AVIF 也可以。很多 CDN 會依請求的 `Accept` 標頭自動回傳 AVIF 或 WebP，這時 HTML 只寫一個 `<img>`。

`alt`、`width`、`height`、`loading` 都寫在 `<img>` 上，`<source>` 只負責提供檔案。

### 先保留空間：`width`、`height` 與 `aspect-ratio`

圖片下載完之前，瀏覽器不知道它多高。沒有任何線索時，它先把圖片當成 0 高度排版，下載完再撐開，下面的內容被往下推，造成版面位移（CLS）。

`img` 寫上原圖的 `width` 與 `height` 屬性，瀏覽器就能先算出比例。實測 390px 寬的視窗裡，`<img width="960" height="1280">` 加上 CSS `width: 100%; height: auto`，下載完成前高度已經是 498.66px（374 × 1280 ÷ 960），computed 的 `aspect-ratio` 是 `auto 960 / 1280`；拿掉兩個屬性，下載前高度是 0。

```css
img { max-width: 100%; height: auto; }   /* 寬度跟著容器，高度依比例 */
```

屬性寫的是比例的來源，實際顯示的大小由 CSS 決定，兩者不衝突。`<video>` 的 `width`、`height` 屬性也一樣會用來算比例。

框的比例和原圖不同時（例如所有醫師照片都要 3 : 4，原圖有橫有直），用 `aspect-ratio` 固定框、`object-fit` 決定圖怎麼放：

| `object-fit` | 結果 |
|---|---|
| `fill`（預設） | 拉伸填滿，比例會變形 |
| `cover` | 等比例放大到填滿，多的部分裁掉 |
| `contain` | 等比例縮到完整放進去，旁邊留白 |

`object-position: top` 讓 `cover` 裁切時保留上半部，人像照常用。

### `loading="lazy"` 與 `fetchpriority`

`loading="lazy"` 讓圖片接近視窗時才下載。實測一張放在 5000px 以下的 lazy 圖片，頁面載入時沒有發出請求。圖片與 iframe 的 lazy loading 是 Baseline 2023，2026 年 6 月起 Widely available。

首屏最大的那張圖通常是 LCP（Largest Contentful Paint）元素，決定使用者覺得頁面多快出現。給它 `loading="lazy"`，瀏覽器要等版面排好、確認它在視窗內才開始下載，LCP 因此變慢，開頭的第三個問題出在這裡。首屏主圖不加 `loading`，可以加 `fetchpriority="high"`（Baseline 2024）讓它比其他圖片先下載。

### `alt`

| 圖片的用途 | `alt` |
|---|---|
| 傳達資訊（醫師照片、診間位置圖） | 寫出圖片要傳達的內容：「王醫師，內科」「3 樓內科診間在電梯右側」 |
| 純裝飾（背景花紋、旁邊已有文字說明的插圖） | `alt=""`，螢幕閱讀器跳過 |
| 放在連結或按鈕裡、是唯一的內容 | 寫出連結的目的或按鈕的動作：「回首頁」 |

沒有 `alt` 屬性和 `alt=""` 不一樣：沒有屬性時，螢幕閱讀器可能念出檔名。`alt` 不要寫「圖片」「照片」，螢幕閱讀器已經會說它是圖片。

### SVG 圖示

內嵌在 HTML 裡的 `<svg>` 是頁面的一部分，CSS 改得到它：

```html
<button type="button" class="icon-button" aria-label="重新整理">
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M12 4a8 8 0 1 0 7.75 10h-2.1A6 6 0 1 1 12 6v3l4-4-4-4z"/>
  </svg>
</button>
```

- `fill="currentColor"` 讓圖示用文字的顏色，hover、停用、暗色主題都跟著變。
- 只有圖示的按鈕，名稱寫在 `button` 的 `aria-label`；圖示本身 `aria-hidden="true"`。
- 用 `<img src="icon.svg">` 載入的 SVG 是一張獨立的圖，外面的 CSS 改不到它裡面的 `fill`。開頭的第四個問題：圖示的顏色寫死在 SVG 檔裡，又用 `<img>` 載入。
- 很多圖示時，用 sprite：把圖示定義在一個 `<svg>` 的 `<symbol>` 裡，使用處寫 `<svg><use href="#icon-refresh"/></svg>`。

使用者上傳的 SVG 檔可能含有 script。用 `<img>` 顯示時 script 不會執行，但直接在同一個網域打開那個檔案就會；伺服器端的處理見 [XSS、CSRF 與安全標頭](#/skill/xss-csrf)。

:::stop 讀到這裡可以先停：會寫 `srcset` 與 `sizes`、用寬高先保留空間、只給首屏以下的圖 `loading="lazy"`、用 `currentColor` 的 SVG 圖示。後面的影片與快取，在頁面要放影片或調整快取時再回來讀。

### 影片

```html
<video controls preload="metadata" poster="intro-poster.webp" width="1280" height="720">
  <source src="clinic-intro.mp4" type="video/mp4">
  <track kind="captions" src="clinic-intro.zh-TW.vtt" srclang="zh-TW" label="中文字幕">
</video>
```

- `poster` 是播放前顯示的圖；`preload="metadata"` 只先下載長度與尺寸，`none` 什麼都不先下載。
- 背景影片要自動播放，瀏覽器的自動播放政策通常要求 `muted`；iPhone 上還要 `playsinline`，否則會跳到全螢幕播放。
- 有說話的影片附字幕（`<track kind="captions">`）。

### 快取

圖片檔通常很大，又很少改。檔名帶內容的 hash（Vite 建置時，`import` 進來的圖片預設輸出成 `assets/doctor-wang-[hash].webp`），伺服器就能回很長的快取時間，換圖時檔名跟著變。快取標頭怎麼設，見 [HTTP 快取與條件請求](#/skill/http-caching)。

## 實際程式碼

醫師卡片：

```html
<ul class="doctors">
  <li class="doctor">
    <!-- 第一位在首屏：不 lazy，提高優先順序 -->
    <img class="photo"
         src="/photos/wang-960.webp"
         srcset="/photos/wang-480.webp 480w, /photos/wang-960.webp 960w, /photos/wang-1440.webp 1440w"
         sizes="(min-width: 1280px) 320px, (min-width: 768px) 50vw, 100vw"
         width="960" height="1280"
         fetchpriority="high"
         alt="王醫師，內科">
    <h2>王醫師</h2>
    <p class="dept">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
        <use href="#icon-stethoscope"/>
      </svg>
      內科
    </p>
  </li>
  <li class="doctor">
    <!-- 第二位之後：lazy -->
    <img class="photo"
         src="/photos/lin-960.webp"
         srcset="/photos/lin-480.webp 480w, /photos/lin-960.webp 960w, /photos/lin-1440.webp 1440w"
         sizes="(min-width: 1280px) 320px, (min-width: 768px) 50vw, 100vw"
         width="960" height="1280"
         loading="lazy"
         alt="林醫師，骨科">
    <h2>林醫師</h2>
  </li>
</ul>
```

```css
.photo {
  width: 100%;
  height: auto;
  aspect-ratio: 3 / 4;     /* 原圖比例不一時，框一律 3:4 */
  object-fit: cover;       /* 填滿框，多的裁掉 */
  object-position: top;    /* 人像保留上半部 */
}
.dept svg { fill: currentColor; vertical-align: -2px; }

/* 768px 起兩欄、1280px 起每張 320px：和 sizes 寫的一致 */
.doctors { display: grid; gap: 24px; grid-template-columns: 1fr; }
@media (min-width: 768px) { .doctors { grid-template-columns: 1fr 1fr; } }
@media (min-width: 1280px) { .doctors { grid-template-columns: repeat(auto-fill, 320px); } }
```

`sizes` 是對版面的描述，改了 CSS 的欄寬就要一起改 `sizes`。

### 算會下載哪個檔案

下面用同樣的規則，算出不同的視窗與密度會下載哪個檔案：

```js run
// 簡化版的 srcset 挑選：先用 sizes 算出顯示寬度，再乘上螢幕密度，挑寬度大於等於它的最小檔案
// （規格允許瀏覽器依快取、網路狀況改挑別的檔案；這裡寫的是一般情況）
const srcset = 'doctor-480.webp 480w, doctor-960.webp 960w, doctor-1440.webp 1440w'
const sizes = '(min-width: 1280px) 320px, (min-width: 768px) 50vw, 100vw'

function parseSrcset(s) {
  return s.split(',').map((part) => {
    const [url, w] = part.trim().split(/\s+/)
    return { url, w: parseInt(w, 10) }
  }).sort((a, b) => a.w - b.w)
}
// 只處理 (min-width: Npx)、(max-width: Npx) 與 px、vw 兩種長度
function slotWidth(sizesAttr, viewport) {
  for (const entry of (sizesAttr || '100vw').split(',')) {
    const m = entry.trim().match(/^(?:\((min|max)-width:\s*(\d+)px\)\s+)?(\d+(?:\.\d+)?)(px|vw)$/)
    if (!m) continue
    const [, kind, bp, len, unit] = m
    const ok = !kind || (kind === 'min' ? viewport >= Number(bp) : viewport <= Number(bp))
    if (ok) return unit === 'vw' ? (viewport * Number(len)) / 100 : Number(len)
  }
  return viewport
}
function pick(viewport, dpr, sizesAttr) {
  const slot = slotWidth(sizesAttr, viewport)
  const need = slot * dpr
  const list = parseSrcset(srcset)
  const chosen = list.find((c) => c.w >= need) || list[list.length - 1]
  return `視窗 ${viewport}px × ${dpr} 倍：顯示 ${slot}px，需要 ${need} 像素 → ${chosen.url}`
}

console.log('有 sizes')
for (const [vw, dpr] of [[390, 3], [390, 2], [800, 1], [1280, 1], [1280, 2]]) console.log('  ' + pick(vw, dpr, sizes))
console.log('沒寫 sizes（當成 100vw）')
for (const [vw, dpr] of [[390, 1], [1280, 1]]) console.log('  ' + pick(vw, dpr, ''))
```

輸出和上面表格的 Chromium 實測結果相同。

## 常見錯誤與錯誤訊息

- **下載的檔案比顯示的大很多**：Performance 分頁錄一次載入，Insights 的 `Improve image delivery` 會列出這類圖片，訊息是 `This image file is larger than it needs to be (…) for its displayed dimensions (…). Use responsive images to reduce the image download size.`。補上 `srcset` 與 `sizes`，或檢查 `sizes` 是不是和 CSS 的欄寬對不上。
- **沒寫 `sizes`**：桌機上的小圖下載最大的檔案。Console 執行 `$0.currentSrc`（先在 Elements 選取那個 `img`）看實際用了哪個檔案。
- **版面跳動**：Performance 的 `Layout shift culprits` 標出 `Unsized image`；Lighthouse 的對應項目是「Image elements do not have explicit `width` and `height`」。補上 `width`、`height` 屬性。
- **首屏主圖 lazy**：Performance 的 `LCP request discovery` 出現 `LCP resources shouldn’t use loading=lazy`；沒有提高優先順序時是 `fetchpriority=high should be applied`。
- **所有圖片都 `fetchpriority="high"`**：每張都高，等於沒有分別。只給首屏主圖。
- **圖片變形**：框的比例和原圖不同，又沒寫 `object-fit`，預設的 `fill` 把圖拉伸。加 `object-fit: cover`。
- **沒有 `alt` 或 `alt` 是檔名**：Lighthouse 的 Accessibility 列出「Image elements do not have `[alt]` attributes」。裝飾圖寫 `alt=""`，內容圖寫出內容。
- **圖示顏色不跟著變**：SVG 裡寫死了 `fill="#000"`，或用 `<img>` 載入。改成內嵌 SVG 加 `fill="currentColor"`。
- **背景影片不會自動播放**：少了 `muted`；iPhone 上跳全螢幕是少了 `playsinline`。

## 動手

- 按上面「算會下載哪個檔案」的「在 Playground 開啟」，把 `sizes` 改成空字串，看 1280px 的桌機下載哪個檔案；再把第一個條件改成 `(min-width: 1280px) 400px`，看 2 倍密度時會不會換成 1440w。
- 在 DevTools 的裝置模式選一支 3 倍密度的手機，打開一個用了 `srcset` 的頁面，在 Network 分頁篩選 `Img`，對照 `$0.currentSrc` 與上面的算法。
- Rendering 面板勾 `Layout shift regions`，打開自己專案裡一個有圖片的頁面重新整理，找出閃藍色的區域，補上 `width`、`height`。
- 圖片在不同寬度怎麼排，回到 [RWD 與斷點](#/skill/rwd) 與 [Grid](#/skill/grid)。

## 從一個具體問題開始：Lighthouse 98 分，病患說很慢

門診看板頁（各診間目前叫到幾號）在工程師的筆電上跑 Lighthouse，效能 98 分。上線後收到病患回報：手機打開要等很久，好不容易看到看板，正要點自己的診間，上方突然插進一條「颱風停診公告」，整個畫面往下掉，點到了隔壁診間；護理站的大螢幕按「下一號」，號碼要半秒多才變。

三個抱怨正好對應 Core Web Vitals 的三個指標：

| 抱怨 | 指標 | 量什麼 |
|---|---|---|
| 要等很久才看到看板 | LCP（Largest Contentful Paint） | 主要內容多久出現 |
| 畫面突然往下掉，點錯 | CLS（Cumulative Layout Shift） | 版面跳了多少 |
| 按了半秒多才變 | INP（Interaction to Next Paint） | 操作後多久看到畫面更新 |

Lighthouse 分數高，是因為它在快速的筆電與網路上、沒有人操作、公告也還沒插入時量了一次。指標要看使用者那一端。

## 運作原理

### 門檻與評等

web-vitals 6.2.3 原始碼裡的常數：

| 指標 | 良好（good） | 需要改善（needs-improvement） | 差（poor） |
|---|---|---|---|
| LCP | ≤ 2500 ms | 2500–4000 ms | > 4000 ms |
| INP | ≤ 200 ms | 200–500 ms | > 500 ms |
| CLS | ≤ 0.1 | 0.1–0.25 | > 0.25 |

判斷是「大於第一個門檻就是 needs-improvement、大於第二個就是 poor」，所以剛好 2500 ms 算良好。一個網站的評等看實際使用者的第 75 百分位（p75）：75% 的造訪在良好以內才算良好，手機與桌機分開算。INP 在 2024 年 3 月 12 日取代 FID 成為 Core Web Vitals 的一員。

### LCP：最大的那塊什麼時候畫出來

LCP 是視窗內最大的圖片、影片封面或文字區塊畫出來的時間，從開始載入頁面算起。頁面載入中，越大的元素出現，LCP 候選就更新一次；使用者第一次點擊、按鍵或切走分頁後就定案（web-vitals 監聽 `keydown`、`click`、`visibilitychange` 來結束 LCP）。

主圖是 LCP 元素時，時間可以拆成四段，DevTools 的 `LCP breakdown` 與 web-vitals 的 attribution 都用這四段：

```
0 ──── TTFB ────┬── 資源載入延遲 ──┬── 資源載入時間 ──┬── 元素渲染延遲 ──┤ LCP
     HTML 第一個  │  發現主圖、開始下載  │  主圖下載完        │  CSS、字型、JS 擋住  │
     位元組到達   │  之前的空等          │                    │  讓它還沒畫出來      │
```

| 段落 | 常見原因 | 修法 |
|---|---|---|
| TTFB（time to first byte） | 伺服器慢、重新導向、沒有 CDN | 後端與快取（見 [HTTP 快取與條件請求](#/skill/http-caching)） |
| 資源載入延遲（resource load delay） | 主圖 `loading="lazy"`、是 CSS 背景圖、由 JS 渲染才出現、優先順序低 | 拿掉 lazy、加 `fetchpriority="high"`、必要時 `preload`；CSR 的頁面考慮 SSR 或 SSG |
| 資源載入時間（resource load duration） | 圖片太大 | 壓縮、AVIF 或 WebP、`srcset` 與 `sizes` |
| 元素渲染延遲（element render delay） | render-blocking 的 CSS 與 script、長任務 | 見 [一個頁面的載入順序](#/skill/page-loading) |

### CLS：沒有預期的位移

一次版面位移的分數是：

```
位移分數 = 影響比例（impact fraction）× 距離比例（distance fraction）
```

影響比例是「移動前後佔用的區域聯集」佔視窗面積的比例，距離比例是「移動距離」佔視窗高度（或寬度，取較大者）的比例。例如視窗高 800px，看板佔下方 640px，上方插入 120px 的公告：移動前後聯集是 640px 高，影響比例 0.8；移動 120px，距離比例 0.15；這一次的分數是 0.12，已經超過 0.1。

位移會分組（session window）：和前一次相隔不到 1 秒、而且離這組第一次不到 5 秒，就算同一組；CLS 是分數最大的那一組的總和。使用者點擊、按鍵後 0.5 秒內發生的位移（例如按「展開」之後內容推開）不算，因為那是預期中的。

常見來源：沒有寬高的圖片、晚插入的廣告與公告橫幅、iframe 嵌入、網頁字型換上時文字重新換行、在既有內容上方插入東西。DevTools 的 `Layout shift culprits` 會標出 `Unsized image element`、`Web font`、`Injected iframe` 這類原因。

### INP：操作到下一次畫面更新

一次互動（點擊、觸控、按鍵；捲動與滑鼠移過不算）的延遲拆成三段：

```
點下去 ── input delay ──┬── processing duration ──┬── presentation delay ──┤ 畫面更新
        主執行緒還在忙   │  事件處理函式在執行        │  樣式、版面、繪製
```

- **input delay**：點下去的時候主執行緒正在跑別的 task（第三方 script、上一次的長任務），事件要排隊。
- **processing duration**：`click`、`input` 這些處理函式本身的時間，包含 Vue 因為狀態改變而重新渲染。
- **presentation delay**：處理完之後算樣式、版面、繪製下一張畫面的時間；DOM 很大時這段會變長。

頁面的 INP 是整段造訪中最慢的那一次互動；互動很多時，每 50 次略去一個最高值，排除偶發的極端值。主執行緒為什麼會「忙」，以及 task 與渲染的順序，見 [事件迴圈](#/skill/event-loop)。

### 實驗室數據與實際數據

| | 實驗室（lab） | 實際（field） |
|---|---|---|
| 工具 | Lighthouse、DevTools 的 Performance 分頁 | CrUX（Chrome 使用者體驗報告）、PageSpeed Insights 上半部、web-vitals 套件 |
| 誰的資料 | 自己的電腦、設定好的節流 | 真實使用者的裝置與網路 |
| 用途 | 重現與找原因 | 判斷使用者實際的體驗、評等 |
| INP | Lighthouse 的一般報告沒有（沒有人操作），改用 Total Blocking Time | 有 |

Lighthouse 13.6 的效能分數由五項加權：Total Blocking Time 30%、LCP 25%、CLS 25%、FCP 10%、Speed Index 10%。CrUX 是以近 28 天為一期的滾動資料，只收公開、流量夠的網站；要登入的院內系統多半查不到，要自己用 web-vitals 套件收。

### web-vitals 套件的支援範圍

web-vitals 6.2.3 的 README 列出：`onLCP`、`onINP` 在 Chromium、Firefox、Safari 都能量；`onCLS` 只有 Chromium。Safari 使用者的 CLS 收不到，不代表沒有位移。

還有一個 SPA 要注意的地方：這些指標預設以「一次完整的頁面載入」為單位。Vue Router 換頁不會重新載入，INP 與 CLS 會一直累積到使用者離開。web-vitals 6 加了 `reportSoftNavs: true`，在 Chromium 151 起的瀏覽器把這類「軟導覽」分開計算，其他瀏覽器沒有作用。

## 實際程式

### 收集實際數據

```js
// src/vitals.js：在 main.js 裡 import 一次
import { onCLS, onINP, onLCP } from 'web-vitals/attribution'

function send(metric) {
  const a = metric.attribution
  const body = JSON.stringify({
    name: metric.name,          // 'LCP' | 'INP' | 'CLS'
    value: metric.value,
    rating: metric.rating,      // 'good' | 'needs-improvement' | 'poor'
    id: metric.id,
    page: location.pathname,    // 不送 query string，避免帶到病歷號
    // attribution：哪個元素、哪一段花了時間
    target: a.target ?? a.interactionTarget ?? a.largestShiftTarget,
    // INP：三段的時間，以及花最多時間的 script（來自 Long Animation Frames API，目前只有 Chromium 有）
    inputDelay: a.inputDelay,
    processingDuration: a.processingDuration,
    presentationDelay: a.presentationDelay,
    script: a.longestScript?.entry?.sourceURL,
    fn: a.longestScript?.entry?.sourceFunctionName,
  })
  // fetchLater() 由瀏覽器在離開頁面時送出（Chrome、Edge 135 起）；沒有就用 sendBeacon
  if (globalThis.fetchLater) {
    try { fetchLater('/api/vitals', { method: 'POST', body }) } catch { navigator.sendBeacon('/api/vitals', body) }
  } else {
    navigator.sendBeacon('/api/vitals', body)
  }
}

onLCP(send)
onINP(send)
onCLS(send)
```

Chrome 團隊給 coding agent 的 Modern Web Guidance 建議這類「不需要回應、晚點送也可以」的資料用 `fetchLater()`，並提醒在 `unload` 事件裡送資料（例如插一個 `<img>`）在手機上常常送不出去，還會讓頁面無法進入 bfcache。`fetchLater()` 目前是 Limited availability，所以上面用 `sendBeacon` 當退路。

`onINP` 與 `onCLS` 會在分頁切到背景時回報（之後還可能再回報更大的值），沒有互動時 INP 不會回報；所以後端收到的筆數三個指標不會一樣多。web-vitals 的 README 也提醒不要重複呼叫這些函式，每呼叫一次就多一組監聽。

後端存下來後，依頁面與裝置類型算每個指標的 p75，和門檻比較。下面這段示範為什麼要看 p75 而不是平均，以及 CLS 的分組怎麼算：

```js run
// web-vitals 6 的門檻與評等規則：大於第一個門檻是 needs-improvement，大於第二個是 poor
const THRESHOLDS = { LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25] }
const rating = (name, v) => (v > THRESHOLDS[name][1] ? 'poor' : v > THRESHOLDS[name][0] ? 'needs-improvement' : 'good')

// 第 75 百分位：排序後取 75% 的位置（這裡用最近排名法）
function p75(values) {
  const s = [...values].sort((a, b) => a - b)
  return s[Math.ceil(s.length * 0.75) - 1]
}

// 十次造訪收到的 LCP（毫秒）：平均看起來不錯，p75 卻超標
const lcp = [1200, 1350, 1400, 1600, 1700, 1900, 2100, 2600, 3900, 4800]
const avg = lcp.reduce((a, b) => a + b, 0) / lcp.length
console.log('LCP 平均', avg, rating('LCP', avg))
console.log('LCP p75 ', p75(lcp), rating('LCP', p75(lcp)))

// CLS：位移依時間分組，和前一次相隔不到 1 秒、離這組第一次不到 5 秒就算同一組，取最大的一組
function cls(shifts) {
  let best = 0, cur = 0, first = null, last = null
  for (const s of shifts) {
    if (cur && s.t - last < 1000 && s.t - first < 5000) cur += s.value
    else { cur = s.value; first = s.t }
    last = s.t
    best = Math.max(best, cur)
  }
  return +best.toFixed(3)
}
const shifts = [
  { t: 1300, value: 0.04 },   // 網頁字型換上，標題換行
  { t: 2200, value: 0.12 },   // 公告橫幅插在看板上方
  { t: 4800, value: 0.05 },   // 圖片沒有寬高，載入後撐開
]
console.log('CLS', cls(shifts), rating('CLS', cls(shifts)))
const fixed = shifts.filter((s) => s.t !== 2200)   // 橫幅預留空間之後
console.log('預留空間後的 CLS', cls(fixed), rating('CLS', cls(fixed)))
```

### 三個指標各自的修法

```html
<!-- LCP：首屏主圖不 lazy、提高優先順序、寫寬高（同時避免 CLS） -->
<img src="/img/board-hero.webp" width="1200" height="480"
     fetchpriority="high" alt="門診大樓入口">

<!-- 首屏以下的圖片才 lazy -->
<img src="/img/map.webp" width="800" height="600" loading="lazy" alt="院區平面圖">
```

`fetchpriority` 是 Baseline 2024（2024-10 起 Chrome、Firefox、Safari 都支援）。`fetchpriority="high"` 只給一兩張真正的 LCP 候選，給太多張等於都沒提高；不要和 `loading="lazy"` 一起用。輪播裡一開始看不到的圖片、選單展開才出現的圖片，可以用 `fetchpriority="low"` 讓出頻寬；一般捲到才看得到的圖片用 `loading="lazy"` 就好，不必再加 `low`。

```css
/* CLS：公告橫幅的位置先留好，內容晚到也不推動看板 */
.notice-slot { min-height: 120px; }

/* CLS：網頁字型。optional 讓瀏覽器在極短時間內等不到字型就用備用字型，之後不換 */
@font-face {
  font-family: 'Clinic Sans';
  src: url('/fonts/clinic-sans.woff2') format('woff2');
  font-display: optional;
}

/* 或者保留 swap，但把備用字型的大小調得接近網頁字型，換字時不重新換行 */
@font-face {
  font-family: 'Clinic Sans Fallback';
  src: local('Arial');
  size-adjust: 104%;   /* 數值依實際的兩套字型量出來 */
}
body { font-family: 'Clinic Sans', 'Clinic Sans Fallback', sans-serif; }
```

`size-adjust` 在 Chrome 92、Firefox 92、Safari 17 起支援；更細的 `ascent-override`、`descent-override` 依 @mdn/browser-compat-data 8.1.9，Safari 還沒有支援。另一個比較省事的做法是在文字容器上寫 `font-size-adjust: from-font`，讓瀏覽器依網頁字型的 x-height 縮放備用字型（Baseline 2024，2024-07 起）。調完之後在 DevTools 暫時擋掉字型檔（Network 分頁的 Block request URL），看文字的行數有沒有變。

```js
// INP：先讓畫面更新，其餘的工作讓出主執行緒之後再做
function yieldToMain() {
  // scheduler.yield() 是 Limited availability（Chrome 129、Firefox 142 起，Safari 還沒有）
  if (globalThis.scheduler?.yield) return scheduler.yield()
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function onNextNumber() {
  current.value += 1          // 1. 畫面上要看到的狀態先改
  busy.value = true
  await yieldToMain()         // 2. 讓瀏覽器先畫出新號碼
  writeCallLog(current.value) // 3. 寫紀錄、重算統計這些可以晚一點
  recomputeStats()
  busy.value = false
}
```

事件處理函式裡要跑一個大迴圈（例如重算 3,000 筆的統計）時，不是只讓出一次，而是每做 50 毫秒就讓出一次，讓中間的點擊與繪製插得進來（Modern Web Guidance 的 Break Up Long Tasks 用的就是這個寫法）：

```js
async function recomputeStats(rows) {
  let deadline = performance.now() + 50   // 50 ms 是長任務的界線
  for (const row of rows) {
    accumulate(row)
    if (performance.now() >= deadline) {
      await yieldToMain()
      deadline = performance.now() + 50
    }
  }
}
```

## 常見錯誤與錯誤訊息

DevTools 的 Performance 分頁錄一次載入（`Record and reload`）或操作，Insights 面板會用固定的標題指出原因：

| Insight 或現象 | 原因 | 修法 |
|---|---|---|
| `LCP request discovery`：`LCP resources shouldn’t use loading=lazy` | 首屏主圖加了 `loading="lazy"`，要等版面算完才開始下載 | 拿掉 `loading="lazy"` |
| `LCP request discovery`：`fetchpriority=high should be applied` | 主圖用一般優先順序，和其他資源搶頻寬 | 加 `fetchpriority="high"` |
| `LCP breakdown` 的 `Resource load delay` 很長 | 主圖太晚被發現：CSS 背景圖、JS 渲染才出現 | 改成 `<img>`，或 `<link rel="preload" as="image">` |
| `Layout shift culprits`：`Unsized image element` | `<img>` 沒有 `width`、`height` | 補上寬高或 `aspect-ratio` |
| `Layout shift culprits`：`Web font` | 字型換上時文字重新換行 | `font-display: optional`，或調整備用字型 |
| `Font display` | 字型的 `font-display` 讓文字在載入期間看不見 | 文件建議改 `swap` 或 `optional` |
| `INP breakdown` 的 `Processing duration` 很長 | 事件處理函式（含重新渲染）太久 | 拆開、讓出主執行緒、移到 Web Worker |
| `INP breakdown` 的 `Input delay` 很長 | 點下去時主執行緒正在跑別的長任務 | 找出那個 task（常是第三方 script） |
| Lighthouse 100 分，實際數據的 INP 很差 | Lighthouse 的一般報告沒有操作，沒有量 INP | 看實際數據；在 Performance 分頁自己錄操作，CPU 加 `4× slowdown` |
| Safari 使用者沒有 CLS 數據 | `onCLS` 只在 Chromium 能量 | 用 Chromium 的數據代表，Safari 上實機檢查 |

## 動手

1. 打開 [VitalsLab](#/lab/VitalsLab)：把主圖切成 `loading="lazy"` 並拉大檔案，看 LCP 跨過 2.5 秒與 4 秒；插入沒有預留空間的公告橫幅，看 CLS 怎麼加總；把長任務拉到 400 毫秒，再打開「讓出主執行緒」，比較 INP 的三段。
2. 按上面 `js run` 區塊的「在 Playground 開啟」，把公告的時間改成 4000，看它和 4800 的位移是否變成同一組。
3. 在自己的頁面打開 Performance 分頁，看 `Local metrics` 的 LCP 是哪個元素；錄一次 `Record and reload`，讀 `LCP breakdown` 的四段。
4. 勾 Rendering 面板的 `Layout shift regions`，重新整理，找出閃藍色的區塊。
5. 把「實際程式」的 `src/vitals.js` 接到測試環境，一週後算每頁手機的 p75。

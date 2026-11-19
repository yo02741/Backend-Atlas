## 從一個具體問題開始：只有掛號櫃台那台電腦壞掉

門診前端改版後，大部分櫃台都正常，只有一號櫃台打開「今日掛號」就是空白。那台電腦跑 Windows 7，Chrome 停在 109 版（Windows 7 能裝的最後一版）。用遠端桌面打開它的 DevTools，Console 寫著：

```
Uncaught TypeError: Object.groupBy is not a function
    at index-C3k9aQ2x.js:1:48211
```

工程師的第一反應是「Vite 不是會轉成舊瀏覽器看得懂的程式嗎？」打開 `vite.config.js`，`build.target` 甚至已經設成 `chrome109`。問題出在 `build.target` 管的範圍：它只轉換語法，不補 API。`Object.groupBy` 是 Chrome 117 才有的函式，產物裡原樣保留，Chrome 109 執行到這一行才發現沒有這個函式。

## 運作原理

### 語法與 API 是兩件事

| 類型 | 例子 | 舊瀏覽器遇到時 | 誰能處理 |
|---|---|---|---|
| 語法 | `a?.b`、`a ?? b`、class fields、`async`/`await` | 整個檔案解析失敗：`SyntaxError: Unexpected token` | `build.target` 改寫成舊語法 |
| 內建 API | `Object.groupBy`、`Array.prototype.toSorted`、`structuredClone`、`Promise.withResolvers` | 執行到那一行才丟出 `TypeError: … is not a function` | polyfill（用 JS 補上同名函式）或改寫程式 |
| Web API | `scheduler.yield()`、Popover API、`IntersectionObserver` | 同上，或物件不存在 | polyfill、功能偵測 |
| CSS | `:has()`、container query、`text-wrap: balance` | 不報錯，規則被忽略 | `@supports`、寫兩層樣式 |

用 Vite 8 實際建置一段程式、`build.target: 'es2019'`，產物是這樣：

```js
// 原始碼
const byRoom = Object.groupBy(appts, (a) => a.room)
const sorted = appts.map((a) => a.doctor?.name ?? '未排班').toSorted()

// 建置後（節錄）：?. 與 ?? 被改寫，groupBy 與 toSorted 原封不動
var byRoom = Object.groupBy(appts, (a) => a.room);
var sorted = appts.map((a) => {
	var _a$doctor$name, _a$doctor;
	return (_a$doctor$name = (_a$doctor = a.doctor) === null || _a$doctor === void 0 ? void 0 : _a$doctor.name) !== null && _a$doctor$name !== void 0 ? _a$doctor$name : "未排班";
}).toSorted();
```

Vite 的型別說明直接寫明 `build.target` 「only handles syntax transformation and does not cover polyfills」。

### Vite 的預設目標

| 版本 | `build.target` 預設 | 代表的瀏覽器 |
|---|---|---|
| Vite 6 | `'modules'` | Chrome 87、Edge 88、Firefox 78、Safari 14 起 |
| Vite 7 | `'baseline-widely-available'` | Chrome 107、Edge 107、Firefox 104、Safari 16 起 |
| Vite 8 | `'baseline-widely-available'` | Chrome 111、Edge 111、Firefox 114、Safari 16.4 起（以 2026-01-01 的 Baseline Widely available 為準） |

（取自各版套件裡的 `ESBUILD_BASELINE_WIDELY_AVAILABLE_TARGET` 與 `ESBUILD_MODULES_TARGET` 常數，Vite 6.4.3、7.3.8、8.3.8。）

升級 Vite 的主版本，等於把最低支援的瀏覽器往上調。Vite 的文件也說明，就算把 target 設得更低（最低 `es2015`），產物仍然用 ES modules 的動態 `import()` 與 `import.meta`，至少要 Chrome 64、Firefox 67、Safari 11.1、Edge 79。

target 設得比程式用到的語法還舊，而那個語法又改寫不了時，建置會失敗。Vite 6 的預設目標遇到 top-level await：

```
[vite:esbuild-transpile] Transform failed with 1 error:
assets/index-!~{001}~.js:39:12: ERROR: Top-level await is not available in the configured target environment ("chrome87", "edge88", "es2020", "firefox78", "safari14" + 2 overrides)
```

同一段程式用 Vite 8 的預設目標建置可以通過。

### polyfill 與 `@vitejs/plugin-legacy`

polyfill 是一段先檢查、沒有就補上的程式：

```js
// Object.groupBy 的最小 polyfill（只示意；正式專案用 core-js 這類維護中的實作）
if (!('groupBy' in Object)) {
  Object.groupBy = function (items, keyFn) {
    const out = Object.create(null)
    let i = 0
    for (const item of items) (out[keyFn(item, i++)] ??= []).push(item)
    return out
  }
}
```

Vite 不會自動加 polyfill。要支援更舊的瀏覽器，官方的做法是 `@vitejs/plugin-legacy`（8.2.4 版，搭 Vite 8）：

- 每個 chunk 多產生一份 legacy 版本，用 `@babel/preset-env` 轉換、以 SystemJS 格式輸出。
- 依目標瀏覽器與程式實際用到的功能，產生一個 polyfill chunk（core-js）。
- 在 HTML 加上 `<script nomodule>`，只有不支援 ES modules 的瀏覽器會下載 legacy 那一份；現代瀏覽器不受影響。
- `targets` 預設是 `'last 2 versions and not dead, > 0.3%, Firefox ESR'`，也會讀專案的 browserslist 設定。

它只自動偵測 JavaScript 語言層的功能；`IntersectionObserver` 這類 DOM API 要用 `additionalLegacyPolyfills` 自己指定。另一個選項 `modernPolyfills` 替現代版也加 polyfill，文件提醒自動偵測時 core-js 會放進很多不需要的東西，最好明確列出要哪幾個。

### Baseline

Baseline 是 W3C WebDX 社群小組的 web-features 計畫訂的標示，把「這個功能能不能放心用」濃縮成三種狀態：

| 狀態 | 意思 | web-features 的欄位 |
|---|---|---|
| Limited availability | 還有核心瀏覽器不支援 | `baseline: false` |
| Newly available（Baseline 年份） | Chrome、Edge、Firefox、Safari 的桌機與手機最新版都支援了 | `baseline: 'low'`、`baseline_low_date` |
| Widely available | 變成 Newly available 滿 30 個月 | `baseline: 'high'`、`baseline_high_date` |

web-features 3.46.0 的資料裡幾個前端常用的功能：

| 功能 | 狀態 | 日期 |
|---|---|---|
| `<dialog>` | Widely available | 2022-03 newly、2024-09 widely |
| Container queries | Widely available | 2023-02 newly、2025-08 widely |
| `:has()` | Widely available | 2023-12 newly、2026-06 widely |
| `Object.groupBy` | Widely available | 2024-03 newly、2026-09 widely |
| `fetchpriority` | Newly available | 2024-10 |
| Popover API | Newly available | 2025-01 |
| Iterator helpers | Newly available | 2025-03 |
| `content-visibility` | Newly available | 2025-09 |
| Scheduler API（`scheduler.yield()`） | Limited availability | Safari 還沒有 |

「Widely available」是相對於最新版而言。開頭那台 Chrome 109 是 2023 年初的版本，`Object.groupBy` 雖然已經是 Widely available，它還是沒有。Baseline 回答的是「目前多數人的瀏覽器有沒有」，有特定舊裝置要支援時，要回頭看具體版本號。

browserslist 4.29 支援用 Baseline 寫查詢：`baseline widely available`、`baseline 2024`、`baseline newly available`、`baseline widely available on 2026-01-01`。不帶日期的查詢跟著執行當天變動，2026-11-19 執行 `npx browserslist "baseline widely available"` 得到 Chrome 125、Firefox 126、Safari 17.5 起；Vite 8 則把日期固定在 2026-01-01，所以是 Chrome 111 起。

### 給 coding agent 的 Modern Web Guidance

Chrome 團隊在 npm 上發布的 `modern-web-guidance`（1.0.1，2026-11，Apache-2.0）是給 coding agent 用的 skill，收錄兩百多份現代網頁寫法的指南（dialog、`fetchpriority`、`content-visibility`、拆長任務⋯），每份最後都附上那個功能的 Baseline 狀態、支援的瀏覽器版本與退路。它的規則是：Baseline Widely available 的功能直接用，其他的照指南寫的退路做，除非專案自己寫明了支援範圍；它也建議把支援政策寫進 `AGENTS.md` 這類給 AI 的規範檔。

指南推薦的寫法不一定是 Baseline。例如它建議送分析資料用 `fetchLater()`，同一份指南寫明這個 API 是 Limited availability（Chrome、Edge 135 起），要搭配退路。讓 AI 照指南寫之後，用到的每個新功能仍要對照 web-features 或 MDN 的 Baseline 標示，確認落在自己的支援範圍內。

### 讀 Can I use 與 MDN

- **MDN**：功能頁上方的 Baseline 標示（例如「Baseline Widely available」或「Limited availability」），頁尾的 Browser compatibility 表列出每個瀏覽器從哪一版開始支援、有哪些注意事項。表的資料來自 @mdn/browser-compat-data。
- **Can I use**：一個功能一張表，橫軸是瀏覽器、縱向是版本。格子的狀態對應它的資料代碼：支援（y）、不支援（n）、部分支援（a）、要加前綴（x）、預設停用要手動開啟（d）、未知（u）；格子上的編號對到下方的 Notes。部分支援一定要讀 Notes，常見的是「只支援某些值」或「行為有 bug」。上方的使用比例是全球估計值，院內系統要看自己的使用者統計。

## 實際程式

### 依支援範圍設定 Vite

```js
// vite.config.js（Vite 8）
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: {
    // 院內櫃台有 Chrome 109；病患手機最舊到 Safari 16.4
    target: ['chrome109', 'edge109', 'firefox115', 'safari16.4'],
  },
})
```

target 只處理語法。Chrome 109 沒有的 API 有兩個選擇：改寫，或補 polyfill。數量少時改寫最直接：

```js
// 不用 Object.groupBy：Chrome 109 沒有
const byRoom = appts.reduce((acc, a) => {
  ;(acc[a.room] ??= []).push(a)   // ??= 是語法，target 比 Chrome 85 舊時會被改寫
  return acc
}, {})

// 不用 toSorted：Chrome 109 沒有；先複製再排序，不改到原陣列
const sorted = [...names].sort((a, b) => a.localeCompare(b, 'zh-TW'))
```

### 功能偵測與 CSS 退路

```js
// Web API：有就用，沒有就退回 setTimeout
function yieldToMain() {
  if (globalThis.scheduler?.yield) return scheduler.yield()
  return new Promise((resolve) => setTimeout(resolve, 0))
}
```

```css
/* 先寫所有瀏覽器都能用的版本 */
.slot-card { border: 1px solid #ccc; }

/* 支援 :has() 的瀏覽器才加：選了時段的卡片加粗框 */
@supports selector(:has(a)) {
  .slot-card:has(input:checked) { border-width: 3px; }
}
```

### 把支援範圍寫進規格

```
支援範圍（2026-11 核對）
- 院內電腦：Chrome 109 以上（Windows 7 的櫃台 3 台，預計 2027-06 汰換）
- 病患手機：iOS Safari 16.4 以上、Android Chrome 最新兩版
- 依據：近 90 天的存取紀錄
- 不在範圍內的瀏覽器：畫面頂端顯示「請更新瀏覽器」，不保證功能
- 驗收：每次發版在 Chrome 109 與 iOS 16.4 的實機各走一次掛號流程
```

## 常見錯誤與錯誤訊息

| 現象或訊息 | 原因 | 修法 |
|---|---|---|
| `TypeError: Object.groupBy is not a function`（只在部分電腦） | 新 API 不受 `build.target` 影響 | 改寫，或加 polyfill；在 `dist/` 搜尋這些函式名稱 |
| `SyntaxError: Unexpected token '?'`，整頁空白 | 語法沒有被改寫：target 太新，或某段程式沒有經過 Vite 轉換（例如直接放在 `public/` 的 JS） | 調整 `build.target`；`public/` 的檔案不會被處理，要自己確認語法 |
| `Top-level await is not available in the configured target environment` | Vite 6 的預設目標不支援 top-level await | 改寫成非同步函式，或提高 target |
| CSS 在某台電腦上沒效果，Console 沒有錯 | 瀏覽器不認得的屬性或選擇器被忽略；選擇器清單裡有一個不認得，整條規則失效 | Elements 的 Styles 看那條規則是否被劃掉；用 `@supports` 分開寫 |
| 升級 Vite 後舊裝置開始壞 | Vite 主版本提高了預設 target | 明確寫出 `build.target`，不依賴預設值 |
| Performance 的 Insights 出現 `Legacy JavaScript` | target 設得太舊或加了不需要的 polyfill，現代瀏覽器也要下載 | 依實際的支援範圍調整 target 與 polyfill |
| 裝置模擬下都正常，實機壞掉 | DevTools 的裝置模擬只改尺寸與 User-Agent，引擎還是你電腦上的 Chrome | 在目標版本的瀏覽器或實機上測 |

## 動手

1. 在自己的專案跑 `npm run build`，在 `dist/assets` 搜尋 `groupBy(`、`toSorted(`、`structuredClone(`、`findLast(`，對每一個查 MDN 的 Baseline 標示與最低版本。
2. 把 `build.target` 改成 `es2019` 再建置一次，比較產物裡的 `?.` 與 `??` 變成什麼。
3. 在 Can I use 查 `:has()` 與 container queries，讀完 Notes，寫下要支援的最舊瀏覽器能不能用。
4. 執行 `npx browserslist "baseline widely available"` 與 `npx browserslist "baseline 2024"`，比較兩者列出的最低版本，對照 Vite 8 預設的 Chrome 111。
5. 為自己的系統寫一段「支援範圍」：瀏覽器、最低版本、依據、不支援時的畫面、驗收方式，放進專案給 AI 的規範檔，讓產生的程式照它決定要不要寫退路。

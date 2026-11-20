## 從一個具體問題開始：加暗色主題，要改 214 個地方

門診系統要加暗色主題，給夜間值班的護理站用。工程師先在專案裡搜尋色碼：`#` 開頭的 hex 出現 214 次，散在 63 個元件裡；同一個「主色藍」有 `#1d4ed8`、`#1e40af`、`#2563eb` 三種寫法，因為不同的人在不同時間從設計稿吸色。間距也一樣：`margin` 有 12、13、14、15、16px，13 和 15 從哪裡來沒有人知道。

改到一半又發現三個問題：

- 表單的輸入框、捲軸、日期選擇器在暗色背景上還是亮白色。
- 亮色主題裡看得清楚的灰色說明文字，放在暗色背景上幾乎看不見。
- 下拉選單用了元件庫，元件庫有自己的一套顏色變數，和專案的顏色對不起來。

如果一開始就把顏色、間距、字級寫成有名字的 token，元件只引用名字，加暗色主題就是替同一組名字換一組值。

## 運作原理

### 三層 token

```text
基礎 token（primitive）     語意 token（semantic）        元件 token（component，選用）
--blue-600: #1d4ed8   ←──  --color-primary          ←──  --button-bg
--blue-300: #93c5fd        --color-focus                 --input-border
--red-600:  #dc2626   ←──  --color-danger
--gray-900: #111827   ←──  --color-text
--gray-500: #6b7280   ←──  --color-text-muted
--space-4:  16px      ←──  （間距通常直接用刻度）
```

- **基礎 token**：色票與刻度，名字描述值本身（藍色第 600 階、間距第 4 階）。只在 token 檔裡被引用。
- **語意 token**：名字描述用途（主色、危險、文字、邊框、焦點外框）。元件只用這一層。換主題、換品牌色時改的是這一層指向哪個基礎值。
- **元件 token**：某個元件專用的一層，值指向語意 token。只有在某個元件要和全站設定不同、或要開放給使用元件的人調整時才需要，小專案通常不用。

名字用用途而不用外觀：`--color-danger` 而不是 `--color-red`。哪天危險色從紅改成深橘，名字仍然正確。

### 刻度

| 類別 | 刻度範例 | 用在 |
|---|---|---|
| 間距 | 4、8、12、16、24、32、48px（`--space-1` 到 `--space-7`） | margin、padding、gap |
| 字級 | 12、14、16、20、24、32px | 文字 |
| 圓角 | 4、8px、全圓 | 按鈕、卡片、Badge |
| 陰影 | 2 到 3 階 | 卡片、浮層 |
| 動畫時間 | 150、250ms | transition |

刻度的值多少是設計決定，沒有標準答案。重要的是值的數量少、命名一致；設計稿出現 13px，要嘛是設計稿的誤差，要嘛刻度少了一階，兩種都要和設計師確認。

### CSS custom properties

瀏覽器原生的變數（Baseline 2017），token 在網頁上最直接的寫法：

- 宣告：`--color-primary: #1d4ed8;`，使用：`color: var(--color-primary);`。
- 會繼承：在 `:root` 宣告，整頁都讀得到；在某個容器裡重新宣告，只影響那個容器底下的元素。
- 執行時可以改：改 `<html>` 上的屬性或 class，所有引用它的地方立刻重新計算。這是主題切換的基礎。
- `var(--x, 預設值)` 的第二個參數是變數不存在時的備用值。
- 值寫錯（例如顏色變數放了 `16px`）不會報錯，使用它的屬性會變成無效值、退回繼承值或初始值，畫面靜靜地錯。用 `@property` 註冊型別可以讓瀏覽器檢查（Baseline 2024）。值是 `light-dark()` 的顏色 token 不要註冊成 `<color>`：註冊後繼承下去的是已經算好的單一顏色，子元素改了 `color-scheme` 也不會跟著換。

### 亮暗主題

```css
:root {
  color-scheme: light;
  --color-bg: var(--gray-50);
  --color-text: var(--gray-900);
  --color-text-muted: var(--gray-600);
}
/* 沒有手動選擇：跟隨系統 */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --color-bg: var(--gray-950);
    --color-text: var(--gray-50);
    --color-text-muted: var(--gray-400);
  }
}
/* 手動選了暗色 */
:root[data-theme="dark"] {
  color-scheme: dark;
  --color-bg: var(--gray-950);
  --color-text: var(--gray-50);
  --color-text-muted: var(--gray-400);
}
```

- `prefers-color-scheme` 讀作業系統的設定（Baseline 2020）。
- `data-theme` 是使用者在網站上手動選的，優先於系統設定；選擇存在 localStorage，頁面載入時在 `<head>` 裡的一小段 script 先設好，避免先閃一下亮色。
- `color-scheme`（Baseline 2022）告訴瀏覽器這一頁是亮或暗，表單元件、捲軸、`<input type="date">` 的日曆這些瀏覽器畫的東西才會跟著變暗。開頭提到的「輸入框還是白色」就是少了這行。
- `light-dark(亮色值, 暗色值)` 函式依 `color-scheme` 選值，可以把一組 token 寫在一行，例如 `--color-bg: light-dark(#f9fafb, #030712)`。它在 2024 年 5 月進入 Baseline，依 2026-11 的 web-features 資料已列為廣泛可用（2026 年 11 月起）；不支援的舊瀏覽器裡，用到這個 token 的屬性會變成無效值、退回繼承值或初始值；要顧到舊瀏覽器就保留上面 `prefers-color-scheme` 加 `[data-theme]` 的寫法當退路。

暗色主題不是把顏色反轉。暗色背景上的主色通常要調亮一階，陰影的效果變弱，常改用邊框或較亮的表面色表示層次；每一組文字與背景的對比都要重新檢查。

### 對比

| 對象 | 最低對比 | WCAG |
|---|---|---|
| 一般文字 | 4.5:1 | 1.4.3 Contrast (Minimum)，AA |
| 大字（約 24px，或 18.66px 粗體） | 3:1 | 1.4.3 |
| 元件邊界、焦點外框、圖示 | 3:1 | 1.4.11 Non-text Contrast，AA |

對比是兩個顏色的相對亮度比，WCAG 有公式。下面這段照公式計算，可以直接改色碼試：

```js run
// WCAG 2.x 的相對亮度與對比（輸入 #rrggbb）
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const pairs = [
  ['亮色：說明文字 gray-600 / 背景 gray-50', '#4b5563', '#f9fafb'],
  ['暗色：沿用 gray-600 / 背景 gray-950', '#4b5563', '#030712'],
  ['暗色：改用 gray-400 / 背景 gray-950', '#9ca3af', '#030712'],
  ['亮色：焦點外框 blue-600 / 背景 white', '#1d4ed8', '#ffffff'],
]
for (const [label, fg, bg] of pairs) {
  const r = contrast(fg, bg)
  const verdict = r >= 4.5 ? '文字 AA 通過' : r >= 3 ? '只夠大字與元件（3:1）' : '不通過'
  console.log(`${label}：${r.toFixed(2)}:1，${verdict}`)
}
```

第二行就是開頭的問題：亮色主題的灰色說明文字直接搬到暗色背景，對比掉到 3:1 以下。

:::stop 讀到這裡可以先停：會把 token 分成基礎與語意兩層、用 custom properties 做亮暗主題，並算出每組文字與背景的對比。後面的 token 檔格式與元件庫選型，在設計稿和程式要共用 token 或要挑元件庫時再回來讀。

### token 檔與轉換工具

只有網頁時，token 寫成 CSS 就夠了。設計稿、網頁、App 要共用同一組 token 時，通常用一份中立的檔案描述，再轉成各平台的格式。

W3C 底下的 Design Tokens Community Group 在 2025 年 10 月發布了格式規格的第一個穩定版（Design Tokens Format Module 2025.10）。它是社群小組的報告，不是 W3C 的正式標準。格式重點：

- 檔案是 JSON，建議副檔名 `.tokens` 或 `.tokens.json`。
- 有 `$value` 的物件就是一個 token，`$type` 標類型（`color`、`dimension`、`fontFamily`、`duration`…），`$description` 是說明。
- 用 `{群組.名稱}` 引用另一個 token，做出語意 token 指向基礎 token 的關係。
- `dimension` 的值是物件：`{ "value": 16, "unit": "px" }`，單位只有 `px` 與 `rem`；2025.10 版的顏色值也是物件，寫出色彩空間與分量。

```json
{
  "blue": {
    "600": {
      "$type": "color",
      "$value": { "colorSpace": "srgb", "components": [0.114, 0.306, 0.847], "hex": "#1d4ed8" }
    }
  },
  "color": {
    "primary": { "$type": "color", "$value": "{blue.600}", "$description": "主要按鈕、連結、選取狀態" }
  },
  "space": {
    "4": { "$type": "dimension", "$value": { "value": 16, "unit": "px" } }
  }
}
```

Style Dictionary（2026-11 是 5.x 版）這類工具讀這份檔案，輸出 CSS custom properties、JavaScript 常數或 App 用的格式。Tailwind CSS v4 把主題寫在 CSS 的 `@theme` 裡，值也是 CSS custom properties（4.3.5 版的預設主題檔就是一長串 `--color-*`、`--spacing` 變數）。

### 元件庫、headless 元件、自己做

| 做法 | 例子（Vue） | 給你什麼 | 你要做什麼 |
|---|---|---|---|
| 元件庫 | Element Plus、Vuetify、PrimeVue、Naive UI | 外觀、行為、鍵盤、ARIA | 把它的變數對應到專案的 token；外觀調整受它的設計限制 |
| headless 元件 | Reka UI（前身是 Radix Vue）、Headless UI | 行為、焦點、鍵盤、ARIA | 外觀全部自己用 token 寫 |
| 自己做 | | 完全自由 | 狀態、鍵盤、ARIA、各瀏覽器差異全部自己處理 |

選型看兩件事：設計稿和元件庫的預設外觀差多少，以及團隊有沒有人力維護鍵盤與無障礙。外觀要完全照設計稿、又要照 WAI-ARIA APG 的鍵盤行為時，headless 元件通常最划算。用元件庫時，先找它的主題變數（例如 Element Plus 用 `--el-color-primary` 這類 CSS 變數），讓它指向專案的語意 token，不要在元件上逐一覆寫樣式。

## 實際程式

`tokens/primitives.css` 與 `tokens/semantic.css` 的寫法見上面「亮暗主題」一節。主題切換的 composable：

```js
// useTheme.js：'light' | 'dark' | 'system'，選擇存在 localStorage
import { ref, watchEffect } from 'vue'

const KEY = 'theme'
const theme = ref(readSaved())

function readSaved() {
  try { return localStorage.getItem(KEY) || 'system' } catch { return 'system' }
}

watchEffect(() => {
  const root = document.documentElement
  if (theme.value === 'system') root.removeAttribute('data-theme')   // 交給 prefers-color-scheme
  else root.setAttribute('data-theme', theme.value)
  try { localStorage.setItem(KEY, theme.value) } catch { /* 私密模式可能寫不進去，不影響畫面 */ }
})

export function useTheme() {
  return { theme, setTheme: (t) => { theme.value = t } }
}
```

```html
<!-- index.html 的 <head>：在 CSS 套用前就設好主題，避免先閃一下亮色 -->
<script>
  try {
    const t = localStorage.getItem('theme')
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t)
  } catch {}
</script>
```

元件裡只用語意 token：

```vue
<style scoped>
.card {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-4);
}
.card .meta { color: var(--color-text-muted); font-size: var(--font-size-sm); }
.card:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
</style>
```

## 常見錯誤

- **元件直接用基礎 token**：`.btn { background: var(--blue-600) }`，切到暗色主題時按鈕不變色，因為暗色主題只覆寫了語意 token。
- **寫死的色碼**：AI 產生的元件很常直接寫 `#3b82f6`、`text-gray-500` 這類值。用正規表示式 `#[0-9a-fA-F]{3,8}\b` 搜尋，只能出現在基礎 token 檔。
- **少了 `color-scheme`**：暗色主題下輸入框、捲軸、日期選擇器仍是亮色。
- **暗色主題沿用灰字**：亮色主題下通過 4.5:1 的灰色，到暗色背景就不夠。兩個主題分別設定 `--color-text-muted`。
- **主題閃爍**：主題選擇在 Vue 掛載後才套用，頁面先顯示亮色再變暗。在 `<head>` 裡先設好 `data-theme`。
- **變數名稱描述外觀**：`--color-blue` 用來當主色，換品牌色後名字就錯了。
- **元件庫與專案各一套顏色**：元件庫的下拉選單用它自己的藍，頁面其他地方用專案的藍。把元件庫的主題變數指向專案的語意 token。
- **變數寫錯沒有錯誤**：`var(--color-primay)` 拼錯，屬性變成無效值，畫面上只是少了顏色。Elements 分頁的 Computed 窗格看屬性最後算出的值，和預期不同時回 Styles 窗格找那個 `var()` 的名字。

## 動手

1. 跑上面的對比程式，把第二組的文字色改成 `#9ca3af`、`#d1d5db`，看哪個值開始通過 4.5:1。
2. 在自己的專案搜尋 hex 色碼，統計出現幾次、幾種不同的值，把重複的整理成基礎 token。
3. 列出畫面上所有「用途」：背景、表面、文字、次要文字、主色、危險、邊框、焦點外框，各寫成一個語意 token。
4. 用 Rendering 分頁的 `Emulate CSS media feature prefers-color-scheme` 切到暗色，逐頁找還是亮色的區塊；每個都是一個寫死的值。
5. 這個站本身就是用 token 寫的：在 Elements 分頁選取任何一張卡片，Styles 窗格可以看到 `var(--surface-1)`、`var(--line)` 這類變數，切換站上的亮暗主題，看哪些變數的值跟著變。按鈕與輸入框各狀態用到哪些 token，在 [互動狀態實驗室](#/lab/UiStatesLab) 對照。

## 從一個具體問題開始：狀態徽章在 build 之後沒有顏色

門診系統的「我的掛號」改用 Tailwind CSS 4。掛號狀態徽章是 AI 產生的元件：

```vue
<script setup>
const props = defineProps({ status: String })
const color = { booked: 'blue', 'checked-in': 'green', missed: 'amber' }
</script>

<template>
  <span :class="`rounded-full px-2 py-1 text-sm bg-${color[props.status]}-100 text-${color[props.status]}-800`">
    {{ props.status }}
  </span>
</template>
```

開發時偶爾看得到顏色，`npm run build` 部署之後三種狀態都是白底黑字，Console 沒有錯誤。另外兩個問題同一週出現：

- 按鈕元件預設 `px-4`，呼叫端傳 `class="px-2"` 想縮小，結果有時有效、有時沒效。
- 有人在按鈕的 `<style scoped>` 寫了 `.btn { background: var(--color-primary) }`，之後在模板加的 `bg-danger` 怎樣都蓋不過去。

三個問題都來自 Tailwind 的運作方式：它在建置時把原始碼當文字掃描、只產生完整出現的 class；產生的 CSS 放在 `@layer` 裡；同一屬性的兩個 class 誰勝出，看的是 CSS 的順序。開發時偶爾看得到顏色，是因為專案別處剛好有人寫了完整的 `bg-blue-100`。

各種 CSS 組織方式的比較見 [CSS 的組織方式](#/skill/css-architecture)，這課講 Tailwind 的實際寫法與驗收。

## 運作原理

### 安裝（v4）

2026 年 11 月 npm 上的版本是 `tailwindcss` 4.3.5、`@tailwindcss/vite` 4.3.5；外掛的 peer dependency 是 Vite 5.2 以上到 8。

```bash
npm install -D tailwindcss@4.3.5 @tailwindcss/vite@4.3.5
```

```js
// vite.config.js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
})
```

```css
/* src/styles/main.css：在 main.js 裡 import 這個檔 */
@import "tailwindcss";
```

v4 和 v3 最大的不同是設定的位置：

| 項目 | v3 | v4 |
|---|---|---|
| 入口 | `@tailwind base; @tailwind components; @tailwind utilities;` | `@import "tailwindcss";` |
| 主題 | `tailwind.config.js` 的 `theme.extend` | CSS 的 `@theme { --color-clinic: … }` |
| 掃描範圍 | `content: ['./src/**/*.vue']` | 自動偵測（略過 `.gitignore` 裡的檔案），`@source` 補充 |
| PostCSS | `tailwindcss` 本身是外掛 | 另一個套件 `@tailwindcss/postcss` |
| 自訂變體 | `plugins` | `@custom-variant` |

在 v4.3.5 實測：CSS 入口只寫 v3 的 `@tailwind base; @tailwind utilities;`，CLI 沒有任何錯誤，輸出只有一行版權註解，所有 class 都沒有樣式。

### 讀一個 class

每個 class 拆成「變體（條件）＋工具（一個屬性）」，從左到右讀：

```text
md:hover:bg-clinic/50
│  │     │        └─ 透明度 50%
│  │     └─ 工具：background-color: var(--color-clinic)
│  └─ 變體：:hover（包在 @media (hover: hover) 裡）
└─ 變體：@media (width >= 48rem)
```

v4.3.5 實際產生的 CSS（節錄）：

| class | 產生的 CSS |
|---|---|
| `p-4` | `padding: calc(var(--spacing) * 4)`，`--spacing` 預設 `0.25rem` |
| `px-2` | `padding-inline: calc(var(--spacing) * 2)` |
| `sm:flex` | `@media (width >= 40rem) { display: flex }` |
| `md:grid-cols-2` | `@media (width >= 48rem) { grid-template-columns: repeat(2, minmax(0, 1fr)) }` |
| `max-md:hidden` | `@media (width < 48rem) { display: none }` |
| `hover:bg-clinic` | `@media (hover: hover) { .hover\:bg-clinic:hover { … } }` |
| `focus-visible:outline-2` | `:focus-visible { outline-width: 2px }` |
| `disabled:opacity-50` | `:disabled { opacity: 50% }` |
| `aria-expanded:rotate-180` | `[aria-expanded="true"] { rotate: 180deg }` |
| `aria-[sort=ascending]:underline` | `[aria-sort="ascending"]` |
| `data-active:font-bold` | `[data-active]`（屬性存在就成立） |
| `data-[state=open]:block` | `[data-state="open"]` |
| `dark:bg-gray-900` | 預設 `@media (prefers-color-scheme: dark)` |
| `motion-reduce:transition-none` | `@media (prefers-reduced-motion: reduce)` |
| `@container` 與 `@md:flex` | `container-type: inline-size` 與 `@container (width >= 28rem)` |
| `w-[37px]` | 任意值：`width: 37px` |
| `bg-red-500!` | `background-color: … !important`（v4 的 `!` 寫在最後，舊的前綴寫法 `!bg-red-500` 也還能用） |

斷點全部是 `min-width`：沒有前綴的 class 是最窄的版本，`sm:`（640px）、`md:`（768px）、`lg:`（1024px）、`xl:`（1280px）往寬的方向加（換算以預設字級 16px 計）。`sm:hidden` 的意思是「640px 以上隱藏」，要在手機隱藏寫 `max-sm:hidden`，或預設 `hidden` 再加 `sm:block`。mobile-first 的概念見 [RWD 與斷點](#/skill/rwd)。

### `@theme`：token 變成 class

```css
@import "tailwindcss";

@theme {
  --color-clinic: oklch(0.55 0.15 250);   /* bg-clinic、text-clinic、border-clinic、ring-clinic… */
  --color-danger: oklch(0.58 0.2 27);
  --radius-card: 12px;                    /* rounded-card */
  --spacing-header: 56px;                 /* h-header、pt-header… */
  --breakpoint-3xl: 120rem;               /* 3xl: 變體 */
}
```

變數的命名空間決定產生哪類 class：`--color-*` 給所有顏色工具，`--radius-*` 給 `rounded-*`，`--breakpoint-*` 給斷點變體。這些變數同時出現在 `:root`，一般的 CSS 也能用 `var(--color-clinic)`。v4.3.5 預設只輸出有用到的主題變數。

`--color-clinic` 只定義了一個值，`bg-clinic-500` 不存在，建置不會報錯、CSS 裡也沒有它。要一整組色階就定義 `--color-clinic-50` 到 `--color-clinic-900`。

專案已經有 design token 時，`@theme` 的值指向既有的 token 或把 token 檔改寫成 `@theme`，同一個值只維護一份（見 [design token 與主題](#/skill/design-tokens)）。

### 掃描：只認完整的字串

Tailwind 不執行程式，也不懂 Vue 的模板語法。它讀每個檔案的文字，切出所有「長得像 class」的片段，再看哪些是合法的 class。開頭的徽章元件裡，原始碼出現的片段是 `bg-`、`-100`、`text-`、`-800`、`blue`、`green`，沒有一個是完整的 `bg-blue-100`，所以 CSS 裡沒有它。

下面這段在 Worker 裡用簡化的規則模擬這件事：

```js run
// 簡化的掃描：把原始碼切成「可能是 class」的片段，再和需要的 class 比對
const source = `
const color = { booked: 'blue', 'checked-in': 'green', missed: 'amber' }
const cls = \`bg-\${color[status]}-100 text-\${color[status]}-800\`
const fixed = { booked: 'bg-blue-100 text-blue-800', missed: 'bg-amber-100 text-amber-800' }
`
const candidates = new Set(source.split(/[^a-zA-Z0-9_\-:\/\[\]\.!%#()]+/).filter(Boolean))
const needed = ['bg-blue-100', 'text-blue-800', 'bg-green-100', 'text-green-800', 'bg-amber-100', 'text-amber-800']
for (const c of needed) console.log(c.padEnd(16), candidates.has(c) ? '會產生' : '不會產生')
// bg-green-100 與 text-green-800 只出現在「組出來的字串」裡，不會產生
```

三種修法：

```js
// 1. 完整字串的對照表（最常用）
const statusClass = {
  booked: 'bg-blue-100 text-blue-800',
  'checked-in': 'bg-green-100 text-green-800',
  missed: 'bg-amber-100 text-amber-800',
}
```

```css
/* 2. 值在原始碼以外（後端、CMS）決定時，在 CSS 列出可能的 class，大括號會展開 */
@source inline("bg-{blue,green,amber}-100");
@source inline("text-{blue,green,amber}-800");
```

```vue
<!-- 3. 值是任意的顏色時，不用 class，用 CSS 變數 -->
<span class="bg-(--badge-bg)" :style="{ '--badge-bg': department.color }">…</span>
```

`bg-(--badge-bg)` 是 v4 的寫法，產生 `background-color: var(--badge-bg)`。

### 層：誰蓋過誰

Tailwind 產出的 CSS 開頭是：

```css
@layer theme, base, components, utilities;
```

工具類別都在 `utilities` 層。層的規則（見 [CSS 怎麼決定套用哪一條](#/skill/css-cascade)）：一般宣告之間，排在後面的層勝出，**沒放進任何層的樣式勝過所有層**，和選擇器權重無關。所以：

| 寫法 | 放在哪裡 | 和工具類別衝突時 |
|---|---|---|
| Vue 的 `<style scoped>` | 沒有層 | scoped 勝出 |
| 自己寫的 `.btn { @apply px-4 }`，外面沒包 `@layer` | 沒有層 | `.btn` 勝出，`px-2` 蓋不過 |
| `@layer components { .btn { … } }` | `components` | 工具類別勝出 |
| 元件庫的 CSS 用 `@import "x.css" layer(components)` 匯入 | `components` | 工具類別勝出 |

v4.3.5 實測：`.btn { @apply rounded-md px-4 py-2; }` 寫在 `@layer` 外面時，產出的 `.btn` 放在所有層之後，不屬於任何層。

下面這段在 Playground 跑的是真的 Tailwind CSS 4.3.5：程式碼裡有 `<style type="text/tailwindcss">` 時，沙箱載入 `@tailwindcss/browser`，它在瀏覽器裡掃 DOM 的 class、編譯這段 CSS，產生的樣式和建置時一樣放在 `@layer utilities`。它是非同步產生的，所以讀樣式的程式等 300 毫秒再讀：

```html run
<style type="text/tailwindcss">
  @theme {
    --color-danger: rgb(220 38 38);
  }
  /* 像 scoped CSS 一樣沒有層 */
  .btn-unlayered { background-color: rgb(37 99 235); padding-inline: 1rem; }
  /* 放進 components 層 */
  @layer components {
    .btn-layered { background-color: rgb(37 99 235); padding-inline: 1rem; }
  }
</style>
<button class="btn-unlayered bg-danger px-2 py-2 m-1 text-white" id="a">沒有層</button>
<button class="btn-layered bg-danger px-2 py-2 m-1 text-white" id="b">components 層</button>
<script>
  setTimeout(() => {
    for (const id of ['a', 'b']) {
      const s = getComputedStyle(document.getElementById(id))
      console.log(id, s.backgroundColor, s.paddingLeft)
    }
    // a：rgb(37, 99, 235) 16px，工具類別被蓋過；b：rgb(220, 38, 38) 8px，工具類別勝出
  }, 300)
</script>
```

`@tailwindcss/browser` 是給原型與 Playground 用的：它在瀏覽器裡掃的是執行當下 DOM 上的 class，所以用字串組出來的 class 在這裡也會產生，用 `@tailwindcss/vite` 建置時不會。正式專案不要依賴這個差異。

### 兩個同類的 class：看 CSS 的順序

元素上同時有 `px-4` 與 `px-2` 時，兩條規則在同一層、權重一樣，勝出的是 **CSS 檔裡排在後面的那條**。Tailwind 依自己的規則排序產出的 CSS，class 屬性裡誰寫在後面不影響結果。v4.3.5 實測 `bg-green-500` 排在 `bg-red-500` 前面，所以 `class="bg-red-500 bg-green-500"` 顯示紅色。

Vue 的 class 透傳只是把字串接起來：根元素寫 `class="px-4"`，呼叫端傳 `class="px-2"`，結果是 `class="px-4 px-2"`，兩條都在。要「後面的取代前面的」，就要在合併時把衝突的 class 拿掉，這是 `tailwind-merge` 做的事。慣用的寫法叫 `cn()`：

```js
// src/lib/cn.js（clsx 2.1.1、tailwind-merge 3.7.0；tailwind-merge 3.x 對應 Tailwind v4）
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
export const cn = (...inputs) => twMerge(clsx(inputs))

cn('px-4 py-2 bg-white', 'bg-blue-600')          // 'px-4 py-2 bg-blue-600'
cn('bg-white hover:bg-gray-50', 'hover:bg-blue-50') // 'bg-white hover:bg-blue-50'（變體分開算）
cn('text-sm text-gray-900', 'text-clinic')        // 'text-sm text-clinic'（字級和顏色不衝突）
cn('p-4', 'px-2')                                  // 'p-4 px-2'（px 只蓋掉 p 的左右）
cn('px-2', 'p-4')                                  // 'p-4'（p 蓋掉前面的 px）
cn('rounded-md', false, { 'opacity-50': true })    // 'rounded-md opacity-50'
```

這些結果是在 Node 用上面兩個版本實際跑出來的。`tailwind-merge` 預設認得 Tailwind 的預設主題；自訂了 `@theme` 的字級或間距名稱（例如 `text-caption`）時，它可能把字級誤判成顏色，要用 `extendTailwindMerge` 告訴它。

## 實際程式

### 狀態徽章（完整字串的對照表）

```vue
<!-- StatusBadge.vue -->
<script setup>
const props = defineProps({ status: { type: String, required: true } })

// 每個 class 都完整寫出來，Tailwind 掃描得到
const STATUS = {
  booked: { label: '已預約', cls: 'bg-blue-100 text-blue-800' },
  'checked-in': { label: '已報到', cls: 'bg-green-100 text-green-800' },
  missed: { label: '過號', cls: 'bg-amber-100 text-amber-800' },
}
const FALLBACK = { label: '未知', cls: 'bg-gray-100 text-gray-700' }
</script>

<template>
  <span
    class="inline-flex items-center rounded-full px-2 py-0.5 text-sm font-medium"
    :class="(STATUS[props.status] || FALLBACK).cls"
  >
    {{ (STATUS[props.status] || FALLBACK).label }}
  </span>
</template>
```

### 按鈕：狀態變體與 `cn()`

```vue
<!-- AppButton.vue -->
<script setup>
import { computed, useAttrs } from 'vue'
import { cn } from '@/lib/cn'

defineOptions({ inheritAttrs: false })   // class 不自動透傳，自己用 cn() 合併
const props = defineProps({ variant: { type: String, default: 'primary' }, loading: Boolean, disabled: Boolean })
const attrs = useAttrs()

const VARIANT = {
  primary: 'bg-clinic text-white hover:bg-clinic/90',
  danger: 'bg-danger text-white hover:bg-danger/90',
  ghost: 'bg-transparent text-clinic hover:bg-clinic/10',
}
const cls = computed(() => cn(
  'inline-flex h-11 items-center justify-center gap-2 rounded-card px-4 font-medium',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clinic',
  'disabled:cursor-not-allowed disabled:opacity-50',
  'aria-busy:cursor-progress',
  VARIANT[props.variant],
  attrs.class,                    // 呼叫端的 class 放最後，衝突時由它取代
))
</script>

<template>
  <button v-bind="{ ...attrs, class: undefined }" :class="cls" :disabled="loading || disabled" :aria-busy="loading || undefined">
    <slot />
  </button>
</template>
```

`aria-busy:` 在元素有 `aria-busy="true"` 時成立；Vue 綁定 `undefined` 時不輸出屬性。用 ARIA 屬性當樣式的條件，狀態與無障礙資訊只有一個來源。

### 下拉選單：`aria-expanded` 與 `data-state`

```vue
<button type="button" :aria-expanded="open" aria-controls="dept-menu" class="group inline-flex items-center gap-1" @click="open = !open">
  科別
  <svg class="size-4 transition-transform group-aria-expanded:rotate-180 motion-reduce:transition-none" aria-hidden="true" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" /></svg>
</button>
<ul id="dept-menu" :data-state="open ? 'open' : 'closed'" class="hidden data-[state=open]:block">…</ul>
```

`group-aria-expanded:` 讓子元素依父元素的 `aria-expanded` 變化；`group` 要寫在父元素上。

### 暗色主題用 `data-theme` 切換

```css
@import "tailwindcss";
@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));
```

這行改寫之後，`dark:` 只看 `<html data-theme="dark">`，不再看系統設定；要「沒選時跟隨系統」，就由 JavaScript 在載入時依 `matchMedia('(prefers-color-scheme: dark)')` 設定 `data-theme`。

### 和 scoped CSS 混用

Tailwind 為主的專案裡，偶爾需要寫 CSS（第三方元件的內部、`v-html` 的內容）。放進 `components` 層，工具類別才蓋得過：

```vue
<style scoped>
@reference "../styles/main.css";   /* 讓這段 CSS 認得主題與工具類別，不會重複輸出 */

@layer components {
  .article :deep(h2) { @apply mt-6 text-lg font-semibold; }
}
</style>
```

沒有 `@reference` 時，SFC 的 `<style>` 是獨立處理的，`@apply` 會失敗（訊息見下一節）。`@apply` 用多了等於回到自己取 class 名稱；同一組 class 在模板裡重複三次以上，先抽成 Vue 元件。

### 任意值的節制

`w-[37px]`、`mt-[13px]`、`bg-[#3a7bd4]` 都能產生，代價是每個都偏離刻度。規則可以寫進專案規範：只允許在 token 表沒有、而且只用一次的地方使用；出現第二次就加進 `@theme`。在專案裡搜尋 `-\[` 能列出所有任意值。

## 常見錯誤與錯誤訊息

| 現象或訊息 | 原因 | 修法 |
|---|---|---|
| 某個顏色在 build 後消失，沒有錯誤 | class 用字串組出來，原始碼裡沒有完整的字串 | 完整字串的對照表，或 `@source inline()` |
| 所有 class 都沒有樣式，沒有錯誤 | CSS 入口還是 v3 的 `@tailwind base;`，或 CSS 檔沒被 import | 改成 `@import "tailwindcss";`，確認 `main.js` 匯入了它 |
| `It looks like you're trying to use \`tailwindcss\` directly as a PostCSS plugin. The PostCSS plugin has moved to a separate package…` | v4 的 PostCSS 外掛是另一個套件 | Vite 專案改用 `@tailwindcss/vite`；一定要 PostCSS 就裝 `@tailwindcss/postcss` |
| `Cannot apply unknown utility class \`text-sm\`. Are you using CSS modules or similar and missing \`@reference\`?` | SFC 或 CSS Modules 裡的 `@apply` 不知道主題 | 在 `<style>` 開頭加 `@reference "…/main.css";` |
| `Cannot apply unknown utility class \`text-foo\`` | `@apply` 了一個不存在的 class（拼錯，或 `@theme` 沒定義） | 查 `@theme` 的命名空間與名稱 |
| `bg-clinic-500` 沒有樣式 | `@theme` 只定義了 `--color-clinic`，沒有色階 | 改用 `bg-clinic`，或補上 `--color-clinic-500` |
| 傳進元件的 `px-2` 有時有效有時沒效 | 元素上同時有 `px-4` 與 `px-2`，勝出看 CSS 的順序 | 用 `cn()` 合併 |
| 工具類別被劃掉，勝出的規則帶 `[data-v-…]` | scoped CSS 沒有層，勝過 `@layer utilities` | 把那段 CSS 放進 `@layer components`，或拿掉重複的宣告 |
| `sm:hidden` 在手機上沒隱藏 | `sm:` 是 640px 以上 | `max-sm:hidden`，或 `hidden sm:block` 反過來寫 |
| 手機上 hover 樣式不出現 | v4 的 `hover:` 只在 `@media (hover: hover)` 成立 | 觸控的回饋用 `active:` |
| `dark:` 不跟著切換按鈕變 | 預設的 `dark:` 看系統設定 | 用 `@custom-variant dark (…)` 改成看 `data-theme` |

## 動手

1. 在 Playground 執行「掃描」那段 `js run`，把 `fixed` 對照表補上 `'checked-in'`，看 green 的兩個 class 變成「會產生」。
2. 執行「層」那段 `html run`（真的 Tailwind），把 `.btn-unlayered` 那條規則包進 `@layer components { … }`，再看 Console：`a` 的顏色換成紅色。Playground 的 HTML 範例「Tailwind CSS：叫號卡片」可以接著改 `@theme` 與變體。
3. 在自己的 Tailwind 專案 `npm run build`，到 `dist/assets/*.css` 搜尋狀態對照表的每個 class，再搜尋 `-\[` 列出任意值。
4. 做本課的程式題：叫號看板（真的 Tailwind，量兩種寬度與互動狀態）、把狀態徽章的 class 改成建置時掃描得到的寫法、寫一個簡化版的 `cn()`。

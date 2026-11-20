## 從一個具體問題開始：改了掛號頁的標題，報表頁也跟著變

門診系統早期的樣式都在一個 `main.css`，三千多行。有人為了掛號頁把 `.title` 從 `1.25rem` 改成 `2rem`，部署後報表頁、公告頁的標題一起變大：三個頁面都用了 `.title`。改回來之後，他在掛號頁另外寫 `.booking .title`，權重比較高所以贏了；下一個人要改報表頁，又寫了 `.report .header .title`。

半年後的狀況：

- Coverage 分頁顯示 `main.css` 有一大半的規則在任何頁面都沒用到，但沒有人敢刪，因為不知道哪個頁面還在用。
- 專案裡有 30 幾個 `!important`，大多是為了蓋過前一個人寫的高權重選擇器。
- 新加的元件是 AI 產生的，一半用 Tailwind 的 class 清單，一半用 `<style scoped>`，同一個按鈕在兩種寫法下長得不一樣。

這些問題來自同一件事：一般 CSS 的 class 名稱全站共用一個命名空間。CSS 的組織方式就是在決定怎麼切開這個命名空間、以及樣式寫在哪裡。

## 運作原理

### 五種做法

| 做法 | 怎麼避免撞名 | 樣式寫在哪裡 | 需要的工具 | 主要代價 |
|---|---|---|---|---|
| BEM | 命名約定：`block__element--modifier` | 一般的 CSS 檔 | 不需要 | 靠紀律，名字長 |
| Vue 的 scoped CSS | 建置時替選擇器與元素加 `data-v-…` 屬性 | SFC 的 `<style scoped>` | Vue 的 SFC 編譯 | 改子元件內部要 `:deep()` |
| CSS Modules | 建置時把 class 名稱改成不重複的字串 | `*.module.css` 或 `<style module>` | Vite 內建 | 模板要寫 `$style.x`，拼錯沒有錯誤 |
| utility-first（Tailwind） | 不寫自訂 class，只用預先定義好的工具類別 | 模板的 class 清單 | Tailwind 的建置外掛 | class 清單很長，動態 class 要小心 |
| CSS-in-JS | 執行時（或建置時）在 JavaScript 裡產生 class | `.js`、`.ts` 檔 | styled-components、Emotion 等 | 執行時的成本，主要在 React 生態 |

這幾種做法可以和 design token（CSS custom properties）、`@layer` 一起用，後兩者解決的是另一個問題：值從哪裡來、規則衝突時誰勝出（見 [design token 與主題](#/skill/design-tokens) 與 [CSS 怎麼決定套用哪一條](#/skill/css-cascade)）。

### BEM：命名約定

```css
.queue-card { }                     /* block：一個獨立的元件 */
.queue-card__title { }              /* element：block 裡的一部分 */
.queue-card__badge { }
.queue-card--missed { }             /* modifier：block 的變化 */
.queue-card--missed .queue-card__title { opacity: .6; }
```

每條規則都是一層 class，權重一樣，靠出現順序與 modifier 決定誰勝出。名字以元件為前綴，兩個元件不會撞名。它不需要任何工具，舊專案、伺服器端模板也能用；缺點是只靠大家遵守，沒有工具會擋下 `.title` 這種名字。

### Vue 的 scoped CSS

```vue
<template>
  <article class="card">
    <h3 class="title">{{ name }}</h3>
  </article>
</template>

<style scoped>
.title { font-size: 1.25rem; }
</style>
```

建置後，元素帶上 `data-v-xxxxxxxx` 屬性，選擇器變成 `.title[data-v-xxxxxxxx]`，只套到這個元件裡的元素。幾個規則：

- 子元件的根元素同時帶父元件與自己的屬性，所以會吃到父元件的 scoped 樣式；子元件內部的元素不會。
- 要改子元件內部寫 `.card :deep(.badge)`；要改 slot 傳進來的內容寫 `:slotted(.x)`；要寫全域規則寫 `:global(.x)`。
- `v-html` 插進來的元素沒有這個屬性，scoped 樣式套不到。

scoped 讓 class 可以取短名字，但同一個元件裡還是要命名；很多團隊在元件內仍用元件名稱當前綴，Elements 分頁比較好認。

### CSS Modules

Vite 內建支援：檔名以 `.module.css` 結尾，匯入時得到一個物件，鍵是原本的 class 名稱、值是改寫過的名稱。Vite 8.3.8 建置的實際結果：

```js
import styles from './card.module.css'
console.log(styles)
// { card: "_card_5ktej_1", "card-title": "_card-title_5ktej_2", isMissed: "_isMissed_5ktej_3" }
```

Vue 的 SFC 可以寫 `<style module>`，模板用 `$style`，`<script setup>` 用 `useCssModule()`：

```vue
<template>
  <article :class="[$style.card, { [$style.isMissed]: missed }]">…</article>
</template>

<style module>
.card { padding: var(--space-3); }
.isMissed { opacity: .6; }
</style>
```

兩件要知道的事：

- 鍵照 CSS 原樣：`.card-title` 要寫 `styles['card-title']`；寫 `styles.cardTitle` 拿到 `undefined`，元素沒有 class，畫面沒套到樣式，沒有任何錯誤。Vite 的 `css.modules.localsConvention: 'camelCase'` 會同時產生 `cardTitle` 這個鍵。
- Vite 給 `*.module.css` 的型別是「任意鍵都回傳 `string`」，TypeScript 不會發現拼錯的名字。

### Tailwind CSS 4

Tailwind 4（2026 年 11 月是 4.3.5）在 Vite 用 `@tailwindcss/vite` 外掛，CSS 入口寫一行 `@import "tailwindcss";`。設定寫在 CSS 裡：

```css
@import "tailwindcss";

@theme {
  --color-clinic: oklch(0.6 0.15 250);   /* 產生 text-clinic、bg-clinic、border-clinic… */
}
```

建置時，Tailwind 把專案的原始碼當成純文字掃描，找出長得像 class 的字串，只產生用到的那些。實測 4.3.5：

- 模板用樣板字串把 `bg-`、`color` 與 `-500` 組起來（`color` 是 `'red'`）：`bg-red-500` 沒有出現在建置出的 CSS 裡。原始碼裡從來沒有完整的 `bg-red-500` 這個字串。
- 改成完整字串的對照表 `{ booked: 'bg-blue-100', missed: 'bg-amber-100' }`：兩個 class 都產生了。
- 要在原始碼以外決定的 class，用 `@source inline("bg-{red,green}-500");` 列出來，Tailwind 會照樣產生。
- 產出的 CSS 開頭宣告 `@layer theme, base, components, utilities;`，工具類別在最後一層，所以能蓋過 base 與元件的樣式。

在 Vue SFC 的 `<style>` 裡用 `@apply` 時，那段 CSS 是獨立處理的，不知道主題在哪裡，建置會失敗：

```text
Error: Cannot apply unknown utility class `text-sm`. Are you using CSS modules or similar and missing `@reference`?
```

在 `<style>` 開頭加 `@reference "../styles/main.css";` 指向主要的 CSS 入口。不過 `@apply` 用多了等於回到自己取名字，重複的 class 組合通常抽成一個 Vue 元件。

:::stop 讀到這裡可以先停：會說出 BEM、scoped、CSS Modules、Tailwind 各自怎麼避免撞名，以及各自的坑。後面的 CSS-in-JS、原生 CSS 的新功能與選型表，在要替專案訂樣式規範時再回來讀。

### CSS-in-JS

```jsx
// React + styled-components
const Card = styled.article`
  padding: 12px;
  opacity: ${(p) => (p.missed ? 0.6 : 1)};
`
```

樣式寫在 JavaScript 裡，可以直接讀 props；執行時由函式庫產生 class 名稱並插入 `<style>`。代價：

- 每次渲染都要計算樣式，函式庫本身也在 bundle 裡。
- 插入 `<style>` 在嚴格的 CSP（`style-src` 沒有 `'unsafe-inline'`）下需要 nonce（見 [前端的資安](#/skill/frontend-security)）。
- 依賴執行時與 React context 的版本不能用在 React Server Components。

2026 年 11 月 npm 上 styled-components 是 6.6、`@emotion/react` 是 11.14；vanilla-extract 這類「零執行時」的方案在建置時把 `.css.ts` 編譯成一般的 CSS 檔。Vue 有 scoped 與 CSS Modules，很少需要 CSS-in-JS。

### 原生 CSS 補上的部分

- **巢狀**：`.queue-card { & .title { … } &:hover { … } }` 是 Baseline 2023，2026 年 6 月起 Widely available，不需要 Sass 也能巢狀。
- **`@scope`**：`@scope (.queue-card) to (.queue-card__body) { .title { … } }` 把規則限定在某段 DOM 之內，不進入內層的區塊。Chrome 118、Firefox 146、Safari 26.4 起支援，2026 年 3 月成為 Baseline，要支援舊瀏覽器時還不能單獨依賴它。
- **`@layer`**：把 reset、元件庫、元件、工具類別放進不同的層，衝突時依層的順序決定，不必拚權重。

### 怎麼選

| 情境 | 常見選擇 |
|---|---|
| Vue 專案，沒有特別的需求 | `<style scoped>` 加 design token |
| 要在 JavaScript 裡拿到 class 名稱，或寫給別人用的元件庫 | CSS Modules |
| 設計系統的刻度很明確、團隊熟 Tailwind | Tailwind，重複的組合抽成元件 |
| React 專案已經在用 CSS-in-JS | 沿用；新專案考慮零執行時的方案或 CSS Modules |
| 舊專案的全域 CSS | 先用 `@layer legacy` 包起來，新元件用 scoped，碰到一頁搬一頁 |

一個專案選一種主要做法寫進規範（例如給 AI 的 `AGENTS.md`），新元件照做。兩種做法並存時，每個元件要查它用哪一種，修改時也常兩邊都要改。

## 實際程式

同一張候診卡片，三種寫法。

### scoped 加 token

```vue
<!-- QueueCard.vue -->
<script setup>
defineProps({ name: String, no: Number, missed: Boolean })
</script>

<template>
  <article class="queue-card" :class="{ 'is-missed': missed }">
    <span class="queue-card__no">{{ no }}</span>
    <h3 class="queue-card__name">{{ name }}</h3>
  </article>
</template>

<style scoped>
.queue-card {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.queue-card__no { font-variant-numeric: tabular-nums; color: var(--color-primary); }
.queue-card.is-missed { opacity: .6; }
</style>
```

### CSS Modules

```vue
<template>
  <article :class="[$style.card, missed && $style.isMissed]">
    <span :class="$style.no">{{ no }}</span>
    <h3 :class="$style.name">{{ name }}</h3>
  </article>
</template>

<style module>
.card { display: flex; gap: var(--space-3); padding: var(--space-3) var(--space-4); }
.no { font-variant-numeric: tabular-nums; color: var(--color-primary); }
.isMissed { opacity: .6; }
</style>
```

`missed` 是 `false` 時陣列裡多一個 `false`，Vue 的 class 綁定會略過它。

### Tailwind

```vue
<script setup>
const props = defineProps({ name: String, no: Number, status: String })

// 完整字串的對照表：Tailwind 掃描原始碼時看得到每一個 class
const statusClass = {
  waiting: 'bg-white',
  called: 'bg-blue-50 ring-2 ring-blue-500',
  missed: 'bg-amber-50 opacity-60',
}
</script>

<template>
  <article class="flex gap-3 rounded-md border px-4 py-3" :class="statusClass[props.status]">
    <span class="text-clinic tabular-nums">{{ no }}</span>
    <h3 class="text-lg font-semibold">{{ name }}</h3>
  </article>
</template>
```

### 舊專案：把全域 CSS 包進一層

```css
/* main.css：層的順序寫在最前面，後面的層勝出 */
@layer reset, legacy, vendor, components, utilities;

@import url("./reset.css") layer(reset);
@import url("./legacy/main.css") layer(legacy);       /* 三千行的舊樣式，先整包放進一層 */
@import url("element-plus/dist/index.css") layer(vendor);
```

舊樣式放進 `legacy` 之後，新元件只要放在 `components` 層，用一層 class 就能蓋過舊的高權重選擇器，不需要再加 `!important`。

## 常見錯誤與錯誤訊息

| 現象或訊息 | 原因 | 修法 |
|---|---|---|
| 改一個頁面的樣式，別的頁面也變了 | 全域 CSS 共用同一個 class 名稱 | 改成 scoped 或 CSS Modules；舊樣式至少加元件名稱當前綴 |
| scoped 的樣式套不到子元件裡的元素 | scoped 只套到自己的元素與子元件的根元素 | 用 `:deep()`，或讓子元件提供 props、CSS 變數 |
| 元素的 `class` 是空的，樣式沒套上 | CSS Modules 的鍵拼錯，例如 `$style.cardTitle` 對 `.card-title` | 用 `$style['card-title']`，或設定 `localsConvention` |
| Tailwind 的顏色在畫面上沒出現，沒有錯誤 | class 是用字串組出來的，建置時沒有產生 | 寫成完整字串的對照表，或 `@source inline()` |
| `Cannot apply unknown utility class … missing @reference?` | SFC 的 `<style>` 裡用 `@apply`，那段 CSS 不知道 Tailwind 的主題 | 加 `@reference` 指向主要的 CSS 入口，或改成元件 |
| 元件庫的樣式蓋過自己的 | 自己的規則權重較低，或元件庫沒放進層 | 用 `@layer` 把元件庫放在前面的層 |
| `!important` 越來越多 | 用提高權重解衝突，互相追加 | 規劃 `@layer` 的順序，選擇器維持一層 class |
| 同一個按鈕兩種長相 | 專案混用了兩種做法 | 規範寫明主要做法，舊的逐步搬 |

## 動手

1. 在自己的專案打開 Coverage 分頁（主選單 More tools → Coverage），重新載入首頁與兩個常用頁面，看全域 CSS 檔的未使用比例。
2. 用 Elements 分頁點三個不同元件，從選擇器判斷它們各用哪種做法（`[data-v-…]`、`_name_hash_1`、一長串工具類別、沒有範圍的全域 class）。
3. 在 Tailwind 專案裡把一個狀態顏色改成用字串組出來，`npm run build` 後到 `dist/assets/*.css` 搜尋那個 class，確認它不存在；再改回對照表。
4. 規則衝突與 `@layer` 的細節見 [CSS 怎麼決定套用哪一條](#/skill/css-cascade)，token 的命名見 [design token 與主題](#/skill/design-tokens)。

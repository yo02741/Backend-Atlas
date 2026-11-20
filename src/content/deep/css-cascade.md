## 從一個具體問題開始：過號的卡片標題變不了灰

門診看板用了一套元件庫，卡片標題的顏色寫在元件庫的 CSS 裡。需求是「過號」的卡片標題改成灰色，AI 在 `ClinicCard.vue` 加了這段：

```css
/* ui-kit.css（元件庫） */
.ui-theme .ui-card .ui-card__header .ui-card__title { color: #1f2937; }

/* ClinicCard.vue 的 <style scoped> */
.is-missed .ui-card__title { color: #9ca3af; }
```

畫面上的標題還是深色。AI 的下一步是加 `!important`，標題變灰了。兩週後要做暗色主題，`.dark .ui-card__title` 怎麼寫都蓋不過那個 `!important`，只好再加一個。

標題沒變灰，是因為元件庫的選擇器權重比較高；加 `!important` 能贏，但之後每個要改這個屬性的人都得跟著加。要用對的方式贏，得知道瀏覽器在好幾條規則之間怎麼挑。

## 運作原理：瀏覽器依序比的幾件事

### 比較的順序

同一個元素、同一個屬性有好幾條宣告時，瀏覽器依下面的順序比，前一項分出高下就不看後面：

| 順序 | 比什麼 | 勝出的一方 |
|---|---|---|
| 1 | 重要性 | 有 `!important` 的宣告勝過所有一般宣告 |
| 2 | 是不是 inline style | 寫在 `style` 屬性裡的勝過樣式表裡的規則（同樣重要性時） |
| 3 | cascade layer | 後宣告的層勝出；沒放進任何層的樣式勝過所有層；`!important` 時反過來 |
| 4 | 選擇器權重 | 權重高的勝出 |
| 5 | 出現順序 | 後寫的勝出 |

表格省略了「來源」：瀏覽器預設樣式、使用者自訂樣式與網站的樣式分屬不同來源，網站的一般宣告勝過瀏覽器預設。日常要處理的衝突都發生在網站自己的樣式之間，從第 1 項開始看就夠了。

幾個在 Chromium 實測過的組合：

- 樣式表裡的 `.title { color: red !important }` 勝過 `style="color: blue"`：重要性先比。
- 兩邊都是 `!important` 時，inline style 勝出。
- `@layer components { #app .title { … } }` 輸給沒放進層的 `.title { … }`：層先比，權重根本沒機會比。

### 選擇器權重

權重寫成三個數字 (ID, class, 元素)：

- 第一位：ID 選擇器（`#app`）的數量。
- 第二位：class（`.card`）、屬性選擇器（`[type="text"]`、`[data-v-7ba5bd90]`）、pseudo-class（`:hover`、`:focus-visible`）的數量。
- 第三位：元素選擇器（`h2`、`button`）與 pseudo-element（`::before`）的數量。

從左邊比起，不會進位：(1,0,0) 勝過 (0,15,0)。`*` 與組合符號（空白、`>`、`+`、`~`）不算。

| 選擇器 | 權重 |
|---|---|
| `.title` | (0,1,0) |
| `h2.title` | (0,1,1) |
| `.board .card .title` | (0,3,0) |
| `#app .title` | (1,1,0) |
| `.ui-theme .ui-card .ui-card__header .ui-card__title` | (0,4,0) |
| `.is-missed .ui-card__title[data-v-7ba5bd90]` | (0,3,0) |
| `:where(.card) .title` | (0,1,0) |
| `:is(#app, .card) .title` | (1,1,0) |

`:where()` 的權重固定是 0，元件庫用它寫預設樣式，使用者一個 class 就能蓋過。`:is()`、`:not()`、`:has()` 取參數裡權重最高的那一個，不管實際比對到的是哪個：`:is(#app, .card) .title` 就算元素是在 `.card` 底下，也算 (1,1,0)。

開頭的問題：元件庫的規則是 (0,4,0)，`ClinicCard.vue` 的規則經過 scoped 編譯後是 (0,3,0)，元件庫勝出。

### 出現順序

權重相同時後寫的勝出。同一個檔案裡看行數；跨檔案時看 CSS 插進頁面的順序：`<link>` 的順序、`main.js` 裡 `import` CSS 的順序。用路由懶載入的頁面，它的 CSS 在進入那個路由時才插進 `<head>`，排在已經載入的 CSS 後面。靠出現順序贏的規則，從不同的頁面進來，結果可能不一樣；要穩定，就用權重或 `@layer` 表達「誰該贏」。

:::stop 讀到這裡可以先停：會依重要性、inline、層、權重、出現順序判斷哪條規則勝出，並用 Styles 分頁的權重提示找到勝因。後面的繼承、`@layer` 與 scoped 改寫，在要覆蓋元件庫或 scoped 樣式沒套上時再回來讀。

### 繼承

沒有任何規則設定某個屬性時，有些屬性沿用父元素的值：

| 會繼承 | 不繼承 |
|---|---|
| `color`、`font-family`、`font-size`、`font-weight`、`line-height`、`text-align`、`visibility`、`cursor` | `margin`、`padding`、`border`、`background`、`width`、`height`、`display`、`position` |

所以字型與文字顏色在 `body` 設一次就好，元件裡不用重寫。例外是表單元件：瀏覽器的預設樣式直接替 `button`、`input` 設定了字型（Chromium 實測是 13.33px），它們不會繼承 `body` 的字型，reset 裡常見 `button, input, select, textarea { font: inherit; }`。

要明確指定時用這四個關鍵字：

| 關鍵字 | 結果 |
|---|---|
| `inherit` | 用父元素的值 |
| `initial` | 用規格定義的初始值（`color` 的初始值通常是黑色，不是瀏覽器預設樣式給的值） |
| `unset` | 會繼承的屬性等於 `inherit`，不繼承的等於 `initial` |
| `revert` | 回到瀏覽器預設樣式的值，例如連結的藍色 |

### `@layer`

cascade layer 把樣式分成幾層，層的順序在選擇器權重之前比：

```css
@layer reset, vendor, components, utilities;
```

這行宣告了四層的順序，越後面越強。之後寫在 `@layer vendor { … }` 裡的規則，不論權重多高，都輸給 `@layer components { … }` 裡的 `.title`。沒放進任何層的樣式勝過所有層，所以把元件庫放進前面的層，專案自己的樣式就能用普通的 class 蓋過它。

`!important` 的順序反過來：`reset` 層的 `!important` 勝過 `utilities` 層的 `!important`，而沒放進層的 `!important` 最弱。前面的層因此可以用 `!important` 保護少數不該被覆蓋的設定，後面的層蓋不掉。

cascade layers 是 Baseline 2022，2024 年起 Widely available。Tailwind CSS v4 也用這個機制：它的 CSS 開頭是 `@layer theme, base, components, utilities;`（4.3.5 版的 `index.css`）。

### Vue 的 scoped CSS

`<style scoped>` 不是瀏覽器的功能，由 Vue 的編譯器改寫選擇器。用 `@vue/compiler-sfc` 3.5.45 編譯的結果：

```css
/* 原始碼 */
.card { color: red; }
.card .title { font-weight: 700; }
.list :deep(.item) { margin: 0; }

/* 編譯後 */
.card[data-v-7ba5bd90] { color: red; }
.card .title[data-v-7ba5bd90] { font-weight: 700; }
.list[data-v-7ba5bd90] .item { margin: 0; }
```

模板裡這個元件的元素也都帶上 `data-v-7ba5bd90` 屬性，所以規則只比對得到自己的元素。幾件會影響衝突的事：

- 屬性選擇器加在選擇器的最後一段，權重多 (0,1,0)。
- 子元件的根元素同時帶父元件與自己的 `data-v-*`，所以父元件的 scoped 樣式套得到子元件的根元素，套不到子元件裡面的元素。
- 要改子元件內部的元素用 `:deep()`：`.list :deep(.item)` 把屬性選擇器移到 `:deep()` 前面那一段。
- `v-html` 產生的元素沒有 `data-v-*`，scoped 樣式套不到，要用 `:deep()` 或全域樣式。

## 實際程式碼

全域的進入點宣告層的順序，元件庫放進 `vendor` 層：

```css
/* src/styles/main.css，在 main.js 第一個 import */
@layer reset, vendor, components, utilities;

/* @import 要寫在其他規則之前；@layer 的宣告句可以在它前面 */
@import url("ui-kit/dist/ui-kit.css") layer(vendor);

@layer reset {
  *, *::before, *::after { box-sizing: border-box; }
  button, input, select, textarea { font: inherit; }
}

body {
  /* 字型、顏色、行高只在這裡設定，元件靠繼承 */
  font-family: system-ui, sans-serif;
  color: #1f2937;
  line-height: 1.6;
}
```

Vite 6 建置時把 `@import … layer(vendor)` 內嵌成 `@layer vendor { … }`（以 6.4.3 實測）。建置後打開 `dist/assets/` 裡的 CSS，確認元件庫的規則包在 `@layer vendor{…}` 裡。

元件裡的規則放進 `components` 層：

```vue
<template>
  <article class="card" :class="{ 'is-missed': missed }">
    <UiCardTitle>{{ room }} · {{ doctor }}</UiCardTitle>
    <StatusBadge :status="status" />
  </article>
</template>

<style scoped>
@layer components {
  /* 元件庫在 vendor 層，這裡一個 class 就蓋得過，不用 !important */
  .is-missed :deep(.ui-card__title) { color: #9ca3af; }

  /* 子元件 StatusBadge 裡的 .dot 不帶這個元件的 data-v-*，要用 :deep() */
  .card :deep(.dot) { width: 8px; height: 8px; }
}
</style>
```

`.is-missed :deep(.ui-card__title)` 編譯成 `.is-missed[data-v-…] .ui-card__title`，權重 (0,3,0)，比元件庫的 (0,4,0) 低；它能勝出，是因為 `components` 層排在 `vendor` 層後面。

### 算權重

下面是簡化版的權重計算，可以在 Playground 改選擇器試試：

```js run
// 簡化版的權重計算：#id、.class、[屬性]、:pseudo-class、::pseudo-element、元素名稱，以及 :where()
// （:is()、:not()、:has() 要取參數裡最高的權重，這裡沒有處理）
function specificity(selector) {
  const s = selector.replace(/:where\([^)]*\)/g, '')                       // :where() 整段算 0
  const noAttr = s.replace(/\[[^\]]*\]/g, '[]')                            // 屬性值裡的字不算
  const ids = (noAttr.match(/#[\w-]+/g) || []).length
  const classes = (noAttr.match(/\.[\w-]+|\[\]|(?<!:):[\w-]+/g) || []).length
  const types = (noAttr.match(/(^|[\s>+~])[a-z][\w-]*|::[\w-]+/gi) || []).length
  return [ids, classes, types]
}
// 從左邊比起，不會進位
function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

const selectors = [
  '.title',
  'h2.title',
  '.board .card .title',
  '#app .title',
  '.card .title[data-v-7ba5bd90]',        // Vue scoped 編譯後
  ':where(.card) .title',
  'ul li a:hover',
  '.card h2::before',
  '.ui-theme .ui-card .ui-card__header .ui-card__title',
]
for (const sel of selectors) console.log(`(${specificity(sel).join(',')})  ${sel}`)

// 兩條規則搶同一個屬性：權重高的勝出，相同時後寫的勝出
const rules = [
  { sel: '.ui-theme .ui-card .ui-card__header .ui-card__title', color: '#1f2937', from: 'ui-kit.css' },
  { sel: '.is-missed .ui-card__title[data-v-7ba5bd90]', color: '#9ca3af', from: 'ClinicCard.vue' },
]
const winner = rules.reduce((best, r) => (compare(specificity(r.sel), specificity(best.sel)) >= 0 ? r : best))
console.log(`勝出：${winner.from} 的 ${winner.sel} → color: ${winner.color}`)
```

## 常見錯誤與錯誤訊息

CSS 寫錯不會丟出錯誤，規則只是安靜地輸掉。線索都在 DevTools 的 Elements 面板：

- **被劃掉的宣告**：Styles 分頁由上往下是勝出的順序，輸掉的宣告畫一條刪除線。滑鼠停在選擇器上會顯示 `Specificity: (0,3,0)`，兩條規則一比就知道輸在哪裡。
- **找不到值的來源**：Computed 分頁點開屬性旁的箭頭，列出設定過它的每一條規則與檔案；值是繼承來的，就到 Styles 分頁的 `Inherited from …` 區塊找。
- **層的順序寫反**：Styles 分頁用 `Layer vendor` 這樣的分隔列標出規則所在的層。元件庫的規則排在專案規則上面，代表元件庫沒放進層（沒放進層的樣式最強），或 `@layer` 的宣告順序寫反。
- **一路加 `!important`**：每個 `!important` 都要另一個 `!important` 才蓋得過。看到 AI 產生的修改裡新增了 `!important`，先問清楚它在跟哪一條規則比，改用 `@layer` 或調整選擇器。
- **scoped 樣式沒套上**：先看元素有沒有 `data-v-*` 屬性。`v-html` 塞進來的內容、子元件內部的元素都沒有，要用 `:deep()`。
- **`>>>`、`/deep/` 的警告**：舊寫法在 Vue 3 的編譯器會印出 `the >>> and /deep/ combinators have been deprecated. Use :deep() instead.`；`::v-deep .item` 這種當組合符號用的寫法也會被要求改成 `:deep(.item)`。
- **為了贏而加長選擇器**：`.page .board .card .title` 贏了這一次，下一個人就得寫更長的。選擇器維持一兩層 class，衝突用層解決。
- **用 ID 選擇器寫樣式**：一個 ID 的權重勝過任意多個 class，之後只有 ID 或 `!important` 蓋得過。ID 留給 `label for` 與錨點。

## 動手

- 按上面權重計算的「在 Playground 開啟」，把 `.is-missed .ui-card__title[data-v-7ba5bd90]` 改成 `#app .is-missed .ui-card__title` 看勝負怎麼變，再加一個 `:where()` 的版本比較。
- 在任何一個頁面選取元素，滑鼠停在 Styles 分頁的每個選擇器上看權重，找出一條被劃掉的宣告，說出它輸在比較順序的哪一項。
- 在自己的專案搜尋 `!important`，挑一個試著用 `@layer` 拿掉。
- 盒子的大小與間距怎麼算，接著看 [盒模型](#/skill/box-model)。

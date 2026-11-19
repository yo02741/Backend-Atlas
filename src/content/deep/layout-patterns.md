## 從一個具體問題開始：同一個後台，四個寬度壞成四種樣子

門診後台交給 AI 產生，需求寫的是「左邊側欄、右邊診間卡片，要 RWD」。在 1280px 的筆電上看起來沒問題，換了幾個裝置之後：

- **1024px（平板橫放）**：側欄還是 240px，主內容剩不到 800px，卡片維持三欄，每張卡片裡的醫師姓名與時段擠成三行。
- **800px**：側欄在 `max-width: 1023px` 時被隱藏，漢堡按鈕卻寫成 `max-width: 767px` 才出現。768 到 1023 之間，畫面上找不到任何導覽。
- **390px（手機）**：表單頁的「送出掛號」固定在底部，app shell 寫的是 `height: 100vh`，按鈕被瀏覽器的工具列蓋住一半。用 Tab 移到頁面中段的欄位時，欄位剛好藏在 sticky 頁首底下。
- **任何寬度**：從通知點進 `#notice` 錨點，標題被頁首蓋住。

每個元件各自決定了自己的斷點，彼此沒有對齊；「要 RWD」沒有說每個區域在每個寬度長什麼樣子。這一課的兩個工具：用版面模式的名稱說出結構，用一張斷點表說出每個寬度的樣子。

## 運作原理

### 五種常見的版面模式

| 模式 | 用在哪裡 | 結構 | 窄螢幕時 |
|---|---|---|---|
| app shell | 後台、需要登入的應用 | 頁首、側欄、主內容；換頁只換主內容 | 側欄收進 Drawer，頁首保留 |
| 側欄收合 | 項目多的後台導覽 | 展開（圖示加文字）、icon rail（只有圖示）、隱藏 | 隱藏，漢堡按鈕開 Drawer |
| 卡片網格 | 診間、醫師、商品這類可瀏覽的項目 | `repeat(auto-fill, minmax(…, 1fr))` 自動決定欄數 | 一欄 |
| 清單與詳細 | 預約清單點進預約內容、信件 | 寬螢幕左清單右詳細並排 | 清單與詳細分成兩頁，上一頁回到清單原位 |
| 單欄表單 | 掛號、登入、個人資料 | label 在上、欄位一欄排下來，送出在最後 | 不變；送出列可以固定在底部 |

說出模式名稱有兩個好處：同事與 AI 都知道這個結構的慣例（例如 app shell 換頁時外框不重新渲染），斷點表的列也跟著有了名字。

### 斷點表

斷點表是「區域 × 寬度」的表格。列是畫面上的區域，欄是驗收的寬度，每一格寫那個寬度的樣子：

| 區域 | 390 | 768 | 1024 | 1280 |
|---|---|---|---|---|
| 頁首 | 56px：標誌、漢堡按鈕、帳號 | 同左 | 標誌、搜尋、帳號 | 同左 |
| 側欄 | 隱藏，漢堡按鈕開 Drawer | 72px icon rail | 240px 展開，可收合成 72px | 同左 |
| 主內容 | 左右留 16px | 左右留 24px | 同左 | `max-inline-size: 1200px` 置中 |
| 診間卡片 | 1 欄 | 2 欄 | 自動，每張至少 16rem | 同左 |
| 預約表格 | 每筆改成卡片 | 表格，隱藏「建立時間」 | 完整表格 | 同左 |
| 新增掛號 | 底部固定列 | 頁首右側的按鈕 | 同左 | 同左 |
| Dialog | 從底部滑出的 Sheet | 置中，寬 32rem | 同左 | 同左 |

寫法上的約定：

- **390 是基礎樣式**，不包在任何 media query 裡；768、1024、1280 用 `min-width` 往上加（mobile-first，見 [RWD 與斷點](#/skill/rwd)）。
- **每一欄代表「從這個寬度起，到下一個斷點之前」**。768 那一欄管 768 到 1023。只用 `min-width`，或只用範圍語法 `(width >= 48rem)`（Baseline 2023），邊界就不會重疊或留下空隙；`max-width: 768px` 與 `min-width: 768px` 混用時，剛好 768px 兩條規則都成立。
- **「同左」也要寫**。空白的格子看不出是「不變」還是「沒想過」。

斷點從哪裡來？先看內容在哪個寬度放不下（卡片擠到換行、表格出現橫向捲軸），再對齊團隊的斷點表。Tailwind CSS v4 預設的 `md`、`lg`、`xl` 是 `48rem`、`64rem`、`80rem`，在瀏覽器預設字級 16px 下就是 768、1024、1280px。

斷點值要集中在一個地方。CSS 自訂屬性不能用在 media query 的條件裡，`@media (min-width: var(--bp-md))` 不會成立；原生的 `@custom-media` 依 2026-11 的瀏覽器相容性資料還沒有瀏覽器正式支援。常見做法是寫在 Sass 變數、PostCSS 的 custom media 外掛，或 Tailwind 的設定裡。

### 視窗寬度與容器寬度

斷點表管的是整頁的排法：側欄狀態、主內容的邊距、表格與卡片的切換，這些跟著視窗寬度，用 media query。

元件自己的排法跟著它拿到的空間。同一張「醫師卡片」放在 1280px 的主內容裡有 360px 寬，放在側欄的「今日值班」區只有 200px 寬；用 media query 判斷不出這個差別。改用 container query（Baseline 2023）：

```css
.doctor-list { container-type: inline-size; }        /* 這一層成為查詢的對象 */

.doctor-card { display: grid; gap: var(--space-2); }  /* 窄：照片在上、文字在下 */
@container (min-width: 22rem) {
  .doctor-card { grid-template-columns: 4rem 1fr; }   /* 寬：照片在左 */
}
```

### app shell

```css
.shell {
  display: grid;
  min-height: 100dvh;                                  /* 不用 100vh：手機工具列會蓋住底部 */
  grid-template-columns: minmax(0, 1fr);               /* minmax(0, …)：長內容不撐破 */
  grid-template-areas: "header" "main";
}
.shell > header { grid-area: header; position: sticky; top: 0; z-index: var(--z-header); }
.shell > nav    { display: none; }                     /* 390：側欄收進 Drawer */
.shell > main   { grid-area: main; padding-inline: var(--space-4); }

@media (min-width: 48rem) {                             /* 768：icon rail */
  .shell { grid-template-columns: 72px minmax(0, 1fr); grid-template-areas: "header header" "nav main"; }
  .shell > nav { display: block; grid-area: nav; }
  .shell > main { padding-inline: var(--space-6); }
}
@media (min-width: 64rem) {                             /* 1024：展開，可收合 */
  .shell:not([data-sidebar="collapsed"]) { grid-template-columns: 240px minmax(0, 1fr); }
}
@media (min-width: 80rem) {                             /* 1280：主內容限寬置中 */
  .shell > main > .content { max-inline-size: 1200px; margin-inline: auto; }
}

html { scroll-padding-top: 64px; }                     /* 頁首 56px 加一點空隙 */
```

側欄的切換按鈕要讓輔助科技知道狀態：

```html
<button type="button" aria-expanded="true" aria-controls="sidebar" @click="toggle">
  <span class="sr-only">收合側欄</span> <IconChevron aria-hidden="true" />
</button>
<nav id="sidebar" aria-label="主要導覽">
  <!-- icon rail 狀態：文字隱藏，但連結仍要有名稱 -->
  <RouterLink to="/today" aria-label="今日門診"><IconCalendar aria-hidden="true" /></RouterLink>
</nav>
```

收合的選擇記在 `localStorage`，重新整理後維持；只在 1024 以上有意義，768 到 1023 固定是 icon rail。

### 清單與詳細

寬螢幕時清單與詳細同時在畫面上，選中的那一筆寫進網址（`/appointments/501`），重新整理或分享連結都回到同一筆。窄螢幕時兩者是兩頁：從清單點進 `/appointments/501`，按上一頁回到清單，而且要回到剛才捲到的位置。Vue Router 的 `scrollBehavior` 在瀏覽器上一頁、下一頁時會拿到 `savedPosition`：

```js
const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    return savedPosition ?? { top: 0 }   // 上一頁回到原位，其他導覽回到頂端
  },
})
```

清單的資料如果是進頁才非同步載入，回來時資料還沒到、頁面不夠高，`savedPosition` 就捲不過去；要讓清單用快取先畫出來（見 [前端的資料快取](#/skill/data-caching)）。

### 表單與底部固定列

表單用單欄，label 在欄位上方：長 label、翻譯後變長的文字都放得下，Tab 的順序也和閱讀順序一致。只有天生成對的短欄位並排，例如起訖日期。

手機上把「送出」固定在底部時，要處理兩件事：瀏海與底部手勢區，以及固定列擋住的欄位。

```css
.form-actions {
  position: sticky; bottom: 0;
  padding: var(--space-3) var(--space-4) calc(var(--space-3) + env(safe-area-inset-bottom));
}
html { scroll-padding-bottom: 80px; }   /* Tab 到最後幾個欄位時，捲到固定列上方 */
```

`env(safe-area-inset-bottom)` 要搭配 viewport meta 的 `viewport-fit=cover` 才會有值；沒有加時是 0，不會出錯，只是不會避開手勢區。

## 常見錯誤

- **整頁出現橫向捲軸**。Console 執行 `document.documentElement.scrollWidth > innerWidth` 得到 `true`。在 Elements 分頁從 `body` 往下找寬度超過視窗的元素；最常見的是 Grid 軌道寫 `1fr`，被一個長網址或長的病歷號撐寬（`1fr` 的下限是內容的最小寬度），改成 `minmax(0, 1fr)`。flex 子項同理，加 `min-width: 0`。
- **兩個斷點之間沒有導覽**。側欄與漢堡按鈕各用一組條件，`max-width: 1023px` 與 `max-width: 767px` 中間少了一段。斷點表上「側欄」那一列每一格都填了，就不會漏；驗收時在 767、768、1023、1024 各看一次。
- **`@media (min-width: var(--bp-md))` 沒有作用**。不會有錯誤訊息，那段樣式在任何寬度都不套用。斷點改用前處理器變數或 Tailwind 的設定。
- **固定列蓋住焦點**。Tab 到被 sticky 頁首或底部列擋住的欄位，看不到焦點框，違反 WCAG 2.2 的 2.4.11 Focus Not Obscured (Minimum)。加上 `scroll-padding-top`、`scroll-padding-bottom`，數值至少是固定列的高度。
- **手機上底部按鈕被蓋住或留一段空白**。`100vh` 在手機上通常等於工具列收起時的高度，比實際看得到的區域高。改用 `100dvh`（Baseline 2022），或讓固定列用 `position: sticky` 跟著內容。
- **icon rail 的連結沒有名稱**。收合後只剩圖示，Accessibility 窗格的 Name 是空的，螢幕閱讀器只念「連結」。每個連結加 `aria-label`，滑鼠使用者再用 Tooltip 顯示同樣的文字。
- **sticky 頁首不黏**。某個祖先設了 `overflow: hidden` 或 `overflow: auto`，sticky 只在那個祖先裡作用。原因與檢查方式見 [定位與疊放](#/skill/positioning)。

AI 產生版面時最常見的是「每個元件自己決定斷點」與「只在桌機寬度看過」。描述需求時附上斷點表，驗收時照表逐格看。

## 動手

1. 打開 [Grid 實驗室](#/lab/GridLab)，用 `auto-fill` 與 `minmax(16rem, 1fr)` 排出診間卡片，記下 390、768、1024、1280 各排成幾欄，填進一張斷點表。
2. 挑一個自己常用的後台頁面，寫出它的斷點表：頁首、側欄、主內容、表格、Dialog 五列。寫不出來的格子，就是這個頁面沒有定義的地方。
3. 在裝置模式把寬度設成 767、768、1023、1024，每個寬度確認有導覽、沒有橫向捲軸。
4. 只用 Tab 走過一個有 sticky 頁首的長表單，找出焦點被蓋住的欄位，再用 `scroll-padding-top` 修好。
5. 斷點表是畫面規格的一節，接著讀 [一個畫面的完整規格](#/skill/screen-spec)；側欄與 Tabs 的導覽細節見 [導覽元件](#/skill/navigation-ui)。

## 從一個具體問題開始：叫號提示滑得卡卡的，離開時一閃就不見

候診看板在叫號時會從右側滑入一個提示，AI 產生的寫法是：

```css
.call-toast { position: fixed; right: -320px; transition: all .4s; }
.call-toast.show { right: 16px; }
```

```vue
<div v-if="current" class="call-toast" :class="{ show: visible }">請 {{ current.no }} 號到 3 診</div>
```

上線後的回報：

1. 掛在診間外的舊平板上，提示滑入時一頓一頓的，看板上的時鐘也跟著停一下。
2. 提示離開時沒有動畫，`v-if` 變成 `false` 的那一刻就消失了。
3. 候診清單重新排序時，每一列直接跳到新位置，看的人找不到自己的號碼移到哪裡。
4. 一位有前庭障礙的病患家屬反映，整面看板一直有東西在滑動，看了會暈。

四件事對應四個觀念：動 `right` 每一格都要重算版面；`v-if` 拿掉元素時，CSS 沒有機會做離場動畫，要靠 Vue 的 `<Transition>` 延後移除；清單排序要用 `<TransitionGroup>` 的移動動畫；作業系統設定了「減少動態效果」的人，要看到不會滑動的版本。

## 運作原理

### transition：在兩個值之間補間

```css
.call-toast {
  transition-property: opacity, transform;
  transition-duration: 200ms;
  transition-timing-function: ease-out;
  transition-delay: 0s;
}
/* 縮寫：transition: opacity 200ms ease-out, transform 200ms ease-out; */
```

一個屬性的計算值改變時（加了 class、`:hover` 成立、`style` 被改），瀏覽器在舊值與新值之間補出中間的每一格。幾個規則：

- `transition-duration` 預設 `0s`，沒寫時間就是直接切換。
- 要能算出中間值：`opacity: 0` 到 `1`、`translate` 的距離、顏色都可以；`display: none` 到 `block`、`height: 0` 到 `auto` 不行，前者直接切換，後者沒有動畫（`interpolate-size: allow-keywords` 讓 `auto` 能補間，2026 年 11 月只有 Chromium 129 以上支援）。
- 每個屬性結束時各觸發一次 `transitionend`。值沒有變化就沒有轉場、也沒有事件；轉場進行到一半被取消（元素被移除、改成 `display: none`、屬性又被改掉），觸發的是 `transitioncancel`。

`transition: all` 會讓之後任何屬性的改變都變成動畫：切換暗色主題時所有顏色慢慢變、改字級時版面慢慢擠開。列出要動的屬性就好。

### @keyframes 與 animation

```css
@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.06); }
}
.call-no { animation: pulse 1.2s ease-in-out 3; }   /* 名稱、時間、easing、次數 */
```

`animation` 一套用就播放，不需要值改變；可以多段、重複（`infinite`）、倒轉（`alternate`）。播完之後回到原本的樣式，要停在最後一格寫 `animation-fill-mode: forwards`。每次播完觸發 `animationend`。狀態之間的變化用 `transition`，一出現就要播、或要重複的用 `animation`。

### 每一格瀏覽器要做什麼

動畫一秒 60 格時，每一格只有約 16.7 毫秒。動的屬性決定每一格要重跑渲染管線的哪幾段（管線本身見 [瀏覽器怎麼把網頁畫出來](#/skill/how-browsers-render)）：

| 動的屬性 | 每一格重跑 | 例子 |
|---|---|---|
| `width`、`height`、`top`、`left`、`right`、`margin`、`padding`、`font-size` | layout、paint、composite | 開頭那個用 `right` 滑入的提示 |
| `color`、`background-color`、`box-shadow` | paint、composite | hover 時換底色 |
| `transform`（含 `translate`、`scale`、`rotate`）、`opacity` | composite（元素有自己的合成層時） | 位移、縮放、淡入淡出 |

`transform` 與 `opacity` 的動畫可以交給合成器執行緒，主執行緒在跑 JavaScript 時動畫照樣順。舊平板上那個用 `right` 的提示，每一格都要在主執行緒重算整頁版面，看板同時在更新時鐘與清單，格數就掉下來。Lighthouse 的 `Avoid non-composited animations` 會列出這類動畫，原因寫成 `Unsupported CSS Property: right`。

展開收合一定要動到高度，每一格都會重算版面。範圍小（一張卡片的詳細內容）時可以接受，寫法上用 Grid 的軌道補間，CSS 自己算出內容的高度：`grid-template-rows: 0fr` 到 `1fr`，Grid 軌道的動畫是 Baseline 2022。

### easing：速度怎麼變

easing 是時間進度對應到變化進度的曲線。`ease-out` 一開始就移動得多、接近終點時放慢，適合進場；`ease-in` 相反，適合離場；`linear` 等速，適合進度條與轉圈。下面算出 200ms 的動畫在不同時間點走了多少：

```js run
// CSS 的 cubic-bezier(x1, y1, x2, y2)：給時間進度 t（0～1），算出變化的進度
function cubicBezier(x1, y1, x2, y2) {
  const bx = (t) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t ** 2 * (1 - t) + t ** 3
  const by = (t) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t ** 2 * (1 - t) + t ** 3
  return (x) => {
    let lo = 0, hi = 1, t = x
    for (let i = 0; i < 40; i++) {         // 二分搜尋：找出 bx(t) = x 的 t
      t = (lo + hi) / 2
      if (bx(t) < x) lo = t; else hi = t
    }
    return by(t)
  }
}

const curves = {
  linear: (x) => x,
  ease: cubicBezier(0.25, 0.1, 0.25, 1),          // transition-timing-function 的預設值
  'ease-in': cubicBezier(0.42, 0, 1, 1),
  'ease-out': cubicBezier(0, 0, 0.58, 1),
  'ease-in-out': cubicBezier(0.42, 0, 0.58, 1),
}

const duration = 200
for (const [name, f] of Object.entries(curves)) {
  const row = [0.1, 0.25, 0.5, 0.75].map((x) => `${Math.round(x * duration)}ms ${(f(x) * 100).toFixed(0).padStart(3)}%`)
  console.log(name.padEnd(12), row.join('   '))
}
```

`ease-out` 在 50ms 時已經走了一大段，使用者會覺得「一按就有反應」；`ease-in` 前半段幾乎不動，用在進場會讓人覺得慢了一拍。時間長短沒有標準答案，同一個系統裡把幾個數字定下來寫進規格就好；門診系統這份規格用的是：hover 與按下 100ms、Toast 與 Popover 進場 200ms、離場 150ms、Dialog 與 Drawer 250ms。

### Vue 的 `<Transition>`

`v-if` 變成 `false` 時元素立刻從 DOM 移除，CSS 來不及做任何事。`<Transition>` 讓 Vue 在插入與移除前後替元素加減 class，並延後移除，等離場動畫播完：

```
進場（v-if 變成 true）
  插入前   加上 v-enter-from、v-enter-active
  插入 DOM
  下一格   移除 v-enter-from、加上 v-enter-to        ← 瀏覽器在這裡開始補間
  結束後   移除 v-enter-active、v-enter-to

離場（v-if 變成 false）
  立刻     加上 v-leave-from、v-leave-active
  下一格   移除 v-leave-from、加上 v-leave-to
  結束後   從 DOM 移除元素
```

`name="toast"` 時前綴從 `v-` 換成 `toast-`。Vue 3.5 的做法是讀 `*-active` 那一刻元素計算後的 `transition-duration`、`transition-delay`、`animation-duration`，算出要等多久，再搭配 `transitionend` 或 `animationend`。算出來是 0（例如 `toast-leave-active` 沒有寫 transition），離場就立刻完成，元素直接消失，開頭的第 2 個問題就是這樣。

其他常用的設定：

- `mode="out-in"`：切換兩個元素時，舊的先離場、新的再進場，不會同時出現兩個。
- `appear`：第一次渲染也播進場動畫。
- `@after-enter`、`@after-leave` 等 JavaScript 鉤子，例如離場完成後把焦點移回觸發的按鈕。
- `v-show` 也適用：離場結束後 Vue 才設 `display: none`。

`<Transition>` 裡只能有一個元素或元件，放了兩個會出現 `[Vue warn]: <transition> can only be used on a single element or component. Use <transition-group> for lists.`。

### `<TransitionGroup>`：清單

`<TransitionGroup>` 對清單的每一項套進場與離場的 class，另外在順序改變時套上 `v-move`：Vue 記下每一項移動前後的位置，先用 `transform` 把它放回舊位置，再移除 transform 讓它滑到新位置，所以 `.queue-move` 只要寫 `transition: transform 300ms ease`。

每一項都要有穩定的 `key`（掛號 id，不是陣列 index），否則 Vue 分不出哪一項移到哪裡；少了 `key` 時 Console 出現 `<TransitionGroup> children must be keyed.`。刪除某一項時，其他項目要等它離場完才會補上空位，Vue 官方範例的做法是讓離場中的項目 `position: absolute`，其他項目立刻開始移動。

### 減少動態效果

macOS、iOS、Windows、Android 的協助工具設定裡都有「減少動態效果」或「關閉動畫效果」的選項，瀏覽器把它對應到 `prefers-reduced-motion: reduce`（Baseline，2020 年起各瀏覽器都支援）。有前庭障礙的人看到大範圍的移動、視差、縮放會頭暈。

兩種寫法：

- 先寫動畫，再在 `@media (prefers-reduced-motion: reduce)` 裡拿掉位移與縮放。
- 預設沒有位移，只在 `@media (prefers-reduced-motion: no-preference)` 裡加上；忘了寫 media query 的元件預設就是安全的。

減少動態不等於完全沒有變化：淡入淡出與顏色變化通常可以保留，告訴使用者「有東西出現了」。`scroll-behavior: smooth` 與 `element.scrollIntoView({ behavior: 'smooth' })` 也是動態，一樣要看這個設定；JavaScript 用 `matchMedia('(prefers-reduced-motion: reduce)').matches` 讀。

WCAG 2.2 相關的條文：2.2.2 Pause, Stop, Hide（A）要求自動開始、持續超過 5 秒、和其他內容同時出現的動態內容要能暫停或隱藏，跑馬燈式的看板公告屬於這一類；2.3.1 要求一秒內閃爍不超過三次；2.3.3 Animation from Interactions（AAA）要求互動觸發的動畫可以關掉。

### 新一點的工具

| 功能 | 用途 | 支援狀況（2026 年 11 月） |
|---|---|---|
| `@starting-style` | 元素第一次出現（或從 `display: none` 出現）時的起始樣式，不用 JavaScript 就能進場 | Baseline 2024 |
| `transition-behavior: allow-discrete` | 讓 `display`、`overlay` 這類不能補間的屬性等轉場結束才切換，用來做離場 | Baseline 2024；但轉場 `display` 只有 Chromium 與 Safari 18 支援，`overlay` 屬性只有 Chromium 支援 |
| View Transitions（`document.startViewTransition()`） | 整個畫面切換時，新舊畫面之間做過場 | 同一份文件內是 Baseline 2025；跨頁面的還不是 |
| `interpolate-size: allow-keywords` | 讓 `height: auto` 可以補間 | 只有 Chromium 129 以上 |
| Scroll-driven animations（`animation-timeline: scroll()`、`view()`） | 動畫進度跟著捲動位置，不必監聽 `scroll` 事件 | 2026 年 10 月才成為 Baseline，舊瀏覽器要退路 |

在 Vue 專案裡，元件的進出場用 `<Transition>` 最穩；`@starting-style` 適合原生 `<dialog>` 與 `popover` 這類不經過 Vue 的進場。

跟著捲動變化的效果（閱讀進度條、捲到時淡入），以前的寫法是監聽 `scroll` 事件、每次讀 `scrollY` 再改 `style`：每次捲動都在主執行緒跑程式，還常順手讀版面尺寸，捲動跟著卡。Scroll-driven animations 讓 CSS 動畫的進度直接對到捲動位置。它在 2026 年 10 月才成為 Baseline，規則包在 `@supports (animation-timeline: scroll())` 裡，不支援的瀏覽器就沒有這個效果、內容照常顯示；不要為了舊瀏覽器再補一套 `scroll` 監聽。效果只是裝飾時，在 `prefers-reduced-motion: no-preference` 裡才加上。

## 實際程式

### 叫號提示

```vue
<!-- CallToast.vue -->
<script setup>
defineProps({ call: { type: Object, default: null } })   // { no, room }；null 時不顯示
</script>

<template>
  <Transition name="toast">
    <div v-if="call" class="call-toast" role="status">請 {{ call.no }} 號到 {{ call.room }} 診</div>
  </Transition>
</template>

<style scoped>
.call-toast { position: fixed; right: 1rem; bottom: 1rem; }

/* 只動 opacity 與 transform；進場 ease-out、離場 ease-in */
.toast-enter-active { transition: opacity 200ms ease-out, transform 200ms ease-out; }
.toast-leave-active { transition: opacity 150ms ease-in, transform 150ms ease-in; }
.toast-enter-from,
.toast-leave-to { opacity: 0; transform: translateX(24px); }

@media (prefers-reduced-motion: reduce) {
  .toast-enter-from,
  .toast-leave-to { transform: none; }   /* 拿掉位移，保留淡入淡出 */
}
</style>
```

### 候診清單的排序動畫

```vue
<template>
  <TransitionGroup name="queue" tag="ul" class="queue">
    <li v-for="a in sorted" :key="a.id" class="queue__item">{{ a.no }} {{ a.patientName }}</li>
  </TransitionGroup>
</template>

<style scoped>
.queue { position: relative; }
.queue-move { transition: transform 300ms ease; }
.queue-enter-active, .queue-leave-active { transition: opacity 200ms ease; }
.queue-enter-from, .queue-leave-to { opacity: 0; }
.queue-leave-active { position: absolute; }          /* 離場中的項目不佔位置，其他項目立刻補上 */

@media (prefers-reduced-motion: reduce) {
  .queue-move { transition: none; }                   /* 直接換位置，不滑動 */
}
</style>
```

### 展開收合

```css
.detail {
  display: grid;
  grid-template-rows: 0fr;                 /* 收合：軌道高度 0 */
  transition: grid-template-rows 200ms ease-out;
}
.detail.is-open { grid-template-rows: 1fr; }   /* 展開：軌道高度等於內容 */
.detail > .detail__inner { overflow: hidden; } /* 唯一的子元素，min-height 預設 auto 時要加這行才收得起來 */
```

### 原生 `<dialog>` 的進場

```css
dialog[open] {
  opacity: 1;
  transform: none;
  transition: opacity 250ms ease-out, transform 250ms ease-out;
}
@starting-style {
  dialog[open] { opacity: 0; transform: translateY(12px); }   /* 剛打開那一格的樣式 */
}
@media (prefers-reduced-motion: reduce) {
  @starting-style { dialog[open] { transform: none; } }
}
```

這段只有進場。離場要讓 `display` 與 `overlay` 也加進 transition 並寫 `allow-discrete`：轉場 `display` 在 Firefox 還不支援，`overlay` 只有 Chromium 支援，其他瀏覽器的 Dialog 會直接關掉或提早離開 top layer。離場動畫是加分，關閉本身不受影響。

## 常見錯誤與錯誤訊息

| 現象或訊息 | 原因 | 修法 |
|---|---|---|
| 動畫一頓一頓，Performance 分頁每一格都有 `Layout` | 動的是 `right`、`top`、`width`、`height` | 改成 `transform: translate()` 與 `opacity` |
| Lighthouse：`Avoid non-composited animations`、`Unsupported CSS Property: …` | 同上，或動畫用了不能合成的屬性 | 同上 |
| 用 `v-if` 隱藏時沒有離場動畫 | 元素立刻從 DOM 移除 | 包在 `<Transition>` 裡 |
| 有 `<Transition>`，離場還是直接消失 | `*-leave-active` 沒有 transition，Vue 算出的時間是 0 | 補上 `leave-active` 的 transition |
| `[Vue warn]: <transition> can only be used on a single element or component. …` | `<Transition>` 裡放了多個元素 | 包一層元素，或改用 `<TransitionGroup>` |
| `<TransitionGroup> children must be keyed.` | 清單項目沒有 `key` | 用資料的 id 當 `key` |
| 清單排序時直接跳位置 | 沒有 `v-move` 的 transition，或 `key` 用了 index | 加 `.xxx-move { transition: transform … }`，`key` 用 id |
| `height: auto` 的展開沒有動畫 | `auto` 不能補間 | Grid 的 `0fr` 到 `1fr`，或只在 Chromium 用 `interpolate-size` |
| `animation` 播完跳回原樣 | 預設不保留最後一格 | `animation-fill-mode: forwards` |
| 等 `transitionend` 的程式沒執行 | 值沒變、`duration` 是 0（減少動態時拿掉了轉場），或轉場被中斷 | 檢查值與時間；一併處理 `transitioncancel`；`el.getAnimations()` 是空陣列時直接往下做 |
| 減少動態時寫了一條全域規則，把所有 `animation-duration`、`transition-duration` 設成 `0.01ms !important` | 舊的 CSS reset 常見的寫法：淡入淡出與顏色變化也一起消失，有些動畫直接跳到終點反而更突兀 | 逐個元件處理：在 media query 裡拿掉位移與縮放，保留淡入淡出 |
| 切換主題時整頁慢慢變色 | `transition: all` | 只列出要動的屬性 |
| 開了「減少動態效果」畫面還在滑動 | 沒寫 `prefers-reduced-motion` | 加 media query，拿掉位移與縮放 |

## 動手

1. 在 easing 那段按「在 Playground 開啟」，加一條 `cubicBezier(0.2, 0, 0, 1)`，和 `ease-out` 比較 50ms 時的進度。
2. 打開一個有動畫的頁面，用 Animations 分頁錄下來，切到 `10%` 速度看每個 class 套上的時機；再到 Rendering 分頁模擬 `prefers-reduced-motion: reduce`，確認位移都不見了。
3. 把自己專案裡一個用 `top` 或 `height` 做的動畫改成 `transform`，用 Performance 分頁比較改前改後每一格的 `Layout`。
4. Dialog 與 Drawer 開關時焦點怎麼移動見 [浮層：Dialog、Drawer、Popover、Tooltip](#/skill/overlays)；動畫和互動狀態的關係見 [互動狀態](#/skill/ui-states)。

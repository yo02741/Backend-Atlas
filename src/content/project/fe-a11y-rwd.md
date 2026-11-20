## 這階段要做出什麼

前五個階段的畫面都用滑鼠、在桌機寬度測過。這一階段換成三種方式各走一遍，把找到的問題修掉：

1. **只用鍵盤**（Tab、Shift+Tab、Enter、Space、Esc）：從登入走到掛號成功、取消一筆掛號，每一步都看得到焦點在哪，沒有停不到或停在看不見的地方。
2. **開著螢幕閱讀器**（macOS 的 VoiceOver、Windows 的 NVDA）：每個按鈕念得出名稱，額滿、錯誤、成功這些狀態念得出來，換頁時知道頁面換了。
3. **390px 與 1280px 兩種寬度**：390px 一欄、頁面不能左右捲動，按鈕夠大；1280px 左邊篩選、右邊三欄卡片。

具體的修改清單：

| 問題 | 修法 |
|---|---|
| `div` 加 `@click` 做的「掛號」Tab 停不到 | 換頁用 `<RouterLink>`（連結），在同一頁做事用 `<button type="button">` |
| 只有圖示的「重新整理」念成「按鈕」 | `aria-label="重新整理"`，SVG 加 `aria-hidden="true"` |
| 額滿只用灰色表示 | 寫出「額滿」兩個字，沒有「掛號」可以點 |
| 結果訊息只在 Toast 裡、或用 `v-if` 插入 | 寫進一直存在的 `role="status"`，只改文字 |
| 換頁後焦點留在剛點的連結（或掉到 `body`） | `router.afterEach` 更新 `document.title`、焦點移到新頁面的 `h1` |
| `*:focus { outline: none }` | 刪掉，用 `:focus-visible` 畫外框 |
| 寫死的兩欄與三欄，390px 撐出橫向捲軸 | mobile-first 的 grid，`repeat(auto-fill, minmax(260px, 1fr))` |

accessibility tree、名稱的來源、`tabindex` 的三種值、live region 在 [無障礙基礎](#/skill/a11y-basics)；viewport meta、mobile-first 與斷點在 [RWD 與斷點](#/skill/rwd)；`fr`、`minmax()`、`auto-fill` 在 [Grid：二維版面](#/skill/grid)。

## 設計決策與取捨

### 連結還是按鈕

「掛號」會換到另一個網址（`/sessions/3/book`），所以是連結：`<RouterLink>` 渲染成 `<a href>`，可以用中鍵開新分頁、可以複製網址。「重新整理」「取消掛號」在同一頁做事，是按鈕。兩者都由瀏覽器處理 Tab 順序、Enter（按鈕還有 Space），不用加 `tabindex` 或自己聽 `keydown`。`role="button"` 只改了螢幕閱讀器念的角色，Tab 與 Enter 還是要自己補，能用原生元素就不用 ARIA。

### 換頁後移動焦點

一般網站換頁時整頁重新載入，焦點回到頁面開頭、螢幕閱讀器念出新的標題。SPA 用 History API 換頁，DOM 只換了一部分，焦點還停在剛剛點的連結上，或者連結被移除、焦點掉到 `body`。Vue Router 不處理這件事，在 `afterEach` 裡做：更新 `document.title`，`nextTick` 之後把焦點移到 `main h1`（加 `tabindex="-1"`：可以被 `focus()`，但不加入 Tab 順序）。只改了 query（換篩選、換頁碼）時不移，否則每換一次條件焦點就跳到頁首。

### live region 一開始就在

螢幕閱讀器監聽的是「已經存在的容器裡的內容變化」。容器和訊息一起插進 DOM 時，很多螢幕閱讀器不會念。所以 `role="status"`（polite，等目前的朗讀告一段落再念）的元素從頁面一開始就在，之後只改文字；錯誤用 `role="alert"`（assertive，立刻打斷）。WCAG 2.1 起的 4.1.3 Status Messages（AA）要求狀態訊息不搶焦點也能被輔助科技讀到。

### 焦點看得到

`:focus` 只要有焦點就成立，滑鼠點按鈕也算，所以常被要求拿掉外框。`:focus-visible` 由瀏覽器判斷該不該顯示：Tab 移動時成立，滑鼠點按鈕時通常不成立，文字輸入框就算用滑鼠點也成立。只對 `:focus-visible` 畫明顯的外框（這裡是 3px），外框和背景的對比至少 3:1（WCAG 2.2 的 1.4.11）。

### mobile-first 的 grid

沒有 media query 的樣式給 390px：`.page` 只有 `display: grid` 與 `gap`，一欄是預設；篩選的欄位 `width: 100%` 配 `box-sizing: border-box`；「掛號」占滿卡片寬度、至少 44px 高（專案的規格；WCAG 2.2 的 2.5.8 要求點擊目標至少 24×24 CSS px）。`@media (min-width: 1024px)` 再把 `.page` 改成 `280px 1fr` 兩欄、頁首跨兩欄。

卡片的欄數不寫死：`repeat(auto-fill, minmax(260px, 1fr))` 依右欄的寬度決定放幾張，1280px 時右欄約 936px，放三張；390px 時放不下兩張就是一欄。卡片區塊也可以改用 container query（`@container`，Baseline 2023），依卡片區塊本身的寬度換版面：同一個元件放進窄的側欄時也會變成一欄。這一階段的頁面只有一種版面，用 media query 就夠。

不要加 `user-scalable=no` 或 `maximum-scale=1`：使用者不能放大，視力不好的人就看不清楚。

## 關鍵程式

換頁之後的標題與焦點（第 1 階段的路由表每一條都有 `meta.title`）：

```js
// src/focus.js：換頁之後更新標題、把焦點移到新頁面的 h1（main.js 在 app.use(router) 之前 import）
import { nextTick } from 'vue'
import { router } from '@/router'

router.afterEach(async (to, from, failure) => {
  if (failure) return                                  // 導航被取消或重複：畫面沒換
  document.title = `${to.meta.title ?? '門診系統'}｜門診系統`
  if (!from.matched.length || to.path === from.path) return   // 第一次載入、只改 query（篩選）：焦點不動
  await nextTick()
  document.querySelector('main h1')?.focus()           // h1 要有 tabindex="-1"
})
```

診次頁的 CSS（mobile-first；類別名稱對應驗收題的固定 HTML）：

```css
/* 手機（預設）：一欄，篩選在清單上面 */
.page {
  display: grid;
  gap: 16px;
}

.filters label {
  display: block;
}

.filters input,
.filters select {
  box-sizing: border-box;
  width: 100%;                      /* 欄位占滿寬度 */
}

.sessions {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));   /* 放得下幾張就排幾欄 */
  gap: 16px;
}

.book {
  box-sizing: border-box;
  width: 100%;
  min-height: 44px;                 /* 專案規格：按鈕至少 44px 高 */
}

/* 鍵盤操作時看得到焦點 */
.book:focus-visible,
.filters :focus-visible {
  outline: 3px solid #1d4ed8;
  outline-offset: 2px;
}

/* 1024px 以上：左邊固定寬度的篩選，右邊卡片 */
@media (min-width: 1024px) {
  .page {
    grid-template-columns: 280px 1fr;
    align-items: start;
  }
  .top {
    grid-column: 1 / -1;            /* 頁首跨兩欄 */
  }
}
```

第 1 到第 4 階段的頁面已經照這些規則寫：登入、診次、掛號、我的掛號的 `h1` 都有 `tabindex="-1"`；診次頁的「掛號」是 `RouterLink`，額滿時只顯示「額滿」；掛號成功的訊息在一直存在的 `role="status"` 裡；取消確認的 Dialog 由 `showModal()` 處理焦點。`focus.js` 在 Chromium 裡和前幾階段的程式一起跑過：登入後換到我的掛號，`document.title` 是「我的掛號｜門診系統」、焦點在 `h1`。上面的 CSS 是第二題的解答，在 390、1280 兩種寬度都檢查過。

## 常見錯誤

**`div` 加 `@click`。** Tab 跳過它，Enter 按了沒反應。Lighthouse 不一定報得出來，要拔掉滑鼠走一遍才發現。

**圖示按鈕沒有名稱。** Lighthouse 會報 `Buttons do not have an accessible name`。加 `aria-label`，圖示 `aria-hidden="true"`。

**只靠顏色。** 灰色的卡片代表額滿，紅綠色弱的使用者、螢幕閱讀器都不知道。寫出文字。

**`aria-label` 和看得到的字不一樣。** 按鈕寫「重新整理」卻 `aria-label="refresh"`，語音控制的使用者說「按重新整理」點不到它。名稱和看得到的文字一致。

**換篩選時焦點也跳到 `h1`。** `afterEach` 沒比對 path。只改 query 時不移。

**`outline: none` 之後沒補樣式。** 鍵盤使用者看不到焦點在哪。用 `:focus-visible`。

**寫死寬度的欄。** `repeat(3, 300px)` 在 390px 撐出 1000px 以上的頁面。用 `minmax()` 與 `auto-fill`。

**`width: 100%` 加 padding 撐出去。** 少了 `box-sizing: border-box`，輸入框比容器寬，出現橫向捲軸。

**在桌機縮小視窗代替手機。** 縮小的視窗沒有觸控、沒有虛擬鍵盤，`hover` 也還在。DevTools 的裝置模式加實機各看一次。

## 驗收題在測什麼

**鍵盤與螢幕閱讀器**（vue 題）：三個「掛號」都是 `button[type=button]`；「重新整理」的名稱是「重新整理」、SVG 有 `aria-hidden="true"`；額滿的診次有「額滿」兩個字、「掛號」停用；`role="status"` 一開始就在，載入後是「共 3 個診次」、重新整理後是「已更新，共 3 個診次」，而且一直是同一個元素；換到掛號頁後焦點在 `h1`、`document.title` 是「掛號｜門診系統」，回到清單後焦點在清單的 `h1`。題目沒有 Vue Router，換頁用一個 `page` ref，掛號用按鈕；上面的程式用 `RouterLink`。

**390 與 1280**（css 題，HTML 固定）：390px 時篩選在卡片上面、卡片一張一行，篩選的欄位與「掛號」占滿寬度、按鈕至少 44px 高，頁面沒有橫向捲軸；1280px 時篩選 280px、和卡片左右並排、頁首跨兩欄，卡片一列三張、寬度相同而且不小於 260px；「掛號」拿到焦點時符合 `:focus-visible`、外框至少 2px。測試只看排出來的位置與尺寸，用 media query 或 container query 都可以。

自動化的檢查抓不到焦點順序合不合理、念出來聽不聽得懂，驗收時仍然要用鍵盤與螢幕閱讀器實際走一遍。下一階段把這個前端建置、部署到子路徑。

## 串接驗收

**1. 把鍵盤流程寫成腳本。** 從登入走到掛號成功、再到我的掛號取消一筆，把每一次按鍵寫成一張表：按鍵、焦點落在哪個元素、螢幕閱讀器念出什麼。照表用鍵盤與螢幕閱讀器走一遍。預期：每一列都對得上；對不上的列就是要修的地方。這張表是第 3 步回歸測試的規格。

**2. 放大字級。** 1280px 寬的視窗用瀏覽器放大到 200% 看一次，再改回 100%、在瀏覽器設定把預設字級調到最大看一次。先預測 200% 時會套用哪一組版面。預期：放大 200% 時 CSS 寬度約 640px，套用你在 640px 寫的斷點；兩種放大都沒有橫向捲軸、「掛號」的文字沒有被截掉、焦點外框看得到。只放大預設字級時，用 `px` 寫死的高度與字級最容易出問題。

**3. 納入回歸。** 用 [Playwright](#/skill/e2e-playwright) 把第 1 步的表寫成測試：每次 `page.keyboard.press('Tab')` 之後用 `toBeFocused()` 檢查焦點；另加一個 640×800 viewport 的版面測試，檢查沒有橫向捲軸。預期：把 `:focus-visible` 的樣式刪掉，或把一個「掛號」改回 `div`，測試失敗；改回來就通過。下一階段部署前，這組測試放進[前端的 CI](#/skill/frontend-ci)。

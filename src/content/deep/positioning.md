## 從一個具體問題開始：z-index: 9999 的選單還是被蓋住

門診看板有三樣會浮在畫面上的東西：黏在頂端的頂端列、每張診間卡片右上角的「過號」徽章、卡片的「更多」下拉選單。上線前回報了三個問題：

1. 徽章沒有出現在卡片角落，所有徽章疊在頁面的右上角。
2. 往下捲時，「更多」選單打開後一半被頂端列蓋住。AI 把選單改成 `z-index: 9999`，沒有用；再改成 `99999`，還是沒有用。
3. 為了修手機上的橫向捲軸，有人在最外層加了 `overflow: hidden`，之後頂端列就不黏了。

三個問題各自對應定位的一條規則：`absolute` 以誰為基準、`z-index` 在哪個範圍裡比、`sticky` 黏在哪個捲動容器。

## 運作原理

### `position` 的五個值

| 值 | 佔不佔原本的空間 | `top`、`left` 從哪裡算 | 捲動時 |
|---|---|---|---|
| `static`（預設） | 佔 | 沒有作用 | 跟著內容捲 |
| `relative` | 佔，原位置保留 | 從自己原本的位置位移 | 跟著內容捲 |
| `absolute` | 不佔 | 最近的定位祖先 | 跟著那個祖先捲 |
| `fixed` | 不佔 | 視窗（例外見下面） | 不動 |
| `sticky` | 佔 | 捲動容器的可視範圍 | 到門檻前跟著捲，之後黏住 |

「定位元素」指 `position` 不是 `static` 的元素。

### `absolute` 以誰為基準

`absolute` 元素的 `top`、`right`、`bottom`、`left` 從**包含區塊**（containing block）算起：往上找最近的定位祖先，取它的 padding 邊。一路找不到，就以初始包含區塊（大小和視窗一樣、位在頁面頂端）為準。

實測：卡片寬 200px、左邊在 300px 的位置，徽章寫 `top: 8px; right: 8px`。卡片有 `position: relative` 時，徽章的右邊在 492px（卡片右緣往內 8px）；卡片沒有 `position` 時，徽章的右邊在 1272px，也就是 1280px 寬的視窗往內 8px。這是開頭第一個問題：卡片少了 `position: relative`。

`absolute` 元素不佔空間，旁邊的內容不會讓開。徽章蓋到卡片標題時，要替標題留 `padding-right`。

### `fixed` 的例外

`fixed` 通常以視窗為基準，捲動時不動。祖先有 `transform`、`filter`、`perspective`（還有 `contain: paint` 等少數屬性）時，那個祖先變成它的包含區塊。實測：在一個 `transform: translateZ(0)` 的區塊裡寫 `position: fixed; top: 0; left: 0`，元素出現在那個區塊的左上角，捲動時跟著區塊走，換成 `filter` 也一樣。

常見的情境：頁面切換動畫在外層加了 `transform`，裡面的 Toast 或固定按鈕就不再固定。

### `sticky` 黏在哪裡

`sticky` 元素平常照一般排版，捲到門檻（`top: 0` 這類值）時停住，像 `fixed` 一樣黏著，直到它的父元素底部離開畫面，它被父元素帶走。實測三個情況（頁面捲動 500px）：

| 情況 | 頂端列的位置 |
|---|---|
| 父元素很高，沒有任何祖先設 `overflow` | 黏在 0 |
| 外層有 `overflow: hidden` | -400，跟著捲走了 |
| 外層有 `overflow: clip` | 黏在 0 |
| 父元素只有 300px 高，已經捲過 | -240，被父元素帶走 |
| 沒寫 `top` | -400，跟著捲走了 |

`overflow: hidden`、`auto`、`scroll` 讓元素變成捲動容器，`sticky` 只在最近的捲動容器裡黏。外層的 `overflow: hidden` 本身不會捲動，頁面捲動時 sticky 就失效了，這是開頭的第三個問題。只是要裁掉溢出時用 `overflow: clip`（Baseline 2022），它不會變成捲動容器。

側欄放在橫排的 flex 容器裡也常黏不住：flex 子項預設 `align-self: stretch`，側欄被拉得和主欄一樣高（實測 3000px），沒有空間可以黏。側欄加 `align-self: flex-start`，高度回到內容大小就黏得住。

### 沒有 `z-index` 時誰在上面

同一個疊放範圍裡，瀏覽器大致依這個順序畫，後畫的蓋在上面：

1. 這個範圍本身的背景與邊框
2. `z-index` 是負數的定位元素
3. 一般的 block 元素
4. float 元素
5. 文字與 inline 元素
6. 沒有 `z-index`（或 `z-index: 0`）的定位元素，照 DOM 順序
7. `z-index` 是正數的定位元素，數字小的先畫

所以定位元素會蓋在一般元素上面，即使一般元素在 DOM 裡比較後面；兩個沒有 `z-index` 的定位元素，DOM 裡後面的在上面。

`z-index` 只對定位元素有作用，另外 flex 與 grid 的子項不用定位也能用 `z-index`（實測一個 `static` 的 flex 子項寫 `z-index: 5`，蓋過後面的定位元素）。

### stacking context：`z-index` 比較的範圍

上面的順序是在一個 **stacking context** 裡排的。某些元素會建立新的 stacking context，它和裡面所有的子孫被當成一整塊，放進外層的順序裡：

- 定位元素加上 `z-index` 不是 `auto`
- flex、grid 的子項加上 `z-index` 不是 `auto`
- `opacity` 小於 1
- `transform`、`filter`、`perspective`、`clip-path`、`mask` 不是 `none`
- `isolation: isolate`
- `position: fixed` 或 `sticky`
- `will-change` 指定了上面這些屬性
- `<html>` 根元素

可以把它想成資料夾：資料夾裡的元素只在資料夾裡比 `z-index`，整個資料夾再用自己的 `z-index` 跟外面比。開頭第二個問題的結構：

```
根
├── header.board-header   position: sticky; z-index: 10
└── ul.rooms              transform: translateY(0)   ← 進場動畫留下的，建立 stacking context，視為 z-index 0
    └── li.room
        └── .menu         position: absolute; z-index: 9999
```

`.menu` 的 9999 只在 `ul.rooms` 這個資料夾裡排第一；跟頂端列比的是 `ul.rooms` 這一整塊，它是 0，頂端列是 10，頂端列在上面。實測把 `transform` 換成 `opacity: 0.99` 結果一樣。把選單的數字調得再大也沒用；要嘛拿掉建立資料夾的屬性，要嘛讓選單離開這個資料夾（放進 top layer，或 teleport 到 `body` 底下）。

另一個例子：父元素是 `position: relative` 但沒有 `z-index`（不建立 stacking context），子元素寫 `z-index: -1`，子元素會畫到父元素的背景後面，看起來消失了。父元素加 `isolation: isolate`，子元素就留在父元素的背景之上（實測）。

### top layer

`<dialog>` 用 `showModal()` 打開、或 `popover` 元素打開時，瀏覽器把它放進 **top layer**：一個在整頁所有 stacking context 之上的獨立層。實測一個 `popover` 元素放在 `overflow: hidden` 加 `transform` 的容器裡，打開後仍然蓋過 `z-index: 2147483647` 的固定頂端列，也沒有被容器裁掉。

| 做法 | 打開的方式 | 行為 |
|---|---|---|
| `<dialog>` + `showModal()` | JS | 背景不能操作（modal），Esc 關閉，`::backdrop` 是遮罩 |
| `popover` 屬性 | `<button popovertarget="id">` 或 `showPopover()` | 點外面或按 Esc 自動關閉（`popover="auto"`），不擋背景 |

`<dialog>` 是 Baseline 2022，Popover API 是 Baseline 2025。`popover` 元素的瀏覽器預設樣式是 `position: fixed` 加 `margin: auto`，打開時出現在視窗正中央；要貼著觸發按鈕，得自己設定位置。CSS anchor positioning 可以用 CSS 把浮層對齊到按鈕，三大瀏覽器都已有基本支援，但 2026 年 11 月時 web-features 還沒有把整組功能標成 Baseline，使用前先確認目標瀏覽器。

## 實際程式碼

```css
/* 層級集中定義，元件只引用 token */
:root {
  --z-header: 100;
  --z-drawer: 200;
  --z-toast: 300;
}

/* 頂端列：祖先不能有 overflow: hidden，需要裁切時用 clip */
.board-header {
  position: sticky;
  top: 0;
  z-index: var(--z-header);
  background: #fff;      /* 沒有背景時，捲過去的內容會從底下透出來 */
}
.page { overflow-x: clip; }

/* 卡片當定位基準，徽章放右上角 */
.room {
  position: relative;
  padding: 16px 72px 16px 16px;   /* 右側留給徽章 */
}
.room .badge {
  position: absolute;
  top: 8px;
  right: 8px;
}

/* popover 的預設位置是視窗正中央，改成由 JS 設定 top、left */
.room-menu[popover] {
  position: fixed;
  inset: auto;
  margin: 0;
}
```

```html
<li class="room">
  <h3>內科 101 診</h3>
  <span class="badge">過號</span>
  <button type="button" class="more" popovertarget="menu-101" aria-label="內科 101 診的更多動作">⋯</button>
  <div id="menu-101" class="room-menu" popover>
    <button type="button">叫下一號</button>
    <button type="button" class="cancel">取消今日門診</button>
  </div>
</li>

<dialog id="confirm-cancel">
  <form method="dialog">
    <p>確定取消內科 101 診今天的門診？</p>
    <button value="cancel">返回</button>
    <button value="confirm">取消門診</button>
  </form>
</dialog>
```

```js
// 選單打開前，依按鈕的位置設定 top、left（popover 是 fixed，用視窗座標）
const button = document.querySelector('[popovertarget="menu-101"]')
const menu = document.getElementById('menu-101')
menu.addEventListener('beforetoggle', (event) => {
  if (event.newState !== 'open') return
  const rect = button.getBoundingClientRect()
  menu.style.top = `${rect.bottom + 4}px`
  menu.style.left = `${Math.max(8, rect.right - 180)}px`
})

// 確認視窗用 showModal()：進入 top layer、背景不能操作、Esc 關閉
menu.querySelector('.cancel').addEventListener('click', () => {
  menu.hidePopover()
  document.getElementById('confirm-cancel').showModal()
})
```

選單與確認視窗都在 top layer，不受 `ul.rooms` 的 `transform` 與清單的 `overflow` 影響，也不用參與 `z-index` 的比較。選單是 `fixed`，頁面捲動時不會跟著按鈕移動；`popover="auto"` 在點外面時會關閉，需要時也可以在捲動時呼叫 `hidePopover()`。

## 常見錯誤與錯誤訊息

- **`z-index` 沒有作用**：Styles 分頁的提示是 `The position: static property prevents z-index from having an effect.`，建議 `Try setting position to something other than static.`。`top`、`left` 寫在 `static` 元素上也有同樣的提示：`The position: static property prevents top from having an effect.`。flex 與 grid 的子項不會出現這個提示，因為它們的 `z-index` 有作用。
- **9999 還是被蓋住**：往上找建立 stacking context 的祖先：在 Elements 逐層選取，看 Computed 分頁有沒有 `transform`、`opacity` 小於 1、`filter`、`isolation`、`will-change`，或帶 `z-index` 的定位。要比的是那個祖先的層級。
- **徽章跑到頁面角落**：卡片少了 `position: relative`。
- **固定按鈕跟著捲走**：祖先有 `transform` 或 `filter`，`fixed` 改以那個祖先為基準。把固定元素移到 `body` 底下（Vue 用 `<Teleport to="body">`），或拿掉祖先的 `transform`。
- **sticky 不黏**：沒寫 `top`；祖先有 `overflow: hidden`、`auto`；父元素和 sticky 元素一樣高（flex 子項被 stretch）。依序檢查。
- **sticky 的頂端列下面透出內容**：頂端列沒有背景色，或 `z-index` 比卡片低。
- **選單在清單邊緣被切掉**：祖先的 `overflow` 裁掉了 `absolute` 子元素。改用 `popover` 放進 top layer，或 teleport 到 `body`。打開後 Elements 面板的樹最下方出現 `#top-layer`，代表它在 top layer 裡。
- **`z-index: -1` 的裝飾消失**：它被畫到父元素的背景後面。父元素加 `isolation: isolate`。
- **每個元件各寫一個大數字**：Drawer 寫 1000、Toast 寫 9999、某個 Tooltip 寫 99999，很快就沒人知道順序。集中成 `--z-*` token。

## 動手

- 把上面的 HTML 與 CSS 貼進一個頁面，拿掉 `.room` 的 `position: relative`，看徽章跑到哪裡；再把 `.page` 的 `overflow-x: clip` 改成 `hidden`，捲動看頂端列。
- 在 `ul.rooms` 加上 `transform: translateY(0)`，把選單改回 `position: absolute; z-index: 9999` 的普通元素，捲到頂端列底下打開，看它被蓋住；再改回 `popover`。
- 打開任何一個網站的 Dialog，在 Elements 面板找 `#top-layer`，點元素旁的 `top-layer` 標記跳回它在 DOM 裡的位置。
- Toast 這類固定在畫面上的回饋元件放在哪裡、停多久，接著看 [回饋：Toast、Alert、Skeleton、Empty state](#/skill/feedback)。

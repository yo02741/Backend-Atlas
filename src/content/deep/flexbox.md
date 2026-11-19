## 從一個具體問題開始：搜尋框把「重新整理」擠出畫面

門診看板的頂端列有三樣東西：院區名稱、搜尋框、「重新整理」按鈕。AI 產生的 CSS 是這樣：

```css
.board-header { display: flex; }
.board-header input { width: 100%; }
```

1280px 寬時看起來正常。換到 390px，院區名稱是「總院區（第二門診大樓）」，搜尋框和名稱都不肯變窄，「重新整理」按鈕被推到畫面外，整頁多出一條橫向捲軸。

要修好它，得知道 flex 容器怎麼決定每個子項的寬度：先依起始大小排，多的空間怎麼分、不夠的空間怎麼縮，以及子項最窄能縮到多少。這三件事都由 `flex-grow`、`flex-shrink`、`flex-basis` 與 `min-width` 決定。

## 運作原理：先排 basis，再分剩下的空間

### 主軸與交叉軸

`display: flex` 的元素是 flex 容器，它的直接子元素是 flex 子項（孫元素不算）。`flex-direction` 決定**主軸**，交叉軸和它垂直：

| `flex-direction` | 主軸方向 | `justify-content` 管 | `align-items` 管 |
|---|---|---|---|
| `row`（預設） | 依書寫方向，中文與英文是由左到右 | 水平 | 垂直 |
| `row-reverse` | 由右到左 | 水平 | 垂直 |
| `column` | 由上到下 | 垂直 | 水平 |
| `column-reverse` | 由下到上 | 垂直 | 水平 |

`justify-content` 永遠作用在主軸、`align-items` 永遠作用在交叉軸。改了 `flex-direction`，同一行 `justify-content: center` 就從水平置中變成垂直置中。直排時容器的高度通常由內容撐開，沒有多出來的空間，`justify-content` 看起來沒有作用；要給容器高度（例如 `min-height: 100dvh`）才看得出差別。

`-reverse` 只改變顯示順序，DOM 順序不變，鍵盤 Tab 的順序也不變，所以有互動元素時少用。

### 一行裡的寬度怎麼算

以橫排、不換行為例，瀏覽器的步驟大致如下：

1. 每個子項先取 `flex-basis` 當起始大小。`flex-basis: auto` 時看 `width`，沒有 `width` 就看內容的寬度。
2. 把所有起始大小與 `gap` 加起來，和容器的寬度比較。
3. **有剩**：多出來的空間依 `flex-grow` 的比例分給各子項。`flex-grow` 全是 0 時不分，空間留著交給 `justify-content` 擺放。
4. **不夠**：缺的空間依「`flex-shrink` × 起始大小」的比例從各子項扣掉，但每個子項不會小於它的最小寬度。

放大的例子：容器 600px，三個子項的 basis 是 100、200、100px，`flex-grow` 是 1、2、1。剩下 600 − 400 = 200px，按 1 : 2 : 1 分成 50、100、50，最後是 150、300、150px。

縮小的例子：容器 300px，兩個子項的 basis 是 300、100px，`flex-shrink` 都是 1。缺 400 − 300 = 100px，按 1 × 300 : 1 × 100 = 3 : 1 扣掉 75 與 25，最後是 225、75px。basis 大的扣得多。

### 最小寬度：`min-width: auto`

第 4 步的「最小寬度」是溢出的主因。flex 子項的 `min-width` 預設是 `auto`，對大多數子項來說，等於內容最窄能排到的寬度（例如最長的一個英文字或網址、`input` 的預設寬度）。缺的空間扣到這個下限就扣不下去，剩下的部分只能溢出容器。

開頭的問題出在這裡：院區名稱是一長串不換行的文字，`input` 也有預設寬度，兩者都縮不下去，按鈕被擠出去。給會縮的子項 `min-width: 0`（或 `overflow: hidden`），它才能縮到比內容還窄。直排時對應的是 `min-height`。

### `flex` 縮寫

`flex` 一次寫 `flex-grow`、`flex-shrink`、`flex-basis`。常見的幾種：

| 寫法 | 等於 | 行為 |
|---|---|---|
| 不寫（初始值） | `0 1 auto` | 不放大，空間不夠時可以縮，從 `width` 或內容寬度起算 |
| `flex: 1` | `1 1 0` | 從 0 起算再平分，所有寫 `flex: 1` 的子項一樣寬，和內容長短無關 |
| `flex: auto` | `1 1 auto` | 從內容寬度起算，再平分剩下的空間，內容多的比較寬 |
| `flex: none` | `0 0 auto` | 不放大也不縮小，維持原本大小，適合按鈕與圖示 |
| `flex: 1 1 240px` | | 從 240px 起算，可放大可縮小；搭配 `flex-wrap: wrap` 做卡片列 |

### `justify-content`、`align-items` 與換行

| 屬性 | 常用的值 |
|---|---|
| `justify-content` | `flex-start`（預設）、`center`、`flex-end`、`space-between`（頭尾貼邊，中間平分）、`space-around`（每個子項兩側各一份，所以頭尾是中間的一半）、`space-evenly`（所有間距相等） |
| `align-items` | `stretch`（預設，拉滿這一行的交叉軸）、`flex-start`、`center`、`flex-end`、`baseline`（文字的基線對齊） |
| `flex-wrap` | `nowrap`（預設）、`wrap` |
| `align-content` | 換行後有多行時，各行之間怎麼分配交叉軸的空間；只有一行時沒有作用 |
| `gap` | 子項之間的間距，換行時也套用在行與行之間 |

`align-items: stretch` 是一排卡片會等高的原因：子項的高度沒有寫死時，它被拉到和這一行最高的子項一樣高。子項寫了 `height`，`stretch` 就不再作用。

另一個常用的技巧是 `margin-left: auto`：在 flex 子項上，`auto` 的 margin 會吃掉那一側所有的剩餘空間，把這個子項和它後面的子項推到最右邊，例如頂端列右側的使用者選單。

## 實際程式碼

頂端列與診間卡片列：

```html
<header class="board-header">
  <h1 class="site">總院區（第二門診大樓）</h1>
  <input class="search" type="search" aria-label="搜尋診間或醫師">
  <button type="button" class="refresh">重新整理</button>
</header>
<ul class="rooms">
  <li class="room">內科 101 診 · 王醫師 · 候診 12 人</li>
  <li class="room">骨科 203 診 · 林醫師 · 候診 4 人</li>
  <li class="room">眼科 305 診 · 陳醫師 · 候診 9 人</li>
</ul>
```

```css
.board-header {
  display: flex;
  align-items: center;   /* 標題、輸入框、按鈕垂直置中 */
  gap: 12px;
}
.board-header .site {
  flex: 0 1 auto;        /* 可以縮 */
  min-width: 0;          /* 允許縮到比文字還窄 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.board-header .search {
  flex: 1;               /* 吃掉剩下的空間 */
  min-width: 0;          /* input 有預設寬度，不加這行縮不下去 */
}
.board-header .refresh {
  flex: none;            /* 按鈕維持內容寬度 */
}

.rooms {
  display: flex;
  flex-wrap: wrap;       /* 放不下就換行 */
  gap: 16px;
  padding: 0;
  list-style: none;
}
.rooms .room {
  flex: 1 1 240px;       /* 從 240px 起算，一行放得下幾張就放幾張 */
}
```

390px 寬時，搜尋框縮到剩下的寬度，院區名稱顯示省略號，按鈕留在畫面內；卡片列一行一張。768px 時一行兩張，1280px 時一行四張左右，實際張數由容器寬度除以 240px 加間距決定。

## 常見錯誤與錯誤訊息

- **子項撐破容器**：長網址、長英文字、`input`、表格放在 flex 子項裡，裝置模式切到 390px 就出現橫向捲軸。在會縮的子項加 `min-width: 0`，文字加 `overflow-wrap: anywhere` 或省略號。
- **屬性寫在錯的元素上**：`flex-grow` 寫在子項、父元素卻不是 flex 容器，或 `justify-content` 寫在子項上。Chrome 的 Styles 分頁會在屬性旁顯示提示圖示，訊息類似 `The display: block property on the parent element prevents flex-grow from having an effect`，下面附建議（`Try setting the display: block property on the parent to display: flex`）。
- **直排時 `justify-content` 沒作用**：容器高度由內容撐開，沒有剩餘空間可以分。給容器高度；要的如果是水平方向的對齊，改用 `align-items`。
- **每個子項都寫 `flex: 1`**：內容長短不同的子項被強制一樣寬，按鈕被拉得很寬。只給要吃空間的那一個 `flex: 1`，其他用 `flex: none`。
- **換行後最後一行被拉寬**：`flex: 1 1 240px` 讓最後一行單獨一張卡片長滿整行。要每張一樣寬，改用 Grid 的 `repeat(auto-fill, minmax(240px, 1fr))`，或給卡片 `max-width`。
- **換行後想調整行距卻改 `align-items`**：多行之間的分配由 `align-content` 管，行與行的間距用 `gap`。
- **用 `margin` 拼間距**：每張卡片加 `margin-right`，最後一張多出一段、換行後又不整齊。改用 `gap`（Flexbox 的 `gap` 從 2021 年起主要瀏覽器都支援）。

## 動手

- 打開 [Flexbox 實驗室](#/lab/FlexboxLab)：切 `flex-direction` 看主軸與交叉軸的箭頭轉向，把容器寬度拉到最小看哪張卡片先被擠壓，再調第二張卡片的 `flex-grow`、`flex-shrink`、`flex-basis` 對照右邊的 CSS。
- 在任何用 flex 排版的頁面，Elements 面板點元素旁的 `flex` 標記，看疊加線標出的子項與間距；在 Styles 點 `display: flex` 旁的圖示打開 Flexbox 編輯器，直接切換 `justify-content` 與 `align-items`。
- 把上面的頂端列貼進一個 HTML 檔，拿掉 `.search` 的 `min-width: 0`，在裝置模式 390px 看它怎麼撐破容器。
- 版面的下一步是 [RWD 與斷點](#/skill/rwd)：同一個版面在不同寬度怎麼換排法。

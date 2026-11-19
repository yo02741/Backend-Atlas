// 題庫：HTML 與 CSS 版面
export default [
  {
    skill: 'semantic-html',
    questions: [
      {
        q: '用 `<div class="btn" @click="save">儲存</div>` 代替 `<button>`，會少了什麼？',
        options: [
          '只是少了預設樣式，加上 CSS 之後兩者的行為完全相同',
          '不能用 Tab 聚焦、不能用 Enter 或 Space 觸發，螢幕閱讀器也不會念出「按鈕」',
          '`div` 不能綁 `click` 事件，Vue 會在 Console 顯示警告',
          '`div` 在手機上點不到，只有桌機能用滑鼠點',
        ],
        answer: 1,
        explain: '`button` 自帶 button 角色、可聚焦、Enter 與 Space 會觸發點擊；`div` 這些都沒有，只用鍵盤或螢幕閱讀器的人無法操作。`div` 綁 `click` 不會有警告，手機上也點得到，問題出在鍵盤與輔助工具；要補齊得加 `tabindex`、`role` 與按鍵處理，直接用 `button` 最簡單。',
      },
      {
        q: '使用者按「清除」之後，除了清空欄位，還會發生什麼？',
        code: `<form @submit.prevent="submit">
  <label for="phone">手機</label>
  <input id="phone" type="tel" autocomplete="tel">
  <button @click="clearForm">清除</button>
  <button type="submit">送出掛號</button>
</form>`,
        lang: 'html',
        options: [
          '只會清空欄位，`button` 預設的 `type` 是 `button`',
          '頁面會重新整理，因為 `@submit.prevent` 只攔得到 `type="submit"` 的按鈕',
          '表單的 `submit` 事件也會觸發，`submit` 照樣執行、送出掛號',
          '焦點移到第一個欄位，除此之外什麼都不做',
        ],
        answer: 2,
        explain: '在 `form` 裡沒寫 `type` 的 `button` 預設是 `submit`，按下去先執行 `clearForm`，接著觸發表單的 `submit` 事件。`@submit.prevent` 擋下的是瀏覽器的預設送出（所以頁面不會重新整理），不論是哪顆按鈕觸發的，`submit` 函式都會執行。修法是「清除」加上 `type="button"`。',
      },
      {
        q: '病歷號是 7 位數字，可能以 0 開頭（例如 `0012345`），手機上要出現數字鍵盤。欄位該怎麼寫？',
        options: [
          '`<input type="text" inputmode="numeric" pattern="[0-9]{7}">`',
          '`<input type="number">`，數字欄位就該用 number',
          '`<input type="tel">`，撥號鍵盤一樣是數字',
          '`<input type="text" placeholder="請輸入數字">`',
        ],
        answer: 0,
        explain: '`inputmode="numeric"` 讓手機顯示數字鍵盤，值仍是字串，前導的 0 會保留，`pattern` 負責檢查格式。`type="number"` 給可以加減的數量用，會出現調整箭頭，轉成數字後 `0012345` 變成 `12345`；`tel` 的語意是電話，自動填入可能帶入手機號碼；`placeholder` 不會改變鍵盤。',
      },
    ],
  },
  {
    skill: 'flexbox',
    questions: [
      {
        q: '`flex: 1` 等於哪一組 `flex-grow`、`flex-shrink`、`flex-basis`？',
        options: [
          '`1 1 0`：從 0 起算，平分剩餘空間',
          '`1 1 auto`：從內容寬度起算，再平分剩餘空間',
          '`1 0 auto`：只放大、不縮小',
          '`0 1 auto`：和預設值相同，寫了等於沒寫',
        ],
        answer: 0,
        explain: '`flex: 1` 是 `1 1 0`，起始大小是 0，所以寫了 `flex: 1` 的子項不論內容長短都一樣寬。`1 1 auto` 是 `flex: auto`，從內容寬度起算再分空間；`0 1 auto` 是沒寫 `flex` 時的初始值；`1 0 auto` 沒有對應的常用縮寫。',
      },
      {
        q: '容器沒有設定高度。想讓子項水平置中，結果沒有作用，原因是？',
        code: `.board-header {
  display: flex;
  flex-direction: column;
  justify-content: center;
}`,
        lang: 'css',
        options: [
          '`justify-content` 只能用在 Grid，flex 容器要用 `align-items`',
          '直排時 `justify-content` 管的是垂直方向，而容器高度由內容撐開，沒有剩餘空間可以分',
          '`flex-direction: column` 會讓所有的對齊屬性失效',
          '要加 `flex-wrap: wrap`，`justify-content` 才會生效',
        ],
        answer: 1,
        explain: '`justify-content` 永遠管主軸，`column` 的主軸是垂直的；容器高度等於內容高度時沒有空間可以分，看起來就沒作用。水平置中要用管交叉軸的 `align-items: center`。`justify-content` 在 flex 與 Grid 都能用，`column` 不會讓對齊失效，`flex-wrap` 和這件事無關。',
      },
      {
        q: '頂端列有院區名稱、搜尋框（`flex: 1`）與「重新整理」按鈕。390px 寬時，很長的院區名稱把按鈕擠出畫面、出現橫向捲軸。最合適的修法是？',
        options: [
          '容器加 `overflow: hidden`，把超出的部分藏起來',
          '三個子項都改成 `flex: 1`，讓它們平分寬度',
          '名稱與搜尋框加 `min-width: 0`，名稱用省略號，按鈕設 `flex: none`',
          '把按鈕改成 `position: absolute`，固定在右上角',
        ],
        answer: 2,
        explain: 'flex 子項預設 `min-width: auto`，不會縮到比內容還窄，長名稱與 `input` 的預設寬度縮不下去，按鈕就被擠出去。`min-width: 0` 讓它們縮得下去，`flex: none` 保住按鈕的寬度。`overflow: hidden` 只是把按鈕藏起來；三個都 `flex: 1` 會把按鈕拉寬，名稱仍然縮不下；絕對定位會讓按鈕蓋住搜尋框。',
      },
    ],
  },
  {
    skill: 'rwd',
    questions: [
      {
        q: '`<head>` 少了 `<meta name="viewport" content="width=device-width, initial-scale=1">`，手機上會怎樣？',
        options: [
          '沒有影響，手機瀏覽器會自動偵測頁面有沒有做 RWD',
          '頁面用約 980px 的虛擬寬度排版再整頁縮小，寫給窄螢幕的 media query 不會成立',
          '頁面以裝置寬度排版，但使用者不能用兩指放大',
          '只有 container query 失效，media query 照常運作',
        ],
        answer: 1,
        explain: '沒有 viewport meta 時，手機瀏覽器假設頁面是給桌機看的，用約 980px 排版再縮小，所以字很小、`max-width: 600px` 這類條件不成立。瀏覽器不會自動偵測；禁止放大是 `user-scalable=no` 造成的；整個版面寬度都錯了，media query 也跟著錯。',
      },
      {
        q: '視窗剛好 768px 寬時，`.rooms` 的 `gap` 是多少？',
        code: `.rooms { display: grid; grid-template-columns: 1fr; }
@media (max-width: 768px) { .rooms { gap: 8px; } }
@media (min-width: 768px) { .rooms { grid-template-columns: 1fr 1fr; gap: 16px; } }`,
        lang: 'css',
        options: [
          '8px，因為 `max-width: 768px` 那一條寫在前面',
          '兩條都不成立，用瀏覽器的預設值 0',
          '16px：兩條都成立，權重相同時後面的規則蓋掉前面的',
          '8px 與 16px 取平均，得到 12px',
        ],
        answer: 2,
        explain: '`max-width` 與 `min-width` 都包含邊界值，768px 時兩條 media query 都成立。兩條規則的選擇器權重相同，後寫的勝出，所以是 16px。這種重疊容易在斷點上出現怪異的版面，全站統一用 mobile-first 的 `min-width` 就不會有兩條同時成立的問題。',
      },
      {
        q: '同一個「醫師卡片」元件會放在 1280px 頁面裡 280px 寬的側欄，也會放在 900px 寬的主欄。卡片寬時照片放左邊、窄時放上面，該用什麼判斷？',
        options: [
          'container query：卡片外層設 `container-type: inline-size`，用 `@container (min-width: 400px)` 切換版面',
          'media query：`@media (min-width: 1280px)` 時照片一律放左邊',
          '用 JavaScript 監聽 `window` 的 `resize`，依 `innerWidth` 切換 class',
          '用 `100vw` 算出卡片寬度，再用 `clamp()` 決定照片的位置',
        ],
        answer: 0,
        explain: '兩個位置的視窗寬度一樣是 1280px，卡片寬度卻差很多，只有看父容器寬度的 container query 分得出來。media query 與 `innerWidth` 看的都是視窗，側欄裡的卡片也會被當成寬版；`100vw` 同樣是視窗寬度，`clamp()` 只能算數值，沒辦法切換版面結構。',
      },
    ],
  },
  {
    skill: 'css-cascade',
    questions: [
      {
        q: '先宣告 `@layer base, components;`，`@layer base { #app .title { color: red; } }` 與 `@layer components { .title { color: blue; } }` 都比對到同一個標題，標題是什麼顏色？',
        options: [
          '紅色：`#app .title` 的權重 (1,1,0) 比 `.title` 高',
          '藍色：層的順序在權重之前比，`components` 宣告在後面所以勝出',
          '紅色：`base` 層宣告在前面，前面的層優先',
          '看兩個 `@layer` 區塊在檔案裡誰寫得比較後面',
        ],
        answer: 1,
        explain: '瀏覽器先比層的順序，分出高下就不看權重；`@layer base, components;` 讓 `components` 勝過 `base`，所以 `#app .title` 的 (1,1,0) 沒有機會比。「前面的層優先」只在兩邊都是 `!important` 時成立。層的順序由名稱第一次出現的位置決定（這裡是開頭那行宣告），不是區塊在檔案裡的位置。',
      },
      {
        q: '這段寫在 `<style scoped>` 裡，Vue 編譯後的選擇器是哪一個？',
        code: `.card .title { font-weight: 700; }
.list :deep(.item) { margin: 0; }`,
        lang: 'css',
        options: [
          '`.card[data-v-7ba5bd90] .title[data-v-7ba5bd90]` 與 `.list[data-v-7ba5bd90] .item[data-v-7ba5bd90]`',
          '`[data-v-7ba5bd90] .card .title` 與 `[data-v-7ba5bd90] .list .item`',
          '`.card .title[data-v-7ba5bd90]` 與 `.list[data-v-7ba5bd90] .item`',
          '`.card .title` 與 `.list .item`，scoped 只在執行時用 JavaScript 判斷範圍',
        ],
        answer: 2,
        explain: 'scoped 只在選擇器的最後一段加上屬性選擇器，所以 `.card .title` 變成 `.card .title[data-v-7ba5bd90]`，權重多 (0,1,0)。`:deep()` 把屬性移到它前面那一段，`.item` 不帶屬性，才比對得到子元件裡的元素。scoped 是編譯時改寫選擇器，不是執行時判斷。',
      },
      {
        q: '元件庫用 `.ui-theme .ui-card .ui-card__header .ui-card__title` 設定卡片標題的顏色，專案要在「過號」時改成灰色，之後還要做暗色主題。哪個做法最不會留下後患？',
        options: [
          '元件庫的 CSS 用 `@import url("ui-kit.css") layer(vendor)` 放進前面的層，專案的規則寫一般的 class',
          '專案的規則加上 `!important`',
          '加長選擇器，寫成 `#app .is-missed .ui-card__title`，用 ID 提高權重',
          '改用 inline style `:style="{ color: \'gray\' }"`，inline 一定勝出',
        ],
        answer: 0,
        explain: '層的順序先於權重比較，元件庫放進前面的層後，專案用一個 class 就能蓋過它，暗色主題也一樣。`!important` 讓之後每次覆蓋都得再加一個；ID 選擇器之後只有 ID 或 `!important` 蓋得過；inline style 勝過樣式表裡所有一般規則，暗色主題的 CSS 也蓋不過它，而且它照樣輸給任何 `!important`。',
      },
    ],
  },
  {
    skill: 'box-model',
    questions: [
      {
        q: '兩個相鄰的 `div`，上面的 `margin-bottom: 24px`，下面的 `margin-top: 16px`，父元素是一般的 block。兩個 `div` 之間的距離是多少？',
        options: [
          '40px，兩個 margin 相加',
          '24px，上下的 margin 合併，取較大的那個',
          '16px，後面的 margin 蓋掉前面的',
          '20px，兩個 margin 取平均',
        ],
        answer: 1,
        explain: '上下相鄰的 block，margin 會合併成較大的那個，所以是 24px；一正一負時才相加（24px 與 -10px 得 14px）。父元素換成直排的 flex 或 grid 容器時，子項的 margin 不合併，距離才會是 40px。只有垂直方向會合併，左右的 margin 一律相加。',
      },
      {
        q: '專案沒有設定 `box-sizing`，`.card` 實際佔多寬？',
        code: `.list { width: 358px; }
.card { width: 100%; padding: 16px; border: 1px solid #ccc; }`,
        lang: 'css',
        options: [
          '358px，`width: 100%` 就是父元素的寬度',
          '390px，358 加上左右的 padding',
          '392px，358 加上左右的 padding 與 border',
          '324px，padding 與 border 往內吃掉空間',
        ],
        answer: 2,
        explain: '預設 `box-sizing: content-box`，`width` 只算 content，padding 與 border 另外加：358 + 16 × 2 + 1 × 2 = 392px，比父元素寬 34px，頁面出現橫向捲軸。390px 漏算了 border。設成 `border-box` 時卡片是 358px，content 縮成 324px；324 是 content 的寬，不是卡片佔的寬。',
      },
      {
        q: '卡片裡的備註可能很長。規格是卡片最高 160px、超出時在卡片內捲動，內容短時不出現捲軸，卡片也不要留空白。怎麼寫？',
        options: [
          '`max-height: 160px; overflow-y: auto;`',
          '`height: 160px; overflow: hidden;`',
          '`max-height: 160px; overflow: scroll;`',
          '`min-height: 160px; overflow: visible;`',
        ],
        answer: 0,
        explain: '`max-height` 讓內容短時卡片照內容高度、不留空白，`overflow-y: auto` 只在內容超過時出現捲軸。`height: 160px` 讓短內容也佔 160px，`hidden` 直接裁掉，使用者看不到後面的字；`scroll` 內容短時也顯示捲軸；`min-height` 沒有上限，`visible` 讓文字跑出卡片外。',
      },
    ],
  },
  {
    skill: 'grid',
    questions: [
      {
        q: '容器 1000px 寬，`grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))`、`gap: 16px`，只有兩張卡片。結果是？',
        options: [
          '排成三欄，兩張卡片各約 323px，右邊留一個空欄',
          '空的軌道收成 0，兩張卡片各拉到 492px',
          '兩張卡片各 240px，剩下的空間留在右邊',
          '排成四欄，每欄 240px',
        ],
        answer: 1,
        explain: '1000px 放得下三條 240px 的軌道（(1000 + 16) ÷ 256 取整數是 3）。`auto-fit` 把沒有項目的軌道收成 0，兩張卡片平分全部寬度：(1000 − 16) ÷ 2 = 492px。第一個選項是 `auto-fill` 的結果，它保留空軌道。上限是 `1fr`，有空間就會分，不會停在 240px；四欄要 1008px，放不下。',
      },
      {
        q: '這段 CSS 的結果是？',
        code: `.page {
  display: grid;
  grid-template-columns: 240px 1fr;
  grid-template-areas:
    "header header"
    "side   main"
    "header foot";
}`,
        lang: 'css',
        options: [
          'header 佔第一列整列與第三列左格，其他區域照字串排',
          '瀏覽器自動把第三列的 `header` 當成 `.`（空格）',
          '只有第三列被忽略，前兩列照常排',
          '整條 `grid-template-areas` 無效，寫了 `grid-area` 的項目不會照區域排',
        ],
        answer: 3,
        explain: '每個區域必須是一個長方形；`header` 分散在第一列與第三列，不是長方形，整條宣告無效，computed 值變成 `none`。瀏覽器不會只丟掉一列，也不會自動改成空格。寫了 `grid-area: header` 的項目找不到區域，會擠到格線外的隱式軌道。Styles 分頁裡這行會被劃掉並出現警告圖示。',
      },
      {
        q: '卡片牆在 390px 手機（容器 358px）排一欄、768px 排兩欄、1280px 排四欄左右，每張至少 240px，不寫 media query；同一個元件也會放進只有 200px 寬的側欄，不能溢出。`grid-template-columns` 怎麼寫？',
        options: [
          '`repeat(auto-fill, minmax(min(240px, 100%), 1fr))`',
          '`repeat(4, 1fr)`',
          '`repeat(auto-fill, 240px)`',
          '`repeat(auto-fill, minmax(240px, 1fr))`',
        ],
        answer: 0,
        explain: '`auto-fill` 依容器寬度決定欄數，`1fr` 讓每欄平分剩下的空間，`min(240px, 100%)` 讓下限在容器比 240px 窄時改成容器寬。最後一個選項在 200px 的側欄裡仍是 240px，溢出 40px；`repeat(4, 1fr)` 在手機上擠成四條窄欄；`repeat(auto-fill, 240px)` 欄寬固定，剩下的空間留在右邊。',
      },
    ],
  },
  {
    skill: 'positioning',
    questions: [
      {
        q: '卡片右上角的徽章寫了 `position: absolute; top: 8px; right: 8px;`，卻出現在頁面的右上角。最可能的原因是？',
        options: [
          '徽章少了 `z-index`，被其他元素擠到角落',
          '卡片沒有設定 `position`，徽章往上找不到定位祖先，改以頁面為基準',
          '`absolute` 一律以視窗為基準，要放在卡片角落得改用 `fixed`',
          '卡片設了 `overflow: hidden`，徽章被移到外面',
        ],
        answer: 1,
        explain: '`absolute` 從最近一個 `position` 不是 `static` 的祖先算起，一路找不到就以頁面為準。替卡片加上 `position: relative`，徽章就回到卡片角落。`z-index` 只影響疊放順序、不影響位置；`fixed` 是以視窗為基準；`overflow: hidden` 會裁掉超出的部分，不會搬動元素。',
      },
      {
        q: '選單打開後和頂端列重疊，哪一個在上面？',
        code: `<header class="board-header" style="position: sticky; top: 0; z-index: 10">…</header>
<ul class="rooms" style="transform: translateY(0)">
  <li class="room" style="position: relative">
    <div class="menu" style="position: absolute; z-index: 9999">…</div>
  </li>
</ul>`,
        lang: 'html',
        options: [
          '選單，9999 比 10 大',
          '選單，`absolute` 元素一律蓋在 `sticky` 元素上面',
          '看 DOM 順序，後面的選單在上面',
          '頂端列：`ul.rooms` 的 `transform` 建立了 stacking context，選單的 9999 只在裡面比，整塊和頂端列比時是 0',
        ],
        answer: 3,
        explain: '`transform` 不是 `none` 的元素會建立 stacking context，`z-index` 只在同一個 context 裡比。跟頂端列比的是 `ul.rooms` 這一整塊，它沒有 `z-index`，視為 0，輸給頂端列的 10。把選單的數字調得再大都沒用；要拿掉 `transform`，或把選單放進 top layer（`popover`）。DOM 順序只在 `z-index` 相同時才決定上下。',
      },
      {
        q: '頂端列 `position: sticky; top: 0;` 原本正常。有人為了消除手機上的橫向捲軸，在最外層的 `.page` 加了 `overflow: hidden`，之後頂端列就不黏了。最合適的修法是？',
        options: [
          '把 `.page` 的 `overflow: hidden` 改成 `overflow-x: clip`',
          '頂端列改成 `position: fixed`，其他都不用改',
          '頂端列加上 `z-index: 9999`',
          '替 `.page` 加上 `position: relative`',
        ],
        answer: 0,
        explain: '`overflow: hidden` 讓 `.page` 變成捲動容器，sticky 只在它裡面黏；`.page` 本身不會捲動，頁面捲動時頂端列就跟著走。`overflow-x: clip` 一樣裁掉橫向溢出，但不會變成捲動容器。改成 `fixed` 會讓頂端列脫離排版，下面的內容被它蓋住；`z-index` 與 `position: relative` 和黏不黏無關。',
      },
    ],
  },
  {
    skill: 'images-media',
    questions: [
      {
        q: '`<img srcset="d-480.webp 480w, d-960.webp 960w, d-1440.webp 1440w" src="d-960.webp">` 沒寫 `sizes`。在 1280px 寬、1 倍密度的桌機上，CSS 讓這張圖顯示成 320px 寬。瀏覽器通常下載哪個檔案？',
        options: [
          '`d-480.webp`：瀏覽器依 CSS 算出的 320px 挑檔案',
          '`d-1440.webp`：沒寫 `sizes` 時當成 `100vw`，需要 1280 像素',
          '`d-960.webp`：沒寫 `sizes` 時用 `src` 指定的檔案',
          '三個都下載，載入後再顯示最合適的那一個',
        ],
        answer: 1,
        explain: '瀏覽器在 CSS 載入之前就決定下載哪個檔案，只能看 `sizes`；沒寫時當成 `100vw`，也就是 1280px，挑大於等於 1280 的最小檔案 1440w。`src` 只在瀏覽器不支援 `srcset` 時使用；瀏覽器只下載挑中的那一個。加上 `sizes="(min-width: 1280px) 320px, 100vw"` 後，同一台桌機會改下載 480w。',
      },
      {
        q: '390px 寬的手機上，圖片的容器寬 374px。圖片還沒下載完時，它佔多高？',
        code: `<img src="wang.webp" width="960" height="1280" alt="王醫師，內科"
     style="width: 100%; height: auto">`,
        lang: 'html',
        options: [
          '0，下載完才知道高度，屆時下面的內容被往下推',
          '1280px，照 `height` 屬性',
          '約 499px，瀏覽器用 `width` 與 `height` 屬性算出 3 : 4 的比例',
          '374px，比例不明時預設是正方形',
        ],
        answer: 2,
        explain: '瀏覽器把 `width`、`height` 屬性換算成 `aspect-ratio: auto 960 / 1280`，下載前就能算出高度：374 × 1280 ÷ 960 ≈ 499px，版面不會跳。CSS 的 `width: 100%; height: auto` 決定實際大小，所以不是 1280px。拿掉兩個屬性才會是 0，等下載完再撐開。',
      },
      {
        q: '醫師介紹頁有 12 張照片，第一張在首屏，其他要往下捲才看得到。`loading` 與 `fetchpriority` 怎麼寫？',
        options: [
          '第一張不寫 `loading`、加 `fetchpriority="high"`，其餘 `loading="lazy"`',
          '全部 `loading="lazy"`，減少一開始的下載量',
          '全部 `fetchpriority="high"`，讓每張照片都先下載',
          '第一張 `loading="lazy"`，其餘不寫 `loading`',
        ],
        answer: 0,
        explain: '首屏的照片通常是 LCP 元素，要立刻下載，`fetchpriority="high"` 讓它排在其他圖片前面；畫面下方的照片接近視窗才下載。全部 lazy 會延後首屏照片，DevTools 的 `LCP request discovery` 會提示 `LCP resources shouldn’t use loading=lazy`；全部都設成 high 等於沒有分別；最後一個選項剛好顛倒。',
      },
    ],
  },
  {
    skill: 'units-typography',
    questions: [
      {
        q: '根元素的字級是 16px。`h3` 的行高會是多少？',
        code: `.card    { font-size: 1rem; line-height: 1.5em; }
.card h3 { font-size: 2rem; }`,
        lang: 'css',
        options: [
          '24px，`h3` 換行時兩行會疊在一起',
          '48px，行高跟著 `h3` 的字級重新計算',
          '`1.5`，`em` 在繼承時會變回倍數',
          '32px，行高等於字級',
        ],
        answer: 0,
        explain: '帶單位的 `line-height: 1.5em` 在 `.card` 上先算成 24px，子元素繼承的是這個固定值，所以 32px 的 `h3` 只有 24px 的行高。寫成不帶單位的 `line-height: 1.5`，繼承的是倍數，`h3` 會用自己的字級算出 48px。',
      },
      {
        q: '使用者在瀏覽器的設定把預設字型調大（沒有用縮放）。下面哪一段文字的大小不會變？',
        options: [
          '`font-size: 0.875rem` 的輔助文字',
          '`font-size: clamp(1rem, 0.9rem + 0.5vw, 1.25rem)` 的標題',
          '`font-size: 14px` 的表格內容',
          '父元素用 `rem`、自己寫 `font-size: 90%` 的說明文字',
        ],
        answer: 2,
        explain: '字型大小設定改的是預設字級，也就是 `rem`、`em`、`%` 的基準；寫死 `px` 的文字不會變。`clamp()` 的上下限與偏好值裡的 `rem` 會跟著變。瀏覽器縮放（Ctrl 加 `+`）則會連 `px` 一起放大，兩種放大方式都要測。',
      },
      {
        q: '叫號看板在 `<head>` 預先下載數字字型。Network 分頁看到同一個 `woff2` 下載了兩次，Console 出現 `A preload for \'…/board-digits.woff2\' is found, but is not used because the request credentials mode does not match.`。該怎麼改？',
        code: `<link rel="preload" href="/fonts/board-digits.woff2" as="font" type="font/woff2">`,
        lang: 'html',
        options: [
          '把 `@font-face` 的 `font-display` 改成 `optional`',
          '在 `<link rel="preload">` 加上 `crossorigin`',
          '把 `as="font"` 改成 `as="style"`',
          '移除 `@font-face` 的 `unicode-range`，讓瀏覽器一次下載整個檔案',
        ],
        answer: 1,
        explain: '字型一律用 CORS 模式下載，`preload` 少了 `crossorigin` 時，兩邊請求的 credentials 模式不同，預先下載的那一份用不上，瀏覽器只好再下載一次。`font-display` 只決定字型還沒到時怎麼顯示；`as="style"` 會讓預先下載的類型錯掉；`unicode-range` 和這個問題無關。',
      },
    ],
  },
  {
    skill: 'css-architecture',
    questions: [
      {
        q: '標題沒有變粗，Console 也沒有任何錯誤。原因是？',
        code: `<template>
  <h3 :class="$style.cardTitle">{{ name }}</h3>
</template>

<style module>
.card-title { font-weight: 700; }
</style>`,
        lang: 'vue',
        options: [
          '`$style.cardTitle` 是 `undefined`：CSS Modules 的鍵照 CSS 原樣，是 `card-title`',
          '`<style module>` 只能寫在 `.module.css` 檔，SFC 裡要用 `<style scoped>`',
          '`:class` 不能綁物件的屬性，要寫成字串 `"card-title"`',
          'CSS Modules 會移除 `font-weight` 這類文字屬性，要放到全域 CSS',
        ],
        answer: 0,
        explain: 'CSS Modules 的鍵就是 CSS 裡寫的 class 名稱，`.card-title` 要用 `$style[\'card-title\']` 取，`$style.cardTitle` 拿到 `undefined`，元素沒有 class，也沒有錯誤訊息。Vite 的 `css.modules.localsConvention: \'camelCase\'` 會另外產生 `cardTitle` 這個鍵。SFC 支援 `<style module>`；直接寫字串 `"card-title"` 對不到改寫過的名稱。',
      },
      {
        q: 'Tailwind CSS 4 的專案，建置後這個徽章沒有背景色，也沒有任何錯誤。最合適的修法是？',
        code: `<script setup>
const props = defineProps({ level: String })   // 'warn' 或 'danger'
</script>

<template>
  <span :class="\`bg-\${props.level === 'danger' ? 'red' : 'amber'}-100\`">狀態</span>
</template>`,
        lang: 'vue',
        options: [
          '在 `tailwind.config.js` 的 `content` 加上 `./src/**/*.vue`',
          'Tailwind 不支援 `:class`，把 class 寫在靜態的 `class` 屬性',
          '寫成完整字串的對照表，例如 `{ danger: \'bg-red-100\', warn: \'bg-amber-100\' }`',
          '在元件的 `<style>` 用 `@apply bg-red-100`，不需要其他設定',
        ],
        answer: 2,
        explain: 'Tailwind 把原始碼當純文字掃描，只產生完整出現過的 class；用字串組出來的 `bg-red-100` 從來沒出現在原始碼裡，所以不會產生。`content` 是 Tailwind 3 的設定，4 會自動掃描專案；`:class` 可以用，只要值是完整的字串；SFC 的 `<style>` 裡用 `@apply` 要先寫 `@reference` 指向主要的 CSS，否則建置失敗。',
      },
      {
        q: 'Vue 專案全面使用 `<style scoped>` 與 design token，沒有安裝 Tailwind。AI 產生的新元件寫了一長串 Tailwind 的 class。該怎麼處理？',
        options: [
          '安裝 Tailwind，兩種做法並存，之後再慢慢統一',
          '保留 class 名稱，在全域 CSS 補上同名的規則',
          '改成 CSS-in-JS，避免和 scoped 樣式互相影響',
          '要求改成 `<style scoped>` 與既有的 token，並把主要做法寫進專案規範',
        ],
        answer: 3,
        explain: '一個專案選一種主要做法，新元件照做；兩種並存時每個元件都要先查它用哪一種，同一個按鈕也容易有兩種長相。在全域 CSS 補同名規則等於回到全域命名空間；換成 CSS-in-JS 是第三種做法。把規範寫進給 AI 的專案說明，下次產出就會照做。',
      },
    ],
  },
  {
    skill: 'css-motion',
    questions: [
      {
        q: 'Toast 出現時會淡入。`show` 變成 `false` 時會怎樣？',
        code: `<Transition name="toast">
  <div v-if="show" class="toast">已完成報到</div>
</Transition>

<style>
.toast-enter-active { transition: opacity 200ms ease-out; }
.toast-enter-from { opacity: 0; }
</style>`,
        lang: 'vue',
        options: [
          '淡出 200ms，Vue 會沿用進場的 transition',
          '直接消失：`toast-leave-active` 沒有 transition，Vue 算出的時間是 0，立刻移除元素',
          '一直留在畫面上，Vue 等不到 `transitionend`',
          'Console 出現 `[Vue warn]`，提示缺少 leave 的 class',
        ],
        answer: 1,
        explain: '離場時 Vue 套上 `toast-leave-from`、`toast-leave-active`、`toast-leave-to`，並讀 `leave-active` 那一刻計算後的 transition 與 animation 時間；這裡都是 0，離場立刻完成、元素被移除。進場的設定不會套用到離場，Vue 也不會因此警告。補上 `.toast-leave-active` 的 transition 與 `.toast-leave-to { opacity: 0 }` 就有淡出。',
      },
      {
        q: '看板一邊每秒更新資料、一邊播放叫號提示的滑入動畫。動哪一組屬性，主執行緒忙的時候動畫最不容易卡？',
        options: [
          '`right` 從 `-320px` 到 `16px`',
          '`width` 從 `0` 到 `320px`',
          '`transform: translateX()` 與 `opacity`',
          '`margin-left` 從 `100%` 到 `0`',
        ],
        answer: 2,
        explain: '`transform` 與 `opacity` 在元素有自己的合成層時只需要重跑合成，可以交給合成器執行緒，主執行緒在跑 JavaScript 時動畫照樣順。`right`、`width`、`margin-left` 每一格都要在主執行緒重算版面與重繪；Lighthouse 會把它們列在 `Avoid non-composited animations`。',
      },
      {
        q: '一位使用者在作業系統開了「減少動態效果」，反映候診看板一直有東西在滑動、看了會暈。前端該怎麼改？',
        options: [
          '在 `@media (prefers-reduced-motion: reduce)` 裡拿掉位移、縮放與清單的移動動畫，保留淡入淡出或直接切換',
          '把所有動畫的時間縮短一半，移動得快一點就不會暈',
          '在看板加一個「關閉動畫」的按鈕，預設維持原樣',
          '把 CSS 動畫改成 `element.animate()`，瀏覽器會自動依設定減少動態',
        ],
        answer: 0,
        explain: '作業系統的設定會讓 `prefers-reduced-motion: reduce` 成立，使用者不必再找網站的開關。縮短時間仍然是大範圍的移動；網站自己的開關可以額外提供，但預設要先尊重系統設定；`element.animate()` 不會自動減少動態，JavaScript 要用 `matchMedia(\'(prefers-reduced-motion: reduce)\')` 自己判斷。',
      },
    ],
  },
]

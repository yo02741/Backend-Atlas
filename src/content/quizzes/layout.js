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
]

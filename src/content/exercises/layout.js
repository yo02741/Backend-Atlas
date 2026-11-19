// 程式題：HTML 與 CSS 版面（在沙箱 iframe 裡執行，見 src/runtime/frame.js）
// html 題：使用者寫 body 的內容；css 題：使用者寫 CSS，套在題目固定的 html 上，測試可以指定 viewport（iframe 寬度）
// images-media-1 的照片是 public/exercise-media/ 的示意圖（相對網址，沙箱 iframe 以網站的網址為基準解析）
export default [
  {
    id: 'semantic-html-1', skill: 'semantic-html', kind: 'html', level: 1,
    title: '把掛號表單改成語意化 HTML',
    prompt: '這份掛號表單用 `div` 當按鈕、`placeholder` 當欄位名稱，按「清除」會送出表單。改寫成：\n\n- 整份表單放在 `main` 裡，標題是 `h1`「預約掛號」\n- 姓名、手機、病歷號三個欄位都有對應的 `label`（文字分別是「姓名」「手機」「病歷號」）；手機是 `type="tel"`，病歷號是 `type="text"` 加 `inputmode="numeric"`\n- 「看診時段」是一組 radio（上午診、下午診），包在 `fieldset` 裡，`legend` 是「看診時段」\n- 「清除」是 `type="button"`，按了不會送出表單；「送出掛號」是 `type="submit"`\n- 不用 `div`、`span` 加 `onclick` 做可以點的東西',
    starter: `<div class="form">
  <div class="title">預約掛號</div>
  <input placeholder="姓名">
  <input type="number" placeholder="手機">
  <input type="number" placeholder="病歷號">
  <div class="slot" onclick="pick('am')">上午診</div>
  <div class="slot" onclick="pick('pm')">下午診</div>
  <form>
    <button onclick="this.form.reset()">清除</button>
    <button>送出掛號</button>
  </form>
</div>
`,
    solution: `<main>
  <h1>預約掛號</h1>
  <form action="/api/appointments" method="post">
    <label for="name">姓名</label>
    <input id="name" name="name" autocomplete="name" required>

    <label for="phone">手機</label>
    <input id="phone" name="phone" type="tel" autocomplete="tel" required>

    <label for="chart-no">病歷號</label>
    <input id="chart-no" name="chartNo" type="text" inputmode="numeric" pattern="[0-9]{7}">

    <fieldset>
      <legend>看診時段</legend>
      <label><input type="radio" name="slot" value="am" required> 上午診</label>
      <label><input type="radio" name="slot" value="pm"> 下午診</label>
    </fieldset>

    <button type="button" id="reset-btn">清除</button>
    <button type="submit">送出掛號</button>
  </form>
</main>
<script>
  document.getElementById('reset-btn').addEventListener('click', (e) => e.target.form.reset())
</script>
`,
    tests: [
      { name: 'main 裡有 h1「預約掛號」', code: `assert($('main'), '找不到 main')\nassertEqual(text('main h1'), '預約掛號')` },
      { name: '三個欄位都有 label', code: "const field = (name) => $$('label').find((l) => l.textContent.trim().startsWith(name))?.control\nfor (const name of ['姓名', '手機', '病歷號']) assert(field(name), '「' + name + '」沒有用 label 對到欄位（for 對 id，或把欄位包在 label 裡）')" },
      { name: '手機用 tel，病歷號用 text 加 inputmode', code: "const field = (name) => $$('label').find((l) => l.textContent.trim().startsWith(name))?.control\nassertEqual(field('手機')?.type, 'tel', '手機的 type')\nassertEqual(field('病歷號')?.type, 'text', '病歷號的 type')\nassertEqual(field('病歷號')?.inputMode, 'numeric', '病歷號的 inputmode')" },
      { name: '看診時段用 fieldset 與 legend 包住 radio', code: "const fs = $$('fieldset').find((f) => f.querySelector('legend')?.textContent.trim() === '看診時段')\nassert(fs, '找不到 legend 是「看診時段」的 fieldset')\nassertEqual(fs.querySelectorAll('input[type=radio]').length, 2, 'fieldset 裡的 radio 數')" },
      { name: '按「清除」不會送出表單', code: "let submits = 0\ndocument.addEventListener('submit', (e) => { submits++; e.preventDefault() }, true)\nconst btn = $$('button').find((b) => b.textContent.trim() === '清除')\nassert(btn, '找不到「清除」按鈕')\nassertEqual(btn.type, 'button', '「清除」的 type')\nbtn.click()\nawait tick()\nassertEqual(submits, 0, '按「清除」觸發的 submit 次數')" },
      { name: '只有「送出掛號」是送出鈕，不用 div 當按鈕', code: "const submitBtns = $$('form button, form input[type=submit]').filter((b) => b.type === 'submit')\nassertEqual(submitBtns.map((b) => b.textContent.trim()), ['送出掛號'])\nassertEqual($$('div[onclick], span[onclick]').length, 0, '有 onclick 的 div 或 span 數')" },
    ],
    hints: ['`label` 的 `for` 要對到欄位的 `id`；或者把欄位整個包在 `label` 裡。', '`form` 裡沒寫 `type` 的 `button` 預設是 `submit`。'],
  },
  {
    id: 'flexbox-1', skill: 'flexbox', kind: 'css', level: 1,
    title: '看板頂端列：搜尋框不把按鈕擠出畫面',
    prompt: '門診看板的頂端列 `.board-header` 有院區名稱 `.site`、搜尋框與「重新整理」按鈕。現在的 CSS 在 390px 時把按鈕擠出畫面。改寫 CSS（HTML 不能改）：\n\n- 三者橫排，垂直置中，間距 12px\n- 搜尋框吃掉剩下的空間，畫面窄時由它變窄\n- 院區名稱與「重新整理」維持文字的寬度，不換行、不被壓縮\n- 390px 時頁面不能左右捲動',
    html: `<header class="board-header">
  <span class="site">總院區（第二門診大樓）</span>
  <input type="search" placeholder="搜尋診間或醫師" aria-label="搜尋診間或醫師">
  <button type="button">重新整理</button>
</header>`,
    css: `body { margin: 0; font: 16px/1.5 system-ui, sans-serif; }
.board-header { padding: 8px 12px; border-bottom: 2px solid #222; }
.site { font-weight: 700; white-space: nowrap; }
input, button { font: inherit; padding: 6px 10px; }`,
    starter: `.board-header {
  display: flex;
}

.board-header input {
  width: 100%;
}
`,
    solution: `.board-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.board-header input {
  flex: 1;        /* 吃掉剩下的空間 */
  min-width: 0;   /* 預設不會縮到比內容窄，要明說可以縮 */
}

.board-header button {
  flex: none;     /* 維持文字的寬度 */
}
`,
    tests: [
      { name: '390px：「重新整理」在畫面裡，頁面不用左右捲動', viewport: 390, code: "const btn = box('button')\nassert(btn.right <= innerWidth, '「重新整理」的右邊在 ' + Math.round(btn.right) + 'px，畫面只有 ' + innerWidth + 'px')\nassert(document.documentElement.scrollWidth <= innerWidth, '頁面出現橫向捲軸')" },
      { name: '390px：院區名稱與按鈕的文字不被壓縮', viewport: 390, code: "const site = $('.site')\nassert(site.scrollWidth <= site.clientWidth + 1, '院區名稱被壓得比文字窄')\nconst r = document.createRange()\nr.selectNodeContents($('button'))\nassertEqual(r.getClientRects().length, 1, '「重新整理」的行數')" },
      { name: '1280px：搜尋框吃掉剩下的空間', viewport: 1280, code: "const header = box('.board-header'), input = box('input')\nassert(input.width > header.width / 2, '搜尋框只有 ' + Math.round(input.width) + 'px 寬')" },
      { name: '三者垂直置中，間距 12px', viewport: 1280, code: "const r = document.createRange()\nr.selectNodeContents($('.site'))\nconst text = r.getBoundingClientRect(), input = box('input'), btn = box('button')\nconst mid = (b) => b.top + b.height / 2\nassert(Math.abs(mid(text) - mid(btn)) < 1.5 && Math.abs(mid(input) - mid(btn)) < 1.5, '院區名稱、搜尋框、按鈕沒有垂直置中')\nassertEqual(Math.round(input.left - box('.site').right), 12, '院區名稱與搜尋框的間距')\nassertEqual(Math.round(btn.left - input.right), 12, '搜尋框與按鈕的間距')" },
    ],
    hints: ['flex 子項預設 `min-width: auto`，不會縮到比內容窄；要讓搜尋框縮，給它 `min-width: 0`。', '`flex: 1` 讓搜尋框分走剩下的空間；`flex: none` 讓按鈕不伸也不縮。'],
  },
  {
    id: 'flexbox-2', skill: 'flexbox', kind: 'css', level: 2,
    title: '診間卡片列：放不下就換行',
    prompt: '診間卡片 `.room` 放在 `.rooms` 裡。現在卡片寫死 300px 寬、不會換行，窄螢幕時被壓成細長條。改寫 CSS（HTML 不能改）：\n\n- 卡片的起始寬度 240px，同一行有多的空間就平分，放不下就換到下一行\n- 卡片之間（左右與上下）都留 16px\n- 同一行的卡片等高\n- 390px 時一張一行、寬度填滿，頁面不能左右捲動',
    html: `<section class="rooms">
  <article class="room"><h3>101 診</h3><p>家醫科　林醫師</p><p>候診 3 人</p></article>
  <article class="room"><h3>102 診</h3><p>小兒科　張醫師（含疫苗注射，請先到二樓護理站報到）</p><p>候診 8 人</p></article>
  <article class="room"><h3>103 診</h3><p>眼科　陳醫師</p><p>候診 1 人</p></article>
  <article class="room"><h3>104 診</h3><p>皮膚科　李醫師</p><p>候診 5 人</p></article>
  <article class="room"><h3>105 診</h3><p>耳鼻喉科　王醫師</p><p>候診 2 人</p></article>
</section>`,
    css: `body { margin: 0; font: 16px/1.5 system-ui, sans-serif; }
.rooms { padding: 16px; }
.room { border: 2px solid #222; border-radius: 8px; padding: 12px; }
.room h3, .room p { margin: 0; }`,
    starter: `.rooms {
  display: flex;
}

.room {
  width: 300px;
}
`,
    solution: `.rooms {
  display: flex;
  flex-wrap: wrap;   /* 放不下就換行 */
  gap: 16px;         /* 左右與上下的間距 */
}

.room {
  flex: 1 1 240px;   /* 起始 240px，有多的空間就平分 */
}
`,
    tests: [
      { name: '1280px：放得下就並排，放不下換行', viewport: 1280, code: "const tops = $$('.room').map((c) => Math.round(box(c).top))\nassert(tops.slice(0, 4).every((t) => t === tops[0]), '前四張應該在同一行（top：' + tops.join(', ') + '）')\nassert(tops[4] > tops[0], '第五張放不下，應該換到下一行')" },
      { name: '1280px：同一行的卡片等高、間距 16px', viewport: 1280, code: "const c = $$('.room').slice(0, 4).map(box)\nassert(c.every((b) => Math.round(b.height) === Math.round(c[0].height)), '同一行的卡片高度不同：' + c.map((b) => Math.round(b.height)).join(', '))\nassertEqual(Math.round(c[1].left - c[0].right), 16, '左右間距')" },
      { name: '390px：一張一行、寬度填滿，上下間距 16px', viewport: 390, code: "const c = $$('.room').map(box)\nconst inner = $('.rooms').clientWidth - parseFloat(css('.rooms', 'padding-left')) - parseFloat(css('.rooms', 'padding-right'))\nc.forEach((b, i) => assert(Math.abs(b.width - inner) < 1, '第 ' + (i + 1) + ' 張寬 ' + Math.round(b.width) + 'px，應該填滿 ' + inner + 'px'))\nassertEqual(Math.round(c[1].top - c[0].bottom), 16, '上下間距')\nassert(document.documentElement.scrollWidth <= innerWidth, '頁面出現橫向捲軸')" },
    ],
    hints: ['`flex-wrap: wrap` 讓放不下的子項換行。', '`flex: 1 1 240px` 是 grow、shrink、basis：從 240px 開始，有多的空間就長大。', '`gap` 同時設定左右與上下的間距，不用 margin。'],
  },
  {
    id: 'rwd-1', skill: 'rwd', kind: 'css', level: 2,
    title: '今日門診頁：mobile-first 的斷點',
    prompt: '「今日門診」頁只為桌機寫過 CSS：卡片永遠三欄，圖片與表格在手機上撐出橫向捲軸。改成 mobile-first（HTML 不能改）：\n\n- 預設（390px）卡片一欄；`@media (min-width: 768px)` 起兩欄；`@media (min-width: 1280px)` 起三欄。斷點只往寬的方向加：用 `min-width`，或範圍語法 `(width >= 768px)`，不用 `max-width`\n- 橫幅圖片 `.banner` 不超出畫面，等比例縮小\n- 表格維持原本的寬度，在 `.table-wrap` 裡左右捲動，頁面本身不能左右捲動',
    html: `<main class="page">
  <h1>今日門診</h1>
  <img class="banner" alt="院區外觀" width="1200" height="200" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1200' height='200'%3E%3Crect width='1200' height='200' fill='%23cfe0f5'/%3E%3C/svg%3E">
  <section class="cards">
    <article class="card">101 診　家醫科</article>
    <article class="card">102 診　小兒科</article>
    <article class="card">103 診　眼科</article>
    <article class="card">104 診　皮膚科</article>
    <article class="card">105 診　耳鼻喉科</article>
    <article class="card">106 診　復健科</article>
  </section>
  <div class="table-wrap">
    <table class="schedule">
      <tr><th>診間</th><th>醫師</th><th>時段</th><th>已掛號</th><th>候診人數</th></tr>
      <tr><td>101</td><td>林醫師</td><td>上午</td><td>18</td><td>3</td></tr>
      <tr><td>102</td><td>張醫師</td><td>上午</td><td>30</td><td>8</td></tr>
    </table>
  </div>
</main>`,
    css: `body { margin: 0; font: 16px/1.5 system-ui, sans-serif; }
.page { padding: 16px; }
.cards { display: grid; gap: 16px; margin: 16px 0; }
.card { border: 2px solid #222; border-radius: 8px; padding: 12px; }
.schedule { width: 960px; border-collapse: collapse; }
.schedule th, .schedule td { border: 1px solid #999; padding: 4px 8px; text-align: left; }`,
    starter: `.cards {
  grid-template-columns: repeat(3, 1fr);
}
`,
    solution: `/* 預設是手機：一欄 */
.cards {
  grid-template-columns: 1fr;
}

.banner {
  max-width: 100%;
  height: auto;       /* 寬度縮小時高度跟著等比例縮 */
}

.table-wrap {
  overflow-x: auto;   /* 表格在自己的容器裡捲動 */
}

@media (min-width: 768px) {
  .cards { grid-template-columns: repeat(2, 1fr); }
}

@media (min-width: 1280px) {
  .cards { grid-template-columns: repeat(3, 1fr); }
}
`,
    tests: [
      { name: '390px：卡片一欄', viewport: 390, code: "const c = $$('.card').map(box)\nassert(c.every((b, i) => Math.round(b.left) === Math.round(c[0].left) && (!i || b.top > c[i - 1].top)), '390px 時卡片應該排成一欄')" },
      { name: '768px：卡片兩欄', viewport: 768, code: "const tops = $$('.card').map((x) => Math.round(box(x).top))\nassert(tops[0] === tops[1] && tops[2] > tops[1], '768px 時應該兩張一列（top：' + tops.join(', ') + '）')" },
      { name: '1280px：卡片三欄', viewport: 1280, code: "const tops = $$('.card').map((x) => Math.round(box(x).top))\nassert(tops[0] === tops[1] && tops[1] === tops[2] && tops[3] > tops[2], '1280px 時應該三張一列（top：' + tops.join(', ') + '）')" },
      { name: '390px：圖片等比例縮小，頁面不用左右捲動', viewport: 390, code: "const img = box('.banner')\nassert(img.right <= innerWidth, '圖片超出畫面（右邊在 ' + Math.round(img.right) + 'px）')\nassert(Math.abs(img.height / img.width - 200 / 1200) < 0.01, '圖片被壓扁或拉長了：要等比例縮小')\nassert(document.documentElement.scrollWidth <= innerWidth, '頁面出現橫向捲軸（寬 ' + document.documentElement.scrollWidth + 'px）')" },
      { name: '390px：表格在自己的容器裡捲動', viewport: 390, code: "const wrap = $('.table-wrap')\nassert(['auto', 'scroll'].includes(css('.table-wrap', 'overflow-x')), '.table-wrap 要能左右捲動')\nassert(wrap.scrollWidth > wrap.clientWidth, '表格要維持原本的寬度，在容器裡捲動')\nassert(box('.table-wrap').right <= innerWidth, '.table-wrap 超出畫面')" },
      { name: '斷點只往寬的方向加（mobile-first）', code: "const media = [...document.styleSheets].flatMap((s) => [...s.cssRules]).filter((r) => r.media).map((r) => r.media.mediaText)\nassert(media.some((t) => /min-width|width\\s*>|<=?\\s*width/.test(t)), '找不到 min-width（或 width >= …）的 media query')\nassert(!media.some((t) => /max-width|width\\s*<|>=?\\s*width/.test(t)), 'mobile-first 只往寬的方向加規則，不用 max-width（或 width <= …）')" },
    ],
    hints: ['先寫手機（沒有 media query 的部分），再用 `@media (min-width: …)` 往寬的螢幕加規則。', '圖片寫了 `width`、`height` 屬性時，`max-width: 100%` 要搭配 `height: auto` 才會等比例。', '寬表格包一層 `overflow-x: auto` 的容器。'],
  },
  {
    id: 'box-model-1', skill: 'box-model', kind: 'css', level: 1,
    title: '掛號卡片：border-box、跑出去的 margin 與不跳動的選取框',
    prompt: '掛號清單的卡片在 390px 寬時比清單還寬，頁面出現橫向捲軸；標題貼著卡片上緣，空白跑到卡片外面；備註寫死高度，內容少的也撐成一大塊；選取時改粗 border，整列跟著跳。改寫 CSS（HTML 不能改）：\n\n- 全站 `box-sizing: border-box`：390px 時卡片的寬度等於清單扣掉左右 16px padding 的寬度，頁面不能左右捲動\n- 卡片四周的內距都是 16px，標題 `margin-top: 0`：標題上緣距離卡片上緣 16px\n- 卡片之間的 12px 由清單的 `gap` 負責，卡片本身不設 margin\n- 姓名 `.patient` 一行放不下時顯示省略號\n- 備註 `.note` 最高 120px，超出時才在卡片內出現捲軸（`overflow-y: auto`）；內容少的備註維持內容的高度\n- 選取狀態 `.is-selected` 用 `outline: 2px solid` 加 `outline-offset: 2px`，加上或拿掉這個 class 時卡片大小不變',
    html: `<ul class="appointment-list">
  <li class="appointment-card">
    <h3>09:30　家醫科 101 診</h3>
    <p class="patient">王小明（病歷號 0012345）</p>
    <p class="note">需要輪椅。</p>
  </li>
  <li class="appointment-card is-selected">
    <h3>10:00　小兒科 102 診</h3>
    <p class="patient">陳美華（陪同家長：陳志豪、林佩君；病歷號 0034567）</p>
    <p class="note">對盤尼西林過敏。上次就診時體溫 38.5 度，醫師建議若持續發燒超過三天要回診；家長希望安排上午第一個號碼，方便之後送孩子上學。報到時請先量體重與身高，並確認疫苗接種紀錄卡已帶來。若需要開立診斷證明，請在批價前告知櫃台。</p>
  </li>
  <li class="appointment-card">
    <h3>10:30　眼科 305 診</h3>
    <p class="patient">林志明（病歷號 0045678）</p>
    <p class="note">複診，帶上次的驗光單。</p>
  </li>
</ul>`,
    css: `body { margin: 0; font: 16px/1.5 system-ui, sans-serif; }
.appointment-card h3 { font-size: 18px; line-height: 1.4; }
.appointment-card p { margin: 0; }`,
    starter: `.appointment-list {
  padding: 0 16px;
  list-style: none;
}

.appointment-card {
  width: 100%;
  padding: 0 16px 16px;
  margin-bottom: 12px;
  background: #fff;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.2);
}

.appointment-card h3 {
  margin-top: 20px;
}

.appointment-card .patient {
  white-space: nowrap;
  text-overflow: ellipsis;
}

.appointment-card .note {
  height: 120px;
  overflow: scroll;
}

.appointment-card.is-selected {
  border: 2px solid #2563eb;
}
`,
    solution: `/* reset：width 包含 padding 與 border */
*, *::before, *::after { box-sizing: border-box; }

/* 間距交給清單的 gap，卡片自己不加 margin */
.appointment-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0 16px;
  list-style: none;
}

.appointment-card {
  width: 100%;
  padding: 16px;                /* 標題和卡片上緣的距離由 padding 決定 */
  background: #fff;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.2);
}

.appointment-card h3 {
  margin: 0 0 4px;
}

/* 省略號：三個屬性要一起寫 */
.appointment-card .patient {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 最高 120px，超出時才有捲軸 */
.appointment-card .note {
  max-height: 120px;
  overflow-y: auto;
}

/* outline 不佔空間，切換選取時版面不跳 */
.appointment-card.is-selected {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}
`,
    tests: [
      { name: '390px：卡片不比清單寬，頁面不能左右捲動', viewport: 390, code: "const list = $('.appointment-list')\nconst inner = list.clientWidth - parseFloat(css(list, 'padding-left')) - parseFloat(css(list, 'padding-right'))\n$$('.appointment-card').forEach((c, i) => assert(Math.abs(box(c).width - inner) < 0.5, '第 ' + (i + 1) + ' 張卡片寬 ' + Math.round(box(c).width) + 'px，清單裡可用的寬度是 ' + Math.round(inner) + 'px'))\nassert(document.documentElement.scrollWidth <= innerWidth, '頁面出現橫向捲軸（寬 ' + document.documentElement.scrollWidth + 'px）')" },
      { name: '標題上緣距離卡片上緣 16px', viewport: 390, code: "$$('.appointment-card').forEach((c, i) => assertEqual(Math.round(box(c.querySelector('h3')).top - box(c).top), 16, '第 ' + (i + 1) + ' 張卡片：標題上緣到卡片上緣的距離（px）'))" },
      { name: '卡片間距 12px，卡片本身沒有 margin', viewport: 390, code: "const c = $$('.appointment-card')\nfor (let i = 1; i < c.length; i++) assertEqual(Math.round(box(c[i]).top - box(c[i - 1]).bottom), 12, '第 ' + i + '、' + (i + 1) + ' 張卡片的間距')\nc.forEach((x, i) => assertEqual([css(x, 'margin-top'), css(x, 'margin-bottom')], ['0px', '0px'], '第 ' + (i + 1) + ' 張卡片的上下 margin'))\nassertEqual(css('.appointment-list', 'row-gap'), '12px', '清單的 gap')" },
      { name: '姓名放不下時顯示省略號', viewport: 390, code: "const p = $$('.patient')[1]\nassertEqual(css(p, 'text-overflow'), 'ellipsis', 'text-overflow')\nassert(['hidden', 'clip'].includes(css(p, 'overflow-x')), '只寫 text-overflow 沒有省略號，還要 overflow: hidden（現在是 ' + css(p, 'overflow-x') + '）')\nassert(p.scrollWidth > p.clientWidth, '姓名要維持一行（white-space: nowrap），放不下的部分才變成省略號')\nassert(box(p).right <= box(p.closest('.appointment-card')).right, '姓名超出卡片')" },
      { name: '備註最高 120px，超出才捲動', viewport: 390, code: "const [short, long, short2] = $$('.note')\nassert(box(long).height <= 120.5, '長的備註高 ' + Math.round(box(long).height) + 'px，最高 120px')\nassert(long.scrollHeight > long.clientHeight, '長的備註要在卡片內捲動')\nassertEqual(css(long, 'overflow-y'), 'auto', '備註的 overflow-y（scroll 在內容少時也會有捲軸）')\nfor (const n of [short, short2]) assert(box(n).height < 60, '內容少的備註高 ' + Math.round(box(n).height) + 'px：不要寫死 height，用 max-height')" },
      { name: '選取狀態用 outline，卡片大小不變', viewport: 390, code: "const c = $('.appointment-card.is-selected')\nassertEqual([css(c, 'outline-style'), css(c, 'outline-width'), css(c, 'outline-offset')], ['solid', '2px', '2px'], '選取時的 outline')\nconst a = box(c), next = box(c.nextElementSibling).top\nc.classList.remove('is-selected')\nconst b = box(c), next2 = box(c.nextElementSibling).top\nc.classList.add('is-selected')\nassertEqual([Math.round(a.width), Math.round(a.height), Math.round(next)], [Math.round(b.width), Math.round(b.height), Math.round(next2)], '選取時的 [寬, 高, 下一張的 top]（和沒選取時比）')" },
    ],
    hints: ['`*, *::before, *::after { box-sizing: border-box; }` 讓 `width` 包含 padding 與 border。', '卡片沒有 padding-top 時，標題的 `margin-top` 會和卡片合併、跑到卡片外面。改用卡片的 padding，標題 margin-top 設 0。', '`text-overflow: ellipsis` 要搭配 `white-space: nowrap` 與 `overflow: hidden`；備註用 `max-height` 加 `overflow-y: auto`。'],
  },
  {
    id: 'css-cascade-1', skill: 'css-cascade', kind: 'css', level: 2,
    title: '用 @layer 蓋過元件庫，拿掉 !important',
    prompt: '門診看板用了元件庫，「過號」卡片的標題要變灰。AI 先加了 `!important`，按鈕再用 ID 選擇器硬贏過去；按鈕的字型也和頁面不一樣。改寫 CSS（HTML 不能改）：\n\n- 開頭宣告 `@layer reset, vendor, components;`。元件庫的兩條規則原封不動放進 `@layer vendor { … }`（實際專案寫成 `@import url("ui-kit.css") layer(vendor);`，Vite 建置後就是這個樣子）\n- 過號卡片 `.is-missed` 的標題 `#9ca3af`、按鈕底色 `#6b7280`，兩條規則放在 `@layer components`，選擇器只用 class：不用 ID、不用 `!important`\n- 按鈕的字型跟著 `body`：在 `@layer reset` 寫 `button { font: inherit; }`\n- 一般卡片維持元件庫的顏色；`body` 的規則留在層外',
    html: `<main id="board" class="ui-theme board">
  <article class="ui-card">
    <header class="ui-card__header"><h2 class="ui-card__title">101 診 · 林醫師</h2></header>
    <p>看診中 12 號</p>
    <button type="button" class="ui-button">叫下一號</button>
  </article>
  <article class="ui-card is-missed">
    <header class="ui-card__header"><h2 class="ui-card__title">102 診 · 張醫師</h2></header>
    <p>8 號過號</p>
    <button type="button" class="ui-button">重新報到</button>
  </article>
</main>`,
    css: `.board { display: grid; gap: 12px; padding: 16px; }
.ui-card { border: 2px solid #222; border-radius: 8px; padding: 12px; }`,
    starter: `/* ── ui-kit.css（元件庫）：這兩條規則的內容不能改 ── */
.ui-theme .ui-card .ui-card__header .ui-card__title { color: #1f2937; font-size: 20px; margin: 0 0 4px; }
.ui-theme .ui-card .ui-button { background: #2563eb; color: #fff; border: 0; border-radius: 6px; padding: 6px 12px; }

/* ── 門診系統的樣式 ── */
body { margin: 0; font-family: Georgia, serif; font-size: 18px; color: #1f2937; line-height: 1.6; }

.is-missed .ui-card__title { color: #9ca3af !important; }
#board .is-missed .ui-button { background: #6b7280; }
`,
    solution: `/* 層的順序：越後面越強，和選擇器權重無關；沒放進層的樣式勝過所有層 */
@layer reset, vendor, components;

@layer reset {
  button { font: inherit; }   /* 瀏覽器替 button 設了自己的字型，不會繼承 body */
}

/* ui-kit.css（元件庫）：規則不變，整段放進 vendor 層 */
@layer vendor {
  .ui-theme .ui-card .ui-card__header .ui-card__title { color: #1f2937; font-size: 20px; margin: 0 0 4px; }
  .ui-theme .ui-card .ui-button { background: #2563eb; color: #fff; border: 0; border-radius: 6px; padding: 6px 12px; }
}

/* 字型、顏色、行高只在 body 設定，元件靠繼承 */
body { margin: 0; font-family: Georgia, serif; font-size: 18px; color: #1f2937; line-height: 1.6; }

/* (0,2,0) 輸給元件庫的 (0,4,0)，但 components 層排在 vendor 後面，先比層就贏了 */
@layer components {
  .is-missed .ui-card__title { color: #9ca3af; }
  .is-missed .ui-button { background: #6b7280; }
}
`,
    tests: [
      { name: '過號卡片：標題灰色、按鈕灰底', code: "assertEqual(css('.is-missed .ui-card__title', 'color'), 'rgb(156, 163, 175)', '過號卡片標題的顏色')\nassertEqual(css('.is-missed .ui-button', 'background-color'), 'rgb(107, 114, 128)', '過號卡片按鈕的底色')" },
      { name: '一般卡片維持元件庫的樣式', code: "const card = $('.ui-card:not(.is-missed)')\nassertEqual(css(card.querySelector('.ui-card__title'), 'color'), 'rgb(31, 41, 55)', '一般卡片標題的顏色')\nassertEqual(css(card.querySelector('.ui-card__title'), 'font-size'), '20px', '標題的字級')\nassertEqual(css(card.querySelector('.ui-button'), 'background-color'), 'rgb(37, 99, 235)', '一般卡片按鈕的底色')" },
      { name: '按鈕的字型跟著 body', code: "assertEqual([css('.ui-button', 'font-family'), css('.ui-button', 'font-size')], [css('body', 'font-family'), css('body', 'font-size')], '按鈕的 [字型, 字級]（button 不會自動繼承 body 的字型）')" },
      { name: '沒有 !important，選擇器不用 ID', code: "const sheet = [...document.styleSheets].pop()\nconst bad = []\nconst walk = (rules) => { for (const r of rules) {\n  if (r.selectorText && r.selectorText.includes('#')) bad.push('ID 選擇器：' + r.selectorText)\n  if (r.style) for (const p of r.style) if (r.style.getPropertyPriority(p) === 'important') bad.push('!important：' + (r.selectorText || '') + ' { ' + p + ' }')\n  if (r.cssRules) walk(r.cssRules)\n} }\nwalk(sheet.cssRules)\nassert(!bad.length, bad.join('\\n'))" },
      { name: '元件庫在 vendor 層，過號的規則在 components 層', code: "const sheet = [...document.styleSheets].pop()\nconst stmt = [...sheet.cssRules].find((r) => r.nameList)\nassert(stmt, '找不到 @layer reset, vendor, components; 的宣告')\nconst order = [...stmt.nameList]\nassert(order.indexOf('reset') >= 0 && order.indexOf('reset') < order.indexOf('vendor') && order.indexOf('vendor') < order.indexOf('components'), '層的順序要是 reset、vendor、components（現在是 ' + order.join(', ') + '）')\nconst inLayer = (name) => [...sheet.cssRules].filter((r) => r.cssRules && r.name === name).flatMap((r) => [...r.cssRules].map((x) => x.selectorText))\nfor (const sel of ['.ui-theme .ui-card .ui-card__header .ui-card__title', '.ui-theme .ui-card .ui-button']) assert(inLayer('vendor').includes(sel), '元件庫的規則 ' + sel + ' 要原封不動放在 @layer vendor 裡')\nassert(inLayer('components').some((s) => s && s.includes('.is-missed')), '.is-missed 的規則要放在 @layer components 裡')\nassert(inLayer('reset').some((s) => s === 'button'), 'button { font: inherit; } 要放在 @layer reset 裡')" },
    ],
    hints: ['瀏覽器先比層、再比權重：`components` 層裡的 `.is-missed .ui-card__title` 不必比元件庫的選擇器長。', '`@layer reset, vendor, components;` 這行只宣告順序；規則寫在 `@layer vendor { … }` 這樣的區塊裡。', '`button`、`input` 的字型由瀏覽器預設樣式設定，不會繼承 `body`，reset 裡寫 `font: inherit`。'],
  },
  {
    id: 'grid-1', skill: 'grid', kind: 'css', level: 2,
    title: '今日門診：整頁版面與自動排欄的卡片牆',
    prompt: '「今日門診」頁的外層用 Grid 排側欄與主欄，卡片牆寫死四欄、列高寫死 100px。390px 的手機上側欄照樣佔 240px，主欄被擠扁、頁面左右滑；桌機上每張卡片不到 240px，長的卡片內容溢出到下一列。改寫 CSS（HTML 不能改）：\n\n- 預設（手機）單欄：`grid-template-areas: "header" "main"`，側欄 `.page-side` 不顯示；`@media (min-width: 1280px)` 起是 240px 的側欄加主欄，`"header header" "side main"`\n- 頁面左右各留 16px，欄與列的間距 16px，頁面不能左右捲動\n- 卡片牆 `.rooms`：每張卡片至少 240px，放得下幾欄就排幾欄（`repeat(auto-fill, minmax(min(240px, 100%), 1fr))`），間距 16px；最後一列的卡片和上面同寬、對齊同一組欄線\n- 停診公告 `.notice` 佔滿整列\n- 列高至少 100px，內容多的卡片長高，不溢出到下一列',
    html: `<div class="page">
  <header class="page-header">今日門診 · 總院區</header>
  <aside class="page-side">科別與時段篩選</aside>
  <main class="page-main">
    <ul class="rooms">
      <li class="room notice">骨科 203 診今日停診</li>
      <li class="room">家醫科 101 診 · 林醫師 · 看診 23 號</li>
      <li class="room">內科 102 診 · 王醫師 · 看診 8 號</li>
      <li class="room">小兒科 103 診 · 張醫師 · 看診 15 號 · 今日加開夜診，19:00 前報到；預防接種請先到二樓護理站量體溫，並帶兒童健康手冊與疫苗接種紀錄卡</li>
      <li class="room">眼科 305 診 · 陳醫師 · 看診 4 號</li>
      <li class="room">皮膚科 306 診 · 李醫師 · 看診 11 號</li>
      <li class="room">耳鼻喉科 307 診 · 吳醫師 · 看診 6 號</li>
      <li class="room">復健科 B12 · 黃醫師 · 看診 19 號</li>
    </ul>
  </main>
</div>`,
    css: `*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font: 16px/1.5 system-ui, sans-serif; }
.page-header { font-weight: 700; padding: 12px 0; }
.page-side { border: 2px solid #222; border-radius: 8px; padding: 12px; }
.room { border: 2px solid #222; border-radius: 8px; padding: 12px; }
.notice { background: #fde68a; }`,
    starter: `.page {
  display: grid;
  grid-template-columns: 240px 1fr;
  grid-template-areas:
    "header header"
    "side   main";
  gap: 16px;
  padding: 0 16px;
}
.page-header { grid-area: header; }
.page-side { grid-area: side; }
.page-main { grid-area: main; }

.rooms {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-auto-rows: 100px;
  gap: 16px;
  padding: 0;
  margin: 0;
  list-style: none;
}
`,
    solution: `/* 手機：單欄，側欄先隱藏 */
.page {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas:
    "header"
    "main";
  gap: 16px;
  padding: 0 16px;
}
.page-header { grid-area: header; }
.page-main { grid-area: main; }
.page-side { display: none; }

/* 1280px 起：左側常駐側欄 */
@media (min-width: 1280px) {
  .page {
    grid-template-columns: 240px minmax(0, 1fr);
    grid-template-areas:
      "header header"
      "side   main";
  }
  .page-side { display: block; grid-area: side; }
}

/* 卡片牆：每張至少 240px，容器比 240px 窄時縮成容器寬 */
.rooms {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(240px, 100%), 1fr));
  grid-auto-rows: minmax(100px, auto);   /* 至少 100px，內容多時長高 */
  gap: 16px;
  padding: 0;
  margin: 0;
  list-style: none;
}
.room { min-width: 0; overflow-wrap: anywhere; }
.notice { grid-column: 1 / -1; }          /* 停診公告佔滿整列 */
`,
    tests: [
      { name: '390px：單欄，不顯示側欄，頁面不能左右捲動', viewport: 390, code: "assertEqual(css('.page-side', 'display'), 'none', '390px 時側欄的 display')\nassertEqual(Math.round(box('.page-main').width), innerWidth - 32, '主欄的寬度（左右各留 16px）')\nassertEqual(Math.round(box('.page-main').left), 16, '主欄的左邊')\nassert(document.documentElement.scrollWidth <= innerWidth, '頁面出現橫向捲軸（寬 ' + document.documentElement.scrollWidth + 'px）')" },
      { name: '390px：卡片排成一欄，內容多的卡片長高', viewport: 390, code: "const rooms = $$('.room').map(box), wall = box('.rooms')\nrooms.forEach((r, i) => assert(Math.abs(r.left - wall.left) < 1 && Math.abs(r.width - wall.width) < 1, '第 ' + (i + 1) + ' 張卡片沒有佔滿一欄（寬 ' + Math.round(r.width) + 'px，卡片牆 ' + Math.round(wall.width) + 'px）'))\n$$('.room').forEach((el, i) => assert(el.scrollHeight <= el.clientHeight + 1, '第 ' + (i + 1) + ' 張卡片的內容溢出（內容 ' + el.scrollHeight + 'px，卡片 ' + el.clientHeight + 'px）：列高不要寫死'))\nfor (let i = 1; i < rooms.length; i++) assertEqual(Math.round(rooms[i].top - rooms[i - 1].bottom), 16, '第 ' + i + '、' + (i + 1) + ' 張卡片的上下間距')\nrooms.forEach((r, i) => assert(r.height >= 99.5, '第 ' + (i + 1) + ' 張卡片高 ' + Math.round(r.height) + 'px，至少 100px'))" },
      { name: '1280px：左側 240px 的側欄，頁首佔滿整列', viewport: 1280, code: "const side = box('.page-side'), main = box('.page-main'), head = box('.page-header')\nassertEqual([Math.round(side.left), Math.round(side.width)], [16, 240], '側欄的 [left, 寬]')\nassertEqual(Math.round(main.left - side.right), 16, '側欄與主欄的間距')\nassertEqual(Math.round(main.right), innerWidth - 16, '主欄的右邊')\nassertEqual(Math.round(head.width), innerWidth - 32, '頁首的寬度')\nassert(side.top >= head.bottom && main.top >= head.bottom, '側欄與主欄要在頁首下面')" },
      { name: '1280px：卡片三欄，最後一列和上面對齊', viewport: 1280, code: "const rooms = $$('.room:not(.notice)').map(box)\nconst lefts = [...new Set(rooms.map((r) => Math.round(r.left)))]\nassertEqual(lefts.length, 3, '主欄約 992px：每欄至少 240px 時的欄數（各卡片的 left：' + rooms.map((r) => Math.round(r.left)).join(', ') + '）')\nassert(rooms.every((r) => Math.abs(r.width - rooms[0].width) < 1), '卡片寬度不一致：' + rooms.map((r) => Math.round(r.width)).join(', '))\nconst last = rooms[rooms.length - 1]\nassertEqual(Math.round(last.left), Math.round(rooms[0].left), '最後一列那張卡片的 left（要對齊第一欄）')" },
      { name: '1280px：停診公告佔滿整列，內容多的卡片不溢出', viewport: 1280, code: "const n = box('.notice'), wall = box('.rooms')\nassert(Math.abs(n.width - wall.width) < 1, '停診公告寬 ' + Math.round(n.width) + 'px，要佔滿整列（' + Math.round(wall.width) + 'px）')\nassert(box('.room:not(.notice)').top >= n.bottom, '其他卡片要排在停診公告下面')\n$$('.room').forEach((el, i) => assert(el.scrollHeight <= el.clientHeight + 1, '第 ' + (i + 1) + ' 張卡片的內容溢出（內容 ' + el.scrollHeight + 'px，卡片 ' + el.clientHeight + 'px）'))" },
    ],
    hints: ['`repeat(auto-fill, minmax(240px, 1fr))` 依容器寬度決定欄數，不用 media query；每張卡片對齊同一組欄線。', '`grid-auto-rows: minmax(100px, auto)`：至少 100px，內容多時長高。', '`grid-column: 1 / -1` 從第一條欄線跨到最後一條。側欄的切換只改容器的 `grid-template-columns` 與 `grid-template-areas`。'],
  },
  {
    id: 'positioning-1', skill: 'positioning', kind: 'css', level: 2,
    title: '門診看板：徽章、黏住的頂端列與被蓋住的選單',
    prompt: '門診看板有黏在頂端的頂端列、診間卡片右上角的「過號」徽章，以及已經打開的「更多」選單 `.menu`。現在三個問題：徽章全疊在卡片清單的右上角；有人為了修手機上的橫向捲軸在 `.page` 加了 `overflow: hidden`，頂端列就不黏了；選單寫了 `z-index: 9999`，捲到頂端列底下時還是被蓋住。改寫 CSS（HTML 不能改）：\n\n- 卡片 `.room` 當徽章的定位基準，徽章在卡片右上角往內 8px；卡片右側留 72px 的 padding，標題不被徽章蓋住\n- `.page` 只裁掉橫向溢出、不變成捲動容器（`overflow-x: clip`）：390px 時頁面不能左右捲動，往下捲時頂端列黏在畫面頂端\n- 卡片捲到頂端列底下時被頂端列蓋住；打開的選單要蓋過頂端列\n\n`.rooms` 的 `transform` 是進場動畫結束時留下的值，動畫已經拿掉了。',
    html: `<div class="page">
  <header class="board-header">門診看板 · 總院區</header>
  <p class="ticker">公告：11/20 起內科 101 診改到二樓 201 診，請依指示牌前往；停車場 B2 施工，請改停 B3。</p>
  <ul class="rooms">
    <li class="room"><h3>內科 101 診 · 王醫師</h3><p>看診中 23 號</p><span class="badge">過號</span></li>
    <li class="room"><h3>眼科 305 診 · 陳醫師</h3><p>看診中 8 號</p><button type="button" class="more" aria-label="眼科 305 診的更多動作">⋯</button>
      <div class="menu"><button type="button">叫下一號</button><button type="button">取消今日門診</button></div></li>
    <li class="room"><h3>小兒科 103 診 · 張醫師</h3><p>看診中 15 號</p><span class="badge">過號</span></li>
    <li class="room"><h3>皮膚科 306 診 · 李醫師</h3><p>看診中 11 號</p></li>
    <li class="room"><h3>耳鼻喉科 307 診 · 吳醫師</h3><p>看診中 6 號</p><span class="badge">過號</span></li>
    <li class="room"><h3>復健科 B12 · 黃醫師</h3><p>看診中 19 號</p></li>
  </ul>
  <footer class="page-footer">總院區門診服務台 · 分機 1234</footer>
</div>`,
    css: `body { margin: 0; font: 16px/1.5 system-ui, sans-serif; }
.board-header { background: #fff; border-bottom: 2px solid #222; padding: 12px 16px; font-weight: 700; }
.ticker { white-space: nowrap; margin: 0; padding: 8px 16px; background: #fde68a; }
.rooms { display: grid; gap: 12px; padding: 16px; margin: 0; list-style: none; }
.room { background: #fff; border: 2px solid #222; border-radius: 8px; padding: 16px; }
.room h3, .room p { margin: 0; }
.badge { background: #b91c1c; color: #fff; border-radius: 999px; padding: 2px 8px; font-size: 14px; }
.more { position: absolute; right: 8px; bottom: 8px; }
.menu { display: grid; width: 160px; background: #fff; border: 2px solid #222; border-radius: 8px; padding: 4px; }
.page-footer { height: 1500px; padding: 16px; }`,
    starter: `.page {
  overflow: hidden;            /* 為了修手機上的橫向捲軸加的 */
}

.board-header {
  position: sticky;
  top: 0;
  z-index: 10;
}

.rooms {
  transform: translateY(0);    /* 進場動畫結束時留下的值 */
}

.room .badge {
  position: absolute;
  top: 8px;
  right: 8px;
}

.room .menu {
  position: absolute;
  top: 48px;
  right: 8px;
  z-index: 9999;
}
`,
    solution: `/* 層級集中定義，元件只引用 token */
:root {
  --z-header: 100;
  --z-menu: 200;
}

/* clip 只裁掉溢出，不變成捲動容器，sticky 照樣黏在頁面上 */
.page {
  overflow-x: clip;
}

.board-header {
  position: sticky;
  top: 0;
  z-index: var(--z-header);
}

/* .rooms 的 transform 拿掉：它建立 stacking context，裡面的 z-index 再大也只在它裡面比 */

/* 卡片當定位基準，右側留給徽章 */
.room {
  position: relative;
  padding-right: 72px;
}

.room .badge {
  position: absolute;
  top: 8px;
  right: 8px;
}

.room .menu {
  position: absolute;
  top: 48px;
  right: 8px;
  z-index: var(--z-menu);
}
`,
    tests: [
      { name: '徽章在卡片右上角往內 8px', code: "for (const b of $$('.badge')) {\n  const room = b.closest('.room'), r = box(room), bb = box(b)\n  const bw = parseFloat(css(room, 'border-top-width'))\n  assertEqual([Math.round(r.right - bw - bb.right), Math.round(bb.top - r.top - bw)], [8, 8], room.querySelector('h3').textContent + '：徽章離卡片右緣、上緣的距離（px）')\n}" },
      { name: '標題不被徽章蓋住', code: "for (const b of $$('.badge')) {\n  const h = b.closest('.room').querySelector('h3')\n  assert(box(h).right <= box(b).left, h.textContent + '：標題的範圍延伸到徽章底下，卡片右側要留 padding')\n}" },
      { name: '390px：頁面不能左右捲動，頂端列往下捲時黏在頂端', viewport: 390, code: "assert(document.documentElement.scrollWidth <= innerWidth, '頁面出現橫向捲軸（寬 ' + document.documentElement.scrollWidth + 'px）')\nscrollTo(0, 600)\nawait tick()\nassert(scrollY > 500, '頁面捲不動')\nassert(Math.abs(box('.board-header').top) < 1, '捲動 ' + scrollY + 'px 後頂端列的 top 是 ' + Math.round(box('.board-header').top) + 'px：祖先的 overflow: hidden 讓 sticky 只在它裡面黏')" },
      { name: '卡片捲到頂端列底下時被頂端列蓋住', code: "const h0 = box('.board-header')\nconst room = $$('.room')[3]\nscrollTo(0, scrollY + box(room).top - h0.height / 2)\nawait tick()\nconst h = box('.board-header')\nassert(Math.abs(h.top) < 1, '頂端列沒有黏在頂端（先修好 sticky）')\nconst hit = document.elementFromPoint(box(room).left + 20, h.top + h.height / 2 + 4)\nassert(hit && hit.closest('.board-header'), '頂端列和卡片重疊的地方，最上面的是 ' + (hit ? hit.tagName.toLowerCase() + (hit.className ? '.' + hit.className : '') : 'null') + '，應該是頂端列')" },
      { name: '打開的選單蓋過頂端列', code: "const h0 = box('.board-header')\nscrollTo(0, scrollY + box('.menu').top - h0.height / 2)\nawait tick()\nconst h = box('.board-header'), m = box('.menu')\nassert(Math.abs(h.top) < 1, '頂端列沒有黏在頂端（先修好 sticky）')\nassert(m.top < h.bottom && m.bottom > h.bottom, '選單沒有捲到和頂端列重疊的位置（選單 top ' + Math.round(m.top) + '，頂端列 bottom ' + Math.round(h.bottom) + '）')\nconst hit = document.elementFromPoint(m.left + 20, (m.top + h.bottom) / 2)\nassert(hit && hit.closest('.menu'), '選單和頂端列重疊的地方，最上面的是 ' + (hit ? hit.tagName.toLowerCase() + (hit.className ? '.' + hit.className : '') : 'null') + '：選單的 z-index 只在某個建立 stacking context 的祖先裡比')" },
    ],
    hints: ['`absolute` 從最近一個 `position` 不是 `static` 的祖先算起：卡片加 `position: relative`。`transform` 也會讓元素成為 absolute 子元素的定位基準。', '`overflow: hidden` 讓 `.page` 變成捲動容器，sticky 只在它裡面黏；只要裁掉溢出時用 `overflow-x: clip`。', '`transform` 建立 stacking context：選單的 9999 只在 `.rooms` 裡面比，跟頂端列比的是 `.rooms` 整塊。'],
  },
  {
    id: 'images-media-1', skill: 'images-media', kind: 'html', level: 2,
    title: '醫師介紹頁的照片：srcset、sizes 與先保留空間',
    prompt: '醫師介紹頁的照片都用最大的檔案、沒有 `alt`，三張都 `loading="lazy"`；科別圖示是寫死黑色的 `<img>`，暗色主題裡看不見。版面（CSS）已經寫好：390px 一欄、768px 起兩欄、1280px 起每張 320px。改寫 HTML：\n\n- 每張照片寫 `srcset`，列出 `exercise-media/doctor-480.svg 480w`、`doctor-960.svg 960w`、`doctor-1440.svg 1440w` 三個檔案（題目的三位醫師共用這組示意圖），並寫 `sizes` 描述照片在三種寬度下的顯示寬度：`sizes` 算出的寬度不能比實際顯示的窄，也不能大超過 15%\n- 寫上原圖的 `width="960" height="1280"`\n- 第一位醫師的照片在首屏：不 lazy、加 `fetchpriority="high"`；其餘照片 `loading="lazy"`\n- `alt` 寫醫師姓名與科別，例如「王醫師，內科」\n- 科別圖示的顏色跟著文字：用內嵌 `<svg>` 加 `fill="currentColor"`（或 CSS 的 `mask` 加 `background-color: currentColor`），圖示 `aria-hidden="true"`\n\n`class` 與文字不要改。',
    css: `body { margin: 0; font: 16px/1.5 system-ui, sans-serif; color: #1f2937; }
.doctors { display: grid; gap: 24px; grid-template-columns: 1fr; padding: 0 16px; margin: 0; list-style: none; }
@media (min-width: 768px) { .doctors { grid-template-columns: 1fr 1fr; } }
@media (min-width: 1280px) { .doctors { grid-template-columns: repeat(auto-fill, 320px); } }
.photo { display: block; width: 100%; height: auto; aspect-ratio: 3 / 4; object-fit: cover; object-position: top; }
.doctor h2 { margin: 8px 0 0; font-size: 18px; }
.dept { margin: 0; color: #2563eb; display: flex; align-items: center; gap: 4px; }`,
    starter: `<ul class="doctors">
  <li class="doctor">
    <img class="photo" src="exercise-media/doctor-1440.svg" loading="lazy">
    <h2>王醫師</h2>
    <p class="dept"><img src="${"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23000' d='M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z'/%3E%3C/svg%3E"}" width="16" height="16" alt="">內科</p>
  </li>
  <li class="doctor">
    <img class="photo" src="exercise-media/doctor-1440.svg" loading="lazy">
    <h2>林醫師</h2>
    <p class="dept"><img src="${"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23000' d='M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z'/%3E%3C/svg%3E"}" width="16" height="16" alt="">骨科</p>
  </li>
  <li class="doctor">
    <img class="photo" src="exercise-media/doctor-1440.svg" loading="lazy">
    <h2>陳醫師</h2>
    <p class="dept"><img src="${"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23000' d='M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z'/%3E%3C/svg%3E"}" width="16" height="16" alt="">眼科</p>
  </li>
</ul>
`,
    solution: `<!-- 每張照片的 srcset 相同；sizes 照 CSS 的版面寫：1280px 起 320px、768px 起約半個視窗、其他佔滿視窗 -->
<ul class="doctors">
  <li class="doctor">
    <!-- 第一位在首屏：不 lazy，提高優先順序 -->
    <img class="photo"
         src="exercise-media/doctor-960.svg"
         srcset="exercise-media/doctor-480.svg 480w, exercise-media/doctor-960.svg 960w, exercise-media/doctor-1440.svg 1440w"
         sizes="(min-width: 1280px) 320px, (min-width: 768px) 50vw, 100vw"
         width="960" height="1280"
         fetchpriority="high"
         alt="王醫師，內科">
    <h2>王醫師</h2>
    <p class="dept">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z"/></svg>
      內科
    </p>
  </li>
  <li class="doctor">
    <img class="photo"
         src="exercise-media/doctor-960.svg"
         srcset="exercise-media/doctor-480.svg 480w, exercise-media/doctor-960.svg 960w, exercise-media/doctor-1440.svg 1440w"
         sizes="(min-width: 1280px) 320px, (min-width: 768px) 50vw, 100vw"
         width="960" height="1280"
         loading="lazy"
         alt="林醫師，骨科">
    <h2>林醫師</h2>
    <p class="dept">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z"/></svg>
      骨科
    </p>
  </li>
  <li class="doctor">
    <img class="photo"
         src="exercise-media/doctor-960.svg"
         srcset="exercise-media/doctor-480.svg 480w, exercise-media/doctor-960.svg 960w, exercise-media/doctor-1440.svg 1440w"
         sizes="(min-width: 1280px) 320px, (min-width: 768px) 50vw, 100vw"
         width="960" height="1280"
         loading="lazy"
         alt="陳醫師，眼科">
    <h2>陳醫師</h2>
    <p class="dept">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z"/></svg>
      眼科
    </p>
  </li>
</ul>
`,
    tests: [
      { name: '每張照片都有三種寬度的 srcset', code: "for (const img of $$('.photo')) {\n  const cands = (img.getAttribute('srcset') || '').split(',').map((s) => s.trim().split(/\\s+/)).filter((c) => c[0])\n  const widths = cands.map((c) => c[1]).sort((a, b) => parseInt(a) - parseInt(b))\n  assertEqual(widths, ['480w', '960w', '1440w'], (img.alt || img.closest('.doctor').querySelector('h2').textContent) + ' 的 srcset 描述子')\n  assert(cands.every((c) => /doctor-(480|960|1440)\\.svg$/.test(c[0]) && c[0].includes(c[1].replace('w', ''))), 'srcset 的檔名和寬度要對得上：' + img.getAttribute('srcset'))\n}" },
      ...[390, 800, 1280].map((vw) => ({ name: `${vw}px：sizes 和照片的顯示寬度一致`, viewport: vw, code: "function slot(img) {\n  for (const part of (img.getAttribute('sizes') || '').split(',')) {\n    const m = part.trim().match(/^(\\(.*\\))?\\s*(\\d+(?:\\.\\d+)?)(px|vw)$/)\n    if (!m) continue\n    if (m[1] && !matchMedia(m[1]).matches) continue\n    return m[3] === 'vw' ? innerWidth * Number(m[2]) / 100 : Number(m[2])\n  }\n  return innerWidth   // 沒寫 sizes：當成 100vw\n}\nfor (const img of $$('.photo')) {\n  const want = box(img).width, got = slot(img)\n  assert(got >= want - 1, innerWidth + 'px 時照片顯示 ' + Math.round(want) + 'px，sizes 算出 ' + Math.round(got) + 'px：比實際窄，畫面會模糊')\n  assert(got <= want * 1.15, innerWidth + 'px 時照片顯示 ' + Math.round(want) + 'px，sizes 算出 ' + Math.round(got) + 'px：瀏覽器會下載比需要大的檔案' + (img.getAttribute('sizes') ? '' : '（沒寫 sizes 時當成 100vw）'))\n}" })),
      { name: '寫上原圖的 width 與 height', code: "for (const img of $$('.photo')) assertEqual([img.getAttribute('width'), img.getAttribute('height')], ['960', '1280'], '照片的 [width, height] 屬性（下載前就算得出比例，版面不跳）')" },
      { name: '首屏的照片不 lazy、提高優先順序，其餘 lazy', code: "const [first, ...rest] = $$('.photo')\nassert(first.getAttribute('loading') !== 'lazy', '第一張照片在首屏，不能 loading=\"lazy\"')\nassertEqual(first.getAttribute('fetchpriority'), 'high', '第一張照片的 fetchpriority')\nassertEqual(rest.map((i) => i.getAttribute('loading')), ['lazy', 'lazy'], '其餘照片的 loading')\nassert(!rest.some((i) => i.getAttribute('fetchpriority') === 'high'), 'fetchpriority=\"high\" 只給首屏那一張')" },
      { name: 'alt 寫醫師姓名與科別', code: "for (const li of $$('.doctor')) {\n  const img = li.querySelector('.photo'), name = li.querySelector('h2').textContent.trim(), dept = li.querySelector('.dept').textContent.trim()\n  assertEqual(img.getAttribute('alt'), name + '，' + dept, name + ' 照片的 alt')\n}" },
      { name: '科別圖示的顏色跟著文字，螢幕閱讀器跳過圖示', code: "for (const dept of $$('.dept')) {\n  const label = dept.textContent.trim()\n  assert(!dept.querySelector('img'), label + '：用 <img> 載入的 SVG，外面的 CSS 改不到它的顏色')\n  const color = getComputedStyle(dept).color\n  const svg = dept.querySelector('svg')\n  if (svg) {\n    assertEqual(svg.getAttribute('aria-hidden'), 'true', label + '：圖示的 aria-hidden')\n    const shapes = [...svg.querySelectorAll('path, circle, rect, polygon, use')]\n    assert(shapes.length, label + '：svg 裡沒有圖形')\n    for (const s of shapes) { const st = getComputedStyle(s); assert(st.fill === color || st.stroke === color, label + '：圖示的 fill 是 ' + st.fill + '，文字是 ' + color + '：用 fill=\"currentColor\"') }\n  } else {\n    const masked = [...dept.querySelectorAll('*')].map((e) => [e, getComputedStyle(e)]).concat([[dept, getComputedStyle(dept, '::before')]]).find(([, st]) => st.maskImage && st.maskImage !== 'none')\n    assert(masked, label + '：找不到內嵌的 <svg>（或用 mask 畫的圖示）')\n    assertEqual(masked[1].backgroundColor, color, label + '：mask 圖示的 background-color 要是 currentColor')\n    if (masked[0] !== dept) assertEqual(masked[0].getAttribute('aria-hidden'), 'true', label + '：圖示的 aria-hidden')\n  }\n}" },
    ],
    hints: ['`sizes` 由左往右找第一個符合的條件：`(min-width: 1280px) 320px, (min-width: 768px) 50vw, 100vw`。沒寫時當成 `100vw`，桌機上的小圖會下載最大的檔案。', '`width`、`height` 屬性寫原圖的尺寸，CSS 的 `width: 100%; height: auto` 決定實際大小。', '圖示改成內嵌 `<svg>`，`<path fill="currentColor">`，svg 加 `aria-hidden="true"`。'],
  },
]

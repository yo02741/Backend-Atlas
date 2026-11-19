// 程式題：HTML 與 CSS 版面（在沙箱 iframe 裡執行，見 src/runtime/frame.js）
// html 題：使用者寫 body 的內容；css 題：使用者寫 CSS，套在題目固定的 html 上，測試可以指定 viewport（iframe 寬度）
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
    prompt: '「今日門診」頁只為桌機寫過 CSS：卡片永遠三欄，圖片與表格在手機上撐出橫向捲軸。改成 mobile-first（HTML 不能改）：\n\n- 預設（390px）卡片一欄；`@media (min-width: 768px)` 起兩欄；`@media (min-width: 1280px)` 起三欄。斷點只用 `min-width`\n- 橫幅圖片 `.banner` 不超出畫面，等比例縮小\n- 表格維持原本的寬度，在 `.table-wrap` 裡左右捲動，頁面本身不能左右捲動',
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
      { name: '斷點只用 min-width（mobile-first）', code: "const media = [...document.styleSheets].flatMap((s) => [...s.cssRules]).filter((r) => r.media).map((r) => r.media.mediaText)\nassert(media.some((t) => t.includes('min-width')), '找不到 min-width 的 media query')\nassert(!media.some((t) => t.includes('max-width')), 'mobile-first 只往寬的方向加規則，不用 max-width')" },
    ],
    hints: ['先寫手機（沒有 media query 的部分），再用 `@media (min-width: …)` 往寬的螢幕加規則。', '圖片寫了 `width`、`height` 屬性時，`max-width: 100%` 要搭配 `height: auto` 才會等比例。', '寬表格包一層 `overflow-x: auto` 的容器。'],
  },
]

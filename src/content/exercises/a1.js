// 程式題（第三批）：前端的資安、轉場與動畫、版面模式與斷點表
// html 題寫 body 的內容；css 題的 CSS 套在題目固定的 html 上，測試可以指定 viewport（iframe 寬度）

// ── frontend-security-1：姓名、網址、備註都是使用者填的，公告是後台編輯器存的 HTML ──
const DOCTORS = [
  { id: 1, name: '林怡君', website: 'https://dr-lin.example/profile', note: '過敏：盤尼西林\n回診請帶藥袋' },
  { id: 2, name: '王<b>大明</b>', website: 'javascript:window.__xss = (window.__xss || 0) + 1', note: '<img src="data:," onerror="window.__xss = (window.__xss || 0) + 1">' },
  { id: 3, name: '陳美華', website: '  JavaScript:window.__xss = 1', note: '<script>window.__xss = 1</script>週三下午不看診' },
  { id: 4, name: '張雅婷', website: 'data:text/html,<script>alert(1)</script>', note: '血壓 < 140 & 心跳正常' },
  { id: 5, name: '黃志明', website: 'http://dr-huang.example', note: '' },
]
const NOTICE = '本週<strong>六</strong>停診<img src="data:," onerror="window.__xss = (window.__xss || 0) + 1">'
// 放進 <script> 的資料：</script> 要寫成 <\/script>，否則 HTML 解析器在字串中間就結束 script
const dataJs = `const notice = ${JSON.stringify(NOTICE)}
  const doctors = [
${DOCTORS.map((d) => `    ${JSON.stringify(d)},`).join('\n')}
  ]`.replaceAll('</script>', '<\\/script>')
const D = JSON.stringify(DOCTORS)

// ── css-motion-1：把 prefers-reduced-motion 的條件換成一定成立或一定不成立，重組所有樣式表後讀計算後的樣式 ──
// 支援頂層的 @media、包在規則裡的巢狀 @media，以及 @supports、@layer 這類群組規則
const SIM = `const motionCond = (c, reduce) => c
  .replace(/\\(\\s*prefers-reduced-motion\\s*:\\s*reduce\\s*\\)/gi, reduce ? '(min-width: 0px)' : '(max-width: 0px)')
  .replace(/\\(\\s*prefers-reduced-motion\\s*:\\s*no-preference\\s*\\)/gi, reduce ? '(max-width: 0px)' : '(min-width: 0px)')
  .replace(/\\(\\s*prefers-reduced-motion\\s*\\)/gi, reduce ? '(min-width: 0px)' : '(max-width: 0px)')
const rw = (rules, reduce) => [...rules].map((r) => {
  if (r instanceof CSSMediaRule) return '@media ' + motionCond(r.media.mediaText, reduce) + ' {\\n' + rw(r.cssRules, reduce) + '\\n}'
  if (r.cssRules && r.cssRules.length) {
    const head = r instanceof CSSStyleRule ? r.selectorText : r.cssText.slice(0, r.cssText.indexOf('{'))
    return head + ' {\\n' + (r.style ? r.style.cssText : '') + '\\n' + rw(r.cssRules, reduce) + '\\n}'
  }
  return r.cssText
}).join('\\n')
// still：關掉轉場，讀到的是轉場結束後的值
const under = (reduce, fn, still = true) => {
  const sheets = [...document.styleSheets]
  const st = document.createElement('style')
  st.textContent = sheets.map((s) => rw(s.cssRules, reduce)).join('\\n') + (still ? '\\n*, *::before, *::after { transition: none !important; animation: none !important; }' : '')
  sheets.forEach((s) => { s.disabled = true })
  document.head.append(st)
  try { return fn() } finally { st.remove(); sheets.forEach((s) => { s.disabled = false }) }
}
// transform 與 translate 兩個屬性的位移加總
const shift = (el) => {
  const cs = getComputedStyle(el)
  const m = cs.transform === 'none' ? new DOMMatrix() : new DOMMatrix(cs.transform)
  const t = cs.translate === 'none' ? [0, 0] : cs.translate.split(' ').map(parseFloat)
  return [Math.round(m.m41 + (t[0] || 0)), Math.round(m.m42 + (t[1] || 0))]
}
const hidden = $('.call-toast:not(.is-visible)'), shown = $('.call-toast.is-visible')`

// ── layout-patterns-1：使用者的樣式表是最後一張 ──
const USER_RULES = `const all = (list) => [...list].flatMap((r) => [r, ...(r.cssRules ? all(r.cssRules) : [])])
const rules = all([...document.styleSheets].pop().cssRules)
const cols = (sel) => new Set($$(sel).map((e) => Math.round(box(e).left))).size
const noScrollX = () => assert(document.documentElement.scrollWidth <= innerWidth, '頁面出現橫向捲軸（寬 ' + document.documentElement.scrollWidth + 'px）')`

const ROOMS = ['101 診　家醫科　林醫師', '102 診　小兒科　張醫師', '103 診　眼科　陳醫師', '104 診　皮膚科　黃醫師', '105 診　耳鼻喉科　王醫師', '106 診　復健科　吳醫師']

export default [
  {
    id: 'frontend-security-1', skill: 'frontend-security', kind: 'html', level: 2,
    title: '醫師清單：使用者的內容只當文字，網址先檢查 scheme',
    prompt: '醫師清單的姓名、個人網站、備註都是使用者填的，公告是後台編輯器存的 HTML。起始碼把它們全部用 `innerHTML` 插進頁面：備註裡的 `<img onerror>` 會執行，`javascript:` 網址點了也會執行。資料不能改，改寫顯示的程式：\n\n- 每位醫師一個 `<li data-id="…">`，裡面有 `.name`、`.website`、`.note` 三個元素，順序照資料\n- 姓名與備註以純文字顯示：`<b>`、`<img>`、`<script>` 原樣顯示成字，不建出元素（`textContent`）；備註保留換行（`white-space: pre-line`）\n- 個人網站用 `new URL()` 解析，`protocol` 是 `https:` 才做成 `<a class="website" href="…">個人網站</a>`；其他（`javascript:`、前面有空白或大小寫混用、`data:`、`http:`、解析失敗）不做成連結，改用 `<span class="website">` 顯示原本的字串\n- 公告：瀏覽器有 `setHTML()`（Sanitizer API，2026 年 11 月只有 Chrome 146、Firefox 148 起支援，不是 Baseline）時可以用它保留粗體；沒有時只顯示文字。兩種情況下公告裡的 `<img onerror>` 都不能執行',
    starter: `<h1>醫師清單</h1>
<p id="notice"></p>
<ul id="doctors"></ul>
<script>
  ${dataJs}

  document.querySelector('#notice').innerHTML = notice
  document.querySelector('#doctors').innerHTML = doctors.map((d) => \`
    <li data-id="\${d.id}">
      <h2 class="name">\${d.name}</h2>
      <a class="website" href="\${d.website}">個人網站</a>
      <p class="note">\${d.note}</p>
    </li>\`).join('')
</script>
`,
    solution: `<h1>醫師清單</h1>
<p id="notice"></p>
<ul id="doctors"></ul>
<style>
  .note { white-space: pre-line; }   /* 保留換行，不必插 <br> */
</style>
<script>
  ${dataJs}

  // 公告：支援 Sanitizer API 時用 setHTML() 保留粗體；不支援時只取文字。
  // DOMParser 解析出的文件不執行 script、不載入圖片，onerror 沒有機會觸發
  const noticeEl = document.querySelector('#notice')
  if ('setHTML' in Element.prototype) noticeEl.setHTML(notice)
  else noticeEl.textContent = new DOMParser().parseFromString(notice, 'text/html').body.textContent

  // 只放行 https:；new URL() 會去掉前後空白、把 scheme 轉成小寫
  function safeHref(raw) {
    try {
      const url = new URL(String(raw))
      return url.protocol === 'https:' ? url.href : null
    } catch {
      return null
    }
  }

  const list = document.querySelector('#doctors')
  for (const d of doctors) {
    const li = document.createElement('li')
    li.dataset.id = d.id

    const name = document.createElement('h2')
    name.className = 'name'
    name.textContent = d.name               // 文字，不解析成 HTML

    const href = safeHref(d.website)
    const site = document.createElement(href ? 'a' : 'span')
    site.className = 'website'
    if (href) {
      site.href = href
      site.textContent = '個人網站'
    } else {
      site.textContent = d.website          // 不放行的網址只顯示成字
    }

    const note = document.createElement('p')
    note.className = 'note'
    note.textContent = d.note

    li.append(name, site, note)
    list.append(li)
  }
</script>
`,
    tests: [
      { name: '注入的程式沒有執行，頁面上沒有事件屬性與 script', code: "await wait(300)\nassertEqual(window.__xss, undefined, '注入的程式執行了（window.__xss）')\nconst bad = $$('#notice *, #doctors *').filter((e) => e.tagName === 'SCRIPT' || [...e.attributes].some((a) => /^on/i.test(a.name)))\nassertEqual(bad.map((e) => e.tagName.toLowerCase()), [], '帶事件屬性或 script 的元素')" },
      { name: '姓名與備註以純文字顯示', code: `const D = ${D}\nconst flat = (s) => String(s ?? '').replace(/\\s+/g, ' ').trim()\nassertEqual($$('#doctors li[data-id]').map((li) => li.dataset.id), D.map((d) => String(d.id)), '#doctors 裡每一列的 data-id')\nfor (const d of D) {\n  const li = $('#doctors li[data-id="' + d.id + '"]')\n  assertEqual(flat(li.querySelector('.name')?.textContent), flat(d.name), '#' + d.id + ' 的 .name')\n  assertEqual(flat(li.querySelector('.note')?.textContent), flat(d.note), '#' + d.id + ' 的 .note')\n}\nassertEqual($$('#doctors b, #doctors img, #doctors script').map((e) => e.tagName.toLowerCase()), [], '使用者內容建出的元素')` },
      { name: '備註保留換行', code: "const note = $('#doctors li[data-id=\"1\"] .note')\nassert(note, '找不到第 1 位醫師的 .note')\nassertEqual(note.innerText.split('\\n').map((s) => s.trim()).filter(Boolean), ['過敏：盤尼西林', '回診請帶藥袋'], '畫面上的兩行')" },
      { name: '只有 https 網址做成連結', code: `const D = ${D}\nfor (const d of D) {\n  const el = $('#doctors li[data-id="' + d.id + '"] .website')\n  assert(el, '#' + d.id + ' 找不到 .website')\n  if (d.website.startsWith('https:')) {\n    assertEqual(el.tagName, 'A', '#' + d.id + ' 的網址是 https，要做成連結')\n    assertEqual(el.href, d.website, '#' + d.id + ' 的 href')\n  } else {\n    assert(el.tagName !== 'A' && !el.hasAttribute('href'), '#' + d.id + ' 的網址 ' + JSON.stringify(d.website) + ' 不能做成連結')\n    assertEqual(el.textContent.trim(), d.website.trim(), '#' + d.id + ' 顯示的網址')\n  }\n}\nconst links = $$('a[href]')\nassert(links.every((a) => a.protocol === 'https:'), '頁面上有不是 https 的連結：' + links.map((a) => a.getAttribute('href')).join('、'))` },
      { name: '公告顯示文字，裡面的圖片事件不執行', code: "await wait(300)\nconst n = $('#notice')\nassert(/本週.*六.*停診/s.test(n.textContent), '公告的文字不見了：' + JSON.stringify(n.textContent))\nassertEqual($$('#notice img[onerror], #notice script').length, 0, '公告裡帶 onerror 的圖片與 script')\nassertEqual(window.__xss, undefined, '公告裡的程式執行了（window.__xss）')" },
    ],
    hints: ['純文字用 `textContent`，或用 `document.createElement` 建元素再設 `textContent`；模板字串拼出來再給 `innerHTML` 就是 HTML。', '`new URL(\'  JavaScript:x\').protocol` 是 `\'javascript:\'`；解析失敗會丟錯，包在 `try/catch` 裡。', "功能偵測寫成 `'setHTML' in Element.prototype`；沒有時用 `textContent`，或 `new DOMParser().parseFromString(html, 'text/html').body.textContent` 只取文字。"],
  },
  {
    id: 'css-motion-1', skill: 'css-motion', kind: 'css', level: 2,
    title: '叫號提示：只動 transform 與 opacity，減少動態時不滑動',
    prompt: '候診看板的叫號提示 `.call-toast` 加上 `.is-visible` 時出現。起始碼用 `right` 從畫面外滑進來、`transition: all`，舊平板上一頓一頓。改寫 CSS（HTML 不能改）：\n\n- 隱藏時（沒有 `.is-visible`）：`opacity: 0`，往右位移 24px（`transform: translateX(24px)` 或 `translate: 24px`）；`right` 維持 16px，不拿位置屬性做動畫\n- 顯示時（`.is-visible`）：`opacity: 1`，沒有位移\n- 轉場只列 `opacity` 與位移的屬性（`transform` 或 `translate`），200ms、`ease-out`，不用 `all`\n- 使用者開啟「減少動態效果」（`prefers-reduced-motion: reduce`）時沒有位移，保留淡入淡出。可以在 `@media (prefers-reduced-motion: reduce)` 裡拿掉位移，也可以只在 `@media (prefers-reduced-motion: no-preference)` 裡加上位移',
    html: `<main class="board">
  <h1>候診看板</h1>
  <p>目前叫號：內科 3 診 23 號</p>
</main>
<div class="call-toast" role="status">請 23 號到 3 診</div>
<div class="call-toast is-visible" role="status">請 24 號到 5 診</div>`,
    css: `body { margin: 0; font: 16px/1.5 system-ui, sans-serif; }
.board { padding: 16px; }
.call-toast { position: fixed; right: 16px; bottom: 16px; padding: 12px 16px; border-radius: 8px; background: #1f2937; color: #fff; }
.call-toast + .call-toast { bottom: 80px; }`,
    starter: `.call-toast {
  right: -320px;
  transition: all .4s;
}

.call-toast.is-visible {
  right: 16px;
}
`,
    solution: `.call-toast {
  opacity: 0;
  transform: translateX(24px);
  /* 只列要動的屬性；這兩個只需要重跑合成 */
  transition: opacity 200ms ease-out, transform 200ms ease-out;
}

.call-toast.is-visible {
  opacity: 1;
  transform: none;
}

@media (prefers-reduced-motion: reduce) {
  .call-toast { transform: none; }   /* 拿掉位移，保留淡入淡出 */
}
`,
    tests: [
      { name: '有 prefers-reduced-motion 的規則', code: "const all = (list) => [...list].flatMap((r) => [r, ...(r.cssRules ? all(r.cssRules) : [])])\nconst media = all([...document.styleSheets].pop().cssRules).filter((r) => r instanceof CSSMediaRule).map((r) => r.media.mediaText)\nassert(media.some((t) => t.includes('prefers-reduced-motion')), '找不到 @media (prefers-reduced-motion: …) 的規則')" },
      { name: '轉場只列 opacity 與位移，200ms ease-out', code: "for (const el of $$('.call-toast')) {\n  const cs = getComputedStyle(el)\n  const list = (s) => s.split(/,(?![^(]*\\))/).map((x) => x.trim())\n  const props = list(cs.transitionProperty)\n  assert(!props.includes('all'), 'transition 不要用 all：之後任何屬性改變都會變成動畫')\n  assert(props.includes('opacity'), 'transition-property 要有 opacity（現在是 ' + props.join(', ') + '）')\n  assert(props.some((p) => p === 'transform' || p === 'translate'), 'transition-property 要有 transform 或 translate（現在是 ' + props.join(', ') + '）')\n  assertEqual(props.filter((p) => !['opacity', 'transform', 'translate'].includes(p)), [], '不該轉場的屬性')\n  assert(list(cs.transitionDuration).every((d) => d === '0.2s'), 'transition-duration 要是 200ms（現在是 ' + cs.transitionDuration + '）')\n  assert(list(cs.transitionTimingFunction).every((f) => f === 'ease-out' || f === 'cubic-bezier(0, 0, 0.58, 1)'), 'easing 要是 ease-out（現在是 ' + cs.transitionTimingFunction + '）')\n}" },
      { name: '顯示時不透明、沒有位移，right 維持 16px', code: SIM + "\nunder(false, () => {\n  assertEqual(getComputedStyle(shown).opacity, '1', '.is-visible 的 opacity')\n  assertEqual(shift(shown), [0, 0], '.is-visible 的位移 [x, y]（px）')\n  for (const el of [hidden, shown]) assertEqual(getComputedStyle(el).right, '16px', '位置不變，right 維持 16px')\n})" },
      { name: '隱藏時透明、往右位移 24px', code: SIM + "\nunder(false, () => {\n  assertEqual(getComputedStyle(hidden).opacity, '0', '隱藏時的 opacity')\n  assertEqual(shift(hidden), [24, 0], '隱藏時的位移 [x, y]（px）')\n})" },
      { name: '減少動態時沒有位移，保留淡入淡出', code: SIM + "\nunder(true, () => {\n  assertEqual(shift(hidden), [0, 0], 'prefers-reduced-motion: reduce 時隱藏狀態的位移 [x, y]（px）')\n  assertEqual([getComputedStyle(hidden).opacity, getComputedStyle(shown).opacity], ['0', '1'], 'prefers-reduced-motion: reduce 時 [隱藏, 顯示] 的 opacity')\n})\nunder(true, () => {\n  const props = getComputedStyle(hidden).transitionProperty.split(',').map((x) => x.trim())\n  assert(props.includes('opacity'), 'prefers-reduced-motion: reduce 時要保留 opacity 的轉場（現在是 ' + props.join(', ') + '）')\n}, false)" },
    ],
    hints: ['`right`、`left`、`width` 的動畫每一格都要重算版面；位移用 `transform: translateX()`。', '`transition: opacity 200ms ease-out, transform 200ms ease-out;` 只列兩個屬性。', '`@media (prefers-reduced-motion: reduce) { .call-toast { transform: none; } }` 拿掉隱藏狀態的位移，`opacity` 的轉場照樣保留。'],
  },
  {
    id: 'layout-patterns-1', skill: 'layout-patterns', kind: 'css', level: 2,
    title: '門診後台的 app shell：照斷點表排出 390、768、1280',
    prompt: '門診後台的 app shell 只為 1280px 寫過 CSS。照下面的斷點表改成 mobile-first（HTML 不能改）：\n\n| 區域 | 390（基礎樣式） | 768 起 | 1280 起 |\n|---|---|---|---|\n| 頁首 `.top` | 高 56px，`position: sticky` 黏在頂端，顯示 `.menu-btn` | 橫跨整個寬度，不顯示 `.menu-btn` | 同左 |\n| 側欄 `.side` | 不顯示（收進選單按鈕開的 Drawer） | 在頁首下方、寬 72px 的 icon rail：只顯示 `.icon`，不顯示 `.label`（連結已經有 `aria-label`） | 寬 240px，顯示 `.icon` 與 `.label` |\n| 主內容 `.main` | 左右 padding 16px | 左右 padding 24px | 同左；`.content` 最大寬 60rem，在 `.main` 裡置中 |\n| 診間卡片 `.room` | 1 欄 | 2 欄 | 3 欄 |\n| 新增掛號 `.actions` | 固定在畫面底部（sticky 或 fixed），下方 padding 加上 `env(safe-area-inset-bottom)` | 不固定，跟在主內容後面 | 同左 |\n\n另外：\n\n- 斷點用 `min-width: 768px`（48rem）與 `min-width: 1280px`（80rem），或範圍語法 `(width >= 48rem)`；不用 `max-width`\n- `.shell` 至少佔滿視窗高，用 `100dvh`，不用 `100vh`\n- `html` 的 `scroll-padding-top` 是 64px；390px 時 `scroll-padding-bottom` 是 80px，Tab 移到的欄位才不會藏在頁首或底部列底下\n- 三種寬度都不能左右捲動',
    html: `<div class="shell">
  <header class="top">
    <button type="button" class="menu-btn" aria-expanded="false" aria-controls="sidebar">選單</button>
    <span class="logo">門診後台</span>
  </header>
  <nav id="sidebar" class="side" aria-label="主要導覽">
    <a href="#today" aria-label="今日門診"><span class="icon" aria-hidden="true">今</span><span class="label">今日門診</span></a>
    <a href="#booking" aria-label="掛號管理"><span class="icon" aria-hidden="true">掛</span><span class="label">掛號管理</span></a>
    <a href="#doctors" aria-label="醫師排班"><span class="icon" aria-hidden="true">班</span><span class="label">醫師排班</span></a>
  </nav>
  <main class="main">
    <div class="content">
      <h1>今日門診</h1>
      <ul class="rooms">
${ROOMS.map((r) => `        <li class="room">${r}<br>候診 3 人</li>`).join('\n')}
      </ul>
    </div>
  </main>
  <div class="actions"><button type="button">新增掛號</button></div>
</div>`,
    css: `body { margin: 0; font: 16px/1.5 system-ui, sans-serif; }
.top { display: flex; align-items: center; gap: 12px; padding: 0 16px; box-sizing: border-box; background: #fff; border-bottom: 2px solid #222; }
.logo { font-weight: 700; }
.side { background: #f3f4f6; }
.side a { display: flex; align-items: center; gap: 8px; padding: 12px 16px; color: inherit; text-decoration: none; }
.icon { display: inline-grid; place-items: center; width: 40px; height: 40px; flex: none; border: 2px solid #222; border-radius: 8px; box-sizing: border-box; }
.rooms { list-style: none; margin: 0; padding: 0; }
.room { box-sizing: border-box; min-height: 120px; padding: 12px; border: 2px solid #222; border-radius: 8px; }
.actions { box-sizing: border-box; background: #fff; border-top: 2px solid #222; }
.actions button { font: inherit; padding: 8px 16px; }`,
    starter: `.shell {
  display: grid;
  grid-template-columns: 240px 1fr;
  height: 100vh;
}

.top {
  grid-column: 1 / -1;
  height: 56px;
}

.main {
  padding: 0 24px;
}

.rooms {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.actions {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 12px 16px;
}
`,
    solution: `html {
  scroll-padding-top: 64px;      /* 頁首 56px 加一點空隙 */
  scroll-padding-bottom: 80px;   /* 390：底部的新增掛號列 */
}

/* 390：基礎樣式，單欄 */
.shell {
  display: grid;
  min-height: 100dvh;                         /* 不用 100vh：手機工具列會蓋住底部 */
  grid-template-columns: minmax(0, 1fr);      /* minmax(0, …)：長內容不撐破 */
  grid-template-rows: auto 1fr auto;
  grid-template-areas: "top" "main" "actions";
}
.top { grid-area: top; position: sticky; top: 0; z-index: 10; height: 56px; }
.side { display: none; }
.main { grid-area: main; padding-inline: 16px; }
.rooms {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(16rem, 100%), 1fr));
  gap: 16px;
}
.actions {
  grid-area: actions;
  position: sticky;
  bottom: 0;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom));   /* 避開底部手勢區 */
}

/* 768：72px 的 icon rail */
@media (min-width: 48rem) {
  html { scroll-padding-bottom: 0; }
  .shell {
    grid-template-columns: 72px minmax(0, 1fr);
    grid-template-areas: "top top" "side main" "side actions";
  }
  .menu-btn { display: none; }
  .side { display: block; grid-area: side; }
  .side .label { display: none; }
  .main { padding-inline: 24px; }
  .actions { position: static; padding: 12px 24px; }
}

/* 1280：側欄展開，內容限寬置中 */
@media (min-width: 80rem) {
  .shell { grid-template-columns: 240px minmax(0, 1fr); }
  .side .label { display: inline; }
  .content { max-inline-size: 60rem; margin-inline: auto; }
}
`,
    tests: [
      { name: '390px：側欄收起、顯示選單按鈕、卡片一欄', viewport: 390, code: USER_RULES + "\nassertEqual(css('.side', 'display'), 'none', '390px 時側欄的 display')\nassert(css('.menu-btn', 'display') !== 'none' && box('.menu-btn').width > 0, '390px 時要顯示 .menu-btn')\nassertEqual(cols('.room'), 1, '390px 時卡片的欄數')\nassertEqual([css('.main', 'padding-left'), css('.main', 'padding-right')], ['16px', '16px'], '.main 的左右 padding')\nnoScrollX()" },
      { name: '390px：新增掛號固定在畫面底部，避開手勢區', viewport: 390, code: USER_RULES + "\nscrollTo(0, 0)\nawait tick()\nassert(['sticky', 'fixed'].includes(css('.actions', 'position')), '.actions 要固定在底部（position 是 ' + css('.actions', 'position') + '）')\nconst a = box('.actions')\nassert(Math.abs(a.bottom - innerHeight) < 1, '.actions 的下緣在 ' + Math.round(a.bottom) + 'px，要貼齊畫面底部（' + innerHeight + 'px）')\nassert(rules.some((r) => r.selectorText && r.selectorText.includes('.actions') && r.cssText.includes('safe-area-inset-bottom')), '.actions 的 padding 要加上 env(safe-area-inset-bottom)')\nassert(parseFloat(css('html', 'scroll-padding-bottom')) >= a.height, 'html 的 scroll-padding-bottom（' + css('html', 'scroll-padding-bottom') + '）要至少是底部列的高度（' + Math.round(a.height) + 'px）')" },
      { name: '頁首高 56px、捲動時黏在頂端，scroll-padding-top 讓出空間', viewport: 390, code: "assertEqual(Math.round(box('.top').height), 56, '.top 的高度')\nassert(['sticky', 'fixed'].includes(css('.top', 'position')), '.top 要黏在頂端（position 是 ' + css('.top', 'position') + '）')\nscrollTo(0, 200)\nawait tick()\nassert(scrollY > 100, '頁面捲不動：.shell 的高度被固定住了？')\nassert(Math.abs(box('.top').top) < 1, '往下捲之後 .top 沒有黏在頂端')\nassert(parseFloat(css('html', 'scroll-padding-top')) >= 56, 'html 的 scroll-padding-top 要至少 56px（現在是 ' + css('html', 'scroll-padding-top') + '）')" },
      { name: '768px：頁首下方 72px 的 icon rail', viewport: 768, code: "const s = box('.side'), t = box('.top'), m = box('.main')\nassertEqual([Math.round(s.left), Math.round(s.width)], [0, 72], '側欄的 [left, 寬]')\nassert(s.top >= t.bottom - 1, '側欄要在頁首下方')\nassertEqual(Math.round(t.width), innerWidth, '頁首要橫跨整個寬度')\nassertEqual(Math.round(m.left), 72, '.main 的 left')\nassertEqual(css('.menu-btn', 'display'), 'none', '768px 起不顯示 .menu-btn')\nassert($$('.side .icon').every((i) => box(i).width > 0), 'icon rail 要顯示 .icon')\nassert($$('.side .label').every((l) => l.getClientRects().length === 0 || box(l).width <= 1), 'icon rail 不顯示 .label')" },
      { name: '768px：卡片兩欄，新增掛號不再固定', viewport: 768, code: USER_RULES + "\nassertEqual(cols('.room'), 2, '768px 時卡片的欄數')\nassertEqual([css('.main', 'padding-left'), css('.main', 'padding-right')], ['24px', '24px'], '.main 的左右 padding')\nassert(!['sticky', 'fixed'].includes(css('.actions', 'position')), '768px 起 .actions 不固定（position 是 ' + css('.actions', 'position') + '）')\nnoScrollX()" },
      { name: '1280px：240px 側欄、卡片三欄、內容限寬置中', viewport: 1280, code: USER_RULES + "\nassertEqual(Math.round(box('.side').width), 240, '側欄的寬')\nassert($$('.side .label').every((l) => box(l).width > 1), '1280px 時要顯示 .label')\nassertEqual(cols('.room'), 3, '1280px 時卡片的欄數')\nconst main = $('.main'), mb = box(main), c = box('.content')\nconst left = c.left - (mb.left + parseFloat(css(main, 'padding-left'))), right = mb.right - parseFloat(css(main, 'padding-right')) - c.right\nassert(c.width <= 960.5, '.content 寬 ' + Math.round(c.width) + 'px，最大 60rem（960px）')\nassert(Math.abs(left - right) < 1, '.content 沒有置中（左 ' + Math.round(left) + 'px、右 ' + Math.round(right) + 'px）')\nnoScrollX()" },
      { name: 'mobile-first 的斷點，app shell 用 100dvh', code: USER_RULES + "\nconst media = rules.filter((r) => r instanceof CSSMediaRule).map((r) => r.media.mediaText)\nassert(media.length >= 2, '要有 768 與 1280 兩個斷點')\nassert(!media.some((t) => /max-width|width\\s*<|>=?\\s*width/.test(t)), 'mobile-first 只往寬的方向加規則，不用 max-width（' + media.join('；') + '）')\nconst heights = rules.filter((r) => r.selectorText && r.selectorText.includes('.shell')).flatMap((r) => ['height', 'min-height'].map((p) => r.style.getPropertyValue(p)))\nassert(!heights.some((v) => /(^|[^a-z])[\\d.]+vh/.test(v)), '.shell 的高度用了 vh：' + heights.filter(Boolean).join('、') + '；改用 100dvh')\nassert(Math.max(parseFloat(css('.shell', 'min-height')) || 0, parseFloat(css('.shell', 'height')) || 0) >= innerHeight - 1, '.shell 要至少佔滿視窗高')" },
    ],
    hints: ['基礎樣式寫 390 的樣子，再用 `@media (min-width: 48rem)`、`@media (min-width: 80rem)` 往上加。', '`grid-template-areas` 在 768 起改成 `"top top" "side main" "side actions"`，頁首就橫跨兩欄；側欄寬度由 `grid-template-columns` 的第一欄決定。', '卡片可以寫 `repeat(auto-fill, minmax(min(16rem, 100%), 1fr))`，也可以在每個斷點寫死欄數。', '底部列：`position: sticky; bottom: 0;`，padding 寫 `calc(12px + env(safe-area-inset-bottom))`。'],
  },
]

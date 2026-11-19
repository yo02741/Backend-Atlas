// 程式題：瀏覽器與網頁怎麼運作（html 題在沙箱 iframe 裡執行，js 題在 Worker）
// 圖片與樣式表用 data: URL，不向網站發出請求
const img = (w, h, fill) => `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'%3E%3Crect width='${w}' height='${h}' fill='%23${fill}'/%3E%3C/svg%3E`
const HERO = img(1200, 400, 'cfe0f5')
const DOC = img(240, 240, 'e5e7eb')
const PRINT_CSS = 'data:text/css,nav%2C.actions%7Bdisplay%3Anone%7D'

const pageBody = (head, heroAttrs, doctorAttrs) => `${head}
<nav><a href="#booking">預約掛號</a> · <a href="#doctors">醫師介紹</a></nav>
<main>
  <img class="hero" src="${HERO}"${heroAttrs} width="1200" height="400" alt="院區外觀">
  <p>目前候診 <strong id="waiting">-</strong> 人</p>
  <ol id="queue">
    <li>A001 王小明</li>
    <li>A002 陳美華</li>
    <li>A003 林志明</li>
  </ol>
  <div class="actions"><button type="button">叫下一號</button></div>
  <h2 id="doctors">醫師介紹</h2>
  <img class="doctor" src="${DOC}"${doctorAttrs} width="240" height="240" alt="王醫師，家醫科">
  <img class="doctor" src="${DOC}"${doctorAttrs} width="240" height="240" alt="林醫師，骨科">
</main>
`

// dom-events：清單、明細與搜尋表單（起始碼與解答共用的標記）
const domMarkup = (btnType) => `<form id="search">
  <label>病患姓名 <input name="keyword"></label>
  <button>搜尋</button>
  <ul id="appointments">
    <li data-id="12"><span>09:30 <strong>王小明</strong></span> <button${btnType} class="cancel">取消</button></li>
    <li data-id="13"><span>10:00 <strong>陳美華</strong></span> <button${btnType} class="cancel">取消</button></li>
    <li data-id="14"><span>10:30 <strong>林志明</strong></span> <button${btnType} class="cancel">取消</button></li>
  </ul>
</form>
<button type="button" id="add">加入候補：張雅婷</button>
<aside id="drawer" hidden>
  <h2>掛號明細</h2>
  <p id="detail"></p>
</aside>
<p id="status" role="status"></p>`

export default [
  {
    id: 'page-loading-1', skill: 'page-loading', kind: 'html', level: 2,
    title: '首頁的載入順序：行內 script、列印樣式與首屏主圖',
    prompt: '門診首頁的 HTML 有三個載入順序的問題：\n\n- 開頭的行內 `<script defer>` 要讀 `#queue` 與 `#waiting`，執行的時候這兩個元素還沒解析，Console 出現 `TypeError`。`defer` 寫在行內 script 上沒有作用。改成等 HTML 解析完再執行（`type="module"`、`DOMContentLoaded`，或把 script 移到元素後面都可以），`#waiting` 顯示清單裡的人數\n- 列印樣式（題目用 `data:` URL 代替 `/css/print.css`，內容是列印時藏起 `nav` 與 `.actions`）沒寫 `media`，螢幕上的導覽列與按鈕也不見了。保留這個 `<link>`，讓它只在列印時套用\n- 首屏主圖 `.hero` 加了 `loading="lazy"`：拿掉，改加 `fetchpriority="high"`；首屏以下的醫師照片 `.doctor` 加 `loading="lazy"`\n\n`id`、`class` 與圖片的 `src` 不要改。',
    starter: pageBody(`<!-- 列印樣式（題目用 data: URL 代替 /css/print.css）：列印時不需要導覽列與按鈕 -->
<link rel="stylesheet" href="${PRINT_CSS}">

<script defer>
  // 候診人數：數清單裡有幾位
  const waiting = document.querySelectorAll('#queue li').length
  document.querySelector('#waiting').textContent = waiting
</script>
`, ' loading="lazy"', ''),
    solution: pageBody(`<!-- 列印樣式：media="print" 照樣下載，但不擋第一個畫面，也不套到螢幕上 -->
<link rel="stylesheet" href="${PRINT_CSS}" media="print">

<!-- 行內 script 的 defer 沒有作用；type="module" 的行內 script 會等 HTML 解析完才執行 -->
<script type="module">
  const waiting = document.querySelectorAll('#queue li').length
  document.querySelector('#waiting').textContent = waiting
</script>
`, ' fetchpriority="high"', ' loading="lazy"'),
    tests: [
      { name: '候診人數在 HTML 解析完之後才算', code: "await waitFor(() => text('#waiting') !== '-')\nassertEqual(text('#waiting'), String($$('#queue li').length), '#waiting 的人數')" },
      { name: '列印樣式不套到螢幕上', code: "await waitFor(() => document.readyState === 'complete')\nassertEqual(css('nav', 'display'), 'block', '螢幕上 nav 的 display')\nassert(css('.actions', 'display') !== 'none', '螢幕上的 .actions 被藏起來了')\nconst print = $$('link[rel=stylesheet]').filter((l) => l.sheet && [...l.sheet.cssRules].some((r) => /nav/.test(r.cssText)))\nassertEqual(print.length, 1, '列印樣式的 <link> 數（要保留）')\nassertEqual(print[0].media, 'print', '列印樣式的 media')" },
      { name: '首屏主圖不 lazy、提高優先順序', code: "const hero = $('.hero')\nassert(hero.getAttribute('loading') !== 'lazy', '首屏主圖不能 loading=\"lazy\"：瀏覽器要等版面算完、確認它在畫面內才下載')\nassertEqual(hero.getAttribute('fetchpriority'), 'high', '.hero 的 fetchpriority')" },
      { name: '首屏以下的醫師照片延後載入', code: "const docs = $$('.doctor')\nassertEqual(docs.length, 2, '醫師照片數')\nassertEqual(docs.map((d) => d.getAttribute('loading')), ['lazy', 'lazy'], '醫師照片的 loading')\nassert(!docs.some((d) => d.getAttribute('fetchpriority') === 'high'), 'fetchpriority=\"high\" 只給首屏主圖')" },
    ],
    hints: ['`defer` 與 `async` 只對有 `src` 的 script 有作用。行內的 `<script type="module">` 預設就等 HTML 解析完才執行。', '`<link rel="stylesheet" media="print">` 照樣下載，只在列印時套用。', '首屏最大的那張圖不要 `loading="lazy"`；畫面下方的圖才延後。'],
  },
  {
    id: 'dom-events-1', skill: 'dom-events', kind: 'html', level: 2,
    title: '清單的事件：委派、冒泡與預設動作',
    prompt: '「我的掛號」清單放在搜尋表單裡，點一整列會打開右側的明細 `#drawer`，每一列另有「取消」按鈕。現在有四個問題：\n\n- 點列裡的姓名（`<strong>`），明細顯示 `#undefined`：監聽讀的是 `event.target.dataset.id`\n- 按「取消」，明細也跟著打開，表單還被送出\n- 按「搜尋」會照預設送出表單、換頁（沙箱攔下並在 Console 提示）\n- 按「加入候補」之後才加進清單的列，點了沒有反應\n\n改成：\n\n- 點列的任何地方都打開那一列的明細，`#detail` 顯示 `#<data-id> <姓名>`，例如 `#13 陳美華`\n- 「取消」只移除那一列，並在 `#status` 顯示「已取消 <姓名> 的掛號」；不打開明細、不送出表單\n- 「搜尋」只顯示姓名含關鍵字的列，不換頁\n- 之後才加進清單的列一樣能點、能取消\n\n`id`、`class`、`data-id` 與文字不要改。',
    starter: `${domMarkup('')}
<script type="module">
  const NAMES = { 12: '王小明', 13: '陳美華', 14: '林志明', 15: '張雅婷' }
  const list = document.querySelector('#appointments')
  const drawer = document.querySelector('#drawer')

  function openDetail(id) {
    drawer.hidden = false
    document.querySelector('#detail').textContent = \`#\${id} \${NAMES[id]}\`
  }
  function cancelAppointment(id) {
    list.querySelector(\`li[data-id="\${id}"]\`).remove()
    document.querySelector('#status').textContent = \`已取消 \${NAMES[id]} 的掛號\`
  }

  // 點整列：打開明細
  for (const li of list.querySelectorAll('li')) {
    li.addEventListener('click', (event) => openDetail(event.target.dataset.id))
  }
  // 列裡的「取消」
  for (const btn of list.querySelectorAll('.cancel')) {
    btn.addEventListener('click', () => cancelAppointment(btn.closest('li').dataset.id))
  }
  // 搜尋：只顯示姓名符合的列
  document.querySelector('#search').addEventListener('submit', (event) => {
    const keyword = event.target.keyword.value.trim()
    for (const li of list.querySelectorAll('li')) li.hidden = !li.textContent.includes(keyword)
  })
  // 候補：之後才加進清單的列
  document.querySelector('#add').addEventListener('click', () => {
    list.insertAdjacentHTML('beforeend', '<li data-id="15"><span>11:00 <strong>張雅婷</strong></span> <button class="cancel">取消</button></li>')
  }, { once: true })
</script>
`,
    solution: `${domMarkup(' type="button"')}
<script type="module">
  const NAMES = { 12: '王小明', 13: '陳美華', 14: '林志明', 15: '張雅婷' }
  const list = document.querySelector('#appointments')
  const drawer = document.querySelector('#drawer')

  function openDetail(id) {
    drawer.hidden = false
    document.querySelector('#detail').textContent = \`#\${id} \${NAMES[id]}\`
  }
  function cancelAppointment(id) {
    list.querySelector(\`li[data-id="\${id}"]\`).remove()
    document.querySelector('#status').textContent = \`已取消 \${NAMES[id]} 的掛號\`
  }

  // 事件委派：監聽掛在 ul，之後才加進來的列也處理得到
  list.addEventListener('click', (event) => {
    // target 可能是 strong 或 span：往上找到帶 data-id 的那一列
    const row = event.target.closest('li[data-id]')
    if (!row || !list.contains(row)) return
    if (event.target.closest('.cancel')) {
      cancelAppointment(row.dataset.id)   // 按鈕：只取消，不開明細（外層自己判斷，不用 stopPropagation）
      return
    }
    openDetail(row.dataset.id)
  })

  // 搜尋：取消表單送出的預設動作，改成在頁面上篩選
  document.querySelector('#search').addEventListener('submit', (event) => {
    event.preventDefault()
    const keyword = event.target.keyword.value.trim()
    for (const li of list.querySelectorAll('li')) li.hidden = !li.textContent.includes(keyword)
  })

  // 新加的「取消」也寫 type="button"：form 裡沒寫 type 的 button 會送出表單
  document.querySelector('#add').addEventListener('click', () => {
    list.insertAdjacentHTML('beforeend', '<li data-id="15"><span>11:00 <strong>張雅婷</strong></span> <button type="button" class="cancel">取消</button></li>')
  }, { once: true })
</script>
`,
    tests: [
      { name: '點列裡的姓名，明細顯示那一筆', code: "click('li[data-id=\"13\"] strong')\nawait waitFor(() => !$('#drawer').hidden)\nassertEqual(text('#detail'), '#13 陳美華', '#detail 的文字')" },
      { name: '按「取消」只取消，不打開明細、不送出表單', code: "let submits = 0\ndocument.addEventListener('submit', () => submits++, true)\nclick('li[data-id=\"12\"] .cancel')\nawait tick()\nassert(!$('li[data-id=\"12\"]'), '那一列要移除')\nassertEqual(text('#status'), '已取消 王小明 的掛號', '#status 的文字')\nassert($('#drawer').hidden, '按「取消」時明細也打開了：click 冒泡到列的監聽')\nassertEqual(submits, 0, '按「取消」觸發的 submit 次數（form 裡沒寫 type 的 button 會送出表單）')" },
      { name: '搜尋只篩選清單，不換頁', code: "let prevented = null\ndocument.addEventListener('submit', (e) => { prevented = e.defaultPrevented })\ninput('#search [name=keyword]', '陳')\nclick($$('#search button').find((b) => b.textContent.trim() === '搜尋'))\nawait tick()\nassert(prevented !== null, '按「搜尋」沒有送出表單')\nassert(prevented, '表單照預設送出會換頁：submit 監聽要呼叫 preventDefault()')\nconst shown = $$('#appointments li').filter((li) => li.getClientRects().length).map((li) => li.dataset.id)\nassertEqual(shown, ['13'], '搜尋「陳」之後顯示的列')" },
      { name: '之後加進清單的列也能點、能取消', code: "click('#add')\nawait tick()\nassert($('li[data-id=\"15\"]'), '按「加入候補」要多一列 data-id=15')\nclick('li[data-id=\"15\"] strong')\nawait tick()\nassert(!$('#drawer').hidden, '新加的列點了沒有反應：監聽只綁在一開始就有的列上')\nassertEqual(text('#detail'), '#15 張雅婷', '#detail 的文字')\n$('#drawer').hidden = true\nlet submits = 0\ndocument.addEventListener('submit', () => submits++, true)\nclick('li[data-id=\"15\"] .cancel')\nawait tick()\nassert(!$('li[data-id=\"15\"]'), '新加的列按「取消」要移除')\nassert($('#drawer').hidden, '按「取消」時明細不該打開')\nassertEqual(submits, 0, '按「取消」觸發的 submit 次數')" },
    ],
    hints: ['監聽掛在 `ul`（事件委派），用 `event.target.closest(\'li[data-id]\')` 往上找到那一列。', '在同一個監聽裡先判斷 `event.target.closest(\'.cancel\')`：是按鈕就只取消、`return`，不用 `stopPropagation()`。', '`form` 裡沒寫 `type` 的 `button` 是送出鈕：「取消」寫 `type="button"`；搜尋的 `submit` 監聽呼叫 `event.preventDefault()`。'],
  },
  {
    id: 'urls-history-1', skill: 'urls-history', kind: 'js', level: 2,
    title: '篩選條件寫進網址：編碼、預設值、push 與 replace',
    prompt: '掛號清單的網址是 `/appointments?date=2026-11-20&dept=內科&page=2`，日期、科別、頁碼都放在 query。現在的寫法手動拼字串：科別「耳鼻喉&頭頸」的 `&` 把 query 切斷，讀回來的中文還是 `%E5…`，格式不對的參數照單全收，而且每次都 `pushState`。改寫三個函式：\n\n- `toUrl({ date, dept, page })`：回傳 `/appointments?…`。科別可能含 `&`、`#`、空白與中文，要正確編碼；`dept` 是空字串時不放進網址\n- `fromUrl(href)`：`href` 可能是完整網址或 `/appointments?…` 開頭的路徑。回傳 `{ date, dept, page }`：`date` 不是 `YYYY-MM-DD` 格式時用 `TODAY`；沒有 `dept` 時是空字串；`page` 不是正整數時是 `1`，型別是數字\n- `update(history, href, change)`：把 `change` 套到 `href` 目前的條件上並更新網址。改日期或科別時用 `history.replaceState(null, \'\', url)`，頁碼回到 1；只換頁（`change` 只有 `page`）時用 `history.pushState(null, \'\', url)`',
    starter: `const TODAY = '2026-11-20'

function toUrl({ date, dept, page }) {
  return '/appointments?date=' + date + '&dept=' + dept + '&page=' + page
}

function fromUrl(href) {
  const query = href.split('?')[1] || ''
  const out = { date: TODAY, dept: '', page: 1 }
  for (const pair of query.split('&')) {
    const [key, value] = pair.split('=')
    if (key === 'date') out.date = value
    if (key === 'dept') out.dept = value
    if (key === 'page') out.page = Number(value)
  }
  return out
}

// 條件或頁碼改變時更新網址
function update(history, href, change) {
  const next = { ...fromUrl(href), ...change }
  history.pushState(null, '', toUrl(next))
}

// 試跑
const url = toUrl({ date: '2026-11-20', dept: '耳鼻喉&頭頸', page: 2 })
console.log(url)
console.log(JSON.stringify(fromUrl(url)))
console.log(JSON.stringify(fromUrl('https://clinic.example/appointments?date=2026-11-21&dept=%E5%85%A7%E7%A7%91&page=abc')))
`,
    solution: `const TODAY = '2026-11-20'

function toUrl({ date, dept, page }) {
  // URLSearchParams 負責編碼：& 變 %26、# 變 %23、空白變 +、中文變 %E5…
  const q = new URLSearchParams({ date })
  if (dept) q.set('dept', dept)
  q.set('page', String(page))
  return '/appointments?' + q
}

function fromUrl(href) {
  // 路徑沒有 origin，給一個基準網址才解析得了；searchParams.get 會解碼
  const q = new URL(href, 'https://clinic.example').searchParams
  const date = q.get('date')
  const page = Number(q.get('page'))
  return {
    date: /^\\d{4}-\\d{2}-\\d{2}$/.test(date || '') ? date : TODAY,
    dept: q.get('dept') ?? '',
    page: Number.isInteger(page) && page > 0 ? page : 1,
  }
}

function update(history, href, change) {
  const current = fromUrl(href)
  if (Object.keys(change).every((k) => k === 'page')) {
    history.pushState(null, '', toUrl({ ...current, ...change }))   // 換頁：新增一筆紀錄，上一頁回得去
  } else {
    history.replaceState(null, '', toUrl({ ...current, ...change, page: 1 }))   // 改條件：換掉目前這一筆，頁碼回到 1
  }
}

// 試跑
const url = toUrl({ date: '2026-11-20', dept: '耳鼻喉&頭頸', page: 2 })
console.log(url)
console.log(JSON.stringify(fromUrl(url)))
console.log(JSON.stringify(fromUrl('https://clinic.example/appointments?date=2026-11-21&dept=%E5%85%A7%E7%A7%91&page=abc')))
`,
    tests: [
      { name: 'toUrl 正確編碼科別', code: "for (const dept of ['耳鼻喉&頭頸', '內科 #2', '身心科']) {\n  const u = new URL(toUrl({ date: '2026-11-20', dept, page: 2 }), 'https://clinic.example')\n  assertEqual(u.pathname, '/appointments', '路徑')\n  assertEqual([u.searchParams.get('date'), u.searchParams.get('dept'), u.searchParams.get('page'), u.hash], ['2026-11-20', dept, '2', ''], '科別「' + dept + '」組出 ' + u.pathname + u.search + u.hash + '，讀回 [date, dept, page, hash]')\n}" },
      { name: 'dept 是空字串時不放進網址', code: "const u = new URL(toUrl({ date: '2026-11-20', dept: '', page: 1 }), 'https://clinic.example')\nassert(!u.searchParams.has('dept'), '網址裡不該有 dept：' + u.search)\nassertEqual(u.searchParams.get('date'), '2026-11-20')" },
      { name: 'fromUrl 解碼、轉型，完整網址與路徑都能讀', code: "assertEqual(fromUrl('https://clinic.example/appointments?date=2026-11-21&dept=%E8%80%B3%E9%BC%BB%E5%96%89%26%E9%A0%AD%E9%A0%B8&page=3'), { date: '2026-11-21', dept: '耳鼻喉&頭頸', page: 3 })\nassertEqual(fromUrl('/appointments?dept=%E5%85%A7%E7%A7%91+%E4%BA%8C%E8%A8%BA&page=2'), { date: TODAY, dept: '內科 二診', page: 2 }, 'query 裡的 + 是空白')\nconst x = { date: '2026-12-01', dept: '耳鼻喉&頭頸 #2', page: 4 }\nassertEqual(fromUrl(toUrl(x)), x, 'toUrl 組出來的網址再讀回來')" },
      { name: '不合法的參數用預設值', code: "assertEqual(fromUrl('/appointments?date=2026/11/20&page=abc'), { date: TODAY, dept: '', page: 1 }, 'date=2026/11/20、page=abc')\nassertEqual(fromUrl('/appointments?page=0').page, 1, 'page=0')\nassertEqual(fromUrl('/appointments?page=-2').page, 1, 'page=-2')\nassertEqual(fromUrl('/appointments'), { date: TODAY, dept: '', page: 1 }, '沒有 query')" },
      { name: '改科別：replaceState，頁碼回到 1', code: "const calls = []\nconst h = { pushState: (s, t, url) => calls.push(['pushState', url]), replaceState: (s, t, url) => calls.push(['replaceState', url]) }\nupdate(h, '/appointments?date=2026-11-20&dept=%E5%85%A7%E7%A7%91&page=3', { dept: '小兒科' })\nassertEqual(calls.map((c) => c[0]), ['replaceState'], '改科別呼叫的方法')\nassertEqual(fromUrl(calls[0][1]), { date: '2026-11-20', dept: '小兒科', page: 1 }, '新的網址 ' + calls[0][1] + ' 讀回來')" },
      { name: '換頁：pushState，其他條件不變', code: "const calls = []\nconst h = { pushState: (s, t, url) => calls.push(['pushState', url]), replaceState: (s, t, url) => calls.push(['replaceState', url]) }\nupdate(h, '/appointments?date=2026-11-20&dept=%E5%85%A7%E7%A7%91&page=3', { page: 4 })\nassertEqual(calls.map((c) => c[0]), ['pushState'], '換頁呼叫的方法')\nassertEqual(fromUrl(calls[0][1]), { date: '2026-11-20', dept: '內科', page: 4 }, '新的網址 ' + calls[0][1] + ' 讀回來')" },
    ],
    hints: ['組網址用 `new URLSearchParams()` 的 `set`，讀網址用 `new URL(href, 基準網址).searchParams.get()`；兩者都會處理編碼。', '日期用 `/^\\d{4}-\\d{2}-\\d{2}$/` 檢查；頁碼用 `Number()` 轉型後檢查 `Number.isInteger` 與大於 0。', '輸入中的條件用 replace，不新增紀錄；換頁用 push，上一頁才回得到前一頁。'],
  },
]

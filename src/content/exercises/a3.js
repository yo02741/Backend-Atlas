// 程式題（第三批）：元件的鍵盤操作、前端的 CI、執行時效能、AI 給的過時寫法
// 測試碼用 String.raw 寫；測試碼裡不要出現 `${` 與反引號。
const R = String.raw

// a11y-components-1 共用的小工具（測試碼前面接上）
const MENU = R`
const btn = () => $$('button').find((b) => b.textContent.trim() === '更多操作')
const menuEl = () => {
  const b = btn()
  const id = b && (b.getAttribute('aria-controls') || b.getAttribute('commandfor') || b.getAttribute('popovertarget'))
  return (id && document.getElementById(id)) || $('[role=menu]') || $('[focusgroup]')
}
const items = () => {
  const m = menuEl()
  if (!m) return []
  const own = Array.from(m.querySelectorAll('[role=menuitem]'))
  return own.length ? own : Array.from(m.querySelectorAll('button, a[href]'))
}
const shown = (el) => !!el && (el.checkVisibility ? el.checkVisibility() : el.getClientRects().length > 0)
const nameOf = (el) => (el ? el.textContent.trim() : '（沒有）')
const act = () => document.activeElement
const openByKey = async () => {
  focus(btn())
  press(btn(), 'ArrowDown')
  await tick()
}
`

// frontend-ci-1 共用的小工具：去掉註解的各行、所有 run 指令（依出現順序）
const CI = R`
const clean = source.split('\n').map((l) => l.replace(/\s+#.*$|^\s*#.*$/, '').replace(/\s+$/, ''))
const src = clean.join('\n')
const runs = []
for (const l of clean) {
  const m = l.match(/^\s*(?:-\s+)?run:\s*(.*)$/)
  if (m && m[1] && m[1] !== '|' && m[1] !== '>') runs.push(m[1].trim())
}
const firstRun = (re) => runs.findIndex((r) => re.test(r))
`

// render-performance-1：2,000 筆的資料（題目、起始碼、解答共用）
const ROWS = `const ROOMS = ['內科 101', '外科 203', '兒科 105', '家醫科 110']
// 模擬 API 回來的今日掛號：2,000 筆
const rows = Array.from({ length: 2000 }, (_, i) => {
  const no = String(i + 1).padStart(4, '0')
  return { id: i + 1, no, name: '病患 ' + no, room: ROOMS[i % ROOMS.length] }
})`

export default [
  {
    id: 'a11y-components-1', skill: 'a11y-components', kind: 'html', level: 2, serial: true,
    title: '「更多操作」選單照 APG 的 Menu Button 做',
    prompt: '預約清單每列的「更多操作」是 AI 產生的：按鈕寫了 `aria-haspopup`，但 `aria-expanded` 一直是 `false`；選單項目只能用滑鼠點，按 ↓ 沒反應、Esc 關不掉，選了項目之後焦點不知道去哪。照 WAI-ARIA APG 的 Menu Button 改：\n\n- 按鈕：`aria-haspopup="menu"`，`aria-expanded` 跟著選單開關變成 `"true"`、`"false"`\n- 選單容器 `role="menu"`、三個項目 `role="menuitem"`（「改期」「列印掛號單」「取消預約」），組內用 roving tabindex 或讓項目各自可以 `focus()`，選單整組不在 Tab 順序裡\n- 點按鈕（等同 Enter、Space）開選單並聚焦第一項，再點一次關閉；按鈕上按 ↓ 開選單聚焦第一項、按 ↑ 開選單聚焦最後一項\n- 選單裡 ↓ ↑ 移動並在頭尾繞回，Home、End 到第一項與最後一項\n- Esc 關閉選單，焦點回到按鈕\n- Enter 或點擊選了項目：先關選單、焦點回到按鈕，再在 `role="status"` 的 `#result` 寫入「已選：<項目>」\n- Tab：關閉選單，焦點照常移到下一個元素（不搶回按鈕）\n\n選單容器用 `hidden` 或 `popover` 都可以。用 `popover` 時，測試在送出合成的 Esc 之後若選單還開著，會呼叫 `hidePopover()` 模擬瀏覽器的關閉，`aria-expanded` 要在 `toggle` 事件裡跟著更新。',
    starter: `<h2>11/20 09:00 王小明</h2>
<div class="actions">
  <button type="button" id="more" aria-haspopup="menu" aria-expanded="false">更多操作</button>
  <ul id="more-menu" role="menu" hidden>
    <li role="menuitem">改期</li>
    <li role="menuitem">列印掛號單</li>
    <li role="menuitem">取消預約</li>
  </ul>
</div>
<a href="#next" id="next-link">下一筆預約</a>
<p role="status" id="result"></p>

<style>
  body { font: 16px/1.5 system-ui, sans-serif; }
  .actions { position: relative; display: inline-block; }
  [role=menu] { position: absolute; margin: 4px 0 0; padding: 4px; list-style: none; background: #fff; border: 1px solid #555; border-radius: 6px; }
  [role=menuitem] { padding: 4px 12px; cursor: pointer; }
  [role=menuitem]:hover { background: #e0e7ff; }
</style>
<script type="module">
  const btn = document.querySelector('#more')
  const menu = document.querySelector('#more-menu')
  btn.addEventListener('click', () => { menu.hidden = !menu.hidden })
  for (const li of menu.querySelectorAll('li')) {
    li.addEventListener('click', () => {
      menu.hidden = true
      document.querySelector('#result').textContent = '已選：' + li.textContent
    })
  }
</script>
`,
    solution: `<h2>11/20 09:00 王小明</h2>
<div class="actions">
  <button type="button" id="more" aria-haspopup="menu" aria-expanded="false" aria-controls="more-menu">更多操作</button>
  <ul id="more-menu" role="menu" aria-labelledby="more" hidden>
    <!-- 項目 tabindex="-1"：不在 Tab 順序裡，但可以用 focus() 聚焦 -->
    <li role="menuitem" tabindex="-1">改期</li>
    <li role="menuitem" tabindex="-1">列印掛號單</li>
    <li role="menuitem" tabindex="-1">取消預約</li>
  </ul>
</div>
<a href="#next" id="next-link">下一筆預約</a>
<p role="status" id="result"></p>

<style>
  body { font: 16px/1.5 system-ui, sans-serif; }
  .actions { position: relative; display: inline-block; }
  [role=menu] { position: absolute; margin: 4px 0 0; padding: 4px; list-style: none; background: #fff; border: 1px solid #555; border-radius: 6px; }
  [role=menuitem] { padding: 4px 12px; cursor: pointer; }
  [role=menuitem]:hover, [role=menuitem]:focus-visible { background: #e0e7ff; outline: 2px solid #1d4ed8; }
</style>
<script type="module">
  const btn = document.querySelector('#more')
  const menu = document.querySelector('#more-menu')
  const items = Array.from(menu.querySelectorAll('[role=menuitem]'))
  const result = document.querySelector('#result')

  function openMenu(index) {
    menu.hidden = false
    btn.setAttribute('aria-expanded', 'true')
    items[index].focus()
  }
  function closeMenu(restoreFocus) {
    if (menu.hidden) return
    menu.hidden = true
    btn.setAttribute('aria-expanded', 'false')
    if (restoreFocus) btn.focus()
  }
  function choose(item) {
    closeMenu(true)                                 // 先關選單、焦點回按鈕，再執行動作
    result.textContent = '已選：' + item.textContent.trim()
  }

  // Enter 與 Space 在原生 <button> 上會觸發 click，不必另外處理
  btn.addEventListener('click', () => (menu.hidden ? openMenu(0) : closeMenu(true)))
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); openMenu(0) }
    if (e.key === 'ArrowUp') { e.preventDefault(); openMenu(items.length - 1) }
  })

  menu.addEventListener('keydown', (e) => {
    const i = items.indexOf(document.activeElement)
    const n = items.length
    const moves = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: n - 1 }
    if (e.key in moves) {
      e.preventDefault()                            // 方向鍵不要捲動頁面
      items[(moves[e.key] + n) % n].focus()         // 頭尾繞回
    } else if (e.key === 'Escape') {
      closeMenu(true)
    } else if (e.key === 'Tab') {
      closeMenu(false)                              // 不 preventDefault：焦點照常往下走
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (i >= 0) choose(items[i])
    }
  })
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('[role=menuitem]')
    if (item) choose(item)
  })
  // 焦點離開選單與按鈕（例如點了別的地方）時也關閉
  menu.addEventListener('focusout', (e) => {
    if (!menu.contains(e.relatedTarget) && e.relatedTarget !== btn) closeMenu(false)
  })
</script>
`,
    tests: [
      { name: '按鈕與選單的角色和屬性', code: MENU + R`
const b = btn()
assert(b, '找不到文字是「更多操作」的 <button>')
assert(['menu', 'true'].includes(b.getAttribute('aria-haspopup')), '按鈕要有 aria-haspopup="menu"（現在是 ' + b.getAttribute('aria-haspopup') + '）')
assertEqual(b.getAttribute('aria-expanded'), 'false', '選單關著時按鈕的 aria-expanded')
const m = menuEl()
assert(m, '找不到選單容器（role="menu"，或按鈕的 aria-controls 指到的元素）')
assert(m.getAttribute('role') === 'menu' || /menu/.test(m.getAttribute('focusgroup') || '') || m.querySelector('[role=menu]'), '選單容器要有 role="menu"')
assert(!shown(m), '一開始選單要是關著的')
assertEqual(items().map(nameOf), ['改期', '列印掛號單', '取消預約'], '選單項目')` },
      { name: '點按鈕開選單並聚焦第一項，再點一次關閉', code: MENU + R`
focus(btn())
click(btn())
await tick()
assert(shown(menuEl()), '點按鈕之後選單要出現')
assertEqual(btn().getAttribute('aria-expanded'), 'true', '選單開著時的 aria-expanded')
assertEqual(act(), items()[0], '開選單後焦點要在第一項「改期」（現在在：' + nameOf(act()) + '）')
click(btn())
await tick()
assert(!shown(menuEl()), '再點一次按鈕要關閉選單')
assertEqual(btn().getAttribute('aria-expanded'), 'false', '關閉後的 aria-expanded')` },
      { name: '方向鍵：↓ ↑ 開選單、組內移動與繞回、Home 與 End', code: MENU + R`
await openByKey()
assert(shown(menuEl()), '在按鈕上按 ↓ 要開選單')
assertEqual(act(), items()[0], '按鈕上按 ↓ 後焦點要在第一項（現在在：' + nameOf(act()) + '）')
press(act(), 'ArrowDown'); await tick()
assertEqual(nameOf(act()), '列印掛號單', '選單裡按 ↓')
press(act(), 'ArrowDown'); await tick()
press(act(), 'ArrowDown'); await tick()
assertEqual(nameOf(act()), '改期', '在最後一項按 ↓ 要繞回第一項')
press(act(), 'ArrowUp'); await tick()
assertEqual(nameOf(act()), '取消預約', '在第一項按 ↑ 要繞到最後一項')
press(act(), 'Home'); await tick()
assertEqual(nameOf(act()), '改期', '按 Home')
press(act(), 'End'); await tick()
assertEqual(nameOf(act()), '取消預約', '按 End')
press(act(), 'Escape'); await tick()
if (shown(menuEl()) && menuEl().matches(':popover-open')) { menuEl().hidePopover(); await tick() }
focus(btn())
press(btn(), 'ArrowUp'); await tick()
assert(shown(menuEl()), '在按鈕上按 ↑ 要開選單')
assertEqual(nameOf(act()), '取消預約', '按鈕上按 ↑ 後焦點要在最後一項')` },
      { name: 'Esc 關閉選單，焦點回到按鈕', code: MENU + R`
await openByKey()
press(act(), 'ArrowDown'); await tick()
press(act(), 'Escape'); await tick()
const m = menuEl()
if (shown(m) && m.matches(':popover-open')) { m.hidePopover(); await tick() }   // 瀏覽器處理真的 Esc 時就是這樣關閉 popover
assert(!shown(m), '按 Esc 要關閉選單')
assertEqual(btn().getAttribute('aria-expanded'), 'false', 'Esc 之後的 aria-expanded')
assertEqual(act(), btn(), 'Esc 之後焦點要回到「更多操作」（現在在：' + nameOf(act()) + '）')` },
      { name: '選了項目：關閉、焦點回按鈕、寫進 #result', code: MENU + R`
await openByKey()
press(act(), 'ArrowDown'); await tick()
const target = act()
press(target, 'Enter'); await tick()
if (shown(menuEl()) && target.tagName === 'BUTTON') { target.click(); await tick() }   // 原生 <button> 的 Enter 由瀏覽器轉成 click
assert(!shown(menuEl()), '選了項目之後選單要關閉')
assertEqual(act(), btn(), '選了項目之後焦點要回到「更多操作」（現在在：' + nameOf(act()) + '）')
assertEqual(text('#result'), '已選：列印掛號單', '按 Enter 選「列印掛號單」之後的 #result')
await openByKey()
click(items()[2]); await tick()
assert(!shown(menuEl()), '點選項目之後選單要關閉')
assertEqual(act(), btn(), '點選項目之後焦點要回到按鈕')
assertEqual(text('#result'), '已選：取消預約', '點「取消預約」之後的 #result')
assertEqual($('#result').getAttribute('role'), 'status', '#result 的 role')` },
      { name: 'Tab 關閉選單，焦點照常往下走', code: MENU + R`
await openByKey()
press(act(), 'Tab')
$('#next-link').focus()   // 瀏覽器處理 Tab 時，焦點移到下一個元素
await tick()
assert(!shown(menuEl()), '按 Tab 離開之後選單要關閉')
assertEqual(btn().getAttribute('aria-expanded'), 'false', 'Tab 離開之後的 aria-expanded')
assertEqual(act() && act().id, 'next-link', 'Tab 之後焦點要留在下一個元素，不要搶回按鈕')` },
    ],
    hints: [
      '項目寫 `tabindex="-1"`：Tab 走不到，但可以 `focus()`。開選單時把焦點移到第一項，`aria-expanded` 同時改成 `"true"`。',
      '在選單容器上監聽 `keydown`，用 `items.indexOf(document.activeElement)` 算出下一項，`(i + 1 + n) % n` 讓頭尾繞回；方向鍵記得 `preventDefault()`，不然頁面會捲動。',
      '選了項目時先關選單並 `btn.focus()`，再執行動作；之後要開 Dialog 的話，Dialog 關閉時焦點才回得到按鈕。Tab 的處理只關選單、不 `preventDefault()`。',
    ],
  },
  {
    id: 'frontend-ci-1', skill: 'frontend-ci', kind: 'config', level: 2, file: '.github/workflows/ci.yml',
    title: 'PR 上跑 npm ci、lint、型別檢查、測試與建置',
    prompt: '門診前端的 CI 只在 push 時跑，用 `npm install`、Node 版本寫死在 workflow 裡、沒有型別檢查與測試，lint 失敗還被 `|| true` 吃掉，`permissions` 是 `write-all`。改成：\n\n- 觸發：`pull_request`，以及 push 到 `main`\n- `actions/checkout@v7`；`actions/setup-node@v7` 用 `node-version-file: .nvmrc` 讀 Node 版本（不寫 `node-version`），`cache: npm`\n- 安裝用 `npm ci`，不用 `npm install`\n- 同一個 job 依序跑 `npm run lint`、`npm run typecheck`（`vue-tsc --noEmit`）、`npm run test`（`vitest run`）、`npm run build`；任何一步失敗整個 job 就失敗（不寫 `|| true`、`continue-on-error: true`）\n- workflow 層級的 `permissions` 只給 `contents: read`，任何地方都不給寫入權限\n\n`package.json` 裡已經有這四個 scripts。',
    starter: `name: CI

on:
  push:

permissions: write-all

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - run: npm run lint || true
      - run: npm run build
`,
    solution: `name: CI

on:
  pull_request:
  push:
    branches: [main]

# 這個 workflow 只讀程式碼
permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc   # 本機與 CI 用同一個 Node 版本
          cache: npm                  # 快取 ~/.npm
      - run: npm ci                   # 照 lock 檔安裝，對不上就失敗
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test
      - run: npm run build
`,
    hints: [
      '`on:` 底下列 `pull_request:` 與 `push:`，`push` 再加 `branches: [main]`。',
      '`actions/setup-node@v7` 的 `with:` 寫 `node-version-file: .nvmrc` 與 `cache: npm`，拿掉 `node-version`。',
      '`permissions:` 改成兩行：`permissions:` 與縮排的 `contents: read`；`|| true` 刪掉，讓 lint 失敗時 job 跟著失敗。',
    ],
    tests: [
      { name: 'PR 與 push 到 main 時執行', code: CI + R`
const i = clean.findIndex((l) => /^on:/.test(l))
assert(i >= 0, '找不到 on:')
const onBlock = [clean[i]]
for (const l of clean.slice(i + 1)) { if (l.trim() && !/^\s/.test(l)) break; onBlock.push(l) }
const on = onBlock.join('\n')
assert(/pull_request/.test(on), 'on: 底下要有 pull_request：每個 PR 都要跑檢查')
assert(/push/.test(on), 'on: 底下要有 push（合併到 main 之後也跑一次）')
assert(/branches:[\s\S]*main/.test(on), 'push 要用 branches 限制在 main')` },
      { name: 'Node 版本從 .nvmrc 讀，action 用 v7', code: CI + R`
assert(/uses:\s*actions\/checkout@v7\b/.test(src), '要用 actions/checkout@v7')
assert(/uses:\s*actions\/setup-node@v7\b/.test(src), '要用 actions/setup-node@v7')
assert(/node-version-file:\s*['"]?\.nvmrc['"]?\s*$/m.test(src), 'setup-node 要寫 node-version-file: .nvmrc')
assert(!/^\s*node-version:/m.test(src), '不要再寫死 node-version：版本以 .nvmrc 為準，本機與 CI 才會一致')
assert(/cache:\s*['"]?npm['"]?\s*$/m.test(src), 'setup-node 要加 cache: npm')` },
      { name: '用 npm ci 安裝', code: CI + R`
assert(firstRun(/^npm ci\b/) >= 0, '要有 run: npm ci')
const bad = runs.filter((r) => /^npm (install|i)(\s|$)/.test(r))
assert(!bad.length, '不要用 npm install（會改 lock 檔，裝到的版本可能和本機不同）：' + bad.join(', '))` },
      { name: 'lint、型別檢查、測試、建置依序執行', code: CI + R`
const steps = [
  ['npm ci', /^npm ci\b/],
  ['lint', /npm run lint\b|npx eslint\b/],
  ['型別檢查', /npm run (typecheck|type-check)\b|vue-tsc\b/],
  ['測試', /npm (run )?test\b|vitest\b/],
  ['建置', /npm run build\b|vite build\b/],
]
let prev = -1
for (const [name, re] of steps) {
  const at = firstRun(re)
  assert(at >= 0, '少了「' + name + '」這一步（run 指令：' + runs.join(' → ') + '）')
  assert(at > prev, '「' + name + '」的順序不對：要照 npm ci、lint、型別檢查、測試、建置（現在：' + runs.join(' → ') + '）')
  prev = at
}` },
      { name: '失敗不能被吃掉', code: CI + R`
const swallowed = runs.filter((r) => /\|\|\s*(true|:|exit 0)/.test(r))
assert(!swallowed.length, '這幾步的失敗被吃掉了，CI 會是綠燈：' + swallowed.join(', '))
assert(!/continue-on-error:\s*true/.test(src), '不要寫 continue-on-error: true')` },
      { name: 'permissions 只給 contents: read', code: CI + R`
assert(!/write-all|read-all/.test(src), 'permissions 不要用 write-all 或 read-all，列出需要的那一項')
const i = clean.findIndex((l) => /^permissions:/.test(l))
assert(i >= 0, 'workflow 層級（最外層）要寫 permissions:')
assert(/^\s+contents:\s*read\s*$/.test(clean[i + 1] || ''), 'permissions 底下要是 contents: read（現在：' + (clean[i + 1] || '').trim() + '）')
assert(!/:\s*write\s*$/m.test(src), '這個 workflow 不需要任何寫入權限')` },
    ],
  },
  {
    id: 'render-performance-1', skill: 'render-performance', kind: 'vue', level: 2,
    title: '兩千筆掛號一次渲染，改成分頁',
    prompt: '「今日掛號清單」一次把 2,000 筆都渲染成 DOM，打開頁面要等一兩秒，搜尋時每打一個字都卡。資料是前端一次拿到的陣列（程式最上面的 `rows`），先在前端分頁：\n\n- 每頁 50 筆，每筆一個 `.row` 元素，內容含病患姓名（例如「病患 0001」）；畫面上任何時候最多 50 個 `.row`\n- `[data-test=page]` 顯示「第 1 / 40 頁」這樣的頁數；「上一頁」「下一頁」兩顆 `<button>`，在第一頁與最後一頁時分別 `disabled`\n- 搜尋框 `[data-test=keyword]` 篩選全部 2,000 筆（不是只篩目前這一頁），條件改變時回到第 1 頁；`[data-test=count]` 顯示「共 N 筆」（篩選後的總數）\n- 點一列就選取它：那一列加上 class `selected`，同一時間只有一列；換頁再回來，選取還在\n\n保留 `rows` 的產生方式；用 `computed` 算目前這一頁，不要用 `v-show` 藏起其他列。',
    starter: `import { createApp, ref, computed } from 'vue'

${ROWS}

const TodayList = {
  setup() {
    const keyword = ref('')
    const selectedId = ref(null)
    const filtered = computed(() => rows.filter((r) => r.name.includes(keyword.value.trim())))
    return { keyword, selectedId, filtered }
  },
  template: \`
    <input v-model="keyword" type="search" aria-label="搜尋病患" data-test="keyword">
    <p data-test="count">共 {{ filtered.length }} 筆</p>
    <ul class="list">
      <!-- 2,000 筆全部渲染 -->
      <li v-for="r in filtered" :key="r.id" class="row" :class="{ selected: r.id === selectedId }" @click="selectedId = r.id">
        {{ r.name }}｜{{ r.room }}
      </li>
    </ul>\`,
}

createApp(TodayList).mount('#app')
`,
    solution: `import { createApp, ref, computed, watch } from 'vue'

${ROWS}

const PAGE_SIZE = 50

const TodayList = {
  setup() {
    const keyword = ref('')
    const selectedId = ref(null)     // 記 id，不記第幾列：換頁、篩選之後選取照樣對得上
    const page = ref(1)

    const filtered = computed(() => {
      const q = keyword.value.trim()
      return q ? rows.filter((r) => r.name.includes(q)) : rows
    })
    const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)))
    // 只把這一頁交給模板：DOM 最多 50 列
    const visible = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))

    watch(keyword, () => { page.value = 1 })   // 條件改變回到第 1 頁

    return { keyword, selectedId, page, filtered, pageCount, visible }
  },
  template: \`
    <input v-model="keyword" type="search" aria-label="搜尋病患" data-test="keyword">
    <p data-test="count">共 {{ filtered.length }} 筆</p>
    <ul class="list">
      <li v-for="r in visible" :key="r.id" class="row" :class="{ selected: r.id === selectedId }" @click="selectedId = r.id">
        {{ r.name }}｜{{ r.room }}
      </li>
    </ul>
    <nav aria-label="分頁">
      <button type="button" :disabled="page === 1" @click="page--">上一頁</button>
      <span data-test="page">第 {{ page }} / {{ pageCount }} 頁</span>
      <button type="button" :disabled="page === pageCount" @click="page++">下一頁</button>
    </nav>\`,
}

createApp(TodayList).mount('#app')
`,
    tests: [
      { name: '一次只渲染一頁', code: R`
await tick()
const rowsNow = $$('.row')
assert(rowsNow.length <= 50, '畫面上有 ' + rowsNow.length + ' 個 .row：一次只渲染一頁（最多 50 筆）')
assertEqual(rowsNow.length, 50, '第一頁的列數')
assert(rowsNow[0].textContent.includes('病患 0001') && rowsNow[49].textContent.includes('病患 0050'), '第一頁要是病患 0001 到 0050')
assertEqual(text('[data-test=count]'), '共 2000 筆')
assertEqual(text('[data-test=page]'), '第 1 / 40 頁')` },
      { name: '上一頁、下一頁與頭尾停用', code: R`
await tick()
const btn = (t) => $$('button').find((b) => b.textContent.trim() === t)
assert(btn('上一頁') && btn('下一頁'), '找不到「上一頁」「下一頁」按鈕')
assert(btn('上一頁').disabled, '第一頁時「上一頁」要 disabled')
click(btn('下一頁')); await tick()
assertEqual(text('[data-test=page]'), '第 2 / 40 頁')
assert($$('.row')[0].textContent.includes('病患 0051'), '第 2 頁的第一筆要是病患 0051（現在：' + text('.row') + '）')
assert(!btn('上一頁').disabled, '第 2 頁時「上一頁」可以按')
for (let i = 0; i < 38; i++) click(btn('下一頁'))
await tick()
assertEqual(text('[data-test=page]'), '第 40 / 40 頁')
assertEqual($$('.row').length, 50, '最後一頁的列數')
assert($$('.row')[49].textContent.includes('病患 2000'), '最後一筆要是病患 2000')
assert(btn('下一頁').disabled, '最後一頁時「下一頁」要 disabled')
click(btn('上一頁')); await tick()
assertEqual(text('[data-test=page]'), '第 39 / 40 頁')` },
      { name: '搜尋全部資料並回到第 1 頁', code: R`
await tick()
const btn = (t) => $$('button').find((b) => b.textContent.trim() === t)
assert(btn('下一頁'), '找不到「下一頁」按鈕')
click(btn('下一頁')); click(btn('下一頁')); await tick()
assertEqual(text('[data-test=page]'), '第 3 / 40 頁', '先翻到第 3 頁')
input('[data-test=keyword]', '199')
await waitFor(() => text('[data-test=count]') === '共 12 筆')
await tick()
assertEqual(text('[data-test=page]'), '第 1 / 1 頁', '搜尋之後要回到第 1 頁')
const names = $$('.row').map((r) => r.textContent)
assertEqual(names.length, 12, '「199」符合 0199、1199 與 1990～1999，共 12 筆')
assert(names.some((n) => n.includes('病患 1999')), '搜尋要涵蓋全部 2,000 筆，不是只搜目前這一頁')
input('[data-test=keyword]', '')
await waitFor(() => text('[data-test=count]') === '共 2000 筆')
await tick()
assertEqual($$('.row').length, 50, '清空搜尋後回到每頁 50 筆')` },
      { name: '點一列選取，換頁回來還在', code: R`
await tick()
const btn = (t) => $$('button').find((b) => b.textContent.trim() === t)
const row = (no) => $$('.row').find((r) => r.textContent.includes('病患 ' + no))
assert(btn('上一頁') && btn('下一頁'), '找不到「上一頁」「下一頁」按鈕')
assert(row('0003') && row('0005'), '第一頁要有病患 0003 與 0005')
click(row('0003')); await tick()
assertEqual($$('.row.selected').length, 1, '選取的列數')
assert(row('0003').classList.contains('selected'), '點了病患 0003 要加上 selected')
click(row('0005')); await tick()
assertEqual($$('.row.selected').map((r) => r.textContent.includes('病患 0005')), [true], '換選病患 0005：只有它是 selected')
click(btn('下一頁')); await tick()
assertEqual($$('.row.selected').length, 0, '第 2 頁沒有選取的列')
click(btn('上一頁')); await tick()
assert(row('0005') && row('0005').classList.contains('selected'), '回到第 1 頁，病患 0005 要還是 selected')` },
    ],
    hints: [
      '加一個 `page` 的 ref，用 `computed` 從篩選後的陣列 `slice((page - 1) * 50, page * 50)`，`v-for` 只跑這一段。',
      '總頁數是 `Math.ceil(篩選後的筆數 / 50)`，至少 1；`watch(keyword, () => { page.value = 1 })` 讓搜尋回到第一頁。',
      '選取記 `id`、不記索引，換頁與篩選之後 `r.id === selectedId` 照樣對得上。',
    ],
  },
  {
    id: 'outdated-patterns-1', skill: 'outdated-patterns', kind: 'html', level: 2, serial: true,
    title: '把 AI 的舊式 modal 改成原生 <dialog>',
    prompt: '「看診須知」視窗是 AI 產生的舊寫法：`div` 加 `position: fixed`、`role="dialog"` 與 `aria-modal="true"`，自己在 `document` 監聽 `keydown` 做 focus trap 與 Esc，開啟時把 `body` 設成 `overflow: hidden`。它能動，但關閉後焦點留在隱藏的按鈕上，背景的連結用螢幕閱讀器照樣讀得到。改用原生 `<dialog>`：\n\n- 用 `showModal()` 開啟（或按鈕的 `command="show-modal"` 與 `commandfor`），開著時符合 `:modal`、背景的連結與按鈕拿不到焦點\n- `<dialog>` 用 `aria-labelledby` 指向標題「看診須知」；頁面上不能有 `role="dialog"` 與 `aria-modal`\n- 開啟時焦點在「我知道了」；按「我知道了」或 Esc 關閉，焦點回到「看診須知」按鈕\n- 不寫 focus trap 與 Esc 的 `keydown` 監聽，不改 `html`、`body` 的 `overflow`\n\n要防止在 backdrop 上捲動帶動背景，可以加 `dialog:modal { overscroll-behavior: contain }` 與 `dialog::backdrop { overflow: hidden; overscroll-behavior: contain }`（目前只有部分瀏覽器生效，當加分寫法）。`#open`、`#help-link`、`#print` 的標記不要改。',
    starter: `<h1>我的掛號</h1>
<p>11/20 09:00 內科 101 王醫師</p>
<button type="button" id="open">看診須知</button>
<button type="button" id="print">列印掛號單</button>
<a href="#help" id="help-link">掛號說明</a>

<div class="overlay" id="notice" role="dialog" aria-modal="true" aria-labelledby="notice-title" hidden>
  <div class="panel">
    <h2 id="notice-title">看診須知</h2>
    <p>請攜帶健保卡，報到時間為看診前 30 分鐘。</p>
    <button type="button" class="close">我知道了</button>
  </div>
</div>

<style>
  body { font: 16px/1.5 system-ui, sans-serif; }
  .overlay { position: fixed; inset: 0; z-index: 9999; background: rgb(0 0 0 / 0.4); display: grid; place-items: center; }
  .overlay[hidden] { display: none; }
  .panel { background: #fff; border-radius: 8px; padding: 16px; max-width: 320px; }
</style>
<script type="module">
  const modal = document.querySelector('#notice')
  const closeBtn = modal.querySelector('.close')

  function onKey(e) {
    if (e.key === 'Escape') close()
    if (e.key === 'Tab') {            // focus trap：只認得一顆按鈕
      e.preventDefault()
      closeBtn.focus()
    }
  }
  function open() {
    modal.hidden = false
    document.body.style.overflow = 'hidden'
    closeBtn.focus()
    document.addEventListener('keydown', onKey)
  }
  function close() {
    modal.hidden = true
    document.body.style.overflow = ''
    document.removeEventListener('keydown', onKey)
  }
  document.querySelector('#open').addEventListener('click', open)
  closeBtn.addEventListener('click', close)
</script>
`,
    solution: `<h1>我的掛號</h1>
<p>11/20 09:00 內科 101 王醫師</p>
<button type="button" id="open">看診須知</button>
<button type="button" id="print">列印掛號單</button>
<a href="#help" id="help-link">掛號說明</a>

<!-- 不加 role="dialog" 與 aria-modal：showModal() 開的 <dialog> 本身就是 modal 的 dialog -->
<dialog id="notice" aria-labelledby="notice-title">
  <h2 id="notice-title">看診須知</h2>
  <p>請攜帶健保卡，報到時間為看診前 30 分鐘。</p>
  <form method="dialog">
    <!-- Dialog 裡第一個可聚焦的元素，showModal() 會聚焦它 -->
    <button>我知道了</button>
  </form>
</dialog>

<style>
  body { font: 16px/1.5 system-ui, sans-serif; }
  dialog { border: 0; border-radius: 8px; padding: 16px; max-width: 320px; }
  dialog::backdrop { background: rgb(0 0 0 / 0.4); }
  /* 加分寫法：支援的瀏覽器上，在 Dialog 或 backdrop 上捲動不會帶動背景；不支援時背景仍然是 inert */
  dialog:modal { overscroll-behavior: contain; }
  dialog::backdrop { overflow: hidden; overscroll-behavior: contain; }
</style>
<script type="module">
  const dialog = document.querySelector('#notice')
  // 背景 inert、Esc 關閉、關閉後焦點回到 #open：都由瀏覽器處理
  document.querySelector('#open').addEventListener('click', () => dialog.showModal())
</script>
`,
    tests: [
      { name: '用 showModal() 開啟，沒有 role="dialog" 與 aria-modal', code: R`
focus('#open')
click('#open')
await tick()
const d = $('dialog')
assert(d && d.open, '找不到開著的 <dialog>：要用原生的 <dialog> 元素')
assert(d.matches(':modal'), '<dialog> 要用 showModal() 開啟（show() 與 open 屬性開的不是 modal）')
const title = document.getElementById(d.getAttribute('aria-labelledby') || '')
assert(title && d.contains(title), 'aria-labelledby 要指向 Dialog 裡的標題')
assertEqual(text(title), '看診須知', '標題的文字')
const roles = $$('[role=dialog], [role=alertdialog]')
assert(!roles.length, '原生 <dialog> 不要再加 role="dialog"：' + roles.map((e) => e.tagName.toLowerCase()).join(', '))
assert(!$$('[aria-modal]').length, '不要寫 aria-modal：showModal() 已經讓背景 inert')
assertEqual(document.activeElement && document.activeElement.textContent.trim(), '我知道了', '開啟後焦點所在的元素')` },
      { name: '背景拿不到焦點，也沒有鎖 body 的捲動', code: R`
focus('#open')
click('#open')
await tick()
const d = $('dialog')
assert(d && d.open, '找不到開著的 <dialog>')
for (const sel of ['#help-link', '#print', '#open']) {
  $(sel).focus()
  assert(d.contains(document.activeElement), '背景的 ' + sel + ' 還拿得到焦點：Dialog 開著時背景要 inert')
}
for (const el of [document.documentElement, document.body]) {
  const name = el === document.body ? 'body' : 'html'
  assert(getComputedStyle(el).overflow !== 'hidden' && getComputedStyle(el).overflowY !== 'hidden', name + ' 的 overflow 變成 hidden：不要用它鎖背景捲動（捲軸消失會讓頁面跳動）')
  assert(getComputedStyle(el).position !== 'fixed', name + ' 不要用 position: fixed 鎖捲動')
}` },
      { name: '按「我知道了」關閉，焦點回到觸發按鈕', code: R`
focus('#open')
click('#open')
await tick()
const d = $('dialog')
assert(d && d.open, '找不到開著的 <dialog>')
click($$('dialog button').find((b) => b.textContent.trim() === '我知道了'))
await waitFor(() => !d.open)
assertEqual(document.activeElement && document.activeElement.id, 'open', '關閉後焦點要回到「看診須知」')` },
      { name: 'Esc 關閉，焦點回到觸發按鈕', code: R`
focus('#open')
click('#open')
await tick()
const d = $('dialog')
assert(d && d.open && d.matches(':modal'), '找不到用 showModal() 開著的 <dialog>')
d.requestClose()   // 和按 Esc 相同的 close request：先觸發 cancel，再關閉
await waitFor(() => !d.open)
assertEqual(document.activeElement && document.activeElement.id, 'open', 'Esc 關閉後焦點要回到「看診須知」')
focus('#help-link')
assertEqual(document.activeElement && document.activeElement.id, 'help-link', '關閉後背景要恢復可以操作')` },
    ],
    hints: [
      '把外層的 `div.overlay` 與 `div.panel` 換成一個 `<dialog>`，拿掉 `role`、`aria-modal` 與 `hidden`；開啟改成 `dialog.showModal()`。',
      '關閉按鈕放進 `<form method="dialog">`，或呼叫 `dialog.close()`；Esc 與關閉後的焦點回復由瀏覽器處理，`onKey` 整段刪掉。',
      '`document.body.style.overflow` 那兩行也刪掉。沙箱會擋 `autofocus`，但 `showModal()` 會聚焦 Dialog 裡第一個可聚焦的元素。',
    ],
  },
]

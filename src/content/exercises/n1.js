// 程式題：切版（css 題，在沙箱 iframe 裡量 box() 與 css()）；Tailwind CSS：兩題 js 題（Worker，模擬建置時的掃描與 cn()），
// 一題 html 題（tailwind: true，沙箱載入 @tailwindcss/browser，測試用 box()、css()、cssWhen() 量結果）

// 切版題的固定 HTML 與 token（使用者只寫 CSS）
const SLOT_HTML = `<section class="slots">
  <article class="slot-card">
    <div class="slot-head"><h3 class="slot-time">09:00–09:30</h3><span class="slot-badge">可預約</span></div>
    <p class="slot-doctor">林醫師・家醫科・101 診</p>
    <button class="slot-action" type="button">預約</button>
  </article>
  <article class="slot-card">
    <div class="slot-head"><h3 class="slot-time">09:30–10:00</h3><span class="slot-badge">候補中（3）</span></div>
    <p class="slot-doctor">歐陽醫師・小兒科・102 診</p>
    <button class="slot-action" type="button">候補</button>
  </article>
  <article class="slot-card">
    <div class="slot-head"><h3 class="slot-time">10:00–10:30</h3><span class="slot-badge">已額滿</span></div>
    <p class="slot-doctor">陳醫師・眼科・103 診</p>
    <button class="slot-action" type="button">候補</button>
  </article>
</section>`

const SLOT_TOKENS = `:root {
  --color-surface: #ffffff;
  --color-border: #d0d7e2;
  --color-text: #1d2330;
  --color-text-muted: #5b6472;
  --color-primary: #2f6fd6;
  --color-primary-soft: #e6effc;
  --color-on-primary: #ffffff;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --font-sm: 14px;
  --font-md: 16px;
  --font-lg: 20px;
  --radius-lg: 12px;
  --radius-full: 999px;
}
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; color: var(--color-text); }
h3, p { margin: 0; }
button { font: inherit; }`

// 測試共用：四捨五入後比較，誤差 1px
const near = "const near = (a, b) => Math.abs(a - b) <= 1\n"

export default [
  {
    id: 'design-to-code-1', skill: 'design-to-code', kind: 'css', level: 2,
    title: '照設計規格切出門診時段卡片',
    prompt: '設計稿「門診時段」有 390 與 1280 兩個 frame。HTML 與 token（`:root` 的 CSS 變數）已經寫好，不能改；照下面的規格寫 CSS。顏色、字級、間距、圓角都用 token，你寫的 CSS 裡不能出現 `#` 色碼或 `rgb()`。\n\n**清單 `.slots`**\n\n- 390：卡片一欄，左右與上下 padding 16px，卡片之間 12px\n- 1280（`@media (min-width: 1280px)`）：三欄等寬，欄距 24px；內容寬 1080px、在畫面上水平置中（每張卡片 344px）\n\n**卡片 `.slot-card`**（垂直 Auto layout）\n\n- padding 16px、項目間距 12px、1px 實線邊框 `--color-border`、圓角 `--radius-lg`、背景 `--color-surface`\n\n**第一列 `.slot-head`**（水平 Auto layout，間距 Auto）\n\n- 時段 `.slot-time` 靠左，徽章 `.slot-badge` 靠右，兩者垂直置中\n- `.slot-time`：字級 `--font-lg`、粗細 700、行高 28px\n- `.slot-badge`：Hug（寬度跟著文字）、padding 上下 4px 左右 8px、圓角 `--radius-full`、字級 `--font-sm`、行高 20px、底色 `--color-primary-soft`、字色 `--color-primary`\n\n**其他**\n\n- `.slot-doctor`：字級 `--font-md`、行高 24px、字色 `--color-text-muted`\n- `.slot-action`：高 44px、左右 padding 16px、無邊框、圓角 `--radius-full`、底色 `--color-primary`、字色 `--color-on-primary`。390 時 Fill（填滿卡片內寬）；1280 時 Hug 並靠右',
    html: SLOT_HTML,
    css: SLOT_TOKENS,
    starter: `/* 照 Dev Mode 抄下來的數值：390 看起來差不多，1280 就不對了 */
.slots {
  padding: 16px;
}
.slot-card {
  width: 358px;
  margin-bottom: 12px;
  padding: 16px;
  border: 1px solid #d0d7e2;
  border-radius: 12px;
}
.slot-head {
  display: flex;
  justify-content: space-between;
}
.slot-time { font-size: 20px; font-weight: 700; }
.slot-badge {
  width: 60px;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 14px;
  background: #e6effc;
  color: #2f6fd6;
}
.slot-doctor { margin-top: 12px; color: #5b6472; }
.slot-action {
  width: 100%;
  height: 44px;
  margin-top: 12px;
  border: 0;
  border-radius: 999px;
  background: #2f6fd6;
  color: #fff;
}
`,
    solution: `/* 清單：390 一欄 */
.slots {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
}

/* 卡片：垂直 Auto layout */
.slot-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
}

/* 第一列：水平、space-between、垂直置中 */
.slot-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
}
.slot-time {
  font-size: var(--font-lg);
  font-weight: 700;
  line-height: 28px;
}
/* Hug：不寫寬度 */
.slot-badge {
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-full);
  font-size: var(--font-sm);
  line-height: 20px;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  white-space: nowrap;
}
.slot-doctor {
  font-size: var(--font-md);
  line-height: 24px;
  color: var(--color-text-muted);
}
/* Fill：垂直 flex 的交叉軸預設 stretch，不寫寬度就填滿 */
.slot-action {
  height: 44px;
  padding-inline: var(--space-4);
  border: 0;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  color: var(--color-on-primary);
}

@media (min-width: 1280px) {
  .slots {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-6);
    max-width: calc(1080px + 2 * var(--space-4));   /* 內容 1080 + 左右 padding */
    margin-inline: auto;
  }
  /* Hug 並靠右 */
  .slot-action { align-self: flex-end; }
}
`,
    tests: [
      { name: '390：卡片一欄、左右 16px、間距 12px', viewport: 390, code: near + "const c = $$('.slot-card').map(box)\nassert(near(c[0].left, 16) && near(c[0].width, 358), '卡片應該從 16px 開始、寬 358px（左 ' + Math.round(c[0].left) + '，寬 ' + Math.round(c[0].width) + '）')\nassert(near(c[0].top, 16), '清單上方 padding 應該是 16px')\nassert(near(c[1].top - c[0].bottom, 12) && near(c[2].top - c[1].bottom, 12), '卡片之間應該是 12px（目前 ' + Math.round(c[1].top - c[0].bottom) + 'px）')" },
      { name: '卡片的 padding、邊框、圓角、背景', viewport: 390, code: "assertEqual(css('.slot-card', 'padding-top'), '16px', 'padding')\nassertEqual(css('.slot-card', 'padding-left'), '16px', 'padding')\nassertEqual(css('.slot-card', 'border-top-width'), '1px', '邊框粗細')\nassertEqual(css('.slot-card', 'border-top-style'), 'solid', '邊框樣式')\nassertEqual(css('.slot-card', 'border-top-color'), 'rgb(208, 215, 226)', '邊框顏色（--color-border）')\nassertEqual(css('.slot-card', 'border-top-left-radius'), '12px', '圓角（--radius-lg）')\nassertEqual(css('.slot-card', 'background-color'), 'rgb(255, 255, 255)', '背景（--color-surface）')" },
      { name: '卡片內的項目間距 12px', viewport: 390, code: near + "const head = box('.slot-head'), doc = box('.slot-doctor'), btn = box('.slot-action')\nassert(near(doc.top - head.bottom, 12), '第一列與醫師之間應該 12px（目前 ' + Math.round(doc.top - head.bottom) + 'px）')\nassert(near(btn.top - doc.bottom, 12), '醫師與按鈕之間應該 12px（目前 ' + Math.round(btn.top - doc.bottom) + 'px）')\nconst card = box('.slot-card')\nassert(near(head.top - card.top, 17), '第一列應該在卡片內 16px padding + 1px 邊框的位置')" },
      { name: '第一列：時段靠左、徽章靠右、垂直置中', viewport: 390, code: near + "const card = box('.slot-card'), t = box('.slot-time'), b = box('.slot-badge')\nassert(near(t.left, card.left + 17), '時段應該靠左（卡片內 17px）')\nassert(near(b.right, card.right - 17), '徽章應該靠右（卡片內 17px），目前右邊在 ' + Math.round(b.right))\nassert(near(t.top + t.height / 2, b.top + b.height / 2), '時段與徽章應該垂直置中')" },
      { name: '字級、行高與顏色', viewport: 390, code: "assertEqual(css('.slot-time', 'font-size'), '20px', '時段字級')\nassertEqual(css('.slot-time', 'font-weight'), '700', '時段粗細')\nassertEqual(css('.slot-time', 'line-height'), '28px', '時段行高')\nassertEqual(css('.slot-badge', 'font-size'), '14px', '徽章字級')\nassertEqual(css('.slot-badge', 'line-height'), '20px', '徽章行高')\nassertEqual(css('.slot-badge', 'color'), 'rgb(47, 111, 214)', '徽章字色')\nassertEqual(css('.slot-badge', 'background-color'), 'rgb(230, 239, 252)', '徽章底色')\nassertEqual(css('.slot-doctor', 'font-size'), '16px', '醫師字級')\nassertEqual(css('.slot-doctor', 'line-height'), '24px', '醫師行高')\nassertEqual(css('.slot-doctor', 'color'), 'rgb(91, 100, 114)', '醫師字色')" },
      { name: '徽章是 Hug：寬度跟著文字', viewport: 390, code: near + "const [a, b] = $$('.slot-badge')\nassertEqual(css(a, 'padding-left'), '8px', '徽章左右 padding')\nassertEqual(css(a, 'padding-top'), '4px', '徽章上下 padding')\nassert(box(b).width > box(a).width + 20, '「候補中（3）」應該比「可預約」寬：徽章不能寫死寬度')\nassert(b.scrollWidth <= b.clientWidth + 1, '「候補中（3）」被截斷了')\nassert(near(box(a).height, 28), '徽章高度應該是行高 20 + padding 8 = 28px（目前 ' + Math.round(box(a).height) + '）')" },
      { name: '390：按鈕 Fill、高 44px', viewport: 390, code: near + "const card = box('.slot-card'), btn = box('.slot-action')\nassert(near(btn.height, 44), '按鈕高應該 44px')\nassert(near(btn.left, card.left + 17) && near(btn.right, card.right - 17), '390 時按鈕要填滿卡片內寬')\nassertEqual(css('.slot-action', 'border-top-style'), 'none', '按鈕無邊框')\nassertEqual(css('.slot-action', 'background-color'), 'rgb(47, 111, 214)', '按鈕底色')\nassertEqual(css('.slot-action', 'color'), 'rgb(255, 255, 255)', '按鈕字色')\nassertEqual(css('.slot-action', 'padding-left'), '16px', '按鈕左右 padding')" },
      { name: '1280：三欄、欄距 24px、內容 1080px 置中', viewport: 1280, code: near + "const c = $$('.slot-card').map(box)\nassert(near(c[0].top, c[1].top) && near(c[1].top, c[2].top), '三張卡片應該在同一列')\nassert(c.every((x) => near(x.width, 344)), '每張卡片應該 344px（目前 ' + c.map((x) => Math.round(x.width)).join(', ') + '）')\nassert(near(c[1].left - c[0].right, 24), '欄距應該 24px')\nassert(near(c[0].left, 100) && near(c[2].right, 1180), '內容 1080px 要水平置中（左邊 100px）')" },
      { name: '1280：按鈕 Hug 並靠右', viewport: 1280, code: near + "const card = box('.slot-card'), btn = box('.slot-action')\nassert(btn.width < card.width - 34 - 40, '1280 時按鈕寬度要跟著文字，不填滿')\nassert(near(btn.right, card.right - 17), '1280 時按鈕要靠右')\nassert(near(btn.height, 44), '按鈕高應該 44px')" },
      { name: '值都來自 token：沒有寫死的色碼', code: "const sheet = document.styleSheets[document.styleSheets.length - 1]\nconst text = [...sheet.cssRules].map((r) => r.cssText).join('\\n')\nassert(!/#[0-9a-f]{3,8}\\b/i.test(text) && !/rgba?\\(/i.test(text), '你寫的 CSS 裡出現了色碼，改用 var(--color-…)')\nassert(/var\\(--color-border\\)/.test(text) && /var\\(--color-primary\\)/.test(text), '邊框與主色要用 var(--color-border)、var(--color-primary)')" },
    ],
    hints: [
      'Auto layout 對 flex：垂直是 `flex-direction: column`，項目間距是 `gap`，不要在子項加 margin。',
      'Hug 就是不寫寬度；Fill 在垂直 flex 的交叉軸是預設的 `stretch`，`align-self: flex-end` 會讓它變回跟著內容並靠右。',
      '1280 的三欄用 `grid-template-columns: repeat(3, minmax(0, 1fr))`；內容寬 1080 加上左右 padding 再用 `margin-inline: auto` 置中。',
    ],
  },
  {
    id: 'tailwind-css-1', skill: 'tailwind-css', kind: 'js', level: 1,
    title: '狀態徽章的 class：讓 Tailwind 掃描得到',
    prompt: '`statusBadge(status)` 回傳掛號狀態徽章的 class 字串。現在的寫法用樣板字串組出顏色，畫面上看起來對，但 `npm run build` 之後徽章沒有顏色：Tailwind 只產生原始碼裡完整出現的 class。\n\n改寫成每個 class 都完整寫在原始碼裡，回傳值維持：\n\n| status | 回傳 |\n|---|---|\n| `booked` | `rounded-full px-2 py-0.5 text-sm bg-blue-100 text-blue-800` |\n| `checked-in` | `rounded-full px-2 py-0.5 text-sm bg-green-100 text-green-800` |\n| `missed` | `rounded-full px-2 py-0.5 text-sm bg-amber-100 text-amber-800` |\n| 其他值 | `rounded-full px-2 py-0.5 text-sm bg-gray-100 text-gray-700` |\n\n測試會模擬 Tailwind 的掃描：把你的整段程式當成文字切成片段，檢查每個回傳的 class 都完整出現過。',
    starter: `const BASE = 'rounded-full px-2 py-0.5 text-sm'
const TONE = { booked: 'blue', 'checked-in': 'green', missed: 'amber' }

function statusBadge(status) {
  const c = TONE[status] || 'gray'
  const shade = c === 'gray' ? 700 : 800
  return \`\${BASE} bg-\${c}-100 text-\${c}-\${shade}\`
}

console.log(statusBadge('booked'))
`,
    solution: `const BASE = 'rounded-full px-2 py-0.5 text-sm'

// 完整字串的對照表：Tailwind 掃描原始碼時看得到每一個 class
const TONE = {
  booked: 'bg-blue-100 text-blue-800',
  'checked-in': 'bg-green-100 text-green-800',
  missed: 'bg-amber-100 text-amber-800',
}
const FALLBACK = 'bg-gray-100 text-gray-700'

function statusBadge(status) {
  // 用 Object.hasOwn，避免 'toString' 這類原型上的鍵被當成狀態
  const tone = Object.hasOwn(TONE, status) ? TONE[status] : FALLBACK
  return \`\${BASE} \${tone}\`
}

console.log(statusBadge('booked'))
`,
    tests: [
      { name: '四種狀態的回傳值', code: "assertEqual(statusBadge('booked'), 'rounded-full px-2 py-0.5 text-sm bg-blue-100 text-blue-800')\nassertEqual(statusBadge('checked-in'), 'rounded-full px-2 py-0.5 text-sm bg-green-100 text-green-800')\nassertEqual(statusBadge('missed'), 'rounded-full px-2 py-0.5 text-sm bg-amber-100 text-amber-800')\nassertEqual(statusBadge('cancelled'), 'rounded-full px-2 py-0.5 text-sm bg-gray-100 text-gray-700')\nassertEqual(statusBadge(undefined), 'rounded-full px-2 py-0.5 text-sm bg-gray-100 text-gray-700')" },
      { name: '原型上的鍵不算狀態', code: "assertEqual(statusBadge('toString'), 'rounded-full px-2 py-0.5 text-sm bg-gray-100 text-gray-700', 'status 是 toString 時要用灰色')" },
      { name: '模擬掃描：每個 class 都完整出現在原始碼裡', code: "/*__SCAN__*/\nconst all = String(arguments.callee)\nconst source = all.slice(0, all.indexOf('/*__' + 'SCAN__*/'))\nconst found = new Set(source.split(/[^a-zA-Z0-9_\\-:\\/\\[\\]\\.!%#()]+/).filter(Boolean))\nconst missing = []\nfor (const s of ['booked', 'checked-in', 'missed', 'other']) for (const c of statusBadge(s).split(/\\s+/)) if (!found.has(c) && !missing.includes(c)) missing.push(c)\nassert(!missing.length, '這些 class 在原始碼裡沒有完整出現，Tailwind 不會產生：' + missing.join(' '))" },
    ],
    hints: ['把 `bg-${c}-100` 這種組合改成「狀態 → 完整 class 字串」的物件。', '未知狀態的灰色也要完整寫出 `bg-gray-100 text-gray-700`。', '`TONE[\'toString\']` 會拿到物件原型上的函式，用 `Object.hasOwn(TONE, status)` 判斷。'],
  },
  {
    id: 'tailwind-css-2', skill: 'tailwind-css', kind: 'js', level: 2,
    title: '寫一個簡化版的 cn()：後面的 class 取代前面的',
    prompt: '元件預設 `px-4`，呼叫端傳 `px-2`，兩個 class 同時在元素上時，勝出的是 CSS 檔裡排在後面的那條，和 class 的順序無關。寫一個簡化版的 `cn(...inputs)`，合併時拿掉被取代的 class（實務上用 `clsx` + `tailwind-merge`）：\n\n**輸入**\n\n- 字串（可含多個以空白分隔的 class）、陣列（可巢狀）、物件 `{ class: 條件 }`（條件為真才加入）\n- `false`、`null`、`undefined`、`0`、`\'\'` 略過\n\n**衝突**：同一組的 class 只留最後出現的那個，保留它出現的位置；變體（最後一個 `:` 之前的部分，例如 `hover:`、`md:hover:`）不同就不算同一組。\n\n| 組 | 規則 |\n|---|---|\n| 背景 | `bg-` 開頭 |\n| 字級 | `text-xs`、`text-sm`、`text-base`、`text-lg`、`text-xl`、`text-2xl` |\n| 字色 | 其他 `text-` 開頭 |\n| 內距 | `p-`、`px-`、`py-` 各自一組；後面的 `p-` 也會取代前面的 `px-` 與 `py-`（反過來不會） |\n| 圓角 | `rounded` 或 `rounded-` 開頭 |\n\n不在表裡的 class 原樣保留。結果用一個空白連接。',
    starter: `function cn(...inputs) {
  return inputs.flat().filter(Boolean).join(' ')
}

console.log(cn('px-4 py-2 bg-white', 'bg-blue-600'))
`,
    solution: `const SIZES = ['xs', 'sm', 'base', 'lg', 'xl', '2xl']

// 把各種輸入攤平成 class 陣列（clsx 做的事）
function toList(input, out) {
  if (!input) return out
  if (typeof input === 'string') out.push(...input.split(/\\s+/).filter(Boolean))
  else if (Array.isArray(input)) for (const x of input) toList(x, out)
  else if (typeof input === 'object') for (const [k, v] of Object.entries(input)) if (v) out.push(k)
  return out
}

// 工具名稱 → 組名；不在表裡回傳 null
function groupOf(utility) {
  if (utility.startsWith('bg-')) return 'bg'
  if (utility.startsWith('text-')) return SIZES.includes(utility.slice(5)) ? 'font-size' : 'text-color'
  if (utility.startsWith('px-')) return 'px'
  if (utility.startsWith('py-')) return 'py'
  if (utility.startsWith('p-')) return 'p'
  if (utility === 'rounded' || utility.startsWith('rounded-')) return 'rounded'
  return null
}

function cn(...inputs) {
  const list = toList(inputs, [])
  const seen = new Set()
  const kept = []
  // 從後往前：先看到的是勝出的那個
  for (let i = list.length - 1; i >= 0; i--) {
    const cls = list[i]
    const at = cls.lastIndexOf(':')
    const variant = cls.slice(0, at + 1)
    const group = groupOf(cls.slice(at + 1))
    if (!group) { kept.push(cls); continue }
    if (seen.has(variant + group)) continue
    seen.add(variant + group)
    // 後面的 p- 取代前面的 px- 與 py-
    if (group === 'p') { seen.add(variant + 'px'); seen.add(variant + 'py') }
    kept.push(cls)
  }
  return kept.reverse().join(' ')
}

console.log(cn('px-4 py-2 bg-white', 'bg-blue-600'))
`,
    tests: [
      { name: '略過 falsy，支援陣列與物件', code: "assertEqual(cn('rounded-md', false, null, undefined, 0, '', ['font-bold', ['tabular-nums']], { 'opacity-50': true, hidden: false }), 'rounded-md font-bold tabular-nums opacity-50')\nassertEqual(cn('  flex   gap-2 '), 'flex gap-2', '多餘的空白要去掉')" },
      { name: '同一組只留最後一個，位置照它出現的地方', code: "assertEqual(cn('px-4 py-2 bg-white', 'bg-blue-600'), 'px-4 py-2 bg-blue-600')\nassertEqual(cn('bg-white px-4', 'px-2'), 'bg-white px-2')\nassertEqual(cn('rounded', 'rounded-full'), 'rounded-full')" },
      { name: '變體分開算', code: "assertEqual(cn('bg-white hover:bg-gray-50', 'hover:bg-blue-50'), 'bg-white hover:bg-blue-50')\nassertEqual(cn('md:px-4 px-2', 'md:px-6'), 'px-2 md:px-6')" },
      { name: '字級與字色是不同組', code: "assertEqual(cn('text-sm text-gray-900', 'text-clinic'), 'text-sm text-clinic')\nassertEqual(cn('text-sm text-gray-900', 'text-lg'), 'text-gray-900 text-lg')" },
      { name: 'p- 取代前面的 px-、py-，反過來不會', code: "assertEqual(cn('px-2 py-1', 'p-4'), 'p-4')\nassertEqual(cn('p-4', 'px-2'), 'p-4 px-2')" },
      { name: '不在表裡的 class 原樣保留', code: "assertEqual(cn('flex items-center', 'flex-col'), 'flex items-center flex-col')" },
    ],
    hints: ['先把所有輸入攤平成一個 class 陣列，再處理衝突。', '從陣列尾端往前走，用 Set 記下「變體 + 組名」已經出現過；先遇到的就是勝出的。', '變體是 `cls.slice(0, cls.lastIndexOf(\':\') + 1)`，剩下的是工具名稱。'],
  },
  {
    id: 'tailwind-css-3', skill: 'tailwind-css', kind: 'html', level: 2, tailwind: true,
    title: '叫號看板：用 Tailwind 寫兩種寬度與互動狀態',
    prompt: '這題的沙箱載入 Tailwind CSS 4.3.5（`@tailwindcss/browser`），`<style type="text/tailwindcss">` 裡可以寫 `@theme`。起始碼的叫號看板在手機和桌機都不對，按鈕也沒有狀態。只改 `class` 與 `@theme`，保留 `data-test` 屬性與最後的 `<script>`：\n\n**色票**（`@theme`）：`clinic` 是 `#2f6fd6`、`clinic-strong` 是 `#1f4fa8`，要能寫成 `bg-clinic`、`text-clinic`、`hover:bg-clinic-strong`\n\n**診間卡片 `[data-test=rooms]`**\n\n- 390：一欄，卡片之間 12px\n- 1280（`lg:` 以上）：四欄排在同一列\n\n**篩選**\n\n- 390：篩選區 `[data-test=filters]` 預設隱藏；按「篩選」（`[data-test=toggle]`，腳本會切換它的 `aria-expanded` 與篩選區的 `data-state`）後顯示成 flex；展開時「篩選」按鈕是 `clinic` 底、白字\n- 1280：篩選區一直顯示（flex），「篩選」按鈕隱藏\n\n**叫號按鈕 `[data-test=call]` 與 `[data-test=skip]`**\n\n- 高 44px、`clinic` 底、白字；hover 時底色 `clinic-strong`\n- 鍵盤聚焦（`:focus-visible`）時 2px 實線外框、顏色 `clinic`、距離按鈕 2px\n- 停用（`disabled`）時不透明度 0.5、游標 `not-allowed`\n\n390 時頁面不能左右捲動。測試量的是計算後的樣式與位置，不看 class 的寫法。\n\n> 沙箱的 Tailwind 在瀏覽器裡掃 DOM，用字串組出來的 class 在這裡也會產生；正式專案用 `@tailwindcss/vite` 建置時不會，這題不要那樣寫。',
    starter: `<style type="text/tailwindcss">
  @theme {
    --clinic: #2f6fd6;
    --clinic-strong: #1f4fa8;
  }
</style>

<main class="mx-auto max-w-6xl p-4">
  <header class="flex items-center justify-between gap-3">
    <h1 class="text-xl font-bold">今日叫號</h1>
    <button data-test="toggle" type="button" aria-expanded="false" aria-controls="filters"
      class="h-11 rounded-md border px-4 lg:hidden">篩選</button>
  </header>

  <!-- 想在按鈕展開時顯示篩選區 -->
  <section id="filters" data-test="filters" data-state="closed" class="mt-3 hidden aria-expanded:flex gap-2 lg:flex">
    <label class="flex items-center gap-1"><input type="checkbox"> 只看候診中</label>
    <label class="flex items-center gap-1"><input type="checkbox"> 只看我的診間</label>
  </section>

  <!-- 想要「手機一欄、桌機四欄」 -->
  <ul data-test="rooms" class="mt-4 grid grid-cols-4 md:grid-cols-1 gap-3">
    <li class="rounded-lg border p-4">101 診　家醫科　目前 12 號</li>
    <li class="rounded-lg border p-4">102 診　小兒科　目前 8 號</li>
    <li class="rounded-lg border p-4">103 診　眼科　目前 21 號</li>
    <li class="rounded-lg border p-4">104 診　皮膚科　目前 5 號</li>
  </ul>

  <div class="mt-4 flex gap-3">
    <button data-test="call" type="button" class="h-11 rounded-md bg-clinic px-4 text-white">叫下一號</button>
    <button data-test="skip" type="button" disabled class="h-11 rounded-md bg-clinic px-4 text-white">過號</button>
  </div>
</main>

<script>
  const toggle = document.querySelector('[data-test=toggle]')
  const filters = document.querySelector('[data-test=filters]')
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true'
    toggle.setAttribute('aria-expanded', String(open))
    filters.dataset.state = open ? 'open' : 'closed'
  })
</script>
`,
    solution: `<style type="text/tailwindcss">
  /* --color-* 命名空間才會產生 bg-*、text-*、border-* 這些 class */
  @theme {
    --color-clinic: #2f6fd6;
    --color-clinic-strong: #1f4fa8;
  }
</style>

<main class="mx-auto max-w-6xl p-4">
  <header class="flex items-center justify-between gap-3">
    <h1 class="text-xl font-bold">今日叫號</h1>
    <!-- aria-expanded: 看的是按鈕自己的屬性 -->
    <button data-test="toggle" type="button" aria-expanded="false" aria-controls="filters"
      class="h-11 rounded-md border border-clinic px-4 text-clinic aria-expanded:bg-clinic aria-expanded:text-white lg:hidden">篩選</button>
  </header>

  <!-- 篩選區沒有 aria-expanded，看腳本設定的 data-state -->
  <section id="filters" data-test="filters" data-state="closed" class="mt-3 hidden gap-2 data-[state=open]:flex lg:flex">
    <label class="flex items-center gap-1"><input type="checkbox"> 只看候診中</label>
    <label class="flex items-center gap-1"><input type="checkbox"> 只看我的診間</label>
  </section>

  <!-- 斷點是 min-width：沒有前綴的寫手機版，lg: 往寬的方向加 -->
  <ul data-test="rooms" class="mt-4 grid gap-3 lg:grid-cols-4">
    <li class="rounded-lg border p-4">101 診　家醫科　目前 12 號</li>
    <li class="rounded-lg border p-4">102 診　小兒科　目前 8 號</li>
    <li class="rounded-lg border p-4">103 診　眼科　目前 21 號</li>
    <li class="rounded-lg border p-4">104 診　皮膚科　目前 5 號</li>
  </ul>

  <div class="mt-4 flex gap-3">
    <button data-test="call" type="button" class="h-11 rounded-md bg-clinic px-4 text-white hover:bg-clinic-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clinic disabled:cursor-not-allowed disabled:opacity-50">叫下一號</button>
    <button data-test="skip" type="button" disabled class="h-11 rounded-md bg-clinic px-4 text-white hover:bg-clinic-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clinic disabled:cursor-not-allowed disabled:opacity-50">過號</button>
  </div>
</main>

<script>
  const toggle = document.querySelector('[data-test=toggle]')
  const filters = document.querySelector('[data-test=filters]')
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true'
    toggle.setAttribute('aria-expanded', String(open))
    filters.dataset.state = open ? 'open' : 'closed'
  })
</script>
`,
    tests: [
      { name: '390：診間卡片一欄、間距 12px', viewport: 390, code: "const r = $$('[data-test=rooms] > li').map(box)\nassert(r.length === 4, '要保留四張診間卡片')\nassert(r.every((b) => Math.round(b.left) === Math.round(r[0].left)), '390 時卡片應該排成一欄')\nassert(r.slice(1).every((b, i) => Math.abs(b.top - r[i].bottom - 12) <= 1), '卡片之間應該是 12px（目前 ' + Math.round(r[1].top - r[0].bottom) + 'px）')" },
      { name: '1280：四欄排在同一列', viewport: 1280, code: "const r = $$('[data-test=rooms] > li').map(box)\nassert(r.every((b) => Math.round(b.top) === Math.round(r[0].top)), '1280 時四張卡片應該在同一列（top：' + r.map((b) => Math.round(b.top)).join(', ') + '）')\nassert(r.every((b) => Math.abs(b.width - r[0].width) <= 1), '四欄要等寬')" },
      { name: '@theme 的色票：叫號按鈕的底色、字色、高度', code: "assertEqual(css('[data-test=call]', 'background-color'), 'rgb(47, 111, 214)', '底色要是 clinic（#2f6fd6）')\nassertEqual(css('[data-test=call]', 'color'), 'rgb(255, 255, 255)', '字色')\nassert(Math.round(box('[data-test=call]').height) === 44, '按鈕高應該 44px')" },
      { name: 'hover 時底色 clinic-strong', code: "assertEqual(cssWhen('[data-test=call]', ':hover', 'background-color'), 'rgb(31, 79, 168)', 'hover 時的底色（找不到 :hover 的規則時是 null）')" },
      { name: 'focus-visible：2px 實線外框、clinic、距離 2px', code: "const b = '[data-test=call]'\nassertEqual(cssWhen(b, ':focus-visible', 'outline-width'), '2px', '外框粗細')\nassertEqual(cssWhen(b, ':focus-visible', 'outline-offset'), '2px', '外框距離')\nassertEqual(cssWhen(b, ':focus-visible', 'outline-color'), 'rgb(47, 111, 214)', '外框顏色')\nconst style = cssWhen(b, ':focus-visible', 'outline-style')\nassert(style === null || style === 'solid', '外框要是實線')" },
      { name: '停用的按鈕：不透明度 0.5、游標 not-allowed', code: "assertEqual(css('[data-test=skip]', 'opacity'), '0.5', '停用時的不透明度')\nassertEqual(css('[data-test=skip]', 'cursor'), 'not-allowed', '停用時的游標')\nassertEqual(css('[data-test=call]', 'opacity'), '1', '沒停用的按鈕不能變淡')" },
      { name: '390：按「篩選」才顯示篩選區，展開時按鈕是 clinic 底', viewport: 390, code: "assertEqual(css('[data-test=filters]', 'display'), 'none', '篩選區預設要隱藏')\nassert(css('[data-test=toggle]', 'display') !== 'none', '390 時要看得到「篩選」按鈕')\nclick('[data-test=toggle]')\nawait twReady()\nawait waitFor(() => css('[data-test=filters]', 'display') === 'flex')\nassertEqual(css('[data-test=toggle]', 'background-color'), 'rgb(47, 111, 214)', '展開時「篩選」的底色')\nassertEqual(css('[data-test=toggle]', 'color'), 'rgb(255, 255, 255)', '展開時「篩選」的字色')\nclick('[data-test=toggle]')\nawait waitFor(() => css('[data-test=filters]', 'display') === 'none')" },
      { name: '1280：篩選區一直顯示，「篩選」按鈕隱藏', viewport: 1280, code: "assertEqual(css('[data-test=filters]', 'display'), 'flex', '1280 時篩選區要顯示成 flex')\nassertEqual(css('[data-test=toggle]', 'display'), 'none', '1280 時「篩選」按鈕要隱藏')" },
      { name: '390：頁面不用左右捲動', viewport: 390, code: "assert(document.documentElement.scrollWidth <= innerWidth, '頁面出現橫向捲軸（寬 ' + document.documentElement.scrollWidth + 'px）')" },
    ],
    hints: [
      '`@theme` 的變數要在 `--color-*` 命名空間裡（`--color-clinic`），才會產生 `bg-clinic` 這類 class。',
      '`md:`、`lg:` 都是 min-width：沒有前綴的寫手機版，`lg:grid-cols-4` 往寬的方向加。',
      '`aria-expanded:` 看的是元素自己的 `aria-expanded`；篩選區自己沒有這個屬性，改看它的 `data-state`：`data-[state=open]:flex`。',
    ],
  },
]

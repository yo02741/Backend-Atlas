import React, { useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Stepper, usePlayer, Code, Callout, useWidth } from './ui.jsx'

/* ============================================================
   渲染管線：從網址到畫面的七段
   - 首次載入：Stepper 逐段播放，DOM 與 render tree 跟著長出來；
     Toggle 切換 <head> 的 script 有沒有 defer，時間線顯示解析在哪裡停下（數字為示意）
   - 改了一個屬性：color / width / transform / 新增節點，各自要重跑哪幾段；
     transform 另有 Toggle「已經有自己的合成層」
   ============================================================ */

const STAGES = [
  { id: 'fetch', label: '請求', ev: 'Network' },
  { id: 'dom', label: 'DOM', ev: 'Parse HTML' },
  { id: 'cssom', label: 'CSSOM', ev: 'Parse stylesheet' },
  { id: 'tree', label: 'render tree', ev: 'Recalculate style' },
  { id: 'layout', label: 'layout', ev: 'Layout' },
  { id: 'paint', label: 'paint', ev: 'Paint' },
  { id: 'composite', label: 'composite', ev: 'Layerize · Commit' },
]

const FIRST_TEXT = {
  fetch: ['瀏覽器送出請求，HTML 的位元組一段一段回來。解析器不等整份下載完，收到多少就先解析多少。', '`<head>` 裡的 `main.css` 與 `analytics.js` 在解析到它們時才開始下載（preload scanner 會提早發現並送出請求）。'],
  dom: null, // 依 defer 切換，見 domText()
  cssom: ['`main.css` 解析成 CSSOM。樣式表會擋住渲染：還沒載完前，瀏覽器不畫第一個畫面，避免先畫出沒有樣式的內容再跳一次。', '這也是 `<head>` 裡的樣式表要小、要早送出的原因。'],
  tree: ['每個節點算出最後的樣式，只留要畫的節點組成 render tree。', '`display: none` 的「眼科 305」與 `<head>` 不在裡面；`visibility: hidden` 的 Toast 在，佔位置但不畫。'],
  layout: ['從根節點往下算出每個盒子的位置與大小：清單多寬、卡片多高、文字在哪裡換行。', '視窗寬度改變、字型載入完成時，這一段要整個重跑。'],
  paint: ['把文字、背景、邊框記錄成繪製指令，再點陣化成像素。', '頁面的內容分在幾個圖層上，各自畫；有 `will-change: transform` 的 Toast 是獨立的一層。'],
  composite: ['合成器執行緒把各個圖層依疊放順序組成最後的畫面，交給 GPU 顯示。', '之後如果只有某個圖層移動或變透明，可以只重跑這一段。'],
}

function domText(noDefer) {
  return noDefer
    ? ['解析器把標籤變成節點，一層層接成 DOM。', '解析到 `<head>` 裡沒有 `defer` 的 `<script>` 就停下：等它下載完、也等前面的 `main.css` 載完（script 可能讀樣式），執行完才繼續建 `<body>`。時間線上的斜線是解析停住的時間。']
    : ['解析器把標籤變成節點，一層層接成 DOM。', '`<script defer>` 在背景下載，解析一路進行到底；它等 DOM 建完才依出現的順序執行。`type="module"` 預設也是這樣。']
}

const CHANGES = {
  color: {
    label: '改 color', runs: ['tree', 'paint', 'composite'],
    code: `// 候診人數變多，數字改成紅色
count.style.color = 'crimson'`,
    title: '改 color：跳過 layout',
    text: ['顏色不影響任何盒子的大小與位置。瀏覽器重新計算這個元素的樣式後直接重畫，layout 整段跳過。', '`background-color`、`box-shadow`、`visibility` 也是這一類。重畫的範圍越小越好，Rendering 面板的 `Paint flashing` 會把重畫的區域標成綠色。'],
  },
  width: {
    label: '改 width', runs: ['tree', 'layout', 'paint', 'composite'],
    code: `// 清單從 60% 寬變成整排
list.style.width = '100%'`,
    title: '改 width：從 layout 開始全部重跑',
    text: ['寬度一變，每張卡片的寬度、文字換行、下面元素的位置都可能跟著變，所以從 layout 開始往後全部重跑。', '`height`、`padding`、`margin`、`font-size`、`top`、`left` 都是這一類；拿它們做動畫，每一格都要重算版面。'],
  },
  transform: {
    label: '改 transform',
  },
  add: {
    label: '新增節點', runs: ['dom', 'tree', 'layout', 'paint', 'composite'],
    code: `// 加開一個診間
const li = document.createElement('li')
li.textContent = '家醫 108 · 候診 3'
list.append(li)`,
    title: '新增節點：從 DOM 開始',
    text: ['`append` 改了 DOM：新節點要算樣式、加進 render tree、排進版面，後面每一段都要跑。', '一次加很多個時先組好再一次插入（`DocumentFragment`，或交給 Vue 在同一輪更新裡處理），中間不要讀 `offsetHeight` 這類尺寸，否則每讀一次就強迫算一次 layout。'],
  },
}

const transformCode = (hasLayer) => `/* CSS */
.toast {
${hasLayer ? '  will-change: transform;\n' : ''}  transition: transform 0.4s;
}
// JS：叫號時把 Toast 移進畫面
toast.style.transform = 'translateX(0)'`

function transformInfo(hasLayer) {
  return hasLayer
    ? { code: transformCode(true), runs: ['tree', 'composite'], title: '改 transform：只重跑合成', text: ['Toast 已經有自己的合成層（`will-change: transform`）。移動它只要把畫好的圖層換個位置疊上去，layout 與 paint 都跳過。', '合成由合成器執行緒負責，主執行緒正在跑 JavaScript 時動畫一樣順。`opacity` 也是這樣。'] }
    : { code: transformCode(false), runs: ['tree', 'paint', 'composite'], title: '沒有自己的合成層：還是要重畫', text: ['Toast 沒有自己的合成層，它的像素畫在父層裡。`transform` 不影響 layout，但移動它得重畫所在的那一層，所以 paint 也要跑。', '正在跑 `transform` 動畫的元素，瀏覽器通常會自動給它一層；要在動畫開始前就準備好，加 `will-change: transform`。'] }
}

const HEAD = (noDefer) => `<head>
  <link rel="stylesheet" href="/main.css">
  <script ${noDefer ? '' : 'defer '}src="/analytics.js"></script>
</head>
<body>
  <header><h1>今日門診</h1></header>
  <ul class="rooms">…</ul>
  <div class="toast">請 A012 到 101 診</div>
</body>`

/* 時間線（示意，單位 ms）：網路三條、主執行緒一條 */
const NET = [
  { a: 0, b: 20, t: 'HTML', c: 'blue' },
  { a: 16, b: 55, t: 'main.css', c: 'violet' },
  { a: 18, b: 66, t: 'analytics.js', c: 'yellow' },
]
const MAIN = {
  block: [
    { a: 0, b: 20, t: 'Parse HTML', k: 'parse' },
    { a: 20, b: 66, t: '解析暫停', k: 'wait' },
    { a: 66, b: 74, t: 'Eval', k: 'script' },
    { a: 74, b: 88, t: 'Parse', k: 'parse' },
    { a: 88, b: 100, t: 'Paint', k: 'render' },
  ],
  defer: [
    { a: 0, b: 38, t: 'Parse HTML', k: 'parse' },
    { a: 55, b: 66, t: 'Paint', k: 'render' },
    { a: 66, b: 74, t: 'Eval', k: 'script' },
  ],
}

export default function RenderPipelineLab() {
  const [mode, setMode] = useState('first')
  const [noDefer, setNoDefer] = useState(true)
  const [hasLayer, setHasLayer] = useState(true)
  const [applied, setApplied] = useState(false)
  const [replay, setReplay] = useState(0)
  const player = usePlayer(STAGES.length, 1300)
  const step = player.step

  const first = mode === 'first'
  const change = first ? null : mode === 'transform' ? { ...CHANGES.transform, ...transformInfo(hasLayer) } : CHANGES[mode]
  const pickMode = (m) => { setMode(m); setApplied(m !== 'first'); setReplay((r) => r + 1); player.setStep(0) }
  const rerun = () => { setApplied(true); setReplay((r) => r + 1) }

  const status = (s, i) => {
    if (first) return i < step ? 'done' : i === step ? 'cur' : 'pending'
    return change.runs.includes(s.id) ? 'run' : 'skip'
  }
  const badge = { done: '完成', cur: '進行中', pending: '', run: '重跑', skip: '跳過' }
  let runIdx = 0

  const explain = first
    ? { title: `${step + 1}. ${STAGES[step].label}`, text: STAGES[step].id === 'dom' ? domText(noDefer) : FIRST_TEXT[STAGES[step].id] }
    : { title: change.title, text: change.text }
  const reached = (id) => !first || STAGES.findIndex((s) => s.id === id) <= step

  return (
    <Lab className="rpl" accent="blue" kicker="BROWSER LAB" title="渲染管線：從網址到畫面的七段"
         blurb="HTML 與 CSS 變成畫面要經過的七個階段；改了不同的屬性時，哪幾段要重跑、哪幾段可以跳過。">
      <LabControls>
        <Seg label="情境" tinted value={mode} onChange={pickMode}
             options={[{ value: 'first', label: '首次載入' }, ...Object.entries(CHANGES).map(([v, c]) => ({ value: v, label: c.label }))]} />
        {first && <Toggle label="<head> 的 script 沒有 defer" checked={noDefer} onChange={setNoDefer} />}
        {mode === 'transform' && <Toggle label="Toast 已經有自己的合成層" checked={hasLayer} onChange={(v) => { setHasLayer(v); setReplay((r) => r + 1) }} />}
        <span className="spacer" />
        {first
          ? <Stepper step={step} total={STAGES.length} onStep={player.setStep} playing={player.playing} onPlay={player.toggle} />
          : <>
              <button type="button" className="btn ghost small" onClick={() => setApplied((a) => !a)}>{applied ? '還原' : '套用改動'}</button>
              <button type="button" className="btn ghost small" onClick={rerun}>重播</button>
            </>}
      </LabControls>

      <LabGrid>
        <div className="lab-stack">
          <LabStage label="渲染管線的七個階段" caption={first ? '小字：Chrome Performance 分頁裡對應的事件名稱' : '亮起的階段依序重跑，虛線的階段跳過'}>
            <ol className="rpl-pipe" key={`${mode}-${hasLayer}-${replay}`}>
              {STAGES.map((s, i) => {
                const st = status(s, i)
                const order = st === 'run' ? runIdx++ : 0
                return (
                  <li key={s.id} className={`rpl-stage ${st}`} style={{ '--i': order }}>
                    <b><span className="rpl-no">{i + 1}</span>{s.label}</b>
                    <small>{s.ev}</small>
                    {badge[st] && <em>{badge[st]}</em>}
                  </li>
                )
              })}
            </ol>
          </LabStage>

          {first
            ? <LabStage label="首次載入的時間線" caption="數字為示意；加了 defer 之後，先畫還是先執行 script 依瀏覽器的排程而定">
                <Timeline noDefer={noDefer} />
              </LabStage>
            : <LabStage label="畫面預覽" caption="預覽裡的變化對應上面亮起的階段">
                <Preview mode={mode} applied={applied} />
              </LabStage>}

          <LabStage plain label="DOM 與 render tree">
            <div className="rpl-trees">
              <Tree title="DOM" show={reached('dom')} added={mode === 'add' && applied} toastHidden={first} kind="dom" />
              <Tree title="render tree" show={reached('tree')} added={mode === 'add' && applied} toastHidden={first} kind="render" />
            </div>
          </LabStage>
        </div>

        <div className="lab-stack">
          <Code lang={first ? 'html' : 'js'} title={first ? 'index.html' : '這次的改動'} highlight={first ? [3] : []}>{first ? HEAD(noDefer) : change.code}</Code>
          <LabExplain title={explain.title}>
            {explain.text.map((t, i) => <p key={i} dangerouslySetInnerHTML={{ __html: md(t) }} />)}
          </LabExplain>
          <Callout title="工作上什麼時候用">
            寫動畫與轉場時只動 <code>transform</code> 與 <code>opacity</code>；畫面卡頓時，用 Performance 分頁看卡在 <code>Layout</code> 還是 <code>Paint</code>，再回頭找是哪個屬性的改動造成的。<code>&lt;head&gt;</code> 裡的 script 一律確認有 <code>defer</code> 或是 <code>type="module"</code>。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .rpl-pipe { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
        @media (max-width: 520px) { .rpl-pipe { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        .rpl-stage { position: relative; display: grid; gap: 2px; padding: 8px 8px 8px 10px; border: 1.5px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); transition: opacity 0.3s ease, border-color 0.3s ease, background 0.3s ease; }
        .rpl-stage b { font-size: 0.82rem; color: var(--ink-1); }
        .rpl-stage small { font-family: var(--mono); font-size: 0.66rem; color: var(--ink-3); overflow-wrap: anywhere; }
        .rpl-stage em { font-style: normal; font-size: 0.68rem; font-weight: 700; color: var(--lab-accent); }
        .rpl-no { font-family: var(--mono); font-size: 0.7rem; font-weight: 500; color: var(--ink-3); margin-right: 6px; }
        .rpl-stage.pending, .rpl-stage.skip { border-style: dashed; opacity: 0.5; }
        .rpl-stage.skip em { color: var(--ink-3); }
        .rpl-stage.done { border-color: color-mix(in srgb, var(--lab-accent) 45%, var(--hairline)); }
        .rpl-stage.cur, .rpl-stage.run { border-color: var(--lab-accent); background: color-mix(in srgb, var(--lab-accent) 14%, var(--surface-1)); }
        .rpl-stage.cur { box-shadow: 0 0 0 2px color-mix(in srgb, var(--lab-accent) 35%, transparent); }
        .rpl-stage.run { animation: rpl-run 0.45s ease-out both; animation-delay: calc(var(--i) * 160ms); }
        @keyframes rpl-run { from { background: var(--surface-1); border-color: var(--hairline); transform: translateY(4px); } to { transform: none; } }
        .rpl-tl .bar { stroke: none; }
        .rpl-tl .lane { font-size: 11px; fill: var(--ink-2); font-weight: 600; }
        .rpl-tl .seg-t { font-family: var(--mono); font-size: 10px; fill: var(--ink-1); }
        .rpl-tl .axis { stroke: var(--hairline); }
        .rpl-tl .tick { font-family: var(--mono); font-size: 9.5px; fill: var(--ink-3); }
        .rpl-tl .mark { stroke: var(--lab-accent); stroke-width: 1.5; stroke-dasharray: 3 3; }
        .rpl-tl .mark-t { font-size: 10.5px; fill: var(--lab-accent); font-weight: 700; }
        .rpl-trees { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        @media (max-width: 520px) { .rpl-trees { grid-template-columns: 1fr; } }
        .rpl-tree { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 8px 10px; min-height: 120px; }
        .rpl-tree h5 { margin: 0 0 6px; font-size: 0.74rem; letter-spacing: 0.06em; color: var(--ink-2); }
        .rpl-tree ul { list-style: none; margin: 0; padding: 0; font-family: var(--mono); font-size: 0.72rem; line-height: 1.6; }
        .rpl-tree li { color: var(--ink-1); overflow-wrap: anywhere; }
        .rpl-tree li .note { color: var(--ink-3); font-family: var(--sans); }
        .rpl-tree li.gone { color: var(--ink-3); }
        .rpl-tree li.ghost { color: var(--ink-2); font-style: italic; }
        .rpl-tree li.new { color: var(--lab-accent); font-weight: 700; animation: rpl-pop 0.35s ease-out both; }
        .rpl-tree .empty { color: var(--ink-3); font-size: 0.78rem; }
        @keyframes rpl-pop { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: none; } }
        .rpl-screen { position: relative; overflow: hidden; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 10px; min-height: 170px; }
        .rpl-screen header { font-weight: 700; font-size: 0.85rem; color: var(--ink-1); padding-bottom: 6px; border-bottom: 1px solid var(--hairline); margin-bottom: 8px; }
        .rpl-rooms { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; width: 60%; transition: width 0.45s ease; }
        .rpl-rooms.wide { width: 100%; }
        .rpl-rooms li { display: flex; justify-content: space-between; gap: 8px; font-size: 0.78rem; padding: 6px 8px; border: 1px solid var(--hairline); border-radius: 6px; background: var(--page); color: var(--ink-1); }
        .rpl-rooms li.new { border-color: var(--lab-accent); animation: rpl-pop 0.35s ease-out both; }
        .rpl-count { font-family: var(--mono); font-weight: 700; color: var(--ink-1); transition: color 0.35s ease; }
        .rpl-count.hot { color: var(--c-red); }
        .rpl-toast { position: absolute; right: 10px; bottom: 10px; padding: 6px 10px; border-radius: 6px; font-size: 0.76rem; font-weight: 700; color: var(--page); background: var(--ink-1); transform: translateX(calc(100% + 16px)); transition: transform 0.45s ease; }
        .rpl-toast.in { transform: translateX(0); }
        @media (prefers-reduced-motion: reduce) {
          .rpl-stage.run, .rpl-tree li.new, .rpl-rooms li.new { animation: none; }
          .rpl-rooms, .rpl-toast, .rpl-count { transition: none; }
        }
      `}</style>
    </Lab>
  )
}

/* SVG 文字寬度估算：中日韓字約 10.5px、其他約 6.1px（10px 等寬字） */
const textW = (t) => [...t].reduce((n, ch) => n + (/[\u2E80-\uFFFF]/.test(ch) ? 10.5 : 6.1), 8)

function md(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/`([^`]+)`/g, '<code>$1</code>') }

/* 首次載入的時間線：SVG 寬度跟著容器，手機上字不會被縮小 */
function Timeline({ noDefer }) {
  const ref = useRef(null)
  const w = Math.max(300, Math.round(useWidth(ref, 560)))
  const L = 64, R = 10, H = 150
  const x = (ms) => L + (ms / 100) * (w - L - R)
  const main = MAIN[noDefer ? 'block' : 'defer']
  const paint = main.find((s) => s.k === 'render')
  const fill = { parse: 'var(--lab-accent)', wait: 'var(--serious)', script: 'var(--c-yellow)', render: 'var(--c-green)' }
  return (
    <div ref={ref}>
      <svg className="rpl-tl" viewBox={`0 0 ${w} ${H}`} role="img"
           aria-label={noDefer ? '時間線：HTML 解析在 script 處停下，約 100 ms 才畫出第一個畫面' : '時間線：加了 defer，解析一路進行，約 55 ms 起可以畫出第一個畫面'}>
        <defs>
          <pattern id="rpl-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" style={{ fill: 'color-mix(in srgb, var(--serious) 12%, transparent)' }} />
            <line x1="0" y1="0" x2="0" y2="6" style={{ stroke: 'var(--serious)', strokeWidth: 2 }} />
          </pattern>
        </defs>
        <text x="0" y="16" className="lane">網路</text>
        {NET.map((s, i) => (
          <g key={s.t}>
            <rect className="bar" x={x(s.a)} y={6 + i * 17} width={x(s.b) - x(s.a)} height="13" rx="3" style={{ fill: `color-mix(in srgb, var(--c-${s.c}) 30%, var(--surface-1))` }} />
            <text x={x(s.a) + 4} y={16 + i * 17} className="seg-t">{s.t}</text>
          </g>
        ))}
        <text x="0" y="91" className="lane">主執行緒</text>
        {main.map((s) => (
          <g key={s.t + s.a}>
            <rect className="bar" x={x(s.a)} y="78" width={Math.max(2, x(s.b) - x(s.a))} height="20" rx="3"
                  style={{ fill: s.k === 'wait' ? 'url(#rpl-hatch)' : `color-mix(in srgb, ${fill[s.k]} 34%, var(--surface-1))` }} />
            {x(s.b) - x(s.a) > textW(s.t) && <text x={x(s.a) + 4} y="92" className="seg-t">{s.t}</text>}
          </g>
        ))}
        <line className="mark" x1={x(paint.a)} x2={x(paint.a)} y1="62" y2="104" />
        <text x={Math.min(x(paint.a), w - 70)} y="58" className="mark-t" textAnchor={x(paint.a) > w - 70 ? 'start' : 'middle'}>第一個畫面</text>
        <line className="axis" x1={L} x2={w - R} y1="114" y2="114" />
        {[0, 25, 50, 75, 100].map((t) => <text key={t} x={x(t)} y="128" className="tick" textAnchor={t === 100 ? 'end' : 'middle'}>{t} ms</text>)}
        <text x="0" y="145" className="tick">{noDefer ? '斜線：解析停在 <script>，等 JS 下載與 main.css' : 'defer：下載不擋解析，DOM 建完才執行'}</text>
      </svg>
    </div>
  )
}

/* 畫面預覽：改動套用後的樣子 */
function Preview({ mode, applied }) {
  const on = (m) => mode === m && applied
  return (
    <div className="rpl-screen" aria-label="門診看板的預覽">
      <header>今日門診</header>
      <ul className={`rpl-rooms${on('width') ? ' wide' : ''}`}>
        <li>內科 101 <span className={`rpl-count${on('color') ? ' hot' : ''}`}>候診 12</span></li>
        <li>骨科 203 <span className="rpl-count">候診 4</span></li>
        {on('add') && <li className="new">家醫 108 <span className="rpl-count">候診 3</span></li>}
      </ul>
      <div className={`rpl-toast${on('transform') ? ' in' : ''}`}>請 A012 到 101 診</div>
    </div>
  )
}

/* DOM 與 render tree：display:none 的節點不進 render tree，visibility:hidden 的進 */
function Tree({ title, show, added, toastHidden, kind }) {
  const dom = kind === 'dom'
  return (
    <div className="rpl-tree">
      <h5>{title}</h5>
      {!show ? <p className="empty">還沒建立</p> : (
        <ul>
          {dom && <li>html</li>}
          {dom && <li className="gone">&nbsp;&nbsp;head <span className="note">不進 render tree</span></li>}
          <li>&nbsp;&nbsp;body</li>
          <li>&nbsp;&nbsp;&nbsp;&nbsp;header › h1</li>
          <li>&nbsp;&nbsp;&nbsp;&nbsp;ul.rooms</li>
          <li>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;li 內科 101</li>
          <li>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;li 骨科 203</li>
          {dom && <li className="gone">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;li 眼科 305 <span className="note">display: none，不進 render tree</span></li>}
          {added && <li className="new">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;li 家醫 108</li>}
          {toastHidden
            ? <li className="ghost">&nbsp;&nbsp;&nbsp;&nbsp;div.toast <span className="note">{dom ? 'visibility: hidden' : '佔位、不畫'}</span></li>
            : <li>&nbsp;&nbsp;&nbsp;&nbsp;div.toast</li>}
        </ul>
      )}
    </div>
  )
}

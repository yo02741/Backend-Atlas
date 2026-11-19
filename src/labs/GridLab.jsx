import React, { useLayoutEffect, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Code, Callout, Status, useWidth } from './ui.jsx'

/* ============================================================
   Grid：舞台是真的 grid 容器（門診看板的卡片，或整頁的命名區域）
   - 卡片網格：grid-template-columns（固定欄數、fr、auto-fill、auto-fit）、minmax 下限、grid-auto-rows、gap、卡片數、容器寬
   - 命名區域：grid-template-areas 四種寫法（含一個無效的），側欄寬
   - 從 getComputedStyle 讀出實際的軌道寬度，用 SVG 畫格線、格線編號與每欄寬度
   - 三個隱藏的 grid 容器（358、736、1248px）量出 390、768、1280 三種視窗各排成幾欄
   ============================================================ */

const CARDS = [
  { dept: '內科', room: '101', doc: '王醫師', now: 23 },
  { dept: '骨科', room: '203', doc: '林醫師', now: 7, note: '加診至 21:00，初診請先到 2 樓櫃台報到' },
  { dept: '眼科', room: '305', doc: '陳醫師', now: 8, url: 'meet.clinic.example/room-305-video' },
  { dept: '皮膚科', room: '112', doc: '張醫師', now: 15 },
  { dept: '家醫科', room: '108', doc: '李醫師', now: 31 },
  { dept: '牙科', room: '215', doc: '吳醫師', now: 4 },
  { dept: '耳鼻喉科', room: '118', doc: '黃醫師', now: 19 },
  { dept: '復健科', room: '402', doc: '周醫師', now: 11 },
  { dept: '婦產科', room: '301', doc: '徐醫師', now: 6 },
]
const COLS = [
  { value: 'fixed3', label: 'repeat(3, 1fr)' },
  { value: 'side', label: '200px 1fr 1fr' },
  { value: 'fill', label: 'auto-fill' },
  { value: 'fit', label: 'auto-fit' },
]
const ROWS = ['auto', '100px', 'minmax(100px, auto)']
const PRESETS = {
  desktop: { label: '桌機', cols: (s) => `${s}px minmax(0, 1fr)`, areas: ['header header', 'side   main', 'side   foot'] },
  tablet: { label: '平板', cols: () => 'minmax(0, 1fr) minmax(0, 1fr)', areas: ['header header', 'main   main', 'side   foot'] },
  mobile: { label: '手機', cols: () => 'minmax(0, 1fr)', areas: ['header', 'main', 'side', 'foot'] },
  invalid: { label: '無效（不是長方形）', cols: (s) => `${s}px minmax(0, 1fr)`, areas: ['header header', 'side   main', 'header foot'] },
}
const AREAS = [
  { area: 'header', tag: 'header', text: '今日門診 · 總院區' },
  { area: 'side', tag: 'aside', text: '篩選：科別、時段' },
  { area: 'main', tag: 'main', text: '診間卡片 9 間 · 候診 47 人' },
  { area: 'foot', tag: 'footer', text: '最後更新 10:32' },
]
const VIEWPORTS = [390, 768, 1280] // 容器寬 = 視窗寬 − 左右各 16px
const PADL = 26, PADT = 38, PADR = 12, PADB = 10
const BOX = 19 // 容器的 padding 8px × 2 加框線 1.5px × 2；容器是 content-box，CSS 的 width 就是格線範圍的寬度
const px = (v) => `${Math.round(v * 10) / 10}`
const parseTracks = (s) => (!s || s === 'none' ? [] : s.replace(/\[[^\]]*\]/g, ' ').trim().split(/\s+/).map(parseFloat).filter((x) => !Number.isNaN(x)))

export default function GridLab() {
  const [mode, setMode] = useState('cards')
  const [cols, setCols] = useState('fill')
  const [zeroFr, setZeroFr] = useState(false)
  const [min, setMin] = useState(240)
  const [clampMin, setClampMin] = useState(false)
  const [rows, setRows] = useState('auto')
  const [gap, setGap] = useState(16)
  const [count, setCount] = useState(6)
  const [width, setWidth] = useState(820)
  const [notice, setNotice] = useState(false)
  const [preset, setPreset] = useState('desktop')
  const [side, setSide] = useState(200)
  const [last, setLast] = useState('cols')
  const set = (key, fn) => (v) => { fn(v); setLast(key) }

  const stageRef = useRef(null)
  const frameRef = useRef(null)
  const boxRef = useRef(null)
  const measRefs = useRef([])
  const stageW = useWidth(stageRef, 700)
  const effW = Math.max(200, Math.min(width, Math.floor(stageW) - PADL - PADR - BOX - 2))
  const auto = cols === 'fill' || cols === 'fit'
  const fr = zeroFr ? 'minmax(0, 1fr)' : '1fr'
  const lower = clampMin ? `min(${min}px, 100%)` : `${min}px`
  const P = PRESETS[preset]
  const template = mode === 'areas' ? P.cols(side)
    : cols === 'fixed3' ? `repeat(3, ${fr})`
      : cols === 'side' ? `200px ${fr} ${fr}`
        : `repeat(${cols === 'fill' ? 'auto-fill' : 'auto-fit'}, minmax(${lower}, 1fr))`
  const areasCss = P.areas.map((r) => `"${r}"`).join(' ')
  // 用 <style> 套上去，跟樣式表一樣：無效的宣告整條被丟掉（inline style 設無效值則會保留舊值）
  const liveCss = (mode === 'areas'
    ? `.grd-live { grid-template-columns: ${template}; grid-template-areas: ${areasCss}; gap: ${gap}px; }`
    : `.grd-live { grid-template-columns: ${template}; grid-auto-rows: ${rows}; gap: ${gap}px; } .grd-live > .notice { grid-column: 1 / -1; }`)
    + AREAS.map((a) => ` .grd-live > .a-${a.area} { grid-area: ${a.area}; }`).join('')

  const [m, setM] = useState({ cols: [], rows: [], ox: 0, oy: 0, over: 0, areas: '', meas: [] })
  useLayoutEffect(() => {
    const box = boxRef.current, frame = frameRef.current
    if (!box || !frame) return
    const cs = getComputedStyle(box)
    const b = box.getBoundingClientRect(), f = frame.getBoundingClientRect()
    const meas = measRefs.current.slice(0, VIEWPORTS.length).map((el) => {
      if (!el) return { n: 0, w: [], over: 0 }
      const w = parseTracks(getComputedStyle(el).gridTemplateColumns)
      return { n: w.filter((x) => x > 0.5).length, w: w.map((x) => Math.round(x * 10) / 10), over: overflow(el, w) }
    })
    const tracks = parseTracks(cs.gridTemplateColumns)
    const next = {
      cols: tracks.map((x) => Math.round(x * 100) / 100),
      rows: parseTracks(cs.gridTemplateRows).map((x) => Math.round(x * 100) / 100),
      ox: Math.round(b.left - f.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft)),
      oy: Math.round(b.top - f.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop)),
      over: overflow(box, tracks),
      areas: cs.gridTemplateAreas,
      meas,
    }
    setM((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
  })

  const items = (measure) => mode === 'areas'
    ? AREAS.map((a) => (
        <div key={a.area} className={`grd-area a-${a.area}`}>
          <b>&lt;{a.tag}&gt;</b><span>{a.text}</span>{!measure && <code>grid-area: {a.area}</code>}
        </div>
      ))
    : [
        ...(notice ? [<div key="notice" className="grd-card notice"><b>停診公告</b><span>骨科 203 診下午停診</span></div>] : []),
        ...CARDS.slice(0, count).map((c) => (
          <div key={c.room} className="grd-card">
            <b>{c.dept} {c.room}</b>
            <span>{c.doc} · 看診 {c.now} 號</span>
            {c.note && <span className="note">{c.note}</span>}
            {c.url && <code>{c.url}</code>}
          </div>
        )),
      ]

  const n = m.cols.filter((x) => x > 0.5).length
  const invalid = mode === 'areas' && m.areas === 'none'
  const css = mode === 'areas'
    ? ['.page {', '  display: grid;', `  grid-template-columns: ${template};`, '  grid-template-areas:', ...P.areas.map((r, i) => `    "${r}"${i === P.areas.length - 1 ? ';' : ''}`), `  gap: ${gap}px;`, `  width: ${width}px;`, '}',
        '.page > header { grid-area: header; }', '.page > aside  { grid-area: side; }', '.page > main   { grid-area: main; }', '.page > footer { grid-area: foot; }']
    : ['.board {', '  display: grid;', `  grid-template-columns: ${template};`, `  grid-auto-rows: ${rows};`, `  gap: ${gap}px;`, `  width: ${width}px;`, '}',
        ...(notice ? ['.notice {', '  grid-column: 1 / -1;', '}'] : [])]
  const find = (pre) => css.findIndex((l) => l.trimStart().startsWith(pre)) + 1
  const hl = {
    mode: [find('grid-template-columns')], cols: [find('grid-template-columns')], zeroFr: [find('grid-template-columns')], min: [find('grid-template-columns')], clamp: [find('grid-template-columns')], side: [find('grid-template-columns')],
    rows: [find('grid-auto-rows')], gap: [find('gap')], width: [find('width')], count: [], notice: [find('grid-column')],
    preset: Array.from({ length: P.areas.length + 1 }, (_, i) => find('grid-template-areas') + i),
  }[last] || []
  const ex = explain({ last, mode, cols, zeroFr, min, clampMin, rows, gap, count, effW, width, notice, preset, side, n, m, invalid })

  return (
    <Lab className="grd" accent="orange" kicker="CSS LAB" title="Grid：軌道、格線與命名區域"
         blurb="真的 grid 容器與門診看板：欄列軌道、fr、minmax、auto-fill 與 auto-fit、命名區域，格線編號與每欄寬度，以及 390、768、1280 三種寬度各排成幾欄。">
      <LabControls>
        <Seg label="版面" tinted value={mode} onChange={set('mode', setMode)} options={[{ value: 'cards', label: '卡片網格' }, { value: 'areas', label: '命名區域' }]} />
        {mode === 'cards'
          ? <Seg label="grid-template-columns" mono value={cols} onChange={set('cols', setCols)} options={COLS} />
          : <Seg label="grid-template-areas" value={preset} onChange={set('preset', setPreset)} options={Object.entries(PRESETS).map(([value, p]) => ({ value, label: p.label }))} />}
        <Slider label="gap" min={0} max={32} step={4} value={gap} onChange={set('gap', setGap)} format={(v) => `${v}px`} />
        <Slider label="容器寬度" min={280} max={900} step={10} value={width} onChange={set('width', setWidth)} format={(v) => `${v}px`} />
      </LabControls>
      <LabControls>
        {mode === 'cards' && auto && <Slider label="minmax 下限" min={120} max={320} step={20} value={min} onChange={set('min', setMin)} format={(v) => `${v}px`} />}
        {mode === 'cards' && auto && <Toggle label={`下限寫成 min(${min}px, 100%)`} checked={clampMin} onChange={set('clamp', setClampMin)} />}
        {mode === 'cards' && !auto && <Toggle label="1fr 改成 minmax(0, 1fr)" checked={zeroFr} onChange={set('zeroFr', setZeroFr)} />}
        {mode === 'cards' && <Seg label="grid-auto-rows" mono value={rows} onChange={set('rows', setRows)} options={ROWS.map((v) => ({ value: v, label: v }))} />}
        {mode === 'cards' && <Slider label="卡片數" min={2} max={CARDS.length} value={count} onChange={set('count', setCount)} format={(v) => `${v} 張`} />}
        {mode === 'cards' && <Toggle label="停診公告 grid-column: 1 / -1" checked={notice} onChange={set('notice', setNotice)} />}
        {mode === 'areas' && (preset === 'desktop' || preset === 'invalid') && <Slider label="側欄寬" min={160} max={320} step={20} value={side} onChange={set('side', setSide)} format={(v) => `${v}px`} />}
      </LabControls>

      <div className="lab-stack">
        <LabStage label="grid 容器與格線" caption={effW < width ? `畫面不夠寬，容器實際 ${effW}px（CSS 寫的是 ${width}px）` : '虛線是格線，上方的數字是格線編號與每欄算出來的寬度，左側是列的格線編號'}>
          <div ref={stageRef} className="grd-scroll">
            <div ref={frameRef} className="grd-frame" style={{ width: effW + BOX }}>
              <div ref={boxRef} className={`grd-board grd-live${mode === 'areas' ? ' areas' : ''}`} style={{ width: effW }}>{items(false)}</div>
              <Lines m={m} gap={gap} collapse={mode === 'cards' && cols === 'fit'} />
              <div className="grd-measure" aria-hidden="true">
                {VIEWPORTS.map((v, i) => (
                  <div key={v} ref={(el) => { measRefs.current[i] = el }} className={`grd-board grd-live${mode === 'areas' ? ' areas' : ''}`} style={{ width: v - 32 }}>{items(true)}</div>
                ))}
              </div>
            </div>
          </div>
        </LabStage>
        <div className="grd-stats" aria-live="polite">
          <span><b>{n}</b> 欄 × <b>{m.rows.length}</b> 列</span>
          {invalid ? <Status>grid-template-areas 無效，computed 值是 none</Status>
            : m.over > 1 ? <Status>溢出 {m.over}px</Status>
              : <Status ok>沒有溢出</Status>}
        </div>
        <div className="dtable-wrap">
          <table className="dtable grd-table">
            <caption>同一段 CSS 在三種視窗寬度（隱藏的 grid 容器實測）</caption>
            <thead><tr><th>視窗（容器）</th><th>欄</th><th>每欄寬</th><th>結果</th></tr></thead>
            <tbody>
              {VIEWPORTS.map((v, i) => {
                const r = m.meas[i] || { n: 0, w: [], over: 0 }
                return (
                  <tr key={v} className={r.over > 1 ? 'hit' : ''}>
                    <td>{v}（{v - 32}）</td><td>{r.n}</td>
                    <td>{r.w.filter((x) => x > 0.5).map(px).join(' · ')}</td>
                    <td>{invalid ? '區域無效' : r.over > 1 ? `溢出 ${r.over}px` : 'OK'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <LabGrid variant="even">
        <Code lang="css" title="目前的 CSS" highlight={hl}>{css.join('\n')}</Code>
        <div className="lab-stack">
          <LabExplain title={ex.title}>
            {ex.text.map((t, i) => <p key={i} dangerouslySetInnerHTML={{ __html: md(t) }} />)}
          </LabExplain>
          <Callout title="工作上什麼時候用">
            卡片牆、儀表板的區塊、整頁的頂端列＋側欄＋主欄，這類要對齊成欄與列的版面用 Grid：卡片牆寫 <code>repeat(auto-fill, minmax(min(240px, 100%), 1fr))</code>，整頁版面用 <code>grid-template-areas</code>，在 media query 裡換字串。只排成一排的工具列與按鈕列用 Flexbox。
          </Callout>
        </div>
      </LabGrid>

      <style>{liveCss}</style>
      <style>{`
        .grd > .lab-stack { margin-bottom: 18px; grid-template-columns: minmax(0, 1fr); }
        .grd-scroll { overflow-x: auto; }
        .grd-frame { position: relative; padding: ${PADT}px ${PADR}px ${PADB}px ${PADL}px; box-sizing: content-box; margin: 0 auto; }
        .grd-board { display: grid; box-sizing: content-box; padding: 8px; border: 1.5px dashed var(--lab-accent); border-radius: var(--radius); background: color-mix(in srgb, var(--lab-accent) 5%, var(--page)); }
        .grd-card, .grd-area { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border: 1px solid var(--hairline); border-radius: 6px; background: var(--surface-1); font-size: 0.78rem; color: var(--ink-2); animation: grd-in 0.3s ease-out both; }
        .grd-card b, .grd-area b { color: var(--ink-1); font-size: 0.84rem; }
        .grd-card .note { color: var(--ink-3); font-size: 0.74rem; }
        .grd-card code, .grd-area code { font-family: var(--mono); font-size: 0.72rem; color: var(--ink-3); }
        .grd-card.notice { background: color-mix(in srgb, var(--c-red) 12%, var(--surface-1)); border-color: color-mix(in srgb, var(--c-red) 45%, var(--hairline)); }
        .grd-board.areas { min-height: 220px; }
        .grd-area.a-header { background: color-mix(in srgb, var(--c-blue) 14%, var(--surface-1)); }
        .grd-area.a-side { background: color-mix(in srgb, var(--c-green) 14%, var(--surface-1)); }
        .grd-area.a-main { background: color-mix(in srgb, var(--c-yellow) 16%, var(--surface-1)); }
        .grd-area.a-foot { background: color-mix(in srgb, var(--c-violet) 14%, var(--surface-1)); }
        .grd-lines { position: absolute; left: 0; top: 0; pointer-events: none; overflow: visible; z-index: 2; }
        .grd-lines .gl { stroke: var(--lab-accent); stroke-width: 1.5; stroke-dasharray: 5 3; }
        .grd-lines .gapr { fill: var(--lab-accent); opacity: 0.12; }
        .grd-lines .num { fill: var(--lab-accent); font-size: 10.5px; font-weight: 700; font-family: var(--mono); }
        .grd-lines .size { fill: var(--ink-3); font-size: 10.5px; font-family: var(--mono); }
        .grd-stats { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; font-size: 0.8rem; color: var(--ink-3); }
        .grd-stats b { font-family: var(--mono); color: var(--ink-1); }
        .grd-table td:nth-child(3) { white-space: normal; }
        .grd-measure { position: absolute; left: 0; top: 0; width: 0; height: 0; overflow: hidden; visibility: hidden; }
        .grd-measure > .grd-board { position: absolute; top: 0; left: 0; padding: 0; border: 0; }
        @keyframes grd-in { from { opacity: 0.4; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .grd-card, .grd-area { animation: none; } }
      `}</style>
    </Lab>
  )
}

/* 軌道加 gap 超出容器的寬度（auto-fit 收成 0 的軌道不算 gap） */
function overflow(el, tracks) {
  const cs = getComputedStyle(el)
  const used = tracks.filter((t) => t > 0.5)
  const total = used.reduce((a, b) => a + b, 0) + (parseFloat(cs.columnGap) || 0) * Math.max(0, used.length - 1)
  return Math.max(0, Math.round(total - parseFloat(cs.width)))
}

function md(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/`([^`]+)`/g, '<code>$1</code>') }

/* 格線：依 computed 的軌道寬度與 gap 算出每條線的位置；gap 畫成淡色帶，線畫在 gap 中間 */
function Lines({ m, gap, collapse }) {
  const edges = (tracks, g) => {
    const starts = [], ends = []
    let x = 0
    tracks.forEach((t, i) => {
      const gone = collapse && t < 0.5            // auto-fit 收掉的軌道，兩側的 gap 也一起收掉
      if (i > 0 && !gone) x += g
      starts.push(x); x += t; ends.push(x)
    })
    return { starts, ends, total: x }
  }
  if (!m.cols.length) return null
  const cx = edges(m.cols, gap), ry = edges(m.rows, gap)
  const W = m.ox + cx.total + PADR, H = m.oy + ry.total + PADB
  const lineX = m.cols.map((_, i) => (i === 0 ? 0 : (cx.ends[i - 1] + cx.starts[i]) / 2)).concat(cx.total)
  const lineY = m.rows.map((_, i) => (i === 0 ? 0 : (ry.ends[i - 1] + ry.starts[i]) / 2)).concat(ry.total)
  const labels = []
  lineX.forEach((x, i) => {
    const prev = labels[labels.length - 1]
    const text = i === lineX.length - 1 ? `${i + 1} (-1)` : `${i + 1}`
    if (prev && Math.abs(prev.x - x) < 14) prev.text += `/${text}`
    else labels.push({ x, text })
  })
  return (
    <svg className="grd-lines" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
         aria-label={`${m.cols.filter((c) => c > 0.5).length} 條欄軌道、${m.rows.length} 條列軌道的格線`}>
      <g transform={`translate(${m.ox} ${m.oy})`}>
        {m.cols.slice(1).map((_, i) => cx.starts[i + 1] > cx.ends[i] && <rect key={`gc${i}`} className="gapr" x={cx.ends[i]} y={0} width={cx.starts[i + 1] - cx.ends[i]} height={ry.total} />)}
        {m.rows.slice(1).map((_, i) => ry.starts[i + 1] > ry.ends[i] && <rect key={`gr${i}`} className="gapr" x={0} y={ry.ends[i]} width={cx.total} height={ry.starts[i + 1] - ry.ends[i]} />)}
        {lineX.map((x, i) => <line key={`lx${i}`} className="gl" x1={x} x2={x} y1={-8} y2={ry.total} />)}
        {lineY.map((y, i) => <line key={`ly${i}`} className="gl" x1={-8} x2={cx.total} y1={y} y2={y} />)}
        {labels.map((l) => <text key={`n${l.x}`} className="num" x={l.x} y={-24} textAnchor="middle">{l.text}</text>)}
        {m.cols.map((t, i) => t > 0.5 && <text key={`s${i}`} className="size" x={(cx.starts[i] + cx.ends[i]) / 2} y={-11} textAnchor="middle">{px(t)}</text>)}
        {lineY.map((y, i) => <text key={`r${i}`} className="num" x={-12} y={y + 4} textAnchor="end">{i + 1}</text>)}
      </g>
    </svg>
  )
}

/* 說明：跟著最後改的那個控制項 */
function explain({ last, mode, cols, zeroFr, min, clampMin, rows, gap, count, effW, width, notice, preset, side, n, m, invalid }) {
  const sizes = m.cols.filter((x) => x > 0.5).map((x) => `${px(x)}px`).join('、')
  const tracks = Math.max(1, m.cols.length)
  const isAuto = cols === 'fill' || cols === 'fit'
  if (mode === 'areas' && last === 'gap') return { title: `gap: ${gap}px`, text: ['區域之間的距離也是 `gap`：欄與欄、列與列之間各一段，外圍沒有。', `側欄與主欄現在是 ${sizes}。`] }
  if (mode === 'areas' && last === 'width') return { title: `容器寬度 ${effW}px`, text: [`欄寬現在是 ${sizes}。固定寬的側欄不讓，\`minmax(0, 1fr)\` 的欄拿剩下的空間。`, '對照下面的表格：同一組字串在 390px 時主欄剩多少，決定要不要在 media query 裡換成單欄。'] }
  if (mode === 'areas') {
    const T = {
      desktop: ['每個字串是一列：`header` 佔第一列兩格，`side` 佔左邊兩列，`main` 與 `foot` 疊在右邊。同名的格子組成一個區域，子項寫 `grid-area: main` 就放進去。', `側欄 ${side}px，主欄 \`minmax(0, 1fr)\` 拿剩下的空間。下面的表格看得出，這段 CSS 在 390px 時主欄只剩很窄一條，手機要用 media query 換成單欄的字串。`],
      tablet: ['`main` 佔第二列整列，`side` 與 `foot` 在第三列並排。兩欄都是 `minmax(0, 1fr)`，平分寬度。', '換斷點時只改容器的 `grid-template-columns` 與 `grid-template-areas`，子項的 `grid-area` 不用動。'],
      mobile: ['單欄：四個區域由上往下排，順序由字串決定。手機常把側欄放到主內容後面，或收進 Drawer。', '畫面順序改了，DOM 順序沒變；鍵盤 Tab 與螢幕閱讀器照 DOM 走，順序差太多時改 DOM。'],
      invalid: ['`header` 出現在第一列與第三列左格，不是長方形，整條 `grid-template-areas` 無效，computed 值變成 `none`，瀏覽器不會只丟掉第三列。', '四個寫了 `grid-area` 的項目找不到區域，全部疊在同一個位置，擠進格線外新長出的隱式軌道。DevTools 的 Styles 分頁會把這行劃掉並顯示警告圖示。'],
    }
    return { title: `grid-template-areas：${PRESETS[preset].label}`, text: invalid && preset !== 'invalid' ? T.invalid : T[preset] }
  }
  switch (last) {
    case 'mode':
    case 'cols': {
      if (cols === 'fixed3') return { title: 'repeat(3, 1fr)', text: [`固定三欄，容器寬度怎麼變都是三欄：扣掉兩段 gap 後平分，現在是 ${sizes}。`, '把容器寬度拉到最小：欄位一直變窄，手機上卡片會被擠成三條窄欄。欄數要跟著寬度變，改用 `auto-fill`。'] }
      if (cols === 'side') return { title: '200px 1fr 1fr', text: [`第一欄先拿 200px，扣掉 gap 後剩下的空間兩個 \`1fr\` 平分：${sizes}。`, '`fr` 分的是剩下的空間。容器變窄時固定欄不讓，`1fr` 的欄先被擠窄，擠到內容的最小寬度後就溢出。'] }
      if (cols === 'fill') return { title: 'repeat(auto-fill, minmax(…, 1fr))', text: [`上限是 \`1fr\`，瀏覽器用下限 ${min}px 算放得下幾欄：（${effW} + ${gap}）÷（${min} + ${gap}）取整數是 ${tracks}。算出欄數後每欄再平分剩下的空間，現在是 ${sizes}。`, '卡片數少於欄數時，`auto-fill` 留下空欄，卡片維持原來的寬度。'] }
      return { title: 'repeat(auto-fit, minmax(…, 1fr))', text: ['`auto-fit` 算欄數的方法和 `auto-fill` 一樣，差別在沒有項目的軌道收成 0、兩側的 gap 也一起收掉。', count < tracks && !notice ? `現在 ${count} 張卡片、${tracks} 條軌道：空的 ${tracks - count} 條收成 0，卡片被拉寬到 ${sizes}。` : notice ? '停診公告橫跨所有軌道，每條軌道都有項目，沒有可以收的空軌道，看起來和 `auto-fill` 一樣。' : '卡片填滿了一整列，和 `auto-fill` 看不出差別；把卡片數拉到 2 張看看。'] }
    }
    case 'zeroFr': return zeroFr
      ? { title: 'minmax(0, 1fr)', text: [`下限從內容寬度改成 0，${cols === 'side' ? '兩個 fr 欄' : '三欄'}硬性平分：${sizes}。`, '眼科那張的長網址現在溢出自己的格子，再加 `overflow-wrap: anywhere` 讓它換行。'] }
      : { title: '1fr 的下限', text: [`\`1fr\` 等於 \`minmax(auto, 1fr)\`，下限是內容的最小寬度。眼科那張卡片有一個不能斷開的網址，容器窄時那一欄被撐寬：${sizes}。`, '把容器寬度往小拉，比較打開與關閉 `minmax(0, 1fr)` 時每欄的寬度。'] }
    case 'min': return { title: `minmax(${min}px, 1fr)`, text: [`下限 ${min}px 時放得下 ${tracks} 欄。下限越大欄數越少，每欄再平分剩下的空間：${sizes}。`, '下限是卡片能接受的最窄寬度；寫成 `1fr` 的上限讓每欄一起長，最後一列也對齊同一組欄線。'] }
    case 'clamp': return clampMin
      ? { title: `min(${min}px, 100%)`, text: [`容器比 ${min}px 窄時，下限改成容器的寬度，一欄剛好填滿、不溢出。`, '同一個元件會放進窄側欄時，這樣寫最保險。'] }
      : { title: `下限固定 ${min}px`, text: [`容器比 ${min}px 窄時，那一欄仍是 ${min}px，超出容器。`, '把容器寬度拉到最小、下限拉到最大，看溢出；再打開 `min(…, 100%)`。'] }
    case 'rows': return {
      title: `grid-auto-rows: ${rows}`,
      text: rows === 'auto' ? ['這裡只定義了欄，列全是隱式軌道，大小由 `grid-auto-rows` 決定；`auto` 依內容。', '同一列的卡片預設 `align-items: stretch`，被拉成和最高的一樣高。']
        : rows === '100px' ? ['每一列固定 100px。骨科那張的備註比較長，容器窄時內容超出卡片、疊到下一列上。', '固定高度只適合內容長度固定的格子。']
          : ['`minmax(100px, auto)`：每列至少 100px，內容多的那一列自動長高，其他列維持 100px。', `現在的列高是 ${m.rows.map((r) => `${px(r)}px`).join('、')}。`],
    }
    case 'gap': return { title: `gap: ${gap}px`, text: [`gap 只加在軌道之間，不加在外圍：${n} 欄有 ${Math.max(0, n - 1)} 段欄距，共 ${gap * Math.max(0, n - 1)}px。`, '`auto-fill` 算欄數時也要把 gap 算進去，gap 變大可能少排一欄。'] }
    case 'count': return { title: `${count} 張卡片`, text: [`${count} 張卡片排進 ${n} 欄，共 ${m.rows.length} 列。沒有指定位置的項目照 DOM 順序一格一格填。`, cols === 'fit' ? '`auto-fit` 時卡片少於欄數，空軌道會收成 0，卡片被拉寬。' : cols === 'fill' ? '`auto-fill` 時卡片少於欄數，右邊留空欄，卡片寬度不變。' : '固定欄數時卡片數只影響列數。'] }
    case 'notice': return notice
      ? { title: 'grid-column: 1 / -1', text: ['從第 1 條格線跨到最後一條（`-1`），不論現在幾欄都佔滿整列；`-1` 指的是最後一條明確定義的格線，`auto-fill` 算出來的也算。', 'auto-fit 時它佔住了所有軌道，沒有空軌道可以收。'] }
      : { title: '停診公告：自動放置', text: ['沒有 `grid-column` 時，公告照 DOM 順序填進第一格，和其他卡片一樣寬。'] }
    default: return { title: `容器寬度 ${effW}px`, text: [isAuto ? `放得下 ${tracks} 欄，每欄 ${sizes}。欄數只跟容器寬度、下限與 gap 有關，不用 media query。` : `固定的欄數不跟著寬度變，現在每欄 ${sizes}。`, m.over > 1 ? `內容縮不下去，溢出 ${m.over}px。` : width !== effW ? `畫面不夠寬，示範用的容器縮成 ${effW}px。` : '下面的表格是同一段 CSS 在三種視窗寬度實際排出來的欄數。'] }
  }
}

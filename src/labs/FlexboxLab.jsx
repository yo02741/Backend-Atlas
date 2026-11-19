import React, { useLayoutEffect, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Code, Callout, Status, useWidth } from './ui.jsx'

/* ============================================================
   Flexbox：舞台是真的 flex 容器，五張門診卡片
   - 容器：flex-direction、justify-content、align-items、flex-wrap、gap、寬度
   - 第二張卡片：flex-grow、flex-shrink、flex-basis
   - SVG 疊一層主軸與交叉軸箭頭，跟著 flex-direction 轉；右側即時顯示 CSS
   - 量測實際尺寸：第二張卡片多寬、剩餘空間或溢出多少、排成幾行
   ============================================================ */

const CARDS = [
  { dept: '內科', room: '101', doc: '王醫師', wait: 12 },
  { dept: '骨科', room: '203', doc: '林醫師', wait: 4 },
  { dept: '眼科', room: '305', doc: '陳醫師', wait: 9, tag: 'telemedicine' },
  { dept: '皮膚科', room: '112', doc: '張醫師', wait: 0 },
  { dept: '家醫科', room: '108', doc: '李醫師', wait: 6 },
]
const DIRS = ['row', 'column', 'row-reverse', 'column-reverse']
const JUSTIFY = ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly']
const ALIGN = ['stretch', 'flex-start', 'center', 'flex-end', 'baseline']
const BASIS = ['auto', '0', '120px', '240px']
const COL_H = 320
const PAD = 26 // 容器外圍留給軸線箭頭與標籤的空間

export default function FlexboxLab() {
  const [dir, setDir] = useState('row')
  const [justify, setJustify] = useState('flex-start')
  const [align, setAlign] = useState('stretch')
  const [wrap, setWrap] = useState(false)
  const [gap, setGap] = useState(12)
  const [width, setWidth] = useState(640)
  const [grow, setGrow] = useState(0)
  const [shrink, setShrink] = useState(1)
  const [basis, setBasis] = useState('auto')
  const [last, setLast] = useState('dir')
  const set = (key, fn) => (v) => { fn(v); setLast(key) }

  const stageRef = useRef(null)
  const boxRef = useRef(null)
  const stageW = useWidth(stageRef, 600)
  const effW = Math.max(200, Math.min(width, Math.floor(stageW) - PAD * 2 - 2))
  const clamped = effW < width
  const isRow = dir.startsWith('row')
  const [m, setM] = useState({ main: 0, used: 0, card2: 0, lines: 1, w: 0, h: 0 })

  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    const cards = [...box.children]
    const cs = getComputedStyle(box)
    const padMain = isRow ? parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) : parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
    const main = (isRow ? box.clientWidth : box.clientHeight) - padMain
    const sizes = cards.map((c) => (isRow ? c.offsetWidth : c.offsetHeight))
    const used = sizes.reduce((a, b) => a + b, 0) + gap * (cards.length - 1)
    const lines = new Set(cards.map((c) => (isRow ? c.offsetTop : c.offsetLeft))).size
    const next = { main: Math.round(main), used: Math.round(used), card2: sizes[1], lines, w: box.offsetWidth, h: box.offsetHeight }
    setM((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
  })

  const free = m.main - m.used
  const flexShort = `${grow} ${shrink} ${basis}`
  const css = [
    '.board {',
    '  display: flex;',
    `  flex-direction: ${dir};`,
    `  justify-content: ${justify};`,
    `  align-items: ${align};`,
    `  flex-wrap: ${wrap ? 'wrap' : 'nowrap'};`,
    `  gap: ${gap}px;`,
    `  width: ${width}px;`,
    ...(isRow ? [] : [`  height: ${COL_H}px;`]),
    '}',
    '.card:nth-child(2) {',
    `  flex-grow: ${grow};`,
    `  flex-shrink: ${shrink};`,
    `  flex-basis: ${basis};`,
    `  /* 縮寫：flex: ${flexShort} */`,
    '}',
  ]
  const lineOf = { dir: 3, justify: 4, align: 5, wrap: 6, gap: 7, width: 8, grow: css.indexOf(`  flex-grow: ${grow};`) + 1, shrink: css.indexOf(`  flex-shrink: ${shrink};`) + 1, basis: css.indexOf(`  flex-basis: ${basis};`) + 1 }
  const ex = explain({ last, dir, justify, align, wrap, gap, width, effW, grow, shrink, basis, free, m, isRow })

  return (
    <Lab className="fbx" accent="orange" kicker="CSS LAB" title="Flexbox：主軸、交叉軸與剩餘空間"
         blurb="一個真的 flex 容器與五張門診卡片：容器與子項的屬性怎麼決定排列，主軸與交叉軸的方向，以及對應的 CSS。">
      <LabControls>
        <Seg label="flex-direction" mono value={dir} onChange={set('dir', setDir)} options={DIRS.map((v) => ({ value: v, label: v }))} />
        <Seg label="justify-content" mono value={justify} onChange={set('justify', setJustify)} options={JUSTIFY.map((v) => ({ value: v, label: v }))} />
        <Seg label="align-items" mono value={align} onChange={set('align', setAlign)} options={ALIGN.map((v) => ({ value: v, label: v }))} />
        <Toggle label="flex-wrap: wrap" checked={wrap} onChange={set('wrap', setWrap)} />
        <Slider label="gap" min={0} max={32} step={4} value={gap} onChange={set('gap', setGap)} format={(v) => `${v}px`} />
        <Slider label="容器寬度" min={280} max={900} step={10} value={width} onChange={set('width', setWidth)} format={(v) => `${v}px`} />
      </LabControls>
      <LabControls>
        <span className="fbx-tag">② 第二張卡片</span>
        <Slider label="flex-grow" min={0} max={3} value={grow} onChange={set('grow', setGrow)} />
        <Slider label="flex-shrink" min={0} max={3} value={shrink} onChange={set('shrink', setShrink)} />
        <Seg label="flex-basis" mono value={basis} onChange={set('basis', setBasis)} options={BASIS.map((v) => ({ value: v, label: v }))} />
      </LabControls>

      <div className="lab-stack">
          <LabStage label="flex 容器與五張卡片" caption={clamped ? `畫面不夠寬，容器實際 ${effW}px（CSS 寫的是 ${width}px）` : '虛線框是 flex 容器；實線箭頭是主軸，虛線箭頭是交叉軸'}>
            <div ref={stageRef} className="fbx-scroll">
              <div className="fbx-frame" style={{ width: effW + PAD * 2, height: isRow ? undefined : COL_H + PAD * 2 }}>
                <Axes dir={dir} w={(m.w || effW) + PAD * 2} h={(m.h || 120) + PAD * 2} />
                <div ref={boxRef} className={`fbx-board${isRow ? '' : ' col'}`} style={{ flexDirection: dir, justifyContent: justify, alignItems: align, flexWrap: wrap ? 'wrap' : 'nowrap', gap, width: effW, height: isRow ? undefined : COL_H }}>
                  {CARDS.map((c, i) => (
                    <div key={c.room} className={`fbx-card${i === 1 ? ' sel' : ''}${i === 0 ? ' big' : ''}`}
                         style={i === 1 ? { flexGrow: grow, flexShrink: shrink, flexBasis: basis } : undefined}>
                      <b>{i === 1 ? '② ' : ''}{c.dept} {c.room}</b>
                      <span>{c.doc} · 候診 {c.wait}</span>
                      {c.tag && <code>{c.tag}</code>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </LabStage>
          <div className="fbx-stats" aria-live="polite">
            <span>主軸長度 <b>{m.main}px</b></span>
            <span>② {isRow ? '寬' : '高'} <b>{m.card2}px</b></span>
            {wrap && m.lines > 1
              ? <Status ok>換成 {m.lines} 行</Status>
              : free > 0 ? <Status ok>剩餘空間 {free}px</Status>
                : free < 0 ? <Status>溢出 {-free}px</Status> : <Status warn>剛好填滿</Status>}
          </div>
      </div>

      <LabGrid variant="even">
        <Code lang="css" title="目前的 CSS" highlight={[lineOf[last]]}>{css.join('\n')}</Code>
        <div className="lab-stack">
          <LabExplain title={ex.title}>
            {ex.text.map((t, i) => <p key={i} dangerouslySetInnerHTML={{ __html: md(t) }} />)}
          </LabExplain>
          <Callout title="工作上什麼時候用">
            頂端列、按鈕列、卡片列這類「一個方向排一排」的版面用 Flexbox：要吃掉剩餘空間的那一個給 <code>flex: 1</code> 與 <code>min-width: 0</code>，按鈕給 <code>flex: none</code>，間距用 <code>gap</code>。要對齊成欄與列的二維版面改用 Grid。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .fbx > .lab-stack { margin-bottom: 18px; grid-template-columns: minmax(0, 1fr); }
        .fbx-tag { font-size: 0.78rem; font-weight: 700; color: var(--lab-accent); letter-spacing: 0.04em; }
        .fbx-scroll { overflow-x: auto; }
        .fbx-frame { position: relative; padding: ${PAD}px; box-sizing: border-box; margin: 0 auto; }
        .fbx-axes { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
        .fbx-axes .main { stroke: var(--lab-accent); stroke-width: 2.5; }
        .fbx-axes .cross { stroke: var(--ink-3); stroke-width: 1.5; stroke-dasharray: 4 3; }
        .fbx-axes .lbl { font-size: 10.5px; font-weight: 700; }
        .fbx-axes .lbl.main-t { fill: var(--lab-accent); }
        .fbx-axes .lbl.cross-t { fill: var(--ink-3); }
        .fbx-board { display: flex; box-sizing: border-box; padding: 8px; border: 1.5px dashed var(--lab-accent); border-radius: var(--radius); background: color-mix(in srgb, var(--lab-accent) 5%, var(--page)); transition: background 0.3s ease; }
        .fbx-card { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border: 1px solid var(--hairline); border-radius: 6px; background: var(--surface-1); font-size: 0.78rem; color: var(--ink-2); animation: fbx-in 0.3s ease-out both; }
        .fbx-card b { color: var(--ink-1); font-size: 0.84rem; white-space: nowrap; }
        .fbx-card.big b { font-size: 1.05rem; }
        .fbx-card code { font-family: var(--mono); font-size: 0.72rem; color: var(--ink-3); }
        .fbx-board.col .fbx-card { flex-direction: row; flex-wrap: wrap; align-items: baseline; column-gap: 10px; padding: 6px 10px; }
        .fbx-card.sel { border: 2px solid var(--lab-accent); background: color-mix(in srgb, var(--lab-accent) 12%, var(--surface-1)); }
        @keyframes fbx-in { from { opacity: 0.4; } to { opacity: 1; } }
        .fbx-stats { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; font-size: 0.8rem; color: var(--ink-3); }
        .fbx-stats b { font-family: var(--mono); color: var(--ink-1); }
        @media (prefers-reduced-motion: reduce) { .fbx-card { animation: none; } .fbx-board { transition: none; } }
      `}</style>
    </Lab>
  )
}

function md(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/`([^`]+)`/g, '<code>$1</code>') }

/* 主軸（實線）與交叉軸（虛線）箭頭：畫在容器外圍的留白裡，方向跟著 flex-direction */
function Axes({ dir, w, h }) {
  const isRow = dir.startsWith('row')
  const rev = dir.endsWith('reverse')
  const e = PAD - 6 // 箭頭離容器 6px
  const horiz = { x1: PAD, x2: w - PAD, y1: e, y2: e }
  const vert = { x1: e, x2: e, y1: PAD, y2: h - PAD }
  const flip = (l) => ({ x1: l.x2, x2: l.x1, y1: l.y2, y2: l.y1 })
  const main = isRow ? (rev ? flip(horiz) : horiz) : (rev ? flip(vert) : vert)
  const cross = isRow ? vert : horiz
  return (
    <svg className="fbx-axes" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img"
         aria-label={`主軸${isRow ? '水平' : '垂直'}${rev ? '（反向）' : ''}，交叉軸${isRow ? '垂直' : '水平'}`}>
      <defs>
        <marker id="fbx-arrow-m" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L8 4 L0 8 z" style={{ fill: 'var(--lab-accent)' }} /></marker>
        <marker id="fbx-arrow-c" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L8 4 L0 8 z" style={{ fill: 'var(--ink-3)' }} /></marker>
      </defs>
      <line className="cross" {...cross} markerEnd="url(#fbx-arrow-c)" />
      <line className="main" {...main} markerEnd="url(#fbx-arrow-m)" />
      {isRow
        ? <>
            <text className="lbl main-t" x={rev ? w - PAD : PAD} y={e - 6} textAnchor={rev ? 'end' : 'start'}>主軸 · justify-content</text>
            <text className="lbl cross-t" x="2" y={h - 8}>交叉軸 · align-items</text>
          </>
        : <>
            <text className="lbl cross-t" x={PAD} y={e - 6}>交叉軸 · align-items</text>
            <text className="lbl main-t" x="2" y={h - 8}>主軸 · justify-content</text>
          </>}
    </svg>
  )
}

/* 說明：跟著最後改的那個屬性 */
function explain({ last, dir, justify, align, wrap, gap, width, effW, grow, shrink, basis, free, m, isRow }) {
  const mainDir = isRow ? '水平' : '垂直'
  const crossDir = isRow ? '垂直' : '水平'
  const noRoom = free <= 0 && !(wrap && m.lines > 1)
  const J = {
    'flex-start': '全部擠在主軸的起點，剩下的空間留在終點那一側。',
    center: '整組置中，剩下的空間平分在兩側。',
    'flex-end': '全部擠在主軸的終點。',
    'space-between': '第一張貼起點、最後一張貼終點，剩下的空間平分在卡片之間。',
    'space-around': '每張卡片兩側各分到一份空間，所以頭尾的間距是中間的一半。',
    'space-evenly': '頭尾與卡片之間的間距全部相等。',
  }
  const A = {
    stretch: `預設值：沒有寫死${isRow ? '高度' : '寬度'}的卡片被拉滿這一行的交叉軸，所以${isRow ? '一排卡片等高' : '每張卡片一樣寬'}。`,
    'flex-start': '卡片依內容大小，對齊交叉軸的起點。',
    center: '卡片在交叉軸上置中，圖示與文字的垂直置中常用這個。',
    'flex-end': '卡片對齊交叉軸的終點。',
    baseline: `第一行文字的基線對齊：第一張卡片的字比較大，其他卡片會往下移，讓文字底線切齊。${isRow ? '' : '直排時卡片沒辦法依基線對齊，瀏覽器退回成靠起點對齊，看起來和 flex-start 相同。'}`,
  }
  switch (last) {
    case 'dir': return { title: `flex-direction: ${dir}`, text: [`主軸現在是${mainDir}${dir.endsWith('reverse') ? '（反向）' : ''}，所以 \`justify-content\` 管${mainDir}、\`align-items\` 管${crossDir}；改了方向，同一行 CSS 的效果跟著轉 90 度。`, dir.endsWith('reverse') ? '`-reverse` 只改畫面上的順序，DOM 順序不變，鍵盤 Tab 仍照 DOM 走。有互動元素時少用。' : isRow ? '橫排是預設值，主軸依書寫方向由左到右。' : `直排時容器的高度通常由內容撐開；這裡給了 \`height: ${COL_H}px\`，\`justify-content\` 才有空間可以分。`] }
    case 'justify': return { title: `justify-content: ${justify}`, text: [`擺放的是主軸上的剩餘空間：${J[justify]}`, noRoom ? '現在沒有剩餘空間，看不出差別：把容器拉寬，或把第二張的 `flex-grow` 設回 0。' : `目前剩下 ${free}px 可以分。只要有任何子項的 \`flex-grow\` 大於 0，空間會先被它吃掉。`] }
    case 'align': return { title: `align-items: ${align}`, text: [A[align], `交叉軸是${crossDir}方向。單一子項要不一樣時，在子項上寫 \`align-self\`。`] }
    case 'wrap': return { title: `flex-wrap: ${wrap ? 'wrap' : 'nowrap'}`, text: wrap ? [`放不下就換行，現在排成 ${m.lines} 行。每一行各自分配剩餘空間，所以換行後最後一行的卡片可能被拉得比較寬。`, '多行之間的分配由 `align-content` 管，行與行的間距也用 `gap`。'] : ['預設值：再多卡片都擠在一行，空間不夠時依 `flex-shrink` 一起縮小。', free < 0 ? `縮到內容的最小寬度就縮不下去了，現在溢出 ${-free}px。` : '把容器寬度拉到最小，看看哪張卡片先縮不下去。'] }
    case 'gap': return { title: `gap: ${gap}px`, text: ['間距只加在卡片之間，不加在頭尾；換行時也套用在行與行之間。', `${CARDS.length} 張卡片有 ${CARDS.length - 1} 個間隙，一共占掉 ${gap * (CARDS.length - 1)}px 的主軸空間。`] }
    case 'width': return { title: `容器寬度 ${effW}px`, text: [free < 0 ? `卡片的內容縮不下去，溢出 ${-free}px。flex 子項預設 \`min-width: auto\`，不會縮到比內容的最小寬度還窄，眼科那張的 \`telemedicine\` 是一個不能斷開的長字。` : free > 0 ? `卡片排完還剩 ${free}px，交給 \`justify-content\` 擺放，或分給 \`flex-grow\` 大於 0 的卡片。` : '卡片剛好填滿，或剩下的空間已經被 `flex-grow` 吃掉。', width !== effW ? `畫面不夠寬，示範用的容器縮成 ${effW}px。` : '在會縮的子項加 `min-width: 0`，它才能縮到比內容還窄。'] }
    default: return {
      title: `② flex: ${grow} ${shrink} ${basis}`,
      text: [
        `第二張卡片從 \`flex-basis: ${basis}\` 起算${basis === 'auto' ? '（看內容寬度）' : ''}；有剩餘空間時按 \`flex-grow\` 的比例分，不夠時按「\`flex-shrink\` × basis」的比例縮。現在它${isRow ? '寬' : '高'} ${m.card2}px。`,
        grow > 0 ? `\`flex-grow: ${grow}\`：其他卡片都是 0，所以剩下的空間全部給它，\`justify-content\` 也就沒有空間可以擺。` : shrink === 0 ? '`flex-shrink: 0`：空間不夠時它不縮，其他卡片得縮更多，或整排溢出。' : basis === '0' ? '`flex-basis: 0` 加上 `flex-grow: 0`：它從 0 起算又不放大，只剩內容的最小寬度。`flex: 1`（`1 1 0`）等於 basis 0 再平分。' : '預設是 `0 1 auto`：不放大、可以縮小。',
      ],
    }
  }
}

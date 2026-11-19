import React, { useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Stepper, usePlayer, Code, Callout, Caption, Status, useWidth, fmtMs } from './ui.jsx'

/* ============================================================
   Core Web Vitals：門診看板頁的載入時間線（純前端模擬，時間是示意）
   - 主圖大小與載入方式 → LCP 的四段；主圖寬高、字型、公告橫幅 → 每次位移的分數與分組 → CLS
   - 「下一號」按鈕的長任務與讓出主執行緒 → INP 的三段
   - 門檻取自 web-vitals 6.2.3 的 LCPThresholds、CLSThresholds、INPThresholds
   ============================================================ */

const TH = { LCP: [2500, 4000], CLS: [0.1, 0.25], INP: [200, 500] }
const rate = (k, v) => (v > TH[k][1] ? 'poor' : v > TH[k][0] ? 'ni' : 'good')
const RATE = { good: '良好', ni: '需要改善', poor: '差' }

// 模擬的固定條件：手機視窗高 800px、TTFB 600ms、頻寬約 4 Mbps（0.5 kB/ms）
const VH = 800, TTFB = 600, CSS_END = 1100, FONT_END = 1500, NOTICE_AT = 2300, KB_MS = 0.5
const HEAD = 56, INTRO = 64, SWAP_GROW = 24, NOTICE_H = 120, HERO_H = 160
const CLICK_AT = 6000, INPUT_DELAY = 16, PRESENT = 24, URGENT = 30

const INIT = { size: 700, prio: 'lazy', dims: false, font: 'swap', notice: 'insert', task: 320, yieldMain: false }
const BEST = { size: 250, prio: 'high', dims: true, font: 'optional', notice: 'reserve', task: 320, yieldMain: true }

function simulate(c) {
  const imgStart = c.prio === 'high' ? TTFB + 50 : c.prio === 'auto' ? CSS_END : CSS_END + 150
  const imgEnd = imgStart + Math.round(c.size / KB_MS)
  const lcp = Math.max(imgEnd, CSS_END) + 50
  const parts = [['TTFB', TTFB], ['資源載入延遲', imgStart - TTFB], ['資源載入時間', imgEnd - imgStart], ['元素渲染延遲', lcp - imgEnd]]
  const events = [{ t: TTFB, kind: 'ttfb' }, { t: CSS_END, kind: 'fcp' }, { t: FONT_END, kind: 'font' }]
  if (c.notice !== 'none') events.push({ t: NOTICE_AT, kind: 'notice' })
  events.push({ t: imgEnd, kind: 'lcp' })
  events.sort((a, b) => a.t - b.t || (a.kind === 'fcp' ? -1 : 1))
  // 逐一套用事件，記下版面；區塊變高時，下方的內容往下移，算出這次位移的分數
  const h = { intro: INTRO, notice: c.notice === 'reserve' ? NOTICE_H : 0, hero: c.dims ? HERO_H : 0, swapped: false, noticeIn: false, imgIn: false, painted: false }
  const shifts = []
  for (const e of events) {
    let top = 0, grow = 0
    if (e.kind === 'fcp') h.painted = true
    if (e.kind === 'font' && c.font !== 'optional') { h.swapped = true; if (c.font === 'swap') { top = HEAD + h.intro; grow = SWAP_GROW; h.intro += SWAP_GROW } }
    if (e.kind === 'notice') { h.noticeIn = true; if (c.notice === 'insert') { top = HEAD + h.intro; grow = NOTICE_H; h.notice = NOTICE_H } }
    if (e.kind === 'lcp') { h.imgIn = true; if (!c.dims) { top = HEAD + h.intro + h.notice; grow = HERO_H; h.hero = HERO_H } }
    if (grow && h.painted) {
      const impact = Math.max(0, VH - top) / VH, dist = grow / VH
      e.shift = { t: e.t, kind: e.kind, top, grow, impact, dist, value: impact * dist }
      shifts.push(e.shift)
    }
    e.snap = { ...h }
  }
  // CLS：相隔不到 1 秒、離第一次不到 5 秒的位移算同一組，取最大的一組
  let best = { sum: 0, items: [] }, cur = null
  for (const s of shifts) {
    if (cur && s.t - cur.items.at(-1).t < 1000 && s.t - cur.items[0].t < 5000) { cur.sum += s.value; cur.items.push(s) }
    else cur = { sum: s.value, items: [s] }
    if (cur.sum > best.sum) best = { sum: cur.sum, items: [...cur.items] }
  }
  const processing = c.yieldMain ? Math.min(c.task, URGENT) : c.task
  const inp = INPUT_DELAY + processing + PRESENT
  events.push({ t: CLICK_AT, kind: 'inp', snap: { ...h } })
  return { imgStart, imgEnd, lcp, parts, events, shifts, cls: best.sum, window: best.items, inp, processing, deferred: c.task - processing, hasNotice: c.notice !== 'none' }
}

const LABELS = { ttfb: '收到 HTML', fcp: '第一次繪製', font: '網頁字型到達', notice: '公告插入', lcp: '主圖畫出', inp: '點「下一號」' }
const r3 = (v) => v.toFixed(3)

function explain(e, s, c) {
  const sh = e.shift
  const shiftText = sh ? `下方內容往下 ${sh.grow}px：影響比例 ${sh.impact.toFixed(2)} × 距離比例 ${sh.dist.toFixed(2)} = ${r3(sh.value)}。` : ''
  switch (e.kind) {
    case 'ttfb': return { title: `${TTFB} ms：收到 HTML 的第一個位元組`, text: ['畫面還是白的。瀏覽器開始解析 HTML，preload scanner 先掃出 CSS 與圖片的網址。', c.prio === 'high' ? '主圖有 `fetchpriority="high"`，這時就以高優先順序開始下載。' : '主圖沒有提高優先順序，要等版面算出來才輪到它。'] }
    case 'fcp': return { title: `${CSS_END} ms：CSS 下載完，第一次繪製`, text: ['render-blocking 的 CSS 到了，畫面第一次出現。之後發生的版面位移才算進 CLS。', c.prio === 'lazy' ? '`loading="lazy"` 的主圖要等這次版面算出來、確認在視窗內才開始下載，LCP 因此往後延。' : '主圖如果已經下載完，會在這一次繪製一起畫出來。'] }
    case 'font': return c.font === 'optional'
      ? { title: `${FONT_END} ms：字型晚到，這次不換`, text: ['`font-display: optional` 只給字型極短的時間；沒趕上就整次造訪都用備用字型，不換也不跳。之後的造訪從快取拿到字型。'] }
      : c.font === 'adjust'
        ? { title: `${FONT_END} ms：換上網頁字型，行數不變`, text: ['備用字型用 `size-adjust` 調得和網頁字型一樣寬，換字時說明文字的行數不變，沒有位移。'] }
        : { title: `${FONT_END} ms：換上網頁字型，多出一行`, text: ['`font-display: swap` 先用備用字型顯示，網頁字型到了再換。兩套字型的寬度不同，說明文字多換一行。', shiftText] }
    case 'notice': return c.notice === 'reserve'
      ? { title: `${NOTICE_AT} ms：公告填進預留的位置`, text: ['公告的 API 回來，填進一開始就用 `min-height: 120px` 留好的容器，沒有東西被推開。'] }
      : { title: `${NOTICE_AT} ms：公告插在看板上方`, text: ['公告的 API 回來後才插入，看板整個往下掉，正要點診間的人會點錯。', shiftText] }
    case 'lcp': return { title: `${fmtMs(s.lcp)}：主圖畫出，LCP 是 ${RATE[rate('LCP', s.lcp)]}`, text: [`LCP = ${s.parts.map(([n, v]) => `${n} ${v}`).join(' + ')} ms。${c.size > 300 ? `圖片 ${c.size} kB 要下載 ${fmtMs(s.imgEnd - s.imgStart)}。` : ''}`, c.dims ? '圖片寫了 `width`、`height`，位置一開始就留好，載入後不推動其他內容。' : sh ? `圖片沒有寬高，載入前高度是 0，載入後撐開 ${HERO_H}px，${shiftText}` : '圖片沒有寬高，但在第一次繪製前就下載完，這次沒有位移；網路慢一點就會推動下方內容。'] }
    default: return c.yieldMain
      ? { title: `INP ${s.inp} ms：先更新畫面，其餘的晚點做`, text: [`input delay ${INPUT_DELAY} + processing ${s.processing} + presentation ${PRESENT} ms。處理函式先改號碼就讓出主執行緒，瀏覽器馬上畫出新號碼。`, s.deferred > 0 ? `剩下 ${s.deferred} ms 的工作在畫面更新之後才跑，不算進這次互動；但它仍是長任務，會擋到緊接著的下一次操作，太重就拆小或移到 Web Worker。` : ''] }
      : { title: `INP ${s.inp} ms：${RATE[rate('INP', s.inp)]}`, text: [`input delay ${INPUT_DELAY} + processing ${s.processing} + presentation ${PRESENT} ms。寫叫號紀錄與重算統計都在同一個 task 裡，做完才畫出新號碼。`, '把畫面要看到的狀態先改，再 `await` 讓出主執行緒（`scheduler.yield()`，Safari 沒有時用 `setTimeout`）。'] }
  }
}

function codeOf(c) {
  return [
    '<!-- 看板頁（節錄）-->',
    '<img src="/img/board-hero.webp" alt="門診大樓入口"',
    c.prio === 'lazy' ? '     loading="lazy"' : c.prio === 'high' ? '     fetchpriority="high"' : '     decoding="async"',
    c.dims ? '     width="1200" height="480">' : '     >',
    `<div class="${c.notice === 'reserve' ? 'notice-slot' : 'notice'}"></div>`,
    '',
    '/* board.css */',
    `@font-face { font-family: 'Clinic Sans'; font-display: ${c.font === 'optional' ? 'optional' : 'swap'}; }`,
    c.font === 'adjust' ? "@font-face { font-family: 'Fallback'; src: local('Arial'); size-adjust: 104%; }" : '/* 備用字型沒有調整 */',
    c.notice === 'reserve' ? '.notice-slot { min-height: 120px; }' : '/* 公告沒有預留空間 */',
    '',
    '// board.js：「下一號」',
    'async function onNextNumber() {',
    '  current.value += 1',
    c.yieldMain ? '  await yieldToMain()   // 讓瀏覽器先畫出新號碼' : '  // 沒有讓出主執行緒',
    `  writeCallLog(); recomputeStats()   // 約 ${c.task - Math.min(c.task, URGENT)} ms`,
    '}',
  ].join('\n')
}
const HL = { ttfb: [2, 3], fcp: [3], font: [8, 9], notice: [5, 10], lcp: [2, 3, 4], inp: [14, 15, 16] }

export default function VitalsLab() {
  const [c, setC] = useState(INIT)
  const set = (k) => (v) => setC((o) => ({ ...o, [k]: v }))
  const s = simulate(c)
  const total = s.events.length
  const player = usePlayer(total, 1500)
  const step = Math.min(player.step, total - 1)
  const ev = s.events[step]
  const ex = explain(ev, s, c)
  const vals = { LCP: s.lcp, CLS: s.cls, INP: s.inp }
  const fixes = [
    ['首屏主圖不用 `loading="lazy"`', 'LCP', c.prio !== 'lazy'],
    ['主圖加 `fetchpriority="high"`', 'LCP', c.prio === 'high'],
    ['主圖壓到 300 kB 以下（AVIF、`srcset`）', 'LCP', c.size <= 300],
    ['主圖寫 `width`、`height`', 'CLS', c.dims],
    ['換字型不重新換行（`optional`、`size-adjust`）', 'CLS', c.font !== 'swap'],
    ['公告容器先用 `min-height` 留位置', 'CLS', c.notice !== 'insert'],
    ['先更新畫面再讓出主執行緒', 'INP', c.yieldMain || c.task <= 50],
  ]

  return (
    <Lab accent="aqua" kicker="FRONTEND LAB" title="Core Web Vitals：門診看板頁"
         blurb="主圖、字型、公告橫幅與「下一號」按鈕的處理時間，怎麼變成 LCP、CLS、INP 的數字與評等。">
      <LabControls>
        <Slider label="主圖大小" min={50} max={1500} step={50} value={c.size} onChange={set('size')} format={(v) => `${v} kB`} />
        <Seg label="主圖載入" tinted value={c.prio} onChange={set('prio')} options={[{ value: 'lazy', label: 'lazy' }, { value: 'auto', label: '預設' }, { value: 'high', label: 'fetchpriority=high' }]} />
        <Toggle label="主圖寫了 width、height" checked={c.dims} onChange={set('dims')} />
        <Seg label="字型" value={c.font} onChange={set('font')} options={[{ value: 'swap', label: 'swap' }, { value: 'adjust', label: 'swap + size-adjust' }, { value: 'optional', label: 'optional' }]} />
        <Seg label="公告橫幅" value={c.notice} onChange={set('notice')} options={[{ value: 'none', label: '沒有' }, { value: 'insert', label: '插在上方' }, { value: 'reserve', label: '預留空間' }]} />
        <Slider label="下一號的處理時間" min={0} max={800} step={20} value={c.task} onChange={set('task')} format={fmtMs} />
        <Toggle label="先更新畫面再讓出主執行緒" checked={c.yieldMain} onChange={set('yieldMain')} />
        <span className="spacer" />
        <button type="button" className="btn small" onClick={() => setC(BEST)}>套用全部修法</button>
        <button type="button" className="btn ghost small" onClick={() => setC(INIT)}>回到初始狀態</button>
      </LabControls>

      <LabGrid>
        <div className="lab-stack">
          <LabStage label="三個指標、載入時間線與畫面">
            <div className="vt-cards">
              {['LCP', 'CLS', 'INP'].map((k) => <Gauge key={k} name={k} value={vals[k]} note={k === 'CLS' ? (s.window.length ? `最大的一組：${s.window.length} 次位移` : '沒有位移') : k === 'LCP' ? '主圖' : '點「下一號」'} />)}
            </div>
            <Timeline s={s} at={ev.kind === 'inp' ? null : ev.t} />
            <div className="vt-bottom">
              <Phone snap={ev.snap} shift={ev.shift} blank={ev.kind === 'ttfb'} c={c} />
              <InpBar s={s} on={ev.kind === 'inp'} />
            </div>
            <Stepper step={step} total={total} onStep={player.setStep} playing={player.playing} onPlay={player.toggle} labels={s.events.map((e) => `${e.kind === 'inp' ? '載入後' : fmtMs(e.kind === 'lcp' ? s.lcp : e.t)} ${LABELS[e.kind]}`)} />
          </LabStage>
          <Caption>模擬：手機視窗高 800px、TTFB 600 ms、頻寬約 4 Mbps；時間與位移量是示意，門檻與評等規則取自 web-vitals 6.2.3。</Caption>
        </div>
        <div className="lab-stack">
          <Code lang="js" title="看板頁（節錄）" highlight={HL[ev.kind]}>{codeOf(c)}</Code>
          <LabExplain title={ex.title}>
            {ex.text.filter(Boolean).map((t) => <p key={t} dangerouslySetInnerHTML={{ __html: md(t) }} />)}
          </LabExplain>
          <div className="dtable-wrap">
            <table className="dtable vt-fix">
              <caption>對應的修法</caption>
              <tbody>
                {fixes.map(([t, k, ok]) => (
                  <tr key={t}><td dangerouslySetInnerHTML={{ __html: md(t) }} /><td>{k}</td><td>{ok ? <Status ok>已做</Status> : <Status>還沒</Status>}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <Callout title="工作上什麼時候用">寫頁面規格時列出首屏最大的元素、晚到的內容與最常用的按鈕；驗收時用 Performance 分頁的 Local metrics 與 Insights 看三個指標各卡在哪一段，上線後用 web-vitals 收實際使用者的 p75。</Callout>
        </div>
      </LabGrid>

      <style>{`
        .vt-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
        .vt-card { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 8px 12px 10px; }
        .vt-card .h { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 0.74rem; color: var(--ink-3); }
        .vt-card .v { font-family: var(--mono); font-size: 1.2rem; font-weight: 700; color: var(--ink-1); font-variant-numeric: tabular-nums; }
        .vt-card .r { font-size: 0.74rem; font-weight: 700; border: 1px solid currentColor; border-radius: 999px; padding: 0 8px; }
        .vt-good { color: var(--good); } .vt-ni { color: var(--serious); } .vt-poor { color: var(--critical); }
        .vt-band { position: relative; display: flex; height: 8px; margin-top: 6px; border-radius: 4px; overflow: hidden; }
        .vt-band i { display: block; height: 100%; }
        .vt-band .g { background: color-mix(in srgb, var(--good) 55%, var(--surface-2)); }
        .vt-band .n { background: color-mix(in srgb, var(--warning) 65%, var(--surface-2)); }
        .vt-band .p { background: color-mix(in srgb, var(--critical) 55%, var(--surface-2)); }
        .vt-band b { position: absolute; top: -3px; width: 3px; height: 14px; background: var(--ink-1); border-radius: 2px; transition: left 0.35s ease; }
        .vt-card .t { display: flex; justify-content: space-between; gap: 6px; font-family: var(--mono); font-size: 0.68rem; color: var(--ink-3); margin-top: 3px; }
        .vt-card .nt { font-size: 0.72rem; color: var(--ink-2); margin-top: 2px; }
        .vt-tl { width: 100%; display: block; margin-top: 12px; }
        .vt-tl rect.bar { transition: width 0.35s ease, x 0.35s ease; }
        .vt-tl .now { stroke: var(--lab-accent); stroke-width: 2; transition: x1 0.35s ease, x2 0.35s ease; }
        .vt-tl .mk { stroke-width: 1.5; stroke-dasharray: 4 3; }
        .vt-bottom { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin: 12px 0; align-items: start; }
        .vt-phone { width: 168px; height: 252px; margin: 0 auto; border: 2px solid var(--ink-2); border-radius: 16px; background: var(--surface-1); overflow: hidden; position: relative; padding: 6px; }
        .vt-phone .blank { position: absolute; inset: 0; display: grid; place-items: center; color: var(--ink-3); font-size: 0.78rem; }
        .vt-blk { margin: 0 0 3px; border-radius: 4px; overflow: hidden; transition: height 0.4s ease, background 0.3s ease; font-size: 0.62rem; line-height: 1.25; padding: 0 5px; display: flex; align-items: center; }
        .vt-blk.head { background: var(--lab-accent); color: var(--on-sticker); font-weight: 700; }
        .vt-blk.intro { background: var(--surface-2); color: var(--ink-2); align-items: flex-start; padding-top: 3px; }
        .vt-blk.intro.web { font-family: var(--serif); letter-spacing: 0.02em; }
        .vt-blk.notice { background: color-mix(in srgb, var(--critical) 14%, var(--surface-1)); color: var(--ink-1); border: 1px dashed transparent; }
        .vt-blk.notice.empty { background: transparent; border-color: var(--hairline); color: var(--ink-3); }
        .vt-blk.hero { background: color-mix(in srgb, var(--c-blue) 22%, var(--surface-2)); color: var(--ink-2); justify-content: center; }
        .vt-blk.hero.wait { background: repeating-linear-gradient(135deg, var(--surface-2) 0 6px, transparent 6px 12px); }
        .vt-moved { outline: 2px dashed var(--lab-accent); outline-offset: 1px; border-radius: 4px; transition: outline-color 0.3s ease; }
        .vt-row { height: 14px; margin-bottom: 3px; border-radius: 3px; background: var(--surface-2); font-size: 0.58rem; color: var(--ink-3); padding: 0 5px; display: flex; align-items: center; }
        .vt-arrow { position: absolute; right: 8px; font-size: 0.68rem; font-weight: 700; color: var(--lab-accent); }
        .vt-inp h5 { margin: 0 0 6px; font-size: 0.74rem; letter-spacing: 0.06em; color: var(--ink-2); }
        .vt-inp svg { width: 100%; display: block; }
        .vt-inp .seg { transition: width 0.35s ease, x 0.35s ease; }
        .vt-fix td:first-child { white-space: normal !important; font-family: var(--sans); }
        .vt-fix td:not(:first-child) { white-space: nowrap !important; width: 1%; }
        .vt-fix .status { padding: 2px 8px; font-size: 0.74rem; }
        @media (prefers-reduced-motion: reduce) { .vt-blk, .vt-band b, .vt-tl rect.bar, .vt-inp .seg { transition: none; } }
      `}</style>
    </Lab>
  )
}

function md(t) { return t.replace(/`([^`]+)`/g, '<code>$1</code>') }

function Gauge({ name, value, note }) {
  const [a, b] = TH[name]
  const max = b * 1.5
  const r = rate(name, value)
  const pos = Math.min(value, max) / max * 100
  return (
    <div className="vt-card">
      <div className="h"><span>{name}</span><span className={`r vt-${r}`}>{RATE[r]}</span></div>
      <div className="v">{name === 'CLS' ? r3(value) : fmtMs(value)}</div>
      <div className="vt-band" aria-hidden="true">
        <i className="g" style={{ width: `${a / max * 100}%` }} /><i className="n" style={{ width: `${(b - a) / max * 100}%` }} /><i className="p" style={{ flex: 1 }} />
        <b style={{ left: `calc(${pos}% - 1.5px)` }} />
      </div>
      <div className="t"><span>良好 ≤ {name === 'CLS' ? a : fmtMs(a)}</span><span>差 &gt; {name === 'CLS' ? b : fmtMs(b)}</span></div>
      <div className="nt">{note}</div>
    </div>
  )
}

/* 載入時間線：五條資源與一條位移，直線標出 FCP、LCP 與目前這一步 */
function Timeline({ s, at }) {
  const box = useRef(null)
  const VW = Math.max(300, Math.min(660, Math.round(useWidth(box, 520))))
  const T = Math.max(4500, Math.ceil((s.lcp + 400) / 500) * 500)
  const X0 = 58, W = VW - X0 - 10
  const x = (t) => X0 + (t / T) * W
  const lanes = [
    ['HTML', 0, TTFB, 'var(--ink-3)'], ['CSS', TTFB + 50, CSS_END, 'var(--c-violet)'], ['字型', CSS_END, FONT_END, 'var(--c-orange)'],
    ['主圖', s.imgStart, s.imgEnd, 'var(--c-blue)'], ['公告 API', CSS_END, NOTICE_AT, 'var(--c-magenta)'],
  ].filter((l) => s.hasNotice || l[0] !== '公告 API')
  const LH = 17, top = 18, shiftY = top + lanes.length * LH + 4, axisY = shiftY + 30
  const inWin = new Set(s.window)
  return (
    <div ref={box}>
      <svg className="vt-tl" viewBox={`0 0 ${VW} ${axisY + 26}`} role="img" aria-label={`載入時間線：LCP ${Math.round(s.lcp)} 毫秒，${s.shifts.length} 次版面位移`}>
        {lanes.map(([name, a, b, col], i) => (
          <g key={name}>
            <text x="2" y={top + i * LH + 11} className="svg-text small">{name}</text>
            <rect className="bar" x={x(a)} y={top + i * LH + 2} width={Math.max(2, x(b) - x(a))} height="11" rx="2" fill={col} opacity="0.8" />
          </g>
        ))}
        <text x="2" y={shiftY + 13} className="svg-text small">位移</text>
        {s.shifts.map((sh, i) => (
          <g key={sh.kind}>
            <rect x={x(sh.t) - 3} y={shiftY + 2} width="6" height="12" rx="1" fill={inWin.has(sh) ? 'var(--critical)' : 'var(--ink-3)'} />
            <text x={x(sh.t) + 5} y={shiftY + (i % 2 ? 24 : 12)} className="svg-text small">{r3(sh.value)}</text>
          </g>
        ))}
        <line x1={X0} x2={X0 + W} y1={axisY} y2={axisY} className="svg-edge" />
        {[0, 1000, 2000, 3000, 4000, 5000, 6000].filter((v) => v <= T).map((v) => (
          <text key={v} x={x(v)} y={axisY + 13} textAnchor="middle" className="svg-text small">{v / 1000}s</text>
        ))}
        {[[TH.LCP[0], 'var(--good)', 'LCP 良好'], [TH.LCP[1], 'var(--critical)', 'LCP 差']].map(([v, col, t]) => (
          <g key={v}><line className="mk" x1={x(v)} x2={x(v)} y1={top - 4} y2={axisY} stroke={col} /><text x={x(v)} y={top - 7} textAnchor="middle" className="svg-text small">{t}</text></g>
        ))}
        <line className="mk" x1={x(s.lcp)} x2={x(s.lcp)} y1={top} y2={axisY} stroke="var(--ink-1)" />
        <text x={Math.min(x(s.lcp) + 3, VW - 30)} y={axisY + 24} className="svg-text small">LCP</text>
        {at != null && <line className="now" x1={x(at)} x2={x(at)} y1={top - 2} y2={axisY + 2} />}
      </svg>
    </div>
  )
}

/* 手機畫面：每個事件之後的版面；被推開的區塊加虛線框 */
function Phone({ snap, shift, blank, c }) {
  const k = 252 / VH * 0.92
  const moved = (name) => shift && ((shift.kind === 'font' && name !== 'head' && name !== 'intro') || (shift.kind === 'notice' && ['notice', 'hero', 'rows'].includes(name)) || (shift.kind === 'lcp' && name === 'rows'))
  return (
    <div className="vt-phone" role="img" aria-label={blank ? '畫面還沒有內容' : '門診看板頁的版面'}>
      {blank ? <span className="blank">白畫面</span> : <>
        <div className="vt-blk head" style={{ height: HEAD * k }}>門診看板</div>
        <div className={`vt-blk intro${snap.swapped ? ' web' : ''}`} style={{ height: snap.intro * k }}>{snap.swapped ? '網頁字型' : '備用字型'}：今日共 12 診，請留意叫號</div>
        <div className={`vt-blk notice${snap.noticeIn ? '' : ' empty'}${moved('notice') ? ' vt-moved' : ''}`} style={{ height: snap.notice * k, borderWidth: snap.notice ? 1 : 0 }}>{snap.notice ? (snap.noticeIn ? '颱風停診公告' : '預留的公告位置') : ''}</div>
        <div className={`vt-blk hero${snap.imgIn ? '' : ' wait'}${moved('hero') ? ' vt-moved' : ''}`} style={{ height: snap.hero * k }}>{snap.hero ? (snap.imgIn ? '主圖' : '主圖下載中') : ''}</div>
        <div className={moved('rows') ? 'vt-moved' : ''}>
          {['101 內科 23 號', '203 骨科 7 號', '305 眼科 8 號', '112 皮膚科 15 號', '108 家醫科 31 號', '215 牙科 4 號', '118 耳鼻喉 19 號'].map((t) => <div key={t} className="vt-row">{t}</div>)}
        </div>
        {shift && <span className="vt-arrow" style={{ top: (shift.top + 6) * k }}>↓ {shift.grow}px</span>}
      </>}
      {!blank && !c.dims && !snap.imgIn && <span className="vt-arrow" style={{ bottom: 6, top: 'auto' }}>主圖高度 0</span>}
    </div>
  )
}

/* INP 的三段：input delay、processing、presentation，讓出主執行緒後剩下的工作畫在畫面更新之後 */
function InpBar({ s, on }) {
  const box = useRef(null)
  const W = Math.max(240, Math.min(420, Math.round(useWidth(box, 300))))
  const max = 900, X0 = 4, w = (v) => (v / max) * (W - X0 * 2)
  const segs = [['input', INPUT_DELAY, 'var(--ink-3)'], ['processing', s.processing, 'var(--c-orange)'], ['presentation', PRESENT, 'var(--c-violet)']]
  let acc = X0
  return (
    <div className="vt-inp" ref={box}>
      <h5>點「下一號」到畫面更新{on ? '' : '（載入後）'}</h5>
      <svg viewBox={`0 0 ${W} 74`} role="img" aria-label={`INP ${s.inp} 毫秒`}>
        {segs.map(([n, v, col]) => { const x = acc; acc += w(v); return <rect key={n} className="seg" x={x} y="8" width={Math.max(1, w(v))} height="16" fill={col} opacity={on ? 0.95 : 0.6} /> })}
        {s.deferred > 0 && <rect className="seg" x={acc + 2} y="8" width={Math.max(1, Math.min(w(s.deferred), W - acc - 6))} height="16" fill="none" stroke="var(--c-orange)" strokeDasharray="3 2" />}
        {[[200, 'var(--good)'], [500, 'var(--critical)']].map(([v, col]) => <g key={v}><line x1={X0 + w(v)} x2={X0 + w(v)} y1="2" y2="30" stroke={col} strokeWidth="1.5" /><text x={X0 + w(v)} y="42" textAnchor="middle" className="svg-text small">{v}</text></g>)}
        <text x={X0} y="58" className="svg-text small">{`${INPUT_DELAY} + ${s.processing} + ${PRESENT} = ${s.inp} ms`}</text>
        {s.deferred > 0 && <text x={X0} y="71" className="svg-text small">{`虛線：畫面更新後才做的 ${s.deferred} ms`}</text>}
      </svg>
    </div>
  )
}

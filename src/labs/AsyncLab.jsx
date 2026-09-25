import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Code, Callout, useReducedMotion, useWidth } from './ui.jsx'

/* ============================================================
   同步 / 多執行緒 / async：I/O 等待時 CPU 在幹嘛
   - 6 個請求同時進來，每個「CPU 10ms → 等 DB 100ms → CPU 10ms」
   - 三種模式共用同一個排程模擬器：只有一顆 CPU（GIL / event loop），
     差別只在「同時能握住幾個請求」（同步 1、執行緒 N、async 全部）
   - 甘特圖 + 播放頭掃描；切成 CPU 密集就看到 async 與執行緒都失效
   ============================================================ */

const N = 6
const SYNC_TOTAL = 720
const IO_SEGS = [{ kind: 'cpu', dur: 10 }, { kind: 'io', dur: 100 }, { kind: 'cpu', dur: 10 }]
const CPU_SEGS = [{ kind: 'cpu', dur: 120 }]

/* 1ms tick 的離散模擬：conc = 同時可握住的請求數；CPU 一次只給一個（FIFO） */
function simulate(segs, conc) {
  const st = Array.from({ length: N }, () => ({ i: 0, left: segs[0].dur, spans: [], start: null, end: null }))
  const active = []
  const q = []
  let holder = null, next = 0, t = 0, done = 0
  const push = (r, kind) => {
    const s = st[r].spans, last = s[s.length - 1]
    if (last && last.kind === kind && last.end === t) last.end = t + 1
    else s.push({ kind, start: t, end: t + 1 })
  }
  while (done < N && t < 5000) {
    while (active.length < conc && next < N) { const r = next++; active.push(r); st[r].start = t; if (segs[0].kind === 'cpu') q.push(r) }
    if (holder === null && q.length) holder = q.shift()
    for (const r of [...active]) {
      const s = st[r], seg = segs[s.i]
      if (seg.kind === 'io') { push(r, 'io'); s.left-- }
      else if (holder === r) { push(r, 'cpu'); s.left-- }
      else push(r, 'wait')
      if (s.left === 0) {
        if (holder === r) holder = null
        s.i++
        if (s.i >= segs.length) { s.end = t + 1; done++; active.splice(active.indexOf(r), 1) }
        else { s.left = segs[s.i].dur; if (segs[s.i].kind === 'cpu') q.push(r) }
      }
    }
    t++
  }
  const cpuBusy = st.reduce((a, s) => a + s.spans.filter((x) => x.kind === 'cpu').reduce((b, x) => b + x.end - x.start, 0), 0)
  return { lanes: st, total: t, cpuBusy }
}

const MODES = {
  sync: { label: '同步單工', code: (cpu) => `def handler(request):
    data = parse(request)   # CPU 10ms
    ${cpu ? 'rows = compute(data)    # CPU 120ms 純算' : 'rows = db.query(sql)    # 卡住等 DB'}
    return render(rows)     # CPU 10ms

for request in requests:    # 做完一個換下一個
    handler(request)`, hl: [3, 6] },
  threads: { label: '多執行緒', code: (cpu, w) => `from concurrent.futures import (
    ThreadPoolExecutor)

def handler(request):
    data = parse(request)   # 要先拿到 GIL
    ${cpu ? 'rows = compute(data)    # 一直握著 GIL' : 'rows = db.query(sql)    # 等 I/O 放掉 GIL'}
    return render(rows)

pool = ThreadPoolExecutor(max_workers=${w})
pool.map(handler, requests) # 最多 ${w} 個同時跑`, hl: [6, 9] },
  async: { label: 'async', code: (cpu) => `async def handler(request):
    data = parse(request)   # CPU 10ms
    ${cpu ? 'rows = compute(data)    # 沒 await 不讓出' : 'rows = await db.fetch(sql)  # 讓出控制權'}
    return render(rows)     # 回來再排 CPU

await asyncio.gather(
    *(handler(r) for r in requests))`, hl: [3, 6] },
}

const TEXT = {
  sync: {
    io: ['一次只服務一個請求。每個請求 CPU 其實只忙 20ms，剩下 100ms 程式卡在 `db.query()` 那一行「等回覆」，這段時間 CPU 完全閒著，但下一個請求也進不來。', '6 個請求排成一列：總耗時 6 × 120 = 720ms，CPU 利用率只有 17%。這就是「I/O 密集」的典型浪費：瓶頸不在算力，在等待。'],
    cpu: ['沒有 I/O、120ms 全部在算。CPU 100% 忙碌，720ms 是「真的需要這麼多 CPU 時間」，不是浪費。', '這種工作（影像處理、報表彙總、加密）要縮短總時間，唯一的辦法是「多顆 CPU 一起算」。'],
  },
  threads: {
    io: ['開 N 個 worker，每個握住一個請求。CPython 的 GIL 讓同一時間只有一個執行緒能跑 Python bytecode，但執行緒進入 socket 等待（DB driver 的 C 層）時會**釋放 GIL**，所以圖上的 I/O 段可以重疊。', 'CPU 段仍然是輪流的——淺灰「等 GIL」就是拿不到鎖的時間。worker 數 = 平行度上限：worker 越多重疊越好，但每個執行緒有自己的 stack（預設 8MB），開到幾百個就不划算。'],
    cpu: ['4 個 worker 都握住了請求，但沒有任何 I/O 等待可以釋放 GIL：同一時間永遠只有一個執行緒在算，其他人全在「等 GIL」。總時間還是 720ms，一點都沒省。', '真實的 CPython 每 5ms 會強制切換 GIL，所以實際上是交錯執行、總時間一樣（切換還有額外成本）。要真正平行得用 `multiprocessing` / `ProcessPoolExecutor`，每個 process 有自己的 GIL。（Python 3.13 起有實驗性的 free-threaded build 可以關掉 GIL。）'],
  },
  async: {
    io: ['一個執行緒、一個 event loop。`await db.fetch()` 的意思是「我要等 I/O 了，控制權還給 loop，去跑別人」——所以 6 個請求的 I/O **全部重疊**，CPU 段依序排隊：總耗時 ≈ 120 + 5 × 10 = 170ms。', '並發數不受執行緒數限制，一個 process 撐上千個連線都行。前提是 handler 裡**沒有任何同步阻塞**：在 `async def` 裡呼叫同步的 DB driver（例如 psycopg2、requests），整個 loop 會被凍住，所有請求一起卡——要用 asyncpg / motor / httpx 這類 async driver，或用 `run_in_threadpool` 丟去執行緒池。'],
    cpu: ['沒有 `await` 的地方 event loop 就切不出去：每個 handler 從頭算到尾、一個接一個，和同步完全一樣 720ms。', '而且更糟：運算期間整個 loop 凍住，連 health check 都回不了，其他請求全部 timeout。CPU 密集工作要 `await loop.run_in_executor(process_pool, fn)`，或丟給 worker / queue（Celery、RQ、arq），API 只負責收單與回結果。'],
  },
}

export default function AsyncLab() {
  const [mode, setMode] = useState('sync')
  const [workers, setWorkers] = useState(4)
  const [cpuOnly, setCpuOnly] = useState(false)
  const reduced = useReducedMotion()

  const segs = cpuOnly ? CPU_SEGS : IO_SEGS
  const conc = mode === 'sync' ? 1 : mode === 'threads' ? workers : N
  const sim = useMemo(() => simulate(segs, conc), [segs, conc])

  /* 播放頭：playT = null 代表「不在播放，全部顯示」 */
  const [playT, setPlayT] = useState(null)
  const timer = useRef(null)
  const stop = () => { if (timer.current) { cancelAnimationFrame(timer.current.raf); clearInterval(timer.current.iv) } timer.current = null; setPlayT(null) }
  useEffect(() => stop, [sim])
  const play = () => {
    if (timer.current) { stop(); return }
    const total = sim.total
    if (reduced) {
      let t = 0
      const iv = setInterval(() => { t += 60; if (t >= total) { stop(); return } setPlayT(t) }, 350)
      timer.current = { iv }
    } else {
      const start = performance.now()
      const dur = Math.max(2200, total / 0.24) // 短排程也至少播 2.2 秒
      const tick = (now) => { const t = ((now - start) / dur) * total; if (t >= total) { stop(); return } setPlayT(t); timer.current = { raf: requestAnimationFrame(tick) } }
      timer.current = { raf: requestAnimationFrame(tick) }
    }
    setPlayT(0)
  }
  const playing = playT !== null
  const at = playing ? playT : sim.total
  const now = laneStates(sim.lanes, at)

  const m = MODES[mode]
  const text = TEXT[mode][cpuOnly ? 'cpu' : 'io']
  const speedup = SYNC_TOTAL / sim.total
  const util = Math.round((sim.cpuBusy / sim.total) * 100)
  const title = cpuOnly
    ? { sync: '同步：CPU 真的在忙，沒得省', threads: '多執行緒 + CPU 密集：GIL 讓大家排隊', async: 'async + CPU 密集：沒有 await 就沒有讓出' }[mode]
    : { sync: '同步：等 I/O 的時候 CPU 在發呆', threads: `多執行緒：${workers} 個 worker，I/O 等待可以重疊`, async: 'async：一個執行緒把所有 I/O 等待疊在一起' }[mode]

  return (
    <Lab accent="blue" kicker="PYTHON LAB" title="同步、多執行緒、async：I/O 等待時 CPU 在幹嘛"
         blurb="6 個請求同時進來，每個都要「算一下 → 等資料庫 → 再算一下」。切換三種模式看甘特圖怎麼變、總耗時差多少；再把工作改成純 CPU 運算，看 async 與執行緒為什麼忽然沒用了。">
      <LabControls>
        <Seg label="模式" tinted value={mode} onChange={setMode}
             options={Object.entries(MODES).map(([value, v]) => ({ value, label: v.label }))} />
        {mode === 'threads' && <Slider label="worker 數" min={1} max={4} value={workers} onChange={setWorkers} format={(v) => `${v} threads`} />}
        <Toggle label="改成 CPU 密集運算（沒有 I/O）" checked={cpuOnly} onChange={setCpuOnly} />
        <span className="spacer" />
        <div className="stepper"><button type="button" className="primary" onClick={play}>{playing ? '■ 停止' : '▶ 播放'}</button></div>
      </LabControls>

      <LabGrid>
        <div className="lab-stack">
          <div className="asy-stats" aria-live="polite">
            <div><span>總耗時</span><b key={sim.total} className="asy-num">{sim.total}<i>ms</i></b></div>
            <div><span>相對同步</span><b className="asy-num">{speedup.toFixed(1)}<i>× 快</i></b></div>
            <div><span>CPU 利用率</span><b className="asy-num">{util}<i>%</i></b></div>
            <div><span>同時握住的請求</span><b className="asy-num">{conc}<i>個</i></b></div>
          </div>
          <LabStage label="請求排程甘特圖"
                    caption={playing ? `t = ${Math.round(at)} ms　${now}` : '橫軸是時間（ms）；深色 = 用 CPU，斜線 = 等 I/O，淺灰 = 等 GIL / 等 CPU，虛線 = 排隊等 worker'}>
            <Gantt sim={sim} at={at} playing={playing} mode={mode} cpuOnly={cpuOnly} />
          </LabStage>
        </div>
        <div className="lab-stack">
          <Code lang="python" title={m.label} highlight={m.hl}>{m.code(cpuOnly, workers)}</Code>
          <LabExplain title={title}>
            {text.map((t, i) => <p key={i} dangerouslySetInnerHTML={{ __html: md(t) }} />)}
          </LabExplain>
          <Callout title="工作上什麼時候用">
            後端 API 絕大多數是 I/O 密集（查 DB、打第三方 API、讀快取），所以 async 很有感：FastAPI 的 <code>async def</code> handler 配 async driver。寫 <code>def</code>（同步）handler 也沒關係——FastAPI 會自動把它丟進 threadpool 跑，不會卡住 loop。CPU 密集的工作（轉檔、跑模型、大報表）不要放在 API process 裡，丟給 worker / queue，API 只回「收到了，job id 是…」。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .asy-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
        .asy-stats > div { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 8px 12px; display: grid; gap: 2px; }
        .asy-stats span { font-size: 0.7rem; letter-spacing: 0.06em; color: var(--ink-3); font-weight: 600; }
        .asy-stats b { font-family: var(--mono); font-size: 1.25rem; color: var(--ink-1); font-variant-numeric: tabular-nums; line-height: 1.2; }
        .asy-stats b i { font-style: normal; font-size: 0.72rem; color: var(--ink-3); margin-left: 4px; font-family: var(--sans); }
        .asy-stats > div:first-child b { color: var(--lab-accent); }
        .asy-num { animation: asy-bump 0.35s ease-out; }
        @keyframes asy-bump { from { opacity: 0.3; transform: translateY(3px); } to { opacity: 1; transform: none; } }
        @media (max-width: 640px) { .asy-stats { grid-template-columns: 1fr 1fr; } }
        .asy-gantt .cpu { fill: var(--lab-accent); }
        .asy-gantt .io { stroke: var(--lab-accent); stroke-opacity: 0.6; stroke-width: 1; }
        .asy-gantt .wait { fill: var(--ink-3); fill-opacity: 0.3; }
        .asy-gantt .hatch-bg { fill: var(--lab-accent); fill-opacity: 0.1; }
        .asy-gantt .hatch-ln { stroke: var(--lab-accent); stroke-opacity: 0.55; stroke-width: 1.4; }
        .asy-gantt .queue { stroke: var(--ink-3); stroke-dasharray: 2 4; stroke-width: 1.5; }
        .asy-gantt .grid { stroke: var(--hairline); stroke-width: 1; }
        .asy-gantt .head { stroke: var(--ink-1); stroke-width: 1.5; }
        .asy-gantt .head-cap { fill: var(--ink-1); }
        .asy-gantt .ghost { opacity: 0.18; }
        .asy-gantt .sync-mark { stroke: var(--ink-3); stroke-dasharray: 3 3; }
        .asy-gantt .span { transform-box: fill-box; transform-origin: left center; animation: asy-grow 0.45s cubic-bezier(0.2, 0.7, 0.2, 1); }
        @keyframes asy-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        @media (prefers-reduced-motion: reduce) { .asy-gantt .span, .asy-num { animation: none; } }
      `}</style>
    </Lab>
  )
}

function md(s) { return s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>') }

/* 播放頭當下每個 lane 在幹嘛（給 caption 用） */
function laneStates(lanes, at) {
  const kindAt = (l) => l.spans.find((s) => s.start <= at && at < s.end)?.kind
  const cpu = lanes.map((l, i) => (kindAt(l) === 'cpu' ? i + 1 : null)).filter(Boolean)
  const io = lanes.map((l, i) => (kindAt(l) === 'io' ? i + 1 : null)).filter(Boolean)
  const wait = lanes.map((l, i) => (kindAt(l) === 'wait' ? i + 1 : null)).filter(Boolean)
  const done = lanes.filter((l) => l.end !== null && l.end <= at).length
  return `CPU：${cpu.length ? `請求 ${cpu.join('')}` : '閒置'}　等 I/O：${io.length ? io.join('、') : '—'}　等 CPU：${wait.length ? wait.join('、') : '—'}　完成 ${done}/${lanes.length}`
}

function Gantt({ sim, at, playing, mode, cpuOnly }) {
  const id = useId().replace(/:/g, '')
  const box = useRef(null)
  const narrow = useWidth(box, 700) < 520
  /* 手機：縮小 viewBox 讓字體相對變大 */
  const W = narrow ? 440 : 760, X0 = narrow ? 46 : 62, X1 = W - 12, TOP = 26, LH = narrow ? 18 : 22, GAP = narrow ? 6 : 8
  const H = TOP + N * (LH + GAP) + 18
  const xs = (t) => X0 + ((X1 - X0) * t) / SYNC_TOTAL
  const ticks = narrow ? [0, 200, 400, 600] : [0, 100, 200, 300, 400, 500, 600, 700]
  const headX = xs(Math.min(at, sim.total))
  const key = `${mode}-${cpuOnly}-${sim.total}`

  const lanesSvg = (cls) => (
    <g className={cls}>
      {sim.lanes.map((l, i) => {
        const y = TOP + i * (LH + GAP)
        return (
          <g key={i}>
            {l.start > 0 && <line className="queue" x1={xs(0)} x2={xs(l.start)} y1={y + LH / 2} y2={y + LH / 2} />}
            {l.spans.map((s, j) => {
              const x = xs(s.start), w = Math.max(1, xs(s.end) - x)
              const delay = `${Math.min(0.5, s.start / 1400)}s`
              if (s.kind === 'io') return <rect key={j} className="span io" x={x} y={y + 3} width={w} height={LH - 6} rx="2" fill={`url(#${id}-hatch)`} style={{ animationDelay: delay }} />
              return <rect key={j} className={`span ${s.kind}`} x={x} y={s.kind === 'wait' ? y + 6 : y} width={w} height={s.kind === 'wait' ? LH - 12 : LH} rx="2" style={{ animationDelay: delay }} />
            })}
          </g>
        )
      })}
    </g>
  )

  return (
    <div ref={box}>
    <svg className="asy-gantt" viewBox={`0 0 ${W} ${H}`} role="img"
         aria-label={`甘特圖：${N} 個請求，總耗時 ${sim.total} 毫秒`}>
      <defs>
        <pattern id={`${id}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect className="hatch-bg" width="6" height="6" />
          <line className="hatch-ln" x1="0" y1="0" x2="0" y2="6" />
        </pattern>
        <clipPath id={`${id}-clip`}><rect x={X0} y="0" width={Math.max(0, headX - X0)} height={H} /></clipPath>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line className="grid" x1={xs(t)} x2={xs(t)} y1={TOP - 4} y2={H - 18} />
          <text className="svg-text small" x={xs(t)} y="12" textAnchor="middle">{t}</text>
        </g>
      ))}
      <text className="svg-text small" x={X0 - 8} y="12" textAnchor="end">ms</text>
      {sim.lanes.map((_, i) => (
        <text key={i} className="svg-mono" x={X0 - 8} y={TOP + i * (LH + GAP) + LH / 2 + 4} textAnchor="end">{narrow ? `#${i + 1}` : `請求 ${i + 1}`}</text>
      ))}
      <g key={key}>
        {playing ? <>{lanesSvg('ghost')}<g clipPath={`url(#${id}-clip)`}>{lanesSvg('')}</g></> : lanesSvg('')}
      </g>
      {sim.total < SYNC_TOTAL && (
        <g>
          <line className="sync-mark" x1={xs(SYNC_TOTAL)} x2={xs(SYNC_TOTAL)} y1={TOP - 4} y2={H - 18} />
          <text className="svg-text small" x={xs(SYNC_TOTAL) - 4} y={H - 5} textAnchor="end">同步 720</text>
        </g>
      )}
      <line className="grid" style={{ stroke: 'var(--lab-accent)' }} x1={xs(sim.total)} x2={xs(sim.total)} y1={TOP - 4} y2={H - 18} />
      <text className="svg-mono" style={{ fill: 'var(--lab-accent)', fontWeight: 700 }} x={xs(sim.total) + (sim.total > 600 ? -4 : 4)} y={H - 5} textAnchor={sim.total > 600 ? 'end' : 'start'}>{sim.total} ms</text>
      {playing && (
        <g>
          <line className="head" x1={headX} x2={headX} y1={TOP - 6} y2={H - 18} />
          <path className="head-cap" d={`M${headX - 5},${TOP - 12} L${headX + 5},${TOP - 12} L${headX},${TOP - 5} Z`} />
        </g>
      )}
    </svg>
    </div>
  )
}

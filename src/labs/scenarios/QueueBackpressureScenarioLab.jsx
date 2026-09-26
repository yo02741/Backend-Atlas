import React, { useEffect, useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Slider, Callout, Status, useTicker } from '../ui.jsx'

/* 削峰與背壓情境模擬器：60 秒時間軸，t=10 發推播後流量從 200 衝到 5,000 QPS，維持一陣子再回落。
   四張小圖（單一 y 軸）：每秒請求、佇列深度、完成延遲、worker 數。切換做法看同一波尖峰的不同下場。
   全部是以每秒為單位的示意推算，不是量測值 */

const MODES = [
  { value: 'direct', label: '同步做完' },
  { value: 'queue', label: '佇列 + 202' },
  { value: 'shed', label: '上限 + 503' },
  { value: 'autoscale', label: '自動擴縮' },
]
const BASE = 200, PEAK = 5000, PER_WORKER = 100, TIMEOUT = 5, MAX_W = 40, T_END = 60
const SPIKE_START = 10
function spikeQps(t) {
  if (t < SPIKE_START) return 0
  if (t < SPIKE_START + 5) return ((t - SPIKE_START) / 5) * (PEAK - BASE)
  if (t < SPIKE_START + 20) return PEAK - BASE
  if (t < SPIKE_START + 35) return (PEAK - BASE) * (1 - (t - SPIKE_START - 20) / 15)
  return 0
}

function simulate(mode, workers, cap, spike) {
  const rows = []
  const retries = new Array(T_END + 10).fill(0)
  let depth = 0, w = workers, pending = [], lost = 0, rejectedTotal = 0, peakDepth = 0, peakLat = 0, peakW = workers, apiLat = 0
  for (let t = 0; t <= T_END; t++) {
    const arr = BASE + (spike ? spikeQps(t) : 0) + retries[t]
    if (mode === 'autoscale') {
      pending = pending.filter((p) => { if (p.ready <= t) { w += p.n; return false } return true })
      if (t % 5 === 0) {
        const planned = w + pending.reduce((a, p) => a + p.n, 0)
        if (depth > 2000 && planned < MAX_W) pending.push({ ready: t + 15, n: Math.min(4, MAX_W - planned) })   // 偵測 + 開機 15 秒
        else if (depth === 0 && w > workers) w = Math.max(workers, w - 4)
      }
    }
    const capacity = w * PER_WORKER
    let accepted = arr, rejected = 0
    if (mode === 'shed') {
      accepted = Math.min(arr, Math.max(0, cap + capacity - depth)); rejected = arr - accepted   // 這一秒處理完後深度不得超過上限
      const retryShare = arr > 0 ? retries[t] / arr : 0
      const gaveUp = Math.round(rejected * retryShare)          // 重試再被拒 → 放棄
      lost += gaveUp; rejectedTotal += rejected
      retries[t + 5] += rejected - gaveUp                         // Retry-After: 5 秒後回來
    }
    depth += accepted
    const done = Math.min(depth, capacity)
    depth -= done
    if (mode === 'direct' && depth > capacity * TIMEOUT) {      // 等超過 5 秒的在途請求：客戶端逾時放棄
      rejected = depth - capacity * TIMEOUT; lost += rejected; depth = capacity * TIMEOUT
    }
    const lat = depth / capacity
    peakDepth = Math.max(peakDepth, depth); peakLat = Math.max(peakLat, lat); peakW = Math.max(peakW, w)
    apiLat = Math.max(apiLat, mode === 'direct' ? lat : 0.02)
    rows.push({ arr: Math.round(arr), done: Math.round(done), rejected: Math.round(rejected), depth: Math.round(depth), lat, w, pend: pending.reduce((a, p) => a + p.n, 0) })
  }
  const capEnd = rows[T_END].w * PER_WORKER
  return { rows, lost: Math.round(lost), rejectedTotal: Math.round(rejectedTotal), peakDepth: Math.round(peakDepth), peakLat, peakW, apiLat, left: rows[T_END].depth, drain: rows[T_END].depth / capEnd }
}

const EXPLAIN = {
  direct: { title: '同步做完：在途請求堆在 API 上，逾時就是丟資料', body: ['每秒進來 5,000、做得完 800，多出來的請求掛在 API 的連線上等下游。等待時間每秒多 5 秒，推播後兩秒就超過客戶端的 5 秒逾時。', '逾時的請求最麻煩：客戶端以為失敗，伺服器可能寫了 DB 但信還沒寄，狀態不明；重送又可能寫兩筆。平常的 200 QPS 也一起卡在同一條隊伍裡。'] },
  queue: { title: '佇列：API 立刻回 202，尖峰變成一座慢慢消的山', body: ['API 只做 enqueue，回應時間不受尖峰影響。佇列深度每秒長 4,200，尖峰結束時堆了十萬件上下，之後以每秒 800 慢慢消，60 秒結束還有一大半沒做完。', '不丟資料的代價是延遲對使用者不可見：要有查狀態的端點，也要盯佇列深度的告警。沒有上限的佇列，遇到更大的尖峰會把 Redis 記憶體撐爆。'] },
  shed: { title: '有上限的佇列：拒絕一部分，但系統活著、延遲有上限', body: ['佇列滿了就回 503 + Retry-After，worker 永遠在自己的容量內工作，完成延遲最多就是「上限 ÷ 處理率」。被拒絕的請求 5 秒後回來重試，尖峰被攤到後面。', '把上限拉小：拒絕變多、延遲變短；拉大則反過來——上限就是「願意讓使用者等多久」的翻譯。重試再被拒的請求（示意中算「放棄」）才是真正丟掉的，客戶端沒有實作退避的話，第一次被拒就丟了。'] },
  autoscale: { title: '自動擴縮：容量真的變大，但要等它跟上', body: ['每 5 秒看一次佇列深度，超過 2,000 就多開 4 個 worker，開機要 15 秒。看 worker 數那張圖：第一批要到 30 秒左右才上線，山已經堆到一半了。', '尖峰只有 30 秒時，擴容主要幫的是「消化得比較快」而不是「不堆積」。若下游本身就是每秒 800 的上限（寄信配額、DB 寫入），加 worker 只是把塞車往下游推。'] },
}

const kfmt = (v) => v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v))
const sfmt = (v) => `${v.toFixed(0)}s`

export default function QueueBackpressureScenarioLab() {
  const [mode, setMode] = useState('direct')
  const [workers, setWorkers] = useState(8)
  const [cap, setCap] = useState(20000)
  const [spike, setSpike] = useState(false)
  const [started, setStarted] = useState(false)
  const [running, setRunning] = useState(false)
  const [tick, resetTick] = useTicker(running, 70)
  const t = started ? Math.min(T_END, tick) : T_END
  useEffect(() => { if (tick >= T_END) setRunning(false) }, [tick])

  const sim = useMemo(() => simulate(mode, workers, cap, spike), [mode, workers, cap, spike])
  const rows = sim.rows
  const play = (withSpike) => { setSpike(withSpike); setStarted(true); resetTick(); setRunning(true) }
  const ex = EXPLAIN[mode]
  const depthMax = niceMax(Math.max(sim.peakDepth, mode === 'shed' ? cap : 0, 1000))
  const latMax = niceMax(Math.max(sim.peakLat, 6))
  const [scrub, setScrub] = useState(null)          // 游標移到圖上：看任一秒
  const shown = scrub ?? t
  const cur = rows[shown]
  const lostLabel = mode === 'direct' ? '逾時（狀態不明）' : mode === 'shed' ? '重試仍被拒（放棄）' : '丟掉'
  const isQueueDepth = mode !== 'direct'

  return (
    <Lab accent="orange" kicker="SCENARIO LAB" title="推播送出後的 60 秒：同一波尖峰，四種做法"
         blurb="按「發推播」注入尖峰，看四張圖怎麼走；切換做法、拉 worker 數與佇列上限，比較誰堆積、誰拒絕、誰逾時、誰追得上。">
      <LabControls>
        <Seg label="做法" tinted value={mode} onChange={setMode} options={MODES} />
        <Slider label={mode === 'direct' ? '處理能力（下游上限）' : 'worker 數'} min={1} max={20} value={workers} onChange={setWorkers} format={(v) => mode === 'direct' ? `${v * PER_WORKER} 件/s` : `${v} 個 · ${v * PER_WORKER} 件/s`} />
        {mode === 'shed' && <Slider label="佇列上限" min={2000} max={100000} step={2000} value={cap} onChange={setCap} format={(v) => `${kfmt(v)} 件`} />}
      </LabControls>
      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabControls>
            <button type="button" className="btn small" onClick={() => play(true)}>{spike && started ? '再發一次推播（暴衝）' : '發推播（暴衝）'}</button>
            <button type="button" className="btn ghost small" onClick={() => play(false)}>平常流量</button>
            <span className="spacer" />
            {spike && (sim.lost > 0 ? <Status>{lostLabel} {sim.lost.toLocaleString()} 件</Status> : <Status ok>沒有丟資料</Status>)}
            {spike && (sim.apiLat <= 1 ? <Status ok>API 回應 &lt; 1 s</Status> : <Status>API 回應最長 {sim.apiLat.toFixed(1)} s</Status>)}
          </LabControls>
          <LabStage plain label="四張時間軸小圖">
            <div className="qb-charts">
              <MiniChart title="每秒請求（件/s）" max={6000} upto={t} mark={scrub} onScrub={setScrub} fmt={kfmt}
                         series={[{ key: 'in', label: '進來', color: 'var(--c-blue)', values: rows.map((r) => r.arr) }, { key: 'done', label: '處理完', color: 'var(--c-aqua)', values: rows.map((r) => r.done) }, { key: 'rej', label: mode === 'direct' ? '逾時' : '拒絕', color: 'var(--critical)', values: rows.map((r) => r.rejected) }]} />
              <MiniChart title={isQueueDepth ? '佇列深度（件）' : 'API 在途請求（件）'} max={depthMax} upto={t} mark={scrub} onScrub={setScrub} fmt={kfmt}
                         thresholds={mode === 'shed' ? [{ v: cap, label: `上限 ${kfmt(cap)}` }] : []}
                         series={[{ key: 'd', label: '深度', color: 'var(--lab-accent)', values: rows.map((r) => r.depth) }]} />
              <MiniChart title={isQueueDepth ? '完成延遲 p95（秒）' : '回應時間 p95（秒）'} max={latMax} upto={t} mark={scrub} onScrub={setScrub} fmt={sfmt}
                         thresholds={[{ v: 1, label: '1 s' }, { v: TIMEOUT, label: '客戶端逾時 5 s' }]}
                         series={[{ key: 'l', label: '延遲', color: 'var(--c-violet)', values: rows.map((r) => r.lat) }]} />
              <MiniChart title="worker 數（× 100 件/s）" max={MAX_W} upto={t} mark={scrub} onScrub={setScrub} fmt={(v) => String(v)}
                         series={[{ key: 'w', label: 'worker', color: 'var(--c-green)', values: rows.map((r) => r.w) }]} />
            </div>
            <Flow mode={mode} r={cur} cap={cap} t={shown} />
            <p className="lab-caption">t = {shown}s：進來 {cur.arr.toLocaleString()} · 處理 {cur.done.toLocaleString()} · {isQueueDepth ? '佇列' : '在途'} {cur.depth.toLocaleString()} · 延遲 {cur.lat.toFixed(1)} s · worker {cur.w}（示意；游標移到圖上可看任一秒）</p>
          </LabStage>
          <div className="qb-stats">
            <Tile label={isQueueDepth ? '佇列深度峰值' : '在途請求峰值'} value={sim.peakDepth.toLocaleString()} />
            <Tile label={mode === 'shed' ? '被拒絕（含重試）' : mode === 'direct' ? '逾時（狀態不明）' : '被拒絕'} value={(mode === 'shed' ? sim.rejectedTotal : sim.lost).toLocaleString()} bad={mode === 'direct' && sim.lost > 0} />
            <Tile label="真正丟掉" value={sim.lost.toLocaleString()} bad={sim.lost > 0} />
            <Tile label={isQueueDepth ? '完成延遲峰值' : '回應時間峰值'} value={`${sim.peakLat.toFixed(1)} s`} bad={sim.peakLat > TIMEOUT} />
            <Tile label="60 秒結束時未處理" value={sim.left.toLocaleString()} note={sim.left > 0 ? `還要 ${Math.ceil(sim.drain)} 秒消化` : ''} />
            <Tile label="worker 峰值" value={`${sim.peakW} 個`} />
          </div>
        </div>
        <div className="lab-stack">
          <LabExplain title={ex.title}>{ex.body.map((p, i) => <p key={i}>{p}</p>)}</LabExplain>
          <LabExplain title="怎麼讀這四張圖">
            <p>「處理完」那條線被 worker 數 × 100 件/s 壓住，永遠追不上尖峰；兩條線中間的面積就是堆積。深度 = 累積的（進來 − 處理完）；延遲 = 深度 ÷ 處理率，所以深度圖和延遲圖形狀一樣、單位不同。</p>
            <p>尖峰形狀固定：t = 10 發推播，5 秒內衝到 5,000，維持 15 秒，再花 15 秒回落。全部是每秒一格的示意推算。</p>
          </LabExplain>
          <Callout title="什麼時候會真的踩到">推播、電視或社群曝光、限時活動開跑、每天固定時間的批次同步、上游系統重啟後一次補送——只要進來的速度可能超過下游極限，就要先決定「多出來的請求去哪裡」：排著、拒絕、還是加機器。沒決定的話，答案就是逾時。</Callout>
        </div>
      </LabGrid>
      <style>{`
        .qb-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        @media (max-width: 560px) { .qb-charts { grid-template-columns: 1fr; } }
        .qb-chart { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 8px 10px 4px; min-width: 0; }
        .qb-chart svg { width: 100%; height: auto; display: block; }
        .qb-chart-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; flex-wrap: wrap; font-size: 0.74rem; font-weight: 700; color: var(--ink-2); letter-spacing: 0.03em; margin-bottom: 2px; }
        .qb-legend { display: inline-flex; gap: 10px; font-weight: 500; color: var(--ink-3); }
        .qb-legend i { font-style: normal; display: inline-flex; align-items: center; gap: 4px; }
        .qb-legend i::before { content: ''; width: 12px; height: 2px; background: var(--c); border-radius: 1px; }
        .qb-grid { stroke: var(--hairline); stroke-width: 1; }
        .qb-thr { stroke: var(--ink-3); stroke-width: 1; stroke-dasharray: 3 3; opacity: 0.8; }
        .qb-line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
        .qb-head { stroke: var(--ink-3); stroke-width: 1; opacity: 0.6; }
        .qb-mark { stroke: var(--ink-1); stroke-width: 1; opacity: 0.5; }
        .qb-chart svg { cursor: crosshair; touch-action: pan-y; }
        .qb-flow { margin-top: 12px; }
        .qb-flow-title { font-size: 0.7rem; color: var(--ink-3); margin-bottom: 6px; letter-spacing: 0.03em; }
        .qb-flow-row { display: flex; flex-wrap: wrap; align-items: stretch; gap: 6px; }
        .qb-box { flex: 1 1 96px; min-width: 0; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 6px 8px; text-align: center; transition: border-color 0.2s ease; }
        .qb-box.hot { border-color: var(--lab-accent); box-shadow: inset 0 0 0 1px var(--lab-accent); }
        .qb-box .l { font-size: 0.74rem; color: var(--ink-1); }
        .qb-box .s { font-family: var(--mono); font-size: 0.72rem; color: var(--ink-2); margin-top: 2px; font-variant-numeric: tabular-nums; }
        .qb-arrow { align-self: center; color: var(--ink-3); font-size: 0.9rem; }
        .qb-back { margin-top: 6px; font-family: var(--mono); font-size: 0.74rem; font-weight: 700; color: var(--critical); }
        .qb-note { margin-top: 4px; font-size: 0.72rem; color: var(--ink-3); }
        .qb-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
        @media (max-width: 560px) { .qb-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        .qb-tile { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 8px 10px; min-width: 0; }
        .qb-tile .l { font-size: 0.68rem; color: var(--ink-3); letter-spacing: 0.03em; }
        .qb-tile .v { font-family: var(--mono); font-size: 1.05rem; font-weight: 700; color: var(--ink-1); font-variant-numeric: tabular-nums; margin-top: 2px; }
        .qb-tile.bad .v { color: var(--critical); }
        .qb-tile .n { font-size: 0.68rem; color: var(--ink-3); }
      `}</style>
    </Lab>
  )
}

function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const m = v / p
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p
}

function Tile({ label, value, bad = false, note = '' }) {
  return <div className={`qb-tile${bad ? ' bad' : ''}`}><div className="l">{label}</div><div className="v">{value}</div>{note && <div className="n">{note}</div>}</div>
}

/* 架構流向：這一秒的數字流過每一站；多出來的請求在哪裡堆、在哪裡被擋，隨做法變。用 HTML flex，手機自動換行 */
function Flow({ mode, r, cap, t }) {
  const hasQ = mode !== 'direct'
  const boxes = hasQ ? [
    { l: '客戶端', s: `${r.arr.toLocaleString()} req/s` },
    { l: 'API', s: '202 · ~20 ms' },
    { l: mode === 'shed' ? `佇列（上限 ${kfmt(cap)}）` : '佇列', s: `深度 ${r.depth.toLocaleString()}`, hot: r.depth > 0 },
    { l: `worker × ${r.w}${r.pend ? `（+${r.pend} 開機中）` : ''}`, s: `${(r.w * PER_WORKER).toLocaleString()} 件/s` },
    { l: '下游 DB + 寄信', s: `處理 ${r.done.toLocaleString()}/s` },
  ] : [
    { l: '客戶端', s: `${r.arr.toLocaleString()} req/s` },
    { l: 'API（同步等下游）', s: `在途 ${r.depth.toLocaleString()}`, hot: r.depth > 0 },
    { l: '下游 DB + 寄信', s: `處理 ${r.done.toLocaleString()}/s` },
  ]
  const back = mode === 'direct' ? `逾時 ${r.rejected.toLocaleString()}/s，客戶端放棄、狀態不明` : mode === 'shed' ? `503 ${r.rejected.toLocaleString()}/s，客戶端 5 秒後重試` : ''
  return (
    <div className="qb-flow" aria-label={`t = ${t} 秒的流向`}>
      <div className="qb-flow-title">t = {t}s 的流向（示意）</div>
      <div className="qb-flow-row">
        {boxes.map((b, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="qb-arrow" aria-hidden="true">→</span>}
            <div className={`qb-box${b.hot ? ' hot' : ''}`}><div className="l">{b.l}</div><div className="s">{b.s}</div></div>
          </React.Fragment>
        ))}
      </div>
      {back && r.rejected > 0 && <div className="qb-back">↩ {back}</div>}
      {mode === 'queue' && r.depth > 0 && <div className="qb-note">佇列沒有上限，尖峰期間一直長；完成延遲＝深度 ÷ 處理率</div>}
      {mode === 'autoscale' && r.pend > 0 && <div className="qb-note">偵測 + 開機要 15 秒，{r.pend} 個 worker 還在路上</div>}
    </div>
  )
}

/* 單一 y 軸的小折線圖：線 2px、hairline 格線、畫到 upto 秒為止；游標移過去可以看任一秒 */
function MiniChart({ title, series, max, upto, thresholds = [], fmt, mark = null, onScrub }) {
  const W = 320, H = 128, L = 38, R = 8, T = 10, B = 18
  const x = (s) => L + (s / T_END) * (W - L - R)
  const y = (v) => T + (1 - Math.min(v, max) / max) * (H - T - B)
  const path = (vals) => vals.slice(0, upto + 1).map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const onMove = (e) => {
    const b = e.currentTarget.getBoundingClientRect()
    const xv = ((e.clientX - b.left) / b.width) * W
    onScrub(Math.max(0, Math.min(T_END, Math.round(((xv - L) / (W - L - R)) * T_END))))
  }
  return (
    <div className="qb-chart">
      <div className="qb-chart-head">
        <span>{title}</span>
        {series.length > 1 && <span className="qb-legend">{series.map((s) => <i key={s.key} style={{ '--c': s.color }}>{s.label}</i>)}</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} onPointerMove={onMove} onPointerLeave={() => onScrub(null)}>
        {mark !== null && <line x1={x(mark)} x2={x(mark)} y1={T} y2={H - B} className="qb-mark" />}
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} className="qb-grid" />
            <text x={L - 4} y={y(max * f) + 3.5} textAnchor="end" className="svg-text small">{fmt(max * f)}</text>
          </g>
        ))}
        {[0, 15, 30, 45, 60].map((s) => <text key={s} x={x(s)} y={H - 4} textAnchor="middle" className="svg-text small">{s}s</text>)}
        {thresholds.filter((th) => th.v <= max).map((th) => (
          <g key={th.label}>
            <line x1={L} x2={W - R} y1={y(th.v)} y2={y(th.v)} className="qb-thr" />
            <text x={W - R} y={y(th.v) - 3} textAnchor="end" className="svg-text small">{th.label}</text>
          </g>
        ))}
        {series.map((s) => <path key={s.key} d={path(s.values)} className="qb-line" style={{ stroke: s.color }} />)}
        <line x1={x(upto)} x2={x(upto)} y1={T} y2={H - B} className="qb-head" />
      </svg>
    </div>
  )
}

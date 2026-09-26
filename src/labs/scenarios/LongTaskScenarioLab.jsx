import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Slider, Callout, Stats, Stat, useReducedMotion, useWidth } from '../ui.jsx'

/* 長任務情境模擬器：
   一批人同時按「匯出」，三種做法下「客戶端 / API worker 池 / 背景 worker」三條泳道各自發生什麼。
   全部是示意的時間模型：閘道逾時 60 秒、輪詢間隔 5 秒、背景 worker 4 個、每 2 秒多一個人按。 */

const GATEWAY = 60, BG = 4, POLL = 5, GAP = 2

function simulate(mode, users, apiN, dur) {
  const apiFree = Array(apiN).fill(0), bgFree = Array(BG).fill(0)
  const api = [], bg = [], clients = []
  // 找最早空下來的 worker，從 max(t, 空下來的時間) 起占用 len 秒
  const grab = (free, t, len) => {
    let w = 0
    for (let i = 1; i < free.length; i++) if (free[i] < free[w]) w = i
    const a = Math.max(t, free[w]); free[w] = a + len
    return { w, a, b: a + len }
  }
  for (let k = 0; k < users; k++) {
    const t0 = k * GAP, id = `job_${String(k + 1).padStart(2, '0')}`
    if (mode === 'sync') {
      const s = grab(apiFree, t0, dur)
      const timeout = s.b > t0 + GATEWAY
      api.push({ ...s, k, kind: 'job', waste: timeout ? Math.max(s.a, t0 + GATEWAY) : null })
      clients.push({ k, id, t0, tEnd: timeout ? t0 + GATEWAY : s.b, ok: !timeout, work: s })
    } else {
      const e = grab(apiFree, t0, 0.4); api.push({ ...e, k, kind: 'enq' })
      const j = grab(bgFree, e.b, dur); bg.push({ ...j, k, id })
      const polls = []
      let tEnd = j.b + 0.5                               // push：完成後 0.5 秒收到通知
      if (mode === 'poll') {
        for (let t = e.b + POLL; ; t += POLL) {          // 每 5 秒問一次，問到 done 為止
          const p = grab(apiFree, t, 0.2); api.push({ ...p, k, kind: 'poll' }); polls.push(p.a)
          if (p.a >= j.b) { tEnd = p.b; break }
        }
      }
      clients.push({ k, id, t0, t202: e.b, tEnd, ok: true, polls, job: j })
    }
  }
  const total = Math.max(...clients.map((c) => c.tEnd), ...api.map((x) => x.b), ...bg.map((x) => x.b)) + 4
  return { mode, users, apiN, dur, api, bg, clients, total }
}

function metrics(sim, at) {
  const clip = (x, from) => Math.max(0, Math.min(x.b, at) - Math.max(x.a, from ?? x.a))
  const busy = sim.api.reduce((s, x) => s + clip(x), 0)
  const waste = sim.api.reduce((s, x) => s + (x.waste != null ? clip(x, x.waste) : 0), 0)
  return {
    util: at <= 0 ? 0 : Math.min(100, Math.round((busy / (sim.apiN * at)) * 100)),
    timeouts: sim.clients.filter((c) => !c.ok && c.tEnd <= at).length,
    done: sim.clients.filter((c) => c.ok && c.tEnd <= at).length,
    polls: sim.api.filter((x) => x.kind === 'poll' && x.a <= at).length,
    waste,
  }
}

const fmt = (s) => s < 60 ? `${Math.round(s)} 秒` : `${Math.floor(s / 60)} 分 ${String(Math.round(s % 60)).padStart(2, '0')} 秒`
const MODES = [{ value: 'sync', label: '同步等待' }, { value: 'poll', label: '202 + 輪詢' }, { value: 'push', label: '202 + 推播' }]

const TEXT = {
  sync: { title: '同步：worker 被占滿，60 秒一到閘道就砍', body: ['每個請求握住一個 API worker 直到 CSV 產完。工作超過 60 秒時，nginx / 負載平衡器在第 60 秒回給使用者 504——但 worker 不知道客戶端已經走了，橘色條後面的紅色段是「白做」：算完的檔案沒有人收。', '第 5 個人開始連 worker 都拿不到，先在 API 的 backlog 排隊，一樣在 60 秒後被砍。網站其他所有端點在這段時間都排在同一個隊伍裡。把「工作長度」拉到 10 秒以下，同步才成立。'] },
  poll: { title: '202 + 輪詢：API 只花幾毫秒，工作由背景 worker 排隊做', body: ['API worker 池那條幾乎是空的：收單 0.4 秒回 202，之後每 5 秒一次 0.2 秒的 GET /jobs/{id}。匯出本身在背景 worker 排隊，4 個 worker 同時最多做 4 份，後面的 queued。', '「202 不會讓工作變快」——最後一個人拿到檔案的時間仍取決於背景 worker 數與工作長度；它解決的是逾時與 API 被占滿，並且讓 jobs 表記得每份工作的狀態與進度，關掉分頁回來還查得到。'] },
  push: { title: '202 + 推播：完成才通知，沒有無效請求', body: ['前半段與輪詢完全相同（202、佇列、背景 worker、jobs 表），差別在客戶端那條線：沒有青色的輪詢點，直到工作完成的那一刻才收到一次通知（webhook / WebSocket / email）。', '代價是通知管道本身：WebSocket 要維護長連線；webhook 要簽章、重試、處理對方掛掉；email 有延遲。通知可能漏，所以 GET /jobs/{id} 仍要保留當備援，只是不用一直打。'] },
}

export default function LongTaskScenarioLab() {
  const [mode, setMode] = useState('sync')
  const [users, setUsers] = useState(8)
  const [apiN, setApiN] = useState(4)
  const [dur, setDur] = useState(150)
  const reduced = useReducedMotion()
  const sim = useMemo(() => simulate(mode, users, apiN, dur), [mode, users, apiN, dur])

  /* 播放頭：null = 不在播放，顯示最終結果 */
  const [playT, setPlayT] = useState(null)
  const timer = useRef(null)
  const stop = () => { if (timer.current) { cancelAnimationFrame(timer.current.raf); clearInterval(timer.current.iv) } timer.current = null; setPlayT(null) }
  useEffect(() => stop, [sim])
  const play = () => {
    if (timer.current) { stop(); return }
    const total = sim.total
    if (reduced) {
      let t = 0
      const iv = setInterval(() => { t += total / 12; if (t >= total) { stop(); return } setPlayT(t) }, 400)
      timer.current = { iv }
    } else {
      const start = performance.now(), durMs = 7000
      const tick = (now) => { const t = ((now - start) / durMs) * total; if (t >= total) { stop(); return } setPlayT(t); timer.current = { raf: requestAnimationFrame(tick) } }
      timer.current = { raf: requestAnimationFrame(tick) }
    }
    setPlayT(0)
  }
  const playing = playT !== null
  const at = playing ? playT : sim.total
  const m = metrics(sim, at)
  const last = Math.max(...sim.clients.map((c) => c.tEnd))
  const box = useRef(null)
  const narrow = useWidth(box, 700) < 520
  const text = TEXT[mode]

  return (
    <Lab accent="aqua" kicker="SCENARIO LAB" title="三分鐘的匯出：同一批人同時按，三條泳道各自發生什麼"
         blurb="調人數、API worker 數與工作長度，按「開始」看時間軸怎麼跑。閘道逾時固定 60 秒、背景 worker 固定 4 個、輪詢每 5 秒一次，全部示意。">
      <LabControls>
        <Seg tinted label="做法" value={mode} onChange={setMode} options={MODES} />
        <Slider label="同時按的人數" min={1} max={20} value={users} onChange={setUsers} format={(v) => `${v} 人`} />
        <Slider label="API worker 數" min={1} max={8} value={apiN} onChange={setApiN} format={(v) => `${v} 個`} />
        <Slider label="工作長度" min={10} max={180} step={10} value={dur} onChange={setDur} format={(v) => fmt(v)} />
        <button type="button" className="btn small" onClick={play}>{playing ? '■ 停止' : '▶ 開始'}</button>
      </LabControls>
      <LabGrid variant="wide">
        <div className="lab-stack" ref={box}>
          <LabStage label="時序泳道" caption="橘＝API worker 執行匯出 · 紅＝客戶端已收到 504、worker 仍在跑（白做） · 青＝202 / 輪詢 · 紫＝背景 worker · 虛線＝客戶端在等">
            <Lanes sim={sim} at={at} narrow={narrow} />
          </LabStage>
          <Stats min={130}>
            <Stat label="t" value={fmt(at)} />
            <Stat label="逾時 504" value={m.timeouts} tone={m.timeouts ? 'bad' : ''} />
            <Stat label="拿到結果" value={m.done} unit={`/ ${users}`} tone="ok" />
            <Stat label="API worker 占用" value={`${m.util}%`} tone={m.util > 70 ? 'bad' : ''} />
            {mode === 'sync' && <Stat label="白做" value={fmt(m.waste)} tone={m.waste ? 'bad' : ''} />}
            {mode === 'poll' && <Stat label="輪詢次數" value={m.polls} />}
            <Stat label={`最後一人${mode === 'sync' && m.timeouts ? '得到回應' : '拿到檔案'}`} value={fmt(last)} />
          </Stats>
          <div className="lt-tablewrap">
            <JobsTable sim={sim} at={at} />
          </div>
        </div>
        <div className="lab-stack">
          <LabExplain title={text.title}>{text.body.map((p, i) => <p key={i}>{p}</p>)}</LabExplain>
          <Callout title="什麼時候會真的踩到">
            任何一個請求可能超過閘道逾時（常見 30–60 秒）的工作：匯出、報表、批次寄信、影片轉檔、大檔匯入、呼叫很慢的第三方。行動網路更早：連線 30 秒沒回應 App 就自己斷了。
            判準只有一個——<b>這個請求在最壞情況下要跑多久</b>；超過逾時的一半就該改 202。
          </Callout>
        </div>
      </LabGrid>
      <style>{`
        .lt-svg { width: 100%; }
        .lt-svg .lane { fill: var(--surface-1); stroke: var(--hairline); }
        .lt-svg .lanelabel { font-family: var(--sans); font-size: 11px; font-weight: 700; fill: var(--ink-2); letter-spacing: 0.04em; }
        .lt-svg .rowlabel { font-family: var(--mono); font-size: 9.5px; fill: var(--ink-3); }
        .lt-svg .tick { stroke: var(--hairline); stroke-dasharray: 2 3; }
        .lt-svg .ticklabel { font-family: var(--mono); font-size: 10px; fill: var(--ink-3); }
        .lt-svg .wait { stroke: var(--ink-3); stroke-width: 1.2; stroke-dasharray: 2 2; }
        .lt-svg .job { fill: var(--c-orange); }
        .lt-svg .waste { fill: var(--critical); opacity: 0.8; }
        .lt-svg .small { fill: var(--c-aqua); }
        .lt-svg .bg { fill: var(--c-violet); opacity: 0.85; }
        .lt-svg .bglabel { font-family: var(--mono); font-size: 9px; fill: #fff; }
        .lt-svg .dot { fill: var(--c-aqua); }
        .lt-svg .res { font-family: var(--mono); font-size: 10px; font-weight: 700; }
        .lt-svg .res.bad { fill: var(--critical); }
        .lt-svg .res.ok { fill: var(--good); }
        .lt-svg .head { stroke: var(--ink-1); stroke-width: 1.5; }
        .lt-svg .headlabel { font-family: var(--mono); font-size: 10px; fill: var(--ink-1); font-weight: 700; }
        .lt-svg .note { font-family: var(--sans); font-size: 10.5px; fill: var(--ink-3); }
        .lt-tablewrap { max-height: 230px; overflow: auto; border-radius: var(--radius); }
        .lt-tablewrap .dtable td.q { color: var(--ink-3); }
        .lt-tablewrap .dtable td.run { color: var(--c-orange); }
        .lt-tablewrap .dtable td.done { color: var(--good); }
        .lt-tablewrap .dtable td.bad { color: var(--critical); }
        .lt-prog { display: inline-block; width: 60px; height: 7px; background: var(--surface-2); border: 1px solid var(--hairline); border-radius: 2px; vertical-align: middle; margin-right: 6px; overflow: hidden; }
        .lt-prog i { display: block; height: 100%; background: var(--c-violet); }
        .lt-prog.sync i { background: var(--c-orange); }
      `}</style>
    </Lab>
  )
}

/* 三條泳道：客戶端每人一列、API worker 每個一列、背景 worker 每個一列 */
function Lanes({ sim, at, narrow }) {
  const W = narrow ? 380 : 700, LX = narrow ? 50 : 100, RX = 14
  const rowH = sim.users > 12 ? 10 : 14, head = 16, gap = 10
  const bgRows = sim.mode === 'sync' ? 1 : BG
  const y1 = 6, y2 = y1 + head + sim.users * rowH + gap, y3 = y2 + head + sim.apiN * rowH + gap
  const H = y3 + head + bgRows * rowH + 24
  const x = (t) => LX + (t / sim.total) * (W - LX - RX)
  const px = (W - LX - RX) / sim.total                 // 每秒幾 px，用來合併太密的輪詢
  const step = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600].find((s) => sim.total / s <= 8) || 3600
  const ticks = []; for (let t = 0; t <= sim.total; t += step) ticks.push(t)
  const merge = (list) => {                            // 同一列上間距小於 1.5px 的區段合併成一段
    const out = []; for (const it of list.slice().sort((a, b) => a.a - b.a)) { const l = out[out.length - 1]; if (l && (it.a - l.b) * px < 1.5) l.b = Math.max(l.b, it.b); else out.push({ ...it }) } return out
  }
  const bar = (it, y, h, cls, key) => {
    if (it.a >= at) return null
    const b = Math.min(it.b, at)
    return <rect key={key} x={x(it.a)} y={y} width={Math.max(1.5, x(b) - x(it.a))} height={h} className={cls} rx="1" />
  }
  const Lane = ({ y, rows, label }) => (
    <g>
      <rect x={LX - 4} y={y + head - 2} width={W - LX - RX + 8} height={rows * rowH + 4} className="lane" rx="2" />
      <text x={LX - 4} y={y + 10} className="lanelabel">{label}</text>
    </g>
  )
  return (
    <svg className="lt-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`時序圖：${sim.users} 人、${sim.apiN} 個 API worker、工作 ${fmt(sim.dur)}`}>
      {ticks.map((t) => <g key={t}><line x1={x(t)} x2={x(t)} y1={y1 + head} y2={H - 16} className="tick" /><text x={x(t)} y={H - 4} textAnchor="middle" className="ticklabel">{t < 60 ? `${t}s` : `${Math.round(t / 60)}m`}</text></g>)}
      <Lane y={y1} rows={sim.users} label={narrow ? `客戶端 ${sim.users}` : `客戶端（${sim.users} 人）`} />
      {sim.clients.map((c) => {
        const y = y1 + head + c.k * rowH + rowH / 2
        const end = Math.min(c.tEnd, at)
        const from = sim.mode === 'sync' ? c.t0 : c.t202
        return (
          <g key={c.k}>
            {rowH >= 14 && !narrow && <text x={LX - 8} y={y + 3} textAnchor="end" className="rowlabel">#{c.k + 1}</text>}
            {c.t0 <= at && <circle cx={x(c.t0)} cy={y} r="2.2" className="svg-muted" />}
            {sim.mode !== 'sync' && c.t202 <= at && <rect x={x(c.t202) - 1} y={y - 3.5} width="2.5" height="7" className="small" />}
            {from < at && <line x1={x(from)} x2={x(end)} y1={y} y2={y} className="wait" />}
            {sim.mode === 'poll' && merge(c.polls.filter((t) => t <= at).map((t) => ({ a: t, b: t + 0.2 }))).map((p, i) => <circle key={i} cx={x(p.a)} cy={y} r="1.8" className="dot" />)}
            {c.tEnd <= at && <text x={x(c.tEnd) + 3} y={y + 3.5} className={`res ${c.ok ? 'ok' : 'bad'}`}>{c.ok ? (sim.mode === 'push' ? '⚡✓' : '✓') : '504'}</text>}
          </g>
        )
      })}
      <Lane y={y2} rows={sim.apiN} label={narrow ? `API ×${sim.apiN}` : `API worker 池（${sim.apiN} 個）`} />
      {Array.from({ length: sim.apiN }, (_, w) => {
        const y = y2 + head + w * rowH + 1.5, h = rowH - 3
        const mine = sim.api.filter((it) => it.w === w)
        return (
          <g key={w}>
            {!narrow && <text x={LX - 8} y={y + h / 2 + 3} textAnchor="end" className="rowlabel">w{w + 1}</text>}
            {mine.filter((it) => it.kind === 'job').map((it, i) => <g key={i}>{bar(it, y, h, 'job', 'j')}{it.waste != null && bar({ a: it.waste, b: it.b }, y, h, 'waste', 'w')}</g>)}
            {merge(mine.filter((it) => it.kind !== 'job')).map((it, i) => bar(it, y, h, 'small', i))}
          </g>
        )
      })}
      <Lane y={y3} rows={bgRows} label={narrow ? `背景 ×${BG}` : `背景 worker（${BG} 個）`} />
      {sim.mode === 'sync'
        ? <text x={LX + 6} y={y3 + head + rowH / 2 + 3} className="note">沒有背景 worker：匯出在 API worker 裡跑</text>
        : Array.from({ length: BG }, (_, w) => {
          const y = y3 + head + w * rowH + 1.5, h = rowH - 3
          return (
            <g key={w}>
              {!narrow && <text x={LX - 8} y={y + h / 2 + 3} textAnchor="end" className="rowlabel">bg{w + 1}</text>}
              {sim.bg.filter((it) => it.w === w).map((it, i) => (
                <g key={i}>{bar(it, y, h, 'bg', 'b')}{it.a < at && x(Math.min(it.b, at)) - x(it.a) > 40 && h >= 9 && <text x={x(it.a) + 3} y={y + h / 2 + 3} className="bglabel">{it.id}</text>}</g>
              ))}
            </g>
          )
        })}
      {at < sim.total && <g><line x1={x(at)} x2={x(at)} y1={y1 + 4} y2={H - 16} className="head" /><text x={Math.min(x(at) + 4, W - 60)} y={y1 + 10} className="headlabel">{fmt(at)}</text></g>}
    </svg>
  )
}

/* jobs 表：同步模式看的是每個請求的下場；202 模式看的是 jobs 表本身 */
function JobsTable({ sim, at }) {
  const sync = sim.mode === 'sync'
  const row = (c) => {
    if (at < c.t0) return { st: '—', cls: 'q', prog: 0, seen: '尚未送出' }
    if (sync) {
      const w = c.work
      const prog = Math.max(0, Math.min(1, (at - w.a) / sim.dur))
      if (at < w.a) return { st: '等 API worker', cls: 'q', prog: 0, seen: `等了 ${fmt(at - c.t0)}` }
      if (c.ok) return at < w.b ? { st: 'running', cls: 'run', prog, seen: '等回應中' } : { st: '200 回傳檔案', cls: 'done', prog: 1, seen: '拿到檔案' }
      if (at < c.tEnd) return { st: 'running', cls: 'run', prog, seen: '等回應中' }
      return at < w.b ? { st: 'running（白做）', cls: 'bad', prog, seen: '504 Gateway Timeout' } : { st: '做完了，沒人收', cls: 'bad', prog: 1, seen: '504 Gateway Timeout' }
    }
    const j = c.job
    const prog = Math.max(0, Math.min(1, (at - j.a) / sim.dur))
    if (at < c.t202) return { st: '送出中', cls: 'q', prog: 0, seen: '等 202' }
    if (at < j.a) return { st: 'queued', cls: 'q', prog: 0, seen: sim.mode === 'poll' ? '輪詢：queued' : '等通知' }
    if (at < j.b) return { st: 'running', cls: 'run', prog, seen: sim.mode === 'poll' ? `輪詢：running ${Math.round(prog * 100)}%` : '等通知' }
    if (at < c.tEnd) return { st: 'done', cls: 'done', prog: 1, seen: sim.mode === 'poll' ? '下次輪詢才會知道' : '通知送出中' }
    return { st: 'done', cls: 'done', prog: 1, seen: sim.mode === 'poll' ? '輪詢：done，拿到下載連結' : '收到通知，拿到下載連結' }
  }
  return (
    <table className="dtable">
      <thead><tr><th>{sync ? '請求' : 'jobs.id'}</th><th>狀態</th><th>進度</th><th>客戶端看到</th></tr></thead>
      <tbody>
        {sim.clients.map((c) => { const r = row(c); return (
          <tr key={c.k}><td>{c.id}</td><td className={r.cls}>{r.st}</td>
            <td><span className={`lt-prog${sync ? ' sync' : ''}`}><i style={{ width: `${r.prog * 100}%` }} /></span>{Math.round(r.prog * 100)}%</td>
            <td className={r.cls === 'bad' ? 'bad' : ''}>{r.seen}</td></tr>
        ) })}
      </tbody>
    </table>
  )
}

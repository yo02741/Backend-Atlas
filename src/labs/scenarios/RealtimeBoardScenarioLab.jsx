import React, { useEffect, useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Callout, Stats, Stat, Caption, useTicker, fmtN } from '../ui.jsx'

/* 報到看板情境模擬器：一台櫃台電腦的看板，5 分鐘裡 4 個診間陸續叫號。
   可以加三種狀況：60 s 網路斷 8 秒（連線被中斷）、150 s 後端重啟 6 秒（期間回 502）、190 s 起切到背景 90 秒。
   三種做法 × 「最簡單的寫法 / 完整寫法」，看畫面上的號碼何時對、何時落後、何時停住。
   假設：SSE 伺服器送 retry: 3000；WebSocket 的退避是 1、2、4… 秒（抖動取中間值 0.75）；回應 0.25 秒；全部是示意。 */

/* 說明文字裡的 `程式碼` 轉成 <code> */
const ic = (s) => String(s).split(/`([^`]+)`/).map((p, i) => (i % 2 ? <code key={i}>{p}</code> : p))

const T_END = 300
const DT = 0.25
const ROOMS = ['101', '102', '103', '104']
const INIT = { 101: 12, 102: 7, 103: 21, 104: 3 }
const CALLS = (() => {
  const raw = [[8, '101'], [19, '103'], [27, '102'], [38, '104'], [47, '101'], [58, '103'], [63, '102'], [66, '104'], [79, '101'], [91, '103'], [104, '102'], [117, '104'], [129, '101'], [141, '103'], [152, '102'], [154, '104'], [166, '101'], [178, '103'], [193, '102'], [207, '104'], [219, '101'], [232, '103'], [246, '102'], [259, '104'], [268, '101'], [281, '103'], [293, '102']]
  const n = { ...INIT }
  return raw.map(([t, room]) => ({ t, room, n: ++n[room] }))
})()
function truth(t) { const b = { ...INIT }; for (const c of CALLS) if (c.t <= t) b[c.room] = c.n; return b }
const FAULTS = { wifi: [60, 68], restart: [150, 156], hidden: [190, 280] }
const backoff = (a) => Math.min(30, 2 ** a) * 0.75
const OPTS = [
  { value: 'polling', label: '輪詢' },
  { value: 'sse', label: 'SSE' },
  { value: 'websocket', label: 'WebSocket' },
]

function simulate(opt, full, N, f) {
  const inR = (key, t) => f[key] && t >= FAULTS[key][0] && t < FAULTS[key][1]
  const online = (t) => !inR('wifi', t)
  const up = (t) => !inR('restart', t)
  let board = { ...INIT }, status = 'live', nextTry = 0, attempt = 0, hiddenSince = null, prevHid = false
  let nextPoll = 0, pendingPoll = null, pendingSnap = null, req = 0, bgReq = 0, ci = 0
  const shownAt = CALLS.map(() => null)
  const steps = []
  for (let i = 0; i <= T_END / DT; i++) {
    const t = i * DT
    const hid = inR('hidden', t)
    const count = () => { req++; if (hid) bgReq++ }
    if (opt === 'polling') {
      if (pendingPoll && pendingPoll.at <= t + 1e-9) { if (pendingPoll.ok) board = pendingPoll.snap; status = pendingPoll.ok ? 'live' : 'retry'; pendingPoll = null }
      let due
      if (!full) due = Math.abs(t / N - Math.round(t / N)) < 1e-9                      // setInterval：時間到就送，背景也照送
      else if (hid) { due = false; status = 'paused' }                                // 背景：停
      else { if (prevHid) nextPoll = t; due = t >= nextPoll - 1e-9 }                   // 回到前景：立刻抓一次
      if (due) {
        count()
        pendingPoll = { at: t + DT, ok: online(t) && up(t), snap: truth(t) }
        nextPoll = t + DT + N                                                          // 回來之後才排下一次
      }
    } else {
      if (full) {
        if (hid) { if (hiddenSince === null) hiddenSince = t; if (t - hiddenSince >= 60 && status !== 'paused') status = 'paused' }
        else { if (status === 'paused') { status = 'retry'; nextTry = t; attempt = 0 } hiddenSince = null }
      }
      if (status === 'live' && (!online(t) || !up(t))) {
        if (opt === 'sse') { status = 'retry'; nextTry = t + 3 }                       // 瀏覽器自己重連
        else if (full) { status = 'retry'; nextTry = t + backoff(attempt++) }
        else status = 'dead'                                                           // 沒寫重連：停在這裡
      }
      if (status === 'retry' && t >= nextTry - 1e-9) {
        count()
        if (online(t) && up(t)) { status = 'live'; attempt = 0; if (full) { count(); pendingSnap = t + DT } }
        else if (opt === 'sse' && !online(t)) nextTry = t + 3                          // 網路錯誤：瀏覽器繼續重連
        else if (opt === 'sse' && !full) status = 'dead'                               // 502：EventSource 進入 CLOSED
        else nextTry = t + backoff(attempt++)
      }
      if (pendingSnap !== null && t >= pendingSnap - 1e-9) { board = truth(t); pendingSnap = null }
      while (ci < CALLS.length && CALLS[ci].t <= t + 1e-9) {
        const c = CALLS[ci++]
        if (status === 'live') board = { ...board, [c.room]: c.n }
      }
    }
    CALLS.forEach((c, j) => { if (shownAt[j] === null && c.t <= t && board[c.room] >= c.n) shownAt[j] = t })
    const tr = truth(t)
    const mism = ROOMS.some((r) => board[r] !== tr[r])
    let k
    if (hid) k = 'bg'
    else if (status === 'dead') k = 'dead'
    else if (!mism) k = 'ok'
    else if (opt === 'polling' || status !== 'live' || pendingSnap !== null) k = 'lag'
    else k = 'wrong'
    steps.push({ t, k, board, status })
    prevHid = hid
  }
  const counted = CALLS.map((c, j) => ({ c, s: shownAt[j] })).filter(({ c }) => !inR('hidden', c.t))
  const delays = counted.filter((x) => x.s !== null).map((x) => x.s - x.c.t)
  const segs = []
  for (const s of steps) {
    const last = segs[segs.length - 1]
    if (last && last.k === s.k) last.to = s.t + DT
    else segs.push({ k: s.k, from: s.t, to: s.t + DT })
  }
  const secs = (ks) => steps.filter((s) => ks.includes(s.k)).length * DT
  return {
    steps, segs, req, bgReq, end: steps[steps.length - 1].status,
    avg: delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : 0,
    max: delays.length ? Math.max(...delays) : 0,
    never: counted.length - delays.length,
    lag: secs(['lag']), broken: secs(['wrong', 'dead']),
  }
}

const KLABEL = { ok: '號碼正確', lag: '落後，會自己追上', wrong: '號碼錯了，等下一次叫號才會好', dead: '停住，不會再更新', bg: '分頁在背景' }
const STATUS_TEXT = { live: '即時', retry: '重新連線中，號碼可能不是最新的', paused: '分頁在背景，已暫停更新', dead: '' }
const EXPLAIN = {
  polling: {
    naive: { title: 'setInterval 輪詢：會自己好，但背景也在打', body: ['斷網與重啟時那幾輪請求失敗，下一輪成功就拿到完整快照，號碼自己追上。延遲是「叫號到下一輪」，平均半個間隔。', '`setInterval` 不管分頁在不在前景都照打，背景那 90 秒的請求沒人看。回應比間隔還慢時，請求會疊在一起，晚到的舊回應可能蓋掉新的。'] },
    full: { title: '完整的輪詢：setTimeout 串接、背景暫停', body: ['上一次回來才排下一次，同一時間只有一個請求；切到背景就停，回到前景立刻抓一次。', '要更即時只能縮短間隔，請求跟著變多：間隔減半，全院的請求數加倍，絕大多數回應都是「沒有變化」。'] },
  },
  sse: {
    naive: { title: '只寫 new EventSource：網路斷了會好，後端重啟就停了', body: ['網路中斷時瀏覽器自己重連（readyState 0），但後端不保留歷史，斷線那幾秒的叫號漏掉了，那個診間的號碼要等下一次叫號才會對。', '後端重啟時，重連剛好碰到 502，EventSource 進入 CLOSED（readyState 2）就放棄了。畫面停在舊號碼，沒有任何提示。'] },
    full: { title: '完整的 SSE：處理 CLOSED、每次連上補快照、背景時關掉', body: ['`error` 裡看到 CLOSED 就自己排重連（退避加抖動）；每次 `open` 抓一次快照，漏掉的叫號補回來。', '背景超過 60 秒就 `close()`，回到前景重連並補快照。在 HTTP/1.1 下，這也讓櫃台電腦的其他分頁不必和看板搶同網域的 6 條連線。'] },
  },
  websocket: {
    naive: { title: '只寫 new WebSocket：第一次斷線就停住', body: ['WebSocket 斷線只會觸發 `close`，不會重連。網路斷了 8 秒，看板就永遠停在那一刻，畫面上看起來一切正常。', '這是看板最危險的狀態：病患看著停住的號碼等，護理師叫到人才發現。'] },
    full: { title: '完整的 WebSocket：重連、退避、補快照、心跳', body: ['`close` 裡排重連，等待 1、2、4… 秒並加抖動，上限 30 秒；連上就補快照。退避讓 46 台電腦不會在後端重啟的同一秒一起撲上去，代價是恢復得比 SSE 慢一點。', '模擬沒有畫出來的：連線悄悄斷掉（NAT 或 proxy 丟掉閒置連線）時，`close` 不會觸發，要靠應用層的心跳發現。'] },
  },
}

export default function RealtimeBoardScenarioLab() {
  const [opt, setOpt] = useState('sse')
  const [full, setFull] = useState(false)
  const [N, setN] = useState(5)
  const [wifi, setWifi] = useState(true)
  const [restart, setRestart] = useState(true)
  const [hidden, setHidden] = useState(true)
  const [t, setT] = useState(T_END)
  const [running, setRunning] = useState(false)
  const [tick, resetTick] = useTicker(running, 50)
  useEffect(() => {
    if (!running) return
    const nt = Math.min(T_END, tick * 2)
    setT(nt)
    if (nt >= T_END) setRunning(false)
  }, [tick, running])

  const f = { wifi, restart, hidden }
  const sims = useMemo(() => Object.fromEntries(OPTS.map((o) => [o.value, simulate(o.value, full, N, { wifi, restart, hidden })])), [full, N, wifi, restart, hidden])
  const sim = sims[opt]
  const step = sim.steps[Math.min(sim.steps.length - 1, Math.round(t / DT))]
  const tr = truth(t)
  const ex = EXPLAIN[opt][full ? 'full' : 'naive']
  const pct = (x) => `${(x / T_END) * 100}%`
  const play = () => { resetTick(); setT(0); setRunning(true) }
  // 全院：6 台電視 + 40 台櫃台電腦，櫃台 6 成時間在背景（示意）
  const fg = 6 + 40 * 0.4
  const fleetReq = opt === 'polling' ? Math.round((full ? fg : 46) * (60 / N)) : Math.round((sim.req / (T_END / 60)) * 46)
  const fleetConn = opt === 'polling' ? 0 : full ? Math.round(fg) : 46
  const evPerMin = CALLS.length / (T_END / 60)
  const wakes = opt === 'polling' ? 60 / N : evPerMin + 2
  const endText = { live: '即時', retry: '重新連線中', paused: '暫停（背景）', dead: '停住' }[sim.end]

  return (
    <Lab accent="green" kicker="SCENARIO LAB" title="同一台櫃台電腦的 5 分鐘：斷網、後端重啟、切到背景之後，看板還對不對"
         blurb="4 個診間陸續叫號；三種做法並排，各自有最簡單與完整兩種寫法（示意）。">
      <LabControls>
        <Seg label="做法" tinted value={opt} onChange={setOpt} options={OPTS} />
        <Toggle label="完整寫法（重連、補快照、背景暫停）" checked={full} onChange={setFull} />
        <Slider label="輪詢間隔" min={2} max={30} value={N} onChange={setN} format={(v) => `${v} 秒`} />
      </LabControls>
      <LabControls>
        <Toggle label="60 s 網路斷 8 秒" checked={wifi} onChange={setWifi} />
        <Toggle label="150 s 後端重啟（502 六秒）" checked={restart} onChange={setRestart} />
        <Toggle label="190 s 切到背景 90 秒" checked={hidden} onChange={setHidden} />
      </LabControls>
      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabControls>
            <button type="button" className="btn small" onClick={play} disabled={running}>{running ? '播放中…' : '▶ 播放這 5 分鐘'}</button>
            <Slider label="時間點" min={0} max={T_END} value={t} onChange={(v) => { setRunning(false); setT(v) }} format={(v) => `${v} s`} />
          </LabControls>
          <LabStage label="三種做法的時間帶">
            <div className="rb-faults" aria-hidden="true">
              {Object.entries(FAULTS).filter(([k]) => f[k]).map(([k, [a, b]]) => <i key={k} className={k} style={{ left: pct(a), width: pct(b - a) }} />)}
            </div>
            {OPTS.map((o) => (
              <button type="button" key={o.value} className={`rb-band${o.value === opt ? ' sel' : ''}`} onClick={() => setOpt(o.value)} aria-label={`${o.label}的時間帶`}>
                <span className="rb-name">{o.label}<small>錯或停住 {sims[o.value].broken} s · 請求 {sims[o.value].req}</small></span>
                <span className="rb-strip">
                  {sims[o.value].segs.map((s, i) => <span key={i} className={`rb-seg ${s.k}`} style={{ flexGrow: s.to - s.from }} title={`${s.from}–${s.to} s：${KLABEL[s.k]}`} />)}
                  <i className="rb-head" style={{ left: pct(t) }} />
                </span>
              </button>
            ))}
            <div className="rb-legend">{Object.entries(KLABEL).map(([k, l]) => <span key={k}><i className={`rb-seg ${k}`} />{l}</span>)}</div>
          </LabStage>
          <div className={`rb-board${step.k === 'bg' ? ' bg' : ''}`} aria-label="這個時間點的看板">
            <div className="rb-board-head">
              <b>內科叫號</b>
              {full && STATUS_TEXT[step.status] && <span role="status" className={`rb-conn ${step.status}`}>{STATUS_TEXT[step.status]}</span>}
              <span className="spacer" />
              <span className="muted">t = {t} s</span>
            </div>
            <ul>
              {ROOMS.map((r) => {
                const off = step.board[r] !== tr[r]
                return <li key={r} className={off ? 'off' : ''}><span>{r} 診</span><b>{step.board[r]}</b>{off && <small>實際 {tr[r]}</small>}</li>
              })}
            </ul>
            {step.k === 'dead' && <p className="rb-warn">看板停住了，畫面上沒有任何提示</p>}
            {step.k === 'wrong' && <p className="rb-warn">連線正常，但斷線期間的叫號漏掉了</p>}
          </div>
          <Stats min={128}>
            <Stat label="叫號到畫面（平均）" value={`${sim.avg.toFixed(1)} s`} note={`最長 ${sim.max.toFixed(1)} s`} tone={sim.max > 10 ? 'warn' : ''} />
            <Stat label="到最後都沒出現的叫號" value={sim.never} tone={sim.never ? 'bad' : 'ok'} note="不含背景期間" />
            <Stat label="號碼錯或停住" value={`${sim.broken} s`} tone={sim.broken > 0 ? 'bad' : 'ok'} note={`會自己追上的落後 ${sim.lag} s`} />
            <Stat label="5 分鐘結束時" value={endText} tone={sim.end === 'dead' ? 'bad' : ''} />
            <Stat label="這台電腦的請求" value={sim.req} note={`背景期間 ${sim.bgReq}`} tone={sim.bgReq > 0 ? 'warn' : ''} />
            <Stat label="全院每分鐘請求" value={fmtN(fleetReq)} note={`長連線 ${fleetConn} 條`} />
            <Stat label="平板每分鐘收發" value={wakes.toFixed(1)} unit="次" note={opt === 'polling' ? '每輪一次' : `叫號 ${evPerMin.toFixed(1)} + 心跳 2`} />
          </Stats>
          <Caption>全院 = 6 台電視 + 40 台櫃台電腦，櫃台 6 成時間在背景；SSE 的重連間隔 3 秒、WebSocket 的退避 1、2、4… 秒（示意）。</Caption>
        </div>
        <div className="lab-stack">
          <LabExplain title={ex.title}>{ex.body.map((p, i) => <p key={i}>{ic(p)}</p>)}</LabExplain>
          <LabExplain title="推送與輪詢的收發次數">
            <p>推送在每次叫號時收一次，輪詢在每一輪問一次。這個看板 4 個診間、每分鐘約 {evPerMin.toFixed(1)} 次叫號，推送比 5 秒一次的輪詢省；看板涵蓋全院、每秒好幾則時，10 秒一次的輪詢反而能把好幾則合成一次。</p>
          </LabExplain>
          <Callout title="什麼時候會踩到">每天的部署最常見：後端重啟的幾秒內，SSE 剛好重連到 502 就放棄，WebSocket 沒寫重連就停住。沒有連線狀態提示的看板，要等病患來問才發現。</Callout>
        </div>
      </LabGrid>
      <style>{`
        .rb-faults { position: relative; height: 10px; margin-bottom: 2px; }
        .rb-faults i { position: absolute; top: 0; height: 10px; border: 1.5px solid var(--line); border-radius: 3px; }
        .rb-faults i.wifi { background: var(--st-yellow); }
        .rb-faults i.restart { background: var(--st-red); }
        .rb-faults i.hidden { background: var(--surface-2); }
        .rb-band { display: grid; gap: 4px; width: 100%; text-align: left; background: none; border: none; padding: 4px 0; cursor: pointer; font: inherit; color: inherit; min-width: 0; }
        .rb-name { font-size: 0.8rem; font-weight: 700; color: var(--ink-2); display: flex; flex-wrap: wrap; gap: 2px 10px; align-items: baseline; }
        .rb-name small { font-weight: 500; font-family: var(--mono); font-size: 0.7rem; color: var(--ink-3); }
        .rb-band.sel .rb-name { color: var(--ink-1); }
        .rb-strip { position: relative; display: flex; height: 18px; border: 1.5px solid var(--hairline); border-radius: 6px; overflow: hidden; background: var(--surface-1); }
        .rb-band.sel .rb-strip { border: 2px solid var(--line); box-shadow: 2px 2px 0 var(--shade); }
        .rb-seg { display: block; min-width: 0; }
        .rb-seg.ok { background: color-mix(in srgb, var(--good) 55%, var(--surface-1)); }
        .rb-seg.lag { background: color-mix(in srgb, var(--c-yellow) 60%, var(--surface-1)); }
        .rb-seg.wrong { background: var(--serious); }
        .rb-seg.dead { background: var(--critical); }
        .rb-seg.bg { background: var(--surface-2); }
        .rb-head { position: absolute; top: -2px; bottom: -2px; width: 2px; background: var(--ink-1); transform: translateX(-1px); }
        .rb-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 0.72rem; color: var(--ink-3); margin-top: 6px; }
        .rb-legend span { display: inline-flex; align-items: center; gap: 5px; }
        .rb-legend .rb-seg { width: 14px; height: 10px; border-radius: 2px; border: 1px solid var(--hairline); }
        .rb-board { border: var(--bw) solid var(--line); border-radius: 12px; background: var(--surface-1); box-shadow: 4px 4px 0 var(--shade); padding: 10px 14px; }
        .rb-board.bg { opacity: 0.55; }
        .rb-board-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: 0.86rem; margin-bottom: 8px; }
        .rb-board-head .spacer { flex: 1; }
        .rb-board-head .muted { font-family: var(--mono); font-size: 0.72rem; }
        .rb-conn { font-size: 0.72rem; font-weight: 700; padding: 1px 8px; border-radius: 999px; border: 1.5px solid var(--line); color: var(--on-sticker); background: var(--st-mint); }
        .rb-conn.retry { background: var(--st-yellow); }
        .rb-conn.paused { background: var(--surface-2); color: var(--ink-2); }
        .rb-board ul { list-style: none; display: grid; grid-template-columns: repeat(auto-fit, minmax(64px, 1fr)); gap: 8px; }
        .rb-board li { display: grid; justify-items: center; gap: 2px; padding: 6px 4px; border: 2px solid var(--line); border-radius: 10px; background: var(--page); }
        .rb-board li span { font-size: 0.72rem; color: var(--ink-3); }
        .rb-board li b { font-family: var(--display); font-size: 1.6rem; line-height: 1.1; font-variant-numeric: tabular-nums; }
        .rb-board li.off { border-color: var(--critical); }
        .rb-board li small { font-size: 0.68rem; color: var(--critical); font-weight: 700; }
        .rb-warn { color: var(--critical); font-size: 0.8rem; font-weight: 700; margin-top: 8px; }
      `}</style>
    </Lab>
  )
}

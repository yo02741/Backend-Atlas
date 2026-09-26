import React, { useEffect, useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Callout, Status, useReducedMotion, useLabVisible, Stats, Stat, fmtN } from '../ui.jsx'

/* 通知扇出情境模擬器（純前端、所有數字示意）：
   發文者 → API → 佇列 → worker → 推播 / email 服務 → 10 萬使用者（1,000 格，每格 100 人）
   切做法看：API 卡多久、佇列堆多高、點陣多快變綠；worker 當機重試時有沒有冪等鍵，決定紅點出不出現 */

const N = 100000                 // 追蹤者
const CELLS = 1000, PER_CELL = N / CELLS
const COLS = 50, ROWS = 20
const EMAIL_N = 20000, EMAIL_CAP = 500   // 兩成的人勾 email；email 服務每秒 500 則
const PER_WORKER = 200           // 每個 worker 每秒送 200 則（一批）
const SYNC_RATE = 200            // 同步迴圈：每則 5 ms
const CLIENT_TIMEOUT = 30
const S_MAX = 120                // 動畫最多播 120 秒
const MODES = [
  { value: 'sync', label: '同步迴圈' },
  { value: 'fanout-write', label: 'Fan-out on write' },
  { value: 'fanout-read', label: 'Fan-out on read' },
  { value: 'hybrid', label: '混合（依追蹤者數）' },
]
const secs = (s) => (s >= 60 ? `${Math.floor(s / 60)} 分 ${Math.round(s % 60)} 秒` : `${Math.round(s * 10) / 10} 秒`)

/* 固定種子的洗牌：fan-out on read 時使用者「隨機」打開 App 的順序 */
const OPEN_ORDER = (() => {
  let x = 12345
  const rnd = () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff }
  const rank = Array.from({ length: CELLS }, (_, i) => i)
  for (let i = CELLS - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [rank[i], rank[j]] = [rank[j], rank[i]] }
  const out = new Array(CELLS); rank.forEach((cell, r) => { out[cell] = r }); return out
})()

/* 在第 s 秒，各做法的狀態 */
function compute(mode, s, workers, cap, crash, idem) {
  const f = { sent: 0, emailSent: 0, dupFrom: 0, dupTo: 0, opened: 0, queue: 0, queueMax: 0, apiS: 0, done: 0, rate: 0, paused: false, bottleneck: '' }
  if (mode === 'sync') {
    const crashAt = 40, restart = 2
    f.rate = SYNC_RATE
    f.done = N / SYNC_RATE + (crash ? crashAt + restart : 0)
    f.apiS = f.done
    if (crash && s >= crashAt) {
      f.paused = s < crashAt + restart
      const again = Math.min(N, SYNC_RATE * Math.max(0, s - crashAt - restart))   // 重啟後從頭跑
      f.sent = Math.max(SYNC_RATE * crashAt, again)
      if (!idem) f.dupTo = Math.min(again, SYNC_RATE * crashAt)                   // 前 8,000 人再收一次
    } else f.sent = Math.min(N, SYNC_RATE * s)
    f.bottleneck = '單一程序序列送，推播服務回 429 也只能空等'
  } else if (mode === 'fanout-write') {
    const T = Math.min(workers * PER_WORKER, cap)
    f.rate = T
    f.apiS = 0.8
    f.queueMax = N + EMAIL_N
    const inflight = workers * PER_WORKER, half = inflight / 2
    const crashAt = 1 + Math.ceil((0.4 * N) / T), wait = 5
    const p = Math.max(0, s - 1)
    if (crash && s >= crashAt) {
      const sentC = Math.min(N, T * (crashAt - 1))
      f.paused = s < crashAt + wait
      const q = T * Math.max(0, s - crashAt - wait)               // 恢復後處理的工作數
      const redo = Math.min(inflight, q)                           // 先重做被丟回佇列的那批
      f.sent = Math.min(N, sentC + Math.max(0, redo - half) + Math.max(0, q - inflight))
      if (!idem) { f.dupFrom = sentC - half; f.dupTo = sentC - half + Math.min(half, redo) }
      f.done = 1 + (N + half) / T + wait                    // 重做的那半批也吃吞吐
    } else { f.sent = Math.min(N, T * p); f.done = 1 + N / T }
    f.emailSent = Math.min(EMAIL_N, EMAIL_CAP * p)
    f.queue = s >= 1 ? (N - f.sent) + (EMAIL_N - f.emailSent) : 0
    f.bottleneck = workers * PER_WORKER > cap ? `推播服務上限 ${fmtN(cap)}/s（worker 再多也沒用，多的只會拿到 429）` : `worker 數（${workers} × ${PER_WORKER}/s = ${fmtN(T)}/s，還沒碰到推播上限）`
  } else {
    f.apiS = 0.05
    f.opened = Math.round(N * (1 - Math.pow(0.985, s)))
    f.done = 0
    f.bottleneck = '讀取端：每次打開 App 都要查一次追蹤對象的新貼文'
  }
  f.dups = Math.max(0, f.dupTo - f.dupFrom)
  return f
}

export default function NotificationsFanoutScenarioLab() {
  const [mode, setMode] = useState('fanout-write')
  const [workers, setWorkers] = useState(5)
  const [cap, setCap] = useState(2000)
  const [crash, setCrash] = useState(false)
  const [idem, setIdem] = useState(false)
  const [s, setS] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [started, setStarted] = useState(false)
  const reduced = useReducedMotion()
  const isRead = mode === 'fanout-read' || mode === 'hybrid'

  const f = useMemo(() => compute(mode, s, workers, cap, crash, idem), [mode, s, workers, cap, crash, idem])
  const endAt = Math.min(S_MAX, mode === 'sync' ? S_MAX : isRead ? S_MAX : Math.ceil(f.done))

  const visible = useLabVisible()
  useEffect(() => {
    if (!playing || !visible) return
    if (reduced) { setS(endAt); setPlaying(false); return }
    const id = setInterval(() => setS((x) => { if (x >= endAt) { setPlaying(false); return x } return x + 1 }), 40)
    return () => clearInterval(id)
  }, [playing, reduced, endAt, visible])
  const post = () => { setS(0); setStarted(true); setPlaying(true) }
  const reset = () => { setS(0); setStarted(false); setPlaying(false) }
  useEffect(() => { reset() }, [mode])   // 換做法就歸零

  /* 每一格的狀態 */
  const cellClass = (c) => {
    if (isRead) return OPEN_ORDER[c] * PER_CELL < f.opened ? 'seen' : ''
    const lo = c * PER_CELL, hi = lo + PER_CELL
    if (f.dups > 0 && lo < f.dupTo && hi > f.dupFrom) return 'dup'
    return lo < f.sent ? 'sent' : ''
  }
  const pct = Math.round(((isRead ? f.opened : f.sent) / N) * 100)
  const timedOut = mode === 'sync' && s >= CLIENT_TIMEOUT

  return (
    <Lab accent="red" kicker="SCENARIO LAB" title="發一則文，10 萬個追蹤者怎麼收到通知"
         blurb="按「發文」看四種做法下：API 卡多久、佇列堆多高、10 萬人（每格 100 人）多快變綠。開「worker 當機重試」比較有沒有冪等鍵的差別。所有數字為示意。">
      <LabControls>
        <Seg label="做法" tinted value={mode} onChange={setMode} options={MODES} />
      </LabControls>
      <LabControls>
        <Slider label="worker 數" min={1} max={50} value={workers} onChange={setWorkers} format={(v) => `${v} 個`} />
        <Slider label="推播服務上限" min={500} max={5000} step={100} value={cap} onChange={setCap} format={(v) => `${fmtN(v)} 則/秒`} />
        <Toggle label="worker 送到一半當機重試" checked={crash} onChange={setCrash} />
        <Toggle label="冪等鍵（post_id + user_id 去重）" checked={idem} onChange={setIdem} />
        <span className="spacer" />
        <button type="button" className="btn small" onClick={post} disabled={playing}>{playing ? `送出中… t=${s}s` : '▶ 發文'}</button>
        {started && !playing && <button type="button" className="btn ghost small" onClick={reset}>重來</button>}
      </LabControls>

      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabStage label="通知管線" caption={isRead ? '發文時只寫一列貼文；使用者打開 App 才查「我追蹤的人有什麼新貼文」' : mode === 'sync' ? '發文的請求裡直接迴圈呼叫推播服務，送完才回應' : `API 展開 ${fmtN(N + EMAIL_N)} 筆工作進佇列後回 202；${workers} 個 worker 分批送`}>
            <Pipeline mode={mode} f={f} s={s} workers={workers} cap={cap} started={started} />
            {mode === 'sync' && started && (
              <div className="nf-api">
                <div className="nf-api-head"><span>發文 API 這個請求</span><span>{s < f.done ? `已經 ${secs(s)}，還在送…` : `${secs(f.done)} 後才回應`}</span></div>
                <div className="nf-track">
                  <div className="nf-fill" style={{ width: `${Math.min(100, (s / f.done) * 100)}%` }} />
                  <div className="nf-mark" style={{ left: `${(CLIENT_TIMEOUT / f.done) * 100}%` }} title="客戶端 30 秒 timeout" />
                </div>
                <p className={`nf-api-note${timedOut ? ' bad' : ''}`}>{timedOut ? `客戶端 ${CLIENT_TIMEOUT} 秒就 timeout：發文者看到「失敗」，伺服器卻還在跑；重按一次就是再送一輪` : `客戶端會在 ${CLIENT_TIMEOUT} 秒 timeout（紅線）`}</p>
              </div>
            )}
          </LabStage>
          <LabStage label="10 萬使用者點陣" plain>
            <UserGrid cellClass={cellClass} />
            <p className="nf-legend">
              <span><i className="sw" />未通知</span>
              <span><i className="sw sent" />已推播</span>
              <span><i className="sw dup" />重複收到</span>
              <span><i className="sw seen" />打開 App 才看到</span>
              <span className="pct">{isRead ? '已打開 App' : '已送達'} <b>{pct}%</b></span>
            </p>
          </LabStage>
          <Stats min={150} className="nf-stats">
            <Stat label="發文 API 回應" value={f.apiS > 1 ? secs(f.apiS) : `${Math.round(f.apiS * 1000)} ms`} tone={f.apiS > 1 ? 'bad' : 'ok'} />
            <Stat label="送完時間（示意）" value={isRead ? '不主動送' : secs(f.done)} tone={f.done > 120 ? 'bad' : ''} />
            <Stat label="重複通知" value={fmtN(f.dups)} tone={f.dups ? 'bad' : 'ok'} note={crash && !isRead && (idem ? <Status ok>冪等鍵擋掉</Status> : f.dups ? <Status>沒有去重</Status> : <Status warn>當機後才看得到</Status>)} />
            <Stat label="佇列最高深度" value={fmtN(f.queueMax)} note={mode === 'fanout-write' && started ? `目前 ${fmtN(f.queue)}` : ''} />
          </Stats>
          <p className="nf-bottleneck"><b>瓶頸：</b>{f.bottleneck}{isRead && <>；打開 App 的查詢已累計 <b>{fmtN(f.opened)}</b> 次，每次示意 15 ms（追蹤 300 人的 JOIN）</>}</p>
        </div>

        <div className="lab-stack">
          {mode === 'sync' && (
            <LabExplain title="8 分鐘的 HTTP 請求">
              <p>10 萬人 × 每則 5 ms = 500 秒。發文的請求在 30 秒就被客戶端 timeout，發文者看到失敗、重按，伺服器其實還在第一輪裡——第二輪從頭再送，前面的人全部收到兩次。</p>
              <p>開「當機重試」：程序在第 40 秒重啟，沒有任何紀錄知道送到哪，只能從頭。沒有冪等鍵就是 8,000 個紅點；有冪等鍵（推播服務用 post_id + user_id 去重）紅點消失，但時間一樣浪費。</p>
              <p>推播服務回 429 時這個迴圈也只能 sleep，因為沒有佇列可以把工作放回去。</p>
            </LabExplain>
          )}
          {mode === 'fanout-write' && (
            <LabExplain title="展開成工作，讓 worker 慢慢送">
              <p>發文時一句 <code>INSERT … SELECT</code> 把 12 萬筆工作（10 萬推播 + 2 萬 email，已依偏好算好管道）寫進工作表，API 0.8 秒回 202。佇列深度瞬間到頂，然後被 worker 以每秒 {fmtN(f.rate)} 則消化：{workers} 個 worker × 200 與推播上限 {fmtN(cap)} 取小。</p>
              <p>把 worker 拉到 20 個：吞吐停在推播上限，多的 worker 只會拿到 429。真正的解法是提高上限或跟平台談配額，不是加機器。</p>
              <p>開「當機重試」：送到 40% 時全部 worker 重啟，手上那批（{workers} × 200 筆）有一半已經送出但還沒標記 sent；5 秒後佇列把整批重新投遞。沒有冪等鍵 → {fmtN(workers * PER_WORKER / 2)} 個人收到兩次（紅）；有 <code>UNIQUE (post_id, user_id)</code> 或推播服務的 idempotency key → 0 個。</p>
            </LabExplain>
          )}
          {mode === 'fanout-read' && (
            <LabExplain title="發文時什麼都不做，打開 App 時再算">
              <p>發文只寫一列，API 50 ms 回應，佇列與 worker 都沒事做。點陣不會變綠——沒有人被推播。使用者打開 App 時查「我追蹤的人在我上次看之後有什麼新貼文」，才看到（藍）。</p>
              <p>成本搬到讀取端：每次打開 App 都是一次 JOIN（追蹤表 × 貼文表），追蹤 300 人的使用者示意 15 ms，追蹤 5,000 人的就會慢。10 萬人陸續打開就是 10 萬次查詢，但分散在幾小時裡，而且偏好與追蹤關係永遠是最新的。</p>
              <p>要主動送達（推播）就得另外走一則 topic 推播：平台幫你送給訂閱這個名人的所有裝置，不用逐人展開。</p>
            </LabExplain>
          )}
          {mode === 'hybrid' && (
            <LabExplain title="這位有 10 萬追蹤者：判定為大 V，走 read 路徑">
              <p>門檻 10,000。這則貼文的發文者超過門檻，所以不展開：只寫一列、API 50 ms、佇列為零，追蹤者打開 App 時查到（藍）。同一時間一般使用者（200 個追蹤者）發文走的是 write 路徑：展開 200 筆、一個 worker 一秒內送完、有推播。</p>
              <p>使用者的通知頁把兩種來源合併：自己的通知工作表（write 路徑寫進來的）加上「我追蹤的大 V 最近的貼文」（read 路徑即時查），依時間排序。</p>
              <p>代價是兩條路徑都要維護；好處是幾百個大 V 不會讓 500 萬筆工作塞爆佇列、拖慢所有人的通知。</p>
            </LabExplain>
          )}
          <Callout title="什麼時候會真的踩到">追蹤者破萬的帳號第一次發文、行銷部門「發給全部會員」的活動通知、部署重啟時 worker 手上的那一批。重複通知比沒收到更傷信任——冪等鍵在第一天就要有。</Callout>
        </div>
      </LabGrid>

      <style>{`
        .nf-pipe { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr) auto) minmax(0, 1fr); gap: 4px; align-items: stretch; }
        @media (max-width: 720px) { .nf-pipe { grid-template-columns: repeat(3, minmax(0, 1fr) auto) minmax(0, 1fr); row-gap: 10px; } .nf-pipe .nf-arr:nth-child(8) { display: none; } }
        .nf-node { border: 1.5px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 7px 4px; display: grid; gap: 3px; align-content: start; text-align: center; min-width: 0; transition: border-color 0.2s ease, opacity 0.2s ease; }
        .nf-node b { font-size: 0.74rem; color: var(--ink-1); }
        .nf-node small { font-family: var(--mono); font-size: 0.64rem; color: var(--ink-3); overflow-wrap: anywhere; }
        .nf-node small.bad { color: var(--critical); font-weight: 700; }
        .nf-node.on { border-color: var(--lab-accent); }
        .nf-node.busy { border-color: var(--critical); }
        .nf-node.off { opacity: 0.4; }
        .nf-node.users { border-style: dashed; }
        .nf-arr { align-self: center; color: var(--ink-3); font-size: 0.95rem; padding: 0 1px; }
        .nf-arr.on { color: var(--lab-accent); font-weight: 700; animation: nf-flow 0.8s ease-in-out infinite; }
        .nf-arr.off { opacity: 0.4; }
        @keyframes nf-flow { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
        .nf-qtrack { height: 7px; background: var(--surface-2); border: 1px solid var(--hairline); border-radius: 2px; overflow: hidden; margin-top: 2px; }
        .nf-qbar { height: 100%; background: var(--lab-accent); transition: width 0.1s linear; }
        .nf-wrow { display: flex; flex-wrap: wrap; gap: 2px; justify-content: center; margin-top: 2px; }
        .nf-wrow i { width: 8px; height: 7px; border-radius: 1px; background: var(--surface-2); border: 1px solid var(--hairline); }
        .nf-wrow i.on { background: color-mix(in srgb, var(--good) 40%, var(--surface-1)); border-color: var(--good); }
        .nf-wrow i.dead { background: color-mix(in srgb, var(--critical) 35%, var(--surface-1)); border-color: var(--critical); }
        .nf-wrow span { font-size: 0.6rem; color: var(--ink-3); }
        .nf-note { font-family: var(--mono); font-size: 0.7rem; color: var(--ink-3); margin-top: 10px; line-height: 1.5; }
        .nf-grid { width: 100%; max-width: 560px; margin: 0 auto; display: block; }
        .nf-grid rect { fill: var(--surface-2); stroke: var(--hairline); stroke-width: 0.4; transition: fill 0.25s ease; }
        .nf-grid rect.sent { fill: var(--good); }
        .nf-grid rect.dup { fill: var(--critical); }
        .nf-grid rect.seen { fill: var(--c-blue); }
        .nf-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; justify-content: center; font-size: 0.74rem; color: var(--ink-3); margin-top: 8px; }
        .nf-legend span { display: inline-flex; align-items: center; gap: 5px; }
        .nf-legend .sw { width: 10px; height: 10px; border-radius: 2px; background: var(--surface-2); border: 1px solid var(--hairline); }
        .nf-legend .sw.sent { background: var(--good); border-color: var(--good); }
        .nf-legend .sw.dup { background: var(--critical); border-color: var(--critical); }
        .nf-legend .sw.seen { background: var(--c-blue); border-color: var(--c-blue); }
        .nf-legend .pct b { font-family: var(--mono); color: var(--ink-1); }
        .nf-api { margin-top: 12px; display: grid; gap: 6px; }
        .nf-api-head { display: flex; justify-content: space-between; font-size: 0.76rem; color: var(--ink-2); font-family: var(--mono); }
        .nf-track { position: relative; height: 14px; background: var(--surface-2); border: 1px solid var(--hairline); border-radius: 3px; overflow: hidden; }
        .nf-fill { height: 100%; background: var(--lab-accent); transition: width 0.1s linear; }
        .nf-mark { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--critical); }
        .nf-api-note { font-size: 0.74rem; color: var(--ink-3); }
        .nf-api-note.bad { color: var(--critical); }
        .nf-stats .status { padding: 1px 8px; font-size: 0.66rem; }
        .nf-bottleneck { font-size: 0.78rem; color: var(--ink-2); line-height: 1.6; }
        .nf-bottleneck b { color: var(--ink-1); font-family: var(--mono); }
        @media (prefers-reduced-motion: reduce) { .nf-arr.on { animation: none; opacity: 1; } }
      `}</style>
    </Lab>
  )
}

/* 管線圖：六個節點（手機兩列），依做法決定哪些亮、哪些變淡 */
function Pipeline({ mode, f, s, workers, cap, started }) {
  const read = mode === 'fanout-read' || mode === 'hybrid'
  const write = mode === 'fanout-write'
  const sync = mode === 'sync'
  const active = started && (sync ? s < f.done : write ? s >= 1 && f.sent < N : true)
  const flowing = active && write && !f.paused
  const wCount = Math.min(workers, 12)
  const nodes = [
    { title: '發文者', sub: started ? (sync && s < f.done ? '等回應…' : '收到回應') : '按「發文」', arrow: active },
    { title: 'API', sub: !started ? '' : sync ? `卡住 ${Math.min(s, Math.ceil(f.done))} 秒` : write ? '0.8 秒回 202' : mode === 'hybrid' ? '10 萬 > 門檻 → read' : '50 ms 回 201', busy: sync && started && s < f.done, arrow: active && !read },
    { title: '佇列', sub: write ? (started ? `${fmtN(f.queue)} 筆` : '12 萬筆工作') : '—', off: !write, arrow: flowing,
      extra: write && <div className="nf-qtrack"><div className="nf-qbar" style={{ width: `${(f.queue / f.queueMax) * 100}%` }} /></div> },
    { title: `worker × ${workers}`, sub: write ? (f.paused ? '當機，批次丟回佇列' : started && f.sent < N && s >= 1 ? `${fmtN(f.rate)} 則/秒` : '閒置') : '—', off: !write, bad: f.paused, arrow: flowing,
      extra: write && <div className="nf-wrow">{Array.from({ length: wCount }, (_, k) => <i key={k} className={f.paused ? 'dead' : active && s >= 1 ? 'on' : ''} />)}{workers > wCount && <span>…</span>}</div> },
    { title: '推播服務', sub: `上限 ${fmtN(cap)}/秒`, bad: write && workers * PER_WORKER > cap, off: read, arrow: flowing, plus: true },
    { title: 'email 服務', sub: `上限 ${EMAIL_CAP}/秒`, off: !write, arrow: active && !read },
  ]
  return (
    <div>
      <div className="nf-pipe" role="img" aria-label="通知管線">
        {nodes.map((n, i) => (
          <React.Fragment key={i}>
            <div className={`nf-node${n.off ? ' off' : ''}${n.busy ? ' busy' : active && !n.off ? ' on' : ''}`}>
              <b>{n.title}</b>
              <small className={n.busy || n.bad ? 'bad' : ''}>{n.sub || '\u00a0'}</small>
              {n.extra}
            </div>
            <span className={`nf-arr${n.arrow ? ' on' : ''}${n.off && i < nodes.length - 1 ? ' off' : ''}`} aria-hidden="true">{i === nodes.length - 1 ? '⇒' : n.plus ? '+' : '→'}</span>
          </React.Fragment>
        ))}
        <div className="nf-node users"><b>10 萬使用者</b><small>下方點陣</small></div>
      </div>
      <p className="nf-note">
        {sync && '沒有佇列、沒有 worker：API 自己序列呼叫推播服務（每則 5 ms），送完才回應'}
        {write && `API 一句 INSERT … SELECT 展開 ${fmtN(N + EMAIL_N)} 筆工作（已依偏好算好管道），worker 分批取、推播與 email 各自受上限`}
        {read && `發文時什麼都不做：只 INSERT 一列貼文（${mode === 'hybrid' ? '大 V 路徑' : 'read 路徑'}）；使用者打開 App → SELECT 我追蹤的人的新貼文 → 已查 ${fmtN(f.opened)} 次`}
      </p>
    </div>
  )
}

/* 50 × 20 格點陣，每格 100 人 */
function UserGrid({ cellClass }) {
  const P = 8, S = 7
  return (
    <svg className="nf-grid" viewBox={`0 0 ${COLS * P} ${ROWS * P}`} role="img" aria-label="10 萬使用者的通知狀態">
      {Array.from({ length: CELLS }, (_, c) => (
        <rect key={c} className={cellClass(c)} x={(c % COLS) * P} y={Math.floor(c / COLS) * P} width={S} height={S} rx="1" />
      ))}
    </svg>
  )
}

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Callout, Status, Stats, Stat, useReducedMotion, useWidth } from '../ui.jsx'

/* 上傳情境模擬器：
   一個 100 MB 的檔案在「客戶端 / API / 物件儲存 / 縮圖 worker」之間怎麼流，三種做法各自經過哪些節點。
   時間與頻寬全是示意：客戶端上傳 10 MB/s、機房內 50 MB/s、API 兩台各 1 GB 記憶體 4 個 worker。 */

const FILE = 100, PARTS = 10
const NODES = { client: { x: 70, y: 130, label: '客戶端' }, api: { x: 320, y: 48, label: 'API' }, s3: { x: 570, y: 130, label: '物件儲存' }, w: { x: 320, y: 214, label: '縮圖 worker' } }
/* 手機（narrow）：viewBox 縮成 340×350、四個節點排成較高的菱形，字才不會被縮到看不清 */
const NODES_NARROW = { client: { x: 62, y: 180 }, api: { x: 170, y: 50 }, s3: { x: 278, y: 180 }, w: { x: 170, y: 290 } }
const EDGES = { 'c-api': ['client', 'api'], 'api-s3': ['api', 's3'], 'c-s3': ['client', 's3'], 'api-w': ['api', 'w'], 's3-w': ['s3', 'w'], 'w-s3': ['w', 's3'] }

function buildTimeline(mode, cut) {
  const ph = [], log = []
  let t = 0, apiBusy = 0
  const add = (edge, dur, o = {}) => { ph.push({ edge, a: t, b: t + dur, ...o }); t += dur }
  const say = (text, tone) => log.push({ t, text, tone })
  const worker = () => {
    say('API 記錄完成、把縮圖工作排進佇列'); add('api-w', 0.3, { kind: 'msg' }); apiBusy += 0.3
    add('s3-w', 2, { kind: 'data', mb: FILE, label: 'worker 讀原檔' })
    say('縮圖 worker 讀原檔、處理（示意 3 秒）'); add('w', 3, { kind: 'work' })
    add('w-s3', 0.3, { kind: 'data', mb: 0.2, label: '寫回縮圖' }); say('縮圖寫回物件儲存，uploads 標成 ready', 'ok')
  }
  if (mode === 'through-api') {
    say('POST /files：100 MB multipart 直接進 API，一個 worker 開始收')
    if (cut) {
      add('c-api', 7, { kind: 'data', mb: 70, label: '上傳中', mem: true, api: true }); apiBusy += 7
      say('網路中斷：API 丟掉緩衝的 70 MB，worker 白忙 7 秒', 'bad'); add('none', 1, { kind: 'gap' })
      say('客戶端從 0 重新上傳整個檔案')
    }
    add('c-api', 10, { kind: 'data', mb: 100, label: '上傳中', mem: true, api: true }); apiBusy += 10
    say('API 讀前 4 KB 驗 magic bytes，再把 100 MB 轉存到物件儲存（同一份資料再走一次網路）')
    add('api-s3', 2, { kind: 'data', mb: 100, label: 'API 轉存', mem: true, api: true }); apiBusy += 2
    worker()
  } else if (mode === 'presigned') {
    say('POST /uploads：API 檢查宣告的大小與類型、簽出 5 分鐘有效的 URL（0.3 秒）'); add('c-api', 0.3, { kind: 'msg', api: true }); apiBusy += 0.3
    if (cut) {
      add('c-s3', 7, { kind: 'data', mb: 70, label: 'PUT 直傳' })
      say('網路中斷：物件儲存丟掉未完成的物件；API 完全沒感覺', 'bad'); add('none', 1, { kind: 'gap' })
      say('同一個 presigned URL 還沒過期，客戶端重傳整個檔案')
    }
    add('c-s3', 10, { kind: 'data', mb: 100, label: 'PUT 直傳' })
    say('POST /uploads/{id}/complete：API 向物件儲存 HEAD 確認大小與類型'); add('c-api', 0.3, { kind: 'msg', api: true }); apiBusy += 0.3
    worker()
  } else {
    say('POST /uploads：API 起始 multipart upload，簽出 10 段的 URL'); add('c-api', 0.3, { kind: 'msg', api: true }); apiBusy += 0.3
    const part = (i, dur = 1, mb = 10) => add('c-s3', dur, { kind: 'data', mb, label: `第 ${i} / ${PARTS} 段` })
    for (let i = 1; i <= (cut ? 7 : PARTS); i++) part(i)
    if (cut) {
      part(8, 0.5, 5)
      say('網路中斷：第 1–7 段已各自確認（ETag），只有進行中的第 8 段作廢（5 MB）', 'bad'); add('none', 1, { kind: 'gap' })
      say('客戶端問 API 哪些段已完成，從第 8 段續傳')
      for (let i = 8; i <= PARTS; i++) part(i)
    }
    say('POST /uploads/{id}/complete：API 呼叫 CompleteMultipartUpload 合併 10 段'); add('c-api', 0.3, { kind: 'msg', api: true }); apiBusy += 0.3
    worker()
  }
  const sent = ph.filter((p) => p.edge.startsWith('c-') && p.kind === 'data').reduce((s, p) => s + p.mb, 0)
  return { ph, log, total: t, sent, apiBusy, memPeak: ph.some((p) => p.mem) ? FILE : 0.1 }
}

const MODES = [{ value: 'through-api', label: '經過 API' }, { value: 'presigned', label: 'Presigned URL 直傳' }, { value: 'chunked', label: '分段上傳 + 續傳' }]
const TEXT = {
  'through-api': ['每個位元組先進 API 再出去：API 的網路、記憶體、worker 時間都花兩倍。100 MB 在 worker 手上等 12 秒，同時 8 個人在傳就把 8 個 worker 全占住，第 9 個人開始排隊。', '好處是檔案落地前就在自己手上：magic bytes、大小、甚至解析內容都能同步做，不合格的檔案不會進物件儲存。幾 MB 以下的頭像、CSV 匯入，這是最好的做法。'],
  presigned: ['API 只出現兩次、各 0.3 秒：簽 URL 與收「完成」。100 MB 走的是客戶端到物件儲存的直線，API 的記憶體與 worker 幾乎沒感覺，人數多寡由物件儲存承擔。', '簽名把「多久內、多大、什麼類型、哪個 key」寫死，物件儲存代為執行。代價：magic bytes 與掃毒只能落地後由 worker 做；complete 回報不能信，API 要自己 HEAD 一次；斷線仍要整檔重傳。'],
  chunked: ['同一條直傳路線，但切成 10 段各自上傳、各自確認。斷線只作廢進行中的那一段，客戶端問 API「哪些段已完成」就能接著傳。分段還能平行傳，大檔更快。', '多出來的是狀態：API 要記每個上傳的段清單、合併、清理沒完成的（生命週期規則）。小檔案這樣做是多好幾次來回，不划算。'],
}
const CHECKS = [
  ['大小上限', 'API 讀 Content-Length 並在串流時計數，超過就中止；nginx 也設 client_max_body_size', '簽名條件 content-length-range，物件儲存拒收超過的', '每段大小與段數上限由 API 控制；complete 前檢查總大小'],
  ['MIME 與 magic bytes', '收到前 4 KB 就檢查，不合回 415，檔案不落地', '簽名鎖定 Content-Type；magic bytes 由 worker 落地後抓前 4 KB 檢查，不合就刪', '合併後由 worker 檢查，同 presigned'],
  ['隨機檔名', 'API 產 UUID 當物件名，原檔名只存 DB 欄位', 'API 在簽名時決定 key，客戶端無法選路徑', '同 presigned'],
  ['不放 web root', '直接寫進物件儲存，API 機器只有暫存', '從未經過 API 機器', '從未經過 API 機器'],
  ['掃毒', '同步掃會拖慢請求，通常仍交給 worker', 'worker 落地後掃，通過前不對外提供', '同 presigned'],
  ['URL 到期與權限', '一般 API 認證即可', 'URL 5 分鐘到期、只能寫指定 key；bucket 保持私有', '每段 URL 各自到期；未完成的上傳 7 天自動清除'],
  ['完成回報驗證', '不需要，物件是 API 自己寫的', 'API 收到 complete 要 HEAD 物件確認存在、大小、類型，才標 ready', 'complete 由 API 執行，合併時就驗證各段 ETag'],
]

export default function UploadScenarioLab() {
  const [mode, setMode] = useState('through-api')
  const [cut, setCut] = useState(false)
  const [conc, setConc] = useState(8)
  const reduced = useReducedMotion()
  const tl = useMemo(() => buildTimeline(mode, cut), [mode, cut])

  /* 播放頭：null = 顯示最終狀態 */
  const [playT, setPlayT] = useState(null)
  const timer = useRef(null)
  const stop = () => { if (timer.current) { cancelAnimationFrame(timer.current.raf); clearInterval(timer.current.iv) } timer.current = null; setPlayT(null) }
  useEffect(() => stop, [tl])
  const play = () => {
    if (timer.current) { stop(); return }
    const total = tl.total
    if (reduced) { let t = 0; const iv = setInterval(() => { t += total / 14; if (t >= total) { stop(); return } setPlayT(t) }, 380); timer.current = { iv } }
    else {
      const start = performance.now(), durMs = 6500
      const tick = (now) => { const t = ((now - start) / durMs) * total; if (t >= total) { stop(); return } setPlayT(t); timer.current = { raf: requestAnimationFrame(tick) } }
      timer.current = { raf: requestAnimationFrame(tick) }
    }
    setPlayT(0)
  }
  const playing = playT !== null
  const at = playing ? playT : tl.total
  const active = tl.ph.find((p) => p.a <= at && at < p.b) || null
  const sentNow = tl.ph.filter((p) => p.edge.startsWith('c-') && p.kind === 'data' && p.a < at).reduce((s, p) => s + p.mb * Math.min(1, (at - p.a) / (p.b - p.a)), 0)
  const apiNow = tl.ph.filter((p) => p.api && p.a < at).reduce((s, p) => s + Math.min(p.b, at) - p.a, 0)
  const mem = active?.mem ? Math.round(FILE * (active.edge === 'c-api' ? (at - active.a) / (active.b - active.a) : 1)) : 0

  /* 同時上傳人數：API 撐不撐得住（兩台機器、各 1024 MB、各 4 worker） */
  const perMachine = Math.ceil(conc / 2)
  const memUse = mode === 'through-api' ? perMachine * FILE : Math.round(conc * 0.05 * 10) / 10
  const busy = mode === 'through-api' ? Math.min(conc, 8) : Math.min(8, Math.ceil(conc * 0.6 / 12))
  const queued = mode === 'through-api' ? Math.max(0, conc - 8) : 0
  const oom = memUse > 1024
  const modeIdx = MODES.findIndex((m) => m.value === mode)
  const box = useRef(null)
  const narrow = useWidth(box, 700) < 520

  return (
    <Lab accent="aqua" kicker="SCENARIO LAB" title="100 MB 的檔案經過誰：三種上傳路線的資料流"
         blurb="按「上傳 100 MB」看位元組在四個節點間怎麼流、API 的記憶體與 worker 被占多久；開「網路中斷」看哪種做法能續傳；拉「同時上傳人數」看 API 什麼時候撐不住。">
      <LabControls>
        <Seg tinted label="做法" value={mode} onChange={setMode} options={MODES} />
        <Toggle label="網路在傳到約 70% 時中斷一次" checked={cut} onChange={setCut} />
        <button type="button" className="btn small" onClick={play}>{playing ? '■ 停止' : '▶ 上傳 100 MB'}</button>
      </LabControls>
      <LabGrid variant="wide">
        <div className="lab-stack" ref={box}>
          <LabStage label="資料流" caption="實線＝目前正在走的路；MB 數是示意。API 節點內的橫條是這個上傳占用的 API 記憶體。">
            <Flow tl={tl} at={at} active={active} mem={mem} narrow={narrow} />
          </LabStage>
          <Stats min={120}>
            <Stat label="t" value={`${at.toFixed(1)} s`} />
            <Stat label="客戶端送出" value={`${Math.round(sentNow)} MB`} note="檔案 100 MB" tone={sentNow > FILE + 1 ? 'bad' : ''} />
            <Stat label="API worker 占用" value={`${apiNow.toFixed(1)} s`} tone={apiNow > 5 ? 'bad' : 'ok'} />
            <Stat label="API 記憶體峰值" value={`${tl.memPeak} MB`} tone={tl.memPeak >= FILE ? 'bad' : 'ok'} />
            <Stat label="全部完成" value={`${tl.total.toFixed(1)} s`} />
          </Stats>
          <div className="up-conc">
            <Slider label="同時上傳人數" min={1} max={50} value={conc} onChange={setConc} format={(v) => `${v} 人`} />
            <div className="up-meters">
              <Meter label="每台 API 記憶體" value={memUse} max={1024} unit="MB" bad={oom} />
              <Meter label="API worker（共 8）" value={busy} max={8} unit="忙" bad={queued > 0} />
            </div>
            <p className="up-note">
              {mode === 'through-api'
                ? (oom ? <Status>每台 {memUse} MB：超過 1 GB，程序被 OOM 砍掉，所有進行中的上傳一起失敗</Status>
                  : queued > 0 ? <Status warn>8 個 worker 全被上傳占住，第 9 位起等前面的人傳完（示意 12 秒一輪）；其他 API 端點也在同一個隊伍</Status>
                  : <Status ok>{conc} 人 × 100 MB 還在兩台機器的容量內</Status>)
                : <Status ok>{conc} 人各占 API 0.6 秒、幾 KB 記憶體；100 MB 走物件儲存，人數上限不在 API</Status>}
            </p>
          </div>
        </div>
        <div className="lab-stack">
          <LabExplain title={MODES[modeIdx].label}>{TEXT[mode].map((p, i) => <p key={i}>{p}</p>)}</LabExplain>
          <Callout title="什麼時候會真的踩到">
            檔案超過幾 MB、或同時上傳的人超過 API worker 數的時候。症狀不是上傳變慢，而是<b>整個 API 變慢</b>：worker 都在等使用者的網路吐位元組，health check 跟著超時。行動網路上 100 MB 傳到一半斷線是常態，不是例外。
          </Callout>
        </div>
      </LabGrid>
      <div className="up-two">
        <div>
          <h5 className="up-h">事件記錄（t ≤ {at.toFixed(1)} s）</h5>
          <ol className="up-log">
            {tl.log.filter((e) => e.t <= at + 1e-6).map((e, i) => <li key={i} className={e.tone || ''}><span className="t">{e.t.toFixed(1)}s</span><span>{e.text}</span></li>)}
            {at <= 0 && <li className="muted">按「上傳 100 MB」開始</li>}
          </ol>
        </div>
        <div>
          <h5 className="up-h">安全檢查清單 · {MODES[modeIdx].label}</h5>
          <div className="dtable-wrap">
            <table className="dtable up-checks">
              <thead><tr><th>檢查</th><th>這個做法在哪裡做</th></tr></thead>
              <tbody>{CHECKS.map((c) => <tr key={c[0]}><td>{c[0]}</td><td>{c[1 + modeIdx]}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </div>
      <style>{`
        .up-svg { width: 100%; max-width: 720px; margin: 0 auto; }
        .up-svg .node { fill: var(--surface-1); stroke: var(--hairline); stroke-width: 1.5; }
        .up-svg .node.on { stroke: var(--lab-accent); stroke-width: 2.5; }
        .up-svg .node.hot { stroke: var(--c-orange); stroke-width: 2.5; }
        .up-svg .nlabel { font-family: var(--sans); font-size: 12px; font-weight: 700; fill: var(--ink-1); }
        .up-svg .nsub { font-family: var(--mono); font-size: 9.5px; fill: var(--ink-3); }
        .up-svg .edge { stroke: var(--hairline); stroke-width: 1.5; fill: none; stroke-dasharray: 3 4; }
        .up-svg .edge.on { stroke: var(--lab-accent); stroke-width: 2.5; stroke-dasharray: none; }
        .up-svg .edge.done { stroke: var(--ink-3); stroke-dasharray: none; opacity: 0.5; }
        .up-svg .pkt { fill: var(--lab-accent); }
        .up-svg .pkt.msg { fill: var(--c-orange); }
        .up-svg .elabel { font-family: var(--mono); font-size: 10px; fill: var(--ink-1); font-weight: 700; }
        .up-svg .memtrack { fill: var(--surface-2); stroke: var(--hairline); }
        .up-svg .memfill { fill: var(--c-orange); }
        .up-svg .cut { fill: var(--critical); font-family: var(--sans); font-size: 11px; font-weight: 700; }
        .up-svg .cutx { stroke: var(--critical); stroke-width: 2.5; }
        .up-svg .gear { fill: none; stroke: var(--c-violet); stroke-width: 3; stroke-dasharray: 4 3; }
        .up-svg.narrow { max-width: 420px; }
        .up-svg.narrow .nlabel { font-size: 14px; } .up-svg.narrow .nsub { font-size: 11.5px; } .up-svg.narrow .elabel { font-size: 12.5px; } .up-svg.narrow .cut { font-size: 12.5px; }
        .up-conc { border-top: 1px solid var(--hairline); padding-top: 12px; display: grid; gap: 10px; }
        .up-meters { display: grid; gap: 8px; }
        .up-meter { display: grid; grid-template-columns: 130px 1fr 92px; gap: 10px; align-items: center; font-size: 0.78rem; color: var(--ink-2); }
        .up-meter .track { height: 12px; background: var(--surface-2); border: 1px solid var(--hairline); border-radius: 3px; overflow: hidden; }
        .up-meter .fill { height: 100%; background: var(--c-aqua); transition: width 0.25s ease; }
        .up-meter.bad .fill { background: var(--critical); }
        .up-meter .n { font-family: var(--mono); text-align: right; color: var(--ink-1); font-variant-numeric: tabular-nums; }
        @media (max-width: 520px) { .up-meter { grid-template-columns: 1fr; gap: 3px; } .up-meter .n { text-align: left; } }
        .up-note { font-size: 0.8rem; }
        .up-note .status { white-space: normal; text-align: left; line-height: 1.4; }
        .up-two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 18px; }
        @media (max-width: 760px) { .up-two { grid-template-columns: 1fr; } }
        .up-h { font-family: var(--sans); font-size: 0.76rem; letter-spacing: 0.06em; color: var(--ink-2); margin-bottom: 8px; }
        .up-log { list-style: none; display: grid; gap: 4px; font-size: 0.8rem; color: var(--ink-2); }
        .up-log li { display: grid; grid-template-columns: 44px 1fr; gap: 8px; padding: 4px 8px; border-left: 2px solid var(--hairline); line-height: 1.5; }
        .up-log li.bad { border-left-color: var(--critical); color: var(--ink-1); }
        .up-log li.ok { border-left-color: var(--good); }
        .up-log li.muted { color: var(--ink-3); border-left-color: transparent; }
        .up-log .t { font-family: var(--mono); color: var(--ink-3); font-variant-numeric: tabular-nums; }
        .up-checks td { white-space: normal; line-height: 1.5; font-family: var(--sans); font-size: 0.8rem; }
        .up-checks td:first-child { font-weight: 600; white-space: nowrap; }
      `}</style>
    </Lab>
  )
}

function Meter({ label, value, max, unit, bad }) {
  return (
    <div className={`up-meter${bad ? ' bad' : ''}`}>
      <span>{label}</span>
      <div className="track"><div className="fill" style={{ width: `${Math.min(100, (value / max) * 100)}%` }} /></div>
      <span className="n">{value} / {max} {unit}</span>
    </div>
  )
}

/* 節點圖：目前階段的邊亮起、封包沿邊移動；API 節點內畫記憶體條；中斷時在邊上畫 ✕ */
function Flow({ tl, at, active, mem, narrow }) {
  const P = narrow ? Object.fromEntries(Object.entries(NODES).map(([id, n]) => [id, { ...n, ...NODES_NARROW[id] }])) : NODES
  const pt = (id) => P[id]
  const endpoints = (edge) => { const [a, b] = EDGES[edge]; return [pt(a), pt(b)] }
  const doneEdges = new Set(tl.ph.filter((p) => p.b <= at && EDGES[p.edge]).map((p) => p.edge))
  const prog = active ? (at - active.a) / (active.b - active.a) : 0
  const gapPrev = active?.kind === 'gap' ? tl.ph[tl.ph.indexOf(active) - 1] : null
  const onNodes = new Set(active && EDGES[active.edge] ? EDGES[active.edge] : active?.edge === 'w' ? ['w'] : [])
  const lerp = (p, q, f) => ({ x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f })
  return (
    <svg className={`up-svg${narrow ? ' narrow' : ''}`} viewBox={narrow ? '0 0 340 350' : '0 0 640 262'} role="img" aria-label="客戶端、API、物件儲存、縮圖 worker 四個節點與目前的資料流">
      {Object.keys(EDGES).filter((e) => e !== 'w-s3').map((e) => { const [p, q] = endpoints(e); return <line key={e} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className={`edge${active?.edge === e || (active?.edge === 'w-s3' && e === 's3-w') ? ' on' : doneEdges.has(e) || doneEdges.has('w-s3') && e === 's3-w' ? ' done' : ''}`} />
      })}
      {active && EDGES[active.edge] && (() => {
        const [p, q] = endpoints(active.edge), mid = lerp(p, q, 0.5)
        const n = active.kind === 'data' ? 5 : 1
        return (
          <g>
            {Array.from({ length: n }, (_, i) => { const f = ((prog * 1.4 + i / n) % 1); const c = lerp(p, q, 0.12 + f * 0.76); return <circle key={i} cx={c.x} cy={c.y} r={active.kind === 'data' ? 4.5 : 4} className={`pkt ${active.kind}`} /> })}
            {narrow && active.kind === 'data'
              ? <text x={mid.x} y={mid.y - 22} textAnchor="middle" className="elabel"><tspan x={mid.x}>{active.label}</tspan><tspan x={mid.x} dy="14">{Math.round(active.mb * prog)} / {active.mb} MB</tspan></text>
              : <text x={mid.x} y={mid.y - 12} textAnchor="middle" className="elabel">{active.kind === 'data' ? `${active.label} ${Math.round(active.mb * prog)} / ${active.mb} MB` : '請求'}</text>}
          </g>
        )
      })()}
      {gapPrev && EDGES[gapPrev.edge] && (() => {
        const [p, q] = endpoints(gapPrev.edge), c = lerp(p, q, 0.7), mx = (p.x + q.x) / 2
        return <g><line x1={c.x - 7} y1={c.y - 7} x2={c.x + 7} y2={c.y + 7} className="cutx" /><line x1={c.x + 7} y1={c.y - 7} x2={c.x - 7} y2={c.y + 7} className="cutx" />
          {narrow
            ? <text x={mx} y={c.y + 22} textAnchor="middle" className="cut"><tspan x={mx}>網路中斷，</tspan><tspan x={mx} dy="14">重新連線…</tspan></text>
            : <text x={c.x} y={c.y - 14} textAnchor="middle" className="cut">網路中斷，重新連線…</text>}</g>
      })()}
      {Object.entries(P).map(([id, n]) => (
        <g key={id}>
          <rect x={n.x - 52} y={n.y - 22} width="104" height="44" rx="4" className={`node${id === 'api' && mem > 0 ? ' hot' : onNodes.has(id) ? ' on' : ''}`} />
          <text x={n.x} y={id === 'api' ? n.y - 4 : n.y + 1} textAnchor="middle" className="nlabel">{n.label}</text>
          {id === 'api' && <g><rect x={n.x - 44} y={n.y + 6} width="88" height="8" rx="2" className="memtrack" /><rect x={n.x - 44} y={n.y + 6} width={88 * Math.min(1, mem / FILE)} height="8" rx="2" className="memfill" /><text x={n.x + 48} y={n.y + 13} className="nsub">{mem} MB</text></g>}
          {id !== 'api' && <text x={n.x} y={n.y + 14} textAnchor="middle" className="nsub">{id === 'client' ? '行動網路' : id === 's3' ? 'S3 相容' : active?.edge === 'w' ? '處理中…' : '背景'}</text>}
          {id === 'w' && active?.edge === 'w' && <circle cx={n.x + 40} cy={n.y - 10} r="6" className="gear svg-pulse" />}
        </g>
      ))}
      <text x={narrow ? 170 : 320} y={narrow ? 336 : 254} textAnchor="middle" className="nsub">{at >= tl.total ? `完成 · 客戶端共送出 ${tl.sent} MB · API worker 忙 ${tl.apiBusy.toFixed(1)} s` : active?.kind === 'gap' ? '客戶端重新連線中' : active ? `${active.kind === 'work' ? '縮圖 worker 處理中' : active.edge === 'c-api' ? '客戶端 → API' : active.edge === 'api-s3' ? 'API → 物件儲存' : active.edge === 'c-s3' ? '客戶端 → 物件儲存（不經 API）' : active.edge === 'api-w' ? 'API → 佇列 → worker' : 'worker ↔ 物件儲存'}` : '按「上傳 100 MB」'}</text>
    </svg>
  )
}

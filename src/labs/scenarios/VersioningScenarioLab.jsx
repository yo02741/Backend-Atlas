import React, { useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabExplain, Seg, Toggle, Slider, Stepper, usePlayer, Code, Callout, Status, Stats, Stat } from '../ui.jsx'

/* API 改版模擬器：
   左：GET /orders/42 的回應與四個變更開關（加欄位 / 拆欄位 / 改型別 / 刪欄位）
   右：四種客戶端各自收到什麼、哪個欄位讀不到
   Seg 切做法看哪些變更在該做法下不會壞；expand–contract 用 Stepper 走四階段，Slider 調月數 */

const APPROACHES = [
  { value: 'none', label: '直接改（對照組）' },
  { value: 'additive', label: '只加不改' },
  { value: 'path', label: '/v2 路徑' },
  { value: 'header', label: '標頭選版' },
  { value: 'expand', label: 'Expand–contract' },
]
const STAGES = ['① 加新欄（expand）', '② 雙寫 + 回填', '③ 客戶端切換', '④ 刪舊欄（contract）']
const CLIENTS = [
  { id: 'web', name: 'Web', sub: '最新版，與後端同天上線', reads: ['status', 'customer'] },
  { id: 'ios', name: 'iOS 舊版', sub: '無法強制更新，還會活 6 個月', reads: ['status', 'customer'] },
  { id: 'android', name: 'Android', sub: '上個月的版本；可強制更新、兩週覆蓋', reads: ['status', 'note'] },
  { id: 'partner', name: '合作夥伴', sub: '對帳系統，SLA 要 90 天通知', reads: ['status', 'customer'] },
]

/* 回應的形狀：mode = old（v1 原樣）| new（全部改完）| both（新舊並存）| both-empty（新欄剛加、還是 null） */
function shapeOf(changes, mode) {
  const s = { status: 'string', customer: 'name', note: true, eta: false, filled: true }
  if (mode === 'old') return s
  if (changes.add) s.eta = true
  if (mode === 'new') {
    if (changes.retype) s.status = 'object'
    if (changes.rename) s.customer = 'split'
    if (changes.remove) s.note = false
  } else {
    if (changes.retype) s.status = 'both'
    if (changes.rename) s.customer = 'both'
    if (mode === 'both-empty') s.filled = false
  }
  return s
}

const STATUS_OBJ = (key) => [`"${key}": {`, '  "code": "shipped", "label": "已出貨",', '  "updated_at": "2026-09-25T08:12:00Z"', '}']
function jsonOf(shape, changes, markDeprecated) {
  const E = []
  const nul = !shape.filled
  E.push({ lines: ['"id": 42'] })
  if (shape.status !== 'object') E.push({ lines: ['"status": "shipped"'], kind: shape.status === 'both' && markDeprecated ? 'dep' : '' })
  if (shape.status === 'object') E.push({ lines: STATUS_OBJ('status'), kind: 'new' })
  if (shape.status === 'both') E.push({ lines: nul ? ['"status_detail": null'] : STATUS_OBJ('status_detail'), kind: 'new' })
  if (shape.customer !== 'split') E.push({ lines: ['"customer_name": "王小明"'], kind: shape.customer === 'both' && markDeprecated ? 'dep' : '' })
  if (shape.customer !== 'name') E.push({ lines: [nul ? '"customer": null' : '"customer": { "first_name": "小明", "last_name": "王" }'], kind: 'new' })
  if (shape.note) E.push({ lines: ['"internal_note": "VIP，出貨前先電話確認"'], kind: changes.remove && markDeprecated ? 'dep' : '' })
  if (shape.eta) E.push({ lines: ['"estimated_delivery": "2026-09-28"'], kind: 'new' })
  E.push({ lines: ['"total": 1280'] })
  const lines = ['{']; const hl = []; const marks = []
  E.forEach((e, i) => e.lines.forEach((l, j) => {
    const last = j === e.lines.length - 1
    lines.push('  ' + l + (last && i < E.length - 1 ? ',' : ''))
    if (e.kind === 'new') hl.push(lines.length)
    if (e.kind === 'dep' && j === 0) marks.push({ line: lines.length, text: l.split(':')[0] })
  }))
  lines.push('}')
  return { src: lines.join('\n'), hl, marks }
}

function httpOf(approach, v, deps) {
  const req = approach === 'path' ? `GET /${v}/orders/42 HTTP/1.1` : 'GET /orders/42 HTTP/1.1'
  const accept = approach === 'header' && v === 'v2' ? 'Accept: application/vnd.shop.v2+json' : 'Accept: application/json'
  const res = ['HTTP/1.1 200 OK', approach === 'header' && v === 'v2' ? 'Content-Type: application/vnd.shop.v2+json' : 'Content-Type: application/json']
  if (approach === 'header') res.push('Vary: Accept')
  if (deps > 0 || (approach === 'path' && v === 'v1')) res.push('Deprecation: @1767225600', 'Sunset: Sat, 27 Mar 2027 00:00:00 GMT')
  return [req, accept, '', ...res].join('\n')
}

/* 客戶端讀它需要的欄位：回傳 { bad: [], warn: [] } */
function evalClient(shape, switched, changes, reads) {
  const bad = []; const warn = []
  if (changes.retype && reads.includes('status')) {
    if (!switched && shape.status === 'object') bad.push('status 不是字串')
    if (switched && !shape.filled) warn.push('status_detail 還是 null，等 ② 回填')
  }
  if (changes.rename && reads.includes('customer')) {
    if (!switched && shape.customer === 'split') bad.push('customer_name 不存在')
    if (switched && !shape.filled && !warn.length) warn.push('customer 還是 null，等 ② 回填')
  }
  if (changes.remove && reads.includes('note') && !switched && !shape.note) bad.push('internal_note 不存在')
  return { bad, warn }
}

function readsLabel(reads, switched, changes) {
  return reads.map((f) => {
    if (f === 'status') return changes.retype ? (switched ? 'status_detail{}' : 'status:"…"') : 'status'
    if (f === 'customer') return changes.rename && switched ? 'customer.first_name' : 'customer_name'
    return 'internal_note'
  }).join(' · ')
}

export default function VersioningScenarioLab() {
  const [approach, setApproach] = useState('none')
  const [changes, setChanges] = useState({ add: true, rename: true, retype: true, remove: true })
  const [viewV, setViewV] = useState('v2')
  const [months, setMonths] = useState(1)
  const { step, setStep, playing, toggle } = usePlayer(4, 1600)
  const set = (k) => (v) => setChanges((c) => ({ ...c, [k]: v }))
  const versioned = approach === 'path' || approach === 'header'

  // 每個客戶端拿到什麼、有沒有切到新欄位
  const rows = useMemo(() => CLIENTS.map((c) => {
    let mode; let switched = c.id === 'web'; let retired = false
    if (approach === 'none') mode = 'new'
    else if (approach === 'additive') mode = 'both'
    else if (versioned) mode = c.id === 'web' ? 'new' : 'old'
    else {
      mode = step === 0 ? 'both-empty' : step === 3 ? 'new' : 'both'
      if (c.id === 'android') switched = step >= 2
      if (c.id === 'partner') switched = step >= 2 && months >= 3
      retired = c.id === 'ios' && months >= 6
    }
    const shape = shapeOf(changes, mode)
    const res = retired ? { bad: [], warn: [] } : evalClient(shape, switched, changes, c.reads)
    return { client: c, shape, switched, retired, v: mode === 'old' ? 'v1' : 'v2', ...res }
  }), [approach, changes, step, months, versioned])

  // 左邊顯示的那一份回應
  const shown = useMemo(() => {
    const markDep = approach === 'additive' || (approach === 'expand' && step < 3)
    const mode = approach === 'none' ? 'new' : approach === 'additive' ? 'both' : versioned ? (viewV === 'v1' ? 'old' : 'new') : step === 0 ? 'both-empty' : step === 3 ? 'new' : 'both'
    const j = jsonOf(shapeOf(changes, mode), changes, markDep)
    return { ...j, http: httpOf(approach, versioned ? viewV : 'v2', j.marks.length) }
  }, [approach, changes, viewV, step, versioned])

  const broken = rows.filter((r) => r.bad.length).length
  const versions = versioned ? 2 : 1
  const stuck = approach === 'additive' && changes.remove      // 只加不改：刪不掉的欄位
  const explain = EXPLAIN[approach === 'expand' ? `expand${step}` : approach]

  return (
    <Lab accent="aqua" kicker="SCENARIO LAB" title="同一份回應改四個地方，四種客戶端誰會壞"
         blurb="開關四個變更、切換做法，右邊的客戶端卡片立刻告訴你誰讀不到什麼欄位。所有數字為示意。">
      <LabControls>
        <Seg tinted label="做法" value={approach} onChange={setApproach} options={APPROACHES} />
      </LabControls>
      {approach === 'expand' && (
        <LabControls>
          <Stepper step={step} total={4} onStep={setStep} playing={playing} onPlay={toggle} labels={STAGES} />
          <span className="spacer" />
          <Slider label="距離開始改版" min={0} max={9} value={months} onChange={setMonths} format={(v) => `${v} 個月`} />
        </LabControls>
      )}
      {approach === 'expand' && <Timeline months={months} step={step} />}
      <LabGrid variant="wide">
        <div className="lab-stack">
          <div className="vs-toggles">
            <Toggle label="加欄位：estimated_delivery" checked={changes.add} onChange={set('add')} />
            <Toggle label="拆欄位：customer_name → customer.first_name / last_name" checked={changes.rename} onChange={set('rename')} />
            <Toggle label="改型別：status 字串 → 物件" checked={changes.retype} onChange={set('retype')} />
            <Toggle label="刪欄位：internal_note" checked={changes.remove} onChange={set('remove')} />
          </div>
          {versioned && <Seg mono label="看哪個版本的回應" value={viewV} onChange={setViewV} options={[{ value: 'v1', label: 'v1（舊客戶端）' }, { value: 'v2', label: 'v2（Web）' }]} />}
          <Code lang="http" title="請求與回應標頭">{shown.http}</Code>
          <Code lang="json" title="回應 body（藍底＝新欄位，紅標＝deprecated）" highlight={shown.hl} marks={shown.marks}>{shown.src}</Code>
        </div>
        <div className="lab-stack">
          <div className="vs-cards">
            {rows.map((r) => (
              <div key={r.client.id} className={`vs-card ${r.retired ? 'retired' : r.bad.length ? 'bad' : r.warn.length ? 'warn' : 'ok'}`}>
                <div className="vs-card-h"><b>{r.client.name}</b>{versioned && <span className="tag">{r.v}</span>}</div>
                <p className="sub">{r.client.sub}</p>
                <p className="reads">讀：{readsLabel(r.client.reads, r.switched, changes)}</p>
                {r.retired ? <Status ok>已退場，不用管</Status>
                  : r.bad.length ? <Status>壞掉：{r.bad.join('、')}</Status>
                  : r.warn.length ? <Status warn>{r.warn[0]}</Status>
                  : <Status ok>正常</Status>}
              </div>
            ))}
          </div>
          <Stats min={120}>
            <Stat label="壞掉的客戶端" value={`${broken} / 4`} />
            <Stat label="並存的版本" value={versions} />
            <Stat label="deprecated 欄位" value={shown.marks.length} tone={stuck ? 'warn' : ''} note={stuck ? 'internal_note 刪不掉' : ''} />
          </Stats>
          <LabExplain title={explain.title}>{explain.body.map((p, i) => <p key={i}>{p}</p>)}</LabExplain>
          <Callout title="什麼時候會真的踩到">改型別（字串 → 物件、數字 → 字串）與改名最常見，通常發生在「當初設計太簡單」的欄位上。刪欄位看起來無害，但沒寫在文件的欄位照樣有人在用；刪之前先用日誌或 gateway 統計誰還在讀。</Callout>
        </div>
      </LabGrid>
      <style>{`
        .vs-toggles { display: grid; gap: 6px; }
        .vs-toggles .toggle { font-size: 0.82rem; }
        .vs-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        @media (max-width: 640px) { .vs-cards { grid-template-columns: 1fr; } }
        .vs-card { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 10px 12px; display: grid; gap: 4px; align-content: start; transition: border-color 0.25s ease, background 0.25s ease; }
        .vs-card.bad { border-color: var(--critical); background: color-mix(in srgb, var(--critical) 8%, var(--surface-1)); }
        .vs-card.warn { border-color: var(--serious); }
        .vs-card.ok { border-color: color-mix(in srgb, var(--good) 45%, var(--hairline)); }
        .vs-card.retired { opacity: 0.55; }
        .vs-card-h { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: 0.88rem; }
        .vs-card .sub { font-size: 0.72rem; color: var(--ink-3); line-height: 1.4; }
        .vs-card .reads { font-family: var(--mono); font-size: 0.7rem; color: var(--ink-2); word-break: break-all; }
        .vs-card .status { justify-self: start; font-size: 0.72rem; padding: 2px 8px; }
      `}</style>
    </Lab>
  )
}

/* 月數軸：誰在第幾個月切到新欄位、誰何時退場；紅色區＝現在就刪舊欄會壞的範圍 */
function Timeline({ months, step }) {
  const W = 640; const x = (m) => 40 + (m / 9) * (W - 80)
  const marks = [
    { m: 0, label: 'Web 切換', c: 'var(--c-blue)' },
    { m: 0.5, label: 'Android 覆蓋完', c: 'var(--c-blue)' },
    { m: 3, label: '夥伴 90 天通知期滿', c: 'var(--c-orange)' },
    { m: 6, label: 'iOS 舊版退場', c: 'var(--c-red)' },
  ]
  const safe = months >= 6
  return (
    <div className="lab-stage plain" style={{ marginBottom: 12 }}>
      <svg viewBox={`0 0 ${W} 86`} width="100%" aria-label="改版時間軸">
        <rect x={x(0)} y={30} width={x(6) - x(0)} height={10} rx={2} fill="color-mix(in srgb, var(--critical) 22%, transparent)" />
        <rect x={x(6)} y={30} width={x(9) - x(6)} height={10} rx={2} fill="color-mix(in srgb, var(--good) 22%, transparent)" />
        <line x1={x(0)} y1={35} x2={x(9)} y2={35} className="svg-edge" />
        {[0, 3, 6, 9].map((m) => <text key={m} x={x(m)} y={58} textAnchor="middle" className="svg-text small">{m} 個月</text>)}
        {marks.map((k) => (
          <g key={k.label}>
            <circle cx={x(k.m)} cy={35} r={4.5} fill={k.c} className={months >= k.m ? '' : 'svg-pulse'} opacity={months >= k.m ? 1 : 0.45} />
            <text x={x(k.m)} y={k.m === 0.5 ? 82 : 18} textAnchor={k.m === 0 ? 'start' : k.m === 9 ? 'end' : 'middle'} className="svg-text small">{k.label}</text>
          </g>
        ))}
        <g className="svg-pop" key={months}>
          <line x1={x(months)} y1={22} x2={x(months)} y2={48} stroke="var(--lab-accent)" strokeWidth={2.5} />
          <text x={x(months)} y={72} textAnchor="middle" className="svg-mono" fill="var(--lab-accent)">現在：{months} 個月{step === 3 ? (safe ? '，可以刪' : '，還不能刪') : ''}</text>
        </g>
      </svg>
    </div>
  )
}

const EXPLAIN = {
  none: { title: '四個變更一次上線：只有跟後端一起部署的 Web 沒事', body: [
    'iOS 舊版與夥伴把 status 當字串、讀 customer_name；Android 拿 internal_note 顯示備註——沒人「該」用的欄位還是有人用，這就是刪欄位危險的原因。',
    '把右邊三個開關關掉、只留「加欄位」：沒有人壞。加欄位本來就不是破壞性變更，正確寫的客戶端會忽略不認識的欄位。',
  ] },
  additive: { title: '舊欄位一個都不拿掉，新欄位用新名字加進來', body: [
    'status 保留、旁邊多一個 status_detail；customer_name 保留、多一個 customer。所有客戶端都正常，因為它們讀的欄位都還在。',
    '代價：「刪欄位」做不到，internal_note 只能標 deprecated 繼續回。回應裡紅標的欄位會越積越多，而且 status 這個好名字永遠被舊型別佔著。',
  ] },
  path: { title: '/v1 原封不動，/v2 回新格式，客戶端自己選', body: [
    '沒有人壞：舊客戶端根本沒碰 /v2。切上面的 v1 / v2 看兩份回應——它們是兩支 handler、兩組測試、兩份 CDN 快取。',
    'v1 要維護到 iOS 舊版退場（至少 6 個月）；Sunset 標頭先把日期講出去。版本是整個 API 一起跳，之後每個小改都要想「這算不算 v3」。',
  ] },
  header: { title: 'URL 不變，用 Accept 選版本', body: [
    '結果和 /v2 一樣，差在兩件事。第一，CDN 必須 Vary: Accept，否則 iOS 舊版可能拿到 Web 剛塞進快取的 v2 回應。',
    '第二，沒帶版本標頭的請求（iOS 舊版、夥伴都不會帶）一定要落到 v1。預設設成「最新」，切換的那一刻所有舊客戶端同時壞。',
  ] },
  expand0: { title: '① 加新欄位，值先是 null', body: [
    '資料庫加欄、API 開始回 status_detail 與 customer，但舊資料還沒回填，所以是 null。舊欄位不動，舊客戶端無感。',
    'Web 如果這一步就切去讀新欄位，會拿到 null——右邊的黃燈。expand 的第一步只是「準備好容器」。',
  ] },
  expand1: { title: '② 雙寫 + 回填：新舊兩組欄位都有值', body: [
    '應用程式寫入時同時填新舊欄，舊資料分批回填。從這一刻起，任何客戶端讀哪一組都對，這就是相容窗口。',
    '窗口要開多久由最慢的客戶端決定；期間每個寫入都要維持兩份一致。',
  ] },
  expand2: { title: '③ 通知客戶端改讀新欄位，統計誰還在讀舊的', body: [
    'Web 直接上、Android 強制更新兩週覆蓋、夥伴收到 90 天通知。拉「距離開始改版」的月數：不到 3 個月夥伴還沒切；到 6 個月 iOS 舊版才退場。',
    '同時在日誌用 User-Agent / API key 統計舊欄位的讀取量。沒有這個數字，你不知道 ④ 什麼時候能做。',
  ] },
  expand3: { title: '④ 刪舊欄位：只能在舊欄位用量歸零之後', body: [
    '月數不到 6，iOS 舊版當場壞；不到 3，夥伴的對帳也壞。把月數拉到 6 以上，四張卡才全綠。',
    'expand–contract 的成本就是等，換來的是沒有版本號、沒有永久的 deprecated 欄位。',
  ] },
}

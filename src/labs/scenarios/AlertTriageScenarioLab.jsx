import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Callout, Status,
  useTicker, useWidth, Stats, Stat, Flow, LineChart, Caption,
} from '../ui.jsx'

/* 讓 agent 調查告警：00:00–06:00 的一組固定告警（8 則誤報、3 則真問題）逐分鐘播放。
   切做法（人工全看 / agent 唯讀調查 / agent 自動執行低風險動作）看確認時間、誤報過濾、叫醒次數、錯誤動作；
   「agent 判斷」切到出錯的變化，看各做法的後果。agent 的能力與所有分鐘數都是示意，不代表任何產品的準確率 */

const MODES = [
  { value: 'manual', label: '人工全部看' },
  { value: 'readonly', label: 'agent 唯讀調查' },
  { value: 'auto', label: 'agent 低風險自動' },
]
const ERRS = [
  { value: 'none', label: '判斷正常' },
  { value: 'cause', label: '根因判斷錯', title: '02:40 那則：agent 說是 pod 連線洩漏，其實是傍晚上線的新查詢' },
  { value: 'noise', label: '把真問題當誤報', title: '04:10 那則：agent 以為是已知的暫時性錯誤' },
]
const T_END = 360, PER_TICK = 3
/* real：真問題；fix：restart / scale（低風險）或 rollback（變更類，要人）；known：agent 認得的誤報模式 */
const ALERTS = [
  { t: 20, name: '磁碟 82%', why: '夜間備份寫暫存', real: false, known: true },
  { t: 22, name: 'DB 主機 CPU 90%', why: '同一個備份', real: false, known: true },
  { t: 50, name: '健康檢查失敗 1 次', why: '單次抖動，下一次就恢復', real: false, known: true },
  { t: 75, name: '連線數 85%', why: 'worker pod 連線洩漏', real: true, fix: 'restart' },
  { t: 76, name: '錯誤率 2%', why: '同一事件的重複告警', real: false, known: true },
  { t: 120, name: 'API CPU 85%', why: '報表排程', real: false, known: true },
  { t: 160, name: '連線數 95%', why: '傍晚上線版本的新查詢不釋放連線', real: true, fix: 'rollback' },
  { t: 210, name: '磁碟 88%', why: '日誌輪替前的高點', real: false, known: true },
  { t: 250, name: '錯誤率 5%', why: '一個節點被回收，副本不足', real: true, fix: 'scale' },
  { t: 280, name: '健康檢查連續失敗', why: '外部探測點自己的網路問題（新模式）', real: false, known: false },
  { t: 330, name: 'API CPU 88%', why: '清晨批次', real: false, known: true },
]
const FIX = { restart: '重啟該 pod', scale: '副本 +1', rollback: '回滾傍晚的版本' }

/* 每則告警在某個做法下的結果：page 叫人、ack 確認分鐘數（真問題才算）、steps 給 Flow 用 */
function triage(a, mode, err) {
  const wrongCause = err === 'cause' && a.t === 160
  const missed = err === 'noise' && a.t === 250
  const H = (label, value) => ({ label, value, hot: true, who: '人' })
  const A = (label, value) => ({ label, value, who: 'agent' })
  if (mode === 'manual') {
    if (!a.real) return { page: true, filtered: false, wrong: 0, auto: 0, steps: [
      { label: '告警', value: a.name },
      H('調查', '人照 runbook 查 12 分'),
      H('決定', '判定誤報'),
      { label: '動作', value: '無' },
    ] }
    return { page: true, ack: 24, wrong: 0, auto: 0, steps: [
      { label: '告警', value: a.name },
      H('調查', '人從零查起 20 分'),
      H('決定', `找到原因：${a.why}`),
      H('動作', `人執行：${FIX[a.fix]}`),
    ] }
  }
  if (!a.real) {
    if (a.known) return { page: false, filtered: true, wrong: 0, auto: 0, steps: [
      { label: '告警', value: a.name },
      A('調查', '唯讀查指標與變更 3 分'),
      A('決定', `像已知模式：${a.why}`),
      { label: '動作', value: '降級成工單，不叫人' },
    ] }
    return { page: true, filtered: false, wrong: 0, auto: 0, steps: [
      { label: '告警', value: a.name },
      A('調查', '唯讀查 3 分，對不上已知模式'),
      H('決定', '人看摘要判定誤報'),
      { label: '動作', value: '無' },
    ] }
  }
  if (missed) return { page: true, ack: 3 + 20 + 9, wrong: 0, auto: 0, late: true, steps: [
    { label: '告警', value: a.name },
    A('調查', '唯讀查 3 分，誤判為暫時性錯誤'),
    { label: '決定', value: '降級成工單', bad: true },
    H('動作', '20 分後再響才叫人，人看摘要處理'),
  ] }
  const lowRisk = a.fix !== 'rollback'
  if (wrongCause && mode === 'auto') return { page: true, ack: 3 + 2 + 10 + 9, wrong: 1, auto: 1, steps: [
    { label: '告警', value: a.name },
    A('調查', '根因判斷錯：pod 連線洩漏'),
    { label: '決定', value: 'agent 自行重啟 pod', bad: true },
    H('動作', '10 分後仍未恢復 → 升級叫人，人改為核准回滾'),
  ] }
  if (wrongCause) return { page: true, ack: 3 + 4 + 18, wrong: 0, auto: 0, steps: [
    { label: '告警', value: a.name },
    A('調查', '摘要寫錯根因：pod 連線洩漏'),
    H('決定', '人對照證據發現不符，自己再查'),
    H('動作', `人執行：${FIX[a.fix]}`),
  ] }
  if (mode === 'auto' && lowRisk) return { page: false, ack: 3 + 2, wrong: 0, auto: 1, steps: [
    { label: '告警', value: a.name },
    A('調查', '唯讀查 3 分，對上 runbook'),
    A('決定', `清單內動作：${FIX[a.fix]}`),
    A('動作', '自動執行（次數上限 1），通知不叫醒'),
  ] }
  return { page: true, ack: 3 + 4 + 6, wrong: 0, auto: 0, steps: [
    { label: '告警', value: a.name },
    A('調查', '唯讀查 3 分，摘要附證據'),
    H('決定', mode === 'auto' ? `人核准提案：${FIX[a.fix]}` : `人看摘要：${FIX[a.fix]}`),
    H('動作', mode === 'auto' ? '核准後 agent 執行並記錄' : '人執行'),
  ] }
}

/* 叫醒次數：上一次被叫起來 10 分鐘內再被叫，算同一次醒著 */
function summarize(mode, err, upto) {
  const rows = ALERTS.map((a) => ({ a, r: triage(a, mode, err) }))
  const shown = rows.filter((x) => x.a.t <= upto)
  let wakes = 0, last = -99
  const wakeAt = new Array(T_END + 1).fill(0)
  for (const x of rows) {
    if (x.r.page) { if (x.a.t - last > 10) wakes++; last = x.a.t + (x.r.ack || 12) }
    wakeAt[x.a.t] = wakes
  }
  for (let i = 1; i <= T_END; i++) wakeAt[i] = Math.max(wakeAt[i], wakeAt[i - 1])
  const real = shown.filter((x) => x.a.real)
  const fp = shown.filter((x) => !x.a.real)
  return {
    rows, shown, wakeAt,
    wakes: wakeAt[Math.min(upto, T_END)],
    ack: real.length ? real.reduce((s, x) => s + x.r.ack, 0) / real.length : 0,
    filtered: fp.filter((x) => x.r.filtered).length, fpTotal: fp.length,
    wrong: shown.reduce((s, x) => s + x.r.wrong, 0),
    auto: shown.reduce((s, x) => s + x.r.auto, 0),
    late: shown.some((x) => x.r.late),
  }
}

const hhmm = (m) => `0${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`

const EXPLAIN = {
  manual: { title: '人工全部看：每則都叫醒人，每次從零查起', body: ['11 則告警都呼叫 on-call。8 則誤報裡，備份、報表、重複告警佔大多數，但人得一則一則照 runbook 查完才知道是誤報。', '真問題的確認時間包含「醒來、登入、找儀表板、查最近變更」，示意約 24 分鐘，已經超過 15 分鐘的要求。一晚被叫好幾次之後，最後那則的判斷品質很難保證。'] },
  readonly: { title: 'agent 唯讀調查：先篩、先查，動作仍由人做', body: ['agent 用唯讀憑證查指標、日誌、最近部署與 runbook，認得出的誤報降級成工單；對不上已知模式的（04:40 那則）仍然叫人。', '真問題叫醒人時摘要與證據已經在那裡，確認時間示意縮到十幾分鐘。agent 判斷錯時最壞是摘要寫錯：系統不會被動到，但人要對照證據，不能照單全收。'] },
  auto: { title: 'agent 低風險自動：清單內的動作自己做，變更要核准', body: ['01:15 的連線洩漏與 04:10 的副本不足都在低風險清單裡（重啟一個 pod、副本 +1），agent 自己做完、通知但不叫醒；02:40 要回滾版本，是變更類，只能提案、由人核准。', '切到「根因判斷錯」：agent 會真的重啟一個不相干的 pod——這就是錯誤動作。擋住損害的是次數上限與升級規則：同一告警做過一次就不再自動動作，10 分鐘沒恢復就叫人。'] },
}
const ERR_NOTE = {
  none: '',
  cause: '02:40 那則：agent 把「新查詢不釋放連線」判斷成「pod 連線洩漏」。',
  noise: '04:10 那則：agent 把副本不足判斷成暫時性錯誤，降級成工單；靠「同一告警再響就叫人」的規則才被接住。',
}

export default function AlertTriageScenarioLab() {
  const [mode, setMode] = useState('readonly')
  const [err, setErr] = useState('none')
  const [running, setRunning] = useState(false)
  const [started, setStarted] = useState(false)
  const [pick, setPick] = useState(null)
  const [tick, resetTick] = useTicker(running, 50)
  const chartRef = useRef(null)
  const chartW = useWidth(chartRef, 640)
  const t = started ? Math.min(T_END, tick * PER_TICK) : T_END
  useEffect(() => { if (tick * PER_TICK >= T_END) setRunning(false) }, [tick])

  const sim = useMemo(() => summarize(mode, err, t), [mode, err, t])
  const all = useMemo(() => Object.fromEntries(MODES.map((m) => [m.value, summarize(m.value, err, T_END)])), [err])
  const ex = EXPLAIN[mode]
  const latest = sim.shown[sim.shown.length - 1]
  const focus = (pick !== null && sim.rows.find((x) => x.a.t === pick && x.a.t <= t)) || latest
  const play = () => { setStarted(true); setPick(null); resetTick(); setRunning(true) }
  const humanSteps = focus ? focus.r.steps.filter((s) => s.who === '人').map((s) => s.label) : []

  return (
    <Lab accent="violet" kicker="SCENARIO LAB" title="一個人 on-call 的夜晚：11 則告警，三種讓 agent 介入的方式"
         blurb="按「夜間開始」逐分鐘播放 00:00–06:00 的告警（8 則誤報、3 則真問題）。切換做法看誰被叫醒、多久確認原因；再讓 agent 判斷出錯，看各做法的後果（全部示意）。">
      <LabControls>
        <Seg label="做法" tinted value={mode} onChange={setMode} options={MODES} />
        <Seg label="agent 判斷" value={err} onChange={setErr} options={ERRS} />
      </LabControls>
      <LabGrid variant="wide">
        <div className="lab-stack at-col">
          <LabControls>
            <button type="button" className="btn small" onClick={play}>{started ? '再跑一次夜間' : '夜間開始'}</button>
            <span className="at-clock">{hhmm(t)}</span>
            <span className="spacer" />
            {sim.wrong > 0 ? <Status>錯誤動作 {sim.wrong} 次</Status> : <Status ok>沒有錯誤動作</Status>}
            {sim.late && <Status warn>真問題延遲處理</Status>}
          </LabControls>
          <LabStage plain label="告警時間線與處理路徑">
            <div className="dtable-wrap">
              <table className="dtable at-table">
                <caption>告警與處理結果（點一列看路徑）</caption>
                <thead><tr><th>時間</th><th>告警</th><th>實際</th><th>這個做法</th></tr></thead>
                <tbody>
                  {sim.rows.map(({ a, r }) => {
                    const on = a.t <= t
                    return (
                      <tr key={a.t} className={`clickable${on ? ' row-in' : ' dim'}${focus && focus.a.t === a.t ? ' hit' : ''}`} onClick={() => on && setPick(a.t)}>
                        <td className="at-mono">{hhmm(a.t)}</td>
                        <td>{a.name}</td>
                        <td>{a.real ? <span className="at-real">真問題</span> : <span className="muted">誤報</span>}</td>
                        <td>{!on ? <span className="muted">—</span>
                          : r.wrong ? <Status>動錯</Status>
                          : r.late ? <Status warn>延遲叫人</Status>
                          : r.page ? <Status warn>叫醒人{a.real ? ` · ${r.ack} 分` : ''}</Status>
                          : <Status ok>{a.real ? `自動處理 · ${r.ack} 分` : '已過濾'}</Status>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {focus && (
              <Flow title={`${hhmm(focus.a.t)} ${focus.a.name}：告警 → 調查 → 決定 → 動作（框起來的是人）`} ariaLabel="這則告警的處理路徑"
                    steps={focus.r.steps}
                    notes={[`實際原因：${focus.a.why}`, humanSteps.length ? `人參與的步驟：${humanSteps.join('、')}` : '這則從頭到尾沒有叫醒人']} />
            )}
            <div ref={chartRef}>
              <LineChart title="人被叫醒（累計次數）" xMax={T_END} yMax={10} upto={t}
                         xTicks={[0, 60, 120, 180, 240, 300]} fmtX={hhmm} fmtY={(v) => String(v)}
                         width={chartW < 560 ? 320 : 640} height={chartW < 560 ? 128 : 150}
                         series={MODES.map((m, i) => ({
                           key: m.value,
                           label: m.label,
                           color: ['var(--c-red)', 'var(--c-blue)', 'var(--c-green)'][i],
                           values: all[m.value].wakeAt,
                         }))} />
            </div>
            <Caption>確認時間＝告警到「原因確認並開始處置」的分鐘數；叫醒後 10 分鐘內再被叫算同一次。全部是示意推算，不代表任何 agent 產品的準確率。</Caption>
          </LabStage>
          <Stats min={130}>
            <Stat label="真問題平均確認時間" value={sim.ack ? sim.ack.toFixed(0) : '—'} unit="分" tone={sim.ack > 15 ? 'bad' : sim.ack ? 'ok' : ''} note="要求 ≤ 15 分（示意）" />
            <Stat label="誤報被過濾" value={sim.fpTotal ? `${Math.round((sim.filtered / sim.fpTotal) * 100)}%` : '—'} note={`${sim.filtered} / ${sim.fpTotal} 則`} tone={sim.fpTotal && !sim.filtered ? 'warn' : ''} />
            <Stat label="人被叫醒" value={sim.wakes} unit="次" tone={sim.wakes > 4 ? 'bad' : sim.wakes > 2 ? 'warn' : 'ok'} />
            <Stat label="錯誤動作" value={sim.wrong} unit="次" tone={sim.wrong ? 'bad' : 'ok'} note="示意" />
            <Stat label="agent 自動動作" value={sim.auto} unit="次" note={mode === 'auto' ? '低風險清單內' : '此做法不允許'} />
          </Stats>
        </div>
        <div className="lab-stack at-col">
          <LabExplain title={ex.title}>{ex.body.map((p, i) => <p key={i}>{p}</p>)}{err !== 'none' && <p><b>這次的變化：</b>{ERR_NOTE[err]}{mode === 'manual' ? '人工全看不經過 agent，不受影響。' : ''}</p>}</LabExplain>
          <div className="dtable-wrap">
            <table className="dtable at-compare">
              <caption>同一個夜晚、同一個「agent 判斷」條件下（示意，點一列切換）</caption>
              <thead><tr><th>做法</th><th>確認</th><th>叫醒</th><th>動錯</th></tr></thead>
              <tbody>
                {MODES.map((m) => {
                  const s = all[m.value]
                  return (
                    <tr key={m.value} className={`clickable${m.value === mode ? ' hit' : ''}`} onClick={() => setMode(m.value)}>
                      <td>{m.label}</td><td>{s.ack.toFixed(0)} 分</td><td>{s.wakes} 次</td>
                      <td className={s.wrong ? 'at-bad' : ''}>{s.wrong}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <LabExplain title="怎麼讀">
            <p>Flow 裡框起來的步驟是人做的。三種做法差在「調查」與「動作」由誰做：人工全看四步幾乎都是人；唯讀調查把調查交給 agent，決定與動作留給人；低風險自動連動作都交出去，只有變更類動作回到人。</p>
            <p>agent 判斷出錯時，唯讀調查的代價是時間，低風險自動的代價是一次真的錯誤動作。差別由權限決定，不是由 agent 準不準決定。</p>
          </LabExplain>
          <Callout title="什麼時候會真的踩到">夜間告警多到 on-call 開始不看、同一份 runbook 每晚照查一次、或是有人提議「讓 AI 直接處理告警」的時候。先給唯讀權限、累積一段時間它判斷對不對的紀錄，再一個一個把可逆、有上限的動作加進清單；回滾、改設定、改資料庫永遠留給人核准。</Callout>
        </div>
      </LabGrid>
      <style>{`
        .at-col { min-width: 0; grid-template-columns: minmax(0, 1fr); }
        .at-col > * { min-width: 0; }
        .at-clock { font-family: var(--mono, ui-monospace, monospace); font-weight: 700; color: var(--lab-accent); font-variant-numeric: tabular-nums; }
        .at-table td { white-space: normal; vertical-align: top; }
        .at-table td:first-child, .at-table td:last-child { white-space: nowrap; }
        .at-table td.at-mono { white-space: nowrap !important; overflow-wrap: normal; }
        .at-mono { font-family: var(--mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; }
        .at-real { color: var(--critical); font-weight: 700; }
        .at-bad { color: var(--critical); font-weight: 700; }
        .at-compare td, .at-compare th { white-space: nowrap; }
        .at-col .lab-chart { margin-top: 12px; }
        @media (max-width: 560px) { .at-table th:nth-child(3), .at-table td:nth-child(3) { display: none; } }
      `}</style>
    </Lab>
  )
}

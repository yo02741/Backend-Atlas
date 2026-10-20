import React, { useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Slider, Stepper, usePlayer, Callout, Status, Stats, Stat, Flow, LineChart, Caption, fmtN } from '../ui.jsx'

/* 數據中台之前：直接建 / 先全面治理 / 一個使用案例切片。
   三個來源系統（HIS、檢驗、排班），三種品質問題（重複病人、代碼對不到、缺值）。
   每按一次「跑一輪報表」前進一個月，看資料怎麼流、報表錯幾筆、重工幾次、第一個可用成果在第幾個月、治理覆蓋率多少。
   全部是示意推算：每月 2 萬筆門診掛號，錯誤筆數 = 筆數 × 各問題比例 × 尚未處理的比例。 */

const MODES = [
  { value: 'direct', label: '直接建中台' },
  { value: 'govern', label: '先全面治理' },
  { value: 'slice', label: '使用案例切片' },
]
const N = 20000, MONTHS = 12, TRUST = 0.01
const SOURCES = ['HIS 掛號', 'HIS 住院', '檢驗系統', '排班系統']
const SLICES = [   // 切片：哪個月交付、這一刀接了哪個來源、做哪張報表
  { done: 2, src: 0, report: '各科門診人次月報' },
  { done: 5, src: 1, report: '平均住院天數' },
  { done: 8, src: 2, report: '檢驗報告完成時間' },
  { done: 11, src: 3, report: '排班與門診量對照' },
]

function simulate(mode, q) {
  const rows = []
  let rework = 0, patched = 0, atSource = 0, first = null
  for (let m = 0; m <= MONTHS; m++) {
    let h = 0, reports = 0, coverage = 0, sources = 0, phase = '', reworkNow = 0
    if (mode === 'direct') {
      sources = m >= 1 ? 4 : 0
      reports = m >= 3 ? Math.min(5, 1 + Math.floor((m - 3) / 2)) : 0
      const reload = m >= 6 && m % 3 === 0           // 每季全量重抽：中台裡的就地修補被覆蓋
      if (m > 3) { patched = reload ? patched * 0.3 : Math.min(0.6, patched + 0.12); atSource = Math.min(0.3, atSource + 0.03) }
      h = Math.min(0.9, patched + atSource)
      coverage = Math.min(22, 5 + m * 1.5)
      phase = m === 0 ? '起點' : m < 3 ? '三套系統原樣抽進 raw' : reload ? '全量重抽，修補被覆蓋' : '報表被質疑，在中台裡修補'
      if (reports) reworkNow = reload ? 3 : 0
    } else if (mode === 'govern') {
      coverage = m <= 6 ? m * 14 : 90
      sources = m >= 7 ? 4 : 0
      reports = m >= 7 ? Math.min(5, 1 + (m - 7)) : 0
      h = m >= 7 ? 0.98 : 0
      phase = m === 0 ? '起點' : m <= 2 ? '盤點所有系統、建資料目錄' : m <= 4 ? '指定 owner / steward、寫品質規則' : m <= 6 ? '病人與科別主資料對應' : '中台上線'
      reworkNow = m === 8 ? 2 : 0                     // 實際需求的欄位有一部分沒在盤點優先序裡
    } else {
      const doneSlices = SLICES.filter((s) => m >= s.done).length
      const next = SLICES[doneSlices]
      sources = Math.min(4, doneSlices + (next && m > (SLICES[doneSlices - 1]?.done ?? 0) ? 1 : 0))
      reports = doneSlices
      coverage = doneSlices * 17 + (next && m > 0 ? 6 : 0)
      h = doneSlices ? 0.97 : 0
      phase = m === 0 ? '起點' : next ? `第 ${doneSlices + 1} 刀：${next.report}` : '四刀完成，補全院目錄與分級'
      reworkNow = m === 5 || m === 11 ? 1 : 0         // 擴大時回頭修訂病人比對規則、科別對應表
    }
    if (mode === 'direct' && reports && h < 0.85) reworkNow += 2
    rework += reworkNow
    const err = reports ? Math.round(N * (q.dup * (1 - h) + q.code * (1 - h) + q.miss * (1 - h * 0.9))) : null
    const trusted = reports && err / N < TRUST ? reports : 0
    if (first === null && trusted) first = m
    rows.push({ m, h, err, reports, trusted, coverage: Math.round(coverage), sources, phase, rework, reworkNow })
  }
  return { rows, first }
}

const EXPLAIN = {
  direct: { title: '直接建中台：資料都在一起了，數字還對不起來', body: ['三套系統原樣抽進 raw 層（ELT），第 3 個月就有報表。但病歷號沒正規化、代碼沒對應、缺值沒規則，三種問題一起進報表；沒有書面定義，會議上只能爭論誰的數字對。', '修補多半直接改在中台：每季全量重抽時被覆蓋，錯誤又回來，重工跟著累積。含個資的原始資料也全部進了中台，權限要另外補。'] },
  govern: { title: '先全面治理：上線就可信，但要等半年以上', body: ['前 6 個月在盤點、目錄、負責人、品質規則與主資料，治理覆蓋率一路往上，報表欄是空的。第 7 個月中台上線，錯誤筆數最低。', '代價是時間與優先序：盤點以「全部」為準，第 8 個月才發現報表要用的幾個欄位不在第一批，回頭補。期間需求改變或支持度下降，是這個做法最常見的風險。'] },
  slice: { title: '使用案例切片：從一張報表反推要治理的資料', body: ['第一刀只接 HIS 掛號、病人主檔與科別代碼表，把這一段的定義、owner、品質規則與 raw → staging → mart 做完，第 2 個月交出可信的門診人次月報。', '之後每一刀多接一個來源、多一張報表，治理覆蓋率跟著真實需求長。擴大時要回頭修訂主資料（第 5、11 個月），全院層級的目錄與分級要有人盯著補齊。'] },
}

export default function DataPlatformScenarioLab() {
  const [mode, setMode] = useState('slice')
  const [dup, setDup] = useState(3)
  const [code, setCode] = useState(6)
  const [miss, setMiss] = useState(4)
  const { step, setStep, playing, toggle } = usePlayer(MONTHS + 1, 1100)
  const [scrub, setScrub] = useState(null)
  const q = { dup: dup / 100, code: code / 100, miss: miss / 100 }
  const sim = useMemo(() => simulate(mode, q), [mode, dup, code, miss])
  const all = useMemo(() => MODES.map((o) => ({ ...o, s: simulate(o.value, q) })), [dup, code, miss])
  const shown = scrub ?? step
  const r = sim.rows[shown]
  const ex = EXPLAIN[mode]
  const reached = sim.first !== null && sim.first <= shown
  const errMax = niceMax(Math.max(200, ...all.flatMap((o) => o.s.rows.map((x) => x.err || 0))))
  const CH = { xMax: MONTHS, xTicks: [0, 3, 6, 9, 12], fmtX: (v) => `${v}月`, upto: step, mark: scrub, onScrub: setScrub }

  return (
    <Lab accent="violet" kicker="SCENARIO LAB" title="數據中台的前 12 個月：同一批髒資料，三種起手式"
         blurb="調三種品質問題的比例，切換做法，按「跑一輪報表」一個月一個月往前，看資料怎麼流、報表錯幾筆、重工幾次、第一個可用成果在哪個月、治理覆蓋率多少。">
      <LabControls>
        <Seg label="做法" tinted value={mode} onChange={setMode} options={MODES} />
        <Slider label="重複病人" min={0} max={8} value={dup} onChange={setDup} format={(v) => `${v}%`} />
        <Slider label="代碼對不到" min={0} max={15} value={code} onChange={setCode} format={(v) => `${v}%`} />
        <Slider label="必填缺值" min={0} max={10} value={miss} onChange={setMiss} format={(v) => `${v}%`} />
      </LabControls>
      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabControls>
            <button type="button" className="btn small" onClick={() => setStep(Math.min(MONTHS, step + 1))} disabled={step >= MONTHS}>跑一輪報表（下個月）</button>
            <Stepper step={step} total={MONTHS + 1} onStep={setStep} playing={playing} onPlay={toggle} />
            <span className="spacer" />
            {r.err === null ? <Status warn>第 {shown} 月：還沒有報表</Status>
              : r.trusted ? <Status ok>報表可信（錯誤 &lt; 1%）</Status> : <Status>錯誤 {fmtN(r.err)} 筆</Status>}
          </LabControls>
          <LabStage plain label="資料流與月度指標">
            <PlatformFlow mode={mode} r={r} />
            <div className="dp-charts">
              <ErrBars rows={sim.rows} upto={step} cur={shown} max={errMax} />
              <LineChart {...CH} title="治理覆蓋率（%）／累計重工（次）" yMax={100} fmtY={(v) => String(v)}
                         series={[{ key: 'cov', label: '覆蓋率', color: 'var(--lab-accent)', values: sim.rows.map((x) => x.coverage) }, { key: 'rw', label: '重工', color: 'var(--c-orange)', values: sim.rows.map((x) => x.rework) }]} />
            </div>
            <Caption>第 {shown} 月 · {r.phase}：每月 {fmtN(N)} 筆門診掛號，錯誤筆數以「門診人次」報表計（示意；游標移到右圖可看任一月）。</Caption>
          </LabStage>
          <Stats min={140}>
            <Stat label="本月報表錯誤筆數" value={r.err === null ? '—' : fmtN(r.err)} note={r.err === null ? '尚無報表' : `${((r.err / N) * 100).toFixed(1)}%`} tone={r.err === null ? '' : r.trusted ? 'ok' : 'bad'} />
            <Stat label="累計重工" value={r.rework} unit="次" note={r.reworkNow ? `本月 +${r.reworkNow}` : ''} tone={r.rework >= 8 ? 'bad' : r.rework >= 3 ? 'warn' : ''} />
            <Stat label="第一個可用成果" value={reached ? `第 ${sim.first} 月` : shown === MONTHS ? '12 月內沒有' : '尚未出現'} note="錯誤 < 1% 的報表" tone={reached ? (sim.first <= 3 ? 'ok' : 'warn') : shown === MONTHS ? 'bad' : ''} />
            <Stat label="治理覆蓋率（示意）" value={`${r.coverage}%`} note="有定義、owner、規則的資料集" />
            <Stat label="可信 / 上線報表" value={`${r.trusted} / ${r.reports}`} />
          </Stats>
          <Compare all={all} mode={mode} onPick={setMode} />
        </div>
        <div className="lab-stack">
          <LabExplain title={ex.title}>{ex.body.map((s, i) => <p key={i}>{s}</p>)}</LabExplain>
          <LabExplain title={`第 ${shown} 月：${r.phase}`}><p>{monthNote(mode, r, sim.first)}</p></LabExplain>
          <LabExplain title="三種問題各自怎麼修">
            <p>重複病人：先正規化病歷號（去空白、轉大寫）再比對，合併回到 HIS 由病歷管理單位確認。代碼對不到：大小寫在 staging 正規化；缺項要 steward 決定補對應表還是改來源。缺值：只能回到來源補登，所以處理比例最低。</p>
            <p>拉高任一個比例，三種做法的差距一起放大；全部拉到 0 時，「直接建中台」也能交出可信報表——那正是治理已經到位的情況。</p>
          </LabExplain>
          <Callout title="什麼時候會真的踩到">中台上線第一週，儀表板的病人數比掛號系統多幾個百分點；某一科的門診量是 0；平均住院天數出現負數。這些問題在來源系統裡早就存在，中台只是第一次把它們放在一起。</Callout>
        </div>
      </LabGrid>
      <style>{`
        .dp-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
        @media (max-width: 560px) { .dp-charts { grid-template-columns: 1fr; } }
        .dp-bars .bar { fill: var(--c-blue); opacity: 0.55; transition: height 0.3s, y 0.3s; }
        .dp-bars .bar.ok { fill: var(--good); }
        .dp-bars .bar.cur { opacity: 1; }
        .dp-bars .axis { stroke: var(--hairline); }
        .dp-table td, .dp-table th { white-space: nowrap; }
        @media (prefers-reduced-motion: reduce) { .dp-bars .bar { transition: none; } }
      `}</style>
    </Lab>
  )
}

/* 跟著月份變的一句說明：這個月做了什麼、指標為什麼這樣動 */
function monthNote(mode, r, first) {
  if (r.m === 0) return '還沒開始。按「跑一輪報表」或播放，一個月一個月往前看。'
  if (mode === 'direct') {
    if (!r.reports) return '三套系統的資料表原樣抽進 raw 層，病歷號、科別代碼、缺值都沒處理；這兩個月看起來進度最快。'
    if (r.reworkNow >= 3) return '每季一次全量重抽，上一季在 mart 裡就地修的資料被覆蓋，錯誤筆數跳回去，重工一次加三。修正沒回到來源系統，就會一直重複。'
    return r.trusted ? '品質問題比例低，報表已經可信——治理的前提本來就存在時，直接建也行得通。' : '報表上線但數字被質疑：同一個病人算成兩個、某科門診量是 0。資料組回頭在中台裡補規則，每個月都在追同樣的問題。'
  }
  if (mode === 'govern') {
    if (r.m <= 6) return `治理覆蓋率 ${r.coverage}%，但還沒有任何報表。四個來源一起盤點，每個業務單位都要撥人開會確認欄位定義與負責人。`
    if (r.reworkNow) return '中台上線後第一個月，發現報表要用的幾個欄位不在第一批盤點範圍，回頭補定義與品質規則。'
    return `中台上線，錯誤筆數最低${first !== null ? `，第 ${first} 月交出第一張可信報表` : ''}；之後每張新報表都能直接用已治理的主資料。`
  }
  if (r.reworkNow) return '這一刀接進新的來源，病人比對規則與科別對應表要擴充，前面已交付的報表跟著回歸測試一次。'
  if (!r.reports) return '只接 HIS 掛號、病人主檔與科別代碼表：先寫「門診人次」的定義、指定 owner，再寫這一段的品質規則。'
  return `已交付 ${r.reports} 張報表，治理覆蓋率 ${r.coverage}%。下一刀只處理新報表需要的資料，範圍小、問題早暴露。`
}

function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const k = v / p
  return (k <= 1 ? 1 : k <= 2 ? 2 : k <= 5 ? 5 : 10) * p
}

/* 每月報表錯誤筆數：沒有報表的月份畫一條短橫線；錯誤 < 1% 用 good 色 */
function ErrBars({ rows, upto, cur, max }) {
  const W = 320, H = 128, L = 38, R = 8, T = 10, B = 18
  const bw = (W - L - R) / rows.length
  const y = (v) => T + (1 - Math.min(v, max) / max) * (H - T - B)
  return (
    <div className="lab-chart">
      <div className="lab-chart-head"><span>報表錯誤筆數（每月）</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="每月報表錯誤筆數長條圖" className="dp-bars">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} className="axis" />
            <text x={L - 4} y={y(max * f) + 3.5} textAnchor="end" className="svg-text small">{max * f >= 1000 ? `${(max * f) / 1000}k` : max * f}</text>
          </g>
        ))}
        {rows.slice(0, upto + 1).map((x, i) => {
          const cx = L + i * bw + bw / 2
          if (x.err === null) return <line key={i} x1={cx - bw * 0.3} x2={cx + bw * 0.3} y1={H - B - 1} y2={H - B - 1} className="axis" />
          return <rect key={i} x={cx - bw * 0.35} width={bw * 0.7} y={y(x.err)} height={Math.max(1, H - B - y(x.err))} rx="1.5"
                       className={`bar${x.trusted ? ' ok' : ''}${i === cur ? ' cur' : ''}`} />
        })}
        {[0, 3, 6, 9, 12].map((m) => <text key={m} x={L + m * bw + bw / 2} y={H - 4} textAnchor="middle" className="svg-text small">{m}月</text>)}
      </svg>
    </div>
  )
}

/* 這個月的資料流：來源 → raw → staging → mart → 報表；隨做法與月份變 */
function PlatformFlow({ mode, r }) {
  const err = r.err === null ? '尚無' : `${r.reports} 張 · 錯 ${fmtN(r.err)} 筆`
  let steps, back = '', notes = []
  if (mode === 'govern' && r.m <= 6) {
    steps = [
      { label: '盤點', value: r.m >= 1 ? '4 個來源 · 欄位定義' : '未開始', hot: r.m >= 1 && r.m <= 2 },
      { label: '資料目錄 + owner', value: r.m >= 3 ? '已指定' : '待辦', hot: r.m >= 3 && r.m <= 4 },
      { label: '品質規則 + 主資料', value: r.m >= 5 ? '病人、科別對應中' : '待辦', hot: r.m >= 5 },
      { label: '中台', value: '尚未建置', bad: r.m > 0 },
    ]
    notes = [r.m >= 4 && '業務單位開始問：「什麼時候看得到報表？」']
  } else if (mode === 'direct') {
    steps = [
      { label: r.sources ? '4 個來源全量' : '來源', value: r.sources ? 'HIS、檢驗、排班' : '未接入' },
      { label: 'raw（含個資）', value: r.sources ? '原樣載入' : '—', hot: r.sources > 0 },
      { label: 'mart', value: r.reports ? '就地修補' : '建置中', bad: r.reports > 0 && !r.trusted },
      { label: '報表', value: err, bad: r.reports > 0 && !r.trusted },
    ]
    if (r.reports) back = r.reworkNow >= 3 ? '全量重抽覆蓋了上一季的修補，同樣的錯又回來' : '報表被質疑 → 回頭在中台裡修'
    notes = ['沒有 staging：病歷號正規化、代碼對應、去重都沒有固定的位置']
  } else {
    const src = mode === 'govern' ? '4 個來源' : SOURCES.slice(0, Math.max(1, r.sources)).join('、')
    steps = [
      { label: mode === 'govern' ? '來源（已盤點）' : '已接入', value: r.sources ? src : '選定第一張報表' },
      { label: 'raw', value: '權限最嚴' },
      { label: 'staging', value: '正規化 · 對應 · 去重', hot: true },
      { label: 'mart', value: '不含可識別欄位' },
      { label: '報表', value: err, bad: r.reports > 0 && !r.trusted },
    ]
    if (r.reports) back = '對不到代碼、重複病歷號進隔離表，steward 回來源系統修'
    notes = [mode === 'slice' && r.sources < 4 && `尚未接入：${SOURCES.slice(Math.max(1, r.sources)).join('、')}`, r.reworkNow > 0 && '擴大範圍：回頭修訂主資料比對規則與代碼對應表']
  }
  return <Flow title={`第 ${r.m} 月的資料流（示意）`} steps={steps} back={back} notes={notes} />
}

/* 12 個月後三種做法並排 */
function Compare({ all, mode, onPick }) {
  return (
    <div className="dtable-wrap">
      <table className="dtable dp-table">
        <caption>同一批資料，12 個月後三種做法並排（示意；點一列切換做法）</caption>
        <thead><tr><th>做法</th><th>第一個可用成果</th><th>第 12 月錯誤</th><th>累計重工</th><th>覆蓋率</th></tr></thead>
        <tbody>
          {all.map((o) => {
            const end = o.s.rows[MONTHS]
            return (
              <tr key={o.value} className={`clickable${o.value === mode ? ' hit' : ''}`} onClick={() => onPick(o.value)}>
                <td>{o.label}</td>
                <td>{o.s.first === null ? '沒有' : `第 ${o.s.first} 月`}</td>
                <td>{end.err === null ? '—' : fmtN(end.err)}</td>
                <td>{end.rework} 次</td>
                <td>{end.coverage}%</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

import React, { useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Code, Callout, Status, Stats, Stat, LineChart, Caption } from './ui.jsx'

/* ============================================================
   Harness Engineering：同一個 prompt 跑 N 次，結果為什麼不一樣
   - 假模型：8 題「自然語言 → 結構化欄位」，每題一個基礎通過率
   - 溫度越高每次抽樣越不穩；harness 策略決定「怎麼用模型的輸出」
   - 失敗分兩種：schema 層看得出的（缺欄位、JSON 壞掉）與「看起來對其實錯」的
   所有數字皆為示意，不代表任何真實模型
   ============================================================ */

const CASES = [
  { text: '下週三下午三點陳醫師的診', fields: 'date · time · doctor', p0: 0.96 },
  { text: '幫我掛明天早上的皮膚科', fields: 'date · period · dept', p0: 0.92 },
  { text: '林小姐 0912 的那筆改到 11/20', fields: 'name · phone · date', p0: 0.86 },
  { text: '取消禮拜五那個，改下禮拜', fields: 'action · date（相對日期）', p0: 0.74 },
  { text: '王醫師有空的最早時段', fields: 'doctor · earliest', p0: 0.68 },
  { text: '兩個小孩都要打流感疫苗', fields: 'patients[2] · service', p0: 0.58 },
  { text: '上次那個醫生，時間一樣', fields: 'doctor（指涉上文）', p0: 0.46 },
  { text: '月底前隨便哪天都可以', fields: 'date_range · flexible', p0: 0.38 },
]
const STRATS = {
  first: { label: '直接用第一次', short: '第一次就用' },
  vote: { label: '多數決（3 票）', short: '多數決' },
  retry: { label: '失敗重試 ≤ 3 次', short: '重試' },
  checker: { label: '檢查器攔不合格', short: '檢查器' },
}
const COLORS = { first: 'var(--c-slate)', vote: 'var(--c-blue)', retry: 'var(--c-orange)', checker: 'var(--c-green)' }
const DETECTABLE = 0.6   // 失敗裡有多少比例在 schema 層就看得出（缺欄位、JSON 壞掉）
const CATCH_SILENT = 0.75 // 檢查器對「看起來對其實錯」的輸出能攔下多少
const FIXED_SEED = 20251106
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/* 小型可重現亂數（mulberry32） */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
/* 溫度 0：好題幾乎一定過、難題幾乎一定不過（接近決定性）；溫度 1：整體往下掉、每題都變成機率問題 */
const passProb = (p0, T) => clamp(p0 + (p0 - 0.5) * (1 - T) * 0.6 - 0.25 * T, 0.02, 0.99)

function sampleOnce(rand, p) {
  const ok = rand() < p
  return { ok, detectable: !ok && rand() < DETECTABLE }
}
/* 一次「任務」：依策略呼叫模型一到數次，回傳最終結果與呼叫次數。ok=正確、bad=錯誤放行、blocked=被檢查器攔下 */
function trial(rand, p, strategy) {
  if (strategy === 'vote') {
    let oks = 0
    for (let i = 0; i < 3; i++) if (sampleOnce(rand, p).ok) oks++
    return { r: oks >= 2 ? 'ok' : 'bad', calls: 3 }
  }
  if (strategy === 'retry') {
    for (let i = 1; i <= 3; i++) {
      const s = sampleOnce(rand, p)
      if (s.ok) return { r: 'ok', calls: i }
      if (!s.detectable || i === 3) return { r: 'bad', calls: i }   // 看不出來的錯不會觸發重試
    }
  }
  const s = sampleOnce(rand, p)
  if (s.ok) return { r: 'ok', calls: 1 }
  if (strategy === 'checker') return { r: s.detectable || rand() < CATCH_SILENT ? 'blocked' : 'bad', calls: 1 }
  return { r: 'bad', calls: 1 }
}

/* 期望值（不抽樣）：畫曲線與對照表用，避免亂數讓曲線互相交錯 */
function expected(p, strategy) {
  const q = (1 - p) * DETECTABLE                       // 失敗且看得出來 → 會重試
  if (strategy === 'vote') return { ok: p ** 3 + 3 * p * p * (1 - p), blocked: 0, calls: 3 }
  if (strategy === 'retry') return { ok: p * (1 + q + q * q), blocked: 0, calls: 1 + q + q * q }
  if (strategy === 'checker') { const blocked = (1 - p) * (DETECTABLE + (1 - DETECTABLE) * CATCH_SILENT); return { ok: p, blocked, calls: 1 } }
  return { ok: p, blocked: 0, calls: 1 }
}
function expectedAll(T, strategy) {
  const r = CASES.map((c) => expected(passProb(c.p0, T), strategy))
  const avg = (k) => r.reduce((a, x) => a + x[k], 0) / r.length
  const ok = avg('ok'), blocked = avg('blocked')
  return { ok, blocked, bad: 1 - ok - blocked, calls: avg('calls') }
}

const PY = `def run(case, strategy):
    if strategy == "vote":
        outs = [call_model(case) for _ in range(3)]
        return majority(outs)                 # 成本固定 ×3
    for attempt in range(3 if strategy == "retry" else 1):
        out = call_model(case)
        if not schema_ok(out):                # 缺欄位、JSON 壞掉
            continue                          # 看得出來才會重試
        if strategy == "checker" and not business_ok(out):
            return BLOCKED                    # 交給人，不往下走
        return out                            # 「看起來對」的錯也會走到這
    return out`
const HL = { first: [5, 6, 11], vote: [2, 3, 4], retry: [5, 7, 8], checker: [9, 10] }

function simulate(T, n, strategy, seed) {
  const rand = rng(seed)
  let oks = 0, bads = 0, blocked = 0, calls = 0, unstable = 0
  const rows = CASES.map((c) => {
    const p = passProb(c.p0, T)
    const cells = Array.from({ length: n }, () => { const t = trial(rand, p, strategy); calls += t.calls; return t.r })
    const k = cells.filter((r) => r === 'ok').length
    oks += k; bads += cells.filter((r) => r === 'bad').length; blocked += cells.filter((r) => r === 'blocked').length
    const flaky = k > 0 && k < n
    if (flaky) unstable++
    return { ...c, p, cells, k, flaky }
  })
  const total = CASES.length * n
  return { rows, passRate: oks / total, badRate: bads / total, blocked, unstable, avgCalls: calls / total }
}

export default function HarnessLab() {
  const [temp, setTemp] = useState(0.7)
  const [n, setN] = useState(5)
  const [strategy, setStrategy] = useState('first')
  const [fixed, setFixed] = useState(true)
  const [seed, setSeed] = useState(FIXED_SEED)
  const [runs, setRuns] = useState(0)   // 每按一次跑評測 +1：固定種子時結果相同，但格子重新播一次
  const useSeed = fixed ? FIXED_SEED : seed
  const sim = useMemo(() => simulate(temp, n, strategy, useSeed), [temp, n, strategy, useSeed])
  const curves = useMemo(() => Object.keys(STRATS).map((s) => ({
    key: s, label: s === 'checker' ? '檢查器（沒放錯）' : STRATS[s].short, color: COLORS[s],
    values: Array.from({ length: 11 }, (_, i) => { const e = expectedAll(i / 10, s); return (s === 'checker' ? 1 - e.bad : e.ok) * 100 }),
  })), [])
  const table = Object.keys(STRATS).map((s) => ({ s, ...expectedAll(temp, s) }))
  const rerun = () => { setRuns((r) => r + 1); if (!fixed) setSeed(Math.floor(Math.random() * 2 ** 31)) }
  const pct = (v) => `${Math.round(v * 100)}%`
  const tone = sim.passRate >= 0.9 ? 'ok' : sim.passRate >= 0.7 ? 'warn' : 'bad'

  const EX = {
    first: ['直接用第一次：把抽樣當成答案', [
      '模型每次輸出都是從一個機率分布抽樣，溫度越高分布越平、抽到不同答案的機會越大。只跑一次就上線，等於拿一次抽樣當整體品質。',
      `現在 ${CASES.length} 題各跑 ${n} 次，有 ${sim.unstable} 題「有時過有時不過」${n === 1 ? '——取樣 1 次根本看不出哪題不穩，把取樣次數調到 5 或 20 再看' : '。這些題在單次 demo 裡可能剛好過，正式上線後卻斷斷續續失敗'}。`,
    ]],
    vote: ['多數決：用 3 次呼叫換穩定', [
      '同一題抽 3 次、取多數。對「大多時候對、偶爾抽歪」的題目很有效：單次 80% 的題，三取二後約 90%。',
      '但對「大多時候錯」的題目，多數決只會更穩定地錯——通過率 40% 的題三取二後只剩約 35%。成本固定變三倍，而且把錯誤抹得更像「確定的答案」。',
    ]],
    retry: ['失敗重試：只救看得出來的失敗', [
      `重試需要「知道失敗了」。這裡假設 ${Math.round(DETECTABLE * 100)}% 的失敗在 schema 層看得出（缺欄位、JSON 壞掉），其餘是欄位都在、值卻錯的「看起來對」——這種不會觸發重試，照樣放行。`,
      `平均每次任務呼叫 ${sim.avgCalls.toFixed(2)} 次：容易的題幾乎不重試，難的題才多花錢。這是「只在需要時付費」的策略，但上限是最多救回看得出來的那部分。`,
    ]],
    checker: ['檢查器：寧可攔下，不要放錯', [
      `在模型之後加一層獨立檢查（schema 驗證、日期必須在未來、醫師要在名單上…）。檢查器不會讓答案變對，而是把不合格的輸出攔下來（橘格），交給人處理或走別的流程。`,
      `代價是「攔下」也算沒完成；收穫是錯誤放行從 ${pct(simulate(temp, n, 'first', useSeed).badRate)} 降到 ${pct(sim.badRate)}。這裡假設檢查器能抓到 ${Math.round(CATCH_SILENT * 100)}% 的「看起來對其實錯」，真實比例要靠自己的評測集量。`,
    ]],
  }[strategy]

  return (
    <Lab accent="violet" kicker="AI LAB" title="Harness Engineering：同一個 prompt 為什麼差這麼多"
         blurb="8 題「把自然語言轉成結構化欄位」的示意題，同一個 prompt 跑 N 次。拉溫度看結果怎麼變得不穩，切 harness 策略看多數決、重試、檢查器各自救回什麼、花掉什麼。">
      <LabControls>
        <Slider label="溫度 temperature" min={0} max={1} step={0.1} value={temp} onChange={setTemp} format={(v) => v.toFixed(1)} />
        <Seg label="取樣次數" value={n} onChange={setN} options={[1, 5, 20].map((v) => ({ value: v, label: `${v} 次` }))} />
        <Seg label="harness 策略" tinted value={strategy} onChange={setStrategy} options={Object.entries(STRATS).map(([k, s]) => ({ value: k, label: s.label }))} />
        <Toggle label="固定亂數種子" checked={fixed} onChange={setFixed} />
        <button type="button" className="btn ghost small" onClick={rerun} title={fixed ? '固定種子時同樣設定永遠得到同樣結果' : '抽新的亂數再跑一次'}>跑評測</button>
      </LabControls>

      <LabGrid>
        <div className="lab-stack">
          <LabStage label="每題 N 次的結果格子" caption={`綠 = 正確、紅 = 錯誤放行、橘 = 被檢查器攔下；每題右側是該題在溫度 ${temp.toFixed(1)} 下的單次通過機率（示意）`}>
            <div className="hr-grid" key={`${useSeed}-${strategy}-${n}-${temp}-${runs}`} style={{ '--n': n }}>
              {sim.rows.map((r, i) => (
                <div key={i} className={`hr-row${r.flaky ? ' flaky' : ''}`}>
                  <div className="hr-case">
                    <span className="hr-q">「{r.text}」</span>
                    <span className="hr-f">→ {r.fields}</span>
                  </div>
                  <div className="hr-cells" role="img" aria-label={`第 ${i + 1} 題 ${n} 次中 ${r.k} 次正確`}>
                    {r.cells.map((c, j) => <i key={j} className={`hr-cell ${c}`} style={{ animationDelay: `${j * 18}ms` }} />)}
                  </div>
                  <span className="hr-p">{r.k}/{n}<small>p={r.p.toFixed(2)}</small></span>
                </div>
              ))}
            </div>
            <div className="hr-legend">
              <Status ok>正確</Status><Status>錯誤放行</Status><Status warn>攔下</Status>
              <span className="muted">虛線框的題 = 有時過有時不過（不穩定）</span>
            </div>
          </LabStage>
          <Stats min={130}>
            <Stat label="整體通過率" value={pct(sim.passRate)} tone={tone} note={`${CASES.length} 題 × ${n} 次`} />
            <Stat label="不穩定的題" value={sim.unstable} unit={`/ ${CASES.length}`} tone={sim.unstable >= 4 ? 'bad' : sim.unstable ? 'warn' : 'ok'} note={n === 1 ? '只跑 1 次看不出來' : '有時過有時不過'} />
            <Stat label="錯誤放行" value={pct(sim.badRate)} tone={sim.badRate > 0.15 ? 'bad' : sim.badRate > 0 ? 'warn' : 'ok'} note={strategy === 'checker' ? `另有 ${sim.blocked} 次被攔下` : '錯了卻當成答案往下走'} />
            <Stat label="平均每次任務呼叫" value={sim.avgCalls.toFixed(2)} unit="次" note={strategy === 'vote' ? '固定 3 倍成本' : strategy === 'retry' ? '難題才多花' : '1 次就 1 次'} />
          </Stats>
          <div className="dtable-wrap">
            <table className="dtable">
              <caption>溫度 {temp.toFixed(1)} 下四種策略的期望值（不抽樣，示意）</caption>
              <thead><tr><th>策略</th><th>正確</th><th>錯誤放行</th><th>攔下</th><th>每次任務呼叫</th></tr></thead>
              <tbody>
                {table.map((r) => (
                  <tr key={r.s} className={`clickable${r.s === strategy ? ' hit' : ''}`} onClick={() => setStrategy(r.s)}>
                    <td>{STRATS[r.s].short}</td><td>{pct(r.ok)}</td><td>{pct(r.bad)}</td><td>{r.blocked ? pct(r.blocked) : '—'}</td><td>{r.calls.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lab-stack">
          <LineChart title="期望通過率 vs 溫度（示意）" xMax={10} yMax={100} xTicks={[0, 2, 4, 6, 8, 10]}
                     fmtX={(i) => (i / 10).toFixed(1)} fmtY={(v) => `${Math.round(v)}%`} mark={Math.round(temp * 10)} series={curves}
                     ariaLabel={`四種 harness 策略的通過率隨溫度變化，目前溫度 ${temp.toFixed(1)}`} />
          <Code lang="python" title="harness 的四種寫法（示意）" highlight={HL[strategy]} dim>{PY}</Code>
          <LabExplain title={EX[0]}>{EX[1].map((t, i) => <p key={i}>{t}</p>)}</LabExplain>
          <LabExplain title="評測要跑很多次、要固定種子">
            <p>「跑一次 demo 成功」和「通過率 95%」是兩件事。評測集要固定、每題跑多次、把「不穩定的題數」當成一個指標；開了固定種子之後，同樣設定每次都得到同樣結果，改 prompt 或改策略才比得出差異，而不是在比運氣。</p>
            <p>關掉固定種子、連按幾次「跑評測」，看通過率在同一組設定下跳多少——那個跳動就是只跑一次會被騙到的範圍。</p>
          </LabExplain>
          <Callout title="什麼時候會真的踩到">
            prompt 在開發機上「每次都對」、上線一週後客服收到零星的欄位錯誤；換了模型版本後同一個 prompt 通過率掉一截卻沒人發現；多數決讓成本變三倍但難題照樣錯。這些都不是 prompt 寫得好不好的問題，而是模型外面那層 harness（抽樣、重試、驗證、評測）有沒有搭好。
          </Callout>
        </div>
      </LabGrid>
      <Caption>通過機率、失敗可偵測比例、檢查器攔截率皆為示意參數，用來呈現策略之間的相對差異，不代表任何真實模型的表現。</Caption>

      <style>{`
        .hr-grid { display: grid; gap: 6px; }
        .hr-row { display: grid; grid-template-columns: minmax(150px, 1.1fr) minmax(0, 2fr) 64px; gap: 10px; align-items: center; padding: 4px 6px; border: 1px dashed transparent; border-radius: var(--radius); transition: border-color 0.3s ease; }
        .hr-row.flaky { border-color: var(--serious); }
        .hr-case { display: grid; min-width: 0; }
        .hr-q { font-size: 0.8rem; color: var(--ink-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .hr-f { font-family: var(--mono); font-size: 0.68rem; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .hr-cells { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 3px; min-width: 0; }
        .hr-cell { display: block; aspect-ratio: 1; max-height: 22px; border-radius: 3px; background: var(--surface-2); animation: hr-pop 0.3s ease-out both; }
        .hr-cell.ok { background: var(--good); }
        .hr-cell.bad { background: var(--critical); }
        .hr-cell.blocked { background: var(--serious); }
        @keyframes hr-pop { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: none; } }
        .hr-p { font-family: var(--mono); font-size: 0.78rem; color: var(--ink-1); text-align: right; display: grid; font-variant-numeric: tabular-nums; }
        .hr-p small { font-size: 0.64rem; color: var(--ink-3); }
        .hr-legend { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; margin-top: 12px; font-size: 0.76rem; }
        .hr-legend .muted { color: var(--ink-3); }
        @media (max-width: 560px) {
          .hr-row { grid-template-columns: minmax(0, 1fr) 56px; }
          .hr-case { grid-column: 1 / -1; }
          .hr-q, .hr-f { white-space: normal; }
        }
        @media (prefers-reduced-motion: reduce) { .hr-cell { animation: none; } .hr-row { transition: none; } }
      `}</style>
    </Lab>
  )
}

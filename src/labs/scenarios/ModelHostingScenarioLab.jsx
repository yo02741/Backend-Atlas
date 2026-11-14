import React, { useEffect, useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Slider, Toggle, Callout, Status, useTicker, Stats, Stat, Flow, LineChart, Caption, fmtN } from '../ui.jsx'

/* 模型放哪裡 情境模擬器（虛構的醫院：衛教問答 + 病歷摘要）。
   三種做法：全部雲端 API / 全部地端自架 / 依資料敏感度分流。
   調每日請求量、敏感請求比例、地端 GPU 台數、尖峰倍數，按「跑一天」逐小時播放：
   敏感資料有沒有離開院內、地端排隊、被拒絕的請求；另外比較每月成本結構、評測通過率、維運人力。
   可注入「10 時壞一台 GPU」。
   所有數字都是示意：成本是無單位的指數，不對應任何業者的價格、任何模型或硬體的規格。 */

const MODES = [
  { value: 'cloud', label: '全部雲端 API' },
  { value: 'local', label: '全部地端' },
  { value: 'split', label: '依敏感度分流' },
]
const HOURS = 24
const T_END = HOURS - 1
const GPU_CAP = 400        // 一台 GPU 每小時處理幾個請求（示意）
const QUEUE_LIMIT = 600    // 地端佇列上限，超過就回 503（示意）
const FAIL_AT = 10         // 注入故障的時間：尖峰中段
const Q_CLOUD = 92         // 自家評測集的通過率（示意）：雲端的大模型
const Q_LOCAL = 84         // 自家評測集的通過率（示意）：地端跑得動的模型
const STAFF = 2            // 現有維運人力

/* 一天 24 小時的流量形狀：夜間低、8–11 時是尖峰（倍數可調）、下午平、晚上降 */
function profile(peak) {
  return Array.from({ length: HOURS }, (_, h) => {
    if (h < 7) return 0.15
    if (h === 7) return 0.7
    if (h < 12) return peak
    if (h < 18) return 1
    return h < 22 ? 0.5 : 0.2
  })
}

/* 逐小時模擬。地端是一個先到先服務的佇列：這一小時做不完的留到下一小時，
   超過佇列上限的被拒（回 503，不外送）。雲端不模擬限流與當機。 */
function simulate(mode, p) {
  const w = profile(p.peak)
  const sum = w.reduce((a, b) => a + b, 0)
  const rows = []
  let backlog = 0, leaked = 0, rejected = 0, toCloudDay = 0, toLocalDay = 0
  for (let h = 0; h < HOURS; h++) {
    const req = (p.daily * w[h]) / sum
    const sens = req * p.sens
    const gen = req - sens
    const broken = p.fail && h >= FAIL_AT ? 1 : 0
    const gpus = mode === 'cloud' ? 0 : Math.max(0, p.gpus - broken)
    const cap = gpus * GPU_CAP
    const toLocal = mode === 'local' ? req : mode === 'split' ? sens : 0
    const toCloud = req - toLocal
    const sensOut = mode === 'cloud' ? sens : 0          // 只有全部雲端時，敏感請求才會出去
    let q = backlog + toLocal
    q -= Math.min(q, cap)                                 // 這一小時處理掉的
    const rej = Math.max(0, q - QUEUE_LIMIT)              // 佇列放不下的：回 503
    backlog = q - rej
    const wait = cap > 0 ? (backlog / cap) * 60 : backlog > 0 ? Infinity : 0
    leaked += sensOut
    rejected += rej
    toCloudDay += toCloud
    toLocalDay += toLocal
    rows.push({ req, sens, gen, toLocal, toCloud, cap, gpus, backlog, rej, wait, leaked, rejected })
  }
  // 每月成本指數：固定（硬體折舊、機房、整合）與變動（雲端按量計費；地端只有電力）
  const base = mode === 'cloud' ? 10 : mode === 'local' ? 60 : 70
  const fixed = base + (mode === 'cloud' ? 0 : 70 * p.gpus)
  const variable = Math.round(toCloudDay * 0.05 + toLocalDay * 0.004)
  const quality = Math.round((Q_CLOUD * toCloudDay + Q_LOCAL * toLocalDay) / p.daily)
  const ops = mode === 'cloud' ? 0.3 : (mode === 'local' ? 1.2 : 1.5) + 0.15 * p.gpus
  return { rows, fixed, variable, quality, ops }
}

/* 到第 t 小時為止的累計：敏感外送、被拒、最長等待 */
function upTo(sim, t) {
  const seen = sim.rows.slice(0, t + 1)
  return {
    leaked: Math.round(sim.rows[t].leaked),
    rejected: Math.round(sim.rows[t].rejected),
    maxWait: Math.max(...seen.map((r) => r.wait)),
  }
}
const waitText = (m) => (m === Infinity ? '停擺' : `${Math.round(m)} 分`)
const n0 = (v) => fmtN(Math.round(v))

const EXPLAIN = {
  cloud: {
    title: '全部雲端 API：最省事，前提是資料能出去',
    body: [
      '沒有 GPU、沒有佇列，成本幾乎全是變動的：請求量加倍，帳單也加倍。品質用的是供應商的大模型，維運只剩金鑰、配額與紀錄。',
      '「敏感請求比例」只要大於 0，第一塊數字就是紅的：病歷內容離開了院內。法遵不允許時，其他欄位再好看也不能選。這裡沒有模擬供應商的限流與當機，實際上那是這個做法的主要風險。',
    ],
  },
  local: {
    title: '全部地端：資料最單純，容量是自己的事',
    body: [
      '所有請求進同一池 GPU。容量固定，進來的比做完的多就排隊；把「尖峰倍數」拉高或把 GPU 台數調低，等待時間在上午一路累積，佇列滿了之後開始拒絕。衛教問答暴增時，病歷摘要一起等。',
      '成本幾乎全是固定的：請求量很低時機器閒置、每次請求很貴，請求量高而穩定時才划算。評測通過率用的是地端跑得動的模型，兩個功能都受影響。',
    ],
  },
  split: {
    title: '依敏感度分流：敏感的留院內，其餘送雲端',
    body: [
      '只有敏感請求進地端，GPU 依敏感請求的尖峰準備就好；衛教問答的暴增交給雲端，不會拖慢病歷摘要。敏感請求比例越高，地端的負擔越重，比例到 100% 時就和全部地端一樣。',
      '代價是兩條路徑都要維護，人力最高。分流規則本身是安全邊界：沒有標示的請求要當成敏感，敏感路由不能有雲端備援。',
    ],
  },
}

export default function ModelHostingScenarioLab() {
  const [mode, setMode] = useState('split')
  const [daily, setDaily] = useState(6000)
  const [sensPct, setSensPct] = useState(35)
  const [gpus, setGpus] = useState(2)
  const [peak, setPeak] = useState(2.5)
  const [fail, setFail] = useState(false)
  const [started, setStarted] = useState(false)
  const [running, setRunning] = useState(false)
  const [tick, resetTick] = useTicker(running, 260)
  const [scrub, setScrub] = useState(null)
  useEffect(() => { if (tick >= T_END) setRunning(false) }, [tick])

  const p = { daily, sens: sensPct / 100, gpus, peak, fail }
  const sim = useMemo(() => simulate(mode, p), [mode, daily, sensPct, gpus, peak, fail])
  const t = started ? Math.min(T_END, tick) : T_END
  const shown = scrub ?? t
  const acc = upTo(sim, t)
  const play = () => { setStarted(true); resetTick(); setRunning(true) }
  const ex = EXPLAIN[mode]

  const peakY = Math.max(...sim.rows.map((r) => Math.max(r.req, r.cap)))
  const yReq = Math.max(800, Math.ceil(peakY / 400) * 400)
  const waits = sim.rows.map((r) => Math.min(240, r.wait))
  const yWait = Math.max(60, Math.ceil(Math.max(...waits) / 60) * 60)
  const CH = { xMax: T_END, xTicks: [0, 6, 12, 18], fmtX: (h) => `${h} 時`, upto: t, mark: scrub, onScrub: setScrub }
  const waitNote = { cloud: '沒有地端佇列；受供應商限流影響', local: '兩個功能排同一個佇列', split: '只有敏感請求在排' }[mode]
  const qualityNote = { cloud: '全部用雲端的大模型', local: '全部用地端跑得動的模型', split: '只有敏感功能用地端的模型' }[mode]

  return (
    <Lab accent="aqua" kicker="SCENARIO LAB" title="衛教問答與病歷摘要：模型放雲端、地端，還是分流"
         blurb="一天逐小時：敏感資料有沒有離開院內、地端排多久、成本是固定還是變動，以及一台 GPU 故障時各做法怎麼退化。">
      <LabControls>
        <Seg label="做法" tinted value={mode} onChange={setMode} options={MODES} />
        <Slider label="每日請求量" min={1000} max={20000} step={1000} value={daily} onChange={setDaily} format={(v) => `${fmtN(v)} 筆`} />
        <Slider label="敏感請求比例" min={0} max={100} step={5} value={sensPct} onChange={setSensPct} format={(v) => `${v}%`} />
        <Slider label="地端 GPU 台數" min={1} max={8} value={gpus} onChange={setGpus} format={(v) => `${v} 台`} />
        <Slider label="尖峰倍數（8–11 時）" min={1} max={4} step={0.5} value={peak} onChange={setPeak} format={(v) => `${v.toFixed(1)} 倍`} />
        <Toggle label={`注入：${FAIL_AT} 時壞一台 GPU`} checked={fail} onChange={setFail} />
      </LabControls>
      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabControls>
            <button type="button" className="btn small" onClick={play}>{started ? '重跑一天' : '跑一天'}</button>
            <span className="seg-label">{t < T_END ? `播放中：${t} 時` : '顯示整天的結果'}</span>
            <span className="spacer" />
            {acc.leaked > 0
              ? <Status>敏感資料已離開院內</Status>
              : <Status ok>敏感資料沒有離開院內</Status>}
          </LabControls>
          <Stats min={150}>
            <Stat label="離開院內的敏感請求（累計）" value={fmtN(acc.leaked)} unit="筆"
                  tone={acc.leaked > 0 ? 'bad' : 'ok'}
                  note={mode === 'cloud' ? '所有請求都送雲端' : '敏感請求只進地端'} />
            <Stat label="地端最長排隊" value={mode === 'cloud' ? '—' : waitText(acc.maxWait)}
                  tone={acc.maxWait > 30 ? 'bad' : acc.maxWait > 5 ? 'warn' : ''}
                  note={waitNote} />
            <Stat label="被拒絕（佇列已滿，累計）" value={fmtN(acc.rejected)} unit="筆"
                  tone={acc.rejected > 0 ? 'bad' : ''}
                  note={acc.rejected > 0 ? '回 503，由功能端降級；沒有外送' : `佇列上限 ${QUEUE_LIMIT} 筆`} />
            <Stat label="每月成本指數（示意）" value={fmtN(sim.fixed + sim.variable)}
                  note={`固定 ${fmtN(sim.fixed)} + 變動 ${fmtN(sim.variable)}`} />
            <Stat label="評測通過率（示意）" value={`${sim.quality}%`} note={qualityNote} />
            <Stat label="維運人力（示意）" value={sim.ops.toFixed(1)} unit="人"
                  tone={sim.ops > STAFF ? 'warn' : ''}
                  note={sim.ops > STAFF ? `超過現有的 ${STAFF} 人` : `現有 ${STAFF} 人`} />
          </Stats>
          <LabStage plain label="一天 24 小時的請求、地端容量與排隊">
            <div className="mh-charts">
              <LineChart {...CH} title="每小時請求與地端容量" yMax={yReq} fmtY={n0}
                         series={[
                           { key: 'req', label: '全部請求', color: 'var(--c-blue)', values: sim.rows.map((r) => r.req) },
                           { key: 'loc', label: '送到地端', color: 'var(--lab-accent)', values: sim.rows.map((r) => r.toLocal) },
                           { key: 'cap', label: '地端容量', color: 'var(--c-green)', values: sim.rows.map((r) => r.cap) },
                         ]} />
              <LineChart {...CH} title="地端排隊等待（分鐘）" yMax={yWait} fmtY={(v) => String(Math.round(v))}
                         thresholds={[{ v: 30, label: '30 分' }]}
                         series={[{ key: 'wait', label: '等待', color: 'var(--c-orange)', values: waits }]} />
            </div>
            <HourFlow mode={mode} r={sim.rows[shown]} hour={shown} />
            <Caption>
              一台 GPU 每小時處理 {GPU_CAP} 筆、佇列上限 {QUEUE_LIMIT} 筆、通過率與成本指數皆為示意，不對應任何模型、硬體或業者的價格。游標移到圖上可看任一小時。
            </Caption>
          </LabStage>
          <Compare p={p} mode={mode} onPick={setMode} />
        </div>
        <div className="lab-stack">
          <LabExplain title={ex.title}>{ex.body.map((s, i) => <p key={i}>{s}</p>)}</LabExplain>
          <LabExplain title="壞一台 GPU 會怎樣">
            {mode === 'cloud' ? (
              <p>這個做法不用地端 GPU，故障沒有影響。對應的風險在另一邊：供應商當機或限流時，兩個功能一起停，而且自己沒有辦法修。</p>
            ) : (
              <p>
                {FAIL_AT} 時起容量少一台，剛好在尖峰中段。
                {mode === 'local' ? '兩個功能共用的佇列一起變長；' : '只有敏感請求受影響，衛教問答照常走雲端；'}
                佇列滿了之後請求被拒，數字出現在「被拒絕」，而「離開院內」維持 0：敏感請求不會因為故障改送雲端。
                把 GPU 調成 1 台再注入故障，容量歸零，地端的功能整個停擺。
              </p>
            )}
          </LabExplain>
          <Callout title="什麼時候會踩到">
            gateway 的 fallback 沒有區分資料分級，地端一滿載病歷就被送到雲端；依平均流量買 GPU，上午查房後全院一起排隊；
            只有一台 GPU，故障那天才發現沒有人工流程；成本只比硬體報價與 token 單價，漏掉人力與閒置。
          </Callout>
        </div>
      </LabGrid>
      <style>{`
        .mh-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .mh-table td, .mh-table th { white-space: nowrap; }
        .mh-table td.mh-bad { color: var(--critical); font-weight: 600; }
        .mh-bar { display: inline-flex; width: 84px; height: 8px; border-radius: 4px; overflow: hidden; background: var(--surface-2); vertical-align: middle; margin-right: 8px; }
        .mh-bar i { display: block; height: 100%; transition: width 0.25s ease; }
        .mh-bar i.f, .mh-key.f::before { background: var(--lab-accent); }
        .mh-bar i.v, .mh-key.v::before { background: var(--c-orange); }
        .mh-key::before { content: ''; display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin: 0 4px 0 8px; }
        /* 手機：共用樣式會讓表格換行而不是橫向捲動，所以只留四欄；被拒、通過率、人力看上面的數字磚 */
        @media (max-width: 560px) {
          .mh-charts { grid-template-columns: 1fr; }
          .mh-table .mh-wide { display: none; }
          .mh-bar { display: flex; width: 100%; max-width: 96px; margin: 0 0 4px; }
        }
        @media (prefers-reduced-motion: reduce) { .mh-bar i { transition: none; } }
      `}</style>
    </Lab>
  )
}

/* 這一小時兩種請求各自的去向：同一個 gateway，目的地隨做法變 */
function HourFlow({ mode, r, hour }) {
  const localBox = {
    label: `地端推論（${r.gpus} 台）`,
    value: r.gpus === 0 ? '沒有容量' : r.backlog >= 1 ? `排隊 ${n0(r.backlog)} 筆 · 約等 ${waitText(r.wait)}` : '即時處理',
    bad: r.gpus === 0 || r.wait > 30,
    hot: r.gpus > 0 && r.wait <= 30,
  }
  const cloudBox = { label: '雲端 API', value: '按用量計費' }
  const leakBox = {
    label: '雲端 API',
    value: r.sens >= 1 ? '病歷內容離開院內' : '這一小時沒有敏感請求',
    bad: r.sens >= 1,
  }
  const rejected = r.rej >= 1 ? `這一小時 ${n0(r.rej)} 筆因佇列已滿被拒（503），沒有改送雲端` : ''
  const gwAll = mode === 'cloud' ? '全部送雲端' : '全部送地端'
  return (
    <>
      <Flow title={`${hour} 時 · 敏感請求（病歷摘要）的去向（示意）`}
            steps={[
              { label: '病歷摘要功能', value: `${n0(r.sens)} 筆/時` },
              { label: 'AI Gateway', value: mode === 'split' ? '分級 sensitive → 只有地端' : gwAll },
              mode === 'cloud' ? leakBox : localBox,
            ]}
            back={mode === 'cloud' ? '' : rejected}
            notes={[mode !== 'cloud' && r.gpus === 0 && r.sens >= 1 && '地端沒有容量：功能停擺，由人工流程接手']} />
      <Flow title={`${hour} 時 · 一般請求（衛教問答）的去向（示意）`}
            steps={[
              { label: '衛教問答功能', value: `${n0(r.gen)} 筆/時` },
              { label: 'AI Gateway', value: mode === 'split' ? '分級 general → 雲端' : gwAll },
              mode === 'local' ? localBox : cloudBox,
            ]}
            back={mode === 'local' ? rejected : ''}
            notes={[mode === 'local' && '和病歷摘要共用同一池 GPU 與同一個佇列']} />
    </>
  )
}

/* 同一組參數下三種做法並排：成本用橫條拆成固定與變動 */
function Compare({ p, mode, onPick }) {
  const rows = MODES.map((m) => {
    const s = simulate(m.value, p)
    return { ...m, s, a: upTo(s, T_END) }
  })
  const maxCost = Math.max(...rows.map((r) => r.s.fixed + r.s.variable))
  const pct = (v) => `${(v / maxCost) * 100}%`
  return (
    <div className="dtable-wrap">
      <table className="dtable mh-table">
        <caption>
          同一組參數，三種做法並排（示意）
          <span className="mh-key f">固定</span><span className="mh-key v">變動</span>
        </caption>
        <thead>
          <tr><th>做法</th><th>敏感外送</th><th>最長排隊</th><th className="mh-wide">被拒</th><th>每月成本指數</th><th className="mh-wide">通過率</th><th className="mh-wide">人力</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.value} className={`clickable${r.value === mode ? ' hit' : ''}`} onClick={() => onPick(r.value)}>
              <td>{r.label}</td>
              <td className={r.a.leaked > 0 ? 'mh-bad' : ''}>{r.a.leaked > 0 ? `${fmtN(r.a.leaked)} 筆` : '0'}</td>
              <td className={r.a.maxWait > 30 ? 'mh-bad' : ''}>{r.value === 'cloud' ? '—' : waitText(r.a.maxWait)}</td>
              <td className={`mh-wide${r.a.rejected > 0 ? ' mh-bad' : ''}`}>{fmtN(r.a.rejected)}</td>
              <td>
                <span className="mh-bar" aria-hidden="true">
                  <i className="f" style={{ width: pct(r.s.fixed) }} />
                  <i className="v" style={{ width: pct(r.s.variable) }} />
                </span>
                {fmtN(r.s.fixed)} + {fmtN(r.s.variable)}
              </td>
              <td className="mh-wide">{r.s.quality}%</td>
              <td className={`mh-wide${r.s.ops > STAFF ? ' mh-bad' : ''}`}>{r.s.ops.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

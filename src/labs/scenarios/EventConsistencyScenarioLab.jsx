import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Callout, Status,
  useTicker, useWidth, Stats, Stat, Flow, LineChart, Caption, fmtN, kfmt,
} from '../ui.jsx'

/* 事件和資料庫不同步：1,000 筆掛號，每筆依序抽籤決定「交易回滾、程序被砍、publish 失敗或逾時、消費端重複收到」，
   同一組亂數在三種做法（雙寫 / outbox / CDC）下各自推算結果：丟事件、重複送達、重複生效、幽靈事件、端到端延遲。
   亂數有固定種子（每按一次「跑」換一組），所有比例與延遲都是示意 */

const MODES = [
  { value: 'dual', label: '雙寫' },
  { value: 'outbox', label: 'Outbox' },
  { value: 'cdc', label: 'CDC（概念）' },
]
const WHEN = [
  { value: 'after', label: 'commit 後 publish' },
  { value: 'inside', label: '交易裡 publish' },
]
const N = 1000, BATCH = 25, ROLLBACK = 0.04          // 示意：4% 的掛號因時段已滿而回滾
const FATE_COLOR = {
  ok: 'var(--c-aqua)',
  rollback: 'var(--surface-2)',
  lost: 'var(--critical)',
  ghost: 'var(--c-magenta)',
  dup: 'var(--serious)',
}
const FATE_LABEL = {
  ok: '正常',
  rollback: '回滾（無事件，正確）',
  lost: '丟事件',
  ghost: '幽靈事件',
  dup: '有重複生效的掛號',
}

function rng(seed) {                                   // mulberry32
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* 一筆掛號在某做法下的結果：copies = 消費端收到幾份、effects = 生效幾次、ghost、lost、lat（ms） */
function one(mode, when, d, idem) {
  const [rb, crash, f1, timeout, f2, redeliver, jitter] = d
  let copies = 0, ghost = false, lost = false, lat = 0, committed = !rb.roll
  if (mode === 'dual') {
    const publish = () => {                            // 失敗時重試一次；逾時代表其實送到了，重試又送一份
      if (!f1.hit) { lat += 30; return 1 }
      if (timeout.hit) { lat += 1030; return 2 }
      lat += 1030
      if (!f2.hit) { lat += 30; return 1 }
      return 0
    }
    if (when === 'after') {
      if (!committed) return { fate: 'rollback', copies: 0, effects: 0, lat: 0 }
      if (crash.hit) return { fate: 'lost', copies: 0, effects: 0, lost: true, lat: 0 }
      copies = publish(); lost = copies === 0
    } else {
      copies = publish()                               // 先 publish，再 commit
      if (crash.hit) committed = false                 // commit 前程序被砍：交易回滾
      if (!committed && copies > 0) ghost = true
      if (!committed && copies === 0) return { fate: 'rollback', copies: 0, effects: 0, lat: 0 }
      if (committed && copies === 0) lost = true
    }
  } else {
    if (!committed || crash.hit) return { fate: 'rollback', copies: 0, effects: 0, lat: 0 }   // 業務列與事件一起回滾
    const base = mode === 'outbox' ? 100 + jitter * 200 : 250 + jitter * 300                   // relay 掃描間隔 / 讀日誌
    lat = base + (f1.hit ? (mode === 'outbox' ? 200 : 300) : 0) + (f1.hit && f2.hit ? 400 : 0)  // 失敗留在表裡或位移不動，下一輪再送
    copies = 1 + (timeout.hit && f1.hit ? 1 : 0) + (crash.relay ? 1 : 0)                       // 送出後、標記前掛掉 → 重送
  }
  if (copies > 0 && redeliver.hit) copies++            // 佇列至少一次：消費端重複收到
  const effects = ghost ? copies && 1 : idem ? Math.min(1, copies) : copies
  const fate = ghost ? 'ghost' : lost ? 'lost' : effects > 1 ? 'dup' : 'ok'
  return { fate, copies, effects, ghost, lost, lat }
}

function simulate(mode, when, failP, crashP, dupP, idem, seed) {
  const r = rng(seed)
  const rows = [], cum = { lost: [0], dup: [0], ghost: [0] }
  let lost = 0, dupDeliv = 0, dupEff = 0, ghost = 0
  const lats = []
  for (let i = 0; i < N; i++) {
    const d = [
      { roll: r() < ROLLBACK },                       // 時段已滿 → 回滾
      { hit: r() < crashP, relay: r() < crashP },     // API 程序被砍 / relay（或連接器）被砍
      { hit: r() < failP },                           // 第一次送事件失敗
      { hit: r() < 0.5 },                             // 失敗裡有一半是逾時、其實送到了
      { hit: r() < failP },                           // 重試也失敗
      { hit: r() < dupP },                            // 佇列重複投遞
      r(),                                            // 延遲抖動
    ]
    const x = one(mode, when, d, idem)
    rows.push(x.fate)
    if (x.lost) lost++
    if (x.ghost) ghost++
    if (x.copies > 1) dupDeliv += x.copies - 1
    if (!x.ghost && x.effects > 1) dupEff += x.effects - 1
    if (x.lat) lats.push(x.lat)
    if ((i + 1) % BATCH === 0) { cum.lost.push(lost); cum.dup.push(dupEff); cum.ghost.push(ghost) }
  }
  lats.sort((a, b) => a - b)
  return {
    rows, cum, lost, dupDeliv, dupEff, ghost,
    p50: lats[Math.floor(lats.length * 0.5)] || 0,
    p95: lats[Math.floor(lats.length * 0.95)] || 0,
  }
}

const EXPLAIN = {
  dual: {
    title: '雙寫：兩次寫入之間沒有任何東西把它們綁在一起',
    body: [
      '「commit 後 publish」：commit 成功、publish 之前程序被砍，或 publish 重試也失敗，事件就丟了——檢驗系統少收一筆預約。publish 逾時其實已送到，重試又送一份。',
      '切到「交易裡 publish」：事件先送出，之後交易回滾（時段已滿）或 commit 前被砍，LINE 已經通知了一個不存在的掛號，這就是幽靈事件。兩種順序只是把錯誤從「丟」換成「多」。',
    ],
  },
  outbox: {
    title: 'Outbox：事件跟業務資料同一個交易',
    body: [
      '掛號列與 outbox 列一起 commit、一起回滾，所以丟事件與幽靈事件都是 0。publish 失敗只會讓事件留在表裡，下一輪 relay 再送，代價是延遲多幾百毫秒。',
      'relay 送出後、標記 sent_at 前掛掉，下一輪會再送一次；佇列本身也是至少一次。重複送達一定會發生，消費端的冪等鍵表決定它會不會變成「LINE 寄兩次」。把冪等關掉看看。',
    ],
  },
  cdc: {
    title: 'CDC：從資料庫日誌讀已 commit 的變更（概念）',
    body: [
      '連接器讀 WAL，只有已 commit 的變更會出現在日誌裡，所以沒有幽靈事件；位移沒前進前不會漏，所以也不丟。應用程式一行不用改。',
      '代價在別處：事件是「appointments 表多了一列」，不是「掛號成立」；連接器重啟會從上次位移重放，消費端仍要冪等。這裡只示意延遲與重放，不模擬 replication slot 與 schema 變更。',
    ],
  },
}

export default function EventConsistencyScenarioLab() {
  const [mode, setMode] = useState('dual')
  const [when, setWhen] = useState('after')
  const [failP, setFailP] = useState(5)
  const [crashP, setCrashP] = useState(2)
  const [dupP, setDupP] = useState(3)
  const [idem, setIdem] = useState(true)
  const [seed, setSeed] = useState(7)
  const [running, setRunning] = useState(false)
  const [started, setStarted] = useState(false)
  const [tick, resetTick] = useTicker(running, 60)
  const steps = N / BATCH
  const k = started ? Math.min(steps, tick) : steps
  const done = k * BATCH
  useEffect(() => { if (tick >= steps) setRunning(false) }, [tick, steps])

  const chartRef = useRef(null)
  const chartW = useWidth(chartRef, 640)
  const sim = useMemo(
    () => simulate(mode, when, failP / 100, crashP / 100, dupP / 100, mode === 'dual' ? false : idem, seed),
    [mode, when, failP, crashP, dupP, idem, seed],
  )
  const idemOn = mode !== 'dual' && idem
  const count = (fate) => sim.rows.slice(0, done).filter((f) => f === fate).length
  const lostNow = sim.cum.lost[k], dupNow = sim.cum.dup[k], ghostNow = sim.cum.ghost[k]
  const ex = EXPLAIN[mode]
  const run = () => { setSeed((s) => s + 1); setStarted(true); resetTick(); setRunning(true) }
  const yMax = Math.max(10, Math.ceil(Math.max(sim.lost, sim.dupEff, sim.ghost) / 10) * 10)

  const flowSteps = mode === 'dual' ? [
    { label: 'API handler', value: when === 'after' ? '寫 DB → commit → publish' : 'publish → 寫 DB → commit' },
    { label: 'PostgreSQL', value: `掛號 ${fmtN(done - count('rollback'))} 筆` },
    { label: '佇列', value: `丟 ${lostNow} · 幽靈 ${ghostNow}`, bad: lostNow + ghostNow > 0 },
    { label: '消費端 ×3', value: 'LINE / 報表 / 檢驗' },
    { label: '冪等鍵表', value: '沒有', bad: dupNow > 0 },
  ] : [
    { label: 'PostgreSQL', value: mode === 'outbox' ? '掛號列 + outbox 列 同一交易' : '掛號列（應用程式不改）' },
    mode === 'outbox' ? { label: 'outbox → relay', value: '每 200 ms 掃一次', hot: true } : { label: 'WAL → CDC 連接器', value: '讀已 commit 的變更', hot: true },
    { label: '佇列', value: `丟 ${lostNow} · 幽靈 ${ghostNow}` },
    { label: '消費端 ×3', value: 'LINE / 報表 / 檢驗' },
    { label: '冪等鍵表', value: idemOn ? 'ON CONFLICT DO NOTHING' : '關閉', hot: idemOn, bad: !idemOn && dupNow > 0 },
  ]

  return (
    <Lab accent="red" kicker="SCENARIO LAB" title="掛號成功之後的事件：1,000 筆，三種送法"
         blurb="調整送事件失敗率、程序中途被砍的機率、消費端重複收到的比例，按「跑 1,000 筆掛號」看丟了幾筆、重複幾筆、有沒有幽靈事件（全部示意）。">
      <LabControls>
        <Seg label="做法" tinted value={mode} onChange={setMode} options={MODES} />
        {mode === 'dual' && <Seg label="publish 時機" value={when} onChange={setWhen} options={WHEN} />}
        {mode !== 'dual' && <Toggle label="消費端冪等鍵表" checked={idem} onChange={setIdem} />}
      </LabControls>
      <LabControls>
        <Slider label="送事件失敗率" min={0} max={20} value={failP} onChange={setFailP} format={(v) => `${v}%`} />
        <Slider label="程序中途被砍" min={0} max={10} value={crashP} onChange={setCrashP} format={(v) => `${v}%`} />
        <Slider label="消費端重複收到" min={0} max={20} value={dupP} onChange={setDupP} format={(v) => `${v}%`} />
      </LabControls>
      <LabGrid variant="wide">
        <div className="lab-stack ec-col">
          <LabControls>
            <button type="button" className="btn small" onClick={run}>{started ? '再跑 1,000 筆（換一組亂數）' : '跑 1,000 筆掛號'}</button>
            <span className="ec-count">{fmtN(done)} / {fmtN(N)}</span>
            <span className="spacer" />
            {lostNow + ghostNow > 0 ? <Status>不一致 {lostNow + ghostNow} 筆</Status> : <Status ok>DB 與事件一致</Status>}
            {dupNow > 0 ? <Status warn>重複生效 {dupNow}</Status> : <Status ok>沒有重複生效</Status>}
          </LabControls>
          <LabStage plain label="1,000 筆掛號的結果">
            <Flow title={`目前做法的流向（已處理 ${fmtN(done)} 筆，示意）`} ariaLabel="DB 到消費端的事件流向" steps={flowSteps}
                  back={mode === 'dual' && when === 'inside' && ghostNow > 0 ? `交易回滾但事件已送出：幽靈事件 ${ghostNow} 筆` : ''}
                  notes={[mode !== 'dual' && sim.dupDeliv > 0 && `佇列與 relay 重送是常態：重複送達 ${fmtN(sim.dupDeliv)} 份，${idemOn ? '冪等鍵表擋下所有重複效果' : '沒有冪等，每份都生效'}`]} />
            <svg className="ec-grid" viewBox="0 0 400 100" role="img" aria-label="1,000 筆掛號的結果方格，每格一筆">
              {sim.rows.map((f, i) => (
                <rect key={i} x={(i % 40) * 10 + 0.5} y={Math.floor(i / 40) * 4 + 0.5} width={9} height={3}
                      style={{ fill: i < done ? FATE_COLOR[f] : 'var(--hairline)' }} className={f === 'rollback' && i < done ? 'ec-rb' : ''} />
              ))}
            </svg>
            <div className="ec-legend">
              {Object.keys(FATE_LABEL).map((f) => <span key={f}><i style={{ background: FATE_COLOR[f] }} />{FATE_LABEL[f]} {count(f)}</span>)}
            </div>
            <div ref={chartRef}>
              <LineChart title="累計不一致（件）" xMax={steps} yMax={yMax} upto={k}
                         xTicks={[0, 8, 16, 24, 32]} fmtX={(i) => kfmt(i * BATCH)} fmtY={(v) => String(Math.round(v))}
                         width={chartW < 560 ? 320 : 640} height={chartW < 560 ? 128 : 150}
                         series={[
                           { key: 'lost', label: '丟事件', color: 'var(--critical)', values: sim.cum.lost },
                           { key: 'ghost', label: '幽靈', color: 'var(--c-magenta)', values: sim.cum.ghost },
                           { key: 'dup', label: '重複生效', color: 'var(--serious)', values: sim.cum.dup },
                         ]} />
            </div>
            <Caption>每格一筆掛號，40 × 25 格。4% 因時段已滿而回滾；publish 失敗有一半是「逾時但其實送到了」。亂數有固定種子，比例與延遲都是示意。</Caption>
          </LabStage>
          <Stats min={120}>
            <Stat label="丟掉的事件" value={lostNow} tone={lostNow ? 'bad' : 'ok'} note="檢驗系統少收" />
            <Stat label="幽靈事件" value={ghostNow} tone={ghostNow ? 'bad' : 'ok'} note="通知了不存在的掛號" />
            <Stat label="重複送達" value={fmtN(started && k < steps ? Math.round(sim.dupDeliv * k / steps) : sim.dupDeliv)} tone={sim.dupDeliv ? 'warn' : ''} note="消費端多收到的份數" />
            <Stat label="重複生效" value={dupNow} tone={dupNow ? 'bad' : 'ok'} note="LINE 寄兩次" />
            <Stat label="端到端延遲" value={`${Math.round(sim.p50)} / ${Math.round(sim.p95)}`} unit="ms" note="p50 / p95（示意）" />
          </Stats>
        </div>
        <div className="lab-stack ec-col">
          <LabExplain title={ex.title}>{ex.body.map((p, i) => <p key={i}>{p}</p>)}</LabExplain>
          <LabExplain title="怎麼讀">
            <p>三種做法吃同一組亂數：同一筆掛號在雙寫下被砍掉就丟了，在 outbox 下被砍掉就是整筆交易回滾（病患看到錯誤、重新掛號），不會出現「DB 有、事件沒有」。</p>
            <p>「重複送達」與「重複生效」要分開看：至少一次的系統一定會重複送達；只有消費端沒有冪等時，重複送達才會變成寄兩次。雙寫的現況沒有冪等鍵表。</p>
          </LabExplain>
          <Callout title="什麼時候會真的踩到">只要「寫資料庫」和「通知別人」是兩個系統的兩次寫入：寄信、推播、同步給另一個系統、更新搜尋索引或報表。平常 publish 幾乎不會失敗，所以一直沒事；直到部署時程序被砍、佇列短暫斷線、或逾時重試，才會出現少一筆或多一筆，而且很難從日誌裡看出來。</Callout>
        </div>
      </LabGrid>
      <style>{`
        .ec-col { min-width: 0; grid-template-columns: minmax(0, 1fr); }
        .ec-col > * { min-width: 0; }
        .ec-count { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--lab-accent); }
        .ec-grid { width: 100%; height: auto; display: block; margin-top: 12px; }
        .ec-grid rect { transition: fill 0.25s ease; }
        .ec-grid rect.ec-rb { stroke: var(--ink-3); stroke-width: 0.4; }
        .ec-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 0.74rem; color: var(--ink-2); margin: 6px 0 12px; }
        .ec-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; border: 1px solid var(--hairline); }
        @media (prefers-reduced-motion: reduce) { .ec-grid rect { transition: none; } }
      `}</style>
    </Lab>
  )
}

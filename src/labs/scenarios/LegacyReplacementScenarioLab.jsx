import React, { useEffect, useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Callout, Status, useTicker, Stats, Stat, LineChart, Caption, fmtN } from '../ui.jsx'

/* 舊系統替換情境模擬器：同一套舊系統（N 個功能模組），三種換法逐月推演。
   看已替換比例、切換日停機、行為差異在上線前還是上線後被發現、算錯的掛號、能不能回退、雙軌維護人力。
   可注入一條沒人知道的舊規則。全部是以「月」為單位的示意推算，不是量測值 */

const MODES = [
  { value: 'bigbang', label: '一次切換' },
  { value: 'strangler', label: '逐步替換' },
  { value: 'parallel', label: '並行比對後再切' },
]
const PER_MODULE = 4          // 每個模組的行為數（示意）
const READ_FOUND = 0.4        // 讀程式、資料與日誌，上線前能找出的未知行為比例
const SHADOW_FOUND = 0.9      // 並行比對能抓出剩餘差異的比例
const DAILY = 3000            // 每日掛號筆數
const WORK_DAYS = 22
const CANARY = 0.1            // 逐步替換：第一個月只放 10% 流量
const FIX = 1 / 3             // 每個月修掉三分之二的差異
const THRESHOLD = 0.1         // 並行比對的達標門檻（%）
const RULE_SHARE = 0.04       // 隱藏規則影響的掛號比例
const sum = (a) => a.reduce((x, y) => x + y, 0)

function simulate(mode, n, rate, undoc, diff, hidden) {
  const unknown = PER_MODULE * (undoc / 100)                 // 每個模組沒有文件的行為數
  const perMonth = DAILY * WORK_DAYS * (diff / 100)          // 全流量、未修正時每月算錯的掛號
  const h = Math.floor(n / 2)                                // 隱藏規則在第 h+1 塊
  const build = Math.ceil(n / rate)
  const shadowMonths = Math.max(1, Math.ceil(Math.log(diff / THRESHOLD) / Math.log(3)))
  const mods = Array.from({ length: n }, (_, i) => {
    const start = 2 + Math.floor(i / rate)                   // 第 1 個月先上入口層
    if (mode === 'bigbang') return { built: 1 + Math.floor(i / rate), live: build + 2 }
    if (mode === 'strangler') return { start, live: start, back: hidden && i === h }
    return { start, live: start + shadowMonths + (hidden && i === h ? 1 : 0) }
  })
  // 全部模組都全量走新系統的月份：逐步替換多一個月的部分流量，被切回去的那一塊再多一個月
  const done = Math.max(...mods.map((m) => m.live + (mode === 'strangler' ? (m.back ? 2 : 1) : 0)))
  const cut = build + 2                                      // 一次切換：開發完再加 2 個月整合測試與預演
  const decom = mode === 'bigbang' ? cut : done + 2          // 舊系統停用的月份
  const T = mode === 'bigbang' ? cut + 3 : decom
  const stateOf = (m, t) => {
    if (mode === 'bigbang') return t >= m.live ? 'new' : t >= m.built ? 'built' : 'old'
    if (t < m.start) return 'old'
    if (mode === 'parallel') return t >= m.live ? 'new' : 'shadow'
    if (t === m.live) return m.back ? 'back' : 'canary'
    if (m.back && t === m.live + 1) return 'canary'
    return 'new'
  }
  const rows = []
  let wrong = 0, effort = 0
  for (let t = 0; t <= T; t++) {
    const states = mods.map((m) => stateOf(m, t))
    const count = (s) => states.filter((x) => x === s).length
    let pre = 0, post = 0, wrongNow = 0
    mods.forEach((m, i) => {
      if (mode === 'bigbang') {
        pre += unknown * READ_FOUND * Math.min(1, t / cut)
        if (t >= cut) {                                       // 切換後三個月內，剩下的差異在全流量下陸續出現
          post += unknown * (1 - READ_FOUND) * [0.7, 0.9, 1][Math.min(2, t - cut)]
          wrongNow += (perMonth / n) * FIX ** (t - cut)
        }
      } else if (mode === 'strangler') {
        if (t >= m.start) {                                   // 差異在放量的那個月出現，但只有那一塊、那個比例
          pre += unknown * READ_FOUND
          post += unknown * (1 - READ_FOUND)
        }
        const age = t - m.live - (m.back ? 1 : 0)
        if (age >= 0 && states[i] !== 'back') wrongNow += (perMonth / n) * (age === 0 ? CANARY : FIX ** age)
      } else {
        if (t >= m.start) {                                   // 並行期間逐月把剩下的差異抓出來
          const progress = Math.min(1, (t - m.start + 1) / shadowMonths)
          pre += unknown * (READ_FOUND + (1 - READ_FOUND) * SHADOW_FOUND * progress)
        }
        if (t >= m.live) {
          post += unknown * (1 - READ_FOUND) * (1 - SHADOW_FOUND)
          wrongNow += (perMonth / n) * FIX ** (shadowMonths + t - m.live)
        }
      }
    })
    let ruleHit = 0
    if (hidden) {
      const m = mods[h]
      if (mode === 'parallel') {
        if (t >= m.start) pre += 1                            // 比對紀錄裡就看得到，沒有掛號受影響
      } else if (t >= m.live) {
        post += 1                                             // 一次切換：全流量、5 天後才修好；逐步替換：10% 流量、當天切回
        ruleHit = mode === 'bigbang' ? DAILY * RULE_SHARE * 5 : DAILY * RULE_SHARE * CANARY
      }
    }
    wrong += wrongNow
    if (t >= 1 && t < decom) effort += mode === 'bigbang' ? 0.5 : 1.3 + (count('shadow') ? 0.7 : 0)
    const newShare = (count('new') + CANARY * count('canary')) / n
    rows.push({
      t, states, newShare, effort,
      live: count('new'), built: count('built'), shadow: count('shadow'), canary: count('canary'),
      partial: count('canary') + count('shadow') + count('back'),
      pre: Math.round(pre), post: Math.round(post), wrong: Math.round(wrong), ruleHit: Math.round(ruleHit),
    })
  }
  return {
    rows, T, cut, done, decom, h, shadowMonths, mods,
    downtime: mode === 'bigbang' ? Math.round(6 + n * 0.5) : 0,   // 一次搬完所有資料：模組越多停越久
    total: Math.round(n * unknown) + (hidden ? 1 : 0),
  }
}

function rollbackAt(mode, sim, t) {
  if (mode === 'bigbang') {
    if (t < sim.cut) return { v: '—', note: '還沒切換' }
    if (t === sim.cut) return { v: '很難', note: '開診前可還原備份；開診後的新資料回不去', tone: 'bad' }
    return { v: '不能', note: '舊系統已停，只能往前修', tone: 'bad' }
  }
  if (t >= sim.decom) return { v: '不能', note: '舊系統已停用（回退期限已過）' }
  if (t < 1) return { v: '—', note: '還沒開始' }
  return { v: '可以', note: '把路由改回舊系統，約 5 分鐘', tone: 'ok' }
}

function noteAt(mode, sim, r, n, rate, hidden) {
  const t = r.t, no = sim.h + 1
  if (t === 0) return `現況：${n} 塊功能都在舊系統。`
  if (mode === 'bigbang') {
    if (t < sim.cut - 2) return `開發中：新系統寫好 ${r.built} / ${n} 塊，但沒有任何一塊被真實使用過。舊系統這個月的修改，要在新系統再做一次。`
    if (t < sim.cut) return '整合測試與切換預演：照規格書寫的測試都通過。沒寫進規格的行為，測試也測不到。'
    if (t === sim.cut) {
      const rule = hidden ? `；第 ${no} 塊那條沒人知道的規則，算錯約 ${fmtN(r.ruleHit)} 筆掛號後才被櫃台發現` : ''
      return `切換週末：停機 ${sim.downtime} 小時搬資料、切換連線，週一全院改用新系統。沒發現的差異開始在全流量下出現${rule}。`
    }
    return `上線後第 ${t - sim.cut} 個月：一邊修差異一邊服務全院。舊系統已經停了，不能切回去。`
  }
  if (t === 1) {
    return mode === 'strangler'
      ? '入口層上線：所有請求先經過它，原封不動轉給舊系統。這一步要先穩定，之後才有地方改規則。'
      : '入口層與比對機制上線：請求可以複製一份給新系統，回應一律用舊系統的。'
  }
  if (t >= sim.decom) return '舊系統停用：入口層紀錄顯示它已經沒有流量、對帳一致、回退期限已過。之後不能再切回去。'
  if (t >= sim.done) return '全部模組都由新系統回應，舊系統待命。等月結跑過、確認沒有任何流量再停用。'
  const m = sim.mods[sim.h]
  if (mode === 'strangler') {
    if (hidden && t === m.live) return `第 ${no} 塊放 10% 流量後，約 ${fmtN(r.ruleHit)} 筆掛號費算錯：舊系統有一條沒人知道的規則。把規則改回舊系統，下個月補好再切。`
    return `這個月 ${r.canary} 塊開始走新系統（先放 10% 流量），累計 ${r.live} 塊已全量；每月最多換 ${rate} 塊。`
  }
  if (hidden && t === m.start) return `第 ${no} 塊的比對紀錄出現一種固定的差異：舊系統有一條沒人知道的規則。使用者拿到的仍是舊結果，沒有掛號受影響；這一塊多比對一個月。`
  return `${r.shadow} 塊並行比對中（兩邊都跑、只回舊的），累計 ${r.live} 塊已切換；每塊比對 ${sim.shadowMonths} 個月，差異率低於 ${THRESHOLD}% 才切。`
}

const EXPLAIN = {
  bigbang: { title: '一次切換：沒有並存期，風險都壓在同一天', body: [
    '不需要入口層、資料同步與雙軌維護，這是它省事的地方。代價是全部做完才上線，之前新系統沒有任何一塊被真實流量驗證過。',
    '讀程式與資料找不出來的差異，全部在切換後、全流量下出現。開診後新系統已經有新資料，退回舊系統等於再搬一次資料。把模組數或沒文件的比例拉高，看「上線後發現」與「算錯的掛號」怎麼變。',
  ] },
  strangler: { title: '逐步替換：每次只換幾塊，隨時能改回去', body: [
    '入口層讓每次切換只是改一條規則：先放 10% 流量，沒問題再全量。差異還是上線後才看到，但範圍限於那一塊、那個比例，而且幾分鐘內能切回舊系統。',
    '代價是新舊並存的整段期間都要維護資料同步與入口層規則，舊系統的修改也要做兩次。每月能換的塊數越少，並存期越長。',
  ] },
  parallel: { title: '並行比對後再切：把「上線後發現」搬到上線前', body: [
    '每一塊做好後先兩邊都跑、只回舊的結果，差異率降到門檻以下才切。大部分沒文件的行為在這段期間被真實流量抓出來，使用者不受影響。',
    '代價是每一塊多一段並行期，總時程最長，還要有人每天看差異並歸類。差異率越高，並行期越長；會寫入或有外部副作用的功能也很難直接比對。',
  ] },
}
const TILE = { old: '舊系統', built: '已寫好、未上線', shadow: '並行比對中', canary: '部分流量', back: '切回舊系統', new: '新系統' }
const PARTIAL = { bigbang: '已寫好未上線', strangler: '部分流量', parallel: '並行比對中' }
const POST_NOTE = { bigbang: '全流量下出現', strangler: '小流量下出現', parallel: '並行比對漏掉的' }
const EFFORT_NOTE = { bigbang: '舊系統的修改在新系統重做', strangler: '同步、入口層、修改做兩次', parallel: '同步、入口層、比對與歸類' }
const LEGEND = { bigbang: ['old', 'built', 'new'], strangler: ['old', 'canary', 'back', 'new'], parallel: ['old', 'shadow', 'new'] }

export default function LegacyReplacementScenarioLab() {
  const [mode, setMode] = useState('bigbang')
  const [n, setN] = useState(24)
  const [rate, setRate] = useState(3)
  const [undoc, setUndoc] = useState(30)
  const [diff, setDiff] = useState(2)
  const [hidden, setHidden] = useState(false)
  const [running, setRunning] = useState(false)
  const sim = useMemo(() => simulate(mode, n, rate, undoc, diff, hidden), [mode, n, rate, undoc, diff, hidden])
  const [tick, resetTick] = useTicker(running, Math.max(110, Math.round(5000 / sim.T)))
  useEffect(() => { if (tick >= sim.T) setRunning(false) }, [tick, sim.T])
  const t = running ? Math.min(sim.T, tick) : sim.T
  const [scrub, setScrub] = useState(null)             // 游標移到圖上：看任一個月
  const shown = Math.min(sim.T, scrub ?? t)
  const r = sim.rows[shown]
  const end = sim.rows[sim.T]
  const rb = rollbackAt(mode, sim, shown)
  const ex = EXPLAIN[mode]
  const hits = sim.rows.slice(0, shown + 1).reduce((a, x) => Math.max(a, x.ruleHit), 0)   // 隱藏規則算錯的掛號（發生之後才計入）
  const wrong = r.wrong + hits
  const chart = { xMax: sim.T, upto: t, mark: scrub, onScrub: setScrub, fmtX: (m) => `${m}` }
  const play = () => { resetTick(); setScrub(null); setRunning(true) }
  const pct = (v) => `${Math.round(v * 100)}%`

  return (
    <Lab accent="violet" kicker="SCENARIO LAB" title="同一套舊系統，三種換法：差異在上線前還是上線後被發現"
         blurb="逐月的替換進度、停機、行為差異何時被發現、能不能回退，以及雙軌維護要多少人力。">
      <LabControls>
        <Seg label="做法" tinted value={mode} onChange={setMode} options={MODES} />
        <Slider label="功能模組數" min={8} max={40} step={2} value={n} onChange={setN} format={(v) => `${v} 塊`} />
        <Slider label="每月能替換" min={1} max={6} value={rate} onChange={setRate} format={(v) => `${v} 塊`} />
        <Slider label="沒有文件的行為" min={0} max={60} step={5} value={undoc} onChange={setUndoc} format={(v) => `${v}%`} />
        <Slider label="並行期的差異率" min={0.2} max={10} step={0.2} value={diff} onChange={setDiff} format={(v) => `${v.toFixed(1)}%`} />
        <Toggle label="注入：一條沒人知道的規則" checked={hidden} onChange={setHidden} />
      </LabControls>
      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabControls>
            <button type="button" className="btn small" onClick={play}>{running ? '重新開始' : '開始遷移'}</button>
            <span className="muted">第 {shown} / {sim.T} 個月</span>
            <span className="spacer" />
            {end.post > 0 ? <Status warn>上線後才發現 {end.post} 件差異</Status> : <Status ok>沒有上線後才發現的差異</Status>}
            {sim.downtime > 0 ? <Status>切換日停機 {sim.downtime} 小時</Status> : <Status ok>不停機</Status>}
          </LabControls>
          <LabStage plain label="模組狀態與逐月走勢">
            <div className="lr-tiles" role="img" aria-label={`第 ${shown} 個月：${r.live} 塊在新系統，${r.partial} 塊過渡中，其餘在舊系統`}>
              {r.states.map((s, i) => (
                <span key={i} className={`lr-tile lr-${s}`} title={`第 ${i + 1} 塊：${TILE[s]}`}>{hidden && i === sim.h ? '!' : i + 1}</span>
              ))}
            </div>
            <div className="lr-legend">
              {LEGEND[mode].map((s) => <span key={s}><i className={`lr-tile lr-${s}`} />{TILE[s]}</span>)}
              {hidden && <span><i className="lr-tile lr-old">!</i>藏著隱藏規則的那一塊</span>}
            </div>
            <div className="lr-split" role="img" aria-label={`流量分配：舊系統 ${pct(1 - r.newShare)}，新系統 ${pct(r.newShare)}`}>
              <span className="lr-split-old" style={{ flexGrow: Math.max(0.0001, 1 - r.newShare) }}>{r.newShare < 0.85 && `舊系統 ${pct(1 - r.newShare)}`}</span>
              <span className="lr-split-new" style={{ flexGrow: Math.max(0.0001, r.newShare) }}>{r.newShare >= 0.15 && `新系統 ${pct(r.newShare)}`}</span>
            </div>
            <Caption>{mode === 'bigbang' ? '沒有入口層：切換那個週末把所有連線一次改到新系統' : '入口層的流量分配'}（假設每塊流量相同，示意）</Caption>
            <div className="lr-charts">
              <LineChart {...chart} title="模組（塊，x 軸：月）" yMax={n} fmtY={(v) => `${Math.round(v)}`}
                         series={[
                           { key: 'live', label: '已替換', color: 'var(--c-green)', values: sim.rows.map((x) => x.live) },
                           { key: 'part', label: PARTIAL[mode], color: 'var(--c-orange)', values: sim.rows.map((x) => (mode === 'bigbang' ? x.built : x.partial)) },
                         ]} />
              <LineChart {...chart} title="行為差異（累計，件）" yMax={Math.max(4, sim.total)} fmtY={(v) => `${Math.round(v)}`}
                         series={[
                           { key: 'pre', label: '上線前發現', color: 'var(--c-blue)', values: sim.rows.map((x) => x.pre) },
                           { key: 'post', label: '上線後發現', color: 'var(--critical)', values: sim.rows.map((x) => x.post) },
                         ]} />
            </div>
            <Caption>每塊 {PER_MODULE} 個行為，其中 {undoc}% 沒有文件；讀程式與資料能先找出 {READ_FOUND * 100}%，並行比對再抓出剩下的 {SHADOW_FOUND * 100}%（全部示意；游標移到圖上可看任一個月）</Caption>
          </LabStage>
          <Stats min={132}>
            <Stat label="已替換" value={pct(r.live / n)} note={`${r.live} / ${n} 塊${r.partial ? `，另 ${r.partial} 塊過渡中` : ''}`} tone={r.live === n ? 'ok' : ''} />
            <Stat label="切換日停機" value={sim.downtime ? `${sim.downtime} h` : '0'} note={sim.downtime ? `第 ${sim.cut} 個月的週末，一次` : '每次切換只改路由'} tone={sim.downtime ? 'warn' : 'ok'} />
            <Stat label="差異：上線前發現" value={`${r.pre} 件`} note={`沒文件的行為共約 ${sim.total} 件`} />
            <Stat label="差異：上線後發現" value={`${r.post} 件`} note={POST_NOTE[mode]}
                  tone={r.post > sim.total * 0.3 ? 'bad' : r.post > 0 ? 'warn' : 'ok'} />
            <Stat label="算錯的掛號（累計）" value={fmtN(wrong)} unit="筆" note={hits ? `含隱藏規則 ${fmtN(hits)} 筆` : '被發現並修正之前'}
                  tone={wrong > 2000 ? 'bad' : wrong > 200 ? 'warn' : ''} />
            <Stat label="能不能回退" value={rb.v} note={rb.note} tone={rb.tone} />
            <Stat label="雙軌維護（累計）" value={r.effort.toFixed(1)} unit="人月" note={EFFORT_NOTE[mode]} />
          </Stats>
          <Caption>算錯的掛號：每日 {fmtN(DAILY)} 筆、每月 {WORK_DAYS} 天，全流量時有 {diff.toFixed(1)}% 結果不同，每個月修掉三分之二；逐步替換第一個月只放 {CANARY * 100}% 流量；並行比對降到 {THRESHOLD}% 才切（全部示意）</Caption>
        </div>
        <div className="lab-stack">
          <LabExplain title={ex.title}>{ex.body.map((p, i) => <p key={i}>{p}</p>)}</LabExplain>
          <LabExplain title={`第 ${shown} 個月`}><p>{noteAt(mode, sim, r, n, rate, hidden)}</p></LabExplain>
          <Callout title="什麼時候會踩到">舊系統用了十幾年，規則一部分在預存程序和排程批次裡，寫的人已經離開；規格書是訪談出來的，不是從程式還原的；某個身分別免掛號費、某個診間週三下午不開放預約，這類規則只有櫃台資深人員記得。三種做法都會遇到這些差異，差別在於它出現時有多少流量在新系統上，以及當下能不能切回去。</Callout>
        </div>
      </LabGrid>
      <style>{`
        .lr-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(30px, 1fr)); gap: 4px; }
        .lr-tile { display: inline-flex; align-items: center; justify-content: center; height: 26px; min-width: 0; border-radius: 4px; border: 1px solid var(--hairline); background: var(--surface-2); color: var(--ink-3); font-family: var(--mono); font-size: 0.68rem; transition: background 0.25s ease, border-color 0.25s ease, color 0.25s ease; }
        .lr-tile.lr-built { border-style: dashed; border-color: var(--ink-3); color: var(--ink-2); }
        .lr-tile.lr-shadow { border-color: var(--c-orange); box-shadow: inset 0 0 0 1px var(--c-orange); color: var(--ink-1); }
        .lr-tile.lr-canary { border-color: var(--good); box-shadow: inset 0 0 0 1px var(--good); color: var(--ink-1); }
        .lr-tile.lr-back { border-color: var(--critical); box-shadow: inset 0 0 0 1px var(--critical); color: var(--critical); font-weight: 700; }
        .lr-tile.lr-new { background: var(--good); border-color: var(--good); color: var(--surface-1); font-weight: 700; }
        .lr-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; font-size: 0.72rem; color: var(--ink-3); }
        .lr-legend span { display: inline-flex; align-items: center; gap: 5px; }
        .lr-legend .lr-tile { width: 16px; height: 14px; font-size: 0.6rem; }
        .lr-split { display: flex; height: 24px; margin-top: 12px; border-radius: 4px; overflow: hidden; border: 1px solid var(--hairline); font-size: 0.72rem; }
        .lr-split span { flex: 1 1 0; min-width: 0; display: flex; align-items: center; justify-content: center; white-space: nowrap; overflow: hidden; transition: flex-grow 0.3s ease; }
        .lr-split-old { background: var(--surface-2); color: var(--ink-2); }
        .lr-split-new { background: var(--good); color: var(--surface-1); font-weight: 700; }
        .lr-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
        @media (max-width: 560px) { .lr-charts { grid-template-columns: 1fr; } }
      `}</style>
    </Lab>
  )
}

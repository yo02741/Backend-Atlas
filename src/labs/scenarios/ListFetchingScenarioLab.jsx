import React, { useEffect, useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Callout, Status, Stats, Stat, Caption, useTicker, fmtMs } from '../ui.jsx'

/* 預約清單怎麼抓的情境模擬器：同一段 180 秒的櫃台操作（進清單、看詳細、換日期、新增掛號、切到別的分頁），
   三種抓法並排成三條時間帶：Skeleton、最新、舊資料、剛新增的那筆不見了。
   伺服器的資料在 70 s（自己新增）、90 s（別的櫃台取消）、140 s（線上掛號）改變。全部是示意推算。 */

/* 說明文字裡的 `程式碼` 轉成 <code> */
const ic = (s) => String(s).split(/`([^`]+)`/).map((p, i) => (i % 2 ? <code key={i}>{p}</code> : p))

const T_END = 180
const DT = 0.5
const SCRIPT = [
  { t: 0, a: 'mount', label: '進清單' },
  { t: 20, a: 'leave', label: '點進詳細頁', where: '在病患詳細頁' },
  { t: 35, a: 'mount', label: '回清單' },
  { t: 42, a: 'date', d: '11/21', label: '換到 11/21' },
  { t: 46, a: 'date', d: '11/20', label: '換回 11/20' },
  { t: 50, a: 'leave', label: '開新增表單', where: '在新增掛號表單' },
  { t: 70, a: 'mutate', label: '送出新增（伺服器 +1 筆）' },
  { t: 72, a: 'mount', label: '回清單' },
  { t: 90, a: 'server', label: '別的櫃台取消一筆' },
  { t: 100, a: 'leave', label: '點進詳細頁', where: '在病患詳細頁' },
  { t: 110, a: 'mount', label: '回清單' },
  { t: 125, a: 'hide', label: '切到別的分頁', where: '分頁在背景' },
  { t: 140, a: 'server', label: '病患線上掛號' },
  { t: 165, a: 'focus', label: '切回來' },
]
const ver = (d, t) => (d !== '11/20' ? 0 : t < 70 ? 0 : t < 90 ? 1 : t < 140 ? 2 : 3)
const ROWS = [
  { text: '09:00 王○明', from: 0 },
  { text: '09:20 張○華', from: 0, to: 2 },
  { text: '09:40 李○芬', from: 0 },
  { text: '10:30 林○○', from: 1, own: true },
  { text: '11:00 陳○宇（線上）', from: 3 },
]
const ROWS_1121 = ['08:30 吳○婷', '09:10 周○傑']
const rowsFor = (v) => ROWS.filter((r) => v >= r.from && (r.to == null || v < r.to))

const KINDS = [
  { value: 'refetch', label: '每次進頁重抓' },
  { value: 'store', label: 'Pinia store 快取' },
  { value: 'swr', label: 'stale-while-revalidate' },
]

function simulate(kind, L, S, inv) {
  let page = 'list', date = '11/20', mountId = 0, shown = null, slot = null, pending = [], req = 0
  const cache = {}
  const ev = [...SCRIPT]
  const steps = []
  const send = (d, t, bg, count = 1) => {
    if (kind !== 'refetch' && pending.some((p) => p.d === d)) return     // 同一份資料正在抓：共用
    pending.push({ d, v: ver(d, t), done: t + L, bg, mount: mountId })
    req += count
  }
  const ensure = (t) => {
    if (kind === 'store') {
      if (slot && slot.d === date && t - slot.at < S && !slot.invalid) shown = { d: date, v: slot.v }
      else { shown = null; send(date, t, false) }                        // 過期或日期不同：重新載入，畫面 Skeleton
    } else {
      const c = cache[date]
      if (c) { shown = { d: date, v: c.v }; if (t - c.at >= S || c.invalid) send(date, t, true) }   // 先顯示快取
      else { shown = null; send(date, t, false) }
    }
  }
  for (let i = 0; i <= T_END / DT; i++) {
    const t = i * DT
    const done = pending.filter((p) => p.done <= t + 1e-9)
    pending = pending.filter((p) => p.done > t + 1e-9)
    for (const p of done) {
      if (kind === 'refetch') { if (p.mount === mountId && page !== 'away' && p.d === date) shown = { d: p.d, v: p.v } }
      else {
        if (kind === 'store') slot = { d: p.d, v: p.v, at: t, invalid: false }
        else cache[p.d] = { v: p.v, at: t, invalid: false }
        if (page === 'list' && date === p.d) shown = { d: p.d, v: p.v }
      }
    }
    while (ev.length && ev[0].t <= t + 1e-9) {
      const e = ev.shift()
      if (e.a === 'mount') { page = 'list'; mountId++; if (kind === 'refetch') { shown = null; send(date, t, false, 2) } else ensure(t) }
      else if (e.a === 'date') { date = e.d; if (kind === 'refetch') { shown = null; send(date, t, false) } else ensure(t) }
      else if (e.a === 'leave') { page = 'away'; if (kind === 'refetch') shown = null }
      else if (e.a === 'hide') page = 'hidden'
      else if (e.a === 'focus') {
        page = 'list'
        const c = cache[date]
        if (kind === 'swr' && c && (t - c.at >= S || c.invalid)) send(date, t, true)
      } else if (e.a === 'mutate' && inv) {
        if (kind === 'store' && slot) slot.invalid = true
        if (kind === 'swr') Object.values(cache).forEach((c) => { c.invalid = true })
      }
    }
    let k
    if (page !== 'list') k = 'away'
    else if (!shown) k = 'skel'
    else if (shown.v >= ver(date, t)) k = 'fresh'
    else if (date === '11/20' && t >= 72 && shown.v < 1) k = 'missing'
    else k = 'stale'
    steps.push({ t, k, shown, date, bg: pending.some((p) => p.bg) })
  }
  const secs = (pred) => steps.filter(pred).length * DT
  let streak = 0, longest = 0
  for (const s of steps) { streak = s.k === 'stale' || s.k === 'missing' ? streak + DT : 0; longest = Math.max(longest, streak) }
  const segs = []
  for (const s of steps) {
    const last = segs[segs.length - 1]
    if (last && last.k === s.k) last.to = s.t + DT
    else segs.push({ k: s.k, from: s.t, to: s.t + DT })
  }
  return {
    steps, segs, req, longest,
    skel: secs((s) => s.k === 'skel'), stale: secs((s) => s.k === 'stale' || s.k === 'missing'), missing: secs((s) => s.k === 'missing'),
  }
}

const KLABEL = { fresh: '最新', stale: '舊資料', missing: '少了剛新增的', skel: 'Skeleton', away: '不在清單頁' }
const EXPLAIN = {
  refetch: { title: '每次重抓：資料新，但一直在等', body: ['每次回到清單、每次換日期都從 Skeleton 開始，頁首徽章與清單各打一次同樣的請求。資料一定是進頁那一刻的，自己新增的那一筆也一定看得到。', '停在清單頁的時候不會更新：別的櫃台取消的那一筆、背景期間的線上掛號，都要等下一次進頁。'] },
  store: { title: 'store 快取：回來很快，但什麼時候該重抓要自己決定', body: ['過期時間內回到清單直接顯示 store 的資料，不打 API。過期就重新載入；常見的寫法只存一份清單，換到 11/21 再換回來，兩次都是 Skeleton。', '送出新增後沒有讓 store 失效，回到清單看到的還是新增前的那一份，剛新增的掛號不見了，直到過期為止。打開「新增後讓清單失效」看差別。'] },
  swr: { title: 'stale-while-revalidate：先顯示快取，背景換新', body: ['有快取就先顯示，超過 staleTime 才在背景重抓，回來的資料直接換上，不閃 Skeleton。每個日期各有一份快取，11/20 換回來是瞬間的；切回分頁時也會重抓過期的資料。', 'staleTime 調大，請求變少，但新增後沒有 invalidate 時，快取還「新鮮」就不會重抓，一樣看不到剛新增的那一筆。', '即使有 invalidate，背景重抓回來之前畫面仍是新增前的清單（約一個 API 延遲）；要連這段都不缺，在新增成功時用回應的資料 `setQueryData` 先放進快取。'] },
}

export default function ListFetchingScenarioLab() {
  const [kind, setKind] = useState('swr')
  const [lat, setLat] = useState(1000)
  const [stale, setStale] = useState(30)
  const [inv, setInv] = useState(false)
  const [t, setT] = useState(T_END)
  const [running, setRunning] = useState(false)
  const [tick, resetTick] = useTicker(running, 60)
  useEffect(() => {
    if (!running) return
    const nt = Math.min(T_END, tick)
    setT(nt)
    if (nt >= T_END) setRunning(false)
  }, [tick, running])

  const sims = useMemo(() => Object.fromEntries(KINDS.map((k) => [k.value, simulate(k.value, lat / 1000, stale, inv)])), [lat, stale, inv])
  const sim = sims[kind]
  const step = sim.steps[Math.min(sim.steps.length - 1, Math.round(t / DT))]
  const where = [...SCRIPT].reverse().find((e) => e.t <= t && (e.a === 'leave' || e.a === 'hide'))?.where
  const lastEv = SCRIPT.filter((e) => e.t <= t).length - 1
  const play = () => { resetTick(); setT(0); setRunning(true) }
  const ex = EXPLAIN[kind]
  const rows = step.shown ? (step.shown.d === '11/20' ? rowsFor(step.shown.v) : ROWS_1121.map((text) => ({ text }))) : []
  const pct = (x) => `${(x / T_END) * 100}%`

  return (
    <Lab accent="green" kicker="SCENARIO LAB" title="同一段櫃台操作，三種抓法：誰在等、誰顯示舊資料"
         blurb="180 秒的操作壓成一條時間帶；伺服器的資料在 70 s、90 s、140 s 改變（示意）。">
      <LabControls>
        <Seg label="做法" tinted value={kind} onChange={setKind} options={KINDS} />
        <Slider label="API 延遲" min={200} max={3000} step={200} value={lat} onChange={setLat} format={fmtMs} />
        <Slider label="多久算舊（過期時間 / staleTime）" min={0} max={120} step={10} value={stale} onChange={setStale} format={(v) => `${v} 秒`} />
        <Toggle label="新增後讓清單失效（invalidate）" checked={inv} onChange={setInv} />
      </LabControls>
      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabControls>
            <button type="button" className="btn small" onClick={play} disabled={running}>{running ? '播放中…' : '▶ 播放這 180 秒'}</button>
            <Slider label="時間點" min={0} max={T_END} value={t} onChange={(v) => { setRunning(false); setT(v) }} format={(v) => `${v} s`} />
          </LabControls>
          <LabStage label="三種抓法的時間帶">
            <div className="lf-bands">
              <div className="lf-ruler" aria-hidden="true">
                {SCRIPT.map((e, i) => <i key={i} className={i === lastEv ? 'on' : ''} style={{ left: pct(e.t) }} />)}
              </div>
              {KINDS.map((k) => (
                <button type="button" key={k.value} className={`lf-band${k.value === kind ? ' sel' : ''}`} onClick={() => setKind(k.value)} aria-label={`${k.label}的時間帶`}>
                  <span className="lf-name">{k.label}<small>請求 {sims[k.value].req} · Skeleton {sims[k.value].skel} s · 舊資料 {sims[k.value].stale} s</small></span>
                  <span className="lf-strip">
                    {sims[k.value].segs.map((s, i) => <span key={i} className={`lf-seg ${s.k}`} style={{ flexGrow: s.to - s.from }} title={`${s.from}–${s.to} s：${KLABEL[s.k]}`} />)}
                    <i className="lf-head" style={{ left: pct(t) }} />
                  </span>
                </button>
              ))}
              <div className="lf-legend">{Object.entries(KLABEL).map(([k, l]) => <span key={k}><i className={`lf-seg ${k}`} />{l}</span>)}</div>
            </div>
            <ol className="lf-script">
              {SCRIPT.map((e, i) => <li key={i} className={i === lastEv ? 'on' : ''}><b>{e.t}s</b> {e.label}</li>)}
            </ol>
          </LabStage>
          <div className="lf-screen" aria-label="這個時間點的畫面">
            <div className="lf-screen-head">
              <b>預約清單 {step.date}</b>
              {step.k !== 'away' && step.shown && step.shown.d === '11/20' && <span className="lf-badge">今日 {rows.length} 筆</span>}
              {step.bg && step.k !== 'away' && <span className="lf-pill">更新中…</span>}
              <span className="spacer" />
              <span className="muted">t = {t} s</span>
            </div>
            {step.k === 'away' && <p className="muted lf-away">（{where || '不在清單頁'}）</p>}
            {step.k === 'skel' && <div className="lf-skel" aria-label="Skeleton">{[0, 1, 2].map((i) => <i key={i} />)}</div>}
            {step.k !== 'away' && step.k !== 'skel' && (
              <ul className="lf-rows">
                {rows.map((r) => <li key={r.text} className={r.own ? 'own' : ''}>{r.text}{r.own && <small>剛新增</small>}</li>)}
              </ul>
            )}
            {step.k === 'missing' && <p className="lf-warn">剛新增的「10:30 林○○」不在清單上</p>}
            {step.k === 'stale' && <p className="lf-note">畫面上的是舊資料，伺服器已經改了</p>}
          </div>
          <Stats min={130}>
            <Stat label="送出的請求" value={sim.req} note={kind === 'refetch' ? '徽章與清單各打一次' : '同一份資料共用請求'} />
            <Stat label="看 Skeleton" value={`${sim.skel} s`} tone={sim.skel > 5 ? 'warn' : ''} />
            <Stat label="顯示舊資料" value={`${sim.stale} s`} note={`最長一次 ${sim.longest} s`} tone={sim.longest > 60 ? 'bad' : ''} />
            <Stat label="少了剛新增的那筆" value={`${sim.missing} s`} tone={sim.missing === 0 ? 'ok' : sim.missing <= lat / 1000 ? 'warn' : 'bad'} />
          </Stats>
          <Caption>只計算清單在畫面上的時間；請求數不含送出新增的 POST（示意）。點時間帶可以切換做法。</Caption>
        </div>
        <div className="lab-stack">
          <LabExplain title={ex.title}>{ex.body.map((p, i) => <p key={i}>{ic(p)}</p>)}</LabExplain>
          {sim.missing === 0 ? <Status ok>回到清單就看得到剛新增的掛號</Status>
            : sim.missing <= lat / 1000 ? <Status warn>背景更新回來前的 {sim.missing} s 還是新增前的清單</Status>
            : <Status>回到清單時少了剛新增的掛號 {sim.missing} s</Status>}
          <Callout title="什麼時候會踩到">加了快取之後最常見的回報是「我剛新增的掛號不見了」：快取還沒過期、新增後又沒有讓它失效。另一個是只存一份清單的 store，在日期之間切換時把另一天的資料當成這一天的。</Callout>
        </div>
      </LabGrid>
      <style>{`
        .lf-bands { display: grid; gap: 8px; position: relative; }
        .lf-ruler { position: relative; height: 8px; margin: 0 0 -2px; }
        .lf-ruler i { position: absolute; top: 0; width: 2px; height: 8px; background: var(--ink-3); transform: translateX(-1px); }
        .lf-ruler i.on { background: var(--ink-1); height: 10px; }
        .lf-band { display: grid; gap: 4px; text-align: left; background: none; border: none; padding: 4px 0; cursor: pointer; font: inherit; color: inherit; min-width: 0; }
        .lf-name { font-size: 0.8rem; font-weight: 700; color: var(--ink-2); display: flex; flex-wrap: wrap; gap: 2px 10px; align-items: baseline; }
        .lf-name small { font-weight: 500; font-family: var(--mono); font-size: 0.7rem; color: var(--ink-3); }
        .lf-band.sel .lf-name { color: var(--ink-1); }
        .lf-strip { position: relative; display: flex; height: 18px; border: 1.5px solid var(--hairline); border-radius: 6px; overflow: hidden; background: var(--surface-1); }
        .lf-band.sel .lf-strip { border: 2px solid var(--line); box-shadow: 2px 2px 0 var(--shade); }
        .lf-seg { display: block; min-width: 0; }
        .lf-seg.fresh { background: color-mix(in srgb, var(--good) 55%, var(--surface-1)); }
        .lf-seg.stale { background: var(--serious); }
        .lf-seg.missing { background: var(--critical); }
        .lf-seg.skel { background: var(--st-blue); }
        .lf-seg.away { background: var(--surface-2); }
        .lf-head { position: absolute; top: -2px; bottom: -2px; width: 2px; background: var(--ink-1); transform: translateX(-1px); }
        .lf-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 0.72rem; color: var(--ink-3); }
        .lf-legend span { display: inline-flex; align-items: center; gap: 5px; }
        .lf-legend .lf-seg { width: 14px; height: 10px; border-radius: 2px; border: 1px solid var(--hairline); }
        .lf-script { list-style: none; display: flex; flex-wrap: wrap; gap: 3px 12px; margin-top: 10px; font-size: 0.72rem; color: var(--ink-3); }
        .lf-script b { font-family: var(--mono); font-weight: 600; }
        .lf-script li.on { color: var(--ink-1); font-weight: 700; }
        .lf-screen { border: var(--bw) solid var(--line); border-radius: 12px; background: var(--surface-1); box-shadow: 4px 4px 0 var(--shade); padding: 10px 14px; min-height: 150px; }
        .lf-screen-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: 0.84rem; margin-bottom: 8px; }
        .lf-screen-head .spacer { flex: 1; }
        .lf-screen-head .muted { font-family: var(--mono); font-size: 0.72rem; }
        .lf-badge { font-size: 0.7rem; font-weight: 700; padding: 1px 8px; border-radius: 999px; border: 1.5px solid var(--line); background: var(--st-mint); color: var(--on-sticker); }
        .lf-pill { font-size: 0.7rem; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--border); color: var(--ink-2); }
        .lf-skel { display: grid; gap: 6px; }
        .lf-skel i { display: block; height: 18px; border-radius: 4px; background: var(--surface-2); }
        .lf-rows { list-style: none; display: grid; gap: 4px; }
        .lf-rows li { font-family: var(--mono); font-size: 0.78rem; padding: 3px 8px; border: 1px solid var(--hairline); border-radius: 6px; display: flex; justify-content: space-between; gap: 8px; }
        .lf-rows li.own { border-color: var(--good); }
        .lf-rows li small { color: var(--good); font-family: var(--sans); font-weight: 700; }
        .lf-away { font-size: 0.82rem; padding: 18px 0; text-align: center; }
        .lf-warn { color: var(--critical); font-size: 0.8rem; font-weight: 700; margin-top: 6px; }
        .lf-note { color: var(--serious); font-size: 0.8rem; font-weight: 600; margin-top: 6px; }
      `}</style>
    </Lab>
  )
}

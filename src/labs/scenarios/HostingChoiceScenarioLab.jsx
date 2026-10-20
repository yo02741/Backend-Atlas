import React, { useEffect, useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Slider, Toggle, Callout, Status, useTicker, Stats, Stat, Flow, LineChart, Caption } from '../ui.jsx'

/* 地端 / 公有雲託管 / 混合 情境模擬器（虛構的區域醫院，18 個服務）。
   上半：調負載波動、資料落地限制、維運人力、成長率，看每月成本指數、擴充時間、維運工時、合規符合度、災備。
   下半：「流量暴衝」或「機房斷電演練」按下去，60 分鐘時間軸逐分鐘播放，看三種做法的同一場事故。
   所有數字都是示意推算：成本是無單位的相對指數，不對應任何業者的價格。 */

const MODES = [
  { value: 'onprem', label: '地端' },
  { value: 'cloud', label: '公有雲託管' },
  { value: 'hybrid', label: '混合' },
]
const DRILLS = [
  { value: 'surge', label: '流量暴衝' },
  { value: 'outage', label: '機房斷電演練' },
]
const LIMITS = ['無特別限制', '須在國內區域（含備份）', '敏感資料須留院內', '所有資料須留院內']
const BASE = 40, NODE = 32, UTIL = 0.7, SENS = 0.6, SERVICES = 18, CORE = 11, T_END = 60, HOURS_PER_STAFF = 60
const COMPLY = { onprem: [100, 100, 100, 100], cloud: [100, 85, 25, 0], hybrid: [100, 95, 90, 70] }
const COMPLY_NOTE = {
  onprem: ['資料留院內', '資料留院內', '資料留院內', '資料留院內'],
  cloud: ['仍要管帳號與加密', '要確認區域與備份副本位置', '敏感資料不得上雲：做法不成立', '做法不成立'],
  hybrid: ['依分級放置', '依分級放置，確認備份位置', '敏感資料都在地端那一半', '雲端只能放不存資料的服務'],
}

/* 年度規劃：依參數估每月成本指數（含人力折算）、維運工時、節點數 */
function plan(mode, p) {
  const g = p.growth / 100
  const peak3 = BASE * p.ratio * (1 + g) ** 3                   // 地端要撐 3 年後的尖峰
  const avg = BASE * (1 + g) ** 1.5 * (1 + (p.ratio - 1) * 0.25)   // 有自動擴縮時，雲端費用跟著平均走
  const nodesFor = (v) => Math.ceil(v / UTIL / NODE) + 1          // 尖峰只用到 70%，再加 N+1
  let nodes = 0, infra = 0, hours = 0
  if (mode === 'onprem') { nodes = nodesFor(peak3); infra = nodes * 8 + 30; hours = 60 + nodes * 6 }
  else if (mode === 'cloud') { infra = (avg / UTIL) * 1.1 + 15; hours = 45 }
  else { nodes = nodesFor(peak3 * SENS); infra = nodes * 8 + 24 + ((avg * (1 - SENS)) / UTIL) * 1.1 + 10 + 8; hours = 50 + nodes * 6 + 25 + 25 }
  const drCloud = mode === 'hybrid' && p.limit <= 1        // 核心的災備副本能不能放雲端
  if (p.dr && mode !== 'cloud') { infra += drCloud ? 18 : nodes * 5 + 20; hours += drCloud ? 12 : 30 }
  const capHours = p.staff * HOURS_PER_STAFF
  return { nodes, cost: Math.round(infra + hours * 0.25), hours: Math.round(hours), load: hours / capHours, capHours, drCloud,
    idle: mode === 'cloud' ? null : 1 - (BASE * (mode === 'hybrid' ? SENS : 1)) / (nodes * NODE) }
}

/* 演練：t = 0..60 分鐘。負載以「平時尖峰 = 100」正規化；核心佔 60%、對外入口佔 40% */
function drill(mode, kind, dr) {
  const rows = []
  if (kind === 'surge') {
    const QUOTA = 420
    let onCap = mode === 'onprem' ? 100 / UTIL : mode === 'hybrid' ? (SENS * 100) / UTIL : 0
    let cloudCap = mode === 'cloud' ? 100 / UTIL : mode === 'hybrid' ? ((1 - SENS) * 100) / UTIL : 0
    const cloudMin = cloudCap
    let pending = [], rejected = 0, ready = null
    for (let t = 0; t <= T_END; t++) {
      const k = t < 10 ? 0 : t < 14 ? (t - 10) / 4 : t < 40 ? 1 : t < 46 ? 1 - (t - 40) / 6 : 0
      const core = SENS * 100 * (1 + 0.2 * k), ext = (1 - SENS) * 100 * (1 + 4 * k)   // 預約開放：對外入口 ×5
      pending = pending.filter((x) => { if (x.at <= t) { cloudCap += x.n; return false } return true })
      const cloudDemand = mode === 'cloud' ? core + ext : mode === 'hybrid' ? ext : 0
      const pend = pending.reduce((a, x) => a + x.n, 0)
      if (cloudCap && t % 2 === 0) {
        if (cloudDemand > cloudCap * UTIL && cloudCap + pend < QUOTA) pending.push({ at: t + 4, n: 40 })   // 偵測 + 開節點 4 分鐘
        else if (!pend && cloudDemand < cloudCap * 0.4 && cloudCap - 40 >= cloudMin) cloudCap -= 40          // 尖峰過後縮回去
      }
      let coreOk, extOk
      if (mode === 'onprem') { const s = Math.min(1, onCap / (core + ext)); coreOk = s; extOk = s }   // 同一池資源，大家一起慢
      else if (mode === 'cloud') { const s = Math.min(1, cloudCap / (core + ext)); coreOk = s; extOk = s }
      else { coreOk = Math.min(1, onCap / core); extOk = Math.min(1, cloudCap / ext) }
      const lost = core * (1 - coreOk) + ext * (1 - extOk)
      rejected += lost
      if (t > 10 && ready === null && lost < 0.5 && k === 1) ready = t
      rows.push({ demand: core + ext, cap: onCap + cloudCap, core: coreOk * 100, ext: extOk * 100, pend: pending.reduce((a, x) => a + x.n, 0), lost })
    }
    return { rows, rejected: Math.round(rejected), minCore: Math.min(...rows.map((r) => r.core)), slow: rows.filter((r) => r.core < 90).length, ready }
  }
  // 斷電：t=10 主機房斷電，UPS 撐 10 分鐘，發電機未啟動（演練假設）；t=40 復電，開機與資料庫檢查 12 分鐘
  const failover = 20 + 15
  let down = 0
  for (let t = 0; t <= T_END; t++) {
    const siteDown = t >= 20 && t < 52
    const coreUp = mode === 'cloud' || !siteDown || (dr && t >= failover)
    const extUp = mode !== 'onprem' || !siteDown || (dr && t >= failover)
    const up = (coreUp ? CORE : 0) + (extUp ? SERVICES - CORE : 0)
    if (!coreUp) down++
    rows.push({ up, coreUp, extUp, power: t < 10 ? 'ok' : t < 20 ? 'ups' : t < 40 ? 'off' : t < 52 ? 'boot' : 'ok' })
  }
  return { rows, down, minUp: Math.min(...rows.map((r) => r.up)) }
}

const EXPLAIN = {
  onprem: { title: '地端：資料最單純，容量與人力都要自己先準備', body: ['依 3 年後的尖峰加 N+1 採購，所以平時大半閒置；調高「尖峰 / 平時」或成長率，節點數與成本指數一起跳。擴充要走採購，以週計。', 'K8s 控制平面、儲存、LoadBalancer、registry、備份、升級都是自己的工時。人力拉到 1 人時，負荷超過 100%，而且只有一個人會修平台。'] },
  cloud: { title: '公有雲託管：彈性與省工時，前提是資料能放出去', body: ['有做自動擴縮時，費用跟著平均用量走，尖峰離峰差越大越划算；沒做擴縮就和地端一樣依尖峰付錢，而且每個月付。', '把「資料落地限制」拉到「敏感資料須留院內」，合規符合度掉到不成立——成本再低也不能選。託管不等於沒責任：帳號權限、加密、成本告警仍是自己的。'] },
  hybrid: { title: '混合：依資料分級切開，換來兩套環境的維運', body: ['核心系統依自己的尖峰在地端採購，對外入口在雲端擴充；暴衝時兩邊不搶同一池資源。代價是工時最高：身分、DNS、監控、部署流程都要跨環境一致，連線本身也是新的單點。', '開「異地備援」時，資料落地限制寬鬆，核心的災備副本可以放雲端；限制收緊到「敏感資料須留院內」，就只能找第二機房，成本與工時跟著上升。'] },
}
const DRILL_NOTE = {
  surge: '疫苗預約開放：t = 10 分起，對外入口在 4 分鐘內衝到平時尖峰的 5 倍，核心系統也多 20%，維持 30 分鐘後回落。',
  outage: '主機房斷電：t = 10 分斷電，UPS 撐 10 分鐘，發電機沒有啟動（演練假設）；t = 40 分復電，開機與資料庫檢查再 12 分鐘。',
}

export default function HostingChoiceScenarioLab() {
  const [mode, setMode] = useState('onprem')
  const [ratio, setRatio] = useState(3)
  const [limit, setLimit] = useState(2)
  const [staff, setStaff] = useState(2)
  const [growth, setGrowth] = useState(15)
  const [dr, setDr] = useState(false)
  const [kind, setKind] = useState('surge')
  const [started, setStarted] = useState(false)
  const [running, setRunning] = useState(false)
  const [tick, resetTick] = useTicker(running, 90)
  const [scrub, setScrub] = useState(null)
  useEffect(() => { if (tick >= T_END) setRunning(false) }, [tick])

  const p = { ratio, limit, staff, growth, dr }
  const pl = useMemo(() => plan(mode, p), [mode, ratio, limit, staff, growth, dr])
  const sim = useMemo(() => drill(mode, kind, dr), [mode, kind, dr])
  const t = started ? Math.min(T_END, tick) : T_END
  const shown = scrub ?? t
  const cur = sim.rows[shown]
  const comply = COMPLY[mode][limit]
  const play = () => { setStarted(true); resetTick(); setRunning(true) }
  const pickDrill = (v) => { setKind(v); setStarted(false); setRunning(false) }
  const ex = EXPLAIN[mode]
  const CH = { xMax: T_END, xTicks: [0, 15, 30, 45, 60], fmtX: (m) => `${m}′`, upto: t, mark: scrub, onScrub: setScrub }

  const scaleTime = mode === 'onprem' ? '8–12 週' : mode === 'cloud' ? '數分鐘' : '雲端數分鐘'
  const drLabel = mode === 'cloud' ? '多可用區' : dr ? (pl.drCloud ? '災備副本在雲端' : '第二機房') : '單一機房'

  return (
    <Lab accent="aqua" kicker="SCENARIO LAB" title="18 個服務放哪裡：地端、公有雲託管、混合"
         blurb="調負載波動、資料落地限制、維運人力與成長率，切換三種做法看成本、擴充、工時、合規與災備；再按「開始演練」看同一場暴衝或斷電在三種做法下怎麼走。">
      <LabControls>
        <Seg label="做法" tinted value={mode} onChange={setMode} options={MODES} />
        <Slider label="尖峰 / 平時負載" min={1.5} max={5} step={0.5} value={ratio} onChange={setRatio} format={(v) => `${v.toFixed(1)} 倍`} />
        <Slider label="資料落地限制" min={0} max={3} value={limit} onChange={setLimit} format={(v) => LIMITS[v]} />
        <Slider label="維運人力" min={1} max={6} value={staff} onChange={setStaff} format={(v) => `${v} 人`} />
        <Slider label="每年成長率" min={0} max={50} step={5} value={growth} onChange={setGrowth} format={(v) => `${v}%`} />
        {mode !== 'cloud' && <Toggle label="異地備援" checked={dr} onChange={setDr} />}
      </LabControls>
      <LabGrid variant="wide">
        <div className="lab-stack">
          <Stats min={150}>
            <Stat label="每月成本指數（示意）" value={pl.cost} note={mode === 'cloud' ? '跟著平均用量走' : `依尖峰採購 ${pl.nodes} 台，平時只用到約 ${Math.round((1 - pl.idle) * 100)}%`} />
            <Stat label="擴充所需時間" value={scaleTime} note={mode === 'onprem' ? '編預算、採購、上架' : mode === 'cloud' ? '受帳號配額限制' : '核心部分仍 8–12 週'} tone={mode === 'onprem' ? 'warn' : ''} />
            <Stat label="維運工時 / 可投入" value={`${pl.hours} / ${pl.capHours}`} unit="h/月" note={`負荷 ${Math.round(pl.load * 100)}%${staff === 1 ? '，人的單點故障' : ''}`} tone={pl.load > 1 ? 'bad' : pl.load > 0.8 || staff === 1 ? 'warn' : 'ok'} />
            <Stat label="合規與資料落地符合度" value={`${comply}%`} note={COMPLY_NOTE[mode][limit]} tone={comply < 50 ? 'bad' : comply < 90 ? 'warn' : 'ok'} />
            <Stat label="單點故障 / 災備" value={drLabel} note={mode === 'cloud' ? '仍依賴院內對外網路' : mode === 'hybrid' ? '連線也是單點' : ''} tone={mode !== 'cloud' && !dr ? 'bad' : ''} />
          </Stats>
          <Caption>{LIMITS[limit]}：實際限制依主管機關規範與契約要求，由法遵確認。成本指數含人力折算、不含流量費，不對應任何業者價格（示意）。</Caption>
          <Compare p={p} mode={mode} onPick={setMode} />
          <LabControls>
            <Seg label="演練" value={kind} onChange={pickDrill} options={DRILLS} />
            <button type="button" className="btn small" onClick={play}>{started ? '重新演練' : '開始演練'}</button>
            <span className="spacer" />
            {kind === 'surge'
              ? (sim.minCore >= 99 ? <Status ok>核心系統不受影響</Status> : <Status>核心系統最低 {Math.round(sim.minCore)}% 可服務</Status>)
              : (sim.down === 0 ? <Status ok>核心系統沒有停擺</Status> : <Status>核心停擺 {sim.down} 分鐘</Status>)}
          </LabControls>
          <LabStage plain label="60 分鐘演練時間軸">
            <div className="hc-charts">
              {kind === 'surge' ? (
                <>
                  <LineChart {...CH} title="需求與容量（平時尖峰 = 100）" yMax={500} fmtY={(v) => String(Math.round(v))}
                             series={[{ key: 'd', label: '需求', color: 'var(--c-blue)', values: sim.rows.map((r) => r.demand) }, { key: 'c', label: '容量', color: 'var(--c-green)', values: sim.rows.map((r) => r.cap) }]} />
                  <LineChart {...CH} title="可服務比例（%）" yMax={100} fmtY={(v) => `${v}`} thresholds={[{ v: 90, label: '90%' }]}
                             series={[{ key: 'core', label: '核心系統', color: 'var(--lab-accent)', values: sim.rows.map((r) => r.core) }, { key: 'ext', label: '對外入口', color: 'var(--c-orange)', values: sim.rows.map((r) => r.ext) }]} />
                </>
              ) : (
                <>
                  <LineChart {...CH} title={`可用服務數（共 ${SERVICES} 個）`} yMax={SERVICES} fmtY={(v) => String(Math.round(v))} thresholds={[{ v: SERVICES - CORE, label: '只剩對外' }]}
                             series={[{ key: 'up', label: '可用', color: 'var(--lab-accent)', values: sim.rows.map((r) => r.up) }]} />
                  <LineChart {...CH} title="可服務比例（%）" yMax={100} fmtY={(v) => `${v}`}
                             series={[{ key: 'core', label: '核心系統', color: 'var(--lab-accent)', values: sim.rows.map((r) => (r.coreUp ? 100 : 0)) }, { key: 'ext', label: '對外服務', color: 'var(--c-orange)', values: sim.rows.map((r) => (r.extUp ? 100 : 0)) }]} />
                </>
              )}
            </div>
            <DrillFlow mode={mode} kind={kind} r={cur} t={shown} dr={dr} drCloud={pl.drCloud} />
            <Caption>{DRILL_NOTE[kind]}游標移到圖上可看任一分鐘（示意）。</Caption>
          </LabStage>
          {kind === 'surge' ? (
            <Stats min={140}>
              <Stat label="被拒絕 / 逾時（累計負載單位）" value={sim.rejected.toLocaleString()} tone={sim.rejected > 0 ? 'bad' : 'ok'} />
              <Stat label="核心系統最低可服務" value={`${Math.round(sim.minCore)}%`} note={sim.slow ? `低於 90% 共 ${sim.slow} 分鐘` : '全程 ≥ 90%'} tone={sim.minCore < 90 ? 'bad' : 'ok'} />
              <Stat label="暴衝期間追上需求" value={mode === 'onprem' ? '追不上' : sim.ready ? `t = ${sim.ready}′` : '追不上'} note={mode === 'onprem' ? '容量固定' : '開節點約 4 分鐘'} />
            </Stats>
          ) : (
            <Stats min={140}>
              <Stat label="核心系統停擺" value={`${sim.down} 分鐘`} tone={sim.down > 0 ? 'bad' : 'ok'} />
              <Stat label="最低可用服務" value={`${sim.minUp} / ${SERVICES}`} tone={sim.minUp < SERVICES ? 'warn' : 'ok'} />
              <Stat label="恢復方式" value={mode === 'cloud' ? '不受影響' : dr ? '切到備援' : '等復電開機'} note={dr && mode !== 'cloud' ? '切換約 15 分，最後一次同步後的資料要補' : ''} />
            </Stats>
          )}
        </div>
        <div className="lab-stack">
          <LabExplain title={ex.title}>{ex.body.map((s, i) => <p key={i}>{s}</p>)}</LabExplain>
          <LabExplain title={kind === 'surge' ? '暴衝演練怎麼讀' : '斷電演練怎麼讀'}>
            {kind === 'surge'
              ? <p>地端是一池固定容量，對外入口暴衝時掛號櫃檯一起變慢；雲端每 2 分鐘看一次使用率、開節點要 4 分鐘，前幾分鐘仍會拒絕一部分；混合把對外入口切到雲端，核心系統那條線不動。</p>
              : <p>地端與混合的核心系統都在同一間機房，UPS 撐完就停，直到復電開機。打開「異地備援」看切換後的差別。雲端那條線不動的前提是院內網路設備另有供電與備援線路——否則院內使用者一樣連不上。</p>}
          </LabExplain>
          <Callout title="什麼時候會真的踩到">預算會議只比主機報價、法遵還沒回覆就先簽約、平台只有一個人會修、從沒做過斷電或還原演練。這幾件事在上線第一年都很常見，而且通常在尖峰或事故當天才被發現。</Callout>
        </div>
      </LabGrid>
      <style>{`
        .hc-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .hc-table td, .hc-table th { white-space: nowrap; }
        .hc-table td.hc-bad { color: var(--critical); font-weight: 600; }
        @media (max-width: 560px) { .hc-charts { grid-template-columns: 1fr; } }
      `}</style>
    </Lab>
  )
}

/* 這一分鐘的流向：使用者 → 入口 → 核心系統，位置隨做法變；斷電演練多一格機房電力 */
function DrillFlow({ mode, kind, r, t, dr, drCloud }) {
  const where = (part) => (mode === 'onprem' ? '地端' : mode === 'cloud' ? '雲端' : part === 'core' ? '地端' : '雲端')
  if (kind === 'surge') {
    const steps = [
      { label: '民眾 / 院內使用者', value: `需求 ${Math.round(r.demand)}` },
      { label: `對外入口（${where('ext')}）`, value: `${Math.round(r.ext)}% 可服務`, bad: r.ext < 90, hot: r.ext >= 90 && r.demand > 110 },
      ...(mode === 'hybrid' ? [{ label: 'VPN / 專線', value: '只送排隊序號' }] : []),
      { label: `核心：掛號、檢驗（${where('core')}）`, value: `${Math.round(r.core)}% 可服務`, bad: r.core < 90 },
    ]
    return <Flow title={`t = ${t} 分的流向（示意）`} steps={steps} back={r.lost > 0.5 ? `約 ${Math.round(r.lost)} 單位的請求逾時或被拒` : ''}
                 notes={[r.pend > 0 && `${r.pend} 單位的節點開機中`, mode === 'onprem' && r.demand > 110 && '對外入口與核心系統共用同一池資源']} />
  }
  const powerLabel = { ok: '正常', ups: 'UPS 供電中', off: '斷電', boot: '復電，開機中' }[r.power]
  const steps = [
    { label: '主機房電力', value: powerLabel, bad: r.power === 'off' || r.power === 'ups' },
    { label: `核心系統（${mode === 'cloud' ? '雲端' : r.coreUp && dr && r.power !== 'ok' ? (drCloud ? '雲端備援' : '第二機房') : '地端'}）`, value: r.coreUp ? '可用' : '停擺', bad: !r.coreUp },
    { label: `對外服務（${where('ext')}）`, value: r.extUp ? '可用' : '停擺', bad: !r.extUp },
  ]
  return <Flow title={`t = ${t} 分的狀態（示意）`} steps={steps} back={r.coreUp ? '' : '掛號與檢驗報告改走紙本作業'}
               notes={[mode !== 'cloud' && !dr && r.power === 'boot' && '開機後要先確認資料庫一致，才能開放掛號', mode === 'cloud' && '前提：院內網路設備另有供電與備援線路']} />
}

/* 同一組參數下三種做法並排：哪個假設一改，排名就翻過來 */
function Compare({ p, mode, onPick }) {
  const rows = MODES.map((m) => ({ ...m, pl: plan(m.value, p), comply: COMPLY[m.value][p.limit] }))
  const minCost = Math.min(...rows.filter((r) => r.comply >= 50).map((r) => r.pl.cost))
  return (
    <div className="dtable-wrap">
      <table className="dtable hc-table">
        <caption>同一組參數，三種做法並排（示意；點一列切換做法）</caption>
        <thead>
          <tr><th>做法</th><th>成本指數</th><th>工時負荷</th><th>合規</th><th>災備</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.value} className={`clickable${r.value === mode ? ' hit' : ''}${r.comply < 50 ? ' off' : ''}`} onClick={() => onPick(r.value)}>
              <td>{r.label}</td>
              <td>{r.pl.cost}{r.pl.cost === minCost && r.comply >= 50 ? ' · 最低' : ''}</td>
              <td className={r.pl.load > 1 ? 'hc-bad' : ''}>{Math.round(r.pl.load * 100)}%</td>
              <td className={r.comply < 50 ? 'hc-bad' : ''}>{r.comply < 50 ? '不成立' : `${r.comply}%`}</td>
              <td>{r.value === 'cloud' ? '多可用區' : p.dr ? '有' : '單一機房'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

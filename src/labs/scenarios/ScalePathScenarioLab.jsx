import React, { useMemo, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Slider, Toggle, Stepper, Callout, Status, Stats, Stat, Caption, useWidth } from '../ui.jsx'

/* 擴展路徑情境模擬器（容量模擬器）：
   QPS 對數滑桿 100 → 100,000；右側六個元件各有示意容量。畫面算出每個元件的使用率、
   「流量再長第一個爆的是誰」、示意 p95 / 錯誤率 / 每月成本；請求路徑圖上標每條邊的流量。
   Stepper「建議順序」逐步套用技巧，路徑總表列出每一步撐到多少、花多少。
   所有數字都是示意，只為呈現相對關係。 */

const CAP = { lb: 200000, inst: 800, instBig: 2400, redis: 120000, dbRead: 3000, dbWriteSync: 1500, dbWriteQueue: 12000, maxConn: 100, pool: 10, pgbPool: 40 }
const COST = { inst: 80, instBig: 300, lb: 20, redis: 50, pgb: 10, primary: 200, replica: 200, queue: 60 }

const PLAN = [
  { label: '起點', cfg: { vertical: false, instances: 1, hit: 0, pgb: false, replicas: 0, queue: false },
    title: '起點：一台 4 vCPU 跑單 worker', text: '所有請求都經過同一個 Python 程序，示意容量 800 QPS。100 QPS 時一切正常，但流量再長十倍就是 API 先爆——DB 這時還很閒。' },
  { label: '① 升級機器', cfg: { vertical: true, instances: 1, hit: 0, pgb: false, replicas: 0, queue: false },
    title: '① 升級機器：零程式改動', text: '換 16 vCPU、uvicorn 開多個 worker，單機容量到 2,400 QPS。夠不夠？拉 QPS 到 3,000 看：API 又爆了，而且沒有更大的機器可以換。這一步便宜、快、但有天花板。' },
  { label: '② 水平擴展', cfg: { vertical: true, instances: 4, hit: 0, pgb: false, replicas: 0, queue: false },
    title: '② 無狀態 + 4 實例 + LB', text: 'session 搬 Redis、檔案搬物件儲存後，API 可以無限加台。4 台是 9,600 QPS——但第一個爆的變成 PostgreSQL 讀：90% 的讀全部打到單一主庫，3,333 QPS 就到頂。加 API 實例對這個瓶頸毫無幫助。' },
  { label: '③ 快取', cfg: { vertical: true, instances: 4, hit: 90, pgb: false, replicas: 0, queue: false },
    title: '③ 快取命中 90%：DB 讀砍九成', text: '商品頁與列表走 cache-aside，90% 的讀完全不碰 DB。DB 讀容量從 3,333 QPS 變成 33,333 QPS，瓶頸回到 API（9,600）。快取是讀多寫少系統最便宜的一步，代價是失效邏輯。' },
  { label: '④ 加到 16 台', cfg: { vertical: true, instances: 16, hit: 90, pgb: false, replicas: 0, queue: false },
    title: '④ 加到 16 台：連線數先爆', text: 'API 容量 38,400 QPS，但每台 10 條連線 × 16 = 160 條，超過 max_connections 100。這跟 QPS 無關：多出來的實例一啟動就連不上 DB。水平擴展最常踩的坑就在這。' },
  { label: '⑤ pgbouncer', cfg: { vertical: true, instances: 16, hit: 90, pgb: true, replicas: 0, queue: false },
    title: '⑤ pgbouncer：幾十台共用一小池連線', text: 'transaction 模式的連線池讓 16 台（甚至 100 台）共用 40 條真連線。現在撐到 33,333 QPS，第一個爆的又回到 DB 讀：剩下 10% 沒命中的讀，在 3.3 萬 QPS 時已經是 3,000。' },
  { label: '⑥ 讀寫分離', cfg: { vertical: true, instances: 16, hit: 90, pgb: true, replicas: 2, queue: false },
    title: '⑥ 兩台副本：讀容量 ×3', text: 'DB 讀容量 9,000 QPS，換算成總流量 10 萬。但下一個爆的是寫：10% 的寫在 1.5 萬 QPS 時就是 1,500 筆 commit / 秒，單主庫的 fsync 到頂。副本對寫入完全沒有幫助，還帶來寫後讀的一致性問題。' },
  { label: '⑦ 佇列 + 42 台', cfg: { vertical: true, instances: 42, hit: 90, pgb: true, replicas: 2, queue: true },
    title: '⑦ 佇列削峰寫入 + 補足 API', text: '下單先進佇列回 202，worker 批次 INSERT，一次 commit 幾百筆，寫容量示意 12,000 QPS。API 再補到 42 台，整條路撐到約 10 萬 QPS。順序是：先擋讀（快取）、再擴 API、最後才動 DB——每一步只解當下第一個爆的元件。' },
]

const ASSUMPTIONS = [
  ['API 實例', '4 vCPU 800 QPS / 16 vCPU 2,400 QPS', '$80 / $300 每台'],
  ['負載平衡', '200,000 QPS', '$20'],
  ['Redis 快取', '120,000 ops/s', '$50'],
  ['PostgreSQL 讀', '主庫 3,000 QPS，每台副本 +3,000', '主庫 $200、副本 $200'],
  ['PostgreSQL 寫', '同步 commit 1,500 / 佇列批次 12,000', '佇列 + worker $60'],
  ['DB 連線', '每台實例 10 條；max_connections 100', 'pgbouncer $10'],
]

/* 某個元件到頂時，下一步該動哪個旋鈕 */
const NEXT = {
  lb: '多台 LB 或 DNS 輪詢（本情境不涵蓋）',
  api: '加實例（水平）或升級機器（垂直）',
  redis: 'Redis cluster 分片（本情境不涵蓋）',
  conn: '加 pgbouncer，讓實例共用一小池連線',
  dbr: '提高快取命中率，或加讀取副本',
  dbw: '寫入走佇列 + 批次落地；再上去就是分片',
}

const fmtN = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString() : '∞')
const posToQps = (p) => { const raw = 100 * Math.pow(1000, p / 100); const unit = raw < 1000 ? 10 : raw < 10000 ? 100 : 1000; return Math.round(raw / unit) * unit }
const short = (name) => name.split('（')[0]

function model(qps, readPct, cfg) {
  const reads = qps * readPct / 100, writes = qps - reads
  const perInst = cfg.vertical ? CAP.instBig : CAP.inst
  const comps = [
    { id: 'lb', name: '負載平衡', load: qps, cap: cfg.instances > 1 ? CAP.lb : null, off: cfg.instances > 1 ? null : '單機直連，不需要', unit: 'QPS' },
    { id: 'api', name: `API 實例 × ${cfg.instances}（${cfg.vertical ? '16' : '4'} vCPU）`, load: qps, cap: cfg.instances * perInst, unit: 'QPS' },
    { id: 'redis', name: `快取 Redis（命中 ${cfg.hit}%）`, load: cfg.hit > 0 ? reads : 0, cap: cfg.hit > 0 ? CAP.redis : null, off: cfg.hit > 0 ? null : '未啟用', unit: 'QPS' },
    { id: 'conn', name: 'DB 連線數', load: cfg.instances * CAP.pool, cap: cfg.pgb ? null : CAP.maxConn, off: cfg.pgb ? `pgbouncer：${cfg.instances * CAP.pool} 條客戶端連線共用 ${CAP.pgbPool} 條` : null, unit: '條', fixed: true },
    { id: 'dbr', name: `PostgreSQL 讀（主庫 + ${cfg.replicas} 副本）`, load: reads * (1 - cfg.hit / 100), cap: CAP.dbRead * (1 + cfg.replicas), unit: 'QPS' },
    { id: 'dbw', name: `PostgreSQL 寫（${cfg.queue ? '佇列批次' : '同步 commit'}）`, load: writes, cap: cfg.queue ? CAP.dbWriteQueue : CAP.dbWriteSync, unit: 'QPS' },
  ].map((c) => ({ ...c, util: c.cap ? c.load / c.cap : 0 }))
  const conn = comps.find((c) => c.id === 'conn')
  const connBroken = conn.util > 1
  const scaled = comps.filter((c) => c.cap && !c.fixed && c.load > 0).map((c) => ({ ...c, holds: c.cap / (c.load / qps) }))
  const first = scaled.reduce((a, c) => (c.holds < a.holds ? c : a), scaled[0])
  const holds = first ? first.holds : Infinity
  const maxU = Math.max(0, ...scaled.map((c) => c.util))
  const p95 = 40 + scaled.reduce((s, c) => s + (c.util < 0.6 ? 0 : c.util <= 1 ? 160 * Math.pow((c.util - 0.6) / 0.4, 2) : 400), 0)
  const errRate = Math.max(maxU > 1 ? 1 - 1 / maxU : 0, connBroken ? 1 - conn.cap / conn.load : 0)
  const cost = cfg.instances * (cfg.vertical ? COST.instBig : COST.inst) + (cfg.instances > 1 ? COST.lb : 0) + (cfg.hit > 0 ? COST.redis : 0) + (cfg.pgb ? COST.pgb : 0) + COST.primary + cfg.replicas * COST.replica + (cfg.queue ? COST.queue : 0)
  const state = Object.fromEntries(comps.map((c) => [c.id, c.off ? 'off' : c.util > 1 ? 'bad' : c.util > 0.7 ? 'warn' : 'ok']))
  return { comps, first, holds, connBroken, conn, p95, errRate, cost, over: qps > holds, reads, writes, state, toDb: reads * (1 - cfg.hit / 100) }
}

export default function ScalePathScenarioLab() {
  const [pos, setPos] = useState(0)
  const [readPct, setReadPct] = useState(90)
  const [step, setStep] = useState(0)
  const [cfg, setCfg] = useState(PLAN[0].cfg)
  const qps = posToQps(pos)
  const r = useMemo(() => model(qps, readPct, cfg), [qps, readPct, cfg])
  const path = useMemo(() => PLAN.map((p) => { const m = model(100000, readPct, p.cfg); return { label: p.label, holds: m.holds, cost: m.cost, connBroken: m.connBroken, stuck: m.connBroken ? 'DB 連線數' : short(m.first?.name || '—') } }), [readPct])
  const plan = PLAN[step]
  const set = (k) => (v) => setCfg((c) => ({ ...c, [k]: v }))
  const goStep = (s) => { setStep(s); setCfg(PLAN[s].cfg) }
  const goal = useMemo(() => model(100000, readPct, cfg), [readPct, cfg])
  const ok = !r.over && !r.connBroken
  const st = (id) => r.state[id]
  const pgState = st('dbr') === 'bad' || st('dbw') === 'bad' ? 'bad' : st('dbr') === 'warn' || st('dbw') === 'warn' ? 'warn' : 'ok'
  const box = useRef(null)
  const narrow = useWidth(box, 700) < 520   // 手機：路徑圖改直式（360 寬），節點上下排，字不會被縮到看不清
  const nextKey = r.connBroken ? 'conn' : r.first?.id
  const statusLine = r.connBroken ? `連線數 ${fmtN(r.conn.load)} 條超過 ${r.conn.cap}，不論流量多少都會出錯。`
    : r.over ? `已超過這個配置的上限（≈ ${fmtN(r.holds)} QPS），${short(r.first.name)}正在丟請求。`
    : `流量再長，第一個到頂的是 ${r.first ? short(r.first.name) : '—'}（≈ ${fmtN(r.holds)} QPS）。`

  return (
    <Lab accent="red" kicker="SCENARIO LAB" title="容量模擬器：流量再長，第一個爆的是誰"
         blurb="拉 QPS，看六個元件誰先到頂；用 Stepper 逐步套用建議順序，每一步看撐到多少、花多少。所有容量、延遲、成本都是示意，只為呈現相對關係。">
      <LabControls>
        <Slider label="QPS（對數）" min={0} max={100} value={pos} onChange={setPos} format={() => `${fmtN(qps)} QPS`} />
        <Slider label="讀的比例" min={50} max={99} value={readPct} onChange={setReadPct} format={(v) => `讀 ${v}% / 寫 ${100 - v}%`} />
        <button type="button" className="btn ghost small" onClick={() => setPos(pos === 100 ? 0 : 100)}>{pos === 100 ? '回到 100 QPS' : '跳到活動尖峰 10 萬 QPS'}</button>
        <span className="spacer" />
        {ok ? <Status ok>撐得住 {fmtN(qps)} QPS</Status> : <Status>{r.connBroken ? '連線數爆了' : `${short(r.first?.name || '')} 爆了`}</Status>}
        {goal.over || goal.connBroken
          ? <Status warn>離 10 萬目標{goal.connBroken ? '：連線先爆' : `還差 ${(100000 / goal.holds).toFixed(1)} 倍`}</Status>
          : <Status ok>10 萬目標達標</Status>}
      </LabControls>
      <LabControls>
        <Stepper step={step} total={PLAN.length} onStep={goStep} labels={PLAN.map((p) => p.label)} />
        <span className="pill">這一步撐到 <b>{path[step].connBroken ? '啟動即失敗' : `≈ ${fmtN(path[step].holds)} QPS`}</b></span>
      </LabControls>

      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabStage label="請求路徑與每條邊的流量" caption="每條邊標的是示意流量：讀先問快取，沒命中才到 PostgreSQL；寫直接進主庫，或先進佇列。">
            <div ref={box}>
              {narrow ? (
                /* 直式：Client → LB → API 往下走，再分成快取（左）與連線池 → PostgreSQL（右）；寫入沿中間往下，有佇列時先進左下的佇列 */
                <svg className="sp-svg narrow" viewBox="0 0 360 400" role="img" aria-label="請求路徑">
                  <Edge d="M180 50 V76" label={`${fmtN(qps)} QPS`} x={190} y={67} anchor="l" />
                  <Edge d="M180 120 V146" label={fmtN(qps)} x={190} y={137} anchor="l" />
                  <Edge d="M150 196 C150 222, 80 220, 80 246" label={`讀 ${fmtN(cfg.hit ? r.reads : 0)}`} x={12} y={236} anchor="l" />
                  <Edge d="M210 196 C210 222, 280 220, 280 246" label={`讀 ${fmtN(r.toDb)}`} x={348} y={236} anchor="r" />
                  <path d="M280 290 V336" className="e" />
                  {cfg.queue
                    ? <><Edge d="M180 196 V318 H80 V340" label={`寫 ${fmtN(r.writes)} → 佇列`} x={174} y={310} anchor="r" /><path d="M150 361 H210" className="e" /></>
                    : <Edge d="M180 196 V361 H210" label={`寫 ${fmtN(r.writes)}`} x={174} y={322} anchor="r" />}
                  <Node x={130} y={6} w={100} h={44} t="Client" s="使用者" state="ok" />
                  <Node x={130} y={76} w={100} h={44} t="LB" s={cfg.instances > 1 ? 'nginx' : '（略）'} state={st('lb')} />
                  <Node x={120} y={146} w={120} h={50} t={`API × ${cfg.instances}`} s={cfg.vertical ? '16 vCPU' : '4 vCPU'} state={st('api')} />
                  <Node x={10} y={246} w={140} h={46} t="Redis" s={cfg.hit ? `命中 ${cfg.hit}%` : '未啟用'} state={st('redis')} />
                  <Node x={210} y={246} w={140} h={44} t={cfg.pgb ? 'pgbouncer' : '直連'} s={`${cfg.instances * CAP.pool} 條`} state={st('conn')} />
                  <Node x={210} y={336} w={140} h={50} t="PostgreSQL" s={`主庫 + ${cfg.replicas} 副本`} state={pgState} />
                  {cfg.queue && <Node x={10} y={340} w={140} h={42} t="佇列 + worker" s="批次 INSERT" state="ok" />}
                </svg>
              ) : (
                <svg className="sp-svg" viewBox="0 0 640 170" role="img" aria-label="請求路徑">
                  <Edge d="M70 85 H130" label={`${fmtN(qps)} QPS`} x={100} y={76} />
                  <Edge d="M210 85 H270" label={fmtN(qps)} x={240} y={76} />
                  <Edge d="M370 70 C 400 70, 400 35, 430 35" label={`讀 ${fmtN(cfg.hit ? r.reads : 0)}`} x={400} y={38} />
                  <Edge d="M370 85 C 420 85, 430 105, 470 105 L 530 105" label={`讀 ${fmtN(r.toDb)}`} x={400} y={80} />
                  <Edge d="M370 100 C 400 100, 400 150, 430 150 H 530 L 585 130" label={cfg.queue ? `寫 ${fmtN(r.writes)} → 佇列` : `寫 ${fmtN(r.writes)}`} x={320} y={135} />
                  <Node x={10} y={60} w={60} h={50} t="Client" s="使用者" state="ok" />
                  <Node x={130} y={60} w={80} h={50} t="LB" s={cfg.instances > 1 ? 'nginx' : '（略）'} state={st('lb')} />
                  <Node x={270} y={55} w={100} h={60} t={`API × ${cfg.instances}`} s={cfg.vertical ? '16 vCPU' : '4 vCPU'} state={st('api')} />
                  <Node x={430} y={10} w={110} h={46} t="Redis" s={cfg.hit ? `命中 ${cfg.hit}%` : '未啟用'} state={st('redis')} />
                  <Node x={430} y={85} w={100} h={40} t={cfg.pgb ? 'pgbouncer' : '直連'} s={`${cfg.instances * CAP.pool} 條`} state={st('conn')} />
                  <Node x={540} y={80} w={95} h={50} t="PostgreSQL" s={`主庫 + ${cfg.replicas} 副本`} state={pgState} />
                  {cfg.queue && <Node x={430} y={132} w={100} h={34} t="佇列 + worker" s="批次 INSERT" state="ok" />}
                </svg>
              )}
            </div>
          </LabStage>
          <LabStage plain>
            <div className="sp-flow">
              {r.comps.map((c) => {
                const isFirst = r.first && c.id === r.first.id && !r.connBroken
                return (
                  <div key={c.id} className={`sp-card ${st(c.id)}${isFirst ? ' first' : ''}${c.id === 'conn' && r.connBroken ? ' first' : ''}`}>
                    <div className="sp-name">{c.name}</div>
                    {c.off
                      ? <div className="sp-off">{c.off}</div>
                      : <>
                        <div className="sp-bar"><i style={{ width: `${Math.min(100, c.util * 100)}%` }} /></div>
                        <div className="sp-num">{fmtN(c.load)} / {fmtN(c.cap)} {c.unit} · {Math.round(c.util * 100)}%</div>
                      </>}
                    {isFirst && <span className="sp-badge">{r.over ? '已超載' : `第一個爆 · 約 ${fmtN(r.holds)} QPS`}</span>}
                    {c.id === 'conn' && r.connBroken && <span className="sp-badge">{fmtN(c.load)} 條 &gt; max_connections {c.cap}，新連線被拒</span>}
                  </div>
                )
              })}
            </div>
            <Stats min={150}>
              <Stat label="目前配置可撐" value={`≈ ${fmtN(r.holds)} QPS`} />
              <Stat label="p95" value={`≈ ${Math.round(r.p95)} ms`} tone={r.p95 > 300 ? 'bad' : ''} />
              <Stat label="錯誤率" value={r.errRate ? `${Math.max(1, Math.round(r.errRate * 100))}%` : '0%'} tone={r.errRate > 0.01 ? 'bad' : ''} />
              <Stat label="每月" value={`≈ $${fmtN(r.cost)}`} />
            </Stats>
            <Caption>全部示意</Caption>
            {nextKey && <p className="sp-next">下一步該動的旋鈕：<b>{NEXT[nextKey]}</b></p>}
          </LabStage>
          <LabExplain title={plan.title}>
            <p>{plan.text}</p>
            <p>目前：{fmtN(qps)} QPS、讀 {readPct}%。{statusLine}</p>
            <p>流量怎麼分：每秒 {fmtN(r.reads)} 讀、{fmtN(r.writes)} 寫。快取擋掉 {fmtN(r.reads - r.toDb)} 讀，真正到 PostgreSQL 的是 {fmtN(r.toDb)} 讀 + {fmtN(r.writes)} 寫{cfg.queue ? '（寫先進佇列，DB 以批次速度消化）' : '（每筆寫一個 commit）'}。</p>
          </LabExplain>
          <div className="dtable-wrap">
            <table className="dtable sp-path">
              <caption>建議順序總表（讀 {readPct}% 時，每一步撐到多少、花多少；點一列套用）</caption>
              <thead><tr><th>步驟</th><th>撐到（示意）</th><th>卡在</th><th>每月（示意）</th></tr></thead>
              <tbody>
                {path.map((p, i) => (
                  <tr key={i} className={`clickable${i === step ? ' hit' : ''}`} onClick={() => goStep(i)}>
                    <td>{p.label}</td>
                    <td className={p.connBroken ? 'bad' : ''}>{p.connBroken ? '啟動即失敗' : `≈ ${fmtN(p.holds)} QPS`}</td>
                    <td>{p.stuck}</td>
                    <td>${fmtN(p.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lab-stack">
          <div className="sp-ctl">
            <Slider label="API 實例數" min={1} max={64} value={cfg.instances} onChange={set('instances')} format={(v) => `${v} 台`} />
            <Toggle label="升級機器：4 → 16 vCPU（每台 800 → 2,400 QPS）" checked={cfg.vertical} onChange={set('vertical')} />
            <Slider label="快取命中率" min={0} max={99} value={cfg.hit} onChange={set('hit')} format={(v) => (v ? `${v}%` : '未啟用')} />
            <Toggle label="pgbouncer 連線池" checked={cfg.pgb} onChange={set('pgb')} />
            <Slider label="讀取副本數" min={0} max={4} value={cfg.replicas} onChange={set('replicas')} format={(v) => `${v} 台`} />
            <Toggle label="寫入走佇列 + worker 批次落地" checked={cfg.queue} onChange={set('queue')} />
          </div>
          <div className="dtable-wrap">
            <table className="dtable sp-assume">
              <caption>示意容量與價格假設</caption>
              <thead><tr><th>元件</th><th>容量</th><th>每月</th></tr></thead>
              <tbody>{ASSUMPTIONS.map(([a, b, c]) => <tr key={a}><td>{a}</td><td>{b}</td><td>{c}</td></tr>)}</tbody>
            </table>
          </div>
          <Callout title="什麼時候會真的踩到">
            活動前一週壓測：加了 20 台 API 實例，QPS 沒上去反而全站 500——每台開 10 條連線，DB 的 max_connections 100 第 11 台就滿了。另一種：快取上了、API 加了，尖峰時下單卻大量逾時，因為 10% 的寫全部同步 commit 在同一顆磁碟上。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .sp-svg { width: 100%; }
        .sp-svg .e { stroke: var(--ink-3); stroke-width: 1.5; fill: none; }
        .sp-svg .el { font-family: var(--mono); font-size: 9.5px; fill: var(--ink-2); text-anchor: middle; }
        .sp-svg .n { fill: var(--surface-1); stroke: var(--hairline); stroke-width: 1.5; transition: stroke 0.2s ease; }
        .sp-svg .n.warn { stroke: var(--serious); stroke-width: 2; }
        .sp-svg .n.bad { stroke: var(--critical); stroke-width: 2.5; fill: color-mix(in srgb, var(--critical) 10%, var(--surface-1)); }
        .sp-svg .n.off { stroke-dasharray: 4 3; }
        .sp-svg .t { font-family: var(--sans); font-size: 11.5px; font-weight: 700; fill: var(--ink-1); text-anchor: middle; }
        .sp-svg .s { font-family: var(--mono); font-size: 9.5px; fill: var(--ink-3); text-anchor: middle; }
        .sp-svg .el.l { text-anchor: start; } .sp-svg .el.r { text-anchor: end; }
        .sp-svg.narrow .t { font-size: 12.5px; } .sp-svg.narrow .s, .sp-svg.narrow .el { font-size: 11px; }
        .sp-flow { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
        @media (max-width: 640px) { .sp-flow { grid-template-columns: 1fr 1fr; } }
        .sp-card { position: relative; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 10px 12px 12px; display: grid; gap: 6px; align-content: start; min-height: 86px; transition: border-color 0.2s ease; }
        .sp-card.warn { border-color: var(--serious); }
        .sp-card.bad { border-color: var(--critical); background: color-mix(in srgb, var(--critical) 8%, var(--surface-1)); }
        .sp-card.first { box-shadow: 0 0 0 2px var(--critical); }
        .sp-card.off { opacity: 0.6; }
        .sp-name { font-size: 0.78rem; font-weight: 700; color: var(--ink-1); line-height: 1.35; }
        .sp-off { font-size: 0.72rem; color: var(--ink-3); font-style: italic; }
        .sp-bar { height: 8px; background: var(--surface-2); border: 1px solid var(--hairline); border-radius: 3px; overflow: hidden; }
        .sp-bar i { display: block; height: 100%; background: var(--good); transition: width 0.25s ease, background 0.25s ease; }
        .sp-card.warn .sp-bar i { background: var(--serious); }
        .sp-card.bad .sp-bar i { background: var(--critical); }
        .sp-num { font-family: var(--mono); font-size: 0.7rem; color: var(--ink-3); font-variant-numeric: tabular-nums; }
        .sp-badge { justify-self: start; font-size: 0.66rem; font-weight: 700; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--critical); color: var(--critical); }
        .sp-next { margin-top: 8px; font-size: 0.8rem; color: var(--ink-2); }
        .sp-next b { color: var(--ink-1); }
        .sp-ctl { display: grid; gap: 12px; padding: 12px 14px; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); }
        .sp-ctl .slider { min-width: 0; }
        .sp-path td.bad { color: var(--critical); font-weight: 700; }
        .sp-assume td { white-space: normal; font-size: 0.74rem; }
      `}</style>
    </Lab>
  )
}

function Edge({ d, label, x, y, anchor }) {
  return <><path d={d} className="e" /><text x={x} y={y} className={`el${anchor ? ' ' + anchor : ''}`}>{label}</text></>
}
function Node({ x, y, w, h, t, s, state }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <rect width={w} height={h} rx="5" className={`n ${state}`} />
      <text x={w / 2} y={h / 2 - 2} className="t">{t}</text>
      <text x={w / 2} y={h / 2 + 13} className="s">{s}</text>
    </g>
  )
}

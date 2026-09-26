import React, { useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Slider, Stepper, usePlayer, Callout, Status, Stats, Stat, fmtN } from '../ui.jsx'

/* 資料庫擴展情境模擬器：Stepper 逐階段疊上去——現況 → pgbouncer → 讀寫分離 → 表分割 → 分片。
   每一階段看：連線數（客戶端 / DB 端）、每台的 CPU、能撐的 QPS、複雜度；後兩階段另外看掃了幾個分區、打了幾台。
   數字是依固定假設推算的示意值，不是量測值 */

const STAGES = ['現況', '① pgbouncer', '② 讀寫分離', '③ 表分割', '④ 分片']
const MAX_CONN = 100, POOL = 20, REPLICAS = 2, PARTS = 32, SHARDS = 4
const BASE_CPU = 72          // 查詢本身吃的 CPU（%）；每條 backend 連線再加 0.05%
const NOW_QPS = 4000         // 現況的流量（QPS，示意）
const COMPLEXITY = ['低（現況）', '低', '中', '中', '很高']
const pct = (v) => `${Math.round(v)}%`

/* 每一階段背後的算式，用目前的 slider 值算給你看 */
function mathLines(step, api, per, m, query) {
  const over = m.clientConns - MAX_CONN
  const conn0 = `${api} 台 × ${per} 條 = ${m.clientConns} 條 ${m.clientConns > MAX_CONN ? '>' : '≤'} max_connections ${MAX_CONN}${over > 0 ? ` → ${over} 條拿不到` : ' → 還有餘裕'}`
  if (step === 0) return [conn0, `CPU ≈ ${BASE_CPU}% + ${m.clientConns} 條 × 0.05% = ${pct(m.load)}${m.saturated ? '（飽和）' : ''}`, `QPS 上限 ≈ 4,000 × 100% ÷ ${pct(m.maxCpu)} = ${m.qps.toLocaleString()}`]
  if (step === 1) return [`${m.clientConns} 條客戶端連線 → pgbouncer（default_pool_size ${POOL}）→ DB 端 ${m.dbConns} 條 ≤ ${MAX_CONN}`, `CPU ≈ ${BASE_CPU}% + ${m.dbConns} 條 × 0.05% = ${pct(m.load)}（少的只是閒置 backend）`, `QPS 上限 ≈ 4,000 × 100% ÷ ${pct(m.maxCpu)} = ${m.qps.toLocaleString()}`]
  const primary = m.load * (m.w + 0.05), replica = (m.load * m.r) / REPLICAS
  const rep = [`主庫 = ${pct(m.load)} × (寫 ${pct(m.w * 100)} + 複製 5%) = ${pct(primary)}`, `每台副本 = ${pct(m.load)} × 讀 ${pct(m.r * 100)} ÷ ${REPLICAS} = ${pct(replica)}`]
  if (step === 2) return [...rep, `QPS 上限依最忙的一台：4,000 × 100% ÷ ${pct(m.maxCpu)} = ${m.qps.toLocaleString()}`]
  if (step === 3) return [query === 'user' ? `帶 user_id：掃 1 / ${PARTS} 個分區、索引變小 → 每台 CPU × ${m.partFactor}` : `跨全表：${PARTS} 個分區全掃、多 ${PARTS} 次計畫與合併 → 每台 CPU × ${m.partFactor}`, ...rep, `寫入還是主庫一台：分割不加寫入容量`]
  return [query === 'user' ? `帶 user_id：hash 到 1 片 → 每片負載 ÷ ${SHARDS}：主 ${pct(primary / SHARDS)}、副本 ${pct(replica / SHARDS)}` : `跨全表：${SHARDS} 片都被打 → 每片負載不變：主 ${pct(primary)}、副本 ${pct(replica)}`, `QPS 上限 = 4,000 × 100% ÷ ${pct(m.maxCpu)} = ${m.qps.toLocaleString()}${query === 'user' ? `（≈ 單片 × ${SHARDS}）` : '（回到分片前）'}`, `代價：備份、migration、pgbouncer、監控 × ${SHARDS}；跨片 JOIN / 交易要在應用層拼`]
}

function model(step, api, per, readPct, query) {
  const clientConns = api * per
  const dbConns = step >= 1 ? Math.min(clientConns, POOL) : clientConns      // 每個實例的 DB 端連線
  const r = readPct / 100, w = 1 - r
  const byUser = query === 'user'
  const partFactor = step >= 3 ? (byUser ? 0.9 : 1.15) : 1                    // 分割：掃 1 個分區省一點；全掃多一點
  const load = (BASE_CPU + 0.05 * dbConns) * partFactor                       // 一台扛全部時的 CPU（%）
  let nodes = step < 2
    ? [{ label: '主庫', cpu: load }]
    : [{ label: '主庫（寫 + 複製）', cpu: load * (w + 0.05) }, ...Array.from({ length: REPLICAS }, (_, i) => ({ label: `讀副本 ${i + 1}`, cpu: (load * r) / REPLICAS }))]
  const shardsHit = step === 4 ? (byUser ? 1 : SHARDS) : 0
  if (step === 4) nodes = nodes.map((n) => ({ ...n, cpu: byUser ? n.cpu / SHARDS : n.cpu }))   // 帶 user_id：每片只扛 1/4；跨全表：每片都被打
  const nowCpu = BASE_CPU + 0.05 * clientConns
  const maxCpu = Math.min(100, Math.max(...nodes.map((n) => n.cpu)))
  const saturated = Math.max(...nodes.map((n) => n.cpu)) > 100
  const qps = Math.round((NOW_QPS * (100 / maxCpu)) / 100) * 100         // 現況 4,000 QPS 讓最忙的一台到 maxCpu → 到 100% 能撐多少；現況 80% ↔ 5,000
  return { clientConns, dbConns, nodes, maxCpu, saturated, qps, load, r, w, partFactor, partsHit: step >= 3 ? (byUser ? 1 : PARTS) : 0, shardsHit, connOver: dbConns > MAX_CONN }
}

const EXPLAIN = [
  { title: '現況：連線先炸，CPU 也快滿', body: ['8 台 API × 每台 20 條 = 160 條連線去搶 max_connections 100，尖峰時拿不到連線的請求直接失敗。CPU 80% 一部分是上百個 backend 程序的切換與閒置成本，但主要還是查詢本身。', '拉「API 台數」看：再加 API 只會讓連線更滿，DB 一點都沒變快。先解連線，因為它最便宜也最急。'] },
  { title: 'pgbouncer：160 條客戶端連線，DB 端只開 20 條', body: [
    'transaction pooling：API 端還是 160 條客戶端連線，但只有「交易進行中」才占用一條真正的伺服器連線，所以 DB 端 20 條就夠。連線數的紅字消失，CPU 少一點。',
    '查詢的成本一點都沒少，能撐的 QPS 幾乎不變——連線池解的是連線，不是算力。',
    'transaction 模式下不能用 session 層的功能（SET、advisory lock、LISTEN、舊版 prepared statement）；程式碼靠這些的話先改掉，不然只能用 session 模式，那就省不到多少。',
  ] },
  { title: '讀寫分離：85% 的讀分到兩台副本', body: ['主庫只剩寫入與複製，讀由兩台副本平分；三台的 CPU 都遠低於原本那一台，能撐的 QPS 變成兩倍多。拉「讀比例」看：讀越多，副本的好處越大；寫越多，主庫還是那一台在扛。', '代價是複製延遲：剛寫完就讀副本可能讀到舊的。要做 read-your-writes——寫後幾秒內讀主庫，或帶 LSN 等副本追上。'] },
  { title: '表分割：5 億列切成 32 個分區，還在同一台', body: [
    '帶 user_id 的查詢只掃 1 個分區：索引變小、VACUUM 一次做一個分區、砍舊資料變成 DROP PARTITION。但 CPU 和寫入還是同一台在扛，所以這一步是「整理」不是「擴展」。',
    '切到「跨全表統計」看：32 個分區全掃，比沒分割還多一點開銷。分區鍵要跟查詢條件一致，選錯就是每個查詢都變 32 倍。',
    '分區鍵怎麼選：查詢都帶 user_id 就 HASH (user_id)；要定期砍舊資料就 RANGE (created_at)。兩種需求都有時，以更常跑的那種查詢為準，另一種用索引撐。',
  ] },
  { title: '分片：依 user_id 切到 4 台，每台各自一整套', body: [
    '每個分片都是「主 + 讀副本 + pgbouncer」；帶 user_id 的查詢只打 1 台，讀、寫、儲存容量都 ×4，是唯一能突破單機寫入上限的做法。',
    '切到「跨全表統計」：每個查詢要打 4 台再合併，容量回到原點；跨分片 JOIN 與交易更是做不到。備份、migration、重新分片全部 ×4——這是最後手段。',
    '動手前的前提：前三步都做了、機器也升到頂；主鍵改用全域唯一的 ID（UUIDv7 或 snowflake），跨片交易改成 saga 或設計成不需要。',
  ] },
]

export default function DbScalingScenarioLab() {
  const { step, setStep, playing, toggle } = usePlayer(STAGES.length, 2200)
  const [api, setApi] = useState(8)
  const [per, setPer] = useState(20)
  const [readPct, setReadPct] = useState(85)
  const [query, setQuery] = useState('user')
  const [ryw, setRyw] = useState('none')         // read-your-writes 策略：none | sticky（寫後幾秒讀主庫）| lsn（帶 LSN 等副本追上）
  const [rywRes, setRywRes] = useState(null)     // 按下「建立訂單 → 馬上列出」後的結果
  const m = useMemo(() => model(step, api, per, readPct, query), [step, api, per, readPct, query])
  const ex = EXPLAIN[step]
  const lines = mathLines(step, api, per, m, query)

  return (
    <Lab accent="violet" kicker="SCENARIO LAB" title="同一台快撐不住的 PostgreSQL，四步疊上去看每一步解了什麼"
         blurb="按「下一步」逐階段加上連線池、讀副本、分區、分片；拉 API 台數、每台連線、讀比例，切查詢型態，看連線數、CPU、能撐的 QPS 與複雜度怎麼變。">
      <LabControls>
        <Stepper step={step} total={STAGES.length} onStep={setStep} playing={playing} onPlay={toggle} labels={STAGES} />
      </LabControls>
      <LabControls>
        <Slider label="API 台數" min={2} max={16} value={api} onChange={setApi} format={(v) => `${v} 台`} />
        <Slider label="每台連線" min={5} max={40} step={5} value={per} onChange={setPer} format={(v) => `${v} 條`} />
        {step >= 2 && <Slider label="讀的比例" min={50} max={99} value={readPct} onChange={setReadPct} format={(v) => `讀 ${v}% / 寫 ${100 - v}%`} />}
        {step >= 3 && <Seg label="查詢型態" tinted value={query} onChange={setQuery} options={[{ value: 'user', label: '帶 user_id' }, { value: 'all', label: '跨全表統計' }]} />}
      </LabControls>
      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabStage label="拓樸與負載" caption={`${STAGES[step]}：${m.nodes.length}${step === 4 ? ` 種節點 × ${SHARDS} 片` : ' 個節點'}（CPU、連線、QPS 皆為示意）`}>
            <TopoSvg step={step} api={api} per={per} m={m} />
          </LabStage>
          <Stats min={140}>
            <Stat label="客戶端連線" value={`${m.clientConns} 條`} note={step >= 1 ? '接到 pgbouncer' : '直連 DB'} />
            <Stat label={`DB 端連線 / 上限${step === 4 ? '（每片）' : ''}`} value={`${m.dbConns} / ${MAX_CONN}`} tone={m.connOver ? 'bad' : ''} note={m.connOver ? `${m.dbConns - MAX_CONN} 條拿不到，請求失敗` : ''} />
            <Stat label="最忙節點 CPU" value={`${Math.round(m.maxCpu)}%`} tone={m.maxCpu >= 75 ? 'bad' : m.maxCpu >= 55 ? 'warn' : ''} note={m.saturated ? '飽和：請求排隊、延遲飆高' : ''} />
            <Stat label="能撐的 QPS（示意）" value={fmtN(m.qps)} note={`現況 ${fmtN(NOW_QPS)}`} />
            <Stat label="複雜度" value={COMPLEXITY[step]} tone={step === 4 ? 'bad' : ''} />
            <Stat label={step === 4 ? '一個查詢打幾片' : '一個查詢掃幾個分區'} value={step >= 3 ? (step === 4 ? `${m.shardsHit} / ${SHARDS}` : `${m.partsHit} / ${PARTS}`) : '—'} tone={(step === 4 ? m.shardsHit > 1 : m.partsHit > 1) ? 'bad' : ''} />
          </Stats>
          <div className="dbs-math" aria-label="這一階段的算式">
            {lines.map((l, i) => <div key={i}><span className="k">{i + 1}</span>{l}</div>)}
          </div>
          {step >= 2 && (
            <div className="dbs-ryw">
              <Seg label="read-your-writes" value={ryw} onChange={(v) => { setRyw(v); setRywRes(null) }} options={[
                { value: 'none', label: '不處理' }, { value: 'sticky', label: '寫後 3 秒讀主庫' }, { value: 'lsn', label: '帶 LSN 等副本' },
              ]} />
              <button type="button" className="btn ghost small" onClick={() => setRywRes(ryw)}>建立訂單 → 馬上列出訂單</button>
              {rywRes === 'none' && <Status>讀到副本：複製延遲約 100–500 ms，剛建的訂單不在列表裡</Status>}
              {rywRes === 'sticky' && <Status ok>3 秒內都讀主庫：列表含剛建的訂單；簡單，但主庫多扛一點讀</Status>}
              {rywRes === 'lsn' && <Status ok>副本先等到 replay 過寫入的 LSN 再回：多等約 100 ms，主庫不用扛讀</Status>}
            </div>
          )}
          <LabControls>
            {m.connOver ? <Status>連線超過 max_connections</Status> : <Status ok>連線數 OK</Status>}
            {step >= 2 && <Status warn>複製延遲：寫後讀要處理</Status>}
            {step === 4 && m.shardsHit > 1 && <Status>跨分片：JOIN 與交易做不到</Status>}
            {step === 4 && m.shardsHit === 1 && <Status ok>單片查詢：容量 ×{SHARDS}</Status>}
          </LabControls>
        </div>
        <div className="lab-stack">
          <LabExplain title={ex.title}>{ex.body.map((p, i) => <p key={i}>{p}</p>)}</LabExplain>
          <LabExplain title="怎麼讀這些數字">
            <p>一台扛全部時 CPU ≈ 72% + 每條連線 0.05%；讀寫分離後主庫只算寫入加 5% 複製開銷，副本平分讀；能撐的 QPS 依最忙的那個節點換算（現況 80% 對應 4,000 QPS）。</p>
            <p>絕對值都是示意。要看的是：哪一步讓紅字消失、哪一步讓 QPS 跳、哪一步只是把痛換個地方。</p>
          </LabExplain>
          <Callout title="什麼時候會真的踩到">順序幾乎總是：慢查詢與索引 → 連線池 → 讀寫分離 → 分割 → 垂直升級 → 分片。看到「連線滿了」先問 CPU 幾 %：CPU 低就是連線池；CPU 高才是算力問題。跳過前面直接分片的團隊，通常是被跨分片查詢和 migration ×4 拖垮的。</Callout>
        </div>
      </LabGrid>
      <style>{`
        .dbs-math { font-family: var(--mono); font-size: 0.76rem; color: var(--ink-2); display: grid; gap: 4px; border-left: 3px solid var(--hairline); padding-left: 10px; }
        .dbs-math div { display: flex; gap: 8px; align-items: baseline; }
        .dbs-math .k { flex: none; width: 16px; height: 16px; border-radius: 50%; background: var(--surface-2); color: var(--ink-3); font-size: 0.64rem; display: inline-flex; align-items: center; justify-content: center; }
        .dbs-ryw { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; border: 1px solid var(--hairline); border-radius: var(--radius); padding: 8px 10px; background: var(--surface-1); }
        .dbs-topo { width: 100%; }
        .dbs-topo .box { fill: var(--surface-1); stroke: var(--hairline); stroke-width: 1.5; transition: stroke 0.3s ease; }
        .dbs-topo .box.on { stroke: var(--lab-accent); stroke-width: 2; }
        .dbs-topo .box.bad { stroke: var(--critical); stroke-width: 2; }
        .dbs-topo .api { fill: color-mix(in srgb, var(--c-blue) 18%, var(--surface-1)); stroke: var(--c-blue); stroke-width: 1; }
        .dbs-topo .edge { stroke: var(--ink-3); stroke-width: 1.5; fill: none; transition: stroke 0.3s ease; }
        .dbs-topo .edge.bad { stroke: var(--critical); }
        .dbs-topo .track { fill: var(--surface-2); stroke: var(--hairline); stroke-width: 1; }
        .dbs-topo .fill { transition: height 0.4s ease, y 0.4s ease, fill 0.3s ease; }
        .dbs-topo .cell { fill: var(--surface-2); stroke: var(--hairline); stroke-width: 0.8; transition: fill 0.3s ease; }
        .dbs-topo .cell.hit { fill: var(--lab-accent); }
        .dbs-topo .cell.hot { fill: var(--critical); }
        .dbs-topo .conn { font-family: var(--mono); font-size: 11px; fill: var(--ink-2); }
        .dbs-topo .conn.bad { fill: var(--critical); font-weight: 700; }
        .dbs-topo .pct { font-family: var(--mono); font-size: 11px; font-weight: 700; fill: var(--ink-1); }
        @media (prefers-reduced-motion: reduce) { .dbs-topo .fill, .dbs-topo .box, .dbs-topo .edge, .dbs-topo .cell { transition: none; } }
      `}</style>
    </Lab>
  )
}

const cpuColor = (c) => c >= 75 ? 'var(--critical)' : c >= 55 ? 'var(--warning)' : 'var(--good)'

/* 一個 DB 節點：框 + 直立 CPU 條 + 百分比 */
function DbNode({ x, y, w, h, label, cpu, sub, on = false }) {
  const bh = h - 22, fh = Math.max(2, (Math.min(cpu, 100) / 100) * bh)
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="6" className={`box${on ? ' on' : ''}`} />
      <rect x={x + 10} y={y + 11} width="12" height={bh} rx="2" className="track" />
      <rect x={x + 10} y={y + 11 + bh - fh} width="12" height={fh} rx="2" className="fill" style={{ fill: cpuColor(cpu) }} />
      <text x={x + 30} y={y + 22} className="svg-text">{label}</text>
      <text x={x + 30} y={y + 38} className="pct">CPU {Math.round(cpu)}%</text>
      {sub && <text x={x + 30} y={y + 52} className="svg-text small">{sub}</text>}
    </g>
  )
}

/* 拓樸：左 API 堆疊 → （pgbouncer）→ 右邊 DB 節點；③ 底下畫 32 格分區、④ 畫 2×2 分片 */
function TopoSvg({ step, api, per, m }) {
  const n = Math.min(api, 8)
  const apiY0 = 125 - (n * 20) / 2
  const hasPool = step >= 1
  const midX = hasPool ? 230 : 120
  const connCls = m.connOver ? ' bad' : ''
  const nodesX = 262, nodesW = 280
  const rows = step < 2 ? [{ y: 95, h: 60 }] : [{ y: 12, h: 58 }, { y: 78, h: 58 }, { y: 144, h: 58 }]
  return (
    <svg className="dbs-topo" viewBox="0 0 560 250" role="img" aria-label={`${STAGES[step]} 的拓樸`}>
      <text x="16" y={apiY0 - 8} className="svg-text small">API × {api}（每台 {per} 條）</text>
      {Array.from({ length: n }, (_, i) => <rect key={i} x="16" y={apiY0 + i * 20} width="70" height="16" rx="3" className="api" />)}
      {api > 8 && <text x="51" y={apiY0 + n * 20 + 12} textAnchor="middle" className="svg-text small">…共 {api} 台</text>}
      <path className={`edge${hasPool ? '' : connCls}`} d={`M86 125 H${midX}`} />
      <text x={hasPool ? 110 : 114} y="118" textAnchor="middle" className={`conn${hasPool ? '' : connCls}`}>{m.clientConns} 條</text>
      {hasPool && (
        <g>
          <rect x="135" y="96" width="95" height="58" rx="6" className="box on" />
          <text x="182" y="115" textAnchor="middle" className="svg-text">pgbouncer</text>
          <text x="182" y="131" textAnchor="middle" className="svg-mono">{m.clientConns} → {m.dbConns}</text>
          <text x="182" y="146" textAnchor="middle" className="svg-text small">{step >= 2 ? '每台 DB 各一個' : 'transaction 模式'}</text>
        </g>
      )}
      {step < 4 ? (
        <g>
          {rows.map((r, i) => (
            <g key={i}>
              <path className={`edge${connCls}`} d={`M${midX} 125 C ${midX + 40} 125, ${nodesX - 40} ${r.y + r.h / 2}, ${nodesX} ${r.y + r.h / 2}`} />
              <text x={nodesX - 6} y={r.y + r.h / 2 - 5} textAnchor="end" className={`conn${connCls}`}>{m.dbConns}/{MAX_CONN}</text>
              <DbNode x={nodesX} y={r.y} w={nodesW} h={r.h} label={m.nodes[i].label} cpu={m.nodes[i].cpu} on={step === 2 && i > 0}
                      sub={i === 0 && step >= 3 ? `events 5 億列 → ${PARTS} 個分區` : i === 0 && step < 3 ? 'events 5 億列（單表）' : 'streaming replication'} />
            </g>
          ))}
          {step === 3 && (
            <g>
              {Array.from({ length: PARTS }, (_, k) => (
                <rect key={k} x={nodesX + k * (nodesW / PARTS)} y="214" width={nodesW / PARTS - 1.5} height="14" rx="1.5"
                      className={`cell${m.partsHit === PARTS ? ' hot' : k === 7 ? ' hit' : ''}`} />
              ))}
              <text x={nodesX} y="243" className="svg-text small">events 的 {PARTS} 個分區：這個查詢掃 {m.partsHit} 個{m.partsHit === PARTS ? '（全掃）' : '（partition pruning）'}</text>
            </g>
          )}
        </g>
      ) : (
        <g>
          {Array.from({ length: SHARDS }, (_, k) => {
            const x = 262 + (k % 2) * 150, y = 14 + Math.floor(k / 2) * 116
            const hit = m.shardsHit === SHARDS || k === 1
            return (
              <g key={k}>
                <path className="edge" d={`M${midX} 125 C ${midX + 30} 125, ${x - 30} ${y + 50}, ${x} ${y + 50}`} style={{ opacity: hit ? 1 : 0.25 }} />
                <rect x={x} y={y} width="142" height="104" rx="6" className={`box${hit ? (m.shardsHit === SHARDS ? ' bad' : ' on') : ''}`} />
                <text x={x + 10} y={y + 16} className="svg-text">shard {k} · id % {SHARDS} = {k}</text>
                <DbNode x={x + 8} y={y + 22} w={126} h={36} label="主 + 2 讀" cpu={Math.max(...m.nodes.map((nd) => nd.cpu))} />
                <text x={x + 10} y={y + 74} className="svg-text small">pgbouncer {m.dbConns}/{MAX_CONN}</text>
                <text x={x + 10} y={y + 90} className={`conn${hit && m.shardsHit === SHARDS ? ' bad' : ''}`}>{hit ? (m.shardsHit === SHARDS ? '被打到（scatter）' : '這個查詢打這片') : '沒被打到'}</text>
              </g>
            )
          })}
          <text x="16" y="244" className="svg-text small">{m.shardsHit === SHARDS ? `跨全表：打 ${SHARDS} 片再合併（scatter / gather）；JOIN 與交易跨片做不到` : `帶 user_id：hash 後只打 1 片，其他 ${SHARDS - 1} 片沒感覺；備份、migration 各片各做`}</text>
        </g>
      )}
    </svg>
  )
}

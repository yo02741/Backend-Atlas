import React, { useEffect, useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Slider, Stepper, usePlayer, Callout, Status, useReducedMotion } from '../ui.jsx'

/* 秒殺情境模擬器：
   ① 開賣：N 個請求同時衝向 DB / Redis / 佇列，看賣出、超賣、鎖等待堆積、回應時間、1 秒內有答案的比例
   ② 兩個請求的時序：A、B 都想買最後一件，在四種做法下各自怎麼走
   所有數字都是依固定單位成本推算的示意值，不是量測值 */

const MODES = [
  { value: 'naive', label: '先查再扣' },
  { value: 'atomic', label: '條件 UPDATE' },
  { value: 'redis', label: 'Redis 預扣' },
  { value: 'queue', label: '排隊' },
]
/* 示意用單位成本（毫秒）：全部請求在 arrive 毫秒內到齊；DB 一次更新（含 commit）update；Redis 一個指令 redis；
   佇列 enqueue 回 202；worker 處理一筆成功訂單 worker、庫存見底後丟掉一筆 drain；前端每 poll 毫秒輪詢一次 */
const COST = { arrive: 100, select: 4, update: 1.2, redis: 0.03, net: 2, enqueue: 5, worker: 2, drain: 0.2, poll: 500 }
const POOL = 100

function simulate(mode, n, stock) {
  const lat = new Array(n)
  const outcome = new Array(n)
  let succ = 0, prevEnd = 0, peak = 0, dbWrites = 0, extra = 0
  for (let i = 0; i < n; i++) {
    const arr = (i / n) * COST.arrive
    if (mode === 'naive') {
      // SELECT 讀到的是「已 commit」的庫存：更新以 update 毫秒一筆排隊 commit，讀的人看不到還在路上的扣減
      const committed = Math.min(succ, Math.floor(arr / COST.update))
      if (committed < stock) {
        const start = Math.max(arr + COST.select, prevEnd)
        prevEnd = start + COST.update * 2           // UPDATE 庫存 + INSERT 訂單
        lat[i] = prevEnd - arr; outcome[i] = succ < stock ? 'ok' : 'over'; succ++; dbWrites += 2
        peak = Math.max(peak, succ - committed)
      } else { lat[i] = COST.select + COST.net; outcome[i] = 'fail' }
    } else if (mode === 'atomic') {
      // 所有請求都要拿到那一列的鎖才能評估 WHERE，一個接一個
      const start = Math.max(arr, prevEnd)
      const ok = i < stock
      prevEnd = start + (ok ? COST.update * 2 : COST.update * 0.3)
      lat[i] = prevEnd - arr; outcome[i] = ok ? 'ok' : 'fail'; if (ok) { succ++; dbWrites += 2 }
      peak = Math.max(peak, i + 1 - Math.floor(arr / COST.update))
    } else if (mode === 'redis') {
      const start = Math.max(arr, prevEnd)
      prevEnd = start + COST.redis
      const ok = i < stock
      if (!ok) { prevEnd += COST.redis; extra++ }          // 扣到負數要 INCR 補回
      lat[i] = prevEnd - arr + COST.net; outcome[i] = ok ? 'ok' : 'fail'; if (ok) { succ++; dbWrites++ }
    } else {
      // API 立刻回 202；worker 序列處理；使用者要等到下一次輪詢才知道
      const start = Math.max(arr + COST.enqueue, prevEnd)
      const ok = i < stock
      prevEnd = start + (ok ? COST.worker : COST.drain)
      const known = arr + Math.ceil((prevEnd - arr) / COST.poll) * COST.poll
      lat[i] = known - arr; outcome[i] = ok ? 'ok' : 'fail'; if (ok) { succ++; dbWrites += 2 }
      extra = Math.max(extra, i + 1 - Math.floor(arr / COST.worker))
    }
  }
  const sorted = lat.slice().sort((a, b) => a - b)
  const avg = lat.reduce((a, b) => a + b, 0) / n
  const p95 = sorted[Math.min(n - 1, Math.floor(n * 0.95))]
  const within = lat.filter((v) => v <= 1000).length
  return { sold: Math.min(succ, stock), oversold: Math.max(0, succ - stock), peak: Math.max(0, peak), avg, p95, within, dbWrites, extra, outcome }
}

/* 兩個請求搶最後一件：每種做法 4 步 */
const RACE = {
  naive: [
    { a: 'SELECT → 1', b: 'SELECT → 1', stock: 1, text: 'A、B 幾乎同時送出 SELECT stock，兩邊都讀到 1。這一步本身沒有錯，錯的是接下來拿這個舊值做決定。' },
    { a: '1 > 0，可以買', b: '1 > 0，可以買', stock: 1, text: '程式碼裡的 if stock > 0 在兩台 API 上各自成立。沒有任何鎖擋在中間，因為 SELECT 不鎖列。' },
    { a: 'UPDATE → 0', b: '（還在路上）', stock: 0, text: 'A 的 UPDATE stock = stock - 1 先到，庫存 1 → 0，建訂單。' },
    { a: 'INSERT 訂單', b: 'UPDATE → -1 ✗', stock: -1, bad: true, text: 'B 的 UPDATE 接著到，stock - 1 照做：0 → -1。兩個人都有訂單，庫存卻是負的。這就是超賣，併發越高同時讀到舊值的人越多。' },
  ],
  atomic: [
    { a: 'UPDATE WHERE > 0', b: 'UPDATE WHERE > 0', stock: 1, text: 'A、B 同時送 UPDATE … WHERE id = $1 AND stock > 0。判斷和扣減在同一句裡。' },
    { a: '拿到行鎖 → 0', b: '等鎖 ⏳', stock: 0, text: 'A 先拿到那一列的鎖，1 → 0。B 想改同一列，被擋在鎖上等。' },
    { a: 'COMMIT 放鎖', b: '重查 0 > 0 ✗', stock: 0, text: 'A commit 釋放鎖。B 拿到鎖後，PostgreSQL 用「最新版本」重新評估 WHERE：stock 是 0，條件不成立。' },
    { a: '搶到', b: '0 列 → 沒搶到', stock: 0, text: 'B 的 UPDATE 影響 0 列，RETURNING 沒有東西，程式回「沒搶到」。代價是所有人排在同一把鎖後面。' },
  ],
  redis: [
    { a: 'DECR', b: 'DECR', stock: 1, text: 'A、B 同時送 DECR sale:1001:stock。Redis 單執行緒，指令一個接一個執行，沒有「同時讀到 1」這回事。' },
    { a: 'DECR → 0 ✓', b: '排在 A 之後', stock: 0, text: 'A 的 DECR 回傳 0（≥ 0）→ 搶到。這一步只花一個往返，還沒碰 DB。' },
    { a: 'enqueue 建單', b: 'DECR → -1 ✗', stock: -1, text: 'A 把「建訂單」丟進佇列就回覆使用者。B 的 DECR 回 -1 → 沒搶到。負數是預期中的，不是超賣。' },
    { a: 'worker 寫 DB', b: 'INCR 補回 → 0', stock: 0, text: 'B 送 INCR 把計數器補回 0，之後的人一樣讀到 0。worker 在背景為 A 建訂單並扣 DB 庫存；對帳 job 定期比對兩邊。' },
  ],
  queue: [
    { a: 'enqueue → 202', b: 'enqueue → 202', stock: 1, text: 'API 不處理購買，只把 A、B 放進佇列並回 202「排隊中」。DB 在這一步完全沒有負擔。' },
    { a: 'worker：1 → 0', b: '佇列中等待', stock: 0, text: '單一 worker 取出 A，用條件 UPDATE 扣庫存、建訂單、把結果寫到 result:A。沒有另一個寫入者，所以沒有鎖競爭。' },
    { a: '結果：搶到', b: 'worker：0 列 ✗', stock: 0, text: 'worker 取出 B，UPDATE 影響 0 列，寫 result:B = 沒搶到。' },
    { a: '輪詢拿到 ✓', b: '輪詢拿到 ✗', stock: 0, text: 'A、B 的前端每 500 ms 輪詢一次結果，才知道答案。排在第 800 位的人，要等 worker 消化到他才有結果。' },
  ],
}

const EXPLAIN = {
  naive: { title: '先查再扣：超賣，而且沒有比較快', body: ['每個請求都是「SELECT 看庫存 → 程式判斷 → UPDATE 扣 1」。SELECT 不鎖列，讀到的是已 commit 的值；1,000 個請求在 100 ms 內到齊，而更新在那一列的行鎖上一筆一筆排隊 commit，所以幾乎每個人讀到的庫存都還大於 0，幾乎每個人都「搶到」。', '超賣件數＝「讀到舊值的人數」，跟併發直接相關；而每個搶到的人還是要排那把行鎖，所以尾端一樣慢。把庫存拉大、請求數拉小，超賣會變少但不會歸零——單人測試永遠過，上線第一次秒殺就爆。'] },
  atomic: { title: '條件 UPDATE：正確，但全部排在同一把鎖後面', body: ['判斷與扣減在同一句 SQL 裡，靠那一列的行鎖排隊，庫存永遠不會變負。沒搶到的人也要等到鎖、重新評估 WHERE 才拿到「0 列」。', '所以尾端的回應時間≈成功數 × 更新成本 + 失敗數 × 重查成本，跟請求數成正比；拉到兩三千個，p95 就超過 1 秒。等鎖的請求又同時佔著連線，堆積超過 max_connections 後其他 API 也會排隊。'] },
  redis: { title: 'Redis 預扣：把「誰搶到」的決定搬到記憶體', body: ['DECR 是原子的，Redis 單執行緒一個一個做，每個約幾十微秒，1,000 個請求幾十毫秒內全部有答案。扣到負數的 900 個請求各補一個 INCR，計數器回到 0。', 'DB 只收到 100 筆訂單，而且是 worker 非同步寫的，開賣瞬間資料庫幾乎沒感覺。代價是兩個儲存體：Redis 說搶到、worker 卻沒建成訂單時，要靠對帳 job 補單或退庫存。'] },
  queue: { title: '排隊：DB 只有一個寫入者，但使用者要等輪詢', body: ['API 只做 enqueue，幾毫秒就回 202；worker 依序處理，庫存見底後剩下的請求可以快速標成失敗。沒有鎖競爭、沒有超賣，尖峰再高 API 都不會被拖垮。', '問題是「知道結果」的時間：要等 worker 排到你、再等下一次輪詢。庫存越多、worker 越慢，1 秒內拿到答案的比例就越低。適合接受排隊體驗的場景，不適合要即時回饋的。'] },
}

export default function FlashSaleScenarioLab() {
  const [mode, setMode] = useState('naive')
  const [n, setN] = useState(1000)
  const [stock, setStock] = useState(100)
  const [runId, setRunId] = useState(0)
  const reduced = useReducedMotion()
  const race = usePlayer(4, 1500)
  useEffect(() => { race.setStep(0) }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const sim = useMemo(() => simulate(mode, n, stock), [mode, n, stock])
  const ran = runId > 0
  const ex = EXPLAIN[mode]
  const step = RACE[mode][race.step]
  const pct = Math.round((sim.within / n) * 100)

  return (
    <Lab accent="red" kicker="SCENARIO LAB" title="開賣那一秒：同一批請求，四種做法四種結局"
         blurb="調好請求數與庫存，按「開賣」。切換做法，看超賣件數、鎖等待堆積、回應時間，以及有多少人在 1 秒內知道結果。下方時序圖用兩個請求搶最後一件，逐步走一遍。">
      <LabControls>
        <Seg label="做法" tinted value={mode} onChange={setMode} options={MODES} />
        <Slider label="同時請求數" min={200} max={3000} step={100} value={n} onChange={setN} format={(v) => `${v.toLocaleString()} 個`} />
        <Slider label="庫存" min={20} max={500} step={10} value={stock} onChange={setStock} format={(v) => `${v} 件`} />
      </LabControls>
      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabControls>
            <button type="button" className="btn small" onClick={() => setRunId((k) => k + 1)}>{ran ? '再開賣一次' : '開賣'}</button>
            <button type="button" className="btn ghost small" onClick={() => setRunId(0)} disabled={!ran}>重來</button>
            <span className="spacer" />
            {ran && (sim.oversold > 0 ? <Status>超賣 {sim.oversold} 件</Status> : <Status ok>不超賣</Status>)}
            {ran && (pct >= 99 ? <Status ok>{pct}% 在 1 秒內有答案</Status> : pct >= 80 ? <Status warn>{pct}% 在 1 秒內有答案</Status> : <Status>{pct}% 在 1 秒內有答案</Status>)}
          </LabControls>
          <LabStage label="請求衝向後端的動畫" caption={`${n.toLocaleString()} 個請求在 100 ms 內到齊（示意）。綠＝搶到、紅＝超賣、灰＝沒搶到${n > 1000 ? `；每個點代表 ${Math.ceil(n / 1000)} 個請求` : ''}`}>
            <RushSvg key={runId} mode={mode} n={n} outcome={sim.outcome} run={ran} reduced={reduced} />
          </LabStage>
          <div className="fs-stats" aria-live="polite">
            <Tile label="賣出 / 庫存" value={ran ? `${sim.sold + sim.oversold} / ${stock}` : '—'} bad={ran && sim.oversold > 0} />
            <Tile label="堆積峰值（等鎖 / 等連線）" value={ran ? sim.peak.toLocaleString() : '—'} bad={ran && sim.peak > POOL} note={ran && sim.peak > POOL ? `> 連線上限 ${POOL}` : ''} />
            <Tile label="平均回應" value={ran ? fmt(sim.avg) : '—'} />
            <Tile label="p95 回應" value={ran ? fmt(sim.p95) : '—'} bad={ran && sim.p95 > 1000} />
            <Tile label="DB 寫入次數" value={ran ? sim.dbWrites.toLocaleString() : '—'} />
            <Tile label={mode === 'redis' ? 'DECR 到負數補回' : mode === 'queue' ? '佇列最長' : '沒搶到'} value={ran ? (mode === 'redis' || mode === 'queue' ? sim.extra : n - sim.sold - sim.oversold).toLocaleString() : '—'} />
          </div>
          <LabStage label="兩個請求搶最後一件的時序" caption={step.text}>
            <RaceSvg steps={RACE[mode]} cur={race.step} />
            <div className="fs-step"><Stepper step={race.step} total={4} onStep={race.setStep} playing={race.playing} onPlay={race.toggle} /></div>
          </LabStage>
        </div>
        <div className="lab-stack">
          <LabExplain title={ex.title}>{ex.body.map((p, i) => <p key={i}>{p}</p>)}</LabExplain>
          <LabExplain title="怎麼讀這些數字">
            <p>單位成本是固定假設（DB 一次更新含 commit 1.2 ms、Redis 一個指令 0.03 ms、worker 一筆 2 ms、輪詢間隔 500 ms），所以絕對值只是示意；要看的是切換做法時哪個數字跳、哪個數字不動。</p>
            <p>「堆積峰值」是同一時刻等在那一列行鎖或等連線的請求數；超過 {POOL} 表示連線池已滿，跟秒殺無關的 API 也會跟著排隊。</p>
          </LabExplain>
          <Callout title="什麼時候會真的踩到">限量搶購、折扣碼名額、抽獎名額、課程或活動報名、演唱會票——凡是「數量有限 + 時間公告在前」的東西。平常低流量看不出問題，先查再扣的程式碼會在第一次真正的開賣時超賣。先用一句條件 UPDATE 保底，流量真的到了再把預扣搬到 Redis。</Callout>
        </div>
      </LabGrid>
      <style>{`
        .fs-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
        @media (max-width: 560px) { .fs-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        .fs-tile { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 8px 10px; min-width: 0; }
        .fs-tile .l { font-size: 0.68rem; color: var(--ink-3); letter-spacing: 0.03em; }
        .fs-tile .v { font-family: var(--mono); font-size: 1.05rem; font-weight: 700; color: var(--ink-1); font-variant-numeric: tabular-nums; margin-top: 2px; }
        .fs-tile.bad .v { color: var(--critical); }
        .fs-tile .n { font-size: 0.68rem; color: var(--critical); }
        .fs-rush { width: 100%; }
        .fs-rush .box { fill: var(--surface-1); stroke: var(--hairline); stroke-width: 1.5; }
        .fs-rush .box.hot { stroke: var(--critical); }
        .fs-rush .edge { stroke: var(--ink-3); stroke-width: 1.2; fill: none; }
        .fs-dot { fill: var(--ink-3); opacity: 0.55; }
        .fs-dot.ok { fill: var(--good); opacity: 1; }
        .fs-dot.over { fill: var(--critical); opacity: 1; }
        .fs-dot.fail { fill: var(--ink-3); opacity: 0.45; }
        .fs-dot.fly { animation: fs-fly 0.7s cubic-bezier(0.4, 0, 0.7, 1) both; }
        @keyframes fs-fly { to { transform: translate(var(--dx), var(--dy)); } }
        .fs-race { width: 100%; }
        .fs-race .lane { stroke: var(--hairline); stroke-width: 1; }
        .fs-race .node { fill: var(--surface-1); stroke: var(--hairline); stroke-width: 1.2; }
        .fs-race .node.cur { stroke: var(--lab-accent); stroke-width: 2; }
        .fs-race .node.bad { stroke: var(--critical); fill: color-mix(in srgb, var(--critical) 12%, var(--surface-1)); }
        .fs-race .stock { font-family: var(--mono); font-size: 12px; font-weight: 700; fill: var(--ink-1); }
        .fs-race .stock.neg { fill: var(--critical); }
        .fs-step { display: flex; justify-content: center; margin-top: 10px; }
        @media (prefers-reduced-motion: reduce) { .fs-dot.fly { animation: none; transform: translate(var(--dx), var(--dy)); } }
      `}</style>
    </Lab>
  )
}

const fmt = (ms) => ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`
function Tile({ label, value, bad = false, note = '' }) {
  return <div className={`fs-tile${bad ? ' bad' : ''}`}><div className="l">{label}</div><div className="v">{value}</div>{note && <div className="n">{note}</div>}</div>
}

/* 請求衝向後端：最多畫 1,000 個點，起點在左側使用者區，終點排進目標框 */
const rnd = (i, s) => { const v = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453; return v - Math.floor(v) }
function RushSvg({ mode, n, outcome, run, reduced }) {
  const dots = Math.min(n, 1000)
  const per = n / dots
  const target = mode === 'redis' ? { x: 330, w: 130, label: 'Redis', sub: 'DECR sale:1001:stock' }
    : mode === 'queue' ? { x: 330, w: 130, label: '佇列', sub: 'API 只 enqueue，回 202' }
    : { x: 400, w: 160, label: 'PostgreSQL', sub: 'items 的那一列（行鎖）' }
  const COLS = 25, rows = Math.ceil(dots / COLS)
  const cw = (target.w - 16) / COLS, ch = Math.min(5, 176 / Math.max(rows, 1))
  const cls = (i) => outcome[Math.min(n - 1, Math.floor(i * per))]
  return (
    <svg className="fs-rush" viewBox="0 0 640 270" role="img" aria-label={`${n} 個請求衝向 ${target.label}`}>
      <text x="64" y="16" textAnchor="middle" className="svg-text small">使用者 × {n.toLocaleString()}</text>
      <rect x="150" y="95" width="90" height="80" rx="6" className="box" />
      <text x="195" y="130" textAnchor="middle" className="svg-text">API</text>
      <text x="195" y="146" textAnchor="middle" className="svg-text small">多台實例</text>
      <path className="edge" d="M118 135 H150" /><path className="edge" d={`M240 135 H${target.x}`} />
      <rect x={target.x} y="40" width={target.w} height="212" rx="6" className={`box${mode === 'naive' || mode === 'atomic' ? ' hot' : ''}`} />
      <text x={target.x + target.w / 2} y="58" textAnchor="middle" className="svg-text">{target.label}</text>
      <text x={target.x + target.w / 2} y="72" textAnchor="middle" className="svg-text small">{target.sub}</text>
      {(mode === 'redis' || mode === 'queue') && (
        <g>
          <path className="edge svg-dash" d="M460 146 H500" />
          <rect x="500" y="100" width="124" height="92" rx="6" className="box" />
          <text x="562" y="132" textAnchor="middle" className="svg-text">PostgreSQL</text>
          <text x="562" y="148" textAnchor="middle" className="svg-text small">{mode === 'redis' ? 'worker 非同步建訂單' : '單一 worker 寫入'}</text>
          <text x="562" y="164" textAnchor="middle" className="svg-text small">只收到成功的那些</text>
        </g>
      )}
      {Array.from({ length: dots }, (_, i) => {
        const sx = 18 + rnd(i, 1) * 96, sy = 26 + rnd(i, 2) * 222
        const ex = target.x + 8 + (i % COLS) * cw + cw / 2, ey = 84 + Math.floor(i / COLS) * ch + ch / 2
        const c = run ? cls(i) : ''
        return <circle key={i} className={`fs-dot ${c}${run ? ' fly' : ''}`} cx={sx} cy={sy} r={1.8}
                       style={{ '--dx': `${(ex - sx).toFixed(1)}px`, '--dy': `${(ey - sy).toFixed(1)}px`, animationDelay: run && !reduced ? `${((i / dots) * 0.7).toFixed(2)}s` : '0s' }} />
      })}
      {!run && <text x="320" y="262" textAnchor="middle" className="svg-text small">按「開賣」讓請求衝出去</text>}
    </svg>
  )
}

/* 兩條泳道、四個步驟；底下一列是 stock 的值 */
function RaceSvg({ steps, cur }) {
  const X0 = 70, CW = 140
  return (
    <svg className="fs-race" viewBox="0 0 640 150" role="img" aria-label="兩個請求的時序">
      {[['請求 A', 40], ['請求 B', 88]].map(([l, y]) => (
        <g key={l}>
          <text x="8" y={y + 4} className="svg-text small">{l}</text>
          <line x1={X0 - 6} x2="632" y1={y} y2={y} className="lane" />
        </g>
      ))}
      <text x="8" y="132" className="svg-text small">stock</text>
      {steps.map((s, k) => {
        const x = X0 + k * CW
        const shown = k <= cur
        return (
          <g key={k} style={{ opacity: shown ? 1 : 0.18, transition: 'opacity 0.3s ease' }}>
            {[[s.a, 40], [s.b, 88]].map(([t, y], j) => (
              <g key={j}>
                <rect x={x} y={y - 13} width={CW - 12} height="26" rx="5" className={`node${k === cur ? ' cur' : ''}${s.bad && j === 1 && k === cur ? ' bad' : ''}`} />
                <text x={x + (CW - 12) / 2} y={y + 4} textAnchor="middle" className="svg-mono">{t}</text>
              </g>
            ))}
            <text x={x + (CW - 12) / 2} y="132" textAnchor="middle" className={`stock${s.stock < 0 ? ' neg' : ''}`}>{s.stock}</text>
            {k < 3 && <text x={x + CW - 6} y="132" textAnchor="middle" className="svg-text small">→</text>}
          </g>
        )
      })}
    </svg>
  )
}

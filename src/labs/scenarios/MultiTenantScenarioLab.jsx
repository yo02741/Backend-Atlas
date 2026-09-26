import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Code, Callout, Status, useTicker, Stats, Stat, fmtN, useWidth } from '../ui.jsx'

/* 多租戶隔離模擬器：
   SVG 畫三種佈局（一張表多色列 / 多個 schema 框 / 多個 DB 桶）
   按「跑一次 migration」看要套幾次；「大租戶暴衝查詢」看 noisy neighbor 影響誰；「跨租戶統計」看查詢寫法
   共用表模式：Toggle「忘了加 WHERE tenant_id」看外洩，再 Toggle「開 RLS」看被擋下 */

const TENANTS = [
  { id: 'acme', size: 5, c: 'blue', big: true },
  { id: 'globex', size: 2, c: 'orange' },
  { id: 'initech', size: 2, c: 'aqua' },
  { id: 'umbrella', size: 1, c: 'yellow' },
  { id: 'hooli', size: 1, c: 'magenta' },
  { id: 'stark', size: 1, c: 'violet' },
  { id: 'wayne', size: 1, c: 'green' },
  { id: 'wonka', size: 1, c: 'red' },
]
const ME = 'globex'      // 目前請求的租戶：tenant_id = 42
const ROWS = ['acme', 'globex', 'acme', 'initech', 'acme', 'umbrella', 'acme', 'globex', 'acme', 'hooli', 'acme', 'stark', 'acme', 'globex', 'wayne', 'acme']
const EMP = [['acme', '林 O 安', 'R&D'], ['globex', '陳 O 廷', 'R&D'], ['acme', '張 O 慧', 'R&D'], ['initech', '王 O 翔', 'R&D'], ['globex', '李 O 珊', 'R&D'], ['hooli', '吳 O 豪', 'R&D'], ['acme', '黃 O 雯', 'R&D'], ['stark', '劉 O 恩', 'R&D']]
const tint = (c, pct = 45) => `color-mix(in srgb, var(--c-${c}) ${pct}%, transparent)`
const colorOf = (id) => TENANTS.find((t) => t.id === id).c
/* SVG 版面：桌機 640×256；手機（窄版）改 360 寬，共用表拉長列距、schema / DB 改 2 欄 4 列 */
const VB = { wide: { W: 640, H: 256 }, shared: { W: 360, H: 290 }, boxes: { W: 360, H: 400 } }

const APPROACHES = [
  { value: 'shared', label: '共用表 + tenant_id' },
  { value: 'schema', label: '每租戶一個 schema' },
  { value: 'database', label: '每租戶一個資料庫' },
]
const STATS = {
  shared: { level: 'ok', text: '一句 GROUP BY', code: `-- 以 reporting 角色（BYPASSRLS）跑
SELECT tenant_id,
       count(*) FILTER (WHERE last_login > now() - interval '7 days') AS weekly_active,
       count(*) AS total
FROM employees
GROUP BY tenant_id;` },
  schema: { level: 'warn', text: '300 段 UNION ALL，用腳本產生', code: `SELECT 'acme'   AS tenant, count(*) FROM t_acme.employees   WHERE last_login > now() - interval '7 days'
UNION ALL
SELECT 'globex' AS tenant, count(*) FROM t_globex.employees WHERE last_login > now() - interval '7 days'
UNION ALL
-- … 再接 298 段；schema 一多就改用腳本產生，或 postgres_fdw / 匯進倉儲` },
  database: { level: 'bad', text: '300 個資料庫各跑一次，匯進倉儲', code: `-- 沒有一句 SQL 能跨 300 個資料庫
-- for db in $(list_tenant_dbs); do
--   psql "$db" -Atc "SELECT count(*) FROM employees WHERE last_login > now() - interval '7 days'" >> stats.csv
-- done
-- 或：每個 DB 掛成 postgres_fdw 的 foreign server（×300），或 ETL 進資料倉儲再算` },
}
const EXPLAIN = {
  shared: ['所有租戶擠在同一組表，靠每一列的 tenant_id 分家。隔離是邏輯的：程式每條查詢都要加 WHERE tenant_id——開「忘了加」看少了會怎樣，再開 RLS 看資料庫層怎麼兜底。', 'migration 只要跑一次、統計只要 GROUP BY；代價是 acme 的查詢與其他 299 家共用同一組索引、CPU 與連線池。'],
  schema: ['同一個資料庫、300 個 schema，交易開頭 SET LOCAL search_path 決定看到誰的表。查錯 schema 會「表不存在」，比 tenant_id 多一層保護；單一租戶可以 pg_dump -n 整包搬走。', 'migration 要對每個 schema 各跑一次，一次失敗就是一半新一半舊；幾萬個 relation 讓 planner 統計與 autovacuum 都變慢。仍在同一台實例，noisy neighbor 跟共用表一樣。'],
  database: ['每個租戶一個資料庫（需要時獨立實例），連線字串就是邊界，拿錯連線才會出事。大租戶暴衝只影響自己，法規要求的資料落地、獨立金鑰都做得到。', 'maintenance 乘以 300：備份、監控、連線池、migration 各一份。跨租戶統計等於 ETL。兩個人維運的上限大概是十幾個，不是三百個。'],
}

export default function MultiTenantScenarioLab() {
  const [approach, setApproach] = useState('shared')
  const [tenants, setTenants] = useState(300)
  const [action, setAction] = useState(null)
  const [forgot, setForgot] = useState(false)
  const [rls, setRls] = useState(false)
  const [migrating, setMigrating] = useState(false)
  const [tick, resetTick] = useTicker(migrating, 260)
  const shown = Math.min(8, tenants)
  const steps = approach === 'shared' ? 1 : shown
  useEffect(() => { if (migrating && tick >= steps) setMigrating(false) }, [migrating, tick, steps])
  const runMigrate = () => { setAction('migrate'); resetTick(); setMigrating(true) }
  const pick = (a) => { setAction(a); setMigrating(false) }
  const progress = action === 'migrate' ? Math.min(tick, steps) : 0
  const migDone = action === 'migrate' && tick >= steps
  const box = useRef(null)
  const narrow = useWidth(box, 700) < 520   // 手機：SVG 改窄版 viewBox，字不會被縮到看不清
  const vb = narrow ? (approach === 'shared' ? VB.shared : VB.boxes) : VB.wide

  const migrations = approach === 'shared' ? 1 : tenants
  const minutes = migrations * 2
  const affected = approach === 'database' ? 1 : tenants
  const cost = approach === 'shared' ? 400 : approach === 'schema' ? 400 + tenants * 2 : tenants * 60
  const isolation = approach === 'database' ? ['ok', '高：連線即邊界'] : approach === 'schema' ? ['ok', '中高：查錯只會表不存在'] : rls ? ['ok', '中：RLS 在資料庫層兜底'] : ['warn', '低：靠每條查詢記得加 WHERE']

  // 共用表：忘了 WHERE 的查詢回什麼
  const leak = useMemo(() => {
    if (approach !== 'shared') return null
    const visible = EMP.filter(([t]) => (forgot && !rls) ? true : t === ME)
    const leaked = visible.filter(([t]) => t !== ME).length
    const blocked = forgot && rls ? EMP.filter(([t]) => t !== ME).length : 0
    return { visible, leaked, blocked }
  }, [approach, forgot, rls])
  const sqlText = approach === 'shared'
    ? `${rls ? "SET LOCAL app.tenant_id = '42';\n" : ''}SELECT name, department FROM employees\nWHERE department = 'R&D'${forgot ? '' : '\n  AND tenant_id = 42'};`
    : approach === 'schema' ? "SET LOCAL search_path TO t_globex, public;\nSELECT name, department FROM employees   -- 解析成 t_globex.employees\nWHERE department = 'R&D';"
    : "-- 連線字串：postgres://app@db-globex/hr\nSELECT name, department FROM employees\nWHERE department = 'R&D';"

  return (
    <Lab accent="violet" kicker="SCENARIO LAB" title="三種佈局，同一組操作：migration、暴衝查詢、忘了加 WHERE、跨租戶統計"
         blurb="切換佈局後按下面的按鈕，看同一件事在三種佈局下各自的代價。時間與成本為示意。">
      <LabControls>
        <Seg tinted label="佈局" value={approach} onChange={setApproach} options={APPROACHES} />
        <span className="spacer" />
        <Slider label="租戶數" min={5} max={300} step={5} value={tenants} onChange={setTenants} format={(v) => `${v} 家`} />
      </LabControls>
      <LabControls>
        <button className="btn small" onClick={runMigrate} disabled={migrating}>{migrating ? '套用中…' : '跑一次 migration'}</button>
        <button className="btn small" onClick={() => pick('burst')}>大租戶暴衝查詢</button>
        <button className="btn small" onClick={() => pick('stats')}>跨租戶統計</button>
        {approach === 'shared' && <Toggle label="忘了加 WHERE tenant_id" checked={forgot} onChange={setForgot} />}
        {approach === 'shared' && <Toggle label="開 RLS" checked={rls} onChange={setRls} />}
      </LabControls>
      <LabGrid>
        <div className="lab-stack">
          <LabStage label="資料佈局" caption={captionOf(approach, action, tenants, progress, steps, migDone)}>
            <div ref={box}>
              <svg viewBox={`0 0 ${vb.W} ${vb.H}`} width="100%" className="mt-svg" role="img" aria-label={`多租戶資料佈局：${approach === "shared" ? "共用表，以 tenant_id 隔離" : approach === "schema" ? "每租戶一個 schema" : "每租戶一個資料庫"}`}>
                {approach === 'shared' && <SharedSvg burst={action === 'burst'} mig={action === 'migrate'} done={migDone} leak={leak} forgot={forgot} rls={rls} narrow={narrow} />}
                {approach === 'schema' && <BoxesSvg kind="schema" shown={shown} tenants={tenants} burst={action === 'burst'} progress={progress} mig={action === 'migrate'} narrow={narrow} />}
                {approach === 'database' && <BoxesSvg kind="database" shown={shown} tenants={tenants} burst={action === 'burst'} progress={progress} mig={action === 'migrate'} narrow={narrow} />}
              </svg>
            </div>
          </LabStage>
          {action === 'migrate' && <MigBar approach={approach} tenants={tenants} progress={progress} steps={steps} done={migDone} />}
          {action === 'stats' ? (
            <div className="mt-panel">
              <div className="mt-panel-h"><b>跨租戶統計：每週活躍員工數</b><Status ok={STATS[approach].level === 'ok'} warn={STATS[approach].level === 'warn'}>{STATS[approach].text}</Status></div>
              <Code lang="sql" title="查詢寫法">{STATS[approach].code}</Code>
            </div>
          ) : (
            <div className="mt-panel">
              <div className="mt-panel-h"><b>目前請求：tenant_id = 42（{ME}）</b>
                {leak && (leak.leaked > 0 ? <Status>外洩 {leak.leaked} 列</Status> : leak.blocked > 0 ? <Status ok>RLS 擋下 {leak.blocked} 列</Status> : <Status ok>只有自己的列</Status>)}
                {approach === 'schema' && <Status ok>search_path 決定看到誰</Status>}
                {approach === 'database' && <Status ok>連線就是邊界</Status>}
              </div>
              <Code lang="sql" title="應用程式送出的查詢">{sqlText}</Code>
              {leak && (
                <ul className="mt-rows">
                  {leak.visible.map(([t, n, d], i) => (
                    <li key={i} className={t !== ME ? 'leak' : ''}><i style={{ background: `var(--c-${colorOf(t)})` }} /><span>{n}</span><span className="muted">{d}</span><span className="who">{t}{t !== ME ? ' ← 別人的' : ''}</span></li>
                  ))}
                </ul>
              )}
              {approach === 'schema' && <p className="mt-note">忘了 SET search_path 會落到 public，那裡沒有 employees：得到的是錯誤，不是別人的列。</p>}
              {approach === 'database' && <p className="mt-note">每個租戶一個連線池；程式拿錯 pool 才會外洩，所以 pool 要以租戶為鍵、不可共用。</p>}
            </div>
          )}
        </div>
        <div className="lab-stack">
          <Stats min={140}>
            <Stat label="隔離強度" value={isolation[1]} tone={isolation[0]} />
            <Stat label="每週 migration 次數" value={fmtN(migrations)} note={`≈ ${minutes < 60 ? `${minutes} 分` : `${(minutes / 60).toFixed(1)} 小時`}（每次 2 分，示意）`} />
            <Stat label="大租戶暴衝影響" value={`${affected} / ${tenants}`} note="家一起變慢" />
            <Stat label="每月成本（示意）" value={`$${fmtN(cost)}`} note={approach === 'shared' ? '1 台實例' : approach === 'schema' ? '1 台，但 relation 數 ×' + tenants : tenants + ' 個最小實例'} />
          </Stats>
          <LabExplain title={APPROACHES.find((a) => a.value === approach).label}>{EXPLAIN[approach].map((p, i) => <p key={i}>{p}</p>)}</LabExplain>
          <Callout title="什麼時候會真的踩到">共用表最常見的事故不是駭客，是一條漏了 tenant_id 的 ORM 查詢、或一支背景工作用了管理員連線——RLS 就是為那一天準備的。schema / database 版最常見的事故是 migration 跑到一半失敗，300 個租戶一半新一半舊。</Callout>
        </div>
      </LabGrid>
      <style>{`
        .mt-svg .stripe { transition: opacity 0.3s ease, stroke 0.3s ease; }
        .mt-svg .hot { stroke: var(--critical); stroke-width: 2; }
        .mt-svg .done { stroke: var(--good); stroke-width: 2; }
        .mt-panel { display: grid; gap: 8px; }
        .mt-panel-h { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 0.82rem; }
        .mt-panel-h .status { font-size: 0.72rem; padding: 2px 8px; }
        .mt-rows { list-style: none; display: grid; gap: 3px; margin: 0; padding: 0; }
        .mt-rows li { display: grid; grid-template-columns: 10px 1fr 1fr auto; align-items: center; gap: 10px; padding: 4px 10px; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); font-family: var(--mono); font-size: 0.74rem; animation: row-in 0.3s ease-out both; }
        .mt-rows li i { width: 10px; height: 10px; border-radius: 50%; }
        .mt-rows li.leak { border-color: var(--critical); background: color-mix(in srgb, var(--critical) 10%, var(--surface-1)); }
        .mt-rows li.leak .who { color: var(--critical); font-weight: 700; }
        .mt-note { font-size: 0.78rem; color: var(--ink-2); }
        .mt-mig { display: grid; gap: 6px; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 10px 12px; }
        .mt-mig-h { display: flex; justify-content: space-between; gap: 10px; font-family: var(--mono); font-size: 0.74rem; }
        .mt-mig-track { height: 10px; border-radius: 3px; background: var(--surface-2); border: 1px solid var(--hairline); overflow: hidden; }
        .mt-mig-fill { height: 100%; transition: width 0.25s ease, background 0.3s ease; }
        .mt-mig .muted { font-size: 0.72rem; }
        @media (prefers-reduced-motion: reduce) { .mt-rows li { animation: none; } }
      `}</style>
    </Lab>
  )
}

/* migration 進度：共用表 1 步；其他每個租戶一步（畫 8 步代表 N 步） */
function MigBar({ approach, tenants, progress, steps, done }) {
  const pct = Math.round((progress / steps) * 100)
  const total = approach === 'shared' ? 1 : tenants
  const elapsed = Math.round((progress / steps) * total * 2)
  return (
    <div className="mt-mig">
      <div className="mt-mig-h"><span>ALTER TABLE employees ADD COLUMN hired_at DATE</span><b>{done ? '完成' : `${pct}%`}</b></div>
      <div className="mt-mig-track"><div className="mt-mig-fill" style={{ width: `${pct}%`, background: done ? 'var(--good)' : 'var(--lab-accent)' }} /></div>
      <p className="muted">套用 {approach === 'shared' ? '1 次' : `${fmtN(total)} 次`} · 已耗時約 {elapsed < 60 ? `${elapsed} 分` : `${(elapsed / 60).toFixed(1)} 小時`}（每次 2 分，示意；可平行，但 schema 版共用同一台 CPU 與 IO）</p>
    </div>
  )
}

function captionOf(approach, action, tenants, progress, steps, done) {
  if (action === 'migrate') return approach === 'shared' ? (done ? 'ALTER TABLE 一次套完，300 家同時升版。' : '套用中…') : `${done ? '套完' : '套用中'} ${Math.min(progress, steps)} / ${Math.min(8, tenants)}（畫 8 個代表 ${tenants} 個），每個各跑一次；一個失敗就是版本不一致。`
  if (action === 'burst') return approach === 'database' ? 'acme 的查詢只佔滿自己的實例，其他租戶無感。' : 'acme 的一支報表查詢佔滿 CPU、IO 與連線池：同一台實例上的所有租戶一起排隊。'
  if (action === 'stats') return '查詢寫法看下方。'
  return approach === 'shared' ? '一張表，每列的顏色是它的 tenant_id；acme 佔了一半以上的列。' : approach === 'schema' ? '一台實例、一個 database、每個租戶一個 schema。' : '每個租戶自己的資料庫。'
}

/* 共用表：16 條多色列（窄版：欄位靠攏、列距 11.5 → 13、格內字 9.5 → 10.5） */
function SharedSvg({ burst, mig, done, leak, forgot, rls, narrow = false }) {
  const leaking = forgot && !rls
  const filtering = forgot && rls
  const L = narrow
    ? { ox: 12, ow: 336, oh: VB.shared.H - 26, tx: 20, cx: [20, 92, 140, 222], sx: 20, sw: 320, sh: 11, pitch: 13, dy: 9, fs: 10.5, ex: 340, ea: 'end' }
    : { ox: 20, ow: 600, oh: 230, tx: 32, cx: [40, 140, 230, 400], sx: 32, sw: 576, sh: 10, pitch: 11.5, dy: 8, fs: 9.5, ex: 560, ea: undefined }
  return (
    <g>
      <rect x={L.ox} y={14} width={L.ow} height={L.oh} rx={6} className={`svg-node${burst ? ' hot' : mig ? (done ? ' done' : ' on svg-pulse') : ''}`} />
      <text x={L.tx} y={34} className="svg-text">employees · 一張表 · 所有租戶{done && mig ? '　✓ migration 套完 1 次' : ''}</text>
      <text x={L.cx[0]} y={52} className="svg-text small">tenant_id</text><text x={L.cx[1]} y={52} className="svg-text small">id</text><text x={L.cx[2]} y={52} className="svg-text small">name</text><text x={L.cx[3]} y={52} className="svg-text small">department</text>
      {ROWS.map((t, i) => {
        const mine = t === ME
        const cls = leaking && !mine ? 'hot' : ''
        const op = filtering && !mine ? 0.18 : 1
        const y = 58 + i * L.pitch + L.dy
        return (
          <g key={i} className="stripe" style={{ opacity: op }}>
            <rect x={L.sx} y={58 + i * L.pitch} width={L.sw} height={L.sh} rx={1.5} fill={tint(colorOf(t), burst && t === 'acme' ? 70 : 40)} className={`${cls}${burst && t === 'acme' ? ' svg-pulse' : ''}`} stroke={cls ? undefined : 'none'} />
            <text x={L.cx[0]} y={y} className="svg-mono" style={{ fontSize: L.fs }}>{t === 'acme' ? 1 : t === 'globex' ? 42 : 7 + i}</text>
            <text x={L.cx[1]} y={y} className="svg-mono" style={{ fontSize: L.fs }}>{1000 + i}</text>
            <text x={L.cx[2]} y={y} className="svg-mono" style={{ fontSize: L.fs }}>{t}</text>
            {leaking && !mine && <text x={L.ex} y={y} textAnchor={L.ea} className="svg-mono" fill="var(--critical)" style={{ fontSize: L.fs }}>外洩</text>}
            {filtering && !mine && <text x={L.ex} y={y} textAnchor={L.ea} className="svg-mono" style={{ fontSize: L.fs }}>policy 擋</text>}
          </g>
        )
      })}
    </g>
  )
}

/* schema 框 / DB 桶：4 × 2（窄版：2 × 4） */
function BoxesSvg({ kind, shown, tenants, burst, progress, mig, narrow = false }) {
  const list = TENANTS.slice(0, shown)
  const isSchema = kind === 'schema'
  const B = narrow
    ? { W: VB.boxes.W, H: VB.boxes.H, ox: 12, ow: 336, oh: VB.boxes.H - 28, tx: 20, cols: 2, x0: 20, px: 170, py: 84, bw: 150 }
    : { W: VB.wide.W, H: VB.wide.H, ox: 20, ow: 600, oh: 230, tx: 32, cols: 4, x0: 36, px: 148, py: 100, bw: 132 }
  return (
    <g>
      {isSchema && <rect x={B.ox} y={14} width={B.ow} height={B.oh} rx={6} className={`svg-node${burst ? ' hot' : ''}`} />}
      {isSchema && <text x={B.tx} y={34} className="svg-text">PostgreSQL 實例 · 1 個 database · {tenants} 個 schema</text>}
      {list.map((t, i) => {
        const col = i % B.cols; const row = Math.floor(i / B.cols)
        const x = B.x0 + col * B.px; const y = (isSchema ? 46 : 22) + row * B.py
        const done = mig && i < progress; const cur = mig && i === progress
        const hot = burst && (isSchema || t.big)
        const cls = `svg-node${hot ? ' hot' : done ? ' done' : cur ? ' on svg-pulse' : ''}`
        const h = t.big ? 76 : 60
        const w = B.bw
        return (
          <g key={t.id} className={hot && t.big ? 'svg-pulse' : ''}>
            {isSchema
              ? <rect x={x} y={y} width={w} height={h} rx={4} className={cls} />
              : <><rect x={x} y={y + 8} width={w} height={h - 8} rx={8} className={cls} /><ellipse cx={x + w / 2} cy={y + 8} rx={w / 2} ry={8} className={cls} /></>}
            <text x={x + 8} y={y + (isSchema ? 16 : 28)} className="svg-mono">{isSchema ? `t_${t.id}` : `db-${t.id}`}</text>
            {Array.from({ length: t.size }, (_, k) => <rect key={k} x={x + 8} y={y + (isSchema ? 24 : 36) + k * 7} width={w - 16 - k * 12} height={4} rx={1} fill={tint(t.c, 55)} />)}
            {done && <text x={x + w - 8} y={y + (isSchema ? 16 : 28)} textAnchor="end" className="svg-mono" fill="var(--good)">✓</text>}
            {hot && t.big && <text x={x + w - 8} y={y + h - 6} textAnchor="end" className="svg-mono" fill="var(--critical)">暴衝</text>}
            {hot && !t.big && <text x={x + w - 8} y={y + h - 6} textAnchor="end" className="svg-mono" fill="var(--critical)">變慢</text>}
          </g>
        )
      })}
      {tenants > 8 && <text x={B.W - 32} y={B.H - 16} textAnchor="end" className="svg-text small">…畫 8 個代表 {tenants} 個{mig ? `，實際要跑 ${tenants} 次` : ''}</text>}
    </g>
  )
}

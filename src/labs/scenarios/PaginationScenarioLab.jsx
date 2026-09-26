import React, { useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Callout, Status, Caption, fmtN } from '../ui.jsx'
import { runSql, resetSchema } from '../../runtime/sql.js'
import { PlanTree, RuntimeStatus } from '../../components/Output.jsx'

/* 分頁情境模擬器：
   ① 翻頁時有新資料：OFFSET 與 cursor 並排，插入 / 刪除後看誰重複、誰漏掉
   ② 深頁的成本：掃過的列數，並可在瀏覽器裡的 PostgreSQL 灌 5 萬筆實測 EXPLAIN ANALYZE
   ③ 排序鍵不唯一：同一秒多筆時 cursor 少了 tie-breaker 會漏 */

const SIZE = 5
function makeRows(n) {
  // id 越大越新；created_at 每筆差 1 分鐘
  return Array.from({ length: n }, (_, k) => ({ id: n - k, t: 1000 + (n - k), body: `評論 #${n - k}` }))
}

export default function PaginationScenarioLab() {
  const [exp, setExp] = useState('drift')
  return (
    <Lab accent="aqua" kicker="SCENARIO LAB" title="分頁三個實驗：翻頁時資料在變、頁數變深、排序鍵撞在一起"
         blurb="三個獨立的小實驗，各自對應一個真正會出事的情況。">
      <LabControls>
        <Seg tinted value={exp} onChange={setExp} options={[
          { value: 'drift', label: '① 翻頁時有新資料' },
          { value: 'deep', label: '② 深頁的成本' },
          { value: 'tie', label: '③ 排序鍵不唯一' },
        ]} />
      </LabControls>
      {exp === 'drift' && <Drift />}
      {exp === 'deep' && <Deep />}
      {exp === 'tie' && <Tie />}
      <style>{`
        .pg2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        @media (max-width: 640px) { .pg2 { grid-template-columns: 1fr; } }
        .pgcol h5 { font-family: var(--sans); font-size: 0.78rem; letter-spacing: 0.06em; color: var(--ink-2); margin-bottom: 6px; display: flex; gap: 8px; align-items: center; }
        .pgcol .q { font-family: var(--mono); font-size: 0.72rem; color: var(--ink-3); margin-bottom: 8px; white-space: pre-wrap; }
        .pgrows { list-style: none; display: grid; gap: 4px; }
        .pgrows li { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 5px 10px; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); font-family: var(--mono); font-size: 0.78rem; }
        .pgrows li.dup { border-color: var(--critical); background: color-mix(in srgb, var(--critical) 10%, var(--surface-1)); }
        .pgrows li.new { border-color: var(--good); }
        .pgrows li .b { font-size: 0.68rem; font-weight: 700; padding: 1px 7px; border-radius: 999px; }
        .pgrows li.dup .b { color: var(--critical); border: 1px solid var(--critical); }
        .pgrows li.new .b { color: var(--good); border: 1px solid var(--good); }
        .pgskip { font-size: 0.78rem; color: var(--critical); margin-top: 6px; }
        .pgstat { display: flex; gap: 14px; font-size: 0.76rem; color: var(--ink-3); margin-top: 8px; flex-wrap: wrap; }
        .pgstat b { color: var(--ink-1); font-family: var(--mono); }
        .pgbar { display: grid; gap: 10px; }
        .pgbar .row { display: grid; grid-template-columns: 90px 1fr 90px; gap: 10px; align-items: center; font-size: 0.8rem; }
        .pgbar .track { height: 18px; background: var(--surface-2); border-radius: 3px; overflow: hidden; border: 1px solid var(--hairline); }
        .pgbar .fill { height: 100%; border-radius: 2px; transition: width 0.3s ease; }
        .pgbar .n { font-family: var(--mono); font-variant-numeric: tabular-nums; text-align: right; }
        .pgbench { margin-top: 14px; display: grid; gap: 10px; }
        .pgbench .res { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        @media (max-width: 760px) { .pgbench .res { grid-template-columns: 1fr; } }
        .pgbench .res > div { border: 1px solid var(--hairline); border-radius: var(--radius); padding: 10px 12px; background: var(--surface-1); }
        .pgbench .res h5 { font-size: 0.8rem; margin-bottom: 4px; display: flex; justify-content: space-between; gap: 8px; }
        .pgbench .res .ms { font-family: var(--mono); font-weight: 700; }
        .pgtie { list-style: none; display: grid; gap: 4px; }
        .pgtie li { display: grid; grid-template-columns: 70px 90px 1fr auto; gap: 10px; align-items: center; padding: 5px 10px; border: 1px solid var(--hairline); border-radius: var(--radius); font-family: var(--mono); font-size: 0.78rem; background: var(--surface-1); }
        .pgtie li.same { background: color-mix(in srgb, var(--c-yellow) 10%, var(--surface-1)); }
        .pgtie li.lost { border-color: var(--critical); }
        .pgtie li.dup2 { border-color: var(--critical); }
        .pgtie .pg { font-size: 0.68rem; font-weight: 700; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--border); color: var(--ink-2); }
        .pgtie .pg.lost { color: var(--critical); border-color: var(--critical); }
      `}</style>
    </Lab>
  )
}

/* ① 翻頁時有新資料
   模擬真實客戶端：畫面上是「上次 fetch 回來的那一頁」（快照），資料庫（db）在背後被插入 / 刪除；
   按「下一頁」才重新查詢，這時才看得到重複或跳過。 */
function fetchOffset(db, pageNo) { return db.slice(pageNo * SIZE, pageNo * SIZE + SIZE) }
function fetchCursor(db, cursor) {
  const after = cursor ? db.filter((r) => r.t < cursor.t || (r.t === cursor.t && r.id < cursor.id)) : db
  return after.slice(0, SIZE)
}
function Drift() {
  const [state, setState] = useState(() => {
    const db = makeRows(18)
    const first = fetchOffset(db, 0)
    return {
      db, log: [], dirty: false,
      off: { pageNo: 1, rows: first.map((r) => ({ r, dup: false })), skipped: [], seen: new Set(first.map((r) => r.id)), lastId: first[first.length - 1].id },
      cur: { rows: first.map((r) => ({ r, dup: false })), seen: new Set(first.map((r) => r.id)), cursor: { t: first[first.length - 1].t, id: first[first.length - 1].id } },
    }
  })
  const { db, off, cur, log, dirty } = state

  const nextPage = () => setState((st) => {
    // OFFSET：用頁碼重查；重複＝已看過；跳過＝上一頁最後一筆之後、這頁第一筆之前、從沒看過的列
    const rowsO = fetchOffset(st.db, st.off.pageNo)
    const li = st.db.findIndex((r) => r.id === st.off.lastId)
    const startIdx = st.off.pageNo * SIZE
    const skipped = li >= 0 && startIdx > li + 1 ? st.db.slice(li + 1, startIdx).filter((r) => !st.off.seen.has(r.id)) : []
    const offRows = rowsO.map((r) => ({ r, dup: st.off.seen.has(r.id) }))
    const seenO = new Set([...st.off.seen, ...rowsO.map((r) => r.id)])
    // Cursor：用最後看過的鍵重查
    const rowsC = fetchCursor(st.db, st.cur.cursor)
    const curRows = rowsC.map((r) => ({ r, dup: st.cur.seen.has(r.id) }))
    const seenC = new Set([...st.cur.seen, ...rowsC.map((r) => r.id)])
    const lastC = rowsC[rowsC.length - 1]
    return {
      ...st, dirty: false,
      off: { pageNo: st.off.pageNo + 1, rows: offRows, skipped, seen: seenO, lastId: rowsO.length ? rowsO[rowsO.length - 1].id : st.off.lastId },
      cur: { rows: curRows, seen: seenC, cursor: lastC ? { t: lastC.t, id: lastC.id } : st.cur.cursor },
    }
  })
  const insert = () => setState((st) => {
    const id = Math.max(...st.db.map((r) => r.id)) + 1
    return { ...st, dirty: true, db: [{ id, t: 1000 + id, body: `評論 #${id}（新）` }, ...st.db], log: [`插入評論 #${id}，排在最前面`, ...st.log].slice(0, 4) }
  })
  const remove = () => setState((st) => {
    if (st.db.length < 2) return st
    const victim = st.db[1]
    return { ...st, dirty: true, db: st.db.filter((r) => r.id !== victim.id), log: [`刪除評論 #${victim.id}（第 2 新的那筆）`, ...st.log].slice(0, 4) }
  })
  const reset = () => setState(() => {
    const db = makeRows(18); const first = fetchOffset(db, 0)
    return { db, log: [], dirty: false,
      off: { pageNo: 1, rows: first.map((r) => ({ r, dup: false })), skipped: [], seen: new Set(first.map((r) => r.id)), lastId: first[first.length - 1].id },
      cur: { rows: first.map((r) => ({ r, dup: false })), seen: new Set(first.map((r) => r.id)), cursor: { t: first[first.length - 1].t, id: first[first.length - 1].id } } }
  })
  const dupOff = off.rows.filter((x) => x.dup).length
  const dupCur = cur.rows.filter((x) => x.dup).length
  const exhausted = off.pageNo * SIZE >= db.length && fetchCursor(db, cur.cursor).length === 0

  return (
    <LabGrid variant="wide">
      <div className="lab-stack">
        <LabControls>
          <button className="btn small" onClick={nextPage} disabled={exhausted}>下一頁 →</button>
          <button className="btn ghost small" onClick={insert}>插入一筆新評論</button>
          <button className="btn ghost small" onClick={remove}>刪除一筆</button>
          <span className="spacer" />
          {dirty && <span className="muted" style={{ fontSize: '0.78rem' }}>資料庫已變動，按「下一頁」看效果</span>}
          <button className="btn ghost small" onClick={reset}>重來</button>
        </LabControls>
        <div className="pg2">
          <div className="pgcol">
            <h5><span className="tag a">A</span> OFFSET · 第 {off.pageNo} 頁 {dupOff > 0 && <Status>重複 {dupOff} 筆</Status>}</h5>
            <p className="q">{`ORDER BY created_at DESC, id DESC\nOFFSET ${(off.pageNo - 1) * SIZE} LIMIT ${SIZE}`}</p>
            <ul className="pgrows">
              {off.rows.map(({ r, dup }) => (
                <li key={r.id} className={dup ? 'dup' : ''}>
                  <span>{r.body}</span>{dup && <span className="b">重複</span>}
                </li>
              ))}
              {!off.rows.length && <li className="muted">（沒有更多）</li>}
            </ul>
            {off.skipped.length > 0 && <p className="pgskip">✕ 被跳過、永遠看不到：{off.skipped.map((r) => `#${r.id}`).join('、')}</p>}
          </div>
          <div className="pgcol">
            <h5><span className="tag b">B</span> Cursor · 已看 {cur.seen.size} 筆 {dupCur > 0 ? <Status>重複 {dupCur} 筆</Status> : <Status ok>不重複不漏</Status>}</h5>
            <p className="q">{`WHERE (created_at, id) < (t${cur.cursor.t}, ${cur.cursor.id})\nORDER BY created_at DESC, id DESC LIMIT ${SIZE}`}</p>
            <ul className="pgrows">
              {cur.rows.map(({ r, dup }) => (
                <li key={r.id} className={dup ? 'dup' : ''}>
                  <span>{r.body}</span>{dup && <span className="b">重複</span>}
                </li>
              ))}
              {!cur.rows.length && <li className="muted">（沒有更多）</li>}
            </ul>
          </div>
        </div>
        <div className="pgstat">
          <span>資料庫共 <b>{db.length}</b> 筆</span>
          <span>OFFSET 已看 <b>{off.seen.size}</b> 筆</span>
          <span>Cursor 已看 <b>{cur.seen.size}</b> 筆</span>
          {log.map((l, i) => <span key={i}>· {l}</span>)}
        </div>
      </div>
      <div className="lab-stack">
        <LabExplain title="同一個「下一頁」，兩種截然不同的結果">
          <p>畫面上是「上次查回來的那一頁」，資料庫在背後被插入或刪除，按「下一頁」重新查詢時才看得到差別。先按「插入一筆新評論」再按「下一頁」：新評論排在最前面，把後面所有列往後推一格，OFFSET 用「跳過幾筆」定位，所以上一頁的最後一筆會再出現一次。刪除則相反：後面的列往前補，OFFSET 直接跳過一筆，使用者永遠看不到它。</p>
          <p>Cursor 記的是「最後看過那一筆的排序鍵」，下一頁查的是「比它更舊的」。前面插入、刪除，都動不到這個邊界。</p>
        </LabExplain>
        <Callout title="什麼時候會真的踩到">列表越活躍越明顯：留言、動態、通知、訂單流水。後台冷資料的表格幾乎不會遇到，所以那裡用 OFFSET 沒關係。</Callout>
      </div>
    </LabGrid>
  )
}

/* ② 深頁的成本 */
const BENCH_SETUP = `
CREATE TABLE comments (id BIGINT PRIMARY KEY, product_id INT NOT NULL, created_at TIMESTAMPTZ NOT NULL, body TEXT NOT NULL);
INSERT INTO comments SELECT g, 1 + g % 10, TIMESTAMPTZ '2026-01-01' + (g || ' seconds')::interval, 'c' FROM generate_series(1, 50000) g;
CREATE INDEX idx_comments_product_created_id ON comments (product_id, created_at DESC, id DESC);
ANALYZE comments;
`
function Deep() {
  const [page, setPage] = useState(200)
  const [busy, setBusy] = useState(false)
  const [bench, setBench] = useState(null)
  const [err, setErr] = useState(null)
  const size = 20
  const offsetRows = page * size
  const max = 2500 * size

  const run = async () => {
    setBusy(true); setErr(null)
    try {
      await resetSchema(BENCH_SETUP, 'pagination-bench')
      const off = `SELECT id, created_at, body FROM comments WHERE product_id = 1 ORDER BY created_at DESC, id DESC OFFSET ${Math.floor(offsetRows / 10)} LIMIT ${size}`
      // product_id = 1 的資料是全部的 1/10，所以 OFFSET 除以 10 才是「同一頁」
      const anchor = await runSql(`SELECT created_at, id FROM comments WHERE product_id = 1 ORDER BY created_at DESC, id DESC OFFSET ${Math.max(0, Math.floor(offsetRows / 10) - 1)} LIMIT 1`)
      if (!anchor.ok) throw new Error(anchor.error)
      const [t, id] = anchor.results[0].rows[0] || []
      const key = `SELECT id, created_at, body FROM comments WHERE product_id = 1 AND (created_at, id) < ('${t instanceof Date ? t.toISOString() : t}', ${id}) ORDER BY created_at DESC, id DESC LIMIT ${size}`
      const [a, b] = await Promise.all([runSql(`EXPLAIN (ANALYZE, FORMAT JSON) ${off}`), runSql(`EXPLAIN (ANALYZE, FORMAT JSON) ${key}`)])
      if (!a.ok) throw new Error(a.error)
      if (!b.ok) throw new Error(b.error)
      setBench({ off: parsePlan(a), key: parsePlan(b), offSql: off, keySql: key })
    } catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
  }

  return (
    <LabGrid variant="wide">
      <div className="lab-stack">
        <LabControls>
          <Slider label="第幾頁（每頁 20 筆）" min={1} max={2500} value={page} onChange={setPage} format={(v) => `第 ${v} 頁`} />
        </LabControls>
        <LabStage>
          <div className="pgbar">
            <div className="row"><span>OFFSET</span><div className="track"><div className="fill" style={{ width: `${Math.max(1, (offsetRows / max) * 100)}%`, background: 'var(--c-orange)' }} /></div><span className="n">掃 {fmtN(offsetRows)} 列</span></div>
            <div className="row"><span>Cursor</span><div className="track"><div className="fill" style={{ width: `${Math.max(1, (size / max) * 100)}%`, background: 'var(--c-aqua)' }} /></div><span className="n">掃 {size} 列</span></div>
          </div>
          <div className="pgbench">
            <LabControls>
              <button className="btn small" onClick={run} disabled={busy}>{busy ? '執行中…' : '在瀏覽器裡的 PostgreSQL 實測（5 萬筆）'}</button>
              <RuntimeStatus kind="sql" />
            </LabControls>
            {err && <pre className="out-pre out-err">{err}</pre>}
            {bench && (
              <div className="res">
                <div>
                  <h5><span>OFFSET</span><span className="ms" style={{ color: 'var(--c-orange)' }}>{bench.off.ms.toFixed(2)} ms · 實際掃 {bench.off.scanned} 列</span></h5>
                  <PlanTree plan={bench.off.plan} />
                </div>
                <div>
                  <h5><span>Cursor</span><span className="ms" style={{ color: 'var(--c-aqua)' }}>{bench.key.ms.toFixed(2)} ms · 實際掃 {bench.key.scanned} 列</span></h5>
                  <PlanTree plan={bench.key.plan} />
                </div>
              </div>
            )}
          </div>
        </LabStage>
      </div>
      <div className="lab-stack">
        <LabExplain title="OFFSET 不是跳過，是讀完再丟掉">
          <p>`OFFSET 4000 LIMIT 20` 資料庫得沿索引走過 4,020 列，把前 4,000 列丟掉。頁數乘以 20 就是成本，使用者捲越深伺服器越忙。</p>
          <p>Cursor 把「上一頁最後一筆的鍵」放進 WHERE，索引直接定位到那個位置往下讀 20 列。第 1 頁與第 2,500 頁的成本一樣。</p>
          <p>實測按鈕會在瀏覽器裡建一張 5 萬筆的表與複合索引，用 `EXPLAIN (ANALYZE)` 跑兩種查詢，數字是真的。</p>
        </LabExplain>
        <Callout title="讀計畫的重點">兩邊都是 Index Scan，差在 OFFSET 那邊的「實際掃過列數」跟著頁數長；cursor 永遠 20 左右。資料量小時毫秒數看不出差別，列數才是趨勢。</Callout>
      </div>
    </LabGrid>
  )
}
function parsePlan(res) {
  const last = res.results[res.results.length - 1]
  let cell = last?.rows?.[0]?.[0]
  if (typeof cell === 'string') { try { cell = JSON.parse(cell) } catch { cell = null } }
  const root = Array.isArray(cell) ? cell[0] : cell
  const plan = root?.Plan || null
  const ms = Number(root?.['Execution Time'] ?? plan?.['Actual Total Time'] ?? 0)
  // 找最深的 scan 節點的實際列數（Limit 之下的 Index Scan）
  let scanned = 0
  const walk = (n) => { if (!n) return; if (/Scan/.test(n['Node Type'] || '')) scanned = Math.max(scanned, Number(n['Actual Rows'] || 0) * Number(n['Actual Loops'] || 1)); (n.Plans || []).forEach(walk) }
  walk(plan)
  return { plan, ms, scanned }
}

/* ③ 排序鍵不唯一 */
const TIE_ROWS = [
  { id: 8, t: '10:00:03' }, { id: 7, t: '10:00:03' },
  { id: 6, t: '10:00:02' }, { id: 5, t: '10:00:02' }, { id: 4, t: '10:00:02' },
  { id: 3, t: '10:00:01' }, { id: 2, t: '10:00:00' }, { id: 1, t: '10:00:00' },
]
function Tie() {
  const [tie, setTie] = useState(false)
  const size = 3
  // 模擬逐頁：只用 created_at 當 cursor 時，條件是 created_at < last.t（會漏掉同秒的其他列）
  const pages = useMemo(() => {
    const out = []
    let last = null
    for (let k = 0; k < 6; k++) {
      const rest = TIE_ROWS.filter((r) => {
        if (!last) return true
        if (tie) return r.t < last.t || (r.t === last.t && r.id < last.id)
        return r.t < last.t
      })
      const pg = rest.slice(0, size)
      if (!pg.length) break
      out.push(pg)
      last = pg[pg.length - 1]
    }
    return out
  }, [tie])
  const pageOf = (id) => pages.findIndex((pg) => pg.some((r) => r.id === id))
  const lost = TIE_ROWS.filter((r) => pageOf(r.id) < 0)

  return (
    <LabGrid variant="wide">
      <div className="lab-stack">
        <LabControls>
          <Toggle label="cursor 加上 id 當 tie-breaker：WHERE (created_at, id) < ($t, $id)" checked={tie} onChange={setTie} />
          <span className="spacer" />
          {lost.length ? <Status>漏掉 {lost.length} 筆</Status> : <Status ok>8 筆全部拿到</Status>}
        </LabControls>
        <LabStage>
          <ul className="pgtie">
            {TIE_ROWS.map((r) => {
              const p = pageOf(r.id)
              const sameSec = TIE_ROWS.filter((x) => x.t === r.t).length > 1
              return (
                <li key={r.id} className={`${sameSec ? 'same' : ''} ${p < 0 ? 'lost' : ''}`}>
                  <span>#{r.id}</span><span>{r.t}</span><span className="muted">{sameSec ? '同一秒有多筆' : ''}</span>
                  <span className={`pg ${p < 0 ? 'lost' : ''}`}>{p < 0 ? '漏掉' : `第 ${p + 1} 頁`}</span>
                </li>
              )
            })}
          </ul>
          <Caption>每頁 3 筆。黃底＝與其他列同一秒；紅框＝任何一頁都不會回傳。</Caption>
        </LabStage>
      </div>
      <div className="lab-stack">
        <LabExplain title="created_at < $last 會把同一秒的兄弟一起排除">
          <p>{"第 1 頁拿到 #8、#7、#6，最後一筆是 10:00:02 的 #6。下一頁若只用 created_at < '10:00:02'，同樣是 10:00:02 的 #5、#4 就被跳過了。用 > 也一樣，只是變成重複。"}</p>
          <p>{"解法是把排序鍵補到唯一：ORDER BY created_at DESC, id DESC，cursor 帶 (created_at, id)，比較用 tuple (created_at, id) < ($t, $id)。索引也要建同樣的欄位順序。"}</p>
        </LabExplain>
        <Callout title="批次匯入最容易撞">同一秒寫入幾百筆是常態（匯入、批次同步、活動開跑）。只要排序欄位可能重複，cursor 就一定要有 tie-breaker。</Callout>
      </div>
    </LabGrid>
  )
}

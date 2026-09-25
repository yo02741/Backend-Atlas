/* 瀏覽器內的 PostgreSQL（PGlite，WASM 版 Postgres，記憶體模式）。
   同一個 db 實例被所有練習共用；每題執行前用 resetSchema 重建 public schema。 */
let dbPromise = null
let status = 'idle'
const listeners = new Set()
export function sqlStatus() { return status }
export function onSqlStatus(fn) { listeners.add(fn); return () => listeners.delete(fn) }
function setStatus(s) { status = s; listeners.forEach((fn) => fn(s)) }

export async function ensureSql() {
  if (!dbPromise) {
    setStatus('loading')
    dbPromise = (async () => {
      try {
        const { PGlite } = await import('@electric-sql/pglite')
        const db = await PGlite.create()
        setStatus('ready')
        return db
      } catch (err) {
        setStatus('error')
        dbPromise = null
        throw err
      }
    })()
  }
  return dbPromise
}

let currentSetupKey = null
/* 重建 schema 並套用題目的 setup SQL；同一份 setup 連續使用時跳過（除非 force） */
export async function resetSchema(setupSql = '', key = null, force = false) {
  const db = await ensureSql()
  const k = key || setupSql
  if (!force && currentSetupKey === k) return db
  await db.exec('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;')
  if (setupSql) await db.exec(setupSql)
  currentSetupKey = k
  return db
}
export function invalidateSchema() { currentSetupKey = null }

/* 執行一段 SQL（可多句）；回傳 { ok, results: [{ fields, rows, affectedRows }], ms, error } */
export async function runSql(sql) {
  let db
  try { db = await ensureSql() } catch (err) {
    return { ok: false, error: `PostgreSQL 執行環境載入失敗：${String(err.message || err)}`, results: [] }
  }
  const t0 = performance.now()
  try {
    const results = await db.exec(sql)
    return { ok: true, results: results.map(normalize), ms: performance.now() - t0 }
  } catch (err) {
    return { ok: false, error: String(err.message || err), results: [], ms: performance.now() - t0 }
  }
}

function normalize(r) {
  const fields = (r.fields || []).map((f) => f.name)
  const rows = (r.rows || []).map((row) => fields.map((f) => row[f]))
  return { fields, rows, affectedRows: r.affectedRows ?? 0 }
}

/* EXPLAIN (FORMAT JSON)：回傳計畫樹（或 null） */
export async function explain(sql) {
  const res = await runSql(`EXPLAIN (FORMAT JSON) ${sql}`)
  if (!res.ok) return { ok: false, error: res.error }
  const last = res.results[res.results.length - 1]
  const cell = last?.rows?.[0]?.[0]
  let plan = cell
  if (typeof cell === 'string') { try { plan = JSON.parse(cell) } catch { plan = null } }
  const root = Array.isArray(plan) ? plan[0]?.Plan : plan?.Plan
  return { ok: Boolean(root), plan: root || null, raw: cell }
}

/* 把值轉成可比較、可顯示的字串 */
export function cellText(v) {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

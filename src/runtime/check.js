/* 練習題的評分邏輯：SQL 比對結果表、Python / JS 跑測試。
   ExerciseRunner 與 verify harness 共用，確保「解答」與「介面」用同一套規則。 */
import { runSql, resetSchema, cellText, ensureSql } from './sql.js'
import { runPython } from './py.js'
import { runJs } from './js.js'

function norm(v) {
  const t = cellText(v)
  if (t === null) return 'NULL'
  const n = Number(t)
  if (t.trim() !== '' && Number.isFinite(n)) return String(n) // '11280.00' 與 '11280' 視為相同
  return t.trim()
}

/* 比對：expect = { columns?, rows, ordered? }；result = { fields, rows } */
export function compareSql(expect, result) {
  if (!result) return { pass: false, message: '沒有查詢結果——最後一句必須是 SELECT。' }
  const fields = result.fields.map((f) => f.toLowerCase())
  let idx
  if (expect.columns?.length) {
    idx = []
    for (const c of expect.columns) {
      const i = fields.indexOf(c.toLowerCase())
      if (i < 0) return { pass: false, message: `結果缺少欄位「${c}」（你的欄位：${result.fields.join(', ') || '無'}）。用 AS 取正確的別名。` }
      idx.push(i)
    }
  } else {
    if (fields.length !== expect.rows[0]?.length) return { pass: false, message: `欄位數不對：預期 ${expect.rows[0]?.length ?? 0} 欄，你的結果有 ${fields.length} 欄。` }
    idx = fields.map((_, i) => i)
  }
  const got = result.rows.map((r) => idx.map((i) => norm(r[i])))
  const want = expect.rows.map((r) => r.map(norm))
  const key = (r) => r.join('\u0001')
  const gotK = expect.ordered ? got.map(key) : got.map(key).sort()
  const wantK = expect.ordered ? want.map(key) : want.map(key).sort()
  const bad = new Set()
  if (gotK.length !== wantK.length || gotK.some((k, i) => k !== wantK[i])) {
    // 標出「多出來或不對」的列（不在預期集合裡的）
    const wantSet = new Set(want.map(key))
    got.forEach((r, i) => { if (!wantSet.has(key(r))) bad.add(i) })
    let message
    if (got.length !== want.length) message = `列數不對：預期 ${want.length} 列，你的結果有 ${got.length} 列。`
    else if (expect.ordered && new Set(gotK).size === new Set(wantK).size && [...gotK].sort().join() === [...wantK].sort().join()) message = '內容對了但順序不對——檢查 ORDER BY。'
    else message = `有 ${bad.size || '部分'} 列與預期不同。`
    return { pass: false, message, badRows: bad }
  }
  return { pass: true, message: `結果正確（${got.length} 列）。` }
}

export async function gradeSql(ex, code) {
  await resetSchema(ex.setup || '', ex.setupKey || null, true)
  const res = await runSql(code)
  const db = await ensureSql()
  // 使用者忘了 COMMIT 或交易中途出錯：把交易收掉，避免污染下一次執行
  try { await db.exec('ROLLBACK') } catch { /* 沒有交易時只是 WARNING */ }
  if (!res.ok) return { pass: false, message: 'SQL 執行錯誤。', error: res.error, sets: res.results }
  let target = res.results[res.results.length - 1] || null
  let verify = null
  if (ex.expect?.query) {
    const v = await runSql(ex.expect.query)
    if (!v.ok) return { pass: false, message: '驗證查詢失敗。', error: v.error, sets: res.results }
    verify = v.results[v.results.length - 1]
    target = verify
  }
  const cmp = compareSql(ex.expect, target)
  // 注意：SQL 的結果集叫 sets，results 保留給 Python / JS 的測試結果
  return { ...cmp, sets: res.results, got: target, verify, expected: { fields: ex.expect.columns || target?.fields || [], rows: ex.expect.rows } }
}

export async function gradePython(ex, code) {
  const res = await runPython(code, ex.tests)
  if (!res.ok) return { pass: false, message: res.timeout ? '執行逾時。' : '程式執行錯誤。', error: res.error, output: res.output }
  const pass = res.results?.length ? res.results.every((r) => r.pass) : false
  return { pass, message: pass ? '全部測試通過。' : '有測試沒通過。', output: res.output, results: res.results }
}

export async function gradeJs(ex, code) {
  const res = await runJs(code, ex.tests)
  if (!res.ok) return { pass: false, message: res.timeout ? '執行逾時。' : '程式執行錯誤。', error: res.error, output: res.output }
  const pass = res.results?.length ? res.results.every((r) => r.pass) : false
  return { pass, message: pass ? '全部測試通過。' : '有測試沒通過。', output: res.output, results: res.results }
}

export function grade(ex, code) {
  if (ex.kind === 'sql') return gradeSql(ex, code)
  if (ex.kind === 'python') return gradePython(ex, code)
  if (ex.kind === 'js') return gradeJs(ex, code)
  return Promise.resolve({ pass: false, message: `未知題型 ${ex.kind}` })
}

/* 只執行不評分（「執行」按鈕） */
export async function runOnly(ex, code) {
  if (ex.kind === 'sql') {
    await resetSchema(ex.setup || '', ex.setupKey || null, true)
    const res = await runSql(code)
    try { (await ensureSql()).exec('ROLLBACK') } catch { /* ignore */ }
    return res
  }
  if (ex.kind === 'python') return runPython(code)
  if (ex.kind === 'js') return runJs(code)
  return { ok: false, error: '未知題型' }
}

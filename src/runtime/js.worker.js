/* JavaScript 練習的沙箱：在 Worker 裡執行，攔截 console，支援 async。
   訊息：{ id, code, tests }；回覆：{ id, ok, output, error, results } */
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

function fmt(v) {
  if (typeof v === 'string') return v
  try { return JSON.stringify(v, null, 0) ?? String(v) } catch { return String(v) }
}
function deepEqual(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => deepEqual(a[k], b[k]))
}
function makeConsole(buf) {
  const push = (...a) => buf.push(a.map(fmt).join(' '))
  return { log: push, info: push, warn: push, error: push, debug: push, table: push }
}
const helpers = `
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assert 失敗') }
const assertEqual = (got, want, msg) => { if (!__deepEqual(got, want)) throw new Error((msg ? msg + '：' : '') + '得到 ' + __fmt(got) + '，預期 ' + __fmt(want)) }
`

self.onmessage = async (e) => {
  const { id, code, tests } = e.data
  const buf = []
  let error = null
  try {
    const fn = new AsyncFunction('console', '__deepEqual', '__fmt', helpers + '\n' + code)
    await fn(makeConsole(buf), deepEqual, fmt)
  } catch (err) {
    error = String(err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n') : err)
  }
  let results = null
  if (!error && Array.isArray(tests) && tests.length) {
    results = []
    for (const t of tests) {
      try {
        // 測試碼包在 block 裡：測試自己宣告的 const 不會與使用者程式碼同名衝突
        const fn = new AsyncFunction('console', '__deepEqual', '__fmt', helpers + '\n' + code + '\n;\n{\n' + t.code + '\n}')
        await fn(makeConsole([]), deepEqual, fmt)
        results.push({ name: t.name, pass: true })
      } catch (err) {
        results.push({ name: t.name, pass: false, error: String(err && err.message ? err.message : err) })
      }
    }
  }
  self.postMessage({ id, ok: !error, output: buf.join('\n').slice(0, 20000), error, results })
}

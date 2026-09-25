/* 主執行緒的 Python runtime 介面：管理 worker、逾時、載入狀態。
   Pyodide 自架在 ./pyodide/（約 13 MB，第一次載入後瀏覽器會快取）。 */
const TIMEOUT_MS = 12000

let worker = null
let seq = 0
const pending = new Map()
let status = 'idle' // idle | loading | ready | error
const listeners = new Set()

export function pyStatus() { return status }
export function onPyStatus(fn) { listeners.add(fn); return () => listeners.delete(fn) }
function setStatus(s) { status = s; listeners.forEach((fn) => fn(s)) }

export function indexURL() {
  return new URL('pyodide/', new URL(import.meta.env.BASE_URL, window.location.href)).href
}

function spawn() {
  worker = new Worker(new URL('./py.worker.js', import.meta.url), { type: 'module' })
  worker.onmessage = (e) => {
    const p = pending.get(e.data.id)
    if (!p) return
    clearTimeout(p.timer)
    pending.delete(e.data.id)
    p.resolve(e.data)
  }
  worker.onerror = (e) => {
    setStatus('error')
    for (const [id, p] of pending) { clearTimeout(p.timer); p.resolve({ id, ok: false, error: `Worker 錯誤：${e.message}` }) }
    pending.clear()
  }
}

function send(msg, timeout = TIMEOUT_MS) {
  if (!worker) spawn()
  const id = ++seq
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      // 沒有 SharedArrayBuffer 就無法中斷 Python，只能砍掉 worker 重來
      worker.terminate(); worker = null; setStatus('idle')
      resolve({ id, ok: false, error: `執行超過 ${timeout / 1000} 秒，已中止——檢查有沒有無窮迴圈。`, output: '', timeout: true })
    }, timeout)
    pending.set(id, { resolve, timer })
    worker.postMessage({ id, ...msg })
  })
}

/* 預先載入（第一次約需數秒） */
export async function ensurePython() {
  if (status === 'ready') return true
  if (status === 'loading') { await new Promise((r) => { const off = onPyStatus((s) => { if (s !== 'loading') { off(); r() } }) }); return status === 'ready' }
  setStatus('loading')
  const res = await send({ type: 'init', indexURL: indexURL() }, 120000)
  setStatus(res.ok ? 'ready' : 'error')
  return res.ok
}

/* 執行使用者程式碼（可附測試）；回傳 { ok, output, error, results } */
export async function runPython(code, tests = null) {
  const ok = await ensurePython()
  if (!ok) return { ok: false, error: 'Python 執行環境載入失敗（可能是網路問題，重新整理再試）。', output: '' }
  return send({ type: 'run', indexURL: indexURL(), code, tests })
}

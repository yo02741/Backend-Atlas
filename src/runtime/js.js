/* 主執行緒的 JS runtime 介面：每次執行用新的 worker（乾淨、可逾時砍掉） */
const TIMEOUT_MS = 8000

export function runJs(code, tests = null) {
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./js.worker.js', import.meta.url), { type: 'module' })
    const timer = setTimeout(() => {
      worker.terminate()
      resolve({ ok: false, error: `執行超過 ${TIMEOUT_MS / 1000} 秒，已中止——檢查有沒有無窮迴圈。`, output: '', timeout: true })
    }, TIMEOUT_MS)
    worker.onmessage = (e) => { clearTimeout(timer); worker.terminate(); resolve(e.data) }
    worker.onerror = (e) => { clearTimeout(timer); worker.terminate(); resolve({ ok: false, error: `Worker 錯誤：${e.message}`, output: '' }) }
    worker.postMessage({ id: 1, code, tests })
  })
}

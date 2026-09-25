/* Python 執行環境（Pyodide）跑在 Web Worker，不卡 UI。
   訊息：{ id, type: 'init' | 'run', indexURL, code, tests }
   回覆：{ id, ok, output, error, results: [{ name, pass, error }] } */
let pyodide = null
let loading = null

async function init(indexURL) {
  if (!loading) {
    loading = (async () => {
      const mod = await import(/* @vite-ignore */ indexURL + 'pyodide.mjs')
      pyodide = await mod.loadPyodide({ indexURL })
      return pyodide
    })()
  }
  return loading
}

/* Pyodide 的錯誤訊息含整段 traceback；只留使用者程式碼相關的最後幾行 */
function tidy(err) {
  const s = String(err && err.message ? err.message : err)
  const lines = s.split('\n').filter((l) => !l.includes('/lib/python') && !l.includes('pyodide') && !l.startsWith('PythonError'))
  return lines.slice(-8).join('\n').trim() || s.slice(-400)
}

self.onmessage = async (e) => {
  const { id, type, indexURL, code, tests } = e.data
  try {
    if (type === 'init') { await init(indexURL); self.postMessage({ id, ok: true }); return }
    const py = await init(indexURL)
    let output = ''
    py.setStdout({ batched: (s) => { output += s + '\n' } })
    py.setStderr({ batched: (s) => { output += s + '\n' } })
    const ns = py.globals.get('dict')()
    let error = null
    try {
      await py.runPythonAsync(code, { globals: ns })
    } catch (err) {
      error = tidy(err)
    }
    let results = null
    if (!error && Array.isArray(tests) && tests.length) {
      results = []
      for (const t of tests) {
        try {
          await py.runPythonAsync(t.code, { globals: ns })
          results.push({ name: t.name, pass: true })
        } catch (err) {
          results.push({ name: t.name, pass: false, error: tidy(err) })
        }
      }
    }
    ns.destroy()
    self.postMessage({ id, ok: !error, output: output.slice(0, 20000), error, results })
  } catch (err) {
    self.postMessage({ id, ok: false, error: tidy(err), output: '' })
  }
}

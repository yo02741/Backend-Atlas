/* 前端題（html、css、vue）的執行環境：沙箱 iframe。只由 check.js、FramePreview、Playground 以 import() 載入。

   iframe：sandbox="allow-scripts allow-forms allow-modals"，不給 allow-same-origin（opaque origin，讀不到網站的
   localStorage、cookie、IndexedDB，也碰不到外殼的 DOM），內容用 srcdoc 組成。和外殼只用 postMessage 溝通，
   外殼只收 source 是該 iframe、runId 相符的訊息（framePrelude.js 列了訊息格式）。

   Vue：public/vendor/vue@<版本>/ 自架（scripts/copy-vendor.mjs）。外殼用同源 fetch 讀一次，轉成 data: URL 放進 import map，
   題目照真實專案寫 import { ref } from 'vue'。data: URL 不受 CORS 限制，dev、preview、GitHub Pages、Firebase 的行為一樣
   （網址直連要伺服器對 null origin 回 Access-Control-Allow-Origin，Vite 的 dev / preview 預設不給）。

   每個測試一個新的 iframe（測試之間互不影響）；每個測試 8 秒逾時，逾時就移除 iframe。
   使用者 JS 的迴圈先經 loopGuard.js 插入 __lp()，主執行緒被連續占用 1.5 秒就在 iframe 裡丟錯：
   沙箱 iframe 可能和外殼同一個執行緒，那時無窮迴圈會讓外殼的計時器也停住。 */
import { createFakeApi } from './fakeApi.js'
import { framePrelude } from './framePrelude.js'
import { guardLoops, guardHtml } from './loopGuard.js'
import { vendorPath } from './versions.js'
import { setFrameStatus } from './frameStatus.js'

export const TEST_TIMEOUT_MS = 8000
export const LOOP_LIMIT_MS = 1500
export const SANDBOX = 'allow-scripts allow-forms allow-modals'
export const DEFAULT_VIEWPORT = 1024
const TEST_HEIGHT = 768

function siteUrl(path) {
  return new URL(path, new URL(import.meta.env.BASE_URL, window.location.href)).href
}

// ── Vue：讀一次 vendor 檔，轉成 data: URL 留在記憶體 ──
const vendor = {}
export function vendorDataUrl(build = 'dev') {
  if (!vendor[build]) {
    setFrameStatus('loading')
    vendor[build] = fetch(siteUrl(vendorPath('vue', build)))
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob() })
      .then((b) => new Promise((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(fr.result)
        fr.onerror = () => reject(fr.error)
        fr.readAsDataURL(new Blob([b], { type: 'text/javascript' }))
      }))
      .then((url) => { setFrameStatus('ready'); return url })
      .catch((err) => { delete vendor[build]; setFrameStatus('error'); throw err })
  }
  return vendor[build]
}
/* 網址直連（import map 的做法 A）：只在伺服器對 null origin 回 CORS 標頭時能用，留給 e2e 比較 */
export function vendorFileUrl(build = 'dev') { return siteUrl(vendorPath('vue', build)) }

export function needsVue(kind, code) {
  return kind === 'vue' || /\bfrom\s*['"]vue['"]|\bimport\s*\(\s*['"]vue['"]\s*\)/.test(code || '')
}

// ── srcdoc ──
const js = (s) => String(s).replace(/<\/script/gi, '<\\/script')
const style = (s) => String(s).replace(/<\/style/gi, '<\\/style')
const lines = (s) => (s.match(/\n/g) || []).length
let seq = 0
const newRunId = () => `run-${Date.now().toString(36)}-${++seq}`

/* kind：html（code 是 body 內容，可含 <style>、<script>）、css（code 是 CSS，套在 ex.html 上）、vue（code 是一個 module）
   ex：題目（html、css、api 欄位）；test：{ name, code, api?, viewport? } 或 null（預覽）；setup：在 ex.api 之前執行的假 API 設定 */
export function buildSrcdoc({ kind, code = '', ex = {}, test = null, runId, mode = 'test', vueUrl = null, setup = '', loopLimit = LOOP_LIMIT_MS }) {
  let pre = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  if (vueUrl) pre += `<script type="importmap">${JSON.stringify({ imports: { vue: vueUrl } })}</script>`
  pre += `<script>(${js(framePrelude)})(__CFG__, ${js(createFakeApi)});</script>`
  for (const s of [setup, ex.api, test?.api]) if (s) pre += `<script>try {\n${js(s)}\n} catch (e) { __frame.setupError(e) }</script>`
  if (ex.css) pre += `<style>${style(ex.css)}</style>`
  if (kind === 'css') pre += `<style>\n${style(code)}\n</style>`
  pre += '</head><body>'
  let user = ''
  if (kind === 'html') { pre += (ex.html || '') + '\n'; user = guardHtml(code) }
  else if (kind === 'css') pre += ex.html || ''
  else if (kind === 'vue') { pre += (ex.html || '<div id="app"></div>') + '<script type="module">\n'; user = js(guardLoops(code)) }
  let post = kind === 'vue' ? '\n</script>' : ''
  if (test) post += `<script type="module">__frame.runTest(${js(JSON.stringify(test.name))}, async () => {\n${js(test.code)}\n})</script>`
  post += '</body></html>'
  const userStart = user ? lines(pre) + 1 : 0
  const userEnd = user ? userStart + lines(user) : 0
  const cfg = JSON.stringify({ runId, mode, userStart, userEnd, loopLimit })
  return { html: pre.replace('__CFG__', () => cfg) + user + post, userStart, userEnd }
}

// ── iframe 與訊息 ──
const handlers = new Map()
let listening = false
function listen() {
  if (listening) return
  listening = true
  window.addEventListener('message', (e) => {
    const d = e.data
    if (!d || typeof d !== 'object' || d.ns !== 'frame' || typeof d.runId !== 'string') return
    const h = handlers.get(d.runId)
    if (!h || !h.iframe.contentWindow || e.source !== h.iframe.contentWindow) return
    h.onMessage(d)
  })
}

let hiddenHost = null
function getHiddenHost() {
  // 交卷用的 iframe：在畫面範圍內但看不見（完全移出畫面的跨來源 iframe，Chromium 會暫停它的 rendering）
  if (!hiddenHost || !hiddenHost.isConnected) {
    hiddenHost = document.createElement('div')
    hiddenHost.className = 'frame-hidden-host'
    hiddenHost.setAttribute('aria-hidden', 'true')
    Object.assign(hiddenHost.style, { position: 'fixed', left: '0', top: '0', width: '0', height: '0', overflow: 'visible', opacity: '0', pointerEvents: 'none', zIndex: '-1' })
    document.body.appendChild(hiddenHost)
  }
  return hiddenHost
}

export function createFrame({ host, html, runId, width, height, onMessage = () => {}, title = '執行結果', hidden = false }) {
  listen()
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', SANDBOX)
  iframe.setAttribute('title', title)
  iframe.className = 'sbx-frame'
  if (hidden) { iframe.tabIndex = -1; Object.assign(iframe.style, { position: 'absolute', left: '0', top: '0', border: '0' }) }
  if (width) iframe.style.width = `${width}px`
  if (height) iframe.style.height = `${height}px`
  handlers.set(runId, { iframe, onMessage })
  iframe.srcdoc = html
  host.appendChild(iframe)
  return {
    iframe,
    runId,
    resize(w, h) { if (w) iframe.style.width = `${w}px`; if (h) iframe.style.height = `${h}px` },
    destroy() { handlers.delete(runId); iframe.remove() },
  }
}

/* 一個測試：看不見的 iframe，等 done 或逾時。回傳 { test: { name, pass, error }, logs, network, errors, timeout? } */
export async function runTest({ kind, code, ex = {}, test, setup = '', timeout = TEST_TIMEOUT_MS, vueUrl, width }) {
  const url = vueUrl !== undefined ? vueUrl : needsVue(kind, code) ? await vendorDataUrl(ex.vueBuild) : null
  const runId = newRunId()
  const { html } = buildSrcdoc({ kind, code, ex, test, runId, mode: 'test', vueUrl: url, setup })
  return new Promise((resolve) => {
    const logs = [], network = [], errors = []
    let frame = null, done = false
    const finish = (out) => {
      if (done) return
      done = true
      clearTimeout(timer)
      frame?.destroy()
      resolve({ ...out, logs, network, errors })
    }
    const timer = setTimeout(() => finish({ timeout: true, test: { name: test.name, pass: false, error: `執行超過 ${timeout / 1000} 秒，已中止：檢查有沒有無窮迴圈，或在等永遠不會成立的條件。` } }), timeout)
    frame = createFrame({
      host: getHiddenHost(), html, runId, hidden: true, title: `測試：${test.name}`,
      width: width || test.viewport || ex.viewport || DEFAULT_VIEWPORT, height: TEST_HEIGHT,
      onMessage: (m) => {
        if (m.type === 'console') logs.push({ level: m.level, text: String(m.text) })
        else if (m.type === 'error') { errors.push(String(m.message)); logs.push({ level: 'error', text: String(m.message) }) }
        else if (m.type === 'network') network.push(m)
        else if (m.type === 'done') finish({ test: { name: test.name, pass: m.test?.pass === true, error: m.test?.pass === true ? null : String(m.test?.error ?? '測試沒有回報結果').slice(0, 2000) } })
      },
    })
  })
}

const fmtLog = (l) => (l.level === 'log' ? l.text : `[${l.level}] ${l.text}`)

/* 一題的所有測試：同時最多跑 concurrency 個 iframe。回傳欄位和 check.js 的 gradeJs 相同 */
export async function gradeFrame(ex, code, { concurrency = 3 } = {}) {
  const tests = ex.tests || []
  let url = null
  if (needsVue(ex.kind, code)) {
    try { url = await vendorDataUrl(ex.vueBuild) } catch (err) { return { pass: false, message: 'Vue 執行環境載入失敗（可能是網路問題，重新整理再試）。', error: String(err && err.message || err) } }
  }
  const runs = new Array(tests.length)
  let next = 0
  const lane = async () => { while (next < tests.length) { const i = next++; runs[i] = await runTest({ kind: ex.kind, code, ex, test: tests[i], vueUrl: url }) } }
  await Promise.all(Array.from({ length: Math.min(concurrency, tests.length) }, lane))
  const results = runs.map((r) => ({ name: r.test.name, pass: r.test.pass, ...(r.test.pass ? {} : { error: r.test.error }) }))
  const pass = results.length > 0 && results.every((r) => r.pass)
  const firstError = runs.find((r) => r.errors.length)?.errors[0] || null
  const shown = runs[results.findIndex((r) => !r.pass)] || runs[0]
  const output = shown && shown.logs.some((l) => l.level !== 'error') ? `（測試「${shown.test.name}」的 Console）\n` + shown.logs.filter((l) => l.level !== 'error').map(fmtLog).join('\n') : ''
  return { pass, message: pass ? '全部測試通過。' : firstError ? '程式執行時有錯誤。' : '有測試沒通過。', error: firstError, output, results }
}

/* 預覽：看得見的 iframe，事件（console、error、network、ready）交給 onEvent。回傳 { iframe, resize, destroy } */
export async function mountPreview(host, { kind, code, ex = {}, setup = '', width, height, onEvent = () => {} }) {
  const url = needsVue(kind, code) ? await vendorDataUrl(ex.vueBuild) : null
  const runId = newRunId()
  const { html } = buildSrcdoc({ kind, code, ex, runId, mode: 'preview', vueUrl: url, setup })
  return createFrame({ host, html, runId, width, height, onMessage: onEvent })
}

/* 只執行、不測試（深入內容的 run 區塊）：載入完成後再等 settle 毫秒，期間沒有未處理的錯誤就算成功 */
export async function runOnce({ kind, code, ex = {}, setup = '', settle = 600, timeout = TEST_TIMEOUT_MS, width = DEFAULT_VIEWPORT }) {
  const url = needsVue(kind, code) ? await vendorDataUrl(ex.vueBuild) : null
  const runId = newRunId()
  const { html } = buildSrcdoc({ kind, code, ex, runId, mode: 'once', vueUrl: url, setup })
  return new Promise((resolve) => {
    const logs = [], network = [], errors = []
    let frame = null, done = false, settleTimer = null
    const finish = (extra = {}) => {
      if (done) return
      done = true
      clearTimeout(timer); clearTimeout(settleTimer)
      frame?.destroy()
      resolve({ ok: !errors.length && !extra.timeout, error: errors[0] || (extra.timeout ? `執行超過 ${timeout / 1000} 秒，已中止` : null), output: logs.map(fmtLog).join('\n'), logs, network, errors, ...extra })
    }
    const timer = setTimeout(() => finish({ timeout: true }), timeout)
    frame = createFrame({
      host: getHiddenHost(), html, runId, hidden: true, width, height: TEST_HEIGHT,
      onMessage: (m) => {
        if (m.type === 'console') logs.push({ level: m.level, text: String(m.text) })
        else if (m.type === 'error') { errors.push(String(m.message)); logs.push({ level: 'error', text: String(m.message) }) }
        else if (m.type === 'network') network.push(m)
        else if (m.type === 'ready') settleTimer = setTimeout(() => finish(), settle)
      },
    })
  })
}

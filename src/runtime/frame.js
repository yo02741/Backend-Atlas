/* 前端題（html、css、vue）的執行環境：沙箱 iframe。只由 check.js、FramePreview、Playground 以 import() 載入。

   iframe：sandbox="allow-scripts allow-forms allow-modals"，不給 allow-same-origin（opaque origin，讀不到網站的
   localStorage、cookie、IndexedDB，也碰不到外殼的 DOM），內容用 srcdoc 組成。和外殼只用 postMessage 溝通，
   外殼只收 source 是該 iframe、runId 相符的訊息（framePrelude.js 列了訊息格式）。

   Vue、Pinia、Vue Router：public/vendor/<套件>@<版本>/ 自架（scripts/copy-vendor.mjs，套件列在 versions.js）。外殼用同源 fetch
   讀一次，轉成 data: URL 放進 import map，題目照真實專案寫 import { ref } from 'vue'、import { defineStore } from 'pinia'。
   data: URL 不受 CORS 限制，dev、preview、GitHub Pages、Firebase 的行為一樣（網址直連要伺服器對 null origin 回
   Access-Control-Allow-Origin，Vite 的 dev / preview 預設不給）。pinia、vue-router 的 import 'vue' 也經同一個 import map
   解析到同一個 data: URL，三者共用一份 Vue。程式碼（使用者的程式與測試）有 import 哪個套件才下載哪個：vue 題一定有 Vue，
   import 'pinia' 或 'vue-router' 時另外加上那個套件；html、css 題沒有 import 就什麼都不下載。

   Vue Router 在 srcdoc 裡用 createMemoryHistory()：srcdoc 文件的網址是 about:srcdoc，但相對網址以外殼的網址為基準。
   createWebHashHistory() 一開始呼叫 history.replaceState(…, '#/')，'#/' 解析成外殼的網址，跨來源而丟 SecurityError，
   router 接著改用 location.replace() 讓 iframe 換頁到外殼的網址，畫面就不見了。prelude 在 beforeunload 送出 navigate，
   測試馬上以「iframe 要換頁」結束，不必等 8 秒逾時（e2e/frame.mjs 有實測）。

   每個測試一個新的 iframe（測試之間互不影響）；每個測試 8 秒逾時，逾時就移除 iframe。
   使用者 JS 的迴圈先經 loopGuard.js 插入 __lp()，主執行緒被連續占用 1.5 秒就在 iframe 裡丟錯：
   沙箱 iframe 可能和外殼同一個執行緒，那時無窮迴圈會讓外殼的計時器也停住。 */
import { createFakeApi } from './fakeApi.js'
import { framePrelude } from './framePrelude.js'
import { guardLoops, guardHtml } from './loopGuard.js'
import { VERSIONS, vendorPath, vendorBuild } from './versions.js'
import { setFrameStatus } from './frameStatus.js'

export const TEST_TIMEOUT_MS = 8000
export const LOOP_LIMIT_MS = 1500
export const SANDBOX = 'allow-scripts allow-forms allow-modals'
export const DEFAULT_VIEWPORT = 1024
const TEST_HEIGHT = 768

function siteUrl(path) {
  // import.meta.env 由 Vite 提供；Node 的單元測試（scripts/test-sandbox.mjs）沒有，當成站台根目錄
  return new URL(path, new URL(import.meta.env?.BASE_URL ?? '/', window.location.href)).href
}

// ── vendor（Vue、Pinia、Vue Router）：每個檔讀一次，轉成 data: URL 留在記憶體 ──
const vendor = {}
let pending = 0
export function vendorDataUrl(pkg = 'vue', build = 'dev') {
  const key = `${pkg}@${vendorBuild(pkg, build)}`
  if (!vendor[key]) {
    pending++
    setFrameStatus('loading')
    vendor[key] = fetch(siteUrl(vendorPath(pkg, build)))
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob() })
      .then((b) => new Promise((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(fr.result)
        fr.onerror = () => reject(fr.error)
        fr.readAsDataURL(new Blob([b], { type: 'text/javascript' }))
      }))
      .then((url) => { if (--pending === 0) setFrameStatus('ready'); return url })
      .catch((err) => { pending--; delete vendor[key]; setFrameStatus('error'); throw err })
  }
  return vendor[key]
}
/* 網址直連（import map 的做法 A）：只在伺服器對 null origin 回 CORS 標頭時能用，留給 e2e 比較 */
export function vendorFileUrl(build = 'dev', pkg = 'vue') { return siteUrl(vendorPath(pkg, build)) }

const importRe = {}
for (const pkg of Object.keys(VERSIONS)) {
  // from 'pinia'、import 'pinia'、import('pinia')；'vue' 不會對到 'vue-router'（引號要緊接在名稱後面）
  importRe[pkg] = new RegExp(`\\bfrom\\s*['"]${pkg}['"]|\\bimport\\s*\\(?\\s*['"]${pkg}['"]`)
}
/* 程式碼 import 了哪些 vendor 套件（versions.js 的 key 順序）。vue 題一定有 vue；pinia、vue-router 本身 import vue，有它們就加上 vue */
export function vendorsFor(kind, code) {
  const src = String(code || '')
  const pkgs = Object.keys(VERSIONS).filter((p) => (p === 'vue' && kind === 'vue') || importRe[p].test(src))
  if (pkgs.length && !pkgs.includes('vue')) pkgs.unshift('vue')
  return pkgs
}
export function needsVue(kind, code) { return vendorsFor(kind, code).includes('vue') }

/* vue-router 的 prod 版偵測不到導航守衛的無窮導向（dev 版才會中止並警告）：守衛連 /login 也導向 /login 時，
   導航一直在 microtask 裡重來，iframe 與外殼一起卡住，記憶體一路漲到分頁被砍（Chromium 實測）。
   import map 的 'vue-router' 因此指到這個包裝模組：其餘照原樣轉出，createRouter 先掛一個計數的守衛，
   同一個 task 裡導航超過 ROUTER_REDIRECT_LIMIT 次就取消這次導航，並丟出說明原因的錯誤。真正的檔案在 ROUTER_REAL。 */
export const ROUTER_REDIRECT_LIMIT = 100
const ROUTER_REAL = '@sandbox/vue-router'
const ROUTER_SHIM = `export * from '${ROUTER_REAL}'
import { createRouter as create } from '${ROUTER_REAL}'
export function createRouter(options) {
  const router = create(options)
  let n = 0, reset = null
  router.beforeEach((to, from) => {
    if (!reset) reset = setTimeout(() => { n = 0; reset = null })
    if (++n <= ${ROUTER_REDIRECT_LIMIT}) return
    n = 0
    const msg = '導航守衛一直導向（最後一次從 "' + from.fullPath + '" 到 "' + to.fullPath + '"），沙箱已中止這次導航：不需要登入的頁面（例如 /login）不要再導向'
    setTimeout(() => { throw new Error(msg) })
    return false
  })
  return router
}
`
const ROUTER_SHIM_URL = 'data:text/javascript;base64,' + btoa(String.fromCharCode(...new TextEncoder().encode(ROUTER_SHIM)))

/* import map 的 imports：{ vue: data:…, pinia: data:… }；什麼都不用時回傳 null（不下載任何 vendor 檔） */
export async function importMapFor(kind, code, build = 'dev') {
  const pkgs = vendorsFor(kind, code)
  if (!pkgs.length) return null
  const urls = await Promise.all(pkgs.map((p) => vendorDataUrl(p, build)))
  const map = Object.fromEntries(pkgs.map((p, i) => [p, urls[i]]))
  if (map['vue-router']) { map[ROUTER_REAL] = map['vue-router']; map['vue-router'] = ROUTER_SHIM_URL }
  return map
}
// 判斷用的程式碼：使用者的程式加上測試（測試可以 await import('pinia')）
const codeOf = (code, tests = []) => [code, ...tests.map((t) => t && t.code)].filter(Boolean).join('\n')

// ── srcdoc ──
const js = (s) => String(s).replace(/<\/script/gi, '<\\/script')
const style = (s) => String(s).replace(/<\/style/gi, '<\\/style')
const lines = (s) => (s.match(/\n/g) || []).length
let seq = 0
const newRunId = () => `run-${Date.now().toString(36)}-${++seq}`

/* kind：html（code 是 body 內容，可含 <style>、<script>）、css（code 是 CSS，套在 ex.html 上）、vue（code 是一個 module）
   ex：題目（html、css、api 欄位）；test：{ name, code, api?, viewport? } 或 null（預覽）；setup：在 ex.api 之前執行的假 API 設定
   imports：import map 的 { 名稱: 網址 }（importMapFor 的結果）；只給 vueUrl 時等於 { vue: vueUrl } */
export function buildSrcdoc({ kind, code = '', ex = {}, test = null, runId, mode = 'test', vueUrl = null, imports = null, setup = '', loopLimit = LOOP_LIMIT_MS }) {
  const map = imports || (vueUrl ? { vue: vueUrl } : null)
  let pre = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  if (map && Object.keys(map).length) pre += `<script type="importmap">${JSON.stringify({ imports: map })}</script>`
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
  // stack 裡的 vendor 是整段 data: URL，prelude 用開頭認出是哪個套件
  const vendors = map ? Object.entries(map).map(([name, url]) => [String(url).slice(0, 120), name.replace(/^@sandbox\//, '')]) : []
  const cfg = JSON.stringify({ runId, mode, userStart, userEnd, loopLimit, vendors })
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
export async function runTest({ kind, code, ex = {}, test, setup = '', timeout = TEST_TIMEOUT_MS, imports, width }) {
  const map = imports !== undefined ? imports : await importMapFor(kind, codeOf(code, [test]), ex.vueBuild)
  const runId = newRunId()
  const { html } = buildSrcdoc({ kind, code, ex, test, runId, mode: 'test', imports: map, setup })
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
        else if (m.type === 'navigate') finish({ test: { name: test.name, pass: false, error: String(m.text) } })
        else if (m.type === 'done') finish({ test: { name: test.name, pass: m.test?.pass === true, error: m.test?.pass === true ? null : String(m.test?.error ?? '測試沒有回報結果').slice(0, 2000) } })
      },
    })
  })
}

const fmtLog = (l) => (l.level === 'log' ? l.text : `[${l.level}] ${l.text}`)

/* 一題的所有測試：同時最多跑 concurrency 個 iframe。回傳欄位和 check.js 的 gradeJs 相同。
   ex.serial：測試會移動焦點（focus()、showModal()、方向鍵移動焦點）的題目一次只跑一個 iframe：
   同時只有一個 iframe 拿得到焦點，並排跑時別的 iframe 會把焦點搶走（觸發 blur、activeElement 不如預期） */
export async function gradeFrame(ex, code, { concurrency = ex.serial ? 1 : 3 } = {}) {
  const tests = ex.tests || []
  let map = null
  try { map = await importMapFor(ex.kind, codeOf(code, tests), ex.vueBuild) } catch (err) { return { pass: false, message: 'Vue 執行環境載入失敗（可能是網路問題，重新整理再試）。', error: String(err && err.message || err) } }
  const runs = new Array(tests.length)
  let next = 0
  const lane = async () => { while (next < tests.length) { const i = next++; runs[i] = await runTest({ kind: ex.kind, code, ex, test: tests[i], imports: map }) } }
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
  const map = await importMapFor(kind, code, ex.vueBuild)
  const runId = newRunId()
  const { html } = buildSrcdoc({ kind, code, ex, runId, mode: 'preview', imports: map, setup })
  return createFrame({ host, html, runId, width, height, onMessage: onEvent })
}

/* 只執行、不測試（深入內容的 run 區塊）：載入完成後再等 settle 毫秒，期間沒有未處理的錯誤就算成功 */
export async function runOnce({ kind, code, ex = {}, setup = '', settle = 600, timeout = TEST_TIMEOUT_MS, width = DEFAULT_VIEWPORT }) {
  const map = await importMapFor(kind, code, ex.vueBuild)
  const runId = newRunId()
  const { html } = buildSrcdoc({ kind, code, ex, runId, mode: 'once', imports: map, setup })
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
        else if (m.type === 'navigate') { errors.push(String(m.text)); finish() }
        else if (m.type === 'ready') settleTimer = setTimeout(() => finish(), settle)
      },
    })
  })
}

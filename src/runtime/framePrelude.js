/* 沙箱 iframe 的 prelude：srcdoc 裡第一個執行的 classic script。frame.js 用 Function.prototype.toString 塞進去，
   所以 framePrelude 必須自給自足（不引用模組裡的其他東西）。
   做的事：console 與錯誤攔截後轉給外殼、localStorage / sessionStorage 的記憶體替身、假 API（window.api 與 window.fetch）、
   迴圈保護 __lp、測試 helper、測試 runner。

   cfg = { runId, mode: 'test' | 'preview' | 'once', userStart, userEnd, loopLimit }
   傳給外殼的訊息（parent.postMessage(msg, '*')，外殼只收 source 是這個 iframe 且 runId 相符的）：
     { ns: 'frame', runId, type: 'console', level: 'log' | 'warn' | 'error', text }
     { ns: 'frame', runId, type: 'network', method, url, status, ms, aborted, network }
     { ns: 'frame', runId, type: 'error', message, stack }
     { ns: 'frame', runId, type: 'ready' }
     { ns: 'frame', runId, type: 'done', test: { name, pass, error } } */
export function framePrelude(cfg, createFakeApi) {
  const W = window
  const post = (msg) => { try { W.parent.postMessage(Object.assign({ ns: 'frame', runId: cfg.runId }, msg), '*') } catch (e) { /* 外殼已經移除 iframe */ } }
  const logs = []
  const errors = []
  const MAX_SENT = 400
  let sent = 0

  // ── 行號：srcdoc 的第幾行 → 使用者程式的第幾行 ──
  const userLine = (line) => (cfg.userStart && line >= cfg.userStart && line <= cfg.userEnd ? line - cfg.userStart + 1 : 0)
  const mapStack = (stack) => String(stack || '')
    .replace(/data:text\/javascript[^\s)]*/g, 'vue')
    .replace(/about:srcdoc:(\d+):(\d+)/g, (m, l, c) => { const u = userLine(Number(l)); return u ? `第 ${u} 行:${c}` : '執行環境' })

  // ── 輸出格式 ──
  const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s)
  function fmt(v) {
    if (typeof v === 'string') return v
    if (v instanceof Error) return `${v.name}: ${v.message}`
    if (typeof v === 'function') return `ƒ ${v.name || ''}()`
    if (typeof v === 'symbol' || typeof v === 'bigint') return String(v)
    if (v && typeof v === 'object') {
      if (W.Element && v instanceof W.Element) return '<' + v.tagName.toLowerCase() + (v.id ? '#' + v.id : '') + '>'
      try {
        const seen = new WeakSet()
        const s = JSON.stringify(v, (k, x) => {
          if (typeof x === 'function') return 'ƒ'
          if (typeof x === 'bigint') return String(x)
          if (x && typeof x === 'object') { if (seen.has(x)) return '[Circular]'; seen.add(x) }
          return x
        })
        return clip(s === undefined ? String(v) : s, 400)
      } catch (e) { return String(v) }
    }
    return String(v)
  }
  function record(level, text) {
    text = clip(text, 2000)
    if (logs.length < 2000) logs.push({ level, text })
    sent++
    if (sent <= MAX_SENT) post({ type: 'console', level, text })
    else if (sent === MAX_SENT + 1) post({ type: 'console', level: 'warn', text: `輸出超過 ${MAX_SENT} 行，之後的不再顯示` })
  }
  // 只送到站上的 Console 面板，不印到瀏覽器的 console：iframe 裡的輸出與錯誤不混進外殼的 DevTools 與 e2e 的錯誤收集
  for (const name of ['log', 'info', 'warn', 'error', 'debug', 'table']) {
    console[name] = function (...args) {
      const text = args.map(fmt).join(' ')
      // dev 版 Vue 每次載入都會印的提醒，對題目沒有資訊
      if (/^You are running a development build of Vue/.test(text)) return
      record(name === 'warn' || name === 'error' ? name : 'log', text)
    }
  }

  // ── 未處理的錯誤 ──
  function report(message, stack) {
    errors.push(message)
    if (logs.length < 2000) logs.push({ level: 'error', text: message })
    post({ type: 'error', message, stack: mapStack(stack).split('\n').slice(0, 5).join('\n') })
  }
  // preventDefault：錯誤已經交給外殼顯示，不再當成瀏覽器的未處理錯誤回報
  W.addEventListener('error', (e) => {
    if (!(e instanceof ErrorEvent)) return
    e.preventDefault()
    const err = e.error
    const line = userLine(e.lineno)
    const msg = (err && err.name ? `${err.name}: ${err.message}` : String(e.message || '錯誤').replace(/^Uncaught /, '')) + (line ? `（第 ${line} 行）` : '')
    report(msg, err && err.stack)
  })
  W.addEventListener('unhandledrejection', (e) => {
    e.preventDefault()
    const r = e.reason
    report('未處理的 Promise 拒絕：' + (r && r.name ? `${r.name}: ${r.message}` : fmt(r)), r && r.stack)
  })

  // ── opaque origin 沒有 storage：記憶體替身（重新執行就清空） ──
  function memStorage() {
    const m = new Map()
    return {
      get length() { return m.size },
      key: (i) => (i >= 0 && i < m.size ? Array.from(m.keys())[i] : null),
      getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
      setItem: (k, v) => { m.set(String(k), String(v)) },
      removeItem: (k) => { m.delete(String(k)) },
      clear: () => { m.clear() },
    }
  }
  for (const name of ['localStorage', 'sessionStorage']) {
    let usable = false
    try { usable = !!W[name] } catch (e) { usable = false }
    if (!usable) { try { Object.defineProperty(W, name, { value: memStorage(), configurable: true, enumerable: true }) } catch (e) { /* ignore */ } }
  }

  // ── 測試模式：alert / confirm / prompt 不能擋住看不見的 iframe ──
  if (cfg.mode !== 'preview') {
    W.alert = (m) => { record('log', `[alert] ${m === undefined ? '' : m}`) }
    W.confirm = (m) => { record('log', `[confirm] ${m === undefined ? '' : m} → 確定`); return true }
    W.prompt = (m, d) => { record('log', `[prompt] ${m === undefined ? '' : m}`); return d === undefined ? '' : String(d) }
  }
  // 表單沒擋預設行為時會讓 iframe 換頁，畫面就不見了：攔下來並提示
  W.addEventListener('submit', (e) => {
    if (!e.defaultPrevented) { e.preventDefault(); record('warn', '表單送出會換頁（沙箱已攔下）：在 submit 處理函式呼叫 event.preventDefault()，Vue 用 @submit.prevent') }
  })

  // ── 迴圈保護：主執行緒連續被占用超過上限就丟錯（loopGuard.js 在每個迴圈插入 __lp()） ──
  const LIMIT = cfg.loopLimit || 1500
  let beat = 0, seen = -1, t0 = 0, count = 0, tripped = false
  setInterval(() => { beat++ }, 50)
  W.__lp = function () {
    if (seen !== beat) { seen = beat; t0 = performance.now(); count = 0; tripped = false; return true }
    if (tripped || ((++count & 15) === 0 && performance.now() - t0 > LIMIT)) {
      tripped = true
      throw new RangeError(`迴圈連續執行超過 ${LIMIT / 1000} 秒，已中止（可能是無窮迴圈）`)
    }
    return true
  }

  // ── 假 API ──
  const api = createFakeApi({
    global: W,
    baseURI: document.baseURI,
    warn: (m) => console.warn(m),
    onCall: (c) => post({ type: 'network', method: c.method, url: c.url, status: c.status, ms: c.ms, aborted: c.aborted, network: c.network }),
  })
  W.api = api
  W.fetch = api.fetch

  // ── 測試 helper（assert / assertEqual 的訊息格式同 js.worker.js） ──
  function deepEqual(a, b) {
    if (a === b) return true
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false
    if (Array.isArray(a) !== Array.isArray(b)) return false
    const ka = Object.keys(a), kb = Object.keys(b)
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]))
  }
  const el = (t) => (typeof t === 'string' ? document.querySelector(t) : t)
  const need = (t) => { const e = el(t); if (!e) throw new Error(`找不到元素 ${typeof t === 'string' ? t : String(t)}`); return e }
  W.assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assert 失敗') }
  W.assertEqual = (got, want, msg) => { if (!deepEqual(got, want)) throw new Error((msg ? msg + '：' : '') + '得到 ' + fmt(got) + '，預期 ' + fmt(want)) }
  W.$ = (sel) => document.querySelector(sel)
  W.$$ = (sel) => Array.from(document.querySelectorAll(sel))
  W.text = (t) => { const e = el(t); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null }
  W.click = (t) => { need(t).click() }
  const setValue = (t, value) => { const e = need(t); if (e.focus) e.focus(); e.value = value; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return e }
  W.input = setValue
  W.select = setValue
  W.check = (t, on = true) => { const e = need(t); if (e.checked !== on) e.click() }
  W.submit = (t) => { const f = need(t); if (f.requestSubmit) f.requestSubmit(); else f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }
  W.press = (t, key) => { const e = need(t); for (const type of ['keydown', 'keyup']) e.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true })) }
  W.tick = () => new Promise((r) => setTimeout(r, 0))
  W.wait = (ms) => new Promise((r) => setTimeout(r, ms))
  W.waitFor = async (fn, opts) => {
    const timeout = (opts && opts.timeout) || 1500
    const start = performance.now()
    let last
    for (;;) {
      try { last = await fn(); if (last) return last } catch (e) { last = e }
      if (performance.now() - start > timeout) {
        const src = String(fn).replace(/^\s*(async\s*)?\(\s*\)\s*=>\s*/, '').slice(0, 160)
        throw new Error(`等了 ${timeout} ms，條件仍不成立：${src}` + (last instanceof Error ? `（${last.message}）` : ''))
      }
      await new Promise((r) => setTimeout(r, 16))
    }
  }
  W.css = (t, prop) => getComputedStyle(need(t)).getPropertyValue(prop).trim()
  W.box = (t) => need(t).getBoundingClientRect()
  W.focus = (t) => { need(t).focus() }
  W.activeElement = () => document.activeElement
  W.logs = logs

  W.__frame = {
    errors,
    setupError(e) { report('題目的假 API 設定錯誤：' + (e && e.message ? e.message : String(e)), e && e.stack) },
    async runTest(name, fn) {
      if (document.readyState === 'loading') await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }))
      await W.tick()
      let pass = true, error = null
      try { await fn() } catch (e) { pass = false; error = e && e.message ? e.message : String(e) }
      // 有未處理的錯誤時先報它：通常是測試失敗的原因（例如模組載入失敗，畫面根本沒出來）
      if (errors.length) { error = '執行時有未處理的錯誤：' + errors[0] + (pass ? '' : `（測試：${error}）`); pass = false }
      post({ type: 'done', test: { name, pass, error } })
    },
  }
  W.addEventListener('load', () => post({ type: 'ready' }))
}

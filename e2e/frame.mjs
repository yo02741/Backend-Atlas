// 前端沙箱執行環境（src/runtime/frame.js）的自我測試：隔離、無窮迴圈、Console 與錯誤、假 API、viewport、表單送出、
// 舊 runId 的訊息、Pinia 與 Vue Router 的懶載入、Element Plus 的懶載入（語系與樣式、共用同一份 Vue）、Tailwind（@tailwindcss/browser）的懶載入與產生完成的等待、
// iframe 換頁、守衛的無窮導向、390px 的預覽窗格。
// 用 ?verify=frame harness 直接呼叫 window.__frame。
// 前置：npm run build && npm run preview。BROWSERS=chromium,firefox,webkit 依序跑（預設 chromium；要先 npx playwright install 對應的瀏覽器）
import { chromium, firefox, webkit } from 'playwright'
import { mkdirSync } from 'node:fs'
import { findExercise } from '../src/content/exercises/index.js'

const base = process.env.E2E_BASE || 'http://localhost:4173/'
const engines = { chromium, firefox, webkit }
const names = (process.env.BROWSERS || 'chromium').split(',').map((s) => s.trim()).filter(Boolean)
mkdirSync('e2e/shots', { recursive: true })
let failed = 0
const t = (label, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${ok ? '' : extra}`) }

for (const name of names) {
  console.log(`\n== ${name}`)
  const browser = await engines[name].launch()
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 200)) })
  await page.goto(base + '?verify=frame', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__frameReady, null, { timeout: 30000 })
  // 一個測試：{ kind, code, ex?, test: { name, code, api?, viewport? } } → { test, logs, network, errors, ms }
  const run = (o) => page.evaluate(async (o) => {
    const t0 = performance.now()
    const r = await window.__frame.runTest({ ex: {}, ...o, test: { name: 't', ...o.test } })
    return { ...r, ms: Math.round(performance.now() - t0) }
  }, o)
  const vue = (body) => `import { createApp, ref, onMounted } from 'vue'\n${body}`

  // ── 隔離：opaque origin，讀不到網站的 localStorage、cookie、IndexedDB，也碰不到外殼的 DOM ──
  await page.evaluate(() => { localStorage.setItem('atlas-sbx-secret', 'top-secret'); document.cookie = 'atlas_sbx=1; path=/' })
  const iso = await run({ kind: 'html', code: '<p id=x>hi</p>', test: { code: `
    const out = {}
    out.origin = window.origin
    out.storage = localStorage.getItem('atlas-sbx-secret')
    localStorage.setItem('k', 'v'); out.shim = localStorage.getItem('k')
    try { out.cookie = document.cookie } catch (e) { out.cookie = 'threw ' + e.name }
    try { out.parentDoc = String(parent.document.title) } catch (e) { out.parentDoc = 'threw ' + e.name }
    try { out.parentStorage = parent.localStorage.getItem('atlas-sbx-secret') } catch (e) { out.parentStorage = 'threw ' + e.name }
    try { indexedDB.open('x'); out.idb = 'opened' } catch (e) { out.idb = 'threw ' + e.name }
    console.log(JSON.stringify(out))` } })
  const isoOut = JSON.parse(iso.logs.find((l) => l.text.startsWith('{'))?.text || '{}')
  t('iframe origin is opaque', isoOut.origin === 'null', JSON.stringify(isoOut))
  t('iframe cannot read the site localStorage (memory stand-in instead)', isoOut.storage === null && isoOut.shim === 'v', JSON.stringify(isoOut))
  t('iframe cannot read the site cookie', !String(isoOut.cookie).includes('atlas_sbx'), JSON.stringify(isoOut))
  t('iframe cannot touch the parent document or its storage', /^threw/.test(isoOut.parentDoc) && /^threw/.test(isoOut.parentStorage), JSON.stringify(isoOut))
  t('iframe cannot open IndexedDB', isoOut.idb !== 'opened', JSON.stringify(isoOut))
  t('sandbox attribute has no allow-same-origin', await page.evaluate(() => !window.__frame.SANDBOX.includes('allow-same-origin') && window.__frame.SANDBOX.includes('allow-scripts')))

  // ── 無窮迴圈：迴圈保護在 iframe 裡中止，外殼不會一直卡住 ──
  for (const [label, kind, code] of [
    ['vue module while (true)', 'vue', vue("let n = 0\nwhile (true) { n++ }\n")],
    ['html script for (;;)', 'html', '<p>x</p>\n<script>\nfor (;;) {}\n</script>'],
    ['click handler loop', 'vue', vue("createApp({ setup() { const go = () => { let i = 0; while (i >= 0) i++ }; return { go } }, template: '<button @click=\"go\">go</button>' }).mount('#app')")],
  ]) {
    const test = label === 'click handler loop' ? { code: "click('button')\nawait tick()" } : { code: 'await tick()' }
    const r = await run({ kind, code, test })
    const alive = await page.evaluate(() => new Promise((res) => setTimeout(() => res(true), 0)))
    t(`infinite loop is stopped (${label})`, !r.test.pass && /迴圈連續執行超過/.test(r.test.error || '') && r.ms < 6000 && alive, `${r.ms}ms ${r.test.error}`)
  }

  // ── Console 與錯誤 ──
  const con = await run({ kind: 'vue', code: vue(`console.log('掛號', { id: 1 })\nconsole.warn('小心')\nconsole.error('壞了')
const Badge = { props: { count: Number }, template: '<button type="button" @click="count++">{{ count }}</button>' }
createApp({ components: { Badge }, template: '<Badge :count="3" />' }).mount('#app')`), test: { code: "click('button')\nawait tick()\nassert(logs.some((l) => l.text.includes('[Vue warn]')), 'logs 裡要有 [Vue warn]')" } })
  t('console.log / warn / error reach the shell', ['log:掛號 {"id":1}', 'warn:小心', 'error:壞了'].every((s) => con.logs.some((l) => `${l.level}:${l.text}` === s)), JSON.stringify(con.logs.slice(0, 5)))
  t('[Vue warn] reaches the shell and the test helper logs', con.test.pass && con.logs.some((l) => l.level === 'warn' && /^\[Vue warn\]: Attempting to mutate prop "count"/.test(l.text)), con.test.error + ' ' + JSON.stringify(con.logs.map((l) => l.text.slice(0, 60))))
  t('the dev-build banner is filtered out', !con.logs.some((l) => /development build of Vue/.test(l.text)))
  const thrown = await run({ kind: 'vue', code: vue("const a = 1\n\nnull.boom\n"), test: { code: 'await tick()' } })
  t('uncaught error is reported with the user line number', thrown.errors.some((e) => /TypeError/.test(e) && /（第 4 行）/.test(e)) && !thrown.test.pass, JSON.stringify(thrown.errors))
  const syntax = await run({ kind: 'vue', code: vue("const a = 1\nconst b = {\n"), test: { code: 'await tick()' } })
  t('syntax error is reported and fails the test', syntax.errors.some((e) => /SyntaxError/.test(e)) && !syntax.test.pass, JSON.stringify(syntax.errors))
  const badImport = await run({ kind: 'vue', code: "import { nope } from 'vue'\n", test: { code: 'await tick()' } })
  t('bad import is reported', badImport.errors.some((e) => /SyntaxError|nope/.test(e)), JSON.stringify(badImport.errors))
  const rejection = await run({ kind: 'html', code: "<script>Promise.reject(new Error('沒人接'))</script>", test: { code: 'await wait(20)' } })
  t('unhandled rejection is reported', rejection.errors.some((e) => /未處理的 Promise 拒絕：Error: 沒人接/.test(e)), JSON.stringify(rejection.errors))
  const htmlLine = await run({ kind: 'html', code: '<p>1</p>\n<p>2</p>\n<script>\nundefinedFn()\n</script>', test: { code: 'await tick()' } })
  t('html script error points at the user line', htmlLine.errors.some((e) => /ReferenceError/.test(e) && /（第 4 行）/.test(e)), JSON.stringify(htmlLine.errors))
  const modal = await run({ kind: 'html', code: "<script>alert('掛號成功'); window.ok = confirm('確定取消？')</script>", test: { code: "assertEqual(window.ok, true)\nassert(logs.some((l) => l.text === '[alert] 掛號成功'))" } })
  t('alert / confirm do not block hidden test frames', modal.test.pass, modal.test.error)

  // ── 假 API：延遲、失敗、abort、網路紀錄回到外殼 ──
  const apiRun = await run({ kind: 'html', code: '<p>api</p>', ex: { api: "api.get('/api/slow', { body: { ok: 1 }, delay: 300 })\napi.get('/api/fail', { status: 500, body: api.problem(500, '炸了') })\napi.get('/api/down', { network: true })" }, test: { code: `
    let t0 = performance.now()
    const res = await fetch('/api/slow')
    const ms = performance.now() - t0
    assert(ms >= 280, '延遲太短：' + ms)
    assertEqual(await res.json(), { ok: 1 })
    const bad = await fetch('/api/fail')
    assertEqual([bad.ok, bad.status, (await bad.json()).detail], [false, 500, '炸了'])
    let netErr = null
    try { await fetch('/api/down') } catch (e) { netErr = e }
    assert(netErr instanceof TypeError, '網路錯誤要 reject TypeError')
    const c = new AbortController()
    const p = fetch('/api/slow', { signal: c.signal })
    c.abort()
    let ab = null
    try { await p } catch (e) { ab = e }
    assertEqual(ab && ab.name, 'AbortError')
    const s = await fetch('/api/sessions')
    assertEqual((await s.json()).length, 3)
    const nf = await fetch('/api/nothing')
    assertEqual(nf.status, 404)` } })
  t('fake API: delay, 500, network error, abort, built-in routes, 404', apiRun.test.pass, apiRun.test.error)
  const net = apiRun.network.map((n) => `${n.method} ${n.url} ${n.aborted ? 'aborted' : n.network ? 'network' : n.status}`)
  t('network messages reach the shell', JSON.stringify(net) === JSON.stringify(['GET /api/slow 200', 'GET /api/fail 500', 'GET /api/down network', 'GET /api/slow aborted', 'GET /api/sessions 200', 'GET /api/nothing 404']) && apiRun.network[0].ms >= 280, JSON.stringify(net))
  t('missing route prints a hint in the console', apiRun.logs.some((l) => l.level === 'warn' && /沒有對應的路由：GET \/api\/nothing/.test(l.text)))
  const testApi = await run({ kind: 'html', code: '<p>x</p>', ex: { api: "api.get('/api/a', { body: 1 })" }, test: { api: "api.get('/api/a', { body: 2 })", code: "assertEqual(await (await fetch('/api/a')).json(), 2)" } })
  t('test.api overrides ex.api', testApi.test.pass, testApi.test.error)

  // ── viewport：390 與 1280 套到不同的 media query ──
  const cssEx = { html: '<div class="grid"><div class="card">1</div><div class="card">2</div></div>' }
  const cssCode = '.grid { display: grid; gap: 8px; }\n@media (min-width: 768px) { .grid { grid-template-columns: 1fr 1fr; } }'
  const narrow = await run({ kind: 'css', code: cssCode, ex: cssEx, test: { viewport: 390, code: "const [a, b] = $$('.card').map(box)\nassertEqual(innerWidth, 390)\nassert(b.top > a.top, '390 時應該一欄')" } })
  const wide = await run({ kind: 'css', code: cssCode, ex: cssEx, test: { viewport: 1280, code: "const [a, b] = $$('.card').map(box)\nassertEqual(innerWidth, 1280)\nassert(b.top === a.top, '1280 時應該兩欄')" } })
  t('viewport 390 vs 1280 apply different media queries', narrow.test.pass && wide.test.pass, `${narrow.test.error} / ${wide.test.error}`)

  // ── 表單送出：allow-forms 讓 submit 事件觸發，@submit.prevent 跑得到；沒擋預設行為時沙箱攔下 ──
  const form = await run({ kind: 'vue', code: vue("const sent = ref(0)\ncreateApp({ setup: () => ({ sent }), template: '<form @submit.prevent=\"sent++\"><input name=q><button>送出</button></form><p id=n>{{ sent }}</p>' }).mount('#app')"), test: { code: "click('button')\nawait tick()\nsubmit('form')\nawait tick()\nassertEqual(text('#n'), '2')" } })
  t('submit event fires (@submit.prevent runs)', form.test.pass, form.test.error)
  const noPrevent = await run({ kind: 'html', code: '<form><button>送出</button></form><p id=alive>ok</p>', test: { code: "click('button')\nawait wait(50)\nassertEqual(text('#alive'), 'ok')" } })
  t('form without preventDefault does not navigate the frame away', noPrevent.test.pass && noPrevent.logs.some((l) => /表單送出會換頁/.test(l.text)), noPrevent.test.error)
  // <form method="dialog"> 不換頁，沙箱不能攔：攔了 Dialog 就關不掉
  const dialogForm = await run({ kind: 'html', code: '<button id=opener>開</button><dialog id=d><form method="dialog"><button value="keep">保留</button></form></dialog><script>document.getElementById("opener").onclick = () => document.getElementById("d").showModal()</script>', test: { code: "focus('#opener')\nclick('#opener')\nawait tick()\nassert($('#d').open, '沒有打開')\nclick('#d button')\nawait waitFor(() => !$('#d').open)\nassertEqual($('#d').returnValue, 'keep')\nassertEqual(document.activeElement.id, 'opener', '關閉後的焦點')" } })
  t('form method="dialog" closes the dialog (not blocked, no warning)', dialogForm.test.pass && !dialogForm.logs.some((l) => /表單送出會換頁/.test(l.text)), dialogForm.test.error)

  // ── 舊 runId / 偽造的訊息被丟掉 ──
  const spoof = await run({ kind: 'html', code: '<p>x</p>', test: { code: "parent.postMessage({ ns: 'frame', runId: 'run-stale-1', type: 'done', test: { name: 't', pass: true } }, '*')\nawait wait(50)\nassert(false, '真正的結果')" } })
  t('messages with another runId are ignored', !spoof.test.pass && spoof.test.error === '真正的結果', JSON.stringify(spoof.test))
  const fromParent = await page.evaluate(async () => {
    // 外殼自己（不是 iframe）送出的訊息也不能被當成 iframe 的結果
    const p = window.__frame.runTest({ kind: 'html', code: '<p>x</p>', ex: {}, test: { name: 't', code: "await wait(150)\nassert(false, '真正的結果')" } })
    await new Promise((r) => setTimeout(r, 30))
    const runId = [...document.querySelectorAll('iframe.sbx-frame')].map((f) => /"runId":"([^"]+)"/.exec(f.srcdoc)?.[1]).find(Boolean)
    window.postMessage({ ns: 'frame', runId, type: 'done', test: { name: 't', pass: true } }, '*')
    return (await p).test
  })
  t('messages from a different source are ignored', !fromParent.pass && fromParent.error === '真正的結果', JSON.stringify(fromParent))
  t('hidden test frames are removed after each test', await page.evaluate(() => document.querySelectorAll('iframe.sbx-frame').length) === 0)

  // ── runOnce：深入內容的 html run 與 js run vue 區塊（e2e:deep 用）──
  const once = await page.evaluate(async () => {
    const F = window.__frame
    const ok = await F.runOnce({ kind: 'vue', code: "import { createApp, ref } from 'vue'\nconst res = await fetch('/api/sessions')\nconsole.log((await res.json()).length)\ncreateApp({ setup: () => ({ n: ref(1) }), template: '<p>{{ n }}</p>' }).mount('#app')" })
    const bad = await F.runOnce({ kind: 'html', code: '<script>setTimeout(() => { throw new Error("晚一點才壞") }, 100)</script>' })
    return { ok: ok.ok, out: ok.output, bad: bad.ok, err: bad.error }
  })
  t('runOnce: a working vue block succeeds, a late error fails', once.ok && once.out === '3' && !once.bad && /晚一點才壞/.test(once.err || ''), JSON.stringify(once))

  // ── Pinia 與 Vue Router：import 了才下載，經同一個 import map 共用一份 Vue ──
  {
    const lp = await ctx.newPage()   // 新分頁：vendor 的記憶體快取是空的
    lp.on('pageerror', (e) => errs.push('PAGEERROR(vendor) ' + e.message))
    lp.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE(vendor) ' + m.text().slice(0, 200)) })
    const vendorReqs = []
    lp.on('request', (r) => { const m = /\/vendor\/([^/]+)\//.exec(r.url()); if (m) vendorReqs.push(m[1].replace(/@.*/, '')) })
    await lp.goto(base + '?verify=frame', { waitUntil: 'networkidle' })
    await lp.waitForFunction(() => window.__frameReady, null, { timeout: 30000 })
    const lrun = (o) => lp.evaluate(async (o) => {
      const t0 = performance.now()
      const r = await window.__frame.runTest({ ex: {}, ...o, test: { name: 't', ...o.test } })
      return { ...r, ms: Math.round(performance.now() - t0) }
    }, o)
    const seen = () => [...new Set(vendorReqs)].sort().join(',')
    await lrun({ kind: 'html', code: '<p id=x>hi</p>', test: { code: "assertEqual(text('#x'), 'hi')" } })
    t('html without imports downloads no vendor file', vendorReqs.length === 0, seen())
    const vueOnly = await lrun({ kind: 'vue', code: vue("createApp({ template: '<p id=x>{{ 1 + 1 }}</p>' }).mount('#app')"), test: { code: "await waitFor(() => text('#x') === '2')" } })
    t('a vue-only exercise downloads vue, not pinia or vue-router', vueOnly.test.pass && seen() === 'vue', seen())
    const piniaOnly = await lrun({ kind: 'vue', code: `import { createApp, ref } from 'vue'
import { createPinia, defineStore, storeToRefs } from 'pinia'
const useQueue = defineStore('queue', () => { const current = ref(12); function next() { current.value++ } return { current, next } })
createApp({ setup() { const q = useQueue(); const { current } = storeToRefs(q); return { current, next: q.next } }, template: '<button type="button" @click="next">{{ current }}</button>' }).use(createPinia()).mount('#app')`, test: { code: "await waitFor(() => $('button'))\nclick('button')\nawait tick()\nassertEqual(text('button'), '13')" } })
    t('import from pinia: store and storeToRefs work, vue-router is not downloaded', piniaOnly.test.pass && seen() === 'pinia,vue', `${piniaOnly.test.error} / ${seen()}`)
    const both = await lrun({ kind: 'vue', code: `import { createApp, ref } from 'vue'
import { createPinia, defineStore } from 'pinia'
import { createRouter, createMemoryHistory, RouterView, RouterLink, useRoute } from 'vue-router'
const useSession = defineStore('session', () => { const user = ref(null); return { user } })
const Patient = { setup() { return { route: useRoute() } }, template: '<p id=patient>{{ route.params.id }}</p>' }
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<p id=home>home</p>' } }, { path: '/login', component: { template: '<p id=login>login</p>' } }, { path: '/patients/:id', component: Patient, meta: { requiresAuth: true } }] })
router.beforeEach((to) => { if (to.meta.requiresAuth && !useSession().user) return { path: '/login', query: { redirect: to.fullPath } } })
const App = { setup() { const s = useSession(); return { route: useRoute(), login: () => { s.user = { name: '林醫師' } } } }, template: '<RouterLink id=to7 to="/patients/7">7</RouterLink><button id=login-btn type="button" @click="login">登入</button><b id=path>{{ route.fullPath }}</b><RouterView />' }
createApp(App).use(createPinia()).use(router).mount('#app')`, test: { code: "await waitFor(() => $('#home'))\nclick('#to7')\nawait waitFor(() => $('#login'))\nassertEqual(text('#path'), '/login?redirect=/patients/7')\nclick('#login-btn')\nclick('#to7')\nawait waitFor(() => text('#patient') === '7')" } })
    t('pinia + vue-router (createMemoryHistory): guard reads the store, RouterView renders params', both.test.pass, both.test.error)
    t('vue-router is downloaded only when imported', seen() === 'pinia,vue,vue-router', seen())
    const n = vendorReqs.length
    await lrun({ kind: 'vue', code: "import { createApp } from 'vue'\nimport { createPinia } from 'pinia'\nimport { createRouter, createMemoryHistory } from 'vue-router'\ncreateApp({ template: '<p>x</p>' }).use(createPinia()).use(createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<i />' } }] })).mount('#app')", test: { code: 'await tick()' } })
    t('vendor files are read once per page', vendorReqs.length === n && n === 3, JSON.stringify(vendorReqs))

    // createWebHashHistory：srcdoc 的相對網址以外殼為基準，replaceState('#/') 丟 SecurityError，router 改用 location.replace 讓 iframe 換頁
    const hash = await lrun({ kind: 'vue', code: "import { createApp } from 'vue'\nimport { createRouter, createWebHashHistory, RouterView } from 'vue-router'\nconst router = createRouter({ history: createWebHashHistory(), routes: [{ path: '/', component: { template: '<p id=home>home</p>' } }] })\ncreateApp({ template: '<RouterView />' }).use(router).mount('#app')", test: { code: "await waitFor(() => $('#home'))" } })
    t('createWebHashHistory in srcdoc navigates the frame away: reported at once, not after the 8 s timeout', !hash.test.pass && !hash.timeout && /createMemoryHistory/.test(hash.test.error || '') && hash.ms < 3000 && hash.logs.some((l) => /SecurityError/.test(l.text)), `${hash.ms}ms ${hash.test.error} ${JSON.stringify(hash.logs.map((l) => l.text.slice(0, 100)))}`)

    // 錯誤的 stack 裡，vendor 的 data: URL 換成套件名稱
    const stack = await lp.evaluate(async () => {
      const F = window.__frame
      const code = "import { defineStore } from 'pinia'\nconst useS = defineStore('s', () => ({}))\nuseS()"
      const imports = await F.importMapFor('vue', code)
      const { html } = F.buildSrcdoc({ kind: 'vue', code, runId: 'stack-1', mode: 'once', imports })
      return new Promise((res) => {
        const f = F.createFrame({ host: document.getElementById('frame-host'), html, runId: 'stack-1', onMessage: (m) => { if (m.type === 'error') { f.destroy(); res(m.stack) } } })
        setTimeout(() => { f.destroy(); res(null) }, 5000)
      })
    })
    t('stack traces name the vendor package instead of the data: URL', !!stack && /\(pinia\)|at pinia\b/.test(stack) && !/data:/.test(stack), stack)

    // setVisibility：測試 helper，模擬分頁切到背景再回來
    const vis = await lrun({ kind: 'html', code: "<p>x</p><script>window.seen = []; document.addEventListener('visibilitychange', () => seen.push(document.visibilityState + ':' + document.hidden))</script>", test: { code: "setVisibility('hidden')\nsetVisibility('visible')\nassertEqual(seen, ['hidden:true', 'visible:false'])\nassertEqual(document.visibilityState, 'visible')" } })
    t('setVisibility() fires visibilitychange with the new visibilityState', vis.test.pass, vis.test.error)
    await lp.close()
  }

  // ── Element Plus：import 'element-plus' 才下載主檔、zh-tw 語系與樣式；和 Pinia、Vue Router 共用同一份 Vue ──
  {
    const ep = await ctx.newPage()   // 新分頁：vendor 的記憶體快取是空的
    ep.on('pageerror', (e) => errs.push('PAGEERROR(element-plus) ' + e.message))
    ep.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE(element-plus) ' + m.text().slice(0, 200)) })
    const reqs = []
    ep.on('request', (r) => { const m = /\/vendor\/([^/]+@[^/]+\/[^/?]+)/.exec(r.url()); if (m) reqs.push(m[1]) })
    await ep.goto(base + '?verify=frame', { waitUntil: 'networkidle' })
    await ep.waitForFunction(() => window.__frameReady, null, { timeout: 30000 })
    const erun = (o) => ep.evaluate(async (o) => {
      const t0 = performance.now()
      const r = await window.__frame.runTest({ ex: {}, ...o, test: { name: 't', ...o.test } })
      return { ...r, ms: Math.round(performance.now() - t0) }
    }, o)
    const epReqs = () => reqs.filter((u) => u.startsWith('element-plus@'))
    const vueOnly = await erun({ kind: 'vue', code: vue("createApp({ template: '<p id=x>{{ 1 + 1 }}</p>' }).mount('#app')"), test: { code: "await waitFor(() => text('#x') === '2')" } })
    t('a vue-only exercise does not download element-plus', vueOnly.test.pass && epReqs().length === 0, JSON.stringify(reqs))
    const zh = await erun({ kind: 'vue', ex: { css: ':root { --el-color-primary: rgb(11, 110, 79); }' }, code: `import { createApp, ref } from 'vue'
import ElementPlus from 'element-plus'
import zhTw from 'element-plus/es/locale/lang/zh-tw'
createApp({ setup: () => ({ zhTw, rows: ref([]) }), template: '<el-config-provider :locale="zhTw"><el-button id=b type="primary">送出</el-button><el-table :data="rows"><el-table-column prop="no" label="號碼" /></el-table></el-config-provider>' }).use(ElementPlus).mount('#app')`, test: { code: `await waitFor(() => $('.el-table__empty-text'))
assertEqual(text('.el-table__empty-text'), '暫無資料', 'zh-tw 的空表格文字')
assertEqual(css('#b', 'display'), 'inline-flex', 'Element Plus 的樣式有載入')
assertEqual(css('#b', 'background-color'), 'rgb(11, 110, 79)', '題目的 CSS 蓋過 --el-color-primary')` } })
    t('import element-plus: zh-tw locale applies, the stylesheet loads, exercise CSS overrides --el-* variables', zh.test.pass, zh.test.error)
    t('element-plus downloads the module, the zh-tw locale and the stylesheet once each', JSON.stringify(epReqs().map((u) => u.split('/').pop()).sort()) === JSON.stringify(['index.css', 'index.full.min.mjs', 'zh-tw.min.mjs']), JSON.stringify(epReqs()))
    const noLocale = await erun({ kind: 'vue', code: `import { createApp, ref } from 'vue'
import ElementPlus from 'element-plus'
createApp({ setup: () => ({ rows: ref([]) }), template: '<el-table :data="rows"><el-table-column prop="no" label="號碼" /></el-table>' }).use(ElementPlus).mount('#app')`, test: { code: "await waitFor(() => $('.el-table__empty-text'))\nassertEqual(text('.el-table__empty-text'), 'No Data')" } })
    t('without el-config-provider the locale is English (No Data)', noLocale.test.pass, noLocale.test.error)
    const shared = await erun({ kind: 'vue', code: `import { createApp, ref, inject } from 'vue'
import { createPinia, defineStore } from 'pinia'
import { createRouter, createMemoryHistory, RouterView } from 'vue-router'
import ElementPlus from 'element-plus'
const useQueue = defineStore('queue', () => { const current = ref(12); return { current, next: () => current.value++ } })
const Board = { setup() { const q = useQueue(); return { q } }, template: '<el-button id=next @click="q.next()">{{ q.current }}</el-button>' }
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: Board }] })
createApp({ template: '<el-card><RouterView /></el-card>' }).use(createPinia()).use(router).use(ElementPlus).mount('#app')`, test: { code: "await waitFor(() => $('#next'))\nclick('#next')\nawait waitFor(() => text('#next') === '13')\nassert($('.el-card #next'), 'RouterView 渲染在 el-card 裡')" } })
    const vueFiles = reqs.filter((u) => u.startsWith('vue@'))
    t('element-plus + pinia + vue-router share one Vue: store, RouterView and el-* components work together', shared.test.pass && shared.errors.length === 0 && new Set(vueFiles).size === 1, `${shared.test.error} / ${JSON.stringify(shared.errors)} / ${JSON.stringify(vueFiles)}`)
    await ep.close()
  }

  // ── Tailwind（@tailwindcss/browser）：tailwind: true 或 html 裡有 <style type="text/tailwindcss"> 才下載；測試開始前等它產生完 CSS ──
  {
    const tp = await ctx.newPage()   // 新分頁：vendor 的記憶體快取是空的
    tp.on('pageerror', (e) => errs.push('PAGEERROR(tailwind) ' + e.message))
    tp.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE(tailwind) ' + m.text().slice(0, 200)) })
    const twReqs = []
    tp.on('request', (r) => { if (/\/vendor\/@tailwindcss\/browser@[^/]+\/index\.global\.js$/.test(r.url())) twReqs.push(r.url()) })
    await tp.goto(base + '?verify=frame', { waitUntil: 'networkidle' })
    await tp.waitForFunction(() => window.__frameReady, null, { timeout: 30000 })
    const trun = (o) => tp.evaluate(async (o) => {
      const t0 = performance.now()
      const r = await window.__frame.runTest({ ex: {}, ...o, test: { name: 't', ...o.test } })
      return { ...r, ms: Math.round(performance.now() - t0) }
    }, o)
    const plain = await trun({ kind: 'html', code: '<p id=x class="p-4 bg-red-500">x</p>', test: { code: "assertEqual(css('#x', 'padding-top'), '0px')\nassertEqual(await twReady(), true)" } })
    t('html with utility classes but no tailwind flag or style: Tailwind is not downloaded, classes do nothing', plain.test.pass && twReqs.length === 0, `${plain.test.error} / ${twReqs.length}`)
    const off = await trun({ kind: 'html', ex: { tailwind: false }, code: '<style type="text/tailwindcss"></style><p id=x class="p-4">x</p>', test: { code: "assertEqual(css('#x', 'padding-top'), '0px')" } })
    t('tailwind: false wins over the <style type="text/tailwindcss"> detection', off.test.pass && twReqs.length === 0, `${off.test.error} / ${twReqs.length}`)
    const cssKind = await trun({ kind: 'css', ex: { html: '<p id=x class="p-4">x</p>' }, code: '#x { color: red }', test: { code: "assertEqual(css('#x', 'padding-top'), '0px')" } })
    t('css exercises never load Tailwind', cssKind.test.pass && twReqs.length === 0, `${cssKind.test.error} / ${twReqs.length}`)

    const theme = `<style type="text/tailwindcss">
  @theme { --color-clinic: #2f6fd6; --color-clinic-strong: #1f4fa8; }
  @custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));
</style>`
    const gen = await trun({ kind: 'html', ex: { tailwind: true }, code: theme + `
<main id=m class="p-4 md:grid md:grid-cols-2">
  <button id=b type="button" aria-expanded="false" class="h-11 bg-clinic text-white hover:bg-clinic-strong aria-expanded:rotate-180 dark:bg-black">x</button>
  <p id=late>late</p>
</main>`, test: { code: `assertEqual(css('#m', 'padding-top'), '16px', 'p-4')
assertEqual(css('#b', 'background-color'), 'rgb(47, 111, 214)', '@theme 的 bg-clinic')
assertEqual(css('#b', 'height'), '44px', 'h-11')
assertEqual(css('#m', 'display'), 'block', '390px 時 md: 不成立')
assertEqual(cssWhen('#b', ':hover', 'background-color'), 'rgb(31, 79, 168)', 'cssWhen 讀 hover 的規則')
assertEqual(cssWhen('#b', ':focus-visible', 'outline-width'), null, '沒有 focus-visible 規則時是 null')
$('#b').setAttribute('aria-expanded', 'true')
await twReady()
assertEqual(css('#b', 'rotate'), '180deg', 'aria-expanded:')
$('#m').dataset.theme = 'dark'
assertEqual(css('#b', 'background-color'), 'rgb(0, 0, 0)', '@custom-variant dark')
$('#late').className = 'mt-[13px] text-clinic'
await twReady()
assertEqual(css('#late', 'margin-top'), '13px', '之後才加上的 class 也會產生')
assertEqual(css('#late', 'color'), 'rgb(47, 111, 214)')`, viewport: 390 } })
    t('tailwind: true: utilities, @theme, hover (cssWhen), aria-*, @custom-variant and classes added later are generated', gen.test.pass && twReqs.length === 1, `${gen.test.error} / ${twReqs.length}`)
    t('the Tailwind test finishes quickly (no fixed sleep)', gen.ms < 3000, `${gen.ms}ms`)
    const wide = await trun({ kind: 'html', ex: { tailwind: true }, code: theme + '<main id=m class="md:grid md:grid-cols-2"><p>a</p><p>b</p></main>', test: { viewport: 1280, code: "assertEqual(css('#m', 'display'), 'grid')" } })
    t('md: applies at 1280px (min-width breakpoints)', wide.test.pass, wide.test.error)
    const detected = await trun({ kind: 'html', code: '<style type="text/tailwindcss">@theme { --color-clinic: #2f6fd6; }</style><p id=x class="text-clinic">x</p>', test: { code: "assertEqual(css('#x', 'color'), 'rgb(47, 111, 214)')" } })
    t('without an exercise setting, <style type="text/tailwindcss"> loads Tailwind (Playground, deep blocks)', detected.test.pass, detected.test.error)
    t('Tailwind is downloaded once per page', twReqs.length === 1, String(twReqs.length))
    const bad = await trun({ kind: 'html', ex: { tailwind: true }, code: '<style type="text/tailwindcss">.x { @apply nope-nope; }</style><p class="x">x</p>', test: { code: 'assert(true)' } })
    t('a Tailwind compile error fails the test instead of waiting for the timeout', !bad.test.pass && !bad.timeout && bad.ms < 4000 && /nope-nope/.test(bad.test.error || ''), `${bad.ms}ms ${bad.test.error}`)
    const once = await tp.evaluate(() => window.__frame.runOnce({ kind: 'html', code: '<style type="text/tailwindcss"></style><p id=x class="p-4">x</p><script>setTimeout(() => console.log(getComputedStyle(document.getElementById("x")).paddingTop), 300)</script>' }))
    t('runOnce (deep html run blocks) runs Tailwind too', once.ok && once.output === '16px', JSON.stringify(once.output) + ' ' + once.error)
    await tp.close()
  }

  // ── 390px：題目頁的預覽窗格不溢出；切到 1280 時縮小顯示 ──
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const mp = await mob.newPage()
  mp.on('pageerror', (e) => errs.push('PAGEERROR(390) ' + e.message))
  mp.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE(390) ' + m.text().slice(0, 200)) })
  await mp.goto(base + '#/exercise/api-states-1', { waitUntil: 'networkidle' })
  await mp.waitForSelector('.fp')
  t('preview is idle before 執行 (no iframe, no vendor download)', (await mp.$$('.fp iframe')).length === 0)
  await mp.click('.ex button:has-text("執行")')
  await mp.waitForSelector('.fp iframe.sbx-frame', { timeout: 20000 })
  const fr = mp.frames().find((f) => f.url() === 'about:srcdoc')
  await fr?.waitForSelector('li, [data-test]', { timeout: 10000 }).catch(() => {})
  await mp.waitForFunction(() => document.querySelectorAll('.fp-net tbody tr').length > 0 || [...document.querySelectorAll('.fp-tabs button')].some((b) => /網路 \d/.test(b.textContent)), null, { timeout: 10000 }).catch(() => {})
  t('preview renders the starter in the iframe', !!fr && (await fr.$$('li')).length === 2)
  t('network tab counts the fake API request', /網路 1/.test(await mp.textContent('.fp-tabs')), await mp.textContent('.fp-tabs'))
  const overflow = async () => mp.evaluate(() => {
    const doc = document.scrollingElement.scrollWidth
    const r = document.querySelector('.fp-stage').getBoundingClientRect()
    const f = document.querySelector('.fp-host').getBoundingClientRect()
    return { doc, stageRight: Math.round(r.right), hostRight: Math.round(f.right), vw: innerWidth }
  })
  let o = await overflow()
  t('390px: page does not scroll sideways with the preview (auto width)', o.doc <= o.vw && o.stageRight <= o.vw && o.hostRight <= o.stageRight, JSON.stringify(o))
  await mp.click('.fp-widths button:has-text("1280")')
  await mp.waitForTimeout(200)
  o = await overflow()
  const innerW = await fr?.evaluate(() => innerWidth)
  t('390px: 1280 preview is scaled down, iframe viewport stays 1280', o.doc <= o.vw && o.hostRight <= o.stageRight && innerW === 1280 && /縮放/.test(await mp.textContent('.fp-size')), JSON.stringify({ ...o, innerW }))
  await mp.screenshot({ path: `e2e/shots/frame-390-${name}.png`, fullPage: true })
  // 交卷：看不見的 iframe 跑測試；起始碼不通過
  await mp.click('.ex button:has-text("交卷")')
  await mp.waitForSelector('.ex-verdict', { timeout: 30000 })
  t('submit grades in hidden frames (starter fails)', (await mp.textContent('.ex-verdict')).includes('未通過') && (await mp.$$('.tests li.bad')).length > 0)
  // 貼上解答再交卷：通過，進度寫進 localStorage
  await mp.evaluate(() => document.querySelector('.ex .cm-content').focus())
  await mp.keyboard.press('Control+A'); await mp.keyboard.press('Delete')
  await mp.keyboard.insertText(findExercise('api-states-1').solution)
  await mp.click('.ex button:has-text("交卷")')
  await mp.waitForFunction(() => { const v = document.querySelector('.ex-verdict')?.textContent || ''; return v.includes('通過') && !v.includes('未') }, null, { timeout: 30000 }).catch(() => {})
  const stored = await mp.evaluate(() => JSON.parse(localStorage.getItem('atlas-progress-v1') || '{}'))
  t('pasting the solution passes in the UI and is saved to progress', stored?.exercises?.['api-states-1'] === 'pass', await mp.textContent('.ex-verdict'))
  await mob.close()

  // ── Playground：html 與 vue 模式；vue 模式的程式 import pinia、vue-router 也能跑 ──
  const piniaRouter = `import { createApp, ref } from 'vue'
import { createPinia, defineStore, storeToRefs } from 'pinia'
import { createRouter, createMemoryHistory, RouterView, RouterLink } from 'vue-router'
const useQueue = defineStore('queue', () => { const current = ref(12); return { current } })
const Board = { setup() { const { current } = storeToRefs(useQueue()); return { current } }, template: '<p id=board>{{ current }} 號</p>' }
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: Board }] })
createApp({ template: '<button type="button">看板</button><RouterView />' }).use(createPinia()).use(router).mount('#app')`
  const b64 = Buffer.from(piniaRouter, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  for (const [lang, hash, label] of [['html', 'lang=html', 'html'], ['vue', 'lang=vue', 'vue'], ['vue', `lang=vue&code=${b64}`, 'vue with pinia + vue-router']]) {
    const pg = await ctx.newPage()
    pg.on('pageerror', (e) => errs.push('PAGEERROR(pg) ' + e.message))
    await pg.goto(base + `#/playground?${hash}`, { waitUntil: 'networkidle' })
    await pg.waitForSelector('.pg-api')
    await pg.click('.pg-toolbar button:has-text("執行")')
    await pg.waitForSelector('.fp iframe.sbx-frame', { timeout: 20000 })
    const f = pg.frames().find((x) => x.url() === 'about:srcdoc')
    await f?.waitForSelector('button, main', { timeout: 10000 }).catch(() => {})
    if (label === 'vue with pinia + vue-router') {
      await f?.waitForSelector('#board', { timeout: 10000 }).catch(() => {})
      t(`playground ${label} runs in the sandbox`, !!f && (await f.textContent('#board').catch(() => '')) === '12 號')
    } else t(`playground ${label} runs in the sandbox`, !!f && (await f.$$('button')).length > 0)
    await pg.close()
  }

  t(`no page/console errors in the shell (${name})`, errs.length === 0, errs.join('\n'))

  // 迴圈保護改寫不到的寫法（new Function 裡的迴圈）只剩 8 秒逾時：沙箱 iframe 和外殼在不同程序時才救得回來。
  // 記錄瀏覽器的實際行為，不當成失敗；放在最後、用獨立的 context，卡住就整個關掉。
  const lone = await browser.newContext()
  const lp = await lone.newPage()
  await lp.goto(base + '?verify=frame', { waitUntil: 'networkidle' })
  await lp.waitForFunction(() => window.__frameReady, null, { timeout: 30000 })
  const unguarded = await Promise.race([
    lp.evaluate(async () => {
      const t0 = performance.now()
      const r = await window.__frame.runTest({ kind: 'html', code: "<script>new Function('while (true) {}')()</script>", ex: {}, test: { name: 't', code: 'await tick()' } })
      return { timeout: !!r.timeout, ms: Math.round(performance.now() - t0) }
    }),
    new Promise((r) => setTimeout(() => r(null), 15000)),
  ]).catch(() => null)
  console.log(`INFO unguarded loop (new Function, only the 8 s timeout applies): ${unguarded ? `${unguarded.timeout ? 'timed out' : 'finished'} after ${unguarded.ms} ms; the shell kept running` : 'the shell was blocked (iframe shares its process)'}`)
  await Promise.race([lone.close(), new Promise((r) => setTimeout(r, 5000))])

  // 導航守衛的無窮導向：vue-router 的 prod 版偵測不到，沒有沙箱的包裝時 iframe 與外殼一起卡住、記憶體一直漲。
  // 用獨立的 context，卡住就整個關掉並記成失敗
  const loopCtx = await browser.newContext()
  const loopPage = await loopCtx.newPage()
  await loopPage.goto(base + '?verify=frame', { waitUntil: 'networkidle' })
  await loopPage.waitForFunction(() => window.__frameReady, null, { timeout: 30000 })
  const redirect = await Promise.race([
    loopPage.evaluate(async () => {
      const t0 = performance.now()
      const r = await window.__frame.runTest({ kind: 'vue', ex: {}, code: "import { createApp } from 'vue'\nimport { createRouter, createMemoryHistory, RouterView } from 'vue-router'\nconst router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<p>home</p>' } }, { path: '/login', component: { template: '<p id=login>login</p>' } }] })\nrouter.beforeEach(() => '/login')\ncreateApp({ template: '<RouterView />' }).use(router).mount('#app')", test: { name: 't', code: "await wait(300)\nassert(true)" } })
      const alive = await new Promise((res) => setTimeout(() => res(true), 0))
      return { error: r.test.error, pass: r.test.pass, ms: Math.round(performance.now() - t0), alive }
    }),
    new Promise((r) => setTimeout(() => r(null), 15000)),
  ]).catch(() => null)
  t('a guard that always redirects is stopped with a message (the shell keeps running)', !!redirect && redirect.alive && !redirect.pass && /導航守衛一直導向/.test(redirect.error || '') && redirect.ms < 5000, JSON.stringify(redirect))
  await Promise.race([loopCtx.close(), new Promise((r) => setTimeout(r, 5000))])
  await browser.close()
}
process.exit(failed ? 1 : 0)

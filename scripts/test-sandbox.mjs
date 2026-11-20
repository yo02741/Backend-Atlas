// 前端沙箱的純函式單元測試：假 API（src/runtime/fakeApi.js）的路由、延遲、序列回應、abort、404、網路錯誤、內建門診路由；
// 迴圈保護（src/runtime/loopGuard.js）的改寫；srcdoc 組成（src/runtime/frame.js 的 buildSrcdoc）的行號與跳脫；
// vendor 套件的判斷（vendorsFor）與 import map（versions.js 的檔名、vue-router 的包裝模組）；Element Plus 的語系 module 與樣式檔；
// Tailwind 的載入判斷與 classic script。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createFakeApi } from '../src/runtime/fakeApi.js'
import { guardLoops, guardHtml } from '../src/runtime/loopGuard.js'
import { buildSrcdoc, vendorsFor, importMapFor, stylesFor, usesTailwind, tailwindUrlFor, ROUTER_REDIRECT_LIMIT } from '../src/runtime/frame.js'
import { VERSIONS, VENDOR_FILES, VENDOR_SUBMODULES, VENDOR_STYLES, MODULE_VENDORS, CLASSIC_VENDORS, vendorPath, vendorFilePath } from '../src/runtime/versions.js'

let n = 0
const test = async (name, fn) => { await fn(); n++; console.log('ok  ' + name) }
const make = (extra = {}) => {
  const calls = [], warns = []
  const api = createFakeApi({ baseURI: 'http://localhost:4173/app/', onCall: (c) => calls.push({ ...c }), warn: (m) => warns.push(m), today: '2026-11-26', ...extra })
  api.latency = 0
  return { api, fetch: api.fetch, calls, warns }
}

// ── 假 API ──
await test('自訂路由：回真的 Response，body 是物件就序列化成 JSON', async () => {
  const { api, fetch } = make()
  api.get('/api/patients', { body: [{ id: 1, name: '王小明' }] })
  const res = await fetch('/api/patients')
  assert.ok(res instanceof Response)
  assert.equal(res.status, 200)
  assert.equal(res.ok, true)
  assert.equal(res.headers.get('content-type'), 'application/json')
  assert.deepEqual(await res.json(), [{ id: 1, name: '王小明' }])
})

await test('路徑參數、query、JSON body、標頭都交給 handler', async () => {
  const { api, fetch } = make()
  let seen
  api.post('/api/patients/:id/notes', (req) => { seen = req; return { status: 201, body: { ok: true } } })
  const res = await fetch('/api/patients/42/notes?draft=1', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Trace': 'abc' }, body: JSON.stringify({ text: '回診' }) })
  assert.equal(res.status, 201)
  assert.deepEqual(seen.params, { id: '42' })
  assert.deepEqual(seen.query, { draft: '1' })
  assert.deepEqual(seen.body, { text: '回診' })
  assert.equal(seen.headers['x-trace'], 'abc')
  assert.equal(seen.path, '/api/patients/42/notes')
})

await test('4xx、5xx 不會 reject；錯誤 body 是 Problem Details', async () => {
  const { api, fetch } = make()
  api.get('/api/x', { status: 503, body: api.problem(503, '維護中') })
  const res = await fetch('/api/x')
  assert.equal(res.ok, false)
  assert.equal(res.status, 503)
  assert.equal(res.headers.get('content-type'), 'application/problem+json')
  assert.deepEqual(await res.json(), { type: 'about:blank', title: 'Service Unavailable', status: 503, detail: '維護中' })
})

await test('陣列：依序回應，最後一個重複', async () => {
  const { api, fetch } = make()
  api.get('/api/seq', [{ status: 500, body: { title: 'x', status: 500 } }, { body: { n: 2 } }])
  assert.equal((await fetch('/api/seq')).status, 500)
  assert.deepEqual(await (await fetch('/api/seq')).json(), { n: 2 })
  assert.deepEqual(await (await fetch('/api/seq')).json(), { n: 2 })
})

await test('後定義的路由蓋過先定義的；自訂路由優先於內建路由', async () => {
  const { api, fetch } = make()
  api.get('/api/a', { body: 1 })
  api.get('/api/a', { body: 2 })
  assert.equal(await (await fetch('/api/a')).json(), 2)
  api.get('/api/sessions', { body: [] })
  assert.deepEqual(await (await fetch('/api/sessions')).json(), [])
})

await test('延遲：預設 api.latency，回應物件的 delay 優先；耗時記在 calls', async () => {
  const { api, fetch, calls } = make()
  api.latency = 60
  api.get('/api/slow', { body: 1 })
  api.get('/api/fast', { body: 1, delay: 0 })
  const t0 = Date.now()
  await fetch('/api/slow')
  assert.ok(Date.now() - t0 >= 55, `延遲太短：${Date.now() - t0}`)
  const t1 = Date.now()
  await fetch('/api/fast')
  assert.ok(Date.now() - t1 < 40)
  assert.ok(calls[0].ms >= 55)
  assert.equal(api.calls.length, 2)
})

await test('網路錯誤：reject TypeError，calls 記 network', async () => {
  const { api, fetch, calls } = make()
  api.get('/api/down', { network: true })
  await assert.rejects(fetch('/api/down'), (e) => e instanceof TypeError && e.message === 'Failed to fetch')
  assert.equal(calls[0].network, true)
  assert.equal(calls[0].status, null)
})

await test('abort：等回應時取消，reject AbortError，calls 記 aborted', async () => {
  const { api, fetch, calls } = make()
  api.get('/api/search', { body: [], delay: 200 })
  const c = new AbortController()
  const p = fetch('/api/search?q=a', { signal: c.signal })
  setTimeout(() => c.abort(), 20)
  await assert.rejects(p, (e) => e.name === 'AbortError')
  assert.equal(calls[0].aborted, true)
  assert.equal(calls[0].url, '/api/search?q=a')
  // 已經取消的 signal：立刻 reject
  await assert.rejects(fetch('/api/search', { signal: AbortSignal.abort() }), (e) => e.name === 'AbortError')
})

await test('AbortSignal.timeout：reject TimeoutError（和瀏覽器一樣用 signal.reason）', async () => {
  const { api, fetch } = make()
  api.get('/api/never', { body: 1, delay: 500 })
  await assert.rejects(fetch('/api/never', { signal: AbortSignal.timeout(30) }), (e) => e.name === 'TimeoutError')
})

await test('handler 依請求決定延遲（競態題用）', async () => {
  const { api, fetch } = make()
  api.get('/api/q', (req) => ({ body: req.query.q, delay: req.query.q === 'a' ? 80 : 10 }))   // 字串 body 原樣送出（text）
  const order = []
  await Promise.all(['a', 'ab'].map((q) => fetch(`/api/q?q=${q}`).then((r) => r.text()).then((v) => order.push(v))))
  assert.deepEqual(order, ['ab', 'a'])
})

await test('沒有對到路由：404 Problem Details，並提示加路由', async () => {
  const { fetch, warns } = make()
  const res = await fetch('/api/nothing')
  assert.equal(res.status, 404)
  assert.equal((await res.json()).status, 404)
  assert.match(warns[0], /沒有對應的路由：GET \/api\/nothing/)
})

await test('網址用 baseURI 解析：相對路徑 api/… 在子路徑下對不到 /api/…', async () => {
  const { api, fetch } = make()
  api.get('/api/ok', { body: 1 })
  assert.equal((await fetch('/api/ok')).status, 200)
  assert.equal((await fetch('api/ok')).status, 404)
  assert.equal((await fetch(new URL('http://localhost:4173/api/ok'))).status, 200)
})

await test('Request 物件也可以當 fetch 的參數', async () => {
  const { api, fetch } = make()
  let seen
  api.post('/api/r', (req) => { seen = req; return { body: { ok: 1 } } })
  await fetch(new Request('http://localhost:4173/api/r', { method: 'POST', body: JSON.stringify({ a: 1 }) }))
  assert.equal(seen.method, 'POST')
  assert.deepEqual(seen.body, { a: 1 })
})

await test('204 沒有 body；FormData 原樣交給 handler', async () => {
  const { api, fetch } = make()
  let seen
  api.post('/api/f', (req) => { seen = req.body; return { status: 204, body: { ignored: true } } })
  const fd = new FormData()
  fd.append('name', '王小明')
  const res = await fetch('/api/f', { method: 'POST', body: fd })
  assert.equal(res.status, 204)
  assert.equal(await res.text(), '')
  assert.ok(seen instanceof FormData)
  assert.equal(seen.get('name'), '王小明')
})

await test('errorRate：隨機回 503', async () => {
  const { api, fetch } = make({ random: () => 0.05 })
  api.errorRate = 0.1
  api.get('/api/x', { body: 1 })
  assert.equal((await fetch('/api/x')).status, 503)
  api.errorRate = 0
  assert.equal((await fetch('/api/x')).status, 200)
})

await test('scenario：固定情境不靠亂數；設了就不套用 errorRate', async () => {
  const { api, fetch } = make({ random: () => 0 })
  api.errorRate = 1
  api.scenario = 'success'
  const ok = await fetch('/api/sessions')
  assert.equal(ok.status, 200)
  assert.equal((await ok.json()).length, 3)
})

await test('scenario fail：每個方法 + 路徑第 1 次 503（Problem Details），重試成功', async () => {
  const { api, fetch } = make()
  api.scenario = 'fail'
  const r1 = await fetch('/api/sessions')
  assert.equal(r1.status, 503)
  assert.equal((await r1.json()).status, 503)
  assert.equal((await fetch('/api/sessions?doctor_id=1')).status, 200, '同一路徑（query 不同）第 2 次成功')
  assert.equal((await fetch('/api/appointments')).status, 503, '另一個路徑重新算')
  assert.equal((await fetch('/api/appointments')).status, 200)
  api.reset()
  api.latency = 0
  api.scenario = 'fail'
  assert.equal((await fetch('/api/sessions')).status, 503, 'reset 後重播同一組回應')
})

await test('scenario empty：成功的 GET 陣列變 []、分頁的 items 變空；錯誤與 POST 不動', async () => {
  const { api, fetch } = make()
  api.scenario = 'empty'
  assert.deepEqual(await (await fetch('/api/sessions')).json(), [])
  assert.deepEqual(await (await fetch('/api/appointments')).json(), { items: [], next_cursor: null })
  api.get('/api/me', { body: { id: 1 } })
  assert.deepEqual(await (await fetch('/api/me')).json(), { id: 1 })
  assert.equal((await fetch('/api/sessions/99/appointments', { method: 'POST', body: '{}' })).status, 404)
})

await test('scenario shuffle：較早的請求較晚回，陣列倒序', async () => {
  const { api, fetch } = make()
  api.scenario = 'shuffle'
  const order = []
  await Promise.all([
    fetch('/api/sessions').then(async (r) => { order.push('first'); return r.json() }).then((b) => assert.deepEqual(b.map((s) => s.id), [3, 2, 1])),
    fetch('/api/sessions?doctor_id=1').then(() => order.push('second')),
    fetch('/api/sessions?doctor_id=2').then(() => order.push('third')),
  ])
  assert.deepEqual(order, ['third', 'second', 'first'])
})

await test('內建門診：登入、查門診、掛號、重複掛號、額滿、取消', async () => {
  const { fetch } = make()
  const post = (url, body, token) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
  assert.equal((await post('/api/auth/login', { username: 'patient1', password: 'wrong' })).status, 401)
  const bad = await post('/api/auth/login', {})
  assert.equal(bad.status, 422)
  assert.deepEqual(Object.keys((await bad.json()).errors), ['username', 'password'])
  const login = await (await post('/api/auth/login', { username: 'patient1', password: 'demo-password' })).json()
  assert.equal(login.token_type, 'Bearer')
  const sessions = await (await fetch('/api/sessions?doctor_id=1&date=2026-11-26')).json()
  assert.deepEqual(sessions.map((s) => [s.id, s.period, s.remaining]), [[1, 'morning', 2], [2, 'afternoon', 30]])
  const booked = await post('/api/sessions/1/appointments', {}, login.access_token)
  assert.equal(booked.status, 201)
  assert.equal(booked.headers.get('location'), '/api/appointments/1')
  const a = await booked.json()
  assert.deepEqual([a.session_id, a.patient_id, a.number, a.status], [1, 1, 1, 'booked'])
  const dup = await post('/api/sessions/1/appointments', {}, login.access_token)
  assert.equal(dup.status, 409)
  assert.equal((await dup.json()).type, 'https://clinic.example/problems/already-booked')
  const desk = await (await post('/api/auth/login', { username: 'desk1', password: 'demo-password' })).json()
  assert.equal((await post('/api/sessions/1/appointments', {}, desk.access_token)).status, 422)
  assert.equal((await post('/api/sessions/1/appointments', { patient_id: 3 }, desk.access_token)).status, 201)
  const full = await post('/api/sessions/1/appointments', { patient_id: 2 }, desk.access_token)
  assert.equal(full.status, 409)
  assert.equal((await full.json()).type, 'https://clinic.example/problems/session-full')
  const list = await (await fetch('/api/appointments', { headers: { Authorization: `Bearer ${login.access_token}` } })).json()
  assert.deepEqual(list.items.map((x) => x.id), [1])   // 病患只看得到自己的
  assert.equal(list.next_cursor, null)
  assert.equal((await fetch('/api/appointments/2', { headers: { Authorization: `Bearer ${login.access_token}` } })).status, 404)
  const cancelled = await (await post('/api/appointments/1/cancel', {}, login.access_token)).json()
  assert.equal(cancelled.status, 'cancelled')
  const again = await post('/api/appointments/1/cancel', {}, login.access_token)
  assert.equal(again.status, 409)
  assert.equal((await fetch('/api/appointments/999')).status, 404)
})

await test('api.auth = true：內建路由沒帶 token 回 401 與 WWW-Authenticate', async () => {
  const { api, fetch } = make()
  api.auth = true
  const res = await fetch('/api/sessions')
  assert.equal(res.status, 401)
  assert.equal(res.headers.get('www-authenticate'), 'Bearer')
})

// ── 迴圈保護 ──
await test('guardLoops：while、for(;;)、for 條件、do…while、braced for…of', () => {
  assert.equal(guardLoops('while (x) y()'), 'while (__lp() && (x)) y()')
  assert.equal(guardLoops('for (;;) x++'), 'for (; __lp() ;) x++')
  assert.equal(guardLoops('for (let i = 0; i < n; i++) s += i'), 'for (let i = 0; __lp() && ( i < n); i++) s += i')
  assert.equal(guardLoops('do { i++ } while (i < 3)'), 'do { i++ } while (__lp() && (i < 3))')
  assert.equal(guardLoops('for (const x of xs) { f(x) }'), 'for (const x of xs) { __lp(); f(x) }')
  assert.equal(guardLoops('for (const k in o) f(k)'), 'for (const k in o) f(k)')
})

await test('guardLoops：字串、樣板字串、註解、regex、屬性名稱裡的 for / while 不動', () => {
  const src = "const a = 'while (x)'; const b = `for (;;) ${'x'}`; // while (1)\n/* for (;;) */ const r = /while (/; o.while(1); const t = { for: 1 }"
  assert.equal(guardLoops(src), src)
  // 樣板字串的 ${} 裡是程式碼
  assert.equal(guardLoops('`${(() => { while (a) a-- })()}`'), '`${(() => { while (__lp() && (a)) a-- })()}`')
  // Vue 模板字串裡的 v-for 不是 JS 迴圈
  const tpl = "template: `<li v-for=\"p in list\">{{ p }}</li>`"
  assert.equal(guardLoops(tpl), tpl)
})

await test('guardLoops：不加換行（錯誤的行號不變），改寫後仍是合法的 JS', () => {
  const src = 'let i = 0\nwhile (i < 3) {\n  i++\n}\nfor (let j = 0; j < 2; j++) {\n  for (;;) { break }\n}\nlabel: do { i-- } while (i > 0)\n'
  const out = guardLoops(src)
  assert.equal(out.split('\n').length, src.split('\n').length)
  let calls = 0
  new Function('__lp', out)(() => { calls++; return true })
  assert.ok(calls > 5)
})

await test('guardLoops：插入的 __lp 能中止無窮迴圈', () => {
  let n = 0
  const lp = () => { if (++n > 1000) throw new RangeError('loop'); return true }
  for (const src of ['while (true) {}', 'for (;;) {}', 'do {} while (1)', 'for (let i = 0; i >= 0; i++) {}', 'function* g() { while (true) yield 1 } for (const x of g()) { }']) {
    n = 0
    assert.throws(() => new Function('__lp', guardLoops(src))(lp), /loop/, src)
  }
})

await test('guardHtml：只改 inline 的 JS script', () => {
  const html = '<p>for (;;)</p><script>while (1) {}</script><script type="module">for (;;) {}</script><script src="x.js"></script><script type="importmap">{"while": 1}</script>'
  assert.equal(guardHtml(html), '<p>for (;;)</p><script>while (__lp() && (1)) {}</script><script type="module">for (; __lp() ;) {}</script><script src="x.js"></script><script type="importmap">{"while": 1}</script>')
})

// ── srcdoc ──
await test('buildSrcdoc（vue）：import map、prelude、題目與測試的假 API、使用者 module 的行號', () => {
  const code = "import { ref } from 'vue'\nconst s = '</script>'\nthrow new Error('x')"
  const { html, userStart, userEnd } = buildSrcdoc({ kind: 'vue', code, ex: { api: "api.get('/api/a', { body: 1 })", css: 'p { color: red }' }, test: { name: '測試', code: 'assert(1)', api: 'api.latency = 0' }, runId: 'r1', vueUrl: 'data:text/javascript;base64,AA==' })
  assert.match(html, /<script type="importmap">\{"imports":\{"vue":"data:text\/javascript;base64,AA=="\}\}<\/script>/)
  assert.ok(html.indexOf('importmap') < html.indexOf('"runId":"r1"'))
  assert.ok(html.indexOf("api.get('/api/a'") < html.indexOf('api.latency = 0'))
  assert.match(html, /<div id="app"><\/div><script type="module">/)
  assert.ok(!html.slice(html.indexOf('<div id="app">')).includes("'</script>'"), '使用者程式裡的 </script> 要跳脫')
  const lines = html.split('\n')
  assert.equal(lines[userStart - 1], "import { ref } from 'vue'")
  assert.equal(lines[userEnd - 1], "throw new Error('x')")
  assert.match(html, /"userStart":\d+,"userEnd":\d+/)
  assert.match(html, /__frame\.runTest\("測試", async \(\) => \{\nassert\(1\)\n\}\)/)
})

await test('buildSrcdoc（css、html）：css 題把使用者的 CSS 接在題目的 html 前；html 題的 script 加上迴圈保護', () => {
  const css = buildSrcdoc({ kind: 'css', code: '.card { display: flex }', ex: { html: '<div class="card"></div>' }, runId: 'r2' })
  assert.ok(css.html.indexOf('.card { display: flex }') < css.html.indexOf('<div class="card">'))
  assert.ok(!css.html.includes('importmap'))
  assert.equal(css.userStart, 0)
  const h = buildSrcdoc({ kind: 'html', code: '<p>hi</p>\n<script>while (x) {}</script>', runId: 'r3' })
  assert.match(h.html, /while \(__lp\(\) && \(x\)\)/)
  assert.equal(h.html.split('\n')[h.userStart - 1], '<p>hi</p>')
})

await test('vendorsFor：程式碼 import 了哪個套件才放進 import map；pinia、vue-router 一定連同 vue', () => {
  assert.deepEqual(vendorsFor('vue', "import { ref } from 'vue'"), ['vue'])
  assert.deepEqual(vendorsFor('vue', ''), ['vue'])                                   // vue 題一定有 Vue
  assert.deepEqual(vendorsFor('html', '<p>hi</p>'), [])
  assert.deepEqual(vendorsFor('css', '.a { color: red }'), [])
  assert.deepEqual(vendorsFor('html', '<script type="module">import { createApp } from "vue"</script>'), ['vue'])
  assert.deepEqual(vendorsFor('vue', "import { defineStore } from 'pinia'"), ['vue', 'pinia'])
  assert.deepEqual(vendorsFor('html', "const { createRouter } = await import('vue-router')"), ['vue', 'vue-router'])
  assert.deepEqual(vendorsFor('vue', "import { createRouter } from 'vue-router'\nimport { createPinia } from 'pinia'"), ['vue', 'pinia', 'vue-router'])
  assert.deepEqual(vendorsFor('html', "import 'vue-router'"), ['vue', 'vue-router'])
  assert.deepEqual(vendorsFor('vue', "// 註解裡提到 vue-router 與 pinia 不算\nconst s = 'pinia'"), ['vue'])
  assert.deepEqual(vendorsFor('html', "import x from 'vue-router-extra'"), [])     // 名稱要完全相同
})

await test('versions.js：pinia、vue-router 只有 prod 檔，dev 退回 prod；每個 vendor 檔只 import import map 裡有的名稱', () => {
  assert.equal(vendorPath('vue'), `vendor/vue@${VERSIONS.vue}/vue.esm-browser.js`)
  assert.equal(vendorPath('pinia'), `vendor/pinia@${VERSIONS.pinia}/pinia.esm-browser.prod.js`)
  assert.equal(vendorPath('vue-router', 'dev'), `vendor/vue-router@${VERSIONS['vue-router']}/vue-router.esm-browser.prod.js`)
  const names = new Set([...MODULE_VENDORS, ...Object.values(VENDOR_SUBMODULES).flatMap((m) => Object.keys(m))])
  for (const pkg of MODULE_VENDORS) {
    for (const file of [...Object.values(VENDOR_FILES[pkg]), ...Object.values(VENDOR_SUBMODULES[pkg] || {})]) {
      const src = readFileSync(new URL(`../node_modules/${pkg}/${file}`, import.meta.url), 'utf8')
      const specs = [...src.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["']([^"'./][^"']*)["']/g)].map((m) => m[1])
      for (const spec of specs) assert.ok(names.has(spec), `${pkg}/${file} import 了 ${spec}，import map 裡沒有`)
    }
  }
})

await test('buildSrcdoc（imports）：import map 列出每個套件；vue-router 指到包裝模組，真正的檔在 @sandbox/vue-router', async () => {
  // 瀏覽器環境的最小替身：frame.js 用 window.location 組網址、FileReader 把 vendor 檔轉成 data: URL
  globalThis.window = { location: { href: 'http://localhost/' } }
  globalThis.FileReader = class { readAsDataURL(blob) { blob.arrayBuffer().then((b) => { this.result = `data:${blob.type};base64,` + Buffer.from(b).toString('base64'); this.onload() }) } }
  const realFetch = globalThis.fetch
  const fake = { vue: 'data:text/javascript;base64,VlVF', pinia: 'data:text/javascript;base64,UElOSUE=', 'vue-router': 'data:text/javascript;base64,Uk9VVEVS' }
  globalThis.fetch = async (url) => new Response(atob(fake[Object.keys(fake).find((k) => String(url).includes(`/${k}@`))].split(',')[1]))
  try {
    const map = await importMapFor('vue', "import { createRouter } from 'vue-router'\nimport { defineStore } from 'pinia'")
    assert.deepEqual(Object.keys(map), ['vue', 'pinia', 'vue-router', '@sandbox/vue-router'])
    assert.equal(map.vue, fake.vue)
    assert.equal(map['@sandbox/vue-router'], fake['vue-router'])
    const shim = Buffer.from(map['vue-router'].split(',')[1], 'base64').toString('utf8')
    assert.match(shim, /export \* from '@sandbox\/vue-router'/)
    assert.match(shim, new RegExp(`\\+\\+n <= ${ROUTER_REDIRECT_LIMIT}`))
    assert.equal(await importMapFor('html', '<p>沒有 import</p>'), null)
    const { html } = buildSrcdoc({ kind: 'vue', code: 'x', runId: 'r9', imports: map })
    const im = JSON.parse(/<script type="importmap">(.*?)<\/script>/.exec(html)[1])
    assert.deepEqual(Object.keys(im.imports), ['vue', 'pinia', 'vue-router', '@sandbox/vue-router'])
    const cfg = JSON.parse(/"runId":"r9"[^\n]*?\}/.exec(html)[0].replace(/^/, '{'))
    assert.deepEqual(cfg.vendors.map((v) => v[1]), ['vue', 'pinia', 'vue-router', 'vue-router'])   // stack 裡的 data: URL 換成套件名稱
  } finally {
    globalThis.fetch = realFetch
    delete globalThis.window
    delete globalThis.FileReader
  }
})

// ── Element Plus（module 主檔、語系 module、樣式檔） ──
await test('versions.js：element-plus 是 module 套件，有 zh-tw 語系 module 與樣式檔；主檔只 import vue、語系檔不 import 任何東西', () => {
  assert.ok(MODULE_VENDORS.includes('element-plus'))
  assert.equal(vendorPath('element-plus', 'dev'), `vendor/element-plus@${VERSIONS['element-plus']}/index.full.min.mjs`)   // 沒有 dev，退回 prod
  assert.deepEqual(Object.keys(VENDOR_SUBMODULES['element-plus']), ['element-plus/es/locale/lang/zh-tw'])
  assert.equal(vendorFilePath('element-plus', VENDOR_STYLES['element-plus']), `vendor/element-plus@${VERSIONS['element-plus']}/index.css`)
  const spec = (file) => [...readFileSync(new URL(`../node_modules/element-plus/${file}`, import.meta.url), 'utf8').matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1])
  assert.deepEqual([...new Set(spec(VENDOR_FILES['element-plus'].prod))], ['vue'])
  assert.deepEqual(spec(VENDOR_SUBMODULES['element-plus']['element-plus/es/locale/lang/zh-tw']), [])
  for (const f of [VENDOR_FILES['element-plus'].prod, ...Object.values(VENDOR_SUBMODULES['element-plus']), VENDOR_STYLES['element-plus']]) {
    assert.ok(readFileSync(new URL(`../node_modules/element-plus/${f}`, import.meta.url)).length > 0, f)
  }
})

await test('vendorsFor／stylesFor：import element-plus（或它的子路徑）才加上 element-plus 與 vue；只有樣式檔的網址，不用下載', () => {
  globalThis.window = { location: { href: 'http://localhost/' } }
  try {
    assert.deepEqual(vendorsFor('vue', "import ElementPlus, { ElMessage } from 'element-plus'"), ['vue', 'element-plus'])
    assert.deepEqual(vendorsFor('html', "import zhTw from 'element-plus/es/locale/lang/zh-tw'"), ['vue', 'element-plus'])
    assert.deepEqual(vendorsFor('vue', "const { ElButton } = await import('element-plus')"), ['vue', 'element-plus'])
    assert.deepEqual(vendorsFor('vue', "import { defineStore } from 'pinia'\nimport ElementPlus from 'element-plus'"), ['vue', 'pinia', 'element-plus'])
    assert.deepEqual(vendorsFor('vue', "// 文字裡提到 element-plus 不算\nconst s = 'element-plus'"), ['vue'])
    assert.deepEqual(vendorsFor('vue', "import x from 'element-plus-extra'"), ['vue'])
    assert.deepEqual(stylesFor('vue', "import ElementPlus from 'element-plus'"), [`http://localhost/vendor/element-plus@${VERSIONS['element-plus']}/index.css`])
    assert.deepEqual(stylesFor('vue', "import { ref } from 'vue'"), [])
    assert.deepEqual(stylesFor('html', '<p>x</p>'), [])
  } finally {
    delete globalThis.window
  }
})

await test('importMapFor（element-plus）：主檔與 zh-tw 語系都進 import map；只用 vue 時不下載 element-plus', async () => {
  globalThis.window = { location: { href: 'http://localhost/' } }
  globalThis.FileReader = class { readAsDataURL(blob) { blob.arrayBuffer().then((b) => { this.result = `data:${blob.type};base64,` + Buffer.from(b).toString('base64'); this.onload() }) } }
  const realFetch = globalThis.fetch
  const urls = []
  globalThis.fetch = async (url) => { urls.push(String(url)); return new Response('/* ' + String(url).split('/').pop() + ' */') }
  try {
    await importMapFor('vue', "import { ref } from 'vue'")
    assert.ok(!urls.some((u) => u.includes('element-plus')), '只用 vue 不該下載 element-plus：' + urls.join(', '))
    const map = await importMapFor('vue', "import ElementPlus from 'element-plus'\nimport zhTw from 'element-plus/es/locale/lang/zh-tw'")
    assert.deepEqual(Object.keys(map), ['vue', 'element-plus', 'element-plus/es/locale/lang/zh-tw'])
    assert.equal(Buffer.from(map['element-plus'].split(',')[1], 'base64').toString(), '/* index.full.min.mjs */')
    assert.equal(Buffer.from(map['element-plus/es/locale/lang/zh-tw'].split(',')[1], 'base64').toString(), '/* zh-tw.min.mjs */')
    assert.equal(urls.filter((u) => u.includes('element-plus')).length, 2)
    await importMapFor('vue', "import ElementPlus from 'element-plus'")
    assert.equal(urls.filter((u) => u.includes('element-plus')).length, 2, '每個檔只下載一次')
  } finally {
    globalThis.fetch = realFetch
    delete globalThis.window
    delete globalThis.FileReader
  }
})

await test('buildSrcdoc（styles）：樣式檔以 <link> 放在 <head>，在題目的 CSS 之前；網址會跳脫', () => {
  const href = 'http://localhost/vendor/element-plus@2.14.8/index.css'
  const { html } = buildSrcdoc({ kind: 'vue', code: 'x', ex: { css: '.a { color: red }' }, runId: 'r12', imports: { vue: 'data:text/javascript;base64,AA==' }, styles: [href] })
  const at = html.indexOf(`<link rel="stylesheet" href="${href}">`)
  assert.ok(at > 0 && at < html.indexOf('<style>.a { color: red }') && at < html.indexOf('<body>'))
  assert.ok(buildSrcdoc({ kind: 'vue', code: 'x', runId: 'r13', styles: ['http://x/"><script>'] }).html.includes('href="http://x/&quot;&gt;&lt;script&gt;"'))
  assert.ok(!buildSrcdoc({ kind: 'vue', code: 'x', runId: 'r14' }).html.includes('<link rel="stylesheet"'))
})

// ── Tailwind（@tailwindcss/browser，classic script） ──
await test('versions.js：@tailwindcss/browser 是 classic script，不進 import map；dev、prod 是同一個檔', () => {
  assert.deepEqual(CLASSIC_VENDORS, ['@tailwindcss/browser'])
  assert.ok(!MODULE_VENDORS.includes('@tailwindcss/browser'))
  assert.equal(vendorPath('@tailwindcss/browser', 'dev'), `vendor/@tailwindcss/browser@${VERSIONS['@tailwindcss/browser']}/index.global.js`)
  assert.equal(vendorPath('@tailwindcss/browser', 'prod'), vendorPath('@tailwindcss/browser', 'dev'))
  const src = readFileSync(new URL('../node_modules/@tailwindcss/browser/dist/index.global.js', import.meta.url), 'utf8')
  assert.ok(!/^\s*(import|export)\s/m.test(src.slice(0, 200)), 'index.global.js 應該是 IIFE，不是 ES module')
  assert.deepEqual(vendorsFor('html', "import '@tailwindcss/browser'"), [])   // 不會被當成 import map 的套件
})

await test('usesTailwind：題目的 tailwind 欄位優先；沒有題目設定時看 html 有沒有 <style type="text/tailwindcss">', () => {
  assert.equal(usesTailwind('html', '<p class="p-4">', { tailwind: true }), true)
  assert.equal(usesTailwind('vue', "import { ref } from 'vue'", { tailwind: true }), true)
  assert.equal(usesTailwind('html', '<style type="text/tailwindcss"></style>', { tailwind: false }), false)
  assert.equal(usesTailwind('html', '<style type="text/tailwindcss">@theme { --color-x: red; }</style>'), true)
  assert.equal(usesTailwind('html', "<style type='text/tailwindcss' id=a></style>"), true)
  assert.equal(usesTailwind('html', '<STYLE TYPE=text/tailwindcss></STYLE>'), true)
  assert.equal(usesTailwind('html', '<p class="p-4 md:flex">只有 class 不算</p><style>.a{}</style>'), false)
  assert.equal(usesTailwind('html', '<!-- text/tailwindcss -->'), false)
  assert.equal(usesTailwind('css', '<style type="text/tailwindcss">', { tailwind: true }), false)  // css 題不經 Tailwind
  assert.equal(usesTailwind('vue', '<style type="text/tailwindcss">'), false)                     // vue 題要設 tailwind: true
})

await test('buildSrcdoc（tailwindUrl）：classic script 在 prelude 之後、<body> 之前；cfg.tailwind 讓測試先等它', () => {
  const url = 'data:text/javascript;base64,VFc='
  const { html } = buildSrcdoc({ kind: 'html', code: '<p class="p-4">x</p>', test: { name: 't', code: 'assert(1)' }, runId: 'r10', tailwindUrl: url })
  const at = html.indexOf(`<script src="${url}"></script>`)
  assert.ok(at > 0)
  assert.ok(at > html.indexOf('"runId":"r10"') && at < html.indexOf('<body>'))
  assert.ok(!html.includes('importmap'))
  assert.match(html, /"tailwind":true/)
  assert.match(html, /\["data:text\/javascript;base64,VFc=","@tailwindcss\/browser"\]/)
  const plain = buildSrcdoc({ kind: 'html', code: '<p class="p-4">x</p>', runId: 'r11' }).html
  assert.match(plain, /"tailwind":false/)
  assert.ok(!plain.includes('<script src='))
})

await test('tailwindUrlFor：用不到時不發請求；用到時只下載一次', async () => {
  globalThis.window = { location: { href: 'http://localhost/' } }
  globalThis.FileReader = class { readAsDataURL(blob) { blob.arrayBuffer().then((b) => { this.result = `data:${blob.type};base64,` + Buffer.from(b).toString('base64'); this.onload() }) } }
  const realFetch = globalThis.fetch
  const urls = []
  globalThis.fetch = async (url) => { urls.push(String(url)); return new Response('/* tw */') }
  try {
    assert.equal(await tailwindUrlFor('html', '<p class="p-4">x</p>'), null)
    assert.equal(await tailwindUrlFor('css', '.a{}', { tailwind: true }), null)
    assert.equal(urls.length, 0)
    const a = await tailwindUrlFor('html', '<p>x</p>', { tailwind: true })
    const b = await tailwindUrlFor('html', '<style type="text/tailwindcss"></style>')
    assert.equal(a, b)
    assert.match(a, /^data:text\/javascript;base64,/)
    assert.equal(urls.length, 1)
    assert.ok(urls[0].endsWith(`/vendor/@tailwindcss/browser@${VERSIONS['@tailwindcss/browser']}/index.global.js`))
  } finally {
    globalThis.fetch = realFetch
    delete globalThis.window
    delete globalThis.FileReader
  }
})

console.log(`${n} passed`)

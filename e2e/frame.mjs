// 前端沙箱執行環境（src/runtime/frame.js）的自我測試：隔離、無窮迴圈、Console 與錯誤、假 API、viewport、表單送出、
// 舊 runId 的訊息、390px 的預覽窗格。用 ?verify=frame harness 直接呼叫 window.__frame。
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

  // ── Playground：html 與 vue 模式 ──
  for (const lang of ['html', 'vue']) {
    const pg = await ctx.newPage()
    pg.on('pageerror', (e) => errs.push('PAGEERROR(pg) ' + e.message))
    await pg.goto(base + `#/playground?lang=${lang}`, { waitUntil: 'networkidle' })
    await pg.waitForSelector('.pg-api')
    await pg.click('.pg-toolbar button:has-text("執行")')
    await pg.waitForSelector('.fp iframe.sbx-frame', { timeout: 20000 })
    const f = pg.frames().find((x) => x.url() === 'about:srcdoc')
    await f?.waitForSelector('button, main', { timeout: 10000 }).catch(() => {})
    t(`playground ${lang} runs in the sandbox`, !!f && (await f.$$('button')).length > 0)
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
  await browser.close()
}
process.exit(failed ? 1 : 0)

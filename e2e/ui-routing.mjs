// 路由與懶載入：首頁以外的頁面 chunk 只在進入時下載；換頁時舊頁面留在畫面上（不閃「載入中…」）、頂端出現進度條。
// 用 CDP 把網路調慢，讓 chunk 下載真的需要時間，才看得到過渡狀態。
// 前置：npm run build && npm run preview
import { chromium } from 'playwright'

const base = process.env.E2E_BASE || 'http://localhost:4173/'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
const page = await ctx.newPage()
const errs = []
let failed = 0
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 200)) })
const t = (label, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`) }

// 首頁載入時不該下載 CodeMirror / 題庫 / 課綱的 chunk
const loaded = new Set()
page.on('response', (r) => { const u = r.url(); if (u.includes('/assets/') && u.endsWith('.js')) loaded.add(u.split('/').pop()) })
await page.goto(base, { waitUntil: 'networkidle' })
await page.waitForSelector('.metro')
const homeChunks = [...loaded]
t('home does not load CodeMirror chunk', !homeChunks.some((n) => /^CodeEditor-/.test(n)), homeChunks.join(','))
t('home does not load Curriculum chunk', !homeChunks.some((n) => /^Curriculum-/.test(n)))
t('home does not load page chunks', !homeChunks.some((n) => /^(Skill|Exercises|Scenarios|Playground|Roadmap)-/.test(n)))
t('home does not load skill body chunks', !homeChunks.some((n) => /^d\d-[a-z]+-/.test(n)))

// 技能頁：只載自己領域的內文 chunk；同領域換課不再下載；換領域才多載一個
const bodyChunks = () => [...loaded].filter((n) => /^d\d-[a-z]+-/.test(n))
await page.goto(base + '#/skill/sql-joins', { waitUntil: 'networkidle' })
await page.waitForSelector('.points li')
t('skill page renders body (points)', (await page.$$('.points li')).length >= 2)
t('skill page loads exactly its domain body chunk', bodyChunks().length === 1 && /^d3-data-/.test(bodyChunks()[0]), bodyChunks().join(','))
const h1Before = await page.textContent('h1')
await page.click('.lesson-nav a.next')
await page.waitForFunction((prev) => (document.querySelector('h1')?.textContent || '') !== prev && document.querySelectorAll('.points li').length > 0, h1Before, { timeout: 30000 })
t('same-domain next lesson loads no new body chunk', bodyChunks().length === 1, await page.textContent('h1'))
await page.goto(base + '#/skill/jwt', { waitUntil: 'networkidle' })
await page.waitForFunction(() => /JWT/.test(document.querySelector('h1')?.textContent || '') && document.querySelectorAll('.points li').length > 0, null, { timeout: 30000 })
t('other domain loads its own body chunk', bodyChunks().length === 2 && bodyChunks().some((n) => /^d4-auth-/.test(n)), bodyChunks().join(','))

// 調慢網路：延遲 400 ms、80 kB/s，讓 Curriculum chunk（約 70 kB）要跑一秒多
const cdp = await ctx.newCDPSession(page)
await cdp.send('Network.enable')
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 80 * 1024, uploadThroughput: 80 * 1024 })

const homeHeading = await page.textContent('h1')
await page.click('.topnav-links a[href="#/curriculum"]')
// 過渡期間：舊頁面還在、有進度條、沒有「載入中…」
await page.waitForSelector('.route-progress', { timeout: 3000 }).catch(() => {})
const during = await page.evaluate(() => ({
  progress: !!document.querySelector('.route-progress'),
  fallback: [...document.querySelectorAll('.status-msg')].some((e) => e.textContent.includes('載入中')),
  h1: document.querySelector('h1')?.textContent || '',
}))
t('progress bar shown while chunk loads', during.progress)
t('no 載入中 fallback flash', !during.fallback)
t('previous page stays visible', during.h1 === homeHeading, during.h1)
// 到齊後：新頁面出現、進度條消失
await page.waitForFunction(() => /課綱/.test(document.querySelector('h1')?.textContent || ''), null, { timeout: 30000 })
await page.waitForFunction(() => !document.querySelector('.route-progress'), null, { timeout: 5000 })
t('curriculum rendered', /課綱|週/.test(await page.textContent('h1')), await page.textContent('h1'))
t('curriculum chunk loaded on demand', [...loaded].some((n) => /^Curriculum-/.test(n)))
t('nav active state follows route', await page.$eval('.topnav-links a[href="#/curriculum"]', (a) => a.classList.contains('active')))

// 直接深連結到懶載入頁（整頁載入）：首屏顯示 fallback 也可以，但最後要渲染出來、無錯誤
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
await page.goto(base + '#/scenario/cache', { waitUntil: 'networkidle' })
await page.waitForSelector('section.lab', { timeout: 30000 })
t('deep link to lazy page renders', /API 快取/.test(await page.textContent('h1')))

console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page/console errors')
await browser.close()
process.exit(failed || errs.length ? 1 : 0)

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
const requested = []   // 所有請求的網址（執行環境的檔案不在 /assets/ 底下）
page.on('response', (r) => { const u = r.url(); if (u.includes('/assets/') && u.endsWith('.js')) loaded.add(u.split('/').pop()) })
page.on('request', (r) => requested.push(r.url()))
// 沙箱執行環境：frame.js 的 chunk 與 public/vendor/（自架的 Vue）只在執行前端題時才下載
const sandboxLoaded = (from = 0) => [...loaded].some((n) => /^frame-/.test(n)) || requested.slice(from).some((u) => u.includes('/vendor/'))
await page.goto(base, { waitUntil: 'networkidle' })
await page.waitForSelector('.track-cards')
const homeChunks = [...loaded]
t('home does not load CodeMirror chunk', !homeChunks.some((n) => /^CodeEditor-/.test(n)), homeChunks.join(','))
t('home does not load Curriculum chunk', !homeChunks.some((n) => /^Curriculum-/.test(n)))
t('home does not load page chunks', !homeChunks.some((n) => /^(Skill|Exercises|Scenarios|Playground|Roadmap|TrackHome)-/.test(n)))
t('home lists the three tracks', (await page.$$eval('.track-card h2', (hs) => hs.map((h) => h.textContent))).join() === '前端,後端,AI')
t('home does not load skill body chunks', !homeChunks.some((n) => /^d\d+-[a-z]+-/.test(n)))
t('home does not load the Firebase SDK (only after 登入 or a restored session)', !homeChunks.some((n) => /^firebase-/.test(n)))
t('home title', await page.title() === 'u kinda should know', await page.title())
t('home does not load the sandbox runtime (frame chunk, vendor/)', !sandboxLoaded(), requested.filter((u) => u.includes('/vendor/')).join(','))
t('home does not request Pyodide or PGlite', !requested.some((u) => /\/pyodide\/|pglite/i.test(u)))

// 路線首頁：懶載入 TrackHome，有路線圖；導覽列的路線分頁標出目前的路線，功能連結帶上 ?track=
await page.goto(base + '#/track/backend', { waitUntil: 'networkidle' })
await page.waitForSelector('.metro svg')
t('track home loads its chunk on demand', [...loaded].some((n) => /^TrackHome-/.test(n)))
t('track home title', await page.title() === '後端 · u kinda should know', await page.title())
t('track tab marks current track', await page.$eval('.track-tab.on', (a) => a.textContent) === '後端')
t('nav links carry the current track', await page.$eval('.topnav-links a[href^="#/roadmap"]', (a) => a.getAttribute('href')) === '#/roadmap?track=backend')
for (const tr of ['frontend', 'ai']) {
  await page.goto(base + `#/track/${tr}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.metro svg, .track-home, h1')
}
t('track homes do not load the sandbox runtime', !sandboxLoaded(), requested.filter((u) => u.includes('/vendor/')).join(','))


// 技能頁：只載自己領域的內文 chunk；同領域換課不再下載；換領域才多載一個
const bodyChunks = () => [...loaded].filter((n) => /^d\d+-[a-z]+-/.test(n))
await page.goto(base + '#/skill/sql-joins', { waitUntil: 'networkidle' })
await page.waitForSelector('.points li')
t('skill page renders body (points)', (await page.$$('.points li')).length >= 2)
t('skill page title', await page.title() === 'JOIN 七兄弟 · u kinda should know', await page.title())
t('skill page crumbs show its track', /首頁\s*\/\s*後端\s*\/\s*資料儲存/.test(await page.textContent('.crumbs')), await page.textContent('.crumbs'))
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
await page.click('.topnav-links a[href^="#/curriculum"]')
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
t('curriculum title', await page.title() === '課綱 · u kinda should know', await page.title())
t('curriculum chunk loaded on demand', [...loaded].some((n) => /^Curriculum-/.test(n)))
t('nav active state follows route', await page.$eval('.topnav-links a[href^="#/curriculum"]', (a) => a.classList.contains('active')))

// 直接深連結到懶載入頁（整頁載入）：首屏顯示 fallback 也可以，但最後要渲染出來、無錯誤
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
await page.goto(base + '#/scenario/cache', { waitUntil: 'networkidle' })
await page.waitForSelector('section.lab', { timeout: 30000 })
t('deep link to lazy page renders', /API 快取/.test(await page.textContent('h1')))
t('scenario title', await page.title() === 'API 快取 · u kinda should know', await page.title())

// 課綱：每週標題下掛該週的情境；?week=10 會捲到第 10 週
await page.goto(base + '#/curriculum?week=10', { waitUntil: 'networkidle' })
await page.waitForSelector('#week-10')
t('curriculum week 10 has scenario chips', (await page.$$('#week-10 + .curri-week-links a')).length >= 3, String((await page.$$('#week-10 + .curri-week-links a')).length))
// 課綱頁在標題渲染後的下一個 frame（requestAnimationFrame）才捲動：等條件成立，不要在渲染當下取樣
await page.waitForFunction(() => { const r = document.getElementById('week-10').getBoundingClientRect(); return r.top >= -5 && r.top < 200 }, null, { timeout: 3000 }).catch(() => {})
const weekTop = await page.evaluate(() => [Math.round(document.getElementById('week-10').getBoundingClientRect().top), Math.round(scrollY), document.querySelector('h1')?.textContent])
t('curriculum ?week= scrolls to the week', weekTop[0] >= -5 && weekTop[0] < 200, JSON.stringify(weekTop))
t('scenario page week pill links to curriculum week', (await (await (await page.goto(base + '#/scenario/pagination', { waitUntil: 'networkidle' }), page.waitForSelector('.lesson-meta a.mono')), page.getAttribute('.lesson-meta a.mono', 'href'))) === '#/curriculum?track=backend&week=10')

// 前端題頁：進頁不下載 Pyodide、PGlite 與 vendor；按「執行」才載入沙箱與自架的 Vue
let mark = requested.length
await page.goto(base + '#/exercise/api-states-1', { waitUntil: 'networkidle' })
await page.waitForSelector('.ex .fp')
t('vue exercise page does not request Pyodide or PGlite', !requested.slice(mark).some((u) => /\/pyodide\/|pglite/i.test(u)), requested.slice(mark).filter((u) => /pyodide|pglite/i.test(u)).join(','))
t('vue exercise page waits for 執行 before loading the sandbox', !sandboxLoaded(mark))
await page.click('.ex button:has-text("執行")')
await page.waitForSelector('.fp iframe.sbx-frame', { timeout: 20000 })
t('執行 loads the sandbox chunk and the self-hosted Vue', [...loaded].some((n) => /^frame-/.test(n)) && requested.slice(mark).some((u) => /\/vendor\/vue@[\d.]+\/vue\.esm-browser\.js$/.test(u)))
// 後端的 SQL 題頁不請求 vendor（上一頁有預覽的 iframe 時，只換 hash 等不到 networkidle，改等 load 加元素）
mark = requested.length
await page.goto(base + '#/exercise/sql-joins-1', { waitUntil: 'load' })
await page.waitForSelector('.ex')
t('sql exercise page does not request vendor/', !requested.slice(mark).some((u) => u.includes('/vendor/')))

console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page/console errors')
await browser.close()
process.exit(failed || errs.length ? 1 : 0)

// 實驗室動畫的可見度暫停：lab 捲出畫面、或分頁切到背景時，useTicker / usePlayer 與 lab 自己的計時器要停；回來要續跑。
// 前置：npm run build && npm run preview
import { chromium } from 'playwright'

const base = process.env.E2E_BASE || 'http://localhost:4173/'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
const errs = []
let failed = 0
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 200)) })
const t = (label, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`) }
const tickOf = async () => Number(/t = (\d+)s：/.exec(await page.textContent('.lab-caption'))?.[1] ?? -1)

// 情境頁很長：lab 在上面，決策題在下面。按「發推播」後計時器每 70ms +1，跑 60 秒
await page.goto(base + '#/scenario/queue-backpressure', { waitUntil: 'networkidle' })
await page.waitForSelector('section.lab button:has-text("發推播")')
await page.click('section.lab button:has-text("發推播")')
await page.waitForTimeout(600)
const a1 = await tickOf(); await page.waitForTimeout(500); const a2 = await tickOf()
t('ticker advances while lab is in view', a2 > a1, `${a1} → ${a2}`)

// ① 捲到頁尾：lab 離開視窗（含 120px 邊界），計時應停
await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }))
await page.waitForTimeout(400)
const b1 = await tickOf(); await page.waitForTimeout(700); const b2 = await tickOf()
t('ticker pauses when lab scrolled out of view', b1 === b2 && b1 < 60, `${b1} → ${b2}`)

// 捲回來（把 lab 捲進畫面；情境頁頂端是情境敘述，lab 在下面）：續跑（不是重來）
await page.evaluate(() => document.querySelector('section.lab').scrollIntoView({ block: 'center', behavior: 'instant' }))
await page.waitForTimeout(400)
const c1 = await tickOf(); await page.waitForTimeout(500); const c2 = await tickOf()
t('ticker resumes from where it stopped', c1 >= b2 && c2 > c1, `${b2} → ${c1} → ${c2}`)

// ② 分頁到背景：覆寫 visibilityState 並發 visibilitychange
await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')) })
await page.waitForTimeout(300)
const d1 = await tickOf(); await page.waitForTimeout(700); const d2 = await tickOf()
t('ticker pauses when the tab is hidden', d1 === d2 && d1 < 60, `${d1} → ${d2}`)
await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')) })
await page.waitForTimeout(300)
const e1 = await tickOf(); await page.waitForTimeout(500); const e2 = await tickOf()
t('ticker resumes when the tab is visible again', e2 > e1, `${e1} → ${e2}`)

// ③ usePlayer（Stepper 自動播放）：DockerLab 在技能頁上，捲走要停
await page.goto(base + '#/skill/docker-basics', { waitUntil: 'networkidle' })
await page.waitForSelector('section.lab .stepper')
const stepOf = async () => Number(/(\d+) \/ \d+/.exec(await page.textContent('section.lab .stepper .count'))?.[1] ?? -1)
await page.click('section.lab .stepper button[aria-label="自動播放"]')
await page.waitForTimeout(1700)
const s1 = await stepOf()
t('player advances in view', s1 >= 2, String(s1))
await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }))
await page.waitForTimeout(300)
const s2 = await stepOf(); await page.waitForTimeout(1800); const s3 = await stepOf()
t('player pauses when scrolled away', s2 === s3, `${s2} → ${s3}`)
await page.evaluate(() => document.querySelector('section.lab').scrollIntoView({ block: 'center', behavior: 'instant' }))
await page.waitForTimeout(1800)
t('player resumes in view', (await stepOf()) > s3, String(await stepOf()))
t('visibility state is exposed for tests', (await page.getAttribute('.lab-visibility', 'data-visible')) === '1')

console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page/console errors')
await browser.close()
process.exit(failed || errs.length ? 1 : 0)

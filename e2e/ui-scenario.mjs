// 設計情境 UI 端到端：分頁模擬器三個實驗 + 決策題（含理由儲存、重試、通過）
// 前置：npm run build && npm run preview
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const base = process.env.E2E_BASE || 'http://localhost:4173/'
mkdirSync('e2e/shots', { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
const errs = []
let failed = 0
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 200)) })
const t = (label, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`) }

await page.goto(base + '#/scenario/pagination', { waitUntil: 'networkidle' })
// ① 翻頁時有新資料
await page.click('button:has-text("插入一筆新評論")'); await page.click('button:has-text("下一頁")')
t('offset shows duplicate after insert', (await page.$$('.pgcol:first-child .pgrows li.dup')).length >= 1)
t('cursor has no duplicate', (await page.$$('.pgcol:last-child .pgrows li.dup')).length === 0)
await page.click('button:has-text("刪除一筆")'); await page.click('button:has-text("下一頁")')
t('offset skip notice after delete', (await page.$$('.pgskip')).length === 1)
t('cursor still no duplicate', (await page.$$('.pgcol:last-child .pgrows li.dup')).length === 0)
// ② 深頁成本：真的在 PGlite 上 EXPLAIN
await page.click('button:has-text("② 深頁的成本")')
await page.click('button:has-text("實測")')
await page.waitForSelector('.pgbench .res', { timeout: 180000 })
const ms = await page.$$eval('.pgbench .res .ms', (es) => es.map((e) => e.textContent))
t('explain analyze ran for both queries', ms.length === 2 && /掃 \d+ 列/.test(ms[0]), ms.join(' | '))
// ③ tie-breaker
await page.click('button:has-text("③ 排序鍵不唯一")')
t('rows lost without tie-breaker', (await page.$$('.pgtie li.lost')).length > 0)
await page.click('.toggle')
t('no rows lost with tie-breaker', (await page.$$('.pgtie li.lost')).length === 0)
// 決策題
const n = await page.$$eval('.decisions .quiz-q', (es) => es.length)
t('decisions rendered', n >= 3, `n=${n}`)
for (let i = 0; i < n; i++) await page.click(`.decisions .quiz-q:nth-child(${i + 1}) .quiz-opt:nth-child(2) input`)
await page.fill('.decisions .quiz-q:nth-child(1) textarea', '因為要跳頁')
await page.click('.decisions .btn.submit'); await page.waitForSelector('.decisions .quiz-explain')
t('verdict shown', /一致/.test(await page.textContent('.decisions .ex-verdict')))
let st = await page.evaluate(() => JSON.parse(localStorage.getItem('atlas-progress-v1')))
t('rationale persisted', st?.rationales?.['pagination:admin'] === '因為要跳頁')
const correct = await page.$$eval('.decisions .quiz-q', (qs) => qs.map((q) => [...q.querySelectorAll('.quiz-opt')].findIndex((o) => o.classList.contains('correct'))))
await page.click('.decisions button:has-text("再試一次")')
await page.waitForFunction(() => !document.querySelector('.decisions .quiz-explain'))
t('rationale kept after retry', (await page.inputValue('.decisions .quiz-q:nth-child(1) textarea')) === '因為要跳頁')
for (let i = 0; i < n; i++) await page.click(`.decisions .quiz-q:nth-child(${i + 1}) .quiz-opt:nth-child(${correct[i] + 1}) input`)
await page.click('.decisions .btn.submit'); await page.waitForSelector('.decisions .quiz-explain')
st = await page.evaluate(() => JSON.parse(localStorage.getItem('atlas-progress-v1')))
t('scenario passes when all correct', st?.scenarios?.pagination === 'pass')
await page.screenshot({ path: 'e2e/shots/scenario-decide.png' })
// 總覽頁反映狀態
await page.goto(base + '#/scenarios', { waitUntil: 'networkidle' })
t('scenarios list shows pass', (await page.$$('.scen-card .status.ok')).length === 1)
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page/console errors')
await browser.close()
process.exit(failed || errs.length ? 1 : 0)

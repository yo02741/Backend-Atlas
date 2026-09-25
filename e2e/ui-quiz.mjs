// 選擇題 UI 端到端：未答完不能交卷；答錯顯示解析；全對才通過並寫進 localStorage
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

await page.goto(base + '#/skill/sql-joins', { waitUntil: 'networkidle' })
await page.waitForSelector('.quiz', { timeout: 30000 })
const n = await page.$$eval('.quiz-q', (es) => es.length)
t('quiz rendered with 3 questions', n === 3, `n=${n}`)
t('submit disabled before answering', await page.$eval('.quiz .btn.submit', (b) => b.disabled))
// 全部選 A，交卷後從 correct 標記讀出正解
for (let i = 0; i < n; i++) await page.click(`.quiz-q:nth-child(${i + 1}) .quiz-opt:nth-child(1) input`)
await page.click('.quiz .btn.submit')
await page.waitForSelector('.quiz-explain', { timeout: 5000 })
t('explanations shown', (await page.$$('.quiz-explain')).length === n)
const correct = await page.$$eval('.quiz-q', (qs) => qs.map((q) => [...q.querySelectorAll('.quiz-opt')].findIndex((o) => o.classList.contains('correct'))))
t('correct options marked', correct.every((c) => c >= 0), JSON.stringify(correct))
await page.$eval('.quiz', (el) => el.scrollIntoView())
await page.screenshot({ path: 'e2e/shots/quiz-submitted.png' })
await page.click('.quiz button:has-text("再試一次")')
await page.waitForFunction(() => !document.querySelector('.quiz-explain'))
for (let i = 0; i < n; i++) await page.click(`.quiz-q:nth-child(${i + 1}) .quiz-opt:nth-child(${correct[i] + 1}) input`)
await page.click('.quiz .btn.submit')
await page.waitForSelector('.quiz-explain')
t('all correct → pass', (await page.textContent('.quiz .ex-verdict')).includes('全對'))
t('status pill', (await page.textContent('.quiz .ex-status')).includes('已通過'))
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('atlas-progress-v1')))
t('quiz pass persisted', stored?.quizzes?.['sql-joins'] === 'pass')
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page/console errors')
await browser.close()
process.exit(failed || errs.length ? 1 : 0)

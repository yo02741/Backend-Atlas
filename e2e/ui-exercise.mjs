// 練習題 UI 端到端：交錯的 → 未通過 + 對照表；貼上解答 → 通過；狀態寫進 localStorage 並在列表與課程頁反映
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
async function setCode(code) {
  await page.evaluate(() => document.querySelector('.ex .cm-content').focus())
  await page.keyboard.press('Control+A'); await page.keyboard.press('Delete')
  await page.keyboard.insertText(code)
}

// SQL：先交起始碼（COUNT(*) 錯）→ 未通過
await page.goto(base + '#/exercise/sql-joins-2', { waitUntil: 'networkidle' })
await page.waitForSelector('.rt-status.ready', { timeout: 120000 })
await page.click('.ex button:has-text("交卷")')
await page.waitForSelector('.ex-verdict', { timeout: 60000 })
t('sql wrong answer flagged', (await page.textContent('.ex-verdict')).includes('未通過'))
t('compare tables shown', (await page.$$('.ex-compare .out-table')).length === 2)
t('bad rows highlighted', (await page.$$('.ex-compare .row-bad')).length > 0)
t('no test block for sql', (await page.$$('.tests')).length === 0)
await page.screenshot({ path: 'e2e/shots/ex-sql-fail.png', fullPage: true })
await setCode('SELECT u.name, COUNT(o.id) AS orders\nFROM users u\nLEFT JOIN orders o ON o.user_id = u.id\nGROUP BY u.id, u.name;')
await page.click('.ex button:has-text("交卷")')
await page.waitForFunction(() => { const v = document.querySelector('.ex-verdict')?.textContent || ''; return v.includes('通過') && !v.includes('未') }, null, { timeout: 60000 })
t('sql correct answer passes', true)
t('status pill updated', (await page.textContent('.ex-status')).includes('已通過'))
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('atlas-progress-v1')))
t('progress persisted', stored?.exercises?.['sql-joins-2'] === 'pass')
await page.click('.ex button:has-text("查詢計畫")')
await page.waitForSelector('.plan-node', { timeout: 30000 })
t('explain plan in exercise', true)
await page.click('.ex button:has-text("提示")')
t('hint revealed', (await page.$$('.ex-hints li')).length === 1)
await page.click('.ex button:has-text("看解答")')
t('solution shown', (await page.$$('.ex-solution .cm-editor')).length === 1)

// 列表頁反映狀態
await page.goto(base + '#/exercises', { waitUntil: 'networkidle' })
t('exercises list shows pass', (await page.$$eval('.ex-list .status.ok', (es) => es.length)) === 1)

// Python：貼解答交卷
await page.goto(base + '#/exercise/python-backend-2', { waitUntil: 'networkidle' })
await page.waitForSelector('.rt-status.ready', { timeout: 180000 })
await setCode('def add_item(item, items=None):\n    if items is None:\n        items = []\n    items.append(item)\n    return items\n')
await page.click('.ex button:has-text("交卷")')
await page.waitForSelector('.tests-sum', { timeout: 60000 })
t('python tests pass in UI', (await page.textContent('.tests-sum')).includes('全部通過'))

// 技能頁：驗收徽章
await page.goto(base + '#/skill/python-backend', { waitUntil: 'networkidle' })
t('skill page shows assess progress', /驗收 1\/\d/.test(await page.textContent('.lesson-meta')))
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page/console errors')
await browser.close()
process.exit(failed || errs.length ? 1 : 0)

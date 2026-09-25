// Playground 執行環境端到端：SQL（PGlite）、Python（Pyodide）、JS（Worker）真的能跑、錯誤會顯示、逾時會中止並重生
// 前置：npm run build && npm run preview
import { chromium } from 'playwright'

const base = process.env.E2E_BASE || 'http://localhost:4173/'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
const errs = []
let failed = 0
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 300)) })
const t = (label, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`) }
async function setCode(code) {
  await page.evaluate(() => document.querySelector('.cm-content').focus())
  await page.keyboard.press('Control+A'); await page.keyboard.press('Delete')
  await page.keyboard.insertText(code)
}

// ---- SQL
await page.goto(base + '#/playground?lang=sql', { waitUntil: 'networkidle' })
await page.waitForSelector('.rt-status.ready', { timeout: 120000 })
await page.click('button:has-text("執行")')
await page.waitForSelector('.out-table', { timeout: 60000 })
const sqlRows = await page.$$eval('.out-table tbody tr', (rs) => rs.map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent)))
t('sql left join rows', sqlRows.length === 5 && sqlRows[0][0] === 'Bob', JSON.stringify(sqlRows[0]))
await page.click('button:has-text("EXPLAIN")')
await page.waitForSelector('.plan-node', { timeout: 30000 })
t('sql explain plan', (await page.$$('.plan-kind')).length > 0)
await setCode('SELECT * FROM nope;')
await page.click('button:has-text("執行")')
await page.waitForSelector('.out-err', { timeout: 30000 })
t('sql error shown', (await page.textContent('.out-err')).includes('nope'))

// ---- Python
await page.goto(base + '#/playground?lang=python', { waitUntil: 'networkidle' })
const t1 = Date.now()
await page.waitForSelector('.rt-status.ready', { timeout: 180000 })
console.log('python ready in', Date.now() - t1, 'ms')
await page.click('button:has-text("執行")')
await page.waitForSelector('.out-pre', { timeout: 60000 })
t('python dataclass output', (await page.textContent('.out-pre')).includes("User(id=1, name='Alice'"))
await page.selectOption('.pg-sample select', '1')
await page.click('button:has-text("執行")')
await page.waitForFunction(() => document.querySelector('.out-pre')?.textContent.includes('總共'), null, { timeout: 60000 })
t('python async gather', /總共 0\.[2-9]\d 秒/.test(await page.textContent('.out-pre')))
await setCode('print(1/0)')
await page.click('button:has-text("執行")')
await page.waitForFunction(() => document.querySelector('.out-err')?.textContent.includes('ZeroDivisionError'), null, { timeout: 30000 })
t('python error shown', true)
await setCode('while True: pass')
const t0 = Date.now()
await page.click('button:has-text("執行")')
await page.waitForFunction(() => document.querySelector('.out-err')?.textContent.includes('中止'), null, { timeout: 25000 })
t('python timeout kills worker', true, `${Date.now() - t0}ms`)
await setCode('print("alive")')
await page.click('button:has-text("執行")')
await page.waitForFunction(() => document.querySelector('.out-pre')?.textContent.includes('alive'), null, { timeout: 120000 })
t('python worker respawned', true)

// ---- JS
await page.goto(base + '#/playground?lang=js', { waitUntil: 'networkidle' })
await page.click('button:has-text("執行")')
await page.waitForSelector('.out-pre', { timeout: 30000 })
t('js promise.all output', (await page.textContent('.out-pre')).includes('"name":"user1"'))

console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page/console errors')
await browser.close()
process.exit(failed || errs.length ? 1 : 0)

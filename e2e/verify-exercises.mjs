// 每道程式題：解答必須通過、起始碼應該不通過（用 ?verify=1 harness 在真實執行環境評分）
// 前置：npm run build && npm run preview
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const base = process.env.E2E_BASE || 'http://localhost:4173/'
mkdirSync('e2e/shots', { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
const errs = []
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 200)) })
await page.goto(base + '?verify=1', { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__verify?.done, null, { timeout: 900000 })
const r = await page.evaluate(() => window.__verify.results)
let bad = 0
for (const x of r) {
  const flag = x.solutionPass ? (x.starterPass ? 'WARN starter passes' : 'ok') : 'FAIL'
  if (!x.solutionPass) bad++
  console.log(`${flag.padEnd(20)} ${x.id.padEnd(22)} ${x.kind.padEnd(7)} ${String(x.ms).padStart(6)}ms ${x.solutionPass ? '' : x.solutionMsg + ' ' + x.failedTests.join(' | ')}`)
}
console.log(`\n${r.length - bad} / ${r.length} solutions pass`)
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page/console errors')
await page.screenshot({ path: 'e2e/shots/verify.png', fullPage: true })
await browser.close()
process.exit(bad || errs.length ? 1 : 0)

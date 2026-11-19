// 每道程式題：解答必須通過、起始碼應該不通過（用 ?verify=1 harness 在真實執行環境評分）
// 起始碼通過算失敗（全站一致）；html / css / vue 題每題（解答加起始碼）要在 10 秒內評完。STARTER=1 列出起始碼沒通過的測試
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
// ONLY=題目或技能 id（逗號分隔）只驗這幾題
await page.goto(base + '?verify=1' + (process.env.ONLY ? '&only=' + process.env.ONLY : ''), { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__verify?.done, null, { timeout: 900000 })
const r = await page.evaluate(() => window.__verify.results)
// 前端題（沙箱 iframe）：解答加起始碼要在 10 秒內評完
const FRAME = ['html', 'css', 'vue']
const LIMIT_MS = 10000
let bad = 0
for (const x of r) {
  const slow = FRAME.includes(x.kind) && x.ms > LIMIT_MS
  const starterBad = x.starterPass
  const flag = !x.solutionPass ? 'FAIL' : starterBad ? 'FAIL starter passes' : slow ? `FAIL over ${LIMIT_MS / 1000}s` : 'ok'
  if (!x.solutionPass || slow || starterBad) bad++
  console.log(`${flag.padEnd(20)} ${x.id.padEnd(22)} ${x.kind.padEnd(7)} ${String(x.ms).padStart(6)}ms ${x.solutionPass ? '' : x.solutionMsg + ' ' + x.failedTests.join(' | ')}`)
  if (process.env.STARTER) for (const f of x.starterFailed || []) console.log(`${''.padEnd(20)}   starter ✕ ${f.slice(0, 160)}`)
}
console.log(`\n${r.length - bad} / ${r.length} exercises ok（解答通過、起始碼不通過；html / css / vue 另外要求 ${LIMIT_MS / 1000} 秒內評完）`)
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page/console errors')
await page.screenshot({ path: 'e2e/shots/verify.png', fullPage: true })
await browser.close()
process.exit(bad || errs.length ? 1 : 0)

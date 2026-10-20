// 深入內容裡標 run 的程式碼區塊（```python run 等）都必須能在瀏覽器執行環境跑成功——
// 讀者按「在 Playground 開啟」看到的就是這個結果。用 ?verify=deep harness。
// 前置：npm run build && npm run preview
import { chromium } from 'playwright'

const base = process.env.E2E_BASE || 'http://localhost:4173/'
const browser = await chromium.launch()
const page = await browser.newPage()
const errs = []
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
// ONLY=id1,id2 只驗這幾課
await page.goto(base + '?verify=deep' + (process.env.ONLY ? '&only=' + process.env.ONLY : ''), { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__verifyDeep?.done, null, { timeout: 900000 })
const r = await page.evaluate(() => window.__verifyDeep.results)
const bad = r.filter((x) => !x.ok)
for (const x of r) console.log(`${x.ok ? 'ok  ' : 'FAIL'} ${x.id.padEnd(36)} ${x.lang.padEnd(7)} ${x.error}`)
console.log(`\n${r.length - bad.length} / ${r.length} runnable blocks ok`)
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page errors')
await browser.close()
process.exit(bad.length || errs.length ? 1 : 0)

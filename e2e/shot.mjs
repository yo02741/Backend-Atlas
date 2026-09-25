// 截圖工具：node e2e/shot.mjs <url> <out.png> [width=1200] [theme=light|dark] [fullPage=true]
// 需要先起 dev（npm run dev）或 preview（npm run preview）server，以及 npx playwright install chromium
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const [url, out, width = '1200', theme = 'light', full = 'true'] = process.argv.slice(2)
if (!url || !out) { console.error('用法：node e2e/shot.mjs <url> <out.png> [width] [light|dark] [fullPage]'); process.exit(1) }
mkdirSync(dirname(out), { recursive: true })
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: Number(width), height: 900 }, colorScheme: theme, deviceScaleFactor: 1 })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()) })
await page.goto(url, { waitUntil: 'networkidle' })
await page.evaluate((t) => { try { localStorage.setItem('theme', t) } catch {} document.documentElement.setAttribute('data-theme', t) }, theme)
await page.waitForTimeout(600)
await page.screenshot({ path: out, fullPage: full === 'true' })
await browser.close()
console.log('ok', out)

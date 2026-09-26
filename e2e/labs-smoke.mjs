// 實驗室 smoke：每個 lab（含情境模擬器）隔離載入（?lab=Name），把畫面上所有控制項都動過一遍：
//   Seg 每個選項、Toggle 開關、Stepper 走到底、每個 slider 拉到兩端與中間、其餘按鈕各按兩輪；
// 全程收集 pageerror / console error|warning，並確認互動後畫面有變化、沒有橫向溢出。
// 目的：改 ui.jsx 或任何 lab 後，一次確認 37 個 lab 都沒炸。
// 前置：npm run build && npm run preview（或設 E2E_BASE 指向 dev server）
//   LAB=CacheScenarioLab node e2e/labs-smoke.mjs   只跑一個
//   SMOKE_MOBILE=1                                 額外在 390px 再跑一輪
import { chromium } from 'playwright'
import { readdirSync } from 'node:fs'

const base = process.env.E2E_BASE || 'http://localhost:4173/'
const only = process.env.LAB
const labs = [...readdirSync('src/labs'), ...readdirSync('src/labs/scenarios')]
  .filter((f) => f.endsWith('Lab.jsx')).map((f) => f.replace('.jsx', ''))
  .filter((n) => !only || n === only)
const viewports = [{ w: 1100, tag: 'desktop' }, ...(process.env.SMOKE_MOBILE ? [{ w: 390, tag: 'mobile' }] : [])]

const conc = Number(process.env.SMOKE_CONCURRENCY || 4)
const browser = await chromium.launch()
const contexts = new Map()
for (const vp of viewports) contexts.set(vp.tag, await browser.newContext({ viewport: { width: vp.w, height: 900 } }))
const jobs = viewports.flatMap((vp) => labs.map((name) => ({ name, vp })))
let failed = 0
const t0 = Date.now()
await Promise.all(Array.from({ length: Math.min(conc, jobs.length) }, async () => {
  while (jobs.length) {
    const { name, vp } = jobs.shift()
    const r = await runLab(contexts.get(vp.tag), name)
    const detail = `seg=${r.stat.radios} toggle=${r.stat.toggles} btn=${r.stat.buttons} slider=${r.stat.sliders} step=${r.stat.steps}${r.stat.skipped ? ` skipped=${r.stat.skipped}` : ''} ${r.ms}ms`
    if (r.reason) { failed++; console.log(`FAIL [${vp.tag}] ${name.padEnd(32)} ${detail}\n     ${r.reason}`) }
    else console.log(`ok   [${vp.tag}] ${name.padEnd(32)} ${detail}`)
  }
}))
await browser.close()
console.log(`${labs.length} labs × ${viewports.length} viewport(s), ${failed} failed, ${((Date.now() - t0) / 1000).toFixed(0)}s (concurrency ${conc})`)
process.exit(failed ? 1 : 0)

/* 跑一個 lab：回傳 { stat, ms, reason }，reason 為空字串代表通過 */
async function runLab(ctx, name) {
  const page = await ctx.newPage()
  page.setDefaultTimeout(4000)
  const errs = []
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 200)))
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`CONSOLE(${m.type()}) ` + m.text().slice(0, 200)) })
  const start = Date.now()
  const stat = { radios: 0, toggles: 0, buttons: 0, sliders: 0, steps: 0, skipped: 0 }
  let reason = ''
  try {
    await page.goto(`${base}?lab=${name}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('section.lab', { timeout: 30000 })
    const before = await page.evaluate(() => document.querySelector('section.lab').innerHTML)

    // 逐個 Seg 選項按過去；每按一個就把其他控制項都動一遍（切實驗後會出現不同的控制項）
    const radioCount = await page.$$eval('button[role=radio]', (es) => es.length)
    for (let i = 0; i < Math.max(1, radioCount); i++) {
      const rs = await page.$$('button[role=radio]')
      if (rs[i]) { if (await tryClick(rs[i])) stat.radios++; else stat.skipped++ }
      await pokeAll(page, stat, i === 0)
    }
    await page.waitForTimeout(700)
    const after = await page.evaluate(() => document.querySelector('section.lab').innerHTML)
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (over > 2) reason = `橫向溢出 ${over}px`
    const hasControls = stat.radios + stat.toggles + stat.buttons + stat.sliders + stat.steps > 0
    if (hasControls && before === after) reason = reason || '互動後畫面沒有變化'
  } catch (e) {
    reason = 'EXCEPTION ' + String(e.message || e).split('\n')[0].slice(0, 160)
  }
  if (errs.length) reason = (reason ? reason + '; ' : '') + errs.slice(0, 3).join(' | ')
  await page.close()
  return { stat, ms: Date.now() - start, reason }
}

/* 把目前畫面上的非 Seg 控制項都動一遍；full=false 時每個控制項只動一次（切到第二個以後的 Seg 選項時用，省時間） */
async function pokeAll(page, stat, full = true) {
  const rounds = full ? 2 : 1
  // Toggle：開再關
  for (let round = 0; round < rounds; round++) {
    const ts = await page.$$('label.toggle')
    for (const el of ts) { if (await tryClick(el)) stat.toggles++; else stat.skipped++ }
  }
  // Slider：最大 → 最小 → 中間，各自觸發 React 的 onChange
  for (const pos of full ? ['max', 'min', 'mid'] : ['max']) {
    const n = await page.$$eval('input[type=range]', (els, pos) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      for (const el of els) {
        const lo = Number(el.min), hi = Number(el.max)
        const v = pos === 'max' ? hi : pos === 'min' ? lo : lo + Math.round((hi - lo) / 2)
        set.call(el, String(v))
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }
      return els.length
    }, pos)
    if (pos === 'max') stat.sliders += n
    if (n) await page.waitForTimeout(80)
  }
  // Stepper：一路按「下一步」到底
  for (let k = 0; k < 16; k++) {
    const next = await page.$('.stepper button[aria-label="下一步"]:not([disabled])')
    if (!next) break
    if (await tryClick(next)) stat.steps++; else { stat.skipped++; break }
  }
  // 其他按鈕（開始 / 送請求 / 重來 / 播放…）：按兩輪，讓「再來一次」類的按鈕也被按到。
  // 很多 lab 在動畫進行中會把按鈕 disabled，所以每顆按鈕最多等 3 秒它變回可按；一直 disabled 的（例如 Stepper 起點的「重來」）就跳過。
  for (let round = 0; round < rounds; round++) {
    const sel = 'section.lab button:not([role=radio])'
    const count = await page.$$eval(sel, (es) => es.length)
    for (let i = 0; i < count; i++) {
      const enabled = await page.waitForFunction(([sel, i]) => { const b = document.querySelectorAll(sel)[i]; return b ? !b.disabled : 'gone' }, [sel, i], { timeout: 3000 }).then((h) => h.jsonValue()).catch(() => false)
      if (enabled === 'gone') break
      if (!enabled) continue
      const b = (await page.$$(sel))[i]
      if (!b) break
      if (await tryClick(b)) stat.buttons++; else stat.skipped++
    }
    await page.waitForTimeout(150)
  }
}

async function tryClick(el) {
  try { await el.click({ timeout: 5000 }); return true } catch { return false }
}

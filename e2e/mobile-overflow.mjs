// 手機寬度（390px）逐頁檢查：頁面不能橫向捲動、內容不能被擠出畫面裁掉，並列出還需要左右滑的區塊
// 前置：npm run build && npm run preview。ONLY=skill 只掃技能頁（skill / scenario / lab / exercise / project / page）
import { chromium } from 'playwright'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const base = process.env.E2E_BASE || 'http://localhost:4173/'
const src = (p) => fileURLToPath(new URL(`../src/${p}`, import.meta.url))
const { ALL_DOMAINS } = await import(src('content/roadmap.js'))
const { STAGES } = await import(src('content/project/stages.js'))
const exIds = (await import(src('content/exercises/index.js').replace(/^/, 'file://')).catch(() => null))?.EXERCISES?.map((e) => e.id) || []
const groups = {
  page: ['#/', '#/roadmap', '#/labs', '#/scenarios', '#/exercises', '#/curriculum', '#/playground', '#/playground?lang=sql', '#/project'],
  skill: ALL_DOMAINS.flatMap((d) => d.skills.map((s) => `#/skill/${s.id}`)),
  scenario: readdirSync(src('content/scenarios')).filter((f) => f.endsWith('.js') && f !== 'index.js').map((f) => `#/scenario/${f.replace('.js', '')}`),
  lab: readdirSync(src('labs')).filter((f) => /Lab\.jsx$/.test(f)).map((f) => `#/lab/${f.replace('.jsx', '')}`),
  project: STAGES.map((s) => `#/project/${s.id}`),
  exercise: exIds.map((id) => `#/exercise/${id}`),
}
const only = process.env.ONLY?.split(',')
const routes = Object.entries(groups).filter(([k]) => !only || only.includes(k)).flatMap(([, v]) => v)

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true })
let bad = 0, scrollers = 0
const queue = [...routes]
async function worker() {
  const page = await ctx.newPage()
  while (queue.length) {
    const r = queue.shift()
    await page.goto(base + r, { waitUntil: 'networkidle' }).catch(() => {})
    await page.waitForTimeout(700)
    const res = await page.evaluate(() => {
      const W = document.documentElement.clientWidth
      const scrollable = (el) => { const s = getComputedStyle(el); return /(auto|scroll)/.test(s.overflowX) }
      const inScroller = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (scrollable(p)) return true; return false }
      const label = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} 「${(el.textContent || '').trim().slice(0, 24)}」`
      const clipped = []; const inner = []
      for (const el of document.querySelectorAll('main *, .page *, #root *')) {
        const b = el.getBoundingClientRect()
        if (b.width === 0 || b.height === 0 || el.closest('.bg-aurora')) continue // 背景光暈本來就超出畫面
        if (b.right > W + 1 && !inScroller(el) && getComputedStyle(el).position !== 'fixed') clipped.push(label(el))
        if (scrollable(el) && el.scrollWidth > el.clientWidth + 2 && !el.closest('.cm-editor')) inner.push(`${label(el)} 多 ${el.scrollWidth - el.clientWidth}px`)
      }
      return { pageOverflow: document.documentElement.scrollWidth - W, clipped: [...new Set(clipped)].slice(0, 3), inner: [...new Set(inner)].slice(0, 3) }
    })
    if (res.pageOverflow > 0 || res.clipped.length) { bad++; console.log(`FAIL ${r}  page+${res.pageOverflow}px  ${res.clipped.join(' | ')}`) }
    if (res.inner.length) { scrollers++; console.log(`SCROLL ${r}  ${res.inner.join(' | ')}`) }
  }
  await page.close()
}
await Promise.all([worker(), worker(), worker(), worker()])
await browser.close()
console.log(`${routes.length} 頁，${bad} 頁溢出或被裁切，${scrollers} 頁有需要左右滑的區塊`)
process.exit(bad ? 1 : 0)

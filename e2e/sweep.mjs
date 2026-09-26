// 全站掃描：每個路由在 亮 / 暗 / 390px 下載入，收集 pageerror、console error/warning、橫向溢出，並截幾張圖到 e2e/shots/
// 前置：npm run build && npm run preview（或設 E2E_BASE 指向 dev server）
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const base = process.env.E2E_BASE || 'http://localhost:4173/'
const labs = ['SqlJoinLab', 'IndexLab', 'DocVsRelLab', 'CacheLab', 'JwtLab', 'OAuthLab', 'AccessControlLab', 'SqlInjectionLab', 'HashingLab', 'HttpLab', 'DockerLab', 'ComposeLab', 'NginxLab', 'PipelineLab', 'BigOLab', 'RateLimitLab', 'AsyncLab', 'RestLab', 'UvLab']
const routes = [
  '#/', '#/roadmap', '#/roadmap?kw=JWT', '#/labs', '#/curriculum', '#/exercises',
  '#/exercise/sql-joins-1', '#/exercise/jwt-1', '#/exercise/http-basics-1',
  '#/playground', '#/playground?lang=sql', '#/playground?lang=js',
  '#/scenarios', '#/scenario/pagination',
  '#/domain/data', '#/domain/auth',
  '#/skill/python-backend', '#/skill/sql-joins', '#/skill/jwt', '#/skill/docker-basics', '#/skill/linux-basics', '#/skill/crypto-toolbox',
  ...labs.map((l) => `#/lab/${l}`),
]
const shotFor = { '#/scenarios': 'scenarios', '#/scenario/pagination': 'scenario-pagination', '#/': 'home', '#/curriculum': 'curriculum', '#/exercises': 'exercises', '#/skill/sql-joins': 'skill-joins', '#/labs': 'labs', '#/lab/JwtLab': 'lab-jwt', '#/playground?lang=sql': 'playground-sql' }
mkdirSync('e2e/shots', { recursive: true })

const browser = await chromium.launch()
const problems = []
for (const [w, theme] of [[1200, 'light'], [1200, 'dark'], [390, 'light']]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: theme })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => problems.push(`[${w}/${theme}] PAGEERROR ${page.url()} ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${w}/${theme}] CONSOLE(${m.type()}) ${page.url()} ${m.text().slice(0, 200)}`) })
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.evaluate((t) => { try { localStorage.setItem('theme', t) } catch {} }, theme)
  for (const r of routes) {
    await page.goto(base + r, { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (over > 2) problems.push(`[${w}/${theme}] OVERFLOW ${r} by ${over}px`)
    if (shotFor[r]) await page.screenshot({ path: `e2e/shots/${shotFor[r]}-${w}-${theme}.png`, fullPage: r !== '#/labs' })
  }
  await ctx.close()
}
await browser.close()
console.log(problems.length ? problems.join('\n') : 'NO PROBLEMS')
console.log('routes checked:', routes.length * 3)
process.exit(problems.length ? 1 : 0)

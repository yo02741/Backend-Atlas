// 全站掃描：每個路由在 亮 / 暗 / 390px 下載入，收集 pageerror、console error/warning、橫向溢出，並截幾張圖到 e2e/shots/
// 前置：npm run build && npm run preview（或設 E2E_BASE 指向 dev server）
import { chromium } from 'playwright'
import { mkdirSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const base = process.env.E2E_BASE || 'http://localhost:4173/'
// 實驗室、情境、領域、實作路線階段直接從內容讀，新增的頁面不會漏掃
const src = (p) => fileURLToPath(new URL(`../src/${p}`, import.meta.url))
const labs = readdirSync(src('labs')).filter((f) => /Lab\.jsx$/.test(f)).map((f) => f.replace('.jsx', ''))
const scenarios = readdirSync(src('content/scenarios')).filter((f) => f.endsWith('.js') && f !== 'index.js').map((f) => f.replace('.js', ''))
const { ALL_DOMAINS } = await import(src('content/roadmap.js'))
const { STAGES } = await import(src('content/project/stages.js'))
const domains = ALL_DOMAINS.filter((d) => d.skills.length).map((d) => d.id)
const routes = [
  '#/', '#/roadmap', '#/roadmap?kw=JWT', '#/labs', '#/curriculum', '#/curriculum?week=21', '#/exercises',
  '#/exercise/sql-joins-1', '#/exercise/jwt-1', '#/exercise/http-basics-1', '#/exercise/gitlab-cicd-1', '#/exercise/project-schema-1',
  '#/playground', '#/playground?lang=sql', '#/playground?lang=js',
  '#/scenarios', ...scenarios.map((id) => `#/scenario/${id}`),
  ...domains.map((id) => `#/domain/${id}`),
  '#/project', ...STAGES.map((s) => `#/project/${s.id}`),
  // 每個領域挑一兩課（深入內容的表格、程式碼區塊最容易在手機上撐破版面）
  '#/skill/python-backend', '#/skill/how-programs-run', '#/skill/sql-joins', '#/skill/transactions', '#/skill/indexes', '#/skill/jwt',
  '#/skill/cors-cookies', '#/skill/docker-basics', '#/skill/linux-basics', '#/skill/cloud-basics', '#/skill/crypto-toolbox',
  '#/skill/git-workflow', '#/skill/system-design', '#/skill/https-certificates', '#/skill/data-governance', '#/skill/k8s-readiness',
  '#/skill/mcp-gateway', '#/skill/key-scope-lifetime', '#/skill/agent-credential-isolation', '#/skill/rag-basics', '#/skill/llm-wiki',
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
    // 頁面與實驗室都是懶載入：等「載入中…」類的佔位訊息消失（頁面 chunk、lab chunk 都到齊）再量
    await page.waitForFunction(() => !document.querySelector('.status-msg'), null, { timeout: 30000 }).catch(() => problems.push(`[${w}/${theme}] STILL-LOADING ${r}`))
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

// Backend Atlas 內容索引：8 個領域、各領域的技能（skill）、學習路線與工作關鍵字對照
import language from './d1-language.js'
import web from './d2-web.js'
import data from './d3-data.js'
import auth from './d4-auth.js'
import security from './d5-security.js'
import deploy from './d6-deploy.js'
import cicd from './d7-cicd.js'
import algo from './d8-algo.js'

export const DOMAINS = [language, web, data, auth, security, deploy, cicd, algo]

export const LEVELS = { 1: '入門', 2: '進階', 3: '深入' }

/* 技術關鍵字（正規化顯示名）→ 對應到技能的 keywords 欄位 */
export const KEYWORDS = [
  'Python', 'uv', 'MongoDB', 'PostgreSQL', 'nginx', 'Docker', 'docker-compose', 'SQL',
  'GitLab CI', 'GitHub Actions', 'Token', 'JWT', 'RBAC', 'ABAC', 'OAuth', 'OWASP',
]

/* 建議學習路線：先「看得見」的、再打地基、最後上線相關。共 12 站，每站 1 週左右。 */
export const PATH = [
  { skill: 'http-basics', note: '看清一個請求從瀏覽器到伺服器的每一步。' },
  { skill: 'rest-design', note: '資源、方法、狀態碼：把 API 寫對。' },
  { skill: 'sql-basics', note: 'SQL 是後端最保值的技能。' },
  { skill: 'sql-joins', note: '用文氏圖與結果表把 JOIN 一次搞懂。' },
  { skill: 'indexes', note: '慢查詢的第一個答案。' },
  { skill: 'transactions', note: '扣庫存、下訂單不能沒有它。' },
  { skill: 'authn-basics', note: 'Token、JWT、OAuth 的地基。' },
  { skill: 'jwt', note: '把 token 拆開，看三段各是什麼。' },
  { skill: 'rbac-abac', note: '誰能做什麼，做成模型。' },
  { skill: 'injection', note: '最老也最常見的漏洞，親手擋一次。' },
  { skill: 'docker-basics', note: '搞懂層，build 就不再慢。' },
  { skill: 'ci-pipeline', note: 'GitHub Actions 與 GitLab CI 對照著學。' },
]

export function allSkills() {
  return DOMAINS.flatMap((d) => d.skills.map((s) => ({ ...s, domain: d })))
}

export function findSkill(id) {
  for (const d of DOMAINS) {
    const s = d.skills.find((x) => x.id === id)
    if (s) return { ...s, domain: d }
  }
  return null
}

export function findDomain(id) {
  return DOMAINS.find((d) => d.id === id) || null
}

/* 依關鍵字找技能（大小寫不敏感） */
export function skillsByKeyword(kw) {
  const k = kw.toLowerCase()
  return allSkills().filter((s) => s.keywords.some((x) => x.toLowerCase() === k))
}

/* 上一課 / 下一課：依領域內順序，跨領域接續 */
export function neighbors(id) {
  const all = allSkills()
  const i = all.findIndex((s) => s.id === id)
  return { prev: i > 0 ? all[i - 1] : null, next: i >= 0 && i < all.length - 1 ? all[i + 1] : null }
}

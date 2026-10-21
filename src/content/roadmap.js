// Backend Atlas 內容索引：各領域、各領域的技能（skill）、學習路線與工作關鍵字對照
// 這裡只有列表與卡片需要的索引欄位（id / title / en / level / summary / example / keywords / lab），
// 技能內文（points / checklist / refs）在 ./body/，由 skillBody.js 於技能頁懶載入。此檔要能被 Node 直接 import（校驗腳本用），不要放 import.meta.glob。
import language from './d1-language.js'
import web from './d2-web.js'
import data from './d3-data.js'
import auth from './d4-auth.js'
import security from './d5-security.js'
import deploy from './d6-deploy.js'
import cicd from './d7-cicd.js'
import algo from './d8-algo.js'
import devops from './d9-devops.js'
import ai from './d10-ai.js'
import knowledge from './d11-knowledge.js'

// ALL_DOMAINS 含還沒有任何技能的領域（撰寫中）；站上只列出已有技能的領域
export const ALL_DOMAINS = [language, web, data, auth, security, deploy, cicd, algo, devops, ai, knowledge]
export const DOMAINS = ALL_DOMAINS.filter((d) => d.skills.length > 0)

export const LEVELS = { 1: '入門', 2: '進階', 3: '深入' }

/* 技術關鍵字（正規化顯示名）→ 對應到技能的 keywords 欄位 */
export const KEYWORDS = [
  'Python', 'uv', 'MongoDB', 'PostgreSQL', 'nginx', 'Docker', 'docker-compose', 'SQL',
  'GitLab CI', 'GitHub Actions', 'Token', 'JWT', 'RBAC', 'ABAC', 'OAuth', 'OWASP',
]

/* 建議學習路線（label 是地圖上的短站名）：先「看得見」的、再打地基、上線相關，最後是基礎建設、Agent 安全與知識系統。每站 1 週左右。 */
export const PATH = [
  { skill: 'http-basics', label: 'HTTP 請求的一生', note: '看清一個請求從瀏覽器到伺服器的每一步。' },
  { skill: 'rest-design', label: 'REST API 設計', note: '資源、方法、狀態碼：把 API 寫對。' },
  { skill: 'sql-basics', label: 'SQL 基礎', note: 'SQL 是後端最保值的技能。' },
  { skill: 'sql-joins', label: 'JOIN 七兄弟', note: '用文氏圖與結果表把 JOIN 一次搞懂。' },
  { skill: 'indexes', label: '索引與查詢計畫', note: '慢查詢的第一個答案。' },
  { skill: 'transactions', label: '交易與隔離等級', note: '扣庫存、下訂單不能沒有它。' },
  { skill: 'authn-basics', label: 'Session vs Token', note: 'Token、JWT、OAuth 的地基。' },
  { skill: 'jwt', label: 'JWT 解剖', note: '把 token 拆開，看三段各是什麼。' },
  { skill: 'rbac-abac', label: 'RBAC 與 ABAC', note: '誰能做什麼，做成模型。' },
  { skill: 'injection', label: 'SQL 注入', note: '最老也最常見的漏洞，親手擋一次。' },
  { skill: 'docker-basics', label: 'Docker 的層', note: '搞懂層，build 就不再慢。' },
  { skill: 'ci-pipeline', label: 'CI 管線', note: 'GitHub Actions 與 GitLab CI 對照著學。' },
  { skill: 'network-troubleshooting', label: '網路通不通', note: '連不上時，從 DNS 一層一層往下查。' },
  { skill: 'https-certificates', label: 'HTTPS 憑證', note: '憑證鏈、要買哪種、怎麼續約不過期。' },
  { skill: 'k8s-readiness', label: '導入 K8s 之前', note: '導入 Kubernetes 之前要先備齊的東西。' },
  { skill: 'oauth-device-pkce', label: 'Device Code 與 PKCE', note: 'CLI 與 agent 沒有瀏覽器時怎麼授權。' },
  { skill: 'tool-poisoning', label: 'Tool Poisoning', note: '工具描述也是攻擊面：模型讀到的比畫面上多。' },
  { skill: 'rag-basics', label: 'RAG 與它的限制', note: 'RAG 怎麼運作，限制在哪裡。' },
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

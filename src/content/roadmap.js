// 內容索引：各領域、各領域的技能（skill）、每條路線的學習路線與關鍵字
// 這裡只有列表與卡片需要的索引欄位（id / title / en / level / summary / example / keywords / lab），
// 技能內文（points / checklist / refs / map）在 ./body/，由 skillBody.js 於技能頁懶載入。此檔要能被 Node 直接 import（校驗腳本用），不要放 import.meta.glob。
// 每個領域的 track 決定它屬於哪條路線（tracks.js）；no 全站唯一、決定檔名 d<no>-<id>.js，畫面上的編號是路線內的順序（displayNo）。
import { TRACKS } from './tracks.js'
import browser from './d21-browser.js'
import layout from './d22-layout.js'
import jsTs from './d23-js-ts.js'
import vue from './d24-vue.js'
import ui from './d25-ui.js'
import api from './d26-api.js'
import feAi from './d29-fe-ai.js'
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

// ALL_DOMAINS 含還沒有任何技能的領域（撰寫中）；站上只列出已有技能的領域。順序就是路線內的顯示順序。
export const ALL_DOMAINS = [
  browser, layout, jsTs, vue, ui, api, feAi,
  language, web, data, auth, security, deploy, cicd, algo, devops,
  ai, knowledge,
]
export const DOMAINS = ALL_DOMAINS.filter((d) => d.skills.length > 0)

export const LEVELS = { 1: '入門', 2: '進階', 3: '深入' }

/* 技術關鍵字（正規化顯示名）→ 對應到技能的 keywords 欄位；每條路線一組 */
export const KEYWORDS = {
  frontend: [],
  backend: [
    'Python', 'uv', 'MongoDB', 'PostgreSQL', 'nginx', 'Docker', 'docker-compose', 'SQL',
    'GitLab CI', 'GitHub Actions', 'Token', 'JWT', 'RBAC', 'ABAC', 'OAuth', 'OWASP',
  ],
  ai: ['LLM', 'Agent', 'MCP', 'RAG', 'OAuth', 'Token', 'OWASP', 'Python'],
}

/* 建議學習路線：每條路線一組。label 是地圖上的短站名（8 字以內），note 只用在 README 的路線表。 */
export const PATHS = {
  frontend: [],
  backend: [
    { skill: 'http-basics', label: 'HTTP 請求的一生', note: '看清一個請求從瀏覽器到伺服器的每一步。' },
    { skill: 'rest-design', label: 'REST API 設計', note: '資源、方法、狀態碼的設計。' },
    { skill: 'sql-basics', label: 'SQL 基礎', note: 'SELECT、WHERE、GROUP BY 與聚合函式。' },
    { skill: 'sql-joins', label: 'JOIN 七兄弟', note: '各種 JOIN 用文氏圖與結果表對照。' },
    { skill: 'indexes', label: '索引與查詢計畫', note: '用 B-tree 索引與 EXPLAIN 找出慢查詢的原因。' },
    { skill: 'transactions', label: '交易與隔離等級', note: 'ACID、隔離等級，以及兩個交易交錯時各讀到什麼。' },
    { skill: 'authn-basics', label: 'Session vs Token', note: 'Session 與 Token 兩種帶身分的方式。' },
    { skill: 'jwt', label: 'JWT 解剖', note: '把 token 拆成三段，看簽章怎麼算。' },
    { skill: 'rbac-abac', label: 'RBAC 與 ABAC', note: '用角色與屬性決定誰能做什麼。' },
    { skill: 'injection', label: 'SQL 注入', note: 'SQL 注入的原理與參數化查詢。' },
    { skill: 'docker-basics', label: 'Docker 的層', note: 'image、container、layer 與 build 快取。' },
    { skill: 'container-operations', label: '容器的日常維運', note: '日誌輪替、記憶體上限、SIGTERM 與執行環境。' },
    { skill: 'ci-pipeline', label: 'CI 管線', note: 'lint、test、build 三段，GitHub Actions 與 GitLab CI 對照。' },
    { skill: 'load-testing', label: '量測與壓測', note: '量 p95、找飽和點、定位瓶頸。' },
    { skill: 'network-troubleshooting', label: '網路通不通', note: '連不上時，從 DNS 一層一層往下查。' },
    { skill: 'https-certificates', label: 'HTTPS 憑證', note: '憑證鏈、憑證種類與自動續約。' },
    { skill: 'k8s-readiness', label: '導入 K8s 之前', note: '導入 Kubernetes 之前要先備齊的東西。' },
    { skill: 'k8s-manifests', label: 'K8s 部署實作', note: '把服務寫成 manifest：Deployment、Service、Ingress。' },
    { skill: 'k8s-networking', label: 'K8s 網路', note: 'Service、NetworkPolicy 與連到叢集外的舊系統。' },
    { skill: 'finops', label: 'FinOps 計費結構', note: '雲端與 AI 工具的計費結構。' },
    { skill: 'legacy-migration', label: '舊系統逐步替換', note: '逐步替換舊系統，每一步都能回退。' },
    { skill: 'data-pipelines', label: '可重跑的資料管線', note: '增量、冪等、回補：重跑不會重複寫入。' },
    { skill: 'test-quality', label: '測試品質', note: '用突變測試檢查測試有沒有驗到東西。' },
  ],
  ai: [
    { skill: 'context-engineering', label: '模型看得到什麼', note: '專案規範檔與 context：模型每一輪實際看到的內容。' },
    { skill: 'ai-skills-mcp', label: 'Skill 與 MCP', note: '把做法寫成 Skill、把工具接成 MCP server。' },
    { skill: 'ai-spec-to-tests', label: '規範變成測試', note: '把規範寫成測試，AI 改程式時由測試把關。' },
    { skill: 'harness-engineering', label: 'Harness Engineering', note: '同一個 prompt 跑 N 次：評測集、重試與檢查器。' },
    { skill: 'llm-api-integration', label: '後端呼叫模型', note: '逾時、重試、串流與結構化輸出的驗證。' },
    { skill: 'agent-loop', label: 'Agent 的執行迴圈', note: '工具呼叫、狀態機、步數與 token 預算。' },
    { skill: 'oauth-device-pkce', label: 'Device Code 與 PKCE', note: 'CLI 與 agent 沒有瀏覽器時怎麼授權。' },
    { skill: 'ai-gateway', label: 'AI Gateway', note: '模型路由、金鑰集中、配額與用量。' },
    { skill: 'self-hosted-models', label: '地端模型', note: '資料不能送出去時，自架模型要自己負責的事。' },
    { skill: 'tool-poisoning', label: 'Tool Poisoning', note: '工具描述被下毒與 rug pull 的防法。' },
    { skill: 'rag-basics', label: 'RAG 與它的限制', note: 'RAG 怎麼運作，限制在哪裡。' },
    { skill: 'semantic-layer', label: 'Semantic Layer', note: 'agent 用定義好的指標查資料，不猜欄位。' },
  ],
}

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

/* 路線：領域與技能依路線篩選；track 不給或給 'all' 就是全部 */
export const domainsOf = (track) => (!track || track === 'all' ? DOMAINS : DOMAINS.filter((d) => d.track === track))
export const plannedDomainsOf = (track) => ALL_DOMAINS.filter((d) => d.track === track)
export const skillsOf = (track) => allSkills().filter((s) => !track || track === 'all' || s.domain.track === track)
export const trackOfSkill = (id) => findSkill(id)?.domain.track || null
export const keywordsOf = (track) => (!track || track === 'all' ? [...new Set(TRACKS.flatMap((t) => KEYWORDS[t.id] || []))] : KEYWORDS[track] || [])

/* 學習路線的站：{ ...技能, label }；技能不存在的站略過（validate 會擋） */
export function stationsOf(track) {
  return (PATHS[track] || []).map((p) => { const s = findSkill(p.skill); return s && { ...s, label: p.label || s.title } }).filter(Boolean)
}

/* 畫面上的領域編號：路線內的順序（01 起），不是檔名用的 no */
export function displayNo(d) {
  const list = ALL_DOMAINS.filter((x) => x.track === d.track)
  return String(list.findIndex((x) => x.id === d.id) + 1).padStart(2, '0')
}

/* 依關鍵字找技能（大小寫不敏感），可限定路線 */
export function skillsByKeyword(kw, track) {
  const k = kw.toLowerCase()
  return skillsOf(track).filter((s) => s.keywords.some((x) => x.toLowerCase() === k))
}

/* 其他路線的相關課：這一課的 related，加上其他路線裡把這一課列進 related 的課（反向連結由這裡算，被連的課不用改） */
export function relatedOf(id) {
  const me = findSkill(id)
  if (!me) return []
  const out = new Map()
  for (const r of me.related || []) { const s = findSkill(r); if (s) out.set(s.id, s) }
  for (const s of allSkills()) if (s.domain.track !== me.domain.track && (s.related || []).includes(id)) out.set(s.id, s)
  return [...out.values()]
}

/* 上一課 / 下一課：依領域內順序，同一條路線內跨領域接續 */
export function neighbors(id) {
  const me = findSkill(id)
  const all = me ? skillsOf(me.domain.track) : []
  const i = all.findIndex((s) => s.id === id)
  return { prev: i > 0 ? all[i - 1] : null, next: i >= 0 && i < all.length - 1 ? all[i + 1] : null }
}

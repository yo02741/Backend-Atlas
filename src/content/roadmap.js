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
import build from './d27-build.js'
import quality from './d28-quality.js'
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
  browser, layout, jsTs, vue, ui, api, build, quality, feAi,
  language, web, data, auth, security, deploy, cicd, algo, devops,
  ai, knowledge,
]
export const DOMAINS = ALL_DOMAINS.filter((d) => d.skills.length > 0)

export const LEVELS = { 1: '入門', 2: '進階', 3: '深入' }

/* 技術關鍵字（正規化顯示名）→ 對應到技能的 keywords 欄位；每條路線一組 */
export const KEYWORDS = {
  frontend: ['HTML', 'CSS', 'JavaScript', 'TypeScript', 'Vue', 'Pinia', 'Vue Router', 'React', 'Vite', 'RWD', 'Chrome DevTools', '無障礙'],
  backend: [
    'Python', 'uv', 'MongoDB', 'PostgreSQL', 'nginx', 'Docker', 'docker-compose', 'SQL',
    'GitLab CI', 'GitHub Actions', 'Token', 'JWT', 'RBAC', 'ABAC', 'OAuth', 'OWASP',
  ],
  ai: ['LLM', 'Agent', 'MCP', 'RAG', 'OAuth', 'Token', 'OWASP', 'Python'],
}

/* 建議學習路線：每條路線一組。label 是地圖上的短站名（8 字以內），note 只用在 README 的路線表。 */
export const PATHS = {
  frontend: [
    { skill: 'how-browsers-render', label: '網頁怎麼畫出來', note: 'DOM、CSSOM、render tree 到 layout、paint、composite，改哪個屬性重跑哪一段。' },
    { skill: 'devtools', label: '開發者工具', note: 'Console、Network、Elements、Application、Lighthouse 的固定驗收順序。' },
    { skill: 'page-loading', label: '頁面載入順序', note: 'CSS 擋畫面、script 擋解析，defer、async、module 與 preload。' },
    { skill: 'semantic-html', label: '語意化 HTML', note: '地標元素、button 與 label、input 的 type 與 inputmode。' },
    { skill: 'css-cascade', label: 'CSS 層疊與權重', note: '誰勝出：!important、@layer、選擇器權重、出現順序，以及 Vue scoped CSS。' },
    { skill: 'box-model', label: '盒模型', note: 'border-box、margin 合併、overflow 與 outline。' },
    { skill: 'flexbox', label: 'Flexbox', note: '主軸與交叉軸、剩餘空間怎麼分，以及 min-width 造成的溢出。' },
    { skill: 'grid', label: 'Grid', note: 'fr、minmax、auto-fill 與 auto-fit、命名區域。' },
    { skill: 'rwd', label: 'RWD 與斷點', note: 'viewport meta、mobile-first 的 media query 與 container query。' },
    { skill: 'units-typography', label: '單位與文字', note: 'rem、em、dvh、不帶單位的行高與 clamp()，網頁字型怎麼載入。' },
    { skill: 'layout-patterns', label: '版面與斷點表', note: 'app shell、側欄收合、卡片網格、清單與詳細，寫成 390／768／1024／1280 的斷點表。' },
    { skill: 'design-to-code', label: '從設計稿切版', note: 'Auto layout 對 flex、hug 與 fill、抽 token、沒畫的狀態要問，390／1280 量值驗收。' },
    { skill: 'js-essentials', label: 'JS 必要語法', note: 'const、箭頭函式、解構、展開、?. 與 ??，陣列方法會不會改原陣列。' },
    { skill: 'async-js', label: '非同步 JS', note: '依序與平行、Promise.all 與 allSettled、finally 關掉 loading。' },
    { skill: 'event-loop', label: '事件迴圈', note: 'task、microtask 與渲染時機，長迴圈為什麼讓畫面凍結。' },
    { skill: 'dom-events', label: 'DOM 與事件', note: '捕獲與冒泡、事件委派，stopPropagation 與 preventDefault 各管什麼。' },
    { skill: 'components-sfc', label: '元件化', note: '把畫面拆成元件樹，SFC 的 template、<script setup>、<style scoped>。' },
    { skill: 'reactivity', label: '響應式', note: 'ref、reactive、computed，以及解構之後失去響應式。' },
    { skill: 'template-syntax', label: '模板語法', note: 'v-bind、v-on、v-if 與 v-show、v-for 的 key。' },
    { skill: 'props-emits-model', label: 'props 與事件', note: '單向資料流、defineEmits、defineModel，子元件不改 props。' },
    { skill: 'lifecycle', label: '生命週期', note: 'onMounted 拿 DOM、onUnmounted 清掉計時器、監聽與請求。' },
    { skill: 'ui-states', label: '互動狀態', note: 'hover、focus-visible、disabled、loading 的狀態表與驗收。' },
    { skill: 'feedback', label: '回饋與空狀態', note: 'Toast、Alert、Skeleton、Empty state 各用在哪裡。' },
    { skill: 'overlays', label: '浮層與焦點', note: 'Dialog、Drawer、Popover、Tooltip：擋不擋操作、焦點進出、Esc 關閉。' },
    { skill: 'a11y-basics', label: '無障礙基礎', note: '鍵盤走得完、控制項有名稱、對比 4.5:1、狀態念得出來。' },
    { skill: 'a11y-components', label: '元件鍵盤與ARIA', note: 'APG 的鍵盤表就是驗收清單：焦點去哪、aria-expanded 怎麼變，axe 抓不到的寫成測試。' },
    { skill: 'forms', label: '表單與驗證', note: 'v-model 綁出的型別、離開欄位才顯示錯誤、aria-describedby。' },
    { skill: 'fetch-basics', label: 'fetch 與 HTTP', note: 'res.ok、JSON body、Problem Details 與逾時。' },
    { skill: 'api-states', label: 'API 四種狀態', note: 'loading、success、empty、error，哪些錯誤給重試。' },
    { skill: 'cancel-race', label: '取消與競態', note: 'AbortController 取消舊請求、debounce，畫面只反映最後的條件。' },
    { skill: 'data-caching', label: '資料快取', note: '查詢 key、stale-while-revalidate、同 key 合併請求，改了就讓 key 失效。' },
    { skill: 'form-submit', label: '表單送出', note: '422 對回欄位、409 放表單上方、停用按鈕加冪等鍵防止重複送出。' },
    { skill: 'element-plus', label: '使用元件庫', note: '按需引入、zh-tw 語系、--el-* 主題變數，後端 422 放進 el-form-item 的 error。' },
    { skill: 'frontend-security', label: '前端的資安', note: 'v-html 與 javascript: 網址、token 放哪裡、CSP 擋了哪些寫法、第三方 script。' },
    { skill: 'vue-router', label: 'Vue Router', note: '動態參數、守衛用回傳值、懶載入，history 模式的伺服器 fallback。' },
    { skill: 'pinia', label: 'Pinia', note: 'setup store、storeToRefs，狀態放元件、網址還是 store。' },
    { skill: 'vite-basics', label: 'Vite 與建置', note: 'dev server、HMR、vite build 的產物，以及 Vite 6 與 8 的差別。' },
    { skill: 'bundles-chunks', label: 'chunk 與 hash', note: '懶載入、vendor 只切框架、內容 hash 與長效快取。' },
    { skill: 'test-layers', label: '測試分層', note: '單元、元件、E2E 各抓什麼錯；jsdom 沒有版面與 showModal，那些到真瀏覽器測。' },
    { skill: 'unit-tests', label: '單元測試', note: 'toBe 與 toEqual、test.each 邊界表、fake timers 測 debounce，改壞程式要有測試變紅。' },
    { skill: 'e2e-playwright', label: 'Playwright E2E', note: 'locator 與自動等待、web-first assertion、page.route 固定回應、trace 回放。' },
    { skill: 'web-vitals', label: 'Core Web Vitals', note: 'LCP、INP、CLS 的門檻與 p75，主圖、預留空間與拆長任務。' },
    { skill: 'describe-ui', label: '把畫面寫成文字', note: '版面、元件、狀態、資料、互動五段，加上斷點與文案。' },
    { skill: 'screen-spec', label: '畫面規格', note: '元件、狀態表、文案表、斷點、資料來源與驗收條件寫成一頁。' },
    { skill: 'ai-project-rules', label: '給 AI 的規範', note: 'AGENTS.md 寫技術與版本、瀏覽器目標、token 與禁止事項，每條都能檢查。' },
    { skill: 'ai-common-mistakes', label: 'AI 常見的錯', note: 'Vue 2 寫法、混用 API、多餘的 watch、錯的 key，用工具抓。' },
    { skill: 'outdated-patterns', label: 'AI 的過時寫法', note: '自己寫的 focus trap、JSON 深拷貝、scroll 監聽；寫明 Baseline 目標，先查 Modern Web Guidance 再寫。' },
    { skill: 'ai-acceptance', label: '驗收 AI 產出', note: '指令、每個狀態、三個寬度、只用鍵盤、Console 與 Network，最後寫成測試。' },
    { skill: 'ai-review-diff', label: '審 AI 改動', note: '先看 --stat 與測試的 diff，再讀邏輯；大元件先補特徵測試再拆。' },
  ],
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

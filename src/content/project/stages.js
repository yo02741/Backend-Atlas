// 實作路線：從零做完一個門診掛號後端。每一階段一份說明（./<id>.md，頁面懶載入）與幾道驗收題（exercises/project.js，題目帶 project: '<id>'）。
// 此檔要能被 Node 直接 import（校驗腳本用）。
// 每條路線一條實作路線（有階段的路線才出現）；PROJECT 是後端那條（舊名，保留給既有程式）
export const PROJECTS = {
  backend: {
  title: '從零做完一個門診掛號後端',
  summary: '一個階段接一個階段，把前面學過的課組成一個完整的系統：資料表、領域邏輯、API、權限、並行搶號、快取與限流、容器與 CI、可觀測性、給 agent 的唯讀查詢介面、部署到 Kubernetes。每階段都有在瀏覽器裡跑的驗收測試。',
  // 參考實作：同一個題目做成可以在本機跑起來的專案（repo 的 companion/clinic-api/）
  companion: {
    url: 'https://github.com/yo02741/Backend-Atlas/tree/main/companion/clinic-api',
    note: '階段 1–8 與第 10 階段做成一個可以 clone 下來跑的專案：FastAPI、PostgreSQL、Redis，附測試、Dockerfile、compose 與 Kubernetes manifest。',
  },
  },
  frontend: {
    title: '從零做完一個門診掛號前端',
    summary: '登入、診次清單、掛號表單、我的掛號、報到看板，接上假的門診 API，最後補上無障礙、RWD 與部署。',
  },
}
export const PROJECT = PROJECTS.backend

// { id, track, no, title, summary, lessons: [技能 id], exercises: [程式題 id] }；id 全站唯一，no 是路線內的順序
export const STAGES = [
  { id: 'schema', track: 'backend', no: 1, title: '資料表與約束', summary: '病患、醫師、診次、掛號四張表，把「號碼不重複、同一診次不能掛兩次、名額大於 0」交給資料庫的約束來守。', lessons: ['data-modeling', 'sql-basics', 'transactions'], exercises: ['project-schema-1'] },
  { id: 'domain', track: 'backend', no: 2, title: '掛號規則寫成程式與測試', summary: '取消期限、名額、重複掛號、每日上限寫成不碰資料庫的純函式與自訂例外，邊界條件用測試釘住。', lessons: ['python-backend', 'testing'], exercises: ['project-domain-1', 'project-domain-2'] },
  { id: 'api', track: 'backend', no: 3, title: 'REST 介面與狀態碼', summary: '資源與路徑怎麼切、每種失敗回哪個狀態碼、錯誤 body 用 Problem Details 統一格式。', lessons: ['rest-design', 'api-patterns', 'openapi'], exercises: ['project-api-1'] },
  { id: 'auth', track: 'backend', no: 4, title: '登入與角色權限', summary: '病患、櫃台、醫師三種角色：誰能讀、取消、報到哪些掛號，以及把權限條件推進查詢。', lessons: ['authn-basics', 'rbac-abac', 'auth-in-practice'], exercises: ['project-auth-1', 'project-auth-2'] },
  { id: 'concurrency', track: 'backend', no: 5, title: '同時搶最後一個號', summary: '名額檢查與取號合成一句原子的 UPDATE，取消後能重掛則交給部分唯一索引。', lessons: ['transactions', 'indexes'], exercises: ['project-concurrency-1', 'project-concurrency-2'] },
  { id: 'cache-ratelimit', track: 'backend', no: 6, title: '快取與限流', summary: '診次清單用 cache-aside 加 TTL、掛號後失效；每位使用者一個 token bucket，超量回 429。', lessons: ['redis-cache', 'rate-limiting'], exercises: ['project-cache-1', 'project-cache-2'] },
  { id: 'ship', track: 'backend', no: 7, title: '打包與持續整合', summary: '多階段、非 root、不含祕密的 Dockerfile，加上 lint → test（帶 PostgreSQL）→ build → 只在 main 部署的 GitLab CI。', lessons: ['dockerfile-python', 'ci-pipeline'], exercises: ['project-ship-1', 'project-ship-2'] },
  { id: 'observe', track: 'backend', no: 8, title: '日誌、指標與追蹤', summary: '一行一筆的 JSON 日誌帶 request_id 並遮罩身分證字號，掛號結果做成 Prometheus 計數器，跨服務用 traceparent 串起來。', lessons: ['logging-config', 'observability'], exercises: ['project-observe-1', 'project-observe-2'] },
  { id: 'mcp', track: 'backend', no: 9, title: '給 agent 一個唯讀查詢的 MCP server', summary: '401 帶路標讓 client 找到 GitLab 登入，server 驗 aud、exp、scope，依使用者限定可查的表、用唯讀帳號查，輸出前遮罩身分證字號、電話、姓名，每次查詢寫一筆不含內容的稽核。', lessons: ['mcp-authorization', 'key-scope-lifetime', 'logs-pii', 'identity-gateway'], exercises: ['project-mcp-1', 'project-mcp-2', 'project-mcp-3'] },
  { id: 'k8s', track: 'backend', no: 10, title: '部署到 Kubernetes', summary: '兩個以上的副本、設定與密碼不進映像：Deployment 接上 readiness 與 liveness 探針、requests 與 limits、非 root，Service 與 Ingress 把 clinic.example 導進來；migration 用 Job 先跑，再以 maxUnavailable 0 滾動更新，GitLab CI 手動核准後部署。', lessons: ['k8s-manifests', 'k8s-config-probes', 'k8s-troubleshooting', 'cd-strategies'], exercises: ['project-k8s-1', 'project-k8s-2', 'project-k8s-3'] },
]

export function findStage(id) { return STAGES.find((s) => s.id === id) || null }
export const stagesOf = (track) => STAGES.filter((s) => s.track === track)

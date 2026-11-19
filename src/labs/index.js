import { lazy } from 'react'

/* 實驗室登錄表：lab 元件用 import.meta.glob 懶載入（每個 lab 各自一個 chunk）。
   META 提供總覽頁與卡片用的標題/敘述；技能頁透過 skill.lab 對應到這裡的 key。 */
const modules = import.meta.glob('./*Lab.jsx')

export const LAB_META = {
  SqlJoinLab:        { title: 'JOIN 七兄弟', blurb: '七種 JOIN 的文氏圖與結果表，以及少了一列時配對怎麼改變。', skill: 'sql-joins' },
  IndexLab:          { title: '索引為什麼快', blurb: '循序掃描與 B-tree 走訪並排，比較各要比對幾次。', skill: 'indexes' },
  DocVsRelLab:       { title: '表格 vs 文件', blurb: '同一份資料在正規化表格、嵌入文件、參照文件三種長相。', skill: 'mongodb' },
  CacheLab:          { title: 'Cache-aside', blurb: 'Redis 擋在資料庫前：hit、miss、TTL 倒數與失效。', skill: 'redis-cache' },
  JwtLab:            { title: 'JWT 解剖', blurb: '在瀏覽器裡計算 HMAC 簽章；改了 payload 不重簽，簽章就失效。', skill: 'jwt' },
  OAuthLab:          { title: 'OAuth 授權碼流程', blurb: '四個角色、八個步驟的時序圖，每步的請求內容都看得到。', skill: 'oauth-oidc' },
  AccessControlLab:  { title: 'RBAC vs ABAC', blurb: '角色矩陣與屬性政策兩種授權模型，以及每條規則的判定過程。', skill: 'rbac-abac' },
  SqlInjectionLab:   { title: 'SQL Injection', blurb: '字串拼接 vs 參數化：同一個 payload，兩種結果。', skill: 'injection' },
  HashingLab:        { title: '編碼、雜湊、加密', blurb: 'Base64、SHA-256、PBKDF2 同時計算，iterations 越高算得越慢。', skill: 'password-storage' },
  HttpLab:           { title: 'HTTP 請求的一生', blurb: 'DNS 到回應的七個步驟，各狀態碼的原始請求與回應。', skill: 'http-basics' },
  DockerLab:         { title: 'Dockerfile 每行一層', blurb: '改了哪些檔案、哪些層 cache hit、哪些重建，以及指令順序的影響。', skill: 'docker-basics' },
  ComposeLab:        { title: 'docker-compose 拓樸', blurb: 'YAML 對應網路拓樸，服務名就是 DNS 名稱；depends_on 不等於就緒。', skill: 'compose' },
  NginxLab:          { title: 'nginx 反向代理', blurb: '請求路徑對應 location、round-robin 到 upstream、TLS 終結在哪。', skill: 'nginx' },
  PipelineLab:       { title: 'CI/CD 管線對照', blurb: 'GitHub Actions 與 GitLab CI 寫的同一條管線並排，逐階段執行。', skill: 'ci-pipeline' },
  BigOLab:           { title: 'Big-O 成長曲線', blurb: '五條成長曲線誰先撐不住，對應到索引、掃描、N+1。', skill: 'big-o' },
  RateLimitLab:      { title: 'Token bucket 限流', blurb: '桶子、token、暴衝與 429，以及固定視窗的邊界問題。', skill: 'rate-limiting' },
  AsyncLab:          { title: '同步 vs 執行緒 vs async', blurb: '六個請求的甘特圖：I/O 等待時 CPU 在做什麼。', skill: 'python-async' },
  RestLab:           { title: 'REST 資源設計', blurb: '每個意圖對應的方法、路徑、狀態碼與冪等性。', skill: 'rest-design' },
  UvLab:             { title: 'uv 從零到能跑', blurb: '七個指令，檔案樹與 pyproject 跟著長出來。', skill: 'uv-packaging' },
  TxnLab:            { title: '兩個交易搶最後一件', blurb: '各隔離等級與扣庫存做法下，兩個交易看到什麼、誰在等鎖、最後成立幾張訂單。', skill: 'transactions' },
  NetPathLab:        { title: '網路壞在哪一層', blurb: 'DNS、防火牆、TLS、負載平衡任一層故障時，dig、nc、curl 各自印出什麼。', skill: 'network-troubleshooting' },
  CertChainLab:      { title: '憑證鏈驗證', blurb: '缺中繼、網域不符、過期、自簽、院內 CA：逐關檢查，以及瀏覽器與 curl 的錯誤訊息。', skill: 'https-certificates' },
  CapacityLab:       { title: '容量估算', blurb: '從尖峰人數推到 RPS、核心數、記憶體與磁碟，以及 Kubernetes 的 requests 換算成幾個 Pod。', skill: 'capacity-planning' },
  K8sLab:            { title: 'Deployment 與滾動更新', blurb: '部署新版、readiness 失敗、節點關機時，Pod 與流量怎麼移動。', skill: 'k8s-readiness' },
  SloLab:            { title: 'SLO 與錯誤預算', blurb: '各可用性目標與事故下，錯誤預算怎麼燒、燃燒率多少、哪一天燒完。', skill: 'slo-error-budget' },
  DeviceCodeLab:     { title: '三種授權流程', blurb: 'Device Code、授權碼 + PKCE、Client Credentials 的時序圖與 HTTP 原文，PKCE 的 SHA-256 在瀏覽器裡計算。', skill: 'oauth-device-pkce' },
  ToolPoisoningLab:  { title: 'Tool Poisoning', blurb: '使用者看到的工具摘要與模型讀到的完整描述，以及每道防禦在哪一層擋下。', skill: 'tool-poisoning' },
  ChunkingLab:       { title: 'RAG 的切段與檢索', blurb: '段落大小與重疊如何把一條跨兩句的答案切開，以及檢索取回了什麼。', skill: 'rag-basics' },
  HarnessLab:        { title: '同一個 Prompt 跑 N 次', blurb: '溫度、取樣次數與 harness 策略（多數決、重試、檢查器）對通過率、不穩定題目與呼叫成本的影響。', skill: 'harness-engineering' },
  TokenCostLab:      { title: 'Agent 工作流一個月花多少', blurb: '單價自己填；全部重送、prompt 快取、限制長度三種做法的月成本比較。', skill: 'finops' },
  AgentLoopLab:      { title: 'Agent 的執行迴圈', blurb: '狀態機怎麼走、context 怎麼累積；工具逾時與格式錯誤時，步數與 token 預算在哪裡攔下。', skill: 'agent-loop' },
  SemanticLayerLab:  { title: '猜欄位 vs 用定義好的指標', blurb: '同一個問題，憑欄位名猜出三種 SQL、三個數字；用 Semantic Layer 只對到一個定義、一個答案。', skill: 'semantic-layer' },
  TestQualityLab:    { title: '覆蓋率 100% 的測試抓不抓得到錯', blurb: '兩組測試的突變測試結果：哪些假綠燈讓突變體存活，補強後殺死率怎麼變。', skill: 'test-quality' },
  LoadTestLab:       { title: '逐步加壓，找飽和點', blurb: '逐級加併發：吞吐在哪裡變平、p95 在哪裡先超標、瓶頸是 CPU 還是連線池。', skill: 'load-testing' },
  K8sDebugLab:       { title: 'Kubernetes 排錯', blurb: '六種故障情境：用 kubectl 指令收集線索、判斷原因，找出要改 manifest 的哪一行。', skill: 'k8s-troubleshooting' },
  XssCsrfLab:        { title: 'XSS 與 CSRF 各擋在哪一層', blurb: '輸出跳脫、CSP、HttpOnly、SameSite、CSRF token：每種攻擊在哪裡被擋下，哪些防線對它沒有作用。', skill: 'xss-csrf' },
  CryptoLab:         { title: '雜湊、HMAC、加密、簽章', blurb: '在瀏覽器裡計算；竄改訊息、換金鑰、重複使用 nonce 時驗證結果怎麼變。', skill: 'crypto-toolbox' },
  SupplyChainLab:    { title: '一個相依套件出問題時', blurb: '漏洞、套件被接管、名稱相近的假套件，分別被 lockfile、掃描、延遲更新等哪道防線攔下。', skill: 'supply-chain' },
  DeployStrategyLab: { title: '三種部署策略與 migration', blurb: 'rolling、blue-green、canary 逐步換版；新版有 bug 或含 schema 變更時，各自影響多少請求、回滾多快。', skill: 'cd-strategies' },
  TraceLab:          { title: '用 trace id 串起 log、metrics、trace', blurb: '從指標的尖峰找到慢的 trace 與慢的 span，再用 trace id 找到那一段的日誌。', skill: 'observability' },
  WikiGraphLab:      { title: 'wikilink 長成知識圖譜', blurb: '幾頁 markdown 即時畫成連結圖，列出反向連結、孤兒頁、斷鏈與兩頁之間的路徑。', skill: 'knowledge-graph' },
  NetworkPolicyLab:  { title: 'NetworkPolicy 放行或擋下', blurb: 'clinic 的 web、api、db 加上 DNS、可疑 Pod 與叢集外的 Informix：開關 default deny 與放行規則，看一條連線在哪一端被放行或擋下、由哪一條規則決定。', skill: 'k8s-networking' },
}

export const LAB_NAMES = Object.keys(LAB_META)

const cache = {}
export function loadLab(name) {
  if (!modules[`./${name}.jsx`]) return null
  if (!cache[name]) cache[name] = lazy(modules[`./${name}.jsx`])
  return cache[name]
}

export function hasLab(name) {
  return Boolean(modules[`./${name}.jsx`])
}

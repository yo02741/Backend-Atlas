// 設計情境：限流放哪一層、用什麼當 key
export default {
  id: 'ratelimit-strategy',
  order: 4,
  group: 'api',
  title: '限流放哪、用什麼當 key',
  en: 'Rate-limit placement & keys',
  level: 2,
  skills: ['rate-limiting', 'nginx', 'authn-basics'],
  week: 9,
  lab: 'RatelimitStrategyScenarioLab',
  summary: '登入、公開搜尋、付費 API 三種端點；200 人共用一個 NAT IP，攻擊者換 IP 撞同一個帳號。限流放 nginx 還是應用層、用 IP 還是帳號當 key？',
  situation: '同一個服務有三種端點：`POST /login`、公開的 `GET /search`（不用登入）、付費方案的 `GET /api/v1/…`（依方案給額度：free、pro、enterprise）。一間企業客戶 200 人在同一個 NAT IP 後面，每人每分鐘約 3 次請求。另有攻擊者用 50 個 IP 輪流對同一個帳號撞庫，每分鐘 1,500 次。nginx 擋在前面，後面是多台 API 實例，計數若放在應用層要用 Redis 共享。',
  constraints: [
    '辦公室 200 人的正常操作不能被擋（同一個 IP 每分鐘 600 次是正常流量）',
    '換 IP 撞同一個帳號的攻擊要擋得住，不能靠 IP',
    '公開搜尋沒有登入，能用的 key 只有 IP',
    '付費 API 的額度依方案不同，被限流時要回 `429` 並告訴客戶端何時能再試',
    '多台 API 實例共用同一個計數，否則每台各算一份、上限形同乘以台數',
  ],
  options: [
    {
      id: 'ip-nginx', name: 'nginx 每 IP 限速',
      summary: '`limit_req_zone $binary_remote_addr` 在 nginx 就擋掉超過速率的 IP，請求根本不進應用層。',
      pros: ['最便宜：超量請求在 nginx 就回 429，不耗 API 與 DB', '對匿名端點（公開搜尋、靜態資源）是唯一能用的 key', '設定幾行，不動程式碼'],
      cons: ['NAT 後的 200 人共用一個 IP，上限設給一個人就誤傷整間公司；設給整間公司就擋不住單一攻擊者', '攻擊者換 IP 就繞過：50 個 IP 各 30 次 / 分鐘，全部放行', 'nginx 預設不帶 Retry-After 或剩餘額度標頭，客戶端只知道被擋'],
    },
    {
      id: 'user-app', name: '應用層依帳號 / API key',
      summary: '登入後以 user_id 或 API key 當 key，`INCR` + `EXPIRE` 在 Redis 計數，多台實例共享。',
      pros: ['攻擊者不管換多少 IP，打同一個帳號就是同一個計數', 'NAT 後的每個人各自算，辦公室 200 人互不影響', '能回 `Retry-After`、`X-RateLimit-Remaining` 等標頭，也能依端點設不同上限'],
      cons: ['每個請求都要先進到應用層、查一次 Redis 才知道要不要擋，攻擊流量的成本全部由 API 吸收', '匿名端點沒有帳號可用，還是得退回 IP', '一個 flat 的每帳號上限對 enterprise 客戶太小、對 free 又太大'],
    },
    {
      id: 'tiered', name: '依方案分級額度',
      summary: '同樣在應用層以 API key 計數，但上限查方案：free 20、pro 200、enterprise 1,000 次 / 分鐘。',
      pros: ['額度是產品的一部分：付更多拿更多，回應標頭直接告訴客戶端方案上限', '企業客戶整間公司共用一把 key 也不會被誤傷'],
      cons: ['只對「有方案」的端點有意義，登入與公開搜尋沒有方案可查', '要多查一次方案（快取在 Redis 或 JWT claim 裡），改方案要即時生效', '同樣每個請求都進應用層，擋不住攻擊流量的成本'],
    },
    {
      id: 'layered', name: 'nginx 粗限 + 應用層細限',
      summary: 'nginx 每 IP 設一個寬鬆上限擋掃描器與失控客戶端；應用層再依帳號（或方案）設真正的額度。',
      pros: ['最極端的暴衝在 nginx 就吸收掉，正常範圍內的請求再由應用層精準判斷', '登入端點兩層都需要：每 IP 擋大量帳號枚舉、每帳號擋換 IP 撞庫'],
      cons: ['兩套設定要對得上：nginx 的 IP 上限必須高於 NAT 後最大合法流量，否則第一層就誤傷', '429 來自兩個地方，標頭與訊息要統一，除錯時要先分辨是哪一層擋的', '最複雜，兩層都要監控'],
    },
  ],
  tradeoffs: {
    axes: ['擋換 IP 的攻擊', 'NAT 後的正常使用者', '攻擊流量的成本', '複雜度'],
    rows: [
      { option: 'ip-nginx', cells: ['差：換 IP 就繞過', '差：整間公司一個計數', '好：nginx 就回 429', '最低'] },
      { option: 'user-app', cells: ['好：同帳號同計數', '好：各自計數', '差：每個請求都進應用層', '中：Redis 計數 + 標頭'] },
      { option: 'tiered', cells: ['好：同 key 同計數', '好：企業方案額度大', '差：同上', '中：多查方案'] },
      { option: 'layered', cells: ['好：應用層那段擋', '中：nginx 上限要放寬到 NAT 流量之上', '中：暴衝在 nginx 吸收', '最高：兩層'] },
    ],
  },
  decisions: [
    { id: 'login', situation: '`POST /login`：攻擊者用 50 個 IP 輪流撞同一個帳號，同時也有人用少數 IP 大量枚舉帳號；辦公室 200 人在同一個 NAT 後面正常登入。', options: ['ip-nginx', 'user-app', 'tiered', 'layered'], answer: 'layered',
      explain: '兩種攻擊要兩種 key：換 IP 撞同一帳號只有「每帳號」擋得住，少數 IP 枚舉大量帳號只有「每 IP」擋得住。nginx 每 IP 的上限要放寬到辦公室 NAT 的合法流量之上，應用層再以帳號的失敗次數細限。登入前沒有方案，分級用不上。' },
    { id: 'search', situation: '公開商品搜尋 `GET /search`：不用登入，流量大，偶爾有爬蟲用幾個 IP 狂抓。', options: ['ip-nginx', 'user-app', 'tiered', 'layered'], answer: 'ip-nginx',
      explain: '沒有登入就沒有帳號，能用的 key 只有 IP；既然如此，在 nginx 擋最便宜，爬蟲的請求不必進應用層。應用層的每帳號限流在這裡沒有 key 可用，兩層也只是把同一個 IP 上限算兩次。' },
    { id: 'paid', situation: '付費 API：free、pro、enterprise 三種方案額度不同，enterprise 客戶整間公司共用一把 API key、從同一個 NAT 出來。', options: ['ip-nginx', 'user-app', 'tiered', 'layered'], answer: 'tiered',
      explain: '額度本身是產品規格，只能依 API key 查方案來算；每 IP 會誤傷整間公司，flat 的每 key 上限對 enterprise 太小。回應帶 `X-RateLimit-Limit` 與 `Retry-After`，客戶端才知道方案上限與何時重試。' },
    { id: 'admin', situation: '內部後台 API：只有公司員工能用，全部在 VPN 與同一個 NAT 後面，沒有外部攻擊者，偶爾有人寫失控的腳本狂打。', options: ['ip-nginx', 'user-app', 'tiered', 'layered'], answer: 'user-app',
      explain: '所有人一個 IP，每 IP 限速只會讓一個失控腳本擋掉整間公司；沒有外部攻擊，nginx 那層省下來。應用層依帳號限速，失控的那個人自己被擋、其他人不受影響，也不需要方案分級。' },
  ],
  implementation: [
    { title: 'nginx 每 IP 粗限', lang: 'nginx', code: `# 每個 client IP 一個計數桶；上限要高於 NAT 後最大合法流量
limit_req_zone $binary_remote_addr zone=per_ip:10m rate=20r/s;

server {
    location /login {
        # burst 容忍短暫暴衝，nodelay 不排隊直接放行或拒絕
        limit_req zone=per_ip burst=40 nodelay;
        limit_req_status 429;
        add_header Retry-After 1 always;
        proxy_pass $app_upstream;    # 反向代理設定略
    }
    location /search {
        limit_req zone=per_ip burst=20 nodelay;
        limit_req_status 429;
        proxy_pass $app_upstream;
    }
}` },
    { title: '應用層：Redis 固定視窗，多台實例共享', lang: 'python', code: `import time

LIMITS = {"free": 20, "pro": 200, "enterprise": 1000}   # 次 / 分鐘

def check_rate_limit(key: str, plan: str = "free") -> tuple[bool, dict]:
    limit = LIMITS[plan]
    window = int(time.time()) // 60                 # 現在是第幾分鐘
    redis_key = f"rl:{key}:{window}"
    n = redis.incr(redis_key)                       # 原子遞增，多台 API 共用同一個數
    if n == 1:
        redis.expire(redis_key, 60)                 # 視窗過了自動消失
    reset = (window + 1) * 60
    headers = {
        "X-RateLimit-Limit": str(limit),
        "X-RateLimit-Remaining": str(max(0, limit - n)),
        "X-RateLimit-Reset": str(reset),
    }
    if n > limit:
        headers["Retry-After"] = str(reset - int(time.time()))
        return False, headers                       # 呼叫端回 429 並附上這些標頭
    return True, headers

# 登入端點：key 用帳號，不用 IP，換 IP 也繞不過
# allowed, headers = check_rate_limit(f"login:{username}")
# 付費 API：key 用 API key，上限查方案
# allowed, headers = check_rate_limit(f"api:{api_key}", plan=plan_of(api_key))` },
  ],
  exercise: 'rate-limiting-2',
  refs: [],
}

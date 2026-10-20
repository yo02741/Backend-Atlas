// 設計情境：Agent 怎麼接上內部工具（MCP 直連 / MCP Gateway / Gateway + Token Exchange）
export default {
  id: 'mcp-gateway',
  order: 23,
  group: 'agent',
  title: 'Agent 接上內部工具',
  en: 'Connecting agents to internal MCP servers',
  level: 3,
  week: 21,
  skills: ['mcp-gateway', 'mcp-authorization', 'key-scope-lifetime'],
  lab: 'McpGatewayScenarioLab',
  summary: '三種 agent、三個內部 MCP server：每個 agent 自己帶憑證直連，還是全部經過一個 gateway？下游要不要看得到真正的使用者？',
  situation: '虛構的軟體公司「北辰科技」有三種 agent 要用內部工具：工程部 40 人各自的 IDE agent、客服部 20 人共用的客服 agent（一個部署，客服人員用公司 SSO 登入它的網頁）、每晚彙整報表的排程 agent（沒有使用者）。內部有三個走 HTTP 的 MCP server：工單（`list_tickets`、`close_ticket`）、資料庫查詢（唯讀 replica）、文件搜尋。工單系統本身有權限模型：客服只能看自己負責的客戶。目前每個人在 agent 設定檔裡自己貼 token，資料庫查詢用的是一組共用的唯讀帳密。',
  constraints: [
    '員工離職當天，他透過任何 agent 能用的權限都要失效，而且要能確認「全部」失效',
    '資安要能回答：誰、透過哪個 agent、呼叫了哪個工具、什麼時候',
    '工具描述被改過（rug pull）時，不能在沒人審過的情況下被 agent 讀進去',
    '一個 agent 進入迴圈時，不能拖垮資料庫查詢 server 讓其他人一起受影響',
    '客服 agent 查工單時，只能看到那位客服人員本來就看得到的客戶',
  ],
  options: [
    {
      id: 'direct', name: '每個 agent 直連各 MCP server',
      summary: 'agent 設定檔裡列出每個 MCP server 的 URL，`Authorization: Bearer` 帶各自的長效 token（個人 PAT、共用 token、共用 DB 帳密）。',
      pros: ['不需要任何新元件，今天就能接上', '沒有多一跳，也沒有一個掛了全部停的單點'],
      cons: ['長效憑證散在每個人的設定檔、環境變數、雲端同步資料夾裡', '離職時 IdP 停用帳號，他自己建的 PAT 不會跟著失效；共用憑證只能整組輪替', '稽核散在各 server、格式不一，共用 token 看不出是誰', '授權、速率限制、工具描述比對全靠各 server 自己做（或沒做）'],
    },
    {
      id: 'gateway', name: '集中 MCP Gateway',
      summary: 'agent 只設定一個 gateway URL，用公司 SSO 登入（授權碼 + PKCE，token 存 OS keyring）；gateway 依群組過濾工具、`tools/call` 再授權、速率限制、比對工具定義雜湊、注入自己保管的下游服務憑證、寫稽核。',
      pros: ['下游憑證只在 gateway 的 secret 儲存，不在任何人電腦上', '離職 = IdP 停用帳號 → 登不進 gateway → 所有工具一起失效', '一份稽核：誰、哪個 client、哪個工具、參數摘要、結果', '上架審核並鎖定工具定義雜湊，描述被改就擋下'],
      cons: ['gateway 是單點也是高價值目標：所有下游憑證都在它手上', '下游只看到 gateway 的服務身分，使用者層級的授權只能靠 gateway 的群組政策', 'stdio 型的本機 MCP server 不容易納管', '每次工具呼叫多一跳'],
    },
    {
      id: 'exchange', name: 'Gateway + Token Exchange',
      summary: '同樣經過 gateway，但對下游不用萬用服務憑證：gateway 拿使用者的 token 向授權伺服器做 Token Exchange，換一個 `aud` 是該下游、壽命短、scope 不擴大的 token。',
      pros: ['下游看得到真正的使用者，能依那個人的權限判斷（客服只看自己的客戶）', 'gateway 手上沒有能代表任何人的長效下游憑證；每次換發都要授權伺服器同意', '換出來的 token 只對一個下游有效、幾分鐘就過期'],
      cons: ['每個下游都要接同一個授權伺服器，並自己驗 `aud`、`scope`', '多一次換 token 的往返（可在有效期內快取）', '沒有使用者的排程 agent 換出來的仍是服務身分，依使用者授權的好處用不到', '授權伺服器要設定「哪個 client 可以代表使用者換哪個 audience」，設定錯就是權限擴張'],
    },
  ],
  tradeoffs: {
    axes: ['長效憑證散落', '離職撤銷', '稽核', '依使用者授權', '導入成本'],
    rows: [
      { option: 'direct', cells: ['差：每人每個 server 一份', '差：逐把追、共用的整組輪替', '差：散在各 server，共用 token 看不出是誰', '中：看各 server 怎麼做', '最低'] },
      { option: 'gateway', cells: ['好：集中在 gateway', '好：停用 IdP 帳號即可', '好：一份紀錄', '中：gateway 的群組政策', '中：gateway + 上架流程'] },
      { option: 'exchange', cells: ['最好：只剩 gateway 自己的 client 憑證', '好：同左，下游 token 幾分鐘內自然過期', '好：gateway 與下游都記得是誰', '好：下游依使用者判斷', '高：每個下游接授權伺服器'] },
    ],
  },
  decisions: [
    { id: 'tiny', situation: '五人小團隊，只有一個唯讀的文件搜尋 MCP server，內容都是公開文件，沒有其他內部工具的計畫。', options: ['direct', 'gateway', 'exchange'], answer: 'direct',
      explain: '一個 server、唯讀、資料不敏感，gateway 要解決的「散落、各自授權、多份稽核」都還不存在。直連就好，但 token 仍要有範圍（只讀）與到期日、存在 OS keyring 而不是設定檔。server 數量開始增加時再收進 gateway。' },
    { id: 'internal-ro', situation: '30 人的工程團隊，十個內部 MCP server：監控、CI 狀態、唯讀資料查詢……下游都不區分使用者，只要確認「是公司的人」。', options: ['direct', 'gateway', 'exchange'], answer: 'gateway',
      explain: '下游不需要依使用者授權，gateway 用自己保管的服務憑證就夠：憑證集中、離職只停 IdP、一份稽核、上架鎖版本。Token Exchange 要每個下游都接授權伺服器並驗 aud，對不區分使用者的下游是多出來的工。' },
    { id: 'cs', situation: '客服 agent 要查工單，工單系統依客服人員決定能看哪些客戶；資安要求下游的 log 也要記到是哪位客服。', options: ['direct', 'gateway', 'exchange'], answer: 'exchange',
      explain: '權限模型在工單系統裡，gateway 的群組政策只能說「客服可以用 list_tickets」，說不出「只看自己的客戶」。用 Token Exchange 換出 aud 是工單、代表那位客服的短效 token，工單系統照自己的規則判斷，log 也記得到人。直連則回到 20 人共用一把 token、看不出是誰。' },
    { id: 'cron', situation: '排程 agent 每晚彙整工單與資料庫統計，沒有任何使用者在場。', options: ['gateway', 'exchange'], answer: 'gateway',
      explain: '沒有使用者，「下游依使用者判斷」的理由就不存在：Token Exchange 換出來的也只是這個服務自己的身分，多一次往返換不到額外資訊。排程用 Client Credentials 以服務身分登入 gateway，gateway 依政策給它唯讀工具、稽核記成服務身分。不要借某位工程師的帳號跑：那個人離職，排程就壞。' },
  ],
  implementation: [
    { title: 'gateway 的上架登記與政策（示意格式，不是特定產品的設定）', lang: 'yaml', code: `servers:
  tickets:
    url: https://tickets.internal/mcp
    owner: support-platform
    reviewed_version: 2.3.0
    tool_hash: sha256:9f2c41d07ab3          # 上架時審過的工具定義雜湊；不一致就停用並重審
    downstream_auth: token_exchange          # 下游依使用者授權
    audience: https://tickets.internal/mcp
  db-query:
    url: https://dbq.internal/mcp
    reviewed_version: 1.8.1
    tool_hash: sha256:51be0c9e44f0
    downstream_auth: service_credential      # 下游不分使用者，用 gateway 保管的唯讀憑證
    credential_ref: vault:mcp/db-query/readonly
  docs:
    url: https://docs-search.internal/mcp
    reviewed_version: 0.9.4
    tool_hash: sha256:c07d2a6e19b8
    downstream_auth: service_credential
    credential_ref: vault:mcp/docs/search

policy:
  eng:     [tickets.list_tickets, tickets.close_ticket, db-query.run_query, docs.search_docs]
  support: [tickets.list_tickets, tickets.get_ticket, docs.search_docs]
  svc-nightly-report: [tickets.list_tickets, db-query.run_query]   # 排程 agent 的服務身分

rate_limit:
  per: [user, tool]
  default: 30/min
  db-query.run_query: 10/min` },
    { title: 'gateway 對授權伺服器做 Token Exchange（換一張只給工單用的 token）', lang: 'http', code: `POST /token HTTP/1.1
Host: auth.example.com
Authorization: Basic bWNwLWdhdGV3YXk6ZXhhbXBsZS1zZWNyZXQ=
Content-Type: application/x-www-form-urlencoded

grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Atoken-exchange
&subject_token=eyJhbGciOiJFUzI1NiIsImtpZCI6IjIwMjYtMTAifQ…
&subject_token_type=urn%3Aietf%3Aparams%3Aoauth%3Atoken-type%3Aaccess_token
&resource=https%3A%2F%2Ftickets.internal%2Fmcp
&scope=tickets.read

HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{ "access_token": "eyJhbGciOiJFUzI1NiJ9…", "issued_token_type": "urn:ietf:params:oauth:token-type:access_token",
  "token_type": "Bearer", "expires_in": 300, "scope": "tickets.read" }` },
    { title: 'tools/call 的檢查順序（每一步失敗都寫稽核）', lang: 'python', code: `def tools_call(user, client, tool, args, now):
    if tool not in POLICY[user.group]:                   # 只在 tools/list 過濾不夠，call 時再授權
        return audit(user, client, tool, "denied: policy")
    if not rate_ok(user.id, tool, now):                   # 使用者 × 工具計數，多實例共用（Redis）
        return audit(user, client, tool, "denied: rate_limited")
    server = REGISTRY[tool.split(".")[0]]
    if current_tool_hash(server) != server.tool_hash:     # rug pull：描述被改過
        disable(server); notify_admin(server)
        return audit(user, client, tool, "denied: tool definitions changed")
    if server.downstream_auth == "token_exchange":
        cred = exchange(user.token, audience=server.audience, scope=server.scope_for(tool))
    else:
        cred = secrets.get(server.credential_ref)         # 使用者的 token 永遠不往下傳
    result = forward(server, tool, args, bearer=cred)
    return audit(user, client, tool, result.status, args=mask(args))` },
  ],
  exercise: null,
}

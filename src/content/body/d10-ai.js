// 領域 10：AI 時代的開發與 Agent 安全 的技能內文（以技能 id 為 key）
export default {
  // ── 團隊工作流 ──
  'ai-adr': {
    points: [
      { b: '一個決策一份檔案', t: 'Nygard 格式五段：標題、狀態、背景（當時的限制與選項）、決策（用「我們會…」寫）、後果（好的壞的都寫）。一到兩頁就夠。' },
      { b: '什麼時候寫', t: '之後很難反悔、會影響多個模組、或是團隊討論過不只一次的選擇：資料庫、驗證方式、API 版本策略、模組邊界。改一個變數名不需要 ADR。' },
      { b: '放在 repo 裡', t: '`docs/adr/0001-…md` 依序編號，跟程式碼一起 review、一起版控。決策和它影響的程式在同一個 PR 裡，日後 `git log` 找得到。' },
      { b: '不改寫，只取代', t: '已接受的 ADR 不回頭改內容。新決策寫新的一份，狀態寫 `Supersedes ADR-0003`，舊的那份狀態改成 `Superseded by ADR-0007`。歷史留著，才看得懂當時為什麼那樣做。' },
      { b: '也是給 agent 的規範', t: 'agent 拆票或改程式時讀相關 ADR，才不會把「已經決定不用 ORM」的模組改回 ORM。在專案規範檔裡指出 ADR 的位置，並要求改動違反 ADR 時先提出來。' },
    ],
    checklist: [
      '能用 Nygard 格式寫出一份 ADR，後果段同時列出代價',
      '能說出被取代的 ADR 該怎麼標註、為什麼不直接改舊檔',
      '能判斷一個改動需不需要 ADR',
    ],
    refs: [
      { label: 'Michael Nygard：Documenting Architecture Decisions', url: 'https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions' },
      { label: 'ADR GitHub organization（樣板與工具整理）', url: 'https://adr.github.io/' },
    ],
  },
  'ai-vertical-slices': {
    points: [
      { b: '垂直，不是水平', t: '「先做完所有 schema、再做所有 API、最後做 UI」是水平切法，做到最後才知道接不起來。tracer bullet 每張票都窄窄地貫穿 schema、API、UI、測試。' },
      { b: '做完就能單獨驗證', t: '每張票合併後都有一個能展示或能用測試驗證的行為，例如「病患能取消一筆未來的掛號」。只有「新增 table」的票驗證不了任何行為。' },
      { b: '大小放得進一個脈絡', t: '一張票要能在一個全新的 agent 工作脈絡裡做完：需求、相關程式、測試都讀得下。太大就再切，切不下去通常代表需求還沒想清楚。' },
      { b: '標出阻擋關係', t: '每張票寫「Blocked by」：哪些票做完才能開始。沒有阻擋的票可以平行做；阻擋關係錯了，平行的 agent 就會互相等待或重工。' },
      { b: '先 prefactor；大範圍重構用 expand–contract', t: '先把程式整理成容易改的樣子再做功能。改欄位名這種一改就壞上千處的機械式重構不硬切垂直：先加新形式與舊的並存、分批遷移、最後刪舊。' },
    ],
    checklist: [
      '能把一個需求拆成 4–6 張垂直切片票，每張寫出可驗證的完成條件',
      '能畫出票之間的阻擋關係，指出哪些可以平行',
      '能說出 expand–contract 三個階段與為什麼每批都能保持 CI 綠燈',
    ],
    refs: [
      { label: 'mattpocock/skills（engineering/to-tickets 拆票技能）', url: 'https://github.com/mattpocock/skills' },
      { label: 'Martin Fowler：Parallel Change（expand–contract）', url: 'https://martinfowler.com/bliki/ParallelChange.html' },
    ],
  },
  'ai-spec-to-tests': {
    points: [
      { b: '對話裡的規範會消失', t: '「金額要有千分位」「數量不能有小數」只在對話裡說過，下一個修別的 bug 的工作脈絡看不到它，改壞了也沒有任何東西會失敗。' },
      { b: '規範寫成測試', t: '每條規範至少一個測試，測試名稱就寫規範本身（`test_quantity_rejects_decimal`）。規範有了可執行的形式，改壞就會紅。' },
      { b: 'red → green → refactor', t: '先寫測試並親眼看它失敗（確認測試真的測到東西）、再寫剛好讓它通過的程式、最後在全綠的保護下整理。跳過 red，測試可能從來沒測到任何事。' },
      { b: '測試是 AI 不能改的契約', t: '要求 AI 修 bug 時不得修改既有測試的預期值；要改規範就由人改測試、在 PR 說明。review 時先看測試的 diff，再看程式的 diff。' },
      { b: '要求先交出失敗的測試', t: '請 AI 分兩步：先只寫測試並貼出失敗訊息，確認後再實作。失敗訊息要是「預期 1,234 得到 1234」這種斷言失敗，不是 import 錯誤。' },
    ],
    checklist: [
      '能把一條口頭規範寫成一個會先失敗、實作後通過的測試',
      '能說出為什麼一定要先看到測試失敗',
      '能寫出要求 AI 先交失敗測試、不得改既有測試的指示',
    ],
    refs: [
      { label: 'Python：unittest', url: 'https://docs.python.org/3/library/unittest.html' },
      { label: 'Martin Fowler：Test Driven Development', url: 'https://martinfowler.com/bliki/TestDrivenDevelopment.html' },
    ],
  },
  'ai-quality-gates': {
    points: [
      { b: '機械檢查不靠記性', t: 'formatter（`ruff format`）、linter（`ruff check`）、型別檢查（mypy / pyright）、測試與覆蓋率、相依套件檢查、secret 掃描。能用工具判定的事不要靠 review 的人眼。' },
      { b: '相依套件三件事', t: '已知漏洞（例如 pip-audit）、宣告了卻沒用到或用了卻沒宣告的依賴（例如 deptry）、授權條款是否允許。AI 很容易隨手加一個套件，閘門要看得到。' },
      { b: 'pre-commit 是快速回饋，CI 才是閘門', t: 'pre-commit hook 在本機幾秒內擋掉格式與 secret，但可以被 `--no-verify` 跳過；CI 在伺服器上重跑同一套檢查，失敗就不能合併。' },
      { b: 'MR pipeline 失敗就擋 merge', t: 'GitLab 用 `workflow: rules` 讓 merge request 觸發 pipeline，並在專案設定開啟「Pipelines must succeed」；main 設為受保護分支，不能直接 push。' },
      { b: '人與 AI 同一道門', t: '閘門不分作者。AI 產出的程式常見問題（沒用到的 import、型別對不上、多加的依賴、測試被改寬）大多能被機械檢查抓到，人再專心看設計與需求。' },
    ],
    checklist: [
      '能寫一份 GitLab CI：lint、typecheck、test 三個 job，MR 會觸發、失敗擋 merge',
      '能列出相依套件檢查要看的三件事',
      '能說出 pre-commit 與 CI 各自的角色與為什麼兩者都要',
    ],
    refs: [
      { label: 'Ruff', url: 'https://docs.astral.sh/ruff/' },
      { label: 'mypy', url: 'https://mypy.readthedocs.io/' },
      { label: 'pre-commit', url: 'https://pre-commit.com/' },
      { label: 'GitLab：Merge request pipelines', url: 'https://docs.gitlab.com/ee/ci/pipelines/merge_request_pipelines.html' },
    ],
  },
  'ai-skills-mcp': {
    points: [
      { b: 'Skill：可重複使用的工作說明書', t: '一個資料夾，主檔 `SKILL.md` 開頭有名稱與描述。模型平常只看到描述，判斷這次任務用得到才載入全文與附帶的腳本、範本。' },
      { b: 'MCP：連接工具與資料的開放協定', t: 'Model Context Protocol 定義 AI 應用（client）怎麼跟 MCP server 溝通，訊息是 JSON-RPC。server 提供 tools（可呼叫的動作）、resources（可讀的資料）、prompts（提示樣板）。' },
      { b: '兩種傳輸', t: 'stdio：client 在本機啟動 server 子程序，透過標準輸入輸出通訊；HTTP：server 是遠端服務，多人共用，需要授權。規格會改版，實作時以當時的規格版本為準。' },
      { b: '分工：教怎麼做 vs 給能做什麼', t: '「我們團隊怎麼寫 migration」是 Skill；「查詢工單系統」需要連外部系統，是 MCP tool。Skill 可以指示模型去用某個 MCP tool。' },
      { b: '分享平台就是治理問題', t: '內部 Skill 平台與 MCP 上架要回答：誰能上架、誰審核、怎麼鎖版本、改版後誰重新審。MCP server 握著憑證，風險比一份說明書高得多。' },
    ],
    checklist: [
      '能說出 Skill 與 MCP 各自解決什麼問題，並各舉一個例子',
      '能說出 MCP server 提供的三種東西與兩種傳輸方式',
      '能列出上架一個內部 MCP server 前要回答的治理問題',
    ],
    refs: [
      { label: 'Model Context Protocol', url: 'https://modelcontextprotocol.io/' },
      { label: 'Claude Docs：Agent Skills overview', url: 'https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview' },
    ],
  },
  'ai-multi-agent': {
    points: [
      { b: '一個 session 開太多 subagent 的問題', t: '所有輸出擠在同一個捲動紀錄裡，看不出誰卡住；要跟某一個講話只能請上層轉達；大家改同一個工作目錄，檔案互相覆蓋。' },
      { b: '一個 agent 一個 worktree', t: '`git worktree add -b agent/api ../wt-api main`：同一個 repo 開出多個工作目錄，各自 checkout 自己的分支，共用同一份物件庫。agent 之間不會改到彼此的檔案。' },
      { b: 'meta-agent 分派與彙整', t: '一個 meta-agent 拆工作、派給成員 agent、收報告、決定下一步；成員做完回報、卡住提問。人看得到每個成員的狀態，隨時能進去接手。' },
      { b: '衝突在分派時避免', t: '每張票寫清楚擁有哪些檔案；共用的介面（API 形狀、資料表、函式簽名）先定好並合進 main，各分支再從它開始。兩個 agent 都要改的檔案，就排先後。' },
      { b: 'worktree 不是安全邊界', t: 'worktree 只把工作分開，不限制 agent 能讀寫什麼、能用什麼憑證。執行環境與憑證的隔離是另一層問題。' },
    ],
    checklist: [
      '能用 git worktree 為三個 agent 各開一個分支與工作目錄，做完後清掉',
      '能在分派前寫出檔案所有權表，找出會衝突的檔案',
      '能說出 worktree 隔離了什麼、沒隔離什麼',
    ],
    refs: [
      { label: 'Git：git-worktree', url: 'https://git-scm.com/docs/git-worktree' },
      { label: 'Noopher-AI/oat-agents', url: 'https://github.com/Noopher-AI/oat-agents' },
    ],
  },
  // ── 身分與授權 ──
  'oauth-device-pkce': {
    points: [
      { b: 'Device Code：沒有瀏覽器的那一端', t: 'CLI 向授權伺服器要 `device_code` 與 `user_code`，畫面顯示網址與代碼；使用者在另一台裝置的瀏覽器登入並輸入代碼，CLI 依 `interval` 輪詢 token endpoint（RFC 8628）。' },
      { b: '輪詢的回應', t: '還沒授權回 `authorization_pending`、太快回 `slow_down`（要拉長間隔）、逾時回 `expired_token`、使用者拒絕回 `access_denied`。照規格處理才不會被限流。' },
      { b: 'PKCE：沒有 client secret 的 client', t: '桌面與原生 App 無法保密 secret。每次登入產生隨機 `code_verifier`，授權請求帶 `code_challenge = BASE64URL(SHA256(verifier))`、`code_challenge_method=S256`，換 token 時交出 verifier（RFC 7636）。' },
      { b: 'PKCE 擋的是 code 被攔截', t: '就算別的程式攔到授權碼，沒有 verifier 也換不到 token。`plain` 方法等於把 verifier 直接送出去，只在無法做 SHA-256 時才用。' },
      { b: 'Client Credentials：沒有使用者', t: '服務對服務用自己的 client id 與 secret 直接換 token（RFC 6749 §4.4），token 代表服務本身；規格建議這個流程不發 refresh token。不要拿它冒充使用者。' },
    ],
    checklist: [
      '能畫出 Device Code 流程的雙裝置時序，說出四種輪詢回應的處理',
      '能用 Python 產生 code_verifier 與 S256 code_challenge',
      '能依「有沒有瀏覽器、有沒有使用者、能不能保密 secret」選出授權流程',
    ],
    refs: [
      { label: 'RFC 8628：OAuth 2.0 Device Authorization Grant', url: 'https://datatracker.ietf.org/doc/html/rfc8628' },
      { label: 'RFC 7636：PKCE', url: 'https://datatracker.ietf.org/doc/html/rfc7636' },
      { label: 'RFC 6749 §4.4：Client Credentials Grant', url: 'https://datatracker.ietf.org/doc/html/rfc6749#section-4.4' },
    ],
  },
  'mcp-authorization': {
    points: [
      { b: 'MCP server 是受保護資源', t: 'HTTP 傳輸的 MCP server 在 OAuth 裡是 resource server：自己不發 token，只驗 token。發 token 的是授權伺服器。' },
      { b: '從 401 找到授權伺服器', t: 'client 沒帶 token 時 server 回 401，`WWW-Authenticate` 指向 Protected Resource Metadata（RFC 9728，`/.well-known/oauth-protected-resource`），裡面列出授權伺服器；client 再讀授權伺服器的 metadata（RFC 8414）找 endpoint。' },
      { b: 'Resource indicator 綁定對象', t: 'client 在授權與換 token 時帶 `resource` 參數（RFC 8707）指明要給哪一個 MCP server 用；拿到的 token audience 就是那個 server，拿去別的 server 不會被接受。' },
      { b: '驗章與 audience', t: 'token 是 JWT 時，server 從授權伺服器的 JWKS（RFC 7517 的 JWK Set）依 `kid` 取公鑰驗章，再檢查 `iss`、`aud`、`exp` 與 scope。只驗簽章不驗 audience，別的服務的 token 也能進來。' },
      { b: '不轉傳收到的 token', t: 'MCP server 要呼叫下游 API 時，用自己的憑證或另外換一張 token，不把 client 給它的 token 直接轉送出去（token passthrough）。授權細節隨規格版本調整，以所用的規格版本為準。' },
    ],
    checklist: [
      '能說出 client 從 401 走到拿到 token 會讀哪兩份 metadata',
      '能說出 resource indicator 與 audience 檢查防的是什麼',
      '能寫出驗 JWT 時要檢查的欄位清單',
    ],
    refs: [
      { label: 'MCP 規格：Authorization（2025-06-18）', url: 'https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization' },
      { label: 'RFC 9728：OAuth 2.0 Protected Resource Metadata', url: 'https://datatracker.ietf.org/doc/html/rfc9728' },
      { label: 'RFC 8707：Resource Indicators for OAuth 2.0', url: 'https://datatracker.ietf.org/doc/html/rfc8707' },
      { label: 'RFC 7517：JSON Web Key', url: 'https://datatracker.ietf.org/doc/html/rfc7517' },
    ],
  },
  'mcp-gateway': {
    points: [
      { b: '沒有 gateway 時', t: '每個人、每個 agent 各自設定一串 MCP server，各自保管下游服務的 token。誰接了什麼、用哪一版、token 在哪台電腦上，沒人說得清楚。' },
      { b: '憑證留在 gateway', t: 'agent 用自己的身分登入 gateway；gateway 代為呼叫後端 MCP server，下游服務的憑證只存在 gateway，不出現在使用者電腦或 agent 的執行環境。' },
      { b: '上架要經過審核', t: '新的 MCP server 要上架：誰維護、要哪些權限、工具描述內容、版本。審過才進內部清單，版本鎖定；描述或權限變動要重審。' },
      { b: '依身分給工具', t: 'gateway 依使用者的角色決定看得到哪些 server 與 tools，例如只有維運角色看得到「重啟服務」。最小權限做在 gateway，不靠每個 server 各自判斷。' },
      { b: '每次呼叫都留紀錄', t: '誰、透過哪個 agent、呼叫哪個 tool、帶什麼參數、結果如何。缺稽核是 OWASP MCP Top 10 的 MCP08；出事時要能回答「這把資料是誰讀走的」。' },
    ],
    checklist: [
      '能畫出 agent → gateway → MCP server → 下游服務的架構，標出每一段用的憑證',
      '能列出 MCP server 上架審核要看的項目',
      '能說出 gateway 稽核紀錄至少要有哪些欄位',
    ],
    refs: [
      { label: 'OWASP MCP Top 10', url: 'https://github.com/OWASP/www-project-mcp-top-10' },
    ],
  },
  'identity-gateway': {
    points: [
      { b: '每個工具各做登入的代價', t: '每個內部工具一套帳密：密碼重複使用、離職要記得停用十個地方、沒有一致的 MFA，也沒有一處能看到誰登入了什麼。' },
      { b: '閘道驗證、工具信任閘道', t: '身分閘道（OIDC 身分提供者 + 驗證型反向代理）完成登入，把已驗證的使用者身分傳給後面的工具；工具不碰密碼。' },
      { b: '工具要確認身分真的來自閘道', t: '後端只接受從閘道來的流量（網路限制），並驗證閘道簽發的 token 或簽章標頭；單純信任一個 `X-User` 標頭，任何能直連後端的人都能偽造。' },
      { b: '權限集中', t: '群組與角色在身分提供者管理，閘道或工具依群組決定權限（RBAC）。調整一個人的權限、停用一個帳號，只改一個地方，所有工具同時生效。' },
      { b: 'agent 也是身分', t: 'agent 透過閘道存取工具時，用的是「某人授權的 agent」身分而不是共用帳號，稽核紀錄才分得出是人做的還是 agent 做的。' },
    ],
    checklist: [
      '能畫出使用者 → 身分閘道 → 內部工具的登入流程',
      '能說出只信任 X-User 標頭的風險與修法',
      '能說出帳號停用在集中式與分散式架構下各要改幾個地方',
    ],
    refs: [
      { label: 'OpenID Connect Core 1.0', url: 'https://openid.net/specs/openid-connect-core-1_0.html' },
      { label: 'RFC 8414：OAuth 2.0 Authorization Server Metadata', url: 'https://datatracker.ietf.org/doc/html/rfc8414' },
    ],
  },
  'cli-token-storage': {
    points: [
      { b: '明文設定檔的問題', t: '`~/.toolrc` 裡的 token 會被備份、被同步到雲端、被貼進 issue、被任何以你身分執行的程式讀到——包括 agent 與它呼叫的工具。' },
      { b: '用作業系統的 credential store', t: 'macOS Keychain、Windows Credential Manager、Linux 的 Secret Service（GNOME Keyring、KWallet）。Python 的 `keyring` 套件用同一組 API 存取這些後端。' },
      { b: '沒有 keyring 時', t: '無桌面的伺服器或容器可能沒有 credential store。退而求其次存檔案時權限設 `600`、放在使用者目錄、不進版控，並在文件寫明這是降級方案。' },
      { b: '環境變數不是保險箱', t: '環境變數會被子程序繼承、出現在除錯輸出與錯誤回報裡。agent 執行的每個指令都繼承得到；它適合 CI 在單一 job 短期注入，不適合長期存放。' },
      { b: '存短效的，能撤銷的', t: '優先存 refresh token 換來的短效 access token，或有到期日與範圍的 token；登出要真的撤銷伺服器端的 token，不只是刪掉本機檔案。' },
    ],
    checklist: [
      '能用 Python keyring 寫入、讀取、刪除一個 token',
      '能說出為什麼 agent 的執行環境不該在環境變數裡有長效 token',
      '能說出沒有 credential store 時的降級做法與限制',
    ],
    refs: [
      { label: 'keyring（PyPI）', url: 'https://pypi.org/project/keyring/' },
      { label: 'OWASP Secrets Management Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html' },
    ],
  },
  'key-scope-lifetime': {
    points: [
      { b: '三個問題', t: '這把金鑰能做什麼（scope）？什麼時候失效（到期日）？誰在什麼時候用過（稽核）？三個都答不出來，外洩時就沒辦法估計損害。' },
      { b: '實例：沒有範圍、沒有期限的 Legacy API Key', t: 'Zeabur 2026 年 8 月的事件中，攻擊者在共享叢集內網讀到路由快取裡的 Legacy API Key，其中一把是團隊管理員金鑰；這類金鑰沒有權限範圍、沒有期限。事後全部停用，新 Access Token 支援範圍、到期日與稽核紀錄。' },
      { b: '範圍：只給這個工作需要的', t: '部署用的 token 只能部署指定專案，不能管理成員或讀帳單；唯讀的工作就發唯讀 token。管理員權限的金鑰不給自動化流程用。' },
      { b: '壽命：會過期，能輪替', t: '每把金鑰都有到期日；輪替要能在不停機的情況下進行（新舊並存一段時間）。能用短效 token 或工作負載身分的地方，就不發長效金鑰。' },
      { b: '稽核：發現外洩靠紀錄', t: '記錄每把金鑰的建立者、用途、最後使用時間與來源。長期沒用的金鑰停用；同一把金鑰突然從新的位置被使用，要能被發現。' },
    ],
    checklist: [
      '能為一把 CI 部署用的 token 寫出範圍、到期日與輪替方式',
      '能用 Zeabur 事件說明沒有範圍與期限的金鑰如何放大損害',
      '能列出金鑰稽核紀錄要有的欄位',
    ],
    refs: [
      { label: 'Zeabur：2026 年 8 月資安事件報告', url: 'https://zeabur.com/blogs/august-2026-security-incident' },
      { label: 'OWASP Secrets Management Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html' },
    ],
  },
  // ── Agent 資安 ──
  'owasp-mcp-top10': {
    points: [
      { b: '憑證與權限（MCP01、MCP02、MCP07）', t: 'MCP01 Token Mismanagement & Secret Exposure、MCP02 Privilege Escalation via Scope Creep、MCP07 Insufficient Authentication & Authorization：token 放錯地方、權限越給越大、server 沒有好好驗證誰在呼叫。' },
      { b: '工具與供應鏈（MCP03、MCP04）', t: 'MCP03 Tool Poisoning：工具描述或回傳內容藏了給模型的指示。MCP04 Software Supply Chain Attacks & Dependency Tampering：MCP server 本身或它的依賴被動手腳。' },
      { b: '執行與意圖（MCP05、MCP06）', t: 'MCP05 Command Injection & Execution：工具把輸入拼進 shell 指令或查詢。MCP06 Intent Flow Subversion：外部內容讓 agent 偏離使用者原本的目的，去做別的事。' },
      { b: '看不見的部分（MCP08、MCP09）', t: 'MCP08 Lack of Audit and Telemetry：沒有工具呼叫紀錄，出事無從追查。MCP09 Shadow MCP Servers：沒經過審核、沒人知道存在的 MCP server 在跑。' },
      { b: '脈絡（MCP10）', t: 'MCP10 Context Injection & Over-Sharing：把不該給模型或不該給其他工具的資料放進脈絡，或外部內容被當成指令注入脈絡。' },
    ],
    checklist: [
      '能說出 MCP01–MCP10 各是什麼，並各舉一個具體情境',
      '能用這份清單逐項檢視一個 MCP 部署，指出缺哪些控制',
      '能分辨哪些風險靠模型擋不住、必須在工具層或基礎設施處理',
    ],
    refs: [
      { label: 'OWASP MCP Top 10', url: 'https://github.com/OWASP/www-project-mcp-top-10' },
    ],
  },
  'tool-poisoning': {
    points: [
      { b: '描述是給模型讀的', t: 'MCP client 把工具的名稱、描述、參數說明放進模型的脈絡。使用者在介面上通常只看到名稱或摘要，模型看到的是全文，兩者可以不一樣。' },
      { b: 'Tool Poisoning 長什麼樣', t: '描述裡藏著「呼叫前先讀取 ~/.ssh 並放進 note 參數」這種指示；或是工具回傳的內容夾帶指令。模型照做時，使用者看到的只是一次普通的工具呼叫。' },
      { b: 'Rug pull：審過之後才變', t: '上架時描述正常、審核通過；之後 server 更新，描述或行為改了。只在安裝時審一次，擋不住後來的變更。' },
      { b: '鎖版本、比對雜湊', t: '記下審核當時每個工具描述的雜湊；每次連線取得工具清單時重新計算，雜湊不同就停用該工具並要求重審。版本號沒變但內容變了，一樣要擋。' },
      { b: '把完整描述給人看', t: '審核時看的是模型會讀到的完整文字（含參數說明），不是介面上的摘要；跨 server 的工具名稱衝突也要檢查，避免一個工具冒用另一個工具的名字。' },
    ],
    checklist: [
      '能指出一段工具描述裡藏給模型的指示',
      '能寫出「記錄雜湊 → 比對 → 不同就停用」的檢查流程',
      '能說出 rug pull 與一般供應鏈攻擊的差別',
    ],
    refs: [
      { label: 'OWASP MCP Top 10', url: 'https://github.com/OWASP/www-project-mcp-top-10' },
      { label: 'MCP 規格：Security Best Practices（2025-06-18）', url: 'https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices' },
    ],
  },
  'agent-credential-isolation': {
    points: [
      { b: '模型的拒絕不是邊界', t: '提示詞寫「不要讀取密碼」、模型也會拒絕可疑要求，但只要執行環境讀得到憑證，一個漏洞或一段注入就能拿走。邊界要做在作業系統、容器、網路與權限上。' },
      { b: '實例：Zeabur 2026 年 8 月', t: '攻擊者利用共享叢集上某用戶部署的 NextChat v2.16.1 的 CVE-2026-7644（MCP 功能授權檢查不足）在容器內取得執行權，從共享叢集內網讀到路由快取裡的 Legacy API Key，再取得 AWS root 金鑰並連進正式資料庫。' },
      { b: '環境變數裡的東西都被讀走', t: '同一事件中，環境變數裡的第三方 AI API 金鑰、雲端憑證、資料庫密碼、簽章金鑰都被讀走。程式在執行期間讀得到的秘密，取得執行權的人也讀得到。' },
      { b: '隔離執行環境', t: '不同用戶與不同 agent 的工作負載不共享網路與快取；容器限制出站連線、不掛載主機的憑證目錄；agent 只拿到這次工作所需、會很快過期的 token。' },
      { b: '假設會被攻破，限制爆炸半徑', t: '問「這個容器被拿下時，攻擊者能拿到什麼」：讀得到哪些秘密、連得到哪些內網服務、拿到的金鑰能做什麼。每一項都要能縮小。' },
    ],
    checklist: [
      '能畫出 Zeabur 事件從應用漏洞到正式資料庫的攻擊路徑',
      '能為一個 agent 執行環境列出網路、檔案系統、憑證三方面的限制',
      '能說出為什麼提示詞層的防護不能取代執行邊界',
    ],
    refs: [
      { label: 'Zeabur：2026 年 8 月資安事件報告', url: 'https://zeabur.com/blogs/august-2026-security-incident' },
      { label: 'OWASP MCP Top 10', url: 'https://github.com/OWASP/www-project-mcp-top-10' },
    ],
  },
  'agent-supply-chain': {
    points: [
      { b: '改變行為的也是依賴', t: 'Skill、MCP server、工具描述、提示詞樣板不一定是程式碼，但會改變 agent 做什麼。它們跟 npm、PyPI 套件一樣需要來源、版本、審核。' },
      { b: '清單：誰用了哪一版', t: '維護內部清單：每個 Skill 與 MCP server 的來源、維護者、版本或雜湊、核准者、哪些團隊在用。出事時第一個問題是「有哪些 agent 載入了這一版」。' },
      { b: '鎖版本，更新要重審', t: '不自動追最新版。更新時比對差異：Skill 的說明文字、MCP 工具的描述與權限都要看，不只看版本號。' },
      { b: '先在受限環境試', t: '新的或更新的 Skill 與 MCP server 先在沒有正式憑證、出站受限的環境試跑，觀察它實際呼叫了哪些工具、連了哪些地方，再決定上架。' },
      { b: '撤下要快', t: '發現有問題的版本要能一次從所有 agent 撤下：集中式的上架清單或 gateway 做得到，散落在每個人電腦上的設定做不到。' },
    ],
    checklist: [
      '能列出內部 Skill 與 MCP 清單要記錄的欄位',
      '能說出更新一個 MCP server 時要比對哪些內容',
      '能說出集中上架對撤下有問題版本的好處',
    ],
    refs: [
      { label: 'OWASP MCP Top 10', url: 'https://github.com/OWASP/www-project-mcp-top-10' },
      { label: 'SLSA（供應鏈安全框架）', url: 'https://slsa.dev/' },
    ],
  },
}

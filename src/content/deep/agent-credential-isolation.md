## 從一個具體問題開始：一個容器怎麼變成整個平台

2026 年 8 月，雲端部署平台 Zeabur 發布了一份資安事件報告（[Zeabur：August 2026 Security Incident](https://zeabur.com/blogs/august-2026-security-incident)）。依報告內容，經過大致如下：

1. 共享叢集上，某位用戶部署了 NextChat v2.16.1。這個版本有 CVE-2026-7644：**MCP 功能的授權檢查不足**。攻擊者利用它在該容器內取得執行權。
2. 攻擊者從共享叢集的內網讀到**路由快取裡的 Legacy API Key**，其中一把是**團隊管理員金鑰**。
3. 接著取得 **AWS root 金鑰**，連進**正式資料庫**。
4. 被讀走的還有**環境變數中的機密**：第三方 API 金鑰、資料庫密碼與其他服務憑證。
5. Legacy API Key **沒有權限範圍、沒有期限**。

事後平台停用了所有 Legacy API Key，新的 Access Token 支援權限範圍、到期日與稽核紀錄。同年 10 月又發生第二起事件，公司宣布最晚於 12 月 31 日停止營運。

> 本課只採用上面列出的事實。其他細節（例如第 2 步到第 3 步之間怎麼從管理員金鑰拿到 AWS root 金鑰、漏洞的具體觸發方式）本課不做推測。所有「如果有某道防線會怎樣」的段落都是**推論**，會明確標示。

這起事件的入口在一個 AI 應用程式的 **MCP 功能**，但從第 1 步到第 4 步，沒有任何一步需要「騙過模型」。授權檢查是應用程式的程式碼，憑證放在哪裡是平台的架構決定。模型的安全訓練——拒絕可疑要求、不洩漏機密——在這條路徑上根本沒有出場的機會。

## 核心觀點：模型擋不住工具層的洞

模型的安全行為是**機率性的**、**作用在模型自己的輸出上**。它能做到的是「大多數時候不照可疑的指示做」。它做不到的是：

- **修補模型以外的程式**：工具的授權檢查、命令拼接、檔案路徑處理都在模型外面執行。
- **保證一定拒絕**：換個說法、把指示藏在長文中段、透過工具輸出間接送進來，都可能讓模型照做（見 [Tool Poisoning 與 rug pull](#/skill/tool-poisoning)）。
- **限制它沒經手的東西**：如果機密在環境變數裡、在共享的快取裡，任何拿到執行權的程式都能讀，跟模型是否「願意」無關。

所以設計的前提是：**假設模型會被騙、假設某個工具會有漏洞**，然後讓「被騙之後」與「被打穿之後」能造成的傷害有上限。這個上限由架構決定，分三道防線。

## 三道防線

### 第 1 道：工具執行層的 credential 隔離

每個工具、每個租戶只拿得到**自己需要**的憑證：

- **不共用環境變數**：一個行程的環境變數，該行程裡任何程式碼都讀得到（包括被注入的程式碼）。多個工具跑在同一個行程、或共用同一份 `.env`，等於每個工具都持有全部憑證。
- **不共用叢集內網的快取與服務**：租戶之間在網路層隔離（network policy、獨立的 VPC 或 namespace），一個租戶的工作負載不能連到平台內部的快取、控制面或其他租戶的服務。
- **每把憑證有範圍、有期限**：沒有範圍的金鑰外洩一把就是全部；沒有期限的金鑰外洩後永遠有效。管理員等級與 cloud root 等級的憑證不給任何自動化流程使用。

這一層對應 OWASP MCP Top 10 的 MCP01（token 管理）與 MCP02（權限蔓延），見 [OWASP MCP Top 10](#/skill/owasp-mcp-top10)。基礎做法見 [Secrets 管理](#/skill/secrets)、[環境與機密](#/skill/environments-secrets)。

### 第 2 道：credential 永遠不進 LLM context

模型只拿到「**呼叫權**」——可以提出「用 GitHub 工具讀 issue #12」——拿不到 token 本身。實際的 token 由執行層的 **broker／gateway** 在送出請求的那一刻注入：

- 模型看不到 token，也就**印不出來**：就算被誘導「把你的設定印出來」，context 裡沒有可印的東西。
- 工具輸出回到模型前先**遮罩**：下游 API 的錯誤訊息常常把請求標頭整包帶回來，broker 要在這裡把機密拿掉。
- 工作負載本身也不持有長效機密：broker 依需要換發短效 token（OAuth 的 token exchange、雲端的短期憑證），用完即失效。

### 第 3 道：決策層與執行層分離（harness 的邊界）

模型**提出**動作，**harness**（包住模型的執行框架）依政策檢查後才**執行**：

- 政策用程式寫，不用 prompt 寫：允許哪些工具、哪些參數範圍、哪些目標（例如只能寫入特定 repo）。
- 高風險動作（刪除、寫入正式環境、對外傳送、變更權限、新增工具或 MCP server）要**人核准**，核准畫面顯示完整參數。
- 每一個提出、核准、拒絕、執行都留下稽核紀錄（MCP08）。

這三道防線互補：第 1 道限制「一旦被打穿能拿到多少」，第 2 道讓「透過模型外洩」這條路沒有東西可洩，第 3 道讓「模型被騙之後」不會直接變成動作。

## 架構對照

```text
沒有邊界的做法                              三道防線
──────────────                              ──────────
┌─────────── 同一個行程／叢集 ───────────┐   ┌──────── 決策層 ────────┐
│ LLM ──▶ 工具 A ──┐                     │   │ LLM：只產生「提案」     │
│        工具 B ──┼─▶ 讀 .env：           │   │ {tool, args}            │
│        工具 C ──┘   全部的 token        │   └──────────┬─────────────┘
│                                         │              ▼  ③ 政策檢查／人核准
│ 共享內網：路由快取、管理 API、           │   ┌──────── harness ───────┐
│           其他租戶的服務                 │   │ allowlist、參數規則、稽核│
│                                         │   └──────────┬─────────────┘
│ 錯誤訊息含 token ──▶ 回到 LLM context    │              ▼
└─────────────────────────────────────────┘   ┌──── broker／gateway ────┐
                                              │ ② 依工具注入短效 token   │
                                              │   輸出遮罩後才回給模型   │
                                              └──┬────────┬────────┬────┘
                                       ① 隔離    ▼        ▼        ▼
                                              ┌─────┐  ┌─────┐  ┌─────┐
                                              │工具A│  │工具B│  │工具C│  各自沙箱、
                                              │憑證a│  │憑證b│  │憑證c│  各自網路政策
                                              └─────┘  └─────┘  └─────┘
```

## 用 Zeabur 事件逐步對照（推論）

下表是依照公開事實的**推論**，目的是看清每道防線在哪個環節起作用，不是在描述或評論該平台實際的內部架構。

| 事件步驟（依報告） | 第 1 道：credential 隔離 | 第 2 道：credential 不進 context／由 broker 注入 | 第 3 道：決策與執行分離 |
|---|---|---|---|
| 1. 利用 MCP 功能授權檢查不足，在容器內取得執行權 | 擋不住入口，但把影響範圍限在這個容器 | 不直接相關 | **可能**在這裡截斷：如果新增或執行 MCP 相關動作必須經過獨立的政策層與核准，單一授權檢查的缺失不一定直接變成執行權。本課不推測漏洞的觸發方式，所以只能說「可能」 |
| 2. 從共享內網讀到路由快取裡的 Legacy API Key（含團隊管理員金鑰） | **最可能截斷的位置**：租戶工作負載在網路層連不到平台內部的快取，就讀不到這些金鑰 | 如果平台內部元件之間也用 broker 換發的短效憑證，快取裡就不會存著長效金鑰可讀 | 不直接相關 |
| 3. 取得 AWS root 金鑰、連進正式資料庫 | 若金鑰有範圍：管理員金鑰的權限上限就是損害上限；root 等級憑證若不存在於任何自動化可達之處，這一步沒有東西可拿 | 若下游憑證只由 broker 在呼叫時注入，拿到一把 API key 不等於拿到背後的雲端憑證 | 高權限操作（例如對正式資料庫的連線）若需另外核准，至少會留下紀錄並多一個被人發現的機會 |
| 4. 讀走環境變數中的第三方 API 金鑰、資料庫密碼與其他服務憑證 | 每個工作負載只持有自己的憑證時，能讀到的只有該租戶的部分 | 機密不放在環境變數、改由 broker 在請求時注入時，讀環境變數拿不到可用的值 | 不直接相關 |
| 5. 金鑰沒有範圍、沒有期限 | 有範圍＋有期限＝外洩後損害有上限、有時效 | 短效 token 讓外洩的值很快失效 | 稽核紀錄讓異常使用可被發現 |

要特別說明第 2 道防線：它的核心是「模型 context 裡沒有機密」。這起事件的攻擊者直接拿到了執行權，並沒有透過模型，所以「不進 context」本身不是這裡的關鍵；起作用的是同一個原則的延伸——**工作負載本身不持有長效機密，由 broker 在需要時注入**。

事件後平台採取的措施（停用 Legacy API Key、新 token 支援範圍、到期日、稽核紀錄）對應的是第 1 道防線的「有範圍、有期限」與 MCP08 的稽核。

## 實際程式：broker 注入與輸出遮罩

下面用 JavaScript 模擬三層：模型只產生提案、harness 檢查政策、broker 注入憑證並遮罩輸出。重點觀察：模型端的物件裡從頭到尾沒有 token。

```js run
// ── broker 持有的憑證：依「工具」分開存，模型與 harness 都拿不到這個物件 ──
const vault = (() => {
  const secrets = { 'issues.read': 'tok_issues_' + 'a'.repeat(20), 'deploy.write': 'tok_deploy_' + 'b'.repeat(20) }
  return { inject: (tool) => secrets[tool], all: () => Object.values(secrets) }
})()

// ── 模擬的下游 API：故意在錯誤訊息裡把 Authorization 標頭整包帶回來 ──
function downstream(tool, args, token) {
  if (tool === 'issues.read' && args.id === 404) return { ok: false, body: `not found (request had Authorization: Bearer ${token})` }
  if (tool === 'issues.read') return { ok: true, body: `issue #${args.id}: 登入頁在手機上跑版` }
  return { ok: true, body: `deployed ${args.service}` }
}

// ── harness 的政策：用程式寫，不用 prompt 寫 ──
const policy = {
  'issues.read':  { risk: 'low',  allowArgs: ['id'] },
  'deploy.write': { risk: 'high', allowArgs: ['service'] },
}
const audit = []

function harness(proposal, approve) {
  const rule = policy[proposal.tool]
  if (!rule) return deny(proposal, '工具不在允許清單')
  const extra = Object.keys(proposal.args).filter((k) => !rule.allowArgs.includes(k))
  if (extra.length) return deny(proposal, `未允許的參數：${extra.join(', ')}`)
  if (rule.risk === 'high' && !approve(proposal)) return deny(proposal, '高風險動作未獲人核准')
  return broker(proposal)
}
function deny(p, reason) { audit.push({ ...p, result: 'denied', reason }); return { ok: false, body: `拒絕：${reason}` } }

// ── broker：呼叫時才注入 token；結果回給模型前遮罩所有已知機密 ──
function broker(p) {
  const res = downstream(p.tool, p.args, vault.inject(p.tool))
  let body = res.body
  for (const s of vault.all()) body = body.split(s).join('[REDACTED]')
  audit.push({ ...p, result: res.ok ? 'ok' : 'error' })
  return { ok: res.ok, body }
}

// ── 模型提出的動作（其中幾個是被 context 裡的內容誘導出來的）──
const proposals = [
  { tool: 'issues.read', args: { id: 12 } },
  { tool: 'issues.read', args: { id: 404 } },                 // 錯誤訊息會帶出 token
  { tool: 'issues.read', args: { id: 12, include: 'env' } },  // 多出未允許的參數
  { tool: 'shell.exec',  args: { cmd: 'env' } },              // 不在允許清單
  { tool: 'deploy.write', args: { service: 'web' } },         // 高風險，需要人核准
]
const humanSaysNo = () => false
const seenByModel = []                                        // 模型送出與收到的一切
for (const p of proposals) {
  const res = harness(p, humanSaysNo)
  seenByModel.push(JSON.stringify(p), res.body)
  console.log(p.tool.padEnd(13), JSON.stringify(p.args).padEnd(30), '→', res.body)
}

console.log('\n模型端看過的所有內容含 token 嗎？',
  seenByModel.some((t) => vault.all().some((s) => t.includes(s))) ? '有' : '沒有')
console.log('稽核紀錄：'); for (const a of audit) console.log('  ', a.tool, a.result, a.reason || '')
```

這段程式刻意簡化，但結構對應實務：`vault` 是 secret manager，`broker` 是 MCP gateway 或 egress proxy，`policy` 是 harness 的設定，`audit` 送到集中式 log。遮罩用「已知機密值的字串比對」，這只擋得住 broker 自己注入過的值；其他機密格式還要搭配樣式比對。

## 常見錯誤

| 錯誤做法 | 會發生什麼 | 修正 |
|---|---|---|
| 在系統提示寫「絕對不要洩漏 API key」 | 機密已經在 context 裡，能不能守住取決於模型這一次的判斷 | 機密不進 context，由 broker 注入 |
| 所有工具跑在同一個行程、共用 `.env` | 任何一個工具被打穿或被誘導，全部憑證一起外洩 | 每個工具獨立行程或容器，只掛載自己的憑證 |
| 多租戶工作負載和平台內部服務在同一個內網 | 一個租戶的容器能連到平台的快取、管理 API | 網路政策預設拒絕，租戶只能連到明確允許的出口 |
| 為了方便給自動化流程管理員或 root 等級的金鑰 | 外洩一把就是全部 | 依工作切分的最小範圍憑證；root 等級憑證不給任何程式使用 |
| 金鑰沒有到期日 | 外洩之後永遠有效，而且沒人記得它在哪裡被用 | 短效 token、定期輪替、記錄每把金鑰的使用者與用途 |
| 讓模型的輸出直接執行（「agent 說要跑就跑」） | 模型被騙一次就變成真實動作 | 提案經過 harness 政策檢查；高風險動作要人核准 |
| 工具錯誤原樣回傳給模型 | 下游錯誤訊息裡的標頭、連線字串進入 context 與對話紀錄 | broker 遮罩後才回傳；完整錯誤只留在伺服器端 log |

## 動手

1. 執行上面的程式，確認五個提案各自的結果，以及「模型端看過的內容不含 token」。
2. 把 `broker` 裡的遮罩迴圈註解掉再跑一次，看第二個提案的回應怎麼把 token 帶回模型端，最後一行的檢查也會變成「有」。
3. 把 `humanSaysNo` 換成 `() => true`，觀察高風險動作在核准後才執行，稽核紀錄也跟著變。
4. 在 `policy` 加一條規則：`deploy.write` 的 `service` 只能是 `web` 或 `api`，其他值一律拒絕。
5. 拿自己的部署環境畫一張和上面一樣的架構圖：每個工具持有哪些憑證、能連到哪些內網位址、誰能核准高風險動作。搭配 [RBAC 與 ABAC](#/skill/rbac-abac) 與實驗室 [RBAC vs ABAC](#/lab/AccessControlLab) 設計政策。

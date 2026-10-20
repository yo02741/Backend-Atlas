## 從一個具體問題開始：SBOM 全綠，agent 卻變了

一個團隊的服務有完整的供應鏈管理：lock 檔鎖住每個套件的版本與雜湊、CI 每次產生 SBOM、映像有簽章、Dependabot 每週開 PR。這週的掃描報告全綠，沒有任何依賴變更。

但同一週，團隊的 coding agent 行為變了：

- 它開始在每個 PR 裡順手改 CI 設定。追查後發現，repo 裡的 agent 指示檔被某個 PR 加了一段「維護 CI 時的建議做法」，審查者當時只看了程式碼的 diff。
- 它呼叫內部文件搜尋工具時多帶了一個參數。那個 MCP server 是遠端服務，它回傳的工具描述上週改過，沒有任何人收到通知。
- 有一位成員在本機設定加了一個新的 MCP server，它能讀整個工作目錄，但它不在任何清單上。
- 模型供應商把團隊指定的模型別名指向了新版本，回應風格和工具使用習慣都不太一樣。

以上沒有一項會出現在 SBOM 裡。它們沒有改變任何程式碼，改變的是 **agent 怎麼決定要做什麼**。

## 運作原理：程式層與行為層

傳統供應鏈（見 [供應鏈安全](#/skill/supply-chain)）管的是**程式層**：會被執行的程式碼與它的依賴。

| 程式層的依賴 | 管理方式 |
|---|---|
| 套件（PyPI、npm） | lock 檔、雜湊、漏洞掃描、SBOM |
| 容器映像 | 固定 digest、映像掃描、簽章 |
| CI 的第三方 action | 釘 commit SHA、最小權限 |

agent 多了一層**行為層**：這些內容不會被 CPU 執行，而是被模型讀進 context，改變模型的決定。

| 行為層的依賴 | 例子 | 會改變什麼 | 為什麼傳統工具看不到 |
|---|---|---|---|
| MCP server | 本機啟動的 server、遠端 server | agent 能做哪些動作、用什麼權限做 | 遠端 server 根本不是依賴，只是一個網址；本機 server 常用 `npx -y` 這類方式即時下載 |
| 工具描述 | `tools/list` 回傳的 `description`、`inputSchema` | 模型什麼時候用哪個工具、參數怎麼填 | 執行期由 server 回傳，程式碼與套件版本不變也能改（見 [Tool Poisoning 與 rug pull](#/skill/tool-poisoning)） |
| Skill／prompt 檔 | repo 裡的 agent 指示檔（例如 `AGENTS.md`、`CLAUDE.md`）、Skill 資料夾、共用的系統提示 | agent 的工作流程、優先順序、可以做與不可以做的事 | 它們是文字檔，SBOM 只列軟體元件；程式碼審查容易把它們當成文件略過 |
| 模型與設定 | 模型名稱與版本、別名、溫度、可用工具清單、核准模式 | 同樣的輸入得到不同的決定 | 通常寫在設定或環境變數裡，不在任何清單上；別名可能被供應商改指向 |

行為層有兩個特性讓它更難管：

1. **變更不需要發布**：遠端 server 改一段字串、模型別名換一個目標，都不經過任何版本號。
2. **影響是語意的**：一段文字是否「危險」，不是靜態分析能回答的；要靠人讀，或至少靠規則篩出來給人讀。

## 治理：五件事

### 1. 內部登錄與上架審查

建一份**內部登錄**（registry），列出允許使用的 MCP server、Skill、模型。每一筆至少記錄：

- 名稱、來源（套件名稱或網址）、負責人
- 鎖定的版本或 digest；遠端 server 記錄網址與已核准的工具描述指紋
- 授予的權限：能用的憑證、檔案範圍、網路出口
- 審查日期與審查者

上架前審查：讀過程式碼或確認來源可信、讀過**完整**工具描述、確認權限是最小範圍、確認它的 log 會進集中式稽核。

### 2. 來源與版本鎖定

- 本機 server：鎖套件版本與完整性雜湊，從內部鏡像安裝；不用 `@latest`、不用沒有版本的 `npx -y`。
- 遠端 server：鎖定網址，並鎖定**工具描述的指紋**（名稱 + 描述 + schema 的雜湊）。指紋變了就停用並要求重新審查。
- 模型：設定裡寫明確的模型版本，不用會被改指向的別名；換版本當成一次變更走審查流程。

### 3. 描述與 prompt 的稽核與差異比對

- agent 指示檔、Skill、共用系統提示放在版控，改動走 PR，並在 CODEOWNERS 指定專人審查——和 CI 設定同等級。
- 工具描述每次載入都和登錄的指紋比對；變更時保留舊版與新版全文，產生差異給審查者看。
- 差異審查時注意：新增的指令性語句、提到其他工具、要求附帶額外資料、要求不告知使用者。

### 4. 影子 MCP server 的發現（MCP09）

沒有登錄的 server 是最大的盲點（見 [OWASP MCP Top 10](#/skill/owasp-mcp-top10) 的 MCP09）。發現方式：

- 掃描開發機與 CI runner 上的 MCP 設定檔，與登錄比對。
- 掃描內網開放的 MCP 端點。
- 讓下游系統只接受來自 gateway 的連線；不經 gateway 的 server 拿不到憑證，自然也就沒用。

### 5. 使用遙測與稽核紀錄（MCP08）

- 每次工具呼叫記錄使用者、工作階段、server、工具、描述指紋、參數摘要、結果。
- 定期報表：哪些 server 被用、哪些登錄了卻沒人用（該下架）、哪些工具第一次被呼叫。
- 告警：出現未登錄的 server、描述指紋不符、呼叫量異常。log 設計見 [可觀測性](#/skill/observability)。

## 實際程式：盤點與登錄比對

下面這段 JavaScript 模擬一次盤點：從三位成員的 MCP 設定與 repo 的指示檔收集現況，和內部登錄比對，產生待處理清單。

```js run
// 內部登錄：核准過的行為層依賴
const registry = {
  servers: {
    'github':        { version: '2.3.1', owner: 'platform' },
    'internal-docs': { url: 'https://docs-mcp.internal.example/mcp', descFingerprint: 'a1f3', owner: 'docs' },
  },
  prompts: { 'AGENTS.md': { fingerprint: '7c20', reviewedBy: 'alice' } },
  models:  { allowed: ['model-x-2026-05-01'] },
}

// 盤點收集到的現況（實務上由腳本掃描各機器的設定檔與 repo）
const inventory = [
  { host: 'dev-amy',   server: 'github',        version: '2.3.1' },
  { host: 'dev-ben',   server: 'github',        version: 'latest' },
  { host: 'dev-ben',   server: 'fs-everything', version: '0.1.0' },
  { host: 'ci-runner', server: 'internal-docs', url: 'https://docs-mcp.internal.example/mcp', descFingerprint: 'b9e4' },
]
const promptFiles = [{ path: 'AGENTS.md', fingerprint: '91d0', lastCommitReviewedBy: null }]
const modelConfig = [{ host: 'ci-runner', model: 'model-x-latest' }]

const todo = []
for (const i of inventory) {
  const reg = registry.servers[i.server]
  if (!reg) { todo.push(['MCP09', i.host, `${i.server} 未登錄（影子 server）→ 下架或送審`]); continue }
  if (reg.version && i.version !== reg.version) todo.push(['MCP04', i.host, `${i.server} 版本 ${i.version}，登錄的是 ${reg.version} → 鎖版本`])
  if (reg.url && i.url !== reg.url) todo.push(['MCP04', i.host, `${i.server} 網址與登錄不符`])
  if (reg.descFingerprint && i.descFingerprint !== reg.descFingerprint)
    todo.push(['MCP03', i.host, `${i.server} 工具描述指紋 ${i.descFingerprint} ≠ ${reg.descFingerprint} → 停用並審查差異`])
}
for (const p of promptFiles) {
  const reg = registry.prompts[p.path]
  if (!reg) todo.push(['行為層', 'repo', `${p.path} 未登錄`])
  else if (p.fingerprint !== reg.fingerprint && !p.lastCommitReviewedBy)
    todo.push(['行為層', 'repo', `${p.path} 內容已變更且最後一次修改沒有指定審查者 → 補審`])
}
for (const m of modelConfig)
  if (!registry.models.allowed.includes(m.model)) todo.push(['行為層', m.host, `模型 ${m.model} 不在允許清單（別名會被改指向）→ 改用固定版本`])

// 登錄了卻沒人用的 server：該考慮下架，減少攻擊面
const used = new Set(inventory.map((i) => i.server))
for (const name of Object.keys(registry.servers)) if (!used.has(name)) todo.push(['盤點', '-', `${name} 已登錄但沒有使用`])

for (const [tag, where, msg] of todo) console.log(tag.padEnd(6), where.padEnd(10), msg)
console.log(`\n待處理 ${todo.length} 項`)
```

範例中的指紋用短字串代替，實務上是完整的 SHA-256（算法見 [Tool Poisoning 與 rug pull](#/skill/tool-poisoning) 的範例）。盤點腳本本身也要定期跑、結果要進稽核紀錄，否則一次盤點只代表那一天。

## 檢查清單

| # | 項目 | 怎麼做 | 頻率 | 對應 |
|---|---|---|---|---|
| 1 | 建立內部登錄 | 列出允許的 MCP server、Skill、模型，各有負責人與權限說明 | 一次建立，持續維護 | MCP09 |
| 2 | 上架審查 | 讀完整工具描述與 schema、確認來源、確認最小權限、確認有 log | 每次新增 | MCP03、MCP02 |
| 3 | 本機 server 鎖版本 | 版本號＋完整性雜湊，從內部鏡像安裝，禁止 `@latest` | 每次新增或升級 | MCP04 |
| 4 | 遠端 server 鎖描述指紋 | 存名稱＋描述＋schema 的 SHA-256，載入時比對 | 每次載入 | MCP03 |
| 5 | 描述變更流程 | 指紋不符即停用，產生新舊全文差異，人工核准後更新登錄 | 每次變更 | MCP03 |
| 6 | 指示檔與 Skill 進版控 | 改動走 PR，CODEOWNERS 指定審查者 | 每次修改 | 行為層 |
| 7 | 模型版本固定 | 設定裡寫完整版本，換版走變更審查 | 每次換版 | 行為層 |
| 8 | 憑證最小範圍 | 每個 server 獨立憑證、短效、有範圍（見 [credential 隔離](#/skill/agent-credential-isolation)） | 上架時＋每季盤點 | MCP01、MCP02 |
| 9 | 影子 server 掃描 | 掃描開發機與 CI 的 MCP 設定、掃描內網端點，與登錄比對 | 每週 | MCP09 |
| 10 | 統一出入口 | 下游只接受經 gateway 的連線，未登錄的 server 拿不到憑證 | 架構層一次設定 | MCP09、MCP07 |
| 11 | 工具呼叫稽核 | 每次呼叫記錄使用者、server、工具、描述指紋、參數摘要、結果 | 持續 | MCP08 |
| 12 | 使用報表與下架 | 列出沒人用的 server 與權限，收回 | 每月 | MCP02 |
| 13 | 告警 | 未登錄 server、指紋不符、首次呼叫的工具、呼叫量異常 | 持續 | MCP08 |

清單的順序就是建議的導入順序：先有登錄（1），才有東西可以比對（3–5、9）；先有稽核（11），出事時才查得到。變更審查的流程可以沿用 [變更管理](#/skill/change-management) 的做法。

## 常見錯誤

| 錯誤做法 | 會發生什麼 | 修正 |
|---|---|---|
| 認為「SBOM 全綠＝供應鏈沒問題」 | 行為層的變更完全沒被看見 | SBOM 管程式層；行為層另外用登錄、指紋、差異比對 |
| 把 agent 指示檔當一般文件、審查時略過 | 一段文字就能改變 agent 在每個 PR 的行為 | 指示檔和 CI 設定同等級，指定專人審查 |
| 遠端 MCP server 只登錄網址 | 網址不變、描述改了，登錄形同虛設 | 同時登錄描述指紋 |
| 用模型別名（例如 `-latest`） | 供應商改指向時，行為改變但沒有任何變更紀錄 | 寫完整版本，換版是一次可追溯的變更 |
| 禁止使用未登錄 server，但沒有任何發現機制 | 政策只存在文件裡 | 定期掃描設定檔與端點；下游只接受 gateway 的連線 |
| 只登錄、從不下架 | 沒人用的 server 和它的權限一直在 | 依使用報表定期下架與收回權限 |

## 動手

1. 執行上面的盤點程式，逐項修正 `inventory`、`promptFiles`、`modelConfig`，讓待處理清單歸零。
2. 在 `inventory` 加一筆 `{ host: 'dev-amy', server: 'github', version: '2.4.0' }`，思考它該被當成「升級送審」還是「直接拒絕」，並把你的決定寫進程式。
3. 列出自己環境裡所有的行為層依賴：MCP server、指示檔、Skill、模型設定，照「行為層的依賴」那張表分類，找出哪些目前沒有任何管理。
4. 從檢查清單的第 1、6、11 項開始導入，再回頭讀 [OWASP MCP Top 10](#/skill/owasp-mcp-top10) 檢查還缺哪些項目。

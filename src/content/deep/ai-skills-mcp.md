## 從一個具體問題開始：兩種「agent 不會」

一個團隊讓 agent 處理日常開發，很快遇到兩種不一樣的「它不會」：

1. **它不知道我們怎麼做事**。寫資料庫 migration 時，團隊規定檔名要有日期、每個 migration 都要能回滾、要附一個驗證資料的測試。agent 每次都照網路上常見的寫法來，於是每個人都在對話開頭貼一大段說明，貼的版本還各不相同。
2. **它碰不到我們的系統**。修 bug 要先看工單系統裡的重現步驟，agent 連不上工單系統，只能由人把內容複製貼上。有人為了省事寫了一個腳本，把工單系統的 API token 直接寫在提示詞裡讓 agent 用 curl 呼叫。

第一種缺的是**知識**：怎麼做。第二種缺的是**能力**：能做什麼。前者對應 **Skill**，後者對應 **MCP**。

## Skill：模型依需要載入的工作說明書

Skill 是一份可以重複使用的工作說明書。以 Claude 的 Agent Skills 為例，一個 Skill 是一個資料夾：

```text
db-migration/
├── SKILL.md            # 主檔：開頭是名稱與描述，接著是步驟與規則
├── template.py         # 範本：agent 需要時才讀
└── scripts/
    └── check_down.py   # 腳本：agent 可以執行
```

`SKILL.md` 長這樣：

```markdown
---
name: db-migration
description: 撰寫或修改資料庫 migration 時使用。包含檔名規則、回滾要求與驗證測試的寫法。
---

# 撰寫 migration

1. 檔名：`YYYYMMDD_HHMM_<動作>.py`，例如 `20261020_0930_add_cancelled_at.py`。
2. 每個 migration 都要有 downgrade，並且執行 `scripts/check_down.py` 確認可以回滾。
3. 新增 NOT NULL 欄位時分兩步：先加可為 NULL 的欄位並回填，下一個 migration 再加約束。
4. 附一個測試：升級後抽查 3 筆舊資料，確認值沒有被改動。

範本見 template.py。
```

關鍵在**依需要載入**：

- agent 啟動時，脈絡裡只放每個 Skill 的**名稱與描述**，一個 Skill 只佔一兩行。
- 任務跟某個 Skill 的描述相符時（例如「幫 appointments 加一個欄位」），才把 `SKILL.md` 的全文讀進來。
- 全文提到的範本、參考文件、腳本，用到時才讀或執行。

所以可以準備很多 Skill 而不會塞爆脈絡。也因此**描述要寫清楚「做什麼、什麼時候用」**：描述太模糊，該載入時不會載入；描述太寬（「寫程式時使用」），每個任務都載入。

Skill 不只是文字。它可以附帶腳本，agent 會以自己的權限執行這些腳本。這一點在之後談供應鏈時很重要。不同產品對 Skill 的格式與載入方式各有實作，上面描述的是共通的概念，細節以所用產品的文件為準。

## MCP：讓 AI 應用連接工具與資料的開放協定

**MCP（Model Context Protocol）**是一個開放協定，規定 AI 應用怎麼跟外部的工具與資料來源溝通。寫一次 MCP server，支援 MCP 的應用都能使用它。

### 角色與訊息

```text
┌──────────── Host（AI 應用，例如 IDE 或聊天程式）────────────┐
│                                                              │
│   模型  <──>  MCP client ──┐      MCP client ──┐             │
│                            │                   │             │
└────────────────────────────┼───────────────────┼─────────────┘
                             │ stdio             │ HTTP
                             ▼                   ▼
                      MCP server（本機）    MCP server（遠端）
                       工單系統的工具         文件搜尋
```

- **Host**：使用者操作的 AI 應用。
- **Client**：host 裡面負責跟某一個 server 連線的元件，一個 server 一條連線。
- **Server**：提供能力的程式。

訊息格式是 **JSON-RPC 2.0**。連線一開始有初始化步驟，雙方交換支援的協定版本與能力，之後才開始呼叫。

### Server 提供的三種東西

| 種類 | 是什麼 | 由誰決定使用 | 例子 |
|---|---|---|---|
| **Tools** | 可以呼叫的動作，有名稱、描述、參數的 JSON Schema | 模型依任務決定呼叫（應用可以要求使用者確認） | `get_ticket(ticket_id)`、`create_branch(name)` |
| **Resources** | 可以讀取的資料，用 URI 識別 | 應用決定要不要放進脈絡 | 一份設計文件、一張資料表的 schema |
| **Prompts** | 提示樣板，可以帶參數 | 使用者選用（例如在介面上當成指令） | 「依這個工單寫修復計畫」 |

另外，規格也定義了 client 端可以提供給 server 的能力（例如讓 server 請 client 代為呼叫模型）。這部分在不同規格版本間有增減，用到時以規格為準。

一次工具呼叫在線路上的樣子（省略了初始化）：

```json
{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}

{"jsonrpc": "2.0", "id": 1, "result": {"tools": [{
  "name": "get_ticket",
  "description": "依工單編號取得標題、狀態與重現步驟",
  "inputSchema": {"type": "object", "properties": {"ticket_id": {"type": "string"}}, "required": ["ticket_id"]}
}]}}

{"jsonrpc": "2.0", "id": 2, "method": "tools/call",
 "params": {"name": "get_ticket", "arguments": {"ticket_id": "BUG-142"}}}

{"jsonrpc": "2.0", "id": 2, "result": {
  "content": [{"type": "text", "text": "BUG-142 取消掛號後名額沒有釋出（狀態：open）"}],
  "isError": false}}
```

注意 `description`：它會被放進模型的脈絡，模型依它決定要不要呼叫、怎麼填參數。工具描述等於是給模型讀的指令，這是 [Tool Poisoning](#/skill/tool-poisoning) 的起點。

### 兩種傳輸方式

- **stdio**：client 在本機把 server 當子程序啟動，透過標準輸入輸出交換訊息。設定裡寫的是「要執行的指令」。適合存取本機檔案、本機工具；只有啟動它的使用者能用。
- **HTTP**：server 是一個網路服務，client 透過 HTTP 連線（目前規格稱為 Streamable HTTP；較早的版本用 HTTP 加 SSE）。設定裡寫的是 URL。適合多人共用、集中維運，但必須處理授權——誰可以呼叫、拿什麼 token，見 [MCP 的授權](#/skill/mcp-authorization)。

協定仍在演進，傳輸與授權的細節在不同版本間有變動；實作時對照 server 與 client 支援的規格版本。

### 用官方 Python SDK 寫一個 server

下面用官方 Python SDK（`mcp` 套件）的寫法示意。它需要安裝套件，不能在瀏覽器裡執行：

```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("tickets")


@mcp.tool()
def get_ticket(ticket_id: str) -> str:
    """依工單編號取得標題、狀態與重現步驟"""
    # 這裡呼叫工單系統的 API；token 從 OS keyring 或 gateway 取得，不寫在程式裡
    ...


if __name__ == "__main__":
    mcp.run()   # 預設用 stdio
```

函式的 docstring 會成為工具描述，型別提示會成為參數的 JSON Schema。

### 協定在做什麼：一個極簡的分派器

下面這段不是完整的 MCP 實作（沒有初始化、沒有傳輸層），只示範 server 收到 JSON-RPC 訊息後怎麼回應，包括兩種不同的錯誤。可以直接執行：

```python run
import json

# 這個 server 提供的工具：名稱 → (描述, 必填參數, 實作)
TICKETS = {"BUG-142": "取消掛號後名額沒有釋出（狀態：open）"}
TOOLS = {
    "get_ticket": ("依工單編號取得標題、狀態與重現步驟", ["ticket_id"], lambda a: TICKETS[a["ticket_id"]]),
}


def handle(message: str) -> str:
    req = json.loads(message)
    rid, method, params = req.get("id"), req["method"], req.get("params", {})
    if method == "tools/list":
        tools = [{"name": n, "description": d, "inputSchema": {"type": "object", "required": r}}
                 for n, (d, r, _) in TOOLS.items()]
        return json.dumps({"jsonrpc": "2.0", "id": rid, "result": {"tools": tools}}, ensure_ascii=False)
    if method == "tools/call":
        name, args = params.get("name"), params.get("arguments", {})
        if name not in TOOLS:
            # 協定層的錯誤：工具不存在 → JSON-RPC error
            return json.dumps({"jsonrpc": "2.0", "id": rid, "error": {"code": -32602, "message": f"Unknown tool: {name}"}})
        _, required, impl = TOOLS[name]
        try:
            text = impl(args)
            return json.dumps({"jsonrpc": "2.0", "id": rid, "result": {"content": [{"type": "text", "text": text}], "isError": False}}, ensure_ascii=False)
        except KeyError as e:
            # 工具執行失敗 → 正常回應，但 isError: true，讓模型看得到錯誤內容並調整
            return json.dumps({"jsonrpc": "2.0", "id": rid, "result": {"content": [{"type": "text", "text": f"找不到工單 {e}"}], "isError": True}}, ensure_ascii=False)
    return json.dumps({"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": "Method not found"}})


for msg in [
    {"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
    {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "get_ticket", "arguments": {"ticket_id": "BUG-142"}}},
    {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "get_ticket", "arguments": {"ticket_id": "BUG-999"}}},
    {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "delete_ticket", "arguments": {}}},
]:
    print("→", json.dumps(msg, ensure_ascii=False))
    print("←", handle(json.dumps(msg)), "\n")
```

兩種錯誤的差別：工具不存在是**協定層**的錯誤（JSON-RPC `error`）；工具存在但執行失敗，回傳的是正常結果加上 `isError: true`，錯誤內容會進到模型的脈絡，模型可以據此換個參數重試。

## 分工：什麼時候用哪一個

| 需求 | 用什麼 | 理由 |
|---|---|---|
| 團隊寫 migration、寫 commit 訊息、做 code review 的規則 | Skill | 是「怎麼做」的知識，不需要連外部系統 |
| 查工單、開分支、查監控指標 | MCP tool | 要存取外部系統，需要憑證與 API |
| 讓 agent 讀到內部 API 文件 | MCP resource 或 Skill 附帶的參考文件 | 文件常變動且很大時用 resource；穩定的短文件可以放在 Skill 裡 |
| 「修 bug 的標準流程」 | Skill，裡面指示使用 MCP tool | Skill 寫流程：先用 `get_ticket` 讀重現步驟、先寫失敗的測試、再修 |
| 一個只有一個人用、在本機跑的小腳本 | 不一定需要兩者 | 直接讓 agent 執行腳本也可以；要分享給團隊時再包成 Skill 或 MCP server |

兩者可以組合：Skill 告訴模型「這種任務的步驟是什麼、該用哪些工具」，MCP 提供那些工具。專案根目錄的規範檔（例如 `CLAUDE.md` 或 `AGENTS.md`）則是每次都會載入的那一份，放專案層級、每個任務都需要知道的規則；只在某類任務才需要的，就移到 Skill。

## 治理：內部分享平台與 MCP 上架

Skill 和 MCP server 好用之後，很快會有人想分享：做一個內部 Skill 平台、開放各團隊上架 MCP server。這時要先回答一組治理問題：

- **誰能上架**：任何人？只有平台團隊？需要一位負責維護的人嗎？
- **誰審核、審什麼**：Skill 的說明與附帶腳本；MCP server 的每個工具描述、要求的權限、連到哪些系統。
- **版本怎麼管**：使用者拿到的是鎖定的版本，還是永遠最新？改版後誰重新審核？
- **憑證放哪裡**：stdio server 的 token 常被寫在設定檔或環境變數裡（見 [CLI 與 Agent 的 token 存哪裡](#/skill/cli-token-storage)）；遠端 server 要有授權機制。
- **誰在用、怎麼撤下**：發現某一版有問題時，能不能列出受影響的人並一次撤下。

兩者的風險不在同一個量級。Skill 是說明書加上腳本，問題通常出在腳本與誘導性的說明；MCP server 握著下游系統的憑證、會真的執行動作，上架等於把這些能力交給每一個 agent。

本領域後面幾課會逐一展開：[MCP 的授權](#/skill/mcp-authorization)、集中管理憑證與上架的 [MCP Gateway](#/skill/mcp-gateway)、工具描述被動手腳的 [Tool Poisoning 與 rug pull](#/skill/tool-poisoning)、把 Skill 與 MCP 當成依賴管理的[行為層的供應鏈管理](#/skill/agent-supply-chain)，以及整體的風險清單 [OWASP MCP Top 10](#/skill/owasp-mcp-top10)。

## 常見錯誤

| 狀況 | 後果 | 修法 |
|---|---|---|
| stdio server 把 log 印到 stdout | stdout 是協定通道，log 混進 JSON-RPC 訊息，client 解析失敗或連線中斷 | log 一律寫到 stderr |
| 把 API token 寫在 Skill 或提示詞裡 | token 進入模型脈絡、對話紀錄，也跟著 Skill 被分享出去 | token 由 MCP server 從 keyring 或 gateway 取得，模型永遠看不到 |
| Skill 的描述寫得太模糊 | 該載入時沒載入，或每個任務都載入 | 描述寫「做什麼 + 什麼時候用」，用幾個實際任務測試會不會觸發 |
| 一個 MCP server 塞幾十個工具 | 工具描述佔滿脈絡，模型容易選錯工具 | 依用途拆成幾個 server；不常用的工具不要預設啟用 |
| 把團隊做法寫成 MCP tool | 規則藏在程式裡，改規則要改程式、重新部署 | 「怎麼做」放 Skill，MCP 只提供能力 |
| 從網路直接安裝沒人審過的 MCP server | 組織不知道它存在、不知道它拿了什麼權限（OWASP MCP09 Shadow MCP Servers） | 只從內部清單安裝；新的 server 走上架審核 |
| 工具執行失敗卻回 JSON-RPC error | 模型看不到錯誤內容，無法調整參數重試 | 執行失敗用 `isError: true` 的結果回報 |

## 動手

1. 在 Playground 執行上面的分派器，加一個工具 `list_open_tickets`（不需要參數，回傳所有 open 的工單），再送一個 `tools/list` 確認它出現。
2. 送一個缺少 `ticket_id` 的 `tools/call`，看它走到哪一種錯誤；想想應該在哪裡先驗證必填參數。
3. 為團隊的一個慣例（例如 commit 訊息格式）寫一份 `SKILL.md`：描述寫清楚什麼時候用，內文寫步驟與一個範例。
4. 列出一個內部 MCP server 上架前要回答的問題，接著讀 [MCP Gateway](#/skill/mcp-gateway) 比對還漏了什麼。

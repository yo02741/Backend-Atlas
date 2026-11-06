## 從一個具體問題開始：一張安全審查單填不下去

團隊做了一個內部客服 agent：員工在網頁上提問，系統先從知識庫檢索相關文件，交給模型回答；模型也能呼叫工具查訂單、建立工單。上線前資安團隊送來慣用的審查表：「有沒有做 SQL injection 防護？有沒有做 XSS 防護？登入有沒有 MFA？」

這些都做了，表格全部打勾。但審查表沒問到的事情才是這類系統最常出事的地方：知識庫裡的一份文件夾帶了指示，模型照做了；模型決定呼叫「建立工單」時沒有人確認；回答裡帶出了另一個部門才看得到的文件內容；有人寫了一個腳本一分鐘問三百次，月底帳單翻倍。

傳統審查表是照「元件」列的：Web 前端、API、資料庫。LLM 應用的風險多半出在**元件之間的資料怎麼流動**——尤其是「資料」在某一段變成了「指令」。威脅建模就是把資料流畫出來，逐段問「這一段會出什麼事、控制放在哪」。

## 運作原理：先畫資料流

一個典型的 LLM 應用，資料流長這樣：

```text
 [使用者輸入] ──▶ [檢索] ──▶ [模型] ──▶ [工具] ──▶ [下游系統]
       │            ▲          │  ▲        │
       │            │          │  └────────┘ 工具結果回到模型
       └────────────┼──────────┘
                    │          │
               [知識庫]        ▼
                            [輸出] ──▶ 使用者畫面 / 其他系統
```

畫的時候標出三件事：

1. **信任邊界**：資料從哪裡跨進來。使用者輸入、知識庫裡的外部文件、工具回傳的網頁內容，都是**不可信**的資料，即使它們看起來是系統內部的東西。
2. **每一段的方向**：資料從哪裡到哪裡。風險通常依附在「邊」上，不是節點上。
3. **哪些段落會讓資料變成動作**：模型 → 工具、輸出 → 下游。這兩段一旦被誤導，後果不只是答錯，而是真的做了事。

LLM 應用和傳統應用最大的不同是：**模型分不清 context 裡哪些是指令、哪些是資料**。所有進入 context 的東西——系統提示、使用者問題、檢索到的文件、工具結果——對模型來說都是一串文字。所以每一段把外部資料送進模型的邊，都要假設那份資料可能夾帶指示。

## 逐段對照：OWASP Top 10 for LLM Applications 2025

OWASP GenAI Security Project 的 Top 10 for LLM Applications（2025 版）列了十類風險。下面把它們對到資料流的各段：

| 資料流的段落 | 主要風險（OWASP 2025） | 這一段要問的問題 |
|---|---|---|
| 使用者輸入 → 模型 | LLM01 Prompt Injection、LLM10 Unbounded Consumption | 使用者的輸入會不會改變系統原本的指示？有沒有長度、頻率與費用上限？ |
| 知識庫 → 檢索 → 模型 | LLM01 Prompt Injection（間接）、LLM04 Data and Model Poisoning、LLM08 Vector and Embedding Weaknesses、LLM02 Sensitive Information Disclosure | 文件從哪裡來、誰審過？檢索有沒有依使用者權限過濾？ |
| 系統提示 | LLM07 System Prompt Leakage | 系統提示裡有沒有放秘密或權限邏輯？（不該放，提示可能被帶出） |
| 模型 → 工具 | LLM06 Excessive Agency、LLM05 Improper Output Handling | 工具權限是否最小？寫入類動作有沒有人確認？參數有沒有驗證？ |
| 工具結果 → 模型 | LLM01 Prompt Injection（間接）、LLM10 Unbounded Consumption | 工具回傳的內容會不會夾帶指示？大小有沒有上限？ |
| 模型 → 輸出 → 下游 | LLM05 Improper Output Handling、LLM02 Sensitive Information Disclosure、LLM09 Misinformation | 輸出會不會被當成 HTML、SQL、指令執行？有沒有帶出秘密或個資？使用者會不會把錯誤答案當事實？ |
| 模型、套件、外掛的來源 | LLM03 Supply Chain | 用的模型、套件、MCP server 從哪來、有沒有固定版本與驗證？ |

幾個常被誤解的項目：

- **LLM05 Improper Output Handling** 講的是「下游把模型輸出當成可信資料」：輸出直接放進網頁變成 XSS、直接拼成 SQL 變成 injection。防法和傳統注入一樣（見 [#/skill/injection](#/skill/injection)）：模型輸出就是不可信輸入，照樣編碼、參數化。
- **LLM06 Excessive Agency** 講的是「給 agent 的權限、功能或自主性超過任務需要」。這是 agent 系統最需要優先處理的一項，因為它決定了其他風險發生時的**損害範圍**。
- **LLM07 System Prompt Leakage** 的重點不是「系統提示被看到」本身，而是「把不該放在提示裡的東西放進去」：API key、內部網址、「這個使用者是管理員所以可以……」這類權限判斷。權限要在程式裡檢查，不是在提示裡宣告。

工具層與 MCP 的風險有專門的清單，見 [#/skill/owasp-mcp-top10](#/skill/owasp-mcp-top10)；知識庫下毒見 [#/skill/knowledge-poisoning](#/skill/knowledge-poisoning)。

## 用 MITRE ATLAS 看攻擊者的進程

OWASP 清單是從「系統有什麼弱點」的角度列；MITRE ATLAS 是從「攻擊者會經過哪些階段」的角度整理，架構仿照 ATT&CK，把 AI 系統相關的手法歸到不同的戰術（tactics）之下。威脅建模時只需要用高層次的戰術名稱，檢查每個階段有沒有對應的偵測或阻擋：

| 戰術（高層次） | 在 LLM 應用裡的意思 | 對應的防禦面 |
|---|---|---|
| Reconnaissance（偵察） | 了解系統用了什麼模型、有哪些工具 | 不在錯誤訊息與回應裡暴露內部細節 |
| Initial Access（初始存取） | 透過使用者輸入或外部文件把內容送進 context | 輸入與檢索層的過濾、來源分級 |
| Execution（執行） | 讓模型呼叫工具做事 | 工具白名單、參數驗證、人工核准 |
| Persistence（持續） | 讓影響延續到之後的對話，例如寫進記憶或知識庫 | 記憶與知識庫的寫入審查（見 [#/skill/agent-memory](#/skill/agent-memory)） |
| Privilege Escalation（提權） | 讓 agent 做出超過使用者權限的事 | 工具用使用者的身分與權限執行，不用共用的高權限帳號 |
| Collection、Exfiltration（蒐集、外洩） | 讓回應或工具把資料帶出去 | 檢索層權限、輸出遮罩、對外連線限制 |
| Impact（衝擊） | 錯誤的動作、服務中斷、費用失控 | 預算上限、寫入類動作的確認與稽核 |

ATLAS 的戰術清單與名稱會更新（例如部分戰術名稱從「ML」改成「AI」），引用時以官方網站目前的版本為準。

## STRIDE 對照

傳統的 STRIDE 仍然好用，可以用來確認沒漏掉某一類：

| STRIDE | 在 LLM 應用裡 | 控制 |
|---|---|---|
| Spoofing（偽冒） | 文件或工具結果裡的內容冒充系統指示；agent 冒用高權限身分 | 指令與資料分開標示；工具用使用者自己的 token |
| Tampering（竄改） | 知識庫被下毒、工具描述被替換、模型輸出被當成指令 | 寫入審查、工具描述指紋、輸出編碼 |
| Repudiation（否認） | 無法證明某個動作是誰、根據什麼做的 | 稽核紀錄：誰問的、檢索了什麼、呼叫了哪個工具、誰核准 |
| Information disclosure（資訊外洩） | 檢索出無權限的文件、回應帶出秘密或個資 | 檢索層權限過濾、輸出遮罩、日誌去識別化（見 [#/skill/logs-pii](#/skill/logs-pii)） |
| Denial of service（阻斷服務） | 超長輸入、無限工具迴圈、費用耗盡 | 輸入長度、步數與 token 預算、rate limit（見 [#/skill/agent-loop](#/skill/agent-loop)） |
| Elevation of privilege（提權） | agent 的工具權限大於使用者 | 最小權限、寫入類工具人工核准 |

## 控制放哪一層

控制不能只放在一個地方，因為**模型本身不是可靠的安全邊界**：提示詞寫「不要洩漏機密」可以降低機率，但不能保證。控制要放在模型**之外**、程式能強制執行的位置：

| 層 | 控制 | 擋什麼 |
|---|---|---|
| 輸入 | 長度上限、頻率限制、明顯異常輸入的偵測、使用者身分驗證 | 資源耗盡、部分直接注入 |
| 檢索 | 依使用者權限過濾文件（在查詢條件裡，不是在提示裡）、來源分級、檢索內容標示為資料 | 資訊外洩、間接注入、下毒 |
| 模型 | 系統提示與使用者內容分開、系統提示不放秘密 | 降低注入成功率（不能單靠這層） |
| 工具 | 白名單、參數 schema 驗證、最小權限的 credential、寫入類動作人工核准、結果大小上限 | 過度代理、提權、損害範圍 |
| 輸出 | 依用途編碼（HTML、SQL、shell）、秘密與個資遮罩、附來源 | 不當輸出處理、外洩、錯誤資訊 |
| 紀錄 | 每次請求的檢索結果、工具呼叫、核准紀錄、費用 | 事後追查、否認、偵測異常 |

排優先順序時，先處理**損害範圍**：工具權限縮到最小、寫入類動作加上確認。注入不可能百分之百擋住，但只要 agent 能做的事有限、做之前要人點頭，被誤導時的後果就有上限。

## 實際程式：把資料流配上規則，自動列出缺的控制

下面把一個資料流寫成節點與邊的清單，每個節點標出已經有的控制；再用一組「哪一種邊該有哪些控制」的規則，逐段列出還缺什麼，並附上對應的 OWASP 項目與 STRIDE 類別。規則是範例，實際使用時依團隊的標準調整：

```python run
# 資料流 = 節點（型別 + 已有的控制）與邊。規則依「邊的兩端型別」列出該有的控制，
# 程式把缺的找出來。只做防禦面的檢查，不碰任何攻擊內容。
NODES = {
    "web":       {"type": "user_input",  "controls": ["input_length_limit", "rate_limit"]},
    "retriever": {"type": "retrieval",   "controls": ["doc_acl_filter"]},
    "llm":       {"type": "model",       "controls": ["system_prompt_separation"]},
    "tools":     {"type": "tool",        "controls": ["tool_allowlist"]},
    "answer":    {"type": "output",      "controls": []},
    "ticketdb":  {"type": "downstream",  "controls": []},
}
EDGES = [("web", "retriever"), ("web", "llm"), ("retriever", "llm"), ("llm", "tools"),
         ("tools", "llm"), ("llm", "answer"), ("tools", "ticketdb")]

# 每條規則：這一段資料流該有的控制、對應的 OWASP Top 10 for LLM Applications（2025）項目、STRIDE 類別
RULES = {
    ("user_input", "model"):     [("input_length_limit", "LLM10 Unbounded Consumption", "D"),
                                  ("rate_limit", "LLM10 Unbounded Consumption", "D"),
                                  ("system_prompt_separation", "LLM01 Prompt Injection", "T")],
    ("user_input", "retrieval"): [("query_sanitize", "LLM08 Vector and Embedding Weaknesses", "T")],
    ("retrieval", "model"):      [("doc_acl_filter", "LLM02 Sensitive Information Disclosure", "I"),
                                  ("source_labeling", "LLM01 Prompt Injection（間接）", "T"),
                                  ("ingest_review", "LLM04 Data and Model Poisoning", "T")],
    ("model", "tool"):           [("tool_allowlist", "LLM06 Excessive Agency", "E"),
                                  ("arg_schema_validation", "LLM05 Improper Output Handling", "T"),
                                  ("human_approval_for_writes", "LLM06 Excessive Agency", "E"),
                                  ("audit_log", "LLM06 Excessive Agency", "R")],
    ("tool", "model"):           [("result_size_cap", "LLM10 Unbounded Consumption", "D"),
                                  ("result_as_data_marker", "LLM01 Prompt Injection（間接）", "T")],
    ("model", "output"):         [("output_encoding", "LLM05 Improper Output Handling", "T"),
                                  ("secret_redaction", "LLM02 Sensitive Information Disclosure", "I"),
                                  ("citation_required", "LLM09 Misinformation", "R")],
    ("tool", "downstream"):      [("least_privilege_credential", "LLM06 Excessive Agency", "E"),
                                  ("audit_log", "LLM06 Excessive Agency", "R")],
}
STRIDE = {"S": "Spoofing", "T": "Tampering", "R": "Repudiation", "I": "Information disclosure",
          "D": "Denial of service", "E": "Elevation of privilege"}


def threat_checklist(nodes, edges, rules=RULES):
    report = []
    for src, dst in edges:
        if src not in nodes or dst not in nodes:
            raise ValueError(f"邊 {src}->{dst} 用到不存在的節點")
        key = (nodes[src]["type"], nodes[dst]["type"])
        have = set(nodes[src]["controls"]) | set(nodes[dst]["controls"])
        missing = [(c, owasp, STRIDE[s]) for c, owasp, s in rules.get(key, []) if c not in have]
        report.append({"edge": f"{src} -> {dst}", "types": key, "missing": missing})
    return report


for item in threat_checklist(NODES, EDGES):
    s, d = item["types"]
    print(f"{item['edge']:<22} ({s} -> {d})")
    if not item["missing"]:
        print("    已有該段需要的控制")
    for control, owasp, stride in item["missing"]:
        print(f"    缺 {control:<28} {owasp:<45} STRIDE: {stride}")

total = sum(len(i["missing"]) for i in threat_checklist(NODES, EDGES))
print(f"\n共 {len(EDGES)} 段資料流，缺 {total} 項控制；先補「寫入類工具的人工核准」與「輸出遮罩」這兩項影響最大。")
```

這種檢查表的價值不在規則多完整，而在**每次資料流改變時都重跑一次**：新增一個工具、接上一個新的知識來源，都會多出新的邊，規則會自動提醒那一段該有的控制。可以放進 CI，資料流定義檔改動時就跑。

## 常見錯誤

**只做傳統審查表。** SQL injection、XSS、MFA 都要做，但 LLM 應用的主要風險在資料流的段落之間，表格要照資料流重新列。

**把模型當安全邊界。** 「系統提示裡寫了不要做」不是控制。權限檢查、核准、遮罩都要在程式裡強制執行。

**檢索不做權限過濾。** 所有文件放進同一個索引、所有人都檢索得到，再期待模型「不要說出來」。權限要在檢索的查詢條件裡。

**工具用一個共用的高權限帳號。** 任何使用者透過 agent 都能做到管理員能做的事。工具應該用發出請求的使用者自己的權限執行（見 [#/skill/agent-credential-isolation](#/skill/agent-credential-isolation)）。

**威脅模型做一次就封存。** 每加一個工具、一個資料來源、一個協定，資料流就變了。威脅模型要跟著資料流定義一起版控、一起審。

## 動手

- 在 Playground 開啟上面的程式，把 `tools` 節點的 controls 加上 `human_approval_for_writes` 與 `audit_log`，重跑看哪幾段的缺口消失。
- 為團隊現有的一個 LLM 功能畫出資料流，寫成同樣的節點與邊清單，跑一次看缺什麼。
- 程式題：實作 `threat_checklist(dataflow)`，處理控制在邊的任一端、沒有規則的邊、不存在的節點。

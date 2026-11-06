## 從一個具體問題開始：七個團隊、七把金鑰、一張帳單

公司裡有七個團隊各自接了模型 API：客服摘要、搜尋改寫、程式碼審查助理、文件問答……每個團隊自己到供應商後台申請金鑰，寫進各自的環境變數。半年後：

- **帳單一張，看不出誰花的**。供應商只給一個總額。財務問「客服那個功能一個月花多少」，沒有人答得出來，因為三個團隊共用同一把金鑰。
- **某個團隊的 agent 進入迴圈**，一個晚上把整個月的預算用掉三分之一。沒有任何東西擋它，隔天才從帳單看到。
- **供應商宣布某個模型版本退役**。要換模型得找出七個 repo 裡寫死的模型名稱、各自改、各自部署、各自確認行為沒變。
- **一把金鑰出現在前端的 bundle 裡**。要撤銷它，得先確認還有誰在用。
- **供應商 API 當機 40 分鐘**，七個功能同時掛掉。沒有一個地方可以說「這段時間先改送另一家」。
- **有人把含病歷的對話送進了模型**。誰送的、送了什麼，沒有紀錄可查。

這些問題的共同點和 [MCP Gateway](#/skill/mcp-gateway) 那一課一樣：**沒有一個集中的地方**管「誰能呼叫哪個模型、用了多少、金鑰在哪、出事時怎麼切換」。差別是方向：MCP Gateway 站在 agent 與工具之間，AI Gateway 站在應用程式與模型之間。

## 運作原理：gateway 在中間做哪些事

對應用程式而言，AI Gateway 是**唯一的模型端點**。應用程式帶著 gateway 發的虛擬金鑰、指定一個模型**別名**送出請求；gateway 依設定決定實際要送給哪個供應商的哪個模型，並在轉送前後做一串檢查與記錄。

```text
 應用程式 A ─┐                 ┌──────────────────── AI Gateway ─────────────────────┐
 應用程式 B ─┼─ 虛擬金鑰 ─────▶ │ 認金鑰 → 速率限制 → 配額 → 出口過濾 → 快取 → 路由 → 紀錄 │
 批次工作 C ─┘  + 模型別名      └──────────┬────────────────────┬──────────────────────┘
                                          │ 供應商金鑰（只在這裡） │
                                   ┌──────┴─────┐        ┌──────┴─────┐
                                   │ 供應商 A    │        │ 供應商 B    │   …
                                   └────────────┘        └────────────┘
```

| 步驟 | gateway 做什麼 | 失敗時回什麼 |
|---|---|---|
| 1. 認金鑰 | 虛擬金鑰對到團隊或專案，取出這個團隊的設定（能用哪些別名、額度、上限） | 401 |
| 2. 速率限制 | 以「團隊 × 時間窗」計數，例如每分鐘 N 次請求或 N 個 token | 429，帶 `Retry-After` |
| 3. 配額 | 這個月已花費的成本是否達到額度；接近額度時先告警 | 429 或 402 類的自訂碼，訊息說明是額度用完 |
| 4. 出口過濾 | 依規則掃請求內容：金鑰樣式、身分證字號、內部識別碼、被標為機密的字串。依政策遮罩或擋下 | 400，並記錄被擋的規則名稱（不記被擋的內容） |
| 5. 快取 | 相同的請求（模型、參數、內容的雜湊）在有效期內直接回上次結果 | 命中就不往下走 |
| 6. 路由與 fallback | 別名對到候選模型清單，依序嘗試；主要模型逾時、5xx 或 429 時改送下一個 | 全部失敗才回 503 |
| 7. 紀錄 | 團隊、別名、實際模型、是否 fallback、輸入與輸出 token、延遲、成本、trace id | 紀錄寫入失敗時仍回應，但要告警 |

### 虛擬金鑰與供應商金鑰

供應商發的金鑰只存在 gateway 的 secret 儲存。應用程式拿到的是 gateway 自己發的虛擬金鑰，它只對 gateway 有效、綁定一個團隊或專案，可以單獨撤銷、單獨設額度與到期日。一把虛擬金鑰外洩，撤銷它就好，供應商金鑰不用輪替、其他團隊不受影響。設計原則和 [金鑰的範圍與壽命](#/skill/key-scope-lifetime) 一樣：範圍、到期、稽核三件事都要有。

這也解決了「前端直接呼叫模型 API」的問題：瀏覽器裡的程式永遠不該持有任何一種模型金鑰，它應該呼叫自己的後端，後端再帶虛擬金鑰呼叫 gateway。

### 路由表與別名

應用程式請求裡寫的不是供應商的模型名稱，而是 gateway 定義的別名。路由表把別名對到一串候選：

| 別名 | 候選（依序） | 用途 |
|---|---|---|
| `default` | 供應商 A 的大模型 → 供應商 B 的大模型 | 一般對話與摘要 |
| `cheap` | 供應商 B 的小模型 → 供應商 A 的小模型 | 分類、改寫查詢這類量大但簡單的工作 |
| `code-review` | 固定一個模型，不設備援 | 評測只做過這一個模型，寧可失敗也不要換 |

好處是**換模型不用改應用程式**：模型退役、供應商調價、評測發現另一個模型更適合，都改路由表。代價是：別名後面的模型換了，行為也會跟著變。所以路由表的變更要和程式碼一樣走審查，換模型前要先過評測（見 [把 agent 當軟體交付](#/skill/agent-delivery)），回應裡也要標明**實際用到的模型**，紀錄裡才分得出「同一個別名、不同模型」的差異。

fallback 要注意三件事：

- **什麼錯誤才 fallback**：逾時、5xx、供應商的速率限制（429）適合；400（請求本身有問題）不適合，換一家一樣會錯。
- **備援模型的行為不一定相同**：沒有在備援模型上跑過評測的功能，寧可不設備援。
- **fallback 也要計入配額與紀錄**：備援模型可能比較貴，要看得到。

### 配額與速率限制

兩者回答不同的問題：

| | 速率限制 | 配額 |
|---|---|---|
| 單位 | 每分鐘（或每秒）的請求數或 token 數 | 一段期間（月、週）的總成本或總 token |
| 防的是 | 瞬間的流量尖峰、進入迴圈的 agent、供應商那一側的 429 | 預算超支 |
| 超過時 | 429 加 `Retry-After`，應用程式稍後重試 | 擋下直到期間重設或有人加額度 |
| 計數放哪 | 多個 gateway 實例共用的儲存（例如 Redis），不能放單一程序的記憶體 | 資料庫，每筆呼叫結束後累加 |

成本怎麼算：每個模型有「每百萬 token 的單價」（輸入與輸出通常不同），放在設定裡；gateway 用供應商回傳的 token 數乘單價。單價是會變的設定值，不是程式碼裡的常數。接近額度（例如 80%）時先通知團隊，不要等到擋下才知道。

### 出口過濾

請求送出 gateway 之後就進了供應商的系統。哪些資料不能出去，是資料政策的問題，gateway 是執行那條政策的地方：

- **金鑰與 token 樣式**：`sk-`、`Bearer`、JWT 的三段式樣式。這些出現在 prompt 裡幾乎都是意外（把整份設定檔貼進去）。
- **個資樣式**：身分證字號、信用卡號、電話、email。遮罩成佔位符還是整個擋下，依資料等級決定。
- **內部識別碼與機密標記**：專案代號、被標為機密的文件片段。這類規則要和內部的資料分類一致。

規則一定有漏網，所以它是最後一道，不是唯一一道：應用程式組 prompt 時就不該把整個使用者物件塞進去。紀錄回應全文時同樣適用 [日誌與稽核紀錄裡的個資](#/skill/logs-pii) 的規則。

### 快取

同一個模型、同樣參數、同樣內容的請求回上次的結果。對分類、改寫查詢這種重複率高的工作有用，對開放式對話幾乎沒用。快取鍵要包含模型與所有會影響輸出的參數（溫度、系統提示版本）。快取內容同樣是敏感資料。

### 紀錄

每一筆呼叫至少記：團隊、虛擬金鑰 id、別名、實際模型、是否 fallback、輸入與輸出 token、延遲、成本、狀態、trace id。這份紀錄是用量報表、成本歸戶、事故調查的來源。**prompt 與回應全文要不要存，是政策決定**：存了才能回放與除錯，但也等於把所有使用者輸入複製一份；多數團隊的做法是預設只存欄位，全文另開一個有存取控管、短保存期的儲存，或只對抽樣的一小部分存。欄位設計見 [LLM 應用的可觀測性](#/skill/llm-observability)。

## 和 MCP Gateway 的分工

兩個 gateway 都是「集中控制點」，但站的位置不同：

| | AI Gateway | MCP Gateway |
|---|---|---|
| 站在哪裡 | 應用程式 → 模型供應商 | agent（MCP client）→ MCP server（工具） |
| 管的呼叫 | 模型推論（chat、embedding） | 工具呼叫（`tools/list`、`tools/call`） |
| 集中保管的憑證 | 供應商的 API 金鑰 | 下游 MCP server 的憑證 |
| 發給使用者端的 | 虛擬金鑰（綁團隊） | 經 SSO 登入後的 token（綁使用者） |
| 授權的粒度 | 團隊能用哪些別名、額度多少 | 使用者或群組能用哪些工具 |
| 版本控制的對象 | 路由表：別名對到哪個模型 | 工具定義（名稱、描述、schema）的雜湊 |
| 主要風險 | 成本失控、金鑰外洩、資料出口 | Tool Poisoning、權限擴張、憑證外洩 |
| 紀錄的重點 | token、成本、延遲、模型 | 誰呼叫了哪個工具、參數摘要、結果 |

一個同時用模型與工具的 agent 兩邊都會經過：呼叫模型走 AI Gateway，執行工具走 MCP Gateway。兩者可以是同一個產品的兩個模組，也可以是兩套系統；兩邊的紀錄要共用 trace id，才串得起「這次模型呼叫觸發了哪些工具呼叫」。

產品大致有兩類定位：**專為 LLM 做的 proxy**（例如開源的 LiteLLM，重點是多供應商的統一介面、虛擬金鑰、用量追蹤），以及**既有 API gateway 加上 AI 插件**（例如 Kong 這類產品，沿用現有的流量治理）。雲端供應商也有各自的 AI gateway 服務。本課不講任何一個的設定方式。

## 代價

- **單點**。gateway 掛了，所有模型功能一起掛。要多實例、健康檢查，並事先決定降級方式（功能降級，不是繞過 gateway 直連）。
- **高價值目標**。所有供應商金鑰與 prompt 都經過它，權限、網路隔離、secret 管理要比任何應用程式嚴格。
- **多一跳延遲**。串流回應要逐段轉送，不能等整個回應收完。
- **別名讓變更隱形**。路由表變更要通知受影響的團隊，紀錄裡要看得到實際模型。

## 實際程式：模擬路由、配額與 fallback

下面用純 Python 模擬 gateway 的核心流程：虛擬金鑰對團隊、每分鐘速率限制、以成本計的月額度、一條簡單的出口過濾規則、依路由表嘗試並 fallback、逐筆紀錄。供應商用假函式代替，其中一個模型故意設成一直逾時。單價是任意單位的設定值。

```python run
import json

# 路由表：應用程式只看得到別名；別名對到哪個供應商的哪個模型由 gateway 決定
ROUTES = {
    "default": ["vendor-a/large-2026-05", "vendor-b/large-2026-03"],   # 第一個是主要，其後是備援
    "cheap":   ["vendor-b/small-2026-03", "vendor-a/small-2026-05"],
}
# 每百萬 token 的單價（任意單位）：是設定值，不是寫死在程式裡的常數
PRICE_PER_M = {
    "vendor-a/large-2026-05": {"in": 3.0, "out": 15.0},
    "vendor-b/large-2026-03": {"in": 2.5, "out": 10.0},
    "vendor-b/small-2026-03": {"in": 0.2, "out": 0.8},
    "vendor-a/small-2026-05": {"in": 0.3, "out": 1.2},
}
# 虛擬金鑰 → 團隊；供應商金鑰只在 gateway（這裡用假字串）
VIRTUAL_KEYS = {"vk_support_7f3a": "support", "vk_search_91c0": "search"}
PROVIDER_KEYS = {"vendor-a": "sk-a-…", "vendor-b": "sk-b-…"}
# 每團隊的月額度（成本單位）與每分鐘請求上限
TEAMS = {
    "support": {"budget": 1.00, "rpm": 3},
    "search":  {"budget": 0.05, "rpm": 60},
}
spent, calls_this_minute, LOG = {}, {}, []

# 模擬供應商：某個模型一直逾時，其餘回傳固定的 token 用量
DOWN = {"vendor-a/large-2026-05"}
def call_provider(model, prompt):
    if model in DOWN:
        raise TimeoutError(f"{model} timeout")
    return {"text": f"[{model}] 回答", "in_tokens": len(prompt) * 2, "out_tokens": 120}

def cost_of(model, usage):
    p = PRICE_PER_M[model]
    return (usage["in_tokens"] * p["in"] + usage["out_tokens"] * p["out"]) / 1_000_000

def gateway(virtual_key, alias, prompt, minute):
    team = VIRTUAL_KEYS.get(virtual_key)
    rec = {"team": team, "alias": alias, "minute": minute}
    def done(status, **extra):
        rec.update(status=status, **extra); LOG.append(rec); return rec
    if team is None:
        return done(401)
    # 1. 速率限制：以團隊 × 分鐘計數
    n = calls_this_minute.get((team, minute), 0) + 1
    calls_this_minute[(team, minute)] = n
    if n > TEAMS[team]["rpm"]:
        return done(429, reason="rate_limit", retry_after=60)
    # 2. 配額：已花費的成本達到月額度就擋
    if spent.get(team, 0.0) >= TEAMS[team]["budget"]:
        return done(429, reason="budget_exhausted")
    # 3. 出口過濾：示範只擋一種樣式，實務上是一組規則
    if "sk-" in prompt:
        return done(400, reason="secret_in_prompt")
    # 4. 路由 + fallback：依序嘗試，記錄實際用到的模型
    tried = []
    for model in ROUTES[alias]:
        vendor = model.split("/")[0]
        _provider_key = PROVIDER_KEYS[vendor]          # 供應商金鑰在這裡注入，應用程式從頭到尾沒看過
        try:
            usage = call_provider(model, prompt)
        except TimeoutError as e:
            tried.append(str(e)); continue
        cost = cost_of(model, usage)
        spent[team] = spent.get(team, 0.0) + cost
        return done(200, model=model, fallback=len(tried) > 0,
                    tokens=usage["in_tokens"] + usage["out_tokens"], cost=round(cost, 6))
    return done(503, reason="all_models_failed", tried=tried)

for i in range(5):                                             # support 每分鐘上限 3：第 4、5 次 429
    gateway("vk_support_7f3a", "default", "請摘要這段客訴內容", minute=0)
gateway("vk_search_91c0", "cheap", "改寫查詢：藍牙耳機 降噪", minute=0)
gateway("vk_search_91c0", "cheap", "x" * 130_000, minute=0)      # 一次超長的請求把 search 的小額度花掉
gateway("vk_search_91c0", "cheap", "再一次", minute=0)             # 額度用完 → 429
gateway("vk_support_7f3a", "cheap", "金鑰是 sk-a-123", minute=1)   # 出口過濾
gateway("vk_nobody", "default", "hi", minute=1)                   # 不認得的虛擬金鑰

for r in LOG:
    print(json.dumps(r, ensure_ascii=False))
print()
print("各團隊已花費：", {t: round(v, 4) for t, v in spent.items()})
```

讀輸出時注意幾件事：

- support 的前三次都成功，但 `model` 是 vendor-b、`fallback` 是 `true`：主要模型整段時間都在逾時，應用程式沒感覺，紀錄裡看得到。長時間都是 `fallback: true` 應該告警，因為成本與行為都已經不是當初評測過的那一組。
- 第 4、5 次是 429 `rate_limit`，帶 `retry_after`。應用程式收到 429 要照 `Retry-After` 等，不是立刻重試。
- search 的第二次呼叫花掉大部分額度，第三次被 `budget_exhausted` 擋下。配額是「下一次呼叫前檢查」，所以單次呼叫可以超過剩餘額度；要更嚴格就得在呼叫前估 token 數。
- 帶金鑰樣式的請求在出口過濾被擋下，不會送到任何供應商、也不計入配額。

真正的 gateway 還要處理串流回應、供應商之間請求與回應格式的轉換、速率限制與配額在多個實例之間的共用計數、以及 `tried` 這類錯誤細節該回多少給呼叫端。

## 常見錯誤

| 錯誤做法 | 會發生什麼 | 修正 |
|---|---|---|
| 所有團隊共用一把虛擬金鑰 | 用量歸不了戶，撤銷一把等於全部停 | 每團隊（或每專案）一把，各自額度與到期日 |
| 應用程式寫死供應商模型名稱並直連 | 退役、調價、當機時要改每個 repo | 只用 gateway 的別名；直連在網路層擋掉 |
| 路由表改模型沒有通知、沒有評測 | 功能行為悄悄變了，紀錄裡也看不出來 | 路由表走審查、換模型先跑評測、紀錄實際模型 |
| 任何錯誤都 fallback | 400 這類請求本身的錯誤在備援模型上重複失敗，還多花錢 | 只對逾時、5xx、供應商 429 做 fallback |
| 速率限制計數在單一實例記憶體 | 多實例各算各的，實際上限是 N 倍 | 共用儲存（Redis 等） |
| 單價寫死在程式碼 | 供應商調價後成本報表全錯 | 單價放設定，記錄當時用的單價版本 |
| 預設記錄 prompt 與回應全文 | 所有使用者輸入被複製到紀錄系統，含個資與金鑰 | 預設只記欄位；全文另存、有控管、短保存期 |

## 動手

1. 執行上面的模擬，把 `DOWN` 改成空集合，確認 support 的 `model` 變成 vendor-a、`fallback` 變成 `false`，再看成本怎麼變。
2. 在 [Playground](#/playground?lang=python) 把 `ROUTES` 加一個 `code-review` 別名，只有一個候選、不設備援，然後把那個模型放進 `DOWN`，確認回的是 503 而不是悄悄換模型。
3. 把配額檢查改成「呼叫前先用 `len(prompt) * 2` 估輸入 token、算預估成本，加上已花費超過額度就擋」，比較和現在「事後才擋」的差異。
4. 本課的程式題：實作帶配額與 fallback 的路由函式。接著讀 [LLM 應用的可觀測性](#/skill/llm-observability)，看 gateway 的紀錄欄位怎麼變成儀表板。

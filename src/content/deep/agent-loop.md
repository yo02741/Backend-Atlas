## 從一個具體問題開始：跑了四十分鐘、花了八百萬 token 的 agent

客服團隊做了一個查訂單的 agent：使用者問「我的訂單怎麼還沒到」，模型可以呼叫 `search_orders`、`get_order`、`get_shipment` 三個工具，查到之後回答。開發時測了十幾個問題都很順，上線第一週就收到帳單警報。

查 log 才看到發生了什麼：某位使用者輸入了一個不存在的訂單編號，`get_order` 回了錯誤，模型換個寫法再查一次，再錯，再換一個……同一段對話裡模型叫了三百多次工具，每一輪都把前面所有結果再送一遍，context 越滾越大，直到模型供應商那邊的 rate limit 把它擋下來。沒有人設步數上限，沒有人設 token 預算，工具失敗的處理方式是「交給模型決定」。

另一個常見狀況是反過來的：使用者關掉網頁，agent 繼續跑了二十分鐘，最後把結果送進一個已經沒人在看的 session。

這兩件事都不是模型的問題，是**迴圈**的問題。呼叫一次模型很簡單；把「呼叫模型、解析回應、執行工具、把結果放回去、決定要不要繼續」寫成一個有邊界、能中斷、能測試的迴圈，才是 agent 程式真正的本體。LangGraph、OpenAI Agents SDK 這類框架幫忙做的也就是這件事；知道裡面是什麼，才知道框架的哪個設定對應到哪個風險。

## 迴圈的每一步

一輪（一個 step）固定做這幾件事：

| 步驟 | 做什麼 | 會出什麼事 |
|---|---|---|
| 1. 組 context | 系統提示 + 工具定義 + 到目前為止的訊息（使用者、模型、工具結果） | context 只會變長；每一輪都重送全部內容 |
| 2. 呼叫模型 | 把 context 送出去 | 逾時、rate limit、模型回了一半 |
| 3. 解析回應 | 回的是純文字（可以結束）還是工具呼叫（要繼續） | 工具名稱不存在、參數不是合法 JSON、少欄位 |
| 4. 執行工具 | 依名稱找到函式、帶參數執行 | 工具丟例外、跑太久、回傳太大 |
| 5. 放回 context | 把工具結果（或錯誤）接在訊息後面 | 結果不帶 id 對不回去是哪個呼叫 |
| 6. 判斷停止 | 模型回純文字、超過預算、使用者中斷、連續失敗 | 沒有停止條件就是無限迴圈 |

幾個值得先記住的細節：

- **工具結果一律回到 context**，包括錯誤。模型只看得到 context，工具失敗如果只寫進 log 不放回去，模型就會以為工具沒反應而重試。
- **錯誤要有結構**，至少帶 `id`（對應哪一個呼叫）與 `error`（給模型讀的文字）。「KeyError: 'A9999'」比空字串有用得多，模型看到就知道該換編號還是放棄。
- **同一輪可以有多個工具呼叫**。模型一次回「查 A1001」與「查 A1002」兩個呼叫時，兩者互不相依，可以平行執行再一起放回去，省一輪模型呼叫。但有先後關係的（先查再退款）模型就會分兩輪送，迴圈不用也不該自己猜。

## 狀態機：把「現在在哪」寫成資料

迴圈好不好測，差別在於有沒有把狀態寫清楚。一個夠用的狀態集合：

| 狀態 | 意思 | 從這裡可以到 |
|---|---|---|
| `thinking` | 已送出 context，等模型回應 | `tool_call`、`done`、`failed`、`interrupted` |
| `tool_call` | 模型要求執行一或多個工具 | `tool_result`、`interrupted` |
| `tool_result` | 工具結果已放回 context，準備下一輪 | `thinking`（再問模型） |
| `done` | 模型回了最終文字 | 終點 |
| `failed` | 超過預算、連續錯誤達上限、模型回應無法解析 | 終點 |
| `interrupted` | 使用者或系統要求停止 | 終點，但留 checkpoint |

```text
          ┌──────────────────────────────────────────┐
          ▼                                          │
 ┌──────────┐  模型回工具呼叫  ┌───────────┐  執行完  ┌─────────────┐
 │ thinking │ ──────────────▶ │ tool_call │ ───────▶ │ tool_result │
 └──────────┘                 └───────────┘          └─────────────┘
   │      │
   │      └── 模型回純文字 ──▶ done
   └── 預算用完 / 無法解析 ──▶ failed          （任何狀態）── 收到中斷 ──▶ interrupted
```

寫成狀態機之後，三件事變簡單：

1. **每個轉移都能單獨測**。「`tool_call` 時工具丟例外，應該到 `tool_result` 而且結果裡有 error」是一個明確的測試；「agent 整體行為正確」不是。
2. **log 可以照狀態轉移印**。出事時看 `thinking -> tool_call [get_order]` 這種一行一轉移的紀錄，比看整段 context 快得多。
3. **預算與中斷有固定的檢查點**。在進入 `thinking` 前檢查預算，在每個狀態切換時檢查中斷旗標，不會漏掉。

## 預算、逾時、中斷與恢復

### 步數與 token

兩個上限都要有，因為它們擋的是不同的事：

- **步數上限**（例如 20 輪）擋「鬼打牆」：模型反覆呼叫同一個工具、或在兩個工具間來回。
- **token 預算**擋「越滾越大」：context 每一輪都重送，到第十輪時一次呼叫可能已經是幾萬 token。預算用累計值算，不是單輪。

超過任一個就轉到 `failed`，並把最後的 context 保存下來。給使用者的回應可以是「這個任務太複雜，已經停止；目前查到……」，而不是直接丟例外。

### 工具逾時

工具是外部系統，一定要有逾時。非同步程式用 `asyncio.wait_for(tool(**args), timeout=…)`；逾時當成一種工具錯誤放回 context，讓模型決定重試或放棄。逾時值依工具性質設定：查資料庫幾秒就夠，匯出報表可能要分鐘級，就不該放在同步迴圈裡，而是變成「送出工作、回傳工作編號」的兩段式工具。

另外要限制**結果大小**。工具回傳一份十萬行的 CSV 全部塞進 context，下一輪就爆預算。常見做法是截斷並註明「只顯示前 N 行，共 M 行」。

### 可中斷與可恢復

中斷有兩種來源：使用者取消、系統關機或部署。兩者都靠同一件事：**每一輪結束時把 context 存下來（checkpoint）**。context 本身就是迴圈的全部狀態——下一輪只需要它和預算的剩餘量。所以：

- 中斷時把狀態標成 `interrupted`，context 已經在 checkpoint 裡，不會丟。
- 恢復時從 checkpoint 載入 context，從 `thinking` 繼續。
- 剛好停在 `tool_call` 之後、`tool_result` 之前怎麼辦？工具可能已經執行（例如已經退款）。這正是工具要設計成**冪等**的理由：帶同一個呼叫 id 再執行一次，結果要一樣。做不到冪等的工具（送信、付款）在恢復時應該改成詢問使用者，而不是直接重跑。

### 工具呼叫格式錯誤

模型輸出的工具呼叫不保證合法：工具名拼錯、參數是字串不是物件、缺必填欄位。處理原則一致：**不要讓迴圈炸掉**，把錯誤變成 `tool_result` 放回去，模型通常下一輪就會修正。同時數一下「連續格式錯誤」次數，連續三次還錯就轉 `failed`——這代表模型對工具定義的理解有問題，繼續試只是燒錢。

## 實際程式：用假模型跑完整的迴圈

真的連模型沒辦法在瀏覽器裡跑，也不適合測試。下面用一個**腳本化的假模型**（依序回傳事先寫好的回應）跑三個情境：正常結束、各種錯誤後恢復、以及被步數上限攔下。每一次狀態轉移與預算消耗都印出來：

```python run
import json
from dataclasses import dataclass, field


class BudgetExceeded(Exception):
    pass


@dataclass
class Budget:
    max_steps: int = 6          # 模型最多被呼叫幾次
    max_tokens: int = 3000      # 粗估的累計 token
    tool_timeout_s: float = 2.0 # 單一工具最多跑多久
    steps: int = 0
    tokens: int = 0

    def charge(self, tokens: int) -> None:
        self.steps += 1
        self.tokens += tokens
        if self.steps > self.max_steps:
            raise BudgetExceeded(f"步數 {self.steps} 超過上限 {self.max_steps}")
        if self.tokens > self.max_tokens:
            raise BudgetExceeded(f"token {self.tokens} 超過上限 {self.max_tokens}")


class ScriptedModel:
    """假模型：依序回傳事先寫好的回應，用來測迴圈，不用真的連模型。"""

    def __init__(self, script):
        self.script = list(script)

    def __call__(self, messages):
        if not self.script:
            raise RuntimeError("腳本用完了")
        step = self.script.pop(0)
        if callable(step):          # 讓腳本可以依 messages 動態決定
            step = step(messages)
        # 粗估這一輪的 token：整個 context 的字元數 / 4
        return step, len(json.dumps(messages, ensure_ascii=False)) // 4


# ---- 工具：每個工具宣告自己「假裝」花多久，用來示範逾時 ----
ORDERS = {"A1001": {"status": "shipped", "amount": 1290}, "A1002": {"status": "paid", "amount": 450}}

def search_orders(customer: str):
    return {"took_s": 0.3, "result": sorted(ORDERS)}

def get_order(order_id: str):
    if order_id not in ORDERS:
        raise KeyError(f"沒有訂單 {order_id}")
    return {"took_s": 0.2, "result": ORDERS[order_id]}

def export_report(fmt: str):
    return {"took_s": 9.0, "result": "report.csv"}   # 一定會逾時

TOOLS = {"search_orders": search_orders, "get_order": get_order, "export_report": export_report}


def call_tool(call: dict, budget: Budget) -> dict:
    """執行一個工具呼叫；所有失敗都變成 tool_result 裡的 error，不讓例外炸出迴圈。"""
    name, args = call.get("name"), call.get("args")
    if name not in TOOLS:
        return {"id": call.get("id"), "error": f"未知的工具 {name!r}"}
    if not isinstance(args, dict):
        return {"id": call.get("id"), "error": "args 必須是 JSON 物件"}
    try:
        out = TOOLS[name](**args)
    except Exception as e:                     # 工具自己的錯誤
        return {"id": call.get("id"), "error": f"{type(e).__name__}: {e}"}
    if out["took_s"] > budget.tool_timeout_s:  # 這裡用假時間模擬；真實程式用 asyncio.wait_for
        return {"id": call.get("id"), "error": f"工具逾時（{out['took_s']}s > {budget.tool_timeout_s}s）"}
    return {"id": call.get("id"), "result": out["result"]}


def run_agent(model, task: str, budget: Budget, checkpoint: dict | None = None):
    """一個完整的迴圈。回傳 (final_state, context)；context 就是 checkpoint，可以拿來恢復。"""
    ctx = checkpoint or [{"role": "user", "content": task}]
    state = "thinking"
    while True:
        try:
            reply, used = model(ctx)
            budget.charge(used)
        except BudgetExceeded as e:
            print(f"  {state:>11} -> failed      ({e})")
            return "failed", ctx
        if reply["type"] == "text":
            print(f"  {state:>11} -> done        步數 {budget.steps}/{budget.max_steps}  token {budget.tokens}/{budget.max_tokens}")
            ctx.append({"role": "assistant", "content": reply["text"]})
            return "done", ctx
        # 工具呼叫：同一輪可以有多個，彼此獨立就可以平行執行
        calls = reply["calls"]
        names = ", ".join(str(c.get("name")) for c in calls)
        print(f"  {state:>11} -> tool_call   [{names}]  步數 {budget.steps}/{budget.max_steps}  token {budget.tokens}/{budget.max_tokens}")
        ctx.append({"role": "assistant", "tool_calls": calls})
        results = [call_tool(c, budget) for c in calls]
        for r in results:
            tag = "error" if "error" in r else "ok"
            print(f"    tool_call -> tool_result ({tag}) {r.get('error') or r.get('result')}")
        ctx.append({"role": "tool", "results": results})
        state = "tool_result"


print("=== 1. 正常結束：查詢 → 平行讀兩張訂單 → 回答 ===")
normal = ScriptedModel([
    {"type": "tool_calls", "calls": [{"id": "c1", "name": "search_orders", "args": {"customer": "u42"}}]},
    {"type": "tool_calls", "calls": [
        {"id": "c2", "name": "get_order", "args": {"order_id": "A1001"}},
        {"id": "c3", "name": "get_order", "args": {"order_id": "A1002"}},
    ]},
    {"type": "text", "text": "兩張訂單：A1001 已出貨、A1002 已付款。"},
])
print("結果:", run_agent(normal, "幫我看 u42 的訂單狀態", Budget())[0])

print("\n=== 2. 格式錯誤與工具失敗：錯誤回到 context，模型可以修正 ===")
recover = ScriptedModel([
    {"type": "tool_calls", "calls": [{"id": "c1", "name": "get_orders", "args": {"order_id": "A1001"}}]},   # 工具名打錯
    {"type": "tool_calls", "calls": [{"id": "c2", "name": "get_order", "args": "A1001"}]},                 # args 不是物件
    {"type": "tool_calls", "calls": [{"id": "c3", "name": "get_order", "args": {"order_id": "A9999"}}]},   # 工具本身報錯
    {"type": "tool_calls", "calls": [{"id": "c4", "name": "export_report", "args": {"fmt": "csv"}}]},      # 逾時
    {"type": "text", "text": "找不到 A9999，報表匯出逾時，先回報這兩點。"},
])
print("結果:", run_agent(recover, "匯出 A9999 的報表", Budget())[0])

print("\n=== 3. 模型鬼打牆：同一個工具一直叫，被步數上限攔下 ===")
looping = ScriptedModel([lambda ctx: {"type": "tool_calls", "calls": [{"id": "x", "name": "search_orders", "args": {"customer": "u42"}}]}] * 20)
state, ctx = run_agent(looping, "一直找", Budget(max_steps=4))
print("結果:", state, "｜checkpoint 裡有", len(ctx), "則訊息，可以帶著它換個策略重跑")
```

看輸出時注意三件事：

- 第 1 段的第二輪一次送出兩個 `get_order`，兩個結果一起回到 context，模型只被呼叫三次。
- 第 2 段四種錯誤（工具名錯、參數格式錯、工具報錯、逾時）都沒有讓迴圈中斷，模型最後仍正常結束。真實系統裡要再加「連續錯誤上限」。
- 第 3 段模型一直叫同一個工具，第五次呼叫前被預算擋下，狀態是 `failed`，而 `ctx` 就是 checkpoint——可以帶著它換個系統提示重跑。

`ScriptedModel` 這種假模型就是測試迴圈的主要工具：要測「超預算」就給一個永遠回工具呼叫的腳本，要測「工具失敗後恢復」就給一個先叫壞工具再回文字的腳本。模型本身的品質是另一個問題，分開測。

## 常見錯誤

**迴圈沒有停止條件，只靠模型「自己會停」。** 模型多數時候會停，少數時候不會；少數乘上流量就是帳單。步數與 token 上限是必要的，不是保險。

**工具失敗直接 raise 到最外層。** 一個 `KeyError` 讓整個對話結束，使用者看到 500。工具錯誤是正常流程的一部分，應該回到 context。

**用單輪 token 數當預算。** 單輪沒超但累計已經十倍。預算要用累計，而且要把工具結果的大小算進去。

**把 checkpoint 存在記憶體裡。** 程序重啟就沒了。checkpoint 要落到資料庫或物件儲存，key 用對話 id，恢復時能找回來。

**平行執行有相依性的工具。** 模型在同一輪回「查庫存」與「下單」，迴圈平行跑，下單先完成。多個工具呼叫可以平行的前提是彼此獨立；保守做法是只對標記為唯讀的工具平行，寫入類的工具一律依序。

**典型的錯誤訊息。** 工具呼叫參數不是 JSON 時會看到 `json.JSONDecodeError: Expecting value: line 1 column 1`；用 `**args` 展開參數、而 `args` 是字串時，會丟 `TypeError: ... argument after ** must be a mapping, not str`。兩者都該在執行工具前檢查，變成給模型看的錯誤訊息，而不是 traceback。

## 動手

- 把上面的程式在 Playground 開啟，把第 3 段的 `Budget(max_steps=4)` 改成 `Budget(max_tokens=200)`，看是哪一輪被 token 預算攔下。
- 在 `call_tool` 加「連續錯誤計數」：同一輪的結果全部是 error 達三次就回 `failed`，用第 2 段的腳本驗證。
- 程式題：實作 `run_agent(model, tools, max_steps)`，測試涵蓋正常結束、超預算、工具失敗、格式錯誤。
- 寫 agent 一定會碰到工具的授權與隔離：[#/skill/agent-credential-isolation](#/skill/agent-credential-isolation) 講工具層的 credential 不該進 context；[#/skill/ai-skills-mcp](#/skill/ai-skills-mcp) 講工具定義是怎麼透過 MCP 交給模型的。要記住跨 session 的事，看 [#/skill/agent-memory](#/skill/agent-memory)。

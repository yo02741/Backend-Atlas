## 從一個具體問題開始：自由文字轉欄位，偶爾逾時、偶爾不是 JSON

掛號系統的預約表單有一格「就診原因」，病患自己打字：「右膝蓋痛三天，走路會卡」。櫃檯要人工讀過再分科。團隊加了一個功能：後端把這段文字送給模型，請它轉成結構化欄位（建議科別、症狀持續天數、是否需要優先處理），存進資料庫，櫃檯畫面直接顯示。

開發環境測了五十筆都正常。上線兩週後陸續出現：

- **偶爾逾時**。預約 API 平常 200 ms 回應，接上模型後大多 2 秒，偶爾 40 秒。那 40 秒裡 worker 被佔住，尖峰時連不相關的查詢都變慢。
- **偶爾回的不是 JSON**。`json.loads` 丟出例外，預約整筆失敗。原文有三種：前面多了一句「好的，以下是結果：」、包在 markdown 的程式碼區塊裡、最後一個欄位寫到一半。
- **JSON 合法但內容不能用**。科別填了院內沒有的「復健科」，天數填了字串「三天」。
- **早上八點一開放掛號就收到 429**，持續十幾分鐘。
- **月底的用量是預估的兩倍多**。有一段重試寫在迴圈裡、沒有上限。

這五件事沒有一件是模型「答錯」，都是呼叫外部服務時該處理而沒處理的事。

## 把它當成一個慢、會失敗、按量計費的外部呼叫

模型 API 是一個 HTTP 端點。和一般的內部 API 相比，它有四個地方不一樣：

| | 一般內部 API | 模型 API |
|---|---|---|
| 延遲 | 毫秒級，變動小 | 秒級；輸出越長越久，同一個請求每次也不一樣 |
| 失敗方式 | 逾時、5xx | 逾時、5xx、過載、速率限制（429）、輸入太長、輸出被截斷、被內容政策擋下 |
| 輸出 | 格式由程式決定，每次相同 | 由模型產生，同樣的輸入不保證同樣的輸出，格式也不保證 |
| 成本 | 幾乎固定 | 每次呼叫按輸入與輸出的 token 計費，重試也算 |

前兩列的處理方式和任何外部呼叫相同，[逾時、重試與斷路器](#/skill/resilience) 的原則全部適用。後兩列是模型特有的：輸出要當成不可信輸入來驗證，每一次呼叫（含重試）都要記用量。

下面的片段用假想的介面 `client.generate(...)` 表示「送出請求、拿回回應」。各家 SDK 的方法、參數、回應欄位名稱都不同，以所用供應商的官方文件為準。

```python
# 虛擬碼：client.generate 是假想的介面，參數名稱只是示意
resp = client.generate(
    model="extract",                 # 經過 gateway 時填別名，不寫死供應商的模型名稱
    system="把就診原因轉成 JSON，欄位：department、duration_days、urgent",
    input=free_text,
    output_schema=SCHEMA,            # API 支援結構化輸出時，把 schema 交給它
    max_output_tokens=200,           # 輸出上限一定要設
    timeout=10,                      # 連線與讀取逾時
)
resp.text            # 模型產生的文字
resp.finish_reason   # 為什麼停：正常結束、撞到長度上限、要呼叫工具、被擋下
resp.usage           # 這次實際用掉的輸入與輸出 token 數
```

## 逾時、重試與 429

### 逾時

不設逾時的呼叫，在對方變慢時會把自己的 worker 一個一個佔滿。模型呼叫要設三種時間：

- **連線逾時**：幾秒內連不上就放棄。
- **讀取逾時**：非串流時，回應要等整段文字生成完才回來，所以這個值要涵蓋「合理的最長生成時間」；串流時改成看「兩個片段之間最多等多久」，可以設得短很多。
- **整體期限**：含重試在內，這個功能最多願意等多久。使用者在表單前等不了 40 秒，超過期限就降級，不要繼續重試。

這個功能還有更根本的做法：不放在預約請求的同步路徑上。預約先成立，轉欄位交給背景工作，結果出來再更新櫃檯畫面。

### 哪些錯誤可以重試

| 狀況 | 重試？ | 說明 |
|---|---|---|
| 連線失敗、連線逾時 | 可以 | 請求沒送到 |
| 讀取逾時 | 可以，但可能已經被計費 | 對方可能已經生成完，只是回應沒回來 |
| 429 | 可以，照 `Retry-After` 等 | 立刻重試只會更快再被擋 |
| 5xx、供應商回報過載 | 可以，退避後再試 | 通常是暫時的 |
| 400：請求格式錯、輸入超過長度上限 | 不要 | 同一個請求再送幾次結果都一樣；要先改請求 |
| 401、403 | 不要 | 金鑰或權限問題，要人處理 |
| 被內容政策擋下 | 不要原樣重試 | 換成降級流程 |
| 回應拿到了，但驗證沒過 | 可以，次數要很少 | 輸出不是確定的，再試一次可能就對；每次都計費 |

兩件容易漏掉的事：

- **重試要冪等**。單純產生文字沒有副作用，重試只是多花錢。但「模型回應 → 寫入資料庫」若包在同一個重試區塊裡，重試就可能寫入兩筆；寫入要用冪等鍵或唯一約束擋住。有副作用的工具呼叫也一樣。
- **只在一層重試**。SDK 可能內建重試，gateway 可能也有，自己又包一層，三層各 3 次就是 27 次。查清楚每一層的預設值，只留一層。

退避與抖動的算法和 resilience 那一課相同：每次等待加倍、設上限、乘上亂數打散同時失敗的請求。

### 速率限制

供應商的速率限制通常不只算請求數，也算 token 數；一個帶了長文件的請求可能一次就用掉大半額度。收到 429 時：

- 回應帶 `Retry-After` 就照它等，沒有就用退避。
- **在自己這一側先限流**：限制同時送出的請求數，超過的排隊。讓請求在自己的佇列裡等，比送出去被擋再重試便宜。
- **線上流量和批次工作分開**。批次用掉額度，掛號功能就會被擋；用不同的金鑰或配額隔開，這是 [AI Gateway](#/skill/ai-gateway) 的工作。不需要即時結果的工作，可以看供應商有沒有批次介面。

## 串流

### 用串流的理由

模型是一個 token 一個 token 產生輸出的。非串流時，整段生成完才回傳；串流時，產生多少就先送多少。**總時間沒有變短**，改變的是：

- 使用者在第一個片段到達時就看到東西，對話介面的等待感差很多。
- 讀取逾時可以改成「片段之間的間隔」，對方卡住時幾秒就能發現，不用等滿整段生成時間。

結構化輸出、背景工作這類「拿到完整結果才有用」的呼叫，只剩第二項好處。

### 串流在線路上的樣子

多數模型 API 的串流用 Server-Sent Events 的格式：一個不會馬上結束的 HTTP 回應（`text/event-stream`），伺服器把事件一個一個寫出來，以空行分隔。SSE 的細節見 [即時更新怎麼選](#/skill/realtime-choice)。事件大致分三種（名稱與欄位各家不同，以下為示意）：

```text
event: start
data: {}

event: delta
data: {"text": "右膝"}

event: delta
data: {"text": "疼痛三天"}

event: end
data: {"finish_reason": "stop", "usage": {"input_tokens": 180, "output_tokens": 24}}
```

後端如果要把片段轉給瀏覽器，自己對瀏覽器也要開一條串流，而且中間每一層 proxy 都不能緩衝，否則片段會被攢成一整包才送出。

### 串到一半斷線

串流中途可能斷：網路、proxy 的閒置逾時、供應商那一側的錯誤。這時手上只有前半段。

- **不完整的輸出不能當成結果**。半截 JSON 無法解析；半截的文字可能剛好停在「不」字之前。判斷標準是有沒有收到結束事件、結束原因是不是正常結束。
- **一般沒有辦法從斷點接著收**。重試就是重新生成、重新計費，內容也不會和上次一樣。有沒有續傳機制，要看所用 API 的文件。
- **使用者離開時要取消上游的請求**。瀏覽器關掉分頁後，後端若繼續收，token 可能照樣產生。關閉連線後供應商是否停止生成與計費，依各家而定，要查文件並實測。

### 串流時怎麼計量

實際的 token 用量通常在串流的最後才給（有些 API 要另外要求才會附）。所以：

- 正常結束時，從結束事件讀用量。
- 中途斷線時拿不到，只能自己估，並在紀錄裡標成估計值，事後和帳單對帳。
- 延遲要記兩個數字：第一個片段的時間與總時間。欄位設計見 [LLM 應用的可觀測性](#/skill/llm-observability)。

## 結構化輸出：要求 schema，回來一定要驗證

讓模型輸出 JSON 有三種做法，保證程度不同：

| 做法 | 能得到什麼 | 得不到什麼 |
|---|---|---|
| 只在 prompt 裡寫「請輸出 JSON」 | 大多數時候是 JSON | 沒有任何保證；前後多一句話、包在程式碼區塊裡都會發生 |
| API 的 JSON 模式或結構化輸出功能（把 schema 交給 API） | 依供應商而定：有的保證語法合法，有的保證符合 schema | 語意正確；輸出被截斷時仍可能不完整 |
| 把欄位定義成一個工具的參數，要求模型呼叫它 | 參數通常符合宣告的 schema | 同上 |

API 支援時就用第二或第三種，但**不管用哪一種，拿回來都要自己驗證**：

- 輸出撞到長度上限時是被截斷的，再強的保證也擋不住半截 JSON。先看結束原因。
- 模型可能拒絕回答，回來的是一段說明文字。
- schema 管不到的規則：科別必須是院內實際有的科、天數不能是負數、日期不能在未來。
- 模型或供應商的行為會隨版本改變，今天沒問題不代表下個月沒問題。

驗證的寫法和 [輸入驗證](#/skill/input-validation) 那一課一樣：在邊界一次驗完，轉成可信任的物件再往下傳；列舉值用允許清單；多出來的欄位丟掉。差別只在來源從「使用者」換成「模型」。

驗證失敗之後有兩條路：

- **重試**：把哪裡不對附在 prompt 後面再呼叫一次。次數設很小（一到兩次），每次都計費。
- **降級**：欄位留空並標記「待人工確認」，櫃檯照原本的方式讀原文。在醫療情境，寧可留空也不要用猜的值填進去。

## 工具呼叫的回合

工具呼叫讓模型能要求後端做事，例如查某位醫師的門診時段。一個回合是：

```text
後端 → 模型：對話 + 可用工具的清單（名稱、說明、參數 schema）
模型 → 後端：我要呼叫 find_slots，參數 {"department": "骨科", "date": "2026-11-20"}
後端：驗證參數 → 檢查權限 → 執行 find_slots → 得到結果
後端 → 模型：原本的對話 + 模型的呼叫要求 + 工具結果
模型 → 後端：最後的文字回答（或再要求一次工具）
```

三個原則：

- **模型只提出要求，執行的是後端**。能不能執行，以登入的使用者的權限判斷，不以模型的說法判斷。參數是模型的輸出，照 schema 驗證後才用。
- **工具結果是不可信輸入**。查回來的資料可能含有別人寫的文字（備註欄、網頁、文件），裡面可能藏著給模型的指示，而它會跟著對話送回模型。所以要限制大小、標明來源，寫入類的工具另設確認。分析方法見 [AI 應用的威脅建模](#/skill/ai-threat-modeling)。
- **每多一輪就多一次完整的呼叫**。前面的內容全部重送，逾時與用量要以整個回合來算，並設輪數上限。迴圈的寫法見 [Agent 的執行迴圈](#/skill/agent-loop)。

## 長度上限、用量與金鑰

**輸入有上限**。超過模型的 context 長度，請求直接被拒絕，重試沒有用。送出前先估長度，超過就截短；截哪裡要事先決定（保留系統指示與最新的內容，舊對話或過長的文件先摘要或捨棄）。

**輸出也要設上限**。不設的話，一次失控的生成會又慢又貴。撞到上限時結束原因會標示出來，這時的輸出是截斷的。

**每次呼叫都記用量**：功能名稱、模型、輸入與輸出 token、延遲、第幾次嘗試、結束原因、是否降級。用供應商回傳的 token 數，不自己估（斷線時例外）。重試的用量也要看得到，開頭「用量是預估的兩倍多」這樣才查得出來。成本的算法與分攤見 [FinOps](#/skill/finops)。

**金鑰不放前端**。瀏覽器或 App 裡的程式拿得到的金鑰，使用者也拿得到。前端呼叫自己的後端，後端再呼叫模型；團隊多了以後，後端也不直接持有供應商金鑰，而是經過 [AI Gateway](#/skill/ai-gateway)。

**送出去之前想清楚資料**。就診原因是病患寫的自由文字，裡面可能有姓名、電話、病史。原則：

- 只送這個功能需要的內容。轉欄位不需要病歷號與姓名，就不要把整個預約物件送出去。
- 供應商怎麼保存請求內容、保存多久、會不會用於訓練，依契約與設定而定，由法遵確認。
- 依規定不能離開機構的資料，要改用 [地端模型](#/skill/self-hosted-models) 或不做這個功能。
- prompt 與回應全文不直接寫進日誌，規則見 [日誌與稽核紀錄裡的個資](#/skill/logs-pii)。

## 實際程式：逾時、退避、驗證與降級

下面用一個照腳本演出的假 client 示範呼叫的包裝：可重試的錯誤退避後再試、回應一律驗證、驗證沒過把錯誤附回去重試、次數用完回降級結果，並累計每一次的用量。等待只累計秒數，不真的暫停。

```python run
import json

# ── 假的 client：照腳本回傳或丟例外。真的 SDK 的類別、方法與參數名稱各家不同，以官方文件為準 ──
class Timeout(Exception):
    pass

class ApiError(Exception):
    def __init__(self, status, retry_after=None):
        super().__init__(f"HTTP {status}")
        self.status, self.retry_after = status, retry_after

class FakeClient:
    def __init__(self, script):
        self.script = list(script)

    def generate(self, prompt, timeout, max_output_tokens):
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        text, tokens_in, tokens_out, finish = step
        return {"text": text, "finish_reason": finish,
                "usage": {"input_tokens": tokens_in, "output_tokens": tokens_out}}

# ── schema：欄位 → (型別, 額外檢查)。科別用允許清單，不讓模型自己發明 ──
DEPARTMENTS = {"家醫科", "骨科", "皮膚科", "耳鼻喉科"}
SCHEMA = {
    "department": (str, lambda v: v in DEPARTMENTS),
    "duration_days": (int, lambda v: 0 <= v <= 3650),
    "urgent": (bool, lambda v: True),
}

def validate(text):
    """回傳 (資料, 錯誤說明)。模型的輸出是不可信輸入，和使用者送來的 JSON 一樣要驗。"""
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        return None, f"不是合法的 JSON：{e.msg}"
    if not isinstance(data, dict):
        return None, "最外層不是物件"
    for field, (typ, check) in SCHEMA.items():
        if field not in data:
            return None, f"缺少欄位 {field}"
        if type(data[field]) is not typ:          # 用 type() is：True 不能冒充 int
            return None, f"{field} 的型別不是 {typ.__name__}"
        if not check(data[field]):
            return None, f"{field} 的值不在允許範圍：{data[field]!r}"
    return {k: data[k] for k in SCHEMA}, None      # 多出來的欄位丟掉

def retryable(err):
    if isinstance(err, Timeout):
        return True
    return isinstance(err, ApiError) and (err.status == 429 or 500 <= err.status <= 599)

FALLBACK = {"department": None, "duration_days": None, "urgent": None, "needs_review": True}

def extract(client, free_text, max_attempts=4, base=0.5, cap=8.0):
    usage = {"input_tokens": 0, "output_tokens": 0}
    waited, prompt = 0.0, f"把這段就診原因轉成 JSON：{free_text}"
    for attempt in range(1, max_attempts + 1):
        delay = min(cap, base * 2 ** (attempt - 1))   # 實際使用時再乘上亂數（抖動）
        try:
            resp = client.generate(prompt, timeout=10, max_output_tokens=200)
        except (Timeout, ApiError) as e:
            if not retryable(e):
                print(f"  第 {attempt} 次：{e}，不可重試 → 降級")
                break
            if getattr(e, "retry_after", None):
                delay = e.retry_after                 # 對方說了要等多久，就照它等
            print(f"  第 {attempt} 次：{type(e).__name__} {e}，等 {delay:g} 秒")
            waited += delay                           # 示範用：只累計，不真的 sleep
            continue
        for k in usage:                               # 驗證沒過的回應一樣要計費
            usage[k] += resp["usage"][k]
        data, problem = validate(resp["text"])
        if resp["finish_reason"] == "length":
            problem = "輸出撞到長度上限，內容被截斷"
        if problem is None:
            print(f"  第 {attempt} 次：通過驗證")
            return {"data": data, "attempts": attempt, "waited": waited, "usage": usage}
        print(f"  第 {attempt} 次：{problem} → 把錯誤附在 prompt 後面再試")
        prompt += f"\n上一次的輸出有問題（{problem}），只輸出符合 schema 的 JSON。"
    return {"data": dict(FALLBACK), "attempts": attempt, "waited": waited, "usage": usage}

GOOD = '{"department": "骨科", "duration_days": 3, "urgent": false}'
CASES = {
    "逾時一次後成功": [Timeout("讀取逾時"), (GOOD, 180, 24, "stop")],
    "429，然後回的不是純 JSON": [
        ApiError(429, retry_after=2),
        ("好的，以下是結果：" + GOOD, 180, 31, "stop"),
        (GOOD, 215, 24, "stop"),
    ],
    "科別不在清單、再來被截斷": [
        ('{"department": "復健科", "duration_days": 3, "urgent": false}', 180, 25, "stop"),
        ('{"department": "骨科", "duration_da', 214, 12, "length"),
        ('{"department": "骨科", "duration_days": "三天", "urgent": false}', 250, 26, "stop"),
        ('{"department": "骨科", "duration_days": 3, "urgent": 0}', 286, 24, "stop"),
    ],
    "400：請求本身有問題": [ApiError(400), (GOOD, 180, 24, "stop")],
}
for name, script in CASES.items():
    print(name)
    r = extract(FakeClient(script), "右膝蓋痛三天，走路會卡")
    print(f"  → 結果 {r['data']}")
    print(f"  → 嘗試 {r['attempts']} 次、等待 {r['waited']:g} 秒、"
          f"用量 輸入 {r['usage']['input_tokens']} / 輸出 {r['usage']['output_tokens']} token\n")
```

第三個案例：四次回應各有一種毛病，最後回的是降級結果，但輸入共 930 token，是成功一次的五倍多（每次重試都把錯誤說明接在 prompt 後面）。重試上限就是成本上限。

第二段示範把串流的片段組回完整訊息，以及中途斷線、撞到長度上限時怎麼判斷「這份輸出不能用」：

```python run
import json

# 假的串流：一個產生器，照順序吐出事件；break_after 指定收到第幾個事件後連線中斷。
# 事件的名稱與欄位各家 API 不同，這裡只保留共通的三種：開始、片段、結束。
def fake_stream(chunks, finish_reason="stop", usage=None, break_after=None):
    events = [{"type": "start"}]
    events += [{"type": "delta", "text": c} for c in chunks]
    events.append({"type": "end", "finish_reason": finish_reason, "usage": usage})
    for i, ev in enumerate(events):
        if break_after is not None and i >= break_after:
            raise ConnectionError("連線在串流途中中斷")
        yield ev

def consume(stream, prompt_tokens_estimate):
    """把片段組回完整訊息。回傳的 complete 為 False 時，text 只是半截，不能當成結果。"""
    parts, first_chunk_at = [], None
    result = {"complete": False, "finish_reason": None, "usage": None, "usage_estimated": False}
    try:
        for n, ev in enumerate(stream):
            if ev["type"] == "delta":
                if first_chunk_at is None:
                    first_chunk_at = n            # 真實程式在這裡記「第一個片段的時間」
                parts.append(ev["text"])          # 對話介面會在這裡把片段轉送給瀏覽器
            elif ev["type"] == "end":
                result.update(complete=ev["finish_reason"] == "stop",
                              finish_reason=ev["finish_reason"], usage=ev["usage"])
    except ConnectionError as e:
        result["finish_reason"] = f"中斷（{e}）"
    result["text"] = "".join(parts)
    if result["usage"] is None:
        # 用量通常在最後一個事件才給；沒收到就只能估，並標成估計值，事後和帳單對帳
        result["usage"] = {"input_tokens": prompt_tokens_estimate, "output_tokens": len(result["text"]) // 2}
        result["usage_estimated"] = True
    return result

CHUNKS = ['{"depart', 'ment": "骨科', '", "duration_', 'days": 3, "ur', 'gent": false}']
USAGE = {"input_tokens": 180, "output_tokens": 24}
CASES = {
    "正常結束": fake_stream(CHUNKS, usage=USAGE),
    "收到 3 個片段後斷線": fake_stream(CHUNKS, usage=USAGE, break_after=4),
    "撞到輸出長度上限": fake_stream(CHUNKS[:3], finish_reason="length", usage={"input_tokens": 180, "output_tokens": 12}),
}
for name, stream in CASES.items():
    r = consume(stream, prompt_tokens_estimate=180)
    print(name)
    print(f"  收到的文字：{r['text']}")
    print(f"  結束原因：{r['finish_reason']}；用量：{r['usage']}{'（估計）' if r['usage_estimated'] else ''}")
    if r["complete"]:
        print(f"  完整 → 交給驗證：{json.loads(r['text'])}")
    else:
        print("  不完整 → 結構化輸出整筆丟棄後重試；對話文字則保留已顯示的部分並標示「未完成」")
    print()
```

## 常見錯誤與錯誤訊息

| 訊息或現象 | 原因 | 處理 |
|---|---|---|
| `json.JSONDecodeError: Expecting value: line 1 column 1` | 輸出前面多了說明文字，或包在程式碼區塊裡 | 用 API 的結構化輸出功能；驗證失敗走重試或降級，不要讓例外直接變成 500 |
| `json.JSONDecodeError: Unterminated string` 或 `Expecting ',' delimiter` | 輸出被截斷：撞到輸出上限，或串流中途斷線 | 先檢查結束原因；調整輸出上限或縮短要求的內容 |
| 429，尖峰時段集中出現 | 超過供應商的請求數或 token 數限制 | 照 `Retry-After` 等；自己這一側限流排隊；線上與批次分開配額 |
| 400，訊息提到長度或 context | 輸入超過模型上限 | 不要重試；送出前估長度並截短 |
| 用量是預估的數倍 | 多層重試相乘、重試沒有上限、驗證失敗的重試沒算進預估 | 只留一層重試、設次數上限、紀錄每次嘗試的用量 |
| 回應欄位都對，但科別是院內沒有的 | 只驗了格式，沒驗值 | 列舉值用允許清單，在驗證階段擋下 |

## 動手

1. 執行第一段程式，把 `max_attempts` 改成 2，看第二、三個案例的結果與用量怎麼變。
2. 在 [Playground](#/playground?lang=python) 替 `extract` 加上整體期限：累計等待超過 5 秒就不再重試、直接降級。把第二個案例的 `retry_after` 改成 6 來驗證。
3. 把第二段的 `break_after` 改成 1（一個片段都還沒收到就斷線），看估計的用量是多少。
4. 做本課的程式題：實作 `call_structured`。接著讀 [AI Gateway](#/skill/ai-gateway)，看金鑰、配額與 fallback 怎麼移到集中的一層。

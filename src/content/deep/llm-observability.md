## 從一個具體問題開始：錯誤率 0%，使用者說「變笨了」

一個文件問答功能上線三個月，儀表板一直很漂亮：HTTP 5xx 比例 0.1%、平均延遲 1.6 秒、CPU 正常。這週客服轉來一串抱怨：「回答變得很長又答非所問」「以前問得到的東西現在說找不到」。

值班工程師打開能看的東西：

- **錯誤率沒變**。模型回了一段答錯的文字，HTTP 狀態碼照樣是 200。
- **平均延遲沒變多少**，但沒有人看 p95。後來才知道 p95 從 3 秒漲到 7 秒。
- **log 裡只有 `llm call ok`**。不知道那次用的是哪個 prompt 版本、哪個模型、輸入多少 token、有沒有呼叫檢索工具、回應是正常結束還是被長度上限截斷。
- **帳單在月底才到**，這個月比上個月多了 60%，但分不出是流量變多、還是每次呼叫變貴。

最後拼湊出原因：兩週前有人改了 prompt，把檢索到的文件從 3 段增加到 8 段（輸入 token 翻倍、延遲變長、成本上升），同時供應商的模型別名在那幾天指向了新版本（回答風格變長）。兩件事疊在一起，而紀錄裡沒有任何一個欄位能把它們分開。

傳統的 [可觀測性](#/skill/observability)（metrics、logs、traces）在這裡仍然成立，但 LLM 應用多了三個問題：**品質無法從狀態碼看出來**、**成本隨每次呼叫的內容變動**、**行為由 prompt 版本與模型版本決定**。要回答這些問題，每次呼叫要多記幾個欄位，儀表板要多幾張圖，品質要另外量。

## 運作原理：每次呼叫要記什麼

### 欄位

| 欄位 | 回答什麼問題 | 注意 |
|---|---|---|
| trace id | 這次模型呼叫屬於哪一個使用者請求？前後還發生了什麼？ | 和 HTTP 請求、檢索、工具呼叫共用同一個 trace |
| prompt 版本 | 是哪一版 prompt 產生的？新版是否變差？ | 版本來自 repo，見 [把 agent 當軟體交付](#/skill/agent-delivery) |
| 請求的模型與實際回應的模型 | 別名指向誰？有沒有 fallback？ | 兩個都記；供應商回應裡通常會帶實際模型版本 |
| 輸入 token、輸出 token | 為什麼變貴？為什麼變慢？ | 用供應商回傳的數字，不要自己估 |
| 總延遲、第一個 token 的時間 | 使用者等多久才看到東西？ | 串流回應時兩者差很多，都要記 |
| 成本 | 這次呼叫花多少？ | token 數乘以「每百萬 token 的單價」，單價放設定 |
| 結束原因 | 正常結束、撞到長度上限、被內容過濾擋下、還是要呼叫工具？ | 被截斷的回答常常就是「答一半」的抱怨來源 |
| 工具呼叫 | 呼叫了哪些工具、各花多久、成功或失敗 | agent 的延遲大多花在工具與多輪迴圈 |
| 功能或端點 | 這次呼叫是哪個產品功能發出的？ | 成本歸戶與比較用 |
| 評分與回饋 | 品質如何？ | 多數呼叫沒有，抽樣才有；可以事後補上 |

**沒有列在這裡的**：prompt 全文、回應全文、使用者輸入。它們是除錯時最想要的東西，也是最危險的東西，後面單獨講。

### OpenTelemetry 的 GenAI 語意慣例

OpenTelemetry 在它的 semantic conventions 裡有一套給生成式 AI 用的慣例，替「模型呼叫」這種 span 與相關 metrics 定好了屬性名稱：用了哪個模型、什麼操作、輸入輸出 token 數之類。好處和 HTTP 的語意慣例一樣：不同的框架、不同的供應商 SDK、不同的後端，用同一套欄位名，儀表板與查詢可以共用，換工具不用重做。

這套慣例在撰寫本課時仍在演進，屬性名稱與穩定程度可能隨版本改變。實作時以 [OpenTelemetry 官方文件](https://opentelemetry.io/docs/specs/semconv/gen-ai/) 當下的版本為準，不要從其他文章或記憶裡抄屬性名稱。對應用程式來說，實際做法通常是：

- 用框架或 SDK 現成的 instrumentation 產生 span（如果有、而且遵循這套慣例）。
- 慣例沒涵蓋的欄位（例如 prompt 版本、產品功能），用自己團隊的命名前綴加成自訂屬性，並寫進團隊的欄位文件裡。
- span 裡要不要放 prompt 與回應內容，慣例本身也把它當成需要特別選擇開啟的東西；預設不放。

專門做 LLM 可觀測性的平台（例如開源的 Langfuse）提供 trace 檢視、評分、prompt 版本管理等功能，有些也能接收 OpenTelemetry 格式的資料。和一般可觀測性一樣，自己用 log 加 metrics 做也可以，差別在要自己建多少介面。

### 一個請求的 trace

一個 agent 回答一個問題，trace 大致長這樣：

```text
trace 7c1e…                                          0 ms ─────────────── 6,900 ms
└─ POST /ask (docs-api)                              ███████████████████████████
   ├─ retrieve (向量檢索，回 8 段)                    ██
   ├─ chat large-2026-05  prompt=v3  in=4,210 out=380   ████████████
   │   └─ tool_call search_docs                                     ████
   └─ chat large-2026-05  prompt=v3  in=5,020 out=610                    █████████
```

一眼就能看出：兩輪模型呼叫、中間一次工具呼叫；第二輪的輸入 token 比第一輪多，因為工具結果被放回 context。延遲主要在兩次模型呼叫。沒有 trace，只有一行「總延遲 6.9 秒」的 log，看不出任何一件事。

## 品質：抽樣評分與回饋

錯誤率只告訴你「有沒有回應」，不告訴你「回應對不對」。品質要另外量，常見的來源有三種：

| 來源 | 做法 | 優點 | 缺點 |
|---|---|---|---|
| 人工評分 | 每天抽固定比例或固定數量，依評分標準打分 | 最可信 | 慢、貴、量少 |
| 模型評分 | 另一個模型依同一份評分標準打分 | 量大、即時 | 自己也會錯，要定期和人工評分比對一致率 |
| 使用者回饋 | 讚、倒讚、重新產生、複製回答、放棄對話 | 反映真實感受 | 稀疏、有偏差（不滿意的人比較會按） |

不管哪一種，**評分紀錄都要帶著 trace id、prompt 版本與實際模型**。這樣才能畫出「各 prompt 版本的通過率」，金絲雀上線時也才能比較新舊兩版（做法見 [把 agent 當軟體交付](#/skill/agent-delivery)）。抽樣比例要讓每個版本、每個主要功能每天都有足夠的樣本數；樣本太少時，通過率的差異可能只是隨機波動，報表上要同時顯示樣本數。

除了評分，有幾個便宜的代理指標可以全量計算：結束原因是「撞到長度上限」的比例、輸出無法通過 schema 驗證的比例、回答中「找不到相關資訊」這類固定句型的比例。它們不等於品質，但變化時值得去看抽樣。

## 成本

成本 = 輸入 token × 輸入單價 + 輸出 token × 輸出單價（單價以「每百萬 token」計，依模型不同）。看成本的方式：

- **每千次呼叫的成本**：排除流量變化的影響。流量不變、這個數字變大，就是每次呼叫變貴了。
- **各功能、各 prompt 版本的平均 token 數**：改 prompt 讓輸入多一倍，當天就看得到，不用等帳單。
- **快取命中率**：若有使用快取（模型端的 prompt caching 或 [AI Gateway](#/skill/ai-gateway) 的回應快取），命中率掉下來成本會跳上去。

單價是會變的設定值，供應商調價時要更新，並且記錄當時用的是哪一份單價，否則回頭看歷史成本會算錯。

## 儀表板：該有哪幾張圖

| 圖 | 內容 | 看什麼 |
|---|---|---|
| 呼叫量 | 每分鐘呼叫數，依功能分 | 流量是不是異常 |
| 延遲 | p50、p95（必要時 p99），依模型分；串流的另畫第一個 token 時間 | 尾端變慢、某個模型變慢 |
| 錯誤與結束原因 | 5xx、逾時、被過濾、長度截斷的比例 | 「答一半」「沒回應」 |
| token 用量 | 平均輸入與輸出 token，依 prompt 版本分 | 改 prompt 讓 context 膨脹 |
| 成本 | 每千次成本、每日總成本，依功能分 | 每次呼叫變貴還是量變多 |
| 品質 | 抽樣通過率與樣本數，依 prompt 版本與模型分；使用者倒讚比例 | 哪一版變差 |
| fallback 比例 | 實際模型和請求的模型不同的比例 | 主要模型是否長時間不可用 |
| 工具呼叫 | 每次請求的工具呼叫次數、工具的錯誤率與延遲 | agent 進入迴圈、某個工具拖慢整體 |

告警原則和一般服務一樣基於症狀（見 [可觀測性](#/skill/observability)）：p95 延遲超標、錯誤或截斷比例上升、每千次成本突然上升、抽樣通過率掉到門檻以下（樣本數足夠時）。

## 個資：prompt 與回應不能直接寫進 log

使用者輸入裡什麼都可能有：身分證字號、病歷、地址、貼進來的金鑰。檢索到的文件可能是機密。模型的回應常常會原樣複述輸入的內容。把 prompt 與回應全文寫進 log，等於把這些東西全部複製到可觀測性平台，而那裡的存取權限、保存期限、備份範圍通常比原始資料寬鬆得多。

做法：

- **預設只記欄位**：上面那張表的欄位，加上輸入與輸出的長度、雜湊（方便判斷是不是同一段內容）。
- **全文另存**：真的需要回放除錯時，全文寫進另一個儲存，有獨立的存取控管、稽核、短保存期；或只對抽樣的一小部分存。
- **寫出前遮罩**：無論存不存全文，寫出前都經過遮罩規則。做法、規則與白名單見 [日誌與稽核紀錄裡的個資](#/skill/logs-pii)。
- **評分資料也算**：送去給人工或模型評分的樣本同樣含有使用者內容，評分介面的權限要和全文儲存一致。

## 實際程式：從呼叫紀錄算出儀表板的數字

下面產生 1,000 筆模擬的呼叫紀錄（兩個 prompt 版本 × 兩個模型），依版本與模型分組，算出 p50 / p95 延遲、平均輸入 token、每千次成本、截斷比例、抽樣通過率。模型名稱是虛構的，單價是任意單位的設定值。最後印出一筆實際會寫出去的紀錄：只有欄位，沒有任何內容全文。

```python run
import json, math, random
from collections import defaultdict

random.seed(11)
# 每百萬 token 的單價：設定值。模型名稱是虛構的
PRICE_PER_M = {"large-2026-05": {"in": 3.0, "out": 15.0}, "small-2026-03": {"in": 0.2, "out": 0.8}}

def fake_call(prompt_version, model):
    # 模擬一次呼叫的紀錄：v3 的 prompt 比較長（輸入 token 多）、通過率較低；大模型比較慢
    base_in = 900 if prompt_version == "v3" else 600
    latency = random.gauss(1800 if model.startswith("large") else 700, 250)
    if random.random() < 0.03:
        latency += random.uniform(4000, 9000)          # 少數請求卡很久：平均看不到、p95 才看得到
    pass_rate = {"v2": 0.91, "v3": 0.84}[prompt_version]
    return {
        "trace_id": "%016x" % random.getrandbits(64),
        "prompt_version": prompt_version,
        "model": model,
        "in_tokens": base_in + random.randint(-80, 80),
        "out_tokens": random.randint(150, 400),
        "latency_ms": max(50, round(latency)),
        "tool_calls": random.choice([0, 0, 1, 2]),
        "finish_reason": random.choice(["stop"] * 19 + ["length"]),
        # 抽樣評分：只有約 20% 的呼叫有分數（人工或另一個模型打的）
        "eval_pass": (random.random() < pass_rate) if random.random() < 0.2 else None,
    }

records = [fake_call(v, m) for v in ("v2", "v3") for m in ("large-2026-05", "small-2026-03") for _ in range(250)]

def percentile(values, p):
    # nearest-rank：排序後取第 ceil(p/100 * n) 個
    s = sorted(values)
    k = max(1, math.ceil(p / 100 * len(s)))
    return s[k - 1]

def cost(r):
    p = PRICE_PER_M[r["model"]]
    return (r["in_tokens"] * p["in"] + r["out_tokens"] * p["out"]) / 1_000_000

def summarize(records):
    groups = defaultdict(list)
    for r in records:
        groups[(r["prompt_version"], r["model"])].append(r)
    rows = []
    for (pv, model), rs in sorted(groups.items()):
        lat = [r["latency_ms"] for r in rs]
        scored = [r["eval_pass"] for r in rs if r["eval_pass"] is not None]   # 沒評分的不算進分母
        rows.append({
            "prompt_version": pv, "model": model, "calls": len(rs),
            "p50_ms": percentile(lat, 50), "p95_ms": percentile(lat, 95),
            "avg_in_tokens": round(sum(r["in_tokens"] for r in rs) / len(rs)),
            "cost_per_1k": round(sum(cost(r) for r in rs) / len(rs) * 1000, 3),
            "truncated_pct": round(100 * sum(r["finish_reason"] == "length" for r in rs) / len(rs), 1),
            "scored": len(scored),
            "pass_rate": round(sum(scored) / len(scored), 2) if scored else None,
        })
    return rows

rows = summarize(records)
cols = ["prompt_version", "model", "calls", "p50_ms", "p95_ms", "avg_in_tokens", "cost_per_1k", "truncated_pct", "scored", "pass_rate"]
print("  ".join(f"{c:>14}" for c in cols))
for row in rows:
    print("  ".join(f"{str(row[c]):>14}" for c in cols))

# 一筆實際會寫出去的紀錄長什麼樣：只有欄位，沒有 prompt 與回應全文
sample = dict(records[0]); sample["cost"] = round(cost(records[0]), 6)
print()
print(json.dumps(sample, ensure_ascii=False))
```

讀結果：

- v3 的平均輸入 token 比 v2 多約五成，每千次成本跟著上升；這在帳單到之前就看得到。
- v3 的抽樣通過率比 v2 低，但每組只有五十筆左右有評分。差幾個百分點時要先問樣本數夠不夠，再下結論。
- p95 和 p50 的差距來自那 3% 卡住的請求；只看平均值時它們幾乎看不出來。
- `pass_rate` 的分母是**有評分的筆數**，不是總呼叫數。把沒評分的當成失敗或成功，都會讓數字失真。

## 常見錯誤

| 錯誤做法 | 會發生什麼 | 修正 |
|---|---|---|
| 只看 HTTP 錯誤率 | 答錯的回答全是 200，品質下降完全看不到 | 抽樣評分、使用者回饋、結束原因比例 |
| 紀錄裡沒有 prompt 版本 | 分不出是哪一次改動讓品質或成本變化 | 每次呼叫記 prompt 版本 |
| 只記請求的模型別名 | 供應商改指向或 gateway fallback 時看不出來 | 同時記請求的與實際回應的模型 |
| 自己用字數估 token | 成本與 context 長度算錯 | 用供應商回傳的 token 數 |
| 只看平均延遲 | 少數卡很久的請求被稀釋 | p50、p95，串流另看第一個 token 時間 |
| 單價寫死在程式裡 | 調價後所有成本報表錯 | 單價放設定並記錄版本 |
| 預設記 prompt 與回應全文 | 個資與機密被複製到 log 平台 | 預設只記欄位與長度，全文另存並控管 |
| 通過率不附樣本數 | 隨機波動被當成退步或進步 | 報表同時顯示樣本數，樣本不足不告警 |
| 從記憶裡抄 GenAI 語意慣例的屬性名 | 名稱過時或拼錯，工具認不得 | 以 OpenTelemetry 官方文件當下版本為準 |

## 動手

1. 執行上面的彙總，把 `fake_call` 裡 v3 的 `base_in` 改回 600，確認兩版的成本差距消失、通過率差距還在。
2. 在 [Playground](#/playground?lang=python) 把評分抽樣比例從 0.2 改成 0.02，看各組的 `scored` 與 `pass_rate` 變得多不穩定。
3. 在 `summarize` 加一欄 `avg_tool_calls`，再加一欄「fallback 比例」（先在 `fake_call` 加一個 `requested_model` 欄位）。
4. 照「儀表板」那張表，列出你會為一個 LLM 功能設的三條告警，各寫出門檻與收到後要看什麼。
5. 本課的程式題：實作呼叫紀錄的彙總函式。紀錄的來源之一是 [AI Gateway](#/skill/ai-gateway)；欄位遮罩見 [日誌與稽核紀錄裡的個資](#/skill/logs-pii)。

## 從一個具體問題開始：凌晨三點的第 47 則告警

on-call 工程師的手機在凌晨三點響了，這是今晚第 47 則告警。前面 46 則多半是「某台機器 CPU 超過 80%」「某個 Pod 重啟了一次」，每一則都在幾分鐘後自己恢復。第 47 則寫著 `HighErrorRate api`，他看了一眼，以為又是同一類，按了確認繼續睡。

二十分鐘後，掛號系統的使用者開始打電話。事後查出來：api 在凌晨兩點五十六分有一次自動部署，新版本連下游的付款服務時用了錯的 port。錯誤率從 0.5% 跳到 12%，告警其實很準，只是被淹沒在噪音裡。

這個情境裡有兩個問題：

- **告警太多**：大部分告警不需要人處理，於是人學會忽略告警。
- **調查要花時間**：就算注意到了，從「錯誤率高」到「是兩點五十六分那次部署造成的」，要開好幾個畫面查指標、翻日誌、找部署紀錄。

AIOps 這個詞涵蓋很廣，從異常偵測到告警聚合都算。本課聚焦在一個具體的用法：**讓 agent 在告警響起時先做唯讀調查、寫出摘要與建議，由人決定要不要動手**。它不取代 on-call，而是讓 on-call 醒來時看到的不是一行告警，而是一段有證據的初步判斷。

## 先處理告警噪音

agent 沒辦法拯救一套本身就很吵的告警。在加 agent 之前，先檢查告警規則本身：

| 問題 | 例子 | 改法 |
|---|---|---|
| 對原因告警，不是對症狀 | CPU 80%、記憶體 70% | 改成對使用者感受得到的症狀告警：錯誤率、延遲、成功率；資源指標放儀表板 |
| 門檻太敏感 | 一個請求失敗就響 | 加持續時間（`for: 5m`）、用比率而不是次數 |
| 沒有分級 | 所有告警都打電話 | 只有需要人立刻處理的才 page，其他進工單或聊天頻道 |
| 同一個原因觸發十則告警 | 資料庫掛了，所有服務都響 | 告警分組與抑制：上游故障時壓住下游的告警 |
| 沒有對應的處理步驟 | 告警響了不知道要做什麼 | 每則告警連到 runbook；寫不出 runbook 的告警，多半不該存在 |

[可觀測性](#/skill/observability) 一課有「告警要基於症狀」的完整說明，[SLO 與錯誤預算](#/skill/slo-error-budget) 講怎麼用燃燒率決定什麼時候該叫人。告警規則清乾淨之後，agent 處理的是「真的需要看」的那些。

### Kubernetes 告警分級的概念

在 Kubernetes 上跑服務，常見的告警事件緊急程度差很多。分級的原則是「使用者有沒有受影響、會不會自己恢復」：

| 事件 | 通常的緊急程度 | 第一步查什麼 |
|---|---|---|
| 單一 Pod 重啟一次 | 低：記錄即可 | 是否 OOMKilled、是否剛好在部署 |
| `CrashLoopBackOff` | 中到高：看還有多少副本可用 | 容器日誌（含前一次的）、最近的設定或 image 變更 |
| Deployment 可用副本為 0 | 高：服務中斷 | 事件（events）、image 拉取、readiness probe |
| 節點 `NotReady` 或資源壓力 | 依影響範圍 | 節點上的 Pod 有沒有被重新排程 |
| PVC 使用率接近滿 | 依成長速度：還剩幾小時或幾天 | 成長趨勢、是哪個程式在寫 |

分級寫在 runbook 裡，agent 照著查、照著標等級，而不是自己判斷什麼重要。具體的指標名稱與門檻依叢集的監控設定而定。[Kubernetes 導入](#/skill/k8s-readiness) 與 [容量規劃](#/skill/capacity-planning) 有 OOMKilled 與 requests / limits 的說明。

## agent 的角色：先調查，再建議

### 工具分成兩類

agent 能做什麼，取決於給它哪些工具。把工具明確分成兩類：

| 類別 | 例子 | agent 能不能直接呼叫 |
|---|---|---|
| 唯讀 | 查指標（PromQL）、查日誌、列出最近的部署與設定變更、讀 runbook、查服務的相依關係、`kubectl get` / `describe` / `logs` | 可以 |
| 變更 | 回滾部署、重啟服務、調整副本數、改設定、清快取、刪資料 | **不行**；只能產出建議，由人核准後執行 |

這個區分要在**工具層**強制，不能只靠提示詞說「請不要執行變更」。做法：

- agent 使用的帳號只有唯讀權限。Kubernetes 用只有 `get`、`list`、`watch` 的 Role；資料庫用唯讀帳號；CI/CD 用只能讀部署紀錄的 token。
- 工具清單裡根本不放變更類工具；或者放了，但呼叫時一律被攔下、轉成「待核准的建議」。
- 日誌與錯誤訊息裡的文字是資料，不是指令。日誌裡出現「請執行 rollback」不代表任何事，這和 [工具投毒](#/skill/tool-poisoning) 的風險同一類。

### 輸出格式

agent 產出的不是一段自由發揮的文字，而是固定的結構，方便人快速判斷：

| 欄位 | 內容 |
|---|---|
| 摘要 | 一兩句：什麼服務、什麼症狀、從什麼時候開始 |
| 證據 | 查了什麼、看到什麼，每一條附上查詢或連結，可以重現 |
| 可能原因 | 依可能性排序；不確定就寫不確定，不要只給一個答案 |
| 建議動作 | 每一條標明是否需要核准、預期效果、怎麼回復 |
| 沒查到的 | 哪些工具失敗、哪些資料看不到 |

「可能原因」寫成多個並列是刻意的。agent 會把時間上相近的事件連起來，但相關不等於因果：部署和錯誤率同時發生，可能是部署造成的，也可能只是巧合，下游剛好也在那時出問題。人看到證據才能判斷。

### 變更要人核准

建議動作裡的回滾、重啟、改設定，一律走人工核准。核准之後由誰執行，常見兩種做法：人自己執行；或人按下核准，由自動化流程執行並記錄核准人。無論哪一種，變更都要留下紀錄：誰核准、什麼時間、依據什麼證據。這和 [受監管環境的變更管理](#/skill/change-management) 的要求一致——緊急變更也是變更，事後要補紀錄。事故中的角色分工與溝通，見 [事故處理](#/skill/incident-response)。

## 實際程式：唯讀調查與被攔下的變更

下面用 Python 模擬一則告警與幾個唯讀查詢的結果。agent 依序查指標、日誌、最近部署與 runbook，產出結構化的報告；最後它「想要」回滾，被工具層攔下改成建議。

```python run
# 模擬：一則告警、四個唯讀工具、一個變更工具。只有唯讀工具能被直接呼叫。
from datetime import datetime, timedelta, timezone

TZ = timezone(timedelta(hours=8))
NOW = datetime(2026, 5, 12, 3, 10, tzinfo=TZ)

alert = {"name": "HighErrorRate", "service": "api", "detail": "5xx 比例 12%（門檻 2%）持續 5 分鐘"}

# 假的觀測資料：真實系統裡是對指標、日誌、CI/CD 與 wiki 的查詢
FAKE = {
    "metrics": {"api": {"error_rate": 0.12, "p95_ms": 1800, "pods_ready": "2/3"}},
    "logs": {"api": ["ERROR connection refused to payment-svc:8443",
                     "ERROR connection refused to payment-svc:8443",
                     "WARN retry 3/3 exhausted for POST /pay"]},
    "deploys": [{"service": "api", "version": "v2.31.0", "at": NOW - timedelta(minutes=14)},
                {"service": "payment-svc", "version": "v1.9.2", "at": NOW - timedelta(days=3)}],
    "runbook": {"HighErrorRate": ["比對最近 30 分鐘的部署", "看錯誤日誌指向哪個下游",
                                  "與部署相關：回滾（需核准）", "下游故障：通報該團隊"]},
}

TOOLS = {
    "get_metrics":        (True,  lambda svc: FAKE["metrics"][svc]),
    "get_logs":           (True,  lambda svc: FAKE["logs"][svc]),
    "get_recent_deploys": (True,  lambda minutes: [d for d in FAKE["deploys"] if d["at"] >= NOW - timedelta(minutes=minutes)]),
    "get_runbook":        (True,  lambda name: FAKE["runbook"].get(name, [])),
    "rollback_deploy":    (False, lambda svc, ver: f"rolled back {svc} to {ver}"),
}

timeline = []   # 每一步都留紀錄：人接手時不用重查


def call(name, *args):
    readonly, fn = TOOLS[name]
    if not readonly:   # 攔在工具層，不靠提示詞
        timeline.append(f"BLOCKED {name}{args}：變更動作，轉成待核准的建議")
        raise PermissionError(f"{name} 需要人工核准")
    result = fn(*args)
    timeline.append(f"CALL    {name}{args} -> {str(result)[:60]}")
    return result


def triage(alert):
    svc = alert["service"]
    m = call("get_metrics", svc)
    logs = call("get_logs", svc)
    deploys = call("get_recent_deploys", 30)
    runbook = call("get_runbook", alert["name"])
    evidence = [f"{svc} error_rate={m['error_rate']:.0%} p95={m['p95_ms']}ms pods_ready={m['pods_ready']}"]
    causes, actions = [], []
    for d in (d for d in deploys if d["service"] == svc):
        mins = int((NOW - d["at"]).total_seconds() // 60)
        evidence.append(f"{svc} 在 {mins} 分鐘前部署 {d['version']}")
        causes.append(f"部署 {d['version']} 引入問題（時間吻合，因果未確認）")
        actions.append(("需核准", f"rollback_deploy({svc}, 前一版)"))
    for dep in sorted({l.split(" to ")[1].split(":")[0] for l in logs if " to " in l}):
        evidence.append(f"日誌：連不上下游 {dep}")
        causes.append(f"{dep} 不可用，或新版本的連線設定錯誤")
        actions.append(("不需核准", f"通知 {dep} 的 on-call 確認狀態"))
    return {"summary": f"{alert['name']} / {svc}：{alert['detail']}", "evidence": evidence,
            "causes": causes, "actions": actions, "runbook": runbook}


report = triage(alert)
try:
    call("rollback_deploy", "api", "v2.30.1")   # agent「順手」想回滾
except PermissionError as e:
    report["blocked"] = str(e)

print("摘要：", report["summary"])
print("證據："); [print("  -", x) for x in report["evidence"]]
print("可能原因："); [print("  -", x) for x in report["causes"]]
print("建議動作："); [print(f"  - [{tag}] {a}") for tag, a in report["actions"]]
print("被攔下：", report["blocked"])
print("時間線："); [print("  ", t) for t in timeline]
```

幾個設計上的重點：

- `call()` 是唯一能碰工具的入口，權限檢查在這裡。真實系統裡這一層是帳號權限與工具閘道，不是 Python 的 if。
- 時間線記下每一次呼叫與結果，包含被攔下的那次。on-call 接手時直接讀這份，也能直接貼進事故時間線。
- 「可能原因」寫了「時間吻合，因果未確認」。agent 看到部署與錯誤同時發生，只能說相關。

## 每一步有紀錄、可以隨時接手

agent 的調查過程要能被人**中途接手**：

- 每一次工具呼叫的參數與結果都存下來，附時間。
- 推論過程寫成文字，不只給結論。
- 人隨時可以停止 agent、接手後續調查，agent 已做的部分不用重做。
- 調查有預算：最多幾次工具呼叫、最多多久。超過就停下來交給人，不要無限查下去。[Agent 的執行迴圈](#/skill/agent-loop) 有預算與中斷的做法。

這些紀錄也是事後 postmortem 的材料：告警幾點響、agent 幾點給出摘要、人幾點確認、做了什麼決定。

## 評估：它到底有沒有幫上忙

導入之後要有數字，不然不知道 agent 是在減少工作還是製造更多噪音：

| 指標 | 意思 | 怎麼量 |
|---|---|---|
| 誤報率 | agent 說「需要處理」，結果沒事的比例 | 每則調查結束時由 on-call 標記結果 |
| 漏報率 | agent 說「可以忽略」，結果是真事故的比例 | 事故回顧時回頭比對 |
| 平均確認時間（MTTA） | 告警到人確認的時間 | 告警系統的紀錄 |
| 平均恢復時間（MTTR） | 告警到服務恢復 | 事故時間線；受很多因素影響，不要全歸功給 agent |
| 建議採用率 | 建議動作被人採用的比例 | 核准紀錄 |
| 證據正確率 | 摘要裡的證據抽查後是否屬實 | 定期抽樣人工檢查 |

漏報比誤報危險：agent 把真事故標成「可以忽略」，人就更可能跳過。初期最好不要讓 agent 有「降級或關閉告警」的能力，只讓它補充資訊。

## 常見錯誤

| 錯誤 | 後果 | 怎麼避免 |
|---|---|---|
| 只在提示詞寫「不要執行變更」 | 模型偶爾還是會呼叫；被注入的日誌內容也可能誘導它 | 帳號權限唯讀、變更工具不提供或在閘道攔截 |
| agent 帳號沿用 on-call 的權限 | 唯讀變成名義上的 | 獨立的服務帳號，最小權限，定期檢查 |
| 輸出只有一個結論，沒有證據 | 人無法判斷，只能全信或全不信 | 固定格式：證據附查詢，原因列多個 |
| 沒有紀錄 | 接手要重查；事後無法稽核 | 每次呼叫都寫入時間線 |
| 讓 agent 自動關閉告警 | 漏報時沒有人看 | 初期只補充資訊，不改告警狀態 |
| 沒有量測 | 不知道有沒有用 | 誤報率、MTTA、建議採用率定期回顧 |
| 告警規則本身很吵 | agent 只是把噪音寫成更長的噪音 | 先清告警規則：症狀告警、分級、分組抑制 |

## 動手

1. 在 Playground 跑上面的模擬，把 `FAKE["deploys"]` 裡 api 的部署時間改成兩小時前，看證據與建議怎麼變。
2. 在 `TOOLS` 加一個唯讀工具 `get_dependency_status(svc)`，回傳 payment-svc 的健康狀態，讓 `triage` 把它加進證據。
3. 試著在 `triage` 裡直接呼叫 `rollback_deploy`，確認它會被攔下、時間線上有紀錄。
4. 做本課的程式題：實作 `triage(alert, tools)`，確保只呼叫唯讀工具。
5. 回頭看 [事故處理](#/skill/incident-response) 的時間線格式，想想 agent 的紀錄要怎麼直接併進去。

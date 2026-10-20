## 從一個具體問題開始：資料庫切換 40 秒，服務停了 5 分鐘

主資料庫的機器故障，備援自動接手，花了 40 秒。這段時間資料庫連不上，是預期中的事。但 API 服務停了將近 5 分鐘：

| 時間 | 發生什麼 |
|---|---|
| 0 秒 | 主資料庫故障，開始切換 |
| 10–30 秒 | 6 個 API Pod 的 liveness probe 都會呼叫 `SELECT 1`，連續 3 次失敗 |
| 30 秒 | Kubernetes 判定 6 個 Pod 都「死了」，同時重啟 |
| 40 秒 | 資料庫切換完成，但 API 全部在重啟中 |
| 40–90 秒 | 6 個 Pod 同時啟動：載入設定、預熱快取、每個開 20 條連線，資料庫瞬間收到 120 個連線請求 |
| 90 秒–5 分 | 冷快取讓每個請求都打資料庫，延遲飆高，部分 Pod 的 probe 逾時又被重啟 |

40 秒的依賴中斷，被健康檢查放大成 5 分鐘的停機。liveness probe 的問題是：它問的是「這個程序要不要重啟」，而重啟解決不了資料庫的問題。

這一課整理讓服務在出狀況時「壞得有限」的幾個基本功：健康檢查問對問題、逾時與重試有節制、備份真的能還原、知道能丟多少資料與停多久、容量不夠時有計畫地降級，以及事故發生時的基本流程。

## 健康檢查：liveness 與 readiness 問的是不同的問題

| | liveness | readiness |
|---|---|---|
| 問題 | 這個程序還活著嗎？卡死了要不要重啟？ | 這個實例現在能處理請求嗎？ |
| 失敗時 | **重啟容器** | 暫時不送流量給它，恢復後自動加回 |
| 該檢查 | 程序自己的狀態：事件迴圈有沒有在跑、主執行緒有沒有死結 | 啟動完成了沒、是否正在關閉、這個實例要用的依賴能不能用 |
| 不該檢查 | 資料庫、快取、其他服務 | 耗時的操作（每次 probe 都跑一個重查詢） |
| 依賴掛掉時 | **仍然通過** | 失敗 |

還有一種 **startup probe**：啟動很慢的程式，在 startup 通過前不跑另外兩種 probe，避免還在載入就被 liveness 判死。Kubernetes 裡三種 probe 的設定與滾動更新的關係見 [導入 Kubernetes 前要準備什麼](#/skill/k8s-readiness)。

不在 Kubernetes 上也一樣：負載平衡器（nginx、雲端的 load balancer）的健康檢查決定要不要送流量，相當於 readiness；systemd 或容器平台的重啟策略相當於 liveness。

### readiness 要不要檢查共用的資料庫

這是一個取捨。資料庫掛掉時，如果每個實例的 readiness 都失敗，負載平衡器後面就**一個實例都沒有**，使用者立刻收到 502／503，而不是卡在逾時。好處是快速失敗；壞處是連不需要資料庫的端點（靜態設定、有快取的頁面）也一起停擺。

常見的做法：

- readiness 檢查**這個實例沒有它就完全不能服務**的依賴，例如主資料庫的連線池。
- 可以降級的依賴（快取、推薦服務）**不放進 readiness**，在程式裡處理失敗：快取掛了就直接查資料庫，推薦服務掛了就不顯示推薦。
- 檢查要**便宜、有逾時**：`SELECT 1` 加上 1 秒的逾時，而不是一個要掃表的查詢。probe 本身的 `timeoutSeconds` 在 Kubernetes 預設只有 1 秒。

### 優雅關閉

部署或縮容時，實例收到 SIGTERM：

1. readiness 立刻開始回失敗（停止接新流量）。
2. 等負載平衡器把它移出（通常要幾秒）。
3. 把進行中的請求處理完、關閉連線池。
4. 結束程序。平台等待一段寬限期（Kubernetes 預設 30 秒）後才強制 SIGKILL。

沒做優雅關閉時，每一次部署都會斷掉一部分進行中的請求。

### 用模擬看差別

```python run
# 6 個 Pod、資料庫在第 0–40 秒斷線。probe 每 10 秒一次，連續 3 次失敗才算失敗（Kubernetes 的預設值）
# 重啟需要 50 秒（啟動、預熱）；這段時間 Pod 不能服務
PODS, PERIOD, THRESHOLD, RESTART = 6, 10, 3, 50
db_up = lambda t: not (0 <= t < 40)

def simulate(liveness_checks_db: bool, until=150):
    fails = [0] * PODS
    restarting_until = [-1] * PODS
    restarts = 0
    timeline = []
    for t in range(0, until, PERIOD):
        for p in range(PODS):
            if t < restarting_until[p]:
                continue
            ok = db_up(t) if liveness_checks_db else True     # 程序本身一直好好的
            fails[p] = 0 if ok else fails[p] + 1
            if fails[p] >= THRESHOLD:
                restarting_until[p] = t + RESTART
                fails[p] = 0
                restarts += 1
        # 能服務的 Pod：沒在重啟，而且資料庫通了（readiness 會在資料庫恢復後的下一次 probe 通過）
        serving = sum(1 for p in range(PODS) if t >= restarting_until[p] and db_up(t))
        timeline.append(serving)
    return restarts, timeline

for label, flag in (("liveness 檢查資料庫", True), ("liveness 只看程序 ", False)):
    restarts, tl = simulate(flag)
    print(f"{label}：重啟 {restarts} 次")
    print("  每 10 秒能服務的 Pod 數：", tl)
```

資料庫在第 40 秒就恢復了。只看程序的 liveness，服務在第 40 秒就回來；檢查資料庫的 liveness，要等到所有 Pod 重啟完才回來，而且真實世界裡這 6 個 Pod 同時啟動、同時建立連線，還會再壓一次資料庫。

本課的程式題要你實作這兩種檢查的差別。

## 逾時與重試

每一個網路呼叫都要有逾時，重試要有節制。原則：

- **每個呼叫都設逾時**：連線、讀取、總時間分開設。很多 HTTP 函式庫預設不逾時，例如 Python 的 `requests`。
- **只重試可以安全重試的**：GET、或帶著冪等鍵（idempotency key）的寫入；`400`、`422` 這類請求本身有問題的錯誤重試也沒用。
- **指數退避加隨機抖動**，並且有次數上限。
- **重試會在多層之間相乘**：前端重試 3 次、API 重試 3 次、API 呼叫的服務再重試 3 次，最底層可能收到 27 倍的流量，剛好在它最脆弱的時候。只在一層重試，或用重試預算限制比例。

timeout 的種類、退避與抖動、斷路器與 bulkhead 的完整說明與程式見 [呼叫外部服務的韌性](#/skill/resilience)。

## 備份與還原演練

**備份成功不代表能還原**。常見的「以為有備份」：

- 備份腳本每天都跑，但三個月前改了資料庫密碼，之後每天都失敗，告警寄到一個沒人看的信箱。
- 備份檔在，但沒有人知道還原步驟；角色、權限、擴充套件沒有一起備份，還原到一半卡住。
- 備份和資料庫在同一台機器、同一個雲端帳號，一起被刪掉。
- **把複寫當成備份**：備援資料庫會忠實地把 `DELETE FROM orders;` 也複製過去。複寫防的是機器故障，不防人為錯誤與軟體 bug。

常聽到的 3-2-1 原則：至少 **3** 份資料、放在 **2** 種不同的儲存媒介、其中 **1** 份在異地。雲端環境裡，「異地」通常是指另一個區域、另一個帳號，並且有防刪除或不可變的設定。

### 還原演練要回答的問題

定期（例如每月）在一個跟正式環境隔離的地方，完整還原一次，記錄：

1. **備份檔能用嗎**：還原有沒有報錯、資料筆數與正式環境的監控數字對不對得上。
2. **要多久**：拆成取得備份檔、還原資料、重建索引、應用程式重新連上的時間。這個總和就是實際的 RTO 下限。
3. **還原到哪個時間點**：最新一筆資料的時間，就是實際的 RPO。
4. **步驟寫下來了嗎**：每一個手動步驟都寫進 runbook 或腳本。

不只資料庫：物件儲存（使用者上傳的檔案）、秘密與設定、基礎設施的定義（Terraform 等）也要能重建。PostgreSQL 的備份方式、PITR 與演練腳本見 [資料庫維運](#/skill/db-operations)。

## RPO 與 RTO

- **RPO（Recovery Point Objective）**：最多可以接受丟失多久的資料。
- **RTO（Recovery Time Objective）**：從決定還原到服務恢復，最多可以接受多久。

兩者是業務決定的目標，技術選擇要能達到它：

| 做法 | RPO 大致量級 | RTO 大致量級 | 代價 |
|---|---|---|---|
| 每天一次邏輯備份（`pg_dump`） | 最多 24 小時 | 數小時（依資料量） | 低 |
| 基準備份加 WAL 歸檔（PITR） | 分鐘級 | 數十分鐘到數小時 | 中：要管理歸檔與保存 |
| 串流複寫加自動切換 | 秒級（非同步複寫可能丟最後幾筆） | 分鐘級 | 高：兩倍以上的資源；仍然需要備份防人為錯誤 |

數字只是量級，實際值取決於資料量、網路、還原機器的規格——所以要靠演練量出來。用演練量到的數字算一次：

```python run
from datetime import datetime, timedelta

incident = datetime(2026, 10, 20, 14, 5)

def last_backup_before(t, every_hours, first_hour=3):
    # 從當天 first_hour 開始，每 every_hours 小時一次
    start = t.replace(hour=first_hour, minute=0)
    if start > t:
        start -= timedelta(days=1)
    n = int((t - start) / timedelta(hours=every_hours))
    return start + timedelta(hours=every_hours * n)

def restore_minutes(size_gb, mb_per_s, index_factor, wal_hours=0, wal_min_per_hour=0):
    load = size_gb * 1024 / mb_per_s / 60          # 搬資料
    return load * (1 + index_factor) + wal_hours * wal_min_per_hour   # 加上重建索引、重播 WAL

# 數字來自假設的演練紀錄：400 GB、還原速度 60 MB/s、建索引約是搬資料的 1 倍時間
plans = {
    "每天 03:00 pg_dump":   (last_backup_before(incident, 24), restore_minutes(400, 60, 1.0)),
    "每 6 小時 pg_dump":     (last_backup_before(incident, 6), restore_minutes(400, 60, 1.0)),
    # PITR：WAL 每分鐘歸檔一次；實體備份不用重建索引，但要重播自基準備份以來的 WAL
    "每天基準備份 + WAL 歸檔": (incident - timedelta(minutes=1), restore_minutes(400, 120, 0, wal_hours=11, wal_min_per_hour=2)),
}
for name, (point, minutes) in plans.items():
    print(f"{name:<16} 最多丟失 {incident - point}  還原約 {minutes/60:.1f} 小時")
```

如果業務說「訂單最多丟 5 分鐘、2 小時內要恢復」，前兩種做法兩個條件都達不到，只有 PITR 那一種達得到——這要在事故之前就知道，而不是事故當下才算。

## 容量與降級

容量不夠時，系統會用最難看的方式失敗：每個請求都變慢，直到全部逾時。有計畫的降級是在那之前主動放棄一部分：

- **留 headroom**：平常的尖峰用量不要超過容量的 60–70%，並能承受少一台機器（N+1）。估算方式見 [硬體資源與容量規劃](#/skill/capacity-planning)。
- **限流與卸載（load shedding）**：超過處理能力的請求盡早回 `429` 或 `503`（可以附 `Retry-After`），而不是收下來排隊到逾時。排隊中的請求佔著記憶體和連線，而且使用者早就離開了。限流演算法見 [限流演算法](#/skill/rate-limiting)。
- **核心與非核心分開**：結帳、登入是核心；推薦、瀏覽紀錄、即時通知是非核心。非核心功能用 feature flag 當 kill switch，壓力大時關掉，把資源留給核心。
- **降級的回應要事先設計**：推薦服務逾時就回空清單、搜尋服務掛了就顯示熱門商品、報表晚一點產生。這些行為要寫進程式並測過，而不是事故當下臨時改。
- **佇列吸收尖峰**：可以晚點做的工作（寄信、產生縮圖）放進佇列，讓 worker 以固定速度消化。

## 事故處理的基本流程

事故發生時，最重要的順序是**先止血，再找根本原因**：

1. **偵測**：告警（基於使用者感受到的症狀，見 [可觀測性：log、metrics、trace](#/skill/observability)）或使用者回報。
2. **宣告與分工**：有人宣告這是事故、決定嚴重等級，指定一個指揮者（incident commander）負責協調與決策，其他人負責排查、對外溝通。指揮者通常不親自下指令修東西。
3. **止血**：用最快、風險最低的方式讓使用者恢復——回滾上一次部署、關掉 feature flag、擴容、切換到備援、暫時關閉非核心功能。這時候不追求修好根本原因。
4. **溝通**：固定間隔更新狀態（內部頻道、狀態頁），即使沒有新進展也說「還在處理，下次更新時間是…」。
5. **恢復與確認**：指標回到正常、使用者端確認正常，才宣告結束。
6. **事後檢討（postmortem）**：時間線、影響、原因與促成因素、行動項目。目標是改系統，不是找人——「某人執行了錯誤的指令」的下一個問題是「為什麼系統允許這個指令在沒有確認的情況下刪掉正式資料」。

第 3 步的「上一次改了什麼」幾乎總是第一個要問的問題，這是部署紀錄要能追溯的原因，見 [環境、secrets 與 artifact](#/skill/environments-secrets)。

### runbook

常見狀況的處理步驟寫成 runbook，讓半夜被叫醒的人能照著做：

```text
# runbook：資料庫連線數用盡
症狀：API 回 500，log 出現 "too many connections" 或連線池等待逾時
影響：所有需要資料庫的請求

1. 確認：在資料庫執行
   SELECT state, count(*) FROM pg_stat_activity GROUP BY state;
2. 若 "idle in transaction" 很多：找出最久的
   SELECT pid, now() - xact_start AS age, query FROM pg_stat_activity
   WHERE state = 'idle in transaction' ORDER BY age DESC LIMIT 10;
   確認後用 pg_terminate_backend(pid) 結束
3. 若是某次部署後才發生：回滾到上一版（連結到部署頁面）
4. 仍未恢復：升級給資料庫負責人（聯絡方式）
事後：記錄在事故時間線；檢查連線池大小與 idle_in_transaction_session_timeout
```

每一則告警都應該連到一份 runbook。事故分級、on-call、角色分工與 postmortem 的寫法見 [事故處理、on-call 與 postmortem](#/skill/incident-response)；以錯誤預算決定什麼時候該停下來處理可靠性問題，見 [SLI、SLO 與錯誤預算](#/skill/slo-error-budget)。

## 常見錯誤與錯誤訊息

| 訊息／現象 | 原因 | 怎麼處理 |
|---|---|---|
| `Liveness probe failed: HTTP probe failed with statuscode: 503`，接著容器被重啟 | liveness 端點回了失敗；常見原因是它檢查了外部依賴 | liveness 只檢查程序本身；依賴放進 readiness 或程式內的降級邏輯 |
| `Readiness probe failed: ... context deadline exceeded` | 健康檢查端點本身太慢，超過 probe 的逾時（預設 1 秒） | 檢查要便宜、自己設更短的逾時；不要在 probe 裡做重查詢 |
| `Back-off restarting failed container`，Pod 狀態 `CrashLoopBackOff` | 容器啟動後很快結束或被 liveness 殺掉，平台以遞增的間隔重試 | `kubectl logs --previous` 看上一次的輸出；啟動慢就加 startup probe |
| `pg_restore: error: could not execute query: ERROR: role "app" does not exist` | 還原時沒有先建立角色 | 備份時一併匯出全域物件（`pg_dumpall --globals-only`），還原前先套用；寫進演練腳本 |
| 備份監控一直是綠的，演練時才發現檔案是空的或格式錯誤 | 只檢查「腳本有跑完」，沒檢查內容 | 監控備份檔的大小與時間；定期實際還原 |
| 部署時固定有少量請求失敗 | 沒有優雅關閉：收到 SIGTERM 立刻結束，或還沒從負載平衡器移出就停止接受連線 | 收到 SIGTERM 先讓 readiness 失敗、等待移出、處理完進行中的請求再結束 |

## 動手

1. 執行健康檢查模擬那段，把 `THRESHOLD` 改成 1、`RESTART` 改成 90，看檢查資料庫的 liveness 會讓恢復時間拉長多少。
2. 執行 RPO／RTO 那段，加一個「每小時 pg_dump」的方案，看它對 RPO 與 RTO 各有什麼影響（還原時間不會因為備份頻率提高而變短）。
3. 替自己的服務寫第一份 runbook：挑一個最常發生的告警，寫下症狀、確認方式、止血步驟、升級對象。
4. 到本課的程式題：實作 readiness 與 liveness 兩個檢查函式，讓依賴掛掉時 readiness 失敗、liveness 仍然通過。

## 從一個具體問題開始：推薦服務變慢，結帳也跟著掛了

商品頁的後端在組回應時會呼叫推薦服務，拿「看過這個的人也買了」。某天推薦服務的資料庫出問題，回應從 50 ms 變成 30 秒才回（或永遠不回）。

接下來十分鐘發生的事：

| 時間 | 狀況 |
|---|---|
| 0 分 | 推薦服務開始慢；呼叫它的 HTTP client 沒設 timeout |
| 1 分 | 商品頁後端的 worker 一個個卡在等推薦服務，可用 worker 越來越少 |
| 3 分 | worker 全部卡住；新的請求在 proxy 排隊，開始出現 504 |
| 4 分 | 結帳 API 跑在同一組 worker 上，也拿不到 worker：結帳全掛 |
| 5 分 | 客戶端與上游看到逾時，開始重試，流量變成平常的 3 倍 |
| 10 分 | 推薦服務的資料庫恢復了，但湧進來的重試把它再次打垮 |

推薦只是「加分」的功能，卻拖垮了整個網站，連最重要的結帳都受影響。問題不在推薦服務變慢——依賴的服務一定會有變慢、掛掉的時候——而在呼叫端沒有任何保護：沒有 timeout、重試沒有節制、所有功能共用同一組資源、失敗時沒有退路。

這一課的五個工具各自處理其中一段：**timeout** 限制等多久、**重試**處理暫時的失敗、**斷路器**在對方明顯有問題時停止呼叫、**bulkhead** 讓一個依賴的問題不擴散、**fallback** 決定失敗時給使用者什麼。

## Timeout：三種時間要分開設

一個 HTTP 呼叫的時間可以拆成幾段，每段的合理上限不同：

| 種類 | 量的是什麼 | 典型設定 | 太長的後果 |
|---|---|---|---|
| 連線逾時（connect） | TCP（加 TLS）握手完成 | 內網 0.5–1 秒、外網 2–5 秒 | 對方機器不見了（封包被丟），每次都卡到逾時才失敗 |
| 讀取逾時（read） | **兩次收到資料之間**的最長間隔 | 依對方的 P99 回應時間，加一點餘裕 | 對方慢時 worker 被長時間佔住 |
| 總時間（deadline） | 從發出到收完整個回應 | 依呼叫端自己的時間預算 | 讀取逾時擋不住「每秒回 1 個位元組」的慢回應 |
| 等連線池（pool） | 從連線池拿到一條連線 | 很短，例如 1 秒 | 池子滿時請求無限排隊 |

讀取逾時量的是「間隔」，不是總時間：對方每 4 秒送一點資料，讀取逾時設 5 秒永遠不會觸發，整個回應卻可能花上幾分鐘。所以需要總時間上限。

不同函式庫的預設值差很多，要逐一確認：

- Python `requests`：**預設沒有 timeout**，會一直等。`timeout=(3, 10)` 分別是連線與讀取，沒有總時間的設定。
- Python `httpx`：預設 5 秒（連線、讀取、寫入、等連線池各 5 秒），可以用 `httpx.Timeout(10.0, connect=2.0)` 分開設。
- 資料庫：PostgreSQL 的 `statement_timeout` 預設 0（不限制），可以依角色或連線設定。

```python
import httpx

# 連線 2 秒、其他（讀取、寫入、等連線池）5 秒；client 要共用，才會重用連線
client = httpx.Client(timeout=httpx.Timeout(5.0, connect=2.0))

def get_recommendations(product_id: int) -> list:
    r = client.get(f"https://reco.internal/products/{product_id}/similar")
    r.raise_for_status()
    return r.json()["items"]
```

### 時間預算要往下傳

使用者的請求在 proxy 有 30 秒的上限，後端呼叫 A 服務設 20 秒、A 再呼叫 B 設 20 秒：B 還在努力時，使用者早就收到 504 了，B 做的事全部白費。

做法是**傳遞截止時間**（deadline propagation）：入口算出「這個請求最晚什麼時候要完成」，每往下呼叫一層，就用剩餘時間（扣掉一點自己處理的餘裕）當 timeout。gRPC 內建這個機制（deadline 會跟著請求傳下去）；HTTP 沒有標準標頭，要自己約定，例如帶一個剩餘毫秒數的自訂標頭。

## 重試：只重試該重試的

### 哪些可以重試

| 失敗 | 重試？ | 理由 |
|---|---|---|
| 連線被拒、連線逾時 | 可以 | 請求根本沒送到，對方什麼都沒做 |
| 讀取逾時 | **只有冪等操作可以** | 對方可能已經做完了，只是回應沒回來 |
| `502`、`503`、`504` | 可以（冪等操作） | 通常是暫時的；`503` 帶 `Retry-After` 時照它等 |
| `429 Too Many Requests` | 可以，但要照 `Retry-After` 等 | 立刻重試只會更快被限流 |
| `500` | 看情況 | 可能是暫時的，也可能是程式 bug，每次都會失敗 |
| `400`、`401`、`403`、`404`、`409`、`422` | 不要 | 請求本身有問題，再送幾次結果都一樣 |

「冪等」決定能不能重試：`GET`、`PUT`、`DELETE` 可以；`POST` 只有帶了 `Idempotency-Key`、而且伺服器有實作時才可以（見 [分頁、篩選、版本與冪等鍵](#/skill/api-patterns)）。讀取逾時後重送 `POST /payments`，是重複扣款最常見的原因。

### 退避與抖動

失敗後立刻重試，對方剛好在過載，只會加重負擔。**指數退避**讓每次等待加倍：0.2 秒、0.4 秒、0.8 秒、1.6 秒…，並設一個上限。

只有退避還不夠：1,000 個客戶端在同一秒失敗，會在同一個 0.2 秒後重試、同一個 0.4 秒後再重試，每一波都是 1,000 個請求同時到。加上**隨機抖動**（jitter）把它們打散。常見的「full jitter」是每次等待 `random(0, 退避值)`：

```
attempt   退避上限     full jitter 實際等待（每個客戶端不同）
   1      0.2 s        0 ~ 0.2 s
   2      0.4 s        0 ~ 0.4 s
   3      0.8 s        0 ~ 0.8 s
   4      1.6 s        0 ~ 1.6 s
```

### 重試會放大流量

重試次數會在呼叫鏈上相乘。三層服務各自「失敗就重試 3 次」（每層最多 4 次嘗試），最底層在故障時收到的請求最多是 4 × 4 × 4 = 64 倍。對方越掛，收到的流量越大，越難恢復，這就是開頭第 10 分鐘的狀況。

兩個限制方式：

- **只在一層重試**：通常是最靠近使用者的那一層，或最靠近失敗點的那一層，其他層直接把錯誤往上傳。
- **重試預算**（retry budget）：重試的請求不能超過正常請求的某個比例，例如 10%。對方健康時偶爾失敗會被重試；對方大規模失敗時，重試很快用完預算，就不再重試。

## 斷路器：對方明顯掛了就先別打

timeout 加重試仍然讓每個請求都去撞一次已經掛掉的服務，每次都要等到逾時。斷路器（circuit breaker）記錄最近的失敗，失敗多到某個程度就**直接失敗**，不再發出呼叫：

```
             失敗率超過門檻
   ┌────────┐ ───────────────→ ┌────────┐
   │ CLOSED │                  │  OPEN  │  所有呼叫立刻失敗（或走 fallback）
   │ 正常放行│ ←──┐             └────────┘
   └────────┘    │                  │ 等待冷卻時間（例如 10 秒）
                 │                  ↓
                 │  試探成功    ┌───────────┐
                 └──────────── │ HALF-OPEN │  只放少量試探請求
                               └───────────┘
                                    │ 試探失敗
                                    └──────→ 回到 OPEN，重新計時
```

| 狀態 | 呼叫怎麼處理 | 離開的條件 |
|---|---|---|
| CLOSED | 正常呼叫，記錄成功與失敗 | 最近一段時間（或最近 N 次）失敗率超過門檻，且樣本數足夠 → OPEN |
| OPEN | 不呼叫，立刻回錯誤或 fallback | 冷卻時間到 → HALF-OPEN |
| HALF-OPEN | 只放少數試探請求，其餘照 OPEN 處理 | 試探成功 → CLOSED；失敗 → OPEN |

設計上要注意的地方：

- **要有最小樣本數**：凌晨流量很少時，2 個請求失敗 1 個就是 50%，不應該因此斷路。
- **哪些算失敗**：逾時、連線錯誤、5xx 算；4xx 是呼叫端的錯，不應該讓斷路器打開。
- **斷路器以依賴為單位**：每個下游服務（甚至每個 endpoint）各一個，推薦服務掛了不該讓會員服務也斷路。
- **多台機器各自計算**：每個實例各有自己的斷路器狀態，這通常沒問題，打開的時間點會略有差異。

斷路器的好處是雙向的：呼叫端不再浪費 worker 等逾時，被呼叫端拿到喘息時間恢復。

## Bulkhead 與 fallback

**bulkhead**（艙壁）來自船艙分隔：一格進水不會讓整艘船沉沒。在服務裡，就是讓不同依賴、不同功能使用**各自的資源上限**：

- 每個下游服務一個獨立的連線池，各有上限：推薦服務最多 20 條，付款服務另外 50 條。
- 限制同時呼叫某個依賴的數量（semaphore），超過就立刻失敗，而不是排隊。
- 重要功能（結帳）與次要功能（推薦）跑在不同的 worker 群組或不同的服務實例。

開頭的事故裡，只要推薦服務的同時呼叫數被限制在 20，最多 20 個 worker 卡住，其他 worker 照常處理結帳。

**fallback** 是失敗時的替代結果，要在設計時就決定，不是出事時才想：

| 依賴 | fallback |
|---|---|
| 推薦服務 | 回熱門商品（預先算好、放快取）或直接不顯示推薦區塊 |
| 匯率服務 | 用最近一次成功取得的匯率，並標示更新時間 |
| 庫存查詢 | 顯示「庫存確認中」，下單時再檢查 |
| 付款服務 | **沒有安全的 fallback**：回明確的錯誤，讓使用者稍後再試 |

不是每個依賴都能降級。會影響金錢、權限、資料正確性的呼叫，失敗時要明確失敗，不要回一個「看起來成功」的假結果。

## 實際程式：退避、抖動與重試預算

下面模擬 1,000 個客戶端在同一時間失敗後重試，比較「無抖動」與「full jitter」時，最忙的 10 ms 裡下游收到多少重試，並示範重試預算怎麼擋住重試風暴：

```python run
import random
from collections import Counter

random.seed(7)
BASE, CAP = 0.2, 5.0           # 退避基準 0.2 秒、上限 5 秒

def backoff(attempt, jitter):
    ceiling = min(CAP, BASE * 2 ** (attempt - 1))
    return random.uniform(0, ceiling) if jitter else ceiling

def retry_times(clients, attempts, jitter):
    times = []
    for _ in range(clients):
        t = 0.0
        for a in range(1, attempts + 1):
            t += backoff(a, jitter)
            times.append(t)
    return times

for jitter in (False, True):
    buckets = Counter(int(t * 100) for t in retry_times(1000, 3, jitter))   # 每 10 ms 一格
    peak = max(buckets.values())
    print(f"{'full jitter' if jitter else '無抖動'}：最忙的 10 ms 收到 {peak} 個重試，分散在 {len(buckets)} 個 10 ms 區間")

# 重試預算：重試數不能超過正常請求的 10%
class RetryBudget:
    def __init__(self, ratio=0.1):
        self.ratio, self.requests, self.retries = ratio, 0, 0
    def record_request(self):
        self.requests += 1
    def can_retry(self):
        if self.retries < self.requests * self.ratio:
            self.retries += 1
            return True
        return False

for failure_rate in (0.02, 0.9):
    budget, sent = RetryBudget(), 0
    for _ in range(1000):
        budget.record_request(); sent += 1
        if random.random() < failure_rate and budget.can_retry():
            sent += 1
    print(f"失敗率 {failure_rate:.0%}：1000 個請求實際送出 {sent} 次（重試 {budget.retries}）")
```

失敗率 2% 時，重試全部被允許；失敗率 90% 時，重試被限制在大約 10%，下游收到的流量只多一成，而不是翻倍。

## 實際程式：斷路器狀態機

用假的時鐘模擬：下游在第 10 到 40 秒之間故障，看斷路器怎麼開、怎麼試探、怎麼關回去：

```python run
class CircuitBreaker:
    def __init__(self, window=10, min_calls=5, threshold=0.5, cooldown=8):
        self.window, self.min_calls, self.threshold, self.cooldown = window, min_calls, threshold, cooldown
        self.state, self.results, self.opened_at, self.log = "CLOSED", [], None, []

    def _to(self, state, now, why):
        self.log.append(f"t={now:>2}s {self.state:<9} → {state:<9} {why}")
        self.state = state

    def allow(self, now):
        if self.state == "OPEN" and now - self.opened_at >= self.cooldown:
            self._to("HALF_OPEN", now, "冷卻時間到，放一個試探請求")
            return True
        return self.state == "CLOSED"          # OPEN：直接拒絕

    def record(self, ok, now):
        if self.state == "HALF_OPEN":
            self._to("CLOSED" if ok else "OPEN", now, "試探成功" if ok else "試探失敗，重新計時")
            self.results, self.opened_at = [], now
            return
        self.results = (self.results + [ok])[-self.window:]     # 只看最近 window 次
        fails = self.results.count(False)
        if len(self.results) >= self.min_calls and fails / len(self.results) >= self.threshold:
            self._to("OPEN", now, f"最近 {len(self.results)} 次失敗 {fails} 次")
            self.opened_at = now

def downstream_ok(t):
    return not (10 <= t < 40)                  # 第 10–40 秒故障

cb, calls, rejected = CircuitBreaker(), 0, 0
for t in range(0, 60):                         # 每秒一個請求
    if cb.allow(t):
        calls += 1
        cb.record(downstream_ok(t), t)
    else:
        rejected += 1                          # 這裡會改走 fallback

print("\n".join(cb.log))
print(f"實際呼叫下游 {calls} 次，快速失敗 {rejected} 次")
```

輸出裡可以看到：故障從第 10 秒開始，最近 10 次裡的失敗累積到一半（第 14 秒）時斷路器打開；之後每 8 秒放一個試探請求，失敗就再打開；故障在第 40 秒結束，下一次試探（第 46 秒）成功，回到 CLOSED。故障期間真正打到下游的只有開頭幾次與少數試探請求，其餘都直接快速失敗。這也看得出冷卻時間的代價：下游第 40 秒就恢復了，呼叫端到第 46 秒才發現。

實務上不必自己寫：Python 有 `tenacity`（重試）、`pybreaker`（斷路器）等套件；服務網格（例如 Envoy、Istio）也能在 proxy 層設定逾時、重試、異常偵測。但參數（門檻、冷卻時間、哪些錯誤算失敗）還是要自己決定。

## 常見錯誤與錯誤訊息

| 訊息或現象 | 原因 | 處理 |
|---|---|---|
| `requests.exceptions.ConnectTimeout` | 連線階段逾時，對方沒回應 SYN | 檢查網路與防火牆；可以安全重試 |
| `requests.exceptions.ReadTimeout`、`httpx.ReadTimeout` | 已送出請求，等回應逾時 | 只有冪等操作重試；非冪等操作要查詢結果再決定 |
| `httpx.PoolTimeout` | 連線池滿了，等不到可用連線 | 通常是下游變慢、連線都被佔住；不要只加大池子，先看下游 |
| 程式卡住、沒有任何錯誤 | 沒設 timeout | 每個對外呼叫都設 timeout，包括資料庫與快取 |
| 下游恢復後又馬上被打垮 | 重試沒有抖動、沒有預算，或多層都在重試 | 加 jitter、只在一層重試、設重試預算 |
| 斷路器一直不打開 | 門檻用「連續失敗次數」，但失敗與成功交錯；或逾時沒被算成失敗 | 改用時間窗內的失敗率；逾時要計入 |
| 斷路器在離峰時亂開 | 沒有最小樣本數 | 設 `min_calls` |
| 重複扣款 | 讀取逾時後重送非冪等的 POST | 加 `Idempotency-Key`，或改成先查詢再決定 |

設定上的常見錯誤：

- **timeout 比上游的還長**：nginx 等 60 秒就回 504，後端呼叫外部 API 卻設 120 秒。
- **重試寫在迴圈裡、沒有等待**：`for _ in range(3): try: ... except: pass`，三次請求在幾毫秒內全部送出。
- **捕捉所有例外都重試**：連 `KeyError`、驗證錯誤也重試，只是把同樣的錯做三次。
- **fallback 也呼叫同一個掛掉的依賴**：例如 fallback 去查同一個資料庫。

## 動手

1. 按退避那段的「在 Playground 開啟」，把 `attempts` 改成 5、`CAP` 改成 1.0，觀察無抖動時重試在哪幾個時間點堆成尖峰。
2. 在斷路器那段把 `cooldown` 從 8 改成 2，再改成 20：冷卻時間短，試探請求變多；冷卻時間長，下游恢復後要更久才恢復呼叫。
3. 把 `downstream_ok` 改成隨機失敗 30%（`import random` 後 `return random.random() > 0.3`），看門檻 0.5 的斷路器會不會打開，再調 `threshold`。
4. 檢查你的專案：找出所有對外的 HTTP、資料庫、快取呼叫，逐一列出它們的連線逾時、讀取逾時、是否重試、重試哪些錯誤。再到 [付款請求的冪等與重試](#/scenario/idempotency) 看非冪等操作要怎麼安全地重試。

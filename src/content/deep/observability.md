## 從一個具體問題開始：「網站變慢了」，但儀表板一切正常

週一上午客服轉來好幾則抱怨：「結帳要轉很久」。值班工程師打開儀表板：

- 平均回應時間 180 ms，跟上週差不多。
- CPU 40%、記憶體正常。
- 錯誤率 0.3%，沒有告警。

接著翻 log：每台機器各自一個文字檔，內容是 `2026-10-19 10:42:13 INFO checkout ok`。找不到哪一筆是那位客戶的結帳，也看不出那個請求後來呼叫了庫存服務和金流服務，在哪一段花了時間。

兩個小時後才找到原因：金流服務的一個外部 API 偶爾要 8 秒才回，影響大約 2% 的結帳請求。平均值把它稀釋掉了——98 個 150 ms 加 2 個 8,000 ms，平均是 307 ms，看起來只是「有點慢」，但那 2% 的使用者等了 8 秒。

缺的是三樣東西：**看得到尾端的指標**（p99，而不是平均）、**能串起一個請求的 log**（每一行帶著同一個 id）、**能看出請求在各服務之間花在哪裡的 trace**。

## 三種訊號各回答什麼問題

| | metrics | logs | traces |
|---|---|---|---|
| 回答的問題 | 有多少、多快、趨勢如何？現在正常嗎？ | 那一次發生了什麼？錯誤細節是什麼？ | 一個請求經過哪些服務、每一段花多久？ |
| 資料形狀 | 數字的時間序列，事先聚合 | 一筆筆事件 | 一棵 span 樹 |
| 成本 | 低：跟請求量無關，跟時間序列數量有關 | 跟請求量成正比 | 跟請求量成正比，通常會取樣 |
| 典型用途 | 儀表板、告警 | 除錯、稽核 | 找瓶頸、看依賴關係 |
| 工具舉例 | Prometheus | Loki、Elasticsearch、雲端的 log 服務 | Jaeger、Tempo、雲端的 trace 服務 |

三者是互補的：**告警從 metrics 來**（「5xx 比例升高」），**定位用 trace**（「慢在金流服務的 `charge` 那一段」），**細節看 log**（「那一次的錯誤訊息與參數」）。三者共用同一個 trace id 或 request id，才能從一個跳到另一個。

## 結構化日誌與 correlation id

文字 log 適合人讀，不適合機器查。**結構化日誌**是每一行一個 JSON 物件，欄位固定：

```json
{"ts": "2026-10-19T02:42:13.418Z", "level": "INFO", "msg": "checkout completed", "request_id": "c0a8e3f2", "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736", "user_id": 1042, "order_id": 88123, "duration_ms": 8143}
```

有了欄位，就能查「`duration_ms > 5000` 的結帳」、「`request_id = c0a8e3f2` 的所有 log」，而不是用正規表示式在文字裡撈。

**correlation id**（request id）是一個請求從進來到結束都帶著的識別碼：

1. 入口（反向代理或 API 的第一層 middleware）產生一個 id；如果上游已經帶了（例如 `X-Request-ID` 標頭，這是常見慣例，不是標準），就沿用。
2. 這個請求處理期間的每一行 log 都自動帶上它。
3. 呼叫下游服務時，把它放進請求標頭傳下去。
4. 回應時也放進回應標頭，使用者回報問題時可以提供。

用了 OpenTelemetry 時，W3C Trace Context 的 `traceparent` 標頭已經帶著 trace id，可以直接把 trace id 當成 correlation id。

Python 裡用 `contextvars` 存「目前這個請求的 id」：它對 asyncio 的每個 task 是獨立的，同時處理很多請求也不會混在一起。

```python run
import asyncio, contextvars, json, logging, sys, time, uuid

request_id = contextvars.ContextVar("request_id", default="-")

class JsonFormatter(logging.Formatter):
    def format(self, record):
        entry = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(record.created)),   # 一律 UTC
            "level": record.levelname,
            "msg": record.getMessage(),
            "request_id": request_id.get(),            # 每一行自動帶上目前請求的 id
        }
        entry.update(getattr(record, "fields", {}))      # logger.info(..., extra={"fields": {...}})
        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)   # stack trace 放進同一行的欄位
        return json.dumps(entry, ensure_ascii=False)

handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(JsonFormatter())
log = logging.getLogger("shop")
log.handlers = [handler]
log.setLevel(logging.INFO)

async def charge(order_id):
    await asyncio.sleep(0.01)
    if order_id == 2:
        raise TimeoutError("payment gateway timeout")

async def handle(order_id):
    request_id.set(uuid.uuid4().hex[:8])               # middleware 做的事：每個請求一個新 id
    start = time.perf_counter()
    log.info("checkout started", extra={"fields": {"order_id": order_id}})
    try:
        await charge(order_id)
        status = 200
    except TimeoutError:
        log.exception("charge failed", extra={"fields": {"order_id": order_id}})
        status = 502
    ms = round((time.perf_counter() - start) * 1000, 1)
    log.info("checkout finished", extra={"fields": {"order_id": order_id, "status": status, "duration_ms": ms}})

async def main():
    await asyncio.gather(handle(1), handle(2), handle(3))   # 三個請求交錯執行，id 不會混

asyncio.run(main())
```

三個請求的 log 交錯印出，但每一行的 `request_id` 都對得上自己的請求。幾個原則：

- **時間用 UTC、ISO 8601**，時區轉換交給查詢介面。
- **例外的 stack trace 放進同一筆 JSON 的欄位**，不要印成多行文字；多行 log 在收集端常被切成好幾筆不相干的事件。
- **不要記個資與秘密**：密碼、token、完整的身分證號、卡號。遮罩與欄位白名單見 [日誌與稽核紀錄裡的個資](#/skill/logs-pii)；log 的設定方式見 [日誌、錯誤處理與設定](#/skill/logging-config)。
- **log 等級**：正式環境通常是 INFO；DEBUG 的量可能是十倍以上，要開就限定範圍與時間。

## metrics：三種指標類型

| 類型 | 行為 | 例子 | 怎麼用 |
|---|---|---|---|
| counter | 只增不減（程序重啟時歸零） | `http_requests_total`、`errors_total` | 看**變化率**：`rate(http_requests_total[5m])` 是每秒請求數 |
| gauge | 可增可減的當下值 | 進行中的請求數、佇列長度、連線池使用中的連線 | 直接看值、看最大值 |
| histogram | 把觀測值分進事先定義的區間（bucket）並計數 | `http_request_duration_seconds` | 算百分位數、看分佈 |

Prometheus 的 histogram 會產生三組時間序列：`_bucket{le="0.1"}`（小於等於 0.1 秒的累計次數）、`_sum`（所有觀測值的總和）、`_count`（總次數）。bucket 是**累計**的：`le="0.5"` 包含了 `le="0.1"` 的那些。

查 p95：

```text
histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))
```

`sum by (le)` 先把所有實例的 bucket 加起來，再算百分位數。這是 histogram 最重要的性質：**bucket 可以跨實例相加，百分位數不行**。三台機器各自的 p99 取平均，不是整體的 p99。

命名慣例（Prometheus）：單位寫在名稱裡（`_seconds`、`_bytes`），counter 用 `_total` 結尾，用基本單位（秒，而不是毫秒）。

### 百分位數與 histogram 的估計

下面產生一組延遲樣本：大部分很快，少數很慢。比較平均、真正的百分位數，以及從 bucket 估出來的百分位數：

```python run
import bisect, random

random.seed(7)
# 97% 的請求 80–250 ms，3% 卡在外部 API：2–9 秒
samples = [random.uniform(0.08, 0.25) for _ in range(9700)] + [random.uniform(2, 9) for _ in range(300)]
random.shuffle(samples)

def percentile(values, p):
    # nearest-rank：排序後取第 ceil(p/100 * n) 個
    s = sorted(values)
    k = max(1, -(-len(s) * p // 100))
    return s[int(k) - 1]

mean = sum(samples) / len(samples)
print(f"平均 {mean*1000:7.0f} ms")
for p in (50, 95, 99):
    print(f"p{p:<3}  {percentile(samples, p)*1000:7.0f} ms")

# 模擬 Prometheus histogram：累計 bucket，le 是上界（秒）
bounds = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, float("inf")]
counts = [0] * len(bounds)
for v in samples:
    counts[bisect.bisect_left(bounds, v)] += 1
cumulative = []
total = 0
for c in counts:
    total += c
    cumulative.append(total)
print("\n累計 bucket：", {("+Inf" if b == float("inf") else b): n for b, n in zip(bounds, cumulative)})

def histogram_quantile(q, bounds, cumulative):
    # 和 Prometheus 一樣：找到目標名次落在哪個 bucket，在 bucket 內線性內插
    rank = q * cumulative[-1]
    i = bisect.bisect_left(cumulative, rank)
    if bounds[i] == float("inf"):
        return bounds[i - 1]                       # 落在 +Inf bucket：只能回報上一個上界
    lower = 0.0 if i == 0 else bounds[i - 1]
    below = 0 if i == 0 else cumulative[i - 1]
    in_bucket = cumulative[i] - below
    return lower + (bounds[i] - lower) * (rank - below) / in_bucket

for q in (0.5, 0.95, 0.99):
    print(f"bucket 估計 p{int(q*100):<3} {histogram_quantile(q, bounds, cumulative)*1000:7.0f} ms")
```

觀察：

- 平均值落在快、慢兩群之間，**哪一群使用者的實際體驗都不是它**。
- p95 還在快的那群，p99 才看到慢的那 3%。要看尾端，就要看 p99。
- bucket 估計的準確度取決於 bucket 的邊界：p50、p95 落在比較窄的 0.1–0.25 秒 bucket，估得很準；p99 落在 5–10 秒這個很寬的 bucket，只能估出一個內插值，誤差可能有幾百毫秒到幾秒。bucket 邊界要涵蓋你在意的門檻（例如 SLO 是 300 ms，就要有一個 `le="0.3"`）。

### 標籤與基數爆炸

每一組不同的標籤值，就是一條獨立的時間序列。時間序列的數量是各標籤可能值的**乘積**：

```python run
# histogram 每個標籤組合會產生 (bucket 數 + 1 個 +Inf) 條 _bucket，再加 _sum、_count
def series(*label_values, buckets=11):
    n = 1
    for v in label_values:
        n *= v
    return n * (buckets + 1 + 2)

base = series(5, 30, 5, 20)            # method × 路由模板 × 狀態碼類別 × Pod
print(f"method × route × status × pod：{base:,} 條")
print(f"再加上 user_id（5 萬個使用者）：{series(5, 30, 5, 20, 50_000):,} 條")
print(f"route 用原始路徑（/orders/88123 這種，假設 10 萬種）取代模板：{series(5, 100_000, 5, 20):,} 條")
```

基數爆炸的典型原因：把使用者 id、訂單 id、完整 URL、錯誤訊息全文、時間戳放進標籤。症狀是監控系統的記憶體一直漲、查詢變慢，嚴重時整個監控掛掉——剛好在最需要它的時候。

- 路由用**模板**：`/orders/{id}`，不是 `/orders/88123`。多數 web 框架的 instrumentation 會提供模板。
- 狀態碼可以用類別（`2xx`、`4xx`、`5xx`），或保留實際值但確認種類有限。
- 想知道「哪個使用者」是 log 與 trace 的工作，不是 metrics 的。

## RED 與 USE：該收哪些指標

| 方法 | 適用對象 | 指標 |
|---|---|---|
| RED | 服務（API、處理請求的東西） | **R**ate 每秒請求數、**E**rrors 失敗的比例或數量、**D**uration 延遲分佈 |
| USE | 資源（CPU、記憶體、磁碟、連線池、佇列） | **U**tilization 使用率、**S**aturation 飽和度（排隊、等待）、**E**rrors 錯誤 |

RED 告訴你**使用者感受到什麼**；USE 告訴你**哪個資源是瓶頸**。Google SRE 書的四個黃金訊號（延遲、流量、錯誤、飽和度）大致是兩者的合體。

飽和度常被忽略：CPU 使用率 60% 看起來還好，但連線池 20 條全部在用、還有 50 個請求在排隊，那才是延遲的來源。連線池、佇列、worker 這類「有固定數量的東西」都要有使用中與等待中的 gauge。

## 分散式追蹤：trace 與 span

一個 **trace** 代表一個請求的完整旅程；它由很多 **span** 組成，每個 span 是一段有開始與結束時間的工作（一次 HTTP 呼叫、一句 SQL、一段函式），span 之間有父子關係：

```text
trace 4bf92f35…                                           0 ms ─────────────── 8,140 ms
└─ POST /checkout (shop-api)                              ████████████████████████████
   ├─ SELECT cart_items (PostgreSQL)                      █
   ├─ POST /reserve (inventory)                            ██
   │  └─ UPDATE stock (PostgreSQL)                          █
   └─ POST /charge (payment)                                  ███████████████████████
      └─ POST https://gateway.example.com/v1/charges          ██████████████████████
```

一眼就能看出時間花在外部金流 API。每個 span 記錄：名稱、開始與結束時間、所屬的 trace id、自己的 span id、父 span id，以及屬性（`http.route`、`db.system`、`order.id` 等）。

跨服務時，trace 的上下文靠標頭傳遞。W3C Trace Context 規範的 `traceparent` 標頭格式是 `版本-trace id-父 span id-旗標`：

```text
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

下游服務收到後，用同一個 trace id 建立自己的 span，父 span 設成標頭裡的那一個。經過訊息佇列時也要把這個上下文放進訊息的 metadata，否則 trace 會在佇列那裡斷掉。

**取樣**：每個請求都記錄完整 trace 成本很高。head sampling 在請求開始時就決定要不要記（例如 10%），簡單但會漏掉罕見的慢請求；tail sampling 等請求結束後再決定（例如「錯誤或超過 1 秒的全部保留」），需要先把 span 暫存在收集器裡。

## OpenTelemetry 的角色

OpenTelemetry（OTel）是一套與廠商無關的標準與工具：

- **API 與 SDK**：在程式裡建立 span、記錄指標；各語言都有實作。
- **自動 instrumentation**：常見框架與函式庫（FastAPI、Django、requests、httpx、SQLAlchemy、psycopg 等）有現成的套件，不改程式碼就能產生 span 並傳遞 `traceparent`。
- **OTLP**：傳送 telemetry 資料的協定。
- **Collector**：獨立的程序，接收、處理（取樣、過濾、加屬性）、再轉送到後端（Prometheus、Jaeger、各家雲端服務）。

換後端時只改 Collector 的設定，程式碼不用動。手動加 span 的寫法（需要安裝 `opentelemetry-api` 與 SDK，不能在瀏覽器裡跑）：

```python
from opentelemetry import trace

tracer = trace.get_tracer("shop.checkout")

def charge(order_id: int, amount: int):
    # 包在 span 裡：自動記錄開始、結束時間，例外會被記錄在 span 上
    with tracer.start_as_current_span("charge") as span:
        span.set_attribute("order.id", order_id)
        span.set_attribute("payment.amount", amount)
        return gateway.charge(order_id, amount)
```

各語言、各訊號（traces、metrics、logs）的成熟度不同，導入前看官方文件上該語言的狀態。錯誤追蹤工具（例如 Sentry）會把例外聚合、附上請求的上下文，和上面三種訊號互補。

## 告警要基於症狀

告警會把人從睡夢中叫醒，所以每一則都要回答：**使用者現在受到影響了嗎？收到後要做什麼？**

| 基於症狀（應該叫人） | 基於原因（放儀表板，輔助診斷） |
|---|---|
| 5xx 比例超過 2% 持續 10 分鐘 | 某台機器 CPU 85% |
| 結帳 p99 超過 2 秒 | 記憶體使用 70% |
| 錯誤預算的燃燒率過高 | 某個 Pod 重啟了一次 |

原因型的指標很多時候不影響使用者（CPU 高但回應正常），拿來告警只會製造噪音；噪音多了，真正的告警也會被忽略。

```yaml
# Prometheus 告警規則
groups:
  - name: shop-api
    rules:
      - alert: HighErrorRate
        expr: |
          sum(rate(http_requests_total{job="shop-api", status=~"5.."}[5m]))
            / sum(rate(http_requests_total{job="shop-api"}[5m])) > 0.02
        for: 10m                       # 持續 10 分鐘才觸發，過濾短暫的波動
        labels:
          severity: page
        annotations:
          summary: "shop-api 5xx 比例超過 2%"
          runbook_url: "https://wiki.example.org/runbooks/shop-api-5xx"   # 收到後做什麼
```

固定門檻之外，以 SLO 為基礎的燃燒率告警更能反映「照這個速度，這個月的錯誤預算會不會燒完」，見 [SLI、SLO 與錯誤預算](#/skill/slo-error-budget)。每一則告警附上 runbook 連結，見 [健康檢查、備份與事故處理](#/skill/reliability)。

## 常見錯誤與錯誤訊息

| 訊息／現象 | 原因 | 怎麼處理 |
|---|---|---|
| `TypeError: Object of type datetime is not JSON serializable` | log 的欄位裡有 `datetime`、`Decimal` 等 `json` 不認得的型別 | 先轉成字串（`isoformat()`），或給 `json.dumps` 一個 `default=str` |
| `ValueError: Duplicated timeseries in CollectorRegistry` | prometheus_client 同一個指標名稱註冊了兩次，常見於模組被重複 import 或測試裡重建 app | 指標在模組層級定義一次；測試用獨立的 registry |
| 監控系統記憶體一直漲、查詢逾時 | 標籤基數爆炸 | 找出時間序列最多的指標與標籤，把高基數的值移出標籤 |
| `rate()` 用在 gauge 上，結果怪異 | `rate` 假設值只增不減（遇到下降當成重啟歸零） | gauge 直接看值，或用 `deriv`、`delta` |
| trace 在某個服務斷掉，變成兩個不相干的 trace | 那個服務沒有傳遞 `traceparent`，或經過佇列時沒放進訊息 metadata | 加上 instrumentation，或手動 inject／extract 上下文 |
| log 裡 stack trace 被切成好幾筆 | 用純文字輸出多行例外 | 例外放進結構化 log 的一個欄位 |
| 儀表板上的 p99 看起來很平滑，但使用者抱怨 | 圖表把各實例的百分位數取平均，或時間窗口太大 | 用 histogram 的 bucket 先加總再算；縮小窗口 |

## 動手

1. 執行結構化日誌那段，把 `asyncio.gather` 改成五個請求，確認每個請求的三行 log 都帶著同一個 `request_id`。
2. 執行百分位數那段，把慢請求的比例從 3% 改成 0.5%，看 p99 會不會「看不見」它們；再加一個 `0.3` 的 bucket 邊界，看估計值怎麼變。
3. 執行基數那段，算算看你自己的服務：有幾個路由、幾個 Pod、histogram 有幾個 bucket。
4. 到本課的程式題：從一串延遲樣本算 p50／p95／p99 與錯誤率，並輸出一行結構化 log。

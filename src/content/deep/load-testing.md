## 從一個具體問題開始：平均 120 ms，活動一開始就逾時

促銷活動前一週，團隊做了一次壓測：用工具對商品列表 `GET /products` 打了 30 秒，報告寫「平均回應時間 120 ms、錯誤 0」，結論是撐得住。活動開始十分鐘，結帳 API 的回應時間超過 8 秒，nginx 開始回 504，而資料庫的 CPU 只有 40%。

回頭看那次壓測：

| 當時的做法 | 問題 |
|---|---|
| 只看平均 120 ms | 少數很慢的請求被平均掉了 |
| 固定 10 個併發、打 30 秒 | 沒有加壓到出問題為止，不知道上限在哪 |
| 只打商品列表，而且回應有快取 | 沒測到結帳這條會寫資料庫、會呼叫金流的路徑 |
| 測試資料庫只有 1,000 筆商品 | 資料量差太多，查詢的行為和正式環境不同 |
| 沒有看資源指標 | 不知道哪個資源先滿；事後才知道是連線池 |

壓測要回答的問題有三個：系統在多少負載下還符合目標、上限在哪、**先撐不住的是哪個資源**。那份報告一個都沒回答。

## 平均值會騙人：看百分位數

100 個請求，90 個花 80 ms、10 個花 2,000 ms：

| 統計量 | 值 | 說明 |
|---|---|---|
| 平均 | 272 ms | 沒有任何一個請求花了 272 ms |
| p50（中位數） | 80 ms | 一半的請求不超過這個值 |
| p95 | 2,000 ms | 95% 的請求不超過這個值；剩下 5% 更慢 |
| p99 | 2,000 ms | 99% 的請求不超過這個值 |

只報平均，看不出每十個請求就有一個要等兩秒。而且使用者遇到慢請求的機會比 5% 高得多：一個頁面如果送出 10 個 API 請求，至少有一個落在最慢 5% 的機率是 1 − 0.95¹⁰ ≈ 40%（假設彼此獨立）。

所以壓測報告至少要有 **p50、p95、p99、錯誤率、吞吐**。兩個常見的陷阱：

- **失敗的請求通常很快**。5 ms 就回 500 的請求會把延遲統計拉低，錯誤率升高時，延遲要只算成功的請求，或兩者一起看。
- **百分位數不能再取平均**。各台機器的 p95 平均起來不是整體的 p95（原因與 histogram 的算法見 [可觀測性](#/skill/observability)）。

目標值從 SLO 來，例如「結帳 p95 低於 300 ms、錯誤率低於 1%」（見 [SLI、SLO 與錯誤預算](#/skill/slo-error-budget)）。

## 開放模型與封閉模型

壓測工具產生負載的方式有兩種，同一個系統用兩種方式會量到不同的結果：

| | 封閉模型（closed） | 開放模型（open） |
|---|---|---|
| 怎麼送 | 固定數量的虛擬使用者，各自「送出、等回應、再送下一個」 | 依設定的到達率送出，例如每秒 200 個，不管前面的回應回來了沒 |
| 控制的變數 | 併發數 | 每秒請求數 |
| 系統變慢時 | 送出的速度跟著變慢，負載自動下降 | 到達率不變，處理中的請求越積越多 |
| 接近哪種情況 | 數量固定的內部用戶端、批次工作 | 網路上的使用者：新來的人不會因為系統慢就晚點來 |

封閉模型裡，併發數、吞吐與回應時間被綁在一起：沒有思考時間時，**併發數 = 吞吐 × 平均回應時間**（Little's Law，見 [硬體資源與容量規劃](#/skill/capacity-planning)）。系統飽和之後吞吐不變，回應時間就只是隨併發數等比例變長，系統不會被壓垮。開放模型下，到達率一旦超過容量，排隊的請求會持續增加，延遲一路上升到逾時。對外的 API 比較接近開放模型，所以只用封閉模型測，看不到「過載之後越來越糟」的樣子。

封閉模型還有一個量測上的問題，叫 **coordinated omission**。概念是：工具在等一個慢回應時，不會送出下一個請求；本來在這段時間該送出、也會遇到同樣狀況的請求，沒有被送出，也沒有被記錄。假設原本每 10 ms 送一個請求，系統卡住 1 秒，工具只記到一筆 1 秒的樣本；照固定的到達率，這 1 秒內應該有大約 100 個請求進來，它們全都要等。結果是慢的時段被取樣得最少，百分位數被低估，卡得越久低估越多。對策是用固定到達率的方式產生負載，或至少知道手上的工具屬於哪一種、數字該怎麼解讀。

## 逐步加壓找飽和點

從很低的負載開始，一級一級往上加，每一級維持幾分鐘讓指標穩定，直到出問題為止。過程中會依序看到三個階段：

| 階段 | 吞吐 | 延遲 | 錯誤 |
|---|---|---|---|
| 飽和之前 | 跟著負載等比例上升 | 持平 | 沒有 |
| 飽和點附近 | 成長變少，然後不再上升 | p95、p99 先開始上升 | 零星的逾時 |
| 過載 | 持平，甚至下降 | 快速上升 | 逾時、5xx、連線被拒 |

**飽和點**是吞吐不再跟著負載上升的地方，也就是目前這組設定的容量上限。符合 SLO 的負載會比它低；正式環境平常的流量要再低一截，留下尖峰的餘裕。

找到飽和點只知道「上限在哪」，要知道「卡在哪」，每一級都要同時記錄資源指標：

| 指標 | 看什麼 |
|---|---|
| 吞吐（每秒完成的請求數） | 還有沒有跟著負載上升 |
| p50、p95、p99 延遲 | 尾端通常比中位數先惡化 |
| 錯誤率 | 逾時、5xx、被限流的 429 分開算 |
| API 與資料庫的 CPU | 哪一邊先接近 100% |
| 連線池等待 | 請求等連線等了多久、同時有幾個在等 |
| 慢查詢 | 低負載時不慢、加壓後才變慢的查詢（鎖等待、缺索引） |
| 壓測機自己的 CPU 與網路 | 壓測機先滿的話，量到的是壓測機的上限 |

判讀的原則是找**第一個滿的資源**。要注意「滿」的假象：同步的 worker 全部忙碌，不代表 CPU 不夠，它們可能都在等資料庫連線。使用率要和**等待時間**一起看（USE 方法，見 [可觀測性](#/skill/observability)）；資料庫端的連線與慢查詢怎麼查，見 [資料庫維運](#/skill/db-operations)。

## 實際程式：模擬 worker 與連線池

下面用事件模擬一個服務：16 個同步 worker、資料庫連線池 8 條。每個請求先佔住一個 worker，處理 5 ms，借一條連線做查詢（97% 是 30 ms、3% 是 200 ms 的慢查詢），還連線後再處理 5 ms 才回應。負載是封閉模型，併發數一級一級加上去。亂數用固定種子，每次執行的結果都一樣；所有數字都是示意，只用來看趨勢。

```python run
import heapq
import math
import random
from collections import deque

APP_S = 0.005          # 應用程式本身的處理：查詢前後各 5 ms
FAST_Q, SLOW_Q = 0.030, 0.200   # 97% 的查詢 30 ms、3% 打到慢查詢 200 ms
TIMEOUT_S = 0.300      # 用戶端等超過 300 ms 就當成失敗


def run_level(users, workers, pool, seconds=20.0, warmup=2.0, seed=7):
    """封閉模型：users 個虛擬使用者，各自「送出 → 等回應 → 立刻送下一個」。
    一個請求：佔住一個 worker → 應用程式 5 ms → 借一條連線查詢 → 還連線 → 應用程式 5 ms → 回應"""
    rng = random.Random(seed)                 # 固定種子：每次執行結果都一樣
    events, seq = [], 0                       # (時間, 序號, 事件, 請求)
    free_w, free_c = workers, pool
    wait_w, wait_c = deque(), deque()         # 排隊等 worker、等連線的請求
    area_w = area_c = 0.0                     # 使用中的數量 × 時間，用來算使用率
    last = 0.0
    samples = []                              # (延遲, 等連線的時間)

    def push(t, kind, req):
        nonlocal seq
        seq += 1
        heapq.heappush(events, (t, seq, kind, req))

    def start_work(t, req):
        push(t + APP_S, "need_conn", req)

    def start_query(t, req):
        req["conn_wait"] = t - req["asked"]
        push(t + (SLOW_Q if rng.random() < 0.03 else FAST_Q), "query_done", req)

    for _ in range(users):
        push(0.0, "arrive", {})

    while events:
        t, _, kind, req = heapq.heappop(events)
        if t > seconds:
            break
        lo = max(last, warmup)                # 暖機期間不列入統計
        if t > lo:
            area_w += (t - lo) * (workers - free_w)
            area_c += (t - lo) * (pool - free_c)
        last = t
        if kind == "arrive":
            req["start"] = t
            if free_w:
                free_w -= 1
                start_work(t, req)
            else:
                wait_w.append(req)
        elif kind == "need_conn":
            req["asked"] = t
            if free_c:
                free_c -= 1
                start_query(t, req)
            else:
                wait_c.append(req)            # worker 被佔著，但只是在等連線
        elif kind == "query_done":
            if wait_c:
                start_query(t, wait_c.popleft())   # 連線直接交給下一個在等的
            else:
                free_c += 1
            push(t + APP_S, "respond", req)
        else:                                 # respond
            if t >= warmup:
                samples.append((t - req["start"], req["conn_wait"]))
            if wait_w:
                start_work(t, wait_w.popleft())
            else:
                free_w += 1
            push(t, "arrive", {})             # 這個使用者立刻送下一個請求

    window = seconds - warmup
    lat = sorted(s[0] for s in samples)
    pct = lambda p: lat[math.ceil(p / 100 * len(lat)) - 1]
    return {
        "users": users,
        "rps": len(lat) / window,
        "p50": pct(50) * 1000, "p95": pct(95) * 1000, "p99": pct(99) * 1000,
        "errors": sum(1 for x in lat if x > TIMEOUT_S) / len(lat),
        "worker_util": area_w / (window * workers),
        "pool_util": area_c / (window * pool),
        "conn_wait": sum(s[1] for s in samples) / len(samples) * 1000,
    }


def ramp(workers, pool, levels=(4, 8, 12, 16, 24, 32, 48, 64)):
    print(f"worker {workers} 個、連線池 {pool} 條")
    print("  併發  吞吐rps  p50ms  p95ms  p99ms  錯誤率  worker使用率  連線池使用率  平均等連線ms")
    results = [run_level(u, workers, pool) for u in levels]
    for r in results:
        print(f"  {r['users']:>4} {r['rps']:>8.1f} {r['p50']:>6.0f} {r['p95']:>6.0f} {r['p99']:>6.0f} {r['errors']:>7.1%}"
              f" {r['worker_util']:>12.0%} {r['pool_util']:>13.0%} {r['conn_wait']:>13.1f}")
    # 飽和點：吞吐相對前一級成長不到 5% 的第一級
    knee = next((b for a, b in zip(results, results[1:]) if b["rps"] < a["rps"] * 1.05), None)
    # 瓶頸：加壓過程中第一個使用率到 97% 以上的資源
    first_full = next((r for r in results if max(r["worker_util"], r["pool_util"]) >= 0.97), None)
    if knee and first_full:
        which = "資料庫連線池" if first_full["pool_util"] >= first_full["worker_util"] else " worker "
        print(f"  -> 併發 {knee['users']} 起吞吐不再上升，容量約 {knee['rps']:.0f} rps；"
              f"最先滿的是{which}（併發 {first_full['users']} 時）")
    print()
    return results


base = ramp(workers=16, pool=8)
# 一次只改一件事：連線池 8 -> 16，其他不動，用同一組併發級再壓一次
tuned = ramp(workers=16, pool=16)
```

第一組（連線池 8 條）的結果可以這樣讀：

- **併發 4 到 8**：吞吐加倍、p95 不變，還在飽和之前。但 p99 一開始就是 210 ms：那 3% 的慢查詢在 p50 和 p95 裡完全看不到。
- **併發 12**：連線池使用率到 100%，開始出現等連線的時間；併發多了 50%，吞吐只多了不到三成。
- **併發 16 以後**：吞吐停在約 228 rps，p95 從 80 ms 一路升到 330 ms。併發 32 時，32 ÷ 228 ≈ 0.14 秒，和表上 130 ms 的 p50 相近，這就是 Little's Law。
- **worker 使用率在併發 16 也到了 100%**，但最先滿的是連線池（併發 12）。worker 是被等連線的請求佔住的；這時加 worker 沒有用。
- **錯誤到併發 32 才出現**。三個訊號的順序是吞吐先停、延遲再升、錯誤最後，等看到錯誤才發現就太晚了。

第二組只把連線池從 8 改成 16，其他不動：容量從約 228 升到約 356 rps，瓶頸換成 worker。這個模擬假設資料庫不會因為連線變多而變慢；真實的資料庫每多一條連線都有成本，連線數也有上限，所以每改一次都要重新壓一次，確認瓶頸移到哪裡。

:::stop 讀到這裡可以先停：會用百分位數看延遲、分辨開放與封閉模型，並從逐步加壓的結果找出飽和點與第一個滿的資源。後面的 k6 腳本與讓結果可信的條件，在要對自己的服務寫第一份壓測腳本時再回來讀。

## k6 腳本（示意）

k6 用 JavaScript 描述情境。下面是逐步加壓的最小寫法，只用到最基本的幾個欄位；細節與其他選項以官方文件為準：

```js
import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = {
  // 逐步加壓：每一級花 1 分鐘爬升，再維持 3 分鐘。target 是虛擬使用者數
  stages: [
    { duration: '1m', target: 20 },
    { duration: '3m', target: 20 },
    { duration: '1m', target: 40 },
    { duration: '3m', target: 40 },
    { duration: '1m', target: 80 },
    { duration: '3m', target: 80 },
    { duration: '1m', target: 0 },
  ],
  // 門檻：不符合時，這次執行會被判定為失敗
  thresholds: {
    http_req_duration: ['p(95)<300'],   // 95% 的請求在 300 ms 內
    http_req_failed: ['rate<0.01'],     // 失敗的請求少於 1%
  },
}

// 每個虛擬使用者重複執行這個函式
export default function () {
  const res = http.get(`${__ENV.BASE_URL}/products?page=1`)
  check(res, { 'status is 200': (r) => r.status === 200 })
  sleep(1)   // 思考時間：使用者看完頁面才會點下一個
}
```

幾點說明：

- `stages` 控制的是虛擬使用者數，所以這是**封閉模型**。k6 也能用固定到達率的方式送請求（在 `scenarios` 裡設定），寫法請查官方文件。
- 腳本雖然是 JavaScript，執行它的是 k6 自己的執行環境，不是 Node.js。
- 實際的情境不會只有一個網址：登入、瀏覽、加入購物車、結帳要依正式流量的比例混合，商品與使用者的 id 要分散。

其他常見工具的定位：

| 工具 | 定位 |
|---|---|
| Locust | 用 Python 描述使用者行為，有網頁介面可以看即時結果，能分散到多台機器送流量 |
| wrk | 命令列工具，對單一網址送出很高的請求量，適合快速量一個端點的上限，不適合多步驟的情境（hey 的定位相近） |

## 讓結果可信：環境、資料量、一次只改一件事

- **環境要像**。worker 數、連線池大小、資料庫參數和正式環境一致；規格比較小的話，要記下比例，結果只能推估，不能直接搬過去。
- **資料量要像**。1,000 筆的表上，沒有索引的查詢也很快（見 [索引與查詢計畫](#/skill/indexes)）。資料筆數要到正式環境的量級，分佈也要像：熱門商品、每個使用者的訂單數。
- **先暖機**。剛啟動時要建立連線、填快取，開頭一段時間的數字不列入統計。
- **外部服務換成替身**。金流、簡訊、寄信改接沙箱或 stub，並在報告裡註明這一段沒有被測到。
- **一次只改一件事**。先跑一次當基準；改一項（一個索引、連線池大小、worker 數）；用同一份腳本、同一份資料再跑一次。同時改兩項，結果變好變壞都無法歸因。
- **留下紀錄**。每次的 commit、設定、腳本版本與結果放在一起，同一組設定至少跑兩次，知道數字本身會晃動多少。

找到瓶頸之後怎麼擴展，見 [擴展](#/skill/scaling)。

## 常見錯誤與錯誤訊息

| 錯誤 | 會看到什麼 | 怎麼避免 |
|---|---|---|
| 壓測機自己先滿 | 吞吐上不去，但伺服器的 CPU 和連線池都還很閒 | 監看壓測機的 CPU 與網路；不要和被測的服務放在同一台；不夠就分散到多台 |
| 只測單一路徑 | 列表頁很快，上線後慢在結帳 | 依正式流量的比例混合讀與寫的路徑 |
| 快取是熱的 | 同一個網址打一萬次，全部命中快取，資料庫幾乎沒被測到 | 參數要分散；必要時分別量命中與沒命中的情況 |
| 沒有暖機 | 開頭幾秒的慢請求把 p99 拉高，每次跑的結果差很多 | 開頭一段不列入統計 |
| 壓測流量打到正式的外部服務 | 真的扣款、真的寄出通知，或被對方封鎖 | 外部服務一律接沙箱或 stub |

壓測過程中常見的訊息：

| 訊息 | 意思 | 接著查什麼 |
|---|---|---|
| `QueuePool limit of size 5 overflow 10 reached, connection timed out, timeout 30.00`（SQLAlchemy） | 連線池的連線都被借走，等到逾時還借不到 | 每條連線被佔多久：慢查詢、交易裡做了外部呼叫；不要直接把連線池加大 |
| `FATAL: sorry, too many clients already`（PostgreSQL） | 連線數到了 `max_connections` | 各服務的連線池加起來有沒有超過預算（見 [資料庫維運](#/skill/db-operations)） |
| nginx 回 `502` 或 `504` | 後端沒有回應，或沒在時限內回應 | nginx 的 error log、worker 有沒有被重啟（見 [應用伺服器與程序管理](#/skill/process-servers)） |
| 壓測工具回報大量連線失敗，伺服器的 log 卻沒有對應的請求 | 請求沒有送到服務：壓測機的資源用完，或被中間的限流、防火牆擋下 | 壓測機本身，以及中間每一層的 log |

## 動手

1. 執行模擬，把第一組改成 `ramp(workers=16, pool=4)`，預測容量會變成多少再看結果；再試 `ramp(workers=32, pool=8)`，確認加 worker 沒有幫助。
2. 把 `SLOW_Q` 改成 `0.5`，觀察 p50、p95、p99 哪一個先反映出來，容量又掉了多少。
3. 把慢查詢的比例從 `0.03` 改成 `0.06`，看 p95 在低負載時的變化，想想為什麼剛好跨過 5% 會讓 p95 跳一大段。
4. 程式題：[從各併發級的量測結果找出飽和點與安全上限](#/exercise/load-testing-1)。
5. 到[逐步加壓的實驗室](#/lab/LoadTestLab)調 worker 數與連線池，看飽和點怎麼移動。那個實驗室假設 worker 等資料庫時不被佔住（非同步 I/O），和上面模擬的同步 worker 不同，所以兩邊的上限算法不一樣。

## 從一個具體問題開始：從 1 台加到 4 台，問題反而變多

活動前夕，API 從 1 台擴到 4 台，前面加一台負載平衡器輪流分配請求。活動開始後陸續出現：

- **使用者被隨機登出**。session 存在每台 API 程序的記憶體裡。登入的請求落在 A 台，下一個請求被分到 B 台，B 台不認得這個 session。
- **剛上傳的頭像有一半機率 404**。檔案存在收到上傳那台機器的本機磁碟。
- **每天早上的對帳報表寄了 4 封**。排程寫在 web 程序裡，4 台各跑一次（見 [排程工作](#/skill/job-scheduling)）。
- **限流變鬆了 4 倍**。每台各自計數（見 [限流演算法](#/skill/rate-limiting)）。
- **尖峰時資料庫拒絕連線**，log 裡出現 `FATAL:  sorry, too many clients already`。每台 4 個 worker、每個 worker 的連線池最多 10 條，4 台就可能開到 160 條，PostgreSQL 的 `max_connections` 預設是 100。

前四個是同一個原因：**程式依賴了「只存在某一台機器上」的狀態**。最後一個是另一個原因：**API 可以一直加，共用的資料庫不行**。擴展的大部分工作，就是處理這兩件事。

## 無狀態：任何一台都能處理任何請求

水平擴展（加台數）的前提是 API **無狀態**：處理請求需要的資料都不在程序或本機上，而在所有實例共用的地方。這樣負載平衡器把請求送到哪一台都一樣，任何一台掛掉也不會遺失東西。

逐項檢查：

| 狀態 | 單機時常放在 | 多實例時搬到 |
|---|---|---|
| 登入 session | 程序記憶體、本機檔案 | Redis、資料庫，或簽章過的 cookie／token |
| 使用者上傳的檔案 | 本機磁碟 | 物件儲存（見 [物件儲存](#/skill/object-storage)） |
| 跨請求的暫存（多步驟表單、分段上傳） | 程序記憶體、`/tmp` | Redis 或物件儲存 |
| 快取 | `lru_cache`、全域 dict | 可接受短暫不一致就留在程序內；否則 Redis（見 [LRU 與快取淘汰](#/skill/lru-cache)） |
| 限流計數 | 程序記憶體 | Redis |
| 排程工作 | web 程序裡的排程器 | 獨立的排程程序或 CronJob |
| WebSocket 連線 | 連在某一台上 | 連線本身無法搬走；要廣播時，各台透過 Redis pub/sub 之類的機制互相轉送（見 [即時通訊的選擇](#/skill/realtime-choice)） |

負載平衡器的 sticky session（同一個使用者固定送到同一台）可以暫時遮住 session 問題，但那台重啟或被摘除時，上面的使用者還是會掉，而且流量會分不均。代價的細節見 [負載平衡](#/skill/load-balancing)。

最簡單的驗證方法：在本機或測試環境開兩個實例，前面用 nginx round-robin（見 [nginx 反向代理](#/lab/NginxLab) 實驗室），走一遍登入、上傳、多步驟流程；再隨機重啟其中一台，看有沒有東西壞掉。

## 水平擴展的上限：共用的資源

API 變成無狀態之後可以一直加台數，但每一台都連到同一個資料庫、同一個 Redis。加到某個數量之後，瓶頸就移到它們身上，再加 API 也沒用。

下面是一個示意模型（數字是假設的，不是量測結果）：每個請求在 API 花 20 ms CPU、在資料庫花 4 ms CPU，每台 API 2 核、資料庫 8 核：

```python run
# 示意模型：每個請求在 API 上花 20 ms CPU、在資料庫上花 4 ms CPU
API_CPU_MS, DB_CPU_MS = 20, 4
API_CORES_PER_INSTANCE, DB_CORES = 2, 8
WORKERS_PER_INSTANCE, POOL_PER_WORKER = 4, 10      # 每台 4 個 worker，每個 worker 的連線池上限 10 條
MAX_CONNECTIONS = 100                               # PostgreSQL 的預設值

def capacity(instances, cache_hit=0.0):
    api_rps = instances * API_CORES_PER_INSTANCE * 1000 / API_CPU_MS
    db_rps = DB_CORES * 1000 / (DB_CPU_MS * (1 - cache_hit))   # 命中快取的請求不碰資料庫
    conns = instances * WORKERS_PER_INSTANCE * POOL_PER_WORKER  # 尖峰時可能開到的連線數
    bottleneck = "API" if api_rps < db_rps else "資料庫"
    return min(api_rps, db_rps), bottleneck, conns

print(f"{'API 台數':>8} {'可承受 RPS':>10} {'瓶頸':>6} {'連線數上限':>10}")
for n in (1, 2, 4, 8, 16, 32):
    rps, neck, conns = capacity(n)
    warn = "  ← 超過 max_connections" if conns > MAX_CONNECTIONS else ""
    print(f"{n:>8} {rps:>10,.0f} {neck:>6} {conns:>10}{warn}")

print()
print("加快取（命中率 80%）之後：")
for n in (16, 32):
    rps, neck, conns = capacity(n, cache_hit=0.8)
    print(f"{n:>8} 台 {rps:>10,.0f} RPS，瓶頸在{neck}")

# 連線預算：台數固定時，每個 worker 的連線池最多能開多大
reserved = 10                                       # 留給管理工具、migration、監控
print()
for n in (4, 8, 16):
    per_worker = (MAX_CONNECTIONS - reserved) // (n * WORKERS_PER_INSTANCE)
    print(f"{n:>2} 台 × {WORKERS_PER_INSTANCE} worker：每個 worker 的連線池最多 {per_worker} 條")
```

這個模型裡，API 加到 32 台時瓶頸變成資料庫，加快取把資料庫的負擔降下來之後，瓶頸又回到 API。連線數更早出問題：4 台時，連線池全部開滿就會超過 `max_connections`。實際系統裡，連線池通常是需要時才建立連線，所以平常沒事，尖峰時才爆，這也是它難以在測試時發現的原因。

連線的解法是**連線池代理**（PgBouncer 的 transaction mode）：API 端可以開很多條「假連線」，PgBouncer 只用少數真正的資料庫連線輪流服務。怎麼算連線預算、transaction mode 有哪些限制，見 [資料庫維運](#/skill/db-operations)。

## 資料庫的擴展順序

資料庫有狀態，擴展起來代價高很多。依照成本由低到高：

| 步驟 | 解決什麼 | 代價 |
|---|---|---|
| 1. 找慢查詢、加索引 | 同樣的硬體做更少的工作 | 幾乎沒有；常常是最大的改善（見 [索引](#/skill/indexes)） |
| 2. 垂直擴展 | CPU、記憶體、磁碟 IOPS 不夠 | 錢；有上限；換規格可能要短暫停機 |
| 3. 連線池代理 | 連線數不夠 | 多一層；transaction mode 下有些 session 層級的功能不能用 |
| 4. 快取 | 讀取太多，而且同樣的資料被重複讀 | 失效與一致性（見 [Redis 快取](#/skill/redis-cache)） |
| 5. 讀寫分離 | 讀取太多，而且難以快取（查詢條件很多樣） | 副本延遲：「剛寫完立刻讀」可能讀到舊的 |
| 6. 表分割（partitioning） | 單一表太大，維護（vacuum、刪舊資料）太慢 | 查詢要帶分割鍵才能只掃部分分割；仍是同一台 |
| 7. 分片（sharding） | 寫入量或資料量超過一台的極限 | 跨分片的 JOIN、交易、唯一約束都變難，重新分片很痛 |

前四步通常能撐很久。跳過它們直接分片，是很常見的過度設計。各步驟的取捨也可以在設計情境 [資料庫撐不住了：連線池、讀寫分離、分片](#/scenario/db-scaling) 裡比較。

### 讀寫分離

一台主庫（primary）接受寫入，把變更（PostgreSQL 是 WAL）傳給一或多台副本（replica），副本只接受讀取。PostgreSQL 的 streaming replication 預設是非同步的：主庫 commit 後就回應，不等副本套用，所以副本永遠可能落後一點。

應用程式要做的事：

- **分兩組連線**：寫入與「必須讀到最新」的查詢走主庫，其他讀取走副本。
- **處理 read-your-writes**：使用者剛改完資料，下一個頁面讀副本，可能看到舊的。常見解法是寫入後一段時間內該使用者的讀取都走主庫，或帶著寫入時的版本（LSN）去讀。各種做法見 [分散式基礎](#/skill/distributed-basics) 與設計情境 [讀寫分離後的「我剛存的怎麼不見了」](#/scenario/replica-consistency)。
- **監控副本延遲**：延遲變大時，從副本讀的資料就越舊。

### 表分割與分片

**表分割**（PostgreSQL 10 起的宣告式分割）把一張大表依某個欄位（常見是時間）拆成多個分割，還在同一台資料庫裡。查詢條件帶到分割鍵時，規劃器只掃相關的分割；刪除舊資料可以直接卸下整個分割，不用跑大量 `DELETE`。它解決的是「一張表太大」，不是「一台機器不夠」。

**分片**把資料拆到多台資料庫。最關鍵的決定是**分片鍵**：

- 選**大部分查詢都會帶的欄位**，例如多租戶系統的 `tenant_id`、社群服務的 `user_id`。一個請求只需要碰一個分片。
- 分佈要平均，而且要注意**熱點**：一個超大租戶或一個名人帳號，會讓它所在的分片特別忙。
- 不帶分片鍵的查詢（「全站最新的 20 篇文章」）要查所有分片再合併，跨分片的交易與唯一約束要另外設計。

依租戶拆分還有「每個租戶一個 schema／資料庫」這類做法，見設計情境 [多租戶的資料隔離](#/scenario/multi-tenant)。

## 實際程式：key 怎麼對應到分片

最直覺的做法是 `hash(key) % N`。問題在於台數 N 一改變，幾乎所有 key 的位置都會變，等於要搬動幾乎全部的資料。下面比較三種做法從 4 台加到 5 台時要搬多少：

```python run
import hashlib
from bisect import bisect
from collections import Counter

def h(s: str) -> int:
    # 穩定的 hash：Python 內建的 hash() 對字串每次啟動都不同（有隨機種子），不能拿來分片
    return int.from_bytes(hashlib.md5(s.encode()).digest()[:8], "big")

users = [f"user:{i}" for i in range(20_000)]

# 做法一：hash(key) % N
def mod_n(key, n):
    return h(key) % n

# 做法二：一致性雜湊。每台機器在環上放 100 個虛擬節點，key 順時針找第一個節點
class Ring:
    def __init__(self, nodes, vnodes=100):
        self.points = sorted((h(f"{node}#{v}"), node) for node in nodes for v in range(vnodes))
        self.hashes = [p for p, _ in self.points]
    def lookup(self, key):
        i = bisect(self.hashes, h(key)) % len(self.points)
        return self.points[i][1]

# 做法三：固定數量的邏輯分片（slot），再把 slot 分配給機器；加機器時只搬一部分 slot
SLOTS = 1024
def slot_of(key):
    return h(key) % SLOTS

def assign_slots(nodes):
    return {s: nodes[s % len(nodes)] for s in range(SLOTS)}

def rebalance(old, nodes):
    # 新機器從每台舊機器各拿一些 slot，直到數量接近平均；其餘 slot 不動
    new = dict(old)
    target = SLOTS // len(nodes)
    counts = Counter(new.values())
    newcomer = nodes[-1]
    for s in range(SLOTS):
        owner = new[s]
        if counts[newcomer] >= target:
            break
        if owner != newcomer and counts[owner] > target:
            new[s] = newcomer
            counts[owner] -= 1
            counts[newcomer] += 1
    return new

old_nodes = ["db-a", "db-b", "db-c", "db-d"]
new_nodes = old_nodes + ["db-e"]

moved = sum(mod_n(u, 4) != mod_n(u, 5) for u in users)
print(f"hash % N（4 → 5 台）：{moved / len(users):.0%} 的 key 要搬家")

r4, r5 = Ring(old_nodes), Ring(new_nodes)
moved = sum(r4.lookup(u) != r5.lookup(u) for u in users)
print(f"一致性雜湊（4 → 5 台）：{moved / len(users):.0%} 的 key 要搬家")
print("  5 台的分佈：", dict(sorted(Counter(r5.lookup(u) for u in users).items())))

s4 = assign_slots(old_nodes)
s5 = rebalance(s4, new_nodes)
moved = sum(s4[slot_of(u)] != s5[slot_of(u)] for u in users)
print(f"固定 {SLOTS} 個 slot（4 → 5 台）：{moved / len(users):.0%} 的 key 要搬家，"
      f"搬了 {sum(s4[s] != s5[s] for s in range(SLOTS))} 個 slot")

# 熱點：分得再平均，一個超級熱門的 key 還是只落在一台
traffic = Counter()
for i in range(100_000):
    key = "user:celebrity" if i % 5 == 0 else users[i % len(users)]   # 兩成流量打同一個 key
    traffic[r5.lookup(key)] += 1
print("  流量分佈（含一個熱門 key）：", dict(sorted(traffic.items())))
```

這次執行的結果：`% N` 約 80% 的 key 要搬（理論值也是 80%：只有 `h % 4` 與 `h % 5` 剛好相同的才不用搬），一致性雜湊與固定 slot 都約 20%，接近「新機器該分到的五分之一」的最小值。一致性雜湊的分佈不完全平均，虛擬節點越多越平均。固定 slot 是很多系統採用的做法，例如 Redis Cluster 固定有 16384 個 hash slot，加節點時搬的是 slot。最後一行顯示熱門 key 的問題：分片分得再平均，那一台還是多承擔了兩成的流量。

## 用快取與佇列吸收尖峰

不是每個尖峰都要靠加機器：

- **讀取尖峰**：同樣的內容被很多人讀（商品頁、首頁），用 CDN 與快取擋掉大部分，資料庫只處理未命中。要注意快取同時到期時的瞬間壓力，見設計情境 [快取到期的瞬間](#/scenario/edge-cache)。
- **寫入尖峰**：不需要立刻完成的工作（寄信、通知、統計）丟進佇列，用固定數量的 worker 以資料庫撐得住的速度消化，見 [訊息佇列與背景工作](#/skill/queues-workers)。
- **自動擴展**：依 CPU 或佇列深度自動加減實例（Kubernetes 的 HPA 等）。新實例要時間啟動、要通過 readiness 檢查才接流量，所以它跟不上「幾秒內暴增十倍」的尖峰；已知的活動時間最好事先擴好。資料庫不會跟著 API 自動擴展，API 擴得越快，越要先確認連線預算。

從 100 到 10 萬 QPS 每一階段的選擇，見設計情境 [從 100 到 10 萬 QPS](#/scenario/scale-path)。

## 先量測，再擴展

不知道瓶頸在哪就加機器，常常是加錯地方。壓力測試（k6、Locust 等工具）的做法：

1. 用接近真實的請求組合（讀寫比例、熱門資料的分佈），逐步加壓。
2. 看 **p95 / p99 延遲**與錯誤率，不是平均值。平均值會把少數很慢的請求藏起來。
3. 找第一個飽和的資源：資料庫的 CPU、連線數、鎖等待、連線池的等待時間、某一條慢查詢。很多時候不是 API 的 CPU。
4. 修掉它，再壓一次，找下一個。

容量怎麼從尖峰人數推到機器規格，見 [容量規劃](#/skill/capacity-planning) 與 [容量估算](#/lab/CapacityLab) 實驗室。

## 常見錯誤與錯誤訊息

| 錯誤訊息或現象（類似） | 原因 | 修法 |
|---|---|---|
| `FATAL:  sorry, too many clients already` | 連到 PostgreSQL 的連線數超過 `max_connections` | 算連線預算、縮小每個 worker 的池子、加 PgBouncer |
| `remaining connection slots are reserved for …`（後半段依版本不同） | 一般連線用完，只剩保留給超級使用者的名額 | 同上 |
| SQLAlchemy：`QueuePool limit of size 5 overflow 10 reached, connection timed out, timeout 30.00` | 應用程式端的連線池用完，請求在排隊等連線 | 找出長時間佔用連線的程式（交易裡做 I/O）；再考慮調整池子大小 |
| 副本上的長查詢被中止：`canceling statement due to conflict with recovery` | 副本要套用主庫的變更，和副本上正在跑的查詢衝突 | 報表類的長查詢放專用副本，調整 `max_standby_streaming_delay` 或 `hot_standby_feedback`（各有代價） |
| 使用者隨機被登出 | session 存在程序記憶體 | session 放 Redis 或資料庫 |
| 上傳的檔案時有時無 | 檔案存在本機磁碟 | 物件儲存 |
| 剛存的資料重新整理後不見 | 讀到落後的副本 | read-your-writes 策略 |
| 加了 API 機器，延遲沒有改善 | 瓶頸在資料庫或某個外部服務 | 先量測找瓶頸 |
| 某一個分片特別忙 | 分片鍵分佈不均或有熱門 key | 換分片鍵、把熱門 key 另外處理（快取、拆分） |

## 動手

1. 在 Playground 跑容量模型，把 `DB_CPU_MS` 改成 8（假設少了一個索引，每個請求的查詢變慢），看瓶頸提早在第幾台換到資料庫；再把 `POOL_PER_WORKER` 改成 2，看連線數什麼時候超過上限。
2. 跑分片那段，把 `vnodes` 從 100 改成 10 和 500，觀察分佈的均勻程度；把 `SLOTS` 改成 16，看「搬多少」與「分得多平均」的取捨。
3. 程式題：[讀寫分離的路由：寫後一段時間讀主庫](#/exercise/scaling-1)。
4. 設計情境：[從 100 到 10 萬 QPS](#/scenario/scale-path)、[資料庫撐不住了](#/scenario/db-scaling)、[讀寫分離後的「我剛存的怎麼不見了」](#/scenario/replica-consistency)。
5. 開 [Deployment 與滾動更新](#/lab/K8sLab) 實驗室，調整副本數、關掉一台節點，看流量怎麼移動。

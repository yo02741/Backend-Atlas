## 從一個具體問題開始：「建議規格 32 核、128 GB」

一家醫院要上線新的檢驗報告查詢系統，廠商的建議規格是三台主機、每台 32 核 CPU、128 GB 記憶體、2 TB SSD。採購會議上有人問：「這個數字怎麼來的？」廠商回答：「依我們其他客戶的經驗。」

這個答案沒辦法檢驗。規格買太小，上線第一個尖峰就變慢；買太大，錢花在永遠用不到的資源上，而且之後要求擴充時沒有依據。容量規劃要做的，是把「要多大」變成一串**可以檢查的計算**：每個數字都來自量測或明確的假設，假設錯了也知道要改哪一個。

這一課依序估 CPU、同時連線數、記憶體、磁碟容量、IOPS、網路頻寬，最後講這些數字在 VM 與 Kubernetes 上怎麼落實。

## 先找尖峰，不要用平均

系統要扛的是**最忙的那一刻**。一天 120 萬個請求，平均每秒約 14 個，但請求不會平均分布：門診開始、上班第一個小時、批次報表啟動時，流量可能是平均的好幾倍。

從存取 log 統計三個數字：

| 數字 | 怎麼取得 | 例子 |
|---|---|---|
| 一天的請求數 | log 行數，或監控的請求計數 | 1,200,000 |
| 尖峰小時佔全天的比例 | 依小時分組統計，取最大的那一小時 | 18% |
| 突發倍數 | 尖峰小時內，最忙的一分鐘是該小時平均的幾倍 | 2 倍 |

尖峰每秒請求數（RPS）= 1,200,000 × 18% ÷ 3600 × 2 = **120 RPS**。平均值 14 RPS 拿去規劃，會差將近九倍。

新系統還沒有 log 時，用舊系統的 log、或從業務量推估（例如每個門診病人平均會查幾次報告、尖峰時段有多少病人），並把這個假設寫下來，上線後用實際數據校正。

## CPU：看的是 CPU 時間，不是回應時間

一個請求回應時間 250 毫秒，不代表它佔用 CPU 250 毫秒。大部分時間它可能在等資料庫、等網路，CPU 是空的。容量計算要用**每個請求實際消耗的 CPU 時間**：

```text
需要的核心數 = 尖峰 RPS × 每個請求的 CPU 時間 ÷ 目標使用率
```

每個請求用 40 毫秒 CPU、尖峰 120 RPS 時，CPU 忙碌的量是 120 × 0.04 = 4.8 核。CPU 用到 100% 時排隊時間會急遽變長，所以除以目標使用率（例如 65%）：4.8 ÷ 0.65 ≈ 7.4 核。

每個請求的 CPU 時間怎麼來：壓力測試時，用固定的 RPS 打一段時間，看 CPU 使用了幾核，除以 RPS。例如 50 RPS 時用掉 2 核，每個請求就是 0.04 核秒。

## 同時連線數：Little's Law

**Little's Law**：一個穩定的系統裡，

```text
L = λ × W
L：系統裡同時存在的請求數
λ：到達率（每秒進來幾個）
W：每個請求平均停留多久（秒）
```

它不依賴任何分布假設，只要系統穩定（進來的速度不持續大於處理的速度）就成立。用途：

- **worker / thread 數**：120 RPS、每個請求停留 0.25 秒，同時在處理的請求平均就有 120 × 0.25 = 30 個。同步的 worker 一次處理一個請求，就至少要 30 個 worker，再加上餘裕。
- **資料庫連線池**：每個請求平均使用資料庫 0.12 秒，同時佔用的連線數約 120 × 0.12 ≈ 14.4 條。連線池設 10 條一定不夠。
- **看出連鎖反應**：資料庫變慢、每個請求停留時間從 0.12 秒變成 0.6 秒，同時佔用的連線數就變成 72 條。連線池只有 30 條時，其他請求開始排隊等連線，回應時間跟著變長，W 再上升——這就是「資料庫一慢，整個系統卡死」的機制。

## 記憶體：不能壓縮的資源

CPU 不夠時，程式變慢；記憶體不夠時，程式被殺掉（Linux 的 OOM killer）或開始使用 swap，慢到像停止。所以記憶體要估的是**最壞情況的總和**：

```text
每台記憶體 ≈ worker 數 × 每個 worker 的常駐記憶體 + 快取 + 作業系統與其他程序
```

每個 worker 的常駐記憶體（RSS）用 `ps -o rss,cmd -C <程式名>` 或監控工具在壓力測試後觀察，**取尖峰後的值**——很多程式處理大請求後記憶體不會還給作業系統。

資料庫主機另外算：PostgreSQL 的 `shared_buffers`（常見起點是記憶體的 25% 左右）、每條連線的開銷、排序與雜湊用的 `work_mem`（每個查詢的每個排序步驟都可能用一份），以及留給作業系統檔案快取的空間。

## 磁碟：容量、IOPS、吞吐量是三件事

### 容量

```text
主要磁碟 = （現有資料 + 每月成長 × 月數）×（1 + WAL / log / 暫存的比例）÷ 目標使用率
備份空間 = 完整備份大小 × 保留份數 + 增量備份的總和
```

幾個容易漏掉的部分：

- **成長不只是資料列**：索引、稽核紀錄、附件檔案都會長。從過去 6–12 個月的實際成長量推，比「每筆資料幾 KB」準。
- **WAL 與 log**：PostgreSQL 的 WAL、應用程式 log、稽核 log 都需要空間，複寫落後或歸檔失敗時 WAL 會持續累積。
- **維運作業需要暫時空間**：重建索引、大型 migration、`VACUUM FULL` 可能暫時需要和資料表一樣大的空間。磁碟到 90% 時才想做這些事，會做不了。
- **備份不放在同一顆磁碟**：放同一顆磁碟的備份，磁碟壞掉時一起不見。備份空間單獨計算。

### IOPS 與吞吐量

| 指標 | 意思 | 誰在乎 |
|---|---|---|
| IOPS | 每秒讀寫幾次 | 資料庫：大量小的隨機讀寫（讀一個索引頁、寫一筆 WAL） |
| 吞吐量（MB/s） | 每秒讀寫多少資料 | 備份、批次匯出、影像檔：大塊的連續讀寫 |
| 延遲（ms） | 每次讀寫要等多久 | 交易型系統：每次 commit 都要等 WAL 寫入完成 |

這三個數字互相獨立。一顆磁碟可能吞吐量很高、隨機 IOPS 很低（傳統硬碟就是如此，隨機 IOPS 的量級大約是每顆數百次以內，SSD 可以高出好幾個數量級）。雲端的磁碟常**依容量或付費等級限制 IOPS**，容量買小了 IOPS 也跟著小。

資料庫「變慢」常常不是空間不夠，而是 IOPS 或延遲到頂。在 Linux 上用 `iostat -x 1` 觀察：

```bash
$ iostat -x 1
Device   r/s     w/s     rkB/s    wkB/s   r_await  w_await  aqu-sz  %util
nvme0n1  850.0   1240.0  13600.0  19840.0   0.42     1.10     1.72   38.5
sdb      180.0   95.0    2880.0   1520.0   18.60    42.30     8.90   99.2
```

`r/s`、`w/s` 是每秒讀寫次數（IOPS），`r_await`、`w_await` 是每次讀寫的平均等待時間（毫秒），`aqu-sz` 是平均排隊長度。上例的 `sdb` 每次寫入等 42 毫秒、排隊長度接近 9，這顆磁碟已經是瓶頸。（`%util` 對 SSD、RAID 這類能並行處理的裝置參考價值有限；看 await 與排隊長度比較可靠。欄位依 sysstat 版本略有不同。）

要在採購前量測，用 `fio` 模擬資料庫的讀寫模式（例如 4 KB 隨機讀寫）跑一次，比看規格表上的最大值可靠。

## 網路頻寬

```text
頻寬（bit/s）= 每秒傳輸的位元組 × 8
```

- **一般 API**：120 RPS × 每個回應 60 KB = 7.2 MB/s ≈ 58 Mbps。通常不是瓶頸。
- **影像、檔案下載**：醫學影像、掃描文件動輒數 MB 到數百 MB，數十個人同時下載就會用滿 1 Gbps。
- **備份與複寫**：每晚要在 4 小時內把 2 TB 備份傳到另一個機房，需要 2 × 10¹² × 8 ÷ 14,400 ≈ 1.1 Gbps 的持續頻寬——比白天的 API 流量大得多。異地備援的專線頻寬常常是被這個數字決定的。

## 留 headroom 與 N+1

估出來的數字不能直接拿去買，還要留兩種餘裕：

1. **使用率餘裕**：尖峰時 CPU 用到 60–70%，留空間給估不準的部分、突發流量、背景作業（備份、批次）。
2. **故障餘裕（N+1）**：三台主機分擔流量時，要問「壞掉一台，剩下兩台扛不扛得住尖峰」。如果三台平常各用 70%，壞一台後剩下兩台要各扛 105%——服務會跟著倒。N+1 的意思是：**用 N 台就能扛住尖峰，再多準備 1 台**。

再加上成長：系統預計用幾年、每年業務量成長多少，硬體採購週期內都要夠用，或確定之後能擴充（加記憶體、加節點）。

## 實際計算

把上面的步驟寫成一段程式，每個輸入都是可以替換的假設：

```python run
import math

# ── 輸入：從 log、壓力測試與監控取得（以下是虛構的範例數字） ──
daily_requests   = 1_200_000  # 一天的請求數
peak_hour_share  = 0.18       # 尖峰小時佔全天的比例
burst_factor     = 2.0        # 尖峰小時內最忙一分鐘相對該小時平均的倍數
latency_s        = 0.25       # 每個請求平均停留時間（秒），含等資料庫
cpu_per_req_s    = 0.040      # 每個請求實際消耗的 CPU 時間（核秒）
db_time_s        = 0.12       # 每個請求平均佔用資料庫連線的時間（秒）
target_util      = 0.65       # 尖峰時希望 CPU 用到多少
mem_per_worker   = 180        # 每個 worker 的常駐記憶體（MB）
base_mem         = 2048       # 作業系統與其他程序（MB）
resp_kb          = 60         # 平均回應大小（KB）
nodes            = 3          # 應用程式主機台數

# ── 尖峰流量 ──
peak_rps = daily_requests * peak_hour_share / 3600 * burst_factor
print(f"尖峰 RPS：{peak_rps:.0f}（全天平均只有 {daily_requests / 86400:.1f}）")

# ── Little's Law：同時在處理的請求、同時佔用的資料庫連線 ──
in_flight = peak_rps * latency_s
db_conns = peak_rps * db_time_s
print(f"同時處理中的請求：{in_flight:.0f}；同時佔用的 DB 連線：{db_conns:.1f}")

# ── N+1：壞一台時，剩下的 nodes-1 台要扛全部尖峰 ──
per_node_rps = peak_rps / (nodes - 1)
cores = per_node_rps * cpu_per_req_s / target_util
workers = math.ceil(per_node_rps * latency_s * 1.5)   # 同時請求數再加 50% 餘裕
mem_mb = workers * mem_per_worker + base_mem
print(f"\n每台（N+1，假設壞一台）：扛 {per_node_rps:.0f} RPS")
print(f"  CPU：{cores:.1f} 核 → 買 {math.ceil(cores)} vCPU 以上")
print(f"  worker：{workers} 個；記憶體：{mem_mb / 1024:.1f} GB → 買 {2 ** math.ceil(math.log2(mem_mb / 1024))} GB")

# ── 頻寬 ──
mbps = peak_rps * resp_kb * 1000 * 8 / 1_000_000   # KB 以 1000 位元組計
print(f"\n尖峰對外頻寬：約 {mbps:.0f} Mbps")

# ── 資料庫磁碟：5 年 ──
db_now_gb, growth_gb_month, years = 300, 12, 5
overhead = 0.10      # WAL、log、暫存
disk_target = 0.70   # 磁碟用到 70% 就要擴充
data_gb = db_now_gb + growth_gb_month * 12 * years
disk_gb = data_gb * (1 + overhead) / disk_target
print(f"\n{years} 年後資料量：{data_gb} GB；主要磁碟至少：{disk_gb:,.0f} GB")

# 備份：保留 4 份每週完整備份 + 每天一份增量（約完整的 3%）
full_copies, daily_incr_ratio, incr_days = 4, 0.03, 6 * 4
backup_gb = data_gb * full_copies + data_gb * daily_incr_ratio * incr_days
print(f"備份空間（另一台儲存）：約 {backup_gb:,.0f} GB")

# ── 情境：資料庫變慢五倍，連線池 30 條夠不夠？ ──
slow_db_conns = peak_rps * db_time_s * 5
print(f"\n若 DB 變慢 5 倍：需要 {slow_db_conns:.0f} 條連線 > 連線池 30 → 請求開始排隊")
```

用範例數字算出來，每台約 4 vCPU、8 GB 記憶體就夠扛 N+1 的尖峰。和「32 核、128 GB」差了將近一個數量級——不代表廠商一定錯（也許他們的程式每個請求用掉的 CPU 遠多於 40 毫秒），而是有了計算之後，會議上可以問具體的問題：「貴系統每個請求的 CPU 時間是多少？壓力測試報告在哪？」

把 `cpu_per_req_s` 改成 0.2、`burst_factor` 改成 4，看看結果怎麼變，就知道哪一個假設對結論影響最大，那就是最需要量測的數字。

## VM 與容器

| | VM | 容器 |
|---|---|---|
| 隔離 | 每台有自己的作業系統核心，由 hypervisor 隔離 | 共用主機核心，用 namespace 隔離、cgroup 限制資源 |
| 啟動 | 數十秒到數分鐘 | 通常數秒 |
| 資源超賣 | hypervisor 常允許分配的 vCPU 總數超過實體核心數 | 由 cgroup 與排程器決定，同樣可以超賣 |
| 容量規劃的重點 | 實體主機的超賣比例、同一台實體機上的其他 VM | 每個容器的 requests / limits、節點的可分配資源 |

VM 上要注意**超賣**：一台 VM 有 8 vCPU，不代表隨時能用到 8 顆實體核心。同一台實體機上的其他 VM 也忙時，VM 會等不到 CPU。Linux VM 裡用 `top` 看 `st`（steal time）：持續偏高，代表 hypervisor 沒有給這台 VM 足夠的 CPU 時間，加 vCPU 也沒用。

## Kubernetes：requests、limits 與排程

Kubernetes 把容量規劃寫成每個容器的設定：

```yaml
containers:
  - name: api
    image: registry.example.org/report-api:1.4.2
    resources:
      requests:          # 排程時保留：節點上要有這麼多「未被保留」的資源才會放上去
        cpu: "500m"      # 0.5 核
        memory: "512Mi"
      limits:            # 執行時的上限
        memory: "512Mi"  # 超過就被 OOMKilled
        cpu: "1"         # 超過不會被殺，會被限流（throttle）
```

### requests 決定排程

排程器只看 **requests**，不看實際用量。一個節點可分配的資源（allocatable）是硬體減去系統與 kubelet 保留的部分；節點上所有 Pod 的 requests 加起來到頂後，新的 Pod 就放不上去，停在 `Pending`：

```bash
$ kubectl describe pod report-api-7c9f8d6b5-x2k4q
...
Events:
  Type     Reason            Age   From               Message
  ----     ------            ----  ----               -------
  Warning  FailedScheduling  12s   default-scheduler  0/3 nodes are available: 3 Insufficient memory. preemption: 0/3 nodes are available: 3 No preemption victims found for incoming pod.
```

（訊息後半依 Kubernetes 版本不同。）requests 設太大，節點明明很閒卻放不下新 Pod；設太小，排程器以為放得下，實際用量把節點擠爆。requests 應該接近**正常尖峰時的實際用量**。

### 記憶體超過 limit：OOMKilled

容器的記憶體用量超過 limit 時，核心直接殺掉程序，容器重啟：

```bash
$ kubectl get pod
NAME                         READY   STATUS      RESTARTS      AGE
report-api-7c9f8d6b5-x2k4q   0/1     OOMKilled   3 (40s ago)   6m

$ kubectl describe pod report-api-7c9f8d6b5-x2k4q
    Last State:     Terminated
      Reason:       OOMKilled
      Exit Code:    137
```

Exit Code 137 = 128 + 9（SIGKILL）。處理方式：先確認是真的需要更多記憶體（看 `kubectl top pod` 或監控的記憶體曲線），還是記憶體洩漏（用量隨時間一路上升、不回落）。前者調高 limit 與 request；後者調高只是延後被殺的時間。

另一個常見原因是程式不知道自己在容器裡：有些執行環境依**整台節點**的記憶體決定堆積大小或快取大小，結果超過容器的 limit。較新版本的 JVM 會讀 cgroup 限制；其他執行環境要確認或手動設定上限。

### CPU 超過 limit：throttling

CPU 是可壓縮的資源。超過 limit 時容器不會被殺，而是在每個排程週期（預設 100 毫秒）用完配額後被暫停，等下一個週期。結果是**回應時間變長、但 CPU 使用率看起來不高**——平均使用率可能只有 limit 的一半，但瞬間的突發被限流了。

用 cAdvisor 的指標 `container_cpu_cfs_throttled_periods_total` 與 `container_cpu_cfs_periods_total` 的比例判斷：被限流的週期比例偏高，就是 CPU limit 太緊。因為這個現象，有些團隊選擇只設 CPU requests、不設 CPU limits，讓容器能借用節點上閒置的 CPU；這是常見做法之一，是否採用要看叢集是否有其他資源隔離的需求。

### QoS 等級

| QoS | 條件 | 節點記憶體不足時 |
|---|---|---|
| Guaranteed | 每個容器的 CPU 與記憶體都設了 requests = limits | 最後被驅逐 |
| Burstable | 有設 requests 但不符合 Guaranteed | 依超用程度驅逐 |
| BestEffort | 完全沒設 requests 與 limits | 最先被驅逐 |

資料庫這類重要的有狀態服務適合 Guaranteed；沒設任何資源的 Pod 是 BestEffort，節點一緊就先被趕走。

## 常見錯誤

- **用平均值規劃**：平均 14 RPS、尖峰 120 RPS，用平均值買的硬體在尖峰時一定不夠。
- **用回應時間算 CPU**：回應時間包含等資料庫、等網路，會把 CPU 需求高估好幾倍。
- **忘了 N+1**：三台各用 70%，壞一台就全倒。
- **只看磁碟容量**：容量夠但 IOPS 不夠，資料庫照樣慢。雲端磁碟的 IOPS 常跟容量綁在一起。
- **備份和資料放同一處**：磁碟或儲存設備故障時一起遺失。
- **K8s 不設 requests**：Pod 變成 BestEffort，排程器不知道它要多少資源，節點過度擁擠時最先被驅逐。
- **把 limit 調高當成解法**：OOMKilled 的原因是洩漏時，調高 limit 只是讓它晚一點死。

## 動手

1. 執行上面的估算程式，把 `nodes` 改成 2，看 N+1 的計算怎麼變（壞一台時只剩一台扛全部）。
2. 把 `db_time_s` 改成 0.5，看同時佔用的資料庫連線數，對照自己系統的連線池設定。
3. 從一個既有系統的 log 算出三個數字：一天的請求數、尖峰小時比例、突發倍數，取代範例的假設。
4. 在一台 Linux 主機上跑 `iostat -x 1` 一分鐘，找出 await 最高的磁碟。
5. 接著讀 [導入 Kubernetes 前要準備什麼](#/skill/k8s-readiness)，看 requests / limits 在整個叢集規劃中的位置。

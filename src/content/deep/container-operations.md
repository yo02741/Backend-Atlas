## 從一個具體問題開始：同一週的兩件事

院內的批價繳費系統跑在兩台 VM 上，每台用 Docker Engine 跑三個容器，映像都放在院內的 Harbor：

| 容器 | 做什麼 | 主行程 |
|---|---|---|
| `nginx` | 對外的入口，把 `/api/` 轉給 `billing-api` | nginx |
| `billing-api` | Flask 後端：產生收據 PDF（cairo、pango），送到批價櫃檯的印表機（cups） | `gunicorn -w 1 --threads 50 --keep-alive 75 …` |
| `payment-socket` | 自助繳費機與櫃檯刷卡機用長連線連進來，每筆交易在同一條連線上一問一答 | `python payment_server.py` |

`billing-api` 與 `payment-socket` 出自同一份 Dockerfile 的兩個 target，都以 root 執行。

**週二早上 7:40**，批價櫃檯回報收據印不出來。`billing-api` 的 log 最後一行：

```text
OSError: [Errno 28] No space left on device: '/tmp/receipt-20261110-0412.pdf'
```

`df -h` 顯示根分割區 100%。往下找：

```bash
$ sudo du -sh /var/lib/docker/* 2>/dev/null | sort -h | tail -3
3.1G    /var/lib/docker/image
6.8G    /var/lib/docker/overlay2
41G     /var/lib/docker/containers

$ sudo ls -lh /var/lib/docker/containers/7f3e2a91c0d7…/
-rw-r----- 1 root root  41G Nov 10 07:41 7f3e2a91c0d7…-json.log
```

41 GB 是 `billing-api` 上線以來寫到 stdout 的每一行。Docker 預設的 json-file 日誌不輪替；上週三有人為了查對帳差異把 log 等級調成 DEBUG，忘了改回來，之後每天多寫 7 GB。

**同一週**，每次更新 `payment-socket`，`docker compose up -d` 都停在 `Stopping` 約 10 秒。週四更新後，有兩筆刷卡交易在終端機上顯示逾時，要人工和銀行對帳。`docker events` 留下了經過（省略部分欄位）：

```text
2026-11-12T12:30:04.112+08:00 container kill 5b9d… (name=payment-socket, signal=15)
2026-11-12T12:30:14.126+08:00 container kill 5b9d… (name=payment-socket, signal=9)
2026-11-12T12:30:14.309+08:00 container die 5b9d… (exitCode=137, name=payment-socket)
```

SIGTERM（15）送出 10 秒後，Docker 改送 SIGKILL（9），結束碼 137。`payment_server.py` 是 PID 1 而且沒有處理 SIGTERM，訊號被忽略（原理見 [Docker：image、container、layer](#/skill/docker-basics)），這 10 秒裡它照常接交易，第 10 秒時手上的交易一起被切斷。

兩件事都發生在容器跑起來之後。這一課依序講查問題的指令、日誌、資源上限、重啟策略、訊號與關機、以非 root 執行，最後是 Docker 以外的容器執行環境，以及搬上 Kubernetes 之後哪些指令要換。

## 查問題的指令

| 指令 | 回答的問題 | 實際用途 |
|---|---|---|
| `docker ps -a` | 有哪些容器、狀態、結束碼 | `Exited (137) 2 hours ago`、`Restarting (1) 4 seconds ago` 一眼看出誰有事；不加 `-a` 看不到已經結束的 |
| `docker logs` | 主行程寫到 stdout、stderr 的內容 | `--since 30m` 看一段時間、`--tail 200` 看最後幾行、`-f` 持續跟著看、`-t` 加上時間 |
| `docker exec` | 在執行中的容器裡跑指令 | 看程式實際拿到的環境變數與設定檔、從容器的位置測連線 |
| `docker inspect` | 完整的設定與狀態（JSON） | 結束碼、`OOMKilled`、重啟次數、記憶體上限、日誌設定、掛載、執行的使用者 |
| `docker stats` | 當下的 CPU、記憶體、I/O、行程數 | 記憶體是不是一天比一天高、CPU 是不是卡在某個值 |
| `docker events` | Docker 對容器做了什麼、什麼時候 | 誰送了什麼訊號、何時 OOM、何時重啟；容器刪掉之後也查得到 |
| `docker top` | 容器裡有哪些行程 | 確認 PID 1 是程式本身而不是 shell；gunicorn 的 worker 還在不在 |
| `docker cp` | 在容器與主機之間複製檔案 | 把產生失敗的 PDF 拿出來；已經停止的容器也能複製 |

開頭兩件事的查法：

```bash
# 結束或重啟中的容器
docker ps -a --filter status=exited --filter status=restarting

# 最近 30 分鐘的錯誤。docker logs 把容器的 stderr 印到自己的 stderr，要 2>&1 才 grep 得到
docker logs --since 30m billing-api 2>&1 | grep -i error

# 一行看狀態、結束碼、OOM、重啟次數
docker inspect --format '{{.Name}} {{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}' payment-socket

# 日誌設定，以及日誌檔在主機上的位置
docker inspect --format '{{json .HostConfig.LogConfig}} {{.LogPath}}' billing-api

# 程式實際拿到的環境變數（會印出秘密，注意畫面與紀錄）
docker exec billing-api env

# 這個容器的訊號、OOM 與結束事件；指令會繼續等新事件，看完按 Ctrl-C
docker events --since 1h --filter container=payment-socket --filter event=kill --filter event=oom --filter event=die

# 印一次就結束，不持續更新
docker stats --no-stream
```

`docker events` 只保留最近的一批事件，要長期留存得另外收集。

### 容器裡沒有 shell

`docker exec -it billing-api bash` 在 slim 映像上常得到：

```text
OCI runtime exec failed: exec failed: unable to start container process: exec: "bash": executable file not found in $PATH: unknown
```

- 改用 `sh`（slim 映像通常有；distroless 連 sh 都沒有），或用映像裡一定有的程式：`docker exec billing-api python -c "import os; print(os.listdir('/tmp'))"`。
- 帶一個工具容器加入它的 namespace：`docker run --rm -it --network container:billing-api --pid container:billing-api <工具映像>`。`ss`、`curl`、`tcpdump` 在工具映像裡，正式映像不用裝；工具映像也放進 Harbor。
- 從主機進入它的網路 namespace，用主機上的工具：`sudo nsenter -t "$(docker inspect -f '{{.State.Pid}}' billing-api)" -n ss -tnp`。
- 容器已經停了就不能 `exec`，用 `docker cp` 把檔案拿出來。

Kubernetes 上對應的做法是 `kubectl debug` 加一個臨時容器，見 [Kubernetes 排錯](#/skill/k8s-troubleshooting)。

### 結束碼

| 結束碼 | 意思 | 常見原因 |
|---|---|---|
| 0 | 正常結束 | 程式做完事；處理完 SIGTERM 後自己結束 |
| 1 | 程式回報錯誤 | Python 有未捕捉的例外，traceback 在 `docker logs` |
| 125 | `docker run` 本身失敗，容器沒有啟動 | 參數錯誤、名稱衝突 |
| 126 | 指令存在但不能執行 | 沒有執行權限 |
| 127 | 找不到指令 | `CMD` 打錯、不在 PATH 裡 |
| 137 | 被 SIGKILL 結束（128 + 9） | 超過記憶體上限；`docker stop` 等滿寬限期；`docker kill` |
| 139 | 被 SIGSEGV 結束（128 + 11） | 原生函式庫（C 寫的繪圖、PDF 程式庫）當掉 |
| 143 | 被 SIGTERM 結束（128 + 15） | 收到 SIGTERM 時用預設動作直接結束，沒有走自己的關機流程 |

137 要搭配 `OOMKilled` 看：`true` 是記憶體；`false` 多半是停止時等滿寬限期，開頭的 `payment-socket` 就是這種。Kubernetes 的 `kubectl describe pod` 在 `Last State` 顯示同一組數字，查法見 [Kubernetes 排錯](#/skill/k8s-troubleshooting)。

## 日誌：寫 stdout，輪替交給執行環境

容器裡的程式把 log 寫到 stdout 與 stderr，由容器執行環境收走。Docker 用日誌驅動（logging driver）決定收到哪裡，預設的 `json-file` 把每一行包成一筆 JSON，寫到主機上的檔案：

```text
/var/lib/docker/containers/<容器 ID>/<容器 ID>-json.log

{"log":"10.0.3.7 - - [10/Nov/2026:07:40:12 +0800] \"GET /api/receipts/88213 HTTP/1.0\" 200 5123 \"-\" \"kiosk/2.4\"\n","stream":"stdout","time":"2026-11-10T07:40:12.481305779Z"}
```

`docker logs` 讀的就是這個檔案。每一行多了 `stream`、`time` 與跳脫字元，寫到磁碟的量比程式印出的多。json-file 預設不輪替，檔案一直長到磁碟滿，Docker 官方文件也提醒這一點並建議改用 `local` 驅動。三個選項：

| 選項 | 意思 | 預設 |
|---|---|---|
| `max-size` | 單一檔案到這個大小就換新檔（`10m`、`50m`） | 不限制 |
| `max-file` | 最多保留幾個檔，超過就刪最舊的；設了 `max-size` 才有作用 | 1 |
| `compress` | 輪替出去的舊檔要不要壓縮 | 不壓縮 |

單一容器在 `docker run` 時指定：

```bash
docker run -d --name billing-api \
  --log-opt max-size=50m --log-opt max-file=5 \
  harbor.example.org/billing/api:4.12.0
```

整台主機的預設值寫在 `/etc/docker/daemon.json`，值一律寫成字串，數字也要加引號：

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "5"
  }
}
```

改完要重啟 Docker（`sudo systemctl restart docker`），而且**只對之後建立的容器生效**，已經存在的容器保留建立當時的設定。要重建容器（compose 用 `docker compose up -d --force-recreate`），再用 `docker inspect --format '{{json .HostConfig.LogConfig}}'` 確認。重啟 Docker 會停掉主機上所有容器（設了 `live-restore` 的除外），排在維護時段做。compose 的寫法見 [docker-compose 開發環境](#/skill/compose) 的正式環境設定。

### 磁碟已經滿了

- `docker system df` 不含日誌檔，日誌要直接看 `/var/lib/docker/containers/`。
- 急救時清空檔案內容，不要刪檔：`sudo truncate -s 0 "$(docker inspect --format '{{.LogPath}}' billing-api)"`。`rm` 掉的檔案 dockerd 還開著，空間要等容器重建才釋放。需要的段落先用 `docker logs --since …` 存到別處。
- 之後補上輪替、重建容器，把 log 送到集中儲存（見 [可觀測性：log、metrics、trace](#/skill/observability)），監控 `/var/lib/docker` 所在分割區；它放在獨立分割區時，塞滿不會拖垮作業系統。

### 其他驅動

| 驅動 | 定位 |
|---|---|
| `local` | Docker 自己的格式，預設就輪替與壓縮（每個容器保留約 100 MB），`docker logs` 照樣能用 |
| `journald`、`syslog` | 交給主機的 journald 或 syslog，由主機既有的方式收走 |
| `fluentd`、`gelf` 等 | 直接送到集中的日誌系統；Docker 20.10 起本機另留一份快取，`docker logs` 還能用 |

### 算一下：多久會塞滿

下面用開頭的三個容器估算：每秒寫幾行、每行多大，json-file 每行再包上 JSON。數字是示意，換成自己的量測值再跑：

```python run
import json

def json_file_line(text):
    """json-file 寫到磁碟的一行：原文包成 JSON，再加上 stream 與 time"""
    rec = {"log": text + "\n", "stream": "stdout", "time": "2026-11-10T07:40:12.481305779Z"}
    return len(json.dumps(rec, separators=(",", ":"))) + 1     # 加上換行

access = '10.0.3.7 - - [10/Nov/2026:07:40:12 +0800] "GET /api/receipts/88213 HTTP/1.0" 200 5123 "-" "kiosk/2.4"'
print(f"一行 access log：原文 {len(access) + 1} 位元組，寫進 json-file 是 {json_file_line(access)} 位元組\n")

GB, MB = 1024 ** 3, 1024 ** 2
api_line = "x" * 220          # 示意：一行 220 字元的應用程式 log
pay_line = "x" * 120

normal = {                    # 容器：(每秒幾行, 一行的內容)
    "nginx": (6, access),
    "billing-api": (8, api_line),
    "payment-socket": (1, pay_line),
}
debug = dict(normal, **{"billing-api": (300, api_line)})   # billing-api 改成 DEBUG

def per_day(lines_per_sec, line):
    return lines_per_sec * json_file_line(line) * 86400

def no_rotation(title, rates, free_gb=40):
    total = 0
    print(title)
    for name, (lps, line) in rates.items():
        total += per_day(lps, line)
        print(f"  {name:<15} 每秒 {lps:>3} 行，每天 {per_day(lps, line) / GB:5.2f} GB")
    print(f"  合計每天 {total / GB:.2f} GB；剩 {free_gb} GB 時約 {free_gb * GB / total:.0f} 天塞滿\n")

no_rotation("不輪替，平常（INFO）", normal)
no_rotation("不輪替，billing-api 開著 DEBUG", debug)

def with_rotation(rates, max_size_mb=50, max_file=5):
    cap = max_size_mb * max_file
    print(f"max-size={max_size_mb}m、max-file={max_file}：每個容器最多 {cap} MB，"
          f"{len(rates)} 個容器合計 {cap * len(rates)} MB，和 log 等級無關")
    for name, (lps, line) in rates.items():
        hours = cap * MB / (lps * json_file_line(line)) / 3600
        print(f"  {name:<15} docker logs 最多看得到約 {hours:6.1f} 小時前")

with_rotation(debug)
```

輪替把磁碟用量封頂在 750 MB，代價是保留的時間：DEBUG 開著時，`billing-api` 只留得住不到一小時。主機上的日誌檔只是緩衝，要回頭查上週的事，log 得收到集中儲存。

### Kubernetes 上的日誌

- 容器的 stdout 與 stderr 由節點上的容器執行環境寫成檔案（`/var/log/pods/<namespace>_<pod>_<uid>/<容器>/`），kubelet 依大小輪替。設定是 kubelet 的 `containerLogMaxSize` 與 `containerLogMaxFiles`，預設值與可調範圍以該版本的 kubelet 文件為準。Pod 上沒有 Docker 的 `--log-opt`，應用程式只管寫 stdout。
- `kubectl logs` 只讀得到最新的那個檔案；輪替出去的、Pod 刪除後的 log，要靠 Fluent Bit 這類 DaemonSet 收到叢集外，見 [Kubernetes 叢集維運](#/skill/k8s-operations)。
- 程式自己寫進容器裡的 log 檔，既不會被輪替，也不會被收集。gunicorn 的 access log 用 `--access-logfile -` 寫到 stdout；Python 在非終端機時緩衝 stdout 的問題，見 [日誌、錯誤處理與設定](#/skill/logging-config)。

## 資源上限：記憶體、CPU 與 GIL

```bash
docker run -d --name billing-api --memory 1g --memory-swap 1g --cpus 2 harbor.example.org/billing/api:4.12.0
docker update --memory 1g --memory-swap 1g --cpus 2 billing-api    # 執行中的容器直接改，不用重建
```

| 參數 | 作用 | 注意 |
|---|---|---|
| `--memory` | cgroup 的記憶體上限 | 沒設時可以用到整台主機；一個容器洩漏，主機的 OOM killer 可能挑中別的行程 |
| `--memory-swap` | 記憶體加 swap 的總量 | 只設 `--memory`、主機又有 swap 時，容器還能再用同樣大小的 swap；變慢比被砍更難察覺。設成和 `--memory` 一樣就不用 swap |
| `--cpus` | 每段時間最多用幾顆核心的 CPU 時間 | 超過被節流，變慢但不會被砍 |

### 超過記憶體上限

核心的 OOM killer 在容器的 cgroup 裡挑一個行程，送 SIGKILL。被挑中的是誰，結果不一樣：

| 被殺的是 | 容器 | 看得到的線索 |
|---|---|---|
| PID 1（例如 `payment_server.py`） | 結束，`Exited (137)`；有重啟策略就被拉起來 | `docker inspect` 的 `OOMKilled` 是 `true`；`docker events` 有 `oom` 與 `die` |
| 子行程（例如 gunicorn 的 worker） | 不會結束，gunicorn master 重開一個 worker | gunicorn 的 log：`Worker (pid:…) was sent SIGKILL! Perhaps out of memory?`；`docker events` 有 `oom`；`docker ps` 看起來一切正常 |

`billing-api` 是 `-w 1`：唯一的 worker 被砍時，它手上 50 個執行緒的請求全部中斷（nginx 回 502），新 worker 起來前沒有人處理請求。

Kubernetes 1.28 起，cgroup v2 的節點上只要容器裡有一個行程觸發 OOM，整個容器一起被砍，同一個 gunicorn 會看到容器 `OOMKilled`、重啟次數加一；1.32 起 kubelet 的 `singleProcessOOMKill` 設定可以改回只砍單一行程。行為依版本而定，以官方文件為準。

### Python 的記憶體為什麼會慢慢長

`docker stats` 看到記憶體一天比一天高、重啟後歸零再慢慢爬，常見原因：

- **沒有上限的快取**：模組層級的 dict、`lru_cache(maxsize=None)`、一直 append 的全域清單。
- **大物件乘上並行數**：一份 PDF 在記憶體裡組好再送出，50 個執行緒同時產生就是 50 份。高峰被撐高，但到頂就平，不是洩漏。
- **記憶體沒有還給作業系統**：釋放的物件，記憶體常留在行程裡給之後重用（Python 的配置器與 glibc 的 malloc 都會保留）。執行緒多時 glibc 會開多個配置區（arena），碎片更多；環境變數 `MALLOC_ARENA_MAX` 可以限制數量，效果要量測。
- **原生函式庫的洩漏**：C 程式庫沒有釋放，`tracemalloc` 看不到。

曲線一路往上不回落是洩漏，到某個高度就平是上限太小或並行太高。`tracemalloc` 取兩個時間點的快照比較，找得到 Python 層是哪一行在累積。修好之前，gunicorn 的 `--max-requests` 加 `--max-requests-jitter` 讓 worker 定期重開（見 [應用伺服器與程序管理](#/skill/process-servers)）。

### CPU：threads 與 GIL

`-w 1 --threads 50` 是一個行程、50 個執行緒。等資料庫、等印表機時執行緒會釋放 GIL，可以同時等；產生 PDF 的排版運算如果大部分在 Python 層，同一時間只有一個執行緒在跑，CPU 卡在一顆核心左右：

```bash
$ docker stats --no-stream billing-api
CONTAINER ID   NAME          CPU %     MEM USAGE / LIMIT   MEM %     NET I/O         BLOCK I/O      PIDS
7f3e2a91c0d7   billing-api   101.36%   812MiB / 1GiB       79.30%    1.2GB / 3.4GB   45MB / 2.1GB   53
```

上限是 `--cpus 2`（200%），CPU 卻停在 100% 左右、請求在排隊，調高 `--cpus` 不會有幫助。`PIDS` 的 53 是 master、worker 與它的執行緒（cgroup 把執行緒也算進去）。cairo、pango 這類 C 程式庫執行時是否釋放 GIL，依函式庫與呼叫方式而定，所以要量測：

1. 用壓測工具同時送 N 個產生 PDF 的請求，記錄每秒完成數、p95 與 `docker stats`（方法見 [效能量測與壓測](#/skill/load-testing)）。
2. 換成 `-w 2 --threads 25`、`-w 4 --threads 12` 再跑。每個 worker 是獨立的行程，有自己的 GIL，也有自己一份記憶體，記憶體上限要跟著重算。
3. CPU 超過 100%、每秒完成數跟著上升，就是多行程有效。

GIL 的原理見 [電腦怎麼跑你的程式：行程、執行緒、記憶體](#/skill/how-programs-run)。

### 對應到 Kubernetes

| Docker | Kubernetes | 說明 |
|---|---|---|
| `--memory 1g` | `resources.limits.memory: 1Gi` | 同樣是 cgroup 上限，超過被 OOMKilled |
| `--cpus 2` | `resources.limits.cpu: "2"` | 同樣是節流 |
| 沒有對應 | `resources.requests` | 排程時保留的量，也是 HPA 算使用率的分母 |

寫法與 QoS 見 [Kubernetes 實作：設定、探針與資源](#/skill/k8s-config-probes)，數字怎麼估見 [硬體資源與容量規劃](#/skill/capacity-planning)。

## 重啟策略

| `--restart` | 什麼時候重啟 | 手動 `docker stop` 之後 |
|---|---|---|
| `no`（預設） | 不重啟 | 不重啟 |
| `on-failure[:N]` | 結束碼不是 0 才重啟；`:N` 限制最多重試 N 次 | 不重啟 |
| `always` | 不論結束碼 | 不重啟，但 Docker daemon 重啟（含主機開機）時會再把它啟動 |
| `unless-stopped` | 不論結束碼 | 不重啟，daemon 重啟後也維持停止 |

- 每次重啟前的等待從 100 毫秒開始加倍，容器重啟後正常跑超過 10 秒就回到 100 毫秒。`docker ps` 顯示 `Restarting (137) 3 seconds ago`，次數在 `docker inspect --format '{{.RestartCount}}'`。
- `docker update --restart unless-stopped payment-socket` 不用重建；compose 寫 `restart: unless-stopped`。
- 常駐服務用 `unless-stopped`，維護時手動停掉的不會在主機重開後被拉起來；一次性的工作用 `no` 或 `on-failure:3`。
- 每 40 分鐘 OOM 一次的容器，在 `docker ps` 上永遠是 `Up 12 minutes`。`RestartCount` 與 `oom` 事件要進監控。

Kubernetes 上，Docker 的 `--restart` 沒有作用，重啟由節點上的 kubelet 依 Pod 的 `restartPolicy` 決定：`Always`（預設，Deployment 只能用這個）、`OnFailure`、`Never`（Job 用後兩個）。等待時間從 10 秒開始加倍、上限 5 分鐘，容器正常跑 10 分鐘後重新計算；正在等待的狀態就是 `CrashLoopBackOff`，查法見 [Kubernetes 排錯](#/skill/k8s-troubleshooting)。

## 訊號與關機：付款服務的那 10 秒

開頭的 `payment-socket`，一次更新的經過：

| 時間 | 事件 |
|---|---|
| 0 秒 | `docker stop`（`compose up -d` 換新版時也一樣）送 SIGTERM 給 PID 1 |
| 0 到 10 秒 | `payment_server.py` 沒有註冊 SIGTERM 的處理函式；它是 PID 1，訊號被忽略，程式照常接新交易 |
| 10 秒 | 寬限期到，Docker 送 SIGKILL；每條連線上做到一半的交易一起中斷，結束碼 137 |
| 10 秒之後 | 新容器啟動，繳費機與刷卡機重新連線 |

### `--init` 只解決一半

`docker run --init`（compose 寫 `init: true`）讓 Docker 內建的 tini 當 PID 1，`payment_server.py` 變成它的子行程。tini 把訊號轉給子行程，也回收結束的子孫行程（避免殭屍行程）。加上之後 `docker stop` 會立刻完成：Python 不再是 PID 1，收到 SIGTERM 就用預設動作當場結束，結束碼 143。手上的交易一樣被切斷，只是從「等 10 秒再切」變成「立刻切」。

所以程式本身要處理 SIGTERM。`--init` 仍然值得加：程式開的子行程有人回收，之後某個沒處理訊號的程式也不會每次等滿寬限期。

### 最小的 SIGTERM 處理

收到 SIGTERM 後：停止接新連線、讓每條連線把手上的交易做完、關閉並結束。`handle_one(conn)` 代表既有的「讀一筆交易、處理、回覆」：

```python
# payment_server.py 的關機骨架
# handle_one(conn)：等下一筆交易的開頭最多 1 秒（沒有就丟 socket.timeout）；
#                   讀到開頭之後把整筆做完、回覆，才回傳；對方關閉連線時回傳 False
import signal
import socket
import sys
import threading
import time

DRAIN_SECONDS = 20             # 最多等手上的交易 20 秒；要小於 docker stop -t 與 terminationGracePeriodSeconds
stopping = threading.Event()

def on_term(signum, frame):
    stopping.set()             # 處理函式只設旗標，關機的工作在主迴圈做

signal.signal(signal.SIGTERM, on_term)
signal.signal(signal.SIGINT, on_term)       # 本機按 Ctrl-C 也走同一條路

def serve(conn):
    with conn:
        while not stopping.is_set():        # 每筆交易之間檢查一次：關機中就不收下一筆
            try:
                if not handle_one(conn):
                    return
            except socket.timeout:
                continue                    # 這一秒沒有交易進來，回去檢查旗標
        # 走到這裡時手上沒有交易：在交易之間關閉連線，終端機會重連到新的容器

srv = socket.create_server(("0.0.0.0", 9100))
srv.settimeout(1.0)            # accept 每秒醒來一次，才看得到旗標
workers = []
while not stopping.is_set():
    try:
        conn, _ = srv.accept()
    except socket.timeout:
        continue
    t = threading.Thread(target=serve, args=(conn,), daemon=True)
    t.start()
    workers = [w for w in workers if w.is_alive()] + [t]

srv.close()                    # 1. 停止接新連線
deadline = time.monotonic() + DRAIN_SECONDS
for t in workers:              # 2. 等每條連線把手上的交易做完
    t.join(max(0, deadline - time.monotonic()))
busy = sum(t.is_alive() for t in workers)
print(f"shutdown: {busy} connection(s) still busy after {DRAIN_SECONDS}s", file=sys.stderr, flush=True)
sys.exit(0 if busy == 0 else 1)             # 3. 結束；有沒做完的就以 1 結束，留下紀錄
```

- **`accept` 要設逾時**：Python 3.5 起，系統呼叫被訊號打斷後會自動重試（PEP 475），處理函式跑完 `accept()` 繼續等，主迴圈要等到下一條連線進來才看得到旗標。
- **處理函式只設旗標**：它只在主執行緒執行，可能在任何一行之間被呼叫，在裡面關 socket、等執行緒容易出錯。
- **執行緒設成 `daemon=True`**：等滿 `DRAIN_SECONDS` 還沒做完的，`sys.exit` 時直接結束；非 daemon 的執行緒會讓行程卡住，直到被 SIGKILL。
- **長連線由伺服器在交易之間關閉**：從負載平衡或 Service 的後端移除只影響新連線，已經連著的終端機不會自己斷開。

終端機那一端要能重連並重送。送出後沒等到回覆的交易，重送前先用交易編號查詢結果，避免重複扣款，見 [付款請求的冪等與重試](#/scenario/idempotency)。

### 寬限期由內而外

| 層 | 設定 | 這個系統 |
|---|---|---|
| 程式 | `DRAIN_SECONDS`；gunicorn 的 `--graceful-timeout`（預設 30 秒） | `payment-socket` 20 秒；`billing-api` 30 秒 |
| 容器 | `docker stop -t`、`docker run --stop-timeout`、compose 的 `stop_grace_period`（Docker 預設 10 秒） | 比程式的長：`payment-socket` 30 秒、`billing-api` 35 秒 |
| Kubernetes | `terminationGracePeriodSeconds`（預設 30 秒），有 `preStop` 時從 preStop 開始就算在裡面 | 同樣比程式的長，再加上 preStop 的秒數 |

`billing-api` 的 gunicorn 會處理 SIGTERM，但 Docker 預設只等 10 秒，比 gunicorn 的 30 秒短，較久的 PDF 請求一樣被切斷。Dockerfile 的 `STOPSIGNAL` 可以改 `docker stop` 送的訊號，官方 nginx 映像就用它改成 SIGQUIT（nginx 的優雅關機）。

`docker compose up -d` 換新版時先停舊容器再起新的，中間沒有人接交易，終端機一定要會重試。Kubernetes 的滾動更新可以先起新 Pod 再停舊的，preStop 與寬限期見 [Kubernetes 實作：設定、探針與資源](#/skill/k8s-config-probes) 的優雅關機段落。

### 模擬：四種關機方式各切斷幾筆交易

下面把開頭那次更新寫成事件序列：t=0 送出 SIGTERM，六筆交易各有開始時間與需要的秒數。

```python run
# 付款服務在 t=0 收到 SIGTERM。每筆交易：(編號, 終端機, 開始時間, 需要幾秒)
# 時間以 SIGTERM 為 0；負的表示 SIGTERM 之前就開始了
TX = [
    ("T1", "繳費機-3", -3.0, 4.0),
    ("T2", "櫃檯-1", -1.5, 6.0),
    ("T3", "繳費機-7", -0.5, 12.0),   # 等銀行回應比較久
    ("T4", "繳費機-3", 2.0, 3.0),     # 已經連著的終端機送來下一筆
    ("T5", "櫃檯-2", 5.0, 2.0),       # 新的連線
    ("T6", "櫃檯-1", 8.0, 4.0),
]

def stop(title, handles_sigterm, init=False, drain=20, grace=10):
    """handles_sigterm：程式有沒有處理 SIGTERM；init：PID 1 是不是 tini（--init）
    drain：程式自己最多等幾秒；grace：docker stop -t（Kubernetes 是 terminationGracePeriodSeconds）"""
    if not handles_sigterm and init:
        # tini 把 SIGTERM 轉給 python；python 沒有處理函式，用預設動作當場結束
        end, accept_until, code = 0.0, 0.0, 143
    elif not handles_sigterm:
        # python 是 PID 1，SIGTERM 被忽略：照常接交易，寬限期到了被 SIGKILL
        end, accept_until, code = grace, grace, 137
    else:
        accept_until = 0.0                            # 收到 SIGTERM 就不再收新交易
        busy_until = max((s + d for _, _, s, d in TX if s < 0 < s + d), default=0.0)
        end = min(busy_until, drain)                  # 做完手上的，或等滿 drain 就放棄
        code = 0 if busy_until <= drain else 1
        if end >= grace:                              # 寬限期先到：SIGKILL
            end, code = grace, 137
    done, cut, retry = [], [], []
    for tid, term, start, dur in TX:
        if start >= 0 and start >= accept_until:
            retry.append(tid)                         # 沒有被收下：終端機要重新連線再送
        elif start + dur <= end:
            done.append(tid)
        else:
            cut.append(tid)                           # 做到一半被中斷
    print(title)
    print(f"  第 {end:4.1f} 秒結束，結束碼 {code}")
    print(f"  完成 {done}　被切斷 {cut}　要重送 {retry}\n")

stop("A. 沒處理 SIGTERM（python 是 PID 1）", handles_sigterm=False)
stop("B. 沒處理 SIGTERM，加了 --init", handles_sigterm=False, init=True)
stop("C. 處理 SIGTERM，docker stop -t 30", handles_sigterm=True, grace=30)
stop("D. 處理 SIGTERM，寬限期用預設的 10 秒", handles_sigterm=True, grace=10)
```

A 是開頭的狀況：T3 與 T6 被切斷，正好兩筆，其中 T6 是 SIGTERM 之後才收下的。B 停得最快，切斷的反而最多。C 多花 1.5 秒，沒有交易被切斷，T4 到 T6 由終端機重送到新容器。D 的程式寫對了，寬限期卻比最長的交易短，T3 還是被切斷；結束碼 137 和 A 一樣，只看結束碼分不出這兩種情況。

## 以非 root 執行

`docker inspect --format '{{.Config.User}}' billing-api` 印出空字串，或 `docker exec billing-api id` 印出 `uid=0(root)`，就是以 root 執行；沒有開 user namespace 重新對應時，它就是主機的 UID 0（見 [Docker：image、container、layer](#/skill/docker-basics)）。在兩個 target 共用的階段建立使用者，兩個映像就都以非 root 執行（建置階段見 [幫 Python 專案寫好 Dockerfile](#/skill/dockerfile-python)）：

```dockerfile
FROM python:3.12-slim AS base
# 套件名稱依基底映像的 Debian 版本而定，照現有 Dockerfile 的清單
RUN apt-get update \
 && apt-get install -y --no-install-recommends libpango-1.0-0 libpangocairo-1.0-0 cups-client fontconfig \
 && rm -rf /var/lib/apt/lists/* \
 && fc-cache -f \
 && groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app
# 沒有家目錄：字型快取等需要寫入的東西放 /tmp
ENV HOME=/tmp XDG_CACHE_HOME=/tmp/.cache
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
COPY billing/ ./billing/
COPY payment_server.py ./
# 數字 UID：Kubernetes 的 runAsNonRoot 才能確認不是 root
USER 10001:10001

FROM base AS api
CMD ["gunicorn", "-w", "1", "--threads", "50", "--keep-alive", "75", "-b", "0.0.0.0:8000", "billing.wsgi:app"]

FROM base AS payment
CMD ["python", "payment_server.py"]
```

改成非 root 之後，要處理程式寫檔的地方：

- **暫存檔**：產生到一半的 PDF 用 `tempfile`（預設在 `/tmp`），不寫在 `/app` 底下；程式碼目錄維持 root 擁有、只能讀。
- **要保留的檔案**：放 volume。既有的 volume 是 root 寫的，換 UID 前用同一個映像改一次擁有者：`docker run --rm --user 0 -v billing-data:/data harbor.example.org/billing/api:4.12.0 chown -R 10001:10001 /data`。
- **字型快取**：fontconfig 找不到可寫的快取目錄時會印 `Fontconfig error: No writable cache directories`，每次啟動都重新掃描字型。建置時先 `fc-cache -f`，執行時把 `HOME`、`XDG_CACHE_HOME` 指到 `/tmp`。
- **找出漏掉的地方**：測試環境加 `--read-only --tmpfs /tmp`，程式寫到別處會立刻得到 `Read-only file system`。

Kubernetes 上，namespace 套用 Pod Security 的 `restricted` 等級時，以 root 執行的 Pod 會被擋下；securityContext 的寫法見 [Kubernetes 實作：設定、探針與資源](#/skill/k8s-config-probes)，namespace 的標籤與導入順序見 [Kubernetes 權限與多租戶](#/skill/k8s-rbac-tenancy)。

## 容器執行環境的版圖

Docker 建出來的映像能在其他執行環境上跑，因為 OCI（Open Container Initiative）定了三份共通規格：映像格式（image spec）、怎麼把映像跑成容器（runtime spec）、registry 的 API（distribution spec）。runc 是 runtime spec 的參考實作，下面幾個工具最後多半呼叫它（或 crun）建立 namespace 與 cgroup。

| 名稱 | 定位 | 常見在哪裡 |
|---|---|---|
| Docker Engine（dockerd） | 完整的容器平台：建置、執行、網路、volume，加上 compose；底下用 containerd 與 runc | 開發機、單機伺服器（現在的兩台 VM） |
| containerd | 管理映像與容器生命週期的常駐程式，實作 Kubernetes 的 CRI | 多數 Kubernetes 發行版的節點；也是 Docker Engine 的底層 |
| CRI-O | 只為 Kubernetes 寫的 CRI 實作 | OpenShift 的節點，以及選用它的叢集 |
| Podman | 沒有常駐程式（daemonless），可以用一般使用者執行（rootless），指令大致與 docker 相容；能從容器產生 Kubernetes 的 YAML、交給 systemd 管理 | RHEL 系的伺服器、開發機 |

Kubernetes 1.24 起移除了 dockershim，節點上的容器執行環境是 containerd 或 CRI-O，多半沒有 docker 指令。查節點上的容器用 `crictl`，它直接和 CRI 溝通：

| 要做的事 | Docker | crictl |
|---|---|---|
| 列出容器（含已結束的） | `docker ps -a` | `crictl ps -a` |
| 列出 Pod | 沒有對應 | `crictl pods` |
| 看 log | `docker logs --tail 100 <容器>` | `crictl logs --tail 100 <容器 ID>` |
| 在容器裡執行指令 | `docker exec -it <容器> sh` | `crictl exec -it <容器 ID> sh` |
| 列出映像 | `docker images` | `crictl images` |
| 拉映像 | `docker pull` | `crictl pull` |
| 詳細資訊 | `docker inspect` | `crictl inspect <容器 ID>` |
| 資源用量 | `docker stats` | `crictl stats` |
| 清掉沒在用的映像 | `docker image prune -a` | `crictl rmi --prune` |
| 建置、推送映像 | `docker build`、`docker push` | 沒有；映像在 CI 建好推到 Harbor |

`crictl` 是在節點上排錯用的，日常操作還是 `kubectl`；用 `crictl` 直接建立的容器會被 kubelet 清掉。要連哪個執行環境寫在 `/etc/crictl.yaml` 的 `runtime-endpoint`（containerd 常見是 `unix:///run/containerd/containerd.sock`，CRI-O 是 `unix:///var/run/crio/crio.sock`）。

CI 用 `docker build` 建好推到 Harbor，VM 上的 Docker Engine 與節點上的 containerd 拉到的是同一個 digest。Harbor 的權限與離線同步見 [私有映像倉庫：Harbor、映像同步與離線環境](#/skill/container-registry)。

### Docker Desktop 的授權

Docker Desktop 是 Windows、macOS 與 Linux 上的桌面應用程式，受 Docker 的訂閱服務合約（Docker Subscription Service Agreement）規範：

- 可以免費使用的情況：員工少於 250 人**而且**年營收少於 1,000 萬美元的組織、個人使用、教育用途、非商業的開源專案。超過這個範圍的商業使用需要付費訂閱。
- Docker 官方 FAQ 另外寫明，政府機關（Government Entities）不購買訂閱就不能使用 Docker Desktop。
- 醫院的員工數通常超過 250 人，公立醫院還可能落在政府機關的定義裡。開發機要用 Docker Desktop（包括用它跑本機的 kind 叢集），先向院方確認已經有授權。
- Linux 伺服器上用套件安裝的 Docker Engine 屬於開源的 Moby 專案，Docker 官方說明 Desktop 的條款沒有改變 Docker Engine 等開源專案的授權。Linux 版的 Docker Desktop 則同樣適用訂閱條款。
- 條款會改，最新內容以 Docker 官方的授權說明與 FAQ 為準。

不用 Docker Desktop 時的替代方案：

| 工具 | 定位 |
|---|---|
| Rancher Desktop | SUSE 維護的開源桌面工具，執行環境可選 containerd（搭配 nerdctl）或 dockerd（搭配 docker 指令），內建單節點的 k3s |
| Podman Desktop | 開源的圖形介面，底層是 Podman，也能建立 kind 叢集 |
| WSL 2 裡的 Docker Engine | Windows 開發機在 WSL 2 的 Linux 發行版裡直接安裝 Docker Engine |

## 常見錯誤與錯誤訊息

訊息的確切文字依版本而異，下面是類似的樣子：

| 訊息或現象 | 原因 | 處理 |
|---|---|---|
| `OSError: [Errno 28] No space left on device`，`df` 顯示 100% | json-file 日誌沒有輪替；或映像、建置快取堆積 | `du` 看 `/var/lib/docker/containers/`；用 truncate 急救；補 `max-size`、`max-file` 並重建容器 |
| 改了 daemon.json，日誌照樣在長 | 已經存在的容器保留建立時的日誌設定 | 重建容器，用 `docker inspect` 確認 `LogConfig` |
| dockerd 起不來，log 有 `cannot unmarshal number into Go value of type string` 之類 | daemon.json 的 `log-opts` 值寫成了數字 | 改成字串：`"max-file": "5"` |
| `docker stop` 每次剛好 10 秒，`Exited (137)`，`OOMKilled=false` | PID 1 沒有處理 SIGTERM | 程式處理 SIGTERM；`-t` 設得比程式的等待上限長 |
| 加了 `--init` 後立刻停止，`Exited (143)`，交易照樣中斷 | 子行程收到 SIGTERM 用預設動作直接結束 | 程式自己處理 SIGTERM |
| `Restarting (137) 2 seconds ago`，`OOMKilled=true` | 超過 `--memory`，重啟策略一直把它拉起來 | 看 `docker stats` 的趨勢：穩定偏高就調上限，一路上升就是洩漏 |
| 改成非 root 後 `PermissionError: [Errno 13] Permission denied` | 寫入 root 擁有的目錄，或 volume 裡是 root 寫的舊檔 | 寫 `/tmp` 或 volume；volume 一次性 `chown` |
| 更新 `billing-api` 後 nginx 一直回 502，重啟 nginx 就好 | nginx 啟動時解析一次 `billing-api` 的位址，重建的容器換了 IP | 更新後 reload nginx（`docker exec nginx nginx -s reload`）；要讓 nginx 定期重新解析，做法依 nginx 版本與 upstream 的寫法而定 |
| Kubernetes 節點上 `docker: command not found`；`crictl` 警告沒有設定 endpoint | 1.24 起節點用 containerd 或 CRI-O；`crictl` 不知道要連哪一個 | 改用 `crictl`，在 `/etc/crictl.yaml` 設定 `runtime-endpoint` |

## 動手

1. 在 Playground 執行日誌的估算，把 `max_size_mb` 改成 10、`max_file` 改成 3，看 DEBUG 時 `billing-api` 只留得住幾分鐘；再把 `free_gb` 改成主機上實際剩下的空間。
2. 執行關機的模擬，把 C 的 `drain` 改成 10：程式先放棄，結束碼變成 1，T3 一樣被切斷。再把 T3 的秒數改成 25，找出 `drain` 與 `grace` 至少要設多少。
3. 做本課的程式題：[從 docker inspect 找出有問題的容器](#/exercise/container-operations-1)，以及 [補齊 compose 的維運設定](#/exercise/container-operations-2)。
4. 在有 Docker 的機器上寫一個每秒印一行、不會結束的 Python 腳本，用 `-v` 掛進 `python:3.12-slim` 執行。分三次 `time docker stop`：直接跑、加 `--init`、在腳本裡註冊 SIGTERM 處理函式。每次看 `docker inspect --format '{{.State.ExitCode}}'`，另一個終端機開著 `docker events` 對照訊號。
5. 用 `--log-opt max-size=1m --log-opt max-file=3` 啟動一個大量印 log 的容器，`sudo ls -lh` 它的日誌目錄，看 `-json.log`、`.1`、`.2` 怎麼輪替。
6. 依 [本機叢集指南](https://github.com/yo02741/Backend-Atlas/blob/main/companion/clinic-api/docs/local-k8s.md) 建好 kind 叢集，用 `docker exec -it clinic-control-plane crictl ps` 找到 `clinic-api` 的容器，執行 `crictl logs` 並看 `/var/log/pods/` 的檔案。再把 `clinic-api` 的 `limits.memory` 調到 `32Mi` 套用，用 `kubectl describe pod` 看 `Last State` 的 `OOMKilled` 與 Exit Code 137。

## 從一個具體問題開始：從開發指令直接上線

一個 FastAPI 服務在本機用 `uvicorn app.main:app --reload` 開發，Dockerfile 的 `CMD` 就照抄了這一行。上線後依序發生三件事：

**第一件：尖峰時回應變慢，但主機的 CPU 只用了 25%。** 主機有 4 核，服務只有一個行程；Python 行程同一時間只能用一顆核心跑 Python 程式碼（GIL），其他三顆閒著。`--reload` 還額外起了一個監看檔案變動的行程。

**第二件：有人把指令改成 `--workers 17`**（照「核心數 × 2 + 1」，但算的是主機的 8 核，而不是容器被限制的 2 核）。流量一來，資料庫開始拒絕連線：

```text
psycopg.OperationalError: connection failed: … FATAL:  sorry, too many clients already
```

17 個 worker × 每個連線池 10 條 × 3 個副本 = 510 條連線，資料庫的 `max_connections` 是 100。

**第三件：每次部署都有一陣 502，偶爾有付款流程做到一半中斷。** 部署工具停舊容器時送 SIGTERM，等 10 秒後送 SIGKILL；有些請求要跑 15 秒，在中途被硬殺。

這三件事分別對應這一課的三個主題：應用伺服器與 worker 模型、worker 數怎麼算、優雅關機。最後談健康檢查，以及由誰來管理這些行程。

## 框架、介面、伺服器

| 層 | 例子 | 負責 |
|---|---|---|
| Web 框架 | Flask、Django、FastAPI | 路由、解析請求、你的商業邏輯 |
| 介面規格 | WSGI（同步）、ASGI（非同步） | 規定伺服器怎麼呼叫框架：WSGI 是「一個請求呼叫一次函式、回傳回應」；ASGI 是 async 函式，支援 WebSocket 與長連線 |
| 應用伺服器 | gunicorn（WSGI）、uvicorn（ASGI）、granian、hypercorn | 聽埠、解析 HTTP、管理 worker、處理訊號與逾時 |

Flask 與 Django（傳統寫法）走 WSGI，FastAPI 與 Starlette 走 ASGI，Django 兩者都支援。框架只定義「收到請求要做什麼」，**誰來接連線、開幾個行程、怎麼關機**是應用伺服器的工作。

### 為什麼不用框架的開發伺服器

`flask run` 啟動時會直接警告：

```text
WARNING: This is a development server. Do not use it in a production deployment. Use a production WSGI server instead.
```

Django 的 `runserver` 文件也明確寫著不要用在正式環境。開發伺服器（以及 `--reload` 模式）是為了「改了程式立刻生效、出錯時看得到細節」設計的：

- 監看檔案變動、自動重啟：正式環境不需要，還多吃資源。
- 互動式除錯頁：Werkzeug 的除錯器可以在瀏覽器裡**執行任意 Python 程式碼**，雖然有 PIN 保護，一旦對外開放就是重大風險。
- 沒有 worker 管理：不會在行程崩潰時重啟它、不會砍掉卡住的請求、不會依設定開多個行程。
- 效能與穩定性沒有針對大量並行連線調校。

## worker 模型

正式的應用伺服器多半用 **pre-fork** 模型：一個主行程（master / arbiter）負責聽埠與管理，fork 出數個 worker 行程實際處理請求。

```text
gunicorn master（PID 1，不處理請求）
 ├─ 聽 0.0.0.0:8000，監控 worker、收訊號
 ├─ worker 1 ─ 處理請求，自己的記憶體、自己的資料庫連線池
 ├─ worker 2
 ├─ worker 3
 └─ worker 4   ← 崩潰或卡住超過 timeout：master 殺掉它並補一個新的
```

worker 之間**不共用記憶體**：每個 worker 都各自 import 一次程式、各自建連線池、各自有記憶體中的快取。worker 內部怎麼同時處理多個請求，有三種模型：

| 模型 | 例子 | 一個 worker 同時處理 | 適合 | 要注意 |
|---|---|---|---|---|
| 同步行程 | gunicorn `sync` worker | 1 個請求 | CPU 輕、I/O 少、程式碼不是 thread-safe | 一個慢請求就佔住整個 worker；需要較多 worker |
| 執行緒 | gunicorn `gthread`（`--threads 4`） | 執行緒數個請求 | 同步框架、I/O 等待多 | 程式碼與函式庫要 thread-safe；GIL 讓純 CPU 工作無法平行 |
| 非同步 | uvicorn（event loop） | 很多個，在 `await` 時切換 | ASGI 框架、大量 I/O 等待、WebSocket | **任何阻塞呼叫都會卡住整個 worker 的所有請求** |

最後一欄的「阻塞呼叫」是 async 服務最常見的效能問題：在 `async def` 裡用同步的資料庫驅動、`requests.get()`、`time.sleep()`，event loop 就停在那裡，這個 worker 上的所有請求一起等。原理與檢查方式見 [同步、多執行緒與 async](#/skill/python-async)；行程、執行緒與 GIL 見 [電腦怎麼跑你的程式：行程、執行緒、記憶體](#/skill/how-programs-run)。

常見的組合：

```bash
# ASGI（FastAPI）：uvicorn 自己管理多個 worker
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4

# ASGI：由 gunicorn 管理行程、worker 用 uvicorn 實作
# （較新的 uvicorn 把內建的 uvicorn.workers 標為棄用，改用獨立的 uvicorn-worker 套件）
gunicorn app.main:app -k uvicorn_worker.UvicornWorker -w 4 -b 0.0.0.0:8000

# WSGI（Flask、Django）：gunicorn 同步 worker 或執行緒 worker
gunicorn app.wsgi:application -w 5 --threads 4 -b 0.0.0.0:8000
```

uvicorn 與 gunicorn 都會讀 `WEB_CONCURRENCY` 環境變數當作預設的 worker 數，可以不改 image、用設定調整（見 [環境設定與 12-factor](#/skill/config-12factor)）。

## worker 數：從哪裡開始算

沒有一個公式能直接給出答案，但可以從三個上限開始，取最小值，再用壓測調整：

1. **CPU**：
   - 同步 worker：gunicorn 文件建議的起點是 `(2 × 核心數) + 1`，理由是 worker 有一部分時間在等 I/O。
   - async worker：一個 worker 已經能同時處理很多請求，起點通常是**核心數**個。
   - 「核心數」要用**這個容器實際能用的 CPU**。在容器裡 `os.cpu_count()` 回傳的是主機的 CPU 數，不是 cgroup 限制的配額；開頭的 17 就是這樣算出來的。
2. **記憶體**：worker 數 × 每個 worker 的 RSS（實際量，不要猜）要低於容器的記憶體上限，並留緩衝。超過就會被 OOM killer 殺掉。
3. **資料庫連線**：副本數 × 每個副本的 worker 數 × 每個 worker 的連線池上限（含 overflow）≤ 資料庫的 `max_connections` 減掉保留給管理、migration、監控的連線。

需要多少並行處理能力，可以用 Little's Law 估：**同時處理中的請求數 ≈ 每秒請求數 × 平均回應時間**。每秒 200 個請求、平均 0.12 秒，平均同時有 24 個請求在處理；同步 worker 一次處理一個，全部副本加起來至少要 24 個 worker（尖峰還要更多）。容量規劃的完整做法見 [硬體資源與容量規劃](#/skill/capacity-planning)。

下面這段把三個上限一起算，可以直接執行：

```python run
import math

def plan(cpus, mem_limit_mb, worker_rss_mb, replicas, pool_size, max_overflow,
         db_max_connections, db_reserved, async_worker, rps, avg_latency_s):
    by_cpu = cpus if async_worker else 2 * cpus + 1
    by_mem = math.floor(mem_limit_mb * 0.8 / worker_rss_mb)          # 留 20% 緩衝
    per_worker_conns = pool_size + max_overflow
    by_db = math.floor((db_max_connections - db_reserved) / (replicas * per_worker_conns))
    workers = max(1, min(by_cpu, by_mem, by_db))
    limiter = min([(by_cpu, "CPU"), (by_mem, "記憶體"), (by_db, "資料庫連線")])[1]
    print(f"CPU 上限 {by_cpu}、記憶體上限 {by_mem}、資料庫連線上限 {by_db} -> 每個副本 {workers} 個 worker（卡在{limiter}）")
    print(f"  總連線數最多 {replicas} × {workers} × {per_worker_conns} = {replicas * workers * per_worker_conns} / {db_max_connections}")
    concurrent = rps * avg_latency_s
    capacity = replicas * workers if not async_worker else None
    if capacity is not None:
        verdict = "足夠" if capacity >= concurrent * 1.5 else "不足（尖峰要留 50% 以上餘裕）"
        print(f"  Little's Law：平均同時 {concurrent:.0f} 個請求；同步 worker 總數 {capacity} -> {verdict}")

print("開頭的情況：同步 worker、連線池 5 + overflow 5")
plan(cpus=2, mem_limit_mb=2048, worker_rss_mb=180, replicas=3, pool_size=5, max_overflow=5,
     db_max_connections=100, db_reserved=10, async_worker=False, rps=200, avg_latency_s=0.12)
print("改成連線池 3 + overflow 2")
plan(cpus=2, mem_limit_mb=2048, worker_rss_mb=180, replicas=3, pool_size=3, max_overflow=2,
     db_max_connections=100, db_reserved=10, async_worker=False, rps=200, avg_latency_s=0.12)
```

第一組的結果是每個副本只能開 3 個 worker，總共 9 個，遠低於需要的 24 個以上——瓶頸在資料庫連線，不在 CPU。同步 worker 一次只用一條連線，縮小連線池之後（第二組）上限換成 CPU，總共 15 個，仍然不夠。接下來的選項是加副本或 CPU、在資料庫前面加連線池代理（例如 PgBouncer）讓更多 worker 共用較少的資料庫連線，或改用 async worker 讓少數 worker 處理更多並行請求。

## 優雅關機

部署、擴縮、主機維護都會停掉行程。停的方式是先送 **SIGTERM**，等一段寬限期，還沒結束就送 **SIGKILL**（訊號的差別見 [Linux 與 shell 基礎](#/skill/linux-basics)）。應用伺服器收到 SIGTERM 時應該：

1. **停止接受新連線**：關閉聽埠的 socket。負載平衡器或平台此時也應該停止送新請求過來。
2. **把進行中的請求做完**，最多等到自己的寬限期（graceful timeout）。
3. **清理**：關閉資料庫連線池、把緩衝的 log 與指標送出、結束背景工作。
4. **以退出碼 0 結束**。

gunicorn 與 uvicorn 都內建這個流程，前提是**它們收得到 SIGTERM**——Dockerfile 要用 exec form，讓伺服器本身是 PID 1（見 [幫 Python 專案寫好 Dockerfile](#/skill/dockerfile-python)）。

寬限期要**由內而外遞增**，否則外層會在內層做完之前動手：

| 層 | 設定 | 預設 | 開頭的問題 |
|---|---|---|---|
| 應用伺服器 | gunicorn `--graceful-timeout`；uvicorn `--timeout-graceful-shutdown` | gunicorn 30 秒 | 請求最長 15 秒，設 20 秒 |
| 容器 / 平台 | `docker stop -t`、compose 的 `stop_grace_period`、Kubernetes 的 `terminationGracePeriodSeconds`、systemd 的 `TimeoutStopSec` | Docker 10 秒、Kubernetes 30 秒、systemd 90 秒 | Docker 的 10 秒比應用程式的寬限期短，要調成 25 秒以上 |

下面模擬優雅關機：伺服器在收到 SIGTERM 後不再接新請求、等手上的請求做完，超過寬限期的才被中斷。可以直接執行（時間縮小成秒的十分之一）：

```python run
import asyncio

class Server:
    def __init__(self):
        self.accepting = True
        self.inflight = set()
        self.log = []

    async def handle(self, rid, seconds):
        if not self.accepting:                    # 已經在關機：新請求被拒（真實情況是連不上這個行程）
            self.log.append(f"請求 {rid}：被拒絕，負載平衡器應改送其他副本")
            return
        task = asyncio.current_task()
        self.inflight.add(task)
        try:
            await asyncio.sleep(seconds)
            self.log.append(f"請求 {rid}：完成（{seconds}s）")
        except asyncio.CancelledError:
            self.log.append(f"請求 {rid}：超過寬限期被中斷")
            raise
        finally:
            self.inflight.discard(task)

    async def shutdown(self, grace):
        self.accepting = False                    # 1. 停止接新請求
        pending = set(self.inflight)
        if pending:
            _, not_done = await asyncio.wait(pending, timeout=grace)   # 2. 等進行中的請求
            for t in not_done:                    # 超過寬限期的強制取消
                t.cancel()
            await asyncio.gather(*not_done, return_exceptions=True)
        self.log.append("3. 關閉連線池，4. 退出碼 0")

async def deploy(grace):
    s = Server()
    reqs = [asyncio.create_task(s.handle(i, d)) for i, d in [(1, 0.1), (2, 0.4), (3, 1.5)]]
    await asyncio.sleep(0.05)                     # t=0.05：收到 SIGTERM
    stopping = asyncio.create_task(s.shutdown(grace))
    await asyncio.sleep(0)                        # 讓 shutdown 先把 accepting 關掉
    await s.handle(4, 0.1)                        # SIGTERM 之後才到的請求
    await stopping
    await asyncio.gather(*reqs, return_exceptions=True)
    print(f"寬限期 {grace}s：")
    print("\n".join("  " + line for line in s.log))

await deploy(grace=1.0)    # 請求 3 要 1.5s，會被中斷
await deploy(grace=2.0)    # 全部做完
```

### 停止接新請求的那幾秒

在 Kubernetes 這類平台上，「把行程從負載平衡的目標移除」與「送 SIGTERM」是同時開始的，移除需要一點時間傳播。行程如果一收到 SIGTERM 就立刻關掉聽埠，還在路上的請求會連線失敗。常見的做法是在停止前先等幾秒（Kubernetes 的 `preStop` 掛一個短暫的 sleep），細節見 [導入 Kubernetes 前要準備什麼](#/skill/k8s-readiness)。

### 其他跟行程壽命有關的設定

- **worker 逾時**：gunicorn 的 `--timeout`（預設 30 秒）。同步 worker 處理一個請求超過這個時間，master 會殺掉它並重開，log 出現 `WORKER TIMEOUT`，客戶端通常看到 502。它是保護機制，不是用來容忍慢請求的。
- **定期回收 worker**：`--max-requests 1000 --max-requests-jitter 100`，每個 worker 處理一定數量的請求後重開，抑制緩慢的記憶體洩漏；jitter 讓 worker 不會同時重開。這是止痛藥，洩漏本身還是要找。
- **keep-alive**：應用伺服器對閒置連線的保留時間（uvicorn `--timeout-keep-alive` 預設 5 秒、gunicorn `--keep-alive` 預設 2 秒）。前面有負載平衡器時，它的閒置逾時通常比這長，負載平衡器可能把請求送進一條剛被後端關掉的連線，造成零星的 502。原則是後端的 keep-alive 比前面代理的閒置逾時長，見 [負載平衡](#/skill/load-balancing)。

## 健康檢查：`/health` 與 `/ready`

| 端點 | 問的問題 | 失敗時平台做什麼 | 檢查什麼 |
|---|---|---|---|
| `/health`（liveness） | 這個行程還活著、沒有卡死嗎？ | **重啟**它 | 幾乎什麼都不檢查：能回應就是活著。**不要**檢查資料庫，否則資料庫一抖動，所有副本一起被重啟 |
| `/ready`（readiness） | 這個行程現在可以接流量嗎？ | 暫時**不送流量**，恢復後加回 | 啟動完成、連線池建立、暖機完成；是否檢查共用依賴（資料庫）要權衡：全部副本會一起變成不可用 |

```python
# FastAPI 範例（需要安裝套件）
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Response

state = {"ready": False}

@asynccontextmanager
async def lifespan(app):
    await db.connect()            # 啟動：建立連線池（db 是你自己的資料庫物件）
    state["ready"] = True
    yield                         # 這段期間服務請求
    state["ready"] = False        # 關機：伺服器收完進行中的請求後才走到這裡
    await db.disconnect()

app = FastAPI(lifespan=lifespan)

@app.get("/health")
async def health():
    return {"status": "ok"}       # 能跑到這裡，event loop 就沒有卡死

@app.get("/ready")
async def ready(response: Response):
    if not state["ready"]:
        response.status_code = 503
        return {"status": "starting"}
    try:
        await asyncio.wait_for(db.execute("SELECT 1"), timeout=1)   # 檢查要有逾時
    except Exception:
        response.status_code = 503
        return {"status": "db unavailable"}
    return {"status": "ready"}
```

健康檢查端點不要需要登入、不要做重的查詢、不要寫 log 寫到洗版（每幾秒被呼叫一次）。Docker 的 `HEALTHCHECK` 與 compose 的 `service_healthy` 用的是同一類端點。

## 誰來管理行程

應用伺服器的 master 管 worker；master 本身也需要有人管：開機時啟動、崩潰時重啟、部署時依序停止與啟動。

**在 VM 上用 systemd**：

```ini
# /etc/systemd/system/orders-api.service
[Service]
User=orders
WorkingDirectory=/srv/orders/current
EnvironmentFile=/etc/orders/env
ExecStart=/srv/orders/current/.venv/bin/gunicorn -c gunicorn.conf.py app.main:app
ExecReload=/bin/kill -HUP $MAINPID      # gunicorn 收到 HUP：重讀設定並逐一替換 worker
KillMode=mixed                          # SIGTERM 只送給 master，由它通知 worker；最後的 SIGKILL 送給全部
TimeoutStopSec=35                       # 比 graceful_timeout 長
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```python
# gunicorn.conf.py：設定檔就是 Python
bind = "127.0.0.1:8000"               # 前面有同一台的 nginx 時只聽本機
workers = 4
worker_class = "uvicorn_worker.UvicornWorker"
timeout = 30
graceful_timeout = 25
max_requests = 1000
max_requests_jitter = 100
accesslog = "-"                       # access log 寫 stdout，交給 journald
errorlog = "-"
```

gunicorn 的訊號：`TERM` 優雅關機、`INT` / `QUIT` 快速關機、`HUP` 重新載入、`TTIN` / `TTOU` 增減一個 worker。

**在容器裡**：容器平台（Docker 的 restart policy、compose、Kubernetes）就是行程管理員。容器裡只跑**一個主要的應用伺服器行程**，不要再塞 systemd 或 supervisord；要多個 worker，由應用伺服器自己 fork；要更多容量，加容器副本。log 寫 stdout、由平台收集。

## 常見錯誤與錯誤訊息

| 訊息 | 原因 | 怎麼修 |
|---|---|---|
| `[CRITICAL] WORKER TIMEOUT (pid:2481)` | 同步 worker 處理單一請求超過 `--timeout` | 找慢的請求（慢查詢、沒設逾時的外部呼叫）；長工作改背景執行 |
| `Worker (pid:2481) was sent SIGKILL! Perhaps out of memory?` | worker 被強制殺掉，多半是記憶體超過上限 | 量每個 worker 的 RSS，減少 worker 數或修記憶體使用 |
| `[ERROR] Connection in use: ('0.0.0.0', 8000)` | gunicorn 要聽的埠已被占用 | `ss -ltnp` 找出占用者；常見是舊的行程沒停乾淨 |
| `[Errno 98] error while attempting to bind on address ('0.0.0.0', 8000): address already in use` | uvicorn 的同一種錯誤 | 同上 |
| `FATAL:  sorry, too many clients already` | 所有副本的連線總數超過資料庫的 `max_connections` | 重算 worker × 連線池 × 副本；縮小連線池或加連線池代理 |
| `QueuePool limit of size 5 overflow 10 reached, connection timed out, timeout 30.00` | SQLAlchemy：這個 worker 的連線都在用，等不到 | 找沒歸還連線的地方（交易太長、沒關 session）；確認並行量 |
| 部署時固定出現一陣 502 | 行程在負載平衡器知道前就停了，或被 SIGKILL 中斷 | 用 exec form 收 SIGTERM、寬限期由內而外遞增、停止前先等移除生效 |
| 零星、難重現的 502，log 有 `upstream prematurely closed connection` | 前面代理重用了被後端關掉的 keep-alive 連線 | 後端的 keep-alive 調得比代理的閒置逾時長 |
| CPU 很低但所有請求一起變慢 | async worker 裡有阻塞呼叫 | 換成 async 驅動，或用 `run_in_executor` / `asyncio.to_thread` 包起來 |
| `WARNING: This is a development server.` 出現在正式環境的 log | 用了框架的開發伺服器 | 換成 gunicorn / uvicorn |

## 動手

1. 在 Playground 開啟 worker 估算那段，把副本數改成 2、資料庫 `max_connections` 改成 200，看瓶頸換成什麼；再把 `async_worker` 改成 `True`。
2. 開啟優雅關機那段，把寬限期改成 0.3 秒，看哪些請求被中斷；再加一個 0.05 秒時才到的請求。
3. 在本機用 `gunicorn -w 2 -k uvicorn_worker.UvicornWorker app.main:app` 啟動一個有 `/slow`（`await asyncio.sleep(10)`）的服務，請求 `/slow` 的同時送 `kill -TERM <master PID>`，看請求有沒有做完；再用 `--graceful-timeout 3` 重做一次。
4. 在 async 的端點裡放一個 `time.sleep(2)`，同時送 10 個請求，觀察總時間；換成 `await asyncio.sleep(2)` 比較。

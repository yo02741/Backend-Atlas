## 從一個具體問題開始：一個慢請求拖垮了所有請求

一個 FastAPI 服務，handler 全都寫成 `async def`。平常 p50 延遲 20 ms。某天加了一支「匯出報表」的 API：

```python
@app.get("/report")
async def report():
    rows = requests.get("https://reporting.internal/api/rows").json()   # 同步的 HTTP client
    return build_report(rows)
```

報表服務回應要 3 秒。上線後，**所有** API（包括健康檢查）都開始間歇性地慢 3 秒，健康檢查逾時，負載平衡器把這台機器標成不健康。CPU 使用率卻很低。

原因是 `async def` 跑在 event loop 上，而一個 event loop 只有一個執行緒。`requests.get` 是同步呼叫，它在等網路回應的 3 秒裡**沒有把控制權交回 event loop**，這段時間同一個 worker 上的其他請求一個都動不了。CPU 很閒，因為它在等；但 event loop 被佔住了。

這篇從「等 I/O 的時候 CPU 在做什麼」開始，說明 async 怎麼運作、為什麼一個阻塞呼叫能卡住全部、以及什麼時候 async 根本幫不上忙。

## 三種處理多個請求的方式

假設每個請求都要等資料庫 100 ms、自己運算 5 ms。來了 3 個請求：

```text
同步、單執行緒（一次一個）
請求1 [算][────等 DB────][算]
請求2                         [算][────等 DB────][算]
請求3                                                  [算][────等 DB────][算]
總時間 ≈ 3 × 110 ms

多執行緒（每個請求一個執行緒，等 I/O 時釋放 GIL）
請求1 [算][────等 DB────][算]
請求2  [算][────等 DB────][算]
請求3   [算][────等 DB────][算]
總時間 ≈ 110 ms 多一點

async（一個執行緒，await 時切換）
請求1 [算]─await─┐              ┌[算]
請求2     [算]─await─┐          │  ┌[算]
請求3         [算]─await─┐      │  │  ┌[算]
                         └─ 三個等待疊在一起 ─┘
總時間 ≈ 110 ms 多一點
```

多執行緒與 async 都能把「等待」重疊起來，差別在**誰決定什麼時候切換**：

| | 多執行緒 | async |
|---|---|---|
| 切換時機 | 作業系統決定，任何一行之間都可能被切走 | 只在 `await` 的地方，由程式自己讓出 |
| 每個任務的成本 | 一個 OS 執行緒（自己的 stack，通常以 MB 計的保留空間） | 一個協程物件（KB 等級） |
| 同時等待的數量 | 數十到數百個執行緒就要考慮成本 | 上萬個連線也可以 |
| 共享資料 | 需要鎖，否則可能在任何地方被打斷 | 兩個 `await` 之間的程式不會被打斷，但跨 `await` 仍然可能交錯 |
| 弱點 | 執行緒多了切換與記憶體成本高 | **任何不 await 的長時間工作都會卡住全部** |

### GIL 與 CPU 密集工作

預設的 CPython 有 GIL（全域直譯器鎖）：同一時間只有一個執行緒在執行 Python bytecode。執行緒在等 I/O（socket、檔案、`time.sleep`）時會釋放 GIL，所以多執行緒對 I/O 密集的工作有效；但兩個執行緒都在算 Python 迴圈時，它們只能輪流拿 GIL，總時間和單執行緒差不多。

async 對 CPU 密集工作也沒有幫助，而且更糟：運算中沒有 `await`，event loop 完全停住。CPU 密集的工作要放到**別的行程**（`ProcessPoolExecutor`、背景工作佇列），讓它在另一顆 CPU 上跑。Python 3.13 起有不帶 GIL 的 free-threaded 版本（3.14 起不再標為實驗性），但它不是預設版本，C 擴充套件也需要個別支援；目前寫後端仍以「有 GIL」為前提比較穩當。行程、執行緒、GIL 的底層見 [程式怎麼跑起來](#/skill/how-programs-run)。

## event loop 怎麼運作

event loop 是一個不斷重複的迴圈，手上有兩份名單：「現在可以執行的任務」和「在等某件事的任務」。

1. 從「可以執行」的名單拿出一個任務，執行它，直到它碰到 `await` 一個還沒完成的東西（例如等 socket 有資料）。
2. 這個任務暫停，登記「等這個 socket」，放進等待名單。**控制權回到 loop**。
3. loop 拿下一個可以執行的任務，重複 1～2。
4. 沒有可以執行的任務時，loop 問作業系統：「我登記的這些 socket、計時器，哪些好了？」（Linux 上是 `epoll`）。
5. 好了的任務移回「可以執行」，回到 1。

關鍵字的實際意義：

- `async def f()` 定義一個**協程函式**；呼叫 `f()` 不會執行任何內容，只會產生一個協程物件。
- `await x` 的意思是「我要等 x 的結果；等的期間，loop 可以去跑別人」。只有 await 的對象真的需要等待時才會讓出（`await asyncio.sleep(0)` 是刻意讓出一次）。
- `asyncio.create_task(coro)` 把協程交給 loop 排程，**現在就開始跑**（在下一次讓出時），回傳一個 Task。
- `asyncio.gather(a, b, c)` 同時排程多個協程，等全部完成，依傳入順序回傳結果。

所以「async 比較快」是誤解：單一個請求不會因為 async 而變快。async 讓**同一個執行緒能同時等很多件事**，提高的是並行數量，前提是每件事大部分時間都在等 I/O、而且等待的地方都有 `await`。

## 實際程式

以下範例在瀏覽器裡的 Pyodide 執行，可以直接 `await`（頂層 await）；在本機的 CPython 要把最外層包成 `async def main()` 再用 `asyncio.run(main())`。用 `asyncio.sleep` 模擬 I/O 等待。

### 一個接一個 vs 一起等

```python run
import asyncio
import time

async def fetch(name: str, delay: float) -> str:
    await asyncio.sleep(delay)          # 模擬等資料庫／外部 API：這裡把控制權交回 loop
    return f"{name} done"

# 一個接一個：每個 await 都等到完成才發下一個
t0 = time.perf_counter()
for i in range(5):
    await fetch(f"q{i}", 0.2)
print(f"依序 await：{time.perf_counter() - t0:.2f} 秒")      # 約 1.0 秒

# 一起等：gather 先把 5 個都排程，再等全部完成
t0 = time.perf_counter()
results = await asyncio.gather(*(fetch(f"q{i}", 0.2) for i in range(5)))
print(f"gather：{time.perf_counter() - t0:.2f} 秒", results)  # 約 0.2 秒，順序和傳入一致

# 限制同時進行的數量（例如外部 API 只允許 2 個並行）
sem = asyncio.Semaphore(2)

async def limited(i: int) -> str:
    async with sem:                     # 拿不到就在這裡等，不佔用 loop
        return await fetch(f"api{i}", 0.2)

t0 = time.perf_counter()
await asyncio.gather(*(limited(i) for i in range(6)))
print(f"Semaphore(2) 跑 6 個：{time.perf_counter() - t0:.2f} 秒")  # 約 0.6 秒
```

### 一個阻塞呼叫卡住整個 loop

```python run
import asyncio
import time

def blocking_io(seconds: float) -> None:
    # 模擬同步 driver（requests、psycopg2）或 time.sleep：
    # 用忙等迴圈佔住執行緒，期間完全不讓出控制權
    end = time.perf_counter() + seconds
    while time.perf_counter() < end:
        pass

async def heartbeat(log: list, stop: asyncio.Event) -> None:
    # 每 50 ms 記一次時間；loop 被卡住時，兩次之間的間隔會變大
    last = time.perf_counter()
    while not stop.is_set():
        await asyncio.sleep(0.05)
        now = time.perf_counter()
        log.append(round((now - last) * 1000))
        last = now

async def run(handler) -> None:
    log, stop = [], asyncio.Event()
    hb = asyncio.create_task(heartbeat(log, stop))
    await asyncio.sleep(0.12)           # 讓心跳先跑幾拍
    await handler()
    await asyncio.sleep(0.12)
    stop.set()
    await hb
    print(f"{handler.__name__:15} 心跳間隔(ms)：{log}  最大 {max(log)}")

async def good_handler():
    await asyncio.sleep(0.4)            # 會讓出：心跳照常

async def bad_handler():
    blocking_io(0.4)                    # 不會讓出：0.4 秒內 loop 上誰都不能動

await run(good_handler)
await run(bad_handler)
```

`bad_handler` 那一行的心跳會出現一個約 400 ms 以上的間隔：在真的服務裡，這 400 ms 內同一個 worker 上所有請求、健康檢查都停住。

### CPU 密集工作：async 沒有幫助

```python run
import asyncio
import time

def cpu_work(n: int) -> int:
    # 純 Python 運算，中間沒有任何 await
    return sum(i * i for i in range(n))

async def cpu_task(n: int) -> int:
    return cpu_work(n)                  # 寫成 async def 也不會讓它「並行」

N = 300_000
cpu_work(N)                             # 先暖身一次，避免第一次呼叫的額外成本影響比較

t0 = time.perf_counter()
cpu_work(N)
one = time.perf_counter() - t0

t0 = time.perf_counter()
for _ in range(4):
    cpu_work(N)
seq = time.perf_counter() - t0

t0 = time.perf_counter()
await asyncio.gather(*(cpu_task(N) for _ in range(4)))
gathered = time.perf_counter() - t0

print(f"1 個：{one:.3f} 秒")
print(f"依序 4 個：{seq:.3f} 秒；gather 4 個：{gathered:.3f} 秒")
# gather 和依序差不多，都約是 1 個的 4 倍：一個執行緒輪流算完，沒有重疊。
# 對照第一段的 I/O：gather 5 個只花 1 個的時間。CPU 密集要交給別的行程。
```

### 逾時、錯誤與取消

```python run
import asyncio

async def call_service(name: str, delay: float, fail: bool = False) -> str:
    await asyncio.sleep(delay)
    if fail:
        raise ConnectionError(f"{name} 連線失敗")
    return name

# 1) 每個外部呼叫都要有逾時（Python 3.11 起有 asyncio.timeout）
try:
    async with asyncio.timeout(0.1):
        await call_service("slow", 1.0)
except TimeoutError:
    print("逾時：slow 被取消")

# 2) gather 預設遇到第一個例外就往外丟；其他任務不會被取消，會繼續跑
try:
    await asyncio.gather(call_service("a", 0.05), call_service("b", 0.02, fail=True))
except ConnectionError as e:
    print("gather 丟出：", e)

# 3) return_exceptions=True：把例外當成結果收回來，逐一處理
res = await asyncio.gather(call_service("a", 0.02), call_service("b", 0.02, fail=True),
                           return_exceptions=True)
print("return_exceptions：", res)

# 4) TaskGroup（3.11+）：其中一個失敗，其他的會被取消，例外包成 ExceptionGroup
try:
    async with asyncio.TaskGroup() as tg:
        tg.create_task(call_service("long", 1.0))
        tg.create_task(call_service("bad", 0.02, fail=True))
except* ConnectionError as eg:
    print("TaskGroup：", [str(e) for e in eg.exceptions], "，long 已被取消")
```

### 不能在瀏覽器跑的部分：把同步呼叫丟到執行緒

本站的 Python 跑在 Pyodide，不能建立執行緒，下面這段要在本機的 CPython 執行。

```python
import asyncio
import time
from concurrent.futures import ProcessPoolExecutor


def legacy_sync_call(order_id: int) -> dict:
    time.sleep(1)                       # 同步 I/O：舊 SDK、同步 driver
    return {"id": order_id}


def heavy_cpu(n: int) -> int:
    return sum(i * i for i in range(n))


async def handler(order_id: int) -> dict:
    # I/O 型的同步呼叫：丟到預設的執行緒池，等的時候 loop 可以跑別人（3.9+）
    order = await asyncio.to_thread(legacy_sync_call, order_id)

    # CPU 密集：丟到別的行程，才不會被 GIL 限制
    loop = asyncio.get_running_loop()
    with ProcessPoolExecutor() as pool:   # 實務上 pool 在啟動時建立一次重複使用
        total = await loop.run_in_executor(pool, heavy_cpu, 10_000_000)
    return {**order, "total": total}
```

`to_thread` 適合「沒有 async 版本的 I/O 函式庫」。能換成原生 async 的 client 更好：HTTP 用 `httpx.AsyncClient`、PostgreSQL 用 `asyncpg` 或 psycopg 3 的 async 介面。

### FastAPI 裡的 `def` 與 `async def`

```python
@app.get("/a")
def sync_handler():          # FastAPI 會把它放到執行緒池執行，同步呼叫不會卡住 loop
    return requests.get(URL, timeout=5).json()

@app.get("/b")
async def async_handler():   # 直接跑在 event loop 上：裡面只能用 await 版本的 I/O
    async with httpx.AsyncClient(timeout=5) as client:
        r = await client.get(URL)
    return r.json()
```

開頭那個事故的兩種修法：把 handler 改成 `def`（交給執行緒池），或是改用 async 的 HTTP client。最糟的組合是 `async def` 裡呼叫同步 I/O。執行緒池有上限（FastAPI 底層的 AnyIO 預設 40 個執行緒），同步 handler 很多又很慢時，請求會在池子前面排隊。

## 常見錯誤與錯誤訊息

| 訊息 | 原因 | 怎麼修 |
|---|---|---|
| `RuntimeWarning: coroutine 'fetch' was never awaited` | 呼叫了 `fetch()` 卻沒 `await`，協程根本沒執行 | 補上 `await`，或用 `create_task` 排程 |
| `RuntimeError: asyncio.run() cannot be called from a running event loop` | 在已經有 loop 的地方（async 函式內、Jupyter、Pyodide）又呼叫 `asyncio.run` | 已經在 async 裡就直接 `await` |
| `TypeError: object dict can't be used in 'await' expression`（3.14 改為 `'dict' object can't be awaited`） | `await` 了一個不是 awaitable 的值，常見於把同步函式當成 async 呼叫 | 確認被呼叫的函式是 `async def`，或拿掉 `await` |
| `Task exception was never retrieved` | `create_task` 建的任務丟了例外，但沒有人 await 它 | 保存 Task 並在之後 await，或用 TaskGroup |
| `Task was destroyed but it is pending!` | loop 關閉時還有沒完成的任務 | 關閉前取消並等待背景任務（例如在 lifespan 的關閉階段） |

沒有錯誤訊息、只有「變慢」的情況最難查：loop 被阻塞。開啟 asyncio 的 debug 模式（環境變數 `PYTHONASYNCIODEBUG=1`、`python -X dev`，或 `asyncio.run(main(), debug=True)`），執行超過 100 ms 沒讓出的步驟會被記錄下來：

```text
Executing <Task finished name='Task-1' coro=<handler() done, defined at app.py:12> result=None created at …> took 0.301 seconds
```

從 `coro=<handler() …>` 找到是哪個協程，再看裡面有沒有同步 I/O 或大量運算。常見的嫌疑：`requests`、`psycopg2`、同步的 Redis client、`time.sleep`、大檔案的 `open().read()`、`json.loads` 一份幾十 MB 的資料。

另一個陷阱是**共享狀態在 `await` 之間被改掉**：

```python
async def withdraw(account, amount):
    if account.balance >= amount:     # 檢查
        await audit_log(account)      # 這裡讓出：另一個請求可能也通過了檢查
        account.balance -= amount     # 扣款：兩個請求都扣了
```

async 沒有「任何一行都可能被切走」的問題，但每個 `await` 都是切換點。跨 `await` 的「檢查再修改」需要 `asyncio.Lock`，資料在資料庫裡時則要靠交易與條件更新（見 [交易、ACID 與隔離等級](#/skill/transactions)）。

## 動手

1. 到實驗室 [同步 vs 執行緒 vs async](#/lab/AsyncLab)，切換三種模式與「CPU 密集」開關，對照上面的時間軸。
2. 執行「阻塞呼叫」那段，把 `blocking_io(0.4)` 改成 `blocking_io(0.1)`，再在 `bad_handler` 裡改成分 4 次各 0.1 秒、每次之間 `await asyncio.sleep(0)`，觀察心跳的最大間隔怎麼變：這就是「切成小塊、定期讓出」。
3. 執行「CPU 密集」那段，把 4 改成 8，確認時間線性成長；想想放進 `ProcessPoolExecutor` 後，在 4 核心的機器上大約會是多少。
4. 程式題 [讓五個 I/O 一起等](#/exercise/python-async-1)：把依序 await 改成 `gather`。
5. 設計情境 [要跑三分鐘的匯出](#/scenario/long-task)：處理時間超過一個請求能等的範圍時，改用背景工作；延伸閱讀 [訊息佇列與背景工作](#/skill/queues-workers)。

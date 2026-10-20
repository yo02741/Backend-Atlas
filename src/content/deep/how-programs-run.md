## 從一個具體問題開始：跑了半天之後開始 `Too many open files`

一個 API 服務剛部署時一切正常，跑了幾個小時後，所有請求開始失敗，log 裡全是同一行：

```text
OSError: [Errno 24] Too many open files
```

重啟之後又正常了，幾個小時後再壞一次。程式碼裡根本沒有「開檔案」，問題卻叫 open files。

原因是：作業系統把**檔案、socket、pipe**都當成「打開的檔案」管理，每個行程能同時持有的數量有上限。程式每次呼叫外部 API 都新建一個 HTTP client、用完沒關，每個 TCP 連線就留下一個沒釋放的**檔案描述子**（file descriptor，fd），累積到上限（常見預設 1024）時，連接受新連線都做不到。

要看懂這類問題，得知道程式在作業系統裡是什麼樣子：行程、執行緒、記憶體、fd，以及「等 I/O」的時候 CPU 到底在做什麼。

## 行程與執行緒

**行程**（process）是作業系統分配資源的單位。每個行程有：

- 自己的**虛擬位址空間**：A 行程看不到 B 行程的記憶體
- 一個 **PID**，以及父行程的 PPID
- 一張 **fd 表**、環境變數、目前工作目錄、權限（以哪個使用者身分跑）

**執行緒**（thread）是 CPU 排程的單位，活在行程裡面。同一個行程的所有執行緒**共用**記憶體與 fd 表，但每個執行緒有自己的 **stack** 與暫存器狀態。CPython 的 `threading.Thread` 是真正的作業系統執行緒。

| | 行程 | 執行緒 |
|---|---|---|
| 記憶體 | 各自獨立 | 同一行程內共用 |
| 一個崩潰 | 不影響其他行程 | 整個行程一起掛 |
| 建立成本 | 較高（要複製或建立位址空間） | 較低 |
| 交換資料 | 要透過 IPC（pipe、socket、共享記憶體），通常要序列化 | 直接讀寫同一個物件，但要處理同時修改的問題 |

後端服務常見的形狀：`uvicorn app:app --workers 4` 會啟動 4 個 worker 行程，每個行程各自載入一份程式、各自有記憶體；每個行程裡面再有一個或多個執行緒。所以「把 worker 從 4 調到 8」會讓記憶體用量大約跟著翻倍，而存在 Python 全域變數裡的快取，每個 worker 各有一份、彼此不同步。

## 記憶體：stack 與 heap

### stack：函式呼叫一層疊一層

每呼叫一個函式，就在這個執行緒的 stack 上推一個 **frame**（放這次呼叫的區域變數、回到哪裡繼續），函式回傳就彈掉。stack 是後進先出，速度快，但大小有上限：Linux 上常見預設 8 MB（`ulimit -s` 看得到，單位 KB），這是上限，實際用多少才佔多少。

CPython 在 C 的 stack 用完之前就先用自己的遞迴上限擋住（預設 1000 層），超過會丟 `RecursionError`。

### heap：物件住的地方

在 CPython 裡，**所有物件都放在 heap**，變數只是指向物件的名字。`b = a` 不會複製 list，只是多一個名字指向同一個物件。物件沒有任何參照時，參照計數歸零就立刻釋放；互相參照的循環由週期性的 GC 收掉。

所以 Python 的「記憶體洩漏」很少是忘了 free，通常是**還有人參照著**：一個只加不刪的全域 dict 快取、一個不斷 append 的 list、一個把每個請求物件都記下來的 log handler。

```python run
import sys

# 每一層呼叫都在 stack 上有自己的 frame；沿著 f_back 往回走就是呼叫鏈
def current_stack():
    names = []
    frame = sys._getframe()
    while frame and frame.f_code.co_name != "<module>":
        names.append(frame.f_code.co_name)
        frame = frame.f_back
    return list(reversed(names))

def handler():
    return service()

def service():
    return repository()

def repository():
    return current_stack()

print("呼叫鏈：", " → ".join(handler()))

# 變數是指向 heap 上物件的名字
cart = ["蘋果"]
same = cart                  # 沒有複製，兩個名字指向同一個 list
same.append("香蕉")
print(cart, "同一個物件？", cart is same)

copy = list(cart)            # 這才建立新物件
copy.append("芭樂")
print(cart, copy, "同一個物件？", cart is copy)

# 遞迴太深：每一層都要一個 frame，超過上限就停
print("遞迴上限：", sys.getrecursionlimit())

def forever(n):
    return forever(n + 1)

try:
    forever(0)
except RecursionError as e:
    print("RecursionError:", e)
```

## 檔案描述子：所有 I/O 的把手

行程打開任何「可以讀寫的東西」，核心就在它的 fd 表裡放一筆，回傳一個小整數，之後的讀寫都拿這個號碼。

- `0`、`1`、`2` 固定是 stdin、stdout、stderr
- 開檔案、建立 socket、`accept()` 接到一條新連線、建立 pipe，各佔一個 fd
- 新的 fd 會拿**目前最小的空號**

對一個 Web 服務來說：監聽的 port 是一個 fd，每條進來的連線是一個 fd，每條連到資料庫、Redis、外部 API 的連線也各是一個 fd。同時服務 2,000 條連線，就至少要 2,000 多個 fd。

上限有兩層：**soft limit**（實際生效、行程自己可以往上調到 hard limit）與 **hard limit**（只有特權能提高）。Shell 裡 `ulimit -n` 看 soft、`ulimit -Hn` 看 hard。服務用 systemd 或容器啟動時，上限由它們的設定決定（例如 systemd 的 `LimitNOFILE`），不一定和你登入的 shell 一樣，所以要看**那個行程**的實際值：`/proc/<pid>/limits`。

```python run
import os

# 新開的 fd 從 3 起跳（0、1、2 已經被 stdin / stdout / stderr 佔走）
fds = [os.open(f"/tmp/demo-{i}.txt", os.O_CREAT | os.O_WRONLY) for i in range(3)]
print("開了三個檔案：", fds)

os.close(fds[1])                                   # 關掉中間那個
again = os.open("/tmp/demo-x.txt", os.O_CREAT | os.O_WRONLY)
print("關掉", fds[1], "之後再開：", again)           # 拿到目前最小的空號

for fd in (fds[0], fds[2], again):
    os.close(fd)

# with：區塊結束（包括中途丟例外）時一定會 close，fd 立刻還回去
def write_log(path, text):
    with open(path, "a", encoding="utf-8") as f:
        f.write(text + "\n")
        return f.fileno()

print("第一次寫 log 用的 fd：", write_log("/tmp/app.log", "hello"))
print("第二次還是同一個號碼：", write_log("/tmp/app.log", "world"))

# 忘了關：號碼一直往上長。真的服務裡長到 ulimit -n 就是 Errno 24
leaked = [open(f"/tmp/leak-{i}.txt", "w") for i in range(5)]
print("沒關的檔案佔著：", [f.fileno() for f in leaked])
for f in leaked:
    f.close()
```

HTTP client 也一樣：`httpx.Client`、`requests.Session` 背後有連線池，每條保持中的連線是一個 fd。正確用法是整個應用共用一個 client（啟動時建立、關閉時 `close()`），不要每個請求新建一個又不關。

## 系統呼叫：程式和核心之間的門

讀檔、寫 socket、開連線、配置大塊記憶體、建立行程，這些事程式自己做不到，要請核心代勞，這個請求就是**系統呼叫**（system call）：`openat`、`read`、`write`、`socket`、`connect`、`accept`、`epoll_wait`、`mmap`、`clone`。

Python 的 `f.read()`、`sock.recv()` 最後都會落到某個系統呼叫。進出核心有成本，所以標準函式庫會做緩衝：`print` 不是每次都直接 `write`，而是先累積在緩衝區。這也是為什麼程式被強制砍掉時，最後幾行輸出可能不見。

### 阻塞 I/O 時，CPU 在做什麼

執行緒呼叫 `recv()` 等資料庫回應，而資料還沒到：

1. 核心把這個執行緒標成**睡眠**（`ps` 裡的狀態 `S`），從可執行佇列拿掉
2. CPU 去跑其他可以跑的執行緒或行程；都沒有就閒置
3. 網卡收到封包，核心處理完、放進那個 socket 的緩衝區，把等它的執行緒叫醒
4. 執行緒回到可執行佇列，輪到它時 `recv()` 回傳

所以阻塞 I/O **不會燒 CPU**，它燒的是**執行緒**：一個執行緒在等的時候什麼都不能做，但它的 stack 和核心資料結構還佔著。用「一條連線一個執行緒」的模型同時服務 5,000 條慢連線，就要 5,000 個執行緒。

另一種做法是 **I/O 多工**：把 socket 設成非阻塞，用 `epoll`（Linux；macOS 是 `kqueue`）一次監看大量 fd，「哪個好了就處理哪個」。一個執行緒就能服務大量連線，代價是程式要寫成可以中途讓出、之後接著做的形式。asyncio 的 event loop 就是這樣：`await` 的地方把控制權交回 loop，loop 去 `epoll_wait` 看誰好了。

這也表示：在 event loop 上做**純計算**，或呼叫**同步阻塞**的函式，loop 就完全卡住。下面這段可以看到差別：

```python run
import asyncio
import time

# ticker 每 0.1 秒醒一次，記下實際醒來的時間點
async def ticker(log):
    start = time.perf_counter()
    for _ in range(5):
        await asyncio.sleep(0.1)
        log.append(round(time.perf_counter() - start, 2))

async def wait_io():
    await asyncio.sleep(0.3)         # 模擬等 I/O：交還執行權，loop 去跑別人

def crunch():
    t = time.perf_counter()
    while time.perf_counter() - t < 0.3:
        pass                          # 純計算：一直佔著這個執行緒

async def main():
    log = []
    await asyncio.gather(ticker(log), wait_io())
    print("旁邊在等 I/O：", log)      # 大約 0.1, 0.2, 0.3, 0.4, 0.5

    log = []
    task = asyncio.create_task(ticker(log))
    await asyncio.sleep(0.05)         # 先讓 ticker 跑起來
    crunch()                          # 這 0.3 秒內 loop 沒機會切換
    await task
    print("旁邊在算 CPU：", log)      # 第一次醒來被拖到 0.3 秒以後

await main()
```

> 本站的 Python 跑在瀏覽器裡的 Pyodide，不能建立執行緒（會丟 `RuntimeError: can't start new thread`），所以這裡用 asyncio 示範。執行緒版本的行為要在本機的 CPython 試。

## Python 的 GIL 與多行程

預設的 CPython 有一把 **GIL**（Global Interpreter Lock）：同一個行程裡，同一時間只有一個執行緒在執行 Python bytecode。

- 執行緒在做阻塞 I/O（讀 socket、讀檔、`time.sleep`）時會**釋放** GIL，別的執行緒可以接著跑。所以多執行緒對 **I/O 密集**的工作有效。
- 純 Python 的 **CPU 密集**運算，開再多執行緒也只是輪流跑，不會變快。
- 部分 C 擴充（例如 `hashlib` 處理大資料、NumPy 的許多運算）在計算時會釋放 GIL，這類工作多執行緒可能有效，要看該函式庫的說明。

要用滿多核心跑 Python 計算，就用**多行程**：每個行程有自己的直譯器和自己的 GIL。代價是記憶體各一份，傳資料要序列化（`multiprocessing` 預設用 pickle），大物件來回傳遞很貴。

```python
# 在本機 CPython 執行（瀏覽器裡的 Pyodide 不能開行程或執行緒）
import time
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor

def work(n):
    return sum(i * i for i in range(n))

if __name__ == "__main__":          # 多行程在某些平台會重新匯入主模組，一定要有這行
    jobs = [5_000_000] * 4
    for pool_cls in (ThreadPoolExecutor, ProcessPoolExecutor):
        t = time.perf_counter()
        with pool_cls(max_workers=4) as pool:
            list(pool.map(work, jobs))
        print(pool_cls.__name__, round(time.perf_counter() - t, 2), "秒")
    # 多核心機器上，預設 CPython 的 ProcessPool 通常明顯較快；ThreadPool 跟單執行緒差不多
```

Python 3.13 起提供實驗性的 **free-threaded** 版本（沒有 GIL，PEP 703），3.14 起列為正式支援，但仍不是預設的 build，部分 C 擴充還在跟進。部署前先確認你用的是哪一種 build（`python -VV` 的輸出會註明）。

## 用工具看：ps、top、ulimit

以下指令在 Linux 主機或容器裡執行：

```bash
# 找到服務的行程：PID、父行程、執行緒數（NLWP）、實體記憶體（RSS，KB）、狀態
ps -eo pid,ppid,nlwp,rss,stat,cmd | grep uvicorn

# 即時看 CPU / 記憶體；按 1 顯示每顆核心，按 H 切換成以執行緒為單位
top
top -H -p <pid>

# 目前 shell 的上限：同時開啟的 fd 數（soft / hard）、stack 大小（KB）
ulimit -n
ulimit -Hn
ulimit -s

# 某個行程「實際」的上限，與目前開了幾個 fd、各是什麼
cat /proc/<pid>/limits | grep -i "open files"
ls -l /proc/<pid>/fd | wc -l
ls -l /proc/<pid>/fd | head        # 會看到 socket:[12345]、/var/log/... 這類項目

# 觀察行程做了哪些系統呼叫（需要安裝 strace）
strace -f -e trace=network -p <pid>
```

怎麼讀：

| 欄位 | 意思 |
|---|---|
| `STAT` 的 `R` | 正在跑或排隊等 CPU |
| `STAT` 的 `S` | 睡眠中，通常在等 I/O 或計時器；閒置的 Web 服務大部分時間是這個 |
| `STAT` 的 `D` | 不可中斷的睡眠，多半在等磁碟或網路檔案系統；長時間大量出現要查儲存 |
| `STAT` 的 `Z` | 殭屍：已結束但父行程還沒收屍 |
| `RSS` / `VSZ` | 實際佔用的實體記憶體 / 保留的虛擬位址空間；看記憶體用量看 RSS |
| `top` 的 `%CPU` | 以單一核心為 100%，多執行緒行程可以超過 100% |
| `top` 的 `wa` | CPU 閒著等 I/O 的時間比例 |

一個 CPU 使用率很低、但回應很慢的服務，常見的原因是執行緒或連線都卡在等某個下游（資料庫、外部 API），而不是算不動。

## 常見錯誤與錯誤訊息

| 訊息 | 原因 | 怎麼查、怎麼修 |
|---|---|---|
| `OSError: [Errno 24] Too many open files` | fd 用完：連線或檔案沒關，或上限太低 | 隔一段時間數一次 `/proc/<pid>/fd` 底下的項目，看是否一路成長；成長就是洩漏，找沒用 `with` 或沒 `close()` 的地方；確實需要大量連線才調高 `LimitNOFILE` / `ulimit -n` |
| `RecursionError: maximum recursion depth exceeded` | 遞迴太深或無窮遞迴 | 看 traceback 重複的那幾層；改成迴圈，不要只把 `sys.setrecursionlimit` 調大（調太大可能直接把 C stack 用爆、整個行程崩潰） |
| 行程消失，退出碼 `137`，`dmesg` 有 `Out of memory: Killed process` | 記憶體超過容器或主機上限，被核心的 OOM killer 用 SIGKILL（9）砍掉，128 + 9 = 137 | 看 RSS 隨時間的變化；持續上升就找沒釋放的參照（只增不減的快取、全域 list）；減少 worker 數或調高上限 |
| `RuntimeError: can't start new thread` | 無法再建立執行緒：達到行程或容器的執行緒數上限、記憶體不足，或環境不支援執行緒（例如 Pyodide） | 用執行緒池（`ThreadPoolExecutor`）限制數量，不要每個請求開一個新執行緒 |
| `BrokenPipeError: [Errno 32] Broken pipe` | 對方已經關閉連線，你還在寫 | 客戶端提早斷線時常見；在寫入處處理，不必當成伺服器錯誤告警 |

## 動手

1. 在 Playground 開啟 fd 那段，把「沒關的檔案」改成開 50 個，看號碼長到多少；再把那幾行改成 `with` 寫法比較。
2. 跑 asyncio 那段，把 `crunch()` 的 0.3 秒改成 1 秒，看 ticker 第一次醒來被拖多久；再把 `crunch()` 換成 `await asyncio.sleep(0.3)` 比較。
3. 在自己的 Linux 環境啟動任一個 Python 服務，用 `ps -o nlwp`、`ls /proc/<pid>/fd` 看它有幾個執行緒、幾個 fd，送幾個請求後再看一次。
4. 接著看 [同步、多執行緒與 async](#/skill/python-async)，用 [AsyncLab](#/lab/AsyncLab) 比較三種模型處理同一批請求的時間軸。

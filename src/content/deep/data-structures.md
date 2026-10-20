## 從一個具體問題開始：每秒把 50 萬筆提醒掃一遍

一個預約提醒服務：使用者設定「明天早上 9 點提醒我回診」，服務在時間到時推播。第一版把待發的提醒放在記憶體的 list 裡，背景迴圈每秒檢查一次：

```python
reminders = []          # [(到期時間, 提醒), ...]

def tick(now):
    due = [r for r in reminders if r[0] <= now]          # 掃過每一筆
    for r in due:
        reminders.remove(r)                              # 每次 remove 又是一次掃描
        push(r[1])
```

上線初期只有幾百筆，沒有任何問題。累積到 50 萬筆待發提醒後，這個迴圈每秒要比對 50 萬次，只為了找出這一秒到期的那幾筆；尖峰時一秒內到期的有幾千筆，每筆 `remove` 又要掃一次 list，這一秒的工作做不完，下一秒又來了，推播開始延遲。

這段程式真正需要的操作只有兩個：「最早到期的是哪一筆」和「把它拿出來」。list 對這兩件事都是 O(n)。**heap**（堆）可以讓「看最早的」變 O(1)、「拿出來」變 O(log n)。改用 `heapq` 後，每秒的工作量只和「這一秒到期的筆數」有關，和總共有幾筆幾乎無關。

選資料結構的方法就是這樣：**先列出程式要做哪些操作、各做多少次，再挑讓最頻繁的操作最便宜的結構。**

## 先列操作，再挑結構

| 需要的操作 | 結構 | 主要操作的複雜度 | Python | Redis | 資料庫裡的對應 |
|---|---|---|---|---|---|
| 依 key 取值、判斷存不存在、去重、計數 | hash map / set | 平均 O(1) | `dict`、`set`、`Counter` | `HASH`、`SET` | 唯一索引、hash 索引 |
| 先進先出 | 佇列 / deque | 兩端 O(1) | `collections.deque`、`queue.Queue` | `LIST`（`LPUSH` / `BRPOP`） | jobs 表 + `FOR UPDATE SKIP LOCKED` |
| 永遠取最小（或最大） | heap | 取出 O(log n)、看最小 O(1) | `heapq` | `ZSET`（`ZPOPMIN`） | 依時間欄位的索引 + `ORDER BY … LIMIT 1` |
| 排序、範圍查詢 | 平衡樹、B-tree、skip list | 查找與插入 O(log n) | 排序 list + `bisect`（插入是 O(n)） | `ZSET`（`ZRANGE … BYSCORE`） | B-tree 索引 |
| 前綴查詢 | trie / radix tree | O(前綴長度) | 標準函式庫沒有 | `ZSET` 同分時依字典序（`ZRANGE … BYLEX`） | B-tree 搭配 `LIKE 'abc%'`（有條件，見下文） |
| 關係、依賴、可達性 | 圖 | 走訪 O(點 + 邊) | `dict` 存鄰接串列、`graphlib` | — | `WITH RECURSIVE` |

### hash map 與 set

hash map 把 key 經過 hash 函數算出一個位置，直接到那個位置取值，所以平均 O(1)。兩個 key 算到同一個位置叫**碰撞**，結構裡會另外處理；元素多到一定比例時，整張表會擴大並重新分配位置（這一次是 O(n)，攤銷後仍是 O(1)）。

後端裡它無所不在：

- **去重與對照**：兩份清單比對，先把一份轉成 set 或 dict。這等於在記憶體裡做一次 hash join。
- **計數與分組**：`Counter(paths).most_common(10)`、`defaultdict(list)` 依某個欄位分組。
- **快取**：快取本體就是一個 hash map，再加上淘汰規則，見 [LRU 與快取淘汰](#/skill/lru-cache)。

限制是 key 必須**可雜湊**（hashable）：值不能變。`list`、`dict`、`set` 不能當 key，要換成 `tuple` 或 `frozenset`。Python 3.7 起 `dict` 保證保留插入順序，這是語言規格的一部分；`set` 不保證順序。

### 陣列、deque 與佇列

Python 的 `list` 是連續的陣列：用索引存取 O(1)，尾端增刪攤銷 O(1)，但**頭端**增刪要把後面的元素全部搬一格，是 O(n)。拿 list 當佇列用 `pop(0)`，佇列一長就變慢。

`collections.deque` 兩端增刪都是 O(1)，適合：

- **工作佇列**：生產者 `append`、消費者 `popleft`。多執行緒之間要用 `queue.Queue`（內建鎖與阻塞等待），asyncio 裡用 `asyncio.Queue`。跨程序、跨主機的佇列就要靠 Redis 或訊息系統，見 [訊息佇列與背景工作](#/skill/queues-workers)。
- **只留最近 N 筆**：`deque(maxlen=100)` 滿了以後，新的進來、最舊的自動從另一端掉出去，適合「最近 100 次的延遲」或滑動視窗限流的時間戳紀錄（見 [限流演算法](#/skill/rate-limiting)）。
- **BFS**（廣度優先搜尋）的待走訪佇列。

deque 中間的索引存取是 O(n)，需要隨機存取時還是用 list。

### heap：優先佇列

heap 是一棵存在陣列裡的完全二元樹，規則只有一條：**每個節點都不大於它的子節點**（最小堆）。所以最小值永遠在 `heap[0]`。位置 i 的子節點在 2i+1 與 2i+2，不需要指標。

- `heappush`：放到最後，往上和父節點比、比較小就交換，最多走樹的高度：O(log n)。
- `heappop`：取走根，把最後一個元素放到根，往下和較小的子節點交換：O(log n)。
- `heapify`：把整個 list 一次整理成 heap，是 O(n)，比逐一 push 的 O(n log n) 快。

`heapq` 只有最小堆。要最大堆就存負數，或用 `heapq.nlargest(k, items)` 取前 k 大（內部維護一個大小為 k 的 heap，約 O(n log k)）。

heap 在後端出現的地方：

- **計時與排程**：asyncio 的 event loop 用 heap 管理 `call_later` 排定的回呼；開頭的提醒服務也是。單機的排程器夠用，多台主機的排程見 [排程工作](#/skill/job-scheduling)。
- **top-k**：「本小時最熱門的 10 篇文章」不用把全部排序。
- **合併多個已排序的串流**：`heapq.merge` 把多個排好序的檔案或分頁結果合併成一個，每次只在記憶體裡放每個來源的一筆。

heap 不支援「刪除中間某一筆」。提醒被使用者取消時，常見做法是**延遲刪除**：另外用一個 set 記下已取消的 id，pop 出來時發現在 set 裡就跳過。

### 樹：B-tree、平衡二元樹、trie

**平衡二元搜尋樹**（紅黑樹、AVL）讓查找、插入、刪除都是 O(log n)，而且可以依序走訪。很多語言的有序 map 用它實作（Java 的 `TreeMap`、C++ 的 `std::map`），Python 標準函式庫沒有現成的。

**B-tree** 是資料庫索引的預設結構。它和二元樹的差別是每個節點存很多 key：一個節點就是一個磁碟 page（PostgreSQL 預設 8 kB），裡面放數百個 key（依 key 大小而定）。以每個節點 300 個分支估算（示意），3 層約可指到 2,700 萬筆、4 層約 81 億筆；同樣的資料放在二元樹裡，高度是 25 到 33 層。查找的成本主要是讀 page 的次數，所以「樹很矮」比「每個節點比較快」重要得多。B-tree 的走訪過程與 EXPLAIN 的讀法見 [索引](#/skill/indexes) 與 [索引為什麼快](#/lab/IndexLab) 實驗室。

**skip list** 是多層的有序鏈結串列，平均 O(log n) 查找，實作比平衡樹簡單。Redis 的 sorted set 用 skip list 加 hash table 實作：用 member 查分數 O(1)、依分數範圍查詢 O(log n + 回傳筆數)。排行榜、依時間排序的延遲任務常用它。

**trie**（前綴樹）每個節點是一個字元，從根走到某節點就是一個前綴，適合自動完成與前綴比對；把只有一個子節點的路徑壓縮起來就是 radix tree，有些 HTTP 路由器用它比對路徑。資料在 PostgreSQL 裡時，`LIKE 'abc%'` 可以用 B-tree 索引，但前提是資料庫的 collation 是 `C`，或索引建立時指定 `text_pattern_ops`。

### 圖

點與邊。後端最常用「鄰接串列」：`dict` 的 key 是點，值是相鄰點的 list。

- **依賴排序**（拓樸排序）：CI 的 job、migration、套件安裝順序。只有沒有循環的有向圖（DAG）才排得出來，有循環代表設定錯誤，要直接報錯。Python 3.9 起標準函式庫有 `graphlib.TopologicalSorter`。
- **可達性與距離**：權限繼承（admin 繼承 editor、editor 繼承 viewer）、「朋友的朋友」。沒有權重時，BFS 第一次走到某個點的距離就是最短距離。
- **資料在資料庫裡**時，用 `WITH RECURSIVE` 在 SQL 裡走訪，不用一層一層撈回應用程式。

### 機率型結構：用一點誤差換大量記憶體

- **Bloom filter**：判斷「一定不在」或「可能在」。不會漏判（沒有 false negative），但有一定比例的誤判（false positive）。適合放在昂貴查詢前面先擋掉「一定不存在」的 key，例如快取穿透的防護；LSM-tree 類的儲存引擎（RocksDB、Cassandra）也用它減少讀磁碟。
- **HyperLogLog**：估計「有幾個不重複的元素」，例如每日不重複訪客。Redis 的 `PFADD` / `PFCOUNT` 每個 key 最多約 12 kB，官方文件標示標準誤差 0.81%。

## 實際程式

### heap 取代全掃

把開頭的提醒服務縮小成 2 萬筆，比較兩種寫法在前 10 秒各做了多少步：

```python run
import heapq
import itertools
import random

random.seed(7)
# 2 萬個待發提醒：(到期時間, 提醒 id)；到期時間散在接下來的 1,000 秒內
reminders = [(random.randint(1, 1000), f"r{i}") for i in range(20_000)]

# 寫法一：放在 list，每秒掃一遍找出到期的
def tick_with_list(items, now):
    steps = len(items)                         # 每次都要看過每一筆：O(n)
    due = [r for r in items if r[0] <= now]
    items[:] = [r for r in items if r[0] > now]
    return due, steps

# 寫法二：放在 heap，最早到期的永遠在 heap[0]
def tick_with_heap(heap, now):
    due, steps = [], 1                         # 看一眼 heap[0]：O(1)
    while heap and heap[0][0] <= now:
        due.append(heapq.heappop(heap))        # 每取出一筆：O(log n)
        steps += max(1, len(heap).bit_length())
    return due, steps

lst = list(reminders)
hp = list(reminders)
heapq.heapify(hp)                              # 一次整理成 heap：O(n)

total_list = total_heap = 0
for now in range(1, 11):                       # 模擬前 10 秒，每秒一次
    d1, s1 = tick_with_list(lst, now)
    d2, s2 = tick_with_heap(hp, now)
    assert sorted(d1) == sorted(d2)            # 兩種寫法發出的提醒完全一樣
    total_list += s1
    total_heap += s2
print(f"10 秒內發出 {len(reminders) - len(hp)} 則提醒")
print(f"list 每秒全掃：約 {total_list:,} 步")
print(f"heap 只看最前面：約 {total_heap:,} 步")

# heap 的元素要能比較：優先序相同時，Python 會接著比 tuple 的第二個欄位
jobs = []
try:
    heapq.heappush(jobs, (5, {"task": "send_email"}))
    heapq.heappush(jobs, (5, {"task": "resize_image"}))   # 5 == 5，接著比兩個 dict
except TypeError as e:
    print("TypeError:", e)

# 修法：中間放一個遞增序號。相同優先序時依加入順序，而且永遠不會比到 dict
seq = itertools.count()
jobs = []
for prio, task in [(5, "send_email"), (1, "charge_card"), (5, "resize_image")]:
    heapq.heappush(jobs, (prio, next(seq), {"task": task}))
print("取出順序：", [heapq.heappop(jobs)[2]["task"] for _ in range(3)])
```

「步數」是示意的計數（list 算每筆看一次，heap 算每次 pop 走的層數），重點是倍數：這次執行 list 寫法約 20 萬步、heap 寫法約 3 千步。把提醒數量改成 20 萬筆再跑，list 那邊跟著變十倍，heap 那邊幾乎不變，因為它只和「到期的筆數 × log n」有關。

### hash map、deque 與圖

```python run
from collections import Counter, defaultdict, deque
from graphlib import TopologicalSorter, CycleError

# 1. hash map：計數與分組
logs = ["GET /api/orders", "GET /api/users", "GET /api/orders", "POST /api/orders", "GET /api/orders"]
print("最常被打的端點：", Counter(logs).most_common(2))
by_method = defaultdict(list)
for line in logs:
    method, path = line.split()
    by_method[method].append(path)
print("依方法分組：", dict(by_method))

# 2. deque(maxlen=…)：只留最近 N 筆，舊的自動從另一端掉出去
recent = deque(maxlen=3)
for latency_ms in [120, 95, 300, 110, 105]:
    recent.append(latency_ms)
print("最近 3 次延遲：", list(recent), "平均", round(sum(recent) / len(recent), 1))

# 3. 圖：CI 的 job 依賴，值是「要先完成的 job」
deps = {
    "test": {"install"},
    "lint": {"install"},
    "build": {"test", "lint"},
    "deploy": {"build"},
}
print("一種合法的執行順序：", list(TopologicalSorter(deps).static_order()))

# 可以並行的批次：prepare() 之後，每輪取出所有依賴都已完成的 job
ts = TopologicalSorter(deps)
ts.prepare()
batch_no = 1
while ts.is_active():
    ready = sorted(ts.get_ready())
    print(f"第 {batch_no} 批（可同時跑）：", ready)
    ts.done(*ready)
    batch_no += 1

# 循環依賴會被抓出來
deps["install"] = {"deploy"}
try:
    list(TopologicalSorter(deps).static_order())
except CycleError as e:
    print("CycleError:", e.args[0], e.args[1])

# 4. BFS：沒有權重的圖上，第一次走到的距離就是最短距離
follows = {"amy": ["ben", "cat"], "ben": ["dan"], "cat": ["dan", "eve"], "dan": ["fay"], "eve": [], "fay": []}

def hops(graph, start):
    dist, q = {start: 0}, deque([start])
    while q:
        node = q.popleft()                 # deque 的 popleft 是 O(1)
        for nxt in graph[node]:
            if nxt not in dist:            # dict 查找 O(1)，每個點只走一次
                dist[nxt] = dist[node] + 1
                q.append(nxt)
    return dist

print("從 amy 出發的距離：", hops(follows, "amy"))
```

### 圖在資料庫裡：WITH RECURSIVE

角色繼承存在資料表裡時，直接在 SQL 裡走訪。PostgreSQL 14 起有 `CYCLE` 子句，可以標出循環、避免無窮遞迴：

```sql run
CREATE TABLE role_parents (role TEXT, parent TEXT);
INSERT INTO role_parents VALUES
  ('editor', 'viewer'), ('admin', 'editor'), ('admin', 'billing'), ('billing', 'viewer');

-- admin 直接或間接繼承了哪些角色；UNION（不是 UNION ALL）會去掉重複的列
WITH RECURSIVE inherited(role) AS (
  SELECT 'admin'::text
  UNION
  SELECT rp.parent FROM role_parents rp JOIN inherited i ON rp.role = i.role
)
SELECT role FROM inherited ORDER BY role;

-- 有人設錯，讓 viewer 又繼承 admin：形成循環
INSERT INTO role_parents VALUES ('viewer', 'admin');

-- CYCLE 子句記錄走過的路徑，走回已經走過的點時 is_cycle = true 並停止
WITH RECURSIVE walk(role, depth) AS (
  SELECT 'admin'::text, 0
  UNION ALL
  SELECT rp.parent, w.depth + 1 FROM role_parents rp JOIN walk w ON rp.role = w.role
) CYCLE role SET is_cycle USING path
SELECT role, depth, is_cycle, path FROM walk ORDER BY depth, role;
```

第二個查詢裡 viewer 出現兩次（經由 editor 與經由 billing），深度 3 的兩列 `is_cycle` 是 true，代表那兩條路都繞回了 admin。

## 常見錯誤與錯誤訊息

| 錯誤訊息 | 原因 | 修法 |
|---|---|---|
| `TypeError: unhashable type: 'list'` | 用 list（或 dict、set）當 dict 的 key 或 set 的元素 | 換成 `tuple(...)` 或 `frozenset(...)` |
| `TypeError: '<' not supported between instances of 'dict' and 'dict'` | heap 裡的 tuple 第一個欄位相同，Python 接著比第二個欄位 | 中間放遞增序號：`(priority, seq, item)` |
| `IndexError: index out of range` | 對空的 heap 呼叫 `heappop` | 先檢查 `if heap:` |
| `RuntimeError: dictionary changed size during iteration` | 走訪 dict 的同時新增或刪除 key | 走訪 `list(d.items())` 的複本，或先收集要刪的 key 再刪 |
| `graphlib.CycleError: ('nodes are in a cycle', [...])` | 依賴圖有循環 | 訊息裡的 list 就是循環的路徑，從那裡找出設錯的依賴 |
| `WRONGTYPE Operation against a key holding the wrong kind of value` | Redis 對某個 key 用了不符合它型別的指令，例如對 `LIST` 下 `HGET` | key 加上型別前綴的命名規則；用 `TYPE key` 檢查 |

沒有錯誤訊息、但會讓效能慢慢變差的情況：

- **list 當佇列**：`pop(0)` 和 `insert(0, x)` 是 O(n)，佇列越長越慢。換 `deque`。
- **在 list 裡判斷存在**：迴圈裡 `if x in some_list` 就是 O(n²) 的來源（見 [Big-O](#/skill/big-o)）。
- **可變物件當 key**：自訂類別定義了依欄位計算的 `__hash__`，放進 dict 後又改了那個欄位，之後就再也找不到它，也不會報錯。當 key 的物件要不可變（例如 `@dataclass(frozen=True)`）。
- **堆積如山的延遲刪除**：heap 搭配「已取消」set 時，被取消的元素還佔著空間。取消比例很高時，定期重建 heap。

## 動手

1. 在 Playground 跑 heap 那段，把 `range(20_000)` 改成 `range(200_000)`，看 list 與 heap 的步數各變幾倍。
2. 在 hash map 那段，把 `deps` 改成你熟悉的建置流程，看 `get_ready()` 分出的批次是否符合預期；故意加一條循環依賴看錯誤訊息。
3. 在 `WITH RECURSIVE` 那段把 `CYCLE` 子句拿掉，並在遞迴部分加上 `WHERE w.depth < 6`（一定要加，否則有循環時查詢會一直遞迴下去），看同一個循環被重複走了幾圈。這就是 `CYCLE` 子句要防的事。
4. 程式題：[用 heapq 取前 k 大](#/exercise/data-structures-1)。
5. 開 [索引為什麼快](#/lab/IndexLab) 實驗室，對照循序掃描與 B-tree 走訪的比較次數。

## 從一個具體問題開始：加了 `@lru_cache`，記憶體一路漲，資料還忽新忽舊

個人資料頁很慢，有人在查詢函式上加了一行：

```python
from functools import lru_cache

@lru_cache(maxsize=None)          # 「不設上限比較快」
def get_profile(user_id: int) -> dict:
    return db.fetch_one("SELECT * FROM profiles WHERE user_id = %s", [user_id])
```

頁面確實變快了。接下來幾週出現兩個問題：

1. **記憶體只漲不跌**。服務用 Gunicorn 開 8 個 worker，每個 worker 都有自己的一份快取；`maxsize=None` 沒有上限，每個被看過的使用者都留在記憶體裡，直到程序重啟。幾十萬使用者之後，容器開始被 OOM 砍掉。
2. **使用者改了暱稱，重新整理時有時看到新的、有時看到舊的**。更新資料庫的請求跑在 worker 3，只有它的快取被清掉（如果有人記得清的話）；其他 7 個 worker 的快取裡還是舊資料，負載平衡把請求分到哪一個，就看到哪一個版本。

這兩件事都和快取的兩個基本問題有關：**容量有限時要丟掉誰**（淘汰策略），以及**快取放在哪裡、誰負責讓它失效**。這一課講第一個問題的機制與量測，以及程序內快取（`lru_cache`）與共享快取（Redis）各自的界線。失效策略與 cache-aside 的細節見 [Redis 快取](#/skill/redis-cache)。

## 淘汰策略：滿了丟誰

| 策略 | 丟掉誰 | 擅長 | 弱點 |
|---|---|---|---|
| FIFO | 最早放進來的 | 實作最簡單 | 不管熱不熱，熱門的 key 也會被輪到 |
| LRU（Least Recently Used） | 最久沒被用的 | 「最近用過的，很快會再用」的流量，大部分 Web 流量是這樣 | 一次性的大量讀取（全表掃描、爬蟲）會把熱門資料擠出去 |
| LFU（Least Frequently Used） | 被用最少次的 | 熱門集合穩定、要抵抗一次性掃描 | 過去很熱、現在沒人用的 key 會賴著不走，需要讓計數隨時間衰減 |
| TTL-only | 到期的 | 資料有明確的新鮮度要求 | 只管「舊」不管「滿」，容量仍可能爆 |
| Random | 隨便一個 | 存取機率平均時 | 對熱門資料沒有任何保護 |

LRU 是最常見的預設，因為多數流量有**時間局部性**：剛被讀過的資料，接下來被再讀的機率比較高。但它對**掃描**很脆弱：夜間報表把一萬筆冷資料各讀一次，每一筆都會被放到「最近使用」，把白天真正熱門的資料擠出去。

為了這個問題，實務上的快取常用 LRU 的改良版：

- **CLOCK**：每個項目一個「最近被用過」的位元，指針繞圈掃，遇到 1 就清成 0 給第二次機會，遇到 0 就淘汰。不用每次存取都搬動鏈結串列，成本比精確 LRU 低。PostgreSQL 的 shared buffers 用的是 clock-sweep 的變形（每個 buffer 有一個有上限的使用計數）。
- **分段 LRU（SLRU）、2Q**：新進的項目先放在「試用區」，被第二次存取才升到「保護區」。只被讀一次的掃描資料不會進到保護區。
- **ARC、W-TinyLFU**：同時考慮最近與頻率，並自動調整兩者的比例。Java 的 Caffeine 快取函式庫用的是 W-TinyLFU。

**TTL 與淘汰是兩件事**，通常兩個都要：TTL 處理「資料太舊」，淘汰處理「記憶體滿了」。只有 TTL 沒有容量上限，尖峰時快取一樣會撐爆；只有淘汰沒有 TTL，冷門但已經過時的資料可能放很久都沒被淘汰。

## 運作原理：LRU 怎麼做到 O(1)

LRU 需要兩個操作都很快：

- **依 key 找到項目**：hash map，O(1)。
- **把某個項目移到「最近使用」、從「最久沒用」那端移除**：雙向鏈結串列，只要改前後節點的指標，O(1)。

兩個結構搭在一起：hash map 的值不是資料本身，而是鏈結串列裡的**節點**。這樣找到 key 的同時就拿到節點，可以直接把它從原位置拔出來、插到最前面。

```text
hash map:  "a" ──┐   "c" ──┐   "b" ──┐
                 ▼         ▼         ▼
 head ⇄ [a] ⇄ [c] ⇄ [b] ⇄ tail
        最近用的            最久沒用的（滿了就淘汰這個）
```

容量 3 的快取，依序執行下面的操作：

| 操作 | 結果 | 串列（由新到舊） | 說明 |
|---|---|---|---|
| put a | | a | |
| put b | | b, a | |
| put c | | c, b, a | 滿了 |
| get a | 命中 | a, c, b | a 被用到，移到最前面 |
| put d | | d, a, c | 滿了，淘汰最尾端的 b |
| get b | 未命中 | d, a, c | b 已經被淘汰 |

單向串列做不到 O(1)：要移除一個節點得知道它的前一個節點，單向串列只能從頭走過去找。Python 的 `OrderedDict` 內部就是 hash map 加雙向鏈結串列，所以 `move_to_end` 與 `popitem(last=False)` 都是 O(1)，用它寫 LRU 只要幾行（這是程式題的內容）。

### Redis 的 LRU 是近似的

Redis 不為每個 key 維護一條鏈結串列（那要多花很多記憶體），而是每個 key 記一個最後存取時間。要淘汰時，從 key 中**抽樣** `maxmemory-samples` 個（預設 5），淘汰其中最久沒用的，再搭配一個候選池讓結果更接近真正的 LRU。抽樣數調高會更接近精確 LRU，代價是 CPU。

Redis 4.0 起有 LFU（`allkeys-lfu`、`volatile-lfu`）：每個 key 一個對數成長的小計數器，並會隨時間衰減，由 `lfu-log-factor` 與 `lfu-decay-time` 調整。各種 `maxmemory-policy` 的差別見 [Redis 快取](#/skill/redis-cache) 的淘汰策略一段。

## 實際程式：三種策略在不同流量下的命中率

下面用雙向鏈結串列實作 LRU，並和 FIFO、LFU 比較三種流量：熱門集合穩定、背景夾雜爬蟲（只讀一次的 key）、熱門內容中途換了一批。快取容量 200，總共 2,000 個 key：

```python run
import random
from collections import OrderedDict, Counter

class Node:
    __slots__ = ("key", "value", "prev", "next")
    def __init__(self, key=None, value=None):
        self.key, self.value, self.prev, self.next = key, value, None, None

class LRUCache:
    """hash map 找節點、雙向鏈結串列記順序：head 後面是最近用的，tail 前面是最久沒用的"""
    def __init__(self, capacity):
        self.capacity = capacity
        self.map = {}                              # key -> Node
        self.head, self.tail = Node(), Node()      # 兩個哨兵節點，省掉頭尾的邊界判斷
        self.head.next, self.tail.prev = self.tail, self.head

    def _unlink(self, node):                       # O(1)：只改前後兩個指標
        node.prev.next, node.next.prev = node.next, node.prev

    def _push_front(self, node):                   # O(1)：插到 head 後面
        node.prev, node.next = self.head, self.head.next
        self.head.next.prev = node
        self.head.next = node

    def get(self, key):
        node = self.map.get(key)                   # O(1)
        if node is None:
            return None
        self._unlink(node)                         # 被用到了：移到最前面
        self._push_front(node)
        return node.value

    def put(self, key, value):
        node = self.map.get(key)
        if node:
            node.value = value
            self._unlink(node)
        else:
            if len(self.map) >= self.capacity:
                victim = self.tail.prev            # 最久沒用的
                self._unlink(victim)
                del self.map[victim.key]
            node = Node(key, value)
            self.map[key] = node
        self._push_front(node)

    def keys(self):                                # 由新到舊，只為了印出來看
        out, n = [], self.head.next
        while n is not self.tail:
            out.append(n.key)
            n = n.next
        return out

# 逐步看順序怎麼變（和上面的表格一樣）
c = LRUCache(3)
for op, k in [("put", "a"), ("put", "b"), ("put", "c"), ("get", "a"), ("put", "d"), ("get", "b")]:
    result = c.put(k, k.upper()) if op == "put" else c.get(k)
    note = "" if op == "put" else ("（命中）" if result else "（未命中）")
    print(f"{op} {k}{note:<6} 由新到舊：{c.keys()}")

class FIFOCache:
    def __init__(self, capacity):
        self.capacity, self.data = capacity, OrderedDict()
    def get(self, key):
        return self.data.get(key)                  # 讀取不改變順序
    def put(self, key, value):
        if key not in self.data and len(self.data) >= self.capacity:
            self.data.popitem(last=False)          # 丟掉最早放進來的
        self.data[key] = value

class LFUCache:
    """示意用的 LFU：淘汰時掃一遍找最少用的（O(n)）；正式實作會用分桶做到 O(1)，並讓計數衰減"""
    def __init__(self, capacity):
        self.capacity, self.data, self.freq = capacity, {}, Counter()
    def get(self, key):
        if key in self.data:
            self.freq[key] += 1
            return self.data[key]
        return None
    def put(self, key, value):
        if key not in self.data and len(self.data) >= self.capacity:
            victim = min(self.data, key=lambda k: self.freq[k])
            del self.data[victim]
            del self.freq[victim]
        self.data[key] = value
        self.freq[key] += 1

def hit_rate(cache, requests):
    hits = total = 0
    for key in requests:
        hit = cache.get(key) is not None
        if not hit:
            cache.put(key, f"value-{key}")         # cache-aside：未命中就去源頭取，再放進快取
        if isinstance(key, int):                   # 只算正常使用者的請求（爬蟲的 key 是字串）
            total += 1
            hits += hit
    return hits / total

random.seed(42)
KEYS = 2000
weights = [1 / (rank + 1) for rank in range(KEYS)]          # 少數 key 很熱、多數很冷（類 Zipf 分佈）
hot = random.choices(range(KEYS), weights=weights, k=40_000)

# 情境二：背景有爬蟲，每 2 個正常請求之間夾 1 個「只讀一次」的冷 key
crawl = []
for i, key in enumerate(hot):
    crawl.append(key)
    if i % 2 == 1:
        crawl.append(f"crawl-{i}")

# 情境三：熱門內容換了一批（例如新的一天、新的活動），後半段的熱門 key 是另一群
shift = hot[:20_000] + [k + KEYS for k in hot[20_000:]]

print()
print(f"{'策略':<6} {'熱門流量':>8} {'夾雜爬蟲':>8} {'熱門換一批':>10}")
for name, cls in [("FIFO", FIFOCache), ("LRU", LRUCache), ("LFU", LFUCache)]:
    rates = [hit_rate(cls(200), reqs) for reqs in (hot, crawl, shift)]
    print(f"{name:<6} {rates[0]:>8.1%} {rates[1]:>8.1%} {rates[2]:>10.1%}")
```

這次執行（固定亂數種子）的結果大致是：熱門流量下 LFU > LRU > FIFO；夾雜爬蟲時 LRU 與 FIFO 明顯下降，LFU 幾乎不受影響；熱門內容換一批時，LFU 反而最差，因為前半段累積的計數讓舊的熱門 key 賴著不走。沒有一種策略在所有流量下都最好，這也是 W-TinyLFU 這類混合策略存在的原因。這是合成的流量，實際的命中率要用自己的存取紀錄量。

## 命中率：唯一要盯的數字

命中率 = 命中次數 / (命中 + 未命中)。它決定了快取到底省了多少：

```text
平均延遲 ≈ 命中率 × 命中時的延遲 + (1 − 命中率) × 未命中時的延遲
```

以命中 1 ms、未命中 50 ms 估算（示意）：命中率 90% 時平均約 5.9 ms，99% 時約 1.5 ms。從 90% 到 99% 看起來只多了 9 個百分點，但**打到資料庫的請求從 10% 降到 1%，少了九成**。看快取的效果，看未命中率比看命中率直覺。

命中率和容量不是線性關係。熱門集合放得下之後，再加容量只多放冷資料，命中率幾乎不動。要決定容量，最可靠的方法是拿一段真實的存取紀錄（key 的序列），用上面那種模擬程式重播，畫出「容量對命中率」的曲線，找到曲線變平的地方。

Redis 的相關指標在 `INFO stats` 與 `INFO memory`：

- `keyspace_hits`、`keyspace_misses`：算命中率。
- `evicted_keys`：因為記憶體滿而被淘汰的 key 數。持續上升且命中率下降，代表容量不夠或 key 設計有問題。
- `used_memory`、`maxmemory`：用量與上限。64 位元系統上 `maxmemory` 預設是 0（不設上限），預設的 `maxmemory-policy` 是 `noeviction`。拿 Redis 當快取時兩個都要明確設定。

## functools.lru_cache：程序內快取

`functools.lru_cache` 是標準函式庫裡的 LRU：

- `maxsize` 預設 128；`maxsize=None` 代表不設上限（Python 3.9 起的 `functools.cache` 等同於此）。
- `cache_info()` 回傳命中、未命中、上限與目前筆數；`cache_clear()` 清空。
- 依參數組成 key，所以**參數必須可雜湊**。關鍵字參數的順序不同時，Python 文件說明可能被當成不同的呼叫、各存一筆。
- Python 文件說明它是 thread-safe 的：內部結構在並行更新時保持一致，但同一組參數可能在第一次結果寫進快取前被執行不只一次。

它的範圍是**一個程序**：

| 適合 | 不適合 |
|---|---|
| 純函式：同樣的輸入永遠得到同樣的輸出 | 會被修改的資料（使用者資料、庫存、權限） |
| 啟動後就不變的設定、解析過的範本 | 需要跨 worker、跨主機一致的資料 |
| 計算昂貴且輸入範圍有限的函式 | 輸入範圍無限的函式配上 `maxsize=None` |

開頭的 `get_profile` 兩條都踩到：使用者資料會被修改，而且要跨 worker 一致。這種資料應該放 Redis 這類共享快取，更新時刪除快取（見 [Redis 快取](#/skill/redis-cache)）；或者在程序內只快取幾秒、接受短暫的不一致。

下面這段把常見陷阱實際跑一遍：

```python run
from functools import lru_cache

calls = 0

@lru_cache(maxsize=2)                      # 預設 maxsize=128；None 代表不設上限
def get_plan(plan_id: str) -> dict:
    global calls
    calls += 1                             # 數真正執行了幾次（例如查資料庫）
    return {"id": plan_id, "features": ["api", "export"]}

for pid in ["free", "pro", "free", "team", "pro"]:
    get_plan(pid)
print(get_plan.cache_info())               # hits、misses、maxsize、currsize
print("真正執行次數：", calls)

# 陷阱一：回傳可變物件。呼叫者改了它，等於改了快取裡的那一份
plan = get_plan("pro")
plan["features"].append("sso")             # 只想在這次請求裡加一個功能
print("下一次拿到的：", get_plan("pro")["features"])

# 陷阱二：參數必須可雜湊
@lru_cache(maxsize=128)
def total_price(item_ids):
    return len(item_ids) * 100

try:
    total_price([1, 2, 3])
except TypeError as e:
    print("TypeError:", e)
print("改傳 tuple：", total_price((1, 2, 3)))

# 陷阱三：同樣的參數、不同的呼叫寫法，可能被存成不同筆
@lru_cache(maxsize=128)
def search(q, page=1):
    return f"{q}:{page}"

search(q="lamp", page=2)
search(page=2, q="lamp")
search("lamp", 2)
print("三種呼叫方式，快取筆數：", search.cache_info().currsize)

# 沒有 TTL：要「大約一分鐘」的快取，常見做法是把時間切成桶子當參數
@lru_cache(maxsize=1024)
def _rates(bucket: int) -> dict:
    return {"USD": 32.1, "fetched_bucket": bucket}

def exchange_rates(now: float) -> dict:
    return _rates(int(now // 60))          # 同一分鐘內是同一個 bucket，命中快取

t = 1_800_000_000.0
print("30 秒後還是同一份：", exchange_rates(t) is exchange_rates(t + 30))
print("61 秒後換新的：", exchange_rates(t) is not exchange_rates(t + 61))
```

第一段的命中只有 1 次：`team` 進來時淘汰了 `pro`，`pro` 再來時又淘汰了 `free`。時間桶的做法有兩個副作用：資料在「分鐘邊界」到期，而不是取得後 60 秒；所有 worker 會在同一個邊界同時重新取資料。需要真正的 TTL 時，可以用第三方套件（例如 cachetools 的 `TTLCache`），或改用 Redis 的 `EXPIRE`。

## 常見錯誤與錯誤訊息

| 錯誤訊息或現象 | 原因 | 修法 |
|---|---|---|
| `TypeError: unhashable type: 'list'` | 被 `lru_cache` 包住的函式收到 list 或 dict 參數 | 呼叫前轉成 `tuple` / `frozenset`，或改用以字串為 key 的快取 |
| 記憶體只漲不跌，最後 OOMKilled | `maxsize=None`，而輸入範圍沒有上限（例如 user id） | 設 `maxsize`；使用者層級的資料改放共享快取 |
| 物件一直沒被回收 | 在實例方法上用 `lru_cache`：`self` 也是快取 key 的一部分，快取持有 `self` 的參照（flake8-bugbear 的 B019 會警告） | 改快取模組層級的函式，或把快取存在實例屬性上 |
| 有時新、有時舊 | 每個 worker 各自一份程序內快取，更新只清到其中一份 | 改共享快取並在寫入時刪除；或縮短程序內快取的時間 |
| 快取裡的資料「自己變了」 | 回傳了可變物件，呼叫者修改了它 | 回傳不可變的結構（tuple、frozen dataclass）或呼叫端先複製 |
| Redis 回傳類似 `OOM command not allowed when used memory > 'maxmemory'` | 記憶體到上限且策略是 `noeviction` | 純快取設 `allkeys-lru` 或 `allkeys-lfu`；細節見 [Redis 快取](#/skill/redis-cache) |
| `evicted_keys` 持續上升、命中率下降 | 容量放不下熱門集合，或有掃描型流量把熱門資料擠掉 | 量曲線決定容量；把報表、匯出這類掃描讀取繞過快取 |
| 重啟或 `cache_clear()` 後資料庫被打爆 | 快取全空，所有請求同時未命中 | 預熱、singleflight，見設計情境 [快取到期的瞬間](#/scenario/edge-cache) |

## 動手

1. 在 Playground 跑命中率比較，把快取容量從 200 改成 50 和 800，看三種策略的差距怎麼變；把 `weights` 改成全部相同（`[1] * KEYS`），看策略還重不重要。
2. 跑 `lru_cache` 那段，把 `maxsize=2` 改成 3，預測 `cache_info()` 的 hits 會變多少再執行驗證。
3. 程式題：[用 OrderedDict 實作 LRU](#/exercise/lru-cache-1)。
4. 開 [Cache-aside](#/lab/CacheLab) 實驗室，看 hit、miss、TTL 與失效在一次次請求裡的變化。
5. 設計情境：[API 快取](#/scenario/cache)（快取放哪一層）與 [快取到期的瞬間：雪崩與擊穿](#/scenario/edge-cache)（大量同時未命中）。

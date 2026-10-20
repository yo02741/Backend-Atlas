## 從一個具體問題開始：改了名字，一小時後才生效

個人資料頁加了 Redis 快取，key 是 `user:42:profile`，TTL 3,600 秒。上線後 DB 負載降了八成，接著客服開始收到「改了暱稱沒有變」的回報：使用者改名後，個人頁要等最久一小時才顯示新名字。

工程師的第一個修法是「寫入資料庫後順便更新快取」。之後大部分時候正常，但偶爾有使用者的名字**永遠**停在某個舊值，直到 TTL 到期。原因是兩個幾乎同時的更新交錯了：

| 時間 | 請求 A（改成 Alicia） | 請求 B（改成 Alison） | DB | 快取 |
|---|---|---|---|---|
| t1 | 寫 DB | | Alicia | Alice |
| t2 | | 寫 DB | Alison | Alice |
| t3 | | 更新快取 | Alison | Alison |
| t4 | 更新快取（A 這時才跑到這一行） | | Alison | **Alicia** |

DB 是 Alison，快取是 Alicia，而且不會自己修正。快取的難處不在「把東西放進去」，而在**資料變了以後怎麼讓快取跟著變**。

## Redis 的資料結構與用途

Redis 是放在記憶體裡的鍵值資料庫，值不只是字串。指令由單一執行緒依序執行，**每一個指令都是原子的**，這是很多用法的基礎：

| 結構 | 常用指令 | 適合的用途 |
|---|---|---|
| string | `GET` `SET` `SET … EX 60 NX` `INCR` `DEL` | 快取一份 JSON、計數器、鎖 |
| hash | `HSET` `HGET` `HGETALL` `HINCRBY` | 一個物件的多個欄位（session 資料、購物車：商品 → 數量） |
| list | `LPUSH` `RPOP` `LRANGE` `LTRIM` | 最近 N 筆（`LPUSH` + `LTRIM`）、簡單佇列 |
| set | `SADD` `SISMEMBER` `SCARD` `SMEMBERS` | 不重複的集合：標籤、某使用者的所有 session id、去重 |
| sorted set | `ZADD` `ZINCRBY` `ZRANGE … REV WITHSCORES` `ZREMRANGEBYSCORE` | 排行榜、依時間排序的紀錄、滑動視窗限流 |

另外還有 stream（可持久的訊息流，搭配 consumer group）、HyperLogLog（近似不重複計數）、bitmap 等。

```bash
# redis-cli（需要真的 Redis，不能在瀏覽器執行）
SET user:42:profile '{"id":42,"name":"Alice"}' EX 60   # 字串 + 60 秒 TTL
TTL user:42:profile                                     # 剩幾秒；-1 = 沒有 TTL；-2 = key 不存在
HSET cart:42 sku:A 2 sku:B 1                            # 購物車：hash 的每個欄位是一個商品
HINCRBY cart:42 sku:A 1
ZINCRBY leaderboard:2026-10 30 user:42                  # 排行榜加分
ZRANGE leaderboard:2026-10 0 9 REV WITHSCORES           # 前 10 名（Redis 6.2 起的寫法；舊版用 ZREVRANGE）
```

key 用冒號分層、帶上實體與 id（`user:42:profile`、`ratelimit:login:ip:203.0.113.7`），才能用 `SCAN 0 MATCH user:*` 批次觀察與清理。正式環境不要用 `KEYS *`：它一次掃過所有 key，執行期間其他指令全部要等。

## 快取的四種模式

| 模式 | 讀 | 寫 | 優點 | 缺點 |
|---|---|---|---|---|
| Cache-aside（旁路快取） | 應用程式先查快取，miss 再查 DB 並回寫 | 寫 DB，然後刪快取 | 只快取真的被讀的資料；Redis 掛了還能直接讀 DB | 第一次讀一定 miss；一致性要自己處理 |
| Read-through | 快取層自己在 miss 時查 DB | 同 cache-aside | 應用程式程式碼簡單 | 需要支援這種模式的快取層或函式庫 |
| Write-through | 同 read-through | 寫入同時寫快取與 DB，都成功才回應 | 快取永遠有最新值 | 寫入變慢；很多寫入的資料從來沒被讀 |
| Write-behind（write-back） | 從快取讀 | 只寫快取，背景批次寫回 DB | 寫入極快、可以合併多次寫入 | 快取掛掉時還沒寫回的資料會遺失 |

後端服務最常見的是 cache-aside，下面都以它為主。互動版本見 [Cache-aside 實驗室](#/lab/CacheLab)。

### cache-aside 與 TTL

下面用 dict 模擬一個有 TTL 的 Redis，時間由 `Clock` 注入，不用真的等 60 秒：

```python run
# 用 dict 模擬 Redis（含 TTL）與 cache-aside；時間由 Clock 注入，不用真的等
import json

class Clock:
    def __init__(self): self.t = 0.0
    def now(self): return self.t
    def advance(self, s): self.t += s

class FakeRedis:
    """只做 GET / SET EX / DEL / TTL；過期的 key 在被讀到時才刪（Redis 另外還有背景抽樣刪除）"""
    def __init__(self, clock): self.data, self.clock = {}, clock
    def get(self, k):
        v = self.data.get(k)
        if v is None: return None
        value, expires_at = v
        if expires_at is not None and self.clock.now() >= expires_at:
            del self.data[k]
            return None
        return value
    def set(self, k, value, ex=None):
        self.data[k] = (value, None if ex is None else self.clock.now() + ex)
    def delete(self, k): self.data.pop(k, None)
    def ttl(self, k):
        v = self.data.get(k)
        return -2 if v is None else (-1 if v[1] is None else round(v[1] - self.clock.now()))

clock = Clock()
cache = FakeRedis(clock)
db = {1: {"id": 1, "name": "Alice", "city": "台北"}}
stats = {"db_reads": 0}

def get_user(uid):
    key = f"user:{uid}:profile"
    cached = cache.get(key)                      # 1. 先問快取
    if cached is not None:
        return json.loads(cached), "hit"
    stats["db_reads"] += 1                       # 2. miss：查資料庫
    row = db[uid]
    cache.set(key, json.dumps(row, ensure_ascii=False), ex=60)   # 3. 回寫並設 TTL
    return row, "miss"

def update_name(uid, name, invalidate=True):
    db[uid] = {**db[uid], "name": name}          # 1. 先寫資料庫
    if invalidate:
        cache.delete(f"user:{uid}:profile")      # 2. 再刪快取（不是更新快取）

def show(label):
    user, kind = get_user(1)
    print(f"t={clock.now():>3.0f}s  {kind:<4}  name={user['name']:<7}  TTL 剩 {cache.ttl('user:1:profile'):>2} 秒  ← {label}")

show("第一次讀：快取沒有，查 DB 後回寫")
show("再讀一次：直接從快取拿")
clock.advance(30); show("30 秒後")
update_name(1, "Alicia", invalidate=False)
show("改名了但沒刪快取：讀到舊值")
clock.advance(31); show("TTL 到期：重新查 DB，終於看到新名字")
update_name(1, "Alison")
show("改名並刪快取：下一次讀立刻是新值")
print("資料庫總共被讀了", stats["db_reads"], "次")
```

TTL 是安全網：就算失效邏輯漏了某條路徑（批次腳本直接改 DB、另一個服務寫入），資料最多舊一個 TTL。TTL 的長度依「這份資料可以容忍多舊」決定，不是依「想要多高的命中率」。

## 快取失效：為什麼是「刪」而不是「更新」

回到開頭的時間線。寫入後**更新**快取，兩個寫入交錯時，快取裡留下的是比較晚執行到那一行的值，不一定是比較晚寫進 DB 的值。寫入後**刪除**快取，不管怎麼交錯，最後快取都是空的，下一次讀取會從 DB 拿到最新值。

刪除策略也不是完美的：讀取者 cache miss、從 DB 讀到舊值，在它回寫快取之前，寫入者剛好完成了「寫 DB + 刪快取」，讀取者接著把舊值寫進去。這需要「讀 DB 比寫 DB 加刪快取還慢」，機率低得多，而且 TTL 讓它最多持續一個 TTL。

```python run
# 兩種寫入策略在並行時的差別：每個步驟依指定順序交錯執行
def run(schedule, label):
    db, cache, seen = {"name": "Alice"}, {"name": "Alice"}, {}
    for who, op, value in schedule:
        if op == "write_db":    db["name"] = value
        elif op == "set_cache": cache["name"] = value            # 寫入後「更新」快取
        elif op == "del_cache": cache.pop("name", None)          # 寫入後「刪除」快取（或 key 剛好過期）
        elif op == "read_db":   seen[who] = db["name"]           # 讀取者 miss 後查 DB
        elif op == "fill":      cache["name"] = seen[who]        # 讀取者把查到的值回寫快取
    now = cache.get("name")
    state = "空（下一次讀會查 DB）" if now is None else now
    ok = now is None or now == db["name"]
    print(f"{label}\n   DB = {db['name']}，快取 = {state} → {'一致' if ok else '不一致，直到 TTL 到期'}")

run([("A", "write_db", "Alicia"), ("B", "write_db", "Alison"),
     ("B", "set_cache", "Alison"), ("A", "set_cache", "Alicia")],
    "寫入後更新快取，兩個寫入交錯：")
run([("A", "write_db", "Alicia"), ("B", "write_db", "Alison"),
     ("B", "del_cache", None), ("A", "del_cache", None)],
    "寫入後刪除快取，同樣的交錯：")
run([("-", "del_cache", None), ("R", "read_db", None),
     ("A", "write_db", "Alicia"), ("A", "del_cache", None), ("R", "fill", None)],
    "刪除策略殘留的窗口（key 剛過期、讀取者查 DB 很慢）：")
```

要把這個窗口再縮小，常見做法有：寫入後延遲幾百毫秒再刪一次（延遲雙刪），或由資料庫的變更事件（CDC，例如讀 PostgreSQL 的邏輯複寫）驅動刪除。這些都增加複雜度；多數情況下「寫 DB → 刪快取 → TTL 兜底」就夠了。真正不能讀到舊值的資料（餘額、付款狀態），答案通常是不要快取，見設計情境 [API 快取](#/scenario/cache)。

## 淘汰策略：記憶體滿了怎麼辦

TTL 處理「過期」，`maxmemory` 與 `maxmemory-policy` 處理「滿了」：

| 策略 | 滿了的時候 | 適合 |
|---|---|---|
| `noeviction`（預設） | 拒絕會增加記憶體的寫入，回傳 OOM 錯誤 | Redis 存的是不能丟的資料（佇列、session） |
| `allkeys-lru` / `allkeys-lfu` | 從所有 key 中淘汰最久沒用 / 最少用的 | 純快取 |
| `volatile-lru` / `volatile-lfu` / `volatile-ttl` | 只從有設 TTL 的 key 中淘汰 | 快取與持久資料混在同一個實例 |
| `allkeys-random` / `volatile-random` | 隨機淘汰 | 存取機率平均時 |

Redis 的 LRU / LFU 是抽樣近似，不是精確的。混用時要注意：用 `allkeys-lru` 的實例上同時放 session 與分散式鎖，記憶體一滿，它們也可能被淘汰。快取與「不能丟的資料」分開成不同實例是比較安全的做法。

## 穿透、擊穿、雪崩與熱鍵

| 問題 | 發生什麼 | 常見對策 |
|---|---|---|
| 穿透（penetration） | 查不存在的資料（`/products/999999`），快取永遠 miss，每次都打 DB | 快取「不存在」這個結果（短 TTL）；或用 Bloom filter 先擋 |
| 擊穿（breakdown） | 一個熱 key 過期的瞬間，大量請求同時 miss、同時查 DB | singleflight：`SET lock NX PX` 搶到的那一個查 DB，其他人等待或回舊值；或過期前背景更新 |
| 雪崩（avalanche） | 大量 key 同時過期，或 Redis 整個掛掉，流量全部壓到 DB | TTL 加隨機抖動；DB 前面加限流與熔斷；Redis 高可用 |
| 熱鍵（hot key） | 單一 key 的流量集中在一個 Redis 節點，CPU 或網路打滿 | 應用程式內再加一層幾秒的本機快取；把 key 複製成多份（`key:1`…`key:N`）隨機讀 |

擊穿與雪崩用數字看最清楚：

```python run
# 熱鍵到期的瞬間（擊穿）：每秒 10,000 次讀，DB 查詢要 50 ms
RATE_PER_MS = 10                 # 每毫秒 10 個請求
DB_MS = 50

def stampede(singleflight):
    db_queries, cache_ready_at, lock_held = 0, None, False
    for t in range(200):                          # 從 key 過期那一刻起模擬 200 ms
        for _ in range(RATE_PER_MS):
            if cache_ready_at is not None and t >= cache_ready_at:
                continue                          # 快取已回填：hit
            if singleflight:
                if not lock_held:                 # SET lock NX 成功的那一個去查 DB
                    lock_held, db_queries, cache_ready_at = True, db_queries + 1, t + DB_MS
                # 其他人：短暫等待後重試快取，或先回傳舊值，不打 DB
            else:
                db_queries += 1                   # 每個 miss 都自己去查 DB
                if cache_ready_at is None:
                    cache_ready_at = t + DB_MS    # 最早那一個查完時回填
    return db_queries

print("沒有保護：", stampede(False), "次 DB 查詢")
print("singleflight：", stampede(True), "次 DB 查詢")

# 雪崩：300 個報表 key 在同一時間寫入、TTL 都是 3600 秒
import random
from collections import Counter
random.seed(1)
same = Counter(3600 for _ in range(300))
jitter = Counter(int(3600 * random.uniform(0.9, 1.1)) for _ in range(300))
print("固定 TTL：同一秒最多", max(same.values()), "個 key 一起過期")
print("TTL ±10% 抖動：同一秒最多", max(jitter.values()), "個 key 一起過期，分散在",
      max(jitter) - min(jitter), "秒內")
```

各種對策的取捨與實作，見設計情境 [快取到期的瞬間：雪崩與擊穿](#/scenario/edge-cache)。

## 分散式鎖的陷阱

Redis 鎖的基本形式是一句原子指令：`SET lock:order:42 <隨機 token> NX PX 30000`，key 不存在時才設定（NX），30 秒後自動過期（PX），避免持有者當機後鎖永遠不放。釋放時要確認鎖還是自己的，用 Lua 腳本讓「比對 + 刪除」原子完成：

```lua
-- 只有 token 相符才刪除；直接 DEL 可能刪掉別人剛拿到的鎖
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
```

即使寫對了，它仍有本質上的限制：

- **鎖會在你還在做事時過期**。持有者遇到長時間 GC 停頓、網路延遲、或工作比預期慢，30 秒到了鎖自動釋放，另一個程序拿到鎖，兩個人同時以為自己持有鎖。
- **Redis 主從切換可能弄丟鎖**。複寫是非同步的，主節點寫入鎖後還沒複製就掛掉，新的主節點上沒有這把鎖。
- **解法是 fencing token**：每次取得鎖時拿到一個遞增的編號，寫入資料時一併帶上，由儲存端拒絕比較舊的編號。這需要儲存端配合，Redis 鎖本身做不到。

實務上的分界：Redis 鎖適合「避免重複做工」（同一份報表別讓兩台機器同時產生，偶爾重複也無妨）。**正確性**必須成立的地方（不能超賣、不能重複扣款），要靠資料庫的約束、條件更新或列鎖，見 [交易與隔離等級](#/skill/transactions) 與 [鎖與死結](#/skill/locks-deadlocks)。

## Redis 當 session 與限流計數器

**Session**：登入後產生一個隨機的 session id 放進 cookie，Redis 存 `session:<id>`（hash，帶 TTL）。每次請求讀取時順便 `EXPIRE` 延長，就是滑動過期；登出就 `DEL`。要做「登出所有裝置」，另外維護一個 set `user:42:sessions` 記錄這個使用者的所有 session id。session 不能被淘汰，所以這個實例的淘汰策略不能是 `allkeys-*`。

**限流**：最簡單的是固定視窗計數：

```bash
INCR ratelimit:login:user:42:202610200930      # key 帶上「第幾分鐘」；回傳目前次數
EXPIRE ratelimit:login:user:42:202610200930 60 # 只在 INCR 回傳 1 時設定（或用 Lua 讓兩句原子執行）
```

INCR 與 EXPIRE 是兩句，程式在中間當掉就會留下一個沒有 TTL 的計數器；用 Lua 腳本或 `MULTI` 包起來可以避免。固定視窗的另一個問題在視窗邊界：

```python run
# 限流：每個使用者每 60 秒最多 10 次。時間由參數注入，比較固定視窗與滑動視窗
from collections import defaultdict, deque

class FixedWindow:
    """Redis：INCR ratelimit:{user}:{window}，第一次（回傳 1）時 EXPIRE"""
    def __init__(self, limit, window): self.limit, self.window, self.counts = limit, window, defaultdict(int)
    def allow(self, user, now):
        key = (user, int(now // self.window))   # 視窗編號：0–59.999 秒是 0，60 秒起是 1
        self.counts[key] += 1
        return self.counts[key] <= self.limit

class SlidingLog:
    """Redis：sorted set，ZREMRANGEBYSCORE 清掉一個視窗以前的紀錄、ZCARD 計數、ZADD 加入這次"""
    def __init__(self, limit, window): self.limit, self.window, self.log = limit, window, defaultdict(deque)
    def allow(self, user, now):
        q = self.log[user]
        while q and q[0] <= now - self.window:
            q.popleft()
        if len(q) >= self.limit:
            return False
        q.append(now)
        return True

# 視窗邊界：59.0–59.9 秒送 10 次，60.0–60.9 秒再送 10 次
times = [59 + i / 10 for i in range(10)] + [60 + i / 10 for i in range(10)]
for limiter in (FixedWindow(10, 60), SlidingLog(10, 60)):
    ok = sum(limiter.allow("u42", t) for t in times)
    print(f"{type(limiter).__name__:<12} 2 秒內放行 {ok} 次（限制是每 60 秒 10 次）")
```

滑動視窗比較精確，代價是每個請求都存一筆紀錄。限流放在哪一層、用什麼當 key，見 [限流實驗室](#/lab/RateLimitLab) 與設計情境 [限流放哪、用什麼當 key](#/scenario/ratelimit-strategy)。

## 常見錯誤與錯誤訊息

| 錯誤訊息 | 原因 | 怎麼處理 |
|---|---|---|
| `OOM command not allowed when used memory > 'maxmemory'.` | 記憶體到上限，且策略是 `noeviction` | 純快取改用 `allkeys-lru` / `allkeys-lfu`；找出沒設 TTL 的 key |
| `WRONGTYPE Operation against a key holding the wrong kind of value` | 對 hash 的 key 下了 string 指令（或反過來），通常是 key 命名撞在一起 | 不同結構用不同前綴；`TYPE key` 確認 |
| `MOVED 3999 10.0.0.12:6381` | Redis Cluster：這個 key 所在的 slot 在別的節點 | 用支援 cluster 的用戶端 |
| `CROSSSLOT Keys in request don't hash to the same slot` | Cluster 上一次操作多個 key（`MGET`、Lua、交易），它們在不同 slot | 用 hash tag 讓相關 key 落在同一個 slot：`{user:42}:profile`、`{user:42}:cart` |
| `LOADING Redis is loading the dataset in memory` | 重啟後正在從 RDB / AOF 載入資料 | 用戶端重試；這段期間應用程式要能退回直接查 DB |

不會報錯、但很常見的問題：

- **忘了設 TTL**：key 只增不減，記憶體慢慢被吃光。`INFO keyspace` 可以看有多少 key 帶 TTL（`expires`）。
- **快取了錯的東西**：把個人資料存在沒有帶 user id 的 key 裡，A 使用者看到 B 的資料。key 一定要包含所有影響結果的參數。
- **序列化不一致**：Decimal、datetime 在不同服務之間用不同方式轉 JSON，讀回來型別變了。
- **把 Redis 當唯一的資料來源**：預設的持久化設定下，當機可能遺失最後一段時間的寫入；要不能丟，就要確認 RDB / AOF 設定，或把真正的資料放在資料庫。

## 動手

1. 執行 cache-aside 那段，把 TTL 從 60 改成 10，看「改名但沒刪快取」之後要多久才看到新名字。
2. 執行競態那段，自己排一個新的交錯順序，找出刪除策略下仍然會不一致的所有排列。
3. 執行擊穿那段，把 `DB_MS` 改成 200，看沒有保護時 DB 查詢次數怎麼變；再想想 singleflight 下「其他人」等待時要等多久。
4. 打開 [Cache-aside 實驗室](#/lab/CacheLab)，關掉 invalidate，觀察 UPDATE 之後的 GET 拿到什麼。
5. 到設計情境 [API 快取](#/scenario/cache)，判斷商品頁、購物車、付款狀態各該放哪一層快取。

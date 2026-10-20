## 從一個具體問題開始：寫好的限流，實際放行了四倍

公開 API 的規則是「每個 API key 每分鐘 100 次」。第一版寫在應用程式裡：每台 API 伺服器用一個 dict 記錄每個 key 這一分鐘的次數，超過就回 429。單機測試完全正確。

上線後出現三個問題：

1. **服務擴到 4 台**，負載平衡器輪流分配請求。每台各自計數，同一個 key 在每台都能用滿 100 次，實際上限變成每分鐘 400 次。
2. **視窗邊界**：計數在每分鐘的第 0 秒歸零。客戶端在 10:00:59 打 100 次、10:01:00 再打 100 次，兩秒內通過 200 次，全部合規。
3. **用 IP 當 key 的公開端點**：一間公司幾百個員工經由同一個出口 IP 上網，行動網路業者也常讓大量使用者共用 IP（carrier-grade NAT）。其中一個人的程式跑太快，同一個 IP 後面的所有人都被擋。

限流要回答四件事：**用哪種演算法計數、計數放在哪裡、用什麼當 key、被擋時怎麼告訴客戶端**。這四件事各有自己的坑。

## 四種演算法

| 演算法 | 每個 key 存什麼 | 暴衝 | 精確度 | Redis 的典型做法 |
|---|---|---|---|---|
| 固定視窗（fixed window） | 一個計數器 | 視窗邊界可通過 2 倍 | 邊界不準 | `INCR` + `EXPIRE` |
| 滑動日誌（sliding log） | 視窗內每次請求的時間戳 | 嚴格不超過 | 精確 | sorted set：`ZREMRANGEBYSCORE`、`ZCARD`、`ZADD` |
| 滑動視窗計數（sliding window counter） | 這個視窗與上個視窗兩個計數 | 接近嚴格 | 近似（假設上個視窗的請求平均分佈） | 兩個 `INCR` 計數器 |
| Token bucket | token 數與上次更新時間 | 允許最多「容量」次的暴衝 | 精確 | hash + Lua 腳本 |

固定視窗與滑動日誌的 Redis 寫法與邊界問題的示範，見 [Redis 快取](#/skill/redis-cache) 的限流計數器一段。這裡講另外兩種，以及怎麼選。

### 滑動視窗計數：兩個數字的近似

滑動日誌精確，但每個 key 要存最多 limit 筆時間戳。限制是每小時 10,000 次時，一個 key 就可能存一萬筆。

滑動視窗計數只存兩個數字：上一個固定視窗的總數 `prev` 與這一個視窗目前的數量 `cur`。估計過去一整個視窗長度內的請求數：

```text
估計值 = prev × (1 − 這個視窗已經過了的比例) + cur
```

例如規則是每分鐘 100 次，上一分鐘有 80 次，這一分鐘過了 15 秒（25%）、已有 30 次：估計值 = 80 × 0.75 + 30 = 90，還能再放 10 次。它假設上一分鐘的 80 次平均分佈，所以是近似；但視窗邊界的 2 倍問題就消失了，記憶體也和固定視窗一樣小。

### Token bucket：允許暴衝，限制長期速率

想像每個 key 有一個桶子：

- 桶子容量是 **b**（burst），一開始是滿的。
- 每秒補 **r** 個 token，滿了就不再補。
- 每個請求拿走一個 token（昂貴的操作可以拿多個）；桶裡不夠就拒絕。

實作上不需要真的有計時器每秒去補。每個 key 只存兩個值：目前的 token 數與上次更新的時間。請求進來時先「補上這段時間應得的 token」，再判斷：

```text
tokens = min(b, tokens + (now − last) × r)
夠的話 tokens −= cost 並放行；不夠的話拒絕，並可算出還要等 (cost − tokens) / r 秒
```

兩個參數各管一件事：**r 決定長期上限**（每分鐘 100 次就是 r = 100/60），**b 決定能吃多大的暴衝**。手機 App 開啟時一次打 8 個 API，b 設 10 就不會被誤擋；r 再小也擋得住持續的濫用。

要注意：桶子一開始是滿的，所以剛開始的那段時間可以通過 b 次，再加上之後以 r 補的部分。下面的模擬裡，每秒 3 次、連續 120 秒，固定視窗放行 200 次，token bucket（b = 100）放行約 300 次：前 100 次用的是一開始滿桶的 token。容量設得跟每分鐘上限一樣大時，就等於允許「一分鐘的量一次打完」。不想允許那麼大的暴衝，就把 b 設小。

### Leaky bucket 與 nginx 的 limit_req

leaky bucket（漏桶）有兩種講法。當成**計量器**時，它和 token bucket 等價，只是方向相反（桶裡裝的是「已用量」，以固定速率漏掉）。當成**佇列**時，請求先排進桶裡，以固定速率流出去處理，桶滿了才拒絕，效果是把流量整平。

nginx 的 `limit_req` 文件說明它用的是 leaky bucket 方法：

```nginx
# 每個來源 IP 一個狀態，10 MB 的共享記憶體；平均每秒 10 個請求
limit_req_zone $binary_remote_addr zone=per_ip:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;

server {
    location /api/ {
        # burst=20：超出速率的請求最多 20 個先排隊；nodelay：排隊的請求立刻處理，不等速率
        limit_req zone=per_ip burst=20 nodelay;
        limit_req_status 429;      # 預設回 503，改成 429 比較符合語意
    }
    location = /login {
        limit_req zone=login burst=3;
        limit_req_status 429;
    }
}
```

幾個容易誤會的地方：

- **速率以毫秒追蹤**。`rate=10r/s` 不是「每秒 10 個、一秒內怎麼打都行」，而是「每 100 毫秒 1 個」。沒有設 `burst` 時，同一個 IP 在 100 毫秒內的第二個請求就會被拒。
- **沒有 `nodelay` 時**，burst 裡的請求會被延遲到符合速率才處理，客戶端看到的是變慢而不是被拒。`nodelay` 讓它們立刻處理，但佔用的名額仍以速率釋放。
- **被拒絕的預設狀態碼是 503**，要用 `limit_req_status` 改。
- `$binary_remote_addr` 是連進 nginx 的對端 IP。nginx 前面還有負載平衡器或 CDN 時，它會是那台機器的 IP，所有人共用一個桶。要先用 realip 模組從可信的代理取出真實來源 IP，見 [負載平衡](#/skill/load-balancing) 的真實來源 IP 一段。

GCRA（generic cell rate algorithm）是同一個概念的另一種實作：每個 key 只存一個「下一個請求理論上最早的到達時間」，有些限流函式庫採用它。

## 實際程式：同一串請求，四種演算法

用同一份請求紀錄餵給四種演算法，時間由參數注入，結果是確定的：

```python run
from collections import deque
import math

LIMIT, WINDOW = 100, 60.0          # 規則：每個 key 每 60 秒 100 次

class FixedWindow:
    def __init__(self):
        self.win, self.count = None, 0
    def allow(self, now):
        w = int(now // WINDOW)                     # 第幾個視窗
        if w != self.win:
            self.win, self.count = w, 0            # 新視窗，計數歸零
        if self.count < LIMIT:
            self.count += 1
            return True
        return False

class SlidingLog:
    def __init__(self):
        self.log = deque()                         # 每次放行的時間戳
    def allow(self, now):
        while self.log and self.log[0] <= now - WINDOW:
            self.log.popleft()
        if len(self.log) < LIMIT:
            self.log.append(now)
            return True
        return False

class SlidingCounter:
    """只存「這個視窗」和「上個視窗」兩個數字，用比例估計過去 60 秒的量"""
    def __init__(self):
        self.win, self.cur, self.prev = None, 0, 0
    def allow(self, now):
        w = int(now // WINDOW)
        if w != self.win:
            self.prev = self.cur if self.win == w - 1 else 0   # 中間空了一整個視窗就是 0
            self.win, self.cur = w, 0
        elapsed = (now % WINDOW) / WINDOW          # 這個視窗過了幾成
        estimate = self.prev * (1 - elapsed) + self.cur
        if estimate < LIMIT:
            self.cur += 1
            return True
        return False

class TokenBucket:
    """容量 100、每秒補 100/60 個：長期上限同樣是每分鐘 100 次"""
    def __init__(self, capacity=LIMIT, rate=LIMIT / WINDOW):
        self.capacity, self.rate = capacity, rate
        self.tokens, self.ts = float(capacity), None
    def take(self, now, cost=1):
        if self.ts is not None:
            self.tokens = min(self.capacity, self.tokens + (now - self.ts) * self.rate)
        self.ts = now
        if self.tokens >= cost:
            self.tokens -= cost
            return True, 0.0
        return False, (cost - self.tokens) / self.rate   # 還要等幾秒才夠：拿來填 Retry-After
    def allow(self, now):
        return self.take(now)[0]

ALGOS = [FixedWindow, SlidingLog, SlidingCounter, TokenBucket]

def run(trace):
    result = {}
    for cls in ALGOS:
        limiter = cls()
        result[cls.__name__] = sum(limiter.allow(t) for t in trace)
    return result

# 情境一：視窗邊界。59 秒那一秒打 100 次，60 秒那一秒再打 100 次
boundary = [59 + i / 100 for i in range(100)] + [60 + i / 100 for i in range(100)]
print("兩秒內打 200 次：", run(boundary))

# 情境二：穩定超量。每秒 3 次、連續 120 秒（共 360 次，規則允許每分鐘 100 次）
steady = [i / 3 for i in range(360)]
print("120 秒、每秒 3 次：", run(steady))

# token bucket 拒絕時，算得出要等多久
b = TokenBucket(capacity=5, rate=0.5)              # 容量 5、每 2 秒補 1 個
results = [b.take(0.0) for _ in range(6)]
ok, wait = results[-1]
print("第 6 次：放行" if ok else f"第 6 次被拒，Retry-After 約 {math.ceil(wait)} 秒")
ok, wait = b.take(0.0, cost=3)                     # 昂貴的操作一次花 3 個 token
print("花 3 個 token 的請求：", "放行" if ok else f"被拒，要等 {wait:.1f} 秒")

# 情境三：限流計數放在每台 API 的記憶體裡，前面 round-robin 分給 4 台
instances = [FixedWindow() for _ in range(4)]
flood = [i / 1000 * 50 for i in range(1000)]       # 50 秒內打 1,000 次
passed = sum(instances[i % 4].allow(t) for i, t in enumerate(flood))
print(f"4 台各自計數：同一個 key 一分鐘內放行 {passed} 次（規則是 {LIMIT} 次）")
```

這次執行的結果：視窗邊界情境下，固定視窗放行 200 次，其他三種都在 100 次左右；穩定超量情境下，前三種放行 200 次，token bucket 約 300 次（多出的是一開始滿桶的 100 次）；4 台各自計數放行 400 次。

## 多台伺服器：計數要放在共享的地方

開頭第一個問題的解法是讓所有 API 實例共用同一份計數，通常是 Redis。token bucket 需要「讀出 token 數 → 計算 → 寫回」，這三步之間不能讓別的請求插進來，否則就是 [並發問題](#/skill/concurrency-bugs) 裡的 read-modify-write。Redis 執行 Lua 腳本時不會穿插其他指令，所以整段放進腳本：

```lua
-- KEYS[1]：這個 key 的桶；ARGV[1] 容量、ARGV[2] 每秒補幾個、ARGV[3] 這次要花幾個 token
local capacity = tonumber(ARGV[1])
local rate     = tonumber(ARGV[2])
local cost     = tonumber(ARGV[3])

-- 用 Redis 自己的時鐘，避免各台 API 主機的時鐘不一致
local t   = redis.call('TIME')                     -- {秒, 微秒}
local now = tonumber(t[1]) + tonumber(t[2]) / 1000000

local state  = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(state[1]) or capacity      -- 第一次：滿桶
local ts     = tonumber(state[2]) or now

tokens = math.min(capacity, tokens + math.max(0, now - ts) * rate)

local allowed, retry_after = 0, 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retry_after = (cost - tokens) / rate
end

redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
-- 閒置到補滿所需的時間之後，這個 key 就沒有存在的必要
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / rate * 1000) + 1000)

-- Lua 的小數回傳給 Redis 會被截成整數，所以用字串回傳
return {allowed, tostring(tokens), tostring(retry_after)}
```

Python 端用 redis-py（需要真的 Redis，不能在瀏覽器裡跑）：

```python
import math
import redis

r = redis.Redis()
token_bucket = r.register_script(open("token_bucket.lua").read())   # 內部用 EVALSHA，快取沒有時自動改用 EVAL

def check(api_key: str, cost: int = 1) -> tuple[bool, int]:
    allowed, _tokens, retry_after = token_bucket(
        keys=[f"rl:{api_key}"], args=[100, 100 / 60, cost])
    return allowed == 1, math.ceil(float(retry_after))
```

腳本裡呼叫 `TIME` 之後再寫入，在 Redis 5 以後的預設設定下沒有問題（腳本以「效果」複寫到副本）；更舊的版本有限制，用之前查一下版本。

共享計數的代價與要決定的事：

- **每個請求多一次 Redis 往返**。通常是亞毫秒到毫秒等級，但 Redis 變慢時所有 API 都跟著變慢。要設短的逾時。
- **Redis 掛掉時怎麼辦**：fail open（放行，暫時沒有限流）或 fail closed（全部拒絕）。一般 API 多半選 fail open，再搭配每台記憶體裡的粗略上限兜底；登入、寄驗證碼這種被濫用代價高的端點，可以選 fail closed。這是要明確寫下來的決定，不要讓它取決於例外有沒有被接住。
- **Redis Cluster**：一個腳本用到的所有 key 必須在同一個 hash slot。上面的腳本只用一個 key，沒有這個問題。
- **近似的替代方案**：不想每個請求都打 Redis 時，可以讓每台用 `總額度 / 台數` 在本機限流。負載平衡分得夠平均時誤差不大；台數會變動時要跟著調整。

## 用什麼當 key、放在哪一層

| key | 適合 | 要注意 |
|---|---|---|
| 來源 IP | 未登入的公開端點、擋粗暴的流量 | NAT 後很多人共用 IP；IPv6 一個使用者常拿到整段 /64，要以前綴當 key；代理後面要取真實 IP |
| user id / API key | 已驗證的 API | 每個方案不同額度（免費、付費），額度存在設定或資料庫，不寫死 |
| 帳號 + IP | 登入、重設密碼 | 只用帳號當 key，攻擊者可以故意打錯密碼讓受害者被鎖住；只用 IP，攻擊者換 IP 就繞過 |
| 動作或成本 | 寄簡訊、匯出報表、搜尋 | 用 token bucket 的 cost：便宜的請求花 1，昂貴的花 10 |

層次上，通常是「外層粗、內層細」：CDN 或 nginx 依 IP 擋明顯的濫用，應用層依使用者與動作擋細的規則。限流放哪層、怎麼分級的取捨，見設計情境 [限流放哪、用什麼當 key](#/scenario/ratelimit-strategy)。

限流（每單位時間幾次）和**並行數限制**（同時最多幾個進行中）是兩件事。一個要跑 30 秒的匯出，每分鐘 5 次的限流擋不住「同時開 5 個」對資料庫的壓力，這時要的是 nginx 的 `limit_conn` 或應用層的 semaphore。流量暴衝時怎麼排隊與拒絕，見設計情境 [流量暴衝時的削峰與背壓](#/scenario/queue-backpressure)。

## 被擋的時候：429 與標頭

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 12
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1792483260

{"error": "rate_limited", "message": "每分鐘最多 100 次，請 12 秒後再試"}
```

- **429 Too Many Requests** 定義在 RFC 6585，代表「這個客戶端送太多了」。503 代表「伺服器本身暫時不可用」，兩者語意不同，客戶端的處理方式也不同。
- **`Retry-After`** 是 HTTP 標準標頭（RFC 9110），值可以是秒數或 HTTP 日期。token bucket 能直接算出要等多久，填進去。
- **`X-RateLimit-*`** 是常見慣例，不是標準，各家的欄位意義（例如 Reset 是秒數還是時間戳）不完全一樣，要寫在 API 文件裡。IETF 有一份把它標準化成 `RateLimit` / `RateLimit-Policy` 標頭的草案，撰寫時仍是草案。

客戶端收到 429 要照 `Retry-After` 等，沒有的話用指數退避加抖動。立刻重試只會讓自己一直被擋，還會吃掉額度。退避的寫法見 [錯誤處理與韌性](#/skill/resilience)。

## 常見錯誤與錯誤訊息

| 現象或訊息 | 原因 | 修法 |
|---|---|---|
| 正常使用者回報偶爾 503，但伺服器沒壞 | nginx `limit_req` 預設回 503 | `limit_req_status 429;`，並在 error log 找下面那行 |
| nginx error log 出現類似 `limiting requests, excess: 20.500 by zone "per_ip", client: …` | 該 IP 超過速率加 burst | 確認 key 是不是真實 IP；調整 `burst`，而不是把 `rate` 拉高 |
| 所有使用者一起被限流 | key 取到的是負載平衡器或 CDN 的 IP | 用 realip 模組或應用層的可信代理設定取真實 IP |
| 限流比設定寬好幾倍 | 每台實例各自計數 | 改用 Redis 共享計數，或依台數分配額度 |
| 類似 `NOSCRIPT No matching script` 的錯誤 | 用 `EVALSHA` 時腳本不在 Redis 的快取裡（Redis 重啟、換節點） | 收到這個錯誤時改用 `EVAL` 重送；redis-py 的 `register_script` 會自動處理 |
| 拒絕率突然變零 | Redis 連不上，程式 fail open 卻沒有告警 | fail open 時記 log 與指標，並告警 |
| 客戶端收到 429 後狂重試 | 沒有 `Retry-After`，客戶端也沒有退避 | 回 `Retry-After`；SDK 內建退避 |

## 動手

1. 開 [Token bucket 限流](#/lab/RateLimitLab) 實驗室，調整容量與補充速率，看暴衝時哪些請求被 429；切到固定視窗看邊界的雙倍流量。
2. 在 Playground 跑上面的模擬，把 `TokenBucket` 的預設容量改成 10，看「穩定超量」情境的放行數怎麼變；再把 `boundary` 的第二段改成從 90 秒開始，看滑動視窗計數的估計值怎麼放行。
3. 程式題：[實作 token bucket](#/exercise/rate-limiting-1)、[依 key 的滑動視窗限流](#/exercise/rate-limiting-2)。
4. 設計情境：[限流放哪、用什麼當 key](#/scenario/ratelimit-strategy)，比較 nginx 每 IP、應用層每帳號與分層做法。

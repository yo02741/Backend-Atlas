## 這階段要做出什麼

掛號系統的流量很不平均：每天開放掛號的那幾分鐘，大量請求集中在「查某醫師某天還有沒有名額」和「掛號」兩個介面。這一階段加兩樣東西：

| 項目 | 範圍 | 規格 |
|---|---|---|
| 快取 | `GET /sessions?doctor_id=&date=`（診次與剩餘名額） | cache-aside；key 是醫師 + 日期；TTL 30 秒；掛號或取消成功後讓對應的 key 失效 |
| 限流 | `POST /sessions/{id}/appointments` | 每位登入使用者一個 token bucket（例如容量 5、每 6 秒補 1 個）；超過回 **429** 並附 `Retry-After` |
| 限流 | 登入介面 | 以帳號為主、IP 為輔，擋密碼猜測 |

快取的策略與 Redis 的操作在 [Redis 與快取策略](#/skill/redis-cache)；token bucket、sliding window 等演算法的比較在 [限流演算法](#/skill/rate-limiting)。

## 設計決策與取捨

### 快取什麼、不快取什麼

適合快取的是**很多人讀同一份、而且晚幾秒看到新值也沒關係**的資料。診次清單完全符合：所有想掛林醫師週一門診的人讀的是同一份，剩餘名額晚 30 秒更新，最壞是使用者看到「剩 1 名」、按下去卻收到「名額已滿」。

這裡有一個重要前提：**快取只用在顯示，不用在判斷**。能不能掛號，永遠由第 5 階段那句原子的 UPDATE 決定。如果掛號流程先讀快取的剩餘名額來決定要不要放行，快取的延遲就會變成超額掛號或錯誤拒絕。畫面上可以標示「剩餘名額僅供參考，以掛號結果為準」。

不快取的：

- 掛號本身（寫入）
- 某病患自己的掛號列表：每個人只讀自己的，命中率低；更重要的是 key 一旦設計錯（例如忘了把使用者 id 放進 key），就會把 A 的資料回給 B
- 權限判斷需要的資料（角色、停權狀態）：快取過期前，停權的帳號還能操作

### cache-aside 的流程

```
讀：GET key → 有 → 回傳
           → 沒有 → 查資料庫 → SET key value EX 30 → 回傳
寫：更新資料庫（COMMIT 之後）→ DEL key
```

對應的 Redis 指令是 `GET`、`SET key value EX 30`、`DEL`。key 建議帶版本與型別：`sessions:v1:doctor:3:date:2026-11-02`。資料格式改變時把 `v1` 換成 `v2`，舊的 key 自然過期，不用手動清。

失效用**刪除**而不是**更新**：如果兩個掛號請求各自把「新的剩餘名額」寫進快取，後寫的可能是比較舊的值。刪掉之後由下一個讀取的人重新載入，資料一定來自資料庫最新的狀態。

刪除要在資料庫 `COMMIT` **之後**。先刪快取再提交，中間有人讀取，會把還沒提交前的舊值重新寫回快取。即使順序正確，仍有一個小視窗：某個讀取在提交前查了資料庫、在刪除後才寫入快取，舊值會留到 TTL 到期為止。這就是 TTL 還是要設的原因：它是「最多錯多久」的上限。

### 空結果也要快取

某位醫師那天沒有門診，資料庫回空 list。如果判斷命中時寫成 `if cached:`，空 list 會被當成沒命中，每次都打資料庫——查不存在的東西反而最慢，而且很容易被拿來打資料庫。判斷「有沒有快取」要用 `is not None`，或在 Redis 裡存序列化後的 `[]`。

### 快取擊穿

熱門的 key 過期的那一瞬間，大量請求同時發現沒命中、同時去查資料庫。緩解方式：

- 只讓一個請求去載入，其他人等它（用 `SET lock-key 1 NX EX 5` 取得載入權）
- TTL 加一點隨機（例如 25–35 秒），避免一批 key 同時過期

門診系統的熱門 key 數量有限（熱門醫師 × 開放的日期），先做隨機 TTL 就夠，觀察第 8 階段的指標再決定要不要加鎖。

### 程式內快取還是 Redis

API 只跑一個行程時，一個 dict 就能當快取。跑多個實例時，每個實例各有一份，A 實例處理掛號後只能刪掉自己那份，B 實例的舊值要等 TTL。用 Redis 讓所有實例共用一份，失效才有意義。驗收題用 dict 實作，是為了在瀏覽器裡測試同樣的邏輯。

### 限流：以誰為單位

| 單位 | 適合 | 問題 |
|---|---|---|
| 登入使用者 | 已登入的介面（掛號） | 未登入的介面用不了 |
| IP | 未登入的介面（登入、註冊） | 醫院的公用 Wi-Fi、電信業者的 NAT 讓很多人共用一個 IP，限太緊會誤傷 |
| 帳號（登入時輸入的帳號） | 擋針對單一帳號的密碼猜測 | 攻擊者可以讓別人的帳號被鎖 |

從 IP 判斷時，只有在**自己的反向代理**後面才能相信 `X-Forwarded-For`，而且要取代理加上的那一段；直接相信整個標頭，攻擊者每次換一個假 IP 就繞過了。

### token bucket 的參數

容量（burst）決定「一下子最多能送幾個」，補充速率決定「長期平均多快」。掛號介面設容量 5、每 6 秒補 1 個：正常使用者掛號、改掛、取消重掛都不會碰到上限，腳本每分鐘最多只能送約 10 次。超過時回：

```
HTTP/1.1 429 Too Many Requests
Retry-After: 4
Content-Type: application/problem+json
```

`429` 定義在 RFC 6585，`Retry-After` 定義在 RFC 9110，值是秒數（整數，算出來的小數要無條件進位）。

### 多個實例的限流

和快取一樣，每個實例各自限流時，實際上限會變成「實例數 × 上限」。共用狀態放 Redis 時，「讀出 token 數、計算、寫回」要在 Redis 裡一次完成（例如寫成 Lua 腳本用 `EVAL` 執行，腳本執行期間不會插入其他指令），否則兩個實例同時讀到同一個值，又是一個 lost update。時間也要用同一個來源（Redis 的 `TIME` 指令），不要用各台主機自己的時鐘。

### Redis 掛掉時

- 快取：直接查資料庫（fail open），但要注意資料庫能不能承受全部流量
- 限流：放行（fail open）還是拒絕（fail closed）要事先決定。掛號是核心功能，這裡選放行並告警；登入介面選擇比較保守的做法，可以在程式內退回單機的限流

## 關鍵程式

快取與限流接在同一個 handler 上，時間用假時鐘控制，結果可以重現：

```python run
import math


class FakeClock:
    def __init__(self):
        self.t = 0.0
    def __call__(self):
        return self.t


class SessionListCache:
    def __init__(self, loader, ttl, clock):
        self.loader, self.ttl, self.clock, self._data = loader, ttl, clock, {}

    def get(self, doctor_id, day):
        hit = self._data.get((doctor_id, day))
        if hit is not None and self.clock() < hit[0]:
            return hit[1], "hit"
        value = self.loader(doctor_id, day)
        self._data[(doctor_id, day)] = (self.clock() + self.ttl, value)
        return value, "miss"

    def invalidate(self, doctor_id, day):
        self._data.pop((doctor_id, day), None)


class TokenBucket:
    def __init__(self, capacity, rate, clock):
        self.capacity, self.rate, self.clock = capacity, rate, clock
        self.tokens, self.updated = float(capacity), clock()

    def allow(self):
        now = self.clock()
        self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
        self.updated = now
        if self.tokens >= 1:
            self.tokens -= 1
            return True, 0
        return False, math.ceil((1 - self.tokens) / self.rate)   # Retry-After 用整數秒


clock = FakeClock()
db_reads = []
remaining = {"left": 2}

def load_sessions(doctor_id, day):
    db_reads.append((doctor_id, day))
    return [{"session_id": 12, "period": "morning", "left": remaining["left"]}]

cache = SessionListCache(load_sessions, ttl=30, clock=clock)
buckets = {}

def post_appointment(user_id):
    bucket = buckets.setdefault(user_id, TokenBucket(capacity=3, rate=1 / 6, clock=clock))
    ok, retry_after = bucket.allow()
    if not ok:
        return 429, {"Retry-After": str(retry_after)}
    remaining["left"] -= 1                  # 代表資料庫裡的原子取號成功
    cache.invalidate(3, "2026-11-02")       # COMMIT 之後讓清單失效
    return 201, {}

print(cache.get(3, "2026-11-02"))
clock.t = 10
print(cache.get(3, "2026-11-02"))
print("掛號：", post_appointment("u1"))
print(cache.get(3, "2026-11-02"), "← 掛號後重新載入")
print("資料庫讀取次數：", len(db_reads))

print([post_appointment("u2")[0] for _ in range(4)])   # 容量 3，第 4 次被擋
clock.t += 6
print("6 秒後：", post_appointment("u2"))
```

## 常見錯誤

**用 `if cached:` 判斷命中。** 空 list、`0`、空字串都是 falsy，這些結果永遠不會被快取。

**快取 key 少了使用者。** `appointments:list` 存的是第一個請求的人的掛號，之後所有人都看到他的資料。個人資料的 key 一定要包含使用者 id，或乾脆不快取。

**提交前失效。** 先 `DEL` 再 `COMMIT`，舊值會在中間被讀回快取，而且要等 TTL 才會修正。

**快取資料被呼叫端改到。** 程式內快取回傳的是同一個 list 物件，呼叫端 `append` 之後，下一個讀取的人也看到。Redis 每次反序列化出新物件，沒有這個問題；程式內快取要回傳副本，或約定回傳值唯讀。

**用 `time.time()` 算經過時間。** 系統時鐘可能被 NTP 調整而往回跳，算出負的經過時間。單一行程裡計算間隔用 `time.monotonic()`。

**被拒絕的請求也扣 token。** 使用者越重試越久才能恢復。不夠的時候只回拒絕，不扣。

**限流放在昂貴操作之後。** 先查資料庫、驗證完 body 才檢查限流，被限流的請求照樣消耗了資源。限流放在最前面，但在驗證身分之後（需要知道是誰）。

## 驗收題在測什麼

**cache-aside**：TTL 內只呼叫一次 loader、剛好到期就重新載入；不同醫師或日期是不同的 key；空 list 也被快取；loader 丟例外時不快取、例外往外傳；`on_booked()` 只讓那一位醫師那一天的清單失效。

**token bucket**：一開始能連發 `capacity` 次；依經過時間補充，含小數累積（0.25 秒補 0.5 個、再 0.25 秒湊滿 1 個）；閒置很久也不超過容量；被拒絕的請求不扣 token；`retry_after()` 的值；不同使用者互不影響。

兩題都用注入的時鐘，所以測試不需要真的等待。Redis 版本的實作（Lua 腳本、`SET NX` 鎖）不在驗收範圍內。下一階段把整個服務打包成映像，並讓每次 push 自動跑測試。

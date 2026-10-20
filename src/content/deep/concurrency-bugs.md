## 從一個具體問題開始：新會員禮券被領了兩張

「新會員禮券每人限領一次」的 API 長這樣：

```python
# 先查有沒有領過，沒有就發一張
async def claim_coupon(user_id: int):
    exists = await db.fetch_val(
        "SELECT count(*) FROM coupon_claims WHERE user_id = $1 AND campaign = 'welcome'", user_id)
    if exists == 0:
        await db.execute(
            "INSERT INTO coupon_claims (user_id, campaign) VALUES ($1, 'welcome')", user_id)
        await issue_coupon(user_id, amount=100)
```

使用者在網路很慢時連按了兩次「領取」，兩個請求被負載平衡器送到兩個不同的 worker：

| 時間 | 請求 A（worker 1） | 請求 B（worker 2） | 資料表裡的紀錄 |
|---|---|---|---|
| t1 | 查詢：count = 0 | | 0 筆 |
| t2 | | 查詢：count = 0 | 0 筆 |
| t3 | 判斷沒領過，INSERT | | 1 筆 |
| t4 | | 判斷沒領過（根據 t2 的結果），INSERT | 2 筆 |
| t5 | 發出 100 元禮券 | 發出 100 元禮券 | 2 筆 |

每一句 SQL 單獨看都沒錯，錯在「查」與「做」之間隔了一段時間，另一個請求剛好插了進來。這種結果取決於執行先後順序的 bug 叫做 **race condition**（競態條件）。它在開發環境幾乎不會出現（一次只有一個請求），上線後偶爾出現、難以重現，常常要等到對帳時才被發現。

## 四種常見的形狀

| 形狀 | 典型程式 | 出事時的結果 |
|---|---|---|
| check-then-act（先查再做） | `if not exists: create()`、`if balance >= x: withdraw()` | 重複建立、超賣、餘額變負 |
| read-modify-write（讀改寫） | `n = get(); set(n + 1)`、`stock = stock - 1` 在程式裡算 | 更新遺失（lost update）：兩次加一只加了一次 |
| lost update | 兩個人同時編輯同一份資料，後存的蓋掉先存的 | 前一個人的修改無聲消失 |
| 重複提交 | 連點兩次、客戶端逾時重試、佇列重送訊息 | 同一個動作被執行兩次：扣款兩次、寄兩封信 |

lost update 其實是 read-modify-write 的結果；用庫存扣減說明 lost update 的完整時間線，見 [交易與隔離等級](#/skill/transactions)。重複提交比較特別：它不需要兩個「不同的」動作同時發生，同一個動作被送了兩次就夠了。

判斷一段程式有沒有這類問題，問一個問題：**「讀到的值」到「根據它做決定並寫入」之間，別人能不能改掉那個值？** 能，就有 race。

## 兩個層次：程式內與跨服務

### 程式內：執行緒與 async

在同一個程序裡，多個執行緒或多個 async task 共用記憶體。

**執行緒**：CPython 有 GIL（全域直譯器鎖），但 GIL 只保證「一次只有一個執行緒在跑 bytecode」，不保證你的一行程式是原子的。`counter += 1` 會被拆成「讀 counter、加一、寫回」幾個 bytecode，執行緒可能在中間被切換。Python 3.13 起還有實驗性的 free-threaded 版本（沒有 GIL），共用狀態沒有加鎖的問題只會更明顯。

```python
import threading

counter = 0
lock = threading.Lock()

def unsafe():
    global counter
    for _ in range(100_000):
        counter += 1          # 讀、加、寫不是原子的，執行緒可能在中間被切換

def safe():
    global counter
    for _ in range(100_000):
        with lock:            # 同一時間只有一個執行緒能進入這段
            counter += 1

# 在本機 CPython 用 4 個執行緒各跑一次 unsafe，結果可能小於 400000（依版本與機器而定）；
# safe 一定是 400000
```

**asyncio**：只有一個執行緒，task 只在 `await` 的地方交出執行權。所以兩個 `await` 之間的程式，不會被同一個 event loop 上的其他 task 打斷，這是 asyncio 比執行緒好推理的地方。但只要「讀」和「寫」中間有一個 `await`（查資料庫、呼叫 API、甚至 `asyncio.sleep(0)`），其他 task 就可能在那裡插進來。

### 跨程序、跨主機

正式環境通常有多個 worker 程序（gunicorn、uvicorn 的多 worker）與多台主機。開頭的例子，兩個請求在不同的 worker 裡：

- `threading.Lock`、`asyncio.Lock` 只在**同一個程序**內有效，別的 worker 看不到這把鎖。
- 程序內的變數、`lru_cache`、全域 dict 也是每個 worker 各一份。

跨程序的並發要交給一個**所有人共用的仲裁者**，最常見的就是資料庫本身：

| 工具 | 有效範圍 | 用在 |
|---|---|---|
| `threading.Lock` / `asyncio.Lock` | 同一個程序 | 程序內的共用狀態：記憶體快取、計數器、連線物件 |
| 條件更新 `UPDATE … WHERE 條件` | 所有連到這個資料庫的人 | 扣庫存、扣餘額、狀態轉換（`WHERE status = 'pending'`） |
| 唯一約束 + `ON CONFLICT` | 同上 | 「每人一次」「每筆訂單一張發票」這種不能重複的事 |
| `SELECT … FOR UPDATE` | 同上 | 判斷邏輯太複雜、塞不進一句 `WHERE` 時，先鎖住要改的列 |
| 樂觀鎖（version 欄位） | 同上 | 衝突少、不想讓別人排隊；更新到 0 列就重讀重試 |
| 冪等鍵 | 同上 | 重複提交、重試 |
| 分散式鎖（Redis `SET key value NX PX`、資料庫 advisory lock） | 所有連到同一個 Redis / 資料庫的人 | 同一時間只能有一個人做的工作（例如排程），且沒有適合的資料列可以鎖 |

## 實際程式：用 asyncio 重現 lost update，再用鎖修好

下面這段在瀏覽器裡用 asyncio 模擬 100 個並行的存款請求。`await asyncio.sleep(0)` 代表一次 I/O（例如查資料庫），task 會在那裡交出執行權：

```python run
import asyncio

balance = 0

async def deposit_unsafe(amount: int):
    global balance
    current = balance              # 讀
    await asyncio.sleep(0)         # 一次 I/O：在這裡讓出執行權，其他 task 會先跑
    balance = current + amount     # 寫：用的是剛才讀到的舊值

lock = asyncio.Lock()

async def deposit_safe(amount: int):
    global balance
    async with lock:               # 讀、等 I/O、寫整段包起來，同一時間只有一個 task 在裡面
        current = balance
        await asyncio.sleep(0)
        balance = current + amount

async def run(fn) -> int:
    global balance
    balance = 0
    await asyncio.gather(*(fn(10) for _ in range(100)))   # 100 個請求同時進來，各存 10 元
    return balance

print("沒有鎖：", await run(deposit_unsafe), "（應該是 1000）")
print("有鎖：  ", await run(deposit_safe))

# check-then-act 也一樣：查和做之間有 await，就會重複發放
claims = []

async def claim_unsafe(user_id: int):
    if user_id not in claims:      # 查
        await asyncio.sleep(0)     # 例如查資料庫、呼叫發券服務
        claims.append(user_id)     # 做

await asyncio.gather(*(claim_unsafe(42) for _ in range(3)))
print("同一個使用者連按三次，領到", claims.count(42), "張")
```

沒有鎖時結果是 10：100 個 task 都在 `sleep(0)` 之前讀到 0，之後各自寫入 0 + 10。把 `await asyncio.sleep(0)` 那一行刪掉再跑，沒有鎖的版本也會得到 1000，因為讀和寫之間不再讓出執行權。這正好說明了 asyncio 的規則：race 發生在 `await` 的地方。

但這把 `asyncio.Lock` 只保護同一個程序。開頭的禮券例子在兩個 worker 裡，要靠資料庫。

## 跨服務的解法：讓資料庫當仲裁者

### 唯一約束：讓「不能重複」成為資料庫的規則

把「每人限領一次」寫成約束，資料庫保證不管多少個請求同時進來，只有一個 `INSERT` 會成功：

```sql run
-- (user_id, campaign) 是主鍵：同一個使用者在同一個活動只能有一筆
CREATE TABLE coupon_claims (
  user_id    int  NOT NULL,
  campaign   text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, campaign)
);

-- 第一次：插入成功，RETURNING 回傳一列 → 應用程式發券
INSERT INTO coupon_claims (user_id, campaign) VALUES (42, 'welcome')
ON CONFLICT DO NOTHING RETURNING user_id;

-- 第二次（連點、重試）：衝突，什麼都不做，RETURNING 回傳 0 列 → 應用程式回「已領過」
INSERT INTO coupon_claims (user_id, campaign) VALUES (42, 'welcome')
ON CONFLICT DO NOTHING RETURNING user_id;

SELECT * FROM coupon_claims;
```

應用程式改成「先插入，插入成功才發券」，把「查」與「做」合成一個由資料庫保證的動作。插入與發券最好在同一個交易裡；若發券是呼叫外部服務，用 outbox 模式或讓發券本身也冪等（見 [訊息佇列與背景工作](#/skill/queues-workers)）。

### 條件更新：把判斷放進 WHERE

`UPDATE accounts SET balance = balance - 100 WHERE id = 1 AND balance >= 100` 在資料庫裡一次完成判斷與扣減，被擋住的交易拿到鎖後會用最新的值重新檢查條件。更新到 0 列就代表餘額不足。運作細節見 [交易與隔離等級](#/skill/transactions)。

### 冪等鍵：處理重複提交

連點兩次、逾時重試、佇列重送，都是「同一個動作」送了兩次。客戶端為每個動作產生一個隨機的 key（例如按下按鈕時產生的 UUID），放在 `Idempotency-Key` 標頭；伺服器把 key 存進有唯一約束的表，並記下第一次的處理結果。同一個 key 第二次進來，直接回傳第一次的結果，不再執行。完整的設計與重試情境，見設計情境 [付款請求的冪等與重試](#/scenario/idempotency)。

### 分散式鎖要小心用

Redis 的 `SET lock:job value NX PX 30000` 可以當作跨主機的鎖，但它有一個根本的問題：鎖有到期時間。持有鎖的程序如果卡住（GC 暫停、網路延遲、主機暫停）超過 30 秒，鎖自動到期、另一個程序拿到鎖，原本的程序醒來後並不知道自己已經失去鎖，兩個程序同時在做。要靠它保證正確性，被保護的資源還得檢查一個遞增的 fencing token，拒絕舊持有者的寫入。

所以順序是：能用唯一約束或條件更新解決的，就不要用分散式鎖。分散式鎖適合「重複做只是浪費、不會出錯」的場合，例如避免兩台主機同時重建同一份快取。

## 死結

鎖解決了 race，卻帶來另一個問題。兩筆轉帳同時發生，A 轉給 B、B 轉給 A，各自先鎖住轉出帳戶，再鎖轉入帳戶：

| 時間 | 交易 1（A → B） | 交易 2（B → A） |
|---|---|---|
| t1 | 鎖住帳戶 A | |
| t2 | | 鎖住帳戶 B |
| t3 | 要鎖帳戶 B：被交易 2 持有，等待 | |
| t4 | | 要鎖帳戶 A：被交易 1 持有，等待 |
| t5 | 永遠等下去 | 永遠等下去 |

這就是**死結**（deadlock）。死結要同時滿足四個條件（Coffman 條件）：

1. **互斥**：資源一次只能被一個人持有（鎖本來就是這樣）。
2. **持有並等待**：手上握著一把鎖，同時在等另一把。
3. **不可搶占**：別人不能把你手上的鎖搶走。
4. **循環等待**：1 等 2、2 等 1，形成一個環。

破壞任何一個就不會死結。實務上最容易的是破壞「循環等待」：**所有人都依固定順序上鎖**，例如一律先鎖 id 小的帳戶。兩筆轉帳都會先去搶帳戶 A，搶不到的那個在還沒持有任何鎖的情況下等待，不會形成環。另一種做法是設定等鎖的逾時：等太久就放棄、釋放手上已經持有的鎖、整個重試，讓「持有並等待」不會無限持續下去。

```python run
import asyncio

async def transfer(first: asyncio.Lock, second: asyncio.Lock):
    async with first:
        await asyncio.sleep(0.01)      # 拿到第一把鎖後做一點事（例如讀餘額）
        async with second:
            return "ok"

async def demo(ordered: bool):
    locks = {"A": asyncio.Lock(), "B": asyncio.Lock()}

    def pick(src, dst):
        # 固定順序：不管誰轉給誰，一律先鎖名稱比較小的帳戶
        pair = sorted([src, dst]) if ordered else [src, dst]
        return locks[pair[0]], locks[pair[1]]

    jobs = asyncio.gather(transfer(*pick("A", "B")), transfer(*pick("B", "A")))
    try:
        print("固定順序：" if ordered else "各自順序：", await asyncio.wait_for(jobs, timeout=0.5))
    except asyncio.TimeoutError:
        print("各自順序：0.5 秒內沒完成，兩個 task 互相等對方手上的鎖（死結）")

await demo(ordered=False)
await demo(ordered=True)
```

PostgreSQL 會自己偵測死結：等鎖超過 `deadlock_timeout`（預設 1 秒）後檢查是否形成環，發現就中止其中一個交易。被中止的那方會收到錯誤，應用程式要重試整個交易。偵測只是兜底，固定上鎖順序才是根本的修法。資料庫裡的列鎖、表鎖、`lock_timeout` 與怎麼查出誰擋住誰，見 [鎖與死結](#/skill/locks-deadlocks)。

## 常見錯誤與錯誤訊息

| 錯誤訊息 | SQLSTATE | 意思 | 怎麼處理 |
|---|---|---|---|
| `deadlock detected`，DETAIL 類似 `Process 1234 waits for ShareLock on transaction 5678; blocked by process 4321.` | `40P01` | 資料庫偵測到死結並中止了你的交易 | 重試整個交易；DETAIL 會列出互相等待的程序與語句，據此統一上鎖順序 |
| `duplicate key value violates unique constraint "coupon_claims_pkey"` | `23505` | 唯一約束擋下了重複資料，這正是它的工作 | 不要重試；轉成「已存在」（例如 HTTP 409）或改用 `ON CONFLICT` |
| `could not serialize access due to concurrent update` | `40001` | REPEATABLE READ 以上，要改的列在快照之後被別人改了 | 重試整個交易 |
| `canceling statement due to lock timeout` | `55P03` | 設了 `lock_timeout`，等鎖超過時間 | 找出長時間持有鎖的交易（`pg_stat_activity`、`pg_locks`）；重試或回報忙碌 |
| `RuntimeError: <asyncio.locks.Lock object at …> is bound to a different event loop` | | 同一把 `asyncio.Lock` 在不同的 event loop 裡使用 | 鎖要在同一個 loop 內建立與使用；不要在多個 `asyncio.run()` 之間共用 |

不會出現錯誤訊息的情況反而更常見：

- **數字對不上**：計數器少算、庫存變負、同一個人有兩筆紀錄。看到這些先找 check-then-act 與 read-modify-write。
- **測試全過，上線才出事**：單元測試一次只跑一個請求。要重現，得讓請求真的並行：用 `asyncio.gather` 同時送多個請求、在讀和寫之間插入 `sleep` 拉大時間窗、或用壓測工具對同一筆資料打大量請求。
- **在 async 程式裡用 `threading.Lock` 或同步的 I/O**：整個 event loop 被卡住，所有請求一起變慢。async 程式用 `asyncio.Lock`。
- **用程式內的鎖保護資料庫資料**：開發時單一程序沒問題，部署成多 worker 就失效。

## 動手

1. 執行 asyncio 那段，把 `deposit_unsafe` 裡的 `await asyncio.sleep(0)` 刪掉，確認結果變成 1000；再把 `range(100)` 改成 `range(3)`，看看結果是多少、為什麼。
2. 執行 SQL 那段，把 `ON CONFLICT DO NOTHING` 拿掉再跑第二個 `INSERT`，看實際的錯誤訊息與 SQLSTATE。
3. 執行死結那段，把 `timeout` 改成 2 秒，確認各自順序的版本依舊不會完成。
4. 程式題「修好重複領取」：用 `asyncio.Lock` 修好一個在 `await` 之間發生的 check-then-act。
5. 到設計情境 [秒殺：1,000 人搶 100 件](#/scenario/flash-sale) 與 [付款請求的冪等與重試](#/scenario/idempotency)，看高並行下的扣庫存與重複提交怎麼設計。

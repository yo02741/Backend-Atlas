## 從一個具體問題開始：搬到佇列之後，出現了三個新 bug

註冊 API 原本在請求裡直接寄歡迎信。郵件服務慢的時候，註冊要等好幾秒，偶爾還逾時失敗，使用者以為沒註冊成功又按了一次。於是改成：API 把「寄歡迎信」丟進佇列就回應，背景的 worker 去寄。

```python
def register(email, password):
    with db.transaction():
        user = create_user(email, password)
        queue.enqueue("send_welcome_email", user_id=user.id)   # 在交易裡就丟進佇列
    return {"id": user.id}, 201
```

API 變快了，但接著出現三種新狀況：

1. **偶爾找不到使用者**：worker 的 log 有時出現「user 123 not found」。任務在交易 commit **之前**就進了佇列，worker 動作太快，去查的時候那筆使用者資料還沒 commit，看不到。
2. **偶爾寄兩封**：部署時 worker 被重啟，正在寄的那封信已經送出，但還沒向佇列確認（ack），佇列把任務重新投遞，另一個 worker 又寄了一次。
3. **某天佇列積了幾萬筆**：郵件服務的 API 金鑰過期，每個任務都失敗、立刻重試、再失敗，佇列裡全是同一批任務在打轉，新的任務排不到。

這三個問題分別對應佇列的三個基本性質：**入列與資料庫交易不是同一件事**、**投遞是 at-least-once**、**失敗要有退避與終點**。

## 運作原理：生產者、broker、消費者

```text
 API（生產者）──enqueue──▶ broker（佇列）──deliver──▶ worker（消費者）
      │                        ▲                         │
      ▼                        └────────── ack ──────────┘
   回 201 / 202                     做完才確認；沒確認的會重新投遞
```

一個任務在佇列裡大致經過這幾個狀態：

| 狀態 | 意思 | 這時 worker 掛掉會怎樣 |
|---|---|---|
| ready | 在佇列裡等著被取走 | 沒影響 |
| in-flight / unacked | 已經交給某個 worker，還沒確認 | broker 等不到確認，過一段時間或連線中斷後**重新投遞** |
| acked | worker 確認完成，從佇列移除 | 沒影響 |
| dead-lettered | 重試太多次，移到死信佇列 | 等人處理 |

「等多久才重新投遞」各家說法不同：

| 系統 | 機制 |
|---|---|
| RabbitMQ | 消費者手動 ack；連線或 channel 關閉時，未 ack 的訊息會回到佇列 |
| Amazon SQS | visibility timeout：訊息被取走後在這段時間內對其他消費者隱藏，時間到還沒刪除就再次可見；可設定 redrive policy 在收到一定次數後移到死信佇列 |
| Redis Streams | consumer group 的 pending entries list 記錄已投遞未確認的訊息；`XACK` 確認，`XAUTOCLAIM`（Redis 6.2 起）把閒置太久的訊息轉給別的消費者 |
| Celery | 預設在任務**開始執行前**就 ack；設 `task_acks_late = True` 才改成做完再 ack。用 Redis 當 broker 時另有 `visibility_timeout`（文件寫的預設是 1 小時） |
| PostgreSQL 當佇列 | 沒有內建機制，要自己記 `locked_at`，由排程把卡太久的任務放回去（下面的 SQL 範例） |

**什麼時候 ack 決定了語意**：先 ack 再做，worker 中途掛掉任務就沒了（at-most-once）；做完才 ack，worker 在「做完」與「ack」之間掛掉，任務會被做兩次（at-least-once）。大部分背景工作要的是後者，所以**消費者一定要冪等**。三種語意的完整說明見 [分散式基礎](#/skill/distributed-basics) 的訊息傳遞一段。

還有一個常被忽略的條件：**visibility timeout（或同等的設定）必須比任務最長的執行時間長**。一個匯出要跑 40 分鐘，visibility timeout 卻是 30 分鐘，第 30 分鐘時佇列會以為 worker 死了，把同一個任務交給另一個 worker，兩個 worker 同時在跑同一份匯出。

## 消費者要冪等

冪等的意思是：同一個任務執行兩次，結果和執行一次一樣。做法依副作用的種類而定：

- **操作本身就冪等**：`UPDATE orders SET status = 'shipped' WHERE id = 7` 做兩次結果一樣；`balance = balance + 100` 做兩次就多加一次。能把任務改寫成「設定成某個狀態」，就不用額外去重。
- **去重紀錄和效果放在同一個資料庫交易**：建一張 `processed_jobs(job_id PRIMARY KEY)`，處理時先插入任務 id，插入失敗（已經存在）就跳過。因為去重紀錄與「加點數」在同一個交易，兩者一起成功或一起失敗，不會有「記了已處理但沒加到」的中間狀態。
- **外部副作用（寄信、扣款、呼叫第三方）**：沒辦法和自己的資料庫放在同一個交易。能做的是：
  - 對方支援冪等鍵時（很多金流 API 支援），用任務 id 當冪等鍵，重送時對方會認出來。
  - 對方不支援時（例如多數 SMTP 寄信），先寫一筆 `(user_id, 'welcome')` 的唯一紀錄再寄。這能擋掉絕大多數的重複，但「寄出之後、寫入完成狀態之前」掛掉的那一瞬間，仍然無法確定信到底寄出去沒有。這時要選擇偏向「可能重寄」或「可能漏寄」，並明確寫下來。

## 交易與入列：commit 之前別讓 worker 看到

開頭的第一個 bug：在交易裡 `enqueue`，任務比資料先到。反過來也一樣糟：任務已經進了佇列，交易卻 rollback 了，worker 會對一個不存在的使用者寄信。

| 做法 | 做法說明 | 風險 |
|---|---|---|
| 交易裡入列 | 開頭的寫法 | worker 看不到未 commit 的資料；交易 rollback 時任務已經送出 |
| commit 之後入列 | 例如 Django 的 `transaction.on_commit(lambda: send_welcome_email.delay(user.id))` | commit 成功、入列前程序掛掉，任務就遺失了 |
| outbox | 同一個交易裡寫入業務資料與一筆「待送出的任務」，另一個程序讀 outbox 再送進 broker | 多一個要維運的程序；可能重送，所以消費者仍要冪等 |
| 佇列就在同一個資料庫 | 任務表和業務資料在同一個 PostgreSQL，入列就是同一個交易裡的 `INSERT` | 佇列的吞吐量受限於資料庫；適合中小量的背景工作 |

「commit 之後入列」大多數時候夠用；不能接受遺失時用 outbox 或資料庫佇列。outbox 在跨服務流程裡的角色，見 [分散式基礎](#/skill/distributed-basics) 的 saga 一段。

## 重試、退避與死信

不是所有失敗都該重試：

- **該重試**：逾時、連線錯誤、對方回 5xx 或 429。這些是暫時性的，過一會兒可能就好。
- **不該重試**：參數錯誤、找不到資料、對方回 400 / 401 / 403、API 金鑰失效。重試一百次結果都一樣，只會佔住 worker。

重試要有三個東西：

1. **指數退避**：第 n 次失敗後等 `base × 2^(n−1)` 秒，並設上限。
2. **抖動**（jitter）：在等待時間裡加隨機。一大批任務同時失敗（例如對方服務掛了五分鐘）時，沒有抖動就會在同一個時間點一起重試，又把剛恢復的服務打掛。退避與抖動的細節見 [錯誤處理與韌性](#/skill/resilience)。
3. **次數上限與死信佇列**：超過上限的任務移到死信佇列（DLQ），保留原始內容與最後的錯誤訊息。DLQ 的筆數要有告警，也要有「修好後重新投遞」的工具。一直失敗、怎麼重試都不會成功的訊息叫 **poison message**，沒有上限時它會永遠在佇列裡打轉。

用 Celery 時，這些設定大致是（需要 Redis 與 Celery，不能在瀏覽器裡跑）：

```python
from celery import Celery

app = Celery("app", broker="redis://localhost:6379/0")
app.conf.task_acks_late = True                 # 做完才 ack：worker 中途掛掉會重新投遞
app.conf.task_reject_on_worker_lost = True     # worker 程序被砍掉時，任務退回佇列
app.conf.broker_transport_options = {"visibility_timeout": 3600}   # 秒，要比最長的任務還長

@app.task(
    autoretry_for=(TimeoutError, ConnectionError),   # 只對暫時性錯誤自動重試
    retry_backoff=True,                              # 指數退避
    retry_backoff_max=600,                           # 最多等 10 分鐘
    retry_jitter=True,                               # 加抖動
    retry_kwargs={"max_retries": 5},
)
def send_welcome_email(user_id: int):
    ...
```

## 實際程式

### 重新投遞與冪等的消費者

用一個 at-least-once 的簡化 broker 模擬「處理完、ack 前 worker 被砍掉」，比較兩種消費者。去重紀錄與加點數在同一個 sqlite 交易裡：

```python run
import sqlite3
import random
from collections import deque

db = sqlite3.connect(":memory:")
db.executescript("""
CREATE TABLE points (user_id INTEGER PRIMARY KEY, balance INTEGER NOT NULL);
CREATE TABLE processed_jobs (job_id TEXT PRIMARY KEY);     -- 記住處理過的任務 id
INSERT INTO points VALUES (42, 0);
""")

class Broker:
    """at-least-once 的佇列：取出的訊息在 ack 之前都還算「處理中」，worker 掛掉就重新投遞"""
    def __init__(self):
        self.ready, self.in_flight, self.deliveries = deque(), {}, 0
    def publish(self, msg):
        self.ready.append(msg)
    def receive(self):
        msg = self.ready.popleft()
        self.in_flight[msg["id"]] = msg
        self.deliveries += 1
        return msg
    def ack(self, msg_id):
        del self.in_flight[msg_id]
    def worker_lost(self):
        # 對應 RabbitMQ 的連線中斷、SQS 的 visibility timeout 到期：沒 ack 的放回佇列
        self.ready.extendleft(self.in_flight.values())
        self.in_flight.clear()

def grant_naive(msg):
    with db:                                               # 一個交易：正常結束就 commit
        db.execute("UPDATE points SET balance = balance + ? WHERE user_id = ?",
                   (msg["amount"], msg["user_id"]))
    return "done"

def grant_idempotent(msg):
    with db:                                               # 去重紀錄與效果在同一個交易裡
        cur = db.execute("INSERT OR IGNORE INTO processed_jobs (job_id) VALUES (?)", (msg["id"],))
        if cur.rowcount == 0:                              # 這個 id 處理過了：什麼都不做
            return "skip"
        db.execute("UPDATE points SET balance = balance + ? WHERE user_id = ?",
                   (msg["amount"], msg["user_id"]))
        return "done"

def run(handler):
    with db:
        db.execute("UPDATE points SET balance = 0")
        db.execute("DELETE FROM processed_jobs")
    broker = Broker()
    broker.publish({"id": "job-1", "user_id": 42, "amount": 100})   # 註冊禮 100 點
    crashed = False
    while broker.ready:
        msg = broker.receive()
        result = handler(msg)                              # 交易已經 commit
        if not crashed:
            crashed = True
            print(f"  第 {broker.deliveries} 次投遞：處理完、ack 之前 worker 被砍掉")
            broker.worker_lost()
            continue
        broker.ack(msg["id"])
        print(f"  第 {broker.deliveries} 次投遞：處理{'（認出重複，跳過）' if result == 'skip' else ''}並 ack")
    return db.execute("SELECT balance FROM points WHERE user_id = 42").fetchone()[0]

print("不冪等的消費者：")
print("  結果點數 =", run(grant_naive), "（應該是 100）")
print("冪等的消費者：")
print("  結果點數 =", run(grant_idempotent))

# 重試排程：指數退避 + 上限 + 抖動，超過次數就進死信
random.seed(1)
print()
for attempt in range(1, 5):
    delay = min(600, 10 * 2 ** (attempt - 1))             # 10、20、40、80 秒…最多 600 秒
    jittered = round(random.uniform(0, delay))             # full jitter：0 到 delay 之間隨機
    print(f"第 {attempt} 次失敗：退避上限 {delay:>3} 秒，加抖動後實際等 {jittered:>3} 秒")
print("第 5 次失敗：不再重試，移到死信佇列等人處理")
```

### PostgreSQL 當佇列：FOR UPDATE SKIP LOCKED

任務量不大、又想讓「入列」和業務資料在同一個交易時，可以直接用資料表當佇列。`FOR UPDATE SKIP LOCKED`（PostgreSQL 9.5 起）讓多個 worker 同時取任務時，跳過別人已經鎖住的列，不用排隊。本站的 PGlite 只有一條連線，看不到兩個 worker 搶同一列，但可以看完整的生命週期：

```sql run
CREATE TABLE jobs (
  id           BIGSERIAL PRIMARY KEY,
  kind         TEXT NOT NULL,
  payload      JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'dead')),
  attempts     INT  NOT NULL DEFAULT 0,
  max_attempts INT  NOT NULL DEFAULT 3,
  run_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at    TIMESTAMPTZ,
  last_error   TEXT
);
-- 只索引等著被取的任務：worker 每次都查這個條件
CREATE INDEX jobs_ready_idx ON jobs (run_at) WHERE status = 'queued';

-- 入列和業務資料在同一個交易：要嘛都有、要嘛都沒有
BEGIN;
INSERT INTO users (id, name, email, city) VALUES (6, 'Frank', 'frank@example.com', '台北');
INSERT INTO jobs (kind, payload) VALUES ('welcome_email', '{"user_id": 6}');
COMMIT;
INSERT INTO jobs (kind, payload) VALUES ('export_report', '{"user_id": 2}');

-- worker 取一個任務：鎖住最早可執行的一筆，別的 worker 會跳過它而不是等待
UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_at = now()
WHERE id = (
  SELECT id FROM jobs
  WHERE status = 'queued' AND run_at <= now()
  ORDER BY run_at, id
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING id, kind, payload, attempts;

-- 失敗：還有次數就排到之後重試（10 秒、20 秒、40 秒…），沒有了就標成 dead
UPDATE jobs
SET status     = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END,
    run_at     = now() + make_interval(secs => 10 * power(2, attempts - 1)),
    locked_at  = NULL,
    last_error = 'SMTP timeout'
WHERE id = 1
RETURNING id, status, attempts, run_at - now() AS retry_in;

-- 卡住的任務：worker 拿了之後就沒消息（例如被砍掉），超過 15 分鐘放回佇列
-- 這等於自己實作 visibility timeout；這裡先手動做出一筆卡住的任務
UPDATE jobs SET status = 'running', locked_at = now() - interval '20 minutes' WHERE id = 2;
UPDATE jobs SET status = 'queued', locked_at = NULL
WHERE status = 'running' AND locked_at < now() - interval '15 minutes'
RETURNING id, kind, attempts;

SELECT id, kind, status, attempts, last_error FROM jobs ORDER BY id;
```

成功時把 `status` 設成 `done`（或直接刪掉）。這張表會一直有更新與刪除，要注意 autovacuum 跟不跟得上，見 [資料庫維運](#/skill/db-operations)。

## 監控、容量與分流

佇列把「現在做不完的」延後，但不會讓工作消失。要看的指標：

- **最舊任務的等待時間**：比佇列長度更直接。1 萬筆任務、每秒處理 2,000 筆，只要等 5 秒；100 筆、每筆要跑 1 分鐘，就要等很久。對使用者有意義的是「要等多久」。
- **進入速率與處理速率**：長期來看，進入比處理快，佇列就會無限長大。要嘛加 worker，要嘛在入口限流或拒絕，見設計情境 [流量暴衝時的削峰與背壓](#/scenario/queue-backpressure)。
- **失敗率與死信數量**：失敗率突然上升通常是下游壞了，要告警。

**分開佇列**：寄密碼重設信和產生年度報表放在同一個佇列，一批大報表就會讓重設信等十幾分鐘（head-of-line blocking）。依「急迫性」與「執行時間」分成不同佇列，各自有自己的 worker 數量。

要長時間執行的任務（匯出、影片轉檔），API 回 202 加上一個查詢狀態的網址，進度存在資料庫，這部分見設計情境 [要跑三分鐘的匯出](#/scenario/long-task)。

## 選工具

| 選項 | 適合 | 要注意 |
|---|---|---|
| Redis + RQ / arq / Celery | Python 的一般背景任務、量中等 | Redis 的持久化設定決定重啟時任務會不會遺失；Redis 的淘汰策略不能是 `allkeys-*` |
| RabbitMQ | 需要路由、優先序、可靠的 ack 與死信 | 多一套要維運的服務 |
| 雲端佇列（SQS、Pub/Sub） | 不想自己維運 broker | 各家的投遞語意、訊息大小上限、順序保證不同，要看文件 |
| PostgreSQL 任務表 | 量不大、要和業務資料同交易 | 吞吐量受資料庫限制；表膨脹要靠 vacuum |
| Kafka | 事件流：多個消費者各自讀同一串事件、需要重播 | 不是任務佇列：以 partition 為單位依序消費、提交的是 offset，一筆一直失敗的訊息會卡住整個 partition，重試與死信要自己設計 |

Kafka 的強項是「事件被保留下來，新的消費者可以從頭讀」與「同一個 partition 內有順序」。單純要「把這件事丟到背景去做」時，Redis 或 RabbitMQ 簡單得多。

## 常見錯誤與錯誤訊息

| 現象或訊息（類似） | 原因 | 修法 |
|---|---|---|
| worker 查不到剛建立的資料（例如 `DoesNotExist`、`user not found`） | 在交易 commit 前入列 | commit 後入列、outbox，或資料庫佇列 |
| 同一封信寄兩次、點數加兩次 | at-least-once 重新投遞，消費者不冪等 | 去重紀錄與效果同一交易；外部呼叫帶冪等鍵 |
| 同一個長任務被兩個 worker 同時執行 | visibility timeout 比執行時間短 | 調長 timeout，或讓 worker 執行中定期延長（SQS 可以 `ChangeMessageVisibility`） |
| 佇列裡同一批任務一直失敗、一直重試 | 永久性錯誤也在重試、沒有次數上限 | 區分暫時與永久錯誤；設上限與死信佇列 |
| Celery worker 被砍掉後任務消失 | 預設在執行前 ack | `task_acks_late = True`，並確保任務冪等 |
| 下游恢復後立刻又被打掛 | 大量任務同時重試 | 退避加抖動 |
| 任務參數是整個 ORM 物件，worker 拿到過時的資料 | 入列時把資料序列化進去，執行時已經變了 | 只傳 id，worker 執行時再讀最新資料 |

## 動手

1. 在 Playground 跑重新投遞那段，把 `grant_idempotent` 裡的 `INSERT OR IGNORE` 移到另一個 `with db:` 交易裡（先記錄、後加點數分成兩個交易），想想 worker 在兩個交易之間掛掉會怎樣。
2. 跑 PostgreSQL 佇列那段，在最後加一句把 id 1 再失敗兩次（`UPDATE jobs SET status = 'running', attempts = attempts + 1 WHERE id = 1;` 後接失敗那句），看它什麼時候變成 `dead`。
3. 程式題：[冪等的消費者](#/exercise/queues-workers-1)、[長任務的狀態機](#/exercise/queues-workers-2)。
4. 設計情境：[要跑三分鐘的匯出](#/scenario/long-task)、[流量暴衝時的削峰與背壓](#/scenario/queue-backpressure)、[一則貼文要通知 10 萬個追蹤者](#/scenario/notifications-fanout)。
5. 定時觸發的工作（每天的報表、每小時的同步）另有重複執行與補跑的問題，見 [排程工作](#/skill/job-scheduling)。

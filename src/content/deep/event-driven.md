## 從一個具體問題開始：訂單付款了，點數卻沒加（或加了兩次）

訂單服務在付款成功後要做兩件事：把訂單狀態改成 `paid`，並送出一個 `order.paid` 事件。點數服務、出貨服務、通知服務都訂閱這個事件。程式這樣寫：

```python
# 很常見的寫法：先寫資料庫，再送事件
with db.transaction():
    db.execute("UPDATE orders SET status = 'paid' WHERE id = %s", [order_id])
broker.publish("order.paid", {"order_id": order_id, "amount": amount})
```

上線幾週後，客服收到兩種抱怨：

- 有些訂單付了款，點數一直沒加、也沒出貨。查 log 發現那幾筆在 commit 之後、publish 之前，服務剛好在滾動更新時被砍掉。
- 有些訂單的點數加了兩次。broker 送出事件後沒收到點數服務的 ack，又送了一次。

有人提議把順序反過來：先送事件、再寫資料庫。這樣換成另一種錯：事件送出後交易失敗了（例如違反約束、連線斷了），下游收到一個「訂單已付款」，但資料庫裡這筆訂單根本不是 paid。出貨服務照著事件出了貨。

這叫做**雙寫問題**（dual write）：資料庫和 broker 是兩個系統，沒有辦法放在同一個交易裡。只要「寫入」和「送出」是分開的兩步，中間就可能失敗。

## 雙寫的兩種失敗

| 順序 | 中間失敗時 | 結果 |
|---|---|---|
| 先 commit，再 publish | commit 成功，publish 前程式掛掉或 broker 連不上 | **丟事件**：資料改了，下游永遠不知道 |
| 先 publish，再 commit | publish 成功，commit 失敗 | **幽靈事件**：下游收到一件沒發生的事 |
| publish 包在交易裡 | publish 成功，交易後來 rollback | 同上，事件收不回來 |

在交易裡呼叫 broker 也不行：broker 不參與資料庫的交易，rollback 撤不回已經送出的訊息，而且交易期間等待外部系統會拉長鎖的時間。[交易](#/skill/transactions) 一課提過，交易裡呼叫外部服務是常見的事故來源。

分散式交易（兩階段提交）理論上能讓兩個系統一起 commit，但多數 broker 不支援、效能與可用性的代價也高，[分散式基礎](#/skill/distributed-basics) 有討論。實務上的主流做法是把問題轉成「只寫一個系統」。

## outbox：事件和資料在同一個交易

**Transactional outbox** 的想法是：事件先不送給 broker，而是寫進同一個資料庫的一張 `outbox` 表，和業務資料在同一個交易裡 commit。之後由另一個程序（relay）讀 outbox，把事件送進 broker。

```
 ┌────────── 同一個交易 ──────────┐
 │ UPDATE orders SET status='paid' │
 │ INSERT INTO outbox (...)        │──COMMIT──▶ 兩筆一起成立，或一起不成立
 └─────────────────────────────────┘
                 │
      relay 定期讀 published_at IS NULL 的列
                 │
                 ▼
     publish 到 broker ──成功──▶ UPDATE outbox SET published_at = now()
```

每一步失敗時：

| 失敗點 | 結果 |
|---|---|
| 交易 commit 前失敗 | 訂單和事件都沒寫入，沒有不一致 |
| commit 後、relay 讀取前 | 事件安全地在 outbox 裡，relay 下次會讀到 |
| relay publish 成功、標記 published 前掛掉 | 下次 relay 會**再送一次**：重複 |
| broker 暫時連不上 | relay 重試，事件延遲但不會丟 |

所以 outbox 提供的是**至少一次**（at-least-once）：不會丟，但可能重複。重複由消費端處理。

### 在 PostgreSQL 裡實作

```sql run
-- outbox 表：一列一個待送的事件
CREATE TABLE outbox (
  id             BIGSERIAL PRIMARY KEY,         -- 也當事件 id（消費端的冪等鍵）
  aggregate_type TEXT NOT NULL,                 -- 例如 order
  aggregate_id   TEXT NOT NULL,                 -- 例如訂單編號；用來決定分區
  event_type     TEXT NOT NULL,                 -- 例如 order.paid
  version        INT  NOT NULL DEFAULT 1,       -- 事件 schema 版本
  payload        JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at   TIMESTAMPTZ                    -- NULL 表示還沒送
);

-- 1. 業務資料和事件在同一個交易：一起成立
BEGIN;
UPDATE orders SET status = 'paid' WHERE id = 104;
INSERT INTO outbox (aggregate_type, aggregate_id, event_type, payload)
VALUES ('order', '104', 'order.paid', jsonb_build_object('order_id', 104, 'user_id', 3, 'amount', 3200));
COMMIT;

-- 2. 交易被撤銷：訂單沒改，事件也不存在（不會有幽靈事件）
BEGIN;
UPDATE orders SET status = 'shipped' WHERE id = 103;
INSERT INTO outbox (aggregate_type, aggregate_id, event_type, payload)
VALUES ('order', '103', 'order.shipped', jsonb_build_object('order_id', 103));
ROLLBACK;

-- 3. relay：一次取一批還沒送的，鎖住避免多個 relay 拿到同一批；送出後標記
UPDATE outbox SET published_at = now()
WHERE id IN (
  SELECT id FROM outbox WHERE published_at IS NULL
  ORDER BY id LIMIT 100
  FOR UPDATE SKIP LOCKED
)
RETURNING id, event_type, payload;

-- 4. 消費端：冪等鍵表。事件 id 是主鍵，重複的 INSERT 什麼都不做
CREATE TABLE processed_events (
  event_id     BIGINT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE points (user_id BIGINT PRIMARY KEY, balance INT NOT NULL DEFAULT 0);
INSERT INTO points VALUES (3, 0);

-- 處理事件 1：先「領取」事件 id，領到了才加點數；兩件事在同一句（同一個交易）
WITH claim AS (
  INSERT INTO processed_events (event_id) VALUES (1)
  ON CONFLICT (event_id) DO NOTHING
  RETURNING event_id
)
UPDATE points SET balance = balance + 32 FROM claim WHERE user_id = 3;

-- broker 重送同一個事件：INSERT 撞到主鍵，claim 是空的，UPDATE 0 列
WITH claim AS (
  INSERT INTO processed_events (event_id) VALUES (1)
  ON CONFLICT (event_id) DO NOTHING
  RETURNING event_id
)
UPDATE points SET balance = balance + 32 FROM claim WHERE user_id = 3;

SELECT (SELECT status FROM orders WHERE id = 104) AS order_104,
       (SELECT status FROM orders WHERE id = 103) AS order_103,
       (SELECT count(*) FROM outbox) AS events,
       (SELECT balance FROM points WHERE user_id = 3) AS points_user_3;
```

最後一句的結果：訂單 104 從 `pending` 變成 `paid`；訂單 103 仍是 `paid`，沒有變成 `shipped`；outbox 只有 1 筆（被撤銷的 `order.shipped` 不存在）；使用者 3 的點數是 32 而不是 64。

relay 那一段的 `FOR UPDATE SKIP LOCKED` 讓多個 relay 可以並行而不搶同一批，原理見 [訊息佇列與背景工作](#/skill/queues-workers)。在這個單一連線的瀏覽器環境裡看不出並行效果，但語法相同。實務上 relay 的流程是：在交易裡選出一批並鎖住 → 送到 broker → 成功後才標記並 commit。送出成功、commit 前掛掉，就會重送。

outbox 表會一直長大，要定期刪除已送出一段時間的列，或改用分區表按日期整個丟掉。

## 消費端冪等

既然傳遞是至少一次，消費端就必須**冪等**：同一個事件處理兩次，結果和一次一樣。常見兩種做法：

### 冪等鍵表

每個事件有唯一的 id（上面的 outbox `id`，或產生時給一個 UUID）。消費端處理前把 id 寫進 `processed_events`，主鍵擋住重複。關鍵是：**去重紀錄和業務效果要在同一個交易**。

- 先記錄、另一個交易再加點數：記錄成功後掛掉，事件被標為處理過，點數卻沒加。
- 先加點數、另一個交易再記錄：加完後掛掉，重送時又加一次。

上面 SQL 用一句 `WITH … INSERT … UPDATE` 把兩件事放在同一句（同一個交易）裡。效果在外部系統（寄信、呼叫第三方 API）時無法和資料庫同交易，就要靠對方支援冪等鍵，見 [付款請求的冪等與重試](#/scenario/idempotency)。

### 版本號

事件帶著 aggregate 的版本（或序號），消費端記錄目前處理到的版本，只接受更新的：

```sql
-- 只有事件版本比目前新才更新；舊的或重複的事件更新 0 列
UPDATE order_view SET status = 'shipped', version = 3
WHERE order_id = 104 AND version < 3;
```

版本號同時處理了重複與亂序：版本 2 晚於版本 3 到達，會被丟掉。適合「最新狀態覆蓋」的情境（訂單狀態、使用者資料），不適合「每個事件都要累加」的情境（加點數、扣庫存），後者用冪等鍵表。

下面用 Python 模擬 broker 重送，比較不去重與用冪等鍵去重的消費者：

```python run
# broker 的至少一次傳遞：沒收到 ack 就重送，所以同一個事件可能出現兩次
import random

random.seed(7)
events = [{"event_id": f"evt-{i}", "type": "order.paid", "user_id": 3, "points": 10} for i in range(1, 6)]


def deliver(events, dup_rate=0.4):
    out = []
    for e in events:
        out.append(e)
        if random.random() < dup_rate:   # ack 遺失 → 重送同一個事件
            out.append(e)
    return out


def naive_consumer(deliveries):
    balance = 0
    for e in deliveries:
        balance += e["points"]           # 每次收到都加
    return balance


def idempotent_consumer(deliveries):
    balance, processed, skipped = 0, set(), 0
    for e in deliveries:
        # 真實系統：INSERT INTO processed_events ... ON CONFLICT DO NOTHING，
        # 和加點數在同一個交易；這裡用 set 代表那張表
        if e["event_id"] in processed:
            skipped += 1
            continue
        processed.add(e["event_id"])
        balance += e["points"]
    return balance, skipped


deliveries = deliver(events)
print(f"原始事件 {len(events)} 筆，實際送達 {len(deliveries)} 次")
print("不去重的消費者：點數 =", naive_consumer(deliveries), "（應該是 50）")
balance, skipped = idempotent_consumer(deliveries)
print(f"冪等鍵去重：點數 = {balance}，跳過重複 {skipped} 次")
```

## 順序與分區

「先付款、後出貨」這種順序，在事件系統裡只在有限的範圍內成立：

- Kafka 這類以分區（partition）為單位的系統，**同一個分區內**保證順序，跨分區沒有全局順序。
- 要讓同一張訂單的事件保持順序，就用 `aggregate_id`（訂單編號）當分區鍵，讓它們進同一個分區。
- 消費端同一個分區只能有一個消費者在處理，才能維持順序；增加分區數可以提高並行度，但已有的鍵可能被重新分配到別的分區，改分區數要小心。
- 重試也會打亂順序：事件 A 處理失敗被丟去重試佇列，事件 B 先處理完了。需要嚴格順序的消費者，要嘛停下來等 A，要嘛用版本號容忍亂序。

outbox relay 自己也要注意：多個 relay 並行送出時，同一個 aggregate 的事件可能亂序進 broker。要保序就讓同一個 aggregate 由同一個 relay 處理，或讓消費端用版本號處理。

## 重放與事件版本

事件一旦送出，就可能被長期保存、被新加入的消費者從頭**重放**（replay）。這帶來兩個要求：

- **消費者在重放時也要冪等**：重放就是大規模的重送。
- **事件 schema 要能演進**：一年前的 `order.paid` 和今天的格式可能不同。

相容規則和 API 版本很像：

| 變更 | 相容嗎 | 做法 |
|---|---|---|
| 新增選填欄位 | 向後相容 | 舊消費者忽略不認識的欄位 |
| 刪除欄位、改型別 | 不相容 | 發新版本（`version = 2`），一段時間內兩版並存 |
| 改欄位的意義（例如 amount 從含稅改成未稅） | 最危險：格式沒變，結果錯了 | 一定要發新版本，或改欄位名 |

事件裡帶 `version` 欄位，消費端依版本選擇解析方式。有些團隊用 schema registry 集中管理事件格式與相容性檢查。

## CDC：從資料庫的變更日誌產生事件

**CDC**（Change Data Capture）是另一條路：不在應用程式裡寫 outbox 的發送程序，而是讀資料庫的變更日誌（PostgreSQL 的 WAL，透過 logical decoding），把每一筆變更轉成事件。Debezium 是常見的開源工具。

- 好處：應用程式不用改，所有寫入（包含手動修資料）都會產生事件；也可以只讀 outbox 表的變更，把 CDC 當成 outbox 的 relay。
- 代價：直接讀業務表的話，事件形狀跟著資料表結構走，資料表一改欄位，下游就受影響；也多一套要維運的元件，PostgreSQL 的 replication slot 沒被消費時會讓 WAL 一直累積、吃滿磁碟。

## 和相關課程的分工

| 課程 | 處理的問題 |
|---|---|
| [訊息佇列與背景工作](#/skill/queues-workers) | 一個服務內的任務佇列：ack、重試、死信、worker |
| [分散式基礎](#/skill/distributed-basics) | 部分失敗、一致性模型、傳遞語意、saga |
| 本課 | 資料庫寫入與事件送出的原子性、消費端去重、順序與版本 |

## 常見錯誤與錯誤訊息

| 現象或錯誤訊息 | 原因 | 怎麼修 |
|---|---|---|
| 資料改了，下游沒收到 | 雙寫：commit 後 publish 前失敗 | outbox 或 CDC |
| 下游收到一件沒發生的事 | 先 publish 後 commit，或交易裡 publish 後 rollback | outbox：事件只在 commit 後才可能送出 |
| 點數加兩次、信寄兩封 | 至少一次傳遞，消費者不冪等 | 冪等鍵表，去重與效果同一交易 |
| `duplicate key value violates unique constraint "processed_events_pkey"` | 重送的事件撞到冪等鍵表的主鍵；沒用 `ON CONFLICT` 時會讓交易失敗 | 用 `ON CONFLICT DO NOTHING`，把「重複」當成正常情況跳過 |
| 狀態從 shipped 退回 paid | 事件亂序，舊事件覆蓋新狀態 | 版本號：`WHERE version < 新版本` |
| outbox 越來越大、relay 變慢 | 已送出的列沒清 | 定期刪除，或用分區表；`published_at IS NULL` 加部分索引 |
| 資料庫磁碟被 WAL 吃滿 | CDC 的 replication slot 停止消費 | 監控 slot 落後量，停用的 slot 要刪除 |
| 新消費者重放後資料錯亂 | 舊版本事件格式不同，或消費者不冪等 | 事件帶版本；重放前確認消費者冪等 |

## 動手

1. 按 outbox 那段 SQL 的「在 Playground 開啟」，把重送的 `WITH claim` 再複製一次（共三次），確認點數仍是 32。
2. 把第 2 段的 `ROLLBACK` 改成 `COMMIT`，看 outbox 變成幾筆。
3. 在 Python 模擬裡把 `dup_rate` 改成 0.9，再把 `random.seed` 換成別的數字，看不去重的結果偏離多少。
4. 做本課的程式題：在同一個交易裡寫入訂單與 outbox 事件；用冪等鍵表處理一批含重複的事件。

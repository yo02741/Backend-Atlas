## 從一個具體問題開始：月結報表寄了三次，下個月一封都沒寄

月結報表原本用程式內的排程器（例如 APScheduler）寫在 API 程序裡：「每月 1 日 02:00 產生報表並寄給客戶」。只有一個程序時沒問題。之後發生兩件事：

1. API 擴充成三個副本。11 月 1 日 02:00，三個程序各自的排程器同時觸發，每個客戶收到三封一模一樣的報表。
2. 12 月 1 日 01:50 開始例行維護，主機重開機，02:10 才恢復。02:00 那一刻沒有任何程序在跑，排程器醒來後也不知道自己錯過了什麼。這個月沒有人收到報表，直到客戶來問。

這兩個問題是排程工作的核心：**觸發可能重複，也可能遺漏**。另外還有時區（02:00 是哪裡的 02:00）、工作跑太久和下一次重疊、失敗了沒人知道。下面依序處理。

## cron 語法

cron 表達式有五個欄位，依序是分、時、日、月、星期：

```bash
# ┌──────── 分（0–59）
# │ ┌────── 時（0–23）
# │ │ ┌──── 日（1–31）
# │ │ │ ┌── 月（1–12）
# │ │ │ │ ┌ 星期（0–7，0 和 7 都是星期日）
# │ │ │ │ │
  0 2 1 * *    /srv/app/.venv/bin/python -m app.jobs.monthly_report
```

| 寫法 | 意思 | 例子 |
|---|---|---|
| `*` | 每一個值 | `* * * * *`：每分鐘 |
| `a-b` | 範圍 | `0 9-18 * * *`：9 點到 18 點每個整點 |
| `a,b` | 列舉 | `0,30 * * * *`：每小時的 0 分與 30 分 |
| `*/n` | 每 n 個 | `*/15 * * * *`：每 15 分鐘（0、15、30、45 分） |
| `a-b/n` | 範圍內每 n 個 | `0 8-20/4 * * *`：8、12、16、20 點 |

幾個容易誤解的地方：

- **用哪個時區解讀**：傳統 cron 用主機的系統時區。容器與雲端主機通常是 UTC，所以 `0 9 * * *` 在 UTC 的主機上是台灣時間 17:00。Kubernetes CronJob 預設也依控制平面的時區解讀，可以用 `.spec.timeZone` 指定（例如 `Asia/Taipei`）。
- **日與星期同時指定時是「或」**：`0 0 15 * 5` 不是「15 號而且是星期五」，而是「每月 15 號，以及每個星期五」。只要其中一個欄位是 `*`，才是一般直覺的「且」。
- **`*/n` 不是「每隔 n 分鐘」**：它是「能被 n 整除的那些值」。`*/7` 會在 0、7、…、56 分跑，然後下一個小時的 0 分又跑，56 分到 0 分只隔 4 分鐘。
- 有些實作支援第六個欄位（秒）或 `@daily`、`@hourly` 這類別名，有些不支援；換平台時要確認。

下面是一個簡化的 cron 解析器，算出接下來幾次的執行時間。它支援上面表格裡的寫法，以及日與星期的「或」規則：

```python run
from datetime import datetime, timedelta, timezone

def parse_field(expr: str, lo: int, hi: int) -> set[int]:
    values = set()
    for part in expr.split(","):
        step = 1
        if "/" in part:
            part, s = part.split("/")
            step = int(s)
        if part == "*":
            start, end = lo, hi
        elif "-" in part:
            a, b = part.split("-")
            start, end = int(a), int(b)
        else:
            start = end = int(part)
        values.update(range(start, end + 1, step))
    return values

def parse(expr: str) -> dict:
    minute, hour, dom, month, dow = expr.split()
    return {
        "minute": parse_field(minute, 0, 59),
        "hour": parse_field(hour, 0, 23),
        "dom": parse_field(dom, 1, 31),
        "month": parse_field(month, 1, 12),
        "dow": {d % 7 for d in parse_field(dow, 0, 7)},   # 7 也是星期日
        "dom_star": dom == "*",
        "dow_star": dow == "*",
    }

def day_ok(c: dict, t: datetime) -> bool:
    cron_dow = (t.weekday() + 1) % 7          # Python 星期一 = 0；cron 星期日 = 0
    in_dom, in_dow = t.day in c["dom"], cron_dow in c["dow"]
    if c["dom_star"] or c["dow_star"]:
        return in_dom and in_dow
    return in_dom or in_dow                    # 兩個都有限定：任一個符合就跑

def next_runs(expr: str, after: datetime, n: int = 3) -> list[datetime]:
    c = parse(expr)
    t = after.replace(second=0, microsecond=0) + timedelta(minutes=1)
    out = []
    while len(out) < n:
        if t.month not in c["month"] or not day_ok(c, t):
            t = (t + timedelta(days=1)).replace(hour=0, minute=0)       # 整天跳過
        elif t.hour not in c["hour"]:
            t = (t + timedelta(hours=1)).replace(minute=0)              # 整小時跳過
        elif t.minute not in c["minute"]:
            t += timedelta(minutes=1)
        else:
            out.append(t)
            t += timedelta(minutes=1)
    return out

TPE = timezone(timedelta(hours=8))            # 台灣目前沒有夏令時間，固定 UTC+8
now = datetime(2026, 10, 30, 23, 50, tzinfo=TPE)   # 星期五晚上

def show(label, expr, tz, n=3):
    runs = next_runs(expr, now.astimezone(tz), n)
    print(f"{label:28}", [r.astimezone(TPE).strftime("%m-%d %a %H:%M") for r in runs])

show("*/15 9-10 * * 1-5（台灣時區）", "*/15 9-10 * * 1-5", TPE)
show("0 2 1 * *（台灣時區）", "0 2 1 * *", TPE)
show("0 9 * * *（台灣時區）", "0 9 * * *", TPE)
show("0 9 * * *（主機是 UTC）", "0 9 * * *", timezone.utc)   # 換算回台灣時間是 17:00
show("0 0 15 * 5（日或星期）", "0 0 15 * 5", TPE, n=4)   # 15 號是星期日也會跑
```

## 多台主機同時跑：避免重複執行

排程器寫在 web 程序裡，有幾個副本就會觸發幾次。可以選的做法：

| 做法 | 怎麼做 | 優點 | 要注意 |
|---|---|---|---|
| 只在一個地方觸發 | 排程獨立成一個程序或部署，副本數固定 1 | 最簡單 | 那個程序掛掉就沒人觸發；滾動部署時新舊版本可能短暫同時存在 |
| 平台的排程 | Kubernetes CronJob、雲端的排程服務、主機上的 cron 或 systemd timer | 觸發與執行分開，工作是獨立的程序 | 平台也可能重複或遺漏觸發，工作照樣要冪等 |
| 資料庫 advisory lock | 觸發後先 `pg_try_advisory_lock`，拿不到就跳過 | 不用額外元件；連線斷掉鎖自動釋放 | 只防「同時」，不防「先後各跑一次」；session 層級的鎖不適合交易模式的連線池（PgBouncer） |
| Redis 鎖 | `SET lock:job host NX PX 600000` | 跨語言、跨資料庫 | 工作比鎖的到期時間久，鎖會自動消失，別人又拿到 |
| 執行紀錄表 + 唯一約束 | 插入 (工作名稱, 排定時間)，插入成功的人執行 | 同時與先後都防得住；順便留下執行歷史 | 執行者中途掛掉，紀錄停在 running，要有逾時接手的規則 |

Kubernetes 的 CronJob 文件明確寫到：CronJob 大約每個排定時間建立一次 Job，但在某些情況下可能建立兩次，也可能一次都沒有，所以工作本身要冪等。換句話說，**換了觸發機制，冪等仍然不能省**。

advisory lock 的寫法（需要真的 PostgreSQL，不能在瀏覽器跑）：

```python
import psycopg

MONTHLY_REPORT_LOCK = 42_001          # 每個工作一個固定的整數 id

def run_if_free(conn: psycopg.Connection):
    # try 版本：拿不到就立刻回 false，不會排隊等
    got = conn.execute("SELECT pg_try_advisory_lock(%s)", [MONTHLY_REPORT_LOCK]).fetchone()[0]
    if not got:
        print("別的主機正在跑，跳過")
        return
    try:
        generate_monthly_report()
    finally:
        conn.execute("SELECT pg_advisory_unlock(%s)", [MONTHLY_REPORT_LOCK])
```

這只能防「同時」：主機 A 在 02:00:00 跑完（花了 2 秒）、主機 B 因為時鐘慢了 5 秒在 02:00:05 才觸發，B 拿得到鎖，又跑了一次。要同時防住「先後各跑一次」，用執行紀錄表，以「排定時間」當作唯一鍵：

```sql run
CREATE TABLE job_runs (
  job_name      text        NOT NULL,
  scheduled_for timestamptz NOT NULL,      -- 排定的時間，不是實際開始的時間
  host          text        NOT NULL,
  status        text        NOT NULL DEFAULT 'running',
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  PRIMARY KEY (job_name, scheduled_for)
);

-- 三台主機都被觸發，各自嘗試認領 11/1 02:00 這一次；只有第一個 INSERT 回傳一列
INSERT INTO job_runs (job_name, scheduled_for, host)
VALUES ('monthly-report', '2026-11-01 02:00+08', 'host-a')
ON CONFLICT DO NOTHING RETURNING host;

INSERT INTO job_runs (job_name, scheduled_for, host)
VALUES ('monthly-report', '2026-11-01 02:00+08', 'host-b')
ON CONFLICT DO NOTHING RETURNING host;

-- 執行完畢，標記成功
UPDATE job_runs SET status = 'succeeded', finished_at = now()
WHERE job_name = 'monthly-report' AND scheduled_for = '2026-11-01 02:00+08';

SELECT job_name, scheduled_for, host, status FROM job_runs;
```

認領的那台如果在執行中當機，紀錄會一直停在 `running`。常見的處理是：執行中定期更新一個 `heartbeat_at` 欄位，其他主機發現某筆 `running` 的心跳超過一段時間沒更新，就用條件更新（`UPDATE … WHERE status = 'running' AND heartbeat_at < now() - interval '10 minutes'`）把它接手過來重跑。所以接手後的重跑同樣要求工作冪等。

## 錯過的執行：主機停機、部署中

一般的 cron 不會補跑：排定的那一分鐘主機沒開，那一次就沒了。各平台有自己的補救機制，規則各不相同：

- **systemd timer**：`Persistent=true` 會記錄上次執行時間，開機後發現錯過就補跑一次。
- **anacron**：給不一定一直開機的機器跑每日、每週工作，開機後補跑。
- **Kubernetes CronJob**：控制器會檢查錯過的排定時間；設了 `startingDeadlineSeconds`，就只在排定時間後的這段時間內補啟動，超過就算錯過。文件也提到錯過的次數太多（超過 100 次）時，控制器不會啟動 Job，而是記錄錯誤。

比起依賴觸發機制補跑，更穩的是讓工作本身能**自我修復**：

- 不要寫「處理昨天的資料」，改成「處理上次成功之後到現在的所有資料」。工作記住一個水位（watermark，例如 `last_processed_at` 或最後一筆的 id），每次從水位接著做。漏跑一天，下一次會自動把兩天的資料一起處理。
- 每一筆要處理的資料有自己的狀態（`pending` → `done`），工作每次撈出所有 `pending` 的。漏跑只是延遲，不會遺失。
- 對「每個期間一份」的產出（月報、帳單），檢查最近幾個期間是否都已產生，缺的補上。

每個工作要明確決定錯過時怎麼做：全部補（帳單、對帳）、只補最近一次（快取重建、同步狀態）、或直接跳過（「每 5 分鐘檢查一次」的健康檢查）。

## 工作要冪等

重複觸發、逾時重試、接手重跑都會發生，所以同一個排定時間執行兩次，結果要跟執行一次一樣：

- **用排定時間決定處理範圍**。11 月 1 日 02:00 的月報處理的是「10 月」，這要從排定時間推算，不是從 `now()`：補跑發生在 11 月 3 日時，用 `now()` 會算成錯的月份。
- **結果用 upsert 寫入**：`INSERT … ON CONFLICT (customer_id, period) DO UPDATE`，重跑只會覆寫同一份報表。
- **副作用要記錄**：寄信、扣款、呼叫外部 API 前，先寫入 (對象, 期間) 的紀錄並設唯一約束，已經有紀錄就跳過。這和 [訊息佇列與背景工作](#/skill/queues-workers) 裡冪等消費者的做法相同。

## 時區與夏令時間

台灣目前沒有夏令時間，`Asia/Taipei` 固定是 UTC+8。但服務的使用者或排程對象如果在有夏令時間的地區，當地時間一年會有兩次異常。以美國東部時間為例：

- 2026 年 3 月 8 日，當地 02:00 直接跳到 03:00，**02:30 這個時間不存在**。排在 `30 2 * * *` 的工作那天可能不跑。
- 2026 年 11 月 1 日，當地 01:00 到 02:00 **出現兩次**。排在 `30 1 * * *` 的工作那天可能跑兩次。

不同的 cron 實作處理這兩種情況的方式不一樣（有的會特別處理、補跑或只跑一次，有的完全不處理），要查你用的那一個的文件。實務上的原則：

- 排程盡量用 UTC 寫，需要對齊當地時間的才指定時區。
- 在有夏令時間的時區，避開當地 01:00 到 03:00 這段排程。
- 資料庫與程式裡的時間一律存成帶時區的時間（PostgreSQL 的 `timestamptz`），只在顯示時轉換。

## 長時間的工作：逾時、重疊與監控

**重疊**：每 10 分鐘跑一次的工作某次跑了 15 分鐘，下一次已經開始，兩個同時在處理同一批資料。Kubernetes CronJob 用 `concurrencyPolicy` 控制：`Allow`（預設，允許重疊）、`Forbid`（前一個還沒結束就跳過這次）、`Replace`（取消前一個，改跑新的）。自己的排程用上面的鎖或執行紀錄處理。

**逾時**：沒有逾時的工作可能卡住好幾天（等一個不會回應的外部 API、等一把鎖），還佔著資源、擋著下一次。每一層都要設：Job 的 `activeDeadlineSeconds`、程式裡外部呼叫的逾時、資料庫的 `statement_timeout`。

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: monthly-report
spec:
  schedule: "0 2 1 * *"
  timeZone: "Asia/Taipei"          # 不指定就依控制平面的時區解讀
  concurrencyPolicy: Forbid        # 上一次還在跑，這次就跳過
  startingDeadlineSeconds: 3600    # 排定時間後 1 小時內還能補啟動，超過就算錯過
  jobTemplate:
    spec:
      backoffLimit: 2              # 失敗最多重試 2 次
      activeDeadlineSeconds: 7200  # 跑超過 2 小時就終止
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: report
              image: registry.example.com/app:1.4.2
              command: ["python", "-m", "app.jobs.monthly_report"]
```

**監控「根本沒跑」**：工作失敗時丟出例外、送出錯誤告警，這只抓得到「跑了但失敗」。開頭的 12 月案例裡，工作根本沒啟動，不會有任何錯誤。要抓這種情況，用**死人開關**（dead man's switch，也叫 heartbeat 監控）：工作每次**成功**完成時送一個 ping 給監控系統；監控系統知道它預期多久收到一次，超過時間沒收到就告警。

```python
import time
import urllib.request

def main():
    started = time.monotonic()
    count = generate_monthly_report()
    # 成功才 ping。監控端設定「每月 1 日 04:00 前沒收到就告警」
    url = f"{HEARTBEAT_URL}?rows={count}&seconds={round(time.monotonic() - started)}"
    urllib.request.urlopen(url, timeout=5)
```

另外記錄每次執行的開始、結束、耗時與處理筆數。耗時逐月變長是資料成長的訊號，處理筆數突然變成 0 通常代表上游出了問題，這些都不會以錯誤的形式出現。

## 常見錯誤與錯誤訊息

| 現象 / 訊息 | 原因 | 怎麼修 |
|---|---|---|
| cron 的輸出：`/bin/sh: 1: python: not found` | cron 的環境變數很少，`PATH` 通常只有 `/usr/bin:/bin`，也不會載入你的 shell 設定 | 用絕對路徑（`/srv/app/.venv/bin/python`），或在 crontab 開頭設定 `PATH` |
| `date +%F` 在 crontab 裡變成奇怪的結果 | crontab 的指令中 `%` 代表換行 | 寫成 `\%`，或把指令放進腳本檔 |
| 工作在錯的時間跑，剛好差 8 小時 | 主機是 UTC，表達式是照台灣時間寫的 | 改用 UTC 寫，或用平台的時區設定（CronJob 的 `timeZone`） |
| 工作的輸出不知道去哪了 | cron 預設把輸出寄到本機信箱（`MAILTO`），通常沒有人看 | 輸出導到 log（`>> /var/log/app/job.log 2>&1`）或讓工作自己寫結構化 log |
| 每個客戶收到兩三封一樣的信 | 排程在多個副本裡觸發，或工作重試時沒有冪等 | 只在一處觸發、加執行紀錄表、副作用記錄防重送 |
| Kubernetes 的事件出現錯過太多次排程、無法判斷是否要啟動的訊息 | CronJob 停用或控制器異常一段時間後，錯過的排程超過上限 | 設定 `startingDeadlineSeconds`；確認 CronJob 沒有被 `suspend` |
| 什麼都沒發生 | 主機停機、排程被停用、工作在啟動前就失敗 | heartbeat 監控 |

## 動手

1. 執行 cron 解析器那段，把 `now` 改成 2026 年 12 月 31 日 23:50，看 `0 2 1 * *` 怎麼跨年；試試 `*/7 * * * *`，確認 56 分到下個整點只隔 4 分鐘。
2. 執行執行紀錄表那段 SQL，再多插入一次 `host-c`，確認它拿不到；把 `scheduled_for` 改成 12 月 1 日，模擬下一次排程。
3. 程式題「停機後要補跑哪些」：算出停機期間錯過的排定時間，依策略決定補跑哪些，並確認重複觸發不會重複執行。
4. 到設計情境 [要跑三分鐘的匯出](#/scenario/long-task) 看長時間工作怎麼交給背景 worker、怎麼回報進度。

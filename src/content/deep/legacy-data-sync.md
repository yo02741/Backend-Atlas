## 從一個具體問題開始：同步每晚都成功，資料卻對不起來

一家醫院（虛構）正在把掛號系統換成新的服務。新服務有自己的 PostgreSQL，舊系統和它的舊資料庫（例如 Informix、Oracle、DB2 這類關聯式資料庫）還在線上，多數功能仍然寫進舊資料庫。新服務每晚跑一支同步程式，把預約資料從舊表複製過來。程式每天都回報成功。

兩週後櫃台陸續回報：

- 昨天下午取消的幾筆預約，在新系統裡還是有效的。
- 有些預約的診間是舊的。
- 一批病人姓名變成亂碼。

追下去，三個問題各有原因：舊系統取消預約是直接刪除那一列，同步查不到已經不存在的列；有一支批次程式改診間時沒有更新「最後異動時間」欄位；舊資料庫的字元編碼和新資料庫不同，轉換時沒有指定。

同步程式沒有報錯，不代表兩邊的資料一致。

## 同步方式

| 方式 | 做法 | 延遲 | 主要限制 |
|---|---|---|---|
| 全量批次 | 每次把整張表讀出來，整批換掉 | 一個批次週期 | 資料量大時慢，對舊資料庫負擔大 |
| 增量批次 | 只讀上次之後有變動的列 | 一個批次週期 | 需要可靠的水位欄位；看不到刪除 |
| CDC | 讀資料庫的變更日誌，把每筆變更送出去 | 接近即時 | 舊資料庫要支援並開放；多一套管線 |
| 雙寫 | 應用程式同時寫兩個資料庫 | 即時 | 兩邊沒有共同的交易，容易不一致 |
| 唯讀副本加 view | 不複製，直接查舊資料庫的副本 | 副本的延遲 | 只能讀；新系統綁在舊資料庫上 |

### 全量批次

整張表讀出來，載入暫存表，在一個交易裡換掉正式表的內容。它不依賴異動時間欄位，舊表刪掉的列也自然消失。代價是每次都讀全表，適合代碼表這類小表，或當成其他方式的定期校正。

### 增量批次與水位

**水位**（watermark）記錄「上次同步到哪裡」。每次只讀水位之後的列，處理完把水位往前推：

```sql
SELECT * FROM legacy_appt WHERE upd_ts >= :watermark ORDER BY upd_ts;
```

水位可以是異動時間，也可以是每次異動遞增的序號。幾個細節決定它會不會漏資料：

- **水位和資料在同一個交易更新**。資料寫了、水位沒推進，下次只是重讀；水位推進了、資料沒寫，就漏了。
- **水位設成這一批實際讀到的最大值**，不要用同步程式執行當下的時間。兩台主機的時鐘不一定一致（見 [分散式基礎](#/skill/distributed-basics)）。
- **邊界要重讀**。時間只記到秒的話，同一秒可能有多筆，上一批只讀到其中幾筆。用 `>=` 重讀邊界那一秒，搭配下面的 upsert，重讀不會造成重複。
- **比水位早的資料可能晚出現**。異動時間通常在寫入當下取得，交易卻可能晚一點才提交。批次讀到 10:00:05 時，一筆時間是 10:00:03 的異動還沒提交，之後提交了，水位卻已經過去。序號也有同樣的問題。常見做法是每次往回多讀一段重疊區間（例如幾分鐘），或水位只推進到「現在減去一段安全時間」。

**沒有可靠的異動時間欄位**時（欄位不存在，或不是每一條寫入路徑都會更新它）：

| 做法 | 說明 |
|---|---|
| 全量比對 | 讀全表，每列算雜湊，和上次存下來的雜湊比，只處理有變的列。讀取量大，寫入量小 |
| 只增不改的表用主鍵當水位 | 交易明細、紀錄檔這類不會修改的表適用 |
| 在舊表加欄位與 trigger | 要改舊資料庫，常常不被允許，也有風險 |
| 改用 CDC | 不依賴欄位 |

欄位可不可靠可以驗證：挑一天，用全量比對找出實際有變的列，再看它們的異動時間是不是都落在那一天。

**刪除**是增量批次看不到的：查詢只會回傳還存在的列。處理方式有三種：舊系統改成軟刪除（標記刪除時間，不真的刪）；定期比對兩邊的主鍵，新表有、舊表沒有的就是被刪掉的；或改用看得到刪除的 CDC。

### CDC

**CDC**（Change Data Capture）不查資料表，而是讀資料庫的變更日誌，把每一筆新增、修改、刪除轉成事件送出去，和 [事件驅動](#/skill/event-driven) 一課講的是同一件事。Debezium 是常見的開源 CDC 工具。

- 好處：延遲低；看得到刪除；不依賴異動時間欄位；所有寫入路徑（包含手動修資料）都會被捕捉。
- 代價：舊資料庫要支援變更日誌的擷取並給予權限，支不支援、怎麼設定依產品與版本而定，要查該產品的官方文件並和 DBA 確認。另外多一套要維運的管線；第一次要先做全量快照再接上日誌；事件的形狀跟著舊表的結構走。
- 傳遞是至少一次，目的端一樣要用 upsert 冪等套用。消費端停太久時，來源端的日誌可能被清掉（要重做快照）或一直累積。

### 雙寫

應用程式每次寫入都同時寫舊資料庫和新資料庫。兩個資料庫沒有共同的交易，所以有兩種不一致：

- **中途失敗**：第一個寫成功、第二個之前程式掛掉或逾時，兩邊就差一筆。
- **順序不同**：兩個請求同時改同一筆，抵達兩個資料庫的先後不同，最後的值就不同。這種情況沒有任何錯誤訊息。

要避免，就改成只寫一邊：資料和一筆待送紀錄（outbox）寫在同一個交易，由另一個程序依序送到另一邊，另一邊冪等套用。這和 [事件驅動](#/skill/event-driven) 的 outbox 是同一個做法。[部署策略](#/skill/cd-strategies) 的 expand–contract 也有「雙寫」這一步，但那是在同一個資料庫的同一個交易裡寫兩個欄位，沒有這個問題。

下面的程式模擬這兩種不一致，以及改用 outbox 之後的結果：

```python run
# 雙寫：應用程式先寫舊資料庫、再寫新資料庫，兩次寫入之間沒有共同的交易
import random


def diff(old_db, new_db):
    missing = sorted(k for k in old_db if k not in new_db)
    different = sorted(k for k in old_db if k in new_db and old_db[k] != new_db[k])
    return missing, different


# 狀況一：兩次寫入之間失敗（程式被重啟、逾時、新資料庫暫時連不上）
def dual_write(n, fail_rate, seed):
    rng = random.Random(seed)
    old_db, new_db, errors = {}, {}, 0
    for appt_id in range(1, n + 1):
        row = {"status": "booked", "room": "A12"}
        old_db[appt_id] = dict(row)          # 第一步成功
        if rng.random() < fail_rate:         # 第二步之前出事：使用者看到錯誤，但舊資料庫那筆已經寫進去了
            errors += 1
            continue
        new_db[appt_id] = dict(row)
    return old_db, new_db, errors


old_db, new_db, errors = dual_write(n=2000, fail_rate=0.01, seed=5)
missing, different = diff(old_db, new_db)
print(f"狀況一：寫入 2000 筆，中途失敗 {errors} 次 → 新資料庫少 {len(missing)} 筆，例如 {missing[:5]}")

# 狀況二：沒有任何失敗，但兩個請求同時改同一筆，抵達兩個資料庫的順序不同
old_db, new_db = {7: {"status": "booked"}}, {7: {"status": "booked"}}
writes = [("櫃台取消", "cancelled"), ("病人改期", "rescheduled")]
for _, status in writes:                     # 舊資料庫收到的順序：取消 → 改期
    old_db[7]["status"] = status
for _, status in reversed(writes):           # 新資料庫收到的順序：改期 → 取消
    new_db[7]["status"] = status
print(f"狀況二：沒有錯誤訊息，舊 = {old_db[7]['status']}、新 = {new_db[7]['status']}")


# 改成只寫一邊：資料和 outbox 在舊資料庫的同一個交易；relay 依序送到新資料庫，失敗就重送，新資料庫用 upsert 套用
def outbox_write(n, fail_rate, seed):
    rng = random.Random(seed)
    old_db, new_db, outbox, attempts = {}, {}, [], 0
    for appt_id in range(1, n + 1):
        row = {"status": "booked", "room": "A12"}
        old_db[appt_id] = dict(row)
        outbox.append((appt_id, dict(row)))  # 和上一行同一個交易：一起成立或一起不成立
    while outbox:                            # relay：送成功才從 outbox 移除，所以可能重送，但不會漏
        appt_id, row = outbox[0]
        attempts += 1
        if rng.random() < fail_rate:
            continue                         # 這次沒送到，下一輪再送同一筆（順序不變）
        new_db[appt_id] = row                # upsert：重送幾次結果都一樣
        outbox.pop(0)
    return old_db, new_db, attempts


old_db, new_db, attempts = outbox_write(n=2000, fail_rate=0.01, seed=5)
missing, different = diff(old_db, new_db)
print(f"outbox：送了 {attempts} 次（含重送 {attempts - 2000} 次）→ 新資料庫少 {len(missing)} 筆、內容不同 {len(different)} 筆")
```

### 唯讀副本加 view

新系統不複製資料，直接查舊資料庫的唯讀副本，用 view 把舊欄位名與代碼轉成新系統的樣子。沒有同步程式，也沒有兩份資料要對帳。代價是新系統的可用性與效能綁在舊資料庫上，只能讀不能寫，而且舊資料庫不能下線。適合過渡期早期、以查詢為主的功能。

## 資料轉換

| 項目 | 舊資料常見的樣子 | 轉換時要做的事 |
|---|---|---|
| 代碼 | `'1'`、`'2'`、`'9'` 這類代碼，意義寫在文件或程式裡 | 用對照表（一張表，不是寫死的判斷式）。對不到的代碼不能默默變成空值或預設值，要標成未知並計數 |
| 字元編碼 | 舊資料庫可能用 Big5 等舊編碼 | 明確指定來源編碼。罕用字與人名最容易出錯；轉換失敗的列要記錄下來，不要用替代字元帶過 |
| 日期與時區 | 不帶時區的本地時間、民國年字串、用 `'0000000'` 表示沒有日期 | 明講來源時區；特殊值轉成 NULL。結果不能受同步主機或連線的時區設定影響 |
| NULL 與空字串 | 用空字串、一串空白、`'0'` 表示沒有值；定長欄位的尾端補空白 | 訂一套規則（例如去頭尾空白後，空字串轉 NULL），同步與對帳都用同一套 |

不同資料庫產品對空字串、尾端空白的處理不一定相同，轉換規則要用實際資料驗證。代碼表誰維護、新增代碼時怎麼通知，屬於 [資料治理](#/skill/data-governance) 裡主資料的範圍。

## 實際程式：水位、upsert 與分段對帳

下面在 PGlite 裡建一張模擬的舊表和新表。同步寫成一個函式，方便重複執行：讀水位之後的列，轉換，用 `INSERT … ON CONFLICT DO UPDATE` 寫入，推進水位。

```sql run
-- 舊表：欄位名、代碼、不帶時區的時間，都照舊系統的樣子（虛構資料）
CREATE TABLE legacy_appt (
  appt_no INT PRIMARY KEY,
  pt_name TEXT,                  -- 定長欄位匯出後，尾端可能帶空白
  dept_cd TEXT NOT NULL,
  stat    TEXT NOT NULL,         -- '1' 已預約、'2' 已取消、'9' 未到
  upd_ts  TIMESTAMP NOT NULL     -- 不帶時區，實際是台灣時間
);
-- 新表：新系統自己的命名與代碼，另外記下「這一列對應舊資料的哪個版本」
CREATE TABLE appointments (
  id                BIGINT PRIMARY KEY,
  patient_name      TEXT NOT NULL,
  dept              TEXT NOT NULL,
  status            TEXT NOT NULL,
  source_updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE status_map (legacy_code TEXT PRIMARY KEY, status TEXT NOT NULL);   -- 代碼對照表是資料，不寫死在程式裡
CREATE TABLE sync_state (job TEXT PRIMARY KEY, watermark TIMESTAMP NOT NULL);   -- 水位：上次同步到哪裡
INSERT INTO status_map VALUES ('1', 'booked'), ('2', 'cancelled'), ('9', 'no_show');
INSERT INTO sync_state VALUES ('appt', '1900-01-01');
INSERT INTO legacy_appt VALUES
  (1, '王小明  ', 'IM',  '1', '2026-05-04 09:00:00'),
  (2, '李美玲',   'IM',  '1', '2026-05-04 09:05:00'),
  (3, '陳志豪  ', 'SUR', '1', '2026-05-04 09:10:00'),
  (4, '林雅婷',   'SUR', '2', '2026-05-04 09:20:00'),
  (5, '張家豪',   'PED', '1', '2026-05-04 10:00:00'),
  (6, '黃淑芬  ', 'PED', '9', '2026-05-04 10:30:00'),
  (7, '吳承恩',   'IM',  '1', '2026-05-04 11:00:00'),
  (8, '劉怡君',   'SUR', '1', '2026-05-04 11:15:00');

-- 一次增量同步：讀水位之後的變動 → 轉換 → upsert → 推進水位。整句是一個交易，資料和水位一起成立
CREATE FUNCTION sync_appt() RETURNS TABLE (upserted BIGINT, watermark TIMESTAMP) LANGUAGE sql AS $$
  WITH changed AS (
    SELECT l.* FROM legacy_appt l
    WHERE l.upd_ts >= (SELECT s.watermark FROM sync_state s WHERE s.job = 'appt')   -- >=：邊界那一秒重讀一次
  ), up AS (
    INSERT INTO appointments (id, patient_name, dept, status, source_updated_at)
    SELECT c.appt_no, btrim(c.pt_name), c.dept_cd,
           COALESCE(m.status, 'unknown'),               -- 對照表沒有的代碼不默默丟掉
           c.upd_ts AT TIME ZONE 'Asia/Taipei'          -- 明講來源時區，不依賴連線設定
    FROM changed c LEFT JOIN status_map m ON m.legacy_code = c.stat
    ON CONFLICT (id) DO UPDATE
      SET patient_name = EXCLUDED.patient_name, dept = EXCLUDED.dept,
          status = EXCLUDED.status, source_updated_at = EXCLUDED.source_updated_at
      WHERE appointments.source_updated_at <= EXCLUDED.source_updated_at   -- 舊版本不能蓋掉新版本
    RETURNING id
  ), adv AS (
    UPDATE sync_state s
    SET watermark = COALESCE((SELECT max(upd_ts) FROM changed), s.watermark)   -- 推進到這一批實際讀到的最大值
    WHERE s.job = 'appt'
    RETURNING s.watermark
  )
  SELECT (SELECT count(*) FROM up), (SELECT a.watermark FROM adv a);
$$;

-- 整張新表的內容指紋：每列串成文字、依主鍵排序後取 md5
CREATE VIEW appt_fingerprint AS
SELECT count(*) AS n, md5(string_agg(id || '|' || patient_name || '|' || dept || '|' || status, ',' ORDER BY id)) AS hash
FROM appointments;

-- 1. 第一次同步：8 筆
SELECT '第一次' AS run, * FROM sync_appt();
SELECT * FROM appt_fingerprint;

-- 2. 什麼都沒變就重跑：只重讀邊界那一筆，新表的指紋不變
SELECT '重跑' AS run, * FROM sync_appt();
SELECT * FROM appt_fingerprint;

-- 3. 舊系統這邊發生四件事
UPDATE legacy_appt SET stat = '2', upd_ts = '2026-05-04 13:00:00' WHERE appt_no = 3;   -- 正常的異動：取消，有更新時間
INSERT INTO legacy_appt VALUES (9, '蔡明哲', 'PED', '1', '2026-05-04 13:30:00');        -- 正常的新增
UPDATE legacy_appt SET dept_cd = 'IM' WHERE appt_no = 5;                              -- 某支批次程式改了科別，沒更新 upd_ts
DELETE FROM legacy_appt WHERE appt_no = 2;                                            -- 硬刪除

-- 4. 增量同步：抓得到前兩件，抓不到後兩件
SELECT '增量' AS run, * FROM sync_appt();

-- 5. 對帳：每 4 個主鍵一段，兩邊各算筆數與雜湊（轉換規則要和同步用的一樣）
WITH src AS (
  SELECT (l.appt_no - 1) / 4 AS seg, count(*) AS n,
         md5(string_agg(l.appt_no || '|' || btrim(l.pt_name) || '|' || l.dept_cd || '|' || COALESCE(m.status, 'unknown'), ',' ORDER BY l.appt_no)) AS hash
  FROM legacy_appt l LEFT JOIN status_map m ON m.legacy_code = l.stat
  GROUP BY 1
), dst AS (
  SELECT (id - 1) / 4 AS seg, count(*) AS n,
         md5(string_agg(id || '|' || patient_name || '|' || dept || '|' || status, ',' ORDER BY id)) AS hash
  FROM appointments
  GROUP BY 1
)
SELECT COALESCE(s.seg, d.seg) * 4 + 1 AS from_id, COALESCE(s.seg, d.seg) * 4 + 4 AS to_id,
       s.n AS legacy_rows, d.n AS new_rows,
       CASE WHEN s.n IS DISTINCT FROM d.n THEN '筆數不同'
            WHEN s.hash IS DISTINCT FROM d.hash THEN '筆數相同、內容不同'
            ELSE '一致' END AS result
FROM src s FULL JOIN dst d ON d.seg = s.seg
ORDER BY 1;
```

依序看結果：

- 第一次同步寫入 8 筆。重跑時 `upserted` 是 1，因為 `>=` 重讀了邊界那一筆；新表的筆數與雜湊和重跑前完全一樣。這叫**冪等**：跑一次和跑很多次結果相同，所以失敗之後可以直接重跑。
- 第三次同步抓到取消與新增（加上重讀的邊界共 3 筆），但沒抓到「沒更新異動時間的修改」和「硬刪除」。同步程式沒有報任何錯。
- 對帳把問題找出來，而且定位到區段：主鍵 1–4 筆數不同（舊表少一筆，是被刪掉的那筆）；5–8 筆數相同、內容不同（被批次程式改過科別的那筆）；9–12 一致。

`ON CONFLICT … DO UPDATE` 後面的 `WHERE` 讓比較舊的版本不會蓋掉比較新的版本，重疊讀取或亂序抵達都安全。

## 對帳

對帳是獨立於同步程式的檢查，由粗到細：

| 層次 | 比什麼 | 發現得了 | 發現不了 |
|---|---|---|---|
| 筆數 | 整表與每個區段的列數 | 漏掉、多出來 | 筆數相同但內容不同 |
| 分段雜湊 | 每個區段把各列內容串起來取雜湊 | 任何欄位的差異，並定位到區段 | 是哪一列（要再往下切） |
| 逐欄比對 | 不一致的區段逐列比，或隨機抽樣逐欄比 | 哪一列、哪個欄位、原因 | 沒抽到的列 |
| 業務彙總 | 每日每科的預約數、金額合計 | 業務單位看得懂的差異 | 互相抵銷的錯誤 |

- **要能定位**。只回報「不一致」沒有用，要能說出是哪個主鍵範圍。區段不一致時把它再切小，或在那一段逐列比。
- **兩邊的正規化要一樣**。跨資料庫產品時，數字與日期轉成文字的格式、NULL 的表示、尾端空白都可能不同，雜湊就對不起來。比較穩的做法是兩邊各自把正規化後的列匯出，由同一支程式算雜湊。
- **避開還在變動的資料**。兩邊不是同一瞬間的快照，最近幾分鐘的資料本來就可能不同。只比水位之前的資料，或連續兩次都不一致才算。
- **留紀錄**。每次對帳的時間、範圍、差異數要存下來。舊系統能不能停用，要看這份紀錄，見 [舊系統整合與逐步替換](#/skill/legacy-migration)。

## 可重跑的回補

**回補**（backfill）是把歷史資料第一次載入，或修正問題後把某一段重新同步：

- **冪等**：用 upsert，同一段重跑幾次結果都一樣；加上版本條件，舊資料不會蓋掉新資料。
- **分批**：依主鍵範圍，每批固定筆數、各自一個交易，並記下跑到哪個主鍵，中斷後從那裡接著跑。用 `WHERE id > :last ORDER BY id LIMIT n` 取下一批，不要用 `OFFSET`，原因見 [API 設計樣式](#/skill/api-patterns) 的分頁。
- **限速**：每批之間停一下，查詢設逾時，舊資料庫的負載超過門檻就暫停。
- **保護舊資料庫**：同步用的帳號只有讀取權限，這樣程式寫錯也不會改到舊資料；排在離峰時段跑；有唯讀副本或還原出來的複本就讀那一份。
- **和增量同步的順序**：先記下目前的水位，跑完回補，再從記下的水位開始跑增量。回補期間的異動會被增量補上，upsert 的版本條件保證先後順序不影響結果。

## 常見錯誤與錯誤訊息

| 現象或錯誤訊息 | 原因 | 怎麼處理 |
|---|---|---|
| 舊系統已取消的預約，新系統還在 | 增量批次看不到硬刪除 | 定期比對主鍵、軟刪除，或 CDC |
| 少數幾列一直是舊值 | 某條寫入路徑沒更新異動時間 | 驗證欄位可靠度；定期全量比對 |
| 偶爾漏一兩筆，重跑全量就好了 | 水位邊界：同一秒多筆，或比水位早的交易晚提交 | `>=` 重讀邊界，加重疊區間 |
| `duplicate key value violates unique constraint "appointments_pkey"` | 重跑時用單純的 `INSERT` | 改用 `INSERT … ON CONFLICT DO UPDATE` |
| `ON CONFLICT DO UPDATE command cannot affect row a second time` | 同一批裡同一個主鍵出現兩次 | 先去重，每個主鍵只留最新的一列 |
| `there is no unique or exclusion constraint matching the ON CONFLICT specification` | `ON CONFLICT` 指定的欄位沒有唯一約束 | 目的表的主鍵或唯一鍵要對應來源的主鍵 |
| 姓名出現亂碼或問號 | 來源編碼沒指定或指定錯 | 明確指定來源編碼，抽樣比對人名 |
| 時間差 8 小時 | 不帶時區的時間被當成 UTC | 轉換時明講來源時區 |

## 動手

1. 執行同步那段 SQL，在最後加一句 `SELECT * FROM sync_appt();` 再跑一次對帳，確認結果沒變：重跑同步修不好這兩個問題。
2. 接著處理刪除：寫一句 `DELETE FROM appointments WHERE id NOT IN (SELECT appt_no FROM legacy_appt);`，再對帳，看 1–4 那一段是否變成一致。想一想：資料量很大時這一句該怎麼分段。
3. 把函式裡的 `>=` 改成 `>`，在第一次同步之後新增一筆 `upd_ts` 剛好等於水位的資料，看它會不會被同步到。
4. 在雙寫的模擬裡把 `fail_rate` 改成 0.001 和 0.05，看少掉的筆數；即使失敗率很低，筆數一多就一定會出現。
5. 做本課的兩題程式題：依水位把排班異動 upsert 到新表（含代碼轉換）；寫對帳查詢，列出不一致的主鍵與原因。

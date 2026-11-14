## 從一個具體問題開始：重跑一次，報表數字變兩倍

一家醫院（虛構）每天凌晨 02:00 跑一支排程，把前一天的掛號彙總成「每日各科掛號數」，寫進報表用的資料表 `mart_daily_dept`。程式的核心只有一句：

```sql
INSERT INTO mart_daily_dept (visit_date, dept_code, registrations, cancellations)
SELECT visit_date, dept_code, count(*), count(*) FILTER (WHERE status = 'cancelled')
FROM stg_registrations
WHERE visit_date = current_date - 1
GROUP BY visit_date, dept_code;
```

5 月 5 日凌晨，這支排程寫完彙總表之後，在最後一步寄完成通知時逾時，整次執行被標成失敗。早上值班同仁手動重跑一次，這次成功了。

| 時間 | 發生的事 | `mart_daily_dept` 裡 5/4 內科的列 |
|---|---|---|
| 02:01 | 彙總 5/4 的掛號，`INSERT` 完成並提交 | 1 列，掛號數 212 |
| 02:02 | 寄通知逾時，整次執行標成失敗 | 1 列，掛號數 212 |
| 08:30 | 值班同仁重跑，執行成功 | 2 列，各 212 |
| 09:00 | 儀表板用 `SUM` 加總 | 顯示 424 |

內科單日 424 人，是平常的兩倍。程式沒有哪一句寫錯，第二次執行也確實成功，問題在於它假設自己**只會被執行一次**。

管線一定會失敗：來源晚到、連線中斷、後面的步驟出錯。失敗之後能做的是重跑，所以批次管線的第一個要求是**同一個批次跑幾次，結果都和跑一次一樣**，也就是冪等（idempotent）。[排程工作](#/skill/job-scheduling) 對單一工作的要求也是這個。

## 冪等的三種寫法

單純的 `INSERT`（追加）不是冪等的。要讓寫入可以重跑，常見的做法有三種：

| 做法 | 怎麼做 | 適合 | 要注意 |
|---|---|---|---|
| 分區覆寫 | 把這個批次負責的範圍（例如 5/4 這一天）整個刪掉再寫入，兩步同一個交易 | 依日期累積的彙總表、事實表 | 要有分區鍵；刪除與寫入用同一個條件 |
| upsert | 鍵已存在就更新，不存在就新增 | 以主鍵對應來源的表：維度表、明細 | 要有唯一鍵；來源裡消失的列不會被刪掉 |
| 暫存表加原子交換 | 整張表重算到旁邊的新表，再在一個交易裡換名字 | 每次整張重建的表 | 每次全部重算；交換語法依資料庫而定 |

這裡的**分區**指邏輯上的一塊：一個批次負責、可以整塊重算的資料範圍，通常是一天，不一定是資料庫的分區表；資料倉儲產品的覆寫分區語法依各產品文件。upsert 在 PostgreSQL 是 `INSERT … ON CONFLICT DO UPDATE`，語法見 [子查詢、CTE 與視窗函數](#/skill/sql-advanced)。

下面把三種做法各寫成一個函式，批次日期是參數，照開頭的狀況各跑兩次：

```sql run
-- 來源（staging）：一列一筆掛號，虛構資料
CREATE TABLE stg_registrations (
  id         BIGINT PRIMARY KEY,
  visit_date DATE NOT NULL,
  dept_code  TEXT NOT NULL,
  status     TEXT NOT NULL          -- completed / cancelled
);
INSERT INTO stg_registrations VALUES
  (1, '2026-05-04', 'IM',  'completed'),
  (2, '2026-05-04', 'IM',  'completed'),
  (3, '2026-05-04', 'IM',  'cancelled'),
  (4, '2026-05-04', 'SUR', 'completed'),
  (5, '2026-05-04', 'SUR', 'completed'),
  (6, '2026-05-04', 'PED', 'completed'),
  (7, '2026-05-05', 'IM',  'completed'),
  (8, '2026-05-05', 'SUR', 'cancelled');

-- 三張彙總表欄位相同，差在寫入方式；upsert 需要唯一鍵
CREATE TABLE mart_append    (visit_date DATE, dept_code TEXT, registrations INT, cancellations INT);
CREATE TABLE mart_overwrite (LIKE mart_append);
CREATE TABLE mart_upsert    (LIKE mart_append, PRIMARY KEY (visit_date, dept_code));

-- A 追加：每次執行都多寫一份。函式回傳這次寫入的列數
CREATE FUNCTION load_append(d DATE) RETURNS BIGINT LANGUAGE sql AS $$
  WITH ins AS (
    INSERT INTO mart_append
    SELECT visit_date, dept_code, count(*), count(*) FILTER (WHERE status = 'cancelled')
    FROM stg_registrations WHERE visit_date = d GROUP BY visit_date, dept_code
    RETURNING 1
  ) SELECT count(*) FROM ins;
$$;
-- B 分區覆寫：先刪掉這一天，再寫入這一天。整個函式在同一個交易裡，讀的人不會看到刪了還沒寫的狀態
CREATE FUNCTION load_overwrite(d DATE) RETURNS BIGINT LANGUAGE sql AS $$
  DELETE FROM mart_overwrite WHERE visit_date = d;
  WITH ins AS (
    INSERT INTO mart_overwrite
    SELECT visit_date, dept_code, count(*), count(*) FILTER (WHERE status = 'cancelled')
    FROM stg_registrations WHERE visit_date = d GROUP BY visit_date, dept_code
    RETURNING 1
  ) SELECT count(*) FROM ins;
$$;
-- C upsert：鍵（日期 + 科別）已存在就更新數字
CREATE FUNCTION load_upsert(d DATE) RETURNS BIGINT LANGUAGE sql AS $$
  WITH ins AS (
    INSERT INTO mart_upsert
    SELECT visit_date, dept_code, count(*), count(*) FILTER (WHERE status = 'cancelled')
    FROM stg_registrations WHERE visit_date = d GROUP BY visit_date, dept_code
    ON CONFLICT (visit_date, dept_code) DO UPDATE
      SET registrations = EXCLUDED.registrations, cancellations = EXCLUDED.cancellations
    RETURNING 1
  ) SELECT count(*) FROM ins;
$$;

-- 1. 5/4 的批次跑兩次（第一次其實已經寫入，第二次是重跑）。來源的 5/4 有 6 筆掛號
SELECT load_append('2026-05-04') AS append_rows, load_overwrite('2026-05-04') AS overwrite_rows, load_upsert('2026-05-04') AS upsert_rows;
SELECT load_append('2026-05-04') AS append_rows, load_overwrite('2026-05-04') AS overwrite_rows, load_upsert('2026-05-04') AS upsert_rows;
SELECT 'A 追加' AS method, count(*) AS mart_rows, sum(registrations) AS registrations FROM mart_append WHERE visit_date = '2026-05-04'
UNION ALL SELECT 'B 分區覆寫', count(*), sum(registrations) FROM mart_overwrite WHERE visit_date = '2026-05-04'
UNION ALL SELECT 'C upsert', count(*), sum(registrations) FROM mart_upsert WHERE visit_date = '2026-05-04';

-- 2. 來源更正：6 號掛號當初選錯科，其實是內科。更正後重跑 5/4
UPDATE stg_registrations SET dept_code = 'IM' WHERE id = 6;
SELECT load_overwrite('2026-05-04') AS overwrite_rows, load_upsert('2026-05-04') AS upsert_rows;
SELECT 'B 分區覆寫' AS method, dept_code, registrations FROM mart_overwrite WHERE visit_date = '2026-05-04'
UNION ALL SELECT 'C upsert', dept_code, registrations FROM mart_upsert WHERE visit_date = '2026-05-04'
ORDER BY 1, 2;

-- 3. 回補：同一個函式，換日期範圍
SELECT d::date::text AS batch_date, load_overwrite(d::date) AS rows_written
FROM generate_series(DATE '2026-05-04', DATE '2026-05-05', INTERVAL '1 day') AS d;
SELECT visit_date::text AS visit_date, dept_code, registrations, cancellations FROM mart_overwrite ORDER BY 1, 2;

-- 4. 第三種做法：整張表重算到新表，檢查沒問題後在一個交易裡換名字
CREATE TABLE mart_dept_total (dept_code TEXT PRIMARY KEY, registrations BIGINT NOT NULL);   -- 舊版本（空的）
BEGIN;
CREATE TABLE mart_dept_total_next (LIKE mart_dept_total INCLUDING ALL);
INSERT INTO mart_dept_total_next SELECT dept_code, count(*) FROM stg_registrations GROUP BY dept_code;
ALTER TABLE mart_dept_total      RENAME TO mart_dept_total_old;
ALTER TABLE mart_dept_total_next RENAME TO mart_dept_total;
DROP TABLE mart_dept_total_old;
COMMIT;
SELECT * FROM mart_dept_total ORDER BY dept_code;
```

依序看結果：

- **步驟 1**：追加的表有 6 列、掛號數合計 12，是來源的兩倍；分區覆寫與 upsert 都是 3 列、合計 6。
- **步驟 2**：來源更正後 5/4 已經沒有兒科的掛號。分區覆寫的表只剩內科 4、外科 2；upsert 的表還留著「兒科 1」，合計變成 7。upsert 只處理這次算出來的列，上次寫過、這次沒有的列不會被刪掉，所以彙總表適合用分區覆寫。
- **步驟 3**：回補只是把同一個函式套到一段日期上。
- **步驟 4**：PostgreSQL 的 DDL 可以放在交易裡，改名一次生效，讀的人看到的不是舊表就是新表。指向舊表的 view 與外鍵不會跟著換到新表。

## 增量、水位與遲到的資料

每天整張表重算最簡單，資料量一大就不可行，所以管線通常只處理新的部分。「新的部分」有兩種定義方式：

| | 依業務日期切分區 | 依異動時間的水位 |
|---|---|---|
| 這一批的範圍 | `visit_date = 批次日期` | `updated_at` 大於上次的水位 |
| 搭配的寫入方式 | 分區覆寫 | upsert |
| 怎麼重跑 | 再指定一次同一個批次日期 | 把水位退回去 |
| 看不到什麼 | 之後才補進舊日期的資料 | 硬刪除（查詢只讀得到還存在的列） |

水位怎麼存、為什麼和資料在同一個交易更新、邊界為什麼要重讀，[從舊資料庫同步資料](#/skill/legacy-data-sync) 有完整說明與範例，這裡不重複。

依日期切分區時要處理的是**遲到的資料**：看診日是 5/4 的掛號，5/6 才出現在來源，例如櫃台事後補登、分院的資料隔天才傳。5/4 的批次早就跑完，之後每天的批次也不會再碰 5/4。

這裡有兩個時間：**事件時間**（看診日）與**處理時間**（管線什麼時候拿到資料）。分區鍵用事件時間，報表才會把資料算在對的日子；哪些舊分區要重算，則靠處理時間判斷。常見的處理方式：

1. **固定回看區間**：每天除了昨天，也重算最近 N 天的分區。寫入是冪等的，重算沒有副作用，代價是每天多算 N 份。N 用實際資料決定：統計「載入日減去看診日」的分布。
2. **只重算受影響的分區**：staging 的每一列記下載入時間，找出上次執行之後才載入的列涉及哪些看診日，只重算那幾天。
3. **超過區間的交給回補**：幾個月前的資料被更正，會改變已經發布的月報，要不要改由資料負責人決定。

## 回補：同一支程式，換日期範圍

**回補**（backfill）是把過去一段日期重新算一遍：新表第一次建立、彙總邏輯改了、來源修正了一批資料。

- **批次日期是參數**。每日排程傳入排定的那一天，回補傳入一段日期，跑的是同一支程式。另外寫一支回補程式，兩份邏輯遲早不一致，回補出來的歷史數字和每日排程算的不同，而且不容易發現。
- **一個分區一個交易**。逐日執行，中斷後從失敗的那一天接著跑，不必整段重來。
- **邏輯改變要講清楚範圍**。全部歷史重算，還是從某一天開始生效？重算會改變已經發布的數字，要先讓使用報表的人知道。
- **由上游往下游**，並且分批、避開尖峰，見 [從舊資料庫同步資料](#/skill/legacy-data-sync) 的回補一節。

## 分層：raw、staging、mart

[資料治理](#/skill/data-governance) 提過，一個 PostgreSQL 分成 `raw`、`staging`、`mart` 三個 schema 就是 ELT 的雛形。三層各自的責任：

| 層 | 放什麼 | 這一層做的事 | 誰讀 |
|---|---|---|---|
| raw | 來源資料原樣落地 | 不改欄位、不轉型、不過濾，只加上載入時間與批次 | 只有管線 |
| staging | 一張來源表對一張整理過的表 | 改名、轉型、代碼正規化、去重、時區換算 | 管線與維護管線的人 |
| mart | 給人與報表用的表 | 業務邏輯：彙總、事實表與維度表 | 分析人員、儀表板、語意層 |

層的名稱各團隊不同，但責任要分開：清理規則集中在 staging、業務邏輯集中在 mart，數字不對時可以一層一層往回查。mart 裡的表怎麼設計見 [維度模型](#/skill/dimensional-modeling)，指標定義寫在哪裡見 [Semantic Layer](#/skill/semantic-layer)。

ETL 與 ELT 的差別在轉換放在載入之前還是之後，治理那一課已經比較過。對管線來說，差別在**重跑的起點**：ELT 有 raw 層，轉換失敗或邏輯改了，從 raw 重跑就好，不必再抽一次來源（來源那時可能已經不是當時的內容）；ETL 如果沒有保留原始資料，重跑就得回到來源重新抽取。代價是原始資料（包含個資）進了目的地，raw 層的權限要管得更嚴。

## 品質檢查放在管線裡

品質的維度、門檻與負責人在 [資料治理](#/skill/data-governance) 講過。這裡處理的是檢查放在哪裡：它是管線的一步，位置在「寫好」與「發布」之間。

```text
抽取 → raw → staging → 檢查 → mart → 檢查 → 通知下游
                        │
                        └─ 沒通過：停在這裡，mart 維持上一個版本
```

管線裡最常用的四種檢查：

| 檢查 | 掛號資料的例子 |
|---|---|
| 筆數：這一批有沒有資料、量合不合理 | 當日掛號是 0 筆，或不到近 7 日平均的一半 |
| 唯一性：粒度的鍵有沒有重複 | 同一個掛號 id 出現兩列（來源重送，或 JOIN 複製了列） |
| 非空：必填欄位有沒有值 | 科別代碼是 NULL 或空字串 |
| 對帳：上下游的數字對不對得起來 | mart 的掛號數合計等於 staging 的列數 |

幾個原則：

- **失敗要擋住下游**。檢查那一步以失敗結束，依賴它的步驟就不執行。儀表板顯示「資料到 5/4」，比顯示一個錯的 5/5 好。
- **分清楚要擋還是只警告**。鍵重複、整批是空的，要擋；筆數比平常少兩成可能只是連假，發警告但照常發布。門檻由資料負責人決定。
- **結果留紀錄，不合格的列有去處**。記下哪個批次、哪條規則、違規幾筆；不合格的列移到隔離表等人處理，不要默默丟掉。

```sql run
-- staging：5/5 這一批照來源原樣載入，還沒有主鍵（虛構資料）
CREATE TABLE stg_registrations (id BIGINT NOT NULL, visit_date DATE NOT NULL, dept_code TEXT, status TEXT NOT NULL);
INSERT INTO stg_registrations VALUES
  (11, '2026-05-05', 'IM',  'completed'),
  (12, '2026-05-05', 'IM',  'cancelled'),
  (13, '2026-05-05', 'SUR', 'completed'),
  (13, '2026-05-05', 'SUR', 'completed'),   -- 來源重送：同一個 id 出現兩列
  (14, '2026-05-05', NULL,  'completed'),   -- 科別沒有值
  (15, '2026-05-05', 'PED', 'completed');
CREATE TABLE mart_daily_dept (visit_date DATE, dept_code TEXT, registrations INT, PRIMARY KEY (visit_date, dept_code));
INSERT INTO mart_daily_dept VALUES ('2026-05-04', 'IM', 4), ('2026-05-04', 'SUR', 2);   -- 目前已發布到 5/4
CREATE TABLE quality_results (
  batch_date DATE, check_name TEXT, violations BIGINT, passed BOOLEAN,
  PRIMARY KEY (batch_date, check_name)
);

-- 檢查：批次日期是參數；每條規則算出違規數，0 才算通過。結果用 upsert 記錄，檢查本身也可以重跑
CREATE FUNCTION run_checks(d DATE) RETURNS SETOF quality_results LANGUAGE sql AS $$
  INSERT INTO quality_results
  SELECT d, c.check_name, c.violations, c.violations = 0
  FROM (
    SELECT '1 筆數：這一批不能是空的' AS check_name, (count(*) = 0)::int AS violations
    FROM stg_registrations WHERE visit_date = d
    UNION ALL
    SELECT '2 唯一性：id 不能重複', count(*)
    FROM (SELECT id FROM stg_registrations WHERE visit_date = d GROUP BY id HAVING count(*) > 1) dup
    UNION ALL
    SELECT '3 非空：科別必填', count(*)
    FROM stg_registrations WHERE visit_date = d AND NULLIF(btrim(dept_code), '') IS NULL
  ) c
  ON CONFLICT (batch_date, check_name) DO UPDATE
    SET violations = EXCLUDED.violations, passed = EXCLUDED.passed
  RETURNING *;
$$;

-- 發布：這一批的檢查全部通過，才用分區覆寫把這一天寫進 mart；否則什麼都不動
CREATE FUNCTION publish(d DATE) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE((SELECT bool_and(passed) FROM quality_results WHERE batch_date = d), false) THEN
    RETURN 'blocked：檢查沒通過（或還沒跑），mart 維持原狀';
  END IF;
  DELETE FROM mart_daily_dept WHERE visit_date = d;
  INSERT INTO mart_daily_dept
  SELECT visit_date, dept_code, count(*) FROM stg_registrations WHERE visit_date = d GROUP BY visit_date, dept_code;
  RETURN 'published';
END $$;

-- 1. 檢查 5/5 這一批：兩條沒過
SELECT check_name, violations, passed FROM run_checks('2026-05-05') ORDER BY check_name;

-- 2. 發布被擋下，mart 還是只有 5/4
SELECT publish('2026-05-05') AS result;
SELECT visit_date::text AS visit_date, sum(registrations) AS registrations FROM mart_daily_dept GROUP BY visit_date ORDER BY 1;

-- 3. 修正 staging 這一批（一樣是分區覆寫）：重複的列只留一份，缺科別的列移到隔離表
CREATE TABLE quarantine_registrations (LIKE stg_registrations);
INSERT INTO quarantine_registrations
SELECT * FROM stg_registrations WHERE visit_date = '2026-05-05' AND NULLIF(btrim(dept_code), '') IS NULL;
CREATE TABLE stg_fixed AS
SELECT DISTINCT * FROM stg_registrations WHERE visit_date = '2026-05-05' AND NULLIF(btrim(dept_code), '') IS NOT NULL;
BEGIN;
DELETE FROM stg_registrations WHERE visit_date = '2026-05-05';
INSERT INTO stg_registrations SELECT * FROM stg_fixed;
COMMIT;

-- 4. 重跑檢查與發布
SELECT check_name, violations, passed FROM run_checks('2026-05-05') ORDER BY check_name;
SELECT publish('2026-05-05') AS result;

-- 5. 對帳：staging 的列數、mart 的合計、隔離的列數
SELECT (SELECT count(*) FROM stg_registrations WHERE visit_date = '2026-05-05')         AS staging_rows,
       (SELECT sum(registrations) FROM mart_daily_dept WHERE visit_date = '2026-05-05') AS mart_total,
       (SELECT count(*) FROM quarantine_registrations WHERE visit_date = '2026-05-05')  AS quarantined;
```

第一次檢查有兩條沒過，`publish` 回傳 blocked，mart 沒有被動到；修正之後才發布。最後的對帳把來源的 6 列交代清楚：4 列進了 mart、1 列是重複、1 列在隔離表。範例為了能一路跑完，用回傳值表示被擋下；實際的管線會讓檢查那一步以錯誤結束，由排程工具停住下游並發告警。

## 相依順序、重試與排程工具的定位

管線是一串有相依關係的步驟：staging 要等抽取完成，mart 要等檢查通過，畫出來是一張有向無環圖（DAG）。執行器依相依順序執行、暫時性的錯誤自動重試、某一步失敗時不執行它的下游、重跑時只跑還沒成功的。下面用純 Python 模擬：

```python run
# 每一步宣告自己依賴誰；執行器依相依順序跑，失敗就擋住下游，重跑時跳過已經成功的
from graphlib import TopologicalSorter

DEPS = {
    "extract_registrations": [],
    "extract_doctors":       [],
    "stg_registrations":     ["extract_registrations"],
    "stg_doctors":           ["extract_doctors"],
    "quality_checks":        ["stg_registrations", "stg_doctors"],
    "mart_daily_dept":       ["quality_checks"],
    "mart_dim_doctor":       ["quality_checks"],
    "notify_dashboard":      ["mart_daily_dept", "mart_dim_doctor"],
}
ORDER = list(TopologicalSorter(DEPS).static_order())   # 上游一定排在下游前面

state = {}   # (批次日期, 步驟) -> success / failed / upstream_failed；排程工具會把它存在自己的資料庫


def run_pipeline(batch_date, outcome, max_retries=2):
    """outcome(step, attempt) 回傳 "ok"、"transient"（暫時性錯誤，可重試）或 "bad_data"（重試沒用）"""
    print(f"--- 批次 {batch_date} ---")
    for step in ORDER:
        key = (batch_date, step)
        if state.get(key) == "success":
            print(f"  skip     {step}（這個批次已經成功過）")
            continue
        blocked = [up for up in DEPS[step] if state.get((batch_date, up)) != "success"]
        if blocked:
            state[key] = "upstream_failed"
            print(f"  blocked  {step}（上游沒成功：{', '.join(blocked)}）")
            continue
        for attempt in range(1, max_retries + 2):
            result = outcome(step, attempt)
            if result == "ok":
                state[key] = "success"
                print(f"  success  {step}" + (f"（第 {attempt} 次才成功）" if attempt > 1 else ""))
                break
            if result == "bad_data":          # 資料有問題：重試只會得到一樣的結果，直接失敗並告警
                state[key] = "failed"
                print(f"  FAILED   {step}（資料檢查沒過，不重試，發告警）")
                break
            print(f"  retry    {step}（第 {attempt} 次：暫時性錯誤）")
        else:
            state[key] = "failed"
            print(f"  FAILED   {step}（重試 {max_retries} 次仍失敗，發告警）")


def night_run(step, attempt):
    if step == "extract_doctors" and attempt == 1:
        return "transient"            # 來源連線逾時一次，重試就好
    if step == "quality_checks":
        return "bad_data"             # 掛號資料有重複的 id
    return "ok"


def after_fix(step, attempt):
    return "ok"                       # 資料修好之後


run_pipeline("2026-05-05", night_run)   # 凌晨：檢查失敗，mart 與通知都沒跑
run_pipeline("2026-05-05", after_fix)   # 早上重跑同一個批次：只跑失敗的那一步和它的下游
run_pipeline("2026-05-06", after_fix)   # 隔天是另一個批次，狀態互不影響
```

「重跑只跑失敗之後的步驟」有前提：每一步都是冪等的；執行狀態以（批次日期、步驟）為單位記錄；修正如果動到上游（例如要重新抽取），那一步和它的所有下游要一起清掉重跑。重試只對暫時性的錯誤有用；資料本身的問題重試幾次結果都一樣，要有人處理。

這些事通常交給排程或編排工具，各自的定位：

| 工具 | 定位 |
|---|---|
| cron | 在固定時間啟動一個指令。不知道步驟之間的相依，不會重試，也不記錄哪一天跑過；管線只有一兩步時夠用 |
| Airflow | 工作流程排程器：用 Python 定義 DAG，依相依順序執行、重試、告警、依日期區間回補，有介面看每個批次每一步的狀態 |
| Dagster | 同樣是編排工具，以資料資產（一張表、一個檔案）為中心描述相依 |
| dbt | 不是排程工具，是把 SQL 轉換當程式管理：每個模型是一個 `SELECT`，放進版控，依模型之間的引用排出順序，附帶測試與文件。不負責抽取 |

這些工具負責順序、重試、告警、相依與執行紀錄。冪等、分區鍵、品質門檻是管線自己的設計，工具不會代勞：追加式的程式被自動重試三次，資料就重複三次。各工具的功能以官方文件為準。

## 常見錯誤與錯誤訊息

| 現象或錯誤訊息 | 原因 | 怎麼處理 |
|---|---|---|
| 重跑之後數字變成兩倍 | 用 `INSERT` 追加，目的表沒有唯一鍵 | 改成分區覆寫或 upsert；目的表加上粒度的唯一鍵 |
| `duplicate key value violates unique constraint "mart_daily_dept_pkey"` | 有唯一鍵的表被追加式的程式重跑 | 唯一鍵擋下了重複；把寫入改成冪等，不要拿掉鍵 |
| 補跑之後該補的日期還是空的，另一天卻被重算 | 批次日期用 `now()` 或 `current_date` 推算 | 批次日期由排程傳入，程式裡不取現在時間 |
| 修一天的資料要整張表重算 | 沒有分區鍵，看不出哪些列屬於哪個批次 | 批次寫入的表都要有分區鍵 |
| 清晨的掛號被算到前一天 | 時間以 UTC 儲存，切日時直接轉成日期 | 先換成業務時區再取日期 |
| 讀報表的人偶爾看到某一天是空的 | `DELETE` 與 `INSERT` 各自提交，中間有空窗 | 兩步放在同一個交易 |
| 檢查失敗了，錯的數字卻已經在儀表板上 | 檢查排在發布之後 | 檢查放在發布之前，或先寫暫存表、通過才交換 |

開頭那支程式除了追加，還有第二個問題：`current_date - 1`。假設 5/5 凌晨的執行什麼都沒寫入，到 5/6 才補跑，算出來的日期是 5/5，5/4 永遠不會被處理。批次日期要由排程傳入「排定的那一天」，補跑時傳同一個日期。

切日的時區也常被忽略。時間欄位以 UTC 儲存時，直接取日期是照連線的時區設定切，不是照業務的一天：

```sql run
SET TIME ZONE 'UTC';   -- 模擬連線時區是 UTC 的資料庫
CREATE TABLE raw_registrations (id BIGINT PRIMARY KEY, dept_code TEXT, created_at TIMESTAMPTZ NOT NULL);
INSERT INTO raw_registrations VALUES
  (21, 'IM',  '2026-05-04 15:30:00+08'),
  (22, 'IM',  '2026-05-05 06:40:00+08'),   -- 台灣時間 5/5 清晨
  (23, 'SUR', '2026-05-05 07:55:00+08'),
  (24, 'SUR', '2026-05-05 09:10:00+08');

-- 同一批資料，兩種切日方式得到不同的每日筆數
SELECT 'created_at::date（照連線時區）' AS cut, created_at::date::text AS day, count(*) AS registrations
FROM raw_registrations GROUP BY 2
UNION ALL
SELECT 'AT TIME ZONE Asia/Taipei 之後再取日期', (created_at AT TIME ZONE 'Asia/Taipei')::date::text, count(*)
FROM raw_registrations GROUP BY 2
ORDER BY 1, 2;
```

台灣時間 5/5 清晨的兩筆，照 UTC 切會落在 5/4。業務日期的定義（哪個時區、幾點換日）寫在 staging 的轉換裡，只寫一次，後面每一層都用轉換好的日期欄位。

## 動手

1. 執行「冪等的三種寫法」那段 SQL，把步驟 1 的 `SELECT load_…` 多貼幾次，看三張表的合計各是多少。
2. 同一段 SQL，把 `load_overwrite` 裡 `DELETE` 的 `WHERE visit_date = d` 拿掉再執行，看回補之後 5/4 的資料還在不在：刪除與寫入的條件不一致時，分區覆寫會刪掉別的批次。
3. 執行 Python 模擬，把 `night_run` 改成 `stg_registrations` 失敗，看哪些步驟被擋下、哪些照常執行。
4. 做本課的程式題：把每日彙總改成可以重跑的寫法；用一句查詢列出每個批次沒通過的檢查。接著讀 [維度模型](#/skill/dimensional-modeling)，看 mart 層的表怎麼設計。

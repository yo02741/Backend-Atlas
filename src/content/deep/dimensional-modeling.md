## 從一個具體問題開始：各科每月掛號數，JOIN 五張表，答案還不只一個

院長室要一張報表：過去兩年**各科每月的掛號數**。掛號系統（虛構）的資料庫照 [資料建模與正規化](#/skill/data-modeling) 的原則設計，每件事實只存一份，所以查詢長這樣：

```sql
-- 交易系統的正規化表：掛號 → 診次 → 醫師 → 科別，狀態另有代碼表
SELECT date_trunc('month', s.slot_date) AS month, dp.name AS dept, count(*) AS appointments
FROM appointments a
JOIN slots s                 ON s.id = a.slot_id        -- 診次：哪位醫師、哪一天、哪個時段
JOIN doctors d               ON d.id = s.doctor_id
JOIN departments dp          ON dp.id = d.dept_id
JOIN appointment_statuses st ON st.id = a.status_id
WHERE st.code <> 'void'
GROUP BY 1, 2;
```

這句查詢有兩個問題。

第一個看得到：五張表的 JOIN 掃兩年的掛號，跑在線上的交易資料庫，會和櫃台的掛號作業搶資源。每換一個問法（按院區、按初複診、按星期幾），又要重新想一次該 JOIN 哪些表。

第二個比較隱蔽。王醫師（代號 D012）在 2025 年 7 月 1 日從一般內科轉到心臟內科，異動當天 `doctors.dept_id` 被更新。交易系統只需要知道王醫師**現在**在哪一科，這樣做沒有錯。但報表查詢是拿現在的 `dept_id` 去歸類**過去**的掛號：

| 2025 年 6 月的掛號數（示意，和下面的範例一致） | 一般內科 | 心臟內科 |
|---|---|---|
| 6 月底出的月報 | 5 | 1 |
| 7 月之後重跑同一句查詢 | 2 | 4 |

已經發出去的月報和現在查到的數字不同，而且沒有任何一筆資料被改錯。哪一個才對，要看問的是「6 月時一般內科看了多少診」，還是「以現在的編制回頭看，各科的醫師過去看了多少診」。交易資料庫只答得出第二個，因為它沒有留下當時的科別。

分析用的資料表要另外設計。這套設計方法叫**維度模型**（dimensional modeling），最常被引用的書是 Ralph Kimball 的《The Data Warehouse Toolkit》。

## 事實表與維度表

維度模型把資料分成兩種表：

| | 事實表 fact table | 維度表 dimension table |
|---|---|---|
| 記什麼 | 發生過的事件，以及事件上量得到的數字 | 描述事件的人、事、時、地 |
| 一列是 | 一筆掛號、一次批價、某一天的在院人數 | 一位醫師、一個科別、一天 |
| 欄位 | 指向各維度的外鍵，加上數字 | 描述性的屬性：名稱、類別、層級 |
| 形狀 | 列很多、欄位少，通常只增不改 | 列少、欄位多，偶爾會變 |
| 在查詢裡 | 被 `SUM`、`COUNT` | 出現在 `WHERE` 與 `GROUP BY` |

### 先定粒度

設計事實表的第一步是定**粒度**（grain）：一列代表什麼，用一句話講完，例如「一列是一筆掛號」。粒度定了，才知道哪些維度掛得上去、哪些數字放得進來。常見的設計順序是：選一個業務流程（掛號）→ 定粒度 → 列出這個粒度下的維度（日期、醫師、身分別）→ 列出數字（掛號數、掛號費）。

同一張事實表只能有一種粒度。表裡同時有「一筆掛號」的列和「每日小計」的列，`SUM` 就會重複計算。粒度盡量取最細的：細的可以彙總成粗的，反過來不行。

### 數字能不能加總

| 種類 | 意思 | 例子 | 怎麼處理 |
|---|---|---|---|
| 可加總 additive | 沿任何維度加起來都有意義 | 掛號數、掛號費 | 直接 `SUM` |
| 半可加總 semi-additive | 可以跨科別加，不能跨時間加 | 每日結束時的在院人數、庫存、餘額 | 跨時間用平均或取期末 |
| 不可加總 non-additive | 加起來沒有意義 | 取消率、平均等候時間 | 存分子與分母，比率在查詢的最後一步算 |

```sql run
-- 一列是「某一天結束時、某一科的在院人數」（虛構資料）
CREATE TABLE fact_daily_census (census_date DATE, dept_name TEXT, inpatients INT, PRIMARY KEY (census_date, dept_name));
INSERT INTO fact_daily_census VALUES
  ('2025-06-01', '一般內科', 40), ('2025-06-01', '心臟內科', 25),
  ('2025-06-02', '一般內科', 42), ('2025-06-02', '心臟內科', 24),
  ('2025-06-03', '一般內科', 38), ('2025-06-03', '心臟內科', 27);

-- 跨科別加總有意義：6/3 全院在院 65 人
SELECT census_date::text AS census_date, sum(inpatients) AS inpatients FROM fact_daily_census GROUP BY census_date ORDER BY 1;

-- 跨日期加總沒有意義：120 不是任何一天的人數。跨時間要用平均，或取期末那一天
SELECT dept_name,
       sum(inpatients)                                           AS wrong_sum,
       round(avg(inpatients), 1)                                 AS daily_average,
       max(inpatients) FILTER (WHERE census_date = '2025-06-03') AS period_end
FROM fact_daily_census GROUP BY dept_name ORDER BY dept_name;
```

比率為什麼不能直接平均，[Semantic Layer](#/skill/semantic-layer) 有例子。

### 維度表與代理鍵

維度表放描述性的欄位，而且**刻意不正規化**：醫師維度裡直接放科別名稱與院區名稱，查詢時少一層 JOIN。

維度表的主鍵用**代理鍵**（surrogate key）：倉儲自己產生、沒有業務意義的整數。來源系統的醫師代號（自然鍵）留作一般欄位。這樣做有三個原因：

- 同一位醫師在維度表裡可能有好幾列（後面的 Type 2），自然鍵不唯一。
- 來源系統的代號可能重編，不同來源的代號也可能相同。
- 可以放來源裡沒有的列，例如一列「未知」。事實的維度缺值時指向這一列而不是放 NULL，`JOIN` 就不會掉列，報表上也看得到「未知」有多少。

另外幾個名詞：

- **退化維度**（degenerate dimension）：掛號單號這種沒有其他屬性的識別碼，直接留在事實表，不另建維度表。
- 事實表有三種：**交易事實表**一列是一個事件（一筆掛號）；**週期快照**一列是固定週期結束時的狀態（上面的每日在院人數）；**累積快照**一列是一個流程，隨進度填上各階段的時間（掛號、報到、看診、批價）。

## 星狀、雪花與寬表

```text
                    dim_date
                       │
dim_patient_type ── fact_appointments ── dim_doctor（含科別、院區名稱）
                       │
                    dim_room
```

| 形狀 | 做法 | 優點 | 代價 |
|---|---|---|---|
| 星狀綱要 star schema | 事實表在中間，每個維度一張不正規化的表 | JOIN 只有一層，查詢的寫法固定 | 維度屬性重複儲存；維度表小，通常不成問題 |
| 雪花綱要 snowflake | 維度再正規化：醫師、科別、院區各一張 | 屬性只存一份 | JOIN 變多，回到開頭的問題 |
| 寬表 | 維度屬性全部攤進事實表 | 不用 JOIN，分析工具容易接 | 屬性一改要重寫大量的列；不同粒度的事實放不進同一張 |

常見的做法是以星狀綱要為主，寬表從星狀綱要再產生出來給特定報表用。Data Vault 是另一種建模方法，重點在整合多個來源與保留變更歷史，常放在星狀綱要的上游，這裡不展開。

## 日期維度

幾乎每張事實表都有日期。**日期維度**是一天一列的表，把報表會用到的屬性先算好：年、月、季、星期幾、是否週末、是否假日、會計年度。

年與月用日期函式也算得出來，但「是否停診」「會計年度從幾月開始」算不出來，只能查表。屬性集中在一張表，所有報表對「週」「季」的定義就一致。日期維度的鍵常用 `20250603` 這種整數或直接用日期，是少數鍵本身有意義的維度。未來的日期事先產生好，假日每年更新。

## 緩慢變動維度（SCD）

維度的屬性會變，只是變得慢：醫師換科、科別改名、院區調整。**緩慢變動維度**（slowly changing dimension，SCD）是處理這類變更的幾種固定做法：

| 型別 | 做法 | 歷史 | 適合 |
|---|---|---|---|
| Type 1 | 直接覆寫舊值 | 不保留；過去的事實改用新值歸類 | 更正錯字、補齊缺值，或業務上只在乎現況 |
| Type 2 | 舊的那一列標記失效，新增一列新版本，各有自己的代理鍵 | 完整保留；每筆事實指向發生當時的版本 | 換科這類會改變歷史報表歸屬的變更 |
| Type 3 | 加一個欄位存前一個值 | 只留上一個值 | 只需要新舊對照時，較少見 |

Type 2 的維度多三個欄位：生效日 `valid_from`、失效日 `valid_to`、是否現行 `is_current`。王醫師換科之後有兩列：

| doctor_key | doctor_id | dept_name | valid_from | valid_to | is_current |
|---|---|---|---|---|---|
| 1 | D012 | 一般內科 | 2020-01-01 | 2025-07-01 | false |
| 4 | D012 | 心臟內科 | 2025-07-01 | 9999-12-31 | true |

幾個要決定的地方：

- **區間用左閉右開**：`valid_from <= 日期 AND 日期 < valid_to`，舊版本的 `valid_to` 等於新版本的 `valid_from`，任何一天都剛好落在一個版本裡。兩端都包含的寫法，在換版那天容易重疊或留下空隙。
- **現行版本的 `valid_to`** 放一個很遠的日期或 NULL。放遠的日期，查詢條件不必另外處理 NULL。
- **事實表存代理鍵**。載入事實時，用事件日期當天有效的版本查出代理鍵；之後的查詢只用代理鍵 JOIN，不必再寫日期條件。
- **逐欄決定型別**。姓名更正用 Type 1（所有版本一起改），換科用 Type 2。每個欄位都用 Type 2，版本數會暴增。
- **關閉舊列與插入新列在同一個交易**，否則會出現兩列現行，或沒有現行。

下面建一組小的星狀綱要，走一遍換科前後的過程：

```sql run
-- 日期維度：一天一列，屬性先算好；停診日這種屬性沒辦法從日期推算，只能查表
CREATE TABLE dim_date (
  date_key   INT PRIMARY KEY,          -- 20250603 這種整數
  full_date  DATE NOT NULL UNIQUE,
  year_month TEXT NOT NULL,
  is_weekend BOOLEAN NOT NULL,
  is_closed  BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO dim_date (date_key, full_date, year_month, is_weekend)
SELECT to_char(d, 'YYYYMMDD')::int, d::date, to_char(d, 'YYYY-MM'), extract(isodow FROM d) >= 6
FROM generate_series(DATE '2025-01-01', DATE '2025-12-31', INTERVAL '1 day') AS d;
UPDATE dim_date SET is_closed = true WHERE full_date = '2025-06-16';   -- 虛構的院慶停診日

-- 醫師維度（Type 2）：doctor_key 是代理鍵，一個版本一個；doctor_id 是來源系統的醫師代號
CREATE TABLE dim_doctor (
  doctor_key  INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doctor_id   TEXT NOT NULL,
  doctor_name TEXT NOT NULL,
  dept_name   TEXT NOT NULL,
  valid_from  DATE NOT NULL,                        -- 這個版本從哪天開始有效（含）
  valid_to    DATE NOT NULL DEFAULT '9999-12-31',   -- 到哪天為止（不含）；現行版本放一個很遠的日期
  is_current  BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX dim_doctor_one_current ON dim_doctor (doctor_id) WHERE is_current;   -- 每位醫師最多一列現行
INSERT INTO dim_doctor (doctor_id, doctor_name, dept_name, valid_from) VALUES
  ('D012', '王醫師', '一般內科', '2020-01-01'),
  ('D031', '李醫師', '一般內科', '2020-01-01'),
  ('D047', '陳醫師', '心臟內科', '2020-01-01');

-- 事實表：粒度是「一列一筆掛號」。外鍵指向維度，其餘是可以加總的數字
CREATE TABLE fact_appointments (
  appt_no    BIGINT PRIMARY KEY,                -- 掛號單號：退化維度，沒有對應的維度表
  date_key   INT NOT NULL REFERENCES dim_date,
  doctor_key INT NOT NULL REFERENCES dim_doctor,
  appt_count INT NOT NULL DEFAULT 1,
  fee        INT NOT NULL
);

-- 來源（staging）只有醫師代號與看診日
CREATE TABLE stg_appointments (appt_no BIGINT PRIMARY KEY, doctor_id TEXT NOT NULL, visit_date DATE NOT NULL, fee INT NOT NULL);
INSERT INTO stg_appointments VALUES
  (1001, 'D012', '2025-06-03', 150), (1002, 'D012', '2025-06-10', 150), (1003, 'D012', '2025-06-24', 150),
  (1004, 'D031', '2025-06-05', 150), (1005, 'D031', '2025-06-19', 150), (1006, 'D047', '2025-06-12', 200),
  (1007, 'D012', '2025-08-05', 200), (1008, 'D012', '2025-08-19', 200),
  (1009, 'D031', '2025-08-07', 150), (1010, 'D031', '2025-08-21', 150), (1011, 'D047', '2025-08-14', 200);

-- 載入事實表：用「看診日當天有效的版本」查出代理鍵。先刪再寫，同一段日期可以重跑
CREATE FUNCTION load_appointments(from_date DATE, to_date DATE) RETURNS BIGINT LANGUAGE sql AS $$
  DELETE FROM fact_appointments f USING dim_date dd
  WHERE dd.date_key = f.date_key AND dd.full_date >= from_date AND dd.full_date < to_date;
  WITH ins AS (
    INSERT INTO fact_appointments (appt_no, date_key, doctor_key, fee)
    SELECT s.appt_no, dd.date_key, d.doctor_key, s.fee
    FROM stg_appointments s
    JOIN dim_date dd  ON dd.full_date = s.visit_date
    JOIN dim_doctor d ON d.doctor_id = s.doctor_id
                     AND s.visit_date >= d.valid_from AND s.visit_date < d.valid_to
    WHERE s.visit_date >= from_date AND s.visit_date < to_date
    RETURNING 1
  ) SELECT count(*) FROM ins;
$$;

-- 報表查詢：事實表 JOIN 維度、GROUP BY 維度的屬性、加總。換別的問法只是換 GROUP BY 的欄位
CREATE VIEW monthly_by_dept AS
SELECT dd.year_month, d.dept_name, sum(f.appt_count) AS appointments, sum(f.fee) AS fee
FROM fact_appointments f
JOIN dim_date dd  ON dd.date_key = f.date_key
JOIN dim_doctor d ON d.doctor_key = f.doctor_key
GROUP BY dd.year_month, d.dept_name;

-- 1. 6 月底：載入 6 月，出月報
SELECT load_appointments('2025-06-01', '2025-07-01') AS loaded;
SELECT '6 月底的月報' AS report, * FROM monthly_by_dept ORDER BY year_month, dept_name;

-- 2. 7/1 王醫師由一般內科轉到心臟內科。Type 2：關閉舊版本、插入新版本，同一個交易
BEGIN;
UPDATE dim_doctor SET valid_to = '2025-07-01', is_current = false WHERE doctor_id = 'D012' AND is_current;
INSERT INTO dim_doctor (doctor_id, doctor_name, dept_name, valid_from) VALUES ('D012', '王醫師', '心臟內科', '2025-07-01');
COMMIT;
SELECT doctor_key, doctor_id, dept_name, valid_from::text AS valid_from, valid_to::text AS valid_to, is_current
FROM dim_doctor ORDER BY doctor_id, valid_from;

-- 3. 8 月底：載入 8 月。王醫師 8 月的掛號查到的是新版本的代理鍵
SELECT load_appointments('2025-08-01', '2025-09-01') AS loaded;

-- 4. Type 2 的答案：6 月的數字和當時的月報一樣，歷史留在當時的科別
SELECT 'Type 2：當時的科別' AS answer, * FROM monthly_by_dept ORDER BY year_month, dept_name;

-- 5. Type 1 的答案：如果變更時直接覆寫，每個版本看到的都是現在的科別。6 月一般內科從 5 變成 2
SELECT 'Type 1：現在的科別' AS answer, dd.year_month, cur.dept_name, sum(f.appt_count) AS appointments, sum(f.fee) AS fee
FROM fact_appointments f
JOIN dim_date dd    ON dd.date_key = f.date_key
JOIN dim_doctor d   ON d.doctor_key = f.doctor_key
JOIN dim_doctor cur ON cur.doctor_id = d.doctor_id AND cur.is_current
GROUP BY dd.year_month, cur.dept_name
ORDER BY dd.year_month, cur.dept_name;

-- 6. 常見錯誤：用醫師代號 JOIN Type 2 維度卻沒有時間條件，王醫師的每筆掛號各對到兩個版本
SELECT (SELECT count(*) FROM stg_appointments) AS appointments,
       (SELECT count(*) FROM stg_appointments s JOIN dim_doctor d ON d.doctor_id = s.doctor_id) AS joined_rows;
```

依序看結果：

- **步驟 1 與 4**：6 月的數字在換科前後都是一般內科 5、心臟內科 1。事實表裡 6 月的列指向代理鍵 1（一般內科的版本），那一列沒有被改過。
- **步驟 5**：同一張事實表，改成接到每位醫師的現行版本，6 月變成一般內科 2、心臟內科 4。這就是 Type 1 覆寫會得到的結果。兩個數字都算得出來，是因為 Type 2 把版本留下來了；如果維度當初用 Type 1 覆寫，5 與 1 就再也算不出來。
- **步驟 6**：11 筆掛號 JOIN 之後變成 16 列。王醫師的 5 筆掛號各對到兩個版本，多出 5 列。這種錯不會有錯誤訊息，只是數字變大。

報表要用哪一種歸類，是業務問題，不是技術問題。維度模型的責任是讓兩種都算得出來，並且讓每張報表明講用的是哪一種。

## 和正規化模型、語意層、管線的關係

| | 交易系統的正規化模型 | 維度模型 |
|---|---|---|
| 為什麼而設計 | 寫入：每件事實只存一份，更新不會不一致 | 查詢：JOIN 少、容易懂、可以彙總 |
| 典型的操作 | 讀寫少數幾列，交易很短 | 掃大量的列做彙總 |
| 重複的資料 | 盡量消除 | 維度表刻意重複 |
| 歷史 | 多半只留現況 | 事實只增不改，維度用 SCD 留版本 |
| 資料怎麼來 | 應用程式寫入 | 管線從交易系統轉換後載入 |

兩者不是互相取代：交易系統繼續用正規化模型，維度模型是它的下游。[資料建模與正規化](#/skill/data-modeling) 提到訂單品項要存成交當下的單價，是同一個想法在交易系統裡的做法：事實要記錄發生當時的值。

- **管線**：維度模型放在 mart 層，由 [批次管線](#/skill/data-pipelines) 建立。先載入維度、再載入事實，因為事實要查代理鍵；事實表依日期做分區覆寫，可以重跑。倉儲、資料湖與 lakehouse 的差別見 [資料治理](#/skill/data-governance)。
- **語意層**：[Semantic Layer](#/skill/semantic-layer) 的指標定義在事實表的數字上，維度對應維度表的屬性，指標的粒度就是事實表的粒度。星狀綱要決定哪些指標能用哪些維度切，定義層再補上排除條件與負責人。

## 常見錯誤

| 現象 | 原因 | 怎麼處理 |
|---|---|---|
| 換科之後，以前月份的數字變了 | 維度用 Type 1 覆寫，或事實表存的是自然鍵 | 要保留歷史的屬性用 Type 2，事實表存代理鍵 |
| JOIN 醫師維度之後掛號數變多 | 用自然鍵 JOIN Type 2 維度，沒有時間條件 | 用代理鍵 JOIN；只能用自然鍵時加上區間條件 |
| 換版當天的掛號算了兩次，或不見了 | 區間兩端都包含，或兩個版本之間有空隙 | 左閉右開，舊版本的失效日等於新版本的生效日 |
| `duplicate key value violates unique constraint "dim_doctor_one_current"` | 沒有先關閉舊列就插入新的現行列，或同一筆變更被套用兩次 | 先關閉再插入，同一個交易；套用前先比對屬性是否真的變了 |
| 月報的在院人數大得不合理 | 半可加總的數字跨日期 `SUM` | 跨時間取平均或期末值 |
| 全院取消率不等於各科取消率的平均 | 把比率存進事實表再彙總 | 存分子與分母 |
| 加總的數字重複 | 事實表混了不同粒度的列，或 JOIN 了粒度更細的表 | 一張事實表一種粒度；先彙總再 JOIN |
| 報表的總數比事實表的列數少 | 事實的維度鍵是 NULL，`JOIN` 把列丟了 | 維度表放一列「未知」，缺值的事實指向它 |

## 動手

1. 執行星狀綱要那段 SQL，比較步驟 4 與步驟 5 的 6 月數字。
2. 在步驟 2 的 `BEGIN` 之後把 `UPDATE` 那一行拿掉再執行，看部分唯一索引回報什麼錯誤。
3. 把 `load_appointments` 裡的 `s.visit_date < d.valid_to` 改成 `<=`，在 `stg_appointments` 加一筆王醫師 `2025-07-01` 的掛號，步驟 3 的起日也改成 `'2025-07-01'`。換版當天同時符合兩個版本，同一個掛號單號要寫入兩次，被事實表的主鍵擋下。
4. 用 `dim_date` 的屬性換一個問法，例如平日與週末各有幾筆掛號：查詢只要把 `GROUP BY` 換成 `dd.is_weekend`。
5. 做本課的程式題：用看診當天有效的版本彙總各科每月掛號數；把一批醫師異動套成 Type 2。

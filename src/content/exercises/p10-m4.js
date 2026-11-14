// 程式題：P10 新課（m4 批）——data-pipelines、dimensional-modeling
// SQL 題的資料表都由 setup 建立（虛構的掛號與醫師資料，沒有真實個資）

// 掛號明細 → 每日各科彙總；5/4 的批次（run 42）跑到一半失敗，留下不完整的列
const DAILY_STATS = `
CREATE TABLE registrations (
  id         BIGINT PRIMARY KEY,
  visit_date DATE NOT NULL,
  dept_code  TEXT NOT NULL,
  status     TEXT NOT NULL          -- booked / completed / cancelled / void
);
CREATE TABLE daily_dept_stats (
  visit_date    DATE NOT NULL,
  dept_code     TEXT NOT NULL,
  registrations INT NOT NULL,       -- 掛號數，不含作廢單
  cancellations INT NOT NULL,       -- 其中已取消的筆數
  run_id        INT NOT NULL,       -- 最後一次寫入這一列的執行編號
  PRIMARY KEY (visit_date, dept_code)
);
INSERT INTO registrations VALUES
  (1,  '2026-05-03', 'IM',  'completed'),
  (2,  '2026-05-03', 'IM',  'cancelled'),
  (3,  '2026-05-03', 'SUR', 'completed'),
  (4,  '2026-05-04', 'IM',  'completed'),
  (5,  '2026-05-04', 'IM',  'completed'),
  (6,  '2026-05-04', 'IM',  'cancelled'),
  (7,  '2026-05-04', 'IM',  'void'),
  (8,  '2026-05-04', 'SUR', 'completed'),
  (9,  '2026-05-04', 'SUR', 'cancelled'),
  (10, '2026-05-04', 'PED', 'completed'),
  (11, '2026-05-04', 'PED', 'completed'),
  (12, '2026-05-05', 'IM',  'booked'),
  (13, '2026-05-05', 'SUR', 'booked');
INSERT INTO daily_dept_stats VALUES
  ('2026-05-03', 'IM',  2, 1, 41),
  ('2026-05-03', 'SUR', 1, 0, 41),
  ('2026-05-04', 'IM',  2, 0, 42),
  ('2026-05-04', 'SUR', 1, 0, 42);
`

// 七個批次的 staging 與已發布的 mart，其中幾批有問題
const BATCH_QUALITY = `
CREATE TABLE batches (batch_date DATE PRIMARY KEY);          -- 排程應該跑過的批次
CREATE TABLE stg_registrations (                             -- staging 照來源原樣載入，沒有主鍵
  batch_date DATE NOT NULL,
  id         BIGINT NOT NULL,
  dept_code  TEXT,
  status     TEXT NOT NULL
);
CREATE TABLE mart_daily_dept (
  visit_date    DATE NOT NULL,
  dept_code     TEXT NOT NULL,
  registrations INT NOT NULL,
  PRIMARY KEY (visit_date, dept_code)
);
INSERT INTO batches VALUES ('2026-05-01'), ('2026-05-02'), ('2026-05-03'), ('2026-05-04'), ('2026-05-05'), ('2026-05-06'), ('2026-05-07');
INSERT INTO stg_registrations VALUES
  ('2026-05-01', 101, 'IM',  'completed'),
  ('2026-05-01', 102, 'IM',  'completed'),
  ('2026-05-01', 103, 'SUR', 'cancelled'),
  ('2026-05-02', 111, 'IM',  'completed'),
  ('2026-05-02', 111, 'IM',  'completed'),
  ('2026-05-02', 112, 'SUR', 'completed'),
  ('2026-05-02', 112, 'SUR', 'completed'),
  ('2026-05-02', 113, 'PED', 'completed'),
  ('2026-05-03', 121, 'IM',  'completed'),
  ('2026-05-03', 122, NULL,  'completed'),
  ('2026-05-03', 123, 'SUR', 'completed'),
  ('2026-05-05', 141, 'IM',  'completed'),
  ('2026-05-05', 142, 'IM',  'cancelled'),
  ('2026-05-05', 143, 'PED', 'completed'),
  ('2026-05-06', 151, 'SUR', 'completed'),
  ('2026-05-06', 152, '  ',  'completed'),
  ('2026-05-07', 161, 'IM',  'completed'),
  ('2026-05-07', 162, 'PED', 'completed');
INSERT INTO mart_daily_dept VALUES
  ('2026-05-01', 'IM',  2), ('2026-05-01', 'SUR', 1),
  ('2026-05-02', 'IM',  2), ('2026-05-02', 'SUR', 2), ('2026-05-02', 'PED', 1),
  ('2026-05-03', 'IM',  1), ('2026-05-03', 'SUR', 1),
  ('2026-05-05', 'IM',  4), ('2026-05-05', 'PED', 2),
  ('2026-05-07', 'IM',  1), ('2026-05-07', 'PED', 1);
`

// Type 2 的醫師維度與還沒載入事實表的掛號
const DOCTOR_VERSIONS = `
CREATE TABLE dim_doctor (
  doctor_key  INT PRIMARY KEY,      -- 代理鍵：一個版本一個
  doctor_id   TEXT NOT NULL,        -- 來源系統的醫師代號
  doctor_name TEXT NOT NULL,
  dept        TEXT NOT NULL,
  valid_from  DATE NOT NULL,        -- 這個版本從哪天開始有效（含）
  valid_to    DATE NOT NULL,        -- 到哪天為止（不含）；現行版本是 9999-12-31
  is_current  BOOLEAN NOT NULL
);
CREATE TABLE stg_appointments (appt_no BIGINT PRIMARY KEY, doctor_id TEXT NOT NULL, visit_date DATE NOT NULL);
INSERT INTO dim_doctor VALUES
  (1, 'D012', '王醫師', 'IM',  '2024-01-01', '2026-04-01', false),
  (2, 'D012', '王醫師', 'CV',  '2026-04-01', '9999-12-31', true),
  (3, 'D031', '李醫師', 'SUR', '2024-01-01', '9999-12-31', true),
  (4, 'D047', '陳醫師', 'PED', '2025-03-01', '2026-03-16', false),
  (5, 'D047', '陳醫師', 'NEO', '2026-03-16', '9999-12-31', true);
INSERT INTO stg_appointments VALUES
  (3001, 'D012', '2026-03-10'), (3002, 'D012', '2026-03-20'), (3003, 'D012', '2026-03-31'),
  (3004, 'D012', '2026-04-01'), (3005, 'D012', '2026-04-15'),
  (3006, 'D031', '2026-03-05'), (3007, 'D031', '2026-04-02'), (3008, 'D031', '2026-04-20'),
  (3009, 'D047', '2026-03-02'), (3010, 'D047', '2026-03-15'), (3011, 'D047', '2026-03-16'),
  (3012, 'D047', '2026-03-30'), (3013, 'D047', '2026-04-08');
`

// Type 2 的醫師維度與來源系統 2026-07-01 的現況
const DOCTOR_CHANGES = `
CREATE TABLE dim_doctor (
  doctor_key  INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doctor_id   TEXT NOT NULL,
  doctor_name TEXT NOT NULL,
  dept        TEXT NOT NULL,
  valid_from  DATE NOT NULL,
  valid_to    DATE NOT NULL DEFAULT '9999-12-31',
  is_current  BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX dim_doctor_one_current ON dim_doctor (doctor_id) WHERE is_current;   -- 每位醫師最多一列現行
CREATE TABLE stg_doctors (doctor_id TEXT PRIMARY KEY, doctor_name TEXT NOT NULL, dept TEXT NOT NULL);
INSERT INTO dim_doctor (doctor_id, doctor_name, dept, valid_from, valid_to, is_current) VALUES
  ('D012', '王醫師', 'IM',  '2024-01-01', '9999-12-31', true),
  ('D031', '李醫師', 'SUR', '2024-01-01', '2025-09-01', false),
  ('D031', '李醫師', 'ER',  '2025-09-01', '9999-12-31', true),
  ('D047', '陳醫師', 'PED', '2025-03-01', '9999-12-31', true);
INSERT INTO stg_doctors VALUES
  ('D012', '王醫師', 'CV'),
  ('D031', '李醫師', 'ER'),
  ('D047', '陳醫師', 'PED'),
  ('D058', '林醫師', 'IM');
`

export default [
  {
    id: 'data-pipelines-1', skill: 'data-pipelines', kind: 'sql', level: 2,
    title: '把每日彙總改成可以重跑',
    prompt: '`registrations` 是掛號明細（虛構資料），`daily_dept_stats` 是每日各科彙總，主鍵是 `(visit_date, dept_code)`。批次日期 **2026-05-04** 的排程（`run_id` 42）跑到一半失敗，表裡留下不完整的列；5/3 的列是之前的批次（`run_id` 41）寫的，內容正確。\n\n寫 SQL 重跑 2026-05-04 這個批次，這次的 `run_id` 是 **43**：\n\n- 5/4 每個科別一列：`registrations` 是掛號數（不含 `status = \'void\'` 的作廢單），`cancellations` 是其中 `status = \'cancelled\'` 的筆數，`run_id` 寫 43。\n- 只動 5/4 這個分區：其他日期的列不能改，也不要寫入其他日期。\n- 要可以重跑：整段 SQL 連續執行幾次，結果都要相同。做法二選一：同一個交易裡刪掉 5/4 的列再寫入，或用 `INSERT … ON CONFLICT (visit_date, dept_code) DO UPDATE`。\n\n起始碼是原本的追加式寫法，表裡已經有上次留下的列，一執行就撞到主鍵。交卷時會查 `daily_dept_stats` 的內容。',
    setup: DAILY_STATS, setupKey: 'p10-daily-stats',
    starter: `-- 原本的寫法：直接追加。5/4 已經有上次留下的列，重跑就撞到主鍵；作廢單也被算進去了
INSERT INTO daily_dept_stats (visit_date, dept_code, registrations, cancellations, run_id)
SELECT visit_date, dept_code, count(*), count(*) FILTER (WHERE status = 'cancelled'), 43
FROM registrations
WHERE visit_date = DATE '2026-05-04'
GROUP BY visit_date, dept_code;

SELECT * FROM daily_dept_stats ORDER BY visit_date, dept_code;`,
    solution: `-- 分區覆寫：刪除與寫入用同一個日期條件，放在同一個交易
BEGIN;
DELETE FROM daily_dept_stats WHERE visit_date = DATE '2026-05-04';

INSERT INTO daily_dept_stats (visit_date, dept_code, registrations, cancellations, run_id)
SELECT visit_date, dept_code, count(*), count(*) FILTER (WHERE status = 'cancelled'), 43
FROM registrations
WHERE visit_date = DATE '2026-05-04' AND status <> 'void'
GROUP BY visit_date, dept_code;
COMMIT;

SELECT * FROM daily_dept_stats ORDER BY visit_date, dept_code;`,
    expect: {
      query: `SELECT visit_date::text AS visit_date, dept_code, registrations, cancellations, run_id
FROM daily_dept_stats ORDER BY visit_date, dept_code`,
      columns: ['visit_date', 'dept_code', 'registrations', 'cancellations', 'run_id'],
      rows: [
        ['2026-05-03', 'IM', '2', '1', '41'],
        ['2026-05-03', 'SUR', '1', '0', '41'],
        ['2026-05-04', 'IM', '3', '1', '43'],
        ['2026-05-04', 'PED', '2', '0', '43'],
        ['2026-05-04', 'SUR', '2', '1', '43'],
      ],
      ordered: false,
    },
    hints: ['分區覆寫：`BEGIN; DELETE FROM daily_dept_stats WHERE visit_date = DATE \'2026-05-04\'; INSERT …; COMMIT;`，刪除與寫入用同一個日期條件。', '改用 upsert 的話：`ON CONFLICT (visit_date, dept_code) DO UPDATE SET registrations = EXCLUDED.registrations, cancellations = EXCLUDED.cancellations, run_id = EXCLUDED.run_id`。', '作廢單在 `WHERE` 就排除（`AND status <> \'void\'`）；取消數用 `count(*) FILTER (WHERE status = \'cancelled\')`。'],
  },
  {
    id: 'data-pipelines-2', skill: 'data-pipelines', kind: 'sql', level: 3,
    title: '品質檢查：列出沒通過的批次',
    prompt: '`batches` 是排程應該跑過的批次日期，`stg_registrations` 是各批載入 staging 的掛號（虛構資料，照來源原樣，沒有主鍵），`mart_daily_dept` 是已經發布的每日各科掛號數。\n\n建立 view `failed_checks`，欄位是 `batch_date` 與 `check_name`，列出每個批次沒通過的檢查；同一個批次的同一項檢查只出現一列，全部通過的批次不出現。\n\n四項檢查與 `check_name` 的值：\n\n- `empty_batch`：`batches` 裡有這一天，staging 卻一列都沒有\n- `duplicate_id`：同一批裡同一個 `id` 出現超過一次\n- `null_dept`：這一批有列的 `dept_code` 是 NULL、空字串或只有空白\n- `count_mismatch`：這一批在 staging 的列數，不等於 mart 同一天 `registrations` 的合計（哪一邊沒有資料就當成 0）\n\n起始碼只做了一項檢查，而且只抓得到 NULL。交卷時會用 `SELECT * FROM failed_checks` 檢查。',
    setup: BATCH_QUALITY, setupKey: 'p10-batch-quality',
    starter: `-- 只做了一項檢查，而且只抓得到 NULL，抓不到空白
CREATE VIEW failed_checks AS
SELECT DISTINCT batch_date, 'null_dept' AS check_name
FROM stg_registrations
WHERE dept_code IS NULL;

SELECT * FROM failed_checks ORDER BY batch_date, check_name;`,
    solution: `CREATE VIEW failed_checks AS
WITH s AS (
  SELECT batch_date, count(*) AS n FROM stg_registrations GROUP BY batch_date
), m AS (
  SELECT visit_date, sum(registrations) AS n FROM mart_daily_dept GROUP BY visit_date
)
-- 筆數：批次清單裡有、staging 沒有
SELECT b.batch_date, 'empty_batch' AS check_name
FROM batches b LEFT JOIN s ON s.batch_date = b.batch_date
WHERE s.n IS NULL
UNION ALL
-- 唯一性：同一批裡 id 重複
SELECT DISTINCT batch_date, 'duplicate_id'
FROM (SELECT batch_date, id FROM stg_registrations GROUP BY batch_date, id HAVING count(*) > 1) dup
UNION ALL
-- 非空：NULL、空字串、只有空白都算缺值
SELECT DISTINCT batch_date, 'null_dept'
FROM stg_registrations
WHERE NULLIF(btrim(dept_code), '') IS NULL
UNION ALL
-- 對帳：staging 的列數對 mart 的合計，沒有資料的一邊當成 0
SELECT b.batch_date, 'count_mismatch'
FROM batches b
LEFT JOIN s ON s.batch_date = b.batch_date
LEFT JOIN m ON m.visit_date = b.batch_date
WHERE COALESCE(s.n, 0) <> COALESCE(m.n, 0);

SELECT * FROM failed_checks ORDER BY batch_date, check_name;`,
    expect: {
      query: 'SELECT batch_date::text AS batch_date, check_name FROM failed_checks ORDER BY batch_date, check_name',
      columns: ['batch_date', 'check_name'],
      rows: [
        ['2026-05-02', 'duplicate_id'],
        ['2026-05-03', 'count_mismatch'],
        ['2026-05-03', 'null_dept'],
        ['2026-05-04', 'empty_batch'],
        ['2026-05-05', 'count_mismatch'],
        ['2026-05-06', 'count_mismatch'],
        ['2026-05-06', 'null_dept'],
      ],
      ordered: false,
    },
    hints: ['每項檢查寫成一個 `SELECT batch_date, \'名稱\' AS check_name …`，用 `UNION ALL` 接起來。', '`empty_batch` 與 `count_mismatch` 要從 `batches` 出發 `LEFT JOIN`，否則沒有資料的批次不會出現在結果裡；比較前用 `COALESCE(…, 0)`。', '重複：`GROUP BY batch_date, id HAVING count(*) > 1`，外面再 `SELECT DISTINCT batch_date`。缺值：`NULLIF(btrim(dept_code), \'\') IS NULL`。'],
  },
  {
    id: 'dimensional-modeling-1', skill: 'dimensional-modeling', kind: 'sql', level: 2,
    title: '用看診當天有效的版本彙總',
    prompt: '`dim_doctor` 是 Type 2 的醫師維度（虛構資料）：一位醫師每換一次科就多一列，`valid_from` 含、`valid_to` 不含，現行版本的 `valid_to` 是 `9999-12-31`。`stg_appointments` 是還沒載入事實表的掛號，只有醫師代號 `doctor_id` 與看診日 `visit_date`。\n\n查出**各科每月的掛號數**，科別以**看診當天**醫師所屬的科為準。欄位是 `month`（`YYYY-MM` 格式的文字）、`dept`、`appointments`，依 `month`、`dept` 排序。\n\n注意換科當天的掛號：`valid_to` 是不含的，那一天屬於新版本。\n\n起始碼接到每位醫師的現行版本，所有歷史掛號都被算在現在的科別。',
    setup: DOCTOR_VERSIONS, setupKey: 'p10-doctor-versions',
    starter: `-- 接到現行版本：王醫師 3 月還在 IM，這裡卻全部算成 CV
SELECT to_char(s.visit_date, 'YYYY-MM') AS month, d.dept, count(*) AS appointments
FROM stg_appointments s
JOIN dim_doctor d ON d.doctor_id = s.doctor_id AND d.is_current
GROUP BY 1, 2
ORDER BY 1, 2;`,
    solution: `SELECT to_char(s.visit_date, 'YYYY-MM') AS month, d.dept, count(*) AS appointments
FROM stg_appointments s
JOIN dim_doctor d ON d.doctor_id = s.doctor_id
                 AND s.visit_date >= d.valid_from      -- 左閉
                 AND s.visit_date <  d.valid_to        -- 右開：換科當天屬於新版本
GROUP BY 1, 2
ORDER BY 1, 2;`,
    expect: {
      columns: ['month', 'dept', 'appointments'],
      rows: [
        ['2026-03', 'IM', '3'],
        ['2026-03', 'NEO', '2'],
        ['2026-03', 'PED', '2'],
        ['2026-03', 'SUR', '1'],
        ['2026-04', 'CV', '2'],
        ['2026-04', 'NEO', '1'],
        ['2026-04', 'SUR', '2'],
      ],
      ordered: true,
    },
    hints: ['JOIN 條件除了 `d.doctor_id = s.doctor_id`，還要限定版本：`s.visit_date >= d.valid_from AND s.visit_date < d.valid_to`。', '不要用 `BETWEEN`：它兩端都包含，換科當天的掛號會同時符合新舊兩個版本，被算兩次。', '月份用 `to_char(s.visit_date, \'YYYY-MM\')`；總數應該等於 `stg_appointments` 的列數（13），可以拿來檢查有沒有多算或漏算。'],
  },
  {
    id: 'dimensional-modeling-2', skill: 'dimensional-modeling', kind: 'sql', level: 3,
    title: '把醫師異動套成 Type 2',
    prompt: '`dim_doctor` 是 Type 2 的醫師維度（虛構資料）：`valid_from` 含、`valid_to` 不含，現行版本的 `valid_to` 是 `9999-12-31`、`is_current` 是 true；部分唯一索引保證每位醫師最多一列現行。`stg_doctors` 是來源系統在 **2026-07-01** 的現況，每位醫師一列。\n\n寫 SQL 把這一天的異動套進維度：\n\n- 科別變了的醫師：把現行那一列關閉（`valid_to` 設成 2026-07-01、`is_current` 設成 false），再插入一列新版本（`valid_from` 是 2026-07-01）。\n- 維度裡還沒有的醫師：插入一列，`valid_from` 是 2026-07-01。\n- 科別沒變的醫師：不動，不能多出新版本。\n- 既有的列不能刪掉重建：事實表靠 `doctor_key` 指向它們。\n- 整段 SQL 再執行一次，結果要相同。\n\n起始碼是 Type 1 的做法：直接覆寫現行列的科別，歷史不見了，新進的醫師也沒有處理。交卷時會查 `dim_doctor` 的內容。',
    setup: DOCTOR_CHANGES, setupKey: 'p10-doctor-changes',
    starter: `-- Type 1 的做法：直接覆寫。王醫師過去的掛號全部變成新科別，新進的醫師也沒有處理
UPDATE dim_doctor d
SET dept = s.dept
FROM stg_doctors s
WHERE s.doctor_id = d.doctor_id AND d.is_current;

SELECT * FROM dim_doctor ORDER BY doctor_id, valid_from;`,
    solution: `BEGIN;
-- 1. 關閉：現行版本的科別和來源不同的醫師
UPDATE dim_doctor d
SET valid_to = DATE '2026-07-01', is_current = false
FROM stg_doctors s
WHERE s.doctor_id = d.doctor_id AND d.is_current AND s.dept <> d.dept;

-- 2. 插入：此時沒有現行列的醫師，包含剛被關閉的與全新的
INSERT INTO dim_doctor (doctor_id, doctor_name, dept, valid_from)
SELECT s.doctor_id, s.doctor_name, s.dept, DATE '2026-07-01'
FROM stg_doctors s
WHERE NOT EXISTS (
  SELECT 1 FROM dim_doctor d WHERE d.doctor_id = s.doctor_id AND d.is_current
);
COMMIT;

SELECT * FROM dim_doctor ORDER BY doctor_id, valid_from;`,
    expect: {
      query: `SELECT doctor_id, dept, valid_from::text AS valid_from, valid_to::text AS valid_to, is_current,
       CASE WHEN doctor_key <= 4 THEN doctor_key ELSE 0 END AS old_key
FROM dim_doctor ORDER BY doctor_id, valid_from`,
      columns: ['doctor_id', 'dept', 'valid_from', 'valid_to', 'is_current', 'old_key'],
      rows: [
        ['D012', 'IM', '2024-01-01', '2026-07-01', 'false', '1'],
        ['D012', 'CV', '2026-07-01', '9999-12-31', 'true', '0'],
        ['D031', 'SUR', '2024-01-01', '2025-09-01', 'false', '2'],
        ['D031', 'ER', '2025-09-01', '9999-12-31', 'true', '3'],
        ['D047', 'PED', '2025-03-01', '9999-12-31', 'true', '4'],
        ['D058', 'IM', '2026-07-01', '9999-12-31', 'true', '0'],
      ],
      ordered: false,
    },
    hints: ['先關閉、再插入：`UPDATE dim_doctor d SET valid_to = DATE \'2026-07-01\', is_current = false FROM stg_doctors s WHERE s.doctor_id = d.doctor_id AND d.is_current AND s.dept <> d.dept`。', '關閉之後，「科別變了的醫師」和「新進的醫師」有同一個特徵：在維度裡沒有現行的列。用 `WHERE NOT EXISTS (SELECT 1 FROM dim_doctor d WHERE d.doctor_id = s.doctor_id AND d.is_current)` 一次插入兩種。', '兩句包在同一個 `BEGIN … COMMIT`。重跑時既沒有科別不同的現行列，也沒有缺現行列的醫師，兩句都不會動到資料。'],
  },
]

// 程式題：DevOps：資料治理與 SQL（資料全是虛構的掛號／住院資料，沒有真實個資）
const HOSP = `
CREATE TABLE departments (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE patients (
  id         BIGINT PRIMARY KEY,
  chart_no   TEXT,
  name       TEXT,
  birth_date DATE,
  sex        TEXT
);
CREATE TABLE registrations (
  id         BIGINT PRIMARY KEY,
  patient_id BIGINT,
  dept_code  TEXT,
  visit_date DATE NOT NULL
);
CREATE TABLE admissions (
  id             BIGINT PRIMARY KEY,
  patient_id     BIGINT NOT NULL,
  admit_date     DATE NOT NULL,
  discharge_date DATE
);
INSERT INTO departments (code, name) VALUES
  ('IM', '內科'), ('SUR', '外科'), ('PED', '兒科'), ('ER', '急診');
INSERT INTO patients (id, chart_no, name, birth_date, sex) VALUES
  (1, 'A0001', '王小明', '1980-03-15', 'M'),
  (2, 'A0002', '李小華', '1992-07-01', 'F'),
  (3, 'A0003', '張大同', NULL, 'M'),
  (4, 'A0002', '李小華', '1992-07-01', 'F'),
  (5, 'A0005', '陳美玲', '1975-11-30', 'F'),
  (6, 'a0005 ', '陳美玲', '1975-11-30', 'F'),
  (7, 'A0007', '黃志強', '1968-09-09', 'M'),
  (8, 'A0008', '', '1988-02-02', 'F'),
  (9, 'A0009', '周小芳', '2003-12-24', NULL);
INSERT INTO registrations (id, patient_id, dept_code, visit_date) VALUES
  (101, 1, 'IM',   '2026-03-02'),
  (102, 2, 'SUR',  '2026-03-02'),
  (103, 3, 'im',   '2026-03-03'),
  (104, 5, 'CARD', '2026-03-03'),
  (105, 7, 'PED',  '2026-03-04'),
  (106, 8, NULL,   '2026-03-04'),
  (107, 9, 'im',   '2026-03-05'),
  (108, 1, 'ER',   '2026-03-06');
INSERT INTO admissions (id, patient_id, admit_date, discharge_date) VALUES
  (1, 1, '2026-03-01', '2026-03-05'),
  (2, 2, '2026-04-10', NULL),
  (3, 5, '2026-05-20', '2026-05-02'),
  (4, 3, '2026-06-01', '2026-06-01'),
  (5, 7, '2026-08-15', NULL),
  (6, 9, '2026-02-28', '2026-03-02');
`

export default [
  {
    id: 'data-governance-1', skill: 'data-governance', kind: 'sql', level: 1,
    title: '找出重複的病歷號（先正規化）',
    prompt: '`patients(id, chart_no, name, birth_date, sex)` 是從來源系統抽來的虛構病人資料。病歷號在業務上應該唯一，但來源系統沒加 UNIQUE，而且有些病歷號混了小寫與前後空白。\n\n找出**正規化後**（去掉前後空白、轉大寫）出現超過一次的病歷號，回 `chart_no`（正規化後的值）與筆數 `n`。\n\n起始碼直接用原始值分組，會漏掉一組。',
    setup: HOSP, setupKey: 'hosp-dq',
    starter: `SELECT chart_no, COUNT(*) AS n
FROM patients
GROUP BY chart_no            -- TODO：原始值分組會漏掉 'a0005 '，先正規化
HAVING COUNT(*) > 1;`,
    solution: `SELECT UPPER(TRIM(chart_no)) AS chart_no, COUNT(*) AS n
FROM patients
GROUP BY UPPER(TRIM(chart_no))
HAVING COUNT(*) > 1;`,
    expect: { columns: ['chart_no', 'n'], rows: [['A0002', '2'], ['A0005', '2']], ordered: false },
    hints: ['TRIM 去掉前後空白，UPPER 轉大寫；兩個可以疊起來用：UPPER(TRIM(chart_no))。', 'SELECT 和 GROUP BY 都要用正規化後的運算式；SELECT 裡記得用 AS chart_no 取別名。'],
  },
  {
    id: 'data-governance-2', skill: 'data-governance', kind: 'sql', level: 1,
    title: '必填欄位缺值（空字串也算）',
    prompt: '病人的 `name`、`birth_date`、`sex` 都是必填。找出任何一個必填欄位缺值的病人，回 `id` 與 `chart_no`。\n\n注意：來源系統有時把「沒填」存成空字串 `\'\'` 或只有空白，而不是 NULL——這也算缺值。',
    setup: HOSP, setupKey: 'hosp-dq',
    starter: `SELECT id, chart_no
FROM patients
WHERE name IS NULL OR birth_date IS NULL;   -- TODO：空字串的姓名、缺值的性別都漏了`,
    solution: `SELECT id, chart_no
FROM patients
WHERE NULLIF(TRIM(name), '') IS NULL
   OR birth_date IS NULL
   OR sex IS NULL;`,
    expect: { columns: ['id', 'chart_no'], rows: [['3', 'A0003'], ['8', 'A0008'], ['9', 'A0009']], ordered: false },
    hints: ['NULLIF(x, \'\') 在 x 等於空字串時回 NULL；先 TRIM 再 NULLIF，只有空白的值也會變成 NULL。', '三個必填欄位用 OR 串起來，任何一個缺就要列出。'],
  },
  {
    id: 'data-governance-3', skill: 'data-governance', kind: 'sql', level: 2,
    title: '科別代碼不在代碼表裡',
    prompt: '掛號紀錄 `registrations(id, patient_id, dept_code, visit_date)` 的科別代碼應該都能對到代碼表 `departments(code, name)`。列出**對不到代碼表**的代碼與各自的筆數，欄位 `dept_code`、`n`。\n\n`dept_code` 是 NULL 的紀錄屬於「缺值」，另外處理，**不要**列在這份報表裡。代碼比對要完全相同（`im` 和 `IM` 不同，要被列出來，交給 steward 決定怎麼修）。',
    setup: HOSP, setupKey: 'hosp-dq',
    starter: `SELECT r.dept_code, COUNT(*) AS n
FROM registrations r
-- TODO：LEFT JOIN 代碼表，只留下對不到的
GROUP BY r.dept_code;`,
    solution: `SELECT r.dept_code, COUNT(*) AS n
FROM registrations r
LEFT JOIN departments d ON d.code = r.dept_code
WHERE d.code IS NULL
  AND r.dept_code IS NOT NULL
GROUP BY r.dept_code;`,
    expect: { columns: ['dept_code', 'n'], rows: [['CARD', '1'], ['im', '2']], ordered: false },
    hints: ['LEFT JOIN departments d ON d.code = r.dept_code，對不到的列 d.code 會是 NULL。', 'dept_code 本身是 NULL 時也對不到，會被當成一組 NULL 列出來——用 r.dept_code IS NOT NULL 排除。'],
  },
  {
    id: 'data-governance-4', skill: 'data-governance', kind: 'sql', level: 2,
    title: '不合理的住院日期',
    prompt: '住院紀錄 `admissions(id, patient_id, admit_date, discharge_date)`。資料截取日是 **2026-06-30**。找出兩種不合理的紀錄，回 `id` 與問題類型 `problem`：\n\n- 出院日早於入院日 → `discharge_before_admit`\n- 入院日晚於資料截取日 → `admit_after_cutoff`\n\n合理的情況不要列出：**當天入院當天出院**（兩個日期相同）是正常的；`discharge_date` 是 NULL 代表還在住院，也正常。',
    setup: HOSP, setupKey: 'hosp-dq',
    starter: `SELECT id, 'discharge_before_admit' AS problem
FROM admissions
WHERE discharge_date <= admit_date;   -- TODO：同日出院是正常的；還少了入院日晚於截取日的檢查`,
    solution: `SELECT id,
       CASE WHEN discharge_date < admit_date THEN 'discharge_before_admit'
            ELSE 'admit_after_cutoff' END AS problem
FROM admissions
WHERE discharge_date < admit_date
   OR admit_date > DATE '2026-06-30';`,
    expect: { columns: ['id', 'problem'], rows: [['3', 'discharge_before_admit'], ['5', 'admit_after_cutoff']], ordered: false },
    hints: ['同一天出入院不算錯，所以是 <，不是 <=。discharge_date 是 NULL 時 discharge_date < admit_date 的結果是 NULL，不會被選到，剛好符合「還在住院不算錯」。', '兩個條件用 OR 選出來，再用 CASE WHEN 依條件給出 problem 的值。日期常數寫成 DATE \'2026-06-30\'。'],
  },
]

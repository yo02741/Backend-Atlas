// 設計情境：數據中台之前（直接建、先全面治理、還是用一個使用案例切片）
export default {
  id: 'data-platform-prep',
  order: 20,
  group: 'ops',
  title: '數據中台之前',
  en: 'Before the data platform',
  level: 2,
  week: 19,
  skills: ['data-governance', 'data-modeling', 'db-operations'],
  lab: 'DataPlatformScenarioLab',
  summary: 'HIS、檢驗、排班三套系統的病歷號、代碼表各說各話。先把資料全搬進中台、先全面治理，還是從一張報表反推要治理的資料？',
  situation: '一家虛構的醫院要做數據中台。資料散在 HIS（掛號、住院、批價）、檢驗系統與院內排班系統：同一位病人在不同系統的病歷號格式不同（`A0012`、`a0012`、前面多一個空白），科別代碼 HIS 用 `CV`、排班系統用 `CARD`，檢驗項目代碼各系統自訂；每月約 2 萬筆門診掛號裡，約 3% 是重複病人、6% 代碼對不到、4% 必填欄位缺值。資訊部資料組 2 人，院長希望半年內看到第一張可信的管理報表。以上數字皆為示意。',
  constraints: [
    '報表的數字要能說明從哪些來源、經過哪些轉換算出來',
    '品質問題要回到來源系統修，不能只在中台裡改',
    '可識別病人的資料進中台後要分級授權；分析人員多半只需要假名化或彙總資料',
    '資料組只有 2 人，各系統的業務單位每週能撥給這件事的時間有限',
  ],
  options: [
    {
      id: 'direct', name: '直接建中台',
      summary: '先把三套系統的資料全部抽進中台（ELT：原樣載入 `raw`，再在中台裡用 SQL 轉換），報表需求來了再處理品質問題。',
      pros: ['最快看到「資料都在一起了」，前三個月就有第一張報表', '原始資料都保留，轉換可以重跑'],
      cons: ['重複病人、代碼不一致、缺值一起進報表，數字對不起來時沒有定義可以對照', '問題多半在中台裡就地修補，下次全量重抽又回來，重工不斷', '含個資的原始資料全部進了中台，權限沒先設計好，風險集中到一處'],
    },
    {
      id: 'govern', name: '先全面治理再建',
      summary: '先盤點所有系統、建資料目錄、指定每個資料集的 owner 與 steward、寫品質規則、做病人與科別的主資料對應，全部到位後再建中台。',
      pros: ['中台一上線，定義、負責人、品質規則都在，報表錯誤最少', '主資料與代碼對應一次做完，後面每張報表都受益'],
      cons: ['半年以上看不到任何成果，期間需求可能改變、支持度下降', '盤點範圍以「全部」為準，部分治理過的欄位最後沒人用，該優先的卻排在後面'],
    },
    {
      id: 'slice', name: '一個使用案例做端到端切片',
      summary: '從一張報表（各科門診人次月報）反推需要的資料：只接 HIS 掛號、病人主檔與科別代碼表，把這一段的定義、負責人、品質規則與 `raw` → `staging` → `mart` 做完，再逐張擴大。',
      pros: ['兩個月內交出第一張可信的報表，定義與血緣跟著一起建', '治理範圍跟著真實需求長，優先順序自然排好', '每一刀都是完整的一條線，問題在小範圍就暴露'],
      cons: ['早期的主資料與代碼對應只涵蓋第一刀，擴大時常要回頭修訂', '全院層級的資料目錄與分級要到後期才完整，需要有人盯著不讓切片各做各的'],
    },
  ],
  tradeoffs: {
    axes: ['第一個可用成果', '報表正確性', '重工', '治理覆蓋', '業務單位投入'],
    rows: [
      { option: 'direct', cells: ['快：約 3 個月，但數字未必可信', '差：品質問題直接進報表', '高：中台裡修、重抽又回來', '低：零散修補，沒有寫下來', '低，直到報表被質疑'] },
      { option: 'govern', cells: ['慢：半年以上', '好：上線就有規則', '低，但部分治理用不到', '高', '高：全部系統同時要人'] },
      { option: 'slice', cells: ['快：約 2 個月，而且可信', '好：已切片的範圍內', '中：主資料擴大時回頭修訂', '隨切片逐步提高', '中：一次只找一兩個單位'] },
    ],
  },
  decisions: [
    { id: 'first-report', situation: '院長要求三個月內交出「各科門診人次」與「平均住院天數」兩張可信報表；資料組 2 人，目前沒有任何資料目錄。',
      options: ['direct', 'govern', 'slice'], answer: 'slice',
      explain: '時間短、人手少，又要「可信」：從這兩張報表反推需要的資料（掛號、住院、病人主檔、科別代碼表），只治理這一段。直接建中台三個月內出得了報表，但重複病人與代碼不一致會讓數字被質疑；全面治理則交不出東西。' },
    { id: 'mature', situation: '另一家醫院已經有資料目錄、每個資料集都有 owner 與品質規則，病人與科別的主資料也已統一；缺的是集中儲存與排程，讓分析人員不必再各自找系統要資料。',
      options: ['direct', 'govern', 'slice'], answer: 'direct',
      explain: '治理的前提已經到位，中台把資料集中時不會把混亂一起搬進來。這時直接建置 `raw` / `staging` / `mart` 的管線與權限分區就好，再切片或再治理一輪都是重複投入。' },
    { id: 'merge', situation: '兩家醫院合併，要把兩套 HIS 的病人資料整合成同一個病人主檔，之後所有報表、跨院轉診與病歷調閱都要以它為準。',
      options: ['direct', 'govern', 'slice'], answer: 'govern',
      explain: '病人主檔是所有下游的地基：比對與合併規則、權威來源、由誰確認合併結果，要在任何報表之前定好。切片只看單一報表，很可能做出只適合那張報表的合併規則；直接建則會讓兩院的病人在中台裡變成兩倍。' },
  ],
  implementation: [
    { title: '第一刀的品質檢查（PostgreSQL）', lang: 'sql', code: `-- 只檢查「各科門診人次」這一刀用到的資料；每條都能排進每日排程
-- 1. 唯一性：先正規化病歷號再找重複
SELECT UPPER(TRIM(chart_no)) AS chart_no, COUNT(*) AS n
FROM raw.his_patients
GROUP BY UPPER(TRIM(chart_no))
HAVING COUNT(*) > 1;

-- 2. 一致性：掛號的科別代碼對不到對應表（NULL 另外算缺值）
SELECT r.dept_code, COUNT(*) AS n
FROM raw.his_registrations r
LEFT JOIN ref.dept_mapping m ON m.source = 'HIS' AND m.source_code = UPPER(TRIM(r.dept_code))
WHERE m.std_code IS NULL AND r.dept_code IS NOT NULL
GROUP BY r.dept_code;

-- 3. 完整性：必填欄位缺值（空字串也算）
SELECT COUNT(*) AS total,
       COUNT(*) FILTER (WHERE NULLIF(TRIM(dept_code), '') IS NULL) AS missing_dept,
       COUNT(*) FILTER (WHERE visit_date IS NULL)                  AS missing_visit_date
FROM raw.his_registrations;` },
    { title: '分層：raw → staging → mart', lang: 'sql', code: `CREATE SCHEMA IF NOT EXISTS raw;      -- 原樣載入，含個資，權限最嚴
CREATE SCHEMA IF NOT EXISTS staging;  -- 正規化、代碼對應、去重
CREATE SCHEMA IF NOT EXISTS mart;     -- 給報表用的彙總，不含可識別欄位

CREATE VIEW staging.registrations AS
SELECT r.id,
       UPPER(TRIM(r.chart_no)) AS chart_no,
       m.std_code              AS dept_code,     -- 對應到標準科別代碼
       r.visit_date
FROM raw.his_registrations r
JOIN ref.dept_mapping m
  ON m.source = 'HIS' AND m.source_code = UPPER(TRIM(r.dept_code));

-- 「門診人次」的定義寫在目錄裡：掛號數，同一人同日同科算一次
CREATE VIEW mart.monthly_visits AS
SELECT date_trunc('month', visit_date) AS month, dept_code,
       COUNT(DISTINCT (chart_no, visit_date, dept_code)) AS visits
FROM staging.registrations
GROUP BY 1, 2;` },
    { title: '資料目錄條目（第一刀）', lang: 'yaml', code: `dataset: mart.monthly_visits
description: 各科門診人次月報；一人同日同科算一次
owner: 門診部                 # 決定定義、誰可以看
steward: 資訊部 資料組         # 維護品質規則、處理問題回報
lineage:
  - raw.his_registrations     # 每日 02:00 抽取
  - ref.dept_mapping          # 科別代碼對應表（steward 維護）
contains_pii: false
quality_rules:
  - name: chart_no_unique_after_normalize
    threshold: 0               # 有重複就通知 steward，回到 HIS 合併病人
  - name: dept_code_mapped
    threshold: 0.5%            # 對不到的進隔離表，不進報表` },
  ],
  exercise: 'data-governance-1',
}

// 設計情境：多租戶的資料隔離
export default {
  id: 'multi-tenant',
  order: 10,
  group: 'data',
  title: '多租戶的資料隔離',
  en: 'Multi-tenant data isolation',
  level: 3,
  skills: ['data-modeling', 'db-operations', 'scaling'],
  lab: 'MultiTenantScenarioLab',
  summary: 'B2B SaaS 300 家租戶、大小差 1000 倍；資料要嚴格隔離、又要跨租戶統計、每週還有 schema 變更。同一張表、每租戶一個 schema、還是每租戶一個資料庫？',
  situation: 'B2B 人資 SaaS，300 家客戶（租戶）：最小的 20 名員工、最大的 2 萬名，資料量差 1000 倍。每家的資料要嚴格隔離——任何一次把 A 公司的資料回給 B 公司都是合約事故。產品團隊每週要看跨租戶的使用統計；工程團隊每週至少一次 schema 變更要套到所有租戶。PostgreSQL 16，兩個人維運。',
  constraints: [
    '一次跨租戶外洩就是合約事故，隔離要靠機制、不靠人記得加 `WHERE`',
    '每週的 schema 變更要在一個維護窗口內套完所有租戶',
    '產品要跨租戶統計（活躍度、功能使用率），每週出一次',
    '最大租戶的查詢不能拖垮其他 299 家',
    '兩個人維運，預算是幾台資料庫實例，不是幾百台',
  ],
  options: [
    {
      id: 'shared', name: '共用表 + tenant_id（配 RLS）',
      summary: '所有租戶同一組表，每張表都有 `tenant_id`；每個查詢過濾，並用 PostgreSQL Row-Level Security 在資料庫層兜底。',
      pros: ['一份 schema、一次 migration、一個連線池，300 家和 3 家一樣好維運', '跨租戶統計就是一句 `GROUP BY tenant_id`', 'RLS 開了之後，忘了加 `WHERE` 的查詢只會看不到列，不會看到別人的列'],
      cons: ['隔離是邏輯的：RLS 沒開、用了 `BYPASSRLS` 角色、或 `app.tenant_id` 設錯，就外洩', '大租戶的查詢與其他 299 家共用同一組索引、CPU、連線池（noisy neighbor）', '單一租戶的備份還原、匯出、刪除都要用條件過濾，做不到「整包搬走」'],
    },
    {
      id: 'schema', name: '每租戶一個 schema',
      summary: '同一個資料庫，每個租戶一個 schema（`t_acme.employees`）；交易開頭 `SET LOCAL search_path` 決定看到誰的表。',
      pros: ['表結構相同、程式碼相同，只有 `search_path` 不同', '單一租戶可以 `pg_dump -n t_acme` 整包備份、還原、搬走', '隔離比 tenant_id 強一階：查錯 schema 會「表不存在」，不會拿到別人的列'],
      cons: ['migration 要對 300 個 schema 各跑一次；一次失敗就是 schema 版本不一致', '300 × 每個表 = 幾萬個 relation：planner 統計、autovacuum、`pg_dump` 都變慢', '跨租戶統計要 300 段 `UNION ALL`，通常用腳本產生或匯進倉儲', '仍在同一個實例：noisy neighbor 問題與共用表一樣'],
    },
    {
      id: 'database', name: '每租戶一個資料庫 / 實例',
      summary: '每個租戶獨立的 database，需要時獨立實例；連線字串就是隔離邊界。',
      pros: ['隔離最強：拿錯連線才會出事，一租戶一個 pool 就擋掉', '資源隔離：大租戶暴衝只拖垮自己（前提是獨立實例）', '法規需求（資料落地、獨立稽核、客戶自帶金鑰）都做得到'],
      cons: ['300 個資料庫的備份、監控、連線池、migration 各 300 份，兩個人維運不了', '成本隨租戶數線性長：小租戶也要付一個最小實例', '跨租戶統計等於 ETL：把 300 份資料匯進倉儲再算'],
    },
  ],
  tradeoffs: {
    axes: ['隔離強度', 'migration 成本', '跨租戶統計', 'noisy neighbor', '每月成本（示意）'],
    rows: [
      { option: 'shared', cells: ['中：邏輯隔離，靠 RLS 兜底', '低：1 次', '好：`GROUP BY tenant_id`', '差：全部共用', '低：1 台'] },
      { option: 'schema', cells: ['中高：查錯只會表不存在', '高：300 次，版本可能不一致', '差：300 段 `UNION ALL`', '差：同一實例', '低中：1 台，但幾萬個 relation'] },
      { option: 'database', cells: ['高：連線即邊界', '高：300 次，各自排程', '差：ETL 到倉儲', '好：各自實例', '高：×300'] },
    ],
  },
  decisions: [
    { id: 'many-small', situation: '300 家中小客戶，資料量都不大，沒有特殊法規要求，兩個人維運。', options: ['shared', 'schema', 'database'], answer: 'shared',
      explain: '一份 schema、一次 migration、一個連線池，是兩個人養得起的規模。隔離用 `tenant_id` 複合主鍵 + RLS 兜底，並把 `BYPASSRLS` 只給報表排程。schema-per-tenant 在 300 家時 migration 與 relation 數都開始痛；database-per-tenant 是 300 份維運。' },
    { id: 'enterprise', situation: '10 家超大企業客戶，各有法規要求：資料落地、獨立稽核日誌、可以整包攜出、客戶自帶加密金鑰。', options: ['shared', 'schema', 'database'], answer: 'database',
      explain: '這些要求每一條都需要「物理上分開」：不同區域、不同金鑰、不同稽核範圍。10 家的維運份數還扛得住，而且它們付得起專屬實例。共用表做不到資料落地；schema-per-tenant 仍在同一實例、同一組金鑰。' },
    { id: 'early', situation: '剛起步 5 家客戶，兩週後要上線；預期一年內長到幾百家。', options: ['shared', 'schema', 'database'], answer: 'shared',
      explain: '5 家的時候三種都做得到，差別在一年後：共用表從 5 家長到 500 家不用改架構，另外兩種到幾百家時 migration 與維運會先撐不住，屆時再搬回共用表是最貴的遷移。現在就把 `tenant_id` 放進每張表的主鍵；RLS 可以晚一點開。' },
    { id: 'mixed', situation: '混合：280 家小客戶，加 5 家要專屬環境的大客戶。程式碼只想維護一套，主體的資料佈局選哪個？', options: ['shared', 'schema', 'database'], answer: 'shared',
      explain: '主體走共用表（一套程式、一份 migration），5 家專屬客戶用同一套程式碼、同一個帶 `tenant_id` 的 schema，部署到各自的資料庫——差別只在依租戶選連線字串。這樣專屬客戶得到物理隔離，其他 280 家維持一份維運，而不是為 285 家都養三套佈局。' },
  ],
  implementation: [
    { title: 'Row-Level Security：忘了加 WHERE 也只會看不到列（沒設 app.tenant_id 就一列都看不到）', lang: 'sql', code: `ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees FORCE  ROW LEVEL SECURITY;   -- 表的擁有者也受限；superuser 仍會繞過

CREATE POLICY tenant_isolation ON employees
  USING      (tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::bigint);

-- 應用程式：每個交易一開始設定（連線池共用連線，所以用 SET LOCAL 而不是 SET）
BEGIN;
SET LOCAL app.tenant_id = '42';
SELECT * FROM employees WHERE department = 'R&D';   -- 沒寫 tenant_id 也只有 42 的列
INSERT INTO employees (tenant_id, email) VALUES (7, 'x@y.z');  -- WITH CHECK 擋下：不是 42
COMMIT;

-- 報表排程用的角色才准繞過；API 用的角色不給
CREATE ROLE reporting NOLOGIN BYPASSRLS;` },
    { title: 'tenant_id 放進主鍵、唯一鍵、外鍵與索引最左邊', lang: 'sql', code: `CREATE TABLE employees (
  tenant_id  BIGINT NOT NULL REFERENCES tenants (id),
  id         BIGINT GENERATED ALWAYS AS IDENTITY,
  email      TEXT   NOT NULL,
  department TEXT,
  PRIMARY KEY (tenant_id, id),          -- 每個查詢都從 tenant_id 進索引
  UNIQUE (tenant_id, email)             -- 唯一性是每租戶各自算
);
CREATE INDEX idx_employees_tenant_dept ON employees (tenant_id, department);

-- 外鍵也帶 tenant_id：payslip 不可能指到別家的員工
CREATE TABLE payslips (
  tenant_id   BIGINT NOT NULL,
  id          BIGINT GENERATED ALWAYS AS IDENTITY,
  employee_id BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id)
);` },
    { title: 'schema-per-tenant：search_path 決定看到誰的表；跨租戶統計要自己拼', lang: 'sql', code: `-- 建租戶：對新 schema 跑同一份 migration
CREATE SCHEMA t_acme;
-- for t in $(psql -Atc "SELECT slug FROM tenants"); do
--   PGOPTIONS="-c search_path=t_$t" alembic upgrade head   # 300 次
-- done

-- 每個交易開頭（同樣用 SET LOCAL）
BEGIN;
SET LOCAL search_path TO t_acme, public;
SELECT * FROM employees;               -- 解析成 t_acme.employees
COMMIT;

-- 跨租戶統計：300 段 UNION ALL（用腳本產生），或 postgres_fdw / 匯進倉儲
SELECT 'acme'   AS tenant, count(*) FROM t_acme.employees
UNION ALL
SELECT 'globex' AS tenant, count(*) FROM t_globex.employees;
-- …` },
  ],
  exercise: null,
  refs: [],
}

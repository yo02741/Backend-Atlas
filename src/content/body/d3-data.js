// 領域 3：資料儲存（關聯式：PostgreSQL；文件式：MongoDB；快取：Redis） — 技能內文：重點 points / 自我檢核 checklist / 延伸閱讀 refs；索引在 ../d3-data.js
export default {
  'sql-basics': {
    points: [
      { b: '邏輯執行順序不是書寫順序', t: 'FROM → JOIN → WHERE → GROUP BY → HAVING → SELECT → DISTINCT → ORDER BY → LIMIT。所以 WHERE 裡不能用 SELECT 的別名，HAVING 才能用聚合。（PostgreSQL 的擴充：ORDER BY 與 GROUP BY 可以用輸出欄位的別名，別的資料庫不一定。）' },
      { b: 'NULL 不等於任何東西', t: '`NULL = NULL` 是 NULL 不是 true；要用 `IS NULL`。`COUNT(col)` 不算 NULL、`COUNT(*)` 算全部列。`NOT IN (含 NULL 的子查詢)` 會整個變空——經典地雷。' },
      { b: 'GROUP BY 之後只剩群組鍵與聚合', t: '想「每個使用者最新一筆訂單」不是 GROUP BY 能直接做的，要用視窗函數或 `DISTINCT ON`（PostgreSQL 特有）。' },
      { b: '型別要對', t: '金額用 `NUMERIC` 不用浮點、時間用 `TIMESTAMPTZ`、id 用 `BIGINT` 或 UUID、狀態用受限的文字加 CHECK 或 enum。' },
    ],
    checklist: [
      '能寫出「每個城市的訂單數與總金額，只列超過 3 筆的」',
      '能解釋為什麼 `WHERE status != \'paid\'` 會漏掉 status 是 NULL 的列',
      '知道金額、時間、id 該用什麼型別',
    ],
    refs: [
      { label: 'PostgreSQL 官方文件', url: 'https://www.postgresql.org/docs/current/' },
      { label: 'PostgreSQL 教學：Queries', url: 'https://www.postgresql.org/docs/current/queries.html' },
    ],
  },
  'sql-joins': {
    points: [
      { b: 'JOIN 是在配對列', t: 'ON 條件決定左表每列跟右表哪些列配成一列。一對多會讓左表「變多」——這是後續 SUM / COUNT 重複計算的根源。' },
      { b: 'LEFT 保左、INNER 只留配對', t: '「所有使用者含沒訂單的」用 LEFT；「有訂單的使用者」用 INNER。RIGHT 幾乎都能改寫成 LEFT。' },
      { b: 'anti-join：找孤兒', t: '`LEFT JOIN … WHERE 右.id IS NULL` 或 `NOT EXISTS` 找「沒有對應」的資料——從未下單的使用者、沒被引用的標籤。' },
      { b: 'WHERE 與 ON 放條件的差別', t: 'LEFT JOIN 時，過濾右表的條件放 ON 才保得住左表；放 WHERE 會把右邊 NULL 的列一起濾掉，變成 INNER。' },
    ],
    checklist: [
      '能不看文件畫出七種 JOIN 的文氏圖並各舉一個實際用途',
      '能解釋 LEFT JOIN 時條件放 ON 與放 WHERE 的差異',
      '能寫出「從未下單的使用者」的兩種寫法',
    ],
    refs: [
      { label: 'PostgreSQL 教學：Joins Between Tables', url: 'https://www.postgresql.org/docs/current/tutorial-join.html' },
    ],
  },
  'data-modeling': {
    points: [
      { b: '正規化的目的：一件事實只存一處', t: '客戶的地址存在 customers 表一次，orders 用 customer_id 指過去。改地址只改一處，不會出現兩筆不一致。' },
      { b: '約束是最便宜的驗證', t: '`NOT NULL`、`UNIQUE`、`FOREIGN KEY`、`CHECK (amount >= 0)` 由資料庫保證，比應用層驗證更可靠（任何程式、任何路徑進來都擋）。' },
      { b: '多對多要中介表', t: 'users ↔ roles 用 `user_roles(user_id, role_id)` 並設複合主鍵。' },
      { b: '反正規化是有意識的取捨', t: '報表要快可以存快照欄位（訂單當時的商品名稱與價格本來就該快照）；但要清楚哪些是衍生值、由誰負責更新。' },
      { b: 'id 的選擇', t: '自增 BIGINT 簡單且索引友善；UUID 方便分散產生但索引較胖（UUIDv7 有時間序，兩者兼顧；PostgreSQL 18 起內建 `uuidv7()`）。' },
    ],
    checklist: [
      '能為「使用者—訂單—商品」畫出 ER 圖並寫出 DDL 與約束',
      '能指出一個 schema 哪裡違反 3NF 並說明後果',
      '能說出什麼情況該存快照欄位',
    ],
    refs: [
      { label: 'PostgreSQL：Constraints', url: 'https://www.postgresql.org/docs/current/ddl-constraints.html' },
    ],
  },
  'schema-design-practice': {
    points: [
      { b: '先從需求句子找名詞與規則', t: '名詞是候選實體（病患、醫師、診次、掛號），「每個…只能…」是唯一約束，「必須是…之一」是 CHECK，「…屬於…」是外鍵。規則寫進 DDL，任何程式路徑都繞不過。' },
      { b: '主鍵：bigint identity 或 UUID', t: '`bigint GENERATED ALWAYS AS IDENTITY` 小、有序、索引友善；需要在用戶端先產生 id、或不想讓 id 透露數量時用 UUID（有時間序的 UUIDv7 對索引比較友善）。業務上的編號（病歷號）另設唯一約束，不拿來當主鍵。' },
      { b: '外鍵的 ON DELETE 是業務決定', t: '掛號紀錄不該因為刪醫師而消失：用預設的 `NO ACTION` / `RESTRICT` 擋下；只有「從屬且沒有獨立意義」的資料（例如草稿的附件）才用 `CASCADE`。' },
      { b: '時間用 timestamptz、狀態用受限文字', t: '`timestamptz` 存的是絕對時間點，顯示時才轉時區；狀態欄位用 `text` + `CHECK (status IN (...))`，比 enum 好改。「同一病患同一診次只能有一筆有效掛號」用部分唯一索引（`WHERE status <> \'cancelled\'`）。' },
      { b: 'migration 分步走', t: '加必填欄位：先加 nullable 欄位 → 部署會寫入的程式 → 分批回填 → 加 `CHECK … NOT VALID` 再 `VALIDATE` → `SET NOT NULL`。每一步都能單獨上線、單獨回退。' },
    ],
    checklist: [
      '能把一段需求拆成資料表，並指出每條業務規則落在哪個約束',
      '能說明某個外鍵為什麼選 RESTRICT 而不是 CASCADE',
      '能規劃「替大表加一個必填欄位」的分步 migration',
    ],
    refs: [
      { label: 'PostgreSQL：Constraints', url: 'https://www.postgresql.org/docs/current/ddl-constraints.html' },
      { label: 'PostgreSQL：Partial Indexes', url: 'https://www.postgresql.org/docs/current/indexes-partial.html' },
      { label: 'PostgreSQL：Date/Time Types', url: 'https://www.postgresql.org/docs/current/datatype-datetime.html' },
      { label: 'PostgreSQL：ALTER TABLE', url: 'https://www.postgresql.org/docs/current/sql-altertable.html' },
    ],
  },
  'indexes': {
    points: [
      { b: '索引是排序好的副本', t: 'B-tree 把欄位值排序存在樹裡，查一個值只要走樹高（幾層），不用掃整張表。代價：每次寫入要同步更新索引。' },
      { b: '什麼時候索引沒用', t: '對欄位套函數（`LOWER(email)`，要建表達式索引）、前置萬用字元 `LIKE \'%abc\'`、選擇性太低（status 只有 3 種值）、資料量太小（掃全表更快）。' },
      { b: '複合索引的最左前綴', t: '`(user_id, created_at)` 能服務 `WHERE user_id = ?` 與 `WHERE user_id = ? ORDER BY created_at`，但不能單獨服務 `WHERE created_at = ?`。' },
      { b: 'EXPLAIN ANALYZE 是真相', t: '看 Seq Scan / Index Scan / Nested Loop / Hash Join，比對估計列數與實際列數；差很多代表統計過期（跑 `ANALYZE`）。' },
      { b: '外鍵欄位要加索引', t: 'PostgreSQL 不會自動幫外鍵建索引，JOIN 與 ON DELETE 都會慢。' },
    ],
    checklist: [
      '能對一條慢查詢跑 EXPLAIN ANALYZE 並指出瓶頸節點',
      '能解釋複合索引欄位順序怎麼決定',
      '能列出三種「有索引但用不到」的情況',
    ],
    refs: [
      { label: 'PostgreSQL：Indexes', url: 'https://www.postgresql.org/docs/current/indexes.html' },
      { label: 'PostgreSQL：Using EXPLAIN', url: 'https://www.postgresql.org/docs/current/using-explain.html' },
      { label: 'Use The Index, Luke', url: 'https://use-the-index-luke.com/' },
    ],
  },
  'full-text-search': {
    points: [
      { b: '前置萬用字元用不到 B-tree', t: "`LIKE '%keyword%'` 只能逐列比對字串，資料量變大時成本線性成長；而且子字串比對分不出詞的邊界（`%log%` 會命中 `catalog`、`blog`），也沒有相關度可以排序。" },
      { b: 'tsvector 是斷詞後的詞位清單', t: "`to_tsvector('english', 'Indexes are rebuilt')` 得到 `'index':1 'rebuilt':3`：轉小寫、去掉停用詞（are）、還原字根（indexes → index），並記下位置。查詢端的 `to_tsquery` 也做同樣處理，兩邊才對得上。" },
      { b: '@@ 比對、GIN 索引加速', t: '`WHERE tsv @@ query` 判斷是否命中；在 tsvector 欄位（或 `to_tsvector(...)` 表達式）建 GIN 索引，查詢就不用掃全表。建索引與查詢用的設定（english / simple）必須一致，表達式索引才用得上。' },
      { b: 'ts_rank 排序、setweight 加權', t: '`ts_rank(tsv, query)` 依詞頻與權重算分數；標題用 `setweight(..., \'A\')`、內文用 B，標題命中排前面。分數只用來排序，不同查詢之間的數字不能比。' },
      { b: '中文沒有內建斷詞', t: "PostgreSQL 內建的設定不會切中文：`to_tsvector('simple', '全文檢索很好用')` 整句變成一個詞。可行的路：應用層先斷詞再寫入、zhparser 這類擴充、`pg_trgm` 三元組比對，或改用 Elasticsearch / OpenSearch。" },
    ],
    checklist: [
      "能解釋 `LIKE '%x%'` 為什麼用不到 B-tree 索引",
      '能建一個 tsvector 產生欄位 + GIN 索引，並用 ts_rank 排出結果',
      '能說出中文全文檢索有哪幾種做法與各自的代價',
    ],
    refs: [
      { label: 'PostgreSQL：Full Text Search', url: 'https://www.postgresql.org/docs/current/textsearch.html' },
      { label: 'PostgreSQL：Controlling Text Search', url: 'https://www.postgresql.org/docs/current/textsearch-controls.html' },
      { label: 'PostgreSQL：pg_trgm', url: 'https://www.postgresql.org/docs/current/pgtrgm.html' },
    ],
  },
  'transactions': {
    points: [
      { b: 'ACID 四個字', t: '原子性（全做或全不做）、一致性（約束永遠成立）、隔離性（並發交易互不干擾的程度）、持久性（COMMIT 後斷電也在）。' },
      { b: '隔離等級是「看得到多少別人的變更」', t: 'READ COMMITTED（PostgreSQL 預設：只看到已 commit 的）→ REPEATABLE READ（同一交易內讀到的一致）→ SERIALIZABLE（等同序列執行，可能失敗要重試）。' },
      { b: '超賣怎麼防', t: '`SELECT … FOR UPDATE` 鎖住那列再扣；或用 `UPDATE stock SET qty = qty - 1 WHERE id = ? AND qty > 0` 一句原子完成；或樂觀鎖（version 欄位）。' },
      { b: '交易要短', t: '交易期間握著鎖與快照；在交易裡呼叫外部 API 是災難。開交易 → 做 DB 操作 → commit，其他事放外面。' },
      { b: 'MVCC 讓讀不擋寫', t: 'PostgreSQL 每列保留多版本，讀取看快照不用等寫入的鎖；代價是要 VACUUM 清舊版本。' },
    ],
    checklist: [
      '能寫出「建訂單 + 扣庫存」的交易並說明失敗時會怎樣',
      '能解釋 READ COMMITTED 與 REPEATABLE READ 的行為差異',
      '能用兩種方式防止庫存超賣',
    ],
    refs: [
      { label: 'PostgreSQL：Transaction Isolation', url: 'https://www.postgresql.org/docs/current/transaction-iso.html' },
    ],
  },
  'locks-deadlocks': {
    points: [
      { b: '列鎖四種強度', t: '`FOR UPDATE`（要改或刪）> `FOR NO KEY UPDATE`（一般 UPDATE 自動拿的）> `FOR SHARE`（只要確保別人不能改）> `FOR KEY SHARE`（外鍵檢查用）。一般讀取不拿列鎖，MVCC 讓讀不被寫擋住。' },
      { b: 'NOWAIT 與 SKIP LOCKED', t: '`NOWAIT` 拿不到鎖立刻報錯（55P03）；`SKIP LOCKED` 跳過被鎖的列，多個 worker 同時 `SELECT … LIMIT 1 FOR UPDATE SKIP LOCKED` 就能各拿到不同的工作，是用資料表做工作佇列的標準寫法。' },
      { b: 'DDL 會拿表鎖', t: '多數 `ALTER TABLE` 要 ACCESS EXCLUSIVE，連 SELECT 都擋；更麻煩的是它在排隊時，後面所有查詢也跟著排隊。`CREATE INDEX` 擋寫入，`CREATE INDEX CONCURRENTLY` 不擋讀寫但比較慢、不能放在交易裡。' },
      { b: '先設 lock_timeout', t: "migration 開頭 `SET lock_timeout = '3s'`：拿不到鎖就失敗重試，不會卡住整個服務。`statement_timeout` 限制單句執行時間，`idle_in_transaction_session_timeout` 收掉開著不動的交易。" },
      { b: '死結：偵測得到，但要靠固定順序避免', t: '兩個交易互等對方的鎖時，PostgreSQL 等 `deadlock_timeout`（預設 1 秒）後檢查，中止其中一個並回 `deadlock detected`（40P01）。重試能救單次，根治是所有程式以相同順序上鎖（例如依 id 由小到大）。' },
    ],
    checklist: [
      '能用 FOR UPDATE SKIP LOCKED 寫出一個多 worker 安全的取工作查詢',
      '能說出 ALTER TABLE 為什麼會讓整個服務卡住，以及 lock_timeout 怎麼救',
      '能用 pg_stat_activity 與 pg_blocking_pids() 找出誰擋住誰',
    ],
    refs: [
      { label: 'PostgreSQL：Explicit Locking', url: 'https://www.postgresql.org/docs/current/explicit-locking.html' },
      { label: 'PostgreSQL：pg_locks', url: 'https://www.postgresql.org/docs/current/view-pg-locks.html' },
      { label: 'PostgreSQL：Client Connection Defaults（lock_timeout 等）', url: 'https://www.postgresql.org/docs/current/runtime-config-client.html' },
    ],
  },
  'sql-advanced': {
    points: [
      { b: 'CTE 是查詢的變數', t: '`WITH recent AS (SELECT …) SELECT … FROM recent JOIN …`，每段有名字、可讀、可重用。遞迴 CTE 能走樹狀資料（組織圖、分類）。' },
      { b: '視窗函數不縮列', t: '`ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC)` 給每人每筆訂單編號，取 = 1 就是「每人最新一筆」。`SUM() OVER (ORDER BY …)` 做累計。' },
      { b: 'EXISTS 通常比 IN 好', t: '子查詢做存在性檢查用 `EXISTS`，語意清楚、對 NULL 安全、計畫通常更好。' },
      { b: 'LATERAL：每列跑一次子查詢', t: '「每個使用者最近三筆訂單」用 `CROSS JOIN LATERAL (… LIMIT 3)` 最直白。' },
    ],
    checklist: [
      '能用視窗函數寫出「每個使用者最新一筆訂單」',
      '能用 CTE 把一個三層巢狀查詢改成線性可讀的版本',
    ],
    refs: [
      { label: 'PostgreSQL：WITH Queries', url: 'https://www.postgresql.org/docs/current/queries-with.html' },
      { label: 'PostgreSQL 教學：Window Functions', url: 'https://www.postgresql.org/docs/current/tutorial-window.html' },
    ],
  },
  'orm-migrations': {
    points: [
      { b: 'N+1：迴圈裡的隱形查詢', t: '取 100 篇文章再逐篇存取 `.author` = 1 + 100 次查詢。用 eager loading（`selectinload` / `joinedload`）變 2 次。開 SQL log 看一次就懂。' },
      { b: 'session 的生命週期', t: '一個請求一個 session，結束時 commit 或 rollback 並關閉。長壽 session 會拿到舊資料、洩漏連線。' },
      { b: 'migration 是 schema 的 git', t: '每次改 model 就產生一個 migration 檔（Alembic autogenerate 後**一定要人工檢查**），CI / 部署時套用。' },
      { b: '不可逆變更要分兩步', t: '改欄位名：先加新欄、雙寫、回填、切讀取、再刪舊欄。直接 rename 在部署過程會有一段時間新舊程式碼同時存在而炸掉。' },
      { b: 'ORM 不是全部', t: '複雜報表直接寫 SQL（`text()` 或 query builder）；ORM 適合 CRUD 與物件關聯。' },
    ],
    checklist: [
      '能開 SQL log 找出一個 N+1 並用 eager loading 修好',
      '能用 Alembic 產生、檢查、套用一個 migration',
      '能規劃一次「欄位改名」的零停機部署步驟',
    ],
    refs: [
      { label: 'SQLAlchemy 文件', url: 'https://docs.sqlalchemy.org/' },
      { label: 'Alembic 文件', url: 'https://alembic.sqlalchemy.org/' },
    ],
  },
  'db-operations': {
    points: [
      { b: '備份三件事', t: '自動化（每天 `pg_dump` 或受管服務快照）、異地存放、**定期還原演練**並記錄花多久（RTO）。有 WAL 歸檔才能做時間點還原（PITR）。' },
      { b: '連線是稀缺資源', t: 'PostgreSQL 每個連線是一個程序，`max_connections` 通常一兩百。API worker 數 × 每個 pool 大小要小於它；多實例時用 pgbouncer 做連線池。' },
      { b: '慢查詢 log', t: '`log_min_duration_statement = 500ms` 把慢查詢記下來，配合 `pg_stat_statements` 看哪條查詢總耗時最高——優化從這裡開始，不是猜。' },
      { b: 'VACUUM 與膨脹', t: 'MVCC 留下的舊版本靠 autovacuum 回收；大量 UPDATE / DELETE 的表會膨脹、索引變慢。看 `pg_stat_user_tables` 的 dead tuples，必要時調 autovacuum 參數。' },
      { b: '升級與 migration 上線', t: '大版本升級要先在副本演練；正式環境 migration 前先備份、避免長時間鎖表（加欄位帶 DEFAULT 在新版是即時的，加索引用 CONCURRENTLY）。' },
    ],
    checklist: [
      '過去三個月內成功從備份還原過一次，且知道花了多久',
      '能算出自己服務的最大連線需求並與 max_connections 對照',
      '能從慢查詢 log 或 pg_stat_statements 找出最該優化的查詢',
    ],
    refs: [
      { label: 'PostgreSQL：Backup and Restore', url: 'https://www.postgresql.org/docs/current/backup.html' },
      { label: 'PostgreSQL：Routine Vacuuming', url: 'https://www.postgresql.org/docs/current/routine-vacuuming.html' },
    ],
  },
  'mongodb': {
    points: [
      { b: '一起讀的資料放一起', t: '文章與它的留言常一起顯示 → 嵌入；留言可能無限多 → 參照。「一次讀取拿到整份需要的資料」是文件模型的優勢，也是設計原則。' },
      { b: '嵌入的三個條件', t: '被擁有（不會被別的文件共享）、數量有上限、一起讀寫。不滿足任一就參照。' },
      { b: '沒有 JOIN，有 $lookup', t: '跨 collection 關聯要用 aggregation 的 `$lookup`，效能不如關聯式 JOIN；設計時就該減少跨 collection 查詢。' },
      { b: '單一文件操作是原子的', t: '一份文件內的更新（`$set`、`$push`、`$inc`）原子完成；跨文件才需要多文件交易（4.0 起支援，但要避免依賴）。' },
      { b: 'schema 還是要管', t: '用 schema validation 或應用層（pydantic / ODM 如 Beanie）約束欄位，否則三個月後同一 collection 會有五種形狀。' },
    ],
    checklist: [
      '能為「文章 / 作者 / 留言」決定哪些嵌入、哪些參照並說明理由',
      '能說出 MongoDB 什麼操作是原子的',
      '知道無上限陣列與 16MB 上限為什麼是反模式',
    ],
    refs: [
      { label: 'MongoDB 手冊', url: 'https://www.mongodb.com/docs/manual/' },
      { label: 'MongoDB：Data Modeling', url: 'https://www.mongodb.com/docs/manual/data-modeling/' },
    ],
  },
  'mongodb-ops': {
    points: [
      { b: 'aggregation 是管線', t: '`$match` → `$group` → `$sort` → `$project` 一階段接一階段，跟 SQL 的 WHERE / GROUP BY / ORDER BY 對應。`$match` 越早越好，才能用索引。' },
      { b: '索引規則跟 B-tree 一樣', t: '複合索引最左前綴、ESR 原則（Equality → Sort → Range 排欄位順序）、`explain("executionStats")` 看有沒有 COLLSCAN。' },
      { b: '更新運算子而非整份覆寫', t: '`$set`、`$inc`、`$push`、`$addToSet`：只送變更、原子、少傳輸。整份 replace 會在並發時互相覆蓋。' },
      { b: '注意查詢運算子注入', t: '把使用者輸入直接當 filter（`{"password": req.body.password}`）會被 `{"$gt": ""}` 繞過——輸入要驗證成字串。' },
    ],
    checklist: [
      '能寫出「每個作者的文章數，排序取前 10」的 aggregation',
      '能用 explain 確認一個查詢有用到索引',
    ],
    refs: [
      { label: 'MongoDB：Aggregation', url: 'https://www.mongodb.com/docs/manual/aggregation/' },
      { label: 'MongoDB：Indexes', url: 'https://www.mongodb.com/docs/manual/indexes/' },
    ],
  },
  'redis-cache': {
    points: [
      { b: 'cache-aside', t: '讀：先查快取，miss 才查 DB 並回寫快取（帶 TTL）。寫：更新 DB 後刪快取（不是更新快取——刪比較不會出錯）。' },
      { b: 'TTL 是安全網', t: '就算失效邏輯漏了，資料最多舊 TTL 那麼久。依「可以容忍多舊」決定 TTL。' },
      { b: '快取穿透、雪崩、擊穿', t: '查不存在的 key 每次都打 DB（快取空值）；大量 key 同時過期（TTL 加隨機抖動）；熱 key 過期瞬間大量 miss（加鎖或提前更新）。' },
      { b: 'Redis 不只是快取', t: '限流計數器（INCR + EXPIRE）、分散式鎖、排行榜（sorted set）、session 儲存、簡單佇列（list / stream）。' },
      { b: 'key 要有命名規範', t: '`user:42:profile`、`ratelimit:login:ip:1.2.3.4`——有前綴才能批次管理與觀察。' },
    ],
    checklist: [
      '能畫出 cache-aside 的讀寫流程並解釋為何寫入時「刪」而不是「更新」快取',
      '能說出穿透 / 雪崩 / 擊穿各是什麼、怎麼防',
      '能用 Redis 實作一個簡單的限流計數',
    ],
    refs: [
      { label: 'Redis 文件', url: 'https://redis.io/docs/latest/' },
    ],
  },
  'db-choice': {
    points: [
      { b: '預設選關聯式', t: '交易、約束、JOIN、成熟工具鏈——大多數業務系統的需求。PostgreSQL 的 JSONB 還能兼顧半結構化資料。' },
      { b: '文件式適合的情境', t: '每筆資料形狀差異大、幾乎都是整份讀寫、需要水平擴展寫入、快速迭代原型。' },
      { b: '一致性 vs 可用性', t: '分散式系統在網路分割時要選一邊（CAP）。單機 PostgreSQL 強一致；分散式 NoSQL 多半最終一致——業務能不能接受「短暫看到舊資料」是關鍵問題。' },
      { b: '多種資料庫各司其職', t: '主資料放 PostgreSQL、快取放 Redis、全文搜尋放 Elasticsearch、分析放列式資料庫。每多一種就多一個要備份、監控、升級的東西。' },
      { b: '備份與還原要演練', t: '不管選哪個：自動備份、定期還原測試、知道 RPO / RTO。沒還原過的備份不算備份。' },
    ],
    checklist: [
      '能為「電商訂單系統」「IoT 感測器紀錄」「使用者行為分析」各選資料庫並說明理由',
      '能解釋 CAP 在實務上的意義',
      '知道自己專案的備份在哪、多久一次、還原過沒有',
    ],
    refs: [
      { label: 'Wikipedia：CAP theorem', url: 'https://en.wikipedia.org/wiki/CAP_theorem' },
    ],
  },
}

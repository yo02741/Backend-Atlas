// 領域 3：資料儲存（關聯式：PostgreSQL；文件式：MongoDB；快取：Redis） — 技能內文：重點 points / 自我檢核 checklist / 延伸閱讀 refs；索引在 ../d3-data.js
import m3 from './parts/d3-data-m3.js'
const base = {
  'sql-basics': {
    map: {
      names: [
        { n: '邏輯執行順序', t: 'FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT；決定別名在哪裡能用、聚合條件要放 HAVING。' },
        { n: '`WHERE` 與 `HAVING`', t: 'WHERE 在分組前逐列過濾，HAVING 在分組後過濾群組；`count(*) > 3` 只能放 HAVING。' },
        { n: '三值邏輯', t: '和 NULL 比較的結果是 NULL，WHERE 只留下 true；`status <> \'paid\'` 會漏掉 status 是 NULL 的列。' },
        { n: '`IS NULL`、`IS DISTINCT FROM`', t: '判斷 NULL 要用 `IS NULL`；想讓 NULL 也參與「不等於」，用 `IS DISTINCT FROM`。' },
        { n: '`count(*)` 與 `count(col)`', t: '`count(*)` 數列數，`count(col)` 不數 NULL；LEFT JOIN 之後算筆數要用後者。' },
        { n: '`GROUP BY` 的粒度', t: '分組之後每組一列，SELECT 只能放群組鍵與聚合；要「每組最新一筆」改用視窗函數或 `DISTINCT ON`。' },
        { n: '`NUMERIC` 與 `TIMESTAMPTZ`', t: '金額用十進位定點數，時間存帶時區的時間點；用浮點數存金額，加總會差幾分錢。' },
      ],
      ask: [
        '結果的一列代表什麼（每個城市一列、每張訂單一列），以及排序與筆數上限。',
        '哪些條件是逐列過濾、哪些是對群組過濾（例如「只算已付款」與「只列 3 筆以上的城市」）。',
        '欄位可能是 NULL 時要怎麼算：要不要包含、顯示成什麼。',
        '日期區間的邊界與時區（例如台灣時間 3 月整個月，用 `>=` 月初與 `<` 下月初）。',
        '金額、時間、id 的欄位型別。',
      ],
      prompt: '寫一句 PostgreSQL 查詢給月報：統計 2026 年 3 月（台灣時間）每個城市已付款訂單的筆數與總金額，只列 3 筆以上的城市，依總金額由高到低排序。orders 以 `user_id` 對 users，城市是 NULL 的會員歸成「未填」一組。日期條件寫成 `created_at >= \'2026-03-01 00:00+08\' AND created_at < \'2026-04-01 00:00+08\'`，不要對欄位套 `::date`；筆數條件放 `HAVING`，金額欄位是 `NUMERIC`。',
      verify: [
        { c: '手算對照', t: '挑一個城市手算筆數與金額，再在 `psql` 或 Playground 執行查詢比對；差一筆時先查邊界那一天與時區。' },
        { c: 'NULL', t: '先 `SELECT count(*) FROM users WHERE city IS NULL` 確認有沒有未填的會員，再看結果裡有沒有「未填」這一組；不見了通常是用了 `=` 或 `<>` 比較 NULL。' },
        { c: 'HAVING', t: '把門檻從 3 改成 1，城市數應該變多；報錯 `aggregate functions are not allowed in WHERE` 代表聚合條件放進了 WHERE。' },
        { c: '型別', t: '`\\d orders` 看 amount 的型別；`double precision` 或 `real` 要改成 `numeric`，加總結果出現 `0.30000000000000004` 這類尾數就是浮點誤差。' },
        { c: '日期條件', t: '`EXPLAIN` 看 created_at 上的索引有沒有被用到；條件寫成 `created_at::date = …` 或 `date_trunc(…)` 時，計畫通常變成 Seq Scan。' },
      ],
    },
    challenge: {
      task: '在 [Playground](#/playground?lang=sql) 先執行 `UPDATE users SET city = NULL WHERE id IN (4, 5);`，讓兩位會員沒填城市。**執行下面三句之前**，先手算每句回傳幾列（第三句再寫出每一組的 count）：\n\n1. `SELECT count(*) FROM users WHERE city <> \'台北\';`\n2. `SELECT count(city), count(*) FROM users;`\n3. `SELECT city, count(*) FROM users GROUP BY city;`\n\n寫下預測後再執行，對照差異。',
      deliver: '三句各一組「預測 → 實際」的數字，加上每個差異一句原因。',
      check: [
        '預測寫在執行之前，三句都有預測與實際兩個數字',
        '第 1 句的解釋指出 `city <> \'台北\'` 對 NULL 得到 NULL、被 WHERE 丟掉，並寫出把未填城市算進來的改法（`IS DISTINCT FROM` 或加 `OR city IS NULL`）',
        '第 3 句說出 GROUP BY 把所有 NULL 歸成同一組，和用 `=` 比較 NULL 的結果不同',
        '列出這份會員報表要跟業務確認的定義：未填城市算不算一組、「不在台北」要不要包含未填',
      ],
      twist: '行銷部門改口：沒填城市的會員要顯示成「未填」，並且只列出會員數 2 人以上的城市。先預測第 3 句改寫後剩幾列、哪幾組消失，再用 `coalesce(city, \'未填\')` 與 `HAVING count(*) >= 2` 驗證。',
    },
    points: [
      { b: '邏輯執行順序不是書寫順序', t: 'FROM → JOIN → WHERE → GROUP BY → HAVING → SELECT → DISTINCT → ORDER BY → LIMIT。所以 WHERE 裡不能用 SELECT 的別名，HAVING 才能用聚合。（PostgreSQL 的擴充：ORDER BY 與 GROUP BY 可以用輸出欄位的別名，別的資料庫不一定。）' },
      { b: 'NULL 不等於任何東西', t: '`NULL = NULL` 是 NULL 不是 true；要用 `IS NULL`。`COUNT(col)` 不算 NULL、`COUNT(*)` 算全部列。`NOT IN (含 NULL 的子查詢)` 會整個變空。' },
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
    map: {
      names: [
        { n: 'INNER JOIN', t: '只留兩邊都配得上的列，例如「有訂單的使用者」。' },
        { n: 'LEFT JOIN', t: '左表每一列至少出現一次，配不到的右邊欄位填 NULL，例如「所有使用者，含沒有訂單的」；`RIGHT JOIN` 都能對調兩張表改寫成它。' },
        { n: '`ON` 與 `WHERE`', t: 'LEFT JOIN 時 `ON` 決定右表哪些列能配對，`WHERE` 在配對完成後才過濾；限制右表的條件放進 `WHERE`，LEFT 會變成 INNER。' },
        { n: '粒度', t: '結果的一列代表什麼。一對多 JOIN 之後，一列從「一張訂單」變成「一個品項」，訂單金額的 `sum` 會被品項數放大。' },
        { n: '先聚合再 JOIN', t: '把多的那一邊先 `GROUP BY` 成每個鍵一列再接上，讓每個聚合在自己的粒度上算。' },
        { n: 'anti-join', t: '找「沒有對應」的資料：從未下單的使用者、找不到使用者的孤兒訂單。用 `NOT EXISTS`；`NOT IN` 遇到子查詢裡有 NULL，結果整個變空。' },
        { n: 'semi-join（`EXISTS`）', t: '只問「有沒有至少一筆對應」，左表每一列最多出現一次；改用 JOIN 寫，有兩筆對應的人會出現兩次。' },
      ],
      ask: [
        '結果的一列代表什麼：每位使用者一列，或每張訂單一列。',
        '沒有對應資料的列要不要出現，數字顯示 0 還是 NULL。',
        '每個數字在哪個粒度上算：訂單金額按訂單加總、件數按品項加總。',
        '每個過濾條件限制的是哪一邊（例如「只算已付款的訂單」，但沒有已付款訂單的使用者照樣列出）。',
        '關聯欄位可不可能是 NULL（例如訪客訂單的 `user_id`），以及用哪個資料庫（MySQL 沒有 FULL JOIN）。',
      ],
      prompt: '寫一句 PostgreSQL 查詢給月報：每位使用者一列，欄位是姓名、已付款訂單數、已付款訂單總金額、購買件數，沒有已付款訂單的使用者也要列出、數字顯示 0。users 對 orders、orders 對 order_items 都是一對多，order_items 先依 `order_id` 聚合成每張訂單一列再 JOIN，不要用 `sum(DISTINCT ...)` 補救。users 用 LEFT JOIN 接 orders，`status = \'paid\'` 放在 `ON`，後面接的表也用 LEFT JOIN。',
      verify: [
        { c: '列數', t: '拿掉 `GROUP BY`，只留 FROM 與 JOIN 跑 `SELECT count(*)`，和預期的粒度比（應該是幾位使用者、幾張訂單）；多出來代表某段 JOIN 是一對多。' },
        { c: '對帳', t: '挑一位有多品項訂單的使用者手算訂單總額；結果剛好多出某張訂單的金額，是 `sum(o.amount)` 被品項數放大了。' },
        { c: '沒有資料的列', t: '沒有訂單的使用者要出現、數字是 0；整列消失通常是右表條件放進了 `WHERE`，數字是 1 通常是 LEFT JOIN 後用了 `count(*)`，該用 `count(o.id)`。' },
        { c: 'NULL 陷阱', t: '在 orders 塞一筆 `user_id` 是 NULL 的訪客訂單再跑一次，「從未下單的使用者」不該變成 0 筆；變成 0 筆代表用了 `NOT IN`。' },
        { c: '可疑寫法', t: '出現 `sum(DISTINCT ...)` 或用 `SELECT DISTINCT` 消掉重複列，通常是在掩蓋一對多放大的列數；`NATURAL JOIN` 與沒有條件的逗號 JOIN 也要改成明寫 `ON`。' },
      ],
    },
    challenge: {
      task: '在 [Playground](#/playground?lang=sql) 先執行兩句：`INSERT INTO order_items VALUES (101, 2, 2);`（Alice 的 101 號訂單多一個品項）、`INSERT INTO orders VALUES (107, NULL, \'pending\', 500, \'2026-03-20 12:00+08\');`（一筆訪客訂單）。執行下面三句之前，先寫下預測：\n\n1. `users LEFT JOIN orders LEFT JOIN order_items` 之後 `GROUP BY u.name` 算 `sum(o.amount)`，Alice 是多少\n2. `SELECT count(*) FROM users WHERE id NOT IN (SELECT user_id FROM orders);` 回傳多少\n3. 同一個問題改用 `NOT EXISTS`，回傳哪幾位',
      deliver: '三個預測與實際結果，加上每一句「差在哪一步配對」的說明，以及第 1 句改成先聚合再 JOIN 的查詢。',
      check: [
        '預測寫在執行之前',
        'Alice 的金額指出是哪張訂單被品項數放大、放大幾倍；改寫後的查詢算出正確的 3290',
        '第 2 句回 0 的原因指向訪客訂單的 NULL `user_id`，第 3 句回 Dave 與 Eve',
      ],
      twist: '同一份報表改給倉儲用：一張出貨單拆成多個包裹，每個包裹有多個品項，運費記在出貨單上。先預測「每位客戶的運費加總」用同樣三表 JOIN 會被放大幾倍，再說出哪些條件可以沿用（粒度、一對多的方向、先聚合再 JOIN），哪些要跟物流確認（運費記在出貨單還是包裹、退件算不算）。',
    },
    points: [
      { b: 'JOIN 是在配對列', t: 'ON 條件決定左表每列跟右表哪些列配成一列。一對多會讓左表「變多」，後續 SUM / COUNT 重複計算就是從這裡來的。' },
      { b: 'LEFT 保左、INNER 只留配對', t: '「所有使用者含沒訂單的」用 LEFT；「有訂單的使用者」用 INNER。RIGHT 幾乎都能改寫成 LEFT。' },
      { b: 'anti-join：找孤兒', t: '`LEFT JOIN … WHERE 右.id IS NULL` 或 `NOT EXISTS` 找「沒有對應」的資料，例如從未下單的使用者、沒被引用的標籤。' },
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
    challenge: {
      task: '把本課開頭那張「什麼都裝」的訂單表拆到 3NF，寫成 PostgreSQL DDL（主鍵、外鍵與 ON DELETE、NOT NULL、CHECK），在 [Playground](#/playground?lang=sql) 建起來，每張表插兩筆資料，再寫一句把原本那張大表的內容 JOIN 回來的查詢。',
      deliver: 'DDL、JOIN 回原樣的查詢結果，以及一張表：原本每個欄位搬到哪張表、依賴哪個鍵。',
      check: [
        '客戶 email 這類「目前的值」只存在一張表；訂單上若保留商品名稱與單價，註明是成交快照與理由',
        '每個外鍵寫出 ON DELETE 的選擇與理由（RESTRICT、CASCADE 或 SET NULL）',
        'JOIN 回來的結果和原本大表的資料一致，沒有重複列',
      ],
      twist: '交卷後需求變更：一張訂單可以分批出貨，每批有自己的物流單號與出貨日，退貨要知道是哪一批。先預測要新增或修改幾張表、哪些既有查詢會跟著改，再實際改 DDL，比對預測與實際改動的差距；最後寫出哪些約束可以沿用、哪些要跟業務確認（部分出貨時訂單狀態怎麼算、同一品項能不能跨批）。',
    },
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
    challenge: {
      task: '從本課的掛號需求列出至少六條業務不變條件（例如同一位病患同一診次只能有一筆有效掛號、名額不能為負、取消後可以重掛），每一條分配給「資料庫約束」「交易」「應用程式邏輯」其中一層。接著在 [Playground](#/playground?lang=sql) 執行本課的完整 DDL，對分給約束的每一條寫一句會被擋下的 INSERT 或 UPDATE。',
      deliver: '一張三欄表（不變條件、放在哪一層、理由），以及每條約束被擋下時的錯誤訊息與約束名稱。',
      check: [
        '跨列的規則（唯一的有效掛號）用部分唯一索引或約束守住，不靠應用程式先查再寫',
        '要讀多列再判斷的規則標成交易，並寫出用條件式 UPDATE 或哪一種鎖',
        '放在應用程式的條件說明資料庫為什麼擋不了（例如要呼叫外部系統、要看使用者的角色）',
        '每條約束都附上實際跑出的錯誤訊息',
      ],
      twist: '院方新增規則：同一位病患同一天最多掛三個診。先預測它該放哪一層、能不能用一個 CHECK 或唯一索引寫出來，再試著實作，說明預測錯在哪裡（如果有）。',
    },
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
    map: {
      names: [
        { n: 'B-tree 索引', t: '把欄位值排序後另存一份並組成樹，查一個值或一段範圍只要走幾層，依這個欄位 `ORDER BY` 也不用另外排序；代價是每次寫入都要維護。' },
        { n: 'Seq Scan 與 Index Scan', t: '計畫裡的兩種讀法：讀整張表逐列過濾，或沿索引找到位置再回表。表很小或條件留下大部分列時，Seq Scan 是對的選擇。' },
        { n: '`EXPLAIN ANALYZE`', t: '和 `EXPLAIN` 不同，它會實際執行查詢，附上每個節點的時間與列數；估計的 `rows` 和實際差十倍以上，代表統計過期，先跑 `ANALYZE`。' },
        { n: '複合索引', t: '`(user_id, created_at)` 先依 user_id、再依時間排序，能服務「某人的訂單依時間排」，通常不能服務只有 `created_at` 的條件；等值欄位放前，範圍或排序欄位放後。' },
        { n: '選擇性', t: '條件篩掉多少資料。只留下少數列時走索引划算，留下大半時循序讀比較便宜，所以 status 這類欄位查只佔 1% 的值會走索引、查佔六成的值不會。' },
        { n: '部分索引', t: '只收錄符合 `WHERE` 的列，例如 `WHERE status = \'pending\'` 或 `WHERE deleted_at IS NULL`；查詢只關心一小部分列時，索引小、維護也少。' },
        { n: '表達式索引', t: '索引 `lower(email)` 這類運算結果；`WHERE` 裡用函數包住欄位時一般索引用不到，要建寫法一模一樣的表達式索引。' },
        { n: '`CREATE INDEX CONCURRENTLY`', t: '正式環境的大表加索引時不長時間擋寫入，但比較慢、不能放在交易裡，中途失敗會留下 INVALID 的索引。' },
      ],
      ask: [
        '要加速哪幾句查詢（完整的 `WHERE`、`ORDER BY`、`LIMIT`），各自多常跑、目標回應時間多少。',
        '資料量與分佈：現在幾筆、每月長多少、條件欄位各個值佔多少比例。',
        '這張表的寫入量，能接受寫入變慢多少、索引多佔多少空間。',
        '資料庫與版本：PostgreSQL 18 才有 B-tree skip scan，舊版以最左前綴為準。',
        '正式環境怎麼建：用 `CREATE INDEX CONCURRENTLY`，migration 工具要關掉交易包裝。',
      ],
      prompt: '電商的「我的訂單」頁跑 `SELECT id, status, amount, created_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`，orders 有 800 萬筆，現在要 1 秒以上，目標 50 ms 內。資料庫是 PostgreSQL 16，建一個 `(user_id, created_at)` 的複合索引，讓計畫沿索引倒著讀、沒有 Sort 節點，並附上建索引前後的 `EXPLAIN (ANALYZE, BUFFERS)`。正式環境用 `CREATE INDEX CONCURRENTLY`，這個 migration 檔不能包在交易裡；如果已經有單獨 `(user_id)` 的索引，說明它是否變成多餘。',
      verify: [
        { c: '計畫用了索引', t: '對目標查詢跑 `EXPLAIN ANALYZE`：`Seq Scan` 加上很大的 `Rows Removed by Filter` 代表沒用到索引；「我的訂單」這種查詢應該是 `Index Scan Backward` 接 `Limit`，沒有 `Sort`。' },
        { c: '估計與實際', t: '比對同一個節點估計的 `rows=` 和 `actual` 裡的 `rows=`；差十倍以上先 `ANALYZE 表名` 再看一次。' },
        { c: '欄位被包住', t: '找 `WHERE` 裡被函數、轉型或運算包住的欄位：`lower(email)`、`created_at::date`、`user_id::text`，或參數型別和欄位不同（`user_id = 42.0`）；用 ORM 時要看實際送出的 SQL。' },
        { c: '測試資料量', t: '幾十筆的表，規劃器選 Seq Scan 是對的；用 `generate_series` 造出接近正式環境的資料量再看計畫，不拿 `SET enable_seqscan = off` 的結果下結論。' },
        { c: '缺的與多的索引', t: '外鍵欄位要有索引（PostgreSQL 不會自動建）；`pg_stat_user_indexes` 裡 `idx_scan` 長期是 0 的索引是刪除候選，主鍵與唯一索引除外。' },
        { c: 'migration', t: '`CREATE INDEX CONCURRENTLY` 被包進交易會報 `cannot run inside a transaction block`；中途失敗留下的 INVALID 索引用 `\\d 表名` 找出來，`DROP INDEX` 後重建。' },
      ],
    },
    challenge: {
      task: '在 [Playground](#/playground?lang=sql) 依序執行本課「範例資料太小」與「用 generate_series 做出 10 萬筆」兩段。執行第二段之前，先預測 `big_orders WHERE user_id = 42` 在建索引前後各是什麼節點、估計列數（`rows`）大概多少、Buffers 會差幾倍。執行後把兩份 `EXPLAIN ANALYZE` 原文並排比較。',
      deliver: '兩份計畫原文，加上一段比較：節點類型、估計與實際列數、Buffers、Execution Time，以及預測錯的地方。',
      check: [
        '預測寫在執行之前',
        '說出 6 列的 orders 建了索引仍走 Seq Scan 是規劃器的正確選擇，不是索引壞了',
        '指出 Bitmap Index Scan 與 Index Scan 的差別，以及這 10 列分散在幾頁',
        '時間數字標明是瀏覽器內 PGlite 的本機量測，只比數量級，不當成正式環境的效能',
      ],
      twist: '把條件改成 `user_id < 5000`（約一半的列）。先預測計畫會變成 Index Scan、Bitmap 還是 Seq Scan，再執行，用選擇性說明規劃器為什麼這樣選。',
    },
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
    challenge: {
      task: '在 [Playground](#/playground?lang=sql) 建一張 `products_fts(id, name, body)`，放 8 筆自己寫的中文商品說明，`body` 用本課的手動斷詞方式（詞之間加空白），以 `to_tsvector(\'simple\', body)` 建 GIN 索引。執行前列出 5 個查詢詞與你預期命中的商品 id，其中一個預期找不到；再用 `websearch_to_tsquery` 查詢並依 `ts_rank` 排序。',
      deliver: '5 列的對照表：查詢詞、預期命中、實際命中與排名，加上一句搜尋沒結果時畫面要顯示什麼。',
      check: [
        '預期寫在執行之前',
        '至少一個詞因為斷詞的切法不同而沒命中（例如文件寫成「無線藍牙」、查詢是「藍牙」），並說明原因是斷詞，不是索引',
        '排名和自己的主觀判斷不一致的地方寫出原因（詞頻、文件長度、有沒有設權重）',
        '沒結果時的畫面不顯示 tsquery 的錯誤訊息',
      ],
      twist: '同一套搜尋改給演唱會售票網站：使用者會打歌手暱稱、錯字與英文縮寫。先預測哪幾種輸入內建全文檢索處理不了，再說出哪些做法可以沿用（GIN、`websearch_to_tsquery` 接受任何輸入），哪些要跟業務確認（暱稱對照表由誰維護、錯字要不要容錯、改用 pg_trgm 或搜尋引擎）。',
    },
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
    map: {
      names: [
        { n: '交易', t: '`BEGIN` 到 `COMMIT` 之間的操作全部生效或全部不算；中間任何一句失敗，整個交易作廢，要 `ROLLBACK`。' },
        { n: '隔離等級', t: '並行的交易看得到彼此多少。PostgreSQL 預設 `READ COMMITTED` 每一句重拍快照，`REPEATABLE READ` 整個交易用同一份，`SERIALIZABLE` 要求結果等同依序執行。' },
        { n: 'lost update', t: '兩個請求都讀到舊值、在程式裡算好再寫回，後寫的蓋掉先寫的，最後一件商品賣給兩個人；在 `READ COMMITTED` 下包進交易也擋不住。' },
        { n: '條件式 `UPDATE`', t: '`UPDATE products SET stock = stock - 1 WHERE id = $1 AND stock > 0 RETURNING stock`：判斷和扣減在同一句完成，更新 0 列代表售完。' },
        { n: '`SELECT ... FOR UPDATE`', t: '先鎖住要改的列再判斷，其他要改同一列的交易排隊到你 COMMIT；判斷邏輯塞不進一句 `WHERE` 時用（限購、會員等級）。' },
        { n: '樂觀鎖', t: '資料表加 `version` 欄位，更新時帶 `WHERE version = <讀到的值>`；更新到 0 列代表有人先改了，重讀再試。適合衝突少的情況。' },
        { n: '可重試的錯誤', t: '`40001`（序列化失敗）與 `40P01`（死結）要整個交易重做；`23505`（違反唯一鍵）是邏輯錯誤，重試也一樣失敗。' },
      ],
      ask: [
        '哪些操作要在同一個交易裡（例如扣名額與新增掛號），任何一步失敗時整組撤銷。',
        '並行時要守住的規則（名額不能為負、同一位病人同一診次只能掛一次），用條件式 `UPDATE`、`FOR UPDATE` 還是樂觀鎖守住。',
        '隔離等級；用 `REPEATABLE READ` 以上時，序列化失敗怎麼重試、最多幾次。',
        '交易裡不做的事：金流、寄信、簡訊這類外部呼叫放在 COMMIT 之後，或用 outbox 交給背景工作。',
        '搶不到或衝突時使用者看到什麼，哪些錯誤自動重試、哪些直接回報。',
      ],
      prompt: '門診掛號的 `POST /appointments`：同一個交易裡先扣診次名額、再新增掛號，任何一步失敗就 ROLLBACK。扣名額用一句條件式 `UPDATE sessions SET remaining = remaining - 1 WHERE id = $1 AND remaining > 0 RETURNING remaining`，更新 0 列代表額滿，回 `409`；不要先 `SELECT` 出名額、在程式裡判斷再寫回。隔離等級維持 `READ COMMITTED`，遇到 `40P01` 死結整個交易重做，最多 3 次；`23505`（同一位病人重複掛號）不重試，回 `409`。確認簡訊在 COMMIT 之後才送。',
      verify: [
        { c: '並行測試', t: '把名額設成 1，用 `xargs -P 20` 同時送 20 個 `curl`：應該只有 1 個成功、其餘 `409`，名額停在 0。成功超過 1 個代表有 lost update。' },
        { c: '讀→算→寫', t: '在程式裡找先 `SELECT` 出數量、在程式判斷、再 `UPDATE ... SET remaining = <算好的值>` 的寫法；這是最常見的錯，AI 產生的程式也常這樣寫，改成條件式 `UPDATE` 或 `FOR UPDATE`。' },
        { c: '原子性', t: '讓第二步故意失敗（例如重複掛號），查名額有沒有回到原值；沒回來代表兩步不在同一個交易，或連線開著自動提交。' },
        { c: '交易範圍', t: '交易裡不該有 HTTP 呼叫或等待；`SELECT pid, state, xact_start, query FROM pg_stat_activity WHERE state = \'idle in transaction\';` 長時間有結果，代表有交易開著沒結束。' },
        { c: '重試', t: '重試的單位是整個交易，只針對 `40001`、`40P01`，而且有次數上限；重試清單裡有 `23505`，或只重送失敗的那一句，都要改。' },
        { c: '有沒有 COMMIT', t: '寫入後從另一個連線（例如 `psql`）查得到資料；查不到通常是忘了 COMMIT，連線關掉時交易被 rollback。' },
      ],
    },
    challenge: {
      task: '開 [兩個交易搶最後一件](#/lab/TxnLab) 實驗室，隔離等級（READ COMMITTED、REPEATABLE READ）乘以做法（讀→算→寫、一句條件 UPDATE、SELECT … FOR UPDATE）共六種組合。每一種先寫下預測：T2 最後讀到的庫存、誰在等鎖、有沒有錯誤、成立幾張訂單，再逐步播放核對。',
      deliver: '六格的預測與實際對照表，預測錯的格子各一句原因。',
      check: [
        '六格都有播放前的預測',
        '讀→算→寫在 READ COMMITTED 下成立兩張訂單，並說出包在交易裡也擋不住的原因',
        'REPEATABLE READ 出現的錯誤寫出 SQLSTATE `40001`，以及應用程式要重做整個交易',
        '說明條件 UPDATE 與 FOR UPDATE 各在什麼需求下選用',
      ],
      twist: '換成音樂祭的票務：一張訂單要同時扣「場次總量」與「該票種的剩餘量」兩列。先預測一句條件 UPDATE 還夠不夠、兩張訂單會不會互相死結，再說出哪些條件可以沿用（扣減與判斷在同一句、固定上鎖順序），哪些要跟業務確認（一人限購幾張、未付款的保留票多久釋出）。',
    },
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
    challenge: {
      task: '用本課死結那段 Python 模擬，跑兩組計畫：`{"A": [1, 2], "B": [2, 3], "C": [3, 1]}` 與 `{"A": [1, 2], "B": [2, 3], "C": [3, 4]}`。執行前先畫出每組的等待關係（誰握著哪一列、在等誰），預測哪一組會形成環。接著為下表的每一種錯誤決定處理方式：重試整個交易、稍後重跑、或不重試：`40P01`、`55P03`（lock timeout）、`55P03`（NOWAIT）、`57014`、`23505`。',
      deliver: '兩張等待關係圖（文字畫也可以）與預測、實際輸出，加上一張錯誤碼對處理方式的表。',
      check: [
        '等待圖的每條邊標出「誰等誰、等哪一列」，有環的那一組指出環',
        '說明死結被偵測後中止的是整個交易，所以重試的單位是整個交易，不是失敗的那一句',
        '兩種 `55P03` 分開處理（migration 稍後重跑、NOWAIT 回「處理中」），`23505` 不重試',
        '重試寫出次數上限',
      ],
      twist: '把三個交易都改成依 id 由小到大上鎖。先預測環會不會消失、有沒有交易要等比較久，再執行並說明原因。',
    },
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
    challenge: {
      task: '在 [Playground](#/playground?lang=sql) 先執行 `INSERT INTO orders VALUES (107, 2, \'paid\', 3290, \'2026-03-12 16:45+08\');`，和 106 號訂單同一位使用者、同時間、同金額。執行前預測：\n\n1. 「每位使用者最新一筆」用 `ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC)` 取 `rn = 1`，Bob 拿到哪一筆\n2. 改用 `RANK()`，Bob 有幾列\n3. 全部訂單依金額排名，`RANK()` 與 `DENSE_RANK()` 在 3290 之後的下一個名次各是多少',
      deliver: '三個預測與實際結果，加上你為「最新一筆」補上的決勝鍵與理由。',
      check: [
        '預測寫在執行之前',
        '說出同值時 ROW_NUMBER 選哪一筆沒有保證，換資料或換計畫可能不同',
        '補上決勝鍵（例如 `ORDER BY created_at DESC, id DESC`）後結果固定，並說明 id 能當決勝鍵的前提',
        '用實際的名次數字說明 RANK 與 DENSE_RANK 的差別',
      ],
      twist: '需求變成「每位使用者最近三筆，同一秒的訂單要一起列出」。先預測該用 ROW_NUMBER、RANK 還是 DENSE_RANK，Bob 會有幾列，再寫出來驗證。',
    },
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
    challenge: {
      task: '替「把 `users.name` 改名為 `display_name`」寫一份 expand–contract 計畫，部署是滾動更新，新舊版本的程式會並存幾分鐘。每一步寫出：migration 的 SQL、這一步上線的程式版本、此時舊版與新版各讀寫哪個欄位。在 [Playground](#/playground?lang=sql) 把每一步的 migration 實際跑一次，每步之後各執行一句「舊版程式會送的 SQL」與「新版程式會送的 SQL」。',
      deliver: '步驟表（migration、程式版本、新舊版讀寫的欄位），以及每一步兩句 SQL 的執行結果。',
      check: [
        '每一步之後舊版與新版的 SQL 都成功，沒有一步要求兩版同時停機',
        '先讓新程式雙寫、再回填舊資料，回填可以重跑而結果不變',
        '刪舊欄位排在所有舊版程式下線之後，並寫出怎麼確認沒有程式還在讀它',
        '指出 autogenerate 會把這次改名產生成 drop 加 add，計畫裡的 migration 是手寫或手改的',
      ],
      twist: '部署到一半，新版有 bug 要回滾到上一版程式。先預測在哪幾步回滾是安全的、哪一步之後回滾會出錯，再用步驟表逐步驗證。',
    },
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
    challenge: {
      task: '在自己的電腦用 Docker 起兩個 PostgreSQL 容器（來源與還原目標），在來源建本站 Playground 的電商四張表與資料。寫一份還原演練腳本：`pg_dump -Fc` 備份、在目標 `pg_restore`、用應用程式的帳號連上去，查出 Alice 的訂單並新增一筆訂單。演練的結束條件是這筆業務請求成功，不是 `pg_restore` 結束。腳本在每一步前後記下時間。',
      deliver: '腳本、一次實際執行的計時紀錄（各步驟與總長），以及最後那筆業務請求的輸出。',
      check: [
        '結束條件是業務請求成功：查得到既有訂單、新訂單寫得進去',
        '記下還原後才發現缺的東西（例如應用程式的角色與權限，`pg_dump` 不會備份角色），並補進腳本',
        '計時標明機器、資料量與 PostgreSQL 版本，是本機量測，不直接當成正式環境的 RTO',
      ],
      twist: '演練改成「有人誤刪了 orders，要回到誤刪前一分鐘」。先預測只靠每日 `pg_dump` 最多會丟多少資料、要做到一分鐘需要什麼（WAL 歸檔與 PITR），再寫出要跟業務確認的 RPO 與 RTO 數字，以及哪些步驟可以沿用到門診系統、哪些要重新確認（可以停機多久、哪些資料可以事後補）。',
    },
    points: [
      { b: '備份三件事', t: '自動化（每天 `pg_dump` 或受管服務快照）、異地存放、**定期還原演練**並記錄花多久（RTO）。有 WAL 歸檔才能做時間點還原（PITR）。' },
      { b: '連線是稀缺資源', t: 'PostgreSQL 每個連線是一個程序，`max_connections` 通常一兩百。API worker 數 × 每個 pool 大小要小於它；多實例時用 pgbouncer 做連線池。' },
      { b: '慢查詢 log', t: '`log_min_duration_statement = 500ms` 把慢查詢記下來，配合 `pg_stat_statements` 看哪條查詢總耗時最高，從那條開始優化。' },
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
    challenge: {
      task: '開 [表格 vs 文件](#/lab/DocVsRelLab) 實驗室，在三種模式各新增 5 則留言，記下每次寫入動到的範圍。接著用本課「文件大小」那段 Python 估算：一篇熱門文章每天 2,000 則留言、每則 300 個中文字（示意數字），把留言全部嵌入文章時幾天會碰到 16MB 上限。最後寫下這篇文章的嵌入或參照決定。',
      deliver: '三種模式的寫入範圍對照、估算的算式與假設，以及設計決定與理由。',
      check: [
        '估算寫出每則留言的位元組數假設（中文在 UTF-8 是 3 bytes，加上欄位名與 BSON 的額外開銷）',
        '決定說明文章頁一次顯示多少留言、留言會不會被單獨查詢或修改',
        '選「嵌入最新 N 則、全部另存」時，寫出兩邊不一致時以哪邊為準',
      ],
      twist: '需求改成每則留言可以按讚，文章頁要顯示讚數最多的前 3 則。先預測原本的設計要改哪裡、哪一個操作變貴，再說明改法。',
    },
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
    challenge: {
      task: '執行本課 ESR 那段 SQL（PostgreSQL 的 B-tree 遵守同樣的規則），把三句 `EXPLAIN (COSTS OFF)` 改成 `EXPLAIN (ANALYZE, BUFFERS)`。執行前先預測三種索引順序各會不會有 Sort 節點、大約讀幾列才拿到 20 筆。執行後把結果翻成 MongoDB 的 `explain("executionStats")` 欄位：哪個數字對應 `totalKeysExamined`、`totalDocsExamined`、有沒有 `SORT` stage。',
      deliver: '三種索引的預測與實際對照（Sort 有無、讀了幾列、Buffers），以及對應到 MongoDB explain 欄位的表。',
      check: [
        '預測寫在執行之前',
        '用「讀了幾列」相對「回傳 20 列」的比例判斷索引效率，不只看有沒有用到索引',
        '說出 E-R-S 順序為什麼仍然要排序',
        '數字註明是瀏覽器內的本機量測；有本機 MongoDB 的話，用同樣的資料再跑一次 explain 對照',
      ],
      twist: '範圍條件改成只查最近 3 天（`created_at >= \'2026-10-25\'`）。先預測 ESR 那個索引還是不是最好的選擇，再執行，說明範圍很窄時欄位順序的取捨。',
    },
    points: [
      { b: 'aggregation 是管線', t: '`$match` → `$group` → `$sort` → `$project` 一階段接一階段，跟 SQL 的 WHERE / GROUP BY / ORDER BY 對應。`$match` 越早越好，才能用索引。' },
      { b: '索引規則跟 B-tree 一樣', t: '複合索引最左前綴、ESR 原則（Equality → Sort → Range 排欄位順序）、`explain("executionStats")` 看有沒有 COLLSCAN。' },
      { b: '更新運算子而非整份覆寫', t: '`$set`、`$inc`、`$push`、`$addToSet`：只送變更、原子、少傳輸。整份 replace 會在並發時互相覆蓋。' },
      { b: '注意查詢運算子注入', t: '把使用者輸入直接當 filter（`{"password": req.body.password}`）會被 `{"$gt": ""}` 繞過，輸入要先驗證是字串。' },
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
    challenge: {
      task: '改本課 cache-aside 那段 Python：建 4 個 `FakeRedis`（共用同一個 `clock` 與 `db`），模擬 4 個 worker 各有一份程序內快取。4 個 worker 先各讀一次，讓 worker 1 改名並刪掉自己的快取，接著 4 個 worker 各讀一次、30 秒後再讀、61 秒後再讀。改程式之前先預測每次讀到新名字還是舊名字。最後改成 4 個 worker 共用同一個 `FakeRedis` 再跑一次。',
      deliver: '兩種版本的輸出（每個 worker 每次讀到的值與時間），預測對照，加上一句結論：刪除快取的效果傳到了哪裡。',
      check: [
        '預測寫在改程式之前',
        '各自一份快取的版本指出其他 3 個 worker 在 TTL 到期前回舊名字',
        '共用快取的版本說明刪一次全部生效，並指出還剩哪一種並發交錯會留下舊值',
        '提出至少一種讓程序內快取也能失效的做法（縮短 TTL、pub/sub 廣播、改用共用快取），並寫出代價',
      ],
      twist: '換成航空公司的座位圖：每秒被讀上千次，但「已售出」必須立刻反映。先預測 cache-aside 加 TTL 還適不適用，再說出哪些做法可以沿用（先寫 DB 再刪快取、TTL 當安全網），哪些要跟業務確認（可以容忍幾秒的舊資料、真的超賣時怎麼補救）。',
    },
    points: [
      { b: 'cache-aside', t: '讀：先查快取，miss 才查 DB 並回寫快取（帶 TTL）。寫：更新 DB 後刪快取，不去更新快取（刪比較不會出錯）。' },
      { b: 'TTL 是安全網', t: '就算失效邏輯漏了，資料最多舊 TTL 那麼久。依「可以容忍多舊」決定 TTL。' },
      { b: '快取穿透、雪崩、擊穿', t: '查不存在的 key 每次都打 DB（快取空值）；大量 key 同時過期（TTL 加隨機抖動）；熱 key 過期瞬間大量 miss（加鎖或提前更新）。' },
      { b: 'Redis 不只是快取', t: '限流計數器（INCR + EXPIRE）、分散式鎖、排行榜（sorted set）、session 儲存、簡單佇列（list / stream）。' },
      { b: 'key 要有命名規範', t: '`user:42:profile`、`ratelimit:login:ip:1.2.3.4`。有前綴才能批次管理與觀察。' },
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
    challenge: {
      task: '本課開頭的四人團隊接到新案子：餐廳訂位平台，功能有訂位、桌位與時段、候補名單、評論、熱門餐廳排行。用本課的六個判斷依據選出主資料庫，以及（如果需要）第二個資料儲存。',
      deliver: '一張六列的判斷表（依據、這個平台的情況、結論），最後的選擇，以及三條「出現什麼訊號就改變這個決定」。',
      check: [
        '六個依據都寫到這個平台的具體情況，不是通用描述',
        '同一張桌子同一時段不能重複訂，對應到交易、約束或鎖的做法',
        '加第二個資料儲存時寫出同步方式，以及兩邊不一致時以哪邊為準',
        '寫出哪些判斷可以沿用到其他業務，哪些要跟業務或團隊確認（評論量、尖峰時段、團隊熟悉哪種資料庫）',
      ],
      twist: '半年後新增需求：每家餐廳每 5 分鐘的訂位量與取消率，保留兩年，給餐廳看趨勢。先預測原本的選擇撐不撐得住、要不要加資料庫，再用同一張表重評一次，說明改選或不改選的條件。',
    },
    points: [
      { b: '預設選關聯式', t: '交易、約束、JOIN、成熟工具鏈，涵蓋大多數業務系統的需求。PostgreSQL 的 JSONB 還能兼顧半結構化資料。' },
      { b: '文件式適合的情境', t: '每筆資料形狀差異大、幾乎都是整份讀寫、需要水平擴展寫入、快速迭代原型。' },
      { b: '一致性 vs 可用性', t: '分散式系統在網路分割時要選一邊（CAP）。單機 PostgreSQL 強一致；分散式 NoSQL 多半最終一致。選之前先確認業務能不能接受「短暫看到舊資料」。' },
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

// 後續新增的課，內文放在 parts/ 底下，這裡合併
export default { ...base, ...m3 }

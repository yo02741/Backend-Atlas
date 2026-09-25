// 題庫：資料儲存（PostgreSQL / SQL / MongoDB / Redis）
export default [
  {
    skill: 'sql-basics',
    questions: [
      {
        q: '這條查詢在 PostgreSQL 執行會報錯。根本原因是什麼？',
        code: `SELECT city, COUNT(*) AS cnt
FROM orders
WHERE cnt > 3
GROUP BY city;`,
        lang: 'sql',
        options: [
          'COUNT(*) 不能取別名，要寫成 COUNT(1) 才能在後面的子句引用',
          'WHERE 在 SELECT 之前執行，別名 cnt 此時還不存在；聚合條件要放 HAVING',
          'GROUP BY 必須寫在 WHERE 之前，兩者順序顛倒導致解析失敗',
          '聚合欄位要放在 GROUP BY 欄位之後，WHERE 才看得到它的值',
        ],
        answer: 1,
        explain: 'SQL 的邏輯執行順序是 FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY，WHERE 跑的時候 SELECT 的別名還沒被算出來，所以 cnt 不存在；而且 WHERE 是逐列過濾，根本沒有「群組」可以數。對群組結果的條件要放 HAVING COUNT(*) > 3。書寫順序（GROUP BY 在 WHERE 後）本來就是對的，COUNT(*) 取別名也完全合法。',
      },
      {
        q: 'orders 表有 10 列：6 列 status 是 paid、3 列是 pending、1 列 status 為 NULL。這條查詢回傳的數字是？',
        code: `SELECT COUNT(*) FROM orders WHERE status != 'paid';`,
        lang: 'sql',
        options: [
          '4 筆——NULL 不是 paid，所以也會被算進去',
          '10 筆——!= 對每一列都成立，包含 paid 的列',
          '3 筆——status 為 NULL 的那一列被排除了',
          '查詢會報錯——NULL 不能用 != 運算子比較',
        ],
        answer: 2,
        explain: `NULL != 'paid' 的結果不是 true 也不是 false，而是 NULL；WHERE 只保留結果為 true 的列，所以那筆 NULL 被默默丟掉，只剩 3 筆 pending。這就是三值邏輯的地雷：想把 NULL 也算進「不是 paid」，要寫 WHERE status != 'paid' OR status IS NULL，或用 status IS DISTINCT FROM 'paid'。比較 NULL 不會報錯，只是結果不如直覺。`,
      },
      {
        q: '你在設計訂單表，要存單價與總金額（新台幣，到小數兩位）。欄位型別該選哪個？',
        options: [
          'DOUBLE PRECISION——浮點數運算最快，兩位小數綽綽有餘',
          'NUMERIC(12,2)——定點十進位，加總不會出現 0.1 + 0.2 ≠ 0.3 的誤差',
          'REAL——比 DOUBLE 省一半空間，金額用不到那麼多精度',
          'TEXT——保留使用者輸入的原始字串最不失真，計算時再轉型',
        ],
        answer: 1,
        explain: '金額要用 NUMERIC / DECIMAL：它以十進位精確儲存，加總一萬筆不會累積出幾分錢的誤差。DOUBLE PRECISION 與 REAL 都是二進位浮點數，0.1 這種值根本無法精確表示，對帳時就會出現差一分錢的鬼故事。TEXT 無法直接做算術與比較、也無法靠型別擋掉垃圾資料。同理：時間用 TIMESTAMPTZ、id 用 BIGINT 或 UUID。',
      },
    ],
  },
  {
    skill: 'sql-joins',
    questions: [
      {
        q: '報表要列出「所有使用者及其訂單數」，沒下過單的使用者也要出現且顯示 0。哪個組合正確？',
        options: [
          'INNER JOIN orders 再 COUNT(*)——INNER 才不會多出重複列',
          'LEFT JOIN orders 再 COUNT(*)——LEFT 會保住沒訂單的使用者',
          'LEFT JOIN orders 再 COUNT(o.id)——沒訂單的人右側是 NULL，COUNT(欄位) 不計 NULL 才會是 0',
          'FULL JOIN orders 再 COUNT(*)——兩邊的列都保留最保險',
        ],
        answer: 2,
        explain: '要保住沒訂單的使用者一定得用 LEFT JOIN（INNER 只留配對成功的列）。但 LEFT JOIN 後，沒訂單的使用者仍然佔一列，只是 orders 那側全是 NULL——COUNT(*) 會把這一列算成 1，等於憑空多一筆訂單；COUNT(o.id) 不計 NULL 才會得到正確的 0。FULL JOIN 會把 user_id 對不到使用者的孤兒訂單也帶進來，不是這個報表要的。',
      },
      {
        q: '這條查詢的結果集會是什麼？',
        code: `SELECT u.name, o.id
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE o.status = 'paid';`,
        lang: 'sql',
        options: [
          '所有使用者都會出現；沒有 paid 訂單的使用者 o.id 顯示 NULL',
          '只剩有 paid 訂單的使用者——WHERE 把右側為 NULL 的列一起濾掉，效果等同 INNER JOIN',
          '語法錯誤：LEFT JOIN 的右表欄位不能出現在 WHERE 子句',
          '所有使用者都會出現；沒有 paid 訂單的使用者會列出其他狀態的訂單',
        ],
        answer: 1,
        explain: 'LEFT JOIN 先保住每個使用者（沒訂單的右側補 NULL），然後 WHERE 才執行：NULL = \'paid\' 不為 true，這些列全被濾掉，最後只剩有 paid 訂單的人，LEFT 白寫了。想「列出所有使用者，只顯示 paid 訂單」，過濾右表的條件要搬進 ON：LEFT JOIN orders o ON o.user_id = u.id AND o.status = \'paid\'。ON 決定配對、WHERE 決定保留，這是 LEFT JOIN 最常踩的坑。',
      },
      {
        q: '某使用者有 3 筆訂單、2 個地址。針對這位使用者，這條查詢算出的 SUM(o.amount) 會怎樣？',
        code: `SELECT u.id, SUM(o.amount) AS total, COUNT(a.id) AS addr_count
FROM users u
JOIN orders o    ON o.user_id = u.id
JOIN addresses a ON a.user_id = u.id
GROUP BY u.id;`,
        lang: 'sql',
        options: [
          '被算成正確值的 2 倍，且 addr_count 會是 6 而不是 2',
          '正確——GROUP BY u.id 會把重複的列合併掉再聚合',
          '被算成正確值的 3 倍，因為每筆訂單配對到 3 列',
          '被算成正確值的 6 倍，兩個 JOIN 的倍數會相乘',
        ],
        answer: 0,
        explain: 'JOIN 是在配對列：3 筆訂單 × 2 個地址 = 6 列，每筆訂單出現 2 次，所以 SUM(o.amount) 是 2 倍、COUNT(a.id) 是 6。GROUP BY 只是把這 6 列壓成一組再聚合，救不回被放大的數字。兩個獨立的一對多同時 JOIN 到同一張表，就是重複計算金額的根源；正確做法是先各自在子查詢／CTE 裡聚合好再 JOIN，或分兩條查詢。',
      },
    ],
  },
  {
    skill: 'data-modeling',
    questions: [
      {
        q: '檢視這張 orders 表的 DDL。哪個欄位是該修掉的正規化問題、哪些是合理的快照？',
        code: `CREATE TABLE orders (
  id             BIGINT PRIMARY KEY,
  customer_id    BIGINT NOT NULL REFERENCES customers(id),
  customer_email TEXT   NOT NULL,
  product_name   TEXT   NOT NULL,
  unit_price     NUMERIC(12,2) NOT NULL
);`,
        lang: 'sql',
        options: [
          'customer_email、product_name、unit_price 都是重複資料，應全部刪掉改用 JOIN 取得',
          '三個都是合理快照——訂單本來就該把成交當下看到的客戶與商品資訊完整記下來',
          'customer_email 是違反 3NF 的重複，客戶換信箱後會不一致；product_name / unit_price 則是合理的成交快照',
          'product_name / unit_price 該刪掉改 JOIN products，customer_email 保留方便寄出通知信',
        ],
        answer: 2,
        explain: '正規化的目的是「一件事實只存一處」：客戶目前的 email 屬於 customers，訂單透過 customer_id 指過去就好，複製一份在客戶改信箱後就會出現兩個版本。但商品名稱與單價不同——訂單要記的是「成交當時」的值，商品之後改名、漲價都不該影響歷史訂單，這是有意識的反正規化（快照），不是錯誤。判斷標準是：這個值會不會隨來源更新而應該跟著變？會 → 參照；不該變 → 快照。',
      },
      {
        q: '一個使用者可以有多個角色，一個角色也可以指派給多個使用者。schema 該怎麼設計？',
        options: [
          'users 表加 roles TEXT 欄位，存逗號分隔的角色 id',
          'users 表加 role_ids BIGINT[] 陣列欄位，查詢時用 ANY()',
          'roles 表加 user_id 外鍵，每個角色一列指向它的使用者',
          '建 user_roles(user_id, role_id) 中介表，兩欄都是外鍵並設複合主鍵',
        ],
        answer: 3,
        explain: '多對多一定要中介表：user_roles 每列代表一組指派，複合主鍵擋掉重複指派，兩個外鍵保證引用的使用者與角色都存在，兩方向的查詢與 JOIN 都能用索引。逗號字串無法用外鍵約束、無法有效索引、查「誰有這個角色」要全表掃描；陣列欄位雖然 PostgreSQL 支援，但同樣沒有外鍵完整性，刪掉一個角色時所有陣列都要手動清。roles 加 user_id 只做得到一對多，同一個角色要給第二個人就得複製一列角色。',
      },
      {
        q: '訂單金額不能是負數。這個規則應該在哪裡驗證？',
        options: [
          '資料庫加 CHECK (amount >= 0) 當底線，任何程式、任何路徑寫入都會被擋；應用層可再驗以回友善訊息',
          '只在應用層驗證——資料庫約束會拖慢寫入，而且錯誤訊息對使用者不友善',
          '在 ORM model 的 validator 驗證就夠了，所有寫入都會經過 ORM，效果等同資料庫約束',
          '用 BEFORE INSERT trigger 把負數自動修正成 0，寫入不會失敗、資料也不會是負的',
        ],
        answer: 0,
        explain: '約束是最便宜也最可靠的驗證：不管是 API、後台腳本、資料修補 SQL 還是下一個接手的同事，CHECK 都會擋住。應用層／ORM 驗證只保護「走過那段程式碼」的路徑，直接下 SQL 或另一個服務寫入就繞過了，所以它是補充不是替代。CHECK 的成本極低，跟「拖慢寫入」的索引不是同一回事。trigger 靜靜把 -100 改成 0 更糟：資料錯了卻沒有人知道。',
      },
    ],
  },
  {
    skill: 'indexes',
    questions: [
      {
        q: 'orders 表上建了這個複合索引。下列哪條查詢**無法**有效利用它？',
        code: `CREATE INDEX idx_orders_user_time ON orders (user_id, created_at);`,
        lang: 'sql',
        options: [
          `WHERE user_id = 42`,
          `WHERE user_id = 42 ORDER BY created_at DESC`,
          `WHERE created_at > now() - interval '7 days'`,
          `WHERE user_id = 42 AND created_at > now() - interval '7 days'`,
        ],
        answer: 2,
        explain: 'B-tree 複合索引是先依 user_id 排、同一 user_id 內再依 created_at 排，所以條件必須從最左欄位開始才能定位（最左前綴）。只給 created_at 等於在一本「先按姓氏、再按名字排」的通訊錄裡找所有叫「小明」的人——只能整本翻。另外三條都以 user_id 開頭：等值查詢直接定位、加 ORDER BY created_at 還能省掉排序、範圍條件則在該使用者的區段內掃一段。要常單獨查時間，就得另建 (created_at) 索引。',
      },
      {
        q: 'users.email 上有索引，但 EXPLAIN 顯示走 Seq Scan。為什麼，怎麼修？',
        code: `CREATE INDEX idx_users_email ON users (email);

EXPLAIN SELECT * FROM users WHERE LOWER(email) = 'amy@example.com';
--  Seq Scan on users  (cost=0.00..2345.00 rows=1 width=120)
--    Filter: (lower(email) = 'amy@example.com'::text)`,
        lang: 'sql',
        options: [
          '表太大時 PostgreSQL 會放棄用索引，設 enable_seqscan = off 強制走索引即可',
          '索引存的是 email 原值，套上 LOWER() 後對不上；要建 (LOWER(email)) 表達式索引或改用 citext',
          'B-tree 不支援對文字欄位做等值比對，要改建 hash 索引才會被使用',
          '索引剛建好統計還沒更新，跑一次 ANALYZE users 計畫器就會改用索引',
        ],
        answer: 1,
        explain: '索引裡排好序的是 email 的原始值，查詢比較的卻是 LOWER(email) 的結果——兩者不是同一個東西，索引幫不上忙。解法是讓索引也存運算結果：CREATE INDEX ON users (LOWER(email))，或在寫入時就正規化成小寫、或改用不分大小寫的 citext。同類情況還有 LIKE \'%abc\'（前置萬用字元）與對欄位做算術／型別轉換。關掉 enable_seqscan 只是逼計畫器做錯事，ANALYZE 更新的是統計而非這個結構性問題。',
      },
      {
        q: 'DELETE FROM users WHERE id = 1 要跑 8 秒。orders 表有 user_id BIGINT REFERENCES users(id) 外鍵、幾千萬列。最可能的原因與修法？',
        options: [
          'users 的主鍵索引損壞，REINDEX TABLE users 重建後刪除就會恢復正常',
          '外鍵約束本身就慢，幾千萬列的表應拿掉外鍵改由應用層維護關聯',
          'DELETE 會同步觸發 VACUUM 清理舊版本，等它跑完後續刪除就快了',
          'PostgreSQL 不會自動幫外鍵欄位建索引，檢查 orders 有無引用時只能掃全表；補上 orders(user_id) 索引',
        ],
        answer: 3,
        explain: '刪除被引用的那一方時，資料庫必須確認 orders 裡沒有（或依 ON DELETE 規則處理）引用這位使用者的列，這個檢查等於 SELECT ... FROM orders WHERE user_id = 1。PostgreSQL 只替被引用端（主鍵）建索引，引用端的 user_id 要自己建，否則每次刪除、每次 JOIN 都是全表掃描。這是 PostgreSQL 與 MySQL InnoDB（會自動建）的差異之一。拿掉外鍵是丟掉資料完整性換效能，VACUUM 也不是同步在 DELETE 裡跑的。',
      },
    ],
  },
  {
    skill: 'transactions',
    questions: [
      {
        q: '庫存扣減寫成下面這樣，在 PostgreSQL 預設的 READ COMMITTED 下，兩個請求同時進來會超賣。哪個修法真正解決問題？',
        code: `qty = db.execute(text("SELECT qty FROM stock WHERE id = 1")).scalar()
if qty > 0:
    db.execute(text("UPDATE stock SET qty = qty - 1 WHERE id = 1"))
    db.commit()`,
        lang: 'python',
        options: [
          '把整段包進 BEGIN / COMMIT，交易的原子性會保證兩個請求不會同時扣到同一筆庫存',
          '在 Python 端加 threading.Lock()，同一時間只讓一個請求進到讀取與扣減這段',
          'SELECT 改成 … FOR UPDATE 鎖住該列再判斷；或改成單句 UPDATE … SET qty = qty - 1 WHERE id = 1 AND qty > 0 並檢查影響列數',
          '把 UPDATE 改成 SET qty = :qty - 1，用剛讀到的值算好新庫存再寫回去',
        ],
        answer: 2,
        explain: '問題在「先讀再判斷再寫」中間別人也讀到同一個 1。FOR UPDATE 讓第二個請求在 SELECT 就得等第一個 commit，等到後重讀會看到 0；單句 UPDATE ... AND qty > 0 則讓資料庫在取得列鎖後重新評估條件，第二個請求會更新 0 列，程式看影響列數就知道沒搶到。光包交易不會擋住兩個交易各自讀到 1（原子性管的是全做或全不做，不是互斥）；threading.Lock 只在單一進程有效，多 worker、多台機器就失效；用讀到的值寫回是教科書級的 lost update。',
      },
      {
        q: '同一個交易內執行了兩次相同的 SELECT，中間另一個交易 commit 了對那些列的更新。在哪個隔離等級下，兩次結果可能不同？',
        options: [
          '只有 READ COMMITTED——每個語句都看新的快照，所以會讀到別人剛 commit 的變更',
          'READ COMMITTED 與 REPEATABLE READ 都會不同，只有 SERIALIZABLE 保證一致',
          '三種等級都一樣：交易內讀到的資料永遠一致，這就是隔離性的定義',
          '只有 SERIALIZABLE 會不同，因為它會自動重試並讀取最新的值',
        ],
        answer: 0,
        explain: 'READ COMMITTED（PostgreSQL 預設）的快照是「每個語句」建立的，所以同一交易的第二次 SELECT 看得到別人在中間 commit 的結果（不可重複讀）。REPEATABLE READ 的快照在交易的第一個語句就固定，之後整個交易看到的都是那一刻的資料；SERIALIZABLE 在此之上再檢查交易間有沒有無法序列化的相依，有就丟錯誤讓你重試——它不會偷偷讀最新值。隔離性是「程度」，不是三個等級都一樣。',
      },
      {
        q: '建訂單流程：BEGIN → INSERT orders → 呼叫第三方金流 API（約 2 秒）→ INSERT payments → COMMIT。這個設計最大的問題是什麼？',
        options: [
          '沒有問題——三步一起 commit 才能保證訂單與付款是原子的，拆開反而會不一致',
          '應該改成 SERIALIZABLE 隔離等級，才能保證金流 API 的結果與資料庫狀態一致',
          '只要把金流 API 呼叫搬到 BEGIN 之前，其他步驟維持在同一個交易裡就好',
          '交易握著鎖與連線等外部 API 2 秒，高並發時連線池耗盡、其他交易排隊；應先 commit pending 訂單，API 回來再開新交易更新',
        ],
        answer: 3,
        explain: '交易要短：開著的交易握有鎖、快照與一條連線，外部 API 的延遲（甚至逾時）會直接放大成整個資料庫的阻塞。正確拆法是「開交易 → 只做 DB 操作 → commit」，把等待放在交易外，用狀態欄位（pending / paid / failed）記錄流程進度，並設計成可重試或補償。資料庫交易本來就無法把外部系統納入原子性，換隔離等級也不會改變這點；把 API 搬到最前面則會在扣款成功後才發現訂單建不起來。',
      },
    ],
  },
  {
    skill: 'sql-advanced',
    questions: [
      {
        q: '這條查詢回傳什麼？',
        code: `WITH ranked AS (
  SELECT o.*,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
  FROM orders o
)
SELECT * FROM ranked WHERE rn = 1;`,
        lang: 'sql',
        options: [
          '全部訂單，每列多一欄該使用者的訂單總數',
          '每個使用者最新的一筆訂單，每人恰好一列',
          '每個使用者最早的一筆訂單，每人恰好一列',
          '整張表最新的一筆訂單，結果只有一列',
        ],
        answer: 1,
        explain: 'PARTITION BY user_id 把訂單依使用者分組（但不縮列），ORDER BY created_at DESC 讓每組最新的那筆拿到 rn = 1，外層取 rn = 1 就是「每人最新一筆」。改成 ASC 才是最早一筆；沒有 PARTITION BY 才會是全表排名。要包一層 CTE 是因為視窗函數在 SELECT 階段才計算，WHERE 裡不能直接寫 ROW_NUMBER() OVER (...) = 1。PostgreSQL 也可以用 DISTINCT ON (user_id) ... ORDER BY user_id, created_at DESC 一句解決。',
      },
      {
        q: 'orders.user_id 允許 NULL（訪客訂單）。這條「找出從未下單的使用者」的查詢會回傳什麼？',
        code: `SELECT * FROM users u
WHERE u.id NOT IN (SELECT user_id FROM orders);`,
        lang: 'sql',
        options: [
          '從未下單的使用者——NOT IN 會自動忽略子查詢結果裡的 NULL 值',
          '所有使用者——子查詢裡的 NULL 讓 NOT IN 的比較對每一列都成立為 true',
          '報錯——NOT IN 的子查詢結果不可以包含 NULL，PostgreSQL 會拒絕執行',
          '空結果——子查詢含 NULL 時，x NOT IN (…) 對每列都是 NULL 而非 true；改用 NOT EXISTS 或 LEFT JOIN … IS NULL',
        ],
        answer: 3,
        explain: 'x NOT IN (1, 2, NULL) 等價於 x <> 1 AND x <> 2 AND x <> NULL，最後一項永遠是 NULL，整個 AND 就不可能為 true，WHERE 於是一列都不留。這個 bug 特別陰險：上線時 user_id 都有值一切正常，第一筆訪客訂單進來後報表突然變空。NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id) 逐列檢查有沒有對應列，對 NULL 安全、語意清楚、計畫器通常也處理得更好；LEFT JOIN ... WHERE o.id IS NULL 也是正解。',
      },
      {
        q: '需求：「每個使用者最近的三筆訂單」。哪個做法正確？',
        options: [
          '對 orders 做 GROUP BY user_id 再加 LIMIT 3，每組就只會留下三筆',
          'FROM users u CROSS JOIN LATERAL (SELECT * FROM orders o WHERE o.user_id = u.id ORDER BY created_at DESC LIMIT 3) t',
          '用 DISTINCT ON (user_id) 搭配 ORDER BY user_id, created_at DESC LIMIT 3',
          'SELECT * FROM orders ORDER BY user_id, created_at DESC LIMIT 3',
        ],
        answer: 1,
        explain: 'LATERAL 讓子查詢可以引用左側每一列的值，等於「對每個使用者各跑一次 ORDER BY ... LIMIT 3」，寫法最直白；另一個正解是視窗函數：先用 ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) 編號再取 rn <= 3。GROUP BY 會把每人壓成一列，LIMIT 3 只是限制群組數；DISTINCT ON (user_id) 每人只保留一列；最後一個選項的 LIMIT 是全域的，只會拿到整張表的 3 列。',
      },
    ],
  },
  {
    skill: 'orm-migrations',
    questions: [
      {
        q: '這段 SQLAlchemy 程式碼取出 100 篇文章（來自 100 位不同作者）並印出作者名。總共會對資料庫發出幾次查詢？',
        code: `posts = session.execute(select(Post).limit(100)).scalars().all()
for p in posts:
    print(p.author.name)`,
        lang: 'python',
        options: [
          '1 次——SQLAlchemy 會自動把 relationship 用 JOIN 一起載入',
          '2 次——第一次抓文章，第二次用 IN (…) 一次抓所有作者',
          '101 次——1 次抓文章，之後每次存取 p.author 都觸發一次 lazy load；這就是 N+1',
          '100 次——每篇文章各發一次 JOIN author 的查詢，第一句 select 不另外算',
        ],
        answer: 2,
        explain: 'relationship 預設是 lazy="select"：第一次存取 p.author 才發查詢，迴圈 100 次就是 100 次額外查詢，加上原本那次共 101，這就是 N+1。加上 .options(selectinload(Post.author)) 會在第一批載入後用一句 WHERE id IN (...) 把所有作者一次抓回來（共 2 次）；joinedload 則一句 JOIN 搞定（1 次）。看不出來很正常——所以要開 SQL log（echo=True）親眼看一次。',
      },
      {
        q: '要把 users.fullname 改名為 display_name，且部署是滾動更新、新舊版本程式碼會並存幾分鐘，要求零停機。正確做法是？',
        options: [
          '一個 migration 直接 ALTER TABLE users RENAME COLUMN，ORM model 同步改名，一起部署',
          '先加 display_name 欄並雙寫、回填舊資料、把讀取切到新欄，最後才刪 fullname——分多次部署',
          '建一個 view 把 fullname 映射成 display_name，程式改讀 view，資料表本身不動',
          '在應用層做欄位別名對應，資料庫永遠不改名，避免任何 schema 變更風險',
        ],
        answer: 1,
        explain: 'rename 的瞬間，還在跑的舊版程式碼會找不到 fullname、尚未上線的新版程式碼會找不到 display_name，兩邊必有一方報錯。expand / contract 模式把不可逆的變更拆成多步，每一步都讓新舊程式碼同時可用：加欄（相容）→ 雙寫 → 回填 → 切讀 → 刪舊欄（此時已無人使用）。view 只解讀取、寫入還是會撞；永遠不改名則讓 schema 與程式碼漸行漸遠。',
      },
      {
        q: '你改了 model，跑完 alembic revision --autogenerate 產生了一個 migration 檔。正確的下一步是？',
        options: [
          '打開 migration 檔逐行檢查——autogenerate 會把改名當成 drop + add、也抓不到部分型別與預設值變更；確認後才套用',
          '直接 alembic upgrade head——autogenerate 產生的就是 model 與資料庫的精確差異',
          '刪掉檔案再重新 autogenerate 一次，兩次產生的結果一致就代表 migration 正確無誤',
          '先直接在正式環境套用看看有沒有錯，測試環境資料太少看不出真正的問題',
        ],
        answer: 0,
        explain: 'autogenerate 是比對 model 與目前 schema 的「猜測」，它看不懂意圖：把 fullname 改成 display_name 在它眼裡是刪一欄、加一欄，直接套用就是刪光資料。它也不會產生資料搬移、部分約束與型別變更也偵測不到。所以 migration 檔一定要人工檢查、必要時手改，然後在測試環境套用並驗證，最後才進 CI / 正式流程。重新產生兩次只會得到同樣的猜測。',
      },
    ],
  },
  {
    skill: 'mongodb',
    questions: [
      {
        q: '部落格系統有文章、作者、留言三種資料，用 MongoDB 儲存。哪種嵌入／參照的配置合理？',
        options: [
          '留言嵌入文章（一起顯示），作者整份文件也嵌入每篇文章，讀一次拿到全部',
          '留言與作者都用參照——文件資料庫也應該像關聯式一樣把每種實體拆開存',
          '作者用參照（被多篇共享、會更新）；留言可能無限增長也用參照，或只嵌入最新 N 則',
          '全部嵌入同一份文章文件，MongoDB 除了 16MB 之外沒有其他限制，讀取最快',
        ],
        answer: 2,
        explain: '嵌入要同時滿足三個條件：被擁有（不會被別的文件共享）、數量有上限、一起讀寫。作者會被多篇文章共享且會改名、換頭像，嵌入整份就會有 N 份要同步——用參照（可以另外快照作者名稱這種很少變的欄位）。留言雖然常跟文章一起讀，但數量無上限，放進陣列會讓文件越長越大、逼近 16MB 且每次讀取都變慢——熱門文章就是災難。全部參照又浪費了文件模型「一次讀取拿到整份」的優勢。',
      },
      {
        q: 'MongoDB 在沒有開多文件交易的情況下，哪種操作保證是原子的？',
        options: [
          '對單一文件的一次更新，即使同時改多個欄位（例如一個 updateOne 裡同時 $set 與 $inc）',
          'updateMany 影響的所有文件——要嘛全部更新、要嘛全部不更新',
          '任何寫入——MongoDB 預設所有操作都包在隱含的交易裡',
          '同一條連線上連續的兩次 insertOne，即使在不同 collection',
        ],
        answer: 0,
        explain: 'MongoDB 的原子性邊界是「一份文件」：一次 updateOne 裡不管改幾個欄位、$push 幾個元素，其他人看到的要嘛是改之前、要嘛是改之後。updateMany 只保證每一份文件各自原子，中途失敗可能一半改了一半沒改；跨文件、跨 collection 的一致性需要 4.0 之後的多文件交易，但成本高、設計上應盡量避免依賴。這也是為什麼「一起改的資料放同一份文件」是文件模型的核心設計原則。',
      },
      {
        q: '商品文件長這樣，每次有人瀏覽就 $push 一筆到 views。這個設計的問題是？',
        code: `{
  "_id": "product_42",
  "name": "機械鍵盤",
  "views": [
    { "user": "u1", "at": "2026-09-01T10:00:00Z" },
    { "user": "u2", "at": "2026-09-01T10:00:05Z" },
    { "user": "u9", "at": "2026-09-01T10:00:07Z" }
  ]
}`,
        lang: 'json',
        options: [
          '沒有問題——$push 是原子操作，而且 MongoDB 會自動把過大的文件切分儲存',
          '只要對 views.user 建索引，陣列再大查詢與更新效能都能維持',
          '問題只在 at 應該用 Date 型別而不是字串，否則無法依時間排序與比較',
          'views 無上限增長，文件會逼近 16MB、每次讀寫都搬整份文件越來越慢；應拆成獨立 collection 或只存計數器',
        ],
        answer: 3,
        explain: '無上限陣列是文件模型最典型的反模式：熱門商品幾天就累積數十萬筆瀏覽，文件膨脹到讀一次要搬幾 MB、$push 越來越慢、最後撞到 16MB 硬上限直接寫入失敗。MongoDB 不會替你分割文件。正確做法是「一對多且多方無上限 → 參照」：瀏覽紀錄各自成一份小文件放在 product_views（可加 TTL 索引自動清理），商品上用 $inc 維護 view_count。日期用 Date 型別是對的，但只是次要問題。',
      },
    ],
  },
  {
    skill: 'mongodb-ops',
    questions: [
      {
        q: '這條 aggregation 算「已發佈文章數最多的前 10 位作者」。為什麼 $match 要放在第一個 stage？',
        code: `db.posts.aggregate([
  { $match: { status: 'published' } },
  { $group: { _id: '$authorId', count: { $sum: 1 } } },
  { $sort:  { count: -1 } },
  { $limit: 10 },
])`,
        lang: 'js',
        options: [
          '語法規定 $match 必須是 pipeline 的第一個 stage，放在其他位置會報錯',
          '放最前面才能用 status 索引並縮小進入 $group 的文件數；放 $group 之後就得對整個 collection 分組',
          '順序無所謂，MongoDB 的查詢優化器會自動把所有 stage 重排成最佳順序',
          '$match 應該移到 $group 之後，這樣才能對算出來的 count 做過濾',
        ],
        answer: 1,
        explain: 'pipeline 是一階段接一階段的資料流，越早把不需要的文件濾掉，後面每個 stage 處理的量越少；而且只有 pipeline 開頭的 $match（與 $sort）能利用 collection 的索引，$group 之後的 $match 面對的是計算結果，沒有索引可用。MongoDB 確實會做一些自動優化（例如把 $match 往前挪過 $project），但無法穿過 $group。$match 可以出現在任何位置，只是用途不同：想過濾 count 就再加一個 $match 在 $group 後面，兩者不衝突。',
      },
      {
        q: '登入 API 這樣寫。攻擊者送出 {"username": "admin", "password": {"$ne": ""}} 會發生什麼？',
        code: `const user = await db.collection('users').findOne({
  username: req.body.username,
  password: req.body.password,
})
if (user) issueSession(user)`,
        lang: 'js',
        options: [
          'MongoDB 會拒絕值裡出現 $ 開頭的 key，查詢直接報錯，攻擊無效',
          'password 變成物件而不是字串，型別不符讓 findOne 找不到文件而回傳 null',
          'password 條件變成「不等於空字串」，admin 的文件直接匹配，不用密碼就登入成功',
          '只會讓查詢無法用索引而變成 COLLSCAN 拖慢速度，不影響安全性',
        ],
        answer: 2,
        explain: '把 request body 原樣塞進 filter，使用者就能送查詢運算子：{"$ne": ""} 是合法的 MongoDB 查詢語法，等於 password != ""，任何有密碼的 admin 都符合。這就是 NoSQL 的運算子注入。防法是在邊界把欄位驗證成純字串（pydantic / zod / 手動 typeof 檢查），並且密碼要用 bcrypt / argon2 雜湊後在應用層 verify，資料庫查詢只憑 username 找人。驅動程式不會替你擋，也不會因為型別不符就找不到。',
      },
      {
        q: '常用查詢是 find({ status: "active", age: { $gt: 18 } }).sort({ createdAt: -1 })。要建一個複合索引服務它，欄位順序怎麼排？',
        options: [
          '{ status: 1, age: 1, createdAt: -1 }——照查詢書寫的順序',
          '{ createdAt: -1, status: 1, age: 1 }——排序欄位放最前面才能避免記憶體排序',
          '{ status: 1, createdAt: -1, age: 1 }——ESR：等值欄位 → 排序欄位 → 範圍欄位',
          '對 status、age、createdAt 各建一個單欄索引，讓 MongoDB 自己合併',
        ],
        answer: 2,
        explain: 'ESR 原則：等值條件（status）放最前面把範圍縮到最小；接著放排序欄位（createdAt），這樣在該區段內索引本身就是排好序的，不用在記憶體裡再排；範圍條件（age）放最後，因為範圍之後的欄位就無法再用來排序。若把 age 放在 createdAt 前面，同一個 status 內符合 age > 18 的資料依 age 排列而非 createdAt，排序就得另外做。三個單欄索引 MongoDB 大多只會挑一個用，效果差很多。建完用 explain("executionStats") 確認沒有 COLLSCAN、沒有 SORT stage。',
      },
    ],
  },
  {
    skill: 'redis-cache',
    questions: [
      {
        q: 'cache-aside 模式下，資料更新時建議「刪掉快取」而不是「更新快取為新值」。主要理由是？',
        options: [
          '兩個並發更新各自「寫 DB → 更新快取」的順序可能交錯，最後快取留下舊值；刪除讓下次讀取從 DB 重建',
          '刪除比更新省記憶體，而且 Redis 的 DEL 命令執行速度比 SET 快',
          'Redis 的 SET 不是原子操作，只有 DEL 才是原子的，所以並發時更安全',
          '更新快取要把整個物件重新序列化並傳輸，成本遠高於一個 DEL',
        ],
        answer: 0,
        explain: '「更新快取」的問題在並發：A 寫 DB 為 1、B 寫 DB 為 2、B 更新快取為 2、A 這時才更新快取為 1——DB 是 2、快取卻是 1，而且會一直錯到 TTL 過期。改成刪除後，最壞情況只是多一次 cache miss，之後讀到的是 DB 的最新值。另外更新快取常需要重算衍生資料（例如組合多張表的畫面），刪除則不用知道怎麼算。SET 與 DEL 都是原子命令，效能與記憶體差異也不是重點。',
      },
      {
        q: '這段限流「每個 IP 每分鐘最多 5 次登入」。最需要注意的邊界問題是？',
        code: `key = f"ratelimit:login:ip:{ip}"
count = r.incr(key)
if count == 1:
    r.expire(key, 60)
if count > 5:
    raise TooManyRequests()`,
        lang: 'python',
        options: [
          'INCR 在高並發下不是原子的，多個請求同時遞增會互相覆蓋而少算',
          'count == 1 的判斷有誤，應該每次請求都重新 expire 60 秒才能正確限流',
          '應該改成先 GET 再判斷再 SET，才能正確比較數值並避免超過 5 次',
          'incr 與 expire 是兩個獨立命令，若中間程式當掉，key 永遠不過期、該 IP 被永久鎖死；要用 pipeline / MULTI 一起送',
        ],
        answer: 3,
        explain: 'INCR 本身是原子的，也正因如此它才是限流計數的標準做法；問題出在「先 INCR、再 EXPIRE」是兩次往返，中間任何失敗都會留下沒有 TTL 的 key。解法有幾種：MULTI / pipeline 把兩個命令一起送、Redis 7 的 EXPIRE ... NX、先用 SET key 0 EX 60 NX 初始化、或用 Lua script 讓 INCR + EXPIRE 成為一個原子單元。GET 再 SET 才是真的會有 race condition；每次都重設 TTL 會變成「只要持續嘗試就永遠被鎖」，語意跟固定視窗不同。',
      },
      {
        q: '凌晨的排程一次把 5 萬個商品的快取寫進 Redis，TTL 都設 3600 秒。之後每個整點資料庫都被瞬間打爆。這是哪個問題、怎麼防？',
        options: [
          '快取穿透——大量查詢不存在的 key 直接打到 DB；解法是把空值也快取起來',
          '快取擊穿——某個熱門 key 過期瞬間大量請求同時 miss；解法是加互斥鎖或提前更新',
          '快取雪崩——大量 key 在同一時刻過期；解法是 TTL 加上隨機抖動（例如 3600 ± 300 秒）錯開失效時間',
          'Redis 記憶體不足觸發淘汰策略把 key 清掉；解法是加大 maxmemory 上限',
        ],
        answer: 2,
        explain: '5 萬個 key 同一秒寫入、同一個 TTL，就會在同一秒一起消失，接下來所有請求全部 miss 打到 DB——這是雪崩，特徵是「週期性、大範圍」。防法是讓每個 key 的 TTL 帶隨機偏移，失效時間就會攤平；也可以由排程主動在過期前刷新。穿透是「key 根本不存在」、擊穿是「單一熱 key」，三者症狀不同、解法也不同，要分得清楚才修得對。',
      },
    ],
  },
  {
    skill: 'db-choice',
    questions: [
      {
        q: '新專案是電商訂單系統：訂單、明細、庫存扣減、對帳報表。主資料庫該選什麼、理由是什麼？',
        options: [
          'MongoDB——訂單把明細嵌入同一份文件，一次讀取最快，且 schema 彈性方便迭代',
          'PostgreSQL——建訂單加扣庫存需要交易與約束、對帳報表需要 JOIN 與聚合；半結構化的欄位可以用 JSONB 補',
          'Redis——訂單量大需要極低延遲的寫入，記憶體資料庫最能扛住尖峰',
          'Elasticsearch——訂單要能被多欄位搜尋與篩選，倒排索引最適合',
        ],
        answer: 1,
        explain: '業務系統的預設是關聯式：交易保證「建訂單 + 扣庫存」全做或全不做、外鍵與 CHECK 保證資料完整、JOIN 與視窗函數讓報表不必另外做 ETL。MongoDB 的優勢（形狀差異大、整份讀寫、水平擴展寫入）在訂單系統上不明顯，跨文件一致性反而是負擔。Redis 是快取與計數器層，資料在記憶體、不適合當帳本；Elasticsearch 適合搜尋副本，但不是事實來源。多種資料庫可以各司其職，前提是主資料先放對地方。',
      },
      {
        q: 'CAP 定理在實務上的意思，哪個說法正確？',
        options: [
          '任何資料庫最多只能同時滿足一致性、可用性、效能三者中的兩項',
          '選擇 AP 的資料庫永遠不會有一致的資料，所以不能存重要的東西',
          '單機 PostgreSQL 因為沒有分割容忍度，所以既不一致也不可用',
          '網路分割真的發生時，分散式系統要在「拒絕部分請求以保持一致」與「繼續服務但可能回舊資料」之間選一邊；沒有分割時兩者可以同時擁有',
        ],
        answer: 3,
        explain: 'P 不是可以「不選」的選項——只要節點之間靠網路溝通，分割就一定會發生；CAP 講的是分割發生的那段時間你要犧牲 C 還是 A。平常兩者可以兼得，所以 AP 系統絕大多數時候資料也是一致的，只是承諾的是最終一致。CAP 裡沒有「效能」這一項。單機資料庫不是分散式系統，CAP 對它根本不適用，它天然強一致，代價是單點與垂直擴展的上限。實務問題永遠是：業務能不能接受「短暫看到舊資料」？',
      },
      {
        q: '團隊說「我們有每日自動備份」。要確認什麼才算真的有備份？',
        options: [
          '備份存在異地，且有定期實際還原演練、知道還原要花多久（RTO）與最多會丟多少資料（RPO）',
          '備份檔每天有產生、檔案大小正常沒有異常縮小，就足夠了',
          '使用雲端託管資料庫服務，備份由廠商負責，不需要自己驗證',
          '備份檔有加密且存取權限受控，就算是完整的備份策略',
        ],
        answer: 0,
        explain: '沒還原過的備份不算備份：檔案可能是壞的、缺 WAL 無法回到指定時間點、還原步驟沒人會、或還原要 8 小時但業務只能忍 30 分鐘。所以要定期真的拿備份把資料庫還原到另一個環境跑一遍，並把 RTO / RPO 寫下來跟業務對齊。檔案大小正常、有加密、廠商代管都是必要條件而非充分條件——託管服務的備份設定、保留天數、跨區域複製仍然是你的責任。',
      },
    ],
  },
]

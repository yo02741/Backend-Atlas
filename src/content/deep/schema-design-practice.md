## 從一個具體問題開始：一段掛號需求

一間虛構的診所要做線上掛號，需求文件是這樣寫的：

> 病患以病歷號識別，記錄姓名、生日與聯絡電話（電話可以不填）。醫師有姓名與科別。每位醫師每天分上午、下午、晚上三個時段看診，每個時段稱為一個「診次」，有固定名額。病患掛某個診次後拿到看診號，號碼從 1 開始、同一診次不會重複。同一位病患在同一個診次只能有一筆有效掛號；取消後可以重掛。掛號狀態有：已掛號、已報到、已取消、未到。醫師離職後，歷史掛號紀錄要保留。

最快的寫法是一張表：

```sql
-- 反例：所有東西塞在一張表
CREATE TABLE registrations (
  patient_name text,
  doctor_name  text,
  visit_date   text,      -- '2026/11/3 上午'
  number       int,
  status       text
);
```

這張表在上線第一週就會出問題：醫師改名要改幾千列；兩位同名病患分不清楚；`visit_date` 是文字，`'2026/11/3'` 與 `'2026-11-03'` 都進得來，也沒辦法排序；同一個號碼可以被掛兩次；`status` 可以是任何字，包括打錯的 `'canceled'`。這些錯誤都不會在寫入時被擋下，而是在幾個月後的報表裡才被發現。

這一課照著需求一步一步建表，重點是**把需求裡的每一條規則落到某個約束上**。正規化的觀念（一件事實只存一處、1NF 到 3NF）在 [資料建模與正規化](#/skill/data-modeling)。

## 運作原理：從需求句子到資料表

### 找出實體與關係

先把需求裡的名詞圈出來，再看它們之間的動詞：

| 需求裡的說法 | 設計 |
|---|---|
| 病患、醫師、診次、掛號 | 四個實體 → 四張表 |
| 每位醫師有很多診次 | `clinic_sessions.doctor_id` 外鍵指向 `doctors` |
| 病患掛某個診次 | `appointments` 同時有 `patient_id` 與 `session_id`，是病患與診次之間多對多的中介表，而且自己帶有屬性（看診號、狀態） |
| 病歷號識別病患 | `patients.chart_no` 唯一約束 |
| 每位醫師每天每時段一個診次 | `UNIQUE (doctor_id, session_date, period)` |
| 看診號同一診次不重複 | `UNIQUE (session_id, seq_no)` |
| 同一病患同一診次只能一筆**有效**掛號 | 部分唯一索引：`(session_id, patient_id) WHERE status <> 'cancelled'` |
| 狀態只有四種 | `CHECK (status IN (...))` |
| 醫師離職後掛號要保留 | 外鍵不用 `CASCADE`，醫師加 `is_active` 而不是刪除 |

最後一欄是這一課的核心：需求裡出現「只能」「不重複」「必須是」「要保留」，就應該在 DDL 裡找得到對應的那一行。應用層也可以檢查，但只有資料庫的約束能保證**任何**路徑（另一支程式、手動修資料、批次匯入）都繞不過去。

### 主鍵：bigint identity 還是 UUID

| | `bigint GENERATED ALWAYS AS IDENTITY` | UUID |
|---|---|---|
| 大小 | 8 bytes | 16 bytes |
| 索引 | 遞增插入，B-tree 最友善 | 隨機的 v4 讓插入散落在索引各處；有時間序的 v7 改善很多 |
| 誰產生 | 資料庫（插入後才知道 id） | 任何地方都能先產生（用戶端、離線、多個資料庫合併） |
| 對外暴露 | 看得出筆數與成長速度，也容易被依序猜測 | 猜不到 |
| PostgreSQL 支援 | 10 起支援 identity 欄位 | `gen_random_uuid()`（v4）13 起內建；`uuidv7()` 18 起內建 |

預設用 bigint identity 就夠了。`GENERATED ALWAYS` 比 `BY DEFAULT` 嚴格：手動指定 id 的 `INSERT` 會被拒絕（除非明寫 `OVERRIDING SYSTEM VALUE`），避免匯入資料時手動塞的 id 跟序列撞號。

不論選哪種，id 猜不猜得到都不能當作權限控管：別人的掛號紀錄要靠授權檢查擋，不是靠 id 難猜。

病歷號這種**業務上的編號**另設唯一約束，不拿來當主鍵。業務編號的格式遲早會改（院區合併、改碼），主鍵一改，所有外鍵都要跟著改。

### 外鍵與 ON DELETE

`ON DELETE` 決定「被參照的那一列被刪時，參照它的列怎麼辦」，這是業務決定，不是技術細節：

| 選項 | 行為 | 適合 |
|---|---|---|
| `NO ACTION`（預設）／`RESTRICT` | 還有人參照就拒絕刪除 | 有獨立意義、要保留的紀錄：掛號、訂單、帳務 |
| `CASCADE` | 一起刪掉 | 從屬且沒有獨立意義的資料：草稿的附件、暫存的購物車明細 |
| `SET NULL` | 外鍵欄位改成 NULL | 關係可有可無：文章的「最後編輯者」 |

兩者的差別在於：`NO ACTION` 會延到語句結束（或延遲約束的交易結束）才檢查，`RESTRICT` 立刻檢查。一般情況下效果相同。

掛號指向診次、診次指向醫師，都用預設的 `NO ACTION`：誤刪一位醫師，資料庫會拒絕，而不是默默帶走幾萬筆歷史掛號。醫師離職用 `is_active = false` 表達。

PostgreSQL 不會自動替外鍵欄位建索引。`appointments.patient_id` 要自己建，否則「查某位病患的所有掛號」與刪除病患時的外鍵檢查都要掃全表。

### CHECK 與狀態欄位

`CHECK` 擋的是單一列內的規則：名額大於 0、看診號大於 0、時段只能是三個值之一。它不能跨列檢查（例如「已掛號人數不能超過名額」），那要靠交易裡的原子更新，下面的程式會示範。

CHECK 的條件應該是固定不變的：寫 `CHECK (birth_date <= current_date)` 雖然語法上可以，但 PostgreSQL 假設 CHECK 的結果不會隨時間改變，只在寫入時檢查。這類跟「現在」有關的規則放在應用層驗證。

狀態欄位有三種常見寫法：

- `text` + `CHECK (status IN (...))`：最好改，加一個狀態就是換掉 CHECK 約束。
- `CREATE TYPE … AS ENUM`：可以用 `ALTER TYPE … ADD VALUE` 加值，但刪除或改名值很麻煩。
- 獨立的狀態表加外鍵：狀態需要附帶屬性（顯示名稱、排序、是否算有效）時才值得。

狀態改變的時間點通常也有意義：報到時間、取消時間各自一個 `timestamptz` 欄位，比事後從日誌拼湊可靠。

### 時間欄位

- **時間點**（建立時間、報到時間）用 `timestamptz`。它存的是絕對時間（內部是 UTC），讀出時依連線的 `TimeZone` 顯示。`timestamp`（不帶時區）只是「牆上時鐘的數字」，伺服器換時區或資料跨時區時就說不清楚是哪一刻。
- **日曆日期**（看診日、生日）用 `date`。看診日是「11 月 3 日」，不是某個時間點。
- 不存「年齡」這種會隨時間變的衍生值，存生日，查詢時再算。

### 軟刪除與稽核欄位

每張表都加 `created_at timestamptz NOT NULL DEFAULT now()` 幾乎沒有壞處。`updated_at` 要靠應用程式或 trigger 維護，否則只是一個永遠等於建立時間的欄位。

軟刪除（`deleted_at` 欄位，查詢時過濾）看起來安全，代價常被低估：

- 每一句查詢都要記得 `WHERE deleted_at IS NULL`，漏一處就把已刪資料顯示出來。
- 唯一約束要改成部分唯一索引，否則刪掉的帳號會佔住 email。
- 外鍵照樣指向已刪的列，「刪掉」的語意變得模糊。
- 個資的「刪除」需求，軟刪除不算真的刪除。

掛號的「取消」是業務狀態，不是刪除，所以用 `status = 'cancelled'` 表達，配合部分唯一索引讓取消後可以重掛。真正要「刪除」的資料，另一個選擇是搬進封存表。完整的比較在設計情境 [軟刪除](#/scenario/soft-delete)。

### 命名慣例

- 表名與欄位名用小寫 snake_case，避免需要加雙引號的大小寫混用。
- 外鍵欄位叫 `<被參照實體>_id`（`patient_id`）；時間點欄位用 `_at` 結尾（`checked_in_at`）；日期用 `_date` 或 `_on`；布林用 `is_` / `has_`。
- 重要的約束自己命名（`CONSTRAINT appointments_one_active ...`）。錯誤訊息裡會出現約束名稱，好的名字讓人一看就知道違反了哪條規則，應用程式也能依名稱回傳對應的錯誤訊息。

## 實際程式：完整的 DDL

下面這段可以直接執行：建四張表、放幾筆虛構資料，並示範部分唯一索引怎麼讓「取消後重掛」成立、又擋下重複的有效掛號。

```sql run
CREATE TABLE patients (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chart_no   text NOT NULL UNIQUE,                 -- 病歷號：業務編號，另設唯一，不當主鍵
  name       text NOT NULL,
  birth_date date NOT NULL,
  phone      text,                                 -- 需求說可以不填
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE doctors (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  department text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,        -- 離職不刪除
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clinic_sessions (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doctor_id    bigint NOT NULL REFERENCES doctors (id),   -- 預設 NO ACTION：有診次就不能刪醫師
  session_date date   NOT NULL,
  period       text   NOT NULL CHECK (period IN ('morning', 'afternoon', 'evening')),
  room         text   NOT NULL,
  capacity     int    NOT NULL CHECK (capacity > 0),
  next_seq     int    NOT NULL DEFAULT 0,          -- 已發出的最大看診號，發號時原子 +1
  CONSTRAINT clinic_sessions_one_per_slot UNIQUE (doctor_id, session_date, period),
  CONSTRAINT clinic_sessions_seq_within_capacity CHECK (next_seq <= capacity)
);

CREATE TABLE appointments (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id    bigint NOT NULL REFERENCES clinic_sessions (id),
  patient_id    bigint NOT NULL REFERENCES patients (id),
  seq_no        int    NOT NULL CHECK (seq_no > 0),
  status        text   NOT NULL DEFAULT 'booked'
                CHECK (status IN ('booked', 'checked_in', 'cancelled', 'no_show')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  checked_in_at timestamptz,
  cancelled_at  timestamptz,
  CONSTRAINT appointments_seq_unique UNIQUE (session_id, seq_no)
);
-- 同一病患同一診次只能有一筆「有效」掛號：取消的不算
CREATE UNIQUE INDEX appointments_one_active
  ON appointments (session_id, patient_id) WHERE status <> 'cancelled';
-- 外鍵欄位的索引要自己建（session_id 已被上面的唯一約束涵蓋）
CREATE INDEX appointments_patient_id_idx ON appointments (patient_id);

INSERT INTO patients (chart_no, name, birth_date, phone) VALUES
  ('A000123', '林小明', '1990-04-12', '0900-000-001'),
  ('A000456', '陳美華', '1985-11-30', NULL);
INSERT INTO doctors (name, department) VALUES ('王醫師', '家醫科');
INSERT INTO clinic_sessions (doctor_id, session_date, period, room, capacity)
VALUES (1, '2026-11-03', 'morning', '201', 30);

-- 發號：在同一句裡把 next_seq + 1，名額滿了（CHECK 不成立）這句就會失敗
-- 不要用 SELECT max(seq_no) + 1：兩個請求同時讀到同一個最大值就會撞號
WITH seq AS (
  UPDATE clinic_sessions SET next_seq = next_seq + 1 WHERE id = 1 RETURNING next_seq
)
INSERT INTO appointments (session_id, patient_id, seq_no)
SELECT 1, 1, next_seq FROM seq
RETURNING id, seq_no, status;

-- 同一位病患再掛一次：被部分唯一索引擋下，ON CONFLICT DO NOTHING 讓它回傳 0 列而不是報錯
INSERT INTO appointments (session_id, patient_id, seq_no)
VALUES (1, 1, 99)
ON CONFLICT DO NOTHING
RETURNING id;

-- 取消後重掛：取消的那筆不在部分唯一索引的範圍內，所以可以再掛
UPDATE appointments SET status = 'cancelled', cancelled_at = now() WHERE id = 1;
WITH seq AS (
  UPDATE clinic_sessions SET next_seq = next_seq + 1 WHERE id = 1 RETURNING next_seq
)
INSERT INTO appointments (session_id, patient_id, seq_no)
SELECT 1, 1, next_seq FROM seq
RETURNING id, seq_no, status;

SELECT a.id, a.seq_no, p.name, a.status, s.session_date::text AS session_date, s.period
FROM appointments a
JOIN patients p ON p.id = a.patient_id
JOIN clinic_sessions s ON s.id = a.session_id
ORDER BY a.seq_no;
```

結果裡重掛那筆的 `id` 是 3 而不是 2：被擋下的那次插入已經從 identity 序列取走了 2。序列值不會因為插入失敗或 rollback 而退回，所以 id 有空號是正常的，不要拿 id 當連續編號用（看診號才是）。

`ON CONFLICT DO NOTHING` 沒有指定衝突目標時，任何唯一約束或唯一索引的衝突都會被吞掉。這裡用它示範「被擋下」，正式程式裡通常要讓衝突變成錯誤，回應「已經掛過這個診次」。

發號那一段把「名額上限」交給 `clinic_sessions` 這一列：`UPDATE … SET next_seq = next_seq + 1` 會鎖住這一列，兩個同時掛號的請求會排隊，各拿到不同的號碼；第 31 個請求讓 `next_seq` 變成 31，違反 `next_seq <= capacity`，整句失敗。這是 [交易、ACID 與隔離等級](#/skill/transactions) 裡「把讀、算、寫放進同一句」的應用。這個設計的取捨是取消的號碼不回收，名額算的是「發出的號」而不是「有效掛號數」。如果需求是取消後名額要釋出，就要另外維護一個有效人數的計數欄位。

### 被約束擋下時的錯誤訊息

下面這些語句接在上面的資料後面執行會失敗（所以這一段沒有標成可執行），錯誤訊息直接指出違反了哪條規則：

```sql
INSERT INTO appointments (session_id, patient_id, seq_no, status) VALUES (1, 2, 5, 'done');
-- ERROR:  new row for relation "appointments" violates check constraint "appointments_status_check"
-- DETAIL:  Failing row contains (...)

INSERT INTO appointments (session_id, patient_id, seq_no) VALUES (1, 999, 6);
-- ERROR:  insert or update on table "appointments" violates foreign key constraint "appointments_patient_id_fkey"
-- DETAIL:  Key (patient_id)=(999) is not present in table "patients".

INSERT INTO appointments (session_id, patient_id, seq_no) VALUES (1, 2, 2);
-- ERROR:  duplicate key value violates unique constraint "appointments_seq_unique"
-- DETAIL:  Key (session_id, seq_no)=(1, 2) already exists.

DELETE FROM doctors WHERE id = 1;
-- ERROR:  update or delete on table "doctors" violates foreign key constraint "clinic_sessions_doctor_id_fkey" on table "clinic_sessions"
-- DETAIL:  Key (id)=(1) is still referenced from table "clinic_sessions".
```

應用程式可以依 SQLSTATE 分辨類型（`23505` 唯一、`23503` 外鍵、`23514` CHECK、`23502` NOT NULL），再依約束名稱決定回給使用者的訊息。

## 可演進的 migration：需求改了

上線三個月後，新需求：每筆掛號要記錄來源（網路、電話、臨櫃），而且必填。

如果有合理的固定預設值，一句就可以：PostgreSQL 11 起，`ADD COLUMN … NOT NULL DEFAULT '常數'` 只改系統目錄，不重寫整張表。

```sql
ALTER TABLE appointments ADD COLUMN source text NOT NULL DEFAULT 'counter';
```

沒有合理預設值（舊資料要依其他欄位推算來源）時，分成幾步，每一步都能單獨上線：

1. **加 nullable 欄位**：只改系統目錄，很快。
2. **部署新版程式**：新掛號開始寫入 `source`，舊程式還在跑的實例不會壞，因為欄位允許 NULL。
3. **分批回填**：一次更新幾千列，避免一個大交易長時間鎖住大量列。
4. **加約束但先不驗證**：`NOT VALID` 讓新寫入立刻受檢查，但不掃舊資料。
5. **驗證**：`VALIDATE CONSTRAINT` 掃全表，但只拿 SHARE UPDATE EXCLUSIVE 鎖，不擋讀寫。
6. **SET NOT NULL**：PostgreSQL 12 起，如果已有驗證過的 `CHECK (source IS NOT NULL)`，這一步就不用再掃表。之後那個 CHECK 可以刪掉。

```sql run
-- 用一張小表示範分步 migration（正式環境每一步之間會隔一次部署）
CREATE TABLE appointments (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, created_by text);
INSERT INTO appointments (created_by) SELECT CASE WHEN g % 3 = 0 THEN 'web' ELSE 'staff' END FROM generate_series(1, 9) g;

-- 1. 加 nullable 欄位
ALTER TABLE appointments ADD COLUMN source text;

-- 3. 分批回填（正式環境用迴圈重複執行，直到更新 0 列）
UPDATE appointments SET source = CASE created_by WHEN 'web' THEN 'web' ELSE 'counter' END
WHERE id IN (SELECT id FROM appointments WHERE source IS NULL ORDER BY id LIMIT 5);
UPDATE appointments SET source = CASE created_by WHEN 'web' THEN 'web' ELSE 'counter' END
WHERE id IN (SELECT id FROM appointments WHERE source IS NULL ORDER BY id LIMIT 5);

-- 4、5. 先加不驗證的約束，再驗證
ALTER TABLE appointments ADD CONSTRAINT appointments_source_check
  CHECK (source IN ('web', 'phone', 'counter')) NOT VALID;
ALTER TABLE appointments ADD CONSTRAINT appointments_source_not_null
  CHECK (source IS NOT NULL) NOT VALID;
ALTER TABLE appointments VALIDATE CONSTRAINT appointments_source_check;
ALTER TABLE appointments VALIDATE CONSTRAINT appointments_source_not_null;

-- 6. 正式加上 NOT NULL，再拿掉暫時的 CHECK
ALTER TABLE appointments ALTER COLUMN source SET NOT NULL;
ALTER TABLE appointments DROP CONSTRAINT appointments_source_not_null;

SELECT source, count(*) FROM appointments GROUP BY source ORDER BY source;
```

每一句 `ALTER TABLE` 都要短暫拿表鎖，正式環境記得先設 `lock_timeout`，原因與做法在 [鎖與死結](#/skill/locks-deadlocks)。欄位改名、拆表這類不可逆的變更，要搭配「先加新的、雙寫、切換、再刪舊的」的步驟，見 [ORM 與 migration](#/skill/orm-migrations)。

## 常見錯誤與錯誤訊息

| 設計錯誤 | 後果 | 改法 |
|---|---|---|
| 用 `SELECT max(seq_no) + 1` 產生號碼 | 並行時撞號，被唯一約束擋下或（沒有約束時）重複 | 計數欄位原子 `+ 1`，或用 sequence |
| 外鍵一律 `ON DELETE CASCADE` | 誤刪一列，連帶刪光歷史紀錄 | 有獨立意義的紀錄用預設的 NO ACTION |
| 「只能有一筆有效」寫成一般 `UNIQUE` | 取消後不能重掛 | 部分唯一索引加 `WHERE` 條件 |
| 時間點存成 `timestamp` 或文字 | 跨時區、夏令時間或換主機後時間錯亂，無法正確排序 | `timestamptz`；日曆日期用 `date` |
| 存年齡、剩餘名額這類衍生值卻沒人負責更新 | 數字慢慢跟事實脫節 | 存原始資料，查詢時算；真的要存就在同一個交易裡維護 |
| 約束交給預設名稱 | 錯誤訊息裡的 `appointments_session_id_patient_id_key` 看不出業務意義 | 重要約束自己命名 |

錯誤訊息的讀法：`violates check constraint "<名稱>"` 找 CHECK、`violates foreign key constraint` 看 DETAIL 的 `Key (...)=(...)` 是哪個值不存在、`duplicate key value violates unique constraint` 看 DETAIL 是哪一組值重複。訊息裡的約束名稱是追查的起點，這也是要好好命名的原因。

## 動手

1. 執行完整 DDL 那段，再把「同一位病患再掛一次」那句的 `ON CONFLICT DO NOTHING` 拿掉，看錯誤訊息裡的索引名稱。
2. 把 `clinic_sessions` 的 `capacity` 改成 1，再執行一次：第二次發號（取消後重掛）會違反 `clinic_sessions_seq_within_capacity`。想一想：取消應不應該釋出名額？要的話 schema 怎麼改？
3. 在 Playground 試 `DELETE FROM doctors WHERE id = 1;`，確認外鍵擋下刪除；再試試把醫師標成 `is_active = false`。
4. 程式題「門診掛號的約束」：自己寫 `appointments` 的 DDL，讓驗收腳本測試的每一條業務規則都被資料庫擋下。

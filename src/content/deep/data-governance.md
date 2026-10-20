## 從一個具體問題開始：中台蓋好了，數字對不起來

一家醫院導入了數據中台：每天晚上把掛號、住院、檢驗、批價四個系統的資料抽到同一個資料庫，再做出「各科門診量」「平均住院天數」的儀表板。上線第一週就出現三個問題：

- 儀表板上的病人數比掛號系統自己的報表多了 3%。追下去發現同一個病人在不同系統用不同格式的病歷號（`A0012`、`a0012`、` A0012`），被算成三個人。
- 「心臟內科」的門診量是 0。掛號系統用代碼 `CV`，住院系統用 `CARD`，代碼表裡只有其中一個。
- 平均住院天數出現負數。有幾筆出院日早於入院日，是補登資料時打錯年份。

這些都不是中台軟體的錯。資料在各個來源系統裡就已經是這樣，只是以前每個系統各自出報表，沒人把它們放在一起比。中台的作用之一，是把這些問題**一次全部攤開**。如果事前沒有定義「病人是誰、代碼以哪一份為準、誰負責修資料」，中台只會更快、更大量地產生錯的數字。這就是「先治理，再建中台」的意思。

## 數據中台與資料治理分別是什麼

**數據中台**不是一個特定產品，而是一種組織方式：把分散在各系統的資料集中、整理成可重用的資料集與服務（報表、API、分析用資料表），讓各單位不必每次都回頭找原系統要資料。技術上它通常包含資料整合（ETL／ELT 管線）、儲存（資料倉儲或 lakehouse）、資料目錄、權限控管與資料服務。

**資料治理**（data governance）是讓資料可信、可找、可控的一套規則與分工：

| 面向 | 要回答的問題 |
|---|---|
| 盤點與目錄 | 有哪些資料、在哪個系統、欄位是什麼意思、誰在用 |
| 主資料 | 「病人」「科別」「醫師」以哪一份為準，各系統怎麼對應 |
| 資料品質 | 怎樣算對、怎麼量、多少錯誤可以接受、錯了誰修 |
| 負責人 | 每個資料集的 owner 與 steward 是誰 |
| 血緣 | 這個數字從哪些來源、經過哪些轉換算出來 |
| 權限與隱私 | 誰可以看什麼、可識別個人的資料怎麼保護 |

中台是工具與架構，治理是規則與責任。沒有治理的中台，常見結局是「資料都在，但沒人敢用」。

## 治理的基本功

### 資料盤點與資料目錄

第一步是知道自己有什麼。對每個來源系統列出：系統名稱、負責單位、主要資料表、更新頻率、資料量、是否含個資。接著為每個要進中台的資料集建立**資料目錄**（data catalog）條目，也就是 metadata（描述資料的資料）：

```yaml
# 資料目錄條目示意（欄位依所用的目錄工具而定）
dataset: registrations
description: 門診掛號紀錄，一列一次掛號
source_system: 掛號系統
refresh: 每日 02:00 全量
owner: 門診部            # 業務上對這份資料負責、決定定義的單位
steward: 資訊部 資料組    # 日常維護品質規則、處理問題回報的人
contains_pii: true
classification: 機敏      # 依院內資料分級
columns:
  - name: chart_no
    description: 病歷號，大寫英文字母加四碼數字，去除前後空白
    rules: [not_null, unique_per_patient, pattern '^[A-Z][0-9]{4}$']
  - name: dept_code
    description: 掛號科別代碼，以「科別代碼表」為準
    rules: [not_null, in_reference 'departments.code']
```

目錄最重要的不是工具，而是**欄位定義寫下來而且有人維護**。「門診量」是掛號數、報到數、還是看診完成數？定義不寫清楚，兩個單位會各自算出不同的數字，然後在會議上爭論誰對。

### 主資料：病人、科別、代碼表

**主資料**（master data）是被很多系統共用、變動不頻繁、又必須一致的核心實體：病人、醫師、科別、藥品、檢驗項目、各種代碼表。主資料管理（MDM）要決定：

1. **權威來源**（system of record）：例如病人基本資料以掛號系統為準，其他系統只讀不改。
2. **對應規則**：各系統的代碼怎麼對到標準代碼（`CV`、`CARD` → 心臟內科）。對應表本身也是要有人維護的資料。
3. **比對與合併規則**：兩筆病人資料在什麼條件下視為同一人（病歷號正規化後相同？身分證號相同？），合併後的紀錄由誰確認。

醫療常用的國際標準代碼（例如疾病分類、檢驗項目編碼）有各自的版本與授權條件，採用哪一套、哪一版，要和醫療資訊與病歷管理單位一起決定，並記在目錄裡。

### 資料品質的五個維度

| 維度 | 意思 | 掛號資料的例子 | 怎麼量 |
|---|---|---|---|
| 完整性 completeness | 必填欄位有沒有值 | 生日、性別空白 | 缺值筆數 ÷ 總筆數 |
| 一致性 consistency | 跨系統、跨欄位是否相符 | 掛號系統與住院系統的科別代碼不同 | 對不到代碼表的筆數 |
| 正確性 accuracy／validity | 值是否合理、符合格式與業務規則 | 出院日早於入院日、生日在未來 | 違反規則的筆數 |
| 唯一性 uniqueness | 同一個實體是否只出現一次 | 同一病人有兩個病歷號，或同一病歷號兩筆 | 重複群組數 |
| 即時性 timeliness | 資料是否在需要時已經更新 | 中台資料停在三天前 | 最新資料時間與現在的差距 |

每個維度都要有**門檻與處理方式**：例如「生日缺值率超過 1% 時通知 steward」「代碼對不到時該筆進隔離區，不進儀表板」。只量不處理，品質報表會變成沒人看的郵件。

### 負責人：owner 與 steward

- **Data owner**（資料負責人）：通常是業務單位主管，決定資料的定義、誰可以存取、品質要求到什麼程度。
- **Data steward**（資料管理員）：負責日常的品質規則、問題分派與追蹤、目錄維護。可能在業務單位，也可能在資訊部。

資訊部常常被默認為所有資料的負責人，但資訊部改不了「這位病人的生日到底是哪天」——那要回到掛號櫃檯或病歷管理單位。品質問題的修正要**回到來源系統修**，在中台裡偷偷修正，下一次全量重抽時錯誤又會回來，而且來源系統的報表永遠和中台對不起來。

### 血緣

**資料血緣**（data lineage）記錄一個欄位或指標從哪些來源、經過哪些轉換而來：

```text
儀表板「各科平均住院天數」
  ← mart.admission_stats（依科別彙總，排除出院日 < 入院日的紀錄）
    ← staging.admissions（病歷號正規化、科別代碼對應到標準代碼）
      ← 住院系統.admission（每日 02:00 抽取）
      ← ref.dept_mapping（科別代碼對應表，steward：資訊部資料組）
```

有了血緣，數字不對時可以一層一層往回追；來源系統要改欄位時，也知道會影響哪些下游報表。用 dbt 一類的轉換工具或資料目錄工具時，血緣常常可以從 SQL 自動產生；手動維護的話，至少把每張中台資料表的來源寫進目錄。

## 權限與去識別化

中台把資料集中，也把風險集中：以前要入侵四個系統才拿得到的資料，現在一個帳號就看得到。權限設計的基本原則：

- **最小權限**：分析人員多半只需要彙總資料或去識別化資料，不需要姓名與身分證號。
- **依資料分級分區**：可識別個人的資料、假名化資料、彙總統計放在不同的 schema 或資料庫，各自授權。
- **存取紀錄**：誰在什麼時候查了哪些可識別資料，要留紀錄並定期檢視。

兩個常被混用的詞：

| | 假名化 pseudonymization | 去識別化／匿名化 de-identification／anonymization |
|---|---|---|
| 做法 | 把姓名、病歷號換成代碼；**對照表另外保存** | 移除或泛化可以識別個人的資訊，使其無法合理地再識別 |
| 能否還原 | 持有對照表或金鑰的人可以還原 | 目標是任何人都無法合理還原 |
| 用途 | 需要跨時間、跨系統串同一個人，但分析人員不需要知道是誰 | 對外發布、研究資料集 |
| 風險 | 對照表外洩等於全部還原；通常**仍視為個人資料**處理 | 只刪姓名不夠：生日 + 性別 + 郵遞區號 + 罕見診斷，組合起來就可能認出人 |

假名化與去識別化在法律上各自要符合什麼條件、做完是否仍屬個資，要依個人資料保護法、主管機關的規範與院內政策判斷，**請與法遵確認**；研究用途通常還涉及倫理審查的流程。技術上能做的是把方法定清楚、可重現、可稽核。

假名化最常見的做法是用帶金鑰的雜湊（HMAC）：同一個病歷號永遠得到同一個代碼（可以串接），沒有金鑰的人算不出來。單純的 SHA-256 不行，病歷號的格式固定、可能值很少，直接窮舉就能反推。

```python run
import hmac, hashlib

# 金鑰要放在秘密管理系統，和假名化後的資料分開保管（這裡寫死只為了示範）
SECRET = b"demo-key-do-not-use"

def pseudonym(chart_no: str) -> str:
    normalized = chart_no.strip().upper()          # 先正規化，否則 ' a0012' 和 'A0012' 會變成兩個人
    digest = hmac.new(SECRET, normalized.encode(), hashlib.sha256).hexdigest()
    return "P" + digest[:12]

for raw in ["A0012", " a0012", "A0013"]:
    print(repr(raw), "->", pseudonym(raw))

# 為什麼不能只用 SHA-256：病歷號格式固定（1 個字母 + 4 碼數字），可能值只有 26 萬種，窮舉一下就反推出來
target = hashlib.sha256(b"A0013").hexdigest()
for n in range(10000):
    guess = f"A{n:04d}"
    if hashlib.sha256(guess.encode()).hexdigest() == target:
        print("沒加金鑰的雜湊被反推：", guess)
        break
```

## 資料放在哪：倉儲、資料湖、lakehouse；ETL 與 ELT

| | 資料倉儲 data warehouse | 資料湖 data lake | Lakehouse |
|---|---|---|---|
| 存什麼 | 整理過、有固定 schema 的結構化資料 | 原始檔案：結構化、半結構化（JSON）、影像、文字 | 資料湖的檔案 + 表格格式（交易、schema、版本） |
| schema | 寫入時定義（schema-on-write） | 讀取時才解讀（schema-on-read） | 兩者兼具 |
| 適合 | 報表、儀表板、固定的分析 | 大量原始資料、機器學習 | 想用同一份儲存同時支援報表與資料科學 |
| 常見風險 | 改 schema 慢 | 沒有目錄與品質規則，變成沒人找得到東西的「資料沼澤」 | 架構與工具較新，團隊要學的東西多 |

資料怎麼進去：

- **ETL**（Extract → Transform → Load）：先在中間層轉換、清理，再載入目的地。目的地只收乾淨的資料，適合目的地運算能力有限、或敏感欄位必須在進入前就移除的情況。
- **ELT**（Extract → Load → Transform）：原始資料先載入，再在目的地用 SQL 轉換。保留原始資料、轉換可以重跑，是現代資料倉儲常見的做法；但原始資料（含個資）也進了目的地，權限要更嚴。

規模不大時，一個 PostgreSQL 分成 `raw`、`staging`、`mart` 三個 schema，就能做出 ELT 的雛形。工具可以晚點選，**分層、命名、定義、負責人**要先定。

## 實際程式：用 SQL 做資料品質檢查

下面在瀏覽器的 PostgreSQL 裡建立一份**虛構的**掛號與住院資料（沒有任何真實個資），故意放進重複、缺值、代碼不一致、日期不合理的紀錄，再逐一用 SQL 找出來。每一段檢查都是可以排進每日排程的品質規則。

```sql run
-- 1. 建立虛構資料：科別代碼表、病人、掛號、住院
CREATE TABLE departments (code TEXT PRIMARY KEY, name TEXT NOT NULL);
INSERT INTO departments VALUES ('IM', '內科'), ('SUR', '外科'), ('PED', '兒科'), ('ER', '急診');

CREATE TABLE patients (
  id         BIGINT PRIMARY KEY,
  chart_no   TEXT,      -- 病歷號：業務上應該唯一，但來源系統沒加 UNIQUE
  name       TEXT,
  birth_date DATE,
  sex        TEXT
);
INSERT INTO patients VALUES
  (1, 'A0001', '王小明', '1980-03-15', 'M'),
  (2, 'A0002', '李小華', '1992-07-01', 'F'),
  (3, 'A0002', '李小華', '1992-07-01', 'F'),   -- 完全重複
  (4, ' a0004', '陳大同', '1975-11-30', 'M'),  -- 格式不一致，正規化後與 5 重複
  (5, 'A0004', '陳大同', '1975-11-30', 'M'),
  (6, 'A0006', '', '2001-05-05', 'F'),         -- 姓名是空字串
  (7, 'A0007', '林美玲', NULL, 'F'),           -- 生日缺值
  (8, 'A0008', '張志強', '2099-01-01', 'M');   -- 生日在未來

CREATE TABLE registrations (id BIGINT PRIMARY KEY, patient_id BIGINT, dept_code TEXT, visit_date DATE);
INSERT INTO registrations VALUES
  (101, 1, 'IM', '2026-03-02'), (102, 2, 'SUR', '2026-03-02'), (103, 5, 'im', '2026-03-03'),
  (104, 6, 'CARD', '2026-03-03'), (105, 7, NULL, '2026-03-04'), (106, 8, 'PED', '2026-03-04');

CREATE TABLE admissions (id BIGINT PRIMARY KEY, patient_id BIGINT, admit_date DATE, discharge_date DATE);
INSERT INTO admissions VALUES
  (201, 1, '2026-03-01', '2026-03-05'),
  (202, 2, '2026-04-10', NULL),             -- 還在住院：NULL 是合理的
  (203, 5, '2026-05-20', '2026-05-02');     -- 出院日早於入院日

-- 2. 唯一性：正規化病歷號後找重複（只用原始值 GROUP BY 會漏掉 ' a0004'）
SELECT UPPER(TRIM(chart_no)) AS chart_no, COUNT(*) AS n, array_agg(id ORDER BY id) AS patient_ids
FROM patients
GROUP BY UPPER(TRIM(chart_no))
HAVING COUNT(*) > 1;

-- 3. 完整性：各必填欄位的缺值數（空字串也算缺值）
SELECT COUNT(*) AS total,
       COUNT(*) FILTER (WHERE NULLIF(TRIM(name), '') IS NULL) AS missing_name,
       COUNT(*) FILTER (WHERE birth_date IS NULL)             AS missing_birth_date,
       COUNT(*) FILTER (WHERE sex IS NULL)                    AS missing_sex
FROM patients;

-- 4. 一致性：掛號的科別代碼對不到代碼表（NULL 另外算缺值，不混在這裡）
SELECT r.dept_code, COUNT(*) AS n
FROM registrations r
LEFT JOIN departments d ON d.code = r.dept_code
WHERE d.code IS NULL AND r.dept_code IS NOT NULL
GROUP BY r.dept_code;

-- 5. 正確性：日期不合理
SELECT 'admission' AS source, id, 'discharge_before_admit' AS problem
FROM admissions WHERE discharge_date < admit_date
UNION ALL
SELECT 'patient', id, 'birth_date_in_future'
FROM patients WHERE birth_date > DATE '2026-06-30';   -- 用固定的資料截取日，結果才可重現
```

執行後會看到四個結果集，對應四條規則。幾個細節值得注意：

- 第 2 段如果寫 `GROUP BY chart_no`，只會找到 `A0002`。**先正規化再比對**是唯一性檢查的關鍵，正規化規則（去空白、轉大寫）本身要寫進目錄。
- 第 3 段用 `COUNT(*) FILTER (WHERE …)` 一次算出多個欄位的缺值數，適合做成每日的品質指標。空字串與 NULL 在來源系統裡常常混用，要一起算。
- 第 4 段的 `im` 是大小寫問題，`CARD` 是代碼表缺項或對應表缺項，兩者的修法不同：前者在轉換時正規化，後者要 steward 決定是補代碼表還是改來源資料。
- 第 5 段的日期門檻用固定日期而不是 `now()`，同一份資料重跑才會得到同樣的結果，品質報表才能前後比較。

## 常見錯誤

| 狀況 | 原因 | 怎麼處理 |
|---|---|---|
| 中台病人數比來源系統多 | 病歷號沒正規化，或主資料沒有合併規則 | 定義正規化與比對規則，在 staging 層統一處理 |
| `NOT IN (SELECT code FROM …)` 突然什麼都查不到 | 子查詢結果裡有 NULL 時，`x NOT IN (…)` 的結果是 NULL，不是 true | 改用 `NOT EXISTS` 或 `LEFT JOIN … WHERE … IS NULL` |
| 平均住院天數是負數 | 沒有檢查日期合理性，錯誤資料直接進彙總 | 品質規則擋在 mart 之前；不合格的紀錄進隔離表並通知 steward |
| 在中台裡手動修正資料，隔天又錯 | 修在下游，來源沒改；全量重抽時被覆蓋 | 修正回到來源系統；中台只做可重現的轉換規則 |
| 同一個指標兩個單位算出兩個數字 | 指標定義沒寫進目錄 | 指標定義、計算 SQL、負責人一起登記 |
| 「去識別化」資料集被認出個人 | 只移除姓名與病歷號，保留生日、區域、罕見診斷 | 間接識別欄位一併泛化（年齡區間、縣市層級），對外發布前經過審查 |

## 動手

1. 執行上面的 SQL，把第 2 段改回 `GROUP BY chart_no`，比較結果少了哪一組。
2. 在第 4 段把 `LEFT JOIN … IS NULL` 換成 `WHERE r.dept_code NOT IN (SELECT code FROM departments)`，結果相同；再把子查詢改成 `(SELECT code FROM departments UNION ALL SELECT NULL)`，模擬對應表裡混進一列空值，觀察 `NOT IN` 為什麼一列都不回。
3. 執行假名化那段 Python，把 `SECRET` 換掉，確認同一個病歷號的代碼跟著改變；想一想金鑰外洩或遺失時，對已發布的資料集各代表什麼。
4. 做本課的程式題：重複病歷號、必填缺值、代碼不在代碼表、出院日早於入院日。
5. 相關課程：[資料建模與正規化](#/skill/data-modeling)、[子查詢、CTE 與視窗函數](#/skill/sql-advanced)、[秘密管理](#/skill/secrets)（金鑰怎麼保管）、[地端、雲端還是混合雲](#/skill/hosting-models)（資料分級與存放位置）。

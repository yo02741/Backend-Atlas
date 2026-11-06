## 從一個具體問題開始：「上週內科的取消率是多少？」

門診管理組問 agent：「上週內科的掛號取消率是多少？」agent 有資料庫的唯讀帳號，打開 `registrations` 表看到這些欄位：

| 欄位 | 看起來的意思 |
|---|---|
| `status` | 狀態：booked、completed、cancelled、void |
| `cancelled_at` | 取消時間 |
| `is_test` | 是否為測試資料 |
| `dept_code` | 科別代碼 |

它寫出一段很合理的 SQL：分母是 `COUNT(*)`，分子是 `COUNT(cancelled_at)`，算出 60%。門診管理組自己的報表是 40%。差在哪裡？

- `void` 是掛號人員按錯而作廢的單，業務上根本不算一筆掛號，但 `COUNT(*)` 把它算進分母。
- 有一筆 `status = 'completed'` 卻有 `cancelled_at`：病人取消後又改回來報到，系統沒清掉舊的取消時間。只看 `cancelled_at` 就會多算一筆取消。
- `is_test = true` 是系統上線測試留下的資料，報表一律排除。

這三件事都不在欄位名稱裡，只在負責這份資料的人腦中，或散落在某份報表的 SQL 裡。agent 再聰明也猜不到；換一個人來寫，也很可能踩到其中一個。更麻煩的是，60% 這個數字**看起來很合理**，沒有人會發現它錯了。

Semantic layer（語意層）要解決的就是這件事：把「掛號數」「取消率」這類指標的定義寫成一層，查詢一律經過這層，而不是每次從欄位名重新推敲。

## 定義層裡有什麼：指標與維度

語意層裡有兩種東西：

- **指標（measure / metric）**：可以加總或計算的數字，例如掛號數、取消數、取消率、平均等候時間。
- **維度（dimension）**：拿來切分與篩選指標的屬性，例如看診日期、科別、院區、初診或複診。

一個指標的定義至少要寫清楚下面這些項目，少一項就會有人各自解讀：

| 項目 | 掛號數的例子 | 少了會怎樣 |
|---|---|---|
| 名稱與說明 | `registrations`：有效掛號筆數 | 同名不同義，「掛號數」在兩份報表是兩件事 |
| 公式 | `COUNT(*)`，排除 `status = 'void'` 與 `is_test` | 作廢單、測試資料被算進去 |
| 來源表 | `registrations` | 有人改從另一張同步過來、晚一天的表算 |
| 粒度 | 一列是一筆掛號；指標可彙總到「日 × 科別」 | 和一列一位病人的表 JOIN 後重複計算 |
| 允許的維度與篩選 | `visit_date`、`dept_code` | 用不該切的維度切（例如用病人住址切，牽涉個資） |
| 負責人 | 門診管理組 | 定義有爭議時不知道找誰，沒人敢改 |

比率類的指標還有一個常見陷阱：**比率不能直接平均**。取消率要先分別加總分子（取消數）和分母（掛號數）再相除；把每一天的取消率平均起來，會讓掛號少的日子和掛號多的日子權重一樣。所以定義裡通常把取消率寫成「取消數 ÷ 掛號數」兩個基礎指標的組合，而不是另一個獨立的公式。

### 粒度決定能怎麼組合

粒度（grain）是「一列代表什麼」。掛號表一列是一筆掛號，病人表一列是一位病人。把兩者 JOIN 起來算掛號數沒有問題；但如果再 JOIN 一張「一位病人有多筆診斷」的表，每筆掛號就會被複製成好幾列，`COUNT(*)` 變大。定義層把粒度寫明，就能在產生 SQL 時擋掉這種組合，或改成先彙總再 JOIN。

## 和資料治理的關係

語意層不是治理的替代品，而是建在治理之上。[資料治理](#/skill/data-governance) 處理的是：

- **主資料與代碼表**：「科別」以哪一份代碼表為準，掛號系統的 `CV` 與住院系統的 `CARD` 怎麼對應。這決定了 `dept_code` 這個維度有哪些值、能不能跨系統比較。
- **資料品質**：大小寫不一致的 `im`、缺值的科別、不合理的日期。品質沒處理，語意層算出來的仍然是錯的數字，只是每次都錯得一樣。
- **負責人與血緣**：誰能改定義、指標從哪些表算出來。

分工可以這樣看：治理讓「原料」可信，語意層讓「怎麼算」只寫一份。治理那一課的常見錯誤裡有一條「同一個指標兩個單位算出兩個數字」，語意層就是那條的具體做法。

## 運作原理：agent 用定義查，不是看欄位猜

沒有語意層時，agent 的工作流程是：

1. 列出資料表與欄位
2. 從欄位名推測哪些欄位代表「取消」「有效」
3. 寫 SQL、執行、回報數字

每一步都可能猜錯，而且錯了沒有人知道。有了語意層，流程變成：

1. 查指標清單，找到 `cancel_rate` 與它允許的維度
2. 決定要用的維度（`dept_code = 'IM'`）與篩選（上週）
3. 由定義產生 SQL（或直接查定義好的 view），結果附上用了哪個指標、哪一版定義

差別在於第 2 步之後，agent 能做的選擇只剩「用哪個指標、切哪個維度、篩什麼範圍」。公式與排除條件不在它的選擇範圍內。這也讓結果**可追溯**：數字有爭議時，查的是那份定義，而不是去讀 agent 當下生成的 SQL。

給 agent 的工具也跟著收窄：

| 工具 | 說明 |
|---|---|
| `list_metrics()` | 回傳指標名稱、說明、允許的維度、負責人 |
| `query_metric(name, dimensions, filters)` | 只查定義好的 view；不在允許清單的維度直接拒絕 |
| 原始資料表 | 不開放，或只開放給有人審查的探索用途 |

這和 [知識系統怎麼選](#/skill/knowledge-choice) 的判斷一致：有結構、有標準答案的問題，用結構化的介面回答，不讓模型自由生成。

## 最小實作：一個 view 加一份指標清單

不需要先導入任何產品。最小可用的版本是兩樣東西：

- 一張 `metrics` 表（或一份 YAML 檔放在 git），記錄每個指標的名稱、公式、來源、粒度、維度、負責人
- 每組指標一個資料庫 view，公式和排除條件寫在 view 裡

下面用虛構的門診掛號資料示範，同一個問題用 view 查和憑欄位猜，得到不同的答案：

```sql run
-- 虛構的掛號資料：status 有 booked / completed / cancelled / void，is_test 是測試資料
CREATE TABLE registrations (
  id           BIGINT PRIMARY KEY,
  visit_date   DATE NOT NULL,
  dept_code    TEXT NOT NULL,
  status       TEXT NOT NULL,
  cancelled_at TIMESTAMPTZ,
  is_test      BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO registrations VALUES
  (1,  '2026-05-04', 'IM',  'completed', NULL,                  false),
  (2,  '2026-05-04', 'IM',  'cancelled', '2026-05-03 09:00+08', false),
  (3,  '2026-05-04', 'IM',  'completed', '2026-05-02 10:00+08', false),  -- 取消後又改回報到
  (4,  '2026-05-04', 'SUR', 'void',      NULL,                  false),  -- 作廢單
  (5,  '2026-05-04', 'SUR', 'completed', NULL,                  false),
  (6,  '2026-05-04', 'SUR', 'completed', NULL,                  true),   -- 測試資料
  (7,  '2026-05-05', 'IM',  'cancelled', '2026-05-05 07:30+08', false),
  (8,  '2026-05-05', 'IM',  'booked',    NULL,                  false),
  (9,  '2026-05-05', 'SUR', 'cancelled', '2026-05-04 18:00+08', false),
  (10, '2026-05-05', 'SUR', 'completed', NULL,                  false);

-- 指標清單：定義寫在這裡，誰都查得到
CREATE TABLE metrics (
  name       TEXT PRIMARY KEY,
  formula    TEXT NOT NULL,
  source     TEXT NOT NULL,
  grain      TEXT NOT NULL,
  dimensions TEXT NOT NULL,
  owner      TEXT NOT NULL
);
INSERT INTO metrics VALUES
  ('registrations', 'COUNT(*)，排除 status = void 與 is_test', 'registrations', '日 × 科別', 'visit_date, dept_code', '門診管理組'),
  ('cancel_rate',   'cancellations ÷ registrations（先加總再相除）', 'registrations', '日 × 科別', 'visit_date, dept_code', '門診管理組');

-- 指標 view：排除條件與公式只寫這一次；粒度是「日 × 科別」
CREATE VIEW m_registrations AS
SELECT visit_date, dept_code,
       COUNT(*)                                      AS registrations,
       COUNT(*) FILTER (WHERE status = 'cancelled')  AS cancellations
FROM registrations
WHERE status <> 'void' AND NOT is_test
GROUP BY visit_date, dept_code;

-- 1. 憑欄位名猜：分母含作廢與測試，分子看 cancelled_at
SELECT 'guess' AS how, dept_code,
       COUNT(*) AS registrations,
       COUNT(cancelled_at) AS cancellations,
       ROUND(COUNT(cancelled_at)::numeric / COUNT(*), 3) AS cancel_rate
FROM registrations
GROUP BY dept_code
UNION ALL
-- 2. 用定義查：先加總分子、分母，再相除
SELECT 'metric', dept_code,
       SUM(registrations), SUM(cancellations),
       ROUND(SUM(cancellations)::numeric / SUM(registrations), 3)
FROM m_registrations
GROUP BY dept_code
ORDER BY dept_code, how;
```

結果：內科猜出來是 0.600、定義是 0.400；外科猜出來是 0.200、定義是 0.333。外科的方向甚至相反——猜的版本把作廢單和測試資料算進分母，取消率被稀釋了。

幾個實作上的細節：

- view 裡**不要先算好比率**再讓人平均。上面的 view 只放分子與分母，比率在查詢時用 `SUM ÷ SUM` 算，這樣不論彙總到科別、到週或到全院都對。
- 指標清單和 view 要一起改、一起審查。放在 git 裡，透過 merge request 修改，就有版本與核准紀錄。
- 給 agent 的資料庫帳號只授權 `SELECT` 指標 view 與 `metrics` 表（`GRANT SELECT ON m_registrations, metrics TO agent_ro;`），原始表不給。

### 定義怎麼寫成檔案

很多團隊把定義寫成 YAML，再由工具或腳本產生 view 與文件。格式沒有標準，重點是欄位齊全：

```yaml
metrics:
  - name: cancel_rate
    label: 掛號取消率
    description: 有效掛號中被取消的比例；作廢單與測試資料不算
    numerator: cancellations      # 參照另一個指標
    denominator: registrations
    source: registrations
    grain: [visit_date, dept_code]
    allowed_dimensions: [visit_date, dept_code]
    owner: 門診管理組
```

## 現成工具的定位

| 工具 | 定位 |
|---|---|
| 資料庫 view + 指標清單 | 最小做法；適合指標少、使用者集中在同一個資料庫 |
| dbt 的 semantic layer（metrics） | 指標定義寫在 dbt 專案裡，跟轉換模型一起版控，由查詢服務產生 SQL |
| Cube | 獨立的語意層服務，對外提供查詢 API、權限與快取，多個前端與工具共用 |

這些工具解決的都是「定義只寫一份、到處一致」。它們不會替你決定作廢單算不算掛號，那仍是負責人要定下來的事。工具的版本與功能變動很快，導入前以官方文件為準。

## 常見錯誤

| 症狀 | 原因 | 怎麼修 |
|---|---|---|
| agent 回答的數字和報表不一致，但 SQL 看起來沒錯 | 排除條件只存在報表裡，agent 看欄位名猜 | 把排除條件寫進 view，agent 只查 view |
| 全院取消率和各科取消率加權後對不起來 | 把每日或每科的比率直接平均 | view 只放分子分母，比率在最後一步相除 |
| JOIN 病人表之後掛號數變多 | 粒度不同的表 JOIN，列被複製 | 定義裡寫粒度，先彙總再 JOIN |
| 同一個指標有兩個 view | 沒有指標清單，各自建 view | 指標清單唯一，一個名稱一份定義 |
| 定義改了，昨天的數字跟著變 | 沒有版本 | 定義放 git、記錄生效日；回答附定義版本 |
| 科別維度出現 `im` 與 `IM` 兩組 | 代碼沒正規化 | 回到治理：在轉換層正規化，維度值以代碼表為準 |
| 以為建了 view 就有權限隔離 | agent 帳號仍能讀原始表 | 用 `GRANT` 只開放 view 與指標清單 |

> 定義層讓錯誤**一致**，不會讓錯誤**消失**。資料品質的問題要回到治理那一層處理。

## 動手

1. 按上面 SQL 的「在 Playground 開啟」，看 guess 與 metric 兩組的差別；把 view 裡的 `AND NOT is_test` 拿掉再跑，看外科的數字怎麼變。
2. 在 Playground 加一個指標「報到率」：`status = 'completed'` 的筆數 ÷ 掛號數，先加到 view 的分子，再寫查詢。
3. 試試直接平均每日取消率：`SELECT dept_code, AVG(cancellations::numeric / registrations) FROM m_registrations GROUP BY dept_code;`，和 `SUM ÷ SUM` 的結果比較。
4. 回頭看 [資料治理](#/skill/data-governance) 的代碼表與品質檢查，想想 `dept_code` 這個維度要先做哪些處理。
5. 做本課的程式題：依指標定義建 view，再用 view 回答各科取消率。

# 課程內容撰寫合約

一課由四個部分組成：

| 部分 | 檔案 | 說明 |
|---|---|---|
| 索引 | `src/content/dN-<domain>.js` 的 `skills[]` | id、title、en、level、summary、example、keywords、lab |
| 重點卡 | `src/content/body/dN-<domain>.js` | 5 條 points、3 條 checklist、refs |
| **深入** | `src/content/deep/<skill-id>.md` | 本檔主要規範的部分：一篇完整的課 |
| 驗收 | `src/content/quizzes/<domain>.js`（3 題選擇題，見 `CONTRIBUTING-quizzes.md`）、`src/content/exercises/`（程式題，選配） | |

重點卡是複習用的摘要；深入內容才是教學本體。兩者不矛盾、不重複整段文字。

## 深入內容（`deep/<skill-id>.md`）

### 結構

用 `##` 分段（技能頁會把它降一級放在「深入」底下），不要用 `#`。建議的段落順序如下，段名可以依主題調整，但至少要有三個 `##`：

1. **從一個具體問題開始**：一個會真的發生的狀況，例如「兩個人同時買最後一件商品」。直接描述狀況與後果，不寫「為什麼要學」、不寫動機段落。
2. **運作原理**：機制一步一步講清楚。能用時間線、表格、ASCII 圖就用；寫出中間狀態（例如每個交易在每一步看到的值）。
3. **實際程式**：完整、可以跑的範例，每段附註解。優先用本站能執行的語言（Python、PostgreSQL SQL、JavaScript）。
4. **常見錯誤與錯誤訊息**：實際的錯誤訊息長什麼樣、從訊息怎麼找到原因、怎麼修。
5. **動手**：讀者接著可以做什麼（在 Playground 跑哪段、改哪個參數會看到什麼、對應的實驗室或程式題）。

篇幅：正文（不含程式碼）約 3,000–5,000 字；校驗下限 1,500 字。

### 語氣與正確性

- 繁體中文、台灣用語；技術名詞保留英文（第一次出現可附中文）。
- 直接、精簡、講事實。不用「為什麼要學」「給前端工程師」「你工作上」「你已經會」這類措辭（校驗會擋）。
- 不確定的事不要寫成確定；版本相關的行為註明版本（例如「PostgreSQL 的預設是 READ COMMITTED」）。
- 連結只放確定存在的官方文件（https）；站內連結用 `#/skill/<id>`、`#/scenario/<id>`、`#/lab/<Name>`、`#/playground?lang=…`。
- 範例資料用虛構的資料，不放真實個資。

### 支援的 markdown

標題（`##`、`###`）、段落、清單（兩層）、表格、程式碼區塊、引用（`>`，顯示成提示框）、分隔線、**粗體**、`行內碼`、[連結](https://example.org)。不支援 HTML、圖片。

### 可執行的程式碼區塊

在語言後面加 `run`，技能頁會在區塊下方顯示「在 Playground 開啟」：

````md
```python run
from decimal import Decimal
print(Decimal('0.1') + Decimal('0.2'))
```
````

規則（`npm run e2e:deep` 會實際執行每一個 `run` 區塊，必須成功）：

| 語言 | 執行環境 | 限制 |
|---|---|---|
| `python run` | Pyodide（瀏覽器內 CPython） | 只能用標準函式庫（`sqlite3`、`asyncio`、`json`、`decimal`、`datetime` 可用；`zoneinfo` 沒有時區資料，時區用 `datetime.timezone(timedelta(hours=8))`）；不能連網、不能裝套件；12 秒逾時 |
| `sql run` | PGlite（瀏覽器內 PostgreSQL） | 執行前資料庫會重設成電商範例：`users(id, name, email, city, created_at)`、`products(id, name, price, stock)`、`orders(id, user_id, status, amount, created_at)`、`order_items(order_id, product_id, qty)`。可以自己 `CREATE TABLE`。單一連線（沒辦法真的開兩個並行交易） |
| `js run` | Web Worker | 沒有 DOM、不能連網；8 秒逾時 |

不能在瀏覽器跑的（bash、Dockerfile、YAML、nginx、HTTP 原文、需要第三方套件的 Python）照樣用程式碼區塊，但**不要**加 `run`。

## 新課的完整清單

新增一課時要一次備齊：

1. 索引：`dN-*.js` 加一筆（id 全站唯一、小寫英數與連字號）
2. 重點卡：`body/dN-*.js` 加同 id 的 points（5 條，每條 `{ b, t }`）、checklist（3 條）、refs（只放確定存在的官方 https 連結，不確定就留空陣列）
3. 深入：`deep/<id>.md`
4. 選擇題：`quizzes/<domain>.js` 3 題
5. 程式題（選配）：`exercises/` 加題；題型有 `sql`、`python`、`js`、`config`（設定檔：使用者內容成為 `source`／`lines`，用 JS 測試檢查）

## 交付前

```bash
npm run validate          # 索引、內文、深入內容、題庫、情境
npm run build && npm run preview   # 另一個終端
npm run e2e:deep          # 深入內容的 run 區塊都能執行
npm run e2e:verify        # 有加程式題時：解答通過、起始碼不通過
```

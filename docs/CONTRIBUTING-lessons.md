# 課程內容撰寫合約

一課由五個部分組成：

| 部分 | 檔案 | 說明 |
|---|---|---|
| 索引 | `src/content/dN-<domain>.js` 的 `skills[]`（領域有 `track`，決定屬於哪條路線） | id、title、en、level、summary、example、keywords、lab；選填 reviewed、related（其他路線的相關課 id） |
| **地圖** | `src/content/body/dN-<domain>.js` 的 `map` | 每課的基底：叫得出名字、說得出要求、驗得出對錯（見下方「地圖層」） |
| 重點卡 | `src/content/body/dN-<domain>.js` | 5 條 points、3 條 checklist、refs |
| **深入** | `src/content/deep/<skill-id>.md` | 本檔主要規範的部分：一篇完整的課 |
| 驗收 | `src/content/quizzes/<domain>.js`（3 題選擇題，見 `CONTRIBUTING-quizzes.md`）、`src/content/exercises/`（程式題，選配）、`body/dN-<domain>.js` 的 `challenge`（進階驗收） | |

地圖是每課的基底，讓讀者叫得出名字、說得出要求、驗得出對錯；重點卡是複習用的摘要；深入內容是選讀的細節。三者不矛盾、不重複整段文字。

## 地圖層（`map`）

教學方式：不鉅細靡遺地講一個技術的所有細節，而是宏觀交代必須知道的項目，讓讀者用 AI 寫程式或跟同事溝通時，能用正確的名詞具體描述腦中的想法，並判斷產出對不對。地圖放在技能頁的最上方，深入內容在後面選讀。

```js
map: {
  names: [ { n: '名詞', t: '一句：是什麼、解決什麼問題' } ],      // 4–8 條：叫得出名字
  ask: [ '描述需求時要講清楚的一件事' ],                           // 3–6 條：說得出要求
  prompt: '2–4 句的描述範例，用上面的名詞把一個具體需求講清楚',      // 頁面上有「複製」按鈕
  verify: [ { c: '檢查什麼', t: '一句：怎麼看、跑什麼、錯的時候長什麼樣' } ],  // 3–6 條：驗得出對錯
}
```

- 名詞選「寫需求、讀 AI 產出時會出現的那些」，不是課文的完整索引。
- `ask` 每條寫成「要講清楚的事」（例如「失敗時回哪個狀態碼、錯誤 body 長什麼樣」），不寫成命令句或問句。
- `prompt` 是一段真的能用的描述：情境具體、用到 `names` 的名詞，不寫「請你」「幫我」這類客套。
- `verify` 要可操作：指令、開發者工具的哪個分頁、哪個查詢、看到什麼代表錯了；適合時點出 AI 產生的程式常見的錯。
- 範例：`body/d2-web.js` 的 `rest-design`。`npm run validate:content` 會檢查格式。

## 進階驗收（`challenge`）

每課都要有（`validate` 會擋），放在 `body/dN-*.js` 該課的物件裡（和 `map`、`points` 同一層）。課頁顯示在驗收區、程式題與選擇題之後，標題「進階驗收」；驗收條件的勾選只存在讀者的瀏覽器，不同步。

```js
challenge: {
  task: '情境與任務（markdown，可以有站內連結 #/skill/…、#/lab/…）',
  deliver: '交付物，一句（例如「三次操作各一張截圖與一句觀察」「一段 PR 評語」）',
  check: ['驗收條件 1', '驗收條件 2'],   // 2–4 條，每條能判斷過或不過
  twist: '需求變化（選填）：按了才展開，要讀者先預測驗收結果會怎麼變、為什麼',
},
```

- 任務要用到站上存在的工具、實驗室或程式題；交付物是觀察、預測、解釋或取捨，不是能整段交給 AI 產生的東西。
- 部分課的 `task` 或 `twist` 換成非醫療情境（庫存、票務、訂位、物流），要讀者說出哪些條件能沿用、哪些要跟業務確認。
- `npm run validate:content` 檢查格式；設計情境的 `challenge` 格式相同。

## 跨課作業（`src/content/assignments.js`）

把幾堂課接成一次任務，頁面在 `#/assignments`（可依路線篩選）與 `#/assignment/<id>`，路線首頁有入口。

```js
{
  id: 'vue-vite-upgrade', track: 'frontend', title: '…', summary: '一句',
  lessons: ['npm-packages', 'vite-basics'],   // 存在的課 id，至少一個
  stages: ['fe-deploy'],                      // 選填：實作路線階段 id
  scenarios: ['env-config-choice'],           // 選填：設計情境 id
  steps: [ { title: '…', do: '…（markdown）', deliver: '一句', check: ['…'] } ],   // check 1–4 條，勾選記在讀者的瀏覽器
  twist: '…',                                 // 選填
}
```

`npm run validate:content` 檢查課、階段、情境與站內連結都存在。

寫法：

- 每份 3–6 步。每一步的交付物是觀察、預測、取捨，或自己操作後才有的紀錄（錯誤訊息、截圖、diff、逐案例的對照表），不是能整份交給 AI 產生的文件。要預測的步驟，`check` 寫「預測在執行前寫下，和結果並排」。
- `check` 每條都能判斷過或不過：寫數字、看得到的結果或紀錄的位置，不寫「理解」「合理」。
- `do` 指名站上真的有的東西：課、情境、實驗室（`#/lab/<Name>`）、Playground 的固定情境或 `api.get` 覆寫的假 API 路由、實作路線階段的「串接驗收」、後端參考專案 `companion/clinic-api`。控制項的名稱照畫面上的文字寫。
- 接到既有的實作路線階段時，`stages` 列出階段，`do` 直接引用該階段串接驗收的第幾步，不重寫一遍。
- `twist` 是做完才展開的一個需求變化，要讀者先預測結果怎麼變，再決定改什麼。
- 資料一律虛構，網域用 `example` 系列；牽涉金額、單價、版本時，要讀者註明來源與查詢日期，不在作業裡寫死。

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

寫作規則見 `.claude/skills/atlas-writing/SKILL.md`（介面文字與中文 AI 腔的改法），搭配 `.claude/skills/stop-slop/`。

- 繁體中文、台灣用語；技術名詞保留英文（第一次出現可附中文）。
- 直接、精簡、講事實。不用「為什麼要學」「給前端工程師」「你工作上」「你已經會」這類措辭（校驗會擋）。
- 不確定的事不要寫成確定；版本相關的行為註明版本（例如「PostgreSQL 的預設是 READ COMMITTED」）。
- 連結只放確定存在的官方文件（https）；站內連結用 `#/skill/<id>`、`#/scenario/<id>`、`#/lab/<Name>`、`#/playground?lang=…`。
- 範例資料用虛構的資料，不放真實個資。

### 支援的 markdown

標題（`##`、`###`）、段落、清單（兩層）、表格、程式碼區塊、引用（`>`，顯示成提示框）、分隔線、**粗體**、`行內碼`、[連結](https://example.org)。不支援 HTML、圖片。

### 停靠點（`:::stop`）

每份深入內容都要有一個（`validate` 會擋），獨佔一行、從行首開始：

```
:::stop 讀到這裡可以先停：會做 X、Y。後面的 Z 在 <情況> 時再回來讀。
```

- 每課最多 1 個（`spa-containers`、`k8s-rbac-tenancy`、`k8s-networking` 最多 3 個，寫成「停靠點 N：交付物」，各自有完成條件）。放在「第一次讀到這裡就夠用」的位置，通常在運作原理與一個完整範例之後。
- 不放在程式碼區塊、表格或清單中間。頁面顯示成停靠點橫幅，課的目錄列多一個「停靠點」連結跳到第一個。
- `npm run validate:content` 檢查數量與位置。

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
| `html run` | 沙箱 iframe（不給 `allow-same-origin`） | 寫 `body` 的內容，可含 `<style>`、`<script>`、`<script type="module">`。`fetch` 由假 API 回應（路徑一律寫 `/api/…`，內建門診系統的路由，見 `src/runtime/fakeApi.js`），不能連到真的網路；`localStorage` 是記憶體替身，`document.cookie` 讀不到；載入後 0.6 秒內不能有未處理的錯誤；迴圈連續跑 1.5 秒會被中止，8 秒逾時 |
| `js run vue` | 同上，import map 有自架的 Vue 3.5.45 | 一個 module：`import { … } from 'vue'`，自己 `createApp(…).mount('#app')`（頁面有 `<div id="app">`）；元件寫成物件、模板放 `template` 字串（瀏覽器不能直接跑 `.vue` 檔，SFC 範例照常用 `vue` 程式碼區塊，但不加 `run`）。其他同 `html run` |

不能在瀏覽器跑的（bash、Dockerfile、YAML、nginx、HTTP 原文、需要第三方套件的 Python）照樣用程式碼區塊，但**不要**加 `run`。

## 新課的完整清單

新增一課時要一次備齊：

1. 索引：`dN-*.js` 加一筆（id 全站唯一、小寫英數與連字號）。內容會隨時間變動的課（規格還在改、提到版本或效期、引用事件）加 `reviewed: 'YYYY-MM'`，技能頁會顯示「內容核對：YYYY 年 M 月」；之後每次核對內容就更新這個欄位。其他路線有對應的課時加 `related: ['課 id']`（只放其他路線的課；對方不用回連，課頁會自動列出反向連結）
2. 地圖與重點卡：`body/dN-*.js` 加同 id 的 `map`（見上方「地圖層」）、points（5 條，每條 `{ b, t }`）、checklist（3 條）、refs（只放確定存在的官方 https 連結，不確定就留空陣列）
3. 深入：`deep/<id>.md`
4. 選擇題：`quizzes/<domain>.js` 3 題
5. 程式題（選配）：`exercises/` 加題；題型有 `sql`、`python`、`js`、`config`（設定檔：使用者內容成為 `source`／`lines`，用 JS 測試檢查）、`html`、`css`、`vue`。交卷後結果區顯示「這題驗了什麼」：預設依題型（config：只檢查設定檔的文字，沒有啟動服務；sql：比對查詢結果與預期資料表；python、js：執行測試清單；html、css、vue：在沙箱裡照測試操作畫面並量測），題目可以用 `verifies: '…'`（字串）改寫成更精確的說明，例如設定題只檢查了哪幾個鍵
6. 進階驗收：`body/dN-*.js` 的 `challenge`（見上方「進階驗收」）

## 交付前

```bash
npm run validate          # 索引、內文、深入內容、題庫、情境
npm run build && npm run preview   # 另一個終端
npm run e2e:deep          # 深入內容的 run 區塊都能執行
npm run e2e:verify        # 有加程式題時：解答通過、起始碼不通過
npm run check:links       # 外部連結（需要能連外網；CI 的 Links workflow 每月跑一次，也可以手動觸發）
```

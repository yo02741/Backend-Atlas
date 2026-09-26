# 設計情境（Scenario）撰寫合約

情境教的是「在限制下做選擇」：一段產品背景、幾條限制、2–4 種做法、一個能親手玩每種做法後果的**模擬器**、取捨表、換條件的**決策題**、以及選定做法的落地程式碼。

## 檔案

- 內容：`src/content/scenarios/<id>.js`（`export default { … }`）
- 模擬器：`src/labs/scenarios/<Name>ScenarioLab.jsx`（`export default function <Name>ScenarioLab()`，無必填 props）
- 範本：`src/content/scenarios/pagination.js` 與 `src/labs/scenarios/PaginationScenarioLab.jsx`。**先讀這兩個檔。**

## 內容格式

```js
export default {
  id: 'cache',                 // 檔名要一致：cache.js
  order: 2,                    // 總覽頁排序（api 1–8、data 9–12、traffic 13–18）
  group: 'api',                // api | data | traffic
  title: 'API 快取',           // 名詞短語，不用問句
  en: 'API caching',
  level: 2,                    // 1 入門 2 進階 3 深入
  skills: ['http-caching', 'redis-cache'],   // 必須是 src/content/dN-*.js 裡真實存在的 skill id
  week: 9,                     // 對應 docs/CURRICULUM.md 的週次（選填）
  lab: 'CacheScenarioLab',     // 模擬器元件名
  summary: '一句話：情境 + 核心兩難。',
  situation: '一段產品描述（2–4 句），具體數字：資料量、流量、更新頻率、客戶端是誰。',
  constraints: ['3–5 條硬限制，每條一句', '…'],
  options: [                   // 2–4 種做法
    { id: 'http', name: 'HTTP 快取標頭', summary: '一句話說做法（可用 `code`）', pros: ['…'], cons: ['…'] },
  ],
  tradeoffs: { axes: ['效能', '一致性', '複雜度', '成本'], rows: [{ option: 'http', cells: ['好：…', '差：…', '低', '低'] }] },
  decisions: [                 // 3–4 題，換條件的變體，正解要分散在不同做法
    { id: 'product', situation: '變體情境（1–2 句）', options: ['http', 'redis', 'none'], answer: 'http', explain: '2–4 句：這個條件下為何這樣選、其他做法差在哪。' },
  ],
  implementation: [            // 1–3 段落地程式碼
    { title: '回應標頭', lang: 'http', code: '…' },   // lang: sql | python | js | yaml | bash | nginx | http | json
  ],
  exercise: null,              // 相關程式題 id（選填，必須存在於 src/content/exercises/）
}
```

內容欄位不可含超連結；只有 `implementation[].code` 例外（nginx `proxy_pass http://…`、範例 URL 之類本來就是程式碼的一部分）。

## 模擬器規則

與實驗室合約（`docs/CONTRIBUTING-labs.md`）相同：只 import React 與 `../ui.jsx`（路徑多一層）、顏色只用 CSS token、inline SVG 或 `.dtable`、繁體中文、無超連結、手機 390px 不溢出、專屬 CSS 加前綴。另外：

- **純前端模擬，不用執行環境**（Pyodide / PGlite 只有分頁範本用到，其他情境不要用），所有數字都是示意並在畫面上標「示意」。
- 模擬器要讓學習者**切換做法就看到後果**：同一組操作（送請求、更新資料、插入列、流量暴衝…）在不同做法下的結果並排或可切換比較。至少一個「按下去會動」的互動（按鈕觸發動畫或逐步），不是靜態圖。
- 用 `<Seg>` 切做法或實驗、`<Slider>` 調參數（流量、TTL、延遲、worker 數…）、計數器顯示結果（例如「打到 DB 的請求：120 / 1000」「重複扣款：2 筆」「p95 延遲：示意」）。
- 說明文字跟著目前做法變；一個 `<Callout title="什麼時候會真的踩到">`。
- 長度 250–450 行。

## 語氣

直接、精簡、講事實。**不寫**「為什麼要學」「為什麼重要」「你工作上」「給前端工程師」這類段落或措辭。取捨用「好 / 差 / 中」加一句原因，不用形容詞堆疊。

## 驗證（必做）

```bash
cd <專案根目錄>
npm run validate:scenarios                    # 結構校驗，必須 OK
npx esbuild src/labs/scenarios/<Name>ScenarioLab.jsx --bundle --jsx=automatic --log-level=warning --outfile=/tmp/<Name>.js
npx vite --port <PORT> --strictPort > /tmp/dev-<PORT>.log 2>&1 &     # 自己的 dev server
node e2e/shot.mjs "http://localhost:<PORT>/?lab=<Name>ScenarioLab" e2e/shots/<Name>-light.png 1100 light
node e2e/shot.mjs "http://localhost:<PORT>/?lab=<Name>ScenarioLab" e2e/shots/<Name>-dark.png 1100 dark
node e2e/shot.mjs "http://localhost:<PORT>/?lab=<Name>ScenarioLab" e2e/shots/<Name>-mobile.png 390 light
node e2e/shot.mjs "http://localhost:<PORT>/#/scenario/<id>" e2e/shots/<id>-page.png 1200 light
```
用 Read 看每張圖，PAGEERROR / CONSOLE 必須為空。寫個小 playwright 腳本按過每個按鈕、切過每個做法，確認狀態會變、不會炸。完成後殺掉 dev server。

## 回報

- 建立的檔案
- 每個情境一行：做法有哪些、模擬器讓學習者看到什麼
- 驗證結果（validate OK、三種截圖無錯、互動測過）
- 不確定或簡化之處

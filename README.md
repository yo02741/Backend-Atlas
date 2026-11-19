# u kinda should know

**AI said all good.** 但這些，u kinda should know。

學習網站，三條路線：**前端**、**後端**、**AI**。每課的基底是一張「地圖」：叫得出名字（名詞與一句說明）、說得出要求（描述需求要講清楚的事，附一段描述範例）、驗得出對錯（怎麼檢查產出）；深入內容、互動實驗室與練習題是選讀。程式題在瀏覽器裡執行（PostgreSQL、Python、JavaScript），不需要後端伺服器。

- **線上**：[backend-atlas.web.app](https://backend-atlas.web.app/)（Firebase Hosting）、[yo02741.github.io/Backend-Atlas](https://yo02741.github.io/Backend-Atlas/)（GitHub Pages），每次 push 到 `main` 兩邊同時更新。repo 與 Firebase 專案改名後，這兩個網址、`src/content/tracks.js` 的 `SITE.repo`、`.firebaserc`、`.env.production` 與 `deploy.yml` 的 `projectId` 要一起改。
- **本機**：`npm install && npm run dev`（第一次會把 Pyodide 複製到 `public/pyodide/`）

### 網頁流程

```
#/                首頁：一句開場，三張路線卡（課數、進度、下一站）
└ #/track/<路線>   路線首頁：學習路線圖、領域、關鍵字、設計情境、精選實驗室（frontend / backend / ai）
  └ #/domain/<id>  領域：這個領域的課
    └ #/skill/<id> 課：地圖 → 實驗室 → 重點 → 深入 → 驗收 → 自我檢核 → 其他路線的相關課
```

- 導覽列一直顯示三個路線分頁，目前的路線會標出來；技能盤點、課綱、實驗室、設計情境、練習題的連結帶上目前的路線（`?track=`），列表頁上方可以切換「全部、前端、後端、AI」。
- 課頁的麵包屑是「首頁 / 路線 / 領域」；在路線圖上的課標「學習路線 第 N / M 站」。
- 還沒有課的路線，首頁卡片標「撰寫中」，路線首頁列出規劃中的領域。
- 視覺是貼紙風：奶油底、黑框、平塗色、位移陰影。標題字是 Bricolage Grotesque（英文）＋昭源甜圓體 Chiron GoRound TC（中文），都是 SIL OFL，自架在站上（`src/fonts.css` 由 `npm run fonts:gen` 產生，中文依 unicode-range 分片，只下載頁面上用到的字）；內文用系統字。
- 站的標誌是貼紙底上的紅色打勾（`public/favicon.svg`，元件 `src/components/BrandMark.jsx`），另有 `favicon-32.png`、`apple-touch-icon.png`（180）、`icon-512.png`。

<!-- sync:stats -->
| 內容 | 數量 |
|---|---|
| 路線 | 3（前端 60 課；後端 115 課；AI 35 課） |
| 前端的領域 | 9（瀏覽器與網頁怎麼運作；HTML 與 CSS 版面；JavaScript 與 TypeScript；元件與框架；UI 元件詞彙；呼叫後端；建置與部署；品質；用 AI 寫前端） |
| 後端的領域 | 9（語言與工程實踐；網路、HTTP 與 API 設計；資料儲存；驗證與授權；資安；容器與部署；CI/CD 與交付；演算法與系統設計；DevOps 與基礎建設） |
| AI的領域 | 2（AI 時代的開發與 Agent 安全；知識系統） |
| 技能（課） | 210，每課有重點卡（摘要、重點、自我檢核、官方文件）與**深入內容**（從一個具體問題開始 → 運作原理 → 實際程式 → 常見錯誤與錯誤訊息 → 動手；範例可一鍵在 Playground 執行） |
| 互動實驗室 | 50，依領域列在下方 |
| 程式題 | 204（Python 127 / SQL 38 / config 27 / JS 12），含實作路線的 20 道驗收題；解答全部經真實執行環境驗證 |
| 選擇題 | 630（每課 3 題，含程式碼判讀與情境題） |
| 設計情境 | 31（API 設計 8；資料與身分 4；高流量 7；維運與基礎建設 7；AI 與 Agent 安全 5） |
| 後端的實作路線 | 從零做完一個門診掛號後端：10 個階段，每階段有說明與在瀏覽器裡跑的驗收題 |
| 課綱 | `docs/CURRICULUM.md`（後端與 AI）：獨立盤點的技能樹、16 週主線課綱（含實作路線對照）、第 17–22 週延伸課綱、10 週的 Docker 到 Kubernetes 專題、驗收設計；`docs/CURRICULUM-frontend.md`（前端） |
<!-- /sync:stats -->

## 內容總覽

後端以 Python 與 PostgreSQL 為主，MongoDB、Redis 作對照；AI 路線的範例也用 Python；前端以 Vue 3 為主，React 作對照。

<!-- sync:route -->
### 建議學習路線（3 條、共 68 站）

各路線首頁路線圖的站點。★ 表示附互動實驗室。站點定義在 `src/content/roadmap.js` 的 `PATHS`（`label` 是地圖上的短站名，`note` 是下表的「內容」）。

#### 前端（33 站）

| 站 | 課 | 領域 | 內容 |
|---|---|---|---|
| 1 | 瀏覽器怎麼把網頁畫出來★ | 瀏覽器與網頁怎麼運作 | DOM、CSSOM、render tree 到 layout、paint、composite，改哪個屬性重跑哪一段。 |
| 2 | 開發者工具：驗收前端的固定路線 | 瀏覽器與網頁怎麼運作 | Console、Network、Elements、Application、Lighthouse 的固定驗收順序。 |
| 3 | 一個頁面的載入順序 | 瀏覽器與網頁怎麼運作 | CSS 擋畫面、script 擋解析，defer、async、module 與 preload。 |
| 4 | 語意化 HTML 與表單元素 | HTML 與 CSS 版面 | 地標元素、button 與 label、input 的 type 與 inputmode。 |
| 5 | CSS 怎麼決定套用哪一條 | HTML 與 CSS 版面 | 誰勝出：!important、@layer、選擇器權重、出現順序，以及 Vue scoped CSS。 |
| 6 | 盒模型 | HTML 與 CSS 版面 | border-box、margin 合併、overflow 與 outline。 |
| 7 | Flexbox：一維排列★ | HTML 與 CSS 版面 | 主軸與交叉軸、剩餘空間怎麼分，以及 min-width 造成的溢出。 |
| 8 | Grid：二維版面★ | HTML 與 CSS 版面 | fr、minmax、auto-fill 與 auto-fit、命名區域。 |
| 9 | RWD 與斷點 | HTML 與 CSS 版面 | viewport meta、mobile-first 的 media query 與 container query。 |
| 10 | JavaScript 必要語法 | JavaScript 與 TypeScript | const、箭頭函式、解構、展開、?. 與 ??，陣列方法會不會改原陣列。 |
| 11 | 非同步：Promise 與 async/await | JavaScript 與 TypeScript | 依序與平行、Promise.all 與 allSettled、finally 關掉 loading。 |
| 12 | 事件迴圈★ | JavaScript 與 TypeScript | task、microtask 與渲染時機，長迴圈為什麼讓畫面凍結。 |
| 13 | DOM 與事件★ | 瀏覽器與網頁怎麼運作 | 捕獲與冒泡、事件委派，stopPropagation 與 preventDefault 各管什麼。 |
| 14 | 元件化與單檔元件 | 元件與框架 | 把畫面拆成元件樹，SFC 的 template、<script setup>、<style scoped>。 |
| 15 | 響應式：ref、reactive、computed★ | 元件與框架 | ref、reactive、computed，以及解構之後失去響應式。 |
| 16 | 模板語法、條件與列表渲染 | 元件與框架 | v-bind、v-on、v-if 與 v-show、v-for 的 key。 |
| 17 | props、emits 與 v-model | 元件與框架 | 單向資料流、defineEmits、defineModel，子元件不改 props。 |
| 18 | Vue 的生命週期 | 元件與框架 | onMounted 拿 DOM、onUnmounted 清掉計時器、監聽與請求。 |
| 19 | 互動狀態★ | UI 元件詞彙 | hover、focus-visible、disabled、loading 的狀態表與驗收。 |
| 20 | 回饋：Toast、Alert、Skeleton、Empty state | UI 元件詞彙 | Toast、Alert、Skeleton、Empty state 各用在哪裡。 |
| 21 | 浮層：Dialog、Drawer、Popover、Tooltip | UI 元件詞彙 | Dialog、Drawer、Popover、Tooltip：擋不擋操作、焦點進出、Esc 關閉。 |
| 22 | 無障礙基礎 | 品質：測試、效能、無障礙 | 鍵盤走得完、控制項有名稱、對比 4.5:1、狀態念得出來。 |
| 23 | 表單綁定與驗證 | 元件與框架 | v-model 綁出的型別、離開欄位才顯示錯誤、aria-describedby。 |
| 24 | fetch 與 HTTP | 呼叫後端 | res.ok、JSON body、Problem Details 與逾時。 |
| 25 | API 的四種狀態：loading、success、empty、error★ | 呼叫後端 | loading、success、empty、error，哪些錯誤給重試。 |
| 26 | 取消請求與競態★ | 呼叫後端 | AbortController 取消舊請求、debounce，畫面只反映最後的條件。 |
| 27 | 表單送出與驗證錯誤 | 呼叫後端 | 422 對回欄位、409 放表單上方、停用按鈕加冪等鍵防止重複送出。 |
| 28 | Vue Router：路由 | 元件與框架 | 動態參數、守衛用回傳值、懶載入，history 模式的伺服器 fallback。 |
| 29 | Pinia：全域狀態 | 元件與框架 | setup store、storeToRefs，狀態放元件、網址還是 store。 |
| 30 | Vite：開發與建置 | 建置與部署 | dev server、HMR、vite build 的產物，以及 Vite 6 與 8 的差別。 |
| 31 | 把畫面描述成文字 | 用 AI 寫前端 | 版面、元件、狀態、資料、互動五段，加上斷點與文案。 |
| 32 | AI 寫前端的常見錯誤 | 用 AI 寫前端 | Vue 2 寫法、混用 API、多餘的 watch、錯的 key，用工具抓。 |
| 33 | 驗收 AI 產出的前端 | 用 AI 寫前端 | 指令、每個狀態、三個寬度、只用鍵盤、Console 與 Network，最後寫成測試。 |

#### 後端（23 站）

| 站 | 課 | 領域 | 內容 |
|---|---|---|---|
| 1 | 一個 HTTP 請求的一生★ | 網路、HTTP 與 API 設計 | 看清一個請求從瀏覽器到伺服器的每一步。 |
| 2 | REST API 設計★ | 網路、HTTP 與 API 設計 | 資源、方法、狀態碼的設計。 |
| 3 | SQL 基礎：SELECT 到 GROUP BY | 資料儲存 | SELECT、WHERE、GROUP BY 與聚合函式。 |
| 4 | JOIN 七兄弟★ | 資料儲存 | 各種 JOIN 用文氏圖與結果表對照。 |
| 5 | 索引與查詢計畫★ | 資料儲存 | 用 B-tree 索引與 EXPLAIN 找出慢查詢的原因。 |
| 6 | 交易、ACID 與隔離等級★ | 資料儲存 | ACID、隔離等級，以及兩個交易交錯時各讀到什麼。 |
| 7 | 驗證基礎：Session vs Token | 驗證與授權 | Session 與 Token 兩種帶身分的方式。 |
| 8 | JWT 解剖★ | 驗證與授權 | 把 token 拆成三段，看簽章怎麼算。 |
| 9 | RBAC 與 ABAC 授權模型★ | 驗證與授權 | 用角色與屬性決定誰能做什麼。 |
| 10 | 注入攻擊：SQL 與它的親戚★ | 資安 | SQL 注入的原理與參數化查詢。 |
| 11 | Docker：image、container、layer★ | 容器與部署 | image、container、layer 與 build 快取。 |
| 12 | 容器的日常維運：日誌、資源上限、訊號與執行環境 | 容器與部署 | 日誌輪替、記憶體上限、SIGTERM 與執行環境。 |
| 13 | CI 管線：lint、test、build★ | CI/CD 與交付 | lint、test、build 三段，GitHub Actions 與 GitLab CI 對照。 |
| 14 | 效能量測與壓測：p95、飽和點、找瓶頸★ | 演算法與系統設計 | 量 p95、找飽和點、定位瓶頸。 |
| 15 | 網路通不通：從 DNS 到防火牆★ | DevOps 與基礎建設 | 連不上時，從 DNS 一層一層往下查。 |
| 16 | HTTPS 憑證：要買哪種、怎麼續★ | DevOps 與基礎建設 | 憑證鏈、憑證種類與自動續約。 |
| 17 | 導入 Kubernetes 前要準備什麼★ | DevOps 與基礎建設 | 導入 Kubernetes 之前要先備齊的東西。 |
| 18 | Kubernetes 實作：把服務寫成 manifest | DevOps 與基礎建設 | 把服務寫成 manifest：Deployment、Service、Ingress。 |
| 19 | Kubernetes 網路：Service、NetworkPolicy 與連到叢集外★ | DevOps 與基礎建設 | Service、NetworkPolicy 與連到叢集外的舊系統。 |
| 20 | FinOps：雲端與 AI 工具的計費結構★ | DevOps 與基礎建設 | 雲端與 AI 工具的計費結構。 |
| 21 | 舊系統整合與逐步替換 | 演算法與系統設計 | 逐步替換舊系統，每一步都能回退。 |
| 22 | 可重跑的批次管線：增量、冪等、回補 | DevOps 與基礎建設 | 增量、冪等、回補：重跑不會重複寫入。 |
| 23 | 測試品質：覆蓋率、假綠燈與突變測試★ | 語言與工程實踐 | 用突變測試檢查測試有沒有驗到東西。 |

#### AI（12 站）

| 站 | 課 | 領域 | 內容 |
|---|---|---|---|
| 1 | 專案規範檔與 context：模型看得到什麼 | AI 時代的開發與 Agent 安全 | 專案規範檔與 context：模型每一輪實際看到的內容。 |
| 2 | Skill 與 MCP 是什麼 | AI 時代的開發與 Agent 安全 | 把做法寫成 Skill、把工具接成 MCP server。 |
| 3 | 規範要變成測試：AI 協作下的 TDD | AI 時代的開發與 Agent 安全 | 把規範寫成測試，AI 改程式時由測試把關。 |
| 4 | Harness Engineering：評測集、重試與多數決★ | AI 時代的開發與 Agent 安全 | 同一個 prompt 跑 N 次：評測集、重試與檢查器。 |
| 5 | 後端怎麼呼叫模型：串流、結構化輸出、重試與成本 | AI 時代的開發與 Agent 安全 | 逾時、重試、串流與結構化輸出的驗證。 |
| 6 | Agent 的執行迴圈：工具呼叫、狀態機、預算與中斷★ | AI 時代的開發與 Agent 安全 | 工具呼叫、狀態機、步數與 token 預算。 |
| 7 | 沒有瀏覽器或沒有使用者的授權：Device Code、PKCE、Client Credentials★ | AI 時代的開發與 Agent 安全 | CLI 與 agent 沒有瀏覽器時怎麼授權。 |
| 8 | AI Gateway：模型路由、金鑰集中、用量與成本 | AI 時代的開發與 Agent 安全 | 模型路由、金鑰集中、配額與用量。 |
| 9 | 地端模型：自架推論與依敏感度分流 | AI 時代的開發與 Agent 安全 | 資料不能送出去時，自架模型要自己負責的事。 |
| 10 | Tool Poisoning 與 rug pull★ | AI 時代的開發與 Agent 安全 | 工具描述被下毒與 rug pull 的防法。 |
| 11 | RAG 怎麼運作，以及它的限制★ | 知識系統：從 RAG 到 LLM Wiki | RAG 怎麼運作，限制在哪裡。 |
| 12 | Semantic Layer：讓 agent 查資料不用猜欄位★ | 知識系統：從 RAG 到 LLM Wiki | agent 用定義好的指標查資料，不猜欄位。 |
<!-- /sync:route -->

<!-- sync:lessons -->
### 技能課程（20 領域、210 課）

每課有重點卡（摘要、範例技術、重點、自我檢核清單、官方文件連結）與深入內容。★ 表示附互動實驗室。


#### 前端（9 領域、60 課）

| 領域 | 課程 |
|---|---|
| 01. 瀏覽器與網頁怎麼運作 | 瀏覽器怎麼把網頁畫出來★；開發者工具（驗收前端的固定路線）；一個頁面的載入順序；DOM 與事件★；瀏覽器裡的儲存；從前端看同源與 CORS；網址與瀏覽紀錄 |
| 02. HTML 與 CSS 版面 | 語意化 HTML 與表單元素；CSS 怎麼決定套用哪一條；盒模型；Flexbox（一維排列）★；Grid（二維版面）★；定位與疊放；RWD 與斷點；圖片與媒體 |
| 03. JavaScript 與 TypeScript | JavaScript 必要語法；值、參考與不可變更新；模組與套件；非同步（Promise 與 async/await）；事件迴圈★；TypeScript 基礎；錯誤與除錯 |
| 04. 元件與框架 | 元件化與單檔元件；響應式（ref、reactive、computed）★；模板語法、條件與列表渲染；props、emits 與 v-model；slots 與元件組合；Vue 的生命週期；watch 與 watchEffect；表單綁定與驗證；composables（抽出可重用的邏輯）；Pinia（全域狀態）；Vue Router（路由）；React 對照表 |
| 05. UI 元件詞彙 | 互動狀態★；回饋（Toast、Alert、Skeleton、Empty state）；按鈕與輸入元件；選擇類元件；浮層（Dialog、Drawer、Popover、Tooltip）；導覽元件；資料顯示元件；design token 與主題 |
| 06. 呼叫後端 | fetch 與 HTTP；API 的四種狀態（loading、success、empty、error）★；取消請求與競態★；分頁、篩選與網址；表單送出與驗證錯誤；登入狀態與 401；錯誤分類與重試；即時更新（輪詢、SSE、WebSocket） |
| 07. 建置與部署 | Vite（開發與建置）；建置時設定與執行時設定；bundle、chunk 與 hash；SPA 的部署 |
| 08. 品質：測試、效能、無障礙 | 無障礙基礎 |
| 09. 用 AI 寫前端 | 把畫面描述成文字；AI 寫前端的常見錯誤；給截圖與線框；先拆元件再寫；驗收 AI 產出的前端 |

#### 後端（9 領域、115 課）

| 領域 | 課程 |
|---|---|
| 01. 語言與工程實踐 | Python 後端心智模型；電腦怎麼跑你的程式（行程、執行緒、記憶體）；資料表示（編碼、序列化、時間與金額）；uv 與專案管理★；同步、多執行緒與 async★；Web 框架與請求生命週期；專案分層與依賴注入；錯誤設計（錯誤碼與 Problem Details）；測試金字塔與 pytest；測試品質（覆蓋率、假綠燈與突變測試）★；型別檢查、lint 與格式化；日誌、錯誤處理與設定；除錯方法（最小重現、讀 traceback、二分法） |
| 02. 網路、HTTP 與 API 設計 | 一個 HTTP 請求的一生★；TCP/IP 與連線（握手、keep-alive、連線池）；REST API 設計★；分頁、篩選、版本與冪等鍵；呼叫外部服務的韌性（timeout、重試、斷路器）；OpenAPI 與 API 契約；CORS、Cookie 與同源；HTTP 快取與條件請求；DNS、TLS 與憑證；HTTP/2 與 HTTP/3；即時通訊怎麼選（輪詢、SSE、WebSocket）；GraphQL、gRPC、WebSocket 與 Webhook |
| 03. 資料儲存 | SQL 基礎（SELECT 到 GROUP BY）；JOIN 七兄弟★；資料建模與正規化；Schema 設計實戰（從需求到資料表）；索引與查詢計畫★；全文檢索；交易、ACID 與隔離等級★；鎖與死結；子查詢、CTE 與視窗函數；ORM 與 migration；資料庫維運（備份還原、連線池、慢查詢）；從舊資料庫同步資料（批次、CDC、雙寫與對帳）；MongoDB 文件模型★；MongoDB 查詢、聚合與索引；Redis 與快取策略★；關聯式 vs 非關聯式怎麼選 |
| 04. 驗證與授權 | 驗證基礎（Session vs Token）；JWT 解剖★；OAuth 2.0 與 OpenID Connect★；RBAC 與 ABAC 授權模型★；驗證授權落地（middleware 與 dependency）；帳號生命週期（註冊、驗證、重設密碼、鎖定）；API key、服務間驗證、MFA 與 SSO；企業身分（LDAP、AD、SAML 與 SCIM） |
| 05. 資安 | OWASP Top 10 地圖；注入攻擊（SQL 與它的親戚）★；密碼儲存（編碼、雜湊、加密）★；密碼學工具箱（雜湊、HMAC、加密、亂數）★；XSS、CSRF 與安全標頭★；輸入驗證與檔案上傳；秘密管理；日誌與稽核紀錄裡的個資；依賴與供應鏈安全★；資安維運（弱點管理、修補與邊界防護） |
| 06. 容器與部署 | Linux 與 shell 基礎；Docker（image、container、layer）★；容器的日常維運（日誌、資源上限、訊號與執行環境）；幫 Python 專案寫好 Dockerfile；私有映像倉庫（Harbor、映像同步與離線環境）；docker-compose 開發環境★；nginx 反向代理★；前端與 nginx 上 K8s（靜態檔、/api 轉發與執行期設定）；負載平衡；環境設定與 12-factor；應用伺服器與程序管理；物件儲存（bucket、預簽網址與生命週期）；雲端與主機基礎 |
| 07. CI/CD 與交付 | Git 工作流與分支策略；CI 管線（lint、test、build）★；環境、secrets 與 artifact；部署策略與資料庫遷移★；可觀測性（log、metrics、trace）★；LLM 應用的可觀測性；健康檢查、備份與事故處理 |
| 08. 演算法與系統設計 | Big-O 與後端常見複雜度★；後端常用資料結構；限流演算法★；LRU 與快取淘汰；並發問題（race condition 與死結）；訊息佇列與背景工作；事件驅動系統的一致性；排程工作（cron、重複執行與遺漏）；效能量測與壓測（p95、飽和點、找瓶頸）★；擴展（無狀態、負載平衡、讀寫分離）；分散式基礎（CAP、一致性與時間）；系統設計思考框架；舊系統整合與逐步替換 |
| 09. DevOps 與基礎建設 | DevOps 會議在講什麼（詞彙對照）；網路通不通（從 DNS 到防火牆）★；HTTPS 憑證（要買哪種、怎麼續）★；硬體資源與容量規劃★；FinOps（雲端與 AI 工具的計費結構）★；GitLab CI/CD 實戰；導入 Kubernetes 前要準備什麼★；Kubernetes 實作（把服務寫成 manifest）；Kubernetes 實作（設定、探針與資源）；Kubernetes 網路（Service、NetworkPolicy 與連到叢集外）★；Kubernetes 儲存（PV、PVC 與有狀態服務）；Kubernetes 排錯（Pending、CrashLoopBackOff、連不到）★；Helm、Kustomize 與 GitOps；Kubernetes 權限與多租戶（RBAC、namespace 與配額）；Kubernetes 叢集維運（發行版、升級、節點維護與備份）；地端、雲端還是混合雲；數據中台之前（資料治理）；可重跑的批次管線（增量、冪等、回補）；維度模型（事實表、維度表與緩慢變動維度）；SLI、SLO 與錯誤預算★；事故處理、on-call 與 postmortem；AIOps（讓 agent 調查告警但不亂動）；受監管環境的變更管理 |

#### AI（2 領域、35 課）

| 領域 | 課程 |
|---|---|
| 01. AI 時代的開發與 Agent 安全 | ADR（把架構決策寫下來）；把需求拆成垂直切片；規範要變成測試（AI 協作下的 TDD）；驗收設計（驗收條件與獨立驗收）；AI 改程式的品質閘門；架構測試（用測試守住分層與相依）；Harness Engineering（評測集、重試與多數決）★；把 agent 當軟體交付（版本、評測與跨模型 CI/CD）；Skill 與 MCP 是什麼；專案規範檔與 context（模型看得到什麼）；Skill 的發布與版本（內部 registry 與更新通知）；多 agent 協作（分支與工作區隔離）；後端怎麼呼叫模型（串流、結構化輸出、重試與成本）；Agent 的執行迴圈（工具呼叫、狀態機、預算與中斷）★；Agent 的記憶（要記什麼、存哪裡、怎麼忘）；Agent 協定地圖（MCP、A2A、ACP、WebMCP 與 x402）；沒有瀏覽器或沒有使用者的授權（Device Code、PKCE、Client Credentials）★；MCP 的授權（OAuth、受保護資源與 JWKS）；MCP Gateway（集中管理憑證與上架）；AI Gateway（模型路由、金鑰集中、用量與成本）；地端模型（自架推論與依敏感度分流）；集中式身分閘道（多個工具共用一套登入）；CLI 與 Agent 的 token 存哪裡；金鑰的範圍與壽命；OWASP MCP Top 10；AI 應用的威脅建模（OWASP LLM Top 10 與 MITRE ATLAS）；Tool Poisoning 與 rug pull★；Credential 隔離與執行邊界；行為層的供應鏈管理 |
| 02. 知識系統：從 RAG 到 LLM Wiki | RAG 怎麼運作，以及它的限制★；LLM Wiki（讓模型維護一份 markdown 知識庫）；知識圖譜（wikilink、反向連結與 GraphRAG）★；RAG、LLM Wiki、知識圖譜怎麼選；Semantic Layer（讓 agent 查資料不用猜欄位）★；原始資料下毒與間接提示注入 |
<!-- /sync:lessons -->

<!-- sync:labs -->
### 互動實驗室（50 個）

依路線與領域列出：

- **前端｜瀏覽器與網頁怎麼運作**：渲染管線的七段；事件的捕獲、冒泡與預設動作
- **前端｜HTML 與 CSS 版面**：Flexbox 的主軸與剩餘空間；Grid 的軌道、格線與命名區域
- **前端｜JavaScript 與 TypeScript**：事件迴圈逐步執行
- **前端｜元件與框架**：改一個值，誰跟著動
- **前端｜UI 元件詞彙**：UI 元件的狀態
- **前端｜呼叫後端**：API 的四種狀態
- **後端｜語言與工程實踐**：同步 vs 執行緒 vs async；uv 從零到能跑；覆蓋率 100% 的測試抓不抓得到錯
- **後端｜網路、HTTP 與 API 設計**：HTTP 請求的一生；REST 資源設計
- **後端｜資料儲存**：JOIN 七兄弟；索引為什麼快；表格 vs 文件；Cache-aside；兩個交易搶最後一件
- **後端｜驗證與授權**：JWT 解剖；OAuth 授權碼流程；RBAC vs ABAC
- **後端｜資安**：SQL Injection；編碼、雜湊、加密；XSS 與 CSRF 各擋在哪一層；雜湊、HMAC、加密、簽章；一個相依套件出問題時
- **後端｜容器與部署**：Dockerfile 每行一層；docker-compose 拓樸；nginx 反向代理
- **後端｜CI/CD 與交付**：CI/CD 管線對照；三種部署策略與 migration；用 trace id 串起 log、metrics、trace
- **後端｜演算法與系統設計**：Big-O 成長曲線；Token bucket 限流；逐步加壓，找飽和點
- **後端｜DevOps 與基礎建設**：網路壞在哪一層；憑證鏈驗證；容量估算；Deployment 與滾動更新；SLO 與錯誤預算；Agent 工作流一個月花多少；Kubernetes 排錯；NetworkPolicy 放行或擋下
- **AI｜AI 時代的開發與 Agent 安全**：三種授權流程；Tool Poisoning；同一個 Prompt 跑 N 次；Agent 的執行迴圈
- **AI｜知識系統：從 RAG 到 LLM Wiki**：RAG 的切段與檢索；猜欄位 vs 用定義好的指標；wikilink 長成知識圖譜
<!-- /sync:labs -->

<!-- sync:scenarios -->
### 設計情境（31 個）

每個情境包含背景與限制、模擬器、取捨表、決策題與落地程式碼。

- **API 設計（8）**：列表 API 的分頁；API 快取；付款請求的冪等與重試；限流放哪、用什麼當 key；要跑三分鐘的匯出；使用者上傳檔案；商品搜尋與篩選；API 改版不弄壞客戶端
- **資料與身分（4）**：SPA 加手機 App 的登入方案；多租戶的資料隔離；刪除使用者要留下什麼；讀寫分離後的「我剛存的怎麼不見了」
- **高流量（7）**：從 100 到 10 萬 QPS；秒殺：1,000 人搶 100 件；流量暴衝時的削峰與背壓；資料庫撐不住了：連線池、讀寫分離、分片；快取到期的瞬間：雪崩與擊穿；一則貼文要通知 10 萬個追蹤者；事件和資料庫不同步
- **維運與基礎建設（7）**：地端、雲端還是混合；數據中台之前；含 schema 變更的週末上線；掛號 API 尖峰事故；讓 agent 調查告警；舊排班與掛號系統的替換；第一個搬上 K8s 的服務
- **AI 與 Agent 安全（5）**：Agent 接上內部工具；CLI、Agent 與服務的統一身分；從一個容器到正式資料庫；LLM 應用的防線放哪幾層；模型放雲端、地端還是分流
<!-- /sync:scenarios -->

### 實作路線：從零做完一個門診掛號後端

`#/project`。資料表與約束 → 掛號規則寫成程式與測試 → REST 介面與狀態碼 → 登入與角色權限 → 同時搶最後一個號 → 快取與限流 → 打包與持續整合（Dockerfile、GitLab CI）→ 日誌、指標與追蹤 → 給 agent 一個唯讀查詢的 MCP server（OAuth 保護、依使用者限制可查的表、遮罩、稽核）→ 部署到 Kubernetes（Deployment、Service、Ingress、探針與資源、零停機滾動更新）。每階段一份說明，連回相關的課，驗收題在瀏覽器裡跑（SQL 約束、Python 規則與測試、Dockerfile 與 `.gitlab-ci.yml` 檢查）。

### 參考專案 `companion/clinic-api/`

實作路線的題目做成一個可以 clone 下來跑的服務：FastAPI、SQLAlchemy + Alembic、PostgreSQL 16、Redis，對應階段 1–8 與第 10 階段（第 9 階段的 MCP server 不在裡面）。`docker compose up -d --build --wait` 之後跑 migration 與 seed 就能用 curl 走完掛號流程；74 個測試含並發搶號，需要真的 PostgreSQL 與 Redis。另附 Dockerfile、`.gitlab-ci.yml` 與 `k8s/` 的 manifest（Kustomize 的 base 加 `kind`、`production` 兩個 overlay）。[本機 Kubernetes 實作指南](companion/clinic-api/docs/local-k8s.md) 用 kind 在自己的電腦上部署這個服務、做滾動更新，並有六個故意弄壞再排錯的練習；CI 每次都在 kind 叢集上實際部署一次。步驟、階段與檔案的對照、和網站內容的差異都寫在 [`companion/clinic-api/README.md`](companion/clinic-api/README.md)。這個目錄和網站的建置無關，`Companion` workflow 只在它變動時跑。

<!-- sync:practice -->
### 練習題

- **程式題 204 道**（Python 127、SQL 38、config 27、JavaScript 12）：在瀏覽器裡執行並跑測試：SQL 跑 PGlite、Python 跑 Pyodide、JS 跑 Web Worker；config 題（Dockerfile、compose、nginx、Kubernetes manifest、`.gitlab-ci.yml`、GitHub Actions）由 JS 檢查器逐條驗證。
- **選擇題 630 道**：每課 3 題，含程式碼判讀與情境題。
- **複習頁** `#/review`：跨課混合抽 10 或 20 題，範圍可選全部、已完成的課、指定領域或上次答錯的題；交卷後列出各領域答對率，每題附回到該課的連結，可以只重做答錯的。錯題與成績只存在瀏覽器，不同步到帳號。
<!-- /sync:practice -->

### 課綱（16 週主線、6 週延伸、10 週 K8s 專題）

| 週 | 主題 |
|---|---|
| 1–4 | Python 工程底盤、程式怎麼跑與資料表示、HTTP/REST 與 OpenAPI、錯誤設計、SQL 與資料建模、ORM 與 migration → 里程碑 M1 |
| 5–7 | 驗證、帳號生命週期、密碼儲存、JWT、RBAC/ABAC、OAuth/OIDC、XSS/CSRF、秘密與供應鏈、日誌裡的個資 |
| 8–10 | 索引與查詢計畫、交易與鎖、並發問題、快取、限流、佇列、排程、冪等、分頁、Webhook、即時通訊 → 里程碑 M2 |
| 11–13 | TCP 與 HTTP/2/3、Docker、Compose、nginx、負載平衡、CI/CD、部署策略、Linux 維運、TLS/DNS、雲端、物件儲存 |
| 14–16 | 可觀測性、資料庫維運與備份、演算法補強、擴展與壓測、分散式基礎、系統設計 → 里程碑 M3 |
| 17–19（延伸） | 網路排查、HTTPS 憑證、容量規劃、資安維運、GitLab CI/CD、導入 K8s 與 K8s 實作、地端與雲端、變更管理、資料治理、資料管線與維度模型、SLO、事故處理 |
| 20–22（延伸） | AI 時代的團隊開發、專案規範檔與模型呼叫、Agent 的身分授權與資安、地端模型、從 RAG 到 LLM Wiki |

三個里程碑都以門診掛號服務為題，和實作路線同一個專案：M1 對應階段 1–3、M2 對應階段 4–6、M3 對應階段 7–8，階段 9、10 在延伸課綱；第 3、8 週的 SQL 練習另外用站上的電商範例庫。技能樹涵蓋本站 11 個領域。

第四節「Docker 到 Kubernetes 專題」是給準備導入 K8s 的團隊用的 10 週順序（K1–K10）：前 3 週補容器、前端與 nginx、映像倉庫，後 7 週在本機 kind 叢集上從部署、排錯、網路、儲存、權限做到維運，每週有動手作業與驗收標準，可以直接排成讀書會。

<!-- sync:k8s-track -->
| 週 | 主題 | 課 |
|---|---|---|
| K1 | 容器與映像 | Docker（image、container、layer）；幫 Python 專案寫好 Dockerfile；容器的日常維運（日誌、資源上限、訊號與執行環境） |
| K2 | 前端、nginx 與 compose | nginx 反向代理；前端與 nginx 上 K8s（靜態檔、/api 轉發與執行期設定）；docker-compose 開發環境 |
| K3 | 映像倉庫與供應鏈 | 私有映像倉庫（Harbor、映像同步與離線環境）；依賴與供應鏈安全；資安維運（弱點管理、修補與邊界防護） |
| K4 | Kubernetes 是什麼，導入前要準備什麼 | 導入 Kubernetes 前要準備什麼；地端、雲端還是混合雲；硬體資源與容量規劃 |
| K5 | 第一個服務上叢集 | Kubernetes 實作（把服務寫成 manifest）；Kubernetes 實作（設定、探針與資源） |
| K6 | 排錯 | Kubernetes 排錯（Pending、CrashLoopBackOff、連不到） |
| K7 | 網路與連到院內舊系統 | Kubernetes 網路（Service、NetworkPolicy 與連到叢集外）；網路通不通（從 DNS 到防火牆）；HTTPS 憑證（要買哪種、怎麼續） |
| K8 | 儲存與有狀態服務 | Kubernetes 儲存（PV、PVC 與有狀態服務）；健康檢查、備份與事故處理 |
| K9 | 權限與多租戶 | Kubernetes 權限與多租戶（RBAC、namespace 與配額）；秘密管理；企業身分（LDAP、AD、SAML 與 SCIM） |
| K10 | 部署流程與叢集維運 | Helm、Kustomize 與 GitOps；GitLab CI/CD 實戰；部署策略與資料庫遷移；Kubernetes 叢集維運（發行版、升級、節點維護與備份）；受監管環境的變更管理；可觀測性（log、metrics、trace） |
<!-- /sync:k8s-track -->

每週標題下列出該週對應的設計情境；情境頁的「第 N 週」可直接跳回課綱。全文在 `docs/CURRICULUM.md`。

### 其他

- **Playground**：Python、PostgreSQL、JavaScript 在瀏覽器裡自由寫、直接跑，附電商範例資料庫。
- **進度與登入**：完成的課、檢核清單、題目與決策題的狀態預設存在瀏覽器；用 Google 登入後同步到其他裝置（見「登入與同步」）。

## 執行環境（全部在瀏覽器）

| 語言 | 引擎 | 大小 |
|---|---|---|
| Python 3 | [Pyodide](https://pyodide.org/)（CPython → WASM），跑在 Web Worker；自架於 `public/pyodide/`（build 前由 `scripts/copy-pyodide.mjs` 從 node_modules 複製，已 gitignore） | 約 13 MB，首次載入後快取 |
| PostgreSQL | [PGlite](https://pglite.dev/)（Postgres → WASM，記憶體模式），Vite 打包成 assets | 約 16 MB |
| JavaScript | 原生，跑在 Web Worker（每次執行新開） | — |

- 逾時保護：Python 12 秒、JS 8 秒，超過就砍掉 worker 重開（沒有 SharedArrayBuffer 無法中斷 Python）。
- SQL 練習每次執行前重建 `public` schema 並套用該題的 setup；執行後自動 `ROLLBACK` 收掉沒 COMMIT 的交易。
- 編輯器：CodeMirror 6，主題全走 CSS token（亮暗自動）。
- 進度（完成、檢核、程式題、選擇題、決策題）存在瀏覽器 localStorage；設定 Firebase 後可以用 Google 帳號登入同步（見「登入與同步」）。

## 結構

```
src/
  content/         內容（純資料，改這裡不用碰元件）
    tracks.js        路線定義（前端、後端、AI）：名稱、說明、課綱檔、精選實驗室；站名與 repo 網址（SITE）
    roadmap.js       領域索引、每條路線的學習路線 PATHS（68 站）與關鍵字 KEYWORDS、查詢 helper（domainsOf、stationsOf、displayNo…）
    dN-<id>.js       每個領域一檔的「索引」，track 決定所屬路線；檔名用全站唯一的 no（後端 1–9、AI 10–11、前端 21–29），畫面上顯示路線內的順序。skills[] 各有 id / title / en / level / summary / example / keywords / lab / related（跟著主 chunk）
    body/dN-<id>.js  每個領域一檔的「內文」：以技能 id 為 key 的 points / checklist / refs / map（技能頁才懶載入，每領域一個 chunk）
    deep/<skill-id>.md   每課的深入內容（markdown，技能頁逐課懶載入；格式見 docs/CONTRIBUTING-lessons.md）
    project/         實作路線：stages.js（階段定義）、<stage-id>.md（各階段說明，懶載入）
    skillBody.js     內文的 Suspense 載入器（readSkillBody / preloadSkillBody）
    schemas.js       SQL 練習與 Playground 共用的電商範例資料庫
    exercises/       程式題（sql / python / js / config），index.js 匯總；project.js 是實作路線的驗收題
    quizzes/         選擇題題庫，每領域一檔（extra.js 放跨領域補題），index.js 以 glob 自動收集
    scenarios/       設計情境，每個一檔，index.js 以 glob 自動收集（分組定義也在這）
  labs/            互動實驗室：ui.jsx（共用元件）、lab.css、index.js（登錄表）、*Lab.jsx
    scenarios/       情境模擬器 *ScenarioLab.jsx（index.js 懶載入）
  runtime/         py.js + py.worker.js（Pyodide）、sql.js（PGlite）、js.js + js.worker.js、check.js（評分）
  pages/           Home / Roadmap / Domain / Skill / Labs / Exercises / Review / Playground / Curriculum / Scenarios / Project
  App.jsx          hash 路由與外殼；首頁以外的頁面 React.lazy 懶載入（CodeMirror、題庫、課綱各自成 chunk），換頁走 startTransition
  components/      MetroMap、HeroArt、bits、CodeEditor、ExerciseRunner、Quiz、Decisions、Output、Markdown、Account（登入按鈕與帳號選單）
  assess.js        一個技能的驗收狀態（程式題 + 選擇題）
  review.js        複習頁的抽題與錯題紀錄（純函式，Node 可測；localStorage `atlas-review-v1`）
  progress.js      localStorage 進度（useProgress），並提供同步層用的 getProgress / replaceProgress / onLocalChange
  progressData.js  進度的資料形狀、正規化、三方合併（純函式，Node 可測）
  cloud/           選配的登入同步：config.js（讀 VITE_FIREBASE_*）、sync.js（同步狀態機，主 chunk）、firebase.js（SDK，懶載入）
  styles.css       站台樣式與 design tokens
  harness.jsx      開發用：?lab=JwtLab 只渲染該實驗室
  verify.jsx       開發用：?verify=1 把每題解答與起始碼丟進真實執行環境評分；?verify=deep 執行深入內容的每個 run 區塊
docs/              CURRICULUM.md、PLAN-2026Q4.md、AUDIT.md、CONTRIBUTING-lessons.md、CONTRIBUTING-labs.md、CONTRIBUTING-quizzes.md、CONTRIBUTING-scenarios.md
scripts/           sync-docs.mjs（產生 README 與課綱的段落）、copy-pyodide.mjs、validate-content.mjs、validate-quizzes.mjs、validate-scenarios.mjs、test-progress.mjs、test-review.mjs、check-links.mjs
companion/         clinic-api/：實作路線的參考專案（獨立的 Python 專案，有自己的 README、測試與 CI）
firestore.rules    雲端進度的存取規則（本人才能讀寫、文件形狀固定）；firebase.json 是 emulator 設定
.env.e2e           e2e 用的 Firebase 設定（指向 emulator 的 demo 專案）
e2e/               Playwright 腳本（見下）
```

## 路由

hash 路由：`#/`、`#/roadmap?kw=JWT`、`#/curriculum`、`#/domain/data`、`#/skill/sql-joins`、`#/labs`、`#/lab/SqlJoinLab`、`#/scenarios`、`#/scenario/pagination`、`#/exercises`、`#/review`（`?seed=42` 固定抽題）、`#/exercise/sql-joins-1`、`#/project`、`#/project/concurrency`、`#/playground?lang=sql`（課程的「在 Playground 開啟」會帶 `&code=`）。

## 新增內容

改完任何內容都跑 `npm run docs:sync`：README 裡 `<!-- sync:… -->` 包住的段落（統計、學習路線、課程與實驗室清單、情境清單、練習題數量、K8s 專題路線）與課綱的技能樹都由 `scripts/sync-docs.mjs` 從內容資料產生，不要手改。新課要排進 `docs/CURRICULUM.md` 某一週的「對應技能」，`npm run docs:check` 會檢查。agent 的完整守則在 `AGENTS.md`。

- **技能**：分兩處，`content/dN-*.js` 的 `skills` 加索引物件（id 全站唯一），`content/body/dN-*.js` 加同一個 id 的內文（`points` / `checklist` / `refs`）；`refs` 只放確定存在的官方文件。寫完跑 `npm run validate:content`（索引與內文的 id 必須一一對應）。
- **深入內容**：見 `docs/CONTRIBUTING-lessons.md`（段落結構、語氣、可執行區塊的限制、新課的完整清單）；寫完跑 `npm run validate:content` 與 `npm run e2e:deep`。
- **實驗室**：見 `docs/CONTRIBUTING-labs.md`（合約、共用元件 API、驗證流程）。
- **程式題**：在 `content/exercises/<領域>.js` 加一筆：`kind` 為 `sql`（`setup` + `expect: { columns, rows, ordered }`，或 `expect.query` 指定驗證查詢）、`python` / `js`（`tests: [{ name, code }]`，測試碼與使用者程式碼在同一命名空間；JS 內建 `assert` / `assertEqual`）或 `config`（使用者的設定檔成為 `source` / `lines`，交給 JS 測試檢查）。寫完跑 `npm run e2e:verify` 確認解答通過、起始碼不通過。
- **選擇題**：見 `docs/CONTRIBUTING-quizzes.md`；寫完跑 `npm run validate:quizzes`。
- **設計情境**：見 `docs/CONTRIBUTING-scenarios.md`（內容格式、模擬器規則）；寫完跑 `npm run validate:scenarios`。

## 驗證

```bash
npm run validate                 # 技能索引與內文對應、深入內容、實作路線、題庫、情境結構
npm run test:unit                # 進度合併規則（兩台裝置、離線、取消完成）、複習頁的抽題與錯題紀錄
npm run docs:check               # README 與課綱的產生段落是否最新、每堂課是否排進課綱（npm run docs:sync 重新產生）
npm run check:links              # 延伸閱讀與深入內容裡的外部連結（需要連外網；Actions 的 Links workflow 每月跑一次）
npm run build && npm run preview # 另開終端跑下面的 e2e（需要 npx playwright install chromium）
npm run e2e:runtime              # Playground 的 Python / SQL / JS 能執行
npm run e2e:verify               # 每道程式題：解答通過、起始碼不通過
npm run e2e:deep                 # 深入內容的每個 run 區塊都能執行（ONLY=transactions 只驗指定的課）
npm run e2e:ui                   # 首頁路線圖（2／3／4／6 欄：站序、文字不重疊、線不穿過字）；練習題、選擇題、設計情境的 UI 流程；路由懶載入；實驗室動畫在捲出畫面 / 分頁隱藏時暫停
npm run e2e:labs                 # 81 個實驗室與情境模擬器：每個控制項都動過（Seg / Toggle / Slider / Stepper / 按鈕），無錯誤、畫面有反應、無溢出
npm run e2e:sweep                # 全站每個路由 × 亮/暗/手機：無錯誤、無橫向溢出
npm run e2e:mobile               # 390px 逐頁（每一課、情境、實驗室、題目、實作路線）：頁面不能橫向捲動、內容不能被裁切、不留需要左右滑的區塊
npm run e2e:cloud                # 登入同步（自己 build、起 Firebase Emulator 與 preview；需要 Java 11+）
```

只跑一個實驗室：`LAB=CacheLab npm run e2e:labs`；加 `SMOKE_MOBILE=1` 會在 390px 再跑一輪。

## 登入與同步（選配）

沒設定 Firebase 時站上不會出現登入按鈕，一切只存在瀏覽器。設定後右上角出現「登入」（Google 帳號），進度同步到 Firestore。

- **只在需要時載入**：Firebase SDK（約 55 kB gzip）是獨立 chunk，只有按「登入」、或這台裝置上次是登入狀態時才下載。
- **同步什麼**：`atlas-progress-v1` 整份：完成的技能、清單勾選、練習題 / 選擇題 / 決策題的狀態、決策題理由。程式草稿（`atlas-ex-*`、`atlas-playground-*`）不同步。
- **存在哪**：Firestore `users/{uid}`，形狀 `{ v: 1, progress, updatedAt }`。`firestore.rules` 只准本人讀寫，欄位形狀固定、`updatedAt` 必須是伺服器時間。文件裡不放姓名或 email。
- **怎麼合併**：每次同步是一個 transaction：讀雲端、與本機做三方合併、有差才寫回。base 是這台上次同步完成時的內容（`atlas-sync-base-v1`）：本機沒改的項目取雲端，本機改過的留本機；兩邊都改了，題目狀態取較好的，理由留本機。所以另一台「取消完成」會傳過來，離線時的取消也不會被加回來；兩台同時上傳時，後到的會拿到對方的版本重新合併。這台第一次登入某個帳號時沒有 base，等於聯集，兩邊都不丟。實作與測試：`src/progressData.js`、`scripts/test-progress.mjs`。
- **何時同步**：登入或開站還原登入、改動後 1.5 秒、切回分頁、恢復連線、帳號選單的「立即同步」。離線或失敗時保留「未上傳」標記（`atlas-sync-v1`），下次補上。
- **帳號選單**：同步狀態、登出（本機進度保留）、登出並清除這台裝置的進度（共用電腦用）、刪除雲端進度（其他仍登入的裝置下次同步時也會登出，各自的本機進度保留）。
- **登入方式**：`signInWithPopup`。不用 redirect，因為 Safari 與新版 Chrome 擋第三方儲存，`authDomain` 跟站台不同網域時 redirect 會失敗。手機瀏覽器（尤其 Safari）只放行「點擊後立刻開」的視窗，所以「登入」先打開一個說明面板、同時在背景載 SDK 並備好登入 iframe（`warmUp`），面板裡的「使用 Google 帳號登入」就緒才能按；按下時 `signInWithPopup` 到 `window.open` 之間沒有網路等待，視窗在同一個點擊裡開出來。

### 啟用步驟

1. [Firebase Console](https://console.firebase.google.com/) 建一個新專案（例如 `backend-atlas`，Google Analytics 可關）。
2. 專案設定 → 一般 → 新增「網頁」應用程式，記下 `firebaseConfig` 裡的 `apiKey`、`authDomain`、`projectId`、`appId`。
3. Authentication → 開始使用 → Sign-in method → 啟用 Google（填支援 email）。
4. Authentication → 設定 → 授權網域 → 新增 `yo02741.github.io`（`localhost`、`<專案 id>.web.app`、`<專案 id>.firebaseapp.com` 預設已在）。
5. Firestore Database → 建立資料庫（正式版模式，區域 `asia-east1`）→ 規則分頁貼上 `firestore.rules` 的內容 → 發布。或用 CLI：`npx firebase-tools deploy --only firestore:rules --project <專案 id>`。
6. repo 根目錄的 `.env.production`（已設定為 `backend-atlas` 專案；這些值本來就會出現在前端程式裡，資料安全靠規則）：
   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=<專案 id>.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=<專案 id>
   VITE_FIREBASE_APP_ID=...
   ```
   push 之後 CI 的 build 就會帶上登入。只想在本機試可以改放 `.env.local`（已 gitignore）。
7. （建議）Google Cloud Console → API 和服務 → 憑證 → 這把 Browser key 加上網站限制：`https://yo02741.github.io/*`、`https://<專案 id>.web.app/*`、`https://<專案 id>.firebaseapp.com/*`、`http://localhost:*`。

### 測試

`npm run e2e:cloud` 以 `--mode e2e` build（讀 `.env.e2e`，指向 Firebase Emulator 的 `demo-backend-atlas`，不連任何真實服務），用 `firebase-tools` 起 Auth 與 Firestore emulator，跑 `e2e/cloud-sync.mjs`：規則的越權與壞資料拒絕、兩台裝置首次合併、取消完成的傳遞、離線補傳、關分頁前的改動補傳、兩台同時編輯、登出 / 清除 / 刪除雲端、session 還原、沒登入不下載 SDK、手機版面。emulator build 的瀏覽器登入走假 id token（這個沙箱連不到 `apis.google.com`），真正的 Google 彈出視窗要在正式站上試。

## 部署

push 到 `main` 觸發 `.github/workflows/deploy.yml`：`npm ci` → 同步 README 與課綱的產生段落 → 校驗內容與題庫、進度合併單元測試 → build（有 `.env.production` 就帶上登入）→ 同一份產物部署到 GitHub Pages 與 Firebase Hosting。第一次需要在 repo Settings → Pages 把 Source 設為 GitHub Actions（workflow 也會嘗試自動啟用）。

`.github/workflows/docs-sync.yml` 在 push 後檢查 README 與課綱的產生段落，沒同步就自動補一個 commit（用 `GITHUB_TOKEN` 推送，不會再觸發部署）。

### Firebase Hosting

`firebase.json` 的 `hosting` 以 `dist/` 為根目錄（hash 路由，不需要 rewrite）；`/assets/**` 檔名帶 hash，快取一年；`/pyodide/**` 快取一天；`index.html` 不快取。`.firebaserc` 的預設專案是 `backend-atlas`。

workflow 的 `firebase-hosting` job 拿 Pages 那份 build 產物，用 `FirebaseExtended/action-hosting-deploy` 部署到 live。需要 repo secret `FIREBASE_SERVICE_ACCOUNT`，沒設定時這個 job 只印一行提示就結束：

1. Firebase 控制台 → 專案 `backend-atlas` → 左上齒輪「專案設定」→「服務帳戶」分頁 →「產生新的私密金鑰」，下載 JSON。
2. GitHub repo → Settings → Secrets and variables → Actions → New repository secret，名稱 `FIREBASE_SERVICE_ACCOUNT`，值貼上整份 JSON。下載的檔案貼完就刪掉。

這把是 Admin SDK 的金鑰，權限比部署需要的大（也能讀寫 Firestore、管理登入帳號）。想縮小權限的話，改到 [Google Cloud 控制台的服務帳戶頁](https://console.cloud.google.com/iam-admin/serviceaccounts?project=backend-atlas) 另建一個帳戶，只給 **Firebase Hosting 管理員**、**服務使用情形消費者**、**API 金鑰檢視者** 三個角色，再用它的 JSON 金鑰。workflow 只在 push 到 `main` 時執行，fork 來的 PR 拿不到這個 secret。

手動部署（本機有 Node）：`npm run build && npx firebase-tools deploy --only hosting`。

流量：整站約 32 MB，其中 Pyodide 約 13 MB、PGlite 約 17 MB，只有用到 Python / SQL 的頁面才下載。Firebase 免費的 Spark 方案 Hosting 傳輸量有每日上限（以 Firebase 定價頁為準），第一次跑 Python + SQL 的訪客一次就用掉約 30 MB；流量大時要改 Blaze 方案，或把 Pyodide 改從 CDN 載入。


# Backend Atlas — 看得見的後端基礎

看得見的後端基礎學習地圖。JOIN 用文氏圖動、索引用 B-tree 走、JWT 真的算簽章、Docker 的層一層層疊起來；練習題在瀏覽器裡真的執行（PostgreSQL、Python、JavaScript），不需要任何後端。

- **線上**：[backend-atlas.web.app](https://backend-atlas.web.app/)（Firebase Hosting）、[yo02741.github.io/Backend-Atlas](https://yo02741.github.io/Backend-Atlas/)（GitHub Pages），每次 push 到 `main` 兩邊同時更新
- **本機**：`npm install && npm run dev`（第一次會把 Pyodide 複製到 `public/pyodide/`）

| 內容 | 數量 |
|---|---|
| 領域 | 11（語言與工程實踐、HTTP 與 API、資料儲存、驗證與授權、資安、容器與部署、CI/CD、演算法與系統設計、DevOps 與基礎建設、AI 時代的開發與 Agent 安全、知識系統） |
| 技能（課） | 112，每課有重點卡（摘要、重點、自我檢核、官方文件）與**深入內容**（從一個具體問題開始 → 運作原理 → 實際程式 → 常見錯誤與錯誤訊息 → 動手；範例可一鍵在 Playground 執行） |
| 互動實驗室 | 29（SQL JOIN、B-tree 索引、交易交錯、JWT、OAuth、Device Code、Docker 層、nginx、網路排查、憑證鏈、K8s 滾動更新、錯誤預算、Tool Poisoning、RAG 切段、wiki 連結圖…） |
| 程式題 | 120（Python 68 / SQL 29 / config 13 / JS 10），含實作路線的 14 道驗收題；解答全部經真實執行環境驗證 |
| 選擇題 | 336（每課 3 題，含程式碼判讀與情境題） |
| 設計情境 | 25（API 設計 8、資料與身分 4、高流量 6、維運與基礎建設 4、AI 與 Agent 安全 3） |
| 實作路線 | 從零做完一個門診掛號後端：8 個階段，每階段有說明與在瀏覽器裡跑的驗收題 |
| 課綱 | `docs/CURRICULUM.md`：獨立盤點的技能樹、16 週課綱、第 17–22 週延伸週次、實作路線對照、驗收設計 |

## 內容總覽

以 Python 與 PostgreSQL 為主，MongoDB、Redis 作對照。

### 技能課程（11 領域、112 課）

每課有重點卡（摘要、範例技術、重點、自我檢核清單、官方文件連結）與深入內容。★ 表示附互動實驗室。

| 領域 | 課程 |
|---|---|
| 1. 語言與工程實踐 | Python 後端心智模型、電腦怎麼跑你的程式、資料表示（編碼、序列化、時間與金額）、uv 與專案管理★、同步／多執行緒與 async★、Web 框架與請求生命週期、專案分層與依賴注入、錯誤設計（錯誤碼與 Problem Details）、測試金字塔與 pytest、型別檢查／lint／格式化、日誌／錯誤處理與設定 |
| 2. 網路、HTTP 與 API 設計 | 一個 HTTP 請求的一生★、TCP/IP 與連線、REST API 設計★、分頁／篩選／版本與冪等鍵、外部呼叫韌性（timeout、重試、斷路器）、OpenAPI 與 API 契約、CORS／Cookie 與同源、HTTP 快取與條件請求、DNS／TLS 與憑證、HTTP/2 與 HTTP/3、即時通訊怎麼選（輪詢、SSE、WebSocket）、GraphQL／gRPC／WebSocket／Webhook |
| 3. 資料儲存 | SQL 基礎、JOIN 七兄弟★、資料建模與正規化、Schema 設計實戰、索引與查詢計畫★、全文檢索、交易／ACID 與隔離等級★、鎖與死結、子查詢／CTE／視窗函數、ORM 與 migration、資料庫維運、MongoDB 文件模型★、MongoDB 查詢／聚合／索引、Redis 與快取策略★、關聯式 vs 非關聯式怎麼選 |
| 4. 驗證與授權 | Session vs Token、JWT 解剖★、OAuth 2.0 與 OIDC★、RBAC 與 ABAC★、驗證授權落地（middleware、dependency）、帳號生命週期（註冊、驗證、重設密碼、鎖定）、API key／服務間驗證／MFA／SSO |
| 5. 資安 | OWASP Top 10、SQL 注入與相關攻擊★、密碼儲存（編碼、雜湊、加密）★、密碼學工具箱、XSS／CSRF 與安全標頭、輸入驗證與檔案上傳、秘密管理、日誌與稽核紀錄裡的個資、依賴與供應鏈安全 |
| 6. 容器與部署 | Linux 與 shell、Docker image／container／layer★、Python 專案的 Dockerfile、docker-compose 開發環境★、nginx 反向代理★、負載平衡、12-factor、應用伺服器與程序管理、物件儲存、雲端與主機基礎 |
| 7. CI/CD 與交付 | Git 工作流、CI 管線（lint、test、build）★、環境／secrets／artifact、部署策略與資料庫遷移、可觀測性（log、metrics、trace）、健康檢查、備份與事故處理 |
| 8. 演算法與系統設計 | Big-O★、後端常用資料結構、限流演算法★、LRU 與快取淘汰、並發問題（race condition、死結）、訊息佇列與背景工作、排程工作（cron、重複執行與遺漏）、擴展（無狀態、負載平衡、讀寫分離）、分散式基礎（CAP、一致性與時間）、系統設計思考框架 |
| 9. DevOps 與基礎建設 | DevOps 會議詞彙對照、網路通不通（DNS 到防火牆）★、HTTPS 憑證（要買哪種、怎麼續）★、硬體資源與容量規劃★、GitLab CI/CD 實戰、導入 Kubernetes 前要準備什麼★、地端／雲端還是混合雲、數據中台之前：資料治理、SLI／SLO 與錯誤預算★、事故處理與 postmortem、受監管環境的變更管理 |
| 10. AI 時代的開發與 Agent 安全 | ADR、垂直切片拆票、規範變成測試（AI 協作下的 TDD）、AI 改程式的品質閘門、Skill 與 MCP、多 agent 協作與工作區隔離、Device Code／PKCE／Client Credentials★、MCP 的授權、MCP Gateway、集中式身分閘道、CLI 與 Agent 的 token 存哪裡、金鑰的範圍與壽命、OWASP MCP Top 10、Tool Poisoning 與 rug pull★、credential 隔離與執行邊界、行為層的供應鏈管理 |
| 11. 知識系統：從 RAG 到 LLM Wiki | RAG 怎麼運作與限制★、LLM Wiki（模型維護的 markdown 知識庫）、知識圖譜（wikilink、反向連結、GraphRAG）★、RAG／LLM Wiki／知識圖譜怎麼選、原始資料下毒與間接提示注入 |

### 互動實驗室（29 個）

可以拖、切、點的小教具：JOIN 用文氏圖呈現、索引實際走一遍 B-tree、兩個交易交錯執行看各隔離等級讀到什麼、JWT 真的計算簽章、OAuth 與 Device Code 流程逐步播放、Docker 映像的層一層層疊上去、token bucket 限流即時跑。DevOps 有網路排查（在任一層製造故障看錯誤長怎樣）、憑證鏈驗證、容量估算、K8s 副本與滾動更新、錯誤預算燃燒；Agent 安全有 Tool Poisoning（介面上看到的描述 vs 模型讀到的描述）；知識系統有 RAG 切段與 wiki 連結圖。

### 設計情境（25 個）

每個情境有背景與限制、可操作的模擬器、幾種做法的優缺點、取捨表、換條件後重新選做法的決策題、落地程式碼。

- **API 設計（8）**：列表分頁、API 快取、付款的冪等與重試、限流放哪與用什麼當 key、三分鐘長任務匯出、使用者上傳檔案、商品搜尋與篩選、API 改版不弄壞客戶端
- **資料與身分（4）**：多租戶資料隔離、刪除使用者要留下什麼（軟刪除與稽核）、讀寫分離後「剛存的怎麼不見了」、SPA 加手機 App 的登入方案
- **高流量（6）**：從 100 到 10 萬 QPS、秒殺 1,000 人搶 100 件、削峰與背壓、資料庫撐不住（連線池、讀寫分離、分片）、快取雪崩與擊穿、一則貼文通知 10 萬個追蹤者
- **維運與基礎建設（4）**：地端、雲端還是混合、數據中台之前先治理什麼、含 schema 變更的週末上線、事故處理（各自救火、事故指揮、自動化優先）
- **AI 與 Agent 安全（3）**：Agent 怎麼接上內部工具（MCP Gateway）、CLI／Agent／服務的身分怎麼統一、從一個容器到正式資料庫（依 Zeabur 2026 年 8 月事件報告改寫的縱深防禦）

### 實作路線：從零做完一個門診掛號後端

`#/project`。資料表與約束 → 掛號規則寫成程式與測試 → REST 介面與狀態碼 → 登入與角色權限 → 同時搶最後一個號 → 快取與限流 → 打包與持續整合（Dockerfile、GitLab CI）→ 日誌、指標與追蹤。每階段一份說明，連回相關的課，驗收題在瀏覽器裡跑（SQL 約束、Python 規則與測試、Dockerfile 與 `.gitlab-ci.yml` 檢查）。

### 練習題

- **程式題 120 道**（Python 68、SQL 29、config 13、JavaScript 10）：在瀏覽器裡真的執行並跑測試——SQL 跑 PGlite、Python 跑 Pyodide、JS 跑 Web Worker；config 題（Dockerfile、compose、nginx、`.gitlab-ci.yml`、GitHub Actions）由 JS 檢查器逐條驗證。
- **選擇題 336 道**：每課 3 題，含程式碼判讀與情境題。

### 課綱（16 週 + 延伸 6 週）

| 週 | 主題 |
|---|---|
| 1–4 | Python 工程底盤、程式怎麼跑與資料表示、HTTP/REST 與 OpenAPI、錯誤設計、SQL 與資料建模、ORM 與 migration → 里程碑 M1 |
| 5–7 | 驗證、帳號生命週期、密碼儲存、JWT、RBAC/ABAC、OAuth/OIDC、XSS/CSRF、秘密與供應鏈、日誌裡的個資 |
| 8–10 | 索引與查詢計畫、交易與鎖、並發問題、快取、限流、佇列、排程、冪等、分頁、Webhook、即時通訊 → 里程碑 M2 |
| 11–13 | TCP 與 HTTP/2/3、Docker、Compose、nginx、負載平衡、CI/CD、部署策略、Linux 維運、TLS/DNS、雲端、物件儲存 |
| 14–16 | 可觀測性、資料庫維運與備份、演算法補強、擴展與壓測、分散式基礎、系統設計 → 里程碑 M3 |
| 17–19（延伸） | 網路排查、HTTPS 憑證、容量規劃、GitLab CI/CD、導入 K8s、地端與雲端、變更管理、資料治理、SLO、事故處理 |
| 20–22（延伸） | AI 時代的團隊開發、Agent 的身分授權與資安、從 RAG 到 LLM Wiki |

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
    roadmap.js       領域索引、學習路線 PATH、工作關鍵字 WORK_KEYWORDS、查詢 helper
    d1-language.js … d11-knowledge.js   每個領域一檔的「索引」：skills[] 各有 id / title / en / level / summary / example / keywords / lab（跟著主 chunk）
    body/d1-language.js … d11-knowledge.js   每個領域一檔的「內文」：以技能 id 為 key 的 points / checklist / refs（技能頁才懶載入，每領域一個 chunk）
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
  pages/           Home / Roadmap / Domain / Skill / Labs / Exercises / Playground / Curriculum / Scenarios / Project
  App.jsx          hash 路由與外殼；首頁以外的頁面 React.lazy 懶載入（CodeMirror、題庫、課綱各自成 chunk），換頁走 startTransition
  components/      MetroMap、HeroArt、bits、CodeEditor、ExerciseRunner、Quiz、Decisions、Output、Markdown、Account（登入按鈕與帳號選單）
  assess.js        一個技能的驗收狀態（程式題 + 選擇題）
  progress.js      localStorage 進度（useProgress），並提供同步層用的 getProgress / replaceProgress / onLocalChange
  progressData.js  進度的資料形狀、正規化、三方合併（純函式，Node 可測）
  cloud/           選配的登入同步：config.js（讀 VITE_FIREBASE_*）、sync.js（同步狀態機，主 chunk）、firebase.js（SDK，懶載入）
  styles.css       站台樣式與 design tokens
  harness.jsx      開發用：?lab=JwtLab 只渲染該實驗室
  verify.jsx       開發用：?verify=1 把每題解答與起始碼丟進真實執行環境評分；?verify=deep 執行深入內容的每個 run 區塊
docs/              CURRICULUM.md、PLAN-2026Q4.md、AUDIT.md、CONTRIBUTING-lessons.md、CONTRIBUTING-labs.md、CONTRIBUTING-quizzes.md、CONTRIBUTING-scenarios.md
scripts/           copy-pyodide.mjs、validate-content.mjs、validate-quizzes.mjs、validate-scenarios.mjs、test-progress.mjs
firestore.rules    雲端進度的存取規則（本人才能讀寫、文件形狀固定）；firebase.json 是 emulator 設定
.env.e2e           e2e 用的 Firebase 設定（指向 emulator 的 demo 專案）
e2e/               Playwright 腳本（見下）
```

## 路由

hash 路由：`#/`、`#/roadmap?kw=JWT`、`#/curriculum`、`#/domain/data`、`#/skill/sql-joins`、`#/labs`、`#/lab/SqlJoinLab`、`#/scenarios`、`#/scenario/pagination`、`#/exercises`、`#/exercise/sql-joins-1`、`#/project`、`#/project/concurrency`、`#/playground?lang=sql`（課程的「在 Playground 開啟」會帶 `&code=`）。

## 新增內容

- **技能**：分兩處——`content/dN-*.js` 的 `skills` 加索引物件（id 全站唯一），`content/body/dN-*.js` 加同一個 id 的內文（`points` / `checklist` / `refs`）；`refs` 只放確定存在的官方文件。寫完跑 `npm run validate:content`（索引與內文的 id 必須一一對應）。
- **深入內容**：見 `docs/CONTRIBUTING-lessons.md`（段落結構、語氣、可執行區塊的限制、新課的完整清單）；寫完跑 `npm run validate:content` 與 `npm run e2e:deep`。
- **實驗室**：見 `docs/CONTRIBUTING-labs.md`（合約、共用元件 API、驗證流程）。
- **程式題**：在 `content/exercises/<領域>.js` 加一筆：`kind` 為 `sql`（`setup` + `expect: { columns, rows, ordered }`，或 `expect.query` 指定驗證查詢）、`python` / `js`（`tests: [{ name, code }]`，測試碼與使用者程式碼在同一命名空間；JS 內建 `assert` / `assertEqual`）或 `config`（使用者的設定檔成為 `source` / `lines`，交給 JS 測試檢查）。寫完跑 `npm run e2e:verify` 確認解答通過、起始碼不通過。
- **選擇題**：見 `docs/CONTRIBUTING-quizzes.md`；寫完跑 `npm run validate:quizzes`。
- **設計情境**：見 `docs/CONTRIBUTING-scenarios.md`（內容格式、模擬器規則）；寫完跑 `npm run validate:scenarios`。

## 驗證

```bash
npm run validate                 # 技能索引與內文對應、深入內容、實作路線、題庫、情境結構
npm run test:unit                # 進度合併規則（兩台裝置、離線、取消完成）
npm run build && npm run preview # 另開終端跑下面的 e2e（需要 npx playwright install chromium）
npm run e2e:runtime              # Playground 的 Python / SQL / JS 真的能跑
npm run e2e:verify               # 每道程式題：解答通過、起始碼不通過
npm run e2e:deep                 # 深入內容的每個 run 區塊都能執行（ONLY=transactions 只驗指定的課）
npm run e2e:ui                   # 練習題、選擇題、設計情境的 UI 流程；路由懶載入；實驗室動畫在捲出畫面 / 分頁隱藏時暫停
npm run e2e:labs                 # 54 個實驗室與情境模擬器：每個控制項都動過（Seg / Toggle / Slider / Stepper / 按鈕），無錯誤、畫面有反應、無溢出
npm run e2e:sweep                # 全站每個路由 × 亮/暗/手機：無錯誤、無橫向溢出
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

push 到 `main` 觸發 `.github/workflows/deploy.yml`：`npm ci` → 校驗內容與題庫、進度合併單元測試 → build（有 `.env.production` 就帶上登入）→ 同一份產物部署到 GitHub Pages 與 Firebase Hosting。第一次需要在 repo Settings → Pages 把 Source 設為 GitHub Actions（workflow 也會嘗試自動啟用）。

### Firebase Hosting

`firebase.json` 的 `hosting` 以 `dist/` 為根目錄（hash 路由，不需要 rewrite）；`/assets/**` 檔名帶 hash，快取一年；`/pyodide/**` 快取一天；`index.html` 不快取。`.firebaserc` 的預設專案是 `backend-atlas`。

workflow 的 `firebase-hosting` job 拿 Pages 那份 build 產物，用 `FirebaseExtended/action-hosting-deploy` 部署到 live。需要 repo secret `FIREBASE_SERVICE_ACCOUNT`，沒設定時這個 job 只印一行提示就結束：

1. Firebase 控制台 → 專案 `backend-atlas` → 左上齒輪「專案設定」→「服務帳戶」分頁 →「產生新的私密金鑰」，下載 JSON。
2. GitHub repo → Settings → Secrets and variables → Actions → New repository secret，名稱 `FIREBASE_SERVICE_ACCOUNT`，值貼上整份 JSON。下載的檔案貼完就刪掉。

這把是 Admin SDK 的金鑰，權限比部署需要的大（也能讀寫 Firestore、管理登入帳號）。想縮小權限的話，改到 [Google Cloud 控制台的服務帳戶頁](https://console.cloud.google.com/iam-admin/serviceaccounts?project=backend-atlas) 另建一個帳戶，只給 **Firebase Hosting 管理員**、**服務使用情形消費者**、**API 金鑰檢視者** 三個角色，再用它的 JSON 金鑰。workflow 只在 push 到 `main` 時執行，fork 來的 PR 拿不到這個 secret。

手動部署（本機有 Node）：`npm run build && npx firebase-tools deploy --only hosting`。

流量：整站約 32 MB，其中 Pyodide 約 13 MB、PGlite 約 17 MB，只有用到 Python / SQL 的頁面才下載。Firebase 免費的 Spark 方案 Hosting 傳輸量有每日上限（以 Firebase 定價頁為準），第一次跑 Python + SQL 的訪客一次就用掉約 30 MB；流量大時要改 Blaze 方案，或把 Pyodide 改從 CDN 載入。


# Backend Atlas — 看得見的後端基礎

看得見的後端基礎學習地圖。JOIN 用文氏圖動、索引用 B-tree 走、JWT 真的算簽章、Docker 的層一層層疊起來；練習題在瀏覽器裡真的執行（PostgreSQL、Python、JavaScript），不需要任何後端。

- **線上**：https://yo02741.github.io/Backend-Atlas/
- **本機**：`npm install && npm run dev`（第一次會把 Pyodide 複製到 `public/pyodide/`）

| 內容 | 數量 |
|---|---|
| 領域 | 8（語言與工程實踐、HTTP 與 API、資料儲存、驗證與授權、資安、容器與部署、CI/CD、演算法與系統設計） |
| 技能（課） | 63，每課有摘要、範例技術、重點、自我檢核、官方文件 |
| 互動實驗室 | 19（SQL JOIN、B-tree 索引、JWT、OAuth、RBAC/ABAC、SQL injection、Docker 層、compose 拓樸、nginx、CI 管線、Big-O、token bucket…） |
| 程式題 | 30（SQL 14 / Python 13 / JS 3），解答全部經真實執行環境驗證 |
| 選擇題 | 189（每課 3 題，含程式碼判讀與情境題） |
| 設計情境 | 18（API 設計 8、資料與身分 4、高流量 6）：情境與限制、模擬器、做法優缺點、取捨表、換條件的決策題、落地程式碼 |
| 課綱 | `docs/CURRICULUM.md`：獨立盤點的技能樹、差距分析、16 週課綱、驗收設計 |

## 執行環境（全部在瀏覽器）

| 語言 | 引擎 | 大小 |
|---|---|---|
| Python 3 | [Pyodide](https://pyodide.org/)（CPython → WASM），跑在 Web Worker；自架於 `public/pyodide/`（build 前由 `scripts/copy-pyodide.mjs` 從 node_modules 複製，已 gitignore） | 約 13 MB，首次載入後快取 |
| PostgreSQL | [PGlite](https://pglite.dev/)（Postgres → WASM，記憶體模式），Vite 打包成 assets | 約 16 MB |
| JavaScript | 原生，跑在 Web Worker（每次執行新開） | — |

- 逾時保護：Python 12 秒、JS 8 秒，超過就砍掉 worker 重開（沒有 SharedArrayBuffer 無法中斷 Python）。
- SQL 練習每次執行前重建 `public` schema 並套用該題的 setup；執行後自動 `ROLLBACK` 收掉沒 COMMIT 的交易。
- 編輯器：CodeMirror 6，主題全走 CSS token（亮暗自動）。
- 進度（完成、檢核、程式題、選擇題）只存在瀏覽器 localStorage。

## 結構

```
src/
  content/         內容（純資料，改這裡不用碰元件）
    roadmap.js       領域索引、學習路線 PATH、工作關鍵字 WORK_KEYWORDS、查詢 helper
    d1-language.js … d8-algo.js   每個領域一檔的「索引」：skills[] 各有 id / title / en / level / summary / example / keywords / lab（跟著主 chunk）
    body/d1-language.js … d8-algo.js   每個領域一檔的「內文」：以技能 id 為 key 的 points / checklist / refs（技能頁才懶載入，每領域一個 chunk）
    skillBody.js     內文的 Suspense 載入器（readSkillBody / preloadSkillBody）
    schemas.js       SQL 練習與 Playground 共用的電商範例資料庫
    exercises/       程式題（sql / python / js），index.js 匯總
    quizzes/         選擇題題庫，每領域一檔（extra.js 放跨領域補題），index.js 以 glob 自動收集
    scenarios/       設計情境，每個一檔，index.js 以 glob 自動收集（分組定義也在這）
  labs/            互動實驗室：ui.jsx（共用元件）、lab.css、index.js（登錄表）、*Lab.jsx
    scenarios/       情境模擬器 *ScenarioLab.jsx（index.js 懶載入）
  runtime/         py.js + py.worker.js（Pyodide）、sql.js（PGlite）、js.js + js.worker.js、check.js（評分）
  pages/           Home / Roadmap / Domain / Skill / Labs / Exercises / Playground / Curriculum / Scenarios
  App.jsx          hash 路由與外殼；首頁以外的頁面 React.lazy 懶載入（CodeMirror、題庫、課綱各自成 chunk），換頁走 startTransition
  components/      MetroMap、HeroArt、bits、CodeEditor、ExerciseRunner、Quiz、Decisions、Output、Markdown
  assess.js        一個技能的驗收狀態（程式題 + 選擇題）
  progress.js      localStorage 進度
  styles.css       站台樣式與 design tokens
  harness.jsx      開發用：?lab=JwtLab 只渲染該實驗室
  verify.jsx       開發用：?verify=1 把每題解答與起始碼丟進真實執行環境評分
docs/              CURRICULUM.md、AUDIT.md、CONTRIBUTING-labs.md、CONTRIBUTING-quizzes.md、CONTRIBUTING-scenarios.md
scripts/           copy-pyodide.mjs、validate-quizzes.mjs、validate-scenarios.mjs
e2e/               Playwright 腳本（見下）
```

## 路由

hash 路由：`#/`、`#/roadmap?kw=JWT`、`#/curriculum`、`#/domain/data`、`#/skill/sql-joins`、`#/labs`、`#/lab/SqlJoinLab`、`#/scenarios`、`#/scenario/pagination`、`#/exercises`、`#/exercise/sql-joins-1`、`#/playground?lang=sql`。

## 新增內容

- **技能**：分兩處——`content/dN-*.js` 的 `skills` 加索引物件（id 全站唯一），`content/body/dN-*.js` 加同一個 id 的內文（`points` / `checklist` / `refs`）；`refs` 只放確定存在的官方文件。寫完跑 `npm run validate:content`（索引與內文的 id 必須一一對應）。
- **實驗室**：見 `docs/CONTRIBUTING-labs.md`（合約、共用元件 API、驗證流程）。
- **程式題**：在 `content/exercises/<領域>.js` 加一筆：`kind` 為 `sql`（`setup` + `expect: { columns, rows, ordered }`，或 `expect.query` 指定驗證查詢）或 `python` / `js`（`tests: [{ name, code }]`，測試碼與使用者程式碼在同一命名空間；JS 內建 `assert` / `assertEqual`）。寫完跑 `npm run e2e:verify` 確認解答通過、起始碼不通過。
- **選擇題**：見 `docs/CONTRIBUTING-quizzes.md`；寫完跑 `npm run validate:quizzes`。
- **設計情境**：見 `docs/CONTRIBUTING-scenarios.md`（內容格式、模擬器規則）；寫完跑 `npm run validate:scenarios`。

## 驗證

```bash
npm run validate                 # 技能索引與內文對應、題庫、情境結構
npm run build && npm run preview # 另開終端跑下面的 e2e（需要 npx playwright install chromium）
npm run e2e:runtime              # Playground 的 Python / SQL / JS 真的能跑
npm run e2e:verify               # 每道程式題：解答通過、起始碼不通過
npm run e2e:ui                   # 練習題、選擇題、設計情境的 UI 流程；路由懶載入（首頁不載 CodeMirror、換頁不閃載入中）
npm run e2e:labs                 # 37 個實驗室：每個控制項都動過（Seg / Toggle / Slider / Stepper / 按鈕），無錯誤、畫面有反應、無溢出
npm run e2e:sweep                # 全站每個路由 × 亮/暗/手機：無錯誤、無橫向溢出
```

只跑一個實驗室：`LAB=CacheLab npm run e2e:labs`；加 `SMOKE_MOBILE=1` 會在 390px 再跑一輪。

## 部署

push 到 `main` 觸發 `.github/workflows/deploy.yml`：`npm ci` → 校驗題庫 → build → 上 GitHub Pages。第一次需要在 repo Settings → Pages 把 Source 設為 GitHub Actions（workflow 也會嘗試自動啟用）。

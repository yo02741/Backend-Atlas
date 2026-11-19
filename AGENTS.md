# u kinda should know：agent 守則

純靜態的學習網站，三條路線：前端、後端、AI（Vite + React 18，沒有自己的後端；選配的 Google 登入同步用 Firebase Auth + Firestore，沒設定時整段不出現）。內容與程式分離：**內容在 `src/content/`，互動實驗室在 `src/labs/`，執行環境在 `src/runtime/`**。細節見 `README.md`。push 到 `main` 就部署到 GitHub Pages 與 Firebase Hosting。

## 指令

```bash
npm ci                      # 安裝
npm run dev                 # 開發（第一次會把 Pyodide 複製到 public/pyodide/）
npm run docs:sync           # 重新產生 README 與課綱的產生段落
npm run validate            # 技能索引與內文、深入內容、實作路線、題庫、情境結構
npm run test:unit           # 進度合併、複習頁抽題
npm run docs:check          # 產生段落是否最新、每堂課是否排進課綱
npm run build && npm run preview          # 另開終端跑 e2e
E2E_BASE=http://localhost:4173/ npm run e2e   # 全部 e2e（Playwright）
LAB=XxxLab npm run e2e:labs                  # 單一實驗室；加 SMOKE_MOBILE=1 再跑 390px
SHOTS=1 node e2e/ui-metro.mjs               # 各路線首頁的路線圖（手機與桌機），順便存截圖
ONLY=id1,id2 npm run e2e:deep                # 只驗某幾課的 run 區塊
npm run e2e:frame           # 前端沙箱 iframe 的自我測試
npm run check:links         # 外部連結（要連外網；CI 每月跑）
```

## 每次改完內容都要做（自動做，不必等人提醒）

1. **`npm run docs:sync`**：重新產生 `README.md` 與 `docs/CURRICULUM.md` 裡跟著內容變動的段落：統計數字、學習路線表、課程表、實驗室與情境清單、練習題數量、K8s 專題路線、課綱技能樹。README 裡 `<!-- sync:名稱 -->` 包住的段落不要手改；要改格式就改 `scripts/sync-docs.mjs`。
2. **新課排進課綱**：在該路線的課綱檔（`tracks.js` 的 `curriculum`：後端與 AI 是 `docs/CURRICULUM.md`，前端是 `docs/CURRICULUM-frontend.md`）某一週的「對應技能」加上 `` `id` ``，否則 `docs:check` 會失敗。Docker 或 Kubernetes 相關的課，也評估要不要加進 `CURRICULUM.md` 第四節的 K 週。
3. **學習路線**：新課值得放進路線首頁的路線圖時，在 `src/content/roadmap.js` 的 `PATHS.<路線>` 加一站（`label` 是地圖上的短站名，`note` 是一句內容；站一定要是同一條路線的課）；README 的路線表由 `docs:sync` 產生。改了 `PATHS` 或 `src/components/MetroMap.jsx` 之後，**一定要確認手機與桌機的路線圖**：跑 `node e2e/ui-metro.mjs`（每條有站的路線 × 2、3、4、6 欄 × 亮暗：站數與站序、文字不重疊不超出、線不穿過字、頁面不用左右滑），再加 `SHOTS=1` 產生 `e2e/shots/metro-<路線>-<寬度>.png`，實際看改到的路線的 390 與 1280 兩張。站名太長會折成兩行或截斷，`label` 盡量 8 個字以內。
4. **會過期的內容**（版本、產品、法規）：索引加 `reviewed: 'YYYY-MM'`，課頁會顯示「內容核對」年月。
5. **手寫的 README 段落**（新增內容、結構、驗證、部署）跟著程式改動更新。
6. **大範圍的工作**記在 `docs/PLAN-2026Q4.md`（起因、分批、完成後的狀態）。

CI 的 `docs-sync` workflow 會補上忘記同步的 commit，部署前也會先同步；但 commit 前自己跑，不要依賴 CI。

## 路線

- 路線定義在 `src/content/tracks.js`（`TRACKS`：`id`、名稱、`color`、`tagline`、`lede`、`curriculum`、`featuredLabs`、`mapRequired`；`SITE` 是站名與 repo 網址）。順序就是首頁卡片與導覽列分頁的順序。
- 每個領域檔 `src/content/dN-<id>.js` 有 `track`。`no` 全站唯一、只決定檔名（後端 1–9、AI 10–11、前端 21–29；新的 AI 素養領域從 41 起），畫面上的編號一律用 `displayNo(d)`（路線內的順序）。路線內的領域順序就是 `roadmap.js` 的 `ALL_DOMAINS` 順序。
- id 全站唯一：領域、技能、實驗室、情境、情境分組、程式題。路由與進度的 key 不帶路線。
- 跨路線的相關課用技能索引的 `related: ['課 id']`（只放其他路線的課，validate 會擋同路線與不存在的 id）；反向連結由 `relatedOf()` 自動算，課頁列在「其他路線的相關課」。
- 情境分組（`src/content/scenarios/index.js` 的 `SCENARIO_GROUPS`）有 `track`；寫成 `{ id, title, en, track, … }`，`id` 與 `title` 維持在最前面（`docs:sync` 靠它解析）。
- 列表頁（技能盤點、實驗室、練習題、設計情境、複習、課綱）用 `?track=` 篩選，元件是 `src/components/TrackFilter.jsx`；目前的路線由 `src/track.js` 從路由推出。
- 還沒有課的領域留在 `ALL_DOMAINS`（`skills: []`），路線首頁列成「規劃中」。
- 版面與流程的改動：首頁 → 路線首頁 → 領域 → 課的層級不變；導覽列在 390px 只留標誌、三個路線分頁與右側按鈕，其他連結在選單裡（1100px 以下收進選單）。改了就跑 `npm run e2e:mobile` 與 `e2e:ui`。

## 教學方式：地圖層

每課的基底是「地圖」：叫得出名字（名詞與一句說明）、說得出要求（描述需求要講清楚的事，附一段描述範例）、驗得出對錯（怎麼檢查產出）。不鉅細靡遺講細節，讓讀者用 AI 寫程式時能具體描述想法並驗收結果；深入內容是選讀。新課一定要有 `map`（前端路線 `mapRequired`，validate 直接擋），改舊課時順手補上。格式與寫法見 `docs/CONTRIBUTING-lessons.md` 的「地圖層」。

## 寫作

- 規則以 `.claude/skills/atlas-writing/SKILL.md` 為準，搭配 `.claude/skills/stop-slop/`。
- 繁體中文（台灣用語），技術名詞保留英文。直接、精簡。標題與元件直接說它是什麼、做什麼，不在旁邊加操作說明。
- 不寫「為什麼要學」之類的動機段落；不用預設讀者背景或對話脈絡的措辭（例如「給前端工程師」「你工作上常聽到」「你已經會…」）。
- **正確優先**：不確定就查官方文件或明說不確定；版本相關的事實標出版本；不捏造連結、CVE、法規條文或價格。`refs` 只放確定存在的官方網址。
- 例子用虛構的醫院與資料（網域用 `example` 系列），不寫真實個資、院內主機名稱或位址。

## 改內容時

- **技能**：索引在 `src/content/dN-*.js`（列表與卡片用的欄位，領域要有 `track`），內文在 `src/content/body/dN-*.js` 或 `body/parts/`（`points` / `checklist` / `refs`，以技能 id 為 key，技能頁才懶載入），深入內容在 `src/content/deep/<id>.md`（格式見 `docs/CONTRIBUTING-lessons.md`）。id 全站唯一，`lab` 對應 `src/labs/index.js` 的 key。`roadmap.js` 與 `dN-*.js` 要能被 Node 直接 import（校驗與 `docs:sync` 用），不放 `import.meta.glob`。**改完必跑** `npm run validate:content`，有 run 區塊再跑 `npm run e2e:deep`。
- **程式題**：`src/content/exercises/`；**改完必跑** `npm run e2e:verify`（解答必須通過、起始碼應該不通過）。html、css、vue 題在沙箱 iframe 評分，每題要在 10 秒內評完；`ONLY=` 一樣可用。改了 `src/runtime/frame*`、`fakeApi.js`、`loopGuard.js` 必跑 `npm run test:unit` 與 `npm run e2e:frame`。
- **選擇題**：`src/content/quizzes/`，格式見 `docs/CONTRIBUTING-quizzes.md`；**改完必跑** `npm run validate:quizzes`。
- **實驗室**：照 `docs/CONTRIBUTING-labs.md`；`src/labs/index.js` 的 `LAB_META` 每筆寫成一行 `{ title, blurb, skill }`（`docs:sync` 靠這個格式解析）；用 `?lab=XxxLab` 單獨預覽；**改完必跑** `LAB=XxxLab npm run e2e:labs`（改 `src/labs/ui.jsx` 則跑全部）。
- **設計情境**：`src/content/scenarios/` + `src/labs/scenarios/`，照 `docs/CONTRIBUTING-scenarios.md`；**改完必跑** `npm run validate:scenarios`。

## 程式與樣式

- **顏色只用 CSS token**（`var(--c-*)`、`var(--ink-*)`…），不寫死 hex；亮暗主題、390px 手機都要檢查（`npm run e2e:mobile`）。
- 不新增 npm 依賴，除非有明確理由（目前：react、codemirror、pglite、pyodide、firebase、兩個 @fontsource 字體、vue 3.5.45（精確版本，只把 dist 檔複製到 `public/vendor/` 給沙箱用，外殼不 import）；firebase 只在 `src/cloud/firebase.js` import，懶載入）。
- **視覺風格是貼紙風**：奶油底、黑框（`--line`、`--bw`）、位移陰影（`--shade`）、平塗色（`--st-*`，色塊上的字用 `--on-sticker`）。新元件沿用這些 token，不加漸層、模糊、發光。
- **字體**：標題用 `--serif`（Bricolage Grotesque 800＋昭源甜圓體 800），內文用 `--sans`（系統字）。字體檔自架：`src/fonts.css` 由 `npm run fonts:gen`（`scripts/gen-fonts.mjs`）從 @fontsource 產生，只帶 woff2，不要手改；要加字重或字體就改那支腳本。標誌是 `src/components/BrandMark.jsx` 與 `public/favicon.svg`（貼紙底上的紅色打勾），兩者要一致。

## 改登入同步時

- 進度形狀或合併規則（`src/progressData.js`）：**改完必跑** `npm run test:unit`；形狀變了要同步改 `firestore.rules`，並提醒擁有者到 Firebase Console 重新發布規則。
- 同步流程、帳號 UI、規則：**改完必跑** `npm run e2e:cloud`（需要 Java 11+）。
- Firebase SDK 只准出現在 `src/cloud/firebase.js`；主 chunk 不能含 SDK（`npm run e2e:ui` 的路由測試會檢查首頁沒下載 `firebase-*.js`）。

## 參考專案 `companion/clinic-api/`

獨立的 Python 專案（uv、FastAPI），有自己的 README、測試與 CI（`.github/workflows/companion.yml`：pytest、compose smoke、kind 叢集部署）。改 `k8s/` 後至少跑 `kubectl kustomize k8s/overlays/kind` 與 `kubectl kustomize k8s/overlays/production`；搬動或改名檔案時，同步更新引用它的課文與 `docs/local-k8s.md`。

## 交付前

`npm run docs:sync` → `npm run validate` → `npm run test:unit` → `npm run docs:check` → `npm run build` → `npm run preview`（另一終端）→ `npm run e2e`。全綠再 commit；不 commit 秘密（Firebase 服務帳戶金鑰只放在 GitHub secret）。

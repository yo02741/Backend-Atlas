# Backend Atlas — agent 守則

純靜態的後端學習網站（Vite + React 18，無後端）。內容與程式分離：**內容在 `src/content/`，互動實驗室在 `src/labs/`，執行環境在 `src/runtime/`**。細節見 `README.md`。

## 原則

- **正確優先**：技術內容不確定就查官方文件或明說不確定；不捏造連結（`refs` 只放確定存在的官方網址）。
- **顏色只用 CSS token**（`var(--c-*)`、`var(--ink-*)`…），不寫死 hex；亮暗主題、390px 手機都要檢查。
- **繁體中文（台灣用語）**，技術名詞保留英文。
- **語氣**：直接、精簡、講事實。課程頁不寫「為什麼要學」之類的動機段落（那些留在 `docs/` 的課綱裡）；不用預設特定讀者背景或對話脈絡的措辭（例如「給前端工程師」「你工作上常聽到」「你已經會…」）。
- 不新增 npm 依賴，除非有明確理由（目前：react、codemirror、pglite、pyodide）。

## 改內容時

- 技能：索引在 `src/content/dN-*.js`（列表與卡片用的欄位），內文在 `src/content/body/dN-*.js`（`points` / `checklist` / `refs`，以技能 id 為 key，技能頁才懶載入）；id 全站唯一，`lab` 對應 `src/labs/index.js` 的 key。**改完必跑** `npm run validate:content`。`roadmap.js` 與 `dN-*.js` 要能被 Node 直接 import（校驗腳本用），不放 `import.meta.glob`。
- 程式題：`src/content/exercises/`；**改完必跑** `npm run build && npm run preview` + `npm run e2e:verify`（解答必須通過、起始碼應該不通過）。
- 選擇題：`src/content/quizzes/`；**改完必跑** `npm run validate:quizzes`。
- 實驗室：照 `docs/CONTRIBUTING-labs.md` 的合約；用 `?lab=XxxLab` 單獨預覽；**改完必跑** `LAB=XxxLab npm run e2e:labs`（改 `src/labs/ui.jsx` 則跑全部 `npm run e2e:labs`）。
- 設計情境：`src/content/scenarios/` + `src/labs/scenarios/`，照 `docs/CONTRIBUTING-scenarios.md`；**改完必跑** `npm run validate:scenarios`。

## 交付前

`npm run validate` → `npm run build` → `npm run preview`（另一終端）→ `npm run e2e`。全綠再 commit。

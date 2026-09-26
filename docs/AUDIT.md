# 內容盤點紀錄（2026-09-25）

> 這是課綱撰寫時對本站當時內容（8 領域 / 59 技能）的對照紀錄：缺少什麼、順序建議、準確性疑慮。文中指出的問題已陸續修正（含新增 4 個技能）；保留作為後續修訂的依據。

## 前提與來源

- 現有內容：`src/content/roadmap.js`（12 站學習路線 `PATH`）與 `d1-language.js` … `d8-algo.js`（8 領域 / 59 技能）。已全部讀過，本文件不照抄其結構。
- 外部路線圖：`https://roadmap.sh/backend` 在本環境被網路代理封鎖，無法讀取。以下對照依據我對該路線圖（2025 年版）的既有認識：Internet / 語言 / 版本控制 / 關聯式與 NoSQL / API / 快取 / Web 安全 / 測試 / CI-CD / 架構模式 / 訊息代理 / 容器 / Web 伺服器 / 搜尋引擎 / 擴展與可觀測性。另參考 Google SRE Book（四個黃金訊號、SLO、postmortem）、OWASP Top 10 與 API Security Top 10、The Twelve-Factor App。有時效性的說法我會標「需查證」。
- 技術選型沿用學習者的工作棧：Python 3.12+、uv、FastAPI、SQLAlchemy 2.0 + Alembic、PostgreSQL 16+、MongoDB、Redis、Docker Compose、nginx、GitHub Actions 與 GitLab CI。概念可搬到其他語言與框架。
- 標記：**必學** = 沒有它無法獨立負責一個服務；**應會** = 上線後三個月內一定會碰到；**選修** = 視產品需求。「第 N 週」是建議進入的週次（見課綱第二節）。
- 官方文件只列這幾個網域：docs.python.org、docs.astral.sh、postgresql.org/docs、owasp.org、docs.docker.com、nginx.org、docs.github.com、docs.gitlab.com。其他工具請自行搜尋官方站。

---


## 與當時 8 領域 / 59 技能的差距分析

現有內容整體品質高：每個技能都有 why / points / checklist / refs，PATH 12 站的敘事對前端背景很友善。差距主要在三處：(1) 缺「維運與 Linux」「密碼學工具箱」「外部呼叫韌性」「帳號生命週期」等能不能獨立上線的關鍵技能；(2) PATH 完全略過語言與工具域，測試與 migration 出現太晚；(3) 幾處說法有誤或過時，見 2.4。

### 2.1 缺少的（現有沒有、或只在別的技能裡一句帶過）

| 我的技能 | 等級 | 現有狀況 | 為什麼要補 |
|---|---|---|---|
| F1 Linux 與 shell 基礎 | 必學 | 完全沒有 | 上線後第一個問題永遠是「ssh 進去看 port / log / 磁碟」，沒有這個無法獨立負責服務。 |
| E3 密碼學工具箱 | 必學 | 只有 `password-storage` 講雜湊 | JWT 簽章、webhook HMAC、TLS、`secrets` 隨機數都靠同一組概念，分散學會各懂一半。 |
| H4 呼叫外部服務的韌性 | 必學 | 散在 `process-servers`（超時）與 `reliability`（斷路器）各一句 | 沒有 timeout 的外部呼叫是 API 卡死的第一名原因，值得獨立一週動手做。 |
| C11 資料庫維運基礎 | 必學 | `db-choice` / `reliability` 提到「備份要演練」但無動手 | 能獨立上線就要能 `pg_dump` / `pg_restore`、看慢查詢 log、知道 autovacuum 在幹嘛。 |
| D2 帳號生命週期 | 必學 | 無 | 重設密碼 token、防帳號枚舉、登入鎖定是最常寫錯的 auth 流程，比 SAML 重要得多。 |
| E1 的 API Security Top 10 / B4 `response_model` | 必學 | API Top 10 只列為 alt；mass assignment / excessive data exposure 未提 | 對寫 API 的人，BOLA / BOPLA 比 Web XSS 更貼身；`response_model` 是 FastAPI 一行就能擋的漏洞。 |
| H1 效能量測與壓測 | 必學 | `scaling` 提到 k6 一句 | 沒有量測就沒有優化；k6 在第 9 週就該進來，不該等到擴展章節。 |
| A2 專案結構與模組 | 必學 | 無 | 循環 import、src layout、`python -m` 是轉職者每天卡住的地方。 |
| A9 除錯與剖析 | 應會 | 無 | 讀 traceback、`breakpoint()`、`py-spy` 是後端沒有 devtools 之後的替代品。 |
| A8 時間、金額、ID 與序列化 | 應會 | 散在 `python-backend`、`sql-basics`、`data-modeling` | 值得集中成一個「資料表示」技能，附一張型別對照表。 |
| B11 網路基礎（TCP/UDP、port、NAT、Docker 網路） | 應會 | `compose` 提服務名 DNS 一句 | 「為什麼容器裡 localhost 連不到 DB」是新手必踩的坑。 |
| C9 PostgreSQL 特色功能（JSONB、partial index、FTS） | 應會 | `db-choice` 提 JSONB 一句 | 選 PostgreSQL 當預設的理由就是這些能力，學了才知道什麼時候不用 Mongo。 |
| F9 物件儲存與 presigned URL | 應會 | `cloud-basics` 一句 | 檔案上傳流程（E6）少了它做不完整。 |
| H6 排程任務 | 應會 | 無 | 每個服務都有排程，多實例只跑一次是常見事故。 |
| D8 稽核日誌 | 應會 | 無 | RBAC 落地後客戶第一個問的是「誰改了這筆」。 |
| I3 基礎演算法練習 | 應會 | d8 只講概念，無題目 | 至少一組 12 題讓「直覺」有地方驗證。 |
| I7 設計文件與 ADR | 應會 | 無 | 「獨立負責」包含把設計講給人聽並留下決策紀錄。 |
| C16 多租戶 / RLS、E9 威脅建模、G7 feature flag | 選修 | 無或一句 | 視產品需求，列出讓學習者知道有這條路。 |

### 2.2 多餘或可降級的

| 現有技能 id | 建議 | 一句話理由 |
|---|---|---|
| `lru-cache`（d8） | 併入 `redis-cache` / `data-structures`，OrderedDict 實作降為選修練習 | 單獨成技能太薄，實務上只需知道 `maxmemory-policy` 與 `lru_cache` 限制。 |
| `db-choice`（d3） | 降選修，併入系統設計一節；CAP 敘述改為「實務解讀」 | 教科書式 CAP 容易誤導（單機 PG 也會分割）；選型是設計會議的產物不是獨立技能。 |
| `beyond-rest`（d2） | 拆開：Webhook 升應會獨立成技能；GraphQL / gRPC / WebSocket 留選修 | Webhook 是他工作上真的會實作的東西，不該和 gRPC 綁在 level 3。 |
| `api-keys-mfa`（d4） | 拆開：API key / client credentials 應會；MFA / SSO 選修 | 機器身分是服務對服務必備；SAML 對這位學習者近期用不到。 |
| `cloud-basics`（d6） | 拆開：受管 DB / 物件儲存升應會；Kubernetes / serverless 留選修 | 「DB 不要自己裝在 VM」是上線前必須知道的，其他是選項。 |
| `scaling`（d8）的分片 | 分片降選修，其餘（無狀態、LB、讀寫分離）保留應會 | 分片是最後手段，16 週內不會做到。 |
| `git-workflow`（d7） | 不佔週次，改為 30 分鐘複習清單 + `bisect` / `reflog` | 前端 5 年應已熟 PR / rebase；把時間留給後端特有的東西。 |
| `data-structures`（d8）的 B-tree / 圖理論 | 精簡到「認得出來、選得對」 | 目標是後端直覺不是資結課；B-tree 細節在 `indexes` 已足夠。 |
| `logging-config`、`config-12factor`、`secrets`、`environments-secrets` 的環境變數 / secret 重複 | 合併為一條「設定與秘密：本機 / CI / 正式」主線，其餘互相引用 | 四處各講一遍會讓學習者以為是四件事。 |
| `orm-migrations` 的 expand / contract | 只在 `cd-strategies` 深講，`orm-migrations` 引用 | 同一件事講兩次，且脈絡在部署那邊才完整。 |
| `http-caching`（d2） | 保留但延後、標應會 | 對個人化 API 服務多半是 `private, no-cache`；ETag 是加分不是基礎。 |
| `system-design`（d8） | 保留，但 refs 移除 roadmap.sh 的連結、改為自家六步驟 | 對外連結不是官方文件，且路線圖與六步驟框架不是同一件事。 |

### 2.3 順序建議

| 現有技能 id | 現況 | 建議 | 理由 |
|---|---|---|---|
| `testing` | level 2、不在 PATH | 提前到第 2 週 | 他正在改工作上的 API，沒有測試的重構是賭博；測試也是後端的「眼睛」。 |
| `python-backend`、`uv-packaging`、`code-quality`、`web-framework` | PATH 完全略過 | 全部進第 1 週 | 這四個是他每天在用的東西，立刻能改善工作專案，也是後續作業的地基。 |
| `docker-basics`、`compose` | PATH 第 11 站 | 第 1 週先「會用」（起 PostgreSQL / Redis），第 11 週再「懂層與網路」 | 沒有 compose 起真資料庫，第 2–4 週的測試與 SQL 作業做不了。 |
| `orm-migrations` | level 2、不在 PATH | 緊接 `data-modeling` 之後（第 4 週） | 里程碑 1 需要 migration；schema 建模與 migration 是同一件事的兩面。 |
| `openapi` | level 2 | 提前到第 2 週 | 前端背景的人用規格產 TypeScript client 會立刻有感，也是契約思維的入口。 |
| `injection`、`input-validation`、`password-storage` | PATH 把 `injection` 放在 RBAC 之後 | 與 `authn-basics` 同週（第 5 週） | 寫登入就會寫查詢與存密碼，三者一起學才不會先寫錯再修。 |
| `python-async` | level 2、無明確位置 | 延後到第 9 週 | 先懂阻塞 I/O、DB 連線、測試，再學 async 才知道它在解什麼；太早學會寫出「在 async 裡呼叫同步 driver」。 |
| `logging-config` | level 2 | 提前到第 4 週（里程碑 1 之前） | 沒有結構化 log 與統一錯誤處理的服務不算可交付。 |
| `redis-cache` | 無明確位置 | 放在 `indexes` / `transactions` 之後（第 9 週） | 快取是效能的第二個答案；先索引再快取，順序反了會養成壞習慣。 |
| `oauth-oidc` | PATH 沒有 | 放在 `jwt` → `auth-in-practice` → `rbac-abac` 之後（第 7 週） | 先把自家登入做對，再接第三方；OAuth 依賴對 token 與 redirect 的理解。 |
| `http-caching`、`tls-dns` | level 2 | 延到第 11–13 週 | 兩者都在部署階段才有場景（nginx 終結 TLS、CDN）。 |
| `big-o` | level 1、d8 第一個 | 第 8 週配 `indexes` 的 EXPLAIN 一起學 | Seq Scan vs Index Scan 就是 O(n) vs O(log n) 最好的教材。 |
| `data-structures`、`system-design` | d8 | 留到第 15–16 週 | 是前面所有技能的組合題，放最後才有材料。 |

### 2.4 內容準確性疑慮

| 檔案 / 技能 id | 疑慮 | 建議修正 |
|---|---|---|
| `d1-language.js` / `uv-packaging` | 「`uv sync --frozen` 嚴格依 lock 安裝、lock 過期就失敗」——**描述的是 `--locked` 的行為**。`--frozen` 是「不檢查 lock 是否過期、不更新 lock，直接照 lock 裝」，lock 過期不會失敗。 | 改為：CI 用 `uv sync --locked`（lock 與 pyproject 不一致就失敗）；Docker 用 `--frozen`（不檢查、最快）。checklist 第 3 條同步修。 |
| `d5-security.js` / `owasp-top10` | 全篇用 2021 版編號（A05 設定錯誤 / A06 過時元件 / A10 SSRF）。OWASP Top 10:2025 已於 2025 年 11 月發布候選版：A02 安全設定錯誤上升、A03 軟體供應鏈失效（新）、A10 例外狀況處理不當（新）、SSRF 併入 A01。 | example.primary 標明「2021 版」，並加一段「2025 版的變動」；或直接改用 2025 版編號（正式版細節需查證 owasp.org）。 |
| `d6-deploy.js` / `nginx` | 「`=` 精確 > `^~` 前綴停止 > regex > 最長前綴」把 `^~` 說成全域高於 regex。實際演算法是：先找**最長**前綴匹配，若它是 `^~` 才跳過 regex；一個較短的 `^~ /a` 不會贏過較長的 `/a/b` 加 regex。 | 改寫為四步：最長前綴 → 若為 `=` / `^~` 停止 → 依序試 regex → 都沒中回最長前綴。checklist「四種修飾詞優先序」改為「能走一遍匹配演算法」。 |
| `d1-language.js` / `python-async` | 「CPython 同一時間只有一個執行緒在跑 Python bytecode」——Python 3.13 起有 free-threaded build（3.14 已非實驗性），敘述需限定「預設 build」。 | 加「（預設 build；free-threaded build 另計）」。結論（I/O 密集用 thread / async、CPU 密集用多程序）目前仍成立。 |
| `d4-auth.js` / `oauth-oidc` | 「真正的 token 由你的後端用 code 換」只對 confidential client / BFF 成立；SPA 走 PKCE 的 public client 是瀏覽器自己換 token。 | 分兩種部署講：有後端的用 client_secret（或 BFF）；純 SPA 用 PKCE 且 token 存記憶體。 |
| `d2-web.js` / `tls-dns` | 「Let's Encrypt 憑證 90 天」仍正確，但 CA/Browser Forum 已通過憑證壽命逐步縮短（2026-03 起上限 200 天、2027-03 起 100 天、2029 起 47 天；Let's Encrypt 亦提供 6 天短效憑證）。 | 補一句「憑證壽命正在縮短，自動續期從建議變必須」。確切日期需查證。 |
| `d6-deploy.js` / `compose` 與領域標題 | 「docker-compose」是 v1 的獨立二進位名稱（已停止維護）；現行是 `docker compose` 子命令、檔名 `compose.yaml`。 | 內文已用 v2 語法，術語統一為「Docker Compose / `docker compose`」，標題可保留學習者熟悉的寫法但加註。 |
| `d6-deploy.js` / `dockerfile-python` | `HEALTHCHECK` 在 Kubernetes 會被忽略（K8s 用 liveness / readiness probes），只有 Docker / Compose / Swarm 讀它。 | 加註，避免學習者以為寫了 HEALTHCHECK 就等於有探針。 |
| `d5-security.js` / `secrets` | 「build arg 傳 secret 會留在層裡」正確，但沒給正解。 | 補 `RUN --mount=type=secret,id=...`（BuildKit），secret 不進任何層。 |
| `d3-data.js` / `sql-basics` | 「WHERE 裡不能用 SELECT 的別名」正確；但 PostgreSQL 的 ORDER BY 與 GROUP BY 可以用輸出欄位別名（PG 擴充），學習者實驗時會困惑。 | 加一句 PostgreSQL 的例外。 |
| `d3-data.js` / `data-modeling` | UUIDv7 敘述正確，可補 PostgreSQL 18（2025-09）內建 `uuidv7()`，不必靠應用層產生。 | 補一句。 |
| `d7-cicd.js` / `ci-pipeline` | 對照表「`on:` ↔ `rules:`」不精確：GitLab pipeline 層級觸發是 `workflow:rules`，job 層級才是 `rules:`。 | 對照表改為 `on:` ↔ `workflow:rules`，`if:` ↔ job `rules:`。 |
| `d8-algo.js` / `data-structures` | 「Redis 的 sorted set 是跳躍表」——是跳躍表 + hash table 雙結構；「索引是 B-tree」——嚴格說是 B+tree（葉節點串連才能做範圍掃描）。 | 名詞精度問題，不影響結論；順手修。 |

---

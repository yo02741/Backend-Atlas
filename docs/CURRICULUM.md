# 後端工程師技能樹與 16 週課綱（獨立版本）

> 對象：前端 5 年（React / TypeScript 熟）、工作上正在寫 Python API、後端從未系統學過的工程師。
> 目標：16 週後能獨立負責一個 API 服務，從設計、實作、測試、上線到維運。
> 撰寫日期：2026-09-25。第一、三、四節獨立撰寫；第二節再與 `learn/src/content/` 現有內容對照。

## 0. 前提、來源與標記

- 現有內容：`learn/src/content/roadmap.js`（12 站學習路線 `PATH`）與 `d1-language.js` … `d8-algo.js`（8 領域 / 59 技能）。已全部讀過，本文件不照抄其結構。
- 外部路線圖：`https://roadmap.sh/backend` 在本環境被網路代理封鎖，無法讀取。以下對照依據我對該路線圖（2025 年版）的既有認識：Internet / 語言 / 版本控制 / 關聯式與 NoSQL / API / 快取 / Web 安全 / 測試 / CI-CD / 架構模式 / 訊息代理 / 容器 / Web 伺服器 / 搜尋引擎 / 擴展與可觀測性。另參考 Google SRE Book（四個黃金訊號、SLO、postmortem）、OWASP Top 10 與 API Security Top 10、The Twelve-Factor App。有時效性的說法我會標「需查證」。
- 技術選型沿用學習者的工作棧：Python 3.12+、uv、FastAPI、SQLAlchemy 2.0 + Alembic、PostgreSQL 16+、MongoDB、Redis、Docker Compose、nginx、GitHub Actions 與 GitLab CI。概念可搬到其他語言與框架。
- 標記：**必學** = 沒有它無法獨立負責一個服務；**應會** = 上線後三個月內一定會碰到；**選修** = 視產品需求。「第 N 週」是建議進入的週次（見第三節）。
- 官方文件只列這幾個網域：docs.python.org、docs.astral.sh、postgresql.org/docs、owasp.org、docs.docker.com、nginx.org、docs.github.com、docs.gitlab.com。其他工具請自行搜尋官方站。

---

## 一、技能樹（獨立版本）

共 9 個領域、89 個技能（必學 43 / 應會 35 / 選修 11）。每個技能下列子技能，是驗收時要能「做到」的顆粒度。

### 領域 A：Python 後端與工程實踐

為什麼重要：你有五年 TypeScript 的型別直覺與工程習慣，缺的只是把它搬到 Python 與伺服器端——專案怎麼長、依賴怎麼鎖、測試怎麼在沒有瀏覽器的地方跑。這一區是後面所有作業的地基，第 1–2 週就要建好，而且立刻能改善你手上的工作專案。

- **A1 Python 後端心智模型** — 必學 · 第 1 週
  - 型別提示當文件與防線：`int | None`、`list[str]`、`TypedDict`、`Protocol`；pyright 在存檔時就抓錯
  - 資料用 dataclass / pydantic v2 裝，不用 dict 到處傳：驗證、轉型、`model_dump`、`ConfigDict`
  - 例外設計：自訂例外階層、在最外層統一轉 HTTP；`raise ... from e` 保留因果
  - 語言陷阱：可變預設參數、閉包 late binding、`is` vs `==`、浮點誤差與 `Decimal`
  - 標準庫優先：`pathlib`、`datetime`（永遠帶時區）、`logging`、`secrets`、`functools`、`itertools`、`collections`
- **A2 專案結構與模組** — 必學 · 第 1 週
  - src layout、package 與 `__init__.py`、絕對 import、循環 import 的三種解法
  - `if __name__ == "__main__"`、`python -m`、console entry point
  - 分層目錄：`api/`、`services/`、`repositories/`、`schemas/`、`core/`
- **A3 uv 與依賴管理** — 必學 · 第 1 週
  - `pyproject.toml`（宣告要什麼）vs `uv.lock`（解析出什麼，含 hash，進版控）
  - `uv run`、`uv add --dev`、`[dependency-groups]`、`.python-version`
  - `uv sync --locked`（lock 與 pyproject 不一致就失敗，給 CI）vs `uv sync --frozen`（不檢查、不更新，照 lock 裝，給 Docker）
- **A4 程式品質工具** — 必學 · 第 1 週
  - ruff（lint + format + import 排序）、pyright / mypy 漸進嚴格、pre-commit
- **A5 Web 框架與請求生命週期** — 必學 · 第 1 週
  - ASGI server → middleware → 路由 → 依賴注入 → 驗證 → handler → 序列化 → middleware 收尾
  - `Depends` 抽出 DB session / 目前使用者；lifespan 建立與釋放連線池
  - router / service / repository 分層，handler 只剩「翻譯 HTTP」
- **A6 測試** — 必學 · 第 2 週
  - pytest fixture 就是依賴注入；`TestClient`；`parametrize`
  - 整合測試用真的 PostgreSQL（compose），每個測試在 transaction 內跑、結束 rollback；測資工廠
  - mock 邊界：mock 第三方（寄信、付款、外部 API），不 mock 自己的資料庫；coverage 門檻進 CI
- **A7 日誌、錯誤處理與設定** — 必學 · 第 4 週
  - JSON 結構化 log、`request_id` 貫穿每行與回應標頭
  - 三層錯誤：業務錯誤 4xx（不記 error）、驗證 422（附欄位）、未預期 500（記 stack trace、送告警、不回給客戶端）
  - pydantic-settings 讀環境變數，啟動即驗證缺值
- **A8 時間、金額、ID 與序列化** — 應會 · 第 3 週
  - UTC 儲存 + `TIMESTAMPTZ`，顯示時才轉時區；`Decimal` / `NUMERIC` 存金額
  - 自增 `BIGINT` vs UUIDv4 vs UUIDv7 的取捨；JSON 編碼 datetime / Decimal / UUID 的規則要在一處統一
- **A9 除錯與剖析** — 應會 · 第 9 週
  - 讀 traceback、`breakpoint()`、在容器內除錯、看 SQL echo；`cProfile` / `py-spy`；記憶體洩漏的線索
- **A10 並發模型：同步、執行緒、async** — 應會 · 第 9 週
  - I/O 等待 vs CPU 密集；GIL（預設 build）；event loop 與「一個阻塞呼叫卡死所有請求」
  - FastAPI `def` 走 threadpool、`async def` 跑在 loop；async driver（asyncpg、`httpx.AsyncClient`、motor）
  - `asyncio.TaskGroup`、`Semaphore` 限併發、`asyncio.to_thread` 包同步呼叫、超時與取消
- **A11 進階語言特性** — 選修
  - generator / context manager / decorator 的實作細節；typing generics、`ParamSpec`；`__slots__`

### 領域 B：網路、HTTP 與 API 設計

為什麼重要：你用了五年 HTTP，但都是「消費者」。現在換你決定狀態碼、標頭、錯誤格式與分頁方式；前端同事（也就是以前的你）用起來會不會罵，全看這一區。而且 FastAPI 自動產出的 OpenAPI 能直接變成 TypeScript client，這是你最快能「用得上」的地方。

- **B1 HTTP 請求的一生** — 必學 · 第 2 週
  - DNS → TCP → TLS → 請求 → 回應 → 快取；無狀態；keep-alive / HTTP/2 多工與連線池
  - 方法語意：安全 / 冪等；狀態碼分類與最常用的 12 個
  - 標頭家族：`Content-Type`、`Authorization`、`Cache-Control`、`Set-Cookie`、`Location`、`X-Forwarded-*`
- **B2 REST 資源設計與錯誤格式** — 必學 · 第 2 週
  - 資源樹、集合 vs 單一資源、非 CRUD 動作建模（子資源動作或狀態轉移）
  - 201 + `Location`、204、PUT vs PATCH；RFC 9457 problem+json 統一錯誤格式
- **B3 OpenAPI 契約** — 必學 · 第 2 週
  - FastAPI 自動產生；`response_model`、tags、examples；用規格產 TypeScript client
  - 規格 diff 進 CI，破壞性變更要顯式標記
- **B4 輸入驗證與回應模型** — 必學 · 第 2 週
  - 邊界一次驗完、白名單、長度與數量上限、request body 大小上限
  - `response_model` 過濾輸出（防 excessive data exposure）；禁止把整個 request body 直接寫進 DB（mass assignment）
- **B5 分頁、篩選、排序、版本** — 應會 · 第 10 週
  - offset vs cursor（keyset）分頁；篩選 / 排序欄位白名單；`/v1` 路徑版本；加欄位不算破壞
- **B6 冪等鍵與重試語意** — 應會 · 第 10 週
  - `Idempotency-Key`：存 key → 結果（含狀態碼與 body）、TTL、同 key 併發請求的處理
- **B7 CORS 與 Cookie** — 應會 · 第 6 週
  - preflight 來回、`Allow-Credentials: true` 不能配 `*`；`HttpOnly` / `Secure` / `SameSite`；CORS 不是授權機制
- **B8 Webhook 設計** — 應會 · 第 10 週
  - HMAC 簽章 + 時間戳防重放、重試與冪等、事件 id、對方回 2xx 才算成功
- **B9 HTTP 快取與條件請求** — 應會 · 第 11 週
  - `Cache-Control` 指令、`ETag` / `If-None-Match` → 304、`private` vs `public`、CDN 與靜態資產長快取
- **B10 DNS、TLS 與憑證** — 應會 · 第 13 週
  - A / AAAA / CNAME / TXT 與 TTL；TLS 1.3 握手；在 nginx 終結 TLS；ACME 自動續期與到期監控
- **B11 網路基礎** — 應會 · 第 11 週
  - TCP vs UDP、port、`ss -tlnp`、私有網段與 NAT、防火牆；Docker bridge 網路與服務名 DNS
- **B12 REST 之外** — 選修
  - SSE / WebSocket（伺服器推）、gRPC（服務間）、GraphQL（多端查詢；N+1 與查詢複雜度限制）

### 領域 C：資料儲存

為什麼重要：這是後端最難自學、也最保值的一塊，因為引擎的行為看不見。你工作上同時有 PostgreSQL 與 MongoDB，兩套心智模型都要有，還要知道什麼時候該用哪個。ORM 幫你寫 SQL，但效能問題與報表需求會逼你看懂它產生了什麼。

- **C1 SQL 基礎** — 必學 · 第 3 週
  - 邏輯執行順序（FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT）；PostgreSQL 允許 ORDER BY 用 SELECT 別名
  - NULL 三值邏輯：`IS NULL`、`NOT IN` 含 NULL 的陷阱、`IS DISTINCT FROM`
  - 型別選擇：`NUMERIC`、`TIMESTAMPTZ`、`BIGINT` / UUID、`TEXT` + CHECK 或 enum
- **C2 JOIN 與集合運算** — 必學 · 第 3 週
  - INNER / LEFT / FULL、anti-join（`NOT EXISTS`）、一對多造成列數膨脹與重複加總、ON vs WHERE 放條件的差別；UNION / EXCEPT
- **C3 資料建模、正規化與約束** — 必學 · 第 3 週
  - 1NF–3NF、PK / FK / UNIQUE / CHECK / NOT NULL、多對多中介表、快照欄位、有意識的反正規化
- **C4 ORM：SQLAlchemy 2.0** — 必學 · 第 4 週
  - `select()` 2.0 風格、relationship 與 eager loading（N+1 的解法）、一請求一 session、`echo=True` 看 SQL
- **C5 Migration：Alembic** — 必學 · 第 4 週
  - autogenerate 後人工審查、upgrade / downgrade、schema migration 與資料 migration / seed 分開、在部署前執行
- **C6 索引與查詢計畫** — 必學 · 第 8 週
  - B-tree、複合索引最左前綴、選擇性、表達式索引 / partial index、外鍵欄位要加索引
  - `EXPLAIN (ANALYZE, BUFFERS)`：Seq Scan / Index Scan / Nested Loop / Hash Join、估計 vs 實際列數
- **C7 交易、隔離等級與鎖** — 必學 · 第 8 週
  - ACID、READ COMMITTED（PG 預設）/ REPEATABLE READ / SERIALIZABLE、MVCC 與 VACUUM
  - 防超賣三招：原子 `UPDATE ... WHERE qty > 0`、`SELECT ... FOR UPDATE`、樂觀鎖 version 欄位；交易要短、不呼叫外部 API
- **C8 進階 SQL** — 應會 · 第 8 週
  - CTE（含遞迴）、視窗函數（`ROW_NUMBER`、`SUM OVER`）、`DISTINCT ON`、`LATERAL`、`EXISTS` vs `IN`
- **C9 PostgreSQL 特色功能** — 應會 · 第 8 週
  - JSONB 與 GIN 索引、陣列、enum、`generate_series` 造測資、全文檢索 `tsvector`、`uuidv7()`（PG 18 起內建）
- **C10 連線池與 driver** — 應會 · 第 13 週
  - psycopg 3 / asyncpg、pool size × worker 數 ≤ `max_connections`、`statement_timeout`、pgbouncer 何時需要
- **C11 資料庫維運基礎** — 必學 · 第 14 週
  - `pg_dump` / `pg_restore` 與還原演練、PITR 概念、autovacuum 為何重要、`log_min_duration_statement`、`pg_stat_statements`
- **C12 MongoDB 文件建模** — 應會 · 第 3 週
  - 嵌入三條件（被擁有、有上限、一起讀寫）、參照與 `$lookup`、單文件原子性、16MB 上限與無上限陣列、schema validation / ODM
- **C13 MongoDB 查詢、聚合與索引** — 應會 · 第 8 週
  - aggregation pipeline（`$match` 越早越好）、ESR 索引原則、`explain("executionStats")`、更新運算子、運算子注入
- **C14 Redis 資料型別** — 應會 · 第 9 週
  - string / hash / list / set / sorted set / stream；TTL；持久化選項與「這份資料掉了可以嗎」
- **C15 選型與多儲存體** — 選修 · 第 16 週
  - 預設 PostgreSQL（JSONB 兼顧半結構化）；文件式適用情境；一致性 vs 可用性的實務解讀；每多一種儲存體多一份備份與監控
- **C16 多租戶與資料隔離** — 選修
  - `tenant_id` 欄位 + 每查詢過濾、PostgreSQL Row-Level Security、schema-per-tenant 的取捨

### 領域 D：驗證與授權

為什麼重要：工作上聽到的 Token / JWT / OAuth / RBAC / ABAC 其實分屬四層——怎麼證明身分、怎麼把身分帶在請求裡、怎麼委託第三方、怎麼決定能做什麼。OWASP 把「存取控制失效」列第一名不是巧合：這是 API 最常見、也最容易在 code review 漏掉的漏洞。

- **D1 Session vs Token** — 必學 · 第 5 週
  - 伺服器端 session（Redis）+ HttpOnly cookie；Bearer token；撤銷能力的差異；攻擊面對照（cookie 防 CSRF、Bearer 防 XSS）
- **D2 帳號生命週期** — 必學 · 第 5 週
  - 註冊、登入、登出、重設密碼（一次性 token、短效、用後即廢）、Email 驗證
  - 登入失敗鎖定 / 限流、防帳號枚舉（統一錯誤訊息與回應時間）
- **D3 JWT** — 必學 · 第 6 週
  - 三段結構、簽章 ≠ 加密、`sub / iss / aud / exp / iat / nbf` 全部驗、伺服器指定允許的 `alg`、`kid` 與金鑰輪替
  - access 短效（≤ 15 分）+ refresh rotation（用一次換一次）、重用偵測
- **D4 Auth 落地** — 必學 · 第 6 週
  - `get_current_user` / `require_role()` 依賴工廠；401（不知道你是誰）vs 403（知道但不行）vs 404（不洩漏存在性）
  - 每個受保護端點三種身分測試：未登入、登入無權、有權
- **D5 授權模型：RBAC / ABAC / 擁有權** — 必學 · 第 6 週
  - 角色 → 權限矩陣；資源層擁有權與狀態檢查；預設拒絕、拒絕優先；授權放服務層而不只在路由
- **D6 OAuth 2.0 與 OIDC** — 應會 · 第 7 週
  - 四角色、授權碼 + PKCE + state；confidential client（後端換 token）vs public client（SPA 自己換）；id_token vs access_token；Client Credentials
- **D7 機器身分** — 應會 · 第 10 週
  - API key（只顯示一次、存雜湊、有 scope 與到期、可輪替）、服務對服務 client credentials、內網 mTLS 概念
- **D8 稽核日誌** — 應會 · 第 10 週
  - 誰、何時、對哪個資源、做了什麼、結果；append-only；保留期限；與應用 log 分開存
- **D9 MFA、passkey 與企業 SSO** — 選修
  - TOTP、WebAuthn / passkey、高風險操作 step-up；SAML / OIDC 當 Service Provider

### 領域 E：應用資安

為什麼重要：你聽到的 OWASP 是「攻擊者最常從哪裡進來」的統計；對寫 API 的人，OWASP API Security Top 10 更貼身。這一區的技能不是加功能，是每個端點的預設姿勢；學會的判準是「先親手打穿、再親手擋住」。

- **E1 OWASP Top 10 與 API Security Top 10** — 必學 · 第 5 週
  - Web Top 10：2021 版類別，以及 2025 版的變動（供應鏈失效、例外狀況處理不當新入榜；SSRF 併入存取控制）——版本要標清楚
  - API Top 10（2023）：BOLA、Broken Authentication、BOPLA、資源耗盡、BFLA、敏感商業流程、SSRF、設定錯誤、資產盤點、不安全消費第三方 API
  - 用清單對自己負責的 API 走一遍並列出風險
- **E2 注入** — 必學 · 第 5 週
  - SQL（參數化、ORM 逃生口 `text()`、動態欄名白名單）、NoSQL 運算子注入、OS 命令注入（`subprocess.run([...])` 不經 shell）、最小權限 DB 帳號
- **E3 密碼學工具箱** — 必學 · 第 5 週
  - 編碼 vs 雜湊 vs HMAC vs 對稱加密（AES-GCM）vs 非對稱（RSA / ECDSA）各解決什麼問題
  - `secrets` 模組產生密碼學安全隨機值、`hmac.compare_digest` 常數時間比較、「不要自己發明加密」
  - 對照表：密碼 → 慢雜湊；JWT → HMAC 或簽章；webhook → HMAC；TLS → 非對稱交換 + 對稱傳輸；靜態資料 → 對稱
- **E4 密碼儲存** — 必學 · 第 5 週
  - argon2id（或 bcrypt）、salt、work factor、函式庫的 hash / verify、為何「不加密」
- **E5 XSS、CSRF 與安全標頭** — 應會 · 第 7 週
  - API 回 JSON 的 `Content-Type`、CSP、`SameSite`、狀態改變不走 GET、HSTS / nosniff / frame-ancestors / Referrer-Policy
- **E6 檔案上傳與 SSRF** — 應會 · 第 7 週
  - 隨機檔名、magic bytes 而非副檔名、不放 web root、物件儲存；拿使用者 URL 去 fetch 要白名單並擋內網位址
- **E7 秘密管理** — 必學 · 第 7 週
  - `.env` 只在本機、`.env.example`、gitleaks 掃描；CI secrets；image 不含 secret（build 用 `--mount=type=secret`）；輪替與外洩處置順序
- **E8 依賴與供應鏈** — 應會 · 第 7 週
  - lock + hash、`pip-audit`、Dependabot / Renovate、image 掃描（Trivy）、第三方 Action 釘 SHA、最小 `permissions:`
- **E9 威脅建模與安全審查** — 選修 · 第 16 週
  - STRIDE 走一遍資料流圖、PR 的安全檢查清單、個資盤點（PII 欄位、保留期限、刪除）

### 領域 F：Linux、容器與部署

為什麼重要：「在我電腦可以跑」到「跑在機器上」中間隔著 Linux、容器與反向代理。你天天 `docker compose up` 卻不清楚層與網路怎麼運作，出事就只能重開。能獨立上線的人，一定能 ssh 進機器看 port、看 log、看磁碟。

- **F1 Linux 與 shell 基礎** — 必學 · 第 1 週（當工具）/ 第 13 週（當維運）
  - ssh 與金鑰、檔案權限、環境變數、`ps / top / ss / lsof / df / du / journalctl`、pipe 與 `grep / awk / jq`
  - systemd unit、signal（SIGTERM vs SIGKILL）、cron、時區與 NTP
- **F2 Docker：image / container / layer** — 必學 · 第 1 週（會用）/ 第 11 週（懂原理）
  - 層快取與指令順序、`.dockerignore`、容器無狀態、volume、log 寫 stdout、`docker image history`
- **F3 正式環境 Dockerfile** — 必學 · 第 11 週
  - 釘 base 版本、多階段、非 root、exec 形式 `CMD`、`HEALTHCHECK`（Kubernetes 不讀它，用 probes）、`PYTHONUNBUFFERED`、BuildKit cache mount
- **F4 Docker Compose** — 必學 · 第 1 週 / 第 11 週
  - 服務名 = DNS、`ports` vs `expose`、named volume、`healthcheck` + `depends_on.condition`、override 分環境；使用 `docker compose` v2 子命令與 `compose.yaml`
- **F5 nginx 反向代理** — 必學 · 第 11 週
  - location 匹配：先找最長前綴 → 若該前綴是 `=` 或 `^~` 就停 → 否則依序試 regex → 都沒中才回最長前綴
  - `proxy_set_header` 四件組（Host、X-Real-IP、X-Forwarded-For、X-Forwarded-Proto）、upstream 與負載平衡、`limit_req`、`client_max_body_size`、gzip、SPA `try_files`
- **F6 設定與 12-factor** — 必學 · 第 4 週
  - 一份 image 多環境、設定從環境變數、dev / prod 差異最小化、程序類型（web / worker / cron）分開
- **F7 應用伺服器與程序管理** — 必學 · 第 13 週
  - uvicorn / gunicorn worker 模型與數量、連線池上限、graceful shutdown、liveness vs readiness、超時要層層設
- **F8 雲端基礎** — 應會 · 第 13 週
  - VM vs 容器平台 vs serverless、受管資料庫、私有網路邊界、主要成本項；Kubernetes 不是起點
- **F9 物件儲存** — 應會 · 第 13 週
  - S3 相容 API、presigned URL 讓前端直傳、生命週期規則、公開 vs 私有 bucket
- **F10 Kubernetes 與 IaC 概念** — 選修
  - Pod / Deployment / Service / Ingress 對應 compose 概念；Terraform 宣告式思維

### 領域 G：CI/CD、可觀測性與可靠性

為什麼重要：你已經會用 GitHub Actions / GitLab CI 做前端 build，後端多了資料庫、image、migration 與「部署中新舊版並存」的問題。上線之後，log / metrics / trace 是你唯一的眼睛；備份還原則是唯一的保險——沒還原過的備份不算備份。

- **G1 Git 工作流（複習）** — 應會 · 第 12 週
  - trunk-based、保護 main、Conventional Commits、`bisect` / `reflog` / `cherry-pick` 救急
- **G2 CI 管線** — 必學 · 第 12 週
  - lint → 型別 → 測試（PostgreSQL service）→ build image（commit SHA 當 tag）→ 掃描 → 推 registry；快取 key 用 lock 檔 hash；GitHub ↔ GitLab 逐項對照
- **G3 環境、secrets 與 artifact** — 必學 · 第 12 週
  - environment 保護規則（prod 要人工核准、只接受 main）、同一 image 一路升級、artifact vs cache、部署可追溯
- **G4 部署策略與零停機 migration** — 應會 · 第 12 週
  - rolling / blue-green / canary；expand-contract（加欄 → 雙寫 → 回填 → 切讀 → 刪舊）；migration 與前後版程式碼相容；回滾要演練
- **G5 可觀測性** — 必學 · 第 14 週
  - 四個黃金訊號（延遲、流量、錯誤、飽和）、log（事件）vs metrics（聚合）vs trace（路徑）、OpenTelemetry 自動儀器化、錯誤追蹤工具、告警要可行動
- **G6 可靠性實務** — 應會 · 第 14 週
  - SLO、runbook、不咎責 postmortem、降級與斷路器、事故時誰指揮誰溝通
- **G7 Feature flag 與漸進發布** — 選修
  - 旗標與 canary 搭配、旗標到期清理

### 領域 H：並發、效能與非同步架構

為什麼重要：「資料量到十萬筆就爆」「第三方 API 慢就整站卡住」「寄信讓 API 超時」——這些不是 bug，是缺少效能與韌性的心智模型。順序是：先量測、再加索引、再快取、最後才非同步化與擴展。

- **H1 效能量測與壓測** — 必學 · 第 9 週
  - p50 / p95 / p99、k6 或 locust、找出第一個爆的元件（通常是 DB 連線或一條慢查詢）、每次優化都要有前後數字
- **H2 快取策略** — 應會 · 第 9 週
  - cache-aside、TTL 當安全網、寫入時「刪」不「更新」、穿透 / 雪崩 / 擊穿、命中率
  - 程序內 `lru_cache` 的限制（每 worker 一份、重啟即失）；LRU / LFU 淘汰與 Redis `maxmemory-policy`
- **H3 限流演算法** — 應會 · 第 9 週
  - token bucket、固定視窗的邊界問題、滑動視窗、key 選什麼（IP / user / API key）、429 + `Retry-After`；nginx 擋粗、應用層擋細、Redis 共享計數
- **H4 呼叫外部服務的韌性** — 必學 · 第 9 週
  - 每個呼叫都有 timeout（連線 / 讀取分開）、指數退避 + 抖動、只重試冪等操作、circuit breaker、bulkhead、降級路徑
- **H5 佇列與背景工作** — 必學 · 第 10 週
  - 生產者 / 佇列 / 消費者、API 回 202 + 狀態查詢、at-least-once ⇒ 消費者必須冪等、重試上限與死信、outbox 模式；Kafka 是事件日誌不是任務佇列
- **H6 排程任務** — 應會 · 第 10 週
  - cron / APScheduler / 平台排程、多實例只跑一次（分散式鎖或 leader）、可重跑、有「上次成功時間」監控
- **H7 擴展** — 應會 · 第 15 週
  - 無狀態 API 水平擴展、負載平衡、DB 先垂直 → 讀寫分離（read-your-writes）→ 分片是最後手段
- **H8 事件驅動與 saga** — 選修
  - 事件 schema 版本、消費者群組、補償交易；何時真的需要拆微服務

### 領域 I：演算法、資料結構與系統設計

為什麼重要：後端的演算法不是刷題，是「看到迴圈裡有 query 就響警報」的直覺，加上幾個真的會用到的結構（hash、deque、heap、B-tree、DAG）。系統設計則是前面所有技能的組合題，讓你在設計會議上從「感覺」變成「因為 X 所以 Y」。

- **I1 Big-O 直覺** — 必學 · 第 8 週（配 EXPLAIN 一起學）
  - 五種複雜度各一個後端例子、I/O 次數比 CPU 貴、N+1、list vs set 查找、小 n 時常數項會贏
- **I2 後端常用資料結構** — 應會 · 第 15 週
  - hash map / set、deque、heap（top-k、排程）、B-tree（矮而寬、磁碟友善）、trie、圖與拓樸排序
- **I3 基礎演算法練習** — 應會 · 第 15 週
  - 排序與二分搜尋、two-pointer、雜湊計數、BFS / DFS、拓樸排序、遞迴與 memoization；12 題為一組，每題說出複雜度
- **I4 分散式基礎概念** — 選修
  - 一致性雜湊、ID 生成（UUIDv7 / snowflake）、時鐘與事件順序、CAP 的實務解讀（PACELC）
- **I5 系統設計框架** — 應會 · 第 16 週
  - 需求 → 估算 → API → 資料模型 → 架構 → 瓶頸 → 取捨；短網址 / 通知系統 / 訂單系統三題練習
- **I6 架構模式** — 選修 · 第 16 週
  - 分層 / 六角、modular monolith vs 微服務、BFF、API gateway；「先單體、界線清楚」
- **I7 設計文件與 ADR** — 應會 · 第 16 週
  - 一頁設計文件模板、ADR（背景 / 決定 / 後果）、給非後端同事看的架構圖

---

## 二、與現有 8 領域 / 59 技能的差距分析

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

## 三、16 週課綱

- 每週預估 10–12 小時（平日 3 晚 × 2 小時 + 週末半天），16 週合計約 185 小時。
- 前 4 週的作業直接對準他工作上正在寫的 API：可以用工作專案的匿名化版本，或本課綱的範例「訂單服務」。
- 三個里程碑：第 4 週 M1「本機可跑、有測試、有契約」；第 10 週 M2「多使用者、資安硬化、非同步化、有 CI」；第 16 週 M3「上線、可觀測、有備份演練與設計文件」。
- 每週格式：主題 / 對應技能（我的編號 + 現有 id）/ 學習目標（能做到…）/ 動手作業 / 驗收標準 / 時數。

### 第 1 週｜Python 後端工程底盤：uv、專案結構、品質工具、FastAPI 生命週期

- **對應技能**：A1–A5、F1（工具層）、F2 / F4（會用即可）。現有：`python-backend`、`uv-packaging`、`code-quality`、`web-framework`、`compose`
- **學習目標**
  1. 能從零 `uv init` 一個 src layout 專案，加依賴、分 dev group、`uv run` 執行，並說明 `--locked` 與 `--frozen` 的差別
  2. 能用 pydantic v2 定義請求 / 回應模型，並讓 pyright 在 `basic` 模式零錯誤
  3. 能畫出一個請求從 uvicorn 到 handler 再回去的每一層，並指出驗證、錯誤攔截、log 各放哪層
  4. 能用 `docker compose up` 起一個 PostgreSQL 並從本機工具連上
- **動手作業**：把一個現有 API（工作專案匿名化版或範例）改成 uv + src layout；加 ruff / pyright / pre-commit；至少一個 endpoint 改用 pydantic 模型；寫 `compose.yaml` 起 PostgreSQL 16 + Redis；寫一份 `docs/request-lifecycle.md` 畫出請求路徑。
- **驗收標準**：`uv sync --locked` 成功；`uv run ruff check . && uv run ruff format --check . && uv run pyright` 全綠；`/docs` 顯示該 endpoint 的 schema；`psql` 連得上 compose 起的 DB；生命週期圖有 7 層以上且能口頭講 3 分鐘。
- **預估時數**：10 小時

### 第 2 週｜HTTP 與 REST 契約、OpenAPI、測試

- **對應技能**：A6、B1–B4。現有：`http-basics`、`rest-design`、`openapi`、`input-validation`（基本）、`testing`
- **學習目標**
  1. 能為常見情境挑對狀態碼（找不到 / 沒登入 / 沒權限 / 驗證失敗 / 衝突 / 伺服器錯），並解釋 PUT 冪等而 POST 不是
  2. 能為「訂單」設計 6 個 endpoint（方法、路徑、成功狀態碼、錯誤格式）並寫成 RFC 9457 統一錯誤
  3. 能用 pytest + `TestClient` 為每個 endpoint 寫「正常 / 驗證失敗 / 找不到」三類測試
  4. 能用 OpenAPI 規格產出 TypeScript client 並在一個 React 頁面呼叫
- **動手作業**：實作 `orders` 資源 6 個 endpoint（先用記憶體 dict 存）；全域例外處理器輸出 problem+json；每個欄位有長度 / 範圍限制、列表 `limit` 上限；`response_model` 不回敏感欄位；用 openapi-typescript 產 client 並寫一個最小 React 頁面。
- **驗收標準**：`curl -i` 示範 201 + `Location`、204、404、409、422 各一次；pytest ≥ 18 個測試全過；規格 JSON 存進 repo（`openapi.json`）；React 頁面能建立並列出訂單。
- **預估時數**：12 小時

### 第 3 週｜SQL 與資料建模（PostgreSQL 為主、MongoDB 對照）

- **對應技能**：A8、C1–C3、C12。現有：`sql-basics`、`sql-joins`、`data-modeling`、`mongodb`
- **學習目標**
  1. 能寫出 users / products / orders / order_items 的 DDL，含 PK / FK / UNIQUE / CHECK / NOT NULL，型別用 `NUMERIC` / `TIMESTAMPTZ` / `BIGINT`
  2. 能解釋 `WHERE status != 'paid'` 為何漏掉 NULL、`NOT IN` 含 NULL 為何整個變空
  3. 能不看文件寫出 LEFT JOIN 條件放 ON 與放 WHERE 的差別，並用兩種寫法找「從未下單的使用者」
  4. 能為同一領域寫出 MongoDB 文件設計，說明哪些嵌入、哪些參照及理由
- **動手作業**：DDL + `generate_series` 造 1 萬筆測資；完成 20 題 SQL（GROUP BY / HAVING、七種 JOIN、anti-join、NULL 陷阱、UNION / EXCEPT 各至少 2 題），每題附預期列數；寫 `docs/data-model.md` 含 ER 圖、3NF 檢查、快照欄位決定；MongoDB 版 schema + 一段 300 字比較。
- **驗收標準**：DDL 在乾淨 DB 一次執行成功；20 題結果與預期列數一致（提供標準答案比對）；比較文提到嵌入三條件與 `$lookup` 代價；能口頭說出訂單明細為何要存商品名稱與價格快照。
- **預估時數**：12 小時

### 第 4 週｜ORM、migration、日誌與設定 → 里程碑 M1

- **對應技能**：A7、C4、C5、F6。現有：`orm-migrations`、`logging-config`、`config-12factor`
- **學習目標**
  1. 能用 SQLAlchemy 2.0 `select()` 寫 CRUD，開 SQL echo 找出一個 N+1 並用 `selectinload` 修好
  2. 能用 Alembic 產生、人工審查、套用與回退一個 migration
  3. 能讓服務每行 log 都是 JSON 且帶 `request_id`，未預期例外回 500 但不洩漏 stack trace
  4. 能用 pydantic-settings 讀全部設定，缺值時啟動即失敗
- **動手作業**：把第 2 週的記憶體儲存換成 PostgreSQL；Alembic 初始化 + 2 個 migration（建表、加索引）；整合測試改用真 DB fixture（transaction + rollback）；JSON log middleware；`.env.example`；README 寫「10 分鐘跑起來」。
- **里程碑 M1 交付物「訂單 API v1」**：repo 含 `compose.yaml`、`uv.lock`、Alembic、≥ 25 個測試、`openapi.json`、README；`docker compose up` 後 `uv run alembic upgrade head && uv run pytest` 全綠；一份 5 分鐘 demo 影片或現場 demo。
- **驗收標準**：新同事照 README 10 分鐘內跑起來；SQL log 中列表 endpoint 的查詢數 ≤ 2；故意丟一個未預期例外，回應是 problem+json 500 且 log 有 stack trace 與 request_id；`alembic downgrade -1` 再 `upgrade head` 成功。
- **預估時數**：12 小時

### 第 5 週｜驗證基礎、帳號生命週期、密碼儲存、注入

- **對應技能**：D1、D2、E1–E4。現有：`authn-basics`、`password-storage`、`injection`、`owasp-top10`、`input-validation`
- **學習目標**
  1. 能畫出 session 與 token 兩種登入的時序圖，說出各自怎麼撤銷、各防什麼攻擊
  2. 能實作註冊 / 登入 / 登出 / 重設密碼，密碼用 argon2id，重設 token 一次性且 30 分鐘到期
  3. 能示範一個 SQL 注入 payload 打穿 f-string 查詢，再用參數化修好；能說出 MongoDB `{"$ne": null}` 怎麼繞過
  4. 能用 OWASP API Top 10 對自己的 API 走一遍並列出至少 3 個風險
- **動手作業**：先寫一版故意有漏洞的登入（f-string SQL、SHA-256 存密碼、「帳號不存在」訊息），用 payload 打穿並錄下；再改成參數化 + argon2id + 統一訊息；實作 cookie session（Redis 存 session）；重設密碼流程；登入端點 Redis 固定視窗限流（每帳號 + IP 每分鐘 5 次）；用 `hmac.compare_digest` 與 `secrets.token_urlsafe` 寫一張「密碼學工具對照表」。
- **驗收標準**：資料庫密碼欄位為 `$argon2id$` 開頭；注入 payload 測試 ≥ 3 個且全被擋；登入失敗訊息與回應時間對「帳號不存在」與「密碼錯」一致（測試斷言）；第 6 次登入回 429；重設 token 用過第二次回 400。
- **預估時數**：12 小時

### 第 6 週｜JWT、Auth 落地、RBAC / ABAC、CORS

- **對應技能**：B7、D3–D5。現有：`jwt`、`auth-in-practice`、`rbac-abac`、`cors-cookies`
- **學習目標**
  1. 能手動解開 JWT 三段並列出驗證時要檢查的五件事（簽章、alg、exp、iss、aud）
  2. 能實作 access（15 分）+ refresh（HttpOnly cookie、rotation、重用偵測）
  3. 能寫 `get_current_user` 與 `require_role()` 依賴，正確區分 401 / 403 / 404
  4. 能設計權限矩陣並在服務層做擁有權檢查；能寫出讓 dev server 帶 cookie 呼叫的正確 CORS 設定
- **動手作業**：JWT 登入（保留第 5 週 session 版做對照）；`alg=none` 與 HS/RS 混淆的測試；refresh rotation + 重用偵測（舊 refresh 再用 → 全家族撤銷）；角色 admin / staff / customer 的權限矩陣；「只能看 / 改自己的訂單」擁有權檢查；每個受保護 endpoint 三種身分測試；CORS 允許 `http://localhost:5173` 帶 credentials。
- **驗收標準**：`alg=none` token 回 401；refresh 重用回 401 且該使用者所有 refresh 失效；別人的訂單回 404 不是 403（測試斷言）；受保護 endpoint 數 × 3 = 測試數；瀏覽器 devtools 看到 preflight 通過且 cookie 送出。
- **預估時數**：12 小時

### 第 7 週｜OAuth / OIDC、XSS / CSRF / 安全標頭、秘密與供應鏈

- **對應技能**：D6、E5–E8。現有：`oauth-oidc`、`xss-csrf`、`secrets`、`supply-chain`
- **學習目標**
  1. 能畫出授權碼 + PKCE 流程 8 步，標出哪步在瀏覽器、哪步在後端，說明 state 與 PKCE 各防什麼
  2. 能區分 access_token 與 id_token，並說明 confidential 與 public client 誰換 token
  3. 能為服務加上 5 個安全標頭並用 devtools 驗證；能說出 cookie session 與 Bearer 各要防 CSRF 還是 XSS
  4. 能保證 repo 無 secret、CI 有依賴掃描，並說出 secret 在本機 / CI / 正式各放哪
- **動手作業**：「用 Google 登入」（或 compose 起 Keycloak 當 IdP）以授權碼 + PKCE + state 實作，登入後綁定或建立本地使用者；安全標頭 middleware；檔案上傳端點（隨機檔名、magic bytes、存到 MinIO）；gitleaks pre-commit；`pip-audit` 進本機腳本；`.dockerignore` 排除 `.env`。
- **驗收標準**：state 不符回 400；id_token 的 iss / aud / exp 驗證有測試；上傳 `.php` 改名 `.png` 被拒（magic bytes）；`gitleaks detect` 零發現；devtools 看到 HSTS / nosniff / frame-ancestors / Referrer-Policy / CSP。
- **預估時數**：11 小時

### 第 8 週｜索引、查詢計畫、交易與鎖、進階 SQL、Big-O

- **對應技能**：C6–C9、C13、I1。現有：`indexes`、`transactions`、`sql-advanced`、`mongodb-ops`、`big-o`
- **學習目標**
  1. 能對一條慢查詢跑 `EXPLAIN (ANALYZE, BUFFERS)`，指出瓶頸節點、建對索引、量出前後差異
  2. 能解釋複合索引欄位順序怎麼決定，列出三種「有索引但用不到」的情況
  3. 能用兩種以上方法防止庫存超賣，並用 100 個併發請求驗證
  4. 能用視窗函數寫「每個使用者最新一筆訂單」、用 CTE 把三層巢狀查詢改線性
- **動手作業**：`generate_series` 灌 100 萬筆 orders；挑 5 條查詢（含 `LOWER(email)`、`LIKE '%x'`、外鍵 JOIN、深頁 offset）做 EXPLAIN 前後對照表；「建訂單 + 扣庫存」交易，用 asyncio 100 併發打、比較無鎖 / 原子 UPDATE / `FOR UPDATE` 三版結果；視窗函數與 CTE 各 3 題；MongoDB aggregation「每作者文章數 top 10」+ explain 確認用到索引；每條查詢標 Big-O。
- **驗收標準**：5 條查詢至少 4 條從 Seq Scan 變 Index Scan 且時間下降一個數量級；超賣測試 stock 從不小於 0 且有測試斷言；REPEATABLE READ 與 READ COMMITTED 行為差異有可重現的腳本；Mongo explain 無 COLLSCAN。
- **預估時數**：12 小時

### 第 9 週｜並發模型、量測、快取、限流、外部呼叫韌性

- **對應技能**：A9、A10、C14、H1–H4。現有：`python-async`、`redis-cache`、`rate-limiting`、`lru-cache`
- **學習目標**
  1. 能用數字示範「在 async handler 裡呼叫同步 sleep」如何卡死所有請求，並用 `to_thread` 或 async driver 修好
  2. 能用 k6 量出 p95，並在加快取前後給出對照數字
  3. 能實作 cache-aside（TTL + 寫入時刪除）並說出穿透 / 雪崩 / 擊穿的防法；能用 Redis 實作 token bucket 回 429 + `Retry-After`
  4. 能讓所有外部 HTTP 呼叫都有 timeout、指數退避重試（只重試冪等）、斷路器
- **動手作業**：商品列表 endpoint 改 async（asyncpg 或 SQLAlchemy async）；寫一個 `time.sleep(1)` 的 async endpoint 用 k6 打 10 併發，記錄 p95，再修好重測；商品目錄 cache-aside（Redis，TTL 60s，更新時刪 key）；token bucket 限流 middleware；用 compose 起一個「隨機慢 / 隨機 500」的假第三方服務，httpx client 加 timeout（連線 2s / 讀取 5s）+ tenacity 退避 + 簡單斷路器；`py-spy` 抓一次火焰圖。
- **驗收標準**：阻塞版 p95 ≥ 10 秒、修正版 ≈ 1 秒（k6 報告截圖）；快取命中後 p95 下降且有命中率 metric；限流測試第 N+1 個請求回 429 帶標頭；假服務連續失敗 5 次後斷路器開、10 秒後半開；沒有任何 httpx 呼叫缺 timeout（grep 斷言）。
- **預估時數**：12 小時

### 第 10 週｜佇列與背景工作、冪等鍵、分頁、Webhook、機器身分 → 里程碑 M2

- **對應技能**：B5、B6、B8、D7、D8、H5、H6。現有：`queues-workers`、`api-patterns`、`beyond-rest`（Webhook）、`api-keys-mfa`（API key）
- **學習目標**
  1. 能把「註冊後寄歡迎信」改成佇列 + worker，重複投遞不會寄兩封（消費者冪等）
  2. 能實作 `Idempotency-Key`，同 key 重送回同結果且不重複建單
  3. 能實作 cursor 分頁並解釋為何比 offset 好；能設計帶 HMAC 簽章與重試的 Webhook
  4. 能設計 API key 的資料表與產生 / 驗證 / 撤銷流程，並寫入稽核日誌
- **動手作業**：arq 或 RQ worker + outbox 表（訂單建立事件先進 outbox，由 relay 程序送出）；死信佇列；`Idempotency-Key` 存 Redis 24 小時；訂單列表改 keyset 分頁 + 篩選欄位白名單；「訂單付款完成」Webhook 推給合作夥伴 URL（HMAC-SHA256 + 時間戳、指數退避 5 次）；合作夥伴用 API key 呼叫的端點；`audit_logs` 表記錄所有寫入操作；每日排程「清過期 token」用 Redis 鎖確保多實例只跑一次。
- **里程碑 M2 交付物「多使用者訂單服務」**：M1 + 登入（session 與 JWT 兩版擇一為主）、OAuth 登入、RBAC + 擁有權、限流、安全標頭、檔案上傳、快取、worker + outbox、冪等鍵、Webhook、API key、稽核日誌；CI（第 12 週會補，此時先本機腳本 `make check`）；一份「OWASP API Top 10 自評表」；測試 ≥ 80 個。
- **驗收標準**：worker 被 kill 再重啟，訊息重投但信只寄一封（用假信箱服務計數）；同 key POST 兩次資料庫只有一筆、回應相同；分頁在 100 萬筆上任一頁 < 50ms；Webhook 對方回 500 時看得到重試紀錄與死信；自評表每項有「風險 / 現況 / 證據（測試名）」。
- **預估時數**：12 小時

### 第 11 週｜Docker 原理、正式 Dockerfile、Compose 進階、nginx、網路基礎

- **對應技能**：B9、B11、F2–F5。現有：`docker-basics`、`dockerfile-python`、`compose`、`nginx`、`http-caching`
- **學習目標**
  1. 能解釋 layer 快取，重排 Dockerfile 讓改程式碼不重裝依賴，並用 `docker image history` 指出可瘦身處
  2. 能寫多階段、非 root、exec 形式 CMD、有 HEALTHCHECK 的 Python Dockerfile，image < 250MB
  3. 能寫 nginx 設定：SPA + `/api/` 反向代理 + 四個 `proxy_set_header` + `limit_req` + gzip，並讓後端拿到真實 IP 與 scheme
  4. 能說出容器內 `localhost` 為何連不到 DB、`ports` 與 `expose` 的差別、bridge 網路怎麼解析服務名
- **動手作業**：正式 Dockerfile（uv 官方 Docker 指引模式，BuildKit cache mount）；`compose.yaml`（共同）+ `compose.override.yaml`（本機掛程式碼）+ `compose.prod.yaml`；healthcheck + `depends_on.condition: service_healthy`；nginx 容器在前面，前端 build 產物由 nginx 服務；靜態資產 `immutable` 長快取、API 回 `private, no-cache`、商品詳情加 ETag；用 `ss -tlnp` 與 `docker network inspect` 寫一頁「這套服務的網路圖」。
- **驗收標準**：改一行程式碼重 build < 10 秒（依賴層命中快取）；`docker run` 內 `whoami` 非 root；hadolint 零 error；經 nginx 呼叫 API，後端 log 的 IP 是客戶端而非 172.x；`/api/auth/login` 每秒超過 5 次回 503 或 429；商品詳情第二次請求回 304。
- **預估時數**：12 小時

### 第 12 週｜CI/CD：管線、環境與 secrets、部署策略與零停機 migration

- **對應技能**：G1–G4。現有：`git-workflow`、`ci-pipeline`、`environments-secrets`、`cd-strategies`
- **學習目標**
  1. 能寫 GitHub Actions workflow：lint → 型別 → 測試（PostgreSQL service）→ build image（SHA tag）→ Trivy 掃描 → 推 registry；並改寫成 GitLab CI
  2. 能設定 prod environment 需人工核准且只接受 main；能說出 artifact 與 cache 的差別
  3. 能規劃並實際執行一次「欄位改名」的 expand-contract 零停機部署
  4. 能說出 rolling / blue-green / canary 各需要什麼基礎設施
- **動手作業**：兩份 CI（GitHub + GitLab）跑同一個 repo；快取 key 用 `uv.lock` hash；第三方 Action 釘 SHA、`permissions: contents: read`；`openapi.json` diff 檢查；`orders.note` 改名 `orders.remark`：分 4 個 PR（加欄 → 雙寫 → 回填 + 切讀 → 刪舊），每個 PR 部署時用 `docker compose up --scale api=2` 模擬 rolling，k6 持續打確認零錯誤；寫 `docs/deploy.md` 說明三種策略與本專案選擇。
- **驗收標準**：PR 頁面顯示全部檢查綠燈且 lint 失敗時測試不會跑（fail fast）；registry 有以 commit SHA 為 tag 的 image；GitLab pipeline 同樣通過；欄位改名過程 k6 錯誤率 0%；prod 部署 job 停在等待核准。
- **預估時數**：12 小時

### 第 13 週｜上線：Linux 維運、TLS / DNS、程序管理、雲端與物件儲存

- **對應技能**：B10、C10、F1（維運層）、F7–F9。現有：`tls-dns`、`process-servers`、`cloud-basics`
- **學習目標**
  1. 能 ssh 進一台 VM，用 `ss / top / df / journalctl / lsof` 回答「哪個程序佔 port、磁碟剩多少、剛才為何重啟」
  2. 能設定網域 A 紀錄、用 ACME 自動取得憑證、nginx 終結 TLS 並把 HTTP 導向 HTTPS
  3. 能為 4 核機器決定 uvicorn worker 數與連線池大小，實作 graceful shutdown 與 /health、/ready
  4. 能把使用者上傳改為 presigned URL 直傳物件儲存，並說明為何 DB 要用受管服務
- **動手作業**：租一台最低規格 VM（或雲端免費層）；建非 root 使用者、金鑰登入、防火牆只開 22 / 80 / 443；compose 以 systemd unit 開機自啟；網域 + certbot（或改用 Caddy 對照）；uvicorn `--workers`；SIGTERM 中斷測試（k6 打的同時 `docker compose restart api`）；超時鏈（nginx 30s > 應用 25s > `statement_timeout` 20s > httpx 5s）；上傳改 presigned URL（S3 相容服務）；寫一份「Linux 一頁檢查表」。
- **驗收標準**：`https://<你的網域>/api/health` 回 200 且憑證有效、HTTP 自動 301；restart 期間 k6 零 5xx（graceful）；`/ready` 在 DB 斷線時回 503 而 `/health` 仍 200；殺掉 DB 連線數上限測試（超過 pool 上限時排隊而非 too many connections）；上傳檔案不經過 API 伺服器磁碟。
- **預估時數**：12 小時

### 第 14 週｜可觀測性、可靠性、資料庫維運與備份演練

- **對應技能**：C11、G5、G6。現有：`observability`、`reliability`
- **學習目標**
  1. 能讓服務輸出 Prometheus metrics 並在 Grafana 畫四個黃金訊號；能用 OpenTelemetry trace 找出一個慢請求的瓶頸 span
  2. 能設一條「5xx 比率 > 1% 持續 5 分鐘」的可行動告警並寫下收到後做什麼
  3. 能做一次完整的 `pg_dump` → 還原到乾淨實例 → 驗證列數的演練，並說出 RPO / RTO
  4. 能寫 3 份 runbook 並用 postmortem 模板記錄一次模擬事故
- **動手作業**：compose 加 Prometheus + Grafana + Jaeger（或 OTel collector）；FastAPI / SQLAlchemy / httpx 自動儀器化；GlitchTip 或 Sentry 收例外；每晚 `pg_dump` 到物件儲存 + 保留 7 天；還原演練腳本；開 `log_min_duration_statement=200ms` 與 `pg_stat_statements` 找 top 5 慢查詢；runbook：DB 連線滿 / 磁碟滿 / 憑證過期；模擬事故「Redis 掛掉」→ 服務要能降級（快取 miss 直接查 DB）。
- **驗收標準**：Grafana 看得到四張圖；trace 中一個請求含 HTTP → DB → Redis 三個 span；告警在測試中觸發並送到 Slack 或 email；還原演練文件含開始 / 結束時間與列數比對；Redis 停掉時 API 仍回 200 只是變慢，且有告警。
- **預估時數**：12 小時

### 第 15 週｜資料結構與演算法補強、擴展與壓測

- **對應技能**：H7、I2、I3。現有：`data-structures`、`scaling`
- **學習目標**
  1. 能為「去重 / top 10 / 任務排程 / 依賴排序」各挑對資料結構並說出複雜度
  2. 能完成 12 題基礎演算法（排序、二分、two-pointer、雜湊計數、BFS、拓樸排序、memoization、LRU）並解釋每題的 Big-O
  3. 能檢查自己的 API 是否無狀態，用 `--scale api=3` + nginx upstream 水平擴展並壓測比較
  4. 能架一主一讀副本並處理 read-your-writes
- **動手作業**：12 題 Python（瀏覽器可跑、附測資）；code review 練習：給 3 段有 N+1 / list 巢狀查找 / 迴圈裡 await 的程式碼找出並改寫；`docker compose up --scale api=3`，session 改 Redis 讓任一實例都能服務；PostgreSQL streaming replication（compose 兩個 container）；訂單列表讀副本、建單後立刻讀主庫；k6 找出 1 / 2 / 3 實例的吞吐上限與第一個瓶頸。
- **驗收標準**：12 題測資全過且每題附複雜度；code review 三段都找到問題並修正後測試通過；3 實例吞吐 > 1 實例且 session 在任一實例有效；副本延遲用 `pg_stat_replication` 觀察，read-your-writes 有測試。
- **預估時數**：11 小時

### 第 16 週｜系統設計、設計文件、選型 → 里程碑 M3

- **對應技能**：C15、I5–I7、E9（走一遍）。現有：`system-design`、`db-choice`
- **學習目標**
  1. 能用六步驟（需求 → 估算 → API → 資料 → 架構 → 瓶頸 → 取捨）在 45 分鐘內設計「通知系統」並講給同事聽
  2. 能寫一頁設計文件與 3 份 ADR，說明本專案每個元件為何在那裡
  3. 能對現有系統指出下一個會爆的瓶頸與對策
  4. 能用 STRIDE 對自己的服務做一次威脅建模並列出前 5 個風險
- **動手作業**：系統設計練習 3 題（短網址 / 通知系統 / 訂單系統擴到 10 倍流量），每題一頁；ADR：為何 PostgreSQL 而非 MongoDB 當主庫、為何 session 或 JWT、為何 arq 而非 Celery；STRIDE 表；20 分鐘口頭簡報（架構圖 + demo + 事故回顧）。
- **里程碑 M3 交付物「上線的訂單服務」**：M2 + 正式 Dockerfile、nginx + TLS、公開網域、CI/CD 到 VM、可觀測性三件組、備份演練紀錄、3 份 runbook、1 份 postmortem、設計文件 + 3 ADR + 威脅模型、k6 壓測報告與一次據 EXPLAIN 的優化紀錄。
- **驗收標準**：由兩位同事驗收：一位照 runbook 處理模擬事故（DB 磁碟滿）並在 15 分鐘內恢復；一位只看設計文件能說出系統怎麼運作與下一個瓶頸；20 分鐘簡報後能回答「為什麼不用 X」至少 3 題。
- **預估時數**：12 小時

### 里程碑總覽

| 里程碑 | 週次 | 一句話 | 核心交付物 |
|---|---|---|---|
| M1 訂單 API v1 | 第 4 週 | 本機可跑、有測試、有契約的 CRUD API | compose、Alembic、≥ 25 測試、openapi.json、README、JSON log |
| M2 多使用者訂單服務 | 第 10 週 | 有驗證授權、資安硬化、快取與背景工作的服務 | 登入 / OAuth / RBAC、限流、上傳、cache-aside、worker + outbox、冪等鍵、Webhook、API key、稽核、OWASP 自評 |
| M3 上線 | 第 16 週 | 部署到公開網域、看得見、救得回、講得清 | Dockerfile、nginx + TLS、CI/CD、metrics / trace / 錯誤追蹤、備份演練、runbook、postmortem、設計文件 + ADR |

---

## 四、驗收方式設計

### 4.1 各領域適合的形式

| 領域 | 主要形式 | 次要形式 | 執行方式與備註 |
|---|---|---|---|
| A 語言與工程 | 預測輸出（陷阱題）、程式題（pydantic 模型、例外轉換） | 設定檔（`pyproject.toml` 的 ruff / 依賴 group） | Python 在瀏覽器用 Pyodide；輸出比對 + 隱藏測資 |
| B HTTP 與 API | 選擇題（狀態碼、冪等）、設計題（給需求寫資源表） | 口頭（CORS 為何不是安全機制） | 設計題用表格作答，評分看方法 / 路徑 / 狀態碼三欄 |
| C 資料儲存 | SQL 程式題（瀏覽器內 PostgreSQL WASM，如 PGlite）、預測輸出（NULL、JOIN 列數） | EXPLAIN 判讀（給計畫指出瓶頸）、Mongo 文件設計題 | SQL 題比對結果集（排序後）；避免用 SQLite 引擎，方言差異會誤判 |
| D 驗證與授權 | 預測輸出（JWT 驗證結果）、程式題（`require_role`） | 口頭（session vs token 取捨、401 / 403 / 404） | JWT 題給 header / payload / 伺服器設定，問「接受或拒絕、為何」 |
| E 應用資安 | 找漏洞題（給程式碼指出 N 個問題並修） | 選擇題（OWASP 分類）、口頭（外洩後處置順序） | 找漏洞題以「找到幾個 / 修法正確」計分 |
| F Linux、容器與部署 | 設定檔撰寫（Dockerfile / compose / nginx） | 預測（改哪行會讓哪些層失效）、排錯（給 log 找原因） | 設定檔用檢查清單 + 靜態工具（hadolint、`nginx -t`、`docker compose config`） |
| G CI/CD 與可靠性 | 設定檔撰寫（GitHub Actions / GitLab CI YAML）、排錯題 | 口頭（expand-contract 步驟、postmortem 怎麼寫） | YAML 題用 `actionlint` / GitLab lint API 做語法檢查，再人工看邏輯 |
| H 效能與非同步 | 程式題（限流器、cache-aside）、預測（阻塞 async 的耗時） | 量測題（給 k6 報告解讀 p95） | 程式題附測資與時間限制 |
| I 演算法與設計 | 程式題（heap top-k、拓樸排序、LRU） | 口頭系統設計（20–45 分鐘白板） | 系統設計用固定 rubric：需求釐清 / 估算 / API / 資料 / 架構 / 瓶頸 / 取捨各 0–3 分 |

### 4.2 題庫格式（給量產用）

每題一個物件，欄位固定：

```
id: q-<領域字母><流水號>        例：q-c07
domain: A–I                     skill: 我的編號（如 C2）與現有 id（如 sql-joins）
type: predict | code-py | code-sql | mcq | config | oral | find-bugs | design
difficulty: 1–3                 time_min: 建議作答分鐘
prompt: 題目（含程式碼 / 資料 / 情境）
answer: 標準答案（程式題附測資；設定檔附參考解）
rubric: 評分重點（每點配分，總分 10）
pitfalls: 常見錯答與為什麼錯（給出題者與講師）
```

### 4.3 十個範例題

#### Q1｜A · 預測輸出 · 難度 1 · 3 分鐘

```python
def add(item, bucket=[]):
    bucket.append(item)
    return bucket

print(add(1))
print(add(2))
print(add(3, []))
```

- **答案**：`[1]`、`[1, 2]`、`[3]`。預設值在函式定義時只建立一次，前兩次呼叫共用同一個 list；第三次傳入新 list。
- **評分重點**：三行輸出全對（6 分）；說出「預設值在 def 時求值一次」（3 分）；給出修法 `bucket=None` 再在函式內建 list（1 分）。
- **常見錯答**：`[1]`、`[2]`、`[3]`——以為每次呼叫重新建立預設值。

#### Q2｜A · 預測輸出 · 難度 2 · 5 分鐘

```python
import asyncio, time

async def slow(n):
    time.sleep(1)          # 注意：不是 asyncio.sleep
    return n

async def main():
    t = time.perf_counter()
    r = await asyncio.gather(slow(1), slow(2), slow(3))
    print(r, round(time.perf_counter() - t))

asyncio.run(main())
```

- **答案**：`[1, 2, 3] 3`。`time.sleep` 是同步阻塞呼叫，event loop 在它期間無法切換，三個協程只能依序各睡 1 秒。改成 `await asyncio.sleep(1)` 會變 `1`；若必須呼叫同步阻塞函式，用 `await asyncio.to_thread(time.sleep, 1)`。
- **評分重點**：秒數 3（4 分）；解釋阻塞 loop（3 分）；兩種修法（3 分）。
- **常見錯答**：答 1 秒——把 `gather` 當成自動平行。

#### Q3｜C · SQL 程式題 · 難度 2 · 10 分鐘

資料：

```sql
CREATE TABLE users (id INT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE orders (id INT PRIMARY KEY, user_id INT REFERENCES users(id),
                     amount NUMERIC(10,2) NOT NULL, status TEXT);
INSERT INTO users VALUES (1,'Amy'),(2,'Bob'),(3,'Cid');
INSERT INTO orders VALUES (1,1,100,'paid'),(2,1,50,'paid'),(3,2,80,'cancelled'),
                          (4,2,20,'paid'),(5,2,30,NULL);
```

題目：列出**每位**使用者的已付款（`status = 'paid'`）訂單數與總金額，沒有已付款訂單的使用者也要出現且金額顯示 0；依總金額由高到低、同金額依 id。

- **答案**：

```sql
SELECT u.id, u.name,
       COUNT(o.id)                AS paid_orders,
       COALESCE(SUM(o.amount), 0) AS paid_total
FROM users u
LEFT JOIN orders o
       ON o.user_id = u.id AND o.status = 'paid'
GROUP BY u.id, u.name
ORDER BY paid_total DESC, u.id;
```

預期結果：`(1, Amy, 2, 150.00)`、`(2, Bob, 1, 20.00)`、`(3, Cid, 0, 0)`。

- **評分重點**：用 LEFT JOIN 保留 Cid（3 分）；`status = 'paid'` 放在 ON 而非 WHERE（3 分，放 WHERE 會把 Cid 濾掉）；`COUNT(o.id)` 而非 `COUNT(*)`（Cid 要是 0，2 分）；`COALESCE` 讓金額為 0 而非 NULL（1 分）；排序正確（1 分）。
- **常見錯答**：`WHERE o.status = 'paid'` → 只剩 Amy、Bob；`COUNT(*)` → Cid 變 1。

#### Q4｜C · 預測輸出 · 難度 1 · 4 分鐘

沿用 Q3 的 orders 資料（status 有 `paid` ×3、`cancelled` ×1、NULL ×1）。

```sql
SELECT COUNT(*), COUNT(status), COUNT(DISTINCT status) FROM orders;
SELECT id FROM orders WHERE status <> 'paid';
SELECT id FROM orders WHERE status IS DISTINCT FROM 'paid';
```

- **答案**：第一句 `5, 4, 2`（`COUNT(status)` 不算 NULL；DISTINCT 也不算 NULL）。第二句只回 `3`（NULL <> 'paid' 結果是 NULL，被 WHERE 當假）。第三句回 `3, 5`。
- **評分重點**：三個 COUNT（3 分）；第二句只有一列並解釋三值邏輯（4 分）；第三句兩列（3 分）。
- **常見錯答**：第二句答 `3, 5`——把 NULL 當「不等於 paid」。

#### Q5｜D · 選擇題 · 難度 2 · 3 分鐘

伺服器收到一個 JWT，header 是 `{"alg":"none","typ":"JWT"}`，payload 是合法使用者且 `exp` 未過期，簽章段為空。下列哪個做法能**確定**擋掉這個 token？

A. 檢查 `exp` 尚未過期
B. 驗證時由伺服器指定允許的演算法清單（例如 `algorithms=["RS256"]`），不採用 header 裡的 `alg`
C. 檢查 payload 的 `sub` 存在於資料庫
D. 將 token 加進 Redis 黑名單

- **答案**：B。`alg` 由攻擊者控制，只要驗證程式相信 header 就可能接受 `none`，或把 RS256 公鑰當 HS256 的 secret（演算法混淆）。A、C 都通得過；D 是事後補救，不是驗證。
- **評分重點**：選 B（6 分）；說出「header 的 alg 不可信」（2 分）；提到 HS / RS 混淆攻擊（2 分）。

#### Q6｜B + D · 口頭解釋題 · 難度 2 · 8 分鐘

情境：同事在 code review 問你兩個問題，請講給他聽。(1) 使用者 A 呼叫 `DELETE /orders/42`，42 屬於使用者 B，為什麼你回 404 而不是 403？(2) 我們的 Web 用 cookie session、行動 App 用 Bearer JWT，這兩種各要防什麼攻擊？為什麼？

- **答案要點**：(1) 403 會洩漏「42 存在」，攻擊者可以枚舉 id；對「不是你的資源」一律回 404，行為與「不存在」一致。若是同一使用者但角色不夠（例如 customer 呼叫 admin 端點）才回 403——那是端點層級、不洩漏資源存在性。(2) cookie 會被瀏覽器自動帶上，所以要防 CSRF（`SameSite=Lax`、狀態改變只用 POST、必要時 CSRF token）；Bearer 存在 JS 可讀處、不會自動帶，所以免疫 CSRF 但要防 XSS 偷 token（存記憶體、短效、refresh 放 HttpOnly cookie）。
- **評分重點**：404 的洩漏理由（3 分）；能區分資源層 404 與端點層 403（2 分）；cookie → CSRF、Bearer → XSS 對應正確（3 分）；各給一個具體防法（2 分）。
- **常見錯答**：「404 只是習慣」；把 CSRF 與 XSS 說反。

#### Q7｜E · 找漏洞並修正 · 難度 3 · 15 分鐘

```python
@app.post("/login")
def login(body: dict, db=Depends(get_db)):
    row = db.execute(text(f"SELECT id, pw FROM users WHERE email = '{body['email']}'")).first()
    if row and row.pw == hashlib.sha256(body["password"].encode()).hexdigest():
        return {"token": jwt.encode({"sub": row.id}, SECRET)}
    raise HTTPException(404, "user not found")

@app.post("/avatar")
def avatar(file: UploadFile, user=Depends(current_user)):
    path = f"/srv/uploads/{file.filename}"
    open(path, "wb").write(file.file.read())
    os.system(f"convert {path} -resize 200x200 {path}.thumb.jpg")
    return {"ok": True}
```

請至少找出 5 個安全問題，每個給修法。

- **答案**（共 8 個）：
  1. SQL 注入（f-string 拼 SQL）→ `text("... WHERE email = :email")` 綁參數，或 ORM。
  2. 密碼用無 salt 的快速雜湊 SHA-256 → argon2id（或 bcrypt）的 `hash` / `verify`。
  3. 錯誤訊息洩漏帳號是否存在（404 "user not found"）→ 統一 401「帳號或密碼錯誤」，回應時間也要一致。
  4. JWT 沒有 `exp`（也沒 `iss` / `aud`）→ 加 15 分鐘 `exp`，搭配 refresh。
  5. `body: dict` 無驗證 → pydantic 模型限制型別與長度。
  6. 登入沒有限流 → 每帳號 + IP 限流，失敗 N 次鎖定。
  7. 路徑穿越：`file.filename` 可含 `../` → 用 `secrets.token_hex()` 產隨機檔名、白名單副檔名、檢查 magic bytes、存到物件儲存。
  8. OS 命令注入：`os.system` + f-string → `subprocess.run(["convert", path, "-resize", "200x200", out], check=True)` 不經 shell；更好是用 Pillow 重新編碼。
- **評分重點**：每找到一個並給出正確修法 1.25 分，滿分 10；只指出問題沒修法給一半；把「用 HTTPS」當作修 SQL 注入不給分。
- **常見漏抓**：路徑穿越、帳號枚舉、缺 `exp`。

#### Q8｜F · 設定檔撰寫（Dockerfile）· 難度 2 · 15 分鐘

為一個 uv 管理的 FastAPI 專案（入口 `app.main:app`，有 `pyproject.toml` 與 `uv.lock`，`/health` 端點）寫正式環境 Dockerfile。要求：多階段、非 root、改程式碼不重裝依賴、exec 形式 CMD、有 HEALTHCHECK。

- **參考答案**：

```dockerfile
FROM python:3.12-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /uvx /bin/
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project
COPY . .
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

FROM python:3.12-slim
RUN useradd -m -u 1000 app
WORKDIR /app
COPY --from=builder --chown=app:app /app /app
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).status == 200 else 1)"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

（uv image 的版本號請釘到當時的穩定版，不要用 `latest`。）

- **評分重點**：先 COPY `pyproject.toml uv.lock` 再 sync、最後才 COPY 程式碼（3 分）；多階段且 runtime 沒有 uv / 編譯工具（2 分）；`USER` 非 root（2 分）；CMD 為 exec 形式 JSON 陣列（1 分）；HEALTHCHECK 存在且打 `/health`（1 分）；`--frozen --no-dev`、釘 base 版本（1 分）。
- **常見錯答**：`COPY . .` 放第一行；`CMD uvicorn ...` shell 形式（收不到 SIGTERM）；`FROM python:latest`。

#### Q9｜G · 設定檔撰寫 + 排錯（GitHub Actions）· 難度 2 · 15 分鐘

(a) 寫一份 workflow：PR 與 push main 時，起 PostgreSQL 16 service，用 uv 安裝（有快取），跑 ruff、pyright、alembic upgrade、pytest（coverage ≥ 80%）。(b) 同事把測試的 `DATABASE_URL` 寫成 `postgresql://app:app@db:5432/app_test`，測試報 `connection refused`，為什麼？

- **參考答案 (a)**：

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      db:
        image: postgres:16
        env: { POSTGRES_USER: app, POSTGRES_PASSWORD: app, POSTGRES_DB: app_test }
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U app" --health-interval 5s
          --health-timeout 3s --health-retries 10
    env:
      DATABASE_URL: postgresql+psycopg://app:app@localhost:5432/app_test
    steps:
      - uses: actions/checkout@<釘 commit SHA>
      - uses: astral-sh/setup-uv@<釘 commit SHA>
        with: { enable-cache: true }
      - run: uv sync --locked
      - run: uv run ruff check . && uv run ruff format --check .
      - run: uv run pyright
      - run: uv run alembic upgrade head
      - run: uv run pytest -q --cov=app --cov-fail-under=80
```

- **參考答案 (b)**：job 直接跑在 VM runner 上（不是 `container:` 內），service 容器對 job 而言是 `localhost:<對應 port>`；service 名稱 `db` 只有在 job 本身也跑在容器裡（同一個 Docker 網路）時才解析得到。改成 `localhost:5432`，或把 job 放進 `container:`。
- **評分重點**：service 有 health option（2 分）；`--locked` 而非 `--frozen`（1 分）；quality 步驟齊全且順序 fail fast（2 分）；`permissions` 最小化與 Action 釘 SHA（1 分）；(b) 說出 VM runner vs container job 的 hostname 差別（4 分）。
- **常見錯答**：(b) 以為是 health check 沒等到——若是那樣錯誤訊息通常是 timeout 不是 refused，且 hostname 就已解析失敗。

#### Q10｜H + I · Python 程式題 · 難度 2 · 15 分鐘

實作滑動視窗限流器：`SlidingWindowLimiter(limit, window_seconds)`，方法 `allow(key: str, now: float) -> bool`。每個 key 在任意長度為 `window` 的時間區間內最多允許 `limit` 次；`now` 由呼叫者傳入（方便測試）。要求每次呼叫攤銷 O(1)，並說明多實例部署時這個實作的限制。

- **參考答案**：

```python
from collections import deque

class SlidingWindowLimiter:
    def __init__(self, limit: int, window: float):
        self.limit, self.window = limit, window
        self._hits: dict[str, deque[float]] = {}

    def allow(self, key: str, now: float) -> bool:
        q = self._hits.setdefault(key, deque())
        while q and now - q[0] >= self.window:
            q.popleft()
        if len(q) < self.limit:
            q.append(now)
            return True
        return False
```

測資（limit=3, window=10）：`allow("a",0)→True`、`(1)→True`、`(2)→True`、`(3)→False`、`(10)→True`（t=0 已滿 10 秒過期）、`(10.5)→False`、`("b",10.5)→True`（不同 key 獨立）。

限制：狀態在單一程序記憶體，多 worker / 多實例各算各的，實際上限會變成 `limit × 實例數`；記憶體隨 key 數成長要清理閒置 key。正式環境改用 Redis（sorted set + `ZREMRANGEBYSCORE`，或 Lua 腳本做 token bucket）共享計數。

- **評分重點**：deque 兩端 O(1) 且先清過期再判斷（3 分）；邊界用 `>=`（1 分）；per-key 隔離（1 分）；測資全過（3 分）；說出多實例限制與 Redis 解法（2 分）。
- **常見錯答**：用 list 的 `pop(0)`（O(n)）；先 append 再判斷導致多放一次；把 `window` 當固定視窗（每 10 秒歸零）而非滑動。

### 4.4 量產題庫的幾點提醒

- 每個技能至少 3 題：1 題「認得出」（選擇 / 預測）、1 題「做得出」（程式 / 設定檔）、1 題「講得清」（口頭）。三題都過才算該技能完成。
- 預測輸出題的價值在於「陷阱」；沒有陷阱的預測題只是在考記憶，不要出。
- 設定檔題一律附靜態檢查工具（hadolint、`nginx -t`、`docker compose config`、actionlint）當第一關，人工只看邏輯與安全性。
- 口頭題給評分者一張 rubric，每點 0–2 分，避免「感覺講得不錯」。
- 里程碑驗收由「非作者」執行：照 README 跑、照 runbook 救、照設計文件講。能被別人重現，才算獨立負責。

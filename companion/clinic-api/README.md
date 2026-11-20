# clinic-api：門診掛號後端（可以在本機跑起來的版本）

u kinda should know「實作路線：從零做完一個門診掛號後端」的參考實作。網站上每個階段的驗收題在瀏覽器裡跑（PGlite、Pyodide）；這個專案把同一套資料表、規則、介面接成一個真的服務：FastAPI + SQLAlchemy + Alembic + PostgreSQL 16 + Redis，用 uv 管理依賴。

範例資料全部是虛構的。前端的最小接線版本在 [`../clinic-web/`](../clinic-web/)；兩邊的介面照同一份契約 [docs/contract.md](docs/contract.md)。

## 前置需求

| 用途 | 需要 |
|---|---|
| 把服務跑起來 | Docker（含 `docker compose`） |
| 跑測試、lint、在主機上直接啟動 | [uv](https://docs.astral.sh/uv/)（會依 `.python-version` 準備 Python 3.12）、一個 PostgreSQL 16 與一個 Redis（可以直接用 compose 起的那兩個） |
| 貼下面的 curl 範例 | `curl`、`python3`（只用來從 JSON 取欄位） |
| 在本機的 Kubernetes 叢集跑 | Docker、[kind](https://kind.sigs.k8s.io/) v0.33.0、kubectl v1.37.2（見 [docs/local-k8s.md](docs/local-k8s.md)） |

## 三步驟跑起來

在這個目錄（`companion/clinic-api/`）執行：

```bash
# 1. 建置映像，啟動 api + postgres + redis，等三個 healthcheck 都通過
docker compose up -d --build --wait

# 2. 建立資料表（migration 用同一個映像跑，不在 API 啟動時自動執行）
docker compose exec api alembic upgrade head

# 3. 建立虛構的範例資料與測試帳號；密碼由 SEED_PASSWORD 指定
docker compose exec -e SEED_PASSWORD=local-dev-only api python -m clinic.seed
```

seed 會印出帳號（`patient1`、`patient2`、`desk1`、`doctor1`）、林醫師的 `doctor_id` 與診次日期（執行當天的 7 天後）；另外建立今天兩位醫師的上午、下午、晚上診，報到看板任何時間都有資料。不給 `SEED_PASSWORD` 時會隨機產生一組密碼並印出一次。

結束：`docker compose down`（加 `-v` 連資料庫的 volume 一起刪除）。

`compose.yaml` 裡的資料庫密碼與 `JWT_SECRET` 是寫在檔案裡的開發用假值，僅供本機。

## curl 範例

```bash
BASE=http://127.0.0.1:8000
field() { python3 -c "import json,sys; print(json.load(sys.stdin)$1)"; }

# 健康檢查與指標：不需要登入，也不在 /api 底下
curl -s $BASE/healthz
curl -s $BASE/ready
curl -s $BASE/metrics | grep appointments_booked_total

# 業務介面都在 /api 底下。登入（病患），拿到 15 分鐘有效的 token
TOKEN=$(curl -s $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"patient1","password":"local-dev-only"}' | field "['access_token']")

# 查林醫師那一天的診次與剩餘名額（日期用 seed 印出的那一天）
DAY=$(python3 -c "from datetime import *; print((datetime.now(timezone(timedelta(hours=8))) + timedelta(days=7)).date())")
curl -s "$BASE/api/sessions?doctor_id=1&date=$DAY" -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/api/sessions?date=$DAY" -H "Authorization: Bearer $TOKEN"     # 不帶 doctor_id：全部醫師

# 掛號：病患替自己掛，body 是空物件；回 201、Location 標頭與號碼
curl -si -X POST $BASE/api/sessions/1/appointments -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: demo-key-1' -d '{}'

# 同一個 Idempotency-Key 再送一次：一樣是 201、同一筆掛號，多一個 Idempotent-Replayed: true
curl -si -X POST $BASE/api/sessions/1/appointments -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: demo-key-1' -d '{}'

# 不帶鍵再掛一次：409，type 以 already-booked 結尾，Content-Type 是 application/problem+json
curl -si -X POST $BASE/api/sessions/1/appointments -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{}'

# 列出自己的掛號（可以加 status=booked|cancelled|checked_in）、取消
curl -s "$BASE/api/appointments?status=booked" -H "Authorization: Bearer $TOKEN"
curl -s -X POST $BASE/api/appointments/1/cancel -H "Authorization: Bearer $TOKEN"

# 櫃台替病患 2 掛號，然後報到
DESK=$(curl -s $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"desk1","password":"local-dev-only"}' | field "['access_token']")
curl -s -X POST $BASE/api/sessions/1/appointments -H "Authorization: Bearer $DESK" \
  -H 'Content-Type: application/json' -d '{"patient_id": 2}'
curl -s -X POST $BASE/api/appointments/2/check-in -H "Authorization: Bearer $DESK"

# 報到看板：不需要登入；今天目前這個時段的每個診次
curl -s $BASE/api/board

# 連續送 6 次掛號：每位使用者的 token（容量 5、每 6 秒補 1 個）用完之後回 429 與 Retry-After
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/api/sessions/2/appointments \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'
done

# 日誌：一行一筆 JSON，同一個請求的紀錄有相同的 request_id
docker compose logs api --no-log-prefix | tail -5
```

範例裡的 id（診次 1、2，掛號 1、2）以剛跑完 seed 的資料庫為準。

`scripts/smoke.sh` 把上面的主要流程寫成會檢查狀態碼的腳本：`SEED_PASSWORD=local-dev-only bash scripts/smoke.sh`。OpenAPI 文件在 `http://127.0.0.1:8000/docs`。

## 介面

完整的契約（參數、成功與錯誤回應、Problem Details 的 `type`、冪等鍵的規則）在 [docs/contract.md](docs/contract.md)，前端課與站上的假 API 用同一份。

| 方法與路徑 | 用途 | 成功 | 主要錯誤 |
|---|---|---|---|
| `POST /api/auth/login` | 帳號密碼換 Bearer token | 200 | 401、422、429 |
| `GET /api/sessions?date=&doctor_id=` | 診次與剩餘名額；兩個條件都選填（快取 30 秒） | 200 | 401、422 |
| `POST /api/sessions/{id}/appointments` | 掛號；選填標頭 `Idempotency-Key` | 201 + `Location` | 400、401、403、404、409、422、429 |
| `GET /api/appointments/{id}` | 查一筆掛號 | 200 | 401、404 |
| `GET /api/appointments?status=&patient_id=&cursor=&limit=` | 列出看得到的掛號（cursor 分頁） | 200 | 401、422 |
| `POST /api/appointments/{id}/cancel` | 取消 | 200 | 401、403、404、409 |
| `POST /api/appointments/{id}/check-in` | 報到（櫃台） | 200 | 401、403、404、409 |
| `GET /api/board` | 報到看板：今天目前時段的每個診次，不需要登入 | 200 | — |
| `GET /healthz`、`GET /ready`、`GET /metrics` | liveness、readiness、Prometheus 指標；不在 `/api` 底下 | 200 | `/ready`：503 |

錯誤 body 一律是 Problem Details（RFC 9457）。409 的 `type` 結尾：`already-booked`、`session-full`、`daily-limit`、`cancel-deadline-passed`、`invalid-status`；422 是 `validation-error`（附 `errors: { 欄位: [訊息] }`）或 `idempotency-key-reused`。

業務介面放在 `/api` 底下，是為了和前端用同一個前綴：前端的 Vite proxy 與 nginx 把 `/api/` 原樣轉過來，不改寫路徑。維運端點留在根目錄，Kubernetes 的探針、compose 的 healthcheck 與 Prometheus 打的路徑不變，也不會經由前端的 `/api/` proxy 露到外面。

## 設定（環境變數）

| 變數 | 必填 | 預設 | 說明 |
|---|---|---|---|
| `DATABASE_URL` | 是 | — | `postgresql://帳號:密碼@主機:5432/資料庫` |
| `JWT_SECRET` | 是 | — | 簽 token 用，至少 32 個字元 |
| `REDIS_URL` | | `redis://localhost:6379/0` | 快取與限流 |
| `LOG_LEVEL` | | `INFO` | `DEBUG`／`INFO`／`WARNING`／`ERROR` |
| `TOKEN_TTL_SECONDS` | | `900` | token 有效秒數 |
| `SESSION_CACHE_TTL` | | `30` | 診次清單快取秒數 |
| `RATE_LIMIT_CAPACITY`、`RATE_LIMIT_REFILL_SECONDS` | | `5`、`6` | token bucket：容量，以及每幾秒補 1 個 |
| `DB_POOL_SIZE` | | `5` | 連線池大小（另有 5 條 overflow） |

缺必填項或格式不對時，行程在啟動時就失敗並列出所有有問題的變數。

## 跑測試

測試用真的 PostgreSQL 與 Redis，每個測試前會 `TRUNCATE` 資料表、清空指定的 Redis db，所以 `DATABASE_URL` 的資料庫名稱必須以 `_test` 結尾，否則測試直接失敗、不會動到資料。

```bash
uv sync --locked                                   # 依 uv.lock 安裝，和 CI 相同的版本

# 用 compose 起的 postgres 與 redis（只起這兩個也可以：docker compose up -d --wait postgres redis）
docker compose exec postgres createdb -U clinic clinic_test
export DATABASE_URL=postgresql://clinic:local-dev-only@127.0.0.1:5432/clinic_test
export REDIS_URL=redis://127.0.0.1:6379/15

uv run alembic upgrade head                        # 測試開始時也會自動執行一次
uv run ruff check .
uv run pytest                                      # 全部
uv run pytest tests/test_concurrency.py -v         # 只跑並發測試
uv run pytest tests/test_domain.py                 # 不需要資料庫的單元測試
uv run pytest tests/test_contract.py -v            # 和前端對齊的契約：/api、選填條件、status、冪等鍵、看板、日誌原因
```

`tests/test_concurrency.py` 用 20 個執行緒、各自一條資料庫連線，在同一個 barrier 後同時送出掛號，驗證：剩 3 個名額時剛好發出 3 個不重複的號碼、其他人收到 `SessionFull`；同一位病患同時掛同一診次只有一筆成功；同一位病患同時掛同一天 6 個診次剛好 3 個成功；同時取消同一筆掛號 `booked` 只減一次；同一個 `Idempotency-Key` 同時送 10 次只有一筆掛號、10 次拿到同一個結果。每個測試最後都跑對帳查詢，確認 `sessions.booked` 與實際有效掛號數一致。

在主機上直接啟動（不用容器）：設定好 `DATABASE_URL`、`REDIS_URL`、`JWT_SECRET` 後 `uv run uvicorn clinic.main:app --no-access-log`。

## 在本機的 Kubernetes 叢集跑

實作指南：[docs/local-k8s.md](docs/local-k8s.md)。用 kind 建一個單節點叢集，套用 `k8s/overlays/kind`，走完：

- 建置映像並 `kind load` → `kubectl apply -k` → migration Job、seed → `kubectl port-forward` 打 API 走完掛號流程
- 滾動更新到新的 tag，叢集內持續打 `/ready` 確認沒有中斷
- 六個故意弄壞的練習（ImagePullBackOff、Pending、OOMKilled、endpoints 是空的、readiness 打錯讓更新卡住、CrashLoopBackOff），每個寫怎麼弄壞、會看到什麼、用哪個指令查、怎麼修
- 選讀：用 Envoy Gateway 接上 Gateway API；兩個 worker 的叢集上練 drain 與 PodDisruptionBudget

一次做完、可以重複執行：

```bash
bash scripts/kind-up.sh      # 建叢集 → 建置並載入映像 → 套用 → 等資料庫、migration、滾動更新 → seed
kubectl -n clinic port-forward service/clinic-api 8000:80     # 另一個終端機
SEED_PASSWORD=local-dev-only bash scripts/smoke.sh
bash scripts/kind-down.sh    # 刪掉叢集
```

`k8s/` 是 Kustomize 的 base 與 overlay：

| 路徑 | 內容 |
|---|---|
| `k8s/base/` | 每個環境共用：Deployment、Service、ConfigMap、PodDisruptionBudget、migration Job |
| `k8s/overlays/kind/` | 本機：映像 `clinic-api:<tag>`（`kind load`、`imagePullPolicy: IfNotPresent`）、只供本機的 PostgreSQL 與 Redis、`secretGenerator` 帶本機假值 |
| `k8s/overlays/production/` | 正式環境：registry 的映像（tag 由 CI 設成 commit SHA）、Ingress；資料庫在叢集外，Secret 由叢集管理者建立（`secret.example.yaml` 是範本，不會被套用） |
| `k8s/kind-config.yaml` | kind 叢集的設定（一個節點）；`k8s/kind-config-workers.yaml` 是一個 control plane 加兩個 worker，練 drain 用 |
| `k8s/gateway-api/` | 選讀：Gateway 與 HTTPRoute |

GitHub Actions 的 `kind-deploy` job 每次 push 都在 kind 叢集上跑一遍 `scripts/kind-up.sh`、smoke test 與一次滾動更新，並用 `kubectl apply --dry-run=server` 檢查 `overlays/production` 產生的 manifest。

## 階段 ↔ 檔案

| 階段 | 檔案 | 測試 |
|---|---|---|
| 1 資料表與約束 | `alembic/versions/0001_schema.py`（四張表、約束、`patient_id` 索引）、`clinic/repository/tables.py` | `tests/test_schema.py` |
| 2 掛號規則 | `clinic/domain/rules.py`（`cancel_deadline`、`can_cancel`、`book`）、`clinic/domain/errors.py`、`clinic/domain/models.py` | `tests/test_domain.py` |
| 3 REST 介面 | `clinic/api/routes.py`（`/api` 前綴）、`clinic/api/schemas.py`、`clinic/api/errors.py`（Problem Details）、`clinic/service/booking.py`；冪等鍵是 `alembic/versions/0004_room_idempotency.py` 的 `idempotency_keys` 與 `ClinicRepository.claim_idempotency_key`；契約寫在 `docs/contract.md` | `tests/test_api.py`、`tests/test_contract.py` |
| 4 登入與角色 | `clinic/domain/policy.py`（`POLICY`、`can`）、`clinic/service/auth.py`（Argon2id、JWT）、`clinic/api/deps.py`、`alembic/versions/0002_users.py`、`clinic/seed.py`；列表的權限範圍在 `BookingService.list_visible` 與 `ClinicRepository.list_appointments` | `tests/test_auth.py`、`tests/test_domain.py` |
| 5 同時搶最後一個號 | `alembic/versions/0003_counters_partial_unique.py`（`booked`、`next_no`、`CHECK (booked <= capacity)`、部分唯一索引 `one_active_per_patient`）、`clinic/repository/clinic_repo.py`（`take_number`、`cancel_appointment`、`lock_patient`） | `tests/test_concurrency.py` |
| 6 快取與限流 | `clinic/repository/session_cache.py`（cache-aside）、`clinic/api/rate_limit.py`（Lua token bucket、降級）、`clinic/service/booking.py`（COMMIT 後失效） | `tests/test_cache_ratelimit.py` |
| 7 打包與 CI | `Dockerfile`、`.dockerignore`、`compose.yaml`、`.gitlab-ci.yml`、`pyproject.toml`、`uv.lock`；GitHub 上實際在跑的是 repo 根目錄的 `.github/workflows/companion.yml` | `scripts/smoke.sh` |
| 8 可觀測性 | `clinic/logging_setup.py`（JSON、`request_id`、遮罩）、`clinic/api/middleware.py`、`clinic/api/errors.py`（`request rejected` 的 `reason`：`not-found` 與 `not-visible` 分開）、`clinic/metrics.py`、`clinic/api/routes.py`（`/metrics`、`/healthz`、`/ready`）、`clinic/app.py`（SIGTERM 後 `/ready` 回 503） | `tests/test_observability.py`、`tests/test_contract.py` |
| 9 MCP server | 不做（見下方） | — |
| 10 Kubernetes | `k8s/base/`（`deployment.yaml`、`service.yaml`、`configmap.yaml`、`migrate-job.yaml`、`pdb.yaml`）、`k8s/overlays/production/`（`ingress.yaml`、`secret.example.yaml` 範本，不含真實值）、`k8s/overlays/kind/`、`k8s/kind-config.yaml`、`k8s/kind-config-workers.yaml`、`k8s/gateway-api/`；`.gitlab-ci.yml` 的 `deploy_production`；`scripts/kind-up.sh`、`scripts/kind-down.sh`、[docs/local-k8s.md](docs/local-k8s.md) | GitHub Actions 的 `kind-deploy` job |

前端第 5 階段的報到看板 `GET /api/board` 在 `BookingService.board` 與 `ClinicRepository.board`；診間號碼是 `0004` 加的 `doctors.room`。

分層（依賴方向只有一個）：`clinic/api`（HTTP）→ `clinic/service`（用例、交易邊界、授權）→ `clinic/repository`（SQL、Redis）；`clinic/domain` 是純規則，不 import 框架與資料庫。組裝在 `clinic/app.py` 與 `clinic/api/deps.py`。

**第 9 階段（MCP server）沒有做**：它的前提是用組織既有的 GitLab 當 OAuth 授權伺服器（發現、Authorization Code + PKCE、驗 `aud`），沒有那個 GitLab 就跑不起來，也無從在本機驗證。

## Redis 無法使用時

Redis 的連線與讀寫逾時都是 0.5 秒。連不上或逾時時：

| 功能 | 行為 |
|---|---|
| 診次清單快取 | 當作沒命中，直接查資料庫；寫入與失效略過（fail open） |
| 掛號限流 | 放行（fail open）：掛號是核心功能，不因 Redis 停擺 |
| 登入限流 | 退回這個行程內的 token bucket：比較保守，但每個實例各算各的，實際上限是「實例數 × 上限」 |

每次降級都寫一筆 `WARNING` 日誌並累加 `redis_errors_total{component="cache"|"rate_limit"}`，告警接在這個計數器上。Redis 無法使用期間，資料庫要承受全部的診次查詢，掛號介面沒有限流保護。Redis 恢復後不需要重啟。

## 和瀏覽器版不一樣的地方

- **真的並行**：瀏覽器版只有一條連線；這裡有多連線的並發測試（`tests/test_concurrency.py`）。
- **取號寫在應用程式，不是 SQL 函式**：網站的 `book()`、`cancel()` 是資料庫函式；這裡是 repository 裡同樣內容的 `UPDATE … RETURNING`（`take_number`、`cancel_appointment`），和 `INSERT` 在同一個交易。每日上限照 concurrency.md 的建議，在交易一開始鎖病患那一列。
- **登入**：瀏覽器版只驗 `can()` 與 `scope_filter()`；這裡多一張 `users` 表、Argon2id 密碼雜湊與短效 JWT。token 只帶使用者 id，角色每個請求回資料庫讀，停權立刻生效。
- **病患掛號時 body 帶了別人的 `patient_id`**：回 403，而不是忽略後替自己掛。
- **時區**：用 `zoneinfo.ZoneInfo("Asia/Taipei")`，不是固定 +8。
- **時段的開始時間**：為了算取消期限，上午、下午、晚上診分別當成 08:30、13:30、18:00 開始（網站沒有定義）。取消期限對櫃台也適用。
- **限流在 Redis**：token bucket 是 Lua 腳本、時間用 Redis 的 `TIME`；網站驗收題的 `TokenBucket` 類別保留作為登入限流的降級路徑。
- **指標用 `prometheus_client`**：輸出多了 `_created` 序列，計數值印成 `1.0`；`appointments_booked_total` 的 `result` 多一個 `daily_limit`，另有 `redis_errors_total`。
- **多的錯誤類型**：`invalid-status`（已取消或已報到的掛號再取消、報到）、`idempotency-key-reused`。
- **路徑都在 `/api` 底下**：網站第 3 階段的介面表沒有前綴；這裡和前端課一樣放在 `/api`，前端的 proxy 才不用改寫路徑（見 [docs/contract.md](docs/contract.md)）。
- **報到看板**：網站的後端路線沒有這個介面；這裡照前端第 5 階段的格式加了 `GET /api/board`。系統沒有「叫號」狀態，`current_no` 是已報到的最大號碼。
- **授權拒絕的日誌**：看不到的掛號對外一樣回 404，日誌的 `reason` 是 `not-visible`（WARNING），和真的不存在的 `not-found`（INFO）分開。
- **依賴管理**：`pyproject.toml` + `uv.lock`，不是 `requirements.txt` + pip；映像裡的 venv 在 `/app/.venv`，`USER` 寫成數字 `10001`（網站 k8s.md 提到的 `runAsNonRoot` 問題）。
- **SQLAlchemy 版本**：`uv.lock` 鎖到的是 2.1.x，寫法是 2.0 風格（`Mapped`、`select()`）。
- **Kubernetes 的 manifest 分成 Kustomize 的 base 與 overlay**：網站第 10 階段的 `k8s/` 是一層目錄，deploy job 用 `sed` 代換 `__SHA__`、再 `kubectl set image`。這裡 deploy job 用 `kustomize edit set image` 設定 tag，migration Job 的名稱由 overlay 的 `replacements` 接上同一個 tag（`clinic-migrate-<SHA>`），先只套用 Job、等它完成，再套用全部。`kustomize edit` 只改 CI 工作目錄裡的檔案，Git 裡的 `newTag` 一直是示意值：不要從自己的電腦直接 `kubectl apply -k k8s/overlays/production`，那會把映像換成示意的 tag。要讓 Git 記下正式環境實際的 tag，是 GitOps 的做法（CI 把 tag commit 回設定 repo，見網站的 Helm、Kustomize 與 GitOps 一課）。

## 已知限制

- **追蹤沒有做**：沒有 OpenTelemetry、不處理 `traceparent`，日誌裡沒有 `trace_id`。
- **冪等鍵只用在掛號**，只記住 201 的結果，紀錄留 24 小時；過期的列在同一個使用者再用同一個鍵時才刪，沒有定期清理。
- **診次清單不帶 `date` 時沒有上限**：前端一定帶日期，但契約允許省略（站上的假 API 與題目都這樣用）；資料量大時要改成必填或加分頁。
- **報到看板依伺服器的時鐘切時段**（13:30、18:00），一個診次一列；同一位醫師同一個時段開兩個診次時會有兩列同一個診間。
- **沒有管理介面**：醫師、病患、診次、帳號只能用 seed 或直接寫資料庫建立；沒有登出、refresh token、改密碼。JWT 是 HS256 共用密鑰，個別 token 在到期前無法撤銷（停用帳號可以）。
- **登入限流只看帳號**，不看 IP；有人可以故意讓某個帳號暫時登不進去。
- **快取**：沒有防擊穿的鎖，TTL 沒有加隨機；「提交前讀到舊值、失效後才寫回」的小視窗存在，舊值最多留 30 秒。剩餘名額只供顯示。
- **400 可能早於 401**：FastAPI 先解析 body 才執行驗證身分的 dependency，沒帶 token 又送出不是 JSON 的 body 時回 400。
- **Redis 沒有斷路器**：Redis 整台沒回應（不是拒絕連線）時，每個相關請求會多等最多 0.5 秒 × Redis 呼叫次數。
- **`/metrics` 是每個行程各自一份**：多個副本時由 Prometheus 逐一抓取；不要用多個 uvicorn worker 共用一個 port。
- **正式環境的部署沒有在真的 GitLab 與叢集上跑過**：`k8s/overlays/kind` 每次 push 都在 GitHub Actions 的 kind 叢集上實際套用；`k8s/overlays/production` 只驗證到 `kubectl apply --dry-run=server`。`deploy_production` 用的映像（要有 kubectl 與 kustomize）、registry 位址、IngressClass、`clinic-tls` 憑證都要換成實際環境的值；namespace `clinic` 與 Secret `clinic-api-secret` 要由叢集管理者先建立。`overlays/production` 的 `replacements` 從映像位址取第一個冒號後面那一段當 tag，registry 主機帶 port 時要改設定（見檔案裡的註解）。
- **`.gitlab-ci.yml` 的位置**：GitLab 只讀專案根目錄的那一份；把這個目錄獨立成一個 GitLab 專案時才會生效。
- **migration 只有往前的版本經過完整測試**；`downgrade` 寫了，只驗證過能從 head 退回空的資料庫。

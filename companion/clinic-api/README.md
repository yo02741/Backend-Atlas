# clinic-api：門診掛號後端（可以在本機跑起來的版本）

Backend Atlas「實作路線：從零做完一個門診掛號後端」的參考實作。網站上每個階段的驗收題在瀏覽器裡跑（PGlite、Pyodide）；這個專案把同一套資料表、規則、介面接成一個真的服務：FastAPI + SQLAlchemy + Alembic + PostgreSQL 16 + Redis，用 uv 管理依賴。

範例資料全部是虛構的。

## 前置需求

| 用途 | 需要 |
|---|---|
| 把服務跑起來 | Docker（含 `docker compose`） |
| 跑測試、lint、在主機上直接啟動 | [uv](https://docs.astral.sh/uv/)（會依 `.python-version` 準備 Python 3.12）、一個 PostgreSQL 16 與一個 Redis（可以直接用 compose 起的那兩個） |
| 貼下面的 curl 範例 | `curl`、`python3`（只用來從 JSON 取欄位） |

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

seed 會印出帳號（`patient1`、`patient2`、`desk1`、`doctor1`）、林醫師的 `doctor_id` 與診次日期（執行當天的 7 天後）。不給 `SEED_PASSWORD` 時會隨機產生一組密碼並印出一次。

結束：`docker compose down`（加 `-v` 連資料庫的 volume 一起刪除）。

`compose.yaml` 裡的資料庫密碼與 `JWT_SECRET` 是寫在檔案裡的開發用假值，僅供本機。

## curl 範例

```bash
BASE=http://127.0.0.1:8000
field() { python3 -c "import json,sys; print(json.load(sys.stdin)$1)"; }

# 健康檢查與指標：不需要登入
curl -s $BASE/healthz
curl -s $BASE/ready
curl -s $BASE/metrics | grep appointments_booked_total

# 登入（病患），拿到 15 分鐘有效的 token
TOKEN=$(curl -s $BASE/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"patient1","password":"local-dev-only"}' | field "['access_token']")

# 查林醫師那一天的診次與剩餘名額（日期用 seed 印出的那一天）
DAY=$(python3 -c "from datetime import *; print((datetime.now(timezone(timedelta(hours=8))) + timedelta(days=7)).date())")
curl -s "$BASE/sessions?doctor_id=1&date=$DAY" -H "Authorization: Bearer $TOKEN"

# 掛號：病患替自己掛，body 是空物件；回 201、Location 標頭與號碼
curl -si -X POST $BASE/sessions/1/appointments -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{}'

# 再掛一次：409，type 以 already-booked 結尾，Content-Type 是 application/problem+json
curl -si -X POST $BASE/sessions/1/appointments -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{}'

# 列出自己的掛號、取消
curl -s $BASE/appointments -H "Authorization: Bearer $TOKEN"
curl -s -X POST $BASE/appointments/1/cancel -H "Authorization: Bearer $TOKEN"

# 櫃台替病患 2 掛號，然後報到
DESK=$(curl -s $BASE/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"desk1","password":"local-dev-only"}' | field "['access_token']")
curl -s -X POST $BASE/sessions/1/appointments -H "Authorization: Bearer $DESK" \
  -H 'Content-Type: application/json' -d '{"patient_id": 2}'
curl -s -X POST $BASE/appointments/2/check-in -H "Authorization: Bearer $DESK"

# 連續送 6 次掛號：每位使用者的 token（容量 5、每 6 秒補 1 個）用完之後回 429 與 Retry-After
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/sessions/2/appointments \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'
done

# 日誌：一行一筆 JSON，同一個請求的紀錄有相同的 request_id
docker compose logs api --no-log-prefix | tail -5
```

範例裡的 id（診次 1、2，掛號 1、2）以剛跑完 seed 的資料庫為準。

`scripts/smoke.sh` 把上面的主要流程寫成會檢查狀態碼的腳本：`SEED_PASSWORD=local-dev-only bash scripts/smoke.sh`。OpenAPI 文件在 `http://127.0.0.1:8000/docs`。

## 介面

| 方法與路徑 | 用途 | 成功 | 主要錯誤 |
|---|---|---|---|
| `POST /auth/login` | 帳號密碼換 Bearer token | 200 | 401、422、429 |
| `GET /sessions?doctor_id=&date=` | 某醫師某天的診次與剩餘名額（快取 30 秒） | 200 | 401、422 |
| `POST /sessions/{id}/appointments` | 掛號 | 201 + `Location` | 400、401、403、404、409、422、429 |
| `GET /appointments/{id}` | 查一筆掛號 | 200 | 401、404 |
| `GET /appointments?patient_id=&cursor=&limit=` | 列出看得到的掛號（cursor 分頁） | 200 | 401、422 |
| `POST /appointments/{id}/cancel` | 取消 | 200 | 401、403、404、409 |
| `POST /appointments/{id}/check-in` | 報到（櫃台） | 200 | 401、403、404、409 |
| `GET /healthz`、`GET /ready`、`GET /metrics` | liveness、readiness、Prometheus 指標 | 200 | `/ready`：503 |

錯誤 body 一律是 Problem Details（RFC 9457）。409 的 `type` 結尾：`already-booked`、`session-full`、`daily-limit`、`cancel-deadline-passed`、`invalid-status`。

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
```

`tests/test_concurrency.py` 用 20 個執行緒、各自一條資料庫連線，在同一個 barrier 後同時送出掛號，驗證：剩 3 個名額時剛好發出 3 個不重複的號碼、其他人收到 `SessionFull`；同一位病患同時掛同一診次只有一筆成功；同一位病患同時掛同一天 6 個診次剛好 3 個成功；同時取消同一筆掛號 `booked` 只減一次。每個測試最後都跑對帳查詢，確認 `sessions.booked` 與實際有效掛號數一致。

在主機上直接啟動（不用容器）：設定好 `DATABASE_URL`、`REDIS_URL`、`JWT_SECRET` 後 `uv run uvicorn clinic.main:app --no-access-log`。

## 階段 ↔ 檔案

| 階段 | 檔案 | 測試 |
|---|---|---|
| 1 資料表與約束 | `alembic/versions/0001_schema.py`（四張表、約束、`patient_id` 索引）、`clinic/repository/tables.py` | `tests/test_schema.py` |
| 2 掛號規則 | `clinic/domain/rules.py`（`cancel_deadline`、`can_cancel`、`book`）、`clinic/domain/errors.py`、`clinic/domain/models.py` | `tests/test_domain.py` |
| 3 REST 介面 | `clinic/api/routes.py`、`clinic/api/schemas.py`、`clinic/api/errors.py`（Problem Details）、`clinic/service/booking.py` | `tests/test_api.py` |
| 4 登入與角色 | `clinic/domain/policy.py`（`POLICY`、`can`）、`clinic/service/auth.py`（Argon2id、JWT）、`clinic/api/deps.py`、`alembic/versions/0002_users.py`、`clinic/seed.py`；列表的權限範圍在 `BookingService.list_visible` 與 `ClinicRepository.list_appointments` | `tests/test_auth.py`、`tests/test_domain.py` |
| 5 同時搶最後一個號 | `alembic/versions/0003_counters_partial_unique.py`（`booked`、`next_no`、`CHECK (booked <= capacity)`、部分唯一索引 `one_active_per_patient`）、`clinic/repository/clinic_repo.py`（`take_number`、`cancel_appointment`、`lock_patient`） | `tests/test_concurrency.py` |
| 6 快取與限流 | `clinic/repository/session_cache.py`（cache-aside）、`clinic/api/rate_limit.py`（Lua token bucket、降級）、`clinic/service/booking.py`（COMMIT 後失效） | `tests/test_cache_ratelimit.py` |
| 7 打包與 CI | `Dockerfile`、`.dockerignore`、`compose.yaml`、`.gitlab-ci.yml`、`pyproject.toml`、`uv.lock`；GitHub 上實際在跑的是 repo 根目錄的 `.github/workflows/companion.yml` | `scripts/smoke.sh` |
| 8 可觀測性 | `clinic/logging_setup.py`（JSON、`request_id`、遮罩）、`clinic/api/middleware.py`、`clinic/metrics.py`、`clinic/api/routes.py`（`/metrics`、`/healthz`、`/ready`）、`clinic/app.py`（SIGTERM 後 `/ready` 回 503） | `tests/test_observability.py` |
| 9 MCP server | 不做（見下方） | — |
| 10 Kubernetes | `k8s/deployment.yaml`、`service.yaml`、`ingress.yaml`、`configmap.yaml`、`secret.example.yaml`（範本，不含真實值）、`migrate-job.yaml`、`pdb.yaml`；`.gitlab-ci.yml` 的 `deploy_production` | — |

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
- **多的錯誤類型**：`invalid-status`（已取消或已報到的掛號再取消、報到）。
- **依賴管理**：`pyproject.toml` + `uv.lock`，不是 `requirements.txt` + pip；映像裡的 venv 在 `/app/.venv`，`USER` 寫成數字 `10001`（網站 k8s.md 提到的 `runAsNonRoot` 問題）。
- **SQLAlchemy 版本**：`uv.lock` 鎖到的是 2.1.x，寫法是 2.0 風格（`Mapped`、`select()`）。

## 已知限制

- **追蹤沒有做**：沒有 OpenTelemetry、不處理 `traceparent`，日誌裡沒有 `trace_id`。
- **沒有冪等鍵**：重送掛號請求會收到 409 `already-booked`，不會回原本那個 201。
- **沒有管理介面**：醫師、病患、診次、帳號只能用 seed 或直接寫資料庫建立；沒有登出、refresh token、改密碼。JWT 是 HS256 共用密鑰，個別 token 在到期前無法撤銷（停用帳號可以）。
- **登入限流只看帳號**，不看 IP；有人可以故意讓某個帳號暫時登不進去。
- **快取**：沒有防擊穿的鎖，TTL 沒有加隨機；「提交前讀到舊值、失效後才寫回」的小視窗存在，舊值最多留 30 秒。剩餘名額只供顯示。
- **400 可能早於 401**：FastAPI 先解析 body 才執行驗證身分的 dependency，沒帶 token 又送出不是 JSON 的 body 時回 400。
- **Redis 沒有斷路器**：Redis 整台沒回應（不是拒絕連線）時，每個相關請求會多等最多 0.5 秒 × Redis 呼叫次數。
- **`/metrics` 是每個行程各自一份**：多個副本時由 Prometheus 逐一抓取；不要用多個 uvicorn worker 共用一個 port。
- **`.gitlab-ci.yml` 與 `k8s/` 沒有在真的 GitLab 與叢集上跑過**：通過的是網站驗收題的規則檢查與 YAML 解析。`deploy_production` 用的 kubectl 映像、registry 位址、IngressClass、`clinic-tls` 憑證都要換成實際環境的值；第一次部署要先手動 `kubectl apply -f k8s/deployment.yaml`，之後 CI 才用 `kubectl set image` 換版。
- **`.gitlab-ci.yml` 的位置**：GitLab 只讀專案根目錄的那一份；把這個目錄獨立成一個 GitLab 專案時才會生效。
- **migration 只有往前的版本經過完整測試**；`downgrade` 寫了，只驗證過能從 head 退回空的資料庫。

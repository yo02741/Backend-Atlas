## 從一個具體問題開始：`docker compose up`，api 起來就死

一個專案的 `compose.yaml` 有兩個服務：API 和 PostgreSQL。API 的設定是從本機開發時沿用下來的：

```yaml
services:
  api:
    build: .
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql://app:devpass@localhost:5432/app
    depends_on:
      - db
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: devpass
      POSTGRES_DB: app
```

`docker compose up` 之後，API 的 log：

```text
api-1  | psycopg.OperationalError: connection failed: connection to server at "127.0.0.1", port 5432 failed: Connection refused
api-1  | 	Is the server running on that host and accepting TCP/IP connections?
api-1 exited with code 1
```

這裡有兩個問題疊在一起：

1. **`localhost` 指的是 API 容器自己**。每個容器有自己的網路空間，API 容器裡沒有 PostgreSQL。要連的是名叫 `db` 的那個服務。
2. 改成 `@db:5432` 之後，第一次啟動有時還是會失敗，錯誤變成 `Connection refused` 到 `db` 的 IP。`depends_on` 讓 db 容器**先被啟動**，但 PostgreSQL 第一次啟動要初始化資料目錄，需要幾秒才開始接受連線，API 已經先去連了。

這一課依序講 compose 的模型、網路與 DNS、volume、`depends_on` 與 healthcheck、環境變數與 `.env`、profiles，最後是開發與正式環境的差別。[ComposeLab](#/lab/ComposeLab) 把網路拓樸與啟動順序畫成圖，可以搭配著看。

## compose 的模型：一個專案、幾個服務、一張網路

```text
專案 shop（預設取資料夾名稱）
└─ 網路 shop_default
   ├─ 服務 nginx  → 容器 shop-nginx-1   主機 :80 → 容器 :80
   ├─ 服務 api    → 容器 shop-api-1     只在網路內，api:8000
   ├─ 服務 db     → 容器 shop-db-1      只在網路內，db:5432
   │                └─ volume shop_pgdata 掛在資料目錄
   └─ 服務 redis  → 容器 shop-redis-1   只在網路內，redis:6379
```

- **服務**（service）是一種容器的設定：用哪個 image 或怎麼 build、環境變數、掛載、埠。一個服務可以跑多個副本（`--scale api=3`），容器名稱的最後一段就是副本編號。
- **專案**（project）把一份 compose 檔裡的東西包在一起，名稱預設是資料夾名稱，可以用 `-p` 或頂層的 `name:` 指定。網路、volume、容器的名字都會加上專案名稱當前綴，兩個專案互不干擾。
- 沒有特別設定時，compose 為專案建一張**預設網路**，所有服務都接上去。

現行的工具是 Docker CLI 的子命令 `docker compose`（Compose v2），檔名慣例是 `compose.yaml`（`docker-compose.yml` 也仍會被讀取）。舊的獨立程式 `docker-compose`（v1）已停止維護。

## 網路：服務名就是 hostname

compose 網路裡有 Docker 內建的 DNS。每個服務名都會解析成那個服務的容器 IP，所以 API 用 `db` 就能找到資料庫：

```yaml
environment:
  DATABASE_URL: postgresql://app:devpass@db:5432/app
  REDIS_URL: redis://redis:6379/0
```

容器重建後 IP 可能改變，名字不會，所以永遠用名字連。服務有多個副本時，這個名字會解析出多個 IP。

「從哪裡連到哪裡、用什麼位址」是 compose 最常搞混的地方：

| 從 | 連到 | 位址 | 條件 |
|---|---|---|---|
| api 容器 | db 容器 | `db:5432` | 同一張網路；用**容器內的埠** |
| api 容器 | api 自己 | `localhost:8000` | 只有自己 |
| 主機（瀏覽器、psql、測試） | db 容器 | `localhost:5433` | db 有 `ports: ["5433:5432"]`；用**主機上發布的埠** |
| 主機 | db 容器 | 連不到 | db 沒有 `ports` |
| api 容器 | 主機上的服務 | `host.docker.internal` | Docker Desktop 內建；Linux 上要加 `extra_hosts: ["host.docker.internal:host-gateway"]` |

`ports` 與 `expose` 的差別：

```yaml
db:
  ports:
    - "127.0.0.1:5433:5432"   # 發布到主機：主機的 127.0.0.1:5433 → 容器的 5432；開發時讓本機工具能連
api:
  expose:
    - "8000"                  # 只是文件性質的宣告：同網路的容器本來就連得到，不會發布到主機
```

只寫 `"5432:5432"` 會綁在主機的**所有網路介面**上；在一台有公網 IP 的機器上，這等於把資料庫開給全世界（Docker 發布的埠也可能繞過主機上 `ufw` 這類防火牆的規則，不能依賴主機防火牆擋住）。開發時加 `127.0.0.1:` 前綴；正式環境的資料庫不發布埠。

需要隔離時可以自訂多張網路，例如 nginx 只接 `frontend`、db 只接 `backend`、api 兩張都接，nginx 就連不到 db：

```yaml
services:
  nginx:
    networks: [frontend]
  api:
    networks: [frontend, backend]
  db:
    networks: [backend]
networks:
  frontend:
  backend:
```

## volume：讓資料活過重建

```yaml
services:
  db:
    image: postgres:16
    volumes:
      - pgdata:/var/lib/postgresql/data       # named volume：資料庫檔案
      - ./db/init:/docker-entrypoint-initdb.d:ro   # bind mount：初始化腳本，唯讀
  api:
    volumes:
      - ./app:/app/app                        # bind mount：開發時把程式碼掛進去，改了立刻生效
volumes:
  pgdata:                                     # 頂層宣告 named volume
```

| 指令 | 容器 | 網路 | named volume |
|---|---|---|---|
| `docker compose stop` | 停止（保留） | 保留 | 保留 |
| `docker compose down` | 刪除 | 刪除 | **保留** |
| `docker compose down -v` | 刪除 | 刪除 | **刪除** |

PostgreSQL 官方映像有一個和 volume 相關的行為常讓人困惑：`POSTGRES_PASSWORD`、`POSTGRES_DB` 與 `/docker-entrypoint-initdb.d` 裡的腳本，**只在資料目錄是空的時候**（第一次啟動）才生效。之後改了密碼再 `up`，資料庫裡的密碼還是舊的，API 會得到 `password authentication failed`。開發環境要重來就 `down -v`（資料會清空）；要保留資料就進資料庫用 `ALTER USER` 改。（資料目錄的路徑可能隨映像大版本調整，換版本時以映像說明為準。）

## `depends_on` 只保證順序，不保證就緒

`depends_on: [db]` 的意思是「先建立並啟動 db 容器，再啟動 api」，判斷標準是**容器啟動了**，不是**資料庫可以接受連線**。PostgreSQL 容器啟動後，還要初始化（第一次）、做復原、開始監聽，這段時間連過去就是 `Connection refused`。

要等到真的就緒，給 db 一個 healthcheck，api 用長格式的 `depends_on` 指定條件：

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?請在 .env 設定 POSTGRES_PASSWORD}
      POSTGRES_DB: app
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]   # 能接受連線時退出碼為 0
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s       # 啟動寬限期：這段時間內的失敗不計入 retries

  migrate:
    build: .
    command: ["alembic", "upgrade", "head"]   # 一次性工作：跑完就結束
    depends_on:
      db:
        condition: service_healthy

  api:
    build: .
    depends_on:
      db:
        condition: service_healthy                    # 等 healthcheck 通過
      migrate:
        condition: service_completed_successfully     # 等 migration 成功跑完（退出碼 0）
      redis:
        condition: service_started                    # 只要啟動就好（等同短格式）
```

| condition | 等到什麼時候 |
|---|---|
| `service_started` | 容器啟動（短格式 `depends_on: [db]` 就是這個） |
| `service_healthy` | 該服務的 healthcheck 回報 healthy |
| `service_completed_successfully` | 該服務的容器執行完畢且退出碼為 0 |

依賴的服務一直不健康，`up` 會失敗，訊息類似 `dependency failed to start: container shop-db-1 is unhealthy`。

這只解決**啟動那一刻**。資料庫之後重啟、網路瞬斷，API 一樣會遇到連線失敗。應用程式本身仍然要有連線重試與連線池的健康檢查，正式環境（Kubernetes、雲端容器平台）也沒有 `depends_on` 這種東西。

下面用一段模擬比較兩種寫法的啟動時間線，可以直接執行：

```python run
# 模擬 compose 啟動：db 容器在 t=0 啟動，PostgreSQL 要初始化 ready_after 秒才開始接受連線
def start(ready_after, wait_for_healthy, interval=1, retries=10):
    log = ["t=0s   db 容器啟動（初始化中）"]
    t = 0
    if wait_for_healthy:
        for attempt in range(1, retries + 1):
            t += interval
            healthy = t >= ready_after
            log.append(f"t={t}s   healthcheck #{attempt}：pg_isready {'成功' if healthy else '失敗'}")
            if healthy:
                break
        else:
            log.append(f"t={t}s   db 一直不健康：dependency failed to start")
            return log
    else:
        t += 0.2      # service_started：容器一啟動就算數
    ok = t >= ready_after
    log.append(f"t={t}s   api 啟動並連線 db:5432 -> {'成功' if ok else 'Connection refused，api 退出'}")
    return log

for name, healthy in [("depends_on: [db]", False), ("condition: service_healthy", True)]:
    print(name)
    print("\n".join("  " + line for line in start(ready_after=4, wait_for_healthy=healthy)))
```

## 環境變數與 `.env`

compose 裡跟環境變數有關的東西有三種，最常混淆的是第一種：

| 東西 | 作用 | 會不會進到容器 |
|---|---|---|
| 專案目錄的 `.env` 檔 | 給 **compose 檔本身**做變數替換：`${POSTGRES_PASSWORD}` | **不會**自動進入容器 |
| 服務的 `environment:` | 直接設定容器的環境變數 | 會 |
| 服務的 `env_file:` | 從檔案讀環境變數給容器 | 會 |

```yaml
services:
  api:
    image: registry.example.com/shop/api:${API_TAG:-dev}   # 沒設定時用 dev
    env_file:
      - ./config/api.env          # 一般設定
    environment:
      DATABASE_URL: postgresql://app:${POSTGRES_PASSWORD:?missing}@db:5432/app
      LOG_LEVEL: ${LOG_LEVEL:-info}
```

- `${VAR:-預設值}`：沒設定或空字串時用預設值。
- `${VAR:?錯誤訊息}`：沒設定時直接報錯，compose 不會啟動。必填的秘密用這個，避免空密碼。
- 替換時的優先順序：執行 `docker compose` 的 shell 環境變數，優先於 `.env` 檔裡的值。CI 裡可以直接用環境變數覆寫。

搞不清楚最後到底用了什麼值時，看 compose 解析完的結果：

```bash
docker compose config                 # 印出合併、替換後的完整設定（會包含秘密的實際值，別貼到公開的地方）
docker compose exec api env | sort    # 容器裡實際拿到的環境變數
```

`.env` 放的是本機的值（密碼、個人的設定），**不進版本控制**；另外 commit 一份 `.env.example` 列出需要哪些變數。設定的設計原則見 [環境設定與 12-factor](#/skill/config-12factor)。

compose 也有 `secrets:`，把檔案以唯讀的方式掛到容器的 `/run/secrets/<名稱>`，不經過環境變數（環境變數會出現在 `docker inspect` 的輸出裡）。PostgreSQL 這類官方映像支援 `POSTGRES_PASSWORD_FILE` 這種「從檔案讀」的變數：

```yaml
services:
  db:
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    secrets: [db_password]
secrets:
  db_password:
    file: ./secrets/db_password.txt
```

## profiles：不是每次都要起的服務

管理介面、寄信測試伺服器、一次性的資料匯入工具，平常不需要跑。給它們一個 profile：

```yaml
services:
  pgadmin:
    image: dpage/pgadmin4
    profiles: ["tools"]
    ports:
      - "127.0.0.1:5050:80"
  seed:
    build: .
    command: ["python", "-m", "app.seed"]
    profiles: ["tools"]
    depends_on:
      db:
        condition: service_healthy
```

沒有 `profiles` 的服務永遠會啟動；有 profile 的服務只在指定時才啟動：

```bash
docker compose up -d                          # 只起 api、db、redis…
docker compose --profile tools up -d          # 連 pgadmin、seed 一起起
docker compose run --rm seed                  # 明確指定服務名時，不必啟用它的 profile
```

## 常用指令

```bash
docker compose up -d                  # 背景啟動（需要時先 build）
docker compose up -d --build api      # 重建 api 的 image 再啟動
docker compose ps                     # 每個服務的狀態、健康狀態、埠
docker compose logs -f api            # 追 api 的 log；不指定服務就是全部
docker compose exec db psql -U app    # 在執行中的 db 容器裡開 psql
docker compose run --rm api pytest    # 用 api 的設定起一個一次性容器跑指令
docker compose restart api
docker compose down                   # 停止並刪除容器與網路（volume 保留）
docker compose pull                   # 拉最新的 image（正式環境部署前）
```

## 開發環境與正式環境

compose 會自動合併 `compose.yaml` 與同目錄的 `compose.override.yaml`。慣例是 `compose.yaml` 放共同的部分，override 放本機開發才要的東西；正式環境用 `-f` 明確指定另一份：

```yaml
# compose.override.yaml：只在本機開發時（自動）套用
services:
  api:
    build: .
    command: ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--reload"]   # 改檔自動重載
    volumes:
      - ./app:/app/app          # 程式碼掛進去
    ports:
      - "127.0.0.1:8000:8000"
    environment:
      LOG_LEVEL: debug
  db:
    ports:
      - "127.0.0.1:5433:5432"   # 讓本機的 psql、IDE 能連
```

```yaml
# compose.prod.yaml：docker compose -f compose.yaml -f compose.prod.yaml up -d
services:
  api:
    image: registry.example.com/shop/api:${API_TAG:?需要指定版本}   # 用 CI 建好的 image，不在主機上 build
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 512m
    logging:
      driver: json-file
      options:
        max-size: "10m"         # 預設的 json-file 不輪替，log 會一直長到磁碟滿
        max-file: "5"
  db:
    restart: unless-stopped
```

| 面向 | 開發 | 正式 |
|---|---|---|
| image 來源 | `build: .` | 指定 tag 的 registry image，和 staging 測過的是同一個 |
| 程式碼 | bind mount 掛進去，`--reload` | 在 image 裡，不掛載 |
| 資料庫埠 | 發布到 `127.0.0.1`，方便工具連線 | 不發布 |
| 重啟策略 | 不需要 | `restart: unless-stopped` |
| 資源與 log | 不限制 | 設記憶體上限、log 輪替 |
| 秘密 | `.env` | 檔案權限受控的 `.env` 或 `secrets:`；不進版本控制 |

compose 適合本機開發、CI 的整合測試，以及單台主機的小型正式環境。它不負責跨多台主機的排程、滾動更新、自動擴縮；需要這些時看 [導入 Kubernetes 前要準備什麼](#/skill/k8s-readiness)。Compose v2 還有 `docker compose watch`（在服務設定 `develop.watch`），可以在檔案變動時同步進容器或重建，取代部分 bind mount 的用法。

## 常見錯誤與錯誤訊息

| 訊息 | 原因 | 怎麼修 |
|---|---|---|
| `connection to server at "127.0.0.1", port 5432 failed: Connection refused` | 在容器裡連 `localhost`，連到的是自己 | 改用服務名 `db` |
| `could not translate host name "db" to address: Name or service not known` | 這個程式不在 compose 網路裡（例如直接在主機上跑測試），或兩個服務不在同一張網路 | 在主機上就連 `localhost:<發布的埠>`；或檢查 `networks:` |
| 第一次 `up` 偶爾 `Connection refused`，重跑就好 | `depends_on` 沒等到就緒 | 加 healthcheck 與 `condition: service_healthy`，應用程式也要重試 |
| `password authentication failed for user "app"` | volume 裡是舊的資料庫，改過的 `POSTGRES_PASSWORD` 不會生效 | `down -v` 重來（資料清空），或用 `ALTER USER` 改密碼 |
| `Bind for 0.0.0.0:5432 failed: port is already allocated` | 主機上已經有東西在用 5432（常見是本機裝的 PostgreSQL） | 換主機埠 `"127.0.0.1:5433:5432"` |
| `required variable POSTGRES_PASSWORD is missing a value` 之類 | `${VAR:?}` 必填的變數沒設定 | 在 `.env` 或 shell 環境設定 |
| 設在 `.env` 的變數，容器裡讀不到 | `.env` 只用於 compose 檔的替換 | 用 `environment:` 引用它，或用 `env_file:` |
| `yaml: line 12: mapping values are not allowed in this context` | YAML 縮排或冒號錯誤 | 檢查那一行附近的縮排（只能用空白，不能用 tab） |
| `dependency failed to start: container shop-db-1 is unhealthy` | db 的 healthcheck 一直失敗 | `docker compose logs db`、`docker inspect` 看 healthcheck 的輸出；檢查 test 指令的帳號、資料庫名 |
| 改了程式碼，容器裡還是舊的 | 沒有掛載程式碼，用的是之前 build 的 image | `docker compose up -d --build`，或開發時掛載程式碼 |

## 動手

1. 開 [ComposeLab](#/lab/ComposeLab)，打開「db 沒 ready（啟動慢）」、關掉「condition: service_healthy」逐步啟動，看 api 在什麼時候連線失敗；再打開 service_healthy 比較。
2. 在 Playground 開啟啟動時間線那段，把 `ready_after` 改成 15，看 `retries=10` 的 healthcheck 會怎樣；再把 `interval` 改成 2 比較。真實的 compose 可以用 `start_period` 讓啟動期間的失敗不計入次數，想想資料庫第一次初始化要多久、該怎麼設。
3. 在本機寫一份 api + db + redis 的 compose，api 的 `/health` 回傳它連 db 的結果。故意把 `DATABASE_URL` 寫成 `localhost`，對照錯誤訊息；改回 `db` 再試。
4. `docker compose down` 再 `up`，確認資料還在；接著 `down -v` 再 `up`，確認資料消失、初始化腳本重新執行。
5. 加上 nginx 站在最前面、只有它發布埠，設定方式見 [nginx 反向代理](#/skill/nginx)。

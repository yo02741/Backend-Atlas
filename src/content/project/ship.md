## 這階段要做出什麼

到目前為止，系統只存在於開發者的電腦上。這一階段產出兩個檔案：

- **Dockerfile**：把 API 打包成映像，任何一台有容器執行環境的機器都能用同一個映像啟動
- **.gitlab-ci.yml**：每次 push 自動跑 lint 與測試（帶一個真的 PostgreSQL），main 分支通過後建置映像、推到 registry、部署

```
push ──► lint ──► test（+ postgres service）──► build（推 $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA）──► deploy（只有 main）
```

任何一個 stage 失敗，後面的 stage 不會執行：沒通過測試的程式不會變成映像，更不會被部署。

Dockerfile 的寫法在 [幫 Python 專案寫好 Dockerfile](#/skill/dockerfile-python)；管線的設計在 [CI 管線：lint、test、build](#/skill/ci-pipeline)；GitLab 的語法細節在 [GitLab CI/CD](#/skill/gitlab-cicd)。

## Dockerfile 的設計決策

### 基底映像：slim，而且固定版本

`python:3.12-slim` 是 Debian 精簡版加上 Python，比完整版小很多，又保留 glibc，絕大多數套件都有預編譯好的 wheel 可以直接安裝。Alpine 更小，但用的是 musl，部分套件在 Alpine 上沒有預編譯的 wheel，安裝時要從原始碼編譯，反而更慢、映像更大。

版本要固定：`python:latest` 會隨著 Python 新版發布而指向不同的版本，同一個 Dockerfile 在不同時間建出不同的東西，測試通過的映像和正式部署的映像可能不是同一個 Python。`python:3.12-slim` 固定到小版本；更嚴格的做法是固定 digest（`python:3.12-slim@sha256:…`），tag 可以被重新指向，digest 不會。固定之後要有人負責更新（安全修補），可以交給 Renovate 或 Dependabot 這類工具開 merge request。

### 多階段：建置工具不進正式映像

```
建置階段 build：python:3.12-slim + pip install → /opt/venv
執行階段：      python:3.12-slim + COPY --from=build /opt/venv + 程式碼
```

建置時可能需要編譯器、標頭檔、pip 的快取，這些都不該出現在正式映像裡：映像越小，拉取越快，可被利用的東西也越少。用 venv 的好處是整個環境在一個目錄裡，`COPY --from=build /opt/venv /opt/venv` 一行就搬完；前提是兩個階段的基底映像相同（Python 版本與路徑一致）。

### 層的順序決定快取

先 `COPY requirements.txt` 再 `pip install`，最後才 `COPY clinic/`。改程式碼時，前面安裝套件那一層可以直接用快取；如果先 `COPY . .` 再安裝，每改一行程式都要重裝所有套件。

### 不用 root 執行

容器裡的 root 和主機上的 root 並不相同，但容器逃逸類的漏洞通常需要容器內有較高的權限。建一個固定 UID 的使用者（`useradd --uid 10001 app`），最後 `USER app`。程式需要寫入的目錄（如果有）要在切換使用者之前建立並設定擁有者。

### 祕密與 .env 不進映像

映像會被推到 registry、被很多人和機器拉取，每一層的內容都看得到（`docker history` 看得到 `ENV` 與 `ARG`）。所以：

- 資料庫連線字串、API key 在**執行時**用環境變數或平台的祕密管理注入
- `.env` 只給本機開發用，必須在 `.dockerignore` 裡排除；更保險的做法是不用 `COPY . .`，明確列出要複製的檔案
- 建置時真的需要祕密（例如從私有套件庫安裝），用 BuildKit 的 `RUN --mount=type=secret`，祕密只在那一步可見、不會留在層裡

`.dockerignore` 至少包含：

```
.env
.git
__pycache__/
*.pyc
.venv/
tests/
```

### CMD 用 exec 形式

`CMD uvicorn …`（shell 形式）實際上是 `/bin/sh -c "uvicorn …"`，PID 1 是 shell。`docker stop` 送出的 SIGTERM 送到 shell，shell 不一定會轉給 uvicorn，等逾時（預設 10 秒）後容器被強制終止，進行中的請求就斷了。`CMD ["uvicorn", …]`（exec 形式）讓 uvicorn 直接是 PID 1，能收到 SIGTERM 並優雅關閉。

### 資料庫遷移在哪裡跑

在 `CMD` 裡先跑 migration 再啟動 API，看起來方便，但同時啟動三個副本時，三個都會嘗試遷移。比較穩的做法是把遷移做成部署流程裡獨立的一步（例如 deploy job 先執行一次 migration 指令，成功後才更新服務）。

## CI 的設計決策

### 測試要碰真的 PostgreSQL

第 5 階段的取號靠的是 PostgreSQL 的行為（`UPDATE … RETURNING`、部分唯一索引），用 SQLite 或 mock 測不出來。GitLab 的 `services` 會在 job 旁邊啟動一個容器：

- service 的主機名稱預設由映像名稱而來，`postgres:16` 就是 `postgres`，所以 `DATABASE_URL` 寫 `@postgres:5432`，不是 `localhost`
- job 的 `variables` 也會傳給 service，`POSTGRES_PASSWORD` 寫在 job 裡就能設定資料庫的密碼
- 這個資料庫在 job 結束後就消失，密碼寫在 YAML 裡沒有關係；正式環境的祕密放在 GitLab 的 CI/CD variables，設成 masked 與 protected

### 建置映像：Docker-in-Docker

build job 用 `docker:27` 映像當客戶端，`docker:27-dind` service 當 Docker daemon，並設定 `DOCKER_TLS_CERTDIR: "/certs"` 讓兩者用 TLS 連線。dind 需要 runner 允許 privileged 模式；共用 runner 不允許時，要改用不需要 privileged 的建置工具。登入 registry 用 GitLab 自動提供的 `$CI_REGISTRY_USER`、`$CI_REGISTRY_PASSWORD`、`$CI_REGISTRY`，不要把個人帳密寫進設定。

### 映像 tag 用 commit SHA

`$CI_REGISTRY_IMAGE:$CI_COMMIT_SHA` 讓每個映像對應到一個確切的 commit：線上出問題時，看映像 tag 就知道是哪一版程式；要回滾就重新部署上一個 SHA。只推 `latest` 的話，「現在線上跑的是哪一版」沒有人答得出來。

### 只在 main 部署

```yaml
rules:
  - if: $CI_COMMIT_BRANCH == "main"
```

其他分支照樣跑 lint、test、甚至 build，但不會部署。`environment: production` 讓 GitLab 記錄每次部署，在介面上看得到部署歷史。再搭配受保護分支（只有 merge request 能合進 main），部署就一定經過審查與測試。

## 關鍵設定

完整的 Dockerfile：

```dockerfile
FROM python:3.12-slim AS build
WORKDIR /app
COPY requirements.txt .
RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

FROM python:3.12-slim
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1
RUN useradd --create-home --uid 10001 app
WORKDIR /app
COPY --from=build /opt/venv /opt/venv
COPY clinic/ ./clinic/
USER app
EXPOSE 8000
CMD ["uvicorn", "clinic.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

`PYTHONUNBUFFERED=1` 讓輸出不經緩衝直接寫到 stdout，第 8 階段的日誌才會即時出現在平台的日誌系統。

.gitlab-ci.yml 的 test 與 build 兩段（完整版見驗收題的解答）：

```yaml
test:
  stage: test
  services:
    - postgres:16
  variables:
    POSTGRES_DB: clinic_test
    POSTGRES_USER: clinic
    POSTGRES_PASSWORD: ci-only-password
    DATABASE_URL: postgresql://clinic:ci-only-password@postgres:5432/clinic_test
  script:
    - pip install -r requirements.txt
    - pytest -q

build:
  stage: build
  image: docker:27
  services:
    - docker:27-dind
  variables:
    DOCKER_TLS_CERTDIR: "/certs"
  script:
    - echo "$CI_REGISTRY_PASSWORD" | docker login -u "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"
    - docker build -t "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHA" .
    - docker push "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHA"
```

## 常見錯誤與錯誤訊息

**測試連 localhost。** 在 CI 裡 PostgreSQL 跑在另一個容器，`localhost` 連不到，psycopg 的錯誤訊息類似：

```
psycopg.OperationalError: connection failed: ... Connection refused
```

主機名稱改成 service 的名稱 `postgres`。另一種情況是 service 還沒準備好測試就開始連；測試的連線設定可以加上重試，或在 script 開頭等資料庫可以連線再跑。

**dind 沒設定好。** build job 的 Docker 客戶端找不到 daemon 時，錯誤訊息類似：

```
Cannot connect to the Docker daemon at tcp://docker:2375. Is the docker daemon running?
```

檢查有沒有加 `docker:<版本>-dind` service、runner 是否允許 privileged、`DOCKER_TLS_CERTDIR` 的設定與客戶端使用的 port 是否一致（TLS 用 2376）。

**非 root 之後寫不進檔案。** 切到 `USER app` 後，程式要寫入 root 擁有的目錄：

```
PermissionError: [Errno 13] Permission denied: '/app/uploads'
```

需要寫入的目錄在 `USER` 之前建立並 `chown`，或改寫到容器外的 volume；日誌一律寫 stdout，不寫檔案。

**pytest 沒找到測試也算失敗。** pytest 沒收集到任何測試時，結束代碼是 5，job 會失敗。通常是測試目錄或檔名不符合 `test_*.py` 的慣例。

**`.env` 跟著 `COPY . .` 進了映像。** 不會報錯，要到有人 `docker run --rm image cat .env` 才發現。驗收題因此直接禁止整包複製。

## 驗收題在測什麼

兩題都是設定檔題：交出的內容不會真的被建置或執行，而是用規則逐行檢查。

**Dockerfile**：至少兩個 `FROM`；每個基底映像有含數字的 tag（或 digest），不是 `latest`；最後階段有 `USER` 且不是 root；沒有來源是 `.` 的 `COPY`／`ADD`，也沒有 `.env`；最後階段有 `COPY --from=`；`ENV`／`ARG` 沒有 PASSWORD、SECRET、TOKEN、KEY 或帶密碼的連線字串；`CMD` 是 exec 形式。

**.gitlab-ci.yml**：`stages` 依序是 lint、test、build、deploy 且每個都有 job；lint 跑 linter、test 跑 pytest；test 有固定版本的 postgres service、`POSTGRES_PASSWORD` 與主機為 `postgres` 的 `DATABASE_URL`；build 有固定版本的 dind、用 CI 提供的憑證登入、push 到 `$CI_REGISTRY_IMAGE:<commit SHA>`；deploy 只在 main 執行；所有 `image:` 都固定版本。

規則檢查有它的極限：寫法合格不代表映像真的建得起來、管線真的會通過。這兩個檔案放進實際專案後，第一次執行的結果才是最後的驗收。

## 從一個具體問題開始：一份「能動就好」的 .gitlab-ci.yml

一家醫院資訊部的預約系統放在自架的 GitLab 上，`.gitlab-ci.yml` 是幾年前寫的：

```yaml
deploy:
  script:
    - pip install -r requirements.txt
    - pytest
    - sshpass -p 'P@ssw0rd2023' ssh deploy@10.20.0.15 "cd /srv/booking && git pull && systemctl restart booking"
```

它能動，但問題不少：

- **密碼寫在檔案裡**：任何能讀這個 repo 的人都看得到，而且它會永遠留在 git 歷史中，刪掉這一行也一樣。
- **任何分支都會部署**：有人在自己的功能分支 push 一次，正式環境就換成那個分支的程式碼。
- **測試和部署在同一個 job**：測試連的是哪個資料庫？測試失敗時 `pytest` 的結束碼會讓 job 停下，但如果有人在前面加了 `|| true`，壞掉的程式也會上線。
- **正式環境跑的東西無法追溯**：`git pull` 拉的是那一刻的最新程式碼，部署紀錄裡看不出是哪個 commit，也沒有可以回退的版本。

這一課把它改寫成一份結構清楚的 pipeline：測試用獨立的 PostgreSQL、build 出帶 commit 版本號的 container image、只有 main 分支能部署、部署需要人按下按鈕、密碼由 GitLab 注入。過程中說明每個關鍵字的機制。

## .gitlab-ci.yml 的結構

GitLab 讀取 repo 根目錄的 `.gitlab-ci.yml`，每次 push、建立 merge request（MR）或排程觸發時，依內容建立一條 **pipeline**。檔案裡的頂層鍵分兩類：

- **全域設定**：`stages`、`variables`、`workflow`、`default`、`include` 等保留字。
- **job**：其他頂層鍵都是 job 的名字。名字以 `.` 開頭的是隱藏 job，不會執行，常拿來當範本給 `extends` 用。

每個 job 至少要有 `script`。常用的 job 關鍵字：

| 關鍵字 | 作用 |
|---|---|
| `stage` | 這個 job 屬於哪一個 stage；沒寫就是 `test` |
| `image` | 用哪個 container image 執行（Docker / Kubernetes executor） |
| `services` | 另外起的容器，例如測試用的 PostgreSQL |
| `script` / `before_script` | 要執行的指令；任何一行結束碼不是 0，job 就失敗 |
| `variables` | 這個 job 的環境變數 |
| `rules` | 這個 job 在什麼條件下出現在 pipeline 裡、以什麼方式執行 |
| `needs` | 這個 job 只等哪些 job，不等整個前一個 stage |
| `artifacts` | job 結束後要保留、傳給後續 job 或供下載的檔案 |
| `cache` | 跨 pipeline 重用的檔案（例如套件下載快取） |
| `environment` | 這個 job 部署到哪個環境，GitLab 會記錄部署歷史 |
| `tags` | 要在帶有這些標籤的 Runner 上執行 |

`artifacts` 和 `cache` 常被混用：artifact 是**這條 pipeline 的產出**，保證傳給後面的 job；cache 是**加速用的**，不保證存在（不同 Runner 之間預設不共享），不能拿來傳 build 結果。

## 改寫後的完整範例

```yaml
stages:
  - test
  - build
  - deploy

# 同一個 commit 不要同時跑「分支 pipeline」和「MR pipeline」（GitLab 文件提供的寫法）
workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS
      when: never
    - if: $CI_COMMIT_BRANCH

variables:
  UV_CACHE_DIR: "$CI_PROJECT_DIR/.cache/uv"   # 把 uv 的下載快取放在專案目錄裡，cache 才存得到

# 隱藏 job：Python 環境的共同設定，給下面的 job extends
.python:
  image: python:3.12-slim
  before_script:
    - pip install uv
    - uv sync --frozen               # 依 uv.lock 安裝，lock 檔不符就失敗
  cache:
    key:
      files: [uv.lock]               # lock 檔改了才換新的快取
    paths: [.cache/uv]

lint:
  extends: .python
  stage: test
  script:
    - uv run ruff check .

test:
  extends: .python
  stage: test
  services:
    - name: postgres:16
      alias: db                      # job 裡用 db 這個主機名稱連到它
  variables:
    # 這組帳密只屬於這個 job 臨時起的空資料庫，job 結束就銷毀，不是機密
    POSTGRES_DB: app_test
    POSTGRES_USER: app
    POSTGRES_PASSWORD: test-only
    DATABASE_URL: "postgresql://app:test-only@db:5432/app_test"
  script:
    - uv run pytest --junitxml=report.xml
  artifacts:
    when: always                     # 測試失敗也要保留報告
    reports:
      junit: report.xml              # MR 頁面會顯示哪些測試失敗
    expire_in: 1 week

build-image:
  stage: build
  image: docker:27
  services:
    - docker:27-dind                 # 在 job 裡提供 Docker daemon（Runner 要允許 privileged）
  variables:
    DOCKER_TLS_CERTDIR: "/certs"
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH   # 只有合進預設分支才 build
  script:
    - echo "$CI_REGISTRY_PASSWORD" | docker login -u "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"
    - docker build -t "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA" .
    - docker push "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA"

deploy-production:
  stage: deploy
  image: alpine:3.20
  needs: [build-image]
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      when: manual                   # 要有人在 GitLab 介面上按下才執行
  environment:
    name: production
    url: https://booking.example.org
  resource_group: production         # 同一時間只允許一個部署在跑
  script:
    # DEPLOY_SSH_KEY 是在專案設定裡建立的 File 型、protected 變數，不在這個檔案裡
    - apk add --no-cache openssh-client
    - ssh -i "$DEPLOY_SSH_KEY" -o StrictHostKeyChecking=yes deploy@"$DEPLOY_HOST"
        "/srv/booking/deploy.sh $CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA"
```

（`StrictHostKeyChecking=yes` 需要事先把主機金鑰放進 `known_hosts`，例如用另一個 File 型變數；不要為了省事改成 `no`，那等於不驗證連到的是不是真的那台主機。）

## 執行順序：stages 與 needs

**stage 是一道柵欄**：同一個 stage 的 job 平行執行；前一個 stage 的 job **全部成功**，下一個 stage 才開始。上面的範例在 main 分支上的時間線是這樣：

| 時間 | test stage | build stage | deploy stage |
|---|---|---|---|
| t0 | `lint`、`test` 同時開始 | 等待 | 等待 |
| t1 | `lint` 完成，`test` 還在跑 | 等待（要等整個 test stage） | 等待 |
| t2 | `test` 完成 | `build-image` 開始 | 等待 |
| t3 | | `build-image` 完成 | `deploy-production` 出現「手動執行」按鈕 |

`needs` 把柵欄換成依賴關係（DAG）：寫了 `needs: [build-image]` 的 job 只等 `build-image`，不等同一 stage 或前一 stage 的其他 job。`needs: []` 代表不等任何 job，pipeline 一開始就跑。job 數多的 pipeline 用 `needs` 能明顯縮短總時間，但要注意：**沒列進 needs 的 job 失敗，不會擋住它**。

`needs` 還有第二個效果：預設只下載 needs 裡那些 job 的 artifacts。

## rules：這個 job 要不要出現

`rules` 由上往下比對，**第一條符合的規則生效**，後面的不再看；都不符合時，job 不會出現在 pipeline 裡。每條規則可以帶 `when`：

| `when` | 效果 |
|---|---|
| `on_success`（預設） | 前面的 stage 都成功就執行 |
| `manual` | 出現按鈕，要有人按才執行 |
| `always` | 不管前面成功或失敗都執行 |
| `never` | 不加入 pipeline |
| `delayed` | 搭配 `start_in`，延遲一段時間後執行 |

規則裡最常用的預定義變數：

| 變數 | 內容 | 注意 |
|---|---|---|
| `CI_PIPELINE_SOURCE` | 觸發來源：`push`、`merge_request_event`、`schedule`、`web` 等 | 判斷是否為 MR pipeline 就靠它 |
| `CI_COMMIT_BRANCH` | 分支名稱 | **MR pipeline 裡沒有這個變數**；要用 `CI_MERGE_REQUEST_SOURCE_BRANCH_NAME` |
| `CI_DEFAULT_BRANCH` | 專案的預設分支，通常是 `main` | 比寫死 `"main"` 好，改名時不用改每個檔案 |
| `CI_COMMIT_TAG` | tag 名稱 | 只有 tag pipeline 才有 |
| `CI_COMMIT_SHORT_SHA` | commit 的前 8 個字元 | 拿來當 image tag，正式環境就能對回 commit |
| `CI_REGISTRY_IMAGE` | 這個專案在 Container Registry 的 image 路徑 | 例如 `gitlab.example.org:5050/infra/booking` |

舊版的 `only` / `except` 仍然能用，但官方建議改用 `rules`；兩者不能在同一個 job 混用。

### MR pipeline 與分支 pipeline

push 一個分支會觸發**分支 pipeline**；這個分支有開著的 MR 時，GitLab 還可以觸發 **MR pipeline**（`CI_PIPELINE_SOURCE == "merge_request_event"`）。兩者都設定時，同一個 commit 會跑兩次。範例開頭的 `workflow: rules` 是 GitLab 文件提供的寫法：有開著的 MR 就只跑 MR pipeline，沒有 MR 時跑分支 pipeline。

在專案設定的 Merge requests 裡勾選「Pipelines must succeed」，MR 的 pipeline 沒有通過就不能合併——這是讓 main 永遠保持可部署的關鍵設定。

## Runner：job 真正在哪裡執行

GitLab 本身只負責排程與記錄；job 由 **GitLab Runner** 執行。Runner 是另外安裝的程式，向 GitLab 輪詢有沒有待執行的 job。

### 範圍

| 範圍 | 誰能用 | 常見用途 |
|---|---|---|
| instance runner（舊稱 shared runner） | 整個 GitLab 的所有專案 | 一般的 lint、測試 |
| group runner | 某個群組底下的專案 | 部門共用、需要特定網路位置的 Runner |
| project runner | 指定的專案 | 部署用、能連到正式環境的 Runner |

Runner 可以設成 **protected**：只執行受保護分支或 tag 的 job。能連到正式環境、握有部署權限的 Runner 應該設成 protected，否則任何人都能從自己的分支在它上面執行任意指令。

### executor

executor 決定 Runner 用什麼方式執行 job：

| executor | 怎麼執行 | 取捨 |
|---|---|---|
| shell | 直接在 Runner 主機上用 shell 執行 | 最簡單；job 之間共用環境、互相影響，不建議給多個專案共用 |
| docker | 每個 job 起一個新容器（`image:`），`services:` 也是容器 | 環境乾淨、可重現；最常見 |
| kubernetes | 每個 job 在叢集裡建一個 Pod | 能隨叢集擴展；導入 Kubernetes 後的自然選擇 |
| 其他 | ssh、VirtualBox、Parallels、custom、instance 等 | 特殊需求 |

`image:` 和 `services:` 只在 docker、kubernetes 這類容器型 executor 有作用；shell executor 會忽略它們。

用 `tags` 讓 job 指定 Runner：Runner 註冊時帶標籤（例如 `docker`、`prod-network`），job 寫 `tags: [prod-network]`，就只會被帶這個標籤的 Runner 接走。沒有任何線上的 Runner 符合時，job 停在 pending，頁面上會提示這個 job 卡住、沒有可用的 Runner。

新版 GitLab 建立 Runner 的流程是在介面上先建立 Runner、取得 authentication token（`glrt-` 開頭），再在主機上執行 `gitlab-runner register`；舊的 registration token 方式已被標為棄用。

### 自架 GitLab 的網路位置

Runner 要能連到 GitLab（輪詢 job、上傳 log 與 artifact），也要能連到 job 需要的東西：套件來源、Container Registry、要部署的主機。內網環境常見的問題是 Runner 不能直接連外網，`pip install` 或 `docker pull` 逾時——要設定 proxy 或內部的套件鏡像，排查方式見 [網路通不通](#/skill/network-troubleshooting)。

## 變數與機密：protected、masked

變數可以寫在 `.gitlab-ci.yml`，也可以設在專案、群組、instance 的 **Settings → CI/CD → Variables**。機密只能放在後者，並視需要勾選：

| 選項 | 效果 | 防的是什麼 |
|---|---|---|
| Protected | 只注入**受保護分支或受保護 tag** 上的 pipeline | 有人在自己的分支改 `.gitlab-ci.yml`，把變數 `echo` 出來或傳到別處 |
| Masked | 值出現在 job log 時顯示成 `[MASKED]` | 不小心在 log 裡印出機密 |
| Masked and hidden（較新版本） | 除了遮蔽，建立後在設定頁面上也看不到值 | 有專案設定權限的人看到值 |
| File 型 | 值寫進一個暫存檔，變數內容是檔案路徑 | SSH 金鑰、kubeconfig 這類工具要求以檔案提供的機密 |

masked 的值要符合格式限制（例如單行、至少 8 個字元，字元種類也有限制），不符合時介面不允許勾選。

**受保護分支**在 Settings → Repository → Protected branches 設定：誰可以 push、誰可以合併、能不能 force push。protected 變數、protected Runner 都依賴這個設定——main 沒有設成受保護分支，protected 變數在 main 上也拿不到。

masked 不是完整的保護：值被 base64 編碼後印出、或被寫進 artifact，就不會被遮蔽。真正的防線是 protected：讓只有經過 review、合進受保護分支的程式碼，才拿得到正式環境的機密。

GitLab 也會自動提供一些不用自己設定的機密，例如 `CI_JOB_TOKEN`（這個 job 的短期權杖）、`CI_REGISTRY_PASSWORD`（登入本專案 Container Registry 用）。它們只在 job 執行期間有效。

## GitLab Container Registry

每個 GitLab 專案可以有自己的 container registry（自架的 GitLab 需要管理員先啟用）。在 job 裡用預定義變數登入與推送：

```bash
echo "$CI_REGISTRY_PASSWORD" | docker login -u "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"
docker build -t "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA" .
docker push "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA"
```

- 用 `--password-stdin` 而不是 `-p`：密碼不會出現在程序列表與指令紀錄裡。
- 用 commit SHA 當 tag：每個 image 都能對回一個 commit。只用 `latest` 時，無法知道正式環境跑的是哪一版，也無法指定退回哪一版。
- **同一個 image 一路晉升**：staging 驗過的 image tag，就是 production 要部署的 tag，不要每個環境重 build。見 [環境、secrets 與 artifact](#/skill/environments-secrets)。
- 在 Settings → Packages and registries 設定**清理政策**，否則每個 commit 一個 image，儲存空間會一直長。

`docker:dind`（Docker in Docker）需要 Runner 以 privileged 模式執行容器，等於給 job 很大的主機權限。Runner 由多個專案共用時，這是要評估的風險；也有不需要 privileged 的 image 建置工具（例如 Buildah），適用性依環境而定。

## environments 與手動部署

job 加上 `environment:` 之後，GitLab 會在 Operate → Environments 記錄每個環境的部署歷史：哪個 commit、誰觸發、什麼時候。在環境頁面可以對過去某次部署按「重新部署」，這就是最直接的回退方式——前提是部署 job 用的是固定的 image tag，而不是 `latest` 或 `git pull`。

與部署相關的幾個設定：

- `when: manual`：部署需要人按下。寫在 `rules` 裡的 manual job，預設不允許失敗（`allow_failure: false`），pipeline 會停在等待狀態，直到有人執行。
- `resource_group`：同一個 resource group 的 job 一次只跑一個，避免兩條 pipeline 同時部署到 production。
- **Protected environments**：限制誰能部署到某個環境，並可要求核准（deployment approvals）。這兩個功能在 GitLab 的付費方案才有；免費版可以用 protected 變數加受保護分支，達到「只有合進 main 的程式碼能部署」的效果；受保護分支上的手動 job，依 GitLab 的權限規則，需要有合併到該分支的權限才能執行。方案與功能的對應會隨版本調整，採用前以官方文件為準。

部署需要審核紀錄的環境（例如需要變更管理的系統），MR 的核准紀錄、pipeline 紀錄、environment 的部署歷史串在一起，就是一份完整的變更證據。見 [受監管環境的變更管理](#/skill/change-management)。

## 與 GitHub Actions 對照

| GitLab CI | GitHub Actions |
|---|---|
| `.gitlab-ci.yml`（一個專案一份） | `.github/workflows/*.yml`（可以多份） |
| pipeline | workflow run |
| stage + job | job（用 `needs` 排順序） |
| `script:` | `steps:` 裡的 `run:` |
| `rules:` / `workflow: rules:` | `on:` 與 `if:` |
| CI/CD variables（protected、masked） | secrets 與 variables（可綁 environment） |
| Runner（instance / group / project） | runner（GitHub-hosted / self-hosted） |
| `services:` | `services:` |
| GitLab Container Registry | GitHub Container Registry（ghcr.io） |

概念幾乎一一對應，寫法不同。完整的對照與範例見 [CI 管線：lint、test、build](#/skill/ci-pipeline)。

## 常見錯誤與錯誤訊息

| 現象 / 訊息 | 原因 | 怎麼處理 |
|---|---|---|
| job 一直 pending，提示沒有可用的 Runner | 沒有線上的 Runner 符合 job 的 `tags`；或 Runner 是 protected，而這是非受保護分支 | 檢查 job 的 `tags` 與 Runner 的標籤、Runner 的 protected 設定 |
| 變數在 main 有值、在功能分支是空的 | 變數設成 protected，功能分支不是受保護分支 | 這通常是預期行為；功能分支不該拿到正式環境機密 |
| `could not translate host name "postgres" to address` | job 沒有 `services:`，或連線用的主機名稱和 service 的名稱 / alias 不一致 | 加上 service，主機名稱用 alias（或 image 名稱，如 `postgres`） |
| 連 `localhost:5432` 被拒絕 | docker executor 下 service 是另一個容器，不在 localhost | 改用 service 的主機名稱（Kubernetes executor 下 service 與 job 在同一個 Pod，才能用 localhost） |
| `Cannot connect to the Docker daemon at tcp://docker:2375. Is the docker daemon running?` | 沒有 `docker:dind` service、TLS 設定不一致，或 Runner 沒開 privileged | 加上 dind service 與 `DOCKER_TLS_CERTDIR`，確認 Runner 設定 |
| `docker push` 回 `denied: access forbidden` | 沒有登入 registry，或推到不屬於這個專案的路徑 | 確認 `docker login` 在 push 之前、tag 用 `$CI_REGISTRY_IMAGE` 開頭 |
| pipeline 建立失敗，訊息說沒有任何 stage / job | `rules` 把所有 job 都排除了 | 檢查 `workflow: rules` 與各 job 的 `rules`；在 MR pipeline 裡 `CI_COMMIT_BRANCH` 是空的 |
| YAML 錯誤，例如 `jobs:test config contains unknown keys: scripts` | 關鍵字拼錯、縮排錯 | 用 GitLab 的 pipeline editor（Build → Pipeline editor）先驗證 |

## 動手

1. 到本課的程式題，依序完成：讓測試用 PostgreSQL service、把 image 推到 `$CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA`、讓部署只在 main 手動執行並移除寫死的機密。
2. 在一個測試專案裡，把 main 設成受保護分支，建立一個 protected、masked 的變數，分別在 main 與功能分支的 job 裡執行 `echo "$MY_SECRET"`，比較兩邊的 log。
3. 把範例的 `deploy-production` 改成先部署到 `staging` 環境（自動），再部署到 `production`（手動），兩個 job 用同一個 image tag。

## 從一個具體問題開始：二十分鐘的紅燈，大家按「重新執行」

一個 Python API 的 CI 長這樣：一個 job 從頭跑到尾，每個分支、每次 push 都跑完整一輪。

| 步驟 | 花費時間 | 問題 |
|---|---|---|
| 安裝依賴 | 4 分鐘 | 沒有快取，每次從網路下載 |
| 測試 | 9 分鐘 | 用 SQLite 代替 PostgreSQL；有一個測試偶爾失敗 |
| lint | 20 秒 | 排在測試後面：少一個 import，要等 13 分鐘才知道 |
| build image 並推送 `latest` | 5 分鐘 | 每個分支都推，功能分支的 image 會蓋掉 main 的 |

三個月後，團隊養成了一個習慣：CI 紅了先按「重新執行」，綠了就合併。某天一個真正的錯誤——依賴 PostgreSQL 交易行為的扣庫存邏輯——在 SQLite 上剛好通過、在偶發失敗的掩護下被重跑成綠燈，合進了 main；而 main 的部署腳本拉的是 `latest`，那一刻的 `latest` 還是某個功能分支推上去的。

這一課把它拆成一條結構清楚的管線：快的檢查先跑、依賴有快取、測試接真的資料庫、image 只在 main 建置並用 commit SHA 標記，以及怎麼對付不穩定的測試。

## 管線的階段

| 階段 | 做什麼 | 典型時間 | 失敗代表 |
|---|---|---|---|
| checkout | 取得這個 commit 的程式碼 | 秒級 | |
| 安裝依賴 | 依 lock 檔安裝，命中快取時很快 | 秒級到分鐘級 | lock 檔跟宣告不一致、套件來源連不上 |
| lint 與格式 | `ruff check`、`ruff format --check` | 秒級 | 風格、未使用的 import、明顯的錯誤 |
| 型別檢查 | `mypy` 或 `pyright` | 秒級到分鐘級 | 型別不一致 |
| 單元測試 | 不需要外部服務的測試 | 分鐘級 | 邏輯錯誤 |
| 整合測試 | 接真的 PostgreSQL、Redis | 分鐘級 | SQL、交易、遷移與真實資料庫的互動 |
| build image | `docker build`，tag 用 commit SHA | 分鐘級 | Dockerfile 錯誤、依賴在 image 裡裝不起來 |
| 推到 registry | 只在 main（或 tag） | 分鐘級 | 權限、登入 |

部署到各環境是下一課的內容，見 [環境、secrets 與 artifact](#/skill/environments-secrets)。

### 快速失敗：便宜的檢查先跑

lint 幾秒就能擋下的錯誤，不該等測試跑完才知道。兩種排法：

- **串列**：`test` 寫 `needs: lint`。lint 失敗時測試根本不跑，省下 runner 時間；代價是總時間是兩者相加。
- **平行**：lint 與測試同時開始，總時間取決於最慢的那個；lint 失敗時測試還是會跑完（除非取消）。

runner 時間有限、或測試很重時用串列；在意回饋速度時用平行。build image 一定要在兩者**都通過**之後。

GitHub Actions 的 job 預設平行執行，用 `needs` 建立先後；同一個 job 裡的 step 依序執行，任何一步失敗，後面的 step 預設不執行（除非該步寫了 `if: always()` 或 `if: failure()`）。GitLab 用 `stages` 當柵欄、`needs` 建立 DAG，見 [GitLab CI/CD](#/skill/gitlab-cicd)。

## 快取：key 怎麼選

**cache** 與 **artifact** 常被混用：

| | cache | artifact |
|---|---|---|
| 用途 | 加速：下載過的套件、編譯中間檔 | 傳遞：這次管線的產出（測試報告、建好的檔案） |
| 保證 | 不保證存在，沒有就重新下載 | 這次 run 裡保證存在 |
| 範圍 | 跨多次 run 重用 | 屬於某一次 run |
| 錯誤用法 | 拿來傳 build 結果給下一個 job | 拿來存依賴下載快取 |

快取的 key 決定什麼時候要換新的快取。用 **lock 檔的雜湊**：lock 檔沒變，依賴就沒變，可以直接用舊的；lock 檔一變，key 就變，產生新的快取。

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.cache/uv
    # 主 key：作業系統 + lock 檔雜湊。lock 檔一變，key 就變
    key: uv-${{ runner.os }}-${{ hashFiles('uv.lock') }}
    # 主 key 沒命中時，退而求其次用最近一份同前綴的快取（只需要補下載差異）
    restore-keys: |
      uv-${{ runner.os }}-
```

幾個錯誤的 key：

- **固定字串**（`key: deps`）：第一次存了之後永遠命中，依賴改了也不會更新。`actions/cache` 的同一個 key 存過就不會被覆寫。
- **包含 commit SHA**：每次都不命中，等於沒有快取。
- **用 `pyproject.toml` 而不是 lock 檔**：宣告沒變、但 lock 檔更新了版本時，快取不會換。

快取有容量上限與過期規則，分支之間的可見範圍也有限制（GitHub 上一般是目前分支與預設分支的快取可以讀；細節以官方文件為準）。快取壞掉或被清掉時，管線要照樣能跑完，只是比較慢。

uv 的文件建議在 CI 結束前執行 `uv cache prune --ci`，把可以很快從本地重建的部分清掉，讓快取只留下載過的檔案，體積比較小。

## 測試要接真的資料庫

開頭的事故，根本原因是測試用 SQLite、正式環境用 PostgreSQL：兩者的型別、交易隔離、`ON CONFLICT`、時間函式行為都不同。CI 用 `services` 起一個跟正式環境同大版本的 PostgreSQL 容器：

```yaml
test:
  runs-on: ubuntu-latest
  services:
    postgres:
      image: postgres:16
      env:
        POSTGRES_USER: app
        POSTGRES_PASSWORD: test-only     # job 結束就銷毀的測試資料庫，不是機密
        POSTGRES_DB: app_test
      ports:
        - 5432:5432                      # job 直接跑在 runner 上：用 localhost:5432 連
      options: >-
        --health-cmd pg_isready
        --health-interval 10s
        --health-timeout 5s
        --health-retries 5
  env:
    DATABASE_URL: postgresql://app:test-only@localhost:5432/app_test
```

- **主機名稱取決於 job 在哪裡跑**：job 直接跑在 runner 上時，service 透過 `ports` 對應到 runner 的 `localhost`；job 本身跑在容器裡（寫了 `container:`）時，用 service 的名字（這裡是 `postgres`）當主機名稱，不需要 `ports`。GitLab 的 docker executor 則是用 service 名稱或 alias。
- **health check**：容器啟動不等於 PostgreSQL 已經能接連線。`--health-cmd pg_isready` 讓 runner 等到資料庫就緒才開始跑 step。
- **每個測試互不污染**：每個測試在交易裡跑、結束時 rollback，或每個測試前清空資料表。見 [測試金字塔與 pytest](#/skill/testing)。

## 完整範例：GitHub Actions

```yaml
# .github/workflows/ci.yml
name: ci

on:
  pull_request:                 # PR：跑 lint 與測試
  push:
    branches: [main]            # 合進 main：另外 build 並推 image

permissions:
  contents: read                # 預設最小權限；需要更多權限的 job 自己加

concurrency:
  group: ci-${{ github.ref }}   # 同一個分支連續 push 時，取消還在跑的舊 run
  cancel-in-progress: true

# uv 在 Linux 上的預設快取目錄就是 ~/.cache/uv，下面的 actions/cache 存的就是它
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - uses: actions/cache@v4
        with:
          path: ~/.cache/uv
          key: uv-${{ runner.os }}-${{ hashFiles('uv.lock') }}
          restore-keys: uv-${{ runner.os }}-
      - run: pip install uv
      - run: uv sync --locked                     # lock 檔與 pyproject.toml 不一致就失敗
      - run: uv run ruff check .
      - run: uv run ruff format --check .
      - run: uv run mypy src
      - run: uv cache prune --ci

  test:
    needs: lint                                   # lint 通過才跑測試（快速失敗）
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: app
          POSTGRES_PASSWORD: test-only
          POSTGRES_DB: app_test
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready --health-interval 10s
          --health-timeout 5s --health-retries 5
    env:
      DATABASE_URL: postgresql://app:test-only@localhost:5432/app_test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - uses: actions/cache@v4
        with:
          path: ~/.cache/uv
          key: uv-${{ runner.os }}-${{ hashFiles('uv.lock') }}
          restore-keys: uv-${{ runner.os }}-
      - run: pip install uv
      - run: uv sync --locked
      - run: uv run alembic upgrade head          # 測試前先跑遷移：遷移本身也被測到
      - run: uv run pytest --junitxml=report.xml
      - uses: actions/upload-artifact@v4
        if: always()                              # 測試失敗也要留下報告
        with:
          name: test-report
          path: report.xml

  build:
    needs: [lint, test]
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write                             # 只有這個 job 能推 image
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}   # 平台為這次 run 發的短期權杖
      - uses: docker/build-push-action@v6
        with:
          push: true
          tags: ghcr.io/example-org/shop-api:${{ github.sha }}
```

幾個設計上的選擇：

- **兩種觸發**：`pull_request` 讓 PR 上顯示檢查結果，`push` 到 main 才建 image。`build` 的 `if` 再擋一次，確保只有 main 會推。
- **`permissions` 最小化**：`GITHUB_TOKEN` 的權限在 workflow 層設成只讀，只有 `build` 加上 `packages: write`。
- **image tag 用 `github.sha`**：每個 image 能對回一個 commit；`latest` 會被覆蓋，也說不出正式環境跑的是哪一版。
- **action 的版本**：範例寫的是主版本 tag（`@v4`）。tag 可以被移動，對安全要求高的專案會釘到完整的 commit SHA，並用 Dependabot 之類的工具更新，見 [依賴與供應鏈安全](#/skill/supply-chain)。版本號以各 action 的 repo 為準。

## 平行化

測試很多時，三種加速方式：

- **矩陣**：同一組 step 在不同參數下各跑一份，例如多個 Python 版本。`strategy.fail-fast` 預設為 true：其中一份失敗，其他還在跑的會被取消。
- **切片（sharding）**：把測試分成 N 份，在 N 個 job 平行跑。可以依檔案切，或用測試框架的外掛（例如 pytest-xdist 在單一機器上用多個 worker）。切片後要確認測試之間沒有共享狀態，否則平行時才會出現的失敗會變成新的不穩定來源。
- **只跑受影響的部分**：`on.push.paths` 或 GitLab 的 `rules: changes` 讓只改文件的 PR 不跑整套測試。用在 monorepo 很有效，但規則寫錯就會漏測，必要檢查要確保一定會出現結果。

```yaml
test:
  strategy:
    matrix:
      python: ["3.11", "3.12", "3.13"]
  runs-on: ubuntu-latest
  steps:
    - uses: actions/setup-python@v5
      with:
        python-version: ${{ matrix.python }}
```

## 不穩定的測試（flaky test）

同一個 commit，有時過、有時不過的測試。它的傷害不在單一次失敗，而在**讓所有人不再相信紅燈**。算一下就知道為什麼：

```python run
# 每個不穩定測試獨立地有 p 的機率失敗；n 個這種測試，整條管線紅燈的機率是 1 - (1-p)^n
def red_probability(p: float, n: int) -> float:
    return 1 - (1 - p) ** n

for n in (1, 10, 50):
    print(f"{n:>2} 個 2% 會失敗的測試 → 管線紅燈機率 {red_probability(0.02, n):.1%}")

# 「自動重試一次」：只有連續兩次都失敗才算紅燈，機率變成 p²
p = 0.02
print(f"\n自動重試一次後，單一測試失敗率：{p:.1%} → {p * p:.2%}")

# 但重試也會掩蓋真正的錯誤：一個 30% 機率出錯的競態條件，重試一次後只剩 9% 會被看到
race = 0.30
print(f"30% 會觸發的競態錯誤，重試後被看見的機率：{race * race:.0%}")
```

常見的來源：

| 來源 | 例子 | 修法 |
|---|---|---|
| 時間 | 測試在午夜前後跑結果不同；`sleep(1)` 等非同步工作 | 注入時鐘；等條件成立而不是等固定秒數 |
| 順序與共享狀態 | 前一個測試留下的資料影響下一個 | 每個測試獨立的資料；隨機順序執行找出相依 |
| 真的網路 | 測試呼叫外部 API | 換成假物件或本機的 mock server |
| 並行 | 平行執行時兩個測試搶同一筆資料 | 每個 worker 用獨立的資料庫或 schema |
| 資源 | runner 比較慢時逾時 | 逾時設合理值，找出真正慢的地方 |

處理流程：

1. **確認是不穩定**：同一個 commit 重跑，結果不同才是 flaky；每次都失敗就是真的壞了。
2. **隔離**：把它標記成暫時跳過或移到不擋合併的 job，**同時開一張單、指定負責人**。沒有負責人的隔離區只會越來越大。
3. **修根本原因**：上面那張表通常就是答案。
4. **自動重試要有紀錄**：如果真的用了重試，要把「重試後才通過」的測試統計出來，而不是默默變綠。

## GitHub Actions 與 GitLab CI 對照

| 概念 | GitHub Actions | GitLab CI |
|---|---|---|
| 檔案 | `.github/workflows/*.yml`（可多份） | `.gitlab-ci.yml` |
| 觸發條件 | `on:` | `workflow: rules:`（整條）、`rules:`（單一 job） |
| 執行順序 | job 預設平行，`needs` 建立依賴 | `stages` 柵欄，`needs` 建立 DAG |
| 條件執行 | job 或 step 的 `if:` | `rules: - if:` |
| 依賴快取 | `actions/cache` 加 `hashFiles('uv.lock')` | `cache: key: files: [uv.lock]` |
| job 間傳檔 | `upload-artifact` 與 `download-artifact` | `artifacts:`，後面 stage 的 job 預設自動下載 |
| 資料庫 | `services:`，跑在 runner 上用 `localhost` 加 `ports` | `services:`，用 service 名稱或 `alias` |
| 機密 | secrets（repo、environment、organization） | CI/CD variables（protected、masked） |
| 取消舊的 run | `concurrency` 加 `cancel-in-progress` | `interruptible` 搭配自動取消設定 |
| 同時只能一個部署 | `concurrency`（不取消） | `resource_group` |
| registry | `ghcr.io`，用 `GITHUB_TOKEN` 登入 | GitLab Container Registry，用 `$CI_REGISTRY_PASSWORD` 登入 |

GitLab 的完整範例、Runner 與 protected 變數見 [GitLab CI/CD](#/skill/gitlab-cicd)。

## 常見錯誤與錯誤訊息

| 訊息 | 原因 | 怎麼處理 |
|---|---|---|
| `Error: Process completed with exit code 1.` | 某一步的指令結束碼不是 0；這行本身沒有資訊 | 往上找那一步真正的輸出，例如 pytest 的失敗摘要 |
| `connection to server at "localhost" (127.0.0.1), port 5432 failed: Connection refused` | 沒有 service、沒有 `ports` 對應，或資料庫還沒就緒 | 加上 `ports` 與 health check；job 跑在容器裡時改用 service 名稱 |
| `Cache not found for input keys: ...` | 第一次執行、lock 檔改了、或快取過期被清掉 | 正常現象；每次都出現才要檢查 key 是否包含會變動的東西 |
| `uv sync --locked` 失敗，說 lock 檔需要更新 | 改了 `pyproject.toml` 卻沒有重新產生 `uv.lock` | 本機執行 `uv lock` 後一起 commit |
| `invalid reference format: repository name must be lowercase` | image 名稱有大寫，例如直接用了含大寫的 `github.repository` | image 名稱寫成全小寫 |
| `Resource not accessible by integration` | `GITHUB_TOKEN` 的權限不夠（例如沒有 `packages: write`） | 在需要的 job 加上對應的 `permissions` |
| `docker push` 回 `denied:` 開頭的錯誤 | 沒有登入、權限不足，或推到不屬於這個 repo 的 package | 確認 login 在 push 之前、job 有寫入權限 |

## 動手

1. 執行上面 flaky test 那段，把 `n` 改成 200、`p` 改成 0.005，看看「每個測試都很穩定」加起來的結果。
2. 到 [CI/CD 管線實驗室](#/lab/PipelineLab)，切換 GitHub Actions 與 GitLab CI，打開「讓測試失敗」看後面的階段怎麼被跳過，再切到 feature branch 看部署階段為什麼不執行。
3. 到本課的程式題：把一份沒有快取、沒有資料庫、每個分支都推 image 的 workflow 改好。
4. 在自己的專案裡，把快取 key 換成固定字串，改一個依賴後觀察下一次 run 有沒有裝到新版本，再改回用 lock 檔雜湊。

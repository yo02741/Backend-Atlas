## 從一個具體問題開始：一份「能動」的 Dockerfile

一個 FastAPI 專案的第一版 Dockerfile 長這樣，它確實能跑：

```dockerfile
FROM python:latest
WORKDIR /app
COPY . .
RUN pip install uv && uv sync
CMD uv run uvicorn app.main:app --host 0.0.0.0
```

上線一個月後，陸續發生這些事：

| 現象 | 原因 |
|---|---|
| image 超過 1 GB，每次部署拉很久 | `python:latest` 是完整版 Debian 基底，帶著編譯器與大量工具；dev 依賴也一起裝了 |
| 改一行程式碼，CI 要重裝全部依賴 | `COPY . .` 在安裝依賴之前，任何檔案變動都讓安裝那層失效 |
| 某天重建後啟動失敗，程式碼沒改 | `latest` 從 Python 3.12 換成了新的大版本，某個依賴還不支援 |
| 安全稽核發現 image 裡有 `.env`，裡面是正式環境的資料庫密碼 | `COPY . .` 把整個目錄都複製進去了 |
| `docker stop` 每次都等滿 10 秒 | shell form 的 `CMD` 讓 `/bin/sh` 當 PID 1，uvicorn 收不到 SIGTERM |
| 容器裡的程式以 root 執行 | 沒有設定 `USER` |

每一列都對應這一課的一段。最後會組成一份完整的 Dockerfile，並附上 `.dockerignore`。

## 基底映像：slim、alpine 與其他

官方 `python` 映像有幾種變體：

| tag 例子 | 底層 | 特性 | 適合 |
|---|---|---|---|
| `python:3.12` | Debian 完整版 | 有 gcc、標頭檔與大量工具，可以編譯原始碼套件；體積最大 | 建置階段，或真的需要這些工具時 |
| `python:3.12-slim` | Debian 精簡版 | 只有執行 Python 必要的套件；glibc，可以直接用 PyPI 上大部分的 wheel | **多數正式環境的起點** |
| `python:3.12-alpine` | Alpine Linux | 體積最小；C 函式庫是 **musl** 而不是 glibc | 依賴很少、而且確認都有 musl wheel 時 |

另外還有 distroless（只有執行環境、沒有 shell 與套件管理器）與一些強調「零已知漏洞」的商業或社群映像。它們讓攻擊面更小，代價是除錯不方便、Python 版本要跟著那個映像走。

### alpine 與 musl 的相容性問題

PyPI 上含 C 擴充的套件（`psycopg[binary]`、`cryptography`、`numpy`、`pydantic-core`…）是以 **wheel** 發布的預先編譯檔，檔名裡標明了它相容的平台：

- `manylinux_2_17_x86_64`：給 glibc 2.17 以上的 Linux（Debian、Ubuntu、RHEL…）
- `musllinux_1_2_x86_64`：給 musl 1.2 以上的 Linux（Alpine）

glibc 的 wheel 不能裝在 musl 上。某個套件沒有發布 musllinux wheel（或沒有你那個 Python 版本、那個 CPU 架構的），安裝工具就會改抓原始碼自己編譯：需要 gcc、musl-dev、各種 `-dev` 套件，有時還要 Rust 工具鏈；建置時間從幾秒變成幾分鐘，也可能直接失敗。省下的幾十 MB 常常被額外安裝的編譯工具吃回去。

此外，musl 與 glibc 在一些執行期行為上也不同，例如執行緒的預設 stack 大小較小、DNS 解析與記憶體配置的實作不同，偶爾造成只在 alpine 上出現的問題。沒有特別理由時，選 `-slim`。

### 版本要釘住

- 至少釘到 Python 的次版本：`python:3.12-slim`，不要用 `latest` 或只寫 `python:3-slim`。
- 想讓作業系統的大版本也不變，可以用帶發行版代號的 tag（例如 Debian 的版本代號），或直接釘 digest：`FROM python:3.12-slim@sha256:…`。
- 釘住之後要**定期主動重建**，才拿得到基底映像的安全修補。可以讓自動化工具（Dependabot、Renovate 之類）在基底映像更新時開 PR。

## 層的順序：依賴先、程式碼後

快取的規則是「某一層的輸入變了，它和之後的層全部重做」（原理見 [Docker：image、container、layer](#/skill/docker-basics)）。依賴很少變、程式碼常常變，所以：

```dockerfile
# 1. 只複製描述依賴的兩個檔案
COPY pyproject.toml uv.lock ./
# 2. 只安裝依賴，不安裝專案本身——這一層只在依賴改變時失效
RUN uv sync --locked --no-dev --no-install-project
# 3. 最後才複製程式碼
COPY app/ ./app/
# 4. 安裝專案本身（如果專案是可安裝的套件）；依賴已經在了，這步很快
RUN uv sync --locked --no-dev
```

`--locked` 要求 `uv.lock` 和 `pyproject.toml` 一致，不一致就失敗，避免「lock 檔忘了更新、image 裡裝的是另一組版本」。`--no-dev` 不裝測試與開發工具。`--no-install-project` 讓第 2 步只裝依賴。uv 的鎖檔與版本規則見 [uv 與專案管理](#/skill/uv-packaging)。

BuildKit（目前 `docker build` 的預設建置器）還支援**快取掛載**，把 uv 的下載快取留在建置機器上、不進 image。依賴變了要重裝時，已經下載過的套件不用再抓一次：

```dockerfile
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-install-project
```

## 多階段建置：建置工具不進最終 image

一個 Dockerfile 可以有好幾個 `FROM`，每個開始一個階段。最後一個階段才是輸出的 image，前面的階段只是「工作台」，用 `COPY --from=<階段名>` 把需要的成品搬過去：

```text
builder 階段：python:3.12-slim + uv + 下載快取（+ 需要時的 gcc、-dev 套件）
    產出 /app/.venv（裝好的依賴）與 /app/app（程式碼）
        │
        │  COPY --from=builder（只搬這兩個目錄）
        ▼
runtime 階段：python:3.12-slim + 非 root 使用者      ← 這個才是輸出、推到 registry 的 image
（builder 階段本身被丟掉，裡面的 uv、快取、編譯工具都不會出現在最終 image）
```

一個容易踩到的細節：虛擬環境裡的 `python` 是一個**指向建立它的那個直譯器的符號連結**（在官方映像裡是 `/usr/local/bin/python3`）。所以 builder 與 runtime 要用**同一個 Python 基底**，把 `.venv` 搬到一個 Python 路徑或版本不同的映像，執行時會出現找不到檔案的錯誤。

## 非 root 使用者

```dockerfile
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app
# ...複製檔案...
USER app
```

- 固定數字 UID / GID（這裡用 10001），在主機或 Kubernetes 上設定檔案權限、`runAsUser` 時才對得上。
- 程式碼與 `.venv` **維持 root 擁有、app 只能讀**（`COPY` 預設就是 root 擁有）。程式被攻破時，攻擊者無法改寫程式碼本身。
- 真的需要寫入的目錄（例如暫存）明確建立並交給 app；更好的做法是根檔案系統唯讀、需要寫的地方掛 tmpfs 或 volume。
- 非 root 預設不能聽 1024 以下的埠。容器裡聽 8000，對外的 80 / 443 交給前面的 nginx 或負載平衡器。

## `.dockerignore`

`docker build .` 會把整個目錄（建置情境，build context）送給建置器。`.dockerignore` 決定哪些東西不送：

```text
# 版本控制與本機環境
.git
.venv
__pycache__/
*.pyc
.pytest_cache/
.mypy_cache/
.ruff_cache/

# 秘密與本機設定：絕對不能進 image
.env
.env.*
!.env.example

# 其他用不到的
node_modules/
*.log
docs/
```

它同時解決三件事：image 變小、`COPY` 不會因為無關檔案（`.git` 每次 commit 都變）而讓快取失效、秘密不會被複製進去。即使有 `.dockerignore`，也建議用明確的 `COPY app/ ./app/` 取代 `COPY . .`，多一層保險。

## `ENTRYPOINT`、`CMD`，以及 exec form

兩者都描述「容器啟動時要跑什麼」，差別在於能不能被 `docker run` 後面的參數覆寫：

- `CMD`：預設指令。`docker run image 其他指令` 會**整個取代** CMD。
- `ENTRYPOINT`：固定的執行檔。`docker run image 參數` 的參數會**接在 ENTRYPOINT 後面**（取代 CMD）。

兩者都有兩種寫法：

| 寫法 | 例子 | 實際執行 |
|---|---|---|
| exec form（JSON 陣列） | `CMD ["uvicorn", "app.main:app"]` | 直接執行 `uvicorn`，它就是 PID 1 |
| shell form（一般字串） | `CMD uvicorn app.main:app` | 執行 `/bin/sh -c "uvicorn app.main:app"`，**sh 是 PID 1** |

shell form 讓 `docker stop` 的 SIGTERM 送到 sh。sh 是否轉送給 uvicorn 依 shell 實作而定，不能依賴；常見結果是 uvicorn 收不到、等滿逾時被 SIGKILL，進行中的請求被硬切斷。**一律用 exec form**。exec form 不經過 shell，所以 `$PORT` 這類變數不會被展開；需要展開時用一個啟動腳本，最後一行用 `exec` 把自己換成真正的程式：

```bash
#!/bin/sh
# docker-entrypoint.sh：做完啟動前的準備，再用 exec 讓應用程式接手 PID 1
set -eu
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
```

組合規則可以直接跑下面這段模擬看結果：

```python run
# 模擬 Docker 決定容器實際執行什麼：ENTRYPOINT / CMD 的 exec form（list）與 shell form（str）
def resolve(entrypoint=None, cmd=None, run_args=None):
    if run_args:                       # docker run image 參數...：取代 CMD
        cmd = run_args
    if isinstance(cmd, str):
        cmd = ["/bin/sh", "-c", cmd]
    if entrypoint is None:
        return cmd or []
    if isinstance(entrypoint, str):    # shell form 的 ENTRYPOINT：CMD 與 run 參數都被忽略
        return ["/bin/sh", "-c", entrypoint]
    return entrypoint + (cmd or [])

cases = [
    ("只有 CMD（exec）", dict(cmd=["uvicorn", "app.main:app"])),
    ("只有 CMD（shell）", dict(cmd="uvicorn app.main:app")),
    ("run 時覆寫 CMD", dict(cmd=["uvicorn", "app.main:app"], run_args=["python", "-m", "app.migrate"])),
    ("ENTRYPOINT + CMD 當預設參數", dict(entrypoint=["uvicorn"], cmd=["app.main:app", "--port", "8000"])),
    ("ENTRYPOINT + run 參數", dict(entrypoint=["uvicorn"], cmd=["app.main:app"], run_args=["app.main:app", "--reload"])),
    ("ENTRYPOINT 用 shell form", dict(entrypoint="uvicorn app.main:app", cmd=["--port", "9000"])),
]
for name, kw in cases:
    argv = resolve(**kw)
    print(f"{name:<28} PID 1 = {argv[0]:<10} argv = {argv}")
```

最後一個例子裡，`--port 9000` 默默地不見了，而且 PID 1 是 sh。實務上，一般的 Web 服務用 `CMD` 的 exec form 就夠；需要「這個 image 就是某個工具」時才用 `ENTRYPOINT`。

## 環境變數與健康檢查

```dockerfile
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/app/.venv/bin:$PATH"
```

- `PYTHONUNBUFFERED=1`：stdout 不緩衝，log 立刻出現在 `docker logs`，程式崩潰時最後幾行也不會留在緩衝區裡遺失。
- `PYTHONDONTWRITEBYTECODE=1`：執行時不寫 `.pyc`（程式碼目錄是唯讀的，寫了也會失敗）；依賴的 bytecode 可以在建置時用 `UV_COMPILE_BYTECODE=1` 先編好，縮短啟動時間。
- `PATH` 把虛擬環境放最前面，`uvicorn` 指的就是 `.venv/bin/uvicorn`，不需要在 CMD 裡寫 `uv run`（最終 image 裡也不必有 uv）。
- **設定值不要寫在這裡**。資料庫網址、金鑰在執行時注入，見 [環境設定與 12-factor](#/skill/config-12factor)。

`HEALTHCHECK` 讓 Docker 定期執行一個指令，依退出碼把容器標成 `healthy` / `unhealthy`：

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"]
```

slim 映像通常沒有 `curl`，用 Python 標準函式庫就好：`urlopen` 遇到連線失敗或 4xx / 5xx 會丟出例外，退出碼非 0 就算失敗。`--start-period` 是啟動寬限期，這段時間內的失敗不計入重試次數。

只有 Docker 與 Compose 會讀 `HEALTHCHECK`（compose 的 `condition: service_healthy` 用的就是它，見 [docker-compose 開發環境](#/skill/compose)）。Kubernetes 會忽略它，改用 Pod 設定裡的 probe，見 [導入 Kubernetes 前要準備什麼](#/skill/k8s-readiness)。`/health` 與 `/ready` 該檢查什麼，見 [應用伺服器與程序管理](#/skill/process-servers)。

## 完整的 Dockerfile

假設專案結構是 `pyproject.toml`、`uv.lock`、程式碼在 `app/`，以 `uvicorn app.main:app` 啟動：

```dockerfile
# syntax=docker/dockerfile:1

############################
# 建置階段：裝依賴
############################
FROM python:3.12-slim AS builder

# 從 uv 官方映像複製執行檔。標籤釘在你驗證過的版本（這裡的 0.8 只是示範）
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0
# UV_COMPILE_BYTECODE：安裝時先編好 .pyc，縮短啟動時間
# UV_LINK_MODE=copy：搭配 cache mount 時用複製而不是硬連結（兩者不在同一個檔案系統）
# UV_PYTHON_DOWNLOADS=0：用映像裡的 Python，不要另外下載

WORKDIR /app

# 依賴層：只在 pyproject.toml / uv.lock 改變時重建
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-install-project

# 程式碼層
COPY app/ ./app/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev

############################
# 執行階段：只放執行需要的東西
############################
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/app/.venv/bin:$PATH"

# 固定 UID / GID 的非 root 使用者
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app

WORKDIR /app

# 從 builder 只拿裝好的虛擬環境與程式碼；擁有者是 root，app 只能讀
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/app /app/app

USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"]

# exec form：uvicorn 是 PID 1，直接收到 SIGTERM
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

建置與執行：

```bash
docker build -t shop/api:$(git rev-parse --short HEAD) .
docker run --rm -p 8000:8000 --env-file .env.local shop/api:$(git rev-parse --short HEAD)
docker inspect --format '{{.Config.User}}' shop/api:$(git rev-parse --short HEAD)   # 應該印出 app
docker ps   # STATUS 欄會在 start-period 後顯示 (healthy)
```

如果依賴需要編譯（沒有對應的 wheel），在 **builder** 階段 `apt-get install` 編譯工具，runtime 只裝執行時需要的共享函式庫。編譯工具不會進最終 image。

### 建置時需要秘密

私有套件庫的 token 不要用 `ARG` 或 `ENV` 傳——`ARG` 的值會留在 image 的建置紀錄裡（`docker history` 看得到），`ENV` 更是直接存在 image 設定中。用 BuildKit 的 secret mount，只在那一個 `RUN` 期間以檔案形式出現：

```dockerfile
RUN --mount=type=secret,id=index_token \
    UV_INDEX_PRIVATE_PASSWORD="$(cat /run/secrets/index_token)" \
    uv sync --locked --no-dev
```

```bash
docker build --secret id=index_token,src=./index_token.txt -t shop/api:dev .
```

（`UV_INDEX_<名稱>_PASSWORD` 對應 `pyproject.toml` 裡名為 `private` 的 index；名稱與認證方式依你的設定而定。）

## 映像大小與漏洞掃描

看 image 多大、大在哪：

```bash
docker image ls shop/api
docker image history --no-trunc shop/api:8d1e7f40     # 每一層的大小與產生它的指令
```

常見的瘦身來源：基底從完整版換成 slim、dev 依賴不裝、多階段讓編譯工具留在 builder、`.dockerignore` 排除 `.git` 與資料檔、在同一個 `RUN` 裡安裝並清掉套件管理器的快取（`apt-get install … && rm -rf /var/lib/apt/lists/*`）。

漏洞掃描器比對 image 裡的作業系統套件與 Python 套件版本和已知漏洞資料庫，常見的有 Trivy、Grype、Docker Scout：

```bash
# CI 裡：有 HIGH 或 CRITICAL 且已有修補版本時讓建置失敗
trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 shop/api:8d1e7f40
```

讀報告時：

- 大部分發現來自**基底映像的系統套件**。修法通常是重建（拉到已修補的基底），而不是自己逐一升級套件。
- **還沒有修補版本**的漏洞，掃描器照樣會列出來；要記錄、評估是否真的影響你（例如那個套件在執行時根本沒被用到），而不是讓它永遠卡住建置。
- 基底越小，要評估的項目越少，這也是 slim 與 distroless 的好處之一。
- 掃描只看得到「已知漏洞」，看不到你自己程式的漏洞與設定錯誤。

## 常見錯誤與錯誤訊息

| 訊息 | 原因 | 怎麼修 |
|---|---|---|
| `failed to compute cache key: failed to calculate checksum of ref …: "/uv.lock": not found` | 要 `COPY` 的檔案不在建置情境裡：不存在、路徑錯，或被 `.dockerignore` 排除 | 確認檔案在 `docker build` 指定的目錄底下、沒被忽略 |
| uv 回報 lockfile 需要更新、但指定了 `--locked` | `pyproject.toml` 改了，`uv.lock` 沒跟著更新 | 本機 `uv lock` 後一起 commit |
| `/bin/sh: 1: uvicorn: not found` | shell form 執行，`PATH` 裡找不到 uvicorn（虛擬環境不在 PATH） | 設 `ENV PATH="/app/.venv/bin:$PATH"`，CMD 改 exec form |
| `ModuleNotFoundError: No module named 'fastapi'` | 執行的是系統的 Python，不是 `.venv` 裡的 | 同上；在容器裡 `which python` 確認 |
| `exec /app/.venv/bin/uvicorn: no such file or directory`（檔案明明在） | 這個腳本第一行指定的直譯器不存在：builder 與 runtime 的 Python 路徑或版本不同 | 兩個階段用同一個 Python 基底 |
| `PermissionError: [Errno 13] Permission denied: '/app/…'` | 非 root 使用者要寫入 root 擁有的目錄 | 不要寫程式碼目錄；需要寫的目錄明確建立並 `chown`，或掛 volume / tmpfs |
| `error while attempting to bind on address ('0.0.0.0', 80): permission denied` | 非 root 不能聽 1024 以下的埠 | 容器裡改聽 8000，對外由 `-p 80:8000` 或 nginx 處理 |
| `error: command 'gcc' failed: No such file or directory` | 套件沒有適用的 wheel，改從原始碼編譯，但映像裡沒有編譯器 | 換 slim（glibc wheel 較齊全）；或在 builder 安裝編譯工具 |
| 容器一直是 `(unhealthy)`，`docker inspect --format '{{json .State.Health}}'` 看到 `curl: not found` | 健康檢查用了映像裡沒有的工具 | 改用 `python -c` 的寫法 |
| `exec format error` | 在 arm64 機器上建、在 amd64 主機上跑 | `docker buildx build --platform linux/amd64` |

## 動手

1. 在 Playground 開啟 ENTRYPOINT / CMD 那段，加一個「CMD 是 shell form，run 時給參數」的案例，預測結果後再執行。
2. 用自己的專案照「完整的 Dockerfile」建一次，記下 `docker image ls` 的大小；把兩個 `FROM` 都改成 `python:3.12` 完整版再建一次，比較差多少。
3. 建好後改一行 `app/` 裡的程式碼再 `docker build`，確認輸出裡安裝依賴那一步是 `CACHED`；再在 `pyproject.toml` 加一個依賴，看從哪一步開始重做。
4. `docker run` 起來後執行 `time docker stop <容器>`；把 CMD 改成 shell form 重建再比一次。
5. 程式題 [掛號 API 的 Dockerfile](#/exercise/project-ship-1) 會用規則檢查多階段、版本、非 root、秘密與 exec form。

## 從一個具體問題開始：兩台機器，同一個 `latest`，兩種行為

CI 每次合併到 main 就建一個 image，推到 registry，tag 一律是 `registry.example.com/shop/api:latest`。正式環境有兩台主機，部署腳本在每台上執行：

```bash
docker rm -f api
docker run -d --name api -p 8000:8000 registry.example.com/shop/api:latest
```

某天合併了一個修正，部署後一半的請求已經修好、一半還是舊的錯誤。查下去：

```bash
# web-1
$ docker image inspect --format '{{index .RepoDigests 0}}' registry.example.com/shop/api:latest
registry.example.com/shop/api@sha256:9c1e…a41f

# web-2
$ docker image inspect --format '{{index .RepoDigests 0}}' registry.example.com/shop/api:latest
registry.example.com/shop/api@sha256:51b7…0d2e
```

同一個名字，兩個不同的 image。原因是 `docker run` 預設只在**本機沒有這個 image 時**才去 registry 拉。web-1 是新開的機器，第一次就拉到新版；web-2 上早就有一份舊的 `latest`，`docker run` 直接拿來用，根本沒有連到 registry。

這不是 Docker 的 bug，而是 tag 的本質：tag 是一個**可以被移動的名字**，`latest` 也只是其中一個名字，不代表「最新」。這一課從 image 與 container 的關係講起，接著是層與快取、registry 與 tag、容器的隔離、資料放哪、PID 1 與訊號，最後整理 `docker run` 的常用參數與錯誤訊息。

## image 與 container

| | image | container |
|---|---|---|
| 是什麼 | 唯讀的檔案系統層 + 一份設定（預設指令、環境變數、工作目錄、要開的埠…） | image 加上一層**可寫層**，再加上執行時的設定（埠對應、掛載、資源限制），跑起來的一組行程 |
| 能不能改 | 不能；「改」就是建一個新的 image | 可以寫入可寫層，但刪掉 container 就沒了 |
| 數量關係 | 一個 | 同一個 image 可以同時跑很多個 container，各自有自己的可寫層 |
| 看清單 | `docker image ls` | `docker ps`（執行中）、`docker ps -a`（含已停止） |

container 有生命週期：`created` → `running` → `exited`。**container 停止不等於刪除**，停止的 container 和它的可寫層還在，`docker start` 可以讓它再跑起來；`docker rm` 才會刪掉。所以 `docker ps -a` 常常會看到一長串 `Exited` 的舊容器，用 `docker run --rm` 讓容器結束時自動刪除。

container 裡面跑的是**一個主行程**以及它衍生的子行程。主行程結束，container 就結束——這解釋了一個常見的困惑：「`docker run -d myimage` 之後，`docker ps` 看不到它」。多半是主行程啟動後馬上出錯退出了，或者它本來就是一個執行完就結束的指令。`docker ps -a` 會看到 `Exited (1) 3 seconds ago`，`docker logs <容器>` 看它印了什麼。

## 層：image 是一疊唯讀的檔案系統

Dockerfile 裡會改變檔案系統的指令（`RUN`、`COPY`、`ADD`）各產生一層；`ENV`、`CMD`、`EXPOSE` 這類只改 image 的設定，不產生有內容的層。

```bash
$ docker image history shop/api:1.4.2
IMAGE          CREATED        CREATED BY                                      SIZE
3f2a91c0d7e4   2 hours ago    CMD ["uvicorn" "app.main:app" "--host" "0.0…   0B
<missing>      2 hours ago    COPY . . # buildkit                             412kB
<missing>      2 hours ago    RUN /bin/sh -c uv sync --frozen --no-dev # b…   61.3MB
<missing>      2 hours ago    COPY pyproject.toml uv.lock ./ # buildkit       96.1kB
<missing>      2 hours ago    WORKDIR /app                                    0B
<missing>      3 weeks ago    …（基底映像 python:3.12-slim 的各層）            …
```

（`<missing>` 只表示那一層沒有對應的本機 image ID，不是缺檔。）

執行時，Docker 用聯合檔案系統（Linux 上通常是 overlayfs）把這些層疊起來，最上面加一層可寫層。讀檔案時從上往下找，第一個找到的就是；寫檔案時，如果檔案在下面的唯讀層，先把整個檔案**複製到可寫層**再改（copy-on-write）。這帶來幾個結果：

- **層是共用的**。十個 container 用同一個 image，唯讀層在磁碟上只有一份；兩個 image 用同一個基底，基底的層也只存一份、只下載一次。
- **後面的層刪檔案不會讓 image 變小**。`RUN rm` 只是在新的一層記錄「這個檔案被刪了」，前一層的內容仍然在 image 裡。要在同一個 `RUN` 裡下載、使用、刪除，或用多階段建置，見 [幫 Python 專案寫好 Dockerfile](#/skill/dockerfile-python)。
- **大量寫入可寫層又慢又會遺失**。資料庫檔案、上傳的檔案要放 volume（下面會講）。

### 建置快取

每一層都有一個快取鍵。重建時，Docker 依序檢查每一行：鍵沒變就直接用上次的結果（`CACHED`），某一行的鍵變了，那一行**以及之後的每一行**都要重做。

| 指令 | 快取鍵包含 | 結果 |
|---|---|---|
| `FROM` | 基底映像的內容（digest） | 基底更新了，全部重建 |
| `COPY` / `ADD` | 指令本身 + **被複製檔案的內容** | 檔案內容一變就失效（修改時間不算） |
| `RUN` | 指令的**文字** + 前一層 | 文字沒變就用快取，**不管外面的世界變了沒** |

`RUN` 那一列是個陷阱：`RUN apt-get update` 第一次執行後就被快取，三個月後重建 image，套件清單還是三個月前的。官方建議把 `apt-get update` 和 `apt-get install` 寫在同一個 `RUN` 裡，讓它們一起失效；要強制全部重來用 `docker build --no-cache`。

下面用雜湊模擬這條「一層失效，後面全部失效」的鏈：每一層的鍵由前一層的鍵加上自己的輸入算出來。可以直接執行：

```python run
import hashlib

def build(steps, files, cache):
    """steps：Dockerfile 的每一行；files：建置情境裡的檔案內容；cache：上次建置留下的鍵"""
    parent = "base:python-3.12-slim"
    for step in steps:
        key_input = parent + "\n" + step
        if step.startswith("COPY"):
            # COPY 的鍵包含被複製檔案的內容
            srcs = step.split()[1:-1]
            names = [n for n in sorted(files) if "." in srcs or n in srcs]
            key_input += "".join(files[n] for n in names)
        key = hashlib.sha256(key_input.encode()).hexdigest()[:12]
        status = "CACHED" if key in cache else "BUILD "
        cache.add(key)
        print(f"  {status} {key}  {step}")
        parent = key

good = ["WORKDIR /app", "COPY pyproject.toml uv.lock ./", "RUN uv sync --frozen --no-dev", "COPY . .", 'CMD ["uvicorn", "app.main:app"]']
bad = ["WORKDIR /app", "COPY . .", "RUN uv sync --frozen --no-dev", 'CMD ["uvicorn", "app.main:app"]']
files_v1 = {"pyproject.toml": "deps=fastapi", "uv.lock": "fastapi==0.115", "app.py": "v1"}
files_v2 = dict(files_v1, **{"app.py": "v2"})      # 只改了程式碼

for name, steps in [("好的順序", good), ("壞的順序", bad)]:
    cache = set()
    print(f"{name}：第一次建置")
    build(steps, files_v1, cache)
    print(f"{name}：只改 app.py 再建一次")
    build(steps, files_v2, cache)
```

壞的順序裡，`COPY . .` 在安裝依賴之前，改一行程式碼就讓 `uv sync` 重跑。[DockerLab](#/lab/DockerLab) 把同一件事畫成圖。

## registry、tag 與 digest

image 的完整名字是這樣組成的：

```text
registry.example.com/shop/api:1.4.2@sha256:9c1e…a41f
└──── registry ────┘ └ repo ┘ └tag┘ └──── digest ────┘
```

- **registry**：存 image 的伺服器。省略時是 Docker Hub（`docker.io`），只寫 `python:3.12-slim` 等於 `docker.io/library/python:3.12-slim`。
- **repository**：同一個 image 的各個版本放在一起。
- **tag**：人取的名字，**可以被重新指向另一個 image**。不寫 tag 時預設是 `latest`。
- **digest**：image 內容的 SHA-256，**內容不變它就不變，內容一變它一定變**。用 digest 拉，保證每一台拿到的位元組完全相同。

`latest` 的問題整理如下：

| 問題 | 後果 |
|---|---|
| 不代表最新，只是預設名字 | 有人推了 `1.5.0` 但沒推 `latest`，`latest` 還指著舊版 |
| 會被移動 | 本機快取的 `latest` 和 registry 上的 `latest` 可能是不同的 image（開頭的事故） |
| 看不出版本 | 出事時不知道正式環境跑的是哪一版，也不知道要退回哪一版 |
| 基底映像用 `latest` | 某天重建，基底升了大版本，程式在沒改任何一行的情況下壞掉 |

實務做法：

- 自己建的 image 用**不會重複的 tag**：git commit SHA（`api:8d1e7f40`），或語意化版本加上 SHA。推出去之後不再移動它。
- 部署時明確 `docker pull`，或 `docker run --pull=always`；要完全釘死就用 digest：`docker run registry.example.com/shop/api@sha256:9c1e…`。
- 基底映像至少釘到次版本（`python:3.12-slim`），並且**定期主動**升級、重建，取得安全修補。

### 同一個 tag，不同的 CPU 架構

很多 image 是**多架構**的：同一個 tag 底下有 `linux/amd64`、`linux/arm64` 等版本（manifest list），拉的時候自動選符合本機的那個。自己在 Apple Silicon 筆電上 `docker build` 出來的 image 預設是 arm64，推上去後在 x86 的伺服器跑，會得到：

```text
exec /usr/local/bin/python3: exec format error
```

意思是「這個執行檔不是這顆 CPU 能跑的格式」。建置時指定目標平台：`docker buildx build --platform linux/amd64 -t … --push .`，或交給 CI 在目標架構上建。

## 隔離：container 不是虛擬機

虛擬機有自己的核心；container 是**主機上的一般行程**，只是被核心的兩種機制圍起來：

- **namespace**：決定行程「看得到什麼」。

| namespace | 隔開的東西 | 結果 |
|---|---|---|
| PID | 行程編號 | 容器裡的主行程看到自己是 PID 1，看不到主機上的其他行程 |
| network | 網路介面、路由、埠 | 容器有自己的 `localhost` 和 IP；容器裡聽 8000 不等於主機的 8000 |
| mount | 掛載點 | 看到的根目錄是 image 的檔案系統 |
| UTS | 主機名稱 | `hostname` 是容器 ID 或指定的名字 |
| IPC、user、cgroup | 共享記憶體、使用者對應、cgroup 階層 | user namespace 預設**沒有**開啟重新對應 |

- **cgroup**：決定行程「能用多少」——CPU、記憶體、行程數、I/O。`docker run --memory 512m --cpus 1.5` 就是設 cgroup 的上限。記憶體超過上限時，核心的 OOM killer 會殺掉容器裡的行程，`docker inspect` 看得到：

```bash
$ docker inspect --format '{{.State.Status}} {{.State.ExitCode}} OOMKilled={{.State.OOMKilled}}' api
exited 137 OOMKilled=true
```

退出碼 137 是 128 + 9（SIGKILL）。

這個模型的兩個推論：

1. **所有容器共用主機的核心**。容器裡的 Ubuntu 只是 Ubuntu 的使用者空間檔案；核心版本是主機的。
2. **容器裡的 root 就是主機的 root（UID 0）**，只是被 namespace 和一些權限限制圍住。沒有開 user namespace 重新對應時，一個逃出容器的 root 行程在主機上就是 root。所以 image 裡要設非 root 使用者，也不要隨手加 `--privileged` 或把 `/var/run/docker.sock` 掛進容器（拿到 docker.sock 等於拿到主機的 root）。

## 資料放哪：可寫層、volume、bind mount

| 方式 | 寫法 | 資料在哪 | 適合 |
|---|---|---|---|
| 可寫層 | （預設） | 容器自己的那一層 | 暫存；`docker rm` 就消失 |
| named volume | `-v pgdata:/var/lib/postgresql/data` | Docker 管理的目錄（Linux 上在 `/var/lib/docker/volumes/`） | 資料庫、需要保留的資料 |
| bind mount | `-v /srv/orders/uploads:/app/uploads` 或 `--mount type=bind,…` | 主機上你指定的路徑 | 開發時掛程式碼、讀主機上的設定檔 |
| tmpfs | `--tmpfs /tmp` | 記憶體 | 不能落地的暫存 |

```bash
docker volume create pgdata
docker run -d --name db -e POSTGRES_PASSWORD=devonly -v pgdata:/var/lib/postgresql/data postgres:16
docker rm -f db                     # 容器刪了
docker run -d --name db -e POSTGRES_PASSWORD=devonly -v pgdata:/var/lib/postgresql/data postgres:16
                                    # 資料還在：volume 的生命週期和容器分開
docker volume ls
docker volume rm pgdata             # 這才是真的刪資料
```

（各資料庫映像的資料目錄可能隨大版本調整，以該映像的說明為準。）

bind mount 最常見的問題是權限：容器裡的行程以某個 UID 寫檔，主機上看到的擁有者就是那個 UID 的數字，不管主機上有沒有這個使用者。容器以 UID 10001 執行、掛進去的主機目錄屬於 UID 1000 且權限 `755`，就會得到 `Permission denied`。檢查方式是在兩邊都 `ls -ln`（`-n` 顯示數字 UID），對齊擁有者或權限，見 [Linux 與 shell 基礎](#/skill/linux-basics) 的權限段落。

## PID 1 與訊號

`docker stop` 送 `SIGTERM` 給容器的 PID 1，等 10 秒（`--time` / `-t` 可調），還沒結束就送 `SIGKILL`。所以「`docker stop` 每次都剛好等 10 秒」是一個訊號：PID 1 沒有處理 `SIGTERM`。

PID 1 在 Linux 裡有特殊待遇：**核心不會對 PID 1 套用訊號的預設行為**。一般行程收到 `SIGTERM`，就算程式沒寫任何處理，預設行為也是結束；PID 1 若沒有自己註冊處理函式，`SIGTERM` 就會被忽略。實際影響：

| PID 1 是 | 收到 SIGTERM | 結果 |
|---|---|---|
| uvicorn、gunicorn、nginx 這類伺服器 | 它們會註冊處理函式，開始優雅關機 | 正常 |
| 自己寫的 Python 腳本、沒處理 SIGTERM | 被忽略 | 等滿 10 秒被 SIGKILL |
| `/bin/sh -c "uvicorn …"`（Dockerfile 用 shell form 時） | 送到 shell；shell 是否轉送給子行程依 shell 而定，不能依賴 | 應用程式常常收不到，等滿 10 秒被 SIGKILL |

解法是讓真正的應用程式當 PID 1（Dockerfile 用 exec form：`CMD ["uvicorn", "app.main:app"]`），程式本身處理 `SIGTERM`；需要一個轉送訊號、回收殭屍行程的小 init 時，`docker run --init` 會用 Docker 內建的 init（tini）當 PID 1。exec form 與 shell form 的差別見 [幫 Python 專案寫好 Dockerfile](#/skill/dockerfile-python)。

## `docker run` 常用參數

```bash
docker run -d \
  --name api \
  --restart unless-stopped \
  -p 127.0.0.1:8000:8000 \
  --env-file /etc/shop/api.env \
  -e LOG_LEVEL=info \
  -v uploads:/app/uploads \
  --memory 512m --cpus 1 \
  --user 10001:10001 \
  --read-only --tmpfs /tmp \
  registry.example.com/shop/api:8d1e7f40
```

| 參數 | 作用 | 注意 |
|---|---|---|
| `-d` | 背景執行 | 不加時前景執行，終端機關掉容器就停 |
| `--name` | 容器名稱 | 之後 `logs`、`exec`、`stop` 都用它 |
| `--restart unless-stopped` | 主行程崩潰或主機重開後自動重啟 | 手動 `docker stop` 的不會被拉起來；`always` 則連手動停止的也會在 daemon 重啟後拉起 |
| `-p 主機:容器` | 發布埠 | 只寫 `8000:8000` 會綁在主機所有介面；前面加 `127.0.0.1:` 只給本機（例如前面有 nginx）。容器裡的程式要聽 `0.0.0.0`，聽 `127.0.0.1` 只有容器自己連得到 |
| `-e`、`--env-file` | 環境變數 | 設定與秘密在執行時注入，不寫進 image，見 [環境設定與 12-factor](#/skill/config-12factor) |
| `-v 名稱:路徑` | 掛 volume | 見上一段 |
| `--memory`、`--cpus` | cgroup 上限 | 沒設時容器可以用到整台主機 |
| `--user` | 覆寫 image 的 USER | 數字 UID:GID 最明確 |
| `--read-only --tmpfs /tmp` | 根檔案系統唯讀，只有 `/tmp` 可寫 | 程式偷偷寫檔的地方會立刻報錯，比較容易發現 |
| `-it` | 互動式終端 | 進去除錯用：`docker run --rm -it python:3.12-slim bash` |
| `--rm` | 結束後自動刪除容器 | 一次性的指令、除錯用 |
| `--network` | 加入指定網路 | 同一個使用者自訂網路裡的容器可以用名字互連；compose 會自動做，見 [docker-compose 開發環境](#/skill/compose) |
| `--entrypoint` | 覆寫 image 的 ENTRYPOINT | 除錯時常用：`--entrypoint sh` |
| `--pull=always` | 每次都向 registry 確認 | 開頭的事故就是缺這個 |

日常操作：

```bash
docker ps                         # 執行中的容器、埠對應、狀態（含 healthy / unhealthy）
docker logs -f --tail 100 api     # 主行程的 stdout / stderr
docker exec -it api sh            # 在執行中的容器裡開一個 shell（slim 映像通常有 sh，不一定有 bash）
docker stats                      # 每個容器的 CPU、記憶體即時用量
docker inspect api                # 完整設定與狀態（JSON）
docker system df                  # image、容器、volume、建置快取各佔多少磁碟
docker image prune                # 刪掉沒有 tag 的 image；加 -a 連沒被容器使用的都刪
```

## 常見錯誤與錯誤訊息

| 訊息 | 原因 | 怎麼修 |
|---|---|---|
| `permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock` | 目前的使用者沒有權限連 Docker daemon | 用 `sudo`，或把使用者加入 `docker` 群組後重新登入（加入這個群組等同給了 root 權限，只給該給的人） |
| `Bind for 0.0.0.0:8000 failed: port is already allocated` | 主機上的 8000 已經被別的容器或程式占用 | `docker ps` 看是不是舊容器；不是的話 `sudo ss -ltnp` 找行程；或換一個主機埠 `-p 8001:8000` |
| `Conflict. The container name "/api" is already in use by container "…"` | 同名容器還在（可能是已停止的） | `docker rm -f api` 再起，或換名字 |
| `pull access denied for shop/api, repository does not exist or may require 'docker login'` | 名字打錯、registry 沒寫（被當成 Docker Hub）、或沒登入私有 registry | 檢查完整名字；`docker login registry.example.com` |
| `manifest unknown` 或 `not found` | 這個 tag 在 registry 上不存在 | 確認 CI 真的推了這個 tag |
| `exec format error` | image 的 CPU 架構與主機不同；或腳本第一行沒有正確的 shebang | `docker image inspect --format '{{.Architecture}}'` 看架構；用 `--platform` 重建 |
| 容器立刻 `Exited (0)` 或 `Exited (1)` | 主行程結束了 | `docker logs`；確認 CMD 是常駐程式而不是跑完就結束的指令 |
| `Exited (137)`、`OOMKilled=true` | 超過記憶體上限 | 調整 `--memory` 或降低程式的用量（worker 數、快取大小） |
| 主機上 `curl localhost:8000` 得到 `Connection reset by peer` 或 `Empty reply from server` | 埠有發布，但容器裡的程式聽的是 `127.0.0.1` | 讓程式聽 `0.0.0.0`（例如 `uvicorn --host 0.0.0.0`） |
| `no space left on device` | image、停止的容器、建置快取堆滿磁碟 | `docker system df` 看是哪一類，再用對應的 `prune` 清理 |

## 動手

1. 在 Playground 開啟快取那段，在「好的順序」裡把 `files_v2` 改成同時修改 `uv.lock`，看從哪一行開始重建；再把 `RUN uv sync` 的指令文字改一個字，看會怎樣。
2. 開 [DockerLab](#/lab/DockerLab)，切換「好的順序 / 壞的順序」與「這次改了什麼」，對照每一層的建置時間。
3. 在有 Docker 的機器上 `docker run -d --name t python:3.12-slim python -c "import time; time.sleep(600)"`，然後 `time docker stop t`，看它花多久；再加 `--init` 重做一次比較。
4. 對同一個 image 執行 `docker image inspect --format '{{json .RepoDigests}}'`，把部署腳本改成用 digest 啟動，確認兩台主機的 digest 一樣。
5. 接著看 [幫 Python 專案寫好 Dockerfile](#/skill/dockerfile-python)，把這些原則寫成一份正式環境用的 Dockerfile。

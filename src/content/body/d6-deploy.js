// 領域 6：容器與部署（Docker、docker-compose、nginx） — 技能內文：重點 points / 自我檢核 checklist / 延伸閱讀 refs；索引在 ../d6-deploy.js
import p1 from './parts/d6-deploy-p1.js'
import p2 from './parts/d6-deploy-p2.js'
import p3 from './parts/d6-deploy-p3.js'
const base = {
  'linux-basics': {
    points: [
      { b: '程序與訊號', t: '`ps aux`、`top`、`kill -TERM`（優雅停止）與 `-KILL`（強制）。容器的 PID 1 收到 SIGTERM 要能正確退出，否則 `docker stop` 會等 10 秒再硬殺。' },
      { b: '網路與埠', t: '`ss -ltnp` 看誰在聽哪個埠、`curl -v` 看完整請求回應、`dig` 查 DNS。「連不上」先分清是 DNS、防火牆、還是服務沒起來。' },
      { b: '檔案權限與使用者', t: '`chmod` / `chown`、`ls -l` 的 rwx、不要用 root 跑服務。容器裡的 UID 與掛載 volume 的權限問題都出在這裡。' },
      { b: 'systemd 與 log', t: '`systemctl status/restart`、`journalctl -u 服務 -f`；容器外的服務由 systemd 管、開機自動起、崩潰自動重啟。' },
      { b: '環境變數、路徑與 shell 習慣', t: '`export`、`env`、`$PATH`、`set -euo pipefail` 讓腳本出錯就停；管線 `|`、`grep`、`awk`、`jq` 處理 log 與 JSON。' },
    ],
    checklist: [
      '能 ssh 進一台機器，找出佔用 8000 埠的程序並優雅地重啟它',
      '能用 journalctl 追一個 systemd 服務的即時 log',
      '能解釋 SIGTERM 與 SIGKILL 的差別，以及容器為什麼在意 PID 1',
    ],
    challenge: {
      task: '在一台 Linux（或 WSL、虛擬機）上，用三種方式跑同一個服務：(1) 在家目錄用自己的帳號 `python3 -m http.server 8000`；(2) `cd /tmp` 後 `sudo -u nobody python3 -m http.server 8000`；(3) 加上 `--directory` 指向一個 nobody 沒有讀取權限的目錄。每次啟動前先寫下預測：服務以誰的身分跑、送出哪個目錄、`curl -i localhost:8000/` 的第一行。',
      deliver: '三次的預測與實際輸出：`ps -o user,pid,cmd -p <PID>`、`ls -l /proc/<PID>/cwd`、相關目錄的 `ls -ld`、`curl -i` 的第一行',
      check: [
        '每次都附 `ls -l /proc/<PID>/cwd`，說明服務實際送出的是哪個目錄',
        '第三次指出是哪一個權限位元讓 nobody 讀不到',
        '用 `kill -TERM` 停掉服務，附上啟動它的終端機裡 `echo $?` 的結束碼',
      ],
      twist: '同事把指令寫進 systemd unit：`ExecStart=/usr/bin/python3 -m http.server 8000`，沒寫 `User` 與 `WorkingDirectory`。先預測：服務以誰的身分跑、送出哪個目錄的檔案、`journalctl -u` 會看到哪一行。',
    },
    refs: [],
  },
  'docker-basics': {
    map: {
      names: [
        { n: 'image 與 container', t: 'image 是唯讀的檔案系統層加一份設定；container 是 image 加上一層可寫層跑起來的行程，同一個 image 可以同時跑很多個。' },
        { n: 'layer 與建置快取', t: '`RUN`、`COPY` 各產生一層；某一層的輸入（指令文字、被複製檔案的內容）變了，它和之後的每一層都重做，所以少變的指令放前面。' },
        { n: '`.dockerignore`', t: '列出不送進建置的檔案（`.git`、`.venv`、`node_modules`、`.env`），避免 `COPY . .` 又慢又把秘密帶進 image。' },
        { n: 'tag 與 digest', t: 'tag 是可以被移動的名字，`latest` 也只是其中一個；digest 是內容的 SHA-256。部署用不重複的 tag（commit SHA）或 digest，才確定每台跑的是同一份。' },
        { n: 'volume', t: '可寫層在 `docker rm` 時跟著消失；資料庫、上傳檔放 named volume，生命週期和容器分開。開發時掛程式碼用 bind mount。' },
        { n: 'PID 1 與 `SIGTERM`', t: '`docker stop` 送 `SIGTERM` 給 PID 1，10 秒內沒結束就 `SIGKILL`；PID 1 沒註冊處理函式時 `SIGTERM` 會被忽略，`CMD` 要用 exec 形式。' },
        { n: '發布埠（`-p`）', t: '`-p 主機:容器` 把主機的埠接到容器；容器裡的程式要聽 `0.0.0.0`，聽 `127.0.0.1` 只有容器自己連得到。' },
      ],
      ask: [
        'image 的 tag 規則（commit SHA 或版本號），部署時用 tag 還是 digest、要不要 `--pull=always`。',
        'Dockerfile 的指令順序：先複製依賴清單並安裝，最後才 `COPY . .`。',
        '哪些資料要在 `docker rm` 之後還在，放 volume 還是外部服務。',
        '設定與秘密在執行時從哪裡注入（`-e`、`--env-file`），不寫進 image。',
        '用哪個非 root 使用者執行，記憶體與 CPU 上限（`--memory`、`--cpus`）。',
        '程式聽哪個埠與位址，主機上發布給所有介面還是只給本機（`127.0.0.1:8000:8000`）。',
      ],
      prompt: '電商的 API（FastAPI + uv）寫一份 Dockerfile 與 `.dockerignore`：基底用 `python:3.12-slim`，先 `COPY pyproject.toml uv.lock ./` 再 `RUN uv sync --frozen --no-dev`，最後才 `COPY . .`，只改程式碼時依賴那一層要用快取。`CMD` 用 exec 形式跑 `uvicorn`、聽 `0.0.0.0:8000`，`docker stop` 要在 10 秒內正常結束。`.dockerignore` 排除 `.git`、`.venv`、`.env`。image 的 tag 用 git commit SHA，不推 `latest`；資料庫連線字串在執行時用 `--env-file` 注入。',
      verify: [
        { c: '快取', t: '只改一行程式碼再 `docker build`，裝依賴那一步要顯示 `CACHED`；它重跑代表 `COPY . .` 放在裝依賴之前。' },
        { c: '每層的大小與內容', t: '`docker image history <image>` 看哪一層最大，後面的 `RUN rm` 不會讓 image 變小；`docker run --rm -it <image> sh` 進去確認沒有 `.env` 與 `.git`。' },
        { c: '每台跑同一份', t: '在每台執行 `docker image inspect --format \'{{index .RepoDigests 0}}\' <image>` 比 digest；不同代表某台用了本機留著的舊 `latest`，`docker run` 沒有重新拉。' },
        { c: '停止要多久', t: '`time docker stop <容器>` 每次都剛好 10 秒左右，代表 PID 1 沒處理 `SIGTERM`；檢查 `CMD` 是不是寫成 shell 形式（`CMD uvicorn ...`）。' },
        { c: '起不來或連不到', t: '`docker ps -a` 看到 `Exited (1)` 先看 `docker logs`；`Exited (137)` 加上 `OOMKilled=true` 是超過記憶體上限；主機 `curl localhost:8000` 得到 `Empty reply from server`，通常是程式只聽 `127.0.0.1`。' },
        { c: '資料會不會消失', t: '寫入資料後 `docker rm -f` 容器，再用同一個 volume 起新容器，資料要還在；指令裡沒有 `-v`，資料只寫在可寫層。' },
      ],
    },
    points: [
      { b: 'image vs container', t: 'image 像 class、container 像 instance：同一個 image 可以跑很多 container，各自有一層可寫層，image 本身不變。' },
      { b: '每個指令一層，層可快取', t: '`COPY`、`RUN` 各產生一層；只要該層的輸入（檔案內容、指令）沒變就用快取。一旦某層失效，它之後的所有層都重做。' },
      { b: '順序：越少變的越前面', t: '先 `COPY pyproject.toml uv.lock` 再 `RUN uv sync`，最後才 `COPY . .`。改程式碼不會重裝依賴。' },
      { b: '.dockerignore', t: '排除 `.git`、`.venv`、`node_modules`、`.env`。不然 `COPY . .` 又肥又慢，還可能把 secret 帶進去。' },
      { b: 'container 是無狀態的', t: '容器刪掉可寫層就沒了。資料要放 volume 或外部服務；log 寫 stdout 讓 Docker 收。' },
    ],
    checklist: [
      '能解釋 image 與 container 的關係，以及 layer 快取怎麼運作',
      '能重排一份 Dockerfile 讓改程式碼不用重裝依賴',
      '能用 `docker image history` 看每層大小並指出可以瘦身的地方',
    ],
    challenge: {
      task: '用參考專案 `companion/clinic-api` 的 Dockerfile（或自己的 Python 專案）建三次：第一次正常建置；第二次只改 `clinic/` 底下的一行程式；還原後第三次只改 `pyproject.toml` 的 `description`，不動依賴。每次建置前，先在 [DockerLab](#/lab/DockerLab) 用同樣的改動預測哪幾層會 `CACHED`。',
      deliver: '三次 `docker build --progress=plain` 每一步是否 `CACHED` 的表，加上 `docker image inspect --format \'{{json .RootFS.Layers}}\'` 比對三個 image 共用了哪些層',
      check: [
        '預測與實際結果並列，不一致的地方寫出原因',
        '第二次只有複製程式碼那一步之後重做，裝依賴那一步 `CACHED`',
        '第三次說明為什麼只改 `description` 也讓裝依賴那一步重跑',
        '用 `RootFS.Layers` 的 digest 指出三個 image 共用的層',
      ],
      twist: '同事把 `COPY pyproject.toml uv.lock ./` 刪掉，改成先 `COPY . .` 再裝依賴，理由是「少一行」。先預測三次建置的表會變成怎樣、image 的大小會不會變。',
    },
    refs: [
      { label: 'Docker 文件', url: 'https://docs.docker.com/' },
      { label: 'Docker：Build cache', url: 'https://docs.docker.com/build/cache/' },
    ],
  },
  'dockerfile-python': {
    points: [
      { b: '固定 base image 版本', t: '`python:3.12-slim` 而非 `python:latest`；定期主動升級而不是被動被換。' },
      { b: '多階段建置', t: 'builder 階段裝 uv 與編譯工具、`uv sync --frozen --no-dev`；runtime 階段只 COPY `.venv` 與程式碼。最終 image 沒有編譯器。' },
      { b: '非 root 執行', t: '`RUN useradd -m app && USER app`。容器逃逸或應用漏洞時，攻擊者不是 root。' },
      { b: 'HEALTHCHECK 與正確的 CMD', t: '`CMD ["uvicorn", "app:app", "--host", "0.0.0.0"]` 用 exec 形式讓程序收得到 SIGTERM；`HEALTHCHECK` 打 `/health`（只有 Docker / Compose 會讀它，Kubernetes 用自己的 liveness / readiness probe）。' },
      { b: '環境變數的預設', t: '`PYTHONUNBUFFERED=1`（log 即時）、`PYTHONDONTWRITEBYTECODE=1`；設定值一律 runtime 注入。' },
    ],
    checklist: [
      '能寫出多階段、非 root、有 HEALTHCHECK 的 Python Dockerfile',
      '能說出為什麼 CMD 要用 exec 形式',
      'image 大小在合理範圍（slim base 通常 150–250MB）',
    ],
    challenge: {
      task: '在專案加一個要編譯的依賴（例如 `psycopg[c]`，需要 gcc 與 libpq 的標頭檔），照本課的完整 Dockerfile 在 builder 階段 `apt-get install` 編譯工具，runtime 階段只裝執行時需要的共享函式庫。建好之後證明：最終映像裡沒有編譯器，服務照樣啟動、連得上資料庫。',
      deliver: '`docker image ls` 的大小（附只用單一階段時的大小對照）、`docker run --rm <image> sh -c \'command -v gcc || echo no-gcc\'` 的輸出、服務啟動後 `/health` 的回應',
      check: [
        '最終映像裡找不到 gcc 與 `-dev` 套件的標頭檔',
        '`python -c "import psycopg; print(psycopg.pq.__impl__)"` 印出 `c`',
        'runtime 階段只多裝了執行需要的共享函式庫（例如 `libpq5`），並寫出怎麼找到這個名字',
        '`docker inspect --format \'{{.Config.User}}\'` 不是 root',
      ],
      twist: '把 runtime 階段的 `libpq5` 拿掉重建。先預測：建置會不會失敗、容器在什麼時候才出錯、錯誤訊息大概長什麼樣。',
    },
    refs: [
      { label: 'Docker：Multi-stage builds', url: 'https://docs.docker.com/build/building/multi-stage/' },
      { label: 'uv：Using uv in Docker', url: 'https://docs.astral.sh/uv/guides/integration/docker/' },
    ],
  },
  'compose': {
    points: [
      { b: '服務名 = DNS 名', t: 'api 連資料庫用 `postgresql://…@db:5432/app`，`db` 就是 compose 幫你解析的 hostname。不是 localhost。' },
      { b: '現在叫 `docker compose`', t: '舊的 `docker-compose`（v1、獨立二進位）已停止維護；現行是 Docker CLI 的子命令 `docker compose`，檔名慣例 `compose.yaml`。兩種說法指的是同一件事。' },
      { b: 'ports vs expose', t: '`ports: "5432:5432"` 發布到主機（你本機工具能連）；`expose` 只在 compose 網路內可見。正式環境不要把 DB 發布出去。' },
      { b: 'volume 讓資料活過重建', t: '`pgdata:/var/lib/postgresql/data`；`docker compose down` 不刪 volume、`down -v` 才刪。' },
      { b: 'depends_on 只管啟動順序', t: '要等 DB 能連上，加 `healthcheck` 並用 `condition: service_healthy`。' },
      { b: 'override 分環境', t: '`compose.yaml` 放共同設定、`compose.override.yaml` 放本機（掛程式碼、開 debug）；CI 用另一份。' },
    ],
    checklist: [
      '能寫一份起 api + db + redis 的 compose，api 能透過服務名連到 db',
      '能解釋 ports 與 expose 的差別、volume 與 bind mount 的差別',
      '能用 healthcheck 讓 api 等 db 就緒再啟動',
    ],
    challenge: {
      task: '情境換成物流追蹤服務：`tracking-api` 依賴 PostgreSQL 與 Redis。拿參考專案的 `compose.yaml` 當起點，把 postgres 的啟動延後 20 秒（`entrypoint: ["sh", "-c", "sleep 20 && exec docker-entrypoint.sh postgres"]`），再把 api 的 `depends_on` 依序換成三種寫法各跑一次：短語法、`condition: service_started`、`condition: service_healthy`。每次 `docker compose up` 之前，先預測 api 在第幾秒啟動、會不會出現連線錯誤。',
      deliver: '三次 `docker compose up` 的時間線（取自 log 的時間戳），以及 api 的第一個錯誤訊息',
      check: [
        '預測與實際並列，時間線標出 postgres 開始接受連線的時間',
        '`service_healthy` 那次，api 在 postgres 變成 healthy 之後才啟動，沒有連線錯誤',
        '寫出 healthcheck 的 `interval`、`retries`、`start_period` 要怎麼設，延後 20 秒時才不會被判成 unhealthy',
        '列出從門診案例沿用的條件（服務名就是 hostname、要等依賴就緒），以及要跟物流業務確認的事（api 起不來時掃描事件要不要先排隊、Redis 掛掉要不要擋住啟動）',
      ],
      twist: '把延後改成 90 秒，healthcheck 不改。先預測：`docker compose up` 會怎麼結束、錯誤訊息是什麼、api 的容器有沒有被建立。',
    },
    refs: [
      { label: 'Docker Compose 文件', url: 'https://docs.docker.com/compose/' },
    ],
  },
  'nginx': {
    points: [
      { b: '反向代理 vs 正向代理', t: '正向代理替客戶端出去（公司防火牆）；反向代理替伺服器接進來（客戶端只看到 nginx）。' },
      { b: 'location 匹配順序', t: '先找**最長的前綴匹配**；若它是 `=`（精確）或 `^~`，直接採用、不再看 regex；否則依設定檔順序試 `~` / `~*` regex，第一個命中的贏；都沒中才回頭用那個最長前綴。所以 `/api/` 與 `/` 同時存在時，`/api/users` 走前者。' },
      { b: 'proxy_set_header 轉真實資訊', t: '`Host $host`、`X-Real-IP $remote_addr`、`X-Forwarded-For`、`X-Forwarded-Proto $scheme`，後端才知道原始網域、IP 與是否 HTTPS。' },
      { b: 'upstream 與負載平衡', t: '`upstream api { server app1:8000; server app2:8000; }` 預設 round-robin；掛掉的暫時剔除；`least_conn` 給長連線。' },
      { b: '限流與緩衝', t: '`limit_req_zone` 依 IP 限速；nginx 幫慢客戶端緩衝 request / response，讓後端 worker 不被拖住。' },
    ],
    checklist: [
      '能寫出 SPA + `/api/` 反向代理 + TLS 的 nginx 設定',
      '能解釋四種 location 修飾詞的優先序',
      '能讓後端正確取得真實客戶端 IP 與 scheme',
    ],
    challenge: {
      task: '用 compose 起 nginx 加一個後端：用標準函式庫寫一個把收到的路徑、`Host`、連線來源 IP 與 `X-Forwarded-*` 標頭印成 JSON 的小服務。nginx 用 `location /api/ { proxy_pass http://api:8000/; }`。同一組請求各打兩次，一次直接打後端的埠、一次經過 nginx：`/api/users?x=1`、帶 `X-Forwarded-For: 1.2.3.4` 的請求、一個 2 MB 的 POST、一個後端要 70 秒才回的請求。',
      deliver: '一張表：每個請求兩種走法的狀態碼與後端印出的內容',
      check: [
        '表裡看得出 nginx 改了哪些東西：路徑、`Host`、來源 IP',
        '寫出偽造的 `X-Forwarded-For` 經過 nginx 後變成什麼，以及後端該信任哪一段',
        '2 MB 的 POST 經過 nginx 得到 413、70 秒的請求得到 504，直接打後端都不會',
        '每個差異都指出是哪一行設定（或哪個預設值）造成的',
      ],
      twist: '把 `proxy_pass http://api:8000/;` 的結尾斜線拿掉。先預測表裡哪幾格會變。',
    },
    refs: [
      { label: 'nginx 文件', url: 'https://nginx.org/en/docs/' },
      { label: 'nginx：ngx_http_proxy_module', url: 'https://nginx.org/en/docs/http/ngx_http_proxy_module.html' },
    ],
  },
  'load-balancing': {
    points: [
      { b: 'L4 vs L7', t: 'L4 只看 IP 與埠、轉的是 TCP 連線；L7 看得懂 HTTP，能依 Host、路徑、標頭分派，但要先解開 TLS。長連線（HTTP/2、gRPC、WebSocket）在 L4 下是「一條連線綁一台」，請求數會分不平均。' },
      { b: '演算法跟著負載特性選', t: 'round-robin 適合請求成本相近；least connections 適合處理時間差很多或長連線；加權處理機器規格不同；一致性雜湊讓同一個 key 固定落在同一台，加減節點時只搬動一小部分 key。' },
      { b: '健康檢查決定誰不接', t: '被動檢查看真實請求失敗（nginx 開源版的 `max_fails` / `fail_timeout`），主動檢查定期打 `/ready`。部署時先讓 readiness 失敗、等連線排空再停程序，才不會噴 502。' },
      { b: 'sticky session 是技術債', t: '黏著讓負載不均、主機掛掉時那批使用者的 session 一起消失、擴容也分不到舊流量。session 放 Redis 或用 token，讓每台都能接任何請求。' },
      { b: '真實 IP 要有信任邊界', t: '`X-Forwarded-For` 每經過一層代理往後加一個位址，最前面的值客戶端可以偽造；只信任自己代理加上的部分（nginx `set_real_ip_from`、uvicorn `--forwarded-allow-ips`）。L4 沒有 HTTP 標頭，要靠 PROXY protocol，兩端設定必須一致。' },
    ],
    checklist: [
      '能說出 L4 與 L7 負載平衡各看得到什麼、各適合放在哪',
      '能為一個服務設定健康檢查與部署時的連線排空，並解釋 502 從哪來',
      '能設定讓後端拿到真實客戶端 IP 與 scheme，且客戶端偽造的 X-Forwarded-For 不會被採信',
    ],
    challenge: {
      task: '情境換成票務開賣：`seat-api` 跑 3 個副本，每個副本把「這位使用者暫時保留的座位」記在自己的記憶體裡。用 compose 起 nginx 加 3 個副本，每個回應都帶副本的 hostname 與它記憶體裡的保留清單。同一個使用者先送 9 次「保留座位」、再送 3 次「查詢保留」，upstream 依序用預設的 round-robin、`least_conn`、`ip_hash` 各跑一輪。',
      deliver: '三種演算法各一張表：每個請求落在哪個 hostname、查詢時看到幾個保留',
      check: [
        '表中的 hostname 來自實際回應，不是推算',
        '在 round-robin 的表裡標出保留與查詢落在不同副本時的結果',
        '說明 `ip_hash` 為什麼看起來修好了，以及重啟一個副本或擴成 4 個時會怎樣',
        '列出從原案例沿用的條件（狀態不放在單一副本），以及要跟票務業務確認的事（保留幾分鐘失效、兩人搶同一個座位時誰贏）',
      ],
      twist: '開賣當天，大部分使用者都從同一家電信的 NAT 出口連進來。先預測 `ip_hash` 下三個副本的負載分布。',
    },
    refs: [
      { label: 'nginx：Using nginx as HTTP load balancer', url: 'https://nginx.org/en/docs/http/load_balancing.html' },
      { label: 'nginx：ngx_http_upstream_module', url: 'https://nginx.org/en/docs/http/ngx_http_upstream_module.html' },
      { label: 'nginx：ngx_http_realip_module', url: 'https://nginx.org/en/docs/http/ngx_http_realip_module.html' },
      { label: 'Kubernetes：Service', url: 'https://kubernetes.io/docs/concepts/services-networking/service/' },
    ],
  },
  'config-12factor': {
    points: [
      { b: '設定從環境讀，且要驗證', t: '`class Settings(BaseSettings): database_url: PostgresDsn; debug: bool = False`。啟動時缺值就失敗，不會等到第一個請求才出錯。' },
      { b: '一份 build、多個環境', t: 'image 不含環境資訊；部署時注入。這樣 staging 測過的東西才等於上線的東西。' },
      { b: 'dev / prod 差異最小化', t: '本機也用 PostgreSQL（不用 SQLite）、也跑在容器裡；差異只在設定值。' },
      { b: 'log 寫 stdout、背景工作是獨立程序', t: '容器平台負責收 log；排程與 worker 是獨立的 process type，不塞在 web 程序裡。' },
      { b: '設定要能列出來', t: '啟動時把（遮罩過的）設定印一次，出問題先確認「它到底讀到什麼」。' },
    ],
    checklist: [
      '能用 pydantic-settings 定義並驗證服務的所有設定',
      '能說出 12-factor 裡至少 6 條並解釋為什麼',
    ],
    challenge: {
      task: '用同一個映像（參考專案的 `clinic-api` 或自己的服務）跑三次，只換環境變數：`LOG_LEVEL=INFO`、`LOG_LEVEL=DEBUG`、`LOG_LEVEL=VERBOSE`（不在允許的值裡）。證明三次是同一個映像、程序讀到的值不同、錯的那次在啟動時就結束。接著只改 compose 檔裡的值、不重建容器，看程序讀到什麼。',
      deliver: '三次的 `docker inspect --format \'{{.Image}}\'`、程序讀到的值（`docker exec <容器> sh -c \'tr "\\0" "\\n" < /proc/1/environ\'` 或啟動時印出的遮罩設定）、錯誤那次的結束碼與錯誤訊息的第一行',
      check: [
        '三次的映像 ID 相同',
        '程序讀到的值取自程序本身（`/proc/1/environ` 或啟動 log），不是 compose 檔',
        '設定錯的那次在啟動時結束，錯誤訊息指出是哪個變數',
        '說明只改 compose 檔時程序為什麼還是舊值，要用哪個指令才會套用',
      ],
      twist: '搬上 Kubernetes，`LOG_LEVEL` 改由 ConfigMap 以環境變數注入，然後改 ConfigMap。先預測：Pod 裡的程序會不會讀到新值、要做什麼才會。',
    },
    refs: [
      { label: 'The Twelve-Factor App', url: 'https://12factor.net/' },
    ],
  },
  'process-servers': {
    points: [
      { b: 'worker 數', t: 'I/O 密集的 async 服務通常 CPU 核心數個 worker 就夠；每個 worker 是獨立程序、各自的連線池。' },
      { b: '連線池上限要算', t: 'worker 數 × 每個 pool 大小 ≤ 資料庫 max_connections；否則流量一上來就 too many connections。' },
      { b: 'graceful shutdown', t: '收到 SIGTERM 停止接新請求、把進行中的做完、關連線、再退出。部署與擴縮時才不會噴 502。' },
      { b: 'liveness vs readiness', t: 'liveness 說「我還活著」（掛了就重啟）；readiness 說「我可以接流量」（DB 連上、暖機完）。負載平衡器看 readiness。' },
      { b: '超時要層層設', t: 'nginx proxy_read_timeout、應用層請求超時、資料庫 statement_timeout、外部呼叫 timeout。沒有超時的呼叫會把 worker 耗光。' },
    ],
    checklist: [
      '能為一台 4 核機器決定 worker 數與資料庫連線池大小',
      '服務有 /health 與 /ready 兩個端點且語意正確',
      '能說明 graceful shutdown 的步驟',
    ],
    challenge: {
      task: '用 `gunicorn -w 2 -k uvicorn_worker.UvicornWorker` 起一個服務，回應帶 `os.getpid()` 與一個每個 worker 各自累加的計數器。送 20 個請求，從三個地方追查每個請求由哪個 worker 處理：回應本身、`ps -o pid,ppid,cmd`、存取紀錄。再對其中一個 worker（不是 master）送 `kill -TERM`，看接下來的請求與新 worker 的 PID。',
      deliver: '20 個請求的 PID 分布、`ps` 的行程樹、殺掉 worker 前後的對照',
      check: [
        '從 `ps` 指出 master 與 worker 的 PID、PPID 關係',
        '說明兩個 worker 的計數器為什麼各算各的',
        '殺掉一個 worker 之後，master 補上一個新 PID 的 worker，請求沒有中斷',
        '寫出存取紀錄要加哪個欄位（例如 PID），正式環境才查得出是哪個程序處理的',
      ],
      twist: '把計數器換成訂位系統「今晚還剩幾桌」，兩個 worker 各自扣減。先預測：客人會看到什麼、哪些條件從門診案例沿用、狀態要搬到哪裡，以及要跟訂位業務確認超賣時怎麼處理。',
    },
    refs: [
      { label: 'Uvicorn：Deployment', url: 'https://uvicorn.dev/deployment/' },
    ],
  },
  'object-storage': {
    points: [
      { b: 'bucket、key、物件', t: 'bucket 是容器，物件以 key（一個字串）定址，內容加上 metadata 整包讀寫；「資料夾」只是 key 裡 `/` 的慣例，用前綴列舉。一般的 S3 API 沒有「改中間幾個位元組」，改就是整個物件重寫。' },
      { b: '不放應用程式主機的磁碟', t: '兩台主機各存各的，負載平衡把請求送到另一台就 404；容器重建可寫層就消失；磁碟滿、備份、擴容都變成你的事。主機只存 key，檔案交給物件儲存。' },
      { b: 'presigned URL 讓瀏覽器直傳直下', t: 'API 先檢查權限，再用自己的憑證簽出限時、綁定方法與 key 的網址；瀏覽器直接 PUT / GET 物件儲存，檔案不經過 API。網址在到期前誰拿到誰能用，到期時間要短，資料庫存 key 不存網址。' },
      { b: '預設私有，公開是例外', t: '公開 bucket 被搜到、整批資料外洩是反覆發生的事故。上傳用的 bucket 永遠私有、開啟 Block Public Access；要公開的靜態檔放另一個 bucket 走 CDN；應用程式的憑證只給需要的 bucket 與動作。' },
      { b: '版本控制、生命週期、分段上傳', t: '版本控制讓覆寫與刪除可以救回；生命週期規則把舊資料轉便宜的儲存層、到期刪除、清掉未完成的分段上傳；大檔用 multipart upload 分段傳、斷線只補缺的段。' },
    ],
    checklist: [
      '能說明為什麼使用者上傳的檔案不該存在應用程式主機上，以及改用物件儲存後資料庫要存什麼',
      '能畫出 presigned URL 直傳的流程，並說出到期時間、方法、key 各自限制了什麼',
      '能為一個 bucket 設定私有存取、版本控制，以及清除未完成分段上傳的生命週期規則',
    ],
    challenge: {
      task: '情境換成物流的簽收照片：司機 App 上傳，客服後台下載。照本課「動手」第 4 步在 compose 起一個 S3 相容服務，用 boto3 加上 `endpoint_url` 簽一個 60 秒的下載網址，做三次下載：到期前、到期後、下載到一半中斷再用 `curl -C -` 續傳。記下每次的狀態碼與回應，再設計後台在網址到期時怎麼處理。',
      deliver: '三次請求的狀態碼與回應片段，以及後台處理到期的流程（誰重簽、前端怎麼知道要重簽）',
      check: [
        '到期後的回應是 403 與 XML 錯誤，寫出其中的 `Code` 與 `Message`',
        '續傳那次回 206，下載完的 `sha256sum` 與原檔相同',
        '後台資料庫只存 key，網址到期時向 API 重新要一個，使用者不必重新整理整頁',
        '列出從原案例沿用的條件（bucket 私有、短效網址），以及要跟物流業務確認的事（客服能不能轉寄照片、照片保存多久、網址效期多長才夠用）',
      ],
      twist: '有人提議把到期時間改成 7 天以減少重簽。先預測：S3 的預簽網址最長能設多久、網址外流的影響、用臨時憑證簽出來的網址實際會在什麼時候失效。',
    },
    refs: [
      { label: 'Amazon S3：Working with presigned URLs', url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html' },
      { label: 'Amazon S3：Blocking public access', url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html' },
      { label: 'Amazon S3：Multipart upload', url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html' },
      { label: 'Amazon S3：Lifecycle', url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html' },
    ],
  },
  'cloud-basics': {
    points: [
      { b: '三種跑法', t: 'VM 最自由最累；容器平台（Cloud Run、Fly.io、ECS、App Service）給 image 就跑、自動擴縮；serverless 函式按次計費、冷啟動與執行時間限制。' },
      { b: '資料庫交給受管服務', t: '備份、升級、高可用、監控都由服務商負責。自己在 VM 上裝 PostgreSQL 省的錢遠不夠賠一次資料遺失。' },
      { b: '檔案放物件儲存', t: '使用者上傳、報表、備份放 S3 / GCS / R2，用 presigned URL 讓前端直傳。不放在應用伺服器磁碟。' },
      { b: '網路邊界', t: 'DB 與 Redis 在私有網路、只有 API 能連；對外只開 443；DNS + CDN 在最前面。' },
      { b: '小系統先不用 Kubernetes', t: '它解決的是「很多服務、很多團隊」的問題。一個 API + 一個 DB 用容器平台或 compose on VM 就好。' },
    ],
    checklist: [
      '能為「單一 API + DB + 前端」的小產品畫出部署架構圖並估算主要成本項',
      '能說出何時該用受管資料庫、何時該用物件儲存',
    ],
    challenge: {
      task: '做一次復原演練的兩個版本。自管版：用 compose 起 PostgreSQL，寫入 1,000 筆虛構資料，`pg_dump` 備份後刪庫，再從備份還原，記下每一步花的時間與手動下的指令數。代管版：讀你會選用的受管 PostgreSQL 的時間點還原（point-in-time recovery）文件，列出同一件事要做哪些步驟，還原到新實例還是原實例、連線端點會不會換。',
      deliver: '兩欄對照表：步驟、耗時（自管為實測，代管標明「文件」或「實測」）、誰負責、會遺失多少資料（RPO）、要停多久（RTO）',
      check: [
        '自管版的耗時與指令來自實際執行，附還原後 `SELECT count(*)` 的結果',
        '寫出備份檔和資料庫放在同一台機器時，主機壞掉會怎樣',
        '代管版寫出還原後連線端點會不會改變，以及應用程式要怎麼切過去',
        'RPO 與 RTO 每一格都有數字，或寫明「未量測」',
      ],
      twist: '主管說「代管有自動備份，演練可以省了」。先預測：哪些情況代管的自動備份救不回來（例如誤刪的時間點超過保存期、程式寫錯資料好幾天才發現）。',
    },
    refs: [],
  },
}

// 後續新增的課，內文放在 parts/ 底下，這裡合併
export default { ...base, ...p1, ...p2, ...p3 }

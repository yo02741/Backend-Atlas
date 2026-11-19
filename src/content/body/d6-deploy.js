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
    refs: [],
  },
}

// 後續新增的課，內文放在 parts/ 底下，這裡合併
export default { ...base, ...p1, ...p2, ...p3 }

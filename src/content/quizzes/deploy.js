// 題庫：容器與部署
export default [
  {
    skill: 'docker-basics',
    questions: [
      {
        q: '同一個 image 用 docker run 起了三個 container，其中一個在執行時寫了一個檔案到 /app/tmp。這個檔案會出現在哪裡？',
        options: [
          '寫入失敗：image 的層都是唯讀的，容器內不能寫檔',
          '三個 container 都看得到，因為它們共用同一個 image 的檔案系統',
          '只在那個 container 自己的可寫層；其他 container 與 image 本身都不受影響',
          '寫進 image 最上層；之後用這個 image 起的 container 也會帶著這個檔案',
        ],
        answer: 2,
        explain: 'image 的層唯讀、被多個 container 共用；每個 container 啟動時額外疊一層自己的可寫層（copy-on-write），所有寫入都落在那裡，所以彼此看不到、image 也不會變。想改 image 只能重新 build。也因此 container 刪掉資料就沒了——要留的資料放 volume，log 寫 stdout 讓 Docker 收。',
      },
      {
        q: '下面這份 Dockerfile 已經 build 過一次。只改了 app.py 之後重新 build，哪些指令會重新執行（cache miss）？',
        code: `FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY . .
CMD ["uvicorn", "app:app", "--host", "0.0.0.0"]`,
        lang: 'bash',
        options: [
          '只有 COPY . .；快取是每一層各自比對，彼此不影響',
          'COPY . . 以及它之後的所有指令（這裡是 CMD）',
          'RUN uv sync 與 COPY . .，因為程式碼變了依賴要跟著重裝',
          '全部指令，因為 build context 裡有檔案變了',
        ],
        answer: 1,
        explain: '快取由上往下逐層比對：FROM、WORKDIR 沒變，COPY pyproject.toml uv.lock 的檔案內容沒變，RUN 的指令字串也沒變，前四層全部命中。COPY . . 的輸入（app.py）變了所以失效，而失效會往下傳染——之後的 CMD 也重做。「每層獨立」是常見誤解；「依賴重裝」只有把 COPY . . 放在 uv sync 前面才會發生，這份 Dockerfile 的順序正是為了避免它。',
      },
      {
        q: '同事的 Dockerfile 是先 COPY . . 再 RUN uv sync，每次 build 都在重裝依賴，image 有 1.2GB，docker image history 顯示 COPY 那一層就佔 800MB。最有效的修法是？',
        options: [
          '加 .dockerignore 排除 .git / .venv / node_modules，並把依賴檔的 COPY 與 uv sync 移到 COPY . . 之前',
          '在 Dockerfile 最後加 RUN rm -rf .git .venv node_modules，把不需要的檔案從 image 裡清掉',
          '把 COPY . . 改成 ADD . .，ADD 會自動壓縮內容並略過版本控制目錄，層比較小',
          '改用 python:latest 讓 base 保持最新，並把 RUN uv sync 拆成多個 RUN 讓每一層更小',
        ],
        answer: 0,
        explain: '800MB 的 COPY 層幾乎肯定是 .venv / .git / node_modules 一起被複製進去了，.dockerignore 讓它們根本不進 build context；把依賴描述檔與 uv sync 提前，改程式碼就不會再重裝依賴。後面補 RUN rm 沒用：層是疊加的，刪除只在新層做標記，image 大小不會變小。ADD 只是多了自動解 tar 與抓 URL 的能力，不會壓縮，官方反而建議用 COPY；latest 讓 build 不可重現，拆 RUN 只會增加層數。',
      },
    ],
  },
  {
    skill: 'dockerfile-python',
    questions: [
      {
        q: '為什麼正式環境的 Dockerfile 建議 CMD ["uvicorn", "app:app"]（exec 形式），而不是 CMD uvicorn app:app（shell 形式）？',
        options: [
          'exec 形式會自動以非 root 使用者執行程序，shell 形式則繼承 root，這是安全上的差別',
          'exec 形式支援 $PORT 這類環境變數展開，shell 形式要自己寫 export，平台注入的 PORT 才讀得到',
          'shell 形式每次啟動多開一個 shell 程序，記憶體與啟動時間都多一倍，在自動擴縮時會拖慢',
          'shell 形式的 PID 1 是 /bin/sh，docker stop 送的 SIGTERM 到不了 uvicorn，只能等超時被 SIGKILL',
        ],
        answer: 3,
        explain: 'shell 形式實際執行的是 /bin/sh -c "uvicorn app:app"，sh 成為 PID 1 且預設不轉發訊號；docker stop 送 SIGTERM 給 sh，uvicorn 完全不知道，10 秒後整個容器被 SIGKILL，進行中的請求直接斷掉。exec 形式讓 uvicorn 自己就是 PID 1，能做 graceful shutdown。環境變數展開剛好相反：exec 形式沒有 shell，$PORT 不會被展開，需要時要明確寫 ["sh", "-c", "..."]。使用者身分是 USER 指令的事，與 CMD 形式無關。',
      },
      {
        q: '對照這個技能的檢查清單，下面這份多階段 Dockerfile 還缺了什麼正式環境的基本盤？',
        code: `FROM python:3.12-slim AS builder
WORKDIR /app
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

FROM python:3.12-slim
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY . .
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
CMD ["uvicorn", "app:app", "--host", "0.0.0.0"]`,
        lang: 'bash',
        options: [
          '沒有建立非 root 使用者並用 USER 切換，也沒有 HEALTHCHECK',
          'runtime 階段沒有再裝一次 uv，容器啟動時會找不到 uvicorn',
          'COPY --from=builder 只能複製單一檔案，.venv 目錄會是空的',
          '第二個 FROM 應該改用 python:latest，才能保證與 builder 階段相容',
        ],
        answer: 0,
        explain: '多階段的重點就是 runtime 不需要 uv 與編譯工具：.venv 裡已經有 uvicorn，PATH 也指過去了；COPY --from 複製整個目錄完全沒問題；兩階段用同一個固定版本的 base 才是正確做法，latest 反而不可重現。真正缺的是 RUN useradd -m app && USER app（並讓 /app 屬於 app）——不加的話應用一有漏洞，攻擊者直接是容器內的 root；以及 HEALTHCHECK 打 /health，讓平台知道程序活著但壞了。',
      },
      {
        q: '團隊的 image 用 python:3.12（非 slim）有 1.1GB，想瘦到 200MB 左右，專案有幾個帶 C 擴充的套件（psycopg、numpy）。哪個做法最合理？',
        options: [
          '改成 python:3.12-alpine，它最小，而且所有 Python 套件都能直接 pip 裝',
          '保留 python:3.12，但在最後加一層 RUN apt-get clean && rm -rf /var/lib/apt/lists/*',
          '換 python:3.12-slim + 多階段建置，runtime 只帶 .venv 與程式碼；需要編譯的套件在 builder 階段處理',
          '改成 FROM scratch，把 Python 直譯器與程式碼 COPY 進去，image 最小',
        ],
        answer: 2,
        explain: 'slim 去掉了 full image 裡的編譯工具與文件（通常省 800MB 上下），多階段再確保編譯過程的產物留在 builder。alpine 用 musl libc，很多帶 C 擴充的套件沒有預編譯 wheel、得從原始碼編，build 更慢還有相容性坑，技能內容特別標了「小心」。在最後一層清 apt 快取沒用，前面的層已經包含那些檔案；scratch 沒有 libc 與動態連結庫，Python 不是靜態連結的執行檔，放進去跑不起來。',
      },
    ],
  },
  {
    skill: 'compose',
    questions: [
      {
        q: 'docker compose up 之後 api 一直對資料庫 connection refused。看這份 compose，最可能的原因是？',
        code: `services:
  api:
    build: .
    environment:
      DATABASE_URL: postgresql://app:app@localhost:5432/app
    depends_on: [db]
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app`,
        lang: 'yaml',
        options: [
          'db 沒有寫 ports: "5432:5432"，所以 api 連不到它',
          'DATABASE_URL 用了 localhost；在 api 容器裡 localhost 是它自己，應該用服務名 db',
          '兩個服務沒有宣告 networks:，預設不在同一個網路裡',
          'depends_on 要寫成 condition: service_started 的物件形式，網路才會建立',
        ],
        answer: 1,
        explain: 'compose 預設把同一份檔案裡的服務放進同一個網路，並用服務名當 DNS 名，所以 api 該連的是 db:5432；localhost 在容器裡指向容器自己的 loopback，那裡沒有 PostgreSQL。ports 是常見誤解：它把埠發布到「主機」，給你本機的 psql / GUI 工具用，容器之間互連不需要它（正式環境甚至不該開）。預設網路不需要額外宣告，depends_on 的寫法只影響啟動順序。',
      },
      {
        q: '你自己 docker compose down 再 up 之後，資料庫的資料都還在；同事執行某個指令後資料全沒了。他最可能執行的是？',
        options: [
          'docker compose restart db',
          'docker compose up --build',
          'docker compose stop 再 docker compose start',
          'docker compose down -v',
        ],
        answer: 3,
        explain: '命名 volume（pgdata:/var/lib/postgresql/data）獨立於容器生命週期：down 刪容器與網路但保留 volume；up --build 只是重 build image 再起容器；restart / stop / start 更不會動到資料。只有 down -v（或 docker volume rm）會連命名 volume 一起刪。順帶一提，若用的是 bind mount（./data:/var/lib/postgresql/data），down -v 也不會刪主機目錄——這是 volume 與 bind mount 的差別之一。',
      },
      {
        q: '這段設定裡的 condition: service_healthy 解決了什麼問題？',
        code: `services:
  api:
    build: .
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres:16
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 5s
      retries: 10`,
        lang: 'yaml',
        options: [
          '讓 api 等到 PostgreSQL 真的能接受連線才啟動，而不是 db 容器一「開始跑」就啟動',
          '讓 api 在連不到 db 時每 5 秒重試、最多 10 次',
          '讓 db 容器掛掉時 compose 自動重啟 api',
          '讓 compose 在 db healthcheck 失敗時自動改用 SQLite 當備援',
        ],
        answer: 0,
        explain: '純 depends_on: [db] 只保證 db 容器先「啟動」，但 PostgreSQL 初始化要幾秒，api 起來就連會被拒絕。healthcheck 讓 compose 知道 db 什麼時候 ready，service_healthy 讓 api 等那一刻。interval / retries 是 healthcheck 探測 db 的節奏，不是 api 的重試邏輯；自動重啟是 restart: 政策的事；備援切換不存在這種機制。上線後 api 自己仍要有連線重試，因為 db 也可能中途重啟。',
      },
    ],
  },
  {
    skill: 'nginx',
    questions: [
      {
        q: '依這份設定，請求 /static/logo.png 會回哪個字串？',
        code: `location = / { return 200 "exact"; }
location / { return 200 "prefix-root"; }
location ^~ /static/ { return 200 "static"; }
location ~* \\.(png|jpg)$ { return 200 "image"; }
location /api/ { return 200 "api"; }`,
        lang: 'nginx',
        options: [
          '"image"：只要有 regex location 命中，就優先於所有前綴匹配',
          '"prefix-root"：/ 是最先出現且能匹配的前綴，nginx 依出現順序取第一個',
          '"static"：前綴匹配到 /static/ 後，^~ 讓 nginx 不再比對 regex',
          '"exact"：= 精確匹配的優先權最高，/ 又是所有路徑的共同前綴',
        ],
        answer: 2,
        explain: 'nginx 的順序：先找 = 精確匹配（/static/logo.png 不等於 /）→ 記住最長的前綴匹配（這裡是 /static/，不是 /）→ 若該前綴有 ^~ 就此停止、不看 regex → 否則依出現順序試 regex，命中就用；都沒中才回最長前綴。所以 ^~ 就是為了保護 /static/ 不被下面的 regex 搶走；把 ^~ 拿掉，答案就變成 "image"——這也是實務上 regex location 常「莫名接管」路徑的原因。',
      },
      {
        q: '後端 log 裡所有請求的 client IP 都是 172.18.0.5（nginx 容器的 IP）。要讓後端拿到真實客戶端 IP，該怎麼改？',
        options: [
          '加 proxy_set_header X-Real-IP $remote_addr 與 X-Forwarded-For，後端改從這些標頭讀 IP',
          '在 proxy_pass 的 URL 後面加 $request_uri，nginx 會連同原始連線的來源位址一併轉發',
          '改用 upstream 區塊定義後端並開 keepalive，upstream 模式會保留原始連線的來源 IP',
          '這是 Docker bridge 網路做 NAT 的限制，只能把後端容器改成 network_mode: host',
        ],
        answer: 0,
        explain: '反向代理是「代替客戶端」跟後端另外建一條 TCP 連線，後端看到的來源 IP 天生就是 nginx。唯一的辦法是 nginx 把原始資訊塞進標頭轉過去，後端（如 uvicorn 的 --proxy-headers / --forwarded-allow-ips）再信任這些標頭。$request_uri 只改變轉發的路徑，upstream 只管負載平衡，host 網路也改不了「連線是 nginx 發的」這件事。同理 X-Forwarded-Proto $scheme 讓後端知道原始是 HTTPS，產生的 redirect 與 cookie 才會對。',
      },
      {
        q: 'location /api/ 的 proxy_pass 指到下面這個 upstream。流量會怎麼分配？',
        code: `upstream api {
    server app1:8000;
    server app2:8000;
    server app3:8000 backup;
}`,
        lang: 'nginx',
        options: [
          '三台輪流（round-robin），各接約三分之一',
          '依連線數最少的優先，因為 upstream 預設是 least_conn',
          '全部進 app1；app1 掛了才換 app2，再掛才換 app3',
          'app1、app2 輪流；app3 只在前兩台都不可用時才接流量',
        ],
        answer: 3,
        explain: 'upstream 預設演算法是 round-robin（不是 least_conn，要明確寫 least_conn; 才會依連線數，適合長連線），所以 app1 與 app2 交替；標了 backup 的伺服器不參與輪替，只有其他主要伺服器都被判定不可用（連線失敗達 max_fails）時才會收到請求。「全部進 app1 再依序切換」是 primary / failover 模式，這份設定不是這樣。另外 nginx 會被動健康檢查：失敗的節點在 fail_timeout 內被暫時剔除。',
      },
    ],
  },
  {
    skill: 'config-12factor',
    questions: [
      {
        q: '12-factor 的「build、release、run 分離」在容器世界的具體做法是？',
        options: [
          'staging 與 prod 各自從 main 分支 build 一次 image，確保都用到最新程式碼',
          '同一個 image（同一個 SHA tag）部署到所有環境，只換注入的環境變數與 secret',
          '把 .env.staging 與 .env.prod 都 COPY 進 image，啟動時依 ENV 參數挑一個',
          '每個環境維護一份 Dockerfile（Dockerfile.staging / Dockerfile.prod）',
        ],
        answer: 1,
        explain: 'build 產物（image）不含環境資訊，release = image + 該環境的設定，這樣 staging 驗證過的東西才「真的」是 prod 要跑的東西。各環境分別 build 或各有 Dockerfile，會讓兩邊跑的不是同一份 bytes（base image 更新、依賴解析時間點都可能不同）。把 .env 檔 COPY 進 image 則是把 secret 烙進去——任何拿到 image 的人（registry、CI log）都能讀到 prod 憑證，也違反「設定從環境讀」。',
      },
      {
        q: '容器啟動時環境變數只有 DEBUG=true、沒有 DATABASE_URL。執行這段程式會發生什麼？',
        code: `from pydantic import PostgresDsn
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: PostgresDsn
    debug: bool = False
    redis_url: str = "redis://localhost:6379/0"

settings = Settings()`,
        lang: 'python',
        options: [
          '正常啟動，database_url 為 None，第一個查資料庫的請求才會 500',
          '啟動失敗，因為 DEBUG=true 是字串，無法轉成 bool',
          '建立 Settings() 時立刻拋出 ValidationError，程序啟動失敗',
          '正常啟動，pydantic 會自動用 localhost:5432 當 database_url 的預設值',
        ],
        answer: 2,
        explain: 'database_url 沒有預設值、是必填欄位，pydantic-settings 在建構時就驗證——缺值直接 ValidationError，這正是「啟動時失敗，不要等第一個請求才炸」的設計；容器平台會立刻把這次部署標成失敗並回滾，而不是帶病上線。用 os.environ.get 手寫設定才會出現「先 None 後 500」；pydantic 會把 true / 1 / yes 等字串正確解析成 bool；不存在自動的連線字串預設值。',
      },
      {
        q: '上線後排查發現 prod 服務連到了 staging 的資料庫。哪個做法最能在部署當下就攔住這類錯誤？',
        options: [
          '啟動時把讀到的設定（密碼遮罩）印一次到 log，部署流程並檢查 DB host 是否屬於該環境',
          '程式碼裡依 ENV 寫死各環境的連線字串，不再依賴環境變數',
          '把 prod 的 DATABASE_URL 寫進 image 的 ENV 指令，保證不會被外部覆蓋',
          'prod 與 staging 共用同一個資料庫、用不同 schema 隔開，連錯也沒差',
        ],
        answer: 0,
        explain: '「它到底讀到什麼」是設定問題的第一個問題，啟動時輸出遮罩後的設定，錯誤在部署那一刻就看得見，而不是使用者回報後才翻。把連線字串寫死在程式碼或 image 的 ENV，都把環境資訊烙進了 build 產物，違反一份 build 多環境，後者還把 secret 放進 image。共用 DB 用 schema 隔開是用「讓錯誤沒差」來掩蓋錯誤，只會把 staging 的破壞性測試直接變成 prod 事故。',
      },
    ],
  },
  {
    skill: 'process-servers',
    questions: [
      {
        q: '一台 4 核機器跑 uvicorn 4 個 worker，每個 worker 的 SQLAlchemy 設 pool_size=10、max_overflow=10；PostgreSQL max_connections=100，還有另一個背景 worker 服務也連同一個 DB。這個設定有什麼問題？',
        options: [
          '沒問題：4 × 10 = 40，遠低於 100',
          'worker 數應設成核心數 × 2 + 1 = 9，否則 CPU 用不滿',
          '4 個 worker 共用一個 pool，所以最多只會有 10 條連線',
          '高峰時 API 可開到 4 × (10 + 10) = 80 條，加上另一個服務與保留連線很容易撞到 100',
        ],
        answer: 3,
        explain: '每個 worker 是獨立程序、有自己的連線池，程序之間無法共享 pool（那是 PgBouncer 這類外部 pooler 的工作）；max_overflow 允許超過 pool_size 再開 10 條，所以單一服務上限是 worker 數 × (pool_size + max_overflow) = 80。再加背景服務、migration、監控與 superuser 保留連線，too many connections 就是這樣在高峰出現的。2n+1 是 gunicorn 對同步 worker 的老建議，async I/O 服務通常核心數個 worker 就夠，開越多只是連線越多。',
      },
      {
        q: '/health 回 200 代表程序活著；/ready 會檢查 DB 連線與暖機。負載平衡器與容器平台的重啟機制分別該看哪一個？',
        options: [
          '兩者都看 /health 就夠；/ready 是給人手動確認用的',
          '負載平衡器看 /ready 決定送不送流量；平台的重啟判斷看 /health，DB 短暫斷線不該觸發重啟',
          '負載平衡器看 /health、平台看 /ready；readiness 失敗代表程序壞了要重啟',
          '兩者都看 /ready；DB 一掛所有實例立刻重啟重連，恢復最快',
        ],
        answer: 1,
        explain: 'liveness（/health）回答「程序有沒有卡死」，失敗就重啟；readiness（/ready）回答「現在能不能服務」，失敗就從負載平衡器摘掉但不重啟。若把 DB 連線放進重啟判斷，DB 抖動一下所有實例會同時被殺、重啟、再一起打 DB，小事故放大成雪崩。只看 /health 則會讓剛啟動、還沒連上 DB 的實例就開始收流量而噴 5xx。這也是 rolling deploy 不斷線的關鍵：新版 ready 了才切流量。',
      },
      {
        q: '某個報表端點偶爾要跑 4 分鐘，於是有人把 nginx 設成下面這樣；應用層與資料庫都沒設 timeout。之後高峰期 API 開始大量 504，worker 全在忙。最根本的問題是？',
        code: `location /api/ {
    # proxy_pass 指到 uvicorn
    proxy_read_timeout 300s;
}`,
        lang: 'nginx',
        options: [
          '300s 還是太短：報表偶爾超過 5 分鐘就會被 nginx 切斷再重試，應該調到 600s 讓它一次跑完',
          'nginx 沒設 proxy_connect_timeout 與 proxy_send_timeout，高峰時連線階段就卡住，跟 read timeout 無關',
          '讓 4 分鐘的請求佔住 worker 本身就是問題：改成背景任務 + 輪詢，短請求則在應用層與 DB 設 timeout',
          'uvicorn worker 數不夠：4 核開 4 個太保守，開到 32 個就有足夠的 worker 同時服務報表與一般請求',
        ],
        answer: 2,
        explain: '超時要層層設：nginx 300s 但應用層與 DB 都沒有超時，代表一個慢查詢可以無限佔用一個 worker，幾個這樣的請求就把 worker 耗光，其他請求全部排隊直到 nginx 504。調高超時或狂開 worker 只是把爆炸延後，還會把 DB 連線數撐爆。connect timeout 管的是「連到後端」那一小段，與長時間處理無關。正確做法是把長工作移出請求週期（佇列 + worker，前端輪詢或推播），短請求則設合理的 timeout 與 statement_timeout 讓壞請求快速失敗。',
      },
    ],
  },
  {
    skill: 'cloud-basics',
    questions: [
      {
        q: '新專案只有一個 FastAPI + PostgreSQL + 前端 SPA，團隊兩個人，流量不確定。哪個部署方案最合理？',
        options: [
          '容器平台（Cloud Run / Fly.io / ECS）跑 API、受管 PostgreSQL、SPA 放物件儲存 + CDN',
          '一台 VM 用 compose 起 API 與 PostgreSQL，每天 pg_dump 到同一台機器的另一個目錄',
          '自建 Kubernetes 叢集，未來要擴展時最有彈性',
          '全部改寫成 serverless 函式，按次計費一定最便宜',
        ],
        answer: 0,
        explain: 'Kubernetes 解決的是「很多服務、很多團隊」的問題，兩個人一個 API 用它是純維運成本。VM + compose 對小專案可以，但資料庫與備份放同一台等於沒備份——資料庫該交給受管服務（備份、升級、高可用都含在裡面）。serverless 有冷啟動、執行時間限制與資料庫連線池問題，一個持續有流量的 API 未必便宜、還要改寫程式。容器平台給 image 就跑、自動擴縮，是幾乎零維運的預設選擇。',
      },
      {
        q: '使用者要上傳最大 500MB 的影片。目前 API 把檔案收進記憶體再寫到應用伺服器磁碟的 /uploads。上線前該怎麼改？',
        options: [
          '把 /uploads 改成 Docker volume，容器重建才不會丟檔',
          '把 nginx client_max_body_size 調到 500m、uvicorn worker 記憶體上限調到 1GB',
          'API 只簽發物件儲存的 presigned URL，瀏覽器直傳 S3 / GCS / R2，完成後再通知 API 記錄',
          '把檔案存成 bytea 塞進 PostgreSQL，由受管資料庫統一備份',
        ],
        answer: 2,
        explain: '應用伺服器磁碟不該放使用者資料：多實例時檔案只在其中一台、容器平台的檔案系統通常是暫時性的、大檔會佔住 worker 與頻寬。presigned URL 讓上傳流量完全繞過 API，API 只保留「授權 + 記錄 metadata」這兩件它該做的事。volume 只解決容器重建，不解決多實例與擴縮；調大限制只是把問題撐大；把大檔塞進 PostgreSQL 會讓備份與複寫都變慢，是反模式。',
      },
      {
        q: '正式環境的網路邊界，哪種配置符合「對外只開 443、DB 與 Redis 只有 API 能連」？',
        options: [
          'DB 開公網 5432 但設強密碼，方便同事用 GUI 工具連；API 開 80 與 443',
          'DB / Redis 放私有子網、無公網 IP，安全群組只放行 API 網段；對外只有 LB / CDN 的 443（80 只轉址）',
          '所有服務都有公網 IP，用防火牆只放行公司辦公室的 IP',
          'DB 與 API 都放私有網路，DNS 直接指到 API 的私有 IP',
        ],
        answer: 1,
        explain: '私有網路 + 安全群組讓「DB 被掃到」這件事根本不可能發生；強密碼只是最後一道防線而不是邊界，同事要連 DB 走 bastion / VPN 這類跳板。全部公網 IP 靠防火牆規則把攻擊面留給每一次規則修改，且辦公室 IP 會變。API 放私有網路又沒有對外入口，使用者根本連不到——對外那一層（LB / CDN）才是唯一該有公網位址的東西，80 只負責轉到 443。',
      },
    ],
  },
]

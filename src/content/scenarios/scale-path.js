// 設計情境：從 100 到 10 萬 QPS
export default {
  id: 'scale-path',
  order: 13,
  group: 'traffic',
  title: '從 100 到 10 萬 QPS',
  en: 'Scaling path',
  level: 3,
  skills: ['scaling', 'system-design', 'process-servers'],
  week: 15,
  lab: 'ScalePathScenarioLab',
  summary: '一台機器跑 API + PostgreSQL + Redis，目前 100 QPS。行銷活動預估尖峰 10 萬 QPS，讀 90% 寫 10%，預算有限。升級機器、水平擴展、快取、資料庫，先做哪個？',
  situation: 'FastAPI 服務、一台 4 vCPU 機器跑 uvicorn 單 worker，旁邊一台 PostgreSQL、一台 Redis（目前只拿來放 session）。平常 100 QPS，p95 60 ms。行銷活動預估尖峰 10 萬 QPS，持續 3 小時，讀 90%（商品頁、列表）寫 10%（加入購物車、下單）。預算能接受機器數變成幾十台，但不能接受重寫系統；活動前只剩四週。',
  constraints: [
    '尖峰 10 萬 QPS、讀 90% 寫 10%，錯誤率要在 1% 以下',
    'p95 延遲 300 ms 以內，超過就等於掉單',
    '四週內能上線，不能重寫應用程式',
    '活動只有 3 小時，之後要能把成本縮回去',
    'PostgreSQL 只有一台主庫，max_connections 100',
  ],
  options: [
    {
      id: 'vertical', name: '先升級機器',
      summary: '4 vCPU 換 16 vCPU、uvicorn 開多個 worker，程式一行不改。',
      pros: ['零程式改動，一小時內完成', '單機沒有分散式問題：沒有 session 漂移、沒有快取一致性'],
      cons: ['有天花板：最大機型也撐不到 10 萬 QPS', '單點：一台掛全掛，升級要停機', '價格非線性：16 vCPU 常常比 4 台 4 vCPU 貴'],
    },
    {
      id: 'horizontal', name: '無狀態 + 多實例 + 負載平衡',
      summary: 'session 搬到 Redis、上傳檔案搬到物件儲存，然後 nginx / LB 後面放 N 台一樣的 API。',
      pros: ['容量隨台數線性長，活動結束縮回去', '單台掛掉不影響服務，部署可以滾動'],
      cons: ['前提是無狀態：本機 session、本機檔案、記憶體快取都要先搬走', '每台實例都開連線池，DB 連線數跟著實例數暴增', 'API 撐住了，壓力原封不動落到資料庫'],
    },
    {
      id: 'cache', name: '快取把讀擋掉',
      summary: '商品頁、列表走 cache-aside（Redis）與 CDN，命中的讀完全不碰資料庫。',
      pros: ['讀 90% 的流量，命中 90% 就把 DB 讀壓力砍掉九成', 'Redis 單節點十萬級 ops/s，成本遠低於同等的 DB 副本'],
      cons: ['失效邏輯是 bug 的來源：改價後舊價還在快取裡', '快取穿透與 stampede：熱門 key 到期瞬間全部打到 DB', '對寫入毫無幫助'],
    },
    {
      id: 'db', name: '資料庫層：連線池、讀寫分離、非同步寫入',
      summary: 'pgbouncer 收斂連線；串流副本分擔讀；寫入先進佇列，worker 批次落地。',
      pros: ['pgbouncer 讓幾十台實例共用 100 條連線', '副本讓讀容量線性長；佇列把寫入尖峰攤平'],
      cons: ['副本有延遲，寫後讀要另外處理', '佇列讓寫入變成非同步，回應 202 的語意前端要配合', '每一項都是新的元件要監控與維運'],
    },
  ],
  tradeoffs: {
    axes: ['能撐到（示意）', '程式改動', '成本', '前提'],
    rows: [
      { option: 'vertical', cells: ['~2,000 QPS：單機上限', '無', '中：大機型單價高', '無'] },
      { option: 'horizontal', cells: ['隨台數線性，直到 DB 先爆', '中：狀態外移', '線性：台數 × 單價', 'session / 檔案 / 記憶體快取先搬走'] },
      { option: 'cache', cells: ['讀容量 ×10', '中：讀路徑 + 失效', '低：一台 Redis', '讀多寫少、容忍秒級舊資料'] },
      { option: 'db', cells: ['讀隨副本長、寫隨佇列攤平', '高：路由、非同步語意', '高：副本、佇列、worker', '前面三項做完，DB 真的成為瓶頸'] },
    ],
  },
  decisions: [
    { id: 'small', situation: 'QPS 從 100 要漲到 1,000，單機 CPU 目前 40%，DB 15%。團隊兩個人，下個月上線。', options: ['vertical', 'horizontal', 'cache', 'db'], answer: 'vertical',
      explain: '10 倍還在單機的範圍內：換大一號的機器、uvicorn 開 4 個 worker 就到了，一小時完成，零風險。這時做水平擴展要先處理無狀態，做快取要處理失效，都是在花時間解一個還不存在的問題。' },
    { id: 'content', situation: '內容網站，讀 99% 寫 1%，熱門文章佔 80% 的讀。DB 讀已經到 80%，API 實例 CPU 才 30%。', options: ['vertical', 'horizontal', 'cache', 'db'], answer: 'cache',
      explain: '瓶頸在 DB 讀，而且流量高度集中在少數熱門 key——快取命中率會非常高，一台 Redis 就能把 DB 讀砍掉九成。加 API 實例對 DB 沒有幫助；加副本比快取貴十倍還多了延遲問題。' },
    { id: 'iot', situation: 'IoT 裝置上報。寫 95% 讀 5%，每秒 8,000 筆 INSERT，每筆一個 commit；主庫 CPU 90%、磁碟 fsync 排隊。', options: ['vertical', 'horizontal', 'cache', 'db'], answer: 'db',
      explain: '讀太少，快取與副本都幫不上；API 實例加再多，寫入還是一筆一筆 commit 到同一台主庫。把上報先寫進佇列，worker 每 100 ms 批次 INSERT 一次，一次 commit 幾百筆，fsync 次數降兩個數量級。回 202 給裝置就好，它不在乎立刻讀回來。' },
    { id: 'budget', situation: '預算只夠做一件事。單機 API 的 CPU 已經 90%，DB 只有 20%，活動尖峰只有 3 小時。', options: ['vertical', 'horizontal', 'cache', 'db'], answer: 'horizontal',
      explain: '瓶頸明確在 API 的 CPU，DB 還很閒，快取與 DB 層都不是對症。升級機器有天花板而且 3 小時後退不掉；水平擴展在活動時開 10 台、結束縮回 1 台，只付 3 小時的錢。前提是先把 session 搬到 Redis，這正是那「一件事」。' },
  ],
  implementation: [
    { title: '無狀態化檢查清單（水平擴展的前提）', lang: 'yaml', code: `session:         # 放 Redis，不放程序記憶體；cookie 只帶 session id
  store: redis
  key: "sess:{id}"
  ttl: 7d
uploads:         # 放物件儲存，不放本機磁碟；回傳的是 URL 不是路徑
  store: s3      # 或 MinIO / GCS
local_cache:     # functools.lru_cache 之類的程序內快取要能容忍每台不一樣，否則搬 Redis
  allowed: only-if-stale-ok
background_jobs: # 不能靠「這台機器上的 cron」，改成佇列 + worker，或 Redis 鎖確保只跑一次
  lock: "SET lock:daily NX EX 300"
config:          # 從環境變數讀，每台一樣；secrets 不進 image
  source: env
readiness:       # LB 只把流量送給回 200 的實例
  path: /healthz` },
    { title: 'uvicorn 多 worker + pgbouncer', lang: 'bash', code: `# 每個 4 vCPU 實例：4 個 worker，各自一個連線池（pool_size=5）
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4 --loop uvloop

# 沒有 pgbouncer：16 實例 × 4 worker × 5 條 = 320 條 > max_connections 100 → 連線被拒
# 有 pgbouncer：應用程式連 pgbouncer，pgbouncer 用 40 條真連線輪流服務
cat > /etc/pgbouncer/pgbouncer.ini <<'EOF'
[databases]
shop = host=10.0.0.5 port=5432 dbname=shop

[pgbouncer]
listen_port = 6432
pool_mode = transaction        # 交易結束就把連線還回池子
default_pool_size = 40         # 對 PostgreSQL 的真實連線數
max_client_conn = 2000         # 應用程式那一側可以開很多
server_idle_timeout = 60
EOF
# 應用程式改連 pgbouncer；transaction 模式下不能用 session 級功能（SET、prepared statement 要留意）
export DATABASE_URL="postgresql://shop:***@pgbouncer:6432/shop"` },
    { title: 'nginx upstream：多實例 + 健康檢查', lang: 'nginx', code: `upstream api {
    least_conn;                      # 誰的連線少就給誰，比輪詢更適合請求時間不均的 API
    server 10.0.1.11:8000 max_fails=3 fail_timeout=10s;
    server 10.0.1.12:8000 max_fails=3 fail_timeout=10s;
    server 10.0.1.13:8000 max_fails=3 fail_timeout=10s;
    server 10.0.1.14:8000 max_fails=3 fail_timeout=10s;
    keepalive 64;                    # 對後端保持連線，省掉每個請求的 TCP 握手
}

server {
    listen 80;
    location /api/ {
        proxy_pass http://api;    # api 是上面的 upstream
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 5s;       # 後端卡住不要拖住整個 LB
    }
    location /static/ {
        proxy_pass http://api;
        proxy_cache static_cache;    # 靜態與可快取的讀讓 nginx / CDN 先擋
        proxy_cache_valid 200 10m;
    }
}` },
  ],
  exercise: null,
  refs: [],
}

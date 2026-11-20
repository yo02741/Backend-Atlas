// 題庫：後續新增的技能（linux-basics / crypto-toolbox / resilience / db-operations）
export default [
  {
    skill: 'linux-basics',
    questions: [
      {
        q: '`docker stop` 送出 SIGTERM 後等了 10 秒容器才停，最可能的原因是什麼？',
        options: ['PID 1 沒有處理 SIGTERM，Docker 等到逾時才改送 SIGKILL', 'Docker 預設先等 10 秒讓容器自己結束，之後才送出第一個訊號', '容器裡的程式收到訊號後還有一段 sleep(10) 才結束', 'SIGTERM 需要 root 權限才能送達，容器裡以非 root 執行的程序收不到'],
        answer: 0,
        explain: 'SIGTERM 是「請優雅結束」，程序要自己處理（關連線、寫完最後的工作再退出）。若 PID 1 是 shell 包住的子程序或程式沒處理訊號，Docker 等到 grace period（預設 10 秒）就送 SIGKILL 硬殺。用 exec 形式的 CMD 讓應用程式成為 PID 1、並處理 SIGTERM，是正解。訊號不需要 root，Docker 也不會刻意等 10 秒。',
      },
      {
        q: '服務起不來，你懷疑 8000 埠被別的程序佔住。下面哪個指令最直接看出「誰在聽 8000」？',
        code: 'ss -ltnp | grep 8000',
        lang: 'bash',
        options: ['`ps aux | grep 8000`', '`ss -ltnp | grep 8000`', '`curl localhost:8000`', '`journalctl -u api -f`'],
        answer: 1,
        explain: '`ss -ltnp` 列出所有正在 listen 的 TCP 埠與對應程序（-p 需要足夠權限）。`ps aux | grep 8000` 只是在程序列表找字串 8000，不代表在聽那個埠；`curl` 只能證明有東西在回應、不知道是誰；`journalctl` 是看 log。',
      },
      {
        q: '容器裡的服務要寫入掛載進來的 volume，卻一直 Permission denied。最可能的根因是？',
        options: ['volume 預設以唯讀掛載，容器要寫入得在 -v 後面加 :rw', '容器內程序的 UID 和主機目錄擁有者的 UID 不同', '非 root 的容器要加 `--privileged` 才能寫入掛載的目錄', '主機目錄是 ext4，容器的 overlay 檔案系統無法寫入它'],
        answer: 1,
        explain: 'Linux 權限看的是數字 UID / GID，容器內外共用同一套核心。容器用 UID 1000 的 app 使用者跑，主機目錄卻是 root 或另一個 UID 擁有且沒開寫入權限，就會被拒。解法是 chown 目錄給對應 UID、或在 Dockerfile 建使用者時對齊 UID。volume 預設可寫；`--privileged` 是嚴重過度授權，不是解法。',
      },
    ],
  },
  {
    skill: 'crypto-toolbox',
    questions: [
      {
        q: '你要驗證第三方送來的 webhook 真的來自對方且內容沒被改。該用哪個工具？',
        options: ['對 body 做 SHA-256，與對方放在標頭裡的雜湊值做常數時間比對', '用對方公開憑證裡的 RSA 公鑰加密 body，再與對方附的密文比對', '用雙方共享的 secret 對 body 算 HMAC，常數時間比對簽章', '把 body 做 base64 編碼後比對對方附的值，結果一致就代表沒被改'],
        answer: 2,
        explain: '純雜湊（SHA-256）任何人都能算，攻擊者改了 body 也能附上正確的雜湊，證明不了來源；HMAC 需要 secret，沒有 secret 算不出正確簽章，同時保證來源與完整性。加密解決的是「藏內容」，base64 只是編碼。比對簽章要用 `hmac.compare_digest` 這類常數時間函式，避免 timing attack。',
      },
      {
        q: '產生「重設密碼」連結裡的 token，下面哪個寫法是對的？',
        code: 'import random, secrets\ntoken_a = str(random.randint(0, 10**12))\ntoken_b = secrets.token_urlsafe(32)',
        lang: 'python',
        options: ['token_a：12 位數字有一兆種組合，猜中機率很低，放在網址也比較短', 'token_b：`random` 的輸出可預測，`secrets` 不行', '兩者都可以：重設連結的效期很短，攻擊者來不及猜，差別只在長度', '都不行：token 要用使用者的 email 加上時間戳做 SHA-256，才對得到帳號'],
        answer: 1,
        explain: '`random` 是 Mersenne Twister，觀察夠多輸出就能推算之後的值，不能用在任何安全用途。`secrets` 模組（底層 `os.urandom`）是 CSPRNG，專為 token、session id、salt 設計。用 email 做 SHA-256 任何人都能重現，等於沒有秘密。',
      },
      {
        q: '系統有五個微服務都要驗證同一個 JWT。用 HS256 與 RS256 的關鍵差別是什麼？',
        options: ['HS256 要把同一把 secret 發給五個服務，RS256 只需散布公鑰', 'RS256 驗證比 HS256 快很多，五個服務都驗證時整體延遲比較低', 'HS256 的 token 比較短，放在 Authorization 標頭比較不會超過大小限制', '兩者安全性相同：secret 夠長時，五個服務共用同一把也不會增加風險'],
        answer: 0,
        explain: 'HS256 是對稱的：能驗就能簽，五個服務都拿得到 secret，攻擊面變五倍。RS256 / ES256 是非對稱的：私鑰只在授權伺服器，其他服務拿公鑰只能驗不能簽。代價是 RSA 簽章與驗證較慢、token 較長（ES256 好一些）。多服務架構幾乎都選非對稱。',
      },
    ],
  },
  {
    skill: 'resilience',
    questions: [
      {
        q: '付款供應商的 API 偶爾會卡住不回應。你的 API 在高峰時整站 502，機器 CPU 卻很低。最可能的原因是？',
        options: ['資料庫連線池太小，請求都在排隊等連線', '付款 API 的呼叫沒設 timeout，worker 全被卡住', '付款供應商把你的 IP 列入限流，回應全變成 429', 'nginx 的 worker_processes 太少，擋不住高峰的連線數'],
        answer: 1,
        explain: '沒有 timeout 的呼叫會無限等待；每個等待中的請求握著一個 worker（或 event loop 裡的一個 task 與連線）。供應商一卡，worker 逐一被耗光，新請求進不來就 502，而 CPU 因為大家都在「等」所以很低。每個對外呼叫都要有明確的連線與讀取 timeout，這是韌性的第一條。連線池太小時請求會在應用內排隊、通常看到的是 pool timeout；被限流會收到 429 而不是卡住；nginx worker 不足時 CPU 也不會低到這種程度。',
      },
      {
        q: '下面哪一種請求**不應該**自動重試？',
        options: ['`GET /orders/42` 回 503 並帶 `Retry-After: 2`', '`PUT /orders/42` 逾時', '`POST /orders`（沒有 Idempotency-Key）連線中斷', '`DELETE /orders/42` 回 502'],
        answer: 2,
        explain: 'GET / PUT / DELETE 是冪等的，重送結果一樣，遇到 5xx 或逾時可以退避重試。沒有冪等鍵的 POST 重送可能建立第二筆訂單，連線中斷時你根本不知道第一次有沒有成功。要重試 POST 必須先有 Idempotency-Key。另外 4xx 通常不值得重試，再打也是一樣的錯。',
      },
      {
        q: '重試時為什麼要在退避時間上加隨機抖動（jitter）？',
        options: ['讓每次重試的 log 時間戳不同，方便區分第幾次', '錯開各客戶端的重試時間，避免同時重打', 'RFC 9110 要求重試間隔必須隨機', '讓單一客戶端的平均等待變短，重試更快成功'],
        answer: 1,
        explain: '服務短暫故障時，所有客戶端幾乎同時失敗；若退避時間固定（都等 1 秒），它們會在同一瞬間一起重試，把剛恢復的服務再打倒（thundering herd）。加上隨機抖動把重試分散在時間軸上。抖動不會讓單一客戶端更快成功，HTTP 規範也沒有要求隨機間隔；指數退避 + 抖動 + 次數上限是常見的組合。',
      },
    ],
  },
  {
    skill: 'db-operations',
    questions: [
      {
        q: '團隊說「我們每天都有自動備份」。哪一個問題最能檢驗這句話有沒有意義？',
        options: ['上一次從備份還原成功是什麼時候、花了多久？', '備份檔每天的大小是否穩定，有沒有突然縮小？', '備份用 pg_dump 還是磁碟快照，各保留幾天、幾份？', '備份是否存在另一個區域，並且有加密？'],
        answer: 0,
        explain: '沒還原過的備份不算備份：檔案可能損壞、格式不對版本、還原步驟沒人會、或還原要 8 小時而業務只能容忍 1 小時。定期演練還原並記錄 RTO，才知道備份能不能用。其他問題都重要，但都不能證明備份「有用」。',
      },
      {
        q: 'API 有 4 個 uvicorn worker，每個 worker 的 SQLAlchemy 連線池 pool_size=20、max_overflow=10；PostgreSQL 的 max_connections=100。流量一高就出現 too many connections。為什麼？',
        code: 'workers = 4\nper_worker_max = 20 + 10   # pool_size + max_overflow\nprint(workers * per_worker_max)  # 120 > 100',
        lang: 'python',
        options: ['PostgreSQL 的 max_connections 預設太小，改成 1000 就好', '每個 worker 各有一個池，合計最多 120 條，超過 100', 'SQLAlchemy 用完連線沒有歸還，池子一直漏連線', 'worker 共用同一個池，pool_size 要除以 worker 數才對'],
        answer: 1,
        explain: '每個 worker 是獨立程序、各自一個連線池，總需求是 worker 數 × 每池上限，4 × 30 = 120。PostgreSQL 每條連線是一個程序，把 max_connections 拉到 1000 會吃掉大量記憶體並拖慢整體，不是解法。正確做法是讓總和小於 max_connections（縮池），或用 pgbouncer 這類連線池代理讓上百個應用連線共用少量真實連線。',
      },
      {
        q: '要找出「哪條查詢最值得優化」，哪個資訊來源最直接？',
        options: ['資料庫主機 CPU 使用率最高的時段，對照那時的請求', '`pg_stat_user_tables` 裡 seq_scan 次數最多的表', '慢查詢 log 裡單次耗時最長的那一條', '`pg_stat_statements` 依 total_exec_time 排序'],
        answer: 3,
        explain: '`pg_stat_statements` 記錄每種查詢的呼叫次數、總耗時、平均耗時，依總耗時（PostgreSQL 13 起欄位叫 total_exec_time）排序就是「最值得優化」的清單：一條 5ms 但每秒跑一萬次的查詢，可能比一條 2 秒的報表更值得改。慢查詢 log 只抓單次超過門檻的，看不出高頻的短查詢累積多少時間。seq_scan 次數多的表不一定慢（小表全掃很正常）；CPU 高峰是間接證據。',
      },
    ],
  },
]

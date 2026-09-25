// 題庫：後續新增的技能（linux-basics / crypto-toolbox / resilience / db-operations）
export default [
  {
    skill: 'linux-basics',
    questions: [
      {
        q: '`docker stop` 送出 SIGTERM 後等了 10 秒容器才停，最可能的原因是什麼？',
        options: ['容器的 PID 1 程序沒有處理 SIGTERM，Docker 等到逾時改送 SIGKILL', 'Docker 預設會先等 10 秒再送任何訊號', '容器裡的程式碼有 sleep(10)', 'SIGTERM 需要 root 權限，非 root 程序收不到'],
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
        options: ['volume 只能唯讀，Docker 不允許容器寫入掛載目錄', '容器內的程序以非 root 的 UID 執行，而主機目錄的擁有者是別的 UID，權限對不上', '容器需要加 `--privileged` 才能寫檔', 'Linux 檔案系統不支援容器寫入'],
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
        options: ['對 body 做 SHA-256，比對對方附的雜湊值', '用 AES 把 body 加密後再比對', '用雙方共享的 secret 對 body 算 HMAC，與對方附的簽章做常數時間比對', '用 base64 編碼 body 再比對'],
        answer: 2,
        explain: '純雜湊（SHA-256）任何人都能算，攻擊者改了 body 也能附上正確的雜湊，證明不了來源；HMAC 需要 secret，沒有 secret 算不出正確簽章，同時保證來源與完整性。加密解決的是「藏內容」，base64 只是編碼。比對簽章要用 `hmac.compare_digest` 這類常數時間函式，避免 timing attack。',
      },
      {
        q: '產生「重設密碼」連結裡的 token，下面哪個寫法是對的？',
        code: 'import random, secrets\ntoken_a = str(random.randint(0, 10**12))\ntoken_b = secrets.token_urlsafe(32)',
        lang: 'python',
        options: ['token_a：數字比較短，放在網址裡方便', 'token_b：`secrets` 用作業系統的密碼學安全亂數，`random` 可預測', '兩者都可以，差別只在長度', '都不行，token 必須用使用者的 email 做 SHA-256'],
        answer: 1,
        explain: '`random` 是 Mersenne Twister，觀察夠多輸出就能推算之後的值，不能用在任何安全用途。`secrets` 模組（底層 `os.urandom`）是 CSPRNG，專為 token、session id、salt 設計。用 email 做 SHA-256 任何人都能重現，等於沒有秘密。',
      },
      {
        q: '系統有五個微服務都要驗證同一個 JWT。用 HS256 與 RS256 的關鍵差別是什麼？',
        options: ['HS256 要把同一把 secret 發給五個服務（任一個外洩就能偽造 token）；RS256 只需散布公鑰，只有持私鑰的發行者能簽', 'RS256 比 HS256 快很多，所以微服務都用 RS256', 'HS256 的 token 比較短，適合放在 header', '兩者安全性相同，只是演算法名稱不同'],
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
        options: ['資料庫連線數不夠', '對付款 API 的呼叫沒有設 timeout，卡住的請求把所有 worker 都占住了', '付款供應商封鎖了你的 IP', 'nginx 的 worker_processes 太少'],
        answer: 1,
        explain: '沒有 timeout 的呼叫會無限等待；每個等待中的請求握著一個 worker（或 event loop 裡的一個 task 與連線）。供應商一卡，worker 逐一被耗光，新請求進不來就 502，而 CPU 因為大家都在「等」所以很低。每個對外呼叫都要有明確的連線與讀取 timeout，這是韌性的第一條。',
      },
      {
        q: '下面哪一種請求**不應該**自動重試？',
        options: ['`GET /orders/42` 回 503', '`PUT /orders/42` 逾時', '`POST /orders`（沒有 Idempotency-Key）連線中斷', '`DELETE /orders/42` 回 502'],
        answer: 2,
        explain: 'GET / PUT / DELETE 是冪等的，重送結果一樣，遇到 5xx 或逾時可以退避重試。沒有冪等鍵的 POST 重送可能建立第二筆訂單——連線中斷時你根本不知道第一次有沒有成功。要重試 POST 必須先有 Idempotency-Key。另外 4xx 通常不值得重試，再打也是一樣的錯。',
      },
      {
        q: '重試時為什麼要在退避時間上加隨機抖動（jitter）？',
        options: ['讓 log 比較好看', '避免大量客戶端在同一時刻一起重打，造成第二波流量尖峰（thundering herd）', '因為 HTTP 規範要求', '抖動可以讓重試更快成功'],
        answer: 1,
        explain: '服務短暫故障時，所有客戶端幾乎同時失敗；若退避時間固定（都等 1 秒），它們會在同一瞬間一起重試，把剛恢復的服務再打倒。加上隨機抖動把重試分散在時間軸上。指數退避 + 抖動 + 次數上限是標準組合。',
      },
    ],
  },
  {
    skill: 'db-operations',
    questions: [
      {
        q: '團隊說「我們每天都有自動備份」。哪一個問題最能檢驗這句話有沒有意義？',
        options: ['上一次成功從備份還原回來是什麼時候、花了多久？', '備份檔多大？', '備份用的是 pg_dump 還是快照？', '備份存在哪個雲端？'],
        answer: 0,
        explain: '沒還原過的備份不算備份：檔案可能損壞、格式不對版本、還原步驟沒人會、或還原要 8 小時而業務只能容忍 1 小時。定期演練還原並記錄 RTO，才知道備份真的能救你。其他問題都重要，但都不能證明備份「有用」。',
      },
      {
        q: 'API 有 4 個 uvicorn worker，每個 worker 的 SQLAlchemy 連線池 pool_size=20、max_overflow=10；PostgreSQL 的 max_connections=100。流量一高就出現 too many connections。為什麼？',
        code: 'workers = 4\nper_worker_max = 20 + 10   # pool_size + max_overflow\nprint(workers * per_worker_max)  # 120 > 100',
        lang: 'python',
        options: ['PostgreSQL 的 max_connections 預設太小，改成 1000 就好', '4 個 worker 各自最多開 30 條連線，合計 120 條超過 100；要縮小池或在前面放 pgbouncer', 'SQLAlchemy 的連線池有 bug', 'uvicorn 應該改成單 worker'],
        answer: 1,
        explain: '每個 worker 是獨立程序、各自一個連線池，總需求是 worker 數 × 每池上限。PostgreSQL 每條連線是一個程序，把 max_connections 拉到 1000 會吃掉大量記憶體並拖慢整體，不是解法。正確做法是讓總和小於 max_connections（縮池），或用 pgbouncer 這類連線池代理讓上百個應用連線共用少量真實連線。',
      },
      {
        q: '要找出「哪條查詢最值得優化」，哪個資訊來源最直接？',
        options: ['看應用程式的 CPU 使用率', '把所有表都加索引再觀察', '問前端哪個頁面最慢', '`pg_stat_statements` 依總耗時排序，或慢查詢 log（`log_min_duration_statement`）'],
        answer: 3,
        explain: '`pg_stat_statements` 記錄每種查詢的呼叫次數、總耗時、平均耗時，依總耗時排序就是「最值得優化」的清單（一條 5ms 但每秒跑一萬次的查詢可能比一條 2 秒的報表更值得改）。慢查詢 log 則抓單次超過門檻的。到處加索引會拖慢寫入且未必命中；CPU 與前端感受都是間接證據。',
      },
    ],
  },
]

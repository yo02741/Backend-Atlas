// 領域 8：演算法與系統設計 — 技能內文：重點 points / 自我檢核 checklist / 延伸閱讀 refs；索引在 ../d8-algo.js
import l4 from './parts/d8-algo-l4.js'
import m1 from './parts/d8-algo-m1.js'
import m3 from './parts/d8-algo-m3.js'
const base = {
  'big-o': {
    challenge: {
      task: '在 Playground 跑本課「Python：list、set 與排序後二分搜尋」那段，n 依序設成 1,000、2,000、4,000、8,000，每個 n 跑兩次取較小的時間。算出相鄰兩級的時間倍數，依倍數判斷每一欄的複雜度，再預測 n = 16,000 的時間，最後實際跑一次對答案。',
      deliver: '一張表：n、每種寫法的時間、相鄰兩級的倍數、你判斷的複雜度，加上 n = 16,000 的預測值與實測值。',
      check: [
        '倍數接近 4 的判成 O(n²)、接近 2 的判成 O(n) 或 O(n log n)，判斷和程式的寫法對得上',
        '預測與實測差距在兩倍以內；超過的寫出可能原因（Pyodide 暖機、計時解析度、記憶體配置）',
        '指出哪一欄在小 n 時倍數不穩，以及要怎麼量才看得出它的成長',
      ],
      twist: '需求變化：每一筆都要查一次資料庫（N+1），每次往返 2 ms。先預測 n 翻倍時這一欄的時間怎麼變，以及它和巢狀 list 那欄哪一個先超過 1 秒，再用 `time.sleep(0.002)` 模擬驗證（n 用小一點的值）。',
    },
    points: [
      { b: 'Big-O 是成長率', t: '不是秒數。它回答「資料變十倍時，時間變幾倍」：O(n) 十倍、O(n²) 百倍、O(log n) 幾乎不變。' },
      { b: '後端最貴的是 I/O 次數', t: '一次 DB 往返 ≈ 幾十萬次 CPU 運算。所以 O(n) 次查詢比 O(n²) 次記憶體運算還慘。' },
      { b: 'N+1 是 O(n) 次 I/O', t: '取 n 篇文章再各查作者 = n+1 次查詢。JOIN 或 `WHERE id IN (...)` 變 2 次。' },
      { b: 'dict / set 是 O(1)', t: 'Python 裡「在 list 裡找」是 O(n)、「在 set 裡找」是 O(1)。兩個 list 對照要先把一個轉成 dict。' },
      { b: '常數在小 n 時贏', t: 'n = 20 時 O(n) 掃描可能比走索引快，所以資料庫會自己選 Seq Scan。別為小資料過度優化。' },
    ],
    checklist: [
      '能為五種複雜度各舉一個後端例子',
      '能在 code review 時指出 N+1 與 list 巢狀查找',
    ],
    refs: [
      { label: 'Wikipedia：Big O notation', url: 'https://en.wikipedia.org/wiki/Big_O_notation' },
    ],
  },
  'data-structures': {
    challenge: {
      task: '物流公司的配送提醒：每筆包裹有一個「下次提醒時間」，worker 每秒取出到期的提醒，原本照本課開頭改用 heap。業務新增兩個操作：收件人可以取消提醒，或把時間改晚（尖峰每秒約 1 萬次）。先寫出原方案四個操作（新增、取最早到期、取消、改時間）的複雜度，再在 Playground 用 `heapq` 加一個 dict 做「惰性刪除」（取消時只標記，pop 到才丟），用 10 萬筆提醒、其中 30% 被取消或改時間跑一次。',
      deliver: '四個操作的複雜度表（原方案與惰性刪除各一欄），加上模擬跑完時 heap 的實際長度與有效提醒數。',
      check: [
        '原方案的「取消」寫成 O(n)（要在 heap 裡找到它），惰性刪除版寫成 O(1) 標記加上 pop 時的額外成本',
        '模擬印出 heap 長度與有效提醒數，並算出被浪費的比例',
        '寫出什麼時候要重建 heap（例如失效比例超過一半），以及重建的成本',
        '列出哪些條件可以沿用原設計（只取最早到期的），哪些要跟物流業務確認（取消比例、提醒能不能晚幾秒送出、改時間能不能改早）',
      ],
      twist: '業務改口：改時間也可以改「早」。先預測惰性刪除版還正不正確、哪一種情況會讓提醒晚送，再修改程式驗證。',
    },
    points: [
      { b: 'hash map / set：O(1) 查找', t: '去重、對照表、計數（`Counter`）、快取。Redis 的 hash / set 也是。' },
      { b: 'deque / queue：先進先出', t: '工作佇列、滑動視窗、BFS。`collections.deque` 兩端 O(1)。' },
      { b: 'heap：永遠取最小 / 最大', t: '`heapq` 做排程（下一個到期的任務）、top-k、合併多個排序流。' },
      { b: 'B-tree：磁碟友善的排序樹', t: '一個節點裝很多 key、樹很矮 → 幾次磁碟讀取就找到。關聯式資料庫的預設索引嚴格說是 B+tree：資料只在葉節點、葉節點串成鏈，所以範圍掃描（BETWEEN、ORDER BY）特別快。' },
      { b: '圖：關係與依賴', t: '權限繼承、任務依賴（拓樸排序）、推薦、社交關係。DAG 的拓樸排序在 CI 排 job 順序也用到。' },
    ],
    checklist: [
      '能為「去重」「top 10」「任務排程」「依賴排序」各挑一個結構',
      '能解釋為什麼資料庫索引用 B-tree 而不是二元搜尋樹',
    ],
    refs: [
      { label: 'Python collections', url: 'https://docs.python.org/3/library/collections.html' },
      { label: 'Python heapq', url: 'https://docs.python.org/3/library/heapq.html' },
    ],
  },
  'rate-limiting': {
    challenge: {
      task: '票務網站開賣：一間公司 50 位員工共用一個出口 IP，每人每秒查 1 次座位；另一個 IP 是一支每秒打 50 次的爬蟲。在 Playground 以本課的 `TokenBucket` 為基礎，模擬 60 秒、兩種設定：(1) 每 IP 一個 bucket（每秒 10 個、容量 20）；(2) 每 IP 一個寬鬆的 bucket（每秒 60 個）加上每帳號一個 bucket（每秒 2 個、容量 5）。動手前先預測兩種設定下員工與爬蟲各自的通過率。',
      deliver: '一張表：兩種設定下，公司 IP 後的員工與爬蟲各自的通過率，加上一段判斷：哪種設定對誰不公平、為什麼。',
      check: [
        '設定 (1) 的結果顯示員工與爬蟲的通過率接近（都約兩成），並能解釋原因',
        '設定 (2) 員工的通過率明顯上升、爬蟲仍被擋住大半，數字是模擬印出來的',
        '寫出被擋時的回應：狀態碼與要帶的標頭（例如 `Retry-After`）',
        '列出哪些條件可以沿用登入端點的限流設計，哪些要跟票務業務重新確認（一個帳號替多人購票、開賣前排隊、團體帳號）',
      ],
      twist: '爬蟲改成輪流使用 50 個帳號。先預測設定 (2) 還擋不擋得住、要再加哪一層，再改模擬驗證。',
    },
    points: [
      { b: 'token bucket', t: '桶子固定速率補 token、每個請求拿一個、沒了就拒絕。容量決定能吃多大的暴衝，速率決定長期上限。' },
      { b: '固定視窗的邊界問題', t: '每分鐘 100 次：59 秒打 100 次、61 秒再打 100 次 = 2 秒內 200 次。滑動視窗（log 或加權）修正這點。' },
      { b: 'key 用什麼', t: '登入用帳號 + IP、API 用 user id 或 API key、公開端點用 IP（注意 NAT 後很多人共用一個 IP）。' },
      { b: '回應要說清楚', t: '429 + `Retry-After`、`X-RateLimit-Limit / Remaining / Reset`，客戶端才能正確退避。' },
      { b: '放在哪一層', t: 'nginx 擋粗的（每 IP）、應用層擋細的（每使用者、每動作）；多實例要用 Redis 共享計數。' },
    ],
    checklist: [
      '能用 Redis 實作 token bucket 或滑動視窗',
      '能說出固定視窗的問題與兩種修法',
    ],
    refs: [],
  },
  'lru-cache': {
    challenge: {
      task: '電商的商品價格快取：容量 3、每個 key 的 TTL 10 秒。把本課的 `LRUCache` 改成 `put(key, value, now)` 時記下到期時間，`get(key, now)` 遇到過期就當 miss 並刪掉。用這串操作：t=0 put A、t=1 put B、t=2 put C、t=3 get A、t=4 put D、t=5 get B、t=11 get A、t=13 get C、t=13 put E、t=13.5 get D。先在紙上畫時間線，預測每次 get 是 hit 或 miss、miss 的原因是「到期」還是「被淘汰」，再在 Playground 跑一次對答案。',
      deliver: '一張時間線表：時間、操作、快取內容（由新到舊）、hit 或 miss、原因，預測與實測各一欄。',
      check: [
        '至少一次 miss 標成「被淘汰」、至少一次標成「到期」，且原因和程式的實際行為一致',
        '說明已經過期、還沒被讀到的 key 在容量滿時會不會先被丟掉，以及你的實作怎麼處理',
        '寫出哪些條件可以沿用，哪些要跟業務確認（價格可以舊幾秒、改價時要不要主動刪 key、結帳時能不能讀快取）',
      ],
      twist: '容量改成 5、TTL 改成 3 秒。先預測哪幾次 miss 的原因會從「被淘汰」變成「到期」，再跑一次驗證。',
    },
    points: [
      { b: 'LRU 的實作', t: 'hash map + 雙向鏈結串列：查找 O(1)、每次存取把節點移到頭、滿了砍尾。Python 的 `OrderedDict` 幾行就能寫。' },
      { b: 'Redis 的 maxmemory-policy', t: '`allkeys-lru`（全部都可淘汰）、`volatile-lru`（只淘汰有 TTL 的）、`noeviction`（滿了就報錯）。當快取用要設前者。' },
      { b: '程序內快取的陷阱', t: '`lru_cache` 每個 worker 各一份、重啟就沒、多實例不一致。適合純函式與設定，不適合使用者資料。' },
      { b: '命中率是唯一指標', t: '監控 hit / (hit + miss)；低於預期就檢查 key 設計、TTL、容量。' },
    ],
    checklist: [
      '能用 OrderedDict 實作一個 LRU cache',
      '能說出 allkeys-lru 與 volatile-lru 的差別',
    ],
    refs: [
      { label: 'Redis：Key eviction', url: 'https://redis.io/docs/latest/develop/reference/eviction/' },
    ],
  },
  'concurrency-bugs': {
    challenge: {
      task: '演唱會票務的最後一張票：在 Playground 用 asyncio 寫兩個 task 搶票，流程是「讀剩餘張數 → await 付款確認 → 剩餘張數減一、發票」。不要靠多跑幾次碰運氣：用 `asyncio.Event` 控制兩個 task 的先後，讓「兩人都在對方扣票前讀到 1」這個交錯每次都發生。重現之後用 `asyncio.Lock` 或「條件更新」（扣票時檢查剩餘張數仍大於 0）修好，用同一個交錯腳本證明修好了。',
      deliver: '交錯順序表（每一步是哪個 task、做什麼、看到的剩餘張數），以及修正前後各連續跑 20 次的結果。',
      check: [
        '修正前 20 次都賣出兩張，不是「偶爾」',
        '修正後在同一個交錯腳本下 20 次都只賣出一張',
        '說明你的修法在 4 個 worker、2 台主機時還有沒有效；沒有效的話改用哪一個資料庫的做法',
        '列出哪些條件可以沿用，哪些要跟票務業務確認（付款失敗後票何時退回、保留座位多久）',
      ],
      twist: '規則改成「每人限購 2 張、總共 100 張」，同一個人可能開兩個分頁同時買。先預測原本的交錯腳本還抓不抓得到新的 bug，再寫出要多重現的那一種交錯。',
    },
    points: [
      { b: '兩種基本形狀', t: 'check-then-act（「沒有就建立」「餘額夠就扣」）與 read-modify-write（`count += 1`）。只要「查」和「做」之間能插進別人，就會出現重複建立與 lost update。' },
      { b: '程式內：執行緒與 async', t: 'GIL 不保證 `x += 1` 是原子的；asyncio 只在 `await` 切換，所以兩個 `await` 之間的程式不會被同一個 loop 的其他 task 打斷，但「查」和「做」中間隔著 `await` 就會出事。用 `threading.Lock` / `asyncio.Lock` 把整段包起來。' },
      { b: '跨程序、跨主機：交給唯一的仲裁者', t: '多個 worker、多台主機時程式內的鎖沒用。讓資料庫判斷：條件更新（`UPDATE … WHERE stock > 0`）、唯一約束 + `ON CONFLICT`、`SELECT … FOR UPDATE`、樂觀鎖的 version 欄位。' },
      { b: '重複提交用冪等鍵', t: '連點兩次、逾時重試、佇列重送都會讓同一個動作到達兩次。客戶端為每個動作產生一個 key，伺服器用唯一約束記住它，第二次直接回第一次的結果。' },
      { b: '死結：四個條件缺一不可', t: '互斥、持有並等待、不可搶占、循環等待。實務上破壞循環等待最簡單：一律依固定順序（例如 id 由小到大）上鎖；再加上鎖等待逾時，讓卡住的一方失敗重試。' },
    ],
    checklist: [
      '能在一段程式裡指出 check-then-act 或 read-modify-write，並說明在多 worker 下為什麼程式內的鎖不夠',
      '能用條件更新、唯一約束或冪等鍵改寫一個「重複建立」的 bug',
      '能說出死結的四個條件，並用固定上鎖順序修好一個轉帳死結',
    ],
    refs: [
      { label: 'Python：asyncio Synchronization Primitives', url: 'https://docs.python.org/3/library/asyncio-sync.html' },
      { label: 'PostgreSQL：Explicit Locking', url: 'https://www.postgresql.org/docs/current/explicit-locking.html' },
      { label: 'PostgreSQL：INSERT（ON CONFLICT）', url: 'https://www.postgresql.org/docs/current/sql-insert.html' },
    ],
  },
  'queues-workers': {
    challenge: {
      task: '物流的出貨工作：worker 收到一張出貨單，要扣庫存、寫出貨紀錄、寄出貨通知。在 Playground 以本課「重新投遞與冪等的消費者」那段 sqlite 程式為基礎，讓同一個工作被投遞兩次：第一次在扣完庫存、還沒 ack 時讓 worker 丟出例外。分別跑「不冪等」與「冪等」兩版，比較最終狀態。',
      deliver: '一張最終狀態表：兩版各自的庫存、出貨紀錄筆數、寄出的通知數，加上崩潰點的說明。',
      check: [
        '不冪等版多扣了庫存或多寄了通知，數字和崩潰點對得上',
        '冪等版的最終狀態和只投遞一次相同',
        '說明寄通知這種外部副作用為什麼不能靠同一個資料庫交易保證，你用了什麼（冪等鍵、outbox）',
        '列出哪些條件可以沿用，哪些要跟物流業務確認（重複通知能不能接受、通知能不能晚一點寄）',
      ],
      twist: '崩潰點改到「寄出通知之後、寫入處理紀錄之前」。先預測冪等版會不會寄出第二封，再跑一次驗證並寫出修法。',
    },
    points: [
      { b: '生產者 / 佇列 / 消費者', t: 'API 把任務（含參數）放進佇列就回 202；worker 程序取出執行；狀態存 DB 讓前端輪詢或推播。' },
      { b: 'at-least-once 代表會重複', t: 'worker 做到一半掛了任務會重投，所以消費者要冪等：用任務 id 去重、或操作本身可重複執行。' },
      { b: '重試與死信', t: '失敗重試要指數退避、有上限；超過就進死信佇列給人看，不要無限重試塞爆佇列。' },
      { b: 'outbox 模式', t: '「存 DB 並發事件」要原子：事件先寫進同一交易的 outbox 表，再由另一個程序送出。直接在交易裡發 MQ 會有一邊成功一邊失敗。' },
      { b: 'Kafka 不是任務佇列', t: '它是可重播的事件日誌，適合多消費者、事件溯源；單純的背景任務用 Redis / RabbitMQ 簡單得多。' },
    ],
    checklist: [
      '能把「註冊後寄歡迎信」改成佇列 + worker，且重複執行不會寄兩封',
      '能說出 at-least-once 與 exactly-once 的差別',
    ],
    refs: [],
  },
  'job-scheduling': {
    challenge: {
      task: '餐廳訂位系統在紐約有分店，每天當地 01:30 寄出當天的訂位提醒。列出 2026 年 10 月 31 日到 11 月 2 日三天，紐約當地 01:30 對應的 UTC 時刻（11 月 1 日美國東部結束夏令時間，可以用課文的 cron 解析器搭配固定時差 −4 與 −5 小時換算；Pyodide 沒有時區資料庫）。比較兩種寫法：UTC 主機上的 `30 5 * * *`，以及 Kubernetes CronJob 設 `timeZone: America/New_York` 的 `30 1 * * *`。',
      deliver: '一張表：日期、當地 01:30 的 UTC 時刻、兩種寫法各自在哪個 UTC 時刻觸發（或不觸發），加上這個工作的冪等鍵設計。',
      check: [
        '指出 11 月 1 日當地 01:30 出現兩次（UTC 05:30 與 06:30），以及 UTC 那一種寫法從 11 月 2 日起變成在當地 00:30 寄出',
        'CronJob 在重複的那一小時跑一次還是兩次，寫出你查的是哪一份官方文件；查不到就寫「不確定」並說明怎麼在 kind 叢集上驗證',
        '冪等鍵用「分店 + 當地日期」而不是 UTC 時間戳，並說明原因',
        '列出哪些條件可以沿用本課的設計（執行紀錄表、補跑規則），哪些要跟業務確認（錯過了還寄不寄、晚寄的上限）',
      ],
      twist: '業務改成「用餐前一天當地 18:00 寄」，每筆訂位各自計算送出時間，不再用一條 cron。先預測夏令時間的問題還在不在、會換成什麼新問題（例如每分鐘掃描的查詢與補送），再寫出新的冪等鍵。',
    },
    points: [
      { b: 'cron 五個欄位', t: '分、時、日、月、星期；`*/15` 每 15 分、`1-5` 範圍、`0,30` 列舉。cron 用的是主機（容器通常是 UTC）的時區；日與星期都指定時，傳統 cron 是「任一個符合就跑」。' },
      { b: '多台主機會重複執行', t: '排程寫在 web 程序裡、開三個副本就跑三次。解法：獨立只跑一份的排程程序、Kubernetes CronJob、資料庫 advisory lock，或最穩的「執行紀錄表 + 唯一約束」：誰先插入 (job, 排定時間) 誰執行。' },
      { b: '錯過的不會自己補', t: '主機停機、部署中的那一刻過了就過了（systemd timer 的 `Persistent=true`、CronJob 的 `startingDeadlineSeconds` 各有自己的規則）。更好的設計是處理「上次成功之後的所有資料」，而不是「昨天」。' },
      { b: '工作要冪等', t: '重複觸發與重試一定會發生。用「排定時間」而不是「實際開始時間」決定處理範圍，結果用 upsert 寫入，寄信等副作用記錄 (對象, 期間) 防重送。' },
      { b: '時區、逾時與 heartbeat', t: '有夏令時間的時區，某些當地時間一年會不存在一次、重複一次；排程盡量用 UTC 寫。長工作要設逾時與防重疊（CronJob `concurrencyPolicy: Forbid`），成功時送 heartbeat，監控在「該到沒到」時告警。' },
    ],
    checklist: [
      '能讀寫 cron 表達式，並說出它是用哪個時區解讀',
      '能為部署成多副本的服務設計「同一時間只執行一次」的排程，並說明主機在執行中掛掉時會怎樣',
      '能為一個每日工作設計補跑與冪等策略，以及「根本沒跑」時的告警',
    ],
    refs: [
      { label: 'Kubernetes：CronJob', url: 'https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/' },
      { label: 'PostgreSQL：System Administration Functions（Advisory Lock Functions）', url: 'https://www.postgresql.org/docs/current/functions-admin.html' },
    ],
  },
  'scaling': {
    challenge: {
      task: '在 Playground 跑本課的容量模型，記下 API 從 1 台加到 32 台時每一級的瓶頸與連線數。接著替一個「API 已經無狀態、可以任意加台數」的服務列出所有共用依賴：資料庫主庫、Redis、負載平衡器、物件儲存、外部金流 API、跑 cron 的那台主機、migration job，逐項標出：加 API 台數之後它還是不是單點、它壞掉時哪個請求失敗、怎麼驗證（例如在 staging 停掉它看哪些端點回 5xx）。',
      deliver: '容量模型的結果表，加上一份單點清單，每項有「仍是單點嗎」「壞掉時的影響」「驗證方法」三欄。',
      check: [
        '清單至少 5 項，每一項的驗證方法是可以實際操作的步驟',
        '從模型結果指出 API 加到幾台時瓶頸換成資料庫、加到幾台時連線數超過 `max_connections`',
        '至少一項依賴是「API 加越多台，它越危險」，並附模型裡的數字',
      ],
      twist: '票務網站把熱門場次的座位查詢改走 Redis 快取，命中率 90%。先預測單點清單哪一項的影響會從「變慢」變成「整站買不了票」，以及模型裡的瓶頸會換到哪裡，再用 `capacity(n, cache_hit=0.9)` 驗證。',
    },
    points: [
      { b: 'API 無狀態', t: 'session 放 Redis、檔案放物件儲存、程序內不存跨請求資料。這樣任何一台都能服務任何請求，前面放負載平衡器就能加台。' },
      { b: '資料庫先垂直', t: '加 CPU / 記憶體、調索引、加連線池，通常撐很久。別太早分散。' },
      { b: '讀寫分離', t: '寫主庫、讀副本。副本有延遲，「寫完立刻讀」要讀主庫（read-your-writes）。' },
      { b: '分片是最後手段', t: '依 tenant / user id 把資料拆到不同庫。跨分片 JOIN 與交易都很痛，非必要不做。' },
      { b: '瓶頸要量測', t: '壓測（k6、locust）找出第一個爆的地方；通常是 DB 連線或某條慢查詢，不是 CPU。' },
    ],
    checklist: [
      '能檢查自己的 API 是否無狀態、列出讓它有狀態的地方',
      '能畫出一主多讀的架構並說明延遲問題怎麼處理',
    ],
    refs: [],
  },
  'distributed-basics': {
    challenge: {
      task: '把本課的 `Cluster` 改成庫存：t=0 主庫寫入 `stock = 1`（最後一件），t=10 顧客 A 下單寫入 `stock = 0`。顧客 B 在 t=11、t=12、t=13 各查一次，分別用三種讀法：讀副本、讀主庫、`read_your_writes`（想一想 B 沒寫過，要給哪個版本）。延遲 `lag` 用 3 和 10 各跑一次。動手前先預測每一格讀到的值。',
      deliver: '一張讀值表（時間 × 讀法 × lag），預測與實測各一欄，加上判斷：「下單前檢查庫存」與「商品頁顯示剩幾件」各可以接受哪一種讀法。',
      check: [
        '每個讀值都能對回寫入時間與延遲',
        '指出至少一個讀到舊值、會讓 B 以為還能買的時間點',
        '說明 `read_your_writes` 對 B 沒有幫助的原因，以及下單時防止超賣的做法（讀主庫或條件更新）',
        '列出哪些條件可以沿用，哪些要跟業務確認（商品頁的「剩 1 件」能不能晚幾秒更新、超賣時怎麼處理）',
      ],
      twist: '業務要求商品頁顯示「剩 1 件」時一定要準。先預測要改成哪一種讀法、主庫的讀取量會增加多少，以及有沒有不用每次讀主庫的替代方案。',
    },
    points: [
      { b: '逾時不等於失敗', t: '呼叫另一個服務逾時，可能是請求沒到、對方做完但回應丟了、或對方還在做。三種情況從呼叫端看起來一樣，所以重試的操作必須冪等。' },
      { b: 'CAP：分區時的取捨', t: '網路分區一定會發生，分區期間只能選：拒絕部分請求以維持一致（C），或照常回應但可能回舊資料（A）。沒有分區時兩者都能有，取捨變成延遲與一致性。不是「三選二任選」。' },
      { b: '一致性有很多層級', t: '強一致（像只有一份資料）、讀己所寫、單調讀、最終一致。非同步複製的副本有延遲，「寫完立刻讀」要讀主庫或帶版本讀，見設計情境「讀寫分離後的我剛存的怎麼不見了」。' },
      { b: '時鐘不能拿來排序', t: '各主機的時鐘會漂移、NTP 校正時可能往回跳。用不同主機的時間戳做「最後寫入者勝」會吃掉更新；量時間間隔用 monotonic clock，排序用資料庫序號、版本號或邏輯時鐘。' },
      { b: '跨服務交易：saga 而不是 2PC', t: '兩階段提交在協調者掛掉時會讓參與者握著鎖等待，而且多數訊息系統與外部 API 不支援。saga 把流程拆成一串本地交易，失敗時依反向順序執行補償動作；中間狀態看得見，要有明確的狀態欄位。' },
    ],
    checklist: [
      '能用 CAP 說明一個服務在網路分區時會拒絕請求還是回舊資料，並解釋「三選二」錯在哪',
      '能指出一個系統裡依賴不同主機時鐘排序的地方，並改用版本號或資料庫序號',
      '能把「建立訂單 → 扣庫存 → 付款」設計成 saga，寫出每一步的補償動作',
    ],
    refs: [
      { label: 'PostgreSQL：High Availability, Load Balancing, and Replication', url: 'https://www.postgresql.org/docs/current/high-availability.html' },
      { label: 'PostgreSQL：PREPARE TRANSACTION', url: 'https://www.postgresql.org/docs/current/sql-prepare-transaction.html' },
      { label: 'The Raft Consensus Algorithm', url: 'https://raft.github.io/' },
    ],
  },
  'system-design': {
    challenge: {
      task: '在 Playground 跑本課「粗估規模」那段，找出會推翻目前架構（單一 PostgreSQL 加 Redis 快取）的那個數字：依序調高每日轉址量、熱門短碼的比例、每天新增的短網址數，找出哪一個參數到多少時，某一層先撐不住。再寫出上線後要盯的指標，以及你用什麼工具量它（例如資料庫的每秒查詢數與 `pg_stat_statements` 的平均時間、Redis 的命中率）。',
      deliver: '一句結論「當 X 超過 Y 時，現在的架構要改成 Z」，附推算用的參數與輸出，以及上線後要盯的那個指標與查法。',
      check: [
        'Y 是用估算程式算出來的，附上參數與結果',
        '指出要量的指標、工具與警戒值',
        '說明在 Y 之前不做 Z 的理由（成本、複雜度或維運負擔）',
      ],
      twist: '有一個短網址在一分鐘內被點了 100 萬次。先預測哪一層最先撐不住、快取命中率會不會救得了它，以及原本的結論要不要改。',
    },
    points: [
      { b: '1. 釐清需求', t: '功能性（誰做什麼）與非功能性（多少人、多快、多可靠、資料多大）。沒有數字的設計是猜。' },
      { b: '2. 粗估規模', t: 'DAU × 每人請求數 / 86400 = QPS；資料量 × 保留年數 = 儲存。數量級對就好。' },
      { b: '3. 定 API 與資料模型', t: '資源與端點、核心表與關係、哪些要索引。這一步用到領域 2 與 3 的全部。' },
      { b: '4. 畫高層架構', t: '客戶端 → CDN / LB → API → DB / 快取 / 佇列 / 物件儲存。先簡單，每個元件要能說出為什麼在那。' },
      { b: '5. 找瓶頸、加東西', t: '哪裡先爆？讀太多加快取與副本；寫太多加佇列；熱點要分散。每加一個元件就多一個要維運的東西。' },
      { b: '6. 講取捨', t: '一致性 vs 可用性、延遲 vs 成本、簡單 vs 彈性。設計沒有對錯，只有「在這個約束下的合理」。' },
    ],
    checklist: [
      '能用六步驟設計一個「短網址服務」或「通知系統」並說明每個取捨',
      '能對現有系統指出下一個會爆的瓶頸',
    ],
    refs: [
      { label: 'roadmap.sh：Backend Developer', url: 'https://roadmap.sh/backend' },
    ],
  },
}

// P9 新課的內文放在 parts/ 底下，這裡合併
export default { ...base, ...l4, ...m1, ...m3 }

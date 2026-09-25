// 題庫：演算法與系統設計
export default [
  {
    skill: 'big-o',
    questions: [
      {
        q: '這段程式對資料庫做了幾次查詢？把 LIMIT 改成 2000 會變幾次？',
        code: `posts = db.query("SELECT * FROM posts LIMIT 200")
for p in posts:
    p.author = db.query("SELECT * FROM users WHERE id = %s", p.author_id)`,
        lang: 'python',
        options: [
          '201 次；改 2000 變 2001 次——查詢次數隨 n 線性成長，這就是 N+1',
          '1 次；改 2000 還是 1 次，ORM 會把迴圈裡的查詢合併',
          '2 次；改 2000 還是 2 次',
          '200 × 200 = 40,000 次，是 O(n²)',
        ],
        answer: 0,
        explain: '迴圈裡每一輪都打一次 DB，加上最外面那一次就是 n+1 次往返；每次往返幾毫秒，2000 次就是好幾秒，而且瓶頸不是 CPU 而是網路來回。修法是把它變成常數次：JOIN users 一次拿完，或先收集 author_id 再 WHERE id IN (...) 第二次查完、在記憶體用 dict 對應——「2 次」描述的是修好後的樣子。除非 ORM 有設 eager load，否則不會自動合併；n+1 是線性，不是 n²。',
      },
      {
        q: '一段程式在 n = 1,000 時跑 0.1 秒、n = 10,000 時跑 10 秒。它最可能的複雜度是？資料再變 10 倍會怎樣？',
        options: [
          'O(n)：10 倍資料 10 倍時間，再 10 倍會是 100 秒',
          'O(n log n)：10 倍資料約 13 倍時間，差距是量測誤差',
          'O(n²)：10 倍資料 100 倍時間，再 10 倍會是 1,000 秒（約 17 分鐘）',
          'O(log n)：時間幾乎不變，是機器剛好比較忙',
        ],
        answer: 2,
        explain: 'Big-O 回答「資料變 k 倍、時間變幾倍」：0.1 → 10 秒是 100 倍，對應 n² 的 10² = 100。O(n) 只會變 10 倍（1 秒）、O(n log n) 約 13 倍（1.3 秒）、O(log n) 幾乎不變——它們與 100 倍差太遠，不是誤差能解釋的。找出 n² 的來源（巢狀迴圈、list 裡的 in 查找、迴圈裡的 query）換成 dict / set / JOIN，通常就能回到 O(n)。這種「資料到十萬筆就爆」的 bug 在資料少的開發環境永遠測不出來。',
      },
      {
        q: '這段程式跑了 40 秒。最有效的一行修改是？',
        code: `active_ids = [u.id for u in db.query("SELECT id FROM users WHERE active")]   # 約 50,000 筆
orders = db.query("SELECT * FROM orders WHERE created_at > %s", since)       # 約 100,000 筆
result = [o for o in orders if o.user_id in active_ids]`,
        lang: 'python',
        options: [
          '兩個 query 都加 ORDER BY id，排序後 in 會改用二分搜尋',
          'active_ids 改成 set：in 從 O(n) 變 O(1)，整體從 O(n·m) 變 O(n+m)',
          'list comprehension 改成 for 迴圈 + append，減少函式呼叫開銷',
          'orders 那個 query 加 LIMIT 分批處理',
        ],
        answer: 1,
        explain: 'x in list 是線性掃描，10 萬個 order 各掃 5 萬個 id = 50 億次比較，這就是 40 秒的來源；set 用 hash 查找是 O(1)，總成本降到「建 set 5 萬 + 查 10 萬」，大約 0.1 秒。Python 的 in 不會因為 list 排過序就自動二分（要自己用 bisect）；改寫迴圈的常數優化差幾個百分比，不改變 n·m；分批只是把 40 秒切成很多段。更進一步是讓資料庫用 JOIN 做這件事，但「把 list 轉成 set / dict」是最常見、最便宜的第一刀。',
      },
    ],
  },
  {
    skill: 'data-structures',
    questions: [
      {
        q: '四個需求：(1) 每分鐘從幾百萬筆事件裡取延遲最高的 10 筆 (2) 檢查 email 是否已註冊 (3) CI 依 needs 決定 job 執行順序 (4) 背景任務依「下次執行時間」取最早到期的。分別該用什麼結構？',
        options: [
          '(1) 全部排序後取前 10 (2) list 搭配 in 檢查 (3) 依 job 名稱排序 (4) 每次排序後取第一個',
          '(1) hash map 依延遲當 key (2) heap 依 email 排序 (3) FIFO queue 依宣告順序 (4) deque 兩端取',
          '(1) B-tree 依延遲建索引 (2) trie 依 email 字元逐層比對 (3) 無向圖 (4) 排序過的 list 取頭',
          '(1) 容量 10 的 min-heap (2) hash set / 唯一索引 (3) DAG 拓樸排序 (4) heap（優先佇列）',
        ],
        answer: 3,
        explain: 'top-k 用容量 k 的 min-heap，O(n log k) 且不用把幾百萬筆全部排序或放進記憶體；「存在嗎」是 hash set 的主場，資料庫層就是 unique index；job 之間的依賴是有向無環圖（方向就是「誰先誰後」，無向圖或 FIFO 都丟了這個資訊），執行順序 = 拓樸排序，還要偵測循環依賴；「永遠取最早到期的」是優先佇列也就是 heap，list 每次找最小是 O(n)。trie 是給前綴查詢用的，email 完整比對用 hash 更直接。',
      },
      {
        q: '這段程式會印出什麼？',
        code: `import heapq
tasks = []
heapq.heappush(tasks, (1700000300, "send-report"))
heapq.heappush(tasks, (1700000100, "send-email"))
heapq.heappush(tasks, (1700000200, "cleanup"))
print(heapq.heappop(tasks))
print(tasks[0])`,
        lang: 'python',
        options: [
          "(1700000300, 'send-report') 然後 (1700000100, 'send-email')：heap 是後進先出",
          "(1700000100, 'send-email') 然後 (1700000200, 'cleanup')：heappop 取最小，tasks[0] 永遠是目前最小",
          "(1700000100, 'send-email') 然後 (1700000300, 'send-report')：剩下的元素依插入順序排",
          '拋出 TypeError，因為 tuple 之間不能比較大小',
        ],
        answer: 1,
        explain: 'heapq 是 min-heap：heappop 以 O(log n) 取出最小的 tuple（先比時間戳），之後 tasks[0] 就是新的最小值 (1700000200, \'cleanup\')——這是它能當排程器的原因（「下一個到期的是誰」O(1) 看到）。但 heap 只保證 tasks[0] 最小，其餘元素不是排序過的、也不是插入順序。tuple 逐元素比較是合法的；實務上時間戳相同時會比第二個元素，若那個元素不可比較才會出錯，通常在中間放一個遞增序號。',
      },
      {
        q: '為什麼所有關聯式資料庫的預設索引是 B-tree，而不是二元搜尋樹（BST）？',
        options: [
          '磁碟以頁為單位讀取，B-tree 一個節點塞幾百個 key、樹只有 3–4 層，幾次 I/O 就找到；BST 每層都可能是一次磁碟讀',
          'B-tree 的查找是 O(1)：一個節點就是一個頁，key 的位置可以直接算出來；BST 每次都要從根走到葉，是 O(log n)',
          'BST 只能做等值查找，不支援 BETWEEN、ORDER BY 這類範圍查詢；B-tree 的葉節點有序，範圍掃描才做得到',
          'B-tree 不需要平衡操作，插入時直接寫進對應的頁就好，寫入比要旋轉的自平衡 BST 快很多',
        ],
        answer: 0,
        explain: '兩者查找都是 O(log n)，差別在對數的底：BST 是 log₂，一百萬筆約 20 層；B-tree 每節點幾百個 key（剛好塞滿一個 8KB 頁），同樣資料 3 層就夠——而 I/O 次數才是資料庫真正的成本。BST 中序走訪也能做範圍查詢，B-tree 的葉節點串成鏈結串列只是讓範圍掃描更順。B-tree 是自平衡的（分裂 / 合併）才保證樹高穩定；沒有平衡機制的 BST 遇到遞增主鍵會退化成鏈結串列。',
      },
    ],
  },
  {
    skill: 'rate-limiting',
    questions: [
      {
        q: '限流規則是「每個 user 每分鐘 100 次」，用固定視窗（以分鐘為 key 的 Redis INCR 計數器）實作。哪種打法會繞過它？',
        options: [
          '同一秒內併發 100 個請求，計數器 race condition 讓全部通過',
          '換 User-Agent 就能重置計數器',
          '在 00:00:59 打 100 次、00:01:00 再打 100 次，2 秒內 200 次全部通過',
          '用 HTTP/2 多路複用，多個請求只算一次',
        ],
        answer: 2,
        explain: '固定視窗在邊界會「重置」，攻擊者可以在兩個視窗的交界處打到兩倍額度——這是固定視窗的結構性缺陷。修法是滑動視窗 log（記每個請求的時間戳）或滑動視窗計數（前一視窗依重疊比例加權），或改用 token bucket 讓暴衝上限明確等於桶容量。Redis INCR 是原子操作，不會有 race condition；User-Agent 與 HTTP/2 都不影響以 user id 為 key 的計數。',
      },
      {
        q: '桶子是滿的（20 個 token），客戶端在同一瞬間送 30 個請求，之後每秒穩定送 15 個。會發生什麼？',
        code: `def allow(bucket, now, rate=10, capacity=20):
    elapsed = now - bucket["last"]
    bucket["tokens"] = min(capacity, bucket["tokens"] + elapsed * rate)
    bucket["last"] = now
    if bucket["tokens"] >= 1:
        bucket["tokens"] -= 1
        return True
    return False`,
        lang: 'python',
        options: [
          '前 20 個過、10 個被拒；之後每秒約 10 個過、5 個被拒——容量決定暴衝上限，速率決定長期上限',
          '30 個全過：rate=10 每秒補 10 個，加上 20 個存量足夠',
          '全部被拒，因為 30 超過了 capacity',
          '前 10 個過（每秒的 rate），其餘被拒',
        ],
        answer: 0,
        explain: '桶容量 20 就是能吃的最大暴衝：同一瞬間 elapsed 為 0 不補 token，第 21 個開始沒 token 就拒。之後每秒補 10 個但客戶端要 15 個，桶子永遠補不滿，長期通過率就是 rate = 10/秒。「容量」與「速率」是兩個獨立的旋鈕，不能混在一起算；token bucket 也不是「超過就全拒」，而是有多少放多少。這正是它比固定視窗好的地方：允許合理的短暴衝（頁面一次載入 20 個 API）但長期壓在速率下。上線時 bucket 要放 Redis 並用 Lua script 保證原子，多實例才共享。',
      },
      {
        q: '登入端點被撞庫攻擊：同一個 IP 換不同帳號、也有多個 IP 打同一個帳號。目前只有 nginx 依 IP 限流。該怎麼補？',
        options: [
          '把 nginx 的每 IP 限制調嚴到每分鐘 3 次，兩種打法的每個來源 IP 都會很快被擋住，不用改應用層',
          '限流全部移到應用層依帳號計數，nginx 那層拿掉避免兩層重複計算、也避免誤傷 NAT 後的正常使用者',
          '維持現狀但把回應改成 200 + 「請稍後再試」，不回 429，讓攻擊者無法從狀態碼判斷是否觸發限流',
          '保留 nginx 每 IP 粗限流，應用層加每帳號限流（Redis 共享計數）並回 429 + Retry-After，多次失敗要求額外驗證',
        ],
        answer: 3,
        explain: '「多 IP 打一個帳號」靠 IP 限流永遠擋不住，key 要是帳號（或帳號 + IP）；「一 IP 換帳號」則由 nginx 的每 IP 限制擋粗的——兩層各管一件事。把每 IP 調到極嚴會誤傷 NAT 後面共用一個 IP 的整間公司；拿掉 nginx 等於讓每個壞請求都進到應用層消耗資源；回 200 讓正常客戶端無法退避（它們靠 429 + Retry-After 決定等多久），對攻擊者也沒有隱藏效果。這也是 OWASP A07 身分驗證失效的重點項目。',
      },
    ],
  },
  {
    skill: 'lru-cache',
    questions: [
      {
        q: '這段 LRU 執行完，list(c.d) 會印出什麼？',
        code: `from collections import OrderedDict

class LRU:
    def __init__(self, cap):
        self.cap, self.d = cap, OrderedDict()
    def get(self, k):
        if k not in self.d:
            return None
        self.d.move_to_end(k)
        return self.d[k]
    def put(self, k, v):
        self.d[k] = v
        self.d.move_to_end(k)
        if len(self.d) > self.cap:
            self.d.popitem(last=False)

c = LRU(2)
c.put("a", 1); c.put("b", 2); c.get("a"); c.put("c", 3)
print(list(c.d))`,
        lang: 'python',
        options: [
          "['b', 'c']：a 最先放進去所以最先被淘汰，get 只是讀取、不會改變順序",
          "['a', 'c']：get(\"a\") 把 a 標成最近使用，put(\"c\") 超容量時淘汰最久沒用的 b",
          "['a', 'b']：容量滿了，put(\"c\") 先寫入再檢查長度，超過就把剛放進去的 c 刪掉",
          "['c', 'a']：popitem(last=False) 從尾端刪，move_to_end 又把 a 移到最前面",
        ],
        answer: 1,
        explain: 'LRU 淘汰的是「最久沒被存取」而不是「最早放進來」（後者是 FIFO）。get("a") 用 move_to_end 把 a 標成最近使用，順序變成 b, a；put("c") 後是 b, a, c，超過容量就 popitem(last=False) 從最舊那端刪掉 b。LRU 永遠接受新資料、淘汰舊的，不會「放不進去」；last=False 指的是刪最前面（最舊）。這就是 hash map + 有序結構的組合：查找、移動、刪除全部 O(1)。',
      },
      {
        q: 'Redis 當快取用，滿了之後開始回 OOM command not allowed when used memory > maxmemory。最可能的設定與修法？',
        options: [
          'maxmemory-policy 應該改成 volatile-lru：它會依 LRU 淘汰所有 key，且比 allkeys-lru 更尊重 TTL 設定',
          '把 maxmemory 設成 0 關掉上限，讓 Redis 依需求使用機器記憶體，由 OS 的 swap 與 OOM 機制兜底',
          '這是正常行為：快取滿了本來就該讓寫入失敗、回 fallback，由應用層 catch 例外後直接查資料庫',
          'maxmemory-policy 是預設的 noeviction；改成 allkeys-lru 讓 Redis 自動淘汰最久沒用的 key',
        ],
        answer: 3,
        explain: 'noeviction 是 Redis 的預設政策：記憶體到上限後拒絕寫入——當快取用時你要的正是「自動騰位置」，allkeys-lru 讓所有 key 都可能被淘汰。volatile-lru 只淘汰「有設 TTL」的 key，若你的快取 key 沒設 TTL 一樣會 OOM，這是常見的踩雷點。關掉限制會讓 Redis 被 OS 的 OOM killer 殺掉或拖垮同機的其他服務。「寫入失敗由應用處理」是把 Redis 當資料庫用的思維，當快取用時不需要。',
      },
      {
        q: '有人用 @functools.lru_cache(maxsize=1000) 快取 get_user_permissions(user_id)。服務跑 2 台機器、每台 4 個 worker。上線後出現「改了權限但要等很久才生效、有時生效有時沒」。為什麼？',
        options: [
          'maxsize=1000 太小，熱門使用者互相擠掉造成時好時壞；改成 maxsize=None 讓它不淘汰就會穩定',
          'lru_cache 的快取是 thread-local 的，uvicorn 的 threadpool 每個 thread 各一份，命中與否看落在哪個 thread',
          'lru_cache 是程序內快取：8 個 worker 各一份、沒有 TTL 與跨程序失效；會變的資料該放 Redis 並在更新時刪 key',
          'user_id 從 JWT 解出來是 str、從路徑解出來是 int，兩種 key 各自快取，所以有時命中舊值有時不命中',
        ],
        answer: 2,
        explain: 'lru_cache 適合純函式（同輸入永遠同輸出）與啟動時讀一次的設定，不適合會被別人改的資料：它沒有 TTL、沒有跨程序失效、重啟才清空，8 個 worker 就是 8 份不一致的快取——「有時生效有時沒」就是負載平衡器把你送到不同 worker。修法是把這類快取放 Redis（所有實例共享）、設 TTL、並在權限更新時主動 DEL。放大 maxsize 只會讓不一致更久；lru_cache 是程序層級、thread 之間共享，不是 thread-local；key 型別不一致最多造成重複快取，解釋不了「改了權限永遠不失效」。',
      },
    ],
  },
  {
    skill: 'queues-workers',
    questions: [
      {
        q: '這個 worker 在 mailer.send 成功後、UPDATE 執行前被 OOM 殺掉，任務被佇列重投。會發生什麼、該怎麼改？',
        code: `def send_welcome_email(job):
    user = db.get_user(job["user_id"])
    mailer.send(user.email, "Welcome!")
    db.execute("UPDATE users SET welcomed = true WHERE id = %s", user.id)`,
        lang: 'python',
        options: [
          '使用者收到兩封信。要先用 welcomed 旗標或任務 id 檢查「是否已處理」再送，讓重複執行也只送一次',
          '沒事：佇列會記錄任務執行到哪一行，重投時從 UPDATE 那一步繼續，這是 at-least-once 的保證',
          '任務不會重跑：worker 非正常退出時佇列會把任務標成 failed 並移到死信佇列，等人工處理',
          '把 UPDATE 移到 mailer.send 之前就完全安全：先標記已寄，重投時看到旗標就跳過，不會寄兩封',
        ],
        answer: 0,
        explain: 'at-least-once 的意義就是「可能重複投遞」：佇列不知道你的程式做到哪一步，也不會因為 worker 死掉就進死信（死信是重試超過上限後才進）。消費者必須冪等：if user.welcomed: return 先查再做是最簡單的一步，更嚴謹的是在 mail 服務用任務 id 當 idempotency key。把 UPDATE 移到前面只是換一種失敗——UPDATE 成功後 send 前掛掉，使用者永遠收不到信；沒有哪個順序能讓兩邊同時成功，這就是為什麼需要冪等或 outbox 模式。',
      },
      {
        q: '下單流程要「寫入 orders 表 + 發一則 order.created 事件到 MQ」。直接在交易 commit 後呼叫 MQ 的 publish 有什麼風險？outbox 模式怎麼解？',
        options: [
          '沒風險：commit 後 publish 是標準做法，MQ client 有本地重試，publish 失敗的機率低到可以忽略',
          '改成先 publish 再 commit：事件一定會發出去，若 commit 失敗再發一則 order.cancelled 補償即可',
          'commit 成功但 publish 失敗會讓訂單存在卻沒有事件；outbox 把事件寫進同一交易的表，由另一個程序送出',
          '用兩階段提交（2PC / XA）讓 DB 與 MQ 在同一個分散式交易裡 commit，這是唯一能保證原子性的做法',
        ],
        answer: 2,
        explain: 'DB 與 MQ 是兩個獨立系統，任何「先 A 再 B」都有 A 成功 B 失敗的窗口：先 commit 會遺失事件（網路、MQ 重啟、程序被殺），先 publish 則會在 commit 失敗時發出「訂單不存在」的幽靈事件，事後補償事件又引入時序問題（下游可能先收到 cancelled）；client 端重試也救不了程序被殺的情況。outbox 把「發事件」變成同一個 DB 交易裡的一筆 INSERT，原子性由 DB 保證；relay 程序再把 outbox 列送到 MQ 並標記已送——relay 可能重送，所以消費者仍要冪等。2PC 大多數 MQ 不支援、也會嚴重拖慢交易，實務上幾乎不用。',
      },
      {
        q: '匯出報表的背景任務偶爾因第三方 API 逾時失敗，目前設定是失敗就立刻重試、不限次數。上週一次第三方停機導致佇列被塞爆、其他任務全部延遲。該怎麼改？',
        options: [
          '改用 Kafka：分割區與磁碟持久化讓它吞吐量高、不會被塞爆，重試邏輯維持不變',
          '重試改指數退避加抖動、設上限；超過就進死信佇列並告警，由人決定重放或放棄',
          '把自動重試拿掉，失敗就直接丟棄任務並回錯誤給前端，由使用者自己再按一次匯出',
          '開更多 worker 消化積壓：積壓代表消費速度不夠，worker 數加倍就能在停機期間把任務清掉',
        ],
        answer: 1,
        explain: '立刻無限重試在下游掛掉時等於自己 DDoS 自己，還把佇列灌滿讓無關任務排不到。指數退避給下游恢復時間、上限避免永遠卡住、死信佇列讓失敗的任務有地方去且看得見（不是消失）。拿掉重試等於把暫時性錯誤全部丟給使用者，第三方抖動一下就一堆失敗；加 worker 只是讓更多 worker 一起去撞掛掉的 API。Kafka 是可重播的事件日誌，不會讓「下游壞了」變好，且對單純的背景任務來說比 Redis / RabbitMQ 重很多。',
      },
    ],
  },
  {
    skill: 'scaling',
    questions: [
      {
        q: 'API 把登入 session 存在程序記憶體的 dict、使用者上傳暫存在 /tmp。前面加了負載平衡器、開到 3 台後，使用者反映「一直被登出、上傳的檔案找不到」。根本原因與修法？',
        options: [
          '負載平衡器設定錯了，改成 sticky session 把每個使用者固定導到同一台就徹底解決',
          '3 台太多，改回 1 台',
          '/tmp 改成 NFS 共享磁碟、session dict 用 pickle 定期同步到其他台',
          'API 有狀態：session 與檔案只存在其中一台。session 移到 Redis、檔案移到物件儲存，任何一台都能服務任何請求',
        ],
        answer: 3,
        explain: '水平擴展只對無狀態的東西有效——「加機器」的前提是任何一台都能接任何請求。sticky session 能暫時掩蓋 session 問題，但一台掛掉那台的使用者全部登出、流量分布不均，也解決不了檔案；NFS 與 pickle 同步是把狀態問題變成分散式狀態同步問題，更難。正確做法是把狀態推到專門管狀態的服務：Redis 管 session、物件儲存管檔案、DB 管資料，API 程序除了設定不記任何跨請求的東西。',
      },
      {
        q: '前端在 POST 成功後立刻 GET，偶爾拿到舊名字。原因與修法？',
        code: `@app.post("/profile")
def update_profile(data):
    primary.execute("UPDATE users SET name = %s WHERE id = %s", data.name, uid)
    return {"ok": True}

@app.get("/profile")
def get_profile():
    return replica.query("SELECT name FROM users WHERE id = %s", uid)`,
        lang: 'python',
        options: [
          '副本有複寫延遲；「寫完立刻讀」要走主庫：寫入後幾秒內該使用者的讀導到 primary，或 POST 直接回傳新資料',
          'primary.execute 之後沒有 commit，UPDATE 還在交易裡沒生效；加上 primary.commit() 副本就會同步到',
          '副本的複寫程序卡住了，才會讀到舊資料；重啟副本讓它重新從主庫同步，之後就不會再發生',
          '讀寫分離本來就不該給使用者面向的查詢用：GET 一律改走主庫，副本只留給備份與離線報表',
        ],
        answer: 0,
        explain: '非同步串流複寫下副本永遠比主庫慢一點（幾毫秒到幾秒），這是換取讀擴展的設計取捨。read-your-writes 的常見做法：寫入後把「最近寫過」記在 session / cookie 幾秒鐘、期間該使用者讀主庫；或寫入 API 回傳完整結果讓前端不必再讀；或對強一致的路徑（自己的個人資料）一律讀主庫。若真沒 commit 會「永遠」讀不到而不是偶爾；正常延遲不是故障；讀全走主庫則放棄了讀寫分離的全部好處——正確是區分哪些讀可以容忍延遲（列表、報表、別人的資料多半可以）。',
      },
      {
        q: '流量成長，API p99 延遲從 200ms 變 3 秒。有人提議「馬上上 Kubernetes 並把資料庫分片」。比較合理的第一步是？',
        options: [
          '照做：p99 從 200ms 到 3 秒代表資料庫已經到極限，分片是解決資料庫瓶頸的標準方式，越早做遷移成本越低',
          '在 nginx 加 proxy_cache 把所有 API 回應快取 1 小時，讀流量幾乎不會再打到後端，延遲立刻回到 200ms',
          '先壓測與看指標找出第一個爆的地方（通常是 DB 連線池或慢查詢），再垂直擴 DB、修索引、加快取或副本',
          'API 是無狀態的所以直接加倍實例數最快；延遲高就是 API 處理不過來，實例夠多 p99 自然下降',
        ],
        answer: 2,
        explain: '「瓶頸要量測」——沒有數字就動架構是猜。API 無狀態所以加實例很容易，但如果瓶頸在 DB（最常見），加 API 實例只會開更多連線讓 DB 更慘。分片代價極高：跨分片 JOIN、交易、遷移都痛，是垂直擴展、讀寫分離都用盡後的最後手段。無差別快取會讓使用者看到別人的或過期的資料。順序是：量測 → 慢查詢與索引 → 連線池 → 垂直擴 → 快取 → 讀副本 → 佇列吸收寫尖峰 → 最後才分片。',
      },
    ],
  },
  {
    skill: 'system-design',
    questions: [
      {
        q: '依這些假設設計短網址服務，平均 QPS、尖峰 QPS 與五年儲存量的數量級各是多少？',
        code: `dau = 2_000_000                 # 每日活躍使用者
requests_per_user_per_day = 20
new_urls_per_day = 1_000_000
avg_row_bytes = 500             # 短碼 + 原始 URL + metadata
retention_years = 5

qps = dau * requests_per_user_per_day / 86400
peak_qps = qps * 3
storage_bytes = new_urls_per_day * 365 * retention_years * avg_row_bytes`,
        lang: 'python',
        options: [
          '約 46,000 QPS、尖峰 140,000、儲存約 100 TB——一開始就要分片',
          '約 460 QPS、尖峰約 1,400、儲存約 1 TB——單一 PostgreSQL + 快取就能扛',
          '約 4.6 QPS、尖峰 14、儲存約 10 GB——一台最小 VM 就好',
          '無法估算，要先壓測才知道',
        ],
        answer: 1,
        explain: '2M × 20 = 4 千萬請求 / 86,400 秒 ≈ 463 QPS，尖峰抓 3 倍約 1,400；儲存 1M × 365 × 5 × 500 bytes ≈ 9 × 10¹¹ ≈ 900 GB。這種量級一台像樣的 PostgreSQL（讀多寫少，加 Redis 快取熱門短碼）綽綽有餘——估算的目的就是避免「先上分片」的過度設計，或反過來低估兩個數量級。估算與壓測是不同階段：估算讓你知道該設計成什麼形狀，壓測驗證實作。數量級對就好，不用精確。',
      },
      {
        q: '設計會議一開始 PM 說「我們要做一個通知系統」，工程師立刻開始畫 Kafka + 微服務架構圖。依六步驟框架，這裡跳過了什麼、會有什麼後果？',
        options: [
          '沒跳過什麼：架構圖本來就是設計的起點，先畫出來讓大家有共同語言，需求細節可以邊做邊補',
          '跳過了選程式語言與框架：架構圖裡的每個元件都要能落地，不先決定技術棧就無法判斷 Kafka 有沒有 client',
          '跳過了寫測試計畫：通知系統的可靠性要靠測試保證，沒有測試策略的架構圖只是好看',
          '跳過了釐清需求與粗估規模：沒有數字就分不出需要 Kafka 還是一張表加 cron，架構會被「感覺」而非約束決定',
        ],
        answer: 3,
        explain: '框架的順序是需求 → 估算 → API / 資料模型 → 架構 → 瓶頸 → 取捨，前兩步決定後面所有選擇的依據。「每天 1 千封 email、可以延遲 5 分鐘」和「每秒 1 萬則推播、1 秒內送達」是完全不同的系統：前者一張 notifications 表 + worker 就夠，後者才需要事件流。先畫架構等於把答案寫在題目前面，之後每個元件都說不出「為什麼在那」。程式語言與測試計畫都不在框架的前段、也不影響架構形狀。',
      },
      {
        q: '短網址服務要決定短碼怎麼產生：「資料庫自增 id 轉 base62」還是「隨機 7 碼 + 檢查碰撞」。從取捨的角度，哪個描述正確？',
        options: [
          '自增簡單、無碰撞但可預測且依賴單一計數器；隨機碼不可預測、可多實例產生，但要處理碰撞重試。依可猜測性與寫入規模決定',
          '自增 id 一定比較好：不會碰撞、不用重試、索引也因為單調遞增而更緊湊，可預測性用 HTTPS 就能解決',
          '隨機碼一定比較好：不可預測所以安全，7 碼 base62 有 3.5 兆種組合，碰撞機率可以當成零、不需要處理',
          '兩者沒有實質差別：短碼只是 key，效能與安全都取決於資料庫與快取的設計，選哪個都不影響系統其他部分',
        ],
        answer: 0,
        explain: '設計沒有對錯，只有「在這個約束下的合理」：內部工具的短網址不在意被猜，自增最省事；公開服務若短網址會指到私密文件，可預測性就是安全問題（IDOR 一類，HTTPS 只保護傳輸、擋不了猜 URL），隨機碼或對自增 id 做混淆更合適。寫入規模大時單一計數器（或 Redis INCR）是瓶頸與單點；隨機碼可以在任何實例產生，代價是唯一索引衝突時重試——7 碼 base62 有約 3.5 兆種組合、碰撞很少，但「很少」不是零，寫入路徑仍要處理衝突。只看一面或宣稱沒差，都等於放棄了「講取捨」這一步。',
      },
    ],
  },
]

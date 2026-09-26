// 領域 8：演算法與系統設計 — 技能內文：重點 points / 自我檢核 checklist / 延伸閱讀 refs；索引在 ../d8-algo.js
export default {
  'big-o': {
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
  'queues-workers': {
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
  'scaling': {
    points: [
      { b: 'API 無狀態', t: 'session 放 Redis、檔案放物件儲存、程序內不存跨請求資料——任何一台都能服務任何請求，前面放負載平衡器就能加台。' },
      { b: '資料庫先垂直', t: '加 CPU / 記憶體、調索引、加連線池——通常撐很久。別太早分散。' },
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
  'system-design': {
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

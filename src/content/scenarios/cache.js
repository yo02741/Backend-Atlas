// 設計情境：API 快取——放哪一層、放多久、怎麼失效
export default {
  id: 'cache',
  order: 2,
  group: 'api',
  title: 'API 快取',
  en: 'API caching',
  level: 2,
  skills: ['http-caching', 'redis-cache'],
  week: 9,
  lab: 'CacheScenarioLab',
  summary: '商品頁每秒 2,000 次讀、資料一天改幾次；購物車每秒 200 次讀且常寫。快取放瀏覽器、CDN、Redis，還是不快取？',
  situation: '電商 API 有兩類讀取端點。商品頁 `GET /products/{id}`：每秒 2,000 次、所有人看到同一份資料、商品資訊一天只改幾次（價格、庫存文案）。購物車 `GET /cart`：每秒 200 次、每個使用者一份、加減商品時頻繁寫入。使用者遍布各地，API 只部署在單一區域，一次到 PostgreSQL 的查詢約 30–50 ms。',
  constraints: [
    '商品頁改價之後，最多容忍 60 秒內有人看到舊價',
    '購物車是個人資料：不能被別人看到，自己改完要立刻看到',
    '訂單付款狀態不能顯示舊值',
    'PostgreSQL 目前能穩定承受約 500 次 / 秒的這類查詢',
    '所有數字都是示意，重點是量級與方向',
  ],
  options: [
    {
      id: 'http', name: 'HTTP 快取標頭',
      summary: '回應帶 `Cache-Control: public, max-age=…, s-maxage=…` 與 `ETag`；瀏覽器與 CDN 依標頭自行快取，過期後帶 `If-None-Match` 問一次拿 304。',
      pros: ['請求根本不到 API：CDN 邊緣就回，離使用者最近、延遲最低', '零額外基礎設施，一個標頭就開始生效', '`ETag` + 304 讓過期後的重新驗證幾乎不花頻寬'],
      cons: ['`public` 只能用在大家看到同一份的資料；個人資料得標 `private`，CDN 就不能存', '瀏覽器裡的快取無法主動清掉，只能等 max-age 到期', 'CDN 各邊緣節點各自過期，同一秒不同地區可能看到不同版本'],
    },
    {
      id: 'redis', name: 'Redis cache-aside',
      summary: 'API 先查 Redis，沒有就查 DB 再寫回並設 TTL；寫入資料時同時 `DEL` 對應 key。',
      pros: ['可以在寫入時主動失效，使用者自己改完馬上看到新值', 'key 可以帶 user_id，個人資料也能快取', '所有服務實例共用同一份快取，DB 一個 key 只被打一次'],
      cons: ['請求還是要進到 API，延遲省的是 DB 那段，不是網路那段', '多了一個要維運的元件：連線、記憶體上限、淘汰策略', '快取穿透、雪崩、更新順序（先刪 key 還是先寫 DB）都是要處理的細節'],
    },
    {
      id: 'none', name: '不快取',
      summary: '每個請求都到 DB，回應標 `Cache-Control: no-store`。',
      pros: ['永遠是最新值，沒有一致性問題', '沒有任何失效邏輯要寫、要除錯'],
      cons: ['讀流量全部由 DB 承擔，商品頁 2,000 次 / 秒直接超過 DB 能力', '每個請求都付完整的網路 + DB 延遲'],
    },
  ],
  tradeoffs: {
    axes: ['DB 負載', '一致性', '延遲', '複雜度'],
    rows: [
      { option: 'http', cells: ['好：CDN 擋掉絕大多數', '差：瀏覽器那份清不掉，只能等 max-age', '好：邊緣就回，不進 API', '低：標頭而已；但 private / public 標錯是資安事故'] },
      { option: 'redis', cells: ['好：一個 key 一段 TTL 只打 DB 一次', '好：寫入時 DEL key，立刻一致', '中：仍要繞到 API 那一區', '中：多一個元件、失效邏輯、穿透與雪崩'] },
      { option: 'none', cells: ['差：全部到 DB', '好：永遠最新', '差：每次都是完整路徑', '最低'] },
    ],
  },
  decisions: [
    { id: 'product', situation: '公開商品頁：每秒 2,000 次讀、所有人看同一份、一天改幾次價格，可容忍 60 秒內看到舊價。使用者在全球各地。', options: ['http', 'redis', 'none'], answer: 'http',
      explain: '大家看到同一份、又能容忍短暫舊值，正是 `Cache-Control: public, s-maxage=60` 的場景：CDN 邊緣直接回，請求連 API 都不進，全球延遲也最低。Redis 也能把 DB 負載壓下來，但每個請求仍要繞回單一區域的 API。' },
    { id: 'cart', situation: '個人購物車：每秒 200 次讀、加減商品頻繁寫入，使用者改完要立刻看到，查詢要 join 三張表約 30 ms。', options: ['http', 'redis', 'none'], answer: 'redis',
      explain: '個人資料必須 `private`，CDN 幫不上忙；瀏覽器快取又清不掉，改完會看到舊車。Redis 以 `cart:{user_id}` 當 key，寫入時 DEL，讀取立刻一致，還省掉 join 的 30 ms。200 次 / 秒不快取 DB 也撐得住，但每次都付 join 的成本。' },
    { id: 'payment', situation: '訂單付款狀態 `GET /orders/{id}/payment`：付款完成後前端輪詢，顯示舊值會讓使用者重複付款。', options: ['http', 'redis', 'none'], answer: 'none',
      explain: '任何舊值都會直接造成錯誤操作，這類端點就是不該快取：回 `Cache-Control: no-store`，每次到 DB。流量是輪詢等級，DB 撐得住；若真的撐不住，該改的是用 webhook 或 SSE 推送，不是加快取。' },
    { id: 'leaderboard', situation: '活動排行榜：全站共用、排程每分鐘重算一次寫進 DB，活動期間全球流量湧入，接受最多 1 分鐘舊資料。', options: ['http', 'redis', 'none'], answer: 'http',
      explain: '共用資料 + 明確的更新週期 + 可容忍一分鐘舊值，`public, s-maxage=60` 讓 CDN 在每個地區各自只回源一次。Redis 也可以（TTL 60 秒），但流量會全部湧回單一區域的 API，邊緣快取更省。' },
  ],
  implementation: [
    { title: '回應標頭：公開商品頁 vs 個人購物車', lang: 'http', code: `HTTP/1.1 200 OK
Cache-Control: public, max-age=30, s-maxage=60, stale-while-revalidate=30
ETag: "prod-42-v17"
Vary: Accept-Language

# 過期後瀏覽器 / CDN 帶條件請求回來
GET /products/42
If-None-Match: "prod-42-v17"

HTTP/1.1 304 Not Modified
ETag: "prod-42-v17"

# 個人購物車：CDN 不能存，瀏覽器也不要存
HTTP/1.1 200 OK
Cache-Control: private, no-store` },
    { title: 'Redis cache-aside（含寫入時刪 key）', lang: 'python', code: `import json

TTL = 60  # 秒；就算漏刪 key，最多舊 60 秒

def get_cart(user_id: int) -> dict:
    key = f"cart:{user_id}"
    cached = redis.get(key)
    if cached is not None:
        return json.loads(cached)           # hit：不碰 DB
    cart = db.query_cart(user_id)           # miss：查 DB（join 三張表）
    redis.set(key, json.dumps(cart), ex=TTL)
    return cart

def add_item(user_id: int, product_id: int, qty: int) -> None:
    db.upsert_cart_item(user_id, product_id, qty)   # 先寫 DB
    redis.delete(f"cart:{user_id}")                 # 再刪 key，下一次讀會重建
    # 順序很重要：先刪再寫，中間若有人讀到舊值回寫，快取就會卡著舊資料直到 TTL 到` },
  ],
  exercise: null,
  refs: [],
}

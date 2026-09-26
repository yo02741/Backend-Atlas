// 設計情境：快取到期的瞬間——雪崩（avalanche）與擊穿（stampede）
export default {
  id: 'edge-cache',
  order: 17,
  group: 'traffic',
  title: '快取到期的瞬間：雪崩與擊穿',
  en: 'Cache stampede & avalanche',
  level: 3,
  skills: ['http-caching', 'redis-cache', 'resilience'],
  week: 11,
  lab: 'EdgeCacheScenarioLab',
  summary: '首頁 API 每秒 10,000 次讀、快取 TTL 60 秒。到期那一秒，10,000 個請求同時撲向資料庫。',
  situation: '電商首頁 API 由 CDN 與 Redis 兩層快取擋在前面，TTL 60 秒，尖峰每秒 10,000 次讀。資料庫只撐得住每秒幾百次這種查詢。快取一到期，所有請求同時 miss、同時去查資料庫，DB 連線池瞬間被塞爆（stampede，擊穿）；更糟的是首頁、分類頁、排行榜幾百個熱門 key 是同一次部署後同一秒填進去的，也就同一秒到期（avalanche，雪崩）。',
  constraints: [
    '資料庫能承受的這類查詢約每秒幾百次，10,000 次一定掛',
    '首頁資料可以接受 60 秒以內的舊值；顯示到期後幾秒的舊資料沒有人會發現',
    '原站（API + DB）的回應時間 0.1–2 秒不穩定，越忙越慢',
    '幾百個熱門 key 在部署或快取清空後會同時填入、同時到期',
    '不能為此引進新的中介系統；只有現成的 CDN、Redis 與 API 程式碼可改',
  ],
  options: [
    {
      id: 'ttl', name: '單純 TTL',
      summary: '`SETEX key 60 value`。到期就沒了，下一個請求 miss 去載入並回填。',
      pros: ['最簡單，任何快取都內建', '到期後第一個請求拿到的一定是新資料'],
      cons: ['到期到回填之間的空窗，所有請求都 miss、都打原站——流量越大空窗越致命', '原站一慢，空窗變長，等待的請求越堆越多，形成正回饋'],
    },
    {
      id: 'swr', name: 'Stale-while-revalidate',
      summary: '到期後一段時間內照樣回舊值，同時只派一個背景請求去更新；HTTP 用 `Cache-Control: stale-while-revalidate`，Redis 則在值旁存「邏輯到期時間」。',
      pros: ['使用者永遠不等原站，延遲不受到期影響', '每次到期只有 1 個請求打原站'],
      cons: ['到期後的幾秒使用者看到的是舊值，不能忍受舊資料的場景不能用', '第一次載入（快取裡沒有舊值）仍會擊穿，要搭配 singleflight'],
    },
    {
      id: 'singleflight', name: 'Singleflight（鎖）',
      summary: '同一個 key 同時只放一個請求去載入：`SET lock:key NX PX 3000` 搶到的去查 DB，其他的短暫等待再讀快取，或直接拿舊值。',
      pros: ['不管多少請求同時 miss，原站只收到 1 次', '冷 key（從沒被載入過）也有效，這是 swr 做不到的'],
      cons: ['等待的請求延遲等於原站延遲；原站慢 2 秒，那 2 秒內的請求都在等', '鎖要有過期時間，否則持鎖者掛掉全部卡死；多台機器要用 Redis 而不是程式內的鎖'],
    },
    {
      id: 'jitter', name: 'TTL 抖動 + 提前更新',
      summary: '每個 key 的 TTL 加隨機 ±20%，不會同一秒到期；快取快到期前（例如剩 10–20%）就派一個請求提前更新，使用者永遠讀到未過期的值。',
      pros: ['幾百個 key 的到期被攤開到十幾秒內，原站負載平滑', '提前更新讓 key 幾乎不會真的到期，等於沒有空窗'],
      cons: ['只解決「一起到期」；單一超熱 key 的擊穿要靠提前更新或 singleflight', '提前更新對冷門 key 是浪費（沒人讀也在更新），要用「有人讀到才觸發」的機率式提前更新'],
    },
  ],
  tradeoffs: {
    axes: ['到期瞬間打到原站', '使用者等待', '資料新鮮度', '實作複雜度'],
    rows: [
      { option: 'ttl', cells: ['差：全部請求', '差：整個空窗都在等', '好：到期後一定是新值', '無'] },
      { option: 'swr', cells: ['好：每 key 1 次', '好：不等', '中：到期後幾秒回舊值', '低：HTTP 一行；Redis 要存邏輯到期時間'] },
      { option: 'singleflight', cells: ['好：每 key 1 次', '中：等原站一趟', '好', '中：分散式鎖、鎖過期、等待邏輯'] },
      { option: 'jitter', cells: ['好：攤平且每 key 1 次', '好：不等', '好：幾乎不會真的到期', '低：一行抖動 + 提前更新判斷'] },
    ],
  },
  decisions: [
    { id: 'hot-products', situation: '首頁「熱門商品」區塊，每秒 10,000 次讀，商品資料每幾分鐘變一次，顯示 60 秒內的舊值完全可以接受。', options: ['ttl', 'swr', 'singleflight', 'jitter'], answer: 'swr',
      explain: '可以容忍舊值，就用最不影響使用者的做法：到期後照樣回舊值、背景更新一次。使用者延遲永遠是快取命中的延遲，原站每 60 秒只收到 1 次。singleflight 也能保護 DB，但等待的請求要吃原站的延遲，這裡沒必要。' },
    { id: 'balance', situation: '使用者錢包餘額 API：讀多寫少，但顯示舊餘額會引來客訴甚至讓人重複下單。', options: ['ttl', 'swr', 'singleflight', 'jitter'], answer: 'singleflight',
      explain: 'swr 與提前更新都可能回舊值，出局。單純 TTL 到期會擊穿。singleflight 讓同一個 key 同時只有一個請求去查主庫，其他請求等它回來後讀到的都是新值——沒有人拿到舊資料，DB 也只被打一次。更嚴格的做法是餘額根本不快取、寫入時同步刪 key。' },
    { id: 'hourly-report', situation: '後台儀表板有 300 個報表 key，每小時整點由排程重算、同時寫進快取、TTL 都是 3,600 秒。', options: ['ttl', 'swr', 'singleflight', 'jitter'], answer: 'jitter',
      explain: '問題不是單一 key 太熱，而是 300 個 key 同一秒到期後同時去重算——這是雪崩。每個 key 的 TTL 加隨機抖動，到期時間就攤開到幾分鐘裡；再搭配提前更新，重算在到期前就完成。swr 或 singleflight 只處理單一 key，300 個 key 還是會同一秒各打原站一次。' },
    { id: 'viral', situation: '一個冷門商品頁突然被網紅貼出來，一分鐘內從每秒 0 次讀衝到每秒 5,000 次，快取裡從來沒有這個 key。', options: ['ttl', 'swr', 'singleflight', 'jitter'], answer: 'singleflight',
      explain: '冷 key 沒有舊值可以回，swr 與提前更新都幫不上忙；抖動只影響到期時間，第一次載入照樣所有請求同時 miss。singleflight 讓第一個請求搶到鎖去載入，其餘 4,999 個等它回填後再讀快取，DB 只被打一次。實務上 singleflight 與 swr 會一起用：冷 key 靠鎖、熱 key 到期靠舊值。' },
  ],
  implementation: [
    { title: 'CDN / 瀏覽器層：到期後照樣回舊值、背景更新', lang: 'http', code: `HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: public, max-age=60, stale-while-revalidate=300, stale-if-error=600
ETag: "home-v18342"

# max-age=60：60 秒內直接用快取
# stale-while-revalidate=300：到期後 300 秒內仍回舊值，同時背景向原站更新一次
# stale-if-error=600：原站 5xx 或連不上時，600 秒內用舊值撐著` },
    { title: 'Redis 層：singleflight（SET NX 鎖）+ 舊值回退', lang: 'python', code: `import json, random, time

TTL, STALE_GRACE, LOCK_MS = 60, 300, 3000

def get_home(key="home"):
    raw = redis.get(key)
    entry = json.loads(raw) if raw else None
    now = time.time()
    if entry and entry["expires_at"] > now:      # 邏輯上還新鮮
        return entry["value"]

    # 到期（或從沒載入過）：只讓一個請求去打原站
    got_lock = redis.set(f"lock:{key}", "1", nx=True, px=LOCK_MS)
    if got_lock:
        try:
            value = load_from_db()
            entry = {"value": value, "expires_at": now + TTL}
            # 實體 TTL 比邏輯 TTL 長，到期後舊值還留著可以回退
            redis.set(key, json.dumps(entry), ex=TTL + STALE_GRACE)
            return value
        finally:
            redis.delete(f"lock:{key}")

    if entry:                                    # 沒搶到鎖但有舊值：直接回舊值（swr）
        return entry["value"]
    time.sleep(0.05)                             # 冷 key 且沒搶到鎖：等一下再讀
    return get_home(key)` },
    { title: 'TTL 抖動：一行讓幾百個 key 不再同一秒到期', lang: 'python', code: `ttl = int(BASE_TTL * random.uniform(0.8, 1.2))      # 60 秒 → 48–72 秒之間
redis.set(key, payload, ex=ttl)

# 提前更新（機率式）：剩餘壽命越短、越可能被讀到的請求觸發背景更新
remaining = entry["expires_at"] - time.time()
if remaining < 0.2 * BASE_TTL and random.random() < (1 - remaining / (0.2 * BASE_TTL)):
    background_refresh(key)` },
  ],
  exercise: 'http-caching-1',
  refs: [],
}

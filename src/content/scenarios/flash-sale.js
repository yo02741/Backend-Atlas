// 設計情境：秒殺——1,000 人搶 100 件
export default {
  id: 'flash-sale',
  order: 14,
  group: 'traffic',
  title: '秒殺：1,000 人搶 100 件',
  en: 'Flash sale',
  level: 3,
  skills: ['transactions', 'redis-cache', 'queues-workers'],
  week: 8,
  lab: 'FlashSaleScenarioLab',
  summary: '限量 100 件、開賣瞬間 1,000 個請求同時到。不能超賣、1 秒內要有答案。鎖在 DB、擋在 Redis，還是排隊？',
  situation: '限量商品 100 件，開賣時間公告在前一天。開賣那一秒約 1,000 個請求同時打到 API，之後幾秒仍有零星請求進來。庫存存在 PostgreSQL 的 `items.stock` 欄位，訂單寫進 `orders` 表。使用者按下「搶購」後要在 1 秒內看到「搶到」或「沒搶到」。',
  constraints: [
    '賣出數量不得超過 100 件（超賣＝要打電話向客人道歉、退款）',
    '使用者在 1 秒內要知道結果，不能一直轉圈',
    '庫存與訂單的最終狀態必須一致：搶到的人一定有訂單、有訂單的一定扣過庫存',
    'PostgreSQL 單機，`max_connections` 100；API 有多台實例，程式碼裡沒有全域鎖',
  ],
  options: [
    {
      id: 'naive', name: '先查再扣（兩步）',
      summary: '`SELECT stock` 看還有沒有，有就 `UPDATE stock = stock - 1` 再 `INSERT orders`。',
      pros: ['最直覺，任何 ORM 都是這樣寫', '單人測試永遠正確'],
      cons: ['查與扣之間有空窗：兩個請求都讀到 1、都判斷可以買、都扣 → 庫存 -1', '併發越高超賣越多；靠「加 if 判斷」永遠修不好，因為判斷本身不是原子的'],
    },
    {
      id: 'atomic', name: '條件 UPDATE（一句 SQL）',
      summary: '`UPDATE items SET stock = stock - 1 WHERE id = $1 AND stock > 0 RETURNING stock`，影響 0 列＝沒搶到。',
      pros: ['判斷與扣減在同一句裡，靠行鎖排隊，絕不超賣', '不用 Redis、不用新元件，正確性由資料庫保證'],
      cons: ['1,000 個請求全部排在同一列的鎖上，一個一個過；請求數乘以每次更新時間就是最後一個人的等待', '連線池與 `max_connections` 會先被等鎖的請求塞滿，其他 API 也跟著慢'],
    },
    {
      id: 'redis', name: 'Redis 原子預扣',
      summary: '開賣前把庫存載入 Redis；請求先 `DECR stock`，結果 ≥ 0 才算搶到，再把建訂單丟給 worker 非同步寫 DB。',
      pros: ['DECR 是單執行緒原子操作，微秒級，1,000 個請求幾十毫秒內全部有答案', 'DB 只收到 100 筆訂單寫入，不再是熱點'],
      cons: ['DECR 到負數要 `INCR` 補回（或直接視為失敗不再處理）', '兩個儲存體：Redis 說搶到但 worker 掛了，就要靠對帳 job 補訂單或退庫存', 'Redis 重啟或資料丟失時庫存要能從 DB 重建'],
    },
    {
      id: 'queue', name: '排隊序列化',
      summary: 'API 把請求放進佇列立刻回「排隊中」，單一 worker 依序處理，前端輪詢結果。',
      pros: ['DB 永遠只有一個寫入者，沒有鎖競爭、沒有超賣', '公平：先到先得，尖峰再高 API 都不會被拖垮'],
      cons: ['使用者不是馬上知道結果，要輪詢；佇列一長就超過 1 秒', '多一個元件、多一個狀態機（排隊中 / 成功 / 失敗），前端也要配合'],
    },
  ],
  tradeoffs: {
    axes: ['超賣風險', '1 秒內有答案', 'DB 壓力', '複雜度'],
    rows: [
      { option: 'naive', cells: ['差：一定超賣', '好：但答案是錯的', '高：每個請求兩三次往返', '最低'] },
      { option: 'atomic', cells: ['好：行鎖保證', '中：請求數 × 每次更新時間', '高：全部排在一列上', '低'] },
      { option: 'redis', cells: ['好：DECR 原子', '好：毫秒級', '低：只有成功者寫 DB', '中：兩個儲存體要對帳'] },
      { option: 'queue', cells: ['好：單一寫入者', '差：要輪詢，隊伍長就慢', '低：worker 節流', '中：佇列 + 狀態查詢'] },
    ],
  },
  decisions: [
    { id: 'cart', situation: '一般商品加入購物車、下單：庫存幾千件、同一商品每秒最多幾個人買，偶爾同時兩個人下單。', options: ['naive', 'atomic', 'redis', 'queue'], answer: 'atomic',
      explain: '併發低不代表不會撞，兩個人同時買最後一件就超賣，所以「先查再扣」還是不行。條件 UPDATE 一句 SQL 就把正確性做完，不值得為它引入 Redis 或佇列。' },
    { id: 'flash', situation: '限量 100 件秒殺，開賣瞬間 1,000 個請求，要 1 秒內回答。', options: ['atomic', 'redis', 'queue'], answer: 'redis',
      explain: '條件 UPDATE 正確但 1,000 個請求排在同一列鎖上，尾端要等好幾百毫秒且塞爆連線池；佇列要輪詢，隊伍一長就超過 1 秒。Redis DECR 幾十毫秒內讓所有人有答案，DB 只收 100 筆訂單，之後靠對帳 job 收尾。' },
    { id: 'concert', situation: '演唱會 5 萬張票、座位有分區與座號、開賣瞬間 50 萬人湧入，主辦方接受「排隊 N 分鐘」的體驗。', options: ['atomic', 'redis', 'queue'], answer: 'queue',
      explain: '選座位不是單一計數器可以扣的，每筆要處理的邏輯多（座位配對、付款保留）；且流量比容量高兩個數量級，任何同步做法都會被打垮。排隊序列化讓後端以自己的速度處理，前端顯示排隊號碼是可接受的體驗。' },
    { id: 'room', situation: '公司內部搶會議室：同一時段只能一組人訂，同事最多幾十人，偶爾兩個人同時按。', options: ['naive', 'atomic', 'redis'], answer: 'atomic',
      explain: '併發很低但衝突後果很煩（兩組人同時進會議室），一句帶條件的 UPDATE 或 UNIQUE 約束（房間 + 時段）就能保證只有一個人成功。Redis 對這個規模是多餘的。' },
  ],
  implementation: [
    { title: '條件 UPDATE + RETURNING（PostgreSQL）', lang: 'sql', code: `BEGIN;

-- 判斷與扣減在同一句：WHERE 不成立就影響 0 列
UPDATE items
SET    stock = stock - 1
WHERE  id = $1 AND stock > 0
RETURNING stock;
-- 回傳 0 列 → 沒搶到，ROLLBACK
-- 回傳 1 列 → 建訂單
INSERT INTO orders (user_id, item_id, status)
VALUES ($2, $1, 'reserved');

COMMIT;

-- 保險：即使程式碼寫錯也不會變負數
ALTER TABLE items ADD CONSTRAINT stock_non_negative CHECK (stock >= 0);` },
    { title: 'Redis DECR 預扣（扣到負數要補回）', lang: 'python', code: `# 開賣前：把庫存載入 Redis
redis.set("sale:1001:stock", 100)

async def try_buy(user_id: int, item_id: int) -> bool:
    key = f"sale:{item_id}:stock"
    left = await redis.decr(key)          # 原子：單執行緒，不會有兩個人同時看到 1
    if left < 0:
        await redis.incr(key)             # 扣過頭要補回，讓計數器停在 0
        return False                      # 沒搶到：1 個往返就回答
    # 搶到：不在請求裡寫 DB，丟給 worker
    await queue.enqueue("create_order", user_id=user_id, item_id=item_id)
    return True

# worker：真正建訂單、扣 DB 庫存（用條件 UPDATE 當第二道防線）
# 對帳 job：每分鐘比對 100 - Redis 餘量 與 orders 筆數，不一致就補單或退還庫存` },
  ],
  exercise: null,
  refs: [],
}

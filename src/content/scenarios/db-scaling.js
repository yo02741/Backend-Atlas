// 設計情境：資料庫撐不住了——連線池、讀寫分離、分片
export default {
  id: 'db-scaling',
  order: 16,
  group: 'traffic',
  title: '資料庫撐不住了：連線池、讀寫分離、分片',
  en: 'Database scaling',
  level: 3,
  skills: ['db-operations', 'scaling', 'indexes'],
  week: 15,
  lab: 'DbScalingScenarioLab',
  summary: '單機 PostgreSQL CPU 80%、連線常滿、一張 5 億列的表。先加連線池、拆讀寫、切分區，還是直接分片？順序錯了會很貴。',
  situation: 'PostgreSQL 單機，CPU 長期 80%。`max_connections` 100 卻常常滿：API 8 台、每台連線池 20 條，尖峰時 160 條連線搶 100 個名額，拿不到連線的請求直接 500。讀寫比約 85 / 15。最大的一張表 `events` 5 億列，查詢幾乎都帶 `user_id`，但每月有一次跨全表的統計報表。',
  constraints: [
    '不能停機超過幾分鐘，任何改動都要能在線上逐步做',
    '使用者剛寫入的資料，下一個請求就要讀得到（read-your-writes）',
    '95% 的查詢帶 `user_id`，其餘是每月一次的跨全表統計',
    '團隊 4 個後端、沒有 DBA，維運複雜度是真實成本',
  ],
  options: [
    {
      id: 'pool', name: 'pgbouncer 連線池',
      summary: '在 API 與 DB 之間放 pgbouncer（transaction pooling）：API 端維持 160 條客戶端連線，DB 端只開 20 條伺服器連線。',
      pros: ['連線數問題立刻消失，DB 少了上百個閒置 backend，CPU 也降一點', '一天內可上線，程式碼幾乎不用改'],
      cons: ['transaction 模式不能用 session 層的功能：`SET`、advisory lock、`LISTEN`、舊版的 prepared statement', '只解連線數，不解算力：查詢本身的成本一點沒少'],
    },
    {
      id: 'replica', name: '讀寫分離（一主二讀）',
      summary: 'streaming replication 開兩個唯讀副本；寫走主庫、讀走副本，程式碼裡兩個 engine 依讀寫路由。',
      pros: ['85% 的讀分散到副本，主庫 CPU 大幅下降；讀的容量隨副本數線性加', '副本同時是災難備援'],
      cons: ['複製延遲：剛寫完馬上讀副本可能讀到舊的，要做 read-your-writes（寫後幾秒讀主庫，或帶 LSN 等副本追上）', '寫入容量沒變，寫入量長大時還是主庫一台在扛'],
    },
    {
      id: 'partition', name: '表分割（同一台）',
      summary: '`events` 依 `user_id` HASH（或依月份 RANGE）切成 32 個分區，仍在同一台機器上。',
      pros: ['帶 `user_id` 的查詢只掃 1 個分區：索引變小、VACUUM 一次做一個分區', '依月份分區時，砍舊資料是 `DROP PARTITION`，比 `DELETE` 快幾個數量級'],
      cons: ['CPU 與寫入還是同一台在扛：這是整理，不是擴展', '查詢不帶分區鍵就要掃所有分區；分區鍵選錯反而每個查詢都變 32 倍'],
    },
    {
      id: 'shard', name: '依 user_id 分片到多個實例',
      summary: '依 `user_id` hash 把資料切到 4 台獨立的 PostgreSQL，應用層（或 proxy）依 `user_id` 決定去哪一台。',
      pros: ['讀、寫、儲存全部 ×N，是唯一能突破單機寫入上限的做法'],
      cons: ['跨分片 JOIN 與交易做不到（或很痛）：要在應用層 scatter-gather 再合併', '重新分片、跨分片唯一性、全域 ID、備份與 migration 都要 ×4，沒有 DBA 的團隊會被拖垮'],
    },
  ],
  tradeoffs: {
    axes: ['解連線數', '解 CPU（讀）', '解寫入上限', '複雜度'],
    rows: [
      { option: 'pool', cells: ['好：160 → 20', '小：少了閒置 backend', '無', '低'] },
      { option: 'replica', cells: ['中：每台各自有上限', '好：讀分流', '無：仍是一主', '中：路由 + read-your-writes'] },
      { option: 'partition', cells: ['無', '中：帶分區鍵的查詢變快', '無', '中：分區鍵與 migration'] },
      { option: 'shard', cells: ['好：每片各自', '好：×N', '好：×N', '很高：跨片 JOIN、交易、重分片'] },
    ],
  },
  decisions: [
    { id: 'conn', situation: '連線常滿、拿不到連線就 500，但 DB 的 CPU 只有 30%。', options: ['pool', 'replica', 'shard'], answer: 'pool',
      explain: '瓶頸是連線數不是算力：100 個 backend 大多在閒置等 API。pgbouncer 把 160 條客戶端連線收斂成 20 條伺服器連線，一天就能上線。副本與分片是為 CPU 或寫入做的，這裡用不到。' },
    { id: 'read', situation: '讀多寫少（90 / 10），CPU 長期 85%，慢查詢已優化過、索引都對。', options: ['pool', 'replica', 'partition'], answer: 'replica',
      explain: '算力真的不夠，而且是讀吃掉的：讀寫分離讓讀的容量隨副本線性增加。分割表不會減少 CPU，連線池不解算力。要另外處理 read-your-writes。' },
    { id: 'bigtable', situation: '單表 20 億列、查詢都帶 `user_id`、CPU 40%；但 VACUUM 跑不完、加索引要好幾小時、砍舊資料的 DELETE 鎖太久。', options: ['replica', 'partition', 'shard'], answer: 'partition',
      explain: '問題是單表太大帶來的維運痛，不是容量。依月份或 `user_id` 分區後，VACUUM 與索引都變成分區大小，砍舊資料變成 DROP PARTITION。CPU 還夠，分片是殺雞用牛刀。' },
    { id: 'write', situation: '寫入量每季翻倍，已經一主三讀、單表分區，主庫的寫入 IOPS 與 CPU 都快到頂，垂直升級也到最大機型了。', options: ['pool', 'replica', 'shard'], answer: 'shard',
      explain: '副本再多也分不掉寫入，機器也升到頂了，只剩分片能把寫入 ×N。動手前先確認查詢幾乎都帶 `user_id`、跨分片交易極少；否則先重新檢視寫入本身（批次、去重、冷資料搬走）。' },
  ],
  implementation: [
    { title: 'pgbouncer.ini（transaction pooling）', lang: 'bash', code: `[databases]
app = host=127.0.0.1 port=5432 dbname=app

[pgbouncer]
listen_port = 6432
pool_mode = transaction        # 交易結束就把連線還給池子；不能用 SET / advisory lock / LISTEN
max_client_conn = 400          # API 端：8 台 × 20 條 = 160，留餘裕
default_pool_size = 20         # DB 端：真正開到 PostgreSQL 的連線數
reserve_pool_size = 5          # 尖峰時可再借 5 條
server_idle_timeout = 60

# API 的連線字串改指到 6432；PostgreSQL 的 max_connections 反而可以調小` },
    { title: '表分割：依 user_id HASH', lang: 'sql', code: `-- 查詢幾乎都帶 user_id → 用它當分區鍵；分區鍵必須包含在主鍵裡
CREATE TABLE events (
  id         BIGSERIAL,
  user_id    BIGINT      NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload    JSONB,
  PRIMARY KEY (user_id, id)
) PARTITION BY HASH (user_id);

-- 32 個分區（實務上用腳本產生）
CREATE TABLE events_p0 PARTITION OF events FOR VALUES WITH (MODULUS 32, REMAINDER 0);
CREATE TABLE events_p1 PARTITION OF events FOR VALUES WITH (MODULUS 32, REMAINDER 1);
-- … 一路到 events_p31

-- 帶 user_id 的查詢只碰 1 個分區：EXPLAIN 會看到其他 31 個被 pruning 掉
SELECT * FROM events WHERE user_id = 42 ORDER BY id DESC LIMIT 20;

-- 依時間 RANGE 分區的話，砍舊資料是秒級的：
-- ALTER TABLE events DETACH PARTITION events_2025_01;  DROP TABLE events_2025_01;` },
    { title: '讀寫分離的路由與 read-your-writes', lang: 'python', code: `primary  = create_async_engine(PRIMARY_URL,  pool_size=5)
replicas = [create_async_engine(u, pool_size=5) for u in REPLICA_URLS]
last_write_at: dict[int, float] = {}       # 多台 API 時放 Redis

def engine_for(user_id: int, *, write: bool):
    if write:
        return primary
    # read-your-writes：這個使用者 3 秒內寫過東西，就先讀主庫，等副本追上
    if time.monotonic() - last_write_at.get(user_id, 0) < 3:
        return primary
    return random.choice(replicas)

@app.post("/orders", status_code=201)
async def create_order(user: User, body: OrderIn):
    async with engine_for(user.id, write=True).begin() as conn:
        await conn.execute(insert_order, body.model_dump() | {"user_id": user.id})
    last_write_at[user.id] = time.monotonic()

@app.get("/orders")
async def list_orders(user: User):
    async with engine_for(user.id, write=False).connect() as conn:
        rows = await conn.execute(select_orders, {"user_id": user.id})
        return rows.mappings().all()` },
  ],
  exercise: null,
  refs: [],
}

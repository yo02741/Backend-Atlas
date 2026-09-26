// 設計情境：流量暴衝時的削峰與背壓
export default {
  id: 'queue-backpressure',
  order: 15,
  group: 'traffic',
  title: '流量暴衝時的削峰與背壓',
  en: 'Load shedding & backpressure',
  level: 3,
  skills: ['queues-workers', 'resilience', 'rate-limiting'],
  week: 10,
  lab: 'QueueBackpressureScenarioLab',
  summary: '平常 200 QPS，推播後 30 秒內衝到 5,000；worker 每秒只吃得下 800 件。不能丟資料，但可以晚幾秒。同步做完、排隊、拒絕，還是加機器？',
  situation: '一個活動通知端點：每個請求要寫一筆 DB 紀錄、再透過寄信服務寄一封信，兩件事加起來一次約 40 ms。平常 200 QPS。行銷每天下午發一次推播，推播後 30 秒內流量衝到 5,000 QPS，維持約半分鐘後回落。DB 寫入加寄信服務的上限約每秒 800 件——不管開幾台 API，下游就是這麼快。',
  constraints: [
    '每個請求最後都要寫進 DB、信也要寄出，不能默默丟掉',
    '可以晚幾秒到幾十秒才完成，但 API 本身的回應要在 1 秒內，客戶端逾時是 5 秒',
    '下游（DB 寫入 + 寄信服務）每秒最多 800 件，尖峰時進來的比處理得掉的多 6 倍',
    '尖峰只有 30 秒，為了它常駐 6 倍的機器不划算',
  ],
  options: [
    {
      id: 'direct', name: '同步做完',
      summary: 'API 在請求裡寫 DB、呼叫寄信服務，全部做完才回 200。',
      pros: ['最簡單，沒有新元件', '回 200 就代表真的做完，客戶端不用再查'],
      cons: ['尖峰時在途請求堆在 API 上，回應時間跟著堆積長，超過客戶端逾時就是錯誤——而且那些請求做到一半的資料狀態不明', '下游被打到極限時，連平常的 200 QPS 也一起變慢'],
    },
    {
      id: 'queue', name: '佇列 + worker（回 202）',
      summary: 'API 只把工作放進佇列就回 `202 Accepted`（幾毫秒）；worker 以 800/s 的速度慢慢消化。',
      pros: ['API 回應時間跟下游脫鉤，尖峰時一樣快', '工作先落地在佇列裡，worker 慢或掛了都不丟'],
      cons: ['佇列深度會一路長到尖峰結束：5,000 − 800 = 每秒多 4,200 件，30 秒累積十幾萬件，之後要兩分多鐘才消化完', '沒有上限的佇列會把記憶體或 Redis 撐爆；完成延遲對使用者不可見，要另外給查詢狀態的端點'],
    },
    {
      id: 'shed', name: '有上限的佇列 + 拒絕（503 / 429 + Retry-After）',
      summary: '佇列設上限；滿了就回 `503` 或 `429` 並帶 `Retry-After`，讓客戶端過幾秒再送。',
      pros: ['系統永遠在自己的容量內運作，完成延遲有上限（上限 ÷ 處理率）', '被拒絕的請求由客戶端退避重送，尖峰被攤平到後面幾十秒'],
      cons: ['客戶端要會處理 503 / 429 並依 `Retry-After` 退避，否則就是丟資料', '「拒絕多少」取決於上限怎麼設；設太小等於一直在拒絕，設太大跟沒設一樣'],
    },
    {
      id: 'autoscale', name: '依佇列深度自動加 worker',
      summary: '佇列 + worker，另外讓監控每幾秒看佇列深度，超過門檻就多開 worker，退燒後收回。',
      pros: ['尖峰時容量真的變大，佇列消化得快，平常又不用養那麼多機器', '和佇列、上限可以疊加'],
      cons: ['有延遲：偵測、開機、暖機加起來幾十秒，30 秒的尖峰可能還沒擴完就過了', '下游若本身有上限（DB、寄信服務配額），加 worker 只是把壓力往下推'],
    },
  ],
  tradeoffs: {
    axes: ['尖峰時 API 存活', '資料不丟', '完成延遲', '複雜度與成本'],
    rows: [
      { option: 'direct', cells: ['差：在途堆積、逾時', '差：逾時的請求狀態不明', '好：做完才回（能回的話）', '最低'] },
      { option: 'queue', cells: ['好：只 enqueue', '好：先落地', '差：尖峰後要幾分鐘消化', '中：佇列 + worker + 狀態查詢'] },
      { option: 'shed', cells: ['好：容量內運作', '中：靠客戶端退避重送', '好：有上限', '中：上限值與客戶端配合'] },
      { option: 'autoscale', cells: ['好：同佇列', '好：同佇列', '中：擴容有幾十秒延遲', '高：擴縮規則、冷啟動、成本監控'] },
    ],
  },
  decisions: [
    { id: 'payment', situation: '付款服務商的回呼（webhook）：對方送來「付款成功」通知，逾時 5 秒就算失敗、最多重送 3 次；每筆回呼要更新訂單並觸發出貨流程。絕對不能丟。', options: ['direct', 'queue', 'shed'], answer: 'queue',
      explain: '先把回呼原文落地到佇列或 outbox 表就回 200，出貨流程由 worker 做。同步做完在尖峰時會逾時，對方重送三次還失敗就真的丟了；回 503 拒絕付款通知等於把「不能丟」的責任推給對方。' },
    { id: 'likes', situation: '推播後大家湧進來按讚：每秒幾萬次 +1，只是計數，晚一點或偶爾少算一次沒有人在意，但前端不能卡住。', options: ['direct', 'queue', 'shed'], answer: 'shed',
      explain: '低價值、可重試、可容忍少算，正是拒絕的好對象：佇列滿了就回 429 讓前端過幾秒再送或直接放棄。把幾萬次 +1 排進佇列，計數會晚好幾分鐘才跟上，反而更奇怪。' },
    { id: 'email', situation: '訂單成立後寄收據信：要先產 PDF（CPU 密集，約 300 ms）再寄；活動期間訂單量在幾分鐘內漲十倍；客人期待幾十秒內收到信。', options: ['queue', 'shed', 'autoscale'], answer: 'autoscale',
      explain: '瓶頸是自己的 CPU（產 PDF），不是外部配額，加 worker 就真的變快；尖峰持續幾分鐘，擴容的幾十秒延遲划得來。純佇列會讓客人等好幾分鐘；拒絕收據信不成立。' },
    { id: 'chat', situation: '即時聊天訊息：每則訊息寫一列、推給對方；工作很輕（幾毫秒），使用者期待送出立刻看到。', options: ['direct', 'queue', 'shed'], answer: 'direct',
      explain: '前提變了：工作輕、要即時。排隊會讓對話延遲幾秒到幾十秒，比失敗還糟。同步寫完就回，容量不夠就加 API 與 DB 的處理能力；真的過載時再用 429 當安全閥。' },
  ],
  implementation: [
    { title: '有上限的佇列：滿了回 503 + Retry-After', lang: 'python', code: `QUEUE = "jobs:notify"
QUEUE_MAX = 20_000                # 上限 ÷ 處理率 800/s ≈ 最多晚 25 秒完成

@app.post("/notify", status_code=202)
async def notify(body: NotifyIn):
    depth = await redis.llen(QUEUE)          # LLEN + RPUSH 不是原子的，
    if depth >= QUEUE_MAX:                   # 但當「大約的上限」夠用
        raise HTTPException(
            status_code=503,
            detail="busy, retry later",
            headers={"Retry-After": "5"},    # 秒；客戶端照這個退避
        )
    job_id = str(uuid.uuid4())
    await redis.rpush(QUEUE, json.dumps({"id": job_id, **body.model_dump()}))
    return {"job_id": job_id, "status": "queued"}   # 202：收到了，還沒做

# 客戶端：看到 429 / 503 就依 Retry-After 退避，加抖動避免大家同時回來
async def post_with_backoff(client, url, body, tries=5):
    for attempt in range(tries):
        r = await client.post(url, json=body)
        if r.status_code not in (429, 503):
            return r
        wait = float(r.headers.get("Retry-After", 2 ** attempt))
        await asyncio.sleep(wait + random.uniform(0, 1))
    raise RuntimeError("gave up after retries")` },
    { title: 'worker 併發設定（arq）', lang: 'python', code: `async def send_notification(ctx, job: dict):
    async with ctx["db"].begin() as tx:
        await tx.execute(insert_notification, job)
    await ctx["mailer"].send(job["email"], job["subject"])   # 對方每秒配額也要算進 max_jobs

class WorkerSettings:
    functions = [send_notification]
    max_jobs = 20          # 這個 worker 程序同時處理的工作數：DB 連線數與寄信配額都要跟著算
    job_timeout = 30       # 秒；卡住的工作要放掉，不能占著併發名額
    max_tries = 5          # 失敗重試；超過就進死信佇列，人工看
    queue_read_limit = 100 # 一次從佇列拿多少，別把 Redis 的一整批鎖在一個 worker 手上
# 4 個 worker 程序 × max_jobs 20 = 80 個併發；每件 ~100 ms → 約 800 件/秒` },
    { title: '依佇列深度自動擴縮（KEDA 風格，示意）', lang: 'yaml', code: `# 每 2,000 件排隊就多開 1 個 worker；最少 2 台、最多 20 台
minReplicaCount: 2
maxReplicaCount: 20
pollingInterval: 5       # 秒：多久看一次佇列深度
cooldownPeriod: 60       # 秒：退燒後等多久才縮回去，避免抖動
triggers:
  - type: redis
    metadata:
      listName: jobs:notify
      listLength: "2000"
# 注意：偵測 + 開機 + 暖機加起來幾十秒；30 秒的尖峰可能擴完就過了` },
  ],
  exercise: null,
  refs: [],
}

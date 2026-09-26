// 設計情境：一則貼文要通知 10 萬個追蹤者（notification fan-out）
export default {
  id: 'notifications-fanout',
  order: 18,
  group: 'traffic',
  title: '一則貼文要通知 10 萬個追蹤者',
  en: 'Notification fan-out',
  level: 3,
  skills: ['queues-workers', 'scaling', 'system-design'],
  week: 10,
  lab: 'NotificationsFanoutScenarioLab',
  summary: '名人一發文，10 萬個追蹤者要收到推播。誰來展開這 10 萬筆工作、什麼時候展開、失敗重試怎麼不重複？',
  situation: '社群 App：名人發一則貼文，10 萬個追蹤者要收到通知——全部走 App 推播，其中 2 成的人另外勾了 email。每個人的通知偏好不同（靜音、只收 email、全部關掉）。推播服務（APNs / FCM 前面的自家 gateway）每秒只收 2,000 則。發文的 API 要在 1 秒內回應。worker 會失敗、會被重啟、會重試。',
  constraints: [
    '發文 API 必須 1 秒內回應，不能等通知送完',
    '推播服務每秒最多收 2,000 則，超過就回 429',
    '同一個人對同一則貼文只能收到一次通知，重試也不能重複',
    '每個人的偏好要生效：靜音的人不能被吵到',
    '追蹤者從 200 個到 500 萬個都有，同一套系統要能處理',
  ],
  options: [
    {
      id: 'sync', name: '同步迴圈寄送',
      summary: '發文的請求裡直接 `for follower in followers: push(follower)`，送完才回 201。',
      pros: ['零基礎設施：沒有佇列、沒有 worker、沒有狀態表', '追蹤者只有幾十人時最快最簡單'],
      cons: ['10 萬人 × 每則 5 ms = 8 分鐘，客戶端早就 timeout，發文者以為失敗還會重按', '程序中途重啟就不知道送到哪，重跑會重複；推播服務回 429 也沒地方排隊'],
    },
    {
      id: 'fanout-write', name: 'Fan-out on write（發文時展開）',
      summary: '發文時把 10 萬筆通知工作（已依每人偏好算好管道）批次寫進佇列或工作表，API 回 202；一群 worker 分批取出，依推播服務上限送。',
      pros: ['API 幾百 ms 就回；送多久由 worker 數與推播上限決定，可以獨立擴展', '每筆工作有自己的狀態與重試次數；用 `(post_id, user_id)` 唯一鍵天然去重'],
      cons: ['追蹤者數乘以貼文數就是要寫的列數，500 萬追蹤者一則文就是 500 萬列', '追蹤者在展開之後才改偏好、才取消追蹤，通知照送'],
    },
    {
      id: 'fanout-read', name: 'Fan-out on read（打開 App 時查）',
      summary: '發文時只寫一列貼文。使用者打開 App 時查「我追蹤的人最近有什麼新貼文」，即時算出通知列表；不主動推播，或只送一則主題式（topic）推播。',
      pros: ['發文成本固定 O(1)，追蹤者多少都一樣', '偏好與追蹤關係永遠是最新的，沒有展開後失效的問題'],
      cons: ['每次打開 App 都要 JOIN 追蹤表與貼文表，追蹤很多人的使用者查得慢', '沒有逐人推播：需要「主動送達」的通知做不到，或要另外走 topic 推播'],
    },
    {
      id: 'hybrid', name: '混合：依追蹤者數分流',
      summary: '追蹤者少於門檻（例如 1 萬）的發文者走 fan-out on write；超過門檻的大 V 走 fan-out on read（或 topic 推播），使用者的通知頁把兩種來源合併。',
      pros: ['絕大多數貼文（一般人）享有即時推播與便宜的讀', '少數大 V 不會炸掉佇列與工作表'],
      cons: ['兩條路徑、兩套查詢，通知頁要合併與排序', '門檻附近的使用者行為不一致；要能動態改門檻'],
    },
  ],
  tradeoffs: {
    axes: ['發文 API 延遲', '送達時間', '寫入量', '複雜度'],
    rows: [
      { option: 'sync', cells: ['差：分鐘級', '差：序列送、卡在 429', '無', '最低'] },
      { option: 'fanout-write', cells: ['好：寫入工作即回', '好：worker 數 × 上限決定', '差：追蹤者數 × 貼文數', '中：佇列、worker、去重鍵、退避'] },
      { option: 'fanout-read', cells: ['好：O(1)', '無主動送達', '好：一列', '中：讀取端的 JOIN 與快取'] },
      { option: 'hybrid', cells: ['好', '一般人好、大 V 依讀取', '中', '高：兩條路徑要合併'] },
    ],
  },
  decisions: [
    { id: 'normal-user', situation: '一般使用者發文，200 個追蹤者，希望追蹤者幾秒內收到推播。', options: ['sync', 'fanout-write', 'fanout-read', 'hybrid'], answer: 'fanout-write',
      explain: '200 筆工作寫進佇列不到 100 ms，一個 worker 一秒內送完，每筆有狀態、失敗可重試、唯一鍵擋重複。同步迴圈 200 人看似只要 1 秒，但推播服務回 429 或程序重啟就沒救。fan-out on read 沒有主動推播，不符合「幾秒內收到」。' },
    { id: 'celebrity', situation: '平台上有幾百個名人，追蹤者 100 萬到 500 萬；他們一發文，佇列就被 500 萬筆工作塞滿，一般人的通知跟著延遲半小時。', options: ['sync', 'fanout-write', 'fanout-read', 'hybrid'], answer: 'hybrid',
      explain: '問題是少數大 V 拖垮所有人。依追蹤者數分流：一般人照走 fan-out on write，大 V 的貼文不展開，追蹤者打開 App 時再查（或送一則 topic 推播）。全部改成 fan-out on read 會讓每個人打開 App 都變慢，為了幾百個帳號懲罰所有人不划算。' },
    { id: 'announcement', situation: '系統公告要讓全站 2,000 萬使用者都看到，不急，打開 App 看到就好。', options: ['sync', 'fanout-write', 'fanout-read', 'hybrid'], answer: 'fanout-read',
      explain: '對每個人都一樣的內容沒有理由寫 2,000 萬列。公告存一列，打開 App 時把「未讀公告」併進通知列表，讀取成本是一個小表的查詢。要主動送達再用平台的 topic 推播一次，不需要逐人展開。' },
    { id: 'security-alert', situation: '偵測到某個帳號在陌生裝置登入，要立刻通知該使用者本人，不能等佇列排隊。', options: ['sync', 'fanout-write', 'fanout-read', 'hybrid'], answer: 'sync',
      explain: '收件人只有一個，沒有扇出問題；重點是立刻與確定送出。在登入流程裡直接呼叫推播與 email，設 timeout 與一次重試，失敗才落到高優先佇列補送。丟進共用佇列會排在 10 萬筆貼文通知後面，安全警示晚 10 分鐘等於沒送。' },
  ],
  implementation: [
    { title: '通知工作表：唯一鍵去重、狀態與重試', lang: 'sql', code: `CREATE TABLE notification_jobs (
  id           BIGSERIAL PRIMARY KEY,
  post_id      BIGINT NOT NULL,
  user_id      BIGINT NOT NULL,
  channel      TEXT   NOT NULL,             -- 'push' | 'email'（展開時依偏好決定）
  status       TEXT   NOT NULL DEFAULT 'pending',   -- pending | sent | failed
  attempts     INT    NOT NULL DEFAULT 0,
  next_try_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id, channel)       -- 重試、重複展開都插不進第二筆
);
CREATE INDEX idx_jobs_pending ON notification_jobs (next_try_at) WHERE status = 'pending';

-- 發文時展開（一句 SQL 就是 10 萬列；ON CONFLICT 讓重跑安全）
INSERT INTO notification_jobs (post_id, user_id, channel)
SELECT $1, f.follower_id, p.channel
FROM follows f
JOIN notification_prefs p ON p.user_id = f.follower_id
WHERE f.followee_id = $2 AND p.channel <> 'none'
ON CONFLICT DO NOTHING;` },
    { title: 'worker：分批取工作，多個 worker 不互搶', lang: 'python', code: `def claim_batch(conn, size=200):
    with conn.transaction():
        rows = conn.execute("""
            SELECT id, user_id, channel, post_id
            FROM notification_jobs
            WHERE status = 'pending' AND next_try_at <= now()
            ORDER BY next_try_at
            LIMIT %s
            FOR UPDATE SKIP LOCKED           -- 被別的 worker 鎖住的列直接跳過
        """, (size,)).fetchall()
        ids = [r["id"] for r in rows]
        conn.execute("UPDATE notification_jobs SET attempts = attempts + 1 WHERE id = ANY(%s)", (ids,))
    return rows

def run_worker(conn):
    while True:
        batch = claim_batch(conn)
        if not batch:
            time.sleep(0.5); continue
        for job in batch:
            try:
                # 冪等鍵交給推播服務：同一個 key 再送一次它會去重
                push_gateway.send(job["user_id"], post_id=job["post_id"],
                                  idempotency_key=f"{job['post_id']}:{job['user_id']}")
                mark(conn, job["id"], "sent")
            except RateLimited as e:          # 429：整批往後延，不要硬打
                reschedule(conn, [j["id"] for j in batch], seconds=e.retry_after); break
            except TransientError:
                reschedule(conn, [job["id"]], seconds=backoff(job["attempts"]))` },
    { title: '退避重試：一句話', lang: 'python', code: `def backoff(attempts, base=2, cap=300):
    return min(cap, base ** attempts) + random.uniform(0, 1)   # 2, 4, 8… 秒再加抖動，最多 5 分鐘；超過 8 次進死信` },
  ],
  exercise: null,
  refs: [],
}

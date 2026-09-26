// 設計情境：讀寫分離後的「我剛存的怎麼不見了」
export default {
  id: 'replica-consistency',
  order: 12,
  group: 'data',
  title: '讀寫分離後的「我剛存的怎麼不見了」',
  en: 'Read-your-writes with replicas',
  level: 3,
  skills: ['scaling', 'db-operations', 'transactions'],
  week: 15,
  lab: 'ReplicaConsistencyScenarioLab',
  summary: '主庫寫、兩台副本讀，副本平常落後 50 ms、尖峰 2 秒。使用者改完資料立刻重整，讀到舊值；下單後跳轉訂單頁，404。',
  situation: '讀多寫少的服務把讀流量導到兩台串流複寫的副本，主庫只剩寫入與 10% 的讀。副本延遲平常 50 ms，尖峰時段（大量寫入 + 副本在跑 VACUUM）會到 2 秒。使用者改完個人資料，頁面立刻重新整理；下單成功後前端跳轉到 /orders/{id}。這兩個動作都是「寫完馬上讀」，讀到的卻是幾百毫秒前的世界。',
  constraints: [
    '使用者自己剛寫的資料，下一次讀一定要看到（read-your-writes）',
    '主庫的讀流量不能回到全走主庫的水準，否則讀寫分離白做',
    '副本延遲不可控：50 ms 到 2 秒都要能活',
    '有多台 API 實例，同一個使用者的連續請求不一定落在同一台',
    '訂單頁 404 會讓使用者以為沒下單成功而重複下單',
  ],
  options: [
    {
      id: 'primary-read', name: '寫後一段時間讀主庫',
      summary: '寫入成功時在 cookie / session 記 `last_write_at`；之後 N 秒內該使用者的讀全部導到主庫。',
      pros: ['實作最簡單：一個 middleware 看 cookie 決定連線', '只有剛寫過的使用者會打主庫，其他人照走副本'],
      cons: ['N 秒是猜的：比延遲短就讀到舊值，比延遲長就白打主庫', '靠 cookie，App 或第三方呼叫端沒有 cookie 要另想辦法', '尖峰時剛寫過的人變多，主庫讀流量同步上升'],
    },
    {
      id: 'lsn', name: '帶版本讀：LSN / 時間戳',
      summary: '寫入回傳主庫的 WAL 位置（`pg_current_wal_lsn()`），讀取時先問副本 `pg_last_wal_replay_lsn()`，追上了才讀副本，否則改讀主庫。',
      pros: ['不用猜秒數：副本追上就用副本，只有真的落後時才回主庫', '版本放在 header / token 裡，App 與跨實例都能用'],
      cons: ['讀取多一次往返（查副本 LSN），或要維護一份各副本 LSN 的快取', 'LSN 是 PostgreSQL 專屬；換資料庫要換成別的版本號', '客戶端要願意把版本帶回來'],
    },
    {
      id: 'eventual', name: '接受最終一致',
      summary: '讀全走副本；前端用寫入的回應直接更新畫面（樂觀更新），不重新去讀。',
      pros: ['伺服器端零改動，主庫讀流量最低', '大部分頁面本來就在看別人的資料，延遲幾百毫秒沒人發現'],
      cons: ['整頁重新整理、換裝置、深連結都繞不過去：伺服器就是回舊值', '寫後跳轉的 404 無解，得在前端硬撐（重試、先用 POST 回應渲染）', '出事時很難重現，工程師本機延遲是 0'],
    },
    {
      id: 'all-primary', name: '關鍵讀全走主庫',
      summary: '個人資料、訂單、付款這類「自己的資料」一律讀主庫，副本只給列表、搜尋、報表。',
      pros: ['關鍵路徑零延遲問題，不需要任何路由邏輯', '每個 endpoint 的資料來源一目了然'],
      cons: ['主庫要扛所有關鍵讀，這些往往正是最熱的頁面', '「哪些算關鍵」的分界會隨需求漂移，容易越劃越多'],
    },
  ],
  tradeoffs: {
    axes: ['讀到舊值', '主庫讀流量', '實作複雜度', '跨裝置 / App'],
    rows: [
      { option: 'primary-read', cells: ['低：N 秒內不會', '中：剛寫過的人', '低：cookie + middleware', '差：靠 cookie'] },
      { option: 'lsn', cells: ['無：追上才讀', '最低：只有真落後時', '高：版本傳遞、查 LSN', '好：token 帶版本'] },
      { option: 'eventual', cells: ['高：重整必中', '無', '最低', '差'] },
      { option: 'all-primary', cells: ['無', '高：關鍵頁面全部', '低', '好'] },
    ],
  },
  decisions: [
    { id: 'profile', situation: '個人資料頁。使用者在網頁上改完名字會立刻重新整理確認；流量不大，寫後 5 秒內的讀佔總讀量不到 1%。', options: ['primary-read', 'lsn', 'eventual', 'all-primary'], answer: 'primary-read',
      explain: '寫後讀主庫的成本只落在「剛寫過的 1%」，cookie 記 last_write_at、N 取 5 秒就能蓋過尖峰的 2 秒延遲。eventual 在 F5 面前無解；all-primary 會把所有個人資料頁的讀都推回主庫，沒必要。' },
    { id: 'catalog', situation: '商品列表與商品頁。使用者看的是商家上架的資料，商家在後台改價後看到的是後台自己的頁面；列表佔全站 70% 的讀。', options: ['primary-read', 'lsn', 'eventual', 'all-primary'], answer: 'eventual',
      explain: '讀的人不是寫的人，落後幾百毫秒沒有任何人能察覺，這正是讀寫分離要處理的流量。任何把這 70% 導回主庫的做法都違背初衷；商家後台自己那一頁另外用寫後讀主庫即可。' },
    { id: 'checkout', situation: '付款完成後的訂單頁與付款結果頁。404 或顯示「未付款」會導致重複付款與客訴；這兩頁的讀流量只佔全站 2%。', options: ['primary-read', 'lsn', 'eventual', 'all-primary'], answer: 'all-primary',
      explain: '錯一次的代價是真金白銀，而流量只有 2%，主庫扛得起。直接把這幾個 endpoint 綁死主庫，不依賴 cookie 也不依賴客戶端帶版本，是最不會出錯的做法。' },
    { id: 'app', situation: '行動 App 呼叫同一組 API，沒有 cookie；使用者寫完在 App 內立刻讀，但也常在另一台裝置上看。主庫讀流量已接近上限。', options: ['primary-read', 'lsn', 'eventual', 'all-primary'], answer: 'lsn',
      explain: '沒有 cookie，primary-read 掛不上；主庫接近上限，all-primary 沒空間。寫入回應帶 LSN，App 在後續請求的 header 帶回來，伺服器只在副本沒追上時才讀主庫——平常 50 ms 延遲時幾乎全走副本。跨裝置的情況副本通常早已追上。' },
  ],
  implementation: [
    { title: '寫後讀主庫：cookie 記 last_write_at（FastAPI）', lang: 'python', code: `STICKY_SECONDS = 5  # 要 > 尖峰時的副本延遲

@app.middleware("http")
async def route_reads(request: Request, call_next):
    last = float(request.cookies.get("last_write_at", 0))
    sticky = time.time() - last < STICKY_SECONDS
    # 寫入、或 5 秒內剛寫過 → 主庫；其他讀 → 副本
    request.state.engine = primary if request.method != "GET" or sticky else replica
    response = await call_next(request)
    if request.method != "GET" and response.status_code < 400:
        response.set_cookie("last_write_at", str(time.time()),
                            max_age=STICKY_SECONDS, httponly=True, samesite="lax")
    return response` },
    { title: '查副本落後多少（PostgreSQL）', lang: 'sql', code: `-- 主庫：目前寫到哪（寫入回應帶這個值給客戶端）
SELECT pg_current_wal_lsn();               -- 例：0/3A1F2C80

-- 副本：重播到哪；比要求的 LSN 舊就改讀主庫
SELECT pg_last_wal_replay_lsn() >= '0/3A1F2C80'::pg_lsn AS caught_up;

-- 副本：離主庫有多久（監控用）
SELECT now() - pg_last_xact_replay_timestamp() AS replay_delay;

-- 主庫：每台副本的落後量與時間（pg_stat_replication）
SELECT client_addr, state,
       pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS bytes_behind,
       replay_lag
FROM pg_stat_replication;` },
    { title: '前端樂觀更新（只擋 SPA 內的畫面，擋不住 F5）', lang: 'js', code: `const saved = await api.patch('/me', { name })   // 回應就是主庫剛寫入的列
setProfile(saved)                                 // 直接用回應渲染，不再 GET /me` },
  ],
  exercise: 'scaling-1',
  refs: [],
}

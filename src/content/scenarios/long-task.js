// 設計情境：要跑三分鐘的匯出
export default {
  id: 'long-task',
  order: 5,
  group: 'api',
  title: '要跑三分鐘的匯出',
  en: 'Long-running tasks',
  level: 2,
  skills: ['queues-workers', 'rest-design', 'http-basics'],
  week: 10,
  lab: 'LongTaskScenarioLab',
  summary: '「匯出全年報表」要撈 50 萬筆、產 CSV 兩三分鐘，前面的 nginx 60 秒就斷線。同步等、輪詢，還是推播？',
  situation: '後台的「匯出全年報表」按鈕：撈 50 萬筆訂單、彙整後產出 CSV，約 2–3 分鐘。月初結帳尖峰有 20 人同時按。API 由 4 個 uvicorn worker 服務，前面是 nginx 與雲端負載平衡器，兩層的上游逾時都是 60 秒。',
  constraints: [
    '閘道逾時 60 秒：任何一個 HTTP 回應超過 60 秒就被砍成 504，應用層無法延長',
    'API worker 只有 4 個，被一個請求占住 3 分鐘，其他所有端點跟著排隊',
    '使用者要拿到結果檔案；失敗要看得出來、能重試',
    '部分使用者會在等待期間關掉分頁或切到別頁',
  ],
  options: [
    {
      id: 'sync', name: '同步等待',
      summary: '`POST /exports` 在同一個請求裡撈資料、產 CSV、直接回檔案。',
      pros: ['最簡單：一個端點、沒有狀態要存', '幾秒內能完成的工作體驗最好，按下去就拿到檔案'],
      cons: ['超過閘道逾時一定失敗：使用者拿到 504，但 worker 還在跑，白做', 'API worker 被占滿後，網站其他功能一起變慢或超時', '客戶端斷線伺服器不知道，使用者重按就再算一次'],
    },
    {
      id: 'poll', name: '202 + 輪詢',
      summary: '`POST /exports` 立刻回 `202 Accepted` 與 job id，工作進佇列由背景 worker 做；客戶端每幾秒 `GET /jobs/{id}` 看狀態。',
      pros: ['API 只花幾毫秒，逾時與 worker 占用問題消失', '狀態與進度存在 jobs 表：可顯示進度條、可重試、可查歷史', '客戶端只要會發 HTTP，任何環境都能用'],
      cons: ['多一套東西：佇列、背景 worker、jobs 表', '輪詢有延遲（最多一個間隔）也有無效請求；間隔太短又變成新的負載', '客戶端關掉分頁就不會再輪詢，要另外設計「回來看結果」的入口'],
    },
    {
      id: 'push', name: '202 + 推播通知',
      summary: '同樣 202 + 背景處理，完成時由伺服器主動通知：webhook 打到對方系統、WebSocket / SSE 推到瀏覽器、或 email 附下載連結。',
      pros: ['沒有無效輪詢，完成當下就知道', '機器對機器整合的標準做法（webhook）', '使用者可以離開頁面，email 通知照樣到'],
      cons: ['要維護長連線（WebSocket / SSE）或對外呼叫（webhook 的重試、簽章、對方掛掉怎麼辦）', '推播可能漏（連線斷、對方 5xx），仍要保留查詢端點當備援', '進度回報要另外推，或還是搭配輪詢'],
    },
  ],
  tradeoffs: {
    axes: ['抗閘道逾時', 'API worker 占用', '客戶端複雜度', '完成通知即時性', '基礎設施'],
    rows: [
      { option: 'sync', cells: ['差：超過 60 秒必死', '差：整段工作都占著', '最低', '即時（如果沒逾時）', '無'] },
      { option: 'poll', cells: ['好：API 只回 202', '低：每次輪詢幾毫秒', '中：輪詢、處理 queued / running / done / failed', '差一個輪詢間隔', '佇列 + worker + jobs 表'] },
      { option: 'push', cells: ['好', '最低：沒有輪詢', '高：長連線或接 webhook', '即時', '佇列 + worker + jobs 表 + 通知管道'] },
    ],
  },
  decisions: [
    { id: 'admin-small', situation: '內部後台的小報表，一次只有一個人用，撈 3 千筆約 10 秒產完。', options: ['sync', 'poll', 'push'], answer: 'sync',
      explain: '10 秒遠低於 60 秒逾時，一人使用不會占滿 worker。加佇列與 jobs 表是為一個不存在的問題付成本。要防的只有重按：按鈕送出後 disable，handler 設 30 秒的 `statement_timeout` 當保險。' },
    { id: 'user-export', situation: '面向所有使用者的全年匯出，2–3 分鐘，月初 20 人同時按，頁面要顯示進度。', options: ['sync', 'poll', 'push'], answer: 'poll',
      explain: '超過閘道逾時，同步一定 504。需要進度條，輪詢 `GET /jobs/{id}` 讀 `progress` 欄位最直接；WebSocket 也做得到但多維護一條長連線。完成後回應帶檔案的下載 URL。' },
    { id: 'partner-webhook', situation: '合作夥伴的系統每晚呼叫你的 API 產對帳檔，他們的排程只想「送出請求、收到結果」，不想寫輪詢迴圈。', options: ['sync', 'poll', 'push'], answer: 'push',
      explain: '機器對機器用 webhook：對方註冊 callback URL，完成後 POST 過去（帶 HMAC 簽章與事件 id，對方回 2xx 才算送達，失敗指數退避重試）。仍保留 `GET /jobs/{id}` 讓對方漏掉通知時能補查。' },
    { id: 'video-progress', situation: '使用者上傳影片後要轉檔 1–5 分鐘，頁面要有百分比進度條，轉完自動播放。', options: ['sync', 'poll', 'push'], answer: 'poll',
      explain: '進度是連續變化的狀態：worker 每處理一段就更新 `jobs.progress`，前端每 2 秒輪詢。量大時改 SSE 推進度可省請求，但骨架仍是「202 + 背景 worker + 可查狀態」，只是通知管道不同。' },
  ],
  switchIf: [
    { when: '資料量縮到幾千筆、10 秒內產完，一次只有一兩個人按', then: '改選 `sync`：遠低於 60 秒逾時、占不滿 worker，佇列與 jobs 表是多付的成本；按鈕送出後停用、handler 設查詢逾時。' },
    { when: '呼叫方是合作夥伴的排程系統，不想寫輪詢迴圈', then: '改選 `push`：對方註冊 webhook，完成後帶簽章 POST 過去並重試，`GET /jobs/{id}` 保留給漏接時補查。' },
  ],
  alternative: { option: 'push', holdsWhen: '站內已經在維護 SSE 或 WebSocket 連線（例如站內通知），可以共用那條通道推進度，並且保留 `GET /jobs/{id}` 讓斷線後補查時。' },
  challenge: {
    task: '上方模擬器把「同時按的人數」設 20、「API worker 數」設 4、「工作長度」設 3 分鐘，「同步等待」與「202 + 輪詢」各播放一次，記下逾時 504、白做與 API worker 占用。接著替 202 + 輪詢設計三種畫面：① 匯出還沒完成時使用者重新整理頁面、② 使用者按「取消」、③ 三天後回來重新下載。每種畫面寫出前端呼叫哪個端點、看到哪個 `status`、畫面上的文字與按鈕。下方落地程式碼的 `jobs` 表沒有取消狀態，一併寫出表與 worker 要怎麼改。',
    deliver: '兩次播放的三個數字，加三種畫面各一段規格（端點、status、文字與按鈕），以及 jobs 表與 worker 的改動（各三行內）',
    check: [
      '「同步等待」那次的 504 與白做都大於 0，「202 + 輪詢」那次 504 為 0，數字來自模擬器',
      '① 重新整理後不會再送一次 `POST /exports`：畫面用網址裡的 job id 或「我最近的匯出」接回原本的進度',
      '② 寫出 worker 怎麼得知被取消（例如每批檢查一次 status）、寫到一半的暫存檔怎麼處理，`status` 的 CHECK 加上新值',
      '③ 寫出 `result_url` 保留多久，過期後的畫面是「重新產生」還是說明已過期，不是永遠留著',
    ],
    twist: '業務要求同一個人匯出同一年度，10 分鐘內按第二次要直接拿第一次的結果，不要再算一次。先預測你的設計會不會重算、`jobs` 表要多查哪些欄位，再說出這條規則跟付款的 Idempotency-Key 哪裡相同、哪裡不同。',
  },
  implementation: [
    { title: '送出與查詢：202 Accepted + Location', lang: 'http', code: `POST /exports HTTP/1.1
Content-Type: application/json

{"year": 2025, "format": "csv"}

HTTP/1.1 202 Accepted
Location: /jobs/7f3c9a
Content-Type: application/json

{"job_id": "7f3c9a", "status": "queued", "progress": 0}

GET /jobs/7f3c9a HTTP/1.1

HTTP/1.1 200 OK
Content-Type: application/json

{"job_id": "7f3c9a", "status": "running", "progress": 42,
 "result_url": null, "error": null}

GET /jobs/7f3c9a HTTP/1.1

HTTP/1.1 200 OK
Content-Type: application/json

{"job_id": "7f3c9a", "status": "done", "progress": 100,
 "result_url": "/files/exports/7f3c9a.csv", "error": null}` },
    { title: 'jobs 表', lang: 'sql', code: `CREATE TABLE jobs (
  id          UUID PRIMARY KEY,
  kind        TEXT NOT NULL,                       -- 'export_year'
  params      JSONB NOT NULL,                      -- {"year": 2025}
  status      TEXT NOT NULL DEFAULT 'queued'
              CHECK (status IN ('queued', 'running', 'done', 'failed')),
  progress    SMALLINT NOT NULL DEFAULT 0,
  result_url  TEXT,
  error       TEXT,
  attempts    SMALLINT NOT NULL DEFAULT 0,
  created_by  BIGINT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
-- worker 撿工作依狀態與時間；使用者查自己的工作
CREATE INDEX idx_jobs_status_created ON jobs (status, created_at);
CREATE INDEX idx_jobs_created_by ON jobs (created_by, created_at DESC);` },
    { title: 'worker：更新狀態與進度', lang: 'python', code: `def run_export(job_id: str) -> None:
    job = db.one("SELECT params FROM jobs WHERE id = %s", (job_id,))
    db.execute("""UPDATE jobs SET status = 'running', started_at = now(),
                  attempts = attempts + 1 WHERE id = %s""", (job_id,))
    try:
        total = db.scalar("SELECT count(*) FROM orders WHERE year = %s", (job["params"]["year"],))
        done = 0
        with open(f"/tmp/{job_id}.csv", "w") as f:
            for batch in fetch_keyset(orders, year=job["params"]["year"], size=5000):  # 分批讀，不一次抓 50 萬筆
                write_csv(f, batch)
                done += len(batch)
                if done % 50_000 == 0:                                            # 每 5 萬筆回報一次進度
                    db.execute("UPDATE jobs SET progress = %s WHERE id = %s", (done * 100 // total, job_id))
        url = storage.upload(f"/tmp/{job_id}.csv", f"exports/{job_id}.csv")
        db.execute("""UPDATE jobs SET status = 'done', progress = 100, result_url = %s,
                      finished_at = now() WHERE id = %s""", (url, job_id))
    except Exception as e:
        db.execute("""UPDATE jobs SET status = 'failed', error = %s,
                      finished_at = now() WHERE id = %s""", (str(e)[:500], job_id))
        raise                                       # 交給佇列決定要不要重試

# 佇列消費端：at-least-once，所以 run_export 要能重跑同一個 job_id
for job_id in queue.consume("exports"):
    run_export(job_id)` },
  ],
  exercise: 'queues-workers-2',
  refs: [],
}

// 設計情境：付款請求的冪等與重試——重送不能變成重複扣款
export default {
  id: 'idempotency',
  order: 3,
  group: 'api',
  title: '付款請求的冪等與重試',
  en: 'Idempotency & retries',
  level: 2,
  skills: ['api-patterns', 'transactions', 'queues-workers'],
  week: 10,
  lab: 'IdempotencyScenarioLab',
  summary: '`POST /payments` 每天上萬筆，手機 App 逾時會重試 3 次。同一筆付款送兩次，DB 該有幾筆？',
  situation: '付款 API `POST /payments {order_id, amount}`：每天上萬筆。手機 App 的網路不穩，請求送出後常常等不到回應就逾時，App 內建的 HTTP client 會自動重試 3 次。回應在網路上遺失時，伺服器其實已經扣款成功，只是客戶端不知道。另外「送出」按鈕沒有防連點，兩個請求會在幾毫秒內先後到達。',
  constraints: [
    '同一筆訂單絕不能扣兩次款',
    '重送的請求要拿到和第一次一樣的結果（同一個 payment_id），客戶端才能收斂',
    '兩個幾乎同時到達的相同請求，只能有一個真的執行',
    '每筆付款要留下可稽核的紀錄；去重資料不必永久保存',
    '客戶端是自家的 App 與網頁，可以要求它帶額外的標頭',
  ],
  options: [
    {
      id: 'none', name: '不處理',
      summary: '每個 POST 都當新的付款處理；靠 UI 灰掉按鈕、提醒使用者別按兩次。',
      pros: ['零實作成本', '對真的要付兩筆一樣金額的情況不會誤擋'],
      cons: ['回應遺失後的自動重試就是第二筆扣款，使用者完全沒按第二次', '連點、網路重送、背景重試，每一種都會直接變成重複資料'],
    },
    {
      id: 'key', name: 'Idempotency-Key',
      summary: '客戶端每次「一個意圖」產生一個 UUID 放在 `Idempotency-Key` 標頭；伺服器以 key 為 UNIQUE 存下狀態與回應，重送就回同一份回應。',
      pros: ['重送拿到一模一樣的回應（同一個 payment_id、同一個狀態碼），客戶端不用特別處理', '併發的第二個請求撞到 UNIQUE，可選擇回 409 或等第一個完成再回同一結果', '與業務欄位無關，任何 POST 都能套用同一套 middleware'],
      cons: ['客戶端要配合：key 要在「重試之間」保持不變、在「新意圖」時換新的', '要多一張表與 TTL 清理；回應內容要存下來', '先 SELECT 再 INSERT 的寫法有競態，key 表沒有 UNIQUE 就擋不住連點'],
    },
    {
      id: 'unique', name: '業務唯一鍵（UNIQUE 約束）',
      summary: '`payments.order_id` 加 UNIQUE；第二筆 INSERT 直接被資料庫擋下，API 查出既有那筆回 409。',
      pros: ['資料庫層保證，不管有幾個 API 實例、有沒有交易都擋得住', '不需要客戶端配合，也沒有額外的表', '併發安全：第二個 INSERT 會等第一個 commit 再失敗'],
      cons: ['只適用於天生有唯一鍵的操作；「同一張訂單分兩次付」就不能用 order_id 當鍵', '重送拿到的是 409 不是 201，客戶端要懂「409 = 已經付過，去查」', '擋的是「同一鍵的第二筆」，不是「同一個請求的重送」，語意較粗'],
    },
    {
      id: 'hash', name: '請求內容 hash 去重',
      summary: '伺服器對 user_id + 請求 body 算 hash，短時間內相同 hash 視為重送，回上次的結果。',
      pros: ['客戶端完全不用改，舊版 App 與網頁表單也受惠', '實作與 Idempotency-Key 幾乎相同，只是 key 由伺服器算'],
      cons: ['分不出「重送」與「真的再買一次一模一樣的東西」，只能靠時間視窗猜', 'body 多一個時間戳或欄位順序不同，hash 就不一樣，去重失效', '視窗多長是拍腦袋的數字，太短擋不住慢重試、太長誤擋正常操作'],
    },
  ],
  tradeoffs: {
    axes: ['擋重送', '擋併發連點', '客戶端要改嗎', '複雜度'],
    rows: [
      { option: 'none', cells: ['差：每次重送都是新的一筆', '差', '不用', '最低'] },
      { option: 'key', cells: ['好：回同一份回應', '好：key 表 UNIQUE 擋第二個', '要：產生並保存 key', '中：多一張表、存回應、清 TTL'] },
      { option: 'unique', cells: ['中：擋下但回 409', '好：資料庫保證', '要懂 409', '低：一個約束 + 錯誤處理'] },
      { option: 'hash', cells: ['中：同 body 才擋', '好：hash 表 UNIQUE', '不用', '中：同 key 做法 + 視窗長度'] },
    ],
  },
  decisions: [
    { id: 'payment', situation: '建立付款 `POST /payments`：自家 App 會自動重試，一張訂單可以分多次付（訂金、尾款），金額相同也可能是不同筆。', options: ['none', 'key', 'unique', 'hash'], answer: 'key',
      explain: '一張訂單多筆付款，order_id 不再唯一，UNIQUE 約束用不上；金額相同的合法付款會被 hash 誤擋。客戶端是自家的，帶 Idempotency-Key 沒有阻力：重送回同一結果，併發撞 UNIQUE。' },
    { id: 'address', situation: '更新收件地址 `PUT /users/{id}/address`，整份地址覆寫，App 一樣會逾時重試。', options: ['none', 'key', 'unique', 'hash'], answer: 'none',
      explain: 'PUT 整份覆寫本身就是冪等的：重送三次，結果都是同一份地址。加 Idempotency-Key 是在冪等的操作上再包一層冪等，只多了一張表要維護。要注意的反而是 PATCH 或「加一筆」這種非冪等的寫法。' },
    { id: 'comment', situation: '送出商品評論：網頁表單，前端沒有實作 Idempotency-Key 也短期內不會改；使用者雙擊送出常造成同一則評論出現兩次。', options: ['none', 'key', 'unique', 'hash'], answer: 'hash',
      explain: '客戶端改不了，Idempotency-Key 沒得用；評論沒有天生的唯一鍵。用 user_id + 內容 hash 在幾分鐘的視窗內去重，正好擋住雙擊；真的想連發兩則一模一樣的評論，本來也不該允許。' },
    { id: 'import', situation: '批次匯入合作夥伴的訂單：對方每天丟一個 CSV，每列都有對方系統的 external_order_id，檔案偶爾會重傳。', options: ['none', 'key', 'unique', 'hash'], answer: 'unique',
      explain: '每列天生有唯一鍵，`UNIQUE (partner_id, external_order_id)` 加 `INSERT … ON CONFLICT DO NOTHING`，重傳整份檔案也不會重複，不需要任何客戶端配合，也不必存 hash 或 key。' },
  ],
  implementation: [
    { title: 'Idempotency-Key 處理流程', lang: 'python', code: `import json
from psycopg import IntegrityError

def create_payment(request, body):
    key = request.headers.get("Idempotency-Key")
    if not key:
        return 400, {"error": "Idempotency-Key required"}

    # 1. 先用 UNIQUE 搶位子：搶到 = 第一個，搶不到 = 重送或併發
    try:
        db.execute(
            "INSERT INTO idempotency_keys (key, user_id, status, expires_at)"
            " VALUES (%s, %s, 'processing', now() + interval '24 hours')",
            key, request.user_id)
    except IntegrityError:
        row = db.query_one(
            "SELECT status, response_code, response_body"
            " FROM idempotency_keys WHERE key = %s AND user_id = %s",
            key, request.user_id)
        if row["status"] == "done":                 # 重送：原樣回上次的回應
            return row["response_code"], json.loads(row["response_body"])
        return 409, {"error": "request in progress"}  # 併發：第一個還沒做完

    # 2. 真的處理（自己一個交易）
    payment = charge_and_insert(body)               # 扣款 + INSERT payments
    code, resp = 201, {"payment_id": payment.id, "status": payment.status}

    # 3. 存回應，之後同 key 都回這一份
    db.execute(
        "UPDATE idempotency_keys SET status = 'done',"
        " response_code = %s, response_body = %s WHERE key = %s",
        code, json.dumps(resp), key)
    return code, resp` },
    { title: 'payments 與 idempotency_keys 表', lang: 'sql', code: `CREATE TABLE payments (
  id          BIGSERIAL PRIMARY KEY,
  order_id    BIGINT NOT NULL REFERENCES orders(id),
  amount      NUMERIC(12, 2) NOT NULL,
  status      TEXT NOT NULL DEFAULT 'captured',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 一張訂單只能有一筆成功付款時，用業務唯一鍵擋第二筆
  CONSTRAINT payments_order_unique UNIQUE (order_id)
);

CREATE TABLE idempotency_keys (
  key            TEXT NOT NULL,
  user_id        BIGINT NOT NULL,
  status         TEXT NOT NULL,            -- processing | done
  response_code  INT,
  response_body  JSONB,
  expires_at     TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (key, user_id)               -- 同一個使用者的 key 才算同一個請求
);
-- 排程清掉過期的 key，去重資料不必永久保存
DELETE FROM idempotency_keys WHERE expires_at < now();` },
  ],
  exercise: null,
  refs: [],
}

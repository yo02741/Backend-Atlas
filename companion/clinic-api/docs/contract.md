# 門診掛號 API 契約

前端實作路線（`src/content/project/fe-*.md`）、站上沙箱的假 API（`src/runtime/fakeApi.js`）、這個參考專案（`companion/clinic-api`）與最小接線版本（`companion/clinic-web`）都照這一份。三邊不一致時以這份為準，改契約時四處一起改。

範例資料全部是虛構的；`type` 用保留給範例的 `clinic.example` 網域，是識別碼，不一定能打開。

## 共通規則

| 項目 | 規則 |
|---|---|
| 前綴 | 業務介面都在 `/api` 底下。前端的 Vite proxy 與 nginx 原樣轉送，不改寫路徑 |
| 維運端點 | `GET /healthz`、`GET /ready`、`GET /metrics` 不在 `/api` 底下、不需要登入；給 Kubernetes 探針與 Prometheus 用，不經過前端的 proxy |
| 驗證 | `Authorization: Bearer <access_token>`。除了 `POST /api/auth/login` 與 `GET /api/board`，其他 `/api` 介面都要 |
| 時區 | 日期與時段都以台北時間（`Asia/Taipei`）計算 |
| 成功的 body | `application/json` |
| 錯誤的 body | Problem Details（RFC 9457），`Content-Type: application/problem+json` |

### 錯誤格式

```json
{
  "type": "https://clinic.example/problems/validation-error",
  "title": "Unprocessable Content",
  "status": 422,
  "detail": "欄位格式錯誤",
  "errors": { "patient_id": ["Input should be greater than 0"] }
}
```

- `type`：有特定原因時是 `https://clinic.example/problems/<代碼>`，沒有時是 `about:blank`，此時 `title` 就是 HTTP 狀態的名稱。畫面依 `type` 換文案，不顯示 `title`。
- `detail`：給人看的說明，措辭不屬於契約（測試比 `type`，不比 `detail`）。
- `errors`：只出現在 `validation-error`。格式是 `{ 欄位: [訊息, …] }`，欄位名稱是 body 的欄位名、query 參數名，或標頭名稱（`Idempotency-Key`）。`errors` 不是 RFC 9457 的標準欄位，是本站的約定；前端的 `toFormErrors` 另外也收 `[{ field, message }]` 與 `[{ pointer, detail }]`，對接其他後端時用得到。
- 401 一律附 `WWW-Authenticate: Bearer`；429 一律附 `Retry-After`（整數秒）。

### type 對照

| 狀態碼 | `type` 結尾 | 什麼時候 |
|---|---|---|
| 400 | `about:blank` | body 不是 JSON 物件（解析失敗、是陣列或字串） |
| 401 | `about:blank` | 沒帶 token、token 無效或過期、帳號停用；登入時帳號或密碼錯誤 |
| 403 | `about:blank` | 知道是誰，但這個角色不能做這件事 |
| 404 | `about:blank` | 路徑上的資源不存在，或存在但這位使用者看不到（兩者回應相同） |
| 405 | `about:blank` | 路徑存在、方法不支援 |
| 409 | `already-booked` | 這位病患在這個診次已有未取消的掛號 |
| 409 | `session-full` | 名額已滿 |
| 409 | `daily-limit` | 這位病患同一天已有 3 筆未取消的掛號 |
| 409 | `cancel-deadline-passed` | 已過取消期限（看診前一日 17:00） |
| 409 | `invalid-status` | 狀態不允許這個轉換（已取消或已報到的再取消、再報到） |
| 422 | `validation-error` | 欄位、query 參數或標頭的內容不對，附 `errors` |
| 422 | `idempotency-key-reused` | 同一個 `Idempotency-Key` 用在內容不同的請求 |
| 429 | `about:blank` | 限流 |
| 500、503 | `about:blank` | 伺服器錯誤；`detail` 附 request id，不帶內部資訊 |

掛號的檢查順序是規格的一部分：重複 → 名額 → 每日上限。

## 介面

### `POST /api/auth/login`

body `{ "username": "patient1", "password": "…" }`，兩個都是必填字串。

| 結果 | 回應 |
|---|---|
| 成功 | 200 `{ "access_token": "…", "token_type": "Bearer", "expires_in": 900 }`（`expires_in` 是秒數，假 API 是 3600） |
| 帳號或密碼錯誤 | 401，`detail` 不區分是帳號還是密碼錯 |
| 欄位空白或缺少 | 422 `validation-error` |
| 同一個帳號登入太頻繁 | 429 |

### `GET /api/sessions?date=&doctor_id=`

| 參數 | 必填 | 說明 |
|---|---|---|
| `date` | 否 | `YYYY-MM-DD`；省略時不依日期篩選 |
| `doctor_id` | 否 | 正整數；省略時是全部醫師 |

200：陣列，依 `session_date`、`id` 排序。

```json
[{ "id": 1, "doctor_id": 1, "session_date": "2026-11-26", "period": "morning", "capacity": 2, "remaining": 1 }]
```

`period` 是 `morning`、`afternoon`、`evening`。`remaining` 只供顯示，能不能掛以掛號的結果為準。參數格式不對（`date=11/26`、`doctor_id=abc`、`doctor_id=0`）回 422，`errors` 的 key 是參數名稱。

### `POST /api/sessions/{id}/appointments`

body：

| 欄位 | 說明 |
|---|---|
| `patient_id` | 正整數，不做型別轉換（`"3"`、`true` 都是 422）。病患不用給，給了別人的回 403；櫃台必填，沒給回 422；醫師不能掛號（403） |
| `note` | 選填字串，最多 200 字；只檢查長度，不儲存 |

標頭（選填）`Idempotency-Key`：1–255 個可見的 ASCII 字元（前端用 `crypto.randomUUID()`）；格式不對回 422 `validation-error`，`errors` 的 key 是 `Idempotency-Key`。

| 結果 | 回應 |
|---|---|
| 成功 | 201，`Location: /api/appointments/{id}`，body 是新的掛號（見下方） |
| 同一個鍵、同樣的內容再送一次 | 201，body 與 `Location` 和第一次相同，另附 `Idempotent-Replayed: true`；沒有新增掛號 |
| 同一個鍵、不同的內容 | 422 `idempotency-key-reused` |
| 診次或病患不存在 | 404 |
| 業務規則不允許 | 409（`already-booked`、`session-full`、`daily-limit`） |
| 限流（每位使用者容量 5、每 6 秒補 1 個） | 429 |

冪等鍵的規則：

- 鍵屬於使用者：兩個帳號用同一個字串互不相干。
- 「同樣的內容」是同一個路徑加上同樣的 body（欄位順序不影響）。
- 只記住成功（201）的結果。第一次是 409、422 或 5xx 時沒有留下紀錄，同一個鍵再送會重新執行一次。前端在收到 201、409、422 之後換新的鍵，網路錯誤與 5xx 之後沿用同一個。
- 同一個鍵同時送進來兩個請求時，第二個等第一個結束，再回第一個的結果。
- 紀錄保留 24 小時，之後同一個鍵當成新的。
- 重送拿到的是第一次的回應，不是掛號現在的狀態：第一次之後取消了，重送仍然回 `"status": "booked"` 的那份 body。

### 掛號的格式

```json
{ "id": 7, "session_id": 2, "patient_id": 1, "number": 4, "status": "booked", "created_at": "2026-11-19T01:12:03.120000Z" }
```

`status` 是 `booked`、`checked_in`、`cancelled`。`number` 不回收：取消之後再掛拿到新的號碼。

### `GET /api/appointments?status=&patient_id=&cursor=&limit=`

| 參數 | 必填 | 說明 |
|---|---|---|
| `status` | 否 | `booked`、`cancelled`、`checked_in`；省略時是全部狀態，其他值回 422 |
| `patient_id` | 否 | 櫃台用；病患指定別人的 `patient_id` 拿到空的 `items` |
| `cursor` | 否 | 上一批的 `next_cursor`；省略時從頭開始 |
| `limit` | 否 | 1–100，預設 50；超出範圍回 422 |

200 `{ "items": [掛號…], "next_cursor": 7 }`，依 `id` 排序；`next_cursor` 是 `null` 代表沒有下一批。範圍依角色決定：病患是自己的、醫師是自己診次的、櫃台是全部；範圍與篩選在分頁之前套用。

### `GET /api/appointments/{id}`

200 掛號；不存在或看不到都是 404。

### `POST /api/appointments/{id}/cancel`

沒有 body。200 取消後的掛號。病患只能取消自己的、櫃台可以取消全部、醫師不能（403）；看不到是 404；409 `cancel-deadline-passed`（看診前一日 17:00 之後，櫃台也適用）或 `invalid-status`。

### `POST /api/appointments/{id}/check-in`

沒有 body。200 報到後的掛號。只有櫃台（其他角色 403）；409 `invalid-status`。

### `GET /api/board`

報到看板，不需要登入（掛在候診區的電視上），回應裡沒有病患資料。200：

```json
[{ "room": "101", "doctor": "林醫師", "current_no": 3, "waiting": 5 }]
```

- 列出今天（台北時間）目前這個時段的每個診次，一個診次一列，依 `room` 排序。時段依看診開始時間切：13:30 之前是上午，13:30 起是下午，18:00 起是晚上。
- `room`：醫師的診間號碼（字串）；沒有設定時是醫師的 id。
- `current_no`：這個診次已報到的最大號碼，還沒有人報到是 0。
- `waiting`：狀態是 `booked`（掛了號、還沒報到）的人數。
- 系統沒有「叫號」與「看完」的狀態，`current_no` 用「已報到的最大號碼」代替「目前叫到幾號」；要做真的叫號，要另外加狀態與介面。
- 這個介面不快取，看板每 10 秒輪詢一次。

## 授權拒絕的日誌

回應只有狀態碼與 Problem Details；為什麼被擋寫在伺服器的日誌（`msg` 是 `request rejected`），不回給客戶端：

| `reason` | 等級 | 什麼時候 |
|---|---|---|
| `unauthenticated` | INFO | 401 |
| `forbidden` | WARNING | 403 |
| `not-found` | INFO | 資源真的不存在 |
| `not-visible` | WARNING | 資源存在，但不在這位使用者的範圍內（對外一樣回 404） |
| 其他 | INFO | 和 `type` 的代碼相同（`already-booked`、`validation-error`、`idempotency-key-reused`…），或 `bad-request`、`rate-limited` |

## 假 API 和參考專案不同的地方

假 API 跑在瀏覽器裡、資料在記憶體，下列差異不影響畫面的寫法：

- 帳號的密碼固定是 `demo-password`；token 是 `fake-<帳號>-<序號>`，不會過期。
- `api.auth = false`（預設）時，沒帶 token 的請求當成 `patient1`；`api.auth = true` 時照契約回 401。
- 沒有限流、沒有快取。
- 題目可以用 `api.get(…)`、`api.post(…)` 蓋過任何一條路由；蓋過之後的回應由題目決定，不一定符合這份契約（例如錯誤情境）。
- 內建的範例資料沒有今天的診次，所以內建的 `GET /api/board` 回空陣列；看板的題目自己加路由。

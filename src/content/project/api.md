## 這階段要做出什麼

把前兩階段的資料與規則接到 HTTP。這一階段先定下介面：有哪些資源、路徑怎麼寫、每一種失敗回什麼狀態碼、錯誤 body 長什麼樣子。權限（誰能呼叫哪個介面）留到第 4 階段。

| 方法與路徑 | 用途 | 成功 | 主要錯誤 |
|---|---|---|---|
| `GET /sessions?doctor_id=3&date=2026-11-02` | 查某醫師某天的診次與剩餘名額 | 200 | 422（參數格式錯） |
| `POST /sessions/{id}/appointments` | 在某診次掛號 | 201 + `Location` | 400、422、404、409 |
| `GET /appointments/{id}` | 查一筆掛號 | 200 | 404 |
| `GET /appointments?patient_id=7&cursor=…` | 列出掛號（分頁） | 200 | 422 |
| `POST /appointments/{id}/cancel` | 取消 | 200 | 404、409（已過期限、狀態不能取消） |
| `POST /appointments/{id}/check-in` | 報到 | 200 | 404、409 |

錯誤 body 一律用 Problem Details（[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)，取代了 RFC 7807）的格式，`Content-Type` 是 `application/problem+json`：

```json
{
  "type": "https://clinic.example/problems/session-full",
  "title": "Session full",
  "status": 409,
  "detail": "診次 12 名額已滿"
}
```

資源設計與狀態碼的原則在 [REST 設計](#/skill/rest-design)；分頁、版本、冪等鍵在 [分頁、篩選、版本與冪等鍵](#/skill/api-patterns)；把介面寫成機器讀得懂的契約在 [OpenAPI 與 API 契約](#/skill/openapi)。

## 設計決策與取捨

### 掛號掛在診次底下

建立掛號有兩種寫法：`POST /appointments`（body 帶 `session_id`）或 `POST /sessions/{id}/appointments`。這裡選後者，理由有兩個：

- 診次是掛號的前提，放在路徑上語意清楚：「在這個診次底下新增一筆」
- 診次不存在時回 **404** 很自然——路徑指到的資源不存在。如果 `session_id` 放在 body，診次不存在比較接近「內容參照到不存在的東西」，很多 API 會回 422，兩種說法都有人用

查詢單筆則用扁平的 `/appointments/{id}`：拿到掛號 id 的人不需要知道它屬於哪個診次。

### 取消是狀態轉換，不是刪除

取消後掛號紀錄還在（狀態變成 `cancelled`，號碼不回收），所以不用 `DELETE`——`DELETE` 之後再 `GET` 應該找不到這個資源。剩下兩種寫法：

| 寫法 | 優點 | 缺點 |
|---|---|---|
| `PATCH /appointments/{id}`，body `{"status": "cancelled"}` | 只有一種更新方式 | 要另外限制哪些狀態轉換合法，`{"status": "checked_in"}` 也會從這裡進來 |
| `POST /appointments/{id}/cancel` | 每個動作各自一條路徑，權限與規則好分開 | 路徑裡有動詞，不是純粹的資源風格 |

這裡選 `POST …/cancel` 與 `POST …/check-in`：取消和報到的權限不同（病患能取消、只有櫃台能報到），規則也不同（取消有期限），分開比較不容易出錯。

### 狀態碼的對應

領域層的例外與驗證錯誤在 API 層集中轉換，handler 裡不散落 `return 409`：

| 狀況 | 狀態碼 | `type` 結尾 |
|---|---|---|
| body 不是 JSON 物件（解析失敗、是陣列、是字串） | 400 | `about:blank` |
| 欄位缺少或型別錯 | 422 | `validation-error`，另附 `errors` 陣列 |
| 路徑上的資源不存在 | 404 | `about:blank` |
| 路徑存在、方法不支援 | 405 | `about:blank` |
| `AlreadyBooked` | 409 | `already-booked` |
| `SessionFull` | 409 | `session-full` |
| `DailyLimitExceeded` | 409 | `daily-limit` |
| 已過取消期限 | 409 | `cancel-deadline-passed` |
| 限流（第 6 階段） | 429 | 另加 `Retry-After` 標頭 |

400 與 422 的界線是這個系統自己的約定：**讀不懂**是 400，**讀得懂但內容不對**是 422（422 Unprocessable Content 定義在 RFC 9110）。業界做法並不統一，有些 API 全部回 400；重點是在文件裡寫清楚並且一致。409 用在「請求本身沒問題，但和資源目前的狀態衝突」，同一個狀態碼底下用 `type` 區分原因，前端才能顯示不同的訊息。

`type` 是識別碼，不一定要能打開；這裡用保留給範例的 `clinic.example` 網域。沒有特別類型時用預設值 `about:blank`，此時 `title` 應該就是 HTTP 狀態的名稱。

### 建立成功回 201 與 Location

`201 Created` 加上 `Location: /appointments/42` 標頭，讓客戶端知道新資源在哪裡。body 直接回完整的掛號（含號碼），省掉一次 `GET`。

### 重試與重複建立

手機網路不穩時，客戶端送出 `POST` 後沒收到回應，常見的做法是重送。這個系統有 `UNIQUE (session_id, patient_id)`，所以重送不會產生兩筆掛號，但第二次會收到 409 `already-booked`，使用者會以為失敗。改善的做法是讓客戶端帶 `Idempotency-Key` 標頭（目前是 IETF 的草案），伺服器記住「這個 key 已經處理過、當時的回應是什麼」，重送時回同一個 201。冪等鍵的實作在 [分頁、篩選、版本與冪等鍵](#/skill/api-patterns)，這裡先把介面留好。

### 列表要分頁

`GET /appointments` 的結果會一直增加，一開始就要分頁。依 `id` 遞增的 cursor 分頁（`WHERE id > $cursor ORDER BY id LIMIT 50`）在資料持續新增時不會跳號或重複，比 `OFFSET` 穩定。

## 關鍵程式

例外到 Problem Details 的轉換集中在一個地方。下面這段可以直接執行：

```python run
import json

PROBLEM_BASE = "https://clinic.example/problems/"


class BookingError(Exception):
    status, code, title = 409, "booking-error", "Booking error"

class AlreadyBooked(BookingError):
    code, title = "already-booked", "Already booked"

class SessionFull(BookingError):
    code, title = "session-full", "Session full"

class DailyLimitExceeded(BookingError):
    code, title = "daily-limit", "Daily limit exceeded"


def problem(status, title, code=None, detail=None, **extra):
    body = {"type": PROBLEM_BASE + code if code else "about:blank", "title": title, "status": status}
    if detail:
        body["detail"] = detail
    body.update(extra)
    return status, {"Content-Type": "application/problem+json"}, body


def to_response(exc):
    """handler 外層統一呼叫：業務錯誤轉成 409，其他例外不在這裡處理（交給 500）"""
    if isinstance(exc, BookingError):
        return problem(exc.status, exc.title, exc.code, detail=str(exc))
    raise exc


for e in (AlreadyBooked("這個診次已經掛過了"), SessionFull("診次 12 名額已滿"), DailyLimitExceeded("11/02 已掛 3 診")):
    status, headers, body = to_response(e)
    print(status, headers["Content-Type"], json.dumps(body, ensure_ascii=False))

print(problem(422, "Unprocessable Content", "validation-error",
              errors=[{"field": "patient_id", "message": "必填，且必須是整數"}])[2])
```

同樣的介面寫成 OpenAPI 片段（YAML，不能在瀏覽器執行），之後可以產生文件與客戶端，也能在 CI 裡檢查實作有沒有偏離契約：

```yaml
paths:
  /sessions/{sessionId}/appointments:
    post:
      summary: 在診次掛號
      parameters:
        - name: sessionId
          in: path
          required: true
          schema: { type: integer }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [patient_id]
              properties:
                patient_id: { type: integer }
      responses:
        "201":
          description: 掛號成功
          headers:
            Location: { schema: { type: string } }
        "409":
          description: 已掛過或名額已滿
          content:
            application/problem+json:
              schema: { $ref: "#/components/schemas/Problem" }
```

## 常見錯誤

**錯誤也回 200。** `200 {"ok": false, "error": "full"}` 讓監控、快取、客戶端的錯誤處理全部失效——監控看到的錯誤率是 0。錯誤就用錯誤的狀態碼。

**驗證錯誤變成 500。** body 少一個欄位，程式 `body["patient_id"]` 丟 `KeyError`，使用者收到 500，告警也跟著響。輸入在進入業務邏輯前就要驗證，驗證錯誤是 4xx。

**把資料庫錯誤原文傳給客戶端。** `duplicate key value violates unique constraint "appointments_session_id_patient_id_key"` 洩漏了資料表結構。依約束名稱轉成 `already-booked`，原文只寫進日誌。

**`True` 被當成整數。** Python 裡 `isinstance(True, int)` 是 `True`，`{"patient_id": true}` 會通過檢查並被當成 1 號病患。型別檢查要另外排除 `bool`；用 Pydantic 這類函式庫時，嚴格模式也會擋下這種轉換。

**404 與 405 不分。** 路徑存在、方法不對（`DELETE /sessions/1/appointments`）應該回 405，回 404 會讓呼叫端以為路徑拼錯。

**同一種錯誤有好幾種格式。** 有的 handler 回 `{"error": "..."}`、有的回 `{"message": "..."}`，前端只能逐一猜。錯誤格式集中在 `problem()` 一個函式產生。

## 驗收題在測什麼

驗收題用一個 `handle(method, path, body, user)` 函式模擬路由，回傳 `(status, body)`，資料放在記憶體裡。測試涵蓋：

- 建立掛號回 201，用回傳的 id 查得到同一筆
- body 是 `None`、字串、陣列時回 400
- 缺 `patient_id`、`patient_id` 是字串或布林時回 422，並在 `errors` 指出欄位
- 診次不存在、掛號不存在、id 不是數字、未知路徑都回 404
- 重複掛號與名額已滿都回 409，但 `type` 分別以 `already-booked`、`session-full` 結尾
- 不支援的方法回 405
- 每一個錯誤 body 都有 `type`、`title`、`status`，且 `status` 和狀態碼一致

標頭（`Location`、`Content-Type`）不在驗收範圍內。下一階段讓 `user` 參數真正發揮作用：同一個請求，不同角色會得到不同的結果。

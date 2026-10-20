## 從一個具體問題開始：同一個錯誤，三支 API 三種講法

一個電商後端有三位工程師各自寫了訂單相關的 endpoint：

```http
POST /createOrder            → 200 {"ok": true, "orderId": 1043}
GET  /orders/getById?id=1043 → 200 {"success": false, "msg": "not found"}
POST /order/1043/delete      → 500 {"error": "Order already shipped"}
```

前端要分別寫三種成功判斷、三種錯誤解析。監控看到 `POST /order/1043/delete` 的 500，半夜叫醒值班的人，結果只是使用者想刪一張已出貨的訂單。行動 App 逾時後自動重送 `POST /createOrder`，使用者多了一張訂單。

這些問題的根源相同：資源、方法、狀態碼三件事沒有對齊。REST 風格的 API 設計就是把這三件事講清楚：**路徑指出資源（名詞）、方法表達動作、狀態碼回報結果**。

## 資源與路徑

### 命名規則

| 規則 | 好 | 不好 |
|---|---|---|
| 集合用複數名詞 | `/orders`、`/orders/1043` | `/order`、`/orderList` |
| 動作交給方法，不寫在路徑 | `DELETE /orders/1043` | `POST /orders/delete/1043`、`GET /deleteOrder` |
| 小寫加連字號 | `/shipping-addresses` | `/ShippingAddresses`、`/shipping_addresses`（底線也可，但要全站一致） |
| id 是不透明的字串 | `/orders/ord_7Fk2` 或 `/orders/1043` | 讓客戶端拼出 id 的規則 |
| 不在路徑放副檔名 | `Accept: application/json` | `/orders/1043.json` |

### 巢狀資源：最多一層

子資源只在「離開父資源就沒有意義」時才巢狀：

```http
GET  /orders/1043/items          # 訂單明細只屬於這張訂單：巢狀合理
POST /orders/1043/items
GET  /users/42/orders            # 「某人的訂單」：方便的入口
GET  /orders?user_id=42          # 同一件事的另一種寫法，篩選更彈性
GET  /orders/1043                # 訂單本身仍有自己的頂層位址
```

避免 `/users/42/orders/1043/items/7/reviews` 這種深巢狀：客戶端必須先知道整條父鏈才能存取，而且每一層都要檢查「這張訂單真的屬於使用者 42 嗎」。超過一層時，給子資源自己的頂層路徑（`/order-items/7`）。

### 非 CRUD 的動作

「取消訂單」「重寄驗證信」不是單純的增刪改查。兩種常見建模：

| 做法 | 範例 | 適合 |
|---|---|---|
| 狀態轉移 | `PATCH /orders/1043` `{"status": "cancelled"}` | 動作就是改狀態欄位，伺服器驗證轉移是否合法 |
| 動作子資源 | `POST /orders/1043/cancel` | 動作有自己的參數（取消原因）、副作用（退款、通知），或不對應單一欄位 |
| 把動作變成資源 | `POST /refunds` `{"order_id": 1043}` | 動作本身需要被查詢、有自己的生命週期 |

三者都可以，團隊選定一種寫進規範比選哪種重要。

## 方法：安全、冪等與 PUT vs PATCH

| 操作 | 方法與路徑 | 成功狀態碼 | 冪等 | 重送安全嗎 |
|---|---|---|---|---|
| 列出訂單 | `GET /orders` | 200 | 是 | 是 |
| 讀一張 | `GET /orders/{id}` | 200 | 是 | 是 |
| 建立 | `POST /orders` | 201 + `Location` | 否 | 要搭配 `Idempotency-Key`（見 [分頁、篩選、版本與冪等鍵](#/skill/api-patterns)） |
| 整筆取代 | `PUT /orders/{id}` | 200 或 204 | 是 | 是 |
| 部分修改 | `PATCH /orders/{id}` | 200 或 204 | 視內容 | 「設成某值」是，「加一」不是 |
| 刪除 | `DELETE /orders/{id}` | 204 | 是 | 是 |

**PUT 是取代**：送出的內容就是資源的新樣子，沒給的欄位等於清空（或重設為預設值）。**PATCH 是部分修改**，常見的兩種格式：

- **JSON Merge Patch**（RFC 7396，`Content-Type: application/merge-patch+json`）：送一個物件，有給的欄位覆蓋、值為 `null` 的欄位刪除。簡單，但無法把欄位設成 `null`、也無法操作陣列中的單一元素。
- **JSON Patch**（RFC 6902，`application/json-patch+json`）：送一串操作 `[{"op": "replace", "path": "/note", "value": "急件"}]`，能精確操作陣列，但寫起來囉嗦。

多數團隊直接收 `application/json` 並當作 merge patch 處理。這可以，但要寫清楚 `null` 是「清空」還是「不改」。

PUT 也可以用來建立：客戶端自己決定 id 時（例如上傳到 `PUT /files/report-2026-10.pdf`），不存在就建立回 201，存在就取代回 200。

## 狀態碼怎麼選

### 成功

- **`200 OK`**：有回應 body。
- **`201 Created`**：建立了新資源，帶 `Location` 指向它；body 通常放新資源的內容，省客戶端再 GET 一次。
- **`202 Accepted`**：收到了但還沒做完（長任務），見 [分頁、篩選、版本與冪等鍵](#/skill/api-patterns)。
- **`204 No Content`**：成功且沒有 body，常用在 DELETE、不回傳內容的 PUT／PATCH。204 不能帶 body。

```http
HTTP/1.1 201 Created
Location: /orders/1043
Content-Type: application/json

{"id": 1043, "status": "pending", "items": [{"product_id": 1, "qty": 2}], "amount": 1980}
```

### 客戶端錯誤：最容易混的幾組

| 狀況 | 狀態碼 | 說明 |
|---|---|---|
| JSON 解析失敗、缺必要參數、型別錯 | `400 Bad Request` | 請求本身就不合格式 |
| 格式正確但業務規則不允許（數量為負、日期在過去） | `422 Unprocessable Content` | RFC 9110 定義；舊名 Unprocessable Entity。也有團隊把驗證錯誤一律回 400，選一種一致使用 |
| 沒帶憑證、token 過期或無效 | `401 Unauthorized` | 名字取得不好，實際意思是「未認證」；規範要求附 `WWW-Authenticate` |
| 已認證但沒有權限 | `403 Forbidden` | 重新登入也沒用 |
| 資源不存在，或不想透露它存在 | `404 Not Found` | 別人的訂單回 404 而不是 403，避免讓人用 id 探測哪些訂單存在 |
| 方法不支援 | `405 Method Not Allowed` | 要附 `Allow: GET, PATCH` |
| 跟目前狀態衝突 | `409 Conflict` | 取消已出貨的訂單、重複建立同一個 email 的帳號 |
| 條件請求不成立 | `412 Precondition Failed` | `If-Match` 帶的版本已經不是最新 |
| 不支援的 body 格式 | `415 Unsupported Media Type` | 送了 `text/plain`，只收 JSON |
| 請求太頻繁 | `429 Too Many Requests` | 帶 `Retry-After` |

400 與 422 的界線在「伺服器看不看得懂這個請求」：`{"qty": "兩個"}` 型別不對，回 400；`{"qty": -2}` 看得懂但不合規則，回 422。

401 與 403 的界線在「重新認證有沒有用」：token 過期，換新的就好，回 401；一般會員打管理員 API，換 token 也沒用，回 403。

### 用 412 防止覆蓋別人的修改

兩個客服同時編輯同一張訂單的備註，後存的人會蓋掉先存的人。用 ETag 加 `If-Match` 做樂觀鎖：

```http
GET /orders/1043
→ 200, ETag: "v7"

PATCH /orders/1043
If-Match: "v7"
Content-Type: application/merge-patch+json

{"note": "改寄公司"}
→ 200, ETag: "v8"            # 版本對得上，更新成功

PATCH /orders/1043            # 另一位客服還拿著 v7
If-Match: "v7"
→ 412 Precondition Failed     # 版本已經是 v8，拒絕；客戶端要重新 GET 再改
```

想強制客戶端一定要帶 `If-Match`，沒帶的請求可以回 `428 Precondition Required`（RFC 6585）。

### 伺服器錯誤

5xx 只用在**伺服器自己的問題**：未預期的例外（500）、依賴的服務掛了（502／503）、逾時（504）。「訂單已出貨不能刪」是正常的業務結果，回 409，不是 500。

## 錯誤回應的格式

狀態碼只給了類別，客戶端還需要知道「哪個欄位錯、錯在哪」。所有 endpoint 共用一個格式，前端才能寫一套處理。RFC 9457（Problem Details for HTTP APIs，取代 RFC 7807）定義了 `application/problem+json`：

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json

{
  "type": "https://api.shop.example/problems/validation",
  "title": "請求內容不合規則",
  "status": 422,
  "detail": "有 2 個欄位不合規則",
  "instance": "/orders",
  "errors": [
    {"field": "items[0].qty", "code": "MIN_VALUE", "message": "數量至少為 1"},
    {"field": "shipping_address.zip", "code": "REQUIRED", "message": "缺少郵遞區號"}
  ]
}
```

`type`、`title`、`status`、`detail`、`instance` 是標準欄位，`errors` 是擴充欄位（RFC 允許自訂）。`type` 是錯誤種類的識別碼，給程式判斷用；`title`、`detail` 給人看。錯誤碼怎麼分層、要不要對外暴露內部訊息，見 [錯誤設計](#/skill/error-design)。

## 列表：過濾、排序、欄位選擇

```http
GET /orders?status=paid&created_after=2026-10-01&sort=-created_at,id&limit=20
```

- **過濾**用欄位名當參數：`status=paid`；多值用逗號 `status=paid,shipped` 或重複參數 `status=paid&status=shipped`，選一種。
- **範圍**用後綴：`created_after`、`amount_gte`，或 `amount[gte]=100`（要考慮框架能不能解析方括號）。
- **排序**常見寫法 `sort=-created_at`（減號代表遞減）。排序最後要接唯一欄位（`id`），否則同一個 `created_at` 的資料在分頁時順序不穩定。
- **白名單**：只允許明列的欄位過濾與排序。直接把參數名拼進 SQL 會造成注入或沒有索引的慢查詢。
- 分頁的規格（offset 或 cursor、回應長什麼樣）見 [分頁、篩選、版本與冪等鍵](#/skill/api-patterns)。

## 實際程式：一個訂單資源的狀態碼判斷

下面這段 Python 用記憶體模擬訂單資源，把上面的狀態碼規則寫成程式：驗證失敗回 400／422、找不到或不屬於你回 404、狀態衝突回 409、版本不符回 412。

```python run
import json

orders = {1043: {"id": 1043, "owner": 42, "status": "shipped", "note": "", "version": 7}}
next_id = 1044

def problem(status, title, **extra):
    return status, {"Content-Type": "application/problem+json"}, {"title": title, "status": status, **extra}

def create_order(user, body):
    global next_id
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return problem(400, "body 不是合法的 JSON")
    if not isinstance(data.get("qty"), int):
        return problem(400, "qty 必須是整數")                 # 型別錯：看不懂
    if data["qty"] < 1:
        return problem(422, "數量至少為 1", field="qty")       # 看得懂但不合規則
    order = {"id": next_id, "owner": user, "status": "pending", "note": "", "version": 1}
    orders[next_id] = order
    next_id += 1
    return 201, {"Location": f"/orders/{order['id']}"}, dict(order)   # 回傳當下的快照

def cancel_order(user, order_id):
    o = orders.get(order_id)
    if o is None or o["owner"] != user:
        return problem(404, "找不到訂單")                       # 別人的訂單也回 404
    if o["status"] == "shipped":
        return problem(409, "已出貨的訂單不能取消", current_status=o["status"])
    o["status"] = "cancelled"
    return 204, {}, None

def patch_order(user, order_id, if_match, body):
    o = orders.get(order_id)
    if o is None or o["owner"] != user:
        return problem(404, "找不到訂單")
    if if_match is None:
        return problem(428, "請帶 If-Match")
    if if_match != f'"v{o["version"]}"':
        return problem(412, "訂單已被修改，請重新讀取")
    o.update({k: v for k, v in json.loads(body).items() if k in ("note",)})   # 只允許改白名單欄位
    o["version"] += 1
    return 200, {"ETag": f'"v{o["version"]}"'}, dict(o)

for label, result in [
    ("建立：qty 是字串", create_order(42, '{"qty": "兩個"}')),
    ("建立：qty = 0", create_order(42, '{"qty": 0}')),
    ("建立：正常", create_order(42, '{"qty": 2}')),
    ("取消別人的訂單", cancel_order(7, 1043)),
    ("取消已出貨的訂單", cancel_order(42, 1043)),
    ("取消剛建立的訂單", cancel_order(42, 1044)),
    ("改備註：版本對", patch_order(42, 1043, '"v7"', '{"note": "改寄公司"}')),
    ("改備註：拿舊版本", patch_order(42, 1043, '"v7"', '{"note": "放管理室"}')),
]:
    status, headers, body = result
    print(f"{label:<12} → {status} {headers} {body}")
```

## 常見錯誤

- **成功一律 200**：建立回 200 而不給 `Location`，客戶端不知道新資源在哪；刪除回 200 加空 body，部分 client 會嘗試解析 JSON 而失敗。
- **`200 {"success": false}`**：HTTP 層說成功、body 說失敗。快取可能把這個錯誤存起來，監控也看不到錯誤率。
- **所有驗證錯誤回 500**：常見原因是框架的驗證例外沒有被轉換，掉到全域處理器變成 500。FastAPI 的 pydantic 驗證錯誤預設回 422；Flask、Express 要自己處理。
- **401 沒附 `WWW-Authenticate`**：多數 SPA 不在意，但部分 HTTP client 依此決定要不要重新取得 token。
- **路徑上用 GET 做改變狀態的動作**：`GET /orders/1043/cancel`，被瀏覽器預先載入或連結預覽觸發。
- **PUT 當成 PATCH 用**：客戶端只送 `{"note": "..."}`，伺服器卻把其他欄位清空，或反過來：伺服器只更新有給的欄位，客戶端以為送 `{}` 會清空。
- **404 和 405 搞混**：路徑存在但方法不支援要回 405 加 `Allow`；多數框架會自動處理，自訂路由時容易漏。
- **洩漏存在與否**：別人的訂單回 403，等於告訴對方「這個 id 存在」。

## 動手

1. 開 [REST 資源設計](#/lab/RestLab) 實驗室，逐一選擇意圖（建立、部分更新、取消、刪除…），對照它給的方法、路徑、狀態碼與冪等性，和上面的表比較。
2. 按 Python 那段的「在 Playground 開啟」，加一個 `delete_order`：已出貨回 409、刪除成功回 204、刪除不存在的訂單回 404；然後想一想第二次 DELETE 回 404 是否違反冪等（不違反，狀態相同）。
3. 把 `patch_order` 改成也接受 `status` 欄位，並在裡面檢查狀態轉移是否合法（`pending → cancelled` 可以、`shipped → pending` 不行），不合法時該回 409 還是 422？寫下理由並寫進團隊規範。
4. 為「訂單」資源列出 6 個 endpoint，標出方法、路徑、成功狀態碼與兩種最可能的錯誤狀態碼，再到 [API 改版不弄壞客戶端](#/scenario/versioning) 想想這些 endpoint 日後要改格式時怎麼辦。

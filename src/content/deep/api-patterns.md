## 從一個具體問題開始：無限捲動看到重複的商品

商品列表 API 是 `GET /products?page=3&size=20`，背後是 `ORDER BY created_at DESC OFFSET 40 LIMIT 20`。使用者往下捲到第 3 頁時，後台剛好上架了 2 件新商品。新商品排在最前面，所有舊商品往後移 2 格，第 3 頁的前 2 筆其實是第 2 頁的最後 2 筆：使用者看到重複的商品。反過來，若有商品下架，就會有商品被跳過、永遠看不到。

同一個團隊的另外幾件事也在等規格：匯出報表要跑三分鐘，HTTP 請求等不了那麼久；手機 App 下單逾時後會自動重送，偶爾成立兩張訂單；`/v1` 的回應格式要改，但舊版 App 還會活半年。

這些都不是「要寫什麼程式」的問題，而是「規格怎麼定」：請求帶什麼、回應長什麼樣、邊界情況怎麼處理。規格定好了，客戶端和伺服器才能各自實作而不互相猜。這一課把每個模式的規格寫清楚；各做法的取捨比較在對應的設計情境裡。

## 分頁：offset 與 cursor

### 兩種規格

| | offset 分頁 | cursor 分頁 |
|---|---|---|
| 請求 | `?page=3&size=20` 或 `?offset=40&limit=20` | `?limit=20&cursor=eyJjIjoiMjAyNi0xMC0...` |
| 查詢 | `ORDER BY created_at DESC, id DESC OFFSET 40 LIMIT 20` | `WHERE (created_at, id) < ($1, $2) ORDER BY created_at DESC, id DESC LIMIT 20` |
| 跳到第 N 頁 | 可以 | 不行，只能上一頁、下一頁 |
| 資料一直新增時 | 重複或遺漏 | 穩定：起點是「上一頁最後一筆」，不是位置 |
| 深頁效能 | `OFFSET 100000` 要掃過前十萬列 | 走索引，任何深度都一樣快 |
| 總筆數 | 通常一起回（要多跑一次 `COUNT`） | 通常不回 |

### cursor 規格的細節

回應格式：

```http
GET /products?limit=2&sort=-created_at

HTTP/1.1 200 OK
Content-Type: application/json

{
  "data": [
    {"id": 981, "name": "保溫杯", "created_at": "2026-10-19T08:00:00Z"},
    {"id": 977, "name": "帆布袋", "created_at": "2026-10-19T08:00:00Z"}
  ],
  "next_cursor": "eyJjIjoiMjAyNi0xMC0xOVQwODowMDowMFoiLCJpZCI6OTc3fQ",
  "has_more": true
}
```

規格要寫明的事：

- **cursor 是不透明的字串**。內容是最後一筆的排序鍵（上例 base64 解開是 `{"c":"2026-10-19T08:00:00Z","id":977}`），但文件要說「客戶端不得解析或自行組合」，伺服器才能隨時改內部格式。需要防竄改時加上簽章。
- **排序鍵要唯一**。只用 `created_at` 排序時，同一秒建立的兩筆商品可能被分頁邊界切開而遺漏，所以要加上 `id` 當第二排序鍵，cursor 裡也要帶 `id`。
- **cursor 綁定查詢條件**。拿 `status=active` 產生的 cursor 去查 `status=sold`，結果沒有意義。可以把篩選條件也編進 cursor，條件不符時回 400。
- **最後一頁**：`next_cursor` 為 `null`、`has_more` 為 `false`。不要讓客戶端靠「這頁不足 `limit` 筆」判斷，伺服器可能因為權限過濾而少回。
- **`limit` 要有上限**（例如最大 100），超過時回 400 或直接截斷，文件寫明是哪一種。

也可以用 `Link` 標頭（RFC 8288）放下一頁網址：`Link: <https://api.shop.example/products?cursor=...>; rel="next"`。放在 body 或標頭都可以，全站一致即可。

offset 分頁仍然適合後台管理表格（要跳頁、要總數、資料量有限）。兩種做法的完整取捨在 [列表 API 的分頁](#/scenario/pagination)。

## 篩選與排序

```http
GET /products?category=kitchen&price_gte=100&price_lt=500&q=保溫&sort=-price,id
```

| 規則 | 說明 |
|---|---|
| 篩選欄位白名單 | 只接受文件列出的參數；未知參數回 400（嚴格）或忽略（寬鬆），寫明是哪一種。嚴格模式能抓到拼錯的參數 |
| 運算子用固定後綴 | `_gte`、`_gt`、`_lte`、`_lt`、`_in`；全站同一套 |
| 多值 | `category_in=kitchen,bath`；值本身有逗號時要定義跳脫規則 |
| 排序白名單 | 只允許有索引支撐的欄位；`sort=password_hash` 回 400 |
| 預設排序 | 文件寫明；沒有預設排序時，資料庫回傳順序不保證穩定 |
| 全文搜尋 | `q` 參數與結構化篩選分開；搜尋相關度排序與 cursor 分頁很難同時保證穩定 |

條件組合太複雜（巢狀的 AND／OR）時，查詢字串會變得難以閱讀，可以改用 `POST /products/search` 帶 JSON body。代價是失去 GET 的可快取性與可分享的網址。搜尋類的設計取捨見 [商品搜尋與篩選](#/scenario/search-filter)。

## 版本與向後相容

### 先分清楚什麼是破壞性變更

| 變更 | 破壞性嗎 | 原因 |
|---|---|---|
| 回應加一個新欄位 | 通常不是 | 客戶端應該忽略不認識的欄位；但嚴格反序列化的客戶端會壞，規格要寫明「必須忽略未知欄位」 |
| 請求加一個**選填**參數 | 不是 | 舊客戶端不送，伺服器用預設值 |
| 請求加一個**必填**參數 | 是 | 舊客戶端不會送 |
| 刪欄位、改欄位名 | 是 | |
| 改型別（`"amount": "19.80"` 改成 `1980`） | 是 | |
| 改語意（`amount` 從含稅改成未稅） | 是，而且最危險 | 型別沒變，程式不會報錯，金額默默算錯 |
| enum 加新值 | 對請求不是；對回應**可能是** | 客戶端的 `switch` 沒有 default 分支時會出錯；規格要寫明「必須處理未知值」 |
| 放寬驗證（長度上限 50 → 100） | 對請求不是 | 但回應裡出現更長的值，可能撐破客戶端的欄位 |
| 收緊驗證 | 是 | 原本合法的請求變成 400 |

### 版本放在哪

| 位置 | 範例 | 特性 |
|---|---|---|
| 路徑 | `/v1/orders`、`/v2/orders` | 最直白，路由、log、快取都看得到；整個 API 一起升版 |
| 標頭 | `Api-Version: 2026-09-01` 或 `Accept: application/vnd.shop.v2+json` | URL 不變；用日期當版本可以細到每次變更，但除錯時容易漏看標頭 |
| 查詢參數 | `?version=2` | 簡單，但容易被快取與 log 處理成不同資源 |

不管放哪，都要定**淘汰流程**：公告日期、回應加上 `Sunset` 標頭（RFC 8594）標示停用時間、追蹤還在用舊版的客戶端、到期後回 `410 Gone` 或轉到新版。HTTP 也有 `Deprecation` 標頭可以標示「已被棄用」，它的標準化比 `Sunset` 晚，採用前確認你用的閘道與 client 是否支援。

```http
HTTP/1.1 200 OK
Sunset: Sat, 01 May 2027 00:00:00 GMT
Link: <https://api.shop.example/docs/migrate-v2>; rel="sunset"
```

能不升版就不升版：用「加新欄位、保留舊欄位」處理多數變更，只有累積到無法相容時才開新版。多版本並行的策略比較見 [API 改版不弄壞客戶端](#/scenario/versioning)；用 OpenAPI 在 CI 自動檢查破壞性變更見 [OpenAPI 與 API 契約](#/skill/openapi)。

## 冪等鍵：Idempotency-Key

`POST /orders` 不是冪等的。客戶端送出後逾時，不知道伺服器有沒有建立訂單，重送可能建出第二張。解法是讓客戶端為「一次意圖」產生一個唯一值，伺服器用它辨認重送：

```http
POST /orders
Idempotency-Key: 6f1c2a9e-4b7d-4e1a-9c3f-2d8b5a7e0c41
Content-Type: application/json

{"product_id": 1, "qty": 2}
```

規格要定的事：

| 項目 | 常見規定 |
|---|---|
| key 誰產生 | 客戶端，每次「使用者按下送出」產生一個 UUID；**重試沿用同一個**，新的意圖才換新的 |
| 適用範圍 | 只有 POST（以及非冪等的 PATCH）需要；GET、PUT、DELETE 本來就冪等 |
| key 的唯一範圍 | 依使用者（或 API key）分開：`(user_id, key)` 唯一，避免不同使用者的 key 撞在一起 |
| 同 key、同 body 重送 | 回**第一次的回應**（同狀態碼、同 body），不再執行 |
| 同 key、不同 body | 回 422 或 409，代表客戶端程式有 bug（重用了 key） |
| 第一次還在處理中又收到重送 | 回 409，請客戶端稍後再試；不能讓兩個請求同時執行 |
| 保存多久 | 至少涵蓋客戶端的重試時間窗；常見 24 小時，之後同 key 視為新請求 |
| 失敗要不要記 | 4xx 驗證錯誤通常不記（修正後可以用同 key 重送）；已經執行到一半的錯誤要記下狀態 |

這個標頭目前是 IETF 的草案（draft-ietf-httpapi-idempotency-key-header），還不是正式的 RFC，各家 API 的細節（衝突時回 409 還是 422、保存多久）不完全相同，所以要寫進自己的規格。伺服器端怎麼用資料庫唯一鍵與交易實作、跟「資料庫唯一約束」等其他做法的比較，見 [付款請求的冪等與重試](#/scenario/idempotency)。

## 批次操作

一次建立或更新 100 筆時，最難的是**部分成功**怎麼表達。先決定語意：

| 語意 | 回應 | 適合 |
|---|---|---|
| 全有全無 | 全部成功回 200／201；任何一筆失敗整批不做，回 422 並列出哪幾筆錯 | 會計分錄、互相依賴的資料 |
| 各自獨立 | 回 200，body 逐筆列出結果 | 批次匯入、批次通知 |

```http
POST /products/batch
Content-Type: application/json

{"items": [{"sku": "A-1", "price": 120}, {"sku": "A-2", "price": -5}, {"sku": "A-3", "price": 80}]}

HTTP/1.1 200 OK
Content-Type: application/json

{
  "results": [
    {"index": 0, "status": 201, "id": 5001},
    {"index": 1, "status": 422, "error": {"code": "MIN_VALUE", "field": "price"}},
    {"index": 2, "status": 201, "id": 5002}
  ],
  "succeeded": 2,
  "failed": 1
}
```

各自獨立時，外層回 200 而不是 201 或 4xx，因為外層狀態碼只能表達一件事；每筆的結果在 body 裡。WebDAV 有 `207 Multi-Status`，但它的 body 格式原本是 XML，用在 JSON API 上屬於借用，客戶端不一定認得。另外要定：一批最多幾筆、整批有沒有冪等鍵、每筆用 `index` 還是客戶端給的 id 對應。

## 長任務：202 加狀態查詢

匯出報表要跑三分鐘，遠超過一般 proxy 與客戶端的逾時。改成「先收下、之後查」：

```http
POST /exports
Content-Type: application/json

{"type": "orders", "month": "2026-09"}

HTTP/1.1 202 Accepted
Location: /exports/exp_81d2
Retry-After: 5
Content-Type: application/json

{"id": "exp_81d2", "status": "queued"}
```

```http
GET /exports/exp_81d2
→ 200 {"id": "exp_81d2", "status": "running", "progress": 0.4}

GET /exports/exp_81d2
→ 200 {"id": "exp_81d2", "status": "succeeded",
       "result_url": "/exports/exp_81d2/file", "expires_at": "2026-10-21T02:00:00Z"}
```

規格要定的事：

- **狀態集合**：`queued`、`running`、`succeeded`、`failed`、`cancelled`，以及哪些是終態。客戶端只在終態停止輪詢。
- **輪詢間隔**：用 `Retry-After` 建議，客戶端要遵守；也可以提供 webhook 或 SSE 通知（見 [即時通訊怎麼選](#/skill/realtime-choice)）。
- **失敗的表達**：任務失敗時，`GET /exports/{id}` 本身仍回 200（查詢成功），body 裡 `status: failed` 加錯誤內容。查詢請求的狀態碼與任務的結果是兩件事。
- **結果怎麼拿**：放 `result_url`；也有 API 在完成後讓狀態查詢回 `303 See Other` 轉到結果。選一種。
- **取消**：`POST /exports/{id}/cancel` 或 `DELETE /exports/{id}`。
- **建立請求要冪等**：一樣用 `Idempotency-Key`，否則重送會啟動兩個匯出。
- **保留期限**：結果與狀態保存多久，過期後回 404 或 410。

佇列、worker 與進度回報的架構選擇見 [要跑三分鐘的匯出](#/scenario/long-task)。

## 實際程式：offset 為什麼會重複、cursor 為什麼不會

下面用 SQLite 模擬「讀完第 1 頁後，新增了 2 筆」，比較兩種分頁讀到的第 2 頁：

```python run
import sqlite3, base64, json

db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, created_at TEXT)")
for i in range(1, 11):
    db.execute("INSERT INTO products VALUES (?, ?, ?)", (i, f"商品{i}", f"2026-10-{i:02d}"))

def offset_page(page, size=3):
    return [r[0] for r in db.execute(
        "SELECT id FROM products ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
        (size, (page - 1) * size))]

def encode(row):    # cursor：最後一筆的排序鍵，編成不透明字串
    return base64.urlsafe_b64encode(json.dumps({"c": row[1], "id": row[0]}).encode()).decode()

def cursor_page(cursor=None, size=3):
    if cursor is None:
        rows = db.execute("SELECT id, created_at FROM products ORDER BY created_at DESC, id DESC LIMIT ?", (size,)).fetchall()
    else:
        k = json.loads(base64.urlsafe_b64decode(cursor))
        rows = db.execute(
            "SELECT id, created_at FROM products WHERE (created_at, id) < (?, ?) "
            "ORDER BY created_at DESC, id DESC LIMIT ?", (k["c"], k["id"], size)).fetchall()
    return [r[0] for r in rows], (encode(rows[-1]) if rows else None)

p1_offset = offset_page(1)
p1_cursor, nxt = cursor_page()
print("第 1 頁（兩種一樣）：", p1_offset, p1_cursor)

# 使用者還在看第 1 頁時，上架了 2 件新商品
db.execute("INSERT INTO products VALUES (11, '新品A', '2026-10-11')")
db.execute("INSERT INTO products VALUES (12, '新品B', '2026-10-12')")

print("offset 第 2 頁：", offset_page(2), "← 前兩筆和第 1 頁重複")
print("cursor 第 2 頁：", cursor_page(nxt)[0], "← 接著第 1 頁最後一筆往下")
print("cursor 長這樣：", nxt)
```

SQLite 3.15 以後支援 `(a, b) < (?, ?)` 這種列值比較；PostgreSQL 也支援，而且能用 `(created_at, id)` 的複合索引。MySQL 雖然語法可用，但較舊的版本不一定會用索引處理列值比較，必要時改寫成 `created_at < ? OR (created_at = ? AND id < ?)`。

## 常見錯誤

- **cursor 只用非唯一欄位**：`WHERE created_at < ?`，同一時間戳的多筆資料在頁邊界被跳過。
- **cursor 用遞增 id 但排序是別的欄位**：排序和 cursor 條件必須是同一組鍵。
- **把總筆數當成必備**：`COUNT(*)` 在大表上很慢，無限捲動的列表通常不需要；需要時改回「超過 1,000 筆」或估計值。
- **冪等鍵只存在記憶體或單機快取**：重送打到另一台機器就失效；伺服器重啟也會遺失。要存在共享且持久的地方（資料庫或 Redis），並設好保存時間。
- **冪等鍵每次重試都重新產生**：等於沒有冪等鍵。產生的時機是「使用者發起動作」，不是「送出 HTTP 請求」。
- **長任務的狀態查詢在任務失敗時回 500**：客戶端會以為是查詢本身失敗而一直重試；任務失敗是查詢的正常結果。
- **批次 API 部分失敗卻回 201**：客戶端以為全部成功。
- **版本只改了文件沒改行為，或只改行為沒改文件**：兩者要在同一個 PR。

## 動手

1. 按 Python 那段的「在 Playground 開啟」，把新增的 2 筆改成刪除第 1 頁的某一筆（`DELETE FROM products WHERE id = 9`），觀察 offset 第 2 頁怎麼**漏掉**一筆，cursor 仍然正確。
2. 把 `ORDER BY` 和 cursor 條件裡的 `id` 拿掉，再讓多筆商品有相同的 `created_at`，看資料在頁邊界怎麼遺失。
3. 為「匯出報表」寫一份規格：建立請求、回應、狀態集合、輪詢方式、錯誤格式、保留期限，然後到 [要跑三分鐘的匯出](#/scenario/long-task) 比較背後的架構做法。
4. 列出你負責的一支 API 最近三次變更，用上面的「破壞性變更」表逐一判斷。

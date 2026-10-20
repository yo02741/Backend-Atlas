## 從一個具體問題開始：四個需求，REST 各卡在一個地方

同一個電商後端，這一季收到四個需求：

1. **App 首頁**：要顯示使用者資料、最近 3 張訂單（每張附第一件商品的名稱與縮圖）、推薦商品。用 REST 要打 `/me`、`/orders?limit=3`、每張訂單的 `/orders/{id}/items`、每件商品的 `/products/{id}`……行動網路上來回十幾次。改成一支專用的 `/home` endpoint，下個月網頁版又要不同的欄位組合。
2. **內部的庫存服務**：訂單服務每秒呼叫它上千次，JSON 序列化與解析佔了可觀的 CPU，而且雙方對欄位型別的理解常常不一致。
3. **客服聊天**：客服與使用者要即時互傳訊息，輪詢太慢也太浪費。
4. **通知合作的物流商**：訂單付款後要通知物流商的系統。物流商不想每分鐘來問一次「有沒有新訂單」。

REST 是很好的預設，但這四個需求各自碰到它的一個限制：**欄位與往返次數由伺服器決定**、**文字格式與鬆散的型別**、**只有客戶端能發起請求**、**對方要主動來問**。GraphQL、gRPC、WebSocket、Webhook 分別處理其中一個。每一種都有自己的成本，不是 REST 的升級版。

## GraphQL：客戶端決定要哪些欄位

### 運作方式

伺服器用 **schema** 宣告有哪些型別、欄位與它們的關聯；客戶端送一個查詢，**指定要哪些欄位**，回應的形狀和查詢一樣：

```graphql
# schema（伺服器端宣告）
type Query {
  me: User!
}
type User {
  id: ID!
  name: String!
  orders(last: Int = 10): [Order!]!
}
type Order {
  id: ID!
  status: OrderStatus!
  items: [OrderItem!]!
}
type OrderItem {
  qty: Int!
  product: Product!
}
type Product {
  id: ID!
  name: String!
  thumbnailUrl: String
}
enum OrderStatus { PENDING PAID SHIPPED CANCELLED }
```

```graphql
# 客戶端的查詢：App 首頁要的東西，一次拿到
query Home {
  me {
    name
    orders(last: 3) {
      id
      status
      items { qty product { name thumbnailUrl } }
    }
  }
}
```

伺服器上每個欄位對應一個 **resolver**（解析函式）：`me` 的 resolver 查使用者，`orders` 的 resolver 收到父物件（使用者）查訂單，`product` 的 resolver 收到父物件（訂單明細）查商品。執行引擎依查詢的形狀，逐層呼叫 resolver 並組出回應。

### N+1 與 DataLoader

這種「每個欄位各自解析」的設計，天生會產生 N+1 查詢：

```
me                          → 1 次查詢（使用者）
  orders(last: 3)           → 1 次查詢（3 張訂單）
    items（每張訂單各一次）   → 3 次查詢
      product（每件明細各一次）→ 假設共 8 件，8 次查詢
                              合計 13 次，訂單與明細越多越多
```

**DataLoader** 是標準解法：resolver 不直接查資料庫，而是呼叫 `loader.load(id)`。DataLoader 把同一輪事件迴圈裡收集到的所有 id 合併成一次批次查詢（`WHERE id IN (...)`），再把結果分配回去，同一個請求內重複的 id 也只查一次。上例會變成 4 次查詢（使用者、訂單、明細、商品各一次），和資料筆數無關。

DataLoader 的快取要**以請求為單位**建立：跨請求共用會讓 A 使用者看到快取裡 B 使用者有權限的資料，也不會隨資料更新失效。

### GraphQL 的成本

| 問題 | 說明 | 常見處理 |
|---|---|---|
| HTTP 快取難用 | 通常是單一 endpoint `POST /graphql`，CDN 與瀏覽器快取都以網址為 key，幫不上忙 | persisted queries（客戶端只送查詢的 hash，可以用 GET）；在應用層快取 |
| 查詢成本無上限 | 客戶端可以寫出很深、很寬的查詢（訂單 → 商品 → 評論 → 使用者 → 訂單…） | 限制深度與複雜度；正式環境只接受事先登記的查詢 |
| 錯誤處理 | 常見做法是部分成功也回 200，錯誤放在 body 的 `errors` 陣列；監控只看狀態碼會漏掉 | 監控要解析 `errors`；GraphQL over HTTP 的規範草案對狀態碼有更細的規定，依所用伺服器實作而定 |
| 授權 | 同一個物件可以從很多路徑到達（`me.orders`、`product.buyers`…），每條路徑都要檢查 | 授權寫在資料存取層或每個型別的 resolver，而不是只在入口 |
| 檔案上傳、限流 | 都不在核心規範裡 | 上傳走一般的 REST endpoint；限流依查詢成本而非請求數 |

適合：多種客戶端（網頁、iOS、Android、合作夥伴）需要不同的欄位組合，而且資料之間的關聯多。不適合：只有一個客戶端、資料關聯簡單、或高度依賴 CDN 快取的公開 API。

## gRPC：服務對服務的強型別 RPC

### 運作方式

先用 Protocol Buffers（protobuf）定義服務與訊息，再用工具產生各語言的 client 與 server 程式碼：

```protobuf
syntax = "proto3";

package inventory.v1;

service InventoryService {
  rpc GetStock(GetStockRequest) returns (Stock);                      // 一問一答（unary）
  rpc WatchStock(WatchStockRequest) returns (stream Stock);           // 伺服器串流
  rpc ReserveBatch(stream ReserveRequest) returns (ReserveSummary);   // 客戶端串流
  rpc Sync(stream SyncMessage) returns (stream SyncMessage);          // 雙向串流
}

message GetStockRequest {
  int64 product_id = 1;      // = 1 是欄位編號：線上傳的是編號，不是名稱
}

message Stock {
  int64 product_id = 1;
  int32 available = 2;
  reserved 3;                // 刪掉的欄位編號保留起來，永遠不重用
  string warehouse = 4;
}
```

- **二進位編碼**：線上傳的是「欄位編號 + 值」，比 JSON 小、解析快。代價是不能直接用肉眼或 curl 讀，要用 `grpcurl` 之類的工具。
- **跑在 HTTP/2 上**：一條連線多工、支援串流；結果狀態放在 HTTP/2 的 trailer（`grpc-status`）。
- **強型別與程式碼產生**：雙方從同一份 `.proto` 產生程式碼，型別不一致在編譯時就會發現。
- **deadline**：客戶端設定截止時間，會隨呼叫往下傳；超過時回 `DEADLINE_EXCEEDED`（逾時與重試的觀念見 [呼叫外部服務的韌性](#/skill/resilience)）。
- **自己的狀態碼**：`OK`、`INVALID_ARGUMENT`、`NOT_FOUND`、`ALREADY_EXISTS`、`PERMISSION_DENIED`、`UNAUTHENTICATED`、`RESOURCE_EXHAUSTED`、`UNAVAILABLE`、`DEADLINE_EXCEEDED` 等，HTTP 層的狀態碼通常都是 200。

相容性規則跟著欄位編號走：加新欄位（新編號）是相容的，舊程式會忽略它；**改欄位的型別或重用編號會讓雙方解讀出錯的值**，而且不一定會報錯。改欄位名稱在二進位編碼上不影響，但會影響 JSON 對應與產生的程式碼。

### 限制

- **瀏覽器不能直接呼叫**：瀏覽器的 `fetch` 不提供 gRPC 需要的 HTTP/2 底層控制（例如讀取 trailer）。要用 gRPC-Web 加上一個轉換的 proxy（例如 Envoy），而 gRPC-Web 只支援一問一答與伺服器串流。
- **負載平衡**：HTTP/2 長連線上跑所有請求，L4（TCP）負載平衡器只在建立連線時分配一次，流量會黏在少數後端上。要用 L7 負載平衡或客戶端負載平衡（見 [HTTP/2 與 HTTP/3](#/skill/http2-http3)）。
- **除錯與對外開放**：二進位格式、要先拿到 `.proto` 才能呼叫，不適合給第三方開發者的公開 API。

適合：內部服務之間的高頻呼叫、需要串流、多語言團隊要共用嚴格的介面定義。

## WebSocket：雙向的長連線

WebSocket 從一個 HTTP 請求升級而來（`101 Switching Protocols`），之後雙方都可以隨時送訊息。適合聊天、協作編輯、多人遊戲這類**雙方都頻繁送資料**的情境。

只需要伺服器推送時（通知、進度、即時報價），SSE 更簡單：純 HTTP、瀏覽器自動重連。兩者怎麼選、經過 proxy 與多台伺服器時要補什麼（逾時、心跳、pub/sub），在 [即時通訊怎麼選](#/skill/realtime-choice) 有完整說明，這裡不重複。

要記住的成本：每個使用者佔一條長連線、重連與訊息補送要自己做、WebSocket 不受 CORS 限制所以握手時要自己檢查 `Origin`。

## Webhook：事件發生時，你打別人

Webhook 把方向反過來：對方先在你的系統登記一個 URL，事件發生時**你送一個 HTTP POST 過去**。

```http
POST /hooks/shop HTTP/1.1
Host: logistics.partner.example
Content-Type: application/json
Webhook-Id: evt_01JABCD7
Webhook-Timestamp: 1792461309
Webhook-Signature: v1=5d2c0b3f9a...

{"id": "evt_01JABCD7", "type": "order.paid", "created_at": "2026-10-20T02:15:09Z",
 "data": {"order_id": 1043, "amount": 1980}}
```

上面的標頭名稱只是示意；各家服務各有自己的名稱與簽章格式，對方會在文件裡定義。設計一個可靠的 webhook，送出端與接收端各有責任：

| 送出端 | 接收端 |
|---|---|
| 用共享密鑰對「時間戳 + 原始 body」算 HMAC-SHA256，放在標頭 | 用**原始 body 位元組**重算簽章並比對；先 JSON 解析再序列化會改變位元組 |
| 每個事件有唯一 id | 用事件 id **去重**：同一個事件可能送來不只一次 |
| 收到非 2xx 或逾時就重試，指數退避，持續一段時間（例如數小時到數天） | **盡快回 2xx**，把實際處理丟進佇列；處理太久會被送出端當成逾時而重送 |
| 不保證順序；事件帶時間戳或版本 | 不要假設順序：`order.shipped` 可能比 `order.paid` 先到，用版本或時間戳判斷 |
| 簽章裡包含時間戳 | 時間戳超過容許範圍（例如 5 分鐘）就拒絕，防止攻擊者重送錄下來的請求 |
| 支援密鑰輪替（新舊兩把同時有效一段時間） | 比對時用常數時間比較，避免時序攻擊 |
| 使用者可以自訂 URL 時，擋掉內網 IP 與 metadata 位址 | |

最後一點常被忽略：讓使用者輸入任意 URL、由你的伺服器去 POST，就是一個 SSRF（伺服器端請求偽造）的入口，對方可以填 `http://169.254.169.254/` 或內網服務的位址。

另外，Webhook 送的是「通知」，不一定是完整的資料。接收端可以只拿事件 id，再回頭呼叫 API 取最新狀態，這樣就不必擔心順序與舊資料的問題。

## 怎麼選

| 情境 | 選擇 | 理由 |
|---|---|---|
| 一般的 CRUD、公開 API | REST | 工具、快取、除錯、文件全都成熟 |
| 多種客戶端、各要不同欄位組合 | GraphQL | 客戶端自己決定欄位，一次往返 |
| 內部服務之間、高頻、要串流 | gRPC | 二進位、強型別、HTTP/2 多工 |
| 雙向即時互動 | WebSocket | 雙方都能隨時送 |
| 伺服器單向推送給瀏覽器 | SSE | 純 HTTP、自動重連 |
| 通知外部系統「發生了某事」 | Webhook | 對方不用輪詢 |

很多系統是混用的：對外 REST、內部 gRPC、App 用 GraphQL 聚合、合作夥伴收 webhook。

## 實際程式：DataLoader 怎麼把 N+1 變成 1

下面用 asyncio 模擬 GraphQL 執行時，8 件訂單明細各自要求載入商品：沒有 DataLoader 時每件一次查詢，有 DataLoader 時同一輪的請求被合併成一次：

```python run
import asyncio

PRODUCTS = {i: {"id": i, "name": f"商品{i}"} for i in range(1, 20)}
query_log = []

async def db_fetch_products(ids):
    query_log.append(sorted(ids))           # 記錄每次「打資料庫」
    await asyncio.sleep(0.01)
    return {i: PRODUCTS[i] for i in ids}

class DataLoader:
    """同一輪事件迴圈裡的 load() 合併成一次批次查詢；同一個請求內相同 id 只查一次。"""
    def __init__(self, batch_fn):
        self.batch_fn, self.cache, self.queue = batch_fn, {}, {}

    def load(self, key):
        if key in self.cache:
            return self.cache[key]
        fut = asyncio.get_running_loop().create_future()
        self.cache[key] = fut
        if not self.queue:
            asyncio.get_running_loop().call_soon(lambda: asyncio.ensure_future(self._dispatch()))
        self.queue[key] = fut
        return fut

    async def _dispatch(self):
        batch, self.queue = self.queue, {}
        results = await self.batch_fn(list(batch))
        for key, fut in batch.items():
            fut.set_result(results.get(key))

# 3 張訂單、8 件明細，其中商品 2 出現兩次
order_items = [[1, 2, 3], [2, 4], [5, 6, 7]]

async def resolve_naive():
    async def product(pid):
        return (await db_fetch_products([pid]))[pid]
    return await asyncio.gather(*[product(p) for items in order_items for p in items])

async def resolve_with_loader():
    loader = DataLoader(db_fetch_products)      # 每個請求建一個新的 loader
    return await asyncio.gather(*[loader.load(p) for items in order_items for p in items])

await resolve_naive()
print(f"沒有 DataLoader：{len(query_log)} 次查詢", query_log)
query_log.clear()
rows = await resolve_with_loader()
print(f"有 DataLoader：{len(query_log)} 次查詢", query_log)
print("結果仍然對應到每一件明細：", [r["name"] for r in rows])
```

## 實際程式：簽署與驗證 webhook

```python run
import hmac, hashlib, json, time

SECRET = b"whsec_demo_only_not_a_real_secret"
SEEN = set()                  # 已處理過的事件 id；實務上存在資料庫，用唯一鍵去重

def sign(body: bytes, ts: int) -> str:
    # 簽「時間戳 + . + 原始 body」，時間戳被竄改簽章就對不上
    mac = hmac.new(SECRET, f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return f"v1={mac}"

def verify(body: bytes, ts: int, signature: str, now: int, tolerance=300):
    if abs(now - ts) > tolerance:
        return "拒絕：時間戳超出容許範圍（可能是重送攻擊）"
    expected = sign(body, ts)
    if not hmac.compare_digest(expected, signature):      # 常數時間比較
        return "拒絕：簽章不符"
    event_id = json.loads(body)["id"]
    if event_id in SEEN:
        return f"已處理過 {event_id}，直接回 200，不重做"
    SEEN.add(event_id)
    return f"接受 {event_id}：放進佇列，立刻回 200"

now = int(time.time())
body = json.dumps({"id": "evt_01", "type": "order.paid", "data": {"order_id": 1043}}, separators=(",", ":")).encode()
sig = sign(body, now)

print(verify(body, now, sig, now))                                 # 正常
print(verify(body, now, sig, now + 5))                             # 送出端重試：同一個事件
reformatted = json.dumps(json.loads(body), indent=2).encode()      # 接收端先解析再序列化
print(verify(reformatted, now, sig, now))                          # 位元組變了，簽章不符
tampered = body.replace(b"1043", b"9999")
print(verify(tampered, now, sig, now))                             # body 被竄改
print(verify(body, now - 3600, sign(body, now - 3600), now))       # 一小時前錄下的請求
```

## 常見錯誤

- **GraphQL 沒有 DataLoader**：開發時資料少不明顯，上線後一個查詢觸發上百次資料庫查詢。
- **GraphQL 只在入口做授權**：`me` 檢查了，但 `product.reviews.author.email` 這條路徑沒檢查。
- **GraphQL 監控只看狀態碼**：錯誤都在 200 的 body 裡，告警永遠不會響。
- **gRPC 重用欄位編號**：刪掉欄位 3 後新增一個型別不同的欄位也用 3，舊版程式解讀出錯誤的值，可能沒有任何錯誤訊息。
- **gRPC 走 L4 負載平衡**：新加的後端沒有流量，舊的後端過載。
- **Webhook 接收端同步處理**：收到後先呼叫三個內部服務才回 200，處理超過送出端的逾時，被當成失敗而重送，於是同一個事件處理了好幾次。
- **Webhook 驗證簽章前就解析 JSON**：框架的 JSON body parser 已經把原始位元組丟掉，重算的簽章永遠對不上。要在框架裡設定保留原始 body。
- **Webhook 用 `==` 比對簽章**：一般字串比較在第一個不同的字元就返回，理論上可以從回應時間猜出簽章；用 `hmac.compare_digest`。

## 動手

1. 按 DataLoader 那段的「在 Playground 開啟」，把 `order_items` 改成 30 張訂單、每張 5 件，比較兩種寫法的查詢次數；再把 `loader` 改成在兩次請求之間共用，想想快取什麼時候會給出舊資料。
2. 在 webhook 那段加上密鑰輪替：`verify` 同時接受新舊兩把密鑰算出的簽章。
3. 為開頭的四個需求各自寫一段選擇理由，並寫下「如果用 REST 硬做」會怎麼做、代價是什麼。
4. 需要伺服器推送時，到 [即時通訊怎麼選](#/skill/realtime-choice) 比較 SSE、WebSocket 與輪詢；webhook 送出端的重試策略，參考 [呼叫外部服務的韌性](#/skill/resilience)。

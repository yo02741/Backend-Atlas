## 從一個具體問題開始：一萬個人每兩秒問一次「好了沒」

報表匯出要跑 1–3 分鐘。前端的做法是每 2 秒打一次 `GET /exports/{id}`，直到狀態變成 `done`。上線後：

- 同時有 10,000 個使用者開著這個頁面，就是每秒 5,000 個請求，其中 99% 的回答是「還沒」。
- 每個請求都要驗 session、查一次資料庫，資料庫 CPU 被這些「還沒」吃掉一大塊。
- 報表其實在第 61 秒就好了，使用者最多要多等 2 秒才看到。

想改成「好了伺服器再通知」，有幾種做法：長輪詢、Server-Sent Events（SSE）、WebSocket。它們在瀏覽器裡都是幾行程式，但放到真實部署裡——中間有 nginx、負載平衡器、多台伺服器——要補的東西差很多。

[GraphQL、gRPC、WebSocket 與 Webhook](#/skill/beyond-rest) 那一課比較的是 REST 之外的幾種通訊形式；這一課只看「伺服器要把更新推給瀏覽器」這件事，把四種做法的線路格式、成本與部署細節攤開。

## 四種做法

### 短輪詢（short polling）

客戶端固定間隔發請求，伺服器立刻回答目前狀態。

```http
GET /exports/88 HTTP/1.1

HTTP/1.1 200 OK
Content-Type: application/json

{"status": "running", "progress": 40}
```

- 優點：最簡單、純 HTTP、無狀態，任何基礎設施都支援，也最好快取與除錯。
- 缺點：延遲最多一個間隔；請求數 = 使用者數 ÷ 間隔，大部分是浪費。
- 適合：更新不頻繁、可以接受幾秒到幾分鐘延遲、使用者不多的情況。很多時候這就夠了。

### 長輪詢（long polling）

客戶端發請求，伺服器**有新資料才回**，沒有就把請求掛著，直到逾時（例如 30 秒）回一個「沒變」。客戶端收到回應後馬上再發下一個。

```http
GET /exports/88/wait?since_version=3 HTTP/1.1

（伺服器掛著，直到版本 > 3 或 30 秒到了）

HTTP/1.1 200 OK
Content-Type: application/json

{"version": 4, "status": "done", "url": "/files/88.csv"}
```

- 優點：純 HTTP，延遲接近即時，請求數大幅減少。
- 缺點：伺服器同時握著很多等待中的請求（每個是一條連線）；要處理「回應與下一個請求之間」發生的事件，所以客戶端要帶 `since_version` 之類的游標，伺服器據此補送。
- 適合：需要接近即時、但環境不允許長連線協定的時候；也是很多即時函式庫在 WebSocket 不通時的退路。

### Server-Sent Events（SSE）

客戶端發一個普通的 GET，伺服器回 `Content-Type: text/event-stream`，然後**不結束回應**，有事件就往裡面寫一段。瀏覽器用內建的 `EventSource` 接收。

```http
GET /exports/88/events HTTP/1.1
Accept: text/event-stream

HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache

: 這一行是註解，常用來當心跳

id: 4
event: progress
data: {"progress": 40}

id: 5
event: done
data: {"url": "/files/88.csv"}

```

格式規則（定義在 HTML 規格的 Server-Sent Events 一節）：

| 規則 | 說明 |
|---|---|
| 一行一個欄位 | `欄位名: 值`，冒號後的**一個**空白會被去掉 |
| 空行結束一個事件 | 收到空行才把累積的欄位當成一個事件送出 |
| `data` | 可以多行，多行之間用 `\n` 接起來 |
| `event` | 事件類型；沒給就是 `message` |
| `id` | 事件編號；瀏覽器記住最後一個，重連時放在 `Last-Event-ID` 請求標頭 |
| `retry` | 斷線後幾毫秒重連 |
| 冒號開頭的行 | 註解，瀏覽器忽略 |

瀏覽器端：

```js
const es = new EventSource('/exports/88/events', { withCredentials: true })
es.addEventListener('progress', (e) => render(JSON.parse(e.data)))
es.addEventListener('done', (e) => { download(JSON.parse(e.data).url); es.close() })
es.onerror = () => { /* EventSource 會自己重連；這裡只更新 UI 狀態 */ }
```

- 優點：純 HTTP（經過 proxy、CDN、HTTP/2 都是一般請求）；**自動重連**，還會帶 `Last-Event-ID`，伺服器可以從那之後補送；文字格式好除錯。
- 限制：**單向**，只有伺服器 → 客戶端（客戶端要送東西就另外發一般請求）；只能傳文字（二進位要自己編碼）；`EventSource` 不能自訂請求標頭，驗證要靠 cookie（同網域或 `withCredentials`），把 token 放在網址的 query string 會留在存取日誌裡，要小心。
- 連線數：在 HTTP/1.1 下，每個 SSE 佔掉瀏覽器對該網域約 6 條連線額度中的一條，開很多分頁會把額度用完；HTTP/2 下所有 SSE 是同一條連線上的 stream，限制寬鬆很多（上限由伺服器的 `SETTINGS_MAX_CONCURRENT_STREAMS` 決定）。

下面這段在伺服器端把事件序列化成 SSE 格式，並模擬斷線重連時依 `Last-Event-ID` 補送，可以直接執行：

```js run
// 伺服器端：把事件寫成 text/event-stream 格式
function toSSE({ id, event, data }) {
  let out = ''
  if (id !== undefined) out += `id: ${id}\n`
  if (event) out += `event: ${event}\n`
  // data 裡有換行時要拆成多行 data:，否則空行會被當成事件結束
  for (const line of String(data).split('\n')) out += `data: ${line}\n`
  return out + '\n'
}

// 伺服器保留最近的事件，重連時從 Last-Event-ID 之後補送
const history = [
  { id: 1, event: 'progress', data: JSON.stringify({ progress: 20 }) },
  { id: 2, event: 'progress', data: JSON.stringify({ progress: 60 }) },
  { id: 3, event: 'log', data: '第一行\n第二行' },
  { id: 4, event: 'done', data: JSON.stringify({ url: '/files/88.csv' }) },
]

function replayAfter(lastEventId) {
  const from = lastEventId === null ? 0 : Number(lastEventId)
  return history.filter((e) => e.id > from).map(toSSE).join('')
}

console.log('--- 第一次連線收到前兩個事件後斷線 ---')
console.log(history.slice(0, 2).map(toSSE).join(''))
console.log('--- 瀏覽器重連，帶 Last-Event-ID: 2 ---')
console.log(replayAfter('2'))
```

### WebSocket

WebSocket（RFC 6455）從一個 HTTP/1.1 請求開始，透過 **Upgrade** 把這條 TCP 連線換成另一個協定，之後雙方可以隨時互送訊息（文字或二進位幀）：

```http
GET /chat HTTP/1.1
Host: app.example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13
Origin: https://app.example.com

HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

`Sec-WebSocket-Accept` 是伺服器把客戶端送來的 key 接上一個規格固定的 GUID，取 SHA-1 再 base64。它只用來確認「對方真的懂 WebSocket」，不是安全機制。上面這組是 RFC 6455 裡的範例值，可以自己算一次：

```python run
import base64, hashlib

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"   # RFC 6455 規定的固定字串

def accept_for(key: str) -> str:
    return base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()

print(accept_for("dGhlIHNhbXBsZSBub25jZQ=="))   # s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

- 優點：雙向、低延遲、每則訊息的額外負擔很小、支援二進位。聊天、多人協作編輯、遊戲這類「客戶端也頻繁送資料」的情境適合。
- 代價：
  - **不會自動重連**，要自己寫重連（加退避與抖動，否則伺服器重啟時所有客戶端同時湧回）、自己設計「斷線期間漏掉的訊息」怎麼補。
  - **不受 CORS 限制**：瀏覽器允許任何網站對你的伺服器開 WebSocket，而且會帶上你網域的 cookie。伺服器必須在握手時檢查 `Origin` 是否在允許清單，否則會遭到跨站 WebSocket 劫持（cross-site WebSocket hijacking）。
  - 升級之後就不是 HTTP 了：快取、HTTP 層的日誌、依路徑的監控都看不到裡面的訊息，要自己補訊息層的日誌與指標。
  - 長時間沒有資料時，中間設備可能把連線切掉，要定期 ping / pong。

## 經過 proxy 與負載平衡器時要注意的事

這三種長連線做法（長輪詢、SSE、WebSocket）在本機開發時都正常，一放到 nginx 或雲端負載平衡器後面就常出事，原因大多是下面幾個。

### 逾時

nginx 的 `proxy_read_timeout` 預設 60 秒：後端 60 秒沒有送任何東西，nginx 就關掉連線。雲端負載平衡器也有自己的閒置逾時。對策：

- 伺服器定期送心跳：SSE 送一行註解（`: ping`），WebSocket 送 ping 幀，間隔要比路徑上最短的閒置逾時短（例如每 15–30 秒）。
- 或在 proxy 上把這些路徑的逾時調長，但心跳仍然需要，因為路徑上可能還有你管不到的設備。

### 緩衝

nginx 預設會**緩衝**後端回應，攢到一定量才送給客戶端。對 SSE 來說，事件會延遲甚至卡住。要對 SSE 路徑關掉緩衝（`proxy_buffering off;`，或後端回應帶 `X-Accel-Buffering: no`）。同樣地，壓縮（gzip）中介層也可能緩衝串流回應，SSE 路徑要確認它不會被攢住。

### WebSocket 的升級標頭

`Upgrade` 和 `Connection` 是逐跳（hop-by-hop）標頭，nginx 預設不轉送，要明確設定：

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    location /ws/ {
        proxy_pass http://app;
        proxy_http_version 1.1;                       # Upgrade 需要 HTTP/1.1
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 300s;                      # 搭配應用層心跳
    }

    location /events/ {
        proxy_pass http://app;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;                          # SSE 不能被緩衝
        proxy_read_timeout 300s;
    }
}
```

### sticky session

WebSocket 與 SSE 一旦連上，整段期間都在同一台後端，本身不需要 sticky session。需要 sticky 的情況是：同一個邏輯連線由**多個請求**組成，而伺服器把狀態放在記憶體裡——例如即時函式庫在 WebSocket 不通時退回長輪詢，每次輪詢都必須回到同一台。能把連線狀態放在共用的地方（Redis 等），就不需要 sticky。

### 連線數與部署

- 每條長連線都佔一個檔案描述子與一些記憶體（見 [TCP/IP 與連線](#/skill/tcp-connections)）。10,000 個在線使用者就是 10,000 條連線同時存在，要檢查 `ulimit -n`、proxy 與負載平衡器的連線上限。
- 同步的 worker 模型（一個請求佔一個執行緒或行程）撐不住大量長連線；要用 async 伺服器（例如 Uvicorn 搭配 async 框架）。
- 部署或重啟會一次斷掉這台機器上的所有連線，客戶端會同時重連。重連要加隨機延遲；伺服器關機前先停止接受新連線、送出關閉訊息，讓客戶端分批轉到其他機器。

## 多台伺服器：用 pub/sub 廣播

只有一台伺服器時，「報表做好了」可以直接在記憶體裡找到那個使用者的連線推過去。擴到三台後，背景工作在 worker 上完成，使用者的 SSE 連線卻可能在 web-2 上：

```text
             ┌─────────┐   publish "export:88 done"
  worker ───▶│  Redis  │──────────────┬──────────────┬──────────────┐
             │ pub/sub │              ▼              ▼              ▼
             └─────────┘           web-1          web-2          web-3
                                (沒有訂閱者)   (使用者 A 的 SSE)  (沒有訂閱者)
                                                    │
                                                    ▼
                                               推給使用者 A
```

每台 web 伺服器訂閱共用的頻道，收到訊息後檢查自己手上有沒有對應的連線，有就推送。常見的選擇：

- **Redis Pub/Sub**：簡單、延遲低，但訊息**不保存**——發布當下沒有訂閱者就丟了。適合「錯過了也能靠重新查詢補回來」的通知。
- **Redis Streams、Kafka、NATS JetStream 這類有保存的日誌**：可以依序號重播，搭配 SSE 的 `Last-Event-ID`，重連後能補送漏掉的事件。
- **PostgreSQL 的 `LISTEN` / `NOTIFY`**：已經有 PostgreSQL、量不大時可用，同樣不保存。

無論用哪一種，客戶端重連後都應該能重新取得目前的完整狀態（例如先打一次 `GET /exports/88`），推送只負責「有變化了」。

## 怎麼選

| 需求 | 短輪詢 | 長輪詢 | SSE | WebSocket |
|---|---|---|---|---|
| 方向 | 客戶端拉 | 客戶端拉（伺服器延後回答） | 伺服器 → 客戶端 | 雙向 |
| 延遲 | 最多一個間隔 | 接近即時 | 即時 | 即時 |
| 協定 | 一般 HTTP | 一般 HTTP | 一般 HTTP（長回應） | HTTP 升級後換協定 |
| 自動重連與補送 | 不需要 | 自己做 | 內建（`Last-Event-ID`） | 自己做 |
| 經過 proxy | 不用特別設定 | 調逾時 | 關緩衝、調逾時、心跳 | 轉送升級標頭、調逾時、心跳 |
| 伺服器負擔 | 請求數多 | 掛著的請求多 | 長連線多 | 長連線多，還要處理收訊 |
| 典型用途 | 低頻狀態、後台 | 退路、受限環境 | 通知、進度、動態牆、LLM 串流輸出 | 聊天、協作、遊戲 |

實務上的順序是：先問「多久的延遲可以接受」。幾十秒可以接受就短輪詢；要即時、只有伺服器推，就 SSE；客戶端也要頻繁送資料，才用 WebSocket。

## 常見錯誤與錯誤訊息

| 現象 | 原因 | 怎麼處理 |
|---|---|---|
| `EventSource` 一連上就觸發 `error`、`readyState` 變成 `CLOSED` 不再重連，console 提到 MIME type 不是 `text/event-stream` | 伺服器回應的 `Content-Type` 不對（例如框架預設的 `application/json`），或回了非 200 的錯誤頁。依規格，這兩種情況瀏覽器會放棄連線；只有網路中斷才會自動重連 | 串流回應必須是 `200` 加 `Content-Type: text/event-stream`；要讓客戶端停止重連時，伺服器可以刻意回非 200（例如 `204`） |
| 本機 SSE 正常，上線後事件延遲很久才一次湧出 | nginx 或壓縮中介層在緩衝回應 | `proxy_buffering off` 或 `X-Accel-Buffering: no`；SSE 路徑排除壓縮 |
| SSE / WebSocket 剛好每 60 秒斷一次 | proxy 或負載平衡器的閒置逾時（nginx `proxy_read_timeout` 預設 60 秒） | 加心跳；調長逾時 |
| WebSocket 握手失敗，瀏覽器顯示收到 400 或 200 而不是 101 | proxy 沒有轉送 `Upgrade` / `Connection` 標頭，後端把它當普通請求 | 照上面的 nginx 設定加上兩個標頭與 `proxy_http_version 1.1` |
| WebSocket 關閉碼 `1006` | 異常關閉：沒有收到關閉幀就斷了，常見於 proxy 逾時、網路中斷、伺服器崩潰 | 從 proxy 日誌與心跳間隔查起；客戶端用退避重連 |
| 擴到多台後，部分使用者收不到通知 | 事件只在產生它的那台伺服器內部發送 | 加 pub/sub 廣播 |
| 部署後所有客戶端同一秒重連，伺服器被打爆 | 重連沒有隨機延遲 | 重連用指數退避加抖動；SSE 可以用 `retry:` 欄位拉長重連間隔 |

## 動手

1. 跑 SSE 序列化那段，把 `replayAfter('2')` 改成 `replayAfter(null)` 與 `replayAfter('4')`，看補送的內容怎麼變。
2. 跑 `Sec-WebSocket-Accept` 那段，換一個 key 算算看；這就是瀏覽器檢查握手回應時做的事。
3. 做這一課的程式題：照規格寫一個 SSE 解析器，處理多行 `data`、註解、`id` 與預設事件類型。
4. 回到 [GraphQL、gRPC、WebSocket 與 Webhook](#/skill/beyond-rest)，對照「伺服器推給瀏覽器」與「伺服器推給另一個伺服器（Webhook）」的差別。

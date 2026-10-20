## 從一個具體問題開始：同一支 API，第一次 800 ms、之後 60 ms

前端呼叫 `https://api.shop.example/orders/42`。打開瀏覽器開發者工具的 Network 分頁，第一個請求花了 800 ms，接下來幾個同樣的請求都只要 60 ms 左右。伺服器的 log 顯示每次處理都是 40 ms。

多出來的 740 ms 不在伺服器程式裡，而在「請求送到伺服器之前」：查 DNS、建 TCP 連線、TLS 握手。後面的請求快，是因為 DNS 結果被快取、連線被重用，這幾步直接跳過。把 Network 分頁的 Timing 打開，可以看到第一個請求的時間被拆成 `DNS Lookup`、`Initial connection`、`SSL`、`Waiting for server response`（TTFB）、`Content Download` 幾段（以 Chrome 為例，其他瀏覽器名稱略有不同）。

要判斷慢在哪、錯在哪，得知道一個請求從 URL 到拿到回應經過了哪些階段，每個階段各自可能出什麼事。

## 運作原理：一個請求的七個階段

以 `GET https://api.shop.example/orders/42` 為例，假設客戶端到伺服器的往返時間（RTT）是 50 ms：

| 階段 | 做什麼 | 大約花多少 | 常見問題 |
|---|---|---|---|
| 1. 解析 URL | 拆出 scheme（`https`）、主機（`api.shop.example`）、port（https 預設 443）、路徑（`/orders/42`）、查詢字串 | 可忽略 | 路徑沒有 URL 編碼、中文或空白沒轉成 `%XX` |
| 2. DNS | 把主機名換成 IP | 有快取時接近 0；沒快取時數十到數百 ms | 解析不到、解析到舊 IP（見 [DNS、TLS 與憑證](#/skill/tls-dns)） |
| 3. TCP | 三次握手建立連線 | 1 RTT（50 ms） | 連線逾時、被拒絕（`ECONNREFUSED`） |
| 4. TLS | 驗證憑證、協商金鑰 | TLS 1.3 為 1 RTT，TLS 1.2 為 2 RTT | 憑證過期、主機名不符 |
| 5. 送出請求 | 請求行、標頭、body | 小請求接近 0 | 標頭太大被拒（431）、body 格式不對 |
| 6. 伺服器處理 | 路由、驗證、查資料庫、組回應 | 看程式 | 慢查詢、例外變成 500 |
| 7. 收到回應 | 狀態行、標頭、body | body 越大越久 | 回應被截斷、編碼不對 |

新的 HTTPS 連線光是 3、4 兩步就要 2 RTT（TLS 1.3），加上請求本身 1 RTT，至少 3 RTT 才拿到第一個位元組；重用連線則只要 1 RTT。TCP 握手、keep-alive 與連線池的細節在 [TCP/IP 與連線](#/skill/tcp-connections)。

### 時間線

```
客戶端                                         伺服器
  |--- DNS 查詢（到 resolver）-------->            |
  |<-- 203.0.113.10 -------------------            |
  |--- SYN ------------------------------------->  |  ┐
  |<-- SYN-ACK ---------------------------------   |  │ TCP：1 RTT
  |--- ACK + TLS ClientHello ------------------->  |  ┘
  |<-- ServerHello、憑證、Finished --------------   |  TLS 1.3：1 RTT
  |--- Finished + GET /orders/42 --------------->  |
  |                                                |  伺服器處理 40 ms
  |<-- HTTP/1.1 200 OK + body -------------------  |  請求：1 RTT
  |                                                |
  |--- GET /orders/43（同一條連線）-------------->  |  第二個請求：1 RTT + 處理時間
  |<-- HTTP/1.1 200 OK --------------------------  |
```

### 請求長什麼樣

HTTP/1.1 是純文字協定，請求由「請求行、標頭、空行、body」組成：

```http
POST /orders HTTP/1.1
Host: api.shop.example
User-Agent: shop-web/3.2
Accept: application/json
Content-Type: application/json
Content-Length: 39
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...

{"product_id": 1, "qty": 2, "note": ""}
```

- **請求行**：方法、路徑（含查詢字串）、協定版本。
- **`Host` 是 HTTP/1.1 的必要標頭**。同一個 IP 上可以掛很多網站，伺服器靠 `Host` 決定這個請求給誰。
- **標頭名稱不分大小寫**。HTTP/2 和 HTTP/3 規定標頭名稱一律小寫傳送，所以程式裡比對標頭要用不分大小寫的方式，多數框架已經處理好。
- **空行**分隔標頭與 body。`Content-Length` 告訴對方 body 有幾個位元組；長度不確定時改用 `Transfer-Encoding: chunked` 分塊送。

回應的結構對稱，第一行換成**狀態行**：

```http
HTTP/1.1 201 Created
Date: Tue, 20 Oct 2026 02:15:09 GMT
Content-Type: application/json
Content-Length: 58
Location: /orders/1043
Cache-Control: no-store

{"id": 1043, "status": "pending", "amount": 1980, "qty": 2}
```

HTTP/2 和 HTTP/3 改成二進位分幀，但方法、路徑、狀態碼、標頭的**語意完全一樣**，所以下面講的東西三個版本都適用（版本差異見 [HTTP/2 與 HTTP/3](#/skill/http2-http3)）。

### HTTP 是無狀態的

伺服器不會記得「上一個請求是誰」。每個請求都要自己帶齊身分（cookie 或 `Authorization` 標頭）、語言（`Accept-Language`）、想要的格式（`Accept`）。「登入狀態」是伺服器每次從 cookie 或 token 重建出來的。同一條 TCP 連線上的兩個請求也不能假設是同一個使用者：反向代理會把不同使用者的請求放在同一條往後端的連線上。

## 方法的語意：安全與冪等

方法不只是「動詞的名字」，它承諾了兩個性質，重試、快取、預先抓取都依賴這兩個性質（定義見 RFC 9110）：

- **安全（safe）**：客戶端不期待它改變伺服器狀態。爬蟲、瀏覽器預先載入可以放心送。
- **冪等（idempotent）**：送一次和送 N 次，伺服器的**最終狀態**相同。網路斷掉不知道成功沒，可以直接重送。

| 方法 | 用途 | 安全 | 冪等 | 有 body |
|---|---|---|---|---|
| `GET` | 讀取 | 是 | 是 | 不應該有 |
| `HEAD` | 同 GET 但只要標頭 | 是 | 是 | 無 |
| `OPTIONS` | 問伺服器支援什麼（CORS 預檢用它） | 是 | 是 | 通常無 |
| `POST` | 建立、或任何不屬於其他方法的處理 | 否 | 否 | 有 |
| `PUT` | 用整份內容取代目標資源 | 否 | 是 | 有 |
| `PATCH` | 部分修改 | 否 | 不保證 | 有 |
| `DELETE` | 刪除 | 否 | 是 | 通常無 |

冪等講的是**伺服器狀態**，不是回應內容。`DELETE /orders/42` 第一次回 204、第二次回 404，回應不同，但「42 號訂單不存在」這個狀態一樣，所以仍是冪等。`PUT /orders/42` 帶完整內容，送幾次結果都是那份內容；`POST /orders` 送兩次會建出兩張訂單。

「安全」是語意上的承諾，伺服器實際上有沒有遵守是另一回事。用 `GET /orders/42/cancel` 實作取消訂單，連結被瀏覽器預先載入或被爬蟲點到，訂單就被取消了。

## 狀態碼：五個類別

| 類別 | 意思 | 客戶端該怎麼反應 | 常見的 |
|---|---|---|---|
| 1xx | 資訊性，請求還在進行 | 通常由函式庫處理 | `101 Switching Protocols`（WebSocket 升級） |
| 2xx | 成功 | 使用回應 | `200`、`201 Created`、`202 Accepted`、`204 No Content` |
| 3xx | 要去別處拿 | 依 `Location` 跟過去，或用快取 | `301`、`302`、`304 Not Modified`、`307`、`308` |
| 4xx | 請求有問題 | **不改請求就不要重送** | `400`、`401`、`403`、`404`、`409`、`422`、`429` |
| 5xx | 伺服器有問題 | 視情況重試 | `500`、`502 Bad Gateway`、`503`、`504 Gateway Timeout` |

類別是給所有中間層看的：監控用 5xx 比例算錯誤率、重試邏輯看到 5xx 才重送、CDN 依狀態碼決定能不能快取。把「找不到訂單」回成 500，錯誤率告警就會被使用者打錯網址觸發；把資料庫掛掉回成 200 加 `{"error": ...}`，監控就看不到故障。

轉址有個容易忽略的差別：

| 狀態碼 | 永久／暫時 | 方法會不會被改 |
|---|---|---|
| `301 Moved Permanently` | 永久 | 歷史上瀏覽器會把 POST 改成 GET |
| `302 Found` | 暫時 | 同上 |
| `303 See Other` | 暫時 | 明確要求改用 GET 去拿 |
| `307 Temporary Redirect` | 暫時 | 保留原方法與 body |
| `308 Permanent Redirect` | 永久 | 保留原方法與 body |

API 要把 `POST` 轉到新位置時用 307 或 308，用 301、302 時客戶端可能改用 GET 去打新位置，body 就不見了。

5xx 也有分工：`502` 是 proxy 從後端拿到無效回應（例如後端連線被重設），`503` 是暫時無法服務（維護、過載，可以帶 `Retry-After`），`504` 是 proxy 等後端逾時。從 nginx 回來的 502／504 通常代表問題在後端或 proxy 與後端之間，而不是 nginx 本身。

## 重要標頭

| 標頭 | 方向 | 作用 |
|---|---|---|
| `Host` | 請求 | 要找哪個網站 |
| `Content-Type` | 雙向 | body 的格式，例如 `application/json`、`multipart/form-data` |
| `Accept` | 請求 | 客戶端想要的格式；伺服器給不出來可以回 `406` |
| `Authorization` | 請求 | 憑證，例如 `Bearer <token>` |
| `Cookie`／`Set-Cookie` | 請求／回應 | 瀏覽器自動帶的狀態（見 [CORS、Cookie 與同源](#/skill/cors-cookies)） |
| `Cache-Control`、`ETag` | 回應 | 誰能快取、能存多久、怎麼驗證（見 [HTTP 快取](#/skill/http-caching)） |
| `Location` | 回應 | 新資源的位置（201）或轉址目標（3xx） |
| `Retry-After` | 回應 | `429`／`503` 時告訴客戶端多久後再試 |
| `Content-Encoding` | 回應 | body 有沒有壓縮，例如 `gzip`、`br` |
| `X-Forwarded-For`、`X-Forwarded-Proto` | 請求 | 經過反向代理後，原始客戶端 IP 與協定（只能信任自己的 proxy 設的值） |

## 實際程式：拆解一個請求

下面這段 JavaScript 自己解析 HTTP/1.1 的原始文字，可以看出「請求行、標頭、空行、body」的結構，以及標頭不分大小寫的處理：

```js run
// 把 HTTP/1.1 原始請求拆成 方法、路徑、版本、標頭、body
function parseRequest(raw) {
  const sep = raw.indexOf('\r\n\r\n')             // 空行：標頭與 body 的分界
  const head = raw.slice(0, sep).split('\r\n')
  const body = raw.slice(sep + 4)
  const [method, target, version] = head[0].split(' ')
  const headers = {}
  for (const line of head.slice(1)) {
    const i = line.indexOf(':')
    // 標頭名稱不分大小寫：統一轉小寫存
    headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
  }
  const url = new URL(target, 'http://' + headers['host'])
  return { method, path: url.pathname, query: Object.fromEntries(url.searchParams), version, headers, body }
}

const raw = [
  'POST /orders?dry_run=1 HTTP/1.1',
  'Host: api.shop.example',
  'content-type: application/json',
  'Content-Length: 27',
  '',
  '{"product_id": 1, "qty": 2}',
].join('\r\n')

const req = parseRequest(raw)
console.log(req.method, req.path, req.query, req.version)
console.log('Content-Type =', req.headers['content-type'])
// Content-Length 算的是位元組數，不是字元數
console.log('body 位元組數 =', new TextEncoder().encode(req.body).length, '宣告 =', req.headers['content-length'])
console.log('JSON body =', JSON.parse(req.body))
```

連線重用省下多少，可以直接算出來。下面用 50 ms RTT、伺服器處理 40 ms 估算連續 10 個請求的總時間：

```python run
RTT = 50       # 客戶端到伺服器來回一趟（ms）
SERVER = 40    # 伺服器處理一個請求（ms）
N = 10

def new_connection(tls_rtts):
    # TCP 三次握手 1 RTT + TLS 握手 + 請求本身 1 RTT
    return RTT * (1 + tls_rtts) + RTT + SERVER

def reused():
    return RTT + SERVER

for name, tls in [("TLS 1.2", 2), ("TLS 1.3", 1)]:
    every_time = N * new_connection(tls)
    keep_alive = new_connection(tls) + (N - 1) * reused()
    print(f"{name}：每次新連線 {every_time} ms，重用連線 {keep_alive} ms")
# DNS 查詢沒算進去；沒有快取時第一個請求還要再加上它
```

這是理想化的估算：沒算 DNS、TCP 慢啟動、封包遺失，但數量級是對的。後端呼叫外部服務時，每次都 `requests.get(...)`（沒有共用 Session）就是在走「每次新連線」那條路。

用 curl 可以看到真實請求的每個階段（不能在瀏覽器裡跑）：

```bash
# -v 印出請求與回應的標頭；> 開頭是送出的，< 開頭是收到的
curl -v https://api.shop.example/orders/42

# 各階段花的時間（秒，從請求開始累計）
curl -o /dev/null -s -w 'dns=%{time_namelookup} tcp=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total}\n' \
  https://api.shop.example/orders/42
```

`-w` 的數字是**累計值**：`tls` 減 `tcp` 才是 TLS 握手本身的時間，`ttfb` 減 `tls` 約等於「送請求 + 伺服器處理」。

## 常見錯誤與錯誤訊息

| 現象或訊息 | 卡在哪個階段 | 原因與處理 |
|---|---|---|
| `Could not resolve host`（curl）、`getaddrinfo ENOTFOUND`（Node.js）、`Name or service not known` | DNS | 主機名打錯、內網名稱在外網解析不到、DNS 伺服器不通 |
| `Connection refused`、`ECONNREFUSED` | TCP | 對方那個 port 沒有程式在聽，或防火牆主動拒絕。先確認服務有起來、聽的是 `0.0.0.0` 而不是 `127.0.0.1` |
| `Connection timed out`、`ETIMEDOUT` | TCP | 封包被丟掉（安全群組、防火牆沒開），對方完全沒回應 |
| `certificate has expired`、`SSL: CERTIFICATE_VERIFY_FAILED` | TLS | 憑證過期、缺中繼憑證、主機名不符（見 [HTTPS 憑證](#/skill/https-certificates)） |
| `400 Bad Request` 但程式沒有回 400 | 請求 | 通常是框架或 proxy 解析失敗：JSON 格式錯、`Content-Length` 與實際長度不符、缺 `Host` |
| `413 Content Too Large`（舊稱 Payload Too Large） | 請求 | body 超過上限；nginx 預設 `client_max_body_size` 是 1m |
| `431 Request Header Fields Too Large` | 請求 | cookie 累積太多、token 太長 |
| `502 Bad Gateway` | proxy 到後端 | 後端掛了、後端關掉了 proxy 還在重用的 keep-alive 連線 |
| `504 Gateway Timeout` | proxy 到後端 | 後端處理超過 proxy 的讀取逾時（nginx `proxy_read_timeout` 預設 60 秒） |

狀態碼誤用的幾個典型：

- **所有錯誤都回 200**，錯誤藏在 body 裡。監控、CDN、重試邏輯全部看不到錯誤。
- **所有錯誤都回 500**。客戶端的錯（參數不對）會觸發伺服器告警與無意義的重試。
- **沒登入回 403、沒權限回 401**。正好相反：401 是「不知道你是誰」（要附 `WWW-Authenticate` 標頭），403 是「知道你是誰，但不准」。
- **用 GET 改狀態**。會被預先載入、爬蟲、快取觸發或吃掉。

## 動手

1. 開 [HTTP 請求的一生](#/lab/HttpLab) 實驗室，逐步走過七個階段，切換不同的狀態碼情境，看原始請求與回應怎麼變。
2. 按上面 JavaScript 那段的「在 Playground 開啟」，把 body 裡加一個中文字，觀察位元組數和字元數的差別；再把 `Host` 那行刪掉，看解析在哪裡失敗。
3. 改 Python 估算那段的 `RTT`：設成 200（跨洲連線），比較重用連線省下的比例。
4. 對任一個 HTTPS 網站跑上面的 `curl -w`，連續跑兩次，比較 `dns` 的數字（第二次可能被系統快取）；再讀 [TCP/IP 與連線](#/skill/tcp-connections) 看連線池怎麼把握手成本攤掉。

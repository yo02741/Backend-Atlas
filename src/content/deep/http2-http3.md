## 從一個具體問題開始：一頁 80 個請求，卡在最慢的那幾個

一個後台管理頁面載入時要打 80 個請求：JS、CSS、圖示，再加上十幾個 API。用 HTTP/1.1 時，瀏覽器的開發者工具（Network 分頁的 Waterfall）會看到很多請求的前段是灰色的「Stalled / Queueing」：請求已經準備好了，但沒有可用的連線，只能排隊。

改成 HTTP/2 之後，排隊不見了，所有請求幾乎同時送出。但在通勤時用手機網路開同一頁，偶爾還是整頁一起卡住半秒，然後同時恢復。

這兩個現象分別對應兩種**隊頭阻塞**（head-of-line blocking）：HTTP/1.1 在 HTTP 層的隊頭阻塞，HTTP/2 解決了；TCP 層的隊頭阻塞，HTTP/2 解決不了，所以才有 HTTP/3。

先釐清一件事：HTTP/1.1、HTTP/2、HTTP/3 的**語意相同**——一樣是方法、路徑、狀態碼、標頭、body（定義在 RFC 9110）。改變的是這些東西在線路上怎麼編碼、怎麼傳。所以後端程式碼通常不用改，要改的是伺服器、反向代理與負載平衡器的設定。

## HTTP/1.1 的限制

HTTP/1.1 的請求與回應是純文字，在一條 TCP 連線上**一問一答**：

```http
GET /api/orders HTTP/1.1
Host: admin.example.com
Accept: application/json
Cookie: session=7f3a...

```

送出請求後，必須等這個回應完整收完，才能在同一條連線送下一個。慢的回應（例如一支要跑 2 秒的報表 API）會擋住後面所有請求，這就是 HTTP 層的隊頭阻塞。

HTTP/1.1 其實定義了 pipelining（不等回應就連續送多個請求），但回應仍必須依序回來，慢的還是擋住後面的，加上很多 proxy 處理不好，主流瀏覽器都沒有啟用。

瀏覽器的對策是**開更多連線**：對同一個來源大約同時開 6 條。這帶來幾個問題：

- 每條連線都要各自做 TCP 與 TLS 握手（見 [TCP/IP 與連線](#/skill/tcp-connections)）。
- 每條連線各自做 TCP 壅塞控制，彼此搶頻寬。
- 6 條用完還是要排隊。過去的前端優化手段（把圖片拼成 sprite、把所有 JS 打包成一個大檔、把資源分散到多個網域讓瀏覽器多開連線，即 domain sharding）都是在繞過這個限制。
- 每個請求都重送一次幾乎相同的標頭（`Cookie`、`User-Agent`、`Accept`…），小請求的標頭常常比 body 還大。

## HTTP/2：一條連線、多條 stream

HTTP/2（RFC 9113）保留 HTTP 語意，換掉線路格式：

### 二進位分幀

所有東西都切成**幀**（frame）。每個幀的前 9 個位元組是固定格式的幀頭：

| 欄位 | 長度 | 用途 |
|---|---|---|
| Length | 24 bits | 這個幀的內容長度 |
| Type | 8 bits | 幀的種類：`DATA`、`HEADERS`、`SETTINGS`、`WINDOW_UPDATE`、`RST_STREAM`、`GOAWAY`、`PING`… |
| Flags | 8 bits | 例如 `END_STREAM`（這個方向送完了）、`END_HEADERS` |
| Stream Identifier | 31 bits（前面 1 bit 保留） | 這個幀屬於哪一個 stream |

一個請求加回應就是一條 **stream**，有自己的編號（客戶端發起的用奇數）。不同 stream 的幀可以在同一條 TCP 連線上**交錯**傳送，接收端依 stream 編號重組。慢的回應只會讓自己那條 stream 慢，不會擋住別的，這就是**多工**（multiplexing）。

下面這段把幀頭編碼成 9 個位元組再解回來，可以直接執行：

```js run
// HTTP/2 幀頭：Length(24) Type(8) Flags(8) R(1)+StreamId(31)，共 9 bytes
const TYPES = { 0x0: 'DATA', 0x1: 'HEADERS', 0x3: 'RST_STREAM', 0x4: 'SETTINGS', 0x6: 'PING', 0x7: 'GOAWAY', 0x8: 'WINDOW_UPDATE' }

function encodeFrameHeader(length, type, flags, streamId) {
  const b = new Uint8Array(9)
  b[0] = (length >> 16) & 0xff
  b[1] = (length >> 8) & 0xff
  b[2] = length & 0xff
  b[3] = type
  b[4] = flags
  const v = new DataView(b.buffer)
  v.setUint32(5, streamId & 0x7fffffff)   // 最高位保留，必須是 0
  return b
}

function decodeFrameHeader(b) {
  const v = new DataView(b.buffer, b.byteOffset, 9)
  return {
    length: (b[0] << 16) | (b[1] << 8) | b[2],
    type: TYPES[b[3]] || `0x${b[3].toString(16)}`,
    endStream: (b[4] & 0x1) !== 0,          // DATA / HEADERS 的 END_STREAM 旗標
    streamId: v.getUint32(5) & 0x7fffffff,
  }
}

// 三個幀交錯：stream 1 的 HEADERS、stream 3 的 HEADERS、stream 1 的最後一個 DATA
const frames = [
  encodeFrameHeader(52, 0x1, 0x4, 1),
  encodeFrameHeader(48, 0x1, 0x4, 3),
  encodeFrameHeader(1200, 0x0, 0x1, 1),
]
for (const f of frames) {
  console.log(Array.from(f, (x) => x.toString(16).padStart(2, '0')).join(' '), '→', decodeFrameHeader(f))
}
```

### 標頭壓縮：HPACK

HTTP/2 的標頭用 **HPACK**（RFC 7541）壓縮：

- **靜態表**：常見的標頭（`:method: GET`、`:status: 200`、`accept-encoding: gzip, deflate` 等）有固定編號，送一個數字就好。
- **動態表**：這條連線上送過的標頭會被記住，之後再送同樣的 `cookie`、`user-agent`，只要送編號。
- **Huffman 編碼**：剩下的字串再壓一次。

HTTP/2 把請求行拆成**偽標頭**（pseudo-header）：`:method`、`:path`、`:scheme`、`:authority`，回應用 `:status`；標頭名稱一律小寫。HTTP/1.1 的連線層標頭（`Connection`、`Keep-Alive`、`Transfer-Encoding` 等）在 HTTP/2 裡不允許出現。

### 流量控制與其他

- 每條 stream 和整條連線都有**流量控制視窗**，接收端用 `WINDOW_UPDATE` 告訴對方還能送多少，避免一條大下載塞滿接收端的緩衝。
- `SETTINGS` 協商參數，例如同時最多幾條 stream（`SETTINGS_MAX_CONCURRENT_STREAMS`，很多伺服器設 100 左右）。
- `GOAWAY` 用來優雅關閉：告訴對方「不要再開新的 stream，已經開的我會處理完」。部署、重啟時會用到。
- 原本的優先權機制在 RFC 9113 被標為過時，另有 RFC 9218 定義較簡單的優先權方案；實作支援程度不一。

### 伺服器推送已經退場

HTTP/2 原本有 **server push**：伺服器在客戶端還沒要求前，就主動推送它「應該會需要」的資源。實務上很難推對（常推了瀏覽器快取裡已經有的東西），效益不明顯，Chrome 與 Firefox 都已經移除支援；nginx 的 `http2_push` 相關指令從 1.25.1 起也已失效、會被忽略。需要「提早告訴瀏覽器去抓什麼」時，現在的做法是 `103 Early Hints` 回應或 `<link rel="preload">`。

### 實務上 HTTP/2 跑在 TLS 上

規格允許不加密的 HTTP/2（h2c），但瀏覽器只支援加密的版本：在 TLS 握手時透過 **ALPN** 協商出 `h2`。所以「開啟 HTTP/2」在瀏覽器端等於「HTTPS + 伺服器支援 h2」。

## TCP 層的隊頭阻塞與 HTTP/3

HTTP/2 把多個 stream 放進**一條** TCP 連線。TCP 保證位元組依序送達：只要一個封包遺失，後面已經收到的封包都要在核心的緩衝裡等那個封包重傳，應用程式什麼都拿不到——即使後面的封包屬於完全不相干的 stream。

在丟包率低的有線網路上影響不大；在會丟包的行動網路上，HTTP/2 的單一連線可能比 HTTP/1.1 的 6 條連線更容易整體卡住（6 條連線至少只卡住其中一條）。

下面用一段模擬比較三種情況：同一批封包、第 3 個封包遺失、重傳要多花 100 ms，看每個回應什麼時候能交給應用程式：

```python run
# 封包依序抵達（每個 10 ms），第 3 個封包遺失、100 ms 後重傳補到
packets = [("A", 1), ("B", 1), ("A", 2), ("C", 1), ("B", 2), ("C", 2)]  # (stream, 第幾片)
LOST_INDEX, RETRANSMIT_DELAY = 2, 100

arrival = {i: (i + 1) * 10 for i in range(len(packets))}
arrival[LOST_INDEX] += RETRANSMIT_DELAY

def delivered_tcp():
    # TCP：整條連線依序交付，第 i 個封包要等前面全部到齊
    done, latest = {}, 0
    for i, (stream, _) in enumerate(packets):
        latest = max(latest, arrival[i])
        done[stream] = latest
    return done

def delivered_quic():
    # QUIC：每條 stream 各自依序，只等自己的封包
    done = {}
    for i, (stream, _) in enumerate(packets):
        done[stream] = max(done.get(stream, 0), arrival[i])
    return done

print("HTTP/2 over TCP：", delivered_tcp())    # A 遺失，B、C 也被拖慢
print("HTTP/3 over QUIC：", delivered_quic())  # 只有 A 被拖慢
```

### QUIC

**HTTP/3**（RFC 9114）跑在 **QUIC**（RFC 9000）上，QUIC 跑在 **UDP** 上。QUIC 在使用者空間自己實作了可靠傳輸、壅塞控制與 stream：

- **stream 在傳輸層就互相獨立**：一個 stream 的封包遺失只擋自己。
- **TLS 1.3 內建在 QUIC 握手裡**：傳輸與加密的握手合併，新連線 1 RTT 就能送請求；恢復連線時可以 0-RTT（同樣有重放風險）。
- **連線遷移**：TCP 連線由四元組決定，手機從 Wi-Fi 切到行動網路、IP 一變，連線就斷了。QUIC 用**連線 ID** 識別連線，IP 或 port 改變後可以繼續用同一條連線。
- 標頭壓縮改用 **QPACK**（RFC 9204），因為 HPACK 依賴依序送達，不適合 stream 互相獨立的 QUIC。

### 瀏覽器怎麼知道可以用 HTTP/3

瀏覽器第一次通常還是用 TCP 連（HTTP/1.1 或 HTTP/2），伺服器在回應裡帶 `Alt-Svc` 標頭宣告「同一個服務在 UDP 443 也有 HTTP/3」：

```http
HTTP/2 200
alt-svc: h3=":443"; ma=86400
```

之後的連線瀏覽器才嘗試 QUIC。另一個方式是 DNS 的 HTTPS 紀錄（SVCB/HTTPS），讓瀏覽器在第一次連線前就知道。UDP 443 被防火牆擋掉時，瀏覽器會退回 TCP，使用者通常感覺不到——但也表示「設了 HTTP/3」不代表流量真的走 HTTP/3，要實際檢查。

## 後端與反向代理怎麼設定

常見的架構是：**對外的邊界（CDN、負載平衡器、nginx）終結 TLS 與 HTTP/2 / HTTP/3，往後端用 HTTP/1.1**。

```text
瀏覽器 ──HTTP/3 或 HTTP/2（TLS）──▶ CDN / nginx ──HTTP/1.1（keep-alive）──▶ Uvicorn / Gunicorn
```

這樣做的理由：多工、標頭壓縮、握手成本的好處主要在高延遲、會丟包的公開網路上；在同一個機房內，nginx 與後端之間的 RTT 極小，用 HTTP/1.1 加連線池就夠了。很多 Python 應用伺服器（例如 Uvicorn）本身只支援 HTTP/1.1（與 WebSocket）；需要應用伺服器直接講 HTTP/2 時，Hypercorn 這類伺服器有支援。

nginx 的設定（指令名稱隨版本改過，以下以 1.25 之後為準）：

```nginx
server {
    listen 443 ssl;
    http2 on;                          # 1.25.1 起的寫法；更舊的版本是 listen 443 ssl http2;

    # HTTP/3：需要 nginx 1.25 以上、編譯時啟用 http_v3 模組，並搭配支援 QUIC 的 TLS 函式庫
    listen 443 quic reuseport;
    http3 on;
    add_header Alt-Svc 'h3=":443"; ma=86400' always;

    ssl_certificate     /etc/ssl/example.org/fullchain.pem;
    ssl_certificate_key /etc/ssl/example.org/privkey.pem;

    location / {
        proxy_pass http://app;         # 往後端仍是 HTTP/1.1
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }
}
```

開了 HTTP/3 還要記得：防火牆、安全群組、雲端負載平衡器都要放行 **UDP** 443，不只 TCP 443。各家雲端負載平衡器與 CDN 對 HTTP/3 的支援與設定方式不同，要查它們各自的文件。

## gRPC 為什麼綁 HTTP/2

gRPC 用 HTTP/2 當傳輸：每個 RPC 是一條 stream，用 HTTP/2 的多工在一條連線上並行很多呼叫；串流 RPC 直接對應 stream 的雙向傳送；呼叫結果放在 **trailer**（body 之後的標頭，例如 `grpc-status`）。這帶來幾個部署上的限制：

- **整條路徑都要支援 HTTP/2 與 trailer**。中間任何一層 proxy 把它降成 HTTP/1.1，gRPC 就不能用。nginx 轉送 gRPC 要用 `grpc_pass`，不是 `proxy_pass`。
- **長連線讓 L4 負載平衡失效**。gRPC client 對一個服務通常只開一條長連線，所有 RPC 都在上面。只看 TCP 連線的 L4 負載平衡器會把這個 client 的全部流量都送到同一台後端。要用能看懂 HTTP/2、逐個請求分配的 L7 負載平衡器，或在 client 端做負載平衡。
- **瀏覽器不能直接呼叫 gRPC**（瀏覽器的 API 拿不到 trailer 等底層細節），要透過 gRPC-Web 之類的轉換層。

## 怎麼確認實際用的是哪一版

```bash
# 印出協商到的 HTTP 版本（1.1、2、3）
curl -sS -o /dev/null -w '%{http_version}\n' https://example.org/

# 強制用 HTTP/2；-v 會看到 ALPN 協商結果，例如 "ALPN: server accepted h2"
curl -sv --http2 -o /dev/null https://example.org/ 2>&1 | grep -i alpn

# 試 HTTP/3（curl 要有編譯 HTTP/3 支援，不是每個發行版的 curl 都有）
curl -sS --http3 -o /dev/null -w '%{http_version}\n' https://example.org/

# 看伺服器有沒有宣告 HTTP/3
curl -sI https://example.org/ | grep -i alt-svc
```

瀏覽器開發者工具的 Network 分頁可以打開 **Protocol** 欄位，會顯示 `http/1.1`、`h2`、`h3`。

## 常見錯誤與錯誤訊息

| 現象 | 常見原因 | 怎麼處理 |
|---|---|---|
| Chrome 顯示 `ERR_HTTP2_PROTOCOL_ERROR` | 伺服器或 proxy 送出 HTTP/2 不允許的內容：例如回應裡帶 `Connection`、`Transfer-Encoding` 這類連線層標頭，或標頭格式不合法 | 檢查應用程式或中間層有沒有自己加這些標頭；用 `curl -v --http2` 重現，並看 proxy 的錯誤日誌 |
| 設了 HTTP/3，Protocol 欄位一直是 `h2` | 第一次連線本來就走 TCP；或 UDP 443 被防火牆擋；或回應沒有 `Alt-Svc` | 重新整理第二次再看；確認 `Alt-Svc` 有送出、UDP 443 有放行 |
| gRPC 呼叫出現 `UNAVAILABLE`、或錯誤訊息提到收到 HTTP/1.1 回應 | 中間的 proxy 或負載平衡器沒有用 HTTP/2 轉送 | 確認每一層都支援 HTTP/2 到後端；nginx 用 `grpc_pass` |
| gRPC 服務擴到 5 台，流量還是集中在 1 台 | L4 負載平衡只分配連線，gRPC 長連線上的請求都進同一台 | 改用 L7 負載平衡或 client 端負載平衡；或定期讓連線重建（伺服器設最長連線時間） |
| 部署時 HTTP/2 client 出現一批錯誤 | 伺服器直接關連線，沒有先送 `GOAWAY` 讓 client 轉到新連線 | 用伺服器的優雅關閉（graceful shutdown），並讓 client 對冪等請求重試 |

## 動手

1. 跑上面的幀頭範例，把 `streamId` 改成大於 `2**31` 的數字，看最高位被遮掉後解出什麼。
2. 跑隊頭阻塞的模擬，把 `LOST_INDEX` 改成 0 或 5，比較 TCP 與 QUIC 各個 stream 的完成時間。
3. 用 `curl -w '%{http_version}'` 檢查幾個常用網站實際協商到的版本，再看回應有沒有 `alt-svc`。
4. 回到 [TCP/IP 與連線](#/skill/tcp-connections) 對照握手的 RTT 表：QUIC 把 TCP 與 TLS 的握手合成一次，是 HTTP/3 新連線較快的原因。

## 從一個具體問題開始：多開了幾台機器，資料庫反而拒絕連線

一個 API 服務原本跑 2 個 Pod，每個 Pod 用 Gunicorn 開 4 個 worker，每個 worker 有一個 SQLAlchemy 連線池（預設 `pool_size=5`、`max_overflow=10`）。活動前把 Pod 擴到 6 個，流量一上來，日誌開始出現：

```text
psycopg.OperationalError: connection failed: FATAL:  sorry, too many clients already
```

算一下就知道原因：6 個 Pod × 4 個 worker × 每池最多 15 條 = 最多 360 條連線，而 PostgreSQL 的 `max_connections` 預設是 100（還要保留幾條給管理用）。機器加越多，同時想連資料庫的連線就越多，資料庫是最先撐不住的那一端。

同一個服務還有另一個毛病：每次呼叫金流 API 都 `httpx.post(...)`，等於每次都新開一條連線。平常 p50 延遲 40 ms，其中有一大半花在建立連線；`ss -tan` 一看，有幾千條 `TIME-WAIT`。

兩個問題的根源相同：**一條 TCP 連線的建立有成本、數量有上限**。這一課從 IP 與 port 講起，一路到握手、keep-alive、連線池，最後是連線太多時會看到的錯誤。

## IP、port 與一條連線的身分

- **IP 位址**決定封包送到哪一台機器（更精確地說，哪一個網路介面）。
- **port**（0–65535）決定送到那台機器上的哪一個程式。伺服器 `listen` 在固定的 port（HTTPS 443、PostgreSQL 5432）；客戶端發起連線時，作業系統會從**臨時 port**（ephemeral port）範圍挑一個沒在用的當來源 port。Linux 預設範圍是 `32768–60999`，可以用 `cat /proc/sys/net/ipv4/ip_local_port_range` 查。

一條 TCP 連線由四個值唯一決定，稱為四元組（4-tuple）：

| 來源 IP | 來源 port | 目的 IP | 目的 port |
|---|---|---|---|
| 10.0.1.23 | 51544 | 10.0.2.8 | 5432 |
| 10.0.1.23 | 51546 | 10.0.2.8 | 5432 |

同一台客戶端連同一個資料庫，每條連線只差在來源 port。所以「一台機器連同一個目的地最多能開幾條連線」，上限大約就是臨時 port 的數量（Linux 預設約 28,000 個）。伺服器那端則不受這個限制：它的每條連線都用同一個 port（5432），靠客戶端的 IP 與 port 區分。

在作業系統裡，每條連線都是一個**檔案描述子**（file descriptor）。每個行程能開的檔案描述子有上限（`ulimit -n`，很多發行版預設 1024），連線、開著的檔案、pipe 都算在裡面。

## TCP 三次握手與四次揮手

TCP 在傳資料前，雙方要先交換初始序號，確認彼此都能收發：

```text
客戶端                                   伺服器（LISTEN）
  │ ── SYN, seq=x ─────────────────────────▶ │   客戶端：SYN-SENT
  │ ◀──────────────── SYN+ACK, seq=y, ack=x+1 │   伺服器：SYN-RECEIVED
  │ ── ACK, ack=y+1 ───────────────────────▶ │   雙方：ESTABLISHED
  │ ── 第一個請求（可以跟 ACK 一起送）───────▶ │
```

握手花掉一個來回（RTT, round-trip time）之後才能送第一個位元組。同機房 RTT 可能不到 1 ms，跨區或跨國可能是幾十到上百 ms。

關閉連線時兩個方向各自關（TCP 是全雙工），所以是四個封包：

```text
主動關閉的一方                          被動關閉的一方
  │ ── FIN ─────────────────────────────▶ │   主動方：FIN-WAIT-1
  │ ◀──────────────────────────── ACK ── │   被動方：CLOSE-WAIT（等自己的程式呼叫 close）
  │                                       │   主動方：FIN-WAIT-2
  │ ◀──────────────────────────── FIN ── │   被動方：LAST-ACK
  │ ── ACK ─────────────────────────────▶ │   被動方：CLOSED
  │   主動方：TIME-WAIT（等 2×MSL 才真正釋放）
```

兩個狀態在排查時最常遇到：

- **TIME-WAIT**：出現在**主動關閉**的一方。它要再等一段時間（2×MSL，Linux 寫死為 60 秒），確保最後一個 ACK 遺失時還能重送，也避免舊連線的遲到封包被新連線誤收。少量是正常的；每秒新開又關掉幾百條連線時，TIME-WAIT 會累積到上萬條，佔住臨時 port。這通常代表**沒有重用連線**。
- **CLOSE-WAIT**：出現在**被動關閉**的一方，代表對方已經關了，但自己的程式還沒呼叫 `close()`。CLOSE-WAIT 持續增加幾乎都是程式的 bug：連線（或 response）用完沒關、例外路徑漏了關閉。

## TLS 疊在 TCP 上面

HTTPS 是在 TCP 連線建立之後，再做一次 TLS 握手：交換金鑰、驗證伺服器憑證，之後的資料才加密傳送（憑證怎麼驗見 [DNS、TLS 與憑證](#/skill/tls-dns)）。

| 階段 | TLS 1.2 | TLS 1.3 |
|---|---|---|
| TCP 握手 | 1 RTT | 1 RTT |
| TLS 握手 | 2 RTT | 1 RTT |
| 送出請求、收到回應 | 1 RTT | 1 RTT |
| **新連線拿到第一個回應** | **4 RTT** | **3 RTT** |
| 已建立的連線再送一個請求 | 1 RTT | 1 RTT |

TLS 1.3 把完整握手縮成一個來回；恢復先前的 session 時還可以用 0-RTT 在握手同時送資料，但 0-RTT 的資料可能被重放（replay），只適合不改狀態的請求，很多伺服器預設不開。

另外 TLS 握手還有 CPU 成本（金鑰交換與簽章驗證）。對後端來說，結論很直接：**新連線至少比重用連線多 2–3 個 RTT**，加上握手運算。下面這段把這個差距算出來：

```python run
# 用 RTT 估算：每次新開連線 vs 重用連線，送 N 個請求要多久
def total_ms(n_requests, rtt_ms, tls_rtts, reuse):
    connect = (1 + tls_rtts) * rtt_ms        # TCP 1 RTT + TLS 握手
    per_request = rtt_ms                      # 請求 + 回應 1 RTT（不計伺服器處理時間）
    if reuse:
        return connect + n_requests * per_request
    return n_requests * (connect + per_request)

for rtt in (1, 20, 80):
    for name, tls in (("TLS 1.2", 2), ("TLS 1.3", 1)):
        new = total_ms(100, rtt, tls, reuse=False)
        pooled = total_ms(100, rtt, tls, reuse=True)
        print(f"RTT {rtt:>2} ms {name}: 每次新連線 {new:>6} ms，重用連線 {pooled:>5} ms")
```

RTT 越大，差距越明顯；同機房（RTT 1 ms）時差距看起來不大，但握手的 CPU 成本和 TIME-WAIT 的累積還是在。

## HTTP keep-alive：一條連線跑多個請求

HTTP/1.0 預設一個請求一條連線。HTTP/1.1 改成預設**持久連線**（persistent connection，俗稱 keep-alive）：回應送完不關，下一個請求繼續用；任一方送 `Connection: close` 才表示要關。

HTTP/1.1 的一條連線**同一時間只能處理一個請求**（理論上有 pipelining，但實務上幾乎沒人用）。所以瀏覽器對同一個網域會開好幾條連線並行；HTTP/2 才在一條連線上多工（見 [HTTP/2 與 HTTP/3](#/skill/http2-http3)）。

keep-alive 有一個常見的坑：**閒置逾時不一致**。伺服器會關掉閒置太久的連線（例如 nginx 的 `keepalive_timeout` 預設 75 秒、Node.js 的 HTTP server 預設 5 秒），客戶端的連線池如果還以為那條連線能用，就會把請求送到一條剛被關掉的連線上，得到 `Connection reset by peer` 或「伺服器沒回應就斷線」。規則是：

- 呼叫端的連線池閒置時間要**短於**被呼叫端的 keep-alive 逾時。
- 後端應用程式的 keep-alive 逾時要**長於**前面負載平衡器的閒置逾時，否則負載平衡器會偶發 502。
- 只有冪等請求適合自動重試這種錯誤（見 [呼叫外部服務的韌性](#/skill/resilience)）。

nginx 當反向代理時，預設用 HTTP/1.0 連後端、每個請求一條新連線。要讓 nginx 到後端也重用連線，要三件事一起設：

```nginx
upstream app {
    server 127.0.0.1:8000;
    keepalive 32;                      # 每個 worker 最多保留 32 條閒置連線給後端
}

server {
    location / {
        proxy_pass http://app;
        proxy_http_version 1.1;        # keep-alive 需要 HTTP/1.1
        proxy_set_header Connection "";  # 清掉 Connection 標頭，不要轉送 close
    }
}
```

## 連線池：把連線留著重用

**連線池**（connection pool）是一組已經建好的連線：要用時借一條、用完還回去，池子空了才新建，閒置太久或壞掉的就丟掉。HTTP client 與資料庫驅動都有。

### HTTP client

```python
import httpx

# 錯：每次呼叫都建立並關閉一個 client，等於每次新連線
def charge_bad(order_id: int):
    return httpx.post("https://pay.example.com/charges", json={"order": order_id}, timeout=5.0)

# 對：整個行程共用一個 client，它內建連線池
client = httpx.Client(
    base_url="https://pay.example.com",
    timeout=httpx.Timeout(5.0, connect=2.0),
    limits=httpx.Limits(max_connections=50, max_keepalive_connections=10, keepalive_expiry=30),
)

def charge(order_id: int):
    return client.post("/charges", json={"order": order_id})
```

httpx 預設的上限是 `max_connections=100`、`max_keepalive_connections=20`。池子用完時，新請求要等別人還連線，等太久會丟 `httpx.PoolTimeout`。`requests` 套件的對應做法是共用一個 `requests.Session()`。

### 資料庫

資料庫連線比 HTTP 連線貴得多：PostgreSQL 每條連線是一個獨立的後端行程，會吃記憶體，還要做驗證與初始化。

```python
from sqlalchemy import create_engine

engine = create_engine(
    "postgresql+psycopg://app:***@db.internal:5432/shop",
    pool_size=5,          # 平常保留的連線數
    max_overflow=5,       # 尖峰時最多再多開幾條（用完就關）
    pool_timeout=10,      # 池子用完時最多等幾秒，超過就丟錯
    pool_pre_ping=True,   # 借出前先確認連線還活著（資料庫重啟、閒置被切後）
    pool_recycle=1800,    # 連線用超過 30 分鐘就換新的
)
```

設定連線池最重要的是**算總數**：

```text
最多連線數 = 機器（Pod）數 × 每台的行程數 × 每個行程的 (pool_size + max_overflow)
```

這個數字要小於資料庫的 `max_connections` 扣掉保留給管理、遷移、監控的連線。開頭的例子把每池改成 `pool_size=3, max_overflow=1`，6 × 4 × 4 = 96 條，剛好卡在邊緣；更穩的做法是在中間放 **PgBouncer** 這類連線池代理：應用程式開幾百條到 PgBouncer，PgBouncer 只用幾十條連資料庫。PgBouncer 的 transaction 模式會讓不同交易共用同一條資料庫連線，依賴 session 狀態的功能（`SET`、advisory lock、某些 prepared statement 用法）要另外確認，支援程度隨版本不同。

連線池也不是越大越好。資料庫同時能有效執行的查詢數受 CPU 核心數與磁碟限制，池子開到 200 條，多出來的只是在資料庫裡排隊、互搶鎖。池子用完就排隊等待，在應用程式這端反而比較好觀察與限制。

## 用 `ss -tan` 看連線狀態

`ss`（取代舊的 `netstat`）列出這台機器上的 socket。`-t` 只看 TCP、`-a` 包含 LISTEN、`-n` 不把 port 轉成名字：

```bash
ss -tan | head
# State      Recv-Q Send-Q   Local Address:Port    Peer Address:Port
# LISTEN     0      4096           0.0.0.0:8000         0.0.0.0:*
# ESTAB      0      0            10.0.1.23:51544      10.0.2.8:5432
# TIME-WAIT  0      0            10.0.1.23:40112    203.0.113.10:443

ss -tan | awk 'NR>1 {print $1}' | sort | uniq -c   # 各狀態幾條
ss -tan state established '( dport = :5432 )'      # 只看連到 PostgreSQL 的
ss -s                                              # 摘要
```

PostgreSQL 這端也能看：`SELECT state, count(*) FROM pg_stat_activity GROUP BY state;`，再對照 `SHOW max_connections;`。

下面把一段 `ss -tan` 的輸出依狀態與對端分組統計，可以直接執行：

```python run
from collections import Counter

ss_output = """State      Recv-Q Send-Q   Local Address:Port    Peer Address:Port
LISTEN     0      4096           0.0.0.0:8000         0.0.0.0:*
ESTAB      0      0            10.0.1.23:51544      10.0.2.8:5432
ESTAB      0      0            10.0.1.23:51546      10.0.2.8:5432
TIME-WAIT  0      0            10.0.1.23:40112    203.0.113.10:443
TIME-WAIT  0      0            10.0.1.23:40114    203.0.113.10:443
TIME-WAIT  0      0            10.0.1.23:40118    203.0.113.10:443
CLOSE-WAIT 1      0            10.0.1.23:8000      10.0.3.4:60220"""

by_state = Counter()
by_peer = Counter()
for line in ss_output.splitlines()[1:]:
    state, _recvq, _sendq, local, peer = line.split()
    by_state[state] += 1
    if state != "LISTEN":
        by_peer[(state, peer.rsplit(":", 1)[1])] += 1   # 依「狀態 + 對端 port」分組

print("各狀態：", dict(by_state))
for (state, port), n in by_peer.most_common():
    print(f"  {state:<10} 對端 port {port:<5} {n} 條")
# 判讀：對 443 一直出現 TIME-WAIT → 呼叫外部 API 沒有重用連線
#       CLOSE-WAIT 持續增加   → 自己的程式沒有關閉連線
```

## 常見錯誤與錯誤訊息

| 錯誤訊息 | 在哪裡看到 | 原因 | 怎麼處理 |
|---|---|---|---|
| `OSError: [Errno 24] Too many open files`（`EMFILE`） | 應用程式、nginx（`accept4() failed (24: Too many open files)`） | 行程的檔案描述子用完：連線太多或洩漏 | 先看是不是洩漏（CLOSE-WAIT 是否持續增加）；確定是正常用量再調高上限（`ulimit -n`、systemd 的 `LimitNOFILE`、容器的 ulimit 設定） |
| `FATAL: sorry, too many clients already` | PostgreSQL（SQLSTATE `53300`） | 連線數到達 `max_connections` | 算總連線數、縮小每個池、加 PgBouncer；不要第一步就把 `max_connections` 調到很大 |
| `QueuePool limit of size 5 overflow 10 reached, connection timed out` | SQLAlchemy | 應用程式自己的池子用完，等超過 `pool_timeout` | 查有沒有連線借了不還（session 沒關、交易沒結束）、查詢是不是太慢；再考慮加大池子 |
| `httpx.PoolTimeout` | httpx | HTTP client 的池子用完 | 同上；也檢查 response 有沒有讀完或關閉（串流回應沒關會一直佔著連線） |
| `Connection refused`（`ECONNREFUSED`） | 客戶端 | 對方那個 port 沒有程式在 listen，或防火牆直接拒絕 | 檢查服務有沒有起來、listen 的位址（`127.0.0.1` 還是 `0.0.0.0`）與 port |
| `Connection reset by peer`（`ECONNRESET`） | 客戶端 | 對方送了 RST：常見於重用了對方已關閉的閒置連線、對方行程崩潰 | 調整閒置逾時（池子要比對方短）、`pool_pre_ping`、冪等請求可重試 |
| `Cannot assign requested address`（`EADDRNOTAVAIL`） | 客戶端 | 臨時 port 用完，通常是大量 TIME-WAIT | 重用連線；不要一開始就去調核心參數 |
| `Connection timed out` | 客戶端 | SYN 送出去沒有回應：路由不通、防火牆丟包、對方 backlog 滿了 | 用 `nc -vz host port` 或 `curl -v` 確認卡在哪一層（見 [網路連線排查](#/skill/network-troubleshooting)） |

排查順序可以固定成三步：先用 `ss -tan` 數各狀態的連線數，再看對端是誰（資料庫、外部 API、還是進來的客戶端），最後對照上限（`ulimit -n`、`max_connections`、池子大小）。

## 動手

1. 在 [Python Playground](#/playground?lang=python) 跑 RTT 估算那段，把 `rtt` 改成 150（跨洲），看「每次新連線」與「重用連線」差多少。
2. 跑 `ss -tan` 分析那段，自己貼一段真實機器的輸出進去（記得保留標題列）。
3. 做這一課的程式題：實作一個有上限、會淘汰閒置連線的連線池。
4. 接著看 [呼叫外部服務的韌性](#/skill/resilience)：連線池用完、逾時、重試是一起設計的。

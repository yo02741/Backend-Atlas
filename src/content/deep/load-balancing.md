## 從一個具體問題開始：加了第二台，問題反而變多

API 只有一台主機，尖峰時 CPU 滿載。於是多開一台，前面放一個負載平衡器（load balancer），把請求分給兩台。上線第一週出現這些狀況：

| 狀況 | 背後的原因 |
|---|---|
| 使用者隨機被登出 | session 存在程序記憶體裡，下一個請求被送到另一台，那台不認得這個 session |
| 其中一台當機，一半的請求持續失敗好幾分鐘 | 負載平衡器沒有健康檢查，照樣把請求送給死掉的那台 |
| 限流把所有使用者一起擋掉 | 後端看到的來源 IP 全是負載平衡器的內網位址，「每個 IP 每分鐘 100 次」變成「所有人共用 100 次」 |
| 登入後一直被轉址回登入頁 | TLS 在負載平衡器終結，後端以為請求是 `http://`，產生的轉址與 cookie 設定都錯 |
| 部署時每次都噴一陣 502 | 舊程序直接被停掉，正在處理的請求和已經分配過去的連線一起斷掉 |

負載平衡器不只是「把請求平均分出去」。它決定**誰接**（演算法）、**誰不接**（健康檢查）、**TLS 在哪解開**、**後端怎麼知道真正的客戶端是誰**。這幾件事沒想清楚，加機器只會把一台的問題變成好幾台的問題。

## L4 與 L7：負載平衡器看得到什麼

負載平衡器依它工作在哪一層，看得到的資訊完全不同：

| | L4（傳輸層） | L7（應用層） |
|---|---|---|
| 看得到 | 來源與目的 IP、埠、TCP / UDP | 完整的 HTTP 請求：Host、路徑、標頭、cookie |
| 分配的單位 | 一條連線 | 一個請求 |
| TLS | 可以不解開，直接轉送（passthrough） | 要解開才看得到內容 |
| 能做的事 | 轉送連線，依 IP 與埠分派 | 依路徑或網域分派、改寫標頭、重試、快取、限流 |
| 例子 | nginx 的 `stream` 模組、HAProxy `mode tcp`、雲端的網路負載平衡器、Kubernetes Service | nginx 的 `http` 反向代理、HAProxy `mode http`、雲端的應用負載平衡器、Kubernetes Ingress 控制器 |

一個容易忽略的差別：**L4 分配的是連線，不是請求**。HTTP/1.1 的 keep-alive、HTTP/2、gRPC、WebSocket 都會讓一條連線長時間承載大量請求。客戶端如果只開一條連線（服務對服務呼叫常常如此），L4 負載平衡會把這個客戶端的所有請求都送到同一台後端，另一台閒著。這是 gRPC 服務放在只做 L4 的 Kubernetes Service 後面時常見的負載不均原因，解法是改用 L7 的代理，或在客戶端做負載平衡。

## 分配演算法：誰來接這個請求

| 演算法 | 做法 | 適合 | 注意 |
|---|---|---|---|
| round-robin（輪流） | 依序輪流分給每一台 | 每個請求成本差不多、後端規格相同 | nginx 的 `upstream` 預設就是加權的 round-robin |
| 加權 round-robin | 依權重決定比例，例如 3 : 3 : 1 | 後端規格不同、新機器逐步加流量 | 權重是靜態的，不會反映即時負載 |
| least connections | 選目前進行中連線最少的那台 | 請求處理時間差很多、長連線 | 需要負載平衡器知道每台的連線數；多個負載平衡器之間各算各的 |
| IP hash | 依客戶端 IP 決定 | 想讓同一個客戶端固定到同一台 | NAT 後很多人共用一個 IP，分布會很不均 |
| 一致性雜湊 | key 與機器都映射到一個環上，key 順時針找第一台 | 依 key 分配到固定節點：快取分片、有狀態的分片服務 | 要用虛擬節點讓分布平均 |

一致性雜湊解決的是「加減機器時搬動多少 key」。用 `hash(key) % N` 分配時，N 從 3 變 4，大約四分之三的 key 會換到別台，對快取來說等於大部分快取同時失效。一致性雜湊在加一台時，只有大約 1/N 的 key 換主人，其他 key 原地不動。每台機器在環上放很多個「虛擬節點」，是為了避免某台剛好分到一大段環。nginx 的 `hash $request_uri consistent;` 就是這種做法。

下面這段模擬三台後端，其中一台是舊機器、處理速度只有三分之一。比較三種演算法的分配結果，最後算加一台時兩種雜湊各搬動多少 key：

```python run
import hashlib
import bisect
import random

# 三台後端：c 是舊機器，處理同樣的請求要花 3 倍時間
SPEED = {"a": 1.0, "b": 1.0, "c": 3.0}

def simulate(pick, n=600, gap=10):
    random.seed(7)
    inflight = {s: [] for s in SPEED}          # 每台正在處理的請求的結束時間
    count = {s: 0 for s in SPEED}
    peak = {s: 0 for s in SPEED}
    total = 0.0
    for i in range(n):
        now = i * gap                           # 每 10 ms 來一個請求
        for s in SPEED:                         # 清掉已經處理完的
            inflight[s] = [t for t in inflight[s] if t > now]
        s = pick(i, inflight)
        cost = random.choice([20, 20, 20, 40, 200]) * SPEED[s]   # 大部分很快，偶爾很慢
        inflight[s].append(now + cost)
        count[s] += 1
        peak[s] = max(peak[s], len(inflight[s]))
        total += cost
    return count, peak, round(total / n, 1)

names = list(SPEED)
round_robin = lambda i, inflight: names[i % len(names)]
least_conn = lambda i, inflight: min(names, key=lambda s: len(inflight[s]))
weighted = ["a", "a", "a", "b", "b", "b", "c"]          # 權重 3 : 3 : 1
weighted_rr = lambda i, inflight: weighted[i % len(weighted)]

for label, pick in [("round-robin", round_robin), ("加權 3:3:1", weighted_rr), ("least conn", least_conn)]:
    count, peak, avg = simulate(pick)
    print(f"{label:12} 分到 {count}  同時處理峰值 {peak}  平均耗時 {avg} ms")

# --- 加一台後端時，有多少 key 換了主人 ---
def h(s: str) -> int:
    return int(hashlib.md5(s.encode()).hexdigest(), 16)

def mod_n(key, nodes):
    return nodes[h(key) % len(nodes)]

class Ring:
    def __init__(self, nodes, vnodes=100):
        # 每台機器在環上放 vnodes 個點，分布才會平均
        self.points = sorted((h(f"{n}#{v}"), n) for n in nodes for v in range(vnodes))
        self.hashes = [p for p, _ in self.points]

    def node_for(self, key):
        i = bisect.bisect(self.hashes, h(key)) % len(self.points)   # 順時針找第一個點
        return self.points[i][1]

keys = [f"user:{i}" for i in range(10000)]
before, after = ["a", "b", "c"], ["a", "b", "c", "d"]
moved_mod = sum(mod_n(k, before) != mod_n(k, after) for k in keys)
r1, r2 = Ring(before), Ring(after)
moved_ring = sum(r1.node_for(k) != r2.node_for(k) for k in keys)
print(f"\n3 台變 4 台：hash % N 搬動 {moved_mod / len(keys):.0%} 的 key，一致性雜湊搬動 {moved_ring / len(keys):.0%}")
```

觀察重點：round-robin 不管機器快慢，三台各分三分之一，結果慢的那台同時處理的請求最多、平均耗時被拖高。加權與 least connections 都把較少的請求送給慢機器；差別在於加權要人工設定比例，least connections 則依即時的連線數自動調整。

## 健康檢查與摘除

負載平衡器要知道哪些後端「現在可以接請求」，有兩種方式：

- **被動檢查**：看真實流量的結果。nginx 開源版的 `max_fails=3 fail_timeout=30s` 表示 30 秒內失敗 3 次，就在接下來的 30 秒不送請求給它。缺點是要先有真實請求失敗才會發現。
- **主動檢查**：負載平衡器定期打一個端點（例如 `GET /ready`），連續失敗幾次就摘除，連續成功幾次才加回來。HAProxy、雲端負載平衡器、Kubernetes 的 readiness probe 都是這種。nginx 開源版沒有主動健康檢查，這個功能在商業版 NGINX Plus 裡。

健康檢查端點該檢查什麼，是取捨：

- 只回 200、不檢查任何依賴：能接 HTTP 請求就算健康，但資料庫連不上時照樣接流量、照樣回 500。
- 檢查資料庫等共用依賴：資料庫掛掉時，**所有**後端同時被判定不健康、同時摘除，負載平衡器沒有任何後端可用。有些負載平衡器在全部不健康時會改成全部都送（fail open），有些直接回錯誤，要查你用的那一個。

常見的做法是 readiness 檢查「這個程序本身是否準備好」（啟動完成、連線池建立、沒在關閉中），共用依賴的故障交給告警與降級處理，不讓它把整批後端一起摘掉。liveness 與 readiness 的區別見 [應用伺服器與程序管理](#/skill/process-servers)。

部署時避免 502 的關鍵是**排空**（draining）：

1. 舊程序收到 SIGTERM 後，先讓 readiness 開始失敗，或由平台把它從後端名單移除。
2. 等負載平衡器停止送新請求（至少一個健康檢查週期，雲端負載平衡器常見的設定叫 deregistration delay）。
3. 把正在處理的請求做完，關閉連線，再退出。

少了第 2 步，負載平衡器在發現之前仍會把請求送給已經不接請求的程序。

## sticky session 的代價

sticky session（黏著，session affinity）讓同一個使用者固定送到同一台後端，通常用 cookie 或 IP hash 實作。它可以讓「session 存在記憶體」的程式在多台主機下勉強運作，代價是：

- **負載不均**：幾個重度使用者黏在同一台，那台特別忙，其他台閒著。
- **主機掛掉，那批使用者的 session 全部消失**。
- **擴容沒有立即效果**：新加的機器只能分到新來的使用者，已經黏住的流量不會移過去。
- **IP hash 遇到 NAT**：公司、學校、行動網路的大量使用者共用少數 IP，全部黏到同一台。

比較好的做法是讓後端**無狀態**：session 放 Redis 或改用 token，檔案放物件儲存，任何一台都能處理任何請求（見 [擴展](#/skill/scaling)、[物件儲存](#/skill/object-storage)）。WebSocket 這類長連線本身就綁在一台後端上，這是連線的性質，不需要額外的黏著設定；但斷線重連時可能連到另一台，狀態一樣要放在共用的地方。

## TLS 終結在哪裡

HTTPS 的 TLS 要在某個地方解開，常見三種位置：

| 做法 | TLS 在哪解開 | 優點 | 代價 |
|---|---|---|---|
| 在負載平衡器終結 | 負載平衡器 | 憑證集中管理；負載平衡器能做 L7 分派 | 負載平衡器到後端是明文，要在可信的私有網路內；後端要從標頭得知原本是 HTTPS |
| 終結後重新加密 | 負載平衡器解開，再用另一個 TLS 連線到後端 | 全程加密，符合要求內網也加密的規範 | 多一次加解密，後端也要管憑證 |
| 直接轉送（passthrough） | 後端 | 負載平衡器完全看不到內容 | 只能做 L4 分派（頂多依 TLS 的 SNI 分派），憑證散在每台後端 |

最常見的是第一種。這時後端收到的是 `http://` 請求，必須信任負載平衡器送來的 `X-Forwarded-Proto: https`，才能產生正確的轉址網址、把 cookie 設成 `Secure`。沒設定好就會出現開頭的「一直被轉址回登入頁」，或是 HTTP → HTTPS 轉址的無限迴圈。TLS 本身的運作見 [TLS 與 DNS](#/skill/tls-dns)。

## 真實來源 IP：X-Forwarded-For 與 PROXY protocol

經過負載平衡器之後，後端 TCP 連線的對方是負載平衡器，不是客戶端。L7 代理會把原始 IP 放進標頭：

```http
X-Forwarded-For: 203.0.113.7, 10.0.1.5
X-Forwarded-Proto: https
```

`X-Forwarded-For` 的規則是：每經過一層代理，代理把「它看到的對方 IP」**加在最後面**。所以最右邊是離後端最近的那一層加的，最左邊是最早的。問題在於最左邊的值可以由客戶端自己送：客戶端送出 `X-Forwarded-For: 1.2.3.4`，第一層代理會變成 `1.2.3.4, <客戶端真實 IP>`。直接取最左邊的值，任何人都能假冒 IP 繞過限流與 IP 白名單。

正確的做法是**從右邊往左看，跳過自己信任的代理**，第一個不屬於信任代理的位址才是客戶端。nginx 用 realip 模組設定：

```nginx
# 只有來自這些位址的 X-Forwarded-For 才採信（填你自己的負載平衡器所在網段）
set_real_ip_from 10.0.0.0/8;
real_ip_header   X-Forwarded-For;
real_ip_recursive on;     # 從右往左跳過所有信任的位址，取第一個不信任的

location /api/ {
    proxy_pass http://api;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;              # realip 處理後的客戶端 IP
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Python 的 uvicorn 用 `--proxy-headers` 與 `--forwarded-allow-ips` 決定要不要採信這些標頭、採信哪些來源；`--forwarded-allow-ips` 的預設只有 `127.0.0.1`，代理在其他位址時要明確設定，不要隨手設成 `*`（等於誰送的都信）。標準化的版本是 `Forwarded` 標頭（RFC 7239），信任規則一樣。

L4 負載平衡器不解析 HTTP，沒辦法加標頭。這時可以用 **PROXY protocol**：負載平衡器在 TCP 連線一開始先送一行（或一段二進位）說明原始的來源與目的位址，後端讀完這段才開始讀 HTTP。nginx 用 `listen 80 proxy_protocol;` 啟用，用 `$proxy_protocol_addr` 取得位址。兩端設定必須一致：後端開了 PROXY protocol 但前面沒送，或前面送了但後端沒開，連線都會失敗（後端會把那行當成壞掉的 HTTP 請求）。部分雲端 L4 負載平衡器在特定設定下會保留原始來源 IP，不需要 PROXY protocol，要看該服務的文件。

## 跟 nginx、Kubernetes 的關係

- **nginx**：`upstream` 區塊就是一個 L7 負載平衡器（`stream` 模組則是 L4）。`server app1:8000 weight=3;`、`least_conn;`、`hash … consistent;`、`max_fails` 對應前面的演算法與被動健康檢查。設定方式見 [nginx 反向代理](#/skill/nginx)。
- **Kubernetes Service**：給一組 Pod 一個穩定的虛擬 IP 與 DNS 名稱。kube-proxy（或其他實作）把連到這個 IP 的連線分給**通過 readiness probe 的 Pod**，這是 L4，分配單位是連線。
- **Kubernetes Ingress / Gateway API**：L7 規則（依網域、路徑分派到不同 Service），實際由 Ingress 控制器執行，控制器本身常常就是 nginx、HAProxy、Envoy 之類的代理。社群維護的 ingress-nginx 控制器已宣布退場，新專案先查清楚它目前的維護狀態，並評估 Gateway API 的實作。
- **雲端負載平衡器**：通常在最前面，後面接 Ingress 控制器或直接接後端。

實際的請求常常經過好幾層：雲端負載平衡器 → Ingress 控制器 → Service → Pod。每一層都可能終結 TLS、加上 `X-Forwarded-For`，信任設定要每一層都對：每一層只信任它前一層的位址。

## 常見錯誤與錯誤訊息

| 現象 / 訊息 | 意思 | 常見原因 |
|---|---|---|
| 502，nginx error log：`connect() failed (111: Connection refused) while connecting to upstream` | 連不上後端 | 後端沒起來、埠寫錯、容器名稱或 Service 名稱錯 |
| 502，`upstream prematurely closed connection while reading response header from upstream` | 後端在回應前關了連線 | 後端程序當掉或被重啟；後端的 keep-alive 逾時比代理短，代理重用了已被後端關閉的連線 |
| 504，`upstream timed out (110: Connection timed out) while reading response header from upstream` | 後端太久沒回應 | 慢查詢、外部呼叫沒設逾時；先找慢的原因，不要只把 `proxy_read_timeout` 調大 |
| `no live upstreams while connecting to upstream` | 所有後端都被標記為失敗 | 健康檢查或 `max_fails` 把全部摘掉了；看是不是共用依賴（資料庫）掛了 |
| 部署時固定出現一陣 502 | 舊程序在負載平衡器知道之前就停了 | 沒有排空；程序沒處理 SIGTERM |
| 轉址無限迴圈、cookie 沒有 `Secure` | 後端以為請求是 HTTP | 沒有採信 `X-Forwarded-Proto` |
| log 裡所有 IP 都是 `10.x.x.x` | 後端看到的是負載平衡器 | 沒有設定 realip / `--forwarded-allow-ips` |
| 某一台特別忙 | 分配不均 | 長連線走 L4、sticky session、IP hash 遇到 NAT |

keep-alive 逾時那一條值得多說一句：代理與後端之間的閒置連線，如果**後端先關**，代理可能剛好在那一刻把新請求送進這條連線，結果就是零星、難以重現的 502。原則是後端的 keep-alive 閒置逾時要比前面代理的閒置逾時長，讓關閉連線的總是代理這一側。

## 動手

1. 執行上面的模擬，把 `SPEED["c"]` 改成 1.0，看三種演算法的差異是不是消失了；再把它改成 10，看 round-robin 的峰值怎麼變。
2. 在模擬的 `Ring` 把 `vnodes` 改成 1，觀察加一台時搬動的比例，以及每台分到的 key 數量差多少。
3. 程式題「一致性雜湊分配」：自己實作有虛擬節點的雜湊環，並確認加一台時只搬動一小部分 key。
4. 到實驗室 [NginxLab](#/lab/NginxLab) 看 nginx 怎麼把請求分給 upstream；到設計情境 [從 100 到 10 萬 QPS](#/scenario/scale-path) 看負載平衡在擴展路徑上的位置。

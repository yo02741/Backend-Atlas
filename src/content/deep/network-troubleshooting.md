## 從一個具體問題開始：「系統連不上」

早上八點，門診櫃台回報：新的排班系統 `https://sched.example.org` 打不開。同一時間，資訊部的四個人各自給了一個答案：

- 網路組：「我 ping 得到那台主機，網路是通的。」
- 系統組：「服務有在跑，`systemctl status` 是 active。」
- 開發：「我在自己電腦上開得起來。」
- 廠商：「我們這邊沒改任何東西。」

四句話可能都是真的，系統還是連不上。原因是「連上一個網站」不是一件事，而是一連串依序發生的步驟，每一步由不同的人管。ping 得到只證明 ICMP 封包能到；服務 active 只證明程序活著；開發者的電腦可能在另一個網段、問的是另一台 DNS。

要讓討論有結論，得先回答「**卡在哪一層**」。這一課把一條連線拆成七層，列出每一層壞掉時工具實際印出什麼，以及從這些輸出能推論出什麼。

## 一條 HTTPS 連線依序經過什麼

以瀏覽器打開 `https://sched.example.org/` 為例：

```text
用戶端
  │ 1. DNS：sched.example.org 是哪個 IP？
  │ 2. 路由：封包怎麼走到那個 IP 所在的網段？
  │ 3. 防火牆：路上的防火牆允不允許這個來源連這個 port？
  │ 4. proxy：用戶端是不是被設定成要先經過正向 proxy？
  ▼
負載平衡器 / 反向代理（例如 nginx）
  │ 5. 負載平衡：有沒有健康的後端可以轉送？
  │ 6. TLS：憑證是否有效、名字是否相符、信任鏈是否完整？
  ▼
應用程式
    7. 應用程式：收到請求後，回應是否正常（還要再連資料庫、其他 API）？
```

順序很重要：前面的層沒通過，後面的層根本不會發生。DNS 解析不出來，就不會有封包；TCP 連不上，就不會有 TLS 握手；TLS 失敗，請求就不會送到應用程式。所以排查也照這個順序，由前往後。

不同層有不同的工具：

| 層 | 主要工具 | 證明了什麼 |
|---|---|---|
| DNS | `dig`、`nslookup`、`getent hosts` | 名字能解析成哪個 IP、是哪台 DNS 回答的 |
| 路由 | `ip route get`、`traceroute`、`mtr` | 封包從這台機器出去會走哪個閘道、在哪一跳斷掉 |
| 防火牆 / port | `nc -vz`、`ss -ltn`（伺服器端） | TCP 三向交握能不能完成 |
| proxy | `curl -v`、環境變數 `HTTPS_PROXY` / `NO_PROXY` | 連線是直連還是經過 proxy |
| 負載平衡 | `curl -v`、負載平衡器的健康檢查狀態 | 有沒有後端被判定為健康 |
| TLS | `curl -v`、`openssl s_client` | 憑證、名字、信任鏈 |
| 應用程式 | `curl -v`、應用程式 log | HTTP 狀態碼與回應內容 |

`ping` 不在表裡，原因是很多網路會擋 ICMP：ping 不到不代表服務不通，ping 得到也不代表 port 有開。

## 第 1 層：DNS

`dig` 直接問 DNS 伺服器，輸出的 `status` 是第一個要看的欄位。

```bash
$ dig sched.example.org

; <<>> DiG 9.18.28 <<>> sched.example.org
;; global options: +cmd
;; Got answer:
;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 41872
;; flags: qr rd ra; QUERY: 1, ANSWER: 1, AUTHORITY: 0, ADDITIONAL: 1

;; ANSWER SECTION:
sched.example.org.	300	IN	A	10.20.0.15

;; Query time: 2 msec
;; SERVER: 10.0.0.53#53(10.0.0.53) (UDP)
```

這一段告訴你三件事：名字解析成 `10.20.0.15`、TTL 還剩 300 秒、回答的是 `10.0.0.53` 這台 DNS。

壞掉時常見的幾種：

| `dig` 的結果 | 意思 | 常見原因 |
|---|---|---|
| `status: NXDOMAIN` | 這個名字不存在 | 打錯字、記錄還沒建、問到了不認識這個內部網域的 DNS |
| `status: NOERROR`，但 `ANSWER: 0` | 名字存在，但沒有你要的記錄類型 | 只建了 AAAA 沒建 A，或只有 MX 記錄 |
| `status: SERVFAIL` | DNS 伺服器自己查不下去 | 上游 DNS 壞了、轉送設定錯、DNSSEC 驗證失敗 |
| `status: REFUSED` | DNS 伺服器拒絕回答你 | 這台 DNS 不允許你的網段查詢（遞迴查詢有限制） |
| `connection timed out; no servers could be reached` | 根本沒收到回應 | DNS 伺服器掛了，或防火牆擋了 UDP / TCP 53 |

```bash
$ dig sched.example.org
;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN, id: 5521
;; flags: qr rd ra; QUERY: 1, ANSWER: 0, AUTHORITY: 1, ADDITIONAL: 1

$ dig @10.0.0.53 sched.example.org
;; communications error to 10.0.0.53#53: timed out
;; communications error to 10.0.0.53#53: timed out
;; communications error to 10.0.0.53#53: timed out
; <<>> DiG 9.18.28 <<>> @10.0.0.53 sched.example.org
;; global options: +cmd
;; no servers could be reached
```

逾時的訊息格式依 `dig` 版本不同：較舊的版本印 `;; connection timed out; no servers could be reached`，BIND 9.18 之後常見的是上面那種 `communications error … timed out`。意思一樣：沒收到回應。

### 內網 DNS 與外網 DNS 不同（split-horizon）

很多組織讓同一個名字在內外網解析成不同位址：內網使用者連內部 IP，外部使用者連公開的入口。這叫 split-horizon DNS。結果就是「我這邊查得到」和「你那邊查不到」可能同時成立：

```bash
$ dig +short sched.example.org @10.0.0.53     # 內部 DNS
10.20.0.15
$ dig +short sched.example.org @1.1.1.1       # 公開 DNS
$                                             # 空的：外網沒有這筆記錄
```

`+short` 只印答案。用 `@伺服器` 指定要問哪一台，是比對內外網差異最快的方法。排查時先確認三件事：

1. 用戶端實際設定的 DNS 是哪一台（Linux 看 `/etc/resolv.conf` 或 `resolvectl status`，Windows 用 `ipconfig /all`）。
2. 有沒有 VPN 改掉了 DNS 設定：連上 VPN 時，查詢可能改由 VPN 那端的 DNS 回答。
3. `/etc/hosts` 有沒有寫死。`dig` 不讀 `/etc/hosts`，它直接問 DNS；瀏覽器和大部分程式走系統的解析器，會先看 `/etc/hosts`。所以 `dig` 的結果和程式實際連的位址可能不同。要看系統解析器的結果，用 `getent hosts sched.example.org`。

### TTL 與快取

改了 DNS 記錄之後，舊答案還會在各層快取裡留到 TTL 用完。TTL 是 3600 秒，就可能有人一小時內還連到舊的 IP。要換 IP 前，先把 TTL 調短、等舊的 TTL 過期，再改記錄。站上 [TLS 與 DNS](#/skill/tls-dns) 有記錄類型的說明。

## 第 2–3 層：路由與防火牆

DNS 給了 IP 之後，下一個問題是 TCP 連不連得上那個 port。`nc -vz` 只做 TCP 三向交握、不送資料，最適合回答這個問題（`-v` 印出結果、`-z` 不送資料、`-w 3` 三秒逾時）：

```bash
$ nc -vz -w 3 10.20.0.15 443
Connection to 10.20.0.15 443 port [tcp/https] succeeded!
```

這是 OpenBSD 版 `nc`（Debian / Ubuntu 預設）的輸出；其他版本（例如 RHEL 系的 `ncat`）格式不同，但同樣會區分以下幾種失敗。

| 輸出 | 封包發生了什麼 | 推論 |
|---|---|---|
| `succeeded!` | 三向交握完成 | 網路、防火牆、port 都通，問題在更上層 |
| `Connection refused` | 封包到了主機，主機回 RST（重設） | 主機在，但這個 port 沒有程式在聽；或程式只聽在 `127.0.0.1` |
| `timed out: Operation now in progress` | 送出去的封包沒有任何回應 | 防火牆把封包**丟掉**（drop）、路由不通、主機不存在 |
| `No route to host` | 收到 ICMP 的「無法到達」 | 路由問題，或防火牆用 ICMP 主動**拒絕**（例如 firewalld 的預設拒絕方式） |

```bash
$ nc -vz -w 3 10.20.0.15 5432
nc: connect to 10.20.0.15 port 5432 (tcp) failed: Connection refused

$ nc -vz -w 3 10.30.0.8 5432
nc: connect to 10.30.0.8 port 5432 (tcp) timed out: Operation now in progress
```

**refused 和 timeout 的差別是排查的分水嶺**：

- refused：封包到了目的主機。網路組可以放心，問題在那台主機上——服務沒起來、聽錯 port，或只聽在 localhost。到伺服器上用 `ss -ltn` 看：

  ```bash
  $ ss -ltn
  State   Recv-Q  Send-Q   Local Address:Port   Peer Address:Port
  LISTEN  0       511          127.0.0.1:8000        0.0.0.0:*
  LISTEN  0       4096           0.0.0.0:22          0.0.0.0:*
  ```

  `127.0.0.1:8000` 代表只有本機能連，從別台機器連會被拒絕；要改成聽 `0.0.0.0` 或特定網卡的 IP。

- timeout：封包沒有回音。最常見的是中間某台防火牆把它丟掉了。要確認是哪一段，從**同網段**的另一台機器試同一個 port：同網段通、跨網段不通，就是網段之間的防火牆規則；同網段也不通，看主機本身的防火牆（`firewall-cmd --list-all`、`nft list ruleset` 或雲端的安全群組）。

跨網段時，`traceroute`（或 `mtr`，持續版的 traceroute）可以看到封包在第幾跳之後就沒有回應。注意中間的路由器常被設定成不回應 traceroute，一列 `* * *` 不一定是斷點；要看的是**之後**是否還有任何回應。

申請防火牆規則時，要給的資訊是：來源 IP 或網段、目的 IP、目的 port、協定（TCP / UDP）、用途與期限。只寫「讓 A 系統可以連 B 系統」，網路組沒辦法照著開。

## 第 4 層：proxy

很多內網的伺服器不能直接連外，要透過正向 proxy。問題常出在兩個方向：

- 該走 proxy 卻沒走：伺服器要下載套件，直連被防火牆擋，結果是 timeout。
- 不該走 proxy 卻走了：連內部系統時，請求被送到 proxy，proxy 不認識內部名字或不允許。

`curl -v` 會印出它是不是用了 proxy：

```bash
$ curl -v https://sched.example.org/
* Uses proxy env variable HTTPS_PROXY == 'http://proxy.example.org:3128'
*   Trying 10.0.0.80:3128...
* Connected to proxy.example.org (10.0.0.80) port 3128
* CONNECT tunnel: HTTP/1.1 negotiated
> CONNECT sched.example.org:443 HTTP/1.1
< HTTP/1.1 403 Forbidden
* CONNECT tunnel failed, response 403
curl: (56) CONNECT tunnel failed, response 403
```

連的是 proxy 的 IP，不是 `10.20.0.15`；proxy 回了 403。內部網域要加進 `NO_PROXY`（例如 `NO_PROXY=.example.org,10.0.0.0/8,localhost`）。注意各程式對 `NO_PROXY` 的解讀不完全一致（例如是否支援 CIDR 網段），設好之後要用實際的程式驗證。

## 第 5 層：負載平衡與 502 / 503 / 504

到了這一層，TCP 和 TLS 都已經跟**負載平衡器或反向代理**建立好了，用戶端收到的 HTTP 錯誤頁是它產生的，不是應用程式。這三個狀態碼都表示「proxy 和後端之間出事」：

| 狀態碼 | 意思 | 常見原因 | nginx error log 裡的典型訊息 |
|---|---|---|---|
| `502 Bad Gateway` | proxy 連後端失敗，或後端回了無效回應 | 後端程序掛了、port 錯、後端在回應途中斷線；nginx 所有後端都被標記失效時也回 502 | `connect() failed (111: Connection refused) while connecting to upstream`、`upstream prematurely closed connection while reading response header from upstream`、`no live upstreams while connecting to upstream` |
| `503 Service Unavailable` | 目前沒有可用的服務 | 很多負載平衡器在沒有健康後端時回 503（例如 Kubernetes 的 ingress-nginx 在 Service 沒有可用 endpoint 時）；nginx 的 `limit_req` 擋下的請求預設也回 503；維護頁 | 依產品而定，先看是誰回的 |
| `504 Gateway Timeout` | 後端在時限內沒回應 | 後端太慢（慢查詢、等外部 API）、後端被防火牆擋住導致連線逾時 | `upstream timed out (110: Connection timed out) while reading response header from upstream` |

nginx 的 log 實際長這樣，`upstream:` 會告訴你是哪一台後端：

```text
2026/10/20 08:03:12 [error] 2187#2187: *9041 connect() failed (111: Connection refused) while connecting to upstream, client: 10.1.4.22, server: sched.example.org, request: "GET / HTTP/1.1", upstream: "http://10.20.0.21:8000/", host: "sched.example.org"
```

排查方式：

1. 看回應是誰產生的。`curl -v` 的回應標頭裡常有 `Server: nginx` 之類的資訊；錯誤頁的內容也會透露是哪個產品。
2. 到那一台 proxy 看 error log，找出 `upstream` 的位址。
3. 從 **proxy 那台機器**對 upstream 做 `nc -vz` 和 `curl`，因為從你的電腦能連，不代表從 proxy 能連。
4. 看負載平衡器的健康檢查：它打的是哪個路徑、預期什麼狀態碼。健康檢查路徑如果需要登入，會一直被判定為失敗。

`504` 要特別注意兩個逾時的關係：proxy 的逾時（nginx 的 `proxy_read_timeout` 預設 60 秒）比應用程式處理時間短，就會出現「後端其實做完了，但使用者看到 504」。調高逾時只是治標，慢的那段要另外處理。

## 第 6 層：TLS

TCP 連上之後是 TLS 握手。`curl` 的 TLS 錯誤大多是 `(60)` 或 `(35)`：

| `curl` 錯誤 | 意思 | 常見原因 |
|---|---|---|
| `curl: (60) SSL certificate problem: certificate has expired` | 憑證過期 | 忘了續約、續約了但服務沒重新載入 |
| `curl: (60) SSL certificate problem: unable to get local issuer certificate` | 找不到簽發者，信任鏈接不上 | 伺服器沒送中繼憑證；或憑證由內部 CA 簽發、這台用戶端沒裝根憑證 |
| `curl: (60) SSL certificate problem: self-signed certificate` | 自簽憑證 | 測試用憑證被放上正式環境 |
| `curl: (60) SSL: no alternative certificate subject name matches target host name 'sched.example.org'` | 名字不符 | 憑證的 SAN 沒有這個名字；或請求打到了另一個虛擬主機的預設憑證 |
| `curl: (35) ... handshake failure` 之類 | 握手失敗 | 雙方沒有共同支援的 TLS 版本或加密套件；或中間設備干擾 |

錯誤字串的細節依 `curl` 版本與 TLS 函式庫（OpenSSL、GnuTLS 等）而不同，但錯誤碼的意義是固定的。完整列表見 libcurl 的錯誤碼文件。

成功時，`curl -v` 會印出憑證的關鍵欄位：

```bash
$ curl -sv -o /dev/null https://sched.example.org/health
*   Trying 10.20.0.15:443...
* Connected to sched.example.org (10.20.0.15) port 443
* SSL connection using TLSv1.3 / TLS_AES_256_GCM_SHA384
* Server certificate:
*  subject: CN=sched.example.org
*  start date: Sep  1 00:00:00 2026 GMT
*  expire date: Nov 30 23:59:59 2026 GMT
*  subjectAltName: host "sched.example.org" matched cert's "sched.example.org"
*  issuer: C=TW; O=Example Org; CN=Example Internal Issuing CA
*  SSL certificate verify ok.
> GET /health HTTP/1.1
> Host: sched.example.org
< HTTP/1.1 200 OK
```

（`-s` 不印進度條、`-o /dev/null` 丟掉回應內容，只留 `-v` 的連線過程。實際輸出的行數依版本略有差異。）

**不要用 `curl -k` 當解法**。`-k` 跳過憑證驗證，只能用來確認「除了憑證以外都正常」；寫進程式或腳本裡，等於關掉了 TLS 防止冒充的那一半功能。憑證的細節在 [HTTPS 憑證](#/skill/https-certificates)。

## 第 7 層：應用程式

走到這裡，請求已經送到應用程式了，狀態碼由應用程式決定：

- `404`：可能是路徑錯，也可能是 `Host` 標頭對不上，請求被送到 proxy 的預設站台。用 `curl -v` 確認 `Host:` 是你預期的名字。
- `401` / `403`：認證或權限問題，網路是通的。
- `500`：應用程式內部錯誤，看應用程式 log。
- 回應很慢但最後成功：應用程式在等它自己的下游（資料庫、其他 API）。這時要從**應用程式那台機器**，對它的下游重複一次上面的排查。

應用程式本身也是一個用戶端：它連資料庫要經過 DNS、防火牆、TLS，一樣的七層。

## 排查順序整理

```text
1. dig 名字                       → 解析得到嗎？是預期的 IP 嗎？問的是哪台 DNS？
2. nc -vz IP port                → succeeded / refused / timeout？
     refused → 到主機上 ss -ltn，看服務聽在哪裡
     timeout → 從同網段再試一次，判斷是主機防火牆還是網段之間的防火牆
3. curl -v URL                   → 有沒有走 proxy？TLS 有沒有過？狀態碼是誰回的？
4. 502 / 503 / 504               → 到 proxy 看 error log，從 proxy 那台對 upstream 重做 2、3
5. 200 但內容不對或很慢           → 看應用程式 log，對它的下游重做 1–3
```

每一步的輸出直接貼給負責的人，比「連不上」有用得多：「`nc` 從 10.1.4.0/24 到 10.20.0.15:443 timeout，同網段的 10.20.0.30 可以連」這一句，網路組就知道要查哪一條規則。

## 常見錯誤

- **用 ping 判斷服務通不通**：ICMP 可能被擋，而且 ping 不測 port。改用 `nc -vz`。
- **在自己電腦上測就下結論**：你的電腦和使用者的電腦可能在不同網段、用不同 DNS、有沒有走 proxy 也不同。要在出問題的那個位置測，或從同一個網段測。
- **改了 DNS 馬上測**：舊答案還在快取裡。用 `dig` 看回答裡的 TTL，或直接 `dig @權威 DNS` 確認記錄本身已經改好。
- **只看 `systemctl status`**：程序活著不代表它在聽正確的位址與 port，也不代表它能連到自己的資料庫。用 `ss -ltn` 與健康檢查端點確認。
- **防火牆規則開 any 了事**：問題暫時解決，但規則再也沒人敢收回。規則要寫清楚來源、目的、port 與用途。

## 動手

在一台能連外網的機器上，對公開的網站重現上面的幾種輸出：

```bash
dig example.org                        # 看 status、ANSWER、SERVER
dig nonexistent-name.example.org       # NXDOMAIN
nc -vz -w 3 example.org 443            # succeeded
nc -vz -w 3 example.org 81             # 通常會 timeout（沒有服務、封包被丟棄）
nc -vz -w 3 127.0.0.1 9               # 本機沒有服務聽 9 號 port：Connection refused
curl -sv -o /dev/null https://example.org/
curl -sv -o /dev/null https://expired.badssl.com/       # (60) certificate has expired
curl -sv -o /dev/null https://wrong.host.badssl.com/    # (60) 名字不符
```

`badssl.com` 是專門提供各種錯誤憑證的測試網站。對照每個指令的輸出，指出它停在七層中的哪一層。接著讀 [HTTPS 憑證](#/skill/https-certificates)，看信任鏈與 SAN 怎麼檢查。

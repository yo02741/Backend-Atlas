## 從一個具體問題開始：換了機器，一半的使用者還連到舊的

服務要從舊主機 `203.0.113.10` 搬到新主機 `198.51.100.20`。晚上十點把 DNS 的 A 紀錄改成新 IP，用自己的電腦 `dig` 一下，已經是新 IP，就把舊主機關了。

接下來兩個小時，客服電話不斷：部分使用者的網站打不開。原因是那筆 A 紀錄的 TTL 是 86400 秒（一天）。各地的 DNS resolver 在改動之前已經把舊 IP 存起來，會一直用到 TTL 到期，最長要一天。

隔週又出了另一件事：新主機上另外掛了第二個網站，某支舊版的 Android App 連過來時出現憑證錯誤，說憑證上的名字不符，瀏覽器卻都正常。原因是那個 client 沒送 SNI，伺服器不知道它要哪個網站，回了預設網站的憑證。

這兩件事分別發生在連線的最前面兩步：**DNS** 把名字變成 IP，**TLS** 在連線上確認對方的身分並加密。

## DNS：名字怎麼變成 IP

### 解析的流程

```
應用程式 ──→ stub resolver（作業系統） ──→ 遞迴 resolver（ISP、公司內網、8.8.8.8、1.1.1.1…）
                                              │
                                              ├─(1)→ 根伺服器：「.example 歸誰管？」 → 給 TLD 伺服器的位址
                                              ├─(2)→ TLD 伺服器：「shop.example 歸誰管？」 → 給權威伺服器（NS）
                                              └─(3)→ 權威伺服器：「api.shop.example 的 A？」 → 198.51.100.20，TTL 300
                                              │
                                              存進快取，在 TTL 內直接回答
```

| 角色 | 做什麼 | 快取 |
|---|---|---|
| stub resolver | 作業系統內建，把查詢交給設定好的遞迴 resolver（`/etc/resolv.conf` 等） | 依系統而定，有的完全不快取，有的由本機服務（例如 systemd-resolved）快取 |
| 遞迴 resolver | 從根開始一路問到答案 | 依 TTL 快取每一層的結果 |
| 根伺服器 | 知道每個頂級網域（TLD）由誰負責 | |
| TLD 伺服器 | 知道 `shop.example` 的權威伺服器是誰 | |
| 權威伺服器 | 存放這個網域的紀錄（通常在 DNS 服務商或雲端平台） | |

另外，**應用程式與執行環境自己也可能快取**：瀏覽器有自己的 DNS 快取，JVM 有 `networkaddress.cache.ttl` 設定，有些 HTTP client 也會快取解析結果。更重要的是**已經建立的連線**：連線池裡的連線不會因為 DNS 改了就重新連，會一直連在舊 IP 上，直到連線被關閉。

### 紀錄類型

| 類型 | 內容 | 範例 | 注意 |
|---|---|---|---|
| `A` | IPv4 位址 | `api.shop.example. 300 IN A 198.51.100.20` | 可以有多筆，客戶端會挑其中一個 |
| `AAAA` | IPv6 位址 | `api.shop.example. 300 IN AAAA 2001:db8::20` | 有 AAAA 時，客戶端可能優先走 IPv6；IPv6 路徑不通會造成延遲或失敗 |
| `CNAME` | 指向另一個名字 | `www.shop.example. 300 IN CNAME shop.cdn.example.` | 同一個名字有 CNAME 就**不能有其他紀錄**，所以網域根（`shop.example`）不能設 CNAME |
| `MX` | 收信伺服器與優先順序 | `shop.example. 3600 IN MX 10 mail.shop.example.` | 數字越小越優先；目標必須是主機名，不應該是 CNAME |
| `TXT` | 任意文字 | `shop.example. 3600 IN TXT "v=spf1 include:_spf.mail.example ~all"` | 用在 SPF、DKIM、DMARC、網域所有權驗證（例如申請憑證、驗證搜尋引擎） |
| `NS` | 這個網域的權威伺服器 | `shop.example. 86400 IN NS ns1.dns.example.` | 換 DNS 服務商時要改的是 TLD 那邊的 NS 委派 |
| `CAA` | 哪些 CA 可以為這個網域簽發憑證 | `shop.example. 3600 IN CAA 0 issue "letsencrypt.org"` | CA 簽發前會檢查；沒有 CAA 紀錄代表不限制 |

網域根不能設 CNAME，但常常需要指向 CDN 或負載平衡器的名字。很多 DNS 服務商提供 `ALIAS`、`ANAME` 或「CNAME flattening」：在服務商那邊先解析好目標，對外回 A／AAAA。這不是標準的紀錄類型，各家名稱與行為不同。

### TTL 與換 IP

TTL 是「這筆答案可以被快取幾秒」。它影響的是**改動多久後才全面生效**：

```
TTL = 86400 時直接改紀錄
  t=0      改 A 紀錄                      某 resolver 在 t=−1h 剛存了舊 IP
  t=0~23h  這個 resolver 的使用者還是拿到舊 IP
  t=23h    快取到期，重新查詢，拿到新 IP

先降 TTL 再改
  t=−2d    把 TTL 從 86400 改成 300       舊的 86400 還留在各地快取裡，要等它自然到期
  t=−1d    此時所有快取裡的 TTL 都已經是 300
  t=0      改 A 紀錄
  t=5min   所有 resolver 都拿到新 IP（遵守 TTL 的那些）
  t=+1d    確認穩定後，把 TTL 調回較長的值
```

換 IP 的步驟：

1. **提前降 TTL**，至少提前「舊 TTL 的長度」，讓長 TTL 的快取先全部到期。
2. 新舊主機**同時運作**，改紀錄。
3. 觀察舊主機的流量，等它降到接近 0（不是等 TTL 到期就關：有些 client 不遵守 TTL，連線池裡也還有舊連線）。
4. 關舊主機，把 TTL 調回來。

查不到的答案也會被快取：查詢一個還不存在的名字得到 NXDOMAIN，resolver 會依該網域 SOA 紀錄裡的設定把「不存在」快取一段時間。先查了、後建立紀錄，新紀錄可能要等這段時間才查得到。

### 用 dig 查

```bash
dig api.shop.example A +short          # 只要答案
dig api.shop.example A                 # 完整輸出；ANSWER SECTION 的第二欄是剩餘 TTL
dig @1.1.1.1 api.shop.example A        # 指定 resolver，比較不同 resolver 的快取狀態
dig @ns1.dns.example api.shop.example  # 直接問權威伺服器：改了沒有，以這裡為準
dig +trace api.shop.example            # 從根一路問下來，看每一層的委派
```

從遞迴 resolver 查到的 TTL 會隨時間遞減（剩餘快取時間）；直接問權威伺服器拿到的才是設定的原始值。DNS 問題的完整排查順序，見 [網路問題排查](#/skill/network-troubleshooting)。

## TLS：確認對方是誰，並加密

拿到 IP、建好 TCP 連線後，HTTPS 還要做 TLS 握手。握手要完成三件事：**協商版本與演算法、確認伺服器的身分（憑證）、雙方得到同一把對稱金鑰**。

### TLS 1.3 的握手

```
客戶端                                                   伺服器
  |--- ClientHello -------------------------------------->|
  |    支援的版本與加密套件、key_share（金鑰交換的公開值）     |
  |    SNI：要連的主機名（api.shop.example）                |
  |    ALPN：想用的應用協定（h2、http/1.1）                  |
  |                                                       |
  |<-- ServerHello（key_share）----------------------------|  到這裡雙方已能算出握手用的金鑰
  |<-- {EncryptedExtensions：選定的 ALPN} ------------------|  ┐
  |<-- {Certificate：憑證鏈} -------------------------------|  │ 這些已經加密
  |<-- {CertificateVerify：用私鑰簽握手內容} ----------------|  │
  |<-- {Finished} -----------------------------------------|  ┘
  |                                                       |
  |    客戶端驗證憑證鏈、主機名、CertificateVerify 的簽章     |
  |--- {Finished} + 第一個 HTTP 請求 ---------------------->|  1 RTT 後就能送資料
```

| | TLS 1.2 | TLS 1.3 |
|---|---|---|
| 完整握手 | 2 RTT | 1 RTT |
| 金鑰交換 | 可以用 RSA 金鑰交換（沒有前向保密）或 ECDHE | 只有具前向保密的（EC）DHE |
| 憑證是否加密傳送 | 明文 | 加密 |
| 連線恢復 | session ID／session ticket | PSK，可以 0-RTT（第一個請求跟著握手送） |

**前向保密**：每次連線用臨時產生的金鑰交換，伺服器的私鑰日後外洩，也解不開過去錄下來的流量。TLS 1.3 的 **0-RTT** 資料可能被攻擊者重送（replay），所以只適合冪等的請求；很多伺服器預設不開，或只對 GET 開。

### 憑證怎麼驗證

客戶端收到憑證鏈後依序檢查：

1. **信任鏈**：伺服器憑證由中繼 CA 簽、中繼 CA 由根 CA 簽，根 CA 在客戶端的信任清單（trust store）裡。伺服器要送出中繼憑證，少送會讓部分客戶端驗證失敗。
2. **效期**：現在時間在 `notBefore` 與 `notAfter` 之間。客戶端時鐘錯誤也會造成失敗。
3. **主機名**：要連的名字出現在憑證的 SAN（Subject Alternative Name）裡。現代瀏覽器不看 CN 欄位。
4. **用途與簽章**：憑證允許用在伺服器認證；`CertificateVerify` 證明伺服器真的持有對應的私鑰。

萬用字元 `*.shop.example` 只涵蓋**一層**：`api.shop.example` 符合，`shop.example` 和 `v2.api.shop.example` 都不符合。

信任鏈的細節、DV／OV／EV、Let's Encrypt 與自動續約、用 `openssl` 檢查憑證，見 [HTTPS 憑證](#/skill/https-certificates)。本課只講驗證的原理。

### SNI：一個 IP 上的很多網站

TLS 握手發生在 HTTP 請求之前，伺服器還沒看到 `Host` 標頭，就要決定送哪張憑證。**SNI**（Server Name Indication）讓客戶端在 ClientHello 裡先說「我要連 `api.shop.example`」，伺服器據此選憑證。開頭那支舊 App 沒送 SNI，伺服器只能回預設憑證，名字對不上。

SNI 在 ClientHello 裡是**明文**，網路上的觀察者看得到你連的網域（但看不到路徑和內容）。ECH（Encrypted Client Hello）是加密 ClientHello 的擴充，目前部署仍不普遍，不能假設它存在。

用 `openssl s_client` 可以看 SNI 的影響：

```bash
# 帶 SNI：拿到 api.shop.example 的憑證
openssl s_client -connect 198.51.100.20:443 -servername api.shop.example </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -ext subjectAltName

# 不帶 SNI：拿到的是伺服器的預設憑證（可能是別的網站的）
openssl s_client -connect 198.51.100.20:443 -noservername </dev/null 2>/dev/null \
  | openssl x509 -noout -subject

# 還沒改 DNS 前，先讓 curl 把名字解析到新主機測試（DNS 不用動）
curl -v --resolve api.shop.example:443:198.51.100.20 https://api.shop.example/health
```

`--resolve` 很適合換主機前的驗證：SNI 與 `Host` 都是正確的名字，只是連到指定的 IP。

### 在哪裡終結 TLS

```
瀏覽器 ══HTTPS══> 負載平衡器／nginx ──HTTP──> 應用程式
                  （憑證在這裡）       X-Forwarded-Proto: https
                                       X-Forwarded-For: 客戶端 IP
```

TLS 通常在邊界（負載平衡器、nginx、CDN）終結，往後端走內網的 HTTP。應用程式看到的連線是 HTTP，要從 `X-Forwarded-Proto` 得知原始請求是 HTTPS，否則產生的轉址網址、cookie 的 `Secure` 判斷都會錯。這些標頭只能信任自己的 proxy 設定的值，框架通常有「信任哪些 proxy」的設定。內網也要加密時（零信任網路、法規要求），就在 proxy 到後端之間再建一段 TLS 或 mTLS。

## 實際程式：模擬遞迴解析、TTL 快取與萬用字元比對

下面這段 Python 用假的資料模擬一個遞迴 resolver：從根問到權威伺服器、追 CNAME、依 TTL 快取。中間改了 A 紀錄，可以看到快取裡的舊答案要到 TTL 到期才會換掉：

```python run
# 每台伺服器知道什麼：NS 委派或最終答案。值是 (type, data, ttl)
zones = {
    "root":         {"example.": ("NS", "tld", 172800)},
    "tld":          {"shop.example.": ("NS", "auth-shop", 86400), "cdn.example.": ("NS", "auth-cdn", 86400)},
    "auth-shop":    {"api.shop.example.": ("A", "203.0.113.10", 300),
                     "www.shop.example.": ("CNAME", "shop.cdn.example.", 3600)},
    "auth-cdn":     {"shop.cdn.example.": ("A", "192.0.2.80", 60)},
}
cache, deleg, queries = {}, {}, []      # 答案的快取、NS 委派的快取、實際發出的查詢

def ask(server, name):
    queries.append(server)
    for suffix, rec in zones[server].items():
        if name == suffix or name.endswith("." + suffix):
            return suffix, rec
    return None, None

def closest_server(name, now):
    # 從快取裡找最接近這個名字的委派；都沒有才從根開始
    best, server = "", "root"
    for suffix, (srv, expires) in deleg.items():
        if expires > now and name.endswith("." + suffix) and len(suffix) > len(best):
            best, server = suffix, srv
    return server

def resolve(name, now, depth=0):
    if name in cache and cache[name][2] > now:
        rtype, data, expires = cache[name]
        print(f"{'  ' * depth}{name} 快取命中 → {data}（剩 {expires - now}s）")
        return data if rtype == "A" else resolve(data, now, depth + 1)
    server = closest_server(name, now)
    while True:
        suffix, (rtype, data, ttl) = ask(server, name)
        if rtype == "NS":
            deleg[suffix] = (data, now + ttl)  # 委派也照 TTL 快取
            server = data                      # 被委派到下一層
            continue
        cache[name] = (rtype, data, now + ttl)
        print(f"{'  ' * depth}{name} 問到 {server}：{rtype} {data}（TTL {ttl}）")
        return data if rtype == "A" else resolve(data, now, depth + 1)   # CNAME：換個名字再查

print("t=0");    resolve("api.shop.example.", 0)
print("t=0");    resolve("www.shop.example.", 0)
print("查詢次數：", len(queries), queries)

zones["auth-shop"]["api.shop.example."] = ("A", "198.51.100.20", 300)    # 搬家：改 A 紀錄
print("\n改了紀錄")
print("t=120");  resolve("api.shop.example.", 120)                       # 還在 TTL 內：舊 IP
print("t=301");  resolve("api.shop.example.", 301)                       # 到期：重新問，新 IP

# 憑證的主機名比對：萬用字元只涵蓋最左邊的一層
def matches(pattern, host):
    p, h = pattern.lower().split("."), host.lower().split(".")
    if len(p) != len(h):
        return False
    return all(a == b or (i == 0 and a == "*") for i, (a, b) in enumerate(zip(p, h)))

san = ["*.shop.example", "shop.example"]
for host in ["api.shop.example", "shop.example", "v2.api.shop.example", "api.shop.example.evil.example"]:
    print(f"{host:<32} {'符合' if any(matches(s, host) for s in san) else '不符：瀏覽器會報主機名不符'}")
```

## 常見錯誤與錯誤訊息

| 訊息 | 階段 | 原因 |
|---|---|---|
| `NXDOMAIN`（dig 的 status）、`Could not resolve host` | DNS | 名字不存在、打錯字，或新紀錄還被「不存在」的負快取擋著 |
| `SERVFAIL` | DNS | resolver 問不到權威伺服器、DNSSEC 驗證失敗、委派設定錯誤 |
| 改了 DNS，有些人還是連到舊主機 | DNS | TTL 未到期、client 自己快取、連線池的舊連線 |
| `NET::ERR_CERT_COMMON_NAME_INVALID`（Chrome） | TLS | 主機名不在憑證的 SAN 裡；常見原因是沒送 SNI、萬用字元層數不對、憑證漏了某個名字 |
| `NET::ERR_CERT_DATE_INVALID`（Chrome） | TLS | 憑證過期或尚未生效；也可能是客戶端時鐘錯誤 |
| `NET::ERR_CERT_AUTHORITY_INVALID`（Chrome） | TLS | 簽發者不受信任：自簽憑證、內部 CA 沒裝進 trust store、少送中繼憑證 |
| `unable to get local issuer certificate`（curl、OpenSSL） | TLS | 找不到能連到信任根的鏈，通常是伺服器少送中繼憑證，或 client 的 CA 清單太舊 |
| `ssl.SSLCertVerificationError: ... certificate verify failed`（Python） | TLS | 同上；不要用 `verify=False` 了事，正式環境要修好憑證鏈或指定正確的 CA 檔 |
| `ERR_SSL_PROTOCOL_ERROR`、`wrong version number` | TLS | 對一個講 HTTP 的 port 發 HTTPS（或反過來），例如 `https://host:80` |
| 應用程式產生的轉址變成 `http://` | TLS 終結 | 後端沒讀 `X-Forwarded-Proto`，或框架沒設定信任 proxy |

`dig` 回應裡的 `status:` 欄位是判斷 DNS 問題的起點：`NOERROR` 但沒有 ANSWER 代表名字存在但沒有這種類型的紀錄（例如只有 A 沒有 AAAA），和 `NXDOMAIN`（名字不存在）是兩回事。

## 動手

1. 按 Python 那段的「在 Playground 開啟」，把 `api.shop.example.` 的 TTL 改成 86400，看改了紀錄之後要等多久才拿到新 IP；再把 `print("查詢次數："…)` 那行的輸出和沒有委派快取的情況比較：查 `www` 時已經不用再問根與 TLD。
2. 在 `zones` 裡讓 `shop.cdn.example.` 也是一個 CNAME（指向 `edge.cdn.example.`），補上對應的紀錄，看 CNAME 鏈怎麼被一層層追下去。
3. 對任一個網站跑 `dig +trace`，對照上面的流程圖找出根、TLD、權威伺服器各是哪一段；再用 `openssl s_client -servername` 看它的憑證 SAN 包含哪些名字。
4. 連線建立之前與之後的排查順序，接著讀 [網路問題排查](#/skill/network-troubleshooting)；憑證本身的申請、續約與信任鏈，讀 [HTTPS 憑證](#/skill/https-certificates)。

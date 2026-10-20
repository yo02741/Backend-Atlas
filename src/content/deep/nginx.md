## 從一個具體問題開始：加了 nginx 之後的三個錯

一個前後端分離的服務，前端是 SPA 的靜態檔，後端 API 用 uvicorn 跑在 8000 埠。上線前在最前面放了一台 nginx，設定寫好、`nginx -t` 通過、重新載入。第一天就收到三種回報：

**第一個：API 全部 404。** 後端的路由是 `/users`、`/orders`，nginx 設定是 `location /api/ { proxy_pass http://127.0.0.1:8000; }`。後端的 access log 裡收到的請求是 `GET /api/users`——多了一個 `/api`。

**第二個：上傳大頭貼失敗。** 瀏覽器看到 `413 Request Entity Too Large`，後端完全沒有收到請求。nginx 的 error log：

```text
2026/10/20 10:02:17 [error] 1290#1290: *5521 client intended to send too large body: 3481925 bytes, client: 203.0.113.7, server: shop.example.com, request: "POST /api/avatar HTTP/1.1", host: "shop.example.com"
```

**第三個：每次部署都有一分鐘左右的 502。** error log：

```text
2026/10/20 11:30:02 [error] 1290#1290: *6012 connect() failed (111: Connection refused) while connecting to upstream, client: 203.0.113.7, server: shop.example.com, request: "GET /api/orders HTTP/1.1", upstream: "http://127.0.0.1:8000/api/orders", host: "shop.example.com"
```

三個問題分別來自 `proxy_pass` 結尾的斜線、`client_max_body_size` 的預設值（1 MB），以及只有一個後端、部署時它不在。這一課先講 nginx 怎麼處理一個請求，再逐一講 `location` 比對、`proxy_pass`、轉送標頭、upstream、逾時、靜態檔、TLS，最後整理 502 / 504 的 log。

## 反向代理在做什麼

```text
瀏覽器 ──HTTPS──▶ nginx :443 ──HTTP──▶ uvicorn :8000
         連線 1                 連線 2
```

客戶端只和 nginx 建立連線；nginx 讀完請求，**自己另外開一條連線**（或重用一條）送給後端，拿到回應再轉回去。這兩條連線各自獨立，帶來幾個結果：

- 後端看到的連線來源是 nginx，不是客戶端；客戶端的 IP、原本的網域、是不是 HTTPS，都要靠 nginx 用標頭轉告（後面的 `proxy_set_header`）。
- 每一條連線都有自己的逾時；任何一段逾時，客戶端就會看到錯誤。
- nginx 預設會**緩衝**請求本體與回應：上傳慢的客戶端由 nginx 慢慢收完再一次送給後端，後端的 worker 不會被慢速客戶端拖住。

nginx 由一個 master 行程與數個 worker 行程組成。`nginx -s reload`（或 `systemctl reload nginx`）讓 master 讀新設定、啟動新的 worker，舊的 worker 把手上的連線處理完才結束——重新載入不會中斷進行中的請求。設定寫錯時，master 會拒絕新設定、繼續用舊的跑，所以**永遠先 `nginx -t` 再 reload**：

```bash
$ sudo nginx -t
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
$ sudo systemctl reload nginx
```

## 設定檔的結構

```nginx
http {                                  # HTTP 相關的全域設定
    server {                            # 一個虛擬主機：依 listen 的埠與 server_name 選
        listen 80;
        server_name shop.example.com;

        location /api/ {                # 依請求路徑選
            proxy_pass http://127.0.0.1:8000;
        }
    }
}
```

一個請求進來，nginx 先依**埠**與 `Host` 標頭選 `server`（都對不上時用那個埠的 `default_server`，沒有標示就用第一個），再依**路徑**選 `location`。多數發行版把站台設定放在 `/etc/nginx/conf.d/*.conf` 或 `sites-enabled/`，由主設定檔 `include` 進來。

## `location` 的比對規則

`location` 有四種寫法：

| 寫法 | 類型 | 例子 |
|---|---|---|
| `location = /health` | 精確比對 | 只比對 `/health`，`/health/` 或 `/healthz` 都不算 |
| `location ^~ /static/` | 前綴比對，命中後不再看 regex | `/static/app.css` |
| `location ~ \.php$`、`location ~* \.png$` | regex，`~` 分大小寫、`~*` 不分 | 依設定檔中的順序試 |
| `location /api/` | 一般前綴比對 | `/api/`、`/api/users` |

選擇的步驟：

1. 有 `=` 精確命中，直接用它，結束。
2. 在所有前綴（一般前綴與 `^~`）中找出**最長**的那一個。如果它是 `^~`，直接用它，結束。
3. 否則先記住這個最長前綴，**依設定檔順序**試每一個 regex，第一個命中的就用它。
4. 沒有 regex 命中，才用第 2 步記住的最長前綴。

所以前綴的**書寫順序不重要**（只看長度），regex 的**書寫順序很重要**（先寫的先試）。最容易被忽略的是第 3 步：一個比對副檔名的 regex 會蓋過一般前綴。下面這段程式照這四步實作比對，可以直接執行：

```python run
import re

# 依設定檔中的順序列出 location：(修飾詞, 樣式)
locations = [
    ("=",  "/health"),
    ("^~", "/static/"),
    ("~*", r"\.(png|jpg|css|js)$"),     # 圖片與資源：給長快取
    ("",   "/api/"),
    ("",   "/"),
]

def choose(uri):
    for mod, pat in locations:                        # 1. 精確比對
        if mod == "=" and uri == pat:
            return f"= {pat}", "精確命中"
    prefixes = [(mod, pat) for mod, pat in locations if mod in ("", "^~") and uri.startswith(pat)]
    longest = max(prefixes, key=lambda p: len(p[1]), default=None)   # 2. 最長前綴
    if longest and longest[0] == "^~":
        return f"^~ {longest[1]}", "最長前綴是 ^~，不看 regex"
    for mod, pat in locations:                        # 3. 依順序試 regex
        if mod in ("~", "~*"):
            flags = re.IGNORECASE if mod == "~*" else 0
            if re.search(pat, uri, flags):
                return f"{mod} {pat}", "regex 命中，蓋過最長前綴" + (f" {longest[1]}" if longest else "")
    if longest:                                       # 4. 回頭用最長前綴
        return f"{longest[1]}", "最長前綴"
    return None, "沒有任何 location：404"

for uri in ["/health", "/healthz", "/static/app.css", "/img/logo.PNG", "/api/users", "/api/avatar.png", "/about"]:
    loc, why = choose(uri)
    print(f"{uri:<18} -> location {loc:<26} ({why})")
```

注意 `/api/avatar.png`：它被圖片的 regex 接走，不會送到後端。這種情況把 API 改成 `location ^~ /api/` 就能避免。

## `proxy_pass` 結尾的斜線

開頭的第一個問題就在這裡。規則只有一條：

- `proxy_pass` 的位址**沒有 URI 部分**（`http://127.0.0.1:8000`），請求的路徑**原封不動**送給後端。
- `proxy_pass` 的位址**有 URI 部分**——哪怕只是一個 `/`（`http://127.0.0.1:8000/`）——請求路徑中**符合 location 的那一段，會被換成這個 URI**。

| location | proxy_pass | 請求 `/api/users?id=7` 送給後端的是 |
|---|---|---|
| `/api/` | `http://app:8000` | `/api/users?id=7`（原樣） |
| `/api/` | `http://app:8000/` | `/users?id=7`（`/api/` 換成 `/`） |
| `/api/` | `http://app:8000/v1/` | `/v1/users?id=7` |
| `/api` | `http://app:8000/` | `//users?id=7`（`/api` 換成 `/`，多出一個斜線） |

選哪一種取決於後端的路由：後端路由本身就有 `/api` 前綴，用第一種；沒有，用第二種。location 與 proxy_pass 的結尾斜線要成對出現，第四列是常見的「少一個斜線」錯誤；而且 `location /api` 也會比對到 `/apiary` 這種路徑。

可以用下面這段驗證：

```python run
# 模擬 proxy_pass 怎麼改寫請求路徑
def upstream_uri(location, proxy_pass, request):
    path, _, query = request.partition("?")
    rest = proxy_pass.split("://", 1)[1]
    uri_part = rest[rest.find("/"):] if "/" in rest else None   # host:port 之後的部分
    if uri_part is None:
        new_path = path                                # 沒有 URI：原樣轉送
    else:
        new_path = uri_part + path[len(location):]     # 有 URI：location 比對到的那段被取代
    return new_path + ("?" + query if query else "")

cases = [
    ("/api/", "http://app:8000"),
    ("/api/", "http://app:8000/"),
    ("/api/", "http://app:8000/v1/"),
    ("/api",  "http://app:8000/"),
]
for loc, target in cases:
    print(f"location {loc:<6} proxy_pass {target:<22} -> {upstream_uri(loc, target, '/api/users?id=7')}")
```

regex location 裡的 `proxy_pass` 不能帶 URI 部分，`nginx -t` 會報 `"proxy_pass" cannot have URI part in location given by regular expression, or inside named location, …`；這種情況要改寫路徑時用 `rewrite`。

## `proxy_set_header`：把原始資訊轉給後端

不設定時，nginx 送給後端的 `Host` 是 `proxy_pass` 裡的名字（`$proxy_host`，例如 `127.0.0.1:8000`），而且用 HTTP/1.0、`Connection: close`。一般會設定：

```nginx
location /api/ {
    proxy_pass http://api_backend;
    proxy_http_version 1.1;                    # 對後端用 HTTP/1.1（keepalive、串流需要）
    proxy_set_header Connection "";            # 清掉 Connection，讓 upstream keepalive 生效
    proxy_set_header Host              $host;                       # 原本的網域
    proxy_set_header X-Real-IP         $remote_addr;                # 連到 nginx 的 IP
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;  # 原有的 XFF 再加上 $remote_addr
    proxy_set_header X-Forwarded-Proto $scheme;                     # http 或 https
}
```

| 後端少了它會怎樣 | 標頭 |
|---|---|
| 產生的絕對網址、cookie 網域、多網域路由都錯 | `Host` |
| log 與限流看到的 IP 全是 nginx | `X-Real-IP`、`X-Forwarded-For` |
| 後端以為是 HTTP：產生 `http://` 的轉址造成無限迴圈、cookie 沒有 `Secure` | `X-Forwarded-Proto` |

後端要**設定成採信這些標頭**，而且只採信來自 nginx 的。uvicorn 用 `--forwarded-allow-ips` 指定信任的代理位址（預設只有 `127.0.0.1`）；`X-Forwarded-For` 的最左邊可以被客戶端偽造，信任邊界怎麼畫見 [負載平衡](#/skill/load-balancing)。

一個常見的陷阱：`proxy_set_header` 是**整組繼承**的。`server` 層設了五個 `proxy_set_header`，某個 `location` 裡只要寫了**任何一個** `proxy_set_header`，這個 location 就不再繼承 server 層的那五個。`add_header` 也是同樣的規則。共用的標頭可以放在一個檔案裡，在每個 location `include`。

WebSocket 需要把升級請求轉過去：

```nginx
# 放在 http 區塊：有 Upgrade 標頭時 Connection 設成 upgrade，否則 close
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

location /ws/ {
    proxy_pass http://api_backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host       $host;
    proxy_read_timeout 1h;      # 長連線：兩次訊息之間可能很久沒有資料
}
```

## upstream 與負載平衡

開頭的第三個問題——部署時只有一個後端、它重啟期間全部 502——要靠多個後端加上逐一更新。`upstream` 定義一組後端：

```nginx
upstream api_backend {
    least_conn;                                        # 預設是 round-robin；請求時間差很多時用最少連線
    server 10.0.1.11:8000 max_fails=3 fail_timeout=10s;
    server 10.0.1.12:8000 max_fails=3 fail_timeout=10s;
    server 10.0.1.13:8000 backup;                      # 其他都不可用時才用
    keepalive 32;                                      # 每個 worker 對後端保留的閒置連線數
}
```

- **被動健康檢查**：在 `fail_timeout` 時間內失敗 `max_fails` 次（預設 1 次、10 秒），這台就被暫停 `fail_timeout` 那麼久。開源版沒有主動定期檢查。
- **自動重試**：`proxy_next_upstream` 預設是 `error timeout`，連線失敗或逾時會改送下一台。POST 這類非冪等的請求，如果已經送出給後端，預設**不會**重試（避免重複下單）。
- **部署時**：一次只更新一台，先讓它不接新請求、等進行中的完成再停（優雅關機見 [應用伺服器與程序管理](#/skill/process-servers)）。

演算法、sticky session、L4 與 L7 的差別見 [負載平衡](#/skill/load-balancing)。

## 逾時

| 指令 | 預設 | 量的是什麼 |
|---|---|---|
| `proxy_connect_timeout` | 60s | 和後端建立連線的時間；同網段的後端通常設幾秒就夠 |
| `proxy_send_timeout` | 60s | 送請求給後端時，**兩次成功寫入之間**的間隔 |
| `proxy_read_timeout` | 60s | 讀後端回應時，**兩次成功讀取之間**的間隔，不是整個回應的總時間 |
| `client_body_timeout` | 60s | 讀客戶端請求本體時，兩次讀取之間的間隔 |
| `keepalive_timeout` | 75s | 客戶端閒置連線保留多久 |

逾時要整條鏈一起看：最外層（雲端負載平衡器、CDN）的逾時 ≥ nginx 的 `proxy_read_timeout` ≥ 應用程式的請求逾時 ≥ 資料庫的 `statement_timeout`。內層先放棄，外層才收得到有意義的錯誤；反過來，nginx 先逾時回 504，後端其實還在做，做完了也沒人收。需要長時間處理的工作改成非同步（回 202、背景處理、輪詢結果），而不是把 `proxy_read_timeout` 一路調大。

## 靜態檔與 SPA

nginx 直接給靜態檔，不經過 Python：

```nginx
root /var/www/shop;                         # SPA 建置輸出的目錄

location /assets/ {                         # 檔名含雜湊（app.3f9c2a.js），內容不會變
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri =404;
}

location / {
    try_files $uri $uri/ /index.html;       # 找不到檔案就回 index.html，交給前端路由
}
```

`root` 與 `alias` 的差別：

- `location /static/ { root /var/www; }`：`/static/a.css` → `/var/www/static/a.css`（root 加上完整路徑）
- `location /static/ { alias /var/www/assets/; }`：`/static/a.css` → `/var/www/assets/a.css`（location 那段被換成 alias）

`alias` 的結尾斜線要和 location 一致。`location /static { alias /var/www/assets/; }` 這種不一致的寫法，可能讓 `/static../` 這類路徑跳到上一層目錄，是一個已知的設定漏洞樣式。

## TLS 終結與 HTTP 轉 HTTPS

nginx 在最前面處理 TLS，內網用 HTTP 連後端：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name shop.example.com;

    location /.well-known/acme-challenge/ {    # 讓憑證自動續約的 HTTP 驗證走得通
        root /var/www/acme;
    }
    location / {
        return 301 https://$host$request_uri;  # 其他一律轉 HTTPS，保留路徑與查詢字串
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;                                  # nginx 1.25.1 起的寫法；更舊的版本寫成 listen 443 ssl http2
    server_name shop.example.com;

    ssl_certificate     /etc/letsencrypt/live/shop.example.com/fullchain.pem;   # 要含中繼憑證
    ssl_certificate_key /etc/letsencrypt/live/shop.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    add_header Strict-Transport-Security "max-age=31536000" always;   # HSTS：瀏覽器之後直接用 HTTPS

    client_max_body_size 20m;                  # 預設 1m；超過回 413

    # ...上面的 location /api/、/assets/、/ ...
}
```

`ssl_certificate` 要指向**含中繼憑證的完整鏈**（`fullchain.pem`），只放伺服器憑證時，部分客戶端會驗證失敗。憑證的申請與續約見 [HTTPS 憑證：要買哪種、怎麼續](#/skill/https-certificates)。HSTS 一旦送出，瀏覽器在 `max-age` 內都不會再用 HTTP 連這個網域，確定全站都能走 HTTPS 再開。

`client_max_body_size` 解決開頭的第二個問題。它可以設在 `http`、`server` 或 `location`，例如整站維持較小的值，只在上傳的 location 放大。上傳檔案更好的做法是讓瀏覽器直傳物件儲存，見 [物件儲存：檔案不要放在應用程式主機上](#/skill/object-storage)。

## 502 與 504：從 error log 找原因

用戶端看到 502 / 504 時，回應是 nginx 產生的。原因寫在 error log（常見位置 `/var/log/nginx/error.log`；容器裡的官方映像把它導向 stderr，用 `docker logs` 看）：

| error log 片段 | 狀態碼 | 原因 | 修法 |
|---|---|---|---|
| `connect() failed (111: Connection refused) while connecting to upstream` | 502 | 後端沒在聽：沒啟動、重啟中、埠錯、只聽 `127.0.0.1` 而 nginx 在另一個容器 | 從 **nginx 所在的位置** `curl` 後端位址；看後端的 log |
| `connect() to unix:/run/app.sock failed (13: Permission denied)` | 502 | nginx 的 worker 使用者沒有權限開那個 socket 檔 | 調整 socket 檔或所在目錄的權限與群組 |
| `upstream prematurely closed connection while reading response header from upstream` | 502 | 後端在回應前斷線：worker 崩潰、被 OOM 殺掉、被應用伺服器的逾時砍掉 | 看後端同一時間的 log（如 gunicorn 的 `WORKER TIMEOUT`） |
| `upstream sent too big header while reading response header from upstream` | 502 | 回應標頭（常見是很大的 cookie）超過緩衝區 | 調大 `proxy_buffer_size`，或縮小標頭 |
| `no live upstreams while connecting to upstream` | 502 | upstream 裡每一台都被標成失敗 | 先查是不是共用的依賴（資料庫）掛了 |
| `upstream timed out (110: Connection timed out) while reading response header from upstream` | 504 | 後端在 `proxy_read_timeout` 內沒回應 | 找慢的原因（慢查詢、外部 API），不要只調大逾時 |
| `upstream timed out (110: Connection timed out) while connecting to upstream` | 504 | 連線建立不起來，封包可能被防火牆丟掉 | 查防火牆、安全群組、路由，見 [網路通不通：從 DNS 到防火牆](#/skill/network-troubleshooting) |

在 Docker / compose 裡還有一個特有的情況：nginx 在**啟動或重新載入時**才把 `proxy_pass` 與 `upstream` 裡的主機名稱解析成 IP，之後一直用那個 IP。

- 啟動時後端容器還不存在：nginx 直接起不來，`[emerg] host not found in upstream "api" in /etc/nginx/conf.d/default.conf:12`。
- 後端容器重建、換了 IP：nginx 還在連舊 IP，持續 502，直到 reload。

處理方式是重建後端後 reload nginx；或在 `proxy_pass` 裡用變數，並用 `resolver 127.0.0.11 valid=10s;` 指定 Docker 內建的 DNS，讓 nginx 在執行時重新解析（用變數時，前面講的 URI 改寫規則也會不同，要另外測試）。較新的 nginx 版本在 `upstream` 的 `server` 上也提供 `resolve` 參數，可用與否以你使用的版本文件為準。

其他設定錯誤，`nginx -t` 就會擋下：

```text
nginx: [emerg] unknown directive "proxy_passs" in /etc/nginx/conf.d/shop.conf:18
nginx: [warn] conflicting server name "shop.example.com" on 0.0.0.0:80, ignored
nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)
```

第二行是兩個 `server` 區塊用了同一個名字和埠，後面那個會被忽略；第三行是 80 埠已經有其他程式在聽（常見是另一個 nginx 或 Apache）。

## 動手

1. 開 [NginxLab](#/lab/NginxLab)，切換不同的請求路徑，對照哪一個 `location` 被選中；打開「app2 掛了」看請求怎麼被分配到其他後端，再打開「TLS 終結」看哪一段是 HTTPS。
2. 在 Playground 開啟 location 比對那段，把 `("^~", "/static/")` 改成 `("", "/static/")`，看 `/static/app.css` 改由誰處理；再加一個 `("^~", "/api/")` 看 `/api/avatar.png` 的結果。
3. 在 proxy_pass 那段加入 `("/api/", "http://app:8000/api/")`，預測結果再執行。
4. 用 compose 起 nginx + 兩個 api 副本，故意停掉其中一個，看 error log 與回應；再把 `client_max_body_size` 設成 `10k`，上傳一個檔案看 413 與 log 的對應。

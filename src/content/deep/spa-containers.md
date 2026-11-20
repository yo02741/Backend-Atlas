## 從一個具體狀況開始：一個 nginx，站在前端與後端前面

門診掛號系統的前端是 Vue 3 + Vite，後端是 Flask，用 gunicorn 跑在 9696。部署方式是 Docker：最前面一個 nginx 容器，設定如下（`backend` 是後端容器的名稱）：

```nginx
upstream backend {
    server backend:9696;
    keepalive 16;
    keepalive_timeout 60s;        # gunicorn 的 --keep-alive 設 75，刻意比這裡長
}

server {
    listen 80;

    location / {
        root /etc/nginx/html;
        index index.html;
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache, no-store, must-revalidate" always;
    }

    location /api {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```text
瀏覽器 ──▶ nginx 容器 :80
             ├─ /      自己送 /etc/nginx/html 裡的檔案（npm run build 產出的 dist）
             └─ /api   轉給 gunicorn :9696（Flask）
```

nginx 算前端還是後端？它是整個系統的入口，兩邊的事都在它身上：`/` 那一段是前端的交付物，dist 換版、快取規則跟著前端改；`/api` 那一段是路由，後端加路徑、調逾時，這裡也要改。搬上 Kubernetes 時要決定的，是這兩個角色要不要拆開。

這份設定能用，但有三個問題：

1. **`no-store` 套在整個 `/`。** 帶 hash 的 `assets/index-3f9c2a1b.js` 也跟著不准存，每次開頁都重新下載全部的 JS 與 CSS。院內的櫃台電腦一天開幾十次掛號頁，每次都是一兩 MB。
2. **dist 怎麼進到容器裡說不清楚。** 可能是建置映像時 COPY 進去的，也可能是啟動時用 volume 掛進去的。使用者回報「畫面跟測試環境不一樣」時，查不出這台跑的是哪一版前端。
3. **搬上 K8s 時不知道 nginx 該放哪。** 叢集的入口已經有 Ingress 或 Gateway，nginx 要留著當第二層入口，還是只負責送靜態檔？

nginx 本身的 `location` 比對、`proxy_pass` 的斜線、upstream 與 502/504 在 [nginx：反向代理、靜態檔與 TLS](#/skill/nginx) 講過；這一課從這份設定出發，依序處理前端檔案怎麼進映像、快取標頭、執行期設定，再講搬上 K8s 的兩條路。

## 前端檔案怎麼進 nginx：建置時打包，還是執行時掛載

先確認現在是哪一種。`docker inspect` 列出容器的掛載點：

```bash
$ docker inspect clinic-nginx --format '{{json .Mounts}}'
[{"Type":"bind","Source":"/srv/clinic/dist","Destination":"/etc/nginx/html","Mode":"ro",...}]
```

有一筆 `Destination` 是 `/etc/nginx/html` 的 bind mount，代表是執行時掛載：映像裡只有 nginx，前端檔案在主機的 `/srv/clinic/dist`。輸出是 `[]`，dist 是建置時打包進映像的。

| | 建置時 COPY 進映像 | 執行時用 volume 掛載 |
|---|---|---|
| 一個映像代表什麼 | 一個完整的前端版本：nginx 設定加上 dist | 只有 nginx；前端版本取決於主機上那個目錄 |
| 查目前跑哪一版 | 看映像的 tag（commit SHA） | 要登入主機看目錄內容，每台可能不同 |
| 回滾 | 換回上一個 tag | 要找到上一版的 dist 再放回去 |
| 在 K8s 上 | 一般的 Deployment 就能跑，Pod 排到哪個節點都一樣 | 要把檔案放進每個節點能存取的 volume，見 [Kubernetes 儲存](#/skill/k8s-storage) |
| 更新前端 | 重建映像、滾動更新 | 換目錄內容，nginx 不用重啟，但沒有版本紀錄 |

建議用建置時打包。前端的 dist 只是靜態檔，和 nginx 設定一起變成一個不可變的映像，就套得上 [環境設定與 12-factor](#/skill/config-12factor) 的「建置、發布、執行分開」：同一個映像從測試推到正式，環境的差別交給下一節的執行期設定。

### 多階段 Dockerfile

```dockerfile
# ---- build：照 lock 檔裝依賴、建置 ----
FROM node:24-alpine AS build
WORKDIR /app
# 先只複製 package.json 與 lock 檔：原始碼改了，npm ci 這一層還能用快取
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG GIT_SHA=unknown
# 建置後多寫一個 version.json，之後 curl /version.json 就知道跑的是哪一版
RUN npm run build \
 && printf '{"commit":"%s"}\n' "$GIT_SHA" > dist/version.json

# ---- runtime：只有 nginx、設定與 dist ----
FROM nginx/nginx-unprivileged:1.30-alpine
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
```

```bash
docker build --build-arg GIT_SHA=3f9c2a1b -t registry.gitlab.example/clinic/web:3f9c2a1b .
```

幾個細節：

- **用 `npm ci`**：`npm ci` 完全照 `package-lock.json` 安裝，lock 檔與 `package.json` 對不上時直接失敗；`npm install` 可能順手更新 lock 檔，同一個 commit 兩次建置裝到不同版本。
- **最後一個階段只拿 `dist`**：node、`node_modules`、原始碼都留在 build 階段，最終映像只有 nginx 與幾 MB 的靜態檔。多階段建置的原理見 [幫 Python 專案寫好 Dockerfile](#/skill/dockerfile-python)。
- **COPY 的目的地要和 `root` 一致**：官方映像預設的 root 是 `/usr/share/nginx/html`；原本設定裡的 `/etc/nginx/html` 也可以，只要 `COPY --from=build` 的目的地和 `default.conf` 的 `root` 寫同一個路徑。
- **base image 釘版本**：`node:24-alpine` 釘大版本，`1.30-alpine` 是 nginx 的穩定版分支（2026 年 11 月時 Docker Hub 上的穩定版是 1.30.x、主線版是 1.31.x）。要每次建置都完全一樣，改釘 digest，見 [Docker 基礎](#/skill/docker-basics)。

`.dockerignore`：

```text
node_modules
dist
.git
coverage
*.log
.env.local
.env.*.local
```

`node_modules` 一定要排除。Vite 的打包工具帶有依作業系統編譯的原生套件，開發機（macOS 或 Windows）裝的那一份被 `COPY . .` 蓋進 Linux 容器，建置時會找不到對應平台的模組。`dist` 排除是為了不讓本機舊的建置結果混進去。Vite 會讀 `.env` 與 `.env.production`，這兩個檔可以留；`.local` 結尾的是個人本機設定，不進映像。

### 以非 root 執行

官方的 `nginx` 映像由 root 啟動 master 行程、聽 80，pid 檔與暫存目錄也放在只有 root 能寫的位置。要以非 root 執行有兩種做法：

| 做法 | 內容 |
|---|---|
| 改用 `nginx/nginx-unprivileged` | NGINX 官方維護的變體：預設聽 8080、以 UID 101 執行、pid 檔與 `*_temp_path` 都改到 `/tmp`。Docker Hub 上舊的名稱是 `nginxinc/nginx-unprivileged`，1.30.6（穩定版）、1.31.7（主線版）起的版本放在 `nginx/nginx-unprivileged`，也有 GHCR 與 Amazon ECR 的鏡像 |
| 官方映像自己改 | `listen` 改成 1024 以上的 port、`pid` 改到 `/tmp/nginx.pid`、`*_temp_path` 改到可寫的目錄，再用 `USER` 切到非 root。Docker Hub 的官方映像說明列了要改的指令 |

上面的 Dockerfile 用第一種，所以 `default.conf` 要寫 `listen 8080;`。把原本 `listen 80;` 的設定直接搬過去，在不允許非 root 綁低 port 的環境，nginx 會啟動失敗並印出 `bind() to 0.0.0.0:80 failed (13: Permission denied)`。

## 快取：index.html 每次驗證，帶 hash 的檔案存一年

Vite 建置出的 JS、CSS 都在 `dist/assets/` 底下，檔名帶內容的 hash（`index-3f9c2a1b.js`）。內容一改，檔名就變，所以同一個檔名可以放心存很久。`index.html` 檔名固定，又決定了要載入哪些 assets，它要每次向伺服器確認。兩種回應的設定與理由在 [HTTP 快取](#/skill/http-caching) 講過，這裡只寫 nginx 的做法：

```nginx
server {
    listen 8080;
    root /usr/share/nginx/html;

    # 入口：可以存，但每次都要確認；沒變就回 304，新版部署後下一次載入就拿到
    location = /index.html {
        add_header Cache-Control "no-cache" always;
    }

    # 帶 hash 的檔案：一年內不用再問
    location /assets/ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    # 執行期設定（下一節）：內容會換、檔名不變，跟 index.html 一樣
    location = /config.js {
        add_header Cache-Control "no-cache" always;
    }

    location /api/ {
        # ...轉給後端，跟原本一樣；API 的快取由後端的回應標頭決定
    }

    # 其他路徑：有檔案就送檔案（favicon.ico、version.json），沒有就交給前端路由
    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache" always;
    }
}
```

兩個行為要知道：

- **深層連結也會拿到 `no-cache`。** 使用者直接開 `/patients/123`，`location /` 的 `try_files` 找不到這個檔案，最後一個參數 `/index.html` 是一次內部轉址：nginx 用新的路徑重新選 location，選到 `location = /index.html`，所以回應帶的是那一段的標頭。
- **`/assets/` 底下找不到檔案要回 404。** 原本的設定裡，不存在的 `/assets/Billing-77aa1c2e.js` 也會被 `try_files` 換成 `index.html`，回 200、`Content-Type: text/html`，瀏覽器拒絕把它當成 JS 執行。`try_files $uri =404;` 把這件事寫明，也避免日後有人在這裡加上 `/index.html` 的 fallback，讓一份 HTML 以一年的快取存在 `.js` 的網址下。

nginx 對靜態檔預設會送 `ETag` 與 `Last-Modified`，`no-cache` 的檔案在第二次載入時由瀏覽器帶條件請求，沒變回 304，只傳標頭。

### add_header 在巢狀層級不繼承

原本的設定只有一個 location 寫了 `add_header`，所以沒踩到這個陷阱。拆成好幾個 location 之後，很容易寫出這種設定：

```nginx
server {
    add_header X-Content-Type-Options "nosniff" always;    # 想套到整個站

    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        # 這一層有自己的 add_header：上面那個 nosniff 不會出現在 /assets/ 的回應裡
    }
}
```

nginx 的規則是：**只有在目前這一層完全沒有 `add_header` 時**，才繼承上一層的 `add_header`；這一層只要寫了一個，上一層的就全部不算。`proxy_set_header` 也是同樣的規則。處理方式：

- 每個有 `add_header` 的 location 把共用的標頭再寫一次，或把共用的標頭放在一個檔案裡，在每個 location `include` 進來。
- nginx 1.29.3 起有 `add_header_inherit` 指令，`add_header_inherit merge;` 讓下層除了自己的 `add_header`，也保留上一層的（1.30 穩定版已包含）。更舊的版本 `nginx -t` 會報 `unknown directive "add_header_inherit"`，用之前確認映像的 nginx 版本。

另外，沒有加 `always` 的 `add_header` 只會出現在 200、201、204、206、301、302、303、304、307、308 的回應上，404 與 5xx 不會帶。

### 第二次開頁要下載多少

下面的模擬照 nginx 的規則選 location、套用 `add_header` 的繼承規則，再依 `Cache-Control` 決定瀏覽器第二次開頁時哪些檔案不用問、哪些拿到 304、哪些要整個重新下載。檔案大小是示意數字：

```python run
# 兩份 nginx 設定，同一組 dist。location 依 nginx 的規則選：先找 = 精確比對，再找最長前綴。
# add_header 只有在「這一層自己沒有任何 add_header」時，才繼承上一層（server）的。
NOSNIFF = ("X-Content-Type-Options", "nosniff")

ORIGINAL = {                     # 現在的設定：整個 / 都 no-store
    "server": [],
    "locations": [
        ("prefix", "/", "spa", [("Cache-Control", "no-cache, no-store, must-revalidate")]),
        ("prefix", "/api", "proxy", []),
    ],
}
FIXED = {                        # 修正後：index.html 每次驗證、/assets/ 存一年
    "server": [NOSNIFF],
    "locations": [
        ("exact", "/index.html", "file", [("Cache-Control", "no-cache"), NOSNIFF]),
        ("exact", "/config.js", "file", [("Cache-Control", "no-cache"), NOSNIFF]),
        ("prefix", "/assets/", "file", [("Cache-Control", "public, max-age=31536000, immutable"), NOSNIFF]),
        ("prefix", "/api/", "proxy", []),
        ("prefix", "/", "spa", [("Cache-Control", "no-cache"), NOSNIFF]),
    ],
}

# 示意的檔案：路徑 -> (KB，壓縮後的傳輸量；內容版本，相當於 ETag)
V1 = {"/index.html": (1.2, "v1"), "/config.js": (0.2, "c1"), "/favicon.ico": (4, "f1"),
      "/assets/index-3f9c2a1b.js": (480, "a"), "/assets/vendor-8d1e7f40.js": (620, "b"),
      "/assets/index-5b2e9c11.css": (60, "c")}
# v2 只改了業務程式：index.html 換了內容、index 的 hash 變了；vendor 與 css 沒變，檔名也沒變
V2 = {k: v for k, v in V1.items() if k != "/assets/index-3f9c2a1b.js"}
V2.update({"/index.html": (1.2, "v2"), "/assets/index-a1b2c3d4.js": (482, "d")})

def page(dist):                  # 開一次 /patients/123 會發出的請求
    return ["/patients/123", "/config.js", "/favicon.ico"] + sorted(k for k in dist if k.startswith("/assets/"))

def choose(conf, uri):
    for kind, path, action, hdrs in conf["locations"]:
        if kind == "exact" and uri == path:
            return path, action, hdrs
    hits = [(p, a, h) for k, p, a, h in conf["locations"] if k == "prefix" and uri.startswith(p)]
    return max(hits, key=lambda x: len(x[0]))

def serve(conf, dist, uri):
    """回傳 (實際送出的檔案, 回應標頭, 處理它的 location)"""
    path, action, hdrs = choose(conf, uri)
    if action == "spa" and uri not in dist:          # try_files 找不到檔案：內部轉到 /index.html，重新選 location
        return serve(conf, dist, "/index.html")
    headers = dict(hdrs or conf["server"])          # 這一層有 add_header，就只用自己的
    return uri, headers, path

VERSIONS = {"v1": V1, "v2": V2}             # index.html 的版本 → 它引用的那一組 assets

def fetch(conf, dist, cache, uri):
    """回傳 (下載的 KB, 有沒有發出請求, 瀏覽器最後用的內容版本)"""
    file, headers, _ = serve(conf, dist, uri)
    cc = headers.get("Cache-Control", "")
    fresh = "max-age=" in cc and "no-cache" not in cc and "no-store" not in cc
    if uri in cache and fresh:                  # 還在新鮮期：不發請求，直接用存著的
        return 0, False, cache[uri]
    if file not in dist:
        return 0, True, None                    # 404
    size, version = dist[file]
    if cache.get(uri) == version:               # 條件請求，內容沒變回 304，不傳 body
        return 0, True, version
    if "no-store" not in cc:
        cache[uri] = version
    return size, True, version                  # 200：整個檔案下載

def visit(conf, dist, cache):
    kb, sent, used = fetch(conf, dist, cache, "/patients/123")
    reqs = int(sent)
    assets = sorted(k for k in VERSIONS[used] if k.startswith("/assets/"))   # 舊的 index.html 會去要舊的 assets
    for uri in ["/config.js", "/favicon.ico"] + assets:
        size, sent, _ = fetch(conf, dist, cache, uri)
        kb, reqs = kb + size, reqs + int(sent)
    return kb, reqs, used != dist["/index.html"][1]

for name, conf in [("原本的設定", ORIGINAL), ("修正後", FIXED)]:
    print(f"== {name}")
    for uri in page(V1) + ["/api/patients"]:
        file, headers, loc = serve(conf, V1, uri)
        if loc.startswith("/api"):
            print(f"  {uri:<27} location {loc:<12} 轉給後端，Cache-Control 由後端決定")
            continue
        cc = headers.get("Cache-Control", "（沒有）")
        sniff = "nosniff" if NOSNIFF in headers.items() else "沒有 nosniff"
        sent = "" if file == uri else f"（送 {file}）"
        print(f"  {uri:<27} location {loc:<12} {cc}；{sniff}{sent}")
    cache = {}
    for title, dist in [("第一次開頁", V1), ("第二次開頁", V1), ("部署 v2 之後第一次開頁", V2)]:
        kb, reqs, stale = visit(conf, dist, cache)
        note = "；用的是快取裡的舊 index.html，畫面還是舊版" if stale else ""
        print(f"  {title}：發出 {reqs} 個請求，下載 {kb:,.1f} KB{note}")
    print()
```

原本的設定每次開頁都是 1.1 MB 左右；修正後第二次開頁只剩三個條件請求、沒有 body。部署 v2 之後，`index.html` 的 ETag 變了，拿到新內容，引用的 `index-a1b2c3d4.js` 是新網址所以下載，`vendor` 與 CSS 的檔名沒變，直接用快取。`/patients/123` 那一列顯示內部轉址後實際送出的是 `/index.html`。

:::stop 停靠點 1：只送靜態檔的前端映像。完成條件：`curl -sI` 打 `/patients/123` 與 `/assets/<檔名>` 分別得到 `no-cache` 與 `immutable`，`/assets/not-exist.js` 回 404，每個回應都帶 `X-Content-Type-Options`。換環境就要重建映像時，再往下讀執行期設定。

## 建置時設定與執行期設定

前端程式裡常見這種寫法：

```js
// src/auth.js
const SSO_URL = import.meta.env.VITE_SSO_URL
```

Vite 只把 `VITE_` 開頭的變數暴露給前端程式，而且在 `npm run build` 時把 `import.meta.env.VITE_SSO_URL` **直接換成字串**寫進 bundle：

```bash
$ VITE_SSO_URL=https://sso-test.example/authorize npm run build
$ grep -o 'https://sso[^"]*' dist/assets/index-*.js
https://sso-test.example/authorize
```

這個值在映像建好的那一刻就固定了。測試環境驗證過的映像推到正式環境，前端還是導向測試的 SSO；要改，只能用正式環境的值重建一次，於是「正式環境跑的映像」不再是「測試過的那一個」。

執行期設定的做法：環境之間不同的值不進 bundle，由 nginx 送一個 `/config.js`，前端啟動時讀它。

```html
<!-- index.html：放在 module script 前面。一般的 script 會同步執行，main.js 跑的時候設定已經在了 -->
<script src="/config.js"></script>
<script type="module" src="/src/main.js"></script>
```

```js
// public/config.js：開發時用的預設值。Vite 會原樣複製到 dist/config.js
window.__CLINIC_CONFIG__ = {
  envName: "開發",
  ssoUrl: "http://localhost:5174/authorize",
  apiBase: "/api",
}
```

```js
// src/runtime-config.js：程式裡只從這裡拿設定
const cfg = window.__CLINIC_CONFIG__ || {}
export const ENV_NAME = cfg.envName || "開發"
export const SSO_URL = cfg.ssoUrl
export const API_BASE = cfg.apiBase || "/api"
```

在 K8s 上，`config.js` 的內容放在 ConfigMap，每個環境一份，以目錄的形式掛進 nginx 容器，nginx 從那裡送出：

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: clinic-web-config
  namespace: clinic
data:
  config.js: |
    window.__CLINIC_CONFIG__ = {
      envName: "正式",
      ssoUrl: "https://sso.example/authorize",
      apiBase: "/api",
    };
```

```nginx
location = /config.js {
    alias /etc/clinic-web/config.js;            # ConfigMap 掛在 /etc/clinic-web/（Deployment 在下一節）
    add_header Cache-Control "no-cache" always;
}
```

掛成整個目錄、不用 `subPath`，ConfigMap 更新後檔案內容過一段時間會跟著換，nginx 下一次送出新內容，不必重建映像也不必重啟 Pod；已經開著的頁面要重新整理才讀得到。用 `subPath` 把單一檔案掛進 `/usr/share/nginx/html/` 的寫法不會更新，見 [Kubernetes 實作：設定、探針與資源](#/skill/k8s-config-probes)。

另一種做法是官方 nginx 映像（1.19 起，unprivileged 版也有）的 templates 機制：容器啟動時，`/etc/nginx/templates/*.template` 會經過 `envsubst` 產生到 `/etc/nginx/conf.d/`，值來自環境變數，環境變數再由 ConfigMap 的 `envFrom` 注入：

```nginx
# /etc/nginx/templates/default.conf.template（啟動時產生 /etc/nginx/conf.d/default.conf）
location = /config.js {
    default_type application/javascript;
    add_header Cache-Control "no-cache" always;
    return 200 'window.__CLINIC_CONFIG__ = { envName: "${CLINIC_ENV_NAME}", ssoUrl: "${CLINIC_SSO_URL}", apiBase: "/api" };';
}
```

映像的啟動腳本只替換**目前有定義的**環境變數，所以同一個檔案裡的 `$uri`、`$host` 這些 nginx 變數不受影響（除非剛好有同名的環境變數；`NGINX_ENVSUBST_FILTER` 可以限定只替換符合樣式的名稱）。

| | ConfigMap 掛成檔案 | templates 加環境變數 |
|---|---|---|
| 改值之後 | 檔案自動更新，nginx 不用重啟 | 環境變數只在啟動時讀，要 `kubectl rollout restart` |
| 漏了一個值 | 前端讀到 `undefined`，要靠程式檢查 | 沒被替換的 `${CLINIC_SSO_URL}` 留在設定裡，nginx 會把它當成未知變數、啟動失敗 |
| 根檔案系統唯讀 | 沒影響 | 產生設定的輸出目錄要可寫，要另外掛 emptyDir |
| 適合 | 值比較多、要整段 JS | 只有幾個值，想在啟動時就擋下漏設定 |

`config.js` 是公開檔案，任何打開網頁的人都讀得到，它跟 bundle 一樣不能放秘密：資料庫密碼、API 金鑰、OAuth 的 client secret 都不行。前端需要呼叫的外部服務，由後端代為呼叫，秘密留在後端，見 [秘密管理](#/skill/secrets)。

:::stop 停靠點 2：同一個映像跑兩個環境。完成條件：兩個環境的映像 digest 相同、`/config.js` 內容不同，`grep` `dist/` 找不到任何一個環境的網址。要把 `/api` 搬上 Kubernetes 時，再往下讀兩條路。

## 搬上 Kubernetes：兩條路

叢集的入口已經是 Gateway（或 Ingress），nginx 有兩種放法：

```text
第一條路：保留 nginx 當入口
  瀏覽器 ─▶ Gateway ─▶ Service clinic-web ─▶ nginx Pod ─┬─ /      靜態檔
                                                        └─ /api   ─▶ Service clinic-api ─▶ gunicorn Pod

第二條路：由 Gateway 依路徑分流
  瀏覽器 ─▶ Gateway ─┬─ /     ─▶ Service clinic-web ─▶ nginx Pod（只送靜態檔）
                     └─ /api  ─▶ Service clinic-api ─▶ gunicorn Pod
```

| | 第一條路：保留 nginx 當入口 | 第二條路：Gateway 依路徑分流 |
|---|---|---|
| nginx 設定 | 幾乎不動，upstream 改成 Service 名稱 | 拿掉 `/api`，只剩靜態檔與快取 |
| 同源 | 跟現在一樣，`/api` 與頁面同源，不用 CORS | 同一個 hostname，也是同源；把 API 拆到另一個網域才需要 CORS |
| 一個 `/api` 請求經過 | Gateway、nginx、gunicorn，多一跳 | Gateway、gunicorn |
| 路由規則 | HTTPRoute 與 nginx 兩層，要一起改 | 只有 HTTPRoute |
| 前端與後端分開更新、擴展 | `/api` 的轉發寫在前端的映像裡，後端加一段路徑可能要重建前端 | 各自獨立 |
| 逾時、上傳大小、轉發標頭 | 兩層都要設，以較嚴的那層為準 | 設在 Gateway（各實作的 policy） |
| NetworkPolicy | 放行 web 到 api | 放行 Gateway 的代理 Pod 到 api |
| 適合 | 先求搬上去，設定少改 | 團隊能維護 HTTPRoute，前後端由不同人負責 |

這一課照現有的系統用 9696。實作路線的 `clinic-api` 聽 8000、Service 是 80 對到 8000，換成那組數字接法一樣。

### 兩條路共用的部分

`clinic-web` 的 Deployment 與 Service，兩條路都一樣：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: clinic-web
  namespace: clinic
spec:
  replicas: 2
  selector:
    matchLabels:
      app: clinic-web
  strategy:
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: clinic-web
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 101                 # nginx-unprivileged 的 UID
      containers:
        - name: web
          image: registry.gitlab.example/clinic/web:3f9c2a1b
          ports:
            - name: http
              containerPort: 8080
          readinessProbe:              # 只看 nginx 自己送得出靜態檔，不打 /api
            httpGet: { path: /index.html, port: http }
            periodSeconds: 5
          livenessProbe:
            httpGet: { path: /index.html, port: http }
            periodSeconds: 10
          resources:                   # 示意值
            requests: { cpu: 50m, memory: 32Mi }
            limits: { memory: 128Mi }
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
          volumeMounts:
            - name: runtime-config
              mountPath: /etc/clinic-web
              readOnly: true
            - name: tmp                # pid 檔與暫存檔在 /tmp
              mountPath: /tmp
      volumes:
        - name: runtime-config
          configMap:
            name: clinic-web-config
        - name: tmp
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: clinic-web
  namespace: clinic
spec:
  selector:
    app: clinic-web
  ports:
    - name: http
      port: 80
      targetPort: http
```

後端的 Service 把 port 也寫成 9696，nginx 的設定就只要換主機名稱：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: clinic-api
  namespace: clinic
spec:
  selector:
    app: clinic-api
  ports:
    - name: http
      port: 9696
      targetPort: 9696
```

nginx 的 `worker_processes auto` 依節點看得到的 CPU 數開 worker，不看 Pod 的 CPU limit；在 32 核的節點上會開出 32 個 worker，記憶體 limit 抓太緊就會被 OOMKilled。在映像裡帶自己的 `nginx.conf` 把它寫成固定的數字（例如 2），比較好估。

### 第一條路：保留 nginx 當入口

nginx 的設定要改三個地方：

```nginx
upstream backend {
    server clinic-api:9696;          # 原本是 backend:9696；同一個 namespace 用短名稱就解析得到
    keepalive 16;
    keepalive_timeout 60s;           # 照舊：比 gunicorn 的 --keep-alive 75 短
}

server {
    listen 8080;                     # unprivileged 映像
    root /usr/share/nginx/html;
    # ...index.html、/assets/、/config.js、/ 照上一節...

    location /api/ {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;   # TLS 在 Gateway 終止，$scheme 會是 http
    }
}
```

- **主機名稱換成 Service**：nginx 在啟動時用系統的 resolver 解析 `clinic-api`，`/etc/resolv.conf` 的搜尋網域會補成 `clinic-api.clinic.svc.cluster.local`，得到 Service 的 ClusterIP。ClusterIP 不會因為後端 Pod 重建而變，[nginx 那一課](#/skill/nginx) 講的「後端容器換了 IP、nginx 還連舊的」在這裡不會發生。啟動時 Service 還不存在，nginx 一樣起不來（`host not found in upstream`），Pod 會進入 CrashLoopBackOff，直到 Service 建好。改用 `resolver` 加變數做執行時解析的話，nginx 自己的 resolver 不套用搜尋網域，要寫完整名稱。
- **`X-Forwarded-Proto`**：原本 nginx 自己終止 TLS，`$scheme` 是 https；現在 TLS 在 Gateway，nginx 收到的是 http，要把 Gateway 帶來的值轉下去，否則 Flask 會以為請求是 http，產生錯的轉址網址。客戶端 IP 也一樣：`$remote_addr` 變成 Gateway 代理 Pod 的 IP，要記錄真實 IP 得用 realip 模組信任 Gateway 的位址，信任邊界的畫法見 [負載平衡](#/skill/load-balancing)。
- **`location /api/` 加上結尾斜線**：原本的 `/api` 也會比對到 `/api-docs`、`/apiary`，這些路徑會被送到後端。

Gateway 這一層只有一條規則，整個 hostname 都給 nginx。實作路線的 HTTPRoute 把 `clinic.example` 整個給了 `clinic-api`（那時還沒有前端），加上前端之後換成這份：

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: clinic
  namespace: clinic
spec:
  parentRefs:
    - name: clinic-gateway             # 實作路線的 Gateway
  hostnames: ["clinic.example"]
  rules:
    - matches:
        - path: { type: PathPrefix, value: / }
      backendRefs:
        - name: clinic-web
          port: 80
```

### 第二條路：由 Gateway 依路徑分流

nginx 的 `default.conf` 拿掉 `upstream` 與 `location /api/`，只剩靜態檔與快取。路由寫在 HTTPRoute：

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: clinic
  namespace: clinic
spec:
  parentRefs:
    - name: clinic-gateway
  hostnames: ["clinic.example"]
  rules:
    - matches:
        - path: { type: PathPrefix, value: /api }
      backendRefs:
        - name: clinic-api
          port: 9696
    - matches:
        - path: { type: PathPrefix, value: / }
      backendRefs:
        - name: clinic-web
          port: 80
```

兩條規則的順序不影響結果。Gateway API 規定的優先序是 `Exact` 先於 `PathPrefix`，`PathPrefix` 之間比字元數，長的優先，所以 `/api/patients` 由 `/api` 那條接走。`PathPrefix` 是一段一段比：`/api` 符合 `/api`、`/api/`、`/api/patients`，不符合 `/api-docs`，這點和 nginx 的字串前綴不同。

Flask 的路由本來就帶 `/api`（原本的 `proxy_pass http://backend;` 沒有 URI 部分，路徑原樣轉送），這份 HTTPRoute 也原樣轉送，不需要改寫。如果原本寫的是 `proxy_pass http://backend:9696/;`、後端路由沒有 `/api`，就要在 Gateway 這層去掉前綴：

```yaml
    - matches:
        - path: { type: PathPrefix, value: /api }
      filters:
        - type: URLRewrite
          urlRewrite:
            path:
              type: ReplacePrefixMatch
              replacePrefixMatch: /       # /api/patients → /patients
      backendRefs:
        - name: clinic-api
          port: 9696
```

去掉前綴的寫法依入口元件而不同：

| 入口 | 怎麼去掉 `/api` |
|---|---|
| Gateway API 的 HTTPRoute | `URLRewrite` filter 的 `ReplacePrefixMatch`。它屬於 Extended 支援等級，實作可以不支援；用 `kubectl describe httproute` 看 status 有沒有被接受 |
| Ingress（API 本身） | 沒有改寫的欄位，只能靠各 controller 自己的 annotation 或 CRD |
| ingress-nginx | `nginx.ingress.kubernetes.io/rewrite-target` 搭配 regex 路徑；這個專案已在 2026 年 3 月停止維護，新的建置不要再選 |
| 其他 Ingress controller | 各自的 annotation 或 middleware，以文件為準 |

叢集還在用 Ingress 的話，不改寫的分流寫成這樣，可以在不同 controller 之間搬（`pathType: Prefix` 一樣是一段一段比）：

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: clinic
  namespace: clinic
spec:
  ingressClassName: example-class      # 換成叢集實際的 IngressClass
  rules:
    - host: clinic.example
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend: { service: { name: clinic-api, port: { number: 9696 } } }
          - path: /
            pathType: Prefix
            backend: { service: { name: clinic-web, port: { number: 80 } } }
```

第二條路的 `/api` 由 Gateway 的代理 Pod 直接連到 `clinic-api`，不再經過 `clinic-web`。照 [Kubernetes 網路](#/skill/k8s-networking) 寫好的 NetworkPolicy 只放行 web 到 api，要再加一條：`from` 寫代理 Pod 所在的 namespace（Envoy Gateway 預設是 `envoy-gateway-system`，依安裝方式而定）。

### keep-alive：換了前面那一層，規則不變

原本把 gunicorn 的 `--keep-alive` 設得比 nginx upstream 的 `keepalive_timeout` 長，是為了讓 nginx 先關掉閒置連線。反過來的話，gunicorn 先關，nginx 剛好拿那條已經被關掉的連線送下一個請求，就會失敗。換到 K8s 之後，這條規則不變，要檢查的是「現在直接連 gunicorn 的是誰」：

| 前面那一層 | 對後端閒置連線的逾時 | 預設 |
|---|---|---|
| nginx（第一條路） | upstream 的 `keepalive_timeout`（1.15.3 起） | 60 秒 |
| Envoy Gateway（第二條路；實作路線用的實作） | BackendTrafficPolicy 的 `timeout.http.connectionIdleTimeout` | 1 小時 |
| 其他 Gateway 或 Ingress 實作 | 各自的設定 | 以文件為準 |

第一條路中間多了 Service，但 kube-proxy 做的是連線層級的轉送，nginx 的一條 keepalive 連線從頭到尾對到同一個 Pod，規則照舊。第二條路換成 Envoy，預設的 1 小時比 gunicorn 的 75 秒長得多，要把它調短：

```yaml
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: BackendTrafficPolicy
metadata:
  name: clinic-upstream
  namespace: clinic
spec:
  targetRefs:
    - group: gateway.networking.k8s.io
      kind: HTTPRoute
      name: clinic
  timeout:
    http:
      connectionIdleTimeout: 60s       # 比 gunicorn 的 --keep-alive 75 短
```

欄位名稱依 Envoy Gateway 的版本而定，以它的文件為準。另外兩件事：gunicorn 的 `--keep-alive` 預設只有 2 秒；sync worker 不支援持久連線、會忽略這個選項，每個回應後都關閉連線，所以這條規則在 gthread、gevent 這類 worker 上才有意義。連線層級的分配也代表後端擴容之後，新 Pod 要等前面那一層開新連線才分得到流量。

### 模擬：請求送到哪個 Service、後端收到什麼路徑

```python run
# 路徑分流：外面那一層（HTTPRoute）先選規則，再看 nginx 或 Flask 收到什麼路徑
def segments(path):
    return [s for s in path.split("?")[0].split("/") if s]

def path_prefix(prefix, path):         # Gateway API 的 PathPrefix 與 Ingress 的 Prefix：一段一段比
    p = segments(prefix)
    return segments(path)[:len(p)] == p

def replace_prefix(path, prefix, repl):   # URLRewrite 的 ReplacePrefixMatch
    route, _, query = path.partition("?")
    rest = route[len(prefix.rstrip("/")):]   # 比對到的前綴後面剩下的部分
    new = repl.rstrip("/") + rest or "/"
    return new + ("?" + query if query else "")

def gateway(rules, path):
    # 優先序：Exact 先，再來是字元數最多的 PathPrefix
    hits = [r for r in rules if (r["type"] == "Exact" and path.split("?")[0] == r["value"])
            or (r["type"] == "PathPrefix" and path_prefix(r["value"], path))]
    if not hits:
        return None, path
    best = max(hits, key=lambda r: (r["type"] == "Exact", len(r["value"])))
    sent = replace_prefix(path, best["value"], best["rewrite"]) if "rewrite" in best else path
    return best["backend"], sent

FLASK = {"/api/patients", "/api/health"}          # 後端的路由本來就有 /api 前綴
DIST = {"/index.html", "/assets/index-3f9c2a1b.js"}

def nginx(path, api_location):        # 第一條路的 nginx：location 用字串前綴比對
    if api_location and path.startswith(api_location):
        return "clinic-api", path       # proxy_pass 沒寫 URI 部分：路徑原樣轉送
    return "web", path

def finish(service, path):
    route = path.split("?")[0]
    if service == "clinic-api":
        return "Flask 200" if route in FLASK else "Flask 404"
    return f"送出 {route}" if route in DIST else "送出 /index.html（SPA）"

KEEP = [{"type": "PathPrefix", "value": "/", "backend": "clinic-web"}]
SPLIT = [{"type": "PathPrefix", "value": "/api", "backend": "clinic-api"},
         {"type": "PathPrefix", "value": "/", "backend": "clinic-web"}]
STRIP = [{"type": "PathPrefix", "value": "/api", "backend": "clinic-api", "rewrite": "/"},
         {"type": "PathPrefix", "value": "/", "backend": "clinic-web"}]

scenarios = [
    ("第一條路：HTTPRoute 全給 nginx，nginx 用 location /api/", KEEP, "/api/"),
    ("第一條路，但 nginx 沿用原本的 location /api（沒有結尾斜線）", KEEP, "/api"),
    ("第二條路：HTTPRoute 依路徑分流，不改寫", SPLIT, None),
    ("第二條路，/api 規則加上 ReplacePrefixMatch: /", STRIP, None),
]
requests = ["/patients/123", "/assets/index-3f9c2a1b.js", "/api/patients?page=2", "/api", "/api-docs/"]

for title, rules, api_location in scenarios:
    print(title)
    for req in requests:
        svc, sent = gateway(rules, req)
        hops = svc
        if svc == "clinic-web":
            svc, sent = nginx(sent, api_location)
            hops += " → clinic-api" if svc == "clinic-api" else ""
        print(f"  {req:<26} {hops} 收到 {sent}：{finish(svc, sent)}")
    print()
```

第二組是沿用原本 `location /api` 的結果：`/api-docs/` 被送到 Flask、回 404，同一個請求在第一組與第三組都回到前端。第四組是對一個路由本來就有 `/api` 的後端多做了改寫，每個 API 都 404。

:::stop 停靠點 3：`/api` 轉到後端。完成條件：`/api/healthz` 由後端回應、`/api-docs/` 回到前端，直接連後端的那一層閒置逾時比後端的 keep-alive 短。後面的子路徑部署、健康檢查與 chunk 404，在部署到子路徑或滾動更新後出現 404 時再回來讀。

## 其他實務

### 子路徑部署

系統要掛在 `https://portal.example/clinic/` 底下時，三個地方要對同一個前綴：

| 位置 | 設定 | 對不上的現象 |
|---|---|---|
| Vite | `base: '/clinic/'`；Vue Router 用 `createWebHistory(import.meta.env.BASE_URL)` | index.html 引用 `/assets/…`，被 Gateway 送去別的服務或 404 |
| nginx | dist 複製到 `/usr/share/nginx/html/clinic/`，location 改成 `/clinic/`、`/clinic/assets/`，fallback 改成 `/clinic/index.html` | 深層連結重新整理回 404，或拿到別的系統的首頁 |
| HTTPRoute 或 Ingress | `PathPrefix /clinic` 到 `clinic-web`，不改寫 | 前綴被去掉，nginx 收到的路徑和目錄對不上 |

建議整條路都不改寫路徑：瀏覽器、Gateway、nginx 看到的都是 `/clinic/…`，在本機用 port-forward 直接連 nginx 測試時，網址也和正式環境一樣。手寫在 index.html、不經過 Vite 打包的路徑（例如 `config.js` 的 script）要自己帶上前綴，建置後打開 `dist/index.html` 檢查一次。API 若放在 `/clinic/api`，HTTPRoute 那條規則用 `ReplacePrefixMatch: /api` 換回 Flask 認得的路徑。

### 前端的健康檢查

nginx 的探針打靜態檔就夠了。打 `/index.html` 同時確認了 nginx 在跑、dist 確實在映像裡（dist 漏了會回 404，Pod 不會變成 ready）。第一條路不要讓探針打 `/api/...`：後端一停，所有前端 Pod 都會被移出 Service，使用者連「系統維護中」的頁面都看不到，而且後端恢復前，滾動更新也會卡住。探針每幾秒打一次，access log 會很吵，可以在 nginx 用 `map` 依 User-Agent（`kube-probe/…`）關掉這些請求的 log。

### 滾動更新時的 chunk 404

Vite 把每個路由頁面拆成獨立的 chunk，點到才載入。滾動更新之後會出現這種事：

| 時間 | 事件 |
|---|---|
| 09:00 | 櫃台開著 v1 的掛號頁，已經載入 `index-3f9c2a1b.js`，還沒點過「批價」 |
| 09:05 | 部署 v2，滾動更新完成，每個 Pod 的映像裡只有 v2 的 assets |
| 09:20 | 點「批價」，瀏覽器要 v1 的 `/assets/Billing-77aa1c2e.js`，回 404，頁面卡住 |

滾動更新進行中還有另一個方向：瀏覽器從新 Pod 拿到 v2 的 `index.html`，接著要 v2 的 assets，這個請求被分到還沒換掉的舊 Pod，一樣 404。瀏覽器的 console 會出現類似 `Failed to fetch dynamically imported module: https://clinic.example/assets/Billing-77aa1c2e.js` 的錯誤（文字依瀏覽器而異）。原本的設定把找不到的 assets 換成 `index.html`，錯誤會變成 `Expected a JavaScript module script but the server responded with a MIME type of "text/html"` 這類訊息，更難聯想到是版本問題。

| 做法 | 處理到的情況 | 代價 |
|---|---|---|
| 接受重新整理：前端監聽 `vite:preloadError`，載入失敗就 `location.reload()` | 兩個方向都能恢復，重新整理後拿到新版 | 使用者填到一半的表單會不見；掛號、批價這類表單要先存草稿 |
| 映像裡保留上一版的 assets（建置時從上一版的映像複製 `assets/`） | 舊頁面要舊 chunk | 映像變大；滾動更新期間新頁面打到舊 Pod 仍會 404 |
| assets 放到所有 Pod 共用、只增不刪的位置（例如物件儲存），部署前先上傳，定期清掉幾版以前的 | 兩個方向都處理 | 多一套儲存與清理排程，見 [物件儲存](#/skill/object-storage) |

院內系統的部署多半排在離峰時段，第一種做法加上表單草稿通常就夠了。不管選哪一種，`index.html` 都要是 `no-cache`，否則瀏覽器會一直拿著舊的 `index.html` 去要舊的 chunk。

## 雲端代管的差異

| 項目 | 地端自建 | 雲端代管 |
|---|---|---|
| 靜態檔 | nginx 容器 | 也常直接放物件儲存加 CDN，不跑 nginx 容器；`/api` 由 CDN 或負載平衡器依路徑分流 |
| 入口 | Gateway 或 Ingress 的實作，對外靠 MetalLB 或院內的負載平衡設備（見 [Kubernetes 網路](#/skill/k8s-networking)） | controller 自動建立雲端的負載平衡器 |
| 閒置逾時 | 自己設定的那一層代理 | 雲端負載平衡器也有自己的閒置逾時（例如 AWS ALB 預設 60 秒），規則一樣：要比 gunicorn 的 keep-alive 短 |
| chunk 404 | 要自己選上面的做法 | assets 放在物件儲存時舊檔通常還在，問題少很多 |

## 常見錯誤與錯誤訊息

| 訊息或現象 | 原因 | 處理 |
|---|---|---|
| 每次開頁都重新下載全部 JS，Network 分頁看不到 `(disk cache)` | `no-store` 套到了 `/assets/` | index.html 用 `no-cache`，`/assets/` 用長效快取 |
| 部署後使用者一直看到舊版，重新整理才好 | `index.html` 被長效快取，或被 `/assets/` 那類設定套到 | `index.html`（包含 SPA fallback）要是 `no-cache` |
| 某個 location 的回應少了 `X-Content-Type-Options` 之類的安全標頭 | 那個 location 有自己的 `add_header`，不再繼承 server 層 | 每個 location 重寫一次、用 `include`，或 1.29.3 起的 `add_header_inherit merge` |
| `npm ci can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync` | lock 檔沒有跟著 `package.json` 更新 | 本機 `npm install` 更新 lock 檔並 commit |
| 建置時 `Cannot find module @rollup/rollup-linux-x64-musl` 這類訊息（套件名稱依 Vite 版本而異） | 開發機的 `node_modules` 被複製進容器 | `.dockerignore` 排除 `node_modules`，在容器裡 `npm ci` |
| 打開網站是 nginx 的歡迎頁，或 403 | dist 複製到的目錄和 `root` 不一致 | 讓 `COPY --from=build` 的目的地等於 `root` |
| `bind() to 0.0.0.0:80 failed (13: Permission denied)` | 非 root 執行卻聽 80 | 聽 8080（unprivileged 映像的預設），Service 的 `targetPort` 跟著改 |
| `[emerg] host not found in upstream "clinic-api:9696"`，Pod CrashLoopBackOff | 第一條路的 nginx 啟動時解析不到 Service：還沒建立、名稱打錯、不在同一個 namespace | 先建 Service；跨 namespace 寫 `clinic-api.<namespace>` |
| Flask 產生的轉址變成 `http://`，或登入後被導回 http | 第一條路的 nginx 送 `X-Forwarded-Proto $scheme`，TLS 已經在 Gateway 終止 | 改成轉送 `$http_x_forwarded_proto` |
| 換成 Gateway 分流後，偶發 503：`upstream connect error or disconnect/reset before headers. reset reason: connection termination` | Gateway 對後端的閒置逾時（Envoy 預設 1 小時）比 gunicorn 的 keep-alive 長 | 調短 Gateway 的上游閒置逾時，讓它比 gunicorn 的短 |
| 分流後所有 API 都 404 | 後端的路由有 `/api`，Gateway 卻去掉了前綴；或反過來 | 對照後端的路由決定要不要 `ReplacePrefixMatch`，用上面的模擬確認 |
| 部署後點某些頁面沒反應，console 有 `Failed to fetch dynamically imported module` | 舊頁面要的 chunk 已經不在 | 見上一節的三種做法 |
| 改了 ConfigMap，`/config.js` 一直是舊內容 | 用 `subPath` 掛單一檔案，或值是透過環境變數產生的 | 掛整個目錄；用 templates 的話 `kubectl rollout restart` |

## 動手

1. 執行快取那段模擬。把 `FIXED` 裡 `/assets/` 那一行的 `NOSNIFF` 刪掉再跑，看 assets 的回應少了 nosniff（server 層還有，但那一層有自己的 `add_header`）；再把 `/index.html` 的值改成 `public, max-age=86400`，看部署 v2 之後下載了多少、拿到的是不是新版。
2. 執行分流那段模擬，把 `FLASK` 改成 `{"/patients", "/health"}`（後端路由沒有 `/api` 前綴），看第三組與第四組的結果怎麼對調。
3. 做本課的程式題：修一份前端的多階段 Dockerfile；修一份 nginx 設定的快取標頭，同時保留 SPA fallback 與 `/api` 轉發。
4. 在本機叢集上做（建叢集與安裝 Gateway API 實作的方式見 [clinic-api 的本機叢集指南](https://github.com/yo02741/Backend-Atlas/blob/main/companion/clinic-api/docs/local-k8s.md)）：用第二條路那份只送靜態檔的 `default.conf` 建好前端映像（nginx 啟動時不必解析 `clinic-api`），`kind load docker-image` 載進叢集，套用本課的 ConfigMap、Deployment 與 Service，然後：

```bash
kubectl port-forward -n clinic service/clinic-web 8080:80
curl -sI http://localhost:8080/patients/123 | grep -i cache-control
# 預期：Cache-Control: no-cache
curl -sI http://localhost:8080/assets/<dist 裡的某個檔名> | grep -i cache-control
# 預期：Cache-Control: public, max-age=31536000, immutable
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/assets/not-exist.js
# 預期：404
kubectl edit configmap clinic-web-config -n clinic      # 改 envName
curl -s http://localhost:8080/config.js                 # 過一陣子再執行，內容會變，Pod 沒有重啟
```

5. 照指南在同一座叢集裝好 Gateway API 的實作，套用第二條路的 HTTPRoute。本機的 `clinic-api` 是實作路線那一份：路由沒有 `/api` 前綴、Service 是 80，所以 `/api` 那條規則要加 `ReplacePrefixMatch: /`、port 改成 80。用 `curl -H 'Host: clinic.example' http://<Gateway 的位址>/api/healthz` 確認由 `clinic-api` 回應、`/api-docs/` 回到前端；再把 `ReplacePrefixMatch` 拿掉，看 `/api/healthz` 變成 404。

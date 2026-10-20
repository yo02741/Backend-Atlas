## 從一個具體問題開始：一則留言與一個外部網頁

商品頁有留言功能，伺服器端模板把留言原樣放進 HTML。有人留了這樣一則留言：

```html
好用！<script>alert(1)</script>
```

之後每個打開這個商品頁的人，瀏覽器都會執行那段 script。`alert(1)` 只是證明「能執行任意 JavaScript」的教科書寫法；實際的攻擊會在受害者的頁面裡、用受害者的登入狀態發請求：改 email、下訂單、讀取畫面上的個資。這是 **XSS（Cross-Site Scripting）**。

同一個網站的「修改 email」是一個表單，送出 `POST /account/email`，靠 session cookie 認人。某個外部網頁放了一個自動送出的表單，目標就是這個網址。已登入的使用者只要打開那個網頁，瀏覽器就會帶著 session cookie 送出請求，email 在使用者不知情的情況下被改掉。這是 **CSRF（Cross-Site Request Forgery）**。

兩者常被放在一起講，但機制相反：

| | XSS | CSRF |
|---|---|---|
| 攻擊者的程式在哪裡執行 | **你的網站**的頁面裡 | **別的網站**的頁面裡 |
| 利用的是 | 輸出沒有跳脫，資料被當成程式碼 | 瀏覽器會自動附上 cookie |
| 攻擊者能讀回應嗎 | 能（同源） | 不能（只能送出請求） |
| 主要防線 | 依情境跳脫輸出、CSP | SameSite cookie、CSRF token、檢查 Origin |

有 XSS 時，CSRF 防護基本上失效：攻擊者的 script 在你的頁面裡執行，可以先讀出頁面上的 CSRF token 再送請求。

## XSS 的運作原理

### 三種類型

| 類型 | 惡意內容從哪裡來 | 例子 | 誰負責修 |
|---|---|---|---|
| 儲存型（stored） | 存進資料庫，之後輸出給其他人 | 留言、暱稱、商品描述 | 輸出時跳脫（後端模板或前端框架） |
| 反射型（reflected） | 這次請求的參數，直接出現在回應裡 | 搜尋頁顯示「找不到 `<q>` 的結果」、錯誤頁顯示輸入值 | 輸出時跳脫 |
| DOM 型（DOM-based） | 前端 JavaScript 讀了 URL、`postMessage` 等來源，寫進 DOM | `el.innerHTML = location.hash.slice(1)` | 前端：用 `textContent`、不用 `innerHTML` |

DOM 型的惡意內容可能完全不經過伺服器（例如 URL 的 `#` 後面不會送到伺服器），後端日誌看不到。但 CSP 這類回應標頭仍然由後端設定，所以後端仍有一份責任。

### 跳脫要依情境

同一個字串放進 HTML 的不同位置，危險字元不一樣。瀏覽器在不同位置用不同的解析規則：

| 輸出位置 | 例子 | 要處理的 | 做法 |
|---|---|---|---|
| HTML 內文 | `<p>{{ comment }}</p>` | `<`、`>`、`&` | HTML 實體跳脫（`&lt;` 等）；模板引擎預設開啟自動跳脫 |
| HTML 屬性值 | `<input value="{{ name }}">` | 上面加上 `"`、`'` | **屬性一定加引號**，並跳脫引號。沒引號時，一個空白就能結束屬性、加上 `onfocus=…` |
| URL（`href`、`src`） | `<a href="{{ url }}">` | `javascript:` 這類 scheme | 檢查 scheme 只允許 `https:`（必要時 `http:`、`mailto:`）；查詢參數用 URL encoding |
| JavaScript 程式碼裡 | `<script>var u = "{{ name }}"</script>` | 引號、反斜線、`</script>` | 盡量不要這樣做；把資料放進 `data-*` 屬性或 `<script type="application/json">`，並跳脫 `<` |
| CSS | `style="color: {{ c }}"` | 幾乎全部 | 不要放使用者資料；只允許白名單值 |

**HTML 跳脫對 URL 情境無效**：`javascript:alert(1)` 沒有任何需要跳脫的 HTML 字元，跳脫之後原封不動，點下去照樣執行。這就是為什麼要依情境處理。

使用者確實需要輸入格式化內容（例如富文字編輯器）時，跳脫不適用，改用 HTML sanitizer 以白名單保留允許的標籤與屬性，其他全部移除。不要自己用正規表示式過濾 `<script>`，HTML 的解析規則有太多繞過方式。

### 後端的其他責任

- **JSON API 回 `Content-Type: application/json`**，搭配 `X-Content-Type-Options: nosniff`，讓瀏覽器不會把回應當 HTML 渲染。用 `text/html` 回 JSON，裡面的字串就可能被當成標記。
- 使用者上傳的 HTML、SVG 檔案不要從主網域直接以 inline 方式提供；用另一個網域，或加 `Content-Disposition: attachment`（見 [輸入驗證與檔案上傳](#/skill/input-validation)）。
- 錯誤頁不要回顯原始輸入。

### CSP：跳脫漏掉時的最後一道

**Content-Security-Policy** 告訴瀏覽器「這個頁面只能執行哪些來源的 script」。即使攻擊者成功注入了 `<script>`，它不符合政策就不會執行。

```text
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-R4nd0mPerRequest'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'
```

| 指令 | 作用 |
|---|---|
| `script-src 'self'` | 只執行同源的 script 檔；inline script 與 `eval` 預設被擋 |
| `'nonce-…'` | 每次回應產生一個隨機值，只有帶 `nonce="…"` 屬性的 inline script 能執行；攻擊者猜不到 nonce |
| `object-src 'none'` | 禁止 `<object>`、`<embed>` 這類舊式外掛內容 |
| `base-uri 'none'` | 防止注入 `<base>` 改變相對網址的解析 |
| `frame-ancestors 'none'` | 禁止別的網站用 iframe 嵌入這個頁面（防 clickjacking） |

導入時先用 `Content-Security-Policy-Report-Only` 標頭，瀏覽器只回報違規、不阻擋，確認沒有誤傷再切成正式標頭。CSP 寫了 `'unsafe-inline'` 就幾乎失去防 XSS 的效果。

### HttpOnly cookie 的作用與侷限

`HttpOnly` 讓 JavaScript 讀不到這個 cookie（`document.cookie` 看不到）。XSS 時攻擊者**偷不走** session cookie，無法在自己的機器上冒用。

但它擋不住攻擊者**在受害者的頁面裡**發請求：script 呼叫 `fetch('/account/email', { method: 'POST', … })`，瀏覽器照樣附上 HttpOnly cookie，伺服器看到的就是合法使用者。HttpOnly 限制的是「cookie 被帶走」，不是「XSS 能造成的傷害」。同理，把 token 放在 `localStorage` 讓 XSS 能直接讀走，傷害範圍更大。

## CSRF 的運作原理

CSRF 成立需要三個條件：

1. 伺服器用**瀏覽器會自動附上**的憑證認人：cookie、HTTP Basic、用戶端憑證。
2. 請求的效果有價值：改資料、轉帳、改權限。
3. 請求裡沒有攻擊者無法得知或無法偽造的值。

只用 `Authorization: Bearer …` 標頭認證的 API 不符合第 1 點：別的網站沒辦法讓瀏覽器自動帶這個標頭。所以純 token 的 API 天生不受 CSRF 影響，但要更注意 XSS 把 token 讀走（取捨見 [驗證基礎：Session vs Token](#/skill/authn-basics)）。

### SameSite

cookie 的 `SameSite` 屬性決定跨站請求時要不要附上它：

| 值 | 跨站時 | 備註 |
|---|---|---|
| `Strict` | 一律不帶 | 從外部連結點進來時也不帶，使用者會看起來像沒登入 |
| `Lax` | 只有「頂層導覽的 GET」（點連結）會帶；跨站的 POST 表單、fetch、iframe 不帶 | 擋掉大多數 CSRF；Chromium 系瀏覽器對沒寫 SameSite 的 cookie 預設當作 Lax，其他瀏覽器行為不一，所以要明確設定 |
| `None` | 一律帶，必須同時有 `Secure` | 只有真的需要跨站使用時才設 |

SameSite 的兩個盲點：

- **用 GET 改狀態**：`Lax` 允許頂層 GET 帶 cookie，`GET /account/delete` 這類端點照樣會被觸發。改狀態的操作一律用 POST／PUT／DELETE。
- **同站不等於同源**：`site` 是指可註冊網域（例如 `example.com`），`a.example.com` 和 `b.example.com` 是同站。任何一個子網域被攻陷或能放使用者內容，SameSite 就攔不住它發出的請求。SameSite 的細節見 [CORS、Cookie 與同源](#/skill/cors-cookies)。

### CSRF token 與 Origin 檢查

**Synchronizer token**：伺服器產生一個和 session 綁定的隨機值，放進表單的隱藏欄位（或給前端放進自訂標頭）。改狀態的請求必須帶它，伺服器比對。外部網站讀不到你頁面的內容（同源政策），所以拿不到 token。

**檢查 Origin**：瀏覽器在跨來源請求與 POST 請求上會附上 `Origin` 標頭，網頁裡的 JavaScript 無法偽造它。伺服器比對 `Origin` 是否在允許清單內；沒有 `Origin` 時退而檢查 `Referer`。現代瀏覽器還會送 `Sec-Fetch-Site`（`same-origin`、`same-site`、`cross-site`、`none`），可以直接拒絕 `cross-site` 的改狀態請求。

實務上的組合：session cookie 設 `SameSite=Lax; Secure; HttpOnly`，改狀態用非 GET 方法，伺服器檢查 Origin，表單型網站再加 CSRF token。多數框架（Django、Rails、Laravel）內建 CSRF middleware，開著就好；FastAPI 這類 API 框架沒有內建，用 cookie 認證時要自己補。

## 安全標頭基本盤

| 標頭 | 建議值 | 作用 |
|---|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | 瀏覽器之後一律用 HTTPS 連線，擋掉降級成 HTTP 的攻擊。`includeSubDomains` 前確認所有子網域都支援 HTTPS；`preload` 很難撤回，謹慎使用 |
| `X-Content-Type-Options` | `nosniff` | 瀏覽器照 `Content-Type` 處理，不自行猜測類型 |
| `Content-Security-Policy` | 依網站調整，含 `frame-ancestors` | 限制 script 來源與誰能嵌入本頁 |
| `X-Frame-Options` | `DENY` 或 `SAMEORIGIN` | 舊式的防嵌入標頭；有 `frame-ancestors` 時以它為準，留著給舊瀏覽器 |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | 跨站時只送來源網域，不送完整網址（網址裡可能有 token 或個資） |

在 nginx 一次加上（`always` 讓錯誤回應也帶標頭）：

```nginx
server {
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" always;

    location /api/ {
        # 注意：這裡只要寫了任何一個 add_header，上面 server 層的 add_header 就全部不會繼承
        proxy_pass http://app;
    }
}
```

## 實際程式

### 依情境跳脫

```python run
import html, json
from urllib.parse import quote, urlsplit

comment = '好用！<script>alert(1)</script>'
name1 = 'x autofocus onfocus=alert(1)'      # 針對沒加引號的屬性
name2 = '" autofocus onfocus="alert(1)'     # 針對有引號、但沒跳脫引號的屬性
link = 'javascript:alert(1)'

# 1) HTML 內文：跳脫 < > &
print("內文：", f"<p>{html.escape(comment)}</p>")

# 2) 屬性：沒加引號、有引號沒跳脫、加引號並跳脫引號
print("屬性（沒引號）：", f'<input value={html.escape(name1)}>')   # 空白結束了屬性值，跳脫 <> 也沒用
print("屬性（沒跳脫）：", f'<input value="{name2}">')               # 引號提前結束屬性值
print("屬性（對）    ：", f'<input value="{html.escape(name2, quote=True)}">')

# 3) URL：HTML 跳脫對 javascript: 沒有作用，要檢查 scheme
print("href 只做 HTML 跳脫：", f'<a href="{html.escape(link)}">')
def safe_url(u: str) -> str:
    return u if urlsplit(u).scheme in ("https", "http", "mailto") else "#"
print("href 檢查 scheme：", f'<a href="{html.escape(safe_url(link))}">')
print("查詢參數：", "/search?q=" + quote("a&b=<c>", safe=""))

# 4) 放進 <script> 的 JSON：json.dumps 不會處理 </script>，要額外跳脫 <
data = {"name": "</script><script>alert(1)</script>"}
naive = json.dumps(data, ensure_ascii=False)
print("JSON（錯）：", f'<script type="application/json" id="d">{naive}</script>')
safe = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")
print("JSON（對）：", f'<script type="application/json" id="d">{safe}</script>')
print("瀏覽器端 JSON.parse 後值不變：", json.loads(safe) == data)
```

### CSRF token 與 Origin 檢查

```python run
import hmac, hashlib, secrets

SERVER_KEY = secrets.token_bytes(32)          # 實務上從 Secret Manager 讀取
ALLOWED_ORIGINS = {"https://shop.example.com"}

def csrf_token(session_id: str) -> str:
    # 和 session 綁定的 token：換了 session（例如重新登入）舊 token 就失效
    return hmac.new(SERVER_KEY, f"csrf:{session_id}".encode(), hashlib.sha256).hexdigest()

def check_request(method: str, headers: dict, form: dict, session_id: str) -> str:
    if method in ("GET", "HEAD", "OPTIONS"):
        return "放行（安全方法，不該改狀態）"
    if headers.get("Sec-Fetch-Site") == "cross-site":
        return "拒絕：Sec-Fetch-Site = cross-site"
    origin = headers.get("Origin")
    if origin is not None and origin not in ALLOWED_ORIGINS:
        return f"拒絕：Origin {origin} 不在允許清單"
    if not hmac.compare_digest(form.get("csrf_token", ""), csrf_token(session_id)):
        return "拒絕：CSRF token 不符"
    return "放行"

sid = secrets.token_urlsafe(16)
good = {"csrf_token": csrf_token(sid), "email": "new@example.com"}
cases = [
    ("自己的表單", "POST", {"Origin": "https://shop.example.com", "Sec-Fetch-Site": "same-origin"}, good),
    ("外部網站的表單", "POST", {"Origin": "https://evil.example.net", "Sec-Fetch-Site": "cross-site"}, {"email": "x@example.net"}),
    ("舊瀏覽器、沒有 Origin、沒有 token", "POST", {}, {"email": "x@example.net"}),
    ("token 來自別的 session", "POST", {"Origin": "https://shop.example.com"}, {"csrf_token": csrf_token("other")}),
]
for label, m, h, f in cases:
    print(f"{label:22} → {check_request(m, h, f, sid)}")
```

## 常見錯誤與錯誤訊息

| 現象或訊息 | 原因 | 修正 |
|---|---|---|
| Chrome 主控台：`Refused to execute inline script because it violates the following Content Security Policy directive: …` | CSP 生效，擋下了 inline script；可能是攻擊，也可能是自己的 inline script 沒帶 nonce | 自己的 script 改成外部檔案或加 nonce；不要為了消除訊息加 `'unsafe-inline'` |
| Django：`Forbidden (403) CSRF verification failed. Request aborted.` | 表單沒帶 `csrf_token`、cookie 沒送出，或 HTTPS 下 Origin／Referer 不在信任清單 | 模板加 `{% csrf_token %}`；反向代理後面要正確設定信任的來源 |
| 模板用了 safe 過濾器（Jinja2、Django）、`Markup()`、React 的 `dangerouslySetInnerHTML` | 關掉了自動跳脫 | 只用在 sanitizer 處理過的內容上；在程式碼審查中搜尋這些關鍵字 |
| 登入後從外部連結點進來顯示未登入 | cookie 設成 `SameSite=Strict` | 一般 session 用 `Lax`；Strict 留給高敏感操作的第二把 cookie |
| 跨站嵌入的登入功能失效，cookie 沒送出 | 第三方 cookie 被瀏覽器限制，或沒設 `SameSite=None; Secure` | 重新設計流程（例如改用頂層導覽或 token），不要依賴第三方 cookie |
| 加了安全標頭，但 `/api/` 的回應沒有 | nginx 在 location 裡另寫了 `add_header`，上層的不繼承 | 把共用標頭放進 include 檔，在每個有 `add_header` 的區塊都引入 |

## 動手

1. 在跳脫那段把 `link` 改成 `JavaScript:alert(1)`（大寫）與 `  javascript:alert(1)`（前面有空白），看 `urlsplit` 的判斷是否仍然擋得住；再想想為什麼白名單比「擋掉 javascript:」安全。
2. 在 CSRF 那段新增一個 case：`GET` 請求卻會修改 email，看 `check_request` 放行了它，體會「改狀態只用非 GET 方法」為什麼是前提。
3. 打開任一個自己的網站，在瀏覽器開發者工具的 Network 分頁看回應標頭，對照上面的安全標頭表列出缺哪些。
4. 在 nginx 設定加上 `Content-Security-Policy-Report-Only`，觀察主控台回報的違規項目，再決定正式政策。
5. 注入的共同原理見 [注入攻擊](#/skill/injection)；cookie 的跨站規則見 [CORS、Cookie 與同源](#/skill/cors-cookies)。

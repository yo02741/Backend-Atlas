## 從一個具體問題開始：拿到 access token，就算登入了嗎

一個網站要做「用 Example 帳號登入」。工程師照著某篇教學做：使用者授權後，網站拿到一張 access token，呼叫 Example 的 `/me` API 取得 email，用 email 找到本地帳號，登入完成。

上線幾週後發現兩個問題：

1. 有人把**別的 App** 拿到的 access token（同一個身分提供者發的、屬於受害者的）送到這個網站的登入端點，網站照樣呼叫 `/me`、照樣拿到受害者的 email，讓他以受害者身分登入。access token 只說明「持有者可以呼叫這個 API」，不說明「這張 token 是發給**我這個網站**、為了**這一次登入**」。
2. 某個身分提供者允許使用者自己填 email 而且不驗證，有人註冊一個帳號填了別人的 email，用它「登入」後拿到了對方在本站的帳號。

這兩個問題的根源是同一個：**OAuth 2.0 是授權協定，不是驗證協定**。它回答的是「使用者是否同意讓這個 client 存取某些資源」，沒有回答「現在這位使用者是誰、這個答案是給誰的」。OpenID Connect（OIDC）在 OAuth 上加了一層，專門回答後者：ID token 裡有 `aud`（是發給哪個 client 的）、`nonce`（是哪一次登入請求）、`iss` + `sub`（穩定的使用者識別碼）。

## 運作原理：四個角色與一次授權

OAuth 2.0（RFC 6749）定義四個角色：

| 角色 | 是誰 | 「用 Example 登入」的例子 |
|---|---|---|
| Resource Owner | 擁有資料、能做授權決定的人 | 使用者 alice |
| Client | 想存取資料的應用程式 | 你的網站 `shop.example.com`（後端） |
| Authorization Server | 驗證使用者、詢問同意、發 token | `accounts.example.com` |
| Resource Server | 存放資料、檢查 token 的 API | `api.example.com` |

Client 分兩種：**機密型**（confidential，有後端能保管 `client_secret`）與**公開型**（public，SPA、手機 App、CLI，程式碼在使用者手上，藏不住 secret）。下面以機密型的網站後端為例；公開型的差別在換 token 時不帶 secret、只靠 PKCE，見 [Device Code 與 PKCE](#/skill/oauth-device-pkce)。

授權伺服器通常在 `/.well-known/openid-configuration` 公布自己的設定（授權端點、token 端點、JWKS 網址、支援的 scope），client 可以從這裡讀，不用寫死每一個網址。

### 授權碼流程：逐步往返

**① 使用者點「用 Example 登入」**。網站後端產生三個隨機值存進這位使用者的 session（登入前的暫時 session）：

- `state`：防 CSRF，回來時比對。
- `nonce`：OIDC 用，會被寫進 ID token，防 ID token 被重放。
- `code_verifier`：PKCE 用，算出 `code_challenge` 放進請求。

然後把瀏覽器導去授權伺服器：

```http
HTTP/1.1 302 Found
Location: https://accounts.example.com/authorize?response_type=code&client_id=shop-web&redirect_uri=https%3A%2F%2Fshop.example.com%2Fauth%2Fcallback&scope=openid%20email%20profile&state=Zk3pQ8vL2mWx&nonce=n-7Hq2Ld9sKe&code_challenge=Xc4mG1uV…&code_challenge_method=S256
Set-Cookie: __Host-pre=…; Path=/; Secure; HttpOnly; SameSite=Lax
```

**② 授權伺服器驗證使用者並詢問同意**。使用者在 `accounts.example.com` 登入（密碼、passkey、MFA 都在這裡發生，你的網站完全看不到密碼），畫面列出「shop-web 想取得你的 email 與基本資料」。

**③ 導回 client，帶著授權碼**：

```http
HTTP/1.1 302 Found
Location: https://shop.example.com/auth/callback?code=4/P7q9Lm2Xz…&state=Zk3pQ8vL2mWx
```

`code` 是短命、一次性的憑證。RFC 6749 建議最長 10 分鐘，實務上常見更短。它會出現在網址列、瀏覽器歷史、可能的 log 裡，所以本身不能直接拿來存取資料。

**④ client 後端比對 state**。網址的 `state` 必須等於 session 裡存的那個；不符就中止，不要繼續換 token。

**⑤ 後端拿 code 換 token**（這一步在伺服器對伺服器之間，不經過瀏覽器）：

```http
POST /token HTTP/1.1
Host: accounts.example.com
Authorization: Basic c2hvcC13ZWI6czNjcjN0LWRlbW8=
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=4/P7q9Lm2Xz…&redirect_uri=https%3A%2F%2Fshop.example.com%2Fauth%2Fcallback&code_verifier=Jt8sQ1fV…
```

`Authorization: Basic` 是 `client_id:client_secret` 的 Base64（這叫 `client_secret_basic`；也有把它們放在表單裡的 `client_secret_post`，以及用私鑰簽一個 JWT 的 `private_key_jwt`）。`redirect_uri` 必須和步驟 ① 送出的完全相同。

**⑥ 授權伺服器回傳 token**：

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "access_token": "ya29.a0Af…",
  "token_type": "Bearer",
  "expires_in": 3599,
  "refresh_token": "1//0gK…",
  "scope": "openid email profile",
  "id_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6IjFlOWdkazcifQ.eyJpc3Mi…"
}
```

**⑦ client 驗證 ID token、建立自己的 session**（見下一段）。到這裡「登入」才算完成。之後網站對瀏覽器用自己的 session cookie，和授權伺服器的 token 是兩回事（見 [驗證基礎](#/skill/authn-basics)）。

**⑧ 需要時用 access token 呼叫 API**：

```http
GET /v1/contacts HTTP/1.1
Host: api.example.com
Authorization: Bearer ya29.a0Af…
```

[OAuth 授權碼流程](#/lab/OAuthLab) 實驗室把這八步畫成時序圖，可以逐步看每一步的請求與回應。

### state：防的是把攻擊者的帳號塞給你

沒有 `state` 時，攻擊者可以自己走一次流程到步驟 ③，拿到一個**屬於攻擊者帳號**的 `code`，不去兌換，而是把 `https://shop.example.com/auth/callback?code=<攻擊者的 code>` 這個連結讓受害者點開。受害者的瀏覽器送出這個請求，網站換到攻擊者的 token，於是受害者被登入成攻擊者的帳號，之後輸入的地址、信用卡、上傳的檔案都存進了攻擊者的帳號裡。如果網站有「把外部帳號連結到目前登入的本地帳號」功能，後果更嚴重：攻擊者的外部帳號被綁到受害者的本地帳號上，之後攻擊者用自己的外部帳號就能登入受害者的帳號。

`state` 讓 callback 只接受「從這個瀏覽器 session 發出去的那一次請求」的回應。PKCE 也有類似效果（攻擊者的 code 綁的是攻擊者的 `code_challenge`，受害者的 session 裡的 verifier 對不上），所以目前的安全建議（RFC 9700）讓 PKCE 可以取代 state 的 CSRF 防護；但 `state` 也常拿來帶「登入後要回到哪一頁」，多數實作兩個都用。

### scope：要多少給多少

`scope` 是空白分隔的字串，代表 client 要求的權限，例如 `openid email contacts.readonly`。授權伺服器可能只核准一部分，token 回應裡的 `scope` 才是實際拿到的。原則：

- 只要求現在需要的，之後需要更多再要（incremental authorization），同意畫面越短，使用者越願意按同意。
- Resource Server 要檢查 token 的 scope 涵蓋這個操作，不足時回 `403`，並在 `WWW-Authenticate` 帶 `error="insufficient_scope"`（RFC 6750）。

### refresh token

access token 效期短（上例約一小時）。到期後，client 用 refresh token 換新的，不用再讓使用者走一次流程：

```http
POST /token HTTP/1.1
Host: accounts.example.com
Authorization: Basic c2hvcC13ZWI6czNjcjN0LWRlbW8=
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token=1//0gK…
```

refresh token 效期長、能力大，存在後端（資料庫要加密），不要送到瀏覽器。有些授權伺服器每次換發都回一張新的 refresh token 並作廢舊的（rotation），舊的被再次使用就代表外洩，整串作廢。要不要發 refresh token、要什麼 scope 才發（OIDC 定義了 `offline_access`），每家授權伺服器規則不同，看它的文件。

## OIDC 多了什麼

OIDC（OpenID Connect Core 1.0）在 OAuth 授權碼流程上加了：

| 項目 | 內容 |
|---|---|
| `openid` scope | 請求裡有它，這次就是 OIDC 流程，token 回應會多一個 `id_token` |
| ID token | 一個 JWT，由授權伺服器（OIDC 稱為 OpenID Provider）簽章，內容是「誰、在什麼時候、為了哪個 client 登入」 |
| UserInfo 端點 | 用 access token 呼叫，取得使用者的聲明（姓名、email…） |
| 標準聲明 | `sub`、`name`、`email`、`email_verified`、`picture` 等，由 `profile`、`email` 等 scope 決定回哪些 |
| Discovery 與 JWKS | `/.well-known/openid-configuration` 與 `jwks_uri`，讓 client 自動取得端點與公鑰 |

ID token 解開後大概長這樣：

```json
{
  "iss": "https://accounts.example.com",
  "aud": "shop-web",
  "sub": "110248495921238986420",
  "email": "alice@example.com",
  "email_verified": true,
  "nonce": "n-7Hq2Ld9sKe",
  "iat": 1792483200,
  "exp": 1792486800,
  "auth_time": 1792483190
}
```

UserInfo 的呼叫：

```http
GET /userinfo HTTP/1.1
Host: accounts.example.com
Authorization: Bearer ya29.a0Af…
```

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"sub": "110248495921238986420", "email": "alice@example.com", "email_verified": true, "name": "Alice Chen"}
```

規格要求 client 確認 UserInfo 回應的 `sub` 和 ID token 的 `sub` 相同，不同就不能用。

### ID token 要驗什麼

依 OIDC Core 的規定，client 收到 ID token 時至少要檢查：

| 檢查 | 失敗代表什麼 |
|---|---|
| 簽章正確，`alg` 是預期的（常見 RS256），金鑰來自 `jwks_uri` 且 `kid` 對得上 | 內容被竄改，或根本不是這個提供者簽的 |
| `iss` 完全等於提供者的 issuer | 別的提供者簽的 |
| `aud` 包含自己的 `client_id`；若有多個 aud，`azp` 要等於自己的 `client_id` | 這是發給別的 client 的 ID token（開頭第一個問題的變形） |
| `exp` 還沒到 | 過期 |
| `nonce` 等於這次登入請求時存在 session 裡的值 | 舊的 ID token 被重放 |
| `iat` 不要太舊（依自己的政策） | 很久以前簽的 token |
| 有要求 `max_age` 時檢查 `auth_time` | 使用者上次真正輸入憑證的時間太久 |

用 OIDC 時開頭的第一個問題就解了：別的 App 拿到的 ID token，`aud` 是那個 App 的 client_id，驗證時會被拒絕。授權碼流程中，ID token 是後端直接從 token 端點經 TLS 拿到的，OIDC Core 允許這種情況用 TLS 伺服器驗證取代簽章驗證；但多數函式庫一律驗簽章，照做即可。

### 用什麼當使用者識別碼

本地帳號要綁 **`iss` + `sub`**，不是 email。`sub` 在同一個提供者內唯一且不會重新指派；email 會改、可能被別人註冊、不同提供者之間更沒有保證。開頭的第二個問題就是用 email 當識別碼造成的。要用 email 做「既有帳號連結」時，至少要求 `email_verified` 為 `true`，而且只信任你確定會驗證 email 的提供者；更保守的做法是要求使用者先用原本的方式登入，再手動連結。

### access token 和 ID token 不要混用

| | access token | ID token |
|---|---|---|
| 給誰看 | Resource Server（API） | Client 自己 |
| 回答什麼 | 持有者可以做哪些操作 | 誰登入了、何時、發給哪個 client |
| 格式 | 規格不規定；可能是 JWT 也可能是 opaque 字串，client 不應該解析它 | 一定是 JWT |
| 送到 API | 是，`Authorization: Bearer` | 否；API 不應該接受 ID token 當存取憑證 |

## 實際程式：模擬授權伺服器與 client 的 callback

下面用 Python 標準函式庫寫一個極小的授權伺服器與 client，跑一次正常流程，再跑四種會失敗的情況。為了專注在流程，ID token 在這裡用字典代替（真實環境要驗 JWT 簽章，見 [JWT 解剖](#/skill/jwt)）。

```python run
import secrets, hashlib, base64
from urllib.parse import urlencode, urlparse, parse_qs

NOW = 1_792_483_200
def b64url(b): return base64.urlsafe_b64encode(b).rstrip(b"=").decode()
def s256(verifier): return b64url(hashlib.sha256(verifier.encode()).digest())

# ---------------- 授權伺服器 ----------------
CLIENTS = {"shop-web": {"secret": "s3cr3t-demo", "redirect_uris": ["https://shop.example.com/auth/callback"]}}
codes = {}   # code -> 這次授權的細節

class OAuthError(Exception): pass

def authorize(client_id, redirect_uri, scope, state, nonce, code_challenge, user):
    c = CLIENTS.get(client_id)
    if c is None or redirect_uri not in c["redirect_uris"]:
        # 不可以導回一個沒註冊過的網址：直接在授權伺服器的頁面顯示錯誤
        raise OAuthError("invalid_request: redirect_uri 未註冊（顯示錯誤頁，不導回）")
    code = secrets.token_urlsafe(16)
    codes[code] = dict(client_id=client_id, redirect_uri=redirect_uri, scope=scope, nonce=nonce,
                       challenge=code_challenge, sub=user, expires=NOW + 60, used=False)
    return f"{redirect_uri}?{urlencode({'code': code, 'state': state})}"

def token(client_id, client_secret, code, redirect_uri, code_verifier, now=NOW):
    if CLIENTS.get(client_id, {}).get("secret") != client_secret:
        raise OAuthError("invalid_client")
    g = codes.get(code)
    if g is None or g["used"] or now >= g["expires"]:
        raise OAuthError("invalid_grant: code 不存在、已使用或已過期")
    g["used"] = True                                   # 一次性：先標記，再檢查其餘條件
    if g["client_id"] != client_id or g["redirect_uri"] != redirect_uri:
        raise OAuthError("invalid_grant: redirect_uri 或 client 與授權時不同")
    if s256(code_verifier) != g["challenge"]:
        raise OAuthError("invalid_grant: PKCE code_verifier 不符")
    id_token = {"iss": "https://accounts.example.com", "aud": client_id, "sub": g["sub"],
                "nonce": g["nonce"], "iat": now, "exp": now + 3600}
    return {"access_token": secrets.token_urlsafe(24), "token_type": "Bearer", "id_token": id_token}

# ---------------- client（網站後端） ----------------
REDIRECT = "https://shop.example.com/auth/callback"

def start_login(session):
    session.update(state=secrets.token_urlsafe(12), nonce=secrets.token_urlsafe(12),
                   verifier=secrets.token_urlsafe(48))
    return dict(client_id="shop-web", redirect_uri=REDIRECT, scope="openid email",
                state=session["state"], nonce=session["nonce"], code_challenge=s256(session["verifier"]))

def validate_id_token(t, session, now=NOW):
    if t["iss"] != "https://accounts.example.com": raise OAuthError("ID token iss 不符")
    if t["aud"] != "shop-web": raise OAuthError("ID token aud 不是自己")
    if now >= t["exp"]: raise OAuthError("ID token 過期")
    if t["nonce"] != session.pop("nonce", None): raise OAuthError("ID token nonce 不符")
    return (t["iss"], t["sub"])                        # 本地帳號綁這一對，不綁 email

def callback(session, url, redirect_uri=REDIRECT):
    q = {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}
    if q.get("state") != session.pop("state", None):
        raise OAuthError("state 不符：可能是 CSRF，中止")
    tok = token("shop-web", "s3cr3t-demo", q["code"], redirect_uri, session["verifier"])
    return validate_id_token(tok["id_token"], session)

def attempt(name, fn):
    try: print(f"成功  {name} → {fn()}")
    except OAuthError as e: print(f"失敗  {name} → {e}")

# 1. 正常流程
s = {}; back = authorize(**start_login(s), user="alice")
attempt("正常登入", lambda: callback(s, back))

# 2. 同一個 code 用第二次
s2 = {}; back2 = authorize(**start_login(s2), user="alice")
callback(dict(s2), back2)                              # 第一次（用 s2 的副本）
attempt("code 重複使用", lambda: callback(s2, back2))

# 3. 攻擊者把自己的 code 塞給受害者（login CSRF）
attacker = {}; evil = authorize(**start_login(attacker), user="mallory")
victim = {}; start_login(victim)                       # 受害者的 session 有自己的 state
attempt("塞入攻擊者的 code", lambda: callback(victim, evil))

# 4. 換 token 時 redirect_uri 和授權時不一樣
s4 = {}; back4 = authorize(**start_login(s4), user="alice")
attempt("redirect_uri 不一致", lambda: callback(s4, back4, redirect_uri="https://shop.example.com/callback"))

# 5. 授權請求用了沒註冊的 redirect_uri
attempt("未註冊的 redirect_uri", lambda: authorize(**{**start_login({}), "redirect_uri": "https://evil.example.net/cb"}, user="alice"))
```

第 3 個案例在 state 那一關就被擋下；就算 client 忘了檢查 state，攻擊者的 code 綁的是攻擊者的 `code_challenge`，受害者 session 裡的 verifier 也換不到 token。

實務上 client 端不要自己寫這些：用經過認證的 OIDC client 函式庫（OpenID Foundation 有列出通過認證的實作），它會處理 discovery、JWKS 快取、ID token 驗證。自己要負責的是：設定正確的 `redirect_uri`、把 state / nonce / verifier 存在伺服器端 session、拿到 `(iss, sub)` 之後建立自己的 session。

## 常見錯誤與錯誤訊息

OAuth 的錯誤碼定義在 RFC 6749：授權端點的錯誤以 `error=` 參數加在 redirect 網址上；token 端點的錯誤是 JSON，例如：

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json
Cache-Control: no-store

{"error": "invalid_grant", "error_description": "Bad Request"}
```

`error_description` 的內容各家不同，通常不太有用，要從 `error` 和自己的請求推原因：

| 錯誤 | 出現在哪 | 常見原因 | 怎麼修 |
|---|---|---|---|
| redirect_uri 不符（例如 Google 的錯誤頁顯示 `redirect_uri_mismatch`） | 授權伺服器的錯誤頁，不會導回 | 請求的 `redirect_uri` 和註冊的不是**完全相同**的字串：http 與 https、結尾斜線、port、`localhost` 與 `127.0.0.1` | 把錯誤頁上顯示的 `redirect_uri` 和後台註冊的逐字比對 |
| `invalid_grant` | token 端點 | code 已過期或已用過（例如使用者按了重新整理、前端重複送出）、換 token 時的 `redirect_uri` 和授權時不同、PKCE verifier 不符、refresh token 已撤銷或已輪替 | 確認 callback 只兌換一次；`redirect_uri` 用同一個設定值；verifier 存在伺服器端 session 而不是會被覆蓋的 cookie |
| `invalid_client` | token 端點（常是 401） | client_id 或 secret 錯、用了提供者不支援的 client 驗證方式（basic 與 post 搞混） | 確認 secret 沒有多餘空白或換行；查 discovery 的 `token_endpoint_auth_methods_supported` |
| `access_denied` | redirect 回 callback | 使用者在同意畫面按了取消，或組織政策不允許這個 App | 顯示正常的「已取消登入」頁，不要當系統錯誤 |
| callback 收到的 state 和 session 不同 | 自己的 callback | 使用者開了兩個分頁同時登入、session cookie 在跨站導回時沒帶（`SameSite=Strict`）、session 過期 | 暫時 session 的 cookie 用 `SameSite=Lax`；每次登入的 state 分開存（例如 state → 資料的對照） |
| ID token 驗證失敗：`aud` 不符 | 自己的 callback | 用了另一個環境（測試與正式）的 client_id 設定 | 每個環境的 client_id、issuer 分開設定、一起部署 |

## 動手

1. 開 [OAuth 授權碼流程](#/lab/OAuthLab) 實驗室，切換 PKCE 開關，看第 ① 步與第 ⑤ 步的請求多了哪些參數。
2. 在上面的 Python 範例裡，把 `callback` 裡檢查 state 的兩行註解掉，再跑第 3 個案例，看它改在哪一關被擋下（PKCE）；再把 `token` 裡 PKCE 那一關也拿掉，會發現 `nonce` 還擋著。三道都拿掉，受害者才會被登入成 `mallory`——這三個值各自都能獨立擋下這種攻擊。
3. 把 `codes[code]` 的 `expires` 改成 `NOW - 1`，看過期的 code 回什麼錯誤。
4. 讀任一個身分提供者的 `/.well-known/openid-configuration`（例如自己公司 SSO 的），找出 `issuer`、`authorization_endpoint`、`token_endpoint`、`jwks_uri`、`code_challenge_methods_supported`。
5. 接著讀 [Device Code 與 PKCE](#/skill/oauth-device-pkce)：沒有後端、沒有瀏覽器的 client 怎麼走同樣的授權；以及 [MCP 的授權](#/skill/mcp-authorization)，看 resource server 端怎麼驗 access token 的 `aud`。

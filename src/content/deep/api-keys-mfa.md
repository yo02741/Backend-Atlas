## 從一個具體問題開始：對帳腳本用的是工程師的帳號

一個電商後台每天凌晨跑對帳腳本，呼叫內部 API 拉前一天的訂單。腳本裡寫的是工程師 kevin 的帳號密碼，因為「當初他設的」。接下來一年發生了這些事：

1. 公司要求所有帳號啟用 MFA。kevin 啟用後，腳本登入時要輸入驗證碼，每天凌晨失敗。有人的修法是：幫 kevin 的帳號加一個「略過 MFA」的例外。
2. 稽核紀錄裡，kevin 每天凌晨 3 點都在下載全部訂單。沒有人分得出哪些是腳本、哪些是 kevin 本人。
3. kevin 離職，帳號依規定停用。對帳中斷三天才有人發現原因。
4. 事後清查發現，那組密碼兩年前曾經被 commit 進 repo，而那個帳號正好是全公司唯一沒有 MFA 的帳號。

問題的根源是**機器借用了人的身分**。人的身分要有 MFA、會離職、權限跟著職務走；機器的身分要能無人值守地使用、權限只限它的工作、和任何一個人的去留無關。這一課分兩半：沒有使用者在場的呼叫怎麼驗（API key、client credentials、mTLS），以及人的登入怎麼加上第二個因素（MFA）與交給企業的身分提供者（SSO）。

## 機器的身分：API key

API key 是最簡單的機器憑證：一個長隨機字串，呼叫時放在 header：

```http
GET /v1/orders?date=2026-10-19 HTTP/1.1
Host: api.example.com
Authorization: Bearer atl_live_Xb3kQ9vT2mN8pL4rW7yZ1cF6hJ0sD5gA8eK3nM2qR9u
```

設計上的要點和密碼一樣嚴格：固定前綴（`atl_live_`、`atl_test_`，讓人與 secret 掃描工具一眼認出）、資料庫只存 `SHA-256(key)`、完整 key 只在建立時顯示一次、每把 key 有 scope 與到期日、記錄建立者與最後使用時間。格式、資料表、驗證流程與實際程式在 [金鑰的範圍與壽命](#/skill/key-scope-lifetime) 有完整的設計，這裡不重複，只補兩個常見的錯誤：

- **key 放在網址的 query string**（`?api_key=…`）：網址會進入存取 log、代理伺服器 log、瀏覽器歷史、`Referer` header。key 一律放在 header。
- **API key 綁在個人帳號上**：開頭那個問題的另一種形式。給機器用的 key 應該屬於一個「服務帳號」或「整合」，有自己的擁有團隊，人員異動時不受影響。

API key 的限制是：它是長效的共享祕密，呼叫端每次都送出同一個值。只要被看到一次（log、錯誤回報、被入侵的 CI），就能在別處重放到被撤銷為止。下面兩種做法分別從「短效」與「不送出祕密」兩個方向改善。

## 服務間驗證：client credentials 與 mTLS

### OAuth client credentials：用長效憑證換短效 token

服務向授權伺服器註冊成一個 client，拿到 `client_id` 與 `client_secret`（或註冊一把公鑰）。需要呼叫 API 時，先換一張短效 access token（RFC 6749 §4.4）：

```http
POST /oauth2/token HTTP/1.1
Host: auth.example.com
Authorization: Basic cmVjb25jaWxlLWpvYjpzM2NyM3QtZGVtbw==
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&scope=orders.read
```

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{"access_token": "eyJhbGciOiJFUzI1NiIs…", "token_type": "Bearer", "expires_in": 600, "scope": "orders.read"}
```

這張 token 的 `sub` 是服務自己（例如 `reconcile-job`），不是任何人；效期 10 分鐘，過期再換。和直接用 API key 比：

- 送到各個 API 的是短效 token，被 log 記下來，10 分鐘後就沒用了。長效的 `client_secret` 只送給授權伺服器。
- 各個 API 用驗 JWT 的方式驗 token，不用各自維護一份 API key 表；撤銷、scope、稽核集中在授權伺服器。
- 沒有使用者、沒有瀏覽器，所以沒有 redirect、沒有同意畫面，也**不會發 refresh token**（需要時重新換一張即可）。

`client_secret` 本身仍是共享祕密。更進一步的做法是 `private_key_jwt`：client 只註冊公鑰，換 token 時用私鑰簽一個短效的 JWT 當作證明（RFC 7523），授權伺服器從頭到尾不持有能冒充這個 client 的祕密。三種 OAuth 流程的對照可以在 [OAuth 三種流程](#/lab/DeviceCodeLab) 實驗室切換到 Client Credentials 看。

### mTLS：用憑證證明身分

一般的 TLS 只有伺服器出示憑證。mutual TLS（mTLS）在握手時，伺服器也要求客戶端出示憑證：

| 步驟 | 方向 | 內容 |
|---|---|---|
| 1 | 客戶端 → 伺服器 | ClientHello |
| 2 | 伺服器 → 客戶端 | 伺服器憑證 + **CertificateRequest**（要求客戶端出示憑證） |
| 3 | 客戶端 → 伺服器 | 客戶端憑證 + CertificateVerify（用私鑰對握手內容簽章，證明持有私鑰） |
| 4 | 伺服器 | 用內部 CA 驗證客戶端憑證鏈、檢查效期；從憑證的 SAN 取出服務身分 |

私鑰從不離開客戶端，也沒有任何祕密在網路上傳送；被動監聽或 log 拿不到可以重放的東西。代價是要經營一套內部 CA：簽發、輪替、撤銷。實務上常交給 service mesh（例如 Istio、Linkerd）自動簽發短效憑證並在 sidecar 處理 mTLS，服務程式本身不用改。服務身分常用 SPIFFE ID 的格式寫在 SAN 裡，例如 `spiffe://example.org/ns/prod/sa/reconcile-job`。

mTLS 也能和 OAuth 結合：RFC 8705 定義了用客戶端憑證向授權伺服器驗證，以及把 access token 綁定到憑證（certificate-bound token），token 被偷了，沒有對應私鑰也用不了。

### 怎麼選

| 做法 | 祕密有沒有送出 | 效期 | 適合 |
|---|---|---|---|
| API key | 每個請求都送 | 長（要設到期） | 給外部開發者、簡單整合 |
| client credentials + `client_secret` | 只送給授權伺服器 | access token 短 | 已經有授權伺服器的內部服務、B2B 整合 |
| client credentials + `private_key_jwt` | 不送祕密，只送簽章 | access token 短 | 同上，安全要求較高 |
| mTLS | 不送祕密 | 憑證可以很短（例如幾小時，自動輪替） | 同一個平台內的服務對服務，有 mesh 或內部 CA |
| 雲端工作負載身分（例如 CI 用 OIDC 換雲端臨時憑證） | 不存長效祕密 | 臨時憑證短 | 跑在雲端或 CI 上的工作；見 [CLI 的 token 儲存](#/skill/cli-token-storage) |

## MFA：第二個因素

驗證因素分三類：**知道的**（密碼、PIN）、**擁有的**（手機、硬體金鑰）、**本身的**（指紋、臉）。MFA 要求兩類以上；「密碼 + 安全問題」是兩個「知道的」，不算 MFA。

| 方式 | 怎麼運作 | 能不能被釣魚 | 主要弱點 |
|---|---|---|---|
| 簡訊 / 語音 OTP | 伺服器把一次性碼送到手機號碼 | 能：使用者會把碼輸入假網站 | SIM 卡被冒名補辦（SIM swap）、電信網路攔截、號碼被回收給別人；NIST SP 800-63B 把它列為「受限」（restricted）的驗證方式 |
| TOTP（Authenticator App） | 手機與伺服器共享一把 secret，用時間算出 6 位數 | 能：假網站即時轉送使用者輸入的碼 | secret 存在伺服器（必須能還原，不能只存雜湊）；碼在 30～90 秒內可以被轉送 |
| 推播核准 | App 跳出「是你在登入嗎？」 | 能：攻擊者有密碼後狂發請求，等使用者誤按（MFA fatigue） | 要搭配「輸入畫面上的數字」（number matching）和頻率限制 |
| WebAuthn / passkey | 裝置上的私鑰對伺服器的挑戰簽章，綁定網站來源 | 不能：假網站的網域不同，瀏覽器不會讓那把金鑰替它簽 | 帳號復原流程要另外設計；裝置遺失時的備援 |

### TOTP 怎麼算

TOTP（RFC 6238）建立在 HOTP（RFC 4226）上：

1. 註冊時，伺服器產生一把隨機 secret（RFC 4226 要求至少 128 bits，建議 160 bits），用 Base32 編碼放進一個 `otpauth://` 網址，顯示成 QR code 讓 App 掃描。
2. 計數器 `C = floor(現在的 Unix 時間 / 30)`。
3. `HMAC-SHA1(secret, C)` 得到 20 bytes。
4. **動態截斷**：取最後一個 byte 的低 4 bits 當位移量，從那裡取 4 bytes，去掉最高位，得到一個 31-bit 整數。
5. 取它除以 10⁶ 的餘數，補滿 6 位數。

App 和伺服器各自算，結果相同就通過。沒有任何網路往返，所以手機離線也能用。伺服器端要做的另外幾件事：

- **容許時間誤差**：同時接受前後各一個時間步（共 90 秒的窗口），太大就讓轉送攻擊更容易。
- **同一個碼只能用一次**：RFC 6238 要求驗證成功後不能接受同一個 OTP 第二次。記下最後成功的時間步，小於等於它的一律拒絕。
- **限制嘗試次數**：6 位數只有一百萬種，不限次數的話可以暴力試。
- **註冊時要使用者輸入一次碼確認**，確定 App 真的存好了 secret，才把 MFA 標記為啟用。同時發一組**復原碼**（只存雜湊、每個只能用一次）。
- secret 要加密存放，和資料庫的其他資料分開金鑰管理。

### WebAuthn 與 passkey

WebAuthn（W3C 規格）讓網站用公開金鑰取代共享祕密：

- **註冊**：伺服器送一個隨機 challenge 與網站識別（RP ID，通常是網域）。裝置上的驗證器產生一對金鑰，私鑰留在裝置，公鑰與 credential id 回傳給伺服器存起來。
- **登入**：伺服器送新的 challenge；驗證器在使用者確認（指紋、PIN）後用私鑰簽章。簽章涵蓋瀏覽器填入的來源（origin）與 challenge，伺服器用存著的公鑰驗證，並檢查 origin 與 RP ID 是自己的。

抗釣魚來自這個綁定：使用者在 `examp1e.com` 上按下登入，瀏覽器帶的是 `examp1e.com` 的來源，為 `example.com` 註冊的金鑰根本不會被拿出來用。伺服器只存公鑰，資料庫外洩也拿不到能登入的東西。

passkey 是可探索（discoverable）的 WebAuthn 憑證，使用者不用先輸入帳號，多數平台會在使用者的裝置之間同步。它結合了「擁有的裝置」與「解鎖裝置的指紋或 PIN」，可以單獨取代密碼。

### step-up：敏感操作再驗一次

登入時通過 MFA，不代表一小時後的「修改收款帳號」也該直接放行。高風險操作要求「最近 N 分鐘內做過 MFA」，否則要求再驗一次。OIDC 可以用 `max_age` 參數要求重新驗證，ID token 的 `auth_time`、`acr`、`amr` 聲明說明這次是何時、用什麼方式驗的；資源伺服器要求提升驗證等級的標準回應方式定義在 RFC 9470。

## SSO：SAML 與 OIDC

企業客戶通常要求「用我們公司的身分提供者（IdP）登入」，員工離職時在 IdP 停用就全部進不來。你的系統是 Service Provider（SAML 的用語）或 Relying Party（OIDC 的用語）。

| | SAML 2.0 | OIDC |
|---|---|---|
| 憑證格式 | XML 的 Assertion，以 XML Signature 簽章 | JWT 的 ID token |
| 怎麼傳到你的系統 | 常見是瀏覽器把簽好的 Assertion 用表單 POST 到你的 ACS 網址 | 授權碼流程：後端拿 code 換 token |
| 設定交換 | 雙方交換 XML metadata（含憑證） | issuer 網址 + discovery + JWKS |
| 適合 | 既有的企業 IdP、很多 B2B SaaS 的企業方案 | 新系統、手機 App、也要呼叫 API 的情境 |

驗 SAML Assertion 要檢查簽章、`Audience` 是自己、`Recipient` 與 `Destination` 是自己的 ACS 網址、`NotOnOrAfter` 沒過期、`InResponseTo` 對應自己發出的請求。XML 簽章驗證歷史上出過不少「簽章包裝」類的漏洞，務必用維護中的成熟函式庫，不要自己解析 XML 判斷。

多租戶 SaaS 支援 SSO 時還要注意：

- **網域驗證**：租戶聲稱「`@acme.com` 的人走我們的 IdP」之前，要先證明擁有 `acme.com`（例如 DNS TXT 紀錄），否則租戶 A 可以設定自己的 IdP 去宣告租戶 B 員工的 email。
- **帳號佈建**：第一次登入時自動建立帳號（JIT provisioning）很方便，但離職時不會自動停用；需要同步停用時用 SCIM（RFC 7643、7644）。
- 本地帳號綁 IdP 的 `issuer` + 使用者識別碼（SAML 的 NameID 或 OIDC 的 `sub`），理由和 [OAuth 2.0 與 OIDC](#/skill/oauth-oidc) 裡講的一樣。

## 實際程式：TOTP（RFC 6238）

下面用標準函式庫的 `hmac`、`hashlib`、`struct` 從頭實作 HOTP 與 TOTP，先用 RFC 附錄的測試向量確認實作正確，再模擬註冊、驗證、時間誤差與重放。所有時間都用固定的數字，每次執行結果都一樣。

```python run
import hmac, hashlib, struct, base64
from urllib.parse import quote

# ---------- HOTP（RFC 4226）：HMAC(secret, 計數器) → 動態截斷 → 取後 N 位 ----------
def hotp(secret: bytes, counter: int, digits: int = 6) -> str:
    msg = struct.pack(">Q", counter)                  # 計數器：8 bytes、big-endian
    mac = hmac.new(secret, msg, hashlib.sha1).digest()
    offset = mac[-1] & 0x0F                           # 最後一個 byte 的低 4 bits 決定從哪裡取
    code = struct.unpack(">I", mac[offset:offset + 4])[0] & 0x7FFFFFFF   # 取 4 bytes、去掉最高位
    return str(code % 10 ** digits).zfill(digits)

# ---------- TOTP（RFC 6238）：計數器 = Unix 時間 // 時間步長 ----------
STEP = 30
def totp(secret: bytes, unix_time: int, digits: int = 6) -> str:
    return hotp(secret, unix_time // STEP, digits)

# 1) 用 RFC 的測試向量確認實作正確
key = b"12345678901234567890"
assert [hotp(key, c) for c in range(3)] == ["755224", "287082", "359152"]          # RFC 4226 附錄 D
for t, want in [(59, "94287082"), (1111111109, "07081804"), (1234567890, "89005924"),
                (2000000000, "69279037"), (20000000000, "65353130")]:             # RFC 6238 附錄 B
    assert totp(key, t, digits=8) == want, t
print("RFC 4226 / RFC 6238 測試向量全部符合")

# 2) 註冊：產生 secret（這裡用固定值方便重現；實際用 secrets.token_bytes(20)）
secret = bytes(range(1, 21))                          # 160 bits
b32 = base64.b32encode(secret).decode().rstrip("=")
uri = (f"otpauth://totp/{quote('Atlas Shop:alice@example.com')}"
       f"?secret={b32}&issuer={quote('Atlas Shop')}&algorithm=SHA1&digits=6&period={STEP}")
print("QR code 內容：", uri)

def load_secret(b32_text: str) -> bytes:
    s = b32_text.replace(" ", "").upper()             # 使用者手動輸入時常有空白、小寫
    return base64.b32decode(s + "=" * (-len(s) % 8))  # 補回 Base32 的 padding
assert load_secret(b32.lower()) == secret

# 3) 驗證：容許前後一個時間步、常數時間比較、拒絕重放
class TotpVerifier:
    def __init__(self, secret, window=1):
        self.secret, self.window = secret, window
        self.last_step = -1                           # 最後一次成功的時間步（存在資料庫）

    def verify(self, code: str, now: int) -> str:
        current = now // STEP
        for step in range(current - self.window, current + self.window + 1):
            if hmac.compare_digest(hotp(self.secret, step), code):    # 不用 ==
                if step <= self.last_step:
                    return "拒絕：這個碼已經用過（重放）"
                self.last_step = step
                return f"通過（時間步偏差 {step - current:+d}）"
        return "拒絕：碼不正確或已過期"

NOW = 1_792_483_215                                   # 固定的「伺服器現在時間」
v = TotpVerifier(secret)
phone_code = totp(secret, NOW)                        # 手機在同一時間算出的碼
print(f"\n現在的碼 {phone_code}")
print("  第一次送出：", v.verify(phone_code, NOW))
print("  同一個碼再送一次：", v.verify(phone_code, NOW + 5))

slow_phone = totp(secret, NOW + 3 * STEP - 40)        # 手機時鐘慢了 40 秒，使用者在下一步才送
print("  手機慢 40 秒：", TotpVerifier(secret).verify(slow_phone, NOW + 3 * STEP))
old = totp(secret, NOW - 5 * STEP)                    # 2 分半前的碼
print("  2 分半前的碼：", TotpVerifier(secret).verify(old, NOW))
print("  亂猜 000000：", TotpVerifier(secret).verify("000000", NOW))
```

這段程式省略了正式環境要有的兩件事：**嘗試次數限制**（同一個帳號幾次失敗就暫停一段時間）與 **secret 加密儲存**。TOTP 的 secret 和密碼不同，伺服器每次都要用原文計算，所以不能只存雜湊。

## 常見錯誤與錯誤訊息

| 症狀或訊息 | 原因 | 怎麼修 |
|---|---|---|
| TOTP 驗證碼一直錯，但 App 上看起來正常 | 伺服器時鐘不準（沒跑 NTP）；或手機時間是手動設定的 | 伺服器跑 NTP；驗證時記下偏差的時間步，偏差持續出現就是時鐘問題 |
| 手動輸入 secret 後產生的碼不對 | Base32 字串有空白、小寫，或少了 padding，解碼失敗或解成別的值；Python 會丟 `binascii.Error: Incorrect padding` | 解碼前去空白、轉大寫、補 `=`（如上面的 `load_secret`） |
| 用了 SHA-256 或 8 位數，有些 App 產生的碼都不對 | 部分 Authenticator App 會忽略 `algorithm`、`digits`、`period` 參數，固定用 SHA-1、6 位、30 秒 | 用 SHA-1、6 位、30 秒這組最相容的設定 |
| 同一個 TOTP 在 30 秒內能登入兩次 | 沒有記錄最後使用的時間步 | 存 `last_step`，小於等於它的一律拒絕 |
| API key 出現在 CDN 或代理伺服器的 log 裡 | key 放在 query string | 改放 `Authorization` header；已經出現在 log 的 key 視為外洩，輪替 |
| client credentials 換 token 回 `{"error": "invalid_client"}` | client_id 或 secret 錯、用了授權伺服器不支援的驗證方式（Basic header 與表單參數） | 對照 discovery 的 `token_endpoint_auth_methods_supported`；檢查 secret 有沒有多餘的換行 |
| nginx 回 `400 No required SSL certificate was sent` | 開了 `ssl_verify_client on`，客戶端沒有出示憑證 | 確認客戶端有設定憑證與私鑰；用 `openssl s_client -connect host:443 -cert client.pem -key client.key` 測試 |
| `openssl s_client` 顯示 `verify error:num=20:unable to get local issuer certificate` | 驗證端沒有信任簽發這張憑證的 CA，或客戶端沒有送出中繼憑證 | 把內部 CA 加入驗證端的信任清單；客戶端送完整的憑證鏈 |
| 瀏覽器呼叫 WebAuthn 時丟出 `SecurityError` | 設定的 RP ID 不是目前網頁網域本身或它的上層網域 | RP ID 設成網站的網域（例如 `example.com`），頁面要在這個網域或其子網域下 |

## 動手

1. 在上面的 TOTP 範例裡，把 `TotpVerifier` 的 `window` 改成 `0`，看「手機慢 40 秒」那一行的結果；再改成 `5`，看「2 分半前的碼」會不會通過。窗口越大越方便，被轉送的碼可用時間也越長。
2. 把 `verify` 裡的 `hmac.compare_digest(...)` 換成 `==`，結果看起來一樣——差別在比較時間是否隨著「前面猜對幾個字」而改變。想一想為什麼網路上的計時攻擊仍值得防。
3. 用手機的 Authenticator App 手動輸入範例印出的 Base32 secret（`AEBAGBAFAYDQQCIKBMGA2DQPCAIREEYU`），比對 App 顯示的碼和 `totp(secret, 現在時間)` 的結果。把 `NOW` 改成 `int(time.time())`（要先 `import time`）。
4. 開 [OAuth 三種流程](#/lab/DeviceCodeLab) 實驗室，切到 Client Credentials，對照它和授權碼流程少了哪些步驟。
5. 為自己的系統列一張表：每個機器憑證（API key、資料庫密碼、雲端金鑰）屬於誰、scope、到期日、最後使用時間。缺的欄位就是下一步要補的，設計方法見 [金鑰的範圍與壽命](#/skill/key-scope-lifetime)。

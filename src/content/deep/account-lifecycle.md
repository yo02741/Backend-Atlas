## 從一個具體問題開始：一個「忘記密碼」頁面的三個漏洞

一個系統的忘記密碼功能是這樣做的：

1. 使用者輸入 email。系統查不到時回「此 email 尚未註冊」，查到時回「重設信已寄出」。
2. 重設連結是 `https://app.example.com/reset?token=<token>`，token 原樣存在 `users.reset_token` 欄位，沒有期限。
3. 使用者設定新密碼後，系統更新密碼，其他事情都沒做。

三個問題：

- **帳號列舉**：攻擊者拿一份 email 清單逐一送出，從回應的差異就知道哪些人在這個系統有帳號，接著拿去做撞庫（用其他網站外洩的密碼嘗試登入）或精準釣魚。
- **token 等於密碼，而且永久有效**：資料庫備份外洩，或任何能讀這張表的人（包括 SQL injection），都能直接用裡面的 token 重設任何人的密碼。一封幾個月前沒用到的重設信被翻出來，也還能用。
- **重設後舊的登入還在**：使用者是因為懷疑帳號被盜才重設密碼，但攻擊者手上的 session 與 refresh token 依然有效，重設什麼也沒擋住。

註冊、驗證 email、重設密碼、鎖定、登出所有裝置、刪除帳號，這些流程看起來各自獨立，其實共用同一組機制：**一次性 token**、**不洩漏帳號是否存在**、**狀態改變時撤銷既有的登入**。這一課依序拆開。

## 一次性 token：共同的做法

驗證 email、重設密碼、確認改 email、魔法連結登入，都是寄一個連結給使用者，點了就證明「這個人收得到這個信箱」。這種 token 的做法幾乎一樣：

| 項目 | 做法 | 原因 |
|---|---|---|
| 產生 | `secrets.token_urlsafe(32)`（256 bits 隨機） | 要用密碼學安全的亂數；`random` 模組可預測，不能用 |
| 儲存 | 只存 **SHA-256 雜湊**，明文只出現在寄出的信裡 | 資料庫外洩時拿不到可用的 token。token 本身是高熵亂數，不需要 bcrypt 這類慢雜湊（慢雜湊是為了保護低熵的人類密碼） |
| 用途 | 每筆記錄 `purpose`（`verify_email`、`reset_password`…） | 驗證 email 的 token 不能拿來重設密碼 |
| 期限 | 存 `expires_at`；重設密碼通常幾十分鐘、驗證 email 可以長一些（例如 24 小時） | 越短，信箱被看到、連結被轉寄的風險越小 |
| 一次性 | 用過就標記 `used_at` 或直接刪掉；同一個使用者發新 token 時，舊的同用途 token 一併作廢 | 防止重複使用 |
| 比對 | 用雜湊去查表；需要比對兩個秘密值時用 `hmac.compare_digest` | 避免比對時間洩漏資訊 |

資料表可以長這樣，可以直接在 PostgreSQL 裡試：

```sql run
CREATE TABLE account_tokens (
  token_hash  text PRIMARY KEY,                 -- sha256(token) 的十六進位，不存明文
  user_id     int  NOT NULL REFERENCES users(id),
  purpose     text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password', 'change_email')),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);

-- 發 token：應用程式產生隨機 token，寄出明文、存雜湊（這裡用固定字串示範）
INSERT INTO account_tokens (token_hash, user_id, purpose, expires_at)
VALUES (encode(sha256(convert_to('demo-token-123', 'UTF8')), 'hex'), 1, 'reset_password', now() + interval '30 minutes');

-- 兌換：一句完成「找到、未過期、未使用、用途正確」並標記已使用；回傳 0 列就是無效
UPDATE account_tokens
SET used_at = now()
WHERE token_hash = encode(sha256(convert_to('demo-token-123', 'UTF8')), 'hex')
  AND purpose = 'reset_password'
  AND used_at IS NULL
  AND expires_at > now()
RETURNING user_id, purpose;
```

最後那句 `UPDATE … RETURNING` 把檢查與標記放在同一句裡，兩個請求同時拿同一個 token 來兌換時，只有一個會成功（原理見 [交易與隔離等級](#/skill/transactions)）。

連結本身也有兩個細節：

- **不要在 GET 就把 token 用掉**。很多企業郵件系統會預先打開信裡的連結做掃毒，GET 一來 token 就沒了。點連結只顯示表單，送出新密碼（POST）時才兌換。
- 重設頁面設 `Referrer-Policy: no-referrer`，避免網址裡的 token 透過 `Referer` 標頭送到頁面載入的第三方資源（分析工具、字型 CDN）。

用 Python 標準函式庫寫一次產生與驗證，可以直接執行：

```python run
import hashlib, hmac, secrets
from datetime import datetime, timedelta, timezone

TTL = timedelta(minutes=30)
store = {}          # token_hash -> {"user_id", "purpose", "expires_at", "used"}

def digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()

def issue(user_id: int, purpose: str, now: datetime) -> str:
    # 同一個使用者、同一個用途，舊的 token 一律作廢
    for rec in store.values():
        if rec["user_id"] == user_id and rec["purpose"] == purpose:
            rec["used"] = True
    token = secrets.token_urlsafe(32)              # 寄出去的是明文
    store[digest(token)] = {"user_id": user_id, "purpose": purpose,
                            "expires_at": now + TTL, "used": False}
    return token

def redeem(token: str, purpose: str, now: datetime):
    rec = store.get(digest(token))                 # 用雜湊查，資料庫裡沒有明文
    if rec is None or rec["used"] or rec["purpose"] != purpose or now >= rec["expires_at"]:
        return None
    rec["used"] = True                             # 一次性
    return rec["user_id"]

def same_secret(a: str, b: str) -> bool:
    # 兩個秘密值直接比對時（例如簽章），用常數時間比較
    return hmac.compare_digest(a.encode(), b.encode())

now = datetime(2026, 1, 5, 9, 0, tzinfo=timezone.utc)
t1 = issue(42, "reset_password", now)
t2 = issue(42, "reset_password", now + timedelta(minutes=1))   # 使用者按了兩次「寄送」
print("舊 token：", redeem(t1, "reset_password", now + timedelta(minutes=2)))   # None：已被新 token 作廢
print("新 token：", redeem(t2, "reset_password", now + timedelta(minutes=2)))   # 42
print("再用一次：", redeem(t2, "reset_password", now + timedelta(minutes=3)))   # None：一次性
t3 = issue(7, "reset_password", now)
print("過期：", redeem(t3, "reset_password", now + timedelta(minutes=31)))       # None
print("用途不符：", redeem(issue(7, "verify_email", now), "reset_password", now))  # None
print("compare_digest：", same_secret(digest(t2), digest(t2)))
print("資料庫裡存的長這樣：", list(store)[0][:16] + "…")
```

另一種做法是**簽章 token**（例如 HMAC 簽了 `user_id` 與到期時間），不用存資料庫。缺點是很難做到「一次性」與「發新的就作廢舊的」——常見補法是把密碼雜湊的一部分或一個版本號簽進去，密碼一改舊 token 自然失效。需要可撤銷時，存資料庫的版本比較直白。

## 註冊與 email 驗證

註冊時要處理的事：

- **email 正規化與唯一**：去掉前後空白、轉小寫後再檢查唯一（`CREATE UNIQUE INDEX ON users (lower(email))`）。規格上 email 的 `@` 前半段可以區分大小寫，但實務上幾乎所有郵件服務都不區分，統一轉小寫可以避免同一個人註冊出兩個帳號。
- **密碼**：用 Argon2id、bcrypt 這類慢雜湊存（見 [密碼儲存](#/skill/password-storage)）；檢查最小長度並比對已外洩密碼清單，比規定「要有大寫、數字、符號」有效。
- **未驗證狀態**：帳號建立後是 `email_verified = false`。未驗證時能做什麼要明確定義——常見做法是可以登入，但不能做會對外寄信、付款、邀請別人這類動作，避免有人用別人的 email 註冊後冒用身分。
- **重寄驗證信要節流**：同一個帳號、同一個 IP 在一段時間內只能寄幾封，否則你的寄信功能會被拿來轟炸別人的信箱。

註冊也有帳號列舉問題：「此 email 已被註冊」直接告訴攻擊者這個人有帳號。完全避免的做法是不論 email 是否存在都回一樣的訊息（「請到信箱收信完成註冊」），已存在的帳號則改寄一封「有人用你的 email 嘗試註冊，若是你本人可以直接登入或重設密碼」。這會讓註冊流程多一步，是否值得取決於帳號是否存在本身有多敏感（例如醫療或交友服務）。

## 忘記密碼

一個完整的流程：

1. 使用者輸入 email。**不論帳號存不存在，回應都一樣**：「如果這個 email 有註冊，我們已寄出重設信」。
2. 回應時間也要接近：帳號存在時才去產生 token、寄信，回應會明顯變慢，攻擊者從時間差就能分辨。把寄信丟到背景佇列（見 [佇列與背景工作](#/skill/queues-workers)），兩種情況都立刻回應。
3. 帳號存在時：作廢這個使用者其他未使用的重設 token，發一個新的（短效、一次性、存雜湊），寄出連結。
4. 使用者點連結，看到設定新密碼的表單；送出時才兌換 token。
5. 兌換成功後：
   - 更新密碼雜湊。
   - **撤銷這個使用者所有的 session 與 refresh token**（包括正在操作的這一個以外的全部）。
   - 寄一封「你的密碼已被變更」通知信到帳號的 email，附上「不是我」的處理方式。
   - 請使用者用新密碼正常登入一次，而不是自動登入（OWASP 的忘記密碼指引也是這樣建議）。
6. 重設密碼**不能繞過 MFA**：有開 MFA 的帳號，重設後登入仍然要第二因素；否則拿到信箱就等於拿到整個帳號。

## 登入失敗：鎖定與節流

「連續錯 5 次就鎖帳號 30 分鐘」很常見，但它有一個副作用：任何知道你 email 的人，都能每 30 分鐘故意輸錯 5 次，讓你永遠登入不了。攻擊者還可以對整份使用者清單這樣做。

實際的攻擊也通常不是對一個帳號猜很多次，而是：

- **撞庫**（credential stuffing）：拿外洩的帳號密碼組合，每個帳號只試一兩次，分散在大量 IP。
- **密碼噴灑**（password spraying）：拿幾個常見密碼，對大量帳號各試一次。

這兩種都不會觸發「單一帳號錯 5 次」。比較有用的組合是：

| 維度 | 做法 |
|---|---|
| 帳號 + IP | 同一個 IP 對同一個帳號連續失敗，暫時擋住**這個組合**；同一個帳號從其他地方（使用者本人）仍可登入 |
| 單一 IP | 同一個 IP 對**很多不同帳號**失敗，代表在噴灑或撞庫，對這個 IP 限流或要求 CAPTCHA |
| 單一帳號（全部來源加總） | 門檻設高一些；超過時不是直接鎖死，而是要求額外驗證（CAPTCHA、email 驗證碼）並通知使用者 |
| 逐步延遲 | 失敗越多次，下一次允許嘗試的間隔越長，比一刀切的鎖定溫和 |

幾個細節：

- 錯誤訊息一律「帳號或密碼錯誤」，不要分「帳號不存在」與「密碼錯誤」。
- **不存在的帳號也要計數、也要花一樣的時間**：帳號不存在時直接回應會比做一次密碼雜湊比對快很多。可以對一個假的雜湊做一次驗證，讓時間接近。
- 鎖定或限流時的回應也不能洩漏帳號是否存在。
- 計數要放在共用的儲存（Redis 等），多台伺服器才會一致（限流的實作見 [限流](#/skill/rate-limiting)）。
- 登入成功後清掉該「帳號 + IP」的失敗計數。

## Session：登出所有裝置、重新驗證

### 登出所有裝置

需要撤銷全部登入的時機：使用者按「登出所有裝置」、重設或變更密碼、管理員停用帳號、偵測到可疑登入。做法取決於登入狀態怎麼存（見 [驗證基礎：Session vs Token](#/skill/authn-basics)）：

- **伺服器端 session**：session 表有 `user_id` 欄位，`DELETE FROM sessions WHERE user_id = $1` 即可。用 Redis 時要另外維護「使用者 → session id 清單」的索引，否則找不到某個使用者的全部 session。
- **JWT access token + refresh token**：refresh token 存在資料庫，全部撤銷；access token 收不回來，只能等它過期（所以效期要短）。需要立即生效時，在使用者資料上存一個 `sessions_valid_after` 時間戳或 `token_version`，驗證 token 時比對 `iat` 或版本號——這等於每個請求都要查一次使用者狀態（可以快取）。

### 敏感操作要重新驗證

已經登入不代表可以做任何事。session 可能被偷、電腦可能沒鎖。下面這些操作要求使用者**在近期內重新輸入密碼或通過 MFA**（例如 5–15 分鐘內驗證過），而不是只看 session 存在：

- **改密碼**：要輸入目前的密碼。成功後撤銷其他裝置的 session。
- **改 email**：寄確認信到**新**的地址，點了才生效；同時寄通知到**舊**的地址，附上撤銷這次變更的方法。如果只寄確認到新地址，盜用者改完 email 之後，原主人連重設密碼的信都收不到。
- **關閉 MFA、新增 API key、改收款帳號、刪除帳號**。

## 停用與刪除帳號

- **停用**（disabled / suspended）：帳號狀態改成停用，並撤銷所有 session、refresh token、API key。登入時與每次換發 token 時都要檢查狀態——只在登入時檢查的話，停用前發出去的 token 仍然可用到過期。
- **使用者自行刪除**：要重新驗證；常見做法是先進入一段「待刪除」期（例如 14–30 天，期間登入可取消），期滿再由背景工作執行真正的刪除。
- **刪什麼、留什麼**：個人資料（姓名、email、地址）刪除或匿名化；訂單、發票這類依法規需要保存的紀錄，可能要保留但與個人資料切開。具體要保留什麼、多久，取決於適用的法規，要和法務確認，這裡無法一概而論。
- **email 能不能再註冊**：刪除後同一個 email 重新註冊時，不能接回舊帳號的任何資料或權限。若有保留紀錄，用內部 id 而不是 email 關聯。
- **外部的副本**：搜尋索引、快取、資料倉儲、備份、寄給第三方的資料，都要列進刪除流程的清單，否則「刪除」只刪了主資料庫。

## 常見錯誤

| 錯誤 | 後果 | 修正 |
|---|---|---|
| 「此 email 未註冊」 | 帳號列舉 | 不論是否存在回同樣訊息；寄信放背景，回應時間一致 |
| token 明文存在資料庫 | 資料庫外洩 = 所有待用的重設連結可用 | 存 SHA-256 雜湊 |
| token 沒有期限、可重複使用 | 舊信件、轉寄、瀏覽器歷史都能重用 | `expires_at` + `used_at`；發新的作廢舊的 |
| 在 GET 就兌換 token | 郵件掃描器先點掉，使用者點的時候已失效 | GET 顯示表單，POST 才兌換 |
| 重設密碼後沒撤銷 session | 盜用者的登入繼續有效 | 撤銷全部 session 與 refresh token，並通知使用者 |
| 錯 N 次直接鎖死帳號 | 任何人都能讓別人登入不了 | 以「帳號 + IP」為單位限制、逐步延遲、CAPTCHA |
| 改 email 只寄確認到新地址 | 盜用者改完 email 後，原主人無法取回帳號 | 新地址確認 + 舊地址通知與撤銷連結 + 重新驗證 |
| 停用只擋登入 | 已發出的 token 繼續可用 | 撤銷 token；換發與敏感操作時檢查帳號狀態 |
| 用 `random` 產生 token | 可被預測 | 用 `secrets` |

## 動手

1. 跑上面的 Python 範例，把 `TTL` 改成 1 分鐘，看哪幾行的結果會變。
2. 在 SQL 範例最後再跑一次同一句 `UPDATE … RETURNING`，確認第二次回傳 0 列（一次性）。
3. 做這一課的程式題：實作以「帳號 + IP」為單位的登入節流，同時讓攻擊者鎖不住真正的使用者。
4. 對照 [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)，逐條檢查自己的重設流程。

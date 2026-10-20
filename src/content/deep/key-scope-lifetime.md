## 從一個具體問題開始：一把沒有範圍、沒有期限的金鑰

2026 年 8 月，Zeabur 發布了一份資安事件報告（[官方報告](https://zeabur.com/blogs/august-2026-security-incident)）。依報告的描述，事件的順序是：

| 步驟 | 發生什麼 |
|---|---|
| 1 | 共享叢集上，某個用戶部署了 NextChat v2.16.1。這個版本有 CVE-2026-7644：MCP 功能的授權檢查不足。攻擊者利用它在容器內取得執行權 |
| 2 | 攻擊者從共享叢集的內網，讀到路由快取中的 Legacy API Key |
| 3 | 其中一把是**團隊管理員**金鑰 |
| 4 | 攻擊者再取得 AWS root 金鑰，並連進正式資料庫 |
| 5 | 讀走環境變數中的第三方 API 金鑰、資料庫密碼與其他服務憑證 |

報告指出，Legacy API Key **沒有權限範圍、沒有期限**。事後的處置是停用所有 Legacy API Key，新的 Access Token 支援範圍、到期日與稽核紀錄。

起點是一個應用程式的漏洞，這種事情任何平台都可能遇到。讓它從「一個容器」擴大到「雲端 root 與正式資料庫」的，是一路上拿到的憑證都沒有邊界。這一課從這個事件出發，看一把金鑰該有哪三個控制面，以及怎麼設計一個 API key 系統。以下對事件的分析是依報告公開內容所做的推論，不代表報告本身的結論；事件細節以官方報告為準。

## 三個控制面

每一把金鑰（API key、access token、雲端 access key、資料庫密碼）都可以用同樣三個問題檢查：

| 控制面 | 問的問題 | 具體做法 |
|---|---|---|
| **範圍** | 這把金鑰被偷了，攻擊者能做什麼？ | scope 只給需要的權限（唯讀就不給寫）；限定資源（某個專案、某個服務，不是整個團隊）；必要時限定來源（IP、網段、工作負載身分） |
| **壽命** | 被偷之後，攻擊者能用多久？ | 一定有到期日；定期輪替；能立即撤銷；能用短效 token 的地方不用長效 key |
| **可觀測** | 被偷了，我們會知道嗎？知道之後查得出影響範圍嗎？ | 每次使用寫稽核紀錄（誰、從哪、做了什麼）；記錄最後使用時間；記錄誰建立、為了什麼；異常使用告警 |

三者缺一的後果不同：沒有範圍，偷到就是全部；沒有壽命，偷到就是永遠；沒有可觀測，偷到了也沒人發現，發現了也不知道被拿走什麼。

### 用三個控制面回看事件

下表是推論：如果每個控制面存在，**可能**在哪一步縮小傷害。這不是說有了它就一定擋得住，而是每一層都在縮小攻擊者下一步能拿到的東西。

| 步驟 | 範圍 | 壽命 | 可觀測 |
|---|---|---|---|
| 1. 應用漏洞取得容器執行權 | 這一步與平台金鑰無關；是用戶應用的漏洞 | | 容器內異常的程序或對外連線，是最早可以發現的訊號 |
| 2. 從內網讀到路由快取中的金鑰 | 路由這種功能只需要「轉送」的能力。若快取裡只有權限限縮到路由用途的憑證，或只存驗證用的雜湊，讀到也拿不到可以管理團隊的東西 | 金鑰有到期日時，就算被讀到，可以使用的時間也有上限 | 快取被非預期的來源讀取 |
| 3. 拿到團隊管理員金鑰 | 管理員金鑰若限定在特定操作、特定資源，或限定只能從管理介面的來源使用，從用戶容器所在的網路拿去用會被拒絕 | 管理權限用短效 token（例如幾小時，用完即失效），被偷後可用的時間窗大幅縮短 | 管理員金鑰從一個從未出現過的來源被使用，這是高訊號的告警 |
| 4. 取得 AWS root 金鑰 | AWS 官方的建議是不要為 root 使用者建立 access key，日常操作用權限受限的 IAM 角色。root 金鑰不存在，這一步就拿不到 root | 角色的臨時憑證會自動到期 | 雲端的 API 呼叫紀錄可以看到異常身分或來源的使用 |
| 5. 讀走環境變數中的各種金鑰 | 每把被讀走的金鑰若有範圍，損失依各自的範圍為限 | 有到期日的金鑰，事後輪替的壓力與殘留風險較小 | 知道每把金鑰最後使用時間與來源，才能判斷哪些被拿去用過 |

這張表也顯示了事後處置的意義：停用 Legacy API Key、讓新的 Access Token 有範圍、到期日與稽核紀錄，正好對應三個控制面。

## 設計一個 API key 系統

以一個虛構的部署平台 `atlas` 為例，設計它給使用者的 API key。

### 格式：一眼就認得出來

```text
atl_live_Xb3kQ9vT2mN8pL4rW7yZ1cF6hJ0sD5gA8eK3nM2qR9u_3f9a1c
└─┬─┘└┬─┘└──────────────────── 隨機 ────────────────────┘└checksum┘
 產品  環境（live / test）           256 bits 密碼學亂數            尾端校驗碼
```

- **前綴**讓人和工具一眼認出這是什麼：log 裡看到 `atl_live_` 就知道是正式環境的 atlas 金鑰。secret 掃描工具也能靠固定前綴精準比對，誤判少。
- **環境分開**：`test` 的 key 打正式環境直接拒絕，避免測試設定誤用到正式。
- **校驗碼**讓格式錯誤的字串不用查資料庫就能拒絕，掃描工具也能離線判斷「這像不像一把真的 key」。有些平台的 token 格式就在尾端放校驗碼（例如 GitHub 的 token 格式）。
- **亂數**用作業系統的密碼學亂數（Python 的 `secrets`），長度至少 128 bits，常見是 256 bits。

### 儲存：只存雜湊，只顯示一次

伺服器只存 `SHA-256(key)`。建立時把完整 key 顯示給使用者**一次**，之後任何介面都只顯示前綴與最後幾個字元（`atl_live_Xb3k…6c1c`），讓使用者分辨是哪一把。

為什麼這裡用 SHA-256 就夠，密碼卻要用 bcrypt、Argon2 這類慢雜湊？差別在亂度：

| | 使用者密碼 | API key |
|---|---|---|
| 亂度 | 人想的，常見密碼字典幾百萬個就能涵蓋大部分 | 256 bits 亂數，猜中的機率可以忽略 |
| 雜湊外洩後的攻擊 | 拿字典逐一算雜湊比對，所以要用慢雜湊拖慢 | 沒有字典可以用，快雜湊也算不完 |
| 驗證頻率 | 登入時一次 | 每個 API 請求都要驗，慢雜湊的成本無法接受 |

快雜湊還有一個好處：可以直接用雜湊值當索引查詢。密碼的部分見 [密碼儲存](#/skill/password-storage)；雜湊與 HMAC 的差異見 [密碼學工具箱](#/skill/crypto-toolbox)。

### 資料表

```sql run
-- API key 的資料表：完整 key 不落地，只有雜湊
CREATE TABLE api_keys (
  id           text PRIMARY KEY,                 -- 公開的識別碼，介面與稽核紀錄用它
  key_hash     bytea NOT NULL UNIQUE,            -- SHA-256(完整 key)
  name         text NOT NULL,                    -- 用途：「CI 部署 site 專案」
  scopes       text[] NOT NULL,                  -- 例如 {deploy:write}
  resource     text,                             -- 限定資源；NULL 代表不限，應該很少見
  created_by   bigint NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,             -- 必填：系統裡沒有「永不過期」
  last_used_at timestamptz,
  revoked_at   timestamptz,
  CHECK (expires_at <= created_at + interval '365 days')   -- 壽命上限一年
);

INSERT INTO api_keys (id, key_hash, name, scopes, resource, created_by, created_at, expires_at, last_used_at) VALUES
  ('k_8f3k2m', sha256('atl_live_demo_one'),   'CI 部署 site', '{deploy:write}', 'project:site', 1, now() - interval '200 days', now() + interval '5 days',   now() - interval '1 hour'),
  ('k_q71zx0', sha256('atl_live_demo_two'),   '報表匯出',     '{reports:read}', 'project:bi',   2, now() - interval '120 days', now() + interval '60 days',  now() - interval '100 days'),
  ('k_m2c9aa', sha256('atl_live_demo_three'), '測試用',       '{team:admin}',   NULL,           3, now() - interval '30 days',  now() + interval '300 days', NULL);

-- 定期檢視：哪些 key 該輪替、該撤銷、範圍太大
SELECT k.id, k.name, u.name AS owner, k.scopes, k.resource,
       CASE
         WHEN k.expires_at < now() + interval '7 days' THEN '7 天內到期，該輪替'
         WHEN k.last_used_at IS NULL OR k.last_used_at < now() - interval '90 days' THEN '90 天沒用，考慮撤銷'
         ELSE 'ok'
       END AS lifetime_review,
       CASE WHEN 'team:admin' = ANY (k.scopes) OR k.resource IS NULL THEN '範圍過大' ELSE 'ok' END AS scope_review
FROM api_keys k JOIN users u ON u.id = k.created_by
WHERE k.revoked_at IS NULL
ORDER BY k.id;
```

`CHECK` 讓「永不過期」或「十年後到期」的 key 根本建不起來：壽命的規則寫在資料庫約束裡，不靠每個 API 記得檢查。

### 驗證流程

每個請求進來：

1. 檢查格式：前綴、環境、校驗碼。不符直接 401，不查資料庫。
2. 算 SHA-256，用雜湊查資料表。查不到 401。
3. 檢查 `revoked_at`、`expires_at`。失效 401，並在錯誤訊息裡說明是過期還是撤銷（不洩漏其他資訊）。
4. 檢查這個操作需要的 scope 與資源。不符 403。
5. 更新 `last_used_at`（可以批次寫入，不必每個請求都寫一次資料庫），寫稽核紀錄。

### 生命週期操作

- **建立**：必填用途、scope、資源、到期日（預設 90 天，上限 365 天）。建立者記錄下來。
- **輪替**：先建新的、部署新的、確認舊的 `last_used_at` 不再更新、再撤銷舊的。兩把同時有效的期間就是不停機的切換窗。
- **撤銷**：立即生效，因為每個請求都查資料表。
- **到期前通知**：到期前 14 天、3 天通知建立者。
- **人員異動**：建立者離職時，他建立的 key 列出來交接或撤銷；服務用的 key 應該掛在服務帳號或團隊名下，不掛在個人身上。

## 實際程式：產生、只存雜湊、驗證 scope 與到期

```python run
import hashlib, secrets, zlib
from datetime import datetime, timedelta, timezone

TPE = timezone(timedelta(hours=8))
PREFIX = "atl_live_"

def _checksum(body: str) -> str:
    return format(zlib.crc32(body.encode()), "08x")[:6]

def generate_key() -> str:
    body = secrets.token_urlsafe(32)                 # 256 bits 密碼學亂數
    return PREFIX + body + "_" + _checksum(body)

def well_formed(key: str) -> bool:
    if not key.startswith(PREFIX) or "_" not in key[len(PREFIX):]:
        return False
    body, _, check = key[len(PREFIX):].rpartition("_")
    return _checksum(body) == check                  # 打錯字或亂編的字串不用查資料庫

DB = {}                                              # key_hash → 紀錄；完整 key 不在這裡

def create_key(name, scopes, resource, created_by, now, days=90):
    key = generate_key()
    DB[hashlib.sha256(key.encode()).hexdigest()] = {
        "name": name, "scopes": set(scopes), "resource": resource, "created_by": created_by,
        "expires_at": now + timedelta(days=days), "last_used_at": None, "revoked": False,
    }
    return key                                       # 只回傳這一次

def authorize(key, scope, resource, now):
    if not well_formed(key):
        return 401, "malformed_key"
    # 用雜湊值查表：攻擊者無法控制雜湊值，查詢時間不會洩漏 key 的內容
    rec = DB.get(hashlib.sha256(key.encode()).hexdigest())
    if rec is None:
        return 401, "invalid_key"
    if rec["revoked"]:
        return 401, "key_revoked"
    if now >= rec["expires_at"]:
        return 401, "key_expired"
    if scope not in rec["scopes"]:
        return 403, f"insufficient_scope（需要 {scope}）"
    if rec["resource"] is not None and rec["resource"] != resource:
        return 403, f"resource_not_allowed（這把 key 只能用在 {rec['resource']}）"
    rec["last_used_at"] = now
    return 200, "ok"

now = datetime(2026, 10, 20, 9, 0, tzinfo=TPE)
ci_key = create_key("CI 部署 site", ["deploy:write"], "project:site", "alice", now)
print("建立時顯示一次：", ci_key)
print("之後介面上只顯示：", ci_key[:13] + "…" + ci_key[-4:])
print("資料庫裡存的：", next(iter(DB))[:16] + "…（SHA-256）")
print()

typo = ci_key[:-1] + ("0" if ci_key[-1] != "0" else "1")
checks = [
    ("部署 site",               ci_key, "deploy:write", "project:site", now),
    ("拿去改團隊設定",           ci_key, "team:admin",   "project:site", now),
    ("拿去部署別的專案",         ci_key, "deploy:write", "project:billing", now),
    ("打錯一個字",               typo,   "deploy:write", "project:site", now),
    ("91 天後",                  ci_key, "deploy:write", "project:site", now + timedelta(days=91)),
]
for label, k, scope, res, t in checks:
    print(f"{label:<14}", *authorize(k, scope, res, t))

# 對照組：沒有範圍、沒有期限的舊式金鑰——什麼都能做，十年後也能用
legacy = create_key("legacy admin", ["deploy:write", "team:admin", "billing:admin"], None, "unknown", now, days=36500)
print()
for scope, res in [("team:admin", "project:site"), ("billing:admin", "project:billing")]:
    print("舊式金鑰", scope, "→", *authorize(legacy, scope, res, now + timedelta(days=3650)))

DB[hashlib.sha256(ci_key.encode()).hexdigest()]["revoked"] = True
print("\n撤銷後：", *authorize(ci_key, "deploy:write", "project:site", now))
print("最後使用時間：", DB[hashlib.sha256(ci_key.encode()).hexdigest()]["last_used_at"].isoformat())
```

輸出的最後兩組是重點：舊式金鑰十年後還能做任何事；有範圍、有期限的 key 拿去做別的事會被 403 擋下，過期與撤銷後是 401，而且系統知道它最後一次被用是什麼時候。

## 常見錯誤與錯誤訊息

| 錯誤 | 後果 | 怎麼修 |
|---|---|---|
| 資料庫存完整 key（或可逆加密） | 資料庫備份、唯讀帳號、SQL injection 任何一個外洩，全部 key 一起外洩 | 只存 SHA-256；驗證端用不到明文 |
| 只有一種 scope：`admin` | 每把 key 都是全部權限，範圍這個控制面形同不存在 | 依資源 × 動作切 scope（`deploy:read`、`deploy:write`、`billing:read`）；建立介面預設最小 |
| 到期日選填，預設永不過期 | 幾年後沒人知道哪些 key 還在用、能不能關 | 到期日必填、有上限，寫進資料庫約束 |
| 沒有 `last_used_at` | 不敢撤銷任何一把 key，因為不知道誰在用 | 記錄最後使用時間與來源；90 天沒用的列出來給建立者確認 |
| 401 與 403 不分 | 使用者看不出是 key 失效還是權限不夠 | 失效（無效、過期、撤銷）回 401；有效但權限不足回 403，並說明需要的 scope |
| key 出現在 URL query string | 會被寫進存取 log、Proxy log、瀏覽器歷史 | 只接受 `Authorization` 標頭 |
| 服務的 key 掛在個人名下 | 那個人離職，key 被撤銷，服務停擺；或沒人敢撤銷 | 服務用服務帳號；能用短效 token 的地方改用 Client Credentials（見 [Device Code、PKCE、Client Credentials](#/skill/oauth-device-pkce)）或 CI 的 OIDC（見 [CLI 與 Agent 的 token 存哪裡](#/skill/cli-token-storage)） |
| 只依前綴查 key、用 `==` 比對完整值 | 字串比對時間可能洩漏資訊 | 用雜湊查表；必須比對 secret 時用 `hmac.compare_digest` |

外洩之後的處理順序：先撤銷（或輪替）那把 key，再查稽核紀錄判斷它被用來做了什麼，最後才是清理外洩源頭（從 git 歷史移除、刪掉 log）。順序反過來，等於在清理的這段時間讓攻擊者繼續用。秘密外洩的一般處理見 [秘密管理](#/skill/secrets)。

## 動手

1. 執行資料表那段 SQL，看三把 key 各自被標成什麼；再試 `INSERT` 一把 `expires_at` 是 `now() + interval '10 years'` 的 key，看 `CHECK` 約束擋下的錯誤訊息。
2. 執行 Python 範例，對照每一行輸出是 401 還是 403、為什麼。
3. 在 [Playground](#/playground?lang=python) 為 `authorize` 加上「來源限制」：紀錄多一個 `allowed_networks`，請求帶來源 IP（用標準函式庫的 `ipaddress` 判斷是否在網段內），不在範圍內回 403。
4. 把自己手上的金鑰（雲端、SaaS、CI）列一張表，每一把填三欄：範圍、到期日、在哪裡看得到使用紀錄。填不出來的那一格，就是要先補的地方。管理大量下游憑證的集中做法見 [MCP Gateway](#/skill/mcp-gateway)。

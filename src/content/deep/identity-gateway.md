## 從一個具體問題開始：七個內部工具、七套登入

一家公司有七個內部工具：部署面板、報表系統、wiki、feature flag 後台、資料查詢工具、一個 CLI、幾個 MCP server。它們是不同團隊在不同時間做的，各自處理登入：

| 工具 | 登入方式 | 問題 |
|---|---|---|
| 部署面板 | 自己接 LDAP，表單收帳號密碼再去 bind | 工具拿到了員工的 LDAP 明文密碼；每個工具都存一份 LDAP 服務帳號密碼 |
| 報表系統 | 自己的帳號表，密碼雜湊存在自己的資料庫 | 員工多記一組密碼；離職時沒人記得要來這裡停用 |
| feature flag 後台 | 接 Microsoft Entra ID 的 OIDC | 只有它支援 MFA 與條件式存取 |
| 資料查詢 CLI | 個人 API key，建立後永不過期 | key 寫在設定檔裡，沒有人知道全公司有多少把還有效 |
| MCP server | 各自不同 | 見 [MCP Gateway](#/skill/mcp-gateway) |

一年後要回答三個問題，沒有一個答得出來：

- **某位員工離職了，他在哪些工具上還有有效的 token？** 每個工具的 token 格式、存放、到期規則都不一樣，只能一個一個去問。
- **某個 refresh token 外洩了，能不能只撤銷那一個裝置？** 有的工具根本沒有 refresh 的概念，有的只能整個帳號重設。
- **報表系統的擁有者想知道誰在用、用多少**：只有自己的 access log，看不出是人還是腳本、是哪個用戶端。

每個工具各做一次登入，代表同一件事做了七遍，而且七遍的品質不一樣。

## 架構：身分閘道放在中間

集中式身分閘道（identity gateway）把「確認你是誰」和「發 token、管 token」收到一個地方。內部工具不再接 LDAP、不再存密碼，只做一件事：驗證閘道簽發的 token。

```text
  上游身分來源（只有閘道接）              身分閘道                         內部工具（只驗 token）
 ┌────────────────────┐          ┌──────────────────────────┐
 │ LDAP / AD          │◀─bind───│  身分對應（誰是誰、群組）  │──JWT（aud=報表）──▶ 報表系統
 │ Microsoft Entra ID │◀─OIDC───│  三種流程：                │──JWT（aud=部署）──▶ 部署面板
 │ Gitea 等 OAuth 提供者│◀─OAuth──│   Device Code / PKCE /    │──JWT（aud=MCP gw）▶ MCP Gateway
 └────────────────────┘          │   Client Credentials      │
                                 │  token 生命週期與撤銷      │◀──introspect／JWKS── 各工具
                                 │  使用紀錄                  │──報表──▶ 服務擁有者
                                 └──────────────────────────┘
```

可以自建，也可以用現成的身分系統擔任這個角色（例如 Keycloak 這類支援 LDAP 同步、外部 IdP 串接與多種 OAuth 流程的開源方案；功能細節以各自文件為準）。不論哪種，要做的事情是同一組。

### 上游：只有閘道接身分來源

閘道向上游確認身分，三種常見的上游各有接法：

- **LDAP / Active Directory**：閘道用一個專屬的服務帳號查使用者、用使用者的密碼做 bind 驗證。LDAP 密碼只會出現在閘道的登入頁，內部工具永遠看不到。
- **Microsoft Entra ID 等 OIDC 提供者**：閘道是 Entra ID 的一個 OIDC client，使用者被導到 Entra ID 登入（MFA、條件式存取都在那裡發生），閘道收到 `id_token`。
- **Gitea 這類能當 OAuth 2 提供者的系統**：閘道用授權碼流程向它要使用者資訊，適合外包或社群協作者只有那邊帳號的情況。

### 身分對應：誰是誰

多個上游時，閘道要把它們對應到同一個內部使用者。這一步最容易出錯：

- **用「上游 + 上游的穩定 id」當鍵**，例如 Entra ID 的 `iss` 加 `sub`（或物件 id）、LDAP 的 `objectGUID` / `entryUUID`。
- **不要只用 email 自動合併帳號**。某個上游允許使用者自己改 email，或允許註冊任意 email，攻擊者就能把自己的帳號連到別人的內部身分。
- **群組**從上游同步（LDAP 群組、Entra ID 群組），對應成內部工具看得懂的角色，寫進 token 的 claim 或讓工具查詢。

## 三種流程對應三種用戶端

閘道對下游的工具與用戶端，提供三種標準流程（各流程的 HTTP 往返見 [Device Code、PKCE、Client Credentials](#/skill/oauth-device-pkce)）：

| 用戶端 | 流程 | token 代表誰 | 範例 |
|---|---|---|---|
| CLI、agent、跑在 SSH 主機或容器裡的工具 | Device Code | 使用者 | 資料查詢 CLI、遠端主機上的 agent |
| 網頁、手機 App、有瀏覽器的桌機 CLI | 授權碼 + PKCE | 使用者 | 報表系統、wiki、MCP client |
| 沒有使用者的服務、排程 | Client Credentials | 服務本身 | 每晚的對帳批次、CI 的部署步驟 |

閘道用自己的私鑰簽發 JWT access token，公鑰放在 JWKS。每個工具是一個獨立的**資源**，token 的 `aud` 指定給誰用：發給報表系統的 token 打不開部署面板（驗證細節見 [MCP 的授權](#/skill/mcp-authorization)，內容同樣適用於任何資源伺服器）。

## Token 的生命週期

集中發 token 最大的價值在於**集中管 token**。每個 token 從發出到失效，閘道都知道它在哪個狀態。

### 到期

| token | 建議壽命 | 理由 |
|---|---|---|
| access token | 5–15 分鐘 | JWT 發出去就收不回，工具驗證時不問閘道；短壽命讓「撤銷」最多延遲這麼久生效 |
| refresh token | 閒置數天、絕對上限數週 | 閒置太久就要重新登入；就算一直在用，到了絕對上限也要重新走一次上游登入（重新跑 MFA） |
| 服務的 access token | 數分鐘到一小時 | Client Credentials 隨時能再要，不需要長壽命 |

這些數字是常見的起點，不是標準規定的值；依風險調整，高權限工具的 access token 可以更短。

### Refresh token rotation 與重放偵測

每次用 refresh token 換新的 access token 時，閘道同時發一把**新的** refresh token，舊的立刻作廢。同一次登入衍生出的所有 refresh token 屬於同一個「家族」（family）：

| 時間 | 事件 | 家族狀態 |
|---|---|---|
| 09:00 | alice 用 Device Code 登入 CLI，拿到 `RT1` | 有效 |
| 09:20 | CLI 用 `RT1` 換到 access token 與 `RT2`；`RT1` 標記為已使用 | 有效 |
| 09:40 | CLI 用 `RT2` 換到 `RT3` | 有效 |
| 10:05 | 有人拿**已使用過**的 `RT1` 來換 | **整個家族撤銷**，`RT3` 也失效 |
| 10:10 | alice 的 CLI 用 `RT3` 換，收到 `invalid_grant` | alice 要重新登入 |

已經用過的 refresh token 又出現，只有兩種可能：被偷了，或用戶端有 bug。閘道分不出是哪一種，所以撤銷整個家族：攻擊者與合法使用者都被踢出，合法使用者重新登入一次即可，攻擊者則需要再次通過上游登入與 MFA。

### 撤銷

- **使用者登出**：用戶端呼叫撤銷端點（RFC 7009），閘道撤銷該 refresh token 所屬的家族。
- **使用者自己管裝置**：閘道提供「我的登入」頁面，列出每個家族（哪個用戶端、什麼流程、建立時間、最後使用時間、大概位置），可以逐一撤銷。
- **管理員撤銷**：撤銷某個使用者的全部 token，或某個用戶端的全部 token（例如發現某版 CLI 有漏洞）。
- **access token 的撤銷有延遲**：工具用 JWKS 自己驗 JWT 時不會問閘道，所以撤銷後 access token 到期前仍然有效。不能接受這段延遲的高風險操作，工具改用 introspection（RFC 7662）即時問閘道 token 是否還有效。

### 離職與停用

使用者在 LDAP 或 Entra ID 被停用，閘道要知道：

1. **refresh 時回頭確認上游**：每次 refresh 檢查使用者在上游是否仍為啟用狀態。最多延遲一個 access token 壽命。
2. **主動同步**：定期同步上游帳號狀態，或由上游推送異動（例如 SCIM 協定，RFC 7644）。停用事件一到，閘道立刻撤銷該使用者全部家族。

## 使用紀錄給服務擁有者

每次發 token、refresh、撤銷、introspection，閘道都記一筆事件：

```json
{ "at": "2026-10-20T09:20:31+08:00", "event": "token.refreshed", "user": "alice", "groups": ["eng"],
  "client": "atlas-cli", "flow": "device_code", "audience": "https://reports.internal", "family": "f_9c1e" }
```

服務擁有者因此能直接看到：

- 誰在用我的服務（人還是服務、哪個群組）
- 透過哪些用戶端（網頁、CLI、哪個 agent、哪個批次）
- 每個使用者最後一次使用的時間；長期沒用的權限可以收回
- 異常：同一個使用者在短時間內出現在兩個相距很遠的地點、某個服務帳號的 token 申請量突然暴增、重放偵測觸發

## 實際程式：發 token、rotation、重放偵測、停用

用純 Python 模擬閘道的 token 生命週期。refresh token 只存 SHA-256 雜湊（理由見 [金鑰的範圍與壽命](#/skill/key-scope-lifetime)），時間用虛擬時鐘：

```python run
import hashlib, secrets
from datetime import datetime, timedelta, timezone

TPE = timezone(timedelta(hours=8))
ACCESS_TTL, REFRESH_IDLE = timedelta(minutes=15), timedelta(days=7)
h = lambda t: hashlib.sha256(t.encode()).hexdigest()
DIRECTORY = {"alice": True, "bob": True}        # 上游（LDAP / Entra ID）的帳號是否啟用

class InvalidGrant(Exception):
    pass

class Gateway:
    def __init__(self):
        self.refresh, self.access, self.families, self.events = {}, {}, {}, []

    def log(self, now, event, fam):
        f = self.families[fam]
        self.events.append((now.strftime("%H:%M"), event, f["user"], f["client"], f["flow"]))

    def _issue(self, fam, now):
        at, rt = "at_" + secrets.token_urlsafe(12), "rt_" + secrets.token_urlsafe(24)
        self.access[h(at)] = {"family": fam, "exp": now + ACCESS_TTL}
        self.refresh[h(rt)] = {"family": fam, "exp": now + REFRESH_IDLE, "used": False}
        return at, rt

    def login(self, user, client, flow, now):
        fam = "f_" + secrets.token_hex(2)
        self.families[fam] = {"user": user, "client": client, "flow": flow, "revoked": False}
        self.log(now, "login", fam)
        return self._issue(fam, now)

    def refresh_grant(self, rt, now):
        rec = self.refresh.get(h(rt))
        if rec is None:
            raise InvalidGrant("unknown refresh token")
        fam = self.families[rec["family"]]
        if fam["revoked"]:
            raise InvalidGrant("family revoked")
        if rec["used"]:                              # 用過的又出現：重放
            fam["revoked"] = True
            self.log(now, "reuse_detected → family revoked", rec["family"])
            raise InvalidGrant("refresh token reuse")
        if now > rec["exp"]:
            raise InvalidGrant("refresh token expired")
        if not DIRECTORY[fam["user"]]:               # 回頭確認上游帳號狀態
            fam["revoked"] = True
            self.log(now, "upstream_disabled → family revoked", rec["family"])
            raise InvalidGrant("user disabled")
        rec["used"] = True
        self.log(now, "refreshed", rec["family"])
        return self._issue(rec["family"], now)

    def introspect(self, at, now):
        rec = self.access.get(h(at))
        return bool(rec) and now < rec["exp"] and not self.families[rec["family"]]["revoked"]

gw = Gateway()
t0 = datetime(2026, 10, 20, 9, 0, tzinfo=TPE)
at1, rt1 = gw.login("alice", "atlas-cli", "device_code", t0)
at2, rt2 = gw.refresh_grant(rt1, t0 + timedelta(minutes=20))
at3, rt3 = gw.refresh_grant(rt2, t0 + timedelta(minutes=40))
print("09:40 舊的 at1 還有效嗎：", gw.introspect(at1, t0 + timedelta(minutes=40)))   # 早過期了

for who, token, minute in [("攻擊者拿舊的 RT1", rt1, 65), ("alice 的 CLI 拿 RT3", rt3, 70)]:
    try:
        gw.refresh_grant(token, t0 + timedelta(minutes=minute))
    except InvalidGrant as e:
        print(f"{who}：invalid_grant（{e}）")

bat, brt = gw.login("bob", "reports-web", "auth_code_pkce", t0)
DIRECTORY["bob"] = False                                                    # bob 離職
now = t0 + timedelta(minutes=10)
print("bob 停用後，他的 access token 在到期前：", gw.introspect(bat, now))      # 仍有效：撤銷延遲
try:
    gw.refresh_grant(brt, now)
except InvalidGrant as e:
    print(f"bob 的 refresh：invalid_grant（{e}）")
print("refresh 被拒後再 introspect：", gw.introspect(bat, now))

print("\n使用紀錄：")
for row in gw.events:
    print(" ", *row)
```

輸出顯示了兩件事：重放偵測讓合法的 `RT3` 也一起失效（alice 要重新登入）；bob 停用後，他手上的 JWT access token 在被撤銷之前仍然有效，直到閘道在 refresh 時發現並撤銷家族，introspection 才回報失效。用 JWKS 本地驗證、不呼叫 introspection 的工具，則要等到 access token 到期。

## 常見錯誤與錯誤訊息

| 現象或訊息 | 原因 | 怎麼修 |
|---|---|---|
| refresh 時收到 `{"error":"invalid_grant"}`，使用者被迫重新登入 | refresh token 過期、家族被撤銷，或用戶端並行送出兩次 refresh 觸發了重放偵測 | 用戶端的 refresh 要排隊（同一時間只有一個請求在換）；換到新 token 先寫進儲存再使用 |
| 工具收到 `invalid_token`，閘道 log 顯示 audience 不符 | 用戶端拿 A 工具的 token 去打 B 工具 | 每個工具要各自的 token（申請時指定 `resource` 或對應的 scope） |
| 某位使用者在上游改了 email 後，閘道多出一個新帳號 | 身分對應用 email 當鍵 | 改用上游的穩定 id；已經分裂的帳號人工合併 |
| 停用帳號後，那個人的 token 還能用好幾個小時 | access token 壽命太長，或閘道沒在 refresh 時檢查上游 | 縮短 access token；refresh 時檢查上游；高風險工具改用 introspection |
| 各工具仍然各自保留一份 LDAP 服務帳號密碼 | 遷移沒做完，舊的登入路徑還開著 | 列出所有直接連 LDAP 的系統，遷移後關掉它們對 LDAP 的網路存取 |
| 閘道簽章金鑰輪替後，部分工具全部 401 | 工具把公鑰寫死，沒有讀 JWKS | 工具一律從 JWKS 取公鑰並依 `kid` 選用 |

## 動手

1. 執行上面的模擬，對照輸出與「Refresh token rotation 與重放偵測」那張時間線。
2. 在 [Playground](#/playground?lang=python) 把 `ACCESS_TTL` 改成 `timedelta(hours=8)`，看 bob 停用後他的 access token 能撐到幾點；再想想在不能縮短壽命的情況下，哪些工具應該改用 introspection。
3. 加一個 `revoke_user(user)` 方法：把該使用者所有家族標成撤銷，並在 bob 停用的同時呼叫它，確認 `introspect(bat, now)` 立刻變成 `False`。
4. 加一個 `usage_report(client)`：從 `events` 統計每個使用者對某個用戶端的最後使用時間，這就是交給服務擁有者的報表。

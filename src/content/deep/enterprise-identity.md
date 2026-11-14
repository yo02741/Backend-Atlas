## 從一個具體問題開始：離職三個月，帳號還能登入

某醫院的護理部上線了一套新的排班系統。開發時為了趕進度，系統自己建了一張帳號表：帳號、密碼雜湊、角色，由護理部的管理者在後台新增人員。

三月底，7A 病房的護理師 lin.meihua 離職。人事室照流程通知資訊室，資訊室在目錄服務裡停用了她的帳號，當天信箱、VPN、院內入口網站都登不進去。六月的內部稽核抽查排班系統，發現：

- lin.meihua 的帳號還是有效狀態，五月有兩筆登入紀錄。
- 另外有 14 個帳號對不到任何在職人員。
- 一位三月調到加護病房的護理師，在排班系統裡仍然能改 7A 的班表。
- 排班系統的密碼規則是 6 碼以上、沒有 MFA；院內其他系統是 12 碼加 MFA。

排班系統的程式沒有 bug。問題在於它**多存了一份身分資料**，而這份資料沒有人負責和來源保持一致。每多一個自己管帳號的系統，到職、調動、離職就多一個要手動處理的地方，遲早會漏。

解法是讓應用程式不擁有身分：帳號與密碼留在組織的目錄服務，登入交給身分提供者，角色由群組決定，停用由佈建或同步自動生效。

## 目錄服務：組織的帳號放在哪裡

**目錄服務**（directory service）是專門存「人、群組、電腦、服務帳號」的資料庫，讀多寫少，組織裡的系統都向它查詢。存取它最常見的協定是 LDAP（Lightweight Directory Access Protocol，RFC 4511）。

### LDAP 的樹狀結構

LDAP 的資料是一棵樹，每個節點叫一筆 entry：

```text
dc=hospital,dc=example                  ← 樹根，通常對應組織的網域
├── ou=people                           ← OU：組織單位，用來分類
│   ├── uid=chen.yiting                 ← 一個人
│   └── uid=wang.jiahao
├── ou=groups
│   ├── cn=ward-7a-nurses               ← 一個群組
│   └── cn=nursing-all
└── ou=services
    └── cn=svc-schedule                 ← 應用程式用的服務帳號
```

| 名詞 | 意思 | 例子 |
|---|---|---|
| DN（Distinguished Name） | 一筆 entry 在樹上的完整路徑，全目錄唯一 | `uid=chen.yiting,ou=people,dc=hospital,dc=example` |
| OU（Organizational Unit） | 樹上的資料夾，用來分類與委派管理 | `ou=people` |
| 屬性（attribute） | entry 上的欄位，可以有多個值 | `mail`、`cn`、`memberOf` |
| 群組 | 也是一筆 entry，用 `member` 屬性列出成員的 DN；成員可以是另一個群組 | `cn=nursing-all,ou=groups,…` |

DN 會變：調部門時 entry 被搬到另一個 OU，DN 就不同了。要長期識別一個人，用目錄產生、不會變的 id（OpenLDAP 的 `entryUUID`、Active Directory 的 `objectGUID`）。

應用程式會用到的操作主要是兩個：

- **bind**：拿一個 DN 加密碼向目錄證明身分，成功代表密碼正確。
- **search**：給定起點（base DN）、範圍（scope）與條件（filter），取回符合的 entry 與指定的屬性。filter 是前置式寫法，`(&(objectClass=person)(uid=chen.yiting))` 的意思是「是人，而且 uid 等於 chen.yiting」。

### Active Directory 與 Kerberos

**Active Directory**（AD）是 Microsoft 的目錄服務，Windows 網域的帳號、電腦、群組原則都放在裡面。AD 對外提供 LDAP 介面，應用程式可以用 LDAP 查 AD 裡的使用者與群組；屬性名稱和一般 LDAP 伺服器不完全相同（登入名稱常用 `sAMAccountName` 或 `userPrincipalName`，停用狀態記在 `userAccountControl` 的旗標裡），接之前先看實際的資料。

網域內的登入驗證主要用 **Kerberos**，想法是「用票證，不傳密碼」：使用者登入電腦時向網域控制站證明一次身分，拿到一張有期限的票證；之後存取檔案伺服器或內部網站，出示的是針對那個服務核發的票證，密碼不會送到每個服務手上。本課只講到這個層次。

### 雲端目錄

Microsoft Entra ID（舊名 Azure AD）、Google Workspace、Okta 這類服務把目錄與身分提供者做成雲端服務，主要用 OIDC、SAML、SCIM 這些以 HTTP 為基礎的協定對接應用程式。Entra ID 和地端的 AD 是不同的產品，帳號可以同步，支援的協定不同；功能以各自的官方文件為準。

## 應用程式接身分的三種方式

### 方式一：直接 LDAP bind

應用程式自己做登入表單，收到帳號密碼後去問目錄：先用服務帳號 search 出使用者的 DN，再用這個 DN 和使用者輸入的密碼 bind 一次，成功就當作登入。

```python
# 需要真的目錄服務與 ldap3 套件，不能在瀏覽器裡執行；函式庫的 API 以它的文件為準
from ldap3 import Server, Connection
from ldap3.utils.conv import escape_filter_chars

def ldap_login(username: str, password: str):
    if not username or not password:      # 空密碼先擋：有些伺服器會把它當成匿名 bind 而回成功
        return None
    server = Server("ldaps://ldap.hospital.example")
    # 1. 用服務帳號找出使用者的 DN；放進 filter 的值一定要跳脫
    with Connection(server, user=SVC_DN, password=SVC_PASSWORD, auto_bind=True) as svc:
        svc.search("ou=people,dc=hospital,dc=example",
                   f"(&(objectClass=person)(uid={escape_filter_chars(username)}))",
                   attributes=["entryUUID", "mail", "memberOf"])
        if len(svc.entries) != 1:         # 找不到或找到多筆都算失敗
            return None
        entry = svc.entries[0]
    # 2. 用使用者自己的 DN 與密碼 bind：成功代表密碼正確
    user = Connection(server, user=entry.entry_dn, password=password)
    if not user.bind():
        return None
    user.unbind()
    return entry
```

這是最容易做的方式，缺點也最多：

- **應用程式經手明文密碼**。它的日誌、錯誤回報、記憶體傾印都可能留下密碼；這個應用程式被入侵，等於所有在它上面登入過的人的目錄密碼外洩。
- **MFA 與單一登入做不了**。目錄只回答「密碼對不對」，第二個因素沒有地方放；每個系統各輸入一次密碼。
- **每個應用程式都存一份服務帳號的密碼**，也都要能連到目錄伺服器。

只支援 LDAP 的套裝軟體和舊系統還是會用到它。新系統不要選這條路；需要相容時，把 LDAP 收在身分提供者或閘道後面，見 [集中式身分閘道](#/skill/identity-gateway)。

### 方式二：SAML 2.0

SAML 把「驗證使用者」交給身分提供者（IdP，Identity Provider），應用程式是服務提供者（SP，Service Provider）。使用者的密碼只在 IdP 的頁面輸入，SP 拿到的是一份 IdP 簽過章的 XML 文件，叫 **assertion**。整個流程靠瀏覽器轉址完成，SP 和 IdP 之間不需要直接連線：

| 步驟 | 發生什麼事 | 誰做的 |
|---|---|---|
| 1 | 使用者開啟排班系統，還沒有 session | 瀏覽器 → SP |
| 2 | SP 產生一份 AuthnRequest，把瀏覽器轉址到 IdP 的登入網址 | SP |
| 3 | IdP 驗證使用者：密碼、MFA；已經在 IdP 登入過就直接跳過 | IdP |
| 4 | IdP 產生 assertion 並簽章，回一個自動送出的表單，瀏覽器把它 POST 到 SP 的 ACS 網址 | IdP → 瀏覽器 → SP |
| 5 | SP 驗證 assertion，通過後建立自己的 session | SP |

ACS（Assertion Consumer Service）是 SP 上專門接收 assertion 的端點。assertion 的內容大致如下（已簡化）：

```xml
<saml:Assertion ID="_a81f" IssueInstant="2026-03-16T01:00:00Z">
  <saml:Issuer>https://idp.hospital.example/saml</saml:Issuer>            <!-- 誰發的 -->
  <ds:Signature>…</ds:Signature>                                          <!-- IdP 的 XML 簽章 -->
  <saml:Subject>
    <saml:NameID>u-1002</saml:NameID>                                     <!-- 使用者是誰 -->
    <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
      <saml:SubjectConfirmationData InResponseTo="_req77"
          Recipient="https://schedule.hospital.example/saml/acs"
          NotOnOrAfter="2026-03-16T01:05:00Z"/>
    </saml:SubjectConfirmation>
  </saml:Subject>
  <saml:Conditions NotBefore="2026-03-16T00:59:00Z" NotOnOrAfter="2026-03-16T01:05:00Z">
    <saml:AudienceRestriction>
      <saml:Audience>https://schedule.hospital.example/saml/metadata</saml:Audience>   <!-- 發給哪個 SP -->
    </saml:AudienceRestriction>
  </saml:Conditions>
  <saml:AttributeStatement>
    <saml:Attribute Name="groups">
      <saml:AttributeValue>nursing-all</saml:AttributeValue>
    </saml:Attribute>
  </saml:AttributeStatement>
</saml:Assertion>
```

第 5 步要驗的項目（簽章、`Audience`、`Recipient`、有效時間、`InResponseTo`）列在 [API key、服務間驗證、MFA 與 SSO](#/skill/api-keys-mfa)。驗證交給維護中的 SAML 函式庫，不自己解析 XML。

雙方的設定用 **metadata** 交換：IdP 的 metadata 有登入網址與簽章用的憑證，SP 的 metadata 有 entity ID 與 ACS 網址。IdP 的簽章憑證會到期、會更換，到期日要有人追蹤。

### 方式三：OIDC

OIDC 的角色與 SAML 對應（IdP 對應 OpenID Provider，SP 對應 Relying Party），憑證換成 JWT 格式的 ID token，後端用授權碼換 token。流程與驗證項目在 [OAuth 2.0 與 OpenID Connect](#/skill/oauth-oidc)，這裡不重複。

### 三種方式比較，以及 SAML 與 OIDC 怎麼選

| | LDAP bind | SAML 2.0 | OIDC |
|---|---|---|---|
| 應用程式會看到密碼嗎 | 會 | 不會 | 不會 |
| MFA、單一登入 | 做不到 | 在 IdP 做 | 在 IdP 做 |
| 應用程式要能連到誰 | 目錄伺服器 | 不需要連 IdP（瀏覽器轉址） | 後端要能連 IdP 的 token 端點與 JWKS |
| 手機 App、SPA、呼叫 API | 不適合 | 不適合，它是為瀏覽器設計的 | 適合，和 OAuth 2.0 是同一套 |

SAML 與 OIDC 的選擇多半由環境決定：

- IdP 兩種都支援、應用程式是新寫的：選 OIDC。函式庫多、設定只要 issuer 網址、之後要呼叫 API 也是同一套 token。
- 對方的 IdP 或採購規範只支援 SAML，或要接的是只會 SAML 的既有系統：用 SAML。
- 要賣給很多企業客戶的產品：通常兩種都要支援，由客戶選。

## 群組對應角色

IdP 送來的是「這個人在哪些群組」，應用程式要的是「這個人能做什麼」。中間用一張**對應表**接起來：

| 目錄群組 | 排班系統的角色 |
|---|---|
| `nursing-all` | `schedule:read` |
| `head-nurses` | `schedule:edit` |
| `it-ops` | `schedule:admin` |

幾個原則：

- **對應表放在設定或資料庫，不寫死在程式裡**。`if "head-nurses" in groups` 散在各處時，群組改名或組織調整就要改程式。程式只檢查自己定義的角色與權限（見 [RBAC 與 ABAC 授權模型](#/skill/rbac-abac)），群組名稱只出現在對應表。
- **群組可以巢狀**。`nursing-all` 的成員是各病房的群組，不是人。拿到的群組清單是否已經展開，要看 IdP 的設定；自己展開時要處理循環（A 包含 B、B 又包含 A）。
- **沒有對應到任何角色就是沒有權限**。不要給「登入成功的人」一個預設角色。
- **群組很多時 token 可能放不下**。有些 IdP 會只送部分群組，或要應用程式另外查詢，行為以 IdP 的文件為準；在 IdP 端設定只送這個應用程式用得到的群組可以避開。
- 角色是登入當下算出來的，群組異動要到下次登入才會反映，可接受的延遲要事先定好。

## 帳號生命週期：佈建、異動、停用

登入交給 IdP 之後，「人離職了」這件事還是要有人告訴應用程式。只靠登入擋不住：離職前發出去的 session、refresh token、個人 API key 還在，應用程式裡的資料也還指向這個人。

| 做法 | 帳號何時建立 | 離職時 | 適合 |
|---|---|---|---|
| 登入時才建立（JIT） | 第一次登入 | 應用程式不會知道 | 只能當起點，不能當唯一機制 |
| SCIM 佈建 | IdP 指派時推送 | IdP 立刻推送停用 | IdP 與應用程式都支援 SCIM 時優先 |
| 定期同步與對帳 | 排程拉取目錄資料 | 下一次同步時停用 | 沒有 SCIM 或只有 LDAP 時 |

**SCIM**（System for Cross-domain Identity Management，RFC 7643、7644）是一組 REST API 的規格：應用程式實作 `/Users`、`/Groups` 這些端點，IdP 在人員異動時呼叫。停用一個人大致是這樣的請求：

```http
PATCH /scim/v2/Users/5f0c2a7e HTTP/1.1
Host: schedule.hospital.example
Authorization: Bearer <IdP 專用的 token>
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [{ "op": "replace", "path": "active", "value": false }]
}
```

不同 IdP 送出的請求形式略有差異，要拿實際的 IdP 測。收到停用後不只是把欄位改成 `false`，還要撤銷這個人的 session、refresh token 與 API key（見 [帳號生命週期](#/skill/account-lifecycle) 的停用一節）。

沒有 SCIM 時，用排程定期向目錄查一次，和應用程式的帳號表**對帳**（reconciliation）：

- 目錄已停用或查不到、應用程式還有效 → 停用。
- 目錄裡有權限、應用程式沒有帳號 → 建立（或等他第一次登入）。
- 兩邊都在，但群組算出來的角色或 email 不同 → 更新。
- 應用程式裡不屬於目錄管理的帳號（本地管理員、服務帳號）→ 列出來，逐一確認負責人。

對帳要注意三件事。第一，用不會變的 id 配對，不用 email 或登入名稱：email 會因為改名、網域調整而變，舊的 email 也可能配給新進人員。第二，同步來源壞掉時不要動手：目錄查詢逾時或只回一部分資料時，照著結果停用會把所有人鎖在外面，所以要停用的比例異常時應該停下來告警。第三，有 SCIM 時定期對帳仍然有用，它能抓到漏掉的推送。

**服務帳號**（給程式用的目錄帳號）最容易沒人管：密碼永不過期、建立的人已經調走、權限比需要的大。每個服務帳號要有負責人與用途紀錄，密碼放在秘密管理服務並定期輪替（見 [秘密管理](#/skill/secrets)）。

## 實際程式：群組展開與對帳

下面用 dict 模擬一個目錄：四個人、巢狀群組，其中兩個群組互相包含。程式把群組展開成角色，再拿排班系統的帳號表對帳。可以直接執行：

```python run
# 目錄（示意）：使用者以不會變的 id 當鍵；群組的成員可以是人，也可以是別的群組
USERS = {
    "u-1001": {"uid": "lin.meihua",  "active": False},   # 三月離職，目錄已停用
    "u-1002": {"uid": "chen.yiting", "active": True},
    "u-1003": {"uid": "wang.jiahao", "active": True},
    "u-1004": {"uid": "hsu.peishan", "active": True},
}
GROUPS = {
    "ward-7a-nurses":  {"users": ["u-1001", "u-1002"], "groups": []},
    "ward-icu-nurses": {"users": ["u-1003"], "groups": []},
    "head-nurses":     {"users": ["u-1003"], "groups": []},
    "nursing-all":     {"users": [], "groups": ["ward-7a-nurses", "ward-icu-nurses", "head-nurses"]},
    "it-ops":          {"users": ["u-1004"], "groups": ["it-oncall"]},
    "it-oncall":       {"users": [], "groups": ["it-ops"]},      # 設定錯誤：兩個群組互相包含
}
# 群組 → 角色的對應表是設定，不是散在程式裡的 if
GROUP_ROLES = {"nursing-all": "schedule:read", "head-nurses": "schedule:edit", "it-ops": "schedule:admin"}


def members_of(group, seen=None):
    """展開一個群組的所有成員（含巢狀群組）。seen 記住走過的群組，遇到循環就停。"""
    seen = set() if seen is None else seen
    if group in seen or group not in GROUPS:
        return set()
    seen.add(group)
    found = set(GROUPS[group]["users"])
    for child in GROUPS[group]["groups"]:
        found |= members_of(child, seen)
    return found


def roles_of(user_id):
    return sorted({role for group, role in GROUP_ROLES.items() if user_id in members_of(group)})


print("群組展開成角色：")
for user_id, user in USERS.items():
    state = "啟用" if user["active"] else "停用"
    print(f"  {user['uid']:<12} {state}  {roles_of(user_id)}")
print("  ↑ 停用的人還留在群組裡：只看群組不看帳號狀態，會把角色發給已離職的人")

# 排班系統自己的帳號表：external_id 存的是目錄的 id，不是 email
APP_USERS = [
    {"external_id": "u-1001", "login": "lin.meihua",  "active": True, "roles": ["schedule:read"]},
    {"external_id": "u-1002", "login": "chen.yiting", "active": True, "roles": ["schedule:read"]},
    {"external_id": "u-1003", "login": "wang.jiahao", "active": True, "roles": ["schedule:read"]},  # 升任護理長後沒更新
    {"external_id": "u-0900", "login": "kuo.shufen",  "active": True, "roles": ["schedule:edit"]},  # 目錄裡已經查不到
    {"external_id": None,     "login": "svc-report",  "active": True, "roles": ["schedule:read"]},  # 本地的服務帳號
]

print("\n對帳結果：")
for acct in APP_USERS:
    ext = acct["external_id"]
    if ext is None:
        result = "不在目錄管理範圍：另外列管，確認負責人"
    elif ext not in USERS:
        result = "目錄查不到，應用程式還有效 → 停用"
    elif not USERS[ext]["active"]:
        result = "目錄已停用，應用程式還有效 → 停用，並撤銷 session 與 token"
    elif roles_of(ext) != sorted(acct["roles"]):
        result = f"角色不一致：{acct['roles']} → {roles_of(ext)}"
    else:
        result = "一致"
    print(f"  {acct['login']:<12} {result}")
```

`it-ops` 與 `it-oncall` 互相包含，沒有 `seen` 的話 `members_of` 會無窮遞迴。lin.meihua 雖然停用了，仍然算得出 `schedule:read`：停用帳號時群組成員資格不一定會清掉，所以判斷權限前要先看帳號狀態。

### LDAP filter 的值要跳脫

`*`、`(`、`)`、`\` 與 NUL 在 LDAP filter 裡有語法意義。使用者輸入沒有跳脫就放進去，會被當成 filter 的一部分，查詢條件就不是原本寫的那一個（原理見 [注入攻擊](#/skill/injection)）。RFC 4515 規定的跳脫方式是把這些字元換成反斜線加兩位十六進位：

```python run
def escape_filter_value(value: str) -> str:
    """依 RFC 4515 跳脫要放進 LDAP filter 的值：\\ * ( ) 與 NUL 換成反斜線加兩位十六進位。"""
    out = []
    for ch in value:
        if ch in "\\*()\x00":
            out.append("\\%02x" % ord(ch))
        else:
            out.append(ch)
    return "".join(out)


for raw in ["chen.yiting", "*", "研發部(台北)", "share\\docs", "a\x00b"]:
    print(f"{raw!r:<16} → (cn={escape_filter_value(raw)})")
```

輸入 `*` 跳脫後變成 `\2a`，比對的是字面上的星號，不是萬用字元。實際專案用 LDAP 函式庫提供的跳脫函式，不自己拼字串；DN 的跳脫規則和 filter 不同（RFC 4514），不能混用。查詢用的服務帳號也只給讀取必要 OU 與屬性的權限。

## 常見錯誤與錯誤訊息

LDAP 的錯誤以結果代碼表示（RFC 4511），函式庫的例外訊息通常會帶上它：

| 訊息或現象 | 原因 | 處理 |
|---|---|---|
| bind 回 `invalidCredentials`（代碼 49） | DN 或密碼錯；AD 上帳號停用、鎖定、密碼過期也可能回這個代碼並附子代碼 | 先確認 DN 是不是查出來的那一個；對使用者只顯示「帳號或密碼錯誤」 |
| search 回 `insufficientAccessRights`（代碼 50），或成功但少了屬性 | 服務帳號沒有讀那個 OU 或屬性的權限 | 請目錄管理者開必要的讀取權限，不要改用管理員帳號 |
| SAML 登入偶爾失敗，訊息提到 assertion 尚未生效或已過期 | SP 與 IdP 的時鐘不一致 | 兩邊都做時間同步；容許的誤差設小 |
| SAML 某一天開始全部驗章失敗 | IdP 換了簽章憑證，SP 還信任舊的 | 重新匯入 IdP 的 metadata；把憑證到期日列入追蹤 |
| SAML 訊息提到 audience 不符 | IdP 上設定的 SP entity ID 和 SP 自己認定的不同 | 兩邊對齊同一個 entity ID，不要為了讓它通過而關掉檢查 |

沒有錯誤訊息、但後果更嚴重的：

- **沒驗簽章或沒驗 audience**。為了讓整合「先通」而關掉檢查，沒有簽章的 assertion、發給別的 SP 的 assertion 都會被接受。這些檢查不能是可以關掉的選項。
- **用 email 當唯一識別**。改名後變成新帳號；離職者的 email 重新配給新進人員時，新人接手了舊人的權限與資料。本地帳號綁 IdP 的 issuer 加上不會變的使用者 id。
- **離職只擋登入、沒同步**。IdP 停用後不能登入，但既有的 session、API key 繼續有效。
- **授權寫死在群組名稱**。群組改名後權限消失，或名稱被別的用途重新使用。
- **本地帳號與服務帳號沒人管**。緊急用的本地管理員、給程式用的服務帳號不受 IdP 管理，要另外列管：負責人、用途、密碼輪替，使用時留紀錄。

## 動手

1. 執行群組展開與對帳那一段，把 `u-1003` 從 `head-nurses` 移除再跑一次，觀察 wang.jiahao 的對帳結果；再把 `members_of` 裡的 `seen` 檢查拿掉，看循環群組會發生什麼事。
2. 執行跳脫函式那一段，加入自己的測試字串，確認輸出的 filter 裡括號仍然成對。
3. 程式題：[目錄與應用程式帳號對帳](#/exercise/enterprise-identity-1)，實作完整的對帳函式，包含 email 變更、復職與「停用比例異常」的保護。
4. 列出手上系統的登入方式，標出哪些自己存密碼、哪些直接接 LDAP、哪些接 IdP；多個內部工具要統一登入時，接著讀 [集中式身分閘道](#/skill/identity-gateway)。

## 從一個具體問題開始：把網址的 1043 改成 1044

一個 B2B 記帳 SaaS，每家公司是一個租戶。使用者打開自己公司的一張發票，網址是：

```http
GET /api/invoices/1043 HTTP/1.1
Host: books.example.com
Cookie: __Host-sid=…
```

後端的程式碼長這樣：

```python
@app.get("/api/invoices/{invoice_id}")
def get_invoice(invoice_id: int, user = Depends(require_permission("invoice:read"))):
    return db.fetch_one("SELECT * FROM invoices WHERE id = %s", [invoice_id])
```

`require_permission("invoice:read")` 確認了「這位使用者的角色有讀發票的權限」。然後有人把 `1043` 改成 `1044`，拿到了**另一家公司**的發票：客戶名稱、金額、統編都在上面。再寫一個迴圈從 1 跑到 50000，整個平台的發票都出來了。

這叫 **IDOR**（Insecure Direct Object Reference，不安全的直接物件參照），在 OWASP API Security Top 10 裡對應的是 BOLA（Broken Object Level Authorization，物件層級授權失效）。角色檢查沒有錯，錯在它只回答了「這種人能不能讀發票」，沒有回答「這個人能不能讀**這一張**發票」。授權要同時看三樣東西：**誰**（subject）、**做什麼**（action）、**對哪個資源**（resource）。只看前兩樣就是這個漏洞。

## 運作原理：三種授權模型

### RBAC：使用者 → 角色 → 權限

RBAC（Role-Based Access Control）把權限綁在角色上，再把角色指派給使用者：

| 角色 | `invoice:read` | `invoice:write` | `invoice:approve` | `member:manage` |
|---|---|---|---|---|
| `viewer` | ✓ | | | |
| `accountant` | ✓ | ✓ | | |
| `manager` | ✓ | ✓ | ✓ | |
| `owner` | ✓ | ✓ | ✓ | ✓ |

使用者 → 角色通常是多對多（一個人可以同時是 `accountant` 與 `manager`），權限取聯集。優點是好懂、好稽核：「誰能核准發票」只要查哪些角色有 `invoice:approve`、哪些人有這些角色。新人到職指派角色即可，不用逐項設定。

RBAC 的極限出現在需求和**資源本身的狀態或關係**有關時：

- 「會計只能改**自己建立的**草稿發票」
- 「金額超過 100 萬的發票要財務長核准」
- 「已經寄出的發票誰都不能改」

如果硬用角色表達，就會出現 `accountant_own_draft_editor`、`manager_under_1m` 這種角色，數量隨條件組合爆炸，這叫角色爆炸（role explosion）。

### ABAC：用屬性寫政策

ABAC（Attribute-Based Access Control）把決策寫成對屬性的條件。屬性來自四個地方：

| 來源 | 例子 |
|---|---|
| 主體（subject） | `user.id`、`user.tenant_id`、`user.roles`、`user.department`、`user.mfa` |
| 資源（resource） | `invoice.tenant_id`、`invoice.created_by`、`invoice.status`、`invoice.amount` |
| 動作（action） | `read`、`update`、`approve` |
| 環境（environment） | 時間、來源 IP、是否從公司網路 |

政策長這樣：

- 允許 `update`，當 `user.id == invoice.created_by` 且 `invoice.status == "draft"`
- 允許 `approve`，當 `"manager" in user.roles` 且 `invoice.amount < 1_000_000`
- 拒絕任何動作，當 `user.tenant_id != invoice.tenant_id`

ABAC 的彈性很高，代價是**難以反向回答**：「誰能看這張發票？」在 RBAC 裡是查表，在 ABAC 裡要拿所有使用者逐一評估政策。政策多了之後，衝突與漏洞也更難看出來。

### 政策衝突：預設拒絕、拒絕優先

多條規則同時適用時，要有明確的合併規則。最常見、也最安全的是：

1. **預設拒絕**（default deny）：沒有任何規則明確允許，就拒絕。
2. **拒絕優先**（deny overrides）：只要有一條拒絕規則命中，不管有幾條允許，結果都是拒絕。

AWS IAM 的評估邏輯就是這樣：明確的 Deny 蓋過任何 Allow，沒有 Allow 就是隱含拒絕。這讓「租戶不同一律拒絕」這種護欄規則可以單獨寫一條，不用擔心被其他允許規則覆蓋。

### ReBAC：用關係決定權限

ReBAC（Relationship-Based Access Control）把權限表達成物件之間的關係圖：「alice 是 folder:finance 的 editor」「invoice:1043 的 parent 是 folder:finance」，然後定義「folder 的 editor 也是裡面每個 invoice 的 editor」。檢查「alice 能不能編輯 invoice:1043」就是在圖上找一條路徑。

Google 在 2019 年發表的 Zanzibar 論文描述了這種系統的大規模實作，之後有一些開源專案採用類似模型（例如 OpenFGA、SpiceDB）。它適合「分享」型的產品：文件、資料夾、專案，權限沿著階層與分享關係傳遞。ReBAC 能自然回答「這份文件分享給了誰」，因為答案就是圖上的邊。

### 實務上的組合

多數系統不是三選一，而是分層：

| 層 | 用什麼 | 例子 |
|---|---|---|
| 租戶隔離 | 一條固定的拒絕規則 + 資料層的強制 | `resource.tenant_id == user.tenant_id`，所有查詢都帶上 |
| 粗粒度能力 | RBAC | `accountant` 能讀寫發票，`viewer` 只能讀 |
| 資源層條件 | ABAC 式的條件 | 只能改自己建立的草稿；金額門檻 |
| 分享與階層（需要時） | ReBAC | 資料夾分享給外部會計師 |

實驗室 [RBAC vs ABAC](#/lab/AccessControlLab) 可以分別操作角色矩陣與四條 ABAC 規則，看 deny-overrides 怎麼合併出最終結果。

## 在哪一層檢查

### 前端藏按鈕不是授權

把「刪除」按鈕對 `viewer` 隱藏，是使用者體驗，不是安全措施。任何人都能直接送 HTTP 請求，跳過前端：

```http
DELETE /api/invoices/1043 HTTP/1.1
Host: books.example.com
Cookie: __Host-sid=<viewer 的 session>
```

伺服器必須自己判斷這個 viewer 不能刪。前端拿到的角色資訊只能拿來決定「顯示什麼」，不能拿來決定「允許什麼」。

### 檢查放在服務層，靠近資料

同一個操作常有好幾個入口：REST API、GraphQL、背景工作、管理後台、匯出功能、Webhook 處理器。只在其中一個 API 路由上加檢查，其他入口就是漏洞。比較可靠的做法：

- **路由層**做粗的檢查：有沒有登入、角色有沒有這個能力（`require_permission("invoice:read")`）。
- **服務層**載入資源後做細的檢查：這個資源屬不屬於這個租戶、這個人能不能對它做這個動作。所有入口都經過同一個服務函式。
- **資料層**做最後的護欄：查詢一律帶 `tenant_id` 條件；PostgreSQL 可以用 Row Level Security（`CREATE POLICY … USING (tenant_id = current_setting('app.tenant_id')::int)`）讓忘了加條件的查詢也查不到別人的資料。多租戶的資料隔離方式比較見設計情境 [多租戶的資料隔離](#/scenario/multi-tenant)。

### 修好開頭那個 IDOR

```python
@app.get("/api/invoices/{invoice_id}")
def get_invoice(invoice_id: int, user = Depends(require_permission("invoice:read"))):
    # 查詢時就帶上租戶條件：別家的發票在這裡就「不存在」
    inv = db.fetch_one(
        "SELECT * FROM invoices WHERE id = %s AND tenant_id = %s",
        [invoice_id, user.tenant_id],
    )
    if inv is None:
        raise HTTPException(404)          # 不回 403：不透露「這個 id 存在，只是不是你的」
    authorize(user, "read", inv)          # 資源層的其餘條件（例如草稿只有建立者看得到）
    return inv
```

另外兩個補強：對外的 id 改用不可猜的值（UUID）可以讓列舉變難，但**不能取代**授權檢查——id 會出現在分享連結、log、Email 裡；列表 API（`GET /api/invoices`）一樣要帶租戶條件，IDOR 不只出現在單筆查詢。

## 實際程式：一個小型政策引擎

下面用不到一百行 Python 實作一個政策引擎：RBAC 決定角色能做的動作，ABAC 規則看屬性，合併規則是預設拒絕 + 拒絕優先，每個決策都回傳理由。最後模擬開頭的 IDOR，比較只看角色和完整檢查的差別。

```python run
from dataclasses import dataclass, field

@dataclass
class User:
    id: str
    tenant_id: str
    roles: set = field(default_factory=set)

@dataclass
class Invoice:
    id: int
    tenant_id: str
    created_by: str
    status: str        # draft / sent
    amount: int

# ---------- RBAC：角色 → 允許的動作 ----------
ROLE_PERMS = {
    "viewer":     {"read"},
    "accountant": {"read", "update"},
    "manager":    {"read", "update", "approve"},
}
def role_allows(user, action):
    return any(action in ROLE_PERMS.get(r, set()) for r in user.roles)

# ---------- ABAC：每條規則 = (名稱, 效果, 適用的動作, 條件) ----------
ANY = {"read", "update", "approve"}
RULES = [
    ("不同租戶一律拒絕", "deny", ANY,
        lambda u, r, env: u.tenant_id != r.tenant_id),
    ("角色有這個能力", "permit", ANY,
        lambda u, r, env: role_allows(u, env["action"])),
    ("已寄出的發票不能改", "deny", {"update"},
        lambda u, r, env: r.status == "sent"),
    ("只能改自己建立的草稿（manager 除外）", "deny", {"update"},
        lambda u, r, env: r.created_by != u.id and "manager" not in u.roles),
    ("超過 100 萬要 cfo 核准", "deny", {"approve"},
        lambda u, r, env: r.amount >= 1_000_000 and "cfo" not in u.roles),
]

def decide(user, action, resource, env=None):
    env = {**(env or {}), "action": action}
    permits, denies = [], []
    for name, effect, actions, cond in RULES:
        if action in actions and cond(user, resource, env):
            (denies if effect == "deny" else permits).append(name)
    if denies:                       # 拒絕優先
        return False, "拒絕：" + "、".join(denies)
    if permits:
        return True, "允許：" + "、".join(permits)
    return False, "拒絕：沒有規則允許（預設拒絕）"

alice = User("alice", "acme", {"accountant"})
bob   = User("bob",   "acme", {"manager"})
vic   = User("vic",   "acme", {"viewer"})
eve   = User("eve",   "globex", {"manager"})

draft = Invoice(1043, "acme", created_by="alice", status="draft", amount=52_000)
sent  = Invoice(1044, "acme", created_by="alice", status="sent", amount=52_000)
big   = Invoice(1045, "acme", created_by="alice", status="draft", amount=1_200_000)

checks = [
    (alice, "update", draft), (alice, "update", sent), (vic, "update", draft),
    (bob, "update", draft), (bob, "approve", draft), (bob, "approve", big),
    (eve, "read", draft), (alice, "approve", draft),
]
for u, a, r in checks:
    ok, why = decide(u, a, r)
    print(f"{'✓' if ok else '✗'} {u.id:5} {a:7} 發票 {r.id} → {why}")

# ---------- IDOR：只看角色 vs 完整檢查 ----------
DB = {i.id: i for i in (draft, sent, big)}
def get_invoice_role_only(user, invoice_id):
    if not role_allows(user, "read"):
        return 403
    return DB.get(invoice_id, 404)                    # 只確認「能讀發票」，沒看是哪一張

def get_invoice_checked(user, invoice_id):
    inv = DB.get(invoice_id)
    if inv is None or inv.tenant_id != user.tenant_id:
        return 404                                    # 別家的發票視同不存在
    ok, _ = decide(user, "read", inv)
    return inv if ok else 403

print("\neve（globex 公司）把 id 從 1043 一路試到 1045：")
leaked = [i for i in DB if isinstance(get_invoice_role_only(eve, i), Invoice)]
print("  只看角色：拿到", leaked)
leaked = [i for i in DB if isinstance(get_invoice_checked(eve, i), Invoice)]
print("  完整檢查：拿到", leaked)
```

這個引擎的結構和 OPA、Casbin 這類工具的核心概念相同：決策函式拿到主體、動作、資源、環境，回傳允許或拒絕。真實的工具多了政策語言、政策版本管理、決策紀錄、效能最佳化（例如把政策轉成 SQL 條件，直接用在列表查詢上）。決策理由要寫進 log：事後被問「為什麼 bob 能核准這張」時，答案應該查得到。

## 常見錯誤與錯誤訊息

授權錯誤多半**不會產生錯誤訊息**，而是「該擋的沒擋」。下面是常見的模式與找法：

| 症狀或模式 | 原因 | 怎麼修 |
|---|---|---|
| 改網址的 id 就能看到別人的資料 | IDOR：只檢查了角色，沒檢查資源歸屬 | 查詢帶上 `tenant_id` 或 `owner_id`；寫測試用 A 租戶的使用者打 B 租戶的 id |
| 列表 API 回傳了別的租戶的資料 | 單筆有檢查，列表、搜尋、匯出沒有 | 租戶條件放在資料存取層的共用函式，或用 RLS 強制 |
| 前端看不到按鈕，但用 curl 打得通 | 授權只做在 UI | 後端每個改變狀態的端點都要檢查 |
| `PATCH /api/users/me` 帶上 `{"role": "owner"}` 就升級了 | Mass assignment：把請求的 JSON 整包寫進資料庫 | 用明確的輸入 schema，只允許可編輯的欄位；角色變更走獨立、需要 `member:manage` 的端點 |
| 角色被移除後，使用者還能做事好一段時間 | 角色寫在長效 JWT 裡，token 沒過期前一直有效 | access token 效期縮短，或驗證時查目前的角色（見 [JWT 解剖](#/skill/jwt) 撤銷的段落） |
| 背景工作替使用者做事時繞過了檢查 | 背景工作用系統身分直接呼叫資料層 | 背景工作記下「代表哪個使用者」，呼叫同一個服務層函式 |
| 403 與 404 混用導致可以探測資源是否存在 | 別人的資源回 403、不存在的回 404 | 對沒有權限得知其存在的資源，一律回 404 |

`403` 與 `404` 的選擇：使用者**應該知道**這個資源存在、只是沒有權限操作（例如同公司的 viewer 想刪發票），回 `403`；使用者**不應該知道**它存在（別家公司的發票），回 `404`。

## 動手

1. 開 [RBAC vs ABAC](#/lab/AccessControlLab) 實驗室：在 RBAC 模式把 editor 的 write 取消，看 Alice 的結果；在 ABAC 模式把時間拉到晚上，看 R4 怎麼用拒絕優先蓋過 R1 的允許。
2. 在上面的 Python 範例裡，把 `decide` 的「拒絕優先」改成「允許優先」（先檢查 `permits`），重跑一次，找出哪幾行結果變了、哪一行變成了租戶外洩。
3. 加一條規則：「viewer 只能在 9 點到 18 點之間讀」，用 `env={"hour": 22}` 測試。
4. 為一個自己熟悉的產品（部落格、專案管理工具）列出角色與權限矩陣，再找出三個 RBAC 表達不了、需要資源屬性的需求。
5. 接著讀 [驗證授權落地](#/skill/auth-in-practice)：怎麼把這些檢查寫成框架裡可重用的 dependency，並且用測試確保每個端點都有檢查。

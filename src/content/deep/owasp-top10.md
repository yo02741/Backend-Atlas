## 從一個具體問題開始：一個 PR 裡的六個風險

一個 PR 新增了「訂單收據」功能，程式碼不到三十行：

```python
@app.get("/api/orders/{order_id}/receipt")
def receipt(order_id: int, logo_url: str, user=Depends(current_user)):
    # 依 id 查訂單
    order = db.execute(f"SELECT * FROM orders WHERE id = {order_id}").fetchone()
    # 抓商家 logo 放進收據
    logo = httpx.get(logo_url, timeout=10).content
    pdf = render_pdf(order, logo)
    return Response(pdf, media_type="application/pdf")

@app.exception_handler(Exception)
def on_error(request, exc):
    return JSONResponse({"error": repr(exc), "trace": traceback.format_exc()}, status_code=500)
```

功能測試全部通過，審查者卻在裡面看到了好幾類不同的問題：

| 程式片段 | 問題 | 對應的類別（2021 版編號） |
|---|---|---|
| 查訂單沒有 `user_id = ?` 條件 | 改網址的 `order_id` 就能看別人的訂單 | A01 存取控制失效 |
| `f"... WHERE id = {order_id}"` | 型別宣告剛好擋住了，但同樣的寫法換成字串參數就是注入 | A03 注入 |
| `httpx.get(logo_url)` | 伺服器替使用者去請求任意網址，包括內網與雲端中繼資料端點 | A10 SSRF |
| 錯誤處理回傳完整 traceback | 洩露檔案路徑、套件版本、SQL | A05 安全設定錯誤 |
| 沒有任何紀錄誰下載了哪張收據 | 出事時無法追查 | A09 日誌與監控失效 |
| `render_pdf` 用的 PDF 函式庫三年沒更新 | 可能有已知漏洞 | A06 有漏洞與過時的元件 |

OWASP Top 10 的用途就在這裡：它不是要背的名詞，而是一份**分類好的問題清單**，讓審查時有系統地問「這段程式在每一類上有沒有問題」，而不是只憑經驗想到什麼看什麼。

## 這份清單是什麼

OWASP（Open Worldwide Application Security Project）是一個開放的資安社群。Top 10 是它最知名的文件：根據多個組織提供的漏洞資料與社群調查，整理出 Web 應用程式最常見、影響最大的十類風險。每一類底下對應一組 CWE（Common Weakness Enumeration，弱點分類編號），所以它是「類別」而不是「單一漏洞」。

本課使用 **2021 版**的編號，這是目前文章、工具、稽核文件最常引用的版本。OWASP 之後發布了 2025 版，主要變化包括：軟體供應鏈失效成為獨立類別並升到 A03、SSRF 併入 A01 存取控制失效、新增「例外狀況處理不當」。看到編號時先確認是哪一版；各版的完整內容以 [OWASP Top 10 官方頁面](https://owasp.org/www-project-top-ten/) 的最新版為準。觀念本身沒有改變。

| 編號 | 名稱 | 一句話 |
|---|---|---|
| A01 | Broken Access Control 存取控制失效 | 使用者做了不該被允許的事 |
| A02 | Cryptographic Failures 加密機制失效 | 敏感資料沒保護好或用錯演算法 |
| A03 | Injection 注入 | 輸入被當成程式碼執行（2021 版把 XSS 也歸在這類） |
| A04 | Insecure Design 不安全設計 | 流程本身就有漏洞，程式寫得再正確也沒用 |
| A05 | Security Misconfiguration 安全設定錯誤 | 預設值、debug 模式、過寬的權限 |
| A06 | Vulnerable and Outdated Components 有漏洞與過時的元件 | 依賴有已知漏洞 |
| A07 | Identification and Authentication Failures 身分識別與驗證失效 | 登入、session、密碼重設的缺陷 |
| A08 | Software and Data Integrity Failures 軟體與資料完整性失效 | 沒驗證的更新、反序列化、CI 管線 |
| A09 | Security Logging and Monitoring Failures 日誌與監控失效 | 出事時看不到、查不到 |
| A10 | Server-Side Request Forgery 伺服器端請求偽造 | 伺服器被誘導去請求攻擊者指定的位址 |

API 為主的服務可以再對照 [OWASP API Security Top 10](https://owasp.org/www-project-api-security/)，它把物件層級授權（BOLA）、資源消耗等 API 特有的問題拆得更細；agent 與 MCP 的風險見 [OWASP MCP Top 10](#/skill/owasp-mcp-top10)。

## 十類逐一說明

### A01 存取控制失效

**例子**：`GET /api/orders/1002` 只檢查「有登入」，沒檢查「訂單是不是你的」，這叫 IDOR（Insecure Direct Object Reference）。其他形式：一般使用者呼叫 `DELETE /api/admin/users/5` 成功、前端把按鈕藏起來但 API 沒擋、`PATCH /api/users/me` 可以順便改 `role`。

**對策**：預設拒絕；每個操作在伺服器端檢查**角色**與**資源擁有權**。查詢直接帶上擁有者條件（`WHERE id = ? AND user_id = ?`），比「先查出來再判斷」不容易漏。找不到與沒權限都回 404，避免讓人列舉哪些 id 存在。授權模型見 [RBAC 與 ABAC 授權模型](#/skill/rbac-abac)。

### A02 加密機制失效

**例子**：密碼用 SHA-256 或 MD5 存、HTTP 傳登入資料、身分證字號明文存在資料庫、AES 用固定 IV、金鑰寫在程式碼裡。

**對策**：全站 TLS；密碼用 Argon2id 或 bcrypt；需要拿回原文的敏感欄位用 AES-GCM 並把金鑰放在 KMS；不自己組合密碼學原語。見 [密碼儲存](#/skill/password-storage) 與 [密碼學工具箱](#/skill/crypto-toolbox)。

### A03 注入

**例子**：SQL 字串拼接、`os.system(f"... {filename}")`、把使用者輸入當 Jinja2 模板編譯、MongoDB filter 直接用請求 JSON、模板關掉自動跳脫造成 XSS。

**對策**：參數化查詢；不經 shell 執行命令；輸出依情境跳脫；動態識別字用白名單。見 [注入攻擊](#/skill/injection)、[XSS、CSRF 與安全標頭](#/skill/xss-csrf)。

### A04 不安全設計

**例子**：重設密碼只問「生日」；優惠券可以無限次套用；「每人限購一件」只在前端檢查；簡訊驗證碼 4 位數又沒有嘗試次數上限。這些不是寫錯程式，而是需求或設計本身沒有考慮濫用。

**對策**：設計階段做威脅建模（這個功能會被怎麼濫用？）；把濫用情境寫成測試；業務規則在伺服器端強制，並搭配限流（見 [限流演算法](#/skill/rate-limiting)）。

### A05 安全設定錯誤

**例子**：正式環境開著 debug 模式、錯誤頁印出 traceback、資料庫用預設帳密、物件儲存 bucket 設成公開、CORS 允許任意來源又帶憑證、不必要的管理介面對外開放。

**對策**：設定由程式產生、每個環境一致（見 [環境設定與 12-factor](#/skill/config-12factor)）；上線檢查清單；錯誤回應只給通用訊息與 request id（見 [錯誤設計](#/skill/error-design)）；加上安全標頭。

### A06 有漏洞與過時的元件

**例子**：依賴有公開的 CVE 卻沒升級；base image 兩年沒重建；用了已停止維護的套件。

**對策**：lock 檔、自動化依賴更新、CI 裡的漏洞掃描、定期重建 image。見 [依賴與供應鏈安全](#/skill/supply-chain)。

### A07 身分識別與驗證失效

**例子**：登入沒有限流（可暴力破解或撞庫）；錯誤訊息區分「帳號不存在」與「密碼錯誤」；登入後沒有更換 session id（session fixation）；登出只刪前端的 cookie；重設密碼的 token 不會過期。

**對策**：登入限流與異常偵測；統一錯誤訊息；登入時重發 session；伺服器端可撤銷的 session；MFA。見 [驗證基礎：Session vs Token](#/skill/authn-basics)、[帳號生命週期：註冊、驗證、重設密碼、鎖定](#/skill/account-lifecycle)。

### A08 軟體與資料完整性失效

**例子**：用 `pickle.loads` 解析使用者送來的資料（反序列化可以執行任意程式碼）；應用程式自動下載更新但不驗證簽章；CI 用 `curl … | sh` 安裝工具；簽名 cookie 沒有驗簽章。

**對策**：不反序列化不可信的資料，用 JSON 這類只表示資料的格式；驗證更新與產物的簽章；CI 的第三方元件釘版本與雜湊；有完整性需求的資料用 HMAC 或簽章。

### A09 日誌與監控失效

**例子**：登入失敗、權限拒絕、輸入驗證失敗都沒記錄；有記錄但沒有人看、沒有告警；日誌只存在單一主機上，被入侵時一起被刪；反過來，日誌記了密碼與 token。

**對策**：記錄安全相關事件（誰、何時、做了什麼、結果），集中保存、設定告警；日誌不記秘密與個資。見 [可觀測性：log、metrics、trace](#/skill/observability)、[日誌與稽核紀錄裡的個資](#/skill/logs-pii)。

### A10 伺服器端請求偽造（SSRF）

**例子**：「輸入圖片網址自動抓取」「webhook 測試」「網址預覽」這類功能，伺服器拿使用者給的網址去發請求。攻擊者給 `http://169.254.169.254/`（多數雲端平台的中繼資料端點，可能取得機器的臨時憑證）或 `http://localhost:6379/`、內網的管理介面，伺服器就替他存取了外部碰不到的地方。

**對策**：能用允許清單就用允許清單（只允許特定網域）；不能時，**解析 DNS 後**檢查 IP 不是私有、回送、鏈路本地位址，並用這個 IP 連線（避免檢查和連線之間 DNS 被換掉）；不自動跟隨轉址，或對每次轉址重新檢查；網路層限制應用程式的出站連線；雲端中繼資料服務改用需要 token 的版本（例如 AWS 的 IMDSv2）。

## 實際程式

### A01：把擁有權放進查詢

```python run
import sqlite3

db = sqlite3.connect(":memory:")
db.executescript("""
CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, amount INTEGER);
INSERT INTO orders VALUES (1001, 1, 2400), (1002, 2, 7990), (1003, 1, 890);
""")

class NotFound(Exception): ...

def get_order_unsafe(current_user_id: int, order_id: int):
    # 只看 id：任何登入的人改網址就能讀別人的訂單（IDOR）
    row = db.execute("SELECT id, user_id, amount FROM orders WHERE id = ?", (order_id,)).fetchone()
    if row is None:
        raise NotFound()
    return row

def get_order(current_user_id: int, order_id: int):
    # 擁有者條件直接寫進查詢；不存在與不是你的，對外都是 404
    row = db.execute(
        "SELECT id, user_id, amount FROM orders WHERE id = ? AND user_id = ?",
        (order_id, current_user_id),
    ).fetchone()
    if row is None:
        raise NotFound()
    return row

alice = 1
for oid in (1001, 1002, 9999):
    for fn in (get_order_unsafe, get_order):
        try:
            print(f"{fn.__name__:17} alice 讀 {oid} → {fn(alice, oid)}")
        except NotFound:
            print(f"{fn.__name__:17} alice 讀 {oid} → 404")
```

### A10：檢查要連的位址

瀏覽器裡沒辦法解析 DNS，下面只示範「拿到 IP 之後怎麼判斷」。正式的實作要在解析之後檢查**所有**回傳的 IP，並用檢查過的 IP 連線。

```python run
import ipaddress
from urllib.parse import urlsplit

ALLOWED_SCHEMES = {"https"}
ALLOWED_PORTS = {443}

def check_target(url: str, resolved_ips: list[str]) -> str:
    u = urlsplit(url)
    if u.scheme not in ALLOWED_SCHEMES:
        return f"拒絕：scheme {u.scheme!r}"
    if (u.port or 443) not in ALLOWED_PORTS:
        return f"拒絕：port {u.port}"
    if u.username or u.password:
        return "拒絕：網址含帳密"
    for ip in resolved_ips:
        addr = ipaddress.ip_address(ip)
        # 私有、回送、鏈路本地（含 169.254.169.254）、保留、多播位址都不准連
        if not addr.is_global or addr.is_multicast:
            return f"拒絕：{u.hostname} 解析到 {ip}（非公開位址）"
    return "允許"

cases = [
    ("https://cdn.example.com/logo.png", ["93.184.215.14"]),
    ("http://169.254.169.254/latest/meta-data/", ["169.254.169.254"]),
    ("https://img.example.org/a.png", ["169.254.169.254"]),         # 網域指向中繼資料端點
    ("https://internal.example.com/", ["10.0.3.17"]),
    ("https://looks-public.example.net/", ["127.0.0.1"]),          # 網域指向 localhost
    ("https://v6.example.com/", ["::ffff:192.168.1.10"]),          # IPv4 映射的 IPv6
    ("https://cdn.example.com:6379/", ["93.184.215.14"]),
    ("file:///etc/passwd", []),
]
for url, ips in cases:
    print(f"{url:44} {check_target(url, ips)}")
```

`ipaddress` 的 `is_global` 涵蓋了 RFC 1918 私有網段、回送、鏈路本地等範圍；IPv4 映射的 IPv6 位址（`::ffff:…`）在新版 Python 中會依它對應的 IPv4 判斷。不同版本的判斷細節可能有差異，正式環境建議再加上網路層的出站限制，不只靠應用程式判斷。

## 用它做程式碼審查清單

把十類轉成審查時要問的問題，貼在 PR 範本或審查指南裡。不是每個 PR 都要全部過一遍：先看變更碰到哪些東西，再挑相關的列。

| 變更碰到 | 要問的問題 | 類別 |
|---|---|---|
| 新的 endpoint | 誰能呼叫？有檢查角色嗎？有檢查這筆資料屬於他嗎？測試裡有「別人的資料」這個案例嗎？ | A01 |
| 資料庫查詢 | 有沒有字串拼接？排序、篩選欄位是不是白名單？ | A03 |
| 輸出到 HTML、shell、模板 | 有沒有關掉自動跳脫？有沒有經過 shell？ | A03 |
| 密碼、token、個資欄位 | 怎麼存？用什麼演算法？金鑰在哪？日誌裡會不會出現？ | A02、A09 |
| 新的業務流程 | 這個功能會被怎麼濫用？有次數或金額上限嗎？規則是在伺服器端嗎？ | A04 |
| 設定檔、部署、錯誤處理 | 預設值安全嗎？錯誤回應洩露了什麼？有新開的埠或管理介面嗎？ | A05 |
| 新增或升級依賴 | 名稱對嗎？維護狀態？lock 檔更新了嗎？掃描通過嗎？ | A06、A08 |
| 登入、session、重設密碼 | 有限流嗎？錯誤訊息一致嗎？token 會過期、能撤銷嗎？ | A07 |
| 反序列化、檔案匯入、webhook | 資料來源可信嗎？有驗簽章嗎？用的是只表示資料的格式嗎？ | A08 |
| 安全相關動作 | 失敗與成功都有記錄嗎？記錄裡有沒有秘密？ | A09 |
| 伺服器端發出的 HTTP 請求 | 網址可以由使用者影響嗎？有允許清單或位址檢查嗎？會跟隨轉址嗎？ | A10 |

審查清單的效果取決於兩件事：問題要具體到能回答「有／沒有」，以及最常見的問題（A01、A03）最好有自動化的輔助，例如每個 endpoint 都要有「用別的使用者存取」的測試，或靜態分析工具標出 `execute` 前的字串格式化。

## 常見錯誤

| 錯誤想法或做法 | 會發生什麼 | 修正 |
|---|---|---|
| 把 Top 10 當成「全部的資安」 | 清單外的風險（業務邏輯、資源耗盡）被忽略 | 它是起點；API 服務再對照 API Security Top 10，並針對自己的業務做威脅建模 |
| 只在上線前做一次掃描 | 之後每個 PR 都可能引入新問題 | 審查清單進 PR 範本；靜態分析與依賴掃描進 CI |
| 權限檢查放在前端或閘道「就好」 | 直接呼叫後端、或閘道設定遺漏一條路由就繞過 | 每個服務在處理資源時自己檢查擁有權 |
| 沒權限回 403、不存在回 404 | 攻擊者可以列舉哪些 id 存在 | 對外統一 404；內部日誌記錄真正原因 |
| 正式環境的錯誤處理回傳 `repr(exc)` 或 traceback | 洩露 SQL、路徑、版本 | 回傳通用訊息與 request id，細節只進日誌 |
| SSRF 只檢查網址字串裡的主機名稱 | 網域可以解析到內網 IP，轉址也能繞過 | 解析後檢查 IP、用檢查過的 IP 連線、轉址重新檢查 |
| 不確定是哪一版的編號就引用 | 2021 與 2025 版的同一個編號指的是不同類別 | 引用時寫出版本與名稱，例如「A01:2021 存取控制失效」 |

## 動手

1. 在 A01 那段，加一個 `admin` 角色：管理員可以讀所有訂單、一般使用者只能讀自己的，並讓查詢條件依角色組合（注意不要把角色判斷寫成字串拼接）。
2. 在 A10 那段加入 `"http://[::1]/"`、`"https://example.com@10.0.0.1/"` 兩個案例，觀察 `urlsplit` 怎麼解析主機名稱與帳密欄位。
3. 拿一個自己負責的 API，用「用它做程式碼審查清單」那張表逐列回答，把答不出來或答案是「沒有」的列成待辦。
4. 到實驗室 [SQL Injection](#/lab/SqlInjectionLab) 與 [RBAC vs ABAC](#/lab/AccessControlLab)，分別對應 A03 與 A01。
5. 讀 [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/) 中和自己技術棧相關的幾篇，它是每一類的具體做法。

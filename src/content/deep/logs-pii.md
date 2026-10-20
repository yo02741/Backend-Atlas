## 從一個具體問題開始：為了除錯打開的日誌

登入 API 偶爾回 500，工程師為了查原因，把請求的 body 與 header 整包記進日誌，上線觀察：

```text
2026-10-02T09:14:03+08:00 DEBUG POST /api/login body={"email": "alice@example.com", "password": "S3cret!pass"} headers={"Authorization": "Bearer demo-token-0123456789", "Cookie": "sid=7f3a9c..."}
2026-10-02T09:14:03+08:00 ERROR 更新會員資料失敗：national_id=A123456789 格式不符
2026-10-02T09:14:04+08:00 ERROR duplicate key value violates unique constraint "users_email_key" DETAIL: Key (email)=(bob@example.com) already exists.
```

問題兩天後找到、修好了，但這段設定忘了關。三個月後盤點時發現：日誌平台保存一年，四十多位工程師與一家外包廠商有讀取權限，日誌還被同步到另一個區域做備份。裡面有明文密碼、可以直接拿來呼叫 API 的 token、session cookie，以及身分證字號。

這些資料從沒進過「會員資料庫」，卻比資料庫更容易被看到：資料庫有存取控管、有欄位加密、有稽核；日誌通常沒有。而且日誌一旦送出去，就會被複製到收集器、搜尋索引、備份、甚至匯出給廠商的檔案裡，事後很難刪乾淨。

## 運作原理：個資從哪裡進到日誌

| 外洩點 | 例子 | 常見來源 |
|---|---|---|
| 請求 body | 登入的密碼、表單裡的身分證字號與地址 | 除錯用的 request logging middleware、API gateway 的完整記錄 |
| URL 與 query string | `/reset?token=…`、`/users/alice@example.com`、`?id_no=…` | nginx / 負載平衡器的 access log、瀏覽器歷史、`Referer` 標頭 |
| 標頭 | `Authorization: Bearer …`、`Cookie`、`X-Api-Key` | 記錄「所有 header」的 middleware、反向代理的除錯模式 |
| 例外訊息 | `ValueError(f"身分證字號 {nid} 格式錯誤")`、驗證錯誤把輸入值原樣帶回 | 自己寫的錯誤訊息、框架的驗證錯誤 |
| SQL 與參數 | ORM 的 echo 模式印出參數；資料庫錯誤的 DETAIL 帶出值（上面第三行） | `echo=True`、`log_statement = 'all'`、慢查詢日誌的 `parameters: $1 = '…'` |
| 錯誤追蹤與 APM | 例外發生時自動附上 request 資料與區域變數 | Sentry 這類服務的預設設定 |

規律是：**多數外洩不是有人刻意記錄個資**，而是「整包記下來」的設定、錯誤訊息裡的原始輸入、或第三方工具的預設行為。所以防線要建在「記錄」這個動作本身，而不是期待每個寫 `logger.info` 的人都記得。

### 三層防線

1. **不記（白名單）**：結構化日誌只輸出明確列出的欄位。請求日誌記 `method`、路由樣板（`/users/{id}`，不是實際路徑）、`status`、`duration_ms`、`request_id`、內部的使用者 id；不記 body，不記 header（需要時只挑 `User-Agent` 這類明列的）。黑名單（看到 `password` 就遮）的問題是永遠漏掉新加的欄位：`passwd`、`pin`、`secret_answer`。
2. **遮罩（pattern 當保險）**：在日誌寫出前，用 pattern 再掃一次訊息：email、身分證字號、`Bearer` token、信用卡號。它是白名單之外的第二層，抓的是「不小心混進訊息字串裡」的值。
3. **控管**：日誌本身也是敏感資料。存取要授權並留紀錄、保存期限到了自動刪除、匯出要經過審核。

遮罩的方式依用途選：

| 方式 | 結果 | 適合 |
|---|---|---|
| 完全移除 | `[REDACTED]` | 密碼、token、cookie：沒有任何除錯價值 |
| 部分遮罩 | `A12****789`、`a***@example.com` | 客服或除錯時需要「大概是哪一個」 |
| 假名化（帶金鑰的 HMAC） | `user:5f2c91ab` | 需要追蹤同一個人的多筆行為，但不需要知道是誰 |

## 實際程式

### logging Filter：寫出前遮罩

Python 的 `logging.Filter` 掛在 handler 上，每一筆紀錄在格式化、寫出之前都會經過它。下面的 Filter 處理三個地方：訊息本身（含 `%s` 參數）、透過 `extra=` 加上的欄位、例外的 traceback。

```python run
import logging
import re
import sys

# 遮罩規則：順序有關係，先處理 token，避免 token 裡的片段被其他規則誤判
PATTERNS = [
    (re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+"), "Bearer [REDACTED]"),
    (re.compile(r"(?i)\b(password|passwd|pwd|token|api_key|secret)(\"?\s*[:=]\s*\"?)[^\s\",&}]+"), r"\1\2[REDACTED]"),
    # 身分證字號：英文字母 + 1 或 2 + 8 位數字；新式統一證號第二碼是 8 或 9
    (re.compile(r"\b([A-Z])[1289]\d{8}\b"), lambda m: m.group(0)[:3] + "****" + m.group(0)[-3:]),
    # email：保留第一個字元與網域，方便判斷是哪一類帳號
    (re.compile(r"\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b"), r"\1***@\2"),
]

def mask(text: str) -> str:
    for pattern, repl in PATTERNS:
        text = pattern.sub(repl, text)
    return text

class PiiFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        # 1. 訊息：先把 %s 參數套進去再遮罩，之後清掉 args 避免格式化時又套一次
        record.msg = mask(record.getMessage())
        record.args = None
        # 2. extra= 帶進來的自訂欄位（LogRecord 的標準屬性以外的）
        for key, value in list(vars(record).items()):
            if key not in STANDARD_ATTRS and isinstance(value, str):
                setattr(record, key, mask(value))
        # 3. 例外：先格式化 traceback 再遮罩，Formatter 看到 exc_text 已存在就直接用
        if record.exc_info and not record.exc_text:
            record.exc_text = mask(logging.Formatter().formatException(record.exc_info))
        return True  # 回傳 True：這筆紀錄照樣輸出

STANDARD_ATTRS = set(vars(logging.LogRecord("x", logging.INFO, "", 0, "", None, None))) | {"message", "asctime"}

# 在 Playground 重複執行時，避免同一個 logger 累積多個 handler
logger = logging.getLogger("demo.pii")
logger.handlers.clear()
logger.propagate = False
logger.setLevel(logging.INFO)
handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(logging.Formatter("%(levelname)s %(message)s | client=%(client)s"))
handler.addFilter(PiiFilter())
logger.addHandler(handler)

logger.info("login attempt email=%s", "alice@example.com", extra={"client": "web"})
logger.info("headers: Authorization: Bearer demo-token-0123456789", extra={"client": "web"})
logger.info('payload {"email": "bob@example.com", "password": "S3cret!pass"}', extra={"client": "app"})
logger.info("更新失敗 national_id=%s", "A123456789", extra={"client": "carol@example.com"})
try:
    raise ValueError("身分證字號 B234567890 格式不符")
except ValueError:
    logger.exception("驗證失敗", extra={"client": "web"})
```

幾個細節：

- Filter 要掛在 **handler** 上，而不是只掛在某個 logger 上。掛在 logger 上的 filter 只處理直接送到這個 logger 的紀錄，子 logger 傳上來的紀錄不會經過它；掛在 handler 上，所有經過這個出口的紀錄都會被處理。
- 遮罩要在**寫出之前**。在日誌平台上設定「顯示時遮罩」不夠：原始資料已經被存下、備份、可以被匯出。
- pattern 一定有漏網之魚（沒有 `Bearer` 前綴的 token、寫成 `A 123456789` 的證號），也可能誤判。它是保險，主要的防線仍然是白名單：不要把 body 和 header 整包丟進日誌。

### 結構化日誌：欄位白名單加假名化

JSON 格式的結構化日誌，敏感資料的處理可以做得更確定：只有白名單裡的欄位會被輸出，使用者識別改成假名。

```python run
import hashlib
import hmac
import json

# 假名化金鑰：正式環境放在 secret manager，不寫在程式碼裡；換金鑰後新舊假名就連不起來
PSEUDONYM_KEY = b"demo-only-key-not-for-production"

ALLOWED = {"ts", "level", "event", "request_id", "method", "route", "status", "duration_ms", "user"}

def pseudonym(value: str) -> str:
    # 帶金鑰的 HMAC：同一個人每次得到同一個假名；沒有金鑰的人無法用字典反查
    return "u_" + hmac.new(PSEUDONYM_KEY, value.encode(), hashlib.sha256).hexdigest()[:12]

def to_log_line(event: dict) -> str:
    out = {k: v for k, v in event.items() if k in ALLOWED}
    dropped = sorted(set(event) - ALLOWED)
    if "user" in out:
        out["user"] = pseudonym(str(out["user"]))
    if dropped:
        out["dropped_fields"] = dropped   # 只記欄位名稱，方便發現有人想記不該記的東西
    return json.dumps(out, ensure_ascii=False)

print(to_log_line({
    "ts": "2026-10-02T09:14:03+08:00", "level": "INFO", "event": "login_ok",
    "request_id": "req-7d1c", "method": "POST", "route": "/api/login", "status": 200,
    "duration_ms": 42, "user": "alice@example.com",
    "password": "S3cret!pass", "headers": {"Authorization": "Bearer demo-token-0123456789"},
}))
print(to_log_line({"ts": "2026-10-02T09:20:11+08:00", "level": "INFO", "event": "login_ok", "user": "alice@example.com"}))
```

兩行輸出的 `user` 相同，可以拿來追蹤「同一個人在十分鐘內登入兩次」，但看不出是誰。要注意：

- 假名化不是匿名化。持有金鑰的人可以對特定 email 算出假名、反查紀錄；再加上時間與行為，也可能推回是誰。法規上假名化的資料仍然屬於個資，只是降低了風險。
- 不帶金鑰的雜湊（直接 `sha256(email)`）不算保護：email、電話、身分證字號的可能值有限，攻擊者可以把所有候選值算一遍反查。
- 白名單要配合路由樣板。記 `route = "/users/{id}"` 而不是實際路徑，否則 `/users/alice@example.com` 會從 path 漏出去。

## 稽核紀錄不是一般日誌

一般日誌是給工程師除錯用的；稽核紀錄回答的是「**誰、在什麼時候、對哪一筆資料、做了什麼、結果如何**」，用在調查、爭議處理與合規檢查。兩者的要求不同：

| | 一般日誌 | 稽核紀錄 |
|---|---|---|
| 目的 | 除錯、監控 | 追查責任、證明誰做了什麼 |
| 完整性 | 可以抽樣、可以丟棄部分 | 不能漏：每一次敏感操作都要有一筆 |
| 可否修改 | 不會刻意保護 | 只能新增，不能修改或刪除；寫入者與管理者分開 |
| 內容 | 技術細節 | 行為者、動作、對象、時間、結果、來源、理由 |
| 保存 | 短（天到數週） | 依法規與內部規範，通常較長 |
| 讀取權限 | 工程團隊 | 少數角色（資安、法遵），且讀取本身也要記錄 |

稽核紀錄的對象寫「哪一筆」（類型與 id），不寫資料內容本身。記下「客服 c-017 在 10:02 查看了病患 p-88 的病歷，理由：電話諮詢」就夠了，不要把病歷內容也複製一份進稽核表，否則稽核紀錄就成了第二個需要保護的個資庫。

```sql run
-- 稽核事件表：只新增、不修改；對象記類型與 id，不記內容
CREATE TABLE audit_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id    text NOT NULL,            -- 誰：內部帳號 id，不是姓名或 email
  actor_role  text NOT NULL,
  action      text NOT NULL,            -- 做了什麼：view / update / export / delete
  target_type text NOT NULL,            -- 對哪一類資料
  target_id   text NOT NULL,            -- 對哪一筆
  outcome     text NOT NULL CHECK (outcome IN ('success', 'denied', 'error')),
  reason      text,                     -- 調閱理由（敏感資料的查看通常要求填寫）
  request_id  text,                     -- 對回一般日誌的那一次請求
  source_ip   inet
);

-- 用 trigger 拒絕 UPDATE / DELETE（擋得住應用程式的誤操作，擋不住資料庫的超級使用者；
-- 要防內部竄改，還要把稽核紀錄同步到應用程式帳號無法寫入的另一個儲存）
CREATE FUNCTION audit_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END $$;
CREATE TRIGGER audit_events_no_change BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();

INSERT INTO audit_events (actor_id, actor_role, action, target_type, target_id, outcome, reason, request_id, source_ip) VALUES
  ('c-017', 'support', 'view',   'patient_record', 'p-88', 'success', '電話諮詢', 'req-91a2', '10.0.3.15'),
  ('c-017', 'support', 'export', 'patient_record', 'p-88', 'denied',  NULL,       'req-91b7', '10.0.3.15'),
  ('d-004', 'doctor',  'update', 'patient_record', 'p-88', 'success', '門診紀錄', 'req-92c0', '10.0.5.2');

-- 調查時的典型查詢：某一筆資料被誰看過、改過
SELECT occurred_at::time(0) AS at, actor_id, actor_role, action, outcome, reason
FROM audit_events
WHERE target_type = 'patient_record' AND target_id = 'p-88'
ORDER BY occurred_at, id;
```

接在上面後面執行 `UPDATE audit_events SET outcome = 'success' WHERE id = 2;` 會得到 `ERROR: audit_events is append-only`。

## 保存期限、存取控管與假名化

- **保存期限**：每一類日誌都要有明確的保存期限，依個資法與主管機關的規範、契約與內部政策訂定，並由系統自動刪除（日誌平台的生命週期設定、物件儲存的過期規則），不靠人記得清。期限到了，備份裡的副本也要一起處理。
- **存取控管**：日誌平台的讀取權限依角色開放，正式環境的日誌不給所有工程師；查詢與匯出動作本身要留紀錄。給外部廠商的日誌先過濾。
- **最小蒐集**：每加一個日誌欄位都問一次「除錯時真的需要它嗎」。不記錄的資料不會外洩，也不用規劃保存與刪除。
- **假名化**：需要關聯同一個人的行為時用帶金鑰的假名；金鑰跟日誌分開保管。
- **測試**：在測試裡斷言日誌輸出不含測試用的密碼與 token 字串，比上線後再盤點便宜得多。

## 常見錯誤

| 錯誤 | 後果 | 改法 |
|---|---|---|
| 除錯時打開 body / header logging，事後忘了關 | 密碼與 token 長期留在日誌平台 | 不提供「記錄全部」的開關；需要時只記明列欄位，並設自動失效的時間 |
| 遮罩規則掛在 logger 而不是 handler | 子 logger 或第三方套件的紀錄沒經過遮罩 | Filter 掛在 handler（或根 logger 的 handler） |
| 錯誤訊息直接帶出輸入值 | `ValueError(f"… {national_id} …")` 隨著 traceback 進日誌與錯誤追蹤服務 | 錯誤訊息描述「哪個欄位、什麼問題」，不帶值 |
| 用 `sha256(email)` 當假名 | 可以用候選清單反查 | 帶金鑰的 HMAC，金鑰放 secret manager |
| 稽核紀錄寫進一般日誌 | 被抽樣丟棄、保存太短、誰都能刪 | 獨立的只新增儲存，權限分開 |
| 稽核紀錄複製了資料內容 | 稽核表成了另一個個資庫 | 只記對象的類型與 id、動作與結果 |
| access log 記完整 URL | 重設密碼 token、email 從 query string 漏出 | token 改放 POST body 或標頭；access log 不記 query string 或對特定參數遮罩 |
| 資料庫的慢查詢日誌含參數值 | `parameters: $1 = 'A123456789'` 留在資料庫日誌 | 評估 `log_parameter_max_length` 等設定，並把資料庫日誌納入同樣的存取控管 |

## 動手

1. 執行 Filter 那段，加一行 `logger.info("token=%s", "abc123")`，確認 `token=` 規則有作用；再試 `logger.info("tok %s", "abc123")`，看 pattern 漏掉的情況，想想白名單為什麼是主要防線。
2. 把 `handler.addFilter(PiiFilter())` 改成 `logger.addFilter(PiiFilter())`，再用 `logging.getLogger("demo.pii.child")` 送一筆紀錄，觀察子 logger 的紀錄有沒有被遮罩。
3. 結構化日誌那段，把 `PSEUDONYM_KEY` 換一個值，確認同一個 email 的假名改變了，這就是換金鑰後新舊紀錄無法關聯的原因。
4. 把稽核紀錄那段開到 Playground，在最後加一句 `DELETE FROM audit_events;` 再執行，看 trigger 的錯誤訊息。
5. 程式題「結構化日誌的敏感欄位處理」：實作白名單、標頭遮罩與 query string 遮罩。

## 從一個具體問題開始：agent 記住了不該記的事

一家診所的內部助理 agent 加了「記憶」功能：每次對話結束，agent 把它覺得重要的內容寫進一個共用的筆記庫，下次對話先檢索相關筆記再回答。上線一個月後，一位行政人員問「上週那位糖尿病複診的病人電話是多少」，agent 從記憶裡翻出了另一位護理師上週對話中提到的病人姓名與手機號碼，直接回答了。

這個筆記庫沒有分層：所有人的記憶都寫在同一個地方、任何人都檢索得到。寫入時沒有過濾：模型覺得「病人電話」是重要事實，就記了。也沒有過期：三個月前某次對話隨口說的「這個專案先用 MySQL」，到現在還被當成事實拿出來用，雖然團隊早就改成 PostgreSQL。

記憶功能出問題，幾乎都是這三件事：**記了不該記的、存在太多人看得到的地方、沒有忘記的機制**。

## 運作原理：短期記憶與長期記憶

### 短期記憶就是 context

一次對話裡，模型「記得」前面講過的話，是因為每一輪都把整段對話重送一遍（見 [#/skill/agent-loop](#/skill/agent-loop)）。這就是短期記憶，它有兩個限制：

- **有長度上限**。context window 用完，最舊的內容就得截掉或摘要。
- **對話結束就沒了**。下一次開新對話，模型什麼都不記得。

長對話常見的處理是**滾動摘要**：超過某個長度時，把較舊的訊息請模型摘要成一段，用摘要取代原文。摘要會丟細節，所以重要的決定（「改用 cursor 分頁」）最好在摘要時明確保留。

### 長期記憶是存起來再檢索的筆記

長期記憶跨對話存在，流程和 RAG 很像（見 [#/skill/rag-basics](#/skill/rag-basics)），差別在資料來源是對話本身：

```text
對話進行中 ──▶ 判斷要不要記（寫入時機） ──▶ 過濾（個資、秘密） ──▶ 存入（帶 scope、來源、期限）
                                                                              │
下一次對話 ◀── 放進 context ◀── 排序（相關性 + 最近性） ◀── 檢索（限定 scope、排除過期） ◀┘
```

存起來的東西通常分三種：

| 種類 | 例子 | 期限 |
|---|---|---|
| 事實（fact） | 「負責的服務是 orders-api」「專案用 PostgreSQL 16」 | 長，但會過時；要能更新 |
| 偏好（preference） | 「回答用繁體中文」「程式範例用 Python」 | 長，使用者明說才記 |
| 任務摘要（summary） | 「上次把分頁改成 cursor，PR 已合併」 | 短，幾週後就沒用 |

## 記什麼、不記什麼

**要記的**是能讓下一次對話少問一次、少錯一次的東西：使用者明說的偏好、穩定的環境事實、已經做過的決定。

**不能記的**有三類，而且要在**寫入時**擋，不是檢索時：

1. **個資**：姓名配電話、email、身分證字號、地址。記憶庫通常會被很多次對話讀到，比日誌更容易外洩。處理原則和日誌一樣（見 [#/skill/logs-pii](#/skill/logs-pii)）：能不存就不存，非存不可就假名化並限制存取。
2. **病人資料與其他敏感類別**：病歷、診斷、用藥。這類資料受法規約束，不該進任何共用記憶；需要時應該由有權限的系統即時查詢，而不是讓 agent 記下來。
3. **秘密**：API key、密碼、token。使用者有時會把 key 貼進對話，agent 不該因為「這很重要」就存起來。

用正規表示式擋個資樣式是最低限度，擋不住所有情況（例如姓名本身）。更可靠的做法是**白名單**：只允許寫入特定種類（偏好、環境事實、任務摘要），每種有固定格式，不允許自由文字的「重要事實」。

### 寫入時機

三種常見做法，各有取捨：

- **每輪都記**：最完整，但雜訊最多，模型會記下很多一次性的細節。
- **對話結束時摘要一次**：比較乾淨，但對話中途斷掉就沒記到。
- **使用者明確要求或 agent 提議、使用者確認**：最保守，記憶品質最好，使用者也知道記了什麼。

偏好與事實適合第三種；任務摘要適合第二種。

## 存在哪：scope 決定誰看得到

每一筆記憶都要有 **scope**，檢索時一律限定 scope：

| scope | 誰寫、誰讀 | 適合 |
|---|---|---|
| 個人（`user:<id>`） | 只有本人 | 偏好、個人工作中的任務摘要 |
| 專案（`project:<id>`） | 專案成員 | 技術決定、環境事實、慣例 |
| 團隊（`team:<id>`） | 團隊成員 | 跨專案的慣例、常見問題 |

開頭那間診所的問題，就是所有記憶都在同一個 scope。scope 的過濾要放在**儲存層的查詢條件**裡（`WHERE scope = ?`），不能靠模型「不要說出別人的記憶」——模型看得到的東西就可能說出來。這和 RAG 在檢索層做權限過濾是同一個原則（見 [#/skill/knowledge-poisoning](#/skill/knowledge-poisoning) 的「權限在檢索層過濾」）。

寫入專案或團隊層級的記憶，影響的是所有成員的 agent，應該比個人層級更嚴格：例如只接受工具讀到的內容（ADR、設定檔），或需要人工確認。

## 檢索：關鍵字、向量、最近性

| 方法 | 擅長 | 弱點 |
|---|---|---|
| 關鍵字 | 專有名詞、服務名、錯誤代碼 | 換個說法就找不到 |
| 向量相似度 | 意思相近但用字不同 | 對專有名詞不精確；需要 embedding 模型 |
| 最近性 | 任務摘要、最近的決定 | 舊但仍正確的事實會被壓下去 |

實務上常是組合：先用 scope 與期限過濾，再用關鍵字或向量找候選，最後依相關性與最近性排序取前幾筆。取太多會把 context 塞滿無關內容，通常三到五筆就夠。

## 怎麼忘：過期、刪除、可檢視

- **過期（TTL）**：任務摘要設幾週、推論出來的事實設幾個月，到期後檢索不再回傳，定期清掉。使用者明說的偏好可以不過期，但要能被新的偏好覆蓋。
- **刪除權**：使用者要求刪除時，能把自己 scope 的記憶全部刪掉，而且真的刪（包括 embedding 與備份的處理要寫清楚）。
- **可檢視**：使用者能看到 agent 記了自己什麼。看得到才會發現錯誤的記憶（「我沒說過要用 MySQL」）。
- **來源標記**：每筆記憶記下來源——使用者說的（`user_said`）、agent 推論的（`agent_inferred`）、工具讀到的（`tool:<name>`）。推論來的可信度最低，期限應該最短；衝突時以使用者說的為準。

### 記憶也是注入面

長期記憶會在**之後的對話**裡被放進 context。如果某次對話讀了一份帶有惡意指示的網頁或文件，agent 把其中的內容當成「重要事實」記下來，這段內容就會在未來每次相關對話裡出現——比一次性的提示注入更持久。防法與知識庫下毒相同（見 [#/skill/knowledge-poisoning](#/skill/knowledge-poisoning)）：

- 從外部內容（網頁、檔案、工具結果）衍生的記憶不自動寫入共用 scope。
- 檢索回來的記憶在 context 裡標示為「資料」，不當指令。
- 記錄每筆記憶的來源，出事時能追回是哪次對話寫的，並整批刪掉。

## 實際程式：有 TTL、scope 與來源標記的記憶存放

下面用 `sqlite3` 實作一個最小的記憶存放：寫入時過濾個資樣式、每筆帶 scope 與來源、可設 TTL；檢索時限定 scope 並排除過期；最後示範過期清理與刪除權。時間用固定值，輸出才可重現：

```python run
import re
import sqlite3
from datetime import datetime, timedelta, timezone

TZ = timezone(timedelta(hours=8))
NOW = datetime(2026, 11, 6, 9, 0, tzinfo=TZ)   # 固定「現在」，輸出才可重現

# 個資樣式：命中就拒絕寫入（白名單式的「只記什麼」比黑名單更安全，這裡示範最低限度）
PII_PATTERNS = {
    "email": re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+"),
    "台灣手機": re.compile(r"\b09\d{2}-?\d{3}-?\d{3}\b"),
    "身分證字號樣式": re.compile(r"\b[A-Z][12]\d{8}\b"),
    "信用卡樣式": re.compile(r"\b(?:\d{4}[ -]?){3}\d{4}\b"),
}

def pii_hits(text: str) -> list[str]:
    return [name for name, pat in PII_PATTERNS.items() if pat.search(text)]


db = sqlite3.connect(":memory:")
db.execute("""
CREATE TABLE memories (
  id         INTEGER PRIMARY KEY,
  scope      TEXT NOT NULL,          -- user:<id> / project:<id> / team:<id>
  kind       TEXT NOT NULL,          -- fact / preference / summary
  text       TEXT NOT NULL,
  source     TEXT NOT NULL,          -- user_said / agent_inferred / tool:<name>
  created_at TEXT NOT NULL,
  expires_at TEXT                    -- NULL = 不過期
)""")


def remember(scope, kind, text, source, ttl_days=None, now=NOW):
    hits = pii_hits(text)
    if hits:
        print(f"  拒絕寫入（{', '.join(hits)}）: {text[:30]}…")
        return None
    expires = (now + timedelta(days=ttl_days)).isoformat() if ttl_days else None
    cur = db.execute(
        "INSERT INTO memories (scope, kind, text, source, created_at, expires_at) VALUES (?,?,?,?,?,?)",
        (scope, kind, text, source, now.isoformat(), expires),
    )
    print(f"  寫入 #{cur.lastrowid} [{scope}] {kind} ← {source}" + (f"，{ttl_days} 天後過期" if ttl_days else ""))
    return cur.lastrowid


def recall(scope, query, now=NOW, limit=3):
    """關鍵字命中數優先、再看最近性；過期的不回傳。"""
    words = [w for w in re.split(r"\s+", query.lower()) if w]
    rows = db.execute(
        "SELECT id, kind, text, source, created_at FROM memories "
        "WHERE scope = ? AND (expires_at IS NULL OR expires_at > ?)",
        (scope, now.isoformat()),
    ).fetchall()
    scored = []
    for mid, kind, text, source, created in rows:
        hits = sum(1 for w in words if w in text.lower())
        if hits:
            scored.append((hits, created, mid, kind, text, source))
    scored.sort(key=lambda r: (r[0], r[1]), reverse=True)
    return [{"id": r[2], "kind": r[3], "text": r[4], "source": r[5]} for r in scored[:limit]]


def purge_expired(now=NOW):
    cur = db.execute("DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at <= ?", (now.isoformat(),))
    return cur.rowcount


def forget(scope):
    """刪除權：使用者要求時，整個 scope 一次清掉。"""
    return db.execute("DELETE FROM memories WHERE scope = ?", (scope,)).rowcount


print("=== 寫入 ===")
remember("user:u42", "preference", "回答用繁體中文，程式範例用 Python", "user_said")
remember("user:u42", "fact", "負責的服務是 orders-api，部署在 k8s", "user_said")
remember("user:u42", "summary", "上次任務：把 orders-api 的 OFFSET 分頁改成 cursor 分頁，PR 已合併", "agent_inferred", ttl_days=30)
remember("user:u42", "fact", "使用者說他偏好先看測試再看實作", "agent_inferred", ttl_days=90)
remember("user:u42", "fact", "聯絡方式 ming.wang@example.com，手機 0912-345-678", "user_said")           # 個資 → 拒絕
remember("project:orders-api", "fact", "DB 用 PostgreSQL 16，交易隔離等級預設 READ COMMITTED", "tool:read_adr")

print("\n=== 檢索：u42 問「分頁 怎麼做的」 ===")
for m in recall("user:u42", "分頁 cursor"):
    print(f"  #{m['id']} ({m['kind']}, 來源 {m['source']}) {m['text']}")

print("\n=== 專案層級的記憶，另一個使用者也查得到；個人層級不會外洩 ===")
print("  project:", [m["text"][:20] for m in recall("project:orders-api", "PostgreSQL")])
print("  u99 查 u42 的偏好:", recall("user:u99", "繁體中文"))

print("\n=== 45 天後：摘要（TTL 30 天）過期 ===")
later = NOW + timedelta(days=45)
print("  過期前可見:", [m["id"] for m in recall("user:u42", "分頁")])
print("  過期後可見:", [m["id"] for m in recall("user:u42", "分頁", now=later)])
print("  清掉過期筆數:", purge_expired(now=later))

print("\n=== 使用者行使刪除權 ===")
print("  刪除 user:u42 共", forget("user:u42"), "筆；剩下", db.execute("SELECT count(*) FROM memories").fetchone()[0], "筆（專案層級）")
```

觀察重點：

- 含 email 與手機的那筆在寫入時就被拒絕，資料庫裡從頭到尾沒有它。
- `u99` 用同樣的關鍵字查不到 `u42` 的偏好，因為 scope 在 SQL 的 `WHERE` 裡，不在模型的提示詞裡。
- 任務摘要設了 30 天 TTL，45 天後檢索不到，`purge_expired` 再把它實際刪掉。過期與刪除是兩步：查詢時排除保證不會被用到，定期清理保證不會被存著。
- `forget("user:u42")` 刪掉個人層級的三筆，專案層級的事實不受影響。

## 常見錯誤

**所有記憶放在同一個 scope。** 最常見、後果最嚴重。scope 從第一天就要有，事後補很難把舊資料分乾淨。

**讓模型自由決定要記什麼。** 模型會把「病人電話」判斷為重要。寫入要有白名單種類與過濾，不是靠模型的判斷。

**只在檢索時過濾個資。** 個資已經存進去了，備份、匯出、另一條檢索路徑都可能把它帶出來。過濾放在寫入。

**記憶沒有來源與時間。** 兩筆互相衝突的事實，不知道哪一筆比較新、哪一筆是使用者說的，agent 只能隨便挑一筆。

**刪除只刪主表。** 向量索引、快取、摘要裡還留著同樣的內容。刪除權要涵蓋所有衍生資料，做不到就要在說明裡寫清楚保留範圍。

## 動手

- 在 Playground 開啟上面的程式，把 `PII_PATTERNS` 加一條自訂樣式（例如虛構的病歷號格式 `MRN-\d{6}`），寫一筆含病歷號的記憶確認被拒絕。
- 把 `recall` 的排序改成「最近性優先」，看「分頁 cursor」的查詢結果有什麼不同，想想哪一種適合任務摘要、哪一種適合事實。
- 程式題：實作 `remember / recall / forget`，含個資樣式拒絕寫入、scope 隔離與 TTL。

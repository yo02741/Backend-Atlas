## 從一個具體問題開始：一個引號讓搜尋回傳整張表

後台有一個「用 email 查會員」的功能，程式是這樣寫的：

```python
# 危險：把使用者輸入直接拼進 SQL 字串
def find_user(conn, email: str):
    sql = f"SELECT id, name, email FROM users WHERE email = '{email}'"
    return conn.execute(sql).fetchall()
```

正常輸入 `alice@example.com` 時，送到資料庫的 SQL 是：

```sql
SELECT id, name, email FROM users WHERE email = 'alice@example.com'
```

有人在搜尋框輸入 `' OR '1'='1`，送出去的變成：

```sql
SELECT id, name, email FROM users WHERE email = '' OR '1'='1'
```

第一個引號提前關掉了字串，後面的 `OR '1'='1'` 成了 SQL 語法的一部分。`'1'='1'` 對每一列都成立，於是整張會員表都被回傳。同樣的手法放在登入表單，可以讓「帳號或密碼正確」的判斷永遠成立；放在有權限寫入的帳號上，可以改資料或刪資料。

另一個沒有惡意的版本：會員叫 `O'Brien`，查詢直接噴 `syntax error`。兩件事是同一個 bug——**輸入被當成程式碼的一部分解析**。

## 運作原理：注入改變的是語法結構

資料庫收到 SQL 字串後，第一步是把它切成 token（關鍵字、識別字、字串常值、運算子），再組成語法樹。開發者心中的語法樹長這樣：

| 開發者以為的結構 | 實際被解析的結構（輸入 `' OR '1'='1`） |
|---|---|
| `WHERE` → 比較 `email = <一個字串>` | `WHERE` → `OR` |
| 字串內容：使用者輸入的整段文字 | 左邊：`email = ''`（空字串） |
| | 右邊：`'1' = '1'`（永遠為真） |

拼接的問題不在於「輸入裡有奇怪字元」，而是**程式碼與資料走同一條通道**：資料庫看到的只有一串文字，分不出哪一段是開發者寫的、哪一段是使用者給的。輸入只要能讓解析器切出不同的 token，就能改變查詢的意義。

這個模式出現在所有「把字串交給另一個解譯器」的地方：

| 解譯器 | 拼接的位置 | 名稱 |
|---|---|---|
| SQL 資料庫 | `WHERE`、`ORDER BY`、表名 | SQL injection |
| shell（`/bin/sh`） | `os.system`、`subprocess(..., shell=True)` | 命令注入（OS command injection） |
| 模板引擎（Jinja2 等） | 把使用者輸入當模板原始碼編譯 | 伺服器端模板注入（SSTI） |
| NoSQL 查詢（MongoDB filter） | 使用者的 JSON 直接當 filter | 運算子注入 |
| LDAP、XPath | filter 字串 | LDAP／XPath injection |
| 瀏覽器的 HTML 解析器 | 回應的 HTML | XSS（見 [XSS、CSRF 與安全標頭](#/skill/xss-csrf)） |

### 參數化查詢為什麼有效

參數化查詢（parameterized query，也叫 prepared statement）把「SQL 結構」與「值」分開送。以 PostgreSQL 的 extended query protocol 為例：

1. **Parse**：送出 `SELECT … WHERE email = $1`。資料庫在這一步就完成解析，語法樹裡 `$1` 的位置固定是「一個值」。
2. **Bind**：另外送出參數值，例如 `' OR '1'='1` 這 11 個字元。
3. **Execute**：用已經解析好的語法樹執行。

值到達時解析已經結束，它不會再被切成 token，裡面的引號只是普通字元。所以查詢的意思變成「找 email 剛好等於 `' OR '1'='1` 這串文字的會員」，結果是 0 列。

不是每個驅動都用伺服器端綁定。psycopg2 在客戶端把值跳脫後組成完整字串再送出，psycopg 3 的 `execute` 預設使用伺服器端綁定。兩種都安全，因為跳脫由驅動依資料庫規則完成，不是開發者手寫。關鍵在於：**SQL 字串本身不含任何使用者輸入**。

### 參數化做不到的地方

參數只能代表「值」。表名、欄名、`ORDER BY` 的欄位、`ASC`／`DESC`、`LIMIT` 以外的語法片段都不是值，無法用 `$1` 代表。這些地方的做法只有一種：**白名單對照**，輸入只用來選擇，真正放進 SQL 的是程式裡寫死的字串。

## 實際程式

### 在 PostgreSQL 裡直接比較

PostgreSQL 的 `PREPARE` 就是伺服器端的參數化查詢。下面同時示範 PL/pgSQL 裡的動態 SQL：用 `||` 拼接的 `EXECUTE` 一樣會被注入，改用 `USING` 傳值就安全。

```sql run
-- 1) 參數化：$1 永遠是一個值
PREPARE find_user(text) AS
  SELECT id, name, email FROM users WHERE email = $1;

EXECUTE find_user('alice@example.com');   -- 1 列
EXECUTE find_user(''' OR ''1''=''1');      -- 0 列：整串被當成 email 比對

-- 2) 動態 SQL 的兩種寫法：拼接 vs USING
CREATE FUNCTION count_unsafe(p text) RETURNS bigint AS $$
DECLARE n bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM users WHERE email = ''' || p || '''' INTO n;
  RETURN n;
END $$ LANGUAGE plpgsql;

CREATE FUNCTION count_safe(p text) RETURNS bigint AS $$
DECLARE n bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM users WHERE email = $1' INTO n USING p;
  RETURN n;
END $$ LANGUAGE plpgsql;

SELECT count_unsafe($q$' OR '1'='1$q$) AS unsafe_rows,   -- 5：整張表
       count_safe($q$' OR '1'='1$q$)   AS safe_rows;     -- 0

-- 3) 識別字無法參數化時：format 的 %I 依識別字規則處理（必要時加雙引號），%L 用於值
SELECT format('SELECT %I FROM users ORDER BY %I', 'name', 'created_at') AS built_sql,
       format('ORDER BY %I', 'name; DROP TABLE users') AS quoted_ident,   -- 整串變成一個（不存在的）欄位名
       format('WHERE email = %L', $q$' OR '1'='1$q$) AS quoted_literal;
```

`$q$…$q$` 是 PostgreSQL 的 dollar quoting，裡面的單引號不用重複，方便在範例裡寫出原始輸入。

### Python：拼接、參數化與排序白名單

`sqlite3` 用 `?` 當佔位符（psycopg 用 `%s`，asyncpg 用 `$1`），原理相同。

```python run
import sqlite3

conn = sqlite3.connect(":memory:")
conn.executescript("""
CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, created_at TEXT);
INSERT INTO users VALUES
  (1, 'Alice',   'alice@example.com', '2026-01-05'),
  (2, 'Bob',     'bob@example.com',   '2026-01-12'),
  (3, "O'Brien", 'obrien@example.com', '2026-02-01');
""")

payload = "' OR '1'='1"

# 拼接：輸入改變了 WHERE 的結構
unsafe = f"SELECT id, name FROM users WHERE email = '{payload}'"
print("拼接後的 SQL：", unsafe)
print("拼接結果：", conn.execute(unsafe).fetchall())

# 參數化：SQL 固定，值另外傳
safe = "SELECT id, name FROM users WHERE email = ?"
print("參數化結果：", conn.execute(safe, (payload,)).fetchall())

# 沒有惡意的輸入也會壞：名字裡的單引號
name = "O'Brien"
try:
    conn.execute(f"SELECT id FROM users WHERE name = '{name}'")
except sqlite3.OperationalError as e:
    print("拼接遇到 O'Brien：", type(e).__name__, "-", e)
print("參數化遇到 O'Brien：", conn.execute("SELECT id FROM users WHERE name = ?", (name,)).fetchall())

# 動態排序：欄位名無法參數化 → 白名單把「使用者的選擇」對應到「寫死的 SQL 片段」
SORTS = {"name": "name", "newest": "created_at DESC", "oldest": "created_at ASC"}

def list_users(sort: str):
    order_by = SORTS.get(sort)
    if order_by is None:
        raise ValueError(f"不支援的排序：{sort!r}")
    return conn.execute(f"SELECT id, name FROM users ORDER BY {order_by}").fetchall()

print("newest：", list_users("newest"))
try:
    list_users("name; DROP TABLE users")
except ValueError as e:
    print("被白名單擋下：", e)
```

注意最後的 `f"... ORDER BY {order_by}"` 仍然是字串拼接，但拼進去的只會是 `SORTS` 裡寫死的三個值之一，使用者輸入從頭到尾沒有進到 SQL。

### ORM 也會出事的地方

ORM 在一般查詢會自動參數化，問題出在繞過它的地方：

```python
from sqlalchemy import text, select

# 危險：text() 裡自己做 f-string，和直接拼接沒有差別
session.execute(text(f"SELECT * FROM users WHERE email = '{email}'"))

# 安全：text() 用具名參數
session.execute(text("SELECT * FROM users WHERE email = :email"), {"email": email})

# 危險：把查詢字串參數直接當排序依據
stmt = select(User).order_by(text(request.args["sort"]))

# 安全：白名單對照到欄位物件
SORT_COLUMNS = {"name": User.name, "created": User.created_at}
column = SORT_COLUMNS.get(request.args.get("sort"), User.created_at)
stmt = select(User).order_by(column.desc())
```

Django 的 `raw()`、`extra()`、`RawSQL` 也一樣：它們都接受參數列表（`params=`），問題永遠出在把值格式化進 SQL 字串本身。

### 命令注入

把檔名拼進 shell 命令：

```python
import os, subprocess

filename = "photo.png; rm -rf ~"     # 教科書範例：分號結束前一個命令，接著執行第二個

# 危險：經過 /bin/sh，分號、反引號、$() 都會被 shell 解讀
os.system(f"convert {filename} thumb.jpg")
subprocess.run(f"convert {filename} thumb.jpg", shell=True)

# 安全：串列形式、不經 shell，filename 永遠是 argv 裡的「一個參數」
# "--" 告訴程式後面不再是選項，防止以 "-" 開頭的檔名被當成選項（argument injection）
subprocess.run(["convert", "--", filename, "thumb.jpg"], check=True, timeout=30)
```

串列形式解決的是 shell 的語法解析；參數本身仍然交給目標程式解讀。檔名若以 `-` 開頭，可能被 `convert`、`tar`、`git` 這類程式當成選項，所以加 `--`（前提是該程式支援這個慣例），並且先用白名單限制檔名字元。最好的做法是不用 shell 命令：用函式庫（例如 Pillow 處理圖片）完成同樣的工作。

下面用標準函式庫的 `shlex` 觀察 shell 怎麼切這段字串（這裡只是切 token，不會執行任何命令）：

```python run
import shlex

cmd = "convert photo.png; rm -rf ~ thumb.jpg"
lexer = shlex.shlex(cmd, posix=True, punctuation_chars=True)
print("shell 看到的 token：", list(lexer))     # ';' 是獨立的 token：命令分隔符號

# 若一定要組 shell 字串，shlex.quote 會把值包成單一參數
print("quote 之後：", "convert " + shlex.quote("photo.png; rm -rf ~") + " thumb.jpg")
```

### 模板注入與 NoSQL 運算子注入

**SSTI** 發生在把使用者輸入當成模板**原始碼**編譯：

```python
from jinja2 import Template

# 危險：使用者輸入成為模板原始碼；輸入 {{ 7*7 }} 會得到 49，代表運算式被執行了
Template("Hello " + user_input).render()

# 安全：模板固定，使用者輸入只是變數
Template("Hello {{ name }}").render(name=user_input)
```

模板引擎能存取 Python 物件，能執行運算式就可能一路走到讀檔或執行程式。需要讓使用者自訂模板（例如通知信樣板）時，用 `jinja2.sandbox.SandboxedEnvironment` 並限制可用的變數，或改用只支援變數替換的簡單格式。

**MongoDB** 的 filter 是 JSON：`{"username": u, "password": p}` 裡的 `p` 若來自請求的 JSON，攻擊者可以送 `{"$ne": null}`（不等於 null），條件變成「密碼不是 null」。對策是在邊界把欄位驗證成純字串（見 [輸入驗證與檔案上傳](#/skill/input-validation)），拒絕物件型別的輸入。

### 縱深防禦

參數化是根本解法，下面幾項是「萬一漏了」時限制損害：

- **最小權限的資料庫帳號**：API 用的帳號只有需要的表的 `SELECT`／`INSERT`／`UPDATE`，不是 owner、不能 `DROP`、不能讀 `pg_shadow` 之類的系統表。
- **錯誤訊息不回給客戶端**：資料庫錯誤原文會洩露表名與 SQL 結構，讓試探更容易。客戶端只拿到通用錯誤與 request id，原文進日誌。
- **WAF** 能擋下明顯的 payload，但它是黑名單式的比對，有大量繞過方式，不能取代參數化。

## 常見錯誤與錯誤訊息

| 錯誤寫法 | 現象 | 修正 |
|---|---|---|
| `cur.execute("... = '%s'" % name)` | 名字含引號時 `syntax error at or near "…"`；或被注入 | 用 `cur.execute("... = %s", (name,))`，`%` 運算子換成逗號 |
| 佔位符外面又加了引號：`WHERE name = '%s'` | 值被當成字串常值的內容，查不到或型別錯誤 | 佔位符不加引號，驅動會處理 |
| params 傳字串而不是 tuple：`(name)` | 驅動把字串當成字元序列，出現參數數量不符的 `TypeError`（訊息依驅動而異） | 單一參數寫成 `(name,)` 或 `[name]` |
| 想用參數代表欄位名：`ORDER BY %s` | 不會報錯，但排序依據變成一個常數字串，結果沒有排序 | 白名單；psycopg 可用 `sql.Identifier` 組識別字 |
| `IN (%s)` 放一個 list | 型別錯誤或只比對到一個值 | PostgreSQL 用 `= ANY(%s)` 傳陣列；或依數量產生佔位符 |
| `LIKE` 直接放使用者輸入 | 不是注入，但 `%`、`_` 會變成萬用字元，查詢變慢或結果不對 | 跳脫 `%`、`_`、`\` 後再參數化 |

從錯誤訊息找注入點：PostgreSQL 的 `syntax error at or near "Brien"`、`unterminated quoted string at or near "'…"` 出現在正常使用者的請求裡，幾乎就代表某處在拼接字串。在日誌搜尋這兩種訊息，是找出既有程式裡注入點最快的方式之一。

## 動手

1. 在上面的 SQL 區塊按「在 Playground 開啟」，把 `count_unsafe` 的參數換成 `'alice@example.com'`，確認正常輸入兩個函式結果一樣；再試 `$q$x' OR email LIKE '%bob%$q$`，觀察拼接版本被改寫成什麼條件。
2. 在 Python 區塊的 `SORTS` 加一個 `"email"` 選項，然後試著傳 `"email DESC; --"`，確認它被擋下。
3. 到實驗室 [SQL Injection](#/lab/SqlInjectionLab)，切換拼接與參數化，看同一個 payload 在兩種模式下組出來的 SQL 與命中的列。
4. 程式題 [把字串拼接改成參數化查詢](#/exercise/injection-1)。
5. 用 `grep -rnE 'execute\(f"|execute\(".*%' .` 這類搜尋找出專案裡所有在 `execute` 前格式化字串的地方，逐一確認。agent 情境下的命令注入見 [OWASP MCP Top 10](#/skill/owasp-mcp-top10) 的 MCP05。

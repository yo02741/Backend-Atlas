## 從一個具體問題開始：一篇文章紅了，文件再也寫不進去

部落格用 MongoDB 存文章，設計時覺得「文章和留言一起顯示，就放在一起」，留言直接嵌入成陣列：

```json
{
  "_id": 42,
  "title": "索引為什麼快",
  "author": { "_id": 7, "name": "Alice" },
  "comments": [
    { "user": "Bob", "body": "寫得好", "created_at": "2026-10-01T10:00:00+08:00" },
    { "user": "Carol", "body": "複合索引那段可以再多講", "created_at": "2026-10-01T10:05:00+08:00" }
  ]
}
```

前幾個月一切正常：打開文章頁只要一次查詢。後來一篇文章被大量轉貼，留言衝到幾萬則：

1. 文章頁變慢：每次讀文章都把幾 MB 的留言一起讀出來，就算畫面只顯示最新 20 則。
2. 每次新增留言（`$push`）都在修改一份越來越大的文件，同一篇文章的寫入互相排隊。
3. 最後，新增留言開始失敗：MongoDB 單一文件的上限是 **16 MiB**，更新後的文件超過上限就拒絕寫入。

問題不是 MongoDB，而是「嵌入」這個決定沒有考慮到「多」可以多到多少。文件模型最重要的設計決定，就是什麼要嵌入、什麼要參照。

## 文件模型：document、collection 與 BSON

MongoDB 存的是**文件**（document）：一份有巢狀結構的 JSON 樣子的資料，實際以 BSON（Binary JSON）存放。BSON 比 JSON 多了幾種型別：`ObjectId`、`Date`、`Decimal128`、32 / 64 位元整數、二進位資料。文件放在 **collection** 裡，collection 放在 database 裡。

跟關聯式對照：

| 關聯式（PostgreSQL） | MongoDB | 差異 |
|---|---|---|
| 資料表 table | collection | collection 預設不要求每份文件形狀相同 |
| 列 row | 文件 document | 文件可以巢狀：物件裡有物件、陣列裡有物件 |
| 欄位 column | 欄位 field | 同一個欄位在不同文件裡可以是不同型別（通常是 bug） |
| 主鍵 | `_id` | 每份文件必有，自動有唯一索引 |
| 外鍵約束 | 沒有 | 參照只是存了另一份文件的 `_id`，資料庫不檢查 |
| JOIN | 嵌入，或 aggregation 的 `$lookup` | `$lookup` 能用，但不是日常查詢的主力 |
| 交易 | 單一文件操作是原子的；多文件交易 4.0 起支援 | 設計目標是讓大多數操作只動一份文件 |

最後一列是理解文件模型的關鍵：**單一文件內的更新是原子的**。對同一份文件同時做 `$inc`、`$push`、`$set`，不會出現一半成功一半失敗，也不會互相蓋掉。所以「一起改的資料放在同一份文件裡」，就不需要交易。

## `_id` 與 ObjectId

每份文件都有 `_id`。寫入時沒給，驅動程式會產生一個 **ObjectId**：12 個位元組，依 MongoDB 文件的定義是：

| 位元組 | 內容 |
|---|---|
| 前 4 個 | 建立時間（Unix 秒數） |
| 中間 5 個 | 隨機值，每個機器與程序各一份 |
| 後 3 個 | 遞增計數器，從隨機值開始 |

所以 ObjectId 不用跟資料庫協調就能在用戶端產生、幾乎不會重複，而且**大致**依時間遞增：同一個程序產生的會遞增，不同機器之間只到「秒」的精度。下面用純 Python 照這個格式產生並解析：

```python run
# ObjectId 的 12 個位元組：4 bytes 時間戳（秒）+ 5 bytes 隨機值（每個程序一份）+ 3 bytes 遞增計數器
import os, struct, itertools
from datetime import datetime, timezone, timedelta

TW = timezone(timedelta(hours=8))
_random5 = os.urandom(5)                         # 同一個程序產生的 ObjectId 共用這 5 bytes
_counter = itertools.count(int.from_bytes(os.urandom(3), "big"))

def new_object_id(now: datetime) -> str:
    ts = struct.pack(">I", int(now.timestamp()))           # 大端序 4 bytes
    cnt = (next(_counter) % 0x1000000).to_bytes(3, "big")  # 3 bytes，滿了就繞回
    return (ts + _random5 + cnt).hex()                     # 24 個十六進位字元

def object_id_time(oid: str) -> datetime:
    # 前 8 個十六進位字元就是建立時間；等同 mongosh 的 ObjectId("…").getTimestamp()
    return datetime.fromtimestamp(int(oid[:8], 16), TW)

t = datetime(2026, 10, 20, 9, 30, 0, tzinfo=TW)
ids = [new_object_id(t), new_object_id(t), new_object_id(t + timedelta(seconds=1))]
for oid in ids:
    print(oid, "→", object_id_time(oid).isoformat())

print("同一個程序內，字串排序等於產生順序：", ids == sorted(ids))
```

實務上要注意：

- **ObjectId 不是字串**。`{"_id": "6ad6c418…"}` 查不到用 ObjectId 存的文件，而且不會報錯，只是回傳空結果。從 URL 拿到的 id 要先轉成 ObjectId（PyMongo 是 `bson.ObjectId(s)`）。
- **`_id` 不能修改**。要用自然鍵（例如 email）當 `_id`，要確定它永遠不變。
- 想要依建立時間排序時，`_id` 可以頂用；需要精確時間就另存一個 `created_at`（`Date` 型別）。

## 嵌入還是參照

這個決定靠三個問題，而不是「資料長得像不像物件」：

1. **存取模式**：這兩份資料是不是幾乎總是一起讀？一起改？
2. **「多」有多大**：一對多的「多」是個位數、幾百，還是沒有上限？
3. **獨立性**：子資料會不會被別的文件共用、需不需要單獨查詢或單獨更新？

| 關係 | 例子 | 建議 | 理由 |
|---|---|---|---|
| 一對一、一起讀 | 使用者與他的通知設定 | 嵌入 | 永遠一起讀，沒有理由拆開 |
| 一對少、被擁有 | 使用者的幾個收件地址 | 嵌入陣列 | 數量有上限、不會被別人共用 |
| 一對多、有上限 | 訂單與訂單明細 | 嵌入陣列 | 一張訂單的品項有限，而且下單後幾乎不改 |
| 一對很多、無上限 | 文章與留言 | 參照（留言各自一份文件，存 `post_id`） | 數量沒有上限、要分頁讀 |
| 多對多、共用 | 文章與作者 | 參照，必要時嵌入常用欄位的副本 | 作者會被很多文章共用、會改名 |
| 持續產生 | 感測器每秒讀數 | 參照或分桶（一小時一份文件） | 一份文件一筆讀數太碎，全部嵌入會無限成長 |

16 MiB 上限是硬限制，但通常在碰到上限之前就先出問題了。用 JSON 長度粗估一下嵌入留言會讓文件長多快（BSON 實際大小還會再多一些）：

```python run
# 留言全部嵌入在文章裡：文件會長到多大？用 JSON 長度近似 BSON 大小
import json

LIMIT = 16 * 1024 * 1024                       # MongoDB 單一文件上限 16 MiB
post = {"_id": 42, "title": "索引為什麼快", "author": {"_id": 7, "name": "Alice"}, "comments": []}

def comment(i):
    return {"_id": i, "user": {"_id": 1000 + i % 500, "name": f"user{i % 500}"},
            "body": "寫得很清楚，複合索引那段可以再多講一點。" * 3,
            "created_at": "2026-10-20T09:30:00+08:00", "likes": i % 17}

size = lambda d: len(json.dumps(d, ensure_ascii=False).encode("utf-8"))
one = size(comment(1))
print(f"一則留言約 {one} bytes")

for n in (10, 1_000, 10_000, 50_000):
    post["comments"] = [comment(i) for i in range(n)]
    s = size(post)
    print(f"{n:>6} 則留言：文件 {s / 1024:9.1f} KiB（上限的 {s / LIMIT:6.1%}）")

print(f"估計大約 {LIMIT // one:,} 則留言就會碰到 16 MiB 上限")
# 遠在碰到上限之前：每次讀文章都要讀整份文件、每次 $push 都要改寫這份越來越大的文件
```

### 兩個常用的折衷

- **子集合（subset）**：文章文件裡只嵌入最新 10 則留言，完整留言另存一個 collection。文章頁一次查詢就能顯示，「看更多留言」才查留言 collection。新增留言時兩邊都寫：`$push` 搭配 `$slice: -10` 讓嵌入的陣列只保留最後 10 則。
- **延伸參照（extended reference）**：文章裡存 `author: {_id: 7, name: "Alice"}`，而不是只存 `author_id`。顯示文章時不用再查使用者；代價是作者改名時要更新所有文章裡的副本，或接受副本短暫是舊的。

修正後的設計：

```js
// posts：嵌入作者的常用欄位副本與最新幾則留言
{ "_id": 42, "title": "索引為什麼快",
  "author": { "_id": 7, "name": "Alice" },
  "comment_count": 48213,
  "recent_comments": [ { "_id": 90311, "user": "Dave", "body": "收藏了" } ] }

// comments：每則留言一份文件，用 post_id 參照文章（要建索引 { post_id: 1, _id: -1 }）
{ "_id": 90311, "post_id": 42, "user": { "_id": 10, "name": "Dave" }, "body": "收藏了",
  "created_at": { "$date": "2026-10-20T09:30:00+08:00" } }
```

互動版本見 [文件 vs 關聯式實驗室](#/lab/DocVsRelLab)：同一篇文章在三種擺法下長什麼樣、新增一則留言要動到哪裡。

## Schema 驗證

collection 預設不檢查形狀。沒有任何約束時，幾個月後同一個 collection 會出現 `price` 有時是數字、有時是字串，`createdAt` 與 `created_at` 並存。MongoDB 3.6 起可以在 collection 上掛 `$jsonSchema` 驗證器：

```js
// mongosh：建立 collection 時掛上驗證規則
db.createCollection("posts", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["title", "author", "created_at"],
      properties: {
        title:      { bsonType: "string", maxLength: 200 },
        author:     { bsonType: "object", required: ["_id", "name"] },
        tags:       { bsonType: "array", maxItems: 10, items: { bsonType: "string" } },
        created_at: { bsonType: "date" }
      }
    }
  },
  validationLevel: "strict",     // moderate：只檢查新文件與原本就符合規則的文件
  validationAction: "error"      // warn：不擋寫入，只記 log（導入既有 collection 時先用這個）
})

// 已存在的 collection 用 collMod 修改規則
db.runCommand({ collMod: "posts", validator: { $jsonSchema: { /* … */ } } })
```

不符合規則的寫入會得到 `Document failed validation`（錯誤碼 121）。另一層防線在應用程式：用 pydantic model 或 ODM（例如 Beanie、ODMantic）在寫入前驗證。兩層並用是常見做法：應用程式負責友善的錯誤訊息，資料庫負責擋住繞過應用程式的寫入（批次腳本、手動修資料）。

## 用 PostgreSQL JSONB 對照

文件模型的查詢方式，可以用 PostgreSQL 的 `jsonb` 直接體驗：一欄存整份文件，用運算子取巢狀欄位、拆陣列。下面把開頭那份嵌入留言的文章放進去：

```sql run
-- 一列 = 一份文件；doc 欄位存整份 JSON
CREATE TABLE posts (id bigint PRIMARY KEY, doc jsonb NOT NULL);
INSERT INTO posts VALUES
 (42, '{"title": "索引為什麼快", "author": {"id": 7, "name": "Alice"}, "tags": ["db", "index"],
        "comments": [{"user": "Bob", "body": "寫得好"}, {"user": "Carol", "body": "複合索引那段可以再多講"}]}'),
 (43, '{"title": "快取的三種失效", "author": {"id": 8, "name": "Bob"}, "tags": ["cache"], "comments": []}');

-- 取巢狀欄位：-> 回傳 jsonb，->> 回傳文字（MongoDB：投影 {title: 1, "author.name": 1}）
SELECT id, doc->>'title' AS title, doc->'author'->>'name' AS author,
       jsonb_array_length(doc->'comments') AS 留言數
FROM posts;

-- 包含查詢：tags 陣列裡有 "db"（MongoDB：{tags: "db"}）
SELECT id, doc->>'title' AS title FROM posts WHERE doc @> '{"tags": ["db"]}';

-- 把嵌入的陣列拆成多列（MongoDB aggregation 的 $unwind）
SELECT p.id, c->>'user' AS 留言者, c->>'body' AS 內容
FROM posts p, jsonb_array_elements(p.doc->'comments') AS c;

-- 新增一則留言（MongoDB：$push），看文件大小怎麼變
UPDATE posts
SET doc = jsonb_set(doc, '{comments}', (doc->'comments') || '{"user": "Dave", "body": "MySQL 也一樣嗎？"}'::jsonb)
WHERE id = 42
RETURNING id, jsonb_array_length(doc->'comments') AS 留言數, pg_column_size(doc) AS 文件位元組;
```

對應的 MongoDB 寫法（mongosh，不能在瀏覽器執行）：

```js
db.posts.find({}, { title: 1, "author.name": 1 })
db.posts.find({ tags: "db" })                              // 陣列欄位直接比對元素
db.posts.updateOne({ _id: 42 }, { $push: { comments: { user: "Dave", body: "MySQL 也一樣嗎？" } } })
db.posts.updateOne({ _id: 42 }, { $inc: { comment_count: 1 } })   // 單一文件內原子遞增
```

同一份資料的關聯式版本，就是範例資料庫的做法：留言一張表、用外鍵指向文章，要一起顯示時 JOIN。兩邊的取捨很具體：

```sql run
-- 關聯式：留言是獨立的列，要多少就多少，分頁、單獨查詢、統計都直接
CREATE TABLE articles (id bigint PRIMARY KEY, title text NOT NULL, author_id bigint REFERENCES users(id));
CREATE TABLE comments (id bigint PRIMARY KEY, article_id bigint NOT NULL REFERENCES articles(id),
                       user_id bigint REFERENCES users(id), body text NOT NULL);
INSERT INTO articles VALUES (42, '索引為什麼快', 1);
INSERT INTO comments VALUES (1, 42, 2, '寫得好'), (2, 42, 3, '複合索引那段可以再多講'), (3, 42, 4, 'MySQL 也一樣嗎？');

-- 文章頁：文章 + 作者 + 最新 2 則留言；資料分散在三張表，靠 JOIN 組回來
SELECT a.title, au.name AS 作者, u.name AS 留言者, c.body
FROM articles a
JOIN users au ON au.id = a.author_id
JOIN comments c ON c.article_id = a.id
JOIN users u ON u.id = c.user_id
WHERE a.id = 42
ORDER BY c.id DESC
LIMIT 2;
```

文件模型把「組回來」的工作移到寫入時：資料一開始就照讀取的形狀存好，讀的時候不用 JOIN。代價是寫入時要維護副本、要事先知道主要的讀取方式。關聯式則是寫入時正規化、讀取時組合，查詢方式改變時比較不用重新設計。怎麼在兩者之間選，見 [關聯式 vs 非關聯式怎麼選](#/skill/db-choice)。

## 常見錯誤與錯誤訊息

| 狀況 | 你會看到 | 原因 | 怎麼修 |
|---|---|---|---|
| 重複的唯一值 | `E11000 duplicate key error collection: blog.users index: email_1 dup key: { email: "a@example.com" }` | 違反唯一索引；並行註冊同一個 email 時常見 | 回傳「已存在」，不要重試；唯一性一定要靠唯一索引，不能靠先查再寫 |
| 不符合驗證規則 | `Document failed validation`（錯誤碼 121） | 寫入的文件不符合 `$jsonSchema` | MongoDB 5.0 起錯誤會附上 `errInfo`，指出哪條規則不符；修正資料或規則 |
| 文件太大 | 寫入被拒絕，訊息提到 BSON 文件大小上限（16 MiB） | 無上限的嵌入陣列一路長大 | 改成參照或子集合；陣列用 `$slice` 限制長度 |
| 用字串查 ObjectId | 沒有錯誤，回傳空結果 | `_id` 存的是 ObjectId，查詢給的是字串 | 查詢前轉成 ObjectId |
| 同欄位不同型別 | 沒有錯誤，有些文件查不到 | `{price: 100}` 查不到 `price: "100"` 的文件 | 加 schema 驗證，寫一次性腳本修正舊資料 |

還有兩個設計上的反模式，不會立刻報錯：

- **把關聯式 schema 原封不動搬過來**：每張表一個 collection、到處用 `$lookup` 組回來。這樣既沒有外鍵與 JOIN 最佳化的好處，也沒有文件模型「一次讀完」的好處。
- **把所有東西嵌進一份「使用者文件」**：使用者的訂單、瀏覽紀錄、通知全部塞進去，任何一個功能的寫入都在改同一份大文件。

## 動手

1. 執行 ObjectId 那段，把 `t` 改成你自己的時間，確認前 8 個十六進位字元換算回來就是那個時間。
2. 執行文件大小那段，把留言內容的 `* 3` 改成 `* 10`，看幾則留言就會碰到上限。
3. 在 Playground 用 JSONB 那段的 `posts` 表，試寫一個查詢：找出有任何一則留言是 Bob 寫的文章（提示：`doc @> '{"comments": [{"user": "Bob"}]}'`）。
4. 打開 [文件 vs 關聯式實驗室](#/lab/DocVsRelLab)，在三種模式下各新增幾則留言，比較每次寫入動到的範圍。
5. 為「線上課程：課程、章節、學員、作業繳交」畫出你的嵌入 / 參照設計，每個決定都用上面三個問題說明理由。查詢與索引接著看 [MongoDB 查詢、聚合與索引](#/skill/mongodb-ops)。

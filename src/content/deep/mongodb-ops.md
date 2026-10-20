## 從一個具體問題開始：明明有索引，查詢還是要 3 秒

`orders` collection 有 200 萬份文件。後台的「近期已付款大單」頁面執行：

```js
db.orders.find({ status: "paid", created_at: { $gte: ISODate("2026-09-01") } })
         .sort({ amount: -1 })
         .limit(20)
```

collection 上已經有索引 `{ created_at: 1, status: 1 }`，兩個查詢條件都在裡面，但這個查詢要 3 秒。`explain("executionStats")` 顯示：索引確實有用到，但掃了 60 萬個索引鍵、讀了 60 萬份文件，然後在記憶體裡排序，最後只回傳 20 份。

索引欄位都對，**順序**錯了。把索引改成 `{ status: 1, amount: -1, created_at: 1 }` 後，同一個查詢只讀幾十份文件就結束。要知道為什麼，得先看 MongoDB 查詢怎麼表達條件、索引怎麼被使用。

## 查詢運算子

`find()` 的第一個參數是 filter 文件，欄位對應條件：

| 類別 | 運算子 | 例子 | SQL 對照 |
|---|---|---|---|
| 比較 | `$eq` `$ne` `$gt` `$gte` `$lt` `$lte` | `{ amount: { $gte: 1000 } }` | `amount >= 1000` |
| 集合 | `$in` `$nin` | `{ status: { $in: ["paid", "shipped"] } }` | `status IN (…)` |
| 邏輯 | `$and` `$or` `$not` `$nor` | `{ $or: [{ city: "台北" }, { vip: true }] }` | `OR` |
| 欄位 | `$exists` `$type` | `{ deleted_at: { $exists: false } }` | `deleted_at IS NULL`（不完全等價） |
| 陣列 | `$elemMatch` `$all` `$size` | `{ items: { $elemMatch: { sku: "A", qty: { $gte: 2 } } } }` | 對子表 `EXISTS` |

陣列有一個容易踩的語意差異。`items` 是 `[{sku: "A", qty: 1}, {sku: "B", qty: 5}]` 時：

- `{ "items.sku": "A", "items.qty": { $gte: 2 } }` **會**比對到：sku 條件由第一個元素滿足，qty 條件由第二個元素滿足，兩個條件可以落在不同元素上。
- `{ items: { $elemMatch: { sku: "A", qty: { $gte: 2 } } } }` **不會**比對到：`$elemMatch` 要求同一個元素同時滿足所有條件。

更新則用更新運算子，只送變更的部分，而且在單一文件內原子完成：`$set`、`$unset`、`$inc`、`$push`（搭配 `$each`、`$slice`）、`$addToSet`、`$pull`。用 `replaceOne` 整份覆寫，兩個請求同時讀出、各自修改、各自寫回時，後寫的會蓋掉先寫的。

filter 是一份文件，所以**使用者輸入不能直接當 filter 的值**。登入時寫 `{ email: body.email, password: body.password }`，若 `body.password` 是 `{"$ne": null}` 這個物件，條件就變成「密碼不是 null」。輸入要先驗證成字串，見 [注入攻擊](#/skill/injection)。

## Aggregation pipeline

aggregation 是一串階段（stage），每個階段吃一串文件、吐一串文件給下一個階段：

| 階段 | 做什麼 | SQL 對照 |
|---|---|---|
| `$match` | 過濾 | `WHERE`（放在 `$group` 後面時是 `HAVING`） |
| `$project` / `$set` | 選欄位、算新欄位 | `SELECT` 的欄位清單 |
| `$group` | 依 `_id` 分組並累計（`$sum`、`$avg`、`$max`、`$push`） | `GROUP BY` |
| `$sort` / `$limit` / `$skip` | 排序、取前 N | `ORDER BY` / `LIMIT` / `OFFSET` |
| `$unwind` | 把陣列欄位拆成每個元素一份文件 | 對子表 JOIN 之後每個子列一列 |
| `$lookup` | 到另一個 collection 找對應文件，放進一個陣列欄位 | `LEFT JOIN` |
| `$count` / `$facet` | 計數；同一批輸入跑多條子管線 | `count(*)`；多個查詢 |

「每個作者的文章數，取前 10」寫成 pipeline：

```js
db.posts.aggregate([
  { $match: { published: true } },                              // 1. 先過濾：只有第一個 $match 能用索引
  { $group: { _id: "$author._id", posts: { $sum: 1 },          // 2. 依作者分組計數
              name: { $first: "$author.name" } } },
  { $sort: { posts: -1 } },                                     // 3. 排序
  { $limit: 10 },                                               // 4. 取前 10
  { $project: { _id: 0, author_id: "$_id", name: 1, posts: 1 } }  // 5. 整理輸出形狀
])
```

### 順序就是效能

- **`$match` 與 `$sort` 放最前面才能用索引**。pipeline 開頭的 `$match` / `$sort` 可以由索引支援；經過 `$group`、`$unwind`、`$project` 之後，文件已經不是 collection 裡原本的文件，索引幫不上忙。
- **`$lookup` 越晚越好、輸入越少越好**。`$lookup` 對每一份輸入文件都到另一個 collection 查一次，`foreignField` 上一定要有索引；先 `$match`、`$limit` 把輸入縮小再 lookup。
- **`$group` 與 `$sort` 是阻塞的**：要讀完所有輸入才能輸出。單一階段預設有 100 MB 記憶體限制；MongoDB 6.0 起預設允許溢寫到磁碟（`allowDiskUseByDefault`），較舊版本要在 aggregate 加 `allowDiskUse: true`，否則超過就失敗。
- **`$unwind` 會讓文件數膨脹**：每份訂單 3 個品項，unwind 後就是 3 倍。

MongoDB 的優化器在某些情況會自動調整階段順序（例如把 `$match` 往前移），但不要依賴它：自己把過濾放在最前面，再用 explain 確認。

下面用純 Python 寫一個極小的 pipeline 引擎，印出每個階段輸出幾份文件，比較 `$match` 放前面和放後面的差別：

```python run
# 一個極小的 aggregation pipeline 引擎：每個階段吃一串文件、吐一串文件
from collections import defaultdict
import random

random.seed(7)
CITIES = ["台北", "台中", "高雄", "台南", "新竹"]
users = [{"_id": i, "name": f"user{i}", "city": CITIES[i % 5]} for i in range(1, 201)]
orders = [{"_id": 1000 + i,
           "user_id": random.randint(1, 200),
           "status": random.choice(["paid", "paid", "shipped", "pending", "cancelled"]),
           "items": [{"sku": random.choice("ABCDE"), "qty": random.randint(1, 3)} for _ in range(random.randint(1, 4))],
           "amount": random.randint(100, 5000)} for i in range(5000)]

def get(doc, path):                      # 支援 "user.city" 這種點號路徑
    for k in path.split("."):
        doc = doc.get(k) if isinstance(doc, dict) else None
    return doc

def match(cond):                         # 只支援等值比對，夠示範
    return lambda docs: (d for d in docs if all(get(d, k) == v for k, v in cond.items()))

def lookup(from_docs, local, foreign, as_):
    idx = defaultdict(list)              # 相當於 foreignField 上有索引；沒有的話每份文件都要掃整個 collection
    for f in from_docs:
        idx[f[foreign]].append(f)
    return lambda docs: ({**d, as_: idx.get(get(d, local), [])} for d in docs)

def unwind(path):
    return lambda docs: ({**d, path: x} for d in docs for x in d.get(path, []))

def group(key, field):
    def stage(docs):
        acc = defaultdict(int)
        for d in docs:                   # $group 必須讀完所有輸入才能輸出：阻塞、要記憶體
            acc[get(d, key)] += get(d, field)
        return ({"_id": k, "total": v} for k, v in acc.items())
    return stage

def sort(field, desc=True):
    return lambda docs: iter(sorted(docs, key=lambda d: d[field], reverse=desc))

def limit(n):
    return lambda docs: (d for i, d in enumerate(docs) if i < n)

def aggregate(docs, pipeline):
    counts = []
    for name, stage in pipeline:
        docs = list(stage(docs))
        counts.append(f"{name}→{len(docs)}")
    print("  每階段輸出的文件數：", "  ".join(counts))
    return docs

print("先 $match 再 $lookup：")
r1 = aggregate(orders, [
    ("$match",  match({"status": "paid"})),
    ("$lookup", lookup(users, "user_id", "_id", "user")),
    ("$unwind", unwind("user")),
    ("$group",  group("user.city", "amount")),
    ("$sort",   sort("total")),
    ("$limit",  limit(3)),
])
print("先 $lookup / $unwind 再 $match：")
r2 = aggregate(orders, [
    ("$lookup", lookup(users, "user_id", "_id", "user")),
    ("$unwind", unwind("user")),
    ("$match",  match({"status": "paid"})),
    ("$group",  group("user.city", "amount")),
    ("$sort",   sort("total")),
    ("$limit",  limit(3)),
])
assert r1 == r2                          # 結果一樣，但前者的 $lookup 只處理了約四成的文件
for d in r1:
    print(f"  {d['_id']}：{d['total']:,} 元")

print("$unwind items 之後再 $group，算每個 SKU 賣出的數量：")
r3 = aggregate(orders, [
    ("$match",  match({"status": "paid"})),
    ("$unwind", unwind("items")),
    ("$group",  group("items.sku", "items.qty")),
    ("$sort",   sort("total")),
])
print("  ", {d["_id"]: d["total"] for d in r3})
```

## 索引與 ESR 原則

MongoDB 的索引是 B-tree，規則跟 [索引與查詢計畫](#/skill/indexes) 一樣：複合索引 `{a: 1, b: 1, c: 1}` 依 a、再依 b、再依 c 排序，查詢要用到**最左前綴**。陣列欄位上的索引叫 multikey index，陣列的每個元素各有一個索引鍵。另外還有唯一索引、部分索引（`partialFilterExpression`）、TTL 索引（到期自動刪文件）。

複合索引的欄位順序，MongoDB 文件建議依 **ESR 原則**：

1. **Equality（等值）**：`status: "paid"` 這種精確比對的欄位放最前面。等值條件把範圍縮到索引裡**連續的一段**，而且這一段內部仍然依後面的欄位排序。
2. **Sort（排序）**：`sort` 用的欄位放中間。在等值那一段裡，索引已經依 amount 排好，依序讀出來就是排序結果，不用另外排序；取前 20 筆讀到第 20 筆就停。
3. **Range（範圍）**：`$gte`、`$lt`、`$in`（多值時常被當作範圍）這類條件放最後，在讀索引時順便過濾。

開頭的索引 `{created_at: 1, status: 1}` 把範圍放第一個，符合條件的鍵散在 9 月以後的每一天裡，而且不是依 amount 排序，只能全部讀出來、在記憶體裡排序。

PostgreSQL 的 B-tree 遵守完全相同的規則，可以在瀏覽器裡用 `EXPLAIN` 直接看到差別：查詢計畫裡有沒有 `Sort` 節點，就是 MongoDB explain 裡有沒有 `SORT` 階段。

```sql run
-- 5 萬筆訂單，同一個查詢分別搭配三種欄位順序的複合索引
CREATE TABLE big_orders AS
SELECT g AS id,
       (ARRAY['pending','paid','shipped','cancelled'])[1 + g % 4] AS status,
       (g * 37 % 10000)::numeric AS amount,
       timestamptz '2026-01-01' + (g % 300) * interval '1 day' AS created_at
FROM generate_series(1, 50000) g;
ANALYZE big_orders;

-- 1. 範圍欄位在前：要讀出所有符合的列再排序（計畫裡有 Sort）
CREATE INDEX idx_rs ON big_orders (created_at, status);
EXPLAIN (COSTS OFF) SELECT id, amount FROM big_orders
WHERE status = 'paid' AND created_at >= '2026-09-01' ORDER BY amount DESC LIMIT 20;
DROP INDEX idx_rs;

-- 2. 等值、範圍、排序（E-R-S）：等值之後接範圍，排序欄位的順序被打亂，仍然要 Sort
CREATE INDEX idx_ers ON big_orders (status, created_at, amount DESC);
EXPLAIN (COSTS OFF) SELECT id, amount FROM big_orders
WHERE status = 'paid' AND created_at >= '2026-09-01' ORDER BY amount DESC LIMIT 20;
DROP INDEX idx_ers;

-- 3. 等值、排序、範圍（ESR）：直接依索引順序讀，讀滿 20 筆就停，沒有 Sort
CREATE INDEX idx_esr ON big_orders (status, amount DESC, created_at);
EXPLAIN (COSTS OFF) SELECT id, amount FROM big_orders
WHERE status = 'paid' AND created_at >= '2026-09-01' ORDER BY amount DESC LIMIT 20;
```

ESR 是經驗法則，不是定律。範圍條件很窄（例如只查最近 1 小時）時，範圍欄位放前面反而可能更好，因為要排序的文件本來就很少。最後以 explain 的數字為準。

### 用 explain 確認

```js
db.orders.find({ status: "paid", created_at: { $gte: ISODate("2026-09-01") } })
         .sort({ amount: -1 }).limit(20)
         .explain("executionStats")
```

輸出很長，要看的是這幾個地方：

| 位置 | 看什麼 | 好的訊號 | 壞的訊號 |
|---|---|---|---|
| `winningPlan` 的 stage | 執行計畫的階段樹 | `IXSCAN` → `FETCH`（→ `LIMIT`） | `COLLSCAN`（全表掃描）；出現 `SORT`（記憶體排序） |
| `executionStats.nReturned` | 回傳幾份 | 與下面兩個數字接近 | |
| `totalKeysExamined` | 讀了幾個索引鍵 | 接近 nReturned | 遠大於 nReturned：索引順序或選擇性不佳 |
| `totalDocsExamined` | 讀了幾份文件 | 接近 nReturned；涵蓋查詢時為 0 | 遠大於 nReturned：大部分文件讀了又丟掉 |
| `executionTimeMillis` | 花多久 | | 搭配上面三個數字判斷原因 |

不同版本的 explain 輸出排列不完全一樣（例如啟用 slot-based 執行引擎時，計畫的結構會不同），但 stage 名稱與 executionStats 這幾個數字的意義相同。aggregation 也可以 explain：`db.orders.explain("executionStats").aggregate([...])`，看開頭的 `$match` / `$sort` 有沒有變成 IXSCAN。

## 交易、writeConcern 與讀取偏好

### 多文件交易

MongoDB 4.0 起在 replica set 上支援多文件交易，4.2 起擴及 sharded cluster。用法跟關聯式很像，PyMongo 提供會自動重試的 `with_transaction`：

```python
from pymongo import MongoClient, WriteConcern
from pymongo.read_concern import ReadConcern

client = MongoClient("mongodb://db1,db2,db3/?replicaSet=rs0")
db = client.shop

def place_order(session):
    # 交易裡的每個操作都要帶 session，否則它不屬於這個交易
    r = db.products.update_one({"_id": 1, "stock": {"$gt": 0}}, {"$inc": {"stock": -1}}, session=session)
    if r.modified_count == 0:
        raise ValueError("sold out")              # 丟例外 → 整個交易 abort
    db.orders.insert_one({"user_id": 42, "product_id": 1, "status": "paid"}, session=session)

with client.start_session() as s:
    # with_transaction：遇到暫時性錯誤（TransientTransactionError）會重跑整個 callback
    s.with_transaction(place_order,
                       read_concern=ReadConcern("snapshot"),
                       write_concern=WriteConcern("majority"))
```

交易可以用，但成本比單一文件操作高：交易期間的變更要在提交時一起寫入 oplog、要保留快照、衝突時整個交易重做。交易預設最長 60 秒（`transactionLifetimeLimitSeconds`），超過就被中止。文件模型的設計目標是讓**大多數操作只動一份文件**，交易留給真的跨文件的少數流程（例如上面扣庫存又建訂單）。上面的扣庫存也可以先想想：能不能用單一文件的條件更新 `{"stock": {"$gt": 0}}` + `$inc` 解決，訂單另外處理。

### writeConcern：寫到哪裡才算成功

| 設定 | 意思 | 風險 |
|---|---|---|
| `w: 1` | primary 寫入就回成功 | primary 在複製出去前掛掉，新選出的 primary 沒有這筆，寫入會被 rollback |
| `w: "majority"` | 多數節點確認才回成功 | 延遲較高；MongoDB 5.0 起多數部署的預設值 |
| `j: true` | 寫入日誌（journal）後才回成功 | 搭配 w 使用 |
| `wtimeout` | 等確認的上限 | 逾時回錯誤，但寫入**不一定**沒發生 |

### 讀取偏好與讀取一致性

`readPreference` 決定讀哪個節點：`primary`（預設）、`primaryPreferred`、`secondary`、`secondaryPreferred`、`nearest`。讀 secondary 可以分攤負載，但 secondary 的資料可能落後，使用者剛寫入就讀可能讀不到，跟 PostgreSQL 讀寫分離是同一個問題，見設計情境 [讀寫分離後的「我剛存的怎麼不見了」](#/scenario/replica-consistency)。需要「讀到自己剛寫的」時，可以讀 primary，或使用 causal consistency 的 session（搭配 majority 的讀寫設定）。

`readConcern` 則決定讀到的資料要多「確定」：`local`（預設，可能讀到之後被 rollback 的資料）、`majority`（只讀多數節點確認過的）、`snapshot`（交易內的一致快照）。

## 常見錯誤與錯誤訊息

| 錯誤或現象 | 原因 | 怎麼修 |
|---|---|---|
| `Sort exceeded memory limit of 104857600 bytes`（較舊版本） | 沒有索引支援的排序超過 100 MB | 建符合 ESR 的索引讓排序走索引；必要時允許溢寫到磁碟 |
| `Transaction numbers are only allowed on a replica set member or mongos` | 在單機（standalone）上用交易 | 開發環境也要跑單節點 replica set |
| `WriteConflict`，帶 `TransientTransactionError` 標籤 | 兩個交易改同一份文件 | 重做整個交易；用 `with_transaction` 會自動處理 |
| `E11000 duplicate key error`（建唯一索引時） | 既有資料已經有重複值 | 先用 aggregation `$group` + `$match: {count: {$gt: 1}}` 找出重複、清掉再建 |
| explain 出現 `COLLSCAN` | 沒有可用的索引，或條件不符合最左前綴 | 依查詢建索引；確認欄位型別一致（字串 vs 數字） |
| `$lookup` 很慢 | `foreignField` 沒有索引，或輸入文件太多 | 在被查的 collection 建索引；先 `$match` / `$limit` |
| 登入被 `{"$ne": null}` 繞過 | 使用者輸入直接放進 filter | 驗證輸入型別；用 schema（pydantic）拒絕物件 |

## 動手

1. 執行 pipeline 引擎那段，把 `match({"status": "paid"})` 改成 `match({"status": "cancelled"})`，看兩種順序的 `$lookup` 處理量差多少。
2. 照 pipeline 引擎的寫法，加一個 `count()` 階段，算出每個城市有幾張已付款訂單。
3. 執行 ESR 那段，把查詢的 `created_at >= '2026-09-01'` 改成 `created_at >= '2026-10-27'`（只剩最後幾天），在 Playground 看計畫是否改變，體會「ESR 是經驗法則」。
4. 為開頭的查詢寫出你會建的索引，再寫出它在 explain 裡理想的 `nReturned`、`totalKeysExamined`、`totalDocsExamined` 大概是多少。
5. 資料模型的取捨回到 [MongoDB 文件模型](#/skill/mongodb)。

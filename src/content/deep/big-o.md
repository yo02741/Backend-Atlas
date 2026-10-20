## 從一個具體問題開始：測試時一秒，上線後好幾分鐘

每天凌晨有一支工作，把合作廠商給的會員 CSV 和資料庫裡的會員對照，找出「新的」與「已存在的」：

```python
existing = [row["email"] for row in db.fetch_all("SELECT email FROM users")]   # list

for row in csv_rows:
    if row["email"] in existing:          # 在 list 裡找：每次從頭比到尾
        user = db.fetch_one("SELECT * FROM users WHERE email = %s", [row["email"]])  # 每筆一次查詢
        update_user(user, row)
    else:
        create_user(row)
```

開發環境的 CSV 有 200 筆、資料庫有 300 位會員，一秒內跑完。上線後兩邊各 2 萬筆，這支工作跑了好幾分鐘，還讓資料庫在凌晨多了一波查詢尖峰。

程式邏輯沒錯，錯在它的成本怎麼隨資料量成長：

- `row["email"] in existing` 在 list 裡找，最壞要比對整個 list。2 萬筆 CSV、每筆最多比 2 萬次，最壞約 4 億次比較。資料各變 100 倍，比較次數變 1 萬倍。
- 迴圈裡每一筆都送一句 SQL，2 萬筆就是 2 萬次網路往返。每次就算只要 1 ms，光等網路就是 20 秒。

第一個是 **O(n²)** 的記憶體運算，第二個是 **O(n) 次 I/O**。Big-O 就是用來在寫程式時、還沒上線前，就看出這種「資料一大就爆」的寫法。

## Big-O 在講什麼

Big-O 描述的是**成長率**：輸入大小 n 變大時，工作量最多以什麼速度增加。它不是秒數，所以要拿掉常數和次要的項：`3n² + 100n + 7` 寫成 O(n²)，因為 n 夠大時 n² 那一項主導一切。

最直接的讀法是問：**資料變十倍，時間變幾倍？**

| 複雜度 | 名稱 | n 從 1,000 變 10,000 | 後端裡的典型例子 |
|---|---|---|---|
| O(1) | 常數 | 不變 | dict / set 查找、用主鍵在 Redis 取值 |
| O(log n) | 對數 | 約 1.33 倍 | B-tree 索引查詢、二分搜尋 |
| O(n) | 線性 | 10 倍 | 全表掃描、在 list 裡找、讀完整個檔案 |
| O(n log n) | 線性對數 | 約 13 倍 | 排序（`sorted()`、沒有索引可用的 `ORDER BY`） |
| O(n²) | 平方 | 100 倍 | 巢狀迴圈對照兩個 list、每筆都和其他每筆比 |

log 的成長慢到幾乎感覺不到：log₂ 1,000 ≈ 10、log₂ 1,000,000 ≈ 20、log₂ 1,000,000,000 ≈ 30。資料從一千筆長到十億筆，二分搜尋的步數只從 10 步變 30 步。這就是索引查詢在大表上依然很快的原因。

### 平均、最壞與攤銷

同一個操作常常有不只一個複雜度，要看講的是哪一種：

- **平均**：Python 的 dict / set 查找平均是 O(1)。
- **最壞**：大量 key 的 hash 撞在一起時，dict 查找會退化成 O(n)。這曾被拿來攻擊網站（送出大量刻意碰撞的參數名稱，讓伺服器解析時卡住）。Python 3.3 起預設對 `str` 與 `bytes` 的 hash 加上隨機種子，降低這種攻擊的可行性。
- **攤銷**（amortized）：`list.append` 偶爾要把整個陣列搬到更大的記憶體，那一次是 O(n)，但平均分攤到每次 append 是 O(1)。

### 空間也是複雜度

把一個 list 轉成 set 是用 O(n) 的記憶體換 O(1) 的查找。後端常見的取捨就是這個：多用記憶體（set、dict、快取、索引）換時間。索引本身也是空間換時間，而且每次寫入都要多維護一份，見 [索引](#/skill/indexes) 的寫入成本一段。

## 後端常見操作的複雜度

### Python 內建結構

| 操作 | 複雜度 | 備註 |
|---|---|---|
| `lst[i]`、`len(lst)` | O(1) | list 是連續陣列 |
| `x in lst`、`lst.index(x)`、`lst.remove(x)` | O(n) | 從頭比到尾 |
| `x in s`（set）、`d[k]`（dict） | 平均 O(1) | 最壞 O(n) |
| `lst.append(x)`、`lst.pop()` | 攤銷 O(1) | 在尾端操作 |
| `lst.insert(0, x)`、`lst.pop(0)` | O(n) | 後面的元素全部要搬一格；當佇列用要換 `collections.deque` |
| `deque.appendleft`、`deque.popleft` | O(1) | 兩端都快，中間的索引存取是 O(n) |
| `sorted(lst)`、`lst.sort()` | O(n log n) | 已經接近排好的資料會快很多 |
| `heapq.heappush`、`heapq.heappop` | O(log n) | 取最小值 `heap[0]` 是 O(1) |
| `bisect.bisect_left`（已排序 list） | O(log n) | 但 `bisect.insort` 插入要搬元素，是 O(n) |
| 迴圈裡 `s = s + t` 累加字串 | 可能 O(n²) | Python 文件說明重複串接不可變序列的成本是平方；CPython 對某些情況有最佳化，但不保證。用 `"".join(parts)` |

### SQL 查詢

資料庫也一樣有複雜度，`EXPLAIN` 的每個節點都能對應回去（怎麼讀 EXPLAIN 見 [索引](#/skill/indexes)）：

| 計畫節點 | 大致的複雜度 | 什麼時候出現 |
|---|---|---|
| `Index Scan`（等值） | O(log n) 找到位置，再加上取回的 k 筆 | `WHERE` 欄位有索引且條件夠篩選 |
| `Seq Scan` | O(n) | 沒有可用的索引，或表很小、要取大部分的列 |
| `Sort` | O(n log n) | `ORDER BY` 沒有索引可以照順序讀 |
| `Sort`（top-N heapsort） | 約 O(n log k) | `ORDER BY … LIMIT k`，只保留前 k 名 |
| `Nested Loop` | O(n × m)；內層走索引時約 O(n log m) | 外層很少列，或內層有索引 |
| `Hash Join` | 約 O(n + m) | 等值 JOIN、兩邊都不小 |
| `OFFSET k LIMIT 10` | O(k + 10) | 深分頁：要先產生並丟掉前 k 筆 |
| `SELECT count(*)` | O(n) | PostgreSQL 因為 MVCC 不存現成的總筆數，要數過一遍 |

最後兩行在列表 API 裡很常見：第 9,000 頁的 OFFSET 分頁和「共有幾筆」的總數，都會隨資料量線性變慢。解法見設計情境 [列表 API 的分頁](#/scenario/pagination)。

## 後端的成本模型：先數 I/O 次數

演算法課的 Big-O 數的是 CPU 運算次數。後端程式大部分時間在等 I/O，所以要先數另一個東西：**一次請求要做幾次網路或磁碟往返**。

數量級（示意，實際值依硬體與網路而定）：

| 動作 | 大約的時間數量級 |
|---|---|
| 一次 dict 查找、一次比較 | 數十奈秒 |
| 同機房一次資料庫或 Redis 往返 | 數百微秒到數毫秒 |
| 跨區域的一次 API 呼叫 | 數十到數百毫秒 |

一次資料庫往返的時間，夠 CPU 做幾萬到幾十萬次記憶體運算。所以：

- **O(n) 次查詢比 O(n²) 次記憶體運算更容易出事**。開頭的例子裡，2 萬次查詢光往返就是幾十秒等級；把 list 換成 set 只省掉 CPU 時間，往返次數不會變。
- **N+1 查詢**是最常見的 O(n) 次 I/O：取 n 筆清單，再對每筆各查一次關聯資料。ORM 的延遲載入會在你看不到 SQL 的地方製造它，怎麼從 log 認出來、用 eager loading 改成 2 句，見 [ORM 與 Migration](#/skill/orm-migrations)。
- **批次化**把 O(n) 次 I/O 變成 O(1) 次：`WHERE id = ANY(%s)` 一次取回、`executemany` / `COPY` 一次寫入、Redis 用 pipeline 或 `MGET`。

算一個請求的成本，用兩層：先算 **I/O 次數 × 每次往返的時間**，再對每次 I/O 裡資料庫做的事算 Big-O（例如那句 SQL 是 Index Scan 還是 Seq Scan）。開頭的工作改成「一次取回所有 email 放進 set、比對完再批次寫入」，兩層都下降：記憶體運算 O(n)、查詢次數 O(1)。

## 實際程式：量給自己看

### Python：list、set 與排序後二分搜尋

同樣是「找兩個 list 的共同元素」，三種寫法。n 每次翻倍，看哪一欄跟著變四倍、哪一欄只變兩倍左右：

```python run
import time
import math
from bisect import bisect_left

def timed(fn, *args):
    t0 = time.perf_counter()
    fn(*args)
    return (time.perf_counter() - t0) * 1000   # 毫秒

def common_nested(a, b):
    # 對 a 的每個元素，在 list b 裡線性尋找：O(n × m)
    return [x for x in a if x in b]

def common_set(a, b):
    # 先把 b 轉成 set（O(m)），每次查找平均 O(1)：總共 O(n + m)
    bs = set(b)
    return [x for x in a if x in bs]

def common_sorted(a, b):
    # b 排序一次（O(m log m)），每次用二分搜尋（O(log m)）：總共 O((n + m) log m)
    bs = sorted(b)
    out = []
    for x in a:
        i = bisect_left(bs, x)
        if i < len(bs) and bs[i] == x:
            out.append(x)
    return out

print(f"{'n':>6} {'巢狀 list':>12} {'set':>9} {'排序+二分':>10}")
for n in (1000, 2000, 4000, 8000):
    a = list(range(0, 2 * n, 2))        # n 個偶數
    b = list(range(0, 3 * n, 3))        # n 個 3 的倍數
    assert common_nested(a, b) == common_set(a, b) == common_sorted(a, b)
    print(f"{n:>6} {timed(common_nested, a, b):>10.1f}ms "
          f"{timed(common_set, a, b):>7.2f}ms {timed(common_sorted, a, b):>8.2f}ms")

# 計時會受機器影響；直接算「步數」比較穩定
print()
print(f"{'n':>10} {'log2 n':>7} {'n log2 n':>12} {'n²':>16}")
for n in (1_000, 100_000, 10_000_000):
    print(f"{n:>10,} {math.log2(n):>7.0f} {n * math.log2(n):>12,.0f} {n * n:>16,}")
```

在本機 CPython 3.11 上跑，巢狀 list 那欄從 n = 1,000 的幾毫秒長到 n = 8,000 的幾百毫秒；set 那欄一直在 1 毫秒以下。瀏覽器裡的 Pyodide 比較慢，絕對數字會不同，但倍數關係一樣。小 n 時三者的差距不明顯，這也是開發環境看不出問題的原因。

### SQL：在計畫裡找到複雜度

用 `generate_series` 做出 10 萬筆資料，看排序、深分頁、索引與 JOIN 在計畫裡長什麼樣（本站的 PGlite 是 PostgreSQL 18）：

```sql run
-- 10 萬筆事件；user_id 與 amount 用乘法取餘數打散
CREATE TABLE events AS
SELECT g AS id,
       (g::bigint * 7919) % 100000 AS user_id,
       ((g::bigint * 104729) % 100000) / 100.0 AS amount
FROM generate_series(1, 100000) AS g;
ANALYZE events;

-- 前 10 名：top-N heapsort，只保留 10 筆在記憶體裡
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT id, amount FROM events ORDER BY amount DESC LIMIT 10;

-- 第 9,001 頁：要排好前 90,010 筆再丟掉 90,000 筆
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT id, amount FROM events ORDER BY amount DESC OFFSET 90000 LIMIT 10;

-- 等值查詢：沒有索引是 Seq Scan（O(n)），建索引後是 Index Scan（O(log n)）
EXPLAIN (COSTS OFF) SELECT * FROM events WHERE user_id = 42;
CREATE INDEX ON events (user_id);
EXPLAIN (COSTS OFF) SELECT * FROM events WHERE user_id = 42;
```

這次執行在 PGlite 裡看到的重點：

- `LIMIT 10` 的 `Sort Method: top-N heapsort`，記憶體只用了十幾 kB。
- `OFFSET 90000` 的 Sort 節點 `actual rows` 是 90,010，`Sort Method` 變成 `external merge`，排序資料超過 `work_mem`（預設 4MB）而寫到暫存檔。
- 建索引前是 `Seq Scan on events` 加 `Filter`，建索引後是 `Index Scan using events_user_id_idx`。

規劃器依統計資料與成本估計選計畫，資料分佈或設定不同時，計畫可能不一樣，這是正常的。

## 常數與小 n：什麼時候不用在意

Big-O 拿掉了常數，但常數在 n 小的時候常常決定一切：

- **小表全掃比走索引快**。只有 20 列的表，資料庫會選 `Seq Scan`：一次讀完一個 page，比先讀索引再回表便宜。看到小表沒用索引不是 bug。
- **O(n) 的 C 迴圈可能贏過 O(log n) 的 Python 迴圈**。`x in lst` 是在 C 裡比對，n 只有幾十時比自己寫的二分搜尋還快。
- **快取命中與記憶體佈局**：陣列在記憶體裡連續，掃描時對 CPU 快取友善；鏈結串列每一步都要跳到別處。同樣 O(n)，實際速度可以差很多倍。

所以順序是：先用 Big-O 排除「資料一大一定會爆」的寫法（巢狀迴圈對照、迴圈裡打查詢、深分頁），其他的等量測出瓶頸再優化。判斷要不要優化，用的是**實際會有的 n**：使用者的權限清單永遠只有十幾筆，用 list 就好；訂單表一年後有千萬筆，一開始就要想索引與分頁。

## 常見錯誤與錯誤訊息

複雜度問題很少有專屬的錯誤訊息，通常是以「逾時」的樣子出現：

| 看到的訊息（類似） | 出現在哪 | 背後常見的原因 |
|---|---|---|
| `canceling statement due to statement timeout` | PostgreSQL（設了 `statement_timeout` 時） | 單句 SQL 太慢：大表 Seq Scan、深 OFFSET、沒有索引的 JOIN |
| `[CRITICAL] WORKER TIMEOUT (pid:…)` | Gunicorn | 一個請求做太久：迴圈裡打查詢、在請求裡處理整份大檔 |
| `upstream timed out (110: Connection timed out) while reading response header from upstream` | nginx error log | 後端應用來不及回應，原因同上 |
| 504 Gateway Timeout | 客戶端看到的回應 | 代理層等不到後端 |

從逾時往回找：

1. **看是不是 I/O 次數**。打開 SQL log 或 APM 的 trace，一個請求有幾十、幾百句相似的查詢，就是 N+1 或迴圈裡打查詢。
2. **看單句 SQL 的計畫**。用 `EXPLAIN (ANALYZE, BUFFERS)` 找 `actual rows` 很大的節點：大表上的 `Seq Scan`、`Sort` 加 `external merge`、`Nested Loop` 的內層被重複執行很多次（`loops=` 很大）。
3. **看程式裡的巢狀結構**。迴圈裡的 `in lst`、`lst.index()`、`lst.remove()`、`lst.pop(0)`、每圈都 `sorted()` 一次，都是在 O(n) 外面再乘一個 n。

其他常見的坑：

- **用測試資料判斷效能**。測試資料只有幾百筆，O(n²) 和 O(n) 看起來一樣快。準備一份接近正式規模的資料，或至少把 n 放大十倍、一百倍看成長倍數。
- **正規表示式的回溯**：像 `(a+)+$` 這種巢狀量詞，在某些輸入上回溯次數是指數成長，一個請求就能吃滿 CPU（ReDoS）。不信任的輸入不要套用這類寫法，見 [輸入驗證](#/skill/input-validation)。
- **把 Big-O 當成秒數比較**。O(log n) 的遠端呼叫可能比 O(n) 的記憶體掃描慢得多，常數裡藏著網路往返。

## 動手

1. 開 [Big-O 成長曲線](#/lab/BigOLab) 實驗室，把 n 拉大，看五條曲線在哪裡分開，以及它們分別對應到索引、掃描、排序與 N+1。
2. 在 Playground 跑上面的 Python 範例，把 n 加到 16000，確認巢狀 list 那欄大約再變四倍、set 那欄大約變兩倍。
3. 跑上面的 SQL，把 `OFFSET 90000` 改成 `OFFSET 100`，比較 Sort 節點的 `actual rows` 與 `Sort Method`；再試 `SELECT count(*) FROM events;` 的計畫。
4. 程式題：[把 O(n²) 的交集改成 O(n)](#/exercise/big-o-1)。
5. 接著讀 [後端常用資料結構](#/skill/data-structures)：每一種複雜度背後都是某個資料結構的選擇。

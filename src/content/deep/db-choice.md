## 從一個具體問題開始：四個人的團隊，五種資料庫

一個四人團隊要做活動售票平台。第一版的架構提案是：

| 資料 | 提案 | 理由 |
|---|---|---|
| 活動資訊 | MongoDB | 每種活動的欄位不一樣，schema 彈性 |
| 訂單、付款 | PostgreSQL | 要交易 |
| 登入 session | Redis | 快 |
| 活動搜尋 | Elasticsearch | 要全文檢索 |
| 售票即時統計 | InfluxDB | 時序資料 |

每一項單獨看都說得通。半年後實際遇到的事：

- **跨資料庫沒有交易**。下單要「建立訂單（PostgreSQL）+ 扣活動座位數（MongoDB）」，其中一邊失敗時另一邊已經寫進去了，只好寫補償邏輯。
- **資料要同步**。活動改了標題，MongoDB、Elasticsearch 都要改；同步程式偶爾失敗，搜尋結果出現已下架的活動。
- **維運乘以五**。五套系統各自要備份、監控、升級、做還原演練、設權限、處理資安更新，四個人輪值。
- **團隊只熟其中一兩種**。MongoDB 的索引沒建好、Elasticsearch 的 mapping 設錯要重建索引，都是上線後才發現。

這些成本不在技術比較表裡，但每一項都會發生。選資料庫的問題不是「哪一個最好」，而是「這份資料的需求是什麼、要付多少代價」。

## 六個判斷依據

| 依據 | 要問的問題 | 傾向 |
|---|---|---|
| 一致性需求 | 多筆資料要一起成功或一起失敗嗎？讀到幾秒前的舊資料可以嗎？ | 金流、庫存、帳務 → 關聯式交易；計數、動態牆 → 可以接受最終一致 |
| 查詢模式 | 主要是依 key 取整份資料？臨時組合條件查詢？全文搜尋？依時間範圍聚合？ | 依 key → 鍵值 / 文件；臨時查詢 → 關聯式；相關性排序 → 搜尋引擎；時間聚合 → 時序 / 列式 |
| 關聯 | 實體之間的關聯多嗎？會從不同方向查？ | 多對多、多方向 → 關聯式；資料自成一份、很少跨查 → 文件 |
| 規模 | 資料量多大、寫入多快、成長多快？ | 先量測；單一節點加讀副本能撐住的範圍，不需要為規模換資料庫 |
| 團隊熟悉度 | 出事時誰會查、誰會調？ | 熟悉的工具出事時修得快；不熟的工具要算進學習與試錯成本 |
| 維運成本 | 誰負責備份、監控、升級？有沒有受管服務？ | 每多一種，這些工作就多一份 |

前三項是資料本身的性質，後三項是組織的現實。只看前三項選出來的架構，常常在後三項上付出代價。

## 五類資料庫各擅長什麼

| 類型 | 代表 | 資料模型 | 擅長 | 不擅長 |
|---|---|---|---|---|
| 關聯式 | PostgreSQL、MySQL | 表、列、外鍵 | 交易、約束、JOIN、臨時查詢 | 單一主節點的寫入擴展；極大量分析掃描 |
| 文件 | MongoDB、Firestore | 巢狀文件 | 依 key 讀寫整份資料、每筆形狀不同、水平擴展 | 多方向的關聯查詢；跨文件的約束 |
| 鍵值 | Redis、DynamoDB | key → 值 | 極低延遲的依 key 存取、計數、TTL | 依值查詢、臨時條件組合 |
| 搜尋引擎 | Elasticsearch、OpenSearch | 倒排索引 | 全文檢索、相關性排序、斷詞、多面向篩選 | 交易；當唯一的資料來源；寫入後要等 refresh 才搜得到 |
| 時序 / 列式 | TimescaleDB、InfluxDB、ClickHouse | 依時間或依欄儲存 | 大量依時間寫入、範圍聚合、降採樣、資料保存期限 | 單筆更新、點查詢、交易 |

文件模型的取捨見 [MongoDB 文件模型](#/skill/mongodb)；鍵值與快取見 [Redis 與快取策略](#/skill/redis-cache)；PostgreSQL 內建的全文檢索與它的限制見 [全文檢索](#/skill/full-text-search)。

## 一致性：CAP 在實務上的意思

CAP 定理說的是：分散式系統在**網路分割**（節點之間連不上）發生時，只能在「一致性」（每次讀都拿到最新寫入，否則回錯誤）與「可用性」（每個請求都有回應，但可能是舊資料）之間選一個。沒有分割時，取捨變成延遲與一致性之間的取捨。

實務上要回答的是更具體的問題：

- **單機 PostgreSQL** 是強一致的：commit 之後的讀取一定看得到。加了非同步的讀副本後，讀副本可能落後，「剛寫完就讀」可能讀到舊值，見設計情境 [讀寫分離後的「我剛存的怎麼不見了」](#/scenario/replica-consistency)。
- **分散式資料庫多半可以調整**：MongoDB 用 writeConcern / readConcern / readPreference 決定（見 [MongoDB 查詢、聚合與索引](#/skill/mongodb-ops)）；DynamoDB 的讀取預設是最終一致，可以指定強一致讀。
- **跨兩個資料庫，一定沒有共同的交易**。這是多種資料庫並用時最常被低估的一點：PostgreSQL 與 Elasticsearch 之間的資料只能做到最終一致。

業務上的問題是：「使用者短暫看到舊資料，會造成什麼後果？」按讚數晚 3 秒更新沒有人在意；餘額晚 3 秒更新可能讓人重複付款。

## 「PostgreSQL 先，需要時再加」

很多團隊的路徑是：先用一個 PostgreSQL 承擔大部分需求，等出現明確的訊號才加專用系統。PostgreSQL 本身能涵蓋的範圍比想像中大，下面一段在同一個資料庫裡做五種事：

```sql run
-- 1. 文件式：每種商品的屬性不同，放 JSONB，用 GIN 索引支援包含查詢
ALTER TABLE products ADD COLUMN attrs jsonb NOT NULL DEFAULT '{}';
UPDATE products SET attrs = CASE id
  WHEN 1 THEN '{"layout": "US", "switch": "red", "wireless": true}'
  WHEN 2 THEN '{"dpi": 16000, "wireless": true}'
  WHEN 3 THEN '{"size_inch": 27, "panel": "IPS"}'
  ELSE '{}' END::jsonb;
CREATE INDEX products_attrs_gin ON products USING gin (attrs jsonb_path_ops);
SELECT id, name, attrs FROM products WHERE attrs @> '{"wireless": true}';

-- 2. 全文檢索：tsvector / tsquery（simple 設定不斷詞，中文要另外處理）
SELECT id, name FROM products
WHERE to_tsvector('simple', name || ' ' || coalesce(attrs->>'panel', '')) @@ to_tsquery('simple', 'ips');

-- 3. 時序：一天每分鐘一筆讀數，BRIN 索引（依時間順序寫入的大表很省空間），依小時聚合
CREATE TABLE readings (sensor_id int, ts timestamptz, temp numeric);
INSERT INTO readings
SELECT 1 + g % 3, timestamptz '2026-10-20 00:00+08' + g * interval '1 minute', 20 + (g % 50) / 10.0
FROM generate_series(0, 1439) g;
CREATE INDEX readings_ts_brin ON readings USING brin (ts);
SELECT sensor_id, to_char(date_trunc('hour', ts AT TIME ZONE 'Asia/Taipei'), 'MM-DD HH24:00') AS 小時, round(avg(temp), 2) AS 平均溫度, count(*) AS 筆數
FROM readings
WHERE ts >= '2026-10-20 08:00+08' AND ts < '2026-10-20 10:00+08'
GROUP BY 1, 2 ORDER BY 2, 1;

-- 4. 鍵值：UNLOGGED 表（不寫 WAL，較快，但當機後會被清空）+ UPSERT + 過期時間
CREATE UNLOGGED TABLE kv (k text PRIMARY KEY, v jsonb, expires_at timestamptz);
INSERT INTO kv VALUES ('session:abc', '{"user_id": 1}', now() + interval '30 minutes')
ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, expires_at = EXCLUDED.expires_at;
SELECT v FROM kv WHERE k = 'session:abc' AND expires_at > now();

-- 5. 工作佇列：FOR UPDATE SKIP LOCKED 讓多個 worker 各自領到不同的工作
CREATE TABLE jobs (id bigserial PRIMARY KEY, payload jsonb, status text NOT NULL DEFAULT 'queued');
INSERT INTO jobs (payload) VALUES ('{"send": "receipt", "order": 101}'), ('{"send": "receipt", "order": 103}');
UPDATE jobs SET status = 'running'
WHERE id = (SELECT id FROM jobs WHERE status = 'queued' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING id, payload;
```

此外還有 `LISTEN` / `NOTIFY`（簡單的推播通知）、擴充套件 PostGIS（地理資料）、pgvector（向量相似度）、TimescaleDB（時序）。這條路徑的好處是：一套備份、一套監控、一種技能、而且**所有資料都在同一個交易裡**。

### 這條路徑的限制

「需要時再加」的前提是知道「需要」長什麼樣子。下面是常見的訊號，以及在加新系統之前可以先試的事：

| 訊號 | 先在 PostgreSQL 內試 | 仍然不夠時再考慮 |
|---|---|---|
| 熱門資料的讀取量壓垮 DB，或需要亞毫秒延遲 | 索引、查詢優化、讀副本 | Redis 快取 |
| 搜尋要相關性排序、同義詞、錯字容忍、中文斷詞 | `tsvector` + GIN、`pg_trgm`、中文斷詞擴充套件 | Elasticsearch / OpenSearch |
| 分析查詢要掃數十億列，拖慢線上交易 | 讀副本專門跑報表、物化視圖、分區 | 列式資料庫（ClickHouse、BigQuery 等）與 ETL / CDC 管線 |
| 感測器寫入量極大、需要降採樣與自動刪舊資料 | 依時間分區 + BRIN、TimescaleDB | 專用時序資料庫 |
| 單一主節點的寫入到頂、垂直升級到上限 | 連線池、批次寫入、分區 | 分片（例如 Citus）或分散式資料庫，見 [資料庫撐不住了](#/scenario/db-scaling) |
| 每筆資料形狀差異極大、幾乎都依 key 整份讀寫、要水平擴展寫入 | JSONB | 文件資料庫 |

這條路徑也有限制：等到訊號出現時，資料可能已經很大，遷移本身就是一個專案；PostgreSQL 的全文檢索在中文與相關性排序上確實比不上專用搜尋引擎；把 PostgreSQL 當佇列或快取用，流量大到某個程度時會和主要業務搶資源。「先用一個」不是「永遠只用一個」，而是**每加一個系統都要有一個具體、量測得到的理由**。演進的節奏可以參考設計情境 [從 100 到 10 萬 QPS](#/scenario/scale-path)。

## 加第二個資料庫之後：同步問題

一旦同一份資料存在兩個地方（PostgreSQL 與搜尋引擎、PostgreSQL 與快取），就要決定怎麼讓它們保持一致。最直覺的「寫完 A 再寫 B」（雙寫）在 B 失敗時就分岔了：

```python run
# 雙寫 vs outbox：訂單寫進 PostgreSQL，也要同步到搜尋引擎。搜尋引擎偶爾寫入失敗（注入失敗率）
import random
random.seed(3)

def flaky_search_write(index, doc, fail_rate=0.1):
    if random.random() < fail_rate:
        raise ConnectionError("search cluster timeout")
    index[doc["id"]] = doc

def dual_write(n):
    pg, search = {}, {}
    for i in range(n):
        doc = {"id": i, "title": f"活動 {i}"}
        pg[i] = doc                                   # 1. 寫主資料庫（已 commit）
        try:
            flaky_search_write(search, doc)           # 2. 再寫搜尋引擎：失敗了怎麼辦？
        except ConnectionError:
            pass                                      # 記個 log 就算了 → 兩邊從此不一致
    return pg, search

def with_outbox(n):
    pg, outbox, search = {}, [], {}
    for i in range(n):
        doc = {"id": i, "title": f"活動 {i}"}
        # 同一個資料庫交易：主資料與「待同步事件」一起 commit，要嘛都有、要嘛都沒有
        pg[i] = doc
        outbox.append(doc)
    rounds = 0
    while outbox:                                     # 背景 relay：一直重試到成功為止
        rounds += 1
        pending, outbox = outbox, []
        for doc in pending:
            try:
                flaky_search_write(search, doc)       # 寫入要冪等（同 id 覆寫），重試才安全
            except ConnectionError:
                outbox.append(doc)
    return pg, search, rounds

pg, search = dual_write(1000)
print(f"雙寫：PostgreSQL {len(pg)} 筆，搜尋引擎 {len(search)} 筆，差 {len(pg) - len(search)} 筆")
pg, search, rounds = with_outbox(1000)
print(f"outbox：PostgreSQL {len(pg)} 筆，搜尋引擎 {len(search)} 筆，relay 跑了 {rounds} 輪")
```

兩種可靠的做法：

- **Outbox**：在同一個資料庫交易裡寫入主資料與一筆 outbox 事件，背景程序讀 outbox、送到下游、成功後標記完成。下游寫入必須冪等，因為重試會重送。
- **CDC（Change Data Capture）**：讀資料庫的變更日誌（PostgreSQL 的邏輯複寫），把每筆變更送到下游。Debezium 是常見的工具之一。應用程式不用改，但多了一套要維運的管線。

兩者都只能做到**最終一致**：搜尋結果會比主資料晚一點。這個延遲業務能不能接受，要在設計時就決定。

## 決策表

| 情境 | 建議 | 理由 |
|---|---|---|
| 電商訂單、付款、庫存 | PostgreSQL | 跨表交易、約束、臨時查詢；錯一筆就是錢 |
| 使用者資料、權限、組織架構 | PostgreSQL | 關聯多、會從不同方向查 |
| 商品屬性每類不同 | PostgreSQL JSONB | 共用欄位用一般欄位、各類特有的放 JSONB，不用為此換資料庫 |
| 內容管理（每篇形狀差異大、整份讀寫、幾乎不跨查） | 文件資料庫或 JSONB | 兩者都可；看團隊熟悉度與是否需要水平擴展 |
| session、限流計數、排行榜 | Redis | TTL、原子遞增、sorted set；可以接受偶爾遺失或可以重建 |
| 熱門讀取的快取 | Redis（cache-aside） | 主資料仍在 PostgreSQL，快取可以整個清掉重建 |
| 商品搜尋（相關性、中文斷詞、多面向篩選） | 先 PostgreSQL；需求明確後加 Elasticsearch / OpenSearch | 搜尋引擎是副本，資料來源仍是主資料庫，見 [商品搜尋與篩選](#/scenario/search-filter) |
| IoT 感測器紀錄 | 量小：PostgreSQL 分區；量大：TimescaleDB 或專用時序資料庫 | 依時間寫入、範圍聚合、要自動刪舊資料 |
| 使用者行為分析、大型報表 | 列式資料庫（透過 ETL / CDC 匯入） | 掃描大量列的聚合；不要和線上交易搶同一台資料庫 |

## 常見錯誤

| 錯誤 | 後果 | 比較好的做法 |
|---|---|---|
| 依流行度或履歷選資料庫 | 需求與工具不合，上線後才發現 | 用上面六個依據逐項寫下理由 |
| 「schema 彈性」就選文件資料庫 | 之後需要 JOIN 與跨文件交易時很痛苦；沒有約束的資料越來越亂 | 先問存取模式與關聯；JSONB 也提供彈性 |
| 把搜尋引擎當主資料庫 | 沒有交易；既有欄位的 mapping 型別不能直接修改，要建新索引並 reindex，資料來源不在手上就麻煩了 | 主資料放關聯式，搜尋引擎是可以重建的副本 |
| 雙寫兩個資料庫 | 一邊失敗就永久不一致，而且不會報錯 | outbox 或 CDC |
| 以為跨資料庫有交易 | 部分成功的資料需要人工修 | 把必須一起成功的資料放在同一個資料庫 |
| 為了「以後的規模」提早分散 | 現在就付出維運成本，換來可能永遠用不到的擴展性 | 量測目前的瓶頸，留下可以演進的路徑 |
| 選了之後沒有備份與還原演練 | 不管哪種資料庫，出事時都救不回來 | 每種資料庫都要有備份、異地存放、定期還原，見 [資料庫維運](#/skill/db-operations) |

## 動手

1. 執行 PostgreSQL 那段，把第 2 部分的查詢改成搜尋中文商品名稱「鍵盤」的一部分「鍵」，看 `simple` 設定能不能找到，再對照 [全文檢索](#/skill/full-text-search) 的說明。
2. 執行雙寫那段，把 `fail_rate` 改成 0.01 和 0.3，看雙寫的差距與 outbox 的 relay 輪數怎麼變。
3. 為三個情境各寫一段選擇理由：「電商訂單系統」「IoT 感測器紀錄」「使用者行為分析」。每段都要回答六個依據，並寫出「什麼訊號出現時要改變這個決定」。
4. 列出你的專案目前用到的所有資料儲存（包含快取、搜尋、物件儲存），每一個都寫下：誰負責備份、上次還原演練是什麼時候。

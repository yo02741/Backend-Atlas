## 從一個具體問題開始：搜尋框越來越慢，結果還不準

技術部落格的文章表有 20 萬篇，搜尋功能一開始這樣寫：

```sql
SELECT id, title FROM articles
WHERE title ILIKE '%' || $1 || '%' OR body ILIKE '%' || $1 || '%'
ORDER BY created_at DESC
LIMIT 20;
```

上線時只有幾百篇，查詢不到 1 毫秒。一年後同一句要 800 毫秒，而且使用者開始抱怨結果不對：

- 搜 `log`，第一名是〈Catalog of blog posts〉：`catalog` 和 `blog` 都包含 `log` 這三個字母。
- 搜 `indexes` 找不到只寫了 `index` 的文章；搜 `vacuuming` 找不到寫 `vacuum` 的。
- 結果只能依時間排，標題就叫〈Choosing an index type〉的文章，跟內文順帶提到一次 index 的文章排在一起。

慢和不準是兩個問題。**慢**：B-tree 索引依字串的開頭排序，`LIKE 'abc%'`（前綴）可以用，但前面有 `%` 時不知道從哪裡開始找，只能逐列比對，成本跟資料量成正比（原因在 [索引與查詢計畫](#/skill/indexes)）。**不準**：子字串比對不懂什麼是「一個詞」，也不知道 `indexes` 和 `index` 是同一個詞的不同形態，更沒有「哪篇比較相關」的概念。

全文檢索（full-text search）一次處理這兩件事：先把文字切成詞並正規化，再對「詞」建索引、算相關度。

## 運作原理：tsvector、tsquery 與 @@

### 文件端：to_tsvector 把文字變成詞位清單

`to_tsvector(設定, 文字)` 做三件事：用 parser 把文字切成 token、去掉停用詞（the、were 這類沒有檢索價值的詞）、用字典把每個詞還原成**詞位**（lexeme），並記下它在原文的位置。

```sql run
-- 同一句話，用 english 與 simple 兩種設定斷詞
SELECT to_tsvector('english', 'The indexes were rebuilt after vacuuming the tables') AS english,
       to_tsvector('simple',  'The indexes were rebuilt after vacuuming the tables') AS simple;

-- 查詢端也要用同樣的設定轉成 tsquery，兩邊的詞位才對得上
SELECT to_tsquery('english', 'index & vacuum')                                   AS q1,
       plainto_tsquery('english', 'rebuilding indexes')                          AS q2,
       phraseto_tsquery('english', 'full text search')                           AS q3,
       websearch_to_tsquery('english', '"connection pool" -mysql or pgbouncer')  AS q4;
```

執行結果：

| 設定 | 結果 | 發生了什麼 |
|---|---|---|
| `english` | `'index':2 'rebuilt':4 'tabl':8 'vacuum':6` | 去掉 the / were / after；indexes → index、vacuuming → vacuum、tables → tabl |
| `simple` | `'after':5 'indexes':2 'rebuilt':4 'tables':8 'the':1,7 'vacuuming':6 'were':3` | 只轉小寫，不去停用詞、不還原字根 |

詞位不一定是英文單字（`tabl`），它只是比對用的正規化形式。`english` 設定用的是 Snowball stemmer，規則式地砍字尾，所以 `rebuilt` 不會變成 `rebuild`：搜 `rebuilding`（→ `rebuild`）找不到寫 `rebuilt` 的文章。字根還原能處理規則的字形變化，處理不了不規則動詞與同義詞。

### 查詢端：四種把使用者輸入變成 tsquery 的函式

tsquery 的運算子有 `&`（且）、`|`（或）、`!`（非）、`<->`（緊接著）與 `:*`（前綴）。四個函式差在「誰負責寫這些運算子」：

| 函式 | 輸入 | 適合 |
|---|---|---|
| `to_tsquery` | 運算子要自己寫，例如 `index & vacuum` | 程式組出來的查詢 |
| `plainto_tsquery` | 一般文字，詞之間一律當成「且」 | 簡單的搜尋框 |
| `phraseto_tsquery` | 一般文字，詞要依序相鄰 | 片語搜尋 |
| `websearch_to_tsquery` | 類似搜尋引擎的語法：雙引號片語、`-` 排除、`or` | **直接接使用者輸入** |

上面 q1–q4 的結果：

```text
q1  'index' & 'vacuum'
q2  'rebuild' & 'index'
q3  'full' <-> 'text' <-> 'search'
q4  'connect' <-> 'pool' & !'mysql' | 'pgbouncer'
```

`to_tsquery` 會解析運算子，使用者輸入 `connection pool`（兩個詞之間沒有運算子）就會報錯 `syntax error in tsquery`。接使用者輸入時用 `websearch_to_tsquery` 或 `plainto_tsquery`，它們不會因為輸入格式而失敗。

### 比對：@@

`tsvector @@ tsquery` 回傳 true / false：文件的詞位是否滿足查詢。整套機制就是「兩邊用同一個設定正規化，再比對詞位」，所以**建索引、存欄位、查詢三處的設定必須一致**。文件用 `english` 斷詞、查詢用 `simple`，`vacuuming` 對 `vacuum` 就配不起來。

### GIN 索引：從詞位找文件

GIN（Generalized Inverted Index）是倒排索引：key 是每個詞位，value 是含有這個詞位的列的位置清單。查 `'index' & 'vacuum'` 時，分別取出兩個詞位的清單再取交集，不用掃描任何一篇文章的內容。

| 詞位 | 出現在哪些列 |
|---|---|
| `index` | 1, 2, 4 |
| `vacuum` | 1, 4 |
| `pool` | 3 |

代價在寫入：一篇文章有幾百個詞位，插入一篇就要更新幾百個 key。GIN 預設用 `fastupdate` 先把新項目放進待處理清單，之後再整批併入主結構，所以寫入不會太慢，但查詢時也要掃這份清單。寫入很頻繁的表要注意這一點。

另一個選項是 GiST 索引，建立與更新比較快，但它是有損的（lossy），查到後還要回表重新檢查，一般的全文檢索查詢比 GIN 慢。多數情況選 GIN。

### 相關度：ts_rank 與權重

`ts_rank(tsvector, tsquery)` 依詞位出現的次數與權重算出分數；`ts_rank_cd` 另外考慮查詢詞在文件裡彼此的距離（cover density）。詞位可以用 `setweight` 標成 A、B、C、D 四級，預設權重是 A = 1.0、B = 0.4、C = 0.2、D = 0.1，標題標 A、內文標 B，標題命中的文章自然排在前面。

分數只對同一個查詢內的排序有意義，不同查詢的分數不能拿來比較，也不是百分比。

## 實際程式：產生欄位 + GIN 索引

```sql run
-- tsvector 存成產生欄位（generated column）：寫入時自動算好，查詢與索引都用它
CREATE TABLE articles (
  id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL,
  body  text NOT NULL,
  tsv   tsvector GENERATED ALWAYS AS (
          setweight(to_tsvector('english', title), 'A') ||   -- 標題權重 A
          setweight(to_tsvector('english', body),  'B')      -- 內文權重 B
        ) STORED
);
CREATE INDEX articles_tsv_idx ON articles USING gin (tsv);

INSERT INTO articles (title, body) VALUES
  ('Tuning autovacuum', 'Autovacuum removes dead tuples. Vacuuming large tables too rarely makes indexes bloat.'),
  ('Choosing an index type', 'B-tree indexes handle equality and range queries. GIN indexes handle arrays and full text search.'),
  ('Connection pooling with PgBouncer', 'A connection pool keeps a few server connections open and shares them between clients.'),
  ('Reindexing bloated indexes', 'After heavy updates an index can bloat; REINDEX CONCURRENTLY rebuilds it without blocking writes. Run VACUUM first.'),
  ('Catalog of blog posts', 'A list of every post on this blog, grouped by year.');

-- 1. 子字串比對：搜 log 命中的是 catalog / blog
SELECT id, title FROM articles WHERE title ILIKE '%log%' OR body ILIKE '%log%';

-- 2. 全文檢索：搜 bloat，標題有 bloated 的（權重 A）排在只有內文提到的（權重 B）前面
SELECT id, title, round(ts_rank(tsv, q)::numeric, 3) AS rank
FROM articles, websearch_to_tsquery('english', 'bloat') AS q
WHERE tsv @@ q
ORDER BY rank DESC;

-- 3. 多詞查詢，並用 ts_headline 產生帶標記的摘要（只對要顯示的幾筆做，它很貴）
SELECT id, title,
       ts_headline('english', body, q, 'MaxWords=12, MinWords=5') AS snippet
FROM articles, websearch_to_tsquery('english', 'vacuum indexes') AS q
WHERE tsv @@ q
ORDER BY ts_rank(tsv, q) DESC;

-- 4. 確認查詢用得到 GIN 索引（資料太少時規劃器偏好全表掃描，這裡暫時關掉它來看計畫）
SET enable_seqscan = off;
EXPLAIN SELECT id FROM articles WHERE tsv @@ websearch_to_tsquery('english', 'vacuum indexes');
RESET enable_seqscan;
```

第 4 段的計畫裡會看到 `Bitmap Index Scan on articles_tsv_idx`，接著是 `Bitmap Heap Scan` 與 `Recheck Cond`：GIN 索引找出候選列，再回表取資料。

### 不想多一個欄位：表達式索引

也可以不存 `tsv` 欄位，直接對表達式建索引：

```sql
CREATE INDEX articles_body_fts ON articles USING gin (to_tsvector('english', body));

-- 查詢的表達式必須跟索引「一字不差」，包括設定名稱，索引才用得上
SELECT id FROM articles WHERE to_tsvector('english', body) @@ websearch_to_tsquery('english', 'vacuum');

-- 這句用不到上面的索引：少了設定名稱，用的是 default_text_search_config，規劃器不認為是同一個表達式
SELECT id FROM articles WHERE to_tsvector(body) @@ websearch_to_tsquery('vacuum');
```

表達式索引省空間，但每次排序算 `ts_rank` 都要重新斷詞；產生欄位多佔空間，換來查詢時不用重算，也不怕表達式寫錯。多欄位加權的情況，產生欄位比較好維護。

### 中文：內建設定不會斷詞

PostgreSQL 內建的設定沒有中文斷詞。parser 依空白與標點切 token，一整段沒有空白的中文會變成**一個**詞位：

```sql run
SELECT to_tsvector('simple', '全文檢索很好用')            AS no_spaces,      -- 整句一個詞位
       to_tsvector('simple', '全文 檢索 很 好用')         AS pre_segmented,  -- 先斷好詞、用空白隔開
       to_tsvector('simple', '全文檢索') @@ to_tsquery('simple', '檢索') AS fts_match,   -- false
       '全文檢索很好用' LIKE '%檢索%'                     AS like_match;     -- true
```

可行的做法：

| 做法 | 怎麼做 | 代價 |
|---|---|---|
| 應用層先斷詞 | 寫入前用斷詞函式庫切好詞、用空白串起來，存進欄位，再用 `simple` 設定建 tsvector；查詢字串也用同一套斷詞 | 斷詞器與詞典要自己維護，兩端必須用同一個版本 |
| 中文斷詞擴充 | 例如 zhparser、pg_jieba，安裝後建立中文的 text search configuration | 要能在資料庫上裝擴充；多數受管服務不提供這些擴充 |
| `pg_trgm` 三元組 | 把字串切成連續三個字元的片段，建 GIN 索引加速 `LIKE '%…%'` 與相似度查詢 | 見下方說明；沒有語意上的「詞」，也沒有 ts_rank 那種相關度 |
| 外部搜尋引擎 | Elasticsearch / OpenSearch 搭配中文分析器 | 多一套系統與資料同步 |

`pg_trgm` 是 PostgreSQL 官方附帶的擴充（contrib），多數環境可以直接 `CREATE EXTENSION`。本站瀏覽器裡的 PostgreSQL 沒有載入它，所以下面這段沒有標成可執行：

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX articles_title_trgm ON articles USING gin (title gin_trgm_ops);

-- 有了 trigram 索引，前後都有 % 的 LIKE / ILIKE 也能走索引
SELECT id, title FROM articles WHERE title ILIKE '%vacuum%';

-- 相似度：容忍拼錯（% 運算子用 pg_trgm.similarity_threshold，預設 0.3）
SELECT title, similarity(title, 'autovacum') AS sim
FROM articles WHERE title % 'autovacum' ORDER BY sim DESC;
```

用在中文時有兩個限制要先實測：

- 中文詞常常只有兩個字。`LIKE '%檢索%'` 抽不出任何三個字元的片段時，trigram 索引幫不上忙，會退化成掃描整個索引。
- `pg_trgm` 只從「字母與數字」組成的字裡抽三元組，中文字元算不算由資料庫的 locale（`LC_CTYPE`）決定，不同環境的結果可能不同。

### 什麼時候該換搜尋引擎

PostgreSQL 全文檢索的優點是零同步：文章 commit 的同時就搜得到，篩選條件、權限檢查、分頁都在同一句 SQL 裡。需要以下功能時，Elasticsearch / OpenSearch 這類搜尋引擎比較省力：

- 中文或多語系的斷詞、同義詞、拼音
- 打錯字也找得到（fuzzy）、搜尋建議、自動完成
- 分面統計（每個分類各有幾筆）、大量命中時的高效排序
- 資料量或查詢量大到不該壓在主資料庫上，例如日誌搜尋

代價是多一套要部署、監控、備份的系統，以及資料同步的延遲與不一致。以商品搜尋為例的完整取捨，在設計情境 [商品搜尋與篩選](#/scenario/search-filter) 裡用模擬器比較。

## 常見錯誤與錯誤訊息

| 現象或錯誤 | 原因 | 怎麼修 |
|---|---|---|
| `syntax error in tsquery: "connection pool"` | 把使用者輸入直接交給 `to_tsquery` | 改用 `websearch_to_tsquery` 或 `plainto_tsquery` |
| 搜 `postgres` 找不到寫 `PostgreSQL` 的文章 | `english` 把 `postgres` 還原成 `postgr`，`postgresql` 卻保持 `postgresql`，兩者是不同詞位 | 專有名詞用同義詞字典處理，或同時查兩種寫法（`postgres or postgresql`） |
| 有建 GIN 索引，計畫卻是 Seq Scan | 查詢的表達式與索引不一致（少了設定名稱、欄位串接順序不同）；或資料太少，規劃器判斷掃全表比較快 | 對照 `\d articles` 的索引定義逐字比；資料量夠大時再判斷 |
| 中文整句搜不到其中的詞 | 內建 parser 不會切中文 | 應用層斷詞、中文擴充或搜尋引擎 |
| 搜 `rebuilding` 找不到 `rebuilt` | 規則式 stemmer 不處理不規則變化 | 接受這個限制，或加同義詞字典 |
| 搜尋變慢，ts_rank 佔大部分時間 | 命中幾萬筆，每筆都要算分數才能排序 | 先用其他條件縮小範圍，或限制排序候選數；量真的大時考慮搜尋引擎 |
| 改了 `default_text_search_config` 之後結果變了 | 沒寫設定名稱的 `to_tsvector(text)` 依這個參數決定斷詞方式 | 所有呼叫都明寫設定名稱 |

`to_tsvector` 沒寫設定名稱時，用的是 `default_text_search_config`，它可以在不同資料庫、不同連線設成不同值。明寫設定名稱可以避免同一份程式在不同環境斷出不同的詞。

## 動手

1. 執行第一段，把 `english` 換成 `simple`、`french` 等其他設定，看同一句話斷出來的詞位差在哪裡。
2. 在產生欄位那段的第 2 個查詢，把 `bloat` 換成 `index`、`pool`、`log`，觀察哪些文章命中、排名順序，以及 `log` 為什麼什麼都找不到。
3. 在 Playground 試 `SELECT to_tsquery('english', 'connection pool');` 看錯誤訊息，再換成 `websearch_to_tsquery`。
4. 把中文那段的 `'全文 檢索 很 好用'` 改成你自己斷好的句子，用 `@@` 試著查其中一個詞。
5. 程式題「用全文檢索取代 ILIKE」：把一個子字串搜尋改寫成 tsquery 並依相關度排序。

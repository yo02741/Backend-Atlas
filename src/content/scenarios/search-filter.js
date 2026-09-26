// 設計情境：商品搜尋與篩選
export default {
  id: 'search-filter',
  order: 7,
  group: 'api',
  title: '商品搜尋與篩選',
  en: 'Search & filtering',
  level: 2,
  skills: ['indexes', 'sql-advanced', 'db-choice'],
  week: 8,
  lab: 'SearchFilterScenarioLab',
  summary: '10 萬件商品、中文多詞關鍵字、加篩選排序分頁、資料每分鐘更新。LIKE、PostgreSQL 全文檢索，還是外掛搜尋引擎？',
  situation: '電商前台的搜尋框：10 萬件商品，使用者輸入中文關鍵字（常是多詞，如「藍牙 鍵盤」），可加分類、價格區間、只看有貨，排序有相關度、價格、上架時間，每頁 24 件。商品名稱、價格與庫存每分鐘由 ERP 同步更新。',
  constraints: [
    '搜尋回應 p95 在 200 ms 內，前台每秒數十次搜尋',
    '中文沒有空格分詞：「藍牙鍵盤」與「鍵盤 藍牙」要找到同一批商品',
    '篩選與排序要能和關鍵字一起用，結果要能分頁',
    '商品每分鐘更新，改了名字或缺貨要在可接受的延遲內反映到搜尋結果',
    '團隊兩個後端，維運能力有限',
  ],
  options: [
    {
      id: 'like', name: 'ILIKE 子字串',
      summary: "每個詞一個條件：`WHERE name ILIKE '%藍牙%' AND name ILIKE '%鍵盤%'`，篩選與排序直接加在同一句 SQL。",
      pros: ['零基礎設施、零同步，資料一改立刻搜得到', '子字串比對對中文天生有效，不需要斷詞', '篩選、排序、分頁全在 SQL 裡'],
      cons: ['前置的 `%` 讓 B-tree 索引失效：全表掃描，成本隨資料量線性成長', '沒有相關度：「藍牙機械鍵盤」和「鍵盤藍牙接收器」地位相同，只能依價格或時間排', '錯字、同義詞、拼音都找不到；`pg_trgm` GIN 索引能救效能，救不了排名'],
    },
    {
      id: 'fts', name: 'PostgreSQL 全文檢索',
      summary: '名稱與描述斷詞後存成 `tsvector` 欄位、建 GIN 索引；查詢用 `tsquery`，`ts_rank` 排相關度。',
      pros: ['不用多一套系統，交易內更新，沒有同步延遲', 'GIN 索引讓查詢成本幾乎不隨總量成長', '有相關度排名，欄位可加權（名稱 A、描述 B）'],
      cons: ['內建 parser 不會為中文斷詞：要裝 zhparser / pg_jieba，或由應用層先斷詞再寫入', '不處理錯字與拼音，同義詞要自己維護字典', '排名要對所有命中列算完再排序，命中很多（搜「鍵盤」）時仍不便宜'],
    },
    {
      id: 'engine', name: '外部搜尋引擎',
      summary: 'Elasticsearch / OpenSearch / Meilisearch：商品資料同步進引擎，搜尋、篩選、分面統計、錯字容忍與拼音全由引擎處理。',
      pros: ['中文斷詞、錯字容忍（fuzzy）、同義詞、拼音、分面（每個分類幾件）都是內建功能', '相關度模型（BM25）與業務加權（銷量、有貨）可調', '搜尋負載完全離開主資料庫'],
      cons: ['多一套系統：部署、監控、備份、版本升級', '資料要同步（outbox / CDC / 排程）：改了名字到搜得到有秒級到分鐘級延遲，且可能不一致', '兩份資料、兩套查詢語法，篩選條件要在引擎裡重做一次'],
    },
  ],
  tradeoffs: {
    axes: ['10 萬件的延遲', '相關度排名', '中文斷詞', '錯字 / 同義詞', '資料新鮮度', '維運'],
    rows: [
      { option: 'like', cells: ['差：全表掃描，示意 40–80 ms；100 萬件秒級', '無', '子字串天然可用', '無', '即時', '無'] },
      { option: 'fts', cells: ['好：走 GIN，示意 5–15 ms', '有：ts_rank 可加權', '需擴充或應用層斷詞', '弱：靠自建字典', '即時（同一交易）', '低：PostgreSQL 內建'] },
      { option: 'engine', cells: ['好：示意數毫秒', '好：BM25 + 自訂加權', '內建', '內建', '差：同步延遲秒到分', '高：多一套叢集'] },
    ],
  },
  decisions: [
    { id: 'order-id', situation: '後台客服依訂單編號（如 ORD-2026-000123）精確查單，或輸入前幾碼找。', options: ['like', 'fts', 'engine'], answer: 'like',
      explain: "精確比對用 `=`、前綴用 `LIKE 'ORD-2026-%'`（沒有前置 `%`）都走 B-tree 索引，毫秒級。沒有斷詞、沒有排名的需求，FTS 或引擎純屬多餘。" },
    { id: 'storefront', situation: '電商前台的 10 萬件商品關鍵字搜尋，要有相關度排名，商品每分鐘更新，團隊兩個後端。', options: ['like', 'fts', 'engine'], answer: 'fts',
      explain: '10 萬件在 GIN 索引下綽綽有餘，又沒有同步延遲與第二套系統。中文斷詞用應用層（jieba）寫入或 pg_jieba 擴充。等到需要錯字容忍、分面、拼音，再評估引擎。' },
    { id: 'fuzzy', situation: '搜尋要「打錯字也找得到」（藍芽 → 藍牙）、支援拼音（lanya），還要顯示每個分類各有幾件的分面數字。', options: ['like', 'fts', 'engine'], answer: 'engine',
      explain: '這三項在 PostgreSQL 都要自己拼湊（pg_trgm、拼音欄位、多一句 GROUP BY），在搜尋引擎是設定選項。代價是同步管線與一套新系統，需求到這個程度才值得。' },
    { id: 'logs', situation: '要在數十億行的應用日誌裡依關鍵字與時間範圍搜尋，資料只增不改，保留 30 天。', options: ['like', 'fts', 'engine'], answer: 'engine',
      explain: '日誌量遠超主資料庫該承受的範圍，且是唯讀、依時間切片的資料，正是 Elasticsearch / OpenSearch / Loki 這類系統的設計目標。不要把日誌塞進交易資料庫。' },
  ],
  implementation: [
    { title: 'ILIKE 與它的索引限制', lang: 'sql', code: `-- 兩個詞都要出現：條件前後都有 %，B-tree 索引用不上 → Seq Scan
SELECT id, name, price
FROM products
WHERE (name || ' ' || description) ILIKE '%藍牙%'
  AND (name || ' ' || description) ILIKE '%鍵盤%'
  AND category = 'keyboard' AND in_stock
ORDER BY created_at DESC
LIMIT 24;

-- 補救：pg_trgm 的 GIN 索引讓 %子字串% 能走索引（中文按字元切三連字）
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_products_name_trgm ON products USING gin (name gin_trgm_ops);
-- 仍然沒有相關度排名；描述欄位要另建一個索引` },
    { title: 'tsvector 欄位與 GIN 索引（中文要先斷詞）', lang: 'sql', code: `-- 內建 parser 不會斷中文：to_tsvector('simple', '藍牙機械鍵盤') 只有一個詞位 '藍牙機械鍵盤'
-- 做法一：應用層先斷詞（jieba），用空格接起來再存
ALTER TABLE products ADD COLUMN search tsvector;

UPDATE products SET search =
     setweight(to_tsvector('simple', $1), 'A')    -- $1 = '藍牙 機械 鍵盤 k1'（名稱斷詞）
  || setweight(to_tsvector('simple', $2), 'B')    -- $2 = '75% 配列 三模 連接'（描述斷詞）
WHERE id = $3;

CREATE INDEX idx_products_search ON products USING gin (search);

-- 做法二：裝 zhparser / pg_jieba 擴充，建好 'chinese' 設定後可用 GENERATED 欄位自動維護
-- search tsvector GENERATED ALWAYS AS (to_tsvector('chinese', name || ' ' || description)) STORED` },
    { title: '查詢、ts_rank 排名、篩選與分頁', lang: 'sql', code: `-- 查詞也要經過同一個斷詞器：'藍牙 鍵盤' → '藍牙 & 鍵盤'
SELECT id, name, price,
       ts_rank(search, query) AS rank
FROM products,
     to_tsquery('simple', '藍牙 & 鍵盤') AS query
WHERE search @@ query
  AND category = 'keyboard' AND in_stock
  AND price BETWEEN 500 AND 3000
ORDER BY rank DESC, created_at DESC
LIMIT 24 OFFSET 0;

-- @@ 走 GIN；ts_rank 對每個命中列算完才能排序，命中數萬列時是主要成本
-- 搜尋結果通常只翻前幾頁，這裡用 OFFSET 可以接受` },
  ],
  exercise: null,
  refs: [],
}

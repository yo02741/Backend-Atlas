// 設計情境：列表 API 的分頁
export default {
  id: 'pagination',
  order: 1,
  group: 'api',
  title: '列表 API 的分頁',
  en: 'Pagination',
  level: 1,
  skills: ['api-patterns', 'indexes', 'rest-design'],
  week: 10,
  lab: 'PaginationScenarioLab',
  summary: '評論列表 300 萬筆、無限捲動、資料一直在長。OFFSET 還是 cursor？',
  situation: '商品評論列表：300 萬筆、依時間新到舊、前端無限捲動一次載 20 筆。評論每分鐘新增數百則，也會被刪除。後台另有一個管理表格要能直接跳到任意頁。',
  constraints: [
    '使用者往下捲的時候，不能看到重複的評論，也不能漏掉',
    '捲到第 500 頁的回應時間要和第 1 頁差不多',
    '排序鍵是 created_at，同一秒可能有多筆',
    '後台管理表格需要「第 N 頁」與總筆數',
  ],
  options: [
    {
      id: 'offset', name: 'OFFSET / LIMIT',
      summary: '`?page=3&size=20` → `OFFSET 40 LIMIT 20`。最直覺，任何 ORM 都內建。',
      pros: ['可以跳到任意頁、顯示總頁數', '實作零成本，前端分頁元件直接對接'],
      cons: ['資料庫仍要掃過前面所有列，頁數越深越慢', '翻頁期間有新增或刪除，會出現重複或漏掉的列'],
    },
    {
      id: 'cursor', name: 'Cursor（keyset）',
      summary: '回應帶 `next_cursor`（最後一筆的排序鍵編碼），下一頁查 `WHERE (created_at, id) < ($1, $2)`。',
      pros: ['每頁都走索引，第 500 頁和第 1 頁一樣快', '新增或刪除不影響已經翻過的邊界，不重複不漏'],
      cons: ['不能跳頁、不能直接算「第幾頁」', '排序鍵必須唯一（或加 id 當 tie-breaker），換排序方式 cursor 就失效'],
    },
    {
      id: 'hybrid', name: '兩者並用',
      summary: '公開列表用 cursor；後台管理表格用 OFFSET，並限制最大頁數或用估計的總數。',
      pros: ['各取所長：面向使用者的列表穩定又快，後台保留跳頁'],
      cons: ['兩套分頁邏輯要各自維護與測試', '後台深頁仍慢，要靠限制頁數或篩選條件把資料縮小'],
    },
  ],
  tradeoffs: {
    axes: ['深頁效能', '翻頁一致性', '可跳頁 / 總數', '實作複雜度'],
    rows: [
      { option: 'offset', cells: ['差：掃過前面所有列', '差：插入或刪除會重複、漏列', '有', '最低'] },
      { option: 'cursor', cells: ['好：走索引', '好：邊界固定', '無', '中：cursor 編碼、tie-breaker、複合索引'] },
      { option: 'hybrid', cells: ['依端點而定', '依端點而定', '後台有', '最高：兩套'] },
    ],
  },
  decisions: [
    { id: 'admin', situation: '後台管理表格，只有內部人員用，資料幾萬筆，要能輸入頁碼直接跳到第 37 頁並顯示總筆數。', options: ['offset', 'cursor', 'hybrid'], answer: 'offset',
      explain: '需求就是跳頁與總數，資料量小、使用者少，OFFSET 的兩個缺點都不成問題。硬用 cursor 反而做不出「第 37 頁」。' },
    { id: 'feed', situation: '面向所有使用者的評論無限捲動，300 萬筆且持續新增，使用者常常捲很深。', options: ['offset', 'cursor', 'hybrid'], answer: 'cursor',
      explain: '深頁效能與翻頁一致性都是硬需求，而無限捲動根本不需要跳頁。cursor 用 (created_at, id) 當排序鍵並建對應的複合索引。' },
    { id: 'export', situation: '排程要把全部 300 萬筆評論匯出成 CSV，一批一批讀。', options: ['offset', 'cursor', 'hybrid'], answer: 'cursor',
      explain: '全量走訪用 OFFSET 是 O(n²)：越後面的批次掃越多。keyset 逐批以最後一筆的鍵接續，總成本 O(n)，也不怕中途有人新增資料。' },
    { id: 'chat', situation: '聊天室往上滑載入更舊的訊息，訊息量大且不斷有新訊息進來。', options: ['offset', 'cursor', 'hybrid'], answer: 'cursor',
      explain: '和無限捲動同一類問題，只是方向反過來：以目前最舊一筆的 (created_at, id) 當 cursor 查更早的。新訊息進來不會讓舊訊息的邊界移動。' },
  ],
  implementation: [
    { title: 'keyset 查詢（PostgreSQL）', lang: 'sql', code: `-- 第一頁
SELECT id, created_at, body
FROM comments
WHERE product_id = $1
ORDER BY created_at DESC, id DESC
LIMIT 20;

-- 下一頁：cursor 解碼成 (created_at, id)
SELECT id, created_at, body
FROM comments
WHERE product_id = $1
  AND (created_at, id) < ($2, $3)
ORDER BY created_at DESC, id DESC
LIMIT 20;

-- 讓上面兩句都走索引
CREATE INDEX idx_comments_product_created_id
  ON comments (product_id, created_at DESC, id DESC);` },
    { title: '回應格式與 cursor 編碼', lang: 'python', code: `import base64, json

def encode_cursor(row) -> str:
    raw = json.dumps({"t": row["created_at"].isoformat(), "id": row["id"]})
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")

def decode_cursor(cursor: str) -> tuple[str, int]:
    pad = "=" * (-len(cursor) % 4)
    obj = json.loads(base64.urlsafe_b64decode(cursor + pad))
    return obj["t"], obj["id"]

# 回應：多查一筆判斷有沒有下一頁
rows = fetch(limit + 1)
has_more = len(rows) > limit
items = rows[:limit]
return {"items": items, "next_cursor": encode_cursor(items[-1]) if has_more else None}` },
  ],
  exercise: 'api-patterns-1',
  refs: [],
}

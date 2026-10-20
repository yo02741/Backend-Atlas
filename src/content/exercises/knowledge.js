// 程式題：知識系統（Python 在瀏覽器裡執行；SQL 在瀏覽器裡的 PostgreSQL 執行，資料表由 setup 建立）

// 一份小 wiki 的連結圖：pages 是頁面、links 的每一列是一條有向邊（src 頁裡寫了 [[dst]]）
const WIKI_GRAPH = `
CREATE TABLE pages (name TEXT PRIMARY KEY);
CREATE TABLE links (src TEXT NOT NULL REFERENCES pages(name), dst TEXT NOT NULL REFERENCES pages(name), PRIMARY KEY (src, dst));
INSERT INTO pages VALUES ('RAG'), ('切段'), ('Embedding'), ('向量索引'), ('重新排序'), ('評估'), ('LLM Wiki'), ('規範文件'), ('GraphRAG');
INSERT INTO links VALUES
  ('RAG', '切段'), ('RAG', 'Embedding'), ('RAG', '評估'),
  ('Embedding', '向量索引'), ('向量索引', '重新排序'), ('評估', '重新排序'),
  ('重新排序', 'RAG'),
  ('切段', 'LLM Wiki'), ('LLM Wiki', '規範文件'), ('規範文件', 'LLM Wiki'),
  ('GraphRAG', 'RAG');
`

export default [
  {
    id: 'knowledge-graph-1', skill: 'knowledge-graph', kind: 'python', level: 2,
    title: '從 [[連結]] 建反向連結、找孤兒頁與斷鏈',
    prompt: '`pages` 是 `{頁名: markdown 內文}`。實作 `analyze(pages) -> dict`，回傳：\n\n- `backlinks`：`{頁名: [連到它的頁名…]}`，**每個存在的頁都要有 key**（沒人連就是空 list）；清單去重、依字串排序；自己連自己不算\n- `orphans`：沒有任何其他頁連進來的頁名，排序\n- `broken`：`(來源頁, 目標頁名)` 的 list，目標不存在於 `pages`；去重、排序\n\n連結語法：`[[頁面]]` 與 `[[頁面|顯示文字]]`（只有 `|` 前面是頁名），頁名前後的空白要去掉。',
    starter: `import re


def analyze(pages: dict[str, str]) -> dict:
    backlinks = {name: [] for name in pages}
    broken = []
    for src, body in pages.items():
        # TODO: [[頁面|顯示文字]] 要只取頁名；去重、排序、自己連自己不算
        for dst in re.findall(r"\\[\\[(.+?)\\]\\]", body):
            if dst in pages:
                backlinks[dst].append(src)
            else:
                broken.append((src, dst))
    orphans = [p for p in pages if not backlinks[p]]
    return {"backlinks": backlinks, "orphans": orphans, "broken": broken}


print(analyze({
    "RAG": "見 [[切段]] 與 [[Embedding|向量化]]。",
    "切段": "回到 [[RAG]]。",
    "Embedding": "",
}))
`,
    solution: `import re

# [[目標]] 或 [[目標|顯示文字]]：第一個群組只抓到 | 或 ] 之前
LINK = re.compile(r"\\[\\[([^\\]|]+)(?:\\|[^\\]]*)?\\]\\]")


def analyze(pages: dict[str, str]) -> dict:
    back = {name: set() for name in pages}
    broken = set()
    for src, body in pages.items():
        for raw in LINK.findall(body):
            dst = raw.strip()
            if not dst or dst == src:
                continue
            if dst in pages:
                back[dst].add(src)
            else:
                broken.add((src, dst))
    backlinks = {name: sorted(srcs) for name, srcs in back.items()}
    orphans = sorted(name for name, srcs in back.items() if not srcs)
    return {"backlinks": backlinks, "orphans": orphans, "broken": sorted(broken)}


print(analyze({
    "RAG": "見 [[切段]] 與 [[Embedding|向量化]]。",
    "切段": "回到 [[RAG]]。",
    "Embedding": "",
}))
`,
    tests: [
      { name: '反向連結：去重、排序、每頁都有 key', code: `_r = analyze({"A": "[[C]] 和 [[C]]", "B": "[[C]]", "C": "", "D": ""})\nassert _r["backlinks"] == {"A": [], "B": [], "C": ["A", "B"], "D": []}, _r["backlinks"]` },
      { name: '[[頁面|顯示文字]] 只算頁名、去掉空白', code: `_r = analyze({"RAG": "見 [[ 切段 ]] 與 [[Embedding|向量化]]", "切段": "", "Embedding": ""})\nassert _r["backlinks"]["切段"] == ["RAG"], _r["backlinks"]\nassert _r["backlinks"]["Embedding"] == ["RAG"], _r["backlinks"]\nassert _r["broken"] == [], f"顯示文字被當成頁名了：{_r['broken']}"` },
      { name: '孤兒頁：自己連自己不算', code: `_r = analyze({"A": "[[A]] [[B]]", "B": "[[B]]", "C": "[[A]]"})\nassert _r["orphans"] == ["C"], _r["orphans"]\nassert _r["backlinks"]["A"] == ["C"], _r["backlinks"]\nassert _r["backlinks"]["B"] == ["A"], _r["backlinks"]` },
      { name: '斷鏈：目標不存在，去重、排序', code: `_r = analyze({"B": "[[Z]] [[Y|y]] [[Z]]", "A": "[[Z]]"})\nassert _r["broken"] == [("A", "Z"), ("B", "Y"), ("B", "Z")], _r["broken"]` },
    ],
    hints: ['正則 `\\[\\[([^\\]|]+)(?:\\|[^\\]]*)?\\]\\]`：第一個群組只吃到 `|` 或 `]` 之前，後面的 `|顯示文字` 是選配。', '先用 set 收集（自動去重），最後再 sorted 轉成 list。'],
  },
  {
    id: 'knowledge-graph-2', skill: 'knowledge-graph', kind: 'sql', level: 2,
    title: '從一頁出發能走到哪些頁、最少幾步',
    prompt: '`pages(name)` 是 wiki 的頁面，`links(src, dst)` 的每一列代表 `src` 頁裡有一個 `[[dst]]`。圖裡**有環**（例如 `RAG → 評估 → 重新排序 → RAG`）。\n\n用 `WITH RECURSIVE` 找出從 `RAG` 出發、沿著連結方向能到達的所有頁（不含 `RAG` 本身），以及**最少**要走幾步。欄位名稱 `page`、`steps`。\n\n- 用 path 陣列記錄走過的頁，`NOT (l.dst = ANY(w.path))` 防止繞圈\n- 同一頁可能有好幾條路徑，取最小步數',
    setup: WIKI_GRAPH, setupKey: 'wiki-graph',
    starter: `-- TODO：現在只找到一步能到的頁，改成遞迴往外走
SELECT dst AS page, 1 AS steps
FROM links
WHERE src = 'RAG';`,
    solution: `WITH RECURSIVE walk(page, path, steps) AS (
  SELECT 'RAG'::text, ARRAY['RAG']::text[], 0
  UNION ALL
  SELECT l.dst, w.path || l.dst, w.steps + 1
  FROM walk w
  JOIN links l ON l.src = w.page
  WHERE NOT (l.dst = ANY(w.path))
)
SELECT page, MIN(steps) AS steps
FROM walk
WHERE page <> 'RAG'
GROUP BY page;`,
    expect: { columns: ['page', 'steps'], rows: [['切段', '1'], ['Embedding', '1'], ['評估', '1'], ['向量索引', '2'], ['重新排序', '2'], ['LLM Wiki', '2'], ['規範文件', '3']], ordered: false },
    hints: ['起點那一列：`SELECT \'RAG\'::text, ARRAY[\'RAG\']::text[], 0`；遞迴那一列 `JOIN links l ON l.src = w.page`，路徑用 `w.path || l.dst` 接上。', '重新排序有兩條路：RAG → 評估 → 重新排序（2 步），以及經過 Embedding、向量索引的 3 步；最後 `GROUP BY page` 取 `MIN(steps)`。GraphRAG 只有連出去、沒有被 RAG 這一側連到，所以走不到它。'],
  },
  {
    id: 'rag-basics-1', skill: 'rag-basics', kind: 'python', level: 2,
    title: '固定大小＋重疊的切段',
    prompt: '實作 `chunk(text, size, overlap) -> list[str]`：每段最多 `size` 個字元，相鄰兩段重疊 `overlap` 個字元（下一段的起點 = 上一段起點 + `size - overlap`）。\n\n- `size <= 0`、`overlap < 0`、`overlap >= size` 都要 `raise ValueError`（`overlap >= size` 時起點不會前進或往回走）\n- 空字串回傳 `[]`\n- 某一段已經涵蓋到文字結尾就停，最後一段可以不足 `size`；不要多產生一段完全被前一段包含的尾巴',
    starter: `def chunk(text: str, size: int, overlap: int) -> list[str]:
    # TODO：參數檢查；最後一段涵蓋到結尾就停
    return [text[i:i + size] for i in range(0, len(text), size - overlap)]


print(chunk("abcdefghij", 4, 1))   # 預期 ['abcd', 'defg', 'ghij']
`,
    solution: `def chunk(text: str, size: int, overlap: int) -> list[str]:
    if size <= 0:
        raise ValueError("size must be positive")
    if overlap < 0 or overlap >= size:
        raise ValueError("overlap must be in [0, size)")
    if not text:
        return []
    step = size - overlap
    out, start = [], 0
    while True:
        out.append(text[start:start + size])
        if start + size >= len(text):   # 這一段已經涵蓋到結尾
            return out
        start += step


print(chunk("abcdefghij", 4, 1))
`,
    tests: [
      { name: '有重疊：涵蓋到結尾就停', code: `_r = chunk("abcdefghij", 4, 1)\nassert _r == ["abcd", "defg", "ghij"], _r` },
      { name: '最後一段不足 size', code: `assert chunk("abcdefghij", 4, 0) == ["abcd", "efgh", "ij"]\n_r = chunk("abcdefghijk", 4, 1)\nassert _r == ["abcd", "defg", "ghij", "jk"], _r` },
      { name: '短文字與空字串', code: `assert chunk("abc", 5, 2) == ["abc"]\nassert chunk("", 4, 1) == []` },
      { name: '不合法的參數要 raise ValueError', code: `for _args in [(4, 4), (4, 6), (4, -1), (0, 0)]:\n    try:\n        chunk("abcdefghij", *_args)\n        raise AssertionError(f"size, overlap = {_args} 沒有 raise ValueError")\n    except ValueError:\n        pass` },
    ],
    hints: ['先檢查參數，再處理空字串。', '用 while 迴圈：加進一段之後，如果 start + size >= len(text) 就結束，否則 start += size - overlap。'],
  },
]

## 從一個具體問題開始：兩個概念之間隔了幾頁？

一份 wiki 寫了半年，有兩百多頁。有人問：「『切段』跟『間接提示注入』有什麼關係？」兩頁都沒有直接提到對方，全文搜尋也找不到同時出現兩個詞的頁面。

但頁面之間其實連得起來：「切段」連到「LLM Wiki」，「LLM Wiki」連到「規範文件」，「規範文件」連到「來源分級」，「來源分級」又連到「間接提示注入」。這條路徑本身就是答案的骨架：切段是 RAG 的一步，LLM Wiki 是另一種做法，它的規範文件規定了來源分級，而來源分級是防注入的對策。

同一份 wiki 還有另外兩個問題沒人發現：有幾頁從來沒有被任何頁連到（寫了也沒人會讀到），有幾個 `[[連結]]` 指向還沒寫的頁。

這三件事都不需要讀內容，只要把連結當成一張**圖**來看就能回答。

## 運作原理：每個 [[連結]] 是一條有向邊

wiki 頁面是**節點**；A 頁裡寫了 `[[B]]`，就是一條 **A → B 的有向邊**。

```text
     ┌──────────┐      ┌───────────┐      ┌────────────┐
     │   RAG    │─────▶│ Embedding │─────▶│  向量索引   │
     └──────────┘      └───────────┘      └────────────┘
       │   ▲                                    │
       │   └────────────────────────────────────┘   （環：向量索引 → RAG）
       ▼
     ┌──────────┐      ┌───────────┐      ┌────────────┐      ┌──────────────┐
     │   切段    │─────▶│ LLM Wiki  │─────▶│  規範文件   │─────▶│   來源分級    │──▶ 間接提示注入
     └──────────┘      └───────────┘      └────────────┘      └──────────────┘
                             │
                             ▼
                        知識圖譜（還沒寫：斷鏈）

     GraphRAG ──▶ RAG    （沒有任何頁連到 GraphRAG：孤兒頁）
```

（圖上省略了 LLM Wiki → RAG 這條邊，下面的 SQL 範例裡有它。）

從這張圖可以直接讀出幾種資訊：

| 名詞 | 定義 | 在圖上 | 用途 |
|---|---|---|---|
| 正向連結（outlinks） | 這一頁連出去的頁 | 從節點出去的邊 | 讀這一頁時「延伸閱讀」 |
| **反向連結**（backlinks） | 哪些頁連到這一頁 | 指進這個節點的邊 | 一個概念被誰引用、在哪些脈絡出現 |
| 孤兒頁（orphan） | 沒有任何其他頁連進來 | 入度為 0 的節點 | 沒人讀得到；該補連結、合併或刪除 |
| 斷鏈（broken link） | 連到不存在的頁 | 指向不存在節點的邊 | 該寫的頁還沒寫，或頁名打錯 |
| 路徑（path） | 從 A 沿著邊走到 B 經過的頁 | 一串邊 | 兩個概念之間的關係 |
| 環（cycle） | 走一圈回到原點 | 一串回到起點的邊 | 很正常（互相引用），但找路徑時要防止繞圈 |

反向連結不用另外寫，只要把所有頁的正向連結反過來存一次就有。Obsidian 的反向連結面板與關聯圖就是在做這件事。

### 連結語法

Obsidian 的內部連結（說明見 [Obsidian 文件](https://help.obsidian.md/)）常見三種寫法：

- `[[切段]]`：連到「切段」這一頁
- `[[切段|固定大小切段]]`：連到「切段」，畫面上顯示「固定大小切段」
- `[[切段#重疊]]`：連到「切段」這一頁裡的「重疊」標題

解析時要注意：`|` 後面是顯示文字、`#` 後面是頁內標題，都不是頁名。把它們當成頁名，就會多出一堆假的斷鏈。

## 實際程式（一）：解析 [[連結]]、建反向連結

純 Python 標準函式庫，解析幾頁虛構的 wiki，找出反向連結、孤兒頁與斷鏈：

```python run
import re
from collections import defaultdict

# 虛構的 wiki：key 是頁名（檔名去掉 .md），value 是內文
PAGES = {
    "RAG": "檢索增強生成。流程見 [[切段]] 與 [[Embedding]]。和 [[LLM Wiki]] 的比較見 [[知識系統怎麼選]]。",
    "Embedding": "把文字變成向量，存進 [[向量索引]]。用於 [[RAG]]。",
    "切段": "固定大小加重疊。切太小會失去上下文，見 [[RAG|檢索的限制]]。",
    "向量索引": "近似最近鄰搜尋。",
    "LLM Wiki": "由 LLM 維護的 markdown 知識庫，結構規則寫在 [[規範文件]]。",
    "GraphRAG": "從文件自動抽取實體與關係建圖。",
}

# [[目標]]、[[目標|顯示文字]]、[[目標#標題]]：只取 | 與 # 之前的部分當頁名
LINK = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]")

def outlinks(text):
    return {m.strip() for m in LINK.findall(text)}

forward = {name: outlinks(body) for name, body in PAGES.items()}

backlinks = defaultdict(set)              # 反過來存：dst → 哪些頁連到它
for src, dsts in forward.items():
    for dst in dsts:
        if dst != src:                    # 自己連自己不算
            backlinks[dst].add(src)

orphans = sorted(p for p in PAGES if not backlinks.get(p))
broken = sorted((src, dst) for src, dsts in forward.items() for dst in dsts if dst not in PAGES)

for page in PAGES:
    print(f"{page} ← {sorted(backlinks.get(page, []))}")
print("孤兒頁：", orphans)
print("斷鏈：", broken)
```

輸出裡：`切段` 頁的 `[[RAG|檢索的限制]]` 被正確算成連到 RAG；`GraphRAG` 是孤兒頁；`規範文件` 與 `知識系統怎麼選` 是斷鏈。

## 實際程式（二）：把圖存進 PostgreSQL，用遞迴 CTE 找路徑

頁面多了、或要跟其他資料一起查時，把圖存成兩張表很方便：`pages(name)` 存節點，`links(src, dst)` 存邊。找「從 A 走到 B 的最短路徑」用 `WITH RECURSIVE`：

- **起點那一列**（anchor）：起始頁、路徑陣列只有它自己、步數 0
- **遞迴那一列**：從目前走到的頁，沿著 `links` 往外走一步，路徑接上新的頁
- **防環**：`NOT (l.dst = ANY(w.path))`，已經在路徑上的頁不再走。沒有這行，遇到 `RAG → Embedding → 向量索引 → RAG` 這種環就會一直繞
- **步數上限**：再加一道保險，避免圖很大時路徑數量爆炸

```sql run
-- 每一頁一列；links 的每一列是一條有向邊：src 頁裡寫了 [[dst]]
CREATE TABLE pages (name TEXT PRIMARY KEY);
CREATE TABLE links (src TEXT NOT NULL, dst TEXT NOT NULL, PRIMARY KEY (src, dst));
-- dst 故意不加外鍵：連到不存在的頁就是「斷鏈」，要查得出來

INSERT INTO pages VALUES ('RAG'), ('Embedding'), ('向量索引'), ('切段'), ('LLM Wiki'),
  ('規範文件'), ('間接提示注入'), ('來源分級'), ('GraphRAG');
INSERT INTO links VALUES
  ('RAG', 'Embedding'), ('RAG', '切段'), ('Embedding', '向量索引'),
  ('向量索引', 'RAG'),                      -- 環：RAG → Embedding → 向量索引 → RAG
  ('LLM Wiki', 'RAG'), ('LLM Wiki', '規範文件'), ('規範文件', '來源分級'),
  ('來源分級', '間接提示注入'), ('切段', 'LLM Wiki'),
  ('GraphRAG', 'RAG'), ('LLM Wiki', '知識圖譜');  -- 「知識圖譜」這頁還沒寫：斷鏈

-- 從 RAG 出發，找到「間接提示注入」的最短路徑
WITH RECURSIVE walk(page, path, steps) AS (
  SELECT 'RAG'::text, ARRAY['RAG']::text[], 0          -- 起點
  UNION ALL
  SELECT l.dst, w.path || l.dst, w.steps + 1           -- 沿著一條邊往外走一步
  FROM walk w
  JOIN links l ON l.src = w.page
  WHERE NOT (l.dst = ANY(w.path))                      -- 已經在路徑上的頁不再走：防環
    AND w.steps < 6                                    -- 保險：最多走 6 步
)
SELECT array_to_string(path, ' → ') AS route, steps
FROM walk
WHERE page = '間接提示注入'
ORDER BY steps
LIMIT 1;

-- 反向連結：誰連到 RAG
SELECT src AS linked_from FROM links WHERE dst = 'RAG' ORDER BY src;

-- 孤兒頁：沒有任何其他頁連進來
SELECT p.name AS orphan FROM pages p
WHERE NOT EXISTS (SELECT 1 FROM links l WHERE l.dst = p.name AND l.src <> p.name)
ORDER BY p.name;

-- 斷鏈：連到的頁不存在
SELECT l.src, l.dst AS missing FROM links l
LEFT JOIN pages p ON p.name = l.dst
WHERE p.name IS NULL;
```

第一個查詢的結果是 `RAG → 切段 → LLM Wiki → 規範文件 → 來源分級 → 間接提示注入`，共 5 步。

遞迴 CTE 每一輪產生的中間狀態：

| 輪次（steps） | 新產生的列（page：path） |
|---|---|
| 0 | RAG：{RAG} |
| 1 | Embedding：{RAG, Embedding}；切段：{RAG, 切段} |
| 2 | 向量索引：{RAG, Embedding, 向量索引}；LLM Wiki：{RAG, 切段, LLM Wiki} |
| 3 | 規範文件、知識圖譜（從 LLM Wiki 出去）；向量索引 → RAG 這條邊被防環條件擋掉，LLM Wiki → RAG 也是 |
| 4 | 來源分級 |
| 5 | 間接提示注入 |

幾點說明：

- 這種寫法列舉的是**所有不繞圈的路徑**，不是只走一次的廣度優先搜尋。圖密的時候路徑數量會快速增加，所以步數上限很重要。資料量大時，改成在應用程式裡做 BFS（記住已拜訪的節點），或用專門的圖資料庫
- PostgreSQL 14 起，`WITH RECURSIVE` 可以加 `CYCLE` 子句自動偵測環，效果和自己維護 path 陣列類似；手寫 path 的好處是路徑本身就是想要的輸出
- `ORDER BY steps LIMIT 1` 回傳一條最短路徑；長度相同的路徑有好幾條時，回傳哪一條不保證固定

## GraphRAG：讓 LLM 自動建圖

上面的圖來自人與 LLM 寫的 `[[連結]]`。另一條路是從文件**自動抽取**一張圖：[Microsoft GraphRAG](https://github.com/microsoft/graphrag) 用 LLM 從文件中抽出實體與實體之間的關係建成圖，把圖分成一群一群關係緊密的社群（community），為每個社群寫摘要，回答問題時再從這些結構與摘要中檢索。它想解決的是一般 RAG 不擅長的「需要跨很多文件彙整」的問題。

| | LLM Wiki 的 wikilink 圖 | GraphRAG |
|---|---|---|
| 圖怎麼來 | 頁面裡的 `[[連結]]`，由 LLM 撰寫、人審核 | LLM 從原始文件自動抽取實體與關係 |
| 節點 | 一頁（概念、實體、摘要） | 抽出的實體 |
| 邊的意義 | 「這頁提到、參考了那頁」，沒有型別 | 抽出的關係（附描述） |
| 人的參與 | 規範文件定義結構，每次修改都可以審核 | 主要是設定與調整抽取流程；結果量大，難以逐條審核 |
| 適合 | 單一主題、需要高品質與可追溯 | 文件量大、想自動得到全貌 |
| 主要風險 | 維護成本；錯誤寫進 wiki 會長期存在 | 抽取錯誤（實體重複、關係錯）不容易發現；建圖要大量 LLM 呼叫 |

兩者不互斥：也可以用 GraphRAG 這類工具先產生候選的實體與關係，再整理成 wiki 頁、經過審核。GraphRAG 的實際參數、流程與成本請以官方文件為準，版本之間會變。

## 常見錯誤

| 症狀 | 原因 | 怎麼修 |
|---|---|---|
| 一大堆斷鏈，但頁面明明存在 | 把含顯示文字或頁內標題的連結（例如 `[[切段#重疊]]`）整串當成頁名 | 解析時只取頁名部分（顯示文字與 `#` 標題之前），並去掉前後空白 |
| 同一頁出現兩個名字（「切段」與「Chunking」） | 沒有統一頁名 | 規範文件規定頁名；別名寫在頁首 aliases，解析時把別名對應回正式頁名 |
| 遞迴查詢跑不完或記憶體爆掉 | 沒有防環，或圖太密、沒有步數上限 | 加 `NOT (dst = ANY(path))` 與步數上限；大圖改用 BFS |
| `ERROR: recursive query "walk" column 3 has type integer in non-recursive term but type numeric overall` | 起點那一列與遞迴那一列推出來的型別不同。例如邊有權重 `weight NUMERIC`，起點寫 `0`（integer）、遞迴寫 `w.cost + l.weight`（numeric） | 起點明確轉型成同一個型別：`0::numeric`；字串與陣列也習慣寫成 `'RAG'::text`、`ARRAY['RAG']::text[]` |
| 孤兒頁很多 | ingest 時新增了頁，但沒有更新索引頁或相關頁的連結 | 規範文件要求「新頁至少被一頁連到」；lint 定期找孤兒頁 |
| 自己連自己的頁被當成「有人連到」 | 反向連結沒排除 src = dst | 建反向連結時跳過自我連結 |

型別錯誤訊息裡的欄位編號（column 3）是 CTE 欄位清單裡的位置，從 1 開始數，照著找到是哪一欄就能修。

## 動手

1. 按 SQL 範例的「在 Playground 開啟」，刪掉 `WHERE NOT (l.dst = ANY(w.path))` 那一行（保留步數上限），看結果多了哪些繞圈的路徑。
2. 在 SQL 範例裡加一條 `('RAG', '規範文件')`，再跑一次最短路徑，看步數怎麼變。
3. 程式題 [反向連結、孤兒頁與斷鏈](#/exercise/knowledge-graph-1)：處理 `[[頁面|顯示文字]]`、去重、排除自我連結。
4. 程式題 [從一頁出發能走到哪些頁、最少幾步](#/exercise/knowledge-graph-2)：用遞迴 CTE 加上 `MIN(steps)`。
5. 回到 [LLM Wiki](#/skill/llm-wiki)，把孤兒頁與斷鏈檢查加進 lint 流程。

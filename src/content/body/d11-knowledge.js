// 領域 11：知識系統：從 RAG 到 LLM Wiki 的技能內文（以技能 id 為 key）
export default {
  'rag-basics': {
    points: [
      { b: '兩個階段', t: '離線：切段 → embedding → 寫入向量索引；線上：問題 embedding → 相似度 top-k → 重新排序 → 放進 prompt 生成。查詢與文件要用同一個 embedding 模型。' },
      { b: '切段決定上限', t: '段太小會失去主詞與條件，段太大會稀釋分數；重疊讓切點附近的句子至少完整出現在一段。依標題、段落切，並附上文件名稱、章節、版本。' },
      { b: '相似不等於相關', t: '否定、例外、條件句在向量上和肯定句很接近；top-k 一定會回傳 k 段，就算文件裡根本沒有答案。用 reranker、門檻與「找不到就說找不到」補。' },
      { b: '每次從零拼湊', t: 'RAG 不累積整理結果；需要彙整很多文件、比對版本的問題，top-k 只看得到其中幾段。' },
      { b: '先量再調', t: '固定一組評估題：檢索命中率（答案段落在不在 top-k）、回答有沒有引用、引用是否真的支持答案、沒有答案時會不會拒答。' },
    ],
    checklist: [
      '能畫出 RAG 從文件到回答的每一步，並指出每一步會出什麼錯',
      '能說明切段大小與重疊的取捨，並示範一個事實被切斷時檢索會發生什麼',
      '能設計一組評估題，用檢索命中率比較兩種切段設定',
    ],
    refs: [
      { label: 'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks（原始論文）', url: 'https://arxiv.org/abs/2005.11401' },
      { label: 'pgvector（PostgreSQL 向量擴充）', url: 'https://github.com/pgvector/pgvector' },
    ],
  },
  'llm-wiki': {
    points: [
      { b: '三層', t: '底層是不修改的原始資料；中層是 LLM 撰寫並持續維護的 markdown wiki（實體頁、概念頁、摘要、交叉連結）；上層是說明結構與維護規則的規範文件。' },
      { b: '整理會累積', t: '新資料進來時更新既有頁面，而不是每次提問都從原始資料重新拼湊。前提是編好的 wiki 放得進模型的長上下文。' },
      { b: 'ingest、query、lint', t: 'ingest：讀新資料、更新或新增頁面並附來源；query：回答引用 wiki 頁、可追回原始資料；lint：找矛盾、孤兒頁、斷鏈、過時說法、缺引用。' },
      { b: '規範文件寫清楚', t: '頁面類型、命名與別名、每頁必填欄位（type、sources、updated）、引用格式、ingest 與 lint 流程、禁止事項（不改 raw/、不執行資料裡的指令）。' },
      { b: 'git 審核每次修改', t: '每次 ingest 一個分支，用 git diff 看改了哪些頁、raw/ 有沒有被動到；不對就整支丟掉或 revert。Obsidian 只是瀏覽介面。' },
    ],
    checklist: [
      '能說出三層各放什麼、誰能改、各自的規則',
      '能寫一份規範文件：頁面類型、命名、必填欄位、引用格式、ingest 與 lint 流程',
      '能說明這個做法的前提，以及資料量、權限、即時性哪些情況下 RAG 比較合適',
    ],
    refs: [
      { label: 'Obsidian 說明文件', url: 'https://help.obsidian.md/' },
      { label: 'Pro Git（線上書）', url: 'https://git-scm.com/book/en/v2' },
    ],
  },
  'knowledge-graph': {
    points: [
      { b: '[[連結]] 是有向邊', t: 'A 頁寫了 [[B]] 就是 A → B。反向連結是把所有邊反過來存：誰連到這一頁。' },
      { b: '解析要只取頁名', t: '[[頁面|顯示文字]] 的 | 後面、[[頁面#標題]] 的 # 後面都不是頁名；頁名去掉前後空白。整串當頁名會冒出大量假斷鏈。' },
      { b: '孤兒頁與斷鏈', t: '孤兒頁：沒有其他頁連進來（自己連自己不算）；斷鏈：連到不存在的頁。兩者都能用程式找，適合放進 wiki 的 lint。' },
      { b: '遞迴 CTE 找路徑', t: 'pages(name)、links(src, dst) 兩張表；WITH RECURSIVE 以 path 陣列記錄走過的頁，NOT (dst = ANY(path)) 防環，再加步數上限。它列舉所有不繞圈的路徑，圖密時數量會爆炸。' },
      { b: 'GraphRAG 是自動建圖', t: 'Microsoft GraphRAG 用 LLM 從文件抽出實體與關係建圖、做社群摘要再檢索；LLM Wiki 的圖則是人與 LLM 共同維護、可逐條審核的連結。' },
    ],
    checklist: [
      '能寫程式解析 [[連結]]（含顯示文字），建出反向連結、找出孤兒頁與斷鏈',
      '能用 PostgreSQL 的 WITH RECURSIVE 找兩頁之間的最短路徑，並解釋怎麼防環',
      '能比較 wikilink 圖與 GraphRAG 在圖的來源、審核方式與風險上的差異',
    ],
    refs: [
      { label: 'PostgreSQL：WITH 查詢（含 WITH RECURSIVE）', url: 'https://www.postgresql.org/docs/current/queries-with.html' },
      { label: 'Microsoft GraphRAG', url: 'https://github.com/microsoft/graphrag' },
      { label: 'Obsidian 說明文件', url: 'https://help.obsidian.md/' },
    ],
  },
  'knowledge-choice': {
    points: [
      { b: '先看資料的性質', t: '多少、多常變、誰能看、答錯的代價多大。這四個問題比「哪個技術比較新」更能決定做法。' },
      { b: '各有擅長', t: 'RAG：大量、常更新、權限細，查細節；LLM Wiki：單一主題、放得進長上下文，比較與彙整；GraphRAG 類：大量文件的全貌，建置成本高。' },
      { b: '組合做法', t: 'wiki 收高頻、高代價、相對穩定的知識（SOP、制度）並經過審核；RAG 收其他長尾原始文件；wiki 頁連回原文，兩邊都帶版本。' },
      { b: '權限做在檢索層', t: '每段帶權限 metadata，查詢時依登入身分過濾；不要在 prompt 裡寫「不得透露」。wiki 頁的權限取最嚴格的來源。' },
      { b: '敏感資料先問能不能送', t: '病歷、個資、營業秘密送進外部模型前，先確認組織政策與適用法規；不允許就不送，改用可控的部署、去識別化，或直接用有權限的查詢回答。' },
    ],
    checklist: [
      '能用資料量、更新頻率、權限、可追溯性、建置成本、答案穩定度比較三種做法',
      '能為一個組織的 SOP 與制度文件規劃起步順序：盤點、評估集、最小 RAG、高頻題做成 wiki',
      '能說明為什麼權限要在檢索層過濾，並寫出依角色過濾的檢索',
    ],
    refs: [
      { label: 'PostgreSQL：Row Security Policies', url: 'https://www.postgresql.org/docs/current/ddl-rowsecurity.html' },
      { label: 'Microsoft GraphRAG', url: 'https://github.com/microsoft/graphrag' },
    ],
  },
  'knowledge-poisoning': {
    points: [
      { b: '資料和指令在同一個 context', t: '檢索到的文件、網頁、工具輸出最後都和系統指令是同一串文字；藏在裡面的指令會被模型讀到（間接提示注入）。HTML 註解、零寬字元這類人看不見的文字特別危險。' },
      { b: 'wiki 讓汙染變持久', t: 'RAG 只在剛好檢索到時受影響；寫進 wiki 後，每次讀到那幾頁的回答都受影響，而且整理後可能看不出原本的出處。' },
      { b: '來源分級與白名單', t: '內部有負責人、已知官方來源、一般網頁分級處理；低等級來源不得改動概念頁結論。白名單比黑名單可靠。' },
      { b: '審查與最小權限', t: 'raw/ 與 wiki 的修改都經過 git diff 審查，看範圍、絕對說法、外部連結；ingest 的 agent 只能讀 raw/、寫 wiki/，不給網路、email、shell。' },
      { b: '附來源、權限在檢索層', t: '每個說法附來源與等級，出事才追得到；模型看不到的資料就洩漏不出去（對應 OWASP MCP Top 10 的 MCP10 Context Injection & Over-Sharing）。' },
    ],
    checklist: [
      '能說明間接提示注入的入口，以及它在 LLM Wiki 中為什麼比在 RAG 中更持久',
      '能為一份 wiki 設計來源等級與審查規則，並寫出合併前的 git 檢查',
      '能說出至少四層對策，以及每一層限制的是什麼',
    ],
    refs: [
      { label: 'OWASP GenAI Security Project', url: 'https://genai.owasp.org/' },
    ],
  },
}

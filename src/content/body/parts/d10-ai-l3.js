// 領域內文（d10-ai，P9 新課）：以技能 id 為 key，由 body/d10-ai.js 合併。只放這些技能：agent-loop, agent-memory, agent-protocols, ai-threat-modeling
export default {
  'agent-loop': {
    map: {
      names: [
        { n: 'step（一輪）', t: '組 context、呼叫模型、解析回應、執行工具、把結果放回 context、判斷要不要停。' },
        { n: '工具結果', t: '每個工具呼叫的結果或錯誤都帶著呼叫 id 放回 context；只寫進 log 的話，模型會以為工具沒反應而重試。' },
        { n: '狀態機', t: '`thinking`、`tool_call`、`tool_result`、`done`、`failed`、`interrupted`；每個轉移都能單獨測，log 也照轉移一行一筆。' },
        { n: '步數與 token 預算', t: '步數上限擋鬼打牆，累計 token 預算擋 context 越滾越大；超過任一個就轉 `failed`。' },
        { n: '工具逾時與結果大小', t: '每個工具有逾時，逾時當成工具錯誤放回 context；結果太大就截斷，並註明總共有多少筆。' },
        { n: 'checkpoint', t: '每輪結束把 context 與預算剩餘量存進持久儲存，中斷後從 `thinking` 繼續。' },
        { n: '冪等的工具', t: '帶同一個呼叫 id 再執行一次，結果相同；送信、付款這類做不到冪等的，恢復時改成先問使用者。' },
      ],
      ask: [
        '有哪些工具，每個是唯讀還是寫入、逾時多久、結果大小上限多少。',
        '步數上限、累計 token 預算、連續錯誤上限，以及超過時給使用者什麼回應。',
        '工具失敗、工具名不存在、參數格式錯時，放回 context 的錯誤長什麼樣。',
        '中斷的來源（使用者取消、部署重啟）與檢查的時機：每次呼叫模型前、每個工具執行前。',
        'checkpoint 存在哪裡、用什麼 key，恢復時寫入類工具怎麼避免重做。',
      ],
      prompt: '寫一個查訂單的 agent 迴圈。工具有 `search_orders`、`get_order`（唯讀，逾時 2 秒）與 `issue_refund`（寫入，用呼叫 id 當冪等鍵）。步數上限 8、累計 token 預算 20,000，連續 3 次工具錯誤就轉 `failed`。所有工具錯誤都以 `{"id", "error"}` 放回 context，不往外丟例外。每次呼叫模型前與每個工具執行前檢查取消旗標，取消就轉 `interrupted`。每輪結束把 context 與預算存進資料庫，key 是對話 id。狀態轉移一行一筆寫進 log。',
      verify: [
        { c: '停得下來', t: '用一個永遠回工具呼叫的假模型跑，應該在步數或 token 上限轉 `failed`，不是跑到腳本用完或被供應商的 rate limit 擋下。' },
        { c: '錯誤有回到 context', t: '讓工具丟 `KeyError`、把工具名打錯、把參數給成字串，三種都要變成帶 id 的錯誤結果，迴圈不中斷。' },
        { c: '取消後不再動作', t: '在第一輪的工具執行時設取消旗標：之後模型不應該再被呼叫，寫入類工具的執行次數是 0。' },
        { c: '平行只限唯讀', t: '讀平行執行的那段程式：同一輪的寫入類工具要依序執行；AI 產生的程式常把所有呼叫一起丟進 `asyncio.gather`。' },
        { c: '恢復不重做', t: '在 `tool_call` 與 `tool_result` 之間重啟程序，恢復後同一個呼叫 id 的退款只執行一次。' },
      ],
    },
    points: [
      { b: '一輪做六件事', t: '組 context → 呼叫模型 → 解析（文字或工具呼叫）→ 執行工具 → 結果放回 context → 判斷停止。工具結果與錯誤一律回到 context，模型才看得到。' },
      { b: '狀態機寫清楚', t: '`thinking` / `tool_call` / `tool_result` / `done` / `failed` / `interrupted`。每個轉移都能單獨測，log 照轉移印，預算與中斷有固定的檢查點。' },
      { b: '步數與 token 都要有上限', t: '步數擋鬼打牆，累計 token 擋 context 越滾越大。超過就轉 `failed` 並保存 context，不要直接丟例外給使用者。' },
      { b: '工具錯誤是正常流程', t: '工具名錯、參數不是物件、工具丟例外、逾時，都變成帶 id 的錯誤結果放回 context；連續錯誤達上限才停。工具結果要限制大小。' },
      { b: 'checkpoint 讓中斷可恢復', t: '每輪結束把 context 存到持久儲存；恢復時從 `thinking` 繼續。停在工具執行後的情況要靠冪等工具處理，付款、寄信這類改成詢問使用者。平行執行只用在互不相依的唯讀工具。' },
    ],
    checklist: [
      '能畫出 agent 迴圈的狀態機，說出每個狀態能轉到哪裡',
      '能為迴圈加上步數上限、累計 token 預算與工具逾時，並用假模型測試',
      '能說明工具呼叫格式錯誤與工具失敗時，迴圈該怎麼處理',
    ],
    challenge: {
      task: '在 [Playground](#/playground?lang=python) 的迴圈程式加上取消：用 `cancel = {"flag": False}`，在每次呼叫模型前與每個工具執行前檢查，旗標為真就轉 `interrupted` 並回傳 context。加一個寫入工具 `issue_refund`，每執行一次就把計數加一。寫一段腳本：第一輪模型要求 `get_order`，`get_order` 執行時把 `cancel["flag"]` 設成真（模擬使用者這時按了取消）；第二輪模型要求 `issue_refund`。',
      deliver: '狀態轉移的輸出、`issue_refund` 的執行次數、`ScriptedModel` 腳本裡剩下的回應數',
      check: [
        '取消之後模型沒有再被呼叫，腳本還剩下第二輪那一則',
        '`issue_refund` 的執行次數是 0',
        '最終狀態是 `interrupted`，回傳的 context 保留第一輪的工具結果',
        '同一輪同時有唯讀與寫入兩個呼叫時，說明你讓哪一個先跑，以及取消發生在兩者之間時寫入會不會執行',
      ],
      twist: '取消剛好發生在 `issue_refund` 已經送到金流、還沒收到回應的時候。先預測恢復時直接重跑會發生什麼，再寫出恢復流程：用哪個 id 當冪等鍵、什麼情況改成先問使用者。最後說明哪些做法可以沿用到訂位系統的「扣訂金」，哪些要跟金流廠商確認（例如冪等鍵保留多久）。',
    },
    refs: [
      { label: 'Python：asyncio.wait_for', url: 'https://docs.python.org/3/library/asyncio-task.html#asyncio.wait_for' },
    ],
  },
  'agent-memory': {
    points: [
      { b: '短期是 context，長期是筆記', t: '短期記憶每輪重送、有長度上限、對話結束就沒；長期記憶跨對話存在，寫入、過濾、存放、檢索、放回 context，流程和 RAG 相近。' },
      { b: '只記三種', t: '事實（環境、決定）、偏好（使用者明說的）、任務摘要（短期限）。用白名單種類，不讓模型自由決定什麼「重要」。' },
      { b: '個資、病人資料、秘密在寫入時擋', t: '只在檢索時過濾不夠，存進去就可能從備份、匯出、別的路徑流出。原則同日誌：能不存就不存。' },
      { b: 'scope 在儲存層過濾', t: '個人、專案、團隊分層，檢索一律帶 `WHERE scope = ?`。不能靠提示詞要模型「別說出別人的記憶」。共用 scope 的寫入要更嚴格。' },
      { b: '要能忘', t: 'TTL（摘要短、推論來的事實中等）、刪除權（含衍生資料）、使用者可檢視、每筆帶來源標記。記憶也是注入面：外部內容衍生的記憶不自動進共用 scope。' },
    ],
    checklist: [
      '能說出哪些內容適合寫進長期記憶、哪些一定不能',
      '能設計帶 scope、來源與 TTL 的記憶存放，並在儲存層做 scope 過濾',
      '能說明記憶如何成為持續性的注入面，以及寫入時的防法',
    ],
    challenge: {
      task: '在 [Playground](#/playground?lang=python) 的記憶程式加一張衍生資料表 `memory_index`（模擬向量索引：`memory_id`、`scope`、`keywords`），`remember` 寫入時同步寫一筆，`recall` 改成先從它找候選。先不改 `forget`：執行 `forget("user:u42")` 後，再查一次 `recall("user:u42", "分頁")`，並數 `memory_index` 裡 u42 的筆數。接著修好 `forget`，再跑一次。',
      deliver: '修改前後各一組輸出：`recall` 的結果、`memories` 與 `memory_index` 裡 u42 的筆數、專案層級的筆數',
      check: [
        '修改前的輸出顯示主表刪了、`memory_index` 還有殘留（或 `recall` 回傳了已刪除的 id）',
        '修改後 u42 在兩張表都是 0 筆，`recall` 回傳空清單',
        '專案層級的筆數在刪除前後不變',
        '寫出 `purge_expired` 與 `forget` 各自要清哪些表',
      ],
      twist: '換成演唱會票務的客服 agent：團隊 scope 有一筆任務摘要「u42 常買搖滾區、上次退票是因為生病」，是從 u42 的對話推論出來的。先預測 `forget("user:u42")` 會不會刪到它，再提出要加的欄位（例如 `derived_from_user`），並說明哪些規則可以沿用診所的做法，哪些要跟票務的法務確認（例如退票原因算不算敏感資料）。',
    },
    refs: [
      { label: 'Python：sqlite3', url: 'https://docs.python.org/3/library/sqlite3.html' },
    ],
  },
  'agent-protocols': {
    points: [
      { b: '先問誰跟誰說話', t: 'agent ↔ 工具：MCP；agent ↔ agent：A2A；編輯器 ↔ coding agent：ACP；網頁 ↔ 瀏覽器內的 agent：WebMCP；agent ↔ 收費服務：x402；代付款的授權：AP2。' },
      { b: 'MCP 與 A2A 互補', t: '對方是被呼叫就照做、立即回傳的功能，用 MCP；對方是會自己規劃、跑很久、可能要來回補充資訊的 agent，用 A2A。同一程式內的多個 agent 不需要協定。' },
      { b: '兩個 ACP', t: 'Zed 推出的 Agent Client Protocol 是編輯器接 coding agent，概念像 LSP；IBM 的 Agent Communication Protocol 是 agent 之間的通訊，兩者不同。' },
      { b: 'WebMCP 還是提案', t: '讓網頁自己宣告可被 agent 呼叫的功能，取代模擬點擊；仍在 W3C 社群小組孵化，API 可能大改，沿用使用者登入狀態，寫入要明確確認。' },
      { b: 'x402 付款、AP2 授權', t: 'x402 用 HTTP 402 回應告訴 agent 要付款才能取用；AP2 用可驗證的紀錄證明使用者授權了這筆購買。金額上限與收款方白名單要在 agent 之外強制執行。' },
    ],
    checklist: [
      '能說出 MCP、A2A、ACP、WebMCP、x402、AP2 各自解決什麼問題',
      '能依「對方是誰、有沒有跨系統邊界」判斷該用哪個協定，或根本不需要',
      '能分辨兩個同名的 ACP',
    ],
    refs: [
      { label: 'Model Context Protocol', url: 'https://modelcontextprotocol.io/' },
      { label: 'A2A Protocol', url: 'https://a2a-protocol.org/' },
      { label: 'Agent Client Protocol', url: 'https://agentclientprotocol.com/' },
      { label: 'x402', url: 'https://www.x402.org/' },
    ],
    challenge: {
      task: '虛構的物流公司 example-logistics 要做 agent 平台，需求有六項：查貨況 API；把「重新規劃整區配送路線」交給合作廠商的 agent（可能跑 30 分鐘，中途會要求補資料）；工程師在各自的編輯器叫用同一個 coding agent；讓客人在官網用瀏覽器裡的 agent 改配送時段；按次付費查外部天氣資料；同一個程式裡的 planner 與 worker。用本課的兩個問題逐項判斷，再到各協定的官方頁面查一次採用狀態，和本課「採用狀態」表的核對日期比較。',
      deliver: '一張表：需求、對方是誰、有沒有跨系統邊界、選的協定或「不需要」、採用狀態與你查到的日期和來源',
      check: [
        '六項都寫出「對方是誰」與「有沒有跨系統邊界」兩個答案',
        '同程式的 planner 與 worker 判為不需要協定；路線規劃判為 A2A，並寫出不包成 MCP 工具的理由',
        'WebMCP 那一列寫出目前的實驗狀態、你核對的日期與官方來源網址',
        '表後列出哪些判斷可以直接搬到醫療情境、哪些要跟業務重新確認（例如客人改時段要不要再確認一次、付費的單筆與每日上限）',
      ],
      twist: '合作廠商把路線規劃改成一支同步 API：3 秒內回結果，不會反問。先預測表上哪一列要改、改成什麼，再說明是哪個判斷條件變了。',
    },
  },
  'ai-threat-modeling': {
    points: [
      { b: '照資料流畫，不照元件畫', t: '使用者輸入 → 檢索 → 模型 → 工具 → 輸出 → 下游。標出信任邊界與會讓資料變成動作的段落（模型 → 工具、輸出 → 下游）。' },
      { b: '模型分不清指令與資料', t: '使用者問題、檢索文件、工具結果進了 context 都只是文字。每一段把外部資料送進模型的邊，都假設它可能夾帶指示。' },
      { b: '逐段對照 OWASP 與 ATLAS', t: 'OWASP Top 10 for LLM Applications 2025（如 Prompt Injection、Excessive Agency、Improper Output Handling）看弱點；MITRE ATLAS 的戰術看攻擊者的進程；STRIDE 確認沒漏掉某一類。' },
      { b: '控制放在模型之外', t: '輸入（長度、頻率）、檢索（權限過濾在查詢條件裡）、工具（白名單、參數驗證、最小權限、人工核准）、輸出（編碼、遮罩）、紀錄。提示詞不是控制。' },
      { b: '先縮小損害範圍', t: '注入不可能百分之百擋住；工具權限最小化、寫入類動作要人確認，被誤導時後果才有上限。資料流一改就重跑威脅模型。' },
    ],
    checklist: [
      '能畫出一個 LLM 應用的資料流並標出信任邊界',
      '能把資料流的每一段對到 OWASP Top 10 for LLM Applications 的風險與 STRIDE 類別',
      '能說出每一類控制該放在哪一層，以及為什麼不能只靠系統提示',
    ],
    refs: [
      { label: 'OWASP GenAI Security Project', url: 'https://genai.owasp.org/' },
      { label: 'MITRE ATLAS', url: 'https://atlas.mitre.org/' },
    ],
    challenge: {
      task: '用本課「把資料流配上規則，自動列出缺的控制」的程式，替一個虛構的客服 agent 畫資料流：使用者輸入、檢索的知識庫、查訂單的工具、寄信工具、輸出到網頁。先在紙上標出要保護的資產（例如訂單資料、寄信能力、系統提示）與每一條跨信任邊界的邊，再把節點與邊寫進程式跑一次。',
      deliver: '一張標了資產與信任邊界的資料流圖，加上程式列出的缺口與你補上的控制',
      check: [
        '每條跨信任邊界的邊都標出資料從哪個信任等級流到哪個',
        '至少列出三個資產，各寫出被拿到或被濫用時的具體後果',
        '程式列出的每個缺口都有對應的控制，或寫明接受風險的理由',
        '寄信工具那條邊對到 LLM06 Excessive Agency，並有不靠提示詞的控制',
      ],
      twist: '產品要讓 agent 也能讀客戶上傳的 PDF。先預測資料流圖會多出哪個節點與邊、新增哪些 OWASP 項目，再跑一次程式確認。',
    },
  },
}

// 領域內文（d10-ai，P9 新課）：以技能 id 為 key，由 body/d10-ai.js 合併。只放這些技能：agent-loop, agent-memory, agent-protocols, ai-threat-modeling
export default {
  'agent-loop': {
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
  },
}

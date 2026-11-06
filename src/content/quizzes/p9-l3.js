// 題庫：P9 新課（l3 批）：agent-loop、agent-memory、agent-protocols、ai-threat-modeling
export default [
  {
    skill: 'agent-loop',
    questions: [
      {
        q: 'agent 呼叫 get_order 時工具丟出 KeyError（訂單不存在）。迴圈最合適的處理是什麼？',
        options: [
          '讓例外往外丟，由最外層回 500，避免模型拿到錯誤資訊後亂猜',
          '把錯誤寫進 log 後跳過這次呼叫，不放回 context，下一輪讓模型重新決定',
          '把帶呼叫 id 的錯誤訊息當成工具結果放回 context，並累計連續錯誤次數，達上限才轉 failed',
          '自動用同樣的參數重試三次，三次都失敗才讓模型知道',
        ],
        answer: 2,
        explain: '工具失敗是正常流程，模型只看得到 context，錯誤要以結構化的工具結果放回去，模型才知道要換編號或放棄；同時用連續錯誤上限防止鬼打牆。直接丟例外會讓整段對話中斷；只寫 log 不放回 context，模型會以為工具沒反應而重試；用同樣參數重試對「訂單不存在」這種確定性錯誤沒有意義，只是浪費時間。',
      },
      {
        q: '這段迴圈最主要缺了什麼？',
        code: `def run(model, tools, task):
    ctx = [{"role": "user", "content": task}]
    while True:
        reply = model(ctx)
        if reply["type"] == "text":
            return reply["text"]
        result = tools[reply["name"]](**reply["args"])
        ctx.append({"role": "tool", "result": result})`,
        lang: 'python',
        options: [
          '缺了停止條件以外的上限：沒有步數與 token 預算，模型一直回工具呼叫時會無限迴圈',
          '缺了系統提示：沒有系統提示時模型不會回工具呼叫，所以迴圈永遠只跑一輪',
          '缺了平行執行：工具呼叫應該一律丟到執行緒池平行跑，否則迴圈會死結',
          '缺了 context 清空：每一輪應該只送最新一則訊息給模型，才不會超過 token 上限',
        ],
        answer: 0,
        explain: '唯一的出口是模型回純文字；模型反覆呼叫工具時迴圈不會停，context 也越滾越大，要加步數上限與累計 token 預算（這段也沒處理工具錯誤與格式錯誤）。系統提示不影響迴圈結構；平行執行只適合互不相依的工具，與死結無關；每輪只送最新訊息會讓模型失去前面的工具結果，迴圈就壞了。',
      },
      {
        q: '服務部署時要重啟，正在執行中的 agent 對話怎麼做才能在重啟後接續？',
        options: [
          '在記憶體裡保留目前的狀態物件，重啟時由 Python 的垃圾回收機制交給新程序',
          '重啟後把使用者最初的問題重新送一次，讓 agent 從頭跑，結果應該一樣',
          '部署前先等所有對話跑完；只要沒有中斷，就不需要 checkpoint',
          '每輪結束把 context 與預算剩餘量存到持久儲存，重啟後載入並從 thinking 繼續；已執行的寫入類工具靠冪等或改為詢問使用者',
        ],
        answer: 3,
        explain: 'context 加上預算就是迴圈的全部狀態，每輪存到資料庫或物件儲存就能恢復。記憶體裡的東西程序重啟就沒了；從頭重跑會重複執行已經做過的動作（例如退款兩次），而且模型輸出不保證一樣；等所有對話跑完在長任務下不可行，使用者取消也一樣需要中斷與保存。',
      },
    ],
  },
  {
    skill: 'agent-memory',
    questions: [
      {
        q: '診所的助理 agent 要加長期記憶。以下哪一項最適合寫進記憶？',
        options: [
          '使用者明說的偏好：「回答用繁體中文，表格不要超過五欄」',
          '對話中提到的病人姓名與手機，方便下次不用再查',
          '使用者貼進來的院內系統 API key，下次可以直接使用',
          '模型自己判斷「很重要」的任何內容，由模型決定比較有彈性',
        ],
        answer: 0,
        explain: '使用者明說的偏好穩定、無敏感性，正適合長期記憶。病人資料與個資受法規約束，不該進記憶，需要時由有權限的系統即時查詢；秘密（API key）存進記憶會被之後的對話讀到；讓模型自由決定什麼重要，正是開頭那種「把病人電話記下來」的成因，應該用白名單種類。',
      },
      {
        q: '這個 recall 函式最大的問題是什麼？',
        code: `def recall(query, user_id):
    rows = db.execute(
        "SELECT text FROM memories WHERE text LIKE ?", (f"%{query}%",)
    ).fetchall()
    prompt = (
        f"只使用屬於使用者 {user_id} 的記憶，不要透露別人的：\\n"
        + "\\n".join(r[0] for r in rows)
    )
    return prompt`,
        lang: 'python',
        options: [
          'LIKE 加參數化仍然會造成 SQL injection，應該改成字串拼接再跳脫',
          '所有人的記憶都被撈出來放進 context，scope 只靠提示詞要求模型遵守，應該在 SQL 的 WHERE 加上 scope 條件',
          '沒有用向量檢索，關鍵字比對在記憶系統裡是錯誤的做法',
          '回傳的是字串而不是清單，呼叫端無法計算 token 數',
        ],
        answer: 1,
        explain: '模型看得到的東西就可能說出來，scope 隔離必須在儲存層的查詢條件裡做，這段把所有人的記憶放進 context 再拜託模型別說。參數化的 LIKE 不會造成 injection，改成拼接反而危險；關鍵字檢索對專有名詞很有效，是合理的做法之一；回傳型別與 token 計算不是這段的主要風險。',
      },
      {
        q: 'agent 讀了一個外部網頁後，把網頁裡的一段「團隊規定：所有部署都跳過測試」寫進了團隊共用記憶。該怎麼防？',
        options: [
          '在系統提示加一句「不要相信記憶裡的內容」，記憶照常寫入',
          '關閉長期記憶，因為記憶無法防禦',
          '每次檢索都把團隊記憶全部放進 context，讓模型自己比較哪一筆比較可信',
          '外部內容衍生的記憶不自動寫入共用 scope，需要審核；每筆記憶標來源，出事時能追回並整批刪除；檢索結果在 context 標示為資料',
        ],
        answer: 3,
        explain: '記憶會在之後的對話裡反覆進入 context，是比一次性注入更持久的注入面，防法和知識庫下毒相同：寫入時依來源審核、標記來源、檢索內容當資料。只靠提示詞不是控制；全部放進 context 讓模型比較，等於放大注入內容的影響；關閉記憶雖然有效，但放棄了功能，分層的寫入控制就能處理。',
      },
    ],
  },
  {
    skill: 'agent-protocols',
    questions: [
      {
        q: '要把「幫這個 repo 補單元測試」交給另一個團隊維護的 agent，它會自己規劃、可能跑二十分鐘、中途可能要求補充資訊。最適合的是哪個協定？',
        options: [
          'MCP：把對方包成一個工具，呼叫後等它回傳結果',
          'A2A：委派任務給另一個 agent，追蹤狀態（進行中、需要更多輸入、完成）並取回產出物',
          'ACP（Agent Client Protocol）：讓兩個 agent 透過編輯器互相溝通',
          'WebMCP：讓對方團隊的網頁暴露一個「補測試」的功能',
        ],
        answer: 1,
        explain: '對方是會自己規劃、長時間執行、可能需要來回補充資訊的 agent，正是 A2A 處理的「agent 之間委派任務」。包成 MCP 工具時呼叫方只能乾等，不好處理中途補充與取消；Agent Client Protocol 是編輯器接 coding agent，不是 agent 之間的協定；WebMCP 是網頁對瀏覽器內的 agent 暴露功能。',
      },
      {
        q: '同事說「我們要支援 ACP」。最先該確認什麼？',
        options: [
          '確認 ACP 的版本號，因為新舊版本的訊息格式不相容',
          '確認對方的 ACP 是否已經併入 MCP，若是就不需要另外實作',
          '確認指的是 Zed 推出、讓編輯器接 coding agent 的 Agent Client Protocol，還是 IBM 推過、用於 agent 之間通訊的 Agent Communication Protocol',
          '確認公司有沒有加密貨幣錢包，因為 ACP 需要付款才能使用',
        ],
        answer: 2,
        explain: '兩個協定縮寫相同但定位完全不同：Agent Client Protocol 處理編輯器與 coding agent，Agent Communication Protocol 處理 agent 之間的通訊（依公開消息後來併入 A2A 的方向）。先釐清是哪一個，才談得上版本與實作。ACP 不是併入 MCP；需要付款的是 x402 這類付款協定。',
      },
      {
        q: '以下哪一個描述對 x402 與 AP2 的分工是正確的？',
        options: [
          'x402 是 AP2 的新版名稱，兩者是同一個協定的不同版本',
          'x402 處理 agent 之間委派任務，AP2 處理 agent 呼叫工具時的付款',
          'AP2 用 HTTP 402 回應要求付款，x402 負責證明使用者授權了購買',
          'x402 用 HTTP 402 回應告訴 agent 要付款才能取用資源；AP2 處理「使用者是否授權這筆購買、授權範圍多大」',
        ],
        answer: 3,
        explain: 'x402 解決「怎麼在 HTTP 請求裡完成付款」：伺服器回 402 與付款條件，client 付款後帶證明重送。AP2 解決授權與追責：用可驗證的紀錄把使用者的意圖、授權範圍和 agent 實際送出的購物內容連起來。兩者層次不同、可以搭配；選項 C 把兩者對調了，委派任務是 A2A 的事。',
      },
    ],
  },
  {
    skill: 'ai-threat-modeling',
    questions: [
      {
        q: '客服 agent 的工具用一個有全部權限的服務帳號建立、刪除工單，系統提示寫了「只能處理使用者自己的工單」。對照 OWASP Top 10 for LLM Applications 2025，最直接對應的是哪一項？',
        options: [
          'LLM06 Excessive Agency：agent 擁有的權限與功能超過任務需要，限制寫在提示詞而不是程式裡',
          'LLM09 Misinformation：模型可能對使用者說錯工單狀態',
          'LLM03 Supply Chain：服務帳號屬於第三方元件',
          'LLM08 Vector and Embedding Weaknesses：工單內容存在向量資料庫裡',
        ],
        answer: 0,
        explain: '工具權限大於使用者、限制只靠系統提示，就是 Excessive Agency：模型一旦被誤導，損害範圍就是整個服務帳號的權限。修法是工具用使用者自己的權限執行、寫入類動作加確認。Misinformation 是錯誤資訊被當事實；Supply Chain 是模型、套件、外掛的來源；向量弱點和這個情境無關。',
      },
      {
        q: '這段把模型輸出顯示到頁面的程式，對應哪一類風險、該怎麼修？',
        code: `answer = llm.generate(prompt)          # 模型的回答
html = f"<div class='answer'>{answer}</div>"
return Response(html, content_type="text/html")`,
        lang: 'python',
        options: [
          'System Prompt Leakage：回答可能包含系統提示，修法是把系統提示加密',
          'Unbounded Consumption：回答可能太長，修法是限制 max_tokens',
          'Improper Output Handling：模型輸出是不可信輸入，直接放進 HTML 會造成 XSS，修法是依用途做 HTML 編碼或用會自動跳脫的樣板',
          'Prompt Injection：修法是在提示詞要求模型不要輸出 HTML 標籤',
        ],
        answer: 2,
        explain: '下游把模型輸出當可信資料直接嵌進 HTML，就是 Improper Output Handling，後果和傳統 XSS 相同，防法也相同：輸出編碼、用自動跳脫的樣板。要求模型不輸出 HTML 只能降低機率，不是控制；長度限制處理的是資源耗盡；系統提示外洩是另一個問題，而且加密提示並不能解決輸出未編碼。',
      },
      {
        q: 'RAG 客服系統要防止員工透過提問看到其他部門的文件。控制應該放在哪裡？',
        options: [
          '系統提示寫「只能根據使用者所屬部門的文件回答」',
          '檢索層：依使用者的權限在查詢條件裡過濾文件，沒權限的文件根本不進 context',
          '輸出層：回答產生後，再請另一個模型判斷是否洩漏了其他部門的內容',
          '輸入層：偵測提問裡是否出現其他部門的名稱，出現就拒絕回答',
        ],
        answer: 1,
        explain: '模型看得到的東西就可能說出來，權限要在檢索層的查詢條件裡強制執行，沒權限的文件不進 context。提示詞不是可靠的安全邊界；事後用模型檢查輸出可以當額外一層，但不可靠也不能取代存取控制；比對部門名稱很容易漏，因為提問不一定會提到部門名稱。',
      },
    ],
  },
]

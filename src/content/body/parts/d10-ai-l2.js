// 領域內文（d10-ai，P9 新課）：以技能 id 為 key，由 body/d10-ai.js 合併。只放這些技能：agent-delivery, skill-registry, ai-gateway
export default {
  'agent-delivery': {
    points: [
      { b: 'prompt、skill、工具定義都是程式碼', t: '它們決定 agent 的行為，放進 repo、走 PR、有版本號。改一個字就是一次變更，要有 diff、有審查者、有能回滾的上一版；只存在供應商後台或聊天視窗裡的 prompt 等於沒有版本。' },
      { b: '評測集放 CI', t: '一組固定的輸入與可機器判定的期望（精確比對、JSON schema、關鍵字、數值範圍），prompt 或模型一變就跑。評測是 agent 的單元測試：沒有它，「改了 prompt 之後變好了」只是感覺。' },
      { b: '跨模型回歸', t: '同一份評測集對兩個以上的模型跑，差異表列出哪些案例只在某個模型失敗。換模型、供應商升版、別名改指向，都用這張表決定能不能換，而不是靠幾次手動試用。' },
      { b: '評測結果是品質閘門', t: '通過率低於門檻、或任何一個標為「必過」的案例失敗，pipeline 失敗、部署不執行。門檻寫在設定裡，和覆蓋率門檻一樣受 CODEOWNERS 保護，不能在同一個 MR 裡順手調低。' },
      { b: '金絲雀與回滾到上一版 prompt', t: '新版 prompt 先接一小部分流量，比較與舊版同時段的錯誤率、延遲、抽樣評分；變差就把流量切回舊版。這需要每次呼叫都記錄 prompt 版本（見 LLM 應用的可觀測性），否則分不出哪一版出了問題。' },
    ],
    checklist: [
      '能列出一個 agent 的所有「行為層」檔案（prompt、skill、工具定義、模型設定），並說出每一項在 repo 裡的位置與版本方式',
      '能寫出一個 eval job：只在 prompt 或 skill 變動時執行、通過率低於門檻就讓 pipeline 失敗、模型金鑰用受保護變數',
      '能說出金絲雀釋出一版 prompt 需要哪些紀錄欄位，以及回滾時實際上改的是什麼',
    ],
    refs: [
      { label: 'GitLab CI：rules:changes', url: 'https://docs.gitlab.com/ee/ci/yaml/#ruleschanges' },
      { label: 'GitLab CI：Protected CI/CD variables', url: 'https://docs.gitlab.com/ee/ci/variables/#protect-a-cicd-variable' },
      { label: 'promptfoo 文件', url: 'https://www.promptfoo.dev/docs/intro' },
    ],
  },
  'skill-registry': {
    points: [
      { b: 'skill 是套件，不是文件', t: '一份 SKILL.md 改一句話，所有載入它的 agent 行為就跟著變。所以它要有套件該有的東西：唯一名稱、來源、版本、變更紀錄、負責人、審核紀錄。沒有這些，出事時連「誰在用哪一版」都答不出來。' },
      { b: '內部 registry 的最小形式', t: '一個 git repo、每個 skill 一個資料夾、一份清單檔（名稱、版本、內容雜湊、負責人、審核日期）、版本用 git tag。不需要先買平台；清單檔是機器讀的真相來源，網頁與搜尋可以之後再加。' },
      { b: '鎖版本、比對雜湊', t: '安裝端記下用的是哪一版與那一版的內容雜湊；載入前重算，對不上就不載入並提示。這和鎖工具描述的雜湊是同一招（見 Tool Poisoning 與 rug pull）：審過的內容被悄悄換掉時要能發現。' },
      { b: '更新要通知、要給 diff', t: '新版本發布後，registry 列出有更新的安裝端，通知裡附上新舊版的差異與變更紀錄；由使用者或負責人決定升不升，不自動替換。自動更新到最新版等於把審核權交給上游。' },
      { b: '下架流程', t: '發現 skill 有問題（誤導模型、洩漏資料、作者不再維護），在清單裡標記 yanked 並寫原因；安裝端比對清單時看到標記就停用並提示替代方案。下架和發布一樣要留紀錄。' },
    ],
    checklist: [
      '能設計一份 skill 清單檔的欄位，並說出每個欄位在「安裝」「比對」「下架」三個時刻各被誰讀取',
      '能寫一段程式：解析清單、比對本機安裝的版本與雜湊、列出可更新與雜湊不符的項目',
      '能說出為什麼更新要「通知並顯示 diff」而不是自動替換，並對應到 rug pull 的風險',
    ],
    refs: [
      { label: 'Semantic Versioning 2.0.0', url: 'https://semver.org/' },
      { label: 'Agent Skills 概觀（Claude 文件）', url: 'https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview' },
    ],
  },
  'ai-gateway': {
    points: [
      { b: '應用程式只連 gateway', t: '所有模型呼叫都送到同一個端點，由 gateway 依設定轉給供應商。供應商的 API 金鑰只存在 gateway；應用程式拿的是 gateway 發的、綁定團隊的虛擬金鑰，可以個別撤銷、個別設額度。' },
      { b: '路由與 fallback', t: '請求裡寫的是模型別名（例如「預設」「便宜的」），對應到哪個供應商的哪個版本由 gateway 的路由表決定；主要模型逾時或回 5xx 時自動改送備援模型，並在回應裡標明實際用了哪一個。換模型不用改應用程式。' },
      { b: '每團隊配額、用量與速率限制', t: '以團隊或專案為單位記 token 用量、換算成本（單價是設定值，不寫死在程式裡）、設每月額度與每分鐘請求上限；超過回 429 並帶 Retry-After。用量報表讓費用能歸戶，而不是一張看不出誰花的帳單。' },
      { b: '出口過濾、快取與逐筆紀錄', t: '請求送出前依規則遮罩或擋下敏感資料（個資、金鑰、內部識別碼）；相同的請求可回快取；每次呼叫記錄團隊、模型、token、延遲、成本、trace id，但 prompt 全文要不要存是政策決定，不是預設。' },
      { b: '和 MCP Gateway 的分工', t: 'AI Gateway 管「應用程式→模型」的呼叫：路由、金鑰、配額、成本。MCP Gateway 管「agent→工具」的呼叫：工具授權、下游憑證、工具定義雜湊。兩者都是集中控制點，管的方向不同，可以並存、也常由不同團隊負責。' },
    ],
    checklist: [
      '能畫出有與沒有 AI Gateway 時，供應商金鑰、配額、紀錄各在哪一層，並說出 gateway 是單點與高價值目標的代價',
      '能實作一個路由函式：依團隊扣配額、超過回 429、主要模型失敗時 fallback 並記錄實際用的模型',
      '能用一張表說出 AI Gateway 與 MCP Gateway 各管什麼、哪些能力重疊、哪些不能互相取代',
    ],
    refs: [
      { label: 'LiteLLM 文件（開源的 LLM proxy / gateway）', url: 'https://docs.litellm.ai/' },
      { label: 'OWASP Top 10 for LLM Applications', url: 'https://genai.owasp.org/' },
    ],
  },
}

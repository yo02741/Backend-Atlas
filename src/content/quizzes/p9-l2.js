// 題庫：P9 新課（l2 批）：ai-gateway / agent-delivery / skill-registry / llm-observability
export default [
  {
    skill: 'ai-gateway',
    questions: [
      {
        q: '導入 AI Gateway 後，應用程式呼叫模型時應該帶什麼憑證？',
        options: [
          '供應商發的 API 金鑰，gateway 只負責轉送與記錄，金鑰由各團隊自己保管與輪替',
          'gateway 發的虛擬金鑰，綁定團隊與額度；供應商金鑰只存在 gateway，應用程式看不到',
          '不需要任何憑證，gateway 放在內網，能連到它的請求就視為可信任的內部流量',
          '使用者的 SSO token 原樣轉給供應商，讓供應商依使用者身分計費與限流',
        ],
        answer: 1,
        explain: '虛擬金鑰讓用量能歸戶到團隊、可以單獨撤銷與設額度，外洩時只要撤銷那一把，供應商金鑰不必輪替。讓各團隊自己拿供應商金鑰，就回到金鑰散落、帳單無法歸戶的原狀；只靠內網位置當信任，任何內網程式都能無限用量；供應商不認得公司的 SSO token，轉送使用者 token 也違反「token 只給它的 audience」的原則。',
      },
      {
        q: '這段 gateway 路由邏輯有什麼問題？',
        code: `for model in ROUTES[alias]:
    try:
        return call_provider(model, request)
    except ProviderError as e:
        # 任何錯誤都換下一個模型
        continue
raise AllModelsFailed()`,
        lang: 'python',
        options: [
          '應該從最便宜的模型開始試，主要模型放最後，才能把成本壓到最低',
          '迴圈應該平行呼叫所有候選模型，取最快回來的那一個，延遲最低',
          '對 400 這類請求本身的錯誤也 fallback，換模型一樣會錯還多花錢；而且沒記錄實際用了哪個模型',
          '沒有問題：fallback 的目的就是盡量回應，任何錯誤都該換模型重試',
        ],
        answer: 2,
        explain: 'fallback 應只針對逾時、5xx、供應商限流這類「換一家可能就好」的錯誤；400（請求格式、超過 context 長度）在備援模型上通常一樣失敗，只是多付錢與多等。回應與紀錄也要標明實際用到的模型與是否 fallback，否則行為改變時查不出原因。路由順序由評測與需求決定，不是單純比價；平行呼叫全部候選會讓成本倍增。',
      },
      {
        q: '團隊的 agent 同時會呼叫模型與 MCP 工具。公司已經有 MCP Gateway，還需要 AI Gateway 嗎？',
        options: [
          '需要：MCP Gateway 管工具呼叫的授權與下游憑證，模型呼叫的金鑰、路由、配額與成本是另一個方向，要另外管',
          '不需要：MCP Gateway 已經是集中控制點，模型呼叫也會自動經過它並被記錄',
          '不需要：只要把模型 API 包成一個 MCP 工具，所有模型呼叫就能用 MCP Gateway 的上架流程管理',
          '需要，但只要 AI Gateway 就好，它可以取代 MCP Gateway 的工具授權與工具定義雜湊檢查',
        ],
        answer: 0,
        explain: '兩者站的位置不同：AI Gateway 在應用程式與模型供應商之間，MCP Gateway 在 agent 與工具之間。模型推論不走 MCP，不會自動經過 MCP Gateway；把模型包成工具並不會讓 agent 本身的模型呼叫經過它。AI Gateway 也沒有工具層的授權與工具定義比對。兩者可以並存，紀錄共用 trace id 才能串起來。',
      },
    ],
  },
  {
    skill: 'agent-delivery',
    questions: [
      {
        q: '一個 MR 只改了系統提示裡的一句話，作者說「我手動試了五個例子都對」。最該補上的是什麼？',
        options: [
          '請作者再多試二十個例子，並把截圖貼在 MR 說明裡，讓審查者確認',
          '把溫度設成 0，輸出就是確定的，五個例子都對就代表新版一定沒問題',
          '直接合併，上線後觀察使用者回饋，有問題再改回來即可，prompt 改動成本很低',
          '在 CI 對固定的評測集跑新舊兩版，通過率低於門檻或必過案例失敗就擋住合併',
        ],
        answer: 3,
        explain: '手動試幾個例子無法發現沒試到的類別退步。評測集放進 CI，每次改 prompt 都自動跑、結果可比較，才是可重複的驗證；必過案例能防止關鍵類別被總通過率掩蓋。截圖仍是人工抽樣；溫度 0 降低隨機性但不保證不同輸入的表現；「上線再看」等於讓使用者當評測集，而且沒有紀錄時連改回哪一版都不確定。',
      },
      {
        q: '這份 GitLab CI 設定最大的問題是什麼？',
        code: `eval-prompts:
  stage: eval
  variables:
    MODEL_API_KEY: "sk-live-8f2c..."
  rules:
    - changes: [prompts/**/*, skills/**/*]
  script:
    - python evals/run.py --min-pass-rate 0.9
  allow_failure: true

deploy-prompts:
  stage: deploy
  script:
    - python scripts/publish_prompts.py`,
        lang: 'yaml',
        options: [
          'rules: changes 不能和 script 放在同一個 job，評測應該拆成兩個 job',
          '金鑰寫死在檔案裡，而且 allow_failure: true 讓評測失敗也不會擋住後面的部署',
          '--min-pass-rate 0.9 太高，模型輸出有隨機性，門檻應該設在 0.5 左右',
          'eval 與 deploy 的 stage 名稱不在預設清單裡，GitLab 會直接忽略這兩個 job',
        ],
        answer: 1,
        explain: '寫在 .gitlab-ci.yml 的金鑰會永遠留在 git 歷史，應改用專案設定的 protected、masked 變數。allow_failure: true 讓 eval 紅燈時 pipeline 仍算成功，deploy 照常執行，品質閘門形同虛設。rules 與 script 本來就放在同一個 job；門檻要依評測集與業務決定，不是越低越好；自訂 stage 只要在 stages 列出即可，不會被忽略。',
      },
      {
        q: '新版 prompt 以金絲雀方式給 5% 流量，一小時後抽樣評分明顯變差。要能快速回滾並修正已產生的結果，事先最需要具備什麼？',
        options: [
          '每次呼叫的紀錄都帶 prompt 版本，上一版仍在版控裡，可以把目前版本指回上一版',
          '在供應商後台開啟 prompt 的自動備份功能，需要時請供應商協助還原',
          '把金絲雀比例一開始就設成 50%，樣本數足夠，比較快判斷要不要回滾',
          '在系統提示最後加上「如果不確定就照舊版的方式回答」，讓模型自己回到舊行為',
        ],
        answer: 0,
        explain: '回滾的前提是上一版存在、而且知道是哪一版；修正已產生的結果則要靠紀錄裡的 prompt 版本，找出哪些輸出是新版產生的。依賴供應商後台的備份讓回滾不在自己掌控中，也沒有 diff 與審查紀錄；比例開大只會讓更多使用者受影響；用 prompt 要求模型「照舊版做」既不可靠也無法驗證。',
      },
    ],
  },
  {
    skill: 'skill-registry',
    questions: [
      {
        q: '內部 skill registry 剛起步，最小可行的形式是什麼？',
        options: [
          '一個共用雲端資料夾，所有人把自己的 SKILL.md 放進去，檔名加上日期當作版本',
          '先導入完整的套件管理平台，等平台上線再開始整理 skill，避免之後要搬遷',
          '一個 git repo：每個 skill 一個資料夾、一份清單檔記名稱、版本、內容雜湊、負責人，版本用 git tag',
          '在聊天室開一個頻道公告新 skill，大家看到後自己複製最新版到本機',
        ],
        answer: 2,
        explain: 'git repo 提供版本、diff 與審查（MR、CODEOWNERS），清單檔是機器能讀的真相來源，安裝端才有東西可以比對；tag 讓任何版本都取得回來。共用資料夾與聊天室公告沒有審核、無法鎖版本，也查不出誰在用哪一版；等平台上線才開始，等於這段時間完全沒有管理，而平台本身也需要先有清單才有東西可放。',
      },
      {
        q: '比對程式對 sql-review 回報「已是最新版」，但它其實有問題。問題出在哪？',
        code: `def check(manifest, installed):
    for s in installed:
        reg = manifest[s["name"]]
        if reg["version"] != s["version"]:
            print(s["name"], "有更新")
        else:
            print(s["name"], "已是最新版")

# 本機的 sql-review 版本與 registry 都是 2.0.1，
# 但本機的 SKILL.md 被人加了一段指示`,
        lang: 'python',
        options: [
          '版本比較應該用 >= 而不是 !=，否則降版也會被當成更新',
          '只比版本號、沒有比內容雜湊；內容被改過但版本號沒動時，會被誤判為最新',
          'manifest 應該用 list 而不是 dict，否則同名 skill 會被覆蓋',
          '應該先比對 owner 欄位，負責人一致才代表內容沒被修改',
        ],
        answer: 1,
        explain: '版本號只說明「宣稱是哪一版」，內容是否被改要靠雜湊：安裝端重算本機內容的雜湊，和 lock 與 registry 比對。版本比較的方向確實也該處理，但這不是本例誤判的原因；資料結構與 owner 欄位都無法偵測內容被改寫。同版本不同雜湊時應該停用並比對差異。',
      },
      {
        q: 'registry 發布了 release-notes 1.4.0，新增一條會改變輸出格式的規則。安裝端應該怎麼處理？',
        options: [
          '自動更新到 1.4.0，確保所有人都用最新、最安全的版本，避免版本分歧',
          '永遠不更新，鎖定的版本就是審過的版本，任何更新都有風險',
          '刪掉本機的 1.3.x，等使用者下次需要時再從 registry 重新下載最新版',
          '通知使用者有新版，附上變更紀錄與新舊版的 diff，由使用者或負責人確認後再更新 lock',
        ],
        answer: 3,
        explain: '自動更新等於把「哪段文字能進入 agent」的決定權交給上游，上游被改寫時（rug pull）使用者端毫無提示。永遠不更新會錯過修正與安全規則，例如這次就是一條保護規則。刪除再重新下載也是變相的自動更新。通知加 diff 讓人看到行為上的變化再決定，lock 也隨之更新為新版本與新雜湊。',
      },
    ],
  },
  {
    skill: 'llm-observability',
    questions: [
      {
        q: '文件問答功能的 5xx 比例一直很低，但使用者抱怨回答品質變差。哪一種做法最能量到品質？',
        options: [
          '降低 5xx 告警門檻，品質下降時錯誤率一定會先微幅上升，只是原本的門檻太粗',
          '抽樣把回應交給人工或模型評分，搭配使用者回饋，結果帶著 prompt 版本與模型分組看',
          '改看平均延遲，回答變差通常是因為模型變慢，延遲是品質的代理指標',
          '在回應後面加上「這個回答有幫助嗎」，只要沒有收到負評就代表品質正常',
        ],
        answer: 1,
        explain: '答錯的回答仍然是 HTTP 200，錯誤率與延遲都看不出品質。抽樣評分（人工或模型）加上使用者回饋才能量品質；分數帶著 prompt 版本與實際模型，才能指出是哪一次改動變差。回饋本身稀疏且有偏差，「沒有負評」不等於品質正常，要和抽樣評分一起看。',
      },
      {
        q: '這筆 LLM 呼叫紀錄最大的問題是什麼？',
        code: `{"trace_id": "7c1e…", "model": "default", "latency_ms": 2140,
 "in_tokens": 4210, "out_tokens": 380,
 "prompt": "使用者：我的身分證是 A123456789，想查保單…",
 "response": "您好，A123456789 名下的保單…"}`,
        lang: 'json',
        options: [
          '缺少 HTTP 狀態碼，沒有狀態碼就無法計算錯誤率，其他欄位都夠用',
          'latency_ms 應該改用秒為單位，不同團隊的儀表板才能共用同一套查詢',
          'trace_id 不該寫進 log，它會讓攻擊者把不同請求串在一起',
          '把 prompt 與回應全文連同個資寫進 log；而且只記別名 default、沒有 prompt 版本與實際模型',
        ],
        answer: 3,
        explain: '使用者輸入與模型回應全文會把個資複製到 log 平台，應該預設只記欄位與長度，全文另存並控管、寫出前遮罩。只記別名看不出供應商改指向或 fallback，缺 prompt 版本則分不出哪一版改壞。狀態碼可以補但不是最大問題；單位是命名慣例問題；trace_id 本來就是用來串請求的欄位。',
      },
      {
        q: '流量和上個月差不多，但模型費用多了六成。從紀錄最先該看哪個數字？',
        options: [
          '各 prompt 版本的平均輸入、輸出 token 與每千次呼叫成本，看是不是某次改動讓每次呼叫變貴',
          '供應商帳單上的總金額，與上個月逐日比對，找出費用開始上升的那一天',
          '服務的 CPU 與記憶體使用率，費用上升通常代表應用程式在重試',
          '使用者回饋的倒讚比例，品質下降時使用者會重問，費用自然上升',
        ],
        answer: 0,
        explain: '流量不變而成本上升，代表每次呼叫變貴：輸入 token 變多（例如檢索段落增加）、換到較貴的模型、或 fallback 比例上升。每千次成本與平均 token 依 prompt 版本與模型分組，最快定位原因。帳單只有總額、無法歸因；CPU 與模型費用無直接關係；重問會增加呼叫數，但題目說流量差不多。',
      },
    ],
  },
]

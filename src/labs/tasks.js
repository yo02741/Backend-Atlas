// 實驗室的觀察任務：實驗室上方的「先猜 → 操作 → 看哪個觀察推翻猜測」。key 是 src/labs/index.js 的實驗室名。
// 此檔要能被 Node 直接 import（校驗用）。格式見 docs/CONTRIBUTING-labs.md 的「觀察任務」。
//   predict  動手前要寫下的預測（一句）
//   steps    2–4 步，指名實驗室上真的有的控制項
//   observe  哪個觀察會推翻猜測（一句，不寫答案）
//   preset   選填：一組固定參數，帶人時大家共用
export const LAB_TASKS = {
  SqlJoinLab: {
    predict: 'JOIN 換成「FULL 排除」之前，先寫下結果會留下哪幾位使用者、哪幾筆訂單；在 orders 點掉 Bob 的訂單 103 之後，結果會多一列還是少一列？',
    steps: ['JOIN 選「FULL 排除」，對照結果表和自己寫下的名單', '在 orders 表點掉 103 那一列，再記一次列數', '按「還原資料」，JOIN 換成「INNER」，再點掉 103'],
    observe: '結果表上方的列數，以及「沒訂單的使用者」「沒使用者的訂單」兩個計數在點掉 103 前後的變化。',
  },
  IndexLab: {
    predict: '資料列數從 16 拉到 64（4 倍），Seq Scan 的比較次數和 B-tree 要走的層數各變成幾倍？',
    steps: ['「資料列數」拉到 16 列，按「▶ 執行 WHERE id = …」，記下兩邊的次數', '「資料列數」拉到 64 列，不換目標，再執行一次', '關掉「這個欄位有索引」再執行，看 EXPLAIN 輸出換成哪一種掃描'],
    observe: 'heap 上方的「比較 N / N 次」與 b-tree 上方的「走訪 N / N 層」，兩次執行之間各差幾倍。',
    preset: '先拉到 16 列（目標會跟著變成 id = 16），不按「換目標」，再拉到 64 列。',
  },
  DocVsRelLab: {
    predict: 'Bob 改名的時候，三種擺法各要改幾個地方？留言從 2 則加到 8 則之後，這個數字會不會變？',
    steps: ['「擺法」選「關聯式（3 張表）」，數 Bob 的名字出現在幾格', '按「＋ 新增一則留言」直到 comments 共 8 列', '切到「文件（嵌入 embed）」與「文件（參照 reference）」，各數一次 Bob 的名字出現幾次'],
    observe: '嵌入模式的 JSON 裡 "author": "Bob" 出現的次數，以及右邊「讀一篇文章」的查詢在三種擺法下各要打幾次。',
  },
  CacheLab: {
    predict: '關掉「寫入時使快取失效」，UPDATE 之後馬上 GET，拿到的是新名字還是舊名字？要等多久才會變？',
    steps: ['關掉「寫入時使快取失效（invalidate）」，TTL 拉到 15 秒', '按 GET /users/1 兩次，再按 UPDATE user 1 的名字', '馬上按 GET /users/1，之後每隔幾秒再按一次'],
    observe: '請求記錄裡第一次讀到新名字的那一筆，距離 UPDATE 過了幾秒、是 hit 還是 miss。',
    preset: 'TTL 15 秒、invalidate 關閉，GET 兩次後 UPDATE。',
  },
  JwtLab: {
    predict: '打開「竄改 payload」之後，PAYLOAD 面板還解得出內容嗎？伺服器判定是什麼？role 本來就選 admin 時再竄改，判定會不會不同？',
    steps: ['role 選 user，打開「竄改 payload（role 改 admin，不重簽）」', '對照 PAYLOAD 面板、「簽章有效／簽章無效」與「伺服器判定」', 'role 改選 admin（竄改開關不動），再記一次', '關掉竄改，打開「伺服器用不同的 secret 驗證」'],
    observe: 'PAYLOAD 面板能不能讀出 role，和簽章狀態是不是同一件事；SIGNATURE 面板裡兩段簽章的前 14 個字元是否相同。',
  },
  OAuthLab: {
    predict: '八步裡哪幾步的訊息完全不經過瀏覽器？關掉 PKCE 之後，攔到授權碼的人在哪一步就能換到 token？',
    steps: ['用「→」一步一步走完八步，記下每一步箭頭兩端是哪兩條泳道', '關掉「PKCE（code_challenge / code_verifier）」，回到第 ⑤ 步', '對照右邊請求原文的高亮行，再打開 PKCE 比一次'],
    observe: '時序圖上不碰「瀏覽器」泳道的箭頭是哪幾步，以及第 ⑤ 步的請求裡 code_verifier 那一行在不在。',
  },
  AccessControlLab: {
    predict: 'RBAC 下 editor 的 Alice 可以 write 任何文件。換成 ABAC，同一個 write 在資源是別人的、資源是自己的、自己的但晚上 8 點，三種情況下各是允許還是拒絕？',
    steps: ['「模型」換 ABAC，action 選 write，關掉「resource 是本人的」', '打開「resource 是本人的」', '「env.hour」拉到 20:00', 'resource.classification 換 public，再看一次'],
    observe: '四條規則各自標的「命中 → 允許」「命中 → 拒絕」「不適用」，以及最後判定由哪一條決定。',
  },
  SqlInjectionLab: {
    predict: '使用者帳號 o\'brien、密碼 sun\'set（各含一個單引號，都是正常輸入）。字串拼接與參數化兩種模式下，各會得到語法錯誤、0 列，還是登入成功？',
    steps: ['「模式」選「字串拼接（f-string）」，username 輸入 o\'brien、password 輸入 sun\'set', '記下 users 表上方的匹配列數與右邊說明的標題', '「模式」換「參數化查詢」，看「參數（另外傳）」裡的兩個值', '按「正常帳密」，在 password 尾端加一個單引號，兩種模式各試一次'],
    observe: '拼接模式下說明標題是「查詢壞掉了」還是「帳密錯誤」，以及參數化模式下引號有沒有原樣留在參數裡。',
    preset: 'username o\'brien、password sun\'set。',
  },
  HashingLab: {
    predict: '密碼不變、按「換一個 salt」之後，Base64、SHA-256、PBKDF2 三張卡哪幾個結果會變？PBKDF2 的「實測」毫秒兩次會一樣嗎？',
    steps: ['密碼維持 hunter2，記下三張卡的輸出與 PBKDF2 卡的「實測」毫秒', '按「換一個 salt」，再記一次', '「PBKDF2 iterations」拉到 600,000，再按一次「換一個 salt」'],
    observe: '哪幾張卡的輸出前後不同，以及兩次「實測」的毫秒差多少；同樣 iterations 下差異來自哪裡。',
  },
  HttpLab: {
    predict: '打開連線重用後，第 2 次請求會省掉哪幾段？從 200 換成 301，省下的時間占第 1 次總耗時的比例變大還是變小？',
    steps: ['「情境（狀態碼）」選 200，打開「keep-alive / HTTP/2 連線重用」', '對照下方耗時條「第 1 次請求（含建立連線）」與「第 2 次請求（連線重用）」的總耗時', '情境換 301，再對照一次'],
    observe: '第 2 條時序左邊「跳過 ①②③：省下 … ms」，以及它和第 1 次總耗時的比例。',
  },
  DockerLab: {
    predict: '「壞的順序」下只改 app.py，從第幾行開始重建？「好的順序」下改了 pyproject，又從第幾行開始？',
    steps: ['「Dockerfile 順序」選「壞的順序」，「這次改了什麼」選「只改 app.py」', '用「→」逐層 build，每按一次之前先說這一層是 cache hit 還是 rebuilt', '換「好的順序」與「改了 pyproject（新增依賴）」，從頭再走一次'],
    observe: '堆疊圖上第一個出現 rebuilt 的層，以及下方「這次 build ≈」的秒數。',
  },
  ComposeLab: {
    predict: '打開「db 沒 ready（啟動慢）」、不加 condition，走到 api 那一步時 api 是什麼狀態？加上 condition: service_healthy 後呢？',
    steps: ['打開「db 沒 ready（啟動慢）」，用「→」走到「api」', '看拓樸圖上 api 與 db 的狀態字', '打開「condition: service_healthy」，從頭再走一次，對照 compose.yaml 多出的幾行'],
    observe: 'api 節點出現 exited (1) 或 up 的那一步，當下 db 是 starting、up 還是 healthy。',
  },
  NginxLab: {
    predict: '打開「app2 掛了」後連送 6 個 /api/users，三台各收到幾個？第 2 個請求是直接跳過 app2，還是先試過 app2 才轉走？',
    steps: ['「請求路徑」選 /api/users，打開「app2 掛了」', '按「送出請求 →」6 次，每次看分派圖下方與右邊說明', '按「計數歸零」，關掉「app2 掛了」再送 6 次', '「請求路徑」換 /health 與 /static/logo.png 各送一次'],
    observe: 'app 節點右側的請求數，以及說明裡這個請求最後由誰回應（哪一台 app、nginx 自己，或靜態檔）。',
  },
  PipelineLab: {
    predict: '同時打開「讓測試失敗」與「這次是 feature branch」，build 和兩個 deploy 階段各顯示 skipped 還是「條件不符」？',
    steps: ['只打開「讓測試失敗」，用「→」走到最後一步，記下每個階段的狀態', '再打開「這次是 feature branch」，從頭走一次', '「平台」切到 GitLab CI，對照 YAML 裡標出的行'],
    observe: '每個階段方塊上的狀態字（通過、失敗、skipped、條件不符），以及兩家平台各用哪一行擋住後面的階段。',
  },
  BigOLab: {
    predict: 'n 從 25 拉到 50（翻倍），五條曲線的操作次數各變成幾倍？',
    steps: ['「資料量 n」拉到 25，記下表格裡五列的操作次數', '拉到 50 再記一次，算出每列的倍數', '打開「y 軸對數刻度」，看哪幾條線在 n 大的那一段幾乎平行'],
    observe: '表格「操作次數」欄兩次的比值，對照每條曲線的公式。',
  },
  RateLimitLab: {
    predict: '10 秒內送 30 個請求，一種是每 3 秒「暴衝送 10 個」共三次，一種是「自動送」每秒 3 個。哪一種被拒的比較多？',
    steps: ['「演算法」選 Token bucket，「桶容量 capacity」10、「補充速率」2 token/s，按「重置」', '按「暴衝送 10 個」，約 3 秒後再按一次，再約 3 秒按第三次，記下 accepted／rejected', '按「重置」，打開「自動送」、「每秒請求數」設 3 req/s，約 10 秒後關掉，再記一次'],
    observe: 'rejected 的數字，以及請求記錄裡第一筆 429 出現的時間。',
    preset: '容量 10、補充 2 token/s；暴衝組每 3 秒送 10 個共三次，自動組 3 req/s 跑 10 秒。手動計時會有誤差，比的是數量級。',
  },
  AsyncLab: {
    predict: '多執行緒只開 2 個 worker 時，總耗時大約是同步的幾分之幾？工作換成純 CPU 運算後，async 的總耗時會變成多少？',
    steps: ['「模式」選「多執行緒」，「worker 數」拉到 2 threads，記下總耗時與 CPU 利用率', '「worker 數」拉到 4，再記一次', '「模式」換 async，打開「改成 CPU 密集運算（沒有 I/O）」'],
    observe: '「總耗時」與「CPU 利用率」兩格，以及甘特圖上淺灰（等 GIL / 等 CPU）的段落在哪一種工作裡變長。',
  },
  RestLab: {
    predict: '先寫下：八個意圖裡，哪幾個在 timeout 後可以不加任何處理直接重送？再猜「整筆取代」只送 status 時，id 42 的 note 會變成什麼。',
    steps: ['「我想要…」逐一切過八個意圖，記下每個的方法、狀態碼與冪等標記', '選「整筆取代」，看 orders 表 id 42 那一列', '選「重送同一個建立請求」，「帶 Idempotency-Key 標頭」關著與打開各看一次表格'],
    observe: '冪等標記和自己寫的清單哪裡不同，以及 note 欄與「重複下單」標記。',
  },
  UvLab: {
    predict: '同事 clone 之後只跑 uv sync --frozen 就能啟動。在這之前，同事的機器上必須已經有什麼？哪些檔案從 repo 來、哪些是當場產生的？',
    steps: ['用「→」走到最後一步「同事 clone」，先不看說明', '對照左邊檔案樹每個檔案的標記與終端輸出', '回到「建專案」與「加依賴」兩步，找出 .python-version、uv.lock、.venv/ 各在哪一步出現'],
    observe: '終端輸出裡「Using CPython 3.12」「Creating virtual environment」兩行，以及檔案樹上 .venv/ 與 uv.lock 的標記差在哪。',
  },
  TxnLab: {
    predict: '「一句條件 UPDATE」在 READ COMMITTED 下，T2 那句 UPDATE 會在哪一步等鎖？醒來後更新了幾列？換成 REPEATABLE READ 會多出哪一步？',
    steps: ['「隔離等級」選 READ COMMITTED、「做法」選「一句條件 UPDATE」', '用「→」一步一步走，每步先說 T2 泳道的狀態再按', '「隔離等級」換 REPEATABLE READ，再走一次'],
    observe: '時間軸裡 T2 那一欄的輸出（等待、UPDATE 0、ERROR 40001），以及每一步「已提交的 stock」。',
  },
  NetPathLab: {
    predict: '「DNS 指到舊 IP」和「防火牆 DROP」在瀏覽器上都是 ERR_CONNECTION_TIMED_OUT。dig、nc、curl 三段輸出，最少看哪一段就能分辨兩者？',
    steps: ['「故障」選「防火牆 DROP」，只看標題 ① DNS 那段 dig 輸出，記下 IP', '換「DNS 指到舊 IP」，同樣只看 dig', '再對照兩者的 nc 與 curl，數一數總共看了幾段輸出才確定'],
    observe: 'dig 回的 IP 和 nc、curl 嘗試連線的 IP 是不是同一個，以及說明把故障歸在哪一層。',
  },
  CertChainLab: {
    predict: '憑證 SAN 是 *.example.org。連到 api.example.org、example.org、a.b.example.org，哪幾個會通過名稱檢查？名稱不符時，openssl s_client 的 Verify return code 是多少？',
    steps: ['「狀況」選「網域不符」，「憑證 SAN」選 *.example.org', '「連線到」依序選三個名稱，每次用「→」走到「結果」', '指令輸出切到「s_client -showcerts」，看 Verify return code 與最後補的 -verify_hostname'],
    observe: '「比對網域」「檢查有效期」「往上找簽發者」三項各自的 ✓／✕：名稱、效期、鏈完整是三份分開的證據。',
  },
  CapacityLab: {
    predict: '用平均流量（每人每分鐘 2 次）估出的機器，遇到尖峰（6 次）時 CPU 會到多少？要多幾台？',
    steps: ['「每人每分鐘請求」設 2 次，其他用預設，記下「需要的 CPU」與「機器台數」', '改成 6 次，記下「尖峰 RPS」下方「平均忙 N 核」的數字與新的台數', '打開「掛掉一台（N+1 檢查）」，看剩下的機器 CPU 百分比'],
    observe: '2 次時算出的機器總核心數，和 6 次時「平均忙 N 核」相比還剩多少餘裕。',
    preset: '尖峰同時在線 2,000 人、每請求 CPU 40 ms、等 I/O 120 ms、目標使用率 70%、機器 8 核 / 32 GB。',
  },
  K8sLab: {
    predict: '副本 3、maxSurge 1、maxUnavailable 0，新版 readiness 一直失敗。部署後 Ready 的副本最少掉到幾個？maxUnavailable 改成 1 呢？',
    steps: ['「副本數 replicas」3、maxSurge 1、maxUnavailable 0，打開「新版 readiness probe 失敗」', '按「部署新版本 v2」，看「Ready / 期望」到卡住為止的最小值', '按「重置」，maxUnavailable 改 1 再部署一次', '按「回滾（rollout undo）」，看 Ready 回到幾個'],
    observe: '「Ready / 期望」與「成功 / 503」兩格，以及卡住時新舊版 Pod 各有幾個。',
  },
  SloLab: {
    predict: '「第 5 天全面中斷 30 分」這一次事故，在 SLO 99.5% 和 99.95% 下各用掉幾成預算？哪一個會超支？',
    steps: ['「事件」選「第 5 天全面中斷 30 分」，「SLO」選 99.5%', '記下「30 天共用掉」與「事件期間燒率」', '「SLO」換 99.95%，「看第幾天」拉到第 4 天與第 6 天，對照「想上新功能？」那一列的結論'],
    observe: '兩個 SLO 下「30 天共用掉」的百分比與燒率，以及預算政策的結論在事故前後怎麼變。',
  },
  DeviceCodeLab: {
    predict: '三個情況：A 在 SSH 進去的伺服器上跑 CLI；B 手機 App 讓使用者登入；C 夜間批次服務呼叫另一個內部 API，沒有人在場。先寫下每個情況誰在場、誰拿著哪台裝置，再各選一個流程。',
    steps: ['「流程」依序切 Device Code、授權碼 + PKCE、Client Credentials，看時序圖有哪幾條泳道', '在 Device Code 打開「使用者沒核准直到過期」，走到最後一步', '在授權碼 + PKCE 打開「攻擊者攔截授權碼」，走到攻擊者換 token 那一步'],
    observe: '每個流程的泳道裡有沒有瀏覽器、瀏覽器和發起請求的程式是不是在同一台裝置，以及攔截情境裡攻擊者換 token 得到的回應。',
  },
  ToolPoisoningLab: {
    predict: '「核准後被改掉（rug pull）」情境只開一道防禦。只開「載入時掃描描述」擋得住嗎？只開「描述版本鎖定」呢？',
    steps: ['「情境」選「核准後被改掉（rug pull）」，四道防禦全關，看執行紀錄', '只打開「載入時掃描描述」，看執行紀錄', '關掉它，只打開「描述版本鎖定」，對照工具卡上的 sha256', '「情境」換「描述藏指令」，同樣只開「描述版本鎖定」'],
    observe: '執行紀錄最後一步標的是「擋下」還是「洩漏」，以及版本鎖定在兩個情境下比對的是哪一份描述。',
  },
  FlexboxLab: {
    predict: '容器寬度縮到 280px、沒開 flex-wrap，五張卡片會換行、超出容器，還是被壓窄？把第二張卡片的 flex-shrink 改成 0 之後，它會變寬、變窄，還是不變？',
    steps: ['flex-direction 選 row，關掉「flex-wrap: wrap」', '「容器寬度」拉到 280px，記下「② 寬」與溢出量', '「flex-shrink」拉到 0，再記一次', '打開「flex-wrap: wrap」，比較卡片的寬度'],
    observe: '280px 時卡片有沒有超出容器的框、「② 寬」在 flex-shrink 1 與 0 之間的差距，以及「目前的 CSS」裡哪一行的值決定了這件事。',
    preset: 'row、nowrap、gap 12px、容器 280px；只動第二張卡片的 flex-shrink。',
  },
  // ---- 以下依 LAB_META 順序，從 ChunkingLab 起 ----
  ChunkingLab: {
    predict: '問題選「網路截止」之前，先讀規範原文：回答它需要哪幾句、落在第幾段？段落 100 字、top-k 1 時，這些句子會被完整取回嗎？',
    steps: ['段落大小 100 字、重疊 0%、top-k 1，先在原文上圈出你認為該取回的段落編號', '問題選「網路截止」，對照「相似度排名」表與「回答需要的句子」', '依序打開「切在句子邊界」、把重疊拉到 20%、top-k 改成 3，每次記下「答案佔取回內容」'],
    observe: '你圈的段落有沒有落在粗框的 top-k 裡，以及每一句答案標的是「完整取回」還是「只取回片段」。',
    preset: '段落大小 100 字、重疊 0%、不切句子邊界、top-k 1。',
  },
  HarnessLab: {
    predict: '溫度從 0.7 降到 0.2，「失敗重試 ≤ 3 次」比「直接用第一次」多救回的通過率會變多還是變少？每次任務多花的呼叫呢？',
    steps: ['打開「固定亂數種子」、取樣次數選 20 次、溫度 0.7，在期望值表記下「第一次就用」與「重試」兩列的正確率與每次任務呼叫', '兩列相減，算出重試救回幾個百分點、平均每救回一個任務多花幾次呼叫', '溫度拉到 0.2 再算一次；harness 策略選「失敗重試 ≤ 3 次」按「跑評測」，看哪幾題仍然出現紅格'],
    observe: '兩個溫度下「救回的百分點」與「多花的呼叫」，以及「重試」那列的「錯誤放行」在兩個溫度下各剩多少。',
    preset: '固定亂數種子、取樣 20 次，溫度 0.7 與 0.2 各算一次。',
  },
  TokenCostLab: {
    predict: '固定段 60%、快取命中率 80% 不變，把每次請求的 context 從 12k 拉到 48k tok：用 prompt 快取比全部重送省下的百分比會變大、變小，還是不變？',
    steps: ['按「回到示意值」，在「三種做法並排」表記下「用 prompt 快取」那列的「vs 全部重送」', '「每次請求的 context」拉到 48k tok，再記一次', '「輸出長度」拉到 4,000 tok，再記一次', '拿最後一組的「每次請求」金額，假設一個任務平均呼叫 4 次、成功率 80%，算出每個成功任務的成本'],
    observe: '三次的「vs 全部重送」百分比，以及「輸入 vs 輸出」的占比跟著怎麼移動。',
    preset: '示意單價（輸入 $1、輸出 $5、折扣 90%），每天 800 次、22 個工作天。',
  },
  AgentLoopLab: {
    predict: '「工具逾時一次」與「工具回傳格式錯誤」都打開、步數上限 10 步、token 預算 1,200 tok：迴圈會走到 done，還是先被步數上限或 token 預算擋下？',
    steps: ['打開兩個故障開關，按 ▶ 播放到結束', '「步數上限」拉到 14 步再播一次，記下最後的 token 用量', '按 ↺ 重播，停在任一個 tool_call 時按「中途中斷」，再按「從 checkpoint 恢復」'],
    observe: '「結束狀態」「步數」「token 用量」三格，以及中斷時 context 累積停在哪一步、恢復後是從哪一步接下去。',
    preset: '兩個故障都開、步數上限 10 步、token 預算 1,200 tok。',
  },
  SemanticLayerLab: {
    predict: '「各科平均候診人數」的三種猜法裡，有幾種和目前的定義一致？關掉「定義：候診人數含 no_show」之後，換成哪一種？',
    steps: ['問題選「各科平均候診人數」，記下每種猜法是 ✓ 還是 ✕，以及右邊定義算出的數字', '關掉「定義：候診人數含 no_show」，再記一次', '問題切到「取消率」，對照指標定義表的「公式」列，寫一句給業務核對的口徑：分子、分母各包含哪些狀態，以哪個日期歸週'],
    observe: '開關前後「和定義一致」的猜法換成哪一個，以及定義表的「公式」列改了哪幾個字。',
  },
  TestQualityLab: {
    predict: '只留 T1、T4、T5 三個標成「假綠燈」的測試，突變體殺死率會是 0% 嗎？如果不是，殺得掉的是哪一種改壞？',
    steps: ['測試組選「AI 第一版」，關掉 T2 與 T3，按「▶ 跑突變測試」', '打開 T2、T3 再跑一次，記下仍存活的突變體各改了哪一行', '切到「補強後」之前，先替每個存活的突變體寫一條會讓它變紅的 assert，再切過去跑一次對照'],
    observe: '殺死率與存活清單；T5 殺得掉的突變體改了哪一行，它對期限與上限這類邊界改動有沒有反應。',
  },
  LoadTestLab: {
    predict: '「每請求佔用連線」從 120 ms 降到 40 ms（例如補了索引），最大吞吐會變成多少、瓶頸資源會換成什麼？飽和點的併發會變大、變小還是差不多？',
    steps: ['預設值下「看哪個指標」選 p95，從併發 1 往上拖「目前級距」，記下 p95 第一次超過目標的併發', '「每請求佔用連線」拉到 40 ms，再拖一次（延遲目標會跟著改，以圖上標的目標為準）', '「worker 數」減到 4，看瓶頸資源與飽和點'],
    observe: '「最大吞吐」「瓶頸資源」「超過延遲目標的併發」三處，以及上限算式第 1、2 行哪一行變成較小的那個。',
    preset: 'worker 8 個、連線池 10 條、每請求 CPU 40 ms、每請求佔用連線 120 ms，慢查詢關閉。',
  },
  K8sDebugLab: {
    predict: '「Running 但連不到」和「Running 但 0/1」兩個情境，get endpoints 都印出 <none>：只能再多下一個指令時，哪個指令的哪一欄分得開這兩種原因？',
    steps: ['情境選「Running 但連不到」，只按 get endpoints 和你選的另一個指令，就作答', '情境換「Running 但 0/1」，同樣只用兩個指令作答', '每個情境寫一行筆記：採用的那一項證據，以及它排除了其餘三個選項中的哪幾個'],
    observe: '「用了幾個指令」與「作答」兩格，以及你手上的兩項證據裡，哪一項在兩個情境中長得不一樣。',
  },
  XssCsrfLab: {
    predict: '只打開「HttpOnly cookie」，留言裡的 script 還能不能用受害者的登入狀態送出請求？只打開「CSP」呢？',
    steps: ['情境選 XSS，只開「HttpOnly cookie」，讀 Console 與「這次的結果」', '改成只開「CSP」，「輸出位置」在「HTML 內文」與「HTML 屬性值」各看一次', '情境切到 CSRF，SameSite 選 Lax，再打開「CSRF token」，看「是哪一道擋下的」', '整理成一張表：每道防線擋下哪個情境，對另一個情境為什麼沒有作用'],
    observe: 'Console 的最後一行，以及「是哪一道擋下的」與底下「後面還有」列出的防線。',
  },
  CryptoLab: {
    predict: '雜湊模式下，攻擊者改了訊息、也重算了摘要，接收方驗得出來嗎？同樣改一個字換成 HMAC 呢？',
    steps: ['工具選「雜湊」，打開「竄改訊息一個字」與「攻擊者連摘要一起重算」', '工具換成「HMAC」，打開「竄改訊息一個字」，再打開「換一把金鑰來驗」', '工具換成「簽章」，打開「換一把金鑰來驗」', '寫下 HMAC 與簽章的驗證者手上各有什麼，拿著它能不能產生一份新的有效 MAC 或簽章'],
    observe: '接收方那一欄的驗證結果，以及「四種工具各提供什麼」表的「來源驗證」「不可否認」「金鑰」三欄。',
  },
  SupplyChainLab: {
    predict: '事件選「lock 檔沒進版控」，只打開「CI 用鎖定安裝」、不打開「lock 檔進版控」，這次 CI 會裝到 poolman 0.8.2、0.8.3，還是別的結果？',
    steps: ['事件選「lock 檔沒進版控」，防線只開「CI 用鎖定安裝」，按「安裝依賴」播到最後', '再打開「lock 檔進版控（版本＋雜湊）」，重跑一次', '事件換成「名稱相近的假套件」，維持這兩道防線重跑；再打開「建置時產生 SBOM」，記下要通知的服務'],
    observe: '「這次安裝的結果」「被攔下的位置」兩格，以及四個階段裡第一個出現「攔下」或「出事」的是哪一步。',
  },
  DeployStrategyLab: {
    predict: '打開「這版含資料庫 schema 變更」、migration 寫法選「直接改欄位名」、新版沒有 bug：blue-green 在 green 還沒接流量的那一步，受影響請求比例是多少？',
    steps: ['策略選 blue-green，打開「這版含資料庫 schema 變更」，migration 寫法選「直接改欄位名」，用 → 一步步走', '策略換 rolling、canary 各走一次，記下每一步的「受影響請求比例」', 'migration 寫法改成「expand–contract」，三種策略再各走一次'],
    observe: '第一次換步時的錯誤率曲線，以及「回滾時間」那格的備註在兩種 migration 寫法下的差別。',
    preset: '新版沒有 bug、含 schema 變更；三種策略各走一次。',
  },
  TraceLab: {
    predict: '情境選「沒傳遞 trace context」：用 API 那條 trace 的 id 過濾 log，notify-svc 的日誌會不會出現？「最慢的 span」會指到哪個服務？',
    steps: ['情境選「沒傳遞 trace context」，依序按「① 跳到 p95 尖峰（10:18）」「② 選最慢的 span」「③ 用這個 trace id 過濾 log」', '在瀑布圖點「另一條 trace」裡的 span，看它的 trace id 與「父 span」', '把 log 面板的 trace_id 換成那條 trace 的 id 再過濾，寫下少了哪一個證據就接不起這兩條 trace'],
    observe: '「span 數」與「有帶 trace id 的日誌」兩格的備註，以及瀑布圖斷開的位置。',
  },
  WikiGraphLab: {
    predict: '在「交易」頁刪掉 [[鎖]] 這個連結之後，從「隔離等級」到「死結」還找得到路徑嗎？「鎖」會變成孤兒頁嗎？',
    steps: ['編輯頁面選「交易」，在文字框把「[[鎖]]」改成純文字「鎖」', '找路徑維持「隔離等級 → 死結」，看最短路徑與 lint 報告', '點圖上的「鎖」節點看反向連結；再把那段改成 [[鎖|列鎖]]，比較圖有沒有恢復'],
    observe: '最短路徑那一行、lint 報告的孤兒頁，以及「鎖」的反向連結還剩誰。',
  },
  NetworkPolicyLab: {
    predict: 'db-from-api 的 from 改成「多一個 namespaceSelector: {}」之後，「可疑 Pod → db」會被放行嗎？原本該通的「api → db」與「web → api」會不會跟著變？',
    steps: ['連線選「api → db」，記下結果與決定它的 policy；再依序選「可疑 Pod → db」「web → api」各記一次', '「db-from-api 的 from」改成「多一個 namespaceSelector: {}」，三條連線再各看一次', '把三條連線在兩種 from 寫法下的結果列成兩欄，標出哪幾條是合法服務該通的'],
    observe: '「這條連線」的結果，以及「目的 ingress」那一段寫出是哪一條 policy 放行或擋下。',
    preset: 'default deny ingress、default deny egress、允許 api → db:5432 打開，其餘關閉。',
  },
  RenderPipelineLab: {
    predict: '「改 width」與「改 transform」各要重跑七段裡的哪幾段？Toast 原本沒有自己的合成層時，改 transform 的答案會變嗎？',
    steps: ['情境依序選「改 color」「改 width」「改 transform」「新增節點」，各按「重播」，記下標「重跑」與「跳過」的階段', '情境「改 transform」時關掉「Toast 已經有自己的合成層」，再按「重播」', '在 Chrome 開任一頁，DevTools 的 Performance 分頁錄製時到 Elements 分頁改一個元素的 width；再錄一次改 transform。拿錄到的事件對照「首次載入」每一段下方小字的事件名稱'],
    observe: '模擬器標「跳過」的階段，在你的錄製裡是不是也沒有出現對應的事件（特別是 Layout 與 Paint）。',
  },
  ApiStatesLab: {
    predict: '回應選「403」與「500」時，錯誤畫面各會不會出現「重試」按鈕？競態實驗沒開 AbortController 時，A 晚到之後清單有幾筆？',
    steps: ['實驗選「四種狀態」，回應依序選「403」「500」「逾時」，每次按「送出請求」', '實驗換「競態」，用 → 一步步走到「A 回來」，記下搜尋框與清單', '打開「用 AbortController 取消前一個請求」再走一次'],
    observe: '錯誤畫面上的按鈕、「網路」表那一列的狀態，以及競態最後一步清單和搜尋框是否一致。',
  },
  EventPropagationLab: {
    predict: '列的監聽用「ul 委派」、點「取消」按鈕、按鈕呼叫 stopPropagation()：logClick、closeMenus、openDetail 哪幾個會執行？表單會不會送出？',
    steps: ['「點哪裡」選「取消」按鈕那一項，「列的監聽」選「ul 委派」，打開「取消鈕呼叫 stopPropagation()」，按 ▶ 播放到最後', '關掉 stopPropagation，改開「取消鈕呼叫 preventDefault()」再播一次', '「列的監聽」換「ul 委派＋排除按鈕」，兩個開關都關掉，再播一次'],
    observe: '「已執行的監聽」表、「預設動作：送出表單？」那一格，以及 Drawer 與 closeMenus 的狀態列。',
  },
  GridLab: {
    predict: '卡片只剩 2 張、容器 820px：auto-fill 與 auto-fit 各排成幾欄、每張卡多寬？',
    steps: ['版面選「卡片網格」，grid-template-columns 選 auto-fill，「卡片數」拉到 2 張', '改選 auto-fit，比較格線編號與每欄寬度', '版面換「命名區域」，先在紙上把手機版（header、main、side、foot 疊成一欄）寫成 grid-template-areas 字串，再選「手機」對照「目前的 CSS」', '選「無效（不是長方形）」，看區域被放到哪裡'],
    observe: '格線上方的每欄寬度，以及「無效」寫法下狀態列寫的 computed 值。',
    preset: '容器 820px、gap 16px、minmax 下限 240px、卡片 2 張。',
  },
  EventLoopLab: {
    predict: '範例「Vue nextTick」：Console 的兩行各印出幾？畫面在 0 和 3 之間會不會出現 1 或 2？',
    steps: ['範例選「Vue nextTick」，先在紙上排出 call stack、microtask queue 與渲染的先後，再用 → 單步走到最後', '範例換「長任務」，關掉「先讓出主執行緒」，按 ▶ 播放，看「處理中…」有沒有畫出來', '打開「先讓出主執行緒」，「迴圈時間（示意）」拉到 1000 ms，再播一次'],
    observe: '「主執行緒的時間線」上渲染出現的位置，以及畫面欄的「DOM 已經是…，還沒畫出來」出現在哪幾步。',
  },
  UiStatesLab: {
    predict: '用鍵盤 Tab 到「確認掛號」、一秒內連按三次 Enter，「已送出」會是幾次？送出中與送出後，焦點還在按鈕上嗎？',
    steps: ['元件選「按鈕」、狀態選「default」，用 Tab 移到「確認掛號」，一秒內連按三次 Enter', '等按鈕變回「確認掛號」，改用滑鼠連點三次', '元件換「Dialog」，只用鍵盤開啟再關閉，記下焦點紀錄'],
    observe: '「已送出」的次數，以及「瀏覽器目前判定」的 :focus、:focus-visible、:disabled 在送出中與送出後的變化。',
  },
  ReactivityLab: {
    predict: '在「手機」欄位輸入一個數字，三個 computed 裡哪幾個會重算？五個元件裡哪幾個會重新渲染？',
    steps: ['寫法選「正確寫法」，按「重設」，在「手機」欄位輸入一個數字', '點科別「骨科」，再點一個時段', '寫法換「錯誤：解構 reactive」，按「重設」後在「姓名」欄位打字'],
    observe: '每個 computed 的「算了 ×N」、每個元件的「渲染 ×N」，和「這一次更新」列出的被通知者是否一致。',
  },
  VitalsLab: {
    predict: '其他設定不動，只把主圖載入改成 fetchpriority=high，LCP 會進到「良好」嗎？CLS 會跟著變嗎？',
    steps: ['按「回到初始狀態」，主圖載入選「fetchpriority=high」', '再寫上「主圖寫了 width、height」，公告橫幅選「預留空間」，記下三個指標', '在 Chrome 開本站任一頁，DevTools 的 Performance 分頁看 Local metrics，CPU 與網路節流各選一檔，重新整理一次，記下 LCP、CLS 與條件'],
    observe: '每一步 LCP、CLS 的數字與評等，以及你的錄製和模擬器的數字差多少、差在哪個條件。',
  },
  BundleLab: {
    predict: '打開懶載入之後，只改 TodayView.vue 一行再建置，有幾個檔名的 hash 會換？只有 TodayView 所在的 chunk 嗎？',
    steps: ['打開「掛號、報表、管理頁懶載入」，「改一行再建置」選「TodayView.vue」，記下標「改名」的檔案', 'vendor 選「vue、router、pinia」再看一次', '「改一行再建置」換成「升級 pinia」再看一次', '寫下：部署前就開著頁面的人，部署後才點「報表」，瀏覽器會要哪個檔名；伺服器若只留新版檔案會發生什麼'],
    observe: '每個 chunk 上的「改名」標記與「改完回訪要重新下載」的大小。',
  },
  OverlayLab: {
    predict: '原生做法下先開「篩選 ▾」再按「取消預約」，篩選還開著嗎？再推播 Toast 之後按一次 Esc，關掉的是哪一個？',
    steps: ['做法選「原生（top layer）」，依序按「篩選 ▾」「取消預約」「推播 Toast」', '按「按 Tab」三次，再按「按 Esc」兩次，每次記下「目前的狀態」的焦點與「Esc 會關掉」', '按「全部關閉」，做法換「div + z-index」並打開「main 有 transform」，重複同樣的操作'],
    observe: '「紀錄」列出的每一步，以及「圖層（上 → 下）」裡 Toast 和 Dialog 的上下順序。',
  },
}

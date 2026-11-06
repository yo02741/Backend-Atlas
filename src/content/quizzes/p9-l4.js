// 題庫：P9 新課（l4 批）——semantic-layer / finops / aiops / event-driven
export default [
  {
    skill: 'semantic-layer',
    questions: [
      {
        q: 'agent 看到 `registrations` 表有 `cancelled_at` 欄位，就用 `COUNT(cancelled_at)` 算取消數。這種做法最根本的問題是什麼？',
        options: ['COUNT 遇到 NULL 會報錯，應該改用 SUM', '「取消」的業務定義（排除作廢單、取消後又報到的怎麼算）不在欄位名裡，只靠猜會算錯而且沒人發現', 'cancelled_at 是時間型別，不能拿來計數', '只要再加上 is_test 的條件，猜的版本就和正式定義一樣'],
        answer: 1,
        explain: '欄位名只說明「存了什麼」，不說明「業務上怎麼算」。作廢單算不算、取消後又報到的算不算，這些規則在負責人腦中或某份報表的 SQL 裡，所以要寫成定義層讓 agent 查。COUNT 會略過 NULL 而不是報錯；只補 is_test 仍漏掉作廢單與「取消後又報到」的情況。',
      },
      {
        q: '指標 view 如下。要算「全院」的取消率，哪個查詢是對的？',
        code: "CREATE VIEW m_registrations AS\nSELECT visit_date, dept_code,\n       COUNT(*) AS registrations,\n       COUNT(*) FILTER (WHERE status = 'cancelled') AS cancellations\nFROM registrations\nWHERE status <> 'void' AND NOT is_test\nGROUP BY visit_date, dept_code;",
        lang: 'sql',
        options: ['SELECT SUM(cancellations)::numeric / SUM(registrations) FROM m_registrations;', 'SELECT AVG(cancellations::numeric / registrations) FROM m_registrations;', 'SELECT COUNT(cancellations) / COUNT(registrations) FROM m_registrations;', 'SELECT MAX(cancellations::numeric / registrations) FROM m_registrations;'],
        answer: 0,
        explain: '比率要先分別加總分子與分母再相除。直接 AVG 每組的比率，會讓掛號只有 2 筆的科別和掛號 200 筆的科別權重一樣。COUNT 算的是列數（每組一列），不是加總；MAX 只取最大的那一組。這也是 view 只放分子分母、不先算好比率的原因。',
      },
      {
        q: '團隊想讓 agent 回答門診量相關問題，但還沒有預算導入語意層產品。最務實的第一步是？',
        options: ['給 agent 完整的資料庫讀取權限，再在提示詞裡描述每個欄位的意思', '先導入 Cube 或 dbt 的 semantic layer，等工具上線再開始定義指標', '先停用 agent，等資料治理全部完成再說', '用資料庫 view 實作常用指標，搭配一張記錄名稱、公式、來源、粒度、維度、負責人的指標清單，agent 帳號只授權查這些'],
        answer: 3,
        explain: '最小實作是 view 加指標清單：公式與排除條件寫在 view 裡只寫一次，清單讓 agent 和人都查得到定義，權限只開放 view。提示詞描述欄位仍是讓模型猜；工具只是讓定義更好管理，不會替你決定作廢單算不算；治理很重要，但不必等它全部完成才開始定義最常用的幾個指標。',
      },
    ],
  },
  {
    skill: 'finops',
    questions: [
      {
        q: '一個 agent 每次工作跑很多輪，每一輪都把系統提示、工具定義與完整的對話歷史送出去。輪數變成兩倍時，輸入 token 大致會怎樣？',
        options: ['剛好變兩倍，因為每輪送出的量固定', '不變，因為 context 有上限，模型會自動忽略多的部分', '超過兩倍：每一輪都帶著前面所有輪的歷史，歷史部分隨輪數平方成長', '變成一半，因為 prompt 快取會自動生效'],
        answer: 2,
        explain: '第 t 輪的輸入包含前面 t 輪累積的歷史，加總是等差級數，所以歷史的部分大約隨輪數平方成長。context 上限要自己設（截掉或摘要舊歷史），模型不會替你省錢；prompt 快取只對不變的前綴有效，而且通常要前綴完全相同才命中。',
      },
      {
        q: '下面的估算程式要比較不同方案。從 FinOps 的角度看，它最需要改的地方是？',
        code: 'def cost(input_tokens, output_tokens):\n    # 照官網價格寫死\n    return input_tokens * 0.000003 + output_tokens * 0.000015',
        lang: 'python',
        options: ['單價應該是參數或設定值，不是寫死在程式裡；價格會變、不同方案不同', '應該改用 Decimal，浮點數誤差會讓帳單差很多', '輸出 token 不用算，只有輸入會計費', '應該把 input 和 output 合併成總 token 數再乘一個單價'],
        answer: 0,
        explain: '價格會調整、不同模型與方案不同，寫死的單價會讓估算悄悄過時，也無法比較方案。估算的價值在於結構（輪數、快取比例、context 上限），單價由使用者填入。浮點誤差相對於估算的不確定性很小；輸入與輸出通常分開計價且單價不同，不能合併。',
      },
      {
        q: '公司的雲端帳單一個月比一個月高，但沒有人知道多出來的是哪個服務。依 FinOps 的順序，第一件事該做什麼？',
        options: ['立刻把所有機器的規格降一級', '簽三年的承諾用量合約換折扣', '把測試環境全部刪掉', '替資源補上 team、service、env 標籤，匯出帳單明細並設預算告警，先讓花費對得到人'],
        answer: 3,
        explain: 'FinOps 的順序是看得見 → 分攤 → 優化。對不到人的成本沒有人能判斷該不該花。盲目降規格可能造成效能事故；用量還不清楚就簽長約，用不到的部分照付；刪測試環境也許該做，但要先知道它佔多少、誰在用。',
      },
    ],
  },
  {
    skill: 'aiops',
    questions: [
      {
        q: '要確保調查告警的 agent 不會自己執行回滾或重啟，最可靠的做法是？',
        options: ['在系統提示詞裡用粗體寫「絕對不要執行任何變更」', '在工具層強制：agent 的帳號只有唯讀權限，變更類工具不提供，或呼叫時被攔下轉成待核准的建議', '讓 agent 每次執行變更前先問自己一次是否必要', '只在白天讓 agent 有變更權限，晚上收回'],
        answer: 1,
        explain: '提示詞是建議，不是權限：模型偶爾還是會呼叫，日誌或工具結果裡被注入的文字也可能誘導它。把限制放在帳號權限與工具閘道，才不依賴模型的判斷。自我檢查同樣是模型判斷；依時段開關權限沒有解決「誰核准」的問題。',
      },
      {
        q: 'agent 的調查報告如下。哪一點最需要改？',
        code: '{\n  "summary": "api 錯誤率升高",\n  "root_cause": "v2.31.0 部署造成",\n  "action": "已建議回滾"\n}',
        lang: 'json',
        options: ['summary 太短，應該寫成一整段完整的分析', 'JSON 格式不適合給人看，應該改成純文字', '缺少證據（查了什麼、看到什麼）且只給單一確定的原因；部署與錯誤時間相近只代表相關，應列出多個可能原因並標明不確定', 'action 應該改成「已執行回滾」，省下人工核准的時間'],
        answer: 2,
        explain: '沒有證據，人只能全信或全不信；把「時間吻合」寫成確定的根本原因，會讓人跳過其他可能（例如下游剛好也出事）。好的格式是摘要、可重現的證據、排序過的多個可能原因、標明是否需要核准的建議動作。summary 短沒問題；結構化格式反而方便呈現；自動回滾正是要避免的。',
      },
      {
        q: '導入 AIOps agent 三個月後，主管問「它到底有沒有用」。下面哪組量測最能回答？',
        options: ['agent 每天產生的報告數量與平均字數', 'agent 呼叫了多少次工具、用了多少 token', 'on-call 的主觀滿意度問卷', '誤報率與漏報率（由 on-call 標記每則調查結果）、告警到確認的平均時間、建議動作被採用的比例'],
        answer: 3,
        explain: '要衡量的是「它是否讓人更快、更準地處理告警」：誤報、漏報、平均確認時間與建議採用率直接對應這件事，其中漏報最危險。報告數量與字數只代表產出多，不代表有用；工具呼叫與 token 是成本面；滿意度可以參考但不夠客觀。',
      },
    ],
  },
  {
    skill: 'event-driven',
    questions: [
      {
        q: '訂單服務「先 commit 訂單、再送事件到 broker」。服務在兩步之間被重啟，會發生什麼？',
        options: ['訂單已寫入，事件沒送出，下游永遠不知道這筆訂單付款了', 'broker 會自動從資料庫補送事件', '資料庫會 rollback 訂單，因為事件沒送成功', '下游收到一個不存在的訂單事件'],
        answer: 0,
        explain: '資料庫和 broker 是兩個系統，commit 之後資料庫不會因為事件沒送而 rollback，broker 也不知道有事件該送，這是「丟事件」。「下游收到不存在的訂單事件」是反過來先送事件、再 commit 失敗時的幽靈事件。outbox 讓事件和訂單在同一個交易寫入，兩種失敗都避免。',
      },
      {
        q: '消費端用下面的 SQL 處理事件。這段寫法的關鍵優點是什麼？',
        code: "WITH claim AS (\n  INSERT INTO processed_events (event_id) VALUES ($1)\n  ON CONFLICT (event_id) DO NOTHING\n  RETURNING event_id\n)\nUPDATE points SET balance = balance + $2\nFROM claim WHERE user_id = $3;",
        lang: 'sql',
        options: ['讓 broker 不再重送同一個事件', '去重紀錄與加點數在同一句（同一個交易）裡：重送時 claim 是空的，UPDATE 0 列；不會出現「記了但沒加」或「加了但沒記」', '讓事件依照送出順序處理', '把 at-least-once 變成 broker 端的 exactly-once'],
        answer: 1,
        explain: '冪等的關鍵是去重與效果原子地一起成立。分成兩個交易時，中間掛掉就會漏加或重複加。這段 SQL 不會改變 broker 的行為：重送照樣發生、順序也不保證，它只是讓消費端對重送免疫。',
      },
      {
        q: '同一張訂單會依序產生 paid、shipped、delivered 事件，消費端偶爾看到 shipped 比 paid 先到。在 Kafka 這類以分區保序的系統裡，應該怎麼做？',
        options: ['把 topic 的分區數加大，讓事件處理得更快就不會亂序', '消費端收到事件後 sleep 幾秒再處理，等前面的事件到', '用訂單編號當分區鍵，讓同一張訂單的事件進同一個分區；消費端再用版本號丟掉比目前狀態舊的事件', '改用時間戳排序，各台主機的時鐘足夠準確'],
        answer: 2,
        explain: '順序只在同一個分區內成立，所以同一個 aggregate 要用同一個分區鍵；重試等情況仍可能亂序，消費端用版本號（WHERE version < 新版本）容忍。加分區不保證順序，還可能讓鍵重新分配；sleep 只是降低機率；多台主機的時鐘不可信，見分散式基礎。',
      },
    ],
  },
]

// 題庫：P9 新課（l1 批）：test-quality、acceptance-design、architecture-tests、harness-engineering
export default [
  {
    skill: 'test-quality',
    questions: [
      {
        q: '一個模組的測試行覆蓋率是 100%、全部通過。這能推論出什麼？',
        options: [
          '每一行程式在測試中至少被執行過一次，但不代表算錯時會有測試失敗',
          '每一行程式的結果都至少被一個斷言檢查過，只是邊界案例可能還沒測到',
          '程式沒有 bug，剩下的風險只來自整合環境與設定差異',
          '突變分數也會是 100%，因為每個可能被突變的地方都有測試跑過',
        ],
        answer: 0,
        explain: '覆蓋率工具記錄的是「哪些行被執行」，不看有沒有斷言、斷言檢查了什麼。只呼叫不 assert 的測試一樣能拿到 100%。所以它推不出「結果被檢查過」，更推不出沒有 bug；突變分數量的是改壞之後測試會不會紅，跑過不代表會紅，兩者常差很多。',
      },
      {
        q: '這個測試要確認負數金額會被拒絕。它的問題是什麼？',
        code: `def test_negative_subtotal():
    try:
        shipping_fee(-1, member=False)
    except ValueError:
        pass`,
        lang: 'python',
        options: [
          '沒有問題：有拋 ValueError 就會進 except，測試正確地驗證了例外',
          '應該捕捉 Exception 而不是 ValueError，否則其他例外會讓測試失敗',
          'shipping_fee 沒拋例外時測試也會通過，等於沒有驗證；應改用 pytest.raises',
          '測試名稱沒有寫出期望的行為，改名成 test_negative_raises 就能解決',
        ],
        answer: 2,
        explain: 'try 區塊裡的呼叫若正常回傳，不會進 except，函式結束，測試照樣通過——拿掉 raise 的突變體會存活。要用 with pytest.raises(ValueError): 或 assertRaises，沒拋例外時才會失敗。改捕捉 Exception 只會讓它更寬鬆；改名稱不改變它什麼都沒驗的事實。',
      },
      {
        q: '團隊對訂單金額模組跑突變測試，報告列出「第 42 行 `>=` 改成 `>` 的突變體存活」。接下來最合理的做法是？',
        options: [
          '把第 42 行改成 `>`，因為測試沒有區分兩者，代表兩種寫法都符合規格',
          '對照規格確認門檻行為，補一個剛好落在門檻值上的測試案例，讓這個突變體被殺',
          '在工具設定排除第 42 行，存活的突變體大多是等價突變體，不值得處理',
          '提高覆蓋率門檻到 100%，覆蓋率夠高時這類突變體會自然被殺掉',
        ],
        answer: 1,
        explain: '存活代表「把這裡改壞，沒有任何測試發現」，最常見的原因是邊界值沒被測到；補一個踩在門檻上的案例通常就能殺掉它，期望值要從規格來。測試沒區分不代表規格沒區分，直接改程式是本末倒置。等價突變體確實存在，但要逐一確認行為真的相同才略過；覆蓋率早就跑過這一行了，提高門檻不會增加任何斷言。',
      },
    ],
  },
  {
    skill: 'acceptance-design',
    questions: [
      {
        q: '為什麼驗收不該由寫程式的同一個 agent 在同一個 session 裡自己判定？',
        options: [
          '同一個 agent 的 token 預算有限，留給驗收的 context 不夠完整',
          '它對需求的誤解會同時出現在程式與它寫的檢查裡，而且它能改測試、加 skip 讓檢查變綠',
          '模型的規範要求生成與評估必須由不同的 API 金鑰執行',
          '自己驗證的結果無法寫進 CI 的報告格式，平台不會採計',
        ],
        answer: 1,
        explain: '產出者驗證自己的結構性問題是：同一份理解同時產生實作和檢查，誤解會讓兩者一致地錯；agent 還能在同一個 session 裡修改測試或設定，讓檢查變綠。所以驗收要由輸入不受產出者影響的流程執行（CI job、全新 context 的 review agent、人）。預算、金鑰、報告格式都不是核心原因。',
      },
      {
        q: '下面是一張票的驗收清單草稿。哪一條最需要改寫？',
        code: `must:
  - test_cancel_past_appointment_409 通過
  - ruff check 0 錯誤
  - 程式碼要容易維護
forbid:
  - tests/spec/ 下的檔案不得出現在 diff`,
        lang: 'yaml',
        options: [
          '「ruff check 0 錯誤」：lint 屬於品質閘門，不應出現在驗收清單',
          '「tests/spec/ 不得出現在 diff」：禁止條款太嚴，會擋到必要的測試修正',
          '「test_cancel_past_appointment_409 通過」：應該寫成「所有測試通過」才完整',
          '「程式碼要容易維護」：沒有機器能判定的方法，要改寫成具體檢查或標成人工驗收',
        ],
        answer: 3,
        explain: '驗收清單的每一條都要能被判定。「容易維護」沒有判定方法，要嘛換成可檢查的條件（例如函式複雜度上限、lint 規則），要嘛明確標成人工驗收。列出具名測試比「所有測試通過」更好，後者擋不住刪測試；不得改規範測試正是常用的禁止條款，規範要改應由人決定；lint 放在清單裡也沒問題。',
      },
      {
        q: '驗收檢查器讀 JUnit 報告時，清單要求的 `test_cancel_twice_is_idempotent` 在報告裡找不到。檢查器應該怎麼判？',
        options: [
          '判為沒通過：清單要求的測試沒跑到，就沒有證據證明這條完成了',
          '略過這一條：報告裡沒有的測試無法判定，應由人工補驗',
          '判為通過：報告的 failures 是 0，代表沒有任何測試失敗',
          '先判為通過並發出警告，等下一次 pipeline 再確認',
        ],
        answer: 0,
        explain: '「做完了」需要證據，找不到測試等於沒有證據——測試可能被刪、改名或根本沒寫。檢查器要 fail closed：缺少的、被 skip 的、不認識的條目一律判為沒通過。用 failures=0 判通過正是 agent 刪掉或跳過測試後還能全綠的漏洞；略過或延後都會讓沒完成的工作合併進去。',
      },
    ],
  },
  {
    skill: 'architecture-tests',
    questions: [
      {
        q: '規範檔已經寫明「service 不得 import handler」，為什麼還要寫成架構測試？',
        options: [
          '規範檔只有人看得到，agent 不會讀取 repo 裡的 markdown 檔案',
          '寫成測試後可以刪掉規範檔，避免同一條規則存在兩個地方',
          '規範檔是 agent 的輸入，違反時不會有任何東西變紅；測試在每次 CI 都檢查，違反就擋下合併',
          '架構測試能讓模型在生成程式碼時自動避開違規的 import',
        ],
        answer: 2,
        explain: '規範檔會被 agent 讀到、大多時候也會遵守，但沒有任何機制保證每一次都遵守，違反時也沒有回饋。測試把規則變成約束：違反就紅燈、合不進去。規範檔仍然要保留，用來說明為什麼與例外怎麼申請；測試不會影響模型生成，它是事後檢查。',
      },
      {
        q: '分層規則是 `["app.handlers", "app.services", "app.repositories"]`（由上往下，下層不得 import 上層）。哪一個 import 違規？',
        code: `# app/handlers/orders.py
from app.services.orders import place_order
# app/services/orders.py
from app.repositories.orders import OrderRepository
# app/repositories/orders.py
from app.services.pricing import quote
# app/services/pricing.py
from decimal import Decimal`,
        lang: 'python',
        options: [
          'app/handlers/orders.py import app.services.orders',
          'app/services/orders.py import app.repositories.orders',
          'app/services/pricing.py import decimal',
          'app/repositories/orders.py import app.services.pricing',
        ],
        answer: 3,
        explain: '上層可以依賴下層：handler → service、service → repository 都是允許的方向。repository 是最下層，它 import service 就是往上依賴，會造成循環並讓 repository 無法單獨測試。decimal 是標準函式庫，不屬於任何層，不受分層規則限制。',
      },
      {
        q: '要用 import-linter 的 forbidden contract 禁止 app.services import fastapi，除了寫 contract，設定還需要什麼？',
        options: [
          '在頂層設定打開 include_external_packages，讓第三方套件被納入 import 圖',
          '把 fastapi 加進 layers contract 的最上層，forbidden contract 才能引用它',
          '在每個 service 檔案開頭加上註解標記，告訴 import-linter 要檢查哪些 import',
          '另外安裝 fastapi 的 import-linter 外掛，第三方套件各自需要對應的外掛',
        ],
        answer: 0,
        explain: 'import-linter 預設只分析 root package 內部的模組；contract 要涵蓋 fastapi 這類外部套件，需要在頂層設定打開 include_external_packages。forbidden contract 本來就能直接列出外部套件，不需要放進 layers；import-linter 從原始碼解析 import，不靠檔案註解，也沒有逐套件的外掛。',
      },
    ],
  },
  {
    skill: 'harness-engineering',
    questions: [
      {
        q: '把溫度設成 0 之後，同一個 prompt 仍然偶爾得到不同的輸出。下列說法哪個正確？',
        options: [
          '溫度 0 保證輸出完全相同，出現差異代表 API 回傳了快取結果',
          '溫度 0 不保證完全相同，而且 context、工具回傳、模型版本等其他來源也可能不同，要先比對實際送出的請求',
          '溫度 0 只影響輸出長度，不影響內容，所以本來就會不同',
          '出現差異一定是模型版本被更新了，應該立刻換回上一版模型',
        ],
        answer: 1,
        explain: '溫度 0 會讓取樣盡量選最高機率的 token，但伺服器端的批次與浮點運算仍可能造成差異；更常見的是輸入本身不同：檢索結果、對話歷史、工具回傳、日期。排查第一步是 diff 兩次實際送出的完整請求。快取、只影響長度的說法都不對；版本更新是可能原因之一，但不是唯一。',
      },
      {
        q: '某個評測案例單次正確率約 40%，最常見的錯誤答案出現率約 60%，而且格式完全合法。對它加上「格式驗證失敗才重試」或「呼叫 5 次取多數決」，結果會如何？',
        code: `# 單次：40% 正確（REFUSE），60% 錯誤（ANSWER）
FORMAT = r"REFUSE|ANSWER"     # harness 的格式驗證器`,
        lang: 'python',
        options: [
          '兩者都會明顯提升正確率，多數決的效果大於重試',
          '重試會提升到接近 80%，多數決則維持 40% 左右',
          '重試幾乎沒有效果，多數決反而會讓正確率下降',
          '兩者都沒效果，但多數決至少不會讓結果變差',
        ],
        answer: 2,
        explain: '錯誤答案通過格式驗證，重試根本不會觸發，正確率維持約 40%。多數決會選出最常出現的答案，而最常出現的是錯的，取越多次越常選到錯誤答案（模擬約 30%）。這類案例要改 prompt、拆任務，或把判斷移到模型外面（例如用規則先偵測個資）。',
      },
      {
        q: '改了分類 prompt 之後，評測集的整體通過率從 82% 變成 82%。可以直接合併嗎？',
        options: [
          '不行，要先換一個評分模型重跑，確認分數不是評分器造成的',
          '可以，通過率沒變代表改動沒有影響，風險為零',
          '可以，但要把溫度調高再跑一次，確認在隨機性較高時也穩定',
          '還不能，要看逐案例的差異：可能修好幾個、弄壞幾個而互相抵銷',
        ],
        answer: 3,
        explain: '回歸比對要看每個案例從過變不過、從不過變過，而不是只看總數；總數相同可能藏著弄壞的關鍵案例。每個案例也應跑多次，區分真正的回歸與原本就不穩定。換評分模型或調高溫度都沒有回答「這次改動弄壞了哪些案例」。',
      },
    ],
  },
]

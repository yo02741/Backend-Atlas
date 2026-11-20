// 領域內文（d10-ai，P9 新課）：以技能 id 為 key，由 body/d10-ai.js 合併。只放這些技能：acceptance-design, architecture-tests, harness-engineering
export default {
  'acceptance-design': {
    points: [
      { b: '寫的人不能自己驗', t: '產出程式的 agent 對自己的理解有同樣的盲點：它誤解了需求，寫出的檢查也會照著誤解寫。驗收要由另一個流程執行：CI job、另一個 agent、或人。' },
      { b: '動工前就寫好清單', t: '驗收條件在拆票時寫進票裡，不是做完才補。做完才定標準，標準會被已經做出來的東西牽著走。' },
      { b: '每一條都要機器能判定', t: '「程式碼要乾淨」判定不了；「`ruff check` 0 錯誤」「`tests/spec/` 下的檔案不得修改」「`/appointments/{id}/cancel` 對過去的掛號回 409」判定得了。判定不了的條目要改寫，或明確標成人工驗收。' },
      { b: '「禁止」條款和「必須」一樣重要', t: '不得新增 `skip` / `xfail` / `type: ignore`、不得調低覆蓋率門檻、不得改規範測試的期望值、不得新增相依套件。這些是 agent 為了讓檢查變綠最常走的捷徑。' },
      { b: '「做完了」是檢查輸出', t: 'agent 回報「全部完成」只是宣稱；完成的證據是檢查器的輸出（CI 的 job 結果、報告檔）。檢查器遇到不認識的條目要判為不通過（fail closed）。' },
    ],
    checklist: [
      '能把一張票的需求改寫成一份機器能判定的驗收清單，包含至少兩條「禁止」條款',
      '能說明為什麼驗收要由產出者以外的流程執行',
      '能寫一個檢查器，對交付物回報哪幾條沒過、不認識的條目判為不通過',
    ],
    challenge: {
      task: '換成物流系統的一張票：「收件人可以改派送時段；包裹出貨後不能改，回 409；同一個時段重複送出不報錯。」替它寫 must 與 forbid 清單，套進深入內容的檢查器（[Playground](#/playground?lang=python)）。再準備一份交付（JUnit XML 與 diff），在裡面藏至少一個問題，例如一個 skip 或一行被改過的規範測試。把清單與交付交給一位沒看過實作的人，請他只用檢查器的輸出判定。',
      deliver: '驗收清單、對方跑出的逐條 PASS／FAIL，以及他判定時問過你的問題',
      check: [
        '每條 must 都指名一個測試或一個指令，沒有「測試都通過」這種條目',
        '至少兩條 forbid，而且只看 diff 就能判定',
        '對方不必問你就判定得出每一條；他問過的每個問題，都已經改寫成清單裡的條文',
        '藏的問題被判為 FAIL；清單要求但報告裡找不到的測試也判為沒過',
      ],
      twist: '業務改規則：出貨後 30 分鐘內還能改時段。先預測清單哪幾條要改、forbid 會不會動，再說明哪些條文可以沿用掛號取消那張票的寫法，哪些要跟物流端確認（30 分鐘從掃描出貨算起，還是從裝車算起）。',
    },
    refs: [
      { label: 'GitLab CI/CD YAML 語法', url: 'https://docs.gitlab.com/ci/yaml/' },
      { label: 'GitLab：Merge request approvals', url: 'https://docs.gitlab.com/user/project/merge_requests/approvals/' },
    ],
  },
  'architecture-tests': {
    points: [
      { b: 'Prompt 是建議，測試是規則', t: '規範檔寫「service 不得 import handler」，agent 大多會遵守，但沒有東西保證每一次都遵守。寫成測試，違反就紅燈、MR 合不進去。' },
      { b: '分層規則：只能往下依賴', t: 'handler → service → repository，上層可以 import 下層，下層 import 上層就是違規。用 `ast` 解析 import 就能檢查，不必執行程式碼。' },
      { b: '模組邊界與禁用依賴', t: '領域層不 import `fastapi`、`sqlalchemy`；`orders` 模組不直接 import `billing` 的內部模組，只能透過它公開的介面。這些都能寫成一條條 contract。' },
      { b: '用現成工具', t: 'Python 有 import-linter（設定 `layers`、`forbidden`、`independence` 等 contract，`lint-imports` 指令檢查），Java 有 ArchUnit，JS 有 dependency-cruiser。規則放在 repo、跑在 CI。' },
      { b: '架構圖也由程式碼產生', t: 'C4 模型分四層（System Context、Container、Component、Code）；Structurizr DSL 用文字描述模型再產生圖。圖跟著 repo 改、跟著 review，才不會和程式脫節。' },
    ],
    checklist: [
      '能把專案的分層規則寫成 handler / service / repository 的 contract，並說出哪些 import 會違規',
      '能用 `ast` 寫出檢查 import 方向的測試，讓違規時 CI 失敗',
      '能說出 C4 的四個層次，以及架構圖由程式碼產生的好處',
    ],
    challenge: {
      task: '在 [Playground](#/playground?lang=python) 用深入內容的 `ast` 檢查器，先把 `FILES` 裡原本的違規 import 刪掉，讓輸出是 `0 violation(s)`。接著加一個看起來合理的跨層需求：`app/repositories/orders.py` 要用 `app/services/pricing.py` 裡的 `Money` 型別。做兩個版本：(a) 在規則裡加一條例外，只允許這一個 import；(b) 不開例外，把 `Money` 搬到新的 `app/domain/money.py`。兩個版本都再加一行 `from app.services.pricing import quote` 到 repository，看檢查器抓不抓得到。',
      deliver: '兩個版本各自的違規輸出，以及三句比較：規則改了幾行、之後誰要維護、新加的違規在哪一版被放過',
      check: [
        '(a) 的例外只允許一條「來源模組 → 目標模組」，沒有把整個 `app.repositories` 的分層檢查關掉',
        '說明 (a) 有沒有放過 `quote` 那一行；放過的話，指出是例外的粒度只到模組、沒到名稱',
        '(b) 不需要任何例外，加 `quote` 之前的違規數是 0',
        '寫出你選哪一版，以及什麼條件出現時會改選另一版',
      ],
      twist: '半年後例外清單有 9 條，其中 6 條是同一個 service。先預測這時分層規則還擋得住什麼，再提出一條讓例外不再增加的規則（例如每條例外要附 ADR 編號，或 CI 限制例外的數量）。',
    },
    refs: [
      { label: 'import-linter 文件', url: 'https://import-linter.readthedocs.io/' },
      { label: 'Python ast 模組', url: 'https://docs.python.org/3/library/ast.html' },
      { label: 'The C4 model', url: 'https://c4model.com/' },
      { label: 'ArchUnit', url: 'https://www.archunit.org/' },
    ],
  },
  'harness-engineering': {
    map: {
      names: [
        { n: '非確定性', t: '同一個 prompt 每次結果不同，來源有取樣參數、context 的內容與順序、工具回傳、模型版本、日期與時區；溫度 0 也不保證相同。' },
        { n: '評測集（golden set）', t: '一組有期望結果的固定案例：各類的代表案例、邊界案例、出過事的案例、應該拒絕的案例。期望值由人決定。' },
        { n: '評分器', t: '精確比對、規則（regex、JSON schema、必含字串）、模型評分三種；能用前兩種就不用第三種。' },
        { n: '通過率', t: '同一個案例跑 N 次的正確比例。只跑一次，看不出單次正確率是 95% 還是 70%。' },
        { n: '回歸比對', t: '改動前後用同一份評測集跑，逐案例比對哪些從過變不過；整體通過率會把「修好幾個、弄壞幾個」抵銷掉。' },
        { n: '重試與多數決', t: '重試只救得了驗證器抓得到的錯（例如格式不合法）；多數決只在正確答案是最常出現的那個時有用。' },
      ],
      ask: [
        '固定哪些輸入：prompt 版本、明確的模型版本、取樣參數、context 快照、工具的假資料。',
        '評測集的案例來源與各類的數量，期望值由誰核定。',
        '每個案例跑幾次、通過率門檻多少，哪些案例必須每次都過。',
        '上線時的驗證器檢查什麼（只能用不需要正確答案的規則），不合法時重試幾次、之後回什麼。',
      ],
      prompt: '客服來信分成 `billing`、`account`、`technical` 三類。建一份評測集：每類 20 封代表信、10 封邊界信（空白、混合語言、同時提到兩類）、過去分錯的 15 封，期望標籤由客服主管核定。每封跑 5 次，溫度 0，模型寫完整版本號，檢索結果用固定快照。輸出逐案例的通過率，以及改 prompt 前後的差異表。上線時只驗證標籤是否在三類內，不合法就重試 2 次，仍不合法轉人工。',
      verify: [
        { c: '兩次的輸入是否相同', t: '結果不一樣時，先從 log 取出兩次實際送出的完整請求做 diff（系統提示、歷史、檢索結果、工具定義、參數），多數差異在這裡。' },
        { c: '樣本數', t: '每個案例只跑一次的報告不能下結論；每個案例跑多次，並列出通過率落在中間的不穩定案例。' },
        { c: '逐案例差異', t: '整體通過率沒變時，看哪些案例從過變成不過；任何一個必過案例退步就不能合併。' },
        { c: '重試有沒有效', t: '比較加上重試前後的通過率；幾乎沒變代表錯誤答案的格式是合法的，要加強驗證器或把判斷移出模型。' },
        { c: '評分器本身', t: '精確比對大量失敗、人工看卻是對的，檢查正規化（空白、大小寫、句點）；換了評分模型分數就大變，要固定評分模型的版本。' },
      ],
    },
    points: [
      { b: '非確定性從哪裡來', t: '取樣（溫度、top-p）、context 的內容與順序、工具回傳的結果、模型版本、當下時間與外部資料。溫度設 0 也不保證每次相同，其他來源都還在。' },
      { b: 'harness 是包在模型外面那層', t: '固定輸入（prompt 版本、context、工具的假資料）、評測集、評分器、回歸比對、失敗時重試或攔下。模型換不了，harness 是自己能控制的部分。' },
      { b: '評測集與評分器', t: '評測集（golden set）是一組有期望結果的案例，包含過去出過事的案例。評分器分三種：精確比對、規則（regex、JSON schema、必含 / 禁止字串）、模型評分；能用前兩種就不用第三種。' },
      { b: '跑一次不算數', t: '每個案例跑 N 次看通過率，分出穩定通過、穩定失敗、不穩定。改 prompt 或換模型時比對前後的通過率，而不是看單一次輸出。' },
      { b: '重試與多數決有前提', t: '重試需要一個可靠的驗證器，知道答錯才會重來；多數決只在單次正確率高於錯誤答案時有幫助，正確率低時會把錯誤放大。兩者都要算進成本與延遲。' },
    ],
    checklist: [
      '能列出同一個 prompt 結果不同的五種以上來源，並說出排查順序',
      '能設計一個小型評測集，替每個案例選精確比對、規則或模型評分',
      '能寫一個評測跑器：每個案例跑 N 次、算通過率、列出不穩定的案例',
    ],
    challenge: {
      task: '在 [Playground](#/playground?lang=python) 的模擬裡加一個評測集外的案例 `classify-new`：使用者用評測集沒出現過的寫法來信，單次正確率 0.5，錯誤答案有一個格式不合法、兩個格式合法。把 `TRIALS` 改成 30，換三個不同的種子（例如 `random.Random(1)`、`(2)`、`(3)`）各跑一次，記錄每個案例 single 與 retry 的通過率。',
      deliver: '一張「案例 × 策略 × 種子」的通過率表，每個案例一句判斷：retry 的提升是真的，還是落在種子之間的波動裡',
      check: [
        '新案例的錯誤答案依格式合法與否分開，並算出 retry 能救的上限（只救得了格式不合法的那一部分）',
        '三個種子的數字都列出來，每個案例寫出 retry 與 single 的差距，以及種子之間的差距',
        '至少指出一個 retry 看起來有進步、差距卻小於種子波動的案例',
        '說明要把 `classify-new` 收進評測集時，期望答案由誰決定',
      ],
      twist: '換成物流客服的來信分類（延遲、遺失、改址），驗證器只檢查標籤是不是三類之一。先預測 retry 與 vote 各會不會有幫助，再說明 harness 哪些部分可以直接沿用，哪些要跟客服主管重新確認（例如「改了地址又抱怨延遲」要分哪一類）。',
    },
    refs: [
      { label: 'promptfoo 文件', url: 'https://www.promptfoo.dev/' },
    ],
  },
}

// 領域內文（d10-ai，P9 新課）：以技能 id 為 key，由 body/d10-ai.js 合併。只放這些技能：acceptance-design, architecture-tests, harness-engineering
export default {
  'acceptance-design': {
    points: [
      { b: '寫的人不能自己驗', t: '產出程式的 agent 對自己的理解有同樣的盲點：它誤解了需求，寫出的檢查也會照著誤解寫。驗收要由另一個流程執行——CI job、另一個 agent、或人。' },
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
    refs: [
      { label: 'import-linter 文件', url: 'https://import-linter.readthedocs.io/' },
      { label: 'Python ast 模組', url: 'https://docs.python.org/3/library/ast.html' },
      { label: 'The C4 model', url: 'https://c4model.com/' },
      { label: 'ArchUnit', url: 'https://www.archunit.org/' },
    ],
  },
  'harness-engineering': {
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
    refs: [
      { label: 'promptfoo 文件', url: 'https://www.promptfoo.dev/' },
    ],
  },
}

// 領域 7：CI/CD 與交付（GitHub Actions、GitLab CI） — 技能內文：重點 points / 自我檢核 checklist / 延伸閱讀 refs；索引在 ../d7-cicd.js
export default {
  'git-workflow': {
    points: [
      { b: '分支活不過幾天', t: '功能拆小、常合回 main；長分支 = 大衝突 + 難 review。未完成的功能用 feature flag 藏起來。' },
      { b: 'main 受保護', t: '禁止直接 push、必須 PR、CI 綠燈、至少一人 review。這是 CD 能自動部署 main 的前提。' },
      { b: 'commit 訊息是給未來的自己', t: '`fix(auth): reject expired refresh tokens` 這種格式（Conventional Commits）能自動產 changelog；一個 commit 做一件事，能單獨 revert。' },
      { b: 'rebase 還是 merge', t: '本機整理用 rebase、合進 main 用 squash 或 merge——團隊選一種寫進規範。共享分支不 force push。' },
    ],
    checklist: [
      '能說出 trunk-based 與 Git Flow 的差別與適用情境',
      'main 分支有保護規則且 CI 是必要檢查',
    ],
    refs: [
      { label: 'Pro Git（線上書）', url: 'https://git-scm.com/book/en/v2' },
    ],
  },
  'ci-pipeline': {
    points: [
      { b: '兩邊的對照', t: 'workflow ↔ pipeline、job ↔ job、step ↔ script、`on:` ↔ `workflow: rules:`（管線層；job 層用 `rules:`）、secrets ↔ CI/CD variables、`needs` ↔ `stages` 順序。概念一樣，YAML 長得不同。' },
      { b: '快取依賴', t: '`uv` 的 cache 目錄用 `actions/cache` 或 GitLab `cache:` 存起來，key 用 lock 檔 hash；沒快取每次都在等下載。' },
      { b: '測試要有真的資料庫', t: 'GitHub `services:` / GitLab `services:` 起一個 PostgreSQL 容器給測試用，跟本機 compose 同版本。' },
      { b: 'fail fast、平行跑', t: 'lint 幾秒就能擋掉的錯不要等測試跑五分鐘；lint 與 test 可以平行。' },
      { b: 'build image 只在合進 main 之後', t: 'PR 階段跑 lint/test；merge 後才 build 並用 commit SHA 當 tag 推到 registry。' },
    ],
    checklist: [
      '能為一個 Python API 寫一份 GitHub Actions workflow：lint、測試（含 PostgreSQL service）、build image',
      '能把同一條管線改寫成 GitLab CI',
      '知道快取 key 該用什麼、為什麼',
    ],
    refs: [
      { label: 'GitHub Actions 文件', url: 'https://docs.github.com/en/actions' },
      { label: 'GitLab CI/CD 文件', url: 'https://docs.gitlab.com/ee/ci/' },
    ],
  },
  'environments-secrets': {
    points: [
      { b: 'environment 綁保護規則', t: 'prod 環境要求人工核准、只允許 main 分支部署；secret 依環境分開。' },
      { b: 'artifact 傳遞', t: 'build job 產生的 image tag / 測試報告 / 覆蓋率，用 artifact 或 registry 傳給後續 job；job 之間不共享檔案系統。' },
      { b: '同一個 image 一路升級', t: 'staging 部署的 image SHA 與 prod 相同，只換設定；不要每個環境重 build。' },
      { b: 'secret 最小暴露', t: '只在需要的 job 注入、`permissions:` 最小化、第三方 action 釘 SHA。' },
      { b: '部署要能追溯', t: '每次部署記錄：哪個 commit、誰核准、什麼時候、部署到哪。出事時第一個問題是「上一次改了什麼」。' },
    ],
    checklist: [
      '能設定 prod 環境需要人工核准且只接受 main',
      '能說出 artifact 與 cache 的差別',
    ],
    refs: [
      { label: 'GitHub：Using environments for deployment', url: 'https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment' },
    ],
  },
  'cd-strategies': {
    points: [
      { b: 'rolling：逐台換', t: '新版起來、readiness 通過、舊版下線，一台一台。過程中新舊版同時服務——這是相容性要求的來源。' },
      { b: 'blue-green：兩套切換', t: '新版整套起好，流量一次切過去；出事切回來。成本是兩倍資源，好處是回滾秒級。' },
      { b: 'canary：先給 5%', t: '小部分流量吃新版，看錯誤率與延遲，再逐步放大。需要指標與自動化。' },
      { b: 'migration 的 expand / contract', t: '先加（新欄位、可空）→ 程式碼雙寫 → 回填 → 切讀 → 再刪舊的。每一步都與前後版本相容；migration 在部署前跑、且要能 rollback。' },
      { b: '回滾要練習', t: '回滾程式碼容易，回滾資料難。不可逆的 migration（刪欄位）要延後到確定不回滾之後。' },
    ],
    checklist: [
      '能說出三種策略的差異與各自需要的基礎設施',
      '能規劃「加一個 NOT NULL 欄位」的零停機步驟',
    ],
    refs: [],
  },
  'observability': {
    points: [
      { b: '四個黃金訊號', t: '延遲、流量、錯誤率、飽和度。每個服務至少有這四張圖與對應告警。' },
      { b: 'metrics 是聚合、log 是事件', t: '「每分鐘 500 錯誤幾次」看 metrics；「那次 500 的 stack trace」看 log。不要用 log 算指標。' },
      { b: 'trace 看跨服務', t: 'OpenTelemetry 自動幫 FastAPI、SQLAlchemy、httpx 加 span；一個請求在哪一段花最久一眼看到。' },
      { b: '錯誤追蹤工具', t: 'Sentry 類工具把例外聚合、附 context、通知——比翻 log 快十倍。' },
      { b: '告警要可行動', t: '每個告警要有「收到後做什麼」；會被忽略的告警等於沒有。' },
    ],
    checklist: [
      '服務有結構化 log、基本 metrics 端點與錯誤追蹤',
      '能用 trace 找出一個慢請求的瓶頸',
    ],
    refs: [
      { label: 'OpenTelemetry 文件', url: 'https://opentelemetry.io/docs/' },
      { label: 'Prometheus 文件', url: 'https://prometheus.io/docs/' },
    ],
  },
  'reliability': {
    points: [
      { b: 'SLO 讓「可靠」可量化', t: '例如「99.9% 的請求在 500ms 內成功」。有目標才知道什麼時候該停下來還技術債。' },
      { b: '備份三問', t: '多久備一次（RPO）、還原要多久（RTO）、上次成功還原是什麼時候。自動化 + 異地 + 定期演練。' },
      { b: 'runbook', t: '常見狀況（DB 連線滿、磁碟滿、憑證過期）的處理步驟寫下來，半夜被叫醒也能照做。' },
      { b: 'postmortem 不咎責', t: '事故後寫：時間軸、根因、影響、行動項。目標是改系統，不是找人。' },
      { b: '降級與斷路器', t: '外部服務掛了要能降級（顯示快取、關掉非核心功能）而不是整站跟著掛。' },
    ],
    checklist: [
      '知道自己服務的 SLO（或先訂一個）',
      '備份在過去三個月內成功還原過',
      '至少有三份 runbook',
    ],
    refs: [
      { label: 'Google SRE Book', url: 'https://sre.google/sre-book/table-of-contents/' },
    ],
  },
}

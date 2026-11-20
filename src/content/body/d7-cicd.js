// 領域 7：CI/CD 與交付（GitHub Actions、GitLab CI） — 技能內文：重點 points / 自我檢核 checklist / 延伸閱讀 refs；索引在 ../d7-cicd.js
import l2 from './parts/d7-cicd-l2.js'
const base = {
  'git-workflow': {
    challenge: {
      task: '在本機建一個練習用的 git repo，模擬訂位服務的一個契約：`api.py` 的 `get_booking()` 回傳含 `seats` 欄位的 dict，`client.py` 讀 `seats` 算總人數，`test_contract.py` 把 `api` 的輸出交給 `client` 驗證。從 main 開兩個分支：A 把欄位改名成 `party_size`（改 `api.py` 與它自己的單元測試），B 在 `client.py` 加一個也讀 `seats` 的新函式與測試。兩個分支各自跑 pytest 都是綠的。動手合併前，先寫下你預測 git 會不會報衝突、合併後哪個測試會紅。',
      deliver: '兩種合併順序（先 A 後 B、先 B 後 A）各一份 `git log --graph --oneline` 與合併後 main 上的 pytest 輸出，加上事前的預測。',
      check: [
        '合併後的 main 上 `test_contract.py` 是紅的，並指出是哪一行讀了已經改名的欄位',
        '說得出 git 沒有報衝突的原因：兩個分支改的是不同的行，git 不知道它們屬於同一個契約',
        '提出一條平台規則（例如必要檢查加上「合併前要跟上最新的 main」），並說明它讓錯誤在哪個 PR 的哪一步變紅',
      ],
      twist: '改成 B 先合進 main，A 的 PR 開了「Require branches to be up to date」。先預測 A 的 PR 會在哪一步被擋、該由哪個分支的作者修，再實際 rebase A 驗證。',
    },
    points: [
      { b: '分支活不過幾天', t: '功能拆小、常合回 main；長分支 = 大衝突 + 難 review。未完成的功能用 feature flag 藏起來。' },
      { b: 'main 受保護', t: '禁止直接 push、必須 PR、CI 綠燈、至少一人 review。這是 CD 能自動部署 main 的前提。' },
      { b: 'commit 訊息是給未來的自己', t: '`fix(auth): reject expired refresh tokens` 這種格式（Conventional Commits）能自動產 changelog；一個 commit 做一件事，能單獨 revert。' },
      { b: 'rebase 還是 merge', t: '本機整理用 rebase、合進 main 用 squash 或 merge，團隊選一種寫進規範。共享分支不 force push。' },
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
    map: {
      names: [
        { n: 'workflow 與 pipeline', t: '一份 YAML 描述觸發條件與要跑的 job：GitHub 放在 `.github/workflows/`，GitLab 是 `.gitlab-ci.yml`。' },
        { n: 'job 與 step', t: 'job 預設平行，各自在一台乾淨的 runner 上跑；step 在同一個 job 裡依序執行，前一步失敗，後面預設不跑。' },
        { n: '`needs` 與 stages', t: '建立 job 的先後。GitHub 用 `needs`；GitLab 的 stages 是整批的柵欄，`needs` 讓 job 不必等整個 stage。' },
        { n: '快速失敗', t: '便宜的 lint、型別檢查先跑，失敗就不再花時間跑測試與 build。' },
        { n: 'cache key', t: '用 lock 檔的雜湊當 key：lock 檔不變就命中，一改就換新的；固定字串會一直拿到第一次存的內容。' },
        { n: 'service container', t: '在 job 旁邊起 PostgreSQL 這類服務，版本與正式環境一致；要等 health check 通過才開始測試。' },
        { n: 'artifact', t: '這次 run 的產物（測試報告、建好的檔案），在 job 間傳或給人下載；和快取是兩回事。' },
        { n: '必要檢查（required status check）', t: '分支保護規則要求某些 job 綠燈才能合併；job 改名後，PR 會一直等舊名字的檢查。' },
      ],
      ask: [
        '哪些事件觸發：PR 跑什麼、合進 main 跑什麼、打 tag 跑什麼。',
        'job 的先後與哪些可以平行，哪一個失敗要擋住後面。',
        '測試需要的外部服務與大版本（PostgreSQL、Redis），以及連線字串怎麼給。',
        '快取什麼目錄、key 用哪個檔案的雜湊。',
        '產物是什麼、用什麼 tag（commit SHA）推到哪個 registry，哪一個 job 有寫入權限。',
        '哪些 job 是合併前的必要檢查。',
      ],
      prompt: '替 Python 3.12 的 FastAPI 專案（uv 管依賴）寫 GitHub Actions workflow。PR 與 push 到 main 都跑 lint（ruff、mypy）與測試；測試 job 設 `needs: lint`，用 service container 起 `postgres:16` 並等 `pg_isready`，先跑 `alembic upgrade head` 再跑 pytest，JUnit 報告用 artifact 上傳，測試失敗也要上傳。uv 的快取 key 用 `uv.lock` 的雜湊。只有 push 到 main 時才 build image，tag 用 `github.sha` 推到 ghcr.io；workflow 層的 permissions 設成 `contents: read`，`packages: write` 只給 build 這個 job。',
      verify: [
        { c: '觸發條件', t: '開一個 PR，Actions 頁面上的 build 要顯示 skipped，合進 main 之後才會跑；PR 上也在 build，代表 `if` 沒寫或寫錯。' },
        { c: '快速失敗', t: '故意留一個沒用到的 import 推上去：lint 紅、test 與 build 顯示 skipped。test 照樣在跑，代表少了 `needs`。' },
        { c: '快取', t: '看 cache step 的 log：lock 檔沒變時是 `Cache restored from key: …`，改了依賴之後 key 要跟著變。每次都 `Cache not found` 通常是 key 含 commit SHA，依賴改了還命中同一個 key 通常是固定字串。' },
        { c: '資料庫', t: 'test job 的 log 要先看到 service 的 health check 通過才開始 step；出現 `connection refused` 通常是沒等就緒，或 job 跑在容器裡卻還用 `localhost`。' },
        { c: '權限', t: '頂層 `permissions` 是 `contents: read`，只有推 image 的 job 有 `packages: write`；AI 產生的 workflow 常把 `write-all` 放在最上面，或整份都沒寫 permissions。' },
        { c: '必要檢查', t: 'branch protection 或 ruleset 裡的必要檢查名稱要和 job 名稱一致；改了 job 名稱之後，PR 會停在 `Expected — Waiting for status to be reported`。' },
      ],
    },
    challenge: {
      task: '把本課「完整範例：GitHub Actions」的 workflow 放進一個練習 repo（GitLab 就照對照表改寫），做三個 commit，各故意壞一個階段：lint（留一個沒用到的 import）、test（讓一個 assertion 失敗，或讓 migration 少一個欄位）、build（Dockerfile 裡 `COPY` 一個不存在的檔案）。每次 push 前先寫下預測：哪個 job 紅、哪些 job 顯示 skipped、log 裡第一個錯誤會出現在哪個 step。沒有 repo 可以用時，lint 與 test 兩次改用 [CI/CD 管線實驗室](#/lab/PipelineLab) 的「讓測試失敗」與「這次是 feature branch」做。',
      deliver: '三次 run 各一張截圖（失敗的 job、被跳過的 job、log 裡第一個錯誤的那一行），每張旁邊附事前的預測與一句差異說明。',
      check: [
        '每次指出的錯誤行是 log 裡第一個錯誤，不是最後那行 `Process completed with exit code 1`',
        '預測的「第一個紅的 job」與「skipped 的 job」和實際一致；不一致的寫出是哪個 `needs` 或 `if` 讓結果不同',
        'build 壞的那次在 PR 上看不到紅燈，能說明原因（build 只在 push 到 main 時跑）以及要在哪裡才看得到',
      ],
      twist: '把 test 的 `needs: lint` 拿掉，三個錯放進同一個 commit 推成 PR。先預測 PR 上會出現幾個紅燈、修好一個重推之後會不會冒出下一個，再實際跑一次。',
    },
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
    challenge: {
      task: '用本課的晉升流程（或程式題 [同一個 image 從 staging 晉升到 production](#/exercise/environments-secrets-1) 的寫法）在練習 repo 跑一次 staging → production。從兩個部署 job 的 log 或 registry 取出實際部署的 image digest（`sha256:…`，可用 `docker buildx imagetools inspect <image>:<tag>` 查），比對兩邊是不是同一個東西。接著做一個對照組：把 production job 改成部署前重新 `docker build` 一次，再比對 digest。',
      deliver: '一張表：晉升版與重 build 版各自的 commit SHA、staging digest、production digest，加上每一版一句結論。',
      check: [
        '晉升版的兩個 digest 相同，並寫出你是從哪個指令或頁面讀到的',
        '重 build 版的 digest 相同或不同都要解釋：不同時指出可能的來源（建置時間、base image、依賴解析），相同時說明是哪一層快取讓它剛好一樣，以及為什麼不能依賴這件事',
        '指出 production 的部署紀錄裡哪個欄位能回答「上線的是哪個 commit」',
      ],
      twist: '有人提議不用 SHA，改用 `:staging`、`:production` 兩個會移動的 tag。先預測：同一個 commit 晉升後兩個 tag 是否指向同一個 digest；一週後要回滾到「上週的 production」時，你手上還剩什麼可以用。',
    },
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
    challenge: {
      task: '在 [Playground 的 PostgreSQL](#/playground?lang=sql) 照本課的 expand–contract SQL 建 `customers`，把 `name` 換成 `full_name` 拆成五步：加可空欄位、雙寫、回填、切讀、刪舊欄位（再加一步 `full_name SET NOT NULL`）。每一步之後都用「v1 的程式」跑一次讀（`SELECT id, name FROM customers`）與寫（`INSERT INTO customers (name) VALUES (…)`），也用 v2 跑一次。動手前先預測：從哪一步開始，回滾到 v1 會失敗。',
      deliver: '一張表：每一步的 schema 變更、v1 讀、v1 寫、v2 讀寫的結果（成功或實際的錯誤訊息），並標出「這一步之後不能再回滾到 v1」的位置。',
      check: [
        '表裡六步都有實際執行的結果，失敗的格子貼的是 PostgreSQL 回的錯誤訊息',
        '標出的不可回滾點有對應的錯誤佐證（v1 的讀在刪欄位後失敗、v1 的寫在 `SET NOT NULL` 後失敗）',
        '說明每一步要部署的程式版本，以及哪兩個版本可以同時在線',
      ],
      twist: '需求變化：v2 上線第三天發現計價 bug 要回滾，但刪舊欄位那一步已經在第二天跑了。先預測回滾到 v1 會看到什麼錯誤，再寫出一個不用還原備份、讓服務先恢復的做法。',
    },
    points: [
      { b: 'rolling：逐台換', t: '新版起來、readiness 通過、舊版下線，一台一台。過程中新舊版同時服務，所以新版必須跟舊版相容。' },
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
    challenge: {
      task: '打開 [用 trace id 串起 log、metrics、trace](#/lab/TraceLab)，每一種「情境」各做一次：在 p95 延遲圖上點尖峰的時間點、找到那段時間最慢的 trace、按「選最慢的 span」，再看 log 面板裡帶同一個 trace id 的日誌。切換情境之前，先依情境名稱寫下你猜最慢的會是哪一段。',
      deliver: '每個情境一列：尖峰時間、trace id、最慢的 span 與耗時、它佔整個請求的比例、log 裡證實它的那一行，以及和你預測差在哪。',
      check: [
        '每一列的 trace id 在 trace 瀑布圖與 log 面板一致',
        '最慢 span 的耗時與比例是從畫面上的數字算出來的，不是用猜的',
        '至少一個情境寫出「只看 metrics 會下的錯誤結論」是什麼',
      ],
      twist: '假設 trace 改成 head sampling 1%（請求一開始就決定記不記）。先預測哪一個情境的慢請求最可能抓不到 trace，那時要改從哪一種訊號、用什麼欄位找原因。',
    },
    points: [
      { b: '四個黃金訊號', t: '延遲、流量、錯誤率、飽和度。每個服務至少有這四張圖與對應告警。' },
      { b: 'metrics 是聚合、log 是事件', t: '「每分鐘 500 錯誤幾次」看 metrics；「那次 500 的 stack trace」看 log。不要用 log 算指標。' },
      { b: 'trace 看跨服務', t: 'OpenTelemetry 自動幫 FastAPI、SQLAlchemy、httpx 加 span；一個請求在哪一段花最久一眼看到。' },
      { b: '錯誤追蹤工具', t: 'Sentry 類工具把例外聚合、附 context、通知，找問題比翻 log 快十倍。' },
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
    challenge: {
      task: '在本機用 Docker 起一個 `postgres:18` 容器，建一張 `orders` 表（`id` 用 identity 或 serial）並插入幾百筆資料，持續每秒插入一筆。用 `pg_dump -Fc` 備份，再到另一個新的容器用 `pg_restore` 還原。還原完成不以 `pg_isready` 為準，改跑三件「服務的工作」：查出最新一筆訂單、新增一筆訂單、用應用程式的帳號登入並讀資料。',
      deliver: '一份還原演練紀錄：開始與結束時間（實測 RTO）、備份時間點與還原後最後一筆資料的時間（實測 RPO）、三項工作檢查的指令與輸出。',
      check: [
        'RTO 與 RPO 都是這次量到的數字，並寫出量法',
        '新增訂單成功且 id 沒有撞號；如果撞號，指出是哪個物件沒有一起還原（例如只還原了資料、沒有還原序列的目前值）',
        '至少寫出一種「`pg_isready` 通過、工作檢查失敗」的情況，並說明它在正式環境會讓哪個請求失敗',
      ],
      twist: '業務說「訂單最多只能丟 5 分鐘」。先預測這次演練的哪個數字不及格、換成本課哪一種做法才達得到，並寫出新做法的演練要多驗哪一項。',
    },
    points: [
      { b: 'SLO 讓「可靠」可量化', t: '例如「99.9% 的請求在 500ms 內成功」。有目標才知道什麼時候該停下來還技術債。' },
      { b: '備份三問', t: '多久備一次（RPO）、還原要多久（RTO）、上次成功還原是什麼時候。自動化 + 異地 + 定期演練。' },
      { b: 'runbook', t: '常見狀況（DB 連線滿、磁碟滿、憑證過期）的處理步驟寫下來，半夜被叫醒也能照做。' },
      { b: 'postmortem 不咎責', t: '事故後寫：時間軸、根因、影響、行動項。行動項改的是系統與流程，不追究個人。' },
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

// P9 新課的內文放在 parts/ 底下，這裡合併
export default { ...base, ...l2 }

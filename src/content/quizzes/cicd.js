// 題庫：CI/CD 與交付
export default [
  {
    skill: 'git-workflow',
    questions: [
      {
        q: '團隊做 SaaS 產品、每天部署多次、只維護一個線上版本。該選 trunk-based 還是 Git Flow？',
        options: [
          'Git Flow：develop / release 分支讓 QA 有獨立的穩定版本可以測，main 只放已發布的版本更安全',
          'Git Flow：hotfix 分支是修線上 bug 唯一安全的方式，trunk-based 沒有對應的機制',
          'Trunk-based：短分支很快合回受保護的 main、main 永遠可部署；Git Flow 是給同時維護多版本的軟體',
          '兩者差別不大：只要有 PR review 與 CI，分支怎麼開是個人習慣，不影響部署流程',
        ],
        answer: 2,
        explain: 'CD 的前提是「main 隨時可部署」，trunk-based 靠小 PR + CI 綠燈 + 保護規則達成，未完成的功能用 feature flag 藏起來而不是留在長分支。Git Flow 的 develop / release / hotfix 多層分支是為「v1.2 還在維護、v2.0 在開發」這種多版本情境設計的（安裝型軟體、SDK），對每天部署的 SaaS 只是額外的合併成本與衝突來源；它提供的穩定版本與 hotfix 通道，在 trunk-based 裡由 CI 與 flag 取代。分支策略直接決定 CI/CD 能不能自動化，不是有 review 就好。',
      },
      {
        q: '從「能讀、能單獨 revert、能自動產 changelog」的角度看，這三個 commit 各有什麼問題？',
        code: `$ git log --oneline
a1f3c2d fix(auth): reject refresh tokens issued before password change
9b2e7f0 wip
7c4d1a8 feat(api): add /users/{id}/sessions endpoint, fix flaky test, bump deps`,
        lang: 'bash',
        options: [
          '第二個什麼都沒說；第三個一個 commit 做三件事，無法單獨 revert 其中一項，changelog 也會混在一起',
          '第一個太長：commit 標題應該控制在 20 字以內，縮成 fix auth 這種格式，細節寫在 PR 描述就好',
          '三個都沒問題：合併後大家看的是 PR，PR 標題與描述寫清楚就好，個別 commit 的訊息不重要',
          '第三個的 type 應該是 fix 而不是 feat：只要 commit 裡有修 bug，Conventional Commits 就規定用 fix',
        ],
        answer: 0,
        explain: '第一個是範本：type(scope): 做了什麼，機器能分類、人能一眼看懂，長度不是問題。wip 在本機沒關係，但合進 main 前該用 rebase / squash 整理掉。第三個混了功能、修測試、升依賴——若 bump deps 出問題，你無法只 revert 那一部分；正確做法是拆成三個 commit，而不是改 type。PR 標題不會跟著 git blame / git bisect 走，commit 訊息才會，所以「PR 寫清楚就好」不成立。',
      },
      {
        q: '你在自己的 feature 分支上 rebase 了 main，push 被拒絕（non-fast-forward）。這條分支只有你在用、PR 還沒合併。該怎麼做？',
        options: [
          '放棄 rebase，改用 git merge main 重來：任何分支都不該 force push，這是團隊規範的底線',
          '先刪掉遠端分支再重新 push 一次，遠端沒有舊歷史可比對，技術上就不算 force push',
          'git push --force：分支只有自己在用，直接覆寫最快，--force-with-lease 只是多打字',
          'git push --force-with-lease：自己的短命分支 rebase 後改寫歷史是預期的，禁令針對的是共享分支',
        ],
        answer: 3,
        explain: '「本機整理用 rebase」的代價就是歷史改寫，所以 push 需要 force；--force-with-lease 會先確認遠端沒有別人剛推上來的 commit 才覆寫，比裸 --force 多一層保護。規範禁止的是對「共享分支」（main、多人協作的分支）force push，只有自己在用的 PR 分支正是該 rebase 整理的地方，全面禁用是過度保守。刪掉遠端再推只是繞路做同一件事，還會把 PR 一起關掉。',
      },
    ],
  },
  {
    skill: 'ci-pipeline',
    questions: [
      {
        q: '一個 PR 被推上來時，這份 GitHub Actions workflow 會怎麼跑？',
        code: `on:
  pull_request:
  push:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v6
      - run: uvx ruff check .
  test:
    runs-on: ubuntu-latest
    services:
      db:
        image: postgres:16
        env: { POSTGRES_PASSWORD: test }
        ports: ["5432:5432"]
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v6
      - uses: actions/cache@v4
        with:
          path: ~/.cache/uv
          key: uv-\${{ hashFiles('uv.lock') }}
      - run: uv sync --frozen && uv run pytest
  build:
    needs: [lint, test]
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t ghcr.io/org/app:\${{ github.sha }} .   # login 與 push 略`,
        lang: 'yaml',
        options: [
          'lint → test → build 依序跑，job 預設照寫的順序執行',
          'lint 與 test 平行跑；build 被跳過，因為 if 只在 push 事件成立',
          '三個 job 全部平行跑，needs 只影響顯示順序',
          '只跑 lint；test 需要 secrets 所以 PR 事件不會執行',
        ],
        answer: 1,
        explain: 'GitHub Actions 的 job 預設平行，只有宣告 needs 的才會等——lint 與 test 同時開始（fail fast 就是這樣來的），build 等它們都綠。但 build 還有 if: github.event_name == \'push\'，PR 事件下條件為 false、job 被跳過——這就是「PR 只 lint / test、合進 main 才 build 並用 SHA 當 tag」的實作。services 與 cache 都不需要 secrets。cache key 用 hashFiles(\'uv.lock\')：lock 檔不變就命中，一改就重建。',
      },
      {
        q: '在 feature/login 分支 push 一個 commit，這份 GitLab CI 的 pipeline 會包含哪些 job？',
        code: `stages: [test, build, deploy]

test:
  stage: test
  image: ghcr.io/astral-sh/uv:python3.12-bookworm-slim
  services: [postgres:16]
  cache:
    key:
      files: [uv.lock]
    paths: [.uv-cache/]
  script:
    - uv sync --frozen
    - uv run pytest

build:
  stage: build
  script: docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA .   # 需 dind，略
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

deploy:
  stage: deploy
  script: ./deploy.sh
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      when: manual`,
        lang: 'yaml',
        options: [
          'test、build、deploy 都會出現，deploy 要手動按',
          'test 與 build；deploy 因為 when: manual 不會出現',
          '沒有 job 會跑，因為 stages 沒有列出 feature 分支',
          '只有 test；build 與 deploy 的 rules 條件不成立，根本不會被加進 pipeline',
        ],
        answer: 3,
        explain: 'GitLab 的 rules: 決定 job 是否「被建立」：$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH 在 feature 分支為 false、又沒有其他規則，所以 build 與 deploy 直接不存在於這條 pipeline（不是跳過）。test 沒有 rules，預設每次 push 都跑。when: manual 只在條件成立（main 分支）時才生效，變成要人按的部署按鈕。stages 只定義階段順序，與分支無關。對照 GitHub Actions：rules: ↔ if:、stages ↔ needs、cache:key:files ↔ hashFiles。',
      },
      {
        q: 'CI 每次都花兩分鐘下載依賴，你加了 actions/cache 但 key 寫成固定字串 uv-cache。會發生什麼？',
        options: [
          '第一次存進去後永遠命中舊快取，之後 lock 檔新增的套件每次都得補下載，快取內容也不會更新',
          '完美：key 固定所以每次都命中，永遠不用重新下載',
          'GitHub 會拒絕固定字串的 key，必須包含 runner.os',
          '每個 PR 都會重新建立快取，等於沒快取',
        ],
        answer: 0,
        explain: 'actions/cache 命中 key 時只還原、不回寫（cache 是不可變的），固定 key 代表快取內容凍結在第一次的狀態；依賴一變，缺的部分每次都要重抓，快取越來越沒用。正確的 key 要包含依賴描述檔的 hash（uv-${{ hashFiles(\'uv.lock\') }}），lock 檔一改 key 就變、重新建立；再加 restore-keys: uv- 讓舊快取先當底。加 runner.os 是好習慣但不是強制；cache 是 repo 層級共享，預設分支建立的快取也給 PR 用。',
      },
    ],
  },
  {
    skill: 'environments-secrets',
    questions: [
      {
        q: '要讓這個 job「部署前需要人工核准、且只接受 main 分支」，該在哪裡設定？',
        code: `jobs:
  deploy-prod:
    runs-on: ubuntu-latest
    environment: production
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - run: ./deploy.sh \${{ github.sha }}
        env:
          DEPLOY_TOKEN: \${{ secrets.DEPLOY_TOKEN }}`,
        lang: 'yaml',
        options: [
          '在 repo 設定的 Environments → production 設 required reviewers 與 deployment branches，YAML 不用改',
          'YAML 加 if: github.ref == refs/heads/main 擋分支，再加一個 sleep 600 的 step 讓人有時間取消',
          '把 DEPLOY_TOKEN 從 environment secret 改成 repo 層級 secret，只有 admin 能觸發用到它的 job',
          '把觸發改成 on: workflow_dispatch 並限制只能從 main 執行，需要有人手動按就等於核准',
        ],
        answer: 0,
        explain: '保護規則（required reviewers、wait timer、deployment branches）是 environment 的屬性，設在 repo 設定裡而不是 YAML；job 一宣告 environment: production 就會在執行前暫停等核准，非 main 分支的 run 直接被拒，而且 environment 的 secrets 只有通過保護的 job 拿得到。sleep 不是核准機制、if 也能被改 YAML 的人繞過；environment secret 比 repo secret 更受限，改成 repo 層級是反方向；手動觸發不等於核准，任何有寫入權限的人都能按。',
      },
      {
        q: 'CI 的 cache 與 artifact 差在哪？下載的依賴、測試報告、build 出的 wheel 各該用哪個？',
        options: [
          '兩者底層都是壓縮上傳的儲存空間，差別只在名字；三者都用 cache 最快，也不佔 artifact 配額',
          'artifact 是加速用、以 key 命中的儲存（依賴目錄）；cache 是保留給人下載的產物（報告、wheel）',
          'cache 是加速用、可丟的跨 run 資料（依賴目錄）；artifact 是這次 run 的產物，在 job 間傳或給人下載（報告、wheel）',
          'cache 只能在同一個 job 內還原，依賴目錄用它；artifact 才能跨 job，報告與 wheel 都得用 artifact',
        ],
        answer: 2,
        explain: 'cache 以 key 命中、不保證存在（可能被清、可能 miss），內容丟了只是變慢，所以適合依賴目錄；artifact 綁定這一次 run、有保留期限，能在 job 之間傳（job 之間沒有共享檔案系統）、也能從 UI 下載，適合測試報告、覆蓋率、build 產物。cache 跨 run、跨 job 都能還原，只是不保證。image 這種產物則用 registry 傳、以 SHA tag 當「artifact 位址」。',
      },
      {
        q: 'staging 測過沒問題，部署到 prod 卻炸了。追查發現 prod 的管線在 deploy 前又 docker build 了一次。哪個修法對？',
        options: [
          'prod build 時加 --no-cache 並鎖定 base image digest，確保建出來的是乾淨且可重現的版本',
          'staging 驗證的是哪個 image SHA，prod 就部署同一個 SHA；build 只做一次，環境差異只靠注入的設定',
          'prod 與 staging 的部署都改成拉 latest tag，只要兩邊 pull 的是同一個 tag，拿到的 image 就一定一樣',
          '維持各自 build，但部署前先在 prod 環境跑一次完整測試套件，測過再把流量切到新版',
        ],
        answer: 1,
        explain: '重 build 代表 base image、系統套件、甚至未鎖版的依賴都可能不同——就算釘了 base digest、加了 --no-cache，建出來的仍是另一個 image，staging 驗證的等於是另一份東西。以 commit SHA 當 tag、一路 promote 同一個 image，部署紀錄也才能回答「上線的到底是哪個 commit」。latest 是浮動指標，兩邊 pull 的時間點不同就可能不同，也無法回滾到明確版本。在 prod 跑測試是額外保險，沒解決「跑的不是同一份」這個根本問題。',
      },
    ],
  },
  {
    skill: 'cd-strategies',
    questions: [
      {
        q: 'rolling deploy 過程中，為什麼新版程式碼與資料庫 schema 必須「同時相容新舊版」？',
        options: [
          'rolling 會先跑 migration 再一次換掉所有實例，中間有幾秒停機',
          '負載平衡器會隨機把舊版的請求送到新版，造成 session 不一致',
          '不需要，rolling 本身就保證零停機',
          '換版是一台一台，某段時間新舊版程式同時服務同一個資料庫；任一版讀不懂當下的 schema 就會出錯',
        ],
        answer: 3,
        explain: 'rolling 的本質是「新版起來、readiness 通過、舊版下線、下一台」，中間有一段新舊共存期；回滾時又會倒回舊版跑在新 schema 上。這就是 expand / contract 的來源：先加可空欄位（舊版不知道也沒事）、雙寫、回填、切讀、最後才刪舊欄位。「一次換掉所有實例」不是 rolling；session 問題靠 API 無狀態解決，與 schema 無關；零停機是做對相容性後的結果，不是策略自帶的。',
      },
      {
        q: 'PR 裡的 migration 是下面這一行，與新版程式碼一起 rolling 部署到一個已有十萬筆 users 的系統。會發生什麼？',
        code: `ALTER TABLE users ADD COLUMN phone TEXT NOT NULL;`,
        lang: 'sql',
        options: [
          '沒問題：migration 跟新版一起部署，新版程式碼會寫入 phone，既有列由 ORM 的預設值補上',
          'migration 在既有資料上直接失敗；就算表是空的，共存期舊版程式的 INSERT 不帶 phone 也會被拒',
          'PostgreSQL 會自動用該型別的零值（空字串）補既有列，只是十萬筆要全表重寫，鎖表時間長一點',
          '只要部署工具先停掉舊版再跑 migration 就沒事；rolling 部署預設就是先跑 migration 再逐台換',
        ],
        answer: 1,
        explain: '對非空表加 NOT NULL 又沒有 DEFAULT，PostgreSQL 直接報錯（column contains null values），不會自動補值。即使表是空的，rolling 期間舊版程式還在跑、它的 INSERT 不知道 phone → 違反 NOT NULL → 使用者看到 500；「先停舊版」是停機部署，不是 rolling。正確做法是 expand / contract：先加可空欄位、新版雙寫、回填舊資料、確認沒有 NULL 後才 SET NOT NULL（可先加 NOT VALID 的 CHECK 約束再 VALIDATE 以縮短鎖表）。每一步都能獨立 rollback。',
      },
      {
        q: '新版改了核心的訂單計價邏輯，測試都過但你不放心。服務有完整的錯誤率、延遲、每分鐘訂單數指標。哪種部署策略最能降低風險？',
        options: [
          'blue-green：新版整套起好後一次切 100%，出問題再切回',
          'rolling：逐台換最省資源，出問題就停止換版',
          'canary：先讓 5% 流量進新版、盯錯誤率與訂單數，正常再逐步放大，異常就切回',
          '週末凌晨停機部署，那時沒人下單',
        ],
        answer: 2,
        explain: 'canary 的價值是「用真實流量、有限爆炸範圍」驗證測試抓不到的問題，前提是要有指標判斷好壞——題目已經有。blue-green 回滾快，但一切就是 100% 使用者吃到 bug，比較適合「要整套一起切」的情境；rolling 的爆炸範圍隨換掉的台數增長且沒有明確的觀察閘門；停機部署不會發現邏輯 bug，只是把發現時間延後到早上。搭配 feature flag 的話，甚至不用重新部署就能把新計價邏輯關掉。',
      },
    ],
  },
  {
    skill: 'observability',
    questions: [
      {
        q: '要回答「過去 24 小時 /checkout 的 p99 延遲趨勢」與「昨天 14:03 那次 500 的 stack trace」，該分別看什麼？',
        options: [
          '兩個都用 log：現代 log 平台支援全文檢索與聚合查詢，p99 與 stack trace 都能從同一份資料算出來',
          '前者看 log（逐筆記錄延遲才算得出 p99）、後者看 metrics（錯誤計數器會附上最後一次的例外）',
          '前者看 metrics（histogram 聚合）、後者看 log（單一事件），兩者用 request id / trace id 串起來',
          '兩個都用 trace：每個 span 都有延遲與例外資訊，trace 是三者中資訊最完整的',
        ],
        answer: 2,
        explain: 'metrics 是預先聚合好的數字（counter、histogram），便宜、能長期保存、適合畫趨勢與告警；log 是一筆筆事件，才有 stack trace 這種細節——metrics 只有數字，不會帶例外內容。用 log 算 p99 在流量大時又貴又慢，還可能因採樣或遺失而不準；trace 通常會採樣、保留期短，不適合當長期趨勢來源。實務流程是：metrics 告警 → 找到時間點 → 用 trace id 找那條 trace → 跳到對應的 log。',
      },
      {
        q: '相比 logger.error(f"payment failed for user {user_id}") 這種純文字 log，下面這筆 JSON log 多換到了什麼？',
        code: `{"ts": "2026-09-24T14:03:11Z", "level": "error", "msg": "payment failed",
 "request_id": "7f3a…", "trace_id": "4bf9…", "user_id": 1042,
 "route": "/checkout", "status": 500, "latency_ms": 2310,
 "error": "TimeoutError: upstream payment-api"}`,
        lang: 'json',
        options: [
          '每個欄位都能被索引與過濾：依 request_id 撈同一請求的所有紀錄、依 trace_id 跳到 trace、依 route 統計',
          '只是版面比較整齊；log 系統都是全文檢索，純文字裡的 user_id 一樣搜得到，兩者查詢能力一樣',
          '欄位化之後 log 平台會自動把 status、latency_ms 聚合成 metrics，服務就不需要另外暴露 metrics 端點',
          '同樣資訊 JSON 佔的空間比較小，因為 key 會被 log 系統做字典壓縮，長期儲存成本比純文字低',
        ],
        answer: 0,
        explain: '結構化 log 的價值在「機器可查」：request_id 讓你把一個請求在 nginx、API、worker 留下的紀錄一次撈出來，trace_id 是 log 與 trace 之間的橋。全文檢索能找到字串，但要依欄位過濾、比大小、分組統計，純文字就得事後用 regex 解析，格式一改全部報廢。從 log 派生指標既貴又不穩，metrics 該由應用直接以 counter / histogram 暴露；JSON 通常比純文字大而不是小。也注意這種 log 不該包含 PII 或 token 原文。',
      },
      {
        q: '服務有 200 條告警，多數是「CPU > 70%」「出現一次 5xx」這類，值班的人已經習慣直接忽略。該怎麼調整？',
        options: [
          '把門檻調高（CPU > 95%、5xx 連續 5 次），告警數量下降到值班的人願意看，內容不用動',
          '以四個黃金訊號重建告警，每條對應使用者感受到的症狀並附 runbook；不知道收到要做什麼的就刪掉',
          '全部改成只寄 email 與每日摘要，不再推播到手機，值班的人白天集中處理就不會疲勞',
          '告警太多是因為沒分級：全部保留並再加更多告警覆蓋所有指標，用 P1–P4 分級讓人自己篩',
        ],
        answer: 1,
        explain: '「會被忽略的告警等於沒有」——告警疲勞讓真正的事故也被略過。好的告警描述症狀（p99 > 1s、錯誤率 > 1%、佇列積壓）而不是原因（CPU 高不一定有人受影響），且每條都要回答「收到後做什麼」。只調數字是換個門檻繼續吵；只寄 email 等於關掉告警；加更多告警讓噪音更大。單一 5xx 這類事件該進錯誤追蹤工具（Sentry 類）聚合看趨勢，不是每次都叫人。',
      },
    ],
  },
  {
    skill: 'reliability',
    questions: [
      {
        q: '資料庫每天凌晨 3 點全量備份一次，從備份還原到能服務約需 2 小時。這代表 RPO 與 RTO 分別是多少？',
        options: [
          'RPO 2 小時、RTO 24 小時',
          'RPO 最多 24 小時（最壞丟一整天資料）、RTO 約 2 小時',
          'RPO 與 RTO 都是 2 小時',
          'RPO 是 0（有備份就不會丟資料）、RTO 2 小時',
        ],
        answer: 1,
        explain: 'RPO（Recovery Point Objective）是「最多能接受丟多少時間的資料」：每天備一次，災難若發生在下一次備份前一刻就丟了近 24 小時。RTO（Recovery Time Objective）是「還原到能服務要多久」，這裡是 2 小時。「有備份就不會丟資料」是常見誤解，要讓 RPO 趨近 0 得靠 WAL 歸檔 / PITR 或同步複寫。這些數字要拿真正演練過的還原來驗證——「上次成功還原是什麼時候」比「有沒有備份」重要。',
      },
      {
        q: '這份 runbook 最重要的價值在哪裡？',
        code: `# runbook：DB 連線數滿（FATAL: too many connections）
# 1. 確認現況
psql -c "SELECT state, count(*) FROM pg_stat_activity GROUP BY state;"
# 2. 找出佔連線的來源
psql -c "SELECT application_name, count(*) FROM pg_stat_activity GROUP BY 1 ORDER BY 2 DESC;"
# 3. 若 idle in transaction 太多，先砍掉超過 10 分鐘的
psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle in transaction' AND state_change < now() - interval '10 min';"
# 4. 在 #incident 貼結果；事後檢查 pool 設定與 worker 數`,
        lang: 'bash',
        options: [
          '有了它資料庫就不會再連線滿：runbook 本身就是預防措施，寫得夠完整事故就不會再發生',
          '步驟 3 可以直接寫成 cron 每分鐘自動跑：既然處置步驟已經確定，就不需要人介入，自動化才是終點',
          '它可以取代事後的 postmortem：處置步驟都寫在這裡了，事故結束後照著看一遍就等於檢討過',
          '半夜被叫醒的人不必記得 pg_stat_activity 怎麼查，照步驟先止血，根因分析留到白天',
        ],
        answer: 3,
        explain: 'runbook 的目標是「可靠地執行已知的處置」：降低半夜的認知負荷、避免手誤、確保通知與紀錄不漏。它不是預防——預防是事後檢討的行動項（調 pool 上限、找出沒關交易的程式碼）。把止血手段自動化成常態很危險：自動砍連線會掩蓋根因，也可能砍掉正常的長交易，自動化該是修好根因之後的事。runbook 是事中、postmortem 是事後找根因與改系統，兩者不能互相取代。',
      },
      {
        q: '第三方金流 API 昨天慢到 30 秒，結果整個網站（包含跟金流無關的商品瀏覽）一起掛。事故檢討會該聚焦什麼？',
        options: [
          '為什麼一個外部依賴變慢會拖垮全站：補 timeout、斷路器、讓結帳降級而其他功能照常，寫成行動項',
          '找出是誰選了這家金流、誰在整合時沒設 timeout，釐清責任歸屬並記入績效，避免下次再犯',
          '評估並更換一家 SLA 更好的金流供應商，並在合約裡加入可用性條款，從源頭消除這個風險',
          '整理停機時間軸與損失金額，向金流廠商求償並寫進合約，同時把事故歸類為外部因素結案',
        ],
        answer: 0,
        explain: '不咎責的 postmortem 問的是「系統為什麼允許這個失敗擴散」：沒有 timeout 讓 worker 全部卡在等金流、沒有斷路器讓每個請求都去撞、沒有降級讓無關功能陪葬——這些是可以改的系統性質。找人負責只會讓下次沒人敢說實話。換供應商或談賠償沒有解決「任何外部依賴都可能慢」這個事實，換一家一樣會發生。時間軸、根因、影響、行動項四件事寫下來，行動項要有負責人與期限。',
      },
    ],
  },
]

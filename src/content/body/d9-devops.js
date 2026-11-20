// 領域 9：DevOps 與基礎建設 的技能內文（以技能 id 為 key）
import l4 from './parts/d9-devops-l4.js'
import m2 from './parts/d9-devops-m2.js'
import m4 from './parts/d9-devops-m4.js'
import n1 from './parts/d9-devops-n1.js'
import n2 from './parts/d9-devops-n2.js'
import n3 from './parts/d9-devops-n3.js'
import n4 from './parts/d9-devops-n4.js'
const base = {
  'devops-glossary': {
    points: [
      { b: '交付線上的詞', t: 'pipeline 是一串自動化 job；artifact 是 job 產出、往後傳的檔案或 image；環境晉升是同一個 artifact 依序部署到 dev → staging → prod，不重新 build。' },
      { b: '可靠度的詞', t: 'SLI 是量測值、SLO 是內部目標、SLA 是寫進合約的承諾；HA 處理單點故障（同機房內自動接手），DR 處理整個站點失效（另一個地點恢復）。' },
      { b: 'RPO 與 RTO', t: 'RPO 是最多能遺失多久的資料（決定備份 / 複寫頻率），RTO 是多久內要恢復服務（決定備援架構與演練）。兩個數字越小，成本越高。' },
      { b: '網路的詞', t: 'DNS 記錄把名字對到 IP；VLAN 切網段；防火牆規則是「來源、目的、port、協定、允許或拒絕」；負載平衡把流量分給多台後端並剔除不健康的。' },
      { b: '每個詞都對應一個決定', t: '聽到 rollback 就問「多久能退、資料庫怎麼辦」；聽到 change window 就問「誰核准、退版條件是什麼」；聽到 HA 就問「哪一層有備援、切換要多久」。' },
    ],
    checklist: [
      '能用一句話分別說明 SLA、SLO、SLI，並舉一個例子',
      '能說出 RPO 與 RTO 各自決定了哪些技術選擇',
      '聽到一個新的基礎建設提案時，能列出至少三個該追問的問題',
    ],
    challenge: {
      task: '一份導入會議的紀錄寫著：「下季把檢驗報告系統搬到新機房，做 HA，RPO 15 分鐘、RTO 1 小時，上線走 change window，之後用 GitOps 部署，SLO 99.9%。」把這段話裡的每個詞拆成一張工單：要交付什麼、怎麼驗收、該追問誰什麼問題。先做 [備份與備援方案守不守得住 RPO / RTO](#/exercise/devops-glossary-1)，用它的結果判斷現有的每日備份能不能留著。',
      deliver: '一張工單清單：每個詞一列，寫出交付物、驗收方式與一個要追問的問題',
      check: [
        'RPO 15 分鐘對應到備份或複寫頻率的工單，並指出每日備份守不住',
        'RTO 1 小時對應到一次計時的還原演練，驗收是演練的實際耗時，不是「有備份」',
        'HA 與 DR 拆成兩張工單，說明同一個機房的 HA 擋不住機房停電',
        'change window 那張工單寫出核准人與退版條件',
      ],
      twist: '業務改口：「RPO 放寬到 24 小時，RTO 要縮到 15 分鐘。」先預測哪幾張工單要改、哪幾張可以刪，再說明這個組合要投資的是備份頻率還是備援架構。',
    },
    refs: [
      { label: 'Google SRE Book', url: 'https://sre.google/sre-book/table-of-contents/' },
    ],
  },
  'network-troubleshooting': {
    map: {
      names: [
        { n: 'DNS 解析', t: '名字換成 IP；`dig` 回 NXDOMAIN 是名字不存在，SERVFAIL 是 DNS 伺服器自己查不下去。' },
        { n: 'split-horizon DNS', t: '同一個名字在內網與外網解析到不同的位址，或只建在內部 DNS；排查前先確認問的是哪一台。' },
        { n: 'Connection refused', t: '封包到了主機，但那個 port 沒有程式在聽（或只聽在 127.0.0.1），主機回了 RST。' },
        { n: 'timeout', t: '等不到回應，多半是防火牆丟掉封包、路由不通或主機不在；和 refused 指向不同的層。' },
        { n: '防火牆規則', t: '一條規則是來源、目的、port、協定加允許或拒絕；申請時五項都要寫清楚。' },
        { n: '502 / 503 / 504', t: 'proxy 或負載平衡產生的錯誤頁：502 後端回了壞回應、503 沒有可用的後端、504 後端太久沒回，要看 proxy 的 log。' },
        { n: 'TLS 握手', t: 'TCP 連上之後才開始；`curl -v` 停在握手或 `openssl s_client` 的驗證碼不是 0，問題在憑證，不在網路。' },
      ],
      ask: [
        '從哪裡連到哪裡：來源主機或網段、有沒有走 VPN 或 proxy。',
        '目標的名字、port 與協定，以及錯誤訊息的原文與出現的時間點。',
        '哪些地方正常：院內或院外、別台主機、別的瀏覽器。',
        '最近改了什麼：DNS 記錄、防火牆規則、憑證、負載平衡設定。',
        '每一層要用哪個指令確認，看到什麼結果就換下一層或交給哪個單位。',
      ],
      prompt: '從院外的筆電連 `https://his.example.org` 會轉圈約 30 秒後失敗，連上 VPN 就正常，院內同仁沒有問題，昨天網路組調整過防火牆。要一份排查步驟：依 DNS、路由與防火牆、proxy、TLS、應用程式的順序，每一層給一個指令（`dig`、`nc -vz`、`curl -v`、`openssl s_client`），寫出正常與故障時的輸出長相，以及看到哪個結果就換下一層或交給哪個單位。',
      verify: [
        { c: 'DNS', t: '`dig +short his.example.org @<要問的 DNS>` 內外網各問一次；空答案或 NXDOMAIN 代表名字沒建在那台，SERVFAIL 是 DNS 自己查不下去。' },
        { c: 'TCP', t: '`nc -vz -w 3 <IP> 443`：`refused` 代表封包到了主機但沒有程式在聽，3 秒後 timed out 多半是防火牆丟包或路由不通。' },
        { c: 'HTTP 與 TLS', t: '`curl -v https://…` 看停在 `Connected to`、TLS handshake 還是收到回應；收到 502、504 就去看 proxy 的 error log。' },
        { c: '憑證', t: '`openssl s_client -connect host:443 -servername host` 的 `Verify return code` 不是 0 時，看是過期、名字不符還是缺中繼。' },
        { c: 'AI 產生的排查步驟', t: '常見的錯是一開始就要人重啟服務或關掉防火牆；每一步都要先有一個能排除某一層的輸出。' },
      ],
    },
    points: [
      { b: '由下往上一層一層排', t: 'DNS 解析 → 路由可達 → 防火牆 / port → proxy → 負載平衡 → TLS → 應用程式。每一層壞掉的錯誤長相不同，先確定卡在哪層再找人。' },
      { b: 'refused 與 timeout 意義不同', t: '`Connection refused` 代表封包到了主機、但那個 port 沒有程式在聽（或被主動拒絕）；timeout 通常是封包被防火牆丟掉、路由不通或主機不在。' },
      { b: 'NXDOMAIN 與 SERVFAIL', t: '`dig` 回 NXDOMAIN 是「這個名字不存在」（打錯字、記錄沒建、問錯 DNS）；SERVFAIL 是 DNS 伺服器自己查不下去（上游壞了、DNSSEC 驗證失敗）。' },
      { b: '502 / 503 / 504 來自 proxy', t: '502：proxy 連到後端但後端拒絕或回了壞回應；503：沒有可用的後端或服務暫停；504：後端太久沒回。錯誤頁是 proxy 產生的，要看 proxy 的 log。' },
      { b: '內外網 DNS 可能不同', t: 'split-horizon DNS：同一個名字在內網解析到內部 IP、在外網解析到公開 IP。排查時先確認自己問的是哪一台 DNS。' },
    ],
    checklist: [
      '能用 dig、nc -vz、curl -v 依序確認 DNS、port、HTTP 三層',
      '看到 Connection refused 與 timeout 時，能說出各自最可能的原因',
      '能從 502 / 503 / 504 判斷要去看哪一台的 log',
    ],
    challenge: {
      task: '在 [網路壞在哪一層](#/lab/NetPathLab) 依序選「DNS 指到舊 IP」「防火牆 DROP」「port 沒人聽」「憑證網域不符」「後端掛了 502」。每一種先只看 `dig` 的輸出，寫下可以排除的層；再看 `nc -vz`、`curl -v`，每看一個輸出就再排除一層，直到剩下一層。最後做 [連不上：卡在哪一層、下一步查什麼](#/exercise/network-troubleshooting-1)。',
      deliver: '五種故障各一列：每個指令的輸出之後排除了哪一層、依據是輸出裡的哪一行',
      check: [
        '每一列都有「看到這一行，所以排除某一層」的推論，不是直接寫出答案',
        '分得出 refused 與 timeout 各自排除了什麼（refused 代表封包到了主機）',
        '502 那一列指出錯誤頁是 proxy 產生的，下一步看 proxy 的 log',
        '憑證網域不符那一列指出 TCP 已經連上，問題在 TLS',
      ],
      twist: '使用者回報「只有在家連不上，院內正常」，院內跑 `nc -vz` 是 succeeded。先預測在家跑 `dig` 最可能看到什麼、哪幾層可以先排除，再說明要請使用者在家多跑哪一個指令。',
    },
    refs: [
      { label: 'curl 手冊', url: 'https://curl.se/docs/manpage.html' },
      { label: 'libcurl 錯誤碼列表', url: 'https://curl.se/libcurl/c/libcurl-errors.html' },
    ],
  },
  'https-certificates': {
    map: {
      names: [
        { n: 'SAN', t: '憑證涵蓋的名字清單；瀏覽器只比對 SAN，用到的每個名字都要列進去。' },
        { n: '萬用字元憑證', t: '`*.example.org` 只取代最左邊一段：涵蓋 `www.example.org`，不含 `example.org` 與 `a.b.example.org`。' },
        { n: '中繼憑證與 fullchain', t: '伺服器要送網站憑證加中繼憑證；只送網站憑證時，curl、Java、App 會報 `unable to get local issuer certificate`。' },
        { n: 'DV / OV / EV', t: '差在 CA 簽發前驗證了什麼，加密強度相同；三者都受同一個最長效期限制。' },
        { n: 'ACME（HTTP-01 / DNS-01）', t: '自動申請與續約的協定；HTTP-01 要外網連得到 80 port，DNS-01 要能用 API 改公開 DNS，萬用字元只能用 DNS-01。' },
        { n: '內部 CA', t: '院內自建的 CA，只適合內網服務；每台用戶端（含伺服器與容器）都要裝根憑證。' },
        { n: '到期監控', t: '從外部連到服務、讀它實際送出的憑證到期日，和續約機制分開；例如 blackbox_exporter 的 `probe_ssl_earliest_cert_expiry`。' },
      ],
      ask: [
        '要涵蓋的每個名字，包含 apex 與多一層的子網域。',
        '對外還是只在內網，用戶端有哪些（瀏覽器、App、Java、醫療設備）。',
        '用哪種驗證方式：外網能不能連到 80 port、公開 DNS 有沒有 API。',
        '憑證放在哪些地方（nginx、負載平衡器、keystore），換完怎麼讓每一處重新載入。',
        '到期監控從哪裡量、剩幾天告警、告警送給誰。',
      ],
      prompt: '`booking.example.org` 與 `api.booking.example.org` 由兩台 nginx 提供，前面有一台負載平衡器。用 ACME 的 DNS-01（公開 DNS 有 API）自動申請一張含這兩個名字的憑證，續約後同步到兩台 nginx 並 `reload`，負載平衡器上的副本也要更新。另外寫一支從外部連線的到期檢查：分別連兩台 nginx 讀它們送出的憑證，剩不到 14 天就告警，不讀伺服器上的檔案。',
      verify: [
        { c: '名字', t: '`openssl x509 -noout -ext subjectAltName` 列出的 SAN 要包含每個用到的名字；只有 `*.example.org` 時 `example.org` 會報名字不符。' },
        { c: '信任鏈', t: '`openssl s_client -connect host:443 -servername host -showcerts` 的 Certificate chain 要有中繼；`Verify return code: 21` 是沒送中繼。' },
        { c: '實際送出的到期日', t: '對每一台後端各連一次 `s_client`，`notAfter` 都要是新憑證的日期；只看檔案會漏掉沒重新載入的那一台。' },
        { c: '續約演練', t: '`certbot renew --dry-run` 要成功，deploy hook 裡要有 reload；AI 產生的設定常漏掉 reload，或只處理一台。' },
        { c: '效期的假設', t: '流程與腳本不能假設「一年換一次」：公開憑證的最長效期自 2026 年 3 月 15 日起是 200 天，2027、2029 年還會再縮短。' },
      ],
    },
    points: [
      { b: 'DV / OV / EV 差在驗證程序', t: '三者的加密強度一樣，差別是 CA 簽發前驗了什麼：DV 只驗網域控制權，OV / EV 另外查組織身分。主流瀏覽器網址列已不顯示 EV 的公司名稱。' },
      { b: '信任鏈要完整', t: '伺服器要送出自己的憑證加上中繼憑證；漏了中繼，桌機瀏覽器有時能自己補，curl、Java、手機 App 會直接報 `unable to get local issuer certificate`。' },
      { b: 'SAN 決定涵蓋哪些名字', t: '`*.example.org` 涵蓋 `www.example.org`，不涵蓋 `example.org` 本身，也不涵蓋 `a.b.example.org`。需要的名字都要列在 SAN。' },
      { b: '內部 CA 適合院內系統', t: '只在內網用的系統可以用自建 CA 簽憑證，前提是每台用戶端（含伺服器、容器）都安裝了根憑證；對外服務要用公開 CA。' },
      { b: '效期越來越短', t: "CA/Browser Forum 已通過把公開憑證最長效期分階段縮短到 47 天的時程；Let's Encrypt 用 ACME 自動續約。手動換憑證的流程遲早會造成到期事故。" },
    ],
    checklist: [
      '能用 openssl 查出一張憑證的到期日、主體與 SAN',
      '能說明為什麼 *.example.org 不涵蓋 example.org',
      '能設計一個不靠人記得的憑證續約與到期監控機制',
    ],
    challenge: {
      task: '情境：certbot 的 log 顯示 `booking.example.org` 昨晚續約成功，今天外部監控仍告警「憑證 10 天後到期」。先在 [憑證鏈驗證](#/lab/CertChainLab) 用 `s_client -showcerts` 與 `x509 -noout` 熟悉輸出，再寫一份排查紀錄：怎麼證明服務實際送出的是舊憑證、至少三個可能的原因（服務沒重新載入、還有別的副本、新憑證寫到別的路徑），以及修正後怎麼驗收。',
      deliver: '一份排查紀錄：每一步的指令、要看的欄位，以及修正後的驗收輸出',
      check: [
        '用 `openssl s_client -connect … -servername …` 從外部讀到的 `notAfter` 判斷，不是看伺服器上的檔案',
        '列出至少兩個可能還放著舊憑證的地方（另一台後端、負載平衡器、keystore 等）',
        '修正包含續約後重新載入服務的 deploy hook，並寫出怎麼確認 hook 有執行',
        '驗收條件是外部監控讀到的到期日換成新憑證的日期',
      ],
      twist: '負載平衡器後面有兩台 nginx，只有一台換上了新憑證。先預測連續跑十次 `s_client`、監控每分鐘檢查一次，各會看到什麼，再說明監控要怎麼改才不會漏掉。',
    },
    refs: [
      { label: "Let's Encrypt 文件", url: 'https://letsencrypt.org/docs/' },
      { label: "Let's Encrypt：驗證方式（HTTP-01 / DNS-01）", url: 'https://letsencrypt.org/docs/challenge-types/' },
      { label: 'cert-manager 文件', url: 'https://cert-manager.io/docs/' },
    ],
  },
  'capacity-planning': {
    points: [
      { b: '從尖峰推，不從平均推', t: '容量要扛的是尖峰（例如門診開始的那一小時），平均值會把尖峰抹平。先找出尖峰每秒請求數，再乘上每個請求的資源成本。' },
      { b: "Little's Law：L = λW", t: '同時在處理的請求數 = 到達率 × 平均停留時間。每秒 200 個請求、每個 0.3 秒，同時就有 60 個在處理。可以拿來估連線池、worker 數。' },
      { b: '留 headroom', t: '尖峰時的使用率抓在 60–70%；有 N 台時要算「掛一台後剩下的扛不扛得住」（N+1）。使用率到 100% 已經是事故狀態。' },
      { b: '磁碟看容量也看 IOPS', t: '容量 = 現有資料 + 成長 × 年限 + 備份份數；資料庫慢常常不是空間不夠，而是隨機讀寫的 IOPS 或延遲到頂。' },
      { b: 'K8s：requests 排程、limits 設上限', t: '排程只看 requests；記憶體超過 limit 會被 OOMKilled（exit code 137），CPU 超過 limit 不會被殺、會被 throttle 變慢。' },
    ],
    checklist: [
      '能從尖峰請求數與單一請求耗時，估算需要的 CPU 核心數與同時連線數',
      '能列出估算磁碟容量時要考慮的項目（成長、索引、備份、WAL / log）',
      '能解釋 OOMKilled 與 CPU throttling 的差別與各自的處理方式',
    ],
    challenge: {
      task: '用 [容量估算](#/lab/CapacityLab) 與 [從尖峰推副本數與連線數](#/exercise/capacity-planning-1)，替一個每天 12,000 次掛號的系統估兩次：一次用全天平均的每秒請求數，一次用開放掛號後 10 分鐘的尖峰（假設那 10 分鐘湧入全天 20% 的請求）。兩次都算出 CPU 核心數、資料庫連線數（Little\'s Law）與 N+1 之後的台數；每個請求的 CPU 時間與連線佔用時間自己假設並標明。',
      deliver: '平均與尖峰兩欄並排的估算表，每一格附算式',
      check: [
        '平均與尖峰的每秒請求數都有算式，並算出尖峰是平均的幾倍',
        '連線數用 L = λW 算，W 寫明是一個請求佔用連線的時間',
        '尖峰那一欄做了 N+1，並寫出壞一台之後的使用率',
        '結論說明照平均那一欄買機器，尖峰時哪一個數字先不夠',
      ],
      twist: '換成演唱會售票：開賣第一分鐘湧入全天 30% 的請求，大部分是查剩餘座位。先預測估算表裡哪幾格變化最大，再寫出哪些條件可以從掛號沿用（Little\'s Law、N+1、headroom），哪些要跟業務重新確認（尖峰多長、能不能排隊、讀寫比例）。',
    },
    refs: [
      { label: 'Kubernetes：容器資源管理', url: 'https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/' },
    ],
  },
  'gitlab-cicd': {
    points: [
      { b: 'stages 排順序、needs 抄捷徑', t: '同一個 stage 的 job 平行跑，前一個 stage 全部成功才進下一個；`needs` 讓 job 只等它依賴的 job，不等整個 stage。' },
      { b: 'rules 決定 job 要不要出現', t: '`rules: - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH` 只在預設分支跑；`$CI_PIPELINE_SOURCE == "merge_request_event"` 只在 MR pipeline 跑。' },
      { b: 'Runner 是真正執行的機器', t: '分 instance、group、project 三種範圍，executor 有 shell、docker、kubernetes 等；用 `tags` 指定 job 跑在哪類 Runner。沒有可用 Runner，job 會卡在 pending。' },
      { b: '受保護變數只給受保護分支', t: '`protected` 變數只注入受保護分支 / tag 的 pipeline，`masked` 變數在 job log 裡顯示成 `[MASKED]`。密碼寫進 .gitlab-ci.yml 等於寫進 git 歷史。' },
      { b: 'environment + when: manual', t: '`environment: production` 讓 GitLab 記錄每次部署與版本；`when: manual` 需要有人按下才部署；搭配 `resource_group` 避免兩次部署同時跑。' },
    ],
    checklist: [
      '能寫一份有 test（含 PostgreSQL service）、build（推 image 到 Container Registry）、deploy（只在 main、手動觸發）的 .gitlab-ci.yml',
      '能說明 protected 與 masked 變數各自防的是什麼',
      '能判斷一個 job 卡在 pending 時，要檢查 Runner 的哪些設定',
    ],
    challenge: {
      task: '參考 [把 image 推到 GitLab Container Registry](#/exercise/gitlab-cicd-2) 與 [正式環境部署：只在 main、手動、不寫死機密](#/exercise/gitlab-cicd-3) 的寫法，在一個測試專案組出一條 pipeline：只 build 一次、以 `$CI_COMMIT_SHA` 為 tag 推 image，staging 與 production 兩個 deploy job 部署同一個 tag，不重新 build。跑完後從正式環境往回追：部署的 image digest 對到哪個 build job、哪個 commit、哪個 MR。',
      deliver: '一張追溯表：image digest、build job 的連結、commit SHA、MR 編號，加上兩個 deploy job 的 log 片段',
      check: [
        'staging 與 production 的 deploy log 印出相同的 image digest',
        '整條 pipeline 只有一個 job 執行 `docker build`',
        'production 的 deploy job 只在預設分支出現，而且是 `when: manual`',
        '追溯表的每一格都能從 GitLab 的頁面點到原始紀錄',
      ],
      twist: '有人要求「production 改用 `:latest`，省得每次換 tag」。先預測追溯表哪一格會斷掉、重新執行上一次的 deploy job 還能不能回到上一版，再實際改一次驗證。',
    },
    refs: [
      { label: 'GitLab：.gitlab-ci.yml 關鍵字參考', url: 'https://docs.gitlab.com/ci/yaml/' },
      { label: 'GitLab：CI/CD 變數', url: 'https://docs.gitlab.com/ci/variables/' },
      { label: 'GitLab Runner 文件', url: 'https://docs.gitlab.com/runner/' },
    ],
  },
  'k8s-readiness': {
    map: {
      names: [
        { n: 'Deployment / ReplicaSet / Pod', t: 'Deployment 管版本與滾動更新，ReplicaSet 維持 Pod 數量；Pod 隨時可能被刪掉重建。' },
        { n: 'Service', t: '給一組 Pod 穩定的名字與位址，只把流量送給 ready 的 Pod。' },
        { n: 'Ingress 與 Ingress controller', t: 'Ingress 是依網域與路徑導流量的規則，實際處理流量的是 controller；新的建置也可以評估 Gateway API。' },
        { n: 'ConfigMap / Secret', t: '把設定與機密從映像抽出來，以環境變數或檔案注入；Secret 預設只是 base64。' },
        { n: 'readiness 與 liveness', t: 'readiness 失敗是暫時不收流量，liveness 失敗是重啟容器；liveness 不檢查資料庫。' },
        { n: 'LoadBalancer 與 MetalLB', t: '`type: LoadBalancer` 要有元件配發位址；地端沒有時 `EXTERNAL-IP` 一直是 `<pending>`，MetalLB 是常見的補法。' },
        { n: 'CSI 與 PV', t: '儲存系統接 Kubernetes 的介面與實際的空間；地端要自己選儲存方案並備份。' },
        { n: '無狀態', t: 'session、上傳的檔案不存在 Pod 裡，Pod 被刪掉或多開副本時使用者感受不到。' },
      ],
      ask: [
        '要搬的服務有哪些、各自有沒有狀態（session、上傳檔、排程工作）。',
        'image 怎麼產出、用什麼當版本號，設定與密碼目前放在哪裡。',
        '叢集放在雲端代管還是地端；地端的負載平衡、儲存、憑證、監控、備份各由誰負責。',
        '誰負責叢集升級與 on-call，團隊現在會什麼、缺什麼。',
        '不導入時用什麼做到滾動更新，以及什麼條件出現時重新評估。',
      ],
      prompt: '掛號系統目前是兩台 VM 跑 docker-compose（web、api、PostgreSQL），session 存在 api 的記憶體，上傳的轉診單存在本機目錄。要一份搬上地端自建 Kubernetes 的評估：搬遷前要改的程式（session 移到 Redis、上傳改存物件儲存、設定改用環境變數）、地端要自己補的元件（LoadBalancer、Ingress controller、儲存、憑證、監控、備份）與各自的負責人，最後附上不導入時用 compose 加負載平衡做到滾動更新的做法與重新評估的條件。',
      verify: [
        { c: '無狀態', t: '把 api 開到 2 個副本、刪掉其中一個 Pod：已登入的使用者不會被登出，上傳的檔案還查得到。' },
        { c: '滾動更新', t: '新版的 readiness 故意失敗時，`kubectl rollout status` 停住、舊 Pod 繼續回 200；liveness 的端點不碰資料庫。' },
        { c: '對外位址', t: 'Ingress controller 的 Service `EXTERNAL-IP` 不是 `<pending>`；地端是 pending 代表沒有配發位址的元件。' },
        { c: '設定外部化', t: '同一個 image 換一組 ConfigMap 與 Secret 就能跑在測試與正式環境，映像裡找不到密碼（`docker history` 與 `env` 都查不到）。' },
        { c: '評估的結論', t: 'AI 產生的評估常只列優點；結論要寫出不導入的替代方案，以及哪個條件（服務數、擴展速度、人力）會讓結論翻轉。' },
      ],
    },
    points: [
      { b: '物件怎麼串', t: 'Deployment 管理 ReplicaSet、ReplicaSet 維持 Pod 數量；Service 給一組 Pod 穩定的名字與 IP；Ingress 把外部 HTTP 依網域與路徑導到 Service。' },
      { b: '設定與機密外部化', t: 'ConfigMap 放一般設定、Secret 放密碼與憑證，都以環境變數或檔案注入。Secret 預設只是 base64 編碼，要另外開 etcd 加密並限制讀取權限。' },
      { b: 'readiness 與 liveness 不同', t: 'readiness 失敗：Pod 暫時從 Service 移出、不收流量；liveness 失敗：容器被重啟。liveness 不要檢查資料庫，否則 DB 一抖所有 Pod 一起重啟。' },
      { b: '地端要自己補的東西', t: '雲端代管有的，地端自建要自己裝：LoadBalancer（如 MetalLB）、Ingress controller、儲存（CSI）、映像倉庫、憑證（cert-manager）、監控、etcd 與資料備份。' },
      { b: '先具備的能力', t: '應用程式已容器化、CI 能產出帶版本的 image、設定外部化、程式無狀態（session、上傳檔不存在本機）。這些沒做到，上 K8s 只會更難維運。' },
    ],
    checklist: [
      '能畫出一個 web + DB 系統在 K8s 上用到的物件與它們的關係',
      '能說明 readiness probe 在滾動更新時扮演的角色',
      '能列出地端自建叢集相較雲端代管，額外要負責的元件',
    ],
    challenge: {
      task: '先做 [搬上 Kubernetes 之前，補齊 Deployment 的四個缺口](#/exercise/k8s-readiness-1)，再在 [Deployment 與滾動更新](#/lab/K8sLab) 看一次 readiness 失敗與節點關機。接著替一個情境寫評估：兩台 VM 跑 docker-compose 的掛號系統、三人小組、沒有人管過叢集、session 存在記憶體。列出導入前要先具備的能力並逐項標「已具備」或「缺」，最後給出導入、暫緩或不導入的結論。',
      deliver: '一頁評估：能力清單與現況、地端要自己補的元件、結論與會讓結論改變的條件',
      check: [
        '能力清單涵蓋容器化、帶版本的 image、設定外部化、無狀態四項',
        '地端要補的元件至少列出 LoadBalancer、Ingress controller、儲存、監控、備份其中四項，並寫出負責人',
        '結論是暫緩或不導入時，寫出不導入也能做到滾動更新的做法，以及什麼條件出現就重新評估',
        '結論引用一個在實驗室看到的行為（例如 readiness 失敗時舊 Pod 繼續服務）',
      ],
      twist: '主管說：「明年服務會從 2 個變成 15 個，而且要能在 5 分鐘內加開副本。」先預測結論會不會翻轉、哪幾項「缺」變成非補不可，再改寫結論那一段。',
    },
    refs: [
      { label: 'Kubernetes 概念文件', url: 'https://kubernetes.io/docs/concepts/' },
      { label: 'Kubernetes：設定 liveness / readiness / startup probe', url: 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/' },
    ],
  },
  'hosting-models': {
    points: [
      { b: '比的是總持有成本', t: '地端要算硬體、機房空間、電力空調、授權、備品、人力與汰換週期；雲端要算運算、儲存、對外流量、專線與長期用量。只比主機報價會失真。' },
      { b: '責任分擔', t: '雲端廠商負責機房與底層硬體，作業系統修補、帳號權限、資料加密與備份多半仍是使用者的責任；代管服務（如代管資料庫）會把更多責任移給廠商。' },
      { b: '資料落地與法規先看', t: '個資、病歷等敏感資料可放在哪裡、是否能出境，要先確認適用法規與主管機關規範，這常常直接決定架構。' },
      { b: '混合雲的代價在連線', t: '地端與雲端之間要有 VPN 或專線、一致的身分認證與 DNS、跨環境的監控；延遲與頻寬會影響哪些系統能拆開放。' },
      { b: '彈性與可預期性', t: '雲端適合負載起伏大、需要快速開新環境的服務；長期穩定滿載的工作負載，地端或保留容量方案通常較省。' },
    ],
    checklist: [
      '能列出地端與雲端各自的總持有成本項目',
      '能說明雲端責任分擔模型中，使用者仍要負責的部分',
      '能為一個系統判斷適合放地端、雲端或混合，並說出依據',
    ],
    challenge: {
      task: '先做 [幾種放法：先篩條件，再比總持有成本](#/exercise/hosting-models-1)。再替同一套系統（三台應用主機、一台資料庫、50 TB 影像）做三年的總持有成本比較：地端、雲端、混合各一欄，每一欄都有一列「維運人力」，以人月計，並寫出包含哪些工作（修補、備份演練、on-call、硬體更換、帳單管理）。單價與人月數自己假設，標明哪些是假設。',
      deliver: '三欄比較表，含維運人力那一列的拆解，以及每個數字的來源（假設、報價或實測）',
      check: [
        '三欄都有維運人力，雲端那一欄不是 0',
        '每個數字都標明是假設、報價或實測',
        '寫出拿掉人力那一列之後，結論會不會翻轉',
        '寫出資料落地規範對三欄的限制，哪一欄可能直接出局',
      ],
      twist: '換成連鎖餐廳的訂位系統：一年只有母親節與跨年前一週的流量是平常的 20 倍，沒有資料出境的限制。先預測三欄的排名會怎麼變，再說明哪些條件可以沿用（人力那一列、總持有成本的項目），哪些要跟業務重新確認（尖峰天數、能接受的停機、資料放哪裡的規定）。',
    },
    refs: [
      { label: 'NIST SP 800-145：雲端運算的定義', url: 'https://csrc.nist.gov/pubs/sp/800/145/final' },
      { label: 'AWS：責任共擔模型', url: 'https://aws.amazon.com/compliance/shared-responsibility-model/' },
    ],
  },
  'data-governance': {
    points: [
      { b: '先盤點再集中', t: '列出有哪些系統、哪些資料表、誰在寫、誰在用、更新頻率多久。不知道資料從哪來，數據中台的報表就沒有人能為數字負責。' },
      { b: '同一個概念只有一個定義', t: '「門診人次」「在院病人」這類指標要有書面定義與計算 SQL；各系統的代碼表（科別、診斷碼）要對到同一份主資料。' },
      { b: '每份資料都有擁有者', t: '資料擁有者決定誰能用、定義怎麼改；資料管理員負責日常品質。沒有擁有者的資料，壞了也沒人修。' },
      { b: '品質規則寫成可以跑的檢查', t: '完整性（必填欄位空值率）、唯一性（重複病歷號）、一致性（代碼對不到）、時效性（多久沒更新）都能寫成 SQL 定期跑。' },
      { b: '權限分級與去識別化', t: '依敏感程度分級；分析用的資料先去識別化或假名化，保留可回溯的對照表並嚴格控管存取。' },
    ],
    checklist: [
      '能為一個關鍵指標寫出書面定義與對應的 SQL',
      '能用 SQL 寫出空值率、重複值、代碼對照失敗的檢查',
      '能說明資料擁有者與資料管理員的分工',
    ],
    challenge: {
      task: '情境：醫務室與財務室從中台拿到的「上月門診人次」不一樣。在 [Playground 的 PostgreSQL](#/playground?lang=sql) 自建一張虛構的 `visits` 表，放進同日多科、急診、取消後補掛、重複病歷號幾種資料。寫出醫務室版與財務室版兩份查詢，讓它們在同一份資料上算出不同的數字；再寫一份書面定義與定案版 SQL，並做 [找出重複的病歷號](#/exercise/data-governance-1)。',
      deliver: '三段 SQL（醫務室版、財務室版、定案版），加一張差異來源表：每一項定義差異造成幾筆差距',
      check: [
        '差異來源表的筆數加總，等於自己資料上兩份查詢的差距',
        '書面定義逐條回答同日多科、急診、取消、重複病歷號各怎麼算',
        '寫出這個指標的 owner，以及誰能改定義',
        '重複病歷號的檢查排在定案版查詢之前執行',
      ],
      twist: '換成零售的「上月出貨量」：倉儲部以出庫算、業務部以客戶簽收算，中間還有退貨。先預測兩個數字誰大、差距來自哪幾類事件，再說明哪些做法可以沿用（書面定義、owner、差異來源表），哪些要跟業務重新確認（以哪個時間點認列、退貨怎麼扣）。',
    },
    refs: [
      { label: 'PostgreSQL：Row Security Policies', url: 'https://www.postgresql.org/docs/current/ddl-rowsecurity.html' },
    ],
  },
  'slo-error-budget': {
    points: [
      { b: 'SLI 從使用者角度量', t: '例如「成功回應的請求比例」「95% 的請求在 500ms 內完成」；主機 CPU 高不等於使用者受影響，SLI 要量使用者感受得到的事。' },
      { b: 'SLO 是內部目標', t: 'SLO 設得比 SLA 嚴，留緩衝。99.9% 一個月約 43 分鐘不可用，99.99% 約 4.3 分鐘。每多一個 9，成本大幅增加。' },
      { b: '錯誤預算 = 1 − SLO', t: '99.9% 的 SLO 一個月有 0.1% 的錯誤預算。預算還有就可以放心部署；預算快用完就放慢變更、優先修穩定性。' },
      { b: '預算政策要事先談好', t: '預算用完時誰決定凍結部署、凍結到什麼時候、例外怎麼核准，要在事故前寫下來，不在事故當下吵。' },
      { b: '告警看燒得多快', t: '用 burn rate（預算消耗速度）告警：一小時燒掉大量預算要立刻叫人，緩慢消耗開工單即可，避免半夜被小抖動叫醒。' },
    ],
    checklist: [
      '能把一個服務的可用性需求寫成 SLI 與 SLO',
      '能算出某個 SLO 在 30 天內的錯誤預算（分鐘或請求數）',
      '能說明錯誤預算用完時團隊應該做什麼',
    ],
    challenge: {
      task: '在 [SLO 與錯誤預算](#/lab/SloLab) 用 99.9% 的目標比較「第 5 天全面中斷 30 分」與「持續 1% 錯誤率」：各自的燃燒率與預算燒完的日子。再替兩種情況各做一個告警決定：立刻叫人、開工單，或不告警；用 [錯誤預算剩多少、燒得多快](#/exercise/slo-error-budget-1) 的算法驗證你的燃燒率。',
      deliver: '兩種情況的對照表：燃燒率、預算燒完的日子、告警決定與理由',
      check: [
        '30 分鐘中斷那一列寫出中斷期間的燃燒率，並算出它一次用掉約七成的月預算（43.2 分鐘中的 30 分鐘）',
        '1% 錯誤率那一列算出燃燒率 10、約 3 天燒完',
        '兩個告警決定都用燃燒率加上視窗長度說明理由',
        '說明只用「錯誤率 > 5% 持續 5 分鐘」的規則會漏掉哪一種',
      ],
      twist: '換成演唱會售票：開賣的 15 分鐘佔了全月八成的請求。先預測開賣時 5 分鐘的 50% 錯誤，以請求數計與以時間計的 SLI 各燒掉多少預算，再說明哪些條件可以沿用（燃燒率的算法、多視窗告警），哪些要跟業務重新確認（以請求還是時間計、開賣時段要不要另訂目標）。',
    },
    refs: [
      { label: 'Google SRE Book：Service Level Objectives', url: 'https://sre.google/sre-book/service-level-objectives/' },
      { label: 'Google SRE Workbook：Implementing SLOs', url: 'https://sre.google/workbook/implementing-slos/' },
    ],
  },
  'incident-response': {
    points: [
      { b: '先止血再找原因', t: '事故當下的目標是恢復服務：回滾、切備援、暫時關掉功能。根本原因留到恢復之後的檢討。' },
      { b: '角色分開', t: '事故指揮官統籌與決策、處理者動手修、溝通者對外更新狀態。一個人同時修又回訊息，兩件事都做不好。' },
      { b: '分級決定動員範圍', t: '依影響範圍與嚴重度分級（例如 SEV1–SEV3），每一級對應要通知誰、多久內回應、多久更新一次狀態。' },
      { b: 'on-call 要可持續', t: '每個告警都要對應 runbook 且需要人處理；輪班有交接、有備援、有補休。告警太多會讓人習慣性忽略。' },
      { b: 'postmortem 不咎責', t: '寫時間線、影響、原因、做得好與不好的地方，產出有負責人與期限的改善項目。改善項目針對系統與流程，不追究個人。' },
    ],
    checklist: [
      '能說出事故指揮官、處理者、溝通者各自的職責',
      '能為一個常見告警寫出 runbook 的步驟',
      '能寫一份包含時間線、影響、原因與改善項目的 postmortem',
    ],
    challenge: {
      task: '情境：凌晨 2:10 起掛號 API 的 p95 從 300 ms 升到 4 s；2:25 回滾了 1:50 上線的版本，延遲只降到 1.5 s；3:00 要交班。先做 [從時間線算出 postmortem 的時間欄位](#/exercise/incident-response-1)，再寫一份交班用的事故摘要：目前狀態、已排除的原因與證據、進行中的動作、下一班第一件要做的事、下一次對外更新的時間。',
      deliver: '一份不超過 15 行的交班摘要',
      check: [
        '每個已排除的原因都附證據（例如回滾後仍慢，所以新版本不是唯一原因）',
        '下一班的第一件事是具體的動作（查哪個指標、找誰），不是「持續觀察」',
        '寫了下一次對外更新的時間，沒有承諾修好的時間',
        '另一個人只讀摘要就能說出現在的事故指揮官是誰',
      ],
      twist: '換成航空公司的線上訂位：同樣的症狀發生在早鳥票開賣的時段，業務要求每 15 分鐘對外更新一次。先預測摘要哪幾段要改，再說明哪些做法可以沿用（角色、時間線、先止血），哪些要跟業務重新確認（分級門檻、對外溝通的對象與頻率、能不能暫停開賣）。',
    },
    refs: [
      { label: 'Google SRE Book：Managing Incidents', url: 'https://sre.google/sre-book/managing-incidents/' },
      { label: 'Google SRE Book：Postmortem Culture', url: 'https://sre.google/sre-book/postmortem-culture/' },
    ],
  },
  'change-management': {
    points: [
      { b: '變更要留下可稽核的紀錄', t: '誰提出、改了什麼、為什麼、誰核准、何時上線、結果如何。MR、pipeline 紀錄、部署紀錄串起來，本身就是變更證據。' },
      { b: '依風險分級', t: '標準變更（例行、低風險、已預先核准）、一般變更（要審核）、緊急變更（先做後補件）。不分級就會變成所有變更都排隊等會議。' },
      { b: '回復計畫寫在變更前', t: '每個變更都要有退版步驟與判斷條件：看到什麼指標就退、誰決定退。資料庫 migration 要先想好能不能退。' },
      { b: '職責分離', t: '寫程式的人不能自己核准自己的變更上線；用 MR 核准規則與受保護環境落實，而不是靠口頭約定。' },
      { b: '變更時段與凍結期', t: '高風險變更排在離峰的 change window；重大活動或年度結算前設凍結期。小而頻繁的變更風險反而比大批次低。' },
    ],
    checklist: [
      '能列出一份變更申請必須包含的欄位',
      '能說明標準變更、一般變更、緊急變更的差別',
      '能說明如何用 GitLab 的 MR 核准與受保護環境落實職責分離',
    ],
    challenge: {
      task: '先做 [變更單送審前：審核層級與缺漏檢查](#/exercise/change-management-1)。再扮演稽核：拿一筆正式環境的部署紀錄（自己的測試專案，或深入內容裡的 `.gitlab-ci.yml` 範例），往回追出變更單要的每一項證據：誰提出、誰核准、核准時間是否早於部署、部署的版本和測試過的是否同一個、回復計畫寫在哪、有沒有演練過。找不到的項目標成缺漏。',
      deliver: '一張追溯表：證據項目、在 GitLab 的哪個頁面或欄位、找到或缺漏',
      check: [
        '核准者與 MR 作者不是同一人，並寫出是哪個設定擋住自己核准自己',
        '核准時間早於部署 job 的開始時間',
        '部署的 image tag 或 digest 與測試 pipeline 的相同',
        '回復計畫有對應的 job 或文件，並註明是否演練過',
      ],
      twist: '換成物流公司的倉儲系統：旺季前兩週進入凍結期，但運費計算有一個錯誤要修。先預測這筆變更該走標準、一般還是緊急，再說明哪些證據可以沿用，哪些要跟業務重新確認（凍結期的例外由誰核准、算錯的運費要不要回溯）。',
    },
    refs: [
      { label: 'GitLab：Protected environments', url: 'https://docs.gitlab.com/ci/environments/protected_environments/' },
      { label: 'GitLab：Merge request approvals', url: 'https://docs.gitlab.com/user/project/merge_requests/approvals/' },
    ],
  },
}

// P9 新課的內文放在 parts/ 底下，這裡合併
export default { ...base, ...l4, ...m2, ...m4, ...n1, ...n2, ...n3, ...n4 }

// 領域 9：DevOps 與基礎建設 的技能內文（以技能 id 為 key）
export default {
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
    refs: [
      { label: 'Google SRE Book', url: 'https://sre.google/sre-book/table-of-contents/' },
    ],
  },
  'network-troubleshooting': {
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
    refs: [
      { label: 'curl 手冊', url: 'https://curl.se/docs/manpage.html' },
      { label: 'libcurl 錯誤碼列表', url: 'https://curl.se/libcurl/c/libcurl-errors.html' },
    ],
  },
  'https-certificates': {
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
    refs: [
      { label: "Let's Encrypt 文件", url: 'https://letsencrypt.org/docs/' },
      { label: "Let's Encrypt：驗證方式（HTTP-01 / DNS-01）", url: 'https://letsencrypt.org/docs/challenge-types/' },
      { label: 'cert-manager 文件', url: 'https://cert-manager.io/docs/' },
    ],
  },
  'capacity-planning': {
    points: [
      { b: '從尖峰推，不從平均推', t: '容量要扛的是尖峰（例如門診開始的那一小時），平均值會把尖峰抹平。先找出尖峰每秒請求數，再乘上每個請求的資源成本。' },
      { b: "Little's Law：L = λW", t: '同時在處理的請求數 = 到達率 × 平均停留時間。每秒 200 個請求、每個 0.3 秒，同時就有 60 個在處理——用來估連線池、worker 數。' },
      { b: '留 headroom', t: '尖峰時的使用率抓在 60–70%；有 N 台時要算「掛一台後剩下的扛不扛得住」（N+1）。100% 不是目標，是事故。' },
      { b: '磁碟看容量也看 IOPS', t: '容量 = 現有資料 + 成長 × 年限 + 備份份數；資料庫慢常常不是空間不夠，而是隨機讀寫的 IOPS 或延遲到頂。' },
      { b: 'K8s：requests 排程、limits 設上限', t: '排程只看 requests；記憶體超過 limit 會被 OOMKilled（exit code 137），CPU 超過 limit 不會被殺、會被 throttle 變慢。' },
    ],
    checklist: [
      '能從尖峰請求數與單一請求耗時，估算需要的 CPU 核心數與同時連線數',
      '能列出估算磁碟容量時要考慮的項目（成長、索引、備份、WAL / log）',
      '能解釋 OOMKilled 與 CPU throttling 的差別與各自的處理方式',
    ],
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
    refs: [
      { label: 'GitLab：.gitlab-ci.yml 關鍵字參考', url: 'https://docs.gitlab.com/ci/yaml/' },
      { label: 'GitLab：CI/CD 變數', url: 'https://docs.gitlab.com/ci/variables/' },
      { label: 'GitLab Runner 文件', url: 'https://docs.gitlab.com/runner/' },
    ],
  },
  'k8s-readiness': {
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
    refs: [
      { label: 'PostgreSQL：Row Security Policies', url: 'https://www.postgresql.org/docs/current/ddl-rowsecurity.html' },
    ],
  },
  'slo-error-budget': {
    points: [
      { b: 'SLI 從使用者角度量', t: '例如「成功回應的請求比例」「95% 的請求在 500ms 內完成」；主機 CPU 高不等於使用者受影響，SLI 要量使用者感受得到的事。' },
      { b: 'SLO 是內部目標', t: 'SLO 設得比 SLA 嚴，留緩衝。99.9% 一個月約 43 分鐘不可用，99.99% 約 4.3 分鐘——每多一個 9，成本大幅增加。' },
      { b: '錯誤預算 = 1 − SLO', t: '99.9% 的 SLO 一個月有 0.1% 的錯誤預算。預算還有就可以放心部署；預算快用完就放慢變更、優先修穩定性。' },
      { b: '預算政策要事先談好', t: '預算用完時誰決定凍結部署、凍結到什麼時候、例外怎麼核准，要在事故前寫下來，不在事故當下吵。' },
      { b: '告警看燒得多快', t: '用 burn rate（預算消耗速度）告警：一小時燒掉大量預算要立刻叫人，緩慢消耗開工單即可，避免半夜被小抖動叫醒。' },
    ],
    checklist: [
      '能把一個服務的可用性需求寫成 SLI 與 SLO',
      '能算出某個 SLO 在 30 天內的錯誤預算（分鐘或請求數）',
      '能說明錯誤預算用完時團隊應該做什麼',
    ],
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
      { b: 'postmortem 不咎責', t: '寫時間線、影響、原因、做得好與不好的地方，產出有負責人與期限的改善項目。目標是改系統，不是找戰犯。' },
    ],
    checklist: [
      '能說出事故指揮官、處理者、溝通者各自的職責',
      '能為一個常見告警寫出 runbook 的步驟',
      '能寫一份包含時間線、影響、原因與改善項目的 postmortem',
    ],
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
    refs: [
      { label: 'GitLab：Protected environments', url: 'https://docs.gitlab.com/ci/environments/protected_environments/' },
      { label: 'GitLab：Merge request approvals', url: 'https://docs.gitlab.com/user/project/merge_requests/approvals/' },
    ],
  },
}

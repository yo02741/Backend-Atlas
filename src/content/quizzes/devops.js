// 題庫：DevOps 與基礎建設
export default [
  {
    skill: 'devops-glossary',
    questions: [
      {
        q: '一個系統每天凌晨 2 點做一次完整備份，實測從備份還原整套系統需要約 6 小時。最壞情況下的 RPO 與 RTO 大約是多少？',
        options: [
          'RPO 約 6 小時、RTO 約 24 小時：備份間隔決定恢復要多久，還原時間決定會遺失多少資料',
          'RPO 約 24 小時、RTO 約 6 小時：兩次備份之間的資料可能全部遺失，恢復服務則要等還原完成',
          'RPO 為 0、RTO 約 6 小時：每天都有備份，所以不會遺失資料，只差在還原需要時間',
          'RPO 與 RTO 都約 6 小時：兩個指標都是由還原所需的時間決定，和備份頻率無關',
        ],
        answer: 1,
        explain: 'RPO 問的是「最多遺失多久的資料」，由備份或複寫的間隔決定：凌晨 2 點備份、隔天凌晨 1 點出事，這將近 24 小時的資料都不在備份裡。RTO 問的是「多久恢復服務」，由還原流程決定，這裡實測 6 小時。第一個選項把兩者對調；「每天有備份所以 RPO 為 0」忽略了兩次備份之間的空窗；兩者都看還原時間則混淆了遺失資料與停機時間這兩件不同的事。',
      },
      {
        q: '這兩個部署 job 違反了「環境晉升」的哪個原則？',
        code: `deploy-staging:
  script:
    - docker build -t $CI_REGISTRY_IMAGE:staging .
    - docker push $CI_REGISTRY_IMAGE:staging
    - ./deploy.sh staging $CI_REGISTRY_IMAGE:staging

deploy-production:
  when: manual
  script:
    - docker build -t $CI_REGISTRY_IMAGE:prod .
    - docker push $CI_REGISTRY_IMAGE:prod
    - ./deploy.sh production $CI_REGISTRY_IMAGE:prod`,
        lang: 'yaml',
        options: [
          '晉升必須全自動，production 不該設成 when: manual，人工步驟會讓流程無法稽核',
          'staging 與 production 應該推到兩個不同的 registry，共用一個 registry 不算晉升',
          'production 重新 build 了一次，上線的 image 不是 staging 驗證過的那一個',
          'image tag 應該統一用 latest，這樣兩個環境才會自動拿到同一個版本',
        ],
        answer: 2,
        explain: '環境晉升的核心是「同一個 artifact 一路往上部署，只換設定」。production 重新 build 時，base image、相依套件都可能在兩次 build 之間更新，staging 測過的東西和上線的東西就不一樣了。正確做法是 build 一次、用 commit SHA 當 tag，兩個環境部署同一個 tag。手動核准是常見且合理的晉升關卡；用不同 registry 不是必要條件；latest 會讓人無法得知各環境實際跑的是哪個版本，反而更糟。',
      },
      {
        q: '廠商報價寫著：「同機房三台主機組成叢集，具備 HA；DR 方案另外報價。」這句話代表什麼？',
        options: [
          '單台主機故障時服務可以自動接手，但整個機房停電或失效時，沒有在其他地點恢復的能力',
          'HA 已經涵蓋機房層級的故障，DR 只是額外的備份軟體授權，有每日備份就可以不買',
          'HA 代表資料完全不會遺失（RPO 為 0），DR 代表服務完全不會中斷（RTO 為 0）',
          'HA 與 DR 是同一件事的兩種說法，另外報價通常只是把同一個功能拆開計費',
        ],
        answer: 0,
        explain: 'HA 處理的是同一地點內的單點故障：一台壞了另一台接手。三台都在同一個機房，機房停電、網路中斷或火災時會一起停，這是 DR 要回答的問題：在另一個地點恢復。要不要買 DR，取決於這個系統要求的 RPO / RTO。有備份不等於有 DR，還需要可還原的機器與演練過的流程；RPO / RTO 是兩個要另外訂的目標，不是 HA、DR 的定義。',
      },
    ],
  },
  {
    skill: 'network-troubleshooting',
    questions: [
      {
        q: '`nc -vz -w 3 10.20.0.15 5432` 回傳 `Connection refused`。這個結果最能支持哪個推論？',
        options: [
          '中間的防火牆把封包丟掉了，要請網路組檢查網段之間的規則',
          '封包到了主機，但 5432 沒有程式在聽，或服務只聽在 127.0.0.1',
          'DNS 把名字解析到錯誤的 IP，要先用 dig 確認解析結果',
          'PostgreSQL 的 TLS 憑證不被信任，要檢查用戶端的根憑證設定',
        ],
        answer: 1,
        explain: 'Connection refused 代表目的主機收到連線請求並回了 RST，所以封包確實到了那台主機；問題在主機上：服務沒啟動、聽錯 port，或只聽在 localhost，用 ss -ltn 確認。防火牆丟封包的典型結果是 timeout，不是 refused。這裡直接連 IP，沒有經過 DNS；TLS 發生在 TCP 連上之後，連 TCP 都沒建立，不可能是憑證問題。',
      },
      {
        q: '在外面（沒連 VPN）打不開 `his.example.org`，連上 VPN 就正常。根據下面的輸出，最合理的解讀是？',
        code: `$ dig +short his.example.org @10.0.0.53
10.20.0.15
$ dig +short his.example.org @1.1.1.1
$`,
        lang: 'bash',
        options: [
          '公開 DNS 的快取還沒更新，等 TTL 過期後外網就能解析到 10.20.0.15',
          '10.20.0.15 這台主機只在連 VPN 時開機，外網查詢時剛好是關機狀態',
          '1.1.1.1 被這台電腦的防火牆擋住了，所以查詢沒有回應、答案是空的',
          '這個名字只在內部 DNS 有記錄（split-horizon），外網本來就解析不到，要連 VPN 或另設對外入口',
        ],
        answer: 3,
        explain: '內部 DNS（10.0.0.53）回了內網 IP，公開 DNS 回空答案，這是 split-horizon DNS 的典型樣子：名字只建在內部 DNS。就算公開 DNS 有記錄，10.20.0.x 是私有位址，外網也連不到，所以「等 TTL 過期」不會解決。DNS 解析和主機開不開機無關；若 1.1.1.1 被擋，dig 會印出逾時訊息，而不是乾淨的空結果。',
      },
      {
        q: '使用者執行一個大型報表，約 60 秒後看到 nginx 產生的 `504 Gateway Timeout` 頁面。應該先查哪裡？',
        options: [
          '用戶端到 nginx 之間的防火牆，504 代表使用者的連線被中途切斷',
          '網站的 TLS 憑證，504 常見於憑證快到期時瀏覽器拒絕繼續等待',
          'nginx 與後端之間：後端處理超過 proxy_read_timeout，看 nginx error log 的 upstream timed out 與後端的慢查詢',
          'DNS 記錄的 TTL，504 代表 nginx 解析後端名稱的時間超過了上限',
        ],
        answer: 2,
        explain: '504 是 proxy 產生的，意思是「我連得到後端，但後端在時限內沒回應」。nginx 的 proxy_read_timeout 預設 60 秒，和「約 60 秒後出現」吻合；error log 會有 upstream timed out (110: Connection timed out) while reading response header from upstream，接著要找後端為什麼慢（常見是慢查詢）。使用者能看到 nginx 的錯誤頁，代表用戶端到 nginx 的連線與 TLS 都是通的；DNS 問題不會表現為固定 60 秒後的 504。',
      },
    ],
  },
  {
    skill: 'https-certificates',
    questions: [
      {
        q: '一張憑證的 SAN 只有 `*.example.org`。下列名字中，它能涵蓋哪些：`example.org`、`portal.example.org`、`api.v2.example.org`？',
        options: [
          'example.org 與 portal.example.org 都可以，萬用字元也包含網域本身',
          '只有 portal.example.org；萬用字元只代表最左邊一段，不涵蓋 apex，也不涵蓋多一層的子網域',
          'portal.example.org 與 api.v2.example.org 都可以，萬用字元涵蓋所有層級的子網域',
          '三個都可以，只要名字的結尾是 example.org，瀏覽器就會視為相符',
        ],
        answer: 1,
        explain: '萬用字元 * 只能在最左邊、只取代剛好一段。portal.example.org 是一段加 example.org，相符；example.org 少了一段，是 apex，不相符；api.v2.example.org 多了一段，也不相符。要涵蓋 apex 就把 example.org 另外列進 SAN；要涵蓋 v2 底下的名字，需要 *.v2.example.org 或逐一列出。',
      },
      {
        q: '預約網站用 Chrome 打開正常，但手機 App 與 `curl` 都報憑證錯誤。`openssl s_client` 的輸出如下，最可能的原因是？',
        code: `depth=0 CN = booking.example.org
verify error:num=20:unable to get local issuer certificate
depth=0 CN = booking.example.org
verify error:num=21:unable to verify the first certificate
---
Certificate chain
 0 s:CN = booking.example.org
   i:C = TW, O = Example Org, CN = Example Issuing CA
---
    Verify return code: 21 (unable to verify the first certificate)`,
        lang: 'bash',
        options: [
          '憑證已經過期，Chrome 有寬限期所以還能開，其他用戶端沒有寬限期',
          '憑證的 SAN 沒有 booking.example.org，Chrome 會忽略名字不符的問題',
          '手機與 curl 用的 TLS 版本太舊，要在伺服器上重新開啟 TLS 1.0',
          '伺服器只送了網站憑證、沒送中繼憑證；Chrome 會自己補，其他用戶端不會，要改用 fullchain 檔案',
        ],
        answer: 3,
        explain: 'Certificate chain 只有一層（0），簽發者是一張中繼憑證，用戶端無法從網站憑證往上接到根憑證，所以報 unable to verify the first certificate。桌機瀏覽器常用快取或自動下載補上中繼憑證，curl、App 通常不會。修法是讓伺服器送出網站憑證加中繼憑證（fullchain）。過期會是 certificate has expired；名字不符時 Chrome 也會擋；輸出裡沒有任何握手失敗的跡象，與 TLS 版本無關。',
      },
      {
        q: '上一次憑證過期造成停機後，有人提議：「改買 EV 憑證，比較安全也比較不會出事。」比較合理的回應是？',
        options: [
          'EV 與 DV 的加密強度相同，網址列也已不顯示公司名稱；差在組織驗證程序。要防到期事故，該做的是自動續約與獨立的到期監控',
          'EV 使用較長的金鑰與較強的加密演算法，確實比 DV 安全，應該對外服務全面改用',
          'EV 的效期可以長達三年，換證次數少，自然比較不容易發生到期事故',
          'EV 會讓瀏覽器顯示綠色網址列與公司名稱，使用者能辨識假網站，可以有效防止釣魚',
        ],
        answer: 0,
        explain: 'DV、OV、EV 的差別在 CA 簽發前驗證了什麼，不在加密強度。主流瀏覽器在 2019 年前後已移除網址列上的 EV 公司名稱，防釣魚的效果也就不成立。所有公開憑證都受同一個最長效期限制，而且正逐步縮短，沒有三年效期的 EV。到期事故的根本原因是續約流程依賴人工，和憑證類型無關。',
      },
    ],
  },
  {
    skill: 'capacity-planning',
    questions: [
      {
        q: '尖峰時每秒 200 個請求，每個請求平均佔用一條資料庫連線 0.15 秒。依 Little\'s Law，同時佔用的連線數大約是多少？',
        options: [
          '約 200 條：每秒有 200 個請求，每個請求都需要自己的一條連線',
          '約 1,333 條：到達率除以停留時間，200 ÷ 0.15',
          '約 30 條：L = λW = 200 × 0.15，連線池要大於這個數字再加餘裕',
          '約 15 條：連線可以被重複使用，所以實際需求大約是 λW 的一半',
        ],
        answer: 2,
        explain: "Little's Law：系統裡同時存在的數量 L 等於到達率 λ 乘上平均停留時間 W。每秒進來 200 個、每個佔用 0.15 秒，平均同時有 30 條在用。每個請求一條是忽略了連線用完會歸還；用除法是公式寫反；「重複使用所以減半」也不對，重複使用已經反映在 W 只有 0.15 秒這件事上。這也說明為什麼資料庫一變慢（W 變大），需要的連線數會跟著暴增。",
      },
      {
        q: '一個 Pod 反覆重啟，`kubectl describe pod` 顯示如下。最合理的判斷與下一步是？',
        code: `    Last State:     Terminated
      Reason:       OOMKilled
      Exit Code:    137
    Restart Count:  5
    Limits:
      memory:  512Mi
    Requests:
      cpu:     250m
      memory:  512Mi`,
        lang: 'bash',
        options: [
          'CPU 用量超過 limit 被系統殺掉，應該把 CPU request 從 250m 調高到 1',
          '記憶體用量超過 512Mi 被核心殺掉；先看記憶體曲線，判斷是需求真的比較大還是洩漏，再決定調整 limit 或修程式',
          'liveness probe 連續失敗導致重啟，應該把 probe 的 initialDelaySeconds 調長',
          '節點的磁碟空間不足，kubelet 驅逐了這個 Pod，應該清理節點上的映像檔',
        ],
        answer: 1,
        explain: 'Reason: OOMKilled 與 Exit Code 137（128 + SIGKILL 的 9）表示容器的記憶體超過 limit，被核心直接終止。CPU 超過 limit 不會被殺，只會被 throttle 變慢。liveness 失敗的事件會是 Liveness probe failed，Reason 不會是 OOMKilled；磁碟壓力造成的是驅逐（Evicted），不是容器重啟。用量隨時間一路上升不回落時是洩漏，只調高 limit 只會延後被殺的時間。',
      },
      {
        q: '三台應用程式主機分擔流量，尖峰時每台 CPU 約 75%。主管問：「還有 25% 餘裕，需要擴充嗎？」比較正確的回答是？',
        options: [
          '不需要：75% 低於 100%，還能多扛三分之一的流量，等到 90% 再評估',
          '不需要：之後導入 Kubernetes 會自動擴展，現在不必另外計算容量',
          '需要，但只要把 CPU 換成更高時脈即可，主機台數多寡不影響可靠度',
          '需要：壞一台時剩下兩台要各扛約 112% 的負載，服務會跟著倒；要能在少一台時仍低於目標使用率',
        ],
        answer: 3,
        explain: '三台各 75% 合計是 2.25 台份的負載，壞一台後由兩台分擔，每台約 112%，超過能力上限。N+1 的意思是少一台時仍扛得住尖峰，而且最好還在 60–70% 的目標使用率以內。自動擴展需要有資源可以擴、也需要正確的 requests 設定，不能取代容量計算；換更快的 CPU 也不改變「壞一台會怎樣」這個問題。',
      },
    ],
  },
  {
    skill: 'gitlab-cicd',
    questions: [
      {
        q: '功能分支開了 merge request，觸發的是 MR pipeline（`CI_PIPELINE_SOURCE` 為 `merge_request_event`）。這條 pipeline 裡會出現哪些 job？',
        code: `test:
  script: pytest
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

deploy:
  script: ./deploy.sh
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      when: manual`,
        lang: 'yaml',
        options: [
          '只有 test：deploy 唯一的規則在 MR pipeline 不成立（MR pipeline 裡也沒有 CI_COMMIT_BRANCH），所以不會加入',
          'test 和 deploy 都會出現，deploy 是手動 job，要有人按下才執行',
          '兩個都不會出現：rules 裡沒有寫 when: on_success，符合條件也不會加入',
          '只有 deploy：test 的第一條規則成立後，會跳過後面的規則並排除這個 job',
        ],
        answer: 0,
        explain: 'rules 由上往下比對，第一條成立的規則生效，沒寫 when 時預設是 on_success。test 的第一條在 MR pipeline 成立，所以加入；deploy 只有一條規則，要求分支是預設分支，MR pipeline 裡 CI_COMMIT_BRANCH 根本沒有值，條件不成立，job 不會出現（manual 也不會出現）。「第一條成立就排除」把機制講反了。',
      },
      {
        q: '部署用的 `DEPLOY_TOKEN` 在專案設定裡勾了 masked、沒有勾 protected。這樣的設定有什麼風險？',
        options: [
          '沒有風險：masked 變數在 GitLab 裡是加密儲存的，job 拿到的也只是遮蔽後的值',
          '任何能 push 分支的人都能在自己的分支改 .gitlab-ci.yml，把 token 編碼後印出或傳到外部；masked 只遮 log 裡的原字串',
          '沒有勾 protected 的變數連 main 分支都拿不到，部署 job 會因為變數是空的而失敗',
          '非受保護分支的 pipeline 會因為讀不到 masked 變數而整條失敗，影響開發者跑測試',
        ],
        answer: 1,
        explain: 'protected 的作用是只把變數注入受保護分支或 tag 的 pipeline。沒勾時，任何分支的 pipeline 都拿得到真實的值，修改 .gitlab-ci.yml 的人可以把它 base64 後印出、寫進 artifact 或送到外部，這些都不會被遮蔽。masked 只是把 log 裡出現的原字串換成 [MASKED]，job 拿到的是真實值。沒勾 protected 不會讓 main 拿不到變數，也不會讓 pipeline 失敗。',
      },
      {
        q: '部署 job 加上 `tags: [prod-network]` 之後一直停在 pending，同一條 pipeline 的其他 job 都正常。最可能的原因是？',
        options: [
          'needs 的寫法錯誤，導致 job 一直在等一個不存在的上游 job',
          'GitLab Container Registry 的空間滿了，job 無法下載執行用的 image',
          '沒有線上的 Runner 帶 prod-network 標籤，或那台 Runner 設成 protected，而這條 pipeline 跑在非受保護分支',
          '這個 job 用到的 masked 變數格式不符合要求，GitLab 暫停了整個 job',
        ],
        answer: 2,
        explain: 'tags 決定 job 只能被帶有這些標籤的 Runner 接走。沒有符合的線上 Runner、或符合的 Runner 是 protected 而分支不受保護時，job 就停在 pending，頁面會提示沒有可用的 Runner。needs 指向不存在的 job 會在建立 pipeline 時就報錯；下載 image 失敗會讓 job 開始後失敗，不是 pending；masked 格式不符是在設定變數時就不允許勾選。',
      },
    ],
  },
  {
    skill: 'k8s-readiness',
    questions: [
      {
        q: '某個 Deployment 的 livenessProbe 會檢查資料庫連線。資料庫因維護重啟約 30 秒時，最可能發生什麼？',
        options: [
          'Pod 會暫時從 Service 移出、不收流量，資料庫恢復後自動加回，對使用者影響很小',
          '沒有影響：liveness probe 只在容器剛啟動時檢查一次，之後不會再執行',
          'Deployment 會偵測到失敗並自動回滾到上一個版本，等資料庫恢復再重新部署',
          '所有 Pod 的 liveness 同時失敗、一起被重啟，重啟後又同時去連資料庫，短暫的維護被放大成全面停機',
        ],
        answer: 3,
        explain: 'liveness 失敗的處理是重啟容器。它檢查外部依賴時，依賴一抖，所有副本會同時失敗、同時重啟。「暫時移出、恢復後加回」是 readiness probe 的行為，外部依賴的狀態比較適合放在 readiness，或乾脆不放。liveness 會依 periodSeconds 持續執行；Deployment 不會因為 probe 失敗而自動回滾。',
      },
      {
        q: '在地端自建的叢集上建立了一個 `type: LoadBalancer` 的 Service，三天後狀態仍如下。原因與處理方式是？',
        code: `$ kubectl get svc -n ingress-nginx
NAME                       TYPE           CLUSTER-IP     EXTERNAL-IP   PORT(S)
ingress-nginx-controller   LoadBalancer   10.96.141.22   <pending>     80:31380/TCP,443:31443/TCP`,
        lang: 'bash',
        options: [
          'Pod 的 readiness probe 沒有通過，Service 要等至少一個 Pod ready 才會分配外部 IP',
          '叢集裡沒有負責分配外部 IP 的元件；地端要安裝 MetalLB 之類的元件或接既有的負載平衡器，並跟網路組協調一段 IP',
          'CLUSTER-IP 與內網網段衝突，要重建叢集並更換 Service 的網段設定',
          'DNS 還沒有這個 Service 的記錄，要先在內部 DNS 建立 A 記錄，EXTERNAL-IP 才會出現',
        ],
        answer: 1,
        explain: 'type: LoadBalancer 需要有元件實際去建立或分配負載平衡位址。雲端代管服務會自動建立雲端負載平衡器；地端自建沒有這個元件時，EXTERNAL-IP 永遠是 <pending>。MetalLB 這類元件從預留的內網 IP 中分配位址並對外宣告。Pod 是否 ready 不影響外部 IP 的分配；DNS 記錄是拿到 IP 之後才建的；輸出裡沒有網段衝突的跡象。',
      },
      {
        q: '一個系統準備搬上 Kubernetes 並開 3 個副本。它的登入狀態存在應用程式記憶體裡，上傳的檔案存在本機的 `/srv/app/uploads/`。搬遷前最先要處理什麼？',
        options: [
          '把 session 移到 Redis 或資料庫、上傳檔案改存物件儲存或共享儲存，讓應用程式無狀態',
          '在 Ingress 開啟 sticky session，讓同一個使用者一直連到同一個 Pod，程式就不必修改',
          '把 replicas 設成 1，只有一個 Pod 時就不會有狀態不一致，同樣能做到零停機更新',
          '把 uploads 目錄掛成 emptyDir volume，檔案就會在 Pod 重啟後保留下來',
        ],
        answer: 0,
        explain: 'Pod 隨時可能被刪除或重新排程，本機記憶體與檔案系統都會跟著消失，所以狀態要放在 Pod 之外。sticky session 只能讓請求盡量回到同一個 Pod，Pod 被重建時登入狀態一樣消失，上傳檔案的問題也沒解決。單一副本在更新與節點故障時一定會中斷。emptyDir 的生命週期與 Pod 相同，Pod 刪除時內容也會被刪掉。',
      },
    ],
  },
  {
    skill: 'hosting-models',
    questions: [
      {
        q: '比較地端與雲端的成本時，下列哪一種做法最容易得出失真的結論？',
        options: [
          '把 3–5 年的硬體汰換、維護合約與維運人力，都算進地端的成本',
          '把雲端的對外流量、儲存、備份與專線費用，都列進雲端的估算',
          '只比較主機的採購價與雲端同規格 VM 的月租，其他費用另案處理',
          '用既有系統的實際用量曲線，而不是尖峰規格，去估算雲端的月費',
        ],
        answer: 2,
        explain: '總持有成本才是可比較的數字：地端還有機房空間、電力空調、授權、備品、人力與汰換；雲端還有流量、儲存、專線、備份與長期用量。只比主機價格會同時低估兩邊，而且低估的項目不同，結論常常相反。其他三個選項都是讓估算更接近實際的做法。',
      },
      {
        q: '一個系統放在公有雲的 VM（IaaS）上，因為作業系統的安全更新長期沒套用而被入侵。依一般的責任分擔模型，這屬於誰的責任？',
        options: [
          '雲端廠商：VM 跑在廠商的機房與硬體上，所有安全問題都由廠商負責',
          '雲端廠商與使用者各半：作業系統是廠商提供的映像檔，修補責任共同分擔',
          '無法判斷：要等事故調查確認攻擊者利用的是哪一層的漏洞才能決定',
          '使用者：IaaS 下廠商負責機房與底層硬體，VM 內的作業系統修補、帳號與資料保護由使用者負責',
        ],
        answer: 3,
        explain: '責任分擔模型依服務類型劃分：IaaS 裡，廠商負責實體機房、硬體與虛擬化層，VM 裡的作業系統、修補、應用程式、帳號權限與資料保護都是使用者的責任。廠商提供映像檔不代表它負責之後的修補。改用代管服務（例如代管資料庫）時，作業系統與資料庫軟體的修補才會轉給廠商，這也是代管服務的價值之一。',
      },
      {
        q: '依規範，含個資的病歷資料要留在地端；但團隊想用雲端做彈性的統計運算。採用混合雲時，最需要先規劃的是什麼？',
        options: [
          '地端與雲端之間的連線（VPN 或專線）與頻寬延遲、一致的身分認證，以及哪些資料能出境（例如只傳去識別化資料）',
          '只要雲端廠商通過資安認證，病歷資料就可以整批搬上雲端，地端只保留備份即可',
          '雲端廠商會負責兩端之間的網路與權限整合，使用者只要選好主機規格即可',
          '先在雲端開最大規格的主機，確保統計運算的效能，其他問題上線後再處理',
        ],
        answer: 0,
        explain: '混合雲的難處在兩端之間：網路連線決定延遲與能傳多少資料、身分認證要一致才能管權限、資料分級決定什麼能離開地端。廠商的認證不會改變法規對資料存放位置的要求；兩端的整合是使用者的工作；規格可以之後依用量調整，資料能不能出境卻必須事先確定。',
      },
    ],
  },
  {
    skill: 'data-governance',
    questions: [
      {
        q: '在資料治理裡，「資料擁有者」與「資料管理員」的分工，下列哪個描述最正確？',
        options: [
          '資料擁有者是存放資料的系統或資料庫，資料管理員是負責該系統的資訊人員',
          '資料擁有者負責備份與還原，資料管理員負責決定欄位定義與誰能存取',
          '資料擁有者決定定義、用途與誰能存取，並為資料負責；資料管理員負責日常的品質檢查與維護',
          '兩者是同一個角色的不同稱呼，通常由資訊部主管一人兼任即可',
        ],
        answer: 2,
        explain: '資料擁有者通常是業務單位，對資料的定義、用途與存取權限有決定權，也為資料的正確性負責；資料管理員負責執行：品質規則、問題追蹤、日常維護。擁有者是人或單位，不是系統；備份還原屬於系統維運，不是擁有者的核心職責；兩個角色分開，才能讓「誰決定」與「誰執行」都有人負責。',
      },
      {
        q: '這個查詢檢查的是哪一類資料品質問題？',
        code: `SELECT v.dept_code, COUNT(*) AS cnt
FROM visits v
LEFT JOIN dept_codes d ON d.dept_code = v.dept_code
WHERE d.dept_code IS NULL
GROUP BY v.dept_code;`,
        lang: 'sql',
        options: [
          '唯一性：找出同一個科別代碼在 visits 裡重複出現的次數',
          '一致性：找出就診紀錄裡、在科別代碼表中對不到的代碼與筆數',
          '時效性：找出代碼表裡已經很久沒有就診紀錄的科別',
          '完整性：找出代碼表裡缺少名稱或說明欄位的科別',
        ],
        answer: 1,
        explain: 'LEFT JOIN 之後 d.dept_code IS NULL，代表 visits 的這個代碼在 dept_codes 找不到對應，這是一致性（參照完整性）檢查。dept_code 本身是 NULL 的就診紀錄也會出現在結果裡（NULL 對不到任何代碼），所以結果同時能看出空值。它沒有檢查重複，也沒有看時間；方向是從 visits 找 dept_codes，不是檢查代碼表本身的欄位。',
      },
      {
        q: '數據中台上線後，兩份報表的「上月門診人次」差了 8%，兩個單位都說自己的數字才對。第一步應該做什麼？',
        options: [
          '以數字較大的那一份為準，因為漏算比重複計算更常見',
          '把兩個來源系統的資料都完整複製進中台，資料集中之後數字自然會一致',
          '換用效能更好的資料庫重新計算，排除查詢逾時造成的筆數差異',
          '寫下這個指標的書面定義與計算 SQL（例如同日多科是否算多次、是否含急診），並指定擁有者確認',
        ],
        answer: 3,
        explain: '兩個數字不同，最常見的原因是定義不同：同一人同日看多科算一次還是多次、急診與遠距門診算不算、以掛號或報到為準。沒有書面定義，誰也無法證明自己對。指標要有定義、有對應的 SQL、有擁有者裁決。挑大的數字沒有依據；資料集中不會讓定義變一致；查詢效能與定義差異無關。',
      },
    ],
  },
  {
    skill: 'slo-error-budget',
    questions: [
      {
        q: '一個服務的可用性 SLO 是 30 天內 99.9%。以時間計算，這 30 天的錯誤預算大約是多少？',
        options: [
          '約 4.3 分鐘',
          '約 43 分鐘',
          '約 7.2 小時',
          '約 8.8 小時',
        ],
        answer: 1,
        explain: '30 天 = 43,200 分鐘，錯誤預算是 1 − 99.9% = 0.1%，43,200 × 0.001 ≈ 43 分鐘。4.3 分鐘是 99.99% 的預算；7.2 小時是 99% 的 30 天預算；約 8.8 小時是 99.9% 換算成一整年的量。每多一個 9，預算少十倍，所以 SLO 不是越高越好，要對應實際需求與成本。',
      },
      {
        q: '這段 SQL 從請求紀錄算出一個 SLI。它的定義是什麼？',
        code: `SELECT
  COUNT(*) FILTER (WHERE status < 500 AND latency_ms <= 500)::numeric
    / COUNT(*) AS sli
FROM requests
WHERE ts >= now() - interval '30 days';`,
        lang: 'sql',
        options: [
          '過去 30 天裡，平均延遲低於 500 毫秒的天數佔全部天數的比例',
          '過去 30 天裡，回應狀態碼小於 500 的請求數量，不考慮延遲',
          '過去 30 天裡，既沒有 5xx 錯誤、又在 500 毫秒內完成的請求，佔全部請求的比例',
          '過去 30 天裡，主機處於可用狀態的時間佔總時間的比例',
        ],
        answer: 2,
        explain: 'FILTER 只計算同時滿足 status < 500 與 latency_ms <= 500 的請求，再除以全部請求數，得到「好的請求比例」。這是以請求為單位的 SLI，同時考慮錯誤與延遲；4xx 被算成好的請求，因為那通常是用戶端的問題。它不是以天為單位，也不是主機可用時間——主機活著但回 5xx，在這個定義下就是壞的請求。',
      },
      {
        q: '月中時，服務已經用掉了這個月 100% 的錯誤預算，但對外的 SLA 還沒有違反。依錯誤預算的精神，團隊接下來該怎麼做？',
        options: [
          '依事先約定的政策，放慢或暫停非必要的變更，優先處理造成預算消耗的穩定性問題',
          '把 SLO 從 99.9% 調低到 99.5%，讓這個月的預算重新變成正數',
          '加快新功能上線的速度，用更多改善補回使用者對服務的觀感',
          '不需要處理：SLA 還沒違反，錯誤預算只是內部參考數字',
        ],
        answer: 0,
        explain: '錯誤預算的用途是讓「何時該放慢、先修穩定性」有客觀依據：預算用完代表可靠度已經低於目標，繼續大量變更只會再增加風險。預算用完時怎麼做，應該在事先寫好的政策裡。為了數字好看而調低 SLO 失去了設定目標的意義；SLO 設得比 SLA 嚴，正是為了在違反 SLA 之前就採取行動。',
      },
    ],
  },
  {
    skill: 'incident-response',
    questions: [
      {
        q: '新版本上線 10 分鐘後，錯誤率從 0.1% 升到 15%，原因還不清楚。事故處理的第一步應該是？',
        options: [
          '先找出根本原因再修正，直接回滾會掩蓋問題、之後更難重現',
          '先回滾到上一個版本恢復服務，保留 log 與相關資料，原因留到服務恢復後再查',
          '先召集相關人員撰寫 postmortem，把目前已知的時間線記錄下來',
          '先觀察半小時收集更多數據，確認錯誤率不是短暫的波動再處理',
        ],
        answer: 1,
        explain: '事故當下的首要目標是恢復服務。錯誤率與新版上線時間高度相關，回滾是最快的止血方式；保留 log、metrics 與錯誤樣本，就不會因為回滾而失去調查線索。邊停機邊找根因，會讓使用者承受整段調查時間；postmortem 是恢復之後的工作；15% 的錯誤率已經是明確的影響，等待只會擴大損害。',
      },
      {
        q: '下面這份 runbook 最主要的問題是什麼？',
        code: `# runbook：資料庫主機磁碟使用率 > 90%
1. 登入主機查看 df -h
2. 視情況清理空間
3. 處理完回報主管`,
        lang: 'bash',
        options: [
          '步驟太少：runbook 至少要有十個步驟，才能涵蓋所有可能的情況',
          '應該把 df -h 換成圖形化的監控畫面截圖，讓非技術人員也能看懂',
          '告警門檻 90% 太低，應該改成 98% 才不會在半夜吵醒 on-call',
          '步驟無法照著執行：沒說要查哪些目錄、什麼可以刪、什麼不能刪、何時要升級給誰、怎麼確認已恢復',
        ],
        answer: 3,
        explain: 'runbook 的價值是讓半夜被叫醒、不熟這個系統的人也能安全處理。「視情況清理」把判斷全部丟給處理者，在資料庫主機上誤刪 WAL 或資料檔會讓事故更嚴重。好的 runbook 寫明：先看哪些目錄（log、WAL、暫存）、可以安全刪除的項目、絕對不能動的項目、超過多久或什麼情況要升級給誰、怎麼確認已恢復。步驟數量不是重點；98% 的門檻幾乎沒有處理時間。',
      },
      {
        q: '一份 postmortem 的結論寫著：「工程師 A 誤刪正式環境資料表，已口頭告誡，請大家以後小心。」這份結論最大的問題是？',
        options: [
          '口頭告誡不夠正式，應該改成書面懲處，才能讓其他人引以為戒',
          '結論沒有寫出 A 的完整姓名與職稱，之後追蹤責任時會有困難',
          '把原因歸給個人、沒有系統性的改善項目；應該追問為什麼系統允許直接刪除正式資料表、還原花了多久，並產出有負責人與期限的改善項目',
          '誤刪資料屬於操作失誤，不算事故，不需要寫 postmortem',
        ],
        answer: 2,
        explain: '不咎責的 postmortem 關注的是系統哪裡允許錯誤發生：為什麼一般帳號能在正式環境刪表、為什麼沒有審核或防呆、備份還原實際花了多久。「請大家小心」不會改變任何機制，同樣的事會再發生。加重懲處只會讓人以後隱瞞錯誤。造成服務或資料影響的操作失誤正是最需要檢討的事故類型。',
      },
    ],
  },
  {
    skill: 'change-management',
    questions: [
      {
        q: '每月例行的作業系統安全更新，流程已經演練多次、有自動化腳本與已驗證的回復步驟。這類變更最適合歸類為？',
        options: [
          '標準變更：例行、低風險、程序固定，可以預先核准，不必每次送審',
          '一般變更：任何會影響正式環境的變更，都必須每次送變更委員會審核',
          '緊急變更：安全更新都和資安有關，應該一律走緊急程序以求最快上線',
          '不需要列入變更管理：作業系統更新屬於日常維運，不是變更',
        ],
        answer: 0,
        explain: '標準變更是為這種情況設計的：程序固定、風險已知、結果可預期，事先核准一次程序，之後照程序執行並留下紀錄即可。全部送審會讓審核會議塞滿例行事項，真正高風險的變更反而得不到注意。緊急變更是給不能等的情況用的，不是給例行作業；作業系統更新會改變正式環境，仍要有紀錄可稽核。',
      },
      {
        q: '這份變更申請最關鍵的缺漏是什麼？',
        code: `{
  "title": "檢驗系統資料庫升級至 PostgreSQL 16",
  "window": "2026-11-08 22:00 – 02:00",
  "approver": "資訊部主管",
  "steps": ["停止服務", "執行 pg_upgrade", "啟動服務", "功能測試"],
  "risk": "低"
}`,
        lang: 'json',
        options: [
          '時段應該排在白天上班時間，廠商與使用者都在，出問題比較容易聯絡',
          '沒有回復計畫與判斷條件：什麼情況決定退回、怎麼退、需要多久；而且資料庫大版本升級標成低風險偏低',
          '缺少每個步驟執行者的手機號碼，出事時無法立即聯絡到人',
          '內部系統的升級不需要核准人，列出資訊部主管會拖慢流程',
        ],
        answer: 1,
        explain: '變更申請最重要的是出錯時怎麼辦：退回的步驟、多久內要做出決定、看到什麼指標就退、退回需要多少時間（pg_upgrade 之後能否直接退、是否需要先做好完整備份與還原演練）。資料庫大版本升級影響範圍大、難以快速退回，風險標成低會讓審核者低估它。聯絡方式也有用，但不是最關鍵的；白天變更會影響更多使用者；核准是職責分離的一部分，不是可以省略的流程。',
      },
      {
        q: '週六深夜發現一套對外系統的漏洞正在被利用，需要立即上修補，但變更委員會週二才開會。比較恰當的做法是？',
        options: [
          '等到週二變更委員會開會核准後再上線，避免繞過流程造成稽核缺失',
          '直接修補上線，事情緊急，不必留紀錄也不必事後說明',
          '走緊急變更程序：由授權的人先核准執行並留下紀錄，事後補齊文件，並在下次會議檢討',
          '先把整套系統關閉到週二，等核准後再修補並重新上線',
        ],
        answer: 2,
        explain: '緊急變更程序就是為「不能等」的情況設計的：事先指定有權在緊急時核准的人，執行時照樣留下紀錄，事後補件並檢討。等到週二讓攻擊持續三天；不留紀錄會破壞稽核軌跡，也無法追蹤這次修補帶來的影響；關閉整套系統可能是選項之一，但也要走緊急程序決定，而且通常不是唯一或最好的選擇。',
      },
    ],
  },
]

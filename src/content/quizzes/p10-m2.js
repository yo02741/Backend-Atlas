// 題庫：P10 新課（m2 批）——k8s-manifests / k8s-config-probes / k8s-troubleshooting / k8s-helm-gitops
export default [
  {
    skill: 'k8s-manifests',
    questions: [
      {
        q: '下面的 Deployment 與 Service 用 `kubectl apply` 套用，兩個物件都建立成功、Pod 也都 ready。接下來會發生什麼事？',
        code: 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: booking-api\nspec:\n  replicas: 3\n  selector:\n    matchLabels:\n      app: booking-api\n  template:\n    metadata:\n      labels:\n        app: booking-api\n    spec:\n      containers:\n        - name: api\n          image: registry.example.org/booking/api:3f9c2a1b\n          ports:\n            - containerPort: 8000\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: booking-api\nspec:\n  selector:\n    app: booking_api\n  ports:\n    - port: 80\n      targetPort: 8000',
        lang: 'yaml',
        options: [
          'Service 會自動改用同名 Deployment 的 Pod，因為兩者的 metadata.name 相同',
          'Service 選不到任何 Pod，後端是空的；連 Service 會失敗，但沒有任何錯誤訊息提醒',
          'Deployment 的滾動更新會卡住，直到 Service 的 selector 修正為止',
          'Service 找不到符合的 Pod 時，會退而把流量分給 namespace 裡所有的 Pod',
        ],
        answer: 1,
        explain: 'Service 只靠 selector 比對 Pod 的 label，`booking_api`（底線）對不到 `booking-api`（連字號），所以後端是空的。API server 不會擋：一個目前選不到 Pod 的 Service 是合法的物件。名稱相同不會讓它們自動關聯；Deployment 的更新與 Service 無關；Service 也不會退而選取所有 Pod。套用後要用 `kubectl get endpointslices` 確認。',
      },
      {
        q: 'Deployment 設定 `replicas: 4`、`maxSurge: 1`、`maxUnavailable: 0`。滾動更新期間，Pod 總數與可用的 Pod 數各受什麼限制？',
        options: [
          '總數最多 4 個、可用至少 3 個',
          '總數最多 5 個、可用至少 3 個',
          '總數最多 8 個、可用至少 4 個',
          '總數最多 5 個、可用至少 4 個',
        ],
        answer: 3,
        explain: '總數上限是 replicas + maxSurge = 5，可用數下限是 replicas − maxUnavailable = 4。也就是先多開一個新的、等它 ready，才關一個舊的，容量不會掉，但節點要有多放一個 Pod 的空間。「最多 4、至少 3」是 maxSurge 0、maxUnavailable 1 的結果；「最多 5、至少 3」是兩者都是 1（或預設的 25%）的結果。',
      },
      {
        q: '新版部署後錯誤率飆高，確定是新版的問題。團隊的 manifest 放在 Git，由 CI 執行 `kubectl apply`。哪一種處理方式最完整？',
        options: [
          '執行 kubectl rollout undo 回到上一版，接著把 Git 裡的 image tag 也改回去，否則下一次 apply 會把壞的版本再部署一次',
          '把出錯的 Pod 逐一 kubectl delete，讓 Deployment 重建出健康的 Pod',
          '把 replicas 先改成 0 再改回原本的數字，強迫所有 Pod 重新啟動',
          '修改 Service 的 selector，讓流量暫時不要進到這個 Deployment',
        ],
        answer: 0,
        explain: '`rollout undo` 把 Deployment 的 template 換回上一個 ReplicaSet 的內容，是最快的止血方式；但它只改了叢集，Git 裡還是壞的版本，所以要接著修正 manifest。刪 Pod 或把副本數歸零再調回來，重建出來的仍是同一份（壞的）template。改 Service 的 selector 會讓服務直接沒有後端。',
      },
    ],
  },
  {
    skill: 'k8s-config-probes',
    questions: [
      {
        q: '資料庫切換時中斷了 40 秒。事後發現 API 的所有 Pod 在同一時間被重啟，資料庫恢復後服務又多停了一分多鐘。最可能是哪個設定造成的？',
        options: [
          'readiness 探針檢查了資料庫，所以 Pod 被移出 Service 後就被重啟',
          'limits.memory 設得太小，資料庫中斷時 Pod 被 OOMKilled',
          'liveness 探針的端點會檢查資料庫，中斷期間每個 Pod 的 liveness 都失敗而被重啟',
          '沒有設定 startupProbe，所以資料庫一中斷容器就重新啟動',
        ],
        answer: 2,
        explain: 'liveness 失敗的後果是重啟容器。它檢查資料庫時，資料庫一中斷，所有 Pod 同時失敗、同時重啟，重啟後還要重新啟動與重建連線，把短暫的中斷放大。readiness 失敗只會把 Pod 移出 Service，不會重啟；OOMKilled 與資料庫中斷沒有直接關係；startupProbe 只在啟動階段有作用。liveness 應該只檢查程序本身。',
      },
      {
        q: '容器的資源設定如下。執行中記憶體用量漲到 600Mi，同時 CPU 需求漲到 1 核。會發生什麼事？',
        code: 'resources:\n  requests:\n    cpu: "250m"\n    memory: "256Mi"\n  limits:\n    cpu: "500m"\n    memory: "512Mi"',
        lang: 'yaml',
        options: [
          '記憶體超過 limits，容器被 OOMKilled 後重啟；CPU 超過 limits 則是被節流、變慢，不會被殺',
          'CPU 與記憶體都超過 limits，兩者都會讓容器被殺掉重啟',
          '兩者都只是被節流：程式變慢，但容器不會重啟',
          '排程器發現超過 requests，把 Pod 搬到資源比較多的節點',
        ],
        answer: 0,
        explain: '記憶體是不可壓縮的資源，超過 `limits.memory` 就被 OOMKilled（Exit Code 137）；CPU 是可壓縮的，超過 `limits.cpu` 只會被節流，回應變慢。requests 只在排程時使用，執行中超過 requests 是正常的，排程器也不會因此搬移 Pod。',
      },
      {
        q: 'HPA 的目標是 CPU 平均使用率 60%（`autoscaling/v2`，type 為 Utilization）。目前 4 個副本，平均使用率 90%。HPA 算出的期望副本數是多少？這個使用率的分母是什麼？',
        options: [
          '5 個；分母是容器的 CPU limits',
          '6 個；分母是節點的 CPU 總量',
          '8 個；分母是容器的 CPU requests',
          '6 個；分母是容器的 CPU requests',
        ],
        answer: 3,
        explain: '期望副本數 = ceil(目前副本數 × 目前指標 ÷ 目標指標) = ceil(4 × 90 ÷ 60) = 6。Utilization 型別的使用率是「實際用量 ÷ requests」，所以容器沒寫 CPU requests 時 HPA 算不出來，requests 寫多寫少也會直接影響何時擴展。它不看 limits，也不看節點的 CPU 總量。',
      },
    ],
  },
  {
    skill: 'k8s-troubleshooting',
    questions: [
      {
        q: 'Pod 的狀態如下，`kubectl logs booking-api-7c5d9f8b66-h2m8q` 沒有印出有用的內容。下一步最該做什麼？',
        code: 'NAME                           READY   STATUS             RESTARTS      AGE\nbooking-api-7c5d9f8b66-h2m8q   0/1     CrashLoopBackOff   5 (40s ago)   4m',
        lang: 'bash',
        options: [
          '用 kubectl exec 進容器裡，手動執行啟動指令看錯誤',
          '加上 --previous 看上一次執行的 log，並用 describe 看 Last State 的結束原因與 Exit Code',
          '刪掉這個 Pod，讓 Deployment 重建一個新的',
          '把 Deployment 的副本數調高，讓其他 Pod 分擔',
        ],
        answer: 1,
        explain: 'CrashLoopBackOff 表示容器啟動後一直結束，`logs` 預設看的是剛重啟的這一次，常常還沒有內容；`--previous` 才是掛掉的那一次。`describe` 的 Last State 可以分辨是程式錯誤、被 liveness 重啟還是 OOMKilled。容器不在執行中時 exec 進不去；刪掉重建或加副本，新的 Pod 用的是同一份範本，會停在同樣的狀態。',
      },
      {
        q: 'Pod 停在 Pending，Events 裡有 `0/3 nodes are available: 3 Insufficient cpu.`。這則訊息的意思是什麼？',
        options: [
          '三個節點目前的 CPU 使用率都是 100%，要等負載降下來',
          '容器的 CPU 用量超過 limits，被排程器暫停',
          '每個節點上尚未被保留的 CPU，都放不下這個 Pod 的 requests；與節點當下的實際使用率無關',
          '映像太大，節點沒有足夠的 CPU 可以解壓縮',
        ],
        answer: 2,
        explain: '排程器只看 requests：節點上所有 Pod 的 requests 加總到頂之後，新的 Pod 就排不上去，即使節點實際上很閒。所以要檢查的是這個 Pod 的 requests 是否過大，以及節點已分配的量（`kubectl describe node`）。Pending 的 Pod 還沒有容器在跑，談不上超過 limits；拉映像的問題會是 ImagePullBackOff。',
      },
      {
        q: '某個服務的 Pod 全部是 Running、READY 1/1、RESTARTS 0，但其他服務連它的 Service 一律失敗。`kubectl get endpointslices` 顯示這個 Service 沒有任何後端位址。最可能的原因是？',
        options: [
          'Service 的 selector 與 Pod 的 label 對不上，或兩者不在同一個 namespace',
          'readiness 探針沒有通過，所以 Pod 沒被加進後端',
          'Service 的 targetPort 寫成了程式沒有在監聽的 port',
          'NetworkPolicy 擋住了來源 Pod 的流量',
        ],
        answer: 0,
        explain: '後端是空的只有兩種可能：selector 選不到 Pod，或選到的 Pod 沒有 ready。題目的 Pod 都是 READY 1/1，所以是 selector（或 namespace）的問題。targetPort 寫錯或 NetworkPolicy 擋住時，EndpointSlice 仍然會列出 Pod 的位址，症狀分別是連線被拒絕與逾時。',
      },
    ],
  },
  {
    skill: 'k8s-helm-gitops',
    questions: [
      {
        q: 'base 的 Deployment 有一個名為 `api` 的容器（含 image、env、探針）。overlay 用下面的補丁（strategic merge patch）。合併後的結果是什麼？',
        code: 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: booking-api\nspec:\n  replicas: 6\n  template:\n    spec:\n      containers:\n        - name: api\n          resources:\n            limits:\n              memory: 1Gi',
        lang: 'yaml',
        options: [
          'containers 清單整個被補丁取代，api 容器只剩 name 與 resources，image 不見了',
          '補丁缺少 image 這個必填欄位，kubectl kustomize 會報錯',
          '補丁只能修改 replicas 這種純量欄位，containers 的部分會被忽略',
          'replicas 變成 6；api 容器保留原本的 image、env 與探針，只有 limits.memory 被改成 1Gi',
        ],
        answer: 3,
        explain: 'strategic merge patch 逐層合併：純量直接取代，`containers` 這個清單依 `name` 找到同名的容器後再往下合併，所以補丁只需要寫 name 與要改的欄位。補丁本身不是完整的 manifest，不需要必填欄位。要注意的是，沒有合併鍵資訊的清單（多數自訂資源）才是整個取代。',
      },
      {
        q: '團隊從「CI 直接 `kubectl apply`」改成 GitOps（叢集內的控制器從 Git 拉取並同步）。下列哪一項是這個改變帶來的實際差別？',
        options: [
          'CI 不再需要 build 映像，控制器會從原始碼自動產生',
          '從此不需要管理秘密，因為控制器會自動加密 Git 裡的 Secret',
          '叢集的憑證不必再交給 CI；有人直接用 kubectl 改了線上物件時，控制器會發現與 Git 不一致並修正或標示',
          '部署一定會變快，因為控制器在每次 git push 的瞬間就完成同步',
        ],
        answer: 2,
        explain: 'pull 式的重點是：憑證留在叢集內、CI 只寫 Git，以及控制器持續比對期望狀態與實際狀態（drift 會被修正或標示）。CI 仍然要 build、測試、推映像；Secret 仍然不能以原文進 Git，要另外用 Sealed Secrets、External Secrets 這類做法；同步靠定期拉取或通知觸發，不保證比 push 式快，而且多了一套元件要維運。',
      },
      {
        q: '採用 GitOps 後，資料庫密碼也需要有「期望狀態」。下列哪一種做法可以接受？',
        options: [
          '把 Secret 的 YAML 放進設定 repo，因為 data 欄位已經過 base64 處理',
          '在 Git 裡放一份 ExternalSecret 之類的參照，由叢集內的控制器到秘密管理服務取值後產生 Secret',
          '把密碼寫進 Helm 的 values.yaml，因為 Helm 安裝時會自動加密',
          '把密碼放進 ConfigMap，並把設定 repo 設成私有',
        ],
        answer: 1,
        explain: 'Git 裡只能放「加密後的版本」（Sealed Secrets、SOPS）或「參照」（External Secrets），秘密的原文留在秘密管理服務或只有叢集解得開。base64 是編碼不是加密，任何能讀 repo 的人都能還原；Helm 不會加密 values；ConfigMap 沒有任何保護，私有 repo 也擋不住有讀取權限的人與歷史紀錄。',
      },
    ],
  },
]

// 領域內文（d9-devops，m2 批）：以技能 id 為 key，由 body/d9-devops.js 合併。只放這些技能：k8s-manifests, k8s-config-probes, k8s-troubleshooting, k8s-helm-gitops
export default {
  'k8s-manifests': {
    points: [
      { b: '一個對外的服務要三份 manifest', t: 'Deployment（`apps/v1`）管副本數、Pod 範本與更新方式；Service（`v1`）給一組 Pod 穩定的名稱與 port；Ingress（`networking.k8s.io/v1`）依網域與路徑把外部流量導到 Service。三者要在同一個 namespace。' },
      { b: '靠 label 與 selector 接線', t: '四條接線：Ingress 的 backend 對到 Service 的名稱與 port、Service 的 selector 對到 Pod 的 label、targetPort 對到容器監聽的 port、Deployment 的 selector 對到 template 的 label。只有最後一條寫錯會被 API server 擋下，其他都是套用成功但不通。' },
      { b: 'image 用固定 tag', t: '`latest` 換了內容時 manifest 沒有變，`kubectl apply` 不會觸發更新，之後重建的 Pod 才拉到新內容，同一個 Deployment 跑著不同版本，也沒有上一個 tag 可以回退。用 commit SHA 或版本號。' },
      { b: 'maxSurge 與 maxUnavailable 決定滾動更新的節奏', t: '更新期間 Pod 總數不超過 replicas + maxSurge、可用數不低於 replicas − maxUnavailable。`maxSurge: 1`、`maxUnavailable: 0` 不掉容量但需要多餘的節點資源；反過來不需要多餘資源但會短暫少一個副本。' },
      { b: '套用之後要逐條確認', t: '`kubectl apply -f` 回 created 不代表通了。用 `rollout status` 等更新完成、`get endpointslices` 確認 Service 選到了 Pod、`port-forward` 直接測 Service、`describe` 看 Events；出問題用 `rollout undo` 回上一版，再把 Git 裡的 manifest 改回來。' },
    ],
    checklist: [
      '能寫出一組 Deployment、Service、Ingress，並指出四條接線分別在哪幾個欄位',
      '給定 replicas、maxSurge、maxUnavailable，能算出滾動更新期間 Pod 總數的上限與可用數的下限',
      '套用後能用 kubectl 確認 Service 後面有 Pod，並在新版出錯時回退',
    ],
    refs: [
      { label: 'Kubernetes：Deployments', url: 'https://kubernetes.io/docs/concepts/workloads/controllers/deployment/' },
      { label: 'Kubernetes：Service', url: 'https://kubernetes.io/docs/concepts/services-networking/service/' },
      { label: 'Kubernetes：Ingress', url: 'https://kubernetes.io/docs/concepts/services-networking/ingress/' },
      { label: 'Kubernetes：Labels and Selectors', url: 'https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/' },
      { label: 'Gateway API', url: 'https://gateway-api.sigs.k8s.io/' },
    ],
  },
  'k8s-config-probes': {
    points: [
      { b: 'ConfigMap 放設定、Secret 放機密', t: '三種注入方式：單一環境變數（`valueFrom`）、整批環境變數（`envFrom`）、掛成檔案。環境變數只在容器啟動時讀一次，改了 ConfigMap 要重建 Pod 才生效。Secret 的值只是 base64 編碼，不是加密，YAML 原文不進 Git。' },
      { b: '三種探針各管一件事', t: 'readiness 失敗：從 Service 的後端移出，不重啟。liveness 失敗：重啟容器。startup：啟動完成前暫停另外兩種。從出問題到判定失敗大約是 periodSeconds × failureThreshold。' },
      { b: 'liveness 不檢查外部依賴', t: 'liveness 檢查資料庫時，資料庫短暫中斷會讓所有 Pod 同時被重啟，重啟後又同時重連，把一次抖動放大成全面停機。liveness 只看程序本身，依賴放在 readiness。' },
      { b: 'requests 決定排程，limits 決定上限', t: '排程器只看 requests。CPU 超過 limits 被節流、變慢；記憶體超過 limits 被 OOMKilled（Exit Code 137）並重啟。HPA 的 CPU 使用率以 requests 為分母：期望副本數 = ceil(目前副本數 × 目前指標 ÷ 目標指標)。' },
      { b: '優雅關機要三個條件', t: '程式處理 SIGTERM（停止接新請求、做完手上的）；PID 1 是應用程式本身；`terminationGracePeriodSeconds` 夠長。移出 Service 與送 SIGTERM 是並行的，常見做法是加一小段 `preStop` 等待。' },
    ],
    checklist: [
      '能替一份 Deployment 寫出 readiness、liveness 探針，並說明各自打哪個端點、為什麼',
      '能說明記憶體與 CPU 超過 limits 時各自發生什麼事，並用公式算出 HPA 的期望副本數',
      '能把寫死在 manifest 裡的密碼改成從 Secret 讀取，並說明 Secret 為什麼不能直接進 Git',
    ],
    refs: [
      { label: 'Kubernetes：ConfigMaps', url: 'https://kubernetes.io/docs/concepts/configuration/configmap/' },
      { label: 'Kubernetes：Secrets', url: 'https://kubernetes.io/docs/concepts/configuration/secret/' },
      { label: 'Kubernetes：Configure Liveness, Readiness and Startup Probes', url: 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/' },
      { label: 'Kubernetes：Resource Management for Pods and Containers', url: 'https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/' },
      { label: 'Kubernetes：Horizontal Pod Autoscaling', url: 'https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/' },
    ],
  },
  'k8s-troubleshooting': {
    points: [
      { b: '固定的排查順序', t: '`kubectl get pods` 看 STATUS、READY、RESTARTS → `describe pod` 看 Events 與 Last State → `logs`（容器重啟過就加 `--previous`）→ `get events`。Events 是 Kubernetes 的視角，logs 是程式的視角；容器沒啟動過就沒有 log。' },
      { b: 'Pending 與 ImagePullBackOff 看 Events', t: 'Pending：節點放不下 requests、taint 或節點條件不符、PVC 沒綁定，原因寫在 FailedScheduling 的訊息裡。ImagePullBackOff：映像名稱或 tag 不存在、私有倉庫沒有 imagePullSecrets、節點不信任 registry 的憑證。' },
      { b: 'CrashLoopBackOff 看上一次的 log 與結束原因', t: '程式啟動後就結束，kubelet 以加倍的間隔重啟。`logs --previous` 看上一次的輸出；`describe` 的 Last State 分辨是程式錯誤（Exit Code 1）、被 liveness 重啟，還是 OOMKilled（Exit Code 137，log 裡找不到原因）。' },
      { b: 'Running 但連不到：從 Service 往下查', t: 'EndpointSlice 是空的：selector 對不上 label，或 Pod 沒有 ready。有位址但被拒絕：targetPort 寫錯或程式只聽 127.0.0.1。逾時：NetworkPolicy。Ingress 的 404 是規則沒對到、503 是 Service 後面沒有 Pod、502 是連到 Pod 但失敗。' },
      { b: '刪掉重建修不好問題', t: '範本沒改，重建的 Pod 會停在同樣的狀態，前一次的 log 與事件還會消失。`exec` 進執行中的容器、`port-forward` 跳過 Ingress 直接測、`kubectl debug` 帶工具進沒有 shell 的容器；在容器裡改的東西重建後就不見。' },
    ],
    checklist: [
      '看到 Pending、ImagePullBackOff、CrashLoopBackOff、OOMKilled，能說出各自的下一個指令與要找的線索',
      'Pod 是 Running 但 Service 連不到時，能依序檢查 EndpointSlice、selector、readiness、targetPort',
      '能說明 logs 與 Events 各自回答什麼問題，以及什麼時候要加 --previous',
    ],
    refs: [
      { label: 'Kubernetes：Debug Pods', url: 'https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/' },
      { label: 'Kubernetes：Debug Services', url: 'https://kubernetes.io/docs/tasks/debug/debug-application/debug-service/' },
      { label: 'Kubernetes：Debug Running Pods', url: 'https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/' },
      { label: 'Kubernetes：Pod Lifecycle', url: 'https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/' },
    ],
  },
  'k8s-helm-gitops': {
    points: [
      { b: '多個環境不要複製貼上', t: '每個環境一份完整的 YAML，時間一久分不出哪些差異是刻意的。共同的部分只寫一次，環境之間的差異明確列出來。' },
      { b: 'Kustomize：base 加 overlay', t: 'base 是完整、合法的 manifest；overlay 的 `kustomization.yaml` 參照 base，用 `images`、`replicas`、`patches` 寫出差異。內建在 kubectl：`kubectl kustomize` 輸出結果、`kubectl apply -k` 套用。補丁逐層合併，`containers` 這類清單依 name 合併。' },
      { b: 'Helm：樣板加 values', t: 'chart 由 `Chart.yaml`、`values.yaml`、`templates/` 組成，樣板用 `{{ .Values.x }}` 取值；`helm upgrade --install` 安裝或升級、`helm rollback` 回到之前的 revision。適合打包給別人安裝的軟體；自己的服務、差異不多時 Kustomize 較簡單。' },
      { b: 'GitOps：叢集自己從 Git 拉', t: 'Git 是唯一的期望狀態，叢集內的控制器（Argo CD、Flux）拉取並持續比對，實際狀態偏離就修正。和 CI 直接 `kubectl apply` 相比：叢集憑證不必交給 CI、drift 會被發現、回退是 git revert；代價是多一套元件要維運。' },
      { b: '叢集以外用 IaC，秘密不直接進 Git', t: '網路、叢集本身、資料庫這些用 Terraform 這類工具管：plan 列出差異、apply 執行、state 記錄對應關係。Secret 的 YAML 只是 base64，GitOps 下改放加密後的版本（Sealed Secrets、SOPS）或只放參照（External Secrets）。' },
    ],
    checklist: [
      '能寫出一份參照 base 的 overlay kustomization.yaml，設定 namespace、image tag、副本數與補丁',
      '能說明 Kustomize 與 Helm 做法上的差別，以及各自適合的情境',
      '能比較 push 式部署與 GitOps 在憑證、drift、回退、維運成本上的差別',
    ],
    refs: [
      { label: 'Kubernetes：Declarative Management of Kubernetes Objects Using Kustomize', url: 'https://kubernetes.io/docs/tasks/manage-kubernetes-objects/kustomization/' },
      { label: 'Kustomize', url: 'https://kustomize.io/' },
      { label: 'Helm 文件', url: 'https://helm.sh/docs/' },
      { label: 'Argo CD 文件', url: 'https://argo-cd.readthedocs.io/en/stable/' },
      { label: 'Flux 文件', url: 'https://fluxcd.io/flux/' },
      { label: 'OpenGitOps：GitOps Principles', url: 'https://opengitops.dev/' },
    ],
  },
}

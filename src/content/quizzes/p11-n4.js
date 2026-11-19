// 題庫：P11 新課（n4 批）：k8s-operations
export default [
  {
    skill: 'k8s-operations',
    questions: [
      {
        q: '上游 Kubernetes 的版本與支援方式，對一座地端自建的叢集代表什麼？',
        options: [
          '只要持續套用同一個次版本的最新修補版，就能一直拿到安全修補，不必換次版本',
          '上游同時維護三個次版本，所以可以每隔兩三年一次跨三個次版本升級',
          '每版約有 14 個月的修補，叢集每年至少要升一次，控制平面一次只能升一個次版本',
          'kubelet 可以比 API server 舊 3 個次版本，所以控制平面也可以一次跳三個次版本',
        ],
        answer: 2,
        explain: '每個次版本約 14 個月後停止修補，之後就不會再有修補版，所以叢集每年至少要換一次次版本。控制平面不能跳版：落後三版就要依序升三次，每次都要檢查與輪替節點。「維護三個次版本」說的是同時有修補的版本，不是可以一次跨過去；kubelet 可以落後 3 版是新舊版本共存的容許範圍，和升級一次能跨幾版是兩回事。',
      },
      {
        q: '院內叢集要修補 k8s-node-2 的作業系統，drain 跑了十分鐘還沒結束。`report-worker` 這個 Deployment 只有 1 個副本。最合適的處理是什麼？',
        code: '$ kubectl drain k8s-node-2 --ignore-daemonsets --delete-emptydir-data\n...\nerror when evicting pods/"report-worker-7f6d4c8b9-p0c3a" -n "clinic" (will retry after 5s): Cannot evict pod as it would violate the pod\'s disruption budget.\n（同一行每 5 秒重複一次）\n\n$ kubectl get pdb -n clinic\nNAME            MIN AVAILABLE   MAX UNAVAILABLE   ALLOWED DISRUPTIONS   AGE\nclinic-api      1               N/A               1                     90d\nreport-worker   1               N/A               0                     90d',
        lang: 'bash',
        options: [
          '加上 --force 重跑 drain，它會略過 PDB，直接把卡住的 Pod 刪掉',
          '單一副本加上 minAvailable 1，允許的中斷永遠是 0；要加副本並分散到不同節點，或調整這個 PDB',
          'PDB 只在滾動更新時生效，drain 卡住是因為 report-worker 的 readiness 探針沒有通過',
          '等 drain 預設的逾時時間到，它會自動改用直接刪除的方式把 Pod 移走',
        ],
        answer: 1,
        explain: 'drain 用 Eviction API，PDB 不允許時回 429，kubectl 每 5 秒重試。report-worker 只有 1 個可用、PDB 要求至少 1 個，ALLOWED DISRUPTIONS 是 0，等多久都一樣。`--force` 是允許刪除沒有控制器的 Pod，不會略過 PDB；PDB 管的就是 drain 這類自願性中斷；drain 的 `--timeout` 預設是 0（一直等），逾時也只是失敗結束，不會改成刪除。',
      },
      {
        q: '一座一年前用 kubeadm 建的叢集，某天早上 `kubectl` 全部回 `x509: certificate has expired or is not yet valid`，已經在跑的服務還正常。第一步該怎麼做？',
        options: [
          '在每台控制平面用 kubeadm certs check-expiration 確認，再 renew all、重建靜態 Pod，並換掉過期的 kubeconfig',
          '用 kubectl --insecure-skip-tls-verify 繞過檢查，再刪除控制平面的 Pod，讓它們重建時換上新憑證',
          '重新產生叢集的 CA，再用新的 CA 簽發所有元件的憑證，一次解決之後所有的到期問題',
          '把控制平面節點的系統時間調回一週前，讓憑證暫時恢復有效，再另外排時間升級叢集',
        ],
        answer: 0,
        explain: 'kubeadm 產生的元件憑證預設 1 年，CA 是 10 年，所以要換的是元件憑證：`renew all` 之後還要重建靜態 Pod（元件不會自動重新載入所有憑證），並重新複製 `admin.conf`。跳過伺服器驗證解決不了用戶端憑證也過期的問題，而且靜態 Pod 由 kubelet 管理，用 kubectl 刪不會重建它；CA 還有效，重產 CA 要把新的信任重新發到所有節點與 kubeconfig；調時間會讓 etcd、log 時間線與其他 TLS 連線一起出問題。',
      },
    ],
  },
]

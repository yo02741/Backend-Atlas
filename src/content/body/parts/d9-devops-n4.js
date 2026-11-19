// 領域內文（d9-devops，n4 批）：以技能 id 為 key，由 body/d9-devops.js 合併。只放這些技能：k8s-operations
export default {
  'k8s-operations': {
    points: [
      { b: '先分清楚要顧的元件', t: '控制平面是 API server、etcd、scheduler、controller-manager；節點上是 kubelet、容器執行環境與 kube-proxy。kubeadm 的控制平面是靜態 Pod（`/etc/kubernetes/manifests/`），API server 起不來時要上節點用 `crictl` 與 `journalctl -u kubelet` 查。1.24 起移除 dockershim，節點跑的是 containerd 或 CRI-O。' },
      { b: '發行版決定誰修補、誰負責升級', t: 'kubeadm 是上游工具，CNI、Ingress、儲存、監控、備份全部自己來；RKE2 與 k3s 內建較多元件與較嚴的預設，可向 SUSE 買支援；OpenShift 是 Red Hat 的平台，預設最嚴、自帶升級頻道；Rancher 是管理多座叢集的平台。比較的是支援與修補、升級工具、預設安全設定與需要的人力。' },
      { b: '每年都要升級，而且一次一個次版本', t: '上游大約每 4 個月出一個次版本、維護最近三個，每版修補約 14 個月（以 kubernetes.io/releases 為準）。控制平面一次只能升一個次版本；先控制平面再節點，kubelet 不能比 API server 新、最多舊 3 個次版本。升級前掃描被移除的 apiVersion、確認附加元件支援、在測試叢集演練並走變更單。' },
      { b: 'drain 走 eviction，會被 PDB 擋住', t: '`cordon` 只停止排程；`drain` 再加上驅逐，遵守優雅關機與 PodDisruptionBudget。`--ignore-daemonsets` 讓 DaemonSet 的 Pod 留著，`--delete-emptydir-data` 允許刪掉 emptyDir 的內容。單一副本加 `minAvailable: 1`、`minAvailable` 等於副本數、替代的 Pod 排不上，drain 都會一直重試。作業系統修補走同一套流程，一次一台。' },
      { b: '備份要演練還原，憑證要有到期告警', t: 'etcd 快照能還原整座叢集的物件（含 Secret，要保護）；Velero 備份 namespace 與 volume；GitOps 能從 Git 重建資源定義，重建不了資料。kubeadm 產生的憑證預設 1 年：`kubeadm certs check-expiration`、`kubeadm certs renew all` 後重建靜態 Pod，到期日放進監控，告警也要涵蓋 etcd、節點 NotReady 與磁碟壓力。' },
    ],
    checklist: [
      '能替一座落後的叢集排出升級路徑：每一步的次版本、要檢查的 API 與附加元件、控制平面與節點的順序，並指出哪些版本組合違反版本差異政策',
      '能從 `kubectl get pdb` 與 drain 的輸出判斷 drain 會不會卡住、卡在哪個 PDB，以及該改副本數、PDB 還是排程容量',
      '能寫出 etcd 快照與 kubeadm 憑證檢查、更新的步驟，並說明還原演練要驗證什麼、哪些東西不在 etcd 快照裡',
    ],
    refs: [
      { label: 'Kubernetes：Releases', url: 'https://kubernetes.io/releases/' },
      { label: 'Kubernetes：Version Skew Policy', url: 'https://kubernetes.io/releases/version-skew-policy/' },
      { label: 'Kubernetes：Upgrading kubeadm clusters', url: 'https://kubernetes.io/docs/tasks/administer-cluster/kubeadm/kubeadm-upgrade/' },
      { label: 'Kubernetes：Deprecated API Migration Guide', url: 'https://kubernetes.io/docs/reference/using-api/deprecation-guide/' },
      { label: 'Kubernetes：Safely Drain a Node', url: 'https://kubernetes.io/docs/tasks/administer-cluster/safely-drain-node/' },
      { label: 'Kubernetes：Certificate Management with kubeadm', url: 'https://kubernetes.io/docs/tasks/administer-cluster/kubeadm/kubeadm-certs/' },
      { label: 'Kubernetes：Operating etcd clusters for Kubernetes', url: 'https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/' },
      { label: 'Velero 文件', url: 'https://velero.io/docs/main/' },
    ],
  },
}

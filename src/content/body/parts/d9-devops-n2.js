// 領域內文（d9-devops，n2 批）：以技能 id 為 key，由 body/d9-devops.js 合併。只放這些技能：k8s-storage
export default {
  'k8s-storage': {
    points: [
      { b: '資料跟著哪一種 volume 走', t: '容器自己的檔案系統在重建後就沒了；`emptyDir` 跟著 Pod，Pod 離開節點就刪除；configMap、secret 掛成唯讀檔案；`hostPath` 綁在某個節點又能讀寫節點上的任何路徑，Pod Security 的 baseline 就禁止它。要保留的資料用 PVC。' },
      { b: 'PVC 是申請，PV 是空間，StorageClass 決定怎麼建', t: 'PV controller 找 class 相同、存取模式涵蓋、容量夠的 PV（挑最小的），找不到就由 CSI driver 依 StorageClass 動態建立。`WaitForFirstConsumer` 等 Pod 排好節點才建，地端的 local PV 與只接部分節點的 SAN 要用它。動態建立的 PV 預設 reclaimPolicy 是 Delete：刪 PVC 就刪資料。' },
      { b: 'ReadWriteOnce 限制的是節點', t: 'RWO 是單一節點可讀寫，同節點的多個 Pod 可以一起用；需要 attach 的區塊儲存被另一個節點的 Pod 要求時，那個 Pod 停在 ContainerCreating（Multi-Attach error）。多個節點共用要 RWX（NFS、CephFS）；只准一個 Pod 用是 ReadWriteOncePod（1.29 GA，只支援 CSI）。Deployment 掛 RWO 只能 1 個副本並改用 Recreate。' },
      { b: 'StatefulSet：固定的名字與各自的 PVC', t: 'Pod 叫 `<名稱>-0`、`-1`，搭配 headless Service（`clusterIP: None`）各有自己的 DNS 名稱；`volumeClaimTemplates` 替每個副本建自己的 PVC，重建後掛回同一個。預設依序號啟動、從最大的序號往回更新；縮減副本或刪掉 StatefulSet 都不刪 PVC。它不替程式做複寫。' },
      { b: '地端自己選儲存，自己備份', t: 'CSI 是儲存系統接 Kubernetes 的標準介面。NFS 簡單、支援 RWX 但 NAS 是單點；Longhorn 用節點磁碟做分散式區塊儲存；Rook-Ceph 提供區塊、檔案、物件但最複雜；廠商的 CSI driver 接既有的 SAN、NAS；local PV 綁節點。VolumeSnapshot 要 driver 支援，快照通常和原資料在同一個儲存系統，不能當成備份。' },
    ],
    checklist: [
      '看到 PVC 停在 Pending，能從 Events 判斷是 StorageClass 名稱、沒有預設 class、存取模式還是 WaitForFirstConsumer，並說出刪 PVC 時 Delete 與 Retain 的差別',
      '能依副本數與是否共用資料，在 RWO、RWX、ReadWriteOncePod 與物件儲存之間做選擇，並說明 Deployment 掛 RWO 時遇到 Multi-Attach 的原因',
      '能把需要固定名稱與各自資料的服務寫成 StatefulSet 加 headless Service，並說明縮減副本、節點故障時 PVC 與 Pod 會怎樣',
    ],
    refs: [
      { label: 'Kubernetes：Volumes', url: 'https://kubernetes.io/docs/concepts/storage/volumes/' },
      { label: 'Kubernetes：Persistent Volumes', url: 'https://kubernetes.io/docs/concepts/storage/persistent-volumes/' },
      { label: 'Kubernetes：Storage Classes', url: 'https://kubernetes.io/docs/concepts/storage/storage-classes/' },
      { label: 'Kubernetes：StatefulSets', url: 'https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/' },
      { label: 'Kubernetes：Volume Snapshots', url: 'https://kubernetes.io/docs/concepts/storage/volume-snapshots/' },
    ],
  },
}

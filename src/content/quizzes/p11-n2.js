// 題庫：P11 新課（n2 批）：k8s-storage
export default [
  {
    skill: 'k8s-storage',
    questions: [
      {
        q: '兩個 Pod 掛同一個 ReadWriteOnce 的 PVC（後端是需要 attach 的區塊儲存），兩個 Pod 剛好被排到同一個節點。結果會是什麼？',
        options: [
          '第二個 Pod 停在 ContainerCreating，Events 出現 Multi-Attach error',
          '第二個 Pod 停在 Pending，排程器發現 PVC 已經被另一個 Pod 使用',
          '兩個 Pod 都能啟動並寫入，RWO 限制的是節點，同一個節點上的 Pod 可以共用',
          '兩個 Pod 都能啟動，但 Kubernetes 會把第二個 Pod 的掛載自動改成唯讀',
        ],
        answer: 2,
        explain: 'ReadWriteOnce 是「單一節點可讀寫」，volume attach 到那個節點之後，同節點上的多個 Pod 都能掛載與寫入。Multi-Attach error 發生在第二個 Pod 被排到另一個節點時。排程器擋下第二個 Pod 是 ReadWriteOncePod 的行為。Kubernetes 不會替你把掛載改成唯讀，存取模式在掛載之後也不負責防寫。',
      },
      {
        q: '下面的 StorageClass 動態建立了一個 PV 給 PVC `clinic-report-pdfs`。沒有 Pod 在用這個 PVC 時執行 `kubectl delete pvc clinic-report-pdfs -n clinic`，資料會怎樣？',
        code: 'apiVersion: storage.k8s.io/v1\nkind: StorageClass\nmetadata:\n  name: longhorn\n  annotations:\n    storageclass.kubernetes.io/is-default-class: "true"\nprovisioner: driver.longhorn.io\nvolumeBindingMode: WaitForFirstConsumer\nallowVolumeExpansion: true',
        lang: 'yaml',
        options: [
          'PV 變成 Released，資料保留；之後建立同名的 PVC 會自動綁回原本的 PV',
          'reclaimPolicy 沒寫就是 Delete：PV 與後端 volume 一起刪除',
          'reclaimPolicy 沒寫，預設是 Retain：PV 與資料保留，要管理者手動清除',
          'Kubernetes 會先替這個 volume 建一個 VolumeSnapshot，再刪除 PV',
        ],
        answer: 1,
        explain: '動態建立的 PV 繼承 StorageClass 的 reclaimPolicy，StorageClass 沒寫時是 Delete，刪 PVC 就連後端的 volume 一起刪。Retain 是手動建立的 PV 的預設值；就算是 Retain，Released 的 PV 也不會自動綁給新的 PVC，要管理者清掉 claimRef。Kubernetes 不會在刪除前自動拍快照。正式環境的 StorageClass 多半明確寫 reclaimPolicy: Retain。',
      },
      {
        q: '測試環境把 StatefulSet `clinic-queue` 從 3 個副本縮成 2 個，想省下儲存空間。幾天後發現 Longhorn 的用量完全沒有減少。原因與處理方式是什麼？',
        options: [
          'PV 進入 Released 狀態，要等 Kubernetes 的垃圾回收在下一個週期清掉，等著就好',
          '縮減時 StatefulSet 先刪最小序號的 Pod，clinic-queue-0 的資料被搬到其他 PVC，用量所以不變',
          'Longhorn 的副本要等節點重開機才會釋放，要排程輪流重啟節點',
          '縮減預設保留 PVC，data-clinic-queue-2 還在，要另外刪除',
        ],
        answer: 3,
        explain: 'StatefulSet 縮減時從最大的序號開始刪 Pod，但 volumeClaimTemplates 建出來的 PVC 預設保留（whenScaled 與 whenDeleted 都是 Retain），擴回 3 時新的 clinic-queue-2 才能掛回原本的資料。PVC 還在，PV 就還是 Bound，不會進入 Released，也沒有垃圾回收會處理它。縮減是從最大的序號開始，不會搬資料；空間不會因為重開機而釋放。',
      },
    ],
  },
]

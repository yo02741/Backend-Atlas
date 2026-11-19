// 題庫：P11 新課（n3 批）：k8s-rbac-tenancy
export default [
  {
    skill: 'k8s-rbac-tenancy',
    questions: [
      {
        q: '在 clinic-staging 建一個 RoleBinding，roleRef 指向內建的 ClusterRole edit，主體是群組 oidc:k8s-clinic-dev。這個群組的成員能做什麼？',
        options: [
          '在所有 namespace 讀寫大部分物件，因為 roleRef 指的是 ClusterRole',
          '套用會失敗：RoleBinding 只能指向同一個 namespace 的 Role',
          '只在 clinic-staging 讀寫大部分物件，包括 Secret；其他 namespace 沒有任何權限',
          '只在 clinic-staging 讀寫，但 Secret 讀不到，因為 edit 和 view 一樣排除了 Secret',
        ],
        answer: 2,
        explain: 'ClusterRole 加 RoleBinding 的生效範圍由 RoleBinding 決定，只有它所在的 namespace；ClusterRole 在這裡只是可以重複使用的權限範本，要整個叢集生效得用 ClusterRoleBinding。RoleBinding 可以指向 Role 或 ClusterRole。排除 Secret 的是 view；edit 能讀寫 Secret，也能用這個 namespace 的任何 ServiceAccount 跑 Pod，所以給 edit 之前要想清楚。',
      },
      {
        q: '這是 CI 部署帳號在 clinic namespace 的 Role，裡面沒有列出 secrets。這個帳號拿不拿得到 clinic-api-secret 的內容？',
        code: `apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: deployer
  namespace: clinic
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch", "create", "patch"]
  - apiGroups: [""]
    resources: ["services", "configmaps"]
    verbs: ["get", "create", "patch"]`,
        lang: 'yaml',
        options: [
          '拿不到：RBAC 沒有列出的資源一律拒絕，secrets 不在任何一條規則裡',
          '拿得到：能建立 Deployment，就能讓 Pod 掛載這個 namespace 的任何 Secret 再送出去',
          '拿得到：apiGroups 寫了 ""，代表 core group 的所有資源都允許，包括 secrets',
          '拿不到：除非另外給 pods/exec，否則沒辦法從容器裡讀出 Secret',
        ],
        answer: 1,
        explain: '直接對 secrets 的 get、list 會被拒絕，但能建立 Deployment（或 Pod、Job）就能寫出一個掛載 clinic-api-secret、用任何 ServiceAccount 執行的 Pod，不需要 exec，啟動指令把內容送到別處就好。apiGroups 的 "" 只是指 core group，能用哪些資源仍然由 resources 決定。部署帳號免不了這個權限，所以要靠 manifest 必須經過審查才會部署、Pod Security 標籤擋掉特權 Pod 這類補強。',
      },
      {
        q: '稽核要求今後查得出「誰在什麼時間刪了哪個 namespace」。叢集目前大家共用 kubeadm 的 admin.conf，API server 沒有設定稽核政策。哪個做法能達到要求？',
        options: [
          '開啟 API server 的稽核政策並送到叢集外保存，同時讓每個人用自己的 OIDC 身分登入',
          '事後用 kubectl get events 查，刪除 namespace 的動作會留下 Event 物件',
          '開啟 API server 的稽核政策就夠了，從日誌裡的來源 IP 就能對回是誰',
          '每個人各複製一份 admin.conf、改成自己名字的檔名，稽核時依檔名區分',
        ],
        answer: 0,
        explain: '稽核日誌記的是驗證後的使用者名稱，大家共用 admin.conf 時每一筆都是 kubernetes-admin，來源 IP 只能猜；複製檔案也一樣，裡面是同一張憑證。所以要同時做兩件事：每個人有自己的身分，API server 開稽核並把日誌送到控制平面以外的地方。Event 是 Kubernetes 物件的事件，不記錄是哪個使用者做的，預設只保留一小時左右，而且 namespace 刪掉時它的 Event 也一起被刪。',
      },
    ],
  },
]

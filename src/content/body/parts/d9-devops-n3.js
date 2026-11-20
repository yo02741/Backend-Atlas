// 領域內文（d9-devops，n3 批）：以技能 id 為 key，由 body/d9-devops.js 合併。只放這些技能：k8s-rbac-tenancy
export default {
  'k8s-rbac-tenancy': {
    points: [
      { b: '叢集不存使用者，人的身分來自外面', t: '人用 client 憑證或 OIDC 登入，名稱與群組來自憑證或 ID token；接院內 IdP 後權限綁群組，調職改 AD 群組就生效。client 憑證不能撤銷，kubeadm 的 admin.conf 不分給人。程式用 ServiceAccount，Pod 拿到的是綁定 Pod、有期限的投射 token；1.24 起不再自動產生長期的 Secret 型 token，也不要自己建。' },
      { b: 'Role 列規則，Binding 決定給誰、在哪裡生效', t: '規則是 apiGroups × resources × verbs，只有允許、沒有拒絕。ClusterRole 加 RoleBinding 只在那個 namespace 生效，是重複使用權限的標準做法。內建的 view 不能讀 Secret；edit 能讀寫 Secret，也能用任何 ServiceAccount 跑 Pod；admin 再多管 Role；cluster-admin 包括 namespace 本身。用 kubectl auth can-i 加 --as、--as-group 驗證。' },
      { b: '有幾種權限拿到的比字面上多', t: 'secrets 的 list、watch 也會回傳內容；能建立 Pod 或 Deployment、Job，就能掛載 namespace 裡任何 Secret、使用任何 ServiceAccount；pods/exec 能進容器讀環境變數；escalate、bind、impersonate 繞過授權的保護；nodes/proxy 能在節點上任何 Pod 執行指令且不留稽核紀錄；* 涵蓋以後才安裝的資源。' },
      { b: 'CI 的部署帳號：一個環境一個，只給 apply 需要的', t: 'ServiceAccount 只用 RoleBinding 綁要部署的 namespace，動作只給 get、list、watch、create、patch，不給 delete、secrets、pods/exec 與 *。kubeconfig 存成 GitLab 的 protected File 型變數，token 用 kubectl create token 產生並設期限；Runner 跑在叢集裡或改用 GitOps 時，CI 就不必持有叢集的憑證。' },
      { b: 'namespace 管權限與配額，強隔離要分節點或叢集', t: 'ResourceQuota 限制 namespace 的總量，LimitRange 給沒寫 resources 的容器補預設值。Pod Security Admission 用 namespace 標籤設定 privileged、baseline、restricted 三個等級與 enforce、audit、warn 三種模式，取代 1.25 移除的 PodSecurityPolicy。Secret 另靠 etcd 靜態加密保護，誰做了什麼靠 API server 的稽核政策記錄，兩者在地端都要自己開。' },
    ],
    checklist: [
      '能替一個部署帳號寫出 ServiceAccount、Role 與 RoleBinding，並用 kubectl auth can-i --as 證明它不能讀 secrets、不能 exec、不能動別的 namespace',
      '能說出 view、edit、admin、cluster-admin 各給到哪裡，以及為什麼能建立 Pod 就等於能讀這個 namespace 的 Secret',
      '能替一個 namespace 設定 ResourceQuota、LimitRange 與 Pod Security 標籤，並說明 etcd 靜態加密與 API server 稽核日誌各自回答稽核的哪個問題',
    ],
    challenge: {
      task: '對應深入內容的三個停靠點，在 kind 叢集（[本機叢集指南](https://github.com/yo02741/u-kinda-should-know/blob/main/companion/clinic-api/docs/local-k8s.md)）做三張獨立的驗收單。角色：先做 [替 CI 的部署帳號收斂權限](#/exercise/k8s-rbac-tenancy-1)，把結果套上叢集。租戶邊界：建 `clinic-staging` 與 `clinic-prod` 兩個 namespace，部署帳號只綁 staging。配額：替 staging 設 ResourceQuota、LimitRange 與 Pod Security 的 `restricted`。每張單子的證據都要是指令輸出。',
      deliver: '三張驗收單，每張列出驗收項目、指令與實際輸出',
      check: [
        '角色單：`kubectl auth can-i --as=system:serviceaccount:<ns>:<name>` 對 get secrets、create pods/exec、delete deployments 回 no，對 patch deployments 回 yes',
        '邊界單：同一個身分在 `clinic-prod` 的任何動作都回 no',
        '配額單：超過配額的 Deployment，ReplicaSet 的 Events 出現 `exceeded quota`；特權容器被 Pod Security 擋下並印出違反的項目',
        '三張單子可以各自重跑，不依賴另外兩張的狀態',
      ],
      twist: '有人在部署帳號的 Role 加了一條 create pods，理由是「CI 要跑 migration」。先預測角色單裡 `can-i get secrets` 會不會變，以及這張單子實際上還守不守得住，再寫出怎麼證明風險、改用什麼做法跑 migration。',
    },
    refs: [
      { label: 'Kubernetes：Using RBAC Authorization', url: 'https://kubernetes.io/docs/reference/access-authn-authz/rbac/' },
      { label: 'Kubernetes：Role Based Access Control Good Practices', url: 'https://kubernetes.io/docs/concepts/security/rbac-good-practices/' },
      { label: 'Kubernetes：Authenticating', url: 'https://kubernetes.io/docs/reference/access-authn-authz/authentication/' },
      { label: 'Kubernetes：Service Accounts', url: 'https://kubernetes.io/docs/concepts/security/service-accounts/' },
      { label: 'Kubernetes：Pod Security Admission', url: 'https://kubernetes.io/docs/concepts/security/pod-security-admission/' },
      { label: 'Kubernetes：Pod Security Standards', url: 'https://kubernetes.io/docs/concepts/security/pod-security-standards/' },
      { label: 'Kubernetes：Resource Quotas', url: 'https://kubernetes.io/docs/concepts/policy/resource-quotas/' },
      { label: 'Kubernetes：Encrypting Confidential Data at Rest', url: 'https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/' },
      { label: 'Kubernetes：Auditing', url: 'https://kubernetes.io/docs/tasks/debug/debug-cluster/audit/' },
      { label: 'Kubernetes：Multi-tenancy', url: 'https://kubernetes.io/docs/concepts/security/multi-tenancy/' },
    ],
  },
}

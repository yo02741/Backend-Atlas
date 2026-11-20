## 從一個具體問題開始：五個人共用一份 admin.conf

資訊室用 kubeadm 建了兩座地端叢集：測試叢集 `lab` 與正式叢集 `prod`，兩座都有 `clinic` namespace，跑門診掛號的 `clinic-api`（[實作路線第 10 階段](#/project/k8s) 的那套 manifest）。建叢集的工程師把兩座控制平面上的 `/etc/kubernetes/admin.conf` 合併成一份 kubeconfig，放進共用資料夾；GitLab 的部署 job 也用這一份。

某天下午，一位工程師為了查正式環境的 log 切到 `prod`。傍晚他要重建測試環境：

```bash
$ kubectl config current-context
kubernetes-admin@prod
$ kubectl delete namespace clinic
namespace "clinic" deleted
```

刪除 namespace 會連帶刪掉裡面的每一個物件，包括不在 Git 裡的 `clinic-api-secret` 與 TLS 憑證 `clinic-tls`。manifest 重新套用只要幾分鐘，Secret 得從保管的地方找回來，門診掛號停了 50 分鐘。事後資安組要求說清楚四件事，現在一件都答不出來：

| 稽核的問題 | 現況 |
|---|---|
| 是誰刪的 | 每個人用同一張憑證，名稱都是 `kubernetes-admin`；API server 沒設稽核日誌，預設什麼都不記 |
| 這份權限給了誰 | 五台筆電、共用資料夾、GitLab 變數，還有一位上個月調走的同事 |
| 能不能收回 | client 憑證效期一年，Kubernetes 不支援撤銷 client 憑證 |
| 正式環境的 Secret 誰讀得到 | 所有拿到這份檔案的人，以及 CI 的每一個 job |

kubeadm 的文件寫明 `admin.conf` 要留在控制平面節點，不要分給其他使用者。kubeadm 1.29 起，`admin.conf` 的權限來自 `kubeadm:cluster-admins` 群組的 ClusterRoleBinding，刪掉綁定能讓外流的副本失效，但控制平面上 kubeadm 自己用的那份也一起失效。新建叢集時同時產生的 `super-admin.conf` 屬於 `system:masters` 群組，完全繞過 RBAC，外流了只能等憑證到期或換叢集的 CA。

這一課照稽核的四個問題，依序補上身分、授權、隔離與紀錄。應用程式內的授權模型在 [RBAC 與 ABAC 授權模型](#/skill/rbac-abac)，這裡講 Kubernetes 自己的 RBAC 怎麼寫、哪裡容易給太多。

## 身分：叢集裡沒有「使用者」物件

API server 處理每個請求時先驗證（這是誰），再授權（能不能做）。驗證的結果只有使用者名稱與群組清單。叢集裡沒有 User 物件，也不能用 API 新增使用者，人是誰由叢集外的東西決定：

| 身分來源 | 名稱從哪裡來 | 怎麼收回 | 給誰 |
|---|---|---|---|
| client 憑證 | 憑證的 CN 是名稱，O 是群組 | 不能撤銷，只能等到期或換 CA | 控制平面元件、緊急用的管理員 |
| OIDC（院內的 IdP） | ID token 的 claim，例如 `preferred_username`、`groups` | IdP 停用帳號；已發出的 ID token 等它到期 | 人 |
| ServiceAccount | `system:serviceaccount:<namespace>:<名稱>` | 刪除 ServiceAccount；短期 token 自己到期 | 程式 |

### 人：用 OIDC 接院內的 IdP

院內的帳號在 AD，前面有一個 IdP（見 [企業身分：LDAP、AD、SAML 與 SCIM](#/skill/enterprise-identity)）。叢集把它當成 OIDC 的發行者：工程師用院內帳號加 MFA 登入拿到 ID token，API server 檢查簽章、`iss`、`aud` 與效期（見 [OAuth 2.0 與 OpenID Connect](#/skill/oauth-oidc)）。

```yaml
# /etc/kubernetes/auth/authn.yaml；API server 加上 --authentication-config=/etc/kubernetes/auth/authn.yaml
apiVersion: apiserver.config.k8s.io/v1   # 1.34 起是 v1；1.30–1.33 是 beta 的 v1beta1
kind: AuthenticationConfiguration
jwt:
  - issuer:
      url: https://idp.hospital.example/realms/staff
      audiences: ["kubernetes"]           # IdP 上替叢集建立的 client id
      certificateAuthority: |             # IdP 的憑證由院內 CA 簽發時，放院內 CA 的根憑證
        -----BEGIN CERTIFICATE-----
        ...
        -----END CERTIFICATE-----
    claimMappings:
      username:
        claim: preferred_username
        prefix: "oidc:"                   # 加前綴，避免和 system: 開頭的內建名稱撞名
      groups:
        claim: groups
        prefix: "oidc:"
```

也可以用 `--oidc-issuer-url`、`--oidc-groups-claim` 這組啟動參數設定（較舊的版本只能用這種），兩種方式不能同時使用。工程師的 kubeconfig 不再放憑證，只寫怎麼取得 token：

```yaml
users:
  - name: hospital-oidc
    user:
      exec:                               # 需要 token 時執行這個程式；這裡以 kubelogin 為例，參數以它的文件為準
        apiVersion: client.authentication.k8s.io/v1
        command: kubectl
        args:
          - oidc-login
          - get-token
          - --oidc-issuer-url=https://idp.hospital.example/realms/staff
          - --oidc-client-id=kubernetes
```

```bash
$ kubectl auth whoami          # 1.28 起
ATTRIBUTE   VALUE
Username    oidc:chen.yiting
Groups      [oidc:k8s-clinic-dev system:authenticated]
```

這份 kubeconfig 沒有秘密，可以放在內部 wiki。權限綁在群組上，群組由 AD 管：調職時改 AD 群組，下一次取得 token 就生效。ID token 不能撤銷，效期設短，常見是幾分鐘到一小時。`super-admin.conf` 移到離線保管，只在 RBAC 設壞、所有人都進不去時取用，取用要留紀錄。

### 程式：ServiceAccount 與投射 token

每個 namespace 都有一個 `default` ServiceAccount，Pod 沒指定 `serviceAccountName` 就用它。Pod 拿到的是投射（projected）token：kubelet 透過 TokenRequest API 申請，掛在 `/var/run/secrets/kubernetes.io/serviceaccount/token`，綁定這個 Pod，效期預設一小時、到期前自動換新，Pod 刪除就失效。

| 版本 | 變化 |
|---|---|
| 1.22 | 投射 token 成為正式功能，取代不會過期的 Secret 型 token |
| 1.24 | 建立 ServiceAccount 不再自動產生 Secret 型的長期 token（1.26 成為正式行為） |
| 1.29 | 自動產生的舊 token 超過一年沒用會被標記失效，再一年沒用就清除（1.30 成為正式行為） |

- 不呼叫 Kubernetes API 的程式（`clinic-api` 就是）設 `automountServiceAccountToken: false`，Pod 裡就沒有 token 可偷。
- 不要手動建立 `kubernetes.io/service-account-token` 型別的 Secret 拿不會過期的 token。叢集外的程式用 `kubectl create token <名稱> --duration=…` 申請有期限的，管法見 [金鑰的範圍與壽命](#/skill/key-scope-lifetime)。
- 一個程式一個 ServiceAccount，不共用 `default`，權限才分得開，稽核日誌也看得出是誰。

## 授權：Role、Binding 與 kubectl auth can-i

| 物件 | 範圍 | 內容 |
|---|---|---|
| Role | 一個 namespace | 規則：哪些 API 群組的哪些資源，可以做哪些動作 |
| ClusterRole | 整個叢集 | 同上；還能涵蓋 nodes、namespaces 這類叢集層級的資源 |
| RoleBinding | 一個 namespace | 把 Role 或 ClusterRole 給主體（User、Group、ServiceAccount），只在這個 namespace 生效 |
| ClusterRoleBinding | 整個叢集 | 把 ClusterRole 給主體，所有 namespace 都生效 |

一條規則是三個清單的組合：`apiGroups`（core group 寫成 `""`，Deployment 在 `apps`、Job 在 `batch`）、`resources`（子資源寫成 `pods/log`、`pods/exec`）、`verbs`。下面是正式環境 on-call 用的 Role，能看 Pod 與 log、重啟 Deployment：

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: clinic-oncall
  namespace: clinic
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log", "services", "events"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["patch"]                      # kubectl rollout restart 是對 Deployment 做 patch
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: clinic-oncall
  namespace: clinic
subjects:
  - kind: Group
    name: "oidc:k8s-clinic-oncall"        # AD 的群組名稱，加上 API server 設定的前綴
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: Role
  name: clinic-oncall
  apiGroup: rbac.authorization.k8s.io
```

RBAC 只管到「動詞 × 資源」，管不到欄位：給了 Deployment 的 `patch`，能 `rollout restart`，也能改 image。

| 指令 | 需要的動詞 |
|---|---|
| `kubectl get pod <名稱>`、`kubectl get pods` | `get`、`list` |
| `kubectl rollout status`、`kubectl wait` | `get`、`list`、`watch` |
| `kubectl apply`（物件不存在時） | `get`、`create` |
| `kubectl apply`（已存在）、`set image`、`rollout restart` | `get`、`patch` |
| `kubectl logs` | `pods/log` 的 `get` |
| `kubectl exec` | `pods/exec` 的 `create` |

### 四種組合與內建角色

| 角色 | Binding | 生效範圍 |
|---|---|---|
| Role | RoleBinding | Role 所在的 namespace |
| ClusterRole | RoleBinding | 只有 RoleBinding 所在的 namespace |
| ClusterRole | ClusterRoleBinding | 所有 namespace，加上叢集層級的資源 |
| Role | ClusterRoleBinding | 不允許 |

ClusterRole 加 RoleBinding 最常用：權限寫一次，每個 namespace 各綁一次。內建四個給人用的 ClusterRole：

| ClusterRole | 用 RoleBinding 綁時 | 要注意的 |
|---|---|---|
| `view` | 讀大部分物件 | 不能讀 Secret，看不到 Role 與 RoleBinding |
| `edit` | 讀寫大部分物件 | 能讀寫 Secret，能用 namespace 裡任何 ServiceAccount 跑 Pod，等於擁有它們的權限 |
| `admin` | `edit` 加上管理這個 namespace 的 Role 與 RoleBinding | 不能改 ResourceQuota 與 namespace 本身 |
| `cluster-admin` | namespace 裡的一切，包括 namespace 本身 | 用 ClusterRoleBinding 綁就是整個叢集；`admin.conf` 的權限也是它 |

門診系統的分法：開發群組在測試環境拿 `edit`，在正式的 `clinic` 只拿 `view`；on-call 群組拿上面的 `clinic-oncall`；`cluster-admin` 只用 ClusterRoleBinding 給平台組兩個人的 OIDC 身分。

兩條規則要記得。第一，**RBAC 只有允許，沒有拒絕**：權限取聯集，沒有任何 binding 允許就是拒絕，[RBAC 與 ABAC](#/skill/rbac-abac) 的「拒絕優先」在這裡寫不出來；需要禁止規則時，要在 admission 層加政策（例如 1.30 起正式提供的 ValidatingAdmissionPolicy）。第二，binding 的 `roleRef` 建立後不能改，要換角色就刪掉重建，管理主體清單的人因此不能順手把 binding 指到更大的角色。

### 用 kubectl auth can-i 驗證

```bash
$ kubectl auth can-i delete namespaces                    # 自己能不能做
no
# 以別人的身分檢查：執行的人要有 impersonate 權限，通常是平台組
$ kubectl auth can-i get secrets -n clinic \
    --as=oidc:chen.yiting --as-group=oidc:k8s-clinic-dev
no
$ kubectl auth can-i create pods --subresource=exec -n clinic \
    --as=system:serviceaccount:clinic:gitlab-deployer
no
# 列出某個身分在某個 namespace 的全部權限（已節錄）
$ kubectl auth can-i --list -n clinic --as=system:serviceaccount:clinic:gitlab-deployer
Resources          Non-Resource URLs   Resource Names   Verbs
deployments.apps   []                  []               [get list watch create patch]
jobs.batch         []                  []               [get list watch create patch]
configmaps         []                  []               [get create patch]
```

`--as` 只換使用者名稱，不會去 IdP 查群組。權限綁在群組上時要自己加 `--as-group`，否則常常全部是 `no`。檢查 ServiceAccount 時，API server 會自動補上它固定的群組。

### 危險的權限

| 權限 | 實際能做什麼 |
|---|---|
| `secrets` 的 `get`、`list`、`watch` | 讀出內容。`list` 與 `watch` 的回應就帶著內容，只給 list 擋不住 |
| 建立 Pod，或會產生 Pod 的 Deployment、Job、CronJob | Pod 能掛載 namespace 裡任何 Secret、指定任何 ServiceAccount；能跑特權 Pod 就能碰到節點 |
| `pods/exec`、`pods/attach` | 在容器裡下指令，讀到環境變數裡的密碼。部分版本透過 WebSocket 連線時只檢查 `get`（1.35 起預設恢復要求 `create`），任何動詞都不要給 |
| `escalate`、`bind` | 跳過「只能授予自己已有的權限」這層檢查，建立比自己大的權限 |
| `impersonate` | 以別人的身分操作 |
| `nodes/proxy` | 直接呼叫 kubelet，在節點上任何 Pod 裡執行指令，不經過 admission、不留稽核紀錄；`get` 就夠 |
| `serviceaccounts/token` 的 `create` | 替既有的 ServiceAccount 發 token |
| namespace 的 `patch` | 改 namespace 的標籤，把 Pod Security 的等級調低 |
| 規則裡的 `*` | 涵蓋現在與以後的所有動詞或資源，之後裝的 CRD 也算；`resources` 與 `verbs` 都寫 `*`，上面每一項都在內 |

:::stop 停靠點 1：角色。交付一組 Role 與 RoleBinding，加上 `kubectl auth can-i --as` 的輸出，證明那個身分能做該做的事、不能讀 secrets、不能 exec。做到這裡就能審一份 binding 有沒有給出危險的權限。

## CI 的部署帳號

每個環境一個 ServiceAccount，只綁它要部署的 namespace，動作只給 `kubectl apply`、`rollout status`、`wait` 用得到的：

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: gitlab-deployer
  namespace: clinic
automountServiceAccountToken: false       # 只給叢集外的 CI 用，不掛進任何 Pod
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: app-deployer                      # 叢集裡寫一次，每個要部署的 namespace 各綁一次
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch", "create", "patch"]
  - apiGroups: ["batch"]
    resources: ["jobs"]                   # migration Job：建立後等它完成
    verbs: ["get", "list", "watch", "create", "patch"]
  - apiGroups: [""]
    resources: ["services", "configmaps"]
    verbs: ["get", "create", "patch"]
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses"]
    verbs: ["get", "create", "patch"]
  - apiGroups: ["policy"]
    resources: ["poddisruptionbudgets"]
    verbs: ["get", "create", "patch"]
  - apiGroups: [""]
    resources: ["pods", "events"]         # 部署失敗時印出狀態，只讀
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: gitlab-deployer
  namespace: clinic                       # 只在這個 namespace 生效
subjects:
  - kind: ServiceAccount
    name: gitlab-deployer
    namespace: clinic
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: app-deployer
```

這份權限沒有 `delete`、`secrets`、`pods/exec` 與任何 `*`。Secret 由管理者建立或由秘密管理同步；刪除舊資源由人用自己的身分做，稽核日誌留下的是那個人的名字。殘留的風險：能建立 Deployment，就能寫出掛載 `clinic-api-secret` 的 Pod，把內容送到叢集外。這一層靠 manifest 必須經過 MR 審查、合進受保護分支才會部署（見 [GitLab CI/CD 實戰](#/skill/gitlab-cicd)），以及後面的 Pod Security 標籤。

CI 連叢集的方式：

| 做法 | CI 拿什麼連叢集 | 取捨 |
|---|---|---|
| kubeconfig 存成 protected 的 File 型變數 | `kubectl create token` 產生、有期限的 token | 最簡單；到期要重新產生並更新變數。kubeconfig 是多行內容，不能設成 masked |
| Runner 跑在叢集裡（Kubernetes executor） | job Pod 自己的投射 token | GitLab 裡不存憑證；部署帳號放在 Runner 的 namespace，再用 RoleBinding 授權到 `clinic` |
| GitLab agent for Kubernetes | 叢集裡的 agent 主動連回 GitLab | API server 不必對 Runner 開放；設定以 GitLab 文件為準 |
| GitOps（Argo CD、Flux） | CI 不碰叢集，只推 image、改 manifest | 控制器在叢集裡拉 Git，見 [Helm、Kustomize 與 GitOps](#/skill/k8s-helm-gitops) |

第一種的做法：

```bash
# 平台組用自己的身分執行：產生 30 天的 token（API server 的設定可能把期限縮短）
kubectl create token gitlab-deployer -n clinic --duration=720h
```

```yaml
# 存成 GitLab 的 File 型、protected 變數 KUBECONFIG；kubectl 會讀這個環境變數指向的檔案
apiVersion: v1
kind: Config
clusters:
  - name: prod
    cluster:
      server: https://k8s-prod.hospital.example:6443
      certificate-authority-data: <叢集 CA 憑證的 base64>
users:
  - name: gitlab-deployer
    user:
      token: <上面產生的 token>
contexts:
  - name: prod-clinic
    context: { cluster: prod, user: gitlab-deployer, namespace: clinic }
current-context: prod-clinic
```

這個 token 外流時，影響範圍是一個 namespace 的部署動作，最多 30 天。

:::stop 停靠點 2：CI 部署帳號的邊界。交付一個只綁在 staging namespace 的 ServiceAccount 與有期限的 token，用 `can-i` 證明它在 production namespace 什麼都不能做，kubeconfig 只放在 protected 的 File 型變數裡。

## 多租戶：namespace、配額與 Pod Security

### namespace 怎麼切

| 切法 | 例子 | 要注意的 |
|---|---|---|
| 依系統 | `clinic`、`pharmacy`、`reports` | 最常見：權限、配額、稽核都以系統為單位；共用元件（Ingress controller、監控）各放自己的 namespace |
| 依環境 | `clinic-staging`、`clinic` | 同一座叢集放多個環境時用；分叢集時名稱也帶上環境，同一個指令才不會在兩邊都成立 |
| 依團隊 | `team-opd`、`team-nursing` | 組織調整時不好搬，通常和依系統搭配 |

事故之後，測試叢集的 namespace 改名為 `clinic-staging`，測試環境的指令打到正式叢集只會回 NotFound。context 的名稱寫出環境（`prod-clinic`），shell 的提示字元顯示目前的 context。應用程式不放 `default`。

### ResourceQuota 與 LimitRange

一個系統的 HPA 擴到上限，或某個 Job 寫錯迴圈開了幾百個 Pod，會把節點吃光，其他系統的 Pod 排不上去。ResourceQuota 限制一個 namespace 的總量，LimitRange 替沒寫 resources 的容器補預設值：

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: clinic-quota
  namespace: clinic
spec:
  hard:
    requests.cpu: "4"                     # 所有 Pod 的 CPU requests 加總上限
    requests.memory: 8Gi
    limits.memory: 12Gi
    pods: "30"
    requests.storage: 100Gi
    services.nodeports: "0"               # 這個 namespace 不能開 NodePort
---
apiVersion: v1
kind: LimitRange
metadata:
  name: clinic-defaults
  namespace: clinic
spec:
  limits:
    - type: Container
      defaultRequest: { cpu: 100m, memory: 128Mi }   # 沒寫 requests 時補上
      default: { memory: 256Mi }                     # 沒寫 limits 時補上
      max: { memory: 2Gi }                           # 單一容器的上限
```

requests 與 limits 的意義見 [Kubernetes 實作：設定、探針與資源](#/skill/k8s-config-probes)。幾個行為：

- 配額設了 `requests.cpu` 或 `limits.memory`，沒寫對應欄位的 Pod 會被拒絕。配額用完時 Deployment 照樣更新成功，是 ReplicaSet 建不出 Pod，錯誤在 ReplicaSet 的 Events。
- 滾動更新會暫時多出 `maxSurge` 個 Pod，配額要留這個餘裕。
- 配額只設上限、不替 namespace 保留資源，所有 namespace 的配額加總可以超過叢集容量；要超賣多少用 [硬體資源與容量規劃](#/skill/capacity-planning) 的方法估。內建的 `admin` 改不了 ResourceQuota，上限由平台組決定。

### Pod Security Admission

能跑特權容器、掛節點目錄、用節點網路的 Pod，可以從容器碰到節點，再碰到同節點上其他系統的 Pod。Pod Security Admission（1.25 起正式提供）在建立 Pod 時依 namespace 的標籤檢查；它取代了 PodSecurityPolicy，PSP 在 1.25 移除，還在教 PSP 的文章在新叢集上用不了。

| 等級 | 擋掉什麼 | 適合 |
|---|---|---|
| `privileged` | 不擋 | 網路外掛、儲存外掛、監控代理 |
| `baseline` | 特權容器、`hostPath`、`hostNetwork`、`hostPID`、額外的 capabilities 等已知的提權方式 | 一般應用程式的最低要求 |
| `restricted` | baseline 加上：非 root、`allowPrivilegeEscalation: false`、捨棄所有 capabilities、設定 seccomp profile | 自己寫的服務 |

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: clinic
  labels:
    pod-security.kubernetes.io/enforce: baseline     # 違反就拒絕建立
    pod-security.kubernetes.io/warn: restricted      # 違反時 kubectl 印出警告，照樣建立
    pod-security.kubernetes.io/audit: restricted     # 違反時寫進稽核日誌，照樣建立
```

每個模式另有 `-version` 標籤（例如 `pod-security.kubernetes.io/enforce-version`），把規則固定在某個次版本，升級叢集時才不會被新版規則突然擋掉。導入時先用 `warn` 與 `audit` 看會擋到什麼，改完 manifest 再拉高 `enforce`；`kubectl label --dry-run=server` 改 `enforce` 標籤，會列出現有 Pod 有哪些違反，但不真的改。實作路線的 Deployment 已經以非 root 執行、捨棄所有 capabilities，套用時還是有一條警告：

```bash
$ kubectl apply -k k8s/overlays/production        # 輸出已節錄
Warning: would violate PodSecurity "restricted:latest": seccompProfile (pod or container "api" must set securityContext.seccompProfile.type to "RuntimeDefault" or "Localhost")
deployment.apps/clinic-api configured
```

在 Pod 層的 `securityContext` 加上 `seccompProfile: { type: RuntimeDefault }`，就能把 `enforce` 改成 `restricted`。注意 `enforce` 只檢查 Pod：Deployment 會建立成功，被擋的是 ReplicaSet 建 Pod 那一步；`warn` 與 `audit` 會檢查 Deployment 裡的 Pod 範本，所以 apply 時就看得到。

### namespace 擋不住的東西

namespace 是權限與配額的邊界，不是安全隔離的邊界。不同 namespace 的 Pod 共用節點的核心、控制平面與叢集層級的資源（CRD、ClusterRole、節點），網路預設全部互通，要用 NetworkPolicy 收緊（見 [Kubernetes 網路](#/skill/k8s-networking)）。

| 隔離程度 | 做法 | 還共用什麼 |
|---|---|---|
| 同叢集、不同 namespace | RBAC、配額、Pod Security、NetworkPolicy | 節點核心、控制平面 |
| 同叢集、專用節點 | 再用 taint、toleration、nodeSelector 讓系統只跑在自己的節點 | 控制平面 |
| 分叢集 | 各自的控制平面與節點 | 網路與機房 |

正式與測試分叢集。資料敏感程度差很多的系統（病歷與院內公告），或讓外部廠商自己部署的系統，也值得分叢集，至少分節點。

:::stop 停靠點 3：配額與 Pod Security。交付一個 namespace 的 ResourceQuota、LimitRange 與 Pod Security 標籤，附上三次套用的結果：超過配額被拒、沒寫 resources 的容器補上預設值、特權容器被 `restricted` 擋下。後面的 Secret 保護與稽核日誌，在要回答稽核「誰讀了什麼、誰做了什麼」時再回來讀。

## Secret 的保護

Secret 在 API 裡只是 base64 編碼（[設定、探針與資源](#/skill/k8s-config-probes) 有示範），保護分三層。

第一層是 RBAC：定期列出哪些身分能讀正式環境的 Secret，包括綁到 `edit`、`admin`、`cluster-admin` 的，以及能在這個 namespace 建立 Pod 的。

第二層是 etcd 的靜態加密。API server 預設把 Secret 原樣寫進 etcd，拿到 etcd 的資料目錄或一份備份檔，就拿到全部的 Secret。雲端代管服務多半有對應的設定；地端要自己開：

```yaml
# /etc/kubernetes/enc/enc.yaml：每個控制平面節點放一份，權限 600
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources: ["secrets"]
    providers:
      - secretbox:                        # 第一個 provider 用來加密新寫入的資料
          keys:
            - name: key-2026-11
              secret: <32 位元組亂數的 base64，例如 head -c 32 /dev/urandom | base64>
      - identity: {}                      # 讓還沒重新寫入的舊資料讀得到；全部重寫後可以移除
```

```bash
# 1. kube-apiserver 的 static Pod 加上參數，並把 /etc/kubernetes/enc 掛進容器：
#      --encryption-provider-config=/etc/kubernetes/enc/enc.yaml
# 2. 既有的 Secret 不會自動加密，全部重新寫入一次
kubectl get secrets --all-namespaces -o json | kubectl replace -f -
# 3. 直接讀 etcd 確認：值的開頭應該是 k8s:enc:secretbox:v1:key-2026-11
ETCDCTL_API=3 etcdctl --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key \
  get /registry/secrets/clinic/clinic-api-secret | hexdump -C | head -3
```

金鑰放在控制平面的檔案裡，所以這一層防的是 etcd 資料與備份外流，防不了控制平面主機被入侵。院內有 HSM 或金鑰管理服務時，`kms` v2 provider（1.29 起正式提供）把主金鑰留在外部。`aescbc` 已不建議使用，其他 provider 的取捨以官方文件的比較表為準。金鑰要另外備份、不和 etcd 備份放在一起，金鑰遺失，備份就還原不了（見 [Kubernetes 叢集維運](#/skill/k8s-operations)）。

第三層是外部秘密管理：Vault 這類服務當唯一來源、同步進叢集時，輪替與「誰讀過」的紀錄在那個服務裡；同步進來的仍然是 Secret，前兩層照做。見 [秘密管理](#/skill/secrets)。

## 稽核日誌：誰在什麼時間做了什麼

API server 只有設定了 `--audit-policy-file` 才記稽核日誌，kubeadm 預設沒有。政策由上往下比對，第一條符合的決定記錄的詳細程度：`None` 不記；`Metadata` 記誰、何時、從哪個 IP、對什麼做了什麼與狀態碼；`Request` 再加上請求內容；`RequestResponse` 再加上回應內容。

```yaml
# /etc/kubernetes/audit/policy.yaml
apiVersion: audit.k8s.io/v1
kind: Policy
omitStages: ["RequestReceived"]           # 每個請求只記完成時的那一筆
rules:
  - level: None                           # 量大、沒有稽核價值
    nonResourceURLs: ["/healthz*", "/livez*", "/readyz*", "/version"]
  - level: None
    resources:
      - group: ""
        resources: ["events"]
  - level: Metadata                       # 只記誰讀寫了秘密，不記內容，否則秘密會寫進稽核日誌
    resources:
      - group: ""
        resources: ["secrets", "configmaps", "serviceaccounts/token"]
  - level: Metadata                       # 進到容器裡的操作
    resources:
      - group: ""
        resources: ["pods/exec", "pods/attach", "pods/portforward"]
  - level: RequestResponse                # 權限變更記下完整內容
    resources:
      - group: "rbac.authorization.k8s.io"
  - level: Request                        # 其他寫入記下送了什麼
    verbs: ["create", "update", "patch", "delete", "deletecollection"]
  - level: Metadata                       # 其餘的讀取
```

```yaml
# /etc/kubernetes/manifests/kube-apiserver.yaml 的 command 加上這些；政策檔與 log 目錄要用 hostPath 掛進容器
    - --audit-policy-file=/etc/kubernetes/audit/policy.yaml
    - --audit-log-path=/var/log/kubernetes/audit/audit.log
    - --audit-log-maxage=30               # 節點上留 30 天；長期保存靠送到集中的 log 系統
    - --audit-log-maxbackup=10
    - --audit-log-maxsize=100             # 單檔超過 100 MB 就輪替
```

換成各自的身分並開啟稽核後，同樣一個刪除會留下這樣一筆（已簡化）：

```json
{
  "kind": "Event",
  "apiVersion": "audit.k8s.io/v1",
  "level": "Request",
  "stage": "ResponseComplete",
  "verb": "delete",
  "requestURI": "/api/v1/namespaces/clinic",
  "user": { "username": "oidc:lin.zhiwei", "groups": ["oidc:k8s-platform-admins", "system:authenticated"] },
  "sourceIPs": ["10.20.31.45"],
  "userAgent": "kubectl/v1.33.2 (linux/amd64)",
  "objectRef": { "resource": "namespaces", "namespace": "clinic", "name": "clinic", "apiVersion": "v1" },
  "responseStatus": { "code": 200 },
  "requestReceivedTimestamp": "2026-11-11T09:42:10.512Z",
  "annotations": {
    "authorization.k8s.io/decision": "allow",
    "authorization.k8s.io/reason": "RBAC: allowed by ClusterRoleBinding \"platform-admins\" of ClusterRole \"cluster-admin\" to Group \"oidc:k8s-platform-admins\""
  }
}
```

| 稽核問的 | 去哪裡找 |
|---|---|
| 誰在什麼時間對什麼做了什麼、憑哪一條權限 | 稽核日誌的 `user`、`verb`、`objectRef`、時間與 `authorization.k8s.io/reason` |
| 誰讀過正式環境的 Secret、誰進過容器 | 稽核日誌裡 `secrets` 的 `get`、`list` 與 `pods/exec` |
| 某個人現在能做什麼、誰核准的 | `kubectl auth can-i --list`；RBAC 的 YAML 放在 Git，變更經過 MR 核准（見 [受監管環境的變更管理](#/skill/change-management)） |
| 離職、調職什麼時候生效 | IdP 的異動紀錄；ID token 的效期就是最長的延遲 |

稽核日誌寫在控制平面節點的磁碟上，能登入那幾台主機的人就能改，所以要即時送到叢集外的集中 log 系統，保存期限依院內規範。日誌裡有員工帳號與來源 IP，比照 [日誌與稽核紀錄裡的個資](#/skill/logs-pii) 管理。

## 雲端代管的差異

| 項目 | 地端自建 | 雲端代管 |
|---|---|---|
| 人的身分 | 自己設定 API server 接院內 IdP | 多半和雲端帳號整合，由雲端的身分服務對應到 Kubernetes 的使用者與群組 |
| 稽核日誌、etcd 加密 | 自己改 API server 參數、自己收 log | 控制平面由服務商管理，通常在主控台開啟；etcd 多半預設加密 |
| 管理員憑證 | `admin.conf`、`super-admin.conf` 在自己手上 | 通常沒有這類檔案，管理權限來自雲端帳號 |
| RBAC、Pod Security、配額 | 相同 | 相同 |

具體行為依服務而定，以各家文件為準。

## 實際程式：一個 RBAC 評估器

把上面的角色與 binding 寫成資料，照 RBAC 的規則判斷：找出符合主體的 binding，RoleBinding 只在自己的 namespace 生效，規則的三個清單都要對上，有一條允許就允許。內建的 `view` 是簡化版，實際內容用 `kubectl describe clusterrole view` 看。

```python run
# 角色的 key：("ClusterRole", 名稱) 或 ("Role", namespace, 名稱)
ROLES = {
    ("ClusterRole", "cluster-admin"): [
        {"apiGroups": ["*"], "resources": ["*"], "verbs": ["*"]},
    ],
    ("ClusterRole", "view"): [                     # 內建 view 的簡化版：沒有 secrets
        {"apiGroups": [""], "resources": ["pods", "pods/log", "services", "configmaps", "events"],
         "verbs": ["get", "list", "watch"]},
        {"apiGroups": ["apps"], "resources": ["deployments", "replicasets"], "verbs": ["get", "list", "watch"]},
    ],
    ("ClusterRole", "app-deployer"): [
        {"apiGroups": ["apps"], "resources": ["deployments"], "verbs": ["get", "list", "watch", "create", "patch"]},
        {"apiGroups": ["batch"], "resources": ["jobs"], "verbs": ["get", "list", "watch", "create", "patch"]},
        {"apiGroups": [""], "resources": ["services", "configmaps"], "verbs": ["get", "create", "patch"]},
    ],
    ("Role", "clinic", "clinic-oncall"): [
        {"apiGroups": [""], "resources": ["pods", "pods/log", "events"], "verbs": ["get", "list", "watch"]},
        {"apiGroups": ["apps"], "resources": ["deployments"], "verbs": ["get", "list", "watch", "patch"]},
    ],
    ("Role", "pharmacy", "quick-fix"): [           # 只想讓報表程式讀 ConfigMap，為了省事寫了 *
        {"apiGroups": [""], "resources": ["*"], "verbs": ["*"]},
    ],
}

# binding：(種類, namespace, 名稱, 角色的 key, 主體清單)；ClusterRoleBinding 的 namespace 是 None
BINDINGS = [
    # kubeadm 1.29 起，admin.conf 的憑證屬於 kubeadm:cluster-admins 群組，權限來自這個綁定
    ("ClusterRoleBinding", None, "kubeadm:cluster-admins", ("ClusterRole", "cluster-admin"),
     [("Group", "kubeadm:cluster-admins")]),
    ("ClusterRoleBinding", None, "platform-admins", ("ClusterRole", "cluster-admin"),
     [("Group", "oidc:k8s-platform-admins")]),
    ("RoleBinding", "clinic", "clinic-dev-view", ("ClusterRole", "view"),
     [("Group", "oidc:k8s-clinic-dev")]),
    ("RoleBinding", "clinic", "clinic-oncall", ("Role", "clinic", "clinic-oncall"),
     [("Group", "oidc:k8s-clinic-oncall")]),
    ("RoleBinding", "clinic", "gitlab-deployer", ("ClusterRole", "app-deployer"),
     [("ServiceAccount", "clinic", "gitlab-deployer")]),
    ("RoleBinding", "pharmacy", "gitlab-deployer", ("ClusterRole", "app-deployer"),
     [("ServiceAccount", "pharmacy", "gitlab-deployer")]),
    ("RoleBinding", "pharmacy", "report-bot", ("Role", "pharmacy", "quick-fix"),
     [("ServiceAccount", "pharmacy", "report-bot")]),
]


def person(name, *groups):
    return {"user": name, "groups": list(groups) + ["system:authenticated"]}


def sa(ns, name):
    return {"user": f"system:serviceaccount:{ns}:{name}",
            "groups": ["system:serviceaccounts", f"system:serviceaccounts:{ns}", "system:authenticated"]}


def subject_matches(subject, who):
    if subject[0] == "User":
        return who["user"] == subject[1]
    if subject[0] == "Group":
        return subject[1] in who["groups"]
    _, ns, name = subject                          # ServiceAccount
    return who["user"] == f"system:serviceaccount:{ns}:{name}"


def rule_matches(rule, group, resource, verb):
    def has(values, want):
        return "*" in values or want in values
    sub_wild = "/" in resource and resource.split("/")[0] + "/*" in rule["resources"]   # pods/* 涵蓋子資源
    return (has(rule["apiGroups"], group) and (has(rule["resources"], resource) or sub_wild)
            and has(rule["verbs"], verb))


def can(who, verb, resource, namespace=None, group=""):
    """namespace 物件本身的請求（例如刪掉 namespace clinic），namespace 就是它自己的名字"""
    for kind, b_ns, b_name, role_key, subjects in BINDINGS:
        if not any(subject_matches(s, who) for s in subjects):
            continue
        if kind == "RoleBinding" and b_ns != namespace:      # RoleBinding 只在自己的 namespace 生效
            continue
        for rule in ROLES.get(role_key, []):               # 找不到角色：這個 binding 不給任何權限
            if rule_matches(rule, group, resource, verb):
                where = b_name if kind == "ClusterRoleBinding" else f"{b_ns}/{b_name}"
                return True, f"{kind} {where} → {role_key[0]} {role_key[-1]}"
    return False, "沒有任何 binding 允許（RBAC 沒有拒絕規則，沒給就是不行）"


def show(label, who, verb, resource, ns=None, group=""):
    ok, why = can(who, verb, resource, ns, group)
    if resource == "namespaces":
        target = f"namespace {ns}"
    else:
        target = (group + "/" if group else "") + resource + (f" -n {ns}" if ns else "")
    print(f"  {'✓' if ok else '✗'} {label}：{verb} {target}")
    print(f"      {why}")


admin_conf = person("kubernetes-admin", "kubeadm:cluster-admins")
chen = person("oidc:chen.yiting", "oidc:k8s-clinic-dev")
wang = person("oidc:wang.jiahao", "oidc:k8s-clinic-dev", "oidc:k8s-clinic-oncall")
deployer = sa("clinic", "gitlab-deployer")
pharmacy_deployer = sa("pharmacy", "gitlab-deployer")
report_bot = sa("pharmacy", "report-bot")

print("1. 事故當時：每個人都用 admin.conf")
show("kubernetes-admin", admin_conf, "delete", "namespaces", "clinic")

print("\n2. 換成各自的身分")
show("chen.yiting", chen, "delete", "namespaces", "clinic")
show("chen.yiting", chen, "get", "pods", "clinic")
show("chen.yiting", chen, "get", "secrets", "clinic")
show("wang.jiahao", wang, "patch", "deployments", "clinic", "apps")
show("wang.jiahao", wang, "create", "pods/exec", "clinic")
show("wang.jiahao（--as 沒帶群組）", person("oidc:wang.jiahao"), "patch", "deployments", "clinic", "apps")

print("\n3. 同一個 ClusterRole 用 RoleBinding 綁：只在那個 namespace 生效")
show("clinic 的部署帳號", deployer, "patch", "deployments", "clinic", "apps")
show("clinic 的部署帳號", deployer, "patch", "deployments", "pharmacy", "apps")
show("clinic 的部署帳號", deployer, "get", "secrets", "clinic")
show("pharmacy 的部署帳號", pharmacy_deployer, "patch", "deployments", "pharmacy", "apps")

print("\n4. resources 與 verbs 都寫 *，原本只想讀 ConfigMap")
for verb, res in [("get", "configmaps"), ("list", "secrets"), ("create", "pods/exec"), ("delete", "namespaces")]:
    show("report-bot", report_bot, verb, res, "pharmacy")
show("report-bot", report_bot, "get", "configmaps", "clinic")


def effective(who):
    """列出這個主體在每個範圍拿到的規則"""
    rows = []
    for kind, b_ns, b_name, role_key, subjects in BINDINGS:
        if not any(subject_matches(s, who) for s in subjects):
            continue
        scope = "整個叢集" if kind == "ClusterRoleBinding" else f"namespace {b_ns}"
        for rule in ROLES.get(role_key, []):
            groups = ",".join(g or "core" for g in rule["apiGroups"])
            wild = "  ← 萬用字元" if "*" in rule["resources"] + rule["verbs"] + rule["apiGroups"] else ""
            rows.append(f"  {scope}  {groups}  {','.join(rule['resources'])}: {' '.join(rule['verbs'])}{wild}")
    return rows or ["  （沒有任何權限）"]


print("\n5. 有效權限")
for label, who in [("clinic 的部署帳號", deployer), ("wang.jiahao", wang), ("report-bot", report_bot)]:
    print(label)
    print("\n".join(effective(who)))
```

輸出裡要看的：

- 第 1 組不管誰執行，結果與紀錄都只有 `kubernetes-admin`。
- 第 2 組最後兩行是同一個人、同一個動作，差別只在群組有沒有帶上；`kubectl auth can-i --as` 忘了 `--as-group`，會得到這種 `✗`。
- 第 3 組的兩個部署帳號共用一個 ClusterRole，各自只能動自己的 namespace。
- 第 4 組的 `quick-fix` 原本只為了讀 ConfigMap，結果能列出 Secret、進容器下指令，還能刪掉整個 `pharmacy` namespace：`resources: ["*"]` 包含 `namespaces`，而 RoleBinding 所在的 namespace 本身也在它的範圍內。

## 常見錯誤與錯誤訊息

訊息的確切文字依版本而異，下面是類似的樣子：

| 訊息或現象 | 原因 | 處理 |
|---|---|---|
| `Error from server (Forbidden): secrets is forbidden: User "system:serviceaccount:clinic:gitlab-deployer" cannot list resource "secrets" in API group "" in the namespace "clinic"` | 403：身分驗證過了，但沒有 binding 允許 | 拿訊息裡的使用者、動詞、資源、API 群組、namespace 逐一對照 Role 與 binding；這一則是預期結果 |
| `… cannot patch resource "deployments" in API group "apps" in the namespace "pharmacy"` | RoleBinding 建在別的 namespace | 在要操作的 namespace 建 binding |
| `error: You must be logged in to the server (Unauthorized)` | 401：token 過期、issuer 或 audience 對不上、憑證過期 | 重新取得 token；OIDC 設定錯誤的原因在 API server 的 log |
| `kubectl auth can-i --as=…` 說 `no`，本人操作卻成功 | 權限綁在群組上，沒加 `--as-group` | 把群組一起帶上 |
| `The RoleBinding "clinic-oncall" is invalid: roleRef: Invalid value: …: cannot change roleRef` | `roleRef` 不能修改 | 刪掉 binding 再建立 |
| `… is attempting to grant RBAC permissions not currently held` | 建立 Role 或 binding 的人自己沒有這些權限 | 由擁有這些權限的人建立，不要為此給 `bind` 或 `escalate` |
| Deployment 套用成功，Pod 一直沒出現；ReplicaSet 的 Events 有 `violates PodSecurity "restricted:latest"` | namespace 的 `enforce` 擋掉了 Pod | 照訊息補 securityContext；加上 `warn` 標籤，apply 時就看得到 |
| ReplicaSet 的 Events 有 `exceeded quota: clinic-quota, requested: requests.memory=512Mi, used: requests.memory=7680Mi, limited: requests.memory=8Gi` | 配額用完 | 先查是不是有東西異常擴張，再決定要不要調配額 |
| `failed quota: clinic-quota: must specify limits.memory,requests.cpu,requests.memory` | 配額限制了這些資源，Pod 沒寫 | 在 manifest 寫 `resources`，或用 LimitRange 給預設值 |
| 改了 API server 的 static Pod manifest 後，kubectl 連不上 | 參數指到的檔案沒掛進容器，或設定檔有錯，API server 起不來 | 在控制平面節點用 `crictl ps -a`、`crictl logs` 看 kube-apiserver 的錯誤 |

## 動手

1. 執行上面的評估器：把 `clinic` 的 `gitlab-deployer` 那筆 binding 改成 `"ClusterRoleBinding"`，看第 3 組的 `pharmacy` 那一行怎麼變；再把 `quick-fix` 改成只有 `configmaps` 的 `get`，看第 4 組還剩哪一行是 `✓`。
2. 做本課的程式題：`k8s-rbac-tenancy-1` 替 `clinic-staging` 的部署帳號寫 ServiceAccount、Role 與 RoleBinding；`k8s-rbac-tenancy-2` 從一組 binding 找出危險的權限。
3. 在本機的 kind 叢集上練習（建立叢集並部署 `clinic-api` 的方式見 [clinic-api 的本機叢集指南](https://github.com/yo02741/u-kinda-should-know/blob/main/companion/clinic-api/docs/local-k8s.md)）：
   - 建立 `clinic-staging` namespace，套用程式題的解答，用 `kubectl auth can-i --list -n clinic-staging --as=system:serviceaccount:clinic-staging:gitlab-deployer` 列出權限，確認 `get secrets` 與 `create pods --subresource=exec` 都是 `no`。
   - 用 `kubectl create token gitlab-deployer -n clinic-staging --duration=10m` 產生 token，照上面的格式寫一份 kubeconfig（`server` 與 CA 從 `kubectl config view --minify --raw` 複製），執行 `KUBECONFIG=./deployer.yaml kubectl get secrets -n clinic-staging` 看 Forbidden；10 分鐘後再執行，看它變成 Unauthorized。
   - 執行 `kubectl label --dry-run=server --overwrite namespace clinic pod-security.kubernetes.io/enforce=restricted`，看 `clinic-api`、PostgreSQL、Redis 的 Pod 各違反了什麼（加了 dry-run，標籤不會真的改）；在 overlay 的補丁替 `clinic-api` 加上 `seccompProfile`，重新套用 `kubectl apply -k k8s/overlays/kind` 後再試一次，確認它不在清單裡。
   - 在 `clinic-staging` 建立 `requests.memory: 1Gi` 的 ResourceQuota，再用 `kubectl create deployment demo --image=nginx:1.27 --replicas=3 -n clinic-staging` 建一個沒寫 resources 的 Deployment，從 `kubectl describe replicaset -n clinic-staging` 看它缺什麼；接著加一個 `defaultRequest` 是 `memory: 512Mi` 的 LimitRange，看 ReplicaSet 重試後建出幾個 Pod、第幾個被配額擋下。
4. 替團隊列一張表：每個人、每支程式各是什麼身分，在哪些 namespace 綁了哪些角色，每一筆 `edit`、`admin`、`cluster-admin` 都要說得出理由。
5. 叢集的升級、etcd 備份與憑證到期，接著讀 [Kubernetes 叢集維運](#/skill/k8s-operations)。

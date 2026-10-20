## 從一個具體問題開始：「上了 Kubernetes 就能零停機、自動擴展」

一家醫院的資訊部規劃明年導入 Kubernetes。廠商簡報說：上了 K8s，系統就能零停機更新、流量大時自動擴展、主機壞了自動搬家。

先看一個準備搬上去的系統現在長什麼樣：

- 一台 VM 上跑 Python 應用程式，用 systemd 啟動。
- 資料庫連線密碼寫在 `/srv/app/config.ini`。
- 使用者上傳的掃描文件存在 VM 的 `/srv/app/uploads/`。
- 登入狀態存在應用程式的記憶體裡。
- 更新方式是 SSH 進去 `git pull`、重啟服務。

把這個系統原封不動放進 Kubernetes，三個承諾一個也不會實現：開兩個副本時，使用者的登入狀態只存在其中一個副本，下一個請求被分到另一個副本就變成未登入；上傳的檔案只在某一個容器的檔案系統裡，容器重啟就消失；沒有健康檢查，更新時流量會被送到還沒啟動完成的新版本。

Kubernetes 提供的是**機制**：維持副本數、滾動更新、依健康狀態轉送流量、在節點故障時重新排程。這些機制要發揮作用，應用程式本身要先符合一些條件，叢集周邊也要有一些元件。這一課依序講：基本物件怎麼串成一個系統、更新時發生什麼事、地端自建要自己補什麼、跟雲端代管差在哪，以及導入前團隊要先具備的能力。

## 一個 web + DB 系統在 Kubernetes 上長怎樣

```text
                         外部使用者 / 內網使用者
                                   │  https://booking.example.org
                                   ▼
                  ┌──────── Ingress（依網域與路徑轉送）────────┐
                  │     由 Ingress controller 實際處理流量      │
                  └───────────────────┬─────────────────────────┘
                                      ▼
                      Service: booking-web（穩定的名字與虛擬 IP）
                         │            │            │
                         ▼            ▼            ▼
                       Pod          Pod          Pod     ← ReplicaSet 維持 3 個
                     （容器）      （容器）      （容器）  ← Deployment 管理版本與更新
                         │  讀取設定：ConfigMap（一般設定）、Secret（密碼）
                         ▼
                      Service: booking-db
                         │
                         ▼
                   PostgreSQL Pod（StatefulSet）
                         │
                         ▼
          PersistentVolumeClaim → PersistentVolume（由 StorageClass 動態建立）

          以上全部放在 Namespace: booking 裡
```

| 物件 | 作用 | 在這個系統裡 |
|---|---|---|
| Pod | 最小的執行單位：一個或多個共享網路與儲存的容器 | 一個應用程式容器 |
| ReplicaSet | 維持指定數量的 Pod；少了就補 | 隨時保持 3 個 web Pod |
| Deployment | 管理 ReplicaSet：換版時建新的 ReplicaSet、逐步縮舊的 | 更新版本、回退版本都透過它 |
| Service | 給一組 Pod 一個穩定的 DNS 名稱與虛擬 IP，依 label 選取 Pod | `booking-web`、`booking-db` |
| Ingress | 依網域、路徑把外部 HTTP(S) 流量導到 Service；本身只是規則 | `booking.example.org` → `booking-web` |
| ConfigMap | 非機密的設定，以環境變數或檔案注入 Pod | 時區、功能開關、外部 API 位址 |
| Secret | 機密設定，以環境變數或檔案注入 | 資料庫密碼、API 金鑰 |
| PersistentVolume（PV） | 一塊實際的儲存空間 | 資料庫的資料目錄 |
| PersistentVolumeClaim（PVC） | Pod 對儲存的「申請單」：要多大、什麼存取模式 | 「我要 100 Gi、單節點讀寫」 |
| StorageClass | 描述某一類儲存，以及如何**動態建立** PV | 對應到 SAN、分散式儲存或雲端磁碟 |
| Namespace | 把物件分組，配合權限與資源配額 | 每個系統一個 namespace |
| StatefulSet | 給每個 Pod 固定的名稱與各自的儲存 | 資料庫這類有狀態服務 |

Pod 是**用完即丟**的：重新排程或更新時，舊的 Pod 被刪除、新的 Pod 換一個 IP 出現。所以其他元件永遠透過 Service 的名稱（例如 `booking-db`）連線，不記 Pod 的 IP；Pod 的檔案系統也只是暫存，需要保留的資料要放在 PV 或外部儲存。

### 對應的 YAML

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: booking-web
  namespace: booking
spec:
  replicas: 3
  selector:
    matchLabels: { app: booking-web }     # 這個 Deployment 管理帶這個 label 的 Pod
  template:
    metadata:
      labels: { app: booking-web }
    spec:
      containers:
        - name: web
          image: registry.example.org/booking/web:3f9c2a1b   # 用 commit SHA，不用 latest
          ports:
            - containerPort: 8000
          envFrom:
            - configMapRef: { name: booking-config }        # 一般設定
            - secretRef: { name: booking-secrets }          # DATABASE_URL 等機密
          readinessProbe:              # 準備好才收流量
            httpGet: { path: /ready, port: 8000 }
            periodSeconds: 5
          livenessProbe:               # 卡死時重啟
            httpGet: { path: /healthz, port: 8000 }
            initialDelaySeconds: 10
            periodSeconds: 10
          resources:
            requests: { cpu: "500m", memory: "512Mi" }
            limits: { memory: "512Mi" }
---
apiVersion: v1
kind: Service
metadata:
  name: booking-web
  namespace: booking
spec:
  selector: { app: booking-web }       # 轉送給帶這個 label、而且 ready 的 Pod
  ports:
    - port: 80
      targetPort: 8000
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: booking
  namespace: booking
spec:
  ingressClassName: nginx              # 由哪一個 Ingress controller 處理
  tls:
    - hosts: [booking.example.org]
      secretName: booking-tls          # 憑證存在這個 Secret（可由 cert-manager 維護）
  rules:
    - host: booking.example.org
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: { name: booking-web, port: { number: 80 } }
```

`resources` 的估法見 [硬體資源與容量規劃](#/skill/capacity-planning)。

### Secret 不是加密

Secret 的值在 API 裡只是 base64 **編碼**，任何能讀取這個 namespace 的 Secret 的人都能解出原文。要保護它，至少要做到：

- 用 RBAC 限制誰能讀 Secret。
- 開啟 etcd 的靜態加密（encryption at rest）；雲端代管服務多半有對應的設定或預設行為，地端自建要自己設定。
- 不要把 Secret 的 YAML 原文 commit 進 git。常見做法是把機密放在外部的機密管理系統，再同步進叢集，或把加密後的版本放進 git。

### 資料庫要不要放進叢集

資料庫可以用 StatefulSet 或 operator（例如 PostgreSQL 的 CloudNativePG）跑在叢集裡，但備份、還原、升級、儲存效能都要團隊自己能掌握。導入初期常見的做法是**應用程式先上 K8s、資料庫維持在既有的 VM 或代管服務**，等團隊熟悉叢集的儲存與維運後再評估。這是取捨，不是唯一答案。

## 滾動更新與 probe

把 image tag 從 `3f9c2a1b` 改成 `8d1e7f40` 後，Deployment 建立新的 ReplicaSet，逐步把 Pod 換成新版本。預設的策略是 `RollingUpdate`，`maxSurge` 與 `maxUnavailable` 都是 25%（以 3 個副本計算，最多多開 1 個、最多少 0 個——25% 的 3 是 0.75，maxSurge 無條件進位成 1，maxUnavailable 無條件捨去成 0）。

| 時間 | 舊版 Pod | 新版 Pod | Service 轉送給 |
|---|---|---|---|
| t0 | 3 個 ready | 0 | 舊 ×3 |
| t1 | 3 個 ready | 1 個啟動中（readiness 未通過） | 舊 ×3 |
| t2 | 3 個 ready | 1 個 ready | 舊 ×3 + 新 ×1 |
| t3 | 停掉 1 個 → 2 個 | 再建 1 個 | 舊 ×2 + 新 ×1 |
| … | … | … | … |
| tn | 0 | 3 個 ready | 新 ×3 |

關鍵在 **readiness probe**：新 Pod 的 readiness 通過之前，Service 不會把流量送給它，Deployment 也不會繼續砍舊的 Pod。沒有設定 readiness probe 時，容器一啟動就被視為 ready——應用程式還在載入、還沒連上資料庫，流量就進來了，使用者看到錯誤。所謂「零停機」，有一半是靠這個 probe 做到的。

另一半是**優雅關閉**：舊 Pod 被刪除時，Kubernetes 先送 SIGTERM，等 `terminationGracePeriodSeconds`（預設 30 秒）後才送 SIGKILL。應用程式要在收到 SIGTERM 後停止接新請求、把手上的請求做完再結束。從 Service 移除 Pod 與送出 SIGTERM 是同時開始的，可能有少量請求在這段時間仍被送到要關閉的 Pod，常見做法是加一個短暫的 `preStop` 等待。

三種 probe 的差別：

| probe | 失敗時 | 適合檢查 | 不要檢查 |
|---|---|---|---|
| readiness | 從 Service 移出，不收流量；恢復後自動加回 | 能不能處理請求：依賴是否可用、是否還在暖機 | |
| liveness | **重啟容器** | 程序是否卡死（例如死結、事件迴圈停止） | 資料庫或其他外部依賴 |
| startup | 啟動期間暫停另外兩個 probe；超過時限就重啟 | 啟動很慢的程式（大型 Java 應用） | |

liveness 檢查資料庫是常見的錯誤：資料庫短暫不穩時，所有 Pod 的 liveness 一起失敗、一起重啟，重啟期間又一起去連資料庫，問題放大成全面停機。

更新出問題時：

```bash
$ kubectl rollout status deployment/booking-web -n booking
Waiting for deployment "booking-web" rollout to finish: 1 out of 3 new replicas have been updated...

$ kubectl rollout undo deployment/booking-web -n booking    # 退回上一個版本
deployment.apps/booking-web rolled back
```

新版的 readiness 一直不通過時，滾動更新會停住，舊版 Pod 仍在服務——這是 probe 設對的好處。資料庫 schema 變更要讓新舊版本能同時運作，見 [部署策略與資料庫遷移](#/skill/cd-strategies)。

## 地端自建：要自己補的東西

Kubernetes 本身只包含控制平面（API server、scheduler、controller manager、etcd）與節點上的 kubelet。雲端代管服務把周邊的整合都做好了；地端自建時，下面這些都要自己選、自己裝、自己維運：

| 需要的功能 | 雲端代管通常怎麼提供 | 地端自建要自己處理 |
|---|---|---|
| 控制平面高可用 | 廠商管理 | 至少 3 個控制平面節點；etcd 成員數用奇數（3 個可容忍 1 個故障） |
| `type: LoadBalancer` 的 Service | 自動建立雲端負載平衡器 | 沒有任何元件時，`EXTERNAL-IP` 永遠是 `<pending>`；要裝 MetalLB 之類的元件，或接既有的硬體負載平衡器 |
| Ingress controller | 部分服務內建或有官方附加元件 | 自己選擇與安裝，並決定它怎麼對外（NodePort、LoadBalancer） |
| 儲存（StorageClass） | 預設就有雲端磁碟的 StorageClass | 要有 CSI driver：儲存設備廠商的 driver、分散式儲存（如 Longhorn、Rook-Ceph）或 NFS；沒有預設 StorageClass 時 PVC 會卡在 Pending |
| 映像倉庫 | 雲端廠商的 registry | GitLab Container Registry、Harbor 等；節點要信任它的憑證 |
| 憑證 | 部分服務整合憑證管理 | cert-manager，搭配公開 CA 或內部 CA |
| 監控與 log | 整合雲端監控 | Prometheus、Grafana、log 收集（如 Loki、Elasticsearch）等 |
| 備份 | 部分服務提供 | etcd 快照、叢集物件與 PV 的備份（例如 Velero），以及**還原演練** |
| 版本升級 | 一鍵或自動升級控制平面 | 自己規劃；控制平面一次只能升一個 minor 版本 |
| 節點作業系統 | 代管節點映像 | 作業系統修補、核心更新、汰換硬體 |
| 身分認證 | 整合雲端帳號體系 | 接既有的身分系統（例如透過 OIDC 接 AD），否則大家共用一份 kubeconfig |
| 網路（CNI）與網路政策 | 預設 CNI | 選擇 CNI（例如 Calico、Cilium），決定 Pod 網段不能跟既有內網重疊 |

幾個地端特有的情況：

**LoadBalancer 一直 pending**：

```bash
$ kubectl get svc -n ingress-nginx
NAME                       TYPE           CLUSTER-IP     EXTERNAL-IP   PORT(S)                      AGE
ingress-nginx-controller   LoadBalancer   10.96.141.22   <pending>     80:31380/TCP,443:31443/TCP   3d
```

沒有任何元件負責分配外部 IP，所以它永遠在等。MetalLB 這類元件從一段預先保留的內網 IP 中分配位址，用 ARP（L2 模式）或 BGP 對外宣告。那段 IP 要跟網路組協調，不能和 DHCP 或其他設備衝突。

**節點不信任內部 registry 的憑證**：

```text
Failed to pull image "registry.example.org/booking/web:3f9c2a1b": ... tls: failed to verify certificate: x509: certificate signed by unknown authority
```

拉 image 的是**節點上的容器執行環境**（例如 containerd），不是 Pod。內部 CA 的根憑證要裝在每一個節點上，新加入的節點也要。憑證的細節見 [HTTPS 憑證](#/skill/https-certificates)。

**Ingress controller 的選擇**：Ingress 只是規則，實際處理流量的是 controller，選擇很多。要注意的是，Kubernetes 社群維護的 ingress-nginx 專案已宣布退役、停止後續維護（官方公告的停止時間是 2026 年 3 月），新的建置要評估其他 controller 或 Gateway API（Kubernetes 的新一代流量路由 API，已正式發布 v1）。選型前查清楚專案的維護狀態，這類資訊變動很快。

**升級是持續的工作**：Kubernetes 大約每年發布三個 minor 版本，每個版本約有 14 個月的修補支援。也就是說，叢集大約每年要升級一到兩次才不會落到不再支援的版本，而且只能一個 minor 一個 minor 升。這要排進年度維運計畫，不是導入專案結束就沒事。

## 雲端代管（EKS、GKE、AKS）差在哪

Amazon EKS、Google GKE、Azure AKS 這類服務，替你運作控制平面，並把上一節大部分的整合做好：LoadBalancer 自動建立雲端負載平衡器、預設有 StorageClass、身分系統接雲端帳號、版本升級有工具。

仍然是使用者的責任：

- 應用程式本身、資源設定、probe、Secret 的管理。
- 叢集裡裝了什麼、權限怎麼分。
- 網路設計：叢集與地端系統（例如還在機房的資料庫）怎麼連線，需要 VPN 或專線。
- 節點的版本升級節奏（多數服務會提醒或強制升級舊版本）。
- 成本控管：節點、負載平衡器、磁碟、跨區與對外流量都分別計費。

地端與雲端的選擇不只是技術問題，還牽涉資料能放在哪裡的法規要求、既有機房的投資、網路連線與團隊能力。見 [地端、雲端還是混合雲](#/skill/hosting-models)。

## 導入前，團隊與系統要先具備的能力

Kubernetes 會把應用程式的問題放大，而不是解決它們。下面這份清單，每一項沒做到，搬上叢集後都會變成維運問題：

| 能力 | 具體要做到 | 沒做到時在 K8s 上的後果 |
|---|---|---|
| 容器化 | 每個系統有 Dockerfile，image 可以重複 build | 根本放不上去 |
| CI 產出 image | 每次合併自動 build、以 commit SHA 為 tag 推到 registry | 不知道叢集裡跑的是哪一版，無法回退 |
| 設定外部化 | 設定與機密從環境變數或掛載檔案讀取，同一個 image 用在每個環境 | 每個環境要重 build image，或把密碼打包進 image |
| 無狀態 | session 存在 Redis 或資料庫；上傳檔案存在物件儲存或共享儲存 | 多副本時登入狀態錯亂；Pod 重啟後檔案消失 |
| 健康檢查端點 | `/healthz`（程序活著）與 `/ready`（可以處理請求）分開 | 滾動更新時把流量送給還沒準備好的版本 |
| log 寫到 stdout | 不寫本機檔案 | Pod 被刪除，log 跟著消失 |
| 優雅關閉 | 收到 SIGTERM 後處理完手上的請求再結束 | 每次更新都有少量請求失敗 |
| 資源數據 | 知道每個服務的 CPU、記憶體用量 | requests / limits 亂設，Pending 或 OOMKilled |
| 團隊技能 | 看得懂 YAML、會用 `kubectl` 查事件與 log、懂基本網路排查 | 出事時只能找廠商 |

這些能力大多不需要先有 Kubernetes 才能做：用 [docker-compose](#/skill/compose) 在現有的 VM 上跑容器化的系統，就能先把容器化、CI 產 image、設定外部化、無狀態化做完。設定外部化的原則見 [環境設定與 12-factor](#/skill/config-12factor)。

常見的導入順序：

1. 挑一個不是最關鍵、但有實際使用者的系統，先完成上表的應用程式改造，在 VM 上用 compose 跑一段時間。
2. 建測試叢集，把周邊元件（Ingress、儲存、registry、憑證、監控）一次建好，演練節點故障、版本升級、備份還原。
3. 把第一個系統搬上叢集，資料庫先留在外面。
4. 依經驗寫下內部的部署範本與規範，再逐步搬其他系統。

## 常見錯誤與錯誤訊息

| `kubectl get pod` 的狀態 / 現象 | 意思 | 從哪裡查 |
|---|---|---|
| `Pending` | 排程不了：資源不夠、PVC 沒綁定、節點有 taint | `kubectl describe pod` 的 Events，例如 `0/3 nodes are available: 3 Insufficient memory.` |
| `ImagePullBackOff` / `ErrImagePull` | 拉不到 image：名稱或 tag 錯、沒有 registry 登入資訊、節點不信任 registry 憑證 | `kubectl describe pod` 的 Events |
| `CrashLoopBackOff` | 容器啟動後一直結束，Kubernetes 越等越久再重試 | `kubectl logs <pod> --previous` 看上一次的輸出；常見原因是設定或機密缺漏 |
| `OOMKilled`（Exit Code 137） | 記憶體超過 limit | 監控記憶體曲線，區分用量不足還是洩漏 |
| `Running` 但 `READY 0/1` | readiness probe 沒通過，不收流量 | `kubectl describe pod` 看 probe 失敗訊息 |
| Service 連不到任何 Pod | Service 的 selector 和 Pod 的 label 不一致，或沒有 Pod ready | `kubectl get endpointslices -n <ns>` 看有沒有後端位址 |
| PVC 一直 `Pending` | 沒有符合的 StorageClass，或沒有預設 StorageClass | Events 會出現 `no persistent volumes available for this claim and no storage class is set` |
| Ingress 回 404 或 503 | 404：Host 或路徑沒對到規則；503：對到的 Service 沒有可用的 Pod | Ingress controller 的 log；排查方式見 [網路通不通](#/skill/network-troubleshooting) |

查問題的固定順序：`kubectl get pod` 看狀態 → `kubectl describe pod` 看 Events → `kubectl logs`（必要時加 `--previous`）看應用程式輸出。

## 動手

1. 拿一個現有系統，對照「導入前要具備的能力」那張表逐項打勾，沒做到的項目就是導入前的工作清單。
2. 用 kind 或 minikube 在自己的電腦上建一個測試叢集，套用上面的 Deployment 與 Service（image 換成任何一個公開的 web image），然後故意把 readiness probe 的路徑改錯，更新一次，觀察 `kubectl rollout status` 停住、舊版 Pod 仍在服務。
3. 在同一個測試叢集裡建一個 `type: LoadBalancer` 的 Service，觀察 `EXTERNAL-IP` 停在 `<pending>`，這就是地端自建時要補負載平衡元件的原因。
4. 把 [硬體資源與容量規劃](#/skill/capacity-planning) 裡的估算結果，換算成這個 Deployment 的 `replicas` 與 `resources`。

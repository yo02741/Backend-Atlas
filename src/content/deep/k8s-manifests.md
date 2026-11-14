## 從一個具體問題開始：三份 YAML 都套用成功，網址卻回 503

報到系統要多一個 API 服務 `booking-api`。照著文件寫了三份 YAML，`kubectl apply` 三行都回 `created`，Pod 也是 `Running`、`READY 1/1`。但從外面打 `https://api.booking.example.org/healthz`，拿到的是 503。

Pod 沒壞、映像沒錯、程式也在跑。問題出在 Service 的這一行：

```yaml
  selector:
    app: booking_api        # Pod 的 label 是 app: booking-api（連字號）
```

Service 靠 label 找 Pod。這個 selector 一個 Pod 也選不到，Service 後面沒有任何位址，Ingress controller 找不到後端就回 503。API server 不會擋這種錯：「一個目前選不到任何 Pod 的 Service」是合法的物件，Pod 可能晚一點才建立。

[導入 Kubernetes 前要準備什麼](#/skill/k8s-readiness) 講過 Pod、Deployment、Service、Ingress 各自的角色，這一課不重複，只講實作：三份 manifest 各自要寫哪些欄位、它們之間靠什麼接起來、套用之後怎麼確認它們接上了。探針、資源與設定注入放在下一課 [Kubernetes 實作：設定、探針與資源](#/skill/k8s-config-probes)。

## 三份 manifest 之間的四條接線

一個對外的 API 服務最少要三個物件。物件之間不是靠「寫在同一個檔案」或「名字長得像」關聯，而是靠下面四條接線：

```text
Ingress  booking-api
  rules[].host                    api.booking.example.org
  backend.service.name            booking-api ─────┐  ① 名稱與 port 要對到 Service
  backend.service.port.number     80 ──────────────┤
                                                   ▼
Service  booking-api
  ports[].port                    80 ◄─────────────┘
  ports[].targetPort              8000 ────────────┐  ③ 要對到容器實際監聽的 port
  selector                        app=booking-api ─┤  ② 要對到 Pod 的 label
                                                   ▼
Deployment  booking-api
  template.metadata.labels        app=booking-api ◄─┐ ④ selector 要與 template 的 label 一致
  selector.matchLabels            app=booking-api ──┘
  template.spec.containers[].ports[].containerPort  8000
```

| 接線 | 寫錯時 API server 會不會擋 | 寫錯的現象 |
|---|---|---|
| ① Ingress → Service 的名稱與 port | 不會 | Ingress 回 503（實際狀態碼依 controller 而定） |
| ② Service 的 selector → Pod 的 label | 不會 | Service 沒有任何後端位址，叢集內連 Service 也不通 |
| ③ Service 的 targetPort → 容器監聽的 port | 不會 | 連線被拒絕，經過 Ingress 時多半是 502 |
| ④ Deployment 的 selector ↔ template 的 label | **會**，套用時直接被拒絕 | 物件建不起來 |

四條裡只有 ④ 會在套用時被擋下來，其他三條都是「套用成功、但不通」。所以套用後不能只看 `created`，要逐條確認，方法在「套用與確認」一節。

label 是貼在物件上的鍵值對，本身沒有意義，由使用的人決定。selector 的比對規則很單純：selector 列出的每一組鍵值，Pod 都要有而且值相同；Pod 身上多出來的 label 不影響。下面這段程式實作這個規則：

```python run
# Service 的 selector 比對 Pod 的 label：selector 的每一組鍵值，Pod 都要有而且值相同
pods = [
    {"name": "booking-api-6b8f7-4xk2p", "ip": "10.244.1.12", "ready": True,
     "labels": {"app": "booking-api", "pod-template-hash": "6b8f7"}},
    {"name": "booking-api-6b8f7-9dw7m", "ip": "10.244.2.31", "ready": True,
     "labels": {"app": "booking-api", "pod-template-hash": "6b8f7"}},
    {"name": "booking-api-6b8f7-zq5tn", "ip": "10.244.3.8", "ready": False,   # readiness 還沒通過
     "labels": {"app": "booking-api", "pod-template-hash": "6b8f7"}},
    {"name": "booking-web-58c9d-kk2x8", "ip": "10.244.1.20", "ready": True,
     "labels": {"app": "booking-web", "tier": "backend"}},
    {"name": "report-worker-7f6d4-p0c3a", "ip": "10.244.2.44", "ready": True,
     "labels": {"app": "report-worker", "tier": "backend"}},
]

def endpoints(selector, pods):
    matched = [p for p in pods if all(p["labels"].get(k) == v for k, v in selector.items())]
    ready = [p for p in matched if p["ready"]]
    return matched, ready

cases = [
    ("正確", {"app": "booking-api"}),
    ("連字號打成底線", {"app": "booking_api"}),
    ("多寫了一組 Pod 沒有的 label", {"app": "booking-api", "track": "stable"}),
    ("label 太籠統", {"tier": "backend"}),
]
for title, selector in cases:
    matched, ready = endpoints(selector, pods)
    print(f"{title}：selector = {selector}")
    print(f"  選到 {len(matched)} 個 Pod，其中 ready 的 {len(ready)} 個")
    print("  endpoints：", [p["ip"] + ":8000" for p in ready] or "（空的）")
    others = sorted({p["labels"]["app"] for p in matched} - {"booking-api"})
    if others:
        print("  注意：選到別的服務的 Pod →", others)
```

輸出有四種情況：正確時選到三個、只有 ready 的兩個收流量；打錯字或多寫一組 label 時是空的；selector 太籠統時，Service 會把流量分給不相干的服務。最後一種比空的更難查，因為它「有時候通」。

## Deployment：副本、範本與更新方式

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: booking-api
  namespace: booking
  labels:
    app: booking-api              # Deployment 自己的 label，只用來查詢與分類
spec:
  replicas: 3
  revisionHistoryLimit: 5         # 保留幾個舊的 ReplicaSet 供回退（預設 10）
  selector:
    matchLabels:
      app: booking-api            # ④ 這個 Deployment 管哪些 Pod；建立之後不能改
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1                 # 更新期間，Pod 總數最多比 replicas 多 1 個
      maxUnavailable: 0           # 更新期間，可用的 Pod 不能比 replicas 少
  template:                       # Pod 的範本：這一段有變動才會觸發滾動更新
    metadata:
      labels:
        app: booking-api          # ④ 要包含 selector 的每一組 label；② Service 也靠它選取
    spec:
      containers:
        - name: api
          image: registry.example.org/booking/api:3f9c2a1b   # 固定 tag（commit SHA）
          ports:
            - name: http
              containerPort: 8000 # ③ 程式實際監聽的 port
```

幾個欄位的行為：

- **`selector` 與 `template.metadata.labels`**：`apps/v1` 要求 selector 必填，而且 template 的 label 必須符合 selector，否則套用時被拒絕。selector 建立後不可變更；要改只能刪掉 Deployment 重建。
- **`template`**：只有這一段的內容變了（image、環境變數、label、資源設定等），Deployment 才會建立新的 ReplicaSet 開始滾動更新。只改 `replicas` 是擴縮，不是更新。
- **`image` 用固定 tag**：`latest` 有兩個實際的問題。第一，registry 上的 `latest` 換了內容，manifest 一個字都沒變，`kubectl apply` 回 `unchanged`，不會有任何更新；之後某個 Pod 因故重建才拉到新內容，於是同一個 Deployment 裡跑著不同版本。第二，回退時沒有「上一個 tag」可以指。用 commit SHA 或版本號當 tag，叢集裡跑的是哪一版就寫在 manifest 裡。tag 與 digest 的差別見 [環境、secrets 與 artifact](#/skill/environments-secrets)。
- **`containerPort`**：主要是說明用途，沒寫也不會讓 port 連不到；但寫了並取名字（`name: http`），Service 的 `targetPort` 就可以用名字指過來，之後改 port 號只要改一個地方。

### maxSurge 與 maxUnavailable

滾動更新期間，Deployment controller 守住兩個條件：

- Pod 總數（新舊合計）≤ `replicas + maxSurge`
- 可用的 Pod 數 ≥ `replicas − maxUnavailable`

兩個值可以寫整數或百分比，預設都是 25%；百分比換算成個數時，`maxSurge` 無條件進位、`maxUnavailable` 無條件捨去。兩個不能同時是 0（那樣一步都動不了）。

| 設定（replicas = 4） | 更新期間 | 適合 |
|---|---|---|
| `maxSurge: 1`、`maxUnavailable: 0` | 總數最多 5、可用至少 4 | 容量不能掉的服務；節點要有多放一個 Pod 的空間 |
| `maxSurge: 0`、`maxUnavailable: 1` | 總數最多 4、可用至少 3 | 節點沒有多餘資源，可以接受短暫少一個副本 |
| 預設 25% 與 25% | 總數最多 5、可用至少 3 | 一般情況；比前兩種快 |
| `maxSurge: 100%`、`maxUnavailable: 0` | 先把新版全部開起來，再關舊版 | 要換得快、資源足夠 |

另一種策略是 `type: Recreate`：先把舊的全部關掉，再開新的，中間會停機。只在新舊版本不能同時存在時使用。換版方式之間的取捨見 [部署策略與資料庫遷移](#/skill/cd-strategies)。

下面的模擬把每一步的新舊副本數印出來。它簡化了真實的 controller：假設新 Pod 建立後下一步就通過 readiness、被刪的舊 Pod 立刻消失。

```python run
import math

def resolve(value, replicas, round_up):
    # 百分比換成個數：maxSurge 無條件進位，maxUnavailable 無條件捨去
    if isinstance(value, str) and value.endswith("%"):
        x = replicas * int(value[:-1]) / 100
        return math.ceil(x) if round_up else math.floor(x)
    return int(value)

def rolling_update(replicas, max_surge, max_unavailable, new_becomes_ready=True):
    surge = resolve(max_surge, replicas, True)
    unavail = resolve(max_unavailable, replicas, False)
    print(f"replicas={replicas} maxSurge={max_surge}→{surge} maxUnavailable={max_unavailable}→{unavail}")
    if surge == 0 and unavail == 0:
        print("  兩個都是 0：API server 會拒絕這份設定\n")
        return
    old, new_ready, new_starting = replicas, 0, 0
    min_available, max_total = replicas, replicas
    for step in range(1, 30):
        if new_becomes_ready:                      # 上一步建立的新 Pod 通過 readiness
            new_ready, new_starting = new_ready + new_starting, 0
        # 關舊的：可用數（舊的 + 已 ready 的新的）不能低於 replicas − maxUnavailable
        while old > 0 and old + new_ready - 1 >= replicas - unavail:
            old -= 1
        # 開新的：總數不能超過 replicas + maxSurge，新版最多開到 replicas 個
        while old + new_ready + new_starting < replicas + surge and new_ready + new_starting < replicas:
            new_starting += 1
        available, total = old + new_ready, old + new_ready + new_starting
        min_available, max_total = min(min_available, available), max(max_total, total)
        print(f"  步驟 {step}：舊 {old}｜新（ready）{new_ready}｜新（啟動中）{new_starting}｜可用 {available}｜總數 {total}")
        if old == 0 and new_ready == replicas:
            print(f"  完成：過程中可用數最低 {min_available}、總數最高 {max_total}\n")
            return
        if step >= 4 and not new_becomes_ready:
            print(f"  卡住：新版一直沒有 ready，舊版還有 {old} 個在服務\n")
            return

rolling_update(4, 1, 0)
rolling_update(4, 0, 1)
rolling_update(4, "25%", "25%")
rolling_update(4, 1, 0, new_becomes_ready=False)   # 新版的 readiness 永遠不通過
```

最後一組是新版壞掉的情況：`maxUnavailable: 0` 時舊的 4 個一個都不會被關，服務不受影響，更新停在那裡等人處理。同樣的行為可以在 [K8sLab 實驗室](#/lab/K8sLab) 用動畫看。

## Service：穩定的名字與 port 對應

```yaml
apiVersion: v1
kind: Service
metadata:
  name: booking-api               # ① 同時是叢集內的 DNS 名稱
  namespace: booking
spec:
  type: ClusterIP                 # 預設值：只有叢集內連得到
  selector:
    app: booking-api              # ② 選取同一個 namespace 裡帶這個 label 的 Pod
  ports:
    - name: http
      port: 80                    # Service 自己開的 port
      targetPort: http            # ③ 轉給 Pod 的哪個 port：寫數字 8000，或寫容器 port 的名稱
```

`port` 與 `targetPort` 是兩個不同的數字：其他服務連 `http://booking-api:80`，Service 轉到 Pod 的 8000。`targetPort` 省略時等於 `port`。把這兩個寫反或以為它們要相同，是 ③ 最常見的錯法。

Service 只把流量送給 **ready** 的 Pod，所以 ② 接上了、但 Pod 的 readiness 沒通過時，後端一樣是空的。分配流量的方式見 [負載平衡](#/skill/load-balancing)。

| `type` | 誰連得到 | 用途 |
|---|---|---|
| `ClusterIP`（預設） | 叢集內 | 服務之間互相呼叫；Ingress 的後端 |
| `NodePort` | 每個節點的固定 port（預設範圍 30000–32767） | 外部負載平衡器接進來、測試 |
| `LoadBalancer` | 外部 | 由雲端或 MetalLB 這類元件配一個外部 IP；地端沒有對應元件時會停在 pending |

同一個 namespace 裡用 `booking-api` 就連得到；跨 namespace 要寫 `booking-api.booking`，完整名稱是 `booking-api.booking.svc.cluster.local`（`cluster.local` 是預設的叢集網域）。

## Ingress：把外部流量導到 Service

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: booking-api
  namespace: booking
spec:
  ingressClassName: nginx              # 由哪一個 Ingress controller 處理
  tls:
    - hosts: [api.booking.example.org]
      secretName: booking-api-tls      # 型別是 kubernetes.io/tls 的 Secret，要在同一個 namespace
  rules:
    - host: api.booking.example.org
      http:
        paths:
          - path: /
            pathType: Prefix           # 必填：Prefix、Exact 或 ImplementationSpecific
            backend:
              service:
                name: booking-api      # ① Service 的名稱
                port:
                  number: 80           # ① Service 的 port（80），不是容器的 8000
```

- **`ingressClassName`**：叢集裡要先有 Ingress controller，這個值要對到它的 class（`kubectl get ingressclass` 可以列出）。沒寫、或寫了一個不存在的 class，就沒有任何 controller 處理這份 Ingress，`kubectl get ingress` 的 `ADDRESS` 欄會一直是空的。
- **`tls`**：憑證與私鑰放在 `kubernetes.io/tls` 型別的 Secret（鍵名是 `tls.crt` 與 `tls.key`），通常由 cert-manager 簽發與更新。憑證鏈的細節見 [HTTPS 憑證](#/skill/https-certificates)。
- **`pathType: Prefix`** 以路徑的「段」比對：`/api` 符合 `/api` 與 `/api/v1`，不符合 `/apiv2`。`Exact` 要完全相同。
- **`backend`** 只能指向**同一個 namespace** 的 Service。

Ingress 這個 API（`networking.k8s.io/v1`）是正式版，但官方文件說明它已凍結，新功能加在 Gateway API。另外如 [導入 Kubernetes 前要準備什麼](#/skill/k8s-readiness) 所述，社群維護的 ingress-nginx 專案已宣布退役（官方公告的停止維護時間是 2026 年 3 月），新的建置要評估其他 controller 或 Gateway API；這類資訊變動快，選型前查專案目前的維護狀態。

Gateway API 把 Ingress 拆成兩層：`Gateway`（入口、監聽的 port 與 TLS，通常由平台團隊管理）與 `HTTPRoute`（路由規則，由服務的團隊管理）。對應上面那份 Ingress 的 HTTPRoute：

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: booking-api
  namespace: booking
spec:
  parentRefs:
    - name: public-gateway             # 掛到哪一個 Gateway（要該 Gateway 允許這個 namespace 掛上來）
      namespace: gateway-system
  hostnames: ["api.booking.example.org"]
  rules:
    - matches:
        - path: { type: PathPrefix, value: / }
      backendRefs:
        - name: booking-api            # 一樣是 Service 的名稱與 port
          port: 80
```

換成 Gateway API 之後，接線 ①（路由 → Service 的名稱與 port）換了寫法，②③④ 完全不變。

## namespace：三個物件要在同一個

Deployment、Service、Ingress、Secret、ConfigMap 都屬於某個 namespace。前面的接線全部以 namespace 為界：Service 只選得到同 namespace 的 Pod、Ingress 只能指向同 namespace 的 Service、TLS Secret 也要在同一個 namespace。

- manifest 沒寫 `metadata.namespace`、指令也沒加 `-n` 時，物件會建在目前 context 的 namespace（沒設定過就是 `default`）。三份檔案裡有一份漏寫，就會出現「Service 在 `default`、Pod 在 `booking`」這種接不上的狀況。
- namespace 要先存在：`kubectl create namespace booking`，或寫成一份 `kind: Namespace` 的 manifest 一起套用。
- 同一份 manifest 要部署到多個 namespace 或多個環境時，不要複製貼上改字，用 [Helm、Kustomize 與 GitOps](#/skill/k8s-helm-gitops) 的做法。

## 套用與確認

```bash
kubectl diff -f k8s/                       # 套用前先看會改到什麼
kubectl apply -f k8s/                      # 套用整個目錄；內容沒變的物件回 unchanged
kubectl rollout status deployment/booking-api -n booking --timeout=120s
```

`kubectl apply` 是宣告式的：檔案描述「應該長這樣」，同一份檔案套用幾次結果都一樣。要注意它不會刪東西：把某個檔案從目錄裡移除，叢集裡對應的物件還在。

`rollout status` 會等到更新完成才結束；逾時或更新失敗時回傳非零的結束碼，所以 CI 的部署 job 用它判斷成敗（見 [GitLab CI/CD 實戰](#/skill/gitlab-cicd)）。接著逐條確認接線，輸出類似下面的格式：

```bash
# ④ Deployment 與 Pod：READY 的分子分母要相等
$ kubectl get deployment,pods -n booking -l app=booking-api
NAME                          READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/booking-api   3/3     3            3           2m

NAME                               READY   STATUS    RESTARTS   AGE
pod/booking-api-6b8f7c9d54-4xk2p   1/1     Running   0          2m
pod/booking-api-6b8f7c9d54-9dw7m   1/1     Running   0          2m
pod/booking-api-6b8f7c9d54-zq5tn   1/1     Running   0          2m

# ② Service 選到誰：ENDPOINTS 要有 Pod 的 IP
$ kubectl get endpointslices -n booking -l kubernetes.io/service-name=booking-api
NAME                ADDRESSTYPE   PORTS   ENDPOINTS                             AGE
booking-api-x7k2p   IPv4          8000    10.244.1.12,10.244.2.31,10.244.3.8   2m

# ③ 不經過 Ingress，直接從本機連 Service
$ kubectl port-forward -n booking service/booking-api 8080:80
$ curl -i http://localhost:8080/healthz

# ① Ingress：ADDRESS 有值，describe 看得到後端
$ kubectl get ingress -n booking
$ kubectl describe ingress booking-api -n booking
```

`kubectl describe` 最下面的 Events 是找原因的第一站；完整的排查順序見 [Kubernetes 排錯](#/skill/k8s-troubleshooting)。

新版出問題時回退：

```bash
kubectl rollout history deployment/booking-api -n booking     # 列出保留的版本
kubectl rollout undo deployment/booking-api -n booking        # 回到上一版
kubectl rollout undo deployment/booking-api -n booking --to-revision=4
```

`rollout undo` 把 Deployment 的 template 換回舊的 ReplicaSet 的內容，再跑一次滾動更新。兩件事要記得：它只改了叢集，Git 裡的 manifest 還是壞的那一版，下一次 `apply` 會把問題帶回來，所以 undo 之後要接著把 manifest 改回去；它也不會還原資料庫的 schema 變更。

## 常見錯誤與錯誤訊息

訊息的確切文字依 kubectl 與 Kubernetes 版本而異，下面是類似的樣子：

| 訊息或現象 | 原因 | 處理 |
|---|---|---|
| `The Deployment "booking-api" is invalid: spec.template.metadata.labels: Invalid value: …: selector does not match template labels` | 接線 ④：selector 與 template 的 label 不一致 | 兩邊改成一致 |
| `spec.selector: Invalid value: …: field is immutable` | 想修改既有 Deployment 的 selector | selector 不能改；刪除後重建，或換一個名稱建新的 |
| `no matches for kind "Ingress" in version "extensions/v1beta1"` | 用了已移除的舊 apiVersion（從舊文章複製來的範例） | 改成 `networking.k8s.io/v1`，並補上 `pathType` 與新的 `backend.service` 寫法 |
| `error converting YAML to JSON: yaml: line 14: mapping values are not allowed in this context` | 縮排錯誤，或冒號後面少了空白 | 看訊息指出的行號與它的上一行 |
| `namespaces "booking" not found` | namespace 還沒建立 | 先建立 namespace |
| `unknown field "spec.template.spec.containers[0].imagePullpolicy"` | 欄位名稱拼錯（大小寫也算） | 用 `kubectl explain deployment.spec.template.spec.containers` 查正確的欄位名稱 |
| 套用成功，Service 的 ENDPOINTS 是空的 | 接線 ②，或 Pod 沒有 ready，或不在同一個 namespace | `kubectl get pods --show-labels` 對照 Service 的 selector |
| `rollout status` 一直停在 `Waiting for deployment … rollout to finish` | 新版 Pod 起不來或 readiness 不通過 | 看新 Pod 的狀態與 Events；必要時 `rollout undo` |
| Ingress 的 `ADDRESS` 一直是空的 | 沒有 controller 處理這個 class | 檢查 `ingressClassName` 與叢集裡的 IngressClass |

## 動手

1. 執行上面兩段 Python。把第一段的 selector 改成各種寫法，看 endpoints 怎麼變；把第二段改成 `rolling_update(10, "25%", "25%")`，先自己算出 maxSurge 與 maxUnavailable 各是幾個再對答案。
2. 到 [K8sLab 實驗室](#/lab/K8sLab) 調整 maxSurge 與 maxUnavailable，並讓新版的 readiness 失敗，觀察更新停住時舊版的數量。
3. 做本課的程式題：一份有五個問題的 `deployment.yaml`，把副本數、image tag 與三條接線修好。
4. 有 kind 或 minikube 的話，套用本課的 Deployment 與 Service（image 換成任何公開的 web 映像），然後故意把 Service 的 selector 改錯，用 `kubectl get endpointslices` 看後端變成空的。
5. 接著讀 [Kubernetes 實作：設定、探針與資源](#/skill/k8s-config-probes)，把這份 Deployment 補成可以上線的樣子。

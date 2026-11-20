## 從一個具體問題開始：能跑的 Deployment，離上線還差四件事

[上一課](#/skill/k8s-manifests) 的 `booking-api` 已經接上 Service 與 Ingress。為了連資料庫，容器加了兩個環境變數：

```yaml
      containers:
        - name: api
          image: registry.example.org/booking/api:3f9c2a1b
          ports:
            - name: http
              containerPort: 8000
          env:
            - name: DB_HOST
              value: booking-db
            - name: DB_PASSWORD
              value: "S3cret-2024!"
```

這份設定能跑，但上線後會依序遇到四件事：

1. **密碼在 Git 裡**：manifest 進版本控制，密碼就跟著進去，所有能讀 repo 的人都看得到，而且刪不乾淨（見 [秘密管理](#/skill/secrets)）。
2. **每次更新都有幾秒的錯誤**：沒有 readiness 探針，容器一啟動就被當成 ready，程式還沒連上資料庫，流量就進來了。
3. **某天半夜被趕走**：沒寫 `resources`，排程器不知道它要多少資源；節點記憶體吃緊時，這種 Pod 最先被驅逐。
4. **每次更新都斷掉幾個請求**：舊 Pod 被刪除時，程式收到訊號就直接結束，處理到一半的請求沒有做完。

三種探針各自的作用、requests 與 limits 的概念，在 [導入 Kubernetes 前要準備什麼](#/skill/k8s-readiness) 與 [硬體資源與容量規劃](#/skill/capacity-planning) 講過。這一課講怎麼寫、每個欄位的實際行為，以及寫錯時會發生什麼。

## 設定：ConfigMap 與 Secret

一般設定放 ConfigMap，機密放 Secret，兩者都是鍵值對：

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: booking-config
  namespace: booking
data:
  DB_HOST: booking-db
  LOG_LEVEL: INFO
  app.ini: |                      # 值也可以是一整個檔案的內容
    [report]
    page_size = 50
```

Secret 的 YAML 不進 Git。測試時可以從一個不進版控的檔案建立；正式環境通常由外部的秘密管理系統同步進叢集（做法見 [Helm、Kustomize 與 GitOps](#/skill/k8s-helm-gitops)）：

```bash
kubectl create secret generic booking-secrets -n booking --from-env-file=.env.secret
```

注入 Pod 有三種方式：

```yaml
          env:
            - name: DB_PASSWORD               # ① 單一環境變數：指定哪個 Secret 的哪個鍵
              valueFrom:
                secretKeyRef:
                  name: booking-secrets
                  key: DB_PASSWORD
          envFrom:
            - configMapRef:                   # ② 整批：ConfigMap 的每個鍵都變成環境變數
                name: booking-config
          volumeMounts:
            - name: config                    # ③ 掛成檔案：每個鍵是一個檔案
              mountPath: /etc/booking
              readOnly: true
      volumes:
        - name: config
          configMap:
            name: booking-config
            items:
              - key: app.ini
                path: app.ini
```

| 方式 | ConfigMap 或 Secret 的值更新後 | 適合 |
|---|---|---|
| ① `env` 加 `valueFrom` | 執行中的容器**不會變**，要重建 Pod | 少數幾個值；變數名稱想和鍵名不同 |
| ② `envFrom` | 同上 | 鍵名本來就是變數名稱 |
| ③ 掛成檔案 | 檔案內容過一段時間會跟著更新（用 `subPath` 掛載的不會）；程式要自己重新讀檔 | 設定檔、憑證、內容較長的值 |

幾個實際的行為：

- **改了 ConfigMap 不會觸發滾動更新**。Deployment 的 template 沒變，就沒有新的 ReplicaSet。要讓 Pod 讀到新值，執行 `kubectl rollout restart deployment/booking-api -n booking`，或用 Kustomize 的 `configMapGenerator`（內容變了，名稱後面的雜湊跟著變，template 也就變了）。
- **參照的 ConfigMap 或 Secret 不存在**時，Pod 不會啟動：用 `env` 參照的停在 `CreateContainerConfigError`，用 volume 掛載的停在 `ContainerCreating`。確實可有可無的設定，在參照上加 `optional: true`。
- 設定與程式分離的原則見 [環境設定與 12-factor](#/skill/config-12factor)：同一個映像在每個環境都一樣，差別只在注入的 ConfigMap 與 Secret。

### Secret 只是 base64

```bash
$ kubectl get secret booking-secrets -n booking -o jsonpath='{.data.DB_PASSWORD}' | base64 -d
S3cret-2024!
```

base64 是編碼，不是加密，目的只是讓值可以放二進位內容。能讀這個 namespace 的 Secret 的人、能在這個 namespace 建 Pod 的人（把 Secret 掛進去再印出來），都拿得到明文。Secret 和 ConfigMap 在實作上的差別是：可以用 RBAC 分開授權、`kubectl describe` 不會印出值、掛成檔案時放在記憶體檔案系統。要真的保護它，需要 RBAC、etcd 的靜態加密，以及不讓原文進 Git，細節在 [秘密管理](#/skill/secrets)。

## 探針：每個欄位的行為

```yaml
          startupProbe:                 # 啟動期間用；通過之前另外兩個探針不會執行
            httpGet: { path: /healthz, port: http }
            periodSeconds: 5
            failureThreshold: 24        # 最多等 5 × 24 = 120 秒，超過就重啟容器
          readinessProbe:               # 失敗：從 Service 的後端移出，不重啟
            httpGet: { path: /ready, port: http }
            periodSeconds: 5
            timeoutSeconds: 2
            failureThreshold: 3
          livenessProbe:                # 失敗：重啟容器
            httpGet: { path: /healthz, port: http }
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
```

| 欄位 | 預設值 | 意思 |
|---|---|---|
| `initialDelaySeconds` | 0 | 容器啟動後等多久才開始探測 |
| `periodSeconds` | 10 | 每隔幾秒探測一次 |
| `timeoutSeconds` | 1 | 一次探測等多久算逾時 |
| `failureThreshold` | 3 | 連續失敗幾次才算失敗 |
| `successThreshold` | 1 | 連續成功幾次才算恢復（liveness 與 startup 只能是 1） |

探測方式有四種：`httpGet`（狀態碼 200–399 算成功）、`tcpSocket`（連得上就算成功）、`exec`（在容器裡執行指令，結束碼 0 算成功）、`grpc`。

從出問題到探針判定失敗，大約是 `periodSeconds × failureThreshold`：上面的 readiness 約 15 秒，liveness 約 30 秒。調這兩個數字是在「反應快」與「誤判」之間取捨。

啟動慢的服務不要靠加大 liveness 的 `initialDelaySeconds` 來撐：那個值設得夠大，等於每次卡死都要多等那麼久才發現。用 `startupProbe` 給啟動階段一個獨立的寬限，啟動完成後 liveness 就能維持短的間隔。

兩個端點要分開：

- `/healthz` 只回答「程序還在運作」，**不碰任何外部依賴**。
- `/ready` 回答「這個實例現在能處理請求」：啟動完成、沒有在關機、必要的依賴可用。readiness 該不該檢查共用的資料庫是一個取捨，見 [健康檢查、備份與事故處理](#/skill/reliability)。

### liveness 檢查資料庫：一次抖動變成全面重啟

把 liveness 也指到會檢查資料庫的 `/ready`，是最常見的探針事故。下面模擬 4 個 Pod、資料庫中斷 35 秒，印出 Service 後端（endpoints）的變化：

```python run
# readiness：每 5 秒一次、連續 3 次失敗移出、成功 1 次加回
# liveness ：每 10 秒一次、連續 3 次失敗重啟；重啟後要 40 秒才能再服務
def simulate(title, liveness_checks_db, db_down=(10, 45), local_fault=None, pods=4, until=100, startup=40):
    st = [{"ready": True, "r_fail": 0, "l_fail": 0, "back_at": -1} for _ in range(pods)]
    restarts, last, empty_seconds = 0, None, 0
    print(title)
    for t in range(0, until + 1, 5):
        db_ok = not (db_down[0] <= t < db_down[1])
        for i, s in enumerate(st):
            if t < s["back_at"]:                       # 重啟中
                continue
            faulty = local_fault and local_fault[0] == i and local_fault[1] <= t < local_fault[2]
            if db_ok and not faulty:                   # /ready 回 200
                s["r_fail"], s["ready"] = 0, True
            else:
                s["r_fail"] += 1
                if s["r_fail"] >= 3:
                    s["ready"] = False                 # 從 Service 的後端移出
            if t % 10 == 0:
                alive = db_ok if liveness_checks_db else True
                s["l_fail"] = 0 if alive else s["l_fail"] + 1
                if s["l_fail"] >= 3:                   # kubelet 重啟容器
                    s.update(ready=False, r_fail=0, l_fail=0, back_at=t + startup)
                    restarts += 1
        eps = [f"api-{i}" for i, s in enumerate(st) if s["ready"]]
        if not eps:
            empty_seconds += 5
        if eps != last:
            print(f"  t={t:>3}s  endpoints {len(eps)}/{pods}  {eps or '（空的，Service 沒有後端）'}")
            last = eps
    print(f"  重啟 {restarts} 次；Service 沒有後端的時間約 {empty_seconds} 秒\n")

simulate("A. 只有 api-2 自己出問題（t=10–40s），探針設對", False, db_down=(0, 0), local_fault=(2, 10, 40))
simulate("B. 資料庫中斷 35 秒，liveness 只看程序、readiness 檢查資料庫", False)
simulate("C. 資料庫中斷 35 秒，liveness 也檢查資料庫", True)
```

A 是 readiness 的正常用途：一個 Pod 出問題，它被移出、恢復後自動加回，其他 Pod 不受影響，沒有任何重啟。B 與 C 的資料庫都在第 45 秒恢復；B 立刻恢復服務，C 的四個 Pod 在第 30 秒一起被重啟，要到第 70 秒才回來。真實情況更糟：四個 Pod 同時啟動、同時重建連線，會再壓一次剛恢復的資料庫。

## 資源：requests 與 limits

```yaml
          resources:
            requests:
              cpu: "250m"             # 0.25 核
              memory: "256Mi"
            limits:
              memory: "512Mi"
```

| | requests | limits |
|---|---|---|
| CPU | 排程時保留；節點的 CPU 不夠分時，依 requests 的比例分配 | 超過會被節流（throttle），變慢但不會被殺 |
| 記憶體 | 排程時保留 | 超過會被 OOMKilled（Exit Code 137），容器重啟 |

排程器只看 requests、不看實際用量；數字該怎麼估、CPU 要不要設 limits 的取捨，見 [硬體資源與容量規劃](#/skill/capacity-planning)。這裡補充寫法上的細節：

- **單位**：CPU 的 `250m` 是千分之 250 核，`1` 是一核。記憶體用 `Mi`、`Gi`（二進位，1 Mi = 1,048,576 位元組）。`memory: 512m` 是合法的寫法，但意思是 0.512 位元組，小寫 `m` 是「千分之一」。
- **requests 不能大於 limits**，否則套用時被拒絕。只寫 limits 沒寫 requests 時，requests 會被設成和 limits 相同。
- **QoS 類別**由這些數字決定，共三種：`Guaranteed`（每個容器的 CPU 與記憶體都有 requests，而且等於 limits）、`Burstable`（有設定但不符合 Guaranteed）、`BestEffort`（完全沒設定）。節點記憶體不足時的驅逐順序見容量規劃那一課。
- namespace 設了 ResourceQuota 限制 CPU 或記憶體時，沒寫對應 requests、limits 的 Pod 會被拒絕建立；管理者可以用 LimitRange 給預設值。

:::stop 讀到這裡可以先停：會用 ConfigMap 與 Secret 注入設定、替三種探針選端點、寫出 requests 與 limits。後面的 HPA、優雅關機與非 root 執行，在服務要上正式環境、需要自動擴展或更新時不掉請求時再回來讀。

## HPA：依指標調整副本數

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: booking-api
  namespace: booking
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: booking-api
  minReplicas: 3
  maxReplicas: 12
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70      # 所有 Pod 的平均 CPU 用量 ÷ requests，目標 70%
```

HPA 定期計算：

```text
期望副本數 = ceil( 目前副本數 × 目前指標 ÷ 目標指標 )
```

`Utilization` 的分母是 **requests**，不是 limits，也不是節點的 CPU。所以 requests 的數字直接決定 HPA 什麼時候動：

```python run
import math

def desired(current, usage_m, request_m, target_pct, min_r, max_r, tolerance=0.10):
    util = usage_m / request_m * 100                 # 使用率 = 平均用量 ÷ requests
    ratio = util / target_pct
    if abs(ratio - 1) <= tolerance:                  # 預設容許 10% 的誤差，在範圍內不動
        return util, current, "在容許範圍內，不調整"
    want = math.ceil(current * ratio)
    final = max(min_r, min(max_r, want))
    note = "" if final == want else f"公式算出 {want}，受 min/max 限制"
    return util, final, note

cases = [
    # 目前副本, 平均用量(m), requests(m)
    (3, 300, 250),     # 用量超過 requests
    (3, 300, 500),     # 同樣的用量，requests 寫得比較大
    (3, 180, 250),     # 72%：和目標差不到 10%
    (6, 60, 250),      # 離峰
    (8, 700, 250),     # 暴增
]
for current, usage, request in cases:
    util, final, note = desired(current, usage, request, target_pct=70, min_r=3, max_r=12)
    print(f"副本 {current}、平均用量 {usage}m、requests {request}m → 使用率 {util:.0f}% → 期望副本 {final}  {note}")
```

第一、二組的實際用量一樣，只因為 requests 不同，一個擴到 6 個、一個完全不動。使用 HPA 前要知道的事：

- 叢集要有提供資源指標的元件（通常是 metrics-server），否則 HPA 拿不到數字。
- 目標 Deployment 的容器**一定要寫 CPU requests**，不然算不出使用率。
- 交給 HPA 管之後，Deployment 的 manifest 不要再寫死 `replicas`，否則每次 `kubectl apply` 都會把副本數改回去。
- 縮容預設會觀察一段時間（穩定視窗預設 300 秒）才動，避免流量一抖就來回擴縮。
- HPA 只是加 Pod。新 Pod 啟動要時間，瓶頸在資料庫時加 Pod 也沒有用，見 [擴展：無狀態、負載平衡、讀寫分離](#/skill/scaling)。

## 優雅關機

滾動更新、縮容、節點維護都會刪除 Pod。刪除時發生的事：

| 順序 | 事件 |
|---|---|
| 1 | Pod 被標成 Terminating。**同時**開始兩件事：把它從 Service 的後端移除；kubelet 開始關閉容器 |
| 2 | 有 `preStop` 就先執行它，結束後才對容器的主程序送 SIGTERM |
| 3 | 程式收到 SIGTERM：停止接新請求，把進行中的請求做完，關閉連線，結束 |
| 4 | 從第 1 步起算超過 `terminationGracePeriodSeconds`（預設 30 秒）還沒結束，送 SIGKILL |

第 1 步的兩件事是並行的。「從後端移除」要傳到每個節點與 Ingress controller 才生效，這需要一點時間；如果程式收到 SIGTERM 立刻關閉，這段時間內送來的請求就會失敗。常見做法是用 `preStop` 先等幾秒：

```yaml
    spec:
      terminationGracePeriodSeconds: 45     # 要大於 preStop 的時間加上最長的請求處理時間
      containers:
        - name: api
          lifecycle:
            preStop:
              exec:
                command: ["sleep", "5"]     # 映像裡要有 sleep 這個指令
```

Kubernetes 另有內建的 sleep 動作，寫成 `preStop: { sleep: { seconds: 5 } }`，不需要映像裡有 `sleep`：1.29 是 alpha、1.30 起是預設開啟的 beta、1.34 起是正式功能（2026 年 11 月依 Kubernetes 的 feature gate 文件核對）。叢集比 1.30 舊時用上面的 `exec` 寫法。

另外兩個條件：程式本身要處理 SIGTERM；容器的主程序（PID 1）要是應用程式本身，訊號才送得到。Dockerfile 的 `ENTRYPOINT` 用 shell form 時，PID 1 是 shell，訊號不會轉給程式，見 [幫 Python 專案寫好 Dockerfile](#/skill/dockerfile-python)。

節點維護（例如升級時把節點上的 Pod 清空）一次可能趕走同一個服務的好幾個 Pod。`PodDisruptionBudget`（`policy/v1`）用 `minAvailable` 或 `maxUnavailable` 限制這類自願性中斷一次能影響幾個。

## 以非 root 執行

```yaml
    spec:
      securityContext:                    # Pod 層：套用到每個容器
        runAsNonRoot: true                # 映像若以 root 執行，容器不會啟動
        runAsUser: 10001                  # 要和映像裡建立的使用者 UID 一致
      containers:
        - name: api
          securityContext:                # 容器層：會蓋過 Pod 層的同名設定
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true  # 程式要寫檔的目錄另外掛 emptyDir
            capabilities:
              drop: ["ALL"]
```

容器裡的 root 一旦逃出容器，在節點上的權限就大得多；以非 root 執行、不允許提權，是把這個風險降下來的基本設定。`runAsNonRoot: true` 需要 kubelet 能確認使用者不是 root：映像的 `USER` 寫的是名稱而不是數字 UID 時無法確認，容器會起不來，所以搭配 `runAsUser` 寫數字。

## 完整的 Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: booking-api
  namespace: booking
spec:
  selector:
    matchLabels:
      app: booking-api
  strategy:
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: booking-api
    spec:
      terminationGracePeriodSeconds: 45
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
      containers:
        - name: api
          image: registry.example.org/booking/api:3f9c2a1b
          ports:
            - name: http
              containerPort: 8000
          envFrom:
            - configMapRef:
                name: booking-config
          env:
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: booking-secrets
                  key: DB_PASSWORD
          startupProbe:
            httpGet: { path: /healthz, port: http }
            periodSeconds: 5
            failureThreshold: 24
          readinessProbe:
            httpGet: { path: /ready, port: http }
            periodSeconds: 5
            timeoutSeconds: 2
          livenessProbe:
            httpGet: { path: /healthz, port: http }
            periodSeconds: 10
            timeoutSeconds: 2
          resources:
            requests: { cpu: "250m", memory: "256Mi" }
            limits: { memory: "512Mi" }
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
          lifecycle:
            preStop:
              exec:
                command: ["sleep", "5"]
```

這份沒有寫 `replicas`，副本數交給上面的 HPA。

## 常見錯誤與錯誤訊息

訊息的確切文字依版本而異，下面是類似的樣子，都出現在 `kubectl describe pod` 的 Events 或狀態欄：

| 訊息或現象 | 原因 | 處理 |
|---|---|---|
| 狀態 `CreateContainerConfigError`，Events 有 `secret "booking-secrets" not found` | `env` 參照的 Secret 或 ConfigMap 不存在，或在別的 namespace | 建立它，或修正名稱；鍵名不存在時訊息會是 `couldn't find key …` |
| `Readiness probe failed: HTTP probe failed with statuscode: 503` | `/ready` 回報還不能服務；Pod 是 `Running` 但 `READY 0/1` | 看程式的 log：依賴連不上，或還在啟動 |
| `Readiness probe failed: … connect: connection refused` | 探針的 port 寫錯，或程式還沒開始監聽 | 對照 `containerPort` 與程式實際監聽的 port |
| `Liveness probe failed: … context deadline exceeded`，接著容器被重啟 | 探測逾時：`timeoutSeconds` 預設只有 1 秒，或端點做了太慢的事 | liveness 端點不要碰外部依賴；必要時調大逾時 |
| 容器啟動到一半就被重啟，反覆發生 | liveness 在啟動完成前就開始判定 | 加 `startupProbe` |
| `Last State: Terminated`、`Reason: OOMKilled`、`Exit Code: 137` | 記憶體超過 limits | 先分辨是 limits 太小還是洩漏，見 [Kubernetes 排錯](#/skill/k8s-troubleshooting) |
| `container has runAsNonRoot and image will run as root` | 映像以 root 執行 | 在 Dockerfile 建立非 root 使用者，並設定 `runAsUser` |
| `kubectl get hpa` 的 TARGETS 顯示 `<unknown>` | 沒有指標來源，或容器沒寫 CPU requests | `kubectl describe hpa` 的 Events 會說明是哪一種 |
| 改了 ConfigMap，程式還是讀到舊值 | 環境變數只在容器啟動時讀一次 | `kubectl rollout restart` |
| 每次部署都有少量 502 | 沒有優雅關機，或沒有 `preStop` 等待 | 處理 SIGTERM、加 `preStop`、確認 PID 1 是應用程式 |

## 動手

1. 執行探針的模擬，在 C 那一行加上 `db_down=(10, 30)`（中斷 20 秒）再跑：liveness 連續失敗不到 3 次，就不會重啟。想一下 `periodSeconds × failureThreshold` 要撐過多久的抖動才夠，以及把它調大的代價是什麼。
2. 執行 HPA 的計算，把 `target_pct` 改成 50 與 90，觀察同一組數字下的副本數。
3. 做本課的程式題：替一份 Deployment 補上探針、資源、Secret 參照與非 root 的 securityContext。
4. 有測試叢集的話，套用完整的 Deployment 後執行 `kubectl delete pod <名稱>`，同時用迴圈打 Service，比較有沒有 `preStop` 時失敗的請求數。
5. Pod 起不來、被重啟、連不到時怎麼查，接著讀 [Kubernetes 排錯](#/skill/k8s-troubleshooting)。

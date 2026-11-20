## 這階段要做出什麼

掛號後端已經有映像（第 7 階段）、有日誌與指標（第 8 階段）。醫院明年導入 Kubernetes 叢集，服務要搬上去，條件是：至少兩個副本、設定與密碼不進映像、更新版本時不中斷掛號、資料庫 migration 在新版上線前跑完。

產出是 `k8s/` 目錄裡的 manifest，加上改寫過的 deploy job：

| 物件 | 負責什麼 |
|---|---|
| Deployment | 映像、副本數、怎麼換版、探針（probe）、資源、設定從哪裡讀 |
| Service | 給這組 Pod 一個穩定的名稱，只把流量分給 ready 的 Pod |
| Ingress | 把 `clinic.example` 的 HTTPS 流量導到 Service，TLS 在這裡終止 |
| ConfigMap | 非機密設定：日誌等級、Redis 位址 |
| Secret | `DATABASE_URL` 等機密；建在叢集裡，明文不進 Git |
| Job | 用同一個映像跑一次 migration |
| PodDisruptionBudget | 節點維護時一次最多驅逐幾個 Pod |

PostgreSQL 留在既有的主機，不放進叢集（取捨見 [導入 Kubernetes 前要準備什麼](#/skill/k8s-readiness)）。寫法見 [把服務寫成 manifest](#/skill/k8s-manifests) 與 [設定、探針與資源](#/skill/k8s-config-probes)。

## 設計決策與取捨

### 名稱與 label 是接點

```text
Ingress     host clinic.example ──► backend: service clinic-api、port 80
Service     name clinic-api，selector app=clinic-api，port 80 → targetPort 8000
Deployment  selector.matchLabels app=clinic-api ＝ template 的 labels app=clinic-api
Pod         label app=clinic-api，容器聽 8000
```

Deployment 的 `selector` 和自己 template 的 label 對不上，API 會直接拒絕；Service 的 selector 對不到任何 Pod 卻不會報錯，只是後面沒有位址。

### 映像寫固定的 tag

Deployment 指到第 7 階段 CI 推的 commit SHA。用 `latest` 時，Pod template 沒變，重新 `kubectl apply` 不會換版；不同時間啟動的 Pod 可能拉到不同內容；`kubectl rollout undo` 回到的還是 `latest`。

### 設定進 ConfigMap，密碼進 Secret

非機密設定用 `envFrom` 整包讀 ConfigMap，`DATABASE_URL` 用 `secretKeyRef` 從 Secret 讀。Secret 的值只是 base64 編碼，不是加密：明文不進 Git，並用 RBAC 限制誰能讀（見 [祕密管理](#/skill/secrets)）。環境變數只在容器啟動時讀一次，改了設定要 `kubectl rollout restart`。

### 兩個健康檢查端點，各接一種探針

| 端點 | 做什麼 | 探針 | 失敗時 |
|---|---|---|---|
| `GET /healthz` | 不碰外部依賴，直接回 200 | liveness | 重啟容器 |
| `GET /ready` | 對資料庫跑 `SELECT 1`（逾時 1 秒）；收到 SIGTERM 後回 503 | readiness | 從 Service 移出，恢復後加回 |

兩個端點和第 8 階段的 `/metrics` 一樣不需要登入。liveness 不能打 `/ready`：資料庫短暫不穩時，所有 Pod 一起重啟、又一起去連資料庫，小問題變成全面停機（[可靠性](#/skill/reliability) 有模擬）。

### requests 與 limits

`resources` 依第 8 階段的指標在尖峰時的用量填，文中的數字是示意值，估法見 [硬體資源與容量規劃](#/skill/capacity-planning)。副本變多後，資料庫連線數用「每個 Pod 的連線池 ×（replicas + maxSurge）」估，不能超過 `max_connections`。

### 滾動更新：maxSurge 1、maxUnavailable 0

`maxUnavailable: 0` 是「可用的 Pod 數不低於 replicas」，所以只能先多開一個新的（`maxSurge: 1`），等它可用再關一個舊的。兩個值不能同時是 0。

「可用」看的是 Pod 的 Ready 狀態。沒有 readiness 探針時，容器一啟動就算 Ready，應用程式還沒連上資料庫，舊 Pod 就被關掉了。所以 `maxUnavailable: 0` 要搭配如實回報的 readiness 探針才不會中斷。

### 優雅關機

舊 Pod 被刪除時，「從 Service 的後端移除」和「通知容器結束」同時開始，前者要幾秒才生效：

1. `preStop` 先 `sleep 5`，這段時間照常服務。
2. 接著容器收到 SIGTERM，uvicorn 停止接新連線、做完進行中的請求。第 7 階段的 exec 形式 `CMD` 讓它收得到訊號。
3. 超過 `terminationGracePeriodSeconds`（預設 30 秒，包含 `preStop` 的時間）就被 SIGKILL，所以它要大於「preStop 等待 + 最長的請求」。

### migration 用 Job 跑一次

每個副本啟動時各自跑 migration 會同時嘗試（第 7 階段已排除）。改成一個 Job：同一個映像與 Secret，指令換成 migration 工具（示意用 Alembic）。Job 的 Pod template 建立後不能改，所以名稱帶 commit SHA。

## 關鍵設定

Deployment：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: clinic-api
  namespace: clinic
spec:
  replicas: 2
  selector:
    matchLabels:
      app: clinic-api
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: clinic-api
    spec:
      terminationGracePeriodSeconds: 30
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001            # 第 7 階段 Dockerfile 建的 UID
      containers:
        - name: api
          image: registry.gitlab.example/clinic/api:3f9c2a1b   # commit SHA，由 CI 換成該次的版本
          ports:
            - name: http
              containerPort: 8000
          envFrom:
            - configMapRef:
                name: clinic-api-config
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: clinic-api-secret
                  key: DATABASE_URL
          readinessProbe:
            httpGet:
              path: /ready
              port: http
            periodSeconds: 5
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 10
            periodSeconds: 10
          resources:
            requests:
              cpu: 250m
              memory: 512Mi
            limits:
              memory: 512Mi
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
          lifecycle:
            preStop:
              exec:
                command: ["sleep", "5"]
```

Service 與 Ingress：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: clinic-api
  namespace: clinic
spec:
  selector:
    app: clinic-api
  ports:
    - name: http
      port: 80
      targetPort: 8000
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: clinic-api
  namespace: clinic
spec:
  ingressClassName: nginx          # 換成叢集實際的 IngressClass（kubectl get ingressclass）
  tls:
    - hosts:
        - clinic.example
      secretName: clinic-tls       # 型別 kubernetes.io/tls，放憑證與私鑰
  rules:
    - host: clinic.example
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: clinic-api
                port:
                  number: 80
```

處理流量的是叢集裝的 Ingress controller。社群維護的 ingress-nginx 已宣布退役，醫院的叢集可能用別的 controller 或 Gateway API（屆時 Ingress 換成 Gateway 與 HTTPRoute），先問叢集管理者。

migration Job（`__SHA__` 由 CI 代換）與 PodDisruptionBudget：

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: clinic-migrate-__SHA__
  namespace: clinic
spec:
  backoffLimit: 0                  # 失敗不自動重試，交給人看
  activeDeadlineSeconds: 300
  ttlSecondsAfterFinished: 86400   # 結束一天後自動清掉
  template:
    spec:
      restartPolicy: Never
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
      containers:
        - name: migrate
          image: registry.gitlab.example/clinic/api:__SHA__
          command: ["alembic", "upgrade", "head"]
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: clinic-api-secret
                  key: DATABASE_URL
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: clinic-api
  namespace: clinic
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: clinic-api
```

Secret 的建立方式（示意；`prod.env` 不進 Git）：

```bash
kubectl create secret generic clinic-api-secret -n clinic --from-env-file=prod.env
```

## 上線順序

規則見 [部署策略與資料庫遷移](#/skill/cd-strategies)：任何時刻在跑的所有版本，都要能和當下的 schema 一起運作。滾動更新期間新舊版並存，所以一次上線只做擴張（expand），收縮（contract）留給之後的版本。

| 步驟 | 做什麼 | 失敗時 |
|---|---|---|
| 1. migration | Job 只做 expand：加表、加可為空的欄位 | pipeline 停住，舊版不受影響 |
| 2. 滾動更新 | 換映像，一次換一個 | readiness 不通過，更新停住，舊版繼續服務 |
| 3. 確認 | `kubectl rollout status`、打一個讀取 API、看 5xx 比例與延遲 | `kubectl rollout undo`；schema 只擴張過，舊版還能跑 |
| 4. contract | 之後的版本才刪舊欄位 | 不可逆，過了回滾窗口才做 |

例：這一版新增可為空的 `appointments.visit_type`，新版開始寫入，舊版照常運作；確定不回滾之後，下一版才加 `NOT NULL`。

## 用模擬看滾動更新

每一輪先把啟動夠久的新 Pod 算成可服務，再依 `maxUnavailable` 關舊的、依 `maxSurge` 開新的。`probe=False` 代表沒有 readiness 探針。

```python run
def rollout(replicas, max_surge, max_unavailable, warmup=1, probe=True):
    """模擬滾動更新。回傳每一輪的 (舊 Pod, 新 Pod, Kubernetes 認定可用, 實際能服務)。
    warmup：新 Pod 啟動後要幾輪才真的能處理請求；probe=False 代表沒設 readiness 探針"""
    if max_surge == 0 and max_unavailable == 0:
        raise ValueError("maxSurge 與 maxUnavailable 不能同時為 0")
    old, ages = replicas, []                      # ages：每個新 Pod 已經啟動幾輪
    rows = [(old, 0, replicas, replicas)]
    while old > 0 or any(a < warmup for a in ages):
        ages = [a + 1 for a in ages]
        really = sum(1 for a in ages if a >= warmup)          # 真的能服務的新 Pod
        counted = really if probe else len(ages)              # 沒有探針：容器一啟動就算 ready
        # 縮舊的：Kubernetes 認定的可用數不能低於 replicas - maxUnavailable
        old -= max(0, min(old, old + counted - (replicas - max_unavailable)))
        # 開新的：總數不能超過 replicas + maxSurge
        ages += [0] * max(0, min(replicas + max_surge - old - len(ages), replicas - len(ages)))
        counted = old + (really if probe else len(ages))
        rows.append((old, len(ages), counted, old + really))
    return rows


def show(title, **kw):
    rows = rollout(**kw)
    print(title)
    print("  輪  舊  新  K8s認定可用  實際能服務")
    for i, (old, new, counted, serving) in enumerate(rows):
        print(f"  {i:>2}  {old:>2}  {new:>2}  {counted:>10}  {serving:>9}" + ("   ← 沒有 Pod 能服務" if serving == 0 else ""))
    print(f"  實際能服務的最小值：{min(r[3] for r in rows)}\n")


show("A. maxSurge 1、maxUnavailable 0、有 readiness 探針（新 Pod 要 3 輪才準備好）",
     replicas=2, max_surge=1, max_unavailable=0, warmup=3, probe=True)
show("B. 同樣的設定，但沒有 readiness 探針",
     replicas=2, max_surge=1, max_unavailable=0, warmup=3, probe=False)
show("C. maxSurge 0、maxUnavailable 1、有探針",
     replicas=2, max_surge=0, max_unavailable=1, warmup=3, probe=True)
```

A 全程維持 2 個；B 的設定一字不差，可服務數卻掉到 0；C 不中斷，但更新期間只剩一半容量。

manifest 之間的接點可以在套用前檢查。這段故意放了三個錯：

```python run
def check(deployment, service, ingress):
    """檢查 Deployment、Service、Ingress 的接點，回傳問題清單"""
    problems = []
    pod = deployment["spec"]["template"]
    labels = pod["metadata"]["labels"]
    listening = {p["containerPort"] for c in pod["spec"]["containers"] for p in c.get("ports", [])}

    def selects(selector):                       # selector 的每一組 key/value 都要在 Pod 的 label 裡
        return bool(selector) and all(labels.get(k) == v for k, v in selector.items())

    if not selects(deployment["spec"]["selector"]["matchLabels"]):
        problems.append("Deployment 的 selector 對不到自己的 Pod template")
    if not selects(service["spec"]["selector"]):
        problems.append(f"Service 的 selector {service['spec']['selector']} 對不到 Pod 的 label {labels}")
    for p in service["spec"]["ports"]:
        if p["targetPort"] not in listening:
            problems.append(f"Service 的 targetPort {p['targetPort']} 不是容器在聽的 port {sorted(listening)}")
    service_ports = {p["port"] for p in service["spec"]["ports"]}
    tls_hosts = {h for t in ingress["spec"].get("tls", []) for h in t["hosts"]}
    for rule in ingress["spec"]["rules"]:
        if rule["host"] not in tls_hosts:
            problems.append(f"Ingress 的 host {rule['host']} 沒有對應的 TLS 設定")
        for path in rule["http"]["paths"]:
            backend = path["backend"]["service"]
            if backend["name"] != service["metadata"]["name"]:
                problems.append(f"Ingress 指到 Service {backend['name']}，但 Service 叫 {service['metadata']['name']}")
            elif backend["port"]["number"] not in service_ports:
                problems.append(f"Ingress 指到 port {backend['port']['number']}，Service 只開了 {sorted(service_ports)}")
    return problems


deployment = {"spec": {
    "selector": {"matchLabels": {"app": "clinic-api"}},
    "template": {"metadata": {"labels": {"app": "clinic-api"}},
                 "spec": {"containers": [{"name": "api", "ports": [{"containerPort": 8000}]}]}}}}
service = {"metadata": {"name": "clinic-api"},
           "spec": {"selector": {"app": "clinic"},                       # 錯 1：label 少了 -api
                    "ports": [{"port": 80, "targetPort": 80}]}}          # 錯 2：容器聽的是 8000
ingress = {"spec": {"tls": [{"hosts": ["clinic.example"], "secretName": "clinic-tls"}],
                    "rules": [{"host": "clinic.example", "http": {"paths": [
                        {"path": "/", "backend": {"service": {"name": "clinic-api", "port": {"number": 8000}}}}]}}]}}  # 錯 3：Service 開的是 80

for line in check(deployment, service, ingress) or ["接點都對得上"]:
    print("·", line)

service["spec"] = {"selector": {"app": "clinic-api"}, "ports": [{"port": 80, "targetPort": 8000}]}
ingress["spec"]["rules"][0]["http"]["paths"][0]["backend"]["service"]["port"]["number"] = 80
print("\n修正後：")
for line in check(deployment, service, ingress) or ["接點都對得上"]:
    print("·", line)
```

## 接上 GitLab CI

第 7 階段的 deploy job 只在 main 執行。這一階段把內容換成 kubectl，並加上手動核准（示意）：

```yaml
deploy_production:
  stage: deploy
  image: registry.gitlab.example/tools/kubectl:1.31   # 內部維護、裝有 kubectl 的映像
  environment:
    name: production
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
      when: manual                  # 有人按下才部署到 production
  script:
    - kubectl apply -n clinic -f k8s/configmap.yaml -f k8s/service.yaml -f k8s/ingress.yaml -f k8s/pdb.yaml
    # 1. migration：每一版一個 Job，完成才往下走
    - sed "s/__SHA__/$CI_COMMIT_SHA/g" k8s/migrate-job.yaml | kubectl apply -n clinic -f -
    - kubectl wait -n clinic --for=condition=complete --timeout=300s "job/clinic-migrate-$CI_COMMIT_SHA"
    # 2. 換映像，等滾動更新完成；逾時這個 job 就失敗
    - kubectl set image -n clinic deployment/clinic-api "api=$CI_REGISTRY_IMAGE:$CI_COMMIT_SHA"
    - kubectl rollout status -n clinic deployment/clinic-api --timeout=300s
```

- `when: manual` 讓 job 等人按下才執行；誰能按，用受保護的分支或環境限制（依 GitLab 版本與方案）。
- kubectl 連叢集：把 kubeconfig 存成 File 型別的 CI/CD variable `KUBECONFIG`（設成 protected），或用 GitLab agent for Kubernetes；這個身分只給 `clinic` namespace 的部署權限。
- Job 失敗時，`kubectl wait --for=condition=complete` 會等到逾時才結束。
- `set image` 之後，`deployment.yaml` 裡的 tag 停在舊值，直接 `kubectl apply` 這個檔案會把映像換回去。常見的解法是 [Helm、Kustomize 或 GitOps](#/skill/k8s-helm-gitops)。

## 常見錯誤與錯誤訊息

**selector 對不上。** Deployment 自己對不上時，`kubectl apply` 的錯誤類似：

```text
The Deployment "clinic-api" is invalid: spec.template.metadata.labels: Invalid value: map[string]string{"app":"clinic"}: `selector` does not match template `labels`
```

Service 對不上則沒有錯誤，Ingress 回 503；用 `kubectl get endpointslices` 看後面有沒有位址（[排錯](#/skill/k8s-troubleshooting)）。

**映像用 `latest`。** 重新部署後沒有換版，或兩個 Pod 行為不同，也無從回滾。

**liveness 打到會查資料庫的路徑。** 資料庫慢幾十秒，所有 Pod 的 RESTARTS 一起增加，Events 類似：

```text
Warning  Unhealthy  Liveness probe failed: HTTP probe failed with statuscode: 503
Normal   Killing    Container api failed liveness probe, will be restarted
```

**limits 太小被 OOMKilled。** Last State 是 `OOMKilled`、Exit Code 137。先看記憶體曲線，分辨是用量本來就大還是洩漏。

**`runAsNonRoot` 遇到非數字的 USER。** 第 7 階段的 Dockerfile 寫 `USER app`，kubelet 無法確認它不是 root，訊息類似：

```text
Error: container has runAsNonRoot and image has non-numeric user (app), cannot verify user is non-root
```

manifest 加 `runAsUser: 10001`，或 Dockerfile 改成 `USER 10001`。

**Secret 明文進了 Git。** base64 解開就是連線字串，而且留在歷史裡。要輪替密碼，刪 commit 沒有用。

**migration 和程式不相容。** 同一版做了改名或刪欄位，還在服務的舊版出現類似 `column "..." does not exist` 的錯誤，回滾也救不了。拆成 expand 與 contract 兩個版本。

**沒有 PodDisruptionBudget。** 兩個副本在同一個節點，節點維護時一次全被驅逐。設了之後 drain 會出現類似 `Cannot evict pod as it would violate the pod's disruption budget` 的訊息並重試，等另一個副本 ready；`minAvailable` 設成和 replicas 一樣則永遠卡住。

## 驗收題在測什麼

三題都在瀏覽器裡驗收，不會連到叢集。兩題設定檔題把 YAML 解析成物件再檢查，欄位順序與縮排風格不影響結果；第三題把模擬寫成函式。檢查通過不代表在叢集上跑得起來：IngressClass、憑證、映像拉取權限要在真的叢集上驗證。

## 動手

1. 執行滾動更新的模擬，把 A 改成 `replicas=1, max_surge=0, max_unavailable=1`，看可服務數掉到 0。
2. 執行 manifest 檢查那段，把 Deployment 的 `matchLabels` 改成 `{"app": "clinic"}`，看多出哪一條。
3. 做下面三道驗收題。
4. 有 Docker 的話，照參考專案的 [在本機的 Kubernetes 叢集跑 clinic-api](https://github.com/yo02741/Backend-Atlas/blob/main/companion/clinic-api/docs/local-k8s.md)，用 kind 把這一階段的 manifest 在真的叢集上套用一次、做一次滾動更新，再故意弄壞六次，照排錯課的順序查出原因。

## 串接驗收

**1. 準備一個在跑的版本。** 照後端參考專案的 [在本機的 Kubernetes 叢集跑 clinic-api](https://github.com/yo02741/Backend-Atlas/blob/main/companion/clinic-api/docs/local-k8s.md)，用 `scripts/kind-up.sh` 建好叢集，`kubectl -n clinic port-forward service/clinic-api 8000:80` 之後跑 `scripts/smoke.sh`。另開一個終端機持續打 `/ready`，數失敗的次數：

```bash
fail=0; while true; do curl -sf -o /dev/null http://127.0.0.1:8000/ready || fail=$((fail+1)); echo "失敗 $fail"; sleep 0.5; done
```

預期：smoke 每一行都是 `ok`，失敗次數 0。

**2. 發一個壞版本。** 照那份文件的練習 5 把 readiness 的路徑改成 `/readyz`。先預測：有幾個舊 Pod 繼續服務、失敗次數會不會增加、`kubectl -n clinic rollout status deployment/clinic-api --timeout=60s` 怎麼結束。預期：兩個舊 Pod 都還是 Ready、失敗次數不變、`rollout status` 逾時後以非 0 的結束碼退出。放在 CI 裡，這就是 deploy job 失敗的那一刻。

**3. 回退並確認。** 執行 `kubectl -n clinic rollout undo deployment/clinic-api`，再跑一次 `rollout status` 與 `smoke.sh`。預期：`successfully rolled out`、smoke 全部 `ok`；`kubectl -n clinic get rs` 裡壞掉的那個 ReplicaSet 副本數是 0；整段期間失敗次數仍是 0。

**4. undo 救不了的情況。** 寫下一個會讓步驟 3 失效的 migration，對照「上線順序」那張表說明要怎麼拆。預期：同一版刪欄位或改名時，退回去的舊版查不到欄位；要拆成先 expand、確定不回滾之後下一版再 contract。對照[第 7 階段](#/project/ship)：回退的單位是映像 tag（commit SHA），舊的 tag 要還留在 registry 裡。

# 在本機的 Kubernetes 叢集跑 clinic-api

用 [kind](https://kind.sigs.k8s.io/) 在自己的電腦上建一個單節點的 Kubernetes 叢集，套用 `k8s/overlays/kind`，用 port-forward 走完掛號流程、做一次滾動更新，再故意弄壞六次，照 [Kubernetes 排錯](https://u-kinda-should-know.web.app/#/skill/k8s-troubleshooting) 的順序查出原因。manifest 每個欄位為什麼這樣寫，見實作路線的 [第 10 階段：部署到 Kubernetes](https://u-kinda-should-know.web.app/#/project/k8s)。

- 所有指令都在 `companion/clinic-api/` 目錄執行。
- 預期輸出取自 kind v0.33.0、kubectl v1.37.2、Kubernetes v1.37.0 實際執行的結果，只留關鍵的幾行。Pod 名稱後面的亂數、IP、時間每次都不一樣。
- 想先一次跑完再回頭看：`bash scripts/kind-up.sh`，見[用腳本一次做完](#用腳本一次做完)。

## 前置需求

| 工具 | 版本 | 確認的指令與預期輸出 |
|---|---|---|
| 容器執行環境 | Docker Engine（Linux）、Docker Desktop（macOS、Windows），或其他提供 `docker` 指令的相容環境 | `docker info --format '{{.CgroupVersion}}'` → `2` |
| kind | v0.33.0 | `kind version` → `kind v0.33.0 go1.26.7 linux/amd64` |
| kubectl | v1.37.2（叢集是 v1.37.0；kubectl 與叢集的 minor 版本最多差一版） | `kubectl version --client` → `Client Version: v1.37.2`、`Kustomize Version: v5.8.1` |
| curl、python3 | 不限 | `scripts/smoke.sh` 與下面的 curl 範例會用到 |

- **Docker Desktop 的授權**：員工超過 250 人或年營收超過 1,000 萬美元的組織，使用 Docker Desktop 需要付費訂閱。醫院屬於這個規模，先向資訊單位確認有沒有授權；沒有的話改用其他執行環境（Linux 上安裝的 Docker Engine 是開放原始碼軟體，不是 Docker Desktop；kind 也支援 Podman，但標示為實驗性）。詳細以 [Docker 官方的說明與條款](https://www.docker.com/pricing/faq/) 為準。本指南只在 Linux 的 Docker Engine 上實際跑過。
- **cgroup v2**：這個版本的 kubelet 預設不在 cgroup v1 的主機上啟動。Docker Desktop 與近年的 Linux 發行版都是 v2；較舊的發行版（例如 RHEL 8、CentOS 7）預設是 v1，症狀見[常見問題](#常見問題)。
- **記憶體**：整套（含選讀的 Envoy Gateway）跑起來，節點容器用了約 1.4 GB。Docker Desktop 這類在虛擬機裡跑容器的環境，分給虛擬機的記憶體建議至少 4 GB。

安裝 kind 與 kubectl（Linux x86-64；macOS 的 Apple 晶片把 `linux-amd64` 換成 `darwin-arm64`、`linux/amd64` 換成 `darwin/arm64`、`sha256sum` 換成 `shasum -a 256`）：

```bash
curl -LO https://github.com/kubernetes-sigs/kind/releases/download/v0.33.0/kind-linux-amd64
curl -LO https://github.com/kubernetes-sigs/kind/releases/download/v0.33.0/kind-linux-amd64.sha256sum
sha256sum --check kind-linux-amd64.sha256sum            # kind-linux-amd64: OK
sudo install -m 0755 kind-linux-amd64 /usr/local/bin/kind

curl -LO https://dl.k8s.io/release/v1.37.2/bin/linux/amd64/kubectl
curl -LO https://dl.k8s.io/release/v1.37.2/bin/linux/amd64/kubectl.sha256
echo "$(cat kubectl.sha256)  kubectl" | sha256sum --check   # kubectl: OK
sudo install -m 0755 kubectl /usr/local/bin/kubectl
```

## k8s/ 的結構

manifest 整理成 Kustomize 的 base 與 overlay（做法見 [Helm、Kustomize 與 GitOps](https://u-kinda-should-know.web.app/#/skill/k8s-helm-gitops)）：

```text
k8s/
├── kind-config.yaml            kind 叢集：一個節點，Kubernetes v1.37.0
├── kind-config-workers.yaml    選讀：一個 control plane 加兩個 worker（第 9 節）
├── base/                       每個環境共用
│   ├── kustomization.yaml
│   ├── deployment.yaml         2 個副本、探針、requests 與 limits、非 root
│   ├── service.yaml
│   ├── configmap.yaml
│   ├── pdb.yaml
│   └── migrate-job.yaml        名稱由 overlay 接上映像的 tag
├── overlays/
│   ├── kind/                   本機（這份指南）
│   │   ├── kustomization.yaml      映像 clinic-api:v1、secretGenerator、replacements
│   │   ├── namespace.yaml
│   │   ├── postgres.yaml           只供本機的 PostgreSQL（StatefulSet + PVC）
│   │   ├── redis.yaml              只供本機的 Redis
│   │   ├── patch-api.yaml          imagePullPolicy: IfNotPresent、requests 調小
│   │   └── patch-migrate.yaml      init container 先等資料庫
│   └── production/             正式環境（.gitlab-ci.yml 的 deploy_production）
│       ├── kustomization.yaml      registry 的映像，tag 由 CI 換成 commit SHA
│       ├── ingress.yaml
│       └── secret.example.yaml     範本，不會被套用
└── gateway-api/                選讀：Gateway 與 HTTPRoute
```

| | `overlays/kind` | `overlays/production` |
|---|---|---|
| 映像 | 本機建置的 `clinic-api:v1`，用 `kind load` 放進節點，`imagePullPolicy: IfNotPresent` | `registry.gitlab.example/clinic/api:<commit SHA>`，CI 用 `kustomize edit set image` 設定 |
| PostgreSQL、Redis | 跑在叢集裡，只供本機，沒有備份 | 叢集外既有的服務（取捨見 [導入 Kubernetes 前要準備什麼](https://u-kinda-should-know.web.app/#/skill/k8s-readiness)） |
| Secret | `secretGenerator` 產生，值是寫在檔案裡的本機假值 | 叢集管理者用 `kubectl create secret` 建立，明文不進 Git |
| namespace | manifest 建立 | 叢集管理者建立 |
| 對外 | `kubectl port-forward` | Ingress（或選讀的 Gateway API） |
| migration 的順序 | 第一次部署時 Job 和 Deployment 一起套用，Job 的 init container 先等資料庫；第 6 節的更新照正式環境的順序 | 先只套用 Job、等它完成，再套用其餘 |

migration Job 的 Pod template 建立後不能改，所以每一版要一個新的 Job。兩個 overlay 都用 `replacements` 從 Deployment 的 image 取出 tag，接在 Job 名稱後面（`clinic-migrate-v1`、`clinic-migrate-<SHA>`），tag 只需要在 overlay 的 `images` 寫一次。

`kubectl kustomize` 只輸出合併後的 YAML，不碰叢集，可以先看結果：

```bash
kubectl kustomize k8s/overlays/kind | grep -E '^kind:' | sort | uniq -c
```

```text
      1 kind: ConfigMap
      2 kind: Deployment
      1 kind: Job
      1 kind: Namespace
      1 kind: PodDisruptionBudget
      2 kind: Secret
      3 kind: Service
      1 kind: StatefulSet
```

## 1. 建叢集

```bash
kind create cluster --config k8s/kind-config.yaml --wait 120s
```

```text
Creating cluster "clinic" ...
 ✓ Ensuring node image (kindest/node:v1.37.0) 🖼
 ✓ Preparing nodes 📦
 ✓ Writing configuration 📜
 ✓ Starting control-plane 🕹️
 ✓ Installing CNI 🔌
 ✓ Installing StorageClass 💾
 ✓ Waiting ≤ 2m0s for control-plane = Ready ⏳
 • Ready after 16s 💚
Set kubectl context to "kind-clinic"
```

第一次會下載節點映像（解開後約 1.3 GB）。叢集名稱 `clinic` 寫在 `kind-config.yaml`。

```bash
kubectl get nodes
```

```text
NAME                   STATUS   ROLES           AGE   VERSION
clinic-control-plane   Ready    control-plane   20s   v1.37.0
```

kind 把目前的 context 切到 `kind-clinic`，之後的 kubectl 指令都送到這個叢集。同一台電腦也連著別的叢集時，先用 `kubectl config current-context` 確認。

## 2. 建置映像並載入節點

```bash
docker build -t clinic-api:v1 .
kind load docker-image clinic-api:v1 --name clinic
```

```text
Image: "clinic-api:v1" with ID "sha256:…" not yet present on node "clinic-control-plane", loading...
```

kind 的節點本身是一個容器，裡面有自己的 containerd 與映像庫，看不到主機 Docker 裡的映像，`kind load` 把映像複製進去：

```bash
docker exec clinic-control-plane crictl images | grep clinic-api
```

```text
docker.io/library/clinic-api   v1   a3501a3051118   65.4MB
```

映像名稱沒有 registry 主機時，containerd 把它補成 `docker.io/library/…`。`patch-api.yaml` 設了 `imagePullPolicy: IfNotPresent`：節點上有這個 tag 就直接用；沒有，就到 Docker Hub 找 `library/clinic-api`（練習 1 會看到）。

## 3. 套用 overlay

```bash
kubectl apply -k k8s/overlays/kind
```

```text
namespace/clinic created
configmap/clinic-api-config created
secret/clinic-api-secret-k79m226m89 created
secret/postgres-secret-65cc24tf5c created
service/clinic-api created
service/postgres created
service/redis created
deployment.apps/clinic-api created
deployment.apps/redis created
statefulset.apps/postgres created
poddisruptionbudget.policy/clinic-api created
job.batch/clinic-migrate-v1 created
```

- Secret 的名稱後面多了內容的雜湊。Deployment 與 Job 裡參照的 `clinic-api-secret` 由 Kustomize 一起改成這個名稱；值一改，名稱跟著變，Pod template 也跟著變，Pod 就會換新。
- migration Job 叫 `clinic-migrate-v1`，tag 來自 overlay 的 `newTag`。

## 4. 等資料庫、跑 migration、seed

剛套用完的幾秒內：

```bash
kubectl -n clinic get pods
```

```text
NAME                          READY   STATUS              RESTARTS   AGE
clinic-api-5ff8f6894b-5bnfv   0/1     Running             0          8s
clinic-api-5ff8f6894b-6fbvg   0/1     Running             0          8s
clinic-migrate-v1-lqh6j       0/1     Init:0/1            0          8s
postgres-0                    0/1     ContainerCreating   0          8s
redis-6fccffcf8d-sd6wq        1/1     Running             0          8s
```

`clinic-api` 是 `Running` 但 `0/1`：容器在跑，`/ready` 連不上資料庫，readiness 沒通過，Service 不會送流量給它。`Init:0/1` 是 migration Job 的 init container 在等 PostgreSQL。第一次要從 Docker Hub 拉 `postgres:16` 與 `redis:7`，網路慢時這一步要等比較久。

```bash
kubectl -n clinic rollout status statefulset/postgres --timeout=180s
kubectl -n clinic wait --for=condition=complete job/clinic-migrate-v1 --timeout=300s
kubectl -n clinic logs job/clinic-migrate-v1 -c wait-for-postgres
kubectl -n clinic logs job/clinic-migrate-v1 -c migrate
```

```text
partitioned roll out complete: 1 new pods have been updated...
job.batch/clinic-migrate-v1 condition met
postgres:5432 - no response
postgres:5432 - accepting connections
INFO  [alembic.runtime.migration] Running upgrade  -> 0001, 階段 1：四張表與約束
INFO  [alembic.runtime.migration] Running upgrade 0001 -> 0002, 階段 4：登入帳號與角色
INFO  [alembic.runtime.migration] Running upgrade 0002 -> 0003, 階段 5：計數欄位、名額上限的 CHECK、部分唯一索引
```

Job 失敗時，`kubectl wait --for=condition=complete` 會一直等到逾時才結束。等太久就看 `kubectl -n clinic get job`：STATUS 是 `Failed` 的話，用 `kubectl -n clinic describe job clinic-migrate-v1` 看原因。

```bash
kubectl -n clinic rollout status deployment/clinic-api --timeout=180s
kubectl -n clinic get pods,pvc
```

```text
deployment "clinic-api" successfully rolled out
NAME                              READY   STATUS      RESTARTS   AGE
pod/clinic-api-5ff8f6894b-s4l4v   1/1     Running     0          14s
pod/clinic-api-5ff8f6894b-tndmb   1/1     Running     0          14s
pod/clinic-migrate-v1-xvv8l       0/1     Completed   0          14s
pod/postgres-0                    1/1     Running     0          14s
pod/redis-6fccffcf8d-whfdf        1/1     Running     0          14s

NAME                                    STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS   VOLUMEATTRIBUTESCLASS   AGE
persistentvolumeclaim/data-postgres-0   Bound    pvc-c7933197-3192-49eb-becb-bd797e80e1ca   1Gi        RWO            standard       <unset>                 14s
```

PostgreSQL 的資料在 PVC `data-postgres-0`，由 kind 內建的 StorageClass `standard` 建在節點容器裡，刪掉叢集就一起消失。

建立範例資料（和 compose 版一樣用 `python -m clinic.seed`，密碼是本機假值）：

```bash
kubectl -n clinic exec deployment/clinic-api -- env SEED_PASSWORD=local-dev-only python -m clinic.seed
```

```text
帳號：patient1, patient2, desk1, doctor1
林醫師 doctor_id=1，診次日期 2026-11-26
上午診 session_id=1（名額 2）
```

`exec deployment/clinic-api` 會挑其中一個 Pod 執行。再執行一次會印 `已經有使用者，略過 seed。`

正式環境的順序不同：`.gitlab-ci.yml` 的 `deploy_production` 先只套用 Job（`-l app.kubernetes.io/component=migration`），等它完成才套用其餘的物件，新版的 Pod 才不會比 schema 早上線。第 6 節的滾動更新照這個順序做。

## 5. 用 port-forward 打 API

kind 叢集沒有 Ingress controller，用 `kubectl port-forward` 把本機的 port 接到 Service：

```bash
kubectl -n clinic port-forward service/clinic-api 8000:80
```

```text
Forwarding from 127.0.0.1:8000 -> 8000
```

這個終端機保持開著，另開一個終端機執行下面的指令。compose 版還在跑時 8000 已被占用，會出現 `unable to listen on any of the requested ports: [{8000 8000}]`：先 `docker compose down`，或改用 `8080:80`，並把下面的 `BASE` 與 smoke test 的網址換成 8080。

```bash
BASE=http://127.0.0.1:8000
field() { python3 -c "import json,sys; print(json.load(sys.stdin)$1)"; }

curl -s $BASE/healthz      # {"status":"ok"}
curl -s $BASE/ready        # {"status":"ready"}

# 業務介面在 /api 底下；探針打的 /healthz、/ready 與 /metrics 不在（docs/contract.md）
TOKEN=$(curl -s $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"patient1","password":"local-dev-only"}' | field "['access_token']")

DAY=$(python3 -c "from datetime import *; print((datetime.now(timezone(timedelta(hours=8))) + timedelta(days=7)).date())")
curl -s "$BASE/api/sessions?doctor_id=1&date=$DAY" -H "Authorization: Bearer $TOKEN"
```

```text
[{"id":1,"doctor_id":1,"session_date":"2026-11-26","period":"morning","capacity":2,"remaining":2},{"id":2,"doctor_id":1,"session_date":"2026-11-26","period":"afternoon","capacity":30,"remaining":30}]
```

```bash
curl -si -X POST $BASE/api/sessions/1/appointments -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{}'
```

```text
HTTP/1.1 201 Created
location: /api/appointments/1
x-request-id: req-3d7c832c0ca2

{"id":1,"session_id":1,"patient_id":1,"number":1,"status":"booked","created_at":"…"}
```

同一個指令再送一次：

```text
HTTP/1.1 409 Conflict
content-type: application/problem+json

{"type":"https://clinic.example/problems/already-booked","title":"Already booked","status":409,"detail":"病患 1 已掛診次 1"}
```

```bash
curl -s $BASE/api/appointments -H "Authorization: Bearer $TOKEN"
curl -s -X POST $BASE/api/appointments/1/cancel -H "Authorization: Bearer $TOKEN"
```

```text
{"items":[{"id":1,"session_id":1,"patient_id":1,"number":1,"status":"booked",…}],"next_cursor":null}
{"id":1,"session_id":1,"patient_id":1,"number":1,"status":"cancelled",…}
```

櫃台、報到、限流（429）的範例見 [README 的 curl 範例](../README.md#curl-範例)，指令完全相同。把主要流程寫成會檢查狀態碼的腳本：

```bash
SEED_PASSWORD=local-dev-only bash scripts/smoke.sh
```

```text
ok   GET /healthz（200）
ok   GET /ready（200）
ok   沒帶 token 查掛號（401）
ok   patient1 登入（200）
ok   查林醫師 2026-11-26 的診次（200）
ok   查 2026-11-26 全部醫師的診次（不帶 doctor_id）（200）
ok   掛號（Idempotency-Key: smoke-1795141158-6540）（201）
     號碼 2，掛號 id 2
ok   同一個鍵重送：回第一次的結果（201）
ok   不帶鍵再掛一次（409）
ok   讀取自己的掛號（200）
ok   只列已掛號的（200）
ok   取消（200）
ok   報到看板（不需要登入）（200）
ok   GET /metrics（200）
smoke test 通過
```

日誌是每個 Pod 各自的 stdout：

```bash
kubectl -n clinic logs deployment/clinic-api --tail=1            # 只看其中一個 Pod
kubectl -n clinic logs -l app=clinic-api --prefix --tail=1      # 每個 Pod 各一行
```

```text
Found 2 pods, using pod/clinic-api-5ff8f6894b-s4l4v
{"ts": "…", "level": "INFO", "logger": "clinic.access", "msg": "request", "request_id": "req-440475d1a5c3", "method": "POST", "route": "/api/sessions/{id}/appointments", "status": 409, "duration_ms": 5.5}
[pod/clinic-api-5ff8f6894b-s4l4v/api] {… "route": "/api/sessions/{id}/appointments", "status": 409 …}
[pod/clinic-api-5ff8f6894b-tndmb/api] {… "route": "/ready", "status": 200 …}
```

port-forward 指定 Service 時，實際只連到其中一個 Pod，所以剛才的請求都記在同一個 Pod；另一個 Pod 只有 readiness 探針每 5 秒打的 `/ready`。

## 6. 滾動更新到新版本

先在叢集裡放一個每 0.5 秒打一次 `/ready` 的 Pod，整個更新過程都看它的輸出。它走 Service 的名稱 `clinic-api`，和其他服務呼叫這個 API 的路徑相同：

```bash
kubectl -n clinic run uptime-probe --image=curlimages/curl:8.22.0 --restart=Never -- \
  sh -c 'while true; do echo "$(date +%T) $(curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://clinic-api/ready)"; sleep 0.5; done'
kubectl -n clinic logs -f uptime-probe          # 另開一個終端機，保持開著
```

```text
03:07:56 200
03:07:57 200
```

再開一個終端機看 Pod 的變化：`kubectl -n clinic get pods -l app=clinic-api -w`。

port-forward 不能拿來觀察這件事：它綁在一個 Pod 上，那個 Pod 被刪掉時就結束，印出 `error: lost connection to pod`。

建置新版本並載入，再把 overlay 的 tag 改成 `v2`：

```bash
docker build -t clinic-api:v2 .
kind load docker-image clinic-api:v2 --name clinic
# k8s/overlays/kind/kustomization.yaml：newTag: v1 改成 newTag: v2
kubectl diff -k k8s/overlays/kind
```

```text
-        image: clinic-api:v1
+        image: clinic-api:v2
…
+  name: clinic-migrate-v2
```

程式沒改、映像內容和 v1 相同也沒關係：Pod template 裡的 image 字串變了，就會換一次 Pod。反過來，只重建 `v1` 再 `kind load`，template 沒變，`kubectl apply` 回 `unchanged`，Pod 不會換（要 `kubectl rollout restart`）；這和第 10 階段「映像寫固定的 tag」講的 `latest` 是同一個問題。

照正式環境的順序：先只套用 migration Job，等它完成，再套用全部：

```bash
kubectl apply -k k8s/overlays/kind -l app.kubernetes.io/component=migration
kubectl -n clinic wait --for=condition=complete job/clinic-migrate-v2 --timeout=300s
kubectl apply -k k8s/overlays/kind
kubectl -n clinic rollout status deployment/clinic-api --timeout=180s
```

```text
job.batch/clinic-migrate-v2 created
job.batch/clinic-migrate-v2 condition met
…
deployment.apps/clinic-api configured
…
job.batch/clinic-migrate-v2 unchanged
Waiting for deployment "clinic-api" rollout to finish: 1 out of 2 new replicas have been updated...
Waiting for deployment "clinic-api" rollout to finish: 1 old replicas are pending termination...
deployment "clinic-api" successfully rolled out
```

`-l` 只套用有這個 label 的物件，第一個 apply 之後 Deployment 還是 v1。第二個 apply 裡，`secret/…`、`statefulset.apps/postgres`、`poddisruptionbudget.policy/clinic-api` 即使沒有變也可能顯示 `configured`（kubectl 在用戶端比對的方式造成）；`kubectl diff -k k8s/overlays/kind` 沒有輸出，就代表叢集和檔案一致。

`get pods -w` 那個終端機（節錄）：

```text
clinic-api-8bb6f6c-mms5z      0/1     ContainerCreating   0          0s
clinic-api-8bb6f6c-mms5z      0/1     Running             0          1s
clinic-api-8bb6f6c-mms5z      1/1     Running             0          6s
clinic-api-5ff8f6894b-s4l4v   1/1     Terminating         0          65s
clinic-api-8bb6f6c-mq4t5      0/1     Pending             0          0s
clinic-api-5ff8f6894b-s4l4v   0/1     Completed           0          71s
clinic-api-8bb6f6c-mq4t5      1/1     Running             0          6s
clinic-api-5ff8f6894b-tndmb   1/1     Terminating         0          71s
clinic-api-5ff8f6894b-tndmb   0/1     Completed           0          77s
```

- 新 Pod 變成 `1/1`（readiness 通過）之後，才關掉一個舊的：`maxSurge: 1`、`maxUnavailable: 0`。
- 舊 Pod 停在 `1/1 Terminating` 約 6 秒：`preStop` 的 `sleep 5`。刪除 Pod 時，「從 Service 的後端移除」和「通知容器結束」同時開始，前者要一點時間才生效；這 5 秒裡它照常處理請求，之後才收到 SIGTERM。

`uptime-probe` 那個終端機從頭到尾都是 `200`。數一下：

```bash
kubectl -n clinic logs uptime-probe | awk '{print $2}' | sort | uniq -c
```

```text
     57 200
```

```bash
kubectl -n clinic get replicasets -l app=clinic-api
kubectl -n clinic rollout history deployment/clinic-api
```

```text
NAME                    DESIRED   CURRENT   READY   AGE
clinic-api-5ff8f6894b   0         0         0       79s
clinic-api-8bb6f6c      2         2         2       20s

REVISION  CHANGE-CAUSE
1         <none>
2         <none>
```

舊的 ReplicaSet 留著（副本數 0），`kubectl rollout undo` 就是切回它，練習 5 會用到。

## 7. 故意弄壞

每個練習都用一個指令直接改叢集裡的物件，Git 裡的 manifest 不動，然後照 [Kubernetes 排錯](https://u-kinda-should-know.web.app/#/skill/k8s-troubleshooting) 的順序查：`get` → `describe` → `logs` → `events`。修法多半是 `kubectl apply -k k8s/overlays/kind`，把叢集改回 Git 裡寫的狀態；實際工作中錯誤通常就在 manifest 裡，要改檔案、走一次部署。

`uptime-probe` 留著。除了練習 4，舊的 Pod 都繼續服務，它一直是 `200`：壞掉的只有新 Pod，`maxUnavailable: 0` 讓舊的留到新的 ready 為止。

| 練習 | 弄壞什麼 | 會看到的狀態 | 排錯課的小節 |
|---|---|---|---|
| 1 | image tag 打錯 | `ImagePullBackOff` | ImagePullBackOff 與 ErrImagePull |
| 2 | requests 超大 | `Pending` | Pending：排不上節點 |
| 3 | 記憶體 limits 太小 | `OOMKilled`、`CrashLoopBackOff` | OOMKilled |
| 4 | Service 的 selector 打錯 | Pod 全綠，endpoints 是空的 | Running，但 Service 連不到 |
| 5 | readiness 的路徑打錯 | 更新卡住 | Running，但 Service 連不到 |
| 6（加碼） | `JWT_SECRET` 太短 | `CrashLoopBackOff` | CrashLoopBackOff |

### 練習 1：image tag 打錯 → ImagePullBackOff

**怎麼弄壞**

```bash
kubectl -n clinic set image deployment/clinic-api api=clinic-api:2     # tag 少了 v
```

**會看到什麼**

```bash
kubectl -n clinic get pods -l app=clinic-api
kubectl -n clinic rollout status deployment/clinic-api --timeout=20s
```

```text
NAME                         READY   STATUS             RESTARTS   AGE
clinic-api-674778dd8-cnjtn   1/1     Running            0          3m41s
clinic-api-674778dd8-fmdkq   1/1     Running            0          3m35s
clinic-api-9bdbcc489-pbcfp   0/1     ImagePullBackOff   0          30s
Waiting for deployment "clinic-api" rollout to finish: 1 out of 2 new replicas have been updated...
error: timed out waiting for the condition
```

**用哪個指令查**

```bash
kubectl -n clinic describe pod clinic-api-9bdbcc489-pbcfp       # 換成你的 Pod 名稱；看最下面的 Events
```

```text
  Normal   Pulling    14s (x2 over 29s)  kubelet  spec.containers{api}: Pulling image "clinic-api:2"
  Warning  Failed     14s (x2 over 29s)  kubelet  spec.containers{api}: Failed to pull image "clinic-api:2": failed to pull and unpack image "docker.io/library/clinic-api:2": failed to resolve reference "docker.io/library/clinic-api:2": pull access denied, repository does not exist or may require authorization: server message: insufficient_scope: authorization failed
  Warning  Failed     14s (x2 over 29s)  kubelet  spec.containers{api}: Error: ErrImagePull
  Normal   BackOff    29s                kubelet  spec.containers{api}: Back-off pulling image "clinic-api:2"
```

節點上沒有 `clinic-api:2`，kubelet 照 `IfNotPresent` 去拉，名稱沒有 registry 主機，就到 Docker Hub 找 `library/clinic-api`，那裡沒有這個 repository。容器根本沒啟動，`kubectl logs` 沒有東西可看，線索只在 Events（`kubectl -n clinic get events --sort-by=.lastTimestamp` 也看得到）。

**怎麼修**

```bash
kubectl diff -k k8s/overlays/kind          # 看得到 image 那一行被改掉了
kubectl apply -k k8s/overlays/kind         # deployment.apps/clinic-api configured
kubectl -n clinic rollout status deployment/clinic-api
```

拉不到的那個 Pod 被刪除，Deployment 回到原本的 ReplicaSet。

### 練習 2：requests 超大 → Pending

**怎麼弄壞**

```bash
kubectl -n clinic set resources deployment/clinic-api -c api --requests=memory=500Gi
```

```text
error: failed to patch resources update to pod template Deployment.apps "clinic-api" is invalid: spec.template.spec.containers[0].resources.requests: Invalid value: "500Gi": must be less than or equal to memory limit of 512Mi
```

API server 先擋下來了：requests 不能大於 limits。連 limits 一起改：

```bash
kubectl -n clinic set resources deployment/clinic-api -c api --requests=memory=500Gi --limits=memory=500Gi
```

**會看到什麼**

```text
NAME                          READY   STATUS    RESTARTS   AGE
clinic-api-548f8f84b6-pfgg4   0/1     Pending   0          8s
clinic-api-67d4b586f4-cvpsb   1/1     Running   0          107s
clinic-api-67d4b586f4-rmm45   1/1     Running   0          113s
```

**用哪個指令查**

```bash
kubectl -n clinic describe pod clinic-api-548f8f84b6-pfgg4
kubectl describe node clinic-control-plane | sed -n '/Allocated resources:/,/Events:/p'
```

```text
  Warning  FailedScheduling  8s  default-scheduler  0/1 nodes are available: 1 Insufficient memory. preemption: 0/1 nodes are available: 1 Preemption is not helpful for scheduling.

  Resource           Requests     Limits
  --------           --------     ------
  cpu                1300m (32%)  0 (0%)
  memory             1122Mi (6%)  2132Mi (13%)
```

排程看的是 requests 加總，和節點實際用了多少記憶體無關。Pod 沒有排到節點，沒有 log。

**怎麼修**：`kubectl apply -k k8s/overlays/kind`，Pending 的 Pod 被刪除。

### 練習 3：記憶體 limits 太小 → OOMKilled

**怎麼弄壞**

```bash
kubectl -n clinic set resources deployment/clinic-api -c api --requests=memory=32Mi --limits=memory=32Mi
```

**會看到什麼**（約 45 秒後；STATUS 會在 `OOMKilled`、`CrashLoopBackOff` 之間切換）

```text
NAME                          READY   STATUS             RESTARTS     AGE
clinic-api-67d4b586f4-cvpsb   1/1     Running            0            2m41s
clinic-api-67d4b586f4-rmm45   1/1     Running            0            2m47s
clinic-api-b4dcc5d4d-mjvwx    0/1     CrashLoopBackOff   3 (7s ago)   45s
```

**用哪個指令查**

```bash
kubectl -n clinic describe pod clinic-api-b4dcc5d4d-mjvwx
kubectl -n clinic logs clinic-api-b4dcc5d4d-mjvwx --previous
```

```text
    State:          Waiting
      Reason:       CrashLoopBackOff
    Last State:     Terminated
      Reason:       OOMKilled
      Exit Code:    137
    Restart Count:  3
…
  Warning  Unhealthy  8s (x4 over 45s)  kubelet  spec.containers{api}: Readiness probe failed: Get "http://10.244.0.24:8000/ready": dial tcp 10.244.0.24:8000: connect: connection refused
  Warning  BackOff    5s (x9 over 43s)  kubelet  spec.containers{api}: Back-off restarting failed container api in pod …
```

`logs --previous` 是空的：Python 還在 import 套件就超過 32Mi，被核心直接殺掉，程式沒有機會寫任何東西。Exit Code 137 只代表 SIGKILL，要看到 `Reason: OOMKilled` 才能確定是記憶體。

**怎麼修**：`kubectl apply -k k8s/overlays/kind`。實際遇到時先看記憶體曲線，分辨是 limits 本來就不夠還是洩漏（排錯課的 OOMKilled 一節）。

### 練習 4：Service 的 selector 打錯 → endpoints 是空的

**怎麼弄壞**

```bash
kubectl -n clinic patch service clinic-api -p '{"spec":{"selector":{"app":"clinic"}}}'
```

**會看到什麼**：`kubectl -n clinic get pods` 全部 `Running`、`1/1`，看起來沒事；`uptime-probe` 那邊從 `200` 變成 `000`（連不上）：

```text
02:48:54 000
02:48:55 000
```

port-forward 到 Service 會等一分鐘找 Pod，然後放棄：

```bash
kubectl -n clinic port-forward service/clinic-api 8000:80
```

```text
error: timed out waiting for the condition
```

**用哪個指令查**：從 Service 往 Pod 一層一層查

```bash
kubectl -n clinic get endpointslices -l kubernetes.io/service-name=clinic-api
kubectl -n clinic describe service clinic-api | grep -E 'Selector|Endpoints'
kubectl -n clinic get pods -l app=clinic
kubectl -n clinic get pods -l app=clinic-api --show-labels
```

```text
NAME               ADDRESSTYPE   PORTS     ENDPOINTS   AGE
clinic-api-9z7dw   IPv4          <unset>   <unset>     5m53s
Selector:                 app=clinic
Endpoints:
No resources found in clinic namespace.
NAME                          READY   STATUS    RESTARTS   AGE     LABELS
clinic-api-67d4b586f4-cvpsb   1/1     Running   0          2m55s   app=clinic-api,pod-template-hash=67d4b586f4
```

selector `app=clinic` 選不到任何 Pod，API server 不會擋：「現在選不到 Pod 的 Service」是合法的物件。

**怎麼修**：`kubectl apply -k k8s/overlays/kind`（`service/clinic-api configured`），ENDPOINTS 回到兩個 Pod 的 IP，`uptime-probe` 回到 `200`。

### 練習 5：readiness 的路徑打錯 → 更新卡住

**怎麼弄壞**

```bash
kubectl -n clinic patch deployment clinic-api --type=json \
  -p='[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/readyz"}]'
```

**會看到什麼**

```text
NAME                          READY   STATUS    RESTARTS   AGE
clinic-api-565d5c7974-vsvbl   0/1     Running   0          30s
clinic-api-67d4b586f4-cvpsb   1/1     Running   0          4m4s
clinic-api-67d4b586f4-rmm45   1/1     Running   0          4m10s
```

```bash
kubectl -n clinic rollout status deployment/clinic-api --timeout=20s
kubectl -n clinic get deployment clinic-api
```

```text
Waiting for deployment "clinic-api" rollout to finish: 1 out of 2 new replicas have been updated...
error: timed out waiting for the condition
NAME         READY   UP-TO-DATE   AVAILABLE   AGE
clinic-api   2/2     1            2           7m22s
```

新 Pod 一直不 ready，舊的不會被關掉，更新停在這裡。等滿 `progressDeadlineSeconds`（預設 600 秒），Deployment 的 `Progressing` 條件變成 `False`、原因是 `ProgressDeadlineExceeded`，`rollout status` 改成印 `error: deployment "clinic-api" exceeded its progress deadline`，但不會自己回退。

**用哪個指令查**

```bash
kubectl -n clinic describe pod clinic-api-565d5c7974-vsvbl
kubectl -n clinic logs clinic-api-565d5c7974-vsvbl --tail=2
```

```text
  Warning  Unhealthy  3s (x10 over 48s)  kubelet  spec.containers{api}: Readiness probe failed: HTTP probe failed with statuscode: 404
{"ts": "…", "logger": "clinic.access", "msg": "request", "method": "GET", "route": "unmatched", "status": 404, "duration_ms": 0.4}
```

程式自己的日誌也記到探針打了一個不存在的路徑。`kubectl get endpointslices` 的 ENDPOINTS 欄會列出三個 IP，包含沒有 ready 的這個；要看 ready 與否：

```bash
kubectl -n clinic get endpointslices -l kubernetes.io/service-name=clinic-api \
  -o jsonpath='{range .items[*].endpoints[*]}{.addresses[0]}{"  ready="}{.conditions.ready}{"  "}{.targetRef.name}{"\n"}{end}'
```

```text
10.244.0.21  ready=true  clinic-api-67d4b586f4-rmm45
10.244.0.22  ready=true  clinic-api-67d4b586f4-cvpsb
10.244.0.26  ready=false  clinic-api-565d5c7974-vsvbl
```

Service 只把流量送給 `ready=true` 的位址。

**怎麼修**：這次用 `rollout undo` 回到上一個 ReplicaSet

```bash
kubectl -n clinic rollout undo deployment/clinic-api
```

```text
Warning: resource deployments/clinic-api was previously managed with 'kubectl apply'. Rolling back will not update the kubectl.kubernetes.io/last-applied-configuration annotation, which may cause unexpected behavior on future 'kubectl apply' operations. Consider using 'kubectl apply' with your previous configuration file instead.
deployment.apps/clinic-api rolled back
```

警告說的是：`undo` 只改了叢集。這次錯誤是直接改叢集造成的，Git 裡的檔案本來就對，`kubectl diff -k k8s/overlays/kind` 沒有輸出。錯誤如果寫在 manifest 裡，undo 之後還要把檔案改回來，否則下一次 `kubectl apply` 又把它帶回來。

### 練習 6（加碼）：JWT_SECRET 太短 → CrashLoopBackOff

**怎麼弄壞**

```bash
kubectl -n clinic set env deployment/clinic-api JWT_SECRET=too-short
```

**會看到什麼**

```text
clinic-api-f445d4974-vf8h7    0/1     CrashLoopBackOff   2 (24s ago)   40s
```

**用哪個指令查**

```bash
kubectl -n clinic describe pod clinic-api-f445d4974-vf8h7 | sed -n '/^    State:/,/Restart Count/p'
kubectl -n clinic logs clinic-api-f445d4974-vf8h7 --previous | tail -3
```

```text
    State:          Waiting
      Reason:       CrashLoopBackOff
    Last State:     Terminated
      Reason:       Error
      Exit Code:    1
pydantic_core._pydantic_core.ValidationError: 1 validation error for Settings
jwt_secret
  Value should have at least 32 items after validation, not 9 [type=too_short]
```

Exit Code 1、啟動後兩秒就結束：程式在啟動時驗證設定，`JWT_SECRET` 少於 32 個字元就不啟動（README 的「設定」一節）。原因在上一次的 log 裡，所以要加 `--previous`。

**怎麼修**：先試 `kubectl apply -k k8s/overlays/kind`

```text
The Deployment "clinic-api" is invalid: spec.template.spec.containers[0].env[1].valueFrom: Invalid value: "": may not be specified when `value` is not empty
```

`set env` 把 `JWT_SECRET` 從 `valueFrom`（讀 Secret）改成寫死的 `value`。`kubectl apply` 只會移除它上一次自己寫過的欄位，`value` 不是它寫的，所以留著，再加回 `valueFrom`，兩個同時存在就不合法。先 `rollout undo` 回到上一個 ReplicaSet，再 apply：

```bash
kubectl -n clinic rollout undo deployment/clinic-api
kubectl apply -k k8s/overlays/kind          # deployment.apps/clinic-api unchanged
```

直接改叢集（`set env`、`edit`、`patch`）和 `kubectl apply` 混用，就會遇到這種情況；這也是 GitOps 要求「改 Git，不改叢集」的原因之一（見 [Helm、Kustomize 與 GitOps](https://u-kinda-should-know.web.app/#/skill/k8s-helm-gitops)）。

練習做完，刪掉觀察用的 Pod：`kubectl -n clinic delete pod uptime-probe`。

## 8. 選讀：接上 Gateway API

社群維護的 ingress-nginx 已在 2026 年 3 月停止維護（[Kubernetes 官方公告](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/)），這份指南不用它。這一段改用 Gateway API，實作選 [Envoy Gateway](https://gateway.envoyproxy.io/) v1.10.0：它的相容表列出 v1.10 支援 Kubernetes v1.34 到 v1.37，下面的步驟在本指南的 kind 叢集上實際跑過。Gateway 與 HTTPRoute 的概念見 [把服務寫成 manifest](https://u-kinda-should-know.web.app/#/skill/k8s-manifests) 的 Ingress 一節。

安裝（含 Gateway API 的 CRD；指令照 Envoy Gateway 的官方安裝說明）：

```bash
kubectl apply --server-side -f https://github.com/envoyproxy/gateway/releases/download/v1.10.0/install.yaml
kubectl wait --timeout=5m -n envoy-gateway-system deployment/envoy-gateway --for=condition=Available
```

```text
…
mutatingwebhookconfiguration.admissionregistration.k8s.io/envoy-gateway-topology-injector.envoy-gateway-system serverside-applied
deployment.apps/envoy-gateway condition met
```

套用 `k8s/gateway-api/`：`gateway.yaml` 是平台團隊管的部分（GatewayClass、Gateway），`httproute.yaml` 是服務團隊管的部分，對應 `overlays/production/ingress.yaml` 的規則：

```bash
kubectl apply -f k8s/gateway-api/
kubectl -n clinic get gateway,httproute
```

```text
gatewayclass.gateway.networking.k8s.io/envoy created
gateway.gateway.networking.k8s.io/clinic-gateway created
httproute.gateway.networking.k8s.io/clinic-api created
NAME                                               CLASS   ADDRESS   PROGRAMMED   AGE
gateway.gateway.networking.k8s.io/clinic-gateway   envoy             False        30s

NAME                                             HOSTNAMES            AGE
httproute.gateway.networking.k8s.io/clinic-api   ["clinic.example"]   30s
```

`PROGRAMMED` 是 `False`：

```bash
kubectl -n clinic get gateway clinic-gateway -o jsonpath='{range .status.conditions[*]}{.type}={.status} {.reason}{"\n"}{end}'
```

```text
Accepted=True Accepted
Programmed=False AddressNotAssigned
```

Envoy Gateway 替這個 Gateway 建了一組 Envoy 的 Pod 與一個 `LoadBalancer` 型別的 Service，kind 沒有 LoadBalancer 的實作，Service 拿不到外部位址（`EXTERNAL-IP` 是 `<pending>`）。Envoy 照常在跑，用 port-forward 連它的 Service 就能測（Envoy Gateway 的 quickstart 建議裝 MetalLB 這類實作來取得位址，本指南沒有試）：

```bash
ENVOY_SERVICE=$(kubectl get svc -n envoy-gateway-system \
  --selector=gateway.envoyproxy.io/owning-gateway-namespace=clinic,gateway.envoyproxy.io/owning-gateway-name=clinic-gateway \
  -o jsonpath='{.items[0].metadata.name}')
kubectl -n envoy-gateway-system port-forward service/$ENVOY_SERVICE 8888:80
```

另一個終端機：

```bash
curl -si -H 'Host: clinic.example' http://127.0.0.1:8888/healthz
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8888/healthz     # 沒帶 Host
```

```text
HTTP/1.1 200 OK
server: uvicorn
content-type: application/json
x-request-id: 3309a2fd-3c22-4844-b621-632b5f4048de

{"status":"ok"}
404
```

`Host` 對不到 HTTPRoute 的 `hostnames` 時，Envoy 自己回 404，請求沒有到 clinic-api。和 Ingress 的對應：

| Ingress | Gateway API |
|---|---|
| `ingressClassName` | Gateway 的 `gatewayClassName`，GatewayClass 指到實作（`controllerName`） |
| `tls`、監聽的 port | Gateway 的 `listeners` |
| `rules[].host` | HTTPRoute 的 `hostnames` |
| `paths[].backend.service` | HTTPRoute 的 `backendRefs`（Service 的名稱與 port） |

Service 以後的接線（selector、targetPort、readiness）都不變。正式環境的 Gateway 通常由叢集管理者建在另一個 namespace，HTTPRoute 用 `parentRefs` 指過去，Gateway 的 `allowedRoutes` 要允許 `clinic` 這個 namespace。

## 9. 選讀：多個 worker 的叢集（drain 與 PodDisruptionBudget）

前面的叢集只有一個節點，練不到節點維護。`k8s/kind-config-workers.yaml` 是一個 control plane 加兩個 worker；先刪掉原本的叢集再重建：

```bash
bash scripts/kind-down.sh
KIND_CONFIG=k8s/kind-config-workers.yaml bash scripts/kind-up.sh
kubectl get nodes
kubectl -n clinic get pods -o wide
```

```text
NAME                   STATUS   ROLES           AGE   VERSION
clinic-control-plane   Ready    control-plane   61s   v1.37.0
clinic-worker          Ready    <none>          46s   v1.37.0
clinic-worker2         Ready    <none>          46s   v1.37.0

NAME                          READY   STATUS      RESTARTS   AGE   IP           NODE
clinic-api-5ff8f6894b-n96ts   1/1     Running     0          29s   10.244.2.2   clinic-worker
clinic-api-5ff8f6894b-xtv2k   1/1     Running     0          29s   10.244.1.2   clinic-worker2
clinic-migrate-v1-569qn       0/1     Completed   0          29s   10.244.2.4   clinic-worker
postgres-0                    1/1     Running     0          29s   10.244.1.4   clinic-worker2
redis-6fccffcf8d-6v2j4        1/1     Running     0          29s   10.244.2.3   clinic-worker
```

有 worker 時，kind 的 control plane 帶 `node-role.kubernetes.io/control-plane:NoSchedule` 的 taint，Pod 只排到兩個 worker。Pod 落在哪個 worker 每次不同，下面以 `postgres-0` 在 `clinic-worker2` 為例。

觀察用的 Pod 固定放在 `postgres-0` 那個節點（沒有 controller 的 Pod 會讓 drain 拒絕執行：`cannot delete Pods that declare no controller (use --force to override)`）：

```bash
kubectl -n clinic run uptime-probe --image=curlimages/curl:8.22.0 --restart=Never \
  --overrides='{"spec":{"nodeSelector":{"kubernetes.io/hostname":"clinic-worker2"}}}' -- \
  sh -c 'while true; do echo "$(date +%T) $(curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://clinic-api/ready)"; sleep 0.5; done'
```

**兩個副本，drain 沒有資料庫的那個 worker**：

```bash
kubectl drain clinic-worker --ignore-daemonsets --delete-emptydir-data
```

```text
node/clinic-worker cordoned
Warning: ignoring DaemonSet-managed Pods: kube-system/kindnet-2s8rh, kube-system/kube-proxy-7ntww
evicting pod clinic/redis-6fccffcf8d-6v2j4
evicting pod clinic/clinic-api-5ff8f6894b-n96ts
evicting pod clinic/clinic-migrate-v1-569qn
pod/clinic-migrate-v1-569qn evicted
pod/redis-6fccffcf8d-6v2j4 evicted
pod/clinic-api-5ff8f6894b-n96ts evicted
node/clinic-worker drained
```

被驅逐的 `clinic-api` 由 Deployment 在 `clinic-worker2` 補一個，`uptime-probe` 一直是 `200`。做完把節點加回來：`kubectl uncordon clinic-worker`。

**一個副本，PodDisruptionBudget 擋住 drain**：

```bash
kubectl -n clinic scale deployment/clinic-api --replicas=1
kubectl -n clinic get pdb          # 等 ALLOWED DISRUPTIONS 變成 0，舊的 Pod 也結束了再往下
kubectl -n clinic get pods -l app=clinic-api -o wide
kubectl drain clinic-worker2 --ignore-daemonsets --delete-emptydir-data --pod-selector=app=clinic-api --timeout=30s
```

```text
NAME         MIN AVAILABLE   MAX UNAVAILABLE   ALLOWED DISRUPTIONS   AGE
clinic-api   1               N/A               0                     2m33s
node/clinic-worker2 cordoned
evicting pod clinic/clinic-api-5ff8f6894b-xtv2k
error when evicting pods/"clinic-api-5ff8f6894b-xtv2k" -n "clinic" (will retry after 5s): Cannot evict pod as it would violate the pod's disruption budget.
…
error: unable to drain node "clinic-worker2" due to error: error when evicting pods/"clinic-api-5ff8f6894b-xtv2k" -n "clinic": global timeout reached: 30s, continuing command...
```

drain 換成剩下那個 Pod 所在的節點。`--pod-selector` 只驅逐 `clinic-api` 的 Pod，原因見下一段。`minAvailable: 1` 加上一個副本，允許的中斷是 0，drain 會一直重試；`--timeout` 讓它放棄，節點停在 `SchedulingDisabled`。復原：

```bash
kubectl uncordon clinic-worker2
kubectl -n clinic scale deployment/clinic-api --replicas=2
```

**drain 有資料庫的那個 worker**：

```bash
kubectl -n clinic delete pod uptime-probe          # 沒有 controller 的 Pod 會擋住 drain
kubectl drain clinic-worker2 --ignore-daemonsets --delete-emptydir-data
kubectl -n clinic get pods -o wide
kubectl -n clinic describe pod postgres-0 | grep FailedScheduling
kubectl -n clinic get deployment clinic-api
```

```text
pod/postgres-0 evicted
pod/clinic-api-5ff8f6894b-xtv2k evicted
node/clinic-worker2 drained
NAME                          READY   STATUS    RESTARTS   AGE   IP           NODE
clinic-api-5ff8f6894b-6flkg   0/1     Running   0          …     …            clinic-worker
clinic-api-5ff8f6894b-mt6p8   0/1     Running   0          …     …            clinic-worker
postgres-0                    0/1     Pending   0          …     <none>       <none>
redis-6fccffcf8d-xhw95        1/1     Running   0          …     …            clinic-worker
  Warning  FailedScheduling  21s (x2 over 21s)  default-scheduler  0/3 nodes are available: 1 node(s) didn't match PersistentVolume's node affinity, 1 node(s) had untolerated taint(s), 1 node(s) were unschedulable. preemption: 0/3 nodes are available: 3 Preemption is not helpful for scheduling.
NAME         READY   UP-TO-DATE   AVAILABLE   AGE
clinic-api   0/2     2            0           4m17s
```

kind 的 StorageClass 把資料建在某一個節點的磁碟上，PV 綁著那個節點；那個節點不能排程時，`postgres-0` 哪裡都去不了。資料庫一停，兩個 `clinic-api` 的 `/ready` 都回 503，整個服務停擺，`clinic-api` 的 PodDisruptionBudget 管不到這件事。`kubectl uncordon clinic-worker2` 之後 `postgres-0` 回到原節點，服務恢復。這是「資料庫先留在叢集外」的理由之一（[導入 Kubernetes 前要準備什麼](https://u-kinda-should-know.web.app/#/skill/k8s-readiness)）。

## 用腳本一次做完

`scripts/kind-up.sh` 依序做第 1 到第 4 節（建叢集 → 建置映像並 `kind load` → `kubectl apply -k` → 等 PostgreSQL 與 Redis → 等 migration Job → `rollout status` → seed），每一步先印出指令（`+` 開頭）再執行：

```bash
bash scripts/kind-up.sh
```

```text
==> 1/7 叢集 clinic
+ kind create cluster --name clinic --config k8s/kind-config.yaml --wait 120s
…
==> 4/7 套用 k8s/overlays/kind
+ kubectl apply -k k8s/overlays/kind
…
==> 6/7 等 migration Job clinic-migrate-v1 完成
job.batch/clinic-migrate-v1 完成
==> 7/7 等 clinic-api 滾動更新完成，然後 seed
deployment "clinic-api" successfully rolled out
帳號：patient1, patient2, desk1, doctor1
…
完成。目前的 Pod：
…
```

- 可以重複執行：叢集已經存在就沿用；同一個 tag 的 Job 已經完成就不重跑，上次失敗就刪掉重建；seed 發現已經有使用者就略過。
- 映像的名稱與 tag 讀自 `k8s/overlays/kind/kustomization.yaml` 的 `newName`、`newTag`。改了 `newTag` 再執行一次，就是第 6 節的滾動更新（Job 與 Deployment 一起套用，沒有分兩段）。
- 環境變數：`KIND_CLUSTER`（叢集名稱，預設 `clinic`）、`KIND_CONFIG`（kind 設定檔）、`SEED_PASSWORD`（預設 `local-dev-only`）、`SKIP_BUILD=1`（不 `docker build`，直接載入本機已有的映像）。
- kubectl 一律帶 `--context kind-clinic`，目前的 context 是別的叢集也不會套用錯地方。

GitHub Actions 的 `kind-deploy` job（repo 根目錄的 `.github/workflows/companion.yml`）每次 push 都跑這個腳本，接著用 port-forward 跑 `scripts/smoke.sh`，把 tag 改成 `v2` 再跑一次腳本做滾動更新（期間 `uptime-probe` 不能出現 200 以外的狀態碼），並用 `kubectl apply --dry-run=server` 檢查 `overlays/production` 產生的 manifest。

## 清除

```bash
bash scripts/kind-down.sh                          # 等於 kind delete cluster --name clinic；叢集不存在時什麼都不做
docker image rm clinic-api:v1 clinic-api:v2
git restore k8s/overlays/kind/kustomization.yaml   # 第 6 節改過 newTag 的話
```

```text
+ kind delete cluster --name clinic
Deleting cluster "clinic" ...
Deleted nodes: ["clinic-control-plane"]
```

PostgreSQL 的資料、選讀的 Envoy Gateway 都在叢集裡，一起刪除。

## 常見問題

| 現象 | 原因 | 處理 |
|---|---|---|
| `kind create cluster` 先印 `cgroup v1 is deprecated in Kubernetes…`，接著在 `Starting control-plane` 失敗，錯誤裡有 `could not bootstrap the admin user` | 主機是 cgroup v1，kubelet 拒絕啟動。加 `--retain` 保留節點，`docker exec clinic-control-plane journalctl -u kubelet` 看得到 `kubelet is configured to not run on a host using cgroup v1` | 換到 cgroup v2 的主機（`docker info --format '{{.CgroupVersion}}'` 要是 `2`） |
| `postgres-0`、`redis-…` 停在 `ErrImagePull` 或 `ImagePullBackOff`，訊息有 `i/o timeout`、`no such host`、`x509: certificate signed by unknown authority` 或 `proxyconnect` | 節點連不到 Docker Hub。拉映像的是節點裡的 containerd，不是主機的 Docker；公司網路的 proxy 會攔截 TLS 時，節點不信任它的憑證 | proxy 的環境變數要在 `kind create cluster` 之前設好，kind 建節點時會帶進去。或在主機拉好再載入：`docker pull postgres:16`、`docker save --platform linux/amd64 postgres:16 -o postgres.tar`、`kind load image-archive postgres.tar --name clinic`（`redis:7` 同樣做；Apple 晶片用 `linux/arm64`） |
| `kind load docker-image postgres:16` 失敗，訊息有 `ctr: content digest sha256:…: not found` | 從 Docker Hub 拉的是多平台映像，Docker 用 containerd 映像庫時只下載了本機平台的部分 | 改用上一列的 `docker save --platform` 加 `kind load image-archive`；自己建置的 `clinic-api` 不受影響 |
| `kubectl -n clinic get job` 顯示 `Failed`，`describe job` 的原因是 `DeadlineExceeded` | Job 的 `activeDeadlineSeconds` 是 300 秒，資料庫的映像拉太久，init container 等到逾時 | `kubectl -n clinic delete job clinic-migrate-v1`，再 `kubectl apply -k k8s/overlays/kind`（`kind-up.sh` 會自動做） |
| `kind load` 回 `ERROR: image: "clinic-api:v1" not present locally` | 主機的 Docker 裡沒有這個映像，或 tag 和 overlay 的 `newTag` 不同 | `docker images clinic-api` 確認，重新 `docker build -t clinic-api:<tag> .` |
| `unable to listen on any of the requested ports: [{8000 8000}]` | 8000 被占用，常見的是 compose 版還在跑 | `docker compose down`，或改用 `port-forward service/clinic-api 8080:80` |
| port-forward 印出 `error: lost connection to pod` 後結束 | 它連的那個 Pod 被刪掉了（滾動更新、練習的修復） | 重新執行 port-forward |
| 沒改任何東西，`kubectl apply` 還是顯示幾個 `configured` | kubectl 在用戶端比對的方式造成，例如 secretGenerator 產生的長 base64 會換行 | `kubectl diff -k k8s/overlays/kind` 沒有輸出就代表一致 |
| 指令跑到別的叢集 | 目前的 context 不是 `kind-clinic` | `kubectl config use-context kind-clinic` |

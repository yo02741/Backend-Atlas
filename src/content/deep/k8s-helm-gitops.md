## 從一個具體問題開始：三個環境、三份複製貼上的 YAML

`booking-api` 要部署到 dev、staging、production。最直接的做法是把 `k8s/` 目錄複製三份，各自改幾個值：副本數、image tag、資源、網域、log 等級。

三個月後，三個目錄之間的差異有四十幾行。其中哪些是刻意的（production 副本數比較多），哪些是某次修問題時只改了一邊、忘了同步（production 有 `preStop`，staging 沒有），已經沒有人說得清楚。staging 驗證通過的東西，和實際部署到 production 的不是同一份。

還有另一個問題：這些 YAML 是誰、用什麼方式套用到叢集的？有人從自己的電腦 `kubectl apply`，有人直接 `kubectl edit` 改線上的物件。叢集裡實際跑的，和 Git 裡寫的，也不保證一樣。

這一課處理這兩件事：

- 同一份 manifest 上多個環境：共同的部分只寫一次，差異明確列出來。兩種做法是 Kustomize（補丁）與 Helm（樣板）。
- 誰把它套用到叢集：CI 推進去（push），或叢集自己從 Git 拉（GitOps）。

manifest 本身的寫法見 [Kubernetes 實作：把服務寫成 manifest](#/skill/k8s-manifests) 與 [Kubernetes 實作：設定、探針與資源](#/skill/k8s-config-probes)。

## Kustomize：base 加 overlay

Kustomize 的做法是：base 放一份完整、合法的 manifest，每個環境一個 overlay，只寫「和 base 不一樣的地方」。

```text
k8s/
├── base/
│   ├── kustomization.yaml
│   ├── deployment.yaml
│   ├── service.yaml
│   └── ingress.yaml
└── overlays/
    ├── staging/
    │   ├── kustomization.yaml
    │   └── patch-resources.yaml
    └── production/
        ├── kustomization.yaml
        └── patch-resources.yaml
```

```yaml
# base/kustomization.yaml：列出這個 base 包含哪些檔案
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
  - service.yaml
  - ingress.yaml
```

```yaml
# overlays/production/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: booking-prod              # 所有物件都放進這個 namespace
resources:
  - ../../base                       # 以 base 為基礎
images:
  - name: registry.example.org/booking/api
    newTag: 3f9c2a1b                 # 只換 tag，不用為此寫 patch
replicas:
  - name: booking-api
    count: 6
patches:
  - path: patch-resources.yaml       # 其他差異寫成補丁
configMapGenerator:
  - name: booking-config
    literals:
      - LOG_LEVEL=INFO
```

```yaml
# overlays/production/patch-resources.yaml：只寫要改的欄位，加上足以找到目標的 kind 與 name
apiVersion: apps/v1
kind: Deployment
metadata:
  name: booking-api
spec:
  template:
    spec:
      containers:
        - name: api                  # 依 name 找到 base 裡的同一個容器
          resources:
            requests: { cpu: "500m", memory: "512Mi" }
            limits: { memory: "1Gi" }
```

```bash
kubectl kustomize overlays/production     # 只輸出合併後的 YAML，不套用
kubectl diff -k overlays/production       # 和叢集裡的現況比較
kubectl apply -k overlays/production      # 合併後套用
```

Kustomize 內建在 kubectl（`-k` 參數與 `kubectl kustomize`），不用另外安裝。kubectl 內建的版本通常比獨立發行的 `kustomize` 指令舊，用到較新的欄位時要注意兩邊的版本。

### 補丁怎麼合併

上面那種補丁叫 strategic merge patch，規則是：

- 對應（map）逐層合併：補丁裡有的鍵蓋過 base，沒提到的鍵保留。
- 純量（字串、數字）直接取代。
- 清單看型別：Kubernetes 內建的型別知道某些清單該用哪個欄位當鍵，例如 `containers` 依 `name` 合併，所以補丁只寫 `name: api` 加上要改的欄位，不會把 image 與其他設定洗掉。沒有這種資訊的清單（包含多數自訂資源的清單）是**整個取代**。
- 值寫 `null` 代表刪除那個欄位。

下面用 dict 模擬這個合併，印出 staging 與 production 的差異：

```python run
import copy

def named(xs):
    return isinstance(xs, list) and len(xs) > 0 and all(isinstance(x, dict) and "name" in x for x in xs)

def merge(base, patch):
    # 簡化版的 strategic merge：dict 逐層合併；元素都有 name 的清單依 name 合併；None 代表刪除；其餘取代
    if isinstance(base, dict) and isinstance(patch, dict):
        out = copy.deepcopy(base)
        for key, value in patch.items():
            if value is None:
                out.pop(key, None)
            elif key in out:
                out[key] = merge(out[key], value)
            else:
                out[key] = copy.deepcopy(value)
        return out
    if named(base) and named(patch):
        out = copy.deepcopy(base)
        index = {item["name"]: i for i, item in enumerate(out)}
        for item in patch:
            if item["name"] in index:
                out[index[item["name"]]] = merge(out[index[item["name"]]], item)
            else:
                out.append(copy.deepcopy(item))
        return out
    return copy.deepcopy(patch)

base = {
    "kind": "Deployment",
    "metadata": {"name": "booking-api"},
    "spec": {
        "replicas": 2,
        "template": {"spec": {
            "terminationGracePeriodSeconds": 45,
            "containers": [{
                "name": "api",
                "image": "registry.example.org/booking/api:dev",
                "env": [{"name": "LOG_LEVEL", "value": "DEBUG"}, {"name": "DB_HOST", "value": "booking-db"}],
                "resources": {"requests": {"cpu": "250m", "memory": "256Mi"},
                              "limits": {"cpu": "500m", "memory": "512Mi"}},
            }],
        }},
    },
}

overlays = {
    "staging": {
        "metadata": {"namespace": "booking-staging"},
        "spec": {"template": {"spec": {"containers": [
            {"name": "api", "image": "registry.example.org/booking/api:3f9c2a1b"},
        ]}}},
    },
    "production": {
        "metadata": {"namespace": "booking-prod"},
        "spec": {
            "replicas": 6,
            "template": {"spec": {"containers": [{
                "name": "api",
                "image": "registry.example.org/booking/api:3f9c2a1b",
                "env": [{"name": "LOG_LEVEL", "value": "INFO"}],
                "resources": {"requests": {"cpu": "500m", "memory": "512Mi"},
                              "limits": {"cpu": None, "memory": "1Gi"}},     # None：拿掉 CPU limit
            }]}},
        },
    },
}

def flatten(obj, prefix=""):
    # 攤平成「路徑 → 值」，方便比較；有 name 的清單用 name 當路徑的一段
    if isinstance(obj, dict):
        items = [(f"{prefix}.{k}" if prefix else k, v) for k, v in obj.items()]
    elif named(obj):
        items = [(f"{prefix}[{x['name']}]", {k: v for k, v in x.items() if k != "name"}) for x in obj]
    else:
        return {prefix: obj}
    out = {}
    for path, value in items:
        out.update(flatten(value, path))
    return out

result = {env: flatten(merge(base, patch)) for env, patch in overlays.items()}
paths = sorted(set(result["staging"]) | set(result["production"]))
same = [p for p in paths if result["staging"].get(p) == result["production"].get(p)]
print(f"兩個環境相同的欄位：{len(same)} 個（全部來自 base 或兩邊相同的補丁）")
print("不同的欄位：")
for p in paths:
    s, q = result["staging"].get(p, "（沒有）"), result["production"].get(p, "（沒有）")
    if s != q:
        print(f"  {p}\n      staging    = {s}\n      production = {q}")
print("base 沒有被改動：", base["spec"]["replicas"] == 2 and "namespace" not in base["metadata"])
```

輸出裡「不同的欄位」就是兩個環境之間全部的差異，而且每一條都寫在 overlay 裡。`DB_HOST`、`terminationGracePeriodSeconds` 這些沒有出現在任何補丁裡的欄位，兩邊保證相同。

補丁要精確指定某一個位置時（例如 Ingress 的第一條規則的 host），用 JSON patch 的寫法：

```yaml
patches:
  - target:
      kind: Ingress
      name: booking-api
    patch: |-
      - op: replace
        path: /spec/rules/0/host
        value: api.booking.example.org
```

`configMapGenerator` 產生的 ConfigMap，名稱後面會帶內容的雜湊（例如 `booking-config-7g2k9m4h5t`），Deployment 裡的參照會自動改成同一個名稱。內容一變，名稱就變，Deployment 的 template 跟著變，自動觸發滾動更新，解決「改了 ConfigMap，Pod 沒有重啟」的問題。

## Helm：樣板加 values

Helm 走另一條路：manifest 寫成樣板，會變的地方挖洞，值放在 values 檔。一包樣板叫 **chart**，安裝到叢集後的一個實例叫 **release**，每次升級產生一個 **revision**。

```text
booking-api/
├── Chart.yaml            # chart 的名稱與版本
├── values.yaml           # 預設值
└── templates/            # 樣板：render 之後才是 manifest
    ├── deployment.yaml
    ├── service.yaml
    └── ingress.yaml
```

```yaml
# Chart.yaml
apiVersion: v2
name: booking-api
description: 報到系統 API
version: 0.3.0                # chart 本身的版本
appVersion: "3f9c2a1b"        # 應用程式的版本，說明用
```

```yaml
# values.yaml：預設值
replicaCount: 2
image:
  repository: registry.example.org/booking/api
  tag: dev
ingress:
  host: api.staging.booking.example.org
```

```yaml
# templates/deployment.yaml（節錄）
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .Release.Name }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      app: {{ .Release.Name }}
  template:
    metadata:
      labels:
        app: {{ .Release.Name }}
    spec:
      containers:
        - name: api
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
```

`{{ .Values.replicaCount }}` 取 values 裡的值，`{{ .Release.Name }}` 是安裝時給的 release 名稱。樣板語法還有條件、迴圈與函式，這裡只示範取值。

```bash
helm lint ./booking-api                                        # 檢查 chart 的結構
helm template booking-api ./booking-api -f values-production.yaml   # 只 render 出 YAML，不碰叢集

# 沒裝過就安裝，裝過就升級
helm upgrade --install booking-api ./booking-api \
  -n booking-prod -f values-production.yaml --set image.tag=3f9c2a1b

helm history booking-api -n booking-prod                       # 這個 release 的每一個 revision
helm rollback booking-api 3 -n booking-prod                    # 回到 revision 3
```

值的優先順序由低到高：chart 的 `values.yaml`、`-f` 指定的檔案（寫在後面的蓋過前面的）、`--set`。每個環境一個 values 檔，相當於 Kustomize 的 overlay。

幾個行為：

- 樣板處理的是**文字**，不理解 YAML 結構。縮排錯誤要 render 之後才會出現，所以改樣板後先跑 `helm template` 看結果。
- release 的紀錄存在叢集裡（預設是 release 所在 namespace 的 Secret），`helm history` 與 `helm rollback` 靠它運作。
- `helm rollback` 回復的是 manifest，不包含資料庫的 schema 變更，和 `kubectl rollout undo` 一樣（見 [部署策略與資料庫遷移](#/skill/cd-strategies)）。
- 本課的指令以 Helm 3 之後的版本為準（Helm 2 需要在叢集內安裝額外的服務端元件，已停止維護）；不同主版本之間旗標的細節以官方文件為準。

### 兩者怎麼選

| | Kustomize | Helm |
|---|---|---|
| 做法 | 合法的 YAML 加補丁 | 文字樣板加參數 |
| 安裝 | kubectl 內建 | 另外安裝 `helm` |
| 原始檔 | base 本身就能直接套用、直接閱讀 | 樣板不是合法的 YAML，要 render 才看得到結果 |
| 環境差異變多時 | 補丁變多，最終結果要 build 才看得出來 | values 集中在一個檔案，但樣板裡的條件判斷越來越多 |
| 版本與回退 | 沒有 release 的概念，靠 Git 與 `kubectl rollout` | 有 release 歷史與 `helm rollback` |
| 交給別人安裝 | 不是設計目的 | 設計目的：打包、版本號、相依的 chart |

常見的分工：**自己團隊的服務**、環境之間差異不多，用 Kustomize 就夠，少學一套樣板語法；**別人發行的軟體**（cert-manager、Ingress controller、監控元件）通常以 Helm chart 提供，就用 Helm 安裝；要給很多團隊共用、參數很多的內部範本，Helm 比較合適。兩者可以並存。不論用哪一種，都在 CI 裡先 render 出最終的 YAML 並檢查，不要到套用時才知道結果。

## GitOps：Git 是唯一的期望狀態

manifest 有了，接著是「誰把它套用到叢集」。兩種模式：

```text
push 式
  git push ─► CI：測試、build、推映像 ─► CI：kubectl apply ─────────► 叢集
                                         （CI 持有叢集的憑證）

pull 式（GitOps）
  git push ─► CI：測試、build、推映像 ─► CI：把新的 image tag commit 進設定 repo
                                                        │
              叢集內的控制器 ◄──── 定期拉取設定 repo ───┘
                    │  比對「Git 裡寫的」與「叢集裡實際的」，不一樣就同步
                    ▼
                  叢集                    （憑證留在叢集內，CI 碰不到叢集）
```

GitOps 的四個原則：

1. **宣告式**：系統的期望狀態寫成宣告（manifest），不是一串指令。
2. **有版本、不可變**：期望狀態存在 Git，每次變更都是一個 commit，有作者、時間與審查紀錄。
3. **自動拉取**：叢集內的控制器自己去拉，不是外部把變更推進來。
4. **持續調和**：控制器不斷比對期望狀態與實際狀態，有差異（drift）就修正。

第四點是和 push 式最大的差別。有人用 `kubectl edit` 把 production 的副本數改掉，push 式沒有人會知道，直到下一次部署把它蓋回去；GitOps 的控制器會發現實際狀態和 Git 不一樣，依設定自動改回來，或標示成「不同步」讓人處理。相對地，要改線上的東西就得改 Git：回退是 `git revert`，緊急修復也要走 commit。

兩個主要的工具，都是 CNCF 的畢業專案，也都看得懂 Kustomize 與 Helm：

- **Argo CD**：有網頁介面，用 `Application` 物件描述「哪個 repo 的哪個路徑，同步到哪個叢集的哪個 namespace」，可以直接看到每個應用程式的同步狀態與健康狀態。
- **Flux**：一組各司其職的控制器與自訂資源（來源、Kustomize、Helm 各一個），沒有內建的網頁介面，以指令列與 YAML 操作為主。

### push 與 pull 的取捨

| | push 式（CI 直接 `kubectl apply`） | pull 式（GitOps） |
|---|---|---|
| 叢集的憑證 | 放在 CI 的變數裡；CI 被入侵，叢集也跟著暴露 | 留在叢集內；CI 只需要寫 Git 的權限 |
| 叢集的 API | 要讓 CI 的 runner 連得到 | 不必對 CI 開放，叢集主動往外拉 |
| 實際狀態偏離 Git | 不會被發現 | 持續比對，被修正或被標示 |
| 回退 | 重跑舊的 pipeline，或 `rollout undo` | `git revert` |
| 部署成敗的回饋 | pipeline 直接看到 | CI 做完 commit 就結束；成敗要看控制器的狀態或另外接通知 |
| 多出來的維運 | 沒有 | 控制器本身、設定 repo、它們的權限 |

一兩個叢集、團隊不大時，在 [GitLab CI/CD 實戰](#/skill/gitlab-cicd) 的部署 job 裡跑 `kubectl apply -k` 加上 `kubectl rollout status`，簡單而且夠用，但憑證要設成 protected、masked，並只給部署需要的權限。叢集與團隊變多、或需要回答「production 現在的狀態是誰在什麼時候核准的」這類稽核問題時（見 [受監管環境的變更管理](#/skill/change-management)），GitOps 的好處才會大於它多出來的維運成本。

採用 GitOps 時常見的安排：

- 應用程式的原始碼與部署設定分成兩個 repo。CI 在應用程式 repo 裡 build 出映像後，對設定 repo 開一個只改 image tag 的 commit 或合併請求。
- 環境用**目錄**（`overlays/staging`、`overlays/production`）區分，不用長期存在的分支；分支之間的差異很難一眼看完。
- production 的變更走合併請求與審查，staging 可以自動合併。

## IaC：叢集以外的基礎設施

Kubernetes 的 manifest 只描述叢集**裡面**的東西。叢集本身、網路、資料庫、物件儲存、DNS 記錄、雲端的權限，同樣不該靠手動在主控台點出來。把這些寫成程式並納入版本控制，叫 IaC（Infrastructure as Code），最常見的工具是 Terraform（另有相容的開源分支 OpenTofu）。

```bash
terraform init      # 下載 provider，設定 state 存放的位置
terraform plan      # 比對「設定檔」「state」與「實際的資源」，列出將新增、修改、刪除什麼
terraform apply     # 執行 plan 列出的變更，並更新 state
```

三個概念：

- **plan 與 apply 分開**：plan 只列出差異，不動任何東西；審查的對象是 plan 的輸出。這和 `kubectl diff` 之後才 `apply` 是同一個想法。
- **state**：Terraform 用一個 state 檔記錄「設定裡的每個資源對應到實際的哪一個」。state 可能含有機密，不進 Git；多人協作時放在有鎖定機制的遠端儲存，避免兩個人同時 apply。
- **drift**：有人在主控台手動改了資源，下一次 plan 會把差異列出來。Terraform 只在執行時比對，不像 GitOps 的控制器持續調和。

分工通常是：

| 層 | 例子 | 用什麼管 |
|---|---|---|
| 叢集以外的基礎設施 | 網路、叢集與節點群組、資料庫、物件儲存、DNS、雲端權限 | Terraform 這類 IaC 工具 |
| 叢集內的平台元件 | Ingress controller、cert-manager、監控 | Helm chart，由 GitOps 控制器或 CI 套用 |
| 應用程式 | Deployment、Service、Ingress、HPA | Kustomize 或 Helm，由 GitOps 控制器或 CI 套用 |

同一個物件只讓一個工具管。兩個工具都認為自己負責同一個物件時，會互相把對方的變更蓋回去。

## 秘密不能直接進 Git

GitOps 要求所有期望狀態都在 Git，但 Secret 的 YAML 只是 base64，放進 Git 等於公開（見 [秘密管理](#/skill/secrets)）。常見的三種做法，差別在「Git 裡放的是什麼」：

| 做法 | Git 裡放什麼 | 誰解得開 |
|---|---|---|
| Sealed Secrets | 用叢集的公鑰加密過的 `SealedSecret` | 只有叢集內持有私鑰的控制器，解開後產生一般的 Secret |
| External Secrets Operator | 一份 `ExternalSecret`，只寫「到哪個秘密管理服務拿哪一筆」 | 控制器向外部服務取值，同步成 Secret；Git 裡完全沒有秘密的內容 |
| SOPS | 值被加密的 YAML 檔 | 持有金鑰（KMS 或 age 金鑰）的人與控制器 |

已經有集中的秘密管理服務（Vault、雲端的 secret manager）時，External Secrets 讓那個服務繼續當唯一的來源，輪替也在那裡做；沒有的話，Sealed Secrets 的門檻最低，但叢集的私鑰要備份，遺失就解不開已經加密的內容。

## 常見錯誤與錯誤訊息

訊息的確切文字依工具版本而異，下面是類似的樣子：

| 訊息或現象 | 原因 | 處理 |
|---|---|---|
| `unable to find one of 'kustomization.yaml', 'kustomization.yml' or 'Kustomization' in directory …` | `-k` 指到的目錄沒有 kustomization 檔，或路徑打錯 | 確認目錄與檔名 |
| `no matches for Id Deployment…booking-api…; failed to find unique target for patch` | 補丁的 kind 或 name 在 resources 裡找不到對應的物件 | 對照補丁與 base 的 `kind`、`metadata.name` |
| 套用補丁後，容器的 image 或其他設定不見了 | 那個清單是整個取代，不是依 name 合併 | 先用 `kubectl kustomize` 看合併結果；改用 JSON patch 指定位置 |
| `Error: UPGRADE FAILED: another operation (install/upgrade/rollback) is in progress` | 上一次 Helm 操作被中斷，release 卡在 pending 狀態 | `helm history` 看狀態，rollback 到上一個成功的 revision |
| `error converting YAML to JSON: yaml: line 23: did not find expected key` | 樣板 render 出來的 YAML 縮排不對 | `helm template` 輸出結果，看那一行 |
| `nil pointer evaluating interface {}.tag` | 樣板取用的值在 values 裡不存在（上一層就是空的） | 檢查 values 檔的鍵名與層級 |
| 用 `kubectl edit` 改的設定，過幾分鐘又變回去 | GitOps 控制器把它調和回 Git 的內容 | 改 Git，不要改叢集 |
| 應用程式一直顯示「不同步」 | 有別的元件也在改同一個欄位，例如 HPA 改 `replicas` | manifest 不要寫 `replicas`，或設定讓控制器忽略那個欄位 |
| `Error: Error acquiring the state lock` | 另一個 Terraform 程序正在執行，或上次異常中斷沒有釋放鎖 | 確認沒有人在跑之後再解鎖 |
| 秘密被 commit 進設定 repo | 把 Secret 的 YAML 直接放進 Git | 當成已外洩處理：輪替；從歷史移除不能取代輪替 |

## 動手

1. 執行合併的模擬。在 production 的 overlay 加一個新的容器（例如 `{"name": "metrics", "image": "registry.example.org/tools/exporter:1.2.0"}`），確認它是被加進清單、而不是取代 `api`。再替 base 與 overlay 的 `api` 容器各加一個元素是字串的清單（例如 `"args": ["--workers", "4"]`），觀察這種沒有 `name` 的清單是整個取代。
2. 做本課的程式題：把一份「複製 base 再手改」的 `kustomization.yaml` 改成參照 base 的 overlay。
3. 有 kubectl 的話，照本課的目錄結構建立 base 與兩個 overlay，用 `kubectl kustomize overlays/staging` 與 `kubectl kustomize overlays/production` 輸出後 `diff` 兩份結果，這份 diff 應該只包含刻意的差異。
4. 檢視目前的部署流程：叢集的憑證放在哪裡、誰可以直接 `kubectl apply` 到 production、有沒有辦法知道叢集的實際狀態和 Git 是否一致。這三個問題的答案決定要不要往 GitOps 走。
5. 回頭看整條線：[導入 Kubernetes 前要準備什麼](#/skill/k8s-readiness) → [manifest](#/skill/k8s-manifests) → [設定、探針與資源](#/skill/k8s-config-probes) → [排錯](#/skill/k8s-troubleshooting) → 本課。

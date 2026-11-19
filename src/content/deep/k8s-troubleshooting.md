## 從一個具體問題開始：`kubectl get pods` 一排紅字

週一早上部署完新版，`kubectl get pods -n booking` 的輸出類似這樣：

```bash
$ kubectl get pods -n booking
NAME                              READY   STATUS             RESTARTS      AGE
booking-api-6b8f7c9d54-4xk2p      1/1     Running            0             3d
booking-api-7c5d9f8b66-h2m8q      0/1     CrashLoopBackOff   5 (40s ago)   4m
booking-web-58c9d7f6b4-kk2x8      0/1     ImagePullBackOff   0             4m
report-worker-7f6d4c8b9-p0c3a     0/1     Pending            0             4m
notify-api-5d8c7b6f44-w9r2t       1/1     Running            12 (3m ago)   2h
export-api-84f9d6c5b7-m4n1z       1/1     Running            0             1h
```

六個 Pod、六種狀況：一個正常、一個啟動就掛、一個拉不到映像、一個排不上節點、一個看起來正常但重啟了 12 次。最後那個 `export-api` 狀態全綠，但使用者說連不到。

常見的錯誤處理方式是看到紅字就 `kubectl delete pod`，或把 Deployment 刪掉重建。Pod 是 Deployment 依範本建出來的，範本沒改，重建出來的 Pod 會停在一模一樣的狀態，而且前一次的 log 與事件跟著消失。

這一課是一張查表：每一種狀態代表什麼、下一個指令是什麼。各種狀態的成因（探針、requests、selector）在 [Kubernetes 實作：把服務寫成 manifest](#/skill/k8s-manifests) 與 [Kubernetes 實作：設定、探針與資源](#/skill/k8s-config-probes)。

## 固定的排查順序

不管是哪一種狀態，都照同一個順序往下查，每一步回答一個問題：

| 步驟 | 指令 | 回答的問題 |
|---|---|---|
| 1 | `kubectl get pods -n <ns> -o wide` | 哪些 Pod 有問題？STATUS、READY、RESTARTS 各是多少？在哪個節點？ |
| 2 | `kubectl describe pod <pod> -n <ns>` | Kubernetes 對這個 Pod 做了什麼？看最下面的 Events，以及容器的 State 與 Last State |
| 3 | `kubectl logs <pod> -n <ns>`（必要時加 `--previous`） | 程式自己說了什麼？ |
| 4 | `kubectl get events -n <ns> --sort-by=.lastTimestamp` | 這個 namespace 最近還發生了什麼？（Pod 已經不在時也查得到） |

Events 是 Kubernetes 的視角（排程、拉映像、探針、重啟），logs 是應用程式的視角（stdout 與 stderr）。容器根本沒啟動過（Pending、ImagePullBackOff）時不會有 log，只能看 Events；程式啟動後自己掛掉時，Events 只會說「它結束了」，原因在 log 裡。

三個欄位要一起看：

- **STATUS** 不是單一欄位，是 kubectl 從 Pod 的階段與容器狀態整理出來的摘要。`CrashLoopBackOff`、`ImagePullBackOff` 是容器「正在等待」的原因，不是 Pod 的階段。
- **READY** 是「ready 的容器數 / 容器總數」。`Running` 但 `0/1` 表示容器在跑、但 readiness 沒通過，Service 不會送流量給它。
- **RESTARTS** 不是 0 就值得查，即使現在是 `Running`。上面的 `notify-api` 兩小時重啟 12 次，每次重啟都有進行中的請求被切斷。

Events 預設只保留一小時左右。事故發生後要盡快看，或靠叢集的監控與 log 收集保留下來（見 [可觀測性：log、metrics、trace](#/skill/observability)）。

## 每一種狀態：原因與下一步

### Pending：排不上節點

Pod 已建立，但排程器找不到可以放它的節點。Events 的 `FailedScheduling` 訊息會列出每一類節點被排除的原因，類似：

```text
Warning  FailedScheduling  default-scheduler  0/3 nodes are available: 1 node(s) had untolerated taint {node-role.kubernetes.io/control-plane: }, 2 Insufficient memory.
```

| 訊息裡的關鍵字 | 原因 | 下一步 |
|---|---|---|
| `Insufficient cpu`、`Insufficient memory` | 節點上「還沒被保留」的資源，放不下這個 Pod 的 **requests**（與節點的實際使用率無關） | `kubectl describe node <node>` 看 Allocated resources；調低過大的 requests、縮減其他工作負載，或加節點 |
| `untolerated taint`（舊版的寫法是 `had taint … that the pod didn't tolerate`） | 節點有 taint，Pod 沒有對應的 toleration | 確認是不是本來就不該排到那些節點；可用的節點是否太少 |
| `didn't match Pod's node affinity/selector` | `nodeSelector` 或 affinity 指定的 label，沒有節點符合 | `kubectl get nodes --show-labels` 對照 |
| `unbound immediate PersistentVolumeClaims` | Pod 要用的 PVC 還沒綁定到 PV | `kubectl get pvc -n <ns>`、`kubectl describe pvc`：StorageClass 不存在或沒有預設的 StorageClass |

Deployment 的副本數不足、卻連一個 Pending 的 Pod 都看不到時，檢查是不是 namespace 的 ResourceQuota 用完了：那種情況 Pod 根本建不出來，錯誤出現在 ReplicaSet 的 Events（`kubectl describe replicaset`）。

### ImagePullBackOff 與 ErrImagePull：拉不到映像

`ErrImagePull` 是剛失敗，`ImagePullBackOff` 是失敗後正在等待重試（間隔會越來越長）。兩者是同一件事。Events 的 `Failed` 訊息會帶 registry 回的錯誤：

| 訊息裡的關鍵字 | 原因 | 下一步 |
|---|---|---|
| `not found`、`manifest unknown` | 映像名稱或 tag 打錯；CI 還沒把這個 tag 推上去 | 到 registry 確認這個 tag 存在；對照 manifest 的 `image` |
| `unauthorized`、`authentication required`、`pull access denied` | 私有倉庫，Pod 沒有帶登入資訊 | 建立 `kubernetes.io/dockerconfigjson` 型別的 Secret，在 Pod 的 `imagePullSecrets` 參照它（Secret 要在同一個 namespace） |
| `x509: certificate signed by unknown authority` | 節點不信任 registry 的憑證 | 內部 CA 的根憑證要裝在每個節點上，見 [導入 Kubernetes 前要準備什麼](#/skill/k8s-readiness) |
| `i/o timeout`、`no such host` | 節點連不到 registry | 從節點檢查 DNS 與防火牆，見 [網路通不通：從 DNS 到防火牆](#/skill/network-troubleshooting) |

拉映像的是節點上的容器執行環境，不是 Pod，所以「我的電腦 `docker pull` 得到」不能證明節點也拉得到。

### CrashLoopBackOff：啟動後一直結束

容器啟動了，但程序結束了；kubelet 重啟它，它又結束。每次重啟前的等待時間會加倍（從 10 秒開始，上限 5 分鐘），`CrashLoopBackOff` 就是「正在等下一次重啟」。

這時候 `kubectl logs <pod>` 看到的是**剛啟動的這一次**，常常是空的。要看的是上一次：

```bash
kubectl logs booking-api-7c5d9f8b66-h2m8q -n booking --previous
kubectl describe pod booking-api-7c5d9f8b66-h2m8q -n booking
```

`describe` 裡容器的 `Last State` 類似：

```text
    State:          Waiting
      Reason:       CrashLoopBackOff
    Last State:     Terminated
      Reason:       Error
      Exit Code:    1
      Started:      Mon, 09 Nov 2026 09:12:41 +0800
      Finished:     Mon, 09 Nov 2026 09:12:43 +0800
    Restart Count:  5
```

| 線索 | 多半是 | 下一步 |
|---|---|---|
| Exit Code 1（或其他非零值），啟動後幾秒就結束 | 程式啟動時丟出例外：必要的環境變數沒給、連不上資料庫、migration 沒跑 | `logs --previous` 的最後幾行通常就是原因 |
| Exit Code 127 或 126；或 `Reason: StartError`、訊息有 `executable file not found` | 啟動指令找不到，或沒有執行權限 | 檢查映像的 `ENTRYPOINT`、`CMD` 與 manifest 的 `command`、`args` |
| Exit Code 0，卻一直重啟 | 程式做完事就正常結束了；Deployment 預期的是不會結束的服務 | 一次性的工作改用 Job 或 CronJob |
| `Reason: OOMKilled`、Exit Code 137 | 記憶體超過 limits（見下一小節） | 不要只看 CrashLoopBackOff 就當成程式錯誤 |
| Events 有 `Liveness probe failed`，接著 `will be restarted` | 是 kubelet 把它殺掉的：liveness 在啟動完成前就判定失敗，或 liveness 檢查了外部依賴 | 加 `startupProbe`；liveness 只檢查程序本身 |

結束碼大於 128 時，減掉 128 是訊號的編號：137 是 SIGKILL（9），143 是 SIGTERM（15）。

與設定有關、但還沒到啟動那一步的是 `CreateContainerConfigError`：`env` 參照的 ConfigMap 或 Secret 不存在。這時沒有 log，原因在 Events。

### OOMKilled：記憶體超過 limits

容器的記憶體用量超過 `limits.memory`，被核心直接殺掉，`Last State` 的 `Reason` 是 `OOMKilled`、Exit Code 是 137。程式沒有機會寫 log，所以 **log 裡找不到原因**是這種狀況的特徵。

137 只代表「被 SIGKILL」，要看到 `Reason: OOMKilled` 才能確定是記憶體。接著分辨兩種情況：

- **limits 太小**：記憶體用量在啟動或尖峰時到達一個穩定的高度，剛好超過 limits。調高 limits（與 requests）。
- **記憶體洩漏**：用量隨時間一路往上、不回落，每隔固定時間被殺一次。調高 limits 只是延後下一次被殺的時間，要修程式。

`kubectl top pod -n <ns>`（需要 metrics-server）可以看當下的用量；要看趨勢得靠監控的歷史曲線。估算方法見 [硬體資源與容量規劃](#/skill/capacity-planning)。

另一種相關的狀態是 `Evicted`：不是容器超過自己的 limits，而是**節點**的記憶體或磁碟不足，kubelet 把 Pod 趕走。原因寫在 `describe pod` 的 Message。

### Running，但 Service 連不到

Pod 是 `Running`，其他服務連 `http://export-api` 卻不通。從 Service 往 Pod 一層一層查：

```bash
# 1. Service 後面有沒有 Pod
kubectl get endpointslices -n booking -l kubernetes.io/service-name=export-api

# 2. Service 的 selector 與 port
kubectl describe service export-api -n booking

# 3. 拿 selector 去找 Pod，並列出 label 與 READY
kubectl get pods -n booking -l app=export-api --show-labels -o wide
```

| 查到的結果 | 原因 | 下一步 |
|---|---|---|
| ENDPOINTS 是空的，第 3 步也找不到 Pod | selector 與 Pod 的 label 對不上，或兩者不在同一個 namespace | 對照 Service 的 `selector` 與 Deployment 的 `template.metadata.labels` |
| ENDPOINTS 是空的，第 3 步找得到 Pod 但 `READY 0/1` | readiness 沒通過 | `describe pod` 看 `Readiness probe failed` 的訊息 |
| ENDPOINTS 有位址，連線被拒絕（connection refused） | `targetPort` 不是程式監聽的 port；或程式只監聽 `127.0.0.1` | 對照 `targetPort` 與程式實際監聽的位址和 port；容器裡的服務要監聽 `0.0.0.0` |
| ENDPOINTS 有位址，連線逾時（timeout） | NetworkPolicy 擋住，或節點之間的網路問題 | `kubectl get networkpolicy -n <ns>`；確認來源 Pod 在允許的範圍內 |
| 名稱解析失敗 | 跨 namespace 卻只寫了短名稱；或 NetworkPolicy 擋住了 DNS | 改用 `<service>.<namespace>`；檢查對外規則有沒有放行 DNS（port 53） |

「被拒絕」與「逾時」的差別和一般網路排查相同：被拒絕代表封包到了、但沒有程式在那個 port 上；逾時通常是封包被丟掉。NetworkPolicy 的行為是：沒有任何 policy 選到某個 Pod 時，它不受限制；一旦有 policy 選到它，就只有被允許的流量能通過（前提是叢集的網路外掛有實作 NetworkPolicy，否則寫了也不會生效）。

### Ingress 回 404、502、503、504

狀態碼是 Ingress controller 產生的，下面是 nginx 系 controller 的常見對應，其他 controller 的行為可能略有不同：

| 狀態碼 | 意思 | 下一步 |
|---|---|---|
| 404 | 請求的 Host 或路徑沒有對到任何規則；或這份 Ingress 根本沒被 controller 處理 | 檢查 `host`、`path`、`pathType` 與 `ingressClassName`；用 `curl -H "Host: …"` 確認送出去的 Host |
| 503 | 規則對到了，但 Service 後面沒有可用的 Pod | 回到上一小節，從 EndpointSlice 查起 |
| 502 | controller 連到了 Pod，但連線被拒絕或回應壞掉 | `targetPort` 寫錯、Pod 正在重啟、後端是 HTTPS 而 controller 用 HTTP 連 |
| 504 | 後端太久沒有回應 | 程式本身慢，或 controller 的逾時設定太短 |

確認問題在哪一層的方法，是跳過前面的層直接連後面：用 `port-forward` 直接連 Service 或 Pod，通了就表示問題在 Ingress 這一層。再往外還有 DNS、憑證與外部負載平衡器，排查方式見 [網路通不通：從 DNS 到防火牆](#/skill/network-troubleshooting)。

## 用程式走一遍排查順序

下面把開頭那六個 Pod 的狀態、上一次的結束資訊與 Events 寫成資料，照「狀態 → 上一次的結束原因 → Events」的順序判斷：

```python run
pods = [
    {"name": "booking-api-4xk2p", "phase": "Running", "ready": True, "restarts": 0,
     "waiting": None, "last_reason": None, "exit_code": None, "events": []},
    {"name": "booking-api-h2m8q", "phase": "Running", "ready": False, "restarts": 5,
     "waiting": "CrashLoopBackOff", "last_reason": "Error", "exit_code": 1,
     "events": [("BackOff", "Back-off restarting failed container api")]},
    {"name": "booking-web-kk2x8", "phase": "Pending", "ready": False, "restarts": 0,
     "waiting": "ImagePullBackOff", "last_reason": None, "exit_code": None,
     "events": [("Failed", "Failed to pull image \"registry.example.org/booking/web:3f9c2a1\": not found")]},
    {"name": "report-worker-p0c3a", "phase": "Pending", "ready": False, "restarts": 0,
     "waiting": None, "last_reason": None, "exit_code": None,
     "events": [("FailedScheduling", "0/3 nodes are available: 3 Insufficient memory.")]},
    {"name": "notify-api-w9r2t", "phase": "Running", "ready": True, "restarts": 12,
     "waiting": None, "last_reason": "OOMKilled", "exit_code": 137, "events": []},
    {"name": "export-api-m4n1z", "phase": "Running", "ready": True, "restarts": 0,
     "waiting": None, "last_reason": None, "exit_code": None, "events": [],
     "labels": {"app": "export-api"}, "port": 8000},
]

def diagnose(pod):
    msgs = " ".join(m for _, m in pod["events"])
    # 1. 上一次怎麼結束的：OOMKilled 要先判斷，因為它的 STATUS 也可能是 CrashLoopBackOff 或 Running
    if pod["last_reason"] == "OOMKilled":
        return "記憶體超過 limits", "看記憶體曲線：穩定偏高就調 limits，一路上升就是洩漏"
    # 2. 還沒排上節點
    if pod["phase"] == "Pending" and pod["waiting"] is None:
        if "PersistentVolumeClaim" in msgs:
            return "PVC 沒有綁定", "kubectl describe pvc，檢查 StorageClass"
        if "Insufficient" in msgs:
            return "節點資源放不下 requests", "kubectl describe node 看已分配的資源；調 requests 或加節點"
        return "沒有符合條件的節點", "檢查 taint、nodeSelector、affinity"
    # 3. 容器在等待
    if pod["waiting"] in ("ImagePullBackOff", "ErrImagePull"):
        if "unauthorized" in msgs or "denied" in msgs:
            return "私有倉庫沒有登入資訊", "建立 imagePullSecrets"
        return "映像名稱或 tag 不存在", "到 registry 確認 tag；對照 manifest 的 image"
    if pod["waiting"] == "CreateContainerConfigError":
        return "參照的 ConfigMap 或 Secret 不存在", "看 Events 指出缺哪一個"
    if pod["waiting"] == "CrashLoopBackOff":
        if "Liveness probe failed" in msgs:
            return "被 liveness 探針重啟", "加 startupProbe；liveness 不要檢查外部依賴"
        return f"程式啟動後就結束（exit code {pod['exit_code']}）", "kubectl logs --previous 看上一次的輸出"
    # 4. 在跑，但沒有 ready
    if pod["phase"] == "Running" and not pod["ready"]:
        return "readiness 沒通過，Service 不會送流量給它", "describe pod 看探針失敗的訊息，再看程式的 log"
    return "正常", "—"

for pod in pods:
    cause, action = diagnose(pod)
    status = pod["waiting"] or pod["phase"]
    print(f"{pod['name']:<22} {status:<17} 重啟 {pod['restarts']:>2} 次")
    print(f"    原因：{cause}")
    print(f"    下一步：{action}")

# Pod 正常但連不到：換查 Service 這一層
def check_service(svc, pods):
    matched = [p for p in pods if all(p.get("labels", {}).get(k) == v for k, v in svc["selector"].items())]
    if not matched:
        return "selector 選不到任何 Pod，endpoints 是空的", "對照 Service 的 selector 與 Pod 的 label"
    if not any(p["ready"] for p in matched):
        return "選到的 Pod 都沒有 ready，endpoints 是空的", "查 readiness 探針"
    if any(p["port"] != svc["target_port"] for p in matched):
        return "targetPort 不是容器監聽的 port", "對照 targetPort 與程式監聽的 port"
    return "Service 這一層正常", "往 NetworkPolicy 與 Ingress 查"

service = {"name": "export-api", "selector": {"app": "export_api"}, "target_port": 8000}
cause, action = check_service(service, pods)
print(f"\nService {service['name']}（selector = {service['selector']}）")
print(f"    原因：{cause}")
print(f"    下一步：{action}")
```

輸出裡有兩點要看。`notify-api` 現在是 `Running`、`READY 1/1`，只看 STATUS 會以為沒事；判斷的順序把「上一次的結束原因」放在最前面，就是為了不漏掉這種情況。`export-api` 的 Pod 診斷結果是「正常」，問題出在 Service 的 selector，所以 Pod 這一層查不出東西時，要往 Service 那一層查。

## 進到容器裡查：exec、port-forward、debug

| 指令 | 用途 | 限制 |
|---|---|---|
| `kubectl exec -it <pod> -n <ns> -- sh` | 在**執行中的容器**裡開 shell 或執行指令：看環境變數、看掛載的檔案、從 Pod 的位置測連線 | 容器要在執行中（CrashLoopBackOff 時進不去）；映像裡要有 shell 與需要的工具 |
| `kubectl port-forward <pod 或 service/名稱> 8080:80 -n <ns>` | 把本機的 port 接到 Pod 或 Service，跳過 Ingress 直接測 | 只用於除錯；指定 Service 時實際只連到其中一個 Pod |
| `kubectl debug -it <pod> --image=busybox:1.36 --target=<容器名稱> -n <ns>` | 在 Pod 裡加一個臨時容器（ephemeral container），共用它的網路，帶自己的工具 | 需要叢集支援並允許臨時容器；臨時容器加上去後要等 Pod 刪除才會消失 |
| `kubectl debug node/<node> -it --image=busybox:1.36` | 在節點上開一個除錯用的 Pod | 權限很大，通常只有叢集管理者能用 |

幾個用法：

```bash
# 程式實際拿到的環境變數（會印出秘密，注意畫面與紀錄）
kubectl exec booking-api-6b8f7c9d54-4xk2p -n booking -- env

# 從 Pod 的位置測另一個 Service：分辨是「這個 Pod 連不到」還是「大家都連不到」
kubectl exec -it booking-api-6b8f7c9d54-4xk2p -n booking -- sh
# 在容器裡（映像要有這些工具；沒有就用 kubectl debug 帶一個有工具的臨時容器）：
#   nslookup export-api.booking.svc.cluster.local
#   wget -qO- http://export-api/healthz

# 跳過 Ingress 與 Service，直接連某一個 Pod
kubectl port-forward pod/export-api-84f9d6c5b7-m4n1z 8080:8000 -n booking
```

正式環境的映像通常很精簡，沒有 shell 也沒有 `curl`（見 [幫 Python 專案寫好 Dockerfile](#/skill/dockerfile-python)），`exec` 進不去，這時用 `kubectl debug` 帶一個有工具的臨時容器進去。不要為了除錯方便把工具裝進正式映像。

`exec` 與 `debug` 都是直接在正式環境的容器裡操作，應該受 RBAC 限制並留下稽核紀錄；在裡面改的任何東西，Pod 重建後就消失，不能當成修復。

## 常見錯誤與錯誤訊息

訊息的確切文字依版本而異，下面是類似的樣子：

| 訊息或現象 | 意思 | 下一步 |
|---|---|---|
| `0/3 nodes are available: 3 Insufficient cpu.` | 每個節點剩餘可保留的 CPU 都放不下這個 Pod 的 requests | 檢查 requests 是否過大；看節點已分配的量 |
| `Back-off pulling image "…"` | 拉映像失敗後正在等待重試 | 往上找同一個 Pod 的 `Failed to pull image` 那一則，原因在那裡 |
| `Back-off restarting failed container` | CrashLoopBackOff | `kubectl logs --previous` |
| `previous terminated container "api" in pod "…" not found` | 加了 `--previous`，但這個容器沒有上一次 | 容器沒重啟過，或 Pod 已經被重建；拿掉 `--previous`，或查 log 收集系統 |
| `container "api" in pod "…" is waiting to start: ContainerCreating` | 容器還沒啟動，沒有 log | 看 `describe pod` 的 Events |
| `error: deployment "booking-api" exceeded its progress deadline` | 滾動更新太久沒有進展 | 找出新的 ReplicaSet 的 Pod，照本課的順序查 |
| `Error from server (Forbidden): pods "…" is forbidden: User "…" cannot get resource "pods/log"` | 帳號的 RBAC 權限不足 | 不是 Pod 的問題；找叢集管理者確認權限 |
| `port-forward` 通，經過 Service 不通 | 問題在 Service 這一層 | selector、`targetPort`、readiness、NetworkPolicy |
| 刪掉 Pod 之後好了一陣子又壞 | 重建只是把狀態歸零（例如記憶體洩漏重新累積） | 回頭查 `RESTARTS` 與 `Last State`，找出根本原因 |

事故當下的分工與紀錄方式，見 [事故處理、on-call 與 postmortem](#/skill/incident-response)。

## 動手

1. 執行上面的診斷程式，自己加幾個 Pod：一個 `waiting` 是 `CrashLoopBackOff`、Events 有 `Liveness probe failed` 的；一個 `Pending`、訊息是 `pod has unbound immediate PersistentVolumeClaims` 的；一個 `Running` 但 `ready` 是 `False` 的。先預測輸出再執行。再把 `service` 的 selector 改對，看 Service 那一層的結果。
2. 做本課的程式題：實作 `diagnose(pod)`，把狀態、結束碼與 Events 分類成固定的原因代碼。
3. 到 [Kubernetes 排錯實驗室](#/lab/K8sDebugLab)練六種故障情境：按指令收集線索、判斷原因、看要改 manifest 的哪一行。
4. 在本機叢集上故意製造每一種狀態各一次（[本機叢集指南](https://github.com/yo02741/Backend-Atlas/blob/main/companion/clinic-api/docs/local-k8s.md)的「故意弄壞」一節有六個現成的練習），照「get → describe → logs → events」走一遍：把 image 的 tag 改成不存在的值；把記憶體 requests 改成 `500Gi`；把啟動指令改成 `["sh", "-c", "exit 1"]`；把 Service 的 selector 改錯。
5. 把本課的幾張表整理成團隊自己的 runbook，加上自己環境的指令（namespace、registry 位址、監控面板的位置）。
6. 同一個錯誤在每個環境重複出現，多半是 manifest 靠人工複製修改造成的，接著讀 [Helm、Kustomize 與 GitOps](#/skill/k8s-helm-gitops)。

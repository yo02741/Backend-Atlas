## 從一個具體問題開始：上線滿一年的那個早上

院內第一座 Kubernetes 叢集在 2025 年 11 月 12 日用 kubeadm 建好：三台控制平面、三台 worker，跑門診掛號的 `clinic-api` 與幾個院內服務。一年來沒出過大事，也沒有人動過它。2026 年 11 月 16 日星期一早上，值班的工程師要查一個 Pod，`kubectl` 回了這一行：

```bash
$ kubectl get pods -n clinic
Unable to connect to the server: tls: failed to verify certificate: x509: certificate has expired or is not yet valid: current time 2026-11-16T08:12:05+08:00 is after 2026-11-12T01:40:22Z
```

同一天資安組轉來一則 Kubernetes 的弱點公告，修補版只出在 1.35、1.36、1.37。叢集是 1.34，而 1.34 在 2026 年 10 月 27 日已經停止修補。

兩件事出自同一個原因：叢集上線後，沒有人負責它的生命週期。

- **憑證到期**：kubeadm 建叢集時產生的元件憑證（API server、etcd、元件之間的用戶端憑證，以及 `admin.conf` 裡給 `kubectl` 用的那一張）預設效期 1 年，CA 預設 10 年。這是 kubeadm 的預設值，kubeadm 1.31 起可以用設定檔的 `certificateValidityPeriod` 調整；其他發行版有自己的效期與輪替規則。
- **版本落後**：上游大約每 4 個月出一個次版本，每版修補約 14 個月。一年沒升級，叢集就落到沒有修補的版本。

`kubeadm upgrade` 預設會順便更新它管理的憑證，所以照節奏升級的叢集，通常不會碰到第一個問題。

那天早上掛號沒有中斷：已經在跑的容器由各節點的 kubelet 照顧，流量照常進來。但 controller-manager 與 scheduler 也拿同一批到期的憑證連 API server，叢集不能再變更：新版部署不上去，Pod 被刪除或節點故障時沒有新的補上。

叢集要先裝哪些周邊元件，見 [導入 Kubernetes 前要準備什麼](#/skill/k8s-readiness)；這一課講上線之後的工作。

## 維運要顧的元件

| 元件 | 在哪裡跑 | 停了會怎樣 | 維運要顧 |
|---|---|---|---|
| API server | 控制平面；kubeadm 用靜態 Pod 跑 | `kubectl`、CI 部署、所有控制器都連不上；已經在跑的容器不受影響 | 憑證、升級、多台時前面的負載平衡 |
| etcd | 控制平面（kubeadm 預設與 API server 同機） | 叢集狀態讀不到也寫不進去，API server 跟著不能用 | 快照備份、成員數用奇數、磁碟延遲、資料庫大小 |
| scheduler | 控制平面 | 新的 Pod 停在 Pending | 憑證、升級 |
| controller-manager | 控制平面 | 副本數不再被維持，節點故障沒人處理 | 憑證、升級 |
| kubelet | 每個節點，systemd 服務 | 節點變成 NotReady，上面的 Pod 過一段時間被移走 | 版本不能比 API server 新、憑證輪替、磁碟空間 |
| 容器執行環境 | 每個節點，systemd 服務 | 這個節點上的容器都跑不了 | 版本、映像占用的磁碟 |
| kube-proxy | 每個節點，DaemonSet | 這個節點上的 Service 規則不再更新 | 跟著叢集版本升級 |

kubeadm 的控制平面元件是**靜態 Pod**：kubelet 直接讀 `/etc/kubernetes/manifests/` 的 YAML 啟動它們，`kubectl delete pod` 重啟不了。API server 起不來時，要登入控制平面節點，直接看 kubelet 與容器執行環境：

```bash
journalctl -u kubelet --since "10 min ago"   # kubelet 的 log：憑證、連不上 API server、磁碟壓力
sudo crictl ps -a                            # 節點上所有容器，包含已經結束的
sudo crictl logs <容器 ID>                    # 例如 kube-apiserver 為什麼一直重啟
sudo crictl images                           # 節點上的映像
```

Kubernetes 1.24 起移除了 dockershim，節點上的容器執行環境是 containerd 或 CRI-O 這類實作 CRI（Container Runtime Interface）的程式。用 Docker 建的映像照樣能跑（映像格式是共通的 OCI 標準），但節點上多半沒有 docker 指令，排查容器用 `crictl`。

## 發行版怎麼選

上游 Kubernetes 只是一組元件。能上線的叢集還要有作業系統、安裝與升級工具、網路與儲存外掛、安全設定，以及出事時找得到的人，發行版的差別在這些由誰負責：

| 發行版 | 定位 | 支援與修補 | 升級工具 | 預設安全設定 | 人力 |
|---|---|---|---|---|---|
| kubeadm | 上游的安裝工具，只建出最小可用的叢集 | 社群；商業支援要另外找 | `kubeadm upgrade`，順序自己排 | 上游預設，強化自己做 | 最多：CNI、Ingress、儲存、監控、備份都自己選、自己裝 |
| RKE2 | SUSE（Rancher）的發行版，主打安全與合規 | 開源，可向 SUSE 買支援 | 換執行檔重啟；可用 system-upgrade-controller 自動依序升級 | 設計成預設通過大部分 CIS 基準項目 | 中等：內建 CNI、Ingress、定期 etcd 快照 |
| k3s | 同一家的輕量版，單一執行檔 | 同上 | 同上 | 要依強化指南調整 | 少；適合測試、邊緣與小型環境 |
| OpenShift | Red Hat 的企業平台，內建監控、registry、登入整合 | Red Hat 訂閱，自己的生命週期 | 內建更新頻道，節點作業系統一起升 | 最嚴：預設以非 root 的隨機 UID 執行容器 | 平台本身吃資源，要學它的做法（Route、SCC、Operator） |

Rancher 不是發行版，是管理多座叢集的平台：統一登入與權限、建立 RKE2 或 k3s 叢集、匯入其他叢集，在同一個介面看狀態與升級，叢集分成多座之後才值得評估。大量使用 VMware 的機房，vSphere 也有整合的 Kubernetes 方案（產品名稱近年改過幾次），支援跟著 VMware 的合約走。

評估時先問：弱點公告出來誰出修補版、斷網環境的安裝與升級有沒有官方文件、團隊有幾個人能處理 Linux 與儲存的問題。用 kubeadm 時，這些答案都是「我們自己」。

地端、雲端與混合雲的取捨見 [地端、雲端還是混合雲](#/skill/hosting-models)；雲端代管做掉了哪些事，見 [導入 Kubernetes 前要準備什麼](#/skill/k8s-readiness)。

## 版本與升級

### 版本節奏

版本號是 `1.次版本.修補版`，例如 1.35.9。上游的規則（以 [kubernetes.io/releases](https://kubernetes.io/releases/) 為準）：

- 大約每 4 個月出一個次版本（minor），同時維護最近三個。
- 每個次版本約有 14 個月的修補：前 12 個月是一般支援，最後 2 個月是維護模式，只收安全修補與嚴重問題的修正。
- 修補版大約每月一次；同一個次版本內換修補版比較輕。

2026 年 11 月的狀態（示意，日期以官方頁面為準）：

| 次版本 | 發行日 | 停止修補 |
|---|---|---|
| 1.34 | 2025-08-27 | 2026-10-27（已停止） |
| 1.35 | 2025-12-17 | 2027-02-28 |
| 1.36 | 2026-04-22 | 2027-06-28 |
| 1.37 | 2026-08-26 | 2027-10-28 |

所以叢集每年至少升級一次。控制平面一次只能升一個次版本：1.34 到 1.37 要依序升三次，每一次都要做完整的檢查與節點輪替。

### 版本差異政策（version skew）

升級途中，叢集裡同時有新舊版本。各元件之間可以差多少（摘要，以官方 [Version Skew Policy](https://kubernetes.io/releases/version-skew-policy/) 為準）：

| 元件 | 相對於 API server |
|---|---|
| 多台 API server 之間 | 最多差 1 個次版本 |
| controller-manager、scheduler | 不能比 API server 新，最多舊 1 個次版本 |
| kubelet、kube-proxy | 不能比 API server 新，最多舊 3 個次版本（1.25 以前的版本只能舊 2 個） |
| kubectl | 新或舊 1 個次版本以內 |

這張表決定了升級順序：

- **先控制平面，再節點**。kubelet 不能比 API server 新，節點不能先升。
- kubelet 可以舊 3 個次版本，節點可以分批升，不必和控制平面同一晚做完，但仍要盡快跟上。用 kubeadm 時，節點升級還要符合 kubeadm 本身的版本規定（以 kubeadm 文件為準）。
- 管理者電腦與 CI 裡的 `kubectl` 也要跟著換。

### 升級前：找出被移除的 API

beta 版的 API 在正式版出來後會被標成 deprecated，幾個版本後停止提供。叢集升到不再提供某個 apiVersion 的版本之後，用舊寫法的 manifest 一套用就失敗：

```text
error: resource mapping not found for name: "clinic-api" namespace: "clinic" from "pdb.yaml": no matches for kind "PodDisruptionBudget" in version "policy/v1beta1"
ensure CRDs are installed first
```

已經在叢集裡的物件不會消失，API server 改用新的版本提供它們。會壞的是 Git 裡的 manifest、Helm chart、CI 的 `kubectl apply`，以及還在呼叫舊 API 的程式與 operator。

幾個常見的例子（摘自官方的 [Deprecated API Migration Guide](https://kubernetes.io/docs/reference/using-api/deprecation-guide/)，完整清單以官方為準）：

| 停止提供的版本 | 物件 | 舊的 apiVersion | 改用 |
|---|---|---|---|
| 1.22 | Ingress | `extensions/v1beta1`、`networking.k8s.io/v1beta1` | `networking.k8s.io/v1`，`backend` 的寫法也變了 |
| 1.25 | CronJob | `batch/v1beta1` | `batch/v1` |
| 1.25 | PodDisruptionBudget | `policy/v1beta1` | `policy/v1`；空的 `selector` 從「選不到」變成「選到全部」 |
| 1.25 | PodSecurityPolicy | `policy/v1beta1` | 沒有直接替代，改用 Pod Security Admission |
| 1.26 | HorizontalPodAutoscaler | `autoscaling/v2beta2` | `autoscaling/v2` |
| 1.32 | FlowSchema、PriorityLevelConfiguration | `flowcontrol.apiserver.k8s.io/v1beta3` | `flowcontrol.apiserver.k8s.io/v1` |

從網路上複製的範本與舊版 Helm chart 常常還是舊寫法。每次升級前，對著遷移指南裡目標版本那一節查三個地方：

- **叢集收到的請求**：API server 從 1.19 起把 deprecated API 的請求記在 `apiserver_requested_deprecated_apis` 指標（標籤 `removed_release` 是停止提供的版本），連不在 Git 裡的程式也抓得到。
- **Git 裡的 manifest 與 chart**：用掃描工具（例如 pluto、kubent）對目標版本比對，本課的程式題是最小的版本。
- **Helm release**：Helm 把安裝時的 manifest 存在叢集裡，release 沒重新部署，裡面還是舊的 apiVersion。

```text
$ kubectl apply -f hpa.yaml            # 在 1.25 的叢集上套用舊寫法：成功，但伺服器送回警告
Warning: autoscaling/v2beta2 HorizontalPodAutoscaler is deprecated in v1.23+, unavailable in v1.26+; use autoscaling/v2 HorizontalPodAutoscaler
horizontalpodautoscaler.autoscaling/clinic-api created

$ kubectl get --raw /metrics | grep apiserver_requested_deprecated_apis   # 管理者：誰還在用
```

### 升級的順序

以 kubeadm 從 1.34 升 1.35 為例（細節以官方的 [Upgrading kubeadm clusters](https://kubernetes.io/docs/tasks/administer-cluster/kubeadm/kubeadm-upgrade/) 為準，`x` 換成要升的修補版）：

```bash
# 0. 事前：etcd 快照（見備份一節）、變更單核准、測試叢集演練過同一個版本

# 1. 每台節點：套件來源換成 1.35 的套件庫（pkgs.k8s.io 每個次版本一個庫）；斷網環境指向院內鏡像
sudo sed -i 's#/v1.34/#/v1.35/#' /etc/apt/sources.list.d/kubernetes.list
sudo apt-get update

# 2. 第一台控制平面：先升 kubeadm，看計畫，再套用
sudo apt-mark unhold kubeadm && sudo apt-get install -y kubeadm='1.35.x-*' && sudo apt-mark hold kubeadm
sudo kubeadm upgrade plan
sudo kubeadm upgrade apply v1.35.x     # 控制平面元件、etcd、CoreDNS、kube-proxy，並更新這台的憑證

# 3. 其他控制平面：一樣先升 kubeadm，再執行
sudo kubeadm upgrade node

# 4. 每台控制平面依序：drain → 升 kubelet 與 kubectl → 重啟 kubelet → uncordon
kubectl drain k8s-cp-1 --ignore-daemonsets
sudo apt-mark unhold kubelet kubectl && sudo apt-get install -y kubelet='1.35.x-*' kubectl='1.35.x-*' && sudo apt-mark hold kubelet kubectl
sudo systemctl daemon-reload && sudo systemctl restart kubelet
kubectl uncordon k8s-cp-1

# 5. worker 一台一台：升 kubeadm → kubeadm upgrade node → drain → 升 kubelet → 重啟 → uncordon
```

- `kubeadm upgrade plan` 檢查能不能升、列出每個元件的新舊版本；`apply` 中途失敗可以重跑。`kubeadm upgrade` 預設會更新這台節點上的憑證（`--certificate-renewal=false` 關掉）。
- 斷網的院內環境，新版需要的映像（`kubeadm config images list` 列得出來）要先同步到院內的 registry，叢集設定的 `imageRepository` 指向它；其他下載來源見 [地端、雲端還是混合雲](#/skill/hosting-models) 的斷網一節。
- CNI、Ingress controller、CSI driver、監控、Velero 各有支援的版本範圍，控制平面升級前先確認。
- 控制平面降版沒有一般性的官方支援，升壞了的回復手段是用升級前的 etcd 快照與舊版元件重建，所以要先在測試叢集演練、記下時間。升級排進變更單，寫清楚維護時段、回復條件與步驟，見 [變更管理](#/skill/change-management)。

### 排出升級路徑

下面用示意的版本資料，替開頭那座 1.34 的叢集排出到 1.37 的路徑與每一步的檢查，再檢查幾種升級途中的版本組合：

```python run
from datetime import date, timedelta

# 示意資料：發行日與停止修補日以 kubernetes.io/releases 為準
RELEASES = {
    "1.34": (date(2025, 8, 27), date(2026, 10, 27)),
    "1.35": (date(2025, 12, 17), date(2027, 2, 28)),
    "1.36": (date(2026, 4, 22), date(2027, 6, 28)),
    "1.37": (date(2026, 8, 26), date(2027, 10, 28)),
}
STEP_CHECKS = [
    "讀 {v} 的 release notes；掃描 manifest 與 Helm release 裡 {v} 不再提供的 apiVersion",
    "確認 CNI、Ingress controller、CSI driver、監控、Velero 支援 {v}",
    "etcd 快照，確認快照檔讀得出來",
    "套件來源換成 {v} 的套件庫；院內 registry 先同步 {v} 的映像",
    "測試叢集先演練 {prev} → {v}，記下花多久",
    "控制平面逐台升級，再一台一台 drain worker、升 kubelet、uncordon",
]


def minor(v):
    return int(v.split(".")[1])


def status(v, today):
    _, eol = RELEASES[v]
    if today > eol:
        return f"{eol} 已停止修補"
    return f"修補到 {eol}，還有 {(eol - today).days} 天"


def plan(current, target, today):
    print(f"目前 {current}（{status(current, today)}）")
    if minor(target) < minor(current):
        print("目標比目前舊：降版沒有一般性的官方支援")
        return
    path = [f"1.{m}" for m in range(minor(current) + 1, minor(target) + 1)]
    print(f"目標 {target}：控制平面要依序升 {len(path)} 次，{' → '.join([current] + path)}\n")
    prev = current
    for i, v in enumerate(path, 1):
        print(f"第 {i} 步 {prev} → {v}（{status(v, today)}）")
        for c in STEP_CHECKS:
            print("   - " + c.format(v=v, prev=prev))
        prev = v
    _, eol = RELEASES[target]
    print(f"\n升完之後：{target} 修補到 {eol}，下一次升級最晚在 {eol - timedelta(days=60)} 前做完（留兩個月緩衝）")


# 版本差異政策的摘要（以官方 Version Skew Policy 為準）
def skew_problems(state):
    api = [minor(v) for v in state["apiserver"]]
    newest, oldest = max(api), min(api)
    problems = []
    if newest - oldest > 1:
        problems.append("API server 之間差超過 1 個次版本")
    for name in ("controller-manager", "scheduler"):
        for v in state.get(name, []):
            if minor(v) > oldest:
                problems.append(f"{name} {v} 比最舊的 API server 新")
            elif minor(v) < newest - 1:
                problems.append(f"{name} {v} 落後 API server 超過 1 個次版本")
    for node, v in state.get("kubelet", {}).items():
        if minor(v) > oldest:
            problems.append(f"{node} 的 kubelet {v} 比 API server 新")
        elif minor(v) < newest - 3:
            problems.append(f"{node} 的 kubelet {v} 落後 API server 超過 3 個次版本")
    return problems


plan("1.34", "1.37", today=date(2026, 11, 16))

print("\n升級途中的版本組合：")
states = {
    "三台 API server 升了兩台": {
        "apiserver": ["1.35", "1.35", "1.34"], "controller-manager": ["1.34"], "scheduler": ["1.34"],
        "kubelet": {"k8s-node-1": "1.34", "k8s-node-2": "1.34"},
    },
    "有人先升了一台 worker": {
        "apiserver": ["1.34", "1.34", "1.34"],
        "kubelet": {"k8s-node-1": "1.35", "k8s-node-2": "1.34"},
    },
    "控制平面到 1.37，有一台節點還在 1.33": {
        "apiserver": ["1.37", "1.37", "1.37"], "controller-manager": ["1.37"], "scheduler": ["1.37"],
        "kubelet": {"k8s-node-1": "1.37", "k8s-node-3": "1.33"},
    },
}
for title, state in states.items():
    problems = skew_problems(state)
    print(f"  {title}：{'在支援範圍內' if not problems else '；'.join(problems)}")
```

三個步驟的檢查只差在版本號，每一步都要演練、排維護時段、輪替所有節點。路徑上的 1.35 只剩三個多月的修補，不能停在那裡。

:::stop 讀到這裡可以先停：會分出要顧的元件、比較發行版，並依版本差異政策排出一次升一個次版本的路徑。後面的 drain 與 PDB、備份還原、憑證與監控，在要做節點維護、排還原演練，或叢集快滿一年時再回來讀。

## 節點維護：cordon、drain 與 PDB

作業系統修補、核心更新、kubelet 升級、換硬體，都是同一套流程：

```bash
kubectl cordon k8s-node-2      # 標成不可排程：上面的 Pod 不動，新的 Pod 不會排進來
kubectl drain k8s-node-2 --ignore-daemonsets --delete-emptydir-data   # 先 cordon，再把 Pod 驅逐
# ……修補、重開機、確認節點回到 Ready……
kubectl uncordon k8s-node-2    # 恢復可排程
```

| 參數 | 意思 | 不加會怎樣 |
|---|---|---|
| `--ignore-daemonsets` | DaemonSet 的 Pod（log 收集、CNI、kube-proxy）留在節點上 | drain 拒絕執行。DaemonSet 控制器不理會 cordon，驅逐了也會馬上補回同一台 |
| `--delete-emptydir-data` | 允許驅逐用了 `emptyDir` 的 Pod，`emptyDir` 的內容跟著刪除 | drain 拒絕執行，列出這些 Pod |
| `--force` | 允許刪除沒有控制器的 Pod（直接建立、不屬於任何 Deployment 等） | drain 拒絕執行；這種 Pod 刪掉後沒有人會重建 |
| `--timeout` | 最多等多久 | 預設 0，一直等 |

drain 透過 Eviction API 驅逐 Pod，會遵守 Pod 的優雅關機（`terminationGracePeriodSeconds`、`preStop`）與 **PodDisruptionBudget（PDB）**，寫法見 [設定、探針與資源](#/skill/k8s-config-probes)。實作路線的 `clinic-api` 有兩個副本，PDB 是 `minAvailable: 1`。

兩個副本剛好都在 `k8s-node-2` 時，drain 的輸出類似：

```text
node/k8s-node-2 cordoned
Warning: ignoring DaemonSet-managed Pods: kube-system/kube-proxy-q8z4t, logging/fluent-bit-m2v9c
evicting pod clinic/clinic-api-6c8f9d7b5-x7k2p
evicting pod clinic/clinic-api-6c8f9d7b5-p4m8n
error when evicting pods/"clinic-api-6c8f9d7b5-p4m8n" -n "clinic" (will retry after 5s): Cannot evict pod as it would violate the pod's disruption budget.
pod/clinic-api-6c8f9d7b5-x7k2p evicted
evicting pod clinic/clinic-api-6c8f9d7b5-p4m8n
pod/clinic-api-6c8f9d7b5-p4m8n evicted
node/k8s-node-2 drained
```

第一個 Pod 被驅逐後只剩一個可用，PDB 允許的中斷變成 0，第二個收到 429、每 5 秒重試，等替代的 Pod 在別的節點 Ready 才被驅逐。drain 會永遠等下去的情況：

- 單一副本加上 `minAvailable: 1`，或 `minAvailable` 等於副本數、`maxUnavailable: 0`：全部健康時允許的中斷也是 0。
- 替代的 Pod 排不上：其他節點放不下，或 affinity、taint 不符。drain 一台節點，其他節點要扛它的 Pod，容量照 N+1 估，見 [硬體資源與容量規劃](#/skill/capacity-planning)。
- Pod 本來就不健康，已經吃掉了預算。較新的版本可以在 PDB 設 `unhealthyPodEvictionPolicy: AlwaysAllow`（以官方文件為準）。

`kubectl get pdb -A` 的 `ALLOWED DISRUPTIONS` 是 0 的，就是下一次 drain 會卡住的地方。`--disable-eviction` 改用直接刪除、不檢查 PDB，只能當最後手段。

修補一次一台：前一台回到 Ready、上面的 Pod 都恢復後才做下一台。控制平面節點每做完一台先確認 etcd 健康（`etcdctl endpoint health`），三個成員的 etcd 只容忍一個不在。

### 節點故障時，Pod 多久會被重排

節點斷電或斷網時沒有人 drain 它：

1. kubelet 停止回報，過一段寬限時間，節點被標成 `NotReady` 並加上 `node.kubernetes.io/unreachable` taint，上面的 Pod 從 Service 的後端移出。
2. Pod 預設容忍這個 taint 300 秒（DefaultTolerationSeconds 這個 admission plugin 加上的），時間到才被驅逐，Deployment 在別的節點建立新的 Pod。

所以通常要幾分鐘才會在別處重建，確切時間依參數、Pod 的 toleration 與版本而定。StatefulSet 的 Pod 不會自動重建，因為無法確認舊的已經停止；確認節點真的關機後，可以手動加 `node.kubernetes.io/out-of-service` taint（1.28 起正式提供），見 [Kubernetes 儲存](#/skill/k8s-storage)。

### 模擬一次 drain

下面把節點上的 Pod 與 PDB 寫成資料，模擬 drain 什麼時候完成、卡在哪裡：

```python run
# 簡化的 drain：每 5 秒一輪，對節點上還沒走的 Pod 發 eviction；PDB 不允許就收到 429，下一輪重試
STARTUP = 20   # 替代的 Pod 從建立到 Ready 的秒數（示意）


def cluster(report_replicas=1, free_mem=None):
    def pod(name, app, node, owner="Deployment", emptydir=False, mem=256):
        return {"name": name, "app": app, "node": node, "owner": owner,
                "emptydir": emptydir, "mem": mem, "ready": True}
    pods = [
        pod("clinic-api-6c8f9-x7k2p", "clinic-api", "k8s-node-2", mem=512),
        pod("clinic-api-6c8f9-p4m8n", "clinic-api", "k8s-node-2", mem=512),   # 兩個副本剛好都在這台
        pod("clinic-web-5d7c8-r2t5w", "clinic-web", "k8s-node-2", emptydir=True, mem=128),
        pod("clinic-web-5d7c8-h9q3z", "clinic-web", "k8s-node-1", emptydir=True, mem=128),
        pod("fluent-bit-m2v9c", "fluent-bit", "k8s-node-2", owner="DaemonSet", mem=64),
        pod("report-worker-7f6d4-p0c3a", "report-worker", "k8s-node-2", mem=1024),
    ]
    if report_replicas == 2:
        pods.append(pod("report-worker-7f6d4-k8w1d", "report-worker", "k8s-node-3", mem=1024))
    pdbs = {   # PDB 名稱 → 選到哪個 app、那個 Deployment 的副本數、minAvailable
        "clinic-api": {"app": "clinic-api", "replicas": 2, "min_available": 1},
        "report-worker": {"app": "report-worker", "replicas": report_replicas, "min_available": 1},
    }
    free = dict(free_mem or {"k8s-node-1": 2048, "k8s-node-3": 2048})   # 其他節點還能保留的記憶體（Mi）
    return pods, pdbs, free


def drain(node, pods, pdbs, free, ignore_daemonsets=False, delete_emptydir_data=False, timeout=120):
    mine = [p for p in pods if p["node"] == node]
    ds = [p["name"] for p in mine if p["owner"] == "DaemonSet"]
    local = [p["name"] for p in mine if p["emptydir"]]
    errors = []
    if ds and not ignore_daemonsets:
        errors.append("cannot delete DaemonSet-managed Pods (use --ignore-daemonsets to ignore): " + ", ".join(ds))
    if local and not delete_emptydir_data:
        errors.append("cannot delete Pods with local storage (use --delete-emptydir-data to override): " + ", ".join(local))
    if errors:
        print("  node 已 cordon，但 drain 沒有開始驅逐：")
        for e in errors:
            print("    " + e)
        return
    print(f"  t=  0s  node/{node} cordoned；DaemonSet 的 Pod 留在節點上：{', '.join(ds) or '無'}")
    queue = [p for p in mine if p["owner"] != "DaemonSet"]
    told = set()
    for t in range(0, timeout + 1, 5):
        for p in pods:                                    # 替代的 Pod 時間到就 Ready
            if not p["ready"] and p.get("ready_at") is not None and t >= p["ready_at"]:
                p["ready"] = True
        for p in list(queue):
            name, pdb = next(((n, b) for n, b in pdbs.items() if b["app"] == p["app"]), (None, None))
            if pdb:
                healthy = sum(1 for q in pods if q["app"] == p["app"] and q["ready"])
                if healthy - pdb["min_available"] <= 0:
                    if p["name"] not in told:
                        print(f"  t={t:>3}s  429  {p['name']}：PDB {name} 允許的中斷是 0"
                              f"（可用 {healthy}，minAvailable {pdb['min_available']}），每 5 秒重試")
                        told.add(p["name"])
                    continue
            queue.remove(p)
            pods.remove(p)
            # 控制器補一個新的 Pod：找一個沒被 cordon、記憶體放得下的節點
            target = next((n for n, m in free.items() if m >= p["mem"]), None)
            new = dict(p, name=p["app"] + "-（新）", node=target, ready=False,
                       ready_at=t + STARTUP if target else None)
            pods.append(new)
            if target:
                free[target] -= p["mem"]
                print(f"  t={t:>3}s  evicted {p['name']} → 新的 Pod 排到 {target}，約 {STARTUP} 秒後 Ready")
            else:
                print(f"  t={t:>3}s  evicted {p['name']} → 新的 Pod 排不上任何節點，停在 Pending")
        if not queue:
            print(f"  t={t:>3}s  node/{node} drained")
            return
    for p in queue:
        name, pdb = next(((n, b) for n, b in pdbs.items() if b["app"] == p["app"]))
        if pdb["replicas"] - pdb["min_available"] <= 0:
            why = f"副本只有 {pdb['replicas']} 個、minAvailable {pdb['min_available']}，允許的中斷永遠是 0"
        else:
            why = "替代的 Pod 還沒 Ready（排不上節點，或啟動失敗）"
        print(f"  t={timeout}s  還在等：{p['name']}，卡在 PDB {name}：{why}")


print("A. kubectl drain k8s-node-2")
drain("k8s-node-2", *cluster())

print("\nB. 加上 --ignore-daemonsets --delete-emptydir-data")
drain("k8s-node-2", *cluster(), ignore_daemonsets=True, delete_emptydir_data=True)

print("\nC. report-worker 改成 2 個副本，另一個在 k8s-node-3")
drain("k8s-node-2", *cluster(report_replicas=2), ignore_daemonsets=True, delete_emptydir_data=True)

print("\nD. 同 C，但其他節點的記憶體只剩 400Mi")
drain("k8s-node-2", *cluster(report_replicas=2, free_mem={"k8s-node-1": 400, "k8s-node-3": 400}),
      ignore_daemonsets=True, delete_emptydir_data=True)
```

B 卡住的是單一副本的 `report-worker`，`clinic-api` 只多等了 20 秒。D 的 `report-worker` 被驅逐了：當下另一個副本健康，PDB 允許，但替代的 Pod 排不上，服務剩一個副本。PDB 只看驅逐那一刻的可用數，容量要另外算。

## 備份與還原

三種備份各管一部分：

| 方式 | 能還原 | 還原不了 |
|---|---|---|
| etcd 快照（RKE2 預設每 12 小時一次） | 整座叢集在某個時間點的所有物件，包含 Secret | PV 裡的資料、叢集外的資料庫 |
| Velero | 依 namespace 或 label 備份的物件與 volume，可以還原到另一座叢集 | 叢集外的資料庫 |
| GitOps（Argo CD、Flux 從 Git 重建） | Deployment、Service、ConfigMap 這類定義 | Secret（刻意不進 Git）、PV 裡的資料、手動建立的物件 |

實作路線的 PostgreSQL 留在叢集外，備份見 [資料庫維運](#/skill/db-operations)；GitOps 見 [Helm、Kustomize 與 GitOps](#/skill/k8s-helm-gitops)。

### etcd 快照

kubeadm 的 etcd 跑在靜態 Pod 裡，主機上不一定有 `etcdctl`，要另外裝與 etcd 版本相符的。在一台控制平面上做：

```bash
sudo etcdctl --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  snapshot save /var/backups/etcd/etcd-$(date +%Y%m%d-%H%M).db

# 檢查快照檔：etcd 3.5 起，離線操作改用 etcdutl
sudo etcdutl snapshot status /var/backups/etcd/etcd-20261116-0200.db -w table
```

快照檔裡有叢集所有的 Secret，沒開 etcd 靜態加密時是明文（見 [秘密管理](#/skill/secrets)），要加密、限制存取，並複製到叢集以外的地方。

還原的步驟以官方的 [Operating etcd clusters for Kubernetes](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) 為準，概念是：

1. 停掉所有 API server（kubeadm：把 `kube-apiserver.yaml` 移出 manifests 目錄）。
2. `etcdutl snapshot restore <快照檔> --data-dir <新的資料目錄>`（etcd 3.6 起 `etcdctl` 不再提供還原）。多個成員時，每個成員都從同一份快照還原。
3. etcd 改用新的資料目錄，啟動 etcd 與 API server，再重啟 scheduler、controller-manager 與 kubelet。

叢集會回到快照的時間點：之後建立的物件不見了，之後刪掉的回來了。用 GitOps 的叢集，還原後再從 Git 同步一次。

### Velero

Velero 透過 API 備份物件，volume 用儲存快照或檔案層級的備份，存到 S3 相容的物件儲存。適合只還原某個 namespace，或搬到另一座叢集：

```bash
velero schedule create clinic-daily --schedule="0 2 * * *" --include-namespaces clinic
velero backup get
velero restore create --from-backup clinic-daily-20261116020000
```

volume 能不能用快照，取決於 CSI driver 是否支援（見 [Kubernetes 儲存](#/skill/k8s-storage)）。

### 演練才算數

備份成功不代表能還原。定期在測試叢集實際還原：用 etcd 快照重建控制平面、用 Velero 把 `clinic` namespace 還原到另一座叢集，記下每一步花多久，寫進 runbook。演練要回答的問題見 [健康檢查、備份與事故處理](#/skill/reliability)。

## 憑證

kubeadm 的憑證放在每台控制平面的 `/etc/kubernetes/pki/` 與幾個 kubeconfig 檔裡。開頭那個早上的檢查結果：

```bash
$ sudo kubeadm certs check-expiration
CERTIFICATE                EXPIRES                  RESIDUAL TIME   CERTIFICATE AUTHORITY   EXTERNALLY MANAGED
admin.conf                 Nov 12, 2026 01:40 UTC   <invalid>       ca                      no
apiserver                  Nov 12, 2026 01:40 UTC   <invalid>       ca                      no
apiserver-etcd-client      Nov 12, 2026 01:40 UTC   <invalid>       etcd-ca                 no
apiserver-kubelet-client   Nov 12, 2026 01:40 UTC   <invalid>       ca                      no
controller-manager.conf    Nov 12, 2026 01:40 UTC   <invalid>       ca                      no
etcd-healthcheck-client    Nov 12, 2026 01:40 UTC   <invalid>       etcd-ca                 no
etcd-peer                  Nov 12, 2026 01:40 UTC   <invalid>       etcd-ca                 no
etcd-server                Nov 12, 2026 01:40 UTC   <invalid>       etcd-ca                 no
front-proxy-client         Nov 12, 2026 01:40 UTC   <invalid>       front-proxy-ca          no
scheduler.conf             Nov 12, 2026 01:40 UTC   <invalid>       ca                      no
super-admin.conf           Nov 12, 2026 01:40 UTC   <invalid>       ca                      no

CERTIFICATE AUTHORITY   EXPIRES                  RESIDUAL TIME   EXTERNALLY MANAGED
ca                      Nov 10, 2035 01:40 UTC   8y              no
etcd-ca                 Nov 10, 2035 01:40 UTC   8y              no
front-proxy-ca          Nov 10, 2035 01:40 UTC   8y              no
```

（欄位依版本略有不同，`super-admin.conf` 是 1.29 起才有。）每台控制平面一台一台更新：

```bash
sudo kubeadm certs renew all

# 控制平面元件不會自動重新載入所有憑證：把靜態 Pod 的 manifest 移出再移回，讓 kubelet 重建它們
sudo mkdir -p /etc/kubernetes/manifests-off
sudo mv /etc/kubernetes/manifests/*.yaml /etc/kubernetes/manifests-off/
sleep 20                                     # 等 kubelet 發現檔案不見、停掉容器
sudo mv /etc/kubernetes/manifests-off/*.yaml /etc/kubernetes/manifests/

# admin.conf 換了新憑證；自己目錄下的 kubeconfig 是舊副本，要重新複製
sudo cp /etc/kubernetes/admin.conf ~/.kube/config && sudo chown "$(id -u):$(id -g)" ~/.kube/config
```

`kubeadm certs renew` 不會更新 CA。CA 預設 10 年，換 CA 是另一件大工程，到期日寫進維運文件。

kubelet 的憑證另外處理：

- **用戶端憑證**（連 API server 用）：kubeadm 預設開啟自動輪替，kubelet 快到期時自己申請新的，所以 `check-expiration` 不列它。節點長期關機、錯過輪替時才會出問題。
- **服務端憑證**（`kubectl logs`、`exec` 會經過）：預設是 kubelet 自簽。設定 `serverTLSBootstrap: true` 可改由叢集 CA 簽發，但這類 CSR 不會自動核准，要有人或工具核准（`kubectl certificate approve`）。

到期日要放進監控：用 blackbox exporter 探測 API server 的 6443 port，取 `probe_ssl_earliest_cert_expiry`，剩 30 天告警（做法同 [HTTPS 憑證](#/skill/https-certificates)）；不對外的用戶端憑證，用排程工作在每台控制平面跑 `kubeadm certs check-expiration`，把剩餘天數寫成指標。照節奏升級會順便換新，但升級延後的那一年，告警還是要在。

## 叢集本身的監控與日誌

應用程式的監控見 [可觀測性：log、metrics、trace](#/skill/observability)；叢集本身常見的組合：

| 元件 | 做什麼 |
|---|---|
| metrics-server | 節點與 Pod 當下的 CPU、記憶體，給 HPA 與 `kubectl top` 用；不存歷史 |
| kube-prometheus-stack | 一個 Helm chart：Prometheus、Alertmanager、Grafana、node-exporter、kube-state-metrics，加上元件與節點的儀表板和告警規則 |
| Fluent Bit（DaemonSet） | 每個節點讀容器的 log 與 systemd journal（kubelet、containerd），送到集中儲存 |
| Loki 或 Elasticsearch | 存 log、提供查詢 |

Pod 被刪除時 log 跟著消失，Events 預設也只留一小時左右，所以 log 要收到叢集外。告警至少要有：

- **etcd**：沒有 leader、成員掉線、磁碟 fsync 延遲高、資料庫接近空間配額（超過配額後 etcd 只接受讀取與刪除）。
- **憑證** 30 天內到期。
- **節點 NotReady** 超過幾分鐘；同時好幾台，通常是網路或儲存的共同問題。
- **磁碟壓力**（DiskPressure）：kubelet 會開始清映像、驅逐 Pod。
- **API server** 的錯誤率與延遲。

## 常見錯誤與錯誤訊息

訊息的確切文字依版本而異，下面是類似的樣子：

| 訊息或現象 | 原因 | 處理 |
|---|---|---|
| 換完憑證後 `error: You must be logged in to the server (Unauthorized)` | 用的還是舊的 kubeconfig 副本，裡面的用戶端憑證過期了 | 重新複製 `admin.conf` |
| `no matches for kind "PodDisruptionBudget" in version "policy/v1beta1"` | 叢集已經不提供這個 apiVersion | 照遷移指南改成新版本，必要時調整欄位 |
| `apt` 找不到新版的 kubeadm 套件 | pkgs.k8s.io 每個次版本一個套件庫，來源還指向舊的 | 改套件來源的版本；斷網環境先同步院內鏡像 |
| drain 一直印 `Cannot evict pod as it would violate the pod's disruption budget` | PDB 允許的中斷是 0：單一副本、`minAvailable` 等於副本數、替代的 Pod 起不來 | `kubectl get pdb -A` 看 `ALLOWED DISRUPTIONS`；加副本、改 PDB，或查替代的 Pod 為什麼 Pending |
| drain 拒絕執行：`cannot delete DaemonSet-managed Pods`、`cannot delete Pods with local storage` | 少了 `--ignore-daemonsets`、`--delete-emptydir-data` | 確認 `emptyDir` 的內容可以丟掉，再加參數 |
| 節點 NotReady，kubelet 的 log 說 `kubelet.conf` 裡的憑證過期 | 節點長期關機，錯過 kubelet 用戶端憑證的輪替 | 依 kubeadm 的排錯文件重新產生，或把節點移出叢集後重新加入 |
| kube-prometheus-stack 裝好後，controller-manager、scheduler、etcd 一直顯示 down | kubeadm 預設讓這些元件的指標只監聽本機位址 | 調整監聽位址（先評估安全性），或關掉對應的監控項目 |

## 動手

1. 執行升級規劃器，把 `today` 改成 `date(2027, 3, 1)`：1.35 也已經停止修補。再把 `plan` 的目前版本改成 `"1.36"`，看要升幾次。
2. 執行 drain 模擬，把 `clinic-api` 的 PDB 改成 `"min_available": 2`，先預測 B 會卡在哪裡再執行；再把 D 的 `free_mem` 調大，看 drain 何時完成。
3. 做本課的程式題：判斷一次 drain 會不會被 PDB 擋住（含百分比的 `minAvailable`、`maxUnavailable`）；從 manifest 找出目標版本已經不提供的 apiVersion。
4. 依 [本機叢集指南](https://github.com/yo02741/u-kinda-should-know/blob/main/companion/clinic-api/docs/local-k8s.md) 的「多個 worker 的叢集」一節，用 `k8s/kind-config-workers.yaml` 建一座有兩個以上 worker 的本機叢集，套用 kind overlay（PDB 在 `k8s/base/pdb.yaml`）。副本數改成 1 再 drain 它所在的 worker，看 drain 卡住與 `kubectl get pdb` 的輸出；改回 2 再 drain 一次，同時用迴圈打 Service，看有沒有失敗的請求。
5. 本機叢集若是 kind（內部用 kubeadm 建叢集），用 `docker exec` 進控制平面的容器，執行 `kubeadm certs check-expiration` 與 `crictl ps`。
6. 替自己的叢集寫一份年度維運日曆：停止修補日、升級月份、憑證與 CA 到期日、還原演練日、作業系統修補時段。

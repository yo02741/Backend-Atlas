## 從一個具體問題開始：報表 PDF 不見了，掛上 PVC 又有兩個 Pod 起不來

門診的報表服務 `clinic-report` 每天凌晨產生前一天的門診統計 PDF，寫到容器裡的 `/srv/reports`，醫事室白天從網頁下載。上線第二週做了一次節點維護，之後醫事室回報：前幾天的報表全部下載不到。

容器的檔案系統跟著容器走。節點維護時 Pod 被趕到別的節點重建，新的容器從映像重新開始，`/srv/reports` 是空的。滾動更新、容器被 OOMKilled 重啟，也都會讓這些檔案消失。

團隊替它加了一個 PVC，副本數 1 時一切正常。月初報表量大，副本改成 3：

```bash
$ kubectl get pods -n clinic -l app=clinic-report -o wide    # 只留部分欄位
NAME                             READY   STATUS              AGE   NODE
clinic-report-7d9f8c6b5-4xk2p    1/1     Running             2d    node-1
clinic-report-7d9f8c6b5-h2m8q    0/1     ContainerCreating   6m    node-2
clinic-report-7d9f8c6b5-p0c3a    0/1     ContainerCreating   6m    node-3

$ kubectl describe pod clinic-report-7d9f8c6b5-h2m8q -n clinic
...
Events:
  Warning  FailedAttachVolume  6m  attachdetach-controller  Multi-Attach error for volume "pvc-3f1c9a7e-…" Volume is already used by pod(s) clinic-report-7d9f8c6b5-4xk2p
```

PVC 的存取模式是 `ReadWriteOnce`，後端是區塊儲存：volume 同一時間只能 attach 到一個節點。三個 Pod 被排到三個節點，只有 node-1 上的那個拿得到。

## volume 的種類：資料跟著誰走

Pod 的 `volumes` 宣告有哪些 volume，容器的 `volumeMounts` 決定掛到哪個路徑：

| 種類 | 資料在哪 | 什麼時候消失 | 用途 |
|---|---|---|---|
| 容器自己的檔案系統 | 節點上的容器層 | 容器重啟或 Pod 重建 | 不放要保留的東西 |
| `emptyDir` | 節點的磁碟（`medium: Memory` 時是記憶體） | Pod 從節點上移除時（容器重啟不會） | 暫存檔、同一個 Pod 的容器之間交換檔案 |
| `configMap`、`secret` | API 裡的物件，由 kubelet 寫成檔案 | 跟著物件 | 設定檔、憑證，唯讀 |
| `hostPath` | 節點上的某個目錄 | 不會自動清，但 Pod 換節點就讀不到 | 系統層的元件（log 收集、監控代理） |
| `persistentVolumeClaim` | PV 背後的儲存：NAS、分散式儲存、本機磁碟 | 依 reclaimPolicy 決定，與 Pod 無關 | 要保留的資料 |

`emptyDir` 用 `medium: Memory` 時，寫進去的量算在容器的記憶體用量裡；`sizeLimit` 限制大小，超過時 Pod 會被驅逐。

`hostPath` 不適合一般服務：Pod 換節點就看到另一台機器的目錄；可以掛節點上的任何路徑（例如容器執行環境的 socket），等於拿到整個節點，Pod Security Standards 的 baseline 層級就禁止它（見 [Kubernetes 權限與多租戶](#/skill/k8s-rbac-tenancy)）；寫滿的是節點的磁碟，同節點的 Pod 一起受影響。

報表服務的 Pod 裡三種 volume 各有用途：

```yaml
    spec:
      containers:
        - name: report
          image: registry.gitlab.example/clinic/report:7c41d0e2
          volumeMounts:
            - name: tmp                       # 產生 PDF 時的暫存檔
              mountPath: /tmp
            - name: fonts                     # 中文字型設定，來自 ConfigMap
              mountPath: /etc/fonts/conf.d/99-clinic.conf
              subPath: 99-clinic.conf         # 只掛一個檔案；用 subPath 掛的不會跟著 ConfigMap 更新
              readOnly: true
            - name: pdfs                      # 要保留的報表
              mountPath: /srv/reports
      volumes:
        - name: tmp
          emptyDir:
            sizeLimit: 2Gi
        - name: fonts
          configMap:
            name: clinic-report-fonts
        - name: pdfs
          persistentVolumeClaim:
            claimName: clinic-report-pdfs     # 同一個 namespace 裡的 PVC
```

`volumeMounts` 的 `name` 對不到 `volumes` 時，API server 直接拒絕。`mountPath` 寫錯則沒有任何錯誤：volume 掛在沒人用的路徑，程式照樣寫進容器自己的檔案系統，重建後才發現。

## PV、PVC、StorageClass：誰申請、誰提供

```text
Pod ── volumes.persistentVolumeClaim ──► PVC clinic-report-pdfs（屬於 namespace clinic）
                                           要 20Gi、ReadWriteMany、class nfs-csi
                                             │ 綁定：一個 PVC 對一個 PV
                                             ▼
StorageClass nfs-csi ── 動態建立 ──────►  PV pvc-3f1c9a7e-…（叢集層級）
  provisioner、參數、reclaimPolicy         20Gi、ReadWriteMany、reclaimPolicy Retain
                                             │
                                             ▼
                                          NAS 上的一個目錄 nas01.example.org:/export/k8s/…
```

| 物件 | 範圍 | 誰寫 | 內容 |
|---|---|---|---|
| PVC | namespace | 開發團隊，和 Deployment 放在一起 | 容量、存取模式、StorageClass 名稱 |
| PV | 叢集 | 動態佈建由 driver 建立；靜態佈建由管理者寫 | 實際的位置、容量、存取模式、reclaimPolicy |
| StorageClass | 叢集 | 叢集管理者 | 由哪個 driver 建立（provisioner）、參數、reclaimPolicy、綁定時機、能不能擴充 |

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: longhorn
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"   # PVC 沒寫 class 時用這個
provisioner: driver.longhorn.io
parameters:
  numberOfReplicas: "3"            # 參數由各 driver 定義，名稱與意思看 driver 的文件
reclaimPolicy: Retain              # 不寫是 Delete
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
---
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: nfs-csi
provisioner: nfs.csi.k8s.io
parameters:
  server: nas01.example.org
  share: /export/k8s
reclaimPolicy: Retain
volumeBindingMode: Immediate
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: clinic-report-pdfs
  namespace: clinic
spec:
  accessModes:
    - ReadWriteMany
  storageClassName: nfs-csi          # 不寫：用預設的 StorageClass；寫 ""：只綁沒有 class 的 PV
  resources:
    requests:
      storage: 20Gi
```

### 綁定流程

1. PVC 建立。沒寫 `storageClassName` 時，API server 補上預設的 StorageClass。
2. PV controller 找現有的 PV：class 相同、存取模式包含 PVC 要的每一種、容量不小於申請量；多個符合時挑最小的。PVC 拿到的是整個 PV，申請 100Gi 綁到 200Gi 的 PV，容量就顯示 200Gi。
3. 找不到時，StorageClass 有 provisioner 的話，由對應的 CSI driver 建一個容量等於申請量的新 PV。
4. 兩者互相記住對方，狀態變成 `Bound`。綁定是一對一的，空間有剩也不能給別的 PVC。
5. Pod 用到這個 PVC 時，需要 attach 的後端先 attach 到 Pod 所在的節點，kubelet 再掛到容器的路徑。

PVC 建立後，`storageClassName` 與存取模式都不能改，寫錯要刪掉重建。

### 動態佈建與靜態佈建

動態佈建由 driver 依 StorageClass 建 PV，是一般的做法。靜態佈建由管理者手寫 PV，用在接既有的資料、local PV、沒有 provisioner 的儲存。例如把 NAS 上歷年的舊報表唯讀掛給新服務：

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: pv-nas-archive
spec:
  capacity:
    storage: 200Gi
  accessModes:
    - ReadOnlyMany
  persistentVolumeReclaimPolicy: Retain   # 手動建立的 PV 不寫也是 Retain
  storageClassName: ""
  nfs:                                    # 內建的 NFS volume；也可以改用 csi 欄位交給 NFS 的 CSI driver
    server: nas01.example.org
    path: /export/archive/2019-2025
    readOnly: true
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: clinic-report-archive
  namespace: clinic
spec:
  accessModes:
    - ReadOnlyMany
  storageClassName: ""                    # 不要用預設的 class 動態建立
  volumeName: pv-nas-archive              # 指定要綁哪一個 PV
  resources:
    requests:
      storage: 200Gi
```

### volumeBindingMode：什麼時候建立 PV

`Immediate` 在 PVC 建立時就綁定或建立 PV，這時還不知道 Pod 會被排到哪裡。`WaitForFirstConsumer` 等第一個用它的 Pod 被排程：排程器把 Pod 的 requests、nodeSelector、affinity 與儲存的位置限制一起考慮，選好節點後才建立 PV。

地端常用 `WaitForFirstConsumer`，因為地端的儲存常常不是每個節點都拿得到：local PV 只在某一台節點上，有些 SAN 只接到某幾台節點。用 `Immediate` 時，PV 可能建在 Pod 去不了的地方，Pod 停在 Pending，訊息有 `volume node affinity conflict`。每個節點都連得到的 NFS 用 `Immediate` 沒有問題。

等待期間 PVC 是 `Pending`，Events 是 `waiting for first consumer to be created before binding`，屬於正常狀態。

### reclaimPolicy：刪 PVC 會不會連資料一起刪

| | Delete | Retain |
|---|---|---|
| 刪 PVC 之後 | PV 與後端的 volume 一起刪除，資料沒了 | PV 變成 `Released`，後端的資料還在 |
| 預設 | 動態建立的 PV 繼承 StorageClass 的值，StorageClass 沒寫時是 Delete | 手動建立的 PV |
| 適合 | 測試環境、可以重建的資料 | 正式環境的資料；之後由管理者搬走資料再刪，或清掉 PV 的 `claimRef` 讓它可以重新綁定 |

`kubectl delete namespace clinic` 會刪掉裡面所有 PVC，用 Delete 的資料跟著消失。StorageClass 建立後，provisioner、parameters 與 reclaimPolicy 都不能改；已經建立的 PV 可以個別修改：

```bash
kubectl patch pv <PV 名稱> -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}'
```

還有 Pod 在用的 PVC 被刪除時，會停在 `Terminating`，等 Pod 都結束才刪除（`kubernetes.io/pvc-protection` 這個 finalizer 的作用）。

### 擴充容量

StorageClass 有 `allowVolumeExpansion: true`、driver 也支援時，把 PVC 的 `spec.resources.requests.storage` 改大就會擴充（Kubernetes 1.24 起 GA）：

```bash
kubectl patch pvc data-clinic-queue-0 -n clinic -p '{"spec":{"resources":{"requests":{"storage":"20Gi"}}}}'
kubectl get pvc data-clinic-queue-0 -n clinic -w      # CAPACITY 變成 20Gi 才算完成
```

多數 CSI driver 可以在 Pod 執行中擴充，少數要重啟 Pod，以 driver 的文件為準。容量只能加、不能減；擴充失敗後改回較小值的做法，1.34 起 GA，更早的版本要管理者手動處理。

### 模擬：PVC 綁到哪裡

```python run
# 模擬 PV controller 的配對：class、存取模式、容量；找不到再看能不能動態建立
UNITS = {"Mi": 1024 ** 2, "Gi": 1024 ** 3, "Ti": 1024 ** 4}

def qty(s):                                    # "20Gi" -> 位元組
    return int(s[:-2]) * UNITS[s[-2:]]

storage_classes = {
    # supports 不是 StorageClass 的欄位：代表後端 driver 建得出哪些存取模式
    "longhorn":  {"provisioner": "driver.longhorn.io", "binding": "WaitForFirstConsumer", "default": True,
                  "supports": {"RWO", "RWOP", "RWX"}},          # RWX 透過 Longhorn 內建的 NFS
    "nfs-csi":   {"provisioner": "nfs.csi.k8s.io", "binding": "Immediate", "supports": {"RWO", "ROX", "RWX"}},
    "san-block": {"provisioner": "csi.san.example.org", "binding": "Immediate", "supports": {"RWO", "RWOP"}},
    "local-ssd": {"provisioner": "kubernetes.io/no-provisioner", "binding": "WaitForFirstConsumer"},  # 只能靜態佈建
}

pvs = [  # 管理者事先建好的 PV（靜態佈建）
    {"name": "pv-nas-archive", "size": "200Gi", "modes": {"ROX"}, "class": "", "node": None},
    {"name": "pv-local-node2", "size": "100Gi", "modes": {"RWO"}, "class": "local-ssd", "node": "node-2"},
    {"name": "pv-local-node3", "size": "500Gi", "modes": {"RWO"}, "class": "local-ssd", "node": "node-3"},
]

pvcs = [
    {"name": "report-pdfs",        "size": "20Gi",  "modes": {"RWO"}, "class": None},   # 沒寫 class：用預設的
    {"name": "report-pdfs-shared", "size": "20Gi",  "modes": {"RWX"}, "class": "nfs-csi"},
    {"name": "report-archive",     "size": "100Gi", "modes": {"ROX"}, "class": ""},     # "" = 只綁沒有 class 的 PV
    {"name": "pg-data",            "size": "80Gi",  "modes": {"RWO"}, "class": "local-ssd"},
    {"name": "report-typo",        "size": "20Gi",  "modes": {"RWX"}, "class": "nfs"},
    {"name": "shared-on-san",      "size": "20Gi",  "modes": {"RWX"}, "class": "san-block"},
    {"name": "huge-archive",       "size": "1Ti",   "modes": {"ROX"}, "class": ""},
]

bound = {}                                     # PV 名稱 -> PVC 名稱
fake_uids = iter(["3f1c9a7e", "8b20d4c1", "c47e0b92", "19ad5f3e"])

def bind(pvc, pod_node=None):
    cls = pvc["class"]
    if cls is None:                            # API server 補上預設的 StorageClass
        cls = next((n for n, c in storage_classes.items() if c.get("default")), "")
    sc = storage_classes.get(cls) if cls else None
    if cls and sc is None:
        return "Pending", f'storageclass.storage.k8s.io "{cls}" not found'
    if sc and sc["binding"] == "WaitForFirstConsumer" and pod_node is None:
        return "Pending", "waiting for first consumer to be created before binding"
    # 1. 先找既有的 PV：class 相同、存取模式涵蓋、容量夠；有節點限制的要符合 Pod 的節點。挑最小的
    fits = [pv for pv in pvs
            if pv["name"] not in bound and pv["class"] == cls
            and pvc["modes"] <= pv["modes"] and qty(pv["size"]) >= qty(pvc["size"])
            and (pv["node"] is None or pv["node"] == pod_node)]
    if fits:
        pv = min(fits, key=lambda p: qty(p["size"]))
        bound[pv["name"]] = pvc["name"]
        return "Bound", f'{pv["name"]}（容量 {pv["size"]}，申請 {pvc["size"]}）'
    # 2. 找不到：看 StorageClass 能不能動態建立
    if not sc:
        return "Pending", "no persistent volumes available for this claim and no storage class is set"
    if sc["provisioner"] == "kubernetes.io/no-provisioner":
        return "Pending", f"沒有符合的 PV，{cls} 也不會自動建立"
    if not pvc["modes"] <= sc["supports"]:
        return "Pending", f'ProvisioningFailed：{sc["provisioner"]} 不支援 {"、".join(sorted(pvc["modes"]))}'
    return "Bound", f'pvc-{next(fake_uids)}-…（{sc["provisioner"]} 剛建立 {pvc["size"]}）'

print("第一輪：PVC 剛建立")
waiting = []
for pvc in pvcs:
    status, detail = bind(pvc)
    print(f"  {pvc['name']:<19} {status:<8} {detail}")
    if "first consumer" in detail:
        waiting.append(pvc)

print("\n第二輪：用到這些 PVC 的 Pod 被排到 node-2")
for pvc in waiting:
    status, detail = bind(pvc, pod_node="node-2")
    print(f"  {pvc['name']:<19} {status:<8} {detail}")
```

`report-archive` 申請 100Gi，拿到整個 200Gi 的 PV。`huge-archive` 沒有夠大的 PV，class 又是 `""`，沒有人會替它建立。`report-pdfs` 與 `pg-data` 等到 Pod 排好節點才綁定；如果 Pod 被排到 node-1，`pg-data` 會繼續等，因為 node-1 沒有 local PV。

## 存取模式：ReadWriteOnce 限制的是節點

| 模式 | 縮寫 | 意思 | 常見後端 |
|---|---|---|---|
| ReadWriteOnce | RWO | 單一節點可讀寫；同一個節點上的多個 Pod 可以一起用 | 區塊儲存：Longhorn、Ceph RBD、SAN 的 LUN、local PV |
| ReadOnlyMany | ROX | 多個節點唯讀 | NFS、CephFS；區塊儲存依 driver 而定 |
| ReadWriteMany | RWX | 多個節點同時讀寫 | 檔案儲存：NFS、CephFS、NAS 廠商的 driver；Longhorn 透過內建的 NFS |
| ReadWriteOncePod | RWOP | 整個叢集只有一個 Pod 能用 | 只支援 CSI volume；1.22 alpha、1.27 beta、1.29 GA |

實際的行為：

- 存取模式是 PVC 與 PV 的**配對條件**，掛載之後 Kubernetes 不負責防寫。ROX 的 volume 要唯讀，`volumeMounts` 要寫 `readOnly: true`。
- 需要 attach 的區塊儲存，同一時間只 attach 到一個節點。排程器不會因為 PVC 是 RWO 就把 Pod 排在一起，其他節點上的 Pod 停在 `ContainerCreating`。
- 不需要 attach 的後端（NFS），RWO 的 PVC 被多個節點掛載時通常沒有東西擋。
- 要保證只有一個 Pod 寫入就用 RWOP：第二個 Pod 停在 `Pending`，由排程器擋下。

Deployment 掛 RWO 的 PVC 時，`replicas` 只能是 1，而且要改成 `strategy.type: Recreate`。預設的 RollingUpdate 先開新 Pod 再關舊的；新 Pod 被排到別的節點就卡在 Multi-Attach，`maxUnavailable` 是 0 時舊的也不會先關，更新停住。Recreate 先刪舊 Pod 再建新的，更新期間有一段時間沒有服務。

報表服務要多個副本，有三種改法：

| 做法 | 要改什麼 | 取捨 |
|---|---|---|
| PVC 改成 RWX（`nfs-csi`） | PVC 的存取模式與 class | 依賴 NAS 的可用性；兩個 Pod 寫同一個檔名會互相覆蓋，檔名要帶日期與 Pod 名稱，或先寫暫存檔再改名 |
| 改存物件儲存（S3 相容的服務，例如 Ceph 的 RGW 或儲存設備內建的 S3 介面） | 程式改成上傳物件，下載時給有效期限的網址 | Pod 完全無狀態，擴展最簡單；要多維運一套物件儲存 |
| 維持 1 個副本、RWO、Recreate | Deployment 的 strategy | 不用改程式；不能擴展，更新與節點故障時中斷 |

### 模擬：幾個 Pod 掛同一個 PVC

```python run
# 多個 Pod 掛同一個 PVC，依建立順序決定誰起得來
# attach_required：區塊儲存（Longhorn、Ceph RBD、SAN）要先 attach 到節點；NFS 不用
def start(title, pods, mode, attach_required=True):
    attached_node = None                      # RWO：volume 目前 attach 在哪個節點
    owner = None                              # RWOP：目前是哪個 Pod 在用
    print(title)
    for name, node in pods:
        if mode == "RWOP":
            if owner is None:
                owner, state = name, "Running"
            else:
                node, state = "-", f"Pending            PVC 已經被 {owner} 使用，排程器不放行"
        elif mode == "RWO" and attach_required:
            if attached_node is None:
                attached_node, state = node, "Running"
            elif node == attached_node:
                state = "Running            同一個節點，可以一起掛"
            else:
                state = f"ContainerCreating  Multi-Attach error：volume 已經 attach 在 {attached_node}"
        elif mode == "RWO":
            state = "Running            後端不需要 attach，沒有東西擋"
        else:                                 # RWX、ROX
            state = "Running"
        print(f"  {name:<16} {node:<7} {state}")
    print()

spread = [("report-4xk2p", "node-1"), ("report-h2m8q", "node-2"), ("report-p0c3a", "node-3")]
same = [("report-4xk2p", "node-1"), ("report-h2m8q", "node-1"), ("report-p0c3a", "node-1")]
rollout = [("report-4xk2p", "node-1"), ("report-new-9w7k", "node-2")]   # 舊 Pod 還在，maxSurge 先開的新 Pod

start("A. 3 個副本分在 3 個節點，RWO（longhorn）", spread, "RWO")
start("B. 3 個副本剛好都在 node-1，RWO", same, "RWO")
start("C. 3 個副本，ReadWriteOncePod", spread, "RWOP")
start("D. 3 個副本，RWX（nfs-csi）", spread, "RWX")
start("E. 1 個副本做滾動更新，新 Pod 排到別的節點，RWO", rollout, "RWO")
start("F. RWO，但後端是 NFS", spread, "RWO", attach_required=False)
```

A 是開頭的狀況。B 看起來正常，只是三個 Pod 剛好在同一個節點，哪天其中一個被排到別處就會壞；單節點的測試叢集永遠重現不了 A。F 能跑，但三個節點同時寫同一份資料，衝突要程式自己處理。

## CSI 與地端的儲存選項

CSI（Container Storage Interface）是容器平台與儲存系統之間的標準介面，Kubernetes 1.13 起 GA。儲存廠商或開源專案寫一個 CSI driver，Kubernetes 就能建立、attach、掛載、擴充與快照它的 volume。早期內建在 Kubernetes 裡的雲端磁碟外掛，大多已經遷移到對應的 CSI driver。

一個 driver 在叢集裡通常分兩部分：controller（呼叫儲存系統的管理介面建立、attach、擴充、快照 volume）與 node（DaemonSet，每個節點一個，負責把 volume 掛到節點上）。

```bash
$ kubectl get csidrivers               # 只留前兩欄
NAME                 ATTACHREQUIRED
driver.longhorn.io   true
nfs.csi.k8s.io       false

$ kubectl get storageclass
NAME                 PROVISIONER          RECLAIMPOLICY   VOLUMEBINDINGMODE      ALLOWVOLUMEEXPANSION   AGE
longhorn (default)   driver.longhorn.io   Retain          WaitForFirstConsumer   true                   90d
nfs-csi              nfs.csi.k8s.io       Retain          Immediate              false                  90d
```

`ATTACHREQUIRED` 是 `true` 的 driver，RWO 才會有 Multi-Attach 的限制。

| 選項 | 提供什麼 | 存取模式 | 適合 | 要注意 |
|---|---|---|---|---|
| NFS（接既有的 NAS） | 檔案 | RWO、ROX、RWX | 多個 Pod 共用的檔案：報表、上傳檔 | NAS 是單點，除非設備有 HA；延遲與檔案鎖不適合資料庫；權限靠 UID 對應 |
| Longhorn | 用節點的本機磁碟組成分散式區塊儲存，每個 volume 在幾個節點各放一份副本 | RWO；RWX 透過內建的 NFS | 中小型叢集；要快照與備份到叢集外的功能，又沒有專職的儲存人力 | 占用節點的磁碟、CPU 與網路；實際用量是容量乘上副本數 |
| Rook-Ceph | 用 operator 在叢集裡跑 Ceph：區塊（RBD）、檔案（CephFS）、物件（S3 相容） | RBD：RWO；CephFS：RWX | 規模較大，三種儲存都要 | 最複雜；要專用磁碟、足夠的節點與網路，出問題要懂 Ceph |
| 儲存設備廠商的 CSI driver | 既有的 SAN、NAS 直接提供 volume | 區塊：RWO；NAS：RWX | 已經有企業級儲存與維護合約 | 確認 driver 支援的 Kubernetes 版本、發行版、快照與擴充；權限與容量要和儲存組協調 |
| local PV | 節點本機的磁碟 | RWO | 自己會在節點之間複寫、要低延遲的服務（有複寫的資料庫、搜尋引擎） | 綁死在那個節點，節點壞了資料就拿不到；靜態佈建，搭配 WaitForFirstConsumer |

一個叢集常同時有兩三個 StorageClass，例如預設的區塊儲存給 RWO、NFS 給 RWX。選型先問儲存組手上有什麼設備、廠商有沒有 CSI driver：能接既有設備，通常比在節點上自建分散式儲存省維運人力。driver 有支援的 Kubernetes 版本範圍，叢集升級前要先查相容表（見 [Kubernetes 叢集維運](#/skill/k8s-operations)）。效能數字只信自己量的：上線前在目標 StorageClass 上用 fio 或應用程式自己的壓測工具量一次。

雲端代管的叢集預設就有對應雲端磁碟的 StorageClass（RWO），RWX 要另外接雲端的檔案服務；雲端磁碟通常只能掛在同一個可用區的節點，所以雲端也常用 `WaitForFirstConsumer`。

## StatefulSet：固定的名字、各自的 volume

院內訊息佇列 `clinic-queue`（示意用的程式）跑三個節點，每個節點保存自己那一份資料，啟動時要知道另外兩個節點的位址。寫成 Deployment 時，Pod 名稱是隨機的、重建後名字與 IP 都換掉，三個副本也只能共用同一個 PVC。

```yaml
apiVersion: v1
kind: Service
metadata:
  name: clinic-queue-headless
  namespace: clinic
spec:
  clusterIP: None                      # headless：不分配虛擬 IP，DNS 直接回 Pod 的 IP
  selector:
    app: clinic-queue
  ports:
    - name: peer
      port: 7000
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: clinic-queue
  namespace: clinic
spec:
  serviceName: clinic-queue-headless   # 用這個 headless Service 產生每個 Pod 的 DNS 名稱
  replicas: 3
  selector:
    matchLabels:
      app: clinic-queue
  template:
    metadata:
      labels:
        app: clinic-queue
    spec:
      containers:
        - name: queue
          image: registry.gitlab.example/clinic/queue:2b7e9d41
          env:
            - name: NODE_ID
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name     # clinic-queue-0、-1、-2
            - name: PEERS
              value: clinic-queue-0.clinic-queue-headless:7000,clinic-queue-1.clinic-queue-headless:7000,clinic-queue-2.clinic-queue-headless:7000
          ports:
            - name: peer
              containerPort: 7000
          volumeMounts:
            - name: data
              mountPath: /var/lib/queue
  volumeClaimTemplates:                # 每個 Pod 依這個範本各建一個 PVC
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: longhorn
        resources:
          requests:
            storage: 10Gi
```

```bash
$ kubectl get pods,pvc -n clinic       # 只列出相關的、部分欄位省略
NAME                 READY   STATUS    AGE
pod/clinic-queue-0   1/1     Running   5m
pod/clinic-queue-1   1/1     Running   4m
pod/clinic-queue-2   1/1     Running   4m

NAME                                        STATUS   VOLUME           CAPACITY   ACCESS MODES   STORAGECLASS
persistentvolumeclaim/data-clinic-queue-0   Bound    pvc-8b20d4c1-…   10Gi       RWO            longhorn
persistentvolumeclaim/data-clinic-queue-1   Bound    pvc-c47e0b92-…   10Gi       RWO            longhorn
persistentvolumeclaim/data-clinic-queue-2   Bound    pvc-19ad5f3e-…   10Gi       RWO            longhorn
```

| StatefulSet 給的 | 怎麼做到 | 例子 |
|---|---|---|
| 固定的名稱 | Pod 名稱是 `<StatefulSet 名稱>-<序號>`，重建後同名 | 刪掉 `clinic-queue-1`，新的還叫 `clinic-queue-1` |
| 固定的 DNS | headless Service 替每個 Pod 建一筆 `<Pod>.<Service>.<namespace>.svc.cluster.local` | IP 會變，`clinic-queue-1.clinic-queue-headless.clinic.svc.cluster.local` 不變 |
| 各自的 volume | 每個序號一個 `<範本名稱>-<Pod 名稱>` 的 PVC，重建的 Pod 掛回同一個 | `clinic-queue-1` 一直掛 `data-clinic-queue-1` |

headless Service 要自己建，名稱和 `serviceName` 相同（DNS 的行為見 [Kubernetes 網路](#/skill/k8s-networking)）。同一個 namespace 裡寫到 `clinic-queue-1.clinic-queue-headless` 就夠了。

### 順序、更新與縮減

- **啟動**：預設的 `podManagementPolicy: OrderedReady` 依序號 0、1、2 建立，前一個 Running 而且 Ready 才建下一個；縮減時從最大的序號開始刪。不需要順序的服務可以改成 `Parallel`。
- **更新**：預設的 `RollingUpdate` 從最大的序號往回一次換一個，新的 Pod Ready 才換下一個。`rollingUpdate.partition: 2` 只更新序號大於等於 2 的 Pod，可以先換一個觀察。
- **縮減副本不刪 PVC**：從 3 縮成 2，`clinic-queue-2` 被刪，`data-clinic-queue-2` 留著；擴回 3 時新的 `clinic-queue-2` 掛回原本的資料。刪掉整個 StatefulSet 也一樣。要自動刪就設定 `persistentVolumeClaimRetentionPolicy` 的 `whenScaled`、`whenDeleted`（預設都是 `Retain`；1.27 起預設啟用，1.32 GA）。留下的 PVC 繼續占空間，確定不要時手動刪。
- **volumeClaimTemplates 建立後不能改**：要加大容量就個別修改每個 PVC。較新的版本有放寬這個限制的提案，以官方文件為準。

StatefulSet 只保證名字與 volume。三個 Pod 是三份各自的資料，怎麼組成叢集、怎麼複寫、誰是主節點，是程式（或 operator）的事。

節點突然斷線時，StatefulSet 不會立刻在別的節點建同名的 Pod：舊的 Pod 可能還在寫，兩個 `clinic-queue-1` 同時寫同一份資料會毀掉它。Pod 會停在 `Terminating` 或 `Unknown`。確認那台節點已經關機後，加上 `node.kubernetes.io/out-of-service` taint（non-graceful node shutdown，1.28 起 GA），Kubernetes 才會刪掉上面的 Pod、detach volume，再到別的節點重建。不確定節點狀態時，不要用 `--force` 刪 Pod。

```bash
kubectl taint nodes node-2 node.kubernetes.io/out-of-service=nodeshutdown:NoExecute
```

| | Deployment | StatefulSet |
|---|---|---|
| Pod 名稱與 DNS | 隨機後綴，透過 Service 找到其中一個 | `<名稱>-0`、`-1`，每個 Pod 有自己的 DNS 名稱 |
| volume | 所有副本共用同一個 PVC，或不用 | 每個副本自己的 PVC |
| 啟動與縮減 | 同時進行 | 預設依序號啟動，縮減從最大的開始 |
| 更新 | maxSurge、maxUnavailable，可以先多開 | 從最大的序號往回一次一個；partition 分段 |
| 縮減副本 | Pod 刪掉就結束 | Pod 刪掉，PVC 預設保留 |
| 節點故障 | 在別的節點補新 Pod | 確認舊 Pod 不在了才重建 |
| 適合 | 無狀態的 API、前端、worker | 需要固定身分與各自資料的服務：有複寫的資料庫、訊息佇列、搜尋引擎 |

## 資料庫要不要放進叢集：放進去之前要做到的事

[導入 Kubernetes 前要準備什麼](#/skill/k8s-readiness) 的「資料庫要不要放進叢集」那一段，建議導入初期把資料庫留在既有的主機；門診掛號系統的 PostgreSQL 與院內舊系統的 Informix 都還在 VM 上。哪天要評估放進叢集，下面幾件事要先做到：

1. **用 operator，不要自己用 StatefulSet 組主從**。operator 是跑在叢集裡的控制器，把建立複寫、故障切換、切換後讓應用程式連到新的主節點、排程備份寫成程式。PostgreSQL 的 CloudNativePG 用一個 `Cluster` 物件描述節點數與備份目的地，由它建立 Pod、PVC 與 Service（它不用 StatefulSet，直接管 Pod 與 PVC）。團隊仍要懂 PostgreSQL 本身的複寫與升級，出事時才看得懂 operator 在做什麼。
2. **備份送到叢集外**：base backup 加上持續封存的 WAL，才能還原到指定時間點。PVC 的快照取代不了它。
3. **還原演練**：定期還原到另一個 namespace 或測試叢集，跑檢查用的查詢，記錄花了多久、資料落後多少（見 [健康檢查、備份與事故處理](#/skill/reliability)）。
4. **量儲存效能**：每次 commit 都要等資料寫進磁碟，分散式儲存的寫入還要經過網路送到其他節點的副本。上線前在目標 StorageClass 上用 fio 與 pgbench 量，和現在的 VM 比較。
5. **決定複寫做在哪一層**：三個資料庫節點各放在三副本的 Longhorn volume 上，一份資料會有九份。常見的做法是資料庫自己做串流複寫、volume 用 local PV 或單副本，並寫清楚故障時由誰切換。
6. **排程與容量**：requests 等於 limits、用 anti-affinity 分散到不同的實體主機、設 PodDisruptionBudget；用 kubelet 的 `kubelet_volume_stats_available_bytes` 等指標對 PVC 剩餘空間發告警（見 [可觀測性](#/skill/observability)）。

## 備份：有快照不等於有備份

VolumeSnapshot（`snapshot.storage.k8s.io/v1`，1.20 起 GA）的三個物件對應 PVC、PV、StorageClass：VolumeSnapshot（namespace 裡的申請）、VolumeSnapshotContent（實際的快照）、VolumeSnapshotClass（用哪個 driver、刪除時怎麼處理）。前提是 CSI driver 支援快照，而且叢集裝了快照的 CRD 與 snapshot controller；它們不屬於 Kubernetes 核心，很多發行版要另外裝。內建的 NFS volume、hostPath 不是 CSI，拍不了。

```yaml
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshotClass
metadata:
  name: longhorn-snap
driver: driver.longhorn.io
deletionPolicy: Retain               # 刪 VolumeSnapshot 時保留實際的快照
# parameters 依 driver 而定，有些 driver 可以選擇把快照送到叢集外的備份目標
---
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: data-clinic-queue-0-20261119
  namespace: clinic
spec:
  volumeSnapshotClassName: longhorn-snap
  source:
    persistentVolumeClaimName: data-clinic-queue-0
---
apiVersion: v1                       # 從快照還原：建一個新的 PVC，dataSource 指向快照
kind: PersistentVolumeClaim
metadata:
  name: data-clinic-queue-0-restore
  namespace: clinic
spec:
  storageClassName: longhorn
  dataSource:
    name: data-clinic-queue-0-20261119
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: 10Gi                  # 不能小於快照的大小
```

| | 儲存系統的快照 | 備份 |
|---|---|---|
| 放在哪 | 通常和原本的 volume 在同一個儲存系統 | 另一個系統，最好在另一個地點 |
| 儲存系統故障、被誤刪 | 一起不見；有些儲存系統刪 volume 時連快照一起刪 | 還在 |
| 一致性 | 某一瞬間的磁碟狀態，相當於突然斷電 | 資料庫工具做的備份是一致的，還能還原到指定時間點 |
| 適合 | 升級或 migration 前的回退點 | 災難復原、誤刪資料、法規要求的保存期限 |

刪掉 namespace 也會刪掉裡面的 VolumeSnapshot；`deletionPolicy` 是 `Delete` 時，實際的快照跟著消失。

Velero 是叢集層級的備份工具：把 Kubernetes 物件與 PV 的資料（透過 CSI 快照，或在節點上逐檔複製）備份到物件儲存，可以把整個 namespace 還原到另一個叢集。它的排程、etcd 快照與還原演練在 [Kubernetes 叢集維運](#/skill/k8s-operations)。不管用哪一種工具，條件都一樣：資料放在另一個系統、資料庫用資料庫自己的工具備份、定期還原演練、備份失敗時有人收到告警。

## 常見錯誤與錯誤訊息

訊息的確切文字依版本與 driver 而異，下面是類似的樣子，出現在 `kubectl describe pvc` 或 `kubectl describe pod` 的 Events：

| 訊息或現象 | 原因 | 處理 |
|---|---|---|
| PVC `Pending`：`no persistent volumes available for this claim and no storage class is set` | 沒寫 class，叢集也沒有預設的 StorageClass；或寫了 `""` 卻沒有符合的 PV | `kubectl get storageclass` 看有沒有 `(default)`；PVC 寫明 `storageClassName` |
| PVC `Pending`：`storageclass.storage.k8s.io "nfs" not found` | class 名稱打錯 | 對照 `kubectl get storageclass`，刪掉 PVC 用正確的名稱重建 |
| PVC `Pending`：`ProvisioningFailed` 加上 driver 的錯誤 | driver 建不出來：不支援的存取模式、空間不夠、driver 沒在執行 | 看完整的訊息，再看 driver 自己的 Pod 與 log |
| Pod `Pending`：`persistentvolumeclaim "clinic-report-pdf" not found` | `claimName` 寫錯，或 PVC 在別的 namespace | PVC 要和 Pod 在同一個 namespace |
| Pod `Pending`：`volume node affinity conflict` | PV 只在某些節點可用，Pod 去不了那些節點 | StorageClass 改用 WaitForFirstConsumer；對照 Pod 的 nodeSelector 與 PV 的 nodeAffinity |
| Pod `ContainerCreating`：`Multi-Attach error for volume … Volume is already used by pod(s) …` | RWO 的 volume 已經 attach 在別的節點 | 多副本改 RWX 或 StatefulSet；單副本改 `strategy: Recreate` |
| Pod `ContainerCreating`：`MountVolume.SetUp failed … mount.nfs: access denied by server` | NAS 的匯出規則沒有允許這個節點 | 請儲存組把所有節點（含之後新增的）加進匯出規則 |
| `PermissionError: [Errno 13] Permission denied: '/srv/reports/…'` | 容器以非 root 執行，volume 的目錄屬於 root | Pod 設 `securityContext.fsGroup`（driver 要支援變更擁有者）；NFS 多半要在 NAS 端設定目錄擁有者 |
| 擴充被拒：`only dynamically provisioned pvc can be resized and the storageclass that provisions the pvc must support resize` | 靜態 PV，或 StorageClass 沒有 `allowVolumeExpansion: true` | 管理者確認 driver 支援後，在 StorageClass 加上這個欄位 |
| 修改 StatefulSet 被拒：`updates to statefulset spec for fields other than … are forbidden` | 改了 volumeClaimTemplates、selector 或 serviceName | 個別擴充 PVC；一定要改範本時，用 `kubectl delete statefulset --cascade=orphan` 保留 Pod 與 PVC 後重建 |

## 動手

1. 執行第一段模擬：把 `report-typo` 的 class 改成 `nfs-csi`；把 `longhorn` 的 `"default": True` 拿掉，看 `report-pdfs` 的訊息；在 `pvs` 加一個 `150Gi`、ROX、class 為 `""` 的 PV，預測 `report-archive` 改綁哪一個。
2. 執行第二段模擬：E 的新 Pod 改排到 node-1。想想改成 `strategy: Recreate` 時兩個 Pod 的先後順序。
3. 做本課的程式題：修好報表服務的 PVC 與 Deployment；把一個需要固定名稱與各自資料的服務改成 StatefulSet 加 headless Service。
4. 在本機叢集練習（建立方式見 [clinic-api 的本機叢集指南](https://github.com/yo02741/Backend-Atlas/blob/main/companion/clinic-api/docs/local-k8s.md)）：
   - `kubectl get storageclass` 看預設的 class 與 VOLUMEBINDINGMODE。建一個 PVC 先不建 Pod，看它的狀態與 Events；再建一個 Pod 同時掛 emptyDir 與這個 PVC，各寫一個檔案，刪掉 Pod 重建，看哪一個還在。
   - 套用本課的 `clinic-queue`：image 換成 `busybox:1.36`、`command` 改成 `["sh", "-c", "hostname >> /var/lib/queue/boot.log && sleep 3600"]`，刪掉 `storageClassName` 那一行改用預設的 class。縮到 1 個副本，確認三個 PVC 都還在；擴回 3 後執行 `kubectl exec clinic-queue-2 -n clinic -- cat /var/lib/queue/boot.log`，應該有兩行。再縮到 2、刪掉 `data-clinic-queue-2`，用 `kubectl get pv` 看 reclaimPolicy 的效果。
   - 本機叢集多半只有一個節點，重現不了 Multi-Attach，情況和模擬裡的 B 一樣。
5. etcd 與整個叢集的備份、CSI driver 的升級，接著讀 [Kubernetes 叢集維運](#/skill/k8s-operations)；PVC 或 Pod 卡住時的排查順序見 [Kubernetes 排錯](#/skill/k8s-troubleshooting)。

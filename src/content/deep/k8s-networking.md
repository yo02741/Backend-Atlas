## 從一個具體問題開始：搬上叢集的第一週

門診掛號的 `clinic-api` 照實作路線第 10 階段寫好的 manifest 搬上院內的 Kubernetes 叢集，放在 `clinic` namespace，旁邊有前端 `clinic-web` 與這個環境自己的 PostgreSQL `clinic-db`。上線第一週收到兩張單。

第一張是門診櫃台：掛號時查不到病患的基本資料。這段資料要即時查院內舊系統的 Informix（`his-db.example.org`，10.20.5.31，port 9088）。API 的 log 只有一行：

```text
2026-11-09 09:12:41 ERROR his: connect to 10.20.5.31:9088 failed: timed out after 10s
```

同一支程式在舊的虛擬機（10.20.8.15）上跑了好幾年都正常。網路組查了防火牆紀錄，看到一連串來自 10.20.30.11、10.20.30.12 的連線被丟掉。這兩個位址是叢集的 worker 節點，舊系統的防火牆只放行 10.20.8.15。

第二張是資安稽核：稽核人員在別的 namespace 開了一個測試 Pod，直接連上了 `clinic-db` 的 5432：

```bash
$ kubectl run probe -n reports --rm -it --image=busybox:1.36 -- nc -vz -w 3 clinic-db.clinic 5432
clinic-db.clinic (10.96.212.40:5432) open
```

兩張單來自同一個網路模型：每個 Pod 有自己的 IP，叢集內預設全部互通；Pod 連出叢集時，來源位址多半被換成節點的 IP。這一課講這個模型怎麼運作、地端叢集要自己補哪些元件，以及怎麼用 NetworkPolicy 把「全部互通」收成白名單。Deployment、Service 與 selector 怎麼接線在 [Kubernetes 實作：把服務寫成 manifest](#/skill/k8s-manifests)，這裡不重複。

## Pod 網路：每個 Pod 一個 IP，預設全部互通

Kubernetes 對網路只訂了幾條要求，實作交給網路外掛：

- 每個 Pod 有一個整個叢集內唯一的 IP，Pod 裡的容器共用它（所以同一個 Pod 的容器用 `localhost` 互連）。
- 任何 Pod 可以直接連到任何節點上的任何 Pod，中間**不經過 NAT**：對方看到的來源位址就是你的 Pod IP。
- 節點上的程式（例如 kubelet）連得到這個節點上的每個 Pod，探針就是這樣打進去的。

Pod 的 IP 每次重建都會變，所以服務之間用下一節的 Service 互連，不直接寫 Pod IP。這個模型也代表「預設全部互通」：沒有任何設定時，`reports` namespace 的 Pod 連得到 `clinic` 的資料庫，稽核那張單就是這樣來的。

```text
節點 10.20.30.11（Pod 網段 10.244.1.0/24）      節點 10.20.30.12（Pod 網段 10.244.2.0/24）
  clinic-web   10.244.1.10                        clinic-db    10.244.2.12   （clinic）
  clinic-api   10.244.1.11  ◄──── CNI 轉送 ────►  report-job   10.244.2.30   （reports）

Pod 之間的連線不做 NAT：clinic-db 看到的來源就是 10.244.1.11 或 10.244.2.30
```

### CNI：誰負責做這件事

把 Pod 接上網路、分配 IP、讓不同節點上的 Pod 互通的是 CNI 外掛（Container Network Interface）。kubeadm 這類工具不會替你裝，發行版則各有預設（例如 RKE2 預設是 Canal，也就是 Flannel 加上 Calico 的政策引擎）。常見的三個：

| CNI | 定位 | NetworkPolicy |
|---|---|---|
| Flannel | 最簡單的 overlay，只負責讓 Pod 互通 | 不實作。可以搭配 Calico 的政策引擎（即 Canal） |
| Calico | 用路由（可與院內路由器跑 BGP）或 overlay；政策功能完整，另有自己的 CRD 支援拒絕規則與優先順序 | 實作 |
| Cilium | 以 eBPF 為基礎，可以取代 kube-proxy，支援 L7 政策與流量觀測 | 實作 |

最後一欄是導入時最容易漏掉的事：NetworkPolicy 只是 API 裡的物件，由 CNI 負責執行。用的 CNI 不實作它時，`kubectl apply` 照樣成功、`kubectl get networkpolicy` 也列得出來，但流量完全不受影響，沒有任何錯誤訊息。所以選定 CNI 之後，要實際測一次（方法在「動手」）。

建叢集前還要決定兩段位址：Pod 網段（例如 10.244.0.0/16）與 Service 網段（kubeadm 預設 10.96.0.0/12）。這兩段不能和院內任何既有網段重疊，否則 Pod 連到那段院內位址時，封包會被當成叢集內部流量而送不出去。這要先和網路組核對，見 [導入 Kubernetes 前要準備什麼](#/skill/k8s-readiness)。

## Service：穩定的位址，背後是 EndpointSlice 與 kube-proxy

`clinic-api` 連資料庫時寫的是 `clinic-db:5432`。這個名字對到一個 Service，Service 有一個固定的 ClusterIP（上面稽核輸出裡的 10.96.212.40）。這個 IP 是虛擬的，不屬於任何 Pod 或節點，封包能送到 Pod 靠的是三個元件：

1. **EndpointSlice controller**：依 Service 的 selector 找出 Pod，把它們的 IP、port 與是否 ready 寫進 EndpointSlice 物件。
2. **kube-proxy**：在每個節點上監看 Service 與 EndpointSlice，把「連到 10.96.212.40:5432 的封包，改寫成某個 ready 的後端 Pod 的 IP 與 targetPort」寫成節點的封包轉送規則（目的位址轉換，DNAT）。
3. **CNI**：把改寫後的封包送到那個 Pod 所在的節點。

```bash
$ kubectl get endpointslices -n clinic -l kubernetes.io/service-name=clinic-db
NAME              ADDRESSTYPE   PORTS   ENDPOINTS     AGE
clinic-db-7xk2p   IPv4          5432    10.244.2.12   9d
```

版本相關的幾件事：EndpointSlice 在 Kubernetes 1.21 成為正式版；舊的 Endpoints API 在 1.33 被標為棄用，直接讀它的腳本會收到警告，排查時改用 `kubectl get endpointslices`。kube-proxy 在 Linux 上的預設模式是 iptables；nftables 模式在 1.33 成為正式版（需要較新的核心），IPVS 模式在 1.35 被標為棄用。Cilium 這類 CNI 也可以完全取代 kube-proxy。叢集用哪一種是建置時的決定，應用程式這一側看不出差別。

這個轉換順序有一個直接的後果：NetworkPolicy 比對的是 Pod（label 與容器的 port），不是 Service。規則裡沒有「允許連到 Service X」這種寫法，port 也要寫容器實際監聽的 port。

### 四種類型

| `type` | 做什麼 | 用在哪 |
|---|---|---|
| `ClusterIP`（預設） | 配一個叢集內的虛擬 IP | 服務之間互相呼叫；Ingress 與 Gateway 的後端 |
| `NodePort` | 在每個節點開同一個 port（預設範圍 30000–32767），轉到 ClusterIP | 讓院內既有的負載平衡設備接進來；測試 |
| `LoadBalancer` | 在 NodePort 之上，再向「某個元件」要一個對外的 IP | 雲端自動建立負載平衡器；地端要有 MetalLB 這類元件 |
| `ExternalName` | 不配 IP，DNS 直接回一筆 CNAME 指向外部名稱 | 給叢集外、有 DNS 名稱的系統一個叢集內的名字 |

另外還有 `clusterIP: None` 的 headless Service：不配虛擬 IP，DNS 直接回每個 Pod 的 IP，StatefulSet 用它給每個副本固定的名字（見 [Kubernetes 儲存](#/skill/k8s-storage)）。

### 叢集內的 DNS

叢集的 DNS（多半是 CoreDNS，跑在 `kube-system`，前面有一個叫 `kube-dns` 的 Service）替每個 Service 建一筆紀錄，完整名稱是：

```text
<service>.<namespace>.svc.cluster.local
clinic-db.clinic.svc.cluster.local      # cluster.local 是預設的叢集網域，可以在建叢集時改
```

Pod 的 `/etc/resolv.conf` 由 kubelet 產生，搜尋清單裡有自己的 namespace，所以同 namespace 寫 `clinic-db` 就好，跨 namespace 寫 `clinic-db.clinic`。預設的 `ndots:5` 會讓 `his-db.example.org` 這種點數少於 5 的外部名稱先依序套上搜尋清單查一輪，每次解析多出幾次查詢；在名稱最後加一個點（`his-db.example.org.`）或調整 Pod 的 `dnsConfig` 可以避開。

DNS 與下一節的 NetworkPolicy 直接相關：每個用名稱連線的 Pod，第一步都是連到 `kube-system` 的 DNS Pod 的 UDP 53（回應太大時改用 TCP 53）。

## 從院內連進叢集：地端沒有雲端的負載平衡器

院內的使用者要連到 `clinic-web`，流量要從叢集外進來。在雲端，`type: LoadBalancer` 會自動建立一個雲端負載平衡器；地端叢集沒有對應的元件，`EXTERNAL-IP` 會一直停在 `<pending>`（[導入 Kubernetes 前要準備什麼](#/skill/k8s-readiness) 有實際輸出）。補上它有兩條路。

**MetalLB**：在叢集裡跑的元件，從一段預先保留的院內 IP 中分配位址給 LoadBalancer 型的 Service，再用 L2 或 BGP 對院內網路宣告「這個 IP 在這裡」。那段 IP 要和網路組協調，不能和 DHCP 或其他設備撞到。

| | L2 模式 | BGP 模式 |
|---|---|---|
| 怎麼宣告 | 由一個節點回應這個 IP 的 ARP | 每個節點和院內路由器建立 BGP 連線，宣告這個 IP |
| 流量 | 某個 Service IP 的流量全部先進到同一個節點，再由 kube-proxy 分到各 Pod | 路由器用 ECMP 把流量分到多個節點 |
| 那個節點故障 | 改由另一個節點接手宣告，中間有短暫中斷 | 路由器移除那條路徑；雜湊重新分配時，部分既有連線可能被重設 |
| 對網路的要求 | 節點與用戶端在同一個 L2 網段就能用，不需要改路由器 | 路由器要支援 BGP 與 ECMP，網路組要配合設定 |

L2 模式提供的是容錯切換，單一 IP 的頻寬上限是一個節點的網卡；要讓流量分散到多個節點，用 BGP 模式。

**院內既有的負載平衡設備接 NodePort**：Service 用 `NodePort`，在院內的負載平衡設備上建一個 pool，成員是每個節點的 IP 加上那個 NodePort，並設定健康檢查。好處是沿用網路組熟悉的設備與憑證管理；代價是節點增減時要去改 pool。

不管哪一條路，都要決定 `externalTrafficPolicy`。預設的 `Cluster` 讓任何節點都能收流量再轉給別的節點上的 Pod，但轉送時會做來源位址轉換，Pod 看到的來源會變成節點的 IP。改成 `Local` 時只有本身跑著這個服務 Pod 的節點會接流量，保留使用者的來源 IP，負載平衡設備的健康檢查要能分辨哪些節點沒有 Pod。

### Ingress 與 Gateway API

對外通常只開一個入口：Ingress controller（或 Gateway API 的實作）用一個 LoadBalancer 或 NodePort 對外，再依 Host 與路徑把 HTTP 流量分給各個 ClusterIP Service，TLS 也在這一層終止。寫法與 Gateway API 的分層見 [Kubernetes 實作：把服務寫成 manifest](#/skill/k8s-manifests)。Kubernetes 社群維護的 ingress-nginx 已在 2026 年 3 月停止維護，之後沒有新版本與安全修補，新的建置要選其他 controller 或 Gateway API 的實作。

## NetworkPolicy：先全擋，再逐條開

### 規則怎麼算

NetworkPolicy（`networking.k8s.io/v1`）的計算方式和一般的防火牆規則不太一樣：

1. **預設全部放行**。沒有任何 policy 選到一個 Pod 時，它進出都不受限制。
2. **一旦有 policy 選到某個 Pod，該方向就變成白名單**。policy 的 `spec.podSelector` 選到 Pod，而 `policyTypes` 含 `Ingress`，這個 Pod 的進入流量就只剩規則明列的能通過；`Egress` 同理。兩個方向分開計算。
3. **規則只有允許，沒有拒絕**。多份 policy 選到同一個 Pod 時取聯集，寫的順序不影響結果。要拒絕某個來源，做法是不把它列進任何一條規則。
4. **一條連線要兩邊都放行**：來源 Pod 的 egress 允許、目的 Pod 的 ingress 也允許。已經建立的連線，回應封包自動放行，不用另外寫規則。
5. 沒寫 `policyTypes` 時，一定包含 `Ingress`，有寫 `egress` 規則才包含 `Egress`。建議永遠明寫。

另外兩件事：NetworkPolicy 擋不了 Pod 所在節點連進來的流量（官方文件列為它做不到的事之一），所以 kubelet 的探針在全擋之後通常照常運作；`ipBlock` 用來寫叢集外的位址，Pod 要用 `podSelector` 選，因為 Pod 的 IP 會變。

### 第一步：全擋

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
  namespace: clinic
spec:
  podSelector: {}          # 空的 selector：選到 clinic 裡的每一個 Pod
  policyTypes:
    - Ingress
    - Egress               # 兩個方向都變成白名單；沒有任何規則，所以全部擋下
```

套用這一份之後，`clinic` 裡的 Pod 什麼都連不出去，也沒有人連得進來。其他 namespace 不受影響：policy 只管它所在 namespace 的 Pod。

### 第二步：放行 DNS

全擋之後最先壞掉的是 DNS。`clinic-api` 連 `clinic-db` 之前要先解析名稱，egress 被擋，查詢送不到 `kube-system` 的 DNS Pod。錯誤訊息看起來像資料庫連不上，原因卻在名稱解析，PostgreSQL 的用戶端會印出類似：

```text
could not translate host name "clinic-db" to address: Temporary failure in name resolution
```

所以 default deny 之後的第一條，固定是放行 DNS：

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
  namespace: clinic
spec:
  podSelector: {}                      # clinic 裡每個 Pod 都要能查 DNS
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:           # 同一個元素裡的兩個條件：kube-system 裡的 DNS Pod
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns        # CoreDNS 常見的 label；依發行版確認
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP                # 回應太大時改用 TCP，兩個都要開
          port: 53
```

`kubernetes.io/metadata.name` 是控制平面自動加在每個 namespace 上的 label（Kubernetes 1.22 起），值就是 namespace 的名字，而且不能改，用來選 namespace 比自己加的 label 可靠。DNS Pod 的 label 依發行版而定，先用 `kubectl get pods -n kube-system --show-labels` 確認。叢集若啟用了 NodeLocal DNSCache，DNS 查詢由節點上的快取接手，規則要另外放行它的位址，寫法依設定而定，以官方文件為準。

### 第三步：一條一條開

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-egress
  namespace: clinic
spec:
  podSelector:
    matchLabels:
      app: clinic-api
  policyTypes:
    - Egress
  egress:
    - to:
        - podSelector:                 # 只寫 podSelector：policy 自己的 namespace（clinic）裡的 Pod
            matchLabels:
              app: clinic-db
      ports:
        - protocol: TCP
          port: 5432
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: db-ingress
  namespace: clinic
spec:
  podSelector:
    matchLabels:
      app: clinic-db
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: clinic-api
      ports:
        - protocol: TCP
          port: 5432
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-ingress
  namespace: clinic
spec:
  podSelector:
    matchLabels:
      app: clinic-api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: clinic-web
      ports:
        - protocol: TCP
          port: 8000                   # 容器監聽的 port，不是 Service 的 80
```

api 連 db 要兩份：api 的 egress 與 db 的 ingress，少一份都不通。`api-ingress` 的 port 是 8000：`clinic-web` 連的是 Service 的 80，但 kube-proxy 改寫之後，送到 Pod 的是 8000，NetworkPolicy 比對的是改寫後的封包。

實作路線的正式環境把 PostgreSQL 留在叢集外的既有主機，那時 `api-egress` 的 `to` 改成資料庫主機的 `ipBlock`，`db-ingress` 就不需要了，寫法和後面連舊系統的那一條相同。

`clinic-web` 本身也被全擋了，Ingress controller 或 Gateway 連不進來，網站會回 504 或 502。它要一條 ingress 規則，`from` 寫 controller 所在的 namespace（再加上 controller Pod 的 label 更精確）。

### namespaceSelector 與 podSelector：同一個元素是 AND，分開是 OR

監控系統的 Prometheus 跑在 `monitoring` namespace，要抓 `clinic-api` 的 `/metrics`。下面兩份只差一個 `-`：

```yaml
# 寫法 A：一個元素，兩個條件同時成立（AND）
#   → 只有 monitoring namespace 裡、label 是 app: prometheus 的 Pod
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: monitoring
          podSelector:
            matchLabels:
              app: prometheus
      ports:
        - protocol: TCP
          port: 8000

# 寫法 B：兩個元素，任一個成立就放行（OR）
#   → monitoring 裡的「所有」Pod，加上 clinic 裡 label 是 app: prometheus 的 Pod
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: monitoring
        - podSelector:
            matchLabels:
              app: prometheus
      ports:
        - protocol: TCP
          port: 8000
```

寫法 B 的第一個元素只有 `namespaceSelector`，選到 `monitoring` 裡的每一個 Pod，包括某人臨時開的除錯 Pod；第二個元素只有 `podSelector`，選的是 policy 自己的 namespace（`clinic`）裡的 Pod。兩份 YAML 都合法，`kubectl apply` 不會提醒；套用前用 `kubectl describe networkpolicy` 看它展開後的說明，或用下一節的程式模擬。

## 用程式模擬：一條連線會不會被放行

下面把上一節的規則寫成一個小型評估器：給定 Pod 的 namespace 與 label、一組 policy，判斷一條連線（來源、目的、協定、port）放不放行，並印出是哪一條規則決定的。selector 只實作 `matchLabels`，其餘照官方文件的語意：

```python run
import ipaddress

# 叢集裡的 Pod（示意）：namespace、label、IP
PODS = {
    "web":   {"ns": "clinic", "labels": {"app": "clinic-web"}, "ip": "10.244.1.10"},
    "api":   {"ns": "clinic", "labels": {"app": "clinic-api"}, "ip": "10.244.1.11"},
    "db":    {"ns": "clinic", "labels": {"app": "clinic-db"}, "ip": "10.244.2.12"},
    "dns":   {"ns": "kube-system", "labels": {"k8s-app": "kube-dns"}, "ip": "10.244.0.5"},
    "prom":  {"ns": "monitoring", "labels": {"app": "prometheus"}, "ip": "10.244.3.20"},
    "shell": {"ns": "monitoring", "labels": {"app": "debug-shell"}, "ip": "10.244.3.21"},
    "job":   {"ns": "reports", "labels": {"app": "report-job"}, "ip": "10.244.2.30"},
}
# namespace 的 label：kubernetes.io/metadata.name 由控制平面自動加上
NS_LABELS = {ns: {"kubernetes.io/metadata.name": ns} for ns in ["clinic", "kube-system", "monitoring", "reports"]}
EXTERNAL = {"informix": "10.20.5.31", "internet": "203.0.113.50"}


def matches(selector, labels):
    """matchLabels：selector 的每一組鍵值，labels 都要有而且相同；空的 selector 選到全部"""
    return all(labels.get(k) == v for k, v in selector.items())


def endpoint(name):
    if name in PODS:
        return {"name": name, "pod": True, **PODS[name]}
    return {"name": name, "pod": False, "ip": EXTERNAL[name]}


def policy_types(p):
    # 沒寫 policyTypes：一定有 Ingress；有 egress 規則才加上 Egress
    return p.get("policyTypes") or (["Ingress"] + (["Egress"] if "egress" in p else []))


def peer_matches(peer, policy_ns, other):
    if "ipBlock" in peer:                       # 叢集外的位址用 ipBlock
        if other["pod"]:
            return False
        ip = ipaddress.ip_address(other["ip"])
        block = peer["ipBlock"]
        return ip in ipaddress.ip_network(block["cidr"]) and not any(
            ip in ipaddress.ip_network(e) for e in block.get("except", []))
    if not other["pod"]:
        return False
    if "namespaceSelector" in peer:
        ns_ok = matches(peer["namespaceSelector"], NS_LABELS[other["ns"]])
    else:
        ns_ok = other["ns"] == policy_ns        # 只寫 podSelector：只看 policy 自己的 namespace
    pod_ok = matches(peer.get("podSelector", {}), other["labels"])
    return ns_ok and pod_ok                     # 同一個元素裡的兩個條件是 AND


def ports_match(rule, proto, port):
    ports = rule.get("ports")
    if not ports:                               # 沒寫 ports：全部的 port
        return True
    return any(p.get("protocol", "TCP") == proto and p.get("port") in (None, port) for p in ports)


def direction_allowed(direction, pod, other, proto, port, policies):
    """pod 是被這個方向管的那一端；回傳 (放行與否, 原因)"""
    selecting = [p for p in policies
                 if p["ns"] == pod["ns"] and matches(p["podSelector"], pod["labels"])
                 and direction in policy_types(p)]
    if not selecting:
        return True, "沒有 policy 選到"
    key, side = ("ingress", "from") if direction == "Ingress" else ("egress", "to")
    for p in selecting:
        for i, rule in enumerate(p.get(key, []), 1):
            peers = rule.get(side)
            peer_ok = not peers or any(peer_matches(x, p["ns"], other) for x in peers)   # 元素之間是 OR
            if peer_ok and ports_match(rule, proto, port):
                return True, f"{p['name']} 第 {i} 條"
    return False, "被 " + "、".join(p["name"] for p in selecting) + " 選到，沒有規則放行"


def check(src, dst, port, policies, proto="TCP"):
    s, d = endpoint(src), endpoint(dst)
    out_ok, out_why = direction_allowed("Egress", s, d, proto, port, policies) if s["pod"] else (True, "叢集外")
    in_ok, in_why = direction_allowed("Ingress", d, s, proto, port, policies) if d["pod"] else (True, "叢集外")
    mark = "放行" if out_ok and in_ok else "擋下"
    print(f"  {src:>5} → {dst:<8} {proto}/{port:<5} {mark}  出：{out_why}；進：{in_why}")


DEFAULT_DENY = {"name": "default-deny", "ns": "clinic", "podSelector": {}, "policyTypes": ["Ingress", "Egress"]}
API_TO_DB = {"name": "api-egress", "ns": "clinic", "podSelector": {"app": "clinic-api"}, "policyTypes": ["Egress"],
             "egress": [{"to": [{"podSelector": {"app": "clinic-db"}}], "ports": [{"port": 5432}]}]}
DB_FROM_API = {"name": "db-ingress", "ns": "clinic", "podSelector": {"app": "clinic-db"}, "policyTypes": ["Ingress"],
               "ingress": [{"from": [{"podSelector": {"app": "clinic-api"}}], "ports": [{"port": 5432}]}]}
ALLOW_DNS = {"name": "allow-dns", "ns": "clinic", "podSelector": {}, "policyTypes": ["Egress"],
             "egress": [{"to": [{"namespaceSelector": {"kubernetes.io/metadata.name": "kube-system"},
                                 "podSelector": {"k8s-app": "kube-dns"}}],
                         "ports": [{"protocol": "UDP", "port": 53}, {"protocol": "TCP", "port": 53}]}]}
# 讓 monitoring 的 Prometheus 抓 api 的指標：同一個元素（AND）與分成兩個元素（OR）
SCRAPE_AND = {"name": "scrape-and", "ns": "clinic", "podSelector": {"app": "clinic-api"}, "policyTypes": ["Ingress"],
              "ingress": [{"from": [{"namespaceSelector": {"kubernetes.io/metadata.name": "monitoring"},
                                     "podSelector": {"app": "prometheus"}}], "ports": [{"port": 8000}]}]}
SCRAPE_OR = {"name": "scrape-or", "ns": "clinic", "podSelector": {"app": "clinic-api"}, "policyTypes": ["Ingress"],
             "ingress": [{"from": [{"namespaceSelector": {"kubernetes.io/metadata.name": "monitoring"}},
                                   {"podSelector": {"app": "prometheus"}}], "ports": [{"port": 8000}]}]}
API_TO_HIS = {"name": "api-to-his", "ns": "clinic", "podSelector": {"app": "clinic-api"}, "policyTypes": ["Egress"],
              "egress": [{"to": [{"ipBlock": {"cidr": "10.20.5.31/32"}}], "ports": [{"port": 9088}]}]}

print("① 沒有任何 policy：全部互通")
check("job", "db", 5432, [])
check("api", "internet", 443, [])

print("\n② 只加 default-deny：clinic 裡的 Pod 進出都擋")
check("api", "db", 5432, [DEFAULT_DENY])
check("job", "db", 5432, [DEFAULT_DENY])

print("\n③ 開了 api → db，忘了 DNS")
step3 = [DEFAULT_DENY, API_TO_DB, DB_FROM_API]
check("api", "db", 5432, step3)
check("api", "dns", 53, step3, proto="UDP")
check("web", "db", 5432, step3)

print("\n④ 補上 allow-dns")
step4 = step3 + [ALLOW_DNS]
check("api", "dns", 53, step4, proto="UDP")
check("api", "internet", 53, step4, proto="UDP")

print("\n⑤ namespaceSelector 與 podSelector：同一個元素（AND）")
check("prom", "api", 8000, step4 + [SCRAPE_AND])
check("shell", "api", 8000, step4 + [SCRAPE_AND])
print("   分成兩個元素（OR）")
check("shell", "api", 8000, step4 + [SCRAPE_OR])

print("\n⑥ api → 叢集外的 Informix")
check("api", "informix", 9088, step4)
check("api", "informix", 9088, step4 + [API_TO_HIS])
```

幾個要看的地方：② 的 `job → db` 是「出」放行、「進」擋下，`reports` 沒有任何 policy，擋下它的是 `db` 這一端的 ingress。③ 的 api 連得到 db 的 IP，但實際的程式要先查 DNS，那一行是擋下，所以使用者看到的是名稱解析失敗。⑤ 的除錯 Pod 在 AND 寫法下被擋、在 OR 寫法下放行。⑥ 只代表叢集這一側放行了，封包出了叢集還要過舊系統的防火牆，那是下一節的事。

## 連到叢集外：舊系統看到的是節點的 IP

### 為什麼舊系統的防火牆擋掉了 API

前面說 Pod 之間不做 NAT。Pod 連到叢集外的位址時就不一樣了：Pod 網段是叢集自己的位址，院內的路由器不知道 10.244.1.11 在哪裡，回應送不回來。所以多數 CNI 預設在封包離開節點時做來源位址轉換（SNAT，也叫 masquerade），把來源改成節點的 IP：

```text
clinic-api（Pod 10.244.1.11，在節點 10.20.30.11 上）
   │  src 10.244.1.11  →  dst 10.20.5.31:9088
   ▼
節點 10.20.30.11：離開叢集，SNAT
   │  src 10.20.30.11  →  dst 10.20.5.31:9088
   ▼
舊系統防火牆：只放行 10.20.8.15  →  丟掉封包（用戶端看到逾時，不是連線被拒絕）
```

API 的 Pod 被排到哪個節點，來源就是哪個節點的 IP。今天在 10.20.30.11，重啟後可能到 10.20.30.13。防火牆紀錄裡出現兩個節點的位址，是因為兩個副本分別在兩個節點上。

例外是 CNI 用 BGP 把 Pod 網段直接發布給院內路由器、並關掉 SNAT 的架構：這時舊系統看到的是 Pod IP，但 Pod IP 每次重建都會變，防火牆一樣跟不上。

### 防火牆要放行誰

| 做法 | 防火牆規則 | 節點增減時 | 要注意的事 |
|---|---|---|---|
| 放行每一台 worker 節點的 IP | 逐台列出 | 每次都要申請變更；漏了就會出現「有時候連得到」 | 節點上的任何 Pod 都在放行範圍內 |
| 節點放在專用網段，放行整段 | 一條 CIDR | 新節點用同一段位址就不必改 | 範圍更大，叢集內要用 NetworkPolicy 限縮哪些 Pod 能連 |
| 專用節點（taint 加 nodeSelector），只放行這幾台 | 少數幾台 | 只有這組節點變動時要改 | 需要連舊系統的服務只能排到這幾台，容量要另外規劃 |
| egress gateway：指定的 Pod 從固定的出口 IP 出去 | 一個或一組出口 IP | 不受 worker 增減影響 | 要 CNI 支援；出口節點本身要做高可用 |

egress gateway 是部分 CNI 或平台提供的功能，例如 Cilium 的 Egress Gateway、Antrea 的 Egress、OpenShift 的 EgressIP；Calico 的 egress gateway 屬於商業版本。可用的版本、授權與高可用的做法以各專案文件為準。

不論選哪一種，防火牆與 NetworkPolicy 管的是兩件事：防火牆決定院內網路上「哪些 IP」能連 Informix；NetworkPolicy 決定叢集裡「哪些 Pod」能從那些 IP 出去。只做前者時，放行了節點的 IP，同一個節點上的任何 Pod（包括稽核找到的那種）也連得到 Informix。

所以 `clinic` 維持 default deny，只給 `clinic-api` 加一條 egress。別的 namespace 要有自己的 default deny egress，`clinic` 的 policy 管不到它們；叢集管理者通常在建立 namespace 時一起建立，或用 CNI 提供的叢集層級政策。給 `clinic-api` 的那一條：

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-to-his
  namespace: clinic
spec:
  podSelector:
    matchLabels:
      app: clinic-api
  policyTypes:
    - Egress
  egress:
    - to:
        - ipBlock:
            cidr: 10.20.5.31/32        # 叢集外的位址用 ipBlock
      ports:
        - protocol: TCP
          port: 9088
```

申請防火牆規則時，來源寫節點網段（或出口 IP）、目的寫 10.20.5.31、port 寫 TCP 9088，並附上叢集內用 NetworkPolicy 限制哪些服務能用這條路的說明。申請單的寫法見 [網路通不通：從 DNS 到防火牆](#/skill/network-troubleshooting)。

### 給叢集外的系統一個叢集內的名字

程式裡寫死 `10.20.5.31`，Informix 換主機時每個服務都要改設定。可以在叢集裡建一個沒有 selector 的 Service，再自己寫 EndpointSlice 指向外部位址：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: his-db
  namespace: clinic
spec:                        # 沒有 selector：controller 不會替它產生 EndpointSlice
  ports:
    - name: informix
      protocol: TCP
      port: 9088
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: his-db-1
  namespace: clinic
  labels:
    kubernetes.io/service-name: his-db                    # 對到上面的 Service
    endpointslice.kubernetes.io/managed-by: cluster-admins  # 標明這份是人管的，不是 controller
addressType: IPv4
ports:
  - name: informix           # 要和 Service 的 port 名稱相同
    protocol: TCP
    port: 9088
endpoints:
  - addresses:
      - "10.20.5.31"
```

程式改連 `his-db.clinic:9088`，舊系統搬家時只改這份 EndpointSlice。kube-proxy 會把 ClusterIP 改寫成 10.20.5.31，多數 CNI 在這個改寫之後才比對 NetworkPolicy，所以上面那條 `ipBlock` 要寫 Informix 的實際 IP。

舊系統本來就有 DNS 名稱時，可以用 `ExternalName`：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: his-api
  namespace: clinic
spec:
  type: ExternalName
  externalName: his-api.example.org     # 叢集 DNS 對 his-api.clinic 回一筆 CNAME
```

它只是一筆 DNS 的 CNAME，沒有虛擬 IP、也沒有 port 對應。用在 HTTPS 時要小心：程式連的是 `https://his-api`，TLS 的 SNI 與 HTTP 的 Host 標頭都會帶 `his-api`，對方的憑證上只有 `his-api.example.org`，驗證會失敗。HTTPS 的服務直接用對方的正式名稱連線，比繞一層 ExternalName 單純。

| | 無 selector 的 Service 加 EndpointSlice | ExternalName |
|---|---|---|
| 指向 | IP 位址 | DNS 名稱 |
| 有沒有 ClusterIP 與 port 對應 | 有 | 沒有，只是 CNAME |
| 對方換位址時 | 改 EndpointSlice | 對方改自己的 DNS 就好 |
| HTTPS | 憑證要涵蓋程式使用的名稱 | 憑證通常對不上叢集內的名稱 |

### 院內 CA 簽的憑證

舊系統另有一個 HTTPS 的查詢 API，憑證由院內 CA 簽發。院內電腦透過網域派送了根憑證，但容器不會繼承節點或網域電腦的信任清單：

```text
requests.exceptions.SSLError: HTTPSConnectionPool(host='his-api.example.org', port=443): Max retries exceeded ...
(Caused by SSLError(SSLCertVerificationError(1, '[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate (_ssl.c:1006)')))
```

兩種做法：建 image 時把根憑證裝進去（Dockerfile 的寫法見 [HTTPS 憑證](#/skill/https-certificates)），或在執行時從 ConfigMap 掛進來，再用環境變數告訴程式去哪裡找：

```yaml
      containers:
        - name: api
          env:
            - name: SSL_CERT_FILE              # Python 的 ssl 模組（OpenSSL）讀這個
              value: /etc/hospital-ca/ca-bundle.crt
            - name: REQUESTS_CA_BUNDLE         # requests 預設用 certifi 內附的清單，要另外指定
              value: /etc/hospital-ca/ca-bundle.crt
          volumeMounts:
            - name: hospital-ca
              mountPath: /etc/hospital-ca
              readOnly: true
      volumes:
        - name: hospital-ca
          configMap:
            name: hospital-ca-bundle           # 院內根憑證加上公開 CA 的完整清單
```

這個檔案要包含公開 CA 加上院內 CA 的完整清單；只放院內根憑證時，程式改用這個檔案後就不再信任公開網站。拉 image 的信任設定在節點上，和這裡是兩件事（見 [導入 Kubernetes 前要準備什麼](#/skill/k8s-readiness)）。namespace 多了以後，cert-manager 專案的 trust-manager 可以把同一份 CA 清單同步到各個 namespace。

## 雲端代管的差異

| 項目 | 地端自建 | 雲端代管（EKS、GKE、AKS 等） |
|---|---|---|
| `type: LoadBalancer` | MetalLB，或院內設備接 NodePort | 自動建立雲端負載平衡器 |
| Pod 的 IP | CNI 自己的網段，出叢集多半 SNAT 成節點 IP | 有些服務讓 Pod 直接拿虛擬網路裡的 IP |
| 固定的出口 IP | 節點網段、專用節點或 egress gateway | 雲端的 NAT 閘道之類的服務 |
| NetworkPolicy | 看選的 CNI | 有些要另外啟用或選特定的網路模式，以各服務文件為準 |
| 連院內舊系統 | 同一個院內網路，主要是防火牆 | 還要先有專線或 VPN，見 [地端、雲端還是混合雲](#/skill/hosting-models) |

## 常見錯誤與錯誤訊息

| 訊息或現象 | 原因 | 處理 |
|---|---|---|
| 套用 default deny 後，程式報 `Temporary failure in name resolution` 或 `could not translate host name` | egress 全擋，DNS 查詢送不出去 | 加 `allow-dns`：UDP 與 TCP 53，到 `kube-system` 的 DNS Pod |
| 寫了 NetworkPolicy，`kubectl get networkpolicy` 也列得出來，但流量完全不受影響 | CNI 不實作 NetworkPolicy；或 `podSelector` 的 label 打錯，什麼都沒選到 | 確認 CNI；`kubectl describe networkpolicy` 看它選了哪些 Pod，再用 `kubectl get pods -l <selector>` 對照 |
| 套用 default deny 後，網站經過 Ingress 回 504 或 502 | Ingress controller 連不進 web | 給 web 一條 ingress，`from` 寫 controller 的 namespace |
| 開了 web → api 的 80，還是逾時 | NetworkPolicy 比對的是容器的 port（8000） | port 改成容器的 port，或寫容器 port 的名稱 |
| 稽核發現 `monitoring` 裡任何 Pod 都連得到 api | `namespaceSelector` 與 `podSelector` 被寫成兩個元素（OR） | 合併成同一個元素（AND） |
| Pod 連叢集外的系統 `connection timed out`，從節點上 `nc -vz` 也逾時 | 對方防火牆擋掉節點的 IP | 依前面的表選放行方式，向網路組申請 |
| 同樣的連線，從節點上通、從 Pod 裡逾時 | 叢集內的 egress policy 擋住，或 CNI 的 SNAT 設定與預期不同 | 檢查這個 Pod 的 egress 規則；查 CNI 的 masquerade 設定 |
| 加了新節點後，部分請求連舊系統逾時 | 新節點的 IP 不在防火牆規則裡，排到新節點的 Pod 才會失敗 | 節點改用固定網段，或把加節點的流程加上防火牆變更 |
| `EXTERNAL-IP` 一直是 `<pending>` | 叢集沒有實作 LoadBalancer 的元件 | 裝 MetalLB，或改用 NodePort 接院內的負載平衡設備 |
| `CERTIFICATE_VERIFY_FAILED`、`unable to get local issuer certificate` | 容器不信任院內 CA | 把根憑證裝進 image，或掛載 CA 清單並設定 `SSL_CERT_FILE` 與 `REQUESTS_CA_BUNDLE` |
| 經過 ExternalName 連 HTTPS，出現 `Hostname mismatch` | 憑證上沒有程式使用的名稱 | 直接連對方的正式名稱 |

排查時先分清楚是「被擋」還是「沒人在聽」：NetworkPolicy 與防火牆通常丟掉封包，用戶端看到的是逾時；連線被拒絕（connection refused）代表封包到了，但那個 port 上沒有程式。更完整的排查順序見 [Kubernetes 排錯](#/skill/k8s-troubleshooting)。

## 動手

1. 執行上面的模擬，自己加兩個情境：把 `ALLOW_DNS` 的 TCP 那一筆刪掉，測 `check("api", "dns", 53, …, proto="TCP")`；把 `DB_FROM_API` 的 `from` 改成 `[{"namespaceSelector": {}}]`（空的 selector 選到所有 namespace），看 `job → db` 的結果怎麼變（稽核那張單的情況）。先預測再執行。
2. 做本課的程式題：補一組 NetworkPolicy，讓 api 只連得到 db 的 5432 與 DNS；選做的 Python 題是實作評估器裡比對來源與 namespace 的那一段。
3. 到 [NetworkPolicy 實驗室](#/lab/NetworkPolicyLab) 加減 policy，播放「api 查 DNS」「可疑 Pod → db」「api → 舊系統」等連線，看每一條是哪一條規則決定的。
4. 在本機叢集上看 SNAT。叢集照 [clinic-api 的本機叢集指南](https://github.com/yo02741/Backend-Atlas/blob/main/companion/clinic-api/docs/local-k8s.md) 建好，在本機用 `python3 -m http.server 9000` 起一個伺服器，從 Pod 連過去（`wget -qO- http://<本機位址>:9000/`；kind 的本機位址可以用 `docker network inspect kind` 找閘道）。伺服器的 log 印出的來源位址是節點的位址，拿去和 `kubectl get pod -o wide` 列出的 Pod IP 對照。
5. 在同一個叢集驗證 CNI 有沒有執行 NetworkPolicy（`clinic` namespace 裡已經跑著 clinic-api）。本機叢集工具的預設 CNI 不一定實作 NetworkPolicy，依工具與版本而定：

```bash
kubectl apply -f default-deny.yaml                     # 上面第一步那份（namespace: clinic）
kubectl run probe -n clinic --rm -it --image=busybox:1.36 -- nslookup kubernetes.default
# 預期：逾時（;; connection timed out; no servers could be reached）
# 如果還查得到：這個 CNI 沒有執行 NetworkPolicy，換成有實作的 CNI（例如 Calico 或 Cilium，安裝方式見各專案文件）再試
kubectl apply -f allow-dns.yaml
kubectl run probe -n clinic --rm -it --image=busybox:1.36 -- nslookup kubernetes.default
# 預期：查得到 kubernetes.default.svc.cluster.local（Address 是 Service 網段的第一個位址，例如 10.96.0.1）
kubectl delete -f allow-dns.yaml -f default-deny.yaml  # 做完刪掉，否則 clinic-api 之後建立的新連線都會被擋
```

叢集裡的權限與 namespace 怎麼分給各團隊，接著讀 [Kubernetes 權限與多租戶](#/skill/k8s-rbac-tenancy)。

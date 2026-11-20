// 領域內文（d9-devops，n1 批）：以技能 id 為 key，由 body/d9-devops.js 合併。只放這些技能：k8s-networking
export default {
  'k8s-networking': {
    map: {
      names: [
        { n: 'Pod IP 與 CNI', t: '每個 Pod 有自己的 IP、預設全部互通；CNI 負責網路，Flannel 不實作 NetworkPolicy，Calico、Cilium 有。' },
        { n: 'Service', t: 'ClusterIP 給叢集內、NodePort 給外部設備接、LoadBalancer 要有元件配發 IP；後面是 EndpointSlice。' },
        { n: 'EndpointSlice', t: 'Service 實際選到的 Pod 位址與是否 ready；空的代表 selector 對不上或 Pod 沒 ready。' },
        { n: '叢集 DNS', t: '`<svc>.<ns>.svc.cluster.local`；全擋 egress 之後第一個要開的就是 DNS。' },
        { n: 'NetworkPolicy', t: '被 policy 選到的 Pod，該方向變成白名單；一條連線要來源的 egress 與目的的 ingress 都放行。' },
        { n: 'namespaceSelector 與 podSelector', t: '寫在同一個 `-` 底下是 AND，分成兩個 `-` 是 OR。' },
        { n: 'SNAT 與 egress gateway', t: 'Pod 連到叢集外時，對方多半看到節點的 IP；要固定出口時用專用節點或 egress gateway。' },
        { n: 'MetalLB', t: '地端替 `type: LoadBalancer` 從保留的院內 IP 配發位址，L2 或 BGP 模式。' },
      ],
      ask: [
        '哪些 Pod 要連哪些 Pod、port 與協定。',
        '全擋之後的白名單，包含放行 DNS 的那一條。',
        '院內怎麼連進叢集：LoadBalancer 的 IP、NodePort，還是既有的負載平衡設備。',
        '要連的叢集外系統，以及對方防火牆要放行哪個來源 IP、節點增減時誰更新。',
        'CNI 有沒有實作 NetworkPolicy，Pod 與 Service 網段會不會和院內網段重疊。',
      ],
      prompt: 'namespace `clinic` 有 web、api、db 三個服務。要一組 NetworkPolicy：先對進出兩個方向 default deny，再放行所有 Pod 到 kube-system 的 DNS（UDP 與 TCP 53）、web 到 api 的 8000、api 到 db 的 5432，以及 api 到院內 Informix（10.30.5.20:9088）的 egress。另外附一份給網路組的放行申請：Informix 那端放行的來源是節點網段 10.40.0.0/24，節點增減時由平台組通知更新。',
      verify: [
        { c: 'CNI 有沒有實作', t: '套用 default deny 後從 web 連 db 應該逾時；還連得到代表 CNI（例如只裝 Flannel）沒有實作 NetworkPolicy。' },
        { c: 'DNS', t: '`kubectl exec` 進 api 查 `db` 的名字；全擋 egress 後名稱解析失敗，是少了放行 53 的那一條。' },
        { c: '兩端都要放行', t: '只寫了 db 的 ingress、沒寫 api 的 egress 時，api 一樣連不到。' },
        { c: 'AND 與 OR', t: 'AI 產生的規則常把 namespaceSelector 與 podSelector 拆成兩個 `-`，變成 OR，放行範圍比要求的大。' },
        { c: '叢集外看到的來源', t: '從 Pod 連到叢集外的測試伺服器，對方 log 的來源是節點 IP；拿 `kubectl get pod -o wide` 的 Pod IP 去申請防火牆是錯的。' },
        { c: '先排除 Service', t: '`kubectl get endpointslices -n clinic -l kubernetes.io/service-name=api` 沒有位址時，問題在 selector 或 readiness，不在 NetworkPolicy。' },
      ],
    },
    points: [
      { b: '每個 Pod 一個 IP，預設全部互通', t: 'Pod 之間直接用 Pod IP 互連、不做 NAT，任何 namespace 的 Pod 都連得到別的 namespace，包括資料庫。實作這件事的是 CNI：Flannel 只負責互通、不實作 NetworkPolicy；Calico 與 Cilium 都實作。Pod 網段與 Service 網段不能和院內既有網段重疊。' },
      { b: 'Service 是虛擬 IP，背後是 EndpointSlice 與 kube-proxy', t: 'EndpointSlice 記錄 selector 選到的 Pod 與是否 ready，kube-proxy 在每個節點把 ClusterIP 改寫成某個 ready 的 Pod IP 與 targetPort。四種類型：ClusterIP 給叢集內、NodePort 給外部設備接、LoadBalancer 要有元件配 IP、ExternalName 只是 DNS 的 CNAME。名稱格式是 `<svc>.<ns>.svc.cluster.local`。' },
      { b: '地端的 LoadBalancer 要自己補', t: '沒有元件時 `EXTERNAL-IP` 一直是 pending。MetalLB 從保留的院內 IP 配位址：L2 模式由一個節點回應 ARP，提供容錯切換；BGP 模式靠路由器的 ECMP 分散到多個節點，要網路組配合。另一條路是院內既有的負載平衡設備接每個節點的 NodePort。' },
      { b: 'NetworkPolicy：先全擋，DNS 第一個開', t: '有 policy 選到 Pod，該方向就變成白名單；規則只有允許、取聯集，一條連線要來源的 egress 與目的的 ingress 都放行。全擋 egress 後先放行 UDP 與 TCP 53 到 kube-system 的 DNS Pod，否則錯誤會是名稱解析失敗。規則的 port 寫容器監聽的 port。' },
      { b: '連到叢集外：對方看到的是節點的 IP', t: 'Pod 出叢集時來源多半被 SNAT 成所在節點的 IP，舊系統的防火牆要放行節點網段、專用節點或 egress gateway 的出口 IP，節點增減要納入流程。叢集內再用 ipBlock 限定哪些 Pod 能出去。無 selector 的 Service 加 EndpointSlice 給外部系統一個叢集內的名字；院內 CA 的根憑證要讓容器信任。' },
    ],
    checklist: [
      '能替一個 namespace 寫出 default deny、放行 DNS、放行 api 到 db 的一組 NetworkPolicy，並說明少了 DNS 那一條時程式會印出什麼錯誤',
      '看到 namespaceSelector 與 podSelector 的寫法，能分辨是同一個元素（AND）還是兩個元素（OR），並說出各自放行了哪些 Pod',
      '能說明 Pod 連到院內舊系統時對方看到的來源 IP 是什麼，並比較放行節點網段、專用節點與 egress gateway 在節點增減時要做什麼',
    ],
    challenge: {
      task: '對應深入內容的三個停靠點交三份故障紀錄，前兩份在 [NetworkPolicy 放行或擋下](#/lab/NetworkPolicyLab) 做。叢集內：開 default deny 但不放行 DNS，記下 api 連 db 失敗的樣子與擋在哪一端。邊界：加回 DNS 與 api 到 db 的規則，讓可疑 Pod 去連 db，記下由哪一條規則決定結果。院內：讓 api 連叢集外的 Informix，寫下對方防火牆看到的來源。最後做 [替 clinic namespace 補一組 NetworkPolicy](#/exercise/k8s-networking-1)。',
      deliver: '三份故障紀錄，每份寫出症狀、在哪一端被擋或被改寫、證據與修正',
      check: [
        '叢集內那份指出錯誤是名稱解析失敗，不是 db 拒絕連線',
        '邊界那份寫出一條連線要來源的 egress 與目的的 ingress 都放行',
        '院內那份寫出對方看到的是節點（或出口閘道）的 IP，並列出節點增減時要更新什麼',
        '每份紀錄的修正只改一個地方',
      ],
      twist: '院內網路組說「只能放行一個固定 IP」。先預測放行節點網段、專用節點、egress gateway 三種做法哪一種還可行、要多付出什麼，再改寫第三份紀錄的修正。',
    },
    refs: [
      { label: 'Kubernetes：Network Policies', url: 'https://kubernetes.io/docs/concepts/services-networking/network-policies/' },
      { label: 'Kubernetes：Service', url: 'https://kubernetes.io/docs/concepts/services-networking/service/' },
      { label: 'Kubernetes：EndpointSlices', url: 'https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/' },
      { label: 'Kubernetes：DNS for Services and Pods', url: 'https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/' },
      { label: 'Kubernetes：Cluster Networking', url: 'https://kubernetes.io/docs/concepts/cluster-administration/networking/' },
      { label: 'Kubernetes：Virtual IPs and Service Proxies', url: 'https://kubernetes.io/docs/reference/networking/virtual-ips/' },
      { label: 'MetalLB：Concepts', url: 'https://metallb.io/concepts/' },
    ],
  },
}

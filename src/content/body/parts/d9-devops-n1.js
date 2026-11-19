// 領域內文（d9-devops，n1 批）：以技能 id 為 key，由 body/d9-devops.js 合併。只放這些技能：k8s-networking
export default {
  'k8s-networking': {
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

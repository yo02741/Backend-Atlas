// 題庫：P11 新課（n1 批）：k8s-networking
export default [
  {
    skill: 'k8s-networking',
    questions: [
      {
        q: '`clinic` namespace 套用了「default deny（Ingress 與 Egress）」與「api 到 db 的 5432」兩組 NetworkPolicy 之後，`clinic-api` 開始印出 `could not translate host name "clinic-db" to address`。最可能的原因是什麼？',
        options: [
          'db 的 ingress 規則沒有放行 api，PostgreSQL 拒絕了這條連線',
          'egress 全擋之後沒有放行 DNS，名稱查詢送不到 kube-system 的 DNS Pod',
          'NetworkPolicy 套用後會移除 Service 的 DNS 紀錄，要改用 Pod IP 連線',
          'CNI 不實作 NetworkPolicy，套用時把 Pod 的 DNS 設定重置了',
        ],
        answer: 1,
        explain: '錯誤發生在解析名稱這一步，連線根本還沒開始。default deny 的 Egress 讓 api 連 kube-system 的 DNS Pod（UDP 與 TCP 53）也被擋下，所以 default deny 之後第一條要開 DNS。db 的 ingress 沒開的話，名稱解析得到、連線會逾時；NetworkPolicy 不會動 DNS 紀錄；CNI 不實作 NetworkPolicy 時規則沒有效果，也就不會出現這個錯誤。',
      },
      {
        q: '下面這份 NetworkPolicy 建在 `clinic` namespace。哪些 Pod 能連到 `clinic-api` 的 8000？',
        code: 'apiVersion: networking.k8s.io/v1\nkind: NetworkPolicy\nmetadata:\n  name: api-scrape\n  namespace: clinic\nspec:\n  podSelector:\n    matchLabels:\n      app: clinic-api\n  policyTypes: [Ingress]\n  ingress:\n    - from:\n        - namespaceSelector:\n            matchLabels:\n              kubernetes.io/metadata.name: monitoring\n        - podSelector:\n            matchLabels:\n              app: prometheus\n      ports:\n        - protocol: TCP\n          port: 8000',
        lang: 'yaml',
        options: [
          '只有 monitoring namespace 裡、label 是 app: prometheus 的 Pod',
          '任何 namespace 裡 label 是 app: prometheus 的 Pod，加上 monitoring 裡的所有 Pod',
          'monitoring 裡的所有 Pod，加上 clinic 裡 label 是 app: prometheus 的 Pod',
          '沒有任何 Pod，因為一個 Pod 不可能同時符合兩個條件',
        ],
        answer: 2,
        explain: '`from` 底下有兩個元素（兩個 `-`），彼此是 OR。第一個只有 namespaceSelector，選到 monitoring 裡的每一個 Pod；第二個只有 podSelector，範圍是 policy 自己的 namespace（clinic），不是所有 namespace。要「只有 monitoring 裡的 Prometheus」，兩個條件要寫在同一個元素裡（AND）。',
      },
      {
        q: '`clinic-api` 連院內 Informix 逾時，舊系統的防火牆只放行舊主機的 IP。叢集有三台 worker 節點，明年還會加節點。網路組問來源要放行什麼，哪個做法最合適？',
        options: [
          '節點用固定網段並放行整段（或用 egress gateway 的出口 IP），叢集內再用 NetworkPolicy 限定只有 clinic-api 能連',
          '放行 Pod 網段 10.244.0.0/16：Pod 之間不做 NAT，送到 Informix 的封包來源就是 Pod IP',
          '放行 clinic-api 這個 Service 的 ClusterIP：Service 的位址固定，Pod 重建也不會改變',
          '逐台放行目前三台節點的 IP；之後新加入的節點會沿用叢集既有的規則，不必再申請',
        ],
        answer: 0,
        explain: 'Pod 連出叢集時，多數 CNI 會把來源 SNAT 成所在節點的 IP，所以防火牆看到的是節點；用固定網段或 egress gateway 才不會每加一台節點就要改規則。只放行節點時，同一節點上的任何 Pod 都連得到，所以叢集內要再用 NetworkPolicy 限縮。「Pod 之間不做 NAT」只適用於叢集內；ClusterIP 是叢集內的虛擬位址，不是連出去的來源；新節點的 IP 不會自動出現在院內防火牆上。',
      },
    ],
  },
]

// 程式題：p11-n1（k8s-networking）
// 設定檔題的測試碼是 JS：使用者內容是 `source`，`lines` 是去掉 # 註解與空行的各行。
// 測試碼用 String.raw 寫；測試碼裡不要出現 `${` 與反引號。
const R = String.raw

// 夠用的 YAML 子集解析：多份文件（---）、區塊式與單行 flow 式（{…}、[…]）的對應與清單、引號。
// docs() 回傳每份文件解析後的物件；純量一律是字串（數字用 Number() 轉）。
const YAML = R`
function stripQ(s) {
  s = s.trim()
  const m = /^(["'])(.*)\1$/.exec(s)
  return m ? m[2] : s
}
function splitTop(s) {
  const out = []
  let depth = 0, q = null, cur = ''
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue }
    if (ch === '{' || ch === '[') depth++
    if (ch === '}' || ch === ']') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}
function scalar(s) {
  s = s.trim()
  if (s.startsWith('{') && s.endsWith('}')) {
    const o = {}
    for (const part of splitTop(s.slice(1, -1))) {
      const i = part.indexOf(':')
      if (i < 0) continue
      o[stripQ(part.slice(0, i))] = scalar(part.slice(i + 1))
    }
    return o
  }
  if (s.startsWith('[') && s.endsWith(']')) return splitTop(s.slice(1, -1)).map(scalar)
  return stripQ(s)
}
const KV = /^("[^"]*"|'[^']*'|[^:\s][^:]*?)\s*:(?:\s+(.*))?$/
const isItem = (t) => /^-(\s|$)/.test(t)
function parseBlock(ls, pos, indent) {
  if (isItem(ls[pos].text)) {
    const arr = []
    while (pos < ls.length && ls[pos].indent === indent && isItem(ls[pos].text)) {
      const rest = ls[pos].text.slice(1)
      const inner = rest.trim()
      if (!inner) {
        pos++
        if (pos < ls.length && ls[pos].indent > indent) { const r = parseBlock(ls, pos, ls[pos].indent); arr.push(r[0]); pos = r[1] }
        else arr.push(null)
      } else if (!/^[{\["']/.test(inner) && KV.test(inner)) {
        const innerIndent = indent + 1 + (rest.length - rest.trimStart().length)
        ls[pos] = { indent: innerIndent, text: inner }
        const r = parseBlock(ls, pos, innerIndent); arr.push(r[0]); pos = r[1]
      } else { arr.push(scalar(inner)); pos++ }
    }
    return [arr, pos]
  }
  const obj = {}
  while (pos < ls.length && ls[pos].indent === indent && !isItem(ls[pos].text)) {
    const m = KV.exec(ls[pos].text)
    if (!m) throw new Error('看不懂這一行：' + ls[pos].text)
    const key = stripQ(m[1])
    const val = (m[2] || '').trim()
    pos++
    if (!val) {
      const next = ls[pos]
      if (next && (next.indent > indent || (next.indent === indent && isItem(next.text)))) { const r = parseBlock(ls, pos, next.indent); obj[key] = r[0]; pos = r[1] }
      else obj[key] = null
    } else if (/^[|>][+-]?$/.test(val)) {
      const buf = []
      while (pos < ls.length && ls[pos].indent > indent) buf.push(ls[pos++].text)
      obj[key] = buf.join('\n')
    } else obj[key] = scalar(val)
  }
  return [obj, pos]
}
function docs() {
  const out = []
  let cur = []
  const flush = () => {
    if (!cur.length) return
    const ls = cur.map((l) => {
      if (/^\s*\t/.test(l)) throw new Error('YAML 的縮排不能用 Tab')
      return { indent: l.match(/^ */)[0].length, text: l.trim() }
    })
    const r = parseBlock(ls, 0, ls[0].indent)
    if (r[1] < ls.length) throw new Error('縮排不一致，在這一行附近：' + ls[r[1]].text)
    out.push(r[0])
    cur = []
  }
  for (const l of lines) { if (/^---\s*$/.test(l)) flush(); else if (!/^\.\.\.\s*$/.test(l)) cur.push(l) }
  flush()
  return out
}
function load() {
  try { return docs().filter((d) => d && typeof d === 'object' && !Array.isArray(d)) }
  catch (e) { assert(false, 'YAML 結構解析失敗：' + e.message) }
}
const get = (o, path) => path.split('.').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o)
const kind = (k) => load().find((d) => d.kind === k)
const isMap = (x) => x && typeof x === 'object' && !Array.isArray(x)
const list = (x) => (Array.isArray(x) ? x.filter(isMap) : [])
`

// 檢查器用的小叢集：幾個 namespace、Pod 與叢集外的位址。
// allowed(來源, 目的, 協定, port) 依 NetworkPolicy 的語意算出放不放行：沒有 policy 選到就不受限；
// 選到之後只剩規則列出的；一條連線要來源的 Egress 與目的的 Ingress 都放行。
const NETPOL = R`
const NS = {
  clinic: { 'kubernetes.io/metadata.name': 'clinic' },
  'kube-system': { 'kubernetes.io/metadata.name': 'kube-system' },
  reports: { 'kubernetes.io/metadata.name': 'reports' },
}
const PODS = {
  web: { ns: 'clinic', labels: { app: 'clinic-web' }, ports: [{ name: 'http', port: 8080, protocol: 'TCP' }] },
  api: { ns: 'clinic', labels: { app: 'clinic-api' }, ports: [{ name: 'http', port: 8000, protocol: 'TCP' }] },
  db: { ns: 'clinic', labels: { app: 'clinic-db' }, ports: [{ name: 'postgres', port: 5432, protocol: 'TCP' }] },
  'kube-dns': { ns: 'kube-system', labels: { 'k8s-app': 'kube-dns' }, ports: [{ name: 'dns', port: 53, protocol: 'UDP' }, { name: 'dns-tcp', port: 53, protocol: 'TCP' }] },
  'metrics-server': { ns: 'kube-system', labels: { 'k8s-app': 'metrics-server' }, ports: [] },
  'reports 的假 DNS': { ns: 'reports', labels: { 'k8s-app': 'kube-dns' }, ports: [{ name: 'dns', port: 53, protocol: 'UDP' }] },
  'report-job': { ns: 'reports', labels: { app: 'report-job' }, ports: [] },
}
const EXT = { '網際網路 203.0.113.50': '203.0.113.50', '8.8.8.8': '8.8.8.8', 'Informix 10.20.5.31': '10.20.5.31' }
function pols() {
  const ds = load()
  for (const d of ds) assert(d.kind === 'NetworkPolicy', '這個檔案只放 NetworkPolicy，看到 kind: ' + d.kind)
  return ds
}
function sel(s, labels, where) {
  if (s === undefined || s === null || s === '') return true
  assert(isMap(s), where + ' 要是一個對應：{} 或底下寫 matchLabels')
  for (const k of Object.keys(s)) assert(k === 'matchLabels' || k === 'matchExpressions', where + ' 底下只能寫 matchLabels 或 matchExpressions，看到「' + k + '」：label 要放在 matchLabels 底下')
  if (isMap(s.matchLabels)) for (const k of Object.keys(s.matchLabels)) if (labels[k] !== String(s.matchLabels[k])) return false
  for (const e of list(s.matchExpressions)) {
    const has = Object.prototype.hasOwnProperty.call(labels, e.key)
    const vals = Array.isArray(e.values) ? e.values.map(String) : []
    const op = String(e.operator)
    if (op === 'In' && !(has && vals.includes(labels[e.key]))) return false
    if (op === 'NotIn' && has && vals.includes(labels[e.key])) return false
    if (op === 'Exists' && !has) return false
    if (op === 'DoesNotExist' && has) return false
  }
  return true
}
function ip4(s) {
  const p = String(s).split('.').map(Number)
  return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? ((p[0] * 256 + p[1]) * 256 + p[2]) * 256 + p[3] : null
}
function inCidr(ip, cidr) {
  const m = /^([\d.]+)\/(\d+)$/.exec(String(cidr || ''))
  assert(m, 'ipBlock.cidr 要寫成「位址/長度」，例如 10.20.5.31/32，看到：' + cidr)
  const base = ip4(m[1]), len = Number(m[2]), x = ip4(ip)
  if (base === null || x === null || len > 32) return false
  const size = Math.pow(2, 32 - len)
  return Math.floor(x / size) === Math.floor(base / size)
}
function peerHit(peer, polNs, ep) {
  if (!isMap(peer)) return false
  if (peer.ipBlock) {
    if (ep.pod) return false
    const ex = Array.isArray(peer.ipBlock.except) ? peer.ipBlock.except : []
    return inCidr(ep.ip, peer.ipBlock.cidr) && !ex.some((c) => inCidr(ep.ip, c))
  }
  if (!ep.pod) return false
  const hasNs = 'namespaceSelector' in peer, hasPod = 'podSelector' in peer
  if (!hasNs && !hasPod) return false
  const nsOk = hasNs ? sel(peer.namespaceSelector, NS[ep.ns], 'namespaceSelector') : ep.ns === polNs
  return nsOk && (!hasPod || sel(peer.podSelector, ep.labels, 'podSelector'))
}
function portHit(rule, dst, proto, port) {
  const ps = rule.ports
  if (ps === undefined || ps === null || (Array.isArray(ps) && !ps.length)) return true
  return list(ps).some((p) => {
    if (String(p.protocol || 'TCP').toUpperCase() !== proto) return false
    if (p.port === undefined || p.port === null) return true
    const s = String(p.port)
    if (/^\d+$/.test(s)) return port >= Number(s) && port <= (p.endPort ? Number(p.endPort) : Number(s))
    return dst.pod && dst.ports.some((c) => c.name === s && c.port === port && c.protocol === proto)
  })
}
function types(p) {
  const t = get(p, 'spec.policyTypes')
  if (Array.isArray(t) && t.length) {
    for (const x of t) assert(x === 'Ingress' || x === 'Egress', 'policyTypes 只能是 Ingress 或 Egress（大小寫要對），看到：' + x)
    return t
  }
  return get(p, 'spec.egress') ? ['Ingress', 'Egress'] : ['Ingress']
}
function side(dir, self, other, dst, proto, port) {
  const key = dir === 'Ingress' ? 'ingress' : 'egress', peerKey = dir === 'Ingress' ? 'from' : 'to'
  const ps = pols().filter((p) => (get(p, 'metadata.namespace') || 'default') === self.ns && sel(get(p, 'spec.podSelector'), self.labels, 'spec.podSelector') && types(p).includes(dir))
  if (!ps.length) return true
  return ps.some((p) => {
    const rules = get(p, 'spec.' + key)
    return (Array.isArray(rules) ? rules : []).some((r) => {
      const rr = isMap(r) ? r : {}
      for (const k of Object.keys(rr)) assert(k === peerKey || k === 'ports', key + ' 的規則只能有 ' + peerKey + ' 與 ports，看到「' + k + '」')
      const peers = rr[peerKey]
      const anyone = peers === undefined || peers === null || (Array.isArray(peers) && !peers.length)
      return (anyone || (Array.isArray(peers) && peers.some((x) => peerHit(x, self.ns, other)))) && portHit(rr, dst, proto, port)
    })
  })
}
function ep(n) { return PODS[n] ? Object.assign({ pod: true, name: n }, PODS[n]) : { pod: false, name: n, ip: EXT[n] } }
function allowed(src, dst, proto, port) {
  const s = ep(src), d = ep(dst)
  return (!s.pod || side('Egress', s, d, d, proto, port)) && (!d.pod || side('Ingress', d, s, d, proto, port))
}
function expectConn(src, dst, proto, port, want, hint) {
  const got = allowed(src, dst, proto, port)
  assert(got === want, src + ' → ' + dst + '（' + proto + ' ' + port + '）應該' + (want ? '放行' : '擋下') + '，現在是' + (got ? '放行' : '擋下') + '。' + hint)
}
`

export default [
  {
    id: 'k8s-networking-1', skill: 'k8s-networking', kind: 'config', level: 2, file: 'networkpolicy.yaml',
    title: '替 clinic namespace 補一組 NetworkPolicy',
    prompt: '`clinic` namespace 裡有三種 Pod：`app: clinic-web`、`app: clinic-api`（監聽 8000）、`app: clinic-db`（PostgreSQL，監聽 5432）。叢集的 DNS Pod 在 `kube-system`，label 是 `k8s-app: kube-dns`。\n\n資安稽核要求：\n\n- `clinic` 裡的 Pod，進、出兩個方向都預設拒絕\n- api 能連 db 的 TCP 5432，其他 port 不行\n- api 能查 DNS：UDP 與 TCP 的 53，而且只能連到 `kube-system` 裡帶 `k8s-app: kube-dns` 的 Pod（DNS 開給 `clinic` 裡所有的 Pod 也可以）\n- 除此之外都擋：其他 namespace 的 Pod 連不進來、web 不能直接連 db、api 與 db 都不能連到叢集外\n\n起始碼是第一次嘗試的結果，有兩個問題：預設拒絕只擋了一個方向；db 的規則把 `namespaceSelector` 和 `podSelector` 寫成了兩個元素。修正它們並補上缺的規則。\n\n- 每一份都是 `networking.k8s.io/v1` 的 NetworkPolicy，`metadata.namespace` 是 `clinic`，文件之間用 `---` 分隔\n- 檢查器會用一組 Pod（含 `reports` namespace 裡一個也掛了 `k8s-app: kube-dns` 的 Pod）實際算出每條連線放不放行',
    starter: `# clinic namespace：api 要能連 db 的 5432、能查 DNS，其他都擋
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
  namespace: clinic
spec:
  podSelector: {}
  policyTypes:
    - Ingress
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
        - namespaceSelector: {}
        - podSelector:
            matchLabels:
              app: clinic-api
      ports:
        - protocol: TCP
          port: 5432
`,
    solution: `# clinic namespace：api 要能連 db 的 5432、能查 DNS，其他都擋
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
  namespace: clinic
spec:
  podSelector: {}              # 選到 clinic 裡的每一個 Pod
  policyTypes:                 # 兩個方向都變成白名單；沒有規則，所以全擋
    - Ingress
    - Egress
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
  namespace: clinic
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:   # 同一個元素：kube-system 裡的 DNS Pod（AND）
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
---
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
        - podSelector:         # 只寫 podSelector：同一個 namespace（clinic）裡的 Pod
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
        - podSelector:         # 拿掉 namespaceSelector: {}，只剩 clinic 裡的 api
            matchLabels:
              app: clinic-api
      ports:
        - protocol: TCP
          port: 5432
`,
    hints: [
      'default deny：`podSelector: {}` 選到全部 Pod，`policyTypes` 同時寫 `Ingress` 與 `Egress`，不寫任何規則。',
      '`from` 底下每個 `-` 是一個獨立的來源，任一個符合就放行；單獨一個 `- namespaceSelector: {}` 等於「所有 namespace 的所有 Pod」。',
      'api 連 db 要兩邊都開：api 的 egress（`to` 選 `app: clinic-db`）與 db 的 ingress（`from` 選 `app: clinic-api`），port 都是 TCP 5432。',
      'DNS 的 `to` 只有一個元素，裡面同時寫 `namespaceSelector`（`kubernetes.io/metadata.name: kube-system`）與 `podSelector`（`k8s-app: kube-dns`）；`ports` 寫 UDP 53 與 TCP 53 兩筆。',
    ],
    tests: [
      { name: '每一份都是 clinic namespace 的 NetworkPolicy（networking.k8s.io/v1）', code: YAML + NETPOL + R`
const ds = load()
assert(ds.length, '檔案裡沒有任何文件')
for (const d of ds) {
  assertEqual(d.kind, 'NetworkPolicy', 'kind')
  assertEqual(d.apiVersion, 'networking.k8s.io/v1', (get(d, 'metadata.name') || '某一份') + ' 的 apiVersion')
  assert(get(d, 'metadata.name'), '每一份都要有 metadata.name')
  assertEqual(get(d, 'metadata.namespace'), 'clinic', get(d, 'metadata.name') + ' 的 metadata.namespace（policy 只管它所在 namespace 的 Pod）')
}
` },
      { name: 'api 連得到 db 的 TCP 5432', code: YAML + NETPOL + R`
expectConn('api', 'db', 'TCP', 5432, true, 'api 這一端的 egress 與 db 這一端的 ingress 都要放行；Pod 用 podSelector 選，不用 ipBlock。')
` },
      { name: 'api 查得到 DNS：UDP 與 TCP 的 53', code: YAML + NETPOL + R`
expectConn('api', 'kube-dns', 'UDP', 53, true, '放行到 kube-system 裡 k8s-app: kube-dns 的 Pod。')
expectConn('api', 'kube-dns', 'TCP', 53, true, 'DNS 的回應太大時會改用 TCP，TCP 53 也要開。')
` },
      { name: '進出兩個方向都預設拒絕：沒列出的連線都擋下', code: YAML + NETPOL + R`
expectConn('api', '網際網路 203.0.113.50', 'TCP', 443, false, 'egress 也要預設拒絕：default deny 的 policyTypes 要包含 Egress。')
expectConn('db', '網際網路 203.0.113.50', 'TCP', 443, false, 'db 的 egress 也要預設拒絕。')
expectConn('web', '網際網路 203.0.113.50', 'TCP', 443, false, 'web 的 egress 也要預設拒絕。')
expectConn('api', 'Informix 10.20.5.31', 'TCP', 9088, false, '這一題還沒有要開叢集外的系統。')
expectConn('web', 'db', 'TCP', 5432, false, '只有 api 能連 db。')
expectConn('db', 'api', 'TCP', 8000, false, 'ingress 也要預設拒絕。')
` },
      { name: '其他 namespace 的 Pod 連不到 db 與 api（稽核找到的問題）', code: YAML + NETPOL + R`
expectConn('report-job', 'db', 'TCP', 5432, false, 'from 裡單獨一個 namespaceSelector: {} 會選到所有 namespace 的所有 Pod。')
expectConn('report-job', 'api', 'TCP', 8000, false, 'api 的 ingress 要預設拒絕。')
` },
      { name: 'api 到 db 只開 TCP 5432', code: YAML + NETPOL + R`
expectConn('api', 'db', 'TCP', 22, false, '規則要寫 ports，只開 5432。')
expectConn('api', 'db', 'TCP', 5433, false, '只開 5432 這一個 port。')
expectConn('api', 'db', 'UDP', 5432, false, 'protocol 寫 TCP（不寫時預設也是 TCP）。')
` },
      { name: 'DNS 只能連到 kube-system 裡的 DNS Pod', code: YAML + NETPOL + R`
expectConn('api', 'reports 的假 DNS', 'UDP', 53, false, 'reports 裡也有 Pod 掛了 k8s-app: kube-dns：namespaceSelector 與 podSelector 要寫在同一個元素（AND），不是兩個元素（OR），也不能只寫 podSelector。')
expectConn('api', 'metrics-server', 'UDP', 53, false, '只寫 namespaceSelector 會放行 kube-system 裡的每一個 Pod，要再加 podSelector。')
expectConn('api', '8.8.8.8', 'UDP', 53, false, 'DNS 不要用 ipBlock（例如 0.0.0.0/0）放行，Pod 只該查叢集的 DNS。')
` },
    ],
  },
  {
    id: 'k8s-networking-2', skill: 'k8s-networking', kind: 'python', level: 3,
    title: '實作 NetworkPolicy 評估器：誰會被隔離、來源選不選得到',
    prompt: '實作課文那個 NetworkPolicy 評估器裡判斷 ingress 的兩個函式。資料格式和課文的模擬相同：Pod 是 `{"name", "ns", "labels"}`；`ns_labels` 是每個 namespace 的 label；policy 是 dict，欄位對應 YAML（`ns`、`podSelector`、`policyTypes`、`ingress`），selector 只用 matchLabels 的寫法（一個 dict）。這題不處理 `ipBlock`。\n\n- `isolates(policy, pod)`：這份 policy 有沒有讓 `pod` 的 **ingress** 變成白名單。三個條件都要成立：policy 和 pod 在同一個 namespace；`podSelector` 選到 pod；`policyTypes` 包含 `"Ingress"`。沒寫 `policyTypes` 時，Kubernetes 一定把 Ingress 算進去（就算這份 policy 只有 egress 規則）\n- `peer_matches(peer, policy_ns, src, ns_labels)`：`from` 裡的一個元素選不選得到來源 Pod `src`\n  - 同時有 `namespaceSelector` 與 `podSelector`：兩個都要符合（AND）\n  - 只有 `namespaceSelector`：那些 namespace 裡的所有 Pod\n  - 只有 `podSelector`：只看 policy 自己的 namespace（`policy_ns`）\n  - 兩個都沒有：回傳 `False`\n\n`matches()`、`ports_match()`、`ingress_allowed()` 已經寫好，不用改：`ingress_allowed()` 回傳 `(放行與否, 放行它的 policy 名稱)`，沒有任何 policy 隔離目的 Pod 時回傳 `(True, None)`。\n\n起始碼照直覺寫，跑起來有兩個結果不對：monitoring 裡的除錯 Pod 連得到 api；只有 egress 規則的 `allow-dns` 卻讓 web 的 ingress 被擋了。',
    starter: `def matches(selector, labels):
    """matchLabels：selector 的每一組鍵值，labels 都要有而且相同；空的 selector 選到全部"""
    return all(labels.get(k) == v for k, v in selector.items())


def isolates(policy, pod):
    # 這份 policy 有沒有讓 pod 的 ingress 變成白名單
    return policy["ns"] == pod["ns"] and matches(policy["podSelector"], pod["labels"])


def peer_matches(peer, policy_ns, src, ns_labels):
    # from 裡的一個元素選不選得到 src
    checks = []
    if "namespaceSelector" in peer:
        checks.append(matches(peer["namespaceSelector"], ns_labels[src["ns"]]))
    if "podSelector" in peer:
        checks.append(matches(peer["podSelector"], src["labels"]))
    return any(checks)


def ports_match(rule, port):
    ports = rule.get("ports")
    return not ports or any(p.get("port") in (None, port) for p in ports)


def ingress_allowed(dst, src, port, policies, ns_labels):
    selecting = [p for p in policies if isolates(p, dst)]
    if not selecting:
        return True, None                       # 沒有 policy 隔離它：全部放行
    for p in selecting:
        for rule in p.get("ingress", []):
            peers = rule.get("from")
            if (not peers or any(peer_matches(x, p["ns"], src, ns_labels) for x in peers)) and ports_match(rule, port):
                return True, p["name"]
    return False, None


NS_LABELS = {ns: {"kubernetes.io/metadata.name": ns} for ns in ["clinic", "kube-system", "monitoring", "reports"]}
api = {"name": "api", "ns": "clinic", "labels": {"app": "clinic-api"}}
web = {"name": "web", "ns": "clinic", "labels": {"app": "clinic-web"}}
prom = {"name": "prom", "ns": "monitoring", "labels": {"app": "prometheus"}}
shell = {"name": "shell", "ns": "monitoring", "labels": {"app": "debug-shell"}}

POLICIES = [
    {"name": "allow-dns", "ns": "clinic", "podSelector": {}, "policyTypes": ["Egress"],
     "egress": [{"to": [{"namespaceSelector": {"kubernetes.io/metadata.name": "kube-system"},
                         "podSelector": {"k8s-app": "kube-dns"}}]}]},
    {"name": "api-from-web", "ns": "clinic", "podSelector": {"app": "clinic-api"}, "policyTypes": ["Ingress"],
     "ingress": [{"from": [{"podSelector": {"app": "clinic-web"}}], "ports": [{"port": 8000}]}]},
    {"name": "api-scrape", "ns": "clinic", "podSelector": {"app": "clinic-api"}, "policyTypes": ["Ingress"],
     "ingress": [{"from": [{"namespaceSelector": {"kubernetes.io/metadata.name": "monitoring"},
                            "podSelector": {"app": "prometheus"}}], "ports": [{"port": 8000}]}]},
]

for src in (web, prom, shell):
    print(f"{src['name']:>5} → api:8000 ", ingress_allowed(api, src, 8000, POLICIES, NS_LABELS))
print("  api → web:8080 ", ingress_allowed(web, api, 8080, POLICIES, NS_LABELS))
`,
    solution: `def matches(selector, labels):
    """matchLabels：selector 的每一組鍵值，labels 都要有而且相同；空的 selector 選到全部"""
    return all(labels.get(k) == v for k, v in selector.items())


def isolates(policy, pod):
    # 這份 policy 有沒有讓 pod 的 ingress 變成白名單
    if policy["ns"] != pod["ns"] or not matches(policy["podSelector"], pod["labels"]):
        return False
    types = policy.get("policyTypes")
    return not types or "Ingress" in types      # 沒寫 policyTypes：一定包含 Ingress


def peer_matches(peer, policy_ns, src, ns_labels):
    # from 裡的一個元素選不選得到 src
    if "namespaceSelector" not in peer and "podSelector" not in peer:
        return False
    if "namespaceSelector" in peer:
        ns_ok = matches(peer["namespaceSelector"], ns_labels[src["ns"]])
    else:
        ns_ok = src["ns"] == policy_ns          # 只寫 podSelector：只看 policy 自己的 namespace
    pod_ok = matches(peer.get("podSelector", {}), src["labels"])
    return ns_ok and pod_ok                     # 同一個元素裡的條件是 AND


def ports_match(rule, port):
    ports = rule.get("ports")
    return not ports or any(p.get("port") in (None, port) for p in ports)


def ingress_allowed(dst, src, port, policies, ns_labels):
    selecting = [p for p in policies if isolates(p, dst)]
    if not selecting:
        return True, None                       # 沒有 policy 隔離它：全部放行
    for p in selecting:
        for rule in p.get("ingress", []):
            peers = rule.get("from")
            if (not peers or any(peer_matches(x, p["ns"], src, ns_labels) for x in peers)) and ports_match(rule, port):
                return True, p["name"]
    return False, None


NS_LABELS = {ns: {"kubernetes.io/metadata.name": ns} for ns in ["clinic", "kube-system", "monitoring", "reports"]}
api = {"name": "api", "ns": "clinic", "labels": {"app": "clinic-api"}}
web = {"name": "web", "ns": "clinic", "labels": {"app": "clinic-web"}}
prom = {"name": "prom", "ns": "monitoring", "labels": {"app": "prometheus"}}
shell = {"name": "shell", "ns": "monitoring", "labels": {"app": "debug-shell"}}

POLICIES = [
    {"name": "allow-dns", "ns": "clinic", "podSelector": {}, "policyTypes": ["Egress"],
     "egress": [{"to": [{"namespaceSelector": {"kubernetes.io/metadata.name": "kube-system"},
                         "podSelector": {"k8s-app": "kube-dns"}}]}]},
    {"name": "api-from-web", "ns": "clinic", "podSelector": {"app": "clinic-api"}, "policyTypes": ["Ingress"],
     "ingress": [{"from": [{"podSelector": {"app": "clinic-web"}}], "ports": [{"port": 8000}]}]},
    {"name": "api-scrape", "ns": "clinic", "podSelector": {"app": "clinic-api"}, "policyTypes": ["Ingress"],
     "ingress": [{"from": [{"namespaceSelector": {"kubernetes.io/metadata.name": "monitoring"},
                            "podSelector": {"app": "prometheus"}}], "ports": [{"port": 8000}]}]},
]

for src in (web, prom, shell):
    print(f"{src['name']:>5} → api:8000 ", ingress_allowed(api, src, 8000, POLICIES, NS_LABELS))
print("  api → web:8080 ", ingress_allowed(web, api, 8080, POLICIES, NS_LABELS))
`,
    tests: [
      { name: '範例：web 與 Prometheus 放行、monitoring 裡的除錯 Pod 擋下、web 不受 allow-dns 影響', code: `assert ingress_allowed(api, web, 8000, POLICIES, NS_LABELS) == (True, "api-from-web")
assert ingress_allowed(api, prom, 8000, POLICIES, NS_LABELS) == (True, "api-scrape")
_r = ingress_allowed(api, shell, 8000, POLICIES, NS_LABELS)
assert _r == (False, None), f"monitoring 裡的 debug-shell 不是 Prometheus，應該擋下，你的結果 {_r}"
_r = ingress_allowed(web, api, 8080, POLICIES, NS_LABELS)
assert _r == (True, None), f"allow-dns 只有 Egress，不會隔離 web 的 ingress，你的結果 {_r}"` },
      { name: '同一個元素裡的 namespaceSelector 與 podSelector 是 AND', code: `_peer = {"namespaceSelector": {"kubernetes.io/metadata.name": "monitoring"}, "podSelector": {"app": "prometheus"}}
assert peer_matches(_peer, "clinic", prom, NS_LABELS) is True
assert peer_matches(_peer, "clinic", shell, NS_LABELS) is False, "namespace 對了但 label 不對，應該是 False"
_fake = {"name": "fake", "ns": "reports", "labels": {"app": "prometheus"}}
assert peer_matches(_peer, "clinic", _fake, NS_LABELS) is False, "label 對了但 namespace 不對，應該是 False"` },
      { name: '只寫 podSelector：只選 policy 自己 namespace 裡的 Pod', code: `_peer = {"podSelector": {"app": "clinic-web"}}
assert peer_matches(_peer, "clinic", web, NS_LABELS) is True
_other = {"name": "other-web", "ns": "reports", "labels": {"app": "clinic-web"}}
assert peer_matches(_peer, "clinic", _other, NS_LABELS) is False, "reports 裡的 Pod label 相同，但只寫 podSelector 時只看 clinic"
assert ingress_allowed(api, _other, 8000, POLICIES, NS_LABELS) == (False, None)
assert peer_matches({"podSelector": {}}, "clinic", api, NS_LABELS) is True, "空的 podSelector 選到同 namespace 的全部 Pod"
assert peer_matches({"podSelector": {}}, "clinic", prom, NS_LABELS) is False` },
      { name: '只寫 namespaceSelector：那些 namespace 的所有 Pod；兩個都沒有時是 False', code: `_peer = {"namespaceSelector": {"kubernetes.io/metadata.name": "monitoring"}}
assert peer_matches(_peer, "clinic", shell, NS_LABELS) is True
assert peer_matches(_peer, "clinic", web, NS_LABELS) is False
assert peer_matches({"namespaceSelector": {}}, "clinic", shell, NS_LABELS) is True, "空的 namespaceSelector 選到所有 namespace"
assert peer_matches({}, "clinic", web, NS_LABELS) is False` },
      { name: 'isolates：namespace、podSelector 與 policyTypes', code: `_egress_only = {"name": "e", "ns": "clinic", "podSelector": {}, "policyTypes": ["Egress"], "egress": [{}]}
assert isolates(_egress_only, web) is False, "policyTypes 只有 Egress，不會隔離 ingress"
_no_types = {"name": "n", "ns": "clinic", "podSelector": {"app": "clinic-api"}, "egress": [{}]}
assert isolates(_no_types, api) is True, "沒寫 policyTypes 時一定包含 Ingress（就算只有 egress 規則）"
assert isolates(_no_types, web) is False, "podSelector 沒選到 web"
_other_ns = {"name": "o", "ns": "monitoring", "podSelector": {}, "policyTypes": ["Ingress"]}
assert isolates(_other_ns, api) is False, "policy 只管它所在 namespace 的 Pod"
_both = {"name": "b", "ns": "clinic", "podSelector": {}, "policyTypes": ["Ingress", "Egress"]}
assert isolates(_both, {"name": "db", "ns": "clinic", "labels": {"app": "clinic-db"}}) is True` },
      { name: 'default deny 加上逐條放行：組合起來的結果', code: `_db = {"name": "db", "ns": "clinic", "labels": {"app": "clinic-db"}}
_job = {"name": "job", "ns": "reports", "labels": {"app": "report-job"}}
_ps = [
    {"name": "default-deny", "ns": "clinic", "podSelector": {}, "policyTypes": ["Ingress", "Egress"]},
    {"name": "db-from-api", "ns": "clinic", "podSelector": {"app": "clinic-db"}, "policyTypes": ["Ingress"],
     "ingress": [{"from": [{"podSelector": {"app": "clinic-api"}}], "ports": [{"port": 5432}]}]},
]
assert ingress_allowed(_db, api, 5432, _ps, NS_LABELS) == (True, "db-from-api")
assert ingress_allowed(_db, api, 22, _ps, NS_LABELS) == (False, None)
assert ingress_allowed(_db, web, 5432, _ps, NS_LABELS) == (False, None)
assert ingress_allowed(_db, _job, 5432, _ps, NS_LABELS) == (False, None)
assert ingress_allowed(_job, api, 8080, _ps, NS_LABELS) == (True, None), "reports 沒有任何 policy，不受限"` },
    ],
    hints: [
      '`isolates`：先確認 namespace 相同、`podSelector` 選到 pod；再看 `policy.get("policyTypes")`，沒寫（`None`）或包含 `"Ingress"` 才回傳 `True`。',
      '`peer_matches` 拆成兩個布林值再用 `and`：namespace 這一關（有 `namespaceSelector` 就比對 `ns_labels[src["ns"]]`，沒有就要求 `src["ns"] == policy_ns`），Pod 這一關（有 `podSelector` 就比對，沒有就通過）。',
      '起始碼用 `any(checks)`，等於把同一個元素裡的兩個條件當成 OR；而且只寫 `podSelector` 時完全沒檢查 namespace。',
    ],
  },
]

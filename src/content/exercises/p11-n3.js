// 程式題：p11-n3（Kubernetes 權限與多租戶）
// 設定檔題的測試碼是 JS：使用者內容是 `source`，`lines` 是去掉 # 註解與空行的各行。
// 測試碼用 String.raw 寫；測試碼裡不要出現 `${` 與反引號。
const R = String.raw

// 夠用的 YAML 子集解析（與 p10-m2 相同）：多份文件（---）、區塊式與單行 flow 式（{…}、[…]）的對應與清單、引號。
// docs() 回傳每份文件解析後的物件；純量一律是字串。
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

// RBAC 的比對：規則的三個清單裡 * 代表全部，resources 的 pods/* 代表 pods 的所有子資源；verb 傳 null 代表「任何動詞」
const RBAC = R`
const NS = 'clinic-staging'
const strs = (x) => (Array.isArray(x) ? x.map((v) => (v === null || v === undefined ? '' : String(v))) : [])
function resMatch(rs, r) {
  if (rs.includes('*') || rs.includes(r)) return true
  return r.includes('/') && rs.includes(r.split('/')[0] + '/*')
}
function grants(rule, group, resource, verb) {
  const gs = strs(rule.apiGroups), rs = strs(rule.resources), vs = strs(rule.verbs)
  if (!(gs.includes('*') || gs.includes(group))) return false
  if (!resMatch(rs, resource)) return false
  return verb === null ? vs.length > 0 : (vs.includes('*') || vs.includes(verb))
}
function binding() {
  return load().filter((d) => d.kind === 'RoleBinding')
    .find((b) => list(b.subjects).some((s) => s.kind === 'ServiceAccount' && s.name === 'gitlab-deployer'))
}
function role() {
  const b = binding()
  if (!b || !isMap(b.roleRef)) return null
  const ref = b.roleRef
  const bns = get(b, 'metadata.namespace') || 'default'
  return load().find((d) => d.kind === ref.kind && get(d, 'metadata.name') === ref.name &&
    (ref.kind === 'ClusterRole' || (get(d, 'metadata.namespace') || 'default') === bns)) || null
}
const rules = () => list(role() && role().rules)
const allowed = (group, resource, verb) => rules().some((r) => grants(r, group, resource, verb))
`

export default [
  {
    id: 'k8s-rbac-tenancy-1', skill: 'k8s-rbac-tenancy', kind: 'config', level: 2, file: 'deployer-rbac.yaml',
    title: '替 CI 的部署帳號收斂權限',
    prompt: '測試叢集的 `clinic-staging` 由 GitLab CI 部署。現在的部署帳號 `gitlab-deployer` 用 ClusterRoleBinding 綁了 `cluster-admin`：任何一個 job 都能讀所有 namespace 的 Secret、進任何容器、刪掉整個 namespace。\n\n改成只能做部署需要的事。CI 會執行 `kubectl apply`、`kubectl rollout status` 與 `kubectl wait --for=condition=complete job/…`。\n\n- 保留 ServiceAccount `gitlab-deployer`（namespace `clinic-staging`）\n- 拿掉 ClusterRoleBinding，改成 `clinic-staging` 裡的 RoleBinding，把 `gitlab-deployer` 接到一個寫在這個檔案裡的 Role（用 ClusterRole 加 RoleBinding 也可以；不要指到內建的 `cluster-admin`、`admin`、`edit`）\n- `deployments`（`apps`）、`jobs`（`batch`）、`services` 與 `configmaps`（core，寫成 `""`）都要能 `get`、`create`、`patch`；`deployments` 與 `jobs` 另外要能 `list`、`watch`\n- 不能對 `secrets` 做任何動作，不能碰 `pods/exec`、`pods/attach`\n- 規則裡不能有 `*`，不能給 `delete`、`deletecollection`、`escalate`、`bind`、`impersonate`\n- `create`、`update`、`patch` 這類寫入動作只能給上面四種資源；要看 Pod 與 events 的狀態可以另外給唯讀的 `get`、`list`、`watch`',
    starter: `# 現況：部署帳號直接綁 cluster-admin
apiVersion: v1
kind: ServiceAccount
metadata:
  name: gitlab-deployer
  namespace: clinic-staging
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: gitlab-deployer-admin
subjects:
  - kind: ServiceAccount
    name: gitlab-deployer
    namespace: clinic-staging
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin
`,
    solution: `apiVersion: v1
kind: ServiceAccount
metadata:
  name: gitlab-deployer
  namespace: clinic-staging
automountServiceAccountToken: false     # 只給叢集外的 CI 用
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: deployer
  namespace: clinic-staging
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch", "create", "patch"]
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["get", "list", "watch", "create", "patch"]
  - apiGroups: [""]
    resources: ["services", "configmaps"]
    verbs: ["get", "create", "patch"]
  - apiGroups: [""]
    resources: ["pods", "events"]       # 部署失敗時看狀態，只讀
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: gitlab-deployer
  namespace: clinic-staging             # 只在這個 namespace 生效
subjects:
  - kind: ServiceAccount
    name: gitlab-deployer
    namespace: clinic-staging
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: deployer
`,
    hints: [
      'ClusterRoleBinding 讓權限在所有 namespace 生效。RoleBinding 有 `metadata.namespace`，權限只在那裡生效；`roleRef` 指到 Role 時，Role 要在同一個 namespace。',
      'API 群組要對：`deployments` 在 `apps`，`jobs` 在 `batch`，`services`、`configmaps` 在 core，寫成 `apiGroups: [""]`。寫在錯的群組，規則等於沒寫。',
      '`kubectl apply` 對不存在的物件做 `get` 再 `create`，已存在的做 `get` 再 `patch`；`rollout status` 與 `wait` 要 `list`、`watch`。用不到的動詞不要給，尤其是 `delete`。',
    ],
    tests: [
      { name: '有 ServiceAccount gitlab-deployer，沒有 ClusterRoleBinding', code: YAML + RBAC + R`
const all = load()
const sa = all.find((d) => d.kind === 'ServiceAccount')
assert(sa, '找不到 kind: ServiceAccount 的文件（文件之間用 --- 分隔）')
assertEqual(sa.apiVersion, 'v1', 'ServiceAccount 的 apiVersion')
assertEqual(get(sa, 'metadata.name'), 'gitlab-deployer', 'ServiceAccount 的名稱')
assertEqual(get(sa, 'metadata.namespace'), NS, 'ServiceAccount 的 namespace')
assert(!all.some((d) => d.kind === 'ClusterRoleBinding'), '還有 ClusterRoleBinding：它讓權限在所有 namespace 生效，改用 clinic-staging 裡的 RoleBinding')
` },
      { name: 'RoleBinding 在 clinic-staging，把 gitlab-deployer 接到檔案裡的角色', code: YAML + RBAC + R`
const b = binding()
assert(b, '找不到 subjects 裡有 ServiceAccount gitlab-deployer 的 RoleBinding')
assertEqual(b.apiVersion, 'rbac.authorization.k8s.io/v1', 'RoleBinding 的 apiVersion')
assertEqual(get(b, 'metadata.namespace'), NS, 'RoleBinding 的 namespace（權限只在這個 namespace 生效）')
const s = list(b.subjects).find((x) => x.kind === 'ServiceAccount' && x.name === 'gitlab-deployer')
assertEqual(s.namespace || get(b, 'metadata.namespace'), NS, 'subjects 裡 ServiceAccount 的 namespace')
const ref = b.roleRef
assert(isMap(ref), 'RoleBinding 要有 roleRef')
assertEqual(ref.apiGroup, 'rbac.authorization.k8s.io', 'roleRef.apiGroup')
assert(ref.kind === 'Role' || ref.kind === 'ClusterRole', 'roleRef.kind 要是 Role（或 ClusterRole），現在是 ' + ref.kind)
assert(!['cluster-admin', 'admin', 'edit'].includes(ref.name), 'roleRef 不要指到內建的 ' + ref.name + '：它給的遠超過部署需要的')
const r = role()
assert(r, '找不到 roleRef 指到的 ' + ref.kind + ' ' + ref.name + '：要寫在這個檔案裡' + (ref.kind === 'Role' ? '，而且和 RoleBinding 在同一個 namespace' : ''))
assertEqual(r.apiVersion, 'rbac.authorization.k8s.io/v1', ref.kind + ' 的 apiVersion')
assert(rules().length, ref.kind + ' ' + ref.name + ' 沒有 rules')
` },
      { name: '四種資源都能部署（apply、rollout status、wait）', code: YAML + RBAC + R`
assert(rules().length, '找不到 RoleBinding 指到的角色或它的 rules')
const need = [
  ['apps', 'deployments', ['get', 'list', 'watch', 'create', 'patch']],
  ['batch', 'jobs', ['get', 'list', 'watch', 'create', 'patch']],
  ['', 'services', ['get', 'create', 'patch']],
  ['', 'configmaps', ['get', 'create', 'patch']],
]
for (const [g, res, verbs] of need) {
  const inGroup = rules().some((r) => strs(r.apiGroups).includes(g) && resMatch(strs(r.resources), res))
  const elsewhere = rules().some((r) => !strs(r.apiGroups).includes(g) && strs(r.resources).includes(res))
  for (const v of verbs) {
    const hint = !inGroup && elsewhere ? '：' + res + ' 在 API 群組 ' + (g || '""（core）') + '，檢查 apiGroups' : ''
    assert(allowed(g, res, v), res + ' 缺少動詞 ' + v + hint)
  }
}
` },
      { name: '不能讀 secrets，也不能 exec、attach', code: YAML + RBAC + R`
assert(rules().length, '找不到 RoleBinding 指到的角色或它的 rules')
assert(!allowed('', 'secrets', null), '角色能對 secrets 做事：get、list、watch 都會拿到內容，任何動詞都不要給')
for (const sub of ['pods/exec', 'pods/attach']) {
  assert(!allowed('', sub, null), '角色能對 ' + sub + ' 做事：等於能進容器下指令（部分版本只檢查 get），任何動詞都不要給')
}
` },
      { name: '沒有萬用字元、delete 與提權動詞，寫入只給四種資源', code: YAML + RBAC + R`
assert(rules().length, '找不到 RoleBinding 指到的角色或它的 rules')
const writes = ['create', 'update', 'patch', 'delete', 'deletecollection']
const okWrite = ['apps/deployments', 'batch/jobs', '/services', '/configmaps']
for (const r of rules()) {
  const gs = strs(r.apiGroups), rs = strs(r.resources), vs = strs(r.verbs)
  assert(!gs.concat(rs, vs).includes('*'), '規則裡有 *：它涵蓋現在與以後的所有資源或動詞')
  for (const v of vs) {
    assert(v !== 'delete' && v !== 'deletecollection', '不要給 ' + v + '：kubectl apply 用不到，刪除交給人用自己的身分做')
    assert(!['escalate', 'bind', 'impersonate'].includes(v), '不要給 ' + v + '：它能繞過 RBAC 的保護')
  }
  if (vs.some((v) => writes.includes(v))) {
    for (const g of gs) for (const res of rs) {
      assert(okWrite.includes(g + '/' + res), '寫入動作只給 deployments、jobs、services、configmaps；這裡給了 ' + (g || 'core') + ' 的 ' + res)
    }
  }
}
` },
    ],
  },
  {
    id: 'k8s-rbac-tenancy-2', skill: 'k8s-rbac-tenancy', kind: 'python', level: 3,
    title: '從一組 binding 找出危險的權限',
    prompt: '實作 `find_risks(roles, bindings) -> list`：找出每個主體透過哪個範圍拿到了危險權限，回傳**排序過、不重複**的 `(主體, 範圍, 風險)` tuple 清單。\n\n輸入：\n\n- `roles`：key 是 `"ClusterRole/<名稱>"` 或 `"Role/<namespace>/<名稱>"`，值是規則清單，每條規則是 `{"apiGroups": [...], "resources": [...], "verbs": [...]}`；core group 寫成 `""`\n- `bindings`：每筆是 `{"kind": "RoleBinding" 或 "ClusterRoleBinding", "namespace": ...（只有 RoleBinding 有）, "roleRef": {"kind": ..., "name": ...}, "subjects": [...]}`；主體是 `{"kind": "User" 或 "Group", "name": ...}`，或 `{"kind": "ServiceAccount", "name": ..., "namespace": ...}`\n\n規則：\n\n- RoleBinding 的 `roleRef` 是 Role 時，指的是**同一個 namespace** 的 Role；ClusterRoleBinding 只能指向 ClusterRole，指向 Role 的忽略。找不到角色的 binding 不授予任何權限\n- 主體名稱用起始碼的 `subject_name`；範圍是 RoleBinding 的 namespace，ClusterRoleBinding 是 `"*"`\n- 比對：`apiGroups`、`resources`、`verbs` 裡的 `"*"` 代表全部；`resources` 的 `"pods/*"` 代表 pods 的所有子資源；只寫 `"pods"` 不包含子資源\n\n風險（一條規則可以同時符合好幾種）：\n\n- `wildcard`：規則的 apiGroups、resources 或 verbs 含 `"*"`\n- `read-secrets`：能對 core 的 `secrets` 做 `get`、`list` 或 `watch`\n- `exec`：能對 core 的 `pods/exec` 或 `pods/attach` 做任何動詞\n- `create-workloads`：能 `create` core 的 `pods`、apps 的 `deployments`、`statefulsets`、`daemonsets`、`replicasets`，或 batch 的 `jobs`、`cronjobs`\n- `escalation`：能對 `rbac.authorization.k8s.io` 的 `roles` 或 `clusterroles` 做 `escalate` 或 `bind`，或能對 core 的 `users`、`groups`、`serviceaccounts` 做 `impersonate`\n- `node-proxy`：能對 core 的 `nodes/proxy` 做任何動詞；只有 ClusterRoleBinding 才回報（nodes 屬於叢集層級，RoleBinding 給不了）',
    starter: `def subject_name(s):
    if s["kind"] == "ServiceAccount":
        return f"system:serviceaccount:{s['namespace']}:{s['name']}"
    if s["kind"] == "Group":
        return "group:" + s["name"]
    return s["name"]


def find_risks(roles: dict, bindings: list) -> list:
    # TODO：只查了 ClusterRole，只比對字面上的 "secrets" 與 "get"；萬用字元、Role 與其他風險都沒處理
    found = set()
    for b in bindings:
        rules = roles.get("ClusterRole/" + b["roleRef"]["name"], [])
        scope = b.get("namespace", "*")
        for rule in rules:
            if "secrets" in rule["resources"] and "get" in rule["verbs"]:
                for s in b["subjects"]:
                    found.add((subject_name(s), scope, "read-secrets"))
    return sorted(found)


roles = {
    "ClusterRole/cluster-admin": [{"apiGroups": ["*"], "resources": ["*"], "verbs": ["*"]}],
    "Role/clinic-staging/deployer": [
        {"apiGroups": ["apps"], "resources": ["deployments"], "verbs": ["get", "list", "watch", "create", "patch"]},
        {"apiGroups": [""], "resources": ["pods", "pods/log"], "verbs": ["get", "list"]},
    ],
}
bindings = [
    {"kind": "ClusterRoleBinding", "roleRef": {"kind": "ClusterRole", "name": "cluster-admin"},
     "subjects": [{"kind": "Group", "name": "kubeadm:cluster-admins"}]},
    {"kind": "RoleBinding", "namespace": "clinic-staging", "roleRef": {"kind": "Role", "name": "deployer"},
     "subjects": [{"kind": "ServiceAccount", "name": "gitlab-deployer", "namespace": "clinic-staging"}]},
]
for row in find_risks(roles, bindings):
    print(row)
`,
    solution: `WORKLOADS = [("", "pods"), ("apps", "deployments"), ("apps", "statefulsets"), ("apps", "daemonsets"),
             ("apps", "replicasets"), ("batch", "jobs"), ("batch", "cronjobs")]


def subject_name(s):
    if s["kind"] == "ServiceAccount":
        return f"system:serviceaccount:{s['namespace']}:{s['name']}"
    if s["kind"] == "Group":
        return "group:" + s["name"]
    return s["name"]


def _has(values, want):
    return "*" in values or want in values


def grants(rule, group, resource, verb=None):
    """這條規則是否允許對 group 的 resource 做 verb；verb 是 None 代表任何動詞"""
    if not _has(rule.get("apiGroups", []), group):
        return False
    resources = rule.get("resources", [])
    sub_wild = "/" in resource and resource.split("/")[0] + "/*" in resources   # pods/* 涵蓋子資源
    if not (_has(resources, resource) or sub_wild):
        return False
    verbs = rule.get("verbs", [])
    return bool(verbs) if verb is None else _has(verbs, verb)


def rule_risks(rule, cluster_wide):
    risks = set()
    if "*" in rule.get("apiGroups", []) + rule.get("resources", []) + rule.get("verbs", []):
        risks.add("wildcard")
    if any(grants(rule, "", "secrets", v) for v in ("get", "list", "watch")):
        risks.add("read-secrets")
    if grants(rule, "", "pods/exec") or grants(rule, "", "pods/attach"):
        risks.add("exec")
    if any(grants(rule, g, r, "create") for g, r in WORKLOADS):
        risks.add("create-workloads")
    rbac = "rbac.authorization.k8s.io"
    if (any(grants(rule, rbac, r, v) for r in ("roles", "clusterroles") for v in ("escalate", "bind"))
            or any(grants(rule, "", r, "impersonate") for r in ("users", "groups", "serviceaccounts"))):
        risks.add("escalation")
    if cluster_wide and grants(rule, "", "nodes/proxy"):       # RoleBinding 給不了叢集層級的 nodes
        risks.add("node-proxy")
    return risks


def resolve(roles, b):
    ref = b["roleRef"]
    if ref["kind"] == "ClusterRole":
        return roles.get("ClusterRole/" + ref["name"])
    if b["kind"] == "RoleBinding":
        return roles.get(f"Role/{b['namespace']}/{ref['name']}")   # 同一個 namespace 的 Role
    return None                                                     # ClusterRoleBinding 指向 Role：無效


def find_risks(roles: dict, bindings: list) -> list:
    found = set()
    for b in bindings:
        cluster_wide = b["kind"] == "ClusterRoleBinding"
        scope = "*" if cluster_wide else b["namespace"]
        risks = set()
        for rule in resolve(roles, b) or []:
            risks |= rule_risks(rule, cluster_wide)
        for s in b.get("subjects", []):
            for risk in risks:
                found.add((subject_name(s), scope, risk))
    return sorted(found)


roles = {
    "ClusterRole/cluster-admin": [{"apiGroups": ["*"], "resources": ["*"], "verbs": ["*"]}],
    "Role/clinic-staging/deployer": [
        {"apiGroups": ["apps"], "resources": ["deployments"], "verbs": ["get", "list", "watch", "create", "patch"]},
        {"apiGroups": [""], "resources": ["pods", "pods/log"], "verbs": ["get", "list"]},
    ],
}
bindings = [
    {"kind": "ClusterRoleBinding", "roleRef": {"kind": "ClusterRole", "name": "cluster-admin"},
     "subjects": [{"kind": "Group", "name": "kubeadm:cluster-admins"}]},
    {"kind": "RoleBinding", "namespace": "clinic-staging", "roleRef": {"kind": "Role", "name": "deployer"},
     "subjects": [{"kind": "ServiceAccount", "name": "gitlab-deployer", "namespace": "clinic-staging"}]},
]
for row in find_risks(roles, bindings):
    print(row)
`,
    hints: [
      '先寫一個 `grants(rule, group, resource, verb)`：apiGroups 有 `"*"` 或 group、resources 有 `"*"`、resource 本身或 `"<資源>/*"`、verbs 有 `"*"` 或 verb，三者都成立才算允許。每一種風險都用它來問。',
      '角色的 key 要自己組：ClusterRole 是 `"ClusterRole/" + name`；RoleBinding 指到的 Role 是 `"Role/" + binding 的 namespace + "/" + name`。',
      '`list` 與 `watch` 也算讀得到 Secret；只寫 `"pods"` 的規則不包含 `pods/exec`，`"pods/*"` 或 `"*"` 才包含。`node-proxy` 只在 ClusterRoleBinding 回報。',
    ],
    tests: [
      { name: 'cluster-admin 用 ClusterRoleBinding 綁：六種風險都在', code: `_roles = {"ClusterRole/cluster-admin": [{"apiGroups": ["*"], "resources": ["*"], "verbs": ["*"]}]}
_b = [{"kind": "ClusterRoleBinding", "roleRef": {"kind": "ClusterRole", "name": "cluster-admin"},
       "subjects": [{"kind": "Group", "name": "kubeadm:cluster-admins"}]}]
_r = find_risks(_roles, _b)
_want = sorted(("group:kubeadm:cluster-admins", "*", k) for k in
               ["wildcard", "read-secrets", "exec", "create-workloads", "escalation", "node-proxy"])
assert _r == _want, _r` },
      { name: '同一個 cluster-admin 用 RoleBinding 綁：範圍是那個 namespace，沒有 node-proxy', code: `_roles = {"ClusterRole/cluster-admin": [{"apiGroups": ["*"], "resources": ["*"], "verbs": ["*"]}]}
_b = [{"kind": "RoleBinding", "namespace": "pharmacy", "roleRef": {"kind": "ClusterRole", "name": "cluster-admin"},
       "subjects": [{"kind": "User", "name": "oidc:vendor.lee"}]}]
_r = find_risks(_roles, _b)
_want = sorted(("oidc:vendor.lee", "pharmacy", k) for k in
               ["wildcard", "read-secrets", "exec", "create-workloads", "escalation"])
assert _r == _want, _r` },
      { name: 'Secret 與 exec：list 也算、API 群組要對、pods 不含子資源', code: `_roles = {
    "ClusterRole/lister": [{"apiGroups": [""], "resources": ["secrets"], "verbs": ["list"]}],
    "ClusterRole/wrong-group": [{"apiGroups": ["apps"], "resources": ["secrets"], "verbs": ["get"]}],
    "ClusterRole/pod-sub": [{"apiGroups": [""], "resources": ["pods/*"], "verbs": ["get"]}],
    "ClusterRole/pods-only": [{"apiGroups": [""], "resources": ["pods"], "verbs": ["get", "create"]}],
}
def _rb(name, user):
    return {"kind": "RoleBinding", "namespace": "clinic", "roleRef": {"kind": "ClusterRole", "name": name},
            "subjects": [{"kind": "User", "name": user}]}
assert find_risks(_roles, [_rb("lister", "a")]) == [("a", "clinic", "read-secrets")], "list secrets 的回應就帶著內容"
assert find_risks(_roles, [_rb("wrong-group", "b")]) == [], "secrets 在 core group，apps 群組的 secrets 不存在"
assert find_risks(_roles, [_rb("pod-sub", "c")]) == [("c", "clinic", "exec")], "pods/* 涵蓋 pods/exec，任何動詞都算"
_r = find_risks(_roles, [_rb("pods-only", "d")])
assert _r == [("d", "clinic", "create-workloads")], _r` },
      { name: 'Role 的解析：同一個 namespace、找不到就不給、ClusterRoleBinding 不能指向 Role', code: `_roles = {"Role/pharmacy/helper": [{"apiGroups": [""], "resources": ["secrets"], "verbs": ["get"]}]}
_b = [
    {"kind": "RoleBinding", "namespace": "clinic", "roleRef": {"kind": "Role", "name": "helper"},
     "subjects": [{"kind": "User", "name": "x"}]},
    {"kind": "RoleBinding", "namespace": "pharmacy", "roleRef": {"kind": "Role", "name": "missing"},
     "subjects": [{"kind": "User", "name": "y"}]},
    {"kind": "ClusterRoleBinding", "roleRef": {"kind": "Role", "name": "helper"},
     "subjects": [{"kind": "User", "name": "z"}]},
]
assert find_risks(_roles, _b) == [], find_risks(_roles, _b)
_b.append({"kind": "RoleBinding", "namespace": "pharmacy", "roleRef": {"kind": "Role", "name": "helper"},
           "subjects": [{"kind": "ServiceAccount", "name": "report-bot", "namespace": "pharmacy"}]})
_r = find_risks(_roles, _b)
assert _r == [("system:serviceaccount:pharmacy:report-bot", "pharmacy", "read-secrets")], _r` },
      { name: '部署帳號只有 create-workloads；只讀與 pods/log 不算風險', code: `_roles = {"ClusterRole/app-deployer": [
    {"apiGroups": ["apps"], "resources": ["deployments"], "verbs": ["get", "list", "watch", "create", "patch"]},
    {"apiGroups": ["batch"], "resources": ["jobs"], "verbs": ["get", "create"]},
    {"apiGroups": [""], "resources": ["services", "configmaps", "pods", "pods/log", "events"], "verbs": ["get", "list", "watch"]},
]}
_b = [
    {"kind": "RoleBinding", "namespace": "clinic", "roleRef": {"kind": "ClusterRole", "name": "app-deployer"},
     "subjects": [{"kind": "ServiceAccount", "name": "gitlab-deployer", "namespace": "clinic"}]},
    {"kind": "RoleBinding", "namespace": "pharmacy", "roleRef": {"kind": "ClusterRole", "name": "app-deployer"},
     "subjects": [{"kind": "ServiceAccount", "name": "gitlab-deployer", "namespace": "pharmacy"}]},
]
_r = find_risks(_roles, _b)
assert _r == [("system:serviceaccount:clinic:gitlab-deployer", "clinic", "create-workloads"),
              ("system:serviceaccount:pharmacy:gitlab-deployer", "pharmacy", "create-workloads")], _r` },
      { name: '萬用字元與提權：* 不一定等於每一種風險', code: `_roles = {
    "ClusterRole/any-group-cm": [{"apiGroups": ["*"], "resources": ["configmaps"], "verbs": ["get"]}],
    "ClusterRole/cm-all-verbs": [{"apiGroups": [""], "resources": ["configmaps"], "verbs": ["*"]}],
    "ClusterRole/grantor": [{"apiGroups": ["rbac.authorization.k8s.io"], "resources": ["clusterroles"], "verbs": ["bind"]}],
    "ClusterRole/sa-impersonator": [{"apiGroups": [""], "resources": ["serviceaccounts"], "verbs": ["impersonate"]}],
}
def _crb(name, group):
    return {"kind": "ClusterRoleBinding", "roleRef": {"kind": "ClusterRole", "name": name},
            "subjects": [{"kind": "Group", "name": group}]}
assert find_risks(_roles, [_crb("any-group-cm", "g1")]) == [("group:g1", "*", "wildcard")]
_r = find_risks(_roles, [_crb("cm-all-verbs", "g2")])
assert _r == [("group:g2", "*", "wildcard")], "configmaps 的 * 動詞不包含對 clusterroles 的 escalate：" + str(_r)
assert find_risks(_roles, [_crb("grantor", "g3")]) == [("group:g3", "*", "escalation")]
assert find_risks(_roles, [_crb("sa-impersonator", "g4")]) == [("group:g4", "*", "escalation")]` },
      { name: 'nodes/proxy 只有 ClusterRoleBinding 給得到；結果排序且不重複', code: `_roles = {
    "ClusterRole/node-debug": [{"apiGroups": [""], "resources": ["nodes", "nodes/proxy"], "verbs": ["get"]}],
    "ClusterRole/node-read": [{"apiGroups": [""], "resources": ["nodes"], "verbs": ["get", "list"]}],
}
_b = [
    {"kind": "RoleBinding", "namespace": "clinic", "roleRef": {"kind": "ClusterRole", "name": "node-debug"},
     "subjects": [{"kind": "User", "name": "wang"}]},
    {"kind": "ClusterRoleBinding", "roleRef": {"kind": "ClusterRole", "name": "node-debug"},
     "subjects": [{"kind": "User", "name": "lin"}, {"kind": "User", "name": "chen"}]},
    {"kind": "ClusterRoleBinding", "roleRef": {"kind": "ClusterRole", "name": "node-debug"},
     "subjects": [{"kind": "User", "name": "lin"}]},
    {"kind": "ClusterRoleBinding", "roleRef": {"kind": "ClusterRole", "name": "node-read"},
     "subjects": [{"kind": "User", "name": "auditor"}]},
]
_r = find_risks(_roles, _b)
assert _r == [("chen", "*", "node-proxy"), ("lin", "*", "node-proxy")], _r` },
    ],
  },
]

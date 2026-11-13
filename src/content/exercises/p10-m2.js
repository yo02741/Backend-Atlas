// 程式題：p10-m2（Kubernetes 實作四課）
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

export default [
  {
    id: 'k8s-manifests-1', skill: 'k8s-manifests', kind: 'config', level: 2, file: 'deployment.yaml',
    title: '把 Deployment 與 Service 接起來',
    prompt: '這份 `deployment.yaml` 把 `booking-api` 的 Deployment 與 Service 寫在同一個檔案。程式在容器裡監聽 **8000**。目前有五個問題：只有一個副本、image 用 `latest`、Deployment 的 selector 與 Pod 範本的 label 不一致、Service 的 selector 選不到 Pod、Service 把流量轉到錯的 port。\n\n修改成：\n\n- `replicas` 至少 2\n- `image` 用固定的 tag（例如 commit SHA `3f9c2a1b`），不用 `latest`，也不能省略 tag\n- Deployment 的 `selector.matchLabels` 每一組 label，`template.metadata.labels` 都要有而且值相同\n- Service 的 `selector` 每一組 label，Pod 範本的 label 都要有而且值相同；Service 與 Deployment 在同一個 namespace\n- Service 的 `targetPort` 對到容器的 `containerPort`（寫數字，或寫容器 port 的 `name`），而且是 8000',
    starter: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: booking-api
  namespace: booking
spec:
  replicas: 1
  selector:
    matchLabels:
      app: booking-api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
        - name: api
          image: registry.example.org/booking/api:latest
          ports:
            - containerPort: 8000
---
apiVersion: v1
kind: Service
metadata:
  name: booking-api
  namespace: booking
spec:
  selector:
    app: booking_api
  ports:
    - port: 80
      targetPort: 8080
`,
    solution: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: booking-api
  namespace: booking
spec:
  replicas: 3
  selector:
    matchLabels:
      app: booking-api
  template:
    metadata:
      labels:
        app: booking-api          # 要包含 selector 的每一組 label
    spec:
      containers:
        - name: api
          image: registry.example.org/booking/api:3f9c2a1b   # 固定 tag
          ports:
            - name: http
              containerPort: 8000
---
apiVersion: v1
kind: Service
metadata:
  name: booking-api
  namespace: booking
spec:
  selector:
    app: booking-api              # 對到 Pod 的 label
  ports:
    - port: 80
      targetPort: http            # 用容器 port 的名稱；寫 8000 也可以
`,
    hints: [
      'label 的比對是逐字的：`booking-api` 與 `booking_api`、`api` 都不一樣。selector 列出的每一組鍵值，Pod 範本的 label 都要有。',
      'Service 的 `port` 是 Service 自己開的 port，`targetPort` 才是轉給 Pod 的 port；程式聽 8000，`targetPort` 就要是 8000（或指向 containerPort 8000 的名稱）。',
      'image 的 tag 是最後一個冒號後面的部分；`registry.example.org:5000/booking/api` 這種寫法的冒號是 registry 的 port，不算 tag。',
    ],
    tests: [
      { name: '檔案裡有一個 Deployment（apps/v1）與一個 Service（v1）', code: YAML + R`
const dep = kind('Deployment'), svc = kind('Service')
assert(dep, '找不到 kind: Deployment 的文件（兩份文件之間用 --- 分隔）')
assert(svc, '找不到 kind: Service 的文件（兩份文件之間用 --- 分隔）')
assertEqual(dep.apiVersion, 'apps/v1', 'Deployment 的 apiVersion')
assertEqual(svc.apiVersion, 'v1', 'Service 的 apiVersion')
` },
      { name: 'replicas 至少 2', code: YAML + R`
const n = Number(get(kind('Deployment'), 'spec.replicas'))
assert(Number.isInteger(n), 'Deployment 要寫 spec.replicas（整數）')
assert(n >= 2, 'replicas 是 ' + n + '：只有一個副本時，更新或節點故障都會中斷服務')
` },
      { name: 'image 用固定 tag，不是 latest', code: YAML + R`
const cs = list(get(kind('Deployment'), 'spec.template.spec.containers'))
assert(cs.length, '找不到 spec.template.spec.containers')
for (const c of cs) {
  const img = String(c.image || '')
  assert(img, '容器 ' + c.name + ' 沒有 image')
  if (/@sha256:[0-9a-f]{64}$/.test(img)) continue
  const last = img.split('/').pop()
  const tag = last.includes(':') ? last.split(':').pop() : ''
  assert(tag, 'image 沒有寫 tag（等同 latest）：' + img)
  assert(tag !== 'latest', 'image 還在用 latest：' + img)
}
` },
      { name: 'Deployment 的 selector 與 Pod 範本的 label 一致', code: YAML + R`
const dep = kind('Deployment')
const sel = get(dep, 'spec.selector.matchLabels'), labels = get(dep, 'spec.template.metadata.labels')
assert(isMap(sel) && Object.keys(sel).length, 'Deployment 要有 spec.selector.matchLabels')
assert(isMap(labels), 'Pod 範本要有 spec.template.metadata.labels')
for (const k of Object.keys(sel)) assertEqual(labels[k], sel[k], 'selector 的 ' + k + ' 與 Pod 範本的 label 不一致')
` },
      { name: 'Service 的 selector 選得到 Pod，而且在同一個 namespace', code: YAML + R`
const dep = kind('Deployment'), svc = kind('Service')
const sel = get(svc, 'spec.selector'), labels = get(dep, 'spec.template.metadata.labels') || {}
assert(isMap(sel) && Object.keys(sel).length, 'Service 要有 spec.selector')
for (const k of Object.keys(sel)) assertEqual(labels[k], sel[k], 'Service 的 selector ' + k + ' 對不到 Pod 的 label')
assertEqual(get(svc, 'metadata.namespace') || 'default', get(dep, 'metadata.namespace') || 'default', 'Service 與 Deployment 的 namespace')
` },
      { name: 'targetPort 對到容器的 containerPort 8000', code: YAML + R`
const dep = kind('Deployment'), svc = kind('Service')
const cports = list(get(dep, 'spec.template.spec.containers')).flatMap((c) => list(c.ports))
assert(cports.some((p) => Number(p.containerPort) === 8000), '容器要宣告 containerPort: 8000（程式監聽的 port）')
const sports = list(get(svc, 'spec.ports'))
assert(sports.length, 'Service 要有 spec.ports')
for (const p of sports) {
  assert(p.port, 'Service 的每個 port 都要寫 port')
  const t = p.targetPort === undefined || p.targetPort === null ? p.port : p.targetPort
  const hit = /^\d+$/.test(String(t)) ? cports.find((c) => Number(c.containerPort) === Number(t)) : cports.find((c) => c.name === t)
  assert(hit, 'targetPort ' + t + ' 對不到任何 containerPort（數字或名稱）')
  assertEqual(Number(hit.containerPort), 8000, 'targetPort 對到的容器 port')
}
` },
    ],
  },
  {
    id: 'k8s-config-probes-1', skill: 'k8s-config-probes', kind: 'config', level: 2, file: 'deployment.yaml',
    title: '補上探針、資源、Secret 與非 root',
    prompt: '這份 Deployment 能跑，但還不能上線：沒有探針、沒有資源設定、資料庫密碼寫死在檔案裡、容器以映像預設的使用者執行。\n\n已知：程式監聽 8000，`/healthz` 只回報程序本身、`/ready` 會檢查資料庫連線；映像裡的使用者 UID 是 10001；叢集裡已經有名為 `booking-secrets` 的 Secret，鍵是 `DB_PASSWORD`。\n\n替 `api` 容器補上：\n\n- `readinessProbe`：用 `httpGet` 打 `/ready`\n- `livenessProbe`：用 `httpGet` 打 `/healthz`（不能打會檢查資料庫的 `/ready`）\n- 探針的 `port` 是 8000，或容器 port 的名稱\n- `resources`：`requests` 的 `cpu` 與 `memory`、`limits` 的 `memory`（limits 不能小於 requests；CPU 的 limits 可寫可不寫）\n- `DB_PASSWORD` 改成從 Secret `booking-secrets` 讀取（`valueFrom.secretKeyRef`，或用 `envFrom` 的 `secretRef` 整批帶入）；檔案裡不能再有密碼的明文，也不要把 Secret 物件本身寫進這個檔案\n- `securityContext`：`runAsNonRoot: true`（Pod 層或容器層皆可；有寫 `runAsUser` 的話不能是 0），並在容器層設定 `allowPrivilegeEscalation: false`',
    starter: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: booking-api
  namespace: booking
spec:
  replicas: 3
  selector:
    matchLabels:
      app: booking-api
  template:
    metadata:
      labels:
        app: booking-api
    spec:
      containers:
        - name: api
          image: registry.example.org/booking/api:3f9c2a1b
          ports:
            - name: http
              containerPort: 8000
          env:
            - name: DB_HOST
              value: booking-db
            - name: DB_PASSWORD
              value: "S3cret-2024!"
`,
    solution: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: booking-api
  namespace: booking
spec:
  replicas: 3
  selector:
    matchLabels:
      app: booking-api
  template:
    metadata:
      labels:
        app: booking-api
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001            # 和映像裡的使用者 UID 一致
      containers:
        - name: api
          image: registry.example.org/booking/api:3f9c2a1b
          ports:
            - name: http
              containerPort: 8000
          env:
            - name: DB_HOST
              value: booking-db
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:       # 值在叢集的 Secret 裡，不在這個檔案
                  name: booking-secrets
                  key: DB_PASSWORD
          readinessProbe:           # 失敗：從 Service 的後端移出
            httpGet:
              path: /ready
              port: http
            periodSeconds: 5
            timeoutSeconds: 2
          livenessProbe:            # 失敗：重啟容器，所以只檢查程序本身
            httpGet:
              path: /healthz
              port: http
            periodSeconds: 10
            timeoutSeconds: 2
          resources:
            requests:
              cpu: "250m"
              memory: "256Mi"
            limits:
              memory: "512Mi"
          securityContext:
            allowPrivilegeEscalation: false
`,
    hints: [
      '探針寫在容器底下，和 `image`、`ports` 同一層：`readinessProbe:` → `httpGet:` → `path` 與 `port`。',
      '單一變數從 Secret 讀：`env` 的項目不寫 `value`，改寫 `valueFrom:` → `secretKeyRef:` → `name` 與 `key`。',
      '`runAsNonRoot` 與 `runAsUser` 可以放在 `spec.template.spec.securityContext`（Pod 層）；`allowPrivilegeEscalation` 只能放在容器的 `securityContext`。',
      '記憶體單位用 `Mi`、`Gi`；小寫 `m` 是千分之一，`512m` 的記憶體是 0.512 位元組。',
    ],
    tests: [
      { name: 'readinessProbe 用 httpGet 打 /ready', code: YAML + R`
const c = list(get(kind('Deployment'), 'spec.template.spec.containers')).find((x) => x.name === 'api')
assert(c, '找不到名為 api 的容器')
const h = get(c, 'readinessProbe.httpGet')
assert(isMap(h), 'api 容器要有 readinessProbe，並用 httpGet')
assertEqual(h.path, '/ready', 'readinessProbe 的 path')
const ports = list(c.ports)
assert(Number(h.port) === 8000 || ports.some((p) => p.name === h.port && Number(p.containerPort) === 8000), 'readinessProbe 的 port 要是 8000 或容器 port 的名稱')
` },
      { name: 'livenessProbe 用 httpGet 打 /healthz，不檢查資料庫', code: YAML + R`
const c = list(get(kind('Deployment'), 'spec.template.spec.containers')).find((x) => x.name === 'api')
assert(c, '找不到名為 api 的容器')
const h = get(c, 'livenessProbe.httpGet')
assert(isMap(h), 'api 容器要有 livenessProbe，並用 httpGet')
assert(h.path !== '/ready', 'livenessProbe 不能打 /ready：資料庫一中斷，所有 Pod 會同時被重啟')
assertEqual(h.path, '/healthz', 'livenessProbe 的 path')
const ports = list(c.ports)
assert(Number(h.port) === 8000 || ports.some((p) => p.name === h.port && Number(p.containerPort) === 8000), 'livenessProbe 的 port 要是 8000 或容器 port 的名稱')
` },
      { name: '有 requests（cpu、memory）與 limits（memory），而且 limits 不小於 requests', code: YAML + R`
const c = list(get(kind('Deployment'), 'spec.template.spec.containers')).find((x) => x.name === 'api')
assert(c, '找不到名為 api 的容器')
const rq = get(c, 'resources.requests') || {}, lm = get(c, 'resources.limits') || {}
assert(rq.cpu, '缺少 resources.requests.cpu')
assert(rq.memory, '缺少 resources.requests.memory')
assert(lm.memory, '缺少 resources.limits.memory')
const UNIT = { '': 1, m: 1e-3, k: 1e3, M: 1e6, G: 1e9, T: 1e12, Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4 }
const qty = (s) => { const m = /^([0-9.]+)([A-Za-z]*)$/.exec(String(s)); assert(m && m[2] in UNIT, '看不懂的數量：' + s); return Number(m[1]) * UNIT[m[2]] }
for (const k of ['cpu', 'memory']) assert(qty(rq[k]) > 0, 'requests.' + k + ' 要大於 0')
assert(qty(rq.memory) >= 1024 ** 2 && qty(lm.memory) >= 1024 ** 2, '記憶體不到 1Mi：單位是不是寫成小寫 m 了？記憶體用 Mi、Gi')
assert(qty(lm.memory) >= qty(rq.memory), 'limits.memory 不能小於 requests.memory')
if (lm.cpu) assert(qty(lm.cpu) >= qty(rq.cpu), 'limits.cpu 不能小於 requests.cpu')
` },
      { name: 'DB_PASSWORD 從 Secret booking-secrets 讀取，檔案裡沒有明文', code: YAML + R`
assert(!source.includes('S3cret-2024!'), '檔案裡還有密碼的明文')
assert(!load().some((d) => d.kind === 'Secret'), '不要把 Secret 物件寫進這個檔案：它的值只是 base64，會跟著進 Git')
const c = list(get(kind('Deployment'), 'spec.template.spec.containers')).find((x) => x.name === 'api')
assert(c, '找不到名為 api 的容器')
const e = list(c.env).find((x) => x.name === 'DB_PASSWORD')
const fromAll = list(c.envFrom).some((x) => get(x, 'secretRef.name') === 'booking-secrets')
assert(e || fromAll, '容器要拿得到 DB_PASSWORD：用 env 的 valueFrom.secretKeyRef，或 envFrom 的 secretRef')
if (e) {
  assert(e.value === undefined, 'DB_PASSWORD 不能用 value 寫死，改用 valueFrom.secretKeyRef')
  assertEqual(get(e, 'valueFrom.secretKeyRef.name'), 'booking-secrets', 'secretKeyRef.name')
  assertEqual(get(e, 'valueFrom.secretKeyRef.key'), 'DB_PASSWORD', 'secretKeyRef.key')
}
` },
      { name: '以非 root 執行，且不允許提權', code: YAML + R`
const spec = get(kind('Deployment'), 'spec.template.spec') || {}
const c = list(spec.containers).find((x) => x.name === 'api')
assert(c, '找不到名為 api 的容器')
const pod = isMap(spec.securityContext) ? spec.securityContext : {}, con = isMap(c.securityContext) ? c.securityContext : {}
const eff = (k) => (con[k] !== undefined ? con[k] : pod[k])
assertEqual(String(eff('runAsNonRoot')), 'true', 'runAsNonRoot（Pod 層或容器層）')
if (eff('runAsUser') !== undefined) assert(Number(eff('runAsUser')) > 0, 'runAsUser 不能是 0（root）')
assertEqual(String(con.allowPrivilegeEscalation), 'false', '容器層的 allowPrivilegeEscalation')
` },
      { name: '原本的設定還在', code: YAML + R`
const dep = kind('Deployment')
assert(dep, '找不到 kind: Deployment')
const c = list(get(dep, 'spec.template.spec.containers')).find((x) => x.name === 'api')
assert(c, '找不到名為 api 的容器')
assert(/:[\w][\w.-]*$/.test(String(c.image)) && !/:latest$/.test(String(c.image)), 'image 要保留固定的 tag')
assert(list(c.ports).some((p) => Number(p.containerPort) === 8000), '容器的 containerPort 8000 不見了')
const hasHost = list(c.env).some((x) => x.name === 'DB_HOST') || list(c.envFrom).some((x) => isMap(x.configMapRef))
assert(hasHost, 'DB_HOST 不見了（留在 env，或改由 ConfigMap 的 envFrom 帶入）')
` },
    ],
  },
  {
    id: 'k8s-troubleshooting-1', skill: 'k8s-troubleshooting', kind: 'python', level: 2,
    title: '依狀態、結束碼與 Events 診斷 Pod',
    prompt: '實作 `diagnose(pod) -> dict`，把一個 Pod 的狀態分類，回傳 `{"category": 分類代碼, "action": ACTIONS[分類代碼]}`。\n\n`pod` 的欄位：`phase`（`Pending` / `Running`）、`ready`（布林）、`restarts`（整數）、`waiting`（容器等待中的原因，沒有就是 `None`）、`last_reason` 與 `exit_code`（上一次結束的原因與結束碼，沒有就是 `None`）、`events`（清單，每筆是 `{"reason": ..., "message": ...}`）。\n\n**依下列順序**判斷，符合就回傳：\n\n- `last_reason` 是 `OOMKilled` → `oom-killed`（不管現在的狀態是什麼）\n- `waiting` 是 `ImagePullBackOff` 或 `ErrImagePull`：任何一則 event 的訊息含 `unauthorized`、`denied` 或 `authentication required` → `image-auth`；否則 → `image-not-found`\n- `waiting` 是 `CreateContainerConfigError` → `config-missing`\n- `waiting` 是 `CrashLoopBackOff`：有 event 的 `reason` 是 `Unhealthy` 且訊息以 `Liveness probe failed` 開頭 → `liveness-kill`；`exit_code` 是 0 → `exited-normally`；否則 → `app-crash`\n- `phase` 是 `Pending`（而且沒有 `waiting`）：看 `reason` 是 `FailedScheduling` 的 event 訊息，含 `PersistentVolumeClaim` → `pvc-unbound`；含 `Insufficient` → `insufficient-resources`；含 `taint`、`affinity` 或 `selector` → `no-matching-node`；都沒有 → `unknown`\n- `phase` 是 `Running` 且 `ready` 是 `False` → `not-ready`\n- `phase` 是 `Running` 且 `ready` 是 `True` → `healthy`\n- 其他 → `unknown`\n\n同一則訊息同時符合多個關鍵字時，取上面先列出的那一個。',
    starter: `ACTIONS = {
    "oom-killed": "看記憶體曲線：穩定偏高就調高 limits，一路上升就是洩漏",
    "image-auth": "建立 imagePullSecrets，或檢查 registry 的權限",
    "image-not-found": "到 registry 確認映像名稱與 tag",
    "config-missing": "建立缺少的 ConfigMap 或 Secret，或修正參照的名稱",
    "liveness-kill": "加 startupProbe；liveness 只檢查程序本身",
    "exited-normally": "一次性的工作改用 Job 或 CronJob",
    "app-crash": "kubectl logs --previous 看上一次的輸出",
    "pvc-unbound": "kubectl describe pvc，檢查 StorageClass",
    "insufficient-resources": "檢查 requests 與節點已分配的資源，或加節點",
    "no-matching-node": "檢查 taint、nodeSelector 與 affinity",
    "not-ready": "kubectl describe pod 看 readiness 探針失敗的訊息",
    "healthy": "不用處理",
    "unknown": "kubectl describe pod 看 Events",
}


def diagnose(pod: dict) -> dict:
    # TODO：現在只看 phase，CrashLoopBackOff、OOMKilled、拉不到映像都分不出來
    category = "healthy" if pod["phase"] == "Running" else "unknown"
    return {"category": category, "action": ACTIONS[category]}


pod = {
    "phase": "Running", "ready": True, "restarts": 12, "waiting": None,
    "last_reason": "OOMKilled", "exit_code": 137, "events": [],
}
print(diagnose(pod))
`,
    solution: `ACTIONS = {
    "oom-killed": "看記憶體曲線：穩定偏高就調高 limits，一路上升就是洩漏",
    "image-auth": "建立 imagePullSecrets，或檢查 registry 的權限",
    "image-not-found": "到 registry 確認映像名稱與 tag",
    "config-missing": "建立缺少的 ConfigMap 或 Secret，或修正參照的名稱",
    "liveness-kill": "加 startupProbe；liveness 只檢查程序本身",
    "exited-normally": "一次性的工作改用 Job 或 CronJob",
    "app-crash": "kubectl logs --previous 看上一次的輸出",
    "pvc-unbound": "kubectl describe pvc，檢查 StorageClass",
    "insufficient-resources": "檢查 requests 與節點已分配的資源，或加節點",
    "no-matching-node": "檢查 taint、nodeSelector 與 affinity",
    "not-ready": "kubectl describe pod 看 readiness 探針失敗的訊息",
    "healthy": "不用處理",
    "unknown": "kubectl describe pod 看 Events",
}


def classify(pod: dict) -> str:
    events = pod.get("events") or []
    messages = [e.get("message", "") for e in events]
    waiting = pod.get("waiting")

    # 上一次的結束原因最優先：OOMKilled 的 Pod 現在可能是 Running，也可能是 CrashLoopBackOff
    if pod.get("last_reason") == "OOMKilled":
        return "oom-killed"

    if waiting in ("ImagePullBackOff", "ErrImagePull"):
        auth_words = ("unauthorized", "denied", "authentication required")
        if any(w in m for m in messages for w in auth_words):
            return "image-auth"
        return "image-not-found"

    if waiting == "CreateContainerConfigError":
        return "config-missing"

    if waiting == "CrashLoopBackOff":
        killed_by_liveness = any(
            e.get("reason") == "Unhealthy" and e.get("message", "").startswith("Liveness probe failed")
            for e in events
        )
        if killed_by_liveness:
            return "liveness-kill"
        if pod.get("exit_code") == 0:
            return "exited-normally"
        return "app-crash"

    if pod.get("phase") == "Pending" and waiting is None:
        text = " ".join(e.get("message", "") for e in events if e.get("reason") == "FailedScheduling")
        if "PersistentVolumeClaim" in text:
            return "pvc-unbound"
        if "Insufficient" in text:
            return "insufficient-resources"
        if any(w in text for w in ("taint", "affinity", "selector")):
            return "no-matching-node"
        return "unknown"

    if pod.get("phase") == "Running":
        return "healthy" if pod.get("ready") else "not-ready"
    return "unknown"


def diagnose(pod: dict) -> dict:
    category = classify(pod)
    return {"category": category, "action": ACTIONS[category]}


pod = {
    "phase": "Running", "ready": True, "restarts": 12, "waiting": None,
    "last_reason": "OOMKilled", "exit_code": 137, "events": [],
}
print(diagnose(pod))
`,
    hints: [
      '順序就是重點：先看 `last_reason`，再看 `waiting`，然後才是 `phase` 與 `ready`。',
      'OOMKilled 的 Pod 重啟後可能是 `Running`、`READY 1/1`，也可能是 `CrashLoopBackOff`；只看現在的狀態會漏掉。',
      'Pending 只看 `reason` 是 `FailedScheduling` 的 event；關鍵字依 PersistentVolumeClaim → Insufficient → taint / affinity / selector 的順序檢查。',
    ],
    tests: [
      { name: '正常與 readiness 沒通過', code: `def _pod(**kw):
    base = {"phase": "Running", "ready": True, "restarts": 0, "waiting": None, "last_reason": None, "exit_code": None, "events": []}
    base.update(kw)
    return base
_r = diagnose(_pod())
assert _r == {"category": "healthy", "action": ACTIONS["healthy"]}, _r
_r = diagnose(_pod(ready=False, events=[{"reason": "Unhealthy", "message": "Readiness probe failed: HTTP probe failed with statuscode: 503"}]))
assert _r == {"category": "not-ready", "action": ACTIONS["not-ready"]}, _r` },
      { name: 'OOMKilled 最優先：現在是 Running 或 CrashLoopBackOff 都要抓到', code: `def _pod(**kw):
    base = {"phase": "Running", "ready": True, "restarts": 0, "waiting": None, "last_reason": None, "exit_code": None, "events": []}
    base.update(kw)
    return base
_r = diagnose(_pod(restarts=12, last_reason="OOMKilled", exit_code=137))
assert _r["category"] == "oom-killed", _r
_r = diagnose(_pod(ready=False, restarts=6, waiting="CrashLoopBackOff", last_reason="OOMKilled", exit_code=137,
                   events=[{"reason": "BackOff", "message": "Back-off restarting failed container api"}]))
assert _r["category"] == "oom-killed", _r
assert _r["action"] == ACTIONS["oom-killed"]` },
      { name: '拉不到映像：分辨不存在與沒有權限', code: `def _pod(**kw):
    base = {"phase": "Pending", "ready": False, "restarts": 0, "waiting": None, "last_reason": None, "exit_code": None, "events": []}
    base.update(kw)
    return base
_r = diagnose(_pod(waiting="ImagePullBackOff", events=[{"reason": "Failed", "message": "Failed to pull image \\"registry.example.org/booking/web:3f9c2a1\\": not found"}]))
assert _r["category"] == "image-not-found", _r
_r = diagnose(_pod(waiting="ErrImagePull", events=[{"reason": "Failed", "message": "failed to authorize: 401 unauthorized"}]))
assert _r["category"] == "image-auth", _r
_r = diagnose(_pod(waiting="ImagePullBackOff", events=[
    {"reason": "Pulling", "message": "Pulling image \\"registry.example.org/private/app:1.0\\""},
    {"reason": "Failed", "message": "pull access denied, repository does not exist or may require authorization"},
    {"reason": "BackOff", "message": "Back-off pulling image"},
]))
assert _r["category"] == "image-auth", _r
_r = diagnose(_pod(waiting="ImagePullBackOff", events=[]))
assert _r["category"] == "image-not-found", _r` },
      { name: 'CrashLoopBackOff：程式錯誤、被 liveness 重啟、正常結束', code: `def _pod(**kw):
    base = {"phase": "Running", "ready": False, "restarts": 5, "waiting": "CrashLoopBackOff", "last_reason": "Error", "exit_code": 1, "events": []}
    base.update(kw)
    return base
_r = diagnose(_pod())
assert _r == {"category": "app-crash", "action": ACTIONS["app-crash"]}, _r
_r = diagnose(_pod(exit_code=137, events=[
    {"reason": "Unhealthy", "message": "Liveness probe failed: Get \\"http://10.244.1.12:8000/healthz\\": context deadline exceeded"},
    {"reason": "Killing", "message": "Container api failed liveness probe, will be restarted"},
]))
assert _r["category"] == "liveness-kill", _r
_r = diagnose(_pod(events=[{"reason": "Unhealthy", "message": "Readiness probe failed: connection refused"}]))
assert _r["category"] == "app-crash", "readiness 失敗不會重啟容器，不能算 liveness-kill"
_r = diagnose(_pod(last_reason="Completed", exit_code=0))
assert _r["category"] == "exited-normally", _r` },
      { name: '設定缺漏', code: `_r = diagnose({"phase": "Pending", "ready": False, "restarts": 0, "waiting": "CreateContainerConfigError", "last_reason": None, "exit_code": None,
               "events": [{"reason": "Failed", "message": "Error: secret \\"booking-secrets\\" not found"}]})
assert _r == {"category": "config-missing", "action": ACTIONS["config-missing"]}, _r` },
      { name: 'Pending：PVC、資源不足、節點條件，以及關鍵字的先後', code: `def _pod(msg, reason="FailedScheduling", **kw):
    base = {"phase": "Pending", "ready": False, "restarts": 0, "waiting": None, "last_reason": None, "exit_code": None,
            "events": [{"reason": reason, "message": msg}]}
    base.update(kw)
    return base
assert diagnose(_pod("0/3 nodes are available: 3 Insufficient memory."))["category"] == "insufficient-resources"
assert diagnose(_pod("0/3 nodes are available: 3 node(s) had untolerated taint {dedicated: gpu}."))["category"] == "no-matching-node"
assert diagnose(_pod("0/3 nodes are available: 3 node(s) didn't match Pod's node affinity/selector."))["category"] == "no-matching-node"
assert diagnose(_pod("0/3 nodes are available: pod has unbound immediate PersistentVolumeClaims."))["category"] == "pvc-unbound"
_r = diagnose(_pod("0/3 nodes are available: 1 node(s) had untolerated taint {node-role.kubernetes.io/control-plane: }, 2 Insufficient cpu."))
assert _r["category"] == "insufficient-resources", "同時有 Insufficient 與 taint 時取 Insufficient"
assert diagnose(_pod("Successfully assigned booking/api to node-1", reason="Scheduled"))["category"] == "unknown", "只看 FailedScheduling 的訊息"
_r = diagnose({"phase": "Pending", "ready": False, "restarts": 0, "waiting": None, "last_reason": None, "exit_code": None, "events": []})
assert _r == {"category": "unknown", "action": ACTIONS["unknown"]}, _r` },
      { name: '不認得的狀態回 unknown，不丟例外', code: `_r = diagnose({"phase": "Failed", "ready": False, "restarts": 0, "waiting": None, "last_reason": "Error", "exit_code": 1, "events": []})
assert _r == {"category": "unknown", "action": ACTIONS["unknown"]}, _r
_r = diagnose({"phase": "Pending", "ready": False, "restarts": 0, "waiting": "ContainerCreating", "last_reason": None, "exit_code": None, "events": []})
assert _r["category"] == "unknown", _r` },
    ],
  },
  {
    id: 'k8s-helm-gitops-1', skill: 'k8s-helm-gitops', kind: 'config', level: 3, file: 'kustomization.yaml',
    title: '把複製貼上的環境改成 overlay',
    prompt: '這是 `overlays/production/kustomization.yaml`。目前的做法是把 base 的 `deployment.yaml`、`service.yaml` 複製到這個目錄再手改，而且 image 用 `latest`。同一個目錄裡已經有一份寫好的補丁 `patch-resources.yaml`（調整 production 的 requests 與 limits）。\n\n改成真正的 overlay：\n\n- `resources` 參照 `../../base`，不再列出複製來的 `deployment.yaml`、`service.yaml`\n- `namespace` 設成 `booking-prod`\n- `images`：把 `registry.example.org/booking/api` 的 `newTag` 設成固定的 tag（例如 `3f9c2a1b`），不用 `latest`\n- `replicas`：把名為 `booking-api` 的 Deployment 設成至少 3 個（用 `replicas` 欄位的 `name` 與 `count`）\n- `patches`：用 `path` 套用 `patch-resources.yaml`\n\n`apiVersion` 與 `kind` 保留。',
    starter: `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - deployment.yaml      # 從 base 複製過來再手改的
  - service.yaml

images:
  - name: registry.example.org/booking/api
    newTag: latest
`,
    solution: `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: booking-prod

resources:
  - ../../base           # 共同的部分只在 base 寫一次

images:
  - name: registry.example.org/booking/api
    newTag: 3f9c2a1b

replicas:
  - name: booking-api
    count: 6

patches:
  - path: patch-resources.yaml
`,
    hints: [
      '`resources` 可以指向另一個含有 `kustomization.yaml` 的目錄；從 `overlays/production` 到 `base` 的相對路徑是 `../../base`。',
      '`images` 與 `replicas` 是 Kustomize 內建的轉換：不用寫補丁就能換 tag 與副本數。',
      '`patches` 是清單，每一項用 `path` 指向補丁檔。',
    ],
    tests: [
      { name: '是一份 Kustomization', code: YAML + R`
const k = load()[0]
assert(k, '檔案是空的')
assertEqual(k.kind, 'Kustomization', 'kind')
assert(/^kustomize\.config\.k8s\.io\//.test(String(k.apiVersion)), 'apiVersion 要是 kustomize.config.k8s.io/v1beta1')
` },
      { name: 'resources 參照 ../../base，不再列出複製來的檔案', code: YAML + R`
const k = load()[0] || {}
assert(Array.isArray(k.resources) && k.resources.length, '要有 resources 清單')
const rs = k.resources.map((r) => String(r).replace(/\/+$/, ''))
assert(rs.includes('../../base'), 'resources 要參照 ../../base')
const extra = rs.filter((r) => /(^|\/)(deployment|service)\.ya?ml$/.test(r))
assert(!extra.length, 'resources 不要再列出複製來的檔案：' + extra.join(', '))
` },
      { name: 'namespace 是 booking-prod', code: YAML + R`
assertEqual((load()[0] || {}).namespace, 'booking-prod', 'namespace')
` },
      { name: 'image 用固定 tag，不是 latest', code: YAML + R`
const img = list((load()[0] || {}).images).find((x) => x.name === 'registry.example.org/booking/api')
assert(img, 'images 裡要有 name: registry.example.org/booking/api 的項目')
assert(img.newTag || img.digest, '要用 newTag（或 digest）指定版本')
if (img.newTag) assert(String(img.newTag) !== 'latest', 'newTag 還是 latest')
` },
      { name: 'booking-api 的副本數至少 3', code: YAML + R`
const r = list((load()[0] || {}).replicas).find((x) => x.name === 'booking-api')
assert(r, 'replicas 裡要有 name: booking-api 的項目')
const n = Number(r.count)
assert(Number.isInteger(n) && n >= 3, 'count 要是至少 3 的整數，目前是 ' + r.count)
` },
      { name: 'patches 套用 patch-resources.yaml', code: YAML + R`
const ps = list((load()[0] || {}).patches)
assert(ps.length, '要有 patches 清單，每一項用 path 指向補丁檔')
assert(ps.some((p) => String(p.path || '').replace(/^\.\//, '') === 'patch-resources.yaml'), 'patches 裡要有 path: patch-resources.yaml')
` },
    ],
  },
]

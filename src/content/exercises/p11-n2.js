// 程式題：p11-n2（k8s-storage）
// 設定檔題的測試碼是 JS：使用者內容是 `source`，`lines` 是去掉 # 註解與空行的各行。
// 測試碼用 String.raw 寫；測試碼裡不要出現 `${` 與反引號。
const R = String.raw

// 夠用的 YAML 子集解析（與 p10-m2.js 相同）：多份文件（---）、區塊式與單行 flow 式（{…}、[…]）的對應與清單、引號。
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

// 容量換算：'20Gi' -> 位元組；看不懂的單位回傳 NaN
const QTY = R`
function qty(s) {
  const UNIT = { '': 1, k: 1e3, M: 1e6, G: 1e9, T: 1e12, Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4 }
  const m = /^([0-9.]+)([A-Za-z]*)$/.exec(String(s || ''))
  return m && m[2] in UNIT ? Number(m[1]) * UNIT[m[2]] : NaN
}
`

export default [
  {
    id: 'k8s-storage-1', skill: 'k8s-storage', kind: 'config', level: 2, file: 'report.yaml',
    title: '修好報表服務的 PVC 與 Deployment',
    prompt: '報表服務 `clinic-report` 把 PDF 寫到環境變數 `REPORT_DIR` 指定的目錄。月初要 3 個副本，三個 Pod 都要讀寫同一批 PDF。這份 `report.yaml` 套用後 PVC 停在 Pending；就算 PVC 綁好了，也只有一個 Pod 起得來，而且 PDF 沒有寫進 volume。\n\n叢集裡的 StorageClass：\n\n- `longhorn`（預設）：區塊儲存，需要 attach，給 ReadWriteOnce 用\n- `nfs-csi`：接院內的 NAS，支援 ReadWriteMany；依團隊的規定，多個 Pod 共用的檔案放這裡\n\n修改成：\n\n- Deployment 維持 3 個副本\n- PVC 的存取模式是 `ReadWriteMany`，`storageClassName` 是 `nfs-csi`，容量至少 20Gi\n- Deployment 的 volume 參照的 `claimName` 是這個 PVC 的名稱，PVC 與 Deployment 在同一個 namespace\n- 容器把這個 volume 掛在 `REPORT_DIR` 的路徑（`/srv/reports`，`REPORT_DIR` 本身不要改），不能是唯讀\n- `volumeMounts` 的 `name` 對得到 `volumes` 裡的項目',
    starter: `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: clinic-report-pdfs
  namespace: clinic
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: nfs
  resources:
    requests:
      storage: 20Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: clinic-report
  namespace: clinic
spec:
  replicas: 3
  selector:
    matchLabels:
      app: clinic-report
  template:
    metadata:
      labels:
        app: clinic-report
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
      containers:
        - name: report
          image: registry.gitlab.example/clinic/report:7c41d0e2
          env:
            - name: REPORT_DIR
              value: /srv/reports
          volumeMounts:
            - name: pdfs
              mountPath: /data
      volumes:
        - name: pdfs
          persistentVolumeClaim:
            claimName: clinic-report-pdf
`,
    solution: `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: clinic-report-pdfs
  namespace: clinic
spec:
  accessModes:
    - ReadWriteMany             # 3 個副本在不同節點同時讀寫
  storageClassName: nfs-csi     # 叢集裡存在、支援 RWX 的 class
  resources:
    requests:
      storage: 20Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: clinic-report
  namespace: clinic
spec:
  replicas: 3
  selector:
    matchLabels:
      app: clinic-report
  template:
    metadata:
      labels:
        app: clinic-report
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
      containers:
        - name: report
          image: registry.gitlab.example/clinic/report:7c41d0e2
          env:
            - name: REPORT_DIR
              value: /srv/reports
          volumeMounts:
            - name: pdfs
              mountPath: /srv/reports   # 和 REPORT_DIR 相同，PDF 才會寫進 volume
      volumes:
        - name: pdfs
          persistentVolumeClaim:
            claimName: clinic-report-pdfs   # 等於 PVC 的 metadata.name
`,
    hints: [
      'ReadWriteOnce 是「單一節點」可讀寫。3 個副本通常被排到不同節點，要多個節點同時讀寫，PVC 要用 `ReadWriteMany`。',
      '`storageClassName` 要和 `kubectl get storageclass` 列出的名稱完全一樣；名稱不存在時 PVC 停在 Pending，Events 是 `storageclass.storage.k8s.io "…" not found`。',
      '`claimName` 要等於 PVC 的 `metadata.name`，一個字都不能差。',
      '`mountPath` 寫錯不會有任何錯誤訊息，程式照樣寫進容器自己的檔案系統，重建後才發現檔案不見。對照容器的 `REPORT_DIR`。',
    ],
    tests: [
      { name: '檔案裡有一個 PersistentVolumeClaim 與一個 Deployment', code: YAML + R`
assert(kind('PersistentVolumeClaim'), '找不到 kind: PersistentVolumeClaim 的文件（兩份文件之間用 --- 分隔）')
assert(kind('Deployment'), '找不到 kind: Deployment 的文件')
assertEqual(kind('PersistentVolumeClaim').apiVersion, 'v1', 'PVC 的 apiVersion')
assertEqual(kind('Deployment').apiVersion, 'apps/v1', 'Deployment 的 apiVersion')
` },
      { name: 'Deployment 維持 3 個副本', code: YAML + R`
const n = Number(get(kind('Deployment'), 'spec.replicas'))
assertEqual(n, 3, 'spec.replicas（月初要 3 個副本，不要用縮成 1 個來避開問題）')
` },
      { name: 'PVC 用 ReadWriteMany', code: YAML + R`
const modes = get(kind('PersistentVolumeClaim'), 'spec.accessModes')
assert(Array.isArray(modes) && modes.length, 'PVC 要有 spec.accessModes（清單）')
assert(!modes.includes('ReadWriteOncePod'), 'ReadWriteOncePod 只允許一個 Pod 使用，另外兩個副本會停在 Pending')
assert(modes.includes('ReadWriteMany'), '存取模式是 ' + modes.join('、') + '：3 個副本分在不同節點時，ReadWriteOnce 只有一個節點能 attach，其他 Pod 停在 ContainerCreating（Multi-Attach error）')
` },
      { name: 'storageClassName 是叢集裡存在的 nfs-csi', code: YAML + R`
const cls = get(kind('PersistentVolumeClaim'), 'spec.storageClassName')
assert(cls !== undefined && cls !== null && cls !== '', '要寫 storageClassName：不寫會用預設的 longhorn，寫 "" 只會綁沒有 class 的 PV')
assert(cls !== 'longhorn', 'longhorn 在這個叢集只給 ReadWriteOnce 用，共用的檔案放 nfs-csi')
assertEqual(cls, 'nfs-csi', 'storageClassName（不存在的 class 會讓 PVC 一直停在 Pending）')
` },
      { name: 'PVC 的容量至少 20Gi', code: YAML + QTY + R`
const s = get(kind('PersistentVolumeClaim'), 'spec.resources.requests.storage')
assert(s, 'PVC 要有 spec.resources.requests.storage')
assert(!Number.isNaN(qty(s)), '看不懂的容量：' + s + '（用 Gi、Ti 這類單位）')
assert(qty(s) >= 20 * 1024 ** 3, '容量 ' + s + ' 小於 20Gi')
` },
      { name: 'claimName 對到這個 PVC，而且在同一個 namespace', code: YAML + R`
const pvc = kind('PersistentVolumeClaim'), dep = kind('Deployment')
const vols = list(get(dep, 'spec.template.spec.volumes'))
const refs = vols.filter((v) => isMap(v.persistentVolumeClaim))
assert(refs.length, 'Pod 範本的 volumes 要有一個 persistentVolumeClaim')
for (const v of refs) assertEqual(v.persistentVolumeClaim.claimName, get(pvc, 'metadata.name'), 'volume ' + v.name + ' 的 claimName（對不到 PVC 時 Pod 停在 Pending：persistentvolumeclaim "…" not found）')
assertEqual(get(dep, 'metadata.namespace') || 'default', get(pvc, 'metadata.namespace') || 'default', 'PVC 與 Deployment 的 namespace')
` },
      { name: 'volume 掛在 REPORT_DIR 的路徑，可以寫入', code: YAML + R`
const spec = get(kind('Deployment'), 'spec.template.spec') || {}
const c = list(spec.containers).find((x) => x.name === 'report')
assert(c, '找不到名為 report 的容器')
const env = list(c.env).find((e) => e.name === 'REPORT_DIR')
assert(env && env.value, 'REPORT_DIR 不見了')
assertEqual(env.value, '/srv/reports', 'REPORT_DIR（不要改程式寫檔的目錄，改 mountPath）')
const vols = list(spec.volumes)
const mounts = list(c.volumeMounts)
for (const m of mounts) assert(vols.some((v) => v.name === m.name), 'volumeMounts 的 ' + m.name + ' 在 volumes 裡找不到（API server 會拒絕這份 Deployment）')
const m = mounts.find((x) => { const v = vols.find((y) => y.name === x.name); return v && isMap(v.persistentVolumeClaim) })
assert(m, '容器要用 volumeMounts 掛上 PVC 的 volume')
assertEqual(m.mountPath, env.value, 'PVC 的 mountPath 要等於 REPORT_DIR，否則 PDF 寫進容器自己的檔案系統，重建後就不見')
assert(String(m.readOnly) !== 'true', '程式要寫檔，這個掛載不能是 readOnly')
` },
    ],
  },
  {
    id: 'k8s-storage-2', skill: 'k8s-storage', kind: 'config', level: 3, file: 'audit-store.yaml',
    title: '把需要固定名稱與各自資料的服務改成 StatefulSet',
    prompt: '院內的稽核紀錄服務 `audit-store` 跑 3 個節點：每個節點把自己那一份資料存在 `/var/lib/audit`，三份資料不能共用；啟動時從環境變數 `PEERS` 讀所有節點的位址（逗號分隔的 `主機:7400`，包含自己），節點重建後要用同一個名字回來。\n\n現在寫成 Deployment 加一個共用的 PVC：Pod 名稱每次重建都不同；`PEERS` 只寫了 Service 的名稱，每次連線會分到任一個 Pod；三個 Pod 搶同一個 ReadWriteOnce 的 PVC。\n\n改成：\n\n- 用 `StatefulSet`（`apps/v1`）取代 Deployment，名稱 `audit-store`、3 個副本，`selector` 與 Pod 範本的 label 一致\n- 一個 headless Service（`clusterIP: None`），名稱和 StatefulSet 的 `serviceName` 相同，`selector` 選得到 Pod\n- 用 `volumeClaimTemplates` 讓每個副本有自己的 PVC：`ReadWriteOnce`、`storageClassName: longhorn`、容量至少 10Gi；容器把它掛在 `/var/lib/audit`\n- 刪掉共用的 PVC，Pod 範本的 `volumes` 也不能再參照任何 PVC\n- `PEERS` 列出 3 個 Pod 各自的 DNS 名稱與 port：`audit-store-0.<headless Service 名稱>:7400`，依此類推（也可以寫完整的 `.clinic.svc.cluster.local`）\n- 所有物件都在 `clinic` namespace',
    starter: `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: audit-store-data
  namespace: clinic
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: longhorn
  resources:
    requests:
      storage: 10Gi
---
apiVersion: v1
kind: Service
metadata:
  name: audit-store
  namespace: clinic
spec:
  selector:
    app: audit-store
  ports:
    - name: peer
      port: 7400
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: audit-store
  namespace: clinic
spec:
  replicas: 3
  selector:
    matchLabels:
      app: audit-store
  template:
    metadata:
      labels:
        app: audit-store
    spec:
      containers:
        - name: store
          image: registry.gitlab.example/clinic/audit-store:5e8a1f3c
          env:
            - name: NODE_ID
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
            - name: PEERS
              value: audit-store:7400
          ports:
            - name: peer
              containerPort: 7400
          volumeMounts:
            - name: data
              mountPath: /var/lib/audit
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: audit-store-data
`,
    solution: `apiVersion: v1
kind: Service
metadata:
  name: audit-store-headless
  namespace: clinic
spec:
  clusterIP: None               # headless：DNS 直接回各個 Pod 的 IP
  selector:
    app: audit-store
  ports:
    - name: peer
      port: 7400
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: audit-store
  namespace: clinic
spec:
  serviceName: audit-store-headless   # 每個 Pod 的 DNS：audit-store-N.audit-store-headless
  replicas: 3
  selector:
    matchLabels:
      app: audit-store
  template:
    metadata:
      labels:
        app: audit-store
    spec:
      containers:
        - name: store
          image: registry.gitlab.example/clinic/audit-store:5e8a1f3c
          env:
            - name: NODE_ID
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name      # audit-store-0、-1、-2
            - name: PEERS
              value: audit-store-0.audit-store-headless:7400,audit-store-1.audit-store-headless:7400,audit-store-2.audit-store-headless:7400
          ports:
            - name: peer
              containerPort: 7400
          volumeMounts:
            - name: data                        # 對到 volumeClaimTemplates 的名稱
              mountPath: /var/lib/audit
  volumeClaimTemplates:                         # 每個副本各一個 PVC：data-audit-store-0、-1、-2
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: longhorn
        resources:
          requests:
            storage: 10Gi
`,
    hints: [
      'StatefulSet 的 `spec.serviceName` 指向一個 `clusterIP: None` 的 Service，每個 Pod 才有 `<Pod 名稱>.<Service 名稱>` 這個 DNS 名稱。原本的 Service 可以直接改成 headless，也可以另外建一個。',
      '`volumeClaimTemplates` 和 `template` 同一層（都在 StatefulSet 的 `spec` 底下），每一項有自己的 `metadata.name` 與 `spec`。容器的 `volumeMounts` 用這個名稱掛載，Pod 範本的 `volumes` 不用再寫。',
      'Pod 名稱是 `audit-store-0`、`audit-store-1`、`audit-store-2`；`PEERS` 寫成 `audit-store-0.<Service 名稱>:7400,audit-store-1.<Service 名稱>:7400,…`。',
    ],
    tests: [
      { name: '用 StatefulSet 取代 Deployment，共用的 PVC 已經刪掉', code: YAML + R`
const all = load()
assert(!all.some((d) => d.kind === 'Deployment'), '檔案裡還有 Deployment：Pod 名稱會是隨機的')
const sts = kind('StatefulSet')
assert(sts, '找不到 kind: StatefulSet 的文件')
assertEqual(sts.apiVersion, 'apps/v1', 'StatefulSet 的 apiVersion')
assertEqual(get(sts, 'metadata.name'), 'audit-store', 'StatefulSet 的名稱')
assert(!all.some((d) => d.kind === 'PersistentVolumeClaim'), '共用的 PVC 還在：每個副本的 PVC 改由 volumeClaimTemplates 產生')
` },
      { name: '3 個副本，selector 與 Pod 範本的 label 一致', code: YAML + R`
const sts = kind('StatefulSet')
assert(sts, '找不到 kind: StatefulSet')
assertEqual(Number(get(sts, 'spec.replicas')), 3, 'spec.replicas')
const sel = get(sts, 'spec.selector.matchLabels'), labels = get(sts, 'spec.template.metadata.labels')
assert(isMap(sel) && Object.keys(sel).length, 'StatefulSet 要有 spec.selector.matchLabels')
assert(isMap(labels), 'Pod 範本要有 spec.template.metadata.labels')
for (const k of Object.keys(sel)) assertEqual(labels[k], sel[k], 'selector 的 ' + k + ' 與 Pod 範本的 label 不一致')
` },
      { name: 'serviceName 指向一個 headless Service，selector 選得到 Pod', code: YAML + R`
const sts = kind('StatefulSet')
assert(sts, '找不到 kind: StatefulSet')
const name = get(sts, 'spec.serviceName')
assert(name, 'StatefulSet 要寫 spec.serviceName（headless Service 的名稱）')
const svc = load().find((d) => d.kind === 'Service' && get(d, 'metadata.name') === name)
assert(svc, '找不到名稱是 ' + name + ' 的 Service')
assertEqual(get(svc, 'spec.clusterIP'), 'None', 'Service ' + name + ' 的 clusterIP（headless 要寫 None）')
const sel = get(svc, 'spec.selector'), labels = get(sts, 'spec.template.metadata.labels') || {}
assert(isMap(sel) && Object.keys(sel).length, 'Service 要有 spec.selector')
for (const k of Object.keys(sel)) assertEqual(labels[k], sel[k], 'Service 的 selector ' + k + ' 對不到 Pod 的 label')
` },
      { name: 'volumeClaimTemplates：每個副本自己的 RWO PVC，掛在 /var/lib/audit', code: YAML + QTY + R`
const sts = kind('StatefulSet')
assert(sts, '找不到 kind: StatefulSet')
const tpls = list(get(sts, 'spec.volumeClaimTemplates'))
assert(tpls.length, 'StatefulSet 要有 spec.volumeClaimTemplates（和 template 同一層）')
const c = list(get(sts, 'spec.template.spec.containers')).find((x) => x.name === 'store')
assert(c, '找不到名為 store 的容器')
const m = list(c.volumeMounts).find((x) => x.mountPath === '/var/lib/audit')
assert(m, '容器要把資料目錄 /var/lib/audit 掛上 volume')
const t = tpls.find((x) => get(x, 'metadata.name') === m.name)
assert(t, '/var/lib/audit 的 volumeMounts 名稱是 ' + m.name + '，要等於 volumeClaimTemplates 裡某一項的 metadata.name')
const modes = get(t, 'spec.accessModes')
assert(Array.isArray(modes) && modes.length, 'volumeClaimTemplates 要寫 accessModes')
assert(!modes.includes('ReadWriteMany'), '每個副本有自己的 PVC，不需要 ReadWriteMany')
assert(modes.includes('ReadWriteOnce'), 'accessModes 要是 ReadWriteOnce')
assertEqual(get(t, 'spec.storageClassName'), 'longhorn', 'volumeClaimTemplates 的 storageClassName')
const s = get(t, 'spec.resources.requests.storage')
assert(s && !Number.isNaN(qty(s)), 'volumeClaimTemplates 要寫 resources.requests.storage（例如 10Gi）')
assert(qty(s) >= 10 * 1024 ** 3, '容量 ' + s + ' 小於 10Gi')
` },
      { name: 'Pod 範本不再參照共用的 PVC', code: YAML + R`
const sts = kind('StatefulSet')
assert(sts, '找不到 kind: StatefulSet')
const vols = list(get(sts, 'spec.template.spec.volumes'))
assert(!vols.some((v) => isMap(v.persistentVolumeClaim)), 'Pod 範本的 volumes 還在參照 PVC：三個副本會搶同一個 volume')
const names = list(get(sts, 'spec.volumeClaimTemplates')).map((x) => get(x, 'metadata.name'))
for (const v of vols) assert(!names.includes(v.name), 'Pod 範本的 volumes 有一項和 volumeClaimTemplates 同名（' + v.name + '），刪掉它')
` },
      { name: 'PEERS 列出 3 個 Pod 各自的 DNS 名稱與 port 7400', code: YAML + R`
const sts = kind('StatefulSet')
assert(sts, '找不到 kind: StatefulSet')
const svc = get(sts, 'spec.serviceName') || ''
const c = list(get(sts, 'spec.template.spec.containers')).find((x) => x.name === 'store')
assert(c, '找不到名為 store 的容器')
const e = list(c.env).find((x) => x.name === 'PEERS')
assert(e && e.value, '容器要有 PEERS 環境變數')
const peers = String(e.value).split(',').map((s) => s.trim()).filter(Boolean)
assertEqual(peers.length, 3, 'PEERS 的項目數')
for (let i = 0; i < 3; i++) {
  const re = new RegExp('^audit-store-' + i + '\\.' + svc + '(\\.clinic(\\.svc(\\.cluster\\.local)?)?)?:7400$')
  assert(peers.some((p) => re.test(p)), 'PEERS 裡找不到 audit-store-' + i + '.' + svc + ':7400：每個 Pod 的名稱是 <Pod 名稱>.<serviceName>')
}
` },
      { name: '所有物件都在 clinic namespace', code: YAML + R`
for (const d of load()) assertEqual(get(d, 'metadata.namespace'), 'clinic', d.kind + ' ' + get(d, 'metadata.name') + ' 的 namespace')
` },
    ],
  },
]

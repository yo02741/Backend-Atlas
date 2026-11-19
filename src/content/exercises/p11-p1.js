// 程式題：p11-p1（container-operations）
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

// compose 題用：三個服務、記憶體與時間長度的解析。
const COMPOSE = R`
const NAMES = ['nginx', 'billing-api', 'payment-socket']
function services() {
  const d = load()[0]
  assert(isMap(d) && isMap(d.services), '找不到 services:（三個服務要寫在 services 底下）')
  for (const n of NAMES) assert(isMap(d.services[n]), '找不到服務 ' + n + '：不要改服務名稱')
  return d.services
}
function bytes(v) {
  const m = /^(\d+(?:\.\d+)?)\s*([bkmg])?b?$/i.exec(String(v === undefined || v === null ? '' : v).trim())
  if (!m) return NaN
  const unit = { b: 1, k: 1024, m: 1024 * 1024, g: 1024 * 1024 * 1024 }[(m[2] || 'b').toLowerCase()]
  return Number(m[1]) * unit
}
function seconds(v) {
  const s = String(v === undefined || v === null ? '' : v).trim()
  const m = /^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+)s)?$/.exec(s)
  if (!s || !m) return NaN
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)
}
`

const INSPECT_SAMPLE = `INSPECT = """
[
  {"Name": "/nginx", "RestartCount": 0,
   "State": {"Status": "running", "Restarting": false, "OOMKilled": false, "ExitCode": 0},
   "Config": {"User": "101:101", "Image": "harbor.example.org/billing/nginx:1.27.2"},
   "HostConfig": {"LogConfig": {"Type": "json-file", "Config": {"max-size": "50m", "max-file": "5"}},
                  "RestartPolicy": {"Name": "unless-stopped", "MaximumRetryCount": 0}}},
  {"Name": "/billing-api", "RestartCount": 1,
   "State": {"Status": "running", "Restarting": false, "OOMKilled": false, "ExitCode": 0},
   "Config": {"User": "", "Image": "harbor.example.org/billing/api:4.12.0"},
   "HostConfig": {"LogConfig": {"Type": "json-file", "Config": {}},
                  "RestartPolicy": {"Name": "unless-stopped", "MaximumRetryCount": 0}}},
  {"Name": "/payment-socket", "RestartCount": 0,
   "State": {"Status": "exited", "Restarting": false, "OOMKilled": false, "ExitCode": 137},
   "Config": {"User": "root", "Image": "harbor.example.org/billing/payment:4.12.0"},
   "HostConfig": {"LogConfig": {"Type": "json-file", "Config": {"max-size": "-1"}},
                  "RestartPolicy": {"Name": "no", "MaximumRetryCount": 0}}},
  {"Name": "/report-worker", "RestartCount": 14,
   "State": {"Status": "restarting", "Restarting": true, "OOMKilled": true, "ExitCode": 137},
   "Config": {"User": "10001", "Image": "harbor.example.org/billing/report:2.3.1"},
   "HostConfig": {"LogConfig": {"Type": "local", "Config": {}},
                  "RestartPolicy": {"Name": "always", "MaximumRetryCount": 0}}}
]
"""`

// 測試用：組出一筆 docker inspect 的容器資料，沒給的欄位用「沒問題」的預設值
const PY_HELPER = `def _c(name, user="10001", oom=False, restarting=False, restarts=0, log_type="json-file", log_opts=None, drop=()):
    c = {"Name": "/" + name, "RestartCount": restarts,
         "State": {"Status": "running", "Restarting": restarting, "OOMKilled": oom, "ExitCode": 0},
         "Config": {"User": user, "Image": "harbor.example.org/billing/x:1"},
         "HostConfig": {"LogConfig": {"Type": log_type,
                                      "Config": {"max-size": "50m", "max-file": "5"} if log_opts is None else log_opts}}}
    for key in drop:
        c.pop(key, None)
    return c
`

export default [
  {
    id: 'container-operations-1', skill: 'container-operations', kind: 'python', level: 2,
    title: '從 docker inspect 找出有問題的容器',
    prompt: '`INSPECT` 是 `docker inspect` 對幾個容器的輸出（JSON 陣列，只留了這題用得到的欄位）。實作 `audit(containers)`，`containers` 是 `json.loads` 之後的清單，回傳一個 dict，四個鍵各是一串容器名稱：\n\n- `"oom_killed"`：`State.OOMKilled` 是 `True`。結束碼 137 但 `OOMKilled` 是 `False` 的不算（多半是停止時等滿寬限期）\n- `"restart_loop"`：`State.Restarting` 是 `True`，或 `RestartCount` 大於等於 3\n- `"no_log_rotation"`：`HostConfig.LogConfig.Type` 是 `json-file`，而且 `Config` 裡沒有 `max-size`（或是空字串、`"-1"`）。`local` 預設就會輪替，`journald`、`syslog` 等驅動不寫 Docker 的日誌檔，都不算\n- `"runs_as_root"`：`Config.User` 的使用者部分（冒號前面）是空字串、`root` 或 `0`。`User` 的格式是「使用者[:群組]」，空字串代表映像沒有設定，等於 root；`10001:0` 是 UID 10001、群組 0，不算 root\n\n其他規則：\n\n- 名稱去掉 `Name` 開頭的 `/`，依輸入的順序；沒有符合的就是空清單\n- 欄位可能缺少：沒有 `RestartCount` 當成 0；`LogConfig.Config` 可能是 `None`；沒有 `Config.User` 當成空字串\n\n起始碼是第一版的寫法，跑得出結果，但四個判斷都有漏洞。',
    starter: `import json

${INSPECT_SAMPLE}


def audit(containers):
    report = {"oom_killed": [], "restart_loop": [], "no_log_rotation": [], "runs_as_root": []}
    for c in containers:
        name = c["Name"]
        if c["State"]["ExitCode"] == 137:
            report["oom_killed"].append(name)
        if c["RestartCount"] > 0:
            report["restart_loop"].append(name)
        if c["HostConfig"]["LogConfig"]["Type"] == "json-file":
            report["no_log_rotation"].append(name)
        if c["Config"]["User"] == "":
            report["runs_as_root"].append(name)
    return report


for key, names in audit(json.loads(INSPECT)).items():
    print(f"{key:<16} {names}")
`,
    solution: `import json

${INSPECT_SAMPLE}


def name_of(c):
    return c.get("Name", "").lstrip("/")


def is_root(user):
    # User 的格式是「使用者[:群組]」；空字串代表映像沒有設定，等於 root
    who = (user or "").split(":")[0].strip()
    return who in ("", "root", "0")


def has_rotation(log_config):
    log_config = log_config or {}
    if log_config.get("Type", "json-file") != "json-file":
        return True              # local 預設就輪替；journald、syslog 等不寫 Docker 的日誌檔
    opts = log_config.get("Config") or {}
    size = str(opts.get("max-size", "")).strip()
    return size not in ("", "-1")


def audit(containers):
    report = {"oom_killed": [], "restart_loop": [], "no_log_rotation": [], "runs_as_root": []}
    for c in containers:
        name = name_of(c)
        state = c.get("State") or {}
        if state.get("OOMKilled") is True:            # 137 不一定是 OOM，要看這個旗標
            report["oom_killed"].append(name)
        if state.get("Restarting") is True or (c.get("RestartCount") or 0) >= 3:
            report["restart_loop"].append(name)
        if not has_rotation((c.get("HostConfig") or {}).get("LogConfig")):
            report["no_log_rotation"].append(name)
        if is_root((c.get("Config") or {}).get("User")):
            report["runs_as_root"].append(name)
    return report


for key, names in audit(json.loads(INSPECT)).items():
    print(f"{key:<16} {names}")
`,
    tests: [
      { name: '範例資料：四類各找出正確的容器（名稱不含 /）', code: `_r = audit(json.loads(INSPECT))
assert set(_r) == {"oom_killed", "restart_loop", "no_log_rotation", "runs_as_root"}, f"回傳的鍵不對：{sorted(_r)}"
assert _r["oom_killed"] == ["report-worker"], f"oom_killed：{_r['oom_killed']}"
assert _r["restart_loop"] == ["report-worker"], f"restart_loop：{_r['restart_loop']}"
assert _r["no_log_rotation"] == ["billing-api", "payment-socket"], f"no_log_rotation：{_r['no_log_rotation']}"
assert _r["runs_as_root"] == ["billing-api", "payment-socket"], f"runs_as_root：{_r['runs_as_root']}"` },
      { name: 'OOM 只看 OOMKilled：結束碼 137 但 OOMKilled 是 False 的不算', code: PY_HELPER + `_a = _c("stop-timeout")
_a["State"].update(Status="exited", ExitCode=137)
_b = _c("oom", oom=True)
_b["State"].update(Status="exited", ExitCode=137)
assert audit([_a, _b])["oom_killed"] == ["oom"], f"結果是 {audit([_a, _b])['oom_killed']}：137 也可能是 docker stop 等滿寬限期"` },
      { name: '一直重啟：Restarting 是 True，或 RestartCount 至少 3；沒有 RestartCount 當成 0', code: PY_HELPER + `_cs = [_c("once", restarts=1), _c("twice", restarts=2), _c("three", restarts=3),
       _c("now", restarting=True), _c("no-count", drop=("RestartCount",))]
_got = audit(_cs)["restart_loop"]
assert _got == ["three", "now"], f"restart_loop 應該是 ['three', 'now']，你的是 {_got}"` },
      { name: '日誌輪替：json-file 沒有 max-size（或 -1、Config 是 None）才算；local、journald 不算', code: PY_HELPER + `_cs = [
    _c("ok", log_opts={"max-size": "10m"}),
    _c("empty", log_opts={}),
    _c("minus-one", log_opts={"max-size": "-1", "max-file": "3"}),
    _c("none", log_opts=None),
    _c("only-file", log_opts={"max-file": "5"}),
    _c("local", log_type="local", log_opts={}),
    _c("journald", log_type="journald", log_opts={}),
]
_cs[3]["HostConfig"]["LogConfig"]["Config"] = None
_got = audit(_cs)["no_log_rotation"]
assert _got == ["empty", "minus-one", "none", "only-file"], f"no_log_rotation 應該是 ['empty', 'minus-one', 'none', 'only-file']，你的是 {_got}"` },
      { name: '以 root 執行：使用者部分是空字串、root 或 0；沒有 User 當成空字串', code: PY_HELPER + `_cs = [_c("blank", user=""), _c("root", user="root"), _c("zero", user="0"), _c("zero-zero", user="0:0"),
       _c("root-group", user="root:staff"), _c("app", user="app"), _c("uid", user="10001"),
       _c("uid-gid0", user="10001:0"), _c("missing")]
del _cs[-1]["Config"]["User"]
_got = audit(_cs)["runs_as_root"]
assert _got == ["blank", "root", "zero", "zero-zero", "root-group", "missing"], f"runs_as_root 是 {_got}"` },
      { name: '空清單回傳四個空清單；沒有問題的容器不出現在任何一類', code: PY_HELPER + `assert audit([]) == {"oom_killed": [], "restart_loop": [], "no_log_rotation": [], "runs_as_root": []}
_r = audit([_c("healthy")])
assert all(v == [] for v in _r.values()), f"沒有問題的容器被列進去了：{_r}"` },
    ],
    hints: [
      '137 只代表被 SIGKILL，`docker stop` 等滿寬限期也是 137；記憶體的判斷只看 `State.OOMKilled`。',
      '欄位可能缺少或是 `None`：用 `c.get("RestartCount") or 0`、`(log_config.get("Config") or {})` 這類寫法，不要直接用 `[]` 取值。',
      '`User` 先用 `split(":")[0]` 取出使用者部分再判斷；`10001:0` 的群組是 0，但使用者不是 root。',
      '日誌輪替先看 `Type`：不是 `json-file` 的都不算沒輪替；是 `json-file` 時，`max-size` 有值而且不是 `"-1"` 才算有輪替。',
    ],
  },
  {
    id: 'container-operations-2', skill: 'container-operations', kind: 'config', level: 2, file: 'compose.yaml',
    title: '補齊 compose 的維運設定',
    prompt: '這份 `compose.yaml` 跑批價繳費系統的三個服務，能跑，但缺了維運設定：日誌會長到磁碟滿、記憶體沒有上限、崩潰或主機重開後不會回來、`payment-socket` 每次更新都切斷交易。\n\n已知：`payment-socket` 的程式已經改成會處理 SIGTERM，收到後最多等 20 秒把手上的交易做完；`billing-api` 的 gunicorn 用預設的 `--graceful-timeout`（30 秒）。\n\n修改成：\n\n- **三個服務都有日誌輪替**：`logging.driver` 用 `json-file` 並設 `options` 的 `max-size`（例如 `"50m"`）與 `max-file`（至少 2）；或改用 `driver: local`\n- **三個服務都有記憶體上限**：`mem_limit` 或 `deploy.resources.limits.memory`，寫成 `512m`、`1g` 這類格式，至少 64m\n- **三個服務都有重啟策略**：`restart` 用 `unless-stopped`、`always` 或 `on-failure`，不能是 `no`\n- **`payment-socket`**：`init: true`，`stop_grace_period` 至少 30 秒（寫成 `30s`、`1m` 這類格式）\n- **`billing-api`**：`stop_grace_period` 比 gunicorn 的 30 秒長\n- 服務名稱與映像不要改',
    starter: `services:
  nginx:
    image: harbor.example.org/billing/nginx:1.27.2
    ports:
      - "443:8443"
    depends_on:
      - billing-api

  billing-api:
    image: harbor.example.org/billing/api:4.12.0
    command: ["gunicorn", "-w", "1", "--threads", "50", "--keep-alive", "75", "-b", "0.0.0.0:8000", "billing.wsgi:app"]
    env_file: /etc/billing/api.env
    volumes:
      - billing-data:/data

  payment-socket:
    image: harbor.example.org/billing/payment:4.12.0
    ports:
      - "9100:9100"
    env_file: /etc/billing/payment.env

volumes:
  billing-data:
`,
    solution: `services:
  nginx:
    image: harbor.example.org/billing/nginx:1.27.2
    ports:
      - "443:8443"
    depends_on:
      - billing-api
    restart: unless-stopped
    mem_limit: 256m
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "5"

  billing-api:
    image: harbor.example.org/billing/api:4.12.0
    command: ["gunicorn", "-w", "1", "--threads", "50", "--keep-alive", "75", "-b", "0.0.0.0:8000", "billing.wsgi:app"]
    env_file: /etc/billing/api.env
    volumes:
      - billing-data:/data
    restart: unless-stopped
    mem_limit: 1g
    stop_grace_period: 35s          # 比 gunicorn 的 graceful-timeout（30 秒）長
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "5"

  payment-socket:
    image: harbor.example.org/billing/payment:4.12.0
    ports:
      - "9100:9100"
    env_file: /etc/billing/payment.env
    restart: unless-stopped
    mem_limit: 256m
    init: true                      # tini 當 PID 1：轉送訊號、回收子行程
    stop_grace_period: 30s          # 程式最多等 20 秒，寬限期要比它長
    logging:
      driver: local                 # local 預設就會輪替

volumes:
  billing-data:
`,
    hints: [
      '`logging` 寫在每個服務底下：`driver: json-file`，`options` 底下放 `max-size: "50m"` 與 `max-file: "5"`。只改 daemon.json 不會套用到已經存在的容器，寫在 compose 裡最明確。',
      '記憶體上限可以寫 `mem_limit: 1g`，或 `deploy:` → `resources:` → `limits:` → `memory: 1g`。單位用 `m`、`g`；只寫數字代表位元組。',
      '寬限期由內而外：程式自己的等待上限 < `stop_grace_period`。`payment-socket` 等 20 秒，所以至少 30s；`billing-api` 的 gunicorn 等 30 秒，所以要比 30s 長。',
      '`init: true` 讓 Docker 內建的 tini 當 PID 1；它不會讓程式優雅關機，那是程式自己處理 SIGTERM 的事，這題的程式已經改好了。',
    ],
    tests: [
      { name: '三個服務都在，映像沒有改', code: YAML + COMPOSE + R`
const s = services()
const want = { 'nginx': 'harbor.example.org/billing/nginx:1.27.2', 'billing-api': 'harbor.example.org/billing/api:4.12.0', 'payment-socket': 'harbor.example.org/billing/payment:4.12.0' }
for (const n of NAMES) assertEqual(String(s[n].image || ''), want[n], n + ' 的 image')
` },
      { name: '三個服務都有日誌輪替', code: YAML + COMPOSE + R`
const s = services()
for (const n of NAMES) {
  const lg = s[n].logging
  assert(isMap(lg), n + ' 沒有 logging：預設的 json-file 不輪替，log 會長到磁碟滿')
  const drv = String(lg.driver || 'json-file')
  if (drv === 'local') continue
  assert(drv === 'json-file', n + ' 的 logging.driver 是 ' + drv + '：這題用 json-file 或 local')
  const o = isMap(lg.options) ? lg.options : {}
  const size = String(o['max-size'] || '')
  assert(size && size !== '-1', n + ' 要設 logging.options.max-size（例如 "50m"）')
  assert(bytes(size) > 0, n + ' 的 max-size 看不懂：' + size + '（寫成 10m、50m 這類格式）')
  assert(Number(o['max-file']) >= 2, n + ' 要設 logging.options.max-file（至少 2），舊檔才有地方輪替')
}
` },
      { name: '三個服務都有記憶體上限', code: YAML + COMPOSE + R`
const s = services()
for (const n of NAMES) {
  const v = s[n].mem_limit !== undefined && s[n].mem_limit !== null ? s[n].mem_limit : get(s[n], 'deploy.resources.limits.memory')
  assert(v !== undefined && v !== null && v !== '', n + ' 沒有記憶體上限：用 mem_limit 或 deploy.resources.limits.memory')
  const b = bytes(v)
  assert(b > 0, n + ' 的記憶體上限看不懂：' + v + '（寫成 512m、1g 這類格式）')
  assert(b >= 64 * 1024 * 1024, n + ' 的記憶體上限 ' + v + ' 太小，程式起不來（至少 64m）')
}
` },
      { name: '三個服務都有重啟策略', code: YAML + COMPOSE + R`
const s = services()
for (const n of NAMES) {
  const r = String(s[n].restart || '')
  assert(r, n + ' 沒有 restart：預設是 no，崩潰或主機重開後不會回來')
  assert(/^(unless-stopped|always|on-failure(:\d+)?)$/.test(r), n + ' 的 restart 是 ' + r + '：用 unless-stopped、always 或 on-failure')
}
` },
      { name: 'payment-socket：init 與至少 30 秒的寬限期', code: YAML + COMPOSE + R`
const p = services()['payment-socket']
assert(String(p.init) === 'true', 'payment-socket 要加 init: true，讓 tini 當 PID 1 轉送訊號、回收子行程')
const g = seconds(p.stop_grace_period)
assert(!Number.isNaN(g), 'payment-socket 要設 stop_grace_period，寫成 30s、1m 這類格式' + (p.stop_grace_period ? '（目前是 ' + p.stop_grace_period + '）' : ''))
assert(g >= 30, 'payment-socket 的 stop_grace_period 是 ' + p.stop_grace_period + '：程式最多等 20 秒，寬限期至少 30 秒')
` },
      { name: 'billing-api：寬限期比 gunicorn 的 30 秒長', code: YAML + COMPOSE + R`
const a = services()['billing-api']
const g = seconds(a.stop_grace_period)
assert(!Number.isNaN(g), 'billing-api 要設 stop_grace_period，寫成 35s 這類格式' + (a.stop_grace_period ? '（目前是 ' + a.stop_grace_period + '）' : ''))
assert(g > 30, 'billing-api 的 stop_grace_period 是 ' + a.stop_grace_period + '：gunicorn 會等 30 秒，寬限期要比它長，否則較久的請求一樣被 SIGKILL')
` },
    ],
  },
]

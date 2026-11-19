// 程式題：p11-n4（k8s-operations）
// Python 題的程式碼與測試用 template literal 寫；裡面不要出現反引號、`${` 與反斜線。
export default [
  {
    id: 'k8s-operations-1', skill: 'k8s-operations', kind: 'python', level: 3,
    title: '這次 drain 會不會被 PDB 擋住',
    prompt: '實作 `drain_check(node, pods, pdbs, ignore_daemonsets=False, delete_emptydir_data=False, force=False) -> dict`，在執行 `kubectl drain` 之前判斷這次會不會被擋住。\n\n`pods` 是叢集裡所有的 Pod，每筆有 `name`、`namespace`、`node`、`labels`、`owner`（`ReplicaSet`、`StatefulSet`、`DaemonSet` 或 `None`）、`emptydir`（布林）、`ready`（布林）。`pdbs` 每筆有 `name`、`namespace`、`selector`（label 的鍵值；起始碼的 `selects` 已經寫好比對），以及 `min_available` 或 `max_unavailable` 其中之一，值是整數或 `"50%"` 這種字串。\n\n**1. 參數檢查**（只看 `node` 上的 Pod）：\n\n- `owner` 是 `DaemonSet`：沒有 `ignore_daemonsets` → 錯誤 `daemonset`。DaemonSet 的 Pod 不驅逐，也不做下面兩項檢查\n- `owner` 是 `None` 而且沒有 `force` → `no-controller`\n- `emptydir` 是 `True` 而且沒有 `delete_emptydir_data` → `emptydir`\n\n`errors` 是 `(Pod 名稱, 原因)` 的清單，依 tuple 排序。\n\n**2. PDB**：只列出選到「這個節點上要驅逐的 Pod」的 PDB（DaemonSet 的 Pod 不算要驅逐）。\n\n- `expected` 是這個 PDB 在整個叢集選到的 Pod 數，`healthy` 是其中 `ready` 的數量，`k` 是其中在這個節點上要驅逐的數量\n- `desired`：`min_available` 直接用；`max_unavailable` 則是 `expected - max_unavailable`。百分比先乘上 `expected` 再**無條件進位**（1 個 Pod 的 `"50%"` 是 1）\n- `allowed = max(0, healthy - desired)`\n- `expected - desired <= 0` → `stuck`（全部健康也不允許任何中斷）；否則 `allowed >= k` → `ok`；否則 → `wait`（要等替代的 Pod 在別的節點 Ready）\n\n**3. `result`**：有任何 `errors` → `error`；否則有 `stuck` → `stuck`；否則有 `wait` → `wait`；否則 `ok`。有 `errors` 時 PDB 照樣要算。\n\n回傳 `{"errors": [...], "pdbs": {PDB 名稱: 狀態}, "result": ...}`。這是簡化的模型：假設其他節點放得下替代的 Pod，並以 PDB 選到的 Pod 數當成預期數量。',
    starter: `import math


def selects(pdb, pod):
    """PDB 有沒有選到這個 Pod：同一個 namespace，selector 的每一組 label 都相同"""
    return pod["namespace"] == pdb["namespace"] and all(
        pod["labels"].get(k) == v for k, v in pdb["selector"].items()
    )


def drain_check(node, pods, pdbs, ignore_daemonsets=False, delete_emptydir_data=False, force=False):
    # TODO：現在只檢查 DaemonSet，PDB 一律不看
    errors = []
    for p in pods:
        if p["node"] == node and p["owner"] == "DaemonSet" and not ignore_daemonsets:
            errors.append((p["name"], "daemonset"))
    return {"errors": errors, "pdbs": {}, "result": "error" if errors else "ok"}


def pod(name, node, app, owner="ReplicaSet", ready=True, emptydir=False, ns="clinic"):
    return {"name": name, "namespace": ns, "node": node, "labels": {"app": app},
            "owner": owner, "emptydir": emptydir, "ready": ready}


# clinic-api 的兩個副本都在 k8s-node-2：要等第一個的替代 Pod Ready，結果應該是 wait
pods = [
    pod("clinic-api-x7k2p", "k8s-node-2", "clinic-api"),
    pod("clinic-api-p4m8n", "k8s-node-2", "clinic-api"),
    pod("fluent-bit-m2v9c", "k8s-node-2", "fluent-bit", owner="DaemonSet"),
]
pdbs = [{"name": "clinic-api", "namespace": "clinic", "selector": {"app": "clinic-api"}, "min_available": 1}]
print(drain_check("k8s-node-2", pods, pdbs, ignore_daemonsets=True))
`,
    solution: `import math


def selects(pdb, pod):
    """PDB 有沒有選到這個 Pod：同一個 namespace，selector 的每一組 label 都相同"""
    return pod["namespace"] == pdb["namespace"] and all(
        pod["labels"].get(k) == v for k, v in pdb["selector"].items()
    )


def scaled(value, expected):
    """整數直接用；"50%" 這種百分比乘上預期的 Pod 數後無條件進位"""
    if isinstance(value, str) and value.endswith("%"):
        return math.ceil(expected * int(value[:-1]) / 100)
    return int(value)


def drain_check(node, pods, pdbs, ignore_daemonsets=False, delete_emptydir_data=False, force=False):
    on_node = [p for p in pods if p["node"] == node]
    errors = []
    for p in on_node:
        if p["owner"] == "DaemonSet":
            if not ignore_daemonsets:
                errors.append((p["name"], "daemonset"))
            continue                                  # DaemonSet 的 Pod 不驅逐，也不做其他檢查
        if p["owner"] is None and not force:
            errors.append((p["name"], "no-controller"))
        if p["emptydir"] and not delete_emptydir_data:
            errors.append((p["name"], "emptydir"))
    errors.sort()

    to_evict = [p for p in on_node if p["owner"] != "DaemonSet"]
    statuses = {}
    for pdb in pdbs:
        matched = [p for p in pods if selects(pdb, p)]
        k = sum(1 for p in to_evict if selects(pdb, p))
        if k == 0:
            continue                                  # 這次 drain 不會動到它選的 Pod
        expected = len(matched)
        if "min_available" in pdb:
            desired = scaled(pdb["min_available"], expected)
        else:
            desired = expected - scaled(pdb["max_unavailable"], expected)
        healthy = sum(1 for p in matched if p["ready"])
        allowed = max(0, healthy - desired)
        if expected - desired <= 0:
            statuses[pdb["name"]] = "stuck"           # 全部健康也不允許任何中斷
        elif allowed >= k:
            statuses[pdb["name"]] = "ok"
        else:
            statuses[pdb["name"]] = "wait"            # 要等替代的 Pod 在別的節點 Ready

    if errors:
        result = "error"
    elif "stuck" in statuses.values():
        result = "stuck"
    elif "wait" in statuses.values():
        result = "wait"
    else:
        result = "ok"
    return {"errors": errors, "pdbs": statuses, "result": result}


def pod(name, node, app, owner="ReplicaSet", ready=True, emptydir=False, ns="clinic"):
    return {"name": name, "namespace": ns, "node": node, "labels": {"app": app},
            "owner": owner, "emptydir": emptydir, "ready": ready}


# clinic-api 的兩個副本都在 k8s-node-2：要等第一個的替代 Pod Ready，結果應該是 wait
pods = [
    pod("clinic-api-x7k2p", "k8s-node-2", "clinic-api"),
    pod("clinic-api-p4m8n", "k8s-node-2", "clinic-api"),
    pod("fluent-bit-m2v9c", "k8s-node-2", "fluent-bit", owner="DaemonSet"),
]
pdbs = [{"name": "clinic-api", "namespace": "clinic", "selector": {"app": "clinic-api"}, "min_available": 1}]
print(drain_check("k8s-node-2", pods, pdbs, ignore_daemonsets=True))
`,
    hints: [
      '先做參數檢查，再算 PDB；兩部分各自獨立，`errors` 不是空的時 `pdbs` 照樣要算。',
      '`expected - desired <= 0` 代表就算全部健康，`healthy - desired` 也不會大於 0：這種 PDB 會讓 drain 永遠等下去。',
      '百分比用 `math.ceil(expected * 百分比 / 100)`。`max_unavailable` 的百分比也是無條件進位，算出可以少幾個，再用 `expected` 減。',
      '`k` 只算這個節點上、而且不是 DaemonSet 的 Pod；PDB 沒選到任何一個要驅逐的 Pod 就不列出來。',
    ],
    tests: [
      { name: '參數檢查：DaemonSet、emptyDir、沒有控制器', code: `def _pod(name, node, app, owner="ReplicaSet", ready=True, emptydir=False, ns="clinic"):
    return {"name": name, "namespace": ns, "node": node, "labels": {"app": app},
            "owner": owner, "emptydir": emptydir, "ready": ready}
def _pdb(name, app, ns="clinic", **kw):
    d = {"name": name, "namespace": ns, "selector": {"app": app}}
    d.update(kw)
    return d
_pods = [
    _pod("fluent-bit-m2v9c", "n2", "fluent-bit", owner="DaemonSet"),
    _pod("clinic-web-r2t5w", "n2", "clinic-web", emptydir=True),
    _pod("debug-shell", "n2", "debug", owner=None, emptydir=True),
    _pod("clinic-web-h9q3z", "n1", "clinic-web", emptydir=True),
]
_r = drain_check("n2", _pods, [])
assert _r["errors"] == [("clinic-web-r2t5w", "emptydir"), ("debug-shell", "emptydir"), ("debug-shell", "no-controller"), ("fluent-bit-m2v9c", "daemonset")], _r["errors"]
assert _r["result"] == "error", _r
_r = drain_check("n2", _pods, [], ignore_daemonsets=True, delete_emptydir_data=True)
assert _r["errors"] == [("debug-shell", "no-controller")], _r["errors"]
_r = drain_check("n2", _pods, [], ignore_daemonsets=True, delete_emptydir_data=True, force=True)
assert _r == {"errors": [], "pdbs": {}, "result": "ok"}, _r
_r = drain_check("n2", [_pod("fluent-bit-a", "n2", "fluent-bit", owner="DaemonSet", emptydir=True)], [], ignore_daemonsets=True)
assert _r["errors"] == [], "DaemonSet 的 Pod 略過之後，不再做 emptyDir 的檢查"` },
      { name: '兩個副本在不同節點是 ok，都在這台是 wait', code: `def _pod(name, node, app, owner="ReplicaSet", ready=True, emptydir=False, ns="clinic"):
    return {"name": name, "namespace": ns, "node": node, "labels": {"app": app},
            "owner": owner, "emptydir": emptydir, "ready": ready}
def _pdb(name, app, ns="clinic", **kw):
    d = {"name": name, "namespace": ns, "selector": {"app": app}}
    d.update(kw)
    return d
_pdbs = [_pdb("clinic-api", "clinic-api", min_available=1)]
_r = drain_check("n2", [_pod("api-a", "n2", "clinic-api"), _pod("api-b", "n1", "clinic-api")], _pdbs)
assert _r == {"errors": [], "pdbs": {"clinic-api": "ok"}, "result": "ok"}, _r
_r = drain_check("n2", [_pod("api-a", "n2", "clinic-api"), _pod("api-b", "n2", "clinic-api")], _pdbs)
assert _r == {"errors": [], "pdbs": {"clinic-api": "wait"}, "result": "wait"}, _r` },
      { name: '永遠不允許中斷的 PDB 是 stuck', code: `def _pod(name, node, app, owner="ReplicaSet", ready=True, emptydir=False, ns="clinic"):
    return {"name": name, "namespace": ns, "node": node, "labels": {"app": app},
            "owner": owner, "emptydir": emptydir, "ready": ready}
def _pdb(name, app, ns="clinic", **kw):
    d = {"name": name, "namespace": ns, "selector": {"app": app}}
    d.update(kw)
    return d
_r = drain_check("n2", [_pod("rw-a", "n2", "report-worker")], [_pdb("report-worker", "report-worker", min_available=1)])
assert _r == {"errors": [], "pdbs": {"report-worker": "stuck"}, "result": "stuck"}, _r
_two = [_pod("api-a", "n2", "clinic-api"), _pod("api-b", "n1", "clinic-api")]
_r = drain_check("n2", _two, [_pdb("clinic-api", "clinic-api", max_unavailable=0)])
assert _r["pdbs"] == {"clinic-api": "stuck"}, ("maxUnavailable 0", _r)
_r = drain_check("n2", _two, [_pdb("clinic-api", "clinic-api", min_available=2)])
assert _r["pdbs"] == {"clinic-api": "stuck"}, ("minAvailable 等於副本數", _r)` },
      { name: '百分比無條件進位', code: `def _pod(name, node, app, owner="ReplicaSet", ready=True, emptydir=False, ns="clinic"):
    return {"name": name, "namespace": ns, "node": node, "labels": {"app": app},
            "owner": owner, "emptydir": emptydir, "ready": ready}
def _pdb(name, app, ns="clinic", **kw):
    d = {"name": name, "namespace": ns, "selector": {"app": app}}
    d.update(kw)
    return d
_r = drain_check("n2", [_pod("rw-a", "n2", "report-worker")], [_pdb("rw", "report-worker", min_available="50%")])
assert _r["pdbs"] == {"rw": "stuck"}, ("1 個 Pod 的 50% 無條件進位是 1", _r)
_four = [_pod("w-a", "n2", "web"), _pod("w-b", "n2", "web"), _pod("w-c", "n1", "web"), _pod("w-d", "n3", "web")]
_r = drain_check("n2", _four, [_pdb("web", "web", min_available="50%")])
assert _r["pdbs"] == {"web": "ok"}, ("4 個的 50% 是 2，可以中斷 2 個", _r)
_r = drain_check("n2", _four, [_pdb("web", "web", min_available="75%")])
assert _r["pdbs"] == {"web": "wait"}, ("4 個的 75% 是 3，只能中斷 1 個", _r)
_three = [_pod("w-a", "n2", "web"), _pod("w-b", "n2", "web"), _pod("w-c", "n1", "web")]
_r = drain_check("n2", _three, [_pdb("web", "web", max_unavailable="30%")])
assert _r["pdbs"] == {"web": "wait"}, ("3 個的 30% 進位是 1，desired 是 2", _r)
_r = drain_check("n2", _three, [_pdb("web", "web", max_unavailable="67%")])
assert _r["pdbs"] == {"web": "ok"}, ("3 個的 67% 進位是 3", _r)` },
      { name: '不健康的 Pod 會吃掉預算', code: `def _pod(name, node, app, owner="ReplicaSet", ready=True, emptydir=False, ns="clinic"):
    return {"name": name, "namespace": ns, "node": node, "labels": {"app": app},
            "owner": owner, "emptydir": emptydir, "ready": ready}
def _pdb(name, app, ns="clinic", **kw):
    d = {"name": name, "namespace": ns, "selector": {"app": app}}
    d.update(kw)
    return d
_pods = [_pod("a", "n2", "web"), _pod("b", "n1", "web", ready=False), _pod("c", "n3", "web")]
_r = drain_check("n2", _pods, [_pdb("web", "web", min_available=2)])
assert _r["pdbs"] == {"web": "wait"}, ("healthy 只有 2", _r)
_r = drain_check("n2", _pods, [_pdb("web", "web", min_available=1)])
assert _r["pdbs"] == {"web": "ok"}, _r` },
      { name: '只看同一個 namespace、只列出會被動到的 PDB', code: `def _pod(name, node, app, owner="ReplicaSet", ready=True, emptydir=False, ns="clinic"):
    return {"name": name, "namespace": ns, "node": node, "labels": {"app": app},
            "owner": owner, "emptydir": emptydir, "ready": ready}
def _pdb(name, app, ns="clinic", **kw):
    d = {"name": name, "namespace": ns, "selector": {"app": app}}
    d.update(kw)
    return d
_pods = [_pod("a", "n2", "clinic-api"), _pod("b", "n1", "clinic-api", ns="clinic-test"), _pod("c", "n1", "report-worker")]
_pdbs = [_pdb("api", "clinic-api", ns="clinic-test", min_available=1), _pdb("rw", "report-worker", min_available=1)]
_r = drain_check("n2", _pods, _pdbs)
assert _r == {"errors": [], "pdbs": {}, "result": "ok"}, _r
_pods.append(_pod("d", "n2", "clinic-api", ns="clinic-test"))
_pdbs[0]["min_available"] = 2
_r = drain_check("n2", _pods, _pdbs)
assert _r["pdbs"] == {"api": "stuck"}, ("clinic namespace 的 Pod 不算在 clinic-test 的 PDB 裡", _r)` },
      { name: 'result 的優先順序：error、stuck、wait、ok', code: `def _pod(name, node, app, owner="ReplicaSet", ready=True, emptydir=False, ns="clinic"):
    return {"name": name, "namespace": ns, "node": node, "labels": {"app": app},
            "owner": owner, "emptydir": emptydir, "ready": ready}
def _pdb(name, app, ns="clinic", **kw):
    d = {"name": name, "namespace": ns, "selector": {"app": app}}
    d.update(kw)
    return d
_pods = [_pod("rw", "n2", "report-worker"), _pod("ds", "n2", "fluent-bit", owner="DaemonSet"), _pod("a", "n2", "api"), _pod("b", "n2", "api")]
_pdbs = [_pdb("rw", "report-worker", min_available=1), _pdb("api", "api", min_available=1)]
_r = drain_check("n2", _pods, _pdbs)
assert _r["result"] == "error", _r
assert _r["pdbs"] == {"rw": "stuck", "api": "wait"}, ("有 errors 時 pdbs 照樣要算", _r)
assert drain_check("n2", _pods, _pdbs, ignore_daemonsets=True)["result"] == "stuck"
assert drain_check("n2", _pods, _pdbs[1:], ignore_daemonsets=True)["result"] == "wait"` },
    ],
  },
  {
    id: 'k8s-operations-2', skill: 'k8s-operations', kind: 'python', level: 2,
    title: '升級前找出已被移除的 apiVersion',
    prompt: '升級前要找出 manifest 裡目標版本已經不提供的 apiVersion。實作 `scan(text, target) -> list`：\n\n- `text` 是多份 YAML 文件，用單獨一行的 `---` 分隔。沒有內容（只有空行與 `#` 註解）的文件略過、不編號，其餘從 1 開始編號\n- 每份文件只看**最上層**（沒有縮排）的 `apiVersion` 與 `kind`，以及 `metadata` 底下第一層的 `name`（沒有就是 `None`）。`spec` 裡縮排的 `apiVersion`、`kind` 不算\n- 值要去掉行尾的 `#` 註解與前後的引號\n- `(apiVersion, kind)` 在 `REMOVED` 裡，而且停止提供的版本小於或等於 `target`，就列出來。版本是 `"1.25"` 這種字串，要比次版本的數字（`"1.9"` 比 `"1.16"` 舊）\n\n每筆結果是 `{"doc": 編號, "kind": ..., "name": ..., "apiVersion": ..., "removed_in": ..., "replacement": ...}`，依文件順序排列。`REMOVED` 已經寫在起始碼裡，是官方遷移指南的一部分。',
    starter: `# 停止提供的 API（摘自官方 Deprecated API Migration Guide 的一部分；完整清單以官方為準）
# (apiVersion, kind) → (停止提供的版本, 改用的 apiVersion；None 表示沒有直接替代)
REMOVED = {
    ("extensions/v1beta1", "Deployment"): ("1.16", "apps/v1"),
    ("apps/v1beta1", "Deployment"): ("1.16", "apps/v1"),
    ("apps/v1beta2", "Deployment"): ("1.16", "apps/v1"),
    ("extensions/v1beta1", "DaemonSet"): ("1.16", "apps/v1"),
    ("extensions/v1beta1", "Ingress"): ("1.22", "networking.k8s.io/v1"),
    ("networking.k8s.io/v1beta1", "Ingress"): ("1.22", "networking.k8s.io/v1"),
    ("batch/v1beta1", "CronJob"): ("1.25", "batch/v1"),
    ("policy/v1beta1", "PodDisruptionBudget"): ("1.25", "policy/v1"),
    ("policy/v1beta1", "PodSecurityPolicy"): ("1.25", None),
    ("autoscaling/v2beta1", "HorizontalPodAutoscaler"): ("1.25", "autoscaling/v2"),
    ("autoscaling/v2beta2", "HorizontalPodAutoscaler"): ("1.26", "autoscaling/v2"),
    ("flowcontrol.apiserver.k8s.io/v1beta3", "FlowSchema"): ("1.32", "flowcontrol.apiserver.k8s.io/v1"),
}


def scan(text, target):
    # TODO：現在只要文件裡出現舊的 apiVersion 與 kind 字樣就算，沒分最上層與 spec 裡面，
    #       沒讀 metadata.name，版本也是用字串比較
    found = []
    for i, doc in enumerate(text.split("---"), 1):
        for (api, kind), (removed_in, replacement) in REMOVED.items():
            if "apiVersion: " + api in doc and "kind: " + kind in doc and removed_in <= target:
                found.append({"doc": i, "kind": kind, "name": None, "apiVersion": api,
                              "removed_in": removed_in, "replacement": replacement})
    return found


manifest = """
apiVersion: apps/v1
kind: Deployment
metadata:
  name: clinic-api
  namespace: clinic
---
apiVersion: policy/v1beta1      # 從舊範本複製的
kind: PodDisruptionBudget
metadata:
  name: clinic-api
spec:
  minAvailable: 1
---
apiVersion: autoscaling/v2beta2
kind: HorizontalPodAutoscaler
metadata:
  labels:
    app: clinic-api
  name: clinic-api
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: clinic-api
"""
for f in scan(manifest, "1.35"):
    print(f)
`,
    solution: `# 停止提供的 API（摘自官方 Deprecated API Migration Guide 的一部分；完整清單以官方為準）
# (apiVersion, kind) → (停止提供的版本, 改用的 apiVersion；None 表示沒有直接替代)
REMOVED = {
    ("extensions/v1beta1", "Deployment"): ("1.16", "apps/v1"),
    ("apps/v1beta1", "Deployment"): ("1.16", "apps/v1"),
    ("apps/v1beta2", "Deployment"): ("1.16", "apps/v1"),
    ("extensions/v1beta1", "DaemonSet"): ("1.16", "apps/v1"),
    ("extensions/v1beta1", "Ingress"): ("1.22", "networking.k8s.io/v1"),
    ("networking.k8s.io/v1beta1", "Ingress"): ("1.22", "networking.k8s.io/v1"),
    ("batch/v1beta1", "CronJob"): ("1.25", "batch/v1"),
    ("policy/v1beta1", "PodDisruptionBudget"): ("1.25", "policy/v1"),
    ("policy/v1beta1", "PodSecurityPolicy"): ("1.25", None),
    ("autoscaling/v2beta1", "HorizontalPodAutoscaler"): ("1.25", "autoscaling/v2"),
    ("autoscaling/v2beta2", "HorizontalPodAutoscaler"): ("1.26", "autoscaling/v2"),
    ("flowcontrol.apiserver.k8s.io/v1beta3", "FlowSchema"): ("1.32", "flowcontrol.apiserver.k8s.io/v1"),
}


def minor(v):
    return int(v.split(".")[1])          # "1.9" → 9、"1.16" → 16；字串比較會得到相反的結果


def value(line):
    """key: value  # 註解 → value（去掉註解與引號）"""
    v = line.split(":", 1)[1]
    v = v.split(" #", 1)[0].strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in ("'", '"'):
        v = v[1:-1]
    return v


def parse(doc_lines):
    info = {"apiVersion": None, "kind": None, "name": None}
    in_meta, child = False, None
    for line in doc_lines:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip(" "))
        text = line.strip()
        if indent == 0:                                # 最上層的鍵
            in_meta = text.startswith("metadata:")
            child = None
            if text.startswith("apiVersion:"):
                info["apiVersion"] = value(text)
            elif text.startswith("kind:"):
                info["kind"] = value(text)
            continue
        if in_meta:
            if child is None:
                child = indent                         # metadata 底下第一層的縮排
            if indent == child and text.startswith("name:") and info["name"] is None:
                info["name"] = value(text)
    return info


def scan(text, target):
    docs, cur = [], []
    for line in text.splitlines():
        if line.strip() == "---":
            docs.append(cur)
            cur = []
        else:
            cur.append(line)
    docs.append(cur)
    docs = [d for d in docs if any(l.strip() and not l.lstrip().startswith("#") for l in d)]

    found = []
    for i, d in enumerate(docs, 1):
        info = parse(d)
        hit = REMOVED.get((info["apiVersion"], info["kind"]))
        if hit and minor(hit[0]) <= minor(target):
            found.append({"doc": i, "kind": info["kind"], "name": info["name"], "apiVersion": info["apiVersion"],
                          "removed_in": hit[0], "replacement": hit[1]})
    return found


manifest = """
apiVersion: apps/v1
kind: Deployment
metadata:
  name: clinic-api
  namespace: clinic
---
apiVersion: policy/v1beta1      # 從舊範本複製的
kind: PodDisruptionBudget
metadata:
  name: clinic-api
spec:
  minAvailable: 1
---
apiVersion: autoscaling/v2beta2
kind: HorizontalPodAutoscaler
metadata:
  labels:
    app: clinic-api
  name: clinic-api
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: clinic-api
"""
for f in scan(manifest, "1.35"):
    print(f)
`,
    hints: [
      '先依單獨一行的 `---` 切成文件，再丟掉沒有內容的文件，剩下的才編號。',
      '最上層的鍵是沒有縮排的行。進到 `metadata:` 之後，記下第一個子行的縮排，只在這個縮排找 `name:`。',
      '`int("1.16".split(".")[1])` 是 16；直接比字串的話，`"1.16" < "1.9"` 是 True。',
    ],
    tests: [
      { name: '找出目標版本已不提供的 apiVersion', code: `_m = """apiVersion: apps/v1
kind: Deployment
metadata:
  name: clinic-api
---
apiVersion: policy/v1beta1
kind: PodDisruptionBudget
metadata:
  name: clinic-api-pdb
---
apiVersion: autoscaling/v2beta2
kind: HorizontalPodAutoscaler
metadata:
  name: clinic-api-hpa
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: nightly-report
"""
_r = scan(_m, "1.35")
assert _r == [
    {"doc": 2, "kind": "PodDisruptionBudget", "name": "clinic-api-pdb", "apiVersion": "policy/v1beta1", "removed_in": "1.25", "replacement": "policy/v1"},
    {"doc": 3, "kind": "HorizontalPodAutoscaler", "name": "clinic-api-hpa", "apiVersion": "autoscaling/v2beta2", "removed_in": "1.26", "replacement": "autoscaling/v2"},
], _r` },
      { name: '停止提供的版本等於目標版本也算', code: `_m = """apiVersion: apps/v1
kind: Deployment
metadata:
  name: clinic-api
---
apiVersion: policy/v1beta1
kind: PodDisruptionBudget
metadata:
  name: clinic-api-pdb
---
apiVersion: autoscaling/v2beta2
kind: HorizontalPodAutoscaler
metadata:
  name: clinic-api-hpa
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: nightly-report
"""
_r = scan(_m, "1.25")
assert [x["doc"] for x in _r] == [2], "1.25 停止提供 policy/v1beta1，autoscaling/v2beta2 要到 1.26"
assert scan(_m, "1.24") == []` },
      { name: '版本要用數字比較', code: `_old = """apiVersion: extensions/v1beta1
kind: Deployment
metadata:
  name: legacy-his
"""
assert scan(_old, "1.9") == [], "1.9 < 1.16：版本要用數字比較，字串比較 '1.16' <= '1.9' 會是 True"
assert scan(_old, "1.16")[0]["replacement"] == "apps/v1"` },
      { name: '略過空的文件、去掉註解與引號、只比對表裡的組合', code: `_q = """---
# 註解掉的舊設定
---
apiVersion: "policy/v1beta1"   # 舊範本
kind: 'PodSecurityPolicy'
metadata:
  name: restricted
---

---
apiVersion: apps/v1beta1
kind: ConfigMap
metadata:
  name: not-in-table
"""
_r = scan(_q, "1.30")
assert _r == [{"doc": 1, "kind": "PodSecurityPolicy", "name": "restricted", "apiVersion": "policy/v1beta1", "removed_in": "1.25", "replacement": None}], _r` },
      { name: '只看最上層的 apiVersion，name 取 metadata 第一層', code: `_n = """apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  labels:
    name: should-not-be-used
  name: report-hpa
spec:
  scaleTargetRef:
    apiVersion: extensions/v1beta1
    kind: Deployment
    name: report-worker
---
apiVersion: networking.k8s.io/v1beta1
kind: Ingress
metadata:
  annotations:
    note: "name: x"
  name: clinic-web
"""
_r = scan(_n, "1.37")
assert _r == [{"doc": 2, "kind": "Ingress", "name": "clinic-web", "apiVersion": "networking.k8s.io/v1beta1", "removed_in": "1.22", "replacement": "networking.k8s.io/v1"}], _r` },
      { name: '沒有 metadata.name 時是 None', code: `_nn = """apiVersion: batch/v1beta1
kind: CronJob
spec:
  schedule: "0 2 * * *"
"""
assert scan(_nn, "1.35") == [{"doc": 1, "kind": "CronJob", "name": None, "apiVersion": "batch/v1beta1", "removed_in": "1.25", "replacement": "batch/v1"}]` },
    ],
  },
]

// 程式題：p11-p2（container-registry）
// Python 題的測試碼接在使用者的程式之後執行，直接呼叫使用者定義的函式與常數。
// 測試碼寫在 template literal 裡：Python 的反斜線要寫成兩個，`${` 要跳脫。
export default [
  {
    id: 'container-registry-1', skill: 'container-registry', kind: 'python', level: 2,
    title: '模擬 Harbor 的保留規則，並估算垃圾回收後釋放的空間',
    prompt: 'Harbor 的保留規則只看推送時間、拉取時間與 tag 名稱，不知道哪個映像正在叢集裡跑。實作 `plan_retention(artifacts, today, keep_latest, pulled_within_days, keep_tag_patterns, layer_sizes, referenced_elsewhere=())`：先算出 Harbor 的規則會保留哪些 artifact，再加一道「部署中的不刪」的安全網，最後估算垃圾回收後能釋放多少空間。\n\n每個 artifact 有 `digest`、`tags`（清單，可以是空的）、`pushed`、`last_pulled`（`YYYY-MM-DD` 字串，`last_pulled` 可以是 `None`）、`deployed`（布林）、`layers`（用到的 layer 名稱）。`today` 也是 `YYYY-MM-DD` 字串，`layer_sizes` 是每個 layer 的大小（bytes）。\n\nHarbor 的規則：\n\n- 沒有 tag 的 artifact（untagged）不適用下面三條規則，也不占「最近 N 個」的名額\n- 保留依 `pushed` 由新到舊的前 `keep_latest` 個（測試資料的推送日期不會重複）\n- 保留 `last_pulled` 距 `today` 不超過 `pulled_within_days` 天的（剛好等於也保留）\n- 保留任何一個 tag 符合 `keep_tag_patterns` 任一個樣式的（用 `fnmatch` 比對）；一個 tag 符合，整個 artifact 保留\n- 三條規則是 OR，符合任何一條就保留\n\n安全網：`deployed` 是 `True` 的一律保留；只靠安全網才保留的，列進 `at_risk`。\n\n回傳 `{"keep": [...], "delete": [...], "freed_bytes": 整數, "at_risk": [...]}`，清單裡放 digest、依輸入的順序。`freed_bytes` 是被刪的 artifact 用到、但沒有任何保留的 artifact 用到、也不在 `referenced_elsewhere` 裡的 layer 大小總和，同一個 layer 只算一次。',
    starter: `from datetime import date
from fnmatch import fnmatch


def plan_retention(artifacts, today, keep_latest, pulled_within_days, keep_tag_patterns,
                   layer_sizes, referenced_elsewhere=()):
    # TODO：現在只保留最近推送的 N 個、其他全刪；freed_bytes 把被刪映像的每一層都加進去
    newest = sorted(artifacts, key=lambda a: a["pushed"], reverse=True)[:keep_latest]
    keep = [a["digest"] for a in artifacts if a in newest]
    delete = [a["digest"] for a in artifacts if a not in newest]
    freed = sum(layer_sizes[l] for a in artifacts if a["digest"] in delete for l in a["layers"])
    return {"keep": keep, "delete": delete, "freed_bytes": freed, "at_risk": []}
MB = 1024 * 1024
LAYERS = {"base": 140 * MB, "venv-1": 60 * MB, "venv-2": 64 * MB, "app-1": MB, "app-2": MB, "app-3": MB}
ARTIFACTS = [
    {"digest": "sha256:01", "tags": ["5b7a10fe"], "pushed": "2026-06-01", "last_pulled": "2026-06-02",
     "deployed": False, "layers": ["base", "venv-1", "app-1"]},
    {"digest": "sha256:02", "tags": ["c2f81b6a", "release-1.4.0"], "pushed": "2026-08-03", "last_pulled": "2026-08-04",
     "deployed": True, "layers": ["base", "venv-2", "app-2"]},
    {"digest": "sha256:03", "tags": ["0b6e4f21"], "pushed": "2026-11-04", "last_pulled": "2026-11-05",
     "deployed": False, "layers": ["base", "venv-2", "app-3"]},
]
print(plan_retention(ARTIFACTS, "2026-11-16", 1, 30, ["release-*"], LAYERS))
`,
    solution: `from datetime import date
from fnmatch import fnmatch


def plan_retention(artifacts, today, keep_latest, pulled_within_days, keep_tag_patterns,
                   layer_sizes, referenced_elsewhere=()):
    today = date.fromisoformat(today)
    # untagged 的 artifact 不進任何一條 Harbor 規則，也不占「最近 N 個」的名額
    tagged = [a for a in artifacts if a["tags"]]

    retained = set()
    newest = sorted(tagged, key=lambda a: a["pushed"], reverse=True)[:keep_latest]
    retained.update(a["digest"] for a in newest)
    for a in tagged:
        pulled = a.get("last_pulled")
        if pulled is not None and (today - date.fromisoformat(pulled)).days <= pulled_within_days:
            retained.add(a["digest"])
        # 一個 tag 符合就保留整個 artifact（連同它的其他 tag）
        if any(fnmatch(t, p) for t in a["tags"] for p in keep_tag_patterns):
            retained.add(a["digest"])

    keep, delete, at_risk = [], [], []
    for a in artifacts:
        if a["digest"] in retained:
            keep.append(a["digest"])
        elif a.get("deployed"):
            keep.append(a["digest"])
            at_risk.append(a["digest"])
        else:
            delete.append(a["digest"])

    by_digest = {a["digest"]: a for a in artifacts}
    still_used = {l for d in keep for l in by_digest[d]["layers"]} | set(referenced_elsewhere)
    freed = {l for d in delete for l in by_digest[d]["layers"]} - still_used
    return {
        "keep": keep,
        "delete": delete,
        "freed_bytes": sum(layer_sizes[l] for l in freed),
        "at_risk": at_risk,
    }


MB = 1024 * 1024
LAYERS = {"base": 140 * MB, "venv-1": 60 * MB, "venv-2": 64 * MB, "app-1": MB, "app-2": MB, "app-3": MB}
ARTIFACTS = [
    {"digest": "sha256:01", "tags": ["5b7a10fe"], "pushed": "2026-06-01", "last_pulled": "2026-06-02",
     "deployed": False, "layers": ["base", "venv-1", "app-1"]},
    {"digest": "sha256:02", "tags": ["c2f81b6a", "release-1.4.0"], "pushed": "2026-08-03", "last_pulled": "2026-08-04",
     "deployed": True, "layers": ["base", "venv-2", "app-2"]},
    {"digest": "sha256:03", "tags": ["0b6e4f21"], "pushed": "2026-11-04", "last_pulled": "2026-11-05",
     "deployed": False, "layers": ["base", "venv-2", "app-3"]},
]
print(plan_retention(ARTIFACTS, "2026-11-16", 1, 30, ["release-*"], LAYERS))
`,
    hints: [
      '先過濾出有 tag 的 artifact。「最近 N 個」用 `sorted(tagged, key=lambda a: a["pushed"], reverse=True)[:keep_latest]`；ISO 格式的日期字串可以直接比大小。',
      '天數用 `(date.fromisoformat(today) - date.fromisoformat(a["last_pulled"])).days`，記得先排除 `None`。',
      '`freed_bytes` 用集合算：被刪的 artifact 用到的 layer，減掉保留的 artifact 用到的 layer，再減掉 `referenced_elsewhere`。',
    ],
    tests: [
      { name: '範例：commit tag 被刪、release 與最近的保留', code: `_r = plan_retention(ARTIFACTS, "2026-11-16", 1, 30, ["release-*"], LAYERS)
assert set(_r) >= {"keep", "delete", "freed_bytes", "at_risk"}, f"回傳的 dict 要有 keep、delete、freed_bytes、at_risk，你的是 {sorted(_r)}"
assert _r["keep"] == ["sha256:02", "sha256:03"], f"keep 應該是 ['sha256:02', 'sha256:03']（依輸入順序），你的是 {_r['keep']}"
assert _r["delete"] == ["sha256:01"], f"delete 應該是 ['sha256:01']，你的是 {_r['delete']}"
assert _r["at_risk"] == [], f"sha256:02 有 release tag，規則本來就會保留，不算 at_risk，你的是 {_r['at_risk']}"
assert _r["freed_bytes"] == 61 * 1024 * 1024, f"sha256:01 被刪後只有 venv-1 與 app-1 沒人用（共 61 MB = {61 * 1024 * 1024} bytes），你的是 {_r['freed_bytes']}"` },
      { name: '規則之間是 OR；拉取天數剛好 30 天算在內', code: `_M = 1024 * 1024
_L = {"x": _M}
def _a(d, tags, pushed, pulled):
    return {"digest": d, "tags": tags, "pushed": pushed, "last_pulled": pulled, "deployed": False, "layers": ["x"]}
_arts = [
    _a("d1", ["aaa"], "2026-01-01", "2026-10-17"),   # 30 天前被拉過
    _a("d2", ["bbb"], "2026-01-02", "2026-10-16"),   # 31 天前
    _a("d3", ["ccc"], "2026-01-03", None),           # 從沒被拉過
    _a("d4", ["ddd"], "2026-01-04", None),
    _a("d5", ["eee"], "2026-01-05", None),
]
_r = plan_retention(_arts, "2026-11-16", 2, 30, [], _L)
assert _r["keep"] == ["d1", "d4", "d5"], f"d1 靠拉取天數（剛好 30 天要算）、d4 和 d5 靠最近推送的 2 個保留，你的 keep 是 {_r['keep']}"
assert _r["delete"] == ["d2", "d3"], f"你的 delete 是 {_r['delete']}"
_r = plan_retention(_arts, "2026-11-16", 0, 0, [], _L)
assert _r["keep"] == [] and len(_r["delete"]) == 5, "keep_latest 是 0、拉取天數也不符合時，全部刪除"` },
      { name: '一個 tag 符合，整個 artifact 連同其他 tag 都保留', code: `_L = {"x": 1}
_arts = [
    {"digest": "r1", "tags": ["77d0a9c4", "release-1.3.0"], "pushed": "2025-09-01", "last_pulled": "2025-10-01", "deployed": False, "layers": ["x"]},
    {"digest": "r2", "tags": ["hotfix-2", "rc-1.3.1"], "pushed": "2025-09-05", "last_pulled": None, "deployed": False, "layers": ["x"]},
    {"digest": "r3", "tags": ["9c41e2d0"], "pushed": "2025-09-09", "last_pulled": None, "deployed": False, "layers": ["x"]},
]
_r = plan_retention(_arts, "2026-11-16", 0, 30, ["release-*", "rc-*"], _L)
assert _r["keep"] == ["r1", "r2"], f"r1 的 release-1.3.0、r2 的 rc-1.3.1 符合樣式，你的 keep 是 {_r['keep']}"
assert _r["delete"] == ["r3"], f"你的 delete 是 {_r['delete']}"
_r = plan_retention(_arts, "2026-11-16", 0, 30, ["release-1.3.*"], _L)
assert _r["keep"] == ["r1"], f"樣式用 fnmatch 比對：release-1.3.* 只符合 r1，你的 keep 是 {_r['keep']}"` },
      { name: 'untagged 的 artifact 不占最近 N 個的名額，也不會被拉取天數保留', code: `_L = {"x": 1}
_arts = [
    {"digest": "u1", "tags": [], "pushed": "2026-11-15", "last_pulled": "2026-11-15", "deployed": False, "layers": ["x"]},
    {"digest": "t1", "tags": ["0b6e4f21"], "pushed": "2026-11-04", "last_pulled": None, "deployed": False, "layers": ["x"]},
    {"digest": "t2", "tags": ["f93c2a8d"], "pushed": "2026-11-10", "last_pulled": None, "deployed": False, "layers": ["x"]},
]
_r = plan_retention(_arts, "2026-11-16", 2, 30, ["**"], _L)
assert _r["keep"] == ["t1", "t2"], f"u1 沒有 tag：不算進最近 2 個，昨天被拉過、樣式 ** 也保不住它。你的 keep 是 {_r['keep']}"
assert _r["delete"] == ["u1"], f"你的 delete 是 {_r['delete']}"` },
      { name: '部署中的 artifact 一律保留；只靠安全網保留的列進 at_risk', code: `_L = {"x": 1}
_arts = [
    {"digest": "p1", "tags": ["3a9d5e01"], "pushed": "2026-09-10", "last_pulled": "2026-09-11", "deployed": True, "layers": ["x"]},
    {"digest": "p2", "tags": ["c2f81b6a", "release-1.4.0"], "pushed": "2026-08-03", "last_pulled": "2026-08-04", "deployed": True, "layers": ["x"]},
    {"digest": "p3", "tags": [], "pushed": "2026-07-01", "last_pulled": None, "deployed": True, "layers": ["x"]},
    {"digest": "p4", "tags": ["41be0c77"], "pushed": "2026-10-05", "last_pulled": "2026-10-05", "deployed": False, "layers": ["x"]},
]
_r = plan_retention(_arts, "2026-11-16", 0, 30, ["release-*"], _L)
assert _r["keep"] == ["p1", "p2", "p3"], f"部署中的都要保留，你的 keep 是 {_r['keep']}"
assert _r["at_risk"] == ["p1", "p3"], f"p1、p3 只靠安全網；p2 規則本來就保留。你的 at_risk 是 {_r['at_risk']}"
assert _r["delete"] == ["p4"], f"你的 delete 是 {_r['delete']}"` },
      { name: '釋放的空間：共用的層、別處還在用的層都不算，同一層只算一次', code: `_M = 1024 * 1024
_L = {"base": 140 * _M, "venv-1": 60 * _M, "venv-2": 64 * _M, "a1": _M, "a2": _M, "a3": 2 * _M, "a4": 3 * _M}
def _a(d, tags, pushed, layers):
    return {"digest": d, "tags": tags, "pushed": pushed, "last_pulled": None, "deployed": False, "layers": layers}
_arts = [
    _a("o1", ["aaa"], "2026-01-01", ["base", "venv-1", "a1"]),
    _a("o2", ["bbb"], "2026-02-01", ["base", "venv-1", "a2"]),
    _a("o3", ["ccc"], "2026-03-01", ["base", "venv-2", "a3"]),
    _a("n1", ["ddd"], "2026-11-01", ["base", "venv-2", "a4"]),
]
_r = plan_retention(_arts, "2026-11-16", 1, 30, [], _L)
assert _r["delete"] == ["o1", "o2", "o3"], f"你的 delete 是 {_r['delete']}"
_want = 60 * _M + _M + _M + 2 * _M
assert _r["freed_bytes"] == _want, f"venv-1 只算一次，base 與 venv-2 還被 n1 用著；應該釋放 {_want} bytes，你的是 {_r['freed_bytes']}"
_r = plan_retention(_arts, "2026-11-16", 1, 30, [], _L, referenced_elsewhere={"venv-1"})
assert _r["freed_bytes"] == 4 * _M, f"venv-1 在別的 repository 還被用著，不會釋放；應該是 {4 * _M}，你的是 {_r['freed_bytes']}"
_r = plan_retention(_arts, "2026-11-16", 9, 30, [], _L)
assert _r["delete"] == [] and _r["freed_bytes"] == 0, "沒有要刪的，就沒有釋放的空間"` },
    ],
  },
  {
    id: 'container-registry-2', skill: 'container-registry', kind: 'python', level: 3,
    title: '把 Dockerfile 的外部映像改指院內的代理快取',
    prompt: '院內的 Harbor 替三個外部 registry 各建了一個代理快取專案（`PROXIES`）。Dockerfile 裡的外部映像要改成經由代理快取拉取。實作兩個函式。\n\n`to_internal(ref)`：把一個映像名稱改成院內位址。\n\n- 第一段（第一個 `/` 之前）含有 `.` 或 `:`，或是 `localhost`，才是 registry；否則 registry 是 `docker.io`，整個字串都是映像路徑\n- `index.docker.io` 與 `docker.io` 都是 Docker Hub\n- Docker Hub 上只有一段名稱的映像（官方映像）要補 `library/`：`python:3.12-slim` 改成 `harbor.example.org/dockerhub-proxy/library/python:3.12-slim`\n- 結果是 `harbor.example.org/<代理專案>/<映像路徑>`，tag 與 digest 原樣保留；原本沒有 tag 就不要補\n- 已經是 `harbor.example.org` 的不改；registry 不在 `PROXIES` 裡就丟 `ValueError`（例如 `registry.k8s.io` 的映像要另外同步）\n\n`rewrite_dockerfile(text)`：逐行改寫，回傳新的內容，行數不變。\n\n- `FROM` 開頭的行（不分大小寫，前面可以有空白，映像前可以有 `--platform=…` 這類旗標）：改寫映像名稱；行尾的 `AS <名稱>` 定義一個階段名稱\n- `COPY` 開頭、帶 `--from=<來源>` 的行：來源是外部映像才改寫\n- 不改：`scratch`、前面定義過的階段名稱（不分大小寫）、純數字的階段編號、含 `$` 的變數\n- 其他行（包括 `RUN echo "FROM …"` 這種字串）原樣保留',
    starter: `import re

INTERNAL = "harbor.example.org"
# 外部 registry → 院內 Harbor 上對應的代理快取專案
PROXIES = {"docker.io": "dockerhub-proxy", "ghcr.io": "ghcr-proxy", "quay.io": "quay-proxy"}


def to_internal(ref: str) -> str:
    # TODO：現在一律加上 dockerhub-proxy 的前綴，沒有分辨 registry，也沒有補 library/
    return f"{INTERNAL}/{PROXIES['docker.io']}/{ref}"


def rewrite_dockerfile(text: str) -> str:
    # TODO：現在只把 FROM 後面的第一個字換掉；階段名稱、scratch、COPY --from 都沒處理
    out = []
    for line in text.split("\\n"):
        parts = line.split(" ")
        if parts[0] == "FROM" and len(parts) > 1:
            parts[1] = to_internal(parts[1])
        out.append(" ".join(parts))
    return "\\n".join(out)
DOCKERFILE = """# syntax=docker/dockerfile:1
FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev

FROM harbor.example.org/base/python-informix:3.12-slim-2026.11
COPY --from=build /app/.venv /app/.venv
CMD ["uvicorn", "clinic.main:app", "--host", "0.0.0.0", "--port", "8000"]
"""
print(rewrite_dockerfile(DOCKERFILE))
print(to_internal("postgres:16"))
`,
    solution: `import re

INTERNAL = "harbor.example.org"
# 外部 registry → 院內 Harbor 上對應的代理快取專案
PROXIES = {"docker.io": "dockerhub-proxy", "ghcr.io": "ghcr-proxy", "quay.io": "quay-proxy"}


def to_internal(ref: str) -> str:
    # 第一段有 . 或 :，或是 localhost，才是 registry；否則是 Docker Hub
    first, sep, rest = ref.partition("/")
    if sep and ("." in first or ":" in first or first == "localhost"):
        registry, path = first, rest
    else:
        registry, path = "docker.io", ref
    if registry == "index.docker.io":
        registry = "docker.io"
    if registry == INTERNAL:
        return ref
    if registry not in PROXIES:
        raise ValueError(f"沒有 {registry} 的代理快取")
    # Docker Hub 的官方映像只有一段名稱，實際在 library/ 底下
    name = path.split("@", 1)[0].split(":", 1)[0]
    if registry == "docker.io" and "/" not in name:
        path = "library/" + path
    return f"{INTERNAL}/{PROXIES[registry]}/{path}"


FROM_LINE = re.compile(r"^(\\s*FROM\\s+(?:--\\S+\\s+)*)(\\S+)(.*)$", re.IGNORECASE)
COPY_FROM = re.compile(r"^(\\s*COPY\\s+(?:--\\S+\\s+)*?--from=)(\\S+)(.*)$", re.IGNORECASE)
STAGE_NAME = re.compile(r"\\s+AS\\s+(\\S+)\\s*$", re.IGNORECASE)


def rewrite_dockerfile(text: str) -> str:
    stages = set()
    out = []
    for line in text.split("\\n"):
        m = FROM_LINE.match(line)
        if m:
            head, image, tail = m.groups()
            if image.lower() != "scratch" and image.lower() not in stages and "$" not in image:
                image = to_internal(image)
            s = STAGE_NAME.search(tail)
            if s:
                stages.add(s.group(1).lower())
            out.append(head + image + tail)
            continue
        m = COPY_FROM.match(line)
        if m:
            head, src, tail = m.groups()
            if src.lower() not in stages and not src.isdigit() and "$" not in src:
                src = to_internal(src)
            out.append(head + src + tail)
            continue
        out.append(line)
    return "\\n".join(out)


DOCKERFILE = """# syntax=docker/dockerfile:1
FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev

FROM harbor.example.org/base/python-informix:3.12-slim-2026.11
COPY --from=build /app/.venv /app/.venv
CMD ["uvicorn", "clinic.main:app", "--host", "0.0.0.0", "--port", "8000"]
"""
print(rewrite_dockerfile(DOCKERFILE))
print(to_internal("postgres:16"))
`,
    hints: [
      '判斷 registry：`first, sep, rest = ref.partition("/")`，`sep` 不是空字串，而且 `first` 含有 `.`、`:` 或等於 `localhost`。`grafana/grafana` 的 `grafana` 是 Docker Hub 的 namespace，不是 registry。',
      '要不要補 `library/`，看去掉 digest 與 tag 之後的名稱有沒有 `/`：`path.split("@", 1)[0].split(":", 1)[0]`。',
      'FROM 行可以用 `re.match(r"^(\\s*FROM\\s+(?:--\\S+\\s+)*)(\\S+)(.*)$", line, re.IGNORECASE)` 拆成三段，只換中間那段；`AS` 後面的名稱轉小寫記進一個集合。',
    ],
    tests: [
      { name: 'Docker Hub 的官方映像要補 library/', code: `_r = to_internal("python:3.12-slim")
assert _r == "harbor.example.org/dockerhub-proxy/library/python:3.12-slim", f"省略 registry 就是 docker.io，官方映像在 library/ 底下；你的結果 {_r}"
_r = to_internal("redis")
assert _r == "harbor.example.org/dockerhub-proxy/library/redis", f"沒有 tag 就不要自己補（也不要補 latest）；你的結果 {_r}"
_r = to_internal("docker.io/postgres:16")
assert _r == "harbor.example.org/dockerhub-proxy/library/postgres:16", f"寫了 docker.io 但只有一段名稱，一樣要補 library/；你的結果 {_r}"` },
      { name: '有 namespace 的 Docker Hub 映像、index.docker.io 與 digest', code: `_r = to_internal("grafana/grafana:12.2.1")
assert _r == "harbor.example.org/dockerhub-proxy/grafana/grafana:12.2.1", f"grafana/grafana 的第一段沒有 . 或 :，是 Docker Hub 的 namespace，不是 registry；你的結果 {_r}"
_d = "sha256:9c1e" + "0" * 60
_r = to_internal("docker.io/library/python:3.12-slim@" + _d)
assert _r == "harbor.example.org/dockerhub-proxy/library/python:3.12-slim@" + _d, f"digest 要原樣保留，也不能重複補 library/；你的結果 {_r}"
_r = to_internal("python@" + _d)
assert _r == "harbor.example.org/dockerhub-proxy/library/python@" + _d, f"只有 digest、沒有 tag；你的結果 {_r}"
_r = to_internal("index.docker.io/library/nginx:1.27")
assert _r == "harbor.example.org/dockerhub-proxy/library/nginx:1.27", f"index.docker.io 也是 Docker Hub；你的結果 {_r}"` },
      { name: '其他 registry、院內位址與沒有代理的來源', code: `_r = to_internal("ghcr.io/astral-sh/uv:0.11.32")
assert _r == "harbor.example.org/ghcr-proxy/astral-sh/uv:0.11.32", f"ghcr.io 要換成 ghcr-proxy，不要補 library/；你的結果 {_r}"
_r = to_internal("quay.io/jetstack/cert-manager-controller:v1.19.1")
assert _r == "harbor.example.org/quay-proxy/jetstack/cert-manager-controller:v1.19.1", f"你的結果 {_r}"
_r = to_internal("harbor.example.org/base/python-informix:3.12-slim-2026.11")
assert _r == "harbor.example.org/base/python-informix:3.12-slim-2026.11", f"已經是院內的位址就不要動；你的結果 {_r}"
for _ref in ("registry.k8s.io/pause:3.10.1", "localhost:5000/test/app:dev", "gcr.io/distroless/static:nonroot"):
    try:
        _r = to_internal(_ref)
    except ValueError:
        pass
    else:
        raise AssertionError(f"{_ref} 的 registry 不在 PROXIES 裡，要丟 ValueError；你回傳了 {_r}")` },
      { name: 'Dockerfile：FROM 與 COPY --from 的外部映像都要改', code: `_src = "FROM python:3.12-slim AS build\\nCOPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /bin/uv\\nRUN uv sync --locked --no-dev\\n"
_want = "FROM harbor.example.org/dockerhub-proxy/library/python:3.12-slim AS build\\nCOPY --from=harbor.example.org/ghcr-proxy/astral-sh/uv:0.11.32 /uv /bin/uv\\nRUN uv sync --locked --no-dev\\n"
_r = rewrite_dockerfile(_src)
assert _r == _want, f"改寫後應該是：\\n{_want}\\n你的結果：\\n{_r}"` },
      { name: 'Dockerfile：階段名稱、scratch、數字階段與變數不改', code: `_src = """# syntax=docker/dockerfile:1
ARG BASE=harbor.example.org/base/python-informix:3.12-slim-2026.11
FROM --platform=$BUILDPLATFORM golang:1.23 AS tools
FROM python:3.12-slim as Build
RUN echo "FROM python:3.11 這行只是字串"
FROM build AS test
FROM \${BASE}
COPY --from=Build /app/.venv /app/.venv
COPY --link --from=tools /go/bin/healthcheck /usr/local/bin/
COPY --from=0 /etc/ssl/certs /etc/ssl/certs
FROM scratch
copy --from=quay.io/jetstack/cert-manager-ctl:v1.19.1 /app/cmctl /cmctl"""
_want = """# syntax=docker/dockerfile:1
ARG BASE=harbor.example.org/base/python-informix:3.12-slim-2026.11
FROM --platform=$BUILDPLATFORM harbor.example.org/dockerhub-proxy/library/golang:1.23 AS tools
FROM harbor.example.org/dockerhub-proxy/library/python:3.12-slim as Build
RUN echo "FROM python:3.11 這行只是字串"
FROM build AS test
FROM \${BASE}
COPY --from=Build /app/.venv /app/.venv
COPY --link --from=tools /go/bin/healthcheck /usr/local/bin/
COPY --from=0 /etc/ssl/certs /etc/ssl/certs
FROM scratch
copy --from=harbor.example.org/quay-proxy/jetstack/cert-manager-ctl:v1.19.1 /app/cmctl /cmctl"""
_r = rewrite_dockerfile(_src)
for _i, (_a, _b) in enumerate(zip(_r.split("\\n"), _want.split("\\n")), 1):
    assert _a == _b, f"第 {_i} 行應該是\\n  {_b}\\n你的是\\n  {_a}"
assert _r.count("\\n") == _want.count("\\n"), "行數不對：不要刪掉或多加行"` },
    ],
  },
]

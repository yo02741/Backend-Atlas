// 程式題：P10 新課（m5 批）：llm-api-integration / context-engineering / self-hosted-models
export default [
  {
    id: 'llm-api-integration-1', skill: 'llm-api-integration', kind: 'python', level: 2,
    title: "call_structured：重試、驗證輸出、降級並回報用量",
    prompt: "實作 `call_structured(client, prompt, schema, max_attempts)`：呼叫模型、驗證輸出、必要時重試，最後回報用量。\n\n- `client.generate(prompt)`：成功時回傳 `{\"text\": str, \"usage\": {\"input_tokens\": int, \"output_tokens\": int}}`；失敗時丟 `Timeout` 或 `ApiError`（有 `.status`；429 時可能帶 `.retry_after` 秒數）\n- `schema`：`{欄位名: 型別}`，例如 `{\"department\": str, \"days\": int, \"urgent\": bool}`。輸出合格的條件：`text` 是合法 JSON、最外層是物件、每個欄位都在而且型別**完全相符**（`True` 不算 `int`）。合格時 `data` 只保留 schema 裡的欄位\n- 最多呼叫 `max_attempts` 次。**可以重試**的情況：`Timeout`、`ApiError` 的 status 是 429 或 5xx、拿到回應但輸出不合格。其他 `ApiError`（例如 400、401）**不重試**，立刻結束\n- 每次重試前該等的秒數依序記在 `delays`（本題不真的 sleep、也不加抖動）：第 n 次嘗試失敗後等 `0.5 * 2 ** (n - 1)` 秒（0.5、1、2…）；`ApiError` 的 `retry_after` 不是 `None` 時改用它。最後一次嘗試失敗後不再等\n- `usage` 是**所有拿到回應的呼叫**的 token 總和：輸出不合格的那幾次也已經被計費\n\n回傳：\n\n- 成功：`{\"ok\": True, \"data\": {...}, \"attempts\": 第幾次成功, \"delays\": [...], \"usage\": {\"input_tokens\": ..., \"output_tokens\": ...}}`\n- 不可重試的錯誤：`{\"ok\": False, \"data\": None, \"reason\": \"http_400\", \"attempts\": ..., \"delays\": [...], \"usage\": {...}}`（`reason` 是 `\"http_\"` 加上 status）\n- 次數用完：`ok` 是 `False`、`data` 是 `None`（呼叫端據此走降級流程）、`reason` 是 `\"exhausted\"`、`attempts` 等於 `max_attempts`",
    starter: `import json


class Timeout(Exception):
    pass


class ApiError(Exception):
    def __init__(self, status, retry_after=None):
        super().__init__(f"HTTP {status}")
        self.status = status
        self.retry_after = retry_after


def call_structured(client, prompt, schema, max_attempts):
    # 目前的版本：只呼叫一次、不驗證輸出、任何錯誤都往外丟
    resp = client.generate(prompt)
    return {"ok": True, "data": json.loads(resp["text"]), "attempts": 1, "delays": [], "usage": resp["usage"]}


class _Demo:
    """假的 client：第一次逾時，第二次回傳合格的 JSON"""
    def __init__(self):
        self.n = 0

    def generate(self, prompt):
        self.n += 1
        if self.n == 1:
            raise Timeout()
        return {"text": '{"department": "骨科", "days": 3, "urgent": false}',
                "usage": {"input_tokens": 120, "output_tokens": 20}}


try:
    print(call_structured(_Demo(), "右膝蓋痛三天", {"department": str, "days": int, "urgent": bool}, 3))
except Exception as e:
    print("沒有處理的例外：", type(e).__name__)
`,
    solution: `import json


class Timeout(Exception):
    pass


class ApiError(Exception):
    def __init__(self, status, retry_after=None):
        super().__init__(f"HTTP {status}")
        self.status = status
        self.retry_after = retry_after


def validate(text, schema):
    """合格就回傳只含 schema 欄位的 dict，不合格回傳 None。模型輸出當成不可信輸入來驗。"""
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    for field, typ in schema.items():
        if field not in data or type(data[field]) is not typ:   # type() is：True 不能冒充 int
            return None
    return {field: data[field] for field in schema}


def call_structured(client, prompt, schema, max_attempts):
    usage = {"input_tokens": 0, "output_tokens": 0}
    delays = []

    def result(ok, data, attempts, reason=None):
        out = {"ok": ok, "data": data, "attempts": attempts, "delays": delays, "usage": usage}
        if reason:
            out["reason"] = reason
        return out

    for attempt in range(1, max_attempts + 1):
        delay = 0.5 * 2 ** (attempt - 1)
        try:
            resp = client.generate(prompt)
        except Timeout:
            pass                                             # 可重試
        except ApiError as e:
            if not (e.status == 429 or 500 <= e.status <= 599):
                return result(False, None, attempt, f"http_{e.status}")   # 400、401…再送也一樣
            if e.retry_after is not None:
                delay = e.retry_after                        # 對方說了要等多久
        else:
            for k in usage:                                  # 不合格的回應也計費
                usage[k] += resp["usage"][k]
            data = validate(resp["text"], schema)
            if data is not None:
                return result(True, data, attempt)
        if attempt < max_attempts:                           # 最後一次失敗後不再等
            delays.append(delay)
    return result(False, None, max_attempts, "exhausted")


class _Demo:
    """假的 client：第一次逾時，第二次回傳合格的 JSON"""
    def __init__(self):
        self.n = 0

    def generate(self, prompt):
        self.n += 1
        if self.n == 1:
            raise Timeout()
        return {"text": '{"department": "骨科", "days": 3, "urgent": false}',
                "usage": {"input_tokens": 120, "output_tokens": 20}}


try:
    print(call_structured(_Demo(), "右膝蓋痛三天", {"department": str, "days": int, "urgent": bool}, 3))
except Exception as e:
    print("沒有處理的例外：", type(e).__name__)
`,
    hints: [
      "先寫一個 `validate(text, schema)`：`json.loads` 包在 `try` 裡、檢查 `isinstance(data, dict)`、逐欄用 `type(data[f]) is typ` 比對（`isinstance(True, int)` 是 `True`，所以不能用 `isinstance`）。",
      "主迴圈 `for attempt in range(1, max_attempts + 1)`：`except Timeout` 與可重試的 `ApiError` 往下走到「記 delay」；不可重試的 `ApiError` 直接 `return`。",
      "用量在拿到回應後、驗證之前就累加；`delays.append(...)` 只在 `attempt < max_attempts` 時做。",
    ],
    tests: [
      { name: "第一次就成功：attempts 1、沒有 delay、data 只留 schema 的欄位", code: `class _C:
    def __init__(self, script):
        self.script, self.calls = list(script), 0
    def generate(self, prompt):
        self.calls += 1
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return {"text": step[0], "usage": {"input_tokens": step[1], "output_tokens": step[2]}}
_S = {"department": str, "days": int, "urgent": bool}
_OK = '{"department": "骨科", "days": 3, "urgent": false, "note": "多的欄位"}'
_c = _C([(_OK, 120, 20)])
_r = call_structured(_c, "p", _S, 3)
assert _r["ok"] is True and _r["attempts"] == 1 and _r["delays"] == [], _r
assert _r["data"] == {"department": "骨科", "days": 3, "urgent": False}, _r["data"]
assert _r["usage"] == {"input_tokens": 120, "output_tokens": 20}, _r["usage"]
assert _c.calls == 1` },
      { name: "逾時與 503 會重試，退避 0.5、1 秒；失敗的呼叫沒有用量", code: `_c = _C([Timeout(), ApiError(503), (_OK, 120, 20)])
_r = call_structured(_c, "p", _S, 4)
assert _r["ok"] is True and _r["attempts"] == 3, _r
assert _r["delays"] == [0.5, 1.0], _r["delays"]
assert _r["usage"] == {"input_tokens": 120, "output_tokens": 20}, _r["usage"]` },
      { name: "429 帶 retry_after 就照它等；沒帶就用退避", code: `_c = _C([ApiError(429, retry_after=7), ApiError(429), (_OK, 100, 10)])
_r = call_structured(_c, "p", _S, 5)
assert _r["ok"] is True and _r["attempts"] == 3, _r
assert _r["delays"] == [7, 1.0], _r["delays"]` },
      { name: "輸出不合格（不是 JSON、缺欄位、型別不符、True 冒充 int）會重試，用量全部累計", code: `_c = _C([
    ("好的，以下是結果：" + _OK, 100, 30),
    ('{"department": "骨科", "urgent": false}', 110, 12),
    ('{"department": "骨科", "days": "三天", "urgent": false}', 120, 20),
    ('{"department": "骨科", "days": true, "urgent": false}', 130, 20),
    ('["骨科", 3, false]', 140, 8),
    (_OK, 150, 20),
])
_r = call_structured(_c, "p", _S, 6)
assert _r["ok"] is True and _r["attempts"] == 6, _r
assert _r["usage"] == {"input_tokens": 750, "output_tokens": 110}, _r["usage"]
assert _r["delays"] == [0.5, 1.0, 2.0, 4.0, 8.0], _r["delays"]` },
      { name: "400 不重試：只呼叫一次，reason 是 http_400", code: `_c = _C([ApiError(400), (_OK, 120, 20)])
_r = call_structured(_c, "p", _S, 3)
assert _r["ok"] is False and _r["data"] is None and _r["reason"] == "http_400", _r
assert _r["attempts"] == 1 and _r["delays"] == [] and _c.calls == 1, (_r, _c.calls)
_c = _C([Timeout(), ApiError(401), (_OK, 120, 20)])
_r = call_structured(_c, "p", _S, 3)
assert _r["reason"] == "http_401" and _r["attempts"] == 2 and _c.calls == 2, (_r, _c.calls)` },
      { name: "次數用完：剛好呼叫 max_attempts 次，回 exhausted，最後一次失敗後不再等", code: `_c = _C([Timeout(), ("不是 JSON", 90, 5), ApiError(500), (_OK, 120, 20)])
_r = call_structured(_c, "p", _S, 3)
assert _r["ok"] is False and _r["data"] is None and _r["reason"] == "exhausted", _r
assert _r["attempts"] == 3 and _c.calls == 3, (_r, _c.calls)
assert _r["delays"] == [0.5, 1.0], _r["delays"]
assert _r["usage"] == {"input_tokens": 90, "output_tokens": 5}, _r["usage"]` },
    ],
  },
  {
    id: 'context-engineering-1', skill: 'context-engineering', kind: 'python', level: 2,
    title: "lint_rules：檢查專案規範檔的長度、重複、失效路徑與驗證指令",
    prompt: "實作 `lint_rules(sections, existing_paths, max_lines)`，替專案規範檔做機械檢查。規範檔已經解析成結構化資料：\n\n- `sections`：`[{\"title\": str, \"lines\": [str, ...]}, ...]`，`lines` 是該段的每一行\n- `existing_paths`：repo 裡實際存在的路徑集合，例如 `{\"docs/adr/\", \"src/\"}`\n- 去掉頭尾空白後以 `$ ` 開頭的行是指令，例如 `$ uv run pytest`\n\n回傳問題清單 `[{\"rule\": ..., \"detail\": ...}, ...]`，**依下面的順序**輸出；沒有問題回傳空清單：\n\n1. `too_long`：所有段落的非空白行總數超過 `max_lines`。`detail` 是總行數，只報一次\n2. `duplicate`：同一行出現兩次以上（比對時去掉頭尾空白並轉小寫；空白行不算）。每種重複只報一次，`detail` 是它第一次出現時去掉頭尾空白的原文，依第一次出現的順序\n3. `missing_path`：行內用反引號包住、不含空白、而且含 `/` 的字串視為路徑；不在 `existing_paths` 裡就報。每個路徑只報一次，`detail` 是路徑，依第一次出現的順序\n4. `no_verify_command`：沒有任何一行指令含 `test`、`lint` 或 `check`（不分大小寫）。`detail` 是 `None`，只報一次",
    starter: "import re\n\n\ndef lint_rules(sections, existing_paths, max_lines):\n    # 目前的版本：只檢查長度，而且把空白行也算進去\n    problems = []\n    total = sum(len(s[\"lines\"]) for s in sections)\n    if total > max_lines:\n        problems.append({\"rule\": \"too_long\", \"detail\": total})\n    return problems\n\n\nDOC = [\n    {\"title\": \"指令\", \"lines\": [\"安裝依賴：\", \"$ uv sync\", \"架構決策在 `docs/adr/`\"]},\n    {\"title\": \"規則\", \"lines\": [\"不修改已合併的 migration\", \"不修改已合併的 migration\", \"舊報表在 `legacy/reports/`\"]},\n]\nfor problem in lint_rules(DOC, {\"docs/adr/\", \"src/\"}, max_lines=50):\n    print(problem)\n",
    solution: "import re\n\nPATH_IN_BACKTICKS = re.compile(r\"`([^`\\s]+)`\")      # 反引號包住、不含空白\nVERIFY_WORDS = (\"test\", \"lint\", \"check\")\n\n\ndef lint_rules(sections, existing_paths, max_lines):\n    lines = [line.strip() for s in sections for line in s[\"lines\"] if line.strip()]\n    problems = []\n\n    # 1. 太長：常駐內容每一輪都要付費，也會稀釋重點\n    if len(lines) > max_lines:\n        problems.append({\"rule\": \"too_long\", \"detail\": len(lines)})\n\n    # 2. 重複：同一條規則寫兩次，之後只改到一處就會互相矛盾\n    first_seen, reported = {}, set()\n    for line in lines:\n        key = line.lower()\n        if key in first_seen and key not in reported:\n            reported.add(key)\n            problems.append({\"rule\": \"duplicate\", \"detail\": first_seen[key]})\n        first_seen.setdefault(key, line)\n\n    # 3. 指到不存在的路徑：規範檔過期最常見的徵兆\n    missing = []\n    for line in lines:\n        for token in PATH_IN_BACKTICKS.findall(line):\n            if \"/\" in token and token not in existing_paths and token not in missing:\n                missing.append(token)\n    problems += [{\"rule\": \"missing_path\", \"detail\": p} for p in missing]\n\n    # 4. 沒有驗證指令：agent 不知道改完要跑什麼\n    commands = [line.lower() for line in lines if line.startswith(\"$ \")]\n    if not any(word in cmd for cmd in commands for word in VERIFY_WORDS):\n        problems.append({\"rule\": \"no_verify_command\", \"detail\": None})\n    return problems\n\n\nDOC = [\n    {\"title\": \"指令\", \"lines\": [\"安裝依賴：\", \"$ uv sync\", \"架構決策在 `docs/adr/`\"]},\n    {\"title\": \"規則\", \"lines\": [\"不修改已合併的 migration\", \"不修改已合併的 migration\", \"舊報表在 `legacy/reports/`\"]},\n]\nfor problem in lint_rules(DOC, {\"docs/adr/\", \"src/\"}, max_lines=50):\n    print(problem)\n",
    hints: [
      "先把所有段落攤平成一個「去掉頭尾空白、排除空白行」的清單，四項檢查都用它。",
      "重複：用 dict 記每個小寫 key 第一次出現的原文，第二次遇到時報一次（再用一個 set 避免第三次又報）。",
      "路徑：用 `re.findall` 取出一對反引號之間、不含空白的字串（字元類別同時排除反引號與空白），再留下含 `/` 的。指令：`line.startswith(\"$ \")`。",
    ],
    tests: [
      { name: "乾淨的規範檔：回傳空清單", code: "_doc = [\n    {\"title\": \"指令\", \"lines\": [\"安裝依賴：\", \"$ uv sync\", \"$ uv run pytest\", \"\"]},\n    {\"title\": \"目錄\", \"lines\": [\"架構決策在 `docs/adr/`，改動前先讀\", \"  \", \"`src/generated/` 不要手改\"]},\n]\n_paths = {\"docs/adr/\", \"src/generated/\", \"src/\"}\nassert lint_rules(_doc, _paths, 10) == [], lint_rules(_doc, _paths, 10)" },
      { name: "too_long：只算非空白行，超過才報，detail 是總行數", code: `assert lint_rules(_doc, _paths, 5) == [], "非空白行剛好 5 行，不算超過"
assert lint_rules(_doc, _paths, 4) == [{"rule": "too_long", "detail": 5}], lint_rules(_doc, _paths, 4)` },
      { name: "duplicate：忽略頭尾空白與大小寫，每種只報一次，detail 是第一次出現的原文", code: `_dup = [
    {"title": "A", "lines": ["不修改已合併的 migration", "$ uv run pytest", "Use UTC everywhere"]},
    {"title": "B", "lines": ["  use utc everywhere ", "不修改已合併的 migration", "不修改已合併的 migration"]},
]
_r = lint_rules(_dup, set(), 50)
assert _r == [{"rule": "duplicate", "detail": "Use UTC everywhere"},
              {"rule": "duplicate", "detail": "不修改已合併的 migration"}], _r` },
      { name: "missing_path：反引號裡含 / 且不含空白才算路徑；不存在的各報一次", code: "_mp = [\n    {\"title\": \"A\", \"lines\": [\"決策在 `docs/adr/`，舊報表在 `legacy/reports/`\", \"執行 `uv run pytest tests/` 驗證\", \"$ uv run pytest\"]},\n    {\"title\": \"B\", \"lines\": [\"設定檔是 `pyproject.toml`\", \"`legacy/reports/` 不要動\", \"腳本在 `scripts/seed.py`\"]},\n]\n_r = lint_rules(_mp, {\"docs/adr/\"}, 50)\nassert _r == [{\"rule\": \"missing_path\", \"detail\": \"legacy/reports/\"},\n              {\"rule\": \"missing_path\", \"detail\": \"scripts/seed.py\"}], _r" },
      { name: "no_verify_command：沒有含 test / lint / check 的指令就報；敘述文字裡提到不算", code: `_nv = [{"title": "指令", "lines": ["改完記得跑 test", "$ uv sync", "$ make build"]}]
assert lint_rules(_nv, set(), 50) == [{"rule": "no_verify_command", "detail": None}], lint_rules(_nv, set(), 50)
_ok = [{"title": "指令", "lines": ["  $ uv run ruff CHECK ."]}]
assert lint_rules(_ok, set(), 50) == [], lint_rules(_ok, set(), 50)` },
      { name: "多種問題同時出現：依 too_long、duplicate、missing_path、no_verify_command 的順序", code: "_all = [\n    {\"title\": \"A\", \"lines\": [\"看 `old/dir/`\", \"$ make build\", \"規則一\", \"規則一\"]},\n]\n_r = lint_rules(_all, set(), 3)\nassert [p[\"rule\"] for p in _r] == [\"too_long\", \"duplicate\", \"missing_path\", \"no_verify_command\"], _r\nassert _r[0][\"detail\"] == 4 and _r[1][\"detail\"] == \"規則一\" and _r[2][\"detail\"] == \"old/dir/\", _r" },
    ],
  },
  {
    id: 'self-hosted-models-1', skill: 'self-hosted-models', kind: 'python', level: 3,
    title: "route：依資料敏感度分流，敏感請求絕不外送",
    prompt: "實作 `route(req, local, cloud_up)`：決定一個模型請求送到地端還是雲端，並**原地更新** `local` 的計數。\n\n- `req`：`{\"sensitivity\": \"sensitive\" 或 \"general\", \"tier\": \"small\" 或 \"large\"}`。`sensitivity` 缺少、或不是這兩個值（大小寫不同也算）時，一律當成 `\"sensitive\"`（**預設敏感**）\n- `local`：`{\"capacity\": 可同時處理數, \"active\": 處理中, \"queue\": 排隊中, \"queue_limit\": 佇列上限, \"tiers\": 地端有的模型等級}`\n- `cloud_up`：雲端 API 目前是否可用\n\n回傳 `{\"target\": \"local\" / \"cloud\" / None, \"action\": \"run\" / \"queue\" / \"reject\", \"reason\": str}`。\n\n敏感請求（**任何情況都不能送雲端**），由上往下第一個符合的生效：\n\n- `tier` 不在 `local[\"tiers\"]` → 拒絕，`reason` 是 `\"no_local_model\"`\n- `active < capacity` → 地端 `run`，`reason` 是 `\"sensitive\"`，`active` 加 1\n- `queue < queue_limit` → 地端 `queue`，`reason` 是 `\"sensitive\"`，`queue` 加 1\n- 否則拒絕，`reason` 是 `\"local_full\"`\n\n一般請求，由上往下第一個符合的生效：\n\n- `cloud_up` → 雲端 `run`，`reason` 是 `\"general\"`\n- 地端有這個等級而且 `active < capacity` → 地端 `run`，`reason` 是 `\"cloud_down\"`，`active` 加 1（一般請求不排進地端的佇列，佇列留給敏感請求）\n- 否則拒絕，`reason` 是 `\"no_capacity\"`\n\n拒絕時 `target` 是 `None`，而且不更新任何計數。",
    starter: `def route(req, local, cloud_up):
    # 目前的版本：地端有空位就用地端，滿了就送雲端——敏感資料會被送出去
    if local["active"] < local["capacity"]:
        local["active"] += 1
        return {"target": "local", "action": "run", "reason": "has_room"}
    return {"target": "cloud", "action": "run", "reason": "local_full"}


local = {"capacity": 2, "active": 2, "queue": 0, "queue_limit": 1, "tiers": ["small"]}
for req in [
    {"sensitivity": "sensitive", "tier": "small"},   # 地端滿了：該排隊
    {"sensitivity": "sensitive", "tier": "small"},   # 佇列也滿了：該拒絕，不是外送
    {"sensitivity": "general", "tier": "large"},
    {"tier": "small"},                               # 沒有標示敏感度
]:
    print(route(req, local, cloud_up=True), local["active"], local["queue"])
`,
    solution: `def decision(target, action, reason):
    return {"target": target, "action": action, "reason": reason}


def route(req, local, cloud_up):
    # 預設敏感：沒有標示或不認得的標示，都不能當成「可以外送」
    sensitive = req.get("sensitivity") != "general"
    has_model = req.get("tier") in local["tiers"]
    has_room = local["active"] < local["capacity"]

    if sensitive:
        # 這個分支裡沒有任何一條路會回傳 "cloud"
        if not has_model:
            return decision(None, "reject", "no_local_model")
        if has_room:
            local["active"] += 1
            return decision("local", "run", "sensitive")
        if local["queue"] < local["queue_limit"]:
            local["queue"] += 1                      # 滿載時排隊，不是外送
            return decision("local", "queue", "sensitive")
        return decision(None, "reject", "local_full")

    if cloud_up:
        return decision("cloud", "run", "general")
    if has_model and has_room:
        local["active"] += 1                         # 一般請求只用空位，不佔佇列
        return decision("local", "run", "cloud_down")
    return decision(None, "reject", "no_capacity")


local = {"capacity": 2, "active": 2, "queue": 0, "queue_limit": 1, "tiers": ["small"]}
for req in [
    {"sensitivity": "sensitive", "tier": "small"},   # 地端滿了：該排隊
    {"sensitivity": "sensitive", "tier": "small"},   # 佇列也滿了：該拒絕，不是外送
    {"sensitivity": "general", "tier": "large"},
    {"tier": "small"},                               # 沒有標示敏感度
]:
    print(route(req, local, cloud_up=True), local["active"], local["queue"])
`,
    hints: [
      "先算出 `sensitive = req.get(\"sensitivity\") != \"general\"`：只有明確標成 general 的才不是敏感。",
      "把敏感請求寫成一個獨立的分支，分支裡每一個 `return` 的 target 都只會是 `\"local\"` 或 `None`，這樣一眼就能確認不會外送。",
      "拒絕的那幾條路不要動 `active` 與 `queue`；一般請求在雲端不可用時只檢查空位，不看佇列。",
    ],
    tests: [
      { name: "敏感請求：有空位就在地端執行，active 加 1", code: `def _local(**kw):
    base = {"capacity": 2, "active": 0, "queue": 0, "queue_limit": 2, "tiers": ["small"]}
    base.update(kw)
    return base
_l = _local()
_r = route({"sensitivity": "sensitive", "tier": "small"}, _l, True)
assert _r == {"target": "local", "action": "run", "reason": "sensitive"}, _r
assert _l["active"] == 1 and _l["queue"] == 0, _l` },
      { name: "地端滿載：敏感請求排隊；佇列也滿了就拒絕（雲端可用也不外送）", code: `_l = _local(active=2, queue_limit=1)
_r = route({"sensitivity": "sensitive", "tier": "small"}, _l, True)
assert _r == {"target": "local", "action": "queue", "reason": "sensitive"}, _r
assert _l["active"] == 2 and _l["queue"] == 1, _l
_r = route({"sensitivity": "sensitive", "tier": "small"}, _l, True)
assert _r == {"target": None, "action": "reject", "reason": "local_full"}, _r
assert _l["active"] == 2 and _l["queue"] == 1, "拒絕時不該更新計數"` },
      { name: "敏感請求在任何狀態下都不會送到雲端（含未標示、不認得的標示）", code: `for _s in ["sensitive", None, "", "SENSITIVE", "General", "public", 0]:
    for _tier in ["small", "large"]:
        for _active in [0, 2]:
            for _queue in [0, 2]:
                for _up in [True, False]:
                    _req = {"tier": _tier} if _s is None else {"sensitivity": _s, "tier": _tier}
                    _r = route(_req, _local(active=_active, queue=_queue), _up)
                    assert _r["target"] != "cloud", (_req, _active, _queue, _up, _r)` },
      { name: "沒有標示敏感度：當成敏感，走地端", code: `_l = _local()
_r = route({"tier": "small"}, _l, True)
assert _r == {"target": "local", "action": "run", "reason": "sensitive"}, _r
assert _l["active"] == 1, _l` },
      { name: "敏感請求需要地端沒有的模型等級：拒絕，不外送、不更新計數", code: `_l = _local()
_r = route({"sensitivity": "sensitive", "tier": "large"}, _l, True)
assert _r == {"target": None, "action": "reject", "reason": "no_local_model"}, _r
assert _l["active"] == 0 and _l["queue"] == 0, _l` },
      { name: "一般請求：雲端可用就走雲端，不動地端的計數", code: `_l = _local(active=1)
_r = route({"sensitivity": "general", "tier": "large"}, _l, True)
assert _r == {"target": "cloud", "action": "run", "reason": "general"}, _r
assert _l["active"] == 1 and _l["queue"] == 0, _l` },
      { name: "一般請求、雲端不可用：地端有空位才用，不排進佇列", code: `_l = _local(active=1)
_r = route({"sensitivity": "general", "tier": "small"}, _l, False)
assert _r == {"target": "local", "action": "run", "reason": "cloud_down"}, _r
assert _l["active"] == 2 and _l["queue"] == 0, _l
_r = route({"sensitivity": "general", "tier": "small"}, _l, False)
assert _r == {"target": None, "action": "reject", "reason": "no_capacity"}, _r
assert _l["active"] == 2 and _l["queue"] == 0, "一般請求不該佔用敏感請求的佇列"
_r = route({"sensitivity": "general", "tier": "large"}, _local(), False)
assert _r == {"target": None, "action": "reject", "reason": "no_capacity"}, _r` },
    ],
  },
]

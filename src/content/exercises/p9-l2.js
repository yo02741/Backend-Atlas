// 程式題：P9 新課（l2 批）
// config 題共用的小工具（測試碼前面接上）：
//   job(name)：取出某個頂層 job 的內容（去掉註解），沒有就回空字串
//   stagesList()：取出頂層 stages 清單（支援 `stages: [a, b]` 與多行清單）
const JOB = String.raw`
const job = (name) => {
  const ls = source.split('\n').map((l) => l.replace(/\s+#.*$|^\s*#.*$/, ''))
  const i = ls.findIndex((l) => l.startsWith(name + ':'))
  if (i < 0) return ''
  const out = []
  for (const l of ls.slice(i + 1)) { if (/^\S/.test(l)) break; out.push(l) }
  return out.join('\n')
}
const stagesList = () => {
  const ls = source.split('\n').map((l) => l.replace(/\s+#.*$|^\s*#.*$/, ''))
  const i = ls.findIndex((l) => /^stages:/.test(l))
  if (i < 0) return []
  const inline = ls[i].replace(/^stages:\s*/, '')
  if (inline) return inline.replace(/[\[\]"']/g, '').split(',').map((s) => s.trim()).filter(Boolean)
  const out = []
  for (const l of ls.slice(i + 1)) { const m = l.match(/^\s+-\s+["']?([\w-]+)/); if (!m) break; out.push(m[1]) }
  return out
}
`

export default [
  {
    id: 'ai-gateway-1', skill: 'ai-gateway', kind: 'python', level: 2,
    title: 'AI Gateway 的路由：配額、429 與 fallback',
    prompt: '實作 `route(team, alias, routes, quota, used, call_model)`，模擬 gateway 處理一次模型呼叫：\n\n- `routes`：別名 → 候選模型清單（依序嘗試），例如 `{"default": ["a/large", "b/large"]}`\n- `quota`：團隊 → 這個月可用的 token 數；`used`：團隊 → 已用的 token 數（**要原地更新**，沒有 key 視為 0）\n- `call_model(model)`：成功時回傳這次用掉的 token 數（int）；失敗時丟 `ProviderError`（有 `.status`）或 `TimeoutError`\n\n回傳一個 dict，規則依序是：\n\n- 團隊不在 `quota` 裡 → `{"status": 401}`\n- 已用量 **大於或等於** 配額 → `{"status": 429, "reason": "quota_exceeded"}`，不呼叫任何模型\n- 別名不在 `routes` 裡 → `{"status": 404}`\n- 依序呼叫候選模型。`TimeoutError`、或 `ProviderError` 的 status 是 429 或 5xx 時換下一個（fallback）；其他 `ProviderError`（例如 400）**不 fallback**，直接回 `{"status": 那個 status, "model": 那個模型}`\n- 成功時把 token 加進 `used[team]`，回 `{"status": 200, "model": 實際用的模型, "fallback": 是否不是第一個候選, "tokens": token 數}`\n- 候選全部失敗 → `{"status": 503, "tried": [依序試過的模型]}`',
    starter: `class ProviderError(Exception):
    def __init__(self, status):
        super().__init__(f"provider returned {status}")
        self.status = status


def route(team, alias, routes, quota, used, call_model):
    # 目前的版本：沒檢查配額、任何錯誤都 fallback、沒標明實際模型
    for model in routes[alias]:
        try:
            tokens = call_model(model)
            return {"status": 200, "tokens": tokens}
        except Exception:
            continue
    return {"status": 503}


def fake(model):
    if model == "a/large":
        raise TimeoutError()
    return 300

used = {}
print(route("support", "default", {"default": ["a/large", "b/large"]}, {"support": 1000}, used, fake))
print(used)
`,
    solution: `class ProviderError(Exception):
    def __init__(self, status):
        super().__init__(f"provider returned {status}")
        self.status = status


def retryable(err):
    # 換一家可能就好的錯誤：逾時、供應商限流、供應商自己的 5xx
    if isinstance(err, TimeoutError):
        return True
    return isinstance(err, ProviderError) and (err.status == 429 or 500 <= err.status <= 599)


def route(team, alias, routes, quota, used, call_model):
    if team not in quota:
        return {"status": 401}
    if used.get(team, 0) >= quota[team]:
        return {"status": 429, "reason": "quota_exceeded"}     # 不呼叫任何模型
    if alias not in routes:
        return {"status": 404}
    tried = []
    for i, model in enumerate(routes[alias]):
        try:
            tokens = call_model(model)
        except (TimeoutError, ProviderError) as e:
            if not retryable(e):
                return {"status": e.status, "model": model}      # 400 這類錯誤換模型也沒用
            tried.append(model)
            continue
        used[team] = used.get(team, 0) + tokens                   # 原地更新已用量
        return {"status": 200, "model": model, "fallback": i > 0, "tokens": tokens}
    return {"status": 503, "tried": tried}


def fake(model):
    if model == "a/large":
        raise TimeoutError()
    return 300

used = {}
print(route("support", "default", {"default": ["a/large", "b/large"]}, {"support": 1000}, used, fake))
print(used)
`,
    hints: [
      '先處理三個不用呼叫模型的情況（401、429、404），再進入候選模型的迴圈。',
      '`except (TimeoutError, ProviderError) as e:` 之後判斷要不要 fallback；`500 <= e.status <= 599` 是 5xx。',
      '`fallback` 就是「成功的那個模型不是清單第一個」，用 `enumerate` 拿到索引。',
    ],
    tests: [
      { name: '主要模型成功：200、扣用量、fallback 是 False', code: `_used = {"t": 100}
_r = route("t", "default", {"default": ["a", "b"]}, {"t": 1000}, _used, lambda m: 250)
assert _r == {"status": 200, "model": "a", "fallback": False, "tokens": 250}, _r
assert _used == {"t": 350}, _used` },
      { name: '逾時與 5xx、429 都會 fallback，並標明實際模型', code: `def _call(m):
    if m == "a":
        raise TimeoutError()
    if m == "b":
        raise ProviderError(503)
    if m == "c":
        raise ProviderError(429)
    return 40
_used = {}
_r = route("t", "x", {"x": ["a", "b", "c", "d"]}, {"t": 1000}, _used, _call)
assert _r == {"status": 200, "model": "d", "fallback": True, "tokens": 40}, _r
assert _used == {"t": 40}, _used` },
      { name: '400 不 fallback，直接回那個 status', code: `_calls = []
def _call(m):
    _calls.append(m)
    raise ProviderError(400)
_r = route("t", "x", {"x": ["a", "b"]}, {"t": 1000}, {}, _call)
assert _r == {"status": 400, "model": "a"}, _r
assert _calls == ["a"], f"400 之後不該再呼叫其他模型：{_calls}"` },
      { name: '配額用完回 429，而且不呼叫模型', code: `_calls = []
def _call(m):
    _calls.append(m)
    return 10
_used = {"t": 1000}
_r = route("t", "x", {"x": ["a"]}, {"t": 1000}, _used, _call)
assert _r == {"status": 429, "reason": "quota_exceeded"}, _r
assert _calls == [], "配額用完時不該呼叫模型"
assert _used == {"t": 1000}, _used` },
      { name: '不認得的團隊 401、不認得的別名 404', code: `assert route("nobody", "x", {"x": ["a"]}, {"t": 10}, {}, lambda m: 1) == {"status": 401}
assert route("t", "nope", {"x": ["a"]}, {"t": 10}, {}, lambda m: 1) == {"status": 404}` },
      { name: '全部失敗回 503 並列出試過的模型，用量不變', code: `def _call(m):
    raise ProviderError(502)
_used = {}
_r = route("t", "x", {"x": ["a", "b"]}, {"t": 10}, _used, _call)
assert _r == {"status": 503, "tried": ["a", "b"]}, _r
assert _used.get("t", 0) == 0, _used` },
    ],
  },
  {
    id: 'agent-delivery-1', skill: 'agent-delivery', kind: 'config', level: 2, file: '.gitlab-ci.yml',
    title: '評測當品質閘門：只在 prompt 或 skill 變動時跑',
    prompt: '這個 repo 的 `prompts/` 與 `skills/` 放著 agent 的系統提示與 skill，`evals/run.py` 會對評測集跑一次，通過率低於 `--min-pass-rate` 時以非 0 結束。現在的設定有幾個問題：模型金鑰寫死在檔案裡、評測失敗也照樣部署、每次 push 都跑評測（要呼叫模型，又慢又花錢）。\n\n修改成：\n\n- `stages` 要有 `eval`，而且排在 `deploy` 前面\n- `eval-prompts` job 的 stage 是 `eval`，仍然執行 `python evals/run.py` 並帶 `--min-pass-rate`\n- `eval-prompts` 用 `rules:` 搭配 `changes:`，只在 `prompts/` 或 `skills/` 底下的檔案變動時執行（兩個路徑都要列）\n- 評測失敗要讓 pipeline 失敗：不能有 `allow_failure: true`\n- `deploy-prompts` 的 stage 是 `deploy`；如果它有 `needs`，必須包含 `eval-prompts`\n- 刪掉寫死的 `MODEL_API_KEY`（改在專案設定建立 protected、masked 變數，這部分不在檔案裡），檔案裡不能出現任何寫死的金鑰值',
    starter: `stages:
  - test
  - deploy

variables:
  MODEL_API_KEY: "sk-live-8f2c1d9e7a6b"

eval-prompts:
  stage: test
  image: python:3.12-slim
  script:
    - pip install -r evals/requirements.txt
    - python evals/run.py --suite evals/cases.jsonl --min-pass-rate 0.9
  allow_failure: true

deploy-prompts:
  stage: deploy
  image: python:3.12-slim
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  script:
    - python scripts/publish_prompts.py --version "$CI_COMMIT_SHORT_SHA"
`,
    solution: `stages:
  - eval
  - deploy

# MODEL_API_KEY 在專案設定建立為 protected、masked 變數，檔案裡不放值

eval-prompts:
  stage: eval
  image: python:3.12-slim
  rules:
    - changes:
        - prompts/**/*
        - skills/**/*
        - evals/**/*
  script:
    - pip install -r evals/requirements.txt
    - python evals/run.py --suite evals/cases.jsonl --min-pass-rate 0.9

deploy-prompts:
  stage: deploy
  image: python:3.12-slim
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      changes:
        - prompts/**/*
        - skills/**/*
  script:
    - python scripts/publish_prompts.py --version "$CI_COMMIT_SHORT_SHA"
`,
    hints: [
      '`rules:` 底下寫 `- changes:`，再用清單列出 `prompts/**/*`、`skills/**/*`；也可以把評測集本身 `evals/**/*` 加進去。',
      '後面 stage 的 job 只有在前面 stage 的 job 都成功（或允許失敗）時才會執行；拿掉 `allow_failure: true`，eval 紅燈 deploy 就不會跑。',
      '金鑰從專案設定的 CI/CD 變數注入成環境變數，`evals/run.py` 一樣讀得到 `MODEL_API_KEY`，檔案裡不需要任何值。',
    ],
    tests: [
      { name: 'stages 有 eval，而且排在 deploy 前面', code: JOB + String.raw`
const st = stagesList()
assert(st.includes('eval'), 'stages 裡沒有 eval（目前：' + st.join(', ') + '）')
assert(st.includes('deploy'), 'stages 裡沒有 deploy')
assert(st.indexOf('eval') < st.indexOf('deploy'), 'eval 要排在 deploy 前面')
` },
      { name: 'eval-prompts 在 eval stage，執行 evals/run.py 並帶門檻', code: JOB + String.raw`
const b = job('eval-prompts')
assert(b, '找不到 eval-prompts job')
assert(/^\s+stage:\s*["']?eval["']?\s*$/m.test(b), 'eval-prompts 的 stage 要是 eval')
assert(/^\s+-\s+.*python\s+evals\/run\.py\b.*--min-pass-rate[= ]\s*\d/m.test(b), 'script 要執行 python evals/run.py 並帶 --min-pass-rate')
` },
      { name: 'eval-prompts 只在 prompts/ 或 skills/ 變動時執行（rules: changes）', code: JOB + String.raw`
const b = job('eval-prompts')
assert(/^\s+rules:/m.test(b), 'eval-prompts 沒有 rules:')
assert(/changes:/.test(b), 'rules 裡沒有 changes:')
const after = b.slice(b.indexOf('changes:'))
assert(/["']?prompts\//.test(after), 'changes 要列出 prompts/ 底下的路徑')
assert(/["']?skills\//.test(after), 'changes 要列出 skills/ 底下的路徑')
assert(!/^\s+(only|except):/m.test(b), 'rules 不能和 only / except 混用')
` },
      { name: '評測失敗會擋住部署（沒有 allow_failure: true）', code: JOB + String.raw`
assert(!lines.some((l) => /allow_failure:\s*true/.test(l)), '不能有 allow_failure: true')
const b = job('eval-prompts')
assert(!/^\s+when:\s*manual/m.test(b), 'eval 不要做成手動 job（manual job 預設允許失敗）')
` },
      { name: 'deploy-prompts 在 deploy stage；有 needs 時要包含 eval-prompts', code: JOB + String.raw`
const d = job('deploy-prompts')
assert(d, '找不到 deploy-prompts job')
assert(/^\s+stage:\s*["']?deploy["']?\s*$/m.test(d), 'deploy-prompts 的 stage 要是 deploy')
if (/^\s+needs:/m.test(d)) assert(/eval-prompts/.test(d.slice(d.search(/^\s+needs:/m))), 'deploy-prompts 的 needs 要包含 eval-prompts')
` },
      { name: '檔案裡沒有寫死的金鑰', code: String.raw`
assert(!/sk-live-8f2c1d9e7a6b/.test(source), '原本寫死的金鑰還在檔案裡')
const bad = lines.find((l) => /^\s*[\w-]*(API_KEY|TOKEN|SECRET)[\w-]*:\s*["']?[^\s"'$]/i.test(l))
assert(!bad, '變數不能寫死金鑰值：' + (bad || '').trim())
assert(!/\bsk-[A-Za-z0-9-]{8,}/.test(source), '檔案裡看起來還有金鑰字串')
` },
    ],
  },
  {
    id: 'skill-registry-1', skill: 'skill-registry', kind: 'python', level: 2,
    title: '比對 skill 清單與本機安裝：更新、雜湊不符、下架',
    prompt: '實作 `audit(manifest, installed)`，比對 registry 的清單與本機安裝的 skill，回傳一個 list，每一項是 `(種類, 名稱)` 的 tuple。\n\n- `manifest`：`{"skills": [{"name", "version", "sha256", "yanked"}]}`（`yanked` 可能沒有，視為 `False`）\n- `installed`：`[{"name", "version", "locked_sha256", "content"}]`；`content` 是目前磁碟上的內容，用 `digest(content)` 算雜湊\n\n依 `installed` 的順序逐一檢查；同一個 skill 可以有多項，依下面的順序排：\n\n- 不在清單上 → `("unregistered", 名稱)`，這個 skill 不再做其他檢查\n- 清單標記 `yanked` → `("yanked", 名稱)`\n- `digest(content)` 和 `locked_sha256` 不同 → `("hash_mismatch", 名稱)`\n- 清單的版本比安裝的新 → `("update", 名稱)`。版本是 `主.次.修訂` 三段整數，要依數字比較（`1.10.0` 比 `1.9.0` 新）\n- 版本相同、但清單的 `sha256` 和 `locked_sha256` 不同 → `("registry_tampered", 名稱)`\n\n沒有任何問題的 skill 不出現在結果裡。',
    starter: `import hashlib


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def audit(manifest, installed):
    by_name = {s["name"]: s for s in manifest["skills"]}
    findings = []
    for s in installed:
        reg = by_name[s["name"]]
        # 目前只比版本字串，沒比雜湊
        if reg["version"] > s["version"]:
            findings.append(("update", s["name"]))
    return findings


manifest = {"skills": [{"name": "release-notes", "version": "1.10.0", "sha256": digest("v1.10.0")}]}
installed = [{"name": "release-notes", "version": "1.9.0", "locked_sha256": digest("v1.9.0"), "content": "v1.9.0"}]
print(audit(manifest, installed))   # 預期 [('update', 'release-notes')]
`,
    solution: `import hashlib


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def parse_version(v):
    # 依數字比較："1.10.0" → (1, 10, 0)，才會比 (1, 9, 0) 大
    return tuple(int(x) for x in v.split("."))


def audit(manifest, installed):
    by_name = {s["name"]: s for s in manifest["skills"]}
    findings = []
    for s in installed:
        name = s["name"]
        reg = by_name.get(name)
        if reg is None:
            findings.append(("unregistered", name))
            continue
        if reg.get("yanked", False):
            findings.append(("yanked", name))
        if digest(s["content"]) != s["locked_sha256"]:
            findings.append(("hash_mismatch", name))       # 本機內容被改過
        if parse_version(reg["version"]) > parse_version(s["version"]):
            findings.append(("update", name))
        elif reg["version"] == s["version"] and reg["sha256"] != s["locked_sha256"]:
            findings.append(("registry_tampered", name))   # 同版本不同雜湊：registry 被改寫
    return findings


manifest = {"skills": [{"name": "release-notes", "version": "1.10.0", "sha256": digest("v1.10.0")}]}
installed = [{"name": "release-notes", "version": "1.9.0", "locked_sha256": digest("v1.9.0"), "content": "v1.9.0"}]
print(audit(manifest, installed))   # 預期 [('update', 'release-notes')]
`,
    hints: [
      '字串比較下 `"1.10.0" < "1.9.0"`；先轉成整數 tuple 再比。',
      '`by_name.get(name)` 拿不到就是未登錄；`reg.get("yanked", False)` 處理沒有這個欄位的情況。',
      '雜湊有兩個方向：本機內容對 lock（本機被改），lock 對 registry（同版本時 registry 被改）。',
    ],
    tests: [
      { name: '版本依數字比較：1.9.0 → 1.10.0 是更新', code: `_m = {"skills": [{"name": "a", "version": "1.10.0", "sha256": digest("new")}]}
_i = [{"name": "a", "version": "1.9.0", "locked_sha256": digest("old"), "content": "old"}]
assert audit(_m, _i) == [("update", "a")], audit(_m, _i)
_m2 = {"skills": [{"name": "a", "version": "1.9.0", "sha256": digest("x")}]}
_i2 = [{"name": "a", "version": "1.10.0", "locked_sha256": digest("y"), "content": "y"}]
assert audit(_m2, _i2) == [], f"本機比清單新時不是更新：{audit(_m2, _i2)}"` },
      { name: '本機內容被改：hash_mismatch（版本號相同也要抓到）', code: `_m = {"skills": [{"name": "a", "version": "2.0.1", "sha256": digest("orig")}]}
_i = [{"name": "a", "version": "2.0.1", "locked_sha256": digest("orig"), "content": "orig + 多一段"}]
assert audit(_m, _i) == [("hash_mismatch", "a")], audit(_m, _i)` },
      { name: '同版本不同雜湊：registry_tampered', code: `_m = {"skills": [{"name": "a", "version": "1.0.0", "sha256": digest("changed upstream")}]}
_i = [{"name": "a", "version": "1.0.0", "locked_sha256": digest("orig"), "content": "orig"}]
assert audit(_m, _i) == [("registry_tampered", "a")], audit(_m, _i)` },
      { name: '未登錄與已下架', code: `_m = {"skills": [{"name": "old", "version": "0.9.0", "sha256": digest("o"), "yanked": True}]}
_i = [
    {"name": "mine", "version": "0.0.1", "locked_sha256": digest("x"), "content": "x"},
    {"name": "old", "version": "0.9.0", "locked_sha256": digest("o"), "content": "o"},
]
assert audit(_m, _i) == [("unregistered", "mine"), ("yanked", "old")], audit(_m, _i)` },
      { name: '同一個 skill 多項問題依規定順序；沒問題的不出現', code: `_m = {"skills": [
    {"name": "a", "version": "1.2.0", "sha256": digest("a12"), "yanked": True},
    {"name": "b", "version": "1.0.0", "sha256": digest("b10")},
]}
_i = [
    {"name": "a", "version": "1.1.0", "locked_sha256": digest("a11"), "content": "a11 被改"},
    {"name": "b", "version": "1.0.0", "locked_sha256": digest("b10"), "content": "b10"},
]
assert audit(_m, _i) == [("yanked", "a"), ("hash_mismatch", "a"), ("update", "a")], audit(_m, _i)` },
    ],
  },
  {
    id: 'llm-observability-1', skill: 'llm-observability', kind: 'python', level: 2,
    title: '彙總 LLM 呼叫紀錄：延遲百分位數、每千次成本、通過率',
    prompt: '實作 `summarize(records, price_per_m)`，依 `prompt_version` 分組彙總呼叫紀錄。\n\n- `records`：每筆有 `prompt_version`、`model`、`in_tokens`、`out_tokens`、`latency_ms`、`eval_pass`（`True` / `False`，沒被抽樣評分的是 `None`）\n- `price_per_m`：模型 → `{"in": 輸入每百萬 token 的單價, "out": 輸出每百萬 token 的單價}`\n\n回傳 dict：`prompt_version` → `{"calls", "p50_ms", "p95_ms", "cost_per_1k", "scored", "pass_rate"}`\n\n- `p50_ms`、`p95_ms` 用 **nearest-rank**：排序後取第 `ceil(p / 100 * n)` 個（從 1 開始數）\n- 一筆的成本是 `(in_tokens × in 單價 + out_tokens × out 單價) / 1,000,000`；`cost_per_1k` 是該組平均每筆成本乘以 1000（不用四捨五入）\n- `scored` 是有評分（`eval_pass` 不是 `None`）的筆數；`pass_rate` 是其中通過的比例，**分母只算有評分的**；一筆都沒評分時是 `None`\n- 不能改動傳進來的 `records`',
    starter: `def summarize(records, price_per_m):
    out = {}
    for pv in {r["prompt_version"] for r in records}:
        rs = [r for r in records if r["prompt_version"] == pv]
        lat = [r["latency_ms"] for r in rs]
        out[pv] = {
            "calls": len(rs),
            "p50_ms": sum(lat) / len(lat),          # 這是平均，不是 p50
            "p95_ms": max(lat),
            "cost_per_1k": 0,
            "scored": len(rs),
            "pass_rate": sum(1 for r in rs if r["eval_pass"]) / len(rs),   # 分母錯了
        }
    return out


PRICE = {"m": {"in": 2.0, "out": 8.0}}
records = [
    {"prompt_version": "v1", "model": "m", "in_tokens": 500, "out_tokens": 100, "latency_ms": 900, "eval_pass": True},
    {"prompt_version": "v1", "model": "m", "in_tokens": 500, "out_tokens": 100, "latency_ms": 1200, "eval_pass": None},
]
print(summarize(records, PRICE))
`,
    solution: `import math
from collections import defaultdict


def percentile(values, p):
    s = sorted(values)                         # sorted() 產生新的 list
    k = max(1, math.ceil(p / 100 * len(s)))    # nearest-rank：第 k 個（從 1 開始）
    return s[k - 1]


def cost(r, price_per_m):
    p = price_per_m[r["model"]]
    return (r["in_tokens"] * p["in"] + r["out_tokens"] * p["out"]) / 1_000_000


def summarize(records, price_per_m):
    groups = defaultdict(list)
    for r in records:
        groups[r["prompt_version"]].append(r)
    out = {}
    for pv, rs in groups.items():
        lat = [r["latency_ms"] for r in rs]
        scored = [r["eval_pass"] for r in rs if r["eval_pass"] is not None]   # 沒評分的不進分母
        out[pv] = {
            "calls": len(rs),
            "p50_ms": percentile(lat, 50),
            "p95_ms": percentile(lat, 95),
            "cost_per_1k": sum(cost(r, price_per_m) for r in rs) / len(rs) * 1000,
            "scored": len(scored),
            "pass_rate": (sum(1 for x in scored if x) / len(scored)) if scored else None,
        }
    return out


PRICE = {"m": {"in": 2.0, "out": 8.0}}
records = [
    {"prompt_version": "v1", "model": "m", "in_tokens": 500, "out_tokens": 100, "latency_ms": 900, "eval_pass": True},
    {"prompt_version": "v1", "model": "m", "in_tokens": 500, "out_tokens": 100, "latency_ms": 1200, "eval_pass": None},
]
print(summarize(records, PRICE))
`,
    hints: [
      '`math.ceil(p / 100 * n)` 算出名次 k（從 1 開始），取 `sorted(values)[k - 1]`。',
      '先把 `eval_pass` 不是 `None` 的挑出來，再算通過比例；挑出來是空的就回 `None`。',
      '每千次成本：該組所有筆的成本加總、除以筆數、再乘以 1000。',
    ],
    tests: [
      { name: '依 prompt_version 分組，calls 正確', code: `_P = {"m": {"in": 1.0, "out": 1.0}}
_rs = [{"prompt_version": v, "model": "m", "in_tokens": 1, "out_tokens": 1, "latency_ms": 10, "eval_pass": None} for v in ["v1", "v2", "v2"]]
_s = summarize(_rs, _P)
assert set(_s) == {"v1", "v2"}, set(_s)
assert _s["v1"]["calls"] == 1 and _s["v2"]["calls"] == 2, _s` },
      { name: 'p50 / p95 用 nearest-rank', code: `_P = {"m": {"in": 1.0, "out": 1.0}}
_lat = [120, 80, 300, 95, 110, 5000, 100, 105, 90, 130]
_rs = [{"prompt_version": "v", "model": "m", "in_tokens": 1, "out_tokens": 1, "latency_ms": x, "eval_pass": None} for x in _lat]
_s = summarize(_rs, _P)["v"]
assert _s["p50_ms"] == 105, _s["p50_ms"]
assert _s["p95_ms"] == 5000, _s["p95_ms"]
_rs20 = [{"prompt_version": "v", "model": "m", "in_tokens": 1, "out_tokens": 1, "latency_ms": x, "eval_pass": None} for x in range(1, 21)]
assert summarize(_rs20, _P)["v"]["p95_ms"] == 19, summarize(_rs20, _P)["v"]["p95_ms"]` },
      { name: '每千次成本依各筆的模型單價計算', code: `_P = {"big": {"in": 3.0, "out": 15.0}, "small": {"in": 0.2, "out": 0.8}}
_rs = [
    {"prompt_version": "v", "model": "big", "in_tokens": 1000, "out_tokens": 200, "latency_ms": 1, "eval_pass": None},
    {"prompt_version": "v", "model": "small", "in_tokens": 1000, "out_tokens": 200, "latency_ms": 1, "eval_pass": None},
]
_c = summarize(_rs, _P)["v"]["cost_per_1k"]
_want = ((1000 * 3.0 + 200 * 15.0) + (1000 * 0.2 + 200 * 0.8)) / 1_000_000 / 2 * 1000
assert abs(_c - _want) < 1e-9, (_c, _want)` },
      { name: '通過率的分母只算有評分的；都沒評分是 None', code: `_P = {"m": {"in": 1.0, "out": 1.0}}
def _r(v, e):
    return {"prompt_version": v, "model": "m", "in_tokens": 1, "out_tokens": 1, "latency_ms": 1, "eval_pass": e}
_s = summarize([_r("a", True), _r("a", False), _r("a", True), _r("a", None), _r("a", None), _r("b", None)], _P)
assert _s["a"]["scored"] == 3, _s["a"]
assert abs(_s["a"]["pass_rate"] - 2 / 3) < 1e-9, _s["a"]["pass_rate"]
assert _s["b"]["scored"] == 0 and _s["b"]["pass_rate"] is None, _s["b"]` },
      { name: '不改動傳進來的 records', code: `_P = {"m": {"in": 1.0, "out": 1.0}}
_rs = [{"prompt_version": "v", "model": "m", "in_tokens": 1, "out_tokens": 1, "latency_ms": x, "eval_pass": None} for x in [30, 10, 20]]
_before = [dict(r) for r in _rs]
summarize(_rs, _P)
assert _rs == _before, "records 被改動了（順序或內容）"` },
    ],
  },
]

## 從一個具體問題開始：review 看起來沒問題的 MR

AI agent 開了一個 merge request：「掛號列表加上醫師姓名」。diff 不長，邏輯清楚，reviewer 看過覺得沒問題就核准了。合併後一週內陸續發現：

1. 一個查詢函式回傳 `Doctor | None`，新程式直接用 `doctor.name`，醫師被停用時 API 回 500（`AttributeError: 'NoneType' object has no attribute 'name'`）。
2. 為了格式化日期，`pyproject.toml` 多了一個套件，實際上標準函式庫就做得到；那個套件的某個版本有已知漏洞。
3. 測試的 fixture 檔裡夾著一段從本機 `.env` 複製來的真實 API key，已經推到遠端。
4. 三個檔案多了沒用到的 import，另外兩個檔案的縮排與團隊格式不同，下一個 MR 的 diff 被格式變動塞滿。

這四件事都不需要人判斷：型別檢查會抓到第 1 項，相依套件檢查會抓到第 2 項，secret 掃描會抓到第 3 項，linter 與 formatter 會抓到第 4 項。reviewer 的注意力有限，AI 產出程式的速度又很快；**能用工具判定的事，就交給工具，並且讓它擋住合併**。人專心看設計、需求與命名。

## 閘門清單：每一道各抓什麼

| 檢查 | Python 常見工具 | 抓到什麼 | 速度 |
|---|---|---|---|
| Formatter | `ruff format --check`（或 black） | 格式與團隊不一致；讓 diff 只剩真正的改動 | 秒 |
| Linter | `ruff check` | 沒用到的 import 與變數、可疑寫法、部分安全規則、禁止的 import | 秒 |
| 型別檢查 | mypy、pyright | `None` 沒處理、參數型別對不上、呼叫不存在的屬性 | 秒到分鐘 |
| 測試與覆蓋率 | pytest / unittest + coverage.py | 行為被改壞；新程式完全沒被測到 | 分鐘 |
| 相依套件 | pip-audit（已知漏洞）、deptry（沒用到或沒宣告的依賴）、授權清單工具 | 有漏洞的版本、多加的依賴、授權不符合政策 | 分鐘 |
| Lock 檔一致 | `uv sync --locked` | `pyproject.toml` 改了但 `uv.lock` 沒更新 | 秒 |
| Secret 掃描 | gitleaks、GitLab Secret Detection | 金鑰、token、私鑰被 commit | 秒 |

幾個要注意的地方：

- **覆蓋率是下限，不是品質**。80% 的門檻能擋住「新功能完全沒測」，但擋不住「測試沒有斷言」。測試品質要靠先寫失敗測試的流程（見[規範要變成測試](#/skill/ai-spec-to-tests)）。
- **相依套件檢查有三件事**：已知漏洞、宣告與實際使用一致、授權允許。AI 很容易為了一個小功能加一個套件，閘門要讓這件事被看見。授權檢查的工具選擇較多（GitLab 有 License scanning，是否可用依方案而定；也可以用列出授權的工具再比對允許清單）。
- **`uv sync --locked` 與 `--frozen` 不同**。`--frozen` 直接照 lock 檔安裝、不檢查它是否過時；`--locked` 在 lock 檔需要更新時會失敗。CI 要用 `--locked`，才擋得住「改了依賴卻沒更新 lock 檔」。

Linter 與型別檢查的設定放在 `pyproject.toml`，本機與 CI 讀同一份：

```toml
[tool.ruff.lint]
# E/F：pycodestyle 與 pyflakes；I：import 排序；B：bugbear；UP：新語法；S：安全規則
select = ["E", "F", "I", "B", "UP", "S", "PGH", "RUF"]

[tool.ruff.lint.flake8-tidy-imports.banned-api]
# 把 ADR「領域層不得直接使用 ORM」變成機械檢查（實務上用 per-file 設定只套在領域層）
"sqlalchemy.orm".msg = "見 ADR-0003：領域層不直接使用 ORM"

[tool.mypy]
strict = true
```

`PGH` 規則會擋下沒指定代碼的 `# type: ignore` 與 `# noqa`，`RUF100` 會找出沒有作用的 `# noqa`；mypy 的 strict 模式包含 `warn_unused_ignores`。這幾條專門對付一種常見的「修法」：錯誤沒修，只是被註解蓋掉。

## 兩層：pre-commit 給回饋，CI 才是閘門

```text
寫程式 ──> git commit ──> git push ──> MR pipeline ──> 合併
              │                            │
         pre-commit hook               CI（伺服器端）
         幾秒、本機、可跳過             完整、強制、失敗擋 merge
```

**pre-commit** 在 `git commit` 時執行，幾秒內告訴你格式不對或夾了 secret。secret 在 commit 之前被擋下，就不會進到歷史、不會被推上去。設定檔 `.pre-commit-config.yaml`：

```yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.x.y            # 換成實際使用的版本並固定
    hooks:
      - id: ruff           # lint（較新版本也提供 ruff-check 這個 id）
        args: [--fix]
      - id: ruff-format
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.x.y            # 換成實際使用的版本並固定
    hooks:
      - id: gitleaks
```

但 pre-commit 有三個限制：可以用 `git commit --no-verify` 跳過、要每個人自己 `pre-commit install`、agent 的執行環境裡不一定裝了。所以它只是快速回饋。

**CI** 在伺服器上重跑同一套檢查（加上比較慢的型別檢查、測試、相依套件掃描），失敗就不能合併。這一層不能被跳過，人與 AI 的改動走的是同一道門。

## 實際設定：GitLab CI

```yaml
workflow:
  rules:
    # MR 觸發 merge request pipeline
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    # 分支已有開著的 MR 時，不再另外建 branch pipeline（避免同一個 push 跑兩條）
    - if: $CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS
      when: never
    - if: $CI_COMMIT_BRANCH

stages: [check, test]

default:
  image: ghcr.io/astral-sh/uv:python3.12-bookworm-slim
  before_script:
    - uv sync --locked          # lock 檔過時就失敗

lint:
  stage: check
  script:
    - uv run ruff format --check .
    - uv run ruff check .

typecheck:
  stage: check
  script:
    - uv run mypy .

dependencies:
  stage: check
  script:
    - uv run deptry .           # 沒用到 / 沒宣告的依賴
    - uv export --format requirements-txt --no-hashes > requirements.txt
    - uvx pip-audit -r requirements.txt   # 已知漏洞

secrets:
  stage: check
  image:
    name: zricethezav/gitleaks:latest     # 正式使用時固定版本
    entrypoint: [""]
  before_script: []
  script:
    - gitleaks detect --source . --redact --verbose

test:
  stage: test
  script:
    - uv run coverage run -m pytest --junitxml=report.xml
    - uv run coverage report --fail-under=80
  coverage: '/TOTAL.*\s+(\d+%)$/'       # 讓 MR 頁面顯示覆蓋率
  artifacts:
    when: always
    reports:
      junit: report.xml                 # MR 頁面顯示失敗的測試
```

這份設定假設 ruff、mypy、pytest、coverage、deptry 都列在專案的開發依賴裡，`uv run` 才找得到；pip-audit 用 `uvx` 臨時執行。secret 掃描也可以改用 GitLab 內建的 Secret Detection 樣板（`include: - template: …`），樣板名稱、預設 stage 與它在 MR pipeline 中的行為依 GitLab 版本有差異，採用前先對照所用版本的文件。

### 讓閘門真的擋得住

YAML 寫好只完成一半。還要在專案設定裡：

- **開啟「Pipelines must succeed」**（Settings → Merge requests 的合併檢查；名稱依版本可能略有不同）。沒開的話，pipeline 紅了 MR 一樣能按合併。
- **保護 main 分支**：不允許任何人直接 push，只能透過 MR 合併。否則 agent 或人可以繞過整個流程。
- **不要讓閘門 job `allow_failure: true`**。另外注意 `when: manual` 的 job 預設允許失敗，閘門不要做成手動 job。
- **小心 `rules: changes:`**。用它讓 job 只在某些檔案改動時執行可以省時間，但條件寫錯時，MR 可能沒跑檢查就顯示綠燈。
- **CI 設定本身也要保護**。AI 被要求「讓 CI 通過」時，最省事的路是改 `.gitlab-ci.yml`、降低 `--fail-under`、在 `pyproject.toml` 關掉規則。可以用 CODEOWNERS 讓這些檔案的改動需要指定的人核准（是否能強制核准依方案而定）；至少在 review 時把它們列為必看。

## 抓「被放寬的閘門」：一段可以跑的 diff 檢查

工具檢查程式碼，但有些問題出在 **diff 本身**：新增的 `# type: ignore`、被調低的覆蓋率門檻、看起來像金鑰的字串。下面這段程式掃描 diff 中新增的行，可以直接執行：

```python run
import re

# 虛構的 MR diff：只看 "+" 開頭（新增）的行
DIFF = """\
--- a/app/schedule.py
+++ b/app/schedule.py
+import os
+def doctor_name(doctor_id: int) -> str:
+    doctor = find_doctor(doctor_id)
+    return doctor.name  # type: ignore
--- a/.gitlab-ci.yml
+++ b/.gitlab-ci.yml
-    - uv run coverage report --fail-under=80
+    - uv run coverage report --fail-under=40
+  allow_failure: true
--- a/tests/fixtures/settings.env
+++ b/tests/fixtures/settings.env
+AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
"""

RULES = [
    ("沒指定代碼的 type: ignore（錯誤被蓋掉）", re.compile(r"#\s*type:\s*ignore(?!\[)")),
    ("沒指定代碼的 noqa", re.compile(r"#\s*noqa(?!:)")),
    ("閘門被設成允許失敗", re.compile(r"allow_failure:\s*true")),
    ("看起來像 AWS access key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("私鑰", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
]

removed_threshold = added_threshold = None
findings = []
current_file = "?"
for line in DIFF.splitlines():
    if line.startswith("+++ "):
        current_file = line[6:]
        continue
    if line.startswith("--- "):
        continue
    m = re.search(r"--fail-under=(\d+)", line)
    if m and line.startswith("-"):
        removed_threshold = int(m.group(1))
    if m and line.startswith("+"):
        added_threshold = int(m.group(1))
    if line.startswith("+"):
        for name, pattern in RULES:
            if pattern.search(line):
                findings.append(f"{current_file}: {name}：{line[1:].strip()}")

if removed_threshold is not None and added_threshold is not None and added_threshold < removed_threshold:
    findings.append(f"覆蓋率門檻被調低：{removed_threshold} → {added_threshold}")

print(f"找到 {len(findings)} 個問題：")
for f in findings:
    print("  -", f)
```

真正的 secret 掃描工具有上百條規則，還會計算字串的亂度（entropy）來找沒有固定格式的金鑰；這段程式只示範「看 diff 新增了什麼」的想法。被 commit 的金鑰就算之後刪掉，仍然留在 git 歷史裡，**要當作已經外洩，立刻撤銷並換新**，不是只把檔案刪掉。

## 常見錯誤與錯誤訊息

| 訊息（範例） | 來自 | 怎麼處理 |
|---|---|---|
| `Would reformat: app/schedule.py` | `ruff format --check` | 本機跑 `ruff format .` 後重新 commit；pre-commit 會自動做 |
| `app/schedule.py:1:8: F401 [*]` 後接「`os` imported but unused」 | `ruff check` | 刪掉 import；`[*]` 代表 `ruff check --fix` 能自動修 |
| `error: Item "None" of "Optional[Doctor]" has no attribute "name"  [union-attr]`（新版 mypy 可能用聯集語法顯示型別） | mypy | 處理 `None` 的情況（回 404 或提早 return），不要加 `# type: ignore` |
| `Coverage failure: total of 72 is less than fail-under=80` | coverage.py | 為新程式補測試；不要調低門檻 |
| lock 檔需要更新、但指定了 `--locked` 的錯誤 | `uv sync --locked` | 本機跑 `uv lock`，把 `uv.lock` 一起 commit |
| `leaks found: 1` | gitleaks | 撤銷那把金鑰並換新；把檔案從 commit 中移除；誤判才加進忽略清單 |
| MR 顯示可合併，但 pipeline 是紅的 | 專案設定 | 開啟「Pipelines must succeed」 |
| MR 沒有任何 pipeline | `workflow: rules` | 加上 `merge_request_event` 的規則 |

## 動手

1. 在 Playground 執行上面的 diff 檢查，再在 `DIFF` 加一行 `+    return doctor.name  # noqa`，看它被抓到；改成 `# noqa: E501` 後再跑一次。
2. 在 `RULES` 加一條：抓新增的 `@unittest.skip` 或 `pytest.mark.skip`。
3. 做程式題 `ai-quality-gates-1`：把只在 main 跑、失敗也不擋的 `.gitlab-ci.yml` 改成完整的品質閘門。
4. 對照 [CI 管線](#/skill/ci-pipeline)，把上面的 GitLab 設定改寫成 GitHub Actions，並說明 GitHub 上「失敗擋 merge」要在哪裡設定。

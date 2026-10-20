// 程式題：AI 時代的開發
export default [
  {
    id: 'ai-spec-to-tests-1', skill: 'ai-spec-to-tests', kind: 'python', level: 2,
    title: '讓規範測試由紅轉綠：千分位與正整數數量',
    prompt: '訂單明細要顯示小計。開發途中陸續補充了兩條規範，現在都已寫成測試（下方的測試清單）：\n\n1. **金額顯示要有千分位**：`format_amount(1234567)` → `"1,234,567"`；`0` → `"0"`；負數 `-1234` → `"-1,234"`\n2. **數量必須是正整數**：`parse_quantity` 接受正的 `int` 或只含數字的字串（`"12"` → `12`）；`float`（包括 `3.0`）、有小數點的字串、`0`、負數、空字串、`bool` 一律 `raise ValueError`\n\n`line_total(price, quantity)` 回傳 `format_amount(price * parse_quantity(quantity))`。\n\n起始碼是之前修 bug 時被改壞的版本，按「執行」會看到底部的 unittest 是紅的。修改三個函式讓測試全部通過，**不要改測試**。',
    starter: `import sys
import unittest


def format_amount(amount: int) -> str:
    return str(amount)


def parse_quantity(value) -> int:
    # 之前為了「容錯」改成這樣：2.5 會被默默截成 2
    return int(float(value))


def line_total(price: int, quantity) -> str:
    return format_amount(price * parse_quantity(quantity))


class TestSpec(unittest.TestCase):
    def test_amount_has_thousands_separator(self):
        self.assertEqual(format_amount(1234567), "1,234,567")

    def test_quantity_rejects_decimal(self):
        with self.assertRaises(ValueError):
            parse_quantity("2.5")


unittest.TextTestRunner(stream=sys.stdout, verbosity=2).run(
    unittest.defaultTestLoader.loadTestsFromTestCase(TestSpec)
)
`,
    solution: `import sys
import unittest


def format_amount(amount: int) -> str:
    # 格式規格 "," 會每三位加一個逗號，負號保留在最前面
    return f"{amount:,}"


def parse_quantity(value) -> int:
    # bool 是 int 的子類別（True == 1），要先排除
    if isinstance(value, bool):
        raise ValueError("數量必須是正整數")
    if isinstance(value, int):
        quantity = value
    elif isinstance(value, str) and value.strip().isdigit():
        quantity = int(value.strip())
    else:
        # float（包括 3.0）、"2.5"、"" 等都不接受
        raise ValueError("數量必須是正整數")
    if quantity <= 0:
        raise ValueError("數量必須是正整數")
    return quantity


def line_total(price: int, quantity) -> str:
    return format_amount(price * parse_quantity(quantity))


class TestSpec(unittest.TestCase):
    def test_amount_has_thousands_separator(self):
        self.assertEqual(format_amount(1234567), "1,234,567")

    def test_quantity_rejects_decimal(self):
        with self.assertRaises(ValueError):
            parse_quantity("2.5")


unittest.TextTestRunner(stream=sys.stdout, verbosity=2).run(
    unittest.defaultTestLoader.loadTestsFromTestCase(TestSpec)
)
`,
    tests: [
      { name: '規範 1：金額有千分位', code: `assert format_amount(1234567) == "1,234,567", format_amount(1234567)\nassert format_amount(1000) == "1,000", format_amount(1000)\nassert format_amount(999) == "999", format_amount(999)` },
      { name: '規範 1：0 與負數', code: `assert format_amount(0) == "0", format_amount(0)\nassert format_amount(-1234) == "-1,234", format_amount(-1234)` },
      { name: '規範 2：接受正整數與數字字串', code: `assert parse_quantity(3) == 3\nassert parse_quantity("12") == 12\nassert type(parse_quantity("12")) is int` },
      { name: '規範 2：有小數一律拒絕（2.5、"2.5"、3.0）', code: `for _v in (2.5, "2.5", 3.0):\n    try:\n        parse_quantity(_v)\n        raise AssertionError(f"{_v!r} 沒有 raise ValueError")\n    except ValueError:\n        pass` },
      { name: '規範 2：0、負數、空字串、bool 拒絕', code: `for _v in (0, -1, "-1", "", True):\n    try:\n        parse_quantity(_v)\n        raise AssertionError(f"{_v!r} 沒有 raise ValueError")\n    except ValueError:\n        pass` },
      { name: 'line_total 同時遵守兩條規範', code: `assert line_total(1250, "3") == "3,750", line_total(1250, "3")\ntry:\n    line_total(1250, 2.5)\n    raise AssertionError("數量 2.5 沒有 raise ValueError")\nexcept ValueError:\n    pass` },
    ],
    hints: [
      'Python 的格式規格可以加千分位：f"{n:,}"。',
      'isinstance(True, int) 是 True——bool 要比 int 先檢查。',
      '字串可以用 str.isdigit() 判斷是否只含數字；"-1" 與 "2.5" 都不會通過。',
    ],
  },
  {
    id: 'ai-quality-gates-1', skill: 'ai-quality-gates', kind: 'config', level: 2,
    file: '.gitlab-ci.yml',
    title: '幫 AI 的改動加上品質閘門（GitLab CI）',
    prompt: '這個 Python 專案（用 uv 管理）讓 AI 開 merge request，但現在的 `.gitlab-ci.yml` 只在 main 跑測試，而且測試失敗也不擋。改寫成：\n\n- **merge request 會觸發 pipeline**（`$CI_PIPELINE_SOURCE == "merge_request_event"`），main 分支照樣會跑\n- `lint` job：`ruff format --check` 與 `ruff check`\n- `typecheck` job：mypy 或 pyright\n- `test` job：跑測試並設覆蓋率門檻（例如 `coverage report --fail-under=80`）\n- 有 **secret 掃描**（GitLab 的 Secret-Detection 樣板或 gitleaks 之類的工具）\n- 這些檢查失敗都要讓 pipeline 失敗（不能 `allow_failure: true`），搭配專案設定「Pipelines must succeed」才擋得住 merge',
    starter: `workflow:
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

default:
  image: ghcr.io/astral-sh/uv:python3.12-bookworm-slim

test:
  script:
    - uv sync --locked
    - uv run pytest
  allow_failure: true
`,
    solution: `workflow:
  rules:
    # merge request 觸發 MR pipeline
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    # 分支已經有開著的 MR 時，不再另外建 branch pipeline（避免重複）
    - if: $CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS
      when: never
    - if: $CI_COMMIT_BRANCH

stages: [check, test]

default:
  image: ghcr.io/astral-sh/uv:python3.12-bookworm-slim
  before_script:
    - uv sync --locked

lint:
  stage: check
  script:
    - uv run ruff format --check .
    - uv run ruff check .

typecheck:
  stage: check
  script:
    - uv run mypy .

secrets:
  stage: check
  image:
    name: zricethezav/gitleaks:latest   # 正式使用時釘到明確版本
    entrypoint: [""]
  before_script: []
  script:
    - gitleaks detect --source . --redact --verbose

test:
  stage: test
  script:
    - uv run coverage run -m pytest
    - uv run coverage report --fail-under=80
`,
    hints: [
      'workflow: rules 決定整條 pipeline 建不建立；只寫 main 的規則，MR 就不會有 pipeline。',
      '同一個 job 的多個指令放在 script 陣列裡，任何一行失敗 job 就失敗。',
      '覆蓋率門檻：coverage report --fail-under=80，或 pytest-cov 的 --cov-fail-under=80。',
    ],
    tests: [
      { name: 'merge request 會觸發 pipeline', code: `const text = lines.join('\\n')\nassert(/\\$CI_PIPELINE_SOURCE\\s*==\\s*["']merge_request_event["']/.test(text), 'workflow rules 要有 $CI_PIPELINE_SOURCE == "merge_request_event"')` },
      { name: 'lint job：ruff format --check 與 ruff check', code: `const text = lines.join('\\n') + '\\n'\nconst m = text.match(/^lint:[^\\n]*\\n((?:[ \\t-].*\\n)*)/m)\nassert(m, '找不到 lint job')\nassert(/ruff\\s+format\\b[^\\n]*--check/.test(m[1]), 'lint 要跑 ruff format --check')\nassert(/ruff\\s+check\\b/.test(m[1]), 'lint 要跑 ruff check')` },
      { name: 'typecheck job：mypy 或 pyright', code: `const text = lines.join('\\n') + '\\n'\nconst m = text.match(/^typecheck:[^\\n]*\\n((?:[ \\t-].*\\n)*)/m)\nassert(m, '找不到 typecheck job')\nassert(/\\b(mypy|pyright)\\b/.test(m[1]), 'typecheck 要跑 mypy 或 pyright')` },
      { name: 'test job：測試 + 覆蓋率門檻', code: `const text = lines.join('\\n') + '\\n'\nconst m = text.match(/^test:[^\\n]*\\n((?:[ \\t-].*\\n)*)/m)\nassert(m, '找不到 test job')\nassert(/\\b(pytest|unittest)\\b/.test(m[1]), 'test 要跑測試')\nassert(/fail-under[= ]\\s*\\d+/.test(m[1]), 'test 要設覆蓋率門檻（--fail-under / --cov-fail-under）')` },
      { name: '有 secret 掃描', code: `const text = lines.join('\\n')\nassert(/Secret-Detection\\.gitlab-ci\\.yml|gitleaks|trufflehog|detect-secrets/i.test(text), '要有 secret 掃描（Secret-Detection 樣板、gitleaks…）')` },
      { name: '檢查失敗會讓 pipeline 失敗（沒有 allow_failure: true）', code: `assert(!lines.some((l) => /allow_failure:\\s*true/.test(l)), '品質閘門的 job 不能 allow_failure: true')` },
    ],
  },
]

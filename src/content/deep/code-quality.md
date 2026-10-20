## 從一個具體問題開始：三週沒寄出的出貨通知

出貨後要寄通知信，程式通過了 code review：

```python
def notify_shipped(order_id: int) -> None:
    order = repo.find_order(order_id)          # 查不到時回傳 None
    try:
        mailer.send(order.customer.email, "您的訂單已出貨")
    except:
        pass                                   # 「寄信失敗不要影響出貨流程」
```

三週後客服發現：有一批訂單被合併成新訂單、舊訂單被刪掉了，`find_order` 回傳 `None`，`order.customer` 丟出 `AttributeError`，被裸的 `except:` 吞掉。沒有 log、沒有錯誤、沒有信。

這段程式裡至少有兩個問題，工具在存檔當下就能指出：

- **型別檢查器**：`find_order` 的回傳型別是 `Order | None`，直接存取 `.customer` 時，pyright 會報 `"customer" is not a known attribute of "None" (reportOptionalMemberAccess)`。
- **linter**：ruff 的 `E722 Do not use bare except`。

人在 review 時很容易漏掉這類「看起來沒問題」的細節；機器不會。這篇說明格式化工具、linter、型別檢查器各自抓什麼，以及怎麼把它們接到 commit 與 CI 上，讓規則自動執行。

## 三種工具，三種問題

| 工具 | 看的是什麼 | 抓得到 | 抓不到 | 代表工具 |
|---|---|---|---|---|
| formatter | 排版：縮排、換行、引號、空白 | 不抓錯，直接改成統一格式 | 任何邏輯問題 | `ruff format`（與 black 相容）、black |
| linter | 程式碼的**模式**，一次看一個檔案的語法樹 | 未使用的 import 與變數、裸 except、可變預設參數、`== None`、迴圈變數被閉包捕捉 | 資料在函式之間怎麼流動 | ruff、flake8、pylint |
| 型別檢查器 | **型別**在整個專案裡怎麼流動 | 可能是 None 卻直接用、參數型別錯、回傳型別不一致、屬性不存在 | 邏輯對不對（型別正確的錯誤答案） | pyright、mypy |

三者互補，不是互相取代：formatter 讓 diff 只剩實質變更、review 不再討論空白；linter 抓「這種寫法本身就可疑」；型別檢查器抓「這個值在這裡可能不是你以為的型別」。

### formatter：結束排版爭論

formatter 會把程式碼解析之後重新輸出，所以結果只取決於程式碼本身，不取決於誰寫的。`ruff format --check` 只檢查不修改，有檔案需要重排時以非零狀態結束，可以直接當 CI 的關卡。換行寬度等少數選項可以設定，但重點是「團隊選一套、全部交給工具」。

### linter：每條規則背後都有一種 bug

ruff 的規則代碼前綴代表來源：`F` 來自 Pyflakes、`E`／`W` 來自 pycodestyle、`B` 來自 flake8-bugbear、`UP` 來自 pyupgrade、`I` 是 import 排序。ruff 預設只開 `E4`、`E7`、`E9`、`F`；下表裡的 `B` 系列要自己加進 `extend-select`。

| 規則 | 訊息 | 背後的 bug |
|---|---|---|
| `F401` | `os` imported but unused | 多餘的 import 拖慢啟動，也可能讓循環 import 更難解；有時代表本來要用卻用錯了名字 |
| `F841` | Local variable `totl` is assigned to but never used | 常常是拼錯字：算好的 `totl` 沒用到，回傳的 `total` 是舊值 |
| `F811` | Redefinition of unused name | 同名函式定義兩次，前一個被默默蓋掉（測試函式重名時，只有後一個會執行） |
| `E711` | Comparison to `None` should be `cond is None` | `==` 會呼叫物件的 `__eq__`，自訂了 `__eq__` 的物件可能回傳意外結果；`is` 比的是身分 |
| `E722` | Do not use bare `except` | 連 `KeyboardInterrupt`、`SystemExit` 都會被吞掉，錯誤無聲消失 |
| `B006` | Do not use mutable data structures for argument defaults | 預設的 list／dict 只建立一次，被所有呼叫共用 |
| `B023` | Function definition does not bind loop variable `i` | 迴圈裡建立的閉包，執行時才讀變數，全部拿到最後一個值 |
| `B904` | Within an `except` clause, raise exceptions with `raise ... from err` … | 轉換例外時沒有保留原因，traceback 少了根源 |

看到不懂的規則，`ruff rule B006` 會印出這條規則的說明、為什麼不好、怎麼修。

### 型別檢查器：漸進式加嚴

Python 的型別提示是選用的，型別檢查器只能檢查有標註的地方，所以導入通常是漸進的：

- **mypy 預設不檢查沒有標註的函式內部**：`def f(x):` 裡寫了 `y: int = "a"`，mypy 只會提示 `By default the bodies of untyped functions are not checked, consider using --check-untyped-defs`。開 `--strict` 或 `disallow_untyped_defs` 後，沒標註的函式本身就會被報錯。
- **pyright 有 `basic`、`standard`、`strict` 等模式**（`typeCheckingMode`），也可以只對特定檔案或資料夾開 strict。
- 常見的導入路徑：全專案先用寬鬆模式讓 CI 綠，新寫的模組開嚴格模式，再逐步擴大。

型別檢查器的錯誤多半是真的 bug，例如：

- `X | None` 沒處理 None：查無資料、環境變數沒設、dict 的 `.get()`。
- 回傳型別不一致：某個分支忘了 `return`，回傳了 `None`。
- 參數型別錯：把 `"100"`（字串）傳給要 `int` 的函式。

想知道檢查器推論出什麼型別，在程式裡寫 `reveal_type(x)`，執行檢查時它會印出推論結果（mypy 與 pyright 都支援）。

`Any` 會讓檢查失效：一個值變成 `Any` 之後，對它做什麼都不會報錯，而且會沿著運算傳出去。沒有型別資訊的第三方套件、`json.loads` 的結果都是 `Any` 的常見來源，在邊界用 pydantic 或 dataclass 轉成有型別的物件，能讓後面的程式重新受到檢查。

## 自動執行：存檔、commit、CI 三道關卡

```text
編輯器存檔 ── ruff format、ruff check、型別檢查即時提示（最快回饋）
     │
git commit ── pre-commit：只跑這次改到的檔案；不過就不讓 commit
     │
git push ─── CI：全專案 ruff format --check、ruff check、pyright／mypy、pytest
             （pre-commit 可以用 --no-verify 跳過，CI 才是不能跳過的那一關）
```

### 設定

```toml
# pyproject.toml
[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
extend-select = [
    "B",    # flake8-bugbear：可變預設、迴圈閉包、raise from
    "I",    # import 排序
    "UP",   # 改用新版語法（例如 Optional[int] → int | None）
]

[tool.pyright]
include = ["app", "tests"]
typeCheckingMode = "standard"
# 新模組可以個別開 strict：
strict = ["app/billing"]

[tool.mypy]               # 若選 mypy 而不是 pyright
strict = true
```

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.15.8            # 釘住版本，和 CI 用同一版
    hooks:
      - id: ruff-check      # 較舊版本的 hook id 是 ruff
        args: [--fix]
      - id: ruff-format
```

```bash
uv add --dev ruff pyright pre-commit
uv run pre-commit install          # 在 .git/hooks 裝好 hook，之後每次 commit 自動跑
uv run pre-commit run --all-files  # 第一次導入時，對全專案跑一遍

# CI 的步驟（任何一步失敗就擋下 PR）
uv run ruff format --check .
uv run ruff check .
uv run pyright
uv run pytest
```

型別檢查需要專案的依賴都裝好才能正確分析，所以通常放在 CI 用 `uv run pyright` 跑，而不是放進 pre-commit 的隔離環境。CI 管線的整體設計見 [CI 管線：lint、test、build](#/skill/ci-pipeline)，實驗室 [CI/CD 管線對照](#/lab/PipelineLab) 可以看各階段怎麼串。

## 實際程式：用 ast 寫一條 lint 規則

linter 並不神祕：把原始碼解析成**抽象語法樹**（AST），走訪每個節點，找出符合某種模式的地方。下面用標準函式庫的 `ast` 寫四條規則，輸出格式模仿 ruff。

```python run
import ast

SOURCE = '''
import os
import json

def add_tag(tag, tags=[]):
    tags.append(tag)
    return tags

def load(path, cache={}):
    try:
        totl = 0
        data = json.loads(path)
        total = len(data)
    except:
        pass
    if data == None:
        return None
    return total
'''

class MiniLinter(ast.NodeVisitor):
    def __init__(self):
        self.problems = []
        self.imported = {}       # 名稱 → 行號
        self.used = set()

    def report(self, node, code, msg):
        self.problems.append((node.lineno, node.col_offset + 1, code, msg))

    # F401：記錄 import，最後比對有沒有被用到
    def visit_Import(self, node):
        for alias in node.names:
            self.imported[alias.asname or alias.name] = node
        self.generic_visit(node)

    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Load):
            self.used.add(node.id)
        self.generic_visit(node)

    # B006：預設值是 list／dict／set 字面值
    # F841：函式裡被賦值、卻從沒被讀取的區域變數
    def visit_FunctionDef(self, node):
        for d in node.args.defaults + node.args.kw_defaults:
            if isinstance(d, (ast.List, ast.Dict, ast.Set)):
                self.report(d, "B006", "Do not use mutable data structures for argument defaults")
        assigned, loaded = {}, set()
        for sub in ast.walk(node):
            if isinstance(sub, ast.Name):
                if isinstance(sub.ctx, ast.Store):
                    assigned.setdefault(sub.id, sub)
                else:
                    loaded.add(sub.id)
        for name, n in assigned.items():
            if name not in loaded:
                self.report(n, "F841", f"Local variable `{name}` is assigned to but never used")
        self.generic_visit(node)

    # E722：except 後面沒有寫例外型別
    def visit_ExceptHandler(self, node):
        if node.type is None:
            self.report(node, "E722", "Do not use bare `except`")
        self.generic_visit(node)

    # E711：用 == / != 和 None 比較
    def visit_Compare(self, node):
        for op, right in zip(node.ops, node.comparators):
            if isinstance(op, (ast.Eq, ast.NotEq)) and isinstance(right, ast.Constant) and right.value is None:
                self.report(node, "E711", "Comparison to `None` should be `cond is None`")
        self.generic_visit(node)

    def finish(self):
        for name, node in self.imported.items():
            if name not in self.used:
                self.report(node, "F401", f"`{name}` imported but unused")
        return sorted(self.problems)

tree = ast.parse(SOURCE)
linter = MiniLinter()
linter.visit(tree)
for line, col, code, msg in linter.finish():
    print(f"example.py:{line}:{col}: {code} {msg}")

# 看看規則比對的節點長什麼樣
handler = next(n for n in ast.walk(tree) if isinstance(n, ast.ExceptHandler))
print("\n裸 except 的 ExceptHandler.type =", handler.type)
compare = next(n for n in ast.walk(tree) if isinstance(n, ast.Compare))
print(ast.dump(compare))
```

輸出裡 `F841 totl` 那一條就是「拼錯字」型的 bug：`totl = 0` 沒有被用到。注意這個極簡版本不懂作用域（類別、巢狀函式、`global`），也不懂 `__all__` 的重新匯出；真正的 linter 要處理這些，才能避免誤報。

### 這些規則擋下的到底是什麼

```python run
import sys

# E722：裸 except 連 SystemExit 都吞掉——程式想結束卻結束不了
def shutdown_then_continue():
    try:
        sys.exit(1)                 # 例如收到停止訊號後要結束
    except:
        print("裸 except 吞掉了：", repr(sys.exc_info()[1]))
    return "程式繼續往下跑"

print(shutdown_then_continue())

def shutdown_correctly():
    try:
        sys.exit(1)
    except Exception:               # SystemExit 不是 Exception 的子類別，不會被這裡攔下
        print("不會印出")

try:
    shutdown_correctly()
except SystemExit as e:
    print("Exception 沒有攔下 SystemExit，正常往外傳：", e.code)

# E711：== None 會呼叫自訂的 __eq__
class Money:
    def __init__(self, cents):
        self.cents = cents
    def __eq__(self, other):
        return True                 # 寫壞的 __eq__（或刻意寬鬆的比較）

m = Money(100)
print("m == None →", m == None, "；m is None →", m is None)

# B023：迴圈裡建立的閉包，執行時才讀 i
callbacks = []
for i in range(3):
    callbacks.append(lambda: f"處理第 {i} 筆")
print([cb() for cb in callbacks])
```

## 常見錯誤與錯誤訊息

**ruff**（`--output-format concise`）：

```text
app/notify.py:1:8: F401 [*] `os` imported but unused
app/notify.py:5:23: B006 Do not use mutable data structures for argument defaults
app/notify.py:14:5: E722 Do not use bare `except`
Found 3 errors.
[*] 1 fixable with the `--fix` option.
```

格式是 `檔案:行:欄: 規則代碼 訊息`；`[*]` 代表 `ruff check --fix` 能自動修。有些修正可能改變行為，ruff 把它們歸為 unsafe，要加 `--unsafe-fixes` 才會套用，套用前要自己看過 diff。

**mypy**：

```text
app/users.py:2: error: Incompatible return value type (got "str | None", expected "str")  [return-value]
app/users.py:14: error: Argument 1 to "price" has incompatible type "str"; expected "int"  [arg-type]
app/client.py:1: error: Library stubs not installed for "requests"  [import-untyped]
```

結尾中括號是錯誤代碼。`return-value` 的修法是處理 None 的分支（查無資料時 `raise NotFound`），或誠實地把回傳型別改成可能是 None，讓呼叫端處理。`import-untyped` 表示套件沒有附型別資訊，mypy 會提示安裝對應的 stub 套件（例如 `types-requests`）。

**pyright**：

```text
app/users.py:26:17 - error: "upper" is not a known attribute of "None" (reportOptionalMemberAccess)
app/billing.py:30:12 - error: Type "float | Literal[0]" is not assignable to return type "int" (reportReturnType)
```

括號裡是規則名稱，可以在設定裡個別調整嚴格度。第二條是因為 `sum(list[float])` 的結果是 float（空 list 時是 0），宣告回傳 `int` 不符。

**壓掉錯誤的正確方式**：真的確定是誤報時，壓掉**特定代碼**並寫原因：`# noqa: E722  第三方 SDK 會丟出 BaseException 子類別` 或 `# type: ignore[import-untyped]`。不要寫沒有代碼的 `# type: ignore` 或 `# noqa`，它們會連以後新出現的錯誤一起壓掉。

**pre-commit 改了檔案導致 commit 失敗**：`ruff-format` 或 `ruff-check --fix` 修改了檔案時，hook 會回報失敗，這是正常的，代表檔案被改過、需要重新 `git add` 再 commit 一次。

## 動手

1. 執行「用 ast 寫一條 lint 規則」那段，在 `SOURCE` 裡加一個 `def f(x=set()):`，它沒有被 B006 抓到（`set()` 是函式呼叫、不是字面值）。修改 `visit_FunctionDef`，讓 `list()`、`dict()`、`set()` 的呼叫也被回報。
2. 在同一段加一條新規則 `PRINT001`：回報所有 `print(...)` 呼叫（提示：`visit_Call`，檢查 `node.func` 是不是名稱為 `print` 的 `ast.Name`）；後端程式應該用 logging（見 [日誌、錯誤處理與設定](#/skill/logging-config)）。
3. 執行「這些規則擋下的到底是什麼」那段，把 B023 那個迴圈改成 `lambda i=i: …`，確認三個回呼各自印出 0、1、2。
4. 在本機專案導入 ruff：先 `uv run ruff check .` 看預設規則的結果，再加上 `extend-select = ["B"]`，看多抓出哪些問題，逐條用 `ruff rule <代碼>` 讀懂原因。
5. 回到 [Python 後端心智模型](#/skill/python-backend)，對照可變預設參數與 late binding 的完整說明。

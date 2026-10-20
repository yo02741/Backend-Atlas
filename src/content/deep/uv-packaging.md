## 從一個具體問題開始：同一個 commit，昨天綠燈、今天紅燈

專案的依賴只寫在 `requirements.txt`：

```text
fastapi
httpx>=0.27
```

週一 CI 全綠；週二沒有任何人改程式，重跑同一個 commit，測試卻失敗了。錯誤來自一個從沒聽過的套件，它是 fastapi 的依賴的依賴，前一晚發布了新版，行為有不相容的變更。CI 每次都是全新安裝，`pip install -r requirements.txt` 會挑「目前允許範圍內最新的版本」，所以週一和週二裝到的是兩組不同的套件。

同樣的機制也造成「我這台可以跑」：同事三個月前裝的環境停在舊版本，新進成員今天裝到新版本，兩邊跑同一份程式，結果不同。

問題的根源是只記錄了**想要什麼**（直接依賴與大概的版本範圍），沒有記錄**實際裝了什麼**（整棵依賴樹的精確版本）。uv 把這兩件事分成兩個檔案，再加上虛擬環境與 Python 版本，一起管理。

## 四樣東西，各管一件事

| 檔案 | 記錄什麼 | 誰寫 | 進版控 |
|---|---|---|---|
| `pyproject.toml` | 專案名稱、`requires-python`、**直接依賴**與版本範圍、dev 群組、工具設定 | 人（或 `uv add`） | 要 |
| `uv.lock` | 解析結果：**每一個**套件（含間接依賴）的精確版本、來源、檔案 hash | uv，不要手改 | 要 |
| `.python-version` | 這個專案用哪個 Python（例如 `3.12`） | 人（或 `uv python pin`） | 要 |
| `.venv/` | 依 lock 實際裝好的套件與一個 Python 直譯器的連結 | uv | **不要**（`.gitignore`） |

關係是單向的：`pyproject.toml` 經過**解析**（resolve）變成 `uv.lock`，`uv.lock` 經過**同步**（sync）變成 `.venv`。

```text
pyproject.toml ──(uv lock：查套件索引、解出整棵樹)──→ uv.lock ──(uv sync：裝／移除)──→ .venv/
 「要 fastapi>=0.115」                                「fastapi 0.115.6、starlette 0.41.3、         「實際的檔案」
                                                        pydantic 2.10.4……每個都有 hash」
                                                       （版本號僅為示意）
```

`uv.lock` 是**跨平台**的：它把 macOS、Linux、Windows、不同 Python 版本可能需要的套件都解出來，用環境標記（marker，例如 `python_full_version < '3.13'`）標示適用條件。所以在 macOS 上產生的 lock，Linux 的 CI 與 Docker 也直接能用。這一點和 `pip freeze` 不同：`pip freeze` 列出的是「目前這台機器這個環境裡裝了什麼」，換平台就可能不適用，也會把手動裝進去、其實沒用到的套件一起凍結。

### 虛擬環境是什麼

虛擬環境就是一個資料夾：

- `pyvenv.cfg`：記錄它是從哪個 Python 建出來的（`home = …`、`version_info = …`）
- `bin/python`：指向真正直譯器的連結（Windows 是 `Scripts\python.exe`）
- `lib/python3.12/site-packages/`：這個專案專屬的套件

用 `.venv/bin/python` 啟動時，Python 讀到 `pyvenv.cfg`，就把 `sys.prefix` 設成 `.venv`，從它的 `site-packages` 找套件；`sys.base_prefix` 仍然指向原本的 Python 安裝位置。傳統的 `source .venv/bin/activate` 只是把 `.venv/bin` 放到 `PATH` 最前面，讓 `python` 這個指令解析到虛擬環境裡那一個。`uv run` 直接用虛擬環境裡的直譯器執行，所以不需要 activate。

## 版本範圍怎麼寫

`pyproject.toml` 的 `dependencies` 用的是 PEP 440 的版本規格（version specifier）：

| 寫法 | 意思 | 允許 | 不允許 |
|---|---|---|---|
| `>=2.7` | 2.7 以上 | 2.7.0、2.9.1、3.0.0 | 2.6.9 |
| `>=2.7,<3` | 2.7 以上、3 以下 | 2.7.0、2.99 | 3.0.0 |
| `~=2.7` | 等同 `>=2.7, ==2.*` | 2.7、2.12 | 3.0 |
| `~=2.7.1` | 等同 `>=2.7.1, ==2.7.*` | 2.7.1、2.7.9 | 2.8.0 |
| `==2.7.*` | 2.7 系列任何版本 | 2.7.0、2.7.5 | 2.8.0 |
| `==2.7.1` | 只有這一版 | 2.7.1 | 其他全部 |

`^2.7` 這種「插入號」寫法是 Poetry 在自己的 `[tool.poetry.dependencies]` 區段裡用的語法，不是 PEP 440。放進 `[project] dependencies` 會被當成不合法的依賴字串，產生套件中繼資料時就失敗（以 setuptools 為建置後端時，訊息會包含 `must be pep508`）。

怎麼選：

- **應用程式（API 服務）**：`pyproject.toml` 寫寬鬆的下限（`uv add` 預設就是 `>=目前版本`），可重現性交給 `uv.lock`。升級是刻意的動作（`uv lock --upgrade-package httpx`），在 PR 裡看得到 lock 的差異、CI 會驗。
- **函式庫（給別人 import 的套件）**：lock 檔不會跟著套件發布，使用者的環境會和其他套件一起解析，所以範圍要寫得夠寬，避免和使用者的其他依賴衝突。
- **0.x 版的套件**：很多套件在 0.x 階段次版號（0.27 → 0.28）就可能有不相容的變更，必要時加上上限（`>=0.27,<0.29`）。這是慣例，不是規範，以該套件的變更紀錄為準。

## 指令與它們動到的檔案

| 指令 | 改 pyproject | 改 uv.lock | 改 .venv | 用在什麼時候 |
|---|---|---|---|---|
| `uv add httpx` | 加一行 | 重新解析 | 安裝 | 要一個新依賴 |
| `uv add --dev pytest` | 加進 `[dependency-groups]` 的 dev | 重新解析 | 安裝 | 只有開發時要的工具 |
| `uv remove httpx` | 刪掉那行 | 重新解析 | 移除 | 不要了 |
| `uv lock` | 不動 | lock 過期才更新 | 不動 | 手改 pyproject 之後 |
| `uv lock --upgrade-package httpx` | 不動 | 只把 httpx 升到範圍內最新 | 不動 | 刻意升級一個套件 |
| `uv sync` | 不動 | 過期就先更新 | 調成和 lock 完全一致 | 拉了別人的變更 |
| `uv sync --locked` | 不動 | lock 過期就**失敗** | 調成一致 | CI：抓「改了依賴卻忘了提交 lock」 |
| `uv sync --frozen` | 不動 | **不檢查、不更新** | 照 lock 安裝 | Docker build 等只想照 lock 裝的地方 |
| `uv run pytest` | 不動 | 過期就先更新 | 先同步再執行 | 日常執行任何指令 |

`uv sync` 預設是「精確同步」：lock 裡沒有的套件會從 `.venv` 移除，所以手動 `pip install` 進去的東西下一次 sync 就不見了。需要保留時有 `--inexact`，但通常代表那個套件應該 `uv add` 進專案。

## 實際程式

### 從零建立專案

```bash
uv init api && cd api              # 產生 pyproject.toml、.python-version、main.py
uv python pin 3.12                 # 寫入 .python-version；缺的版本 uv 會自動下載
uv add fastapi "uvicorn[standard]" # 直接依賴：寫進 pyproject、解析、寫 lock、安裝
uv add --dev pytest ruff           # 開發工具進 dev 群組
uv run uvicorn main:app --reload   # 不用 activate
uv tree --depth 2                  # 看依賴樹：誰把哪個間接依賴帶進來
git add pyproject.toml uv.lock .python-version
```

產生的 `pyproject.toml` 大致如下（版本號會是你執行當下的最新版）：

```toml
[project]
name = "api"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115.6",
    "uvicorn[standard]>=0.34.0",
]

[dependency-groups]
dev = [
    "pytest>=8.3.4",
    "ruff>=0.8.4",
]
```

### CI 與 Docker

```bash
# CI：lock 必須和 pyproject 一致，否則直接失敗
uv sync --locked
uv run pytest
```

```dockerfile
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
# 先只複製依賴描述檔：程式碼改了但依賴沒變時，這一層可以用快取
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY . .
RUN uv sync --frozen --no-dev
CMD ["uv", "run", "--no-sync", "uvicorn", "main:app", "--host", "0.0.0.0"]
```

`--no-dev` 不裝 dev 群組；`--no-install-project` 先只裝依賴、不裝專案本身，讓依賴那一層的快取不受程式碼變動影響。正式環境建議把 uv 映像的標籤釘成特定版本，而不是 `latest`；Dockerfile 的分層快取細節見 [幫 Python 專案寫好 Dockerfile](#/skill/dockerfile-python)。

### 在瀏覽器裡看版本規格怎麼比對

```python run
# PEP 440 版本規格的極簡版：只處理純數字版本（真正的實作請用 packaging 套件）
def parse(v: str) -> tuple[int, ...]:
    return tuple(int(x) for x in v.split("."))

def pad(a, b):
    n = max(len(a), len(b))
    return a + (0,) * (n - len(a)), b + (0,) * (n - len(b))

def match_one(version: str, spec: str) -> bool:
    for op in ("~=", "==", "!=", ">=", "<=", ">", "<"):
        if spec.startswith(op):
            target = spec[len(op):].strip()
            break
    v = parse(version)
    if op == "==" and target.endswith(".*"):          # ==2.7.*：前綴相同
        prefix = parse(target[:-2])
        return v[: len(prefix)] == prefix
    if op == "~=":                                     # ~=2.7.1 → >=2.7.1 且 ==2.7.*
        t = parse(target)
        return match_one(version, ">=" + target) and v[: len(t) - 1] == t[:-1]
    a, b = pad(v, parse(target))
    return {"==": a == b, "!=": a != b, ">=": a >= b, "<=": a <= b, ">": a > b, "<": a < b}[op]

def matches(version: str, specifier: str) -> bool:
    return all(match_one(version, s.strip()) for s in specifier.split(","))

versions = ["2.6.9", "2.7.0", "2.7.1", "2.7.9", "2.8.0", "2.12.0", "3.0.0"]
for spec in (">=2.7", ">=2.7,<3", "~=2.7", "~=2.7.1", "==2.7.*"):
    ok = [v for v in versions if matches(v, spec)]
    print(f"{spec:10} → {ok}，解析時會挑 {max(ok, key=parse) if ok else '（無解）'}")
```

### 沒有 lock 時，同一份 pyproject 會解出不同結果

```python run
import tomllib

PYPROJECT = """
[project]
name = "api"
requires-python = ">=3.12"
dependencies = ["webkit>=1.2"]
"""

# 套件索引在兩個時間點的樣子：webkit 依賴 parser，parser 在第 30 天發了 3.0
INDEX_DAY1 = {
    "webkit": {"1.2.0": {"parser": ">=2.0"}, "1.3.0": {"parser": ">=2.1"}},
    "parser": {"2.0.0": {}, "2.1.0": {}, "2.4.0": {}},
}
INDEX_DAY30 = {
    "webkit": INDEX_DAY1["webkit"],
    "parser": {**INDEX_DAY1["parser"], "3.0.0": {}},   # 不相容的大改版
}

def ver(v):
    return tuple(int(x) for x in v.split("."))

def ok(v, spec):
    # 這個示範只用到 >= 規格
    return all(ver(v) >= ver(s.strip()[2:]) for s in spec.split(","))

def resolve(requirements, index):
    """極簡解析器：每個套件挑允許範圍內最新的版本，再遞迴處理它的依賴。"""
    pinned, todo = {}, list(requirements)
    while todo:
        name, spec = todo.pop()
        best = max((v for v in index[name] if ok(v, spec)), key=ver)
        pinned[name] = best
        todo.extend(index[name][best].items())
    return dict(sorted(pinned.items()))

project = tomllib.loads(PYPROJECT)["project"]
reqs = [(d.split(">=")[0], d[len(d.split(">=")[0]):]) for d in project["dependencies"]]

day1 = resolve(reqs, INDEX_DAY1)
day30 = resolve(reqs, INDEX_DAY30)
print("第 1 天解析：", day1)
print("第 30 天解析：", day30, "← parser 被升到 3.0")

# lock 檔：把第 1 天的解析結果與「當時的輸入」一起存下來
lock = {"requirements": list(project["dependencies"]), "packages": day1}
print("有 lock 時第 30 天照 lock 裝：", lock["packages"])

# --locked 的檢查：pyproject 的需求變了，lock 就過期
project["dependencies"].append("httpx>=0.27")
if project["dependencies"] != lock["requirements"]:
    print("uv sync --locked → 失敗：lock 需要更新，請先跑 uv lock 並提交")
```

## 和 pip、Poetry 對照

| 要做的事 | pip + venv | Poetry | uv |
|---|---|---|---|
| 建虛擬環境 | `python -m venv .venv` 再 activate | 自動 | 自動（`.venv`） |
| 記錄直接依賴 | `requirements.txt`（或 pip-tools 的 `requirements.in`） | `pyproject.toml` | `pyproject.toml` |
| 記錄完整解析結果 | `pip freeze`（單一平台）或 pip-tools 編譯出的 `requirements.txt` | `poetry.lock` | `uv.lock`（跨平台） |
| 依 lock 安裝 | `pip install -r requirements.txt` | `poetry install` | `uv sync` |
| 在環境裡執行 | activate 後直接執行 | `poetry run …` | `uv run …` |
| 安裝 Python 本身 | 另外處理（系統套件、pyenv 等） | 依版本而定，常見做法是另外處理 | `uv python install`，或依 `.python-version` 自動下載 |

舊專案搬到 uv：`uv init` 之後 `uv add -r requirements.txt`，再刪掉舊檔。需要給不認得 `uv.lock` 的工具一份 requirements 時，可以用 `uv export --format requirements-txt` 匯出。

## 常見錯誤與錯誤訊息

以下訊息取自 uv 0.8，不同版本措辭可能略有不同。

**lock 過期**（CI 用了 `--locked`）：

```text
The lockfile at `uv.lock` needs to be updated, but `--locked` was provided. To update the lockfile, run `uv lock`.
```

有人改了 `pyproject.toml`（手改，或在另一個分支 `uv add`）卻沒有提交更新後的 `uv.lock`。在本機跑 `uv lock`，把 lock 的差異一起 commit。

**解不出來**：

```text
  × No solution found when resolving dependencies:
  ╰─▶ Because only fastapi<=0.154.0 is available and fastapi==0.154.0 depends
      on pydantic>=2.9.0, we can conclude that fastapi>=0.154.0 depends on
      pydantic>=2.9.0.
      And because your project depends on fastapi>=0.154.0 and pydantic<2, we
      can conclude that your project's requirements are unsatisfiable.
```

（這是在專案已有 `fastapi>=0.154.0` 時執行 `uv add "pydantic<2"` 的實際輸出，版本號依當時的索引而定。）這段要從上往下讀成一條推理鏈：誰依賴誰、範圍在哪裡交集為空。上例是專案同時要求新版 fastapi 與 `pydantic<2`，而新版 fastapi 需要 pydantic 2，兩個條件不可能同時成立。修法是放寬其中一邊的範圍。套件名稱打錯時，同一個標題下會寫 `was not found in the package registry`。

**Python 版本不合**：

```text
error: The Python request from `.python-version` resolved to Python 3.10.20, which is incompatible with the project's Python requirement: `>=3.11` (from `project.requires-python`)
```

`.python-version` 和 `requires-python` 互相矛盾。用 `uv python pin 3.12` 改成相容的版本。

**`ModuleNotFoundError: No module named 'fastapi'`**，但 `uv add` 明明成功了：執行時用的是系統的 `python3`，不是 `.venv` 裡的。改用 `uv run python …`；編輯器也要把直譯器指到 `.venv/bin/python`，不然型別檢查與自動完成會找不到套件。

不會報錯、但會出事的情況：

- **`uv.lock` 合併衝突**：不要手動逐行合併。先接受其中一邊的 `uv.lock`，確認 `pyproject.toml` 已正確合併，再執行 `uv lock` 重新產生。
- **`.venv` 被 commit 進 repo**：裡面的連結指向某台機器的絕對路徑，換一台就壞；而且體積很大。確認 `.gitignore` 有 `.venv/`。
- **在虛擬環境裡 `pip install`**：裝得進去，但 lock 不知道，同事與 CI 都沒有這個套件，下一次 `uv sync` 也會把它移除。

## 動手

1. 到實驗室 [uv 從零到能跑](#/lab/UvLab)，一步步看七個指令讓檔案樹與 `pyproject.toml` 怎麼長出來。
2. 執行「版本規格」那段，把 `versions` 加上 `"2.7.10"`、`"3.0.1"`，預測每個規格會挑哪一版再對答案；特別注意 `~=2.7` 和 `~=2.7.1` 的差別。
3. 執行「沒有 lock 時」那段，在 `INDEX_DAY30` 給 `webkit` 加一個 `"1.4.0": {"parser": ">=3.0"}`，觀察第 30 天的解析結果，想想這時 lock 擋住了哪些變化。
4. 在本機建一個專案，手動在 `pyproject.toml` 加一行依賴、不跑 `uv lock`，直接執行 `uv sync --locked`，看到上面那段錯誤；再跑 `uv lock` 之後 `git diff uv.lock`，看新增了哪些間接依賴。
5. 延伸：CI 怎麼把 `uv sync --locked` 接進管線，見 [CI 管線：lint、test、build](#/skill/ci-pipeline)；依賴本身的安全風險（typosquatting、hash 驗證）見 [依賴與供應鏈安全](#/skill/supply-chain)。

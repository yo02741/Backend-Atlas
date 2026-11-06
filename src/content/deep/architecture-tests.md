## 從一個具體問題開始：規範檔寫得很清楚，service 還是 import 了 handler

專案的規範檔（`CLAUDE.md` 或 `AGENTS.md`）第一段就寫著：

> 分層：handler → service → repository。service 不得 import handler 或 FastAPI；repository 不得呼叫 service。

前三十個 MR 都遵守了。第三十一個 MR，agent 要在 service 裡回傳 404，順手寫了 `from fastapi import HTTPException`；第三十二個 MR 要在 repository 算折扣後的價格，直接 `from app.services.pricing import quote`。兩個 MR 都能跑、測試都綠，reviewer 一次看四十個檔案的 diff，兩行 import 沒被注意到。

三個月後要把 service 拿去給批次任務用，發現它 import 了 FastAPI；想單獨測 repository，發現它會繞回來呼叫 service，形成循環依賴。

規範檔對 agent 是**輸入**，不是**約束**：它讀到了、大多數時候會照做，但沒有任何機制保證每一次都照做，而且違反時沒有任何東西會變紅。這一課把架構規則從文字變成測試：違反就紅燈、合不進去。

## 運作原理：import 就是依賴圖

Python 的模組之間的依賴，幾乎都以 `import` 敘述的形式寫在原始碼裡。把每個模組 import 了誰收集起來，就是一張有向圖；架構規則則是這張圖上的限制。

```text
app.handlers.orders ──▶ app.services.orders ──▶ app.repositories.orders
         ▲                     │   ▲                     │
         └──── 違規（往上）─────┘   └──── 違規（往上）────┘
```

常見的三類規則：

| 規則類型 | 意思 | 例子 |
|---|---|---|
| 分層（layers） | 上層可以依賴下層，下層不能依賴上層 | handler → service → repository；repository 不得 import service |
| 禁用依賴（forbidden） | 某些模組不得 import 某些模組或套件 | `app.services` 不得 import `fastapi`、`sqlalchemy` |
| 獨立（independence） | 幾個模組彼此不得互相 import | `app.orders` 與 `app.billing` 之間只能透過 `app.shared` 的介面溝通 |

檢查這些規則**不需要執行程式**：用標準函式庫的 `ast` 解析原始碼，找出 `Import` 與 `ImportFrom` 節點即可。這也代表檢查很快，可以放在 pre-commit 與每一次 CI。

用 `ast` 而不是用 regex 掃 `import` 字串的理由：多行的 `from x import (a, b)`、寫在函式裡的 import、字串或註解裡出現的 `import` 字樣，`ast` 都能正確處理。它抓不到的是動態載入（`importlib.import_module(name)`、`__import__`）——這類寫法本身就值得另外用 lint 禁止。

## 實際程式：用 ast 檢查分層

下面模擬一個小專案（檔名對應原始碼），解析每個檔案的 import，依照分層與禁用規則找出違規：

```python run
import ast

# ── 模擬一個專案：檔名 -> 原始碼（真實專案會用 pathlib 讀檔） ──
FILES = {
    "app/handlers/orders.py": """
from fastapi import APIRouter
from app.services.orders import place_order
""",
    "app/services/orders.py": """
from app.repositories.orders import OrderRepository
from app.handlers.orders import router        # 反向依賴：service 不該知道 handler
from fastapi import HTTPException              # 領域層 import 框架
""",
    "app/repositories/orders.py": """
import sqlalchemy
from app.services.pricing import quote        # repository 往上呼叫 service
""",
    "app/services/pricing.py": """
from decimal import Decimal

def quote(items):
    import fastapi                             # 藏在函式裡的 import 也抓得到
    return sum(Decimal(i) for i in items)
""",
}

# ── 規則：由上往下排的分層，只能 import 自己或更下層；加上領域層禁用的套件 ──
LAYERS = ["app.handlers", "app.services", "app.repositories"]
FORBIDDEN = {"app.services": ["fastapi", "sqlalchemy"], "app.repositories": ["fastapi"]}

def module_name(path):
    return path[:-3].replace("/", ".")

def imports_of(source):
    """用 ast 取出所有 import 的模組名（不執行程式碼）"""
    names = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):              # import a.b, c
            names += [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:   # from a.b import c（略過相對 import）
            names.append(node.module)
    return names

def layer_of(module):
    for i, prefix in enumerate(LAYERS):
        if module == prefix or module.startswith(prefix + "."):
            return i
    return None                        # 標準函式庫、第三方套件：不在分層裡

violations = []
for path, source in FILES.items():
    src = module_name(path)
    src_layer = layer_of(src)
    for imp in imports_of(source):
        dst_layer = layer_of(imp)
        if dst_layer is not None and dst_layer < src_layer:
            violations.append(f"{src} -> {imp}: {LAYERS[src_layer]} may not import {LAYERS[dst_layer]} (upward)")
        for prefix, banned in FORBIDDEN.items():
            if src_layer == LAYERS.index(prefix) and imp.split(".")[0] in banned:
                violations.append(f"{src} -> {imp}: forbidden in {prefix}")

for v in violations:
    print("VIOLATION", v)
print(f"{len(violations)} violation(s)")
# 放進 pytest 時最後一行寫 assert not violations，違規就紅燈；這裡只印出結果
print("architecture test:", "FAILED" if violations else "passed")
```

幾個值得注意的地方：

- `layer_of` 用「等於前綴」或「以前綴加 `.` 開頭」判斷，少了 `.` 會把 `app.servicesx` 誤判成 `app.services`。
- 標準函式庫與第三方套件不屬於任何層（`layer_of` 回傳 `None`），只受禁用規則限制。
- `quote` 函式裡那行 `import fastapi` 也被抓到：`ast.walk` 走過整棵樹，不只最上層。
- 相對 import（`from . import x`，`node.level > 0`）這裡直接略過；真實的檢查器要把它換算成絕對模組名。

把它包成 pytest 測試只要最後一行改成 `assert not violations`，CI 就會在違規時失敗，並印出哪個模組 import 了什麼。

## 用現成工具：import-linter

自己寫的檢查器適合理解原理；專案裡用現成工具比較省事。Python 的 **import-linter** 讀設定檔裡的 contract，用 `lint-imports` 指令檢查。它的幾個特點：

- contract 類型包含 `layers`、`forbidden`、`independence` 等，對應上一節的三類規則。
- 它會建出整個套件的 import 圖，**間接的依賴鏈**也會檢查：repository 透過 `app.common.x` 再 import service，同樣會被回報，並列出整條鏈。
- 要檢查第三方套件（例如禁止 import `fastapi`）時，需要在設定裡打開 `include_external_packages`。

設定示意（寫在 `pyproject.toml`；欄位以所用版本的文件為準，不能在瀏覽器執行）：

```toml
[tool.importlinter]
root_package = "app"
include_external_packages = true

[[tool.importlinter.contracts]]
name = "分層：handler → service → repository"
type = "layers"
layers = [
    "app.handlers",
    "app.services",
    "app.repositories",
]

[[tool.importlinter.contracts]]
name = "領域層不依賴框架與 ORM"
type = "forbidden"
source_modules = ["app.services"]
forbidden_modules = ["fastapi", "sqlalchemy"]

[[tool.importlinter.contracts]]
name = "訂單與帳務彼此獨立"
type = "independence"
modules = ["app.orders", "app.billing"]
```

```bash
uv add --dev import-linter
uv run lint-imports        # 有 contract 被違反就以非零結束碼結束，CI 因此失敗
```

其他語言的對應工具：Java 的 ArchUnit 用 JUnit 測試寫規則（例如「`..service..` 套件的類別不得依賴 `..controller..`」），JavaScript / TypeScript 的 dependency-cruiser 用設定檔描述禁止的依賴。共通點是：**規則放在 repo 裡、跑在 CI、違反就失敗**。

### 規則寫在哪一層

| 放在哪裡 | 違反時會發生什麼 | 適合的規則 |
|---|---|---|
| 規範檔（給 agent 讀） | 不會發生任何事 | 意圖與理由：為什麼要分層、例外怎麼申請 |
| 架構測試 / import-linter | CI 紅燈，不能合併 | 能機械判定的依賴方向、禁用套件、模組獨立 |
| code review | 看 reviewer 有沒有注意到 | 判定不了的設計問題：抽象是否恰當、命名 |

規範檔還是要寫，但寫的是「為什麼」與「遇到需要例外時先停下來提出」；能機械判定的部分一律搬到測試。agent 撞到架構測試紅燈時，錯誤訊息本身就是最直接的回饋，它通常能自己修正。

### 例外怎麼處理

總會有合理的例外，例如啟動程式（`app.main`）需要同時 import 每一層。處理方式：

- 啟動與組裝的模組不放進任何一層，讓它不受分層限制。
- 真的要對某條依賴開例外時，在設定裡**逐條列出**（import-linter 的 contract 支援忽略特定 import 的設定），並在 PR 說明理由。不要整條 contract 關掉。
- 驗收清單裡加一條「不得修改架構 contract」，改 contract 需要人核准（見 [驗收設計](#/skill/acceptance-design)）。

## 架構圖也由程式碼產生：C4 與 Structurizr

架構測試守住的是依賴方向；另一個常跟程式脫節的是**架構圖**。畫在繪圖工具裡的圖，三個月後就沒人敢信。

**C4 模型**把架構圖分成四個縮放層級：

| 層級 | 回答的問題 | 掛號系統的例子 |
|---|---|---|
| System Context | 系統和誰互動 | 病患、醫師、掛號系統、簡訊服務 |
| Container | 系統由哪些可部署的單元組成 | API（FastAPI）、資料庫（PostgreSQL）、背景工作 |
| Component | 一個 container 裡有哪些主要元件 | handlers、services、repositories |
| Code | 元件內部的類別與函式 | 通常不畫，由 IDE 或程式碼本身提供 |

**Structurizr DSL** 用文字描述 C4 模型（人、系統、container、component 與它們的關係），再由工具產生各層級的圖。「模型」只寫一次，「視圖」（view）從模型裡挑出要畫的部分，所以 Context 圖與 Container 圖不會互相矛盾。示意片段（不能在瀏覽器執行）：

```text
workspace "掛號系統" {
    model {
        patient = person "病患"
        clinic = softwareSystem "掛號系統" {
            api = container "API" "掛號與取消" "FastAPI" {
                handlers = component "Handlers" "HTTP 轉換"
                services = component "Services" "業務規則"
                repos = component "Repositories" "資料存取"
            }
            db = container "Database" "掛號資料" "PostgreSQL"
        }
        patient -> api "預約、取消掛號" "HTTPS"
        handlers -> services "呼叫"
        services -> repos "透過介面呼叫"
        repos -> db "讀寫" "SQL"
    }
    views {
        container clinic {
            include *
            autolayout lr
        }
        component api {
            include *
            autolayout lr
        }
    }
}
```

這份檔案放在 repo 裡（例如 `docs/architecture/workspace.dsl`），和程式碼一起 review。和架構測試搭配時有兩種做法：

- **圖描述意圖、測試守住意圖**：DSL 裡的 component 關係（handlers → services → repos）與 import-linter 的 `layers` 是同一份規則的兩種表達。改分層時兩邊一起改，review 時對照。
- **從程式產生模型**：用腳本掃描 import 圖，產生 DSL 的 component 與關係，再交給 Structurizr 渲染。這樣圖永遠跟程式一致，但也會忠實畫出違規的依賴——這正好是發現問題的方式。

## 常見錯誤與錯誤訊息

| 現象 | 原因 | 處理 |
|---|---|---|
| `lint-imports` 回報 contract BROKEN，列出一條 `app.repositories.x -> app.common.y -> app.services.z` 的鏈 | 間接依賴：透過共用模組繞回上層 | 找出鏈上不該存在的那一段；常見是共用模組 import 了某一層的東西 |
| forbidden contract 列了 `fastapi`，`lint-imports` 報設定錯誤或規則沒有生效（行為依版本而定） | 沒有打開檢查外部套件的設定 | 頂層設定 `include_external_packages = true` |
| 自寫檢查器把 `app.servicesx` 當成 `app.services` | 只用 `startswith(prefix)` | 改成 `== prefix` 或 `startswith(prefix + ".")` |
| 檢查器漏掉 `from . import repo` | 相對 import 的 `module` 可能是 `None`，`level` 大於 0 | 依照檔案所在套件換算成絕對名稱 |
| 架構測試全綠，但執行時還是出現循環 import | 依賴藏在 `importlib.import_module` 這類動態載入 | 用 lint 禁止動態 import，或把它限制在組裝層 |
| agent 遇到紅燈後把 contract 刪掉 | contract 沒有保護 | contract 檔案列入 CODEOWNERS；驗收清單加禁止條款 |
| `ImportError: cannot import name 'x' from partially initialized module` | 真的發生了循環 import | 畫出兩個模組的依賴，把共用的部分抽到更下層 |

## 動手

1. 在 Playground 執行上面的檢查器，把 `app/services/orders.py` 的 `from app.handlers.orders import router` 刪掉，看違規數變化。
2. 在 `FORBIDDEN` 加一條 `"app.repositories": ["fastapi", "httpx"]`，再在 repository 加一行 `import httpx`，確認被抓到。
3. 加一個 `app/common/ids.py`，讓它 import `app.services.orders`，再讓 repository import `app.common.ids`。目前的檢查器抓得到這條間接依賴嗎？想想要怎麼改（提示：從 import 圖做遞迴搜尋）。
4. 做程式題 `architecture-tests-1`：實作 `check_layers(modules, rules)`。
5. 延伸：分層本身怎麼設計，見 [專案分層與依賴注入](#/skill/project-layering)；架構決策怎麼記錄，見 [ADR](#/skill/ai-adr)。

// 程式題：語言與工程實踐（Python 在瀏覽器裡執行）
export default [
  {
    id: 'python-backend-1', skill: 'python-backend', kind: 'python', level: 1,
    title: '把 dict 轉成有型別的 User',
    prompt: '實作 `parse_user(data: dict) -> User`：\n\n- `id` 要轉成 int（可能是字串 `"42"`），轉不了就 `raise ValueError`\n- `name` 必填，缺少就 `raise ValueError`\n- `email` 選填，沒有就是 `None`\n- 多餘的 key 忽略',
    starter: `from dataclasses import dataclass


@dataclass
class User:
    id: int
    name: str
    email: str | None = None


def parse_user(data: dict) -> User:
    # TODO
    return User(id=data["id"], name=data["name"])


print(parse_user({"id": "42", "name": "Alice", "extra": True}))
`,
    solution: `from dataclasses import dataclass


@dataclass
class User:
    id: int
    name: str
    email: str | None = None


def parse_user(data: dict) -> User:
    if "name" not in data or not isinstance(data["name"], str):
        raise ValueError("name is required")
    try:
        user_id = int(data["id"])
    except (KeyError, TypeError, ValueError) as e:
        raise ValueError("id must be an integer") from e
    return User(id=user_id, name=data["name"], email=data.get("email"))


print(parse_user({"id": "42", "name": "Alice", "extra": True}))
`,
    tests: [
      { name: '字串 id 轉成 int、多餘 key 忽略', code: `_u = parse_user({"id": "42", "name": "Alice", "extra": True})\nassert _u == User(id=42, name="Alice", email=None), _u` },
      { name: 'email 選填', code: `assert parse_user({"id": 1, "name": "Bob", "email": "b@x.io"}).email == "b@x.io"` },
      { name: '缺 name 要 raise ValueError', code: `try:\n    parse_user({"id": 1})\n    raise AssertionError("沒有 raise")\nexcept ValueError:\n    pass` },
      { name: 'id 不是數字要 raise ValueError', code: `try:\n    parse_user({"id": "abc", "name": "x"})\n    raise AssertionError("沒有 raise")\nexcept ValueError:\n    pass` },
    ],
    hints: ['int("abc") 會丟 ValueError，可以直接 try/except 再包成你自己的錯誤訊息。', 'data.get("email") 在 key 不存在時回 None。'],
  },
  {
    id: 'python-backend-2', skill: 'python-backend', kind: 'python', level: 1,
    title: '可變預設參數的陷阱',
    prompt: '`add_item` 用 `items=[]` 當預設值，結果每次呼叫都共用同一個 list。修正它：不給 `items` 時每次都要是新的 list；有給的話就在那個 list 上加。',
    starter: `def add_item(item, items=[]):
    items.append(item)
    return items


print(add_item(1))
print(add_item(2))   # 預期 [2]，但現在印出 [1, 2]
`,
    solution: `def add_item(item, items=None):
    if items is None:
        items = []
    items.append(item)
    return items


print(add_item(1))
print(add_item(2))
`,
    tests: [
      { name: '兩次呼叫互不影響', code: `_a = add_item(1)\n_b = add_item(2)\nassert _a == [1] and _b == [2], (_a, _b)` },
      { name: '有給 list 時加在那個 list 上', code: `_l = [9]\nassert add_item(3, _l) == [9, 3] and _l == [9, 3]` },
    ],
    hints: ['預設值只在「函式定義時」建立一次，之後每次呼叫都是同一個物件。', '慣用寫法：預設 None，函式內 if items is None: items = []。'],
  },
  {
    id: 'python-async-1', skill: 'python-async', kind: 'python', level: 2,
    title: '讓五個 I/O 一起等',
    prompt: '`fetch_all` 現在一個接一個 `await`，5 個各 0.2 秒的請求要等 1 秒。改成**同時**發出、一起等，總時間應接近 0.2 秒，回傳順序要跟 `ids` 一致。',
    starter: `import asyncio


async def fetch(i: int) -> dict:
    await asyncio.sleep(0.2)  # 模擬 200ms 的 DB / 外部 API 等待
    return {"id": i}


async def fetch_all(ids: list[int]) -> list[dict]:
    results = []
    for i in ids:
        results.append(await fetch(i))   # TODO: 這樣是序列執行
    return results


import time
t0 = time.time()
print(await fetch_all([1, 2, 3, 4, 5]))
print(f"{time.time() - t0:.2f} 秒")
`,
    solution: `import asyncio


async def fetch(i: int) -> dict:
    await asyncio.sleep(0.2)
    return {"id": i}


async def fetch_all(ids: list[int]) -> list[dict]:
    return list(await asyncio.gather(*(fetch(i) for i in ids)))


import time
t0 = time.time()
print(await fetch_all([1, 2, 3, 4, 5]))
print(f"{time.time() - t0:.2f} 秒")
`,
    tests: [
      { name: '結果與順序正確', code: `_r = await fetch_all([3, 1, 2])\nassert _r == [{"id": 3}, {"id": 1}, {"id": 2}], _r` },
      { name: '5 個請求總時間 < 0.6 秒（要同時等）', code: `import time as _t\n_t0 = _t.time()\nawait fetch_all([1, 2, 3, 4, 5])\n_dt = _t.time() - _t0\nassert _dt < 0.6, f"花了 {_dt:.2f} 秒——還是一個接一個"` },
    ],
    hints: ['asyncio.gather(*coroutines) 會同時排程所有協程，等全部完成後依原順序回傳結果。', '先建立所有 coroutine（還沒 await），再一次交給 gather。'],
  },
  {
    id: 'logging-config-1', skill: 'logging-config', kind: 'python', level: 2,
    title: '從環境變數讀設定並驗證',
    prompt: '實作 `load_settings(env: dict) -> Settings`（`env` 模擬 `os.environ`）：\n\n- `DATABASE_URL` 必填，缺少就 `raise ValueError`\n- `PORT` 轉 int，預設 8000\n- `DEBUG` 接受 `"1"`、`"true"`、`"yes"`（不分大小寫）為 True，其餘或缺少為 False\n\n啟動時就把設定驗完，不要等第一個請求才炸。',
    starter: `from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str
    port: int = 8000
    debug: bool = False


def load_settings(env: dict) -> Settings:
    # TODO
    return Settings(database_url=env["DATABASE_URL"])


print(load_settings({"DATABASE_URL": "postgresql://app@db/app", "PORT": "9000", "DEBUG": "true"}))
`,
    solution: `from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str
    port: int = 8000
    debug: bool = False


def load_settings(env: dict) -> Settings:
    url = env.get("DATABASE_URL")
    if not url:
        raise ValueError("DATABASE_URL is required")
    try:
        port = int(env.get("PORT", 8000))
    except ValueError as e:
        raise ValueError("PORT must be an integer") from e
    debug = str(env.get("DEBUG", "")).strip().lower() in {"1", "true", "yes"}
    return Settings(database_url=url, port=port, debug=debug)


print(load_settings({"DATABASE_URL": "postgresql://app@db/app", "PORT": "9000", "DEBUG": "true"}))
`,
    tests: [
      { name: '完整設定', code: `_s = load_settings({"DATABASE_URL": "postgresql://x", "PORT": "9000", "DEBUG": "TRUE"})\nassert _s == Settings("postgresql://x", 9000, True), _s` },
      { name: '預設值', code: `_s = load_settings({"DATABASE_URL": "postgresql://x"})\nassert _s.port == 8000 and _s.debug is False` },
      { name: 'DEBUG 其他值為 False', code: `assert load_settings({"DATABASE_URL": "u", "DEBUG": "false"}).debug is False\nassert load_settings({"DATABASE_URL": "u", "DEBUG": "0"}).debug is False` },
      { name: '缺 DATABASE_URL 要 raise ValueError', code: `try:\n    load_settings({"PORT": "1"})\n    raise AssertionError("沒有 raise")\nexcept ValueError:\n    pass` },
    ],
    hints: ['env.get(key, default) 處理缺少的情況。', 'DEBUG 的判斷：str(value).lower() in {"1", "true", "yes"}。'],
  },
  {
    id: 'uv-packaging-1', skill: 'uv-packaging', kind: 'python', level: 1,
    title: '讀懂 pyproject.toml 的依賴',
    prompt: '實作 `summarize(text: str) -> dict`：用標準函式庫 `tomllib` 解析 pyproject.toml 內容，回傳\n\n- `name`、`requires_python`：`[project]` 的 `name` 與 `requires-python`（沒有就是 `None`）\n- `dependencies`：`[project].dependencies` 裡每個套件的**名稱**（沒有這個 key 就是空 list）\n- `dev`：`[dependency-groups].dev` 裡的套件名稱；沒有就是空 list；裡面的 `{include-group = "..."}` 表格略過\n\n需求字串可能長這樣：`"fastapi[standard]>=0.115"`、`"httpx (>=0.27)"`、`"uvicorn ; sys_platform != \'win32\'"`、`"ruff"`。名稱要依 PEP 503 正規化：轉小寫，連續的 `-`、`_`、`.` 換成一個 `-`（`Pydantic_Settings` → `pydantic-settings`）。TOML 格式錯誤時讓 `tomllib.TOMLDecodeError` 直接丟出。',
    starter: `import tomllib


def summarize(text: str) -> dict:
    data = tomllib.loads(text)
    project = data["project"]
    # TODO：名稱要去掉 extras、版本、環境標記並正規化；還要讀 dev 群組
    deps = [r.split(">=")[0] for r in project["dependencies"]]
    return {
        "name": project["name"],
        "requires_python": project["requires-python"],
        "dependencies": deps,
        "dev": [],
    }


SAMPLE = """
[project]
name = "shop-api"
requires-python = ">=3.12"
dependencies = ["fastapi[standard]>=0.115", "Pydantic_Settings>=2.4", "httpx (>=0.27)"]

[dependency-groups]
dev = ["pytest>=8", "ruff"]
"""
print(summarize(SAMPLE))
`,
    solution: `import re
import tomllib

# 名稱是需求字串開頭的英數與 . _ -；後面的 [extras]、版本、; 標記都不是名稱
_NAME = re.compile(r"\\s*([A-Za-z0-9][A-Za-z0-9._-]*)")


def package_name(requirement: str) -> str:
    m = _NAME.match(requirement)
    if not m:
        raise ValueError(f"看不懂的需求字串：{requirement!r}")
    return re.sub(r"[-_.]+", "-", m.group(1)).lower()   # PEP 503 正規化


def summarize(text: str) -> dict:
    data = tomllib.loads(text)
    project = data.get("project", {})
    dev = data.get("dependency-groups", {}).get("dev", [])
    return {
        "name": project.get("name"),
        "requires_python": project.get("requires-python"),
        "dependencies": [package_name(r) for r in project.get("dependencies", [])],
        "dev": [package_name(r) for r in dev if isinstance(r, str)],   # 略過 include-group 表格
    }


SAMPLE = """
[project]
name = "shop-api"
requires-python = ">=3.12"
dependencies = ["fastapi[standard]>=0.115", "Pydantic_Settings>=2.4", "httpx (>=0.27)"]

[dependency-groups]
dev = ["pytest>=8", "ruff"]
"""
print(summarize(SAMPLE))
`,
    tests: [
      { name: '完整的 pyproject.toml', code: `_r = summarize('''
[project]
name = "shop-api"
requires-python = ">=3.12"
dependencies = [
  "fastapi[standard]>=0.115",
  "Pydantic_Settings>=2.4",
  "httpx (>=0.27)",
  "uvicorn ; sys_platform != 'win32'",
]

[dependency-groups]
dev = ["pytest>=8,<9", "Ruff"]
''')
assert _r == {"name": "shop-api", "requires_python": ">=3.12", "dependencies": ["fastapi", "pydantic-settings", "httpx", "uvicorn"], "dev": ["pytest", "ruff"]}, _r` },
      { name: '名稱正規化：連續的 - _ . 變成一個 -', code: `_r = summarize('[project]\\nname = "x"\\ndependencies = ["Zope.Interface", "typing__extensions>=4", "My-._Pkg==1.0"]\\n')
assert _r["dependencies"] == ["zope-interface", "typing-extensions", "my-pkg"], _r["dependencies"]` },
      { name: '沒有 dev 群組、沒有 requires-python、沒有 dependencies', code: `_r = summarize('[project]\\nname = "tiny"\\n')
assert _r == {"name": "tiny", "requires_python": None, "dependencies": [], "dev": []}, _r` },
      { name: 'dev 裡的 include-group 表格要略過', code: `_r = summarize('''
[project]
name = "x"
dependencies = []

[dependency-groups]
lint = ["ruff"]
dev = ["pytest", {include-group = "lint"}]
''')
assert _r["dev"] == ["pytest"], _r["dev"]` },
      { name: 'TOML 格式錯誤要丟 TOMLDecodeError', code: `import tomllib as _t
try:
    summarize('[project\\nname = "x"')
    raise AssertionError("沒有丟出例外")
except _t.TOMLDecodeError:
    pass` },
    ],
    hints: ['名稱是需求字串開頭那一段英數與 `.`、`_`、`-`；用 `re.match(r"\\s*([A-Za-z0-9][A-Za-z0-9._-]*)", s)` 取出來。', '正規化：`re.sub(r"[-_.]+", "-", name).lower()`。', '缺少的 key 用 `dict.get(key, 預設值)`；`[dependency-groups]` 的 key 有連字號，要寫 `data.get("dependency-groups", {})`。'],
  },
  {
    id: 'web-framework-1', skill: 'web-framework', kind: 'python', level: 1,
    title: '路由比對：path 參數、404 與 405',
    prompt: '實作 `match(routes, method, path) -> tuple[str, dict]`，模擬框架的路由比對。`routes` 是 `(method, template, name)` 的 list：\n\n- template 以 `/` 分段，段數要和 path 一樣；固定段要完全相同\n- `{name}` 符合任何**非空**的一段，值是字串；`{name:int}` 只符合全是數字的一段，值轉成 `int`（Starlette 的 path convertor 寫法）\n- 依 list 順序，**第一個**路徑與方法都符合的勝出，回傳 `(name, params)`\n- 有路徑符合、但方法都不對：`raise MethodNotAllowed(allowed)`，`allowed` 是那些路由方法排序後的 list（真的回應要帶 `Allow` 標頭）\n- 沒有任何路徑符合：`raise NotFound()`',
    starter: `class NotFound(Exception):
    pass


class MethodNotAllowed(Exception):
    def __init__(self, allowed: list[str]):
        super().__init__(f"allowed: {allowed}")
        self.allowed = allowed


ROUTES = [
    ("GET", "/orders/me", "my_orders"),
    ("GET", "/orders/{order_id:int}", "get_order"),
    ("DELETE", "/orders/{order_id:int}", "delete_order"),
    ("GET", "/users/{username}", "get_user"),
]


def match(routes, method: str, path: str) -> tuple[str, dict]:
    # TODO：現在只認得完全相同的路徑，不認得 {參數}，也沒有 405
    for m, template, name in routes:
        if m == method and template == path:
            return name, {}
    raise NotFound()


print(match(ROUTES, "GET", "/orders/me"))
`,
    solution: `class NotFound(Exception):
    pass


class MethodNotAllowed(Exception):
    def __init__(self, allowed: list[str]):
        super().__init__(f"allowed: {allowed}")
        self.allowed = allowed


ROUTES = [
    ("GET", "/orders/me", "my_orders"),
    ("GET", "/orders/{order_id:int}", "get_order"),
    ("DELETE", "/orders/{order_id:int}", "delete_order"),
    ("GET", "/users/{username}", "get_user"),
]


def match_path(template: str, path: str) -> dict | None:
    """路徑符合就回傳參數 dict，不符合回傳 None。"""
    t_parts, p_parts = template.split("/"), path.split("/")
    if len(t_parts) != len(p_parts):
        return None
    params = {}
    for t, p in zip(t_parts, p_parts):
        if t.startswith("{") and t.endswith("}"):
            name, _, conv = t[1:-1].partition(":")
            if p == "":
                return None
            if conv == "int":
                if not p.isdigit():
                    return None
                params[name] = int(p)
            else:
                params[name] = p
        elif t != p:
            return None
    return params


def match(routes, method: str, path: str) -> tuple[str, dict]:
    allowed = set()
    for m, template, name in routes:
        params = match_path(template, path)
        if params is None:
            continue
        if m == method:
            return name, params
        allowed.add(m)
    if allowed:
        raise MethodNotAllowed(sorted(allowed))
    raise NotFound()


print(match(ROUTES, "GET", "/orders/me"))
print(match(ROUTES, "GET", "/orders/42"))
`,
    tests: [
      { name: '固定路徑排在參數路徑前面，先比對到', code: `assert match(ROUTES, "GET", "/orders/me") == ("my_orders", {})` },
      { name: '{order_id:int} 轉成 int', code: `_r = match(ROUTES, "GET", "/orders/42")
assert _r == ("get_order", {"order_id": 42}) and type(_r[1]["order_id"]) is int, _r` },
      { name: '同一路徑不同方法', code: `assert match(ROUTES, "DELETE", "/orders/7") == ("delete_order", {"order_id": 7})` },
      { name: '字串參數', code: `assert match(ROUTES, "GET", "/users/alice") == ("get_user", {"username": "alice"})` },
      { name: '{order_id:int} 不符合非數字 → 404', code: `try:
    match(ROUTES, "GET", "/orders/abc")
    raise AssertionError("應該 raise NotFound")
except NotFound:
    pass` },
      { name: '空的一段不算符合 → 404', code: `for _p in ["/users/", "/nope", "/orders/7/items"]:
    try:
        match(ROUTES, "GET", _p)
        raise AssertionError(f"{_p} 應該 raise NotFound")
    except NotFound:
        pass` },
      { name: '路徑對、方法不對 → 405 並列出允許的方法', code: `try:
    match(ROUTES, "POST", "/orders/7")
    raise AssertionError("應該 raise MethodNotAllowed")
except MethodNotAllowed as _e:
    assert _e.allowed == ["DELETE", "GET"], _e.allowed` },
    ],
    hints: ['`path.split("/")` 會得到 `["", "orders", "42"]`，兩邊段數不同就一定不符合。', '`"order_id:int".partition(":")` 得到 `("order_id", ":", "int")`；沒有冒號時第三個是空字串。', '405 要等**所有**路由都看過才能判斷：一路記下「路徑符合但方法不同」的方法，最後才決定丟 405 還是 404。'],
  },
  {
    id: 'testing-1', skill: 'testing', kind: 'python', level: 2,
    title: '寫出抓得到 bug 的測試',
    prompt: '`apply_discount` 已經寫好，規則：`price` 是整數分且 `>= 0`、`percent` 介於 0–100（含兩端），回傳折扣後金額**向下取整**；不合法就 `raise ValueError`。\n\n你的任務是寫測試：定義幾個 `test_` 開頭的函式（用 `assert`，不能用 pytest）。評分時會先用正確的實作跑你的測試（要全部通過），再把 `apply_discount` 換成幾個**有 bug 的版本**，每個版本都至少要有一個測試失敗。目前只有一個測試，大部分 bug 都抓不到。',
    starter: `def apply_discount(price: int, percent: int) -> int:
    if price < 0 or not 0 <= percent <= 100:
        raise ValueError("price 不可為負，percent 必須在 0–100")
    return price * (100 - percent) // 100


def test_basic():
    assert apply_discount(1000, 10) == 900


# TODO：再寫幾個 test_ 開頭的測試，想想邊界值與「結果不是整數」的情況
`,
    solution: `def apply_discount(price: int, percent: int) -> int:
    if price < 0 or not 0 <= percent <= 100:
        raise ValueError("price 不可為負，percent 必須在 0–100")
    return price * (100 - percent) // 100


def assert_raises_value_error(price, percent):
    try:
        apply_discount(price, percent)
    except ValueError:
        return
    raise AssertionError(f"apply_discount({price}, {percent}) 應該 raise ValueError")


def test_basic():
    assert apply_discount(1000, 10) == 900


def test_boundaries_are_allowed():
    assert apply_discount(1000, 0) == 1000
    assert apply_discount(1000, 100) == 0
    assert apply_discount(0, 50) == 0


def test_rounds_down():
    assert apply_discount(999, 15) == 849      # 849.15 → 849


def test_rejects_invalid_percent():
    assert_raises_value_error(1000, 101)
    assert_raises_value_error(1000, -1)


def test_rejects_negative_price():
    assert_raises_value_error(-1, 10)
`,
    tests: [
      { name: '正確的實作下，你的測試全部通過', code: `_REAL = apply_discount
_mine = [v for k, v in list(globals().items()) if k.startswith("test_") and callable(v)]
assert len(_mine) >= 1, "沒有找到 test_ 開頭的函式"
for _t in _mine:
    _t()

def _killed(mutant):
    """把 apply_discount 換成 mutant，回傳是否至少有一個測試失敗。"""
    globals()["apply_discount"] = mutant
    try:
        for _t in _mine:
            try:
                _t()
            except Exception:
                return True
        return False
    finally:
        globals()["apply_discount"] = _REAL` },
      { name: '抓到 bug：沒檢查 percent 上限', code: `def _m(price, percent):
    if price < 0 or percent < 0:
        raise ValueError("x")
    return price * (100 - percent) // 100
assert _killed(_m), "percent = 101 時這個版本不會報錯，你的測試沒發現"` },
      { name: '抓到 bug：沒檢查負的 price', code: `def _m(price, percent):
    if not 0 <= percent <= 100:
        raise ValueError("x")
    return price * (100 - percent) // 100
assert _killed(_m), "price 為負時這個版本不會報錯，你的測試沒發現"` },
      { name: '抓到 bug：無條件進位', code: `def _m(price, percent):
    if price < 0 or not 0 <= percent <= 100:
        raise ValueError("x")
    return -(-price * (100 - percent) // 100)
assert _killed(_m), "這個版本把 849.15 進位成 850，你的測試沒發現"` },
      { name: '抓到 bug：percent = 100 被拒絕', code: `def _m(price, percent):
    if price < 0 or not 0 <= percent < 100:
        raise ValueError("x")
    return price * (100 - percent) // 100
assert _killed(_m), "這個版本不接受 percent = 100，你的測試沒發現"` },
      { name: '抓到 bug：回傳的是折扣金額', code: `def _m(price, percent):
    if price < 0 or not 0 <= percent <= 100:
        raise ValueError("x")
    return price * percent // 100
assert _killed(_m), "這個版本回傳的是折扣金額而不是折扣後金額"` },
    ],
    hints: ['邊界值最容易藏 bug：0、100、101、-1 都試試看；合法的邊界（0、100）要確認**不會**報錯。', '「結果不是整數」的例子：`apply_discount(999, 15)`，正確答案是 849（849.15 向下取整）。', '測「應該 raise」：`try: apply_discount(1000, 101)` 後面接 `raise AssertionError(...)`，`except ValueError: pass`。'],
  },
  {
    id: 'code-quality-1', skill: 'code-quality', kind: 'python', level: 2,
    title: '用 ast 寫一個 lint 規則',
    prompt: '實作 `lint(source: str) -> list[tuple[int, str]]`，檢查一段 Python 原始碼，回傳 `(行號, 規則代碼)` 並依行號排序：\n\n- `B006`：函式（`def`、`async def`、`lambda`）的參數預設值是可變物件：list / dict / set 的字面值或推導式，或不帶參數的 `list()`、`dict()`、`set()` 呼叫；行號是**預設值**所在的行；keyword-only 參數（`*` 後面的）也要檢查\n- `E722`：沒有指定例外類型的 `except:`；行號是 `except` 所在的行\n\n用 `ast` 解析，不要用字串搜尋：字串或註解裡出現的 `except:` 不算。語法錯誤時讓 `SyntaxError` 直接丟出。（規則代碼與 ruff 的同名規則對應，但判斷範圍比 ruff 簡化。）',
    starter: `def lint(source: str) -> list[tuple[int, str]]:
    # TODO：逐行比對字串會漏掉 {}、空格、多行定義，也會誤判字串裡的內容；改用 ast
    problems = []
    for lineno, line in enumerate(source.splitlines(), start=1):
        if "=[]" in line.replace(" ", ""):
            problems.append((lineno, "B006"))
        if line.strip() == "except:":
            problems.append((lineno, "E722"))
    return problems


print(lint("def add(item, items=[]):\\n    return items\\n"))
`,
    solution: `import ast

_MUTABLE_LITERALS = (ast.List, ast.Dict, ast.Set, ast.ListComp, ast.DictComp, ast.SetComp)


def is_mutable(node: ast.expr) -> bool:
    if isinstance(node, _MUTABLE_LITERALS):
        return True
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id in {"list", "dict", "set"}
        and not node.args
        and not node.keywords
    )


def lint(source: str) -> list[tuple[int, str]]:
    problems = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            # kw_defaults 對沒有預設值的 keyword-only 參數放 None
            defaults = node.args.defaults + [d for d in node.args.kw_defaults if d is not None]
            problems += [(d.lineno, "B006") for d in defaults if is_mutable(d)]
        elif isinstance(node, ast.ExceptHandler) and node.type is None:
            problems.append((node.lineno, "E722"))
    return sorted(problems)


print(lint("def add(item, items=[]):\\n    return items\\n"))
`,
    tests: [
      { name: 'list 與 dict 預設值', code: `_src = '''def a(x, items = []):
    pass

def b(opts={}):
    pass
'''
assert lint(_src) == [(1, "B006"), (4, "B006")], lint(_src)` },
      { name: 'keyword-only、async、lambda、set()、推導式', code: `_src = '''async def a(*, cache=set()):
    pass

f = lambda x, seen={1, 2}: x

def c(rows=[r for r in range(3)]):
    pass
'''
assert lint(_src) == [(1, "B006"), (4, "B006"), (6, "B006")], lint(_src)` },
      { name: '不可變的預設值不報', code: `_src = '''def ok(a=None, b=(), c=0, d="x", e=frozenset(), f=list("ab")):
    pass
'''
assert lint(_src) == [], lint(_src)` },
      { name: '多行定義：行號是預設值所在的行', code: `_src = '''def create(
    name,
    tags={},
):
    pass
'''
assert lint(_src) == [(3, "B006")], lint(_src)` },
      { name: '裸 except 報 E722，有指定型別的不報', code: `_src = '''try:
    pass
except ValueError:
    pass
except (KeyError, TypeError):
    pass
except:
    pass
'''
assert lint(_src) == [(7, "E722")], lint(_src)` },
      { name: '字串裡的 except: 不算', code: `_src = """HELP = '''
except:
'''
"""
assert lint(_src) == [], lint(_src)` },
      { name: '語法錯誤丟 SyntaxError', code: `try:
    lint("def broken(:\\n")
    raise AssertionError("沒有丟出例外")
except SyntaxError:
    pass` },
    ],
    hints: ['`ast.walk(ast.parse(source))` 會走過所有節點；函式是 `ast.FunctionDef` / `ast.AsyncFunctionDef` / `ast.Lambda`。', '預設值在 `node.args.defaults`（一般參數）與 `node.args.kw_defaults`（keyword-only，沒有預設值的位置是 `None`）。', '裸 except 是 `ast.ExceptHandler` 且 `node.type is None`；每個節點都有 `lineno`。'],
  },
  {
    id: 'data-representation-1', skill: 'data-representation', kind: 'python', level: 1,
    title: '轉成前端能安全解析的 JSON',
    prompt: '實作 `to_json(obj) -> str`，把 API 回應轉成 JSON 字串，規則：\n\n- `datetime`：必須帶時區，否則 `raise ValueError`；一律轉成 UTC，格式 `YYYY-MM-DDTHH:MM:SSZ`（不含微秒）\n- `date`（只有日期，例如生日）：`YYYY-MM-DD`\n- `Decimal`：轉成字串，保留原本的小數位（`Decimal("990.00")` → `"990.00"`）\n- 整數超過 JavaScript 安全範圍（絕對值大於 `2**53 - 1`）：轉成字串；範圍內維持數字\n- `NaN`、`Infinity`：`raise ValueError`\n- dict / list / tuple 裡面的值也要套用同樣規則；中文直接輸出，不要跳脫成 `\\uXXXX`',
    starter: `import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal


def to_json(obj) -> str:
    # TODO：default=str 會把 datetime 變成沒有 Z 的字串、大整數照樣輸出成數字
    return json.dumps(obj, default=str)


TAIPEI = timezone(timedelta(hours=8))
print(to_json({
    "order_id": 2**53 + 1,
    "amount": Decimal("990.00"),
    "created_at": datetime(2026, 10, 20, 9, 30, tzinfo=TAIPEI),
    "customer": "王小明",
}))
`,
    solution: `import json
import math
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

MAX_SAFE = 2**53 - 1


def prepare(v):
    """把值換成 JSON 能安全表達的形式（遞迴處理容器）。"""
    if v is None or isinstance(v, (bool, str)):
        return v
    if isinstance(v, int):
        return v if -MAX_SAFE <= v <= MAX_SAFE else str(v)
    if isinstance(v, float):
        if not math.isfinite(v):
            raise ValueError("NaN / Infinity 不是合法的 JSON")
        return v
    if isinstance(v, datetime):                       # 先判斷 datetime：它是 date 的子類別
        if v.tzinfo is None or v.utcoffset() is None:
            raise ValueError("datetime 必須帶時區")
        return v.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, dict):
        return {str(k): prepare(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [prepare(x) for x in v]
    raise TypeError(f"不支援的型別：{type(v).__name__}")


def to_json(obj) -> str:
    return json.dumps(prepare(obj), ensure_ascii=False, allow_nan=False)


TAIPEI = timezone(timedelta(hours=8))
print(to_json({
    "order_id": 2**53 + 1,
    "amount": Decimal("990.00"),
    "created_at": datetime(2026, 10, 20, 9, 30, tzinfo=TAIPEI),
    "customer": "王小明",
}))
`,
    tests: [
      { name: 'datetime 轉成 UTC 並以 Z 結尾', code: `import json as _j
from datetime import datetime as _dt, timedelta as _td, timezone as _tz
_v = _j.loads(to_json({"t": _dt(2026, 10, 20, 9, 30, 15, 123456, tzinfo=_tz(_td(hours=8)))}))
assert _v == {"t": "2026-10-20T01:30:15Z"}, _v` },
      { name: '沒有時區的 datetime 要 raise ValueError', code: `from datetime import datetime as _dt
try:
    to_json({"t": _dt(2026, 10, 20, 9, 30)})
    raise AssertionError("沒有 raise")
except ValueError:
    pass` },
      { name: 'date 只輸出日期', code: `import json as _j
from datetime import date as _d
assert _j.loads(to_json({"birthday": _d(1990, 5, 1)})) == {"birthday": "1990-05-01"}` },
      { name: 'Decimal 轉成字串、保留小數位', code: `import json as _j
from decimal import Decimal as _D
assert _j.loads(to_json({"amount": _D("990.00"), "fee": _D("0.1")})) == {"amount": "990.00", "fee": "0.1"}` },
      { name: '超過 2**53 - 1 的整數轉字串（包括 list 裡的）', code: `import json as _j
_v = _j.loads(to_json({"id": 2**53 + 1, "ok_id": 2**53 - 1, "ids": [1, -(2**53 + 5)], "n": 42}))
assert _v == {"id": "9007199254740993", "ok_id": 9007199254740991, "ids": [1, "-9007199254740997"], "n": 42}, _v` },
      { name: 'bool 與 None 維持原樣', code: `import json as _j
_v = _j.loads(to_json({"paid": True, "note": None, "tags": ("a", "b")}))
assert _v == {"paid": True, "note": None, "tags": ["a", "b"]} and _v["paid"] is True, _v` },
      { name: 'NaN 要 raise ValueError', code: `try:
    to_json({"x": float("nan")})
    raise AssertionError("沒有 raise")
except ValueError:
    pass` },
      { name: '中文直接輸出', code: `assert "王小明" in to_json({"name": "王小明"}), to_json({"name": "王小明"})` },
    ],
    hints: ['json.dumps 的 `default` 只會在遇到「不認得的型別」時呼叫，int 永遠不會經過它；大整數要在 dumps 之前自己走一遍資料結構。', '`datetime` 是 `date` 的子類別，判斷順序要先 datetime 再 date；`bool` 也是 `int` 的子類別。', '`json.dumps(..., ensure_ascii=False, allow_nan=False)`；UTC 格式：`v.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")`。'],
  },
  {
    id: 'error-design-1', skill: 'error-design', kind: 'python', level: 2,
    title: '把例外轉成 Problem Details',
    prompt: '實作 `to_problem(exc, path, request_id) -> tuple[int, dict, dict]`，回傳 `(狀態碼, 標頭, 內容)`：\n\n- `AppError` 與它的子類別：狀態碼取 `exc.status`；內容有 `type`（`"https://example.com/problems/" + exc.code`）、`title`、`status`、`instance`（= `path`）、`code`、`request_id`；`exc.detail` 不是 `None` 才放 `detail`；`ValidationFailed` 另外放 `errors`\n- **其他任何例外**都是 bug：回 500，`code` 為 `internal_error`、`title` 為 `伺服器發生錯誤`，內容不能出現原本的例外訊息或例外類別名稱\n- 標頭：`Content-Type: application/problem+json`、`X-Request-ID: <request_id>`',
    starter: `class AppError(Exception):
    status = 500
    code = "internal_error"
    title = "伺服器發生錯誤"

    def __init__(self, detail: str | None = None):
        super().__init__(detail or self.title)
        self.detail = detail


class NotFound(AppError):
    status, code, title = 404, "not_found", "找不到資源"


class Conflict(AppError):
    status, code, title = 409, "conflict", "與目前狀態衝突"


class EmailTaken(Conflict):
    code, title = "email_taken", "Email 已被註冊"


class ValidationFailed(AppError):
    status, code, title = 422, "validation_failed", "輸入資料不正確"

    def __init__(self, errors: list[dict]):
        super().__init__(None)
        self.errors = errors


def to_problem(exc: Exception, path: str, request_id: str) -> tuple[int, dict, dict]:
    # TODO：現在每種錯誤都回 400，還把例外原文直接回給使用者
    return 400, {"Content-Type": "application/json"}, {"error": str(exc)}


print(to_problem(EmailTaken("這個 Email 已經註冊過"), "/users", "req-1"))
`,
    solution: `class AppError(Exception):
    status = 500
    code = "internal_error"
    title = "伺服器發生錯誤"

    def __init__(self, detail: str | None = None):
        super().__init__(detail or self.title)
        self.detail = detail


class NotFound(AppError):
    status, code, title = 404, "not_found", "找不到資源"


class Conflict(AppError):
    status, code, title = 409, "conflict", "與目前狀態衝突"


class EmailTaken(Conflict):
    code, title = "email_taken", "Email 已被註冊"


class ValidationFailed(AppError):
    status, code, title = 422, "validation_failed", "輸入資料不正確"

    def __init__(self, errors: list[dict]):
        super().__init__(None)
        self.errors = errors


PROBLEM_BASE = "https://example.com/problems/"


def to_problem(exc: Exception, path: str, request_id: str) -> tuple[int, dict, dict]:
    if not isinstance(exc, AppError):
        exc = AppError("請稍後再試；回報問題時請附上 request_id")   # bug：原本的訊息一個字都不回
    body = {"type": PROBLEM_BASE + exc.code, "title": exc.title, "status": exc.status}
    if exc.detail is not None:
        body["detail"] = exc.detail
    body.update({"instance": path, "code": exc.code, "request_id": request_id})
    if isinstance(exc, ValidationFailed):
        body["errors"] = exc.errors
    headers = {"Content-Type": "application/problem+json", "X-Request-ID": request_id}
    return exc.status, headers, body


print(to_problem(EmailTaken("這個 Email 已經註冊過"), "/users", "req-1"))
`,
    tests: [
      { name: 'NotFound → 404 的 Problem Details', code: `_s, _h, _b = to_problem(NotFound("訂單 7 不存在"), "/orders/7", "r1")
assert _s == 404, _s
assert _b == {"type": "https://example.com/problems/not_found", "title": "找不到資源", "status": 404, "detail": "訂單 7 不存在", "instance": "/orders/7", "code": "not_found", "request_id": "r1"}, _b` },
      { name: '子類別 EmailTaken 用自己的代碼與標題、繼承 409', code: `_s, _h, _b = to_problem(EmailTaken(), "/users", "r2")
assert _s == 409 and _b["status"] == 409, (_s, _b)
assert _b["code"] == "email_taken" and _b["title"] == "Email 已被註冊", _b
assert _b["type"].endswith("/email_taken"), _b["type"]
assert "detail" not in _b, "detail 是 None 時不要放"` },
      { name: 'ValidationFailed 帶 errors 擴充欄位', code: `_errs = [{"pointer": "#/email", "detail": "格式不正確"}]
_s, _h, _b = to_problem(ValidationFailed(_errs), "/users", "r3")
assert _s == 422 and _b["errors"] == _errs and _b["code"] == "validation_failed", _b` },
      { name: '未預期的例外 → 500，不外洩內部訊息', code: `import json as _j
_s, _h, _b = to_problem(KeyError("users_pkey on db-primary-01"), "/plans/x", "r4")
assert _s == 500 and _b["status"] == 500 and _b["code"] == "internal_error", (_s, _b)
assert _b["title"] == "伺服器發生錯誤", _b
_txt = _j.dumps(_b, ensure_ascii=False)
assert "users_pkey" not in _txt and "KeyError" not in _txt, "回應內容外洩了例外訊息：" + _txt
assert _b["request_id"] == "r4"` },
      { name: '標頭：problem+json 與 request id', code: `for _exc in (NotFound(), RuntimeError("boom")):
    _s, _h, _b = to_problem(_exc, "/x", "abc123")
    assert _h.get("Content-Type") == "application/problem+json", _h
    assert _h.get("X-Request-ID") == "abc123", _h` },
    ],
    hints: ['先處理「不是 AppError」的情況：換成一個通用的 `AppError(...)`，之後兩種情況就能用同一段程式組內容。', '子類別會繼承或覆寫 `status`、`code`、`title` 這些類別屬性，直接讀 `exc.status` 就好，不用 if 判斷每一種類別。', '不要用 `str(exc)` 或 `type(exc).__name__` 組任何回應內容。'],
  },
  {
    id: 'project-layering-1', skill: 'project-layering', kind: 'python', level: 2,
    title: '依賴注入的註冊 service',
    prompt: '完成三個類別：\n\n1. `InMemoryUserRepository`：符合 `UserRepository` Protocol；`add` 依序配發 id（從 1 開始）並回傳 `User`；`get_by_email` 找不到回 `None`\n2. `FakeMailer`：符合 `Mailer` Protocol；`send` 只把 `(to, subject)` 記到 `self.sent`（list）\n3. `UserService(repo, mailer)`：依賴**從建構子傳入**，不在裡面自己建立。`register(email, name)`：email 先 `strip()` 再轉小寫；已存在就 `raise EmailTaken`（且不寄信）；否則用 `repo.add(email, name.strip())` 建立，再寄出主旨為 `"歡迎加入"` 的信給該 email，回傳 `User`',
    starter: `from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class User:
    id: int
    email: str
    name: str


class EmailTaken(Exception):
    pass


class UserRepository(Protocol):
    def get_by_email(self, email: str) -> User | None: ...
    def add(self, email: str, name: str) -> User: ...


class Mailer(Protocol):
    def send(self, to: str, subject: str) -> None: ...


class InMemoryUserRepository:
    pass   # TODO


class FakeMailer:
    pass   # TODO


class UserService:
    # TODO：依賴寫死在裡面，測試沒辦法換；改成從建構子傳入 repo 與 mailer
    def __init__(self):
        self.repo = InMemoryUserRepository()

    def register(self, email: str, name: str) -> User:
        raise NotImplementedError
`,
    solution: `from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class User:
    id: int
    email: str
    name: str


class EmailTaken(Exception):
    pass


class UserRepository(Protocol):
    def get_by_email(self, email: str) -> User | None: ...
    def add(self, email: str, name: str) -> User: ...


class Mailer(Protocol):
    def send(self, to: str, subject: str) -> None: ...


class InMemoryUserRepository:
    def __init__(self):
        self._by_email: dict[str, User] = {}
        self._next_id = 1

    def get_by_email(self, email: str) -> User | None:
        return self._by_email.get(email)

    def add(self, email: str, name: str) -> User:
        user = User(self._next_id, email, name)
        self._next_id += 1
        self._by_email[email] = user
        return user


class FakeMailer:
    def __init__(self):
        self.sent: list[tuple[str, str]] = []

    def send(self, to: str, subject: str) -> None:
        self.sent.append((to, subject))


class UserService:
    def __init__(self, repo: UserRepository, mailer: Mailer):
        self.repo = repo
        self.mailer = mailer

    def register(self, email: str, name: str) -> User:
        email = email.strip().lower()
        if self.repo.get_by_email(email) is not None:
            raise EmailTaken(email)
        user = self.repo.add(email, name.strip())
        self.mailer.send(user.email, "歡迎加入")
        return user


repo, mailer = InMemoryUserRepository(), FakeMailer()
svc = UserService(repo, mailer)
print(svc.register("  Alice@Example.com ", "Alice"))
print(mailer.sent)
`,
    tests: [
      { name: '記憶體版 repository：id 從 1 依序配發', code: `_r = InMemoryUserRepository()
_a = _r.add("a@x.io", "A")
_b = _r.add("b@x.io", "B")
assert (_a.id, _b.id) == (1, 2), (_a, _b)
assert _r.get_by_email("b@x.io") == _b and _r.get_by_email("nobody@x.io") is None` },
      { name: '註冊：email 正規化、寄出歡迎信', code: `_m = FakeMailer()
_svc = UserService(InMemoryUserRepository(), _m)
_u = _svc.register("  Alice@Example.COM ", " Alice ")
assert _u == User(1, "alice@example.com", "Alice"), _u
assert _m.sent == [("alice@example.com", "歡迎加入")], _m.sent` },
      { name: '重複的 email（大小寫不同）raise EmailTaken，且不再寄信', code: `_m = FakeMailer()
_svc = UserService(InMemoryUserRepository(), _m)
_svc.register("bob@x.io", "Bob")
try:
    _svc.register("BOB@x.io", "Bobby")
    raise AssertionError("沒有 raise EmailTaken")
except EmailTaken:
    pass
assert len(_m.sent) == 1, _m.sent` },
      { name: '用的是注入的 repository（不是自己建立的）', code: `class _AlwaysTaken:
    def get_by_email(self, email):
        return User(99, email, "someone")
    def add(self, email, name):
        raise AssertionError("不應該呼叫 add")
_m = FakeMailer()
try:
    UserService(_AlwaysTaken(), _m).register("new@x.io", "New")
    raise AssertionError("沒有用注入的 repository")
except EmailTaken:
    pass
assert _m.sent == []` },
      { name: '兩個 service 各用各的 repository，互不影響', code: `_s1 = UserService(InMemoryUserRepository(), FakeMailer())
_s2 = UserService(InMemoryUserRepository(), FakeMailer())
_s1.register("same@x.io", "One")
assert _s2.register("same@x.io", "Two").id == 1` },
    ],
    hints: ['`__init__(self, repo, mailer)` 只把參數存起來；建立哪一種 repository 是呼叫的人（測試或 composition root）決定的。', '先正規化 email 再查重複，查重與新增用的必須是同一個字串。', 'FakeMailer 在 `__init__` 建立 `self.sent = []`，每個實例各自一份。'],
  },
]

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
]

// 程式題：P9 新課（l1 批）：test-quality、acceptance-design、architecture-tests、harness-engineering
export default [
  {
    id: 'test-quality-1', skill: 'test-quality', kind: 'python', level: 2,
    title: '修掉假綠燈：讓測試殺得掉四個突變體',
    prompt: '`shipping_fee(subtotal, member)` 的規格：金額為負要 `raise ValueError`；會員滿 500、非會員滿 1000 免運（回傳 `0`），否則運費 `80`。\n\n底下 `TestShippingFee` 是 AI「補」出來的測試：按「執行」會看到四個測試全綠，但它們對程式一點約束都沒有——每一個都是套套邏輯或斷言太弱。\n\n改寫 `TestShippingFee` 裡的測試（可以改名、增減方法，**不要改 `shipping_fee`**），讓它們：\n\n1. 對正確的實作仍然全部通過\n2. 能殺掉這四個突變體（換成突變體後至少一個測試要失敗）：\n   - `>=` 改成 `>`（門檻邊界）\n   - 門檻永遠是 1000（忽略會員）\n   - 拿掉 `raise ValueError`（負數金額照樣算運費）\n   - `return 80` 改成 `return 60`\n\n每個測試都要寫出**具體的期望值**，不要拿函式自己的輸出當期望值。',
    starter: `import sys
import unittest


def shipping_fee(subtotal: int, member: bool) -> int:
    if subtotal < 0:
        raise ValueError("subtotal must be >= 0")
    threshold = 500 if member else 1000
    if subtotal >= threshold:
        return 0
    return 80


class TestShippingFee(unittest.TestCase):
    def test_returns_int(self):
        self.assertIsInstance(shipping_fee(300, False), int)

    def test_free_shipping_threshold(self):
        self.assertEqual(shipping_fee(1000, False), shipping_fee(1000, False))

    def test_member_threshold(self):
        self.assertIn(shipping_fee(500, True), (0, 80))

    def test_negative_subtotal(self):
        try:
            shipping_fee(-1, False)
        except ValueError:
            pass


unittest.TextTestRunner(stream=sys.stdout, verbosity=2).run(
    unittest.defaultTestLoader.loadTestsFromTestCase(TestShippingFee)
)
`,
    solution: `import sys
import unittest


def shipping_fee(subtotal: int, member: bool) -> int:
    if subtotal < 0:
        raise ValueError("subtotal must be >= 0")
    threshold = 500 if member else 1000
    if subtotal >= threshold:
        return 0
    return 80


class TestShippingFee(unittest.TestCase):
    # 門檻兩側各測一點：殺掉「>= 改成 >」
    def test_non_member_threshold_boundary(self):
        self.assertEqual(shipping_fee(999, False), 80)
        self.assertEqual(shipping_fee(1000, False), 0)

    # 會員門檻是 500：殺掉「門檻永遠 1000」
    def test_member_threshold_boundary(self):
        self.assertEqual(shipping_fee(499, True), 80)
        self.assertEqual(shipping_fee(500, True), 0)

    # 具體的運費金額：殺掉「80 改成 60」
    def test_fee_amount(self):
        self.assertEqual(shipping_fee(300, False), 80)

    # 用 assertRaises：沒拋例外就失敗，殺掉「拿掉 raise」
    def test_negative_subtotal_rejected(self):
        with self.assertRaises(ValueError):
            shipping_fee(-1, False)


unittest.TextTestRunner(stream=sys.stdout, verbosity=2).run(
    unittest.defaultTestLoader.loadTestsFromTestCase(TestShippingFee)
)
`,
    tests: [
      { name: 'shipping_fee 沒被改動', code: `assert shipping_fee(999, False) == 80 and shipping_fee(1000, False) == 0\nassert shipping_fee(499, True) == 80 and shipping_fee(500, True) == 0\ntry:\n    shipping_fee(-1, False)\n    raise AssertionError("shipping_fee(-1) 應該 raise ValueError")\nexcept ValueError:\n    pass` },
      { name: '測試對正確的實作全部通過', code: `import io as _io, unittest as _ut\n_suite = _ut.defaultTestLoader.loadTestsFromTestCase(TestShippingFee)\nassert _suite.countTestCases() >= 3, "至少要有 3 個測試"\n_r = _ut.TextTestRunner(stream=_io.StringIO()).run(_suite)\nassert _r.wasSuccessful(), "測試在正確的實作上就失敗了：" + str([str(t) for t, _ in _r.failures + _r.errors])\n\ndef _run_with(mutant):\n    global shipping_fee\n    _orig = shipping_fee\n    shipping_fee = mutant\n    try:\n        return _ut.TextTestRunner(stream=_io.StringIO()).run(_ut.defaultTestLoader.loadTestsFromTestCase(TestShippingFee))\n    finally:\n        shipping_fee = _orig` },
      { name: '殺掉突變體 1：>= 改成 >', code: `def _m1(subtotal, member):\n    if subtotal < 0:\n        raise ValueError("subtotal must be >= 0")\n    threshold = 500 if member else 1000\n    if subtotal > threshold:\n        return 0\n    return 80\nassert not _run_with(_m1).wasSuccessful(), "突變體存活：剛好到門檻（1000 或 500）的案例沒有被測到"` },
      { name: '殺掉突變體 2：門檻永遠是 1000', code: `def _m2(subtotal, member):\n    if subtotal < 0:\n        raise ValueError("subtotal must be >= 0")\n    threshold = 1000\n    if subtotal >= threshold:\n        return 0\n    return 80\nassert not _run_with(_m2).wasSuccessful(), "突變體存活：會員在 500 到 999 之間免運的案例沒有被測到"` },
      { name: '殺掉突變體 3：拿掉 raise ValueError', code: `def _m3(subtotal, member):\n    threshold = 500 if member else 1000\n    if subtotal >= threshold:\n        return 0\n    return 80\nassert not _run_with(_m3).wasSuccessful(), "突變體存活：負數金額沒拋例外也沒有測試失敗（用 assertRaises）"` },
      { name: '殺掉突變體 4：return 80 改成 return 60', code: `def _m4(subtotal, member):\n    if subtotal < 0:\n        raise ValueError("subtotal must be >= 0")\n    threshold = 500 if member else 1000\n    if subtotal >= threshold:\n        return 0\n    return 60\nassert not _run_with(_m4).wasSuccessful(), "突變體存活：沒有任何測試寫出具體的運費 80"` },
    ],
    hints: [
      '每個突變體對應一個「邊界」：在門檻值兩側各測一個點（999 / 1000、499 / 500）。',
      'assertIn(x, (0, 80)) 接受兩個答案，等於沒測；期望值要是一個具體的數字。',
      '檢查例外用 with self.assertRaises(ValueError): ...；try/except 裡沒有 self.fail() 的寫法永遠會過。',
    ],
  },
  {
    id: 'acceptance-design-1', skill: 'acceptance-design', kind: 'python', level: 2,
    title: '把驗收清單變成檢查器',
    prompt: '一張票動工前寫好了驗收清單 `CHECKLIST`：每一條是一個 dict，`kind` 決定怎麼檢查。agent 交付後，CI 把測試報告、覆蓋率、改動過的檔案整理成 `delivery`。\n\n實作 `run_acceptance(checklist, delivery)`，回傳**沒通過**的條目 id（list，照清單順序）。支援的 `kind`：\n\n| kind | 通過條件 |\n|---|---|\n| `tests_pass` | `delivery["tests"]["failed"] == 0` |\n| `min_tests` | `delivery["tests"]["passed"] >= value` |\n| `coverage_min` | `delivery["coverage"] >= value` |\n| `file_exists` | `path` 是 `delivery["files"]` 的 key |\n| `untouched` | `delivery["changed"]` 裡沒有任何路徑以 `prefix` 開頭 |\n| `no_pattern` | 所有 `changed` 檔案的內容（`delivery["files"][path]`）都找不到 `pattern`（用 `re.search`） |\n\n不認識的 `kind` 一律視為**沒通過**（fail closed）：一條沒人會檢查的驗收條件，不能默默算過。',
    starter: `import re

CHECKLIST = [
    {"id": "AC-1", "kind": "tests_pass"},
    {"id": "AC-2", "kind": "min_tests", "value": 12},
    {"id": "AC-3", "kind": "coverage_min", "value": 85},
    {"id": "AC-4", "kind": "file_exists", "path": "docs/adr/0009-cancel.md"},
    {"id": "AC-5", "kind": "untouched", "prefix": "tests/spec/"},
    {"id": "AC-6", "kind": "no_pattern", "pattern": r"skip|xfail|# type: ignore"},
]

DELIVERY = {
    "tests": {"passed": 11, "failed": 0},
    "coverage": 87.5,
    "files": {
        "app/services/appointments.py": "def cancel(appointment_id):\\n    ...",
        "tests/spec/test_cancel.py": "@pytest.mark.skip\\ndef test_cannot_cancel_past(): ...",
        "tests/test_cancel_extra.py": "def test_cancel_ok(): ...",
    },
    "changed": ["app/services/appointments.py", "tests/spec/test_cancel.py", "tests/test_cancel_extra.py"],
}


def run_acceptance(checklist: list, delivery: dict) -> list:
    """回傳沒通過的條目 id，照清單順序"""
    failed = []
    # TODO：逐條檢查
    return failed


print(run_acceptance(CHECKLIST, DELIVERY))
`,
    solution: `import re

CHECKLIST = [
    {"id": "AC-1", "kind": "tests_pass"},
    {"id": "AC-2", "kind": "min_tests", "value": 12},
    {"id": "AC-3", "kind": "coverage_min", "value": 85},
    {"id": "AC-4", "kind": "file_exists", "path": "docs/adr/0009-cancel.md"},
    {"id": "AC-5", "kind": "untouched", "prefix": "tests/spec/"},
    {"id": "AC-6", "kind": "no_pattern", "pattern": r"skip|xfail|# type: ignore"},
]

DELIVERY = {
    "tests": {"passed": 11, "failed": 0},
    "coverage": 87.5,
    "files": {
        "app/services/appointments.py": "def cancel(appointment_id):\\n    ...",
        "tests/spec/test_cancel.py": "@pytest.mark.skip\\ndef test_cannot_cancel_past(): ...",
        "tests/test_cancel_extra.py": "def test_cancel_ok(): ...",
    },
    "changed": ["app/services/appointments.py", "tests/spec/test_cancel.py", "tests/test_cancel_extra.py"],
}


def check_one(item: dict, d: dict) -> bool:
    kind = item["kind"]
    if kind == "tests_pass":
        return d["tests"]["failed"] == 0
    if kind == "min_tests":
        return d["tests"]["passed"] >= item["value"]
    if kind == "coverage_min":
        return d["coverage"] >= item["value"]
    if kind == "file_exists":
        return item["path"] in d["files"]
    if kind == "untouched":
        return not any(path.startswith(item["prefix"]) for path in d["changed"])
    if kind == "no_pattern":
        return not any(re.search(item["pattern"], d["files"].get(path, "")) for path in d["changed"])
    return False  # 不認識的檢查：fail closed


def run_acceptance(checklist: list, delivery: dict) -> list:
    """回傳沒通過的條目 id，照清單順序"""
    return [item["id"] for item in checklist if not check_one(item, delivery)]


print(run_acceptance(CHECKLIST, DELIVERY))
`,
    tests: [
      { name: '範例交付物：AC-2、AC-4、AC-5、AC-6 沒過', code: `assert run_acceptance(CHECKLIST, DELIVERY) == ["AC-2", "AC-4", "AC-5", "AC-6"], run_acceptance(CHECKLIST, DELIVERY)` },
      { name: '全部符合時回傳空 list', code: `_good = {"tests": {"passed": 15, "failed": 0}, "coverage": 90.0,\n    "files": {"docs/adr/0009-cancel.md": "# ADR", "app/services/appointments.py": "def cancel(): ..."},\n    "changed": ["app/services/appointments.py", "docs/adr/0009-cancel.md"]}\nassert run_acceptance(CHECKLIST, _good) == [], run_acceptance(CHECKLIST, _good)` },
      { name: 'tests_pass 與 coverage_min 的邊界', code: `_d = {"tests": {"passed": 20, "failed": 1}, "coverage": 85, "files": {}, "changed": []}\n_r = run_acceptance([{"id": "T", "kind": "tests_pass"}, {"id": "C", "kind": "coverage_min", "value": 85}], _d)\nassert _r == ["T"], _r` },
      { name: 'no_pattern 只看 changed 裡的檔案', code: `_d = {"tests": {"passed": 1, "failed": 0}, "coverage": 100,\n    "files": {"old.py": "# type: ignore", "new.py": "x = 1"}, "changed": ["new.py"]}\nassert run_acceptance([{"id": "P", "kind": "no_pattern", "pattern": r"type: ignore"}], _d) == []\n_d["changed"] = ["old.py", "new.py"]\nassert run_acceptance([{"id": "P", "kind": "no_pattern", "pattern": r"type: ignore"}], _d) == ["P"]` },
      { name: '不認識的 kind 視為沒通過', code: `_d = {"tests": {"passed": 1, "failed": 0}, "coverage": 100, "files": {}, "changed": []}\n_r = run_acceptance([{"id": "X", "kind": "manual_review"}, {"id": "T", "kind": "tests_pass"}], _d)\nassert _r == ["X"], _r` },
    ],
    hints: [
      '先寫一個 check_one(item, delivery) -> bool，run_acceptance 只負責收集回傳 False 的 id。',
      'no_pattern 要對每個 changed 路徑取 delivery["files"][path] 的內容做 re.search。',
      '函式最後一行 return False 就是 fail closed：沒被任何 if 接住的 kind 都算沒過。',
    ],
  },
  {
    id: 'architecture-tests-1', skill: 'architecture-tests', kind: 'python', level: 2,
    title: '實作 check_layers：把分層規則寫成測試',
    prompt: '`modules` 是「模組名 → 它 import 的模組名清單」（可以用 `ast` 從原始碼抽出來，這題直接給）。`rules` 有兩部分：\n\n- `layers`：由上往下排的分層前綴，例如 `["app.handlers", "app.services", "app.repositories"]`。一個模組屬於第一個符合的前綴（模組名等於前綴，或以「前綴 + `.`」開頭）。**上層可以 import 下層與同層，下層不能 import 上層**。不屬於任何層的模組（標準函式庫、第三方套件、`app.common`）不受分層限制。\n- `forbidden`：`{層前綴: [禁用的頂層套件名]}`。該層模組 import 的模組，其頂層名（第一個 `.` 之前）在清單裡就是違規。\n\n實作 `check_layers(modules, rules)`，回傳違規清單：每筆是 `(來源模組, 被 import 的模組, 原因)`，原因是 `"upward"` 或 `"forbidden"`。同一個 import 兩種都違規時兩筆都要回報。結果用 `sorted()` 排序後回傳。',
    starter: `RULES = {
    "layers": ["app.handlers", "app.services", "app.repositories"],
    "forbidden": {
        "app.services": ["fastapi", "sqlalchemy"],
        "app.repositories": ["fastapi"],
    },
}

MODULES = {
    "app.handlers.orders": ["fastapi", "app.services.orders", "app.common.ids"],
    "app.services.orders": ["app.repositories.orders", "app.handlers.orders", "fastapi.exceptions"],
    "app.repositories.orders": ["sqlalchemy.orm", "app.services.pricing"],
    "app.services.pricing": ["decimal", "app.common.money"],
    "app.common.money": ["decimal"],
}


def layer_of(module: str, layers: list):
    """回傳模組所屬層的索引（0 是最上層）；不屬於任何層回傳 None"""
    return None


def check_layers(modules: dict, rules: dict) -> list:
    violations = []
    # TODO
    return sorted(violations)


for v in check_layers(MODULES, RULES):
    print(v)
`,
    solution: `RULES = {
    "layers": ["app.handlers", "app.services", "app.repositories"],
    "forbidden": {
        "app.services": ["fastapi", "sqlalchemy"],
        "app.repositories": ["fastapi"],
    },
}

MODULES = {
    "app.handlers.orders": ["fastapi", "app.services.orders", "app.common.ids"],
    "app.services.orders": ["app.repositories.orders", "app.handlers.orders", "fastapi.exceptions"],
    "app.repositories.orders": ["sqlalchemy.orm", "app.services.pricing"],
    "app.services.pricing": ["decimal", "app.common.money"],
    "app.common.money": ["decimal"],
}


def layer_of(module: str, layers: list):
    """回傳模組所屬層的索引（0 是最上層）；不屬於任何層回傳 None"""
    for i, prefix in enumerate(layers):
        if module == prefix or module.startswith(prefix + "."):
            return i
    return None


def check_layers(modules: dict, rules: dict) -> list:
    layers = rules["layers"]
    forbidden = rules.get("forbidden", {})
    violations = []
    for src, imports in modules.items():
        src_layer = layer_of(src, layers)
        for dst in imports:
            dst_layer = layer_of(dst, layers)
            # 索引越小越上層：下層 import 上層 = 目標的索引比自己小
            if src_layer is not None and dst_layer is not None and dst_layer < src_layer:
                violations.append((src, dst, "upward"))
            if src_layer is not None:
                banned = forbidden.get(layers[src_layer], [])
                if dst.split(".")[0] in banned:
                    violations.append((src, dst, "forbidden"))
    return sorted(violations)


for v in check_layers(MODULES, RULES):
    print(v)
`,
    tests: [
      { name: 'layer_of：前綴比對與不屬於任何層', code: `_L = RULES["layers"]\nassert layer_of("app.handlers.orders", _L) == 0\nassert layer_of("app.services", _L) == 1\nassert layer_of("app.repositories.orders", _L) == 2\nassert layer_of("app.servicesx.foo", _L) is None, "app.servicesx 不是 app.services 的子模組"\nassert layer_of("fastapi", _L) is None and layer_of("app.common.money", _L) is None` },
      { name: '範例專案：兩筆 upward、一筆 forbidden', code: `_got = check_layers(MODULES, RULES)\n_want = sorted([\n    ("app.services.orders", "app.handlers.orders", "upward"),\n    ("app.services.orders", "fastapi.exceptions", "forbidden"),\n    ("app.repositories.orders", "app.services.pricing", "upward"),\n])\nassert _got == _want, _got` },
      { name: '合規的專案回傳空 list', code: `_ok = {\n    "app.handlers.a": ["fastapi", "app.services.a", "app.handlers.b"],\n    "app.services.a": ["app.repositories.a", "app.services.b", "app.common.x"],\n    "app.repositories.a": ["sqlalchemy", "app.repositories.b"],\n}\nassert check_layers(_ok, RULES) == [], check_layers(_ok, RULES)` },
      { name: '同一個 import 同時 upward 與 forbidden 要回報兩筆', code: `_r = {"layers": ["app.api", "app.core"], "forbidden": {"app.core": ["app"]}}\n_m = {"app.core.x": ["app.api.y"]}\n_got = check_layers(_m, _r)\nassert _got == [("app.core.x", "app.api.y", "forbidden"), ("app.core.x", "app.api.y", "upward")], _got` },
      { name: '沒有 forbidden 欄位也能跑；不在分層裡的模組不受限', code: `_r = {"layers": ["app.handlers", "app.services"]}\n_m = {"app.common.util": ["app.handlers.x"], "app.services.y": ["app.handlers.x"]}\nassert check_layers(_m, _r) == [("app.services.y", "app.handlers.x", "upward")], check_layers(_m, _r)` },
    ],
    hints: [
      'layer_of 用 module == prefix or module.startswith(prefix + ".")，少了那個「.」會把 app.servicesx 誤判成 app.services。',
      '層的索引越小越上層；src_layer 與 dst_layer 都不是 None 且 dst_layer < src_layer 就是 upward。',
      'forbidden 比對的是被 import 模組的頂層名：dst.split(".")[0]。',
    ],
  },
  {
    id: 'harness-engineering-1', skill: 'harness-engineering', kind: 'python', level: 2,
    title: '評測跑器：跑 N 次、算通過率、找出不穩定的案例',
    prompt: '模型輸出不是確定的，所以一個案例「過一次」不代表什麼。實作 `evaluate(model, cases, runs=5)`：\n\n- `model` 是 `callable(str) -> str`，`cases` 是 list，每個 case 有 `id`、`input`、`expected`，可選 `match`（`"exact"`，預設；或 `"contains"`：輸出包含 expected 就算過）\n- 每個 case 呼叫 `model(case["input"])` 恰好 `runs` 次，比對前對輸出與 expected 都做 `.strip()`\n- 回傳 dict：`pass_rate`（所有呼叫的通過比例，0.0–1.0）、`per_case`（`{id: 通過次數}`）、`flaky`（通過次數在 1 到 runs-1 之間的 id，照 cases 順序）、`always_fail`（通過 0 次的 id，照 cases 順序）\n\n下方的 `fake_model` 用呼叫計數模擬不穩定：某些輸入每隔幾次就答錯。先按「執行」看它的行為，再實作。',
    starter: `from collections import defaultdict

_calls = defaultdict(int)


def fake_model(prompt: str) -> str:
    """模擬模型：有些輸入每隔幾次就錯一次（確定性的，方便重現）"""
    _calls[prompt] += 1
    n = _calls[prompt]
    if prompt == "date":
        return "2026-03-14"
    if prompt == "ticket":
        return "billing" if n % 3 else "payment"       # 每第 3 次答錯
    if prompt == "total":
        return " 1480 " if n % 2 else "1,480"           # 偶數次多了千分位
    return "I cannot help with that request."


CASES = [
    {"id": "extract-date", "input": "date", "expected": "2026-03-14"},
    {"id": "classify", "input": "ticket", "expected": "billing"},
    {"id": "sum", "input": "total", "expected": "1480"},
    {"id": "refuse", "input": "pii", "expected": "cannot", "match": "contains"},
]


def evaluate(model, cases: list, runs: int = 5) -> dict:
    # TODO
    return {"pass_rate": 0.0, "per_case": {}, "flaky": [], "always_fail": []}


print(evaluate(fake_model, CASES, runs=6))
`,
    solution: `from collections import defaultdict

_calls = defaultdict(int)


def fake_model(prompt: str) -> str:
    """模擬模型：有些輸入每隔幾次就錯一次（確定性的，方便重現）"""
    _calls[prompt] += 1
    n = _calls[prompt]
    if prompt == "date":
        return "2026-03-14"
    if prompt == "ticket":
        return "billing" if n % 3 else "payment"       # 每第 3 次答錯
    if prompt == "total":
        return " 1480 " if n % 2 else "1,480"           # 偶數次多了千分位
    return "I cannot help with that request."


CASES = [
    {"id": "extract-date", "input": "date", "expected": "2026-03-14"},
    {"id": "classify", "input": "ticket", "expected": "billing"},
    {"id": "sum", "input": "total", "expected": "1480"},
    {"id": "refuse", "input": "pii", "expected": "cannot", "match": "contains"},
]


def passes(case: dict, output: str) -> bool:
    got = output.strip()
    want = case["expected"].strip()
    if case.get("match", "exact") == "contains":
        return want in got
    return got == want


def evaluate(model, cases: list, runs: int = 5) -> dict:
    per_case = {}
    for case in cases:
        per_case[case["id"]] = sum(passes(case, model(case["input"])) for _ in range(runs))
    total = sum(per_case.values())
    return {
        "pass_rate": total / (len(cases) * runs) if cases and runs else 0.0,
        "per_case": per_case,
        "flaky": [c["id"] for c in cases if 0 < per_case[c["id"]] < runs],
        "always_fail": [c["id"] for c in cases if per_case[c["id"]] == 0],
    }


print(evaluate(fake_model, CASES, runs=6))
`,
    tests: [
      { name: '每個 case 恰好呼叫 runs 次', code: `_seen = []\n_r = evaluate(lambda p: (_seen.append(p), "x")[1], [{"id": "a", "input": "A", "expected": "x"}, {"id": "b", "input": "B", "expected": "x"}], runs=4)\nassert sorted(_seen) == ["A"] * 4 + ["B"] * 4, _seen` },
      { name: 'exact 比對會 strip，contains 看包含', code: `_r = evaluate(lambda p: "  ok \\n", [{"id": "e", "input": "q", "expected": "ok"}], runs=2)\nassert _r["per_case"] == {"e": 2} and _r["pass_rate"] == 1.0, _r\n_r = evaluate(lambda p: "I cannot help", [{"id": "c", "input": "q", "expected": "cannot", "match": "contains"}, {"id": "x", "input": "q", "expected": "cannot"}], runs=3)\nassert _r["per_case"] == {"c": 3, "x": 0}, _r\nassert _r["always_fail"] == ["x"] and _r["flaky"] == [], _r` },
      { name: '不穩定的案例：通過次數與 flaky 分類', code: `_n = {"k": 0}\ndef _m(p):\n    _n["k"] += 1\n    return "yes" if _n["k"] % 2 else "no"\n_r = evaluate(_m, [{"id": "f", "input": "p", "expected": "yes"}], runs=6)\nassert _r["per_case"] == {"f": 3}, _r\nassert _r["flaky"] == ["f"] and _r["always_fail"] == [], _r\nassert abs(_r["pass_rate"] - 0.5) < 1e-9, _r` },
      { name: 'pass_rate 是所有呼叫的整體比例', code: `_c = {"k": 0}\ndef _m2(p):\n    _c["k"] += 1\n    return "a" if p == "A" else ("a" if _c["k"] % 4 == 0 else "b")\n_r = evaluate(_m2, [{"id": "a", "input": "A", "expected": "a"}, {"id": "b", "input": "B", "expected": "a"}, {"id": "z", "input": "Z", "expected": "a"}], runs=4)\nassert _r["per_case"]["a"] == 4 and _r["per_case"]["z"] in (0, 1), _r\n_total = sum(_r["per_case"].values())\nassert abs(_r["pass_rate"] - _total / 12) < 1e-9, _r\nassert "z" in (_r["always_fail"] + _r["flaky"]), _r` },
      { name: 'flaky 與 always_fail 照 cases 的順序', code: `_k = {"n": 0}\ndef _m3(p):\n    _k["n"] += 1\n    if p == "never": return "no"\n    return "yes" if _k["n"] % 2 else "no"\n_cases = [{"id": "c1", "input": "x", "expected": "yes"}, {"id": "c2", "input": "never", "expected": "yes"}, {"id": "c3", "input": "y", "expected": "yes"}]\n_r = evaluate(_m3, _cases, runs=4)\nassert _r["always_fail"] == ["c2"], _r\nassert _r["flaky"] == ["c1", "c3"], _r` },
    ],
    hints: [
      '先寫 passes(case, output) -> bool，把 strip 與 match 的判斷集中在一處。',
      'per_case[id] = sum(passes(case, model(case["input"])) for _ in range(runs))：bool 相加就是通過次數。',
      'flaky 的定義是 0 < 通過次數 < runs；always_fail 是等於 0；兩個清單都用 cases 的順序產生，不要用 dict 排序。',
    ],
  },
]

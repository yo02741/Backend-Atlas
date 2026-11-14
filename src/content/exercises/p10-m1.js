// 程式題：P10 新課（m1 批）：debugging、load-testing
export default [
  {
    id: 'debugging-1', skill: 'debugging', kind: 'python', level: 1,
    title: '用二分法找第一個壞掉的 commit',
    prompt: '`commits` 是一串 commit 編號，**由舊到新**。`is_bad(commit)` 會在那個 commit 上跑一次重現，壞的回傳 `True`。已知一旦某個 commit 壞了，之後的每一個都是壞的。\n\n實作 `first_bad(commits, is_bad)`：回傳**第一個**壞的 commit；全部都是好的（或 `commits` 是空的）回傳 `None`。\n\n每呼叫一次 `is_bad` 就是一次建置加一次測試，很貴。起始碼從最舊的開始一個一個測，答案是對的，但 1,000 個 commit 最壞要測 1,000 次。改成二分法，讓 `is_bad` 的呼叫次數不超過 `log2(n) + 2`（1,000 個 commit 最多 11 次）。\n\n- 只能透過 `is_bad` 判斷好壞，不要假設 commit 編號可以比大小\n- 同一個 commit 不要測兩次',
    starter: `def first_bad(commits, is_bad):
    # 現在的寫法：從最舊的開始一個一個測
    for commit in commits:
        if is_bad(commit):
            return commit
    return None


commits = [f"c{i:02d}" for i in range(1, 41)]
tested = []


def is_bad(commit):
    tested.append(commit)
    return commit >= "c27"


print(first_bad(commits, is_bad))
print("測了", len(tested), "次：", tested)
`,
    solution: `def first_bad(commits, is_bad):
    # 不變量：答案的位置在 [lo, hi] 之間；hi == len(commits) 代表「沒有壞的」
    lo, hi = 0, len(commits)
    while lo < hi:
        mid = (lo + hi) // 2
        if is_bad(commits[mid]):
            hi = mid            # mid 是壞的：第一個壞的在 mid 或更早
        else:
            lo = mid + 1        # mid 是好的：第一個壞的在 mid 之後
    return commits[lo] if lo < len(commits) else None


commits = [f"c{i:02d}" for i in range(1, 41)]
tested = []


def is_bad(commit):
    tested.append(commit)
    return commit >= "c27"


print(first_bad(commits, is_bad))
print("測了", len(tested), "次：", tested)
`,
    tests: [
      { name: '找得到第一個壞的 commit（含第一個、最後一個就是答案的情況）', code: `_cs = [f"k{i:03d}" for i in range(100)]
for _k in (0, 1, 37, 98, 99):
    _got = first_bad(_cs, lambda c, k=_k: _cs.index(c) >= k)
    assert _got == _cs[_k], f"第一個壞的是 {_cs[_k]}，你回傳 {_got}"` },
      { name: '全部都是好的、或沒有 commit 時回傳 None', code: `assert first_bad(["a", "b", "c"], lambda c: False) is None
assert first_bad([], lambda c: True) is None
assert first_bad(["only"], lambda c: True) == "only"
assert first_bad(["only"], lambda c: False) is None` },
      { name: 'commit 編號不能比大小時也正確（只靠 is_bad）', code: `_hashes = ["9f2c1a", "03bd77", "e41a0c", "5a5a5a", "1c0ffe", "b00b1e", "7d3e9f", "0a1b2c"]
_bad = set(_hashes[5:])
assert first_bad(_hashes, lambda c: c in _bad) == "b00b1e"` },
      { name: '1,000 個 commit：is_bad 最多呼叫 11 次，而且同一個 commit 不重複測', code: `import math as _math
_cs = [f"k{i:04d}" for i in range(1000)]
_limit = int(_math.log2(len(_cs))) + 2
for _k in (0, 1, 499, 500, 731, 998, 999, None):
    _calls = []
    def _is_bad(c, k=_k):
        _calls.append(c)
        return k is not None and _cs.index(c) >= k
    _got = first_bad(_cs, _is_bad)
    _want = None if _k is None else _cs[_k]
    assert _got == _want, f"答案應該是 {_want}，你回傳 {_got}"
    assert len(_calls) <= _limit, f"is_bad 被呼叫了 {len(_calls)} 次，上限是 {_limit} 次——還是一個一個測"
    assert len(set(_calls)) == len(_calls), "同一個 commit 被測了兩次"` },
    ],
    hints: [
      '用兩個索引 `lo`、`hi` 夾住答案可能的位置，每次測中間的 `mid`。',
      '`mid` 是壞的：答案在 `mid` 或更早，`hi = mid`。`mid` 是好的：答案在 `mid` 之後，`lo = mid + 1`。',
      '讓 `hi` 從 `len(commits)` 開始（比最後一個索引多 1），迴圈結束時 `lo == len(commits)` 就代表沒有壞的。',
    ],
  },
  {
    id: 'debugging-2', skill: 'debugging', kind: 'python', level: 2,
    title: '從兩段式 traceback 找出兩個要修的地方',
    prompt: '每日對帳的排程工作昨晚失敗了。log 裡的 traceback 貼在起始碼最上面的註解裡，最後一行是 `KeyError: \'payment_id\'`。\n\n`summarize(payments)` 的規格：\n\n- 把每筆付款依 `RATES` 換算成台幣後加總，回傳 `{"total_twd": 總額, "skipped": [被跳過的付款 id]}`\n- 幣別代碼**大小寫不拘**：`usd`、`Usd` 都當成 `USD`\n- `RATES` 裡沒有的幣別不計入總額，把那一筆的 `id` 放進 `skipped`（照出現順序）\n\n讀 traceback 找出要修的地方。它有**兩段**：只修最後一行指到的那個錯，工作不會再失敗，但金額會悄悄少算。\n\n- 不要改 `RATES`，也不要改動傳進來的 `payments`',
    starter: `# 昨晚的 traceback（行號對應這個檔案）：
#
# Traceback (most recent call last):
#   File "/app/report.py", line 39, in summarize
#     total += to_twd(p["amount"], p["currency"])
#   File "/app/report.py", line 31, in to_twd
#     return amount * RATES[currency]
# KeyError: 'usd'
#
# During handling of the above exception, another exception occurred:
#
# Traceback (most recent call last):
#   File "/app/jobs/daily.py", line 12, in run
#     result = summarize(payments)
#   File "/app/report.py", line 41, in summarize
#     skipped.append(p["payment_id"])
# KeyError: 'payment_id'

RATES = {"TWD": 1, "USD": 32, "HKD": 4}     # 示意匯率


def load_payments():
    return [
        {"id": "P-1001", "amount": 1200, "currency": "TWD"},
        {"id": "P-1002", "amount": 50, "currency": "usd"},
        {"id": "P-1003", "amount": 300, "currency": "HKD"},
    ]


def to_twd(amount, currency):
    return amount * RATES[currency]


def summarize(payments):
    total = 0
    skipped = []
    for p in payments:
        try:
            total += to_twd(p["amount"], p["currency"])
        except KeyError:
            skipped.append(p["payment_id"])
    return {"total_twd": total, "skipped": skipped}


try:
    print(summarize(load_payments()))
except Exception as e:
    print("失敗：", type(e).__name__, e)
`,
    solution: `# 昨晚的 traceback（行號對應起始碼）：
#
# 第一段（根源）：to_twd 用 'usd' 去查 RATES，但 key 是大寫 -> 幣別沒有正規化
# 第二段（During handling…）：except 區塊裡用了不存在的 key 'payment_id' -> 處理錯誤的程式自己有 bug
# 兩個都要修：只修第二個，'usd' 的付款會被當成「不支援的幣別」跳過，總額少算

RATES = {"TWD": 1, "USD": 32, "HKD": 4}     # 示意匯率


def load_payments():
    return [
        {"id": "P-1001", "amount": 1200, "currency": "TWD"},
        {"id": "P-1002", "amount": 50, "currency": "usd"},
        {"id": "P-1003", "amount": 300, "currency": "HKD"},
    ]


def to_twd(amount, currency):
    return amount * RATES[currency.upper()]      # 修正一：幣別代碼先轉大寫


def summarize(payments):
    total = 0
    skipped = []
    for p in payments:
        try:
            total += to_twd(p["amount"], p["currency"])
        except KeyError:
            skipped.append(p["id"])              # 修正二：付款編號的 key 是 "id"
    return {"total_twd": total, "skipped": skipped}


try:
    print(summarize(load_payments()))
except Exception as e:
    print("失敗：", type(e).__name__, e)
`,
    tests: [
      { name: '幣別都是大寫的資料：總額正確、沒有被跳過的', code: `_r = summarize([{"id": "A", "amount": 100, "currency": "TWD"}, {"id": "B", "amount": 10, "currency": "USD"}])
assert _r == {"total_twd": 420, "skipped": []}, _r` },
      { name: '小寫與混合大小寫的幣別要算進總額（traceback 第一段）', code: `_r = summarize(load_payments())
assert _r["total_twd"] == 1200 + 50 * 32 + 300 * 4, f"總額應該是 4000，你的結果 {_r}"
assert _r["skipped"] == [], f"usd 是支援的幣別，不應該被跳過：{_r}"
_r2 = summarize([{"id": "C", "amount": 2, "currency": "Hkd"}, {"id": "D", "amount": 1, "currency": "uSD"}])
assert _r2 == {"total_twd": 40, "skipped": []}, _r2` },
      { name: '不支援的幣別：不計入總額，id 放進 skipped（traceback 第二段）', code: `_r = summarize([
    {"id": "E-1", "amount": 100, "currency": "EUR"},
    {"id": "E-2", "amount": 100, "currency": "TWD"},
    {"id": "E-3", "amount": 5, "currency": "jpy"},
])
assert _r == {"total_twd": 100, "skipped": ["E-1", "E-3"]}, _r` },
      { name: '沒有改 RATES，也沒有改動傳進來的 payments', code: `import copy as _copy
assert RATES == {"TWD": 1, "USD": 32, "HKD": 4}, "不要改 RATES（例如加上小寫的 key）"
_ps = [{"id": "F", "amount": 1, "currency": "usd"}, {"id": "G", "amount": 1, "currency": "eur"}]
_before = _copy.deepcopy(_ps)
summarize(_ps)
assert _ps == _before, "傳進來的 payments 被改動了"` },
    ],
    hints: [
      '先讀最上面那一段：`KeyError: \'usd\'` 發生在 `to_twd` 查 `RATES` 的那一行。`RATES` 的 key 長什麼樣子？',
      '第二段是在 `except KeyError` 區塊裡發生的：`p["payment_id"]`。看 `load_payments()` 回傳的資料，付款編號的 key 叫什麼？',
      '幣別用 `currency.upper()` 正規化後再查表；不要在 `RATES` 裡加小寫的 key。',
    ],
  },
  {
    id: 'load-testing-1', skill: 'load-testing', kind: 'python', level: 2,
    title: '從各併發級的量測結果找出飽和點與安全上限',
    prompt: '一次逐步加壓的壓測，每一級記下一筆結果：`{"vus": 併發數, "rps": 吞吐, "p95_ms": p95 延遲, "error_rate": 錯誤率}`。\n\n實作 `analyze(levels, slo_p95_ms, max_error_rate, min_gain=0.05)`，回傳有三個 key 的 dict：\n\n- `saturation_vus`：**飽和點**：依 `vus` 由小到大看，第一個「吞吐相對前一級成長不到 `min_gain`」的級（`rps < 前一級的 rps * (1 + min_gain)`）。每一級都還在成長就是 `None`\n- `max_ok_vus`：**安全上限**：從最低的一級往上，連續符合 SLO 的最高一級。符合的條件是 `p95_ms <= slo_p95_ms` 而且 `error_rate <= max_error_rate`。一旦有一級不符合，更高的級就算數字剛好符合也不算；第一級就不符合是 `None`\n- `safe_rps`：`max_ok_vus` 那一級的吞吐；沒有就是 `0`\n\n`levels` 的順序不保證由小到大，而且不能改動傳進來的 list。\n\n起始碼把「吞吐最高的那一級」當成飽和點、把「所有符合 SLO 的級裡最大的」當成安全上限，兩個都不對。',
    starter: `LEVELS = [
    {"vus": 4, "rps": 86.7, "p95_ms": 40, "error_rate": 0.0},
    {"vus": 8, "rps": 177.5, "p95_ms": 40, "error_rate": 0.0},
    {"vus": 12, "rps": 227.9, "p95_ms": 60, "error_rate": 0.0},
    {"vus": 16, "rps": 228.2, "p95_ms": 80, "error_rate": 0.0},
    {"vus": 24, "rps": 229.0, "p95_ms": 130, "error_rate": 0.0},
    {"vus": 32, "rps": 226.5, "p95_ms": 170, "error_rate": 0.02},
    {"vus": 48, "rps": 221.0, "p95_ms": 250, "error_rate": 0.03},
    {"vus": 64, "rps": 214.3, "p95_ms": 330, "error_rate": 0.205},
]


def analyze(levels, slo_p95_ms, max_error_rate, min_gain=0.05):
    best = max(levels, key=lambda l: l["rps"])
    ok = [l for l in levels if l["p95_ms"] < slo_p95_ms and l["error_rate"] < max_error_rate]
    top = max(ok, key=lambda l: l["vus"]) if ok else None
    return {
        "saturation_vus": best["vus"],
        "max_ok_vus": top["vus"] if top else None,
        "safe_rps": top["rps"] if top else 0,
    }


print(analyze(LEVELS, slo_p95_ms=150, max_error_rate=0.01))
`,
    solution: `LEVELS = [
    {"vus": 4, "rps": 86.7, "p95_ms": 40, "error_rate": 0.0},
    {"vus": 8, "rps": 177.5, "p95_ms": 40, "error_rate": 0.0},
    {"vus": 12, "rps": 227.9, "p95_ms": 60, "error_rate": 0.0},
    {"vus": 16, "rps": 228.2, "p95_ms": 80, "error_rate": 0.0},
    {"vus": 24, "rps": 229.0, "p95_ms": 130, "error_rate": 0.0},
    {"vus": 32, "rps": 226.5, "p95_ms": 170, "error_rate": 0.02},
    {"vus": 48, "rps": 221.0, "p95_ms": 250, "error_rate": 0.03},
    {"vus": 64, "rps": 214.3, "p95_ms": 330, "error_rate": 0.205},
]


def analyze(levels, slo_p95_ms, max_error_rate, min_gain=0.05):
    ordered = sorted(levels, key=lambda l: l["vus"])     # sorted() 回傳新的 list，不動原本的

    # 飽和點：第一個相對前一級成長不到 min_gain 的級
    saturation = None
    for prev, cur in zip(ordered, ordered[1:]):
        if cur["rps"] < prev["rps"] * (1 + min_gain):
            saturation = cur["vus"]
            break

    # 安全上限：從最低一級往上，遇到第一個不符合 SLO 的就停
    top = None
    for level in ordered:
        if level["p95_ms"] <= slo_p95_ms and level["error_rate"] <= max_error_rate:
            top = level
        else:
            break

    return {
        "saturation_vus": saturation,
        "max_ok_vus": top["vus"] if top else None,
        "safe_rps": top["rps"] if top else 0,
    }


print(analyze(LEVELS, slo_p95_ms=150, max_error_rate=0.01))
`,
    tests: [
      { name: '範例資料：飽和點在 16、安全上限在 24', code: `_r = analyze(LEVELS, slo_p95_ms=150, max_error_rate=0.01)
assert _r["saturation_vus"] == 16, f"併發 16 的吞吐只比 12 多 0.1%，飽和點是 16；你的結果 {_r['saturation_vus']}（吞吐最高的那一級不是飽和點）"
assert _r["max_ok_vus"] == 24 and _r["safe_rps"] == 229.0, _r` },
      { name: '剛好等於 SLO 算符合', code: `_r = analyze(LEVELS, slo_p95_ms=130, max_error_rate=0.0)
assert _r["max_ok_vus"] == 24, f"p95 剛好 130、錯誤率剛好 0 都算符合，你的結果 {_r}"
_r2 = analyze(LEVELS, slo_p95_ms=170, max_error_rate=0.02)
assert _r2["max_ok_vus"] == 32 and _r2["safe_rps"] == 226.5, _r2` },
      { name: '中間有一級不符合，更高的級就不算', code: `_lv = [
    {"vus": 10, "rps": 100, "p95_ms": 50, "error_rate": 0.0},
    {"vus": 20, "rps": 200, "p95_ms": 90, "error_rate": 0.0},
    {"vus": 30, "rps": 290, "p95_ms": 240, "error_rate": 0.0},
    {"vus": 40, "rps": 380, "p95_ms": 140, "error_rate": 0.0},
]
_r = analyze(_lv, slo_p95_ms=150, max_error_rate=0.01)
assert _r["max_ok_vus"] == 20 and _r["safe_rps"] == 200, f"併發 30 已經超過 SLO，40 那一級不能算：{_r}"
assert _r["saturation_vus"] is None, f"每一級的吞吐都還在成長，沒有飽和點：{_r}"` },
      { name: '第一級就不符合：None 與 0', code: `_r = analyze(LEVELS, slo_p95_ms=30, max_error_rate=0.01)
assert _r["max_ok_vus"] is None and _r["safe_rps"] == 0, _r
_r1 = analyze([{"vus": 5, "rps": 50, "p95_ms": 20, "error_rate": 0.0}], slo_p95_ms=100, max_error_rate=0.01)
assert _r1 == {"saturation_vus": None, "max_ok_vus": 5, "safe_rps": 50}, _r1` },
      { name: 'min_gain 可以調整', code: `_r = analyze(LEVELS, slo_p95_ms=150, max_error_rate=0.01, min_gain=0.3)
assert _r["saturation_vus"] == 12, f"門檻 30% 時，併發 12 只比 8 成長約 28%，飽和點是 12：{_r}"` },
      { name: '輸入的順序不保證，而且不能改動傳進來的 list', code: `import copy as _copy
_shuffled = [LEVELS[i] for i in (5, 0, 7, 2, 4, 1, 6, 3)]
_before = _copy.deepcopy(_shuffled)
_r = analyze(_shuffled, slo_p95_ms=150, max_error_rate=0.01)
assert _r == {"saturation_vus": 16, "max_ok_vus": 24, "safe_rps": 229.0}, _r
assert _shuffled == _before, "傳進來的 levels 被改動了（用 sorted()，不要用 .sort()）"` },
    ],
    hints: [
      '先用 `sorted(levels, key=lambda l: l["vus"])` 排出一份新的 list。',
      '飽和點要比的是「相鄰兩級」：`zip(ordered, ordered[1:])`，找到第一組 `cur["rps"] < prev["rps"] * (1 + min_gain)` 就停。',
      '安全上限用迴圈由低往高走，遇到第一個不符合的就 `break`；比較用 `<=`。',
    ],
  },
]

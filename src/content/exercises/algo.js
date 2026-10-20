// 程式題：演算法與系統設計
export default [
  {
    id: 'big-o-1', skill: 'big-o', kind: 'python', level: 1,
    title: '把 O(n²) 的交集改成 O(n)',
    prompt: '`common_ids` 用巢狀迴圈找兩個 list 的共同元素，兩萬筆對兩萬筆就是四億次比較。改成 O(n)：用 set 或 dict 讓「在不在裡面」變成 O(1)。回傳**排序後**的 list，不重複。',
    starter: `def common_ids(a: list[int], b: list[int]) -> list[int]:
    result = []
    for x in a:
        for y in b:          # O(n²)
            if x == y and x not in result:
                result.append(x)
    return sorted(result)


print(common_ids([1, 2, 3, 4], [3, 4, 5]))
`,
    solution: `def common_ids(a: list[int], b: list[int]) -> list[int]:
    return sorted(set(a) & set(b))


print(common_ids([1, 2, 3, 4], [3, 4, 5]))
`,
    tests: [
      { name: '小資料正確', code: `assert common_ids([1, 2, 3, 4], [3, 4, 5]) == [3, 4]\nassert common_ids([5, 5, 1], [5, 1, 1]) == [1, 5]\nassert common_ids([], [1]) == []` },
      { name: '兩萬對兩萬要在 1 秒內', code: `import time as _t\n_a = list(range(0, 40000, 2))\n_b = list(range(0, 40000, 3))\n_t0 = _t.time()\n_r = common_ids(_a, _b)\n_dt = _t.time() - _t0\nassert _r[:3] == [0, 6, 12] and len(_r) == 6667, (len(_r), _r[:3])\nassert _dt < 1.0, f"花了 {_dt:.2f} 秒——還是 O(n²)"` },
    ],
    hints: ['set(a) & set(b) 就是交集，建 set 是 O(n)。', '「x not in result」對 list 也是 O(n)，也是慢的來源。'],
  },
  {
    id: 'data-structures-1', skill: 'data-structures', kind: 'python', level: 1,
    title: '用 heapq 取前 k 大',
    prompt: '實作 `top_k(nums, k) -> list[int]`：回傳最大的 k 個數，由大到小。`k` 大於長度時回傳全部（排序後）。試著用 `heapq.nlargest`，或自己維護一個大小為 k 的最小堆。',
    starter: `import heapq


def top_k(nums: list[int], k: int) -> list[int]:
    # TODO
    return []


print(top_k([5, 1, 9, 3, 7], 2))
`,
    solution: `import heapq


def top_k(nums: list[int], k: int) -> list[int]:
    return heapq.nlargest(k, nums)


print(top_k([5, 1, 9, 3, 7], 2))
`,
    tests: [
      { name: '基本案例', code: `assert top_k([5, 1, 9, 3, 7], 2) == [9, 7]\nassert top_k([5, 1, 9, 3, 7], 5) == [9, 7, 5, 3, 1]` },
      { name: 'k 超過長度、空 list', code: `assert top_k([2, 1], 5) == [2, 1]\nassert top_k([], 3) == []` },
      { name: '十萬筆取前 10', code: `import random as _r\n_r.seed(1)\n_n = [_r.randint(0, 10**6) for _ in range(100000)]\nassert top_k(_n, 10) == sorted(_n, reverse=True)[:10]` },
    ],
    hints: ['heapq.nlargest(k, nums) 直接回傳由大到小的前 k 個。', '自己實作的話：維護大小 k 的最小堆，新元素比堆頂大才 heappushpop。'],
  },
  {
    id: 'rate-limiting-1', skill: 'rate-limiting', kind: 'python', level: 2,
    title: '實作 token bucket',
    prompt: '實作 `TokenBucket(capacity, refill_per_sec)`，方法 `allow(now: float) -> bool`：\n\n- 桶子一開始是滿的\n- 每次 `allow` 先依「距上次的秒數 × refill_per_sec」補 token（不超過 capacity），再看有沒有至少 1 個 token：有就扣 1 回 True，沒有回 False\n- `now` 由呼叫者傳入（測試才能控制時間）',
    starter: `class TokenBucket:
    def __init__(self, capacity: int, refill_per_sec: float):
        self.capacity = capacity
        self.refill_per_sec = refill_per_sec
        self.tokens = float(capacity)
        self.last = None

    def allow(self, now: float) -> bool:
        # TODO
        return True


b = TokenBucket(3, 1)
print([b.allow(0) for _ in range(4)])   # 預期 [True, True, True, False]
`,
    solution: `class TokenBucket:
    def __init__(self, capacity: int, refill_per_sec: float):
        self.capacity = capacity
        self.refill_per_sec = refill_per_sec
        self.tokens = float(capacity)
        self.last = None

    def allow(self, now: float) -> bool:
        if self.last is not None:
            elapsed = max(0.0, now - self.last)
            self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_per_sec)
        self.last = now
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False


b = TokenBucket(3, 1)
print([b.allow(0) for _ in range(4)])
`,
    tests: [
      { name: '暴衝到容量就擋', code: `_b = TokenBucket(3, 1)\nassert [_b.allow(0) for _ in range(4)] == [True, True, True, False]` },
      { name: '隨時間補充', code: `_b = TokenBucket(3, 1)\nfor _ in range(3): _b.allow(0)\nassert _b.allow(0.5) is False, "0.5 秒只補了半個 token"\nassert _b.allow(1.0) is True\nassert _b.allow(1.0) is False` },
      { name: '補充不超過容量', code: `_b = TokenBucket(2, 5)\n_b.allow(0)\nassert [_b.allow(100) for _ in range(3)] == [True, True, False], "閒置很久後也只能有 capacity 個"` },
    ],
    hints: ['先補再扣：tokens = min(capacity, tokens + elapsed * rate)。', '第一次呼叫時 last 是 None，不要補。'],
  },
  {
    id: 'lru-cache-1', skill: 'lru-cache', kind: 'python', level: 2,
    title: '用 OrderedDict 實作 LRU',
    prompt: '實作 `LRU(capacity)`：`get(key)` 找不到回 `None`，找到要把它標記為「最近使用」；`put(key, value)` 滿了就淘汰**最久沒用**的。用 `collections.OrderedDict` 的 `move_to_end` 與 `popitem(last=False)`。',
    starter: `from collections import OrderedDict


class LRU:
    def __init__(self, capacity: int):
        self.capacity = capacity
        self.data = OrderedDict()

    def get(self, key):
        # TODO
        return self.data.get(key)

    def put(self, key, value):
        # TODO
        self.data[key] = value


c = LRU(2)
c.put("a", 1); c.put("b", 2); c.get("a"); c.put("c", 3)
print(list(c.data.keys()))   # 預期 ['a', 'c']：b 最久沒用被淘汰
`,
    solution: `from collections import OrderedDict


class LRU:
    def __init__(self, capacity: int):
        self.capacity = capacity
        self.data = OrderedDict()

    def get(self, key):
        if key not in self.data:
            return None
        self.data.move_to_end(key)
        return self.data[key]

    def put(self, key, value):
        if key in self.data:
            self.data.move_to_end(key)
        self.data[key] = value
        if len(self.data) > self.capacity:
            self.data.popitem(last=False)


c = LRU(2)
c.put("a", 1); c.put("b", 2); c.get("a"); c.put("c", 3)
print(list(c.data.keys()))
`,
    tests: [
      { name: 'get 會刷新最近使用', code: `_c = LRU(2)\n_c.put("a", 1); _c.put("b", 2); _c.get("a"); _c.put("c", 3)\nassert _c.get("b") is None and _c.get("a") == 1 and _c.get("c") == 3` },
      { name: 'put 既有 key 更新值並刷新', code: `_c = LRU(2)\n_c.put("a", 1); _c.put("b", 2); _c.put("a", 10); _c.put("c", 3)\nassert _c.get("a") == 10 and _c.get("b") is None` },
      { name: '容量不超過上限', code: `_c = LRU(3)\nfor _i in range(10): _c.put(_i, _i)\nassert len(_c.data) == 3 and _c.get(7) == 7 and _c.get(0) is None` },
    ],
    hints: ['move_to_end(key) 把 key 移到最後（最近使用）；popitem(last=False) 從最前面（最久沒用）淘汰。', 'put 時若 key 已存在也要 move_to_end，否則舊位置會讓它太早被淘汰。'],
  },
  {
    id: 'queues-workers-1', skill: 'queues-workers', kind: 'python', level: 2,
    title: '冪等的消費者',
    prompt: '佇列是 at-least-once：同一個事件可能送兩次。實作 `process(event, seen: set, sent: list) -> bool`：`event["id"]` 已在 `seen` 就跳過（回 False）；否則把 `event["email"]` 加進 `sent`、記住 id、回 True。同一封歡迎信不能寄兩次。',
    starter: `def process(event: dict, seen: set, sent: list) -> bool:
    # TODO
    sent.append(event["email"])
    return True


seen, sent = set(), []
for e in [{"id": "e1", "email": "a@x"}, {"id": "e1", "email": "a@x"}, {"id": "e2", "email": "b@x"}]:
    process(e, seen, sent)
print(sent)   # 預期 ['a@x', 'b@x']
`,
    solution: `def process(event: dict, seen: set, sent: list) -> bool:
    if event["id"] in seen:
        return False
    seen.add(event["id"])
    sent.append(event["email"])
    return True


seen, sent = set(), []
for e in [{"id": "e1", "email": "a@x"}, {"id": "e1", "email": "a@x"}, {"id": "e2", "email": "b@x"}]:
    process(e, seen, sent)
print(sent)
`,
    tests: [
      { name: '重複事件只處理一次', code: `_seen, _sent = set(), []\n_r = [process(e, _seen, _sent) for e in [{"id": "e1", "email": "a@x"}, {"id": "e1", "email": "a@x"}, {"id": "e2", "email": "b@x"}]]\nassert _sent == ["a@x", "b@x"], _sent\nassert _r == [True, False, True], _r` },
      { name: 'seen 有被更新', code: `_seen, _sent = set(), []\nprocess({"id": "z", "email": "z@x"}, _seen, _sent)\nassert "z" in _seen` },
    ],
    hints: ['先檢查 id 在不在 seen，在就直接 return False。', '正式系統的 seen 會存在資料庫或 Redis（SET NX），不然 worker 重啟就忘了。'],
  },
  {
    id: 'concurrency-bugs-1', skill: 'concurrency-bugs', kind: 'python', level: 2,
    title: '修好重複領取：await 之間的 check-then-act',
    prompt: '`CouponService.claim` 先檢查「領過沒」，再 `await` 呼叫發券服務，最後才記下已領取。同一個使用者連按 10 次（10 個並行的 claim），每次檢查時都還沒有紀錄，於是發了 10 張。修好它：\n\n- 同一個使用者並行呼叫多次，**只發一張**，只有一次回傳 `True`\n- **不同使用者之間不能互相等待**：20 個不同使用者同時領取，總時間要接近一次發券的時間（用一把全域的鎖會讓所有人排隊）\n- 發券失敗（`_issue` 丟出例外）時，例外要往外丟，而且這個使用者**之後可以重新領取**\n\n提示：每個使用者一把 `asyncio.Lock`。',
    starter: `import asyncio


class CouponService:
    def __init__(self):
        self.claimed: set[int] = set()
        self.issued: list[int] = []

    async def _issue(self, user_id: int):
        await asyncio.sleep(0.02)          # 呼叫發券服務（I/O）
        self.issued.append(user_id)

    async def claim(self, user_id: int) -> bool:
        if user_id in self.claimed:        # 查
            return False
        await self._issue(user_id)         # 這裡交出執行權，其他 claim 會插進來
        self.claimed.add(user_id)          # 做
        return True


svc = CouponService()
results = await asyncio.gather(*(svc.claim(42) for _ in range(10)))
print(results.count(True), "次成功，發了", len(svc.issued), "張")
`,
    solution: `import asyncio


class CouponService:
    def __init__(self):
        self.claimed: set[int] = set()
        self.issued: list[int] = []
        self._locks: dict[int, asyncio.Lock] = {}

    async def _issue(self, user_id: int):
        await asyncio.sleep(0.02)
        self.issued.append(user_id)

    async def claim(self, user_id: int) -> bool:
        # 每個使用者一把鎖：同一人的請求排隊，不同人互不影響
        lock = self._locks.setdefault(user_id, asyncio.Lock())
        async with lock:
            if user_id in self.claimed:
                return False
            await self._issue(user_id)     # 失敗會丟例外，claimed 不會被記上，之後可以重領
            self.claimed.add(user_id)
            return True


svc = CouponService()
results = await asyncio.gather(*(svc.claim(42) for _ in range(10)))
print(results.count(True), "次成功，發了", len(svc.issued), "張")
`,
    hints: [
      'asyncio 只在 await 切換：查與做之間的 await，就是別的 task 插進來的地方。',
      'self._locks.setdefault(user_id, asyncio.Lock()) 取得（或建立）這個使用者的鎖，再 async with lock 包住查、發券、記錄。',
      '正式環境有多個 worker，程式內的鎖不夠，還要靠資料庫的唯一約束；這題只處理單一程序內的部分。',
    ],
    tests: [
      { name: '同一人並行 10 次只發一張', code: `_s = CouponService()
_r = await asyncio.gather(*(_s.claim(42) for _ in range(10)))
assert _r.count(True) == 1, _r
assert _s.issued == [42], _s.issued` },
      { name: '不同使用者不互相等待', code: `import time as _t
_s = CouponService()
_t0 = _t.monotonic()
_r = await asyncio.gather(*(_s.claim(u) for u in range(20)))
_dt = _t.monotonic() - _t0
assert all(_r) and sorted(_s.issued) == list(range(20)), (_r, _s.issued)
assert _dt < 0.2, f"20 個不同使用者花了 {_dt:.2f} 秒——所有人在排同一把鎖"` },
      { name: '發券失敗後可以重領', code: `_s = CouponService()
_calls = []
_orig = _s._issue
async def _flaky(uid):
    _calls.append(uid)
    if len(_calls) == 1:
        raise RuntimeError("發券服務逾時")
    await _orig(uid)
_s._issue = _flaky
try:
    await _s.claim(7)
    raise AssertionError("發券失敗時 claim 應該把例外往外丟")
except RuntimeError:
    pass
assert await _s.claim(7) is True, "發券失敗後應該可以重新領取"
assert _s.issued == [7], _s.issued` },
    ],
  },
  {
    id: 'job-scheduling-1', skill: 'job-scheduling', kind: 'python', level: 2,
    title: '停機後要補跑哪些',
    prompt: '一個每小時第 `minute` 分執行的工作，上次成功是 `last_run`，主機停機後在 `now` 恢復。實作：\n\n- `missed_runs(last_run, now, minute, policy, limit=24) -> list[datetime]`：列出 `last_run` 之後（不含）、`now` 之前（含）所有排定的時間點（每小時的第 `minute` 分、秒數為 0），依 `policy` 決定補哪些：\n  - `"all"`：全部補，但最多 `limit` 個，超過時保留**最新的** `limit` 個\n  - `"latest"`：只補最近的一次\n  - `"skip"`：不補，回傳 `[]`\n- `run_once(job, slot, done) -> bool`：同一個 `(job, slot)` 只執行一次。`done` 是已執行紀錄的 set（正式環境是有唯一約束的資料表）；第一次回 `True` 並記下，之後回 `False`\n\n時間點依時間先後排序。',
    starter: `from datetime import datetime, timedelta


def missed_runs(last_run: datetime, now: datetime, minute: int, policy: str, limit: int = 24) -> list[datetime]:
    # TODO：目前只是把相差的小時數加回去，沒有對齊到第 minute 分，也沒有處理 policy
    hours = int((now - last_run).total_seconds() // 3600)
    return [last_run + timedelta(hours=i) for i in range(1, hours + 1)]


def run_once(job: str, slot: datetime, done: set) -> bool:
    # TODO
    return True


last = datetime(2026, 11, 1, 10, 5)
now = datetime(2026, 11, 1, 13, 30)
print(missed_runs(last, now, 5, "all"))      # 預期 11:05、12:05、13:05
print(missed_runs(last, now, 5, "latest"))   # 預期 13:05
`,
    solution: `from datetime import datetime, timedelta


def missed_runs(last_run: datetime, now: datetime, minute: int, policy: str, limit: int = 24) -> list[datetime]:
    if policy == "skip":
        return []
    # 第一個候選：last_run 那個小時的第 minute 分；不在 last_run 之後就往後推一小時
    t = last_run.replace(minute=minute, second=0, microsecond=0)
    if t <= last_run:
        t += timedelta(hours=1)
    slots = []
    while t <= now:
        slots.append(t)
        t += timedelta(hours=1)
    if policy == "latest":
        return slots[-1:]
    if policy == "all":
        return slots[-limit:] if limit > 0 else []
    raise ValueError(f"未知的 policy：{policy}")


def run_once(job: str, slot: datetime, done: set) -> bool:
    key = (job, slot)              # 用「排定時間」當 key，不是實際執行的時間
    if key in done:
        return False
    done.add(key)
    return True


last = datetime(2026, 11, 1, 10, 5)
now = datetime(2026, 11, 1, 13, 30)
print(missed_runs(last, now, 5, "all"))
print(missed_runs(last, now, 5, "latest"))
`,
    hints: [
      '從 last_run.replace(minute=minute, second=0, microsecond=0) 開始，若它不晚於 last_run 就加一小時，之後每次加一小時直到超過 now。',
      '「保留最新的 limit 個」就是 slots[-limit:]。',
      'run_once 的 key 是 (job, slot)：同一個排定時間被觸發兩次（多台主機、重試）也只會執行一次。',
    ],
    tests: [
      { name: '列出錯過的時間點', code: `from datetime import datetime as _dt
_got = missed_runs(_dt(2026, 11, 1, 10, 5), _dt(2026, 11, 1, 13, 30), 5, "all")
assert _got == [_dt(2026, 11, 1, 11, 5), _dt(2026, 11, 1, 12, 5), _dt(2026, 11, 1, 13, 5)], _got` },
      { name: '邊界：last_run 不含、now 含、沒對齊的 last_run', code: `from datetime import datetime as _dt
assert missed_runs(_dt(2026, 11, 1, 10, 5), _dt(2026, 11, 1, 13, 5), 5, "all")[-1] == _dt(2026, 11, 1, 13, 5)
assert missed_runs(_dt(2026, 11, 1, 10, 5), _dt(2026, 11, 1, 11, 4), 5, "all") == []
assert missed_runs(_dt(2026, 11, 1, 10, 20), _dt(2026, 11, 1, 12, 0), 5, "all") == [_dt(2026, 11, 1, 11, 5)]
assert missed_runs(_dt(2026, 11, 1, 23, 50), _dt(2026, 11, 2, 1, 0), 30, "all") == [_dt(2026, 11, 2, 0, 30)]` },
      { name: 'policy：latest 與 skip', code: `from datetime import datetime as _dt
_a, _b = _dt(2026, 11, 1, 10, 5), _dt(2026, 11, 1, 13, 30)
assert missed_runs(_a, _b, 5, "latest") == [_dt(2026, 11, 1, 13, 5)]
assert missed_runs(_a, _b, 5, "skip") == []
assert missed_runs(_a, _dt(2026, 11, 1, 10, 30), 5, "latest") == []` },
      { name: '超過 limit 只保留最新的', code: `from datetime import datetime as _dt
_got = missed_runs(_dt(2026, 11, 1, 0, 0), _dt(2026, 11, 3, 0, 0), 0, "all", limit=24)
assert len(_got) == 24, len(_got)
assert _got[-1] == _dt(2026, 11, 3, 0, 0) and _got[0] == _dt(2026, 11, 2, 1, 0), (_got[0], _got[-1])` },
      { name: 'run_once 防重複執行', code: `from datetime import datetime as _dt
_done = set()
_slot = _dt(2026, 11, 1, 2, 0)
assert run_once("report", _slot, _done) is True
assert run_once("report", _slot, _done) is False, "同一個排定時間不能執行第二次"
assert run_once("report", _dt(2026, 12, 1, 2, 0), _done) is True
assert run_once("cleanup", _slot, _done) is True, "不同工作互不影響"` },
    ],
  },
  {
    id: 'distributed-basics-1', skill: 'distributed-basics', kind: 'python', level: 3,
    title: 'saga：失敗時反向執行補償',
    prompt: '跨服務的下單流程沒有一個交易能包住，改用 saga。實作 `run_saga(steps, log) -> str`，`steps` 是 `(name, action, compensate)` 的 list：\n\n- 依序執行每一步的 `action()`，成功就在 `log` 記 `"do:<name>"`\n- 全部成功回傳 `"completed"`\n- 某一步的 `action()` 丟出例外：記 `"fail:<name>"`，接著**依反向順序**對**已經成功的步驟**執行 `compensate()`，各記 `"undo:<name>"`（失敗的那一步本身沒有完成，不補償），回傳 `"compensated"`\n- 補償本身也丟出例外時：記 `"undo-failed:<name>"`，**繼續補償其他步驟**，最後回傳 `"needs-manual"`（要人工處理）',
    starter: `def run_saga(steps, log: list) -> str:
    for name, action, compensate in steps:
        try:
            action()
            log.append(f"do:{name}")
        except Exception:
            log.append(f"fail:{name}")
            return "failed"          # TODO：補償已完成的步驟
    return "completed"


def ok():
    pass

def card_declined():
    raise RuntimeError("card declined")


log = []
steps = [
    ("create_order", ok, ok),
    ("reserve_stock", ok, ok),
    ("charge", card_declined, ok),
    ("confirm", ok, ok),
]
print(run_saga(steps, log), log)
`,
    solution: `def run_saga(steps, log: list) -> str:
    done = []                                  # 已經成功的步驟，失敗時反向補償
    for name, action, compensate in steps:
        try:
            action()
        except Exception:
            log.append(f"fail:{name}")
            manual = False
            for done_name, undo in reversed(done):
                try:
                    undo()
                    log.append(f"undo:{done_name}")
                except Exception:
                    log.append(f"undo-failed:{done_name}")
                    manual = True              # 繼續補償其他步驟，最後交給人處理
            return "needs-manual" if manual else "compensated"
        log.append(f"do:{name}")
        done.append((name, compensate))
    return "completed"


def ok():
    pass

def card_declined():
    raise RuntimeError("card declined")


log = []
steps = [
    ("create_order", ok, ok),
    ("reserve_stock", ok, ok),
    ("charge", card_declined, ok),
    ("confirm", ok, ok),
]
print(run_saga(steps, log), log)
`,
    hints: [
      '用一個 list 記住已成功的 (name, compensate)，失敗時 reversed() 依反向順序補償。',
      '每個補償各自 try / except，一個補償失敗不能讓後面的補償不執行。',
      '真實的 saga 中，每一步與每個補償都要冪等，因為它們可能被重送。',
    ],
    tests: [
      { name: '全部成功', code: `_log = []
assert run_saga([("a", ok, ok), ("b", ok, ok)], _log) == "completed"
assert _log == ["do:a", "do:b"], _log` },
      { name: '中間失敗：反向補償已完成的步驟', code: `_log = []
_r = run_saga([("create_order", ok, ok), ("reserve_stock", ok, ok), ("charge", card_declined, ok), ("confirm", ok, ok)], _log)
assert _r == "compensated", _r
assert _log == ["do:create_order", "do:reserve_stock", "fail:charge", "undo:reserve_stock", "undo:create_order"], _log` },
      { name: '第一步就失敗：沒有東西要補償', code: `_log = []
assert run_saga([("a", card_declined, ok), ("b", ok, ok)], _log) == "compensated"
assert _log == ["fail:a"], _log` },
      { name: '補償失敗：記錄並繼續補償其他步驟', code: `def _broken():
    raise RuntimeError("refund API down")
_log = []
_r = run_saga([("a", ok, ok), ("b", ok, _broken), ("c", ok, ok), ("d", card_declined, ok)], _log)
assert _r == "needs-manual", _r
assert _log == ["do:a", "do:b", "do:c", "fail:d", "undo:c", "undo-failed:b", "undo:a"], _log` },
      { name: '補償真的有被呼叫', code: `_calls = []
_log = []
run_saga([("a", ok, lambda: _calls.append("undo-a")), ("b", ok, lambda: _calls.append("undo-b")), ("c", card_declined, lambda: _calls.append("undo-c"))], _log)
assert _calls == ["undo-b", "undo-a"], _calls` },
    ],
  },
  {
    id: 'system-design-1', skill: 'system-design', kind: 'python', level: 2,
    title: '粗估規模：QPS、儲存與機器數',
    prompt: '系統設計的第二步是粗估規模，數量級對就好。實作：\n\n- `estimate(dau, requests_per_user, peak_factor, writes_per_day, bytes_per_write, years) -> dict`：\n  - `avg_qps`：`dau × requests_per_user / 86400`，四捨五入成整數\n  - `peak_qps`：平均 QPS（未四捨五入的值）× `peak_factor`，四捨五入成整數\n  - `storage_gb`：`writes_per_day × 365 × years × bytes_per_write`，以 10⁹ bytes 為 1 GB，四捨五入到小數一位\n- `servers(peak_qps, qps_per_server, target_utilization=0.6, min_servers=2) -> int`：每台只規劃用到 `target_utilization` 的容量，算出需要幾台（無條件進位）；為了容錯，至少 `min_servers` 台',
    starter: `import math


def estimate(dau, requests_per_user, peak_factor, writes_per_day, bytes_per_write, years) -> dict:
    # TODO：一天有 86400 秒，不是 3600
    avg = dau * requests_per_user / 3600
    return {
        "avg_qps": round(avg),
        "peak_qps": round(avg * peak_factor),
        "storage_gb": round(writes_per_day * bytes_per_write / 10**9, 1),
    }


def servers(peak_qps, qps_per_server, target_utilization=0.6, min_servers=2) -> int:
    # TODO：保留餘裕、無條件進位、最少台數
    return round(peak_qps / qps_per_server)


# 短網址服務：200 萬 DAU、每人每天 20 次請求、尖峰 3 倍；每天新增 100 萬筆、每筆 500 bytes、保留 5 年
e = estimate(2_000_000, 20, 3, 1_000_000, 500, 5)
print(e)
print("API 機器（每台 500 QPS）：", servers(e["peak_qps"], 500))
`,
    solution: `import math


def estimate(dau, requests_per_user, peak_factor, writes_per_day, bytes_per_write, years) -> dict:
    avg = dau * requests_per_user / 86400
    return {
        "avg_qps": round(avg),
        "peak_qps": round(avg * peak_factor),
        "storage_gb": round(writes_per_day * 365 * years * bytes_per_write / 10**9, 1),
    }


def servers(peak_qps, qps_per_server, target_utilization=0.6, min_servers=2) -> int:
    needed = math.ceil(peak_qps / (qps_per_server * target_utilization))
    return max(min_servers, needed)


# 短網址服務：200 萬 DAU、每人每天 20 次請求、尖峰 3 倍；每天新增 100 萬筆、每筆 500 bytes、保留 5 年
e = estimate(2_000_000, 20, 3, 1_000_000, 500, 5)
print(e)
print("API 機器（每台 500 QPS）：", servers(e["peak_qps"], 500))
`,
    hints: [
      '2,000,000 × 20 / 86,400 ≈ 463 QPS；尖峰 3 倍約 1,389。',
      '1,000,000 × 365 × 5 × 500 bytes ≈ 9.1 × 10¹¹ bytes ≈ 912.5 GB。',
      '每台只用 60%：1389 / (500 × 0.6) = 4.63，進位成 5 台。',
    ],
    tests: [
      { name: '短網址服務的估算', code: `_e = estimate(2_000_000, 20, 3, 1_000_000, 500, 5)
assert _e == {"avg_qps": 463, "peak_qps": 1389, "storage_gb": 912.5}, _e` },
      { name: '另一組數字', code: `_e = estimate(50_000, 100, 5, 20_000, 2_000, 2)
assert _e == {"avg_qps": 58, "peak_qps": 289, "storage_gb": 29.2}, _e` },
      { name: '機器數：保留餘裕並進位', code: `assert servers(1389, 500) == 5
assert servers(3000, 500) == 10
assert servers(3000, 500, target_utilization=0.8) == 8` },
      { name: '至少兩台（容錯）', code: `assert servers(10, 500) == 2
assert servers(0, 500) == 2
assert servers(10, 500, min_servers=3) == 3` },
    ],
  },
]

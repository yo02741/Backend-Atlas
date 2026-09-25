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
]

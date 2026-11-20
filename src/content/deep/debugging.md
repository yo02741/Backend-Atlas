## 從一個具體問題開始：訂單明細 API 只在正式環境偶爾回 500

訂單明細 API `GET /orders/{id}` 上線三週後，錯誤追蹤裡開始零星出現 500：一天幾十次，不到這支 API 流量的 1%（示意）。本機和 staging 怎麼點都正常，客服轉來的回報只有一句「訂單打不開」。

盯著程式碼猜、重啟服務，都不會讓問題變清楚。有用的做法是固定的四步：收集事實、縮成最小重現、讀 traceback 定位、定位不到就二分。

先看事實。用 request id 把失敗的請求從 log 撈出來（見 [日誌、錯誤處理與設定](#/skill/logging-config)），排在一起比對：

| 觀察 | 排除了什麼 |
|---|---|
| 同一張訂單重試十次，十次都失敗 | 不是偶發的網路或逾時問題 |
| 失敗的請求分散在每一台機器、每個時段 | 不是某台機器的設定，也不是尖峰時的併發 |
| 失敗的訂單都含有 2023 年以前上架的商品 | 跟**資料**有關 |

「偶爾」描述的是從外面看到的頻率，不是原因。找出共同點之後，它通常會變成「每次遇到某種資料」或「每次兩個請求同時進來」。

## 最小重現：把問題縮到一個檔案

最小重現（minimal reproduction）是一段**每次執行都失敗、而且不能再刪**的程式。能穩定重現之前不要動手修，否則改完之後分不出是修好了還是剛好沒遇到。縮的方法是一次拿掉一樣東西，每拿掉一樣就重跑：

1. **固定輸入**：從 log 拿到失敗的訂單編號 1042，把那張訂單的資料（去掉個資）匯到本機，確認也回 500。
2. **拿掉外層**：不經過 nginx 和登入，直接呼叫 handler；再跳過 handler，直接呼叫 `order_detail(order)`。
3. **縮小資料**：訂單有 6 個品項，一次拿掉一半，直到只剩會出錯的那一個。
4. **拿掉相依**：把那個品項寫成程式裡的一個 dict，不再需要資料庫。

某一步拿掉之後**不壞了**，剛拿掉的那樣東西就是發生條件之一：放回去，改拿別的。終點大概長這樣：

```python
import json

# 舊商品的 options 欄位是 NULL，讀出來是 None
item = {"sku": "SKU-7731", "qty": 1, "price": 990, "options": None}
json.loads(item["options"])    # TypeError：每次執行都失敗
```

把 `None` 換成 `"{}"` 就不壞，原因得到確認；加上斷言，它就是回歸測試（見 [測試金字塔與 pytest](#/skill/testing)）。

本機重現不出來，代表發生條件還沒找齊：把正式環境和本機的差異列成清單，一項一項拉近（見後面的情境表）。

## 讀 traceback：由下往上，找第一個自己的 frame

log 裡那次失敗的 traceback（節錄，Python 3.14 的格式；3.11 起會用 `~` 和 `^` 標出出錯的運算式）：

```text
Traceback (most recent call last):
  File "/app/app/services/order_view.py", line 29, in order_detail
    return [render_item(item) for item in order["items"]]
            ~~~~~~~~~~~^^^^^^
  File "/app/app/services/order_view.py", line 14, in render_item
    options = json.loads(item["options"])
  File "/usr/local/lib/python3.14/json/__init__.py", line 345, in loads
    raise TypeError(f'the JSON object must be str, bytes or bytearray, '
                    f'not {s.__class__.__name__}')
TypeError: the JSON object must be str, bytes or bytearray, not NoneType

The above exception was the direct cause of the following exception:

Traceback (most recent call last):
  ...（省略十幾層 site-packages 裡 uvicorn、starlette、fastapi 的 frame）
  File "/app/app/api/orders.py", line 21, in get_order
    return {"id": order["id"], "lines": order_detail(order)}
                                        ~~~~~~~~~~~~^^^^^^^
  File "/app/app/services/order_view.py", line 31, in order_detail
    raise OrderViewError(f"cannot render order {order['id']}") from e
OrderViewError: cannot render order 1042
```

讀的順序：

1. **每一段的最後一行**是例外型別與訊息。
2. **一個 frame 是一組**：`File "路徑", line 行號, in 函式名`，接著是那一行原始碼。最早被呼叫的在最上面，出錯的地方在最下面。
3. **由下往上，找第一個路徑在自己專案裡的 frame**。最底下的 frame 常常在標準函式庫或 `site-packages` 裡：這裡是 `json/__init__.py`，它只是照規則拒絕了傳進去的 `None`。往上一格的 `order_view.py` 第 14 行是自己的程式。
4. **看那一行用到的值**：`item["options"]` 是 `None`。再往上一個自己的 frame，查這個值從哪裡來。

### 兩種串接

兩段 traceback 中間夾著的那一行有兩種寫法：

| 中間那一行 | 怎麼產生的 | 代表什麼 |
|---|---|---|
| `The above exception was the direct cause of the following exception:` | `raise New(...) from e`，記在 `__cause__` | 刻意轉換：下面是對外的說法，上面是原因 |
| `During handling of the above exception, another exception occurred:` | `except` 或 `finally` 區塊執行途中又丟出例外，沒有寫 `from`，記在 `__context__` | 轉換時漏寫 `from`，或處理錯誤的程式本身有 bug |

兩種都是**上面那段先發生**，根源從最上面那段找。第二種要多問一句：下面那個例外是不是意料之外的？處理錯誤的程式自己壞了時，要修的地方有兩個，只看最後一行會看錯方向。

`raise New(...) from None` 會把前面的例外從輸出裡拿掉，只在原本的例外對查問題沒有幫助時才這樣寫。寫 log 時用 `logger.exception(...)`，整段串接才會留下來。

下面用 `compile()` 把三段原始碼掛上不同的檔名，模擬 service、API、框架三個檔案，製造出兩種串接，再用 `traceback` 模組取出每個 frame，標出哪些是自己的程式：

```python run
import json
import linecache
import traceback


def load(filename, source, namespace):
    """把一段原始碼當成 filename 這個檔案載入，讓 traceback 裡的路徑像真的專案"""
    linecache.cache[filename] = (len(source), None, source.splitlines(True), filename)
    exec(compile(source, filename, "exec"), namespace)


ns = {"json": json}

# 自己的程式：service 層
load("/app/app/services/order_view.py", '''\
class OrderViewError(Exception):
    pass

def render_item(item):
    options = json.loads(item["options"])          # 舊資料的 options 是 None
    return {"sku": item["sku"], "options": options}

def order_detail(order):
    try:
        return [render_item(item) for item in order["items"]]
    except Exception as e:
        raise OrderViewError(f"cannot render order {order['id']}") from e   # 明確串接

def order_detail_buggy(order):
    try:
        return [render_item(item) for item in order["items"]]
    except Exception:
        print("render failed:", order["order_id"])   # 處理錯誤的程式自己寫錯 key
        raise
''', ns)

# 自己的程式：API 層
load("/app/app/api/orders.py", '''\
def get_order(order, detail):
    return {"id": order["id"], "lines": detail(order)}
''', ns)

# 別人的程式：框架（放在 site-packages 底下）
load("/venv/lib/python3.14/site-packages/miniweb/routing.py", '''\
def dispatch(handler, *args):
    return handler(*args)
''', ns)

ORDER = {"id": 1042, "items": [
    {"sku": "SKU-1001", "options": '{"color": "black"}'},
    {"sku": "SKU-7731", "options": None},
]}


def owner(filename):
    if filename.startswith("/app/"):
        return "自己"
    if "site-packages" in filename:
        return "套件"
    return "其他"            # 標準函式庫，或這段示範程式本身


def chain(exc):
    """從最後丟出的例外往回走，回傳 [(例外, 它和下一個的關係)]，根源排最前面"""
    out, link = [], ""
    while exc is not None:
        out.append((exc, link))
        if exc.__cause__ is not None:                    # raise ... from e
            exc, link = exc.__cause__, "direct cause（明確串接）"
        elif exc.__context__ is not None and not exc.__suppress_context__:
            exc, link = exc.__context__, "during handling（處理途中又出錯）"
        else:
            exc = None
    return out[::-1]


def explain(exc):
    first_own = None
    for n, (e, link) in enumerate(chain(exc), 1):
        print(f"  [{n}] {type(e).__name__}: {e}")
        for frame in traceback.extract_tb(e.__traceback__):
            who = owner(frame.filename)
            mark = ">>" if who == "自己" else "  "
            print(f"      {mark} {who}  {frame.filename}:{frame.lineno} in {frame.name}")
            if n == 1 and who == "自己":
                first_own = frame                        # 根源那一段裡，最靠近出錯點的自己的 frame
        if link:
            print(f"      └─ 之後被串成下一個例外：{link}")
    print(f"  先看這裡 -> {first_own.filename}:{first_own.lineno}  {first_own.line}")


for title, detail in [("明確串接 raise ... from e", ns["order_detail"]),
                      ("except 區塊裡又出錯", ns["order_detail_buggy"])]:
    try:
        ns["dispatch"](ns["get_order"], ORDER, detail)
    except Exception as exc:
        print(f"===== {title}：Python 印出的 traceback =====")
        print("".join(traceback.format_exception(exc)), end="")
        print("----- 拆開來看（根源在最上面） -----")
        explain(exc)
        print()
```

兩個案例的根源都在 `order_view.py` 第 5 行。第二個案例只讀最後一行的話，會以為是訂單資料少了 `order_id` 欄位。

## 二分法：不靠猜，每次排除一半

有些問題沒有例外（金額算錯、回應變慢），有些例外離原因很遠。這時只要知道**某個版本是好的、某個版本是壞的**，就不需要理解中間每一個改動：測中間那一個，每次排除一半。相隔 1,000 個 commit 大約測 10 次（log₂1000 ≈ 10）。

### git bisect

```bash
git bisect start
git bisect bad                  # 目前的版本是壞的
git bisect good v2.3.0          # 這個 tag 確定是好的
# git 會 checkout 中間的 commit，並印出類似
#   Bisecting: 18 revisions left to test after this (roughly 4 steps)
# 在這個 commit 上跑重現，依結果回報其中一個：
git bisect good
git bisect bad
# 重複到 git 印出「<sha> is the first bad commit」
git bisect reset                # 結束，回到原本的分支
```

有最小重現的話，可以交給 git 自己跑完：

```bash
git bisect start HEAD v2.3.0            # 先寫壞的、再寫好的
git bisect run python /tmp/repro.py     # 每一步執行這個指令，用結束碼判斷
```

`git bisect run` 看指令的結束碼：0 是 good，125 是「這個 commit 沒辦法測，跳過」（手動時是 `git bisect skip`），1 到 127 之間的其他值是 bad。

三個前提：

- **每個 commit 都能建置、能跑**，否則只能一直 skip（見 [Git 工作流與分支策略](#/skill/git-workflow)）。
- **重現要快而且穩定**。十次才壞一次的重現，每一步都要跑到足以分辨的次數；標錯一步，結果就指向無關的 commit。
- **重現腳本放在 repo 外面**。checkout 到舊的 commit 時，後來才加的測試檔不存在，指令找不到檔案也會回傳非 0，被當成 bad。

下面模擬 40 個 commit 的 bisect，印出每一步測了哪一個：

```python run
import math

# 40 個 commit，由舊到新。c01 是上一版（已知正常），c40 是現在（已知會壞）
COMMITS = [f"c{i:02d}" for i in range(1, 41)]
FIRST_BAD = "c27"                      # 實際上是誰弄壞的；bisect 開始時並不知道


def run_repro(commit):
    """在某個 commit 上跑重現腳本：回傳 'good' 或 'bad'"""
    return "bad" if commit >= FIRST_BAD else "good"


good, bad = 0, len(COMMITS) - 1        # git bisect good c01 / git bisect bad c40
print(f"git bisect start：good={COMMITS[good]} bad={COMMITS[bad]}，中間有 {bad - good - 1} 個 commit 待查")
step = 0
while bad - good > 1:
    mid = (good + bad) // 2            # git 幫你 checkout 中間那個
    step += 1
    result = run_repro(COMMITS[mid])
    if result == "bad":
        bad = mid                      # 壞的出現在 mid 或更早：丟掉後半
    else:
        good = mid                     # 到 mid 為止都正常：丟掉前半
    left = bad - good - 1
    print(f"第 {step} 步：測 {COMMITS[mid]} -> {result:4}  範圍縮成 ({COMMITS[good]}, {COMMITS[bad]}]，剩 {left} 個待查")

print(f"{COMMITS[bad]} is the first bad commit（共測 {step} 次）")
print(f"一個一個往回測，最壞要測 {len(COMMITS) - 2} 次；二分法約 log2({len(COMMITS) - 2}) = {math.log2(len(COMMITS) - 2):.1f} 次")
```

### 沒有 commit 可以切的時候

同樣的切法可以用在：

- **程式碼**：把流程的後半註解掉或提早 `return`，看問題還在不在；或在流程中點加一行 log 印出關鍵的值，值在中點已經是錯的，問題就在前半。
- **資料**：一萬筆的匯入檔裡有一筆會讓程式壞掉，切成兩半各跑一次，壞的那半再切。
- **設定與相依**：兩個環境差了 12 個環境變數，一次把一半換成另一邊的值。

每一步只改一樣東西、跑同一個重現；同時改兩樣，結果就無法歸因。

:::stop 讀到這裡可以先停：會做最小重現、讀串接的 traceback、用 git bisect 找出改壞的 commit。後面的 pdb 與 profiler，在要看執行中的值或程式變慢時再回來讀。

## 看現場：pdb 與 breakpoint()

除錯器讓你看到變數**實際上**是什麼。在想停下來的地方加一行 `breakpoint()`（Python 3.7 起內建，預設進入 pdb）：

```python
def render_item(item):
    breakpoint()                # 執行到這裡停住，終端機出現 (Pdb) 提示
    options = json.loads(item["options"])
    return {"sku": item["sku"], "options": options}
```

| 指令 | 作用 |
|---|---|
| `l`、`ll` | 列出目前位置附近的程式；`ll` 列出整個函式 |
| `p 運算式`、`pp 運算式` | 印出值；`pp` 會排版 |
| `n`、`s` | 執行下一行；`s` 會進入這一行呼叫的函式 |
| `r`、`c` | 執行到目前的函式 return；`c` 繼續執行到下一個中斷點 |
| `w` | 印出目前的呼叫堆疊 |
| `u`、`d` | 往呼叫者、往被呼叫者移動一個 frame，檢查那一層的變數 |
| `b 檔名:行號`、`q` | 設中斷點；離開 |

另外兩個入口：`python -m pdb script.py` 在程式因為未捕捉的例外結束時，會停在出錯的 frame（post-mortem）；`pytest --pdb` 在測試失敗的地方進入 pdb。

限制：pdb 需要接著終端機的行程，正式環境的服務不適用；停在中斷點會改變時序，併發問題常常一停就不見，要改用 log；`breakpoint()` 不能 commit 進去（環境變數 `PYTHONBREAKPOINT=0` 會讓它什麼都不做，ruff 的 `T10` 規則可以在 CI 擋下）。

## 時間花在哪：profiler

**cProfile** 在標準函式庫裡，記錄每一次函式呼叫的次數與時間。它本身會拖慢程式，所以看的是各函式之間的比例，不是絕對秒數。不改程式就能用：`python -m cProfile -s cumulative script.py`。

| 欄位 | 意思 |
|---|---|
| `ncalls` | 被呼叫幾次 |
| `tottime` | 這個函式**自己**花的時間，不含它呼叫的函式 |
| `cumtime` | 從進入到離開的總時間，含它呼叫的函式 |

先依 `cumtime` 看時間落在哪一條呼叫路徑上，再依 `tottime` 找真正在消耗時間的函式。`ncalls` 異常大通常是迴圈裡的重複工作。

```python run
import cProfile
import pstats
from datetime import datetime

# 虛構資料：3,000 個使用者、4,000 筆訂單
USERS = [{"id": i, "name": f"user{i}"} for i in range(3000)]
ORDERS = [{"id": n, "user_id": (n * 37) % 3000, "amount": 100 + n % 900,
           "created_at": f"2026-03-{1 + n % 28:02d} 10:{n % 60:02d}:00"} for n in range(4000)]


def find_user(users, user_id):
    for u in users:                     # 每筆訂單都從頭掃一次使用者清單
        if u["id"] == user_id:
            return u
    return None


def parse_time(text):
    return datetime.strptime(text, "%Y-%m-%d %H:%M:%S")


def format_row(order, user, when):
    return f"{order['id']},{user['name']},{order['amount']},{when:%m/%d}"


def build_report(orders, users, lookup):
    rows = []
    for o in orders:
        user = lookup(users, o["user_id"])
        rows.append(format_row(o, user, parse_time(o["created_at"])))
    return rows


def profile(label, lookup, users):
    pr = cProfile.Profile()
    pr.enable()
    rows = build_report(ORDERS, users, lookup)
    pr.disable()
    stats = pstats.Stats(pr).strip_dirs()
    print(f"===== {label}：依 tottime 排序的前 5 名 =====")
    stats.sort_stats("tottime").print_stats(5)
    # get_stats_profile()（Python 3.9 起）把同一份數字變成可以用程式讀的結構
    funcs = stats.get_stats_profile().func_profiles
    hot = max(funcs, key=lambda name: funcs[name].tottime)
    print(f"熱點：{hot}（呼叫 {funcs[hot].ncalls} 次，自己花掉 {funcs[hot].tottime:.3f} 秒）\n")
    return rows


before = profile("修改前", find_user, USERS)

# 只改熱點：先建一個 id -> user 的 dict，查找從 O(n) 變 O(1)
BY_ID = {u["id"]: u for u in USERS}


def find_user_indexed(by_id, user_id):
    return by_id.get(user_id)


after = profile("修改後", find_user_indexed, BY_ID)
print("兩次的輸出相同：", before == after)
```

修改前 `find_user` 被呼叫 4,000 次、`tottime` 最高：每筆訂單都把使用者清單從頭掃一遍。換成 dict 之後它從前幾名消失，下一個熱點變成日期解析。秒數每次執行都不同，排名與呼叫次數比較穩定（見 [Big-O 與後端常見複雜度](#/skill/big-o)）。

**py-spy** 是第三方的取樣式 profiler：對已經在執行的行程定期取樣呼叫堆疊，不用改程式、不用重啟。適合「正式環境某個 worker 的 CPU 一直是滿的」或「行程卡住了，想知道停在哪一行」這類情況；需要相應的系統權限，指令以它的官方文件為準。

時間花在等資料庫或外部 API 時，要看的是慢查詢與 trace（見 [可觀測性](#/skill/observability)）；整個服務在多少流量下開始變慢，見 [效能量測與壓測](#/skill/load-testing)。

## 常見的後端除錯情境

| 情境 | 先查什麼 | 常見的原因 |
|---|---|---|
| 只在正式環境 | 兩邊的差異：部署的 commit、環境變數、lockfile、資料量與內容 | 舊資料有 NULL 或舊格式、設定值不同、本機沒有的代理或逾時 |
| 偶發 | 失敗請求的共同點：哪台機器、哪個時段、哪種資料、當時的併發量 | 資料相依、某一台版本不同、race condition、外部服務逾時 |
| 時區 | 是否集中在台灣時間 00:00 到 08:00；有沒有不帶時區的 `datetime` | 伺服器用 UTC、商業邏輯用台灣時間，「今天」差 8 小時（見 [Python 後端心智模型](#/skill/python-backend)） |
| 併發 | 單一請求是否永遠正常；同時送多個請求能否重現 | 共用的可變狀態、「讀出來、判斷、再寫回去」（見 [並發問題](#/skill/concurrency-bugs)） |
| 資料相依 | 一筆會失敗的輸入和一筆會成功的，逐欄比對 | NULL、空字串、超長字串、重複資料、大小寫 |

## 常見錯誤與錯誤訊息

| 現象或訊息 | 原因 | 怎麼處理 |
|---|---|---|
| 最後一行是 `KeyError: 'order_id'`，但訂單資料沒問題 | 中間是 `During handling of the above exception…`：處理錯誤的程式自己出錯 | 從最上面那段找根源；兩個問題都要修 |
| bisect 的結果指向一個只改了文件的 commit | 重現不穩定，或中途某一步標錯 | `git bisect log` 檢查每一步；改用 `git bisect run` 重跑 |
| 加了 log 之後問題就不出現 | 問題跟時序有關，加 log 改變了時序 | 當成併發問題：提高併發量重現，檢查共用狀態 |

開頭那張訂單的修法有兩處：`render_item` 把 `None` 當成沒有選項；另外補一次資料修正，讓舊資料不再是 NULL。

## 動手

1. 執行「兩種串接」那段，把 `from e` 改成 `from None`，看 traceback 少了什麼。
2. 執行 bisect 模擬，把 `FIRST_BAD` 改成 `"c02"` 和 `"c40"`，看步數有沒有變。
3. 執行 cProfile 那段，把 `sort_stats("tottime")` 改成 `"cumulative"`，比較兩種排序；再試著處理修改後的新熱點。
4. 程式題：[用二分法找第一個壞掉的 commit](#/exercise/debugging-1)、[從兩段式 traceback 找出兩個要修的地方](#/exercise/debugging-2)。

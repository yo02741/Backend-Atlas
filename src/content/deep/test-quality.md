## 從一個具體問題開始：覆蓋率 96%，免運門檻還是算錯

結帳服務有一條規則：會員滿 500 元免運，非會員滿 1000 元免運，否則運費 80 元。某次改版請 AI 順手重構運費計算，順便「把測試補齊」。MR 上的數字很漂亮：新增 14 個測試、覆蓋率從 71% 升到 96%、CI 全綠。

上線兩天後客服收到抱怨：會員剛好買 500 元的訂單被收了運費。回頭看程式，重構時把 `subtotal >= threshold` 寫成了 `subtotal > threshold`。再看那 14 個測試，其中負責門檻的是這一個：

```python
def test_member_threshold():
    # AI 補的測試：跑過了 order_total 的每一行，覆蓋率因此上升
    result = order_total(500, member=True)
    assert result in (500, 580)
```

這個測試確實執行了門檻判斷的那一行，所以覆蓋率算它有覆蓋；但兩種結果它都接受，門檻寫對寫錯它都會過。**覆蓋率回答的是「這一行有沒有被執行」，不回答「這一行算錯時有沒有測試會失敗」**。後者才是測試存在的理由。

這一課處理的就是這個落差：怎麼辨認「綠燈但沒驗到東西」的測試，以及怎麼用突變測試（mutation testing）把這個落差量出來。

## 覆蓋率量到什麼、量不到什麼

coverage.py 這類工具的做法是在測試執行時記錄哪些行（或分支）被跑到。它量的是**執行**，不看斷言。下表是同一個函式、同樣 100% 行覆蓋的三組測試：

| 測試寫法 | 行覆蓋 | 把 `>=` 改成 `>` 會紅嗎 | 把運費 80 改成 60 會紅嗎 |
|---|---|---|---|
| 只呼叫函式，不寫 assert | 100% | 不會 | 不會 |
| `assert result in (500, 580)` | 100% | 不會 | 不會 |
| `assert order_total(500, True) == 500` 與 `assert order_total(499, True) == 579` | 100% | 會 | 會 |

三組的覆蓋率一模一樣，抓錯能力天差地遠。所以覆蓋率適合當**下限**（低於某個比例代表有大片程式根本沒被執行），不適合當品質指標；拿它當 KPI，最快達標的方法就是寫一堆只呼叫、不斷言的測試。分支覆蓋（`coverage run --branch`）比行覆蓋嚴格一點，能看出 `if` 的另一邊沒走過，但同樣不檢查結果。

## AI 寫的測試：三種假綠燈

請 AI「幫這個函式補測試」時，它手上最具體的資訊是程式本身，所以產出的測試很容易繞著程式寫，而不是繞著規格寫。常見的三種：

### 1. 斷言太弱

| 寫法 | 問題 | 改成 |
|---|---|---|
| `assert result` | 任何非空、非零的值都過 | `assert result == 580` |
| `assertIsInstance(fee, int)` | 只驗型別，不驗值 | `assertEqual(fee, 80)` |
| `assert result in (500, 580)` | 對錯都接受 | 拆成兩個案例，各自一個期望值 |
| `try: f(-1)` 後 `except ValueError: pass` | 沒拋例外也不會失敗 | `with pytest.raises(ValueError):` 或 `assertRaises` |
| `assert len(items) > 0` | 內容錯了也過 | 比對整個 list，或至少比對關鍵欄位 |

最後一列之外，最常見的是 try/except 那種：看起來在「測例外」，實際上沒有任何一條路徑會失敗。

### 2. 測實作細節，不測行為

```python
def test_apply_coupon(mocker):
    repo = mocker.Mock()
    service = CouponService(repo)
    service.apply("SAVE10", order)
    repo.get.assert_called_once_with("SAVE10")   # 驗的是「怎麼做」
    assert service._last_code == "SAVE10"        # 驗私有欄位
```

這種測試把內部步驟釘死：把查兩次合成一次、或把私有欄位改名，行為沒變，測試卻紅了；反過來，折扣金額算錯，它照樣綠。久了團隊會習慣「重構就順手改測試」，測試就失去約束力。行為測試只看公開介面：給什麼輸入、得到什麼輸出、資料庫最後是什麼狀態（見 [測試金字塔與 pytest](#/skill/testing) 的假物件一節）。

### 3. 把目前的輸出當期望值

```python
def test_format_invoice():
    # AI 執行了一次 format_invoice，把印出來的字串整段貼成期望值
    assert format_invoice(order) == "總計：NT$1,079（含運費 NT$80）"
```

如果 `format_invoice` 現在本來就算錯（例如會員門檻寫錯），這個測試就把 bug 寫進了規範。之後真的有人修好 bug，測試反而紅了，而且很可能被「改回來」。snapshot 測試、golden file 都有這個風險：它們適合偵測**變化**，不證明**正確**。防法是期望值從規格寫，不從輸出抄；請 AI 補測試時給它規格與邊界案例，不是只給它程式（流程見 [規範要變成測試](#/skill/ai-spec-to-tests)）。

## 運作原理：突變測試

既然覆蓋率不看斷言，就需要另一種量法：**故意把程式改壞，看測試會不會發現**。突變測試的流程：

1. 先確認測試在原程式上全綠。
2. 工具依照一組突變規則（mutation operator）掃過程式，每次只改**一個地方**，產生一個突變體（mutant）。常見規則：`>=` ↔ `>`、`<` ↔ `<=`、`+` ↔ `-`、`and` ↔ `or`、常數加一、`True` ↔ `False`、把 `return x` 換成 `return None`。
3. 對每個突變體跑測試。
   - 至少一個測試失敗：**被殺**（killed），這個改動有測試在看。
   - 測試仍然全綠：**存活**（survived），這個地方改壞了也沒人知道。
4. 得到突變分數（被殺數 / 總數）與存活清單。

真正有用的是**存活清單**，不是分數。每一個存活的突變體都是一個具體的問題：「把第 6 行的 `>=` 換成 `>`，你的測試沒發現」。對照它補一個邊界案例，通常就能殺掉。

有些突變體殺不掉，是因為改了之後行為根本沒變，叫做**等價突變體**（equivalent mutant）。例如在一個 `x` 只可能是正整數的地方，把 `x > 0` 換成 `x >= 1`。這類只能人工判斷後略過，所以突變分數不追求 100%。

成本也要算：每個突變體都要重跑一次（相關的）測試，突變體數量和程式大小成正比。實務上只對核心邏輯（金額、權限、狀態轉換）跑，或只對 MR 改到的檔案跑，排在夜間 CI，而不是每次 commit 都全量跑。

## 實際程式：一個迷你突變器

下面用 Python 標準函式庫的 `ast` 實作突變測試的核心：解析原始碼、每次改一個節點、`compile` 後執行測試。兩組測試在原程式上都是綠的，差別在殺掉多少突變體。

```python run
import ast
import copy

# ── 被測程式：訂單總額 = 小計 + 運費；會員滿 500、非會員滿 1000 免運 ──
SOURCE = """
def order_total(subtotal, member):
    if subtotal < 0:
        raise ValueError("subtotal must be >= 0")
    threshold = 500 if member else 1000
    fee = 0 if subtotal >= threshold else 80
    return subtotal + fee
"""

# ── 測試 A：AI 常寫出的樣子（每一個都會過，但幾乎什麼都沒驗） ──
def tests_weak(f):
    assert f(300, False) > 0                      # 斷言太弱：只要是正數就過
    assert f(1200, False) == f(1200, False)       # 拿自己的輸出當期望值
    assert f(500, True) in (500, 580)             # 兩種答案都接受
    try:
        f(-1, False)                              # 沒拋例外也不會失敗
    except ValueError:
        pass

# ── 測試 B：期望值來自規格，並且踩在門檻兩側 ──
def tests_strong(f):
    assert f(300, False) == 380
    assert f(999, False) == 1079
    assert f(1000, False) == 1000
    assert f(499, True) == 579
    assert f(500, True) == 500
    try:
        f(-1, False)
    except ValueError:
        pass
    else:
        raise AssertionError("negative subtotal accepted")

# ── 迷你突變器：每個突變體只改一個地方 ──
CMP_SWAP = {ast.Lt: ast.LtE, ast.LtE: ast.Lt, ast.Gt: ast.GtE, ast.GtE: ast.Gt}
BIN_SWAP = {ast.Add: ast.Sub, ast.Sub: ast.Add, ast.Mult: ast.Div}

def mutations(tree):
    """產生 (說明, 突變後的樹)。用節點在 ast.walk 中的位置找回複本裡的同一個節點"""
    for i, node in enumerate(ast.walk(tree)):
        if isinstance(node, ast.Compare) and type(node.ops[0]) in CMP_SWAP:
            new = CMP_SWAP[type(node.ops[0])]
            def change(n, new=new): n.ops[0] = new()
        elif isinstance(node, ast.BinOp) and type(node.op) in BIN_SWAP:
            new = BIN_SWAP[type(node.op)]
            def change(n, new=new): n.op = new()
        elif isinstance(node, ast.Constant) and type(node.value) is int and node.value > 0:
            def change(n): n.value = n.value + 1
        else:
            continue
        mutant = copy.deepcopy(tree)
        target = list(ast.walk(mutant))[i]
        before = ast.unparse(node)
        change(target)
        yield f"line {node.lineno}: {before}  ->  {ast.unparse(target)}", mutant

def load(tree):
    ns = {}
    exec(compile(tree, "<mutant>", "exec"), ns)
    return ns["order_total"]

def survives(tests, func):
    try:
        tests(func)
        return True          # 測試全過：突變體存活
    except Exception:
        return False         # 有測試失敗（或例外）：突變體被殺

tree = ast.parse(SOURCE)
all_mutants = list(mutations(tree))
for name, tests in (("weak", tests_weak), ("strong", tests_strong)):
    tests(load(tree))        # 兩組測試在原程式上都是綠的（失敗會直接丟 AssertionError）
    alive = [desc for desc, m in all_mutants if survives(tests, load(m))]
    print(f"[{name}] killed {len(all_mutants) - len(alive)}/{len(all_mutants)}")
    for desc in alive:
        print("   survived", desc)
```

讀輸出：

- `weak` 那組 6 個突變體全部存活。它的四個測試分別是斷言太弱、拿自己比自己、對錯都接受、try/except 不會失敗——正好是上一節的三種假綠燈。
- `strong` 那組殺掉 5 個，唯一存活的是 `subtotal < 0` 變成 `subtotal <= 0`：沒有任何測試用到「小計剛好是 0」。要不要補這個測試，取決於規格：小計 0 元的訂單是合法的嗎？突變測試把這個問題攤出來，答案還是要從規格來。

`copy.deepcopy` 加上「用 `ast.walk` 的位置找回同一個節點」是這段程式的關鍵：每個突變體都從原始的樹複製出來，只改一處，彼此不會互相污染。

### 真實工具：mutmut 與 Stryker

- **mutmut**（Python）：在 pytest 之上做的突變測試工具。基本流程是 `mutmut run` 產生並執行突變體，再用 `mutmut results` 列出存活的、`mutmut show <突變體>` 看某一個的 diff。設定（要突變哪些路徑、怎麼跑測試）寫在 `pyproject.toml` 或 `setup.cfg`。2.x 與 3.x 之間的指令輸出與設定方式有改動，照專案實際安裝的版本看文件。
- **Stryker**（JavaScript / TypeScript，另有 C#、Scala 版）：`npx stryker run`，產出 HTML 報告標出每個存活的突變體。

以下是示意，需要安裝套件，不能在瀏覽器執行：

```bash
uv add --dev mutmut
uv run mutmut run          # 產生突變體並逐一跑測試（第一次會花不少時間）
uv run mutmut results      # 列出存活的突變體
```

### 另一種補法：性質測試

邊界案例是人想出來的，想不到的就漏掉。**性質測試**（property-based testing）改成描述「對所有輸入都應該成立的性質」，由工具產生大量輸入去找反例。Python 的 Hypothesis 用 `@given` 搭配策略（strategy）產生資料，找到失敗的輸入後會自動縮小（shrinking）成最簡單的反例：

```python
from hypothesis import given, strategies as st

@given(st.integers(min_value=0, max_value=100_000), st.booleans())
def test_total_never_less_than_subtotal(subtotal, member):
    # 性質：總額 = 小計 + 運費，運費只會是 0 或 80
    total = order_total(subtotal, member)
    assert total - subtotal in (0, 80)

@given(st.integers(min_value=1000, max_value=100_000), st.booleans())
def test_large_orders_ship_free(subtotal, member):
    # 性質：滿 1000 不論是否會員都免運
    assert order_total(subtotal, member) == subtotal
```

第一個性質能殺掉 `+` 換 `-` 的突變體；第二個能殺掉非會員門檻被改大的突變體。性質測試和範例測試互補：性質描述大方向，範例釘死邊界上的具體值。

## 常見錯誤與錯誤訊息

| 現象 | 原因 | 處理 |
|---|---|---|
| 突變測試一開始就報告「測試在未突變的程式上失敗」 | 測試本身不穩定，或依賴執行順序、時間、網路 | 先修好 flaky 測試；突變測試的前提是原程式全綠且結果可重現 |
| 突變測試跑幾個小時 | 每個突變體都跑整套測試，且包含慢的整合測試 | 限定突變的路徑；只對 MR 改到的檔案跑；把慢測試排除在突變流程外 |
| 存活的突變體大多是 log 字串、錯誤訊息文字 | 突變規則改了不影響行為的字串 | 在工具設定排除這類檔案或程式行；不用為了分數去斷言 log 內容 |
| 某個突變體怎麼補測試都殺不掉 | 可能是等價突變體 | 確認改動後行為是否真的相同；相同就標記略過 |
| 重構後一大片測試紅，但行為沒變 | 測試耦合實作細節（mock 呼叫次數、私有欄位） | 改成透過公開介面驗證行為 |
| 修了 bug，反而有測試紅 | 期望值是當初從錯誤輸出抄來的 | 對照規格確認後修正期望值，並在 PR 說明 |
| `AssertionError: ValueError not raised` | 這是好事：原本 try/except 吞掉的情況，換成 `assertRaises` 後終於被抓到 | 回頭檢查驗證邏輯 |

review AI 寫的測試時，可以照這個順序看：每個測試有沒有**具體的期望值**、期望值是不是**從規格推得出來**、例外是不是用 `raises` 檢查、有沒有踩在門檻**兩側**、有沒有 mock 驗呼叫次數或讀私有欄位。

## 動手

1. 在 Playground 執行上面的迷你突變器，在 `tests_strong` 加一行 `assert f(0, False) == 80`，重跑，看最後一個突變體是否被殺。
2. 在 `BIN_SWAP` 加一條 `ast.Add: ast.Mult` 的規則（記得先拿掉原本的 `ast.Add: ast.Sub`，dict 的 key 不能重複），觀察 `tests_weak` 能不能殺掉它。
3. 把 `tests_strong` 裡 `f(999, False) == 1079` 那行刪掉，看哪個突變體重新存活，想想為什麼門檻兩側都要測。
4. 做程式題 `test-quality-1`：把一組 AI 補的假綠燈測試改到能殺掉四個指定的突變體。
5. 延伸：測試要在 CI 擋住合併，見 [AI 改程式的品質閘門](#/skill/ai-quality-gates)；驗收清單怎麼規定「不得改規範測試」，見 [驗收設計](#/skill/acceptance-design)。

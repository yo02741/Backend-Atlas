## 從一個具體問題開始：同一個 bug 修了三次

一個訂單頁的小計功能，跟 AI 一起開發。過程中陸續補了兩條規範，都是在對話裡講的：

- 第 3 輪：「金額顯示要有千分位，`12345` 要顯示成 `12,345`。」AI 改好了。
- 第 7 輪：「數量不可以有小數，輸入 `2.5` 要擋下來。」AI 也改好了。

兩週後，另一個 session 處理「折扣後金額差 1 元」的 bug。AI 為了處理四捨五入，把格式化改成 `f"{total:.0f}"`——差 1 元修好了，千分位不見了。再下一個 session 修千分位，AI 順手把數量解析改成 `int(float(value))` 讓程式「更寬容」，`2.5` 被默默截成 `2`，小數規範也沒了。每一次修改都通過了當下所有的測試，因為這兩條規範從來沒有被寫成測試。

規範只存在於某一段對話裡。下一個 session 看不到它，下一個人也看不到它；改壞的時候，沒有任何東西會失敗。bug 就在「修 A 壞 B、修 B 壞 A」之間循環。

## 運作原理：讓規範變成會失敗的東西

解法是讓每一條規範都有一個**可執行的形式**：一個測試。規範被改壞時，測試會失敗，CI 會擋下 merge，不需要任何人或任何 agent 記得當初說過什麼。

### 一條規範至少一個測試，測試名稱就是規範

```text
規範                              測試
金額顯示要有千分位          →     test_amount_has_thousands_separator
數量不可以有小數            →     test_quantity_rejects_decimal
數量必須大於 0              →     test_quantity_rejects_zero_and_negative
```

測試名稱寫成規範本身，失敗時一眼就知道哪條規範被破壞了，而不是 `test_format_2` 這種要打開才看得懂的名字。

規範的來源不只對話。票上的驗收項目（見[把需求拆成垂直切片](#/skill/ai-vertical-slices)）本來就該寫成可以檢查的句子，例如「只能取消自己的掛號，別人的回 404」，這一句幾乎可以原封不動變成一個測試。開發途中冒出來的新規範，處理方式也一樣：當下就補一個測試，而不是只在對話裡回一句「好，已修改」。判斷標準很簡單——如果這條規則被改壞了會有人來抱怨，它就值得一個測試。

邊界值要明確寫出來。「數量必須是正整數」至少包含幾種輸入：`0`、負數、`2.5`、字串 `"2.5"`、空字串。只測 `2.5` 的話，之後有人把檢查改成「只擋 float 型別」，字串 `"2.5"` 就會溜過去，而測試仍然是綠的。

### red → green → refactor

TDD（Test-Driven Development，測試驅動開發）的循環有三步：

| 步驟 | 做什麼 | 這一步確認了什麼 |
|---|---|---|
| **Red** | 先寫一個測試，執行它，**親眼看它失敗** | 測試真的測到了這條規範——程式還沒做，所以它一定要失敗 |
| **Green** | 寫剛好足以讓測試通過的程式 | 程式滿足了規範 |
| **Refactor** | 在全部測試都綠的狀態下整理程式 | 整理過程沒有破壞任何規範 |

Red 這一步最容易被跳過，也最不該跳過。一個從來沒失敗過的測試，可能根本沒有測到東西：斷言寫錯了、測到的是另一個函式、`assert` 寫成了永遠成立的條件。只有先看到它在「還沒實作」時失敗，才能相信它在「被改壞」時也會失敗。

失敗的**種類**也要對。`ImportError: cannot import name 'format_amount'` 只說明函式還不存在，不能證明測試會抓到「沒有千分位」。正確的 red 是先放一個空的或錯的實作，看到**斷言失敗**：

```text
AssertionError: '1234567' != '1,234,567'
```

### 測試是 AI 不能改壞的契約

測試寫好之後，它的角色就變了：它是規範的正本。AI 修其他 bug 時：

- **不得修改既有測試的預期值**。如果修 bug 需要改既有測試才能通過，代表這個修法違反了某條規範，應該停下來回報，而不是改測試。
- **規範真的要改，由人改測試**，並在 PR 說明為什麼。這是一個決策，不是實作細節。
- **新的 bug 先寫重現測試**。每個 bug 修完都留下一個測試，同一個 bug 就不會再回來。

review 時順序也要調整：**先看測試的 diff，再看程式的 diff**。測試沒有被放寬（預期值沒改、沒有被 skip、斷言沒有被刪），程式的改動才有被檢驗過。

## 實際程式：一輪 red → green

本站的 Python 執行環境（Pyodide）沒有 pytest，下面用標準函式庫的 `unittest`。`run_tests` 把結果印到畫面上，失敗不會中斷執行，方便觀察 red 與 green。

### Red：先寫測試，配一個錯的實作

```python run
import sys
import unittest


# 還沒實作：先放「明顯不符合規範」的版本，確認測試會失敗在斷言上
def format_amount(amount: int) -> str:
    return str(amount)


def parse_quantity(value) -> int:
    return int(float(value))


class TestOrderSpec(unittest.TestCase):
    # 規範 1：金額顯示要有千分位
    def test_amount_has_thousands_separator(self):
        self.assertEqual(format_amount(1234567), "1,234,567")
        self.assertEqual(format_amount(999), "999")

    # 規範 2：數量不可以有小數
    def test_quantity_rejects_decimal(self):
        for bad in (2.5, "2.5"):
            with self.assertRaises(ValueError, msg=f"{bad!r} 應該被拒絕"):
                parse_quantity(bad)

    # 規範 3：數量必須大於 0
    def test_quantity_rejects_zero_and_negative(self):
        for bad in (0, -1, "-3"):
            with self.assertRaises(ValueError, msg=f"{bad!r} 應該被拒絕"):
                parse_quantity(bad)


def run_tests(case):
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(case)
    result = unittest.TextTestRunner(stream=sys.stdout, verbosity=2).run(suite)
    print("GREEN" if result.wasSuccessful() else f"RED：{len(result.failures)} 個斷言失敗、{len(result.errors)} 個錯誤")


run_tests(TestOrderSpec)
```

三個測試都會失敗，而且都是 `AssertionError` 或 `ValueError not raised`——斷言失敗，不是 import 錯誤。這才是有效的 red。

### Green：寫剛好讓測試通過的程式

```python run
import sys
import unittest


def format_amount(amount: int) -> str:
    # 格式規格的 "," 會每三位加一個逗號；負號會留在最前面
    return f"{amount:,}"


def parse_quantity(value) -> int:
    # bool 是 int 的子類別（True == 1），要先排除
    if isinstance(value, bool):
        raise ValueError("數量必須是正整數")
    if isinstance(value, int):
        quantity = value
    elif isinstance(value, str) and value.strip().isdigit():
        quantity = int(value.strip())
    else:
        # float（包括 3.0）、"2.5"、"-3"、"" 都走到這裡
        raise ValueError("數量必須是正整數")
    if quantity <= 0:
        raise ValueError("數量必須是正整數")
    return quantity


class TestOrderSpec(unittest.TestCase):
    def test_amount_has_thousands_separator(self):
        self.assertEqual(format_amount(1234567), "1,234,567")
        self.assertEqual(format_amount(999), "999")

    def test_quantity_rejects_decimal(self):
        for bad in (2.5, "2.5"):
            with self.assertRaises(ValueError, msg=f"{bad!r} 應該被拒絕"):
                parse_quantity(bad)

    def test_quantity_rejects_zero_and_negative(self):
        for bad in (0, -1, "-3"):
            with self.assertRaises(ValueError, msg=f"{bad!r} 應該被拒絕"):
                parse_quantity(bad)

    # 千分位曾在修別的 bug 時被改壞過：把當時出錯的金額留成一個測試，之後誰改壞都會紅
    def test_seven_digit_total_keeps_separator(self):
        self.assertEqual(format_amount(1000000), "1,000,000")


def run_tests(case):
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(case)
    result = unittest.TextTestRunner(stream=sys.stdout, verbosity=2).run(suite)
    print("GREEN" if result.wasSuccessful() else f"RED：{len(result.failures)} 個斷言失敗、{len(result.errors)} 個錯誤")


run_tests(TestOrderSpec)
```

現在回到開頭的情境：如果有人為了修四捨五入把 `format_amount` 改成 `f"{amount:.0f}"`，`test_amount_has_thousands_separator` 會立刻失敗，訊息直接寫著 `'1234567' != '1,234,567'`。規範不再依賴任何人的記憶。

Refactor 這一步在這裡沒什麼可做；在較大的程式裡，例如把 `parse_quantity` 的三個 `raise` 合併、抽出共用的驗證，都是在全綠的保護下進行，每改一步就重跑一次。

### 怎麼要求 AI 先寫失敗的測試

AI 被要求「實作某功能」時，通常會一次交出實作與測試，而且測試往往是照著實作寫的——這樣的測試只證明「程式做了程式做的事」。要把 red 拆成獨立的一步：

```text
這次只寫測試，不要寫實作。

規範：
1. 金額顯示要有千分位（1234567 → "1,234,567"）
2. 數量不可以有小數（2.5、"2.5" 要 raise ValueError）

要求：
- 每條規範至少一個測試，測試名稱寫出規範本身
- 實作先放一個明顯錯誤的版本（例如直接 return str(amount)）
- 執行測試，把失敗訊息貼出來；失敗必須是斷言失敗，不能是 ImportError 或 NameError
- 不要修改 tests/ 底下既有的測試
```

確認失敗訊息合理後，第二步才請它實作：「讓這些測試通過，不得修改測試檔。」

專案規範檔（給 agent 讀的那份）可以寫成固定規則：

```text
- 新規範：先加測試並確認失敗，再實作。
- 修 bug：先寫重現這個 bug 的測試並確認失敗，再修。
- 不得修改既有測試的預期值、不得加 skip。若修法需要改既有測試，停下來說明是哪個測試、為什麼。
```

規則寫在規範檔是第一層，機械檢查是第二層：CI 一定要跑全部測試（見 [AI 改程式的品質閘門](#/skill/ai-quality-gates)）；也可以用 CODEOWNERS 讓測試目錄的改動需要指定的人核准（GitHub 與 GitLab 都有這個機制，能不能強制核准依平台與方案而定）。

## 常見錯誤與錯誤訊息

| 看到的訊息 | 代表什麼 | 怎麼處理 |
|---|---|---|
| `AssertionError: '1234' != '1,234'` | 正確的 red（或規範被改壞了）。左邊是實際值、右邊是預期值 | 改程式，不要改右邊的預期值 |
| `AssertionError: ValueError not raised` | 應該拒絕的輸入被接受了 | 檢查驗證邏輯，例如 `int(float(x))` 會把小數截掉而不是拒絕 |
| `ImportError: cannot import name …` / `NameError: name … is not defined` | 函式不存在，測試根本沒跑到斷言 | 先放一個錯的實作，讓失敗變成斷言失敗 |
| 測試第一次執行就全綠 | 測試可能沒測到東西，或測的是已經存在的行為 | 故意把實作改壞，確認測試會紅 |
| PR 裡測試的預期值被改了，CI 是綠的 | 規範被刪除了，綠燈沒有意義 | 退回；規範要改由人決定 |
| `@unittest.skip` 或 `pytest.mark.skip` 出現在 diff 裡 | 規範被暫停了 | 要求說明理由與期限，預設退回 |

還有兩種不會出現錯誤訊息的情況：

- **測試照著實作寫**：先有程式，再讓 AI「補測試」，它會把程式現在的行為（包括 bug）寫成預期值。補測試時要給它規範，不是給它程式。
- **測試耦合實作細節**：測試檢查內部函式被呼叫了幾次、私有欄位的值。這種測試在重構時會失敗，但規範並沒有被破壞，久了大家就習慣「測試紅了就改測試」。測試要透過公開介面檢查行為。

## 動手

1. 在 Playground 執行 Red 那段，確認看到三個失敗，都是斷言失敗。
2. 執行 Green 那段，然後把 `format_amount` 改成 `return f"{amount:.0f}"`，重跑，看哪個測試紅、訊息怎麼寫。
3. 在 Green 那段把 `parse_quantity` 改回 `int(float(value))`，看哪些測試失敗。
4. 加一條規範「金額前面要有 `NT$ `」：先改測試、看它紅，再改程式讓它綠。
5. 做程式題 `ai-spec-to-tests-1`：起始碼是被改壞的版本，修到所有規範測試通過。

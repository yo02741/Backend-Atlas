## 這階段要做出什麼

把掛號規則寫成一個不碰資料庫、不碰 HTTP、不自己讀時鐘的 Python 模組（例如 `clinic/domain.py`），並用測試把每條規則的邊界釘住。

| 規則 | 函式 | 失敗時 |
|---|---|---|
| 看診前一日 17:00（台北時間）前可取消 | `cancel_deadline(appointment_time)`、`can_cancel(appointment_time, now)` | 回 `False` |
| 同一病患在同一診次只能有一筆有效掛號 | `book(...)` | `AlreadyBooked` |
| 診次的有效掛號數不能超過名額 | `book(...)` | `SessionFull` |
| 同一病患同一天最多 3 筆有效掛號 | `book(...)` | `DailyLimitExceeded` |
| 號碼從 1 開始，取消的號碼不回收 | `book(...)` | — |

「有效」指狀態是 `booked` 或 `checked_in`；`cancelled` 不佔名額，也不算進每日上限。三個例外都繼承同一個 `BookingError`，API 層只要抓 `BookingError` 就能接住所有業務規則錯誤，再依子類別決定狀態碼。

Python 的資料類別、例外、型別提示在 [Python 後端基礎](#/skill/python-backend)；測試的層次與 pytest 寫法在 [測試金字塔與 pytest](#/skill/testing)。

## 設計決策與取捨

### 時間從參數傳進來

`can_cancel` 不在函式裡呼叫 `datetime.now()`，而是要求呼叫端傳 `now`。這是讓時間相關規則可以測試的最簡單做法：測試可以直接給「11/02 16:59:59」和「11/02 17:00:00」，不用等到真的那個時間，也不用 mock 標準函式庫。正式程式在最外層（API handler）取一次 `datetime.now(TPE)` 往下傳，整個請求用同一個「現在」，也避免同一個請求裡前後兩次取時間剛好跨過 17:00。

### 時區

規則講的是「台北時間 17:00」，所以期限一定要用台北時區算。這個站的 Python 執行環境（Pyodide）沒有 `zoneinfo` 的時區資料，範例一律用固定位移 `timezone(timedelta(hours=8))`。台灣目前沒有實施日光節約時間，固定 +8 在這個系統裡算得出正確答案；在一般伺服器上，用 `zoneinfo.ZoneInfo("Asia/Taipei")` 比較好，日後規則變動時更新時區資料庫就好，不用改程式。

「前一日」也要用台北時間的日期算。一筆 UTC `11/02 23:30` 的掛號，在台北是 `11/03 07:30`，期限是台北 `11/02 17:00`；如果直接拿 UTC 的日期減一天，會得到 `11/01 17:00`，整整差了一天。

### 「17:00 前」的邊界寫成測試

需求文件寫「17:00 前可取消」，但沒說剛好 17:00:00 算不算。這種模糊點最好在寫程式時就決定，並寫成測試，讓測試變成規格的一部分：這裡決定剛好 17:00:00 就**不能**取消，程式用 `<`。之後有人想改成 `<=`，會先看到測試失敗，知道這是一個刻意的決定。

### 業務錯誤用例外，而且有階層

`book()` 失敗的原因有三種，呼叫端需要分辨（第 3 階段：重複掛號與名額已滿都回 409，但錯誤類型不同）。用自訂例外比回傳 `None` 或錯誤字串好：

- 呼叫端忘了處理時，例外會往外丟，不會默默把 `None` 當成成功
- 子類別可以各自帶資料（例如哪個診次、目前幾筆）
- 共同的父類別讓「所有業務錯誤」可以一次接住，程式錯誤（`KeyError`、`TypeError`）則照樣變成 500

### 檢查順序也是規格

同一個請求可能同時違反好幾條規則：已經掛過、而且名額也滿了。回哪個錯誤會直接影響使用者看到的訊息，所以順序要固定：**重複 → 名額 → 每日上限**。「你已經掛過了」比「名額已滿」更有用，因為使用者其實不需要再掛。

### 號碼不回收

取消的號碼不再發出去。這是一個業務決定，不是技術限制：診間外的叫號螢幕、病患手上的號碼單都以號碼溝通，同一個號碼出現兩個人會造成混亂。代價是號碼可能大於名額（名額 30 的診次，有人取消後再掛，可能出現 31 號）。如果醫院要求號碼必須連續，就是另一套規則，資料表與第 5 階段的取號方式都要跟著改。

### 這個模組在系統裡的位置

這裡的 `book()` 拿一個 list 當作「目前所有掛號」，是規則的模型，用來把規則說清楚、測清楚。正式系統裡掛號資料在資料庫，「數一數有幾筆再決定」在並行時會出事——兩個請求同時數到 29 筆，都判斷還有名額。第 5 階段會把名額檢查搬進一句原子的 SQL；領域模組保留的是「錯誤怎麼分類、順序怎麼排、期限怎麼算」，這些不會因為搬進資料庫而改變。

## 關鍵程式

取消期限的實作，連同幾個邊界一起執行：

```python run
from datetime import datetime, time, timedelta, timezone

TPE = timezone(timedelta(hours=8))


def cancel_deadline(appointment_time: datetime) -> datetime:
    if appointment_time.tzinfo is None:
        raise ValueError("appointment_time 必須帶時區")
    local_day = appointment_time.astimezone(TPE).date()   # 先換成台北時間再取日期
    return datetime.combine(local_day - timedelta(days=1), time(17, 0), tzinfo=TPE)


def can_cancel(appointment_time: datetime, now: datetime) -> bool:
    if now.tzinfo is None:
        raise ValueError("now 必須帶時區")
    return now < cancel_deadline(appointment_time)        # 剛好 17:00 不行


appt = datetime(2026, 11, 3, 9, 0, tzinfo=TPE)
cases = [
    ("前一日 16:59:59（台北）", datetime(2026, 11, 2, 16, 59, 59, tzinfo=TPE)),
    ("前一日 17:00:00（台北）", datetime(2026, 11, 2, 17, 0, 0, tzinfo=TPE)),
    ("前一日 08:59:59（UTC）", datetime(2026, 11, 2, 8, 59, 59, tzinfo=timezone.utc)),
    ("前一日 09:00:00（UTC）", datetime(2026, 11, 2, 9, 0, 0, tzinfo=timezone.utc)),
]
print("期限：", cancel_deadline(appt))
for label, now in cases:
    print(f"{label:<20} → {can_cancel(appt, now)}")

# UTC 日期與台北日期不同的情況
late = datetime(2026, 11, 2, 23, 30, tzinfo=timezone.utc)   # 台北 11/03 07:30
print("UTC 11/02 23:30 的期限：", cancel_deadline(late))
```

正式專案用 pytest 時，邊界最適合寫成參數化測試，一列就是一條規格（需要安裝 pytest，不能在瀏覽器裡跑）：

```python
import pytest
from datetime import datetime, timezone
from clinic.domain import TPE, can_cancel

APPT = datetime(2026, 11, 3, 9, 0, tzinfo=TPE)

@pytest.mark.parametrize("now, expected", [
    (datetime(2026, 11, 2, 16, 59, 59, tzinfo=TPE), True),
    (datetime(2026, 11, 2, 17, 0, 0, tzinfo=TPE), False),             # 邊界：剛好 17:00
    (datetime(2026, 11, 2, 9, 0, 0, tzinfo=timezone.utc), False),     # 同一時間點的 UTC 表示
    (datetime(2026, 11, 3, 8, 0, tzinfo=TPE), False),                 # 看診當天
])
def test_can_cancel(now, expected):
    assert can_cancel(APPT, now) is expected

def test_naive_now_is_rejected():
    with pytest.raises(ValueError):
        can_cancel(APPT, datetime(2026, 11, 2, 12, 0))
```

`book()` 的測試同樣以邊界為主：名額 2 的診次第 2 筆成功、第 3 筆失敗；取消一筆之後又能掛；同一天第 3 診成功、第 4 診失敗、改掛別天成功。每個測試自己建資料，不依賴其他測試留下的狀態。

## 常見錯誤與錯誤訊息

**比較有時區和沒時區的 datetime。** `datetime.now()` 不帶時區，拿它跟帶時區的期限比較，Python 直接丟例外：

```
TypeError: can't compare offset-naive and offset-aware datetimes
```

這個錯誤其實是在保護你：沒有時區的時間不知道是哪裡的幾點。修法是在最外層用 `datetime.now(TPE)`（或 `datetime.now(timezone.utc)`）取時間，並在領域函式入口檢查 `tzinfo`，讓錯誤在最靠近原因的地方出現。

**用 UTC 日期算「前一日」。** 不會報錯，但期限差一天，而且只有在台北時間 00:00–08:00 的掛號才會錯，測試資料剛好都在白天時永遠測不到。測試裡要刻意放一筆這個時段的資料。

**`<=` 和 `<` 搞混。** 剛好 17:00:00 的行為和需求不一致，通常要到客訴才發現。邊界值一定要有對應的測試。

**先改資料再檢查。** 例如先 `appointments.append(...)` 再檢查每日上限，失敗時忘了移除，list 裡就多了一筆幽靈掛號。規則全部檢查完才修改狀態。

**數名額時把已取消的也算進去。** 名額會越取消越少。反過來，算號碼時**要**把已取消的算進去，否則號碼會被重複發出。這兩件事看的是不同的集合，最好分成兩個變數。

**測試依賴真實時鐘。** `can_cancel(appt, datetime.now(TPE))` 這種測試在某些時間跑會過、某些時間不會，CI 上偶發失敗很難查。時間一律從參數給。

## 驗收題在測什麼

**取消期限**：期限的值與時區、16:59:59 與 17:00:00 的邊界、用 UTC 表示同一時間點也要算對、UTC 日期與台北日期不同時的「前一日」、看診當天之後不能取消、沒帶時區要 `ValueError`。

**掛號規則**：第一筆是 1 號、名額剛好滿時的成功與失敗、失敗時 list 不被改動、取消不佔名額但號碼不回收、取消後可以重掛、每日上限（別天與已取消的不算）、多條規則同時違反時的順序、例外的繼承關係。

測試只檢查行為，不限制實作方式。下一階段把這些例外接到 HTTP：每一種失敗對應一個狀態碼與一致的錯誤格式。

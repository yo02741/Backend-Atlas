## 從一個具體問題開始：同一筆訂單，三個地方三個樣子

後端從資料庫讀出一筆訂單，回傳給前端：

```json
{"order_id": 9007199254740993, "customer": "王小明", "amount": 0.30000000000000004, "created_at": "2026-10-20 01:30:00"}
```

接著發生三件事：

- 前端畫面上的訂單編號是 `9007199254740992`，比資料庫裡的少 1。拿這個編號回查，查不到。
- 金額是三筆 `0.1` 元的手續費加起來的，畫面顯示 `0.30000000000000004`；對帳時和金流的數字差了一點點。
- 訂單時間 `01:30`，客服說客人明明是早上 9:30 下單的。

這三個問題的共同點：資料在**程式內部的型別**和**傳輸或儲存的格式**之間轉換時，被用不同的規則解讀了。數字、文字、時間、金額各有自己的陷阱。

## 文字：字元、Unicode 與 UTF-8 位元組

電腦存的是位元組（byte），文字是人看的。中間要有兩層對應：

1. **Unicode** 給每個字元一個編號（code point）：`A` 是 U+0041，`中` 是 U+4E2D，`😀` 是 U+1F600。
2. **編碼**（encoding）決定編號怎麼變成位元組。**UTF-8** 是目前網路與多數系統的預設：ASCII 字元 1 個位元組，常用中文 3 個，emoji 4 個。

Python 3 把兩者分成兩種型別：`str` 是字元序列，`bytes` 是位元組序列。`encode` 從字元變位元組，`decode` 反過來。

```python run
# str 與 bytes 是兩種東西；encode / decode 在兩者之間轉換
for s in ["A", "é", "中", "😀"]:
    b = s.encode("utf-8")
    print(f"{s!r}: {len(s)} 個字元 → {len(b)} 個位元組 {b.hex(' ')}")

name = "王小明😀"
print(len(name), "個字元，", len(name.encode("utf-8")), "個位元組")

# 依位元組截斷，可能切在一個字的中間
raw = "後端工程".encode("utf-8")[:7]
print(raw)
print("errors='replace'：", raw.decode("utf-8", errors="replace"))
try:
    raw.decode("utf-8")
except UnicodeDecodeError as e:
    print("UnicodeDecodeError:", e)
```

「長度」因此有三種意思：字元數、位元組數、畫面上佔的寬度。欄位限制要講清楚是哪一種：PostgreSQL 的 `varchar(20)` 算的是**字元**；網路協定、訊息佇列、某些 API 的大小上限算的是**位元組**。MySQL 的 `utf8` 字元集其實最多 3 個位元組（`utf8mb3`），存不了 emoji，要用 `utf8mb4`。

### 亂碼怎麼來

亂碼幾乎都是同一件事：**位元組本身沒壞，是被用錯的編碼解讀**。

```python run
text = "café 中文"
data = text.encode("utf-8")

# 用錯的編碼去解讀同一串位元組
print("當成 latin-1 解：", data.decode("latin-1"))
print("當成 cp950 解：", data.decode("cp950", errors="replace"))

# 反過來：Big5 / cp950 的位元組被當成 UTF-8 解，通常直接報錯
big5 = "中文".encode("big5")
print("Big5 位元組：", big5.hex(" "))
try:
    big5.decode("utf-8")
except UnicodeDecodeError as e:
    print("UnicodeDecodeError:", e)

# 中間沒有遺失位元組的話，亂碼可以反向救回
broken = data.decode("latin-1")
print("救回：", broken.encode("latin-1").decode("utf-8"))

# 加上 BOM 的 UTF-8（utf-8-sig）開頭多三個位元組 EF BB BF
print("utf-8-sig：", "id".encode("utf-8-sig"))
```

實務規則：

- **在邊界明確指定編碼**：`open(path, encoding="utf-8")`、HTTP 回應的 `Content-Type: application/json; charset=utf-8`、資料庫連線的 client encoding。不指定時用的是平台預設，在不同機器上會不一樣。
- **程式內部一律用 `str`**，只在讀進來與寫出去的那一刻 decode / encode。
- 用 `errors="replace"` 或 `errors="ignore"` 是把錯誤藏起來，只適合「顯示用、壞了也沒關係」的場合；資料匯入應該讓它報錯，找出來源到底是什麼編碼。
- 要給 Excel 開的 CSV，常見做法是用 `utf-8-sig` 寫出（加 BOM），否則中文可能顯示成亂碼；這是 Excel 判斷編碼的行為，與資料本身無關。

## 序列化：JSON 能表達什麼、不能表達什麼

**序列化**是把記憶體裡的物件變成可以傳輸或儲存的位元組（反過來叫反序列化）。API 最常用 JSON，它只有六種型別：string、number、boolean、null、object、array。

Python 的型別對過去會遺失資訊：

| Python | JSON | 遺失了什麼 |
|---|---|---|
| `tuple` | array | 變成 list，回來就不是 tuple |
| `dict` 的 int key | string key | `{1: "a"}` 回來是 `{"1": "a"}` |
| `datetime`、`date` | 沒有 | `json.dumps` 直接 `TypeError`，要自己決定格式 |
| `Decimal` | 沒有 | 同上；轉成 float 會丟精度 |
| `bytes` | 沒有 | 要先轉 base64 字串 |
| `float("nan")` | 沒有 | Python 預設輸出 `NaN`，但那不是合法 JSON，別的語言會解析失敗 |

```python run
import json
from datetime import datetime, timezone
from decimal import Decimal

print(json.dumps({"ok": True, "n": None, "tags": ("a", "b")}))   # tuple → list、None → null
print(json.loads(json.dumps({1: "a", 2: "b"})))                  # key 變成字串

for value in [datetime.now(timezone.utc), Decimal("19.90"), b"\x00\x01", {1, 2}]:
    try:
        json.dumps(value)
    except TypeError as e:
        print("TypeError:", e)

print(json.dumps(float("nan")))                                  # NaN：不合法的 JSON
try:
    json.dumps(float("nan"), allow_nan=False)                     # 讓它在產生時就報錯
except ValueError as e:
    print("ValueError:", e)

print(json.dumps({"name": "王小明"}))                            # 預設把非 ASCII 跳脫成 \uXXXX
print(json.dumps({"name": "王小明"}, ensure_ascii=False))         # 直接輸出 UTF-8 字元
```

### 大整數：2^53 之後就不準了

JSON 規格本身沒有限制數字大小，但 RFC 8259 提醒：很多實作把數字讀成 IEEE 754 雙精度浮點數。JavaScript 的 `Number` 就是這種浮點數，只能精確表示到 `2^53 − 1`（`Number.MAX_SAFE_INTEGER`，9007199254740991）。超過的整數會被捨入到最接近的可表示值。

Python 的 `int` 沒有上限，所以後端自己測永遠正常，問題出現在前端 `JSON.parse` 的那一刻：

```js run
const body = '{"order_id": 9007199254740993, "amount": "990.00"}'
const data = JSON.parse(body)
console.log(`解析後的 order_id：${data.order_id}`)            // 少了 1
console.log(`安全整數上限：${Number.MAX_SAFE_INTEGER}`)
console.log(`還是安全整數嗎？${Number.isSafeInteger(data.order_id)}`)
console.log(`兩個不同的數字相等？${9007199254740992 === 9007199254740993}`)

// 解法：ID 用字串傳；真的要算再轉 BigInt
const safe = JSON.parse('{"order_id": "9007199254740993"}')
console.log(`字串傳輸：${safe.order_id}，BigInt 運算：${BigInt(safe.order_id) + 1n}`)
```

64 位元的 ID（例如 Snowflake 這類分散式 ID 產生器的輸出）很容易超過 2^53。對外的 API 一律把這類 ID 當**字串**傳，前端只拿來比對與顯示，不做運算。

## 時間：UTC 儲存、ISO 8601 傳輸、顯示時才轉時區

一個時間點要完整，必須帶時區或 UTC 偏移。Python 的 `datetime` 分兩種：

- **naive**：沒有 `tzinfo`，`datetime(2026, 10, 20, 9, 30)` 不知道是哪裡的 9:30
- **aware**：有 `tzinfo`，是一個確定的時間點

規則只有三條：

1. **存 UTC**。程式裡用 `datetime.now(timezone.utc)`，不用 `datetime.now()`（naive、機器的本地時間）也不用 `datetime.utcnow()`（naive，Python 3.12 起已標為 deprecated）。PostgreSQL 用 `timestamptz`：它存的是一個時間點，寫入時依連線時區換算、讀出時換成連線時區顯示；`timestamp`（without time zone）只存數字，不記得是哪個時區。
2. **傳 ISO 8601**（RFC 3339 是它在網路協定上的子集）：`2026-10-20T01:30:00Z` 或 `2026-10-20T09:30:00+08:00`。永遠帶 `Z` 或偏移，不要傳 `2026-10-20 01:30:00` 這種沒有時區的字串。
3. **顯示時才轉**成使用者的時區，而且只在最後一步轉。

台灣是 UTC+8，沒有日光節約時間，所以固定偏移 `timezone(timedelta(hours=8))` 換算是正確的。有日光節約的地區不能用固定偏移，要用 `zoneinfo.ZoneInfo("America/New_York")` 這類 IANA 時區名稱。本站的瀏覽器 Python 沒有時區資料庫，所以範例都用固定偏移。

```python run
from datetime import datetime, timedelta, timezone

TAIPEI = timezone(timedelta(hours=8), "Asia/Taipei")   # 台灣沒有日光節約時間

naive = datetime(2026, 10, 20, 9, 30)                  # 不知道是哪裡的 9:30
aware = datetime(2026, 10, 20, 9, 30, tzinfo=TAIPEI)   # 台北的 9:30
print("naive：", naive.isoformat(), naive.tzinfo)
print("aware：", aware.isoformat())

stored = aware.astimezone(timezone.utc)                # 存：轉成 UTC
print("存進資料庫：", stored.isoformat())
print("API 傳出去：", stored.isoformat().replace("+00:00", "Z"))
print("顯示給台灣使用者：", stored.astimezone(TAIPEI).strftime("%Y-%m-%d %H:%M"))

# Python 3.11 起 fromisoformat 接受結尾的 Z
parsed = datetime.fromisoformat("2026-10-20T01:30:00Z")
print("解析回來：", parsed, "和原本是同一個時間點？", parsed == aware)

try:
    naive < aware                                       # naive 和 aware 不能比較
except TypeError as e:
    print("TypeError:", e)

# 「哪一天」也跟時區有關：UTC 的 10/19 傍晚，台灣已經是 10/20
late = datetime(2026, 10, 19, 17, 0, tzinfo=timezone.utc)
print(late.date(), "→ 台灣日期", late.astimezone(TAIPEI).date())
```

最後一行是報表常見的 bug：「今天的訂單」用 UTC 的日期切，台灣早上 8 點以前的訂單會被算到前一天。依日期分組時，要先轉到業務所在的時區再取日期。

生日、到期日這類**只有日期**的資料，用 `date`（PostgreSQL 的 `date`）存，不要存成某一天午夜的時間點，否則換時區顯示會差一天。

### 時間戳記：秒還是毫秒

Unix 時間戳記是從 1970-01-01T00:00:00Z 起算的經過時間，本身沒有時區問題，但**單位**常常搞混：

| 來源 | 單位 | 現在大約幾位數 |
|---|---|---|
| Python `time.time()`、`datetime.timestamp()` | 秒（float） | 10 位整數部分 |
| JWT 的 `exp`、`iat` | 秒 | 10 位 |
| JavaScript `Date.now()`、Java `System.currentTimeMillis()` | 毫秒 | 13 位 |

```python run
from datetime import datetime, timezone

dt = datetime(2026, 10, 20, 1, 30, tzinfo=timezone.utc)
seconds = int(dt.timestamp())
millis = int(dt.timestamp() * 1000)
print("秒：", seconds, "／毫秒：", millis)

print(datetime.fromtimestamp(seconds, tz=timezone.utc))
print(datetime.fromtimestamp(millis / 1000, tz=timezone.utc))

# 單位搞混的兩種結果
try:
    datetime.fromtimestamp(millis, tz=timezone.utc)       # 毫秒當成秒：年份超出範圍
except (ValueError, OverflowError, OSError) as e:
    print("毫秒當成秒：", type(e).__name__, e)
print("秒當成毫秒：", datetime.fromtimestamp(seconds / 1000, tz=timezone.utc))   # 回到 1970 年
```

畫面上出現 1970 年，或解析時丟出年份超出範圍（訊息的細節依 Python 版本與平台而異，也可能是 `OverflowError`），第一個要懷疑的就是秒與毫秒。API 欄位名稱最好直接寫出單位（`expires_at_ms`），或乾脆傳 ISO 8601 字串。

## 金額：Decimal 或整數分，不用 float

`float` 是二進位浮點數，`0.1` 在二進位裡是無窮循環小數，存進去就已經有誤差。誤差在一次加法裡很小，但累積、比較、四捨五入時就會出現錯誤的結果。

兩種正確做法：

- **`Decimal`**：十進位運算，`Decimal("0.1") + Decimal("0.2") == Decimal("0.3")`。一定要**從字串建立**，`Decimal(0.1)` 會把 float 的誤差一起帶進來。四捨五入用 `quantize` 並指定規則。資料庫對應 `numeric(12, 2)`。
- **整數的最小單位**（分）：990.00 元存成 `99000`。加減乘都是整數運算，沒有誤差；除法要明確決定怎麼取整。不同幣別的小數位數不同（例如日圓沒有小數、美元兩位），要和幣別代碼一起存。

```python run
from decimal import Decimal, ROUND_HALF_UP, ROUND_HALF_EVEN

total = 0.0
for _ in range(10):
    total += 0.1
print("float 加十次 0.1：", total, total == 1.0)
print("0.1 + 0.2 =", 0.1 + 0.2)

print("Decimal：", Decimal("0.1") + Decimal("0.2"))
print("從 float 建立：", Decimal(0.1))           # 誤差一起帶進來
print("從字串建立：", Decimal("0.1"))

# 四捨五入要指定規則
price = Decimal("2.665")
print("ROUND_HALF_UP：", price.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))      # 2.67
print("ROUND_HALF_EVEN：", price.quantize(Decimal("0.01"), rounding=ROUND_HALF_EVEN))  # 2.66
print("float 的 round(2.675, 2)：", round(2.675, 2))   # 2.67：2.675 實際存成 2.67499999...
print("round(2.5), round(3.5)：", round(2.5), round(3.5))   # 2 4：Python 的 round 是銀行家捨入

# 整數分：單價 990.00 元 = 99000 分
subtotal = 99_000 * 3
discount = subtotal * 15 // 100                   # 打 85 折，折扣金額向下取到整數分
print("小計、折扣、應付（分）：", subtotal, discount, subtotal - discount)

# 拆帳：100 元三人分，多出來的一分要分給某個人，總和才對得上
def split(total_cents, n):
    base, rest = divmod(total_cents, n)
    return [base + (1 if i < rest else 0) for i in range(n)]

parts = split(10_000, 3)
print("拆帳：", parts, "總和：", sum(parts))
```

傳輸時，金額用**字串**（`"990.00"`）或**整數分**（`99000`）加上幣別（`"currency": "TWD"`），不要用 JSON number 的小數：對方一用浮點數解析，誤差就回來了。四捨五入規則（四捨五入、銀行家捨入、無條件捨去）是業務規則，要和財務確認，並且寫在同一個函式裡，不要散落各處。

## 常見錯誤與錯誤訊息

| 現象或訊息 | 原因 | 怎麼修 |
|---|---|---|
| `UnicodeDecodeError: 'utf-8' codec can't decode byte 0xa4 in position 0: invalid start byte` | 來源不是 UTF-8（例如 Big5 / cp950 的舊檔案） | 確認來源編碼後用正確的 `encoding` 讀；不要直接加 `errors="ignore"` |
| `UnicodeDecodeError: ... unexpected end of data` | 位元組在一個字的中間被截斷 | 先 decode 成 `str` 再截字元；或用增量解碼器處理串流 |
| 畫面出現 `Ã©`、`ä¸­` | UTF-8 的位元組被當成 latin-1 / cp1252 解讀 | 檢查讀取端的編碼設定與 `Content-Type` 的 charset |
| `TypeError: Object of type datetime is not JSON serializable` | JSON 沒有日期型別 | 轉成 ISO 8601 字串（aware 的 `isoformat()`）；用 pydantic 時它會處理 |
| `TypeError: can't compare offset-naive and offset-aware datetimes` | 混用了有時區與沒時區的 datetime | 在資料進來的邊界統一轉成 aware UTC |
| 前端顯示的 ID 末幾位不對 | 整數超過 2^53，被 JavaScript 的 Number 捨入 | ID 用字串傳 |
| 時間差 8 小時 | 存或傳的是沒有時區的時間，某一端當成 UTC、另一端當成本地時間 | 存 `timestamptz`、傳帶 `Z` 或偏移的 ISO 8601 |
| 日期顯示成 1970 年，或 `ValueError: year must be in 1..9999` | 秒與毫秒搞混 | 看位數（10 位是秒、13 位是毫秒），欄位名稱寫明單位 |
| 對帳差 1 分錢 | 用 float 算錢，或不同地方用了不同的捨入規則 | `Decimal`（從字串建立）或整數分；捨入集中在一個函式 |

## 動手

1. 在 Playground 開啟 UTF-8 那段，把字串換成自己的名字加一個 emoji，看字元數與位元組數差多少。
2. 跑 JavaScript 那段，把 `9007199254740993` 換成 `9007199254740991`、`9007199254740995`，看哪些數字還正確。
3. 改時間那段，把 `late` 改成 UTC 15:59 與 16:00，看台灣日期在哪一刻換日。
4. 做本課的程式題：把含有 `Decimal`、`datetime` 與大整數的物件轉成前端可以安全解析的 JSON。
5. 接著看 [日誌、錯誤處理與設定](#/skill/logging-config)：log 裡的時間戳記同樣要用 UTC 與 ISO 8601。

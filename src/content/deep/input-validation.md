## 從一個具體問題開始：一張金額是負數的訂單

建立訂單的 API 收這樣的 JSON：

```json
{ "items": [{ "product_id": 3, "qty": 1, "price": 7990 }], "coupon": "SPRING", "note": "請放管理室" }
```

上線一個月後，帳上出現了幾筆奇怪的訂單：

- 一筆 `qty: -5`：程式算出負的金額，退款流程把錢「退」給了下單的人。
- 一筆 `price: 1`：伺服器直接用了客戶端傳來的單價，7,990 元的螢幕賣了 1 元。
- 一筆 `items` 有 20 萬個元素：計算金額的迴圈跑了好幾秒，同時間其他請求全部變慢。
- 一筆 `note` 有 5 MB：寫進資料庫、寄進通知信、印進日誌，每一處都受影響。
- 一筆多帶了 `"status": "paid"`：程式用 `Order(**body)` 建立物件，訂單直接變成已付款。

這些請求都沒有「攻擊程式碼」，只是數值、長度、欄位超出了程式設計時的假設。程式在每個用到這些值的地方都默默相信了它們。

## 運作原理：在邊界一次驗完

### 邊界在哪裡

信任邊界是「資料從不受控的地方進入程式」的位置：

| 來源 | 例子 |
|---|---|
| HTTP 請求 | body、query string、path 參數、標頭、cookie |
| 檔案 | 上傳的檔案、匯入的 CSV、解壓縮的內容 |
| 外部系統 | 第三方 API 回應、webhook、訊息佇列的訊息 |
| 使用者可編輯的資料 | 資料庫裡由使用者寫入的欄位，被別的流程讀出來用時 |

做法是**請求一進來就轉成型別明確的物件**，轉不過去就直接拒絕。之後的程式碼拿到的是 `Order` 物件而不是 `dict`：`qty` 一定是 1 到 99 的整數、`note` 一定不超過 500 字。內部函式不需要再驗一次，也不應該各自驗一點，否則規則散落在各處、彼此不一致。這種想法也叫「parse, don't validate」：驗證的結果是新的型別，而不只是一個 true／false。

### 要驗什麼

| 面向 | 例子 | 沒驗會怎樣 |
|---|---|---|
| 型別 | `qty` 是整數，不是字串 `"1"`、不是 `1.5`、不是物件 | NoSQL 運算子注入（`{"$ne": null}`）、型別錯誤 500 |
| 範圍 | `1 <= qty <= 99`；`page >= 1`；`limit <= 100` | 負數金額、一次撈出整張表 |
| 長度與數量 | 字串長度、陣列元素數、巢狀深度、整個 body 大小 | 記憶體與 CPU 被吃光（DoS） |
| 格式 | email、日期、UUID、電話；用解析函式而不是只用正規表示式 | 下游系統解析失敗 |
| 列舉 | `status` 只能是 `pending`、`paid`、`shipped`、`cancelled` 之一 | 不存在的狀態寫進資料庫 |
| 欄位集合 | 不認識的欄位要拒絕或忽略，不能直接套進模型 | mass assignment：使用者自己設定 `role`、`status` |
| 業務規則 | 庫存夠不夠、優惠券是否有效、這筆資料是不是這個使用者的 | 這部分要查資料庫，在服務層做 |

最後一列很重要：**價格、折扣、總金額由伺服器計算**。客戶端傳來的 `price` 頂多拿來和伺服器算出的值比對，不一致就拒絕或以伺服器為準，不能拿來用。

### 允許清單優於拒絕清單

拒絕清單（denylist）是「列出不行的」：擋掉 `<script>`、擋掉 `../`、擋掉 `.php`。它的問題是你必須先想到所有壞輸入：大小寫、URL encoding、Unicode 等價字元、雙重編碼，每一種都是繞過方式。

允許清單（allowlist）是「列出可以的」：使用者名稱只能是 `[a-z0-9_]{3,20}`、副檔名只能是 `jpg`、`png`、`webp`、排序欄位只能是三個值之一。沒想到的輸入預設就被拒絕。

允許清單無法適用的地方（例如自由文字的留言、地址），驗證只能做長度與字元類別，安全性則靠**輸出時**依情境處理（SQL 用參數化、HTML 用跳脫），見 [注入攻擊](#/skill/injection) 與 [XSS、CSRF 與安全標頭](#/skill/xss-csrf)。輸入驗證不能取代輸出處理：留言允許 `<` 是合理的，該跳脫的是輸出。

### 先正規化，再驗證

同一個值可能有多種表示法：`%2e%2e%2f` 解碼後是 `../`；全形字元、組合字元在 Unicode 正規化後可能變成另一個字。驗證必須在**最終要使用的形式**上做：先解碼、正規化（例如 `unicodedata.normalize("NFKC", s)`），再檢查。先驗證再解碼，等於驗證了一個不會被使用的字串。

### pydantic 的角色

Python 後端常用 pydantic（FastAPI 內建）把上面的規則寫成宣告式的 model：

```python
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field

class OrderItem(BaseModel):
    model_config = ConfigDict(extra="forbid")          # 不認識的欄位直接拒絕
    product_id: int = Field(gt=0)
    qty: int = Field(ge=1, le=99)
    # 沒有 price：價格由伺服器查

class CreateOrder(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    items: list[OrderItem] = Field(min_length=1, max_length=50)
    coupon: Annotated[str, Field(pattern=r"^[A-Z0-9]{4,16}$")] | None = None
    note: str = Field(default="", max_length=500)
    shipping: Literal["home", "store"] = "home"
```

FastAPI 端點的參數宣告成 `CreateOrder`，驗證失敗時自動回 **422**，body 列出每一個錯誤：

```json
{
  "detail": [
    { "type": "greater_than_equal", "loc": ["body", "items", 0, "qty"], "msg": "Input should be greater than or equal to 1", "input": -5, "ctx": { "ge": 1 } },
    { "type": "extra_forbidden", "loc": ["body", "status"], "msg": "Extra inputs are not permitted", "input": "paid" }
  ]
}
```

幾個要注意的地方（以 pydantic v2 為準）：

- 預設是「寬鬆模式」：字串 `"5"` 會被轉成整數 5。需要嚴格型別時用 `strict=True`。
- 預設會**忽略**多餘欄位而不是拒絕；要拒絕就設 `extra="forbid"`。
- 輸入 model 和資料庫 model 分開。`CreateOrder` 沒有 `status`、`user_id`、`total`，這些由伺服器決定，mass assignment 自然不會發生。
- pydantic 處理的是結構與格式；「這個 product_id 存在嗎」「庫存夠嗎」這類需要查資料庫的規則放在服務層。

Node 生態對應的是 zod、JSON Schema（ajv）；概念相同。

## 檔案上傳

檔案是最難驗證的輸入：內容是任意 bytes，又常被其他程式（圖片處理、PDF 解析、瀏覽器）解析。

| 規則 | 原因 |
|---|---|
| **大小上限**，在最外層就擋 | 反向代理（nginx 的 `client_max_body_size`）與應用程式都要設；只在應用程式檢查時，檔案已經整個傳進來了 |
| **副檔名與 `Content-Type` 都不可信** | 兩者都是客戶端自己填的。`shell.php` 改名成 `shell.jpg`，`Content-Type` 也可以寫 `image/jpeg` |
| **檢查 magic bytes**（檔案開頭的特徵位元組） | PNG 以 `89 50 4E 47 0D 0A 1A 0A` 開頭、JPEG 以 `FF D8 FF` 開頭、PDF 以 `%PDF-` 開頭。用偵測結果決定類型，不用檔名 |
| **圖片重新編碼** | 一個檔案可以同時是合法圖片又夾帶其他內容（polyglot）。用圖片函式庫解碼後重新輸出，只留下像素；同時去掉 EXIF 裡的 GPS 等個資 |
| **重新命名** | 儲存用的名稱由伺服器產生（UUID 或隨機值），副檔名依偵測到的類型決定。原始檔名只當顯示用的中繼資料，而且要跳脫 |
| **存到物件儲存，不放在可執行目錄** | 放在 web root 下，若伺服器會執行該目錄的 `.php` 或其他腳本，上傳一個檔案就等於上傳程式。物件儲存不會執行任何東西（見 [物件儲存](#/skill/object-storage)） |
| **下載時控制回應標頭** | `Content-Type` 用伺服器偵測的值、加 `X-Content-Type-Options: nosniff`；HTML、SVG 這類可含 script 的格式用 `Content-Disposition: attachment` 或從另一個網域提供 |
| **解壓縮要設上限** | 壓縮炸彈：幾 KB 的 zip 解開是幾 GB。限制解壓後總大小與檔案數；檢查每個項目的路徑（zip slip，見下一節） |
| **掃毒視需求** | 檔案會被其他使用者下載時考慮加；放在背景工作處理 |

大檔案通常不經過 API，改用預簽網址直接傳到物件儲存，這時內容檢查只能在檔案落地後由背景工作做。兩種架構的取捨見設計情境 [使用者上傳檔案](#/scenario/upload)。

### 路徑穿越

程式用使用者給的名稱組檔案路徑時：

```python
path = os.path.join("/srv/files", user_filename)
```

`user_filename` 是 `../../etc/passwd` 時，路徑跑到目錄外面；是 `/etc/passwd`（絕對路徑）時，`os.path.join` 會**直接丟掉前面的基底目錄**。解壓縮 zip 時，項目名稱也可能是 `../../app/config.py`，這叫 zip slip。

防法依序是：

1. 能不用使用者給的名稱就不用：用伺服器產生的 id 對應到檔案。
2. 一定要用時，名稱先套允許清單（只允許英數、`-`、`_`、`.`，且不能以 `.` 開頭）。
3. 組出路徑後**正規化**，再確認結果仍在基底目錄底下。檢查要在解碼與正規化之後做。

## 實際程式

### 邊界驗證：把 dict 轉成可信任的物件

瀏覽器裡的 Python 沒有 pydantic，下面用標準函式庫寫出同樣的概念：驗證失敗時收集所有錯誤，格式模仿 pydantic。

```python run
from dataclasses import dataclass
import re, unicodedata

ALLOWED_SHIPPING = {"home", "store"}
COUPON_RE = re.compile(r"[A-Z0-9]{4,16}")

@dataclass(frozen=True)
class OrderItem:
    product_id: int
    qty: int

@dataclass(frozen=True)
class CreateOrder:
    items: tuple
    coupon: str | None
    note: str
    shipping: str

def is_int(v):
    return type(v) is int        # bool 是 int 的子類別，type() 比 isinstance 嚴格

def parse_order(body: dict) -> CreateOrder:
    errors = []
    err = lambda loc, msg, value: errors.append({"loc": loc, "msg": msg, "input": value})

    for k in body.keys() - {"items", "coupon", "note", "shipping"}:
        err([k], "Extra inputs are not permitted", body[k])

    items = body.get("items")
    parsed = []
    if not isinstance(items, list) or not 1 <= len(items) <= 50:
        err(["items"], "items 必須是 1 到 50 個元素的陣列", items if not isinstance(items, list) else f"<{len(items)} 個>")
    else:
        for i, it in enumerate(items):
            if not isinstance(it, dict):
                err(["items", i], "必須是物件", it); continue
            for k in it.keys() - {"product_id", "qty"}:
                err(["items", i, k], "Extra inputs are not permitted", it[k])
            pid, qty = it.get("product_id"), it.get("qty")
            if not (is_int(pid) and pid > 0):
                err(["items", i, "product_id"], "必須是正整數", pid)
            if not (is_int(qty) and 1 <= qty <= 99):
                err(["items", i, "qty"], "必須是 1 到 99 的整數", qty)
            parsed.append(OrderItem(pid, qty))

    coupon = body.get("coupon")
    if coupon is not None and not (isinstance(coupon, str) and COUPON_RE.fullmatch(coupon)):
        err(["coupon"], "格式不符", coupon)

    note = body.get("note", "")
    if not isinstance(note, str):
        err(["note"], "必須是字串", note)
    else:
        note = unicodedata.normalize("NFKC", note).strip()   # 先正規化，再檢查長度
        if len(note) > 500:
            err(["note"], "最多 500 字", f"<{len(note)} 字>")

    shipping = body.get("shipping", "home")
    if shipping not in ALLOWED_SHIPPING:
        err(["shipping"], f"只能是 {sorted(ALLOWED_SHIPPING)} 之一", shipping)

    if errors:
        raise ValueError(errors)
    return CreateOrder(tuple(parsed), coupon, note, shipping)

good = {"items": [{"product_id": 3, "qty": 1}], "coupon": "SPRING", "note": "請放管理室"}
print("OK：", parse_order(good))

bad = {"items": [{"product_id": 3, "qty": -5, "price": 1}, {"product_id": "3", "qty": True}],
       "note": "x" * 600, "status": "paid", "coupon": {"$ne": None}}
try:
    parse_order(bad)
except ValueError as e:
    print("\n422 Unprocessable Entity")
    for x in e.args[0]:
        print(" ", x)
```

### 檔案上傳：magic bytes、大小、重新命名、路徑穿越

```python run
import secrets, posixpath

MAX_BYTES = 5 * 1024 * 1024
SIGNATURES = [                       # 允許清單：只認這三種
    (b"\x89PNG\r\n\x1a\n", "png", "image/png"),
    (b"\xff\xd8\xff",      "jpg", "image/jpeg"),
    (b"%PDF-",             "pdf", "application/pdf"),
]

def sniff(data: bytes):
    for magic, ext, mime in SIGNATURES:
        if data.startswith(magic):
            return ext, mime
    return None

def accept_upload(client_name: str, client_type: str, data: bytes) -> dict:
    if len(data) > MAX_BYTES:
        return {"ok": False, "reason": "超過大小上限"}
    kind = sniff(data[:16])
    if kind is None:
        return {"ok": False, "reason": f"內容不是允許的類型（客戶端宣稱 {client_type}）"}
    ext, mime = kind
    key = f"uploads/{secrets.token_hex(16)}.{ext}"     # 伺服器產生的名稱與副檔名
    return {"ok": True, "key": key, "content_type": mime, "display_name": client_name[:100]}

png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
php = b"<?php echo 'hi'; ?>"
print(accept_upload("cat.png", "image/png", png))
print(accept_upload("shell.jpg", "image/jpeg", php))          # 副檔名與 Content-Type 都是假的
print(accept_upload("big.pdf", "application/pdf", b"%PDF-" + b"0" * MAX_BYTES))

# 路徑穿越：正規化後確認仍在基底目錄底下
BASE = "/srv/files"

def naive_path(name):
    return posixpath.join(BASE, name)

def safe_path(name):
    p = posixpath.normpath(posixpath.join(BASE, name))
    if p != BASE and p.startswith(BASE + "/"):
        return p
    raise ValueError(f"拒絕：{name!r} 解析成 {p}")

for name in ["report.pdf", "../../etc/passwd", "/etc/passwd", "a/../../files-other/x", "sub/./ok.txt"]:
    try:
        print(f"{name:24} naive={naive_path(name):28} safe={safe_path(name)}")
    except ValueError as e:
        print(f"{name:24} naive={naive_path(name):28} {e}")
```

注意 `"a/../../files-other/x"`：正規化後是 `/srv/files-other/x`，只用 `startswith("/srv/files")` 檢查會被騙過，所以比對時要加上結尾的 `/`。Python 3.9 起也可以用 `pathlib.Path.resolve()` 搭配 `is_relative_to()`，`resolve()` 還會展開符號連結。

## 常見錯誤與錯誤訊息

| 現象或訊息 | 原因 | 修正 |
|---|---|---|
| FastAPI 回 `422 Unprocessable Entity`，前端看不懂 | 驗證失敗的預設格式 | 前端依 `detail[].loc` 對應到欄位顯示 `msg`；需要統一錯誤格式時改寫例外處理器（見 [錯誤設計](#/skill/error-design)） |
| nginx 回 `413 Request Entity Too Large` | body 超過 `client_max_body_size`（預設 1m） | 依端點調整上限；上傳端點單獨設定較大的值，其他端點維持小值 |
| 驗證都過了，資料庫卻出現多餘的欄位值 | 用 `Model(**body)` 或 `obj.update(body)` 把整包請求套進 ORM | 輸入 model 與資料庫 model 分開，逐欄指定 |
| 數字欄位收到 `"1e309"`、`NaN`、超大整數 | 轉成 float 變成 `inf`；Python 整數沒有上限，轉換或運算很慢 | 設範圍上限；金額用 `Decimal` 並限制位數 |
| 用正規表示式驗 email 擋掉合法地址 | 規則寫得太嚴，或沒考慮國際化網域 | 只做寬鬆的格式檢查加長度上限，真正的驗證是寄確認信 |
| 正規表示式讓 CPU 飆高 | 回溯爆炸（ReDoS），例如 `(a+)+$` 遇到長字串 | 先限制長度再比對；避免巢狀量詞；必要時用線性時間的 regex 引擎 |
| 只在前端驗證 | 直接呼叫 API 就繞過了 | 前端驗證是使用者體驗，後端驗證才是規則 |

## 動手

1. 在邊界驗證那段，試著傳 `{"items": [{"product_id": 1, "qty": 1}] * 51}`、`{"items": []}`、`{"note": "ｈｅｌｌｏ"}`（全形），觀察錯誤與正規化後的 note。
2. 在上傳那段加一個 `webp` 簽章：WebP 是 `RIFF` 開頭、第 8 到 11 個 byte 是 `WEBP`，`startswith` 不夠用，改寫 `sniff`。
3. 把 `safe_path` 的 `BASE + "/"` 改回 `BASE`，看哪一個測試輸入會被放過。
4. 到設計情境 [使用者上傳檔案](#/scenario/upload)，決定頭像、影片、CSV 匯入各該走哪條路，並寫出每一條路的驗證點在哪裡。
5. 為自己的一個建立資料 API 列出每個欄位的型別、範圍、長度、格式、是否允許客戶端設定，對照上面「要驗什麼」那張表。

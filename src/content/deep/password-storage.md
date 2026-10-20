## 從一個具體問題開始：資料庫備份外流之後

一份資料庫備份被放在公開的物件儲存 bucket 裡好幾天。`users` 表的密碼欄位長這樣：

| id | email | password_hash |
|---|---|---|
| 1 | alice@example.com | `48486e1514e842346ff405b1e45f44059ae82619f2306f99d0940dcb386e91f7` |
| 2 | bob@example.com | `5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8` |
| 3 | carol@example.com | `5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8` |

欄位是 `SHA-256(password)`。拿到備份的人可以立刻看出幾件事：

- Bob 和 Carol 的雜湊一模一樣，代表他們用同一個密碼。全表裡出現次數最多的雜湊，就是最常見的弱密碼。
- 這些值可以直接拿去查預先算好的對照表。第二列是 `password` 這個字的 SHA-256，任何公開的常見密碼表都有。
- 查不到的，可以用字典加變形規則（大小寫、加數字、替換字元）在 GPU 上暴力猜。SHA-256 為了速度而設計，一張消費級顯示卡每秒可以算數十億次等級。

很多使用者在別的網站用同一組 email 和密碼，所以外洩的影響不會停在這個服務。這張表的問題不是「用了雜湊」，是用錯了雜湊。

## 運作原理

### 編碼、雜湊、加密是三件事

| | 編碼（encoding） | 雜湊（hash） | 加密（encryption） |
|---|---|---|---|
| 例子 | Base64、hex、URL encoding | SHA-256、BLAKE2、Argon2 | AES-GCM、RSA-OAEP |
| 可逆嗎 | 任何人都能解回 | 不能還原，只能重算比對 | 有金鑰就能解回 |
| 需要秘密嗎 | 不需要 | 不需要（加 pepper 時才有） | 需要金鑰 |
| 用途 | 讓二進位資料能放進文字通道 | 驗證完整性、比對、建索引 | 保護之後要拿回原文的資料 |

密碼的需求是**驗證**：登入時確認使用者輸入的密碼和註冊時的是同一個。伺服器不需要知道原文，所以用雜湊。加密存密碼的問題是金鑰：金鑰必須放在伺服器能讀到的地方，資料庫和金鑰一起外洩時，所有密碼等於明文。Base64 則根本不算保護。

### salt：讓相同密碼得到不同雜湊

**salt** 是每個帳號各自產生的隨機值（16 bytes 以上），和密碼一起雜湊，明文存在雜湊旁邊。它不是秘密，作用有兩個：

1. 同一個密碼在不同帳號產生不同的雜湊，前面「Bob 和 Carol 一樣」的資訊消失。
2. 預先算好的對照表失效，因為表必須針對每個 salt 重算。攻擊者也無法「算一次，比對全表」，每個帳號都要分開猜。

salt 解決的是「一次破全部」，不解決「猜得太快」。`SHA-256(salt + password)` 對單一帳號的猜測速度和沒加 salt 一樣快。

### 慢雜湊：讓每次猜測都昂貴

密碼雜湊函式（password hashing function）刻意讓每次計算變慢，並且可以用參數調整成本：

| 演算法 | 成本參數 | 特性 |
|---|---|---|
| **Argon2id** | 記憶體 `m`、迭代 `t`、平行度 `p` | 2015 年密碼雜湊競賽勝出；吃記憶體，讓 GPU／ASIC 平行破解變貴。新系統的首選 |
| **scrypt** | `N`（CPU／記憶體成本）、`r`、`p` | 同樣吃記憶體；Argon2 不可用時的選擇 |
| **bcrypt** | cost（2 的次方輪數） | 歷史最久、支援最廣；輸入最多 72 bytes，超過的部分會被忽略或拒絕，依函式庫而定 |
| **PBKDF2** | 迭代次數 | 只吃 CPU，GPU 容易平行化；需要符合 FIPS 規範時使用 |

OWASP Password Storage Cheat Sheet 目前列出的最低參數（數值會隨硬體調整，以官方最新內容為準）：

- Argon2id：`m=19456`（19 MiB）、`t=2`、`p=1`
- scrypt：`N=2^17`、`r=8`、`p=1`
- bcrypt：cost 10 以上
- PBKDF2-HMAC-SHA256：600,000 次迭代

實務上的調法：在正式環境的機器上量測，讓一次雜湊落在可以接受的時間（例如幾十到幾百毫秒），並且確認尖峰時同時登入的人數不會把 CPU 或記憶體吃光。登入端點本來就該限流，慢雜湊也讓「大量登入請求」成為 DoS 的入口，兩者要一起考慮。

### 儲存格式：參數跟著雜湊走

函式庫輸出的雜湊字串會把演算法、參數、salt、結果一起編碼，例如 Argon2 的 PHC 格式：

```text
$argon2id$v=19$m=65536,t=3,p=4$<salt 的 base64>$<雜湊結果的 base64>
```

bcrypt 是 `$2b$12$` 開頭，後面接 22 字元的 salt 與 31 字元的雜湊。資料庫只要一個欄位存這整串，驗證時函式庫自己解出參數。這個設計讓「不同帳號用不同參數」成為可能，也是升級雜湊的基礎。

### pepper：資料庫以外的秘密

**pepper** 是全站共用、**不存在資料庫裡**的秘密金鑰（放在 Secret Manager 或 HSM）。常見做法是先算 `HMAC(pepper, password)`，再把結果交給 Argon2。只有資料庫外洩時，攻擊者沒有 pepper，離線猜測完全無效。

代價是 pepper 很難輪替：換掉它，所有現有雜湊都無法驗證，只能在使用者登入時逐一轉換，或保留舊 pepper 並在雜湊旁記錄版本。pepper 是加分項，不能取代慢雜湊。

### 升級雜湊：在登入時重算

舊系統用 SHA-256 或低成本參數時，不需要強迫所有人重設密碼：

1. **登入時升級**：驗證成功的那一刻，伺服器手上有明文密碼。檢查儲存的雜湊是否用了舊演算法或舊參數（函式庫多半有 `check_needs_rehash` 這類函式），是的話用新參數重算並寫回。
2. **包裝舊雜湊**：長期不登入的帳號永遠不會被升級。可以批次把舊的 `sha256(password)` 直接當輸入算 `argon2(sha256(password))`，標記為包裝格式；登入時依格式先算 SHA-256 再驗證，並順便換成正常的 `argon2(password)`。這樣資料庫裡不會留下任何快速雜湊。

### 比對要用固定時間

一般的 `==` 比對字串時，遇到第一個不同的字元就回傳。回應時間因此和「前面有幾個字元猜對」相關，攻擊者可以透過大量量測逐字元推測。用 `hmac.compare_digest`（Python）或 `crypto.timingSafeEqual`（Node）這類固定時間的比對。用 Argon2／bcrypt 函式庫的 `verify` 時，它已經在內部處理了，不要自己把雜湊取出來用 `==` 比。

## 實際程式

### 正式專案：用函式庫

Python 用 `argon2-cffi`（需要安裝套件，不能在瀏覽器裡跑）：

```python
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

ph = PasswordHasher()                # 預設參數來自函式庫；可用 time_cost、memory_cost、parallelism 調整

def register(password: str) -> str:
    return ph.hash(password)         # 自動產生 salt，回傳 PHC 格式的整串

def login(stored: str, password: str) -> tuple[bool, str | None]:
    try:
        ph.verify(stored, password)  # 內部是固定時間比對
    except VerifyMismatchError:
        return False, None
    # 參數升級了（或舊雜湊參數太低）：趁現在有明文，重算並回傳新值讓呼叫端寫回
    if ph.check_needs_rehash(stored):
        return True, ph.hash(password)
    return True, None
```

bcrypt 的寫法類似：`bcrypt.hashpw(pw.encode(), bcrypt.gensalt(rounds=12))` 與 `bcrypt.checkpw(pw.encode(), stored)`，注意它處理的是 bytes。

### 在瀏覽器裡觀察：快雜湊、salt、慢雜湊

本站的瀏覽器 Python 沒有 OpenSSL，`hashlib.pbkdf2_hmac` 不可用（正式環境的 CPython 有）。下面用 `hmac` 依 RFC 8018 寫一個 PBKDF2-HMAC-SHA256，結果與 `hashlib.pbkdf2_hmac` 相同，只是慢很多，所以迭代次數刻意調低。

```python run
import hashlib, hmac, os, time

def pbkdf2_sha256(password: bytes, salt: bytes, iterations: int, dklen: int = 32) -> bytes:
    # RFC 8018 的 PBKDF2，PRF = HMAC-SHA256；與 hashlib.pbkdf2_hmac("sha256", ...) 結果相同
    out, block = b"", 1
    while len(out) < dklen:
        u = hmac.new(password, salt + block.to_bytes(4, "big"), hashlib.sha256).digest()
        acc = int.from_bytes(u, "big")
        for _ in range(iterations - 1):
            u = hmac.new(password, u, hashlib.sha256).digest()
            acc ^= int.from_bytes(u, "big")
        out += acc.to_bytes(32, "big")
        block += 1
    return out[:dklen]

# RFC 7914 附錄的測試向量：確認實作正確
assert pbkdf2_sha256(b"password", b"salt", 1).hex().startswith("120fb6cffcf8b32c")

# 1) 沒有 salt：相同密碼 → 相同雜湊
for user in ("bob", "carol"):
    print(f"{user:6} sha256 =", hashlib.sha256(b"password").hexdigest()[:24], "…")

# 2) 有 salt：相同密碼 → 不同雜湊
for user in ("bob", "carol"):
    salt = os.urandom(16)
    print(f"{user:6} salted =", hashlib.sha256(salt + b"password").hexdigest()[:24], "…")

# 3) 速度：同樣的時間，攻擊者能猜幾次
t = time.perf_counter()
for i in range(20000):
    hashlib.sha256(b"guess%d" % i).digest()
fast = (time.perf_counter() - t) / 20000

t = time.perf_counter()
pbkdf2_sha256(b"guess", os.urandom(16), 20000)
slow = time.perf_counter() - t

print(f"\nSHA-256 一次約 {fast * 1e6:.2f} µs")
print(f"PBKDF2（20,000 次迭代）一次約 {slow * 1000:.0f} ms，約是 SHA-256 的 {slow / fast:,.0f} 倍")
print("迭代次數加倍，猜測成本就加倍；正式環境 PBKDF2 建議 600,000 次以上，或改用 Argon2id")
```

### 登入時升級舊雜湊

這段模擬一個資料庫裡同時有三種格式：舊的無 salt SHA-256、低迭代 PBKDF2、目前標準。每次登入成功就檢查並升級。

```python run
import hashlib, hmac, os, base64

def pbkdf2_sha256(pw, salt, it):
    out = hmac.new(pw, salt + b"\x00\x00\x00\x01", hashlib.sha256).digest()
    u, acc = out, int.from_bytes(out, "big")
    for _ in range(it - 1):
        u = hmac.new(pw, u, hashlib.sha256).digest()
        acc ^= int.from_bytes(u, "big")
    return acc.to_bytes(32, "big")

CURRENT_ITERATIONS = 3000          # 示範用；真實系統用 600,000 以上或 Argon2id
b64 = lambda b: base64.b64encode(b).decode()

def hash_new(pw: str) -> str:
    salt = os.urandom(16)
    dk = pbkdf2_sha256(pw.encode(), salt, CURRENT_ITERATIONS)
    return f"$pbkdf2-sha256${CURRENT_ITERATIONS}${b64(salt)}${b64(dk)}"

def verify(stored: str, pw: str) -> bool:
    if stored.startswith("$sha256$"):                     # 舊格式：沒有 salt
        expected = stored.split("$")[2]
        return hmac.compare_digest(hashlib.sha256(pw.encode()).hexdigest(), expected)
    _, algo, it, salt, dk = stored.split("$")
    got = pbkdf2_sha256(pw.encode(), base64.b64decode(salt), int(it))
    return hmac.compare_digest(got, base64.b64decode(dk))  # 固定時間比對

def needs_rehash(stored: str) -> bool:
    return not stored.startswith(f"$pbkdf2-sha256${CURRENT_ITERATIONS}$")

db = {
    "alice": "$sha256$" + hashlib.sha256(b"correct-horse").hexdigest(),
    "bob":   None,
    "carol": hash_new("p@ssw0rd!"),
}
salt = os.urandom(16)
db["bob"] = f"$pbkdf2-sha256$1000${b64(salt)}${b64(pbkdf2_sha256(b'hunter2', salt, 1000))}"

def login(user, pw):
    stored = db[user]
    if not verify(stored, pw):
        return "密碼錯誤"
    if needs_rehash(stored):
        db[user] = hash_new(pw)           # 趁有明文時重算
        return "成功，已升級雜湊"
    return "成功"

def describe(stored):
    parts = stored.split("$")
    return parts[1] if parts[1] == "sha256" else f"{parts[1]} ×{parts[2]}"

for user, pw in [("alice", "correct-horse"), ("bob", "hunter2"), ("carol", "p@ssw0rd!"), ("bob", "wrong")]:
    before = describe(db[user])
    result = login(user, pw)
    print(f"{user:6} {result:12} {before:20} → {describe(db[user])}")
```

## 常見錯誤與錯誤訊息

| 錯誤 | 現象 | 修正 |
|---|---|---|
| 欄位太短，例如 `VARCHAR(50)` | 寫入時被截斷或報錯；被截斷的雜湊永遠驗證失敗。bcrypt 函式庫可能拋 `ValueError: Invalid salt` | Argon2 字串長度依參數而定，用 `TEXT` 或足夠長的 `VARCHAR(255)` |
| 自己把雜湊取出來用 `==` 比 | 功能正常，但比對時間洩露資訊 | 用函式庫的 `verify`；自己比對時用 `hmac.compare_digest` |
| 每個帳號共用同一個 salt（或把 salt 寫死在程式碼） | 相同密碼又得到相同雜湊 | 每次雜湊都用 CSPRNG 產生新的 salt；用函式庫就不必自己管 |
| 用 `random` 產生 salt | 可預測 | `os.urandom` 或 `secrets` |
| bcrypt 搭配很長的密碼或先做 pre-hash 卻沒編碼 | 超過 72 bytes 的部分被忽略或拋錯；pre-hash 的原始 bytes 含 `\x00` 時，部分實作會在該處截斷 | 長度限制寫清楚；需要 pre-hash 時把結果 base64 後再交給 bcrypt，或直接改用 Argon2id |
| 驗證失敗時區分「帳號不存在」與「密碼錯誤」 | 可列舉出哪些 email 已註冊 | 回應一律「帳號或密碼錯誤」；帳號不存在時也做一次雜湊，讓回應時間相近 |
| 密碼長度上限設得很短（例如 16） | 使用者無法用密碼管理器產生的長密碼 | 上限至少 64 字元；要防 DoS 時限制在數百字元，而不是很短 |

`argon2-cffi` 驗證失敗拋的是 `argon2.exceptions.VerifyMismatchError`；儲存的字串格式不對（例如被截斷）時則是 `InvalidHashError` 這一類例外。這兩種要分開處理：前者是使用者打錯密碼，後者是資料出了問題，應該記錄告警。

## 動手

1. 執行「快雜湊、salt、慢雜湊」那段，把 `pbkdf2_sha256` 的迭代次數改成 5,000 與 40,000，看時間是否接近線性成長（瀏覽器裡的 Python 很慢，別調太高，12 秒會逾時）。
2. 在升級那段把 `CURRENT_ITERATIONS` 改成 4000 再執行，所有帳號登入時都會被升級；接著加一個「包裝」格式：把 alice 的舊值改存成 `pbkdf2(sha256(password))`，並讓 `verify` 認得它。
3. 到實驗室 [編碼、雜湊、加密](#/lab/HashingLab)，打開「兩個使用者同密碼」，比較三種處理的結果；拉高 iterations 看真實耗時。
4. 程式題 [加鹽慢雜湊：存密碼與驗密碼](#/exercise/password-storage-1)。
5. 雜湊、HMAC、加密各自的完整用途見 [密碼學工具箱](#/skill/crypto-toolbox)；登入流程本身（session、限流、MFA）見 [驗證基礎：Session vs Token](#/skill/authn-basics)。

## 從一個具體問題開始：三個「看起來有加密」的功能

一次程式碼審查裡出現了三段程式：

```python
import random, hashlib

# 1) 重設密碼連結的 token
token = str(random.random())[2:]

# 2) webhook 簽章：把共享的 secret 和 body 接在一起做 SHA-256
signature = hashlib.sha256(SECRET + body).hexdigest()

# 3) 身分證字號欄位「加密」：固定的金鑰和固定的 IV
ciphertext = aes_encrypt(key=FIXED_KEY, iv=b"\x00" * 12, data=national_id)
```

每一段都用了密碼學相關的函式，每一段都有問題：

1. `random` 是可預測的偽亂數產生器。觀察到足夠多的輸出後，可以推回內部狀態、算出接下來的 token。
2. `SHA-256(secret + body)` 對 SHA-256 這類 Merkle–Damgård 結構的雜湊有 **length extension** 問題：知道一組合法的 `(body, signature)`，不知道 secret 也能算出「body 後面再接一段資料」的合法簽章。
3. 用 AES-GCM 時，同一把金鑰重複使用同一個 nonce，會讓兩筆密文互相洩露內容，甚至讓攻擊者偽造通過驗證的密文。

問題不是「沒用加密」，而是**工具和問題不對應**。密碼學工具各自只解一種問題，選錯了就等於沒有保護。

## 運作原理：五種工具各解一種問題

| 工具 | 回答的問題 | 需要金鑰嗎 | 典型用途 |
|---|---|---|---|
| 雜湊（SHA-256、SHA-3、BLAKE2） | 這份資料有沒有變？ | 不需要 | 檔案校驗、內容定址、去重、ETag |
| HMAC | 這份資料是不是持有 secret 的人產生、且沒被改？ | 共享一把 secret | webhook 簽章、簽名 cookie、JWT HS256、API 請求簽章 |
| 對稱加密（AES-GCM、ChaCha20-Poly1305） | 怎麼讓沒有金鑰的人看不到內容？ | 雙方同一把金鑰 | 欄位加密、檔案加密、TLS 的資料傳輸 |
| 非對稱（簽章：Ed25519、ECDSA、RSA-PSS；金鑰交換與加密：ECDH、RSA-OAEP） | 怎麼讓任何人都能驗證是我簽的？怎麼和沒見過面的人建立共享金鑰？ | 公鑰／私鑰一對 | JWT RS256／ES256、TLS 憑證、程式碼簽章、金鑰交換 |
| 安全亂數（CSPRNG） | 怎麼產生別人猜不到的值？ | 不需要 | token、session id、salt、nonce、金鑰 |

密碼不在這張表上：存密碼要用加鹽慢雜湊，見 [密碼儲存](#/skill/password-storage)。

### 雜湊：完整性，不是來源

雜湊把任意長度的輸入變成固定長度的摘要，安全的雜湊要做到：從摘要推不回輸入、找不到兩個輸入有同樣的摘要（抗碰撞）。MD5 與 SHA-1 都已經有實際可行的碰撞攻擊，不能用在任何安全用途（簽章、憑證、驗證下載）；拿來做非安全用途的快取鍵還可以，但新程式碼沒有理由選它們。

雜湊沒有金鑰，**任何人都能算**。把檔案和它的 SHA-256 放在同一個地方，攻擊者改了檔案也能順手改雜湊。所以雜湊只在「摘要本身從可信的管道取得」時有意義，例如 lock 檔裡記錄的套件雜湊（見 [依賴與供應鏈安全](#/skill/supply-chain)）。

### HMAC：證明來源

HMAC 的構造是 `H((K ⊕ opad) ‖ H((K ⊕ ipad) ‖ message))`：兩層雜湊、金鑰在兩層都參與。這個結構不受 length extension 影響，是「共享 secret 驗證訊息」的標準答案。

webhook 驗證的完整做法：

1. 發送方算 `HMAC-SHA256(secret, timestamp + "." + body)`，放進標頭。
2. 接收方用**原始的 request body bytes**（不是 parse 後再 serialize 的 JSON，欄位順序與空白會不同）重算。
3. 用固定時間比對（`hmac.compare_digest`）。
4. 檢查 timestamp 在幾分鐘內，擋掉重送（replay）；需要更嚴格時記錄已處理的事件 id。

HMAC 的限制：雙方持有同一把 secret，所以接收方也能偽造簽章。多個服務只需要「驗證」而不該能「簽發」時，用非對稱簽章。

### 對稱加密：AES-GCM 與 nonce

AES-GCM 是 **AEAD**（Authenticated Encryption with Associated Data）：一次給出機密性（看不到內容）與完整性（改過就解不開）。它的輸入輸出：

| 項目 | 長度 | 說明 |
|---|---|---|
| 金鑰 | 128 或 256 bits | 秘密，放在 KMS／Secret Manager |
| nonce（IV） | 建議 96 bits（12 bytes） | 不是秘密，但同一把金鑰下**絕不能重複** |
| AAD（附加資料） | 任意 | 不加密、但受完整性保護，例如這筆資料屬於哪個 user id |
| 密文 | 與明文等長 | |
| tag | 128 bits | 解密時驗證；不符就整個失敗 |

GCM 內部用 CTR 模式：把 `(金鑰, nonce, 計數器)` 產生的金鑰流和明文 XOR。同一組金鑰與 nonce 產生**同一條金鑰流**，所以兩筆密文 XOR 起來，金鑰流相消，剩下兩筆明文的 XOR。知道其中一筆明文，就能直接還原另一筆。更糟的是，nonce 重複也會洩露 GCM 驗證用的內部值，讓攻擊者能偽造 tag。

nonce 的產生方式：每次加密用 CSPRNG 產生 12 bytes。隨機 nonce 有碰撞機率，NIST SP 800-38D 建議同一把金鑰在這種用法下加密次數不超過 2^32 次；量更大時要換金鑰，或改用計數器式 nonce（必須確保跨機器、跨重啟都不重複，實作上更難）。

AAD 的用途：把密文和它的脈絡綁在一起。例如加密使用者 42 的身分證字號時把 `user:42` 當 AAD，攻擊者把這筆密文複製到使用者 43 的欄位，解密會失敗。

金鑰管理通常用 **envelope encryption**：每筆資料（或每個租戶）用一把資料金鑰（DEK）加密，DEK 再用 KMS 裡的主金鑰（KEK）加密後和資料存在一起。主金鑰不離開 KMS，輪替主金鑰時只要重新包裝 DEK。

### 非對稱：簽章與加密是兩回事

一對金鑰有兩種完全不同的用法：

| 用法 | 誰用私鑰 | 誰用公鑰 | 例子 |
|---|---|---|---|
| 簽章 | 簽發者用私鑰**簽** | 任何人用公鑰**驗** | JWT RS256／ES256、套件簽章、TLS 憑證鏈 |
| 加密 | 接收者用私鑰**解** | 任何人用公鑰**加密** | RSA-OAEP 包裝金鑰；實務上多是 ECDH 交換出對稱金鑰後用 AES-GCM（混合加密） |

「用私鑰加密」不是一種正確的說法，簽章的演算法也不等於「反過來加密」。程式裡分清楚呼叫的是 `sign`／`verify` 還是 `encrypt`／`decrypt`。

微服務架構下，簽發 JWT 的認證服務持有私鑰，其他服務只拿公鑰驗證；公鑰外洩沒有影響，某個下游服務被入侵也無法簽發 token。這是 RS256／ES256 相對 HS256 的主要優點（JWT 細節見 [JWT](#/skill/jwt)）。

### 安全亂數

| 語言 | 安全（CSPRNG） | 不安全 |
|---|---|---|
| Python | `secrets.token_urlsafe(32)`、`secrets.token_bytes`、`os.urandom` | `random.random()`、`random.randint`、`uuid.uuid1()` |
| JavaScript | `crypto.getRandomValues`、`crypto.randomUUID()` | `Math.random()` |
| PostgreSQL | `gen_random_uuid()`（PostgreSQL 13 起內建） | `random()` |

Python 的 `random` 是 Mersenne Twister，設計目標是統計性質好與可重現（同一個 seed 得到同一串數字），不是不可預測。token 的長度：32 bytes（256 bits）的隨機值對任何猜測都足夠；`secrets.token_urlsafe(32)` 產生約 43 個字元的字串。

### 不要自己發明加密

自己組合原語（自己寫 CBC＋HMAC 的順序、自己設計 token 格式、自己實作 AES）很容易在看不出來的地方出錯：填充驗證錯誤、比對不是固定時間、加密與驗證的順序錯、nonce 管理錯。用高階、難以誤用的 API：

- Python：`cryptography` 套件的 `AESGCM` 或 `Fernet`；簽章用 `Ed25519PrivateKey`
- 跨語言：libsodium（`crypto_secretbox`、`crypto_sign`）
- 瀏覽器與 Node：WebCrypto（`crypto.subtle`）
- 雲端：KMS 的 encrypt／decrypt／sign API，金鑰不出 KMS

## 實際程式

### AES-GCM 加解密、AAD 與竄改偵測（WebCrypto）

```js run
const enc = new TextEncoder(), dec = new TextDecoder()
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

// 產生 256-bit 金鑰；extractable: false 代表程式拿不到金鑰原始 bytes（只能用它加解密）
const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])

// 每次加密都用新的 12 bytes 隨機 nonce；AAD 把密文綁在 user:42 上
const nonce = crypto.getRandomValues(new Uint8Array(12))
const aad = enc.encode('user:42')
const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad }, key, enc.encode('A123456789'))
console.log('nonce  ', hex(nonce))
console.log('密文+tag', hex(ct), `（${ct.byteLength} bytes = 明文 10 + tag 16）`)

const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad }, key, ct)
console.log('解密    ', dec.decode(pt))

// 竄改密文的第一個 byte → tag 驗證失敗
const tampered = new Uint8Array(ct); tampered[0] ^= 1
try { await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad }, key, tampered) }
catch (e) { console.log('竄改密文 →', e.name) }

// 密文搬到別的使用者（AAD 不同）→ 一樣失敗
try { await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData: enc.encode('user:43') }, key, ct) }
catch (e) { console.log('換 AAD   →', e.name) }
```

### nonce 重用會發生什麼

同一把金鑰、同一個 nonce 加密兩筆訊息，密文 XOR 等於明文 XOR：

```js run
const enc = new TextEncoder(), dec = new TextDecoder()
const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 128 }, false, ['encrypt'])
const nonce = new Uint8Array(12)        // 錯誤示範：固定的 nonce

const m1 = enc.encode('transfer 100 to bob  ')
const m2 = enc.encode('transfer 999 to eve  ')
const c1 = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, m1))
const c2 = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, m2))

// 只看密文部分（去掉最後 16 bytes 的 tag）
const xorC = m1.map((_, i) => c1[i] ^ c2[i])
const xorM = m1.map((b, i) => b ^ m2[i])
console.log('c1 ⊕ c2 == m1 ⊕ m2 ?', xorC.every((b, i) => b === xorM[i]))

// 攻擊者只知道 m1（例如固定格式的訊息），就能還原 m2，完全不需要金鑰
const recovered = xorC.map((b, i) => b ^ m1[i])
console.log('從密文還原出 m2：', dec.decode(recovered))
```

### webhook 的 HMAC 簽章與驗證

```js run
const enc = new TextEncoder()
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

// 雙方共享的 secret（實務上從 Secret Manager 讀取）
const secret = await crypto.subtle.importKey('raw', enc.encode('whsec_demo_only'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])

// 發送方：簽「timestamp.原始 body」
const body = '{"event":"order.paid","order_id":1001}'
const ts = Math.floor(Date.now() / 1000)
const sig = await crypto.subtle.sign('HMAC', secret, enc.encode(`${ts}.${body}`))
console.log('X-Signature:', `t=${ts},v1=${hex(sig)}`)

// 接收方：crypto.subtle.verify 內部做比對，不要自己用 === 比較 hex 字串
async function verify(rawBody, t, sigBytes, now = Math.floor(Date.now() / 1000)) {
  if (Math.abs(now - t) > 300) return '拒絕：timestamp 超過 5 分鐘（可能是重送）'
  const ok = await crypto.subtle.verify('HMAC', secret, sigBytes, enc.encode(`${t}.${rawBody}`))
  return ok ? '通過' : '拒絕：簽章不符'
}
console.log('原樣        →', await verify(body, ts, sig))
console.log('金額被改    →', await verify(body.replace('1001', '1002'), ts, sig))
console.log('一小時後重送 →', await verify(body, ts, sig, ts + 3600))
// 重新 serialize 的 JSON（多了空白）也會失敗：驗證一定要用原始 bytes
console.log('JSON 重排   →', await verify(JSON.stringify(JSON.parse(body), null, 1), ts, sig))
```

### Python：secrets vs random、HMAC

```python run
import random, secrets, hmac, hashlib

# random：同一個 seed 得到同一串數字。拿來產 token，等於 token 可以被重現
random.seed(1234)
a = [random.randint(0, 9) for _ in range(8)]
random.seed(1234)
b = [random.randint(0, 9) for _ in range(8)]
print("random 可重現：", a == b, a)

# secrets：從作業系統的 CSPRNG 取值，適合 token、重設連結、API key
print("重設連結 token：", secrets.token_urlsafe(32))
print("6 位數驗證碼：", f"{secrets.randbelow(10**6):06d}")

# HMAC 與固定時間比對
key = secrets.token_bytes(32)
msg = b'{"event":"order.paid","order_id":1001}'
tag = hmac.new(key, msg, hashlib.sha256).hexdigest()
print("HMAC：", tag[:32], "…")
print("驗證：", hmac.compare_digest(tag, hmac.new(key, msg, hashlib.sha256).hexdigest()))
```

### 正式專案的 Python 寫法（需要 cryptography 套件）

```python
import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.exceptions import InvalidTag

key = AESGCM.generate_key(bit_length=256)    # 實務上：從 KMS 取得或解包 DEK
aesgcm = AESGCM(key)

def encrypt_field(plaintext: str, user_id: int) -> bytes:
    nonce = os.urandom(12)
    ct = aesgcm.encrypt(nonce, plaintext.encode(), f"user:{user_id}".encode())
    return nonce + ct                         # nonce 不是秘密，和密文存在一起

def decrypt_field(blob: bytes, user_id: int) -> str:
    nonce, ct = blob[:12], blob[12:]
    try:
        return aesgcm.decrypt(nonce, ct, f"user:{user_id}".encode()).decode()
    except InvalidTag:
        raise ValueError("密文被竄改、金鑰不對，或 AAD 不符")
```

## 常見錯誤與錯誤訊息

| 現象 | 原因 | 修正 |
|---|---|---|
| WebCrypto 解密拋出 `OperationError`；Python `cryptography` 拋出 `InvalidTag` | 密文或 tag 被改、金鑰不對、nonce 不對、AAD 不一致。GCM 不會告訴你是哪一個 | 檢查 nonce 是否和密文一起存、AAD 是否用同樣的值組出來、金鑰版本是否對應 |
| webhook 簽章在本機對、上線後全部失敗 | 框架先 parse 了 JSON，驗證時用的是重新 serialize 的字串；或中間的 proxy 改了編碼 | 驗證用原始 body bytes；確認簽章對象（是否含 timestamp）與官方文件一致 |
| 用 ECB 模式或固定 IV | 相同明文得到相同密文，資料的模式直接可見 | 用 AEAD（AES-GCM、ChaCha20-Poly1305），每次新的 nonce |
| 金鑰寫在程式碼或和資料放同一個資料庫 | 資料外洩時金鑰一起外洩，加密沒有意義 | KMS／Secret Manager；envelope encryption |
| 用雜湊「加密」可以查詢的欄位（例如 email） | email 的可能值有限，SHA-256 可以被字典反查 | 需要等值查詢時，另存一欄 `HMAC(key, email)` 當盲索引（blind index），金鑰另外保管 |
| JWT 驗證接受 `alg` 標頭指定的任何演算法 | 攻擊者可能改成 `none` 或用公鑰當 HMAC secret | 驗證時明確指定允許的演算法清單 |

## 動手

1. 在「AES-GCM 加解密」那段，把解密用的 nonce 換成一個新的 `crypto.getRandomValues(new Uint8Array(12))`，確認也是 `OperationError`。
2. 在 nonce 重用那段，把第二次加密的 nonce 改成 `crypto.getRandomValues(new Uint8Array(12))`，看 `c1 ⊕ c2 == m1 ⊕ m2` 變成 false、還原出來的是亂碼。
3. 在 webhook 那段加上「事件 id 去重」：用一個 `Set` 記錄處理過的 `order_id`，第二次送同一個事件時回「已處理」。
4. 用 `crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])` 改寫 webhook 範例成非對稱簽章，體會「接收方只有公鑰、無法偽造」的差別。
5. 到實驗室 [JWT 解剖](#/lab/JwtLab) 看 HMAC 簽章在 JWT 裡的位置；金鑰的權限範圍與有效期限見 [金鑰的範圍與壽命](#/skill/key-scope-lifetime)。

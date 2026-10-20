## 從一個具體問題開始：第二台主機上找不到昨天的頭像

一個 API 把使用者上傳的頭像存在主機的 `/var/app/uploads/<user_id>.png`，資料庫記下路徑，讀取時由同一個程序把檔案送回去。只有一台主機時一切正常。

流量變大後加了第二台主機，前面放負載平衡器。接著開始出現這些狀況：

| 狀況 | 原因 |
|---|---|
| 頭像有時看得到、有時 404 | 上傳時請求落在主機 A，讀取時落在主機 B，B 的磁碟上沒有這個檔案 |
| 重新部署後所有新上傳的檔案都不見了 | 應用程式跑在容器裡，檔案寫進容器的可寫層；容器重建，可寫層跟著刪掉 |
| 某天整個 API 掛掉 | 磁碟被上傳檔案塞滿，連 log 都寫不進去 |
| 要做備份、要搬機器 | 檔案散在每台主機上，得自己同步、自己備份 |

把檔案掛在共用的網路磁碟（NFS）上可以解決前兩個，但效能、權限、單點故障變成新的問題。比較常見的做法是把檔案交給**物件儲存**（object storage）：應用程式主機只處理請求，資料庫只存檔案的 key，檔案本身放在一個專門為大量檔案設計、由雲端或儲存叢集負責耐久性的服務裡。

## 物件儲存的模型：bucket、key、物件

物件儲存的模型比檔案系統簡單很多：

- **bucket**：放物件的容器，權限、版本控制、生命週期規則多半以 bucket 為單位設定。以 AWS S3 來說，bucket 名稱在同一個分區（例如一般的商用區域）裡全球唯一。
- **key**：物件的名字，就是一個字串，例如 `avatars/42/01J9Q3K7.png`。物件儲存**沒有真正的資料夾**：`/` 只是 key 裡的一個字元，管理介面把它顯示成資料夾。列舉時用「前綴」（`Prefix=avatars/42/`）過濾。
- **物件**：一段位元組加上 metadata（`Content-Type`、`Cache-Control`、自訂欄位）與一個 `ETag`。讀寫以整個物件為單位：一般的 S3 API 沒有「把第 100 到 200 個位元組改掉」或「在後面追加」這種操作，要改就是整個物件重新上傳。讀取倒是可以用 `Range` 只讀一段。

跟本機磁碟、網路磁碟比較：

| | 本機磁碟 | 網路磁碟（NFS 等） | 物件儲存 |
|---|---|---|---|
| 多台主機共用 | 不行 | 可以 | 可以，透過 HTTP API |
| 容器重建後 | 寫在可寫層就消失 | 還在 | 還在 |
| 容量 | 受限於那顆磁碟 | 受限於檔案伺服器 | 依服務而定，通常不用自己規劃 |
| 存取方式 | 檔案系統呼叫 | 檔案系統呼叫 | HTTP（PUT / GET / DELETE / LIST） |
| 修改部分內容 | 可以 | 可以 | 不行，整個物件重寫 |
| 瀏覽器直接存取 | 要經過應用程式 | 要經過應用程式 | 可以（presigned URL、CDN） |

一致性方面，AWS S3 從 2020 年 12 月起對 PUT 與 DELETE 提供強的 read-after-write 一致性：寫入成功後立刻讀，一定讀到新內容，列舉也看得到。其他 S3 相容的服務不一定有同樣的保證，要看各自的文件。

資料庫裡該存的是 **key**，不是完整網址，也不是使用者給的原始檔名：

```sql
CREATE TABLE files (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id    bigint NOT NULL,
  storage_key text   NOT NULL UNIQUE,   -- 例如 'uploads/42/01J9Q3K7'：伺服器產生的隨機名稱
  filename    text   NOT NULL,          -- 使用者原本的檔名，只用來顯示與下載時命名
  content_type text  NOT NULL,
  size_bytes  bigint NOT NULL,
  status      text   NOT NULL DEFAULT 'pending',   -- pending → ready，上傳完成確認後才改
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

key 由伺服器產生（UUID 或其他隨機值），不直接用使用者的檔名：檔名可能重複、可能含 `../` 之類的字元，也可能洩漏資訊。

## S3 相容 API 與自建

AWS S3 的 HTTP API 已經是事實上的標準。很多服務提供「S3 相容」的 API，同一套 SDK 改一下 `endpoint_url` 就能用：Cloudflare R2、Google Cloud Storage 的 XML API（有互通模式）、各家雲端的物件儲存，以及可以在地端自建的 MinIO、Ceph 的 RADOS Gateway 等。

「相容」的程度不一樣。基本的 PUT / GET / DELETE / LIST 與 presigned URL 大多支援；版本控制、生命週期規則、presigned POST 的條件、物件鎖定這些進階功能，要逐項查該服務的文件。

用 Python 的 boto3 存取（需要真的物件儲存與憑證，不能在瀏覽器跑）：

```python
import boto3

# endpoint_url 指向 S3 相容服務；用 AWS S3 時省略。憑證從環境變數或執行角色讀，不寫在程式裡
s3 = boto3.client("s3", endpoint_url="http://localhost:9000", region_name="us-east-1")

# 上傳：key 是伺服器產生的名字，Content-Type 要明確設定，否則下載時瀏覽器不知道怎麼處理
s3.put_object(
    Bucket="app-uploads",
    Key="avatars/42/01J9Q3K7",
    Body=open("avatar.png", "rb"),
    ContentType="image/png",
)

# 下載
obj = s3.get_object(Bucket="app-uploads", Key="avatars/42/01J9Q3K7")
data = obj["Body"].read()

# 列舉某個「資料夾」：其實是用前綴過濾；一次最多回 1,000 筆，要用分頁
resp = s3.list_objects_v2(Bucket="app-uploads", Prefix="avatars/42/")
for item in resp.get("Contents", []):
    print(item["Key"], item["Size"])
```

開發環境可以在 docker compose 裡起一個 S3 相容的服務，讓本機與正式環境用同一套程式碼，只差 `endpoint_url` 與憑證。要注意 MinIO 的社群版採用 AGPLv3 授權，而且近年官方調整過社群版的發行方式與功能範圍；要拿來當正式環境的儲存，先確認它目前的版本、授權與維護狀態，再和其他自建方案或受管服務比較。

## 預簽網址：讓瀏覽器直接跟物件儲存講話

檔案經過 API 的做法（瀏覽器 → API → 物件儲存）會讓每個位元組進出 API 主機各一次，大檔案佔住 worker 與記憶體。**presigned URL**（預簽網址）把傳輸直接交給物件儲存：

1. 瀏覽器向 API 要求上傳：`POST /uploads`，附上檔名、類型、大小。
2. API 檢查登入與權限、驗證類型與大小，產生 key，在資料庫寫一筆 `pending`。
3. API 用**自己的憑證**簽出一個網址，簽章涵蓋：HTTP 方法（PUT）、bucket 與 key、到期時間，以及要求必須帶的標頭（例如 `Content-Type`）。
4. 瀏覽器拿這個網址直接 `PUT` 檔案到物件儲存。物件儲存驗證簽章與到期時間，通過就接受。
5. 瀏覽器通知 API 上傳完成；API 自己去物件儲存確認物件存在、大小正確，才把狀態改成 `ready`。

下載也一樣：API 確認使用者有權限後，簽一個短效的 GET 網址回給瀏覽器（或回 302 轉址過去）。

幾個要點：

- **網址本身就是授權**。到期前任何拿到網址的人都能用，所以到期時間要短（上傳幾分鐘、下載依用途），網址不要寫進 log、不要存進資料庫。資料庫存 key，每次需要時重新簽。
- **簽章綁定方法與 key**。用 GET 的網址去 PUT、改掉網址裡的 key，簽章都會不符。
- **到期時間有上限**。AWS 的 Signature Version 4 預簽網址最長 7 天；若用臨時憑證（例如執行角色）簽，憑證先到期的話網址也會跟著失效。
- **限制大小**：S3 的 presigned POST 可以在 policy 裡寫 `content-length-range`，由物件儲存拒絕超過大小的上傳。presigned PUT 的限制方式依服務與 SDK 而定，要查文件。
- **瀏覽器直傳需要 CORS**：bucket 要設定允許你的網站來源使用 PUT，否則瀏覽器會擋下請求（錯誤出現在瀏覽器 console，不在伺服器 log）。

真正的 Signature Version 4 要組 canonical request、用日期與區域推導簽章金鑰，細節由 SDK 處理。核心概念可以用 HMAC 簡化示範：伺服器用只有自己知道的密鑰，對「方法、key、到期時間」算出簽章；驗證時重算一次比對。

```python run
import hmac
import hashlib
from urllib.parse import urlencode, urlparse, parse_qs

SECRET = b"server-side-secret"   # 示範用；真實環境的密鑰來自憑證，不寫在程式裡

def sign(method: str, key: str, expires: int) -> str:
    # 簽章涵蓋方法、key、到期時間：任何一項被改，簽章就對不上
    msg = f"{method}\n{key}\n{expires}".encode()
    return hmac.new(SECRET, msg, hashlib.sha256).hexdigest()

def presign(method: str, key: str, now: int, ttl: int) -> str:
    expires = now + ttl
    return f"/{key}?" + urlencode({"expires": expires, "sig": sign(method, key, expires)})

def verify(method: str, url: str, now: int) -> str:
    u = urlparse(url)
    q = parse_qs(u.query)
    key = u.path.lstrip("/")
    expires = int(q["expires"][0])
    if now > expires:
        return "403 Request has expired"
    # compare_digest：比對時間不隨「前幾個字元相同」而變，避免 timing attack
    if not hmac.compare_digest(sign(method, key, expires), q["sig"][0]):
        return "403 SignatureDoesNotMatch"
    return "200 OK"

now = 1_700_000_000
url = presign("PUT", "uploads/42/01J9Q3K7", now, ttl=300)
print(url)
print("同一個網址、時間內 PUT：", verify("PUT", url, now + 60))
print("拿去 GET：            ", verify("GET", url, now + 60))
print("改掉 key：            ", verify("PUT", url.replace("/42/", "/43/"), now + 60))
print("十分鐘後：            ", verify("PUT", url, now + 600))
```

上傳要經過 API、用 presigned URL 直傳，還是分段上傳，取決於檔案大小、需不需要同步驗證內容與網路品質，設計情境 [使用者上傳檔案](#/scenario/upload) 有完整的比較與決策練習。

## 權限與公開 bucket 的外洩

「bucket 被設成公開，任何人都能列出與下載裡面的檔案」是反覆發生的資料外洩原因：身分證影本、合約、資料庫備份，被掃描公開 bucket 的工具找到。原因通常不是駭客技術，而是設定：為了讓前端能顯示圖片，把整個 bucket 打開。

原則：

- **上傳用的 bucket 永遠私有**。使用者的檔案一律透過 API 檢查權限後簽短效網址存取。
- **開啟 Block Public Access**。AWS S3 從 2023 年 4 月起，新建 bucket 預設開啟 Block Public Access 並停用 ACL；舊 bucket 與其他服務要自己確認。帳號層級也可以開啟，避免有人在某個 bucket 上誤開。
- **真的要公開的東西放另一個 bucket**。網站的靜態資源、公開下載的檔案放在專用的 bucket，前面接 CDN；不要和使用者上傳的檔案混在一起。
- **應用程式的憑證只給需要的權限**：只能存取自己的 bucket（甚至只有某個前綴），只有 `GetObject` / `PutObject` 等必要動作。在雲端用執行角色（role）取得臨時憑證，不要把長期的存取金鑰放進環境變數或映像檔。
- **隨機的 key 不是權限控制**。key 難猜可以降低被列舉的風險，但 bucket 一旦公開，有人拿到一個網址就能下載；「不容易猜到」不能取代「沒有授權就拿不到」。
- **列舉權限也要管**。`ListBucket` 的權限讓人看到所有 key，key 裡如果有使用者 id 或檔名，本身就是資訊洩漏。

## 版本控制與生命週期規則

**版本控制**（versioning）開啟後，同一個 key 的每次覆寫都留下舊版本；刪除只是加上一個「刪除標記」，舊版本還在，可以還原。這可以救回誤刪、被錯誤程式覆寫的檔案。代價是儲存空間：每個舊版本都照樣計費。以 S3 來說，版本控制一旦開啟就只能「暫停」，不能回到從未開啟的狀態。需要「誰都不能刪」（法規保存）時，還有物件鎖定（Object Lock）這類 WORM 功能。

**生命週期規則**（lifecycle rules）讓物件儲存依時間自動處理物件，不用自己寫排程：

- 轉換儲存層：30 天後轉到存取較少、較便宜的儲存層級，更久之後轉到封存層。
- 到期刪除：暫存檔 7 天後刪除、log 保存 1 年後刪除。
- 清理舊版本：非目前版本保留 30 天後刪除，避免版本控制讓費用無限成長。
- 清理未完成的分段上傳：上傳到一半放棄的分段不會自己消失，而且會計費。

S3 的生命週期設定大致長這樣（JSON 格式，用 SDK 或 CLI 套用）：

```json
{
  "Rules": [
    {
      "ID": "tmp-expire",
      "Filter": { "Prefix": "tmp/" },
      "Status": "Enabled",
      "Expiration": { "Days": 7 }
    },
    {
      "ID": "old-versions",
      "Filter": {},
      "Status": "Enabled",
      "NoncurrentVersionExpiration": { "NoncurrentDays": 30 }
    },
    {
      "ID": "abort-incomplete-mpu",
      "Filter": {},
      "Status": "Enabled",
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
    }
  ]
}
```

生命週期規則是非同步執行的，到期的物件不會在那一秒準時消失；需要準時失效的權限控制，要靠 presigned URL 的到期時間或應用程式自己的檢查。

## 大檔分段上傳

單一 PUT 有大小上限（AWS S3 是 5 GiB），而且傳到一半斷線就要整個重來。**multipart upload**（分段上傳）把檔案切成多段：

1. `CreateMultipartUpload`：取得一個 `UploadId`。
2. `UploadPart`：每段各自上傳（可以平行），每段回傳一個 ETag。也可以為每段簽 presigned URL，讓瀏覽器直傳。
3. `CompleteMultipartUpload`：送出所有段的編號與 ETag，物件儲存把它們合併成一個物件。
4. 放棄時呼叫 `AbortMultipartUpload`，否則已上傳的段會留著計費。

以 AWS S3 的規格，每段 5 MiB 到 5 GiB（最後一段可以小於 5 MiB），最多 10,000 段。斷線時只需要重傳失敗的那段；合併完成前，物件不會出現在 bucket 裡。

要注意：分段上傳的物件，`ETag` 通常不是整個檔案的 MD5，不能拿來跟本機算的 MD5 比對完整性。需要檢查完整性時，用服務提供的 checksum 功能或自己記錄雜湊值。

## 常見錯誤與錯誤訊息

物件儲存的錯誤是 HTTP 狀態碼加上 XML 裡的錯誤代碼（以 S3 為例）：

| 錯誤代碼 | 狀態碼 | 常見原因 | 怎麼查 |
|---|---|---|---|
| `AccessDenied` | 403 | 憑證沒有這個動作的權限、bucket policy 拒絕、Block Public Access 擋下公開存取 | 先確認是「誰」在呼叫（哪個角色、哪把金鑰），再看 IAM policy 與 bucket policy |
| `AccessDenied`，訊息 `Request has expired` | 403 | presigned URL 已過期 | 網址是不是被存起來重複使用？改成每次重新簽，或調整到期時間 |
| `SignatureDoesNotMatch` | 403 | 請求和簽章時不一致：方法不同、`Content-Type` 跟簽進去的不同、key 被改、區域或 endpoint 設錯 | 比對「簽的時候」與「送出時」的方法、標頭、key |
| `RequestTimeTooSkewed` | 403 | 發出請求的主機時鐘和服務差太多 | 校正主機時間（NTP） |
| `NoSuchKey` / `NoSuchBucket` | 404 | key 拼錯、物件已被刪除或被生命週期規則清掉、bucket 名稱或區域錯 | 用 `list_objects_v2` 加前綴確認實際的 key |
| `EntityTooLarge` | 400 | 超過單一 PUT 上限，或超過 presigned POST 的 `content-length-range` | 大檔改用分段上傳；確認大小限制是否符合需求 |
| `EntityTooSmall` | 400 | 分段上傳時，非最後一段小於 5 MiB | 調整分段大小 |

瀏覽器直傳時最常見的錯誤其實在瀏覽器 console：`No 'Access-Control-Allow-Origin' header is present on the requested resource`。這代表 bucket 沒有設定 CORS，或設定的來源、方法、標頭不包含這次請求。伺服器 log 不會有任何紀錄。

不會出現錯誤訊息、但會出事的情況：

- **資料庫存了完整的 presigned URL**：幾分鐘後所有圖片一起失效。存 key，讀取時再簽。
- **「先暫時公開一下」**：測試時打開的公開存取忘了關。用帳號層級的 Block Public Access 防止。
- **上傳完成直接相信客戶端**：客戶端說「傳好了」，API 就把狀態改成 `ready`。應該由 API 自己查物件的大小與類型，內容檢查（magic bytes、掃毒）交給背景工作。
- **刪除使用者時忘了物件儲存**：資料庫的列刪了，檔案還留在 bucket 裡。刪除流程要包含物件，或用前綴與生命週期規則統一清理。

## 動手

1. 執行上面 presigned URL 那段，把 `ttl` 改成 30、把驗證時間改成 `now + 31`，看到期判斷；再試著把網址裡的 `expires` 改大，確認簽章會不符。
2. 程式題「簡化版 presigned URL」：自己實作簽章與驗證，包含到期與竄改檢查。
3. 到設計情境 [使用者上傳檔案](#/scenario/upload)，比較經過 API、presigned URL 直傳與分段上傳在不同檔案大小下的取捨。
4. 本機有 Docker 時，在 compose 裡起一個 S3 相容服務，用 boto3 加上 `endpoint_url` 跑一次上傳、列舉、簽下載網址，再故意用過期的網址下載，看實際回傳的 XML 錯誤。

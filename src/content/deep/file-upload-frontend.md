## 從一個具體問題開始：轉診單傳了兩分鐘，最後回 413

病患在「我的掛號」上傳轉診單。第一版由 AI 產生，問題一個一個出現：

- 選了一張 18 MB 的手機照片，畫面只有一個轉圈圈，兩分鐘後顯示「上傳失敗」。後端的 nginx 早就回了 `413 Request Entity Too Large`，前端沒有先檢查大小，也沒有把 413 翻成看得懂的話。
- 換一台測試環境，每次上傳都回 400，訊息是 `Missing boundary in multipart.`。程式裡手動寫了 `headers: { 'Content-Type': 'multipart/form-data' }`。
- 另一個版本把檔案放進 JSON：`body: JSON.stringify({ file })`，Network 分頁的 Payload 是 `{"file":{}}`，伺服器收到一個空物件。
- 上傳中沒有進度、不能取消；網路慢的時候使用者以為當掉，重新整理頁面又傳了一次。

檔案上傳和一般的 JSON 請求不一樣：body 的格式不同、檔案大、要時間，而且檔案的內容不能相信。

## 運作原理

### 從選檔到送出

```text
<input type="file"> 或拖放
      │  input.files / e.dataTransfer.files：FileList
      ▼
File { name, size, type, lastModified }   ← size 與 type 由瀏覽器依檔案與副檔名得出
      │  前端檢查：數量、大小、類型（給即時回饋）
      ▼
送出：兩條路
  A. 經過 API：FormData → POST /api/uploads（multipart/form-data）
  B. 直傳：POST /api/uploads 取得預簽網址 → PUT 檔案到物件儲存 → 通知 API 完成
      │
      ▼
伺服器檢查：大小上限、magic bytes、病毒掃描、權限（這一步才算數）
```

### `File` 能告訴你什麼

- `name`：使用者電腦上的檔名，可以是任何字，不能直接拿來當儲存路徑。
- `size`：位元組數，準確。前端檢查大小靠它。
- `type`：瀏覽器依副檔名判斷的 MIME 類型；把 `setup.exe` 改名成 `setup.pdf`，`type` 就變成 `application/pdf`。判斷不出來時是空字串。
- `accept` 屬性只影響檔案選擇視窗預設列出哪些檔案，多數系統的選擇視窗可以切到「所有檔案」。

要多一層把關，可以用 `file.slice(0, 8).arrayBuffer()` 讀前幾個位元組比對 magic bytes（PDF 是 `%PDF-`，PNG 是 `89 50 4E 47`，JPEG 是 `FF D8 FF`）。這仍然只是給使用者的提早回饋，伺服器要自己再驗一次，見 [輸入驗證與檔案上傳](#/skill/input-validation)。

### `multipart/form-data` 與 boundary

一個 multipart 的 body 由好幾段組成，每段之間用一串分隔字串（boundary）隔開，這串字寫在 `Content-Type` 標頭裡：

```http
POST /api/uploads HTTP/1.1
Content-Type: multipart/form-data; boundary=----WebKitFormBoundarySxryIORRhJ0Kj8fh

------WebKitFormBoundarySxryIORRhJ0Kj8fh
Content-Disposition: form-data; name="appointmentId"

501
------WebKitFormBoundarySxryIORRhJ0Kj8fh
Content-Disposition: form-data; name="file"; filename="轉診單.pdf"
Content-Type: application/pdf

%PDF-…（檔案內容）
------WebKitFormBoundarySxryIORRhJ0Kj8fh--
```

上面是 Chromium 實際產生的格式。body 是 `FormData` 時，瀏覽器自己產生 boundary 並寫進 `Content-Type`。程式手動設 `Content-Type: multipart/form-data`，會把瀏覽器產生的值整個蓋掉，伺服器拿不到 boundary、切不開 body。後端是 FastAPI（Starlette 1.10）時，回 400 與 `Missing boundary in multipart.`。

### 上傳進度：fetch 做不到

fetch 有下載的串流（`res.body`），沒有上傳進度事件。fetch 的串流上傳（request body 是 `ReadableStream`、加上 `duplex: 'half'`）依 2026-11 的 web-features 資料只有 Chromium 系列支援，還不是 Baseline。

需要進度條時用 `XMLHttpRequest`：

| 事件 | 在哪裡 | 意思 |
|---|---|---|
| `xhr.upload.onprogress` | 上傳 | `e.loaded` 已送出的位元組，`e.lengthComputable` 為 `true` 時 `e.total` 是總數 |
| `xhr.upload.onload` | 上傳 | body 送完了（伺服器還沒回應） |
| `xhr.onload` | 回應 | 收到回應，`xhr.status` 是狀態碼 |
| `xhr.onerror` | 回應 | 網路錯誤，包含 CORS 被擋 |
| `xhr.onabort` | 回應 | 呼叫了 `xhr.abort()` |

`upload` 上的監聽要在 `send()` 之前註冊。

### 經過 API，或直傳物件儲存

| | 經過 API（`multipart/form-data`） | 預簽網址直傳 |
|---|---|---|
| 請求 | 1 個 | 3 個：要網址、PUT 檔案、通知完成 |
| 檔案經過 API 主機 | 是，每個位元組進出各一次 | 否 |
| 大小限制 | API 與反向代理的上限（nginx 的 `client_max_body_size` 預設 1m） | 物件儲存的上限；大檔案用分段上傳 |
| 前端要處理的錯誤 | 413、415、422 | 403（簽章不符、過期）、CORS |
| 適合 | 小檔、要同步驗證內容 | 大檔、量多 |

預簽網址的簽章綁定方法、key、到期時間與指定的標頭；送出的 `PUT` 要和簽的時候一致，`Content-Type` 不同就是 `SignatureDoesNotMatch`。bucket 端的設定與限制見 [物件儲存](#/skill/object-storage)，兩種架構的取捨見設計情境 [使用者上傳檔案](#/scenario/upload)。

## 實際程式

### 檢查檔案，與 FormData 實際送出的樣子

這段在瀏覽器的 Worker 裡跑：建立幾個 `File`，照規則逐檔檢查，再看 `FormData` 讓瀏覽器產生的 `Content-Type` 與 body，和手動設定標頭的差別。

```js run
// 前端檢查：數量、大小、宣稱的類型，再看檔案開頭幾個位元組（magic bytes）
const MAX_FILES = 3
const MAX_BYTES = 10 * 1024 * 1024
const SIGNATURES = {                               // 宣稱的類型 → 檔案開頭應該是什麼
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d],   // %PDF-
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/jpeg': [0xff, 0xd8, 0xff],
}

async function check(files) {
  const results = []
  if (files.length > MAX_FILES) results.push(`一次最多 ${MAX_FILES} 個檔案，選了 ${files.length} 個`)
  for (const f of files) {
    const mb = (f.size / 1024 / 1024).toFixed(1)
    if (!SIGNATURES[f.type]) { results.push(`${f.name}：不支援的類型（${f.type || '未知'}）`); continue }
    if (f.size > MAX_BYTES) { results.push(`${f.name}：${mb} MB，超過 10 MB`); continue }
    const head = new Uint8Array(await f.slice(0, 8).arrayBuffer())   // 只讀前 8 個位元組
    const ok = SIGNATURES[f.type].every((b, i) => head[i] === b)
    results.push(ok ? `${f.name}：可以上傳（${mb} MB）` : `${f.name}：內容不像 ${f.type}，可能改過副檔名`)
  }
  return results
}

const files = [
  new File(['%PDF-1.7 轉診單內容'], '轉診單.pdf', { type: 'application/pdf' }),
  new File([new Uint8Array(12 * 1024 * 1024)], '影像報告.pdf', { type: 'application/pdf' }),
  new File(['MZ…'], 'setup.exe', { type: 'application/x-msdownload' }),
  new File(['MZ…'], '檢驗報告.pdf', { type: 'application/pdf' }),   // 副檔名與 type 是 PDF，內容不是
]
for (const line of await check(files)) console.log(line)

// FormData：Content-Type 與 boundary 由瀏覽器產生
const fd = new FormData()
fd.append('appointmentId', '501')
fd.append('file', files[0])
const good = new Request('https://api.example.com/uploads', { method: 'POST', body: fd })
console.log('\n自動產生：', good.headers.get('content-type'))
console.log((await good.text()).split('\r\n').slice(0, 8).join('\n'))

const bad = new Request('https://api.example.com/uploads', {
  method: 'POST', body: fd, headers: { 'Content-Type': 'multipart/form-data' },   // 手動設定
})
console.log('\n手動設定：', bad.headers.get('content-type'), '← 沒有 boundary，後端切不開欄位')
console.log('JSON.stringify：', JSON.stringify({ file: files[0] }), '← File 沒有可列舉的屬性')
```

`new Request()` 只建立請求物件、不會送出，所以這段不需要網路。

### 有進度、可取消的上傳

```js
// upload.js：用 XMLHttpRequest 上傳一個檔案，回傳 { promise, abort }
export function uploadFile(url, file, { method = 'PUT', onProgress } = {}) {
  const xhr = new XMLHttpRequest()
  const promise = new Promise((resolve, reject) => {
    xhr.open(method, url)
    xhr.setRequestHeader('Content-Type', file.type)          // 直傳：和簽章時指定的一致
    xhr.upload.onprogress = (e) => {                          // send() 之前註冊
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300
      ? resolve(xhr)
      : reject(Object.assign(new Error(`HTTP ${xhr.status}`), { status: xhr.status, body: xhr.responseText })))
    xhr.onerror = () => reject(new TypeError('網路錯誤或被 CORS 擋下'))
    xhr.onabort = () => reject(new DOMException('已取消', 'AbortError'))
    xhr.send(file)                                            // 直傳時 body 就是檔案本身
  })
  return { promise, abort: () => xhr.abort() }
}
```

經過 API 時，把 `xhr.send(file)` 換成 `xhr.send(formData)`，並且拿掉 `setRequestHeader('Content-Type', …)`，理由和 fetch 一樣。

### Vue 元件裡的流程

```vue
<script setup>
import { ref, onUnmounted } from 'vue'
import { uploadFile } from './upload.js'

const items = ref([])          // 每個檔案：{ file, preview, status, progress, error, task }

function addFiles(fileList) {
  for (const file of fileList) {
    const error = file.size > 10 * 1024 * 1024 ? '超過 10 MB' : null
    const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null
    items.value.push({ file, preview, status: error ? 'invalid' : 'ready', progress: 0, error })
  }
}
function onPick(e) {
  addFiles(e.target.files)
  e.target.value = ''          // 清空，才能再選同一個檔案
}

async function start(item) {
  item.status = 'uploading'
  const res = await fetch('/api/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: item.file.name, type: item.file.type, size: item.file.size }),
  })
  if (!res.ok) { item.status = 'failed'; item.error = '無法取得上傳網址'; return }
  const { uploadUrl, key } = await res.json()
  item.task = uploadFile(uploadUrl, item.file, { onProgress: (p) => (item.progress = p) })
  try {
    await item.task.promise
    item.status = 'done'; item.key = key
  } catch (err) {
    item.status = err.name === 'AbortError' ? 'cancelled' : 'failed'
    item.error = err.name === 'AbortError' ? null : '上傳失敗，可以重試'
  }
}

function remove(item) {
  item.task?.abort()
  if (item.preview) URL.revokeObjectURL(item.preview)   // 釋放預覽用的 blob URL
  items.value = items.value.filter((x) => x !== item)
}

onUnmounted(() => items.value.forEach((x) => { x.task?.abort(); if (x.preview) URL.revokeObjectURL(x.preview) }))
</script>
```

每個檔案有自己的 `status`：`ready`、`invalid`、`uploading`、`done`、`failed`、`cancelled`。畫面依狀態顯示進度條、錯誤、重試或移除，和 [API 的四種狀態](#/skill/api-states) 一樣，每個狀態都要有對應的樣子。全部 `done` 之後才把 `key` 清單送給 API 建立轉診紀錄。

:::stop 讀到這裡可以先停：會用 FormData 送檔、在前端先檢查大小與類型，並用 XMLHttpRequest 顯示進度與取消。後面的拖放與錯誤對照，在要讓使用者把檔案拖進頁面或排查上傳失敗時再回來讀。

### 拖放

```js
function onDragOver(e) { e.preventDefault() }          // 沒有這行，drop 不會觸發，瀏覽器會直接開啟檔案
function onDrop(e) {
  e.preventDefault()
  addFiles(e.dataTransfer.files)                       // 和選檔走同一套檢查
}
```

放置區之外一定保留一顆「選擇檔案」按鈕（或可見的 `<input type="file">` 與 `<label>`），只用鍵盤或觸控的人沒辦法拖放。

## 常見錯誤與錯誤訊息

| 看到什麼 | 原因 | 怎麼修 |
|---|---|---|
| 400，`Missing boundary in multipart.`（FastAPI／Starlette） | 手動設了 `Content-Type: multipart/form-data` | body 是 FormData 時不要設 `Content-Type` |
| Payload 是 `{"file":{}}` | 把 File 放進 `JSON.stringify` | 用 FormData，或直傳時 body 直接放 File |
| 413 `Request Entity Too Large` | 超過伺服器或反向代理的上限 | 前端先檢查大小；文案寫出上限；大檔案改直傳 |
| 415 或 422 說類型不對 | 伺服器依內容判斷不是允許的格式 | 顯示允許的格式；前端的 `type` 檢查擋不住改名的檔案 |
| Console：`… has been blocked by CORS policy: Response to preflight request doesn't pass access control check` | 直傳時 bucket 沒有允許這個來源、`PUT` 或 `Content-Type` 標頭 | 由後端設定 bucket 的 CORS；伺服器 log 不會有紀錄 |
| 403，XML 裡是 `SignatureDoesNotMatch` | 送出的方法、key 或 `Content-Type` 和簽章時不同 | 比對要網址時傳的 `type` 與實際送出的標頭 |
| 403，`Request has expired` | 預簽網址過期（例如使用者停在頁面很久才按上傳） | 按下上傳時才要網址；過期就重要一次 |
| 進度條一直是 0，然後直接 100% | 監聽掛在 `xhr.onprogress`（下載），不是 `xhr.upload.onprogress`；或在 `send()` 之後才註冊 | 改掛 `xhr.upload`，在 `send()` 之前 |
| 再選同一個檔案沒反應 | input 的值沒變，不觸發 `change` | 處理完把 `input.value` 設成空字串 |

AI 產生上傳程式時最常見的兩個錯：手動設 multipart 的 `Content-Type`，以及用 fetch 卻宣稱有進度條。描述需求時寫明「不要手動設 Content-Type」與「進度用 `XMLHttpRequest` 的 `upload.onprogress`」。

## 動手

1. 執行上面「檢查檔案」那一段，把 `MAX_BYTES` 改成 1 MB、在 `SIGNATURES` 加上 `image/webp`（開頭是 `RIFF`，第 8 到 11 個位元組是 `WEBP`），看比對要怎麼改。
2. 在自己的專案找一個上傳功能，Network 分頁看 `Content-Type` 有沒有 boundary、Payload 有沒有檔案。
3. Network 節流選 `3G` 上傳一個幾 MB 的檔案，確認進度、取消與取消後重選都正常。
4. 讀後端的 [物件儲存](#/skill/object-storage) 了解預簽網址的簽章與分段上傳，再到設計情境 [使用者上傳檔案](#/scenario/upload) 決定頭像與影像報告各走哪條路。

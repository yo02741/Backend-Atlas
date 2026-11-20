## 從一個具體問題開始：登出之後，下一個人看到上一位病患

門診櫃檯的電腦由好幾位人員輪流使用。前端在登入成功後把這些東西存進 localStorage：

```js
localStorage.setItem('token', res.accessToken)
localStorage.setItem('user', JSON.stringify(res.user))              // 姓名、員工編號
localStorage.setItem('recentPatients', JSON.stringify(recent))      // 最近查過的病患與病歷號
localStorage.setItem('notify', settings.notify)                      // 叫號通知開關
```

上線一個月後陸續出現幾個回報：

1. 早班人員登出，晚班人員打開網站，首頁的「最近查詢」列出早班查過的病患姓名與病歷號。登出只呼叫了 `POST /api/logout` 再換到登入頁，localStorage 原封不動。
2. 有人關掉了叫號通知，重新整理後通知又出現。`notify` 存進去的是布林 `false`，讀出來是字串 `'false'`，`if (notify)` 成立。
3. 新版把設定的格式改了，部分使用者一打開就白畫面，Console 是 `Uncaught TypeError: Cannot read properties of undefined (reading 'mode')`：讀到的是舊版格式的資料。
4. 資安檢測報告指出：網站載入的第三方客服 script 讀得到 `token`。

每一個回報都對應到一條規則：資料存在哪裡、誰讀得到、存成什麼格式、什麼時候消失。

## 運作原理

### 五種儲存一覽

| | cookie | localStorage | sessionStorage | IndexedDB | Cache Storage |
|---|---|---|---|---|---|
| 範圍 | domain 與 path（不分 port） | origin | origin 加上分頁 | origin | origin |
| 自動跟著請求送出 | 是 | 否 | 否 | 否 | 否 |
| JavaScript 讀得到 | 沒有 `HttpOnly` 的才行 | 是 | 是 | 是 | 是 |
| 存的東西 | 字串 | 字串 | 字串 | 物件、陣列、`Date`、`Blob` 等 | `Request` 與 `Response` |
| API | `document.cookie`（同步） | 同步 | 同步 | 非同步 | 非同步（Promise） |
| 大小 | 每個約 4 KB | 多數瀏覽器每個 origin 約 5 MiB | 同左 | 依磁碟空間 | 依磁碟空間 |
| 什麼時候消失 | `Max-Age`／`Expires` 到期；沒設就是關閉瀏覽器時 | 程式刪除或使用者清除 | 關閉分頁 | 程式刪除、使用者清除，或空間不足時被瀏覽器回收 | 同 IndexedDB |
| Web Worker 能用 | 否 | 否 | 否 | 是 | 是 |

Chrome 的 cookie 上限寫在開發者工具的提示裡：名稱加上值不能超過 4096 個字元，超過的 cookie 會被擋下。localStorage 的 5 MiB 是 MDN 整理的常見值，各瀏覽器的實際上限不完全相同。

### 範圍：origin、分頁與 domain

localStorage 以 origin（scheme、主機、port）區分：`https://clinic.example` 和 `https://admin.clinic.example` 各有一份，`http://localhost:5173` 和 `http://localhost:4173` 也各有一份。開發時換了 port，之前存的設定就「不見了」。

sessionStorage 再細分到分頁：同一個網站開兩個分頁，各有一份 sessionStorage；重新整理還在，關掉分頁就清掉。用瀏覽器的「複製分頁」開出來的新分頁會帶一份當下的複本，之後兩邊各改各的。

cookie 的範圍規則不同：看 `Domain` 與 `Path`，不看 port。設了 `Domain=clinic.example` 的 cookie 會送給所有子網域。cookie 屬性的完整規則與伺服器怎麼設定，見後端的 [CORS、Cookie 與同源](#/skill/cors-cookies)。

### 生命週期與回收

存在瀏覽器裡的資料隨時可能消失：

- **使用者清除**：瀏覽器設定裡的「清除瀏覽資料」，或開發者工具的 `Clear site data`。
- **私密瀏覽**：關閉私密視窗時全部清掉。
- **空間不足**：IndexedDB 與 Cache Storage 預設是 best-effort，磁碟空間不夠時，瀏覽器會挑最久沒用的 origin 整批清掉。呼叫 `navigator.storage.persist()` 可以申請改成 persistent，瀏覽器不一定答應。`navigator.storage.estimate()` 回傳目前的用量與配額。
- **Safari 的 7 天規則**：Safari 從 2020 年起（Safari 13.1），對使用者 7 天沒有互動過的網站，刪除 script 寫入的儲存（localStorage、IndexedDB 等）；加到主畫面的網頁 App 不受這條影響。
- **嵌在別人網站裡**：網站被放進其他網站的 iframe 時，各瀏覽器會依頂層網站分開存放（storage partitioning），或直接封鎖。

所以存在瀏覽器的資料要當成快取：消失了，程式要能從伺服器重新取得，或回到預設值。

### 只存字串

`localStorage.setItem(key, value)` 會先把 `value` 轉成字串：

| 存進去 | 讀出來 | 問題 |
|---|---|---|
| `false` | `'false'` | 非空字串是真值，`if (notify)` 成立 |
| `42` | `'42'` | `'42' + 1` 是 `'421'` |
| `{ theme: 'dark' }` | `'[object Object]'` | 資料不見了，`JSON.parse` 會丟錯 |
| `undefined` | `'undefined'` | `JSON.parse` 會丟錯 |
| 沒存過的 key | `null` | `JSON.parse(null)` 回傳 `null`，不會丟錯 |

所以一律用 `JSON.stringify` 存、`JSON.parse` 讀，讀的時候包 `try/catch`，並在資料裡放版本號。localStorage 的讀寫是同步的，會卡住主執行緒：在每次輸入時把一大份資料 `JSON.stringify` 再寫入，打字會變慢。大量或結構化的資料放 IndexedDB。

### 誰讀得到

| 儲存 | 注入的 script（XSS、被入侵的第三方 script）讀得到嗎 | 自動跟著請求送出嗎 |
|---|---|---|
| `HttpOnly` cookie | 讀不到，但可以在這個頁面裡發請求，讓瀏覽器自動帶上 | 是：伺服器要處理 CSRF |
| 一般 cookie | 讀得到 | 是 |
| localStorage、sessionStorage | 讀得到 | 否 |
| IndexedDB、Cache Storage | 讀得到 | 否 |

同一個 origin 的所有 JavaScript 共用這些儲存，包括從 CDN 載入的第三方 script。token 放 localStorage，一個 XSS 就能把它讀走、拿到別的地方用；放 `HttpOnly` cookie，script 讀不到，代價是伺服器要防 CSRF。這是前後端一起決定的取捨，伺服器那一側見 [驗證基礎：Session vs Token](#/skill/authn-basics) 與 [XSS、CSRF 與安全標頭](#/skill/xss-csrf)。前端這一側的原則：病歷、身分證字號這類個資不存在瀏覽器；必須存的，登出時清乾淨。

### 多個分頁：`storage` 事件

localStorage 被改時，同一個 origin 的**其他**分頁收到 `storage` 事件，改的那個分頁收不到。事件帶著 `key`、`oldValue`、`newValue`；呼叫 `localStorage.clear()` 時 `key` 是 `null`。用途是讓所有分頁一起登出、一起切換深色模式。只想傳訊息、不想留下資料時，可以改用 `BroadcastChannel`（2022 年起各瀏覽器都支援）。

## 一段可以跑的模擬

Web Worker 裡沒有 localStorage，下面用一個 `MemoryStorage` 照瀏覽器的規則模擬（值先轉成字串、超過上限丟 `QuotaExceededError`，上限故意設得很小），重現開頭的幾個問題，再換成安全的寫法：

```js run
// 模擬 Web Storage 的行為：值一律轉成字串，超過上限丟 QuotaExceededError（上限故意設很小）
class MemoryStorage {
  constructor(limit = 200) { this.map = new Map(); this.limit = limit }
  getItem(key) { return this.map.has(String(key)) ? this.map.get(String(key)) : null }
  setItem(key, value) {
    const k = String(key), v = String(value)                    // 和瀏覽器一樣：先轉成字串
    let size = k.length + v.length
    for (const [k2, v2] of this.map) if (k2 !== k) size += k2.length + v2.length
    if (size > this.limit) throw new DOMException(`Setting the value of '${k}' exceeded the quota.`, 'QuotaExceededError')
    this.map.set(k, v)
  }
  removeItem(key) { this.map.delete(String(key)) }
  key(i) { return [...this.map.keys()][i] ?? null }
  get length() { return this.map.size }
}
const store = new MemoryStorage()

// 1. 布林與物件被轉成字串
store.setItem('clinic:notify', false)
const notify = store.getItem('clinic:notify')
console.log('notify =', JSON.stringify(notify), '→ if (notify) 成立嗎？', Boolean(notify))
store.setItem('clinic:prefs', { theme: 'dark' })
console.log('prefs =', store.getItem('clinic:prefs'))
for (const raw of [store.getItem('clinic:prefs'), 'undefined', store.getItem('clinic:missing')]) {
  try { console.log('JSON.parse(', raw, ') →', JSON.parse(raw)) }
  catch (e) { console.log('JSON.parse(', raw, ') →', `${e.name}: ${e.message}`) }
}

// 2. 安全的讀寫：JSON、版本號、try/catch
function writeJSON(key, value, version) {
  try { store.setItem(key, JSON.stringify({ version, value })); return true }
  catch (e) { console.log(`  寫入 ${key} 失敗：${e.name}`); return false }
}
function readJSON(key, version, fallback) {
  try {
    const raw = store.getItem(key)
    if (raw === null) return fallback                          // 沒存過
    const data = JSON.parse(raw)
    return data?.version === version ? data.value : fallback   // 舊格式：當成沒有
  } catch { return fallback }                                  // 壞掉的值：當成沒有
}
writeJSON('clinic:prefs:v1', { branch: 'main', darkMode: false }, 1)
console.log('讀 v1 →', JSON.stringify(readJSON('clinic:prefs:v1', 1, { branch: 'main', darkMode: false })))
console.log('程式改成 v2 再讀 →', JSON.stringify(readJSON('clinic:prefs:v1', 2, { branch: 'main', theme: { mode: 'light' } })))

// 3. 超過配額
const ok = writeJSON('clinic:cache', 'x'.repeat(300), 1)
console.log('大筆資料寫入成功？', ok, '；目前有', store.length, '個 key')

// 4. 登出：只刪自己前綴的 key
store.setItem('other-app', 'keep')
for (let i = store.length - 1; i >= 0; i--) { const k = store.key(i); if (k.startsWith('clinic:')) store.removeItem(k) }
console.log('登出後剩下的 key：', [...store.map.keys()])
```

錯誤訊息的格式以 Chrome 的 V8 為準；舊版 Chrome 的同一個錯誤是 `Unexpected token o in JSON at position 1`。

## 實際程式碼

### 包一層安全的讀寫

```js
// src/lib/storage.js：前端所有 localStorage 的讀寫都經過這裡
const PREFIX = 'clinic:'

export function readJSON(key, { version, fallback }) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw === null) return fallback
    const data = JSON.parse(raw)
    return data?.version === version ? data.value : fallback
  } catch {
    return fallback   // 格式壞掉、或儲存被封鎖（SecurityError）
  }
}

export function writeJSON(key, value, version) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ version, value }))
    return true
  } catch (e) {
    console.warn(`無法寫入 ${key}：${e.name}`)   // QuotaExceededError、SecurityError
    return false
  }
}

export function clearClinicStorage() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k?.startsWith(PREFIX)) localStorage.removeItem(k)
    }
    sessionStorage.clear()
  } catch { /* 儲存被封鎖時沒有東西可清 */ }
}
```

`readJSON` 連讀取 `localStorage` 本身都包進 `try`：使用者封鎖網站資料時，光是讀 `localStorage` 這個屬性就會丟 `SecurityError`。

### 登出時清理，並通知其他分頁

```js
import { clearClinicStorage } from './lib/storage.js'

export async function logout() {
  await fetch('/api/logout', { method: 'POST' })          // 伺服器讓 session 失效、清掉 cookie
  clearClinicStorage()
  indexedDB.deleteDatabase('clinic-cache')                 // 其他分頁還開著這個資料庫時，刪除會等它們關閉
  localStorage.setItem('clinic:logout-at', String(Date.now()))   // 觸發其他分頁的 storage 事件
  location.assign('/login')
}

// 每個分頁啟動時註冊：別的分頁登出了，這個分頁也回到登入頁
window.addEventListener('storage', (e) => {
  if (e.key === 'clinic:logout-at') {
    sessionStorage.clear()
    location.assign('/login')
  }
})
```

伺服器也可以在登出的回應加上 `Clear-Site-Data: "storage"`，要求瀏覽器清掉這個 origin 的儲存（Chrome 61、Firefox 63、Safari 17 起支援）。前端仍然要自己清，不依賴這個標頭。

:::stop 讀到這裡可以先停：會依範圍、生命週期與誰讀得到選儲存位置，用包一層的讀寫處理字串與版本，登出時清乾淨。後面的 VueUse、Pinia 與 IndexedDB，在要保存大量或結構化資料時再回來讀。

### Vue 裡的寫法

設定值這類小資料，可以用 VueUse 的 `useLocalStorage`：它依預設值的型別自動序列化，預設也會監聽 `storage` 事件同步其他分頁。

```js
import { useLocalStorage } from '@vueuse/core'

// 回傳一個 ref：改它就寫回 localStorage；mergeDefaults 讓舊資料缺的欄位補上預設值
const prefs = useLocalStorage('clinic:prefs:v1', { branch: 'main', darkMode: false }, { mergeDefaults: true })
prefs.value.darkMode = true
```

Pinia 的 store 要保存到 localStorage 時，常見的做法是 `pinia-plugin-persistedstate`，在 store 上指定要保存哪些欄位；token 與個資不要列進去。

### 大量資料用 IndexedDB

科別與醫師名單這類幾百筆的參考資料，用 IndexedDB 快取。原生 API 是事件式的，`idb` 套件把它包成 Promise：

```js
import { openDB } from 'idb'

const db = await openDB('clinic-cache', 1, {
  upgrade(db) {
    // 版本號變大時才會執行：建立或調整 object store
    db.createObjectStore('departments', { keyPath: 'id' })
  },
})
await db.put('departments', { id: 'IM', name: '內科', updatedAt: new Date() })   // Date 原樣存進去
const all = await db.getAll('departments')
```

IndexedDB 的資料一樣可能被瀏覽器回收，程式要能在資料不見時向伺服器重抓。

## 常見錯誤與錯誤訊息

| 錯誤訊息或現象 | 原因 | 修法 |
|---|---|---|
| `SyntaxError: "[object Object]" is not valid JSON` | 存物件前沒有 `JSON.stringify` | 用 `writeJSON` 這類包裝；舊資料當成沒有 |
| `SyntaxError: "undefined" is not valid JSON` | 存了 `undefined` | 寫入前檢查值，或改成刪除這個 key |
| `QuotaExceededError: Failed to execute 'setItem' on 'Storage': Setting the value of '…' exceeded the quota.` | localStorage 滿了，常見原因是把 API 回應或圖片的 data URL 整份存進去 | 大資料改放 IndexedDB；寫入包 `try/catch` |
| `SecurityError: Failed to read the 'localStorage' property from 'Window': Access is denied for this document.` | 使用者封鎖網站資料，或網站被嵌在第三方 iframe 裡 | 讀取也包 `try/catch`，失敗時用預設值 |
| `ReferenceError: localStorage is not defined` | 在 Web Worker 裡，或 SSR 時在伺服器端（Node.js）執行到這段 | 只在瀏覽器端執行，Vue 裡放在 `onMounted` 之後 |
| 關掉的開關重新整理後又打開 | 存了布林，讀回來是 `'false'` | `JSON.stringify` 存、`JSON.parse` 讀 |
| 改版後白畫面，`Cannot read properties of undefined` | 讀到舊格式的資料 | 資料帶版本號，版本不同就丟掉 |
| 登出後下一個人看到前一個人的資料 | 登出沒清 localStorage、sessionStorage、IndexedDB | 登出時清掉自己前綴的 key 與資料庫 |
| 開發時換了 port，設定都不見 | localStorage 以 origin 區分，port 不同是不同的 origin | 正常現象；固定開發用的 port |

## 動手

1. 打開本站，在 Application 分頁的 Local storage 找到本站存學習進度的 key，看它的值是不是 JSON；在 Console 執行 `localStorage.length` 與 `navigator.storage.estimate().then(console.log)`。
2. 按上面模擬的「在 Playground 開啟」，把 `MemoryStorage` 的上限改成 `2000`，看大筆資料寫入成功；再在 `readJSON` 拿掉 `try/catch`，看壞掉的值怎麼讓程式中斷。
3. 開兩個分頁到同一個網站，在其中一個的 Console 執行 `localStorage.setItem('demo', Date.now())`，在另一個分頁先執行 `addEventListener('storage', (e) => console.log(e.key, e.newValue))`，看哪一邊收到事件。
4. 在自己的專案列出所有寫進 Web Storage、IndexedDB 的 key，標出每一個的內容、版本號、登出時有沒有清掉。
5. 接著讀 [從前端看同源與 CORS](#/skill/same-origin-frontend)，看 cookie 在跨來源請求裡什麼時候會被帶上。

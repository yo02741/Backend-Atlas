## 從一個具體問題開始：正式站白畫面，錯誤指向第 1 行

櫃台回報：今天下午報表頁打開是白的。在正式站打開 Console，只有這一段：

```
Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'name')
    at index-C1a2b3c4.js:1:48213
    at Array.map (<anonymous>)
    at index-C1a2b3c4.js:1:48190
    at async index-C1a2b3c4.js:1:47977
```

訊息本身說得很清楚：某個值是 `undefined`，程式卻去讀它的 `name`。麻煩在位置：`index-C1a2b3c4.js` 是 Vite 建置出來、壓縮成一行的檔案，第 1 行第 48213 個字元對不回任何一個 `.vue` 檔。在本機跑開發環境也重現不了，因為本機的測試資料每個診間都有醫師。

這次的查法是：先把正式站那支 API 的回應存下來（Network 分頁對請求按右鍵 `Copy` → `Copy response`），換進本機的假資料；在開發環境打開 Sources 分頁，勾選 `Pause on uncaught exceptions`，重新整理。程式停在 `ClinicRow.vue` 的 `row.doctor.name` 那一行，Scope 裡的 `row` 是家醫科 108，沒有 `doctor` 欄位。改成 `row.doctor?.name ?? '醫師未定'` 就修好了。

事後補了兩件事：建置產生 hidden source map 交給錯誤監控，下次的 stack trace 直接是原始檔名與行號；在 `app.config.errorHandler` 裡把錯誤送回後端，不必等櫃台打電話。這一課整理讀錯誤訊息、對回原始碼、用 DevTools 停下來看現場，以及在 Vue 裡把錯誤收集起來的方法。

## 運作原理

### 錯誤物件與錯誤類型

丟出的錯誤通常是 `Error` 或它的子類別，有三個常用的屬性：`name`（類型）、`message`（訊息）、`stack`（呼叫鏈的文字）。ES2022 起還可以帶 `cause`，把原本的錯誤包在新的錯誤裡（Baseline 2021）。

| 類型 | 意思 | 常見例子（Chrome 的訊息） |
|---|---|---|
| `TypeError` | 對值做了它不支援的事 | `Cannot read properties of undefined (reading 'name')`、`data.map is not a function`、`Assignment to constant variable.` |
| `ReferenceError` | 用了不存在的變數 | `patient is not defined`、`Cannot access 'A' before initialization` |
| `SyntaxError` | 程式碼或 JSON 的格式錯 | `Unexpected token '<', "<!doctype "... is not valid JSON` |
| `RangeError` | 數值超出範圍 | `Maximum call stack size exceeded`（遞迴沒有停） |

同一個錯在不同瀏覽器的措辭不同：讀 `undefined` 的屬性，Safari 是 `undefined is not an object (evaluating 'row.doctor.name')`，Firefox 以 `can't access property "name"` 開頭。搜尋錯誤訊息時，拿掉變數名再搜比較容易找到。

`Unexpected token '<', "<!doctype "... is not valid JSON` 值得記住：`res.json()` 拿到的是 HTML。多半是 API 路徑寫錯，伺服器把不存在的路徑回成了 `index.html`；到 Network 分頁看那一筆的 Response 就知道。

### 讀 stack trace

```
TypeError: Cannot read properties of undefined (reading 'name')
    at ClinicRow.vue:18:42           ← 最上面：丟出錯誤的地方
    at renderComponentRoot (…)       ← Vue 內部，先略過
    at ReportView.vue:31:7           ← 呼叫它的元件
    at async loadReport (api.js:12:18)   ← 經過 await 的呼叫者
```

由上往下讀：第一行是錯在哪裡，往下是一層一層的呼叫者。先找第一個自己寫的檔案，`node_modules`、Vue 的 runtime 這些 frame 通常不是問題所在。V8（Chrome、Edge、Node）會在經過 `await` 的地方加上 `at async …` 的 frame，所以非同步函式也看得到是誰呼叫的。

錯誤訊息前面的 `Uncaught` 表示沒有任何 `try`/`catch` 接住它，`Uncaught (in promise)` 表示是一個沒人處理的 Promise 失敗。

### source map

建置會把幾百個檔案打包、壓縮成幾個 `index-<hash>.js`，行號與變數名都不一樣了。source map 是一個 `.map` 的 JSON 檔，記錄「建置後的第幾行第幾個字」對到「哪個原始檔的第幾行」。JS 檔最後一行的 `//# sourceMappingURL=index-C1a2b3c4.js.map` 告訴 DevTools 去哪裡找它。DevTools 讀到 source map 後，stack trace 與 Sources 分頁都顯示原始檔名與行號，也能在原始碼上下中斷點。

Vite 開發時一律提供 source map。建置時由 `build.sourcemap` 決定（Vite 8 的說明）：

| 設定 | 產生 `.map` | JS 檔尾的 `sourceMappingURL` | 用途 |
|---|---|---|---|
| `false`（預設） | 不產生 | 無 | 不需要對回原始碼 |
| `true` | 產生獨立檔案 | 有 | 任何人打開 DevTools 都看得到原始碼 |
| `'inline'` | 寫進 JS 檔本身（data URI） | 有 | 檔案變大很多，正式環境少用 |
| `'hidden'` | 產生獨立檔案 | 無 | 只上傳給錯誤監控服務，不部署到公開網站 |

公開 source map 等於公開原始碼與註解。前端程式碼本來就會被下載，不該有秘密；要不要公開是團隊的決定，`'hidden'` 是兩者之間的做法。

Vite 開發伺服器還會把 `node_modules` 裡的檔案標進 source map 的 ignore list（`server.sourcemapIgnoreList` 的預設），DevTools 一步一步執行時會跳過它們，stack trace 也會收起來。想進到某個套件裡看，在 Sources 分頁對檔案按右鍵選 `Remove from ignore list`；Call Stack 區塊也可以勾 `Show ignore-listed frames` 顯示被收起來的 frame；反過來，對不想看的檔案選 `Add script to ignore list`。

### 用 DevTools 停下來看現場

`console.log` 要先猜該印什麼；中斷點讓程式停在某一行，當下所有的值都看得到。

| 工具 | 在哪裡 | 什麼時候用 |
|---|---|---|
| 一般中斷點 | Sources 分頁，點行號 | 知道大概是哪一行 |
| `debugger` 敘述 | 寫在程式碼裡 | DevTools 開著時執行到就停；找不到檔案時好用，提交前要刪 |
| 條件中斷點 | 行號按右鍵 `Add conditional breakpoint…` | 迴圈或列表裡只有某一筆有問題，例如 `row.id === 108` |
| Logpoint | 行號按右鍵 `Add logpoint…` | 想印值又不想改程式碼、不想停下來 |
| 例外時停下 | Breakpoints 區塊的 `Pause on uncaught exceptions`（另有 `Pause on caught exceptions`） | 錯誤一丟出就停在丟出的那一行，看當下的值 |
| DOM 中斷點 | Elements 分頁，節點按右鍵 `Break on` → `subtree modifications`、`attribute modifications`、`node removal` | 不知道是哪段程式改了這個元素 |
| `XHR/fetch breakpoints` | Sources 分頁 | 不知道是哪段程式送了這個請求 |
| `Event listener breakpoints` | Sources 分頁 | 不知道按下按鈕後執行了哪個處理函式 |

停下來之後：

- Scope 區塊列出目前作用域的所有變數；滑鼠移到程式碼裡的變數上也看得到值。
- Call Stack 區塊是目前的呼叫鏈，點任何一層可以看那一層的變數。
- Watch 區塊放想持續觀察的運算式。
- Console 在暫停時是在目前的作用域執行，可以直接打 `row.doctor`、`list.filter(...)` 試。
- 繼續執行（F8）、跳過下一個函式呼叫（F10）、進入函式（F11）、跳出目前的函式（Shift+F11）。

### Console 的方法

| 方法 | 用途 |
|---|---|
| `console.log`、`console.info` | 一般輸出 |
| `console.warn`、`console.error` | 黃色、紅色，可以用上方的等級篩選只看這些；`console.error` 也會附上 stack |
| `console.debug` | Verbose 等級，Console 預設不顯示，要在等級選單打開 Verbose |
| `console.table(list)` | 陣列或物件印成表格，第二個參數可以指定欄位 |
| `console.dir(obj)` | 展開物件的屬性（印 DOM 元素時看屬性而不是 HTML） |
| `console.trace()` | 印出目前的呼叫鏈：這個函式被誰呼叫 |
| `console.time('x')`、`console.timeEnd('x')` | 量兩點之間的時間 |
| `console.count('x')` | 數這一行執行了幾次，例如 `onUpdated` 被觸發幾次 |
| `console.group`、`console.groupEnd` | 把一組輸出收成可以展開的一段 |

Console 裡還能用 `$0` 取得 Elements 分頁目前選取的元素，`copy(obj)` 把值複製到剪貼簿。

### Vue 的錯誤會走到哪裡

```
元件的 setup、渲染、生命週期鉤子、watcher、@click 處理函式丟出錯誤
（這些函式回傳的 Promise 被拒絕也算）
   │
   ▼
往上逐層呼叫父元件的 onErrorCaptured；有一個回傳 false 就停在那裡
   │
   ▼
app.config.errorHandler：有設定就交給它，不再往下
   │
   ▼
沒有設定：開發時印出 [Vue warn]: Unhandled error during execution of mounted hook
         這類警告並重新丟出錯誤；正式環境只用 console.error 印出
```

errorHandler 收到三個參數：錯誤、發生錯誤的元件實例、說明位置的 `info`。開發時 `info` 是 `mounted hook`、`render function` 這類文字；正式環境為了縮小檔案，換成 `https://vuejs.org/error-reference/#runtime-m` 這類網址，打開就看得到代表哪一種位置。

Vue 只接得到它自己呼叫的函式丟出的錯。下面這些不經過 Vue：

- `setTimeout`、`setInterval` 的回呼，以及自己用 `addEventListener` 加的監聽器：由 `window` 的 `error` 事件接。
- 呼叫了 async 函式卻沒有回傳或 `await` 它的 Promise：`onMounted(() => { load() })` 裡 `load()` 失敗，Vue 收不到；寫成 `onMounted(async () => { await load() })` 或 `onMounted(() => load())`，Vue 才收得到。其他沒人接的 Promise 由 `window` 的 `unhandledrejection` 事件接。
- 從別的網域載入的 script（第三方套件的 CDN 網址）丟出的錯，`window` 的 `error` 事件只拿到 `Script error.`，沒有訊息與位置，除非 `<script>` 加上 `crossorigin` 而且對方的回應帶有 CORS 標頭。

## 實際程式碼

### 錯誤的 name 與 message

```js run
// 每一種都是前端常見的錯；在這裡接住，印出 name 與 message
const samples = {
  '讀 undefined 的屬性': () => { const row = { dept: '家醫科' }; return row.doctor.name },
  'JSON 拿到 HTML': () => JSON.parse('<!doctype html><html lang="zh-Hant">'),
  'JSON 拿到空字串': () => JSON.parse(''),
  '變數不存在': () => patientName.trim(),
  '不是函式': () => { const data = Promise.resolve([]); return data.map((x) => x) },
  '遞迴沒有停': () => { const walk = (n) => walk(n + 1); return walk(0) },
}
for (const [label, fn] of Object.entries(samples)) {
  try {
    fn()
  } catch (err) {
    console.log(`${label} → ${err.name}: ${err.message}`)
  }
}
```

### 用 `cause` 保留原本的錯誤

```js run
async function fetchReport(month) {
  throw new TypeError('Failed to fetch')               // 模擬網路錯誤
}

async function loadReport(month) {
  try {
    return await fetchReport(month)
  } catch (err) {
    // 包一層說明「在做什麼的時候失敗」，原本的錯誤放進 cause
    throw new Error(`載入 ${month} 月報失敗`, { cause: err })
  }
}

try {
  await loadReport('2026-11')
} catch (err) {
  console.log('訊息：', err.message)
  console.log('原因：', `${err.cause.name}: ${err.cause.message}`)
  console.log('cause 仍是原本的 TypeError：', err.cause instanceof TypeError)
}
```

Chrome 的 Console 印出帶 `cause` 的錯誤時，下面會多一段 `Caused by:`，列出原本的錯誤與它的 stack。

### 在 `main.js` 收集錯誤

```js
// main.js
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { showToast } from './ui/toast.js'

const app = createApp(App)

function sendClientError(payload) {
  // keepalive：頁面正在關閉時也送得出去
  fetch('/api/client-errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, release: import.meta.env.VITE_RELEASE, at: new Date().toISOString() }),
    keepalive: true,
  }).catch(() => {})   // 回報失敗不能再丟錯，否則會一直回報自己
}

// 一定要在 app.mount() 之前設定，掛載過程中的錯誤才收得到
app.config.errorHandler = (err, instance, info) => {
  sendClientError({ message: String(err?.message ?? err), stack: err?.stack, info, route: router.currentRoute.value.fullPath })
  showToast('系統發生錯誤，請重新整理')
  if (import.meta.env.DEV) console.error(err)   // 開發時仍在 Console 看得到
}

// Vue 管不到的錯
window.addEventListener('error', (e) => {
  sendClientError({ message: e.message, stack: e.error?.stack, route: location.hash })
})
window.addEventListener('unhandledrejection', (e) => {
  sendClientError({ message: String(e.reason?.message ?? e.reason), stack: e.reason?.stack, route: location.hash })
})

app.use(router).mount('#app')
```

設定了 errorHandler 之後，Vue 不再自己印出錯誤，開發時記得像上面一樣自己 `console.error`，否則錯誤會「消失」。送出的資料不要放病患姓名這類個資。

### 用 `onErrorCaptured` 只讓一個區塊壞掉

```vue
<!-- PanelBoundary.vue：包住儀表板的每一塊，一塊壞掉不影響其他塊 -->
<script setup>
import { ref, onErrorCaptured } from 'vue'

const failed = ref(false)
onErrorCaptured((err, instance, info) => {
  failed.value = true
  return false   // 停止往上傳；不回傳 false 的話，錯誤還會送到 app.config.errorHandler
})
</script>

<template>
  <p v-if="failed" role="alert">這個區塊暫時無法顯示</p>
  <slot v-else />
</template>
```

回傳 `false` 會讓錯誤停在這裡，errorHandler 就收不到；要同時回報，在這裡自己呼叫回報函式。

### 建置時產生 hidden source map

```js
// vite.config.js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: {
    sourcemap: 'hidden',   // 產生 .map，但 JS 檔尾不加 sourceMappingURL
  },
})
```

建置後 `dist/assets/` 裡每個 `.js` 旁邊多一個 `.js.map`。上傳給錯誤監控服務之後，從部署的檔案裡移除（或設定伺服器不提供 `.map`）。

## 常見錯誤與錯誤訊息

| 訊息 | 原因 | 怎麼查、怎麼修 |
|---|---|---|
| `TypeError: Cannot read properties of undefined (reading 'name')` | 某個值是 `undefined` | 停在那一行看 Scope，往回找值從哪裡來；資料可能缺欄位就用 `?.` |
| `TypeError: Cannot read properties of null (reading 'focus')` | 值是 `null`，常見於 template ref 在掛載前、`querySelector` 找不到 | 改到 `onMounted` 之後，或先判斷 |
| `TypeError: data.map is not a function` | 不是陣列：少了 `await`，或 API 多包了一層 | 印出 `typeof data` 或看 Network 的 Response |
| `ReferenceError: patientName is not defined` | 變數名打錯、沒有 import，或在 `<script setup>` 外面用到 | 對照宣告與 import |
| `SyntaxError: Unexpected token '<', "<!doctype "... is not valid JSON` | `res.json()` 拿到 HTML：API 路徑錯，伺服器回了 `index.html` | Network 分頁看那一筆的網址與 Response |
| `SyntaxError: Unexpected end of JSON input` | 回應是空的（例如 `204`）卻呼叫了 `res.json()` | 先看狀態碼與 `Content-Length` |
| `RangeError: Maximum call stack size exceeded` | 遞迴沒有停，或兩個函式互相呼叫 | 看 stack trace 裡重複出現的那幾行 |
| `[Vue warn]: Unhandled error during execution of mounted hook` | 生命週期裡丟出錯誤，而且沒有 errorHandler | 展開警告下面的元件名稱與錯誤；補上 errorHandler |
| `Uncaught (in promise) …` | Promise 失敗沒有人處理 | 找到沒有 `await` 或沒有 `catch` 的呼叫 |
| `Script error.` | 跨網域的 script 出錯，瀏覽器不給細節 | `<script crossorigin>` 加上對方的 CORS 標頭；或自己託管該檔案 |
| stack trace 只有 `index-<hash>.js:1:48213` | 沒有 source map | 開發環境重現，或建置時產生 source map |

## 動手

- 按「錯誤的 name 與 message」的「在 Playground 開啟」，每一種錯先猜訊息再執行；把 `row.doctor.name` 改成 `row.doctor?.name`，看那一行變成什麼。
- 在本機的 Vue 專案裡，對一個列表元件的某一行下條件中斷點（`item.id === 某個值`），只在那一筆停下，讀 Scope 裡的值；再把它改成 logpoint。
- 在 Sources 分頁勾選 `Pause on uncaught exceptions`，在 `onMounted` 裡故意讀 `undefined` 的屬性，看程式停在哪一行、Call Stack 長什麼樣。
- 照「在 `main.js` 收集錯誤」設定 errorHandler，分別在 `onMounted`、`setTimeout` 與沒有 `await` 的 async 函式裡丟錯，看各由哪一段接到。
- 錯誤背後的機制：`await` 與 Promise 失敗見 [非同步：Promise 與 async/await](#/skill/async-js)，模組載入的錯誤見 [模組與套件](#/skill/modules)，DevTools 各分頁的驗收順序見 [開發者工具](#/skill/devtools)。

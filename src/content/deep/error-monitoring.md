## 從一個具體問題開始：「按了報到沒反應」

週一早上，三個診間的護理師打電話說「按報到沒反應」。工程師在自己的電腦上試，一切正常；伺服器的 log 也沒有任何 `/api/checkin` 的錯誤，因為請求根本沒有送出。

最後是遠端連到其中一台電腦、打開 DevTools 才看到：

```
TypeError: Cannot read properties of undefined (reading 'name')
    at Xe (index-DKeOfM_j.js:1:48211)
    at index-DKeOfM_j.js:1:51022
```

有些病患資料沒有 `doctor` 欄位，報到按鈕的處理函式讀 `appt.doctor.name` 就丟錯，畫面停在原地。這個錯誤發生在使用者的瀏覽器裡，除非有人打開 Console，否則沒有任何人知道。就算看到了，`Xe` 與 `1:48211` 是壓縮後的名稱與位置，也看不出是哪個檔案的哪一行。

錯誤監控要解決這兩件事：把使用者瀏覽器裡的錯誤收回來，並且把壓縮後的位置對回原始碼。

## 運作原理

### 錯誤從哪裡冒出來

前端的錯誤有幾條不同的路，每條路由不同的機制接住。下表是用 Vue 3.5.45 在 Chromium 實際觸發每一種錯誤的結果：

| 錯誤發生在 | 誰收得到 | 備註 |
|---|---|---|
| 模板裡 `@click` 的處理函式 | `app.config.errorHandler` | `info` 是 `native event handler`；正式版是 `https://vuejs.org/error-reference/#runtime-5` |
| `async` 處理函式裡 `await` 之後丟錯 | `app.config.errorHandler` | Vue 會接住處理函式回傳的 Promise 的 reject |
| 元件渲染、`setup`、生命週期鉤子、watcher | `app.config.errorHandler` | 往上經過每一層父元件的 `onErrorCaptured` |
| `onMounted` 裡 `setTimeout` 的回呼 | `window` 的 `error` 事件 | 不在 Vue 呼叫的範圍內 |
| 自己用 `addEventListener` 掛的監聽 | `window` 的 `error` 事件 | 同上 |
| 沒有 `catch` 的 Promise | `window` 的 `unhandledrejection` 事件 | Console 顯示 `Uncaught (in promise)` |
| 圖片、script 載入失敗（404） | 只有 capture 模式掛在 `window` 的 `error` 監聽 | 這種事件不冒泡，`window.onerror` 收不到；`event.target` 是那個元素 |
| 其他網域載入的 script 丟錯 | `window` 的 `error` 事件，但訊息只有 `Script error.` | 見下一節 |

有一個容易漏掉的地方：**正式版沒有設 `app.config.errorHandler` 時，Vue 接住錯誤後只會 `console.error`，不會再丟出去**，`window` 的 `error` 事件收不到。只掛全域監聽，會漏掉所有元件裡的錯誤。開發版的行為不同：Vue 會先印 `[Vue warn]: Unhandled error during execution of native event handler`，再把錯誤丟出去，所以在開發時以為全域監聽收得到。

Vue 3.5 另有 `app.config.throwUnhandledErrorInProduction`，設成 `true` 讓正式版也把沒處理的錯誤丟出去；預設是 `false`。

### `Script error.`：跨網域 script 的錯誤被遮住

瀏覽器不讓網頁讀到其他網域 script 的錯誤細節（可能洩漏那個網域的資訊）。實測從 `127.0.0.1` 載入一支會丟錯的 script 到 `localhost` 的頁面：

| `<script>` 的寫法 | `window` 的 `error` 事件收到的 |
|---|---|
| `<script src="http://127.0.0.1:4392/thrower.js">` | `message: "Script error."`，沒有檔名、行號、`error` 物件 |
| `<script src="…/thrower.js" crossorigin="anonymous">`，而且回應帶 `Access-Control-Allow-Origin` | `Uncaught TypeError: Cannot read properties of null (reading 'rooms')`，有檔名與 `error` 物件 |

自家的 JS 放在另一個網域（例如 CDN 子網域）時，`<script>` 加 `crossorigin="anonymous"`，伺服器回 `Access-Control-Allow-Origin`。Vite 建置出的 `index.html` 本來就在 module script 加了 `crossorigin`。第三方 script 改不了，就只能收到 `Script error.`，通常在監控服務裡直接忽略。

### source map

正式版的 JS 經過壓縮，函式名稱改成一兩個字母、整個檔案只有一行。source map（`.map` 檔）記錄壓縮後的每個位置對應原始檔的哪一行、哪個名稱。Vite 的 `build.sourcemap` 有三種值：

| 值 | 產生 `.map` | JS 最後一行的 `//# sourceMappingURL=` | 用途 |
|---|---|---|---|
| `true` | 會 | 有 | DevTools 自動載入；部署出去等於公開原始碼 |
| `'inline'` | 寫進 JS 檔裡（data URI） | 有 | 開發除錯；檔案變很大 |
| `'hidden'` | 會 | 沒有 | 上傳給監控服務，瀏覽器不會去要 |
| `false`（預設） | 不會 | 沒有 | |

正式環境用 `'hidden'`：建置時產生 `.map`、上傳到監控服務、從要部署的檔案裡刪掉。監控服務收到錯誤時，用同一個版本的 `.map` 把 `index-DKeOfM_j.js:1:48211` 換成 `src/views/CheckinBoard.vue:42`。版本要對得上：每次建置的檔案不同，用錯版本的 map 會指到錯的位置。Sentry 的建置外掛會在 JS 裡注入 Debug ID 與 release，讓服務找到對應的 map。

### 錯誤監控服務做什麼

把每一筆錯誤直接寫進資料庫很快就會淹沒。監控服務（例如 Sentry，也可以自架）做的是：

- **分組**：同一個 bug 在 Chrome、Safari、Firefox 的訊息不同（`Cannot read properties of undefined (reading 'name')`、`undefined is not an object (evaluating 'a.name')`、`can't access property "name", a is undefined`），服務依 stack trace 把它們歸成同一個問題。
- **附上情境**：版本、環境、瀏覽器、目前的路由、錯誤前的操作紀錄（breadcrumbs：點了什麼、送了哪些請求）。
- **通知**：新的錯誤、某個錯誤突然變多、新版本上線後錯誤率上升。
- **取樣與限流**：同一個錯誤一秒觸發一百次，不需要一百筆。

### 錯誤裡的個資

錯誤訊息、URL、breadcrumbs、請求內容都可能帶到病患資料：`/patients?idno=A123456789` 的 query string、錯誤訊息裡印出的姓名、表單欄位的值。送出前要過濾，服務端的資料收集設定也要逐項確認（@sentry/vue 11 用 `dataCollection` 控制是否收集使用者資訊、cookie、標頭、query string 與請求內容，多數項目預設是開的）。服務端的處理與稽核見 [日誌裡的個資](#/skill/logs-pii)。

## 實際程式

### 不用第三方服務：自己收

```js
// src/errors.js：在 main.js 的 createApp 之後呼叫 installErrorReporting(app)
const RELEASE = import.meta.env.VITE_APP_VERSION   // 建置時寫入的版本

function report(kind, err, extra = {}) {
  const body = JSON.stringify({
    kind,                                   // 'vue' | 'error' | 'rejection' | 'resource'
    message: String(err?.message ?? err).slice(0, 500),
    stack: err?.stack?.slice(0, 4000),
    release: RELEASE,
    route: location.pathname,               // 不送 query string
    ua: navigator.userAgent,
    ...extra,
  })
  navigator.sendBeacon('/api/client-errors', body)
}

export function installErrorReporting(app) {
  // 1. Vue 元件裡的錯誤；正式版不設這個，錯誤只會 console.error
  app.config.errorHandler = (err, instance, info) => {
    // <script setup> 的元件要用 defineOptions({ name }) 取名，這裡才拿得到
    report('vue', err, { info, component: instance?.$options?.name })
    console.error(err)                      // 保留在 Console 裡
  }

  // 2. Vue 之外的錯誤（setTimeout、原生監聽、第三方 script）
  //    capture: true 才收得到圖片、script 載入失敗
  window.addEventListener('error', (e) => {
    if (e.error || e.message) report('error', e.error ?? e.message, { file: e.filename, line: e.lineno })
    else if (e.target?.tagName) report('resource', `${e.target.tagName} 載入失敗`, { src: e.target.src || e.target.href })
  }, true)

  // 3. 沒有 catch 的 Promise
  window.addEventListener('unhandledrejection', (e) => report('rejection', e.reason))

  // 4. 部署後舊頁面要的 chunk 不見了（見 SPA 的部署）
  window.addEventListener('vite:preloadError', (e) => {
    report('chunk', e.payload)
    location.reload()
  })
}
```

`sendBeacon` 在頁面關閉時也送得出去。Chrome 團隊的 Modern Web Guidance 對錯誤回報這類不需要回應的資料，建議改用 `fetchLater()`，但它目前只有 Chrome、Edge 135 起支援，要保留 `sendBeacon` 當退路（寫法見 [Core Web Vitals](#/skill/web-vitals) 的收集程式）。

自己收的好處是資料不出院內；缺點是分組、對 source map、通知都要自己做。

### 用 Sentry

```js
// main.js
import { createApp } from 'vue'
import * as Sentry from '@sentry/vue'
import App from './App.vue'
import { router } from './router.js'

const app = createApp(App)

Sentry.init({
  app,                                   // 會接上 app.config.errorHandler，保留原本設的處理函式
  dsn: 'https://publicKey@o0.ingest.sentry.example/1',   // DSN 不是秘密，本來就會出現在前端
  environment: import.meta.env.MODE,
  release: import.meta.env.VITE_APP_VERSION,
  integrations: [Sentry.browserTracingIntegration({ router })],
  tracesSampleRate: 0.1,
  beforeSend(event) {
    // 拿掉網址的 query string，遮掉身分證號格式的字串
    if (event.request?.url) event.request.url = event.request.url.split('?')[0]
    const mask = (s) => s?.replace(/[A-Z][12]\d{8}/g, '[idno]')
    for (const ex of event.exception?.values ?? []) ex.value = mask(ex.value)
    return event
  },
})

app.use(router).mount('#app')
```

```js
// vite.config.js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { sentryVitePlugin } from '@sentry/vite-plugin'

export default defineConfig({
  build: { sourcemap: 'hidden' },
  plugins: [
    vue(),
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,   // 只放在 CI 的 secret，不進版控
      sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
    }),
  ],
})
```

DSN 只能用來送錯誤進來，放在前端沒關係；`SENTRY_AUTH_TOKEN` 能上傳與管理資料，是 secret。CI 的寫法見 [前端的 CI](#/skill/frontend-ci)。

### 在元件裡接住、顯示退路

`onErrorCaptured` 讓一個區塊壞掉時，整頁不要一起壞：

```vue
<script setup>
import { ref, onErrorCaptured } from 'vue'

const failed = ref(false)
onErrorCaptured((err) => {
  failed.value = true
  // 回傳 false 會停止往上傳，app.config.errorHandler 就收不到；要回報就不要回傳 false
})
</script>

<template>
  <p v-if="failed" role="alert">看板暫時無法顯示，請重新整理。</p>
  <slot v-else />
</template>
```

## 常見錯誤與錯誤訊息

| 現象或訊息 | 原因 | 修法 |
|---|---|---|
| 監控服務收不到任何 Vue 元件裡的錯誤 | 只掛了 `window` 的 `error`；正式版的 Vue 只 `console.error` | 設 `app.config.errorHandler`，或用會接上它的 SDK |
| 只收到 `Script error.`，沒有檔名與行號 | 跨網域 script，少了 `crossorigin` 或 CORS 標頭 | 自家的 script 加 `crossorigin="anonymous"` 並回 `Access-Control-Allow-Origin`；第三方的忽略 |
| stack trace 只有 `index-DKeOfM_j.js:1:48211` | source map 沒上傳，或 release 對不上 | 建置時產生並上傳 map；錯誤帶上同一個 release |
| `https://clinic.example/assets/index-*.js.map` 打得開 | `build.sourcemap: true` 把 map 一起部署了 | 改 `'hidden'`，上傳後刪掉 `.map` |
| `Uncaught (in promise) TypeError: Failed to fetch` 大量出現 | 網路斷線或請求被取消，被當成程式錯誤回報 | 在呼叫端處理 fetch 的錯誤；監控服務設定忽略規則 |
| `TypeError: Failed to fetch dynamically imported module` | 部署後舊頁面要的 chunk 已經不在 | 監聽 `vite:preloadError` 重新載入（見 [SPA 的部署](#/skill/spa-deploy)） |
| 錯誤裡出現病患姓名或身分證號 | 錯誤訊息或 URL 帶了個資 | `beforeSend` 過濾；程式裡的錯誤訊息不要拼進個資 |
| 加了 `onErrorCaptured` 之後監控服務收不到 | 回傳了 `false`，錯誤不再往上傳 | 不回傳 `false`，或自己在裡面回報 |
| 同一個錯誤一分鐘幾千筆 | 錯誤發生在計時器或捲動事件裡 | 修掉根因；監控端設取樣與限流 |

## 動手

1. 在開發版的 Console 執行 `setTimeout(() => { throw new Error('test') })` 與 `Promise.reject(new Error('test'))`，看 Console 各顯示什麼；再到正式建置的預覽（`npm run build && npm run preview`）裡，讓一個按鈕的處理函式丟錯，確認沒設 `errorHandler` 時只有 `console.error`。
2. 把「自己收」那段接到測試環境，DevTools 的 Network 分頁看 `/api/client-errors` 的 payload，確認沒有 query string 與個資。
3. `vite.config.js` 設 `build.sourcemap: 'hidden'` 建置一次，確認 `dist/assets` 有 `.map`、JS 最後一行沒有 `sourceMappingURL`；再確認部署腳本會刪掉這些 `.map`。
4. 列出自己的系統用到的外部 script（統計、客服、地圖），看它們是不是跨網域、有沒有 `crossorigin`。

## 從一個具體問題開始：搜尋結果裡的「載入中」

醫院把對外的「門診時刻表」也做進了門診前端的 SPA，網址是 `https://clinic.example/schedule`。上線一個月後，行銷同事發現兩件事：

1. 在搜尋引擎找「內科 門診時刻」，結果的摘要寫著「載入中…」。
2. 病患用手機 4G 打開這一頁，先看到幾秒白畫面才出現時刻表；同一頁在院內電腦上很快。

按 Ctrl+U 檢視原始碼，伺服器送來的 HTML 是這樣：

```html
<!doctype html>
<html lang="zh-Hant">
  <head>
    <script type="module" crossorigin src="/assets/index-DKeOfM_j.js"></script>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>
```

時刻表的文字不在 HTML 裡。瀏覽器要先下載並執行 `index-*.js`，Vue 掛載後再呼叫 `/api/schedule`，資料回來才畫出表格。網路慢、手機 CPU 慢，每一步都拉長。搜尋引擎的爬蟲能執行同步的 JavaScript，但不會一直等非同步請求回來（Vue 官方文件的 SSR 章節有同樣的提醒），所以它看到的就是「載入中」。

團隊把這一頁改成伺服器渲染，HTML 裡有了時刻表，搜尋摘要正常了。但開發版的 Console 多了一段警告：

```
[Vue warn]: Hydration text content mismatch on <p class="now">
  - rendered on server: 09:00
  - expected on client: 09:01
  at <App>
Hydration completed but contains mismatches.
```

頁面上方的「現在時間 09:00」是伺服器在渲染那一刻算的，瀏覽器接手時已經過了一分鐘。下面依序說明三種渲染方式、hydration 在做什麼，以及這個警告怎麼處理。

## 運作原理

### 三種渲染方式的時間線

同一套 Vue 元件可以在三個地方、三個時間點變成 HTML：

| | HTML 在哪裡產生 | 什麼時候 | 使用者先看到 | 部署 |
|---|---|---|---|---|
| CSR（client-side rendering） | 使用者的瀏覽器 | 每次打開頁面，JS 執行完之後 | 空白或 loading，等 JS 與 API | 靜態檔 |
| SSR（server-side rendering） | 伺服器（多半是 Node.js） | 每個請求 | 完整內容，但還不能互動 | 要跑程式的伺服器 |
| SSG（static site generation） | 建置機器 | `npm run build` 的那一刻 | 完整內容，但還不能互動 | 靜態檔 |

以手機打開時刻表為例，把時間線拆開來看（數字是示意）：

```
CSR  請求 HTML ─ 下載 JS ──── 執行 JS、掛載 ─ 呼叫 /api/schedule ── 畫出時刻表、可以操作
     0          0.3s          1.5s             2.2s                  3.0s

SSR  請求 HTML（伺服器呼叫 API 並渲染）─ 畫出時刻表 ─ 下載 JS ─ hydration 完成、可以操作
     0                                  0.8s          0.8s~     2.0s

SSG  請求 HTML（建置時已經產生好）─ 畫出時刻表 ─ 下載 JS ─ hydration 完成、可以操作
     0                              0.4s          0.4s~     1.6s
```

SSR 與 SSG 讓內容提早出現，LCP（見 [Core Web Vitals](#/skill/web-vitals)）通常因此改善；可以操作的時間點不一定比較早，因為瀏覽器一樣要下載並執行同一份 JS。

### hydration：接手伺服器的 HTML

CSR 用 `createApp(App).mount('#app')`，Vue 從零建立 DOM。SSR 與 SSG 的頁面，DOM 已經在那裡了，瀏覽器端改用 `createSSRApp(App).mount('#app')`：Vue 照樣在瀏覽器執行一次渲染，但不建立新的節點，而是沿著現有的 DOM 逐一比對，在對應的元素上接上事件監聽與響應式狀態。這個過程叫 hydration。

hydration 完成之前，畫面上的按鈕看得到，但沒有任何監聽，點了沒有反應。頁面越大、JS 越多、裝置越慢，這段空窗越長。Vue 3.5 加入了延遲 hydration，例如讓頁尾的元件捲到視窗內才 hydrate：

```js
import { defineAsyncComponent, hydrateOnVisible } from 'vue'

// 只在 SSR 的頁面有作用：元件的 HTML 先顯示，進入視窗才下載程式並 hydrate
const ClinicMap = defineAsyncComponent({
  loader: () => import('./ClinicMap.vue'),
  hydrate: hydrateOnVisible(),
})
```

### hydration mismatch

伺服器與瀏覽器各渲染一次，兩次的結果必須相同。Vue 官方文件列出三個常見原因：

- **不合法的 HTML 巢狀**：`<p><div>…</div></p>`。伺服器送出這段字串，瀏覽器的 HTML 解析器在遇到 `<div>` 時就把 `<p>` 關掉，實際的 DOM 和 Vue 預期的不同。
- **每次渲染結果不同的值**：亂數、`Date.now()`、「現在時間」。
- **伺服器與瀏覽器的時區不同**：`toLocaleString()` 沒指定時區時用執行環境的時區，在伺服器（常是 UTC）與使用者的瀏覽器（台北）印出不同的時間。門診時間屬於院區所在地，格式化時寫明 `timeZone: 'Asia/Taipei'`（`Intl.DateTimeFormat` 或 `toLocaleString` 的選項），兩邊就印出同一個字串。

另外，在渲染時讀 `window.innerWidth`、`localStorage` 決定要顯示什麼，伺服器上沒有這些值，也會不一致。

Vue 遇到不一致時會把那個節點改成瀏覽器這次渲染的結果，頁面通常還能用，但多做了工，閃一下也可能被使用者看到。開發版會指出是哪個元素、兩邊各是什麼值；正式版預設只在 Console 留一行 `Hydration completed but contains mismatches.`，不說是哪裡（要細節得在建置時打開 `__VUE_PROD_HYDRATION_MISMATCH_DETAILS__`）。所以要在開發階段清乾淨。

### SSR 在伺服器上的限制

- `setup` 與 `<script setup>` 的頂層會在伺服器執行；`onMounted`、`onUpdated`、`onUnmounted` 不會。`window`、`document`、`localStorage` 只能在 `onMounted` 之後碰，寫在頂層會在伺服器上丟出 `ReferenceError: window is not defined`。
- 在 `setup` 頂層開的 `setInterval`，伺服器上沒有卸載可以清掉它，會一直留在伺服器的程序裡；計時器放 `onMounted`，在 `onUnmounted` 清掉（見 [Vue 的生命週期](#/skill/lifecycle)）。
- 伺服器程序只啟動一次、服務所有人。模組頂層 `export const state = reactive({})` 這種共用狀態，會被不同使用者的請求共用，A 的資料可能出現在 B 的頁面上（Vue 文件稱為 cross-request state pollution）。app、router、Pinia store 要每個請求各建一份。

## 實際程式

### 最小的 SSR：Node.js 上渲染、瀏覽器上 hydrate

```js
// server.js（在 Node.js 執行）
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

const app = createSSRApp({
  data: () => ({ now: '09:00', rooms: ['內科 101', '外科 203'] }),
  template: `<main><h1>今日門診</h1><p class="now">{{ now }}</p>
    <ul><li v-for="r in rooms" :key="r">{{ r }}</li></ul></main>`,
})

console.log(await renderToString(app))
```

用 Vue 3.5.45 實際執行，印出：

```html
<main><h1>今日門診</h1><p class="now">09:00</p><ul><!--[--><li>內科 101</li><li>外科 203</li><!--]--></ul></main>
```

`<!--[-->` 與 `<!--]-->` 是 Vue 留給 hydration 用的註解，標出 `v-for` 這類片段的開頭與結尾。正式的專案不會自己寫伺服器：要處理路由、資料抓取、每個請求一份 store、client 與 server 兩份建置，Vue 官方建議直接用框架。

### 修掉「現在時間」的 mismatch

```vue
<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

// 伺服器與瀏覽器第一次渲染都是 null，兩邊一致
const now = ref(null)
let timer

onMounted(() => {
  // 只在瀏覽器執行：hydration 完成後才開始算時間
  const tick = () => { now.value = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) }
  tick()
  timer = setInterval(tick, 30_000)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <p class="now">現在時間 {{ now ?? '--:--' }}</p>
</template>
```

確定兩邊一定不同、而且不重要的值，Vue 3.5 起可以用 `data-allow-mismatch` 明確允許，值可以限定類型（`text`、`children`、`class`、`style`、`attribute`）：

```html
<span data-allow-mismatch="text">{{ updatedAt.toLocaleString() }}</span>
```

固定的日期時間不該靠 `data-allow-mismatch` 遮掉，指定時區就能讓兩邊一致：

```js run
// 同一個時刻，在 UTC 的伺服器與台北的瀏覽器都印出院區時間
const at = new Date('2026-11-20T01:30:00Z')
const fmt = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'short',
})
console.log(fmt.format(at))
console.log(at.toLocaleString('zh-TW', { timeZone: 'UTC' }))   // 沒寫時區時，伺服器會印出這種結果
```

日期與時區的計算（跨日、夏令時間）Chrome 團隊的 Modern Web Guidance 建議用 `Temporal`，它目前是 Limited availability（Chrome、Edge 144 與 Firefox 139 起，Safari 還沒有），要用 `temporal-polyfill` 當退路；只是顯示的話，`Intl.DateTimeFormat` 加 `timeZone` 已經夠用。

元素需要不重複的 `id`（例如 `<label for>` 對應的欄位）時，用 Vue 3.5 的 `useId()`，伺服器與瀏覽器產生同一個值；用亂數產生 `id` 就是一個 mismatch。

:::stop 讀到這裡可以先停：會從初始 HTML 分辨 CSR、SSR、SSG，修掉一個 hydration mismatch。後面的 Nuxt `routeRules` 與選擇方式，在要替不同頁面各選渲染方式時再回來讀。

### 用 Nuxt 依路由選渲染方式

Nuxt 4 預設每個頁面都 SSR。門診系統可以這樣分：

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  routeRules: {
    '/departments/**': { prerender: true },   // 科別介紹：建置時產生 HTML（SSG）
    '/schedule': { swr: 600 },                // 時刻表：SSR，結果快取 600 秒，過期時先給舊的、背景重新產生
    '/staff/**': { ssr: false },              // 櫃台操作介面：只在瀏覽器渲染（CSR）
  },
})
```

`swr` 會加上快取標頭並在伺服器或反向代理快取整個回應，只能用在每個人看到的內容都一樣的頁面。含病患資料的頁面若被共用快取，A 的頁面可能送給 B；這類頁面維持 CSR，或回應 `Cache-Control: private, no-store`（標頭規則見 [HTTP 快取與條件請求](#/skill/http-caching)）。整個專案都不要 SSR 時設 `ssr: false`；只產生靜態檔時用 `nuxt generate`。

不需要 Node.js 伺服器、只想讓幾個公開頁面預先渲染時，VitePress 這類 SSG 工具或 Nuxt 的 `nuxt generate` 產出的是靜態檔，部署方式和 [SPA 的部署](#/skill/spa-deploy) 一樣。

### 怎麼選

| 頁面 | 建議 | 理由 |
|---|---|---|
| 櫃台掛號、看診進度（要登入） | CSR | 不需要被搜尋，使用者長時間停留；部署最簡單 |
| 科別介紹、就醫須知 | SSG | 內容建置時就確定，沒有伺服器成本 |
| 公開的時刻表（每天變） | SSR 加快取，或 SSG 並每天重新建置 | 要被搜尋、內容會變，每個人看到的一樣 |
| 個人化又要首屏快（例如登入後的首頁） | 先 CSR，量到 LCP 不夠再考慮 SSR | SSR 的伺服器成本與程式限制要有對應的收益 |

## 常見錯誤與錯誤訊息

| 現象或訊息 | 原因 | 修法 |
|---|---|---|
| `[Vue warn]: Hydration text content mismatch on …`，下面列出 `rendered on server` 與 `expected on client` | 時間、亂數、時區、`window` 的值讓兩次渲染不同 | 放到 `onMounted` 之後才算；確定無害時加 `data-allow-mismatch` |
| `Hydration children mismatch` 或 `Hydration node mismatch` | 不合法的巢狀（`<p>` 裡放 `<div>`、`<a>` 裡放 `<a>`），或 `v-if` 依賴瀏覽器才有的值 | 修正 HTML 結構；依賴瀏覽器的區塊在 `onMounted` 後才顯示 |
| 正式環境的 Console 只有 `Hydration completed but contains mismatches.` | 正式版不印細節 | 在開發版重現；必要時打開 `__VUE_PROD_HYDRATION_MISMATCH_DETAILS__` |
| `ReferenceError: window is not defined`（伺服器的 log） | `setup` 頂層或 import 的套件直接用了瀏覽器的物件 | 移到 `onMounted`；只能在瀏覽器跑的元件包在 `<ClientOnly>`（Nuxt、VitePress 都有） |
| 伺服器的記憶體越用越多 | `setup` 頂層開了計時器或監聽，伺服器上沒有卸載 | 副作用放 `onMounted`，在 `onUnmounted` 清掉 |
| A 使用者的資料出現在 B 的頁面 | 模組頂層的共用狀態被不同請求共用，或個人化頁面被 CDN 快取 | 每個請求建新的 app 與 store；個人化頁面不進共用快取 |
| 頁面看得到，點按鈕沒反應幾秒 | hydration 還沒完成 | 減少首頁的 JS、延遲 hydration 不急的區塊 |
| 搜尋摘要寫「載入中」 | CSR 的頁面，內容靠非同步請求 | 公開頁面改 SSG 或 SSR |

## 動手

1. 打開任一個 Vue 或 Nuxt 的網站，按 Ctrl+U 看原始碼，判斷它是 CSR、SSR 還是 SSG；再到 DevTools 按 Ctrl+Shift+P 執行 `Disable JavaScript` 重新整理，確認判斷。
2. 在本機照「最小的 SSR」那段，用 Node.js 跑 `renderToString`，把 `now` 改成 `new Date().toLocaleTimeString()`，再寫一個 `createSSRApp(...).mount('#app')` 的頁面接手這段 HTML，在 Console 看 mismatch 的警告長什麼樣。
3. 為自己的系統列一張「頁面 × 渲染方式」的表，每一列寫出理由：要不要被搜尋、內容什麼時候確定、能不能進共用快取。
4. 對 SSR 的頁面跑 `curl -I`，檢查含個人資料的頁面 `Cache-Control` 不是 `public`。

## 從一個具體問題開始：按上一頁，篩選條件不見了

掛號清單頁用 Vue Router，網址是 `/appointments`。科別、日期、頁碼存在元件的 ref 裡：

```js
const dept = ref('')
const date = ref(today())
const page = ref(1)
watch([dept, date, page], load, { immediate: true })
```

櫃檯人員選了「內科」、11 月 20 日、翻到第 3 頁，點進一筆掛號 `/appointments/42` 看詳細資料，再按瀏覽器的上一頁：清單回到今天、全部科別、第 1 頁，捲動位置也回到最上面。要找下一筆，只能重新篩選、重新翻頁。

同一個專案部署之後又出現第二個問題：在 `/appointments/42` 按重新整理，畫面變成 nginx 的 `404 Not Found`。在本機用 `npm run dev` 與 `vite preview` 都測不出來。

兩個問題都和「網址」有關：篩選條件沒有寫進網址，上一頁時元件重建就丟了；SPA 換頁時網址只在瀏覽器裡改，伺服器上沒有 `/appointments/42` 這個檔案。

## 運作原理

### 網址的組成

```
https://clinic.example:8443/appointments/42?date=2026-11-20&dept=%E5%85%A7%E7%A7%91#notes
└─┬─┘   └──────┬──────┘└┬─┘└──────┬───────┘└───────────────┬────────────────────┘└─┬──┘
scheme       主機      port      path                       query                  hash
└──────────────┬──────────────┘
             origin
```

| 部分 | `URL` 物件的屬性 | 用途 | 送到伺服器嗎 |
|---|---|---|---|
| origin | `origin` | 同源判斷的單位（見 [從前端看同源與 CORS](#/skill/same-origin-frontend)） | 是 |
| path | `pathname` | 哪一個資源：`/appointments/42` | 是 |
| query | `search`、`searchParams` | 怎麼看這個資源：篩選、排序、頁碼 | 是 |
| hash | `hash` | 頁內的位置，或 hash 模式的路由 | 否，只留在瀏覽器 |

### 編碼

網址裡只能出現有限的字元，中文、空白、`&`、`=`、`#` 都要編碼。手動拼字串時，「耳鼻喉&頭頸」裡的 `&` 會被當成兩個參數的分隔，`#` 會把後面的內容變成 hash。`URLSearchParams` 會自動處理：

| 寫法 | 空白 | `&` | 中文 |
|---|---|---|---|
| `URLSearchParams` | `+` | `%26` | `%E5%85%A7…` |
| `encodeURIComponent` | `%20` | `%26` | `%E5%85%A7…` |
| `encodeURI` | `%20` | 不編碼 | `%E5%85%A7…` |

`encodeURI` 保留 `&`、`?`、`/` 這些網址結構的字元，用來編整個網址，不能用在單一個參數值上。query 裡的 `+` 多數伺服器框架都會解成空白。

### 瀏覽紀錄與 History API

每個分頁有一串瀏覽紀錄（session history）與一個「目前位置」。上一頁、下一頁是在這串紀錄裡移動：

| API 或動作 | 瀏覽紀錄 | 重新載入頁面嗎 | 觸發的事件 |
|---|---|---|---|
| 點一般的 `<a href>`、`location.assign()` | 新增一筆 | 是 | （新頁面重新載入） |
| `location.replace()` | 換掉目前這一筆 | 是 | （新頁面重新載入） |
| `history.pushState(state, '', url)` | 新增一筆 | 否 | 無 |
| `history.replaceState(state, '', url)` | 換掉目前這一筆 | 否 | 無 |
| 使用者按上一頁、下一頁（在同一份文件的紀錄之間） | 移動目前位置 | 否 | `popstate` |
| 改 `location.hash` | 新增一筆 | 否 | `hashchange` |

`pushState` 之後在目前位置後面的紀錄會被丟掉：從第 1 頁點進 A 再按上一頁，接著點 B，原本的 A 就沒辦法用「下一頁」回去了。`pushState` 的網址必須和目前頁面同源，否則丟出 `SecurityError`。

### SPA 的路由怎麼運作

```
使用者點 <RouterLink to="/appointments/42">
  → Vue Router 攔下 click（preventDefault，不讓瀏覽器整頁載入）
  → history.pushState(…, '/appointments/42')       網址列改了，沒有向伺服器要 HTML
  → 比對路由表，渲染 AppointmentDetail 元件

使用者按上一頁
  → 瀏覽器觸發 popstate，網址列回到 /appointments?dept=…
  → Vue Router 讀新的網址，渲染 AppointmentList 元件（元件是重建的）
```

上一頁時清單元件是重新建立的，ref 回到初始值。條件寫在網址的 query 裡，新元件才讀得回來；捲動位置則交給 Vue Router 的 `scrollBehavior`，它在 `popstate` 時拿到瀏覽器記下的位置。

### 重新整理時伺服器看到什麼

| 網址列 | history 模式（`createWebHistory`）伺服器收到 | hash 模式（`createWebHashHistory`）伺服器收到 |
|---|---|---|
| `https://clinic.example/appointments/42` | `GET /appointments/42` | 不會出現這種網址 |
| `https://clinic.example/#/appointments/42` | 不會出現這種網址 | `GET /` |
| `https://clinic.example/assets/index-B3zU5jYu.js` | `GET /assets/index-B3zU5jYu.js` | 同左 |

history 模式下，重新整理 `/appointments/42` 時伺服器要回 `index.html`，讓前端的路由接手；伺服器上的靜態檔（`/assets/` 底下）照常回傳，找不到的仍然回 404。`vite` 與 `vite preview` 預設就有這個 fallback（`appType: 'spa'`），所以問題要到部署後才看得到。

hash 模式的網址多了 `#`，但伺服器只會收到 `/`，部署到不能設定 fallback 的靜態主機也能用。本站的網址用的是 `#/skill/…` 這種 hash 路由。hash 模式的缺點是網址比較醜、頁內錨點（`#notes`）不能再拿來跳到段落。

網站放在子路徑（`https://clinic.example/booking/`）時，Vite 的 `base` 設成 `/booking/`，路由用 `createWebHistory(import.meta.env.BASE_URL)`，伺服器的 fallback 也要回 `/booking/index.html`。

瀏覽器另有一套較新的 Navigation API（`navigation.navigate()`、`navigate` 事件），2026 年 1 月成為 Baseline（Chrome 102、Firefox 147、Safari 26.2 起支援）。Vue Router 5 仍然用 History API 實作。

## 一段可以跑的示範

`URL` 與 `URLSearchParams` 在 Web Worker 裡也能用。下面拆一個網址、比較兩種組 query 的寫法，最後模擬一串瀏覽紀錄在 push、replace、上一頁時的變化（方括號是目前位置）：

```js run
// 1. 拆開一個網址
const u = new URL('https://clinic.example:8443/appointments/42?date=2026-11-20&dept=%E5%85%A7%E7%A7%91#notes')
for (const k of ['origin', 'protocol', 'host', 'pathname', 'search', 'hash']) console.log(k.padEnd(9), u[k])
console.log('dept     ', u.searchParams.get('dept'))          // 自動解碼成「內科」

// 2. 組 query：手動拼字串 vs URLSearchParams
const dept = '耳鼻喉&頭頸'
const bad = '/appointments?dept=' + dept + '&page=2'
console.log('\n手動拼：', bad, '→ dept =', new URL(bad, u).searchParams.get('dept'))
const q = new URLSearchParams({ date: '2026-11-20', dept, keyword: '王 小明' })
q.set('page', 2)
console.log('URLSearchParams：', `/appointments?${q}`)
console.log('讀回來：', Object.fromEntries(new URLSearchParams(q.toString())))
console.log('空白的兩種編碼：', q.get('keyword'), '→', q.toString().match(/keyword=[^&]*/)[0], '｜ encodeURIComponent →', encodeURIComponent('王 小明'))

// 3. 模擬瀏覽紀錄：pushState、replaceState、上一頁（用病歷號搜尋，網址比較好讀）
const stack = { entries: ['/appointments'], index: 0 }
function show(action) {
  const list = stack.entries.map((e, i) => (i === stack.index ? `[${e}]` : e)).join(' ')
  console.log(action.padEnd(34), '｜', list)
}
function push(url) { stack.entries.splice(stack.index + 1, Infinity, url); stack.index++; show(`push    ${url}`) }
function replace(url) { stack.entries[stack.index] = url; show(`replace ${url}`) }
function back() { if (stack.index > 0) stack.index--; show(`back（popstate）`) }
console.log('')
for (const typed of ['A', 'A0', 'A01']) replace(`/appointments?q=${typed}`)   // 輸入中：replace，不新增紀錄
push('/appointments?q=A01&page=2')                                          // 換頁：push
push('/appointments/42')                                                     // 點進一筆
back()                                                                       // 回到第 2 頁
back()                                                                       // 回到第 1 頁
push('/appointments/57')                                                     // 從中間 push：後面的紀錄被丟掉
```

輸入搜尋字的三次 `replace` 只留下一筆紀錄；最後一次 `push` 發生在紀錄中間，原本後面的兩筆被丟掉了。

## 實際程式碼

### 路由設定

```js
// src/router/index.js
import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),   // 和 Vite 的 base 一致
  routes: [
    { path: '/appointments', component: () => import('../views/AppointmentList.vue') },
    { path: '/appointments/:id', component: () => import('../views/AppointmentDetail.vue'), props: true },
    { path: '/:pathMatch(.*)*', component: () => import('../views/NotFound.vue') },   // 前端的 404
  ],
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition   // 上一頁、下一頁：回到原本的捲動位置
    return { top: 0 }                          // 一般換頁：回到最上面
  },
})
```

最後一條路由接住所有沒對到的路徑，顯示前端自己的「找不到頁面」；沒有它，Console 會出現 `[Vue Router warn]: No match found for location with path "/appointmentz"`，畫面一片空白。

### 篩選條件放進 query

```vue
<script setup>
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

// 從網址讀條件：query 的值都是字串（或字串陣列），要自己轉型、給預設值
const filters = computed(() => ({
  date: /^\d{4}-\d{2}-\d{2}$/.test(route.query.date) ? route.query.date : today(),
  dept: typeof route.query.dept === 'string' ? route.query.dept : '',
  page: Math.max(1, Number(route.query.page) || 1),
}))

// 改日期、科別：replace，不新增紀錄；頁碼回到 1
function setFilter(patch) {
  router.replace({ query: { ...route.query, ...patch, page: undefined } })
}
// 換頁：push，使用者可以用上一頁回到前一頁
function goPage(page) {
  router.push({ query: { ...route.query, page } })
}

// 網址變了就重新載入；上一頁回來時元件重建，也從網址讀回同樣的條件
watch(filters, (f) => load(f), { immediate: true })
</script>
```

`page: undefined` 會讓 Vue Router 把這個參數從網址拿掉。`route.query.page` 是字串 `'2'`，直接和數字 `2` 用 `===` 比較永遠是 `false`。

清單資料要等 API 回來才有高度，`scrollBehavior` 回傳 `savedPosition` 時內容可能還沒畫出來，位置就還原不了。常見的處理是把清單資料快取起來（回上一頁時立刻有資料），或讓 `scrollBehavior` 回傳一個等資料載完才 resolve 的 Promise。

### 伺服器的 fallback

nginx 的寫法：找得到檔案就回檔案，找不到就回 `index.html`；`/assets/` 底下找不到的檔案直接回 404，不要回 HTML。

```nginx
location /assets/ {
    try_files $uri =404;
}
location / {
    try_files $uri $uri/ /index.html;
}
```

完整的 nginx 設定、`index.html` 與 `/assets/` 的快取規則，見後端的 [前端與 nginx 上 K8s](#/skill/spa-containers)。

## 常見錯誤與錯誤訊息

| 錯誤訊息或現象 | 原因 | 修法 |
|---|---|---|
| 重新整理 `/appointments/42` 出現伺服器的 `404 Not Found` | history 模式，伺服器沒有 SPA fallback | 伺服器對找不到的路徑回 `index.html`；不能設定時改用 hash 模式 |
| 重新整理後白畫面，Console 出現 `Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html".`（舊版 Chrome 寫 `Expected a JavaScript module script`） | JS 檔的網址錯了（常見是 `base` 設定不對），fallback 回了 `index.html` | 核對 Vite 的 `base`；`/assets/` 底下找不到的檔案回 404 而不是 HTML |
| 上一頁回來，篩選條件與頁碼回到預設 | 條件只存在元件的 ref 裡 | 寫進 `route.query`，從網址讀 |
| 搜尋框打一個字就多一筆紀錄，上一頁要按很多次 | 輸入時用了 `router.push` | 輸入中的條件用 `router.replace` |
| 網址出現 `%25E5%2585%25A7` | 已經編碼過的字串又被編碼一次 | 只在組網址的那一層編碼一次，交給 `URLSearchParams` 或 Vue Router 的 `query` 物件 |
| 科別是「耳鼻喉&頭頸」時只查到「耳鼻喉」 | 手動拼 query，`&` 沒有編碼 | 用 `URLSearchParams` 或 `query` 物件 |
| `SecurityError: Failed to execute 'pushState' on 'History': A history state object with URL '…' cannot be created in a document with origin '…'` | `pushState` 的網址和目前頁面不同源，或用 `file://` 打開頁面 | 只傳同源的路徑；外部網址用 `location.assign()` |
| `[Vue Router warn]: No match found for location with path "…"` | 網址沒有對應的路由 | 檢查路由表；加一條 `/:pathMatch(.*)*` 顯示前端的 404 |
| 換頁時整頁重新載入，Network 出現 Type 是 `document` 的請求 | 站內連結用了 `<a href>` | 改用 `<RouterLink>` 或 `router.push()` |
| 舊專案裡到處是 `router.push(…).catch(() => {})` | Vue Router 3（Vue 2）導到目前所在的網址會丟出錯誤（`Avoided redundant navigation to current location`）；Vue Router 4 起改成回傳 navigation failure，不再丟錯 | 新專案不需要這個 `catch` |

## 動手

1. 按上面示範的「在 Playground 開啟」，把 `dept` 改成含有 `#` 的字串，比較手動拼接與 `URLSearchParams` 的結果；在瀏覽紀錄的模擬裡把輸入中的 `replace` 改成 `push`，看紀錄長成什麼樣子。
2. 打開任何一個用 history 模式的 SPA，在 Console 執行 `history.length`，換幾頁再執行一次；再執行 `history.pushState({}, '', '/test')`，看網址列改了、畫面沒變，按上一頁觀察發生什麼事。
3. 在自己的專案部署後（或用任何不做 fallback 的靜態伺服器開 `dist/`），在深層的網址按重新整理，確認伺服器回的是 `index.html`；再故意開一個不存在的 `/assets/x.js`，確認回的是 404。
4. 列出清單頁所有的篩選條件，標出哪些放 query、改的時候用 push 還是 replace，再用「上一頁」與「把網址貼到另一個分頁」各驗證一次。
5. 後端的 [分頁、篩選、版本與冪等鍵](#/skill/api-patterns) 講 API 這一側的分頁與篩選參數怎麼設計，可以對照前端 query 的命名。

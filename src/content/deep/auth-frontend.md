## 從一個具體問題開始：午休回來，清單是空的

門診系統的 token 有效 8 小時。早上 8 點登入的櫃台人員，下午 4 點後畫面陸續出現奇怪的狀況：

1. 掛號清單顯示「今天沒有預約」。Network 分頁裡 `/api/appointments` 是 401：程式把所有錯誤都當成空清單。
2. 修好之後，改成「收到錯誤就導去登入頁」。一位護理師開管理頁時被導去登入，登入後又被導回管理頁，再被導去登入：她的帳號沒有管理權限，後端回的是 403。
3. 再修好之後，同事在電腦上按了登出，另一個分頁還開著病患清單，還能按「報到」，直到送出請求才被擋下。

三件事都是同一個問題：前端沒有把「沒登入」「沒權限」「已登出」分開處理。

## 運作原理

### 兩種登入方式，從前端看

伺服器那一側怎麼記住登入狀態，見 [驗證基礎：Session vs Token](#/skill/authn-basics)。前端看到的差別是：

| | cookie session | Bearer token |
|---|---|---|
| 登入後拿到什麼 | 伺服器回 `Set-Cookie`，前端程式拿不到內容（`HttpOnly`） | 回應 body 裡的 `access_token` |
| 之後的請求怎麼帶 | 瀏覽器自動帶 `Cookie` | 程式自己加 `Authorization: Bearer …` |
| 前端怎麼知道自己是誰 | 呼叫 `GET /api/me` 這類 API | token 本身（JWT 的 payload 可以解開看）或同樣呼叫 API |
| 跨網域時 | fetch 要 `credentials: 'include'`，伺服器的 CORS 要回明確的 origin 與 `Access-Control-Allow-Credentials: true` | 只要 CORS 允許 `Authorization` 標頭 |
| 要防的攻擊 | CSRF：別的網站讓瀏覽器帶著 cookie 送請求 | XSS：頁面上的惡意 script 讀走 token |

本站的後端參考專案用 Bearer token：`POST /api/auth/login` 回 `{ access_token, token_type: "Bearer", expires_in }`，沒帶或過期時回 `401` 並附 `WWW-Authenticate: Bearer`。

### token 放哪裡

| 位置 | 重新整理後 | 其他分頁 | 頁面上的 script 讀得到 |
|---|---|---|---|
| 記憶體（store 裡的 ref） | 消失 | 各自一份 | 讀得到，但只有在頁面開著的當下 |
| sessionStorage | 還在 | 不共享，每個分頁各自一份 | 讀得到 |
| localStorage | 還在 | 共享 | 讀得到，XSS 可以把它帶走，之後在別處繼續用到過期 |
| `HttpOnly` cookie | 還在 | 共享 | 讀不到 |

沒有哪一種同時滿足「重新整理還在」與「XSS 讀不走」。常見的組合是 access token 放記憶體、壽命短，refresh token 放 `HttpOnly` cookie，重新整理時用 cookie 換一個新的 access token。只有 access token 的系統（例如本站的參考專案），放記憶體就代表重新整理要重新登入；要不要接受這個代價，寫在需求裡。XSS 本身怎麼防，見 [XSS、CSRF 與安全標頭](#/skill/xss-csrf)。

### 401、403 與畫面

```
API 回應
  ├─ 2xx  → 照常顯示
  ├─ 401  → 清掉登入狀態 → 導向 /login?redirect=<原本的網址>
  │                         登入成功 → 導回 redirect（只接受站內路徑）
  ├─ 403  → 顯示「沒有權限」，登入狀態不動
  └─ 其他 → 依錯誤分類處理（見「錯誤分類與重試」）
```

401 的意思是「我不知道你是誰」，重新登入可以解決；403 的意思是「我知道你是誰，你不能做這件事」，重新登入結果一樣。把 403 也導去登入，就是開頭第 2 個問題的迴圈。

### 路由守衛只管畫面

`router.beforeEach` 在每次換頁前執行。回傳 `false` 取消這次導航、回傳一個路由位置就改去那裡、不回傳（`undefined`）或回傳 `true` 照常進入。Vue Router 5.5 的型別把第三個參數 `next` 標為 deprecated，新寫法一律用回傳值。

守衛讀的是前端的登入狀態，它能做的是「沒登入就不顯示這個畫面」。使用者打開 DevTools 改掉 store 的值、或直接用 `curl` 打 API，守衛都擋不住；資料能不能拿，由後端對每個請求檢查。所以守衛與 API 的 401 處理兩者都要有：守衛讓沒登入的人一開始就看到登入頁，401 處理則接住「進了頁面之後才過期」的情況。

### redirect 與開放轉址

`/login?redirect=/appointments/42` 讓使用者登入後回到原本的頁面。如果程式直接 `location.href = redirect`，攻擊者可以寄出 `https://clinic.example/login?redirect=https://evil.example/login`：使用者在 `clinic.example` 登入，接著被送到長得一樣的假網站「再登入一次」。只接受 `/` 開頭、而且不是 `//` 開頭的路徑（`//evil.example` 會被當成另一個網域），解析後確認還在同一個 origin。

### token 過期與更新

有 refresh token 的系統，access token 過期時可以換一個新的。頁面打開時常常同時發出好幾個請求，它們會同時收到 401：

- 各自去更新：送出好幾次 refresh。refresh token 每用一次就輪替成新的（refresh token rotation）時，只有第一次成功，其他幾次拿已經失效的舊 refresh token，全部失敗，使用者被登出。
- 共用一次更新：第一個收到 401 的請求開始更新，把這個 Promise 存起來；其他請求看到已經有更新在進行，就等同一個 Promise，完成後各自重送一次。

重送只做一次：更新後的 token 還是 401，就代表要重新登入，不要再更新，否則會無限循環。

### 登出要清的東西

| 項目 | 不清的後果 |
|---|---|
| store 裡的使用者資料、清單、快取的查詢結果 | 下一個登入的人看到上一個人的資料 |
| 進行中的請求 | 登出後回應才回來，又把資料寫回 store |
| SSE、WebSocket、輪詢 | 登出後還在接收病患資料 |
| 其他分頁 | 另一個分頁還能看、還能按按鈕 |
| 存在 sessionStorage、localStorage 的 token 與草稿 | 下一個人重新整理後自動登入成上一個人 |

Pinia 的 setup store（`defineStore('auth', () => { … })`）沒有內建 `$reset()`。開發模式呼叫時會丟出錯誤 `Store "auth" is built using the setup syntax and does not implement $reset().`，正式建置裡則什麼都不做、也不報錯。每個 setup store 要自己寫一個 `$reset`。

通知其他分頁用 `BroadcastChannel`（2022 年 3 月進入 Baseline）：同一個 origin 的分頁開同名的 channel，一個分頁 `postMessage`，其他分頁收到 `message` 事件。token 放在 localStorage 時，也可以監聽 `storage` 事件，它只在「其他分頁」改了 localStorage 時觸發。

登出時如果用 `location.assign('/login')` 整頁離開，按上一頁時瀏覽器可能從往返快取（bfcache）把整個舊頁面連同記憶體裡的資料一起還原。在 `pageshow` 事件裡 `event.persisted` 為 `true` 時重新檢查登入狀態，或者登出時留在 SPA 裡用 `router.replace` 換頁，讓守衛接手。

## 實際程式

### 檢查 redirect、共用一次更新

兩段邏輯都是純函式，可以直接執行。第一段把各種 `redirect` 丟給檢查函式；第二段模擬三個請求同時拿到 401，比較「各自更新」與「共用一次更新」在 refresh token 輪替時的結果：

```js run
// 1) redirect 只接受同一個 origin 的路徑
const ORIGIN = 'https://clinic.example'
function safeRedirect(raw, fallback = '/') {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback
  try {
    const u = new URL(raw, ORIGIN)
    if (u.origin !== ORIGIN || u.pathname.startsWith('/login')) return fallback   // 也不導回登入頁自己
    return u.pathname + u.search + u.hash
  } catch {
    return fallback
  }
}
for (const r of ['/appointments/42?tab=notes', 'https://evil.example/login', '//evil.example', '/\\evil.example', 'javascript:alert(1)', ['/a', '/b'], '/login?redirect=/x']) {
  console.log(JSON.stringify(r).padEnd(30), '→', safeRedirect(r))
}

// 2) 三個請求同時 401：各自更新 vs 共用一次更新（refresh token 用過一次就失效）
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))
function makeServer() {
  let access = 'A1', refresh = 'R1', n = 1
  return {
    async api(token) { await sleep(20); return token === access ? 200 : 401 },
    async refresh(rt) {
      await sleep(50)
      if (rt !== refresh) return null                // 舊的 refresh token：拒絕
      n++; access = 'A' + n; refresh = 'R' + n         // 輪替
      return { access, refresh }
    },
  }
}
async function run(shared) {
  const server = makeServer()
  const client = { access: 'expired', refresh: 'R1' }
  let calls = 0, inflight = null
  async function doRefresh() {
    calls++
    const r = await server.refresh(client.refresh)
    if (!r) throw new Error('更新失敗，要重新登入')
    Object.assign(client, r)
  }
  const ensureFresh = shared ? () => (inflight ??= doRefresh().finally(() => { inflight = null })) : doRefresh
  async function request(name) {
    let status = await server.api(client.access)
    if (status === 401) {
      try { await ensureFresh() } catch (e) { return `${name}：${e.message}` }
      status = await server.api(client.access)      // 只重送一次
    }
    return `${name}：${status}`
  }
  const results = await Promise.all(['今日清單', '診間統計', '通知'].map(request))
  console.log(`\n${shared ? '共用一次更新' : '各自更新'}（refresh 送了 ${calls} 次）`)
  for (const r of results) console.log('  ' + r)
}
await run(false)
await run(true)
```

### auth store 與 apiFetch

```js
// stores/auth.js：setup store，自己寫 $reset
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(null)                  // 只放記憶體
  const role = ref(null)                   // 登入後由 GET /api/me 取得（假設後端提供）
  const isLoggedIn = computed(() => token.value !== null)

  async function login(username, password) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) throw Object.assign(new Error('登入失敗'), { status: res.status })
    token.value = (await res.json()).access_token
  }
  function $reset() { token.value = null; role.value = null }
  return { token, role, isLoggedIn, login, $reset }
})
```

```js
// api.js：所有 API 都經過這裡
import { useAuthStore } from '@/stores/auth'
import { router } from '@/router'

export class ApiError extends Error {
  constructor(status, problem) { super(problem?.title ?? `HTTP ${status}`); this.status = status; this.problem = problem }
}

export async function apiFetch(path, options = {}) {
  const auth = useAuthStore()
  const headers = new Headers(options.headers)
  if (auth.token) headers.set('Authorization', `Bearer ${auth.token}`)   // 注意 "Bearer " 後面的空白
  const res = await fetch(`/api${path}`, { ...options, headers })
  if (res.status === 401) {
    auth.$reset()
    const here = router.currentRoute.value
    if (here.name !== 'login') router.push({ name: 'login', query: { redirect: here.fullPath } })
    throw new ApiError(401)
  }
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null))   // 403 由畫面顯示「沒有權限」
  return res.status === 204 ? null : res.json()
}
```

### 路由守衛與登入頁

```js
// router.js
const routes = [
  { path: '/login', name: 'login', component: () => import('./views/LoginView.vue') },
  { path: '/forbidden', name: 'forbidden', component: () => import('./views/ForbiddenView.vue') },
  { path: '/appointments', name: 'appointments', component: () => import('./views/AppointmentsView.vue'), meta: { requiresAuth: true } },
  { path: '/admin', name: 'admin', component: () => import('./views/AdminView.vue'), meta: { requiresAuth: true, roles: ['admin'] } },
]

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta.requiresAuth && !auth.isLoggedIn) {
    return { name: 'login', query: { redirect: to.fullPath } }       // 沒登入：去登入，記下原本要去哪
  }
  if (to.meta.roles && !to.meta.roles.includes(auth.role)) {
    return { name: 'forbidden' }                                       // 登入了但角色不符：不是去登入
  }
})
```

```js
// LoginView.vue 的 <script setup> 節錄
const route = useRoute()
const router = useRouter()
async function onSubmit() {
  await auth.login(username.value, password.value)
  router.replace(safeRedirect(route.query.redirect))   // replace：登入頁不留在瀏覽紀錄裡
}
```

登入頁本身不能設 `requiresAuth`；守衛把 `/login` 也導去 `/login` 時，Vue Router 會在 Console 警告 `Detected a possibly infinite redirection in a navigation guard when going from "/" to "/login". Aborting to avoid a Stack Overflow.`。

:::stop 讀到這裡可以先停：會分開處理 401 與 403、檢查 `redirect`、讓同時過期的請求共用一次更新，並用路由守衛管畫面。後面的登出與跨分頁同步，在做登出或共用電腦的情境時再回來讀。

### 登出與其他分頁

```js
// logout.js
const channel = new BroadcastChannel('auth')

export function logout({ broadcast = true } = {}) {
  abortAllRequests()                 // apiFetch 共用的 AbortController（自己實作）
  closeRealtime()                    // 關掉 SSE、WebSocket、輪詢
  for (const store of [useAuthStore(), useAppointmentStore(), usePatientStore()]) store.$reset()
  sessionStorage.clear()             // 這個分頁的草稿與暫存
  if (broadcast) channel.postMessage({ type: 'logout' })
  router.replace({ name: 'login' })  // 留在 SPA 裡換頁，守衛接手
}

channel.onmessage = (e) => {
  if (e.data?.type === 'logout') logout({ broadcast: false })   // 收到別的分頁登出：自己也登出，不再廣播
}

window.addEventListener('pageshow', (e) => {
  if (e.persisted && !useAuthStore().isLoggedIn) router.replace({ name: 'login' })   // 從 bfcache 還原時重新檢查
})
```

## 常見錯誤與錯誤訊息

| 現象或訊息 | 原因 | 修法 |
|---|---|---|
| 登入後第一個請求就 401 | 少了 `Bearer ` 前綴，或 token 還沒存進 store 就送出請求 | Network 分頁看 Request Headers 的 `Authorization` |
| `Access to fetch at '…' from origin '…' has been blocked by CORS policy: The value of the 'Access-Control-Allow-Origin' header in the response must not be the wildcard '*' when the request's credentials mode is 'include'.` | 跨網域帶 cookie，但伺服器回 `*` | 伺服器回明確的 origin 與 `Access-Control-Allow-Credentials: true`，見 [CORS、Cookie 與同源](#/skill/cors-cookies) |
| 跨網域時 cookie 沒帶上 | fetch 沒設 `credentials: 'include'`，或 cookie 的 `SameSite` 不允許 | 前端加 `credentials`，cookie 屬性由後端設定 |
| 登入後又被導回登入頁，來回不停 | 把 403 當成 401 | 403 顯示沒有權限，不清登入狀態 |
| `Detected a possibly infinite redirection in a navigation guard…` | 登入頁也被設成要登入 | 登入頁不設 `requiresAuth` |
| `The "next" callback was called more than once in one navigation guard…` | 舊寫法的 `next()` 在不同分支各呼叫了一次 | 改成回傳值，不用 `next` |
| 登出後下一個人看到上一個人的資料 | setup store 的 `$reset()` 沒寫，正式環境呼叫了也不會報錯 | 每個 setup store 自己寫 `$reset` |
| 一次過期，使用者被登出好幾次或所有請求都失敗 | 每個 401 各自更新 token，refresh token 輪替後只有第一次成功 | 共用一個更新中的 Promise |
| 登入後被導到別的網站 | `redirect` 沒檢查 | 只接受同一個 origin 的路徑 |

## 動手

1. 按上面程式的「在 Playground 開啟」，在 `safeRedirect` 的測試清單加上 `'/appointments#/../../evil'` 與 `'https://clinic.example/appointments'`（完整網址但同一個 origin），看結果是否符合預期；再把 `run(true)` 的 `inflight ??=` 改成每次都呼叫 `doRefresh()`，觀察 refresh 次數。
2. 在自己的專案用 Application 分頁清掉 token（或在 Console 把 store 的 token 設成過期的值），操作一個需要登入的頁面，確認導向登入、登入後回到原頁。
3. 開兩個分頁，在其中一個登出，另一個分頁要在下一次操作前就回到登入頁；Vue DevTools 的 Pinia 分頁確認 store 已清空。
4. 伺服器那一側的 token 驗證與撤銷，見 [JWT 解剖](#/skill/jwt) 與 [OAuth 2.0 與 OpenID Connect](#/skill/oauth-oidc)。

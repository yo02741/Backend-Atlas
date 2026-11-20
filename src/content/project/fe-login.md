## 這階段要做出什麼

前端的第一個畫面是登入。這一階段做出三樣東西，之後每個階段都建立在它們上面：

1. **登入頁** `/login`：帳號、密碼、送出鈕。送出中按鈕停用，401 與 422 各有各的訊息，網路斷掉時也有提示。
2. **登入狀態**：一個 Pinia 的 setup store 存 token，所有 API 都經過同一個 `apiFetch` 帶上 `Authorization: Bearer <token>`。
3. **換頁規則**：沒登入就導去登入頁並記下原本要去哪；登入成功回到原本的頁面；API 回 401（token 過期）時清掉登入狀態、回登入頁；403 留在原頁顯示沒有權限。

後端參考專案（`companion/clinic-api`）與沙箱裡的假 API 照同一份契約（`companion/clinic-api/docs/contract.md`），路徑都在 `/api` 底下：

| 請求 | 成功 | 失敗 |
|---|---|---|
| `POST /api/auth/login`，body `{ username, password }` | 200 `{ access_token, token_type: "Bearer", expires_in }` | 401：帳號或密碼錯誤；422：欄位格式錯誤 |
| 其他 `/api/…`，帶 `Authorization: Bearer …` | 依各介面 | 401 並附 `WWW-Authenticate: Bearer`：沒帶 token 或 token 失效 |

錯誤 body 是 Problem Details（`type`、`title`、`status`、`detail`）。`title` 是給開發者看的英文（`Unauthorized`），畫面要顯示的是 `detail` 或依 `type` 對應的中文。欄位錯誤放在 `errors`，格式是 `{ 欄位: ['訊息'] }`。這個欄位不在 RFC 9457 的標準裡，各家寫法不同，第 3 階段會寫一個連其他寫法也收的轉換函式。

表單綁定與驗證時機在 [表單綁定與驗證](#/skill/forms)；送出之後的狀態碼怎麼對回畫面在 [表單送出與驗證錯誤](#/skill/form-submit)；token 放哪裡、401 與 403 的分工、路由守衛在 [登入狀態與 401](#/skill/auth-frontend)。

## 設計決策與取捨

### token 放記憶體

| 位置 | 重新整理後 | 頁面上的惡意 script 讀得到 |
|---|---|---|
| Pinia store（記憶體） | 消失，要重新登入 | 頁面開著的當下讀得到 |
| `sessionStorage`、`localStorage` | 還在 | 讀得到，可以帶走之後在別處用到過期 |
| `HttpOnly` cookie | 還在 | 讀不到 |

參考專案只發 access token、沒有 refresh token，所以這裡選記憶體：代價是重新整理或開新分頁都要重新登入。櫃台的電腦一整天開著同一個分頁，這個代價可以接受，寫進需求讓大家知道。要「重新整理還在」又不想讓 script 讀到，就要後端改成 `HttpOnly` cookie 的 session，或加上用 cookie 換 access token 的 refresh 流程，這是後端的決定（見 [驗證基礎：Session vs Token](#/skill/authn-basics)）。

### 401 與 403 分開

401 的意思是「不知道你是誰」，重新登入可以解決；403 是「知道你是誰，但你不能做這件事」，重新登入結果一樣。兩者在 `apiFetch` 分開：401 清掉 store、導去 `/login?redirect=<原本的網址>&expired=1`；403 照一般錯誤丟出，由畫面顯示「沒有權限」。把 403 也導去登入，使用者會在登入頁與原頁之間來回。

登入請求本身不走 `apiFetch`：它的 401 代表帳號或密碼錯誤，不能變成「登入已過期」再導一次登入頁。

### 送出中、401、422 的畫面

| 狀況 | 畫面 | 焦點 |
|---|---|---|
| 送出中 | 按鈕 `disabled`、文字「登入中…」；處理函式開頭再擋一次 | 不動 |
| 401 | 表單上方 `role="alert"` 顯示 `detail`；清空密碼、保留帳號 | 不動 |
| 422 | 訊息放在欄位下方，欄位加 `aria-invalid` 與 `aria-describedby` | 第一個出錯的欄位 |
| 網路錯誤 | 上方顯示「無法連線，請稍後再試」 | 不動 |

按鈕停用之前的同一個瞬間可能已經進來第二次送出（連點、Enter），所以處理函式開頭的 `if (submitting.value) return` 不能省。`finally` 恢復按鈕，網路錯誤丟出例外時也一樣。

兩個欄位都加 `required`，空白時瀏覽器擋下送出、把焦點移到空白的欄位，請求不會送出去。帳號欄位加 `autocomplete="username"`、`spellcheck="false"`、`autocapitalize="none"`，密碼加 `autocomplete="current-password"`，瀏覽器與密碼管理工具才認得出這是登入表單。

### redirect 只接受站內路徑

`/login?redirect=…` 的值來自網址，任何人都能改。直接 `location.href = redirect` 會變成開放轉址：攻擊者寄出 `…/login?redirect=https://evil.example/login`，使用者登入後被送到假網站。`safeRedirect` 只接受 `/` 開頭、不是 `//` 開頭、解析後還在同一個 origin 的路徑，也不導回登入頁自己。登入成功用 `router.replace`，登入頁不留在瀏覽紀錄裡，按上一頁不會回到登入頁。

## 關鍵程式

登入狀態。setup store 沒有內建 `$reset()`，自己寫一個，登出與 401 都呼叫它：

```js
// src/stores/auth.js：登入狀態。token 只放在記憶體，重新整理就要重新登入
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(null)
  const username = ref('')
  const isLoggedIn = computed(() => token.value !== null)

  function signIn(accessToken, name) {
    token.value = accessToken
    username.value = name
  }
  // setup store 沒有內建 $reset()，自己寫
  function $reset() {
    token.value = null
    username.value = ''
  }
  return { token, username, isLoggedIn, signIn, $reset }
})
```

所有 API 都經過這裡。第 7 階段會把 `/api` 換成執行時設定的 `apiBase`：

```js
// src/api/client.js：所有 API 都經過 apiFetch
import { useAuthStore } from '@/stores/auth'
import { router } from '@/router'

export class ApiError extends Error {
  constructor(status, problem = null) {
    super(problem?.title ?? `HTTP ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.problem = problem          // Problem Details：type、title、status、detail、errors
  }
}

export async function apiFetch(path, { method = 'GET', body, headers, signal } = {}) {
  const auth = useAuthStore()
  const h = new Headers(headers)
  if (auth.token) h.set('Authorization', `Bearer ${auth.token}`)
  if (body !== undefined) h.set('Content-Type', 'application/json')
  const res = await fetch(`/api${path}`, { method, headers: h, signal, body: body === undefined ? undefined : JSON.stringify(body) })

  if (res.status === 401) {
    auth.$reset()
    const here = router.currentRoute.value
    if (here.name !== 'login') router.replace({ name: 'login', query: { redirect: here.fullPath, expired: '1' } })
    throw new ApiError(401)
  }
  const isJson = (res.headers.get('Content-Type') || '').includes('json')
  if (!res.ok) throw new ApiError(res.status, isJson ? await res.json() : null)   // 403 由畫面顯示「沒有權限」
  if (res.status === 204) return null
  if (!isJson) throw new ApiError(res.status, { title: '回應不是預期的格式' })   // 例如 proxy 回了 HTML
  return res.json()
}
```

```js
// src/lib/safeRedirect.js：redirect 只接受同一個網站裡的路徑
export function safeRedirect(raw, fallback = '/sessions') {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback
  try {
    const base = new URL(location.origin)
    const u = new URL(raw, base)
    if (u.origin !== base.origin || u.pathname.startsWith('/login')) return fallback
    return u.pathname + u.search + u.hash
  } catch {
    return fallback
  }
}
```

路由表與守衛。整個專案的路由一次列出來，後面的階段各自補上頁面元件：

```js
// src/router.js
import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const routes = [
  { path: '/', redirect: '/sessions' },
  { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { title: '登入' } },
  { path: '/sessions', name: 'sessions', component: () => import('@/views/SessionsView.vue'), meta: { requiresAuth: true, title: '診次清單' } },
  { path: '/sessions/:id/book', name: 'book', component: () => import('@/views/BookingView.vue'), props: true, meta: { requiresAuth: true, title: '掛號' } },
  { path: '/appointments', name: 'appointments', component: () => import('@/views/MyAppointmentsView.vue'), meta: { requiresAuth: true, title: '我的掛號' } },
  { path: '/board', name: 'board', component: () => import('@/views/BoardView.vue'), meta: { title: '報到看板' } },
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),   // 第 7 階段：和 Vite 的 base 同一個前綴
  routes,
})

// 沒登入就去登入頁，記下原本要去哪；登入頁自己不設 requiresAuth，否則會無限導向
router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta.requiresAuth && !auth.isLoggedIn) return { name: 'login', query: { redirect: to.fullPath } }
})
```

登入頁：

```vue
<script setup>
import { ref, reactive, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { safeRedirect } from '@/lib/safeRedirect'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const FIELDS = ['username', 'password']        // 表單上的順序
const form = reactive({ username: '', password: '' })
const fieldErrors = ref({})                    // { password: '密碼至少 8 個字' }
const formError = ref('')
const submitting = ref(false)

async function onSubmit() {
  if (submitting.value) return                 // 送出中再送一次：不理
  submitting.value = true
  fieldErrors.value = {}
  formError.value = ''
  try {
    // 登入請求不走 apiFetch：它的 401 是「帳號或密碼錯誤」，不是「登入過期」
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      auth.signIn(data.access_token, form.username)
      return router.replace(safeRedirect(route.query.redirect))   // replace：登入頁不留在瀏覽紀錄裡
    }
    if (res.status === 422) {
      const errors = data.errors ?? {}
      fieldErrors.value = Object.fromEntries(FIELDS.filter((k) => errors[k]).map((k) => [k, [].concat(errors[k])[0]]))
      await nextTick()
      document.getElementById(FIELDS.find((k) => fieldErrors.value[k]))?.focus()
    } else if (res.status === 401) {
      formError.value = data.detail ?? '帳號或密碼錯誤'
      form.password = ''
    } else {
      formError.value = '系統暫時無法處理，請稍後再試'
    }
  } catch {
    formError.value = '無法連線，請稍後再試'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="login">
    <h1 tabindex="-1">門診系統登入</h1>
    <p v-if="route.query.expired" role="status">登入已過期，請重新登入</p>
    <form @submit.prevent="onSubmit">
      <p v-if="formError" role="alert" class="form-error">{{ formError }}</p>

      <label for="username">帳號</label>
      <input id="username" v-model.trim="form.username" name="username" autocomplete="username"
             required spellcheck="false" autocapitalize="none"
             :aria-invalid="fieldErrors.username ? 'true' : undefined"
             :aria-describedby="fieldErrors.username ? 'username-error' : undefined">
      <p v-if="fieldErrors.username" id="username-error" class="field-error">{{ fieldErrors.username }}</p>

      <label for="password">密碼</label>
      <input id="password" v-model="form.password" name="password" type="password"
             autocomplete="current-password" required
             :aria-invalid="fieldErrors.password ? 'true' : undefined"
             :aria-describedby="fieldErrors.password ? 'password-error' : undefined">
      <p v-if="fieldErrors.password" id="password-error" class="field-error">{{ fieldErrors.password }}</p>

      <button type="submit" :disabled="submitting">{{ submitting ? '登入中…' : '登入' }}</button>
    </form>
  </main>
</template>
```

這段程式在 Chromium 裡實際跑過：SFC 用 `vue/compiler-sfc` 編譯，搭配 Vue 3.5.45、Vue Router 5.5.1、Pinia 4.1.0 與站上沙箱的假 API，驗過守衛導向、401 清空密碼、登入後回到 redirect、token 失效後回登入頁並帶 `expired=1`。

## 常見錯誤

**把 `title` 顯示給使用者。** 畫面出現「Unauthorized」「Unprocessable Content」。`title` 是給開發者看的，使用者看 `detail` 或依 `type` 對應的中文。

**token 存進 `localStorage`。** 頁面上任何一段 script（被注入的、第三方的）都讀得到，帶走之後可以一直用到過期。沒有 refresh 流程時放記憶體，接受重新整理要重新登入。

**403 也導去登入頁。** 沒有權限的帳號登入後又被導回登入頁，來回不停。只有 401 清登入狀態。

**登入頁也設了 `requiresAuth`。** 守衛把 `/login` 導去 `/login`，Vue Router 在 Console 警告 `Detected a possibly infinite redirection in a navigation guard`。

**`Authorization` 少了 `Bearer ` 的空白。** 登入後第一個請求就 401。Network 分頁點開請求，看 Request Headers 的 `Authorization`。

**送出中沒有擋第二次。** 網路慢時連按兩下送出兩個登入請求；第二個回來時也許已經換了頁。按鈕 `disabled` 加上處理函式開頭的檢查。

**redirect 沒檢查。** `router.replace(route.query.redirect)` 遇到 `//evil.example` 會被當成另一個網域。用 `safeRedirect`。

## 驗收題在測什麼

沙箱裡只有 `vue`，題目把元件寫成物件、模板寫成字串，換頁用一個 `route` ref 加 `go(name, query)` 代替 Vue Router，`localStorage` 是沙箱提供的記憶體替身。

**登入表單**：送出中按鈕停用並顯示「登入中…」；送出中再送一次只有一個 POST；401 顯示 `detail`、清空密碼、保留帳號；422 的訊息放在欄位下方，`aria-invalid` 與 `aria-describedby` 指向訊息，焦點移到出錯的欄位，上方不出現 alert；兩個欄位都是 `required`，空白時不送出；網路錯誤顯示「無法連線」並恢復按鈕。

**token 與換頁**：假 API 設了 `api.auth = true`，診次與我的掛號沒帶 Bearer token 就回 401。登入後換到診次頁並列出資料；`localStorage`、`sessionStorage` 裡沒有任何東西；我的掛號頁收到 401 時回到登入頁、顯示「登入已過期」，重新登入後回到我的掛號；403 留在原頁顯示「沒有權限查看這個頁面」，換到別頁時 token 還能用；登出後不帶 token 的請求回 401。

redirect 在題目裡只是頁面名稱的白名單，網址形式的 `safeRedirect` 在上面的程式裡。下一階段做第一個需要登入的清單：診次清單的四種狀態，與放在網址上的篩選條件。

## 串接驗收

前端的串接驗收接在後端參考專案上（`companion/clinic-api`，照它的 README 啟動並 seed；密碼是 seed 時給的 `SEED_PASSWORD`）。參考專案的業務介面一樣在 `/api` 底下，Vite 的 proxy 原樣轉送、不改寫路徑：

```js
// vite.config.js 的 server
proxy: { '/api': 'http://127.0.0.1:8000' },
```

五個畫面已經接好的版本在 `companion/clinic-web/`，對照用；它的接線測試走一遍「登入 → 掛號 → 看板更新」，中途停掉後端一次。

**1. 接上真的後端。** 用 `patient1` 登入一次、用錯的密碼登入一次。預期：Network 裡 `POST /api/auth/login` 先回 200，body 有 `access_token`、`token_type` 是 `Bearer`；錯的密碼回 401，畫面顯示 `detail`、密碼清空、帳號保留。DevTools 的 Application 面板裡 Local Storage 與 Session Storage 都是空的。

**2. 深層網址。** 沒登入時直接打開 `http://localhost:5173/sessions?date=<seed 印出的日期>&doctor_id=1`（設了 `base` 時網址前面多一段 `/clinic`），先預測網址怎麼變。預期：先到 `/login?redirect=…`，登入後回到原本的網址、query 還在，按上一頁不會回到登入頁。再打開 `/login?redirect=//evil.example/` 登入，預期停在 `/sessions`。

**3. 登出後不留上一個人的資料。** `patient1` 先掛一筆，打開「我的掛號」，登出；在 DevTools 把網路節流調慢（例如 3G），換 `patient2` 登入再打開「我的掛號」，盯著第一個畫面。預期：第一個畫面是載入中，不會先閃出 `patient1` 的清單。閃出來的話，找出登出時沒清掉的 store 或模組層級的變數；登出與 401 都要清。

**4. token 過期。** 參考專案的 token 預設 15 分鐘。在本機的 `compose.yaml` 替 api 加 `TOKEN_TTL_SECONDS: "60"`，`docker compose up -d` 之後登入，等一分鐘再換到「我的掛號」。預期：回到登入頁並顯示「登入已過期」，重新登入後回到我的掛號。下一階段的診次清單沿用這組接線。

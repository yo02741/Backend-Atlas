## 從一個具體問題開始：重新整理就 404，換病人資料沒變

門診系統改用 Vue Router 之後，測試回報三件事：

1. 在 `https://clinic.example/patients/7` 按重新整理，出現伺服器的「404 Not Found」頁面；從首頁點進去卻正常。
2. 病人頁右側有「下一位病人」的連結，點了之後網址變成 `/patients/8`，畫面上還是 7 號病人的姓名與病歷。
3. 沒登入的人打開 `/appointments`，瀏覽器卡住一下，Console 出現一大段紅字，最後停在空白頁。

第一個是伺服器沒有替 history 模式設定 fallback；第二個是同一個元件被重用，`onMounted` 不會再跑；第三個是登入守衛把 `/login` 也導向 `/login`，形成迴圈。

## 運作原理

### 網址怎麼對到元件

```ts
const routes = [
  { path: '/login', component: LoginPage },
  { path: '/appointments', component: () => import('./pages/AppointmentsPage.vue') },
  {
    path: '/patients/:id',
    component: () => import('./pages/PatientPage.vue'),
    props: true,                                        // params.id 變成 PatientPage 的 prop
    children: [
      { path: '', redirect: { name: 'patient-history' } },
      { path: 'history', name: 'patient-history', component: () => import('./pages/PatientHistory.vue') },
      { path: 'prescriptions', component: () => import('./pages/PatientPrescriptions.vue') },
    ],
  },
  { path: '/:pathMatch(.*)*', component: () => import('./pages/NotFound.vue') },   // 其他都對不到時
]
```

`/patients/7/history` 的對應過程：

```
App.vue          <RouterView>          ← 第一層：PatientPage
PatientPage.vue  病人姓名、分頁列
                 <RouterView>          ← 第二層：PatientHistory
```

每一層 `<RouterView>` 顯示這一層對到的元件。切到 `/patients/7/prescriptions` 時，只有第二層換掉，`PatientPage` 的外框與分頁列不重建。

### params、query、hash

| 網址 `/patients/7/history?from=2026-01&sort=desc#allergy` | 讀法 | 型別 |
|---|---|---|
| `7` | `route.params.id` | 字串 |
| `from=2026-01&sort=desc` | `route.query.from`、`route.query.sort` | 字串（同名出現兩次時是陣列） |
| `#allergy` | `route.hash` | 字串，含 `#` |

用法的分工：辨識「是哪一個東西」的放 params（病人 id）；篩選、排序、頁碼放 query；頁內位置放 hash。三者都在網址裡，重新整理、上一頁、分享連結都會保留。`useRoute()` 回傳的物件會跟著導航更新，但解構會斷：`const { params } = useRoute()` 拿到的是當下那個物件，換頁後不會變（Vue Router 5.5 實測：解構的 `params.id` 停在 `7`，`route.params.id` 已經是 `8`）。

### 一次導航的順序

Vue Router 文件列出的流程（節錄前 11 步）：

1. 觸發導航（點 `<RouterLink>`、`router.push`、瀏覽器上一頁）。
2. 要離開的元件的 `onBeforeRouteLeave`。
3. 全域的 `router.beforeEach`。
4. 被重用的元件的 `onBeforeRouteUpdate`。
5. 路由設定裡的 `beforeEnter`。
6. 下載懶載入的元件。
7. 要進入的元件的 `beforeRouteEnter`（只有 Options API 有）。
8. 全域的 `router.beforeResolve`。
9. 確認導航。
10. 全域的 `router.afterEach`。
11. 更新 DOM。

守衛的回傳值決定去向：

| 回傳 | 結果 |
|---|---|
| 不回傳、`undefined`、`true` | 放行，繼續下一個守衛 |
| `false` | 取消這次導航，留在原頁 |
| 位置（`'/login'` 或 `{ name: 'login', query: {…} }`） | 取消這次，改導向那裡（會重新跑一次守衛） |
| 丟出錯誤 | 取消，錯誤交給 `router.onError` |

舊寫法的第三個參數 `next` 在 Vue Router 5.0.3 起被標為棄用，開發模式只要呼叫就會警告。宣告了 `next` 參數卻沒有在每條路徑都呼叫它，導航會卡住，所以直接刪掉參數、改用回傳值。

導向的位置也會再經過一次 `beforeEach`。守衛對 `/login` 也回傳 `/login`，就變成無窮導向，Vue Router 偵測到後中止並警告 `Detected a possibly infinite redirection in a navigation guard when going from "/" to "/login". Aborting to avoid a Stack Overflow.`。

### 同一個元件被重用

從 `/patients/7` 到 `/patients/8`，兩個網址對到同一個元件，Vue Router 沿用原本的元件實例，只更新 params。這比較快，代價是 `setup` 與 `onMounted` 不會再執行。只在 `onMounted` 抓資料的頁面，換參數後就停在舊資料。處理方式：

- `watch(() => route.params.id, load, { immediate: true })`，或搭配 `props: true` 寫成 `watch(() => props.id, …)`。
- `onBeforeRouteUpdate((to) => load(to.params.id))`：在導航確認前執行，可以回傳 `false` 取消。
- 在 `<RouterView :key="$route.fullPath" />` 加 `key` 強迫每次重建，最簡單但最浪費，元件裡的狀態全部歸零。

### history 模式與伺服器

| | `createWebHistory()` | `createWebHashHistory()` |
|---|---|---|
| 網址 | `https://clinic.example/patients/7` | `https://clinic.example/#/patients/7` |
| 重新整理時送給伺服器的路徑 | `/patients/7` | `/`（`#` 後面不會送出） |
| 伺服器要做的事 | 對找不到的路徑回 `index.html` | 不用設定 |

`createWebHistory()` 的網址比較乾淨，但重新整理或直接打開深層網址時，請求會送到伺服器。伺服器上沒有 `patients/7` 這個檔，就回 404。nginx 的寫法是 `try_files $uri $uri/ /index.html;`，其他伺服器在 Vue Router 文件的 history 模式頁都有範例。改成一律回 `index.html` 之後，伺服器不再回 404，所以前端要自己有 `/:pathMatch(.*)*` 的 404 頁。部署細節見 [SPA 與 nginx 上 K8s](#/skill/spa-containers)。

### 懶載入

`component: () => import('./pages/ReportPage.vue')` 讓 Vite 把這一頁拆成獨立的 chunk，第一次進入這頁才下載。首頁與登入頁通常直接 import，讓第一個畫面不用多等一次下載；其他頁面懶載入。部署新版本後，使用者手上的舊頁面可能去要一個已經不存在的 chunk，這屬於建置與部署的範圍。

### Vue Router 5

Vue Router 5.0（2026-01）把原本獨立的 unplugin-vue-router 併進套件：用 `vue-router/vite` 外掛，依 `src/pages` 的檔案結構自動產生 routes（`vue-router/auto-routes`）。官方的升級說明寫明，沒有用 unplugin-vue-router 的專案從 4 升到 5 沒有破壞性變更，本課的手寫 routes 在兩個版本都適用。開發模式的警告格式在 5.5 改成帶代碼，例如 `[VUE_ROUTER_R0004] No match found for location with path "/nope"`；4.x 是 `[Vue Router warn]: No match found…`。

## 實際程式：路由、守衛與病人頁

```ts
// src/router.ts
import { createRouter, createWebHistory } from 'vue-router'
import { useSessionStore } from './stores/session'
import LoginPage from './pages/LoginPage.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/appointments' },
    { path: '/login', name: 'login', component: LoginPage },
    { path: '/appointments', component: () => import('./pages/AppointmentsPage.vue'), meta: { requiresAuth: true } },
    {
      path: '/patients/:id(\\d+)',                     // 只接受數字
      component: () => import('./pages/PatientPage.vue'),
      props: true,
      meta: { requiresAuth: true },
      children: [
        { path: '', name: 'patient', component: () => import('./pages/PatientHistory.vue') },
        { path: 'prescriptions', name: 'patient-prescriptions', component: () => import('./pages/PatientPrescriptions.vue') },
      ],
    },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('./pages/NotFound.vue') },
  ],
})

router.beforeEach((to) => {
  if (!to.meta.requiresAuth) return                    // /login 與 404 不攔，避免導向迴圈
  const session = useSessionStore()                    // 在守衛裡呼叫，這時 Pinia 已經安裝
  if (!session.user) return { name: 'login', query: { redirect: to.fullPath } }
})
```

`to.meta` 是一路上所有對到的路由記錄（從父到子）的 `meta` 合併的結果，所以子路由 `/patients/7/prescriptions` 的 `to.meta.requiresAuth` 也是 `true`。

```vue
<!-- PatientPage.vue -->
<script setup lang="ts">
import { ref, watch } from 'vue'

const { id } = defineProps<{ id: string }>()           // props: true，params 是字串
const patient = ref<{ name: string } | null>(null)

watch(() => id, async (pid) => {                       // 換病人時重抓；immediate 讓第一次也抓
  patient.value = null
  const res = await fetch(`/api/patients/${pid}`)
  patient.value = res.ok ? await res.json() : null
}, { immediate: true })
</script>

<template>
  <h1>{{ patient?.name ?? '載入中…' }}</h1>
  <nav>
    <RouterLink :to="{ name: 'patient', params: { id } }">病歷</RouterLink>
    <RouterLink :to="{ name: 'patient-prescriptions', params: { id } }">處方</RouterLink>
    <RouterLink :to="`/patients/${Number(id) + 1}`">下一位病人</RouterLink>
  </nav>
  <RouterView />
</template>
```

登入頁成功後讀 `route.query.redirect` 導回原頁：`router.replace(typeof route.query.redirect === 'string' ? route.query.redirect : '/appointments')`。用 `replace` 而不是 `push`，按上一頁不會回到登入頁。`redirect` 的值來自網址，任何人都改得到；交給 `router.replace` 只會在站內換頁，不要寫成 `window.location.href = redirect`，那樣可以被拿來把使用者導到別的網站。

上面的 `watch` 在快速切換病人時也有「舊回應蓋掉新結果」的問題，取消請求的寫法見 [watch 與 watchEffect](#/skill/watchers)。

## React 對照

| Vue Router 5.5 | React Router 8 |
|---|---|
| `createRouter({ history: createWebHistory(), routes })` | `createBrowserRouter([...])` 加 `<RouterProvider router={router} />` |
| `<RouterView>` | `<Outlet />` |
| `<RouterLink to="/patients/7">` | `<Link to="/patients/7">` |
| `useRoute().params.id` | `useParams().id` |
| `useRoute().query.date` | `useSearchParams()` |
| `useRouter().push('/login')` | `useNavigate()('/login')` |
| `router.beforeEach` 全域守衛 | 沒有一樣的東西；常見做法是在路由的 `loader` 裡檢查後 `redirect`，或包一層檢查登入的元件 |
| `component: () => import(…)` | `lazy` 或 `React.lazy` |

```jsx
import { createBrowserRouter, RouterProvider, Outlet, Link, useParams } from 'react-router'

function PatientPage() {
  const { id } = useParams()
  return (<><h1>病人 {id}</h1><Link to={`/patients/${Number(id) + 1}`}>下一位病人</Link><Outlet /></>)
}

const router = createBrowserRouter([
  { path: '/patients/:id', element: <PatientPage />, children: [{ index: true, element: <p>病歷</p> }] },
])

export function App() {
  return <RouterProvider router={router} />
}
```

React 的 `PatientPage` 換參數時同樣不會重新掛載；靠 `useEffect` 的依賴陣列放 `id` 重抓。history 模式的伺服器 fallback 兩邊都需要。

## 常見錯誤與錯誤訊息

| 訊息或現象 | 原因 | 修法 |
|---|---|---|
| 重新整理出現伺服器的 404 | history 模式沒有 fallback | 伺服器對找不到的路徑回 `index.html` |
| 換參數後畫面還是舊資料 | 只在 `onMounted` 抓資料 | `watch` 參數加 `immediate: true`，或 `onBeforeRouteUpdate` |
| 解構的 `params` 不會更新 | `const { params } = useRoute()` | 用 `route.params.id`，或 `props: true` |
| `Detected a possibly infinite redirection in a navigation guard when going from "/" to "/login"…` | 守衛連目的地本身也導向 | 不攔 `/login` 這類公開頁面 |
| `[VUE_ROUTER_R0025]`，訊息是 next() callback is deprecated | 守衛還在用 `next`（5.0.3 起警告） | 刪掉 `next` 參數，改用回傳值 |
| 宣告了 `next` 參數，導航卡住不動 | 某條路徑沒有呼叫 `next` | 同上 |
| `No match found for location with path "/patient/7"` | 路徑拼錯，或少了 404 路由 | 修正連結；加 `/:pathMatch(.*)*` |
| `[🍍]: "getActivePinia()" was called but there was no active Pinia…` | 在 `router.ts` 最外層呼叫 store | 移進守衛裡 |
| 登入後按上一頁又回到登入頁 | 登入成功用了 `push` | 改用 `replace` |

## 動手

1. 用 `npm run build` 與 `npx vite preview` 打開 `/patients/7` 並重新整理，確認 Vite 的預覽伺服器會回 `index.html`；再把 `dist/` 放到一個沒有 fallback 的靜態伺服器（例如 `npx serve dist` 不加選項）比較結果。
2. 在 `PatientPage` 裡只用 `onMounted` 抓資料，點「下一位病人」看畫面不更新，Vue DevTools 看 `id` prop 已經變了；改成 `watch` 再試。
3. 把守衛改成一律回傳 `'/login'`，看 Console 的無窮導向警告；再補上 `if (!to.meta.requiresAuth) return`。
4. 建置後看 `dist/assets/`，找出每個懶載入頁面各自的 chunk；守衛裡讀登入狀態的寫法回到 [Pinia](#/skill/pinia)。

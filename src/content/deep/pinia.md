## 從一個具體問題開始：登入後頁首還是「訪客」

門診系統加了 Pinia。上線後出現三個狀況：

1. 醫師登入成功，頁首仍然顯示「訪客」，重新整理頁面才變成醫師的名字。頁首元件寫的是 `const { user } = useSessionStore()`。
2. 預約清單的日期與科別放在 store 裡。醫師把網址傳給護理師，護理師打開看到的是今天、全部科別，不是醫師看的那一頁；按瀏覽器的上一頁也回不到剛才的篩選。
3. 王醫師登出、陳醫師在同一台電腦登入，病人清單還短暫顯示王醫師的病人，直到新的請求回來。

第一個是解構了 reactive 的 store；第二個是把該放網址的狀態放進 store；第三個是登出時只清了 `user`，其他 store 還留著上一位的資料。

## 運作原理

### store 是什麼

```
createPinia()  ──  app.use(pinia)
   │
   └─ stores（以 id 為 key）
        ├─ 'session'   { user, isDoctor, login(), logout() }
        └─ 'patients'  { list, load(), reset() }
```

`defineStore('session', …)` 只定義、不建立，回傳一個 `useSessionStore` 函式。第一次呼叫 `useSessionStore()` 時，Pinia 用 id 建立 store 並存起來；之後任何元件呼叫，拿到的都是同一個實例。所以 store 適合放「好幾個頁面共用、換頁後還要在」的狀態。

### setup store 與 option store

```ts
// setup store：寫法和 composable 一樣
export const useSessionStore = defineStore('session', () => {
  const user = ref<User | null>(null)                          // state
  const isDoctor = computed(() => user.value?.role === 'doctor') // getter
  function logout() { user.value = null }                     // action
  return { user, isDoctor, logout }                           // state 一定要全部 return
})
```

```ts
// option store：寫法和 Options API 相似
export const useSessionStore = defineStore('session', {
  state: () => ({ user: null as User | null }),
  getters: { isDoctor: (s) => s.user?.role === 'doctor' },
  actions: { logout() { this.user = null } },
})
```

| | setup store | option store |
|---|---|---|
| state、getter、action | `ref`、`computed`、函式 | `state()`、`getters`、`actions` |
| 用 `watch`、其他 composable | 可以 | 不方便 |
| `$reset()` | 沒有，要自己寫 | 內建 |
| 私有 state | 不行：Pinia 文件要求 state 全部 `return`，否則 DevTools、SSR 與外掛會出錯 | 不適用 |

對 setup store 呼叫 `$reset()` 會丟出 `🍍: Store "session" is built using the setup syntax and does not implement $reset().`（Pinia 4.1）。

### 為什麼解構會斷

store 是一個 reactive 物件，ref 在裡面會被自動拆開，所以元件寫 `session.user` 不用 `.value`。解構時拿到的是當下的值：

```ts
const session = useSessionStore()
const { user } = session                 // ✗ 當下的 null，之後不會變
const { user, isDoctor } = storeToRefs(session)   // ✓ 兩個 ref，連著 store
const { logout } = session               // ✓ action 可以直接解構
```

`storeToRefs` 只轉 state 與 getter，略過函式。用 Pinia 4.1 在 Node 實際跑：登入前解構的 `user` 在登入後仍是 `null`，`storeToRefs` 拿到的 getter 已經是新值。

### 狀態放哪裡

| 狀態 | 放哪裡 | 原因 |
|---|---|---|
| 登入的使用者、權限 | store | 頁首、選單、路由守衛都要讀 |
| 購物車、未送出的批次掛號 | store（需要時同步到 `sessionStorage`） | 跨頁面累積 |
| 清單的日期、科別、頁碼、排序 | 網址 query | 可以分享、上一頁回得去、重新整理還在 |
| 表單輸入到一半的值 | 表單元件 | 離開表單就不需要；要保留草稿再存 `sessionStorage` |
| Dialog 開關、目前展開哪一列 | 元件 | 只有一個元件在用 |
| API 回來的清單資料 | 看需求：只有一頁用就放元件；好幾頁共用、要快取才放 store 或資料快取工具 | 放 store 的資料要決定何時過期 |

store 的內容只存在記憶體，重新整理就沒了。要留著的，自己寫進 `sessionStorage`、localStorage，或重新整理後再向 API 要一次（登入狀態通常是後者：用 cookie 呼叫 `GET /api/me`）。

### 安裝順序與在元件外使用

```ts
// main.ts
const app = createApp(App)
app.use(createPinia())       // 先裝 Pinia
app.use(router)
app.mount('#app')
```

在 `app.use(pinia)` 之前呼叫 store，例如寫在 `router.ts` 的最外層：

```ts
const session = useSessionStore()     // ✗ 模組載入時就執行，這時 Pinia 還沒安裝
router.beforeEach((to) => { if (!session.user) … })
```

會丟出：

```
[🍍]: "getActivePinia()" was called but there was no active Pinia. Are you trying to use a store before calling "app.use(pinia)"?
```

把呼叫移進守衛裡（`router.beforeEach((to) => { const session = useSessionStore(); … })`），導航發生時 Pinia 已經安裝好了。

### Pinia 4

Pinia 4.0（2026-07）的變更只有兩項：套件只提供 ESM，`@vue/devtools-api` 改成 peer dependency、要和 pinia 一起安裝。store 的 API 與 Pinia 2、3 相同，另外把開發模式的錯誤與警告整理成有代碼的診斷訊息。Vue 官方文件建議新專案用 Pinia；Vuex 只在舊專案看得到。

## 實際程式：登入狀態與登出清理

```ts
// src/stores/session.ts
import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { usePatientsStore } from './patients'

export interface User { id: number; name: string; role: 'doctor' | 'nurse' | 'clerk' }

export const useSessionStore = defineStore('session', () => {
  const user = ref<User | null>(null)
  const isDoctor = computed(() => user.value?.role === 'doctor')

  async function login(account: string, password: string) {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account, password }),
      credentials: 'include',                 // API 在另一個網域時才需要；同網域的請求預設就會帶 cookie
    })
    if (!res.ok) throw new Error(res.status === 401 ? '帳號或密碼錯誤' : `HTTP ${res.status}`)
    user.value = await res.json()
  }

  async function restore() {                  // 重新整理後用 cookie 取回登入狀態
    const res = await fetch('/api/me')
    user.value = res.ok ? await res.json() : null
  }

  function logout() {
    user.value = null
    usePatientsStore().reset()                // 上一位醫師的病人清單一起清掉
  }

  return { user, isDoctor, login, restore, logout }
})
```

```ts
// src/stores/patients.ts
export const usePatientsStore = defineStore('patients', () => {
  const list = ref<{ id: number; name: string }[]>([])
  async function load() {
    const res = await fetch('/api/patients')
    list.value = res.ok ? await res.json() : []
  }
  function reset() { list.value = [] }        // setup store 沒有 $reset，自己寫
  return { list, load, reset }
})
```

```vue
<!-- AppHeader.vue -->
<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const { user, isDoctor } = storeToRefs(session)   // 讀狀態用 storeToRefs
const { logout } = session                         // action 直接拿
</script>

<template>
  <header>
    <span v-if="user">{{ user.name }}{{ isDoctor ? '（醫師）' : '' }}</span>
    <span v-else>訪客</span>
    <button v-if="user" type="button" @click="logout">登出</button>
  </header>
</template>
```

預約清單的條件不進 store，直接讀寫網址：

```ts
// AppointmentList.vue（script setup 節錄）
const route = useRoute()
const router = useRouter()
const date = computed({
  get: () => (route.query.date as string) ?? '2026-11-20',
  set: (v) => router.replace({ query: { ...route.query, date: v } }),   // 寫進網址，可以分享
})
```

`$subscribe` 可以在 state 改變時做同步，例如把批次掛號的暫存清單寫進 `sessionStorage`：`store.$subscribe((_mutation, state) => sessionStorage.setItem('batch', JSON.stringify(state.items)))`。

:::stop 讀到這裡可以先停：會寫 setup store，用 `storeToRefs` 解構，分得出哪些狀態該放 store、網址或元件，也會在登出時清理。後面的 React 對照與錯誤訊息表，在讀 Redux 或 Zustand 時再回來讀。

## React 對照

React 沒有內建的全域狀態工具，常見的選擇：

| 需求 | Vue 3.5 + Pinia | React 19 |
|---|---|---|
| 小範圍共用 | provide／inject | Context |
| 全域 store | `defineStore` | Zustand 5 的 `create`、Redux Toolkit 的 `createSlice` |
| 只讀需要的欄位 | `storeToRefs` 後只用到的 ref 會觸發更新 | selector：`useSessionStore((s) => s.user)`，只在 `user` 變時重新渲染 |
| 改狀態 | 呼叫 action，或直接改 state | 呼叫 store 提供的函式，裡面用 `set` 產生新的狀態 |

```js
// Zustand 5：概念上對應 setup store
import { create } from 'zustand'

export const useSessionStore = create((set) => ({
  user: null,
  logout: () => set({ user: null }),
}))

// 元件裡：const user = useSessionStore((s) => s.user)
```

兩邊都會遇到同一個判斷：哪些狀態該放全域、哪些該放網址或元件。

## 常見錯誤與錯誤訊息

| 訊息或現象 | 原因 | 修法 |
|---|---|---|
| 登入後頁首不更新 | 直接解構 store 的 state | `storeToRefs` |
| `[🍍]: "getActivePinia()" was called but there was no active Pinia. Are you trying to use a store before calling "app.use(pinia)"?` | 在安裝 Pinia 之前、或模組頂層呼叫 store | 移進守衛、元件 setup 或函式裡 |
| `🍍: Store "session" is built using the setup syntax and does not implement $reset().` | 對 setup store 呼叫 `$reset()` | 自己寫 `reset()` action |
| DevTools 的 Pinia 分頁看不到某個 state | setup store 沒有 `return` 那個 ref | 全部 `return` |
| 分享的網址打開後條件不見 | 篩選條件放在 store | 放網址 query |
| 登出後短暫看到上一位使用者的資料 | 登出只清了一個 store | 登出時把相關 store 一起重設 |
| `storeToRefs()` 的結果少了某個值 | 那個值在 store 裡是普通變數（不是 `ref`、`computed`），或是函式 | 狀態宣告成 `ref`；函式直接從 store 解構 |

## 動手

1. 在自己的專案寫出 `useSessionStore`，頁首先用 `const { user } = useSessionStore()`，登入後確認不會更新；改成 `storeToRefs` 再試一次。
2. 打開 Vue DevTools 的 Pinia 分頁，登入、登出各一次，看 `user` 的變化與 action 紀錄。
3. 把預約清單的日期從 store 搬到網址 query，複製網址到新分頁打開，確認條件還在、上一頁回得去。
4. 在 `router.ts` 的最外層呼叫 `useSessionStore()`，看 Console 的錯誤；移進 `beforeEach` 之後，接著讀 [Vue Router](#/skill/vue-router) 的導航守衛。

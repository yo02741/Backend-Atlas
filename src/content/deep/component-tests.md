## 從一個具體問題開始：改了 class 名稱，測試全紅；送錯欄位，測試全綠

掛號表單 `BookingForm` 的測試是請 AI 補的，一共 12 個，寫法像這樣：

```js
const wrapper = mount(BookingForm, { props: { sessionId: 's-1120-am' } })
vi.mocked(api.getSlots).mockResolvedValue([{ time: '09:00', left: 3 }])
await new Promise((r) => setTimeout(r, 500))                       // 等 API
wrapper.vm.picked = '09:00'                                         // 直接改元件內部的狀態
await wrapper.find('.slot-list > li:nth-child(1) .btn-primary').trigger('click')
expect(api.createAppointment).toHaveBeenCalled()
```

兩週後發生兩件事。設計師把按鈕的 class 從 `btn-primary` 改成 `btn btn--primary`，畫面與功能完全沒變，12 個測試紅了 9 個。同一週，後端把欄位從 `slot` 改名為 `time`，前端照著改 `api.js` 時打錯成 `tiem`，掛號一律回 422，測試卻全綠：API 模組整個被 `vi.mock` 換掉，斷言只檢查「有呼叫」，不檢查送出了什麼，也不檢查使用者看到了什麼。

這組測試綁住了實作（class、DOM 結構、內部變數），卻沒有綁住行為（送出的請求、畫面上的結果）。這一課的寫法反過來：用角色與名稱找元素，像使用者一樣操作，API 在網路層 mock，斷言落在畫面與 emit 的事件上。

## 運作原理

### 掛載：`mount` 與 `render`

Vue Test Utils（VTU）的 `mount(元件, 選項)` 建立一個 Vue app，把元件掛進 DOM，回傳一個 wrapper。常用的選項：

| 選項 | 用途 |
|---|---|
| `props` | 傳給元件的 props |
| `slots` | slot 的內容，字串或元件 |
| `global.plugins` | 裝 Pinia、Vue Router、i18n 這類 plugin |
| `global.stubs` | 把某些子元件換成替身，例如 `{ RouterLink: RouterLinkStub }` |
| `global.provide` | 給 `inject` 用的值 |
| `attachTo` | 掛到 `document.body` 底下的某個元素；預設掛在一個沒有接上文件的 `div` |

`@testing-library/vue` 的 `render` 底層就是 VTU 的 `mount`（`@testing-library/vue` 8.1 依賴 `@vue/test-utils` ^2.4），選項相同。差別在回傳值與找元素的方式：Testing Library 不給 wrapper，改用 `screen.getByRole(...)` 這類查詢，從 `document.body` 找使用者看得到的東西。兩者可以混用，本課的主要寫法用 Testing Library，VTU 的寫法放在後面對照。

### 找元素：查詢的優先順序

Testing Library 的文件「Which query should I use?」排出的順序：

| 順序 | 查詢 | 用在哪裡 |
|---|---|---|
| 1 | `getByRole('button', { name: '送出掛號' })` | 幾乎所有互動元素：按鈕、連結、欄位、radio、tab、dialog |
| 2 | `getByLabelText('手機')` | 有 `label` 的表單欄位 |
| 3 | `getByPlaceholderText` | 沒有 label、只有 placeholder 的欄位（本身就是無障礙問題） |
| 4 | `getByText('這天沒有預約')` | 非互動的文字 |
| 5 | `getByDisplayValue` | 找目前值是某個字的欄位 |
| 6 | `getByAltText`、`getByTitle` | 圖片、有 title 的元素 |
| 7 | `getByTestId('slot-chart')` | 沒有任何可見文字或角色可以描述的元素 |

`getByRole` 的名稱就是 accessibility tree 裡的 accessible name，和螢幕閱讀器念的是同一個。按鈕只有圖示沒有 `aria-label`、欄位沒有 `label` 時，查詢會失敗，測試順便擋下了無障礙問題。名稱的比對預設是完整字串（去掉前後空白後相等），只想比一部分就用正規表示式：`{ name: /09:00/ }`。

每種查詢都有三個版本，差在找不到時怎麼辦：

| 前綴 | 找不到 | 找到多個 | 用途 |
|---|---|---|---|
| `getBy` | 丟錯 | 丟錯 | 元素現在就該在 |
| `queryBy` | 回傳 `null` | 丟錯 | 斷言元素不存在：`expect(screen.queryByRole('alert')).not.toBeInTheDocument()` |
| `findBy` | 重試到逾時（預設 1000 毫秒）後丟錯 | 丟錯 | 等一段時間才會出現，例如 API 回來之後 |

複數版本 `getAllBy`、`queryAllBy`、`findAllBy` 回傳陣列。

### 操作：user-event、`fireEvent` 與 `trigger`

使用者點一下按鈕，瀏覽器依序發出 `pointerdown`、`mousedown`、`focus`、`pointerup`、`mouseup`、`click`；打一個字會有 `keydown`、`keypress`、`input`、`keyup`。三種工具模擬的程度不同：

| 工具 | 送出的事件 | 適合 |
|---|---|---|
| `@testing-library/user-event` 14：`await user.click(el)`、`user.type(el, '0912')`、`user.keyboard('{ArrowDown}')`、`user.tab()` | 照真實順序的一整串，會移動焦點、檢查元素是否停用 | 預設用這個 |
| Testing Library 的 `fireEvent.click(el)` | 只有一個 `click` | user-event 模擬不了的特殊事件 |
| VTU 的 `wrapper.trigger('click')`、`setValue('0912')` | 只有指定的事件（`setValue` 會設值並觸發 `input` 或 `change`） | VTU 風格的測試 |

`user.click()` 點停用的按鈕不會觸發 `click`，和瀏覽器一樣；`trigger('click')` 遇到停用的元素同樣不觸發。user-event 要先 `const user = userEvent.setup()`，每個測試各建一個。

### 等：Vue 的 DOM 更新是非同步的

一次點擊到畫面更新，中間有好幾個非同步的步驟：

```text
await user.click(送出)
  └─ click 事件 → submit() 執行，submitting.value = true
       └─ Vue 把 DOM 更新排進下一個 microtask（nextTick）
  fetch('/api/appointments') ── MSW 攔截 → handler 回 201 ── Promise resolve
       └─ message.value = '已完成掛號，號碼 A012'
            └─ 下一個 nextTick：<p role="status"> 的文字改變
expect(await screen.findByRole('status')).toHaveTextContent(...)   ← 一直重試到文字出現
```

| 要等的東西 | 怎麼等 |
|---|---|
| 狀態改變後的 DOM 更新 | `await user.click()`、`await wrapper.trigger()`、`await nextTick()` |
| 還沒 resolve 的 Promise（例如 `onMounted` 裡的 `fetch`） | VTU 的 `await flushPromises()` |
| 不確定要多久才出現的元素 | `await screen.findBy...()`，或 `await waitFor(() => expect(...))` |

不要用 `setTimeout` 等固定時間：太短會在慢的 CI 機器上失敗，太長讓每個測試都變慢。

:::stop 讀到這裡可以先停：會用 `getByRole` 找元素、用 user-event 操作、用 `findBy` 等非同步的結果。後面的 MSW、Pinia 與 Router 的替身和完整測試檔，在元件會呼叫 API 或依賴 store 時再回來讀。

### mock API：MSW 在網路層攔截

Mock Service Worker（MSW）在 Node 裡攔截 `fetch` 與 `XMLHttpRequest`，交給 handler 決定回應：

```text
BookingForm ──fetch('/api/sessions/s-1120-am/slots')──▶ MSW 攔截
                                                           │ 依序比對 handler
                                                           ▼
                           http.get('/api/sessions/:id/slots', resolver) → HttpResponse.json([...])
```

元件的程式不用改，網址怎麼組、body 送什麼、回應怎麼解析都在測試範圍內。一個測試要換回應時用 `server.use(...)` 把新的 handler 加在最前面，`afterEach` 呼叫 `server.resetHandlers()` 回到預設。

沒有對應 handler 的請求怎麼處理，是 MSW 3 改名的選項：

| 版本 | 選項 | 預設 |
|---|---|---|
| MSW 2.x（2.15.0） | `server.listen({ onUnhandledRequest: 'error' })` | `'warn'` |
| MSW 3.x（3.0.7） | `server.listen({ onUnhandledFrame: 'error' })` | `'warn'` |

MSW 3 的套件裡已經沒有 `onUnhandledRequest`。照 2.x 的寫法傳進去，MSW 3 不會報錯，只是忽略它、維持預設的 `'warn'`：沒有 handler 的請求印一行警告，然後照常送到網路上。Vitest 的 jsdom 環境預設網址是 `http://localhost:3000`，`fetch('/api/doctors')` 會去連 `127.0.0.1:3000`。

### plugin 與替身：Pinia、Router

- **Pinia**：`@pinia/testing` 的 `createTestingPinia()` 建一個測試用的 Pinia，`initialState` 指定 store 的初始狀態，預設把所有 action 換成 spy（`stubActions: true`）。spy 函式要由 `createSpy` 提供；沒開 Vitest 的 `globals` 時，找不到全域的 `vi`，要明確傳 `createSpy: vi.fn`。
- **Vue Router**：只需要 `<RouterLink>` 顯示出來時，用 VTU 的 `RouterLinkStub` 換掉，再用 `findComponent(RouterLinkStub).props('to')` 檢查連到哪裡；要測導航行為時，建一個用 `createMemoryHistory()` 的真 router 放進 `global.plugins`，`await router.isReady()` 之後再掛載。

## 實際程式碼

### 被測的元件

```vue
<!-- src/components/BookingForm.vue -->
<script setup>
import { ref, onMounted } from 'vue'

const props = defineProps({ sessionId: { type: String, required: true } })
const emit = defineEmits(['booked'])
const status = ref('loading')
const slots = ref([])
const picked = ref('')
const message = ref('')
const submitting = ref(false)

onMounted(async () => {
  try {
    const res = await fetch(`/api/sessions/${props.sessionId}/slots`)
    if (!res.ok) throw new Error(String(res.status))
    slots.value = await res.json()
    status.value = slots.value.length ? 'success' : 'empty'
  } catch {
    status.value = 'error'
  }
})

async function submit() {
  submitting.value = true
  const res = await fetch('/api/appointments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: props.sessionId, time: picked.value }),
  })
  submitting.value = false
  if (res.status === 201) {
    const appt = await res.json()
    message.value = `已完成掛號，號碼 ${appt.id}`
    emit('booked', appt.id)
  } else if (res.status === 409) {
    message.value = '這個時段剛額滿，請改選其他時段'
  }
}
</script>

<template>
  <form @submit.prevent="submit">
    <p v-if="status === 'loading'">載入時段中…</p>
    <p v-else-if="status === 'error'" role="alert">時段載入失敗</p>
    <p v-else-if="status === 'empty'">這個診次沒有可預約的時段</p>
    <fieldset v-else>
      <legend>看診時段</legend>
      <label v-for="s in slots" :key="s.time">
        <input v-model="picked" type="radio" name="slot" :value="s.time" :disabled="s.left === 0">
        {{ s.time }}（{{ s.left === 0 ? '額滿' : `剩 ${s.left} 位` }}）
      </label>
    </fieldset>
    <button type="submit" :disabled="!picked || submitting">送出掛號</button>
    <p role="status">{{ message }}</p>
  </form>
</template>
```

### 共用的 setup：MSW、jest-dom、清理

```js
// src/mocks/handlers.js：預設的回應，每個測試都從這裡開始
import { http, HttpResponse } from 'msw'

export const handlers = [
  http.get('/api/sessions/:id/slots', () =>
    HttpResponse.json([{ time: '09:00', left: 3 }, { time: '09:30', left: 0 }])),
  http.post('/api/appointments', async ({ request }) => {
    const body = await request.json()
    if (!body.time) return HttpResponse.json({ title: '缺少時段', status: 422 }, { status: 422 })
    return HttpResponse.json({ id: 'A012', ...body }, { status: 201 })
  }),
]
```

```js
// src/mocks/server.js：測試檔要用 server.use() 時從這裡 import
import { setupServer } from 'msw/node'
import { handlers } from './handlers.js'

export const server = setupServer(...handlers)
```

```js
// src/test-setup.js（vitest.config.js 的 setupFiles 指向這裡）
import '@testing-library/jest-dom/vitest'          // toBeDisabled、toHaveTextContent、toHaveFocus…
import { afterAll, afterEach, beforeAll } from 'vitest'
import { cleanup } from '@testing-library/vue'
import { server } from './mocks/server.js'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))   // MSW 3：沒有 handler 的請求讓測試失敗
afterEach(() => {
  cleanup()                     // Vitest 預設 globals: false，Testing Library 不會自動清理
  server.resetHandlers()        // 拿掉這個測試用 server.use() 加的 handler
})
afterAll(() => server.close())
```

handler 檢查 body 裡有沒有 `time`：前端把欄位打錯時，假後端回 422，畫面不會出現號碼，測試就會失敗。這正是開頭那組測試漏掉的。

### 元件測試：Testing Library 加 user-event

```js
// src/components/__tests__/BookingForm.spec.js
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../mocks/server.js'
import BookingForm from '../BookingForm.vue'

describe('BookingForm', () => {
  it('選時段、送出，顯示掛號號碼並 emit booked', async () => {
    const user = userEvent.setup()
    const { emitted } = render(BookingForm, { props: { sessionId: 's-1120-am' } })

    const slot = await screen.findByRole('radio', { name: /09:00/ })   // 等 onMounted 的 fetch 回來
    expect(screen.getByRole('radio', { name: /09:30/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: '送出掛號' })).toBeDisabled()

    await user.click(slot)
    await user.click(screen.getByRole('button', { name: '送出掛號' }))

    expect(await screen.findByText('已完成掛號，號碼 A012')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('已完成掛號，號碼 A012')
    expect(emitted().booked).toEqual([['A012']])
  })

  it('409：顯示額滿訊息', async () => {
    server.use(http.post('/api/appointments', () =>
      HttpResponse.json({ type: 'about:blank', title: '時段已額滿', status: 409 }, { status: 409 })))
    const user = userEvent.setup()
    render(BookingForm, { props: { sessionId: 's-1120-am' } })
    await user.click(await screen.findByRole('radio', { name: /09:00/ }))
    await user.click(screen.getByRole('button', { name: '送出掛號' }))
    expect(await screen.findByRole('status')).toHaveTextContent('這個時段剛額滿')
  })

  it('500：顯示載入失敗', async () => {
    server.use(http.get('/api/sessions/:id/slots', () => new HttpResponse(null, { status: 500 })))
    render(BookingForm, { props: { sessionId: 's-1120-am' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('時段載入失敗')
  })
})
```

這三個測試在 Vitest 5.1.1、`@testing-library/vue` 8.1.0、user-event 14.6.13、MSW 3.0.7、jsdom 31.0.1 上實測通過。改按鈕的 class、把 `<label>` 換成別的排版，測試都不受影響；把 `:disabled="s.left === 0"` 刪掉，第一個測試會紅。

### 對照：同一個測試用 VTU 寫

```js
import { mount, flushPromises } from '@vue/test-utils'

it('送出後 emit booked（VTU）', async () => {
  const wrapper = mount(BookingForm, { props: { sessionId: 's-1120-am' } })
  await flushPromises()                                   // 等 onMounted 裡的 fetch
  await wrapper.find('input[value="09:00"]').setValue()   // radio 的 setValue() 會勾選它
  await wrapper.find('form').trigger('submit')
  await flushPromises()                                   // 等 POST 的回應
  expect(wrapper.emitted('booked')).toEqual([['A012']])
  expect(wrapper.text()).toContain('已完成掛號，號碼 A012')
})
```

VTU 用 CSS 選擇器找元素，等待要自己 `flushPromises()`；適合需要 `findComponent`、檢查子元件 props 的情況。

### 裝 Pinia 與替換 RouterLink

```js
import { mount, RouterLinkStub } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { vi } from 'vitest'
import NavLinks from '../NavLinks.vue'   // <RouterLink to="/appointments">我的掛號（{{ store.count }}）</RouterLink>

it('顯示 store 裡的掛號數', () => {
  const wrapper = mount(NavLinks, {
    global: {
      plugins: [createTestingPinia({ createSpy: vi.fn, initialState: { clinic: { count: 5 } } })],
      stubs: { RouterLink: RouterLinkStub },
    },
  })
  expect(wrapper.text()).toBe('我的掛號（5）')
  expect(wrapper.findComponent(RouterLinkStub).props('to')).toBe('/appointments')
})
```

## 常見錯誤與錯誤訊息

以下訊息都是在上面的版本組合上實際跑出來的：

| 訊息 | 原因 | 修法 |
|---|---|---|
| `TestingLibraryElementError: Found multiple elements with the role "button" and name "送出掛號"`，而且只有第二個以後的測試失敗 | 上一個測試掛的元件還在 DOM 裡：Testing Library 只在全域有 `afterEach` 時自動清理，Vitest 預設 `globals: false` | setup 檔寫 `afterEach(() => cleanup())`，或在 Vitest 設定開 `globals: true` |
| `TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "送出"`，底下是 `Here are the accessible roles:` 與每個角色的 `Name` | 名稱寫錯（實際是「送出掛號」），或元素沒有名稱 | 照清單裡的名稱改查詢；清單裡的 `Name ""` 代表元件少了 label |
| `Unable to find an element with the text: 已完成掛號. This could be because the text is broken up by multiple elements.` | 預設是完整字串比對，畫面上是「已完成掛號，號碼 A012」；或文字根本還沒出現 | 用 `/已完成掛號/`；確認前面的操作有送出 |
| `Error: Cannot call trigger on an empty DOMWrapper.` | VTU 的 `find()` 沒找到元素，回傳空的 wrapper | 改用 `get()`，找不到時直接報 `Unable to get [data-test="submit"] within: <form>…`，連同目前的 HTML |
| `AssertionError: expected [] to have a length of 2 but got +0` | `onMounted` 的 `fetch` 還沒回來就斷言 | `await flushPromises()`，或改用 `findAllByRole` |
| `[Vue warn]: Failed to resolve component: RouterLink` | 元件用了 `<RouterLink>`，測試沒裝 router | `global.stubs: { RouterLink: RouterLinkStub }`，或裝真的 router |
| `Error: [🍍]: "getActivePinia()" was called but there was no active Pinia. Are you trying to use a store before calling "app.use(pinia)"?` | 元件用了 store，測試沒裝 Pinia | `global.plugins: [createTestingPinia({ createSpy: vi.fn })]` |
| `PINIA_TESTING_C0001: You must configure the "createSpy" option.` | 沒開 `globals`，`@pinia/testing` 找不到全域的 `vi.fn` | 傳 `createSpy: vi.fn` |
| `[MSW] Warning: intercepted a request without a matching request handler:`，接著 `TypeError: fetch failed`、`connect ECONNREFUSED 127.0.0.1:3000` | 沒有 handler，而且 MSW 3 收到的是 2.x 的 `onUnhandledRequest`，被忽略，請求送到了真的網路 | 改成 `onUnhandledFrame: 'error'`，再補上 handler |
| `[MSW] Error: intercepted a request without a matching request handler:`，原因是 `InternalError: [MSW] Cannot bypass a request when using the "error" strategy for the "onUnhandledFrame" option.` | 設定正確，這個請求就是沒有 handler | 補 handler；這是想要的失敗 |

還有幾個不會出錯訊息、但會讓測試沒在檢查的寫法：

- 讀寫 `wrapper.vm` 的內部狀態（`wrapper.vm.picked = '09:00'`）：跳過了使用者的操作，`<script setup>` 重構後也可能讀不到。
- 斷言只有 `toHaveBeenCalled()`：不知道送了什麼、畫面變成什麼。
- `vi.mock('../api.js')` 整個換掉 API 模組：網址、方法、body 都不在測試範圍。需要時改用 MSW，handler 裡用 `await request.json()` 檢查 body。
- 每個測試都 `shallowMount`：子元件全變成 stub，父子之間的 props 與事件沒有被測到。

## 動手

1. 在自己的專案裝 `@testing-library/vue`、`@testing-library/user-event`、`@testing-library/jest-dom`、`msw`，照上面的 setup 檔設定，確認 `onUnhandledFrame` 拼對：故意刪掉一個 handler，測試要失敗，訊息是 `[MSW] Error`。
2. 挑一個已經有測試的元件，把所有用 class 或 `data-testid` 找元素的地方改成 `getByRole`；改不過去的，多半是元件少了 `label` 或按鈕名稱。
3. 為一個呼叫 API 的元件寫四個測試：成功、空陣列、409 或 422、500。每個測試用 `server.use()` 換回應，對照 [API 的四種狀態](#/skill/api-states) 的畫面。
4. 故意把元件改壞三次（拿掉停用條件、把 body 的欄位改名、刪掉錯誤訊息），每次都要有測試變紅。
5. 牽涉 `<dialog>`、版面或捲動的行為，移到 [Playwright E2E](#/skill/e2e-playwright) 或 Vitest Browser Mode，原因見 [前端測試的分層](#/skill/test-layers)；鍵盤操作的測試寫法見 [元件的鍵盤操作與 ARIA](#/skill/a11y-components)。

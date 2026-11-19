## 從一個具體問題開始：元件測試全綠，Dialog 關掉後焦點不見了

掛號前端有一組 Vitest 測試，幾秒內跑完，每次 push 都是綠的。上線後連續收到三個問題：

1. 「取消預約」從「更多操作」選單開出確認 Dialog，按 Esc 關掉後，焦點掉到 `body`，鍵盤使用者得從頁首重新 Tab。
2. 手機寬度下，「送出掛號」被固定在底部的提示列蓋住一半，點不到。
3. 看診前剛好 2 小時的預約，畫面說不能取消，規則明明寫「2 小時以前（含）可以取消」。

第 1 個問題的元件有測試，鍵盤操作的每一步都有斷言，在 jsdom 裡全部通過。把同一個流程放進真的 Chromium（Vitest Browser Mode）跑，立刻失敗：

```text
Error: expect(element).toHaveFocus()
Expected element with focus:
  <button aria-expanded="false" aria-haspopup="menu" ...> 更多操作 </button>
Received element with focus:
  <body> ...
```

jsdom 31 的 `<dialog>` 沒有 `showModal()`，元件測試從來沒有開過那個 Dialog。第 2 個問題需要版面計算，jsdom 也沒有。第 3 個問題是 `>=` 寫成了 `>`，一個不用掛任何元件、幾毫秒就跑完的單元測試就抓得到，只是沒人寫。

三個問題各自適合不同的測試層。這一課講每一層跑在哪裡、抓得到什麼、抓不到什麼，以及一條驗收條件該放哪一層。

## 運作原理

### 三層與底下的靜態檢查

| 層 | 跑在哪裡 | 測什麼 | 一個測試的時間（本課範例實測的量級） | 工具 |
|---|---|---|---|---|
| 靜態檢查 | 不執行程式 | 拼錯的欄位、傳錯型別的 prop、改 props、`v-for` 沒 `key` | 整個專案幾秒 | ESLint、`vue-tsc` |
| 單元測試 | Node | 純函式、composable、store 的規則與計算 | 0 到 1 毫秒 | Vitest |
| 元件測試 | Node 加上模擬的 DOM（jsdom、happy-dom） | 一個元件的畫面、互動、emit、API 狀態 | 十幾到兩三百毫秒 | Vue Test Utils、Testing Library、MSW |
| 元件測試（Browser Mode） | 真的瀏覽器 | 同上，加上版面、焦點、`<dialog>` | 啟動瀏覽器要一兩秒，之後每個測試很快 | Vitest Browser Mode、vitest-browser-vue |
| E2E | 真的瀏覽器開整個網站 | 跨元件、跨頁的流程，路由、重新整理、真的網路 | 每個測試幾百毫秒到數秒，另加啟動網站 | Playwright |

越往下越接近使用者，也越慢、越容易因為時序或環境而偶爾失敗。常見的兩種說法：測試金字塔（底層單元測試最多，往上越來越少）；Kent C. Dodds 的「測試獎盃」，把靜態檢查放在最底層，並認為整合層（前端的元件測試）在花費與信心之間最划算。兩種說法都同意：E2E 只留給關鍵流程。

### jsdom 做得到與做不到的

jsdom 與 happy-dom 用 JavaScript 實作 DOM 與一部分瀏覽器 API，讓元件可以在 Node 裡掛載。它們不計算版面，也缺了一些 API。下表是本課在 jsdom 31.0.1 與 happy-dom 21.0.4 上實測的結果：

| 項目 | jsdom 31 | happy-dom 21 | 真的瀏覽器 |
|---|---|---|---|
| `getBoundingClientRect()`、`offsetWidth` | 全是 0 | 全是 0 | 真的尺寸 |
| `<dialog>` 的 `showModal()` | 沒有（`showModal is not a function`） | 有，但焦點不會移進 Dialog | 有，焦點移進 Dialog、背景 inert |
| `matchMedia` | 沒有 | 有 | 有 |
| `IntersectionObserver`、`ResizeObserver` | 沒有 | 有 | 有 |
| `element.scrollIntoView()` | 沒有 | 有 | 有 |
| CSS 的版面、`position: sticky`、媒體查詢的效果 | 沒有 | 沒有 | 有 |
| 焦點、`focus()`、`document.activeElement` | 有 | 有 | 有 |
| 鍵盤、滑鼠事件（user-event 模擬） | 有 | 有 | 有 |

所以鍵盤操作、`aria-*` 屬性、文字與按鈕狀態，在 jsdom 裡測得很準；寬度、被遮住、捲動、Dialog 的 top layer 與焦點回復，要到真的瀏覽器測。happy-dom「有」某個 API，不代表它的行為和瀏覽器一樣：上表的 `showModal()` 就是例子。

### 一條驗收條件放哪一層

依序問三個問題：

1. **不掛元件就能測嗎？** 時段能不能取消、掛號號碼的格式、表單驗證規則、排序：抽成函式或 composable，寫單元測試。
2. **需要真的瀏覽器嗎？** 版面與寬度、被遮住、捲動位置、`<dialog>` 與 popover、焦點跨元件回復、`IntersectionObserver` 觸發的載入：Vitest Browser Mode 或 Playwright。
3. **跨頁或需要整個網站嗎？** 登入後導回原頁、重新整理後狀態還在、上一頁回到原位、前後端接得起來：E2E。

都不是的，放元件測試：給定 props 與 API 回應，使用者點了什麼、看到什麼、元件 emit 了什麼。

開頭的三個問題分別落在：第 3 個是單元測試（`canCancel` 的兩個邊界）；第 1 個是 Browser Mode 或 E2E；第 2 個是 Playwright 在 390px 寬度下對按鈕做 `click()`，被蓋住時 Playwright 會回報 `<div class="sticky-hint">…</div> intercepts pointer events`。

### 替身：換掉越多，測到的越少

每一層都會把一部分外部依賴換成替身：

| 依賴 | 元件測試的常見替身 | E2E 的常見替身 |
|---|---|---|
| 後端 API | MSW 在網路層攔截 `fetch` | `page.route` 回固定的 JSON；或接真的測試環境 |
| 時間 | `vi.useFakeTimers()`、`vi.setSystemTime()` | `page.clock` |
| Pinia store | `createTestingPinia()` | 不換，用真的 |
| Vue Router | `RouterLinkStub`，或建一個 memory history 的 router | 不換，用真的 |
| 子元件 | `shallowMount` 或 `global.stubs` | 不換 |

替身讓測試穩定、快、能造出各種狀態，代價是測到的不是真的東西。MSW 換掉的只有網路，元件照常組網址、送 body、解析回應，這些都還在測試範圍裡；把 API 模組整個 `vi.mock` 掉、子元件全部 stub，測試只證明元件在假的世界裡能動。原則是只換「不換就跑不起來或不穩定」的部分。

### Vitest 的幾個預設值

- `environment` 預設是 `node`，沒有 `document`。元件測試要設成 `jsdom` 或 `happy-dom`（整個專案設定，或在單一檔案開頭寫 `// @vitest-environment jsdom`），否則掛載時出現 `ReferenceError: document is not defined`。
- `globals` 預設是 `false`：`describe`、`it`、`expect` 要自己 import。Testing Library 的自動清理靠全域的 `afterEach`，沒開 `globals` 就要自己呼叫 `cleanup()`，見 [元件測試的寫法](#/skill/component-tests)。
- `vitest` 不加參數，在終端機裡預設進入 watch 模式、改檔就重跑；CI 上（`CI` 環境變數）預設跑一次就結束。Vitest 5.1 另外會偵測自己是不是被 AI 寫程式工具執行（看 `CLAUDECODE`、`CURSOR_AGENT`、`AI_AGENT` 這類環境變數），是的話不進 watch 模式、改用精簡的輸出。腳本裡明確寫 `vitest run`，不必依賴這些偵測。

## 實際程式碼

### Vitest 設定：沿用 Vite 的設定，排除 E2E

create-vue 3.24 產生的設定長這樣，`mergeConfig` 讓測試沿用 `vite.config.js` 的 plugin 與別名：

```js
// vitest.config.js
import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config.js'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      exclude: [...configDefaults.exclude, 'e2e/**'],   // Playwright 的測試不給 Vitest 跑
      root: fileURLToPath(new URL('./', import.meta.url)),
      setupFiles: ['./src/test-setup.js'],              // MSW、jest-dom 的 matcher、cleanup
    },
  }),
)
```

### 單元測試：規則與邊界

```js
// src/utils/appointment.js
export const formatQueueNo = (n) => 'A' + String(n).padStart(3, '0')

export function canCancel(appt, now) {
  const start = new Date(`${appt.date}T${appt.time}:00+08:00`)
  return appt.status === 'booked' && start - now >= 2 * 60 * 60 * 1000   // 看診前 2 小時（含）以前才能取消
}
```

```js
// src/utils/__tests__/appointment.spec.js
import { describe, it, expect } from 'vitest'
import { formatQueueNo, canCancel } from '../appointment.js'

describe('formatQueueNo', () => {
  it.each([[1, 'A001'], [12, 'A012'], [123, 'A123']])('%i → %s', (n, expected) => {
    expect(formatQueueNo(n)).toBe(expected)
  })
})

describe('canCancel', () => {
  const appt = { date: '2026-11-20', time: '09:00', status: 'booked' }
  it('看診前 2 小時整：可以取消', () => {
    expect(canCancel(appt, new Date('2026-11-20T07:00:00+08:00'))).toBe(true)
  })
  it('看診前 1 小時 59 分：不能取消', () => {
    expect(canCancel(appt, new Date('2026-11-20T07:01:00+08:00'))).toBe(false)
  })
  it('已報到：不能取消', () => {
    expect(canCancel({ ...appt, status: 'checked-in' }, new Date('2026-11-19T09:00:00+08:00'))).toBe(false)
  })
})
```

`now` 由參數傳進來，測試不必假造系統時間；把 `>=` 改成 `>`，第一個 `canCancel` 測試就會變紅。

### 元件測試：在 jsdom 裡測互動

```js
// src/components/__tests__/BookingForm.spec.js（節錄，完整寫法見元件測試那一課）
it('選時段、送出，顯示掛號號碼', async () => {
  const user = userEvent.setup()
  const { emitted } = render(BookingForm, { props: { sessionId: 's-1120-am' } })
  await user.click(await screen.findByRole('radio', { name: /09:00/ }))   // 等 MSW 回時段
  await user.click(screen.getByRole('button', { name: '送出掛號' }))
  expect(await screen.findByRole('status')).toHaveTextContent('已完成掛號，號碼 A012')
  expect(emitted().booked).toEqual([['A012']])
})
```

### Browser Mode：元件測試放進真的瀏覽器

Vitest 4 起 Browser Mode 的 provider 拆成獨立套件，Playwright 的是 `@vitest/browser-playwright`；Vue 元件用 `vitest-browser-vue` 掛載。以下在 Vitest 5.1.1、vitest-browser-vue 3.1.0 實測：

```js
// vitest.browser.config.js
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  plugins: [vue()],
  test: {
    include: ['src/**/*.browser.spec.js'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
})
```

```js
// src/components/__tests__/CancelFlow.browser.spec.js
import { test, expect } from 'vitest'
import { render } from 'vitest-browser-vue'
import { userEvent } from 'vitest/browser'
import CancelFlow from '../CancelFlow.vue'      // 「更多操作」選單加上確認取消的 <dialog>

test('關掉 Dialog 後焦點回到「更多操作」', async () => {
  const screen = await render(CancelFlow)       // vitest-browser-vue 3 的 render 要 await
  const more = screen.getByRole('button', { name: '更多操作' })
  await userEvent.tab()
  await userEvent.keyboard('{ArrowUp}')
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByRole('button', { name: '保留預約' })).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(more).toHaveFocus()      // jsdom 測不到的那一步
})
```

`expect.element()` 會重試到條件成立，和 Playwright 的 web-first assertion 一樣。vitest-browser-vue 在每個測試「開始前」清掉上一個元件，畫面會留在瀏覽器裡方便看；`@testing-library/vue` 是在測試「結束後」清理。

### E2E 與 package.json 的指令

```js
// playwright.config.js（節錄）
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:4173', trace: 'on-first-retry' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: { command: 'npm run preview', port: 4173, reuseExistingServer: !process.env.CI },
})
```

```json
{
  "scripts": {
    "lint": "eslint .",
    "type-check": "vue-tsc --build",
    "test:unit": "vitest run",
    "test:browser": "vitest run --config vitest.browser.config.js",
    "test:e2e": "playwright test"
  }
}
```

CI 的順序照「便宜的先跑」：lint 與型別檢查、單元與元件測試、`vite build`、E2E。前面失敗就不用等後面。

## 常見錯誤與錯誤訊息

| 訊息或現象 | 原因 | 修法 |
|---|---|---|
| `ReferenceError: document is not defined` | Vitest 的 `environment` 還是預設的 `node` | 設定 `environment: 'jsdom'`，或在檔案開頭寫 `// @vitest-environment jsdom` |
| `TypeError: dialog.value.showModal is not a function`，前面一行是 `Vitest caught 1 unhandled error during the test run.` | jsdom 沒有 `showModal()` | 這段流程改到 Browser Mode 或 Playwright 測；不要在 jsdom 裡補一個假的 `showModal` 了事，那樣測到的是自己寫的假函式 |
| `Error: Playwright Test did not expect test.beforeEach() to be called here.` | Vitest 把 `e2e/*.spec.js` 也當成自己的測試 | `exclude: [...configDefaults.exclude, 'e2e/**']` |
| 版面相關的斷言永遠通過或永遠失敗 | jsdom 的尺寸全是 0 | 移到真的瀏覽器 |
| 元件測試全綠，功能是壞的 | 斷言落在替身上（`toHaveBeenCalled()`），或測的是內部狀態 | 斷言畫面上的文字、角色、按鈕狀態與送出的請求 |
| CI 跑二十分鐘 | 每個分支都寫成 E2E | E2E 只留關鍵流程，其他往下移到元件與單元測試 |
| E2E 偶爾失敗，重跑就過 | 固定的等待時間、測試之間共用資料 | 見 [Playwright E2E](#/skill/e2e-playwright) |

還有一個看不到訊息的錯：測試從來不會失敗。每加一層測試，故意把程式改壞一次（拿掉停用條件、把 `>=` 改成 `>`、刪掉 `focus()`），確認該變紅的那一層有變紅。覆蓋率與「假綠燈」的完整討論在後端路線的 [測試品質](#/skill/test-quality)。

## 動手

1. 把自己專案的驗收條件列出來，每一條用「不掛元件能不能測、要不要真的瀏覽器、要不要整個網站」三個問題標出層級。
2. 在專案裡找一個呼叫 `showModal()`、`getBoundingClientRect()` 或 `matchMedia` 的元件，看它在 jsdom 裡的測試到底驗到了什麼。
3. 照上面的設定加一個 Browser Mode 的測試，故意把焦點處理改壞，比較 jsdom 與 Browser Mode 的結果。
4. 跑 `npx vitest run --reporter=verbose`，看每個測試的時間；把同一件事在 E2E 與元件測試各測一次的地方刪掉一個。
5. 讀 [元件測試的寫法](#/skill/component-tests)、[Playwright E2E](#/skill/e2e-playwright) 與 [lint 與型別檢查](#/skill/lint-typecheck)，把三層各補上一個會在改壞時變紅的測試；整體的驗收順序見 [驗收 AI 產出的前端](#/skill/ai-acceptance)。

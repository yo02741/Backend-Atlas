## 從一個具體問題開始：本機每次過，CI 每五次失敗一次

掛號流程的 E2E 測試是這樣寫的：

```js
test('掛號', async ({ page }) => {
  await page.goto('http://localhost:5173/')
  await page.waitForTimeout(1000)                                 // 等時段載入
  await page.click('.slot-list li:first-child input')
  await page.click('button.btn-primary')
  await page.waitForTimeout(1000)                                 // 等送出
  const msg = await page.textContent('.status')
  expect(msg).toBe('已完成掛號，號碼 A012')
})
```

在開發者的筆電上每次都過。到了 CI，大約五次失敗一次，訊息只有一行：

```text
Error: expect(received).toBe(expected) // Object.is equality
Expected: "已完成掛號，號碼 A012"
Received: ""
```

CI 的機器比較慢，測試環境的 API 偶爾超過 1 秒才回來；`textContent` 只在那一刻讀一次，讀到空字串就判定失敗。沒有 trace，也沒有截圖，只能在本機重跑、猜時序。同一支測試還有兩個隱憂：第一個時段如果剛好額滿（`disabled`），`click` 會一直等到逾時；設計師把 `btn-primary` 改名，測試就壞了，使用者卻看不出任何差別。

這一課把它改寫成 Playwright 建議的寫法：locator 用角色與名稱、交給自動等待、斷言用會重試的 web-first assertion、API 用 `page.route` 固定回應，失敗時留下 trace。版本以 `@playwright/test` 1.65.1 為準。

## 運作原理

### locator 是描述，不是元素

`page.getByRole('button', { name: '送出掛號' })` 不會馬上去找元素，它只是一段「怎麼找」的描述。每次對它做動作（`click`）或斷言（`expect(...).toBeVisible()`）時，Playwright 才到頁面上找一次。Vue 重新渲染、元素被換掉，下一次動作仍然找得到新的那一個。

Playwright 建議的找法，依序：

| locator | 對應 |
|---|---|
| `getByRole('button', { name: '送出掛號' })` | 角色與 accessible name，和螢幕閱讀器看到的一樣 |
| `getByLabel('手機')` | 表單欄位的 label |
| `getByPlaceholder`、`getByText`、`getByAltText`、`getByTitle` | 看得到的文字 |
| `getByTestId('slot-chart')` | `data-testid` 屬性（設定檔的 `testIdAttribute` 可以改名） |
| `locator('.slot-list li')` | CSS 或 XPath，最後才用 |

縮小範圍用串接與 `filter`：

```js
// 「11/20 09:00」那一列裡的「取消預約」
page.getByRole('row', { name: /11\/20 09:00/ }).getByRole('button', { name: '取消預約' })
// 清單項目裡含有「王醫師」的那一個
page.getByRole('listitem').filter({ hasText: '王醫師' })
```

**strict mode**：對 locator 做動作時，它必須剛好對到一個元素。對到兩個以上，Playwright 不會猜，直接失敗並列出每一個候選元素，以及能唯一指到它的 locator：

```text
Error: locator.click: Error: strict mode violation: getByRole('tab', { name: /已/ }) resolved to 2 elements:
    1) <button role="tab" ... aria-selected="false">已報到</button> aka getByRole('tab', { name: '已報到' })
    2) <button role="tab" ... aria-selected="false">已取消</button> aka getByRole('tab', { name: '已取消' })
```

### 自動等待：動作前的檢查

`click()`、`fill()`、`check()` 這類動作，操作之前會先等元素達到可以操作的狀態，條件不成立就隔一段時間重試，直到動作的逾時（預設沒有個別上限，受整個測試的 30 秒限制）：

| 動作 | 等待的條件（1.65.1 原始碼） |
|---|---|
| `click`、`dblclick`、`check`、`tap` | 可見、可用（不是 `disabled`）、位置穩定（沒在動畫中移動）、不在 inert 區域；捲進畫面後，點擊位置上的元素就是它本身，沒有被別的元素蓋住 |
| `hover` | 可見、位置穩定、沒有被蓋住（不檢查是否停用） |
| `fill`、`clear` | 可見、可用、可編輯（不是 `readonly`）、不在 inert 區域 |
| `selectOption` | 可見、可用、不在 inert 區域 |

等待的過程會寫在錯誤的 Call log 裡。點一顆停用的按鈕：

```text
TimeoutError: locator.click: Timeout 1500ms exceeded.
Call log:
  - waiting for getByRole('button', { name: '送出掛號' })
    - locator resolved to <button disabled type="submit">送出掛號</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is not enabled
    - retrying click action
```

Dialog 開著時去點背景的 tab：

```text
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - <dialog open="" aria-labelledby="cancel-title">…</dialog> intercepts pointer events
```

有了自動等待，`waitForTimeout(1000)` 這類固定等待就沒有存在的理由：慢的機器上不夠，快的機器上浪費時間。

### web-first assertion：斷言會重試

```js
await expect(page.getByRole('status')).toHaveText('已完成掛號，號碼 A012')   // 重試到成立，預設最多 5 秒
expect(await page.getByRole('status').textContent()).toBe('已完成掛號，號碼 A012')  // 只讀一次
```

第一種是 web-first assertion：Playwright 反覆讀取，直到條件成立或超過 `expect` 的逾時（預設 5000 毫秒）。第二種先讀一次值，再交給普通的 `expect` 比較，開頭的測試就是這樣失敗的。常用的幾個：

| 斷言 | 檢查 |
|---|---|
| `toBeVisible()`、`toBeHidden()` | 看不看得到 |
| `toHaveText()`、`toContainText()` | 文字（完全相同、包含） |
| `toBeEnabled()`、`toBeDisabled()`、`toBeChecked()` | 狀態 |
| `toBeFocused()` | 是不是 `document.activeElement` |
| `toHaveAttribute('aria-expanded', 'true')` | 屬性值 |
| `toHaveCount(3)` | locator 對到幾個元素 |
| `toHaveURL(/\/appointments/)` | 目前的網址 |
| `toHaveAccessibleName()`、`toHaveRole()` | accessibility tree 裡的名稱與角色 |
| `toMatchAriaSnapshot()` | 一整段 accessibility tree 的角色、名稱與狀態 |
| `toHaveScreenshot()` | 截圖和基準圖相同 |

不是 locator 的值（例如自己計數的 API 呼叫次數）用 `await expect.poll(() => calls).toBe(2)` 重試。web-first assertion 一定要 `await`，漏寫時測試函式先結束了，訊息是 `Error: Test ended.`。

### `page.route`：每個測試自己決定 API 回什麼

```js
await page.route('**/api/sessions/*/slots', (route) =>
  route.fulfill({ json: [{ time: '09:00', left: 3 }, { time: '09:30', left: 0 }] }))   // 成功
await page.route('**/api/appointments', (route) =>
  route.fulfill({ status: 409, json: { title: '時段已額滿', status: 409 } }))         // 409
await page.route('**/api/sessions/*/slots', (route) => route.abort('failed'))          // 網路錯誤
```

`route.fulfill` 直接回應，請求不會送出去；`route.abort` 模擬連線失敗；`route.continue` 放行（可以改標頭）。同一個網址註冊了好幾個 route 時，後註冊的先執行，可以在單一測試裡覆蓋 `beforeEach` 設好的預設回應。

用 `page.route` 固定回應的測試穩定、能造出任何狀態；代價是前後端的契約不在測試範圍裡。關鍵流程另外對真的測試環境跑一支，確認欄位與狀態碼對得上。

### 設定檔：誰啟動網站、跑哪些瀏覽器

`playwright.config.js` 的幾個欄位決定了測試怎麼跑：

| 欄位 | 用途 |
|---|---|
| `webServer` | 測試前先啟動網站，等網址回應才開始；`reuseExistingServer` 讓本機沿用已經開著的 dev server |
| `use.baseURL` | `page.goto('/')` 的基準網址 |
| `projects` | 每個 project 一種瀏覽器或裝置：`devices['Desktop Chrome']`、`devices['Desktop Safari']`、手機的 viewport |
| `retries` | 失敗後重跑幾次；重跑才過的測試在報告裡標成 flaky |
| `use.trace` | 什麼時候錄 trace：`'on-first-retry'`、`'retain-on-failure'`、`'on'` |
| `reporter` | `'list'`、`'html'`；在 GitHub Actions 上可以加 `'github'` |

### 失敗時：trace 與錯誤內容

trace 是一個 zip 檔，錄下每個動作前後的 DOM 快照、Network 請求、Console 訊息與原始碼位置。`npx playwright show-trace test-results/…/trace.zip` 打開 trace viewer，可以一步一步回放、在快照上檢查元素，比在本機重跑、猜時序快得多。CI 上把 `test-results/` 上傳成 artifact，失敗時下載來看。

1.65 失敗時還會在測試的結果資料夾寫一份 `error-context.md`：開頭幾行是寫給讀者（通常是 AI 工具）的指示，請它簡短解釋失敗原因並給出修法；接著是錯誤訊息與 Call log、失敗當下整頁的 accessibility tree（Page snapshot）、測試原始碼。把這份檔案交給寫程式的 AI，比貼一行錯誤訊息完整。

### 截圖比對

```js
await expect(page.getByRole('tablist')).toHaveScreenshot('tabs.png')
```

第一次執行沒有基準圖，Playwright 存下實際的截圖並讓測試失敗：`A snapshot doesn't exist at …/booking.spec.js-snapshots/tabs-chromium-linux.png, writing actual.` 之後每次逐像素比對。

- 檔名帶 project 名稱與作業系統（`-chromium-linux`）：字型與反鋸齒在不同機器上不同，基準要在 CI 用的同一種環境產生，常見做法是在 CI 用的 Docker image 裡更新。
- `toHaveScreenshot` 預設停掉 CSS 動畫與轉場（`animations: 'disabled'`）、隱藏文字游標（`caret: 'hide'`）。
- 日期、掛號號碼這類每次不同的內容用 `mask: [page.getByTestId('today')]` 蓋掉；允許少量差異用 `maxDiffPixels` 或 `maxDiffPixelRatio`。
- 畫面確定改版時用 `npx playwright test -u` 更新基準圖，連同程式一起 commit，review 時看圖。

截圖比對抓得到樣式跑掉、元素重疊；它很容易因為無關的改動而失敗，只放在幾個版面穩定、壞了代價高的畫面。

### 本站的 e2e：直接用 playwright 函式庫

本站的 `e2e/*.mjs`（例如 `e2e/ui-quiz.mjs`、`e2e/labs-smoke.mjs`）沒有用 `@playwright/test`，而是 `import { chromium } from 'playwright'` 寫成 Node 腳本：自己 `chromium.launch()`、用 CSS 選擇器與 `page.$eval` 讀資料、自己寫一個 `t(label, ok)` 計數 PASS 與 FAIL，最後用 `process.exit(failed ? 1 : 0)` 回報結果。

| | `@playwright/test` | 函式庫加 Node 腳本（本站的 e2e） |
|---|---|---|
| 斷言 | web-first assertion，自動重試 | 自己 `waitForSelector`、`waitForFunction` 再比較 |
| 平行、重試、逾時 | 設定檔決定 | 自己寫（`labs-smoke.mjs` 自己控制並行數） |
| trace、HTML 報告、截圖比對 | 內建 | 沒有；`ui-metro.mjs` 用 `SHOTS=1` 存截圖給人看 |
| 適合 | 一般的 E2E 測試 | 逐一巡過大量頁面、量測版面這類一次性的檢查腳本 |

這些腳本有一個值得照抄的做法：監聽 `pageerror` 與 `console`，頁面上有未捕捉的錯誤就算失敗。`@playwright/test` 預設不會因為 Console 有紅字而失敗，要自己用 fixture 加上（下面的程式）。

## 實際程式碼

### 設定檔

```js
// playwright.config.js
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,               // CI 上不准留下 test.only
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',                  // 第一次重跑時錄 trace
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: 'npm run build && npm run preview',   // 測建置後的產物
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
})
```

### 讓 Console 錯誤也算失敗的 fixture

```js
// e2e/fixtures.js
import { test as base, expect } from '@playwright/test'

export const test = base.extend({
  page: async ({ page }, use) => {
    const errors = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => {
      const text = m.text()
      if (text.startsWith('Failed to load resource')) return   // route.abort 與 4xx、5xx 造成的，是測試刻意造的
      if (m.type() === 'error' || text.includes('[Vue warn]')) errors.push(`${m.type()}: ${text}`)
    })
    await use(page)                                           // 測試本體在這裡執行
    expect(errors, '頁面上不該有錯誤或 [Vue warn]').toEqual([])
  },
})
export { expect }
```

排除 `Failed to load resource` 那一行是實測後加上的：`route.abort('failed')` 會讓 Chromium 在 Console 印出 `Failed to load resource: net::ERR_FAILED`，不排除的話，每個模擬網路錯誤的測試都會被這個 fixture 判定失敗。`[Vue warn]` 只在開發模式出現，對 `npm run preview` 的建置產物測試時看不到，想抓警告就另外對 dev server 跑一輪。

### 掛號流程

```js
// e2e/booking.spec.js
import { test, expect } from './fixtures.js'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/sessions/*/slots', (route) =>
    route.fulfill({ json: [{ time: '09:00', left: 3 }, { time: '09:30', left: 0 }] }))
  await page.goto('/')
})

test('選時段、送出，顯示掛號號碼', async ({ page }) => {
  let body
  await page.route('**/api/appointments', async (route) => {
    body = route.request().postDataJSON()                    // 順便檢查送出的 body
    await route.fulfill({ status: 201, json: { id: 'A012' } })
  })
  await expect(page.getByRole('radio', { name: /09:30/ })).toBeDisabled()
  await page.getByRole('radio', { name: /09:00/ }).check()
  await page.getByRole('button', { name: '送出掛號' }).click()
  await expect(page.getByRole('status')).toHaveText('已完成掛號，號碼 A012')
  expect(body).toEqual({ sessionId: 's-1120-am', time: '09:00' })
})

test('409：顯示額滿訊息', async ({ page }) => {
  await page.route('**/api/appointments', (route) =>
    route.fulfill({ status: 409, json: { title: '時段已額滿', status: 409 } }))
  await page.getByRole('radio', { name: /09:00/ }).check()
  await page.getByRole('button', { name: '送出掛號' }).click()
  await expect(page.getByRole('status')).toContainText('這個時段剛額滿')
})

test('網路錯誤：顯示載入失敗', async ({ page }) => {
  await page.route('**/api/sessions/*/slots', (route) => route.abort('failed'))   // 覆蓋 beforeEach 的設定
  await page.goto('/')
  await expect(page.getByRole('alert')).toHaveText('時段載入失敗')
})

test('分頁列的結構', async ({ page }) => {
  await expect(page.getByRole('tablist', { name: '掛號狀態' })).toMatchAriaSnapshot(`
    - tablist "掛號狀態":
      - tab "預約" [selected]
      - tab "已報到"
      - tab "已取消"
  `)
})
```

第三個測試在 `beforeEach` 已經註冊過同一個網址之後，再註冊一次 `route.abort`；後註冊的先執行，所以這個測試拿到的是網路錯誤。只用鍵盤完成流程、Dialog 的焦點回復這類測試，寫法見 [元件的鍵盤操作與 ARIA](#/skill/a11y-components)；多種狀態與寬度的驗收測試見 [驗收 AI 產出的前端](#/skill/ai-acceptance)。

### 常用指令

```bash
npx playwright test                         # 全部
npx playwright test e2e/booking.spec.js -g "409" --project=webkit
npx playwright test --ui                    # UI 模式：挑測試跑、看每一步
npx playwright test --debug                 # 開 Inspector 逐步執行
npx playwright test --last-failed           # 只重跑上次失敗的
npx playwright test --repeat-each=10        # 同一支跑十次，找不穩定的測試
npx playwright test -u                      # 更新截圖基準
npx playwright codegen http://localhost:5173   # 操作瀏覽器，產生 locator 與程式碼
npx playwright show-report                  # 打開 HTML 報告
npx playwright show-trace test-results/<測試資料夾>/trace.zip
npx playwright install                      # 下載這個版本對應的瀏覽器
```

## 常見錯誤與錯誤訊息

下列訊息都是在 1.65.1 上實際跑出來的：

| 訊息 | 原因 | 修法 |
|---|---|---|
| `Error: locator.click: Error: strict mode violation: getByRole('tab', { name: /已/ }) resolved to 2 elements:` | locator 對到不只一個 | 照訊息列出的 `aka` locator 改寫，或先縮小範圍 |
| `TimeoutError: locator.click: Timeout 1500ms exceeded.`，Call log 是 `element is not enabled` | 元素是停用的 | 先完成讓它啟用的步驟（例如選時段），或這就是要抓的錯 |
| Call log 裡出現 `<dialog open="">…</dialog> intercepts pointer events` | 有別的元素蓋在上面：Dialog、固定的頁首、Cookie 橫幅 | 先關掉蓋住的東西；若是 bug（手機寬度下按鈕被底部提示列蓋住），修版面 |
| `Test timeout of 30000ms exceeded.`，Call log 只有 `waiting for getByRole('button', { name: '報到' })` | 頁面上沒有這個角色與名稱的元素 | 用 trace 的快照或 `error-context.md` 的 ARIA snapshot 看實際的名稱 |
| `Error: expect(locator).toHaveText(expected) failed`，`Error: Test ended.` | 斷言沒有 `await` | 補 `await`；eslint-plugin-playwright 的 `playwright/missing-playwright-await` 會抓 |
| `Error: expect(locator).toMatchAriaSnapshot(expected) failed`，底下是 `- Expected` 與 `+ Received` 的差異 | 結構或狀態和預期不同 | 讀差異：多了一個 tab、`[selected]` 跑到別的 tab 上 |
| `Error: A snapshot doesn't exist at …-chromium-linux.png, writing actual.` | 第一次跑截圖比對 | 檢查產生的圖，確認後 commit；CI 上要用同一種環境產生 |
| `Error: browserType.launch: Executable doesn't exist at …`，加上 `Looks like Playwright was just installed or updated.` | 沒有下載這個版本的瀏覽器 | `npx playwright install`；CI 上加 `--with-deps` 一併裝系統套件 |
| `Error: expect(locator).toBeFocused() failed`，`Received: inactive` | 焦點不在預期的元素上，常見是掉到 `body` | 見 [元件的鍵盤操作與 ARIA](#/skill/a11y-components) 的焦點回復 |

不會有錯誤訊息、但讓測試不穩的寫法：

- `waitForTimeout(…)`：換成等某個狀態的 `expect`。eslint-plugin-playwright 有 `no-wait-for-timeout`。
- `waitForLoadState('networkidle')`：SPA 有輪詢或長連線時永遠等不到閒置，也不代表畫面已經更新。改成等畫面上的結果；對應的規則是 `no-networkidle`。
- `expect(await locator.isVisible()).toBe(true)`：只檢查一次。改成 `await expect(locator).toBeVisible()`，`prefer-web-first-assertions` 會提醒。
- 測試之間共用資料：前一個測試掛了號，下一個測試的時段就少一個。每個測試用 `page.route` 或各自建立資料，不依賴執行順序。
- 只在 Chromium 跑：WebKit（Safari）的日期欄位、焦點與捲動的細節和 Chromium 不同，關鍵流程至少加一個 webkit 的 project。

## 動手

1. 把專案裡一支用 CSS 選擇器與 `waitForTimeout` 寫的 E2E，改成 `getByRole` 加 web-first assertion，再用 `--repeat-each=10` 跑十次。
2. 用 `npx playwright codegen` 打開自己的網站，點過一次掛號流程，看它產生的 locator 是不是都是 `getByRole`；不是的地方，多半是元件少了名稱。
3. 在設定檔設 `trace: 'retain-on-failure'`，故意把一個斷言寫錯，打開 trace viewer，在失敗那一步看 DOM 快照、Network 與 Console；再打開 `error-context.md` 看裡面的 ARIA snapshot。
4. 用 `page.route` 為同一個畫面造出成功、空陣列、409、500、`route.abort('failed')` 五種回應，各寫一個測試；對照 [API 的四種狀態](#/skill/api-states)。
5. 讀本站的 `e2e/ui-quiz.mjs`，把它改寫成 `@playwright/test` 的版本，比較兩者在等待與斷言上的差別。什麼該寫成 E2E、什麼該留在元件測試，回頭看 [前端測試的分層](#/skill/test-layers)。

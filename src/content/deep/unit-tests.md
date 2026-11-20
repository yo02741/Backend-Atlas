## 從一個具體問題開始：測試全綠，候診時間少算了 5 分鐘

候診看板顯示「前面還有 1 位，約 5 分鐘」，病患去買個飲料回來就過號了。規則是每位 6 分鐘、無條件進位到 5 的倍數，應該顯示 10 分鐘。上個月有人把 `Math.ceil` 改成 `Math.round`，說是「讓數字好看一點」，CI 是綠的。

`estimateWait` 有測試，覆蓋率報告每一欄都是 100：

```js
it('會回傳數字', () => {
  expect(typeof estimateWait(10, 15)).toBe('number')
  expect(() => estimateWait(12, 10)).toThrow()
})
```

同一個專案還有兩個問題：取消期限的測試每天凌晨到早上 8 點之間失敗，上班後重跑又過；搜尋框 debounce 的測試真的 `await` 了 300 毫秒，整個測試檔要跑好幾秒。

三個問題都和「測試怎麼寫」有關：斷言沒有寫出具體的期望值，時間沒有固定，等待用的是真的時鐘。分層的問題（這段該不該寫成單元測試）在 [前端測試的分層](#/skill/test-layers) 講過；這一課只講單元測試本身，元件掛載、user-event 與 MSW 在 [元件測試的寫法](#/skill/component-tests)。

## 運作原理

### 一個測試的形狀

一個測試驗一條規格，分三段：

| 段落 | 做什麼 | 例子 |
|---|---|---|
| Arrange（準備） | 建立輸入、固定時間、建立替身 | `const appt = { date: '2026-11-20', time: '09:00', status: 'booked' }` |
| Act（執行） | 呼叫一次受測函式 | `const result = canCancel(appt)` |
| Assert（斷言） | 寫出具體的期望值 | `expect(result).toBe(true)` |

名稱寫成規格：「看診前 2 小時整：可以取消」「目前 10 號、我是 11 號：約 10 分鐘」。失敗時 Vitest 印出 `describe > it` 的完整名稱，看名稱就知道哪條規則壞了，不用先讀測試程式。一個測試塞五個情境，第一個斷言失敗就停了，後面四個沒跑，報告也只說「canCancel 失敗」。

### Vitest 執行一個測試檔的順序

1. 被 `vi.mock()` 提升（hoist）到檔案最上面的呼叫先執行，再執行 import。
2. 由上而下執行檔案：`describe` 的函式立刻執行，裡面的 `it` 只是登記，還不跑。
3. 依登記順序跑每個 `it`，前後執行 `beforeEach`、`afterEach`。
4. 所有測試跑完，回報結果；期間沒被接住的錯誤列在 `Unhandled Errors`。

第 2 點的後果：寫在 `describe` 裡、`it` 外面的程式在任何測試開始前就跑完了，`vi.useFakeTimers()` 放在那裡等於沒放。要每個測試都做的事放進 `beforeEach`。Vitest 預設 `globals: false`，`describe`、`it`、`expect`、`vi` 都要從 `vitest` import，漏了會出現 `ReferenceError: it is not defined`。

### 比對：`toBe`、`toEqual`、`toStrictEqual`

下表是 Vitest 5.1.1 的實測結果：

| 實際值 | 斷言 | 結果 |
|---|---|---|
| `parseQueueNo('A012')` 回傳的新物件 | `toBe({ prefix: 'A', n: 12 })` | 失敗：兩個不同的物件 |
| 同上 | `toEqual({ prefix: 'A', n: 12 })` | 通過 |
| `{ prefix: 'A', n: 12, note: undefined }` | `toEqual({ prefix: 'A', n: 12 })` | 通過：忽略 `undefined` 屬性 |
| 同上 | `toStrictEqual({ prefix: 'A', n: 12 })` | 失敗 |
| `new QueueNo('A', 12)`（類別實例） | `toEqual({ prefix: 'A', n: 12 })` | 通過：不比類別 |
| 同上 | `toStrictEqual(…)` | 失敗：`QueueNo {` 對 `{` |
| `0.1 + 0.2` | `toBe(0.3)` | 失敗：`expected 0.30000000000000004 to be 0.3` |
| 兩個時間相同的 `Date` | `toEqual(…)` | 通過 |

用 `toBe` 比物件時，訊息會直接提示：

```text
AssertionError: expected { prefix: 'A', n: 12 } to be { prefix: 'A', n: 12 } // Object.is equality

If it should pass with deep equality, replace "toBe" with "toStrictEqual"

Compared values have no visual difference.
```

「no visual difference」代表內容一樣、物件不同。API 回應這類資料用 `toEqual`；要確認沒有多出的 `undefined` 欄位、或回傳的是某個類別，用 `toStrictEqual`。小數用 `toBeCloseTo(0.3)`。

### 錯誤與非同步

`toThrow` 的參數要是函式，Vitest 會在斷言裡呼叫它、接住錯誤：

```js
expect(estimateWait(12, 10)).toThrow(RangeError)        // ✗ 錯誤在 expect 之前就丟出，測試直接失敗
expect(() => estimateWait(12, 10)).toThrow(RangeError)  // ✓
```

`toThrow()` 不帶參數時，丟什麼錯都算通過，連 `TypeError: Cannot read properties of undefined` 這種程式寫錯的錯也算。帶錯誤類別（`RangeError`）、訊息片段（`'已過號'`）或正規表示式，才分得出是哪一條規則擋下來的。

Promise 用 `resolves` 與 `rejects`，前面要 `await`：

```js
await expect(fetchQueue('c1')).resolves.toEqual({ current: 12 })
await expect(fetchQueue('c9')).rejects.toThrow('HTTP 503')
```

少了 `await`，Vitest 5 讓那個測試失敗並說明原因：

```text
Error: Promise returned by `expect(actual).rejects.toThrow(expected)` was not awaited. This assertion is asynchronous and must be awaited; otherwise, it is not guaranteed to complete before the test finishes
```

更難發現的是在 `.then()` 裡斷言、卻沒有 `return` 或 `await`。測試函式先結束、顯示通過，斷言的錯誤之後才發生，變成檔案底部的 `Unhandled Rejection`，而且歸到「最後一個在跑的測試」名下。實測輸出是 `Tests 2 passed (2)` 加上 `Errors 1 error`，指令的結束碼是 1：CI 會失敗，但看測試清單找不到是哪一個。

### 邊界表：`test.each`

一條規則的邊界通常不只一個值。`test.each` 把它們寫成一張表，每一列是一個測試：

```js
test.each([
  { current: 10, mine: 10, expected: 0 },    // 輪到自己
  { current: 10, mine: 11, expected: 10 },   // 6 分鐘進位到 10
  { current: 10, mine: 15, expected: 30 },   // 剛好整除
])('目前 $current 號、我是 $mine 號：約 $expected 分鐘', ({ current, mine, expected }) => {
  expect(estimateWait(current, mine)).toBe(expected)
})
```

名稱裡的 `$current` 換成那一列的值，報告裡是三個測試：「目前 10 號、我是 10 號：約 0 分鐘」等等。陣列寫法（`[[10, 10, 0], …]`）用 `%i`、`%s` 依序代入。選邊界的方法：規則裡每個比較運算子（`<`、`>=`）的兩側各一個值、剛好等於的值、會進位或捨去的值、空值與錯誤的型別。開頭的 `Math.round` 只要表裡有「前面 1 位」那一列就抓得到：`round(6 / 5) * 5` 是 5，`ceil` 是 10。

### 時間：fake timers 與 `setSystemTime`

用到「現在」的函式，最簡單的寫法是讓它收 `now` 參數，測試直接傳一個固定的 `Date`。不能改函式時，用 Vitest 的假時鐘：

| API | 做什麼 |
|---|---|
| `vi.useFakeTimers()` | `setTimeout`、`setInterval`、`Date` 換成假的；計時器不會自己觸發 |
| `vi.advanceTimersByTime(ms)` | 時間往前推 `ms`，期間到期的計時器依序執行 |
| `vi.runAllTimers()` | 跑完所有計時器（`setInterval` 不停時會一直跑到上限） |
| `vi.setSystemTime(date)` | 固定 `new Date()` 與 `Date.now()` 的值 |
| `vi.getTimerCount()` | 還沒觸發的計時器數量，用來檢查有沒有清掉 |
| `vi.useRealTimers()` | 換回真的；放在 `afterEach`，否則下一個測試也是假的 |

debounce 300ms 的測試照時間推：

| 假時鐘 | 操作 | `search` 被呼叫 |
|---|---|---|
| 0 | 輸入「王」，排一個 300ms 的計時器 | 0 次 |
| 200 | 輸入「王小」，清掉舊計時器、重排一個到 500 | 0 次 |
| 499 | | 0 次 |
| 500 | 計時器到期 | 1 次，參數 `'王小'` |

整個測試在 1 毫秒內跑完。取消期限的測試在凌晨失敗，是因為測試用了真的「今天」：測試用 `new Date().toISOString().slice(0, 10)` 組出今天的預約，台灣時間凌晨 0 點到 8 點時 UTC 還是前一天，拿到的是昨天的日期。`vi.setSystemTime(new Date('2026-11-20T07:00:00+08:00'))` 把現在固定在看診前 2 小時整，結果每天都一樣。Vitest 5.1.1 實測，沒呼叫 `vi.useFakeTimers()` 也能用 `vi.setSystemTime()`，這時只有 `Date` 被固定，計時器照常走。

:::stop 讀到這裡可以先停：會寫 `test.each` 邊界表、選對 `toBe` 與 `toEqual`、用 fake timers 測時間。後面的替身、composable、覆蓋率與完整程式，在要測呼叫 API 的程式或確認測試改壞會不會紅時再回來讀。

### 替身：`vi.fn`、`vi.spyOn`、`vi.mock`

| 工具 | 換掉什麼 | 適合 | 代價 |
|---|---|---|---|
| 參數傳入 | 函式需要的依賴（`now`、`fetchQueue`） | 自己寫的函式 | 要改函式的簽名 |
| `vi.fn()` | 一個假函式，記錄每次呼叫的參數 | callback、傳入的依賴 | 幾乎沒有 |
| `vi.spyOn(obj, 'm')` | 物件上既有的方法，可以只監看、也可以換實作 | `console.warn`、`localStorage.setItem` | 測完要 `mockRestore()` |
| `vi.mock('./api.js', factory)` | 整個模組，所有 import 它的地方都拿到替身 | 改不了的模組相依 | 提升到檔案最上面；模組裡的真實邏輯完全沒測到 |

`vi.mock` 被提升到 import 之前執行，所以工廠函式裡不能用外面宣告的變數：

```text
Error: [vitest] There was an error when mocking a module. If you are using "vi.mock" factory, make sure there are no top level variables inside, since this call is hoisted to top of the file.
Caused by: ReferenceError: Cannot access 'fake' before initialization
```

要在工廠裡引用的變數用 `vi.hoisted(() => ({ fake: vi.fn() }))` 建立，它也會被提升。比起 `vi.mock`，先考慮把依賴改成參數：`myWait(clinicId, mine, { fetchQueue })` 的測試不需要任何提升與模組替換。斷言只有 `expect(fetchQueue).toHaveBeenCalled()` 的測試，驗的是替身，不是規則；替身回固定的資料，斷言寫在受測函式的輸出上。

### 測 composable

只用 `ref`、`computed` 的 composable 直接呼叫就能測。用到 `onMounted`、`onUnmounted` 這類生命週期，或 `provide`／`inject` 的，要有元件實例；在測試裡直接呼叫，Vue 會警告：

```text
[Vue warn]: onUnmounted is called when there is no active component instance to be associated with. Lifecycle injection APIs can only be used during execution of setup().
```

兩種做法：Vue 官方文件的 `withSetup` 輔助函式，建一個只有 `setup` 的元件掛載 composable；或者 composable 的清理改用 `onScopeDispose`，測試用 `effectScope()` 包住，`scope.stop()` 就觸發清理。後者不需要 DOM，在 Vitest 預設的 `node` 環境就能跑，元件裡用的時候，元件卸載也會停止它的 scope。

### 覆蓋率與「改壞會不會變紅」

`vitest run --coverage`（要裝 `@vitest/coverage-v8`）列出每個檔案的 Stmts、Branch、Funcs、Lines。開頭那個只檢查 `typeof … === 'number'` 的測試，實測四欄都是 100：每一行都跑過了，只是沒有任何一個值被檢查。覆蓋率回答的是「哪些程式沒跑到」，用來找漏掉的分支；它不回答「測試有沒有驗到」。

回答後者的方法是故意改壞程式，看有沒有測試變紅：把 `<` 改成 `<=`、`Math.ceil` 改成 `Math.round`、刪掉一行檢查。每個改壞的版本叫一個突變體（mutant），有測試失敗叫殺掉（killed），全綠叫存活（survived）。存活的突變體指出測試缺了哪一個邊界。手動做幾次就有感覺；工具是 Stryker，搭配 `@stryker-mutator/vitest-runner`（10.1.1）。原理與報告怎麼讀見後端路線的 [測試品質](#/skill/test-quality)。

## 實際程式碼

### 受測的函式

```js
// src/utils/queue.js
export function estimateWait(current, mine, minutesPerPatient = 6) {
  if (!Number.isInteger(current) || !Number.isInteger(mine)) throw new TypeError('號碼要是整數')
  if (mine < current) throw new RangeError('已過號')
  const minutes = (mine - current) * minutesPerPatient
  return Math.ceil(minutes / 5) * 5              // 無條件進位到 5 分鐘
}

export function cancelDeadline(appt) {           // 看診前 2 小時
  const start = new Date(`${appt.date}T${appt.time}:00+08:00`)
  return new Date(start.getTime() - 2 * 60 * 60 * 1000)
}

export function canCancel(appt, now = new Date()) {
  return appt.status === 'booked' && now <= cancelDeadline(appt)
}

export function debounce(fn, ms) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}
```

### 測試檔

```js
// src/utils/__tests__/queue.spec.js（Vitest 5.1）
import { describe, it, test, expect, vi, afterEach } from 'vitest'
import { estimateWait, cancelDeadline, canCancel, debounce } from '../queue.js'

describe('estimateWait', () => {
  test.each([
    { current: 10, mine: 10, expected: 0 },
    { current: 10, mine: 11, expected: 10 },
    { current: 10, mine: 15, expected: 30 },
  ])('目前 $current 號、我是 $mine 號：約 $expected 分鐘', ({ current, mine, expected }) => {
    expect(estimateWait(current, mine)).toBe(expected)
  })

  it('每位 3 分鐘、前面 5 位：約 15 分鐘', () => {
    expect(estimateWait(10, 15, 3)).toBe(15)
  })

  it('已過號：丟 RangeError', () => {
    expect(() => estimateWait(12, 10)).toThrow(RangeError)
  })

  it('號碼不是整數：丟 TypeError', () => {
    expect(() => estimateWait(10, '15')).toThrow(TypeError)
  })
})

describe('取消期限', () => {
  const appt = { date: '2026-11-20', time: '09:00', status: 'booked' }
  afterEach(() => { vi.useRealTimers() })

  it('期限是看診前 2 小時', () => {
    expect(cancelDeadline(appt)).toEqual(new Date('2026-11-20T07:00:00+08:00'))   // Date 用 toEqual 比時間
  })

  it('看診前 2 小時整：可以取消', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-20T07:00:00+08:00'))
    expect(canCancel(appt)).toBe(true)
  })

  it('期限過了 1 秒：不能取消', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-20T07:00:01+08:00'))
    expect(canCancel(appt)).toBe(false)
  })

  it('已報到：不能取消', () => {
    expect(canCancel({ ...appt, status: 'checked-in' }, new Date('2026-11-19T09:00:00+08:00'))).toBe(false)
  })
})

describe('debounce', () => {
  afterEach(() => { vi.useRealTimers() })

  it('連續輸入：停 300ms 後呼叫一次，參數是最後一次的', () => {
    vi.useFakeTimers()
    const search = vi.fn()
    const onInput = debounce(search, 300)
    onInput('王')
    vi.advanceTimersByTime(200)
    onInput('王小')
    vi.advanceTimersByTime(299)
    expect(search).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledWith('王小')
  })
})
```

`toHaveBeenCalledWith` 失敗時，訊息列出每一次呼叫的參數：

```text
AssertionError: expected "vi.fn()" to be called with arguments: [ '王小明' ]

Received:

  1st vi.fn() call:

  [
-   "王小明",
+   "王",
  ]

Number of calls: 1
```

### 替換 API 模組

```js
// src/board.js
import { fetchQueue } from './api.js'
import { estimateWait } from './utils/queue.js'
export async function myWait(clinicId, mine) {
  const { current } = await fetchQueue(clinicId)
  return estimateWait(current, mine)
}
```

```js
// src/__tests__/board.spec.js
import { it, expect, vi, beforeEach } from 'vitest'
import { myWait } from '../board.js'
import { fetchQueue } from '../api.js'

vi.mock('../api.js', () => ({ fetchQueue: vi.fn() }))   // 提升到 import 之前

beforeEach(() => { vi.mocked(fetchQueue).mockReset() })

it('目前 12 號、我是 15 號：約 20 分鐘', async () => {
  vi.mocked(fetchQueue).mockResolvedValue({ current: 12 })
  await expect(myWait('c1', 15)).resolves.toBe(20)
  expect(fetchQueue).toHaveBeenCalledWith('c1')
})
```

沒有 mock 時，測試會真的送出請求，在 Node 裡失敗成 `promise rejected "TypeError: fetch failed" instead of resolving`。

### 測 composable

```js
// src/composables/useCountdown.js：報到倒數
import { ref, computed, onScopeDispose } from 'vue'
export function useCountdown(seconds) {
  const left = ref(seconds)
  const timer = setInterval(() => {
    left.value = Math.max(0, left.value - 1)
    if (left.value === 0) clearInterval(timer)
  }, 1000)
  onScopeDispose(() => clearInterval(timer))   // 元件卸載或 scope.stop() 時清掉
  return { left, expired: computed(() => left.value === 0) }
}
```

```js
// src/composables/__tests__/useCountdown.spec.js
import { it, expect, vi, afterEach } from 'vitest'
import { effectScope } from 'vue'
import { useCountdown } from '../useCountdown.js'

afterEach(() => { vi.useRealTimers() })

it('每秒減 1，到 0 停住並標記 expired', () => {
  vi.useFakeTimers()
  const scope = effectScope()
  const { left, expired } = scope.run(() => useCountdown(3))
  vi.advanceTimersByTime(2000)
  expect(left.value).toBe(1)
  vi.advanceTimersByTime(5000)
  expect(left.value).toBe(0)
  expect(expired.value).toBe(true)
  expect(vi.getTimerCount()).toBe(0)           // 歸零後自己清掉
  scope.stop()
})

it('scope 停止時清掉計時器', () => {
  vi.useFakeTimers()
  const scope = effectScope()
  scope.run(() => useCountdown(60))
  expect(vi.getTimerCount()).toBe(1)
  scope.stop()
  expect(vi.getTimerCount()).toBe(0)
})
```

### 覆蓋率門檻與突變測試

```js
// vitest.config.js（節錄）
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,vue}'],
      thresholds: { lines: 80, branches: 80 },   // 低於門檻時 vitest run --coverage 失敗
    },
  },
})
```

`stryker.config.json`，用 `npx stryker run` 執行：

```json
{
  "testRunner": "vitest",
  "mutate": ["src/utils/**/*.js"],
  "reporters": ["clear-text", "html"]
}
```

### 在瀏覽器裡改壞一次

下面這段不用任何框架：同一組斷言先跑正確版，再跑三個改壞的版本，印出哪些被抓到。把 `checks` 裡「前面 1 位」那一行刪掉再執行，看 `Math.round` 那個變成存活：

```js run
const correct = (current, mine, per = 6) => {
  if (mine < current) throw new RangeError('已過號')
  return Math.ceil(((mine - current) * per) / 5) * 5
}
const mutants = {
  '< 改成 <=': (current, mine, per = 6) => {
    if (mine <= current) throw new RangeError('已過號')
    return Math.ceil(((mine - current) * per) / 5) * 5
  },
  'ceil 改成 round': (current, mine, per = 6) => {
    if (mine < current) throw new RangeError('已過號')
    return Math.round(((mine - current) * per) / 5) * 5
  },
  '忽略 per': (current, mine) => {
    if (mine < current) throw new RangeError('已過號')
    return Math.ceil(((mine - current) * 6) / 5) * 5
  },
}

// 每一條：[名稱, 呼叫, 預期值]
const checks = [
  ['輪到自己', (f) => f(10, 10), 0],
  ['前面 1 位', (f) => f(10, 11), 10],
  ['前面 5 位', (f) => f(10, 15), 30],
  ['每位 3 分鐘', (f) => f(10, 15, 3), 15],
]

function failures(f) {
  const failed = []
  for (const [name, call, want] of checks) {
    let got
    try { got = call(f) } catch (e) { got = e.name }
    if (got !== want) failed.push(`${name}（得到 ${got}，預期 ${want}）`)
  }
  return failed
}

console.log('正確版：', failures(correct).length ? failures(correct) : '全部通過')
for (const [name, f] of Object.entries(mutants)) {
  const failed = failures(f)
  console.log(`${name}：`, failed.length ? `殺掉，失敗的檢查 ${failed.join('、')}` : '存活，沒有任何檢查失敗')
}
```

## 常見錯誤與錯誤訊息

| 訊息或現象 | 原因 | 修法 |
|---|---|---|
| `ReferenceError: it is not defined` | 預設 `globals: false`，沒有 import | `import { describe, it, expect, vi } from 'vitest'` |
| `expected {…} to be {…} // Object.is equality`，下面寫 `Compared values have no visual difference.` | 用 `toBe` 比兩個不同的物件 | 改 `toEqual` 或 `toStrictEqual` |
| `toThrow` 的測試失敗，錯誤訊息是受測函式自己丟的錯 | `expect(f())` 沒包成函式 | `expect(() => f())` |
| `Promise returned by \`expect(actual).rejects.toThrow(expected)\` was not awaited` | `resolves`／`rejects` 前面沒 `await` | 加 `await` |
| `Tests 2 passed` 但底部有 `Unhandled Rejection`、結束碼 1，錯誤歸到不相干的測試 | `.then()` 裡的斷言沒有 `return` 或 `await`，測試先結束了 | 改成 `await`，或回傳那個 Promise |
| `expected "vi.fn()" to be called 1 times, but got 0 times` | 用了 fake timers 卻沒推時間，或推得不夠 | `vi.advanceTimersByTime(ms)` |
| 測試在某些時段或時區失敗 | 用了真的「現在」 | `now` 參數或 `vi.setSystemTime()` |
| 後面的測試莫名其妙逾時或時間不對 | 上一個測試的 fake timers 沒換回來 | `afterEach(() => vi.useRealTimers())` |
| `There was an error when mocking a module…` 與 `Cannot access '…' before initialization` | `vi.mock` 的工廠用了外面的變數 | `vi.hoisted()`，或改成參數注入 |
| `[Vue warn]: onUnmounted is called when there is no active component instance` | 在測試裡直接呼叫用到生命週期的 composable | `withSetup`，或 `onScopeDispose` 加 `effectScope()` |
| 覆蓋率 100%，改壞程式仍然全綠 | 斷言沒有具體的期望值 | 每條規則寫出值；故意改壞一次確認會變紅 |
| 在 AI 寫程式工具裡跑，看不到 `console.log` 與 `[Vue warn]` | Vitest 5.1.1 偵測到 `AI_AGENT`、`CLAUDECODE` 這類環境變數時改用精簡輸出，實測通過的測試不印 console | 要看輸出時在一般終端機執行 |

## 動手

1. 做程式題「替候診時間估算寫測試」：函式是對的，你寫的測試要讓正確版全過、四個改壞的版本各至少一個失敗。起始碼的兩個測試一個都抓不到，從檢查器說的存活版本反推缺了哪個邊界。
2. 做程式題「用 fake timers 測 debounce」：五個改壞的版本各要一個會讓它露餡的操作順序，照上面的時間表推。
3. 在上面的 run 區塊裡刪掉一條檢查、或加一個新的突變體（例如拿掉 `RangeError`），看哪個變成存活。
4. 在自己的專案找一個只斷言 `toBeDefined()`、`toBeTruthy()` 或 `typeof` 的測試，改寫成具體的值，再把受測函式改壞一次確認會失敗。
5. 讀 [元件測試的寫法](#/skill/component-tests)，把同一套「準備、執行、斷言」用在元件上；把驗收條件寫成測試的流程見 [規範變成測試](#/skill/ai-spec-to-tests)。

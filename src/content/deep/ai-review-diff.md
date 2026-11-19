## 從一個具體問題開始：「修掉清單閃爍」改了 14 個檔案

交給 AI 的任務是：「今日門診清單每 30 秒重新整理時會閃一下，修掉。」交回來的分支，`git diff --stat` 最後一行是 `14 files changed, 612 insertions(+), 380 deletions(-)`。一個一個看：

- 真正的修正只有三行：Skeleton 原本綁在 `isFetching`，改成 `isPending`。
- `package.json` 與 `package-lock.json`：新增了 `lodash-es`，只為了用一個 `debounce`。
- `vite.config.ts`：改了 `server.proxy` 的設定，說明裡沒有提到。
- `src/api/schema.d.ts`：手動加了一個欄位。這是產生的檔案，下次產生就會消失。
- `AppointmentList.spec.ts`：一個期望值從 3 列改成 2 列，另一個測試加了 `.skip`。
- `useAppointments.ts`：多了一個空的 `catch {}`，請求失敗時什麼都不顯示。
- `AppointmentPage.vue`：從 420 行變成 700 行，順手「整理」了大半個檔案，搬移和修改混在一起。

逐行從第一個檔案讀起，讀到第三個檔案就累了，`.skip` 很可能被略過。審查要有順序：先看範圍，再看最容易藏問題的地方，最後才讀邏輯。

## 由外往內的順序

### 1. 範圍：改了哪些檔案、各多少

```bash
git log --oneline main..HEAD          # 這個分支有哪些 commit
git diff --stat main...HEAD           # 每個檔案增刪幾行
git diff --name-status main...HEAD    # A 新增、M 修改、D 刪除、R 改名
```

三個點（`main...HEAD`）比的是「從分支岔出去的那一點」到 `HEAD`，只看這個分支的改動；兩個點的 `git diff main..HEAD` 等於直接比兩個分支的最新狀態，`main` 之後合進去的別人的改動也會混進來。

看到下面這些檔案，先問原因，不用讀內容就能決定要不要退回：

| 檔案 | 要問什麼 |
|---|---|
| `package.json`、`package-lock.json` | 為什麼要新套件？專案裡有沒有現成的做法？ |
| `vite.config.ts`、`tsconfig.json`、`eslint.config.js` | 為什麼改設定？是不是為了讓某個錯誤消失？ |
| 產生的檔案（`schema.d.ts`） | 產生的檔不能手改，應該改規格再重新產生 |
| 測試檔 | 見下一步 |
| 和任務無關的元件 | 是順手重構，還是改壞了什麼才跟著改？ |

任務只需要改一個元件，diff 卻動了十幾個檔案時，退回並要求縮小範圍，比逐一審查快。

### 2. 測試：最先懷疑的地方

```bash
git diff main...HEAD -- '*.spec.ts' '*.test.ts'
```

讓測試變綠最快的方法是改測試。逐一確認：

- 被刪掉的測試或 `expect`。
- 新出現的 `.skip`、`.only`、`.todo`。
- 期望值被改掉，例如 `toHaveLength(3)` 變成 `toHaveLength(2)`；要說得出為什麼規格變了。
- 整批更新的 snapshot：`-u` 一次更新幾十個 snapshot，裡面可能夾著一個不該變的畫面。

期望值有變，代表行為有變。這要在描述裡說明，不能只出現在 diff 裡。規範要變成測試、測試是不能被改壞的契約，見 AI 路線的 [規範要變成測試](#/skill/ai-spec-to-tests)。

### 3. 繞過檢查

在新增的行裡找讓工具閉嘴的寫法：

```bash
git diff main...HEAD | grep -nE '^\+.*(as any|as unknown as|@ts-ignore|@ts-expect-error|eslint-disable|\.skip\(|\.only\(|catch \{\s*\})'
```

| 寫法 | 蓋掉了什麼 |
|---|---|
| `as any`、`as unknown as X` | 型別錯誤，常常是欄位對不上 API |
| `// @ts-ignore` | 下一行的任何型別錯誤 |
| `// eslint-disable-next-line` | 下一行的 lint 錯誤，例如 `vue/no-v-html` |
| `!`（非空斷言） | 「這裡可能是 `null`」的提醒 |
| `catch {}` 或只有 `console.log` 的 `catch` | 錯誤；畫面停在 loading 或空白 |

每一處都要有說得出的理由，沒有就要求移除並修正原本的錯誤。

### 4. 過時的寫法

模型常寫出已經有原生替代的舊做法。審查時順便看：

| 舊寫法 | 現在的做法 |
|---|---|
| `div` 加 `z-index: 9999` 做的 Dialog、自己寫的焦點陷阱 | `<dialog>` 的 `showModal()`（見 [浮層](#/skill/overlays)） |
| 為了浮層裝定位套件、算 `z-index` | `popover` 屬性與 top layer |
| `height: 100vh` 的全螢幕版面 | `100dvh` |
| 依視窗寬度切換卡片內部排法 | container query |
| 為了 `debounce`、日期格式裝新套件 | 專案現有的工具、`Intl.DateTimeFormat` |

這些不一定是錯，要看專案的瀏覽器目標；規範檔寫明目標，審查時才有標準（見 [給 AI 的專案規範](#/skill/ai-project-rules)）。Chrome 團隊的 Modern Web Guidance 有 `legacy-scan` 指令可以掃描一部分舊寫法，掃描結果仍要逐條確認。

### 5. 行為：對照任務與驗收條件

範圍與測試都沒問題了，才逐段讀邏輯。讀的時候拿著任務描述與驗收條件：每一段改動對應哪一條？有沒有改動找不到對應（多做的）、有沒有條件找不到改動（沒做的）？

幾個讓 diff 好讀的選項：

| 指令 | 用途 |
|---|---|
| `git diff -w` | 忽略空白的差異；格式化工具改了縮排時，只看實際的改動 |
| `git diff --word-diff` | 以字為單位標出差異，適合文案與長行 |
| `git diff --color-moved=zebra` | 搬移的程式碼用另一種顏色標出，剩下的才是真的改了 |
| `git show <commit> --stat` | 一個 commit 一個 commit 看 |

### 6. 跑一次

讀懂不等於能動。照專案規範的交付前指令自己跑一次（lint、型別檢查、測試、build），再到瀏覽器照驗收條件操作，見 [驗收 AI 產出的前端](#/skill/ai-acceptance)。

### 分段收下

改動裡一部分是好的、一部分不是時，可以只收好的部分：

```bash
git add -p src/components/AppointmentList.vue   # 每一段問一次：y 收、n 不收、s 再切小、q 結束
git commit -m "fix: 背景重新整理時保留清單，不顯示 Skeleton"
git restore src/components/AppointmentList.vue  # 丟掉沒收的部分（未 commit 的改動會消失）
```

在 GitHub 的 PR 上，Files changed 每個檔案都有 Viewed 可以勾，看過的收起來，沒勾的就是還沒審。看不懂的段落，請 AI 解釋或改寫成看得懂的樣子再收。

## 元件越寫越大時

AI 傾向在現有的檔案裡加東西。幾輪之後，一個 SFC 同時管清單的請求、篩選表單、取消 Dialog、分頁與 Toast，700 行裡有十幾個 `ref` 與三個 `watch`。徵兆：

- 模板或 script 區塊很長；可以用 `vue/max-lines-per-block` 設上限，超過就警告。
- props 很多；`vue/max-props` 可以設上限。
- 一段邏輯只有某一塊畫面在用，卻和其他狀態放在一起。
- 改一個地方，要捲過好幾個不相關的區塊。

拆的順序：先鎖住行為，再一步一步拆，每一步都跑測試、各自一個 commit。

### 第一步：特徵測試

特徵測試（characterization test）記錄元件**現在**的行為，不論它對不對。拆完之後同一組測試仍要通過，才知道拆分沒有改變行為。

```ts
// AppointmentPage.spec.ts（Vitest 加 Vue Test Utils）
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AppointmentPage from './AppointmentPage.vue'

const rows = [
  { id: 501, number: 3, status: 'booked' },
  { id: 502, number: 4, status: 'checked_in' },
]

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: rows, next_cursor: null }), {
    headers: { 'Content-Type': 'application/json' },
  })))
})

describe('AppointmentPage（拆分前的行為）', () => {
  it('顯示每一筆預約', async () => {
    const w = mount(AppointmentPage)
    await flushPromises()
    expect(w.findAll('[data-test="appointment-row"]')).toHaveLength(2)
  })

  it('改篩選條件時，送出帶 status 的請求', async () => {
    const w = mount(AppointmentPage)
    await flushPromises()
    await w.get('[data-test="filter-status"]').setValue('booked')
    await flushPromises()
    expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining('status=booked'), expect.anything())
  })

  it('已報到的那一筆沒有取消按鈕', async () => {
    const w = mount(AppointmentPage)
    await flushPromises()
    const second = w.findAll('[data-test="appointment-row"]')[1]
    expect(second.find('[data-test="cancel"]').exists()).toBe(false)
  })
})
```

測試用 `data-test` 屬性找元素，拆元件、改 class 時不會跟著壞。

### 第二步以後：一次拆一塊

1. 把篩選的狀態與「條件變了就重抓」的邏輯抽成 `useAppointmentFilters()`。跑測試，commit。
2. 把取消確認抽成 `CancelDialog.vue`（props：`appointment`；emits：`confirm`、`close`）。跑測試，commit。
3. 把每一列抽成 `AppointmentRow.vue`。跑測試，commit。

每個 commit 只有搬移與接線，不改行為；`git diff --color-moved=zebra` 看起來應該大部分是搬移的顏色。發現 bug 時記下來，等拆完再用另一個 commit 修，並補一個會失敗的測試。元件之間的 props 與 emits 怎麼切，見 [先拆元件再寫](#/skill/component-breakdown)。

## 要求 AI 怎麼交回改動

把審查需要的東西寫進任務，交回來的東西就好審：

- 範圍：要改的檔案、不能動的檔案（設定、lock 檔、產生的檔、測試的期望值）。
- 大小：一次一件事；重構與行為改變分成不同 commit。
- 回報：每個 commit 的 `git diff --stat`、跑過的指令與最後幾行輸出、刻意沒做的事。

這些也可以寫進專案規範檔，見 [給 AI 的專案規範](#/skill/ai-project-rules)。

## 常見錯誤

- **從第一個檔案開始逐行讀**：最重要的問題（新套件、被跳過的測試）可能在第十個檔案。先看 `--stat` 與測試的 diff。
- **測試全綠就收**：測試可能被改過。綠燈之前先看測試的 diff。
- **一次收下整個分支**：好的修正和不相關的重構綁在一起，日後要 revert 其中一部分很困難。用 `git add -p` 或要求拆成幾個 commit。
- **重構時順手修 bug**：行為改變藏在搬移裡，特徵測試的期望值跟著改，就看不出哪裡變了。先拆、再修，分開 commit。
- **沒有測試就拆元件**：拆完畫面看起來一樣，送出的請求或某個邊界狀態卻變了。先寫特徵測試。
- **用 `git diff main..HEAD`（兩個點）審查**：`main` 上別人新合進來的改動也會出現在 diff 裡，看起來像這個分支刪掉了它們。審查用三個點。

## 動手

1. 拿最近一次 AI 交回的改動，照六個步驟審一次：`--stat`、測試的 diff、繞過檢查的 grep、過時的寫法、對照任務讀邏輯、自己跑一次。記下每一步花的時間與發現。
2. 在自己的專案設定 `vue/max-lines-per-block`，找出超過上限的元件，挑一個寫特徵測試。
3. 用 `git add -p` 把一個混在一起的改動拆成「修正」與「重構」兩個 commit。
4. 把「不能動的檔案」與「回報要附的東西」寫進專案規範檔，下一次交給 AI 時比較兩次的 diff。

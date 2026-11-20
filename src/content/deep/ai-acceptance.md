## 從一個具體問題開始：「全部完成，測試都通過」

「今日門診」頁交給 AI 做，產出最後一段寫著：「已完成所有需求，並新增了元件測試，全部通過。」附的截圖也和描述一致。合併之後一天內陸續發現：

- CI 的 `npm run build` 失敗：型別錯誤，`vue-tsc` 從來沒跑過。
- 測試檔裡只有一個測試：`expect(wrapper.exists()).toBe(true)`。元件掛得起來就通過，內容對不對都不檢查。
- 診間沒有預約時畫面一片空白，描述裡寫的「這個診間今天沒有預約」沒有做。
- 手機上可以左右滑，表格比螢幕寬。
- 報到的確認 Dialog 按 Esc 關不掉，關掉之後焦點跑到頁面最上方。
- 每次進頁面，Network 分頁裡 `/api/appointments` 都出現兩次：`onMounted` 抓了一次，`immediate: true` 的 watch 又抓一次。

產出說「完成」是產出的說法。驗收要用自己的眼睛與工具，照固定的順序，每一條留下證據。

## 運作原理

### 驗收的固定順序

| 順序 | 做什麼 | 工具 | 沒過就 |
|---|---|---|---|
| 1 | 自動檢查：lint、型別、測試、建置 | `npx eslint .`、`npx vue-tsc --noEmit`、`npx vitest run`、`npm run build` | 退回，不用往下 |
| 2 | 狀態巡禮：每個區塊的每個狀態都親眼看到 | DevTools 的 Network 分頁、mock | 列出缺的狀態退回 |
| 3 | 三個寬度：390、768、1280 | 裝置模式 | 截圖退回 |
| 4 | 只用鍵盤走一遍主要流程 | Tab、Shift+Tab、Enter、Space、Esc | 寫下卡住的那一步 |
| 5 | Console 與 Network | Console、Network 分頁 | 貼上警告與多餘的請求 |
| 6 | 把驗收步驟寫成測試，確認它會失敗 | Playwright | 補測試 |

先跑便宜的：第 1 步幾十秒就有結果，擋下的錯不用花時間進瀏覽器看。第 2 到第 5 步要人在瀏覽器裡操作，這些錯讀程式很難看出來。第 6 步讓這次的驗收在下一次改動時自動再跑一遍。這些檢查在 CI 裡怎麼設成閘門，見 [AI 改程式的品質閘門](#/skill/ai-quality-gates)。

### 從描述到驗收清單

[把畫面描述成文字](#/skill/describe-ui) 的每一段描述，都對應一條以上能檢查的條件。描述寫得具體，清單幾乎可以照抄：

| 描述 | 驗收條件 | 怎麼看 |
|---|---|---|
| 載入中顯示 5 列 Skeleton | 請求進行中看得到 5 列 Skeleton，容器有 `aria-busy="true"` | 節流 `3G`，Elements 分頁 |
| 沒有預約顯示「這個診間今天沒有預約」 | 回空陣列時出現這段文字，不是空白 | mock 回 `[]` |
| 失敗顯示 inline Alert 與「重試」 | 回 500 或離線時出現，按「重試」多一筆請求 | `Offline`、mock 回 500 |
| 切換診間時網址的 `clinic` 跟著變 | 切換後重新整理，停在同一個診間 | 網址列、F5 |
| 390px 時表格改成卡片 | 沒有水平捲軸，看得到卡片 | 裝置模式、Console |
| 報到用確認 Dialog | Esc 關閉，關閉後焦點回到「報到」按鈕 | 鍵盤 |

描述裡沒有的，清單也不會有。驗收時發現某個行為沒得對照（例如「報到失敗怎麼辦」），代表描述漏了，補進描述，下一次就有。

### 造出每個狀態

成功的畫面最容易出現，也最容易做對。其他狀態要刻意造出來：

| 狀態 | 造法 |
|---|---|
| loading | Network 分頁的節流選 `3G`，或 mock 延遲回應 |
| empty | 測試資料清空，或 mock 回 `[]`；Chrome 可以在請求上按右鍵選 `Override content` 改回應內容 |
| error：網路 | 節流選 `Offline`，或在請求上按右鍵選 `Block request URL` |
| error：4xx、5xx | 後端的測試資料，或 mock 回對應的狀態碼 |
| 送出中、重複點擊 | 節流 `3G` 之後連按 |
| 很長的資料 | 換上最長的姓名、30 筆以上的清單 |

在瀏覽器裡造不出某個狀態，就是還沒驗收那個狀態。Playwright 的 `page.route` 能在測試裡穩定地造出每一種回應，下面的程式就用它。

### 寬度與鍵盤

**寬度**：裝置模式切到 390、768、1280，各看一次。390 時在 Console 執行 `document.documentElement.scrollWidth > innerWidth`，得到 `true` 代表有水平捲軸。順便看文字有沒有被截斷、按鈕夠不夠大、固定在底部的按鈕有沒有蓋住內容。

**鍵盤**：手離開滑鼠，只用 Tab、Shift+Tab、Enter、Space、Esc 完成主要流程：

- 每一步都看得到焦點在哪裡（`:focus-visible` 的外框沒有被 `outline: none` 拿掉）。
- Tab 的順序和畫面的閱讀順序一致。
- 用 `<div @click>` 做的按鈕，Tab 跳不到、Enter 按不動。
- Dialog 打開時焦點進到 Dialog 裡，Esc 關閉，關閉後焦點回到開啟它的按鈕。

這兩項是 AI 產出最常漏的，也是讀程式最難看出來的。鍵盤與焦點的規則見 WCAG 2.2 的 Keyboard 與各元件在 WAI-ARIA Authoring Practices 的 Patterns。

### Console 與 Network 是證據

操作一輪之後：

- Console 沒有紅字、沒有 `[Vue warn]`。`[Vue warn]` 常見的幾種與原因見 [AI 寫前端的常見錯誤](#/skill/ai-common-mistakes)。
- Network 分頁裡，每個操作只有預期的請求：進頁面一筆、按重試多一筆、換條件時舊的請求 `(canceled)`。同一個 GET 出現兩次，多半是 `onMounted` 與 `immediate: true` 的 watch 各抓了一次。
- 請求帶的參數、狀態碼與描述一致。

### 證據

「看過了，沒問題」不是證據。能留下來、別人可以重看的才是：指令的輸出、每個狀態與寬度的截圖、Network 分頁匯出的 HAR 或截圖、Playwright 的報告與 trace。要求產出也附上證據：貼出指令的實際輸出，而不是「測試都通過」一句話。驗收的設計原則與「寫程式的人不能自己判定完成」，見 [驗收設計](#/skill/acceptance-design)。

### 測試要會失敗才算數

產出附的測試全部通過，不代表它檢查了什麼。開頭那個 `expect(wrapper.exists()).toBe(true)`，元件內容全錯也會通過。檢查方法：故意把元件改壞，例如拿掉 empty 狀態的那段模板、把「報到」按鈕的事件刪掉，再跑一次測試。測試要變紅；還是綠的，那個測試沒有在檢查這件事。

## 實際程式

### 交付前的指令

```bash
npx eslint .                 # eslint-plugin-vue 的規則：v-for 的 key、改 props、Vue 2 寫法
npx vue-tsc --noEmit         # 型別：不存在的 prop、拼錯的欄位、import 不到的函式
npx vitest run               # 單元與元件測試
npm run build                # 建置：路徑大小寫、建置目標不支援的語法
npx playwright test          # E2E：下面這支
```

五個指令都要附上最後幾行的輸出。任何一個沒跑或失敗，就停在第 1 步。

:::stop 讀到這裡可以先停：會照固定順序驗收一份產出：自動檢查、造出每個狀態、寬度與鍵盤、Console 與 Network。後面的 Playwright 寫法，在同一份驗收要重複做好幾次時再回來讀。

### Playwright：把驗收步驟寫成測試

```ts
// e2e/today-clinic.spec.ts
import { test, expect, type Page, type Route } from '@playwright/test'

const rows = [
  { id: 501, time: '09:00', patientName: '王○明', status: 'booked' },
  { id: 502, time: '09:15', patientName: '陳○華', status: 'checked_in' },
]

// 每個測試用 page.route 決定 API 回什麼，不依賴後端的資料
async function mockAppointments(page: Page, reply: Parameters<Route['fulfill']>[0]) {
  await page.route(/\/api\/appointments\?/, (route) => route.fulfill(reply))
}

test('有資料時顯示表格', async ({ page }) => {
  await mockAppointments(page, { json: rows })
  await page.goto('/?date=2026-11-20&clinic=101')
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.getByRole('row')).toHaveCount(3)          // 表頭 1 列加資料 2 列
})

test('沒有資料時顯示空狀態', async ({ page }) => {
  await mockAppointments(page, { json: [] })
  await page.goto('/?date=2026-11-20&clinic=101')
  await expect(page.getByText('這個診間今天沒有預約')).toBeVisible()
})

test('失敗時顯示錯誤與重試，重試會重送', async ({ page }) => {
  let calls = 0
  await page.route(/\/api\/appointments\?/, (route) => {
    calls++
    return route.fulfill({ status: 500, json: { title: 'Internal Server Error', status: 500 } })
  })
  await page.goto('/?date=2026-11-20&clinic=101')
  await expect(page.getByRole('alert')).toContainText('無法載入預約')
  await page.getByRole('button', { name: '重試' }).click()
  await expect.poll(() => calls).toBe(2)
})

for (const width of [390, 1280]) {
  test(`${width}px 沒有水平捲軸`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await mockAppointments(page, { json: rows })
    await page.goto('/?date=2026-11-20&clinic=101')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    expect(overflow).toBe(false)
  })
}

test('只用鍵盤完成報到', async ({ page }) => {
  await mockAppointments(page, { json: rows })
  await page.route('**/api/appointments/501/check-in', (route) =>
    route.fulfill({ json: { ...rows[0], status: 'checked_in' } }))
  await page.goto('/?date=2026-11-20&clinic=101')
  const checkIn = page.getByRole('button', { name: '報到' })
  await checkIn.focus()                                          // 實際驗收時從頁面頂端一路 Tab 過來
  await page.keyboard.press('Enter')                             // 開啟確認 Dialog
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')                            // Esc 關閉
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(checkIn).toBeFocused()                            // 焦點回到開啟它的按鈕
  await page.keyboard.press('Enter')
  await page.getByRole('dialog').getByRole('button', { name: '確定' }).press('Enter')
  await expect(page.getByRole('row', { name: /王○明/ })).toContainText('已報到')
})
```

這些測試用的是角色與文字（`getByRole`、`getByText`），和使用者看到的一致；改了 class 名稱或 DOM 結構不會讓測試壞掉，拿掉了「重試」按鈕則會。`page.route` 讓每種狀態都能穩定重現，不用等後端出問題。

寫完後做一次「會不會失敗」的檢查：把 `AppointmentTable.vue` 裡 empty 狀態那段刪掉，`沒有資料時顯示空狀態` 要變紅；把 Dialog 的 Esc 處理拿掉，鍵盤那個測試要變紅。

## 常見錯誤

| 現象 | 原因 | 修法 |
|---|---|---|
| 產出說「測試都通過」，CI 卻失敗 | 指令沒有跑過，或只跑了一部分 | 要求貼上實際輸出，自己再跑一次 |
| 測試全綠，功能是壞的 | 測試只檢查元件掛得起來（`exists()`、`toBeTruthy()`） | 故意改壞程式，確認測試會失敗 |
| 只驗了成功的畫面 | 沒有刻意造出其他狀態 | 照狀態表逐一造出來 |
| 合併後才發現手機版壞掉 | 只在桌機寬度看過 | 390、768、1280 是固定項目 |
| 鍵盤使用者卡在 Dialog 裡或找不到焦點 | 沒有只用鍵盤走過一遍 | 固定項目；寫成 Playwright 測試 |
| 進頁面同一個 API 打兩次 | `onMounted` 與 `immediate: true` 的 watch 都抓了 | 只留一個；Network 分頁數請求數 |
| Console 有 `[Vue warn]` 但沒人看 | 只看畫面 | 驗收的第 5 步；必要時在 E2E 裡收集 Console 訊息並斷言為空 |
| 驗收時發現沒得對照的行為 | 描述漏了 | 補進描述與驗收清單，再請 AI 修 |
| 測試依賴後端的真實資料，時好時壞 | 資料每天在變 | 用 `page.route` 或 MSW 固定回應 |

## 動手

1. 拿 [把畫面描述成文字](#/skill/describe-ui) 寫好的一份描述，照上面的表轉成驗收清單，每條寫上「怎麼看」。
2. 對一份 AI 產出照六個步驟驗收一次，記下每一步花了多久、擋下了什麼。
3. 把上面的 Playwright 測試改成自己的畫面，逐一把元件改壞，確認每個測試都會變紅。
4. 驗收之前，先讓描述與元件拆分清楚：見 [給截圖與線框](#/skill/wireframes-screenshots) 與 [先拆元件再寫](#/skill/component-breakdown)。

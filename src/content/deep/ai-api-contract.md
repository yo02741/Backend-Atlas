## 從一個具體問題開始：本機一切正常，接上後端一半空白

給 AI 的需求是「做『我的掛號』清單，每筆顯示日期、時段、醫師、狀態，可以取消，要分頁」。產出包含元件、composable 與一組 mock 資料，本機跑起來畫面完整。接上 companion 的 clinic-api 之後：

- 日期、時段、醫師三欄全部空白。程式讀的是 `appt.date`、`appt.period`、`appt.doctor.name`；`AppointmentOut` 的欄位是 `id`、`session_id`、`patient_id`、`number`、`status`、`created_at`。
- 狀態全部顯示「未知」。程式比對的是 `'BOOKED'`，API 回的是小寫的 `booked`。
- 分頁送的是 `?page=2&pageSize=20`，讀的是 `total`；API 是 cursor 分頁，參數是 `cursor` 與 `limit`，回應是 `next_cursor`。
- 取消超過期限時，畫面顯示 `undefined`。程式讀 `err.message`，API 回的是 Problem Details，文字在 `detail`。

mock 資料是同一個模型寫的，形狀和它猜的程式一致，所以本機每個測試都通過。模型沒有拿到契約，就用最常見的命名把空白補上；它補得很像，像到要接上真的後端才發現。

## 模型怎麼補上沒給的東西

描述裡沒有寫的欄位、參數、錯誤格式，模型只能依它看過的大量程式碼補一個「常見的寫法」：清單叫 `items` 或 `data`、分頁用 `page` 與 `total`、狀態用大寫、錯誤讀 `message`。這些猜測各自都合理，和你的 API 對不對得上是另一回事。

兩件事讓問題更難發現：

- **mock 和程式出自同一個猜測**：讓 AI 順便寫 mock，mock 會符合它自己猜的形狀，測試全綠。
- **`any` 讓型別檢查失效**：`res.json()` 的型別是 `any`，沒有接上產生的型別時，`vue-tsc` 看不出欄位不存在。

解法是把契約放進 context，並要求模型只用契約裡的東西。

## 要給的六樣東西

| 給什麼 | 從哪裡來 | 解決什麼 |
|---|---|---|
| 型別檔或規格節錄 | `src/api/schema.d.ts`（見 [從 OpenAPI 產生型別與 client](#/skill/openapi-types)），或 OpenAPI 裡相關的 operation 與 schema | 欄位名、型別、哪些會是 `null` |
| 範例回應 | 後端的測試資料、Network 分頁的 Response | 實際長相；尤其是空的、錯的那幾種 |
| 錯誤格式 | 後端的錯誤處理（clinic-api 是 `clinic/api/errors.py`） | 錯誤 body 的形狀與要顯示的欄位 |
| 欄位語意 | 後端工程師、領域文件 | 列舉值與顯示文字、序號的意思、時區 |
| 共用行為 | 前端的 `src/api/client.ts` | token、401、逾時已經處理，元件不用重寫 |
| 限制與缺口規則 | 自己寫 | 只用列出的欄位；缺的列出來，不補 |

### 規格節錄的範圍

規格很大時不用整份貼上，給這次用到的 operation，以及它們 `$ref` 指到的 schema；少了被引用的 schema，模型又會開始猜。專案裡已經有產生的型別檔時，直接指出檔案路徑與要用的型別名稱（`components['schemas']['AppointmentPage']`），比貼 YAML 精確。

### 規格本身也可能不完整

clinic-api 由 FastAPI 產生的規格有三個缺口，交給 AI 之前要自己補上說明：

1. `POST /api/appointments/{id}/cancel` 只寫了 200 與 422；實際還會回 409（超過取消期限、狀態不對）、401、403、404。
2. 422 寫的是 FastAPI 預設的 `HTTPValidationError`（`detail` 陣列），實際回的是 Problem Details，欄位錯誤在本站約定的 `errors` 裡。
3. `status` 的型別是 `string`，沒有列出可能的值。

這些缺口不補，模型就會照規格寫出讀不到錯誤訊息的程式。長期的解法是請後端修規格。

## 一份契約包

把上面六樣整理成一段，和需求一起交給 AI：

```markdown
## API 契約（我的掛號）

型別：只用 src/api/schema.d.ts，呼叫只用 src/api/client.ts 的 `api`（已處理 token 與 401 導向登入）。
- GET /api/appointments?cursor=0&limit=20 → components['schemas']['AppointmentPage']
- POST /api/appointments/{id}/cancel → components['schemas']['AppointmentOut']

範例回應（格式照 clinic-api；文字內容是示意）：
- 有資料：
  {"items":[{"id":501,"session_id":12,"patient_id":7,"number":3,"status":"booked",
    "created_at":"2026-11-18T09:12:00+08:00"}],"next_cursor":501}
- 最後一頁：{"items":[…],"next_cursor":null}
- 沒有資料：{"items":[],"next_cursor":null}
- 409（Content-Type: application/problem+json）：
  {"type":"https://clinic.example/problems/cancel-deadline-passed","title":"Cancel deadline passed",
   "status":409,"detail":"…"}
- 422：{"type":"https://clinic.example/problems/validation-error","title":"Unprocessable Content",
   "status":422,"detail":"欄位格式錯誤","errors":{"limit":["…"]}}
- 401：{"type":"about:blank","title":"Unauthorized","status":401,"detail":"…"}，標頭 WWW-Authenticate: Bearer

欄位語意：
- status：booked 候診、checked_in 已報到、cancelled 已取消；其他值顯示「未知狀態」。
- number：該診次的看診序號。created_at：建立時間（ISO 8601，帶時區）。
- 錯誤顯示：409 依 type 對應文案表；不要直接顯示英文的 title。

限制：
- 只用上面型別與範例裡有的欄位。畫面要的資料規格沒有（看診日期、時段、醫師），
  不要自己加欄位、不要猜 API，列在回報的「缺口」一節。
- mock 用上面的範例回應，並加上 `satisfies` 對應的型別。
```

最後兩條限制最關鍵：模型知道「沒有就列出來」是被允許的答案，才不會硬補。

## 驗收：抓出編出來的欄位

### 型別檢查

元件、composable 與 mock 都從產生的型別取型別時，編出來的欄位在型別檢查就會失敗。mock 用 `satisfies` 綁住型別：

```ts
// src/mocks/handlers.ts（MSW 3）
import { http, HttpResponse } from 'msw'
import type { components } from '../api/schema'

type Page = components['schemas']['AppointmentPage']

export const handlers = [
  http.get('/api/appointments', () =>
    HttpResponse.json({
      items: [{ id: 501, session_id: 12, patient_id: 7, number: 3, status: 'booked',
                created_at: '2026-11-18T09:12:00+08:00', doctorName: '林醫師' }],
      next_cursor: null,
    } satisfies Page),
  ),
]
```

上面故意多了 `doctorName`，TypeScript 5.9 的錯誤是：

```text
error TS2353: Object literal may only specify known properties, and 'doctorName' does not exist in type '{ id: number; session_id: number; patient_id: number; number: number; status: string; created_at: string; }'.
```

產出裡出現 `as any`、`as unknown as`、`@ts-ignore`，或自己定義了一個 `interface Appointment`，型別檢查就被繞過了，要求改回產生的型別。

### 對照實際回應

型別檢查只能對到規格。最後一步仍是接上真的後端，在 Network 分頁看：

- 畫面上每一欄都能在 Response 裡找到來源欄位。某一欄整欄空白，先查欄位名。
- 請求的參數名與值和規格一致（`cursor`、`limit`，不是 `page`、`pageSize`）。
- 讓後端回一次 409 與 422，畫面顯示的是對應的文案與 `errors` 裡各欄位的 `message`。

### 缺口清單

回報裡要有「缺口」一節。畫面上那些規格沒有的資料如果還是顯示出值，追問來源：常見的是寫死的假資料、從別的欄位拼出來的值，或呼叫了一支不存在的 API（Network 分頁出現 404）。

:::stop 讀到這裡可以先停：會準備一份契約包，用型別檢查與實際回應抓出編出來的欄位。後面的常見錯誤，在 AI 交回的改動接上後端仍然對不上時再回來對照。

## 常見錯誤

- **只給描述、不給契約**：「回傳掛號清單」讓模型決定欄位。至少給型別檔或一筆範例回應。
- **只給成功的範例**：空清單、錯誤、最後一頁沒有範例，產出就只處理成功的情況，錯誤時顯示 `undefined` 或 `[object Object]`。
- **讓 AI 自己寫 mock，又不綁型別**：mock 跟著它的猜測走，測試全綠但和後端不符。mock 用實際的範例並加 `satisfies`。
- **規格寫錯卻照單全收**：clinic-api 的 422 就是例子。交給 AI 前在 Network 分頁看一次實際的錯誤回應。
- **把 Problem Details 的英文 `title` 直接顯示**：`title` 是給開發者看的摘要，畫面依 `type` 對應自己的文案（見 [錯誤分類與重試](#/skill/api-errors-retry)）。
- **缺口被默默補上**：模型為了交出完整的畫面，從 `session_id` 拼出一個假的醫師名稱。在限制裡明確寫「列出來，不要補」。

## 動手

1. 挑一個現有的畫面，整理出它的契約包：型別或規格節錄、每種情況的範例回應、錯誤格式、欄位語意。
2. 打開那支 API 的實際錯誤回應，和規格的錯誤 schema 比對，寫下不一致的地方。
3. 把契約包和需求一起交給 AI，要求列出缺口；檢查產出的 `vue-tsc --noEmit`，再用 Network 分頁逐欄對照。
4. 把 mock 都加上 `satisfies`，故意在規格裡改一個欄位名重新產生型別，確認 mock 與元件都會報錯。
5. 契約在後端怎麼寫、怎麼用契約測試守住，見後端路線的 [OpenAPI 與 API 契約](#/skill/openapi)。

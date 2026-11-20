## 從一個具體問題開始：後端改版之後，型別檢查全過，畫面卻壞了

候診清單的程式用 TypeScript 寫，`vue-tsc --noEmit` 沒有任何錯誤：

```ts
interface Appointment {
  id: number
  patientName: string
  status: 'booked' | 'checked-in' | 'cancelled'
  roomNo: number
  waitMinutes: number
}

const res = await fetch('/api/appointments?date=2026-11-20')
const list = (await res.json()) as Appointment[]
list.sort((a, b) => a.roomNo - b.roomNo)
```

某天後端上線新版：新增「未到診」的狀態 `no-show`，分院的診間號碼改成 `"3A"` 這樣的字串，`waitMinutes` 改名成 `waitingMinutes`。前端沒有改任何程式，建置照樣成功。打開頁面：

1. 未到診的病患，狀態徽章是空白的：`switch (a.status)` 沒有對應的 `case`，回傳 `undefined`，沒有任何錯誤。
2. 清單的順序亂了：`'3A' - 5` 是 `NaN`，`sort` 拿到 `NaN` 時的結果沒有意義，也沒有錯誤。
3. 整個清單變成空白，Console 出現 `TypeError: Cannot read properties of undefined (reading 'toFixed')`，stack trace 指向 `QueueRow.vue` 的 `a.waitMinutes.toFixed(0)`，離原因（API 的回應變了）很遠。

型別檢查只看得到程式碼，看不到執行時拿到的資料。`as Appointment[]` 的意思是「相信我，它長這樣」，伺服器沒有照約定回應時，TypeScript 沒有任何機會發現。

## 運作原理

### TypeScript 在邊界看到的型別

資料從程式外面進來的地方，TypeScript 只能給一個很寬的型別。用 TypeScript 6.0.3 的內建型別（`lib.dom.d.ts`、`lib.es5.d.ts`）與 Vue Router 5.5 查到的結果：

| 來源 | TypeScript 看到的型別 | 實際可能拿到 |
|---|---|---|
| `await res.json()` | `any` | 任何 JSON；伺服器回 HTML 錯誤頁時丟出 `SyntaxError` |
| `JSON.parse(text)` | `any` | 任何 JSON |
| `localStorage.getItem(key)` | `string` 或 `null` | 舊版程式存的格式、使用者手動改過的值 |
| `route.query.page` | `string`、`null` 或它們組成的陣列 | `?page=abc`、`?page=1&page=2`、沒有這個參數 |
| `message` 事件的 `event.data` | `any` | 任何來源送來的任何東西 |
| `import.meta.env.VITE_X`（Vite 8 預設） | `any`（沒有宣告時） | 建置時的字串，或 `undefined` |

`any` 指定給任何型別都不會報錯，而且會傳染：`const list: Appointment[] = await res.json()` 通過編譯，`JSON.parse(raw).foo.bar` 也通過。改成 `unknown`，同樣的寫法會報 `TS18046: 'u' is of type 'unknown'.`，逼你先檢查。

### 在邊界驗證一次

```
fetch ─▶ res.ok？─▶ res.json()（當成 unknown）─▶ schema.safeParse()
                                                   ├─ 成功：型別確定的資料 ─▶ store、元件
                                                   └─ 失敗：錯誤畫面＋回報（含欄位路徑）
```

資料一進來就檢查，通過之後的程式都可以相信它的型別；不通過的在同一個地方決定畫面與回報。另一種做法是在每個元件各自寫 `if (a && typeof a.waitMinutes === 'number')`，檢查散在各處，漏一個就是開頭那種錯。

驗證放在前端，不代表後端可以不驗證：後端驗證的是「使用者送來的資料」，前端驗證的是「後端回來的資料」，兩者方向相反（伺服器那一側見 [輸入驗證與檔案上傳](#/skill/input-validation)）。

### 用 zod 寫 schema

zod 4（2026 年 11 月是 4.6.7）用程式描述資料的形狀，同時拿來檢查資料與推出型別：

```ts
import * as z from 'zod'

export const Appointment = z.object({
  id: z.number().int(),
  patientName: z.string(),
  status: z.enum(['booked', 'checked-in', 'cancelled']),
  checkedInAt: z.iso.datetime({ offset: true }).nullable(),   // 可能是 null
  note: z.string().optional(),                                  // 可能沒有這個欄位
})
export type Appointment = z.infer<typeof Appointment>
// { id: number; patientName: string; status: "booked" | "checked-in" | "cancelled";
//   checkedInAt: string | null; note?: string | undefined }
```

用 Node 實際跑 4.6.7，把開頭那種改版後的資料（`id` 是字串、`patientName` 是 `null`、狀態拼錯、時間少了時區）送進 `z.array(Appointment).safeParse()`，`success` 是 `false`，`z.prettifyError(result.error)` 印出：

```text
✖ Invalid input: expected number, received string
  → at [0].id
✖ Invalid input: expected string, received null
  → at [0].patientName
✖ Invalid option: expected one of "booked"|"checked-in"|"cancelled"
  → at [0].status
✖ Invalid ISO datetime
  → at [0].checkedInAt
```

每一條都有路徑，回報給後端時直接指得出是哪個欄位。幾個要知道的行為（都在 4.6.7 實測）：

- `parse()` 不符時丟出 `ZodError`；`safeParse()` 不丟錯，回傳 `{ success: true, data }` 或 `{ success: false, error }`。在 API 層用 `safeParse` 比較好控制畫面。
- `z.object()` 預設會把沒宣告的欄位拿掉，回傳的 `data` 裡沒有它們；`z.strictObject()` 把多餘的欄位當錯誤（`Unrecognized key: "b"`）；`z.looseObject()` 保留。
- `z.iso.datetime()` 預設只接受 `Z` 結尾的 UTC 時間，`2026-11-20T09:12:00+08:00` 要加 `{ offset: true }` 才通過。
- `.nullable()` 是「值可以是 `null`」，`.optional()` 是「欄位可以不存在」，對應 TypeScript 的 `string | null` 與 `note?: string`。
- `z.coerce.number()`、`z.coerce.date()` 先轉型再檢查；`.catch(值)` 在檢查失敗時改用預設值。`z.infer` 推出的是轉換後的型別，轉換前的型別用 `z.input`。

Valibot 1 是寫法不同、bundle 較小的替代品。zod 4 與 Valibot 1 都實作了 Standard Schema 介面（schema 上有 `~standard` 屬性），表單函式庫這類工具可以同時接受兩者。

### 嚴格還是寬鬆

後端新增一個狀態值，是要讓整個清單顯示錯誤，還是顯示「其他」？這要在規格裡定，而且可以逐欄決定：

- **整份資料都要對**：`z.array(Appointment).safeParse()`，任何一筆不符就進錯誤畫面。適合金額、權限這類錯了會出事的資料。
- **逐筆檢查**：每一筆各自 `safeParse`，通過的顯示、不通過的略過並回報。一筆壞資料不會讓整個清單消失。
- **欄位有預設值**：`z.enum(['booked', 'checked-in', 'cancelled', 'unknown']).catch('unknown')`，沒看過的狀態變成 `'unknown'`，畫面顯示「其他」。實測 `'no-show'` 會得到 `'unknown'`。

不論選哪一種，失敗都要回報（錯誤監控或 `POST /api/client-errors`），否則前端默默略過，沒有人知道後端改了格式。

### 不用函式庫時：型別守衛

```ts
function isAppointment(x: unknown): x is Appointment {
  return typeof x === 'object' && x !== null
    && typeof (x as Record<string, unknown>).id === 'number'
    && typeof (x as Record<string, unknown>).patientName === 'string'
}
```

`x is Appointment` 告訴 TypeScript：這個函式回傳 `true` 時，`x` 就是 `Appointment`。函式內容寫什麼，編譯器不檢查：上面漏了 `status` 與 `checkedInAt`，型別守衛照樣「保證」它們存在。欄位一多，手寫的守衛很容易和型別脫節，這是 schema 函式庫存在的原因。

### strict 之外的旗標

`strict` 在 TypeScript 6 預設開啟（見 [TypeScript 基礎](#/skill/ts-basics)），但有兩個常用的旗標不在 `strict` 裡。用 TypeScript 6.0.3 實測：

```ts
const rooms = ['101', '102']
const r = rooms[5]
r.toUpperCase()          // strict：沒有錯誤，執行時 TypeError
                         // 加 noUncheckedIndexedAccess：TS18048: 'r' is possibly 'undefined'.
rooms[0].toUpperCase()   // 加 noUncheckedIndexedAccess：TS2532: Object is possibly 'undefined'.

interface Prefs { note?: string }
const p: Prefs = { note: undefined }
// strict：沒有錯誤
// 加 exactOptionalPropertyTypes：TS2375: Type '{ note: undefined; }' is not assignable to type 'Prefs' with 'exactOptionalPropertyTypes: true'. …
```

- `noUncheckedIndexedAccess`：陣列索引與 `Record<string, T>` 的取值多一個 `undefined`，逼你處理「沒有這一筆」。
- `exactOptionalPropertyTypes`：`note?: string` 只表示「可以沒有這個欄位」，不允許明確寫 `note: undefined`。

TypeScript 6.0.3 的 `tsc --init` 產生的設定兩個都打開。Vue 專案常用的 `@vue/tsconfig` 0.9.1 沒有：`noUncheckedIndexedAccess` 沒列，`exactOptionalPropertyTypes` 寫在註解裡，理由是目前的生態系還很難全面採用。create-vite 9.3.4 的 Vue + TS 範本繼承 `@vue/tsconfig`，所以這兩個預設都是關的，要用就自己加。

### `.d.ts`：只有型別的檔案

`.d.ts` 檔只描述型別，沒有任何程式，編譯器完全相信它的內容：

- `@types/*` 套件替用 JavaScript 寫的套件補上型別。型別和套件的實際行為不一致時，錯誤一樣到執行時才出現。
- `vite/client` 提供 Vite 特有的型別。create-vite 9.3.4 的 Vue + TS 範本在 `tsconfig.app.json` 寫 `"types": ["vite/client"]`，不再產生 `src/vite-env.d.ts`。
- Vite 8 的 `vite/client` 裡，`ImportMetaEnv` 預設允許任何鍵、值是 `any`；`*.module.css` 匯入的物件型別是任何鍵都回傳 `string`。拼錯環境變數或 class 名稱都不會報錯。
- 為了讓沒有型別的舊套件通過編譯而寫 `declare module 'legacy-chart'`，這個模組匯出的東西全部變成 `any`。
- `@vue/tsconfig` 開了 `skipLibCheck: true`，`.d.ts` 檔自己的錯誤不會被報出來。

### 從 OpenAPI 產生的型別

openapi-typescript 這類工具從 API 規格產生型別，省掉手寫 interface，前後端的欄位名稱也一致。產生的仍然只是型別：部署中的後端沒照規格回應時，前端一樣看不到。要嘛在執行時再驗證一次（有工具能從同一份規格產生 zod schema），要嘛在 CI 用契約測試確認後端照規格回應（見後端的 [OpenAPI 與 API 契約](#/skill/openapi)）。

## 實際程式

### schema 與 API 函式

```ts
// src/api/schemas.ts
import * as z from 'zod'

export const AppointmentStatus = z.enum(['booked', 'checked-in', 'cancelled', 'unknown']).catch('unknown')

export const Appointment = z.object({
  id: z.number().int(),
  patientName: z.string(),
  status: AppointmentStatus,
  roomNo: z.string(),                                   // 分院有 "3A"，改成字串
  waitMinutes: z.number().nonnegative(),
  checkedInAt: z.iso.datetime({ offset: true }).nullable(),
})
export type Appointment = z.infer<typeof Appointment>
```

```ts
// src/api/appointments.ts
import * as z from 'zod'
import { Appointment } from './schemas'
import { reportClientError } from './report'

export class ApiFormatError extends Error {}

export async function fetchAppointments(date: string, signal?: AbortSignal): Promise<Appointment[]> {
  const res = await fetch(`/api/appointments?date=${encodeURIComponent(date)}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)          // 4xx、5xx 的處理見 api-errors-retry
  const body: unknown = await res.json()                       // 不用 as，先當成 unknown

  const result = z.array(Appointment).safeParse(body)
  if (!result.success) {
    reportClientError({ where: 'fetchAppointments', detail: z.prettifyError(result.error) })
    throw new ApiFormatError('資料格式有誤，請稍後再試')
  }
  return result.data                                           // 這之後的型別是可信的
}
```

:::stop 讀到這裡可以先停：知道型別擋不住 API 回來的資料，會在 `fetch` 之後用 schema 驗證一次。後面的逐筆檢查、網址參數、環境變數的型別，在處理 localStorage、query 或 `import.meta.env` 時再回來讀。

### 逐筆檢查：一筆壞資料不拖垮整個清單

```ts
export function parseEach<T>(schema: z.ZodType<T>, items: unknown): T[] {
  if (!Array.isArray(items)) throw new ApiFormatError('預期是陣列')
  const ok: T[] = []
  items.forEach((item, i) => {
    const r = schema.safeParse(item)
    if (r.success) ok.push(r.data)
    else reportClientError({ where: `item[${i}]`, detail: z.prettifyError(r.error) })
  })
  return ok
}
```

### 網址參數與 localStorage

```ts
// 頁碼：?page=abc、?page=0、沒有參數都回到 1（4.6.7 實測 '2' → 2、'abc' → 1、['3', '4'] → 1）
const Page = z.coerce.number().int().min(1).catch(1)
const page = computed(() => Page.parse(route.query.page))

// localStorage 的偏好設定：舊版或手改過的資料當成沒有
const Prefs = z.object({ version: z.literal(1), clinicId: z.string() })
function loadPrefs() {
  try {
    const r = Prefs.safeParse(JSON.parse(localStorage.getItem('clinic:prefs') ?? 'null'))
    return r.success ? r.data : null
  } catch {
    return null                                                // JSON 壞了，或讀不到 localStorage
  }
}
```

### 環境變數的型別

```ts
// src/env.d.ts
/// <reference types="vite/client" />

interface ViteTypeOptions {
  strictImportMetaEnv: unknown        // 沒宣告的 import.meta.env.XXX 改成型別錯誤
}

interface ImportMetaEnv {
  readonly VITE_API_BASE: string
}
```

加上之後，`import.meta.env.VITE_API_BAES` 會報 `TS2551: Property 'VITE_API_BAES' does not exist on type 'ImportMetaEnv'. Did you mean 'VITE_API_BASE'?`（TypeScript 6.0.3、Vite 8.3.8 實測）。宣告只管型別，建置時沒有設定這個變數，值照樣是 `undefined`。

```json
// tsconfig.app.json 加上兩個 strict 以外的旗標
{
  "extends": "@vue/tsconfig/tsconfig.dom.json",
  "compilerOptions": {
    "types": ["vite/client"],
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

### 一段可以跑的對照

```js run
// 後端改版後的回應：多了 no-show、roomNo 變成字串、waitMinutes 改名
const body = JSON.stringify([
  { id: 1, patientName: '王小明', status: 'booked', roomNo: 3, waitMinutes: 12 },
  { id: 2, patientName: '林美華', status: 'no-show', roomNo: '3A', waitingMinutes: 5 },
])

// 1. 沒有檢查：等同 TypeScript 的 as Appointment[]，錯在渲染時才出現
const unchecked = JSON.parse(body)
try {
  console.log(unchecked.map((a) => `${a.patientName} 約 ${a.waitMinutes.toFixed(0)} 分鐘`))
} catch (e) {
  console.log('渲染時才出錯：', `${e.name}: ${e.message}`)
}

// 2. 在邊界檢查：極簡的 schema 驗證器（實務上用 zod）
const STATUSES = ['booked', 'checked-in', 'cancelled']
const kind = (v) => (v === null ? 'null' : v === undefined ? 'undefined' : typeof v)
const schema = {
  id: (v) => Number.isInteger(v) || `expected integer, received ${kind(v)}`,
  patientName: (v) => typeof v === 'string' || `expected string, received ${kind(v)}`,
  status: (v) => STATUSES.includes(v) || `expected one of ${STATUSES.join('|')}`,
  roomNo: (v) => typeof v === 'number' || `expected number, received ${kind(v)}`,
  waitMinutes: (v) => typeof v === 'number' || `expected number, received ${kind(v)}`,
}

function safeParseList(data) {
  if (!Array.isArray(data)) return { success: false, issues: [{ path: '', message: 'expected array' }] }
  const issues = []
  data.forEach((item, i) => {
    for (const [key, check] of Object.entries(schema)) {
      const r = check(item?.[key])
      if (r !== true) issues.push({ path: `[${i}].${key}`, message: r })
    }
  })
  return issues.length ? { success: false, issues } : { success: true, data }
}

const result = safeParseList(JSON.parse(body))
if (!result.success) {
  console.log('資料格式有誤，請稍後再試')
  for (const issue of result.issues) console.log(`  ✖ ${issue.message}  → at ${issue.path}`)
}
```

## 常見錯誤與錯誤訊息

| 現象或訊息 | 原因 | 修法 |
|---|---|---|
| 型別檢查全過，畫面出現 `undefined` 或空白 | `res.json()` 是 `any`，用 `as` 或直接指定給有型別的變數 | 當成 `unknown`，用 schema 驗證 |
| `TypeError: Cannot read properties of undefined (reading '…')`，stack 指向元件 | API 欄位改名或少了，錯誤在使用時才出現 | 在 API 層驗證，錯誤會在拿到資料的地方出現 |
| `TS18046: 'u' is of type 'unknown'.` | `unknown` 沒有先檢查就使用 | 先 `safeParse` 或 `typeof` |
| `Invalid input: expected number, received string`（zod） | 回應的型別和 schema 不同 | 確認是後端改了還是 schema 寫錯，對照 Network 分頁的回應 |
| `Invalid option: expected one of …`（zod） | 出現沒看過的列舉值 | 和後端確認；需要容錯時用 `.catch()` |
| `Invalid ISO datetime`（zod） | 時間有時區偏移（`+08:00`），schema 用的是預設的 `z.iso.datetime()` | 加 `{ offset: true }` |
| 回應裡的欄位不見了 | `z.object()` 預設移除沒宣告的欄位 | 把欄位加進 schema，或改用 `z.looseObject()` |
| 錯誤監控只收到 `[object Object]` | 把 `ZodError` 物件直接轉成字串 | 用 `z.prettifyError()` 或 `error.issues` |
| `TS2532: Object is possibly 'undefined'.` 一次冒出很多 | 剛打開 `noUncheckedIndexedAccess` | 逐一處理沒有資料的情況，不要用 `!` 壓掉 |
| 拼錯的 `import.meta.env.XXX` 沒有報錯 | Vite 預設把沒宣告的鍵當成 `any` | `env.d.ts` 宣告欄位並開 `strictImportMetaEnv` |
| `interface` 與 schema 各寫一份，欄位對不上 | 型別有兩個來源 | 型別一律用 `z.infer` 推出 |

AI 產生的 API 程式常直接寫 `return (await res.json()) as Appointment[]`，或寫一個只檢查一兩個欄位的型別守衛，看起來有型別、執行時沒有任何保護。審查時找 `as`、`any` 與 `x is` 這三種寫法。

## 動手

1. 按上面那段的「在 Playground 開啟」，把第二筆資料改回 `status: 'booked'`、`roomNo: 3`、`waitMinutes: 5`，確認兩邊都正常；再刪掉第一筆的 `patientName`，看檢查印出的路徑。
2. 在自己的專案搜尋 `res.json()`、`JSON.parse(`、`localStorage.getItem(`、`route.query`，列出每一個邊界目前有沒有驗證。
3. 在 `tsconfig` 暫時打開 `noUncheckedIndexedAccess` 跑一次 `npx vue-tsc --noEmit`，數一下錯誤有幾個，挑三個改掉。
4. 用 Network 分頁的 `Override content` 改一個 API 回應的欄位型別，確認畫面顯示格式錯誤的提示，沒有變成空白頁。

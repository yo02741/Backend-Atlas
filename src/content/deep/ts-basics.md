## 從一個具體問題開始：未報到的病患讓整張清單消失

預約清單的每一列顯示報到時間，API 回應裡的 `checkedInAt` 是 `"2026-11-20T09:12:00+08:00"` 這樣的字串，還沒報到時是 `null`。AI 用 JavaScript 寫的列元件：

```js
// AppointmentRow.vue 的 <script setup>（JavaScript 版本）
const props = defineProps({ appointment: Object })
const checkInTime = computed(() => props.appointment.checkedInAt.slice(11, 16))
const isCheckedIn = computed(() => props.appointment.status === 'checkedin')
```

上線第一天早上，第一位病患還沒報到，整張清單一片空白，Console 出現 `TypeError: Cannot read properties of null (reading 'slice')` 與 `[Vue warn]: Unhandled error during execution of render function`。另外一個錯沒有任何訊息：API 回的狀態值是 `'checked-in'`，`'checkedin'` 少了連字號，`isCheckedIn` 永遠是 `false`。

同一段改用 TypeScript、先描述資料的形狀：

```ts
type AppointmentStatus = 'booked' | 'checked-in' | 'cancelled'

interface Appointment {
  id: number
  status: AppointmentStatus
  checkedInAt: string | null
}
```

存檔後 `vue-tsc --noEmit` 直接列出兩個錯：

```
error TS18047: 'props.appointment.checkedInAt' is possibly 'null'.
error TS2367: This comparison appears to be unintentional because the types 'AppointmentStatus' and '"checkedin"' have no overlap.
```

兩個錯都在執行之前被找到。不過 AI 修第一個錯時常寫成 `checkedInAt!.slice(11, 16)`：編譯通過了，執行時一樣壞。TypeScript 能擋下多少錯，取決於型別寫得多準，以及有沒有人用 `!`、`as`、`any` 把錯誤壓掉。

## 運作原理

### 型別只在編譯時存在

```
AppointmentRow.vue、api.ts（有型別）
   │
   ├─ vue-tsc --noEmit ──▶ 檢查型別，列出錯誤，不產生任何檔案
   │
   └─ Vite ──▶ 拿掉型別、轉成 JavaScript（不檢查）──▶ 瀏覽器執行（沒有型別）
```

TypeScript 是 JavaScript 加上型別註記。型別檢查器讀註記、找出不一致的地方；轉成 JavaScript 時，註記全部被拿掉，執行的程式和沒寫型別時一樣。由此有三個結果：

- Vite 只做轉譯、不做型別檢查，型別錯誤不會讓 `npm run dev` 停下來。檢查要另外跑 `vue-tsc --noEmit`（`.vue` 檔）或 `tsc --noEmit`。create-vite 的 Vue + TS 範本把它放在建置指令裡：`"build": "vue-tsc -b && vite build"`。
- `interface` 在執行時不存在，`x instanceof Appointment` 會得到 `TS2693: 'Appointment' only refers to a type, but is being used as a value here.`。
- API 回應的形狀不會被自動檢查。寫了 `as Appointment[]`，伺服器回了別的東西，執行時照樣跑下去，錯在更後面才出現。

### 註記與推論

```ts
let waiting: number = 0                       // 變數
function label(a: Appointment): string { }    // 參數與回傳值
const rooms: string[] = []                    // 陣列
function notify(id: number, message?: string) {}   // 選填參數

const n = 3            // 推論成 number，不用寫
const list = [1, 2]    // 推論成 number[]
```

能推論的地方不必寫型別；函式的參數一定要寫（`strict` 開著時沒寫會報 `TS7006: Parameter 'x' implicitly has an 'any' type.`），回傳值與匯出的函式寫出來比較好讀。

### `interface` 與 `type`

兩者都能描述物件的形狀，Vue 的 `defineProps<…>()` 兩種都接受。差別：

- `type` 可以替任何型別取名字，包括字串 literal 的 union、tuple、函式型別；`interface` 只描述物件。
- 擴充：`interface Staff extends Person { … }`；`type` 用 intersection `type Staff = Person & { … }`。
- 同名的 `interface` 會自動合併成一個（第二個宣告補上的欄位變成必填）；同名的 `type` 會報 `TS2300: Duplicate identifier`。

多數團隊的慣例是物件形狀用 `interface`、union 與其他組合用 `type`，選一種一致就好。

### 選填、`undefined` 與 `null`

- `note?: string`：欄位可能不存在，讀出來的型別是 `string` 或 `undefined`。
- `checkedInAt: string | null`：欄位一定在，值可能是 `null`。對應 API 回應裡明確給 `null` 的欄位。
- 兩種都要先處理才能當字串用。`strict` 開著時，直接用會報 `TS18048: 'x.note' is possibly 'undefined'.` 或 `TS18047: 'x' is possibly 'null'.`。

`document.querySelector('#search')` 也是一樣：回傳型別是 `Element` 或 `null`，直接呼叫 `.focus()` 會報 `TS18047` 與 `TS2339: Property 'focus' does not exist on type 'Element'.`（`focus` 在 `HTMLElement` 上）。寫成 `document.querySelector<HTMLInputElement>('#search')` 再判斷 `null`；在 Vue 元件裡用 template ref。

### union 與 narrowing

union 列出一個值可能是哪幾種。字串 literal 的 union 只允許那幾個字串，拼錯就報錯：

```ts
type AppointmentStatus = 'booked' | 'checked-in' | 'cancelled'
const s: AppointmentStatus = 'done'   // TS2322：'"done"' 不在允許的值裡
```

拿到 union 型別的值，要先「縮小範圍」（narrowing）才能用只屬於某一種的操作。TypeScript 看得懂這些判斷：

```ts
function timeText(at: string | null) {
  if (at === null) return '未報到'      // 這個區塊之後，at 是 string
  return at.slice(11, 16)
}

function show(v: string | number) {
  if (typeof v === 'number') return v.toFixed(0)   // typeof
  return v.trim()
}

// 用一個共同欄位區分的 union（discriminated union）
type LoadState =
  | { status: 'loading' }
  | { status: 'success'; data: Appointment[] }
  | { status: 'error'; message: string }

function render(s: LoadState) {
  switch (s.status) {
    case 'loading': return '載入中'
    case 'success': return `${s.data.length} 筆`      // 這裡 s 一定有 data
    case 'error': return s.message                    // 這裡 s 一定有 message
    default: {
      const unreachable: never = s   // 所有情況都處理了，s 在這裡是 never
      return unreachable
    }
  }
}
```

`default` 指定給 `never` 型別是窮舉檢查：之後在 `LoadState` 加了 `{ status: 'empty' }`，忘了加 `case` 的地方會報 `TS2322: Type '{ status: "empty"; }' is not assignable to type 'never'.`，漏處理的狀態在編譯時就找得到。

:::stop 讀到這裡可以先停：會寫 `interface` 與 union，用 narrowing 處理 `null` 與選填欄位。後面的泛型、`as` 與 `any`、`tsconfig`，在讀 API 函式的型別或審 AI 加的型別斷言時再回來讀。

### 泛型

泛型是型別的參數，讓同一段程式適用多種型別，又不丟掉型別資訊：

```ts
function first<T>(list: T[]): T | undefined {
  return list[0]
}
const a = first([501, 502])         // a 的型別是 number | undefined
const b = first(['內科', '眼科'])    // b 的型別是 string | undefined

const appointments = ref<Appointment[]>([])         // Vue 的 ref
const pending: Promise<Appointment[]> = loadList()  // Promise 的結果型別
```

常見的 `api.get<Appointment[]>('/api/appointments')` 也是泛型，但它只是「告訴編譯器回應是這個形狀」，沒有檢查。回應真的長那樣，要在執行時驗證（例如用 zod 這類驗證套件）。

### `as`、`!`、`any` 與 `unknown`

| 寫法 | 意思 | 執行時 |
|---|---|---|
| `x as Appointment` | 型別斷言：叫編譯器把 `x` 當成 `Appointment` | 不檢查、不轉換 |
| `x!` | 非空斷言：叫編譯器當作 `x` 不是 `null`、`undefined` | 不檢查，`x` 是 `null` 時照樣出錯 |
| `any` | 關掉這個值的所有檢查，而且會傳染給用到它的地方 | 沒有任何保護 |
| `unknown` | 「還不知道是什麼」，用之前一定要先縮小範圍 | 和 `any` 一樣是任何值，但編譯器逼你檢查 |

`as` 遇到明顯不相容的型別會擋下：`'12' as number` 報 `TS2352: Conversion of type 'string' to type 'number' may be a mistake…`；寫成 `'12' as unknown as number` 就過了，執行時仍然是字串。看到 `as unknown as` 或 `as any`，多半是有人在繞過型別檢查。

`unknown` 適合接住來源不確定的值，例如 `JSON.parse` 的結果：直接 `u.toUpperCase()` 會報 `TS18046: 'u' is of type 'unknown'.`，先 `typeof u === 'string'` 才能用。

`satisfies`（TypeScript 4.9 起）檢查一個值符合某個型別，但保留推論出來的精確型別：`const cfg = { base: '/clinic/', retries: 3 } satisfies Record<string, string | number>` 之後，`cfg.retries` 仍是 `number`，可以呼叫 `toFixed`；寫成型別註記的話，`cfg.retries` 變成 `string | number`，呼叫 `toFixed` 會報 `TS2339`。

### `tsconfig` 與 `strict`

`strict: true` 打開一組較嚴格的檢查，最常碰到的是 `strictNullChecks`（`null`、`undefined` 要處理）與 `noImplicitAny`（參數要有型別）。實測 TypeScript 6.0.3 與 7.0.2 在沒有 `tsconfig`、不加任何旗標時就會報這兩類錯，5.9.3 不會；`tsc --init` 產生的設定也寫著 `"strict": true`。

create-vite 9.3 的 Vue + TS 範本另外打開 `erasableSyntaxOnly`：只准用「拿掉就變回 JavaScript」的語法，`enum` 會報 `TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled.`。狀態值改用字串 literal 的 union。

### TypeScript 6 與 7

TypeScript 7.0（npm 上的 7.0.2 在 2026 年 7 月發布）是用 Go 重寫的原生編譯器，`tsc` 的用法與錯誤代碼沿用，檢查速度更快。7.0 的 `typescript` 套件不再提供舊的 JavaScript API，依賴那套 API 的工具（例如 vue-tsc）要搭配 TypeScript 6；微軟另外發布 `@typescript/typescript6`，讓兩版在同一個專案並存。create-vite 9.3.4 的 Vue + TS 範本用的是 `typescript ~6.0.3` 與 `vue-tsc ^3.3.14`。Vue 專案要不要升 7，以 vue-tsc 的說明為準。

## 實際程式碼

### 型別定義

```ts
// src/types/appointment.ts
export type AppointmentStatus = 'booked' | 'checked-in' | 'cancelled'

export interface Patient {
  id: number
  name: string
  phone?: string            // 可能沒有留電話
}

export interface Appointment {
  id: number
  patient: Patient
  dept: string
  status: AppointmentStatus
  note?: string             // 欄位可能不存在
  checkedInAt: string | null   // 欄位一定在，未報到時是 null
}
```

### 列元件

```vue
<script setup lang="ts">
import { computed } from 'vue'
import type { Appointment, AppointmentStatus } from '@/types/appointment'

const props = defineProps<{ appointment: Appointment }>()

function statusText(s: AppointmentStatus): string {
  switch (s) {
    case 'booked': return '已預約'
    case 'checked-in': return '已報到'
    case 'cancelled': return '已取消'
    default: {
      const unreachable: never = s   // 新增狀態時，這一行會編譯失敗
      return unreachable
    }
  }
}

const checkInTime = computed(() => {
  const at = props.appointment.checkedInAt
  return at === null ? '未報到' : at.slice(11, 16)   // 先判斷 null，不用 !
})
</script>

<template>
  <tr>
    <td>{{ appointment.patient.name }}</td>
    <td>{{ statusText(appointment.status) }}</td>
    <td>{{ checkInTime }}</td>
    <td>{{ appointment.note ?? '' }}</td>
  </tr>
</template>
```

`import type` 只匯入型別，轉成 JavaScript 時整行移除。`defineProps<{ … }>()` 用型別參數宣告 props，Vue 3.3 起型別可以從別的檔案匯入。

### 檢查指令

```bash
npx vue-tsc --noEmit          # .vue 與 .ts 一起檢查，不產生檔案
npx tsc --noEmit              # 沒有 .vue 檔的專案
grep -rnE "as any|: any|@ts-ignore|@ts-expect-error" src/   # 找被壓掉的錯誤
```

## 常見錯誤與錯誤訊息

| 錯誤代碼與訊息 | 意思 | 修法 |
|---|---|---|
| `TS18047: 'x' is possibly 'null'.` | 值可能是 `null`，沒判斷就用了 | 先 `if (x === null)`；不要用 `x!` 壓掉 |
| `TS18048: 'x.note' is possibly 'undefined'.` | 選填欄位或 `find` 的結果可能不存在 | `?.`、`??` 或先判斷 |
| `TS7006: Parameter 'x' implicitly has an 'any' type.` | 參數沒寫型別 | 補上型別 |
| `TS2339: Property 'focus' does not exist on type 'Element'.` | 這個型別沒有這個屬性 | 用更精確的型別，例如 `querySelector<HTMLInputElement>` |
| `TS2551: Property 'patientname' does not exist on type 'Appointment'. Did you mean 'patientName'?` | 欄位名稱打錯 | 照建議改 |
| `TS2367: This comparison appears to be unintentional because the types 'AppointmentStatus' and '"checkedin"' have no overlap.` | 和一個不可能出現的值比較，多半是拼錯 | 改成 union 裡的值 |
| `TS2352: Conversion of type 'string' to type 'number' may be a mistake…` | `as` 的兩個型別不相容 | 需要轉換就用 `Number()`，不要改成 `as unknown as` |
| `TS2693: 'Appointment' only refers to a type, but is being used as a value here.` | 把型別當成執行時的值（`instanceof`、當參數傳） | 改用欄位判斷，例如 `'status' in x` |
| `TS18046: 'u' is of type 'unknown'.` | `unknown` 沒縮小範圍就使用 | 先 `typeof` 或用驗證函式 |
| `TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled.` | 用了 `enum` 這類執行時還留著的語法 | 改成字串 literal 的 union |
| `TS2300: Duplicate identifier 'Patient'.` | 同名的 `type` 宣告了兩次 | 改名，或改用會合併的 `interface` |

型別不相容的 `TS2322` 最常見，訊息會列出兩邊的型別，例如 `Type 'string' is not assignable to type 'number'.`。目標型別是 union 時，TypeScript 6 與 7 列出成員的順序可能不同，比對 CI 輸出時不要依賴順序。

最容易漏掉的錯沒有訊息：`!`、`as`、`any` 讓編譯通過，問題留到執行時。審 AI 的改動時，這三個要一個一個看。

## 動手

- 打開 [TypeScript Playground](https://www.typescriptlang.org/play)，貼上「型別定義」與「列元件」裡的 `statusText`，在 `AppointmentStatus` 加一個 `'no-show'`，看 `never` 那一行的錯誤。
- 在 Playground 把 `checkInTime` 改成 `props.appointment.checkedInAt.slice(11, 16)` 的寫法（可以先把 `props.appointment` 換成一般的參數），看 `TS18047`；再改成 `checkedInAt!.slice(…)`，確認錯誤消失但問題還在。
- 在自己的 Vue + TS 專案跑一次 `npx vue-tsc --noEmit`，再跑上面的 `grep`，列出每一個 `any` 與 `as` 的理由。
- 資料是參考還是複本、`structuredClone` 與 `toRaw`，見 [值、參考與不可變更新](#/skill/values-references)；型別錯誤以外的執行時錯誤怎麼查，見 [錯誤與除錯](#/skill/js-debugging)。

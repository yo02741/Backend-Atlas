## 從一個具體問題開始：按了取消，清單上的電話還是變了

預約清單的每一筆有「編輯」按鈕，打開 Dialog `EditAppointment` 修改病患的聯絡電話。AI 產生的程式先複製一份再綁到表單上：

```js
// EditAppointment.vue（script 節錄，有問題的版本）
const props = defineProps({ appointment: Object })
const draft = reactive({ ...props.appointment })   // 「複製」一份給表單用
```

櫃台把王小明的電話從 `0912-000-111` 改成 `0912-000-999`，想想不對，按了「取消」。Dialog 關掉了，清單上那一筆的電話卻已經是 `0912-000-999`。展開 `{ ...props.appointment }` 只複製第一層：`draft.status` 是新的，`draft.patient` 和原資料指向同一個物件，改 `draft.patient.contact.phone` 就是改清單的資料。

第二版改成 `JSON.parse(JSON.stringify(props.appointment))`，取消的問題沒了，儲存時卻出現 `TypeError: draft.date.getTime is not a function`：`date` 原本是 `Date`，經過 JSON 變成了字串。第三版改用 `structuredClone(props.appointment)`，一打開 Dialog 就出現 `DataCloneError: Failed to execute 'structuredClone' on 'Window': #<Object> could not be cloned.`，因為 `props.appointment` 是父元件 `reactive` 清單裡的一筆，拿到的是 Vue 的 Proxy。

三個錯都來自同一件事：物件與陣列在變數之間傳來傳去時，傳的是參考。要寫對編輯表單、要讓 Vue 的 `watch` 與 `shallowRef` 照預期觸發，都得知道什麼時候是同一份資料、什麼時候是複本。

## 運作原理

### 變數裡放的是值還是參考

```
const a = 3
const b = a              a ──→ 3      b ──→ 3（另一份，改 b 不影響 a）

const appt = { id: 501, status: 'booked', patient: { name: '王小明' } }
const same = appt        appt ─┐
                         same ─┴──→ { id: 501, status, patient ──→ { name } }
                                     （只有一份，改 same.status 就是改 appt.status）
```

數字、字串、布林、`null`、`undefined`（以及 `bigint`、`symbol`）是原始值，指定給另一個變數就是一份新的值。物件、陣列、函式、`Date`、`Map` 是物件，變數裡放的是指向那份資料的參考。把物件傳進函式、放進另一個陣列、指定給另一個變數，都只多了一個參考。

`===` 比較物件時比的也是參考：`{ id: 1 } === { id: 1 }` 是 `false`，`same === appt` 是 `true`。

### 淺拷貝只複製第一層

```
const copy = { ...appt }

appt ──→ { id: 501, status: 'booked', patient ──┐ }
copy ──→ { id: 501, status: 'booked', patient ──┴──→ { name: '王小明', contact ──→ { phone } } }
          ↑ 第一層是新的                               ↑ 內層仍是同一份
```

`{ ...obj }`、`Object.assign({}, obj)`、`[...arr]`、`arr.slice()`、`Array.from(arr)` 都是淺拷貝。改 `copy.status` 不影響 `appt`，改 `copy.patient.contact.phone` 會。

### 四種「複製」的差別

| 寫法 | 複製幾層 | `Date` | `Map`、`Set` | 值是 `undefined` 的欄位 | 函式 | 循環參考 | Vue 的 Proxy |
|---|---|---|---|---|---|---|---|
| `b = a` | 不複製 | 同一個 | 同一個 | 同一份 | 同一份 | 同一份 | 同一個 Proxy |
| `{ ...a }` | 第一層 | 共用同一個 | 共用同一個 | 保留 | 保留 | 共用 | 第一層是新物件，內層讀到的仍是原資料 |
| `structuredClone(a)` | 每一層 | 新的 `Date` | 新的 | 保留 | 丟出 `DataCloneError` | 保留結構 | 丟出 `DataCloneError`，先 `toRaw` |
| `JSON.parse(JSON.stringify(a))` | 每一層 | 變成字串 | 變成 `{}` | 欄位消失 | 欄位消失 | 丟出 TypeError | 可以（透過 Proxy 讀值） |

`structuredClone` 是 Baseline 2022，主流瀏覽器與 Node 17 以後都能用，也能在 Web Worker 裡用。它複製不了函式、DOM 節點、class 實例的方法（複製出來只剩資料欄位），以及 Proxy。

### 不可變更新

不改原本的物件與陣列，改完的部分做成新的，沒改的部分沿用原本的參考：

| 要做的事 | 會改到原資料的寫法 | 不可變更新 |
|---|---|---|
| 改一個欄位 | `appt.status = 'checked-in'` | `{ ...appt, status: 'checked-in' }` |
| 改內層欄位 | `appt.patient.phone = p` | `{ ...appt, patient: { ...appt.patient, phone: p } }` |
| 加一筆 | `list.push(a)` | `[...list, a]` |
| 刪一筆 | `list.splice(i, 1)` | `list.filter((x) => x.id !== id)` |
| 換一筆 | `list[i] = a` | `list.map((x) => (x.id === a.id ? a : x))` 或 `list.with(i, a)` |
| 排序 | `list.sort(fn)` | `list.toSorted(fn)` |

不可變更新之後，有變的那一筆與外層陣列是新的參考，其他筆還是原本的物件。程式只要比 `old !== next` 就知道哪裡變了，不必逐欄比較。React 的 state、Vue 的 `shallowRef` 與 `watch` 的預設比較都靠這一點。

### Vue 的響應式和參考的關係

- `reactive(obj)` 回傳一個包住 `obj` 的 Proxy，`reactive(obj) !== obj`；`ref` 的值是物件時，`.value` 也是這樣的 Proxy。`toRaw(proxy)` 取回原始物件。
- 預設是深層的：改 `state.patient.contact.phone`，用到它的畫面會更新。所以在 Vue 裡直接改內層欄位「能動」，問題只在改到的是不是自己的資料。
- `shallowRef` 只追蹤 `.value` 本身。從 API 拿回一大包只會整批替換的資料時常用它（省下深層追蹤的成本），代價是更新一定要換成新物件：`list.value.push(x)` 畫面不會變，`list.value = [...list.value, x]` 才會。
- `watch` 的深度依來源而定：

| 監看的來源 | 改內層欄位會不會觸發 |
|---|---|
| `watch(appointment, …)`，`appointment` 是物件型的 `ref` | 不會，`.value` 被換掉才會 |
| `watch(state, …)`，`state` 是 `reactive` 物件 | 會，直接監看 reactive 物件時隱含 deep |
| `watch(() => state.patient, …)` | 不會，getter 回傳不同物件才會 |
| `watch(() => state.patient.phone, …)` | 會，監看的就是那個值 |
| 以上任何一種加 `{ deep: true }` | 會 |

- props 屬於父元件。`<script setup>` 裡寫 `props.appointment = {}`，Console 出現 `[Vue warn] Set operation on key "appointment" failed: target is readonly.`；改 `props.appointment.patient.phone` 不會有任何警告，父元件的資料直接被改掉。要改就 `emit` 給父元件，由擁有資料的一方更新。

React 的對應規則更嚴格：state 一律要換成新的參考。`list.push(x); setList(list)` 不會重新渲染，因為 React 用 `Object.is` 比較前後的值，兩者是同一個陣列；要寫 `setList([...list, x])`。

## 實際程式碼

下面幾段在本站的 JavaScript 執行環境（Web Worker）裡跑。Worker 裡沒有 Vue，第四段用一般的 `Proxy` 模擬 `reactive` 回傳的物件。

### 參考：指定與傳參數都不複製

```js run
const appt = { id: 501, status: 'booked', patient: { name: '王小明' } }
const same = appt
same.status = 'checked-in'
console.log('appt.status =', appt.status)          // checked-in：同一份
console.log('same === appt：', same === appt)
console.log('內容一樣的兩個物件：', { id: 1 } === { id: 1 })

function cancel(a) { a.status = 'cancelled' }      // 函式改到呼叫端的資料
cancel(appt)
console.log('呼叫 cancel 之後：', appt.status)
```

### 淺拷貝與逐層展開

```js run
const appt = { id: 501, status: 'booked', patient: { name: '王小明', contact: { phone: '0912-000-111' } } }

const shallow = { ...appt }
shallow.status = 'checked-in'                       // 第一層：不影響原資料
shallow.patient.contact.phone = '0912-000-999'      // 內層：改到原資料
console.log('原資料 status：', appt.status)
console.log('原資料電話：', appt.patient.contact.phone)
console.log('patient 是同一份：', shallow.patient === appt.patient)

// 逐層展開：要改哪一層，就把那一路上的每一層都換成新物件
appt.patient.contact.phone = '0912-000-111'
const next = { ...appt, patient: { ...appt.patient, contact: { ...appt.patient.contact, phone: '0912-000-999' } } }
console.log('next 的電話：', next.patient.contact.phone, '／原資料：', appt.patient.contact.phone)
```

:::stop 讀到這裡可以先停：分得出兩個變數是同一份資料還是複本，會用逐層展開改內層。後面的 `structuredClone`、Proxy 與 Vue 元件寫法，在寫編輯 Dialog 或遇到 `DataCloneError` 時再回來讀。

### `structuredClone` 與 JSON 來回

```js run
const appt = {
  id: 501,
  date: new Date('2026-11-20T09:00:00+08:00'),
  note: undefined,
  tags: new Set(['初診']),
}

const viaJson = JSON.parse(JSON.stringify(appt))
console.log('JSON：date 是', typeof viaJson.date, '；有 note 欄位嗎', 'note' in viaJson, '；tags 是', JSON.stringify(viaJson.tags))

const viaClone = structuredClone(appt)
console.log('structuredClone：date 是 Date 嗎', viaClone.date instanceof Date, '；有 note 欄位嗎', 'note' in viaClone, '；tags 有初診嗎', viaClone.tags.has('初診'))
console.log('是新的 Date：', viaClone.date !== appt.date)

// 循環參考：JSON 失敗，structuredClone 照樣複製
const a = { id: 1 }
a.self = a
try { JSON.stringify(a) } catch (err) { console.log('JSON：', err.message.split('\n')[0]) }
const c = structuredClone(a)
console.log('structuredClone 保留循環：', c.self === c)
```

### Proxy 與函式複製不了

```js run
// Vue 的 reactive() 回傳 Proxy；這裡用一般的 Proxy 模擬
const raw = { id: 501, patient: { name: '王小明' } }
const proxied = new Proxy(raw, {})

try {
  structuredClone(proxied)
} catch (err) {
  console.log(err.name, '：', err.message)
}
const draft = structuredClone(raw)                  // Vue 裡寫成 structuredClone(toRaw(state))
draft.patient.name = '王大明'
console.log('複本：', draft.patient.name, '／原資料：', raw.patient.name)

try {
  structuredClone({ id: 1, format() { return '501' } })
} catch (err) {
  console.log('有函式的物件：', err.name)
}
```

### 不可變更新：只換掉有變的部分

```js run
const list = [
  { id: 501, status: 'booked' },
  { id: 502, status: 'booked' },
  { id: 503, status: 'checked-in' },
]

const checkIn = (items, id) => items.map((a) => (a.id === id ? { ...a, status: 'checked-in' } : a))
const next = checkIn(list, 502)

console.log('外層陣列是新的：', next !== list)
console.log('502 是新物件：', next[1] !== list[1], next[1].status, '／原本：', list[1].status)
console.log('501、503 沿用原本的物件：', next[0] === list[0] && next[2] === list[2])

const removed = next.filter((a) => a.id !== 501)
const sorted = next.toSorted((a, b) => b.id - a.id)
console.log('刪除後', removed.map((a) => a.id), '／排序後', sorted.map((a) => a.id), '／原陣列', list.map((a) => a.id))

// Object.freeze 只凍結第一層；這段不是 strict mode，改凍結的欄位會靜靜失敗
const frozen = Object.freeze({ status: 'booked', patient: { name: '王小明' } })
frozen.status = 'cancelled'
frozen.patient.name = '王大明'
console.log('第一層沒變：', frozen.status, '／內層變了：', frozen.patient.name)
```

### 寫成 Vue 元件

```vue
<script setup>
import { ref, toRaw, watch } from 'vue'

const props = defineProps({ appointment: { type: Object, required: true } })
const emit = defineEmits(['save', 'close'])

// 開啟時複製一份：每一層都是新的，Date 仍是 Date
const draft = ref(structuredClone(toRaw(props.appointment)))

// 換一筆要編輯的掛號時重新複製；監看的是 props.appointment 這個參考
watch(() => props.appointment, (next) => { draft.value = structuredClone(toRaw(next)) })

function save() { emit('save', draft.value) }   // 父元件決定怎麼換進清單
function cancel() { emit('close') }             // 原資料一個欄位都沒動過
</script>
```

父元件收到 `save` 時用不可變更新換掉那一筆：

```js
function onSave(updated) {
  list.value = list.value.map((a) => (a.id === updated.id ? updated : a))
}
```

## 常見錯誤與錯誤訊息

| 訊息或現象 | 原因 | 修法 |
|---|---|---|
| 按「取消」後原資料也變了 | 表單綁在 props 上，或用展開做淺拷貝，內層共用 | `structuredClone(toRaw(…))`，或逐層展開 |
| `DataCloneError: Failed to execute 'structuredClone' on 'Window': #<Object> could not be cloned.` | 複製了 Vue 的 Proxy | 先 `toRaw()`；Pinia store 的狀態也一樣 |
| `DataCloneError: … could not be cloned.`，訊息裡是一段函式 | 物件裡有函式（方法、回呼） | 只複製資料欄位，函式另外處理 |
| `TypeError: draft.date.getTime is not a function` | JSON 來回複製讓 `Date` 變成字串 | 改用 `structuredClone`，或複製後 `new Date(draft.date)` |
| `TypeError: Converting circular structure to JSON` | 物件裡有循環參考（例如子節點指回父節點） | 不用 JSON 複製；送 API 前只挑需要的欄位 |
| `[Vue warn] Set operation on key "appointment" failed: target is readonly.` | 在子元件指定了 props | `emit` 給父元件 |
| 改內層欄位，`watch` 沒有觸發 | 監看的是物件型 ref 或回傳物件的 getter | 加 `{ deep: true }`，或監看那個欄位 |
| `list.value.push(x)` 之後畫面沒變 | `list` 是 `shallowRef` | `list.value = [...list.value, x]` |
| `TypeError: Cannot assign to read only property 'status' of object '#<Object>'` | 改了 `Object.freeze` 過的物件（ES module 是 strict mode，會丟錯） | 不可變更新，做一份新的 |

這類錯多半沒有錯誤訊息，要靠操作驗證：改了再取消、看 Vue DevTools 裡父元件的資料有沒有跟著動。

## 動手

- 按「淺拷貝與逐層展開」的「在 Playground 開啟」，把 `{ ...appt }` 換成 `structuredClone(appt)`，看原資料的電話還會不會變。
- 在「`structuredClone` 與 JSON 來回」裡加一個 `Map` 欄位，比較兩種寫法的結果。
- 在「不可變更新」加一個函式 `removeById(items, id)`，確認回傳新陣列、原陣列不變。
- 找一個專案裡的編輯 Dialog：改欄位、按取消，再用 Vue DevTools 看父元件的資料有沒有被改掉。
- 陣列方法哪些會改原陣列，見 [JavaScript 必要語法](#/skill/js-essentials)；Vue 的 `ref`、`reactive` 與解構失去響應式，見 [響應式](#/skill/reactivity)。

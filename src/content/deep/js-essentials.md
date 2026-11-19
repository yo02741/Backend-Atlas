## 從一個具體問題開始：候診 0 人的診間顯示「未提供」

門診看板要列出今天每個診間的候診人數，多的排前面。AI 產生的整理函式長這樣：

```js
// 有問題的版本：四個錯，修掉一個才看得到下一個
function summarizeClinics(clinics) {
  return clinics
    .sort((a, b) => b.waiting - a.waiting)
    .map((c) => {
      `${c.dept} ${c.room}（${c.doctor.name}）：${c.waiting || '未提供'} 人`
    })
}
```

接上 `GET /api/clinics/today` 之後，看板一片空白，Console 也沒有錯誤。原因是 `map` 的箭頭函式加了大括號，大括號裡的樣板字串算出來就丟掉了，每一筆都回傳 `undefined`。補上 `return` 之後，Console 出現 `TypeError: Cannot read properties of undefined (reading 'name')`：家醫科 108 今天還沒排醫師，API 回應裡沒有 `doctor` 欄位。改成 `c.doctor?.name` 之後畫面出來了，皮膚科 112 卻顯示「未提供 人」，它今天的候診人數是 0，`||` 把 0 當成沒有值。最後一個錯要切到別的頁面才發現：掛號頁的診間下拉選單順序也變了，因為 `sort` 直接改了傳進來的陣列，那個陣列和下拉選單共用。

四個錯都出在每天會寫到的語法上。這一課整理讀 AI 產出時最常遇到的寫法：宣告、箭頭函式、解構、展開、`?.` 與 `??`，以及陣列方法會不會改到原陣列。

## 運作原理

### `const`、`let` 與 `var`

| 宣告 | 能重新指定 | 有效範圍 | 用在 |
|---|---|---|---|
| `const` | 不能 | 所在的 `{}` 區塊 | 預設都用它 |
| `let` | 能 | 所在的 `{}` 區塊 | 之後會重新指定的變數，例如迴圈裡的累加 |
| `var` | 能 | 整個函式 | 新程式不用；舊程式碼與舊範例裡才看得到 |

`const` 鎖住的是「這個名字指向哪一份資料」。`const list = []` 之後 `list.push(1)` 合法，陣列內容變了；`list = [1]` 才會丟出 `TypeError: Assignment to constant variable.`。

### 箭頭函式的回傳

| 寫法 | 回傳什麼 |
|---|---|
| `(n) => n * 2` | `n * 2` 的結果 |
| `(n) => { n * 2 }` | `undefined`：有大括號就是函式本體，要自己寫 `return` |
| `(n) => { return n * 2 }` | `n * 2` 的結果 |
| `() => { name: '王' }` | `undefined`：大括號被當成函式本體，`name:` 被當成 label |
| `() => ({ name: '王' })` | 物件 `{ name: '王' }` |
| `() => { id: 1, name: '王' }` | 直接是語法錯誤 `SyntaxError: Unexpected token ':'` |

AI 產出的 `map`、`filter` 回呼最常錯在這裡：為了多寫一行而加了大括號，卻沒有補 `return`。

### 解構與預設值

```js
const { dept, room, doctor } = clinic          // 取出三個欄位
const { waiting: count } = clinic               // 改名：變數叫 count
const { note = '無' } = clinic                  // 欄位是 undefined 時用預設值
const [first, second] = clinics                 // 從陣列依位置取
function label({ dept, room }) { /* … */ }     // 參數直接解構
```

預設值只在值是 `undefined` 時生效，`null` 不算。API 回 `{ "doctor": null }` 時，`const { doctor = { name: '醫師未定' } } = clinic` 拿到的是 `null`，接著讀 `doctor.name` 一樣出錯。對 `null` 或 `undefined` 本身解構會直接丟出 `TypeError: Cannot destructure property 'name' of 'undefined' as it is undefined.`。

### 展開與 rest

- `{ ...clinic, waiting: 0 }`：複製 `clinic` 的欄位，再覆寫 `waiting`。後寫的蓋掉先寫的。
- `[...list, newItem]`、`[newItem, ...list]`：加在後面或前面，原陣列不變。
- `function notify(...ids)`：寫在參數裡是 rest，把剩下的參數收成陣列。
- 展開只複製第一層，巢狀的物件仍然共用，見 [值、參考與不可變更新](#/skill/values-references)。

### `?.`、`??` 與 `||`

`a?.b` 在 `a` 是 `null` 或 `undefined` 時直接得到 `undefined`，不再往下讀；`fn?.()` 在函式不存在時不呼叫。`??` 與 `||` 都是「左邊沒有值就用右邊」，差在怎樣算沒有值。下表的 A 是 `v || '未提供'`，B 是 `v ?? '未提供'`：

| 左邊的值 `v` | A | B |
|---|---|---|
| `12` | `12` | `12` |
| `0` | `'未提供'` | `0` |
| `''`（空字串） | `'未提供'` | `''` |
| `false` | `'未提供'` | `false` |
| `null` | `'未提供'` | `'未提供'` |
| `undefined` | `'未提供'` | `'未提供'` |

`||` 把 `0`、`''`、`false`、`NaN` 這些 falsy 值都當成沒有值。候診人數、金額、勾選狀態這類 0 與 `false` 有意義的欄位，用 `??`。`?.` 與 `??` 都是 ES2020 加入的語法。

### 陣列方法：回傳什麼、改不改原陣列

| 方法 | 回傳 | 改原陣列 |
|---|---|---|
| `map(fn)` | 新陣列，長度相同 | 不改 |
| `filter(fn)` | 新陣列，只留回呼回傳 truthy 的 | 不改 |
| `find(fn)`、`findIndex(fn)` | 第一個符合的元素或索引；找不到是 `undefined`、`-1` | 不改 |
| `some(fn)`、`every(fn)` | 布林 | 不改 |
| `reduce(fn, init)` | 累加出的一個值 | 不改 |
| `slice()`、`concat()` | 新陣列 | 不改 |
| `toSorted()`、`toReversed()`、`toSpliced()`、`with()` | 新陣列（ES2023，Baseline 2023） | 不改 |
| `sort()`、`reverse()`、`splice()` | 原陣列本身 | 改 |
| `push()`、`pop()`、`shift()`、`unshift()` | 新長度或取出的元素 | 改 |
| `forEach(fn)` | `undefined` | 不改（但回呼裡可以改） |

`sort()` 還有一個陷阱：不給比較函式時，元素先轉成字串再比。`[10, 9, 1, 100].sort()` 的結果是 `[1, 10, 100, 9]`。數字一定要給 `(a, b) => a - b`。

`Object.groupBy(list, fn)`（ES2024，Baseline 2024，2026 年 9 月起 Widely available）把陣列依回呼的結果分組，取代以前用 `reduce` 手寫的分組。目標瀏覽器較舊的專案，用之前先確認 build target。它回傳的物件沒有原型：`byDept.hasOwnProperty('內科')` 丟出 `TypeError`，改用 `Object.hasOwn(byDept, '內科')` 或 `byDept['內科'] ?? []`。沒有任何資料的科別不會出現，讀到的是 `undefined`，不是空陣列。分組時要同時加總或轉換（例如每組只留 id、算人數），照樣用 `reduce`。

### `===` 與 `==`

`==` 會先轉型再比：`'1' == 1`、`null == undefined`、`[] == false` 都是 `true`。一律用 `===`。物件與陣列用 `===` 比的是「是不是同一份」，內容一樣的兩個物件不相等。

## 實際程式碼

下面幾段在本站的 JavaScript 執行環境（Web Worker）裡跑，按「在 Playground 開啟」可以改資料再跑。

### `??` 與 `||`、預設值與 `null`

```js run
const values = [12, 0, '', false, null, undefined]
for (const v of values) {
  console.log(JSON.stringify(v) ?? 'undefined', '→ ||:', v || '未提供', '／ ??:', v ?? '未提供')
}

// 解構的預設值只在 undefined 時生效
const a = { doctor: undefined }
const b = { doctor: null }
const { doctor: d1 = { name: '醫師未定' } } = a
const { doctor: d2 = { name: '醫師未定' } } = b
console.log('undefined 時：', d1.name)
console.log('null 時：', d2)   // null，預設值沒有生效
console.log('用 ?. 加 ?? 才兩種都接得住：', b.doctor?.name ?? '醫師未定')
```

### 箭頭函式的回傳

```js run
const nums = [1, 2, 3]
console.log(nums.map((n) => n * 2))              // [2,4,6]
console.log(nums.map((n) => { n * 2 }).map(String))   // 每個都是 undefined
console.log(nums.map((n) => { return n * 2 }))   // [2,4,6]

const asLabel = (n) => { label: `第 ${n} 號` }        // 大括號是函式本體
const asObject = (n) => ({ label: `第 ${n} 號` })     // 包一層括號才是物件
console.log(asLabel(5), asObject(5))
```

### 改好的 `summarizeClinics`

```js run
const clinics = [
  { id: 1, dept: '內科', room: '101', waiting: 12, doctor: { name: '王醫師' } },
  { id: 2, dept: '皮膚科', room: '112', waiting: 0, doctor: { name: '張醫師' } },
  { id: 3, dept: '家醫科', room: '108', waiting: 6 },                // 還沒排醫師
  { id: 4, dept: '眼科', room: '305', waiting: 9, doctor: null },
]

function summarizeClinics(list) {
  const lines = list
    .toSorted((a, b) => b.waiting - a.waiting)   // 由多到少，不改原陣列
    .map(({ dept, room, waiting, doctor }) =>
      `${dept} ${room}（${doctor?.name ?? '醫師未定'}）：${waiting ?? '未提供'} 人`)
  const total = list.reduce((sum, c) => sum + c.waiting, 0)   // 初始值 0
  return { lines, total }
}

const { lines, total } = summarizeClinics(clinics)
lines.forEach((line) => console.log(line))
console.log('總候診', total, '人')
console.log('原陣列順序沒變：', clinics.map((c) => c.id).join(','))
console.log('空陣列：', JSON.stringify(summarizeClinics([])))
```

### `sort` 改到原陣列

```js run
const waiting = [10, 9, 1, 100]
console.log('不給比較函式：', [...waiting].sort())          // 依字串排
console.log('數字由小到大：', waiting.toSorted((a, b) => a - b))
console.log('原陣列：', waiting)

const shared = [3, 1, 2]
const sorted = shared.sort((a, b) => a - b)
console.log('sort 回傳的就是原陣列：', sorted === shared, shared)
```

### 篩選、分組與加總

```js run
const appts = [
  { id: 501, dept: '內科', status: 'booked', fee: 150 },
  { id: 502, dept: '眼科', status: 'cancelled', fee: 150 },
  { id: 503, dept: '內科', status: 'checked-in', fee: 0 },     // 免掛號費
  { id: 504, dept: '骨科', status: 'booked', fee: 200 },
]
const active = appts.filter((a) => a.status !== 'cancelled')
console.log('有效掛號', active.map((a) => a.id))
console.log('有沒有人已報到：', active.some((a) => a.status === 'checked-in'))
console.log('找 504：', active.find((a) => a.id === 504)?.dept)
console.log('找 999：', active.find((a) => a.id === 999)?.dept ?? '找不到')
console.log('掛號費合計：', active.reduce((sum, a) => sum + a.fee, 0))

// ES2024：依科別分組（Baseline 2024）
const byDept = Object.groupBy(active, (a) => a.dept)
for (const [dept, list] of Object.entries(byDept)) console.log(dept, list.length, '筆')
```

## 常見錯誤與錯誤訊息

| 訊息或現象 | 原因 | 修法 |
|---|---|---|
| `TypeError: Cannot read properties of undefined (reading 'name')` | 讀了 `undefined` 的屬性；Safari 的訊息是 `undefined is not an object (evaluating 'c.doctor.name')` | 用 `?.`；先到 Network 分頁確認 API 實際的欄位 |
| `TypeError: Cannot destructure property 'name' of 'undefined' as it is undefined.` | 對 `undefined` 解構，常見於參數沒傳或 API 回應少一層 | 參數給預設值 `({ name } = {})`，或先檢查 |
| `TypeError: Reduce of empty array with no initial value` | 空陣列呼叫 `reduce` 沒給初始值 | 一律給第二個參數 |
| `TypeError: Assignment to constant variable.` | 對 `const` 重新指定 | 要重新指定就用 `let`；只是改內容不用重新指定 |
| `TypeError: clinics.map is not a function` | 拿到的不是陣列：API 包了一層 `{ items: [...] }`，或拿到 Promise 本身 | 看 Response 的形狀；呼叫時加 `await` |
| `TypeError: undefined is not iterable` | 對 `undefined` 展開或 `for...of` | 確認資料存在，或 `list ?? []` |
| `SyntaxError: Unexpected token ':'` | 箭頭函式想回傳物件卻沒包括號 | `() => ({ … })` |
| 畫面顯示 `undefined` 或清單空白 | `map` 的回呼加了大括號沒 `return` | 拿掉大括號或補 `return` |
| 數字排序成 `1, 10, 100, 9` | `sort()` 沒給比較函式 | `(a, b) => a - b` |
| 別的元件的清單順序也變了 | `sort`、`reverse`、`splice` 改了共用的陣列 | `toSorted` 或先複製再排 |

候診 0 人顯示成「未提供」這種錯不會有任何訊息：預設值用了 `||`，改成 `??`。用 `filter(Boolean)` 清掉空值時也一樣，0 與空字串會跟著被濾掉。

## 動手

- 按第一段的「在 Playground 開啟」，在 `values` 加上 `NaN`，看 `||` 與 `??` 各得到什麼。
- 在「改好的 `summarizeClinics`」把 `toSorted` 換成 `sort`，看最後一行「原陣列順序」怎麼變。
- 同一段把 `reduce` 的初始值 `0` 拿掉，再跑 `summarizeClinics([])`，看錯誤訊息。
- 讀一段 AI 產出的元件，把每個 `map`、`filter` 回呼與每個 `||` 都檢查一遍：有大括號的有沒有 `return`、`||` 左邊會不會是 0 或空字串。
- 資料是參考還是複本、為什麼 `sort` 會影響別的元件，接著讀 [值、參考與不可變更新](#/skill/values-references)。

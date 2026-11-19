## 從一個具體問題開始：手機號碼的 0 不見了

掛號表單上線第一天，櫃台回報四件事：

1. 送到後端的手機號碼是 `912345678`，開頭的 0 不見了，簡訊發不出去。
2. 一打開表單，每個欄位底下都是紅字「必填」，病人還沒開始填。
3. 用注音打姓名，打到一半欄位就跳「請填姓名」，選完字才消失。
4. 症狀勾了「發燒」，「咳嗽」也跟著被勾起來。

看程式碼，原因分別是：手機欄位寫了 `v-model.number`；錯誤訊息只看「值合不合法」，沒看使用者碰過這個欄位沒有；姓名的驗證掛在 `@input` 上，選字期間 `v-model` 還沒更新；症狀的初始值寫成 `symptoms: ''` 而不是陣列。這些都出在 `v-model` 綁出來的值與驗證時機。

## 運作原理

### v-model 在原生輸入元素上做了什麼

`v-model` 依元素種類綁不同的屬性與事件，綁出來的型別也不同（Vue 3.5 實測）：

| 元素 | 綁的屬性與事件 | 狀態的型別 |
|---|---|---|
| `<input>`、`<textarea>` | `value`，`input` 事件 | 字串 |
| `<input type="number">` | 同上，自動轉數字 | 數字；清空時是空字串 `''` |
| 單一 `<input type="checkbox">` | `checked`，`change` 事件 | 布林（或 `true-value`／`false-value` 指定的值） |
| 多個 checkbox 綁同一個陣列 | 同上 | 陣列，放勾選項目的 `value` |
| `<input type="radio">` | `checked`，`change` 事件 | 選到的那個 `value` |
| `<select>` | `value`，`change` 事件 | 選到的 `<option>` 的 `value`（沒寫 `value` 時是選項的文字） |
| `<select multiple>` | 同上 | 陣列 |

多個 checkbox 的初始值不是陣列時，Vue 把它當成單一 checkbox：勾一個，狀態變成 `true`，每個 checkbox 都顯示成已勾選。開頭的第四個狀況是這樣來的。

`v-model` 以 JavaScript 的狀態為準，會忽略元素上寫死的 `value`、`checked`、`selected`。初始值寫在 `ref` 或 `reactive` 裡。

`<select>` 的初始值對不到任何選項時，畫面顯示未選取。Vue 官方文件提到 iOS 在這種狀態下選第一個選項不會觸發 `change`，建議第一個選項放 `<option disabled value="">請選擇</option>`。

### 修飾符

| 寫法 | 輸入 | 綁到的值 |
|---|---|---|
| `v-model.trim` | `'  王小明 '` | `'王小明'` |
| `v-model.number` | `'42'` | `42` |
| `v-model.number` | `'12abc'` | `12`（`parseFloat` 的結果） |
| `v-model.number` | `'abc'` | `'abc'`（轉不了就保留字串） |
| `v-model.number` | `'0912345678'` | `912345678` |
| `v-model.lazy` | 每打一個字 | 不更新；離開欄位（`change`）時才更新 |

電話、郵遞區號、身分證字號、病歷號這種「長得像數字的字串」不要加 `.number`。要叫出手機的數字鍵盤，用 `inputmode="numeric"`，值仍然是字串。

### 中文輸入法選字

注音、倉頡、拼音輸入法打字時，瀏覽器先送出 `compositionstart`，選字期間的 `input` 事件帶著還沒確定的字（例如注音符號），選完字送出 `compositionend`。Vue 的 `v-model` 在選字期間不更新狀態，選完字才更新：

| 時間點 | 輸入框顯示 | `v-model` 綁的值 |
|---|---|---|
| 打「ㄨㄤˊ」 | `ㄨㄤˊ` | `''` |
| 選字「王」 | `王` | `'王'` |

多數情況這是想要的：搜尋不會拿注音符號去打 API。如果需求是「邊打邊顯示候選」，改用 `:value` 加 `@input` 自己處理，選字期間也會收到事件。驗證掛在 `@input` 時要知道這個時間差：開頭的第三個狀況，是驗證讀到了選字前、還沒更新的值。

### 驗證時機

| 時機 | 優點 | 問題 |
|---|---|---|
| 每次輸入（`input`） | 回饋最即時 | 打到一半就出現錯誤，很干擾 |
| 離開欄位（`blur`） | 填完一欄才判斷 | 改正之後要再離開一次才消失 |
| 送出時（`submit`） | 最不干擾 | 錯誤累積到最後才看到 |

常見的組合：欄位第一次離開（touched）之後才顯示錯誤，之後隨輸入即時更新，讓改正的人立刻看到錯誤消失；按送出時把所有欄位都當成碰過，全部檢查，焦點移到第一個錯的欄位。CSS 的 `:user-invalid` 偽類採用相同的時機（使用者互動過或嘗試送出之後才符合），Baseline 2023 起各主要瀏覽器都支援，但它只看瀏覽器內建的限制驗證。

### 瀏覽器內建的限制驗證

`required`、`pattern`、`min`、`max`、`maxlength`、`type="email"` 由瀏覽器檢查：按送出時不合規則就擋下並顯示提示泡泡，`input.validity` 告訴你是哪一條不合、`setCustomValidity('…')` 可以換掉訊息。多數設計系統要自己的錯誤樣式與文案，這時在 `<form>` 加 `novalidate` 關掉提示泡泡，仍然可以用 `checkValidity()` 與 `validity` 讀結果，或在 Vue 裡自己寫規則。

錯誤訊息要讓螢幕報讀器也知道：

- 欄位有錯時加 `aria-invalid="true"`。
- 錯誤訊息的元素給一個 `id`，寫進輸入框的 `aria-describedby`，報讀器讀到欄位時會接著唸出錯誤。
- 用顏色標示之外，訊息要有文字。

### 表單函式庫

欄位一多，「碰過沒有、改過沒有、送出過沒有」這些狀態會讓元件變得很長。VeeValidate 這類函式庫把它們整理成每個欄位的狀態物件，規則用 zod 這類 schema 寫，TypeScript 型別從同一份 schema 推導。函式庫只是把同樣的機制包起來：綁定、驗證時機、錯誤顯示的規則和本課一樣。

## 實際程式：掛號表單

```vue
<script setup>
import { reactive, ref, computed, nextTick } from 'vue'

const d = new Date()
const today = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')

const form = reactive({ name: '', phone: '', birthday: '', visit: 'first', symptoms: [] })   // symptoms 一定要是陣列
const touched = reactive({})            // 離開過的欄位：{ name: true, … }
const submitted = ref(false)
const sending = ref(false)

const rules = {
  name: (v) => (v ? '' : '請填姓名'),
  phone: (v) => (!v ? '請填手機號碼' : /^09\d{8}$/.test(v) ? '' : '手機號碼是 09 開頭、共 10 碼'),
  birthday: (v) => (!v ? '請填生日' : v > today ? '生日不能晚於今天' : ''),   // YYYY-MM-DD 字串可以直接比大小
  symptoms: (v) => (v.length ? '' : '至少勾選一項症狀'),
}
const errors = computed(() => Object.fromEntries(Object.entries(rules).map(([k, rule]) => [k, rule(form[k])])))
const show = (k) => ((touched[k] || submitted.value) && errors.value[k]) || ''   // 碰過或送出過才顯示

const FIELD_ORDER = ['name', 'phone', 'birthday', 'symptoms']
const FOCUS_ID = { name: 'name', phone: 'phone', birthday: 'birthday', symptoms: 'symptom-fever' }

async function onSubmit() {
  submitted.value = true
  const first = FIELD_ORDER.find((k) => errors.value[k])
  if (first) {
    await nextTick()                                      // 等錯誤訊息渲染出來再移焦點
    document.getElementById(FOCUS_ID[first])?.focus()
    return
  }
  if (sending.value) return                               // 送出中不再送第二次
  sending.value = true
  try {
    const res = await fetch('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)    // 422 的欄位錯誤要對回欄位，見「表單送出與驗證錯誤」
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <form novalidate @submit.prevent="onSubmit">
    <label for="name">姓名</label>
    <input id="name" v-model.trim="form.name" autocomplete="name" @blur="touched.name = true"
           :aria-invalid="show('name') ? 'true' : undefined" :aria-describedby="show('name') ? 'name-error' : undefined">
    <p v-if="show('name')" id="name-error" class="error">{{ show('name') }}</p>

    <label for="phone">手機</label>
    <input id="phone" v-model="form.phone" inputmode="numeric" autocomplete="tel" maxlength="10" @blur="touched.phone = true"
           :aria-invalid="show('phone') ? 'true' : undefined" :aria-describedby="show('phone') ? 'phone-error' : undefined">
    <p v-if="show('phone')" id="phone-error" class="error">{{ show('phone') }}</p>

    <label for="birthday">生日</label>
    <input id="birthday" type="date" v-model="form.birthday" :max="today" @blur="touched.birthday = true"
           :aria-invalid="show('birthday') ? 'true' : undefined" :aria-describedby="show('birthday') ? 'birthday-error' : undefined">
    <p v-if="show('birthday')" id="birthday-error" class="error">{{ show('birthday') }}</p>

    <fieldset>
      <legend>初診或複診</legend>
      <label><input type="radio" value="first" v-model="form.visit"> 初診</label>
      <label><input type="radio" value="return" v-model="form.visit"> 複診</label>
    </fieldset>

    <fieldset :aria-describedby="show('symptoms') ? 'symptoms-error' : undefined" @focusout="touched.symptoms = true">
      <legend>症狀</legend>
      <label><input id="symptom-fever" type="checkbox" value="fever" v-model="form.symptoms"> 發燒</label>
      <label><input type="checkbox" value="cough" v-model="form.symptoms"> 咳嗽</label>
      <label><input type="checkbox" value="rash" v-model="form.symptoms"> 皮膚疹</label>
      <p v-if="show('symptoms')" id="symptoms-error" class="error">{{ show('symptoms') }}</p>
    </fieldset>

    <button type="submit" :disabled="sending">{{ sending ? '送出中…' : '送出掛號' }}</button>
  </form>
</template>
```

幾個細節：`<form novalidate>` 關掉瀏覽器的提示泡泡，改顯示自己的訊息；`@submit.prevent` 擋掉表單預設的整頁送出；錯誤訊息只在要顯示時才渲染，`aria-describedby` 也只在那時才指過去；送出按鈕寫明 `type="submit"`，表單裡其他按鈕（例如「清除」）要寫 `type="button"`，否則按了也會送出表單。

## React 對照

| Vue 3.5 | React 19 |
|---|---|
| `<input v-model="form.name">` | `<input value={name} onChange={(e) => setName(e.target.value)} />`（受控元件） |
| `v-model.trim`、`.number` | 在 `onChange` 或送出時自己處理 |
| checkbox 綁陣列 | `checked={symptoms.includes('fever')}`，`onChange` 裡自己加減陣列 |
| `@submit.prevent="onSubmit"` | `onSubmit={(e) => { e.preventDefault(); … }}`，或 React 19 的 `<form action={fn}>` 與 `useActionState` |
| VeeValidate 加 zod | React Hook Form 加 zod 這類組合 |

```jsx
export function PhoneField({ value, onChange, touched, onBlur }) {
  const error = !value ? '請填手機號碼' : /^09\d{8}$/.test(value) ? '' : '手機號碼是 09 開頭、共 10 碼'
  const show = touched && error
  return (
    <>
      <label htmlFor="phone">手機</label>
      <input id="phone" value={value} inputMode="numeric" autoComplete="tel"
             onChange={(e) => onChange(e.target.value)} onBlur={onBlur}
             aria-invalid={show ? 'true' : undefined} aria-describedby={show ? 'phone-error' : undefined} />
      {show && <p id="phone-error">{error}</p>}
    </>
  )
}
```

React 的屬性名稱用 camelCase（`inputMode`、`autoComplete`、`htmlFor`），`aria-*` 維持原樣。

## 常見錯誤與錯誤訊息

| 現象 | 原因 | 修法 |
|---|---|---|
| 手機、郵遞區號開頭的 0 不見 | 加了 `.number`，或用了 `type="number"` | 保留字串，用 `inputmode="numeric"` |
| 勾一個 checkbox，同組全部變勾選 | 多個 checkbox 綁到非陣列的值 | 初始值寫 `[]` |
| 輸入框上的 `value="…"` 沒出現 | `v-model` 忽略元素上的 `value` | 初始值寫在 script |
| 一打開表單就滿版錯誤 | 只看值合不合法，沒看碰過沒有 | 加上 touched，或送出後才顯示 |
| 用注音打到一半跳錯誤 | 驗證讀到選字前的值 | 等 `blur` 再驗證，或處理 `compositionend` |
| 按「清除」也送出了表單 | 表單裡的 `<button>` 預設 `type="submit"` | 寫明 `type="button"` |
| 按送出後整頁重新載入 | `@submit` 少了 `.prevent` | 加 `.prevent` |
| `<select>` 的初始值是空字串，iOS 上第一個選項選不到 | 初始值對不到任何 `<option>` | 第一個放 `<option disabled value="">請選擇</option>` |
| 報讀器只唸出「手機，編輯文字」 | 錯誤沒有連到欄位 | 加 `aria-invalid` 與 `aria-describedby` |
| 連點送出，後端收到兩筆掛號 | 送出中沒有停用、沒有擋 | `sending` 旗標加上按鈕 `disabled` |

## 動手

1. 在自己的專案把手機欄位加上 `.number`，輸入 `0912345678` 後在 Vue DevTools 看綁到的值；拿掉 `.number` 改成 `inputmode="numeric"`，在手機上確認叫出的是數字鍵盤。
2. 把 `symptoms: []` 改成 `symptoms: ''`，勾一個症狀看其他選項的變化，再改回來。
3. 用注音在姓名欄打字，在 `watch(() => form.name, (v) => console.log(v))` 印出的內容裡確認選字前沒有更新。
4. 欄位全空直接按送出：確認焦點跳到姓名欄（Console 執行 `document.activeElement`），Elements 分頁看 `aria-invalid` 與 `aria-describedby`。
5. 後端回 `422` 時怎麼把錯誤對回欄位、怎麼防止重複送出，接著讀 [表單送出與驗證錯誤](#/skill/form-submit)；伺服器端的驗證在 [輸入驗證與檔案上傳](#/skill/input-validation)。

## 這階段要做出什麼

從診次卡片的「掛號」進到 `/sessions/:id/book`。櫃台輸入病歷號與備註，送出 `POST /api/sessions/{id}/appointments`，成功回 201 與新的掛號（含號碼 `number`）。按下送出之後的每一種結果都要有對應的畫面：

| 回應 | 意思 | 畫面 | 表單內容 |
|---|---|---|---|
| 201 | 掛好了 | `role="status"` 顯示「掛號成功：第 N 號」 | 清空 |
| 422 | 欄位內容不對 | 訊息放在各欄位下方，焦點移到第一個出錯的欄位 | 保留 |
| 409 | 欄位都對，業務規則不允許 | 上方 `role="alert"` 依 `type` 顯示中文，附「選擇其他診次」 | 保留 |
| 5xx、網路錯誤 | 沒送到或伺服器出錯 | 上方提示「再送出一次」 | 保留 |

另外兩件事：送出中擋住第二次送出（連點、在輸入框按 Enter），以及網路斷掉後重送時不會變成兩筆掛號。

409 的 `type` 由後端定義（後端實作路線第 3 階段）：`…/session-full`、`…/already-booked`、`…/daily-limit`。欄位錯誤的格式、樂觀更新與冪等鍵的生命週期在 [表單送出與驗證錯誤](#/skill/form-submit)；按鈕的 loading、disabled 與焦點在 [互動狀態](#/skill/ui-states)；`aria-invalid`、`aria-describedby` 的寫法在 [表單綁定與驗證](#/skill/forms)。

## 設計決策與取捨

### errors 的格式先轉成一種

`errors` 不是 Problem Details（RFC 9457）的標準欄位，各家寫法不同：

| 來源 | 寫法 |
|---|---|
| 站上沙箱的假 API | `{ "patient_id": ["查無此病歷號"] }` |
| 後端參考專案 `companion/clinic-api` | `[{ "field": "patient_id", "message": "…" }]` |
| RFC 9457 的範例 | `[{ "pointer": "#/patient_id", "detail": "…" }]` |

`toFormErrors` 把三種都轉成「每個欄位一則訊息」加「對不到欄位的訊息」。表單欄位的名稱直接用後端的 `patient_id`；前端想用 camelCase 時，要在這裡加一張對照表，否則訊息永遠對不上欄位。對不到欄位的錯誤（例如後端多驗了 `session_id`）放在表單上方，寫成「欄位：訊息」，不丟掉。

### 欄位錯誤要讓螢幕閱讀器知道

出錯的輸入框加 `aria-invalid="true"`，`aria-describedby` 指向訊息的 `id`。訊息只在有錯時才渲染，`aria-describedby` 也只在那時才指過去：`aria-describedby` 指到的文字就算隱藏著也會被念出來，一直綁著的話，使用者還沒操作就先聽到錯誤。送出失敗後焦點移到表單上第一個出錯的欄位（依表單的順序，不依 `errors` 物件的順序），螢幕閱讀器聚焦到欄位時會一起念出它的錯誤。

### 409 依 type 換文案

`title` 是英文（`Session full`），`detail` 由後端寫、措辭不一定適合病患或櫃台。畫面用 `type` 對一張中文表，對不到的再退回 `detail`。409 代表這次的內容不會成功，附上下一步：「選擇其他診次」。

### 防重複送出有三層

| 來源 | 擋法 |
|---|---|
| 連點兩下 | 送出中按鈕 `disabled` |
| 按鈕停用了，在輸入框按 Enter；或停用生效前的同一個瞬間又點了一次 | 處理 `<form>` 的 `submit`，開頭用 `submitting` 旗標 return |
| 網路逾時、斷線後重送，第一次可能已經寫進資料庫 | `Idempotency-Key` 標頭：同一次送出的重送帶同一個鍵 |

`Idempotency-Key` 要後端支援（目前是 IETF 的草案，後端的實作在 [分頁、篩選、版本與冪等鍵](#/skill/api-patterns)）。鍵的生命週期：按下送出時用 `crypto.randomUUID()` 產生；網路錯誤或 5xx 後重送沿用同一個；收到 201、409、422 代表這次已經有結果，下一次送出換新的；使用者改了欄位內容也換新的。`crypto.randomUUID()` 只在 secure context（HTTPS 或 localhost）能用，用 `http://` 的內網網址部署時它是 `undefined`。

### 成功的回饋放在一直存在的 live region

「掛號成功：第 5 號」寫進一個從頁面一開始就在 DOM 裡的 `<p role="status">`，之後只改它的文字。訊息出現時才插入的 live region，部分螢幕閱讀器不會念。成功時清空病歷號與備註，櫃台可以接著掛下一位；失敗時一律保留輸入的內容。

一開始就停用送出鈕（必填沒填完就 `disabled`）的做法這裡不用：使用者不知道為什麼不能按，用鍵盤也 Tab 不到它。表單加 `novalidate`，必填與格式交給後端的 422，訊息格式只有一套。

## 關鍵程式

```js
// src/lib/formErrors.js：422 的 Problem Details → { fields: { 欄位: 訊息 }, form: [對不到欄位的訊息] }
// errors 不是 RFC 9457 的標準欄位，各家寫法不同：本站的假 API 是 { 欄位: ['訊息'] }，
// 後端參考專案是 [{ field, message }]，RFC 9457 的範例是 [{ pointer, detail }]。三種都收。
export function toFormErrors(problem, knownFields) {
  const raw = problem?.errors
  const list = Array.isArray(raw)
    ? raw.map((e) => ({ name: e.field ?? e.pointer?.replace(/^#?\//, '').replaceAll('/', '.') ?? null, message: e.message ?? e.detail }))
    : Object.entries(raw ?? {}).map(([name, messages]) => ({ name, message: [].concat(messages)[0] }))
  const fields = {}
  const form = []
  for (const { name, message } of list) {
    if (name && knownFields.includes(name)) fields[name] ??= message ?? '格式不正確'   // 同一欄位只顯示第一則
    else form.push(name ? `${name}：${message}` : message)
  }
  if (!list.length) form.push(problem?.detail ?? '送出的內容有誤')
  return { fields, form }
}
```

掛號頁。`apiFetch` 是第 1 階段那一支，非 2xx 時丟出帶 `status` 與 `problem` 的 `ApiError`，網路錯誤時 `fetch` 丟出的 `TypeError` 原樣往外傳：

```vue
<script setup>
import { ref, reactive, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { apiFetch } from '@/api/client'
import { toFormErrors } from '@/lib/formErrors'

const props = defineProps({ id: { type: String, required: true } })   // 路由參數 /sessions/:id/book
const router = useRouter()

const FIELDS = ['patient_id', 'note']                         // 表單上的順序，名稱和後端一致
const INPUT_ID = { patient_id: 'patient-id', note: 'note' }
const CONFLICT_TEXT = {
  'https://clinic.example/problems/session-full': '這個診次已額滿',
  'https://clinic.example/problems/already-booked': '這位病患已經掛過這個診次',
  'https://clinic.example/problems/daily-limit': '這位病患今天的掛號數已達上限',
}

const fields = reactive({ patient_id: '', note: '' })
const fieldErrors = ref({})
const formError = ref(null)          // { text, pickSession }
const message = ref('')              // 寫進一直存在的 role="status"
const submitting = ref(false)
let idempotencyKey = null

watch(fields, () => { idempotencyKey = null })   // 內容改了，下一次是新的請求

async function submit() {
  if (submitting.value) return
  submitting.value = true
  fieldErrors.value = {}
  formError.value = null
  message.value = ''
  idempotencyKey ??= crypto.randomUUID()
  try {
    const appt = await apiFetch(`/sessions/${props.id}/appointments`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: { patient_id: Number(fields.patient_id), note: fields.note },
    })
    idempotencyKey = null
    message.value = `掛號成功：第 ${appt.number} 號`
    fields.patient_id = ''
    fields.note = ''
  } catch (err) {
    if (err.status === 401) return                          // apiFetch 已經換到登入頁
    if (err.status === 422) {
      idempotencyKey = null
      const { fields: f, form } = toFormErrors(err.problem, FIELDS)
      fieldErrors.value = f
      if (form.length) formError.value = { text: form.join('；') }
      await nextTick()
      const firstField = FIELDS.find((k) => f[k])
      if (firstField) document.getElementById(INPUT_ID[firstField]).focus()
    } else if (err.status === 409) {
      idempotencyKey = null
      formError.value = { text: CONFLICT_TEXT[err.problem?.type] ?? err.problem?.detail ?? '無法完成掛號', pickSession: true }
    } else if (err.status >= 500) {
      formError.value = { text: '系統暫時無法處理，請再送出一次' }         // 保留鍵：重送是同一筆
    } else if (err instanceof TypeError) {
      formError.value = { text: '無法連線，請檢查網路後再送出一次' }       // 保留鍵與輸入
    } else {
      formError.value = { text: err.problem?.detail ?? '無法完成掛號' }
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main>
    <h1 tabindex="-1">掛號</h1>
    <form novalidate @submit.prevent="submit">
      <div v-if="formError" role="alert" class="form-error">
        <p>{{ formError.text }}</p>
        <button v-if="formError.pickSession" type="button" @click="router.push({ name: 'sessions' })">選擇其他診次</button>
      </div>

      <label for="patient-id">病歷號</label>
      <input id="patient-id" v-model.trim="fields.patient_id" inputmode="numeric" autocomplete="off"
             :aria-invalid="fieldErrors.patient_id ? 'true' : undefined"
             :aria-describedby="fieldErrors.patient_id ? 'patient-id-error' : undefined">
      <p v-if="fieldErrors.patient_id" id="patient-id-error" class="field-error">{{ fieldErrors.patient_id }}</p>

      <label for="note">備註</label>
      <textarea id="note" v-model="fields.note" maxlength="200"
                :aria-invalid="fieldErrors.note ? 'true' : undefined"
                :aria-describedby="fieldErrors.note ? 'note-error' : undefined"></textarea>
      <p v-if="fieldErrors.note" id="note-error" class="field-error">{{ fieldErrors.note }}</p>

      <button type="button" @click="router.back()">返回</button>
      <button type="submit" :disabled="submitting">{{ submitting ? '送出中…' : '掛號' }}</button>
    </form>
    <p role="status" class="status">{{ message }}</p>
  </main>
</template>
```

幾個細節：「返回」寫了 `type="button"`，`<form>` 裡沒寫 `type` 的 `<button>` 預設是送出鈕；`watch(fields, …)` 讓使用者改了內容之後下一次送出換新的鍵；按鈕在送出中 `disabled` 時，有焦點的按鈕會失去焦點（Chromium 實測焦點掉到 `body`），所以結果寫進 live region 讓螢幕閱讀器念出來。

這段程式在 Chromium 裡跑過：第一次送出 201 顯示號碼；同一位病患再送一次收到 409，顯示「這位病患已經掛過這個診次」；422 用 `[{ field, message }]` 的格式回應時，`patient_id` 的訊息出現在欄位下方、焦點移到病歷號，`session_id` 的訊息出現在上方。

## 常見錯誤

**上方只顯示「Unprocessable Content」。** 只讀了 `title`。用 `errors` 對回欄位。

**欄位名稱對不上。** 後端 `patient_id`、前端 `patientId`，訊息永遠不會出現在欄位旁。名稱統一，或在 `toFormErrors` 前加對照表。

**409 之後表單被清空。** 清空寫在 `finally`。只有 201 才清空。

**按鈕停用了還是送出兩次。** 只擋了 `@click`，Enter 走的是表單的 `submit`。處理 `submit`，開頭檢查旗標。

**每次重送都換新的冪等鍵。** 後端認不出是同一筆，網路恢復後多了一筆掛號。網路錯誤與 5xx 沿用同一個鍵。

**成功訊息用 `v-if` 插入。** 螢幕閱讀器不一定念。`role="status"` 的元素一直在，只改文字。

**`aria-describedby` 指到不存在的 id。** 沒有錯誤時也寫著 `aria-describedby="patient-id-error"`。只在有錯時才綁。

**`crypto.randomUUID is not a function`。** 頁面不是 secure context。部署用 HTTPS；只能用 HTTP 的內網環境，改用 `crypto.getRandomValues()` 自己組字串。

## 驗收題在測什麼

**422 與 409**：422 的訊息出現在 `#patient-id-error`，輸入框有 `aria-invalid` 與指向它的 `aria-describedby`，上方沒有 alert，病歷號保留；兩個欄位都出錯時焦點在病歷號（表單上的第一個），即使 `errors` 物件裡備註排在前面；`session_id` 的錯誤以「session_id：…」出現在上方；`session-full` 與 `already-booked` 依 `type` 顯示中文，`role="alert"` 裡有「選擇其他診次」，表單內容保留；改正後再送成功時，舊的錯誤訊息與 `aria-invalid` 消失、表單清空。題目用的是假 API 的 `{ 欄位: ['訊息'] }` 格式。

**送出中、冪等鍵、成功的回饋**：`role="status"` 一開始就在而且是空的，成功後同一個元素顯示「掛號成功：第 N 號」；送出中按鈕停用、再送出也只有一個 POST；第一次網路錯誤、第二次成功時，兩個請求的 `Idempotency-Key` 相同且不是空的；兩次都成功時兩個鍵不同；網路錯誤後病歷號保留。

下一階段是「我的掛號」：列出掛過的號、分頁、取消。

## 串接驗收

從乾淨的資料開始（後端參考專案 `docker compose down -v` 後重跑 README 的三步驟），用[登入](#/project/fe-login)串接驗收的接線，以 `desk1` 登入（櫃台要輸入病歷號）。掛號有限流（每位使用者容量 5、每 6 秒補 1 個），連續送太快會收到 429，各步之間隔幾秒。

**1. 欄位錯誤。** 病歷號留空送出一次、填 `0` 送出一次、填 `3` 送出一次，先預測每次是前端擋下、後端回 422，還是成功。預期：留空由 `required` 擋下，沒有請求；`0` 回 422，訊息在病歷號下方、焦點移到病歷號；`3` 只有在送出的是數字時才成功。參考專案的 `patient_id` 是不做轉型的整數，`v-model` 沒加 `.number` 時送出的是字串 `"3"`，一樣回 422。參考專案的 `errors` 是 `[{ field, message }]`，`toFormErrors` 照樣把訊息放到欄位下。

**2. 額滿與重複。** 診次 1 的名額是 2。替病歷號 1、2 各掛一次，再替 3 掛一次，最後再替 1 掛一次，先預測後兩次的 `type`。預期：第三次是 `session-full`；第四次是 `already-booked`，因為檢查順序是重複 → 名額 → 每日上限（[第 2 階段](#/project/domain)）。兩次的 `role="alert"` 文案不同、表單內容都保留。

**3. 按兩次與重送。** 連點「送出」兩下，預期 Network 只有一個 POST。再在 Console 用同一個 `Idempotency-Key` 送兩次同樣的掛號（token 從 Network 裡登入的回應複製）：

```js
const h = { 'Content-Type': 'application/json', Authorization: 'Bearer <desk1 的 access_token>', 'Idempotency-Key': 'demo-key-1' }
for (const i of [1, 2]) console.log((await fetch('/api/sessions/2/appointments', { method: 'POST', headers: h, body: '{"patient_id":3}' })).status)
```

預期：201、409。參考專案沒有實作 `Idempotency-Key`，網路錯誤後的重送如果第一次已經寫進資料庫，會收到 `already-booked`。寫下這種情況畫面要說什麼（例如「這筆可能已經掛好，請到我的掛號確認」）；下一階段的[我的掛號](#/project/fe-appointments)就是確認的地方。

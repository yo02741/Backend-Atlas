## 從一個具體問題開始：掛了兩次號，錯誤只寫「Unprocessable Content」

櫃台幫病患掛號。網路有點慢，按了「掛號」之後畫面沒有反應，她又按了一次。結果病患有兩筆掛號，第二筆占掉了別人的名額。

隔天換另一位櫃台人員，漏填病歷號就送出。畫面上方跳出一行紅字「Unprocessable Content」，沒有說哪一欄錯。她改了備註再送一次，同樣的訊息。最後她選錯了診次，後端回 409「Session full」，表單整個被清空，病歷號要重打。

三件事都發生在送出之後：重複送出、後端的欄位錯誤沒有對回欄位、業務錯誤後丟掉了使用者輸入的資料。

## 運作原理

### 前端驗證與後端驗證的分工

| | 前端驗證 | 後端驗證 |
|---|---|---|
| 目的 | 讓使用者早點知道錯在哪 | 決定這筆資料能不能進系統 |
| 檢查 | 必填、格式、長度、範圍 | 前端那些全部再驗一次，加上要查資料的規則：病歷號存在、診次還有名額、同一天沒有重複掛號 |
| 能不能被繞過 | 能：關掉 JavaScript、直接用 `curl` 送 | 不能 |
| 失敗時 | 欄位旁邊的提示，不送出 | `422`（欄位錯）或 `409`（業務規則不允許） |

前端驗證是體驗；資料正確與否由後端負責。所以就算前端做得很完整，畫面還是要能顯示後端回來的錯誤。驗證在輸入中、離開欄位、送出時各檢查什麼，見 [表單綁定與驗證](#/skill/forms)；這一課從按下送出之後講起。

### 送出之後會收到什麼

本站後端參考專案（`companion/clinic-api`）的錯誤一律是 Problem Details（`application/problem+json`）：

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json

{
  "type": "https://clinic.example/problems/validation-error",
  "title": "Unprocessable Content",
  "status": 422,
  "detail": "欄位格式錯誤",
  "errors": {
    "patient_id": ["櫃台掛號必須指定 patient_id"]
  }
}
```

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://clinic.example/problems/session-full",
  "title": "Session full",
  "status": 409,
  "detail": "診次 7 名額已滿"
}
```

| 狀態碼 | 意思 | 畫面 |
|---|---|---|
| `201` | 建立成功，body 是新的掛號 | 導到詳細頁或顯示 Toast，清空表單 |
| `422` | 讀得懂，但欄位內容不對 | 依 `errors` 把訊息放到各欄位下方 |
| `409` | 欄位都對，但業務規則不允許（額滿、重複掛號） | 表單上方顯示原因與下一步，保留內容 |
| `401`、`403` | 沒登入、沒權限 | 見 [登入狀態與 401](#/skill/auth-frontend) |
| 網路錯誤、`5xx` | 沒送到，或伺服器出錯 | 表單上方顯示「再送一次」，保留內容 |

`errors` 不是 RFC 9457 定義的標準欄位，是擴充欄位，各家 API 的寫法不同。本站的契約（後端參考專案與沙箱的假 API，見 `companion/clinic-api/docs/contract.md`）是 `{ 欄位: [訊息, …] }`；也常見 `[{ field, message }]` 的陣列；RFC 9457 的範例用 `pointer`（JSON Pointer，例如 `#/age`）與 `detail`。前端要照自己後端的格式寫對應，下面的程式三種都處理。

`409` 的 `title` 是給開發者看的英文（`Session full`），`type` 才是穩定的識別碼。畫面依 `type` 對應中文文案，對不到的再退回通用訊息。後端怎麼設計這些錯誤，見 [錯誤設計](#/skill/error-design) 與 [輸入驗證與檔案上傳](#/skill/input-validation)。

### 欄位錯誤對回欄位

1. 依欄位名稱（`errors` 的 key、`field`，或 `pointer` 轉成的路徑）找到對應的輸入框。後端用 `patient_id`、前端用 `patientId` 時要有一張對照表，否則訊息永遠對不上。
2. 訊息放在輸入框正下方，輸入框加 `aria-invalid="true"`，`aria-describedby` 指向訊息元素的 `id`，螢幕閱讀器讀到欄位時會一起唸出錯誤。
3. 對不到任何欄位的錯誤（後端多驗了一個前端沒有的欄位、或沒有 `errors` 的 422）放在表單上方，不丟掉。
4. 焦點移到第一個出錯的欄位，鍵盤使用者不用從頭找。

### 重複送出從哪裡來

| 來源 | 擋法 |
|---|---|
| 連點兩次按鈕 | 送出中停用按鈕 |
| 按鈕停用了，使用者在輸入框按 Enter | 處理 `<form>` 的 `submit` 事件，裡面用 `submitting` 旗標擋第二次 |
| 回應很慢，使用者重新整理後再送一次；或程式在逾時後自動重送 | `Idempotency-Key`：同一次送出的重送帶同一個鍵，後端認得出是同一筆，回第一次的結果 |

前兩層在前端就擋得住；第三層需要後端支援。`Idempotency-Key` 目前是 IETF 的草案，伺服器那一側怎麼實作見 [分頁、篩選、版本與冪等鍵](#/skill/api-patterns)。鍵的生命週期：按下送出時產生，網路錯誤或 5xx 後重送沿用同一個；拿到 422 或 409 代表這次的內容不會成功，使用者修改後再送是新的請求，換一個鍵。

### 樂觀更新

一般的寫法是「送出 → 等回應 → 更新畫面」。樂觀更新反過來：先更新畫面，再送出，失敗時改回去。

| 時間 | 一般寫法 | 樂觀更新 |
|---|---|---|
| 0 ms | 按「取消掛號」，按鈕轉圈 | 按「取消掛號」，這一列立刻變成「已取消」 |
| 400 ms | 回應 200，這一列變成「已取消」 | 回應 200，什麼都不用做 |
| 400 ms（失敗時） | 顯示錯誤，這一列不變 | 這一列改回「已掛號」，顯示錯誤 |

適合的操作：幾乎都會成功、失敗了改回去不會造成誤會，例如取消掛號、加星號、改排序。不適合的操作：名額有限的掛號、付款，使用者看到「成功」就離開了，事後失敗會被當成系統騙人。

## 實際程式

### Problem Details 轉成表單錯誤

一個純函式，把 422 的回應轉成「每個欄位一則訊息」加「對不到欄位的訊息」，可以直接執行：

```js run
// 422 的 Problem Details → { fields: { 欄位: 訊息 }, form: [對不到欄位的訊息] }
// 三種寫法都處理：本站契約的 { 欄位: [訊息] }、陣列的 errors[].field，與 RFC 9457 範例的 errors[].pointer
function toFormErrors(problem, knownFields) {
  const raw = problem.errors
  const list = Array.isArray(raw)
    ? raw.map((e) => ({ name: e.field ?? (e.pointer ? e.pointer.replace(/^#?\//, '').replaceAll('/', '.') : null), message: e.message ?? e.detail }))
    : Object.entries(raw ?? {}).map(([name, messages]) => ({ name, message: [].concat(messages)[0] }))
  const fields = {}
  const form = []
  for (const { name, message = '格式不正確' } of list) {
    if (name && knownFields.includes(name)) fields[name] ??= message   // 同一欄位只顯示第一則
    else form.push(name ? `${name}：${message}` : message)
  }
  if (!list.length) form.push(problem.detail ?? problem.title ?? '送出失敗')
  return { fields, form }
}

const known = ['patient_id', 'note']
const samples = {
  '本站契約（{ 欄位: [訊息] }）': {
    type: 'https://clinic.example/problems/validation-error', title: 'Unprocessable Content', status: 422,
    errors: { patient_id: ['櫃台掛號必須指定 patient_id'] },
  },
  '陣列的寫法（field）': {
    title: 'Unprocessable Content', status: 422,
    errors: [{ field: 'note', message: '備註最多 200 字' }],
  },
  'RFC 9457 範例的寫法（pointer）': {
    title: 'Your request is not valid.', status: 422,
    errors: [
      { pointer: '#/patient_id', detail: 'must be a positive integer' },
      { pointer: '#/profile/color', detail: "must be 'green', 'red' or 'blue'" },
    ],
  },
  '沒有 errors 的 422': { title: 'Unprocessable Content', status: 422, detail: '這個時段已停止掛號' },
}
for (const [name, p] of Object.entries(samples)) console.log(`${name}\n  ${JSON.stringify(toFormErrors(p, known))}`)
```

第三個樣本的 `profile.color` 不在表單上，進了 `form`，畫面會在上方顯示它，不會消失。

### 掛號表單

```vue
<script setup>
import { ref, reactive, watch, nextTick, useTemplateRef } from 'vue'
import { useRouter } from 'vue-router'
import { toFormErrors } from '@/lib/formErrors'
import { useToast } from '@/composables/useToast'        // 專案自己的 Toast

const props = defineProps({ sessionId: { type: Number, required: true } })
const router = useRouter()
const toast = useToast()
const formEl = useTemplateRef('form')

// 409 依 type 對應中文；title 是給開發者看的英文
const CONFLICT_TEXT = {
  'https://clinic.example/problems/session-full': '這個診次已額滿',
  'https://clinic.example/problems/already-booked': '這位病患已經掛過這個診次',
  'https://clinic.example/problems/daily-limit': '這位病患今天的掛號數已達上限',
}

const fields = reactive({ patient_id: '' })   // 欄位名稱和後端一致，422 不用另外對照
const fieldErrors = ref({})
const formError = ref(null)                    // { text, pickSession }
const submitting = ref(false)
let idempotencyKey = null

watch(fields, () => { idempotencyKey = null })   // 內容改了，下一次是新的請求

async function submit() {
  if (submitting.value) return                 // 連按、Enter：第二次直接忽略
  submitting.value = true
  fieldErrors.value = {}
  formError.value = null
  idempotencyKey ??= crypto.randomUUID()       // 同一次送出的重送沿用同一個鍵
  try {
    const res = await fetch(`/api/sessions/${props.sessionId}/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ patient_id: Number(fields.patient_id) }),
    })
    if (res.status === 201) {
      const appt = await res.json()
      toast.success(`掛號成功，${appt.number} 號`)
      return router.push(`/appointments/${appt.id}`)
    }
    const isJson = (res.headers.get('Content-Type') || '').includes('json')
    const problem = isJson ? await res.json() : { status: res.status }
    if (res.status === 422) {
      const { fields: f, form } = toFormErrors(problem, Object.keys(fields))
      fieldErrors.value = f
      if (form.length) formError.value = { text: form.join('；') }
      idempotencyKey = null
      await nextTick()                         // 等錯誤訊息與 aria-invalid 畫上去
      formEl.value.querySelector('[aria-invalid="true"]')?.focus()
    } else if (res.status === 409) {
      formError.value = { text: CONFLICT_TEXT[problem.type] ?? '無法完成掛號', pickSession: true }
      idempotencyKey = null
    } else {
      formError.value = { text: '系統暫時無法處理，請再送出一次' }   // 5xx：保留鍵
    }
  } catch {
    formError.value = { text: '無法連線，請檢查網路後再送出一次' }   // 網路錯誤：保留鍵
  } finally {
    submitting.value = false                   // 成功、失敗、例外都要恢復按鈕
  }
}
</script>

<template>
  <form ref="form" @submit.prevent="submit">
    <div v-if="formError" role="alert" class="form-error">
      <p>{{ formError.text }}</p>
      <RouterLink v-if="formError.pickSession" to="/sessions">選擇其他診次</RouterLink>
    </div>

    <label for="patient-id">病歷號</label>
    <input id="patient-id" v-model="fields.patient_id" inputmode="numeric" pattern="[0-9]+" required
           :aria-invalid="fieldErrors.patient_id ? 'true' : undefined"
           :aria-describedby="fieldErrors.patient_id ? 'patient-id-error' : undefined">
    <p v-if="fieldErrors.patient_id" id="patient-id-error" class="field-error">{{ fieldErrors.patient_id }}</p>

    <button type="button" @click="router.back()">返回</button>
    <button type="submit" :disabled="submitting">{{ submitting ? '送出中…' : '掛號' }}</button>
  </form>
</template>
```

幾個細節：

- 表單沒有 `novalidate`，`required` 與 `pattern` 不符時瀏覽器擋下送出，`submit` 事件不會觸發，`submit()` 也不會執行。要自己畫前端錯誤時才加 `novalidate`，改成在 `submit()` 裡自己檢查。
- 「返回」寫了 `type="button"`。`<form>` 裡的 `<button>` 預設是 `type="submit"`，少寫這一行，按返回也會送出表單。
- 409 與網路錯誤都保留 `fields`，只有成功時才離開這個畫面。
- 欄位用後端的名稱 `patient_id`。前端想用 camelCase 時，在 `toFormErrors` 前加一張對照表，不要讓兩邊各自猜。

:::stop 讀到這裡可以先停：會把 422 對回欄位、把 409 放在表單上方並保留內容、擋住重複送出。後面的樂觀更新，在做取消、加星號這類幾乎都會成功的操作時再回來讀。

### 取消掛號：樂觀更新

```js
async function cancelAppointment(a) {
  const before = a.status
  a.status = 'cancelled'                       // 先改畫面
  try {
    const res = await fetch(`/api/appointments/${a.id}/cancel`, { method: 'POST' })
    if (!res.ok) throw await res.json().catch(() => ({ status: res.status }))
  } catch (problem) {
    a.status = before                          // 失敗：改回去
    toast.error(problem.type?.endsWith('/cancel-deadline-passed') ? '已超過可取消的時間' : '取消失敗，請稍後再試')
  }
}
```

改回去之前，使用者可能已經做了別的事（例如又按了另一列的取消）。只還原這一列自己的欄位，不要把整份清單換回操作前的快照，否則會連帶抹掉其他已經成功的操作。

## 常見錯誤與錯誤訊息

| 現象 | 原因 | 修法 |
|---|---|---|
| 上方只顯示「Unprocessable Content」 | 只讀了 `title`，沒讀 `errors` | 用 `errors` 對回欄位，`title` 不給使用者看 |
| 錯誤訊息永遠不出現在欄位旁 | 後端 `patient_id`、前端 `patientId`，名稱對不上 | 統一名稱或加對照表；對不到的放上方 |
| 按「返回」也送出了表單 | `<form>` 裡的 `<button>` 預設 `type="submit"` | 非送出的按鈕寫 `type="button"` |
| 按鈕停用了還是送出兩次 | 綁的是按鈕的 `@click`，Enter 走的是 `submit` | 處理 `<form>` 的 `submit`，用 `submitting` 旗標擋 |
| 後端出現兩筆一樣的掛號 | 重送沒有冪等鍵，或每次重送都換新的鍵 | 同一次送出沿用同一個 `Idempotency-Key` |
| 409 之後表單被清空 | 清空表單寫在 `finally` 或不分成功失敗 | 只在 201 之後清空或離開 |
| 送出失敗後按鈕一直是「送出中…」 | 網路錯誤丟出例外，沒有恢復 `submitting` | 放在 `finally` |
| 螢幕閱讀器沒有唸出錯誤 | 沒有 `aria-describedby`，上方錯誤沒有 `role="alert"` | 欄位加 `aria-invalid` 與 `aria-describedby`，上方加 `role="alert"` |
| 樂觀更新失敗後，其他列的狀態也被改回去 | 失敗時把整份清單換回快照 | 只還原這一列的欄位 |

## 動手

1. 按上面 `toFormErrors` 的「在 Playground 開啟」，加一個樣本：`errors` 是 `{ patient_id: ['必填', '必須是整數'] }`，確認畫面只顯示第一則；再在陣列寫法的樣本加一則 `field` 為 `null` 的錯誤，看它進了 `form`。
2. 在自己的專案把 Network 分頁節流選 `3G`，連按送出三次再按 Enter，確認只有一筆 POST；再對 POST 按右鍵選 `Block request URL`，確認表單內容保留、按鈕恢復可按。
3. 用 Elements 分頁檢查出錯的欄位有 `aria-invalid="true"`，`aria-describedby` 的值和錯誤訊息的 `id` 相同。
4. 網路錯誤與 5xx 什麼時候自動重送、什麼時候交給使用者，見 [錯誤分類與重試](#/skill/api-errors-retry)。

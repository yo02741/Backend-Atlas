<script setup>
// 掛號（第 3 階段，櫃台版：輸入病歷號）
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

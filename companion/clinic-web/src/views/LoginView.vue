<script setup>
// 登入頁（第 1 階段）。網址前綴改用第 7 階段的 config.apiBase
import { ref, reactive, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { safeRedirect } from '@/lib/safeRedirect'
import { config } from '@/config'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const FIELDS = ['username', 'password']        // 表單上的順序
const form = reactive({ username: '', password: '' })
const fieldErrors = ref({})                    // { password: '密碼至少 8 個字' }
const formError = ref('')
const submitting = ref(false)

async function onSubmit() {
  if (submitting.value) return                 // 送出中再送一次：不理
  submitting.value = true
  fieldErrors.value = {}
  formError.value = ''
  try {
    // 登入請求不走 apiFetch：它的 401 是「帳號或密碼錯誤」，不是「登入過期」
    const res = await fetch(`${config.apiBase}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      auth.signIn(data.access_token, form.username)
      return router.replace(safeRedirect(route.query.redirect))   // replace：登入頁不留在瀏覽紀錄裡
    }
    if (res.status === 422) {
      const errors = data.errors ?? {}           // 契約：{ 欄位: ['訊息'] }
      fieldErrors.value = Object.fromEntries(FIELDS.filter((k) => errors[k]).map((k) => [k, [].concat(errors[k])[0]]))
      await nextTick()
      document.getElementById(FIELDS.find((k) => fieldErrors.value[k]))?.focus()
    } else if (res.status === 401) {
      formError.value = data.detail ?? '帳號或密碼錯誤'
      form.password = ''
    } else {
      formError.value = '系統暫時無法處理，請稍後再試'
    }
  } catch {
    formError.value = '無法連線，請稍後再試'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="login">
    <h1 tabindex="-1">門診系統登入</h1>
    <p v-if="route.query.expired" role="status">登入已過期，請重新登入</p>
    <form @submit.prevent="onSubmit">
      <p v-if="formError" role="alert" class="form-error">{{ formError }}</p>

      <label for="username">帳號</label>
      <input id="username" v-model.trim="form.username" name="username" autocomplete="username"
             required spellcheck="false" autocapitalize="none"
             :aria-invalid="fieldErrors.username ? 'true' : undefined"
             :aria-describedby="fieldErrors.username ? 'username-error' : undefined">
      <p v-if="fieldErrors.username" id="username-error" class="field-error">{{ fieldErrors.username }}</p>

      <label for="password">密碼</label>
      <input id="password" v-model="form.password" name="password" type="password"
             autocomplete="current-password" required
             :aria-invalid="fieldErrors.password ? 'true' : undefined"
             :aria-describedby="fieldErrors.password ? 'password-error' : undefined">
      <p v-if="fieldErrors.password" id="password-error" class="field-error">{{ fieldErrors.password }}</p>

      <button type="submit" :disabled="submitting">{{ submitting ? '登入中…' : '登入' }}</button>
    </form>
  </main>
</template>

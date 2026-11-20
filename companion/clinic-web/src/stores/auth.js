// src/stores/auth.js：登入狀態。token 只放在記憶體，重新整理就要重新登入（第 1 階段）
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(null)
  const username = ref('')
  const isLoggedIn = computed(() => token.value !== null)

  function signIn(accessToken, name) {
    token.value = accessToken
    username.value = name
  }
  // setup store 沒有內建 $reset()，自己寫
  function $reset() {
    token.value = null
    username.value = ''
  }
  return { token, username, isLoggedIn, signIn, $reset }
})

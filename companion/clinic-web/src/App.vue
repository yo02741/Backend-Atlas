<script setup>
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { config } from '@/config'

const auth = useAuthStore()
const router = useRouter()

function logout() {
  auth.$reset()                       // 登出與 401 都清掉登入狀態（第 1 階段）
  router.replace({ name: 'login' })
}
</script>

<template>
  <header class="top">
    <strong>門診系統</strong>
    <span v-if="config.envName !== '正式'" class="env">{{ config.envName }}環境</span>
    <nav aria-label="主選單">
      <RouterLink v-if="auth.isLoggedIn" to="/sessions">診次清單</RouterLink>
      <RouterLink v-if="auth.isLoggedIn" to="/appointments">我的掛號</RouterLink>
      <RouterLink to="/board">報到看板</RouterLink>
      <button v-if="auth.isLoggedIn" type="button" @click="logout">登出（{{ auth.username }}）</button>
    </nav>
  </header>
  <RouterView :key="auth.username" />
</template>

// src/main.js（第 7 階段）
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import './focus'
import './styles.css'

// 部署後，開著的舊頁面要載入已經不存在的 chunk：重新載入一次拿新版的 index.html，10 秒內不重複
window.addEventListener('vite:preloadError', (event) => {
  const last = Number(sessionStorage.getItem('chunkReloadAt') || 0)
  if (Date.now() - last < 10_000) return
  event.preventDefault()
  sessionStorage.setItem('chunkReloadAt', String(Date.now()))
  window.location.reload()
})

createApp(App).use(createPinia()).use(router).mount('#app')

// src/router.js：路由表與守衛（第 1 階段）
import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const routes = [
  { path: '/', redirect: '/sessions' },
  { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { title: '登入' } },
  { path: '/sessions', name: 'sessions', component: () => import('@/views/SessionsView.vue'), meta: { requiresAuth: true, title: '診次清單' } },
  { path: '/sessions/:id/book', name: 'book', component: () => import('@/views/BookingView.vue'), props: true, meta: { requiresAuth: true, title: '掛號' } },
  { path: '/appointments', name: 'appointments', component: () => import('@/views/MyAppointmentsView.vue'), meta: { requiresAuth: true, title: '我的掛號' } },
  { path: '/board', name: 'board', component: () => import('@/views/BoardView.vue'), meta: { title: '報到看板' } },
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),   // 第 7 階段：和 Vite 的 base 同一個前綴
  routes,
})

// 沒登入就去登入頁，記下原本要去哪；登入頁自己不設 requiresAuth，否則會無限導向
router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta.requiresAuth && !auth.isLoggedIn) return { name: 'login', query: { redirect: to.fullPath } }
})

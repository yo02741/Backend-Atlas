// src/api/client.js：所有 API 都經過 apiFetch（第 1 階段；前綴換成第 7 階段的 config.apiBase）
import { useAuthStore } from '@/stores/auth'
import { router } from '@/router'
import { config } from '@/config'

export class ApiError extends Error {
  constructor(status, problem = null) {
    super(problem?.title ?? `HTTP ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.problem = problem          // Problem Details：type、title、status、detail、errors
  }
}

export async function apiFetch(path, { method = 'GET', body, headers, signal } = {}) {
  const auth = useAuthStore()
  const h = new Headers(headers)
  if (auth.token) h.set('Authorization', `Bearer ${auth.token}`)
  if (body !== undefined) h.set('Content-Type', 'application/json')
  const res = await fetch(`${config.apiBase}${path}`, { method, headers: h, signal, body: body === undefined ? undefined : JSON.stringify(body) })

  if (res.status === 401) {
    auth.$reset()
    const here = router.currentRoute.value
    if (here.name !== 'login') router.replace({ name: 'login', query: { redirect: here.fullPath, expired: '1' } })
    throw new ApiError(401)
  }
  const isJson = (res.headers.get('Content-Type') || '').includes('json')
  if (!res.ok) throw new ApiError(res.status, isJson ? await res.json() : null)   // 403 由畫面顯示「沒有權限」
  if (res.status === 204) return null
  if (!isJson) throw new ApiError(res.status, { title: '回應不是預期的格式' })   // 例如 proxy 回了 HTML
  return res.json()
}

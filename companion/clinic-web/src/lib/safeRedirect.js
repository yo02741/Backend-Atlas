// src/lib/safeRedirect.js：redirect 只接受同一個網站裡的路徑（第 1 階段）
export function safeRedirect(raw, fallback = '/sessions') {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback
  try {
    const base = new URL(location.origin)
    const u = new URL(raw, base)
    if (u.origin !== base.origin || u.pathname.startsWith('/login')) return fallback
    return u.pathname + u.search + u.hash
  } catch {
    return fallback
  }
}

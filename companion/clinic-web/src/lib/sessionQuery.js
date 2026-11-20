// src/lib/sessionQuery.js：網址參數 ↔ 診次清單的條件（第 2 階段）
export const DOCTORS = [{ id: 1, name: '林醫師' }, { id: 2, name: '張醫師' }]

// 契約的日期是台北時間；第 2 階段的 today() 用瀏覽器的時區，這裡固定用 UTC+8，和後端算的「今天」一致
export function today() {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
}
const first = (v) => (Array.isArray(v) ? v[0] : v)   // ?doctor_id=1&doctor_id=2 時取第一個

// route.query 的值都是字串（或 null、陣列）：轉型、檢查、給預設值
export function parseQuery(query) {
  const date = first(query.date) ?? ''
  const doctor = first(query.doctor_id) ?? ''
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today(),
    doctorId: DOCTORS.some((d) => String(d.id) === doctor) ? doctor : '',
  }
}

// 和預設值相同的條件不寫進網址
export function toQuery(filters) {
  const q = {}
  if (filters.date !== today()) q.date = filters.date
  if (filters.doctorId) q.doctor_id = filters.doctorId
  return q
}

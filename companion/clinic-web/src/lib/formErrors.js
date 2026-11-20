// src/lib/formErrors.js：422 的 Problem Details → { fields: { 欄位: 訊息 }, form: [對不到欄位的訊息] }（第 3 階段）
// 契約的 errors 是 { 欄位: ['訊息'] }；[{ field, message }] 與 RFC 9457 範例的 [{ pointer, detail }] 也收，對接別的後端時用得到
export function toFormErrors(problem, knownFields) {
  const raw = problem?.errors
  const list = Array.isArray(raw)
    ? raw.map((e) => ({ name: e.field ?? e.pointer?.replace(/^#?\//, '').replaceAll('/', '.') ?? null, message: e.message ?? e.detail }))
    : Object.entries(raw ?? {}).map(([name, messages]) => ({ name, message: [].concat(messages)[0] }))
  const fields = {}
  const form = []
  for (const { name, message } of list) {
    if (name && knownFields.includes(name)) fields[name] ??= message ?? '格式不正確'   // 同一欄位只顯示第一則
    else form.push(name ? `${name}：${message}` : message)
  }
  if (!list.length) form.push(problem?.detail ?? '送出的內容有誤')
  return { fields, form }
}

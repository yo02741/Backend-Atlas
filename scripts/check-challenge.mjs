// 進階驗收（課的 body.challenge、情境的 challenge）的格式檢查，validate-content 與 validate-scenarios 共用。
// 回傳錯誤訊息的陣列；格式見 docs/CONTRIBUTING-lessons.md 的「進階驗收」。
const str = (v) => typeof v === 'string' && v.trim() !== ''
export function challengeErrors(c, tag) {
  const out = []
  if (c === null || typeof c !== 'object' || Array.isArray(c)) return [`${tag}: challenge 要是物件 { task, deliver, check, twist? }`]
  if (!str(c.task)) out.push(`${tag}: challenge.task 必填（任務的情境與要做的事）`)
  if (!str(c.deliver)) out.push(`${tag}: challenge.deliver 必填（交付物，一句）`)
  if (!Array.isArray(c.check) || c.check.length < 2 || c.check.length > 4 || c.check.some((x) => !str(x))) out.push(`${tag}: challenge.check 要 2–4 條非空字串（每條能判斷過或不過）`)
  if (c.twist !== undefined && !str(c.twist)) out.push(`${tag}: challenge.twist 要是非空字串（或省略）`)
  const extra = Object.keys(c).filter((k) => !['task', 'deliver', 'check', 'twist'].includes(k))
  if (extra.length) out.push(`${tag}: challenge 有不認得的欄位 ${extra.join(', ')}`)
  return out
}

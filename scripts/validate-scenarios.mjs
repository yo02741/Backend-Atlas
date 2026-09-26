// 設計情境結構校驗：id 唯一、group / skills 存在、options 與 decisions 對得上、lab 檔案存在、不含超連結
import { readdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const { DOMAINS } = await import(pathToFileURL(resolve(here, '../src/content/roadmap.js')).href)
const skillIds = new Set(DOMAINS.flatMap((d) => d.skills.map((s) => s.id)))
const GROUPS = new Set(['api', 'data', 'traffic'])
const dir = resolve(here, '../src/content/scenarios')
const labDir = resolve(here, '../src/labs/scenarios')
const errors = []
const ids = new Set()
let count = 0
for (const f of readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'index.js')) {
  const m = await import(pathToFileURL(resolve(dir, f)).href)
  const s = m.default
  const tag = f
  if (!s || typeof s !== 'object') { errors.push(`${tag}: default export 必須是物件`); continue }
  count++
  if (!s.id || ids.has(s.id)) errors.push(`${tag}: id 缺少或重複 (${s.id})`)
  ids.add(s.id)
  if (s.id && f !== `${s.id}.js`) errors.push(`${tag}: 檔名應為 ${s.id}.js`)
  if (!GROUPS.has(s.group)) errors.push(`${tag}: group 必須是 api / data / traffic`)
  if (!s.title || !s.summary || !s.situation) errors.push(`${tag}: title / summary / situation 必填`)
  if (![1, 2, 3].includes(s.level)) errors.push(`${tag}: level 必須是 1–3`)
  if (!Array.isArray(s.constraints) || s.constraints.length < 3) errors.push(`${tag}: constraints 至少 3 條`)
  for (const k of s.skills || []) if (!skillIds.has(k)) errors.push(`${tag}: skills 含不存在的技能 id "${k}"`)
  if (!s.lab) errors.push(`${tag}: 需要 lab（模擬器元件名）`)
  else if (!existsSync(resolve(labDir, `${s.lab}.jsx`))) errors.push(`${tag}: 找不到 src/labs/scenarios/${s.lab}.jsx`)
  const optIds = new Set()
  if (!Array.isArray(s.options) || s.options.length < 2 || s.options.length > 4) errors.push(`${tag}: options 需 2–4 個`)
  for (const o of s.options || []) {
    if (!o.id || optIds.has(o.id)) errors.push(`${tag}: option id 缺少或重複 (${o.id})`)
    optIds.add(o.id)
    if (!o.name || !o.summary || !o.pros?.length || !o.cons?.length) errors.push(`${tag}/${o.id}: name / summary / pros / cons 必填`)
  }
  if (!s.tradeoffs?.axes?.length || !s.tradeoffs?.rows?.length) errors.push(`${tag}: tradeoffs.axes / rows 必填`)
  for (const r of s.tradeoffs?.rows || []) {
    if (!optIds.has(r.option)) errors.push(`${tag}: tradeoffs 引用不存在的 option "${r.option}"`)
    if (r.cells?.length !== s.tradeoffs.axes.length) errors.push(`${tag}/${r.option}: cells 數量要等於 axes 數量`)
  }
  if (s.week != null && !(Number.isInteger(s.week) && s.week >= 1 && s.week <= 16)) errors.push(`${tag}: week 要是 1–16 的整數（或省略）`)
  if (!Array.isArray(s.decisions) || s.decisions.length < 3) errors.push(`${tag}: decisions 至少 3 題`)
  const answers = new Set()
  for (const d of s.decisions || []) {
    if (!d.id || !d.situation || !d.explain) errors.push(`${tag}/decision ${d.id}: id / situation / explain 必填`)
    if (!Array.isArray(d.options) || d.options.length < 2) errors.push(`${tag}/decision ${d.id}: options 至少 2 個`)
    for (const o of d.options || []) if (!optIds.has(o)) errors.push(`${tag}/decision ${d.id}: 引用不存在的 option "${o}"`)
    if (!optIds.has(d.answer) || !(d.options || []).includes(d.answer)) errors.push(`${tag}/decision ${d.id}: answer 必須在 options 裡`)
    answers.add(d.answer)
  }
  if ((s.decisions || []).length >= 3 && answers.size === 1) errors.push(`${tag}: 所有決策題正解都一樣，請設計不同情境`)
  for (const c of s.implementation || []) if (!c.title || !c.lang || !c.code) errors.push(`${tag}: implementation 每項需 title / lang / code`)
  // 落地程式碼（implementation[].code）本來就會出現 http:// （nginx proxy_pass、範例 URL），不算超連結；其餘欄位一律不可
  const text = JSON.stringify({ ...s, refs: undefined, implementation: (s.implementation || []).map((c) => ({ ...c, code: undefined })) })
  if (/https?:\/\//.test(text)) errors.push(`${tag}: 內容不可含超連結（refs 與落地程式碼除外）`)
  if (/為什麼要學|為什麼重要|你工作上|給前端工程師|你已經會/.test(text)) errors.push(`${tag}: 含不符合語氣規範的措辭`)
}
console.log(`情境 ${count} 個`)
if (errors.length) { console.log('錯誤：\n' + errors.join('\n')); process.exit(1) }
console.log('OK')

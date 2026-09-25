// 題庫結構校驗：skill id 存在、每題 4 選項、answer 在範圍內、explain 非空、每 skill 恰 3 題
import { readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const { DOMAINS } = await import(pathToFileURL(resolve(here, '../src/content/roadmap.js')).href)
const dir = resolve(here, '../src/content/quizzes')
const errors = []
const covered = new Set()
let total = 0
for (const f of readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'index.js')) {
  const domainId = f.replace('.js', '')
  const domain = DOMAINS.find((d) => d.id === domainId)
  // 非領域檔（例如 extra.js）允許放任何領域的技能
  const lookup = domain ? domain.skills : DOMAINS.flatMap((d) => d.skills)
  const mod = await import(pathToFileURL(resolve(dir, f)).href)
  const list = mod.default
  if (!Array.isArray(list)) { errors.push(`${f}: default export 必須是陣列`); continue }
  for (const entry of list) {
    const s = lookup.find((x) => x.id === entry.skill)
    if (!s) { errors.push(`${f}: skill "${entry.skill}" 不存在${domain ? `於 ${domainId}` : ''}`); continue }
    if (covered.has(entry.skill)) errors.push(`${f}: skill "${entry.skill}" 重複`)
    covered.add(entry.skill)
    if (!Array.isArray(entry.questions) || entry.questions.length !== 3) errors.push(`${f}/${entry.skill}: 需要恰好 3 題（現有 ${entry.questions?.length}）`)
    const answers = new Set()
    for (const [i, q] of (entry.questions || []).entries()) {
      const tag = `${f}/${entry.skill}#${i + 1}`
      if (!q.q || q.q.length < 8) errors.push(`${tag}: 題幹太短`)
      if (!Array.isArray(q.options) || q.options.length !== 4) errors.push(`${tag}: 需要恰好 4 個選項`)
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) errors.push(`${tag}: answer 必須是 0–3`)
      if (!q.explain || q.explain.length < 15) errors.push(`${tag}: explain 太短`)
      if (q.code && !q.lang) errors.push(`${tag}: 有 code 就要有 lang`)
      if (/https?:\/\//.test(JSON.stringify(q))) errors.push(`${tag}: 不可含超連結`)
      answers.add(q.answer)
      total++
    }
    if (answers.size === 1 && (entry.questions || []).length === 3) errors.push(`${f}/${entry.skill}: 三題正解索引全相同，請打亂`)
  }
}
const all = DOMAINS.flatMap((d) => d.skills.map((s) => s.id))
const missing = all.filter((id) => !covered.has(id))
console.log(`題數 ${total}，涵蓋 ${covered.size} / ${all.length} 個技能`)
if (missing.length) console.log(`尚未涵蓋：${missing.join(', ')}`)
if (errors.length) { console.log('錯誤：\n' + errors.join('\n')); process.exit(1) }
console.log('OK')

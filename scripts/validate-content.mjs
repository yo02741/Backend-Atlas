// 技能內容結構校驗：索引（src/content/dN-*.js）與內文（src/content/body/dN-*.js）技能 id 一一對應、
// 必填欄位齊全、id 全站唯一、lab 檔存在、refs 是 https 連結、PATH / KEYWORDS 對得到技能。
import { readdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const content = resolve(here, '../src/content')
const { DOMAINS, PATH, KEYWORDS } = await import(pathToFileURL(resolve(content, 'roadmap.js')).href)

const errors = []
const seen = new Set()
let skills = 0
const files = readdirSync(content).filter((f) => /^d\d-.*\.js$/.test(f))
if (files.length !== DOMAINS.length) errors.push(`dN-*.js 有 ${files.length} 個，roadmap.js 的 DOMAINS 有 ${DOMAINS.length} 個`)

for (const d of DOMAINS) {
  const tag = `d${d.no}-${d.id}`
  for (const k of ['id', 'no', 'title', 'en', 'color', 'tagline', 'desc']) if (d[k] === undefined || d[k] === '') errors.push(`${tag}: 領域缺 ${k}`)
  if (!existsSync(resolve(content, `${tag}.js`))) errors.push(`${tag}: 索引檔名要是 ${tag}.js（d<no>-<id>.js）`)
  const bodyPath = resolve(content, 'body', `${tag}.js`)
  if (!existsSync(bodyPath)) { errors.push(`${tag}: 缺內文檔 body/${tag}.js`); continue }
  const body = (await import(pathToFileURL(bodyPath).href)).default
  const ids = new Set()
  for (const s of d.skills || []) {
    skills++
    const st = `${tag}/${s.id}`
    if (!/^[a-z0-9-]+$/.test(s.id || '')) errors.push(`${st}: id 只能是小寫英數與連字號`)
    if (seen.has(s.id)) errors.push(`${st}: id 重複`)
    seen.add(s.id); ids.add(s.id)
    for (const k of ['title', 'en', 'summary']) if (!s[k]) errors.push(`${st}: 缺 ${k}`)
    if (![1, 2, 3].includes(s.level)) errors.push(`${st}: level 要是 1 / 2 / 3`)
    if (!s.example?.primary) errors.push(`${st}: example.primary 必填`)
    if (!Array.isArray(s.keywords)) errors.push(`${st}: keywords 要是陣列`)
    if (s.lab && !existsSync(resolve(here, '../src/labs', `${s.lab}.jsx`))) errors.push(`${st}: lab "${s.lab}" 在 src/labs/ 找不到`)
    for (const k of ['points', 'checklist', 'refs']) if (k in s) errors.push(`${st}: ${k} 要放在 body/${tag}.js，不放索引`)
    const b = body[s.id]
    if (!b) { errors.push(`${st}: body/${tag}.js 沒有這個技能的內文`); continue }
    if (!Array.isArray(b.points) || b.points.length < 2) errors.push(`${st}: points 至少 2 條`)
    for (const p of b.points || []) if (!p?.b || !p?.t) errors.push(`${st}: points 每條要有 b（粗體）與 t（說明）`)
    if (!Array.isArray(b.checklist) || b.checklist.length < 1) errors.push(`${st}: checklist 至少 1 條`)
    if (!Array.isArray(b.refs)) errors.push(`${st}: refs 要是陣列（可為空）`)
    for (const r of b.refs || []) if (!r?.label || !/^https:\/\//.test(r?.url || '')) errors.push(`${st}: refs 每筆要有 label 與 https:// 開頭的 url`)
    const extra = Object.keys(b).filter((k) => !['points', 'checklist', 'refs'].includes(k))
    if (extra.length) errors.push(`${st}: 內文多了不認識的欄位 ${extra.join(', ')}`)
  }
  for (const id of Object.keys(body)) if (!ids.has(id)) errors.push(`${tag}: body 有 "${id}" 但索引沒有這個技能`)
}
for (const p of PATH) if (!seen.has(p.skill)) errors.push(`PATH: 技能 "${p.skill}" 不存在`)
const allKw = new Set(DOMAINS.flatMap((d) => d.skills.flatMap((s) => (s.keywords || []).map((k) => k.toLowerCase()))))
for (const k of KEYWORDS) if (!allKw.has(k.toLowerCase())) errors.push(`KEYWORDS: "${k}" 沒有任何技能對應`)

console.log(`領域 ${DOMAINS.length} 個，技能 ${skills} 個`)
if (errors.length) { console.log('錯誤：\n' + errors.join('\n')); process.exit(1) }
console.log('OK')

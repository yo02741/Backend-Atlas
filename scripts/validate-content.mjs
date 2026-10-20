// 技能內容結構校驗：索引（src/content/dN-*.js）與內文（src/content/body/dN-*.js）技能 id 一一對應、
// 必填欄位齊全、id 全站唯一、lab 檔存在、refs 是 https 連結、PATH / KEYWORDS 對得到技能。
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const content = resolve(here, '../src/content')
const { ALL_DOMAINS: DOMAINS, PATH, KEYWORDS } = await import(pathToFileURL(resolve(content, 'roadmap.js')).href)

const errors = []
const seen = new Set()
let skills = 0
const files = readdirSync(content).filter((f) => /^d\d+-.*\.js$/.test(f))
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

// 深入內容（src/content/deep/<skill-id>.md）：檔名對得到技能、至少三個 ## 段落、篇幅足夠、
// 不用禁用措辭、連結是 https、程式碼區塊有收尾、標 run 的區塊只能是 python / sql / js
const BANNED = ['為什麼要學', '給前端工程師', '你工作上', '你已經會', '身為前端']
const deepDir = resolve(content, 'deep')
const deepFiles = existsSync(deepDir) ? readdirSync(deepDir).filter((f) => f.endsWith('.md')) : []
for (const f of deepFiles) {
  const id = f.replace(/\.md$/, '')
  const tag = `deep/${f}`
  if (!seen.has(id)) errors.push(`${tag}: 沒有 id 為 "${id}" 的技能`)
  const md = readFileSync(resolve(deepDir, f), 'utf8')
  const fences = md.match(/^```.*$/gm) || []
  if (fences.length % 2) errors.push(`${tag}: 程式碼區塊沒有收尾（\`\`\` 數量是奇數）`)
  for (let i = 0; i < fences.length; i += 2) {
    const [, lang, rest] = /^```\s*(\S*)\s*(.*)$/.exec(fences[i])
    if (/\brun\b/.test(rest) && !['python', 'sql', 'js', 'javascript'].includes(lang)) errors.push(`${tag}: 標 run 的程式碼區塊只能是 python / sql / js（這裡是 "${lang}"）`)
  }
  const prose = md.replace(/^```[\s\S]*?^```/gm, '')
  if (/^# /m.test(prose)) errors.push(`${tag}: 不要用 # 一級標題（技能頁已有標題），段落用 ##`)
  const h2 = (prose.match(/^## /gm) || []).length
  if (h2 < 3) errors.push(`${tag}: 至少要有三個 ## 段落（目前 ${h2} 個）`)
  const chars = prose.replace(/\s+/g, '').length
  if (chars < 1500) errors.push(`${tag}: 正文太短（${chars} 字，至少 1500）`)
  for (const w of BANNED) if (md.includes(w)) errors.push(`${tag}: 不用「${w}」這類措辭（見 CLAUDE.md 語氣規則）`)
  for (const m of prose.matchAll(/\]\(([^)]+)\)/g)) if (!/^https:\/\//.test(m[1]) && !/^#\//.test(m[1])) errors.push(`${tag}: 連結要是 https:// 或站內 #/ 路由（${m[1]}）`)
}

// 實作路線：每個階段要有說明檔、對得到的技能與程式題
const { STAGES } = await import(pathToFileURL(resolve(content, 'project/stages.js')).href)
const { default: projectExercises } = await import(pathToFileURL(resolve(content, 'exercises/project.js')).href)
const stageIds = new Set()
for (const st of STAGES) {
  const tag = `project/${st.id}`
  if (stageIds.has(st.id)) errors.push(`${tag}: 階段 id 重複`)
  stageIds.add(st.id)
  for (const k of ['id', 'no', 'title', 'summary']) if (!st[k]) errors.push(`${tag}: 缺 ${k}`)
  if (!existsSync(resolve(content, 'project', `${st.id}.md`))) errors.push(`${tag}: 缺說明檔 project/${st.id}.md`)
  for (const l of st.lessons || []) if (!seen.has(l)) errors.push(`${tag}: lessons 裡的技能 "${l}" 不存在`)
  const exIds = new Set(projectExercises.filter((e) => e.project === st.id).map((e) => e.id))
  for (const e of st.exercises || []) if (!exIds.has(e)) errors.push(`${tag}: exercises 裡的 "${e}" 在 exercises/project.js 找不到（或 project 欄位不是 "${st.id}"）`)
}
for (const e of projectExercises) {
  if (!stageIds.has(e.project)) errors.push(`exercises/project.js ${e.id}: project "${e.project}" 不是任何階段`)
  if (e.skill && !seen.has(e.skill)) errors.push(`exercises/project.js ${e.id}: skill "${e.skill}" 不存在`)
}

console.log(`領域 ${DOMAINS.length} 個，技能 ${skills} 個，深入內容 ${deepFiles.length} / ${skills} 課，實作路線 ${STAGES.length} 個階段`)
if (errors.length) { console.log('錯誤：\n' + errors.join('\n')); process.exit(1) }
console.log('OK')

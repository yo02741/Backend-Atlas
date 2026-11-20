// 選擇題的「最長選項」線索：正解是唯一最長的選項（以字串長度計，並列最長不算）。
//   node scripts/quiz-stats.mjs            各路線、各領域的比例，加上 3/3、2/3 的課
//   node scripts/quiz-stats.mjs --check    有任何一課超過 1/3 題就失敗（validate:quizzes 會跑）
import { readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const { ALL_DOMAINS } = await import(pathToFileURL(resolve(here, '../src/content/roadmap.js')).href)
const dir = resolve(here, '../src/content/quizzes')
const QUIZZES = {}
for (const f of readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'index.js')) {
  for (const e of (await import(pathToFileURL(resolve(dir, f)).href)).default) QUIZZES[e.skill] = e.questions
}

const CHECK = process.argv.includes('--check')
const domainOf = new Map()
for (const d of ALL_DOMAINS) for (const s of d.skills) domainOf.set(s.id, d)
const len = (s) => [...String(s)].length
export const longestIsAnswer = (q) => {
  const ls = q.options.map(len)
  const max = Math.max(...ls)
  return ls[q.answer] === max && ls.filter((l) => l === max).length === 1
}

const byTrack = {}, byDomain = {}, flagged = []
let total = 0, hit = 0
for (const [skill, qs] of Object.entries(QUIZZES)) {
  const d = domainOf.get(skill)
  if (!d) continue
  const n = qs.filter(longestIsAnswer).length
  total += qs.length; hit += n
  for (const [map, key] of [[byTrack, d.track], [byDomain, d.id]]) {
    map[key] ||= { total: 0, hit: 0 }
    map[key].total += qs.length; map[key].hit += n
  }
  if (n > 1) flagged.push({ skill, n, of: qs.length, track: d.track })
}
const pct = (h, t) => (t ? ((h / t) * 100).toFixed(1) : '0.0') + '%'
if (!CHECK) {
  console.log(`全站：${hit}/${total}（${pct(hit, total)}）題的正解是唯一最長的選項`)
  for (const [k, v] of Object.entries(byTrack)) console.log(`  ${k}：${v.hit}/${v.total}（${pct(v.hit, v.total)}）`)
  for (const [k, v] of Object.entries(byDomain)) console.log(`    ${k}：${v.hit}/${v.total}`)
  console.log(`超過 1/3 的課：${flagged.length}`)
  for (const f of flagged) console.log(`  ${f.track} ${f.skill} ${f.n}/${f.of}`)
} else {
  if (flagged.length) {
    console.error(`選擇題：${flagged.length} 課有 2 題以上的正解是唯一最長的選項（每課最多 1 題）：`)
    for (const f of flagged) console.error(`  ${f.skill} ${f.n}/${f.of}`)
    process.exit(1)
  }
  console.log(`選擇題長度線索：全站 ${pct(hit, total)}，每課都在 1/3 以內`)
}

// 從內容資料重新產生 README.md 與 docs/CURRICULUM.md 裡會跟著內容變動的段落。
//   node scripts/sync-docs.mjs          重寫（npm run docs:sync）
//   node scripts/sync-docs.mjs --check  只檢查，有過期的段落或錯誤就以 1 結束（npm run docs:check）
//
// README 的產生段落用 <!-- sync:名稱 --> 與 <!-- /sync:名稱 --> 包住，段落裡的文字不要手改，改這支腳本。
// CURRICULUM.md 會在網站上渲染，不放註解標記：「### 本站領域對照」到第二節之前整段由這裡產生。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')
const imp = (p) => import(pathToFileURL(path.join(root, p)).href)
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const errors = []

// ── 讀資料 ─────────────────────────────────────────────
const { DOMAINS, PATH, LEVELS } = await imp('src/content/roadmap.js')
const { EXERCISES } = await imp('src/content/exercises/index.js')
const { STAGES } = await imp('src/content/project/stages.js')
const skills = DOMAINS.flatMap((d) => d.skills.map((s) => ({ ...s, domain: d })))
const skillById = new Map(skills.map((s) => [s.id, s]))

const quizDir = path.join(root, 'src/content/quizzes')
let quizCount = 0
for (const f of fs.readdirSync(quizDir).filter((f) => f.endsWith('.js') && f !== 'index.js').sort()) {
  const list = (await import(pathToFileURL(path.join(quizDir, f)).href)).default
  for (const g of list) quizCount += (g.questions || []).length
}

// 情境：index.js 用 import.meta.glob，Node 不能直接 import，所以逐檔讀，分組名稱從 index.js 解析
const groupSrc = read('src/content/scenarios/index.js')
const GROUPS = [...groupSrc.matchAll(/\{ id: '(\w+)', title: '([^']+)'/g)].map((m) => ({ id: m[1], title: m[2] }))
const scenDir = path.join(root, 'src/content/scenarios')
const scenarios = []
for (const f of fs.readdirSync(scenDir).filter((f) => f.endsWith('.js') && f !== 'index.js')) {
  scenarios.push((await import(pathToFileURL(path.join(scenDir, f)).href)).default)
}
scenarios.sort((a, b) => (a.order ?? 99) - (b.order ?? 99))

// 實驗室：src/labs/index.js 的 LAB_META 每筆一行
const labSrc = read('src/labs/index.js')
const labs = [...labSrc.matchAll(/^\s+(\w+Lab):\s+\{ title: '([^']*)', blurb: '([^']*)', skill: '([^']*)' \}/gm)]
  .map((m) => ({ name: m[1], title: m[2], skill: m[4] }))
const labFiles = fs.readdirSync(path.join(root, 'src/labs')).filter((f) => /Lab\.jsx$/.test(f))
if (labs.length !== labFiles.length) errors.push(`LAB_META 解析到 ${labs.length} 筆，src/labs/ 有 ${labFiles.length} 個 *Lab.jsx：每筆要寫成一行 { title, blurb, skill }`)
for (const l of labs) if (!skillById.has(l.skill)) errors.push(`LAB_META.${l.name} 的 skill "${l.skill}" 不存在`)
const scenLabCount = fs.readdirSync(path.join(root, 'src/labs/scenarios')).filter((f) => f.endsWith('.jsx')).length

// ── 共用 ───────────────────────────────────────────────
const kinds = {}
for (const e of EXERCISES) kinds[e.kind] = (kinds[e.kind] || 0) + 1
const projEx = EXERCISES.filter((e) => e.project).length
const star = (s) => (s.lab ? '★' : '')
const short = (t) => t.split('：')[0]
const paren = (t) => t.replace(/：(.+)$/, '（$1）')
// 清單項目之間用「；」：很多課名、實驗室與情境的名稱本身就有頓號
const groupCounts = GROUPS.map((g) => `${g.title} ${scenarios.filter((s) => s.group === g.id).length}`).join('；')

// ── README 的產生段落 ─────────────────────────────────
const blocks = {
  stats: () => [
    '| 內容 | 數量 |',
    '|---|---|',
    `| 領域 | ${DOMAINS.length}（${DOMAINS.map((d) => short(d.title)).join('；')}） |`,
    `| 技能（課） | ${skills.length}，每課有重點卡（摘要、重點、自我檢核、官方文件）與**深入內容**（從一個具體問題開始 → 運作原理 → 實際程式 → 常見錯誤與錯誤訊息 → 動手；範例可一鍵在 Playground 執行） |`,
    `| 互動實驗室 | ${labs.length}，依領域列在下方 |`,
    `| 程式題 | ${EXERCISES.length}（Python ${kinds.python || 0} / SQL ${kinds.sql || 0} / config ${kinds.config || 0} / JS ${kinds.js || 0}），含實作路線的 ${projEx} 道驗收題；解答全部經真實執行環境驗證 |`,
    `| 選擇題 | ${quizCount}（每課 3 題，含程式碼判讀與情境題） |`,
    `| 設計情境 | ${scenarios.length}（${groupCounts}） |`,
    `| 實作路線 | 從零做完一個門診掛號後端：${STAGES.length} 個階段，每階段有說明與在瀏覽器裡跑的驗收題 |`,
    '| 課綱 | `docs/CURRICULUM.md`：獨立盤點的技能樹、16 週主線課綱（含實作路線對照）、第 17–22 週延伸課綱、10 週的 Docker 到 Kubernetes 專題、驗收設計 |',
  ].join('\n'),

  route: () => [
    `### 建議學習路線（${PATH.length} 站）`,
    '',
    '首頁路線圖的站點，每站約一週。★ 表示附互動實驗室。',
    '',
    '| 站 | 課 | 領域 | 內容 |',
    '|---|---|---|---|',
    ...PATH.map((p, i) => {
      const s = skillById.get(p.skill)
      if (!s) { errors.push(`PATH 第 ${i + 1} 站的 skill "${p.skill}" 不存在`); return '' }
      return `| ${i + 1} | ${s.title}${star(s)} | ${s.domain.title} | ${p.note} |`
    }),
    '',
    '站點定義在 `src/content/roadmap.js` 的 `PATH`（`label` 是地圖上的短站名，`note` 是上表的「內容」）。',
  ].join('\n'),

  lessons: () => [
    `### 技能課程（${DOMAINS.length} 領域、${skills.length} 課）`,
    '',
    '每課有重點卡（摘要、範例技術、重點、自我檢核清單、官方文件連結）與深入內容。★ 表示附互動實驗室。',
    '',
    '| 領域 | 課程 |',
    '|---|---|',
    ...DOMAINS.map((d) => `| ${d.no}. ${d.title} | ${d.skills.map((s) => paren(s.title) + star(s)).join('；')} |`),
  ].join('\n'),

  labs: () => [
    `### 互動實驗室（${labs.length} 個）`,
    '',
    '依領域列出：',
    '',
    ...DOMAINS.map((d) => {
      const ls = labs.filter((l) => skillById.get(l.skill)?.domain.id === d.id)
      return ls.length ? `- **${d.title}**：${ls.map((l) => l.title).join('；')}` : null
    }).filter(Boolean),
  ].join('\n'),

  scenarios: () => [
    `### 設計情境（${scenarios.length} 個）`,
    '',
    '每個情境包含背景與限制、模擬器、取捨表、決策題與落地程式碼。',
    '',
    ...GROUPS.map((g) => {
      const ss = scenarios.filter((s) => s.group === g.id)
      return `- **${g.title}（${ss.length}）**：${ss.map((s) => s.title).join('；')}`
    }),
  ].join('\n'),

  practice: () => [
    '### 練習題',
    '',
    `- **程式題 ${EXERCISES.length} 道**（Python ${kinds.python || 0}、SQL ${kinds.sql || 0}、config ${kinds.config || 0}、JavaScript ${kinds.js || 0}）：在瀏覽器裡執行並跑測試：SQL 跑 PGlite、Python 跑 Pyodide、JS 跑 Web Worker；config 題（Dockerfile、compose、nginx、Kubernetes manifest、\`.gitlab-ci.yml\`、GitHub Actions）由 JS 檢查器逐條驗證。`,
    `- **選擇題 ${quizCount} 道**：每課 3 題，含程式碼判讀與情境題。`,
    '- **複習頁** `#/review`：跨課混合抽 10 或 20 題，範圍可選全部、已完成的課、指定領域或上次答錯的題；交卷後列出各領域答對率，每題附回到該課的連結，可以只重做答錯的。錯題與成績只存在瀏覽器，不同步到帳號。',
  ].join('\n'),

  'k8s-track': () => {
    const cur = read('docs/CURRICULUM.md')
    const i = cur.indexOf('## 四、Docker 到 Kubernetes 專題'), j = cur.indexOf('\n## 五、')
    if (i < 0 || j < 0) { errors.push('CURRICULUM.md 找不到第四節「Docker 到 Kubernetes 專題」'); return '' }
    const rows = []
    for (const m of cur.slice(i, j).matchAll(/^### (K\d+)｜(.+)\n\n- \*\*對應課程\*\*：(.+)$/gm)) {
      const ids = [...m[3].matchAll(/`([a-z0-9-]+)`/g)].map((x) => x[1])
      for (const id of ids) if (!skillById.has(id)) errors.push(`課綱 ${m[1]} 的課 "${id}" 不存在`)
      rows.push(`| ${m[1]} | ${m[2]} | ${ids.map((id) => paren(skillById.get(id)?.title || id)).join('；')} |`)
    }
    if (!rows.length) errors.push('CURRICULUM.md 第四節沒有解析到任何 K 週')
    return ['| 週 | 主題 | 課 |', '|---|---|---|', ...rows].join('\n')
  },
}

let readme = read('README.md')
const stale = []
for (const [name, gen] of Object.entries(blocks)) {
  const re = new RegExp(`(<!-- sync:${name} -->\\n)(?:[\\s\\S]*?\\n)?(<!-- /sync:${name} -->)`)
  if (!re.test(readme)) { errors.push(`README.md 少了 <!-- sync:${name} --> 段落`); continue }
  const next = readme.replace(re, (_, a, b) => a + gen() + '\n' + b)
  if (next !== readme) stale.push(`README.md：${name}`)
  readme = next
}
// 散在 README 其他地方的單一數字
const inline = [
  [/學習路線 PATH（\d+ 站）/, `學習路線 PATH（${PATH.length} 站）`],
  [/# \d+ 個實驗室與情境模擬器/, `# ${labs.length + scenLabCount} 個實驗室與情境模擬器`],
]
for (const [re, rep] of inline) {
  if (!re.test(readme)) { errors.push(`README.md 找不到 ${re}`); continue }
  const next = readme.replace(re, rep)
  if (next !== readme) stale.push(`README.md：${rep}`)
  readme = next
}

// ── CURRICULUM.md 的技能樹（本站領域對照 + 延伸領域 J–L） ──
let cur = read('docs/CURRICULUM.md')
const weekOf = {}
for (const m of cur.matchAll(/^### 第 (\d+) 週[^\n]*\n([\s\S]*?)(?=^### |^## |^---$)/gm)) {
  const line = (m[2].match(/^- \*\*對應技能\*\*：.*$/m) || [''])[0]
  for (const id of line.matchAll(/`([a-z0-9-]+)`/g)) if (!(id[1] in weekOf)) weekOf[id[1]] = Number(m[1])
}
const unscheduled = skills.filter((s) => !weekOf[s.id]).map((s) => s.id)
// 沒排週次：同步時只提醒（部署前也會同步，不要因此擋住部署），檢查模式才算錯
const warnings = []
if (unscheduled.length) (CHECK ? errors : warnings).push(`這些課沒有排進課綱任何一週的「對應技能」：${unscheduled.join('、')}（在 docs/CURRICULUM.md 對應週次加上 \`id\`）`)
const TREE = { language: 'A', web: 'B', data: 'C', auth: 'D', security: 'E', deploy: 'F', cicd: 'G', algo: 'H、I', devops: 'J', ai: 'K', knowledge: 'L' }
let tree = `### 本站領域對照\n\n本站把內容分成 ${DOMAINS.length} 個領域、${skills.length} 堂課。主線領域 A–I 的技能與站上的課不是一對一（一堂課常涵蓋數個技能），下表是主要對應：\n\n| 本站領域 | 課數 | 技能樹 |\n|---|---|---|\n`
for (const d of DOMAINS) tree += `| ${d.no} ${d.title} | ${d.skills.length} | 領域 ${TREE[d.id] || '?'} |\n`
for (const [id, letter] of [['devops', 'J'], ['ai', 'K'], ['knowledge', 'L']]) {
  const d = DOMAINS.find((x) => x.id === id)
  tree += `\n### 領域 ${letter}：${d.title}\n\n延伸領域，以本站的課為單位；子技能見各課頁面的檢查清單。標記是站上的難度（${Object.values(LEVELS).join(' / ')}）。\n\n`
  d.skills.forEach((k, i) => {
    tree += `- **${letter}${i + 1} ${k.title}** — ${LEVELS[k.level]} · ${weekOf[k.id] ? `第 ${weekOf[k.id]} 週` : '未排週次'} · \`${k.id}\`\n`
  })
}
const SEC2 = '\n---\n\n## 二、16 週主線課綱'
const ti = cur.indexOf('### 本站領域對照'), tj = cur.indexOf(SEC2)
if (ti < 0 || tj < 0) errors.push('CURRICULUM.md 找不到「### 本站領域對照」或第二節的開頭')
else {
  const next = cur.slice(0, ti) + tree + cur.slice(tj)
  if (next !== cur) stale.push('docs/CURRICULUM.md：技能樹')
  cur = next
}

// ── 輸出 ───────────────────────────────────────────────
if (CHECK) {
  if (stale.length) errors.push(`這些產生段落過期了，執行 npm run docs:sync：\n  - ${stale.join('\n  - ')}`)
} else {
  fs.writeFileSync(path.join(root, 'README.md'), readme)
  fs.writeFileSync(path.join(root, 'docs/CURRICULUM.md'), cur)
}
if (warnings.length) console.warn('docs：\n' + warnings.map((w) => '! ' + w).join('\n'))
if (errors.length) {
  console.error('docs：\n' + errors.map((e) => '✗ ' + e).join('\n'))
  process.exit(1)
}
console.log(`docs：${CHECK ? '產生段落都是最新' : stale.length ? `已更新 ${stale.length} 處` : '沒有變動'}（課 ${skills.length}、實驗室 ${labs.length}、情境 ${scenarios.length}、程式題 ${EXERCISES.length}、選擇題 ${quizCount}、路線 ${PATH.length} 站）`)

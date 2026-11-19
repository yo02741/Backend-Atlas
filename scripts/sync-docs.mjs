// 從內容資料重新產生 README.md 與課綱（docs/CURRICULUM*.md）裡會跟著內容變動的段落。
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
const { DOMAINS, PATHS, LEVELS, displayNo } = await imp('src/content/roadmap.js')
const { TRACKS } = await imp('src/content/tracks.js')
// 有課的路線才進 README；路線內的領域依 roadmap.js 的順序
const LIVE = TRACKS.filter((t) => DOMAINS.some((d) => d.track === t.id))
const domainsOf = (t) => DOMAINS.filter((d) => d.track === t.id)
const pathCount = LIVE.reduce((n, t) => n + (PATHS[t.id] || []).length, 0)
const { EXERCISES } = await imp('src/content/exercises/index.js')
const { VERSIONS } = await imp('src/runtime/versions.js')
const { STAGES, PROJECTS } = await imp('src/content/project/stages.js')
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
const groupCounts = GROUPS.filter((g) => scenarios.some((s) => s.group === g.id)).map((g) => `${g.title} ${scenarios.filter((s) => s.group === g.id).length}`).join('；')

// ── README 的產生段落 ─────────────────────────────────
const blocks = {
  stats: () => [
    '| 內容 | 數量 |',
    '|---|---|',
    `| 路線 | ${LIVE.length}（${LIVE.map((t) => `${t.title} ${skills.filter((s) => s.domain.track === t.id).length} 課`).join('；')}） |`,
    ...LIVE.map((t) => `| ${t.title}的領域 | ${domainsOf(t).length}（${domainsOf(t).map((d) => short(d.title)).join('；')}） |`),
    `| 技能（課） | ${skills.length}，每課有重點卡（摘要、重點、自我檢核、官方文件）與**深入內容**（從一個具體問題開始 → 運作原理 → 實際程式 → 常見錯誤與錯誤訊息 → 動手；範例可一鍵在 Playground 執行） |`,
    `| 互動實驗室 | ${labs.length}，依領域列在下方 |`,
    `| 程式題 | ${EXERCISES.length}（Python ${kinds.python || 0} / SQL ${kinds.sql || 0} / config ${kinds.config || 0} / JS ${kinds.js || 0} / HTML ${kinds.html || 0} / CSS ${kinds.css || 0} / Vue ${kinds.vue || 0}），含實作路線的 ${projEx} 道驗收題；解答全部經真實執行環境驗證 |`,
    `| 選擇題 | ${quizCount}（每課 3 題，含程式碼判讀與情境題） |`,
    `| 設計情境 | ${scenarios.length}（${groupCounts}） |`,
    ...LIVE.filter((t) => STAGES.some((s) => s.track === t.id)).map((t) => `| ${t.title}的實作路線 | ${PROJECTS[t.id].title}：${STAGES.filter((s) => s.track === t.id).length} 個階段，每階段有說明與在瀏覽器裡跑的驗收題 |`),
    '| 課綱 | `docs/CURRICULUM.md`（後端與 AI）：獨立盤點的技能樹、16 週主線課綱（含實作路線對照）、第 17–22 週延伸課綱、10 週的 Docker 到 Kubernetes 專題、驗收設計' + (fs.existsSync(path.join(root, 'docs/CURRICULUM-frontend.md')) ? '；`docs/CURRICULUM-frontend.md`（前端）' : '') + ' |',
  ].join('\n'),

  route: () => [
    `### 建議學習路線（${LIVE.length} 條、共 ${pathCount} 站）`,
    '',
    '各路線首頁路線圖的站點。★ 表示附互動實驗室。站點定義在 `src/content/roadmap.js` 的 `PATHS`（`label` 是地圖上的短站名，`note` 是下表的「內容」）。',
    ...LIVE.filter((t) => (PATHS[t.id] || []).length).flatMap((t) => [
      '',
      `#### ${t.title}（${PATHS[t.id].length} 站）`,
      '',
      '| 站 | 課 | 領域 | 內容 |',
      '|---|---|---|---|',
      ...PATHS[t.id].map((p, i) => {
        const s = skillById.get(p.skill)
        if (!s) { errors.push(`PATHS.${t.id} 第 ${i + 1} 站的 skill "${p.skill}" 不存在`); return '' }
        return `| ${i + 1} | ${s.title}${star(s)} | ${s.domain.title} | ${p.note} |`
      }),
    ]),
  ].join('\n'),

  lessons: () => [
    `### 技能課程（${DOMAINS.length} 領域、${skills.length} 課）`,
    '',
    '每課有重點卡（摘要、範例技術、重點、自我檢核清單、官方文件連結）與深入內容。★ 表示附互動實驗室。',
    '',
    ...LIVE.flatMap((t) => [
      '',
      `#### ${t.title}（${domainsOf(t).length} 領域、${skills.filter((s) => s.domain.track === t.id).length} 課）`,
      '',
      '| 領域 | 課程 |',
      '|---|---|',
      ...domainsOf(t).map((d) => `| ${displayNo(d)}. ${d.title} | ${d.skills.map((s) => paren(s.title) + star(s)).join('；')} |`),
    ]),
  ].join('\n'),

  labs: () => [
    `### 互動實驗室（${labs.length} 個）`,
    '',
    '依路線與領域列出：',
    '',
    ...DOMAINS.map((d) => {
      const ls = labs.filter((l) => skillById.get(l.skill)?.domain.id === d.id)
      const t = TRACKS.find((x) => x.id === d.track)
      return ls.length ? `- **${t.title}｜${d.title}**：${ls.map((l) => l.title).join('；')}` : null
    }).filter(Boolean),
  ].join('\n'),

  scenarios: () => [
    `### 設計情境（${scenarios.length} 個）`,
    '',
    '每個情境包含背景與限制、模擬器、取捨表、決策題與落地程式碼。',
    '',
    ...GROUPS.filter((g) => scenarios.some((s) => s.group === g.id)).map((g) => {
      const ss = scenarios.filter((s) => s.group === g.id)
      return `- **${g.title}（${ss.length}）**：${ss.map((s) => s.title).join('；')}`
    }),
  ].join('\n'),

  practice: () => [
    '### 練習題',
    '',
    `- **程式題 ${EXERCISES.length} 道**（Python ${kinds.python || 0}、SQL ${kinds.sql || 0}、config ${kinds.config || 0}、JavaScript ${kinds.js || 0}、HTML ${kinds.html || 0}、CSS ${kinds.css || 0}、Vue ${kinds.vue || 0}）：在瀏覽器裡執行並跑測試：SQL 跑 PGlite、Python 跑 Pyodide、JS 跑 Web Worker；config 題（Dockerfile、compose、nginx、Kubernetes manifest、\`.gitlab-ci.yml\`、GitHub Actions）由 JS 檢查器逐條驗證；HTML、CSS、Vue 題在沙箱 iframe 裡執行（自架的 Vue ${VERSIONS.vue}，\`fetch\` 由假的門診 API 回應），測試透過 DOM 檢查畫面與行為，CSS 題在 390、768、1280 等寬度下各檢查一次。`,
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
  [/學習路線 PATHS（\d+ 站）/, `學習路線 PATHS（${pathCount} 站）`],
  [/# \d+ 個實驗室與情境模擬器/, `# ${labs.length + scenLabCount} 個實驗室與情境模擬器`],
]
for (const [re, rep] of inline) {
  if (!re.test(readme)) { errors.push(`README.md 找不到 ${re}`); continue }
  const next = readme.replace(re, rep)
  if (next !== readme) stale.push(`README.md：${rep}`)
  readme = next
}

// ── CURRICULUM.md 的技能樹（本站領域對照 + 延伸領域 J–L） ──
// 每條路線的課要排進自己路線的課綱檔（tracks.js 的 curriculum）某一週的「對應技能」
const weeksIn = (src) => {
  const out = {}
  // 結尾補一條分隔線：最後一週後面沒有下一個標題時也解析得到
  for (const m of (src + '\n---\n').matchAll(/^### 第 (\d+) 週[^\n]*\n([\s\S]*?)(?=^### |^## |^---$)/gm)) {
    const line = (m[2].match(/^- \*\*對應技能\*\*：.*$/m) || [''])[0]
    for (const id of line.matchAll(/`([a-z0-9-]+)`/g)) if (!(id[1] in out)) out[id[1]] = Number(m[1])
  }
  return out
}
let cur = read('docs/CURRICULUM.md')
const weekOf = weeksIn(cur)
// 沒排週次：同步時只提醒（部署前也會同步，不要因此擋住部署），檢查模式才算錯
const warnings = []
for (const t of LIVE) {
  const file = t.curriculum
  if (!fs.existsSync(path.join(root, file))) { (CHECK ? errors : warnings).push(`${t.title}路線的課綱 ${file} 不存在`); continue }
  const weeks = file === 'docs/CURRICULUM.md' ? weekOf : weeksIn(read(file))
  const unscheduled = skills.filter((s) => s.domain.track === t.id && !weeks[s.id]).map((s) => s.id)
  if (unscheduled.length) (CHECK ? errors : warnings).push(`${t.title}路線這些課沒有排進 ${file} 任何一週的「對應技能」：${unscheduled.join('、')}`)
}
const TREE = { language: 'A', web: 'B', data: 'C', auth: 'D', security: 'E', deploy: 'F', cicd: 'G', algo: 'H、I', devops: 'J', ai: 'K', knowledge: 'L' }
// 這份課綱涵蓋的路線（tracks.js 的 curriculum 指向 docs/CURRICULUM.md 的路線）
const TREE_DOMAINS = DOMAINS.filter((d) => TRACKS.find((t) => t.id === d.track)?.curriculum === 'docs/CURRICULUM.md')
const trackTitle = (d) => TRACKS.find((t) => t.id === d.track).title
let tree = `### 本站領域對照\n\n這份課綱涵蓋${[...new Set(TREE_DOMAINS.map(trackTitle))].join('與').replace(/(\p{Script=Han})([A-Za-z])/gu, '$1 $2').replace(/([A-Za-z])(\p{Script=Han})/gu, '$1 $2')}${/[A-Za-z]$/.test(TREE_DOMAINS.map(trackTitle).at(-1)) ? ' ' : ''}路線：${TREE_DOMAINS.length} 個領域、${TREE_DOMAINS.reduce((n, d) => n + d.skills.length, 0)} 堂課。主線領域 A–I 的技能與站上的課不是一對一（一堂課常涵蓋數個技能），下表是主要對應：\n\n| 本站領域 | 課數 | 技能樹 |\n|---|---|---|\n`
for (const d of TREE_DOMAINS) tree += `| ${trackTitle(d)} ${displayNo(d)} ${d.title} | ${d.skills.length} | 領域 ${TREE[d.id] || '?'} |\n`
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
console.log(`docs：${CHECK ? '產生段落都是最新' : stale.length ? `已更新 ${stale.length} 處` : '沒有變動'}（課 ${skills.length}、實驗室 ${labs.length}、情境 ${scenarios.length}、程式題 ${EXERCISES.length}、選擇題 ${quizCount}、路線 ${pathCount} 站）`)

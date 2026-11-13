// 外部連結檢查：收集課程內文的 refs、深入內容與實作路線說明裡的 https 連結，逐一請求。
// 用法：node scripts/check-links.mjs（需要能連外網；CI 的 links workflow 每月跑一次，也可以手動觸發）
// 結果分三類：ok（2xx / 3xx）、需人工確認（401 / 403 / 429 / 逾時：多半是網站擋自動請求）、失效（404 / 410 / 5xx / 網域不存在）。只有「失效」會讓指令失敗。
import { readdirSync, readFileSync, appendFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../src/content')
const files = [
  ...readdirSync(resolve(root, 'body')).filter((f) => f.endsWith('.js')).map((f) => `body/${f}`),
  ...readdirSync(resolve(root, 'body/parts')).filter((f) => f.endsWith('.js')).map((f) => `body/parts/${f}`),
  ...readdirSync(resolve(root, 'deep')).filter((f) => f.endsWith('.md')).map((f) => `deep/${f}`),
  ...readdirSync(resolve(root, 'project')).filter((f) => f.endsWith('.md')).map((f) => `project/${f}`),
]
const where = new Map()   // url → [檔名]
for (const f of files) {
  const text = readFileSync(resolve(root, f), 'utf8')
  // body 檔只看 refs 的 url 欄位；markdown 只看連結語法，不抓程式碼範例裡的網址
  const re = f.startsWith('body/') ? /url:\s*'(https:\/\/[^']+)'/g : /\]\((https:\/\/[^)\s]+)\)/g
  const prose = f.endsWith('.md') ? text.replace(/```[\s\S]*?```/g, '') : text
  for (const m of prose.matchAll(re)) where.set(m[1], [...(where.get(m[1]) || []), f])
}

const UA = 'Mozilla/5.0 (compatible; backend-atlas-link-check)'
async function check(url) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const res = await fetch(url, { method, redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html,*/*' }, signal: AbortSignal.timeout(20000) })
      if (res.status < 400) return { kind: 'ok', note: String(res.status) }
      if (method === 'HEAD') continue   // 不少網站不支援 HEAD，改用 GET 再試
      if ([401, 403, 429].includes(res.status)) return { kind: 'manual', note: String(res.status) }
      return { kind: 'broken', note: String(res.status) }
    } catch (e) {
      if (method === 'HEAD') continue
      const code = e.cause?.code || e.name
      return { kind: ['ENOTFOUND', 'EAI_AGAIN'].includes(code) ? 'broken' : 'manual', note: code }
    }
  }
}

const urls = [...where.keys()].sort()
const out = { ok: [], manual: [], broken: [] }
const queue = [...urls]
await Promise.all(Array.from({ length: 6 }, async () => {
  while (queue.length) { const u = queue.shift(); const r = await check(u); out[r.kind].push({ u, note: r.note }) }
}))
const line = ({ u, note }) => `- ${note}  ${u}  （${[...new Set(where.get(u))].join('、')}）`
const report = [`連結 ${urls.length} 個：正常 ${out.ok.length}、需人工確認 ${out.manual.length}、失效 ${out.broken.length}`,
  out.broken.length ? '\n### 失效\n' + out.broken.map(line).join('\n') : '',
  out.manual.length ? '\n### 需人工確認（網站擋自動請求或逾時）\n' + out.manual.map(line).join('\n') : ''].join('\n')
console.log(report)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n')
process.exit(out.broken.length ? 1 : 0)

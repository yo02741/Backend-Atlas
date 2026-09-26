// 技能內文（重點 points / 自我檢核 checklist / 延伸閱讀 refs）懶載入。
// 索引（dN-*.js）跟著主 chunk 走，內文（body/dN-*.js）每個領域一個 chunk，進到該領域的技能頁才下載。
const modules = import.meta.glob('./body/*.js')
const cache = new Map()   // 檔名 → { status: 'pending' | 'ok' | 'error', promise, value, error }
const EMPTY = { points: [], checklist: [], refs: [] }

function fileFor(domain) { return `./body/d${domain.no}-${domain.id}.js` }

export function preloadSkillBody(domain) {
  const key = fileFor(domain)
  if (cache.has(key)) return cache.get(key).promise
  const loader = modules[key]
  const entry = { status: 'pending' }
  entry.promise = (loader ? loader() : Promise.reject(new Error(`找不到技能內文檔 ${key}`)))
    .then((m) => { entry.status = 'ok'; entry.value = m.default })
    .catch((e) => { entry.status = 'error'; entry.error = e })
  cache.set(key, entry)
  return entry.promise
}

/* Suspense 資源：內文還沒到就 throw promise，交給最近的 <Suspense>；換頁走 startTransition 時舊頁面會留著等。
   內文缺漏不讓頁面炸掉：回傳空內文並 console.error（npm run validate 會在交付前擋下這種情況）。 */
export function readSkillBody(domain, skillId) {
  const key = fileFor(domain)
  if (!cache.has(key)) preloadSkillBody(domain)
  const entry = cache.get(key)
  if (entry.status === 'pending') throw entry.promise
  if (entry.status === 'error') { console.error(entry.error); return EMPTY }
  const body = entry.value[skillId]
  if (!body) { console.error(`技能 ${skillId} 在 ${key} 沒有內文`); return EMPTY }
  return body
}

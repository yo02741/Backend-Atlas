// 技能的「深入」內容：每課一份 markdown（./deep/<skill-id>.md），技能頁才懶載入、每課一個 chunk。
// 還沒寫深入內容的課回傳 null，技能頁就不顯示這一節。
const modules = import.meta.glob('./deep/*.md', { query: '?raw', import: 'default' })
const cache = new Map()   // 技能 id → { status, promise, value, error }

const keyFor = (id) => `./deep/${id}.md`
export const hasDeep = (id) => keyFor(id) in modules

export function preloadSkillDeep(id) {
  if (cache.has(id)) return cache.get(id).promise
  const loader = modules[keyFor(id)]
  const entry = { status: 'pending' }
  entry.promise = (loader ? loader() : Promise.resolve(null))
    .then((text) => { entry.status = 'ok'; entry.value = text })
    .catch((e) => { entry.status = 'error'; entry.error = e })
  cache.set(id, entry)
  return entry.promise
}

/* Suspense 資源：跟 readSkillBody 一樣，沒到就 throw promise */
export function readSkillDeep(id) {
  if (!cache.has(id)) preloadSkillDeep(id)
  const entry = cache.get(id)
  if (entry.status === 'pending') throw entry.promise
  if (entry.status === 'error') { console.error(entry.error); return null }
  return entry.value
}

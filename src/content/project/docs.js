// 各階段說明的 markdown（./<id>.md），進到該階段才下載
const modules = import.meta.glob('./*.md', { query: '?raw', import: 'default' })
const cache = new Map()

export function readStageDoc(id) {
  if (!cache.has(id)) {
    const loader = modules[`./${id}.md`]
    const entry = { status: 'pending' }
    entry.promise = (loader ? loader() : Promise.resolve(''))
      .then((t) => { entry.status = 'ok'; entry.value = t })
      .catch((e) => { entry.status = 'error'; entry.error = e })
    cache.set(id, entry)
  }
  const e = cache.get(id)
  if (e.status === 'pending') throw e.promise
  if (e.status === 'error') { console.error(e.error); return '' }
  return e.value
}

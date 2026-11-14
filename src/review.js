/* 複習頁的純函式：種子亂數、題庫攤平、依範圍篩題、抽題、計分、錯題紀錄。
   這個檔不 import 題庫（題庫索引用 import.meta.glob，Node 不能直接載入）：題庫與領域由呼叫端傳入，
   所以 scripts/test-review.mjs 可以直接 import 來測。 */

export const REVIEW_KEY = 'atlas-review-v1'
export const COUNTS = [10, 20]
export const SCOPES = ['done', 'domains', 'wrong', 'all']
export const HISTORY_MAX = 5

/* mulberry32：32 位元種子的小型 PRNG，同一個種子永遠產生同一串 [0, 1) 的數 */
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* 網址的 ?seed=：只收非負整數，其他一律當作沒帶 */
export function parseSeed(raw) {
  if (typeof raw !== 'string' || !/^\d{1,10}$/.test(raw.trim())) return null
  return Number(raw.trim()) >>> 0
}
export function randomSeed() { return Math.floor(Math.random() * 4294967296) >>> 0 }

/* 題目識別：技能 id + 該技能題組裡的索引。題庫改題序時舊紀錄會對到別題（紀錄只是複習用的提示，可接受） */
export function questionId(skill, index) { return `${skill}#${index}` }

/* 把題庫攤平成固定順序的清單：領域順序 → 領域內技能順序 → 題組內順序。
   順序固定，同一個種子才抽得到同一批題。題庫裡找不到對應技能的題組略過。 */
export function buildPool(quizzes, domains) {
  const pool = []
  for (const d of domains) {
    for (const s of d.skills) {
      const qs = quizzes[s.id]
      if (!Array.isArray(qs)) continue
      qs.forEach((q, index) => pool.push({ id: questionId(s.id, index), skill: s.id, skillTitle: s.title, domain: d.id, q }))
    }
  }
  return pool
}

/* 依範圍篩題：done = 已完成的課、domains = 選到的領域、wrong = 錯題清單、all = 全部 */
export function scopePool(pool, scope, { done = [], domains = [], wrong = [] } = {}) {
  if (scope === 'all') return pool
  const set = new Set(scope === 'done' ? done : scope === 'domains' ? domains : scope === 'wrong' ? wrong : [])
  if (scope === 'done') return pool.filter((it) => set.has(it.skill))
  if (scope === 'domains') return pool.filter((it) => set.has(it.domain))
  if (scope === 'wrong') return pool.filter((it) => set.has(it.id))
  return []
}

/* 不重複抽 n 題（範圍內不到 n 題就全拿）：Fisher–Yates 只洗前 n 個位置 */
export function sample(pool, n, rng) {
  const arr = pool.slice()
  const k = Math.max(0, Math.min(n, arr.length))
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng() * (arr.length - i))
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp
  }
  return arr.slice(0, k)
}

/* 計分：每題對錯、總分、依領域的答對數（領域順序照 domains） */
export function grade(items, answers, domains = []) {
  const results = items.map((it, i) => ({ id: it.id, skill: it.skill, domain: it.domain, right: answers[i] === it.q.answer }))
  const by = new Map()
  for (const r of results) {
    const row = by.get(r.domain) || { id: r.domain, total: 0, correct: 0 }
    row.total++
    if (r.right) row.correct++
    by.set(r.domain, row)
  }
  const order = domains.map((d) => d.id)
  const byDomain = [...by.values()].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
  return { results, total: results.length, correct: results.filter((r) => r.right).length, byDomain }
}

/* ── 錯題紀錄：{ wrong: [題目 id…], history: [{ at, scope, total, correct }…]（新的在前，最多 HISTORY_MAX 筆） } ── */
export function emptyRecord() { return { wrong: [], history: [] } }

export function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyRecord()
  const wrong = Array.isArray(raw.wrong) ? [...new Set(raw.wrong.filter((x) => typeof x === 'string' && x))] : []
  const history = (Array.isArray(raw.history) ? raw.history : [])
    .filter((h) => h && typeof h === 'object' && Number.isFinite(h.at) && Number.isInteger(h.total) && Number.isInteger(h.correct)
      && h.total > 0 && h.correct >= 0 && h.correct <= h.total)
    .map((h) => ({ at: h.at, scope: typeof h.scope === 'string' ? h.scope : 'all', total: h.total, correct: h.correct }))
    .slice(0, HISTORY_MAX)
  return { wrong, history }
}

/* 交卷後更新紀錄：答錯的加入錯題清單、答對的移出；成績放到最前面 */
export function applyRound(record, results, { at, scope }) {
  const wrong = new Set(record.wrong)
  for (const r of results) { if (r.right) wrong.delete(r.id); else wrong.add(r.id) }
  const entry = { at, scope, total: results.length, correct: results.filter((r) => r.right).length }
  return { wrong: [...wrong], history: [entry, ...record.history].slice(0, HISTORY_MAX) }
}

/* 讀寫 localStorage：連「取得 localStorage」本身都可能丟例外（被停用、私密模式），全部包在 try 裡。
   storage 參數給測試用；不傳就用瀏覽器的 localStorage。 */
export function loadRecord(storage) {
  try {
    const raw = (storage || globalThis.localStorage).getItem(REVIEW_KEY)
    return raw ? normalizeRecord(JSON.parse(raw)) : emptyRecord()
  } catch { return emptyRecord() }
}
export function saveRecord(record, storage) {
  try { (storage || globalThis.localStorage).setItem(REVIEW_KEY, JSON.stringify(record)); return true } catch { return false }
}

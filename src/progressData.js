/* 學習進度的資料形狀與合併規則（純函式，不碰 React / localStorage，Node 可直接 import 做單元測試）。
   形狀：{ done: [skillId], checks: { skillId: [bool] }, exercises / quizzes / scenarios: { id: 'pass' | 'fail' },
          rationales: { 'scenarioId:decisionId': text } } */

export function emptyProgress() {
  return { done: [], checks: {}, exercises: {}, quizzes: {}, scenarios: {}, rationales: {} }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const pick = (o, keep) => (isObj(o) ? Object.fromEntries(Object.entries(o).filter(([, v]) => keep(v))) : {})

/* 不信任來源（舊版 localStorage、雲端文件）一律先過這裡：型別不對的欄位丟掉，不會讓頁面炸掉 */
export function normalizeProgress(p) {
  if (!isObj(p)) return emptyProgress()
  const status = (v) => v === 'pass' || v === 'fail'
  return {
    done: Array.isArray(p.done) ? [...new Set(p.done.filter((x) => typeof x === 'string'))] : [],
    // 一格都沒勾的清單等於沒有這筆，拿掉讓比較與合併的結果一致
    checks: Object.fromEntries(Object.entries(pick(p.checks, (v) => Array.isArray(v) && v.some(Boolean))).map(([k, arr]) => [k, arr.map(Boolean)])),
    exercises: pick(p.exercises, status),
    quizzes: pick(p.quizzes, status),
    scenarios: pick(p.scenarios, status),
    rationales: pick(p.rationales, (v) => typeof v === 'string'),
  }
}

/* 三方合併：base 是這台裝置上次同步完成時的內容，local 是現在的本機，remote 是現在的雲端。
   每一項（一個技能完成與否、一格清單、一題狀態、一則理由）各自判斷：
   本機跟 base 一樣 → 只有雲端可能改過，取雲端；本機改過、雲端沒改 → 取本機；兩邊都改了且不同 → 衝突，
   題目狀態取較好的（pass > fail > 沒作答）、理由留本機（正在編輯的那份）。
   所以「取消完成」「清掉勾選」這類移除也能正確傳到另一台，不會被聯集加回來。 */
export function mergeProgress3(base, local, remote) {
  const o = normalizeProgress(base)
  const a = normalizeProgress(local)
  const b = normalizeProgress(remote)
  const pick3 = (bv, lv, rv, conflict) => (lv === bv ? rv : rv === bv || lv === rv ? lv : conflict(lv, rv))
  const keys = (...objs) => [...new Set(objs.flatMap((x) => Object.keys(x)))]

  const inO = new Set(o.done), inA = new Set(a.done), inB = new Set(b.done)
  const done = [...new Set([...a.done, ...b.done, ...o.done])].filter((id) => pick3(inO.has(id), inA.has(id), inB.has(id)))

  const checks = {}
  for (const k of keys(o.checks, a.checks, b.checks)) {
    const len = Math.max((o.checks[k] || []).length, (a.checks[k] || []).length, (b.checks[k] || []).length)
    const row = Array.from({ length: len }, (_, i) => pick3(Boolean(o.checks[k]?.[i]), Boolean(a.checks[k]?.[i]), Boolean(b.checks[k]?.[i])))
    if (row.some(Boolean)) checks[k] = row
  }

  const rank = { pass: 2, fail: 1 }
  const better = (x, y) => ((rank[x] || 0) >= (rank[y] || 0) ? x : y)
  const status = (ob, ab, bb) => {
    const out = {}
    for (const k of keys(ob, ab, bb)) {
      const v = pick3(ob[k] || null, ab[k] || null, bb[k] || null, better)
      if (v) out[k] = v
    }
    return out
  }

  const text = (x) => x || null      // 空字串＝沒填；只有空白也算有內容，打字時先打的空白不會在同步後被清掉
  const rationales = {}
  for (const k of keys(o.rationales, a.rationales, b.rationales)) {
    const v = pick3(text(o.rationales[k]), text(a.rationales[k]), text(b.rationales[k]), (lv) => lv)
    if (v) rationales[k] = v
  }

  return {
    done, checks,
    exercises: status(o.exercises, a.exercises, b.exercises),
    quizzes: status(o.quizzes, a.quizzes, b.quizzes),
    scenarios: status(o.scenarios, a.scenarios, b.scenarios),
    rationales,
  }
}

/* 兩方合併（這台第一次登入這個帳號，沒有共同的 base）：任何一邊做過的事都不丟。
   等於 base 為空的三方合併：done 聯集、checks 逐格 OR、狀態取較好的、理由兩邊都有時留本機。 */
export function mergeProgress(local, remote) {
  return mergeProgress3(emptyProgress(), local, remote)
}

/* 內容相同就不必重寫 / 重傳：done 當集合比、物件不管 key 順序 */
export function sameProgress(x, y) {
  return stable(normalizeProgress(x)) === stable(normalizeProgress(y))
}
function stable(p) {
  const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]))
  return JSON.stringify({
    done: [...p.done].sort(),
    checks: sortKeys(p.checks), exercises: sortKeys(p.exercises), quizzes: sortKeys(p.quizzes),
    scenarios: sortKeys(p.scenarios), rationales: sortKeys(p.rationales),
  })
}

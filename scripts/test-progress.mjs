// 進度合併規則的單元測試（src/progressData.js）：登入同步時兩台裝置的進度合在一起，任何一邊做過的事都不能丟。
import assert from 'node:assert/strict'
import { emptyProgress, normalizeProgress, mergeProgress, mergeProgress3, sameProgress } from '../src/progressData.js'

let n = 0
const test = (name, fn) => { fn(); n++; console.log('ok  ' + name) }

test('normalize：垃圾輸入回空進度', () => {
  for (const bad of [null, undefined, 3, 'x', [], { done: 'a', checks: [], exercises: null }]) {
    assert.deepEqual(normalizeProgress(bad), emptyProgress())
  }
})

test('normalize：丟掉型別不對的值、done 去重', () => {
  const p = normalizeProgress({
    done: ['a', 'a', 3, 'b'], checks: { x: [1, 0, 'y'], y: 'no' },
    exercises: { e1: 'pass', e2: 'maybe' }, quizzes: { q: 'fail' }, scenarios: { s: true }, rationales: { r: 'why', z: 5 }, extra: 1,
  })
  assert.deepEqual(p, {
    done: ['a', 'b'], checks: { x: [true, false, true] },
    exercises: { e1: 'pass' }, quizzes: { q: 'fail' }, scenarios: {}, rationales: { r: 'why' },
  })
})

test('merge：done 聯集', () => {
  assert.deepEqual(mergeProgress({ done: ['a', 'b'] }, { done: ['b', 'c'] }).done.sort(), ['a', 'b', 'c'])
})

test('merge：checks 逐格 OR，長度取長的', () => {
  const m = mergeProgress({ checks: { k: [true, false] } }, { checks: { k: [false, false, true], j: [true] } })
  assert.deepEqual(m.checks, { k: [true, false, true], j: [true] })
})

test('merge：狀態 pass > fail > 沒作答，兩個方向結果一樣', () => {
  const a = { exercises: { e1: 'fail', e2: 'pass', e3: 'fail' }, quizzes: { q1: 'pass' } }
  const b = { exercises: { e1: 'pass', e2: 'fail', e4: 'fail' }, scenarios: { s1: 'fail' } }
  const want = { e1: 'pass', e2: 'pass', e3: 'fail', e4: 'fail' }
  assert.deepEqual(mergeProgress(a, b).exercises, want)
  assert.deepEqual(mergeProgress(b, a).exercises, want)
  assert.deepEqual(mergeProgress(a, b).quizzes, { q1: 'pass' })
  assert.deepEqual(mergeProgress(a, b).scenarios, { s1: 'fail' })
})

test('merge：理由兩邊都有留本機；本機空字串不蓋掉雲端；只有一邊有就留那邊', () => {
  const m = mergeProgress({ rationales: { a: '本機', b: '', c: 'only-local' } }, { rationales: { a: '雲端', b: '雲端 b', d: 'only-remote' } })
  assert.deepEqual(m.rationales, { a: '本機', b: '雲端 b', c: 'only-local', d: 'only-remote' })
})

test('merge：雲端沒有文件（null）時等於本機', () => {
  const local = { done: ['a'], quizzes: { q: 'pass' }, rationales: { r: 'x' } }
  assert.ok(sameProgress(mergeProgress(local, null), local))
})

test('merge 冪等：合過一次再合不會變', () => {
  const a = { done: ['a'], checks: { k: [true] }, exercises: { e: 'fail' }, rationales: { r: 'x' } }
  const b = { done: ['b'], checks: { k: [false, true] }, exercises: { e: 'pass' } }
  const once = mergeProgress(a, b)
  assert.ok(sameProgress(mergeProgress(once, b), once))
  assert.ok(sameProgress(mergeProgress(once, once), once))
})

test('sameProgress：不看 key 順序與 done 順序', () => {
  assert.ok(sameProgress({ done: ['a', 'b'], quizzes: { x: 'pass', y: 'fail' } }, { quizzes: { y: 'fail', x: 'pass' }, done: ['b', 'a'] }))
  assert.ok(!sameProgress({ done: ['a'] }, { done: ['a', 'b'] }))
  assert.ok(!sameProgress({ rationales: { r: 'x' } }, { rationales: { r: 'y' } }))
})

/* 三方合併：base＝這台上次同步完成時的內容 */
test('merge3：本機沒改 → 取雲端（別台的取消完成會生效）', () => {
  const base = { done: ['a', 'b'] }
  assert.deepEqual(mergeProgress3(base, base, { done: ['a'] }).done, ['a'])
})

test('merge3：本機取消完成、雲端沒動 → 取消保留（不會被聯集加回來）', () => {
  const base = { done: ['a', 'b'] }
  assert.deepEqual(mergeProgress3(base, { done: ['a'] }, base).done, ['a'])
})

test('merge3：兩邊各自新增 → 都留；一邊取消、另一邊新增別的 → 各自生效', () => {
  const base = { done: ['a', 'b'] }
  assert.deepEqual(mergeProgress3(base, { done: ['a', 'b', 'c'] }, { done: ['a', 'b', 'd'] }).done.sort(), ['a', 'b', 'c', 'd'])
  assert.deepEqual(mergeProgress3(base, { done: ['b'] }, { done: ['a', 'b', 'd'] }).done.sort(), ['b', 'd'])
})

test('merge3：清單逐格三方合併', () => {
  const base = { checks: { k: [true, true, false] } }
  const local = { checks: { k: [false, true, false] } }     // 本機取消第 1 格
  const remote = { checks: { k: [true, true, true] } }      // 雲端勾了第 3 格
  assert.deepEqual(mergeProgress3(base, local, remote).checks, { k: [false, true, true] })
})

test('merge3：題目狀態兩邊都改了取較好的；只有一邊改取那邊（含清除）', () => {
  const base = { exercises: { e1: 'fail', e2: 'pass', e3: 'fail' } }
  const local = { exercises: { e1: 'pass', e3: 'fail' } }                // e1 變 pass、e2 被清掉（重設進度）
  const remote = { exercises: { e1: 'fail', e2: 'pass', e3: 'pass' } }   // e3 變 pass
  assert.deepEqual(mergeProgress3(base, local, remote).exercises, { e1: 'pass', e3: 'pass' })
})

test('merge3：理由兩邊都改了留本機；本機清空、雲端沒改 → 刪除', () => {
  const base = { rationales: { a: '舊', b: '舊 b' } }
  const m = mergeProgress3(base, { rationales: { a: '本機新', b: '' } }, { rationales: { a: '雲端新', b: '舊 b' } })
  assert.deepEqual(m.rationales, { a: '本機新' })
})

test('merge3：本機重設全部進度、雲端沒改 → 結果是空的', () => {
  const base = { done: ['a'], checks: { k: [true] }, quizzes: { q: 'pass' }, rationales: { r: 'x' } }
  assert.ok(sameProgress(mergeProgress3(base, emptyProgress(), base), emptyProgress()))
})

test('merge3：base 等於兩邊 → 不變', () => {
  const p = { done: ['a'], checks: { k: [true, false] }, scenarios: { s: 'fail' }, rationales: { r: 'x' } }
  assert.ok(sameProgress(mergeProgress3(p, p, p), p))
})

console.log(`${n} passed`)

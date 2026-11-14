// 複習頁純函式的單元測試（src/review.js）：種子亂數可重現、抽題不重複、範圍篩選、計分、錯題紀錄與壞掉的 localStorage。
import assert from 'node:assert/strict'
import {
  REVIEW_KEY, HISTORY_MAX, mulberry32, parseSeed, randomSeed, questionId, buildPool, scopePool, sample, grade,
  emptyRecord, normalizeRecord, applyRound, loadRecord, saveRecord,
} from '../src/review.js'

let n = 0
const test = (name, fn) => { fn(); n++; console.log('ok  ' + name) }

const q = (answer) => ({ q: '題幹題幹題幹題幹', options: ['a', 'b', 'c', 'd'], answer, explain: 'x' })
const DOMAINS = [
  { id: 'web', skills: [{ id: 'http', title: 'HTTP' }, { id: 'rest', title: 'REST' }] },
  { id: 'data', skills: [{ id: 'sql', title: 'SQL' }, { id: 'noquiz', title: '沒題目' }] },
]
const QUIZZES = { sql: [q(0), q(1), q(2)], rest: [q(3), q(0), q(1)], http: [q(2), q(3), q(0)], orphan: [q(0)] }
const pool = buildPool(QUIZZES, DOMAINS)
const ids = (items) => items.map((it) => it.id)

test('mulberry32：同種子同序列、不同種子不同序列、值落在 [0, 1)', () => {
  const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43)
  const sa = Array.from({ length: 50 }, a), sb = Array.from({ length: 50 }, b), sc = Array.from({ length: 50 }, c)
  assert.deepEqual(sa, sb)
  assert.notDeepEqual(sa, sc)
  assert.ok(sa.every((v) => v >= 0 && v < 1))
})

test('parseSeed：只收非負整數', () => {
  assert.equal(parseSeed('42'), 42)
  assert.equal(parseSeed('0'), 0)
  assert.equal(parseSeed(' 7 '), 7)
  for (const bad of ['', 'abc', '-1', '1.5', '1e3', '12345678901', null, undefined, 5]) assert.equal(parseSeed(bad), null)
  const r = randomSeed()
  assert.ok(Number.isInteger(r) && r >= 0 && r <= 0xffffffff)
})

test('buildPool：照領域 → 技能 → 題序攤平，略過沒有題組的技能與題庫裡的孤兒', () => {
  assert.deepEqual(ids(pool), ['http#0', 'http#1', 'http#2', 'rest#0', 'rest#1', 'rest#2', 'sql#0', 'sql#1', 'sql#2'])
  assert.deepEqual(pool[6], { id: 'sql#0', skill: 'sql', skillTitle: 'SQL', domain: 'data', q: QUIZZES.sql[0] })
  assert.equal(questionId('sql', 2), 'sql#2')
})

test('scopePool：四種範圍', () => {
  assert.equal(scopePool(pool, 'all').length, 9)
  assert.deepEqual(ids(scopePool(pool, 'done', { done: ['rest', 'ghost'] })), ['rest#0', 'rest#1', 'rest#2'])
  assert.deepEqual(ids(scopePool(pool, 'domains', { domains: ['data'] })), ['sql#0', 'sql#1', 'sql#2'])
  assert.deepEqual(ids(scopePool(pool, 'wrong', { wrong: ['sql#1', 'http#2', 'gone#0'] })), ['http#2', 'sql#1'])
  assert.deepEqual(scopePool(pool, 'done'), [])
  assert.deepEqual(scopePool(pool, 'domains', { domains: [] }), [])
  assert.deepEqual(scopePool(pool, 'nope'), [])
})

test('sample：不重複、數量正確、同種子可重現、不改動原陣列', () => {
  const before = ids(pool)
  const a = sample(pool, 5, mulberry32(7))
  const b = sample(pool, 5, mulberry32(7))
  assert.deepEqual(ids(a), ids(b))
  assert.equal(a.length, 5)
  assert.equal(new Set(ids(a)).size, 5)
  assert.deepEqual(ids(pool), before)
  const seen = new Set()
  for (let s = 0; s < 20; s++) seen.add(ids(sample(pool, 5, mulberry32(s))).join(','))
  assert.ok(seen.size > 10, '不同種子應該抽到不同組合')
})

test('sample：範圍不到 n 題就全拿；n = 0 或空題庫回空陣列', () => {
  const all = sample(pool, 20, mulberry32(1))
  assert.equal(all.length, 9)
  assert.deepEqual(ids(all).sort(), ids(pool).sort())
  assert.deepEqual(sample(pool, 0, mulberry32(1)), [])
  assert.deepEqual(sample([], 10, mulberry32(1)), [])
})

test('sample：每一題被抽到的機會接近（粗略檢查沒有偏在前面）', () => {
  const hits = Object.fromEntries(ids(pool).map((id) => [id, 0]))
  const rng = mulberry32(123)
  for (let i = 0; i < 3000; i++) for (const it of sample(pool, 3, rng)) hits[it.id]++
  for (const v of Object.values(hits)) assert.ok(v > 800 && v < 1200, `抽中次數 ${v} 偏離 1000 太多`)
})

test('grade：每題對錯、總分、依領域小結（照領域順序）', () => {
  const items = [pool[6], pool[0], pool[3], pool[7]]   // sql#0(0) http#0(2) rest#0(3) sql#1(1)
  const g = grade(items, [0, 0, 3, 3], DOMAINS)
  assert.deepEqual(g.results.map((r) => r.right), [true, false, true, false])
  assert.equal(g.total, 4)
  assert.equal(g.correct, 2)
  assert.deepEqual(g.byDomain, [{ id: 'web', total: 2, correct: 1 }, { id: 'data', total: 2, correct: 1 }])
  assert.equal(grade(items, [null, null, null, null], DOMAINS).correct, 0)
})

test('normalizeRecord：垃圾輸入回空紀錄；丟掉型別不對的值、錯題去重、成績最多留 HISTORY_MAX 筆', () => {
  for (const bad of [null, undefined, 3, 'x', [], { wrong: 'a', history: {} }]) assert.deepEqual(normalizeRecord(bad), emptyRecord())
  const many = Array.from({ length: 9 }, (_, i) => ({ at: i + 1, scope: 'all', total: 10, correct: i }))
  const r = normalizeRecord({
    wrong: ['a#0', 'a#0', 3, '', 'b#1'], extra: 1,
    history: [{ at: 'x', total: 10, correct: 1 }, { at: 1, total: 10, correct: 11 }, { at: 2, total: 0, correct: 0 }, null, { at: 5, total: 10, correct: 4, junk: 1 }, ...many],
  })
  assert.deepEqual(r.wrong, ['a#0', 'b#1'])
  assert.equal(r.history.length, HISTORY_MAX)
  assert.deepEqual(r.history[0], { at: 5, scope: 'all', total: 10, correct: 4 })
})

test('applyRound：答錯加入、答對移出、成績放最前面，不改動傳入的紀錄', () => {
  const r0 = { wrong: ['sql#0', 'rest#1'], history: [{ at: 1, scope: 'all', total: 10, correct: 9 }] }
  const frozen = JSON.stringify(r0)
  const r1 = applyRound(r0, [{ id: 'sql#0', right: true }, { id: 'http#2', right: false }, { id: 'rest#1', right: false }, { id: 'sql#2', right: true }], { at: 2, scope: 'wrong' })
  assert.deepEqual(r1.wrong.sort(), ['http#2', 'rest#1'])
  assert.deepEqual(r1.history, [{ at: 2, scope: 'wrong', total: 4, correct: 2 }, { at: 1, scope: 'all', total: 10, correct: 9 }])
  assert.equal(JSON.stringify(r0), frozen)
  let r = emptyRecord()
  for (let i = 0; i < 8; i++) r = applyRound(r, [{ id: 'a#0', right: i % 2 === 0 }], { at: i, scope: 'all' })
  assert.equal(r.history.length, HISTORY_MAX)
  assert.equal(r.history[0].at, 7)
  assert.deepEqual(r.wrong, ['a#0'])
})

test('loadRecord / saveRecord：正常來回', () => {
  const mem = new Map()
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) }
  assert.deepEqual(loadRecord(storage), emptyRecord())
  const rec = { wrong: ['sql#1'], history: [{ at: 9, scope: 'done', total: 10, correct: 7 }] }
  assert.equal(saveRecord(rec, storage), true)
  assert.ok(mem.has(REVIEW_KEY))
  assert.deepEqual(loadRecord(storage), rec)
})

test('loadRecord / saveRecord：內容壞掉、讀寫丟例外、沒有 localStorage 都不炸', () => {
  assert.deepEqual(loadRecord({ getItem: () => '{not json' }), emptyRecord())
  assert.deepEqual(loadRecord({ getItem: () => '"just a string"' }), emptyRecord())
  const broken = { getItem: () => { throw new Error('SecurityError') }, setItem: () => { throw new Error('QuotaExceededError') } }
  assert.deepEqual(loadRecord(broken), emptyRecord())
  assert.equal(saveRecord({ wrong: [], history: [] }, broken), false)
  // Node 沒有 localStorage（或沒設定儲存檔）：預設路徑一樣要安靜地退回空紀錄
  assert.deepEqual(loadRecord(), emptyRecord())
  assert.equal(typeof saveRecord(emptyRecord()), 'boolean')
})

console.log(`${n} passed`)

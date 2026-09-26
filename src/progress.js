import { useCallback, useEffect, useState } from 'react'

/* 學習進度：只存在這個瀏覽器（localStorage），每個讀寫都包 try/catch。
   結構：{ done, checks, exercises, quizzes, scenarios: { scenarioId: 'pass' }, rationales: { 'scenarioId:decisionId': text } } */
const KEY = 'atlas-progress-v1'

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return empty()
    const p = JSON.parse(raw)
    return {
      done: Array.isArray(p.done) ? p.done : [],
      checks: p.checks && typeof p.checks === 'object' ? p.checks : {},
      exercises: p.exercises && typeof p.exercises === 'object' ? p.exercises : {},
      quizzes: p.quizzes && typeof p.quizzes === 'object' ? p.quizzes : {},
      scenarios: p.scenarios && typeof p.scenarios === 'object' ? p.scenarios : {},
      rationales: p.rationales && typeof p.rationales === 'object' ? p.rationales : {},
    }
  } catch { return empty() }
}
function empty() { return { done: [], checks: {}, exercises: {}, quizzes: {}, scenarios: {}, rationales: {} } }
function save(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* 私密模式等情況忽略 */ }
}

const listeners = new Set()
let state = load()
function set(next) {
  state = next
  save(state)
  listeners.forEach((l) => l(state))
}

export function useProgress() {
  const [p, setP] = useState(state)
  useEffect(() => { listeners.add(setP); return () => listeners.delete(setP) }, [])
  const isDone = useCallback((id) => p.done.includes(id), [p])
  const toggleDone = useCallback((id) => {
    const done = state.done.includes(id) ? state.done.filter((x) => x !== id) : [...state.done, id]
    set({ ...state, done })
  }, [])
  const checks = useCallback((id, n) => {
    const arr = state.checks[id] || []
    return Array.from({ length: n }, (_, i) => Boolean(arr[i]))
  }, [p])
  const toggleCheck = useCallback((id, i, n) => {
    const arr = Array.from({ length: n }, (_, k) => Boolean((state.checks[id] || [])[k]))
    arr[i] = !arr[i]
    set({ ...state, checks: { ...state.checks, [id]: arr } })
  }, [])
  const exerciseStatus = useCallback((id) => p.exercises[id] || null, [p])
  const setExercise = useCallback((id, status) => {
    // 已通過的不會因為之後失敗而退回
    if (state.exercises[id] === 'pass' && status !== 'pass') return
    set({ ...state, exercises: { ...state.exercises, [id]: status } })
  }, [])
  const quizStatus = useCallback((skillId) => p.quizzes[skillId] || null, [p])
  const setQuiz = useCallback((skillId, status) => {
    if (state.quizzes[skillId] === 'pass' && status !== 'pass') return
    set({ ...state, quizzes: { ...state.quizzes, [skillId]: status } })
  }, [])
  const scenarioStatus = useCallback((id) => p.scenarios[id] || null, [p])
  const setScenario = useCallback((id, status) => {
    if (state.scenarios[id] === 'pass' && status !== 'pass') return
    set({ ...state, scenarios: { ...state.scenarios, [id]: status } })
  }, [])
  const rationale = useCallback((key) => p.rationales[key] || '', [p])
  const setRationale = useCallback((key, text) => { set({ ...state, rationales: { ...state.rationales, [key]: text } }) }, [])
  const reset = useCallback(() => set(empty()), [])
  return { done: p.done, isDone, toggleDone, checks, toggleCheck, exerciseStatus, setExercise, quizStatus, setQuiz, scenarioStatus, setScenario, rationale, setRationale, exercises: p.exercises, quizzes: p.quizzes, scenarios: p.scenarios, reset }
}

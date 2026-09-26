import { useCallback, useEffect, useState } from 'react'
import { emptyProgress, normalizeProgress } from './progressData.js'

/* 學習進度：存在這個瀏覽器（localStorage），每個讀寫都包 try/catch。
   登入時由 src/cloud/sync.js 同步到帳號：它透過 onLocalChange 得知使用者的改動，用 replaceProgress 寫回雲端的版本。
   資料形狀與合併規則見 progressData.js。 */
const KEY = 'atlas-progress-v1'

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? normalizeProgress(JSON.parse(raw)) : emptyProgress()
  } catch { return emptyProgress() }
}
function save(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* 私密模式等情況忽略 */ }
}

const listeners = new Set()
const changeHooks = new Set()
let state = load()
function apply(next) {
  state = next
  save(state)
  listeners.forEach((l) => l(state))
}
/* 使用者自己的改動：寫入並通知同步層 */
function set(next) {
  apply(next)
  changeHooks.forEach((h) => h(state))
}

/* 給同步層用：讀目前進度、以雲端版本覆寫（不算使用者改動，不會再觸發上傳）、訂閱使用者改動 */
export function getProgress() { return state }
export function replaceProgress(next) { apply(normalizeProgress(next)) }
export function onLocalChange(fn) { changeHooks.add(fn); return () => changeHooks.delete(fn) }

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
  const reset = useCallback(() => set(emptyProgress()), [])
  return { done: p.done, isDone, toggleDone, checks, toggleCheck, exerciseStatus, setExercise, quizStatus, setQuiz, scenarioStatus, setScenario, rationale, setRationale, exercises: p.exercises, quizzes: p.quizzes, scenarios: p.scenarios, reset }
}

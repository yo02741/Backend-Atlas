import { useCallback, useEffect, useState } from 'react'

/* 只存在這個瀏覽器、不進雲端同步的紀錄：進階驗收與跨課作業的勾選、實驗室的猜測。
   形狀：{ checks: { key: [bool] }, notes: { key: text } }。key 例：'challenge:<課 id>'、'scenario:<情境 id>'、
   'assignment:<作業 id>:<步驟序號>'、'lab:<實驗室名>'。讀寫都包 try/catch，localStorage 不能用時只留在記憶體。
   進度（progress.js）的形狀不變，所以 firestore.rules 不用改。 */
const KEY = 'atlas-local-v1'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    return { checks: isObj(raw.checks) ? raw.checks : {}, notes: isObj(raw.notes) ? raw.notes : {} }
  } catch { return { checks: {}, notes: {} } }
}
let state = load()
const listeners = new Set()
function set(next) {
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* 不能寫就只留在這個分頁 */ }
  listeners.forEach((l) => l(state))
}
function useLocal() {
  const [s, setS] = useState(state)
  useEffect(() => { listeners.add(setS); setS(state); return () => listeners.delete(setS) }, [])
  return s
}

/* n 格勾選：回傳 [bool[], toggle(i)] */
export function useLocalChecks(key, n) {
  const s = useLocal()
  const arr = Array.from({ length: n }, (_, i) => Boolean(s.checks[key]?.[i]))
  const toggle = useCallback((i) => {
    const row = Array.from({ length: n }, (_, k) => Boolean(state.checks[key]?.[k]))
    row[i] = !row[i]
    const checks = { ...state.checks }
    if (row.some(Boolean)) checks[key] = row
    else delete checks[key]
    set({ ...state, checks })
  }, [key, n])
  return [arr, toggle]
}

/* 一段文字：回傳 [text, setText] */
export function useLocalNote(key) {
  const s = useLocal()
  const setText = useCallback((text) => {
    const notes = { ...state.notes }
    if (text) notes[key] = text
    else delete notes[key]
    set({ ...state, notes })
  }, [key])
  return [typeof s.notes[key] === 'string' ? s.notes[key] : '', setText]
}

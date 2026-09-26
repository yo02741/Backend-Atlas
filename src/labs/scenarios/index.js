import { lazy } from 'react'

/* 情境模擬器登錄：src/labs/scenarios/*ScenarioLab.jsx，懶載入，各自一個 chunk */
const modules = import.meta.glob('./*Lab.jsx')
const cache = {}
export function loadScenarioLab(name) {
  const key = `./${name}.jsx`
  if (!modules[key]) return null
  if (!cache[name]) cache[name] = lazy(modules[key])
  return cache[name]
}

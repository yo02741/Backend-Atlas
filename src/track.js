// 目前的路線：路由帶 track 就用它；單頁（課、領域、實驗室、程式題、情境）從內容推出；首頁沒有路線。
// 上次看的路線記在 localStorage，首頁的路線卡依此排序。
import { TRACKS } from './content/tracks.js'
import { findSkill, findDomain } from './content/roadmap.js'
import { LAB_META } from './labs/index.js'
import { findExercise } from './content/exercises/index.js'
import { findScenario, groupOf } from './content/scenarios/index.js'
import { findStage } from './content/project/stages.js'
import { findAssignment } from './content/assignments.js'

const KEY = 'atlas-track'
export function rememberTrack(id) { try { localStorage.setItem(KEY, id) } catch { /* 不能寫就不記 */ } }
export function lastTrack() { try { return localStorage.getItem(KEY) } catch { return null } }

const known = (id) => (TRACKS.some((t) => t.id === id) ? id : null)

export function trackOfRoute(route) {
  switch (route.view) {
    case 'track': return known(route.id)
    case 'skill': return findSkill(route.id)?.domain.track || null
    case 'domain': return findDomain(route.id)?.track || null
    case 'lab': return findSkill(LAB_META[route.name]?.skill)?.domain.track || null
    case 'exercise': { const ex = findExercise(route.id); return ex?.project ? findStage(ex.project)?.track || null : findSkill(ex?.skill)?.domain.track || null }
    case 'scenario': { const sc = findScenario(route.id); return sc ? groupOf(sc).track : null }
    case 'assignment': return known(findAssignment(route.id)?.track)
    case 'project': return route.id ? findStage(route.id)?.track || null : known(route.track) || 'backend'
    default: return known(route.track)
  }
}

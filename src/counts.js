import { skillsOf, allSkills, stationsOf } from './content/roadmap.js'
import { TRACK_WEEKS } from './content/curriculum-weeks.js'

/* 首頁與路線首頁的數量口徑。
   主線：學習路線的站（roadmap.js 的 PATHS）與課綱的週數（curriculum-weeks.js，由 docs:sync 產生）；其餘的課是選讀。
   實驗室：mounts 是掛著實驗室的課數，labs 是獨立的實驗室數；shared 是多課共用的實驗室（名稱 → 課 id[]）。 */
export function countsOf(track) {
  const skills = skillsOf(track)
  const stations = stationsOf(track).length
  const withLab = skills.filter((s) => s.lab)
  const by = new Map()
  for (const s of withLab) by.set(s.lab, [...(by.get(s.lab) || []), s.id])
  return {
    lessons: skills.length,
    stations,
    weeks: TRACK_WEEKS[track] || 0,
    optional: skills.length - stations,
    labMounts: withLab.length,
    labs: by.size,
    shared: Object.fromEntries([...by].filter(([, ids]) => ids.length > 1)),
  }
}

/* 「11 實驗室（12 課掛載）」：有共用時才加括號 */
export const labLabel = (c) => `${c.labs} 實驗室${c.labMounts > c.labs ? `（${c.labMounts} 課掛載）` : ''}`

export const skillsWithLab = (name) => allSkills().filter((s) => s.lab === name)

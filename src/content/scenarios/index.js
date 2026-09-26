// 設計情境：在真實限制下做選擇。每個情境一檔（同目錄 *.js），這裡用 glob 自動收集。
const mods = import.meta.glob('./*.js', { eager: true })

export const SCENARIO_GROUPS = [
  { id: 'api', title: 'API 設計', en: 'API DESIGN', color: 'aqua', blurb: '分頁、快取、冪等、限流、長任務、上傳、搜尋、版本——每個 API 都會遇到的設計決定。' },
  { id: 'data', title: '資料與身分', en: 'DATA & IDENTITY', color: 'violet', blurb: '多租戶隔離、軟刪除與稽核、讀寫分離的一致性、SPA 與 App 的認證方案。' },
  { id: 'traffic', title: '高流量', en: 'HIGH TRAFFIC', color: 'red', blurb: '流量上來之後每一層怎麼撐：擴展路徑、秒殺、削峰、資料庫擴展、邊緣快取、通知扇出。' },
]

export const SCENARIOS = Object.entries(mods)
  .filter(([path]) => !path.endsWith('/index.js'))
  .map(([, m]) => m.default)
  .filter(Boolean)
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))

export function findScenario(id) { return SCENARIOS.find((s) => s.id === id) || null }
export function scenariosInGroup(groupId) { return SCENARIOS.filter((s) => s.group === groupId) }
export function scenariosForSkill(skillId) { return SCENARIOS.filter((s) => (s.skills || []).includes(skillId)) }
export function groupOf(scenario) { return SCENARIO_GROUPS.find((g) => g.id === scenario.group) || SCENARIO_GROUPS[0] }

// 實作路線：從零做完一個門診掛號後端。每一階段一份說明（./<id>.md，頁面懶載入）與幾道驗收題（exercises/project.js，題目帶 project: '<id>'）。
// 此檔要能被 Node 直接 import（校驗腳本用）。
export const PROJECT = {
  title: '從零做完一個門診掛號後端',
  summary: '一個階段接一個階段，把前面學過的課組成一個完整的系統：資料表、領域邏輯、API、權限、並行搶號、快取與限流、容器與 CI、可觀測性。每階段都有在瀏覽器裡跑的驗收測試。',
}

// { id, no, title, summary, lessons: [技能 id], exercises: [程式題 id] }
export const STAGES = []

export function findStage(id) { return STAGES.find((s) => s.id === id) || null }

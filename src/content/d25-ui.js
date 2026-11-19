// 前端路線：UI 元件詞彙。內文在 ./body/d25-ui.js，深入內容在 ./deep/<skill-id>.md
export default {
  id: 'ui',
  track: 'frontend',
  no: 25,
  title: 'UI 元件詞彙',
  en: 'UI VOCABULARY',
  color: 'violet',
  tagline: '元件與狀態的名稱：互動狀態、回饋、空狀態與表單。',
  skills: [
    {
      id: 'ui-states',
      title: '互動狀態',
      en: 'Interactive states',
      level: 1,
      summary: '每個可以操作的元件都有 default、hover、focus、active、disabled，資料相關的再加 loading、error、selected；規格要逐一寫出每個狀態長什麼樣、能不能操作。',
      example: { primary: 'CSS 偽類（:hover、:focus-visible、:disabled）與 ARIA 狀態屬性', alts: ['元件庫的 variant 與 state props'] },
      keywords: [],
      lab: null,
      reviewed: '2026-11',
    },
    {
      id: 'feedback',
      title: '回饋：Toast、Alert、Skeleton、Empty state',
      en: 'Feedback',
      level: 1,
      summary: '操作成功、失敗、等待、沒有資料時各用不同的元件：Toast 短暫確認、Alert 留在原處說明錯誤、Skeleton 佔住版面等資料、Empty state 說明為什麼空與下一步。',
      example: { primary: 'Toast、Alert、Skeleton、Empty state 加上 role="status" 與 role="alert"', alts: ['Snackbar、Banner、Spinner、Progress bar'] },
      keywords: [],
      lab: null,
      reviewed: '2026-11',
    },
  ],
}

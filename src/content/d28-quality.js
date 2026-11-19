// 前端路線：品質：測試、效能、無障礙。內文在 ./body/d28-quality.js，深入內容在 ./deep/<skill-id>.md
export default {
  id: 'quality',
  track: 'frontend',
  no: 28,
  title: '品質：測試、效能、無障礙',
  en: 'QUALITY',
  color: 'teal',
  tagline: '無障礙、前端測試的分層、lint 與型別檢查、Core Web Vitals 與錯誤監控。',
  skills: [
    {
      id: 'a11y-basics',
      title: '無障礙基礎',
      en: 'Accessibility basics',
      level: 1,
      summary: '只用鍵盤走得完、每個控制項有念得出來的名稱、文字對比夠、焦點看得見、狀態變化讀得到。先用原生 HTML 元素，ARIA 只補 HTML 表達不了的部分；自動檢查只抓得到一部分，其餘靠鍵盤與螢幕閱讀器實測。',
      example: { primary: 'WCAG 2.2 AA，用 Chrome DevTools 的 Accessibility 分頁與 Lighthouse 檢查', alts: ['axe DevTools 擴充功能', 'NVDA、VoiceOver 螢幕閱讀器', 'eslint-plugin-vuejs-accessibility'] },
      keywords: ['無障礙', 'HTML', 'Chrome DevTools'],
      lab: null,
      reviewed: '2026-11',
    },
  ],
}

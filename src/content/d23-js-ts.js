// 前端路線：JavaScript 與 TypeScript。內文在 ./body/d23-js-ts.js，深入內容在 ./deep/<skill-id>.md
export default {
  id: 'js-ts',
  track: 'frontend',
  no: 23,
  title: 'JavaScript 與 TypeScript',
  en: 'JAVASCRIPT & TYPESCRIPT',
  color: 'yellow',
  tagline: '非同步、模組、型別，以及讀懂錯誤訊息。',
  skills: [
    {
      id: 'async-js',
      title: '非同步：Promise 與 async/await',
      en: 'Promises & async/await',
      level: 1,
      summary: '一行一個 await 是依序、總時間相加；互不相依的請求用 Promise.all 平行送。部分失敗也要顯示其他區塊時用 allSettled，loading 在 finally 關掉，forEach 裡的 await 不會被等。',
      example: { primary: 'Promise + async/await（ES2017 起）', alts: ['Promise.allSettled（ES2020）', 'AbortController 取消請求'] },
      keywords: ['JavaScript'],
      lab: null,
      reviewed: '2026-11',
      related: ['python-async', 'resilience'],
    },
  ],
}

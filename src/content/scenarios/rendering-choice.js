// 設計情境：公開頁與登入後的頁面用 CSR、SSR 還是 SSG（前端路線，建置與上線）
export default {
  id: 'rendering-choice',
  order: 40,
  group: 'delivery',
  title: '公開頁與登入後的頁面：CSR、SSR 還是 SSG',
  en: 'CSR, SSR or SSG',
  level: 2,
  skills: ['page-loading', 'how-browsers-render', 'bundles-chunks', 'spa-deploy', 'http-caching', 'rendering-modes', 'web-vitals'],
  related: ['hosting-choice', 'cache'],
  week: 13,
  lab: 'RenderingChoiceScenarioLab',
  summary: '門診網站的公開頁要被搜尋到、分享到 LINE 要有預覽、手機上要快；登入後的「我的掛號」全是個資。整站 CSR、SSR、SSG，還是每種頁面各選一種？',
  situation: '門診網站目前是一個 Vue SPA，放在靜態主機上：首頁、門診時刻表、醫師介紹、300 篇衛教文章與登入後的「我的掛號」，都由同一個 `index.html` 載入 JavaScript 後畫出來。行銷組反映衛教文章分享到 LINE 時，每一篇都顯示同一個網站標題、沒有文章的圖片。門診時刻表一天會因停診改好幾次；「我的掛號」只給登入的病患看。團隊考慮改用 Nuxt 4（2026-11 npm 上是 4.6）。',
  constraints: [
    '公開頁要被搜尋引擎收錄，分享到 LINE 要顯示該頁自己的標題與圖片',
    '手機 4G 打開門診時刻表，要很快看到內容',
    '停診公告要在 10 分鐘內出現在時刻表上',
    '「我的掛號」含個資，不能被 CDN 或任何共用快取存起來',
    '目前只有靜態主機；加一個 Node 伺服器，就多一個要監控、要擴充的服務',
  ],
  options: [
    {
      id: 'csr', name: 'CSR（現在的 SPA）',
      summary: '伺服器只送一個幾乎空白的 `index.html` 與 JS bundle，瀏覽器下載、執行、呼叫 API 之後才畫出內容。',
      pros: ['部署最簡單：一包靜態檔，任何靜態主機或 CDN', '換頁不重新載入整頁，登入後互動多的頁面最順', '資料是 API 當下的值'],
      cons: ['第一次看到內容要等 JS 下載、執行、再呼叫 API，bundle 越大越慢', 'HTML 裡沒有內容：連結預覽多半不執行 JavaScript，只讀得到 `index.html` 裡共用的 meta；搜尋引擎要先執行 JS 才看得到內容'],
    },
    {
      id: 'ssr', name: 'SSR（每個請求在伺服器渲染）',
      summary: 'Nuxt 這類框架在 Node 伺服器上執行元件、呼叫 API，回傳已經有內容的 HTML；瀏覽器再下載 JS 做 hydration，接手互動。',
      pros: ['HTML 一到就看得到內容，爬蟲與連結預覽拿到該頁的標題與 meta', '資料是請求當下的值，停診公告下一個請求就看得到', '頁面組合再多（搜尋條件）也能逐一產生'],
      cons: ['多一個 Node 伺服器：每個請求都要渲染，要監控、擴充，流量大時要加快取', '看得到但還不能按：hydration 完成前，點按鈕沒有反應', '伺服器與瀏覽器渲染出不同的結果會出現 hydration mismatch；登入後的頁面 HTML 含個資，只能 `Cache-Control: private`'],
    },
    {
      id: 'ssg', name: 'SSG（建置時預先產生）',
      summary: '`nuxt generate` 在建置時把每個頁面渲染成 HTML 檔，放上靜態主機或 CDN；瀏覽器載入後一樣做 hydration。',
      pros: ['HTML 有內容又是靜態檔：最快、最便宜，沒有伺服器要顧', '內容對每個人都一樣，CDN 可以放心快取'],
      cons: ['內容停在建置那一刻：停診公告要重新建置、部署才看得到', '頁面數量要有限：300 篇文章可以，所有搜尋條件的組合不行', '登入後的個人資料無法預先產生，只能先送殼再由瀏覽器抓'],
    },
    {
      id: 'hybrid', name: '依頁面選（Nuxt 的 routeRules）',
      summary: '文章與醫師介紹 `prerender: true`；時刻表 SSR 加 5 分鐘快取（`swr: 300`）；「我的掛號」`ssr: false`，只在瀏覽器渲染。',
      pros: ['每種頁面用最適合的方式：公開頁有完整的 HTML，個資不經過伺服器渲染', '時刻表大多數請求直接拿快取，伺服器約 5 分鐘才渲染一次'],
      cons: ['只要有任何一條 SSR 或 `swr` 規則，就還是要一個 Node 伺服器', '三種模式的行為、快取與除錯方式都要懂，部署設定比單一模式複雜'],
    },
  ],
  tradeoffs: {
    axes: ['第一次看到內容', '搜尋與連結預覽', '資料新鮮度', '伺服器', '登入後的個資頁'],
    rows: [
      { option: 'csr', cells: ['差：等 JS 與 API', '差：HTML 沒有內容', '好：API 當下', '好：只要靜態主機', '好：本來就在瀏覽器渲染'] },
      { option: 'ssr', cells: ['好：HTML 就有', '好', '好：請求當下', '差：Node 伺服器，每請求渲染', '中：HTML 含個資，不能共用快取'] },
      { option: 'ssg', cells: ['好：靜態 HTML', '好', '差：要重新建置', '好：只要靜態主機', '差：只能送殼'] },
      { option: 'hybrid', cells: ['好：公開頁', '好：公開頁', '中：依頁面設定', '中：要 Node，多數請求不用渲染', '好：走 CSR'] },
    ],
  },
  decisions: [
    { id: 'staff', situation: '院內排班系統：只有登入的員工用，放在內網，不需要被搜尋，畫面上拖拉、篩選的互動很多。', options: ['csr', 'ssr', 'ssg', 'hybrid'], answer: 'csr',
      explain: 'SSR 與 SSG 解決的是首屏與爬蟲，這兩件事在內網的登入後系統都不重要。CSR 一包靜態檔就能部署，切換頁面不重新載入；第一次載入慢，用路由懶載入把 bundle 切小。' },
    { id: 'articles', situation: '只有 300 篇衛教文章的網站：每週新增幾篇，要被搜尋到、LINE 分享要顯示每篇的標題與圖片，只能放在現有的靜態主機。', options: ['csr', 'ssr', 'ssg', 'hybrid'], answer: 'ssg',
      explain: '頁面數量有限、內容對每個人都一樣、更新頻率低：建置時產生 300 個 HTML 檔，靜態主機與 CDN 直接送出，沒有伺服器要顧。新增文章就是在 CI 重新建置、部署一次。' },
    { id: 'doctor-search', situation: '「找醫師」頁：科別 × 院區 × 星期 × 時段的組合上千種，每種組合都希望被搜尋引擎收錄，資料每小時變動。', options: ['csr', 'ssr', 'ssg', 'hybrid'], answer: 'ssr',
      explain: '組合太多，SSG 無法全部預先產生；內容又要給爬蟲看，CSR 不夠。SSR 在請求進來時才渲染該組合，再配合短時間的快取降低伺服器負擔。' },
    { id: 'clinic-site', situation: '本情境的整個門診網站：首頁、醫師介紹、衛教文章、門診時刻表與「我的掛號」在同一個專案。', options: ['csr', 'ssr', 'ssg', 'hybrid'], answer: 'hybrid',
      explain: '各頁需求不同：文章與醫師介紹 prerender；時刻表 SSR 加 5 分鐘 swr 快取，停診公告幾分鐘內出現；「我的掛號」用 `ssr: false`，個資不經過伺服器渲染，也不會被共用快取存起來。代價是要養一個 Node 伺服器。' },
  ],
  implementation: [
    { title: '每種頁面各選一種渲染方式', lang: 'ts', code: `// nuxt.config.ts（Nuxt 4.6）
export default defineNuxtConfig({
  routeRules: {
    '/': { prerender: true },
    '/doctors/**': { prerender: true },     // 醫師介紹：建置時產生
    '/articles/**': { prerender: true },    // 衛教文章：建置時從首頁與列表的連結找到每一篇
    // 時刻表：SSR，結果快取 300 秒；到期後的第一個請求先拿舊版，同時在背景重新渲染
    '/schedule': { swr: 300 },
    // 我的掛號：伺服器只送殼，個資在瀏覽器裡用 API 抓
    '/me/**': { ssr: false },
  },
})` },
    { title: '文章頁：內容與 meta 在 HTML 裡就有', lang: 'vue', code: `<!-- pages/articles/[slug].vue -->
<script setup lang="ts">
const route = useRoute()
// 在伺服器（或建置時）執行一次，結果隨 HTML 送到瀏覽器，hydration 時不重抓
const { data: article, error } = await useFetch('/api/articles/' + route.params.slug)
if (error.value) throw createError({ statusCode: 404, statusMessage: '找不到這篇文章' })

// 連結預覽與搜尋結果讀這些標籤；CSR 時它們只在 JS 執行後才出現
useSeoMeta({
  title: () => article.value?.title,
  description: () => article.value?.summary,
  ogTitle: () => article.value?.title,
  ogDescription: () => article.value?.summary,
  ogImage: () => article.value?.cover,
})
</script>

<template>
  <article>
    <h1>{{ article?.title }}</h1>
    <p>{{ article?.summary }}</p>
  </article>
</template>` },
    { title: '避免 hydration mismatch', lang: 'vue', code: `<script setup lang="ts">
import { ref, onMounted } from 'vue'

// ✕ 伺服器與瀏覽器算出不同的值，hydration 時 Vue 會警告 mismatch：
// const greeting = new Date().getHours() < 12 ? '早安' : '午安'   // 伺服器的時區常是 UTC
// const name = localStorage.getItem('name')                         // 伺服器沒有 localStorage

// ✓ 第一次渲染兩邊一樣，瀏覽器才有的東西放進 onMounted（只在瀏覽器執行）
const greeting = ref('您好')
onMounted(() => {
  greeting.value = new Date().getHours() < 12 ? '早安' : '午安'
})
</script>

<template>
  <p>{{ greeting }}</p>
  <!-- 整塊只在瀏覽器渲染：伺服器輸出 fallback 的內容 -->
  <ClientOnly fallback="載入中…">
    <RecentlyViewed />
  </ClientOnly>
</template>` },
  ],
  exercise: null,
  refs: [],
}

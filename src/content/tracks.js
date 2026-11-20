// 路線：首頁先選路線，每條路線有自己的領域、學習路線圖與關鍵字。
// 此檔要能被 Node 直接 import（校驗與 docs:sync 用），不放 import.meta.glob。
//   color         只能用既有的 CSS token 名稱（var(--c-<color>)），用在路線圖、篩選標籤等小面積
//   sticker       首頁路線卡的平塗色（var(--st-<sticker>)）
//   mapRequired   這條路線的每一課都要有地圖層（body 的 map）
//   curriculum    課綱檔；同一份可以給多條路線共用
//   featuredLabs  路線首頁的「互動實驗室精選」
//   domainNote    路線首頁領域區塊的一句說明
export const SITE = {
  name: 'u kinda should know',
  repo: 'https://github.com/yo02741/u-kinda-should-know',
}

export const TRACKS = [
  {
    id: 'frontend', title: '前端', en: 'FRONTEND', color: 'aqua', sticker: 'mint', mapRequired: true,
    tagline: '瀏覽器怎麼畫出畫面、HTML 與 CSS 版面、Vue 元件、呼叫後端與畫面狀態。',
    lede: '畫面怎麼來、元件叫什麼、狀態怎麼切：寫需求和驗收 AI 產出的元件時用得到的詞彙與檢查。',
    curriculum: 'docs/CURRICULUM-frontend.md',
    featuredLabs: ['RenderPipelineLab', 'FlexboxLab', 'ApiStatesLab'],
  },
  {
    id: 'backend', title: '後端', en: 'BACKEND', color: 'blue', sticker: 'blue', mapRequired: false,
    tagline: 'HTTP 與 API、SQL 與交易、驗證授權、資安、容器、CI/CD 與 Kubernetes。',
    lede: '用可以操作的圖學後端：JOIN、索引、交易、JWT、Docker 的層。程式題在瀏覽器裡執行。',
    domainNote: '01–08 是主線，09 是延伸。範例以 Python 與 PostgreSQL 為主。',
    curriculum: 'docs/CURRICULUM.md',
    featuredLabs: ['SqlJoinLab', 'JwtLab', 'IndexLab', 'OAuthLab', 'DockerLab', 'NginxLab'],
  },
  {
    id: 'ai', title: 'AI', en: 'ARTIFICIAL INTELLIGENCE', color: 'violet', sticker: 'violet', mapRequired: false,
    tagline: 'AI 協作的開發流程、呼叫模型、Agent 與 MCP 的授權與資安、RAG 與知識系統。',
    lede: '讓 AI 寫程式、呼叫模型、跑 agent 時，要先講清楚的規範、要量的指標、要守的邊界。',
    curriculum: 'docs/CURRICULUM.md',
    featuredLabs: ['HarnessLab', 'AgentLoopLab', 'DeviceCodeLab', 'ToolPoisoningLab', 'ChunkingLab', 'SemanticLayerLab'],
  },
]

export const findTrack = (id) => TRACKS.find((t) => t.id === id) || null

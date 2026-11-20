// 設計情境：報到看板的即時更新（輪詢、SSE、WebSocket 的前端成本）
export default {
  id: 'realtime-board',
  order: 38,
  group: 'state',
  title: '報到看板的即時更新',
  en: 'Live check-in board',
  level: 3,
  skills: ['realtime-frontend', 'composables', 'lifecycle', 'realtime-choice', 'http2-http3'],
  week: 11,
  lab: 'RealtimeBoardScenarioLab',
  related: ['notifications-fanout'],
  summary: '候診區的電視與 40 台櫃台電腦都開著叫號看板。輪詢、SSE 還是 WebSocket？斷線、後端重啟、分頁切到背景之後，各自要補多少程式？',
  situation: '內科候診區有 6 台電視全天開著叫號看板，畫面永遠在前景；40 台櫃台與護理站的電腦也開著同一頁，常切去掛號頁或其他分頁。看板顯示 4 個診間目前的號碼，每個診間 1 分鐘叫 1、2 號，看板只顯示、不送資料。院內 Wi-Fi 偶爾斷幾秒，後端每天中午部署一次，重啟期間回 502。後端團隊沒有維運過長連線。',
  constraints: [
    '叫號後 10 秒內要出現在看板上',
    '斷線、後端重啟之後要自己恢復，不能停在舊號碼，也不能讓人以為畫面是最新的',
    '櫃台電腦的看板在背景時，不要一直占著連線或打請求',
    '重連後漏掉的叫號要補回來；後端不保留事件歷史',
    '同一網域的 API 走 HTTP/1.1，櫃台電腦常開好幾個分頁',
  ],
  options: [
    {
      id: 'polling', name: '輪詢',
      summary: '每 N 秒 `GET /api/queue` 拿完整的號碼；用 `setTimeout` 在上一次回來之後才排下一次，分頁在背景時暫停。',
      pros: ['斷線、重啟後下一輪照常問，自己就恢復', '每次拿的都是完整快照，不會漏事件', '後端只是一般的 API，不用處理長連線'],
      cons: ['平均延遲是半個間隔，間隔越短請求越多', '用 `setInterval` 時請求會疊在一起，背景分頁也照打', '沒有變化也在問，每一輪都是一次完整的請求'],
    },
    {
      id: 'sse', name: 'SSE（EventSource）',
      summary: '`new EventSource(\'/api/queue/stream\')`，伺服器有叫號就推一則事件；網路斷了瀏覽器自己重連。',
      pros: ['叫號後秒級出現在畫面上', '網路中斷時瀏覽器自動重連，帶上 `Last-Event-ID`', '一般的 HTTP 回應，同網域 cookie 驗證照常運作'],
      cons: ['伺服器回 502、401 或錯的 `Content-Type` 時進入 CLOSED，不再重連，要自己處理', '後端不保留歷史時，斷線那幾秒的事件就漏了，要在每次連上時補一次快照', 'HTTP/1.1 下每個 SSE 一直占著同網域約 6 條連線之一'],
    },
    {
      id: 'websocket', name: 'WebSocket',
      summary: '`new WebSocket(\'wss://clinic.example/ws/queue\')`，雙向的長連線；重連、退避、心跳都自己寫。',
      pros: ['叫號後秒級出現在畫面上', '雙向：之後要做協作（拖拉排序、即時鎖定）不用換技術', '連上之後每則訊息只多幾個位元組的訊框，沒有 HTTP 標頭的開銷'],
      cons: ['斷線後不會重連；沒寫重連，看板就停在斷線那一刻', '要自己做心跳，才發現得了悄悄斷掉的連線', 'proxy、負載平衡要支援 Upgrade，驗證與重連後補快照也要自己設計'],
    },
  ],
  tradeoffs: {
    axes: ['叫號到畫面', '斷線與重啟', '背景分頁', '連線與請求', '要自己寫的'],
    rows: [
      { option: 'polling', cells: ['中：平均半個間隔', '好：下一輪照常問', '要自己暫停', '每台每 N 秒一個請求；沒有長連線', '少：`setTimeout` 串接、背景暫停'] },
      { option: 'sse', cells: ['好：秒級', '中：網路斷了會重連；502、401 就放棄', '要自己關', '每台一條長連線；HTTP/1.1 占同網域連線', '中：處理 CLOSED、重連後補快照'] },
      { option: 'websocket', cells: ['好：秒級', '差：不會重連', '要自己關', '每台一條長連線', '多：重連、退避、心跳、補快照、驗證'] },
    ],
  },
  decisions: [
    { id: 'tv-board', situation: '候診區的電視看板：叫號後 10 秒內出現就好；後端團隊沒調過 proxy 與負載平衡的長連線設定，也不想為看板多養一種連線。', options: ['polling', 'sse', 'websocket'], answer: 'polling',
      explain: '10 秒的容許度，5 秒一次的輪詢平均 2.5 秒就到，斷線與重啟後下一輪自己恢復，每次拿完整快照也不會漏號碼。6 台電視加上前景的櫃台電腦，每 5 秒各一個小請求，一般的 API 撐得住。SSE 與 WebSocket 要先處理 proxy 的緩衝與逾時、重連後補快照。' },
    { id: 'two-seconds', situation: '改成叫號後 2 秒內要出現；看板只收不送，前面的 nginx 已經開了 HTTP/2，驗證用同網域的 cookie。', options: ['polling', 'sse', 'websocket'], answer: 'sse',
      explain: '要 2 秒內，輪詢得 1 秒一次，幾十台電腦一直在問沒變化的資料。單向推送正是 SSE 的用途：瀏覽器處理網路中斷的重連，cookie 照常帶上；HTTP/2 下多個 SSE 共用一條連線，不受同網域 6 條的限制。要補的是 `error` 裡 `readyState` 為 CLOSED 時自己重建，以及每次 `open` 時抓一次快照。' },
    { id: 'bed-board', situation: '護理站的床位協作看板：好幾個人同時拖拉床位，要看到別人正在拖的那一格被鎖住，前端每秒會送好幾則訊息。', options: ['polling', 'sse', 'websocket'], answer: 'websocket',
      explain: '前端也要頻繁送資料、而且要在同一條連線上收到別人的鎖定，這是雙向的需求。SSE 只能伺服器往下推，送資料還要另開請求；輪詢的延遲與請求量都不合用。代價是重連、退避、心跳、重連後補快照都要自己寫。' },
    { id: 'tablet', situation: '醫師平板上的「我的下一號」：只看自己的診間，一天十幾次更新，平板要撐一整個門診時段的電量；後端已經有 SSE 端點。', options: ['polling', 'sse', 'websocket'], answer: 'sse',
      explain: '裝置每次收發都要喚醒網路。10 秒一次的輪詢每小時 360 次，幾乎都是「沒有變化」；SSE 只在叫號時收到資料，加上每 30 秒左右一則讓 proxy 不斷線的心跳。事件稀少時推送比輪詢省；事件很密（例如全院看板每秒好幾則）時，輪詢反而能把好幾則合成一次。' },
  ],
  switchIf: [
    { when: '叫號後 2 秒內要出現，nginx 已開 HTTP/2，看板只收不送', then: '改用 `sse`：一叫號伺服器就推；HTTP/2 下多個分頁共用一條連線。重連後要先補一次快照。' },
    { when: '好幾個人同時拖拉床位，要看到別人正在拖的格子被鎖住，前端每秒送好幾則訊息', then: '改用 `websocket`：雙向、低延遲；重連、退避、心跳都要自己寫。' },
  ],
  alternative: { option: 'sse', holdsWhen: 'proxy 與負載平衡器已經為長連線設好（關掉回應緩衝、拉長閒置逾時），同網域走 HTTP/2，而且重連後會先抓一次完整快照時。' },
  challenge: {
    task: '斷線重連之後，中間那幾秒叫的號去哪了？後端不保留事件歷史，重連只拿得到之後的事件。先在本頁模擬器選「SSE」，關掉「完整寫法（重連、補快照、背景暫停）」，打開「60 s 網路斷 8 秒」，按「▶ 播放這 5 分鐘」，記下「到最後都沒出現的叫號」與「號碼錯或停住」；再打開「完整寫法」重跑一次。然後寫出補齊的步驟：重連時抓哪個端點、快照怎麼和之後的事件合併、`seq` 比畫面上舊的事件怎麼處理。',
    deliver: '兩次播放的數字對照，以及一段重連後補齊的步驟（含快照與事件的合併規則）',
    check: [
      '寫出兩次播放的「號碼錯或停住」秒數，並用「時間點」滑桿指出號碼錯的那一段從哪裡開始、到哪個事件才更正',
      '步驟的順序是「重連成功 → 抓快照 → 只套用 `seq` 比快照新的事件」',
      '寫出斷線期間看板畫面要顯示什麼，才不會讓人以為號碼是最新的',
    ],
    twist: '改成輪詢、間隔 10 秒，同樣斷 8 秒。先預測「到最後都沒出現的叫號」是多少、輪詢為什麼不用另外補快照，再播放驗證。',
  },
  implementation: [
    { title: '輪詢：setTimeout 串接、背景暫停、回到前景立刻抓一次（composables/usePolling.js）', lang: 'js', code: `import { onMounted, onUnmounted } from 'vue'

export function usePolling(fn, ms) {
  let timer = null, running = false, stopped = false
  async function tick() {
    if (stopped || running) return                 // 同一時間只跑一個請求
    running = true
    try { await fn() } catch { /* 錯誤由 fn 自己設定畫面狀態 */ } finally { running = false }
    if (!stopped && document.visibilityState === 'visible') timer = setTimeout(tick, ms)
  }
  function onVisibility() {
    clearTimeout(timer)
    if (document.visibilityState === 'visible') tick()
  }
  onMounted(() => { tick(); document.addEventListener('visibilitychange', onVisibility) })
  onUnmounted(() => {
    stopped = true
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisibility)
  })
}` },
    { title: 'SSE：CLOSED 時自己重建、每次連上補快照、seq 比舊就丟（composables/useQueueStream.js 節錄）', lang: 'js', code: `function connect() {
  es = new EventSource('/api/queue/stream')
  es.addEventListener('open', () => {
    attempt = 0
    connection.value = 'live'
    loadSnapshot().catch(() => {})          // 斷線期間漏掉的叫號，用快照補回來
  })
  es.addEventListener('queue', (e) => apply(JSON.parse(e.data)))   // apply：seq 比手上的舊就丟掉
  es.addEventListener('error', () => {
    connection.value = 'reconnecting'       // 畫面顯示「重新連線中」，不讓人以為是最新的
    if (es.readyState === EventSource.CLOSED) {   // 伺服器回了 502、401：瀏覽器放棄，自己排重連
      es = null
      const wait = Math.min(30_000, 1000 * 2 ** attempt++) * (0.5 + Math.random() / 2)
      retryTimer = setTimeout(connect, wait)
    }
  })
}` },
    { title: '看板上的連線狀態：斷線時要說出來', lang: 'vue', code: `<script setup>
import { useQueueStream } from '@/composables/useQueueStream'
const { rooms, connection } = useQueueStream()
</script>

<template>
  <p v-if="connection === 'reconnecting'" role="status" class="board-stale">重新連線中，號碼可能不是最新的</p>
  <ul class="board" :class="{ stale: connection !== 'live' }">
    <li v-for="(r, room) in rooms" :key="room">{{ room }} 診間：<b>{{ r.currentNo }}</b> 號</li>
  </ul>
</template>` },
  ],
  exercise: 'realtime-frontend-1',
  refs: [],
}

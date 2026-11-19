## 從一個具體問題開始：看板停在 10 點 15 分

候診區的電視掛著門診看板，用 WebSocket 接各診間的叫號。10 點 15 分院內 Wi-Fi 斷了幾秒，看板之後再也沒有更新，畫面也沒有任何提示。病患看著停住的號碼，護理師一個一個叫，叫到的人都說「看板還沒跳到我」。

前一版用輪詢，每 5 秒 `setInterval` 打一次 API，也有自己的問題：櫃台的電腦在看板頁與掛號頁之間切換，切幾次就多幾個 interval，Network 分頁每 5 秒出現好幾筆一樣的請求；網路慢的時候，上一個請求還沒回來，下一個已經送出，舊的回應偶爾晚到、把號碼改回較小的數字。

即時更新在瀏覽器裡寫起來只有幾行，麻煩在連線之外的事：斷線、重連、漏掉的更新、背景分頁、離開頁面。

## 運作原理

### 三種做法，從前端看

| | 輪詢 | SSE（`EventSource`） | WebSocket |
|---|---|---|---|
| 方向 | 前端問、伺服器答 | 伺服器 → 前端 | 雙向 |
| 斷線後 | 下一輪照常問 | 瀏覽器自己重連，帶 `Last-Event-ID` | 不會重連，要自己寫 |
| 驗證 | 一般的 `Authorization` 或 cookie | 不能自訂標頭，靠 cookie（跨網域加 `withCredentials: true`） | 握手時帶 cookie，或連上後送第一則訊息驗證 |
| DevTools | Network 分頁的 `Fetch/XHR` | `Fetch/XHR`，點開有 `EventStream` 分頁 | `Socket`，點開有 `Messages` 分頁 |
| 關閉 | `clearTimeout` | `es.close()` | `ws.close()` |
| 適合 | 10 秒內看到就夠：看板、報表進度 | 秒級的單向通知：叫號、匯出完成 | 前端也頻繁送資料：聊天、協作編輯 |

先問「多快要看到」與「誰要送資料」。叫號看板是單向、幾秒內看到就好，輪詢或 SSE 都夠；選 WebSocket 會多出重連、心跳、驗證要自己寫。伺服器那一側的成本、proxy 的逾時與多台伺服器的廣播，見 [即時通訊怎麼選](#/skill/realtime-choice)。

### 輪詢：上一次回來才排下一次

```
setInterval(load, 5000)，某一次回應花了 7 秒：
  0s   送出 #1
  5s   送出 #2          ← #1 還沒回來
  7s   #1 回來
  9s   #2 回來
  10s  送出 #3 …        ← 慢的時候請求疊在一起，晚到的舊回應可能蓋掉新的

setTimeout 串起來：
  0s   送出 #1
  7s   #1 回來 → 排 5 秒後
  12s  送出 #2          ← 同一時間只有一個請求在路上
```

用 `setTimeout` 在每次回來之後排下一次，請求永遠不會重疊，間隔是「回來之後再等 5 秒」。

### EventSource 的生命週期

`new EventSource(url)` 送出一個 `GET`，`Accept: text/event-stream`，伺服器不結束回應、有事件就往裡寫。`readyState` 有三個值：`0`（CONNECTING）、`1`（OPEN）、`2`（CLOSED）。

| 情況 | 事件 | `readyState` | 之後 |
|---|---|---|---|
| 連上 | `open` | 1 | 開始收事件 |
| 伺服器送 `event: queue` | `queue`（用 `addEventListener('queue', …)` 接） | 1 | 沒有 `event:` 欄位的事件才會進 `onmessage` |
| 連線中斷 | `error` | 0 | 瀏覽器等一下自動重連，請求帶上最後收到的 `id`，標頭是 `Last-Event-ID` |
| 伺服器回非 200，或 `Content-Type` 不是 `text/event-stream` | `error` | 2 | 放棄，不再重連 |
| 程式呼叫 `es.close()` | 無 | 2 | 結束 |

重連的等待時間由伺服器的 `retry:` 欄位決定，沒給時由瀏覽器決定。第四列是常見的陷阱：後端部署時回了一次 502，或登入過期回 401，EventSource 就永遠停了，畫面上沒有任何錯誤。Chrome 遇到錯的 `Content-Type` 時會在 Console 印出 `EventSource's response has a MIME type ("application/json") that is not "text/event-stream". Aborting the connection.`。所以 `error` 事件裡要看 `readyState`：0 代表瀏覽器正在重連，2 代表要自己重建。

在 HTTP/1.1 下，瀏覽器對同一個網域同時只開約 6 條連線，每個 SSE 會一直占著一條；同一個網站開了 6 個分頁，第 7 個分頁的請求會排隊卡住。HTTP/2 下沒有這個問題。

### WebSocket 的生命週期

`readyState` 有四個值：`0`（CONNECTING）、`1`（OPEN）、`2`（CLOSING）、`3`（CLOSED）。斷線時先觸發 `error`（不一定有），接著一定觸發 `close`，`close` 事件的 `code` 說明原因：

| `code` | 意思 | 要不要重連 |
|---|---|---|
| `1000` | 正常關閉 | 看是誰關的；自己關的不用 |
| `1001` | 對方離開（例如伺服器重啟、頁面離開） | 要 |
| `1006` | 連線異常中斷，沒有收到關閉訊框（網路斷、連不上、握手失敗） | 要，加退避 |
| `1008`、`1011` | 違反政策、伺服器內部錯誤 | 看情況 |
| `4000`–`4999` | 應用程式自訂，例如 `4401` 表示憑證失效 | 依自己的約定；憑證失效時重連也沒用 |

連不上時 Chrome 的 Console 會出現 `WebSocket connection to 'wss://clinic.example/ws/queue' failed`，後面接原因，例如 `Error in connection establishment: net::ERR_CONNECTION_REFUSED`，或伺服器沒有升級協定時的 `Error during WebSocket handshake: Unexpected response code: 200`。這兩種的 `close` 事件都是 `code: 1006`、`wasClean: false`。

瀏覽器端的 `ws.close(code)` 只接受 `1000` 或 `3000`–`4999`，傳 `1006` 這類保留值會丟出 `InvalidAccessError: Failed to execute 'close' on 'WebSocket': The close code must be either 1000, or between 3000 and 4999. 1006 is neither.`。

WebSocket 協定有 ping／pong，但瀏覽器的 JavaScript 碰不到它們。連線「看起來還開著、實際上已經斷了」（例如 NAT 或 proxy 悄悄丟掉閒置的連線）時，前端要靠應用層的心跳：每 30 秒送一則 `{ type: 'ping' }`，一段時間沒收到回應就主動關掉重連。

### 重連後補資料

斷線的那幾秒，伺服器送出的事件不會到前端。EventSource 的 `Last-Event-ID` 讓伺服器有機會補送，但要伺服器有保留歷史；WebSocket 沒有這個機制。可靠的做法是每次連上（包含重連）都重抓一次完整的快照，再接著套用新事件。

快照與事件可能交錯：事件 #42 先到，稍早發出的快照（內容是 #41 的狀態）晚到。每筆資料帶遞增的 `seq`，套用時比手上的舊就丟掉。

### 背景分頁

使用者切到別的分頁，看板在背景照樣輪詢或保持連線，沒人看也在耗伺服器資源。瀏覽器也會節流背景分頁的計時器：Chrome 對隱藏的分頁，計時器最多每秒執行一次；隱藏一段時間、計時器又是一個接一個串起來的，可能被限制成每分鐘一次（Chrome 88 起的強化節流，觸發條件之後的版本有調整）。輪詢在背景本來就不準。

Page Visibility API 提供 `document.visibilityState`（`visible`、`hidden`）與 `visibilitychange` 事件：

- 輪詢：隱藏時停，回到前景時立刻抓一次再恢復。
- SSE、WebSocket：隱藏超過一段時間（例如 60 秒）就關掉，回到前景時重連並補快照。只切出去幾秒就關掉，來回切換時會一直重連。
- 掛在牆上、永遠在前景的看板不受影響，照常更新。

## 實際程式

### 重連的時間表與資料合併

下面三段可以直接執行：重連等待時間怎麼長大、抖動怎麼讓 100 個分頁錯開、快照與事件怎麼用 `seq` 合併：

```js run
// 1) WebSocket 重連前的等待：指數成長、上限 30 秒、乘上 0.5–1 的抖動
const delay = (attempt) => Math.min(30_000, 1000 * 2 ** attempt) * (0.5 + Math.random() / 2)
for (let a = 0; a < 8; a++) console.log(`第 ${a + 1} 次重連前等 ${(delay(a) / 1000).toFixed(1)} 秒`)

// 2) 伺服器重啟，100 個分頁同時斷線：第一次重連落在 0–1 秒的哪個 100 ms 區間
function spread(jitter) {
  const buckets = new Array(10).fill(0)
  for (let i = 0; i < 100; i++) {
    const ms = 1000 * (jitter ? 0.5 + Math.random() / 2 : 1)
    buckets[Math.min(9, Math.floor(ms / 100))]++
  }
  return buckets.map((n) => String(n).padStart(3)).join(' ')
}
console.log('\n每 100 ms 的重連數（0–1 秒）')
console.log('不抖動：', spread(false))
console.log('加抖動：', spread(true))

// 3) 重連後的快照與新事件交錯：seq 比手上的舊就丟掉
const rooms = {}
function apply({ room, currentNo, seq }) {
  if (rooms[room] && rooms[room].seq >= seq) return `丟掉 ${room} 的 #${seq}（手上是 #${rooms[room].seq}）`
  rooms[room] = { currentNo, seq }
  return `${room} 診間 → ${currentNo} 號（#${seq}）`
}
console.log('')
console.log(apply({ room: '101', currentNo: 17, seq: 42 }))   // 新事件先到
console.log(apply({ room: '101', currentNo: 16, seq: 41 }))   // 快照裡的舊值晚到
console.log(apply({ room: '102', currentNo: 8, seq: 40 }))    // 快照裡其他診間
console.log(JSON.stringify(rooms))
```

不抖動時 100 個重連全擠在最後一個區間（同一刻），加了抖動之後散在 0.5 到 1 秒之間。

### SSE 版的看板

```js
// composables/useQueueStream.js：在 <script setup> 裡呼叫，連線跟著元件的生命週期
import { ref, onMounted, onUnmounted } from 'vue'

export function useQueueStream() {
  const rooms = ref({})                      // { [room]: { currentNo, seq } }
  const connection = ref('connecting')       // connecting | live | reconnecting | paused
  let es = null, retryTimer = null, hiddenTimer = null, attempt = 0

  function apply({ room, currentNo, seq }) {
    const old = rooms.value[room]
    if (old && old.seq >= seq) return        // 比手上的舊：丟掉
    rooms.value[room] = { currentNo, seq }
  }
  async function loadSnapshot() {
    const res = await fetch('/api/queue')
    if (res.ok) for (const r of await res.json()) apply(r)
  }
  function connect() {
    es = new EventSource('/api/queue/stream')
    es.addEventListener('open', () => {
      attempt = 0
      connection.value = 'live'
      loadSnapshot().catch(() => {})         // 每次連上（包含自動重連）都補一次快照
    })
    es.addEventListener('queue', (e) => apply(JSON.parse(e.data)))
    es.addEventListener('error', () => {
      connection.value = 'reconnecting'
      if (es.readyState === EventSource.CLOSED) {   // 伺服器回了錯誤，瀏覽器不會再重連：自己排
        es = null
        retryTimer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt++) * (0.5 + Math.random() / 2))
      }                                       // CONNECTING：瀏覽器正在自動重連，等它
    })
  }
  function disconnect() {
    clearTimeout(retryTimer)
    es?.close()
    es = null
  }
  function onVisibility() {
    if (document.visibilityState === 'hidden') {
      hiddenTimer = setTimeout(() => { disconnect(); connection.value = 'paused' }, 60_000)
    } else {
      clearTimeout(hiddenTimer)
      if (!es) connect()                      // 回到前景：重連，open 時補快照
    }
  }

  onMounted(() => {
    connect()
    document.addEventListener('visibilitychange', onVisibility)
  })
  onUnmounted(() => {
    disconnect()
    clearTimeout(hiddenTimer)
    document.removeEventListener('visibilitychange', onVisibility)
  })
  return { rooms, connection }
}
```

```vue
<script setup>
import { useQueueStream } from '@/composables/useQueueStream'
const { rooms, connection } = useQueueStream()
</script>

<template>
  <p v-if="connection === 'reconnecting'" role="status">重新連線中，號碼可能不是最新的</p>
  <ul>
    <li v-for="(r, room) in rooms" :key="room">{{ room }} 診間：{{ r.currentNo }} 號</li>
  </ul>
</template>
```

### WebSocket：自己寫重連

```js
// composables/useReconnectingSocket.js
import { ref, onUnmounted } from 'vue'

export function useReconnectingSocket(url, onMessage) {
  const state = ref('connecting')             // connecting | live | reconnecting | unauthorized
  let ws = null, attempt = 0, retryTimer = null, stopped = false

  function connect() {
    ws = new WebSocket(url)
    ws.addEventListener('open', () => { attempt = 0; state.value = 'live' })
    ws.addEventListener('message', (e) => onMessage(JSON.parse(e.data)))
    ws.addEventListener('close', (e) => {     // error 之後一定會有 close，重連只寫在這裡
      ws = null
      if (stopped) return                     // 自己關的
      if (e.code === 4401) { state.value = 'unauthorized'; return }   // 自訂代碼：憑證失效，重連也沒用
      state.value = 'reconnecting'
      const wait = Math.min(30_000, 1000 * 2 ** attempt) * (0.5 + Math.random() / 2)
      attempt++
      retryTimer = setTimeout(connect, wait)
    })
  }
  function close() {
    stopped = true
    clearTimeout(retryTimer)
    ws?.close(1000)
  }
  function send(data) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data))
  }

  connect()
  onUnmounted(close)                          // 在 setup 裡呼叫，元件卸載時關掉
  return { state, send, close }
}
```

`open` 之後同樣要補快照，做法和 SSE 版相同；需要心跳時，在 `open` 裡開一個 `setInterval` 送 ping，在 `close` 裡清掉。

### 輪詢：setTimeout 加上背景暫停

```js
// composables/usePolling.js
import { onMounted, onUnmounted } from 'vue'

export function usePolling(fn, ms) {
  let timer = null, running = false, stopped = false
  async function tick() {
    if (stopped || running) return            // 同一時間只跑一個
    running = true
    try { await fn() } catch { /* 錯誤由 fn 自己設定畫面狀態 */ } finally { running = false }
    if (!stopped && document.visibilityState === 'visible') timer = setTimeout(tick, ms)
  }
  function onVisibility() {
    clearTimeout(timer)
    if (document.visibilityState === 'visible') tick()   // 回到前景：馬上抓一次
  }
  onMounted(() => { tick(); document.addEventListener('visibilitychange', onVisibility) })
  onUnmounted(() => {
    stopped = true
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisibility)
  })
}
```

`fn` 裡的請求最好也接上 `AbortController`，卸載時取消還在路上的那一次，寫法見 [取消請求與競態](#/skill/cancel-race)。VueUse 的 `useEventSource`、`useWebSocket` 包好了一部分（`useWebSocket` 有 `autoReconnect` 選項）；用了它們，補快照、`seq` 合併與背景暫停仍然要自己決定。

## 常見錯誤與錯誤訊息

| 現象或訊息 | 原因 | 修法 |
|---|---|---|
| 斷線後畫面停住，沒有任何提示 | WebSocket 不會自己重連 | `close` 事件裡排重連，畫面顯示連線狀態 |
| 後端部署後 SSE 再也沒有更新 | 重連時伺服器回了 502 或 401，EventSource 進入 CLOSED、放棄重連 | `error` 裡看 `readyState`，CLOSED 時自己排重連 |
| `EventSource's response has a MIME type ("application/json") that is not "text/event-stream". Aborting the connection.` | 網址打錯打到一般 API，或 proxy 回了錯誤頁 | 確認路徑與伺服器的 `Content-Type` |
| `WebSocket connection to 'wss://…' failed: Error during WebSocket handshake: Unexpected response code: 200` | 請求沒有被升級：proxy 沒轉 `Upgrade` 標頭，或 SPA fallback 回了 `index.html` | 檢查 proxy 設定，見 [即時通訊怎麼選](#/skill/realtime-choice) |
| 每秒重連好幾次，伺服器被打掛 | 重連沒有退避與抖動 | 指數退避、上限、抖動 |
| 切換頁面幾次後，同一個請求每 5 秒出現好幾筆 | `setInterval` 沒在卸載時清掉 | composable 裡 `onUnmounted` 清理 |
| 號碼偶爾跳回較小的數字 | 輪詢的請求重疊，舊回應晚到；或快照蓋掉了較新的事件 | `setTimeout` 串接；資料帶 `seq` 比較 |
| 開到第 7 個分頁時資料載入卡住 | HTTP/1.1 下每個 SSE 占用一條連線，同網域的連線數用完 | 伺服器改用 HTTP/2，或同一個瀏覽器只開一條（例如透過 `BroadcastChannel` 分享） |
| `InvalidAccessError: Failed to execute 'close' on 'WebSocket': The close code must be either 1000, or between 3000 and 4999.` | 前端用保留的代碼關閉 | 用 `1000` 或 `4000`–`4999` 的自訂代碼 |

## 動手

1. 按上面程式的「在 Playground 開啟」，把重連上限從 30 秒改成 5 秒，看第 4 次之後的等待時間；再把 `apply` 的 `>=` 改成 `>`，想想同一個 `seq` 重複送兩次時會發生什麼。
2. 在自己的專案找一個輪詢，打開 Network 分頁，切換路由來回五次，確認同一個請求的間隔沒有變密；切到別的分頁 2 分鐘再回來，背景期間不應該有請求。
3. 用 Chrome 開一個 SSE 頁面，點開請求的 `EventStream` 分頁看每個事件的 `id`、類型與資料；重啟後端，在 Network 分頁看重連的請求，Request Headers 裡要有 `Last-Event-ID`。
4. 登出時要關掉的連線，見 [登入狀態與 401](#/skill/auth-frontend)。

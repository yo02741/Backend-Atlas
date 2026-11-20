## 這階段要做出什麼

候診區的電視掛著報到看板 `/board`：每個診間一列，顯示醫師、目前叫到幾號、還有幾人候診。資料來自 `GET /api/board`（後端要另外提供；沙箱裡由題目用 `api.get('/api/board', …)` 加上），回傳 `[{ room, doctor, current_no, waiting }]`。

做法選輪詢，每 10 秒抓一次。這一階段要讓它長時間開著也不出事：

1. 每次回應回來之後才排下一次，同一時間只有一個請求在路上。
2. 離開看板頁（元件卸載）時停止，還在路上的請求取消。
3. 分頁切到背景時停止，回到前景時立刻抓一次再恢復。
4. 失敗時保留舊資料並標出「更新失敗，顯示的是 10:15:30 的資料」；連續失敗時拉長間隔（指數退避加抖動）；成功一次就回到 10 秒。
5. 4xx（401、403）重送結果一樣，停止輪詢並顯示原因。

輪詢、SSE、WebSocket 從前端看的差別與斷線重連在 [即時更新：輪詢、SSE、WebSocket](#/skill/realtime-frontend)；`onMounted` 與 `onUnmounted` 成對清理在 [Vue 的生命週期](#/skill/lifecycle)；哪些錯誤能重試、退避與抖動在 [錯誤分類與重試](#/skill/api-errors-retry)。

## 設計決策與取捨

### 輪詢就夠

叫號看板是單向的，幾秒內看到就好，前端不用送資料給伺服器。輪詢的優點是什麼都不用多做：一般的 `GET`、一般的 `Authorization`、proxy 不用另外設定，斷線後下一輪照常問。SSE（`EventSource`）可以做到秒級更新、瀏覽器會自動重連，但要伺服器保持連線，伺服器回錯誤的狀態碼時 `EventSource` 會停止重連；WebSocket 的重連、心跳、驗證都要自己寫。要更即時時再換，伺服器那一側的成本見 [即時通訊怎麼選：輪詢、SSE、WebSocket](#/skill/realtime-choice)。

### setTimeout 串起來

`setInterval(load, 10_000)` 不管上一次回來沒有：某一次花了 12 秒，第二個請求已經送出，兩個疊在一起，晚到的舊回應可能把號碼改回較小的數字。改成每次回來之後 `setTimeout(tick, wait)`，請求永遠不會重疊，間隔是「回來之後再等 10 秒」。

### 背景時暫停

Page Visibility API 的 `document.visibilityState` 是 `visible` 或 `hidden`，切換時觸發 `visibilitychange`。`hidden` 時清掉計時器並取消請求；`visible` 時立刻抓一次，接著恢復。瀏覽器本來就會節流背景分頁的計時器（Chrome 對隱藏分頁的計時器最多每秒執行一次，隱藏久了限制更嚴），背景裡的輪詢既不準又沒有人看。掛在牆上、永遠在前景的看板不受影響。

只在看板捲到畫面外時暫停（同一頁的一小塊）是另一回事：那要用 `IntersectionObserver`，或 `content-visibility: auto` 配上 `contentvisibilityautostatechange` 事件（`content-visibility` 是 Baseline 2025）。這一階段的看板占滿整頁，看分頁的可見度就夠。

### 失敗時保留舊資料

清單清空會讓候診的人以為系統壞了；舊號碼留著、旁邊寫「更新失敗，顯示的是 10:15:30 的資料」比較誠實。提示放在一直存在的 `role="status"` 元素裡，只改文字。

### 退避加抖動，4xx 不重試

後端重啟的那一分鐘，每台看板都每 10 秒打一次，恢復的那一刻同時湧進來。連續失敗時把等待拉長：第 n 次連續失敗後等 `10 秒 × 2^n`，上限 2 分鐘，再乘上 0.5 到 1 的隨機數（抖動），院內幾十台看板不會在同一刻重試。成功一次就歸零。401、403 這類 4xx 重送結果一樣，停止輪詢、顯示「看板沒有權限或設定有誤」，等人處理。

### 抽成 composable

「開始、排下一次、背景暫停、卸載清理」寫成 `usePolling(fetcher, { interval, maxInterval })`，在 `<script setup>` 的頂層呼叫，裡面的 `onMounted`、`onUnmounted` 跟著呼叫它的元件。`fetcher` 收到一個 `signal`，傳給 `apiFetch`，卸載或切到背景時取消的是那一次請求。

## 關鍵程式

```js
// src/composables/usePolling.js：在 setup 裡呼叫，輪詢跟著元件的生命週期
// fetcher(signal) 成功就 resolve；失敗時丟出帶 status 的錯誤（例如 ApiError）或網路錯誤
import { ref, onMounted, onUnmounted } from 'vue'

export function usePolling(fetcher, { interval = 10_000, maxInterval = 120_000 } = {}) {
  const failures = ref(0)            // 連續失敗次數
  const stopped = ref(false)         // 4xx：不再重試
  let timer = null
  let controller = null
  let alive = true

  const backoff = (n) => Math.min(maxInterval, interval * 2 ** n) * (0.5 + Math.random() / 2)

  async function tick() {
    clearTimeout(timer)
    controller?.abort()                       // 回到前景立刻抓時，上一次可能還在路上
    const c = (controller = new AbortController())
    let wait = interval
    try {
      await fetcher(c.signal)
      failures.value = 0
    } catch (err) {
      if (c.signal.aborted) return            // 卸載、背景、被新的一輪取代：不排下一次
      if (err.status >= 400 && err.status < 500) { stopped.value = true; return }   // 重送結果一樣
      failures.value++
      wait = backoff(failures.value)
    }
    if (alive && !stopped.value && document.visibilityState === 'visible') timer = setTimeout(tick, wait)
  }

  function onVisibility() {
    if (document.visibilityState === 'hidden') {
      clearTimeout(timer)
      controller?.abort()
    } else if (!stopped.value) {
      tick()                                  // 回到前景：馬上更新一次
    }
  }

  onMounted(() => {
    tick()
    document.addEventListener('visibilitychange', onVisibility)
  })
  onUnmounted(() => {
    alive = false
    clearTimeout(timer)
    controller?.abort()
    document.removeEventListener('visibilitychange', onVisibility)
  })
  return { failures, stopped, refresh: tick }
}
```

```vue
<script setup>
import { ref, computed } from 'vue'
import { apiFetch } from '@/api/client'
import { usePolling } from '@/composables/usePolling'

const rooms = ref([])
const updatedAt = ref(null)

const { failures, stopped } = usePolling(async (signal) => {
  rooms.value = await apiFetch('/board', { signal })   // [{ room, doctor, current_no, waiting }]
  updatedAt.value = new Date()
}, { interval: 10_000, maxInterval: 120_000 })

const time = (d) => d.toLocaleTimeString('zh-TW', { hour12: false })
const staleText = computed(() => {
  if (!failures.value) return ''
  return updatedAt.value ? `更新失敗，顯示的是 ${time(updatedAt.value)} 的資料` : '更新失敗，稍後自動重試'
})
</script>

<template>
  <main class="board">
    <h1>報到看板</h1>
    <p v-if="stopped" role="alert">看板沒有權限或設定有誤，請聯絡資訊室</p>
    <p role="status" class="stale">{{ staleText }}</p>
    <ul>
      <li v-for="r in rooms" :key="r.room">
        <span class="room">{{ r.room }} 診</span>
        <span>{{ r.doctor }}</span>
        <strong>目前 {{ r.current_no }} 號</strong>
        <span>候診 {{ r.waiting }} 人</span>
      </li>
    </ul>
  </main>
</template>
```

`usePolling` 在 Chromium 裡用 100 ms 的間隔實測過：腳本是「成功、失敗、失敗、失敗、成功…」時，請求之間的間隔依序是 100、163、333、695、100 ms（失敗後的三次含抖動，每次約為前一次的兩倍）；切到背景的 0.5 秒內沒有送出請求，回到前景後立刻送出一次；卸載後沒有再送出請求。

## 常見錯誤

**`setInterval` 沒在卸載時清掉。** 看板頁與掛號頁來回切換幾次，Network 分頁每 10 秒出現好幾筆同樣的請求。`onUnmounted` 裡 `clearTimeout`，請求一起 abort。

**請求疊在一起。** `setInterval` 不等上一次回來。用 `setTimeout` 串接。

**卸載後回應才回來，還在改狀態。** 沒有 abort，或被取消的那一次又排了下一輪。`catch` 裡看到 `signal.aborted` 就 return，不排下一次。

**背景分頁照樣輪詢。** 沒有人看也在打伺服器。監聽 `visibilitychange`。

**失敗時清空清單。** 看板一片空白。只改提示，資料留著。

**固定間隔重試。** 伺服器恢復的那一刻所有看板同時打過來。退避加抖動。

**403 也一直重試。** 每 10 秒一次 403，日誌裡全是它。4xx 停止。

**`onMounted` 寫在 callback 裡。** composable 要在 setup 期間同步呼叫，寫在 `await` 之後或事件處理函式裡，Vue 警告 `onMounted is called when there is no active component instance`，鉤子不會被登記。

## 驗收題在測什麼

**輪詢不重疊、背景暫停、卸載停止**：`POLL_MS` 題目設 200 ms。0.7 秒內至少三個請求；回應要 450 ms 時，1.4 秒內同時在路上的請求最多一個；用 `Object.defineProperty` 把 `document.visibilityState` 改成 `hidden` 並觸發 `visibilitychange` 後，0.6 秒內沒有新請求，改回 `visible` 後 150 ms 內送出一個、之後恢復輪詢；卸載後沒有新請求，還在路上的那一個被標成已取消。

**失敗時的處理**：`POLL_MS` 題目設 100 ms、`MAX_MS` 1600 ms，假 API 依序回「成功、503、503、503、成功、成功」。503 時清單留著、`role="status"` 出現「更新失敗」；第 3 次連續失敗後的等待至少 350 ms，而且至少是第 1 次失敗後的兩倍（抖動乘上 0.5 到 1 時這個比例仍然成立）；成功後的下一次間隔小於 250 ms、提示清空；403 時出現 `role="alert"`，之後不再送出請求。

下一階段回頭整理前面的畫面：鍵盤操作、焦點、螢幕閱讀器，以及手機與桌機的版面。

## 串接驗收

後端參考專案沒有 `/api/board`，這一段在 Playground 的 Vue 模式做：貼上 `usePolling`（拿掉 `export`），寫一個最小的看板，`interval: 1000, maxInterval: 8000`，fetcher 用 `fetch('/api/board')`，非 2xx 時丟出帶 `status` 的錯誤。在 `createApp` 之前加：

```js
api.get('/api/board', [
  { body: [{ room: '101', doctor: '林醫師', current_no: 3, waiting: 5 }] },
  { network: true }, { network: true }, { network: true },
  { body: [{ room: '101', doctor: '林醫師', current_no: 7, waiting: 2 }] },
])
```

**1. 斷線時保留舊資料。** 先預測：斷線的那三次畫面顯示幾號、恢復後顯示幾號、中間會不會出現 4、5、6 號。預期：斷線時一直是 3 號，並標出「更新失敗，顯示的是 … 的資料」；恢復後直接是 7 號，4 到 6 號不會出現。

**2. 恢復要等多久。** 用 `backoff` 的公式算出第 3 次失敗之後最多要等幾毫秒，再在 fetcher 裡 `console.log(Date.now())` 對照實際的間隔。預期：第 n 次失敗後等 `min(maxInterval, interval × 2^n)` 的 0.5 到 1 倍，第 3 次是 4000 到 8000 ms。換成正式的設定（10 秒、上限 120 秒），連續失敗 3 次之後最久 80 秒才再試；候診區等不了這麼久的話，調低上限，或在 `online` 事件時呼叫 `refresh()`。

**3. 什麼時候才要補號。** 這個看板每次拿到的是完整快照，漏掉的中間狀態不用補。寫下看板加上「最近叫過的 5 個號碼」時快照要多帶什麼，以及改用 SSE 時斷線重連怎麼補。預期：快照多帶 `recent: [3, 4, 5, 6, 7]` 就不用補；SSE 要靠事件 id 與重連時送出的 `Last-Event-ID`，由伺服器重送漏掉的事件（[報到看板的即時更新](#/scenario/realtime-board)）。下一階段用鍵盤與螢幕閱讀器重走前面五個畫面。

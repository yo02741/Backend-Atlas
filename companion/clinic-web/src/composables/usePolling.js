// src/composables/usePolling.js：在 setup 裡呼叫，輪詢跟著元件的生命週期（第 5 階段）
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

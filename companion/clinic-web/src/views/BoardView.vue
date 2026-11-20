<script setup>
// 報到看板（第 5 階段）。輪詢間隔從 config 讀（正式是 10 秒，接線測試調短）
import { ref, computed } from 'vue'
import { apiFetch } from '@/api/client'
import { usePolling } from '@/composables/usePolling'
import { config } from '@/config'

const rooms = ref([])
const updatedAt = ref(null)

const { failures, stopped } = usePolling(async (signal) => {
  rooms.value = await apiFetch('/board', { signal })   // [{ room, doctor, current_no, waiting }]
  updatedAt.value = new Date()
}, { interval: config.boardIntervalMs, maxInterval: config.boardIntervalMs * 12 })

const time = (d) => d.toLocaleTimeString('zh-TW', { hour12: false })
const staleText = computed(() => {
  if (!failures.value) return ''
  return updatedAt.value ? `更新失敗，顯示的是 ${time(updatedAt.value)} 的資料` : '更新失敗，稍後自動重試'
})
</script>

<template>
  <main class="board">
    <h1 tabindex="-1">報到看板</h1>
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
    <p v-if="updatedAt && !rooms.length">目前這個時段沒有門診</p>
  </main>
</template>

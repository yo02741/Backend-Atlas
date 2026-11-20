<script setup>
// 診次清單（第 2 階段）。和說明裡的程式只差一處：卡片上多了醫師名字（不帶 doctor_id 時會列出兩位醫師的診次）
import { ref, computed, watch, onWatcherCleanup } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiFetch } from '@/api/client'
import { DOCTORS, parseQuery, toQuery } from '@/lib/sessionQuery'

const PERIODS = { morning: '上午', afternoon: '下午', evening: '夜間' }
const DOCTOR_NAME = Object.fromEntries(DOCTORS.map((d) => [d.id, d.name]))
const route = useRoute()
const router = useRouter()
const filters = computed(() => parseQuery(route.query))   // 網址是唯一的來源

const status = ref('loading')        // loading | success | empty | error
const sessions = ref([])
const error = ref(null)              // { text, retryable }
const refreshing = ref(false)
const refreshFailed = ref(false)

function describe(err) {
  if (err.status === 403) return { text: '沒有權限查看診次', retryable: false }
  if (err.status >= 400 && err.status < 500) return { text: err.problem?.detail ?? '查詢條件有誤', retryable: false }
  if (err.status >= 500) return { text: '系統暫時無法處理', retryable: true }
  return { text: '無法連線，請檢查網路', retryable: true }              // 網路錯誤（TypeError）
}

function fetchSessions(signal) {
  const params = new URLSearchParams({ date: filters.value.date })
  if (filters.value.doctorId) params.set('doctor_id', filters.value.doctorId)
  return apiFetch(`/sessions?${params}`, { signal })
}

async function load(signal) {
  status.value = 'loading'
  try {
    sessions.value = await fetchSessions(signal)
    status.value = sessions.value.length ? 'success' : 'empty'
  } catch (err) {
    if (signal?.aborted || err.status === 401) return   // 換了條件，或 apiFetch 已經換到登入頁
    error.value = describe(err)
    status.value = 'error'
  }
}

async function refresh() {
  if (status.value !== 'success') return load()
  if (refreshing.value) return
  refreshing.value = true
  refreshFailed.value = false
  try {
    const data = await fetchSessions()
    sessions.value = data
    status.value = data.length ? 'success' : 'empty'
  } catch {
    refreshFailed.value = true                          // 舊清單留著
  } finally {
    refreshing.value = false
  }
}

// 只在這個路由時才看條件；條件換了就取消上一輪
watch(() => (route.name === 'sessions' ? JSON.stringify(filters.value) : null), (key) => {
  if (key === null) return
  const controller = new AbortController()
  onWatcherCleanup(() => controller.abort())
  load(controller.signal)
}, { immediate: true })

// 輸入框只改網址：換條件用 push（上一頁回得去），不合法的網址用 replace 修正
function setFilter(patch) {
  const next = { ...filters.value, ...patch }
  router.push({ query: toQuery(parseQuery({ date: next.date, doctor_id: next.doctorId })) })
}
watch(() => route.query, (q) => {
  if (route.name !== 'sessions') return
  const normalized = toQuery(parseQuery(q))
  if (JSON.stringify(normalized) !== JSON.stringify(q)) router.replace({ query: normalized })
}, { immediate: true })
</script>

<template>
  <main>
    <h1 tabindex="-1">診次清單</h1>
    <div class="filters">
      <label for="date">日期</label>
      <input id="date" type="date" :value="filters.date" @change="setFilter({ date: $event.target.value })">
      <label for="doctor">醫師</label>
      <select id="doctor" :value="filters.doctorId" @change="setFilter({ doctorId: $event.target.value })">
        <option value="">全部醫師</option>
        <option v-for="d in DOCTORS" :key="d.id" :value="String(d.id)">{{ d.name }}</option>
      </select>
      <button type="button" :disabled="status === 'loading' || refreshing" @click="refresh">重新整理</button>
    </div>

    <section :aria-busy="status === 'loading' || refreshing">
      <ul v-if="status === 'loading'" class="skeleton" aria-hidden="true">
        <li v-for="n in 3" :key="n"></li>
      </ul>
      <div v-else-if="status === 'error'" role="alert">
        <p>{{ error.text }}</p>
        <button v-if="error.retryable" type="button" @click="load()">重試</button>
      </div>
      <p v-else-if="status === 'empty'" class="empty">這天沒有門診，換一天或換一位醫師看看</p>
      <template v-else>
        <p v-if="refreshFailed" role="alert">更新失敗，以下是先前的資料</p>
        <ul class="sessions">
          <li v-for="s in sessions" :key="s.id" class="session">
            <h2>{{ s.session_date }} {{ PERIODS[s.period] }}診 {{ DOCTOR_NAME[s.doctor_id] }}</h2>
            <p>{{ s.remaining > 0 ? `剩 ${s.remaining} 名` : '額滿' }}</p>
            <RouterLink v-if="s.remaining > 0" :to="{ name: 'book', params: { id: s.id } }">掛號</RouterLink>
          </li>
        </ul>
      </template>
    </section>
  </main>
</template>

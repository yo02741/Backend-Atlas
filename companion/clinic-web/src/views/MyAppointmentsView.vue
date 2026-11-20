<script setup>
// 我的掛號（第 4 階段）。status 篩選由後端處理（契約的 GET /api/appointments?status=）
import { ref, watch, nextTick, onWatcherCleanup, useTemplateRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiFetch } from '@/api/client'
import CancelDialog from '@/components/CancelDialog.vue'

const STATUS_TEXT = { booked: '已掛號', cancelled: '已取消', checked_in: '已報到' }
const STATUSES = ['all', 'booked', 'cancelled']
const LIMIT = 20
const route = useRoute()
const router = useRouter()

const status = ref('loading')        // 第一批：loading | success | empty | error
const items = ref([])
const nextCursor = ref(null)
const loadingMore = ref(false)
const loadMoreFailed = ref(false)
const cancelError = ref('')
const target = ref(null)
const cancelDialog = useTemplateRef('cancelDialog')
let controller = null                // 目前這一組條件的請求

const filter = () => (STATUSES.includes(route.query.status) ? route.query.status : 'all')

function fetchBatch(cursor, signal) {
  const params = new URLSearchParams({ limit: String(LIMIT) })
  if (filter() !== 'all') params.set('status', filter())
  if (cursor) params.set('cursor', cursor)
  return apiFetch(`/appointments?${params}`, { signal })   // { items, next_cursor }
}

watch(() => (route.name === 'appointments' ? filter() : null), async (key) => {
  if (key === null) return
  const c = (controller = new AbortController())
  onWatcherCleanup(() => c.abort())   // 條件又變了或元件卸載：這一輪的請求都取消（第一個 await 之前登記）
  items.value = []                    // 換條件：從第一批開始，cursor 不沿用
  nextCursor.value = null
  loadMoreFailed.value = false
  status.value = 'loading'
  try {
    const page = await fetchBatch(null, c.signal)
    items.value = page.items
    nextCursor.value = page.next_cursor
    status.value = page.items.length ? 'success' : 'empty'
  } catch (err) {
    if (c.signal.aborted || err.status === 401) return   // 被取消不算錯誤
    status.value = 'error'
  }
}, { immediate: true })

async function loadMore() {
  if (loadingMore.value || !nextCursor.value) return
  const c = controller                // 記下這一批屬於哪一組條件
  loadingMore.value = true
  loadMoreFailed.value = false
  try {
    const page = await fetchBatch(nextCursor.value, c.signal)
    if (c !== controller) return      // 等待期間換了條件：舊條件的一批，丟掉
    items.value.push(...page.items)
    nextCursor.value = page.next_cursor
  } catch (err) {
    if (!c.signal.aborted && err.status !== 401) loadMoreFailed.value = true   // 已載入的留著
  } finally {
    loadingMore.value = false
  }
}

function ask(a) {
  target.value = a
  cancelDialog.value.open()
}

async function cancel(a) {
  cancelError.value = ''
  try {
    const updated = await apiFetch(`/appointments/${a.id}/cancel`, { method: 'POST' })
    const i = items.value.findIndex((x) => x.id === a.id)
    if (i >= 0) items.value[i] = updated             // 只換這一列，不重抓整份清單
    await nextTick()
    document.getElementById('list-title')?.focus()   // 觸發按鈕跟著消失了：焦點移到清單標題
  } catch (err) {
    if (err.status !== 401) cancelError.value = err.problem?.detail ?? '取消失敗，請稍後再試'
  }
}
</script>

<template>
  <main>
    <h1 id="list-title" tabindex="-1">我的掛號</h1>
    <label for="status">狀態</label>
    <select id="status" :value="filter()" @change="router.push({ query: $event.target.value === 'all' ? {} : { status: $event.target.value } })">
      <option value="all">全部</option>
      <option value="booked">已掛號</option>
      <option value="cancelled">已取消</option>
    </select>

    <p v-if="cancelError" role="alert">{{ cancelError }}</p>
    <p v-if="status === 'loading'">載入中…</p>
    <div v-else-if="status === 'error'" role="alert"><p>讀取失敗</p></div>
    <p v-else-if="status === 'empty'">沒有符合條件的掛號</p>
    <template v-else>
      <ul>
        <li v-for="a in items" :key="a.id">
          第 {{ a.number }} 號　{{ STATUS_TEXT[a.status] }}
          <button v-if="a.status === 'booked'" type="button" @click="ask(a)">取消掛號</button>
        </li>
      </ul>
      <p v-if="loadMoreFailed" role="alert">載入失敗，請再按一次「載入更多」</p>
      <button v-if="nextCursor" type="button" :disabled="loadingMore" @click="loadMore">
        {{ loadingMore ? '載入中…' : '載入更多' }}
      </button>
    </template>
    <CancelDialog ref="cancelDialog" :appointment="target" @confirm="cancel" />
  </main>
</template>

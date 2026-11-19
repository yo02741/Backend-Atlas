// 設計情境：一萬列的看診紀錄表格（前端路線，畫面與互動）
export default {
  id: 'big-table',
  order: 33,
  group: 'screen',
  title: '一萬列的看診紀錄表格',
  en: 'Large data tables',
  level: 2,
  skills: ['data-display', 'pagination-filter', 'navigation-ui', 'a11y-basics', 'api-patterns', 'render-performance', 'a11y-components'],
  related: ['pagination'],
  week: 11,
  lab: 'BigTableScenarioLab',
  summary: '一個科一年一萬多筆看診紀錄，要排序、篩選、勾選後批次列印。一次載入再前端分頁、一次載入加虛擬捲動，還是交給伺服器分頁？',
  situation: '門診的「看診紀錄」查詢頁：一個科一年約 12,000 筆，每列有日期、時段、醫師、病人、病歷號、狀態等 8 欄。櫃台與病歷室人員用院內的舊筆電，會依日期或醫師排序、依狀態篩選，勾選後批次列印報到單或寄提醒簡訊。院內有使用螢幕閱讀器的同仁，也有人習慣用 Ctrl+F 找病歷號。全院所有科別合起來，一年超過 50 萬筆。',
  constraints: [
    '排序與篩選要作用在全部資料，不能只排畫面上這一頁',
    '捲動與換頁不能卡；舊筆電上第一次打開也要在幾秒內能操作',
    '「全選」要看得出選了多少筆：這一頁，還是全部符合條件的資料',
    '只用鍵盤與螢幕閱讀器，要能知道目前在第幾列、共幾列',
    '篩選、排序與頁碼寫進網址，上一頁回得來',
  ],
  options: [
    {
      id: 'client', name: '一次載入，前端分頁',
      summary: '`GET /visits?dept=fm&year=2026` 一次拿回全部，排序、篩選、分頁都在瀏覽器做，每頁畫 50 列。',
      pros: ['排序、篩選、換頁都不用等網路', '資料都在手上，「全選全部符合條件」與匯出 CSV 很直接', 'DOM 只有一頁的列，無障礙照一般表格處理'],
      cons: ['第一次下載與解析隨筆數線性成長：1 萬筆還行，50 萬筆不行', '資料是載入那一刻的快照，別人新增的紀錄要重新載入才看得到', 'Ctrl+F 只找得到這一頁'],
    },
    {
      id: 'virtual', name: '一次載入，虛擬捲動',
      summary: '全部資料在記憶體裡，只畫捲動視窗內看得到的幾十列（TanStack Virtual 這類），上下各補一段空白撐出捲軸。',
      pros: ['一條連續的捲軸，不用翻頁', '資料再多，DOM 都只有幾十列，捲動與打字篩選不卡'],
      cons: ['下載量和前端分頁一樣，資料多時第一次載入一樣慢', '不在畫面上的列不在 DOM 裡：Ctrl+F、螢幕閱讀器的瀏覽模式、列印都看不到；表格要補 `aria-rowcount` 與 `aria-rowindex`', '列高要固定或逐列量測，會換行或展開的列讓捲軸跳動'],
    },
    {
      id: 'server', name: '伺服器分頁',
      summary: '`GET /visits?status=no-show&sort=-date&page=3&size=50`，排序、篩選、分頁在資料庫做，回傳這一頁與總筆數。',
      pros: ['第一次載入只有一頁，資料再多也一樣快', '資料永遠是最新的，權限由後端逐筆把關', '50 萬筆、跨年度的查詢也撐得住'],
      cons: ['每次排序、篩選、換頁都等一次來回，要做 loading 與取消舊請求', '「全選全部符合條件」不能送 id 清單，要把篩選條件送給批次 API', '深頁用 OFFSET 會越來越慢，後端要用 cursor 或限制頁數'],
    },
  ],
  tradeoffs: {
    axes: ['第一次載入', '排序與篩選', 'DOM 裡的列', 'Ctrl+F 與螢幕閱讀器', '資料量上限'],
    rows: [
      { option: 'client', cells: ['差：全部下載', '好：本機計算', '一頁（50 列）', '中：只有這一頁', '中：數萬筆'] },
      { option: 'virtual', cells: ['差：全部下載', '好：本機計算', '視窗內幾十列', '差：畫面外的列看不到', '中：數萬筆'] },
      { option: 'server', cells: ['好：只有一頁', '中：每次一個來回', '一頁（50 列）', '中：只有這一頁', '好：看資料庫'] },
    ],
  },
  decisions: [
    { id: 'today', situation: '醫師的今日候診清單：最多 60 位病人，整天開著，要依報到時間排序、即時篩出「已報到」。', options: ['client', 'virtual', 'server'], answer: 'client',
      explain: '60 筆一次載入只有幾 KB，排序與篩選在瀏覽器做最快，連分頁都可以不要。伺服器分頁讓每次點排序都等一次網路；虛擬捲動是幾千列以上才需要的複雜度。新報到的病人用輪詢或 SSE 更新這 60 筆即可。' },
    { id: 'archive', situation: '病歷室查全院歷年看診紀錄：50 萬筆以上，依日期、醫師、狀態組合篩選，結果常常還有上萬筆。', options: ['client', 'virtual', 'server'], answer: 'server',
      explain: '50 萬筆一次下載不實際，篩選與排序要在有索引的資料庫做。API 回一頁與總筆數，條件寫進網址；深頁變慢交給後端用 cursor 或限制最大頁數。全選「全部符合條件」時，送篩選條件給批次 API，不是上萬個 id。' },
    { id: 'drug', situation: '藥局的藥品主檔 4,000 項：藥師要快速上下捲動比對，邊打字邊篩選，不想翻頁。', options: ['client', 'virtual', 'server'], answer: 'virtual',
      explain: '4,000 筆的下載量可以接受，篩選要即時，所以資料放前端；連續捲動是需求，而一次畫出 4,000 列 × 8 欄，在舊電腦上打字篩選會卡。虛擬捲動只畫看得到的列；列高要固定，補上 aria-rowcount 與 aria-rowindex，「列印全部」另外走一個不虛擬化的版面。' },
    { id: 'monthly', situation: '單一醫師的月報：每月約 600 筆、資料是上個月的不會再變，要多欄排序、篩選後匯出 CSV。', options: ['client', 'virtual', 'server'], answer: 'client',
      explain: '600 筆、不會變的資料，一次載入後排序、篩選、匯出都在瀏覽器完成，CSV 直接用手上的資料產生。前端分頁讓 DOM 維持一頁的大小，列印與無障礙照一般表格處理。換成伺服器分頁，每點一次排序都要等網路，卻換不到任何好處。' },
  ],
  implementation: [
    { title: '伺服器分頁：條件在網址、取消舊請求、全選的範圍', lang: 'vue', code: `<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

type Visit = { id: number; date: string; doctor: string; patient: string; status: string }
const PAGE_SIZE = 50
const route = useRoute()
const router = useRouter()

// 條件都從網址讀：重新整理、上一頁都還原得回來
const query = computed(() => ({
  status: String(route.query.status ?? ''),
  sort: String(route.query.sort ?? '-date'),
  page: Math.max(1, Number(route.query.page ?? 1)),
}))
const rows = ref<Visit[]>([])
const total = ref(0)
const loading = ref(false)
const selected = ref(new Set<number>())
const allMatching = ref(false)          // true：選的是全部符合條件的紀錄，不只這一頁

let ctrl: AbortController | null = null
watch(query, async (q) => {
  ctrl?.abort()                         // 連點排序、換頁時，只採用最後一次的回應
  const mine = (ctrl = new AbortController())
  loading.value = true
  selected.value = new Set()
  allMatching.value = false
  const params = new URLSearchParams({ status: q.status, sort: q.sort, page: String(q.page), size: String(PAGE_SIZE) })
  try {
    const res = await fetch('/api/visits?' + params, { signal: mine.signal })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const body = await res.json()       // { items, total }
    rows.value = body.items
    total.value = body.total
  } catch (e) {
    if ((e as Error).name !== 'AbortError') console.error(e)   // 實際要顯示錯誤狀態與重試
  } finally {
    if (ctrl === mine) loading.value = false
  }
}, { immediate: true })

function sortBy(key: string) {          // 換排序回到第 1 頁
  const sort = query.value.sort === '-' + key ? key : '-' + key
  router.push({ query: { ...route.query, sort, page: 1 } })
}
const pageChecked = computed(() => rows.value.length > 0 && rows.value.every((r) => selected.value.has(r.id)))
const pagePartial = computed(() => !pageChecked.value && rows.value.some((r) => selected.value.has(r.id)))
function togglePage(on: boolean) {
  selected.value = on ? new Set(rows.value.map((r) => r.id)) : new Set()
  allMatching.value = false
}
async function remind() {
  const body = allMatching.value
    ? { filter: { status: query.value.status } }   // 全部符合條件：送條件，不送上萬個 id
    : { ids: [...selected.value] }
  await fetch('/api/visits/remind', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
</script>

<template>
  <p v-if="pageChecked && !allMatching && total > rows.length" role="status">
    已選這一頁 {{ rows.length }} 筆。
    <button type="button" @click="allMatching = true">選取全部 {{ total }} 筆符合條件的紀錄</button>
  </p>
  <p v-else-if="allMatching" role="status">
    已選全部 {{ total }} 筆。<button type="button" @click="togglePage(false)">清除選取</button>
  </p>
  <table :aria-rowcount="total + 1" :aria-busy="loading">
    <thead>
      <tr aria-rowindex="1">
        <th scope="col"><input type="checkbox" aria-label="全選這一頁"
            :checked="pageChecked" :indeterminate="pagePartial"
            @change="togglePage(($event.target as HTMLInputElement).checked)" /></th>
        <th scope="col" :aria-sort="query.sort.endsWith('date') ? (query.sort.startsWith('-') ? 'descending' : 'ascending') : undefined">
          <button type="button" @click="sortBy('date')">日期</button>
        </th>
        <th scope="col">醫師</th><th scope="col">病人</th><th scope="col">狀態</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="(r, i) in rows" :key="r.id" :aria-rowindex="(query.page - 1) * PAGE_SIZE + i + 2">
        <td><input type="checkbox" :aria-label="'選取 ' + r.patient" :checked="selected.has(r.id)"
            @change="selected.has(r.id) ? selected.delete(r.id) : selected.add(r.id)" /></td>
        <td>{{ r.date }}</td><td>{{ r.doctor }}</td><td>{{ r.patient }}</td><td>{{ r.status }}</td>
      </tr>
    </tbody>
  </table>
</template>` },
    { title: '虛擬捲動：保留 table 語意，補上列號', lang: 'vue', code: `<script setup lang="ts">
import { computed, ref } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'   // 3.13

type Visit = { id: number; date: string; doctor: string; patient: string; status: string }
const props = defineProps<{ rows: Visit[] }>()
const ROW_H = 36                                // 列高固定：儲存格不換行
const scroller = ref<HTMLElement | null>(null)

const virtualizer = useVirtualizer(computed(() => ({
  count: props.rows.length,
  getScrollElement: () => scroller.value,
  estimateSize: () => ROW_H,
  overscan: 8,                                  // 視窗上下各多畫 8 列，快速捲動不露白
})))
const items = computed(() => virtualizer.value.getVirtualItems())
// 上下兩列空白撐出完整高度，捲軸長度與一次畫完全部時相同
const padTop = computed(() => items.value[0]?.start ?? 0)
const padBottom = computed(() => virtualizer.value.getTotalSize() - (items.value.at(-1)?.end ?? 0))
</script>

<template>
  <!-- 可捲動的區域要能用鍵盤聚焦，否則只用鍵盤捲不動 -->
  <div ref="scroller" class="scroller" tabindex="0" role="region" aria-label="看診紀錄">
    <table :aria-rowcount="rows.length + 1">        <!-- +1 是表頭那一列 -->
      <thead>
        <tr aria-rowindex="1"><th scope="col">日期</th><th scope="col">醫師</th><th scope="col">病人</th><th scope="col">狀態</th></tr>
      </thead>
      <tbody>
        <tr v-if="padTop > 0" aria-hidden="true" :style="{ height: padTop + 'px' }"><td colspan="4"></td></tr>
        <tr v-for="it in items" :key="rows[it.index].id" :aria-rowindex="it.index + 2" :style="{ height: ROW_H + 'px' }">
          <td>{{ rows[it.index].date }}</td><td>{{ rows[it.index].doctor }}</td>
          <td>{{ rows[it.index].patient }}</td><td>{{ rows[it.index].status }}</td>
        </tr>
        <tr v-if="padBottom > 0" aria-hidden="true" :style="{ height: padBottom + 'px' }"><td colspan="4"></td></tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.scroller { block-size: 70vh; overflow: auto; }
thead th { position: sticky; inset-block-start: 0; background: var(--color-surface); }
td { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>` },
  ],
  exercise: null,
  refs: [],
}

// 設計情境：預約清單的資料怎麼抓（每次重抓、store 快取、stale-while-revalidate）
export default {
  id: 'list-fetching',
  order: 37,
  group: 'state',
  title: '預約清單的資料怎麼抓',
  en: 'Fetching list data',
  level: 2,
  skills: ['api-states', 'cancel-race', 'composables', 'pinia', 'pagination-filter', 'http-caching', 'data-caching'],
  week: 12,
  lab: 'ListFetchingScenarioLab',
  related: ['cache'],
  summary: '櫃台一天在清單、詳細頁、掛號表單之間來回上百次。每次進頁都重抓、抓一次放 store，還是先顯示快取再背景更新？',
  situation: '門診系統的「預約清單」一次載入當天 50 筆，API 平常 400 ms、門診尖峰要 1.5 秒（示意）。櫃台一天在清單、病患詳細頁與掛號表單之間來回切換上百次，也會在日期之間來回切換。資料一直在變：櫃台自己新增或取消掛號，另外 6 個櫃台也在改，病患線上掛號也會進來，每分鐘幾筆。頁首的「今日掛號數」徽章和清單用同一個 API。',
  constraints: [
    '從詳細頁回到清單，不能每次都看 1.5 秒的 Skeleton',
    '自己剛新增的掛號，回到清單時一定要看得到',
    '別的櫃台的變更，1 分鐘內要出現在畫面上',
    '頁首徽章與清單同時要資料時，不要打兩次一樣的請求',
    '換日期時，畫面不能顯示另一天的資料',
  ],
  options: [
    {
      id: 'refetch', name: '每次進頁重抓',
      summary: '元件 `onMounted` 與條件的 `watch` 裡直接 `fetch`，資料放元件的 `ref`；離開頁面就丟掉。',
      pros: ['畫面永遠是剛抓的資料，沒有快取要失效', '程式最少，四種狀態寫在同一個元件裡'],
      cons: ['每次回到清單都從 Skeleton 開始，捲動位置也回不去', '徽章與清單各自抓，同一個請求打兩次', '停在清單頁時，別人的變更要等下次進頁才看得到'],
    },
    {
      id: 'store', name: 'Pinia store 快取',
      summary: '清單放進 store，`load()` 抓一次就存著；回到清單時有資料就直接用，自己決定多久過期、什麼時候重抓。',
      pros: ['回到清單立刻有畫面，不打 API', '徽章與清單讀同一份 store，進行中的請求可以共用'],
      cons: ['過期、新增後失效、依日期分開存、背景更新，都要自己寫', '常見的寫法只存一份清單：換日期就蓋掉，換回來再抓一次', '忘了在新增後讓它失效，回到清單就看不到剛新增的那一筆'],
    },
    {
      id: 'swr', name: 'stale-while-revalidate（TanStack Query、Pinia Colada）',
      summary: '依 query key（`[\'appointments\', date]`）快取；有快取先顯示，超過 `staleTime` 就在背景重抓再換上；新增後 `invalidateQueries`。',
      pros: ['回到清單先顯示快取，背景更新完再換，不閃 Skeleton', '同一個 key 同時只送一個請求；每個日期各有一份快取', '重新掛載、切回分頁、網路恢復時自動重抓過期的資料'],
      cons: ['多一個依賴與一套觀念：query key、`staleTime`、`gcTime`、invalidate', '畫面會短暫顯示舊資料，要讓使用者看得出「更新中」', '預設值各家不同：TanStack Query 5 的 `staleTime` 是 0，Pinia Colada 1.4 是 5 秒'],
    },
  ],
  tradeoffs: {
    axes: ['回到清單', '新增後看得到', '別人的變更', '重複請求', '要自己寫的'],
    rows: [
      { option: 'refetch', cells: ['差：每次 Skeleton', '好：每次都重抓', '中：下次進頁才更新', '差：每個元件各打一次', '最少'] },
      { option: 'store', cells: ['好：直接顯示', '差：要自己在新增後失效', '差：過期與重抓都要自己寫', '好：共用一份（要自己防同時呼叫）', '多：過期、失效、依日期分開存'] },
      { option: 'swr', cells: ['好：先顯示快取、背景更新', '好：`invalidateQueries`', '好：掛載、切回分頁時重抓', '好：同 key 合併', '少：設定 key 與 `staleTime`；多一個依賴'] },
    ],
  },
  decisions: [
    { id: 'lookup', situation: '掛號表單的科別與診間下拉選單：資料一年改幾次，十幾個畫面都要用；專案沒有資料快取工具，也不打算為此引入。', options: ['refetch', 'store', 'swr'], answer: 'store',
      explain: '幾乎不變的參照資料，登入後抓一次放 store，整個工作階段共用，不需要過期與背景更新。每次重抓等於十幾個畫面各打一次同樣的請求。為了這一份資料引入快取工具，成本比自己寫一個 `load()` 高。' },
    { id: 'lab-result', situation: '病患的檢驗報告頁：醫師點進去看完就離開；報告隨時可能補上新的數值，畫面上絕不能先出現舊的結果。', options: ['refetch', 'store', 'swr'], answer: 'refetch',
      explain: '這一頁要的是「現在的結果」，先顯示快取再換掉的那一秒就可能讓人看錯。進頁就抓、等資料回來才顯示，Skeleton 的代價可以接受。用快取工具也做得到（`staleTime: 0` 加上抓到之前不顯示舊資料），但已經失去它的好處。' },
    { id: 'counter', situation: '櫃台的預約清單：一天來回上百次，自己新增的要立刻看到，別的櫃台的變更 1 分鐘內要出現，頁首徽章也要同一份資料。', options: ['refetch', 'store', 'swr'], answer: 'swr',
      explain: '回到清單先顯示快取、背景重抓，新增後 invalidate，切回分頁時重抓，徽章與清單用同一個 key 只送一個請求。這些在 store 裡都要自己寫，每次重抓則要一直看 Skeleton。`staleTime` 設 30 秒，別人的變更在下一次掛載或切回分頁時出現；停在清單頁也要在 1 分鐘內更新，再加 `refetchInterval: 60_000`。' },
  ],
  implementation: [
    { title: 'TanStack Query 5：依日期快取、新增後失效（@tanstack/vue-query）', lang: 'ts', code: `// main.ts
import { VueQueryPlugin } from '@tanstack/vue-query'
createApp(App).use(VueQueryPlugin).mount('#app')

// composables/useAppointments.ts：清單與頁首徽章都呼叫它，同一個 key 只送一個請求
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import type { Ref } from 'vue'

async function getAppointments(date: string, signal: AbortSignal) {
  const res = await fetch(\`/api/appointments?date=\${date}\`, { signal })   // 用了 signal：換日期後沒人用的舊請求會被取消
  if (!res.ok) throw new Error(\`HTTP \${res.status}\`)
  return res.json() as Promise<Appointment[]>
}

export function useAppointments(date: Ref<string>) {
  return useQuery({
    queryKey: ['appointments', date],          // date 是 ref：換日期就換一份快取
    queryFn: ({ signal }) => getAppointments(date.value, signal),
    staleTime: 30_000,                         // 30 秒內回到清單不重抓；超過就先顯示快取、背景重抓
  })
}

export function useCreateAppointment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: NewAppointment) =>
      fetch('/api/appointments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then((r) => { if (!r.ok) throw new Error(\`HTTP \${r.status}\`); return r.json() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['appointments'] }),   // 每個日期的清單都標成過期
  })
}` },
    { title: '清單元件：第一次載入用 Skeleton，之後的背景更新只顯示小提示', lang: 'vue', code: `<script setup lang="ts">
import { useListQuery } from '@/composables/useListQuery'
import { useAppointments } from '@/composables/useAppointments'

const { date } = useListQuery()
const { data, isPending, isFetching, isError, refetch } = useAppointments(date)
</script>

<template>
  <h2>預約清單 <small v-if="isFetching && !isPending" role="status">更新中…</small></h2>
  <SkeletonRows v-if="isPending" :rows="8" />
  <ErrorAlert v-else-if="isError && !data" @retry="refetch" />
  <EmptyState v-else-if="data?.length === 0" />
  <AppointmentTable v-else :rows="data" />
</template>` },
    { title: '對照：store 裡自己寫的版本（依日期分開存、過期、共用進行中的請求、失效）', lang: 'ts', code: `export const useAppointmentsStore = defineStore('appointments', () => {
  const byDate = ref<Record<string, { rows: Appointment[]; at: number }>>({})
  const inflight = new Map<string, Promise<void>>()
  const TTL = 30_000

  function load(date: string, force = false) {
    const hit = byDate.value[date]
    if (!force && hit && Date.now() - hit.at < TTL) return Promise.resolve()
    if (inflight.has(date)) return inflight.get(date)!          // 徽章與清單同時呼叫：共用同一個請求
    const p = fetch(\`/api/appointments?date=\${date}\`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(\`HTTP \${r.status}\`))))
      .then((rows) => { byDate.value[date] = { rows, at: Date.now() } })
      .finally(() => inflight.delete(date))
    inflight.set(date, p)
    return p
  }
  function invalidate() { byDate.value = {} }                   // 新增、取消掛號之後呼叫
  return { byDate, load, invalidate }
})
// 還沒寫的：背景更新時保留舊資料、切回分頁時重抓、錯誤重試、不再使用的日期何時清掉` },
  ],
  exercise: null,
  refs: [],
}

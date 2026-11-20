// 設計情境：門診系統的狀態放哪裡（元件、provide、Pinia、網址）
export default {
  id: 'state-placement',
  order: 36,
  group: 'state',
  title: '門診系統的狀態放哪裡',
  en: 'Where state lives',
  level: 1,
  skills: ['pinia', 'props-emits-model', 'slots-provide', 'urls-history', 'pagination-filter', 'browser-storage'],
  week: 12,
  lab: 'StatePlacementScenarioLab',
  related: ['auth-scheme'],
  summary: '目前選的科別、清單的篩選條件、登入的醫師、寫到一半的掛號表單，各自放元件、provide、Pinia 還是網址？',
  situation: '門診系統的「今日掛號」頁：頁首顯示登入的醫師；上方切換科別（內科、外科、小兒科），表格依日期、狀態、關鍵字篩選，一頁 20 筆，每一列有科別色標；按「新增掛號」打開 Dialog，填病患、時段與備註。櫃台常把網址貼給同事請他看同一份清單；同一台電腦一天有好幾位醫師輪流登入。路由守衛與處理 401 的 API 攔截器也要知道目前登入的是誰。',
  constraints: [
    '貼給同事的網址，打開要看到同一個科別與同一組篩選',
    '換了條件之後按上一頁，要回到前一組條件；重新整理不能把條件洗掉',
    '換一位醫師登入後，畫面上不能留著上一位的草稿或病患資料',
    '病患姓名、備註這類個資不能出現在網址與瀏覽紀錄裡',
    '科別色標在表格第三層的元件裡，不想讓中間每一層都多一個 prop',
  ],
  options: [
    {
      id: 'local', name: '元件內，用 props 往下傳',
      summary: '放在用到它的元件裡（`ref`），子元件要用就透過 props 傳下去、用 emit 改回來。',
      pros: ['範圍最小：元件卸載就清掉，不會留給下一位使用者', '資料從哪來、誰改它，看 props 與 emit 就知道'],
      cons: ['隔好幾層的元件要用時，中間每一層都得宣告並轉傳（prop drilling）', '重新整理、換頁、分享網址都留不住；改了也不會進瀏覽紀錄'],
    },
    {
      id: 'provide', name: 'provide／inject',
      summary: '上層元件 `provide(key, ref)`，後代 `inject(key)` 直接拿，中間的元件不用知道。',
      pros: ['深層元件直接讀，中間層不用轉傳', '範圍跟著提供者：同一頁的兩個區塊可以各自 provide 一份'],
      cons: ['只有提供者底下的元件拿得到；路由守衛、API 攔截器這類元件外的程式讀不到', '跟元件一樣只在記憶體裡，重新整理與分享網址都留不住'],
    },
    {
      id: 'pinia', name: 'Pinia store',
      summary: '`defineStore` 定義一份全域狀態，任何元件與元件外的程式（守衛、攔截器）呼叫 `useXxxStore()` 都拿到同一個實例。',
      pros: ['換頁還在，好幾個頁面與元件外的程式共用', 'Vue DevTools 看得到每一次變更'],
      cons: ['只在記憶體：重新整理就沒了，要自己寫進 `sessionStorage` 或重新向 API 要', '活得比頁面久：登出時沒清，下一位使用者就看到上一位的資料', '改了不會進瀏覽紀錄，上一頁回不到前一組值'],
    },
    {
      id: 'url', name: '網址（route params、query）',
      summary: '`/appointments?dept=peds&date=2026-11-20&page=3`；元件從 `useRoute()` 讀，改條件就 `router.push`。',
      pros: ['重新整理、分享網址、上一頁都留得住', '網址就是唯一的來源，不必另外同步一份'],
      cons: ['讀進來都是字串，要解析、檢查範圍、給預設值', '網址會進瀏覽紀錄，重新整理時整串送到伺服器、進存取紀錄：不能放個資與身分', '換到別的頁面就不在了，除非連結帶上'],
    },
  ],
  tradeoffs: {
    axes: ['重新整理', '分享網址', '上一頁', '跨頁與元件外', '傳到深層元件'],
    rows: [
      { option: 'local', cells: ['消失', '帶不過去', '差：沒有紀錄，直接離開頁面', '差：跟著元件卸載', '差：中間每層都要轉傳'] },
      { option: 'provide', cells: ['消失', '帶不過去', '差：同左', '中：提供者在 App 才跨頁；守衛讀不到', '好：直接 `inject`'] },
      { option: 'pinia', cells: ['消失：自己存，或向 API 要回來', '帶不過去', '差：只記最後一次的值', '好：任何地方都讀得到', '好：直接 `useXxxStore()`'] },
      { option: 'url', cells: ['保留', '好：整串網址就是狀態', '好：每筆紀錄各有自己的條件', '差：換頁就沒了，除非連結帶上', '好：`useRoute()`'] },
    ],
  },
  decisions: [
    { id: 'bookmark', situation: '「我的掛號」頁的排序欄位與頁碼，醫師常存成書籤，隔天打開要是同一頁。', options: ['local', 'pinia', 'url'], answer: 'url',
      explain: '書籤存的是網址，條件不在網址裡，隔天打開只會回到預設值。放 query（`?sort=time&page=3`），讀進來先解析成數字並檢查範圍。Pinia 跟元件一樣只在記憶體，關掉分頁就沒了。' },
    { id: 'role', situation: '頁首、側邊選單、路由守衛與處理 401 的 API 攔截器，都要知道目前登入的是醫師還是櫃台。', options: ['provide', 'pinia', 'url'], answer: 'pinia',
      explain: 'Pinia 的 store 是全域的單一實例，元件外的守衛與攔截器也能呼叫 `useSessionStore()`；provide 只有元件樹裡的後代拿得到。身分不放網址，任何人改網址就能冒充別人。重新整理後用 cookie 呼叫 `GET /api/me` 取回，登出時把相關的 store 一起重設。' },
    { id: 'dialog', situation: '「新增病患」Dialog 裡的姓名、生日、電話：按取消就放棄，送出後清空。', options: ['local', 'pinia', 'url'], answer: 'local',
      explain: '只有這個表單在用，生命週期跟 Dialog 一樣長。放在表單元件的 `ref`，Dialog 關掉就清掉，不會留給下一位使用者。放 Pinia 要自己記得清；放網址會讓病患資料進瀏覽紀錄。要防誤按重新整理，再把草稿寫進 `sessionStorage`，送出或取消時刪掉。' },
    { id: 'form-section', situation: '`FormSection` 元件包住十幾個輸入元件，整段要一起停用、一起決定尺寸；同一頁有三個 FormSection，各自獨立。', options: ['local', 'provide', 'pinia'], answer: 'provide',
      explain: '每個 FormSection `provide` 自己那一份設定，裡面的輸入元件 `inject` 最近的提供者，三段互不干擾。Pinia 只有一個實例，三段要共用一份，或自己用 id 分開；用 props 則頁面要對每個輸入元件重複寫 `:disabled` 與 `:size`。' },
  ],
  switchIf: [
    { when: '篩選條件只在一個 Dialog 裡用，關掉就丟，沒有人會分享', then: '放 `local`：元件自己的 `ref` 就夠，不必寫進網址。' },
    { when: '狀態要讓路由守衛與 API 攔截器讀到（登入的醫師）', then: '放 `pinia`：元件外的程式也拿得到同一個實例；登出時一併重設其他 store。' },
    { when: '同一頁有三個獨立區塊，各自要讓裡面十幾個輸入元件一起停用', then: '用 `provide`：每個區塊提供自己的值，互不影響，中間層不必轉傳。' },
  ],
  alternative: { option: 'pinia', holdsWhen: '篩選條件不需要分享網址或存書籤，只要在同一個工作階段的幾個頁面之間保留時。重新整理會丟掉，要接受或另外存 sessionStorage。' },
  challenge: {
    task: '把三件事當成可以重播的事件：重新整理、網址貼給同事、登出換李醫師登入。先為四種狀態（科別、篩選條件、登入的醫師、掛號表單草稿）各寫下你選的位置，並預測每個事件後畫面上的值。再到本頁模擬器依你的選擇切換「狀態」與「放在」，按這三個事件的按鈕，對照預測。',
    deliver: '一張 4 × 3 的預測與結果表，每格標命中或沒命中，沒命中的寫一句原因',
    check: [
      '預測在按按鈕之前寫好',
      '「掛號表單草稿」在換人登入後是空白，並寫出是哪一段程式清掉的',
      '在你的選擇下，「個資或身分進網址」是「否」',
    ],
    twist: '櫃台要求重新整理後草稿不要不見（誤按 F5、瀏覽器當掉）。先預測草稿要改放哪裡、「登出換人」那一格會不會因此失敗，以及要加什麼條件兩個需求才都能滿足。',
  },
  implementation: [
    { title: '篩選條件與科別放網址：解析、預設值、寫回（composables/useListQuery.ts）', lang: 'ts', code: `import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const DEPTS = ['med', 'surg', 'peds'] as const
type Dept = (typeof DEPTS)[number]
type QueryValue = string | null | (string | null)[] | undefined

const first = (v: QueryValue) => (Array.isArray(v) ? v[0] : v) ?? undefined
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })   // YYYY-MM-DD，台北時間

export function useListQuery() {
  const route = useRoute()
  const router = useRouter()

  // 讀：網址是唯一的來源；不合法的值一律回到預設值
  const dept = computed<Dept>(() => {
    const v = first(route.query.dept)
    return DEPTS.includes(v as Dept) ? (v as Dept) : 'med'
  })
  const date = computed(() => {
    const v = first(route.query.date)
    return v && /^\\d{4}-\\d{2}-\\d{2}$/.test(v) ? v : today()
  })
  const page = computed(() => {
    const n = Number(first(route.query.page))
    return Number.isInteger(n) && n >= 1 ? n : 1
  })

  // 寫：push 讓上一頁回得到前一組條件；換科別或篩選時頁碼回到第 1 頁（undefined 的參數不會出現在網址）
  function set(patch: Record<string, string | number | undefined>) {
    const page = 'page' in patch ? patch.page : undefined
    router.push({ query: { ...route.query, ...patch, page } })
  }

  return { dept, date, page, set }
}` },
    { title: '第三層的科別色標：直接讀網址，中間層不轉傳（DeptBadge.vue）', lang: 'vue', code: `<script setup lang="ts">
import { computed } from 'vue'
import { useListQuery } from '@/composables/useListQuery'

const { dept } = useListQuery()
const LABEL = { med: '內科', surg: '外科', peds: '小兒科' } as const
const label = computed(() => LABEL[dept.value])
</script>

<template>
  <span class="dept-badge" :data-dept="dept">{{ label }}</span>
</template>` },
    { title: '登入的醫師放 Pinia：重新整理後向後端要回來，登出時連同草稿一起清', lang: 'ts', code: `// stores/session.ts
export const useSessionStore = defineStore('session', () => {
  const user = ref<User | null>(null)

  async function restore() {                        // 用 cookie 向後端要回登入狀態
    const res = await fetch('/api/me').catch(() => null)
    user.value = res?.ok ? await res.json() : null
  }
  function logout() {
    user.value = null
    usePatientsStore().reset()                     // 存著上一位資料的 store 一起重設
    sessionStorage.removeItem('booking-draft')     // 表單草稿若有暫存，也刪掉
  }
  return { user, restore, logout }
})

// router.ts：在守衛裡呼叫 store，這時 Pinia 已經安裝
let restored = false
router.beforeEach(async (to) => {
  const session = useSessionStore()
  if (!restored) { restored = true; await session.restore() }   // 重新整理後的第一次導航
  if (to.meta.requiresAuth && !session.user) return { name: 'login', query: { redirect: to.fullPath } }
})` },
  ],
  exercise: null,
  refs: [],
}

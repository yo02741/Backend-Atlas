// 程式題：元件與框架（Vue 3，在沙箱 iframe 裡執行，見 src/runtime/frame.js；import 'pinia'、'vue-router' 時另外載入 Pinia 與 Vue Router）
// 瀏覽器裡不能直接跑 .vue 單檔元件：題目把元件寫成物件，模板放在 template 字串，結構和 <script setup> 版本一一對應。
export default [
  {
    id: 'components-sfc-1', skill: 'components-sfc', kind: 'vue', level: 1,
    title: '把清單的一列拆成 AppointmentRow',
    prompt: '預約頁全部寫在一個元件裡。把每一列拆成 `AppointmentRow` 元件：\n\n- `name: \'AppointmentRow\'`，用 props 收 `appointment`（`{ id, time, patient }`），根元素是 `<li data-test="row">`，顯示時間與病患\n- 按「取消」時 `emit(\'cancel\', appointment.id)`；不自己呼叫 API、不改 props\n- 上層 `AppointmentPage` 持有清單：收到 `cancel` 時呼叫 `POST /api/appointments/{id}/cancel`，成功後把那一筆從清單移除\n\n`GET /api/appointments?date=2026-11-20` 回傳 `[{ id, time, patient }]`。',
    api: "api.get('/api/appointments', { body: [{ id: 1, time: '09:00', patient: '王○明' }, { id: 2, time: '09:10', patient: '陳○華' }, { id: 3, time: '09:20', patient: '林○明' }] })\napi.post('/api/appointments/:id/cancel', (req) => ({ body: { id: Number(req.params.id), status: 'cancelled' } }))",
    starter: `import { createApp, ref, onMounted } from 'vue'

const AppointmentPage = {
  setup() {
    const appointments = ref([])
    onMounted(async () => {
      const res = await fetch('/api/appointments?date=2026-11-20')
      appointments.value = await res.json()
    })
    async function cancel(id) {
      const res = await fetch(\`/api/appointments/\${id}/cancel\`, { method: 'POST' })
      if (res.ok) appointments.value = appointments.value.filter((a) => a.id !== id)
    }
    return { appointments, cancel }
  },
  template: \`
    <ul>
      <li v-for="a in appointments" :key="a.id" data-test="row">
        {{ a.time }} {{ a.patient }}
        <button type="button" @click="cancel(a.id)">取消</button>
      </li>
    </ul>\`,
}

createApp(AppointmentPage).mount('#app')
`,
    solution: `import { createApp, ref, onMounted } from 'vue'

// 一列：只負責顯示，按鈕被按時通知上層
const AppointmentRow = {
  name: 'AppointmentRow',
  props: { appointment: { type: Object, required: true } },
  emits: ['cancel'],
  template: \`
    <li data-test="row">
      {{ appointment.time }} {{ appointment.patient }}
      <button type="button" @click="$emit('cancel', appointment.id)">取消</button>
    </li>\`,
}

// 上層：持有清單、呼叫 API
const AppointmentPage = {
  components: { AppointmentRow },
  setup() {
    const appointments = ref([])
    onMounted(async () => {
      const res = await fetch('/api/appointments?date=2026-11-20')
      appointments.value = await res.json()
    })
    async function cancel(id) {
      const res = await fetch(\`/api/appointments/\${id}/cancel\`, { method: 'POST' })
      if (res.ok) appointments.value = appointments.value.filter((a) => a.id !== id)
    }
    return { appointments, cancel }
  },
  template: \`
    <ul>
      <AppointmentRow v-for="a in appointments" :key="a.id" :appointment="a" @cancel="cancel" />
    </ul>\`,
}

createApp(AppointmentPage).mount('#app')
`,
    tests: [
      { name: '每一列是 AppointmentRow，用 props 收 appointment', code: "await waitFor(() => $$('[data-test=row]').length === 3)\nconst rows = $$('[data-test=row]').map((el) => el.__vueParentComponent)\nassert(rows.every((c) => c && c.type.name === 'AppointmentRow'), '每個 <li data-test=\"row\"> 要由 name 是 AppointmentRow 的元件產生')\nassertEqual(rows.map((c) => c.props.appointment && c.props.appointment.id), [1, 2, 3], 'AppointmentRow 的 props.appointment')" },
      { name: '按「取消」送出一次 POST，成功後那一列消失', code: "await waitFor(() => $$('[data-test=row]').length === 3)\nclick($$('[data-test=row]')[1].querySelector('button'))\nawait waitFor(() => $$('[data-test=row]').length === 2)\nassertEqual(api.calls.filter((c) => c.method === 'POST').map((c) => c.url), ['/api/appointments/2/cancel'])\nassert(!text('#app').includes('陳○華'), '取消的那一筆還在畫面上')\nassert(!logs.some((l) => l.text.includes('[Vue warn]')), 'Console 有 [Vue warn]')" },
      { name: 'AppointmentRow 只發出 cancel 事件，不自己呼叫 API', code: "await waitFor(() => $('[data-test=row]'))\nconst Row = $('[data-test=row]').__vueParentComponent.type\nassertEqual(Row.name, 'AppointmentRow', '找不到 AppointmentRow')\nconst { createApp, h } = await import('vue')\nconst host = document.createElement('div')\ndocument.body.append(host)\nlet got = null\ncreateApp({ render: () => h(Row, { appointment: { id: 9, time: '10:00', patient: '測試' }, onCancel: (id) => { got = id } }) }).mount(host)\nconst before = api.calls.length\nhost.querySelector('button').click()\nawait wait(50)\nassertEqual(got, 9, \"按「取消」時 emit('cancel', id) 的 id\")\nassertEqual(api.calls.length, before, 'AppointmentRow 不應該自己呼叫 API')" },
    ],
    hints: ['子元件用 `props: { appointment: Object }` 收資料、`emits: [\'cancel\']` 宣告事件，模板裡用 `$emit(\'cancel\', appointment.id)`。', '上層在 `components` 註冊後，寫 `<AppointmentRow v-for=… :appointment="a" @cancel="cancel" />`。'],
  },
  {
    id: 'reactivity-1', skill: 'reactivity', kind: 'vue', level: 1,
    title: '搜尋打了字，清單要跟著變',
    prompt: '預約清單上方的搜尋框輸入病患姓名就篩選，旁邊顯示已報到人數。現在畫面一直是空的，打字也沒反應。改寫 `setup`：\n\n- `appointments`（API 回來的陣列）與 `keyword`（搜尋框）用 `ref` 宣告，不解構 `reactive` 物件\n- 「符合搜尋的預約」與「已報到人數」用 `computed` 從這兩個 ref 算出來\n- 搜尋框是 `<input data-test="keyword">`；每筆預約一個 `<li>`，內容是 `patientName`\n- `<p data-test="checked-in">` 顯示「已報到 N 人」：全部預約裡 `checkedIn` 為 `true` 的人數，不受搜尋影響\n\n`GET /api/appointments?date=2026-11-20` 回傳 `[{ id, patientName, checkedIn }]`。',
    api: "api.get('/api/appointments', { body: [{ id: 1, patientName: '王小明', checkedIn: true }, { id: 2, patientName: '陳美華', checkedIn: false }, { id: 3, patientName: '王大同', checkedIn: false }], delay: 100 })",
    starter: `import { createApp, reactive } from 'vue'

const AppointmentList = {
  setup() {
    const state = reactive({ keyword: '', appointments: [] })
    const { keyword, appointments } = state                                          // ① 解構
    const filtered = appointments.filter((a) => a.patientName.includes(keyword))   // ② 只算一次
    const checkedIn = appointments.filter((a) => a.checkedIn).length

    fetch('/api/appointments?date=2026-11-20')
      .then((res) => res.json())
      .then((data) => { state.appointments = data })

    return { state, filtered, checkedIn }
  },
  template: \`
    <input v-model="state.keyword" data-test="keyword" placeholder="病患姓名">
    <p data-test="checked-in">已報到 {{ checkedIn }} 人</p>
    <ul>
      <li v-for="a in filtered" :key="a.id">{{ a.patientName }}</li>
    </ul>\`,
}

createApp(AppointmentList).mount('#app')
`,
    solution: `import { createApp, ref, computed } from 'vue'

const AppointmentList = {
  setup() {
    const keyword = ref('')
    const appointments = ref([])
    // computed 記得它讀了哪些 ref，其中一個變了才重算
    const filtered = computed(() => appointments.value.filter((a) => a.patientName.includes(keyword.value)))
    const checkedIn = computed(() => appointments.value.filter((a) => a.checkedIn).length)

    fetch('/api/appointments?date=2026-11-20')
      .then((res) => res.json())
      .then((data) => { appointments.value = data })

    return { keyword, filtered, checkedIn }
  },
  template: \`
    <input v-model="keyword" data-test="keyword" placeholder="病患姓名">
    <p data-test="checked-in">已報到 {{ checkedIn }} 人</p>
    <ul>
      <li v-for="a in filtered" :key="a.id">{{ a.patientName }}</li>
    </ul>\`,
}

createApp(AppointmentList).mount('#app')
`,
    tests: [
      { name: '資料回來後列出全部預約', code: "await waitFor(() => $$('li').length === 3)\nassertEqual($$('li').map((li) => li.textContent.trim()), ['王小明', '陳美華', '王大同'])" },
      { name: '輸入姓名就篩選，清空後恢復', code: "await waitFor(() => $$('li').length === 3)\ninput('[data-test=keyword]', '王')\nawait tick()\nassertEqual($$('li').map((li) => li.textContent.trim()), ['王小明', '王大同'])\ninput('[data-test=keyword]', '')\nawait tick()\nassertEqual($$('li').length, 3)" },
      { name: '已報到人數跟著資料更新，不受搜尋影響', code: "await waitFor(() => text('[data-test=checked-in]') === '已報到 1 人')\ninput('[data-test=keyword]', '陳')\nawait tick()\nassertEqual(text('[data-test=checked-in]'), '已報到 1 人')" },
    ],
    hints: ['從 `reactive` 物件解構出來的值是當下的快照，之後不會跟著變。', '在 `setup` 裡直接算的值只算一次；要跟著資料變，用 `computed(() => …)`。'],
  },
  {
    id: 'template-syntax-1', skill: 'template-syntax', kind: 'vue', level: 2,
    title: '刪掉一列，備註不能跑到別人身上',
    prompt: '櫃台的預約清單有四個問題：\n\n- 已取消（`status: \'cancelled\'`）的預約不該出現：用 `computed` 篩掉，不要在 `<li>` 上同時寫 `v-for` 與 `v-if`\n- `key` 用了 index：在某一列的輸入框打字，再取消它上面那一列，打的字跑到下一位病患身上。改用 `a.id`\n- 狀態標籤的 class 要是 `badge` 加上狀態，例如 `class="badge booked"`\n- 病患留言 `remark` 要當純文字顯示，不用 `v-html`\n\n每列是 `<li data-test="row">`，裡面有一個輸入框與「取消」按鈕。',
    starter: `import { createApp, ref } from 'vue'

const AppointmentList = {
  setup() {
    const appointments = ref([
      { id: 1, time: '09:00', patientName: '王小明', status: 'booked', remark: '' },
      { id: 2, time: '09:10', patientName: '陳美華', status: 'checked_in', remark: '' },
      { id: 3, time: '09:20', patientName: '李大同', status: 'cancelled', remark: '' },
      { id: 4, time: '09:30', patientName: '林志明', status: 'booked', remark: '<b>需要輪椅</b>' },
    ])
    function cancel(id) {
      appointments.value = appointments.value.filter((a) => a.id !== id)
    }
    return { appointments, cancel }
  },
  template: \`
    <ul>
      <li v-for="(a, index) in appointments" :key="index" data-test="row">
        {{ a.time }} {{ a.patientName }}
        <span class="badge">{{ a.status }}</span>
        <span class="remark" v-html="a.remark"></span>
        <input placeholder="備註">
        <button type="button" @click="cancel(a.id)">取消</button>
      </li>
    </ul>\`,
}

createApp(AppointmentList).mount('#app')
`,
    solution: `import { createApp, ref, computed } from 'vue'

const AppointmentList = {
  setup() {
    const appointments = ref([
      { id: 1, time: '09:00', patientName: '王小明', status: 'booked', remark: '' },
      { id: 2, time: '09:10', patientName: '陳美華', status: 'checked_in', remark: '' },
      { id: 3, time: '09:20', patientName: '李大同', status: 'cancelled', remark: '' },
      { id: 4, time: '09:30', patientName: '林志明', status: 'booked', remark: '<b>需要輪椅</b>' },
    ])
    // 篩選寫在 computed，模板的 v-for 直接用結果
    const visibleAppointments = computed(() => appointments.value.filter((a) => a.status !== 'cancelled'))
    function cancel(id) {
      appointments.value = appointments.value.filter((a) => a.id !== id)
    }
    return { visibleAppointments, cancel }
  },
  template: \`
    <ul>
      <li v-for="a in visibleAppointments" :key="a.id" data-test="row">
        {{ a.time }} {{ a.patientName }}
        <span :class="['badge', a.status]">{{ a.status }}</span>
        <span class="remark">{{ a.remark }}</span>
        <input placeholder="備註">
        <button type="button" @click="cancel(a.id)">取消</button>
      </li>
    </ul>\`,
}

createApp(AppointmentList).mount('#app')
`,
    tests: [
      { name: '不顯示已取消的預約', code: "await waitFor(() => $('[data-test=row]'))\nassertEqual($$('[data-test=row]').length, 3, '列數')\nassert(!text('#app').includes('李大同'), '已取消的李大同不該出現')" },
      { name: '取消上面一列後，輸入框的字留在原本那位病患', code: "await waitFor(() => $('[data-test=row]'))\nconst rowOf = (name) => $$('[data-test=row]').find((r) => r.textContent.includes(name))\ninput(rowOf('陳美華').querySelector('input'), '下午回診')\nclick(rowOf('王小明').querySelector('button'))\nawait tick()\nassertEqual(rowOf('陳美華').querySelector('input').value, '下午回診', '陳美華那一列的輸入框')\nassertEqual(rowOf('林志明').querySelector('input').value, '', '林志明那一列的輸入框')" },
      { name: '狀態標籤的 class 是 badge 加上狀態', code: "await waitFor(() => $('[data-test=row]'))\nassertEqual($$('[data-test=row] .badge').map((b) => b.className), ['badge booked', 'badge checked_in', 'badge booked'])" },
      { name: '留言當純文字顯示', code: "await waitFor(() => $('[data-test=row]'))\nassert(!$('[data-test=row] b'), '留言裡的 <b> 被當成 HTML 了')\nassert(text('#app').includes('<b>需要輪椅</b>'), '留言要原樣顯示成文字')" },
      { name: 'Console 沒有 [Vue warn]', code: "await waitFor(() => $('[data-test=row]'))\nawait wait(50)\nassert(!logs.some((l) => l.text.includes('[Vue warn]')), logs.filter((l) => l.text.includes('[Vue warn]')).map((l) => l.text.slice(0, 120)).join('\\n'))" },
    ],
    hints: ['Vue 3 裡 `v-if` 比 `v-for` 先執行，寫在同一個元素時 `v-if` 拿不到 `a`。', '`:key` 要能代表「哪一筆資料」，不是「第幾個位置」。', '`{{ }}` 會跳脫 HTML；`v-html` 不會。'],
  },
  {
    id: 'lifecycle-1', skill: 'lifecycle', kind: 'vue', level: 2,
    title: '離開看板時清掉輪詢',
    prompt: '門診看板 `ClinicBoard` 掛載時抓 `GET /api/clinics/today`，之後每 `POLL_MS` 毫秒再抓一次（題目設 300 ms，實際是 30 秒），每次更新後 `emit(\'updated\')`，上層顯示「看板已更新」。按 `data-test="toggle"` 會切到掛號頁、卸載看板。現在卸載後請求還在送，來回切換幾次就越送越多。改成：\n\n- 卸載時（`onUnmounted`）清掉計時器\n- 卸載時用 `AbortController` 取消還沒回來的請求；被取消的請求不算錯誤\n- 卸載後不再 `emit(\'updated\')`，掛號頁不會出現「看板已更新」\n\n看板每個診間一個 `<li>`。',
    api: "api.get('/api/clinics/today', { body: [{ room: 101, current: 12 }, { room: 102, current: 5 }], delay: 100 })",
    starter: `import { createApp, ref, onMounted } from 'vue'

const POLL_MS = 300   // 題目縮短成 0.3 秒，實際是 30 秒

const ClinicBoard = {
  emits: ['updated'],
  setup(props, { emit }) {
    const clinics = ref([])
    async function load() {
      const res = await fetch('/api/clinics/today')
      clinics.value = await res.json()
      emit('updated')
    }
    onMounted(() => {
      load()
      setInterval(load, POLL_MS)
    })
    return { clinics }
  },
  template: \`<ul><li v-for="c in clinics" :key="c.room">{{ c.room }} 診：{{ c.current }} 號</li></ul>\`,
}

const App = {
  components: { ClinicBoard },
  setup() {
    const page = ref('board')
    const toast = ref('')
    function toggle() {
      page.value = page.value === 'board' ? 'booking' : 'board'
      toast.value = ''
    }
    return { page, toast, toggle }
  },
  template: \`
    <button type="button" data-test="toggle" @click="toggle">切換到{{ page === 'board' ? '掛號頁' : '看板' }}</button>
    <ClinicBoard v-if="page === 'board'" @updated="toast = '看板已更新'" />
    <p v-else>掛號頁</p>
    <p v-if="toast" data-test="toast">{{ toast }}</p>\`,
}

createApp(App).mount('#app')
`,
    solution: `import { createApp, ref, onMounted, onUnmounted } from 'vue'

const POLL_MS = 300   // 題目縮短成 0.3 秒，實際是 30 秒

const ClinicBoard = {
  emits: ['updated'],
  setup(props, { emit }) {
    const clinics = ref([])
    let timer = null
    let controller = null

    async function load() {
      controller?.abort()                 // 上一次還沒回來就不要了
      controller = new AbortController()
      try {
        const res = await fetch('/api/clinics/today', { signal: controller.signal })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        clinics.value = await res.json()
        emit('updated')
      } catch (err) {
        if (err.name !== 'AbortError') console.warn('看板更新失敗：', err.message)   // 被取消不算錯誤
      }
    }

    onMounted(() => {
      load()
      timer = setInterval(load, POLL_MS)
    })
    onUnmounted(() => {
      clearInterval(timer)
      controller?.abort()
    })
    return { clinics }
  },
  template: \`<ul><li v-for="c in clinics" :key="c.room">{{ c.room }} 診：{{ c.current }} 號</li></ul>\`,
}

const App = {
  components: { ClinicBoard },
  setup() {
    const page = ref('board')
    const toast = ref('')
    function toggle() {
      page.value = page.value === 'board' ? 'booking' : 'board'
      toast.value = ''
    }
    return { page, toast, toggle }
  },
  template: \`
    <button type="button" data-test="toggle" @click="toggle">切換到{{ page === 'board' ? '掛號頁' : '看板' }}</button>
    <ClinicBoard v-if="page === 'board'" @updated="toast = '看板已更新'" />
    <p v-else>掛號頁</p>
    <p v-if="toast" data-test="toast">{{ toast }}</p>\`,
}

createApp(App).mount('#app')
`,
    tests: [
      { name: '掛載後抓一次，之後定時輪詢', code: "await waitFor(() => $$('li').length === 2)\nawait wait(700)\nassert(api.calls.length >= 2, '0.7 秒內只送了 ' + api.calls.length + ' 次請求')" },
      { name: '卸載後不再送請求', code: "await waitFor(() => $$('li').length === 2)\nclick('[data-test=toggle]')\nawait tick()\nconst n = api.calls.length\nawait wait(800)\nassertEqual(api.calls.length, n, '卸載後又送出的請求數加上原本的')" },
      { name: '卸載時取消還沒回來的請求，不顯示「看板已更新」', api: "api.get('/api/clinics/today', { body: [{ room: 101, current: 12 }], delay: 400 })", code: "await waitFor(() => api.calls.length === 1)\nclick('[data-test=toggle]')\nawait wait(600)\nassert(api.calls[0].aborted, '卸載時要取消還沒回來的請求')\nassert(!$('[data-test=toast]'), '卸載後不應該出現「看板已更新」')" },
      { name: '來回切換不會累積計時器', code: "await waitFor(() => $$('li').length === 2)\nfor (let i = 0; i < 4; i++) { click('[data-test=toggle]'); await tick() }\nconst n = api.calls.length\nawait wait(900)\nconst more = api.calls.length - n\nassert(more <= 4, '0.9 秒內送了 ' + more + ' 次：舊的計時器還在跑')" },
    ],
    hints: ['`setInterval` 回傳 id，`onUnmounted` 裡 `clearInterval(id)`。', '每次請求建一個 `AbortController`，把 `signal` 傳給 `fetch`；卸載時 `abort()`，被取消的 `fetch` 以 `name` 為 `AbortError` 的錯誤結束。'],
  },
  {
    id: 'props-emits-model-1', skill: 'props-emits-model', kind: 'vue', level: 2,
    title: '點了日期，頁面的日期也要跟著變',
    prompt: '掛號頁 `AppointmentPage` 持有 `selectedDate`，傳給日期選擇元件 `DatePicker`，自己用 `watch` 抓當天的預約。`DatePicker` 把日期複製成本地的 ref：點了日期，選擇器上的日期變了，頁面的「已選」與預約筆數還是舊的；按「回到第一天」，選擇器也不跟著變。改成資料只有一個擁有者：\n\n- `DatePicker` 用 props 收 `date`、`days`、`closedDays`，不複製 `date`、不改 props；點日期時 `emit(\'update:date\', 日期)`，按「確定」時 `emit(\'confirm\', 日期)`，兩個事件都寫在 `emits`\n- `AppointmentPage` 用 `v-model:date="selectedDate"` 綁定\n- 休診日（`closedDays`）的按鈕 `disabled`；目前選的那天 `aria-pressed="true"`\n\n`defineModel` 是 `<script setup>` 的編譯器巨集，瀏覽器裡跑的物件元件用它展開後的寫法：prop 加 `update:date` 事件。每天一個 `<button data-test="day">`，「確定」是 `data-test="confirm"`；頁面的 `data-test="selected"`、`count`、`reset`、`confirmed` 已經寫好。`GET /api/appointments?date=…` 回傳那天的預約陣列。',
    api: "const byDate = { '2026-11-20': [1, 2, 3], '2026-11-21': [4], '2026-11-23': [5, 6] }\napi.get('/api/appointments', (req) => ({ body: (byDate[req.query.date] || []).map((id) => ({ id })), delay: 50 }))",
    starter: `import { createApp, ref, watch } from 'vue'

const DatePicker = {
  props: { date: String, days: Array, closedDays: Array },
  emits: ['confirm'],
  setup(props, { emit }) {
    const current = ref(props.date)          // 複製一份給自己改
    function pick(d) { current.value = d }
    function confirm() { emit('confirm', current.value) }
    return { current, pick, confirm }
  },
  template: \`
    <div role="group" aria-label="掛號日期">
      <button v-for="d in days" :key="d" type="button" data-test="day"
              :disabled="closedDays.includes(d)" :aria-pressed="d === current" @click="pick(d)">{{ d.slice(5) }}</button>
      <button type="button" data-test="confirm" @click="confirm">確定</button>
    </div>\`,
}

const AppointmentPage = {
  components: { DatePicker },
  setup() {
    const days = ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23']
    const closedDays = ['2026-11-22']           // 休診日
    const selectedDate = ref(days[0])
    const appointments = ref([])
    const confirmed = ref('')
    watch(selectedDate, async (d) => {
      const res = await fetch('/api/appointments?date=' + d)
      appointments.value = res.ok ? await res.json() : []
    }, { immediate: true })
    return { days, closedDays, selectedDate, appointments, confirmed }
  },
  template: \`
    <DatePicker :date="selectedDate" :days="days" :closed-days="closedDays" @confirm="(d) => (confirmed = d)" />
    <p data-test="selected">已選 {{ selectedDate }}</p>
    <p data-test="count">共 {{ appointments.length }} 筆預約</p>
    <button type="button" data-test="reset" @click="selectedDate = days[0]">回到第一天</button>
    <p v-if="confirmed" data-test="confirmed">確認掛號日期 {{ confirmed }}</p>\`,
}

createApp(AppointmentPage).mount('#app')
`,
    solution: `import { createApp, ref, watch } from 'vue'

// 等同 <script setup> 的 const date = defineModel('date') 加上 defineProps、defineEmits
const DatePicker = {
  props: { date: { type: String, required: true }, days: { type: Array, required: true }, closedDays: { type: Array, default: () => [] } },
  emits: ['update:date', 'confirm'],
  setup(props, { emit }) {
    const pick = (d) => emit('update:date', d)          // 由擁有者（父元件）改 selectedDate
    const confirm = () => emit('confirm', props.date)   // 上一次點擊後父元件已經更新，props.date 是新值
    return { pick, confirm }
  },
  template: \`
    <div role="group" aria-label="掛號日期">
      <button v-for="d in days" :key="d" type="button" data-test="day"
              :disabled="closedDays.includes(d)" :aria-pressed="d === date" @click="pick(d)">{{ d.slice(5) }}</button>
      <button type="button" data-test="confirm" @click="confirm">確定</button>
    </div>\`,
}

const AppointmentPage = {
  components: { DatePicker },
  setup() {
    const days = ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23']
    const closedDays = ['2026-11-22']           // 休診日
    const selectedDate = ref(days[0])
    const appointments = ref([])
    const confirmed = ref('')
    watch(selectedDate, async (d) => {
      const res = await fetch('/api/appointments?date=' + d)
      appointments.value = res.ok ? await res.json() : []
    }, { immediate: true })
    return { days, closedDays, selectedDate, appointments, confirmed }
  },
  template: \`
    <DatePicker v-model:date="selectedDate" :days="days" :closed-days="closedDays" @confirm="(d) => (confirmed = d)" />
    <p data-test="selected">已選 {{ selectedDate }}</p>
    <p data-test="count">共 {{ appointments.length }} 筆預約</p>
    <button type="button" data-test="reset" @click="selectedDate = days[0]">回到第一天</button>
    <p v-if="confirmed" data-test="confirmed">確認掛號日期 {{ confirmed }}</p>\`,
}

createApp(AppointmentPage).mount('#app')
`,
    tests: [
      { name: '點日期後，頁面的已選日期與預約筆數跟著變', code: "await waitFor(() => text('[data-test=count]') === '共 3 筆預約')\nclick($$('[data-test=day]')[1])\nawait tick()\nassertEqual(text('[data-test=selected]'), '已選 2026-11-21', '點了 11-21 之後頁面的已選日期')\nawait waitFor(() => text('[data-test=count]') === '共 1 筆預約')\nassert(api.calls.some((c) => c.url === '/api/appointments?date=2026-11-21'), '頁面要重抓 11-21 的預約')" },
      { name: '選擇器標出目前的日期，頁面改日期時跟著變', code: "await waitFor(() => $('[data-test=day]'))\nconst pressed = () => $$('[data-test=day]').map((b) => b.getAttribute('aria-pressed') === 'true')\nassertEqual(pressed(), [true, false, false, false], '一開始 aria-pressed')\nclick($$('[data-test=day]')[3])\nawait tick()\nassertEqual(pressed(), [false, false, false, true], '點 11-23 之後')\nclick('[data-test=reset]')\nawait tick()\nassertEqual(pressed(), [true, false, false, false], '按「回到第一天」之後')" },
      { name: '休診日的按鈕停用', code: "await waitFor(() => $('[data-test=day]'))\nassertEqual($$('[data-test=day]').map((b) => b.disabled), [false, false, true, false], 'disabled')" },
      { name: '按「確定」送出目前選的日期', code: "await waitFor(() => $('[data-test=day]'))\nclick($$('[data-test=day]')[1])\nawait tick()\nclick('[data-test=confirm]')\nawait tick()\nassertEqual(text('[data-test=confirmed]'), '確認掛號日期 2026-11-21')" },
      { name: 'Console 沒有 [Vue warn]（不改 props、事件有宣告）', code: "await waitFor(() => $('[data-test=day]'))\nclick($$('[data-test=day]')[3])\nawait tick()\nclick('[data-test=confirm]')\nawait wait(50)\nconst warns = logs.filter((l) => l.text.includes('[Vue warn]'))\nassert(!warns.length, warns.map((l) => l.text.slice(0, 140)).join('\\n'))" },
    ],
    hints: ['`v-model:date="d"` 等於 `:date="d"` 加上 `@update:date="(v) => (d = v)"`；子元件發出 `update:date`，父元件才會改值。', '`const current = ref(props.date)` 只在建立時讀一次 props，之後父元件改值也不會跟著變。', '在 script 裡寫 `props.date = d` 會出現 `[Vue warn] Set operation on key "date" failed: target is readonly.`，值也不會變。'],
  },
  {
    id: 'slots-provide-1', skill: 'slots-provide', kind: 'vue', level: 2,
    title: '表格的狀態欄交給頁面畫，院區名稱用 inject 拿',
    prompt: '通用表格 `DataTable` 每一格都有作用域 slot `cell-<欄位>`（參數 `row`、`value`）。預約頁要把狀態欄畫成徽章、沒有資料時顯示自己的文字，院區名稱由最上層的 `App` 提供。現在狀態欄顯示原始的 `checked_in`、空清單顯示「沒有資料」，切換院區後標題也不變。改成：\n\n- 頁面用 `<template #cell-status="{ value }">` 把狀態畫成 `<span class="badge">`，文字是中文狀態（`booked` 已掛號、`checked_in` 已報到）；`slot="…"` 與 `slot-scope` 是 Vue 2 的寫法，Vue 3 當成一般屬性\n- `DataTable` 沒有資料時渲染具名 slot `empty`，沒給的話顯示 `<p data-test="empty">沒有資料</p>`；預約頁給的是 `<p data-test="empty">這天沒有預約</p>`，候補名單不給\n- `App` 用 `provide(clinicKey, readonly(clinic))` 提供院區（`clinicKey` 是 `Symbol`），`ClinicTitle` 用 `inject(clinicKey)` 讀；按 `data-test="switch"` 會把 `clinic.value` 整個換成兒童院區，標題要跟著變\n\n預約表格是 `data-test="appointments"`，候補名單是 `data-test="waitlist"`，每列 `<tr data-test="row">`，每格 `<td :data-col="欄位">`；標題是 `<h2 data-test="clinic">院區名稱 · 今日預約</h2>`。`GET /api/appointments?date=2026-11-20` 回傳 `[{ id, time, patient, status }]`。',
    api: "api.get('/api/appointments', { body: [{ id: 1, time: '09:00', patient: '王小明', status: 'checked_in' }, { id: 2, time: '09:10', patient: '陳美華', status: 'booked' }], delay: 50 })",
    starter: `import { createApp, ref, onMounted, provide, inject } from 'vue'

const DataTable = {
  props: { rows: Array, columns: Array },
  template: \`
    <table v-if="rows.length">
      <thead><tr><th v-for="col in columns" :key="col.key" scope="col">{{ col.label }}</th></tr></thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id" data-test="row">
          <td v-for="col in columns" :key="col.key" :data-col="col.key">
            <slot :name="'cell-' + col.key" :row="row" :value="row[col.key]">{{ row[col.key] }}</slot>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else data-test="empty">沒有資料</p>\`,
}

const ClinicTitle = {
  setup() {
    const clinic = inject('clinic')
    return { clinic }
  },
  template: \`<h2 data-test="clinic">{{ clinic.name }} · 今日預約</h2>\`,
}

const STATUS = { booked: '已掛號', checked_in: '已報到' }
const columns = [{ key: 'time', label: '時間' }, { key: 'patient', label: '病患' }, { key: 'status', label: '狀態' }]

const AppointmentPage = {
  components: { DataTable, ClinicTitle },
  setup() {
    const rows = ref([])
    onMounted(async () => {
      const res = await fetch('/api/appointments?date=2026-11-20')
      rows.value = res.ok ? await res.json() : []
    })
    return { rows, columns, STATUS }
  },
  template: \`
    <ClinicTitle />
    <section data-test="appointments">
      <DataTable :rows="rows" :columns="columns">
        <template slot="cell-status" slot-scope="{ value }"><span class="badge">{{ STATUS[value] }}</span></template>
        <p slot="empty" data-test="empty">這天沒有預約</p>
      </DataTable>
    </section>
    <section data-test="waitlist">
      <DataTable :rows="[]" :columns="columns" />
    </section>\`,
}

const App = {
  components: { AppointmentPage },
  setup() {
    const clinic = ref({ name: '內科總院' })
    provide('clinic', clinic.value)
    const switchClinic = () => { clinic.value = { name: '兒童院區' } }
    return { switchClinic }
  },
  template: \`
    <button type="button" data-test="switch" @click="switchClinic">切換到兒童院區</button>
    <AppointmentPage />\`,
}

createApp(App).mount('#app')
`,
    solution: `import { createApp, ref, readonly, onMounted, provide, inject } from 'vue'

// injection key：實際專案放在 src/keys.ts 匯出，提供者與使用者 import 同一個 Symbol
const clinicKey = Symbol('clinic')

const DataTable = {
  props: { rows: Array, columns: Array },
  template: \`
    <table v-if="rows.length">
      <thead><tr><th v-for="col in columns" :key="col.key" scope="col">{{ col.label }}</th></tr></thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id" data-test="row">
          <td v-for="col in columns" :key="col.key" :data-col="col.key">
            <slot :name="'cell-' + col.key" :row="row" :value="row[col.key]">{{ row[col.key] }}</slot>
          </td>
        </tr>
      </tbody>
    </table>
    <slot v-else name="empty"><p data-test="empty">沒有資料</p></slot>\`,
}

const ClinicTitle = {
  setup() {
    const clinic = inject(clinicKey)          // 唯讀的 ref：提供者換掉 .value，這裡跟著更新
    return { clinic }
  },
  template: \`<h2 data-test="clinic">{{ clinic.name }} · 今日預約</h2>\`,
}

const STATUS = { booked: '已掛號', checked_in: '已報到' }
const columns = [{ key: 'time', label: '時間' }, { key: 'patient', label: '病患' }, { key: 'status', label: '狀態' }]

const AppointmentPage = {
  components: { DataTable, ClinicTitle },
  setup() {
    const rows = ref([])
    onMounted(async () => {
      const res = await fetch('/api/appointments?date=2026-11-20')
      rows.value = res.ok ? await res.json() : []
    })
    return { rows, columns, STATUS }
  },
  template: \`
    <ClinicTitle />
    <section data-test="appointments">
      <DataTable :rows="rows" :columns="columns">
        <template #cell-status="{ value }"><span class="badge">{{ STATUS[value] }}</span></template>
        <template #empty><p data-test="empty">這天沒有預約</p></template>
      </DataTable>
    </section>
    <section data-test="waitlist">
      <DataTable :rows="[]" :columns="columns" />
    </section>\`,
}

const App = {
  components: { AppointmentPage },
  setup() {
    const clinic = ref({ name: '內科總院' })
    provide(clinicKey, readonly(clinic))      // 提供 ref 本身；後代只能讀
    const switchClinic = () => { clinic.value = { name: '兒童院區' } }
    return { switchClinic }
  },
  template: \`
    <button type="button" data-test="switch" @click="switchClinic">切換到兒童院區</button>
    <AppointmentPage />\`,
}

createApp(App).mount('#app')
`,
    tests: [
      { name: '狀態欄是頁面給的徽章，其他欄用表格的預設內容', code: "await waitFor(() => $$('[data-test=appointments] [data-test=row]').length === 2)\nconst cells = (col) => $$('[data-test=appointments] [data-col=' + col + ']')\nassertEqual(cells('status').map((td) => td.querySelector('.badge') && td.querySelector('.badge').textContent.trim()), ['已報到', '已掛號'], '狀態欄的 .badge')\nassertEqual(cells('time').map((td) => td.textContent.trim()), ['09:00', '09:10'], '時間欄')" },
      { name: '沒有資料時顯示頁面給的 empty slot', api: "api.get('/api/appointments', { body: [], delay: 50 })", code: "await wait(150)\nassertEqual(text('[data-test=appointments] [data-test=empty]'), '這天沒有預約', '預約表格的 empty')" },
      { name: '沒給 empty slot 時顯示「沒有資料」', code: "await waitFor(() => $('[data-test=waitlist] [data-test=empty]'))\nassertEqual(text('[data-test=waitlist] [data-test=empty]'), '沒有資料')" },
      { name: '切換院區後標題跟著變', code: "await waitFor(() => $('[data-test=clinic]'))\nassertEqual(text('[data-test=clinic]'), '內科總院 · 今日預約')\nclick('[data-test=switch]')\nawait tick()\nassertEqual(text('[data-test=clinic]'), '兒童院區 · 今日預約', '切換之後的標題')" },
      { name: 'Console 沒有 [Vue warn]', code: "await waitFor(() => $$('[data-test=row]').length === 2)\nclick('[data-test=switch]')\nawait wait(50)\nconst warns = logs.filter((l) => l.text.includes('[Vue warn]'))\nassert(!warns.length, warns.map((l) => l.text.slice(0, 140)).join('\\n'))" },
    ],
    hints: ['Vue 3 的具名 slot 寫成 `<template #empty>`，作用域 slot 寫成 `<template #cell-status="{ value }">`。', '子元件要讓父元件決定的位置寫 `<slot name="empty">備用內容</slot>`。', '`provide(key, clinic.value)` 交出去的是當下的物件；提供 ref 本身（`readonly(clinic)`），換掉 `.value` 時後代才會更新。'],
  },
  {
    id: 'watchers-1', skill: 'watchers', kind: 'vue', level: 2,
    title: '病患搜尋：停止輸入才查，值沒變不重查',
    prompt: '櫃台的病患搜尋框 `PatientSearch` 想做成「停止輸入 300 ms 才查」，但現在連打幾個字就送出好幾個 `GET /api/patients?q=…`，多打一個空白也重查一次，切到別的頁面之後還會送出。改成：\n\n- 監看「`keyword` 去掉頭尾空白後的值」（getter），值沒變（例如只多打了空白）不觸發\n- 停止輸入 300 ms 才送出請求：callback 裡開計時器，用 `onWatcherCleanup` 登記 `clearTimeout`，300 ms 內又打字就取消上一次的計時\n- 少於 2 個字：清空結果，不送請求\n- 元件卸載時還沒送出的查詢不再送（`onWatcherCleanup` 在 watcher 停止時也會執行）\n\n搜尋框是 `<input data-test="keyword">`，每位病患一個 `<li>`，內容是 `name`；`data-test="toggle"` 切換搜尋頁與掛號頁。`GET /api/patients?q=…` 回傳 `[{ id, name }]`。',
    api: "const patients = [{ id: 1, name: '王小明' }, { id: 2, name: '王小華' }, { id: 3, name: '陳美華' }]\napi.get('/api/patients', (req) => ({ body: patients.filter((p) => p.name.includes(req.query.q || '')), delay: 50 }))",
    starter: `import { createApp, ref, watch } from 'vue'

const PatientSearch = {
  setup() {
    const keyword = ref('')
    const patients = ref([])
    watch(keyword, (value) => {
      const q = value.trim()
      if (q.length < 2) { patients.value = []; return }
      setTimeout(async () => {                        // 停止輸入 300 ms 才查
        const res = await fetch('/api/patients?q=' + encodeURIComponent(q))
        patients.value = res.ok ? await res.json() : []
      }, 300)
    })
    return { keyword, patients }
  },
  template: \`
    <input v-model="keyword" data-test="keyword" placeholder="病患姓名">
    <ul><li v-for="p in patients" :key="p.id">{{ p.name }}</li></ul>\`,
}

const App = {
  components: { PatientSearch },
  setup() { return { page: ref('search') } },
  template: \`
    <button type="button" data-test="toggle" @click="page = page === 'search' ? 'booking' : 'search'">切換頁面</button>
    <PatientSearch v-if="page === 'search'" />
    <p v-else>掛號頁</p>\`,
}

createApp(App).mount('#app')
`,
    solution: `import { createApp, ref, watch, onWatcherCleanup } from 'vue'

const PatientSearch = {
  setup() {
    const keyword = ref('')
    const patients = ref([])
    // 來源是 getter：只多打空白時 trim 後的值沒變，不會觸發
    watch(() => keyword.value.trim(), (q) => {
      if (q.length < 2) { patients.value = []; return }
      const timer = setTimeout(async () => {
        const res = await fetch('/api/patients?q=' + encodeURIComponent(q))
        patients.value = res.ok ? await res.json() : []
      }, 300)
      onWatcherCleanup(() => clearTimeout(timer))   // 下一次觸發前、或元件卸載時取消這次的計時
    })
    return { keyword, patients }
  },
  template: \`
    <input v-model="keyword" data-test="keyword" placeholder="病患姓名">
    <ul><li v-for="p in patients" :key="p.id">{{ p.name }}</li></ul>\`,
}

const App = {
  components: { PatientSearch },
  setup() { return { page: ref('search') } },
  template: \`
    <button type="button" data-test="toggle" @click="page = page === 'search' ? 'booking' : 'search'">切換頁面</button>
    <PatientSearch v-if="page === 'search'" />
    <p v-else>掛號頁</p>\`,
}

createApp(App).mount('#app')
`,
    tests: [
      { name: '連續輸入只送一次，查的是最後的字', code: "const urls = () => api.calls.map((c) => decodeURIComponent(c.url))\ninput('[data-test=keyword]', '王小')\nawait wait(100)\ninput('[data-test=keyword]', '王小明')\nawait wait(100)\ninput('[data-test=keyword]', '王小華')\nawait wait(500)\nassertEqual(urls(), ['/api/patients?q=王小華'], '送出的請求')\nassertEqual($$('li').map((li) => li.textContent.trim()), ['王小華'])" },
      { name: '停止輸入 300 ms 之後才送出', code: "input('[data-test=keyword]', '王小')\nawait wait(150)\nassertEqual(api.calls.length, 0, '150 ms 時的請求數')\nawait waitFor(() => $$('li').length === 2)\nassertEqual(api.calls.length, 1, '請求數')" },
      { name: '只多打空白不重查', code: "input('[data-test=keyword]', '王小')\nawait waitFor(() => $$('li').length === 2)\ninput('[data-test=keyword]', '王小 ')\nawait wait(450)\ninput('[data-test=keyword]', ' 王小 ')\nawait wait(450)\nassertEqual(api.calls.length, 1, '請求數')" },
      { name: '少於 2 個字清空結果、不送請求', code: "input('[data-test=keyword]', '王小')\nawait waitFor(() => $$('li').length === 2)\ninput('[data-test=keyword]', '王')\nawait tick()\nassertEqual($$('li').length, 0, '結果筆數')\nawait wait(450)\nassertEqual(api.calls.length, 1, '請求數')" },
      { name: '切到別的頁面後不再送出', code: "input('[data-test=keyword]', '王小明')\nawait wait(100)\nclick('[data-test=toggle]')\nawait wait(500)\nassertEqual(api.calls.length, 0, '卸載之後送出的請求數')" },
    ],
    hints: ['`watch(() => keyword.value.trim(), cb)`：getter 回傳的值沒變，callback 就不會執行。', '`const timer = setTimeout(…)` 之後寫 `onWatcherCleanup(() => clearTimeout(timer))`；要寫在 callback 裡、第一個 `await` 之前。'],
  },
  {
    id: 'forms-1', skill: 'forms', kind: 'vue', level: 2,
    title: '掛號表單：離開欄位才顯示錯誤，手機號碼保留開頭的 0',
    prompt: '掛號表單一打開就滿版紅字；手機欄位加了 `.number`，`0912345678` 變成 `912345678`，格式檢查永遠不過；勾一個症狀，其他症狀也跟著勾起來；錯誤只有紅字，螢幕報讀器不知道欄位有錯。改成：\n\n- 姓名 `#name`（必填，`v-model.trim`）、手機 `#phone`（必填，`09` 開頭共 10 碼，值保留字串，用 `inputmode="numeric"`）、症狀 checkbox（`value` 是 `fever`、`cough`、`rash`，至少勾一項，綁同一個陣列）\n- 欄位第一次離開（`blur`）之後才顯示錯誤，之後隨輸入更新；症狀在勾選改變後檢查；按送出時全部檢查\n- 錯誤訊息放在欄位下方，`id` 是 `name-error`、`phone-error`、`symptoms-error`；有錯的輸入框 `aria-invalid="true"`，`aria-describedby` 指向錯誤訊息的 `id`，沒錯時不指向它\n- 送出時有錯：焦點移到第一個出錯的欄位，不送請求；全部正確時送出 `POST /api/appointments`，body 是 `{ name, phone, symptoms }`\n\n錯誤文字：「請填姓名」「請填手機號碼」「手機號碼是 09 開頭、共 10 碼」「至少勾選一項症狀」。表單是 `<form novalidate>`，送出成功後顯示 `<p data-test="done">`。',
    api: "api.post('/api/appointments', (req) => ({ status: 201, body: { id: 501, ...req.body }, delay: 50 }))",
    starter: `import { createApp, reactive, ref, computed } from 'vue'

const BookingForm = {
  setup() {
    const form = reactive({ name: '', phone: '', symptoms: '' })
    const done = ref(false)
    const errors = computed(() => ({
      name: form.name ? '' : '請填姓名',
      phone: !form.phone ? '請填手機號碼' : /^09\\d{8}$/.test(form.phone) ? '' : '手機號碼是 09 開頭、共 10 碼',
      symptoms: form.symptoms.length ? '' : '至少勾選一項症狀',
    }))
    async function onSubmit() {
      if (Object.values(errors.value).some(Boolean)) return
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      done.value = res.ok
    }
    return { form, errors, done, onSubmit }
  },
  template: \`
    <form novalidate @submit.prevent="onSubmit">
      <label for="name">姓名</label>
      <input id="name" v-model.trim="form.name" autocomplete="name">
      <p v-if="errors.name" class="error">{{ errors.name }}</p>

      <label for="phone">手機</label>
      <input id="phone" v-model.number="form.phone" autocomplete="tel">
      <p v-if="errors.phone" class="error">{{ errors.phone }}</p>

      <fieldset>
        <legend>症狀</legend>
        <label><input type="checkbox" value="fever" v-model="form.symptoms"> 發燒</label>
        <label><input type="checkbox" value="cough" v-model="form.symptoms"> 咳嗽</label>
        <label><input type="checkbox" value="rash" v-model="form.symptoms"> 皮膚疹</label>
        <p v-if="errors.symptoms" class="error">{{ errors.symptoms }}</p>
      </fieldset>

      <button type="submit">送出掛號</button>
      <p v-if="done" data-test="done">已送出</p>
    </form>\`,
}

createApp(BookingForm).mount('#app')
`,
    solution: `import { createApp, reactive, ref, computed, nextTick } from 'vue'

const BookingForm = {
  setup() {
    const form = reactive({ name: '', phone: '', symptoms: [] })   // 多個 checkbox 綁同一個陣列
    const touched = reactive({ name: false, phone: false, symptoms: false })
    const submitted = ref(false)
    const done = ref(false)
    const errors = computed(() => ({
      name: form.name ? '' : '請填姓名',
      phone: !form.phone ? '請填手機號碼' : /^09\\d{8}$/.test(form.phone) ? '' : '手機號碼是 09 開頭、共 10 碼',
      symptoms: form.symptoms.length ? '' : '至少勾選一項症狀',
    }))
    // 離開過欄位、或按過送出，才顯示錯誤
    const show = (k) => ((touched[k] || submitted.value) && errors.value[k]) || ''
    const FOCUS = { name: 'name', phone: 'phone', symptoms: 'symptom-fever' }

    async function onSubmit() {
      submitted.value = true
      const first = ['name', 'phone', 'symptoms'].find((k) => errors.value[k])
      if (first) {
        await nextTick()                                   // 等錯誤訊息畫出來再移焦點
        document.getElementById(FOCUS[first]).focus()
        return
      }
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      done.value = res.ok
    }
    return { form, touched, show, done, onSubmit }
  },
  template: \`
    <form novalidate @submit.prevent="onSubmit">
      <label for="name">姓名</label>
      <input id="name" v-model.trim="form.name" autocomplete="name" @blur="touched.name = true"
             :aria-invalid="show('name') ? 'true' : 'false'" :aria-describedby="show('name') ? 'name-error' : undefined">
      <p v-if="show('name')" id="name-error" class="error">{{ show('name') }}</p>

      <label for="phone">手機</label>
      <input id="phone" v-model="form.phone" inputmode="numeric" autocomplete="tel" maxlength="10" @blur="touched.phone = true"
             :aria-invalid="show('phone') ? 'true' : 'false'" :aria-describedby="show('phone') ? 'phone-error' : undefined">
      <p v-if="show('phone')" id="phone-error" class="error">{{ show('phone') }}</p>

      <fieldset :aria-describedby="show('symptoms') ? 'symptoms-error' : undefined">
        <legend>症狀</legend>
        <label><input id="symptom-fever" type="checkbox" value="fever" v-model="form.symptoms" @change="touched.symptoms = true"> 發燒</label>
        <label><input type="checkbox" value="cough" v-model="form.symptoms" @change="touched.symptoms = true"> 咳嗽</label>
        <label><input type="checkbox" value="rash" v-model="form.symptoms" @change="touched.symptoms = true"> 皮膚疹</label>
        <p v-if="show('symptoms')" id="symptoms-error" class="error">{{ show('symptoms') }}</p>
      </fieldset>

      <button type="submit">送出掛號</button>
      <p v-if="done" data-test="done">已送出</p>
    </form>\`,
}

createApp(BookingForm).mount('#app')
`,
    tests: [
      { name: '一開始沒有錯誤，離開姓名欄後才顯示', code: "await waitFor(() => $('#name'))\nassert(!$('#name-error') && !text('form').includes('請填'), '還沒填就出現錯誤：' + $$('.error').map((e) => e.textContent.trim()).join('、'))\nassert($('#name').getAttribute('aria-invalid') !== 'true', '還沒離開過的欄位不能是 aria-invalid=\"true\"')\nfocus('#name')\n$('#name').blur()\nawait tick()\nassertEqual(text('#name-error'), '請填姓名', '離開姓名欄之後')" },
      { name: '有錯的欄位：aria-invalid 與 aria-describedby 指向錯誤訊息', code: "await waitFor(() => $('#phone'))\nfocus('#phone')\ninput('#phone', '0912')\n$('#phone').blur()\nawait tick()\nassertEqual(text('#phone-error'), '手機號碼是 09 開頭、共 10 碼', '#phone-error')\nassertEqual($('#phone').getAttribute('aria-invalid'), 'true', '#phone 的 aria-invalid')\nassertEqual($('#phone').getAttribute('aria-describedby'), 'phone-error', '#phone 的 aria-describedby')\ninput('#phone', '0912345678')\nawait tick()\nassert(!$('#phone-error'), '改正之後錯誤要消失')\nassert($('#phone').getAttribute('aria-invalid') !== 'true', '改正之後不能還是 aria-invalid=\"true\"')\nassert(!($('#phone').getAttribute('aria-describedby') || '').includes('phone-error'), '改正之後 aria-describedby 不能再指向錯誤訊息')" },
      { name: '全空按送出：顯示全部錯誤、焦點在姓名欄、不送請求', code: "await waitFor(() => $('form'))\n// 同時跑的測試 iframe 會互搶焦點：記下這個 iframe 裡最後得到焦點的元素\nconst focused = []\ndocument.addEventListener('focusin', (e) => focused.push(e.target.id || e.target.tagName))\nsubmit('form')\nawait wait(50)\nassertEqual(['#name-error', '#phone-error', '#symptoms-error'].map((s) => text(s)), ['請填姓名', '請填手機號碼', '至少勾選一項症狀'], '錯誤訊息')\nassertEqual(focused[focused.length - 1], 'name', '送出後得到焦點的元素 id')\nassertEqual(api.calls.length, 0, '請求數')" },
      { name: '勾一個症狀不會連帶勾其他的', code: "await waitFor(() => $('input[value=fever]'))\ncheck('input[value=fever]')\nawait tick()\nassertEqual($$('input[type=checkbox]').map((c) => c.checked), [true, false, false], '三個症狀的勾選狀態')" },
      { name: '全部正確：送出的手機號碼保留開頭的 0，症狀是陣列', code: "await waitFor(() => $('#name'))\ninput('#name', '  王小明 ')\ninput('#phone', '0912345678')\ncheck('input[value=fever]')\nawait tick()\ncheck('input[value=rash]')\nawait tick()\nsubmit('form')\nawait waitFor(() => $('[data-test=done]'))\nassertEqual(api.calls.map((c) => c.body), [{ name: '王小明', phone: '0912345678', symptoms: ['fever', 'rash'] }], '送出的 body')" },
    ],
    hints: ['用一個 `touched` 物件記住離開過的欄位，`show(k)` 在「離開過或送出過」而且有錯時才回傳訊息。', '`.number` 用 `parseFloat` 轉數字，開頭的 0 會不見；手機號碼保留字串，`inputmode="numeric"` 叫出數字鍵盤。', '`<form novalidate>` 不會幫你移焦點：送出時 `await nextTick()` 再對第一個出錯的欄位呼叫 `focus()`。'],
  },
  {
    id: 'composables-1', skill: 'composables', kind: 'vue', level: 2,
    title: '抽出 useFetch：回傳 ref、每個元件一份、網址變了就重抓',
    prompt: '兩個科別的時段清單都用 `useFetch` 抓資料。現在兩個清單都停在空的；就算資料回來，兩個清單也會顯示同一份；改日期不會重抓；500 的錯誤頁被當成 JSON 解析。改寫 `useFetch(url)`（元件的程式不用改）：\n\n- 回傳一般物件 `{ data, error, loading, refresh }`，每個值都是 ref（元件會解構）\n- 狀態宣告在函式裡面：每呼叫一次各自一份\n- `url` 可以是字串、ref 或 getter：在 `watchEffect` 裡用 `toValue(url)` 取網址，網址變了就重抓，並用 `onWatcherCleanup` 取消上一個請求（被取消的不算錯誤）\n- `res.ok` 為 `false` 時 `error` 設成 `\'HTTP \' + 狀態碼`，例如 `HTTP 500`；`refresh()` 重抓一次\n\n每個清單是 `<section data-test="list-科別">`，裡面有日期 `<select data-test="date">`、錯誤 `data-test="error"`、重試 `data-test="retry"`，每個時段一個 `<li>`。`GET /api/slots?dept=…&date=…` 回傳 `[{ id, time }]`。',
    api: "const slots = { '內科|2026-11-20': ['09:00', '09:30'], '內科|2026-11-21': ['14:00'], '骨科|2026-11-20': ['10:00', '10:30', '11:00'], '骨科|2026-11-21': [] }\napi.get('/api/slots', (req) => ({ body: (slots[req.query.dept + '|' + req.query.date] || []).map((time, i) => ({ id: i + 1, time })), delay: 50 }))",
    starter: `import { createApp, ref, reactive, onMounted, toValue } from 'vue'

// ── useFetch ──
const data = ref(null)
const error = ref(null)
const loading = ref(false)

function useFetch(url) {
  async function load() {
    loading.value = true
    error.value = null
    try {
      const res = await fetch(toValue(url))
      data.value = await res.json()
    } catch (e) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }
  onMounted(load)
  return reactive({ data, error, loading, refresh: load })
}

// ── 元件（不用改） ──
const SlotList = {
  props: { dept: { type: String, required: true } },
  setup(props) {
    const date = ref('2026-11-20')
    const { data: slots, error, loading, refresh } = useFetch(() => \`/api/slots?dept=\${props.dept}&date=\${date.value}\`)
    return { date, slots, error, loading, refresh }
  },
  template: \`
    <section :data-test="'list-' + dept">
      <h2>{{ dept }}</h2>
      <select v-model="date" data-test="date">
        <option>2026-11-20</option>
        <option>2026-11-21</option>
      </select>
      <p v-if="loading">載入中…</p>
      <p v-else-if="error" data-test="error">無法載入（{{ error }}）<button type="button" data-test="retry" @click="refresh">重試</button></p>
      <ul v-else><li v-for="s in slots ?? []" :key="s.id">{{ s.time }}</li></ul>
    </section>\`,
}

createApp({ components: { SlotList }, template: '<SlotList dept="內科" /><SlotList dept="骨科" />' }).mount('#app')
`,
    solution: `import { createApp, ref, shallowRef, watchEffect, toValue, onWatcherCleanup } from 'vue'

// ── useFetch ──
function useFetch(url) {
  // 宣告在函式裡：每個元件各自一份
  const data = shallowRef(null)
  const error = ref(null)
  const loading = ref(false)
  const version = ref(0)                       // 改它就重抓一次

  watchEffect(async () => {
    version.value                              // 讀一次：refresh() 會觸發重新執行
    const target = toValue(url)                // 在 watchEffect 裡讀，getter 用到的 date 才會被追蹤
    const controller = new AbortController()
    onWatcherCleanup(() => controller.abort()) // 下一次執行前取消這次的請求；要在 await 之前
    loading.value = true
    error.value = null
    try {
      const res = await fetch(target, { signal: controller.signal })
      if (!res.ok) throw new Error('HTTP ' + res.status)   // 4xx、5xx 不會讓 fetch reject
      data.value = await res.json()
    } catch (e) {
      if (e.name === 'AbortError') return      // 被取消：不改狀態
      error.value = e.message
    } finally {
      if (!controller.signal.aborted) loading.value = false
    }
  })

  return { data, error, loading, refresh: () => { version.value++ } }
}

// ── 元件（不用改） ──
const SlotList = {
  props: { dept: { type: String, required: true } },
  setup(props) {
    const date = ref('2026-11-20')
    const { data: slots, error, loading, refresh } = useFetch(() => \`/api/slots?dept=\${props.dept}&date=\${date.value}\`)
    return { date, slots, error, loading, refresh }
  },
  template: \`
    <section :data-test="'list-' + dept">
      <h2>{{ dept }}</h2>
      <select v-model="date" data-test="date">
        <option>2026-11-20</option>
        <option>2026-11-21</option>
      </select>
      <p v-if="loading">載入中…</p>
      <p v-else-if="error" data-test="error">無法載入（{{ error }}）<button type="button" data-test="retry" @click="refresh">重試</button></p>
      <ul v-else><li v-for="s in slots ?? []" :key="s.id">{{ s.time }}</li></ul>
    </section>\`,
}

createApp({ components: { SlotList }, template: '<SlotList dept="內科" /><SlotList dept="骨科" />' }).mount('#app')
`,
    tests: [
      { name: '資料回來後列出時段', code: "const times = (d) => $$('[data-test=list-' + d + '] li').map((li) => li.textContent.trim())\nawait wait(200)\nassertEqual(times('內科'), ['09:00', '09:30'], '內科的時段')" },
      { name: '兩個清單各自一份資料', code: "const times = (d) => $$('[data-test=list-' + d + '] li').map((li) => li.textContent.trim())\nawait wait(200)\nassertEqual([times('內科'), times('骨科')], [['09:00', '09:30'], ['10:00', '10:30', '11:00']], '內科與骨科的時段')" },
      { name: '改日期就重抓，另一個清單不受影響', code: "const times = (d) => $$('[data-test=list-' + d + '] li').map((li) => li.textContent.trim())\nawait wait(200)\nselect('[data-test=list-內科] [data-test=date]', '2026-11-21')\nawait wait(200)\nassert(api.calls.some((c) => decodeURIComponent(c.url) === '/api/slots?dept=內科&date=2026-11-21'), '改日期後要送出 date=2026-11-21 的請求')\nassertEqual([times('內科'), times('骨科')], [['14:00'], ['10:00', '10:30', '11:00']], '內科與骨科的時段')" },
      { name: '500 時顯示 HTTP 500，按重試再抓', api: "let n = 0\napi.get('/api/slots', (req) => (req.query.dept === '骨科' && n++ === 0 ? { status: 500, headers: { 'Content-Type': 'text/html' }, body: '<h1>500</h1>', delay: 50 } : { body: [{ id: 1, time: '10:00' }], delay: 50 }))", code: "await wait(200)\nassertEqual(text('[data-test=list-骨科] [data-test=error]'), '無法載入（HTTP 500）重試', '骨科的錯誤')\nclick('[data-test=list-骨科] [data-test=retry]')\nawait wait(200)\nassertEqual($$('[data-test=list-骨科] li').map((li) => li.textContent.trim()), ['10:00'], '重試之後骨科的時段')" },
    ],
    hints: ['`reactive({ data })` 解構出來的是當下的值；回傳 `{ data }` 讓元件拿到 ref 本身。', '寫在函式外面（模組頂層）的 `ref`，所有呼叫的元件共用同一份。', '`onMounted(load)` 只抓一次；`watchEffect` 裡呼叫 `toValue(url)`，getter 讀到的 `date` 一變就重新執行。'],
  },
  {
    id: 'pinia-1', skill: 'pinia', kind: 'vue', level: 2,
    title: '登入後頁首還是「訪客」：解構 store 要用 storeToRefs',
    prompt: '門診系統用 Pinia 的 setup store 管登入狀態。現在登入成功，頁首仍然顯示「訪客」、也沒有「登出」；登出之後，下一位登入的人還看得到上一位醫師的病人清單。改成：\n\n- `useSessionStore`：`user`（`ref`）、`isDoctor`（`computed`）、`login(account)`、`logout()`，全部 `return`\n- 頁首 `AppHeader` 用 `storeToRefs(session)` 讀 `user`、`isDoctor`，action 直接從 store 拿；顯示「林醫師（醫師）」「陳護理師」，沒登入時是「訪客」\n- `logout()` 清掉 `user`，並清空 `usePatientsStore` 的清單：setup store 沒有內建的 `$reset()`，自己寫一個 `reset()`\n\n沙箱裡的 Pinia 是正式建置版：對 setup store 呼叫 `$reset()` 什麼都不做（開發模式會丟出 `Store "patients" is built using the setup syntax and does not implement $reset().`）。頁首是 `data-test="who"` 與 `data-test="logout"`，登入按鈕是 `data-test="login-doctor1"`、`login-nurse1`、`login-doctor2`，病人清單每人一個 `<li data-test="patient">`，醫師才看得到 `data-test="prescribe"`。`POST /api/login` 收 `{ account }` 回傳 `{ id, name, role }`，`GET /api/patients?doctor_id=…` 回傳那位醫師的病人。',
    api: "const users = { doctor1: { id: 1, name: '林醫師', role: 'doctor' }, doctor2: { id: 2, name: '張醫師', role: 'doctor' }, nurse1: { id: 3, name: '陳護理師', role: 'nurse' } }\nconst patients = { 1: [{ id: 11, name: '王小明' }, { id: 12, name: '陳美華' }], 2: [{ id: 21, name: '李大同' }] }\napi.post('/api/login', (req) => (users[req.body.account] ? { body: users[req.body.account], delay: 30 } : { status: 401, body: api.problem(401, '帳號或密碼錯誤') }))\napi.get('/api/patients', (req) => ({ body: patients[req.query.doctor_id] || [], delay: 200 }))",
    starter: `import { createApp, ref, computed } from 'vue'
import { createPinia, defineStore, storeToRefs } from 'pinia'

const usePatientsStore = defineStore('patients', () => {
  const list = ref([])
  async function load(doctorId) {
    const res = await fetch('/api/patients?doctor_id=' + doctorId)
    list.value = res.ok ? await res.json() : []
  }
  return { list, load }
})

const useSessionStore = defineStore('session', () => {
  const user = ref(null)
  const isDoctor = computed(() => user.value?.role === 'doctor')
  async function login(account) {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account }),
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    user.value = await res.json()
    if (isDoctor.value) usePatientsStore().load(user.value.id)
  }
  function logout() {
    user.value = null
    usePatientsStore().$reset()
  }
  return { user, isDoctor, login, logout }
})

const AppHeader = {
  setup() {
    const session = useSessionStore()
    const { user, isDoctor, logout } = session
    return { user, isDoctor, logout }
  },
  template: \`
    <header>
      <span data-test="who">{{ user ? user.name + (isDoctor ? '（醫師）' : '') : '訪客' }}</span>
      <button v-if="user" type="button" data-test="logout" @click="logout">登出</button>
    </header>\`,
}

const LoginBar = {
  setup() {
    const session = useSessionStore()
    return { login: (account) => session.login(account) }
  },
  template: \`
    <p>
      <button type="button" data-test="login-doctor1" @click="login('doctor1')">林醫師登入</button>
      <button type="button" data-test="login-nurse1" @click="login('nurse1')">陳護理師登入</button>
      <button type="button" data-test="login-doctor2" @click="login('doctor2')">張醫師登入</button>
    </p>\`,
}

const PatientPanel = {
  setup() {
    const { isDoctor } = storeToRefs(useSessionStore())
    const { list } = storeToRefs(usePatientsStore())
    return { isDoctor, list }
  },
  template: \`
    <section>
      <button v-if="isDoctor" type="button" data-test="prescribe">開立處方</button>
      <ul><li v-for="p in list" :key="p.id" data-test="patient">{{ p.name }}</li></ul>
    </section>\`,
}

createApp({ components: { AppHeader, LoginBar, PatientPanel }, template: '<AppHeader /><LoginBar /><PatientPanel />' })
  .use(createPinia())
  .mount('#app')
`,
    solution: `import { createApp, ref, computed } from 'vue'
import { createPinia, defineStore, storeToRefs } from 'pinia'

const usePatientsStore = defineStore('patients', () => {
  const list = ref([])
  async function load(doctorId) {
    const res = await fetch('/api/patients?doctor_id=' + doctorId)
    list.value = res.ok ? await res.json() : []
  }
  function reset() { list.value = [] }        // setup store 沒有 $reset，自己寫
  return { list, load, reset }
})

const useSessionStore = defineStore('session', () => {
  const user = ref(null)
  const isDoctor = computed(() => user.value?.role === 'doctor')
  async function login(account) {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account }),
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    user.value = await res.json()
    if (isDoctor.value) usePatientsStore().load(user.value.id)
  }
  function logout() {
    user.value = null
    usePatientsStore().reset()                // 上一位醫師的病人清單一起清掉
  }
  return { user, isDoctor, login, logout }
})

const AppHeader = {
  setup() {
    const session = useSessionStore()
    const { user, isDoctor } = storeToRefs(session)   // state 與 getter：轉成 ref，連著 store
    const { logout } = session                         // action 直接拿
    return { user, isDoctor, logout }
  },
  template: \`
    <header>
      <span data-test="who">{{ user ? user.name + (isDoctor ? '（醫師）' : '') : '訪客' }}</span>
      <button v-if="user" type="button" data-test="logout" @click="logout">登出</button>
    </header>\`,
}

const LoginBar = {
  setup() {
    const session = useSessionStore()
    return { login: (account) => session.login(account) }
  },
  template: \`
    <p>
      <button type="button" data-test="login-doctor1" @click="login('doctor1')">林醫師登入</button>
      <button type="button" data-test="login-nurse1" @click="login('nurse1')">陳護理師登入</button>
      <button type="button" data-test="login-doctor2" @click="login('doctor2')">張醫師登入</button>
    </p>\`,
}

const PatientPanel = {
  setup() {
    const { isDoctor } = storeToRefs(useSessionStore())
    const { list } = storeToRefs(usePatientsStore())
    return { isDoctor, list }
  },
  template: \`
    <section>
      <button v-if="isDoctor" type="button" data-test="prescribe">開立處方</button>
      <ul><li v-for="p in list" :key="p.id" data-test="patient">{{ p.name }}</li></ul>
    </section>\`,
}

createApp({ components: { AppHeader, LoginBar, PatientPanel }, template: '<AppHeader /><LoginBar /><PatientPanel />' })
  .use(createPinia())
  .mount('#app')
`,
    tests: [
      { name: '醫師登入後頁首顯示「林醫師（醫師）」', code: "click('[data-test=login-doctor1]')\nawait waitFor(() => $('[data-test=prescribe]'))\nassertEqual(text('[data-test=who]'), '林醫師（醫師）', '頁首')\nassert($('[data-test=logout]'), '登入後頁首要有「登出」')" },
      { name: '護理師登入：頁首沒有（醫師），看不到開立處方', code: "click('[data-test=login-nurse1]')\nawait wait(150)\nassertEqual(text('[data-test=who]'), '陳護理師', '頁首')\nassert(!$('[data-test=prescribe]'), '護理師不能看到「開立處方」')" },
      { name: '登出後回到訪客，病人清單清空', code: "click('[data-test=login-doctor1]')\nawait waitFor(() => $$('[data-test=patient]').length === 2)\nawait waitFor(() => $('[data-test=logout]'), { timeout: 500 })\nclick('[data-test=logout]')\nawait tick()\nassertEqual(text('[data-test=who]'), '訪客', '頁首')\nassertEqual($$('[data-test=patient]').map((li) => li.textContent.trim()), [], '登出後的病人清單')" },
      { name: '換另一位醫師登入，不會先看到上一位的病人', code: "click('[data-test=login-doctor1]')\nawait waitFor(() => $$('[data-test=patient]').length === 2)\nawait waitFor(() => $('[data-test=logout]'), { timeout: 500 })\nclick('[data-test=logout]')\nclick('[data-test=login-doctor2]')\nawait wait(100)\nassertEqual($$('[data-test=patient]').map((li) => li.textContent.trim()), [], '張醫師的病人回來之前的清單')\nawait waitFor(() => $$('[data-test=patient]').length === 1)\nassertEqual(text('[data-test=patient]'), '李大同')" },
    ],
    hints: ['store 是 reactive 物件，`const { user } = session` 拿到的是當下的 `null`；`storeToRefs(session)` 才會跟著變。', '`storeToRefs` 只轉 state 與 getter，action 直接從 store 解構或呼叫。', 'setup store 的重設要自己寫：`function reset() { list.value = [] }` 並且 `return`。'],
  },
  {
    id: 'vue-router-1', skill: 'vue-router', kind: 'vue', level: 2,
    title: '病人頁：換病人要重抓，登入後回到原本的頁面',
    prompt: '門診系統的路由有兩個問題：沒登入時打開病人頁被導到 `/login`，登入後卻回到首頁；病人頁點「下一位病人」，網址變成 `/patients/8`，畫面還是 7 號病人。改成：\n\n- `router.beforeEach` 不用 `next`，用回傳值：`meta.requiresAuth` 的路由沒登入時回傳 `{ path: \'/login\', query: { redirect: to.fullPath } }`；不需要登入的路由直接放行（`/login` 不能再導向 `/login`）\n- 登入頁成功後讀 `route.query.redirect`：是 `/` 開頭、不是 `//` 開頭的字串就 `router.replace` 過去，否則回 `/`；用 `replace`，按上一頁不會回到登入頁\n- `PatientPage` 用 `props: true` 收 `id`，`watch(() => props.id, load, { immediate: true })` 在換病人時重抓 `GET /api/patients/:id`\n\n沙箱的網址是 `about:srcdoc`，router 一律用 `createMemoryHistory()`（`createWebHistory`、`createWebHashHistory` 會讓 iframe 換頁）；網址不在網址列上，頁面用 `data-test="path"` 顯示 `route.fullPath`。沙箱裡的 Vue Router 是正式建置版，`next` 的棄用警告與無窮導向的警告都不會出現；守衛一直導向時，沙箱會中止並顯示錯誤。連結是 `data-test="to-patient-7"`、`data-test="next"`，登入按鈕 `data-test="login"`，上一頁 `data-test="back"`，病人姓名 `data-test="patient-name"`。',
    api: "const patients = { 7: '王小明', 8: '陳美華', 9: '李大同' }\napi.get('/api/patients/:id', (req) => (patients[req.params.id] ? { body: { id: Number(req.params.id), name: patients[req.params.id] }, delay: 50 } : { status: 404, body: api.problem(404, '找不到病人') }))",
    starter: `import { createApp, ref, onMounted } from 'vue'
import { createRouter, createMemoryHistory, RouterLink, RouterView, useRoute, useRouter } from 'vue-router'

const loggedIn = ref(false)

const HomePage = { template: '<p>首頁</p>' }

const LoginPage = {
  setup() {
    const route = useRoute()
    const router = useRouter()
    function login() {
      loggedIn.value = true
      router.push(route.query.redirect || '/')
    }
    return { login }
  },
  template: '<button type="button" data-test="login" @click="login">登入</button>',
}

const PatientPage = {
  setup() {
    const route = useRoute()
    const patient = ref(null)
    onMounted(async () => {
      const res = await fetch('/api/patients/' + route.params.id)
      patient.value = res.ok ? await res.json() : null
    })
    return { route, patient }
  },
  template: \`
    <h2 data-test="patient-name">{{ patient ? patient.name : '載入中…' }}</h2>
    <RouterLink :to="'/patients/' + (Number(route.params.id) + 1)" data-test="next">下一位病人</RouterLink>\`,
}

const router = createRouter({
  history: createMemoryHistory(),     // 沙箱的網址是 about:srcdoc
  routes: [
    { path: '/', component: HomePage },
    { path: '/login', component: LoginPage },
    { path: '/patients/:id', component: PatientPage, meta: { requiresAuth: true } },
  ],
})

router.beforeEach((to, from, next) => {
  if (to.meta.requiresAuth && !loggedIn.value) next('/login')
  else next()
})

const App = {
  setup() {
    const route = useRoute()
    const router = useRouter()
    return { route, back: () => router.back() }
  },
  template: \`
    <nav>
      <RouterLink to="/patients/7" data-test="to-patient-7">7 號病人</RouterLink>
      <button type="button" data-test="back" @click="back">上一頁</button>
    </nav>
    <p data-test="path">{{ route.fullPath }}</p>
    <RouterView />\`,
}

createApp(App).use(router).mount('#app')
`,
    solution: `import { createApp, ref, watch } from 'vue'
import { createRouter, createMemoryHistory, RouterLink, RouterView, useRoute, useRouter } from 'vue-router'

const loggedIn = ref(false)

const HomePage = { template: '<p>首頁</p>' }

const LoginPage = {
  setup() {
    const route = useRoute()
    const router = useRouter()
    function login() {
      loggedIn.value = true
      const r = route.query.redirect
      // 只接受站內路徑；//evil.example 會被當成另一個網域
      const target = typeof r === 'string' && r.startsWith('/') && !r.startsWith('//') ? r : '/'
      router.replace(target)          // replace：上一頁不會回到登入頁
    }
    return { login }
  },
  template: '<button type="button" data-test="login" @click="login">登入</button>',
}

const PatientPage = {
  props: { id: { type: String, required: true } },   // props: true，params 是字串
  setup(props) {
    const patient = ref(null)
    // /patients/7 到 /patients/8 用同一個元件實例，onMounted 不會再跑：監看 id
    watch(() => props.id, async (id) => {
      patient.value = null
      const res = await fetch('/api/patients/' + id)
      patient.value = res.ok ? await res.json() : null
    }, { immediate: true })
    return { patient }
  },
  template: \`
    <h2 data-test="patient-name">{{ patient ? patient.name : '載入中…' }}</h2>
    <RouterLink :to="'/patients/' + (Number(id) + 1)" data-test="next">下一位病人</RouterLink>\`,
}

const router = createRouter({
  history: createMemoryHistory(),     // 沙箱的網址是 about:srcdoc
  routes: [
    { path: '/', component: HomePage },
    { path: '/login', component: LoginPage },
    { path: '/patients/:id', component: PatientPage, props: true, meta: { requiresAuth: true } },
  ],
})

// 用回傳值決定去向：不回傳就放行
router.beforeEach((to) => {
  if (!to.meta.requiresAuth) return
  if (!loggedIn.value) return { path: '/login', query: { redirect: to.fullPath } }
})

const App = {
  setup() {
    const route = useRoute()
    const router = useRouter()
    return { route, back: () => router.back() }
  },
  template: \`
    <nav>
      <RouterLink to="/patients/7" data-test="to-patient-7">7 號病人</RouterLink>
      <button type="button" data-test="back" @click="back">上一頁</button>
    </nav>
    <p data-test="path">{{ route.fullPath }}</p>
    <RouterView />\`,
}

createApp(App).use(router).mount('#app')
`,
    tests: [
      { name: '沒登入打開病人頁：導到 /login 並帶上 redirect', code: "await waitFor(() => text('[data-test=path]') === '/')\nclick('[data-test=to-patient-7]')\nawait wait(50)\nassertEqual(decodeURIComponent(text('[data-test=path]')), '/login?redirect=/patients/7', '目前的路徑')" },
      { name: '登入後回到原本的病人頁，上一頁不會回到登入頁', code: "await waitFor(() => text('[data-test=path]') === '/')\nclick('[data-test=to-patient-7]')\nawait waitFor(() => $('[data-test=login]'))\nclick('[data-test=login]')\nawait waitFor(() => text('[data-test=patient-name]') === '王小明', { timeout: 1000 }).catch(() => {})\nassertEqual(text('[data-test=path]'), '/patients/7', '登入後的路徑')\nassertEqual(text('[data-test=patient-name]'), '王小明', '病人姓名')\nclick('[data-test=back]')\nawait wait(50)\nassertEqual(text('[data-test=path]'), '/', '按上一頁之後的路徑')" },
      { name: '換病人時重新載入', code: "await waitFor(() => text('[data-test=path]') === '/')\nclick('[data-test=to-patient-7]')\nawait waitFor(() => $('[data-test=login]'))\nclick('[data-test=login]')\nawait waitFor(() => $('[data-test=next]'))\nawait wait(100)\nclick('[data-test=next]')\nawait wait(50)\nassertEqual(text('[data-test=path]'), '/patients/8', '路徑')\nawait waitFor(() => text('[data-test=patient-name]') === '陳美華', { timeout: 1000 }).catch(() => {})\nassertEqual(text('[data-test=patient-name]'), '陳美華', '點「下一位病人」之後的姓名')" },
    ],
    hints: ['守衛回傳位置就是導向，不回傳就放行；把 `next` 參數整個刪掉。', '`redirect` 要在導向時就放進 query：`{ path: \'/login\', query: { redirect: to.fullPath } }`。', '同一個元件換參數時 `onMounted` 不會再跑：`watch(() => props.id, load, { immediate: true })`。'],
  },
]

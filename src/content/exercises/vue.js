// 程式題：元件與框架（Vue 3，在沙箱 iframe 裡執行，見 src/runtime/frame.js）
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
]

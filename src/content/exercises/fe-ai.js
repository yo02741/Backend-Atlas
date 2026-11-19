// 程式題：用 AI 寫前端（Vue 3，在沙箱 iframe 裡執行）
export default [
  {
    id: 'ai-common-mistakes-1', skill: 'ai-common-mistakes', kind: 'vue', level: 3,
    title: '修好一段 AI 產生的預約清單',
    prompt: 'AI 產生的 `AppointmentList` 混了 Vue 2 的寫法、不存在的 API 與幾個 Vue 3 會出錯的寫法。修好它（上層 `App` 也可以改），讓：\n\n- Console 沒有 `[Vue warn]` 與錯誤\n- 一進頁面就列出未取消的預約（每筆一個 `<li>`，顯示姓名）；在 `data-test="keyword"` 輸入姓名會篩選\n- 按「取消」送出 `POST /api/appointments/{id}/cancel`，成功後才從清單移除，由持有清單的 `App` 移除（子元件不改 props）；失敗時那一列留著，`role="alert"` 的元素顯示「取消失敗」\n- 備註 `note` 當純文字顯示\n- 清單卸載後不再發出 `refresh`（`data-test="toggle"` 會卸載清單，`data-test="refreshes"` 是 `App` 收到的次數）',
    api: "api.post('/api/appointments/:id/cancel', (req) => ({ body: { id: Number(req.params.id), status: 'cancelled' } }))",
    starter: `import { createApp, ref, watch, useFetch } from 'vue'

const REFRESH_MS = 200   // 題目縮短成 0.2 秒，實際是 30 秒

const AppointmentList = {
  props: ['appointments'],
  setup(props) {
    const keyword = ref('')
    const filtered = ref([])
    watch(keyword, () => {
      filtered.value = props.appointments.filter((a) => a.name.includes(keyword.value))
    })
    function cancel(a) {
      props.appointments.splice(props.appointments.indexOf(a), 1)
      fetch(\`/api/appointments/\${a.id}/cancel\`, { method: 'POST' })
    }
    return { keyword, filtered, cancel }
  },
  data() { return { timer: null } },
  mounted() { this.timer = setInterval(() => this.$emit('refresh'), REFRESH_MS) },
  beforeDestroy() { clearInterval(this.timer) },
  template: \`
    <input v-model="keyword" data-test="keyword" placeholder="病患姓名">
    <ul>
      <li v-for="(a, i) in filtered" :key="i" v-if="a.status !== 'cancelled'">
        {{ a.name | upper }}
        <span class="note" v-html="a.note"></span>
        <button @click="cancel(a)">取消</button>
      </li>
    </ul>\`,
}

const App = {
  components: { AppointmentList },
  setup() {
    const appointments = ref([
      { id: 1, name: '王小明', status: 'booked', note: '' },
      { id: 2, name: '陳美華', status: 'booked', note: '<b>需要輪椅</b>' },
      { id: 3, name: '林志明', status: 'cancelled', note: '' },
    ])
    const refreshes = ref(0)
    const show = ref(true)
    return { appointments, refreshes, show }
  },
  template: \`
    <button type="button" data-test="toggle" @click="show = !show">切換</button>
    <p data-test="refreshes">{{ refreshes }}</p>
    <AppointmentList v-if="show" :appointments="appointments" @refresh="refreshes++" />\`,
}

createApp(App).mount('#app')
`,
    solution: `import { createApp, ref, computed, onMounted, onUnmounted } from 'vue'

const REFRESH_MS = 200   // 題目縮短成 0.2 秒，實際是 30 秒

const AppointmentList = {
  props: { appointments: { type: Array, required: true } },
  emits: ['refresh', 'cancelled'],
  setup(props, { emit }) {
    const keyword = ref('')
    const error = ref('')
    // 篩選用 computed：第一次就有結果，appointments 變了也會重算
    const filtered = computed(() => props.appointments.filter((a) => a.status !== 'cancelled' && a.name.includes(keyword.value)))

    async function cancel(a) {
      error.value = ''
      try {
        const res = await fetch(\`/api/appointments/\${a.id}/cancel\`, { method: 'POST' })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        emit('cancelled', a.id)          // 成功才通知上層移除，子元件不改 props
      } catch {
        error.value = '取消失敗'
      }
    }

    let timer = null
    onMounted(() => { timer = setInterval(() => emit('refresh'), REFRESH_MS) })
    onUnmounted(() => clearInterval(timer))   // Vue 3 的名字是 unmounted，不是 beforeDestroy
    return { keyword, error, filtered, cancel }
  },
  template: \`
    <input v-model="keyword" data-test="keyword" placeholder="病患姓名">
    <p v-if="error" role="alert">{{ error }}</p>
    <ul>
      <li v-for="a in filtered" :key="a.id">
        {{ a.name.toUpperCase() }}
        <span class="note">{{ a.note }}</span>
        <button type="button" @click="cancel(a)">取消</button>
      </li>
    </ul>\`,
}

const App = {
  components: { AppointmentList },
  setup() {
    const appointments = ref([
      { id: 1, name: '王小明', status: 'booked', note: '' },
      { id: 2, name: '陳美華', status: 'booked', note: '<b>需要輪椅</b>' },
      { id: 3, name: '林志明', status: 'cancelled', note: '' },
    ])
    const refreshes = ref(0)
    const show = ref(true)
    function remove(id) {
      appointments.value = appointments.value.filter((a) => a.id !== id)
    }
    return { appointments, refreshes, show, remove }
  },
  template: \`
    <button type="button" data-test="toggle" @click="show = !show">切換</button>
    <p data-test="refreshes">{{ refreshes }}</p>
    <AppointmentList v-if="show" :appointments="appointments" @refresh="refreshes++" @cancelled="remove" />\`,
}

createApp(App).mount('#app')
`,
    tests: [
      { name: '一進頁面就列出未取消的預約，搜尋會篩選', code: "await waitFor(() => $$('li').length === 2)\nassert(text('#app').includes('王小明') && text('#app').includes('陳美華'), '要列出王小明與陳美華')\ninput('[data-test=keyword]', '陳')\nawait tick()\nassertEqual($$('li').length, 1, '搜尋「陳」之後的筆數')" },
      { name: '取消成功後才移除', code: "await waitFor(() => $$('li').length === 2)\nclick($$('li')[0].querySelector('button'))\nawait tick()\nassertEqual($$('li').length, 2, '伺服器回應前不能先移除')\nawait waitFor(() => $$('li').length === 1)\nassertEqual(api.calls.filter((c) => c.method === 'POST').map((c) => c.url), ['/api/appointments/1/cancel'])" },
      { name: '取消失敗：那一列留著，顯示「取消失敗」', api: "api.post('/api/appointments/:id/cancel', { status: 409, body: api.problem(409, '已過可取消時間'), delay: 50 })", code: "await waitFor(() => $$('li').length === 2)\nclick($$('li')[0].querySelector('button'))\nawait waitFor(() => $('[role=alert]'))\nassertEqual(text('[role=alert]'), '取消失敗')\nassertEqual($$('li').length, 2, '取消失敗時那一列要留著')" },
      { name: '備註當純文字顯示', code: "await waitFor(() => $$('li').length === 2)\nassert(!$('li b'), '備註裡的 <b> 被當成 HTML 了')\nassert(text('#app').includes('<b>需要輪椅</b>'), '備註要原樣顯示成文字')" },
      { name: '卸載後不再發出 refresh', code: "await waitFor(() => Number(text('[data-test=refreshes]')) >= 1)\nclick('[data-test=toggle]')\nawait tick()\nconst n = Number(text('[data-test=refreshes]'))\nawait wait(500)\nassertEqual(Number(text('[data-test=refreshes]')), n, '卸載後 refresh 的次數')" },
      { name: 'Console 沒有 [Vue warn]', code: "await waitFor(() => $$('li').length === 2)\ninput('[data-test=keyword]', '王')\nawait wait(50)\nconst warns = logs.filter((l) => l.text.includes('[Vue warn]'))\nassert(!warns.length, warns.map((l) => l.text.slice(0, 120)).join('\\n'))" },
    ],
    hints: ['先讓模組載入成功：`useFetch` 不是 Vue 的 API。', 'Vue 3 沒有 filter（`|`）、沒有 `beforeDestroy`；`v-for` 與 `v-if` 不寫在同一個元素。', '子元件發事件（`emit(\'cancelled\', id)`），由持有陣列的 `App` 移除。'],
  },
]

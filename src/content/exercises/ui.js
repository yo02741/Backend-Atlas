// 程式題：UI 元件詞彙（Vue 3，在沙箱 iframe 裡執行，fetch 由假 API 回應）
export default [
  {
    id: 'ui-states-1', skill: 'ui-states', kind: 'vue', level: 1,
    title: '送出中停用按鈕，連點只掛一次號',
    prompt: '「確認掛號」按鈕送出 `POST /api/sessions/1/appointments`（假 API 內建的門診路由，成功回 201 與號碼 `number`）。網路慢的時候畫面沒有變化，使用者以為沒按到又按一次，同一個診次掛了兩筆。改成：\n\n- 送出中：按鈕設成 `disabled`，文字是「送出中…」，連點也只送出一次\n- 成功：顯示 `<p data-test="done">`「掛號成功，您是 N 號」\n- 失敗（4xx、5xx）：按鈕恢復成「確認掛號」並可再按，在 `role="alert"` 的元素顯示 Problem Details 的 `detail`\n- 網路錯誤：一樣恢復按鈕，`role="alert"` 顯示「無法連線，請稍後再試」\n\n按鈕是 `<button data-test="submit">`。',
    api: 'api.latency = 400',
    starter: `import { createApp, ref } from 'vue'

const BookButton = {
  setup() {
    const number = ref(null)
    const error = ref('')
    async function book() {
      const res = await fetch('/api/sessions/1/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (res.ok) number.value = data.number
      else error.value = data.detail
    }
    return { number, error, book }
  },
  template: \`
    <button type="button" data-test="submit" @click="book">確認掛號</button>
    <p v-if="number" data-test="done">掛號成功，您是 {{ number }} 號</p>
    <p v-if="error" role="alert">{{ error }}</p>\`,
}

createApp(BookButton).mount('#app')
`,
    solution: `import { createApp, ref } from 'vue'

const BookButton = {
  setup() {
    const submitting = ref(false)
    const number = ref(null)
    const error = ref('')
    async function book() {
      if (submitting.value) return          // 送出中再按：不再送
      submitting.value = true
      error.value = ''
      try {
        const res = await fetch('/api/sessions/1/appointments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        const data = await res.json()
        if (res.ok) number.value = data.number
        else error.value = data.detail
      } catch {
        error.value = '無法連線，請稍後再試'
      } finally {
        submitting.value = false
      }
    }
    return { submitting, number, error, book }
  },
  template: \`
    <button type="button" data-test="submit" :disabled="submitting" @click="book">
      {{ submitting ? '送出中…' : '確認掛號' }}
    </button>
    <p v-if="number" data-test="done">掛號成功，您是 {{ number }} 號</p>
    <p v-if="error" role="alert">{{ error }}</p>\`,
}

createApp(BookButton).mount('#app')
`,
    tests: [
      { name: '送出中停用按鈕、顯示「送出中…」', code: "click('[data-test=submit]')\nawait tick()\nassert($('[data-test=submit]').disabled, '送出中按鈕要 disabled')\nassertEqual(text('[data-test=submit]'), '送出中…')" },
      { name: '連點只送出一次', code: "click('[data-test=submit]')\nawait tick()\nclick('[data-test=submit]')\nclick('[data-test=submit]')\nawait waitFor(() => $('[data-test=done]'))\nawait wait(100)\nassertEqual(api.calls.filter((c) => c.method === 'POST').length, 1, 'POST 次數')\nassertEqual(text('[data-test=done]'), '掛號成功，您是 1 號')" },
      { name: '失敗後按鈕恢復，顯示原因', api: "api.post('/api/sessions/1/appointments', { status: 409, body: api.problem(409, '這個門診已經額滿', { code: 'session-full', title: 'Session full' }), delay: 100 })", code: "click('[data-test=submit]')\nawait waitFor(() => $('[role=alert]'))\nassertEqual(text('[role=alert]'), '這個門診已經額滿')\nassert(!$('[data-test=submit]').disabled, '失敗後按鈕要能再按')\nassertEqual(text('[data-test=submit]'), '確認掛號')" },
      { name: '網路錯誤也恢復按鈕', api: "api.post('/api/sessions/1/appointments', { network: true, delay: 100 })", code: "click('[data-test=submit]')\nawait waitFor(() => $('[role=alert]'))\nassertEqual(text('[role=alert]'), '無法連線，請稍後再試')\nassert(!$('[data-test=submit]').disabled, '失敗後按鈕要能再按')" },
    ],
    hints: ['用一個 `submitting` ref：開始時設 `true`，`finally` 裡設回 `false`；按鈕綁 `:disabled="submitting"`。', '`disabled` 生效前的同一個瞬間可能已經進來第二次點擊，函式開頭再檢查一次 `submitting`。', '`fetch` 網路錯誤會 reject，放在 `try` 裡。'],
  },
  {
    id: 'feedback-1', skill: 'feedback', kind: 'vue', level: 2,
    title: '沒有結果、沒有資料、讀取失敗，畫面要分開',
    prompt: '預約清單有科別篩選（`<select data-test="dept">`）與姓名搜尋（`<input data-test="keyword">`）。現在三種「沒有東西可以顯示」都寫「這天沒有預約」，伺服器掛了也一樣。分開成：\n\n- 篩選後沒有結果：`data-test="empty"` 顯示「沒有符合條件的預約」，附「清除篩選」按鈕（`data-test="clear"`），按了清空兩個條件並列出全部\n- 這天真的沒有預約（API 回空陣列）：`data-test="empty"` 顯示「這天沒有預約」，沒有「清除篩選」\n- 讀取失敗（狀態碼不是 2xx、網路錯誤、回應不是 JSON）：`role="alert"` 顯示「讀取失敗」，不顯示 `data-test="empty"`\n\n每筆預約一個 `<li>`。`GET /api/appointments?date=2026-11-20` 回傳 `[{ id, patient, dept }]`。',
    api: "api.get('/api/appointments', { body: [{ id: 1, patient: '王小明', dept: '家醫科' }, { id: 2, patient: '陳美華', dept: '小兒科' }, { id: 3, patient: '林志明', dept: '家醫科' }], delay: 100 })",
    starter: `import { createApp, ref, computed, onMounted } from 'vue'

const AppointmentList = {
  setup() {
    const appointments = ref([])
    const dept = ref('')
    const keyword = ref('')
    const filtered = computed(() => appointments.value.filter((a) =>
      (!dept.value || a.dept === dept.value) && a.patient.includes(keyword.value)))

    onMounted(async () => {
      try {
        const res = await fetch('/api/appointments?date=2026-11-20')
        appointments.value = await res.json()
      } catch {
        appointments.value = []
      }
    })
    return { dept, keyword, filtered }
  },
  template: \`
    <select v-model="dept" data-test="dept">
      <option value="">全部科別</option>
      <option>家醫科</option>
      <option>小兒科</option>
      <option>眼科</option>
    </select>
    <input v-model="keyword" data-test="keyword" placeholder="病患姓名">
    <p v-if="!filtered.length" data-test="empty">這天沒有預約</p>
    <ul v-else>
      <li v-for="a in filtered" :key="a.id">{{ a.patient }}（{{ a.dept }}）</li>
    </ul>\`,
}

createApp(AppointmentList).mount('#app')
`,
    solution: `import { createApp, ref, computed, onMounted } from 'vue'

const AppointmentList = {
  setup() {
    const status = ref('loading')   // loading | ready | error
    const appointments = ref([])
    const dept = ref('')
    const keyword = ref('')
    const filtered = computed(() => appointments.value.filter((a) =>
      (!dept.value || a.dept === dept.value) && a.patient.includes(keyword.value)))
    const hasFilter = computed(() => dept.value !== '' || keyword.value !== '')

    function clearFilters() {
      dept.value = ''
      keyword.value = ''
    }

    onMounted(async () => {
      try {
        const res = await fetch('/api/appointments?date=2026-11-20')
        if (!res.ok) throw new Error('HTTP ' + res.status)
        appointments.value = await res.json()   // 不是 JSON 時會丟 SyntaxError，一樣算讀取失敗
        status.value = 'ready'
      } catch {
        status.value = 'error'                  // 錯誤不能變成空清單
      }
    })
    return { status, appointments, dept, keyword, filtered, hasFilter, clearFilters }
  },
  template: \`
    <select v-model="dept" data-test="dept">
      <option value="">全部科別</option>
      <option>家醫科</option>
      <option>小兒科</option>
      <option>眼科</option>
    </select>
    <input v-model="keyword" data-test="keyword" placeholder="病患姓名">
    <p v-if="status === 'loading'">載入中…</p>
    <p v-else-if="status === 'error'" role="alert">讀取失敗</p>
    <p v-else-if="!appointments.length" data-test="empty">這天沒有預約</p>
    <div v-else-if="!filtered.length" data-test="empty">
      <p>沒有符合條件的預約</p>
      <button type="button" data-test="clear" @click="clearFilters">清除篩選</button>
    </div>
    <ul v-else>
      <li v-for="a in filtered" :key="a.id">{{ a.patient }}（{{ a.dept }}）</li>
    </ul>\`,
}

createApp(AppointmentList).mount('#app')
`,
    tests: [
      { name: '篩選後沒有結果：Empty state 與「清除篩選」', code: "await waitFor(() => $$('li').length === 3)\nselect('[data-test=dept]', '眼科')\nawait waitFor(() => $('[data-test=empty]'))\nassert(text('[data-test=empty]').includes('沒有符合條件的預約'), 'Empty state 的文字：' + text('[data-test=empty]'))\nassert($('[data-test=clear]'), '要有「清除篩選」按鈕')" },
      { name: '「清除篩選」清空條件、列出全部', code: "await waitFor(() => $$('li').length === 3)\nselect('[data-test=dept]', '家醫科')\ninput('[data-test=keyword]', '陳')\nawait waitFor(() => $('[data-test=clear]'))\nclick('[data-test=clear]')\nawait waitFor(() => $$('li').length === 3)\nassertEqual([$('[data-test=dept]').value, $('[data-test=keyword]').value], ['', ''], '兩個篩選條件')" },
      { name: '這天沒有預約：沒有「清除篩選」', api: "api.get('/api/appointments', { body: [] })", code: "await waitFor(() => api.calls[0] && api.calls[0].status)\nawait tick()\nawait waitFor(() => $('[data-test=empty]'))\nassertEqual(text('[data-test=empty]'), '這天沒有預約')\nassert(!$('[data-test=clear]'), '沒有篩選條件時不需要「清除篩選」')" },
      { name: '讀取失敗不能顯示成沒有預約', api: "api.get('/api/appointments', { status: 502, headers: { 'Content-Type': 'text/html' }, body: '<html><body>502 Bad Gateway</body></html>' })", code: "await waitFor(() => $('[role=alert]'))\nassert(text('[role=alert]').includes('讀取失敗'), 'role=alert 的文字：' + text('[role=alert]'))\nassert(!$('[data-test=empty]'), '讀取失敗時不能顯示 Empty state')" },
    ],
    hints: ['「這天沒有預約」看的是 API 回來的全部資料；「沒有符合條件」看的是篩選後的結果。兩者用不同的條件判斷。', '`catch` 裡不要把清單設成空陣列：用一個狀態記下「失敗」。'],
  },
]

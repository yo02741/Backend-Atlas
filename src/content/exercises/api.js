// 程式題：呼叫後端（在沙箱 iframe 裡執行，fetch 由假 API 回應，見 src/runtime/fakeApi.js）
export default [
  {
    id: 'fetch-basics-1', skill: 'fetch-basics', kind: 'html', level: 1,
    title: '查詢預約：4xx、5xx 不會讓 fetch 失敗',
    prompt: '查詢預約的頁面只處理了成功的情況：查不到時畫面顯示 `undefined undefined`，網路斷掉時什麼都沒有。`fetch` 只有網路錯誤會 reject，4xx、5xx 要自己看 `res.ok`。改寫 `<script>`：\n\n- 成功：`#result` 顯示「病患 時間」，例如「王○明 09:30」，`#error` 清空\n- 狀態碼不是 2xx：`#result` 清空。回應是 JSON（Problem Details）時 `#error` 顯示它的 `title`；不是 JSON 時顯示「系統暫時無法處理（狀態碼）」，例如「系統暫時無法處理（502）」\n- 網路錯誤：`#error` 顯示「無法連線，請檢查網路」\n\n`GET /api/appointments/{id}` 成功回 `{ id, patientName, time }`。測試會查 1（成功）、999（404）、502（回 HTML 的 502）、0（網路錯誤）。',
    api: "api.get('/api/appointments/:id', (req) => {\n  const id = req.params.id\n  if (id === '1') return { body: { id: 1, patientName: '王○明', time: '09:30' } }\n  if (id === '502') return { status: 502, headers: { 'Content-Type': 'text/html' }, body: '<html><body>502 Bad Gateway</body></html>' }\n  if (id === '0') return { network: true }\n  return { status: 404, body: { type: 'about:blank', title: '找不到這筆預約', status: 404, detail: '預約 ' + id + ' 不存在' } }\n})",
    starter: `<form id="lookup">
  <label for="appt-id">預約編號</label>
  <input id="appt-id" name="id" inputmode="numeric" required>
  <button type="submit">查詢</button>
</form>
<p id="result"></p>
<p id="error" role="alert"></p>

<script type="module">
  const form = document.getElementById('lookup')
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const id = form.elements.id.value
    const res = await fetch('/api/appointments/' + encodeURIComponent(id))
    const data = await res.json()
    document.getElementById('result').textContent = data.patientName + ' ' + data.time
  })
</script>
`,
    solution: `<form id="lookup">
  <label for="appt-id">預約編號</label>
  <input id="appt-id" name="id" inputmode="numeric" required>
  <button type="submit">查詢</button>
</form>
<p id="result"></p>
<p id="error" role="alert"></p>

<script type="module">
  const form = document.getElementById('lookup')
  const result = document.getElementById('result')
  const error = document.getElementById('error')

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    result.textContent = ''
    error.textContent = ''
    const id = form.elements.id.value
    let res
    try {
      res = await fetch('/api/appointments/' + encodeURIComponent(id))
    } catch {
      error.textContent = '無法連線，請檢查網路'   // 只有網路錯誤會走到這裡
      return
    }
    if (!res.ok) {
      // 4xx、5xx：先看是不是 JSON，再決定怎麼讀
      const isJson = (res.headers.get('Content-Type') || '').includes('json')
      error.textContent = isJson ? (await res.json()).title : '系統暫時無法處理（' + res.status + '）'
      return
    }
    const data = await res.json()
    result.textContent = data.patientName + ' ' + data.time
  })
</script>
`,
    tests: [
      { name: '查得到：顯示病患與時間', code: "input('#appt-id', '1')\nsubmit('#lookup')\nawait waitFor(() => text('#result'))\nassertEqual(text('#result'), '王○明 09:30')\nassertEqual(text('#error'), '')" },
      { name: '404：顯示 Problem Details 的 title', code: "input('#appt-id', '999')\nsubmit('#lookup')\nawait waitFor(() => text('#error'))\nassertEqual(text('#error'), '找不到這筆預約')\nassertEqual(text('#result'), '')" },
      { name: '502 回 HTML：不能當成 JSON 讀', code: "input('#appt-id', '502')\nsubmit('#lookup')\nawait waitFor(() => text('#error'))\nassertEqual(text('#error'), '系統暫時無法處理（502）')" },
      { name: '網路錯誤：顯示無法連線', code: "input('#appt-id', '0')\nsubmit('#lookup')\nawait waitFor(() => text('#error'))\nassertEqual(text('#error'), '無法連線，請檢查網路')" },
      { name: '先成功再失敗：舊的結果要清掉', code: "input('#appt-id', '1')\nsubmit('#lookup')\nawait waitFor(() => text('#result'))\ninput('#appt-id', '999')\nsubmit('#lookup')\nawait waitFor(() => text('#error'))\nassertEqual(text('#result'), '')" },
    ],
    hints: ['`await fetch()` 拿到 404、500 的回應時不會丟錯，`res.ok` 是 `false`。', '`res.headers.get(\'Content-Type\')` 看回應是不是 JSON；HTML 的錯誤頁呼叫 `res.json()` 會丟 `SyntaxError`。'],
  },
  {
    id: 'api-states-1', skill: 'api-states', kind: 'vue', level: 1,
    title: '預約清單的 loading、error、empty',
    prompt: '預約清單只處理了成功的情況。改成四種狀態都有畫面，畫面一次只出現其中一種：\n\n- 請求進行中：`data-test="loading"`\n- 失敗（狀態碼不是 2xx，或網路錯誤）：`data-test="error"`，裡面有 `data-test="retry"` 的「重試」按鈕，按了重新請求\n- 成功但沒有資料：`data-test="empty"`，文字「這天沒有預約」\n- 成功：每筆預約一個 `<li>`，內容是 `patient`\n\n`GET /api/appointments?date=2026-11-20` 回傳 `[{ id, number, patient }]`。',
    api: "api.get('/api/appointments', { body: [{ id: 1, number: 1, patient: '王○明' }, { id: 2, number: 2, patient: '陳○華' }], delay: 300 })",
    starter: `import { createApp, ref, onMounted } from 'vue'

const AppointmentList = {
  setup() {
    const appointments = ref([])
    onMounted(async () => {
      const res = await fetch('/api/appointments?date=2026-11-20')
      appointments.value = await res.json()
    })
    return { appointments }
  },
  template: \`
    <ul>
      <li v-for="a in appointments" :key="a.id">{{ a.patient }}</li>
    </ul>\`,
}

createApp(AppointmentList).mount('#app')
`,
    solution: `import { createApp, ref, onMounted } from 'vue'

const AppointmentList = {
  setup() {
    const status = ref('loading')   // loading | success | empty | error
    const appointments = ref([])

    async function load() {
      status.value = 'loading'
      try {
        const res = await fetch('/api/appointments?date=2026-11-20')
        if (!res.ok) throw new Error('HTTP ' + res.status)   // 4xx、5xx 不會讓 fetch reject，要自己判斷
        appointments.value = await res.json()
        status.value = appointments.value.length ? 'success' : 'empty'
      } catch {
        status.value = 'error'
      }
    }

    onMounted(load)
    return { status, appointments, load }
  },
  template: \`
    <p v-if="status === 'loading'" data-test="loading">載入中…</p>
    <div v-else-if="status === 'error'" data-test="error">
      <p>讀取失敗</p>
      <button type="button" data-test="retry" @click="load">重試</button>
    </div>
    <p v-else-if="status === 'empty'" data-test="empty">這天沒有預約</p>
    <ul v-else>
      <li v-for="a in appointments" :key="a.id">{{ a.patient }}</li>
    </ul>\`,
}

createApp(AppointmentList).mount('#app')
`,
    tests: [
      { name: '請求進行中顯示 loading', code: "await waitFor(() => $('[data-test=loading]'))\nassert(!$('li'), '載入中不應該出現清單')" },
      { name: '成功時列出預約', code: "await waitFor(() => $$('li').length === 2)\nassertEqual($$('li').map((li) => li.textContent.trim()), ['王○明', '陳○華'])\nassert(!$('[data-test=loading]'), '成功後 loading 要消失')" },
      { name: '500 時顯示錯誤，不顯示 empty', api: "api.get('/api/appointments', { status: 500, body: { type: 'about:blank', title: 'Internal Server Error', status: 500 } })", code: "await waitFor(() => $('[data-test=error]'))\nassert(!$('[data-test=empty]'), '失敗時不能顯示「這天沒有預約」')\nassert(!$('li'), '失敗時不應該出現清單')" },
      { name: '空陣列顯示 empty', api: "api.get('/api/appointments', { body: [] })", code: "await waitFor(() => $('[data-test=empty]'))\nassertEqual(text('[data-test=empty]'), '這天沒有預約')" },
      { name: '網路錯誤後重試成功', api: "api.get('/api/appointments', [{ network: true }, { body: [{ id: 3, number: 1, patient: '林○明' }] }])", code: "await waitFor(() => $('[data-test=retry]'))\nclick('[data-test=retry]')\nawait waitFor(() => $$('li').length === 1)\nassertEqual(api.calls.length, 2, '請求次數')" },
    ],
    hints: ['用一個 `status` 變數表示目前是哪一種狀態，模板用 `v-if`／`v-else-if` 分開。', '`fetch` 只有網路錯誤會 reject；500 要看 `res.ok`。'],
  },
  {
    id: 'api-states-2', skill: 'api-states', kind: 'vue', level: 2,
    title: '能重試的錯誤才給「重試」',
    prompt: '預約清單的錯誤畫面一律顯示「讀取失敗」與「重試」。403 重試幾次結果都一樣，使用者卻一直按。依錯誤的原因分開：\n\n- 網路錯誤與 5xx：`data-test="error"` 裡有「重試」按鈕 `data-test="retry"`，按了回到 loading（`data-test="loading"`）再重新請求\n- 4xx：`data-test="error"` 顯示 Problem Details 的 `title`（例如「沒有權限查看這天的預約」），沒有「重試」\n- 請求進行中不再送出新的請求：連按兩下「重試」只送出一次\n\n成功時每筆預約一個 `<li>`。',
    api: "api.get('/api/appointments', { body: [{ id: 1, number: 1, patient: '王○明' }, { id: 2, number: 2, patient: '陳○華' }], delay: 200 })",
    starter: `import { createApp, ref, onMounted } from 'vue'

const AppointmentList = {
  setup() {
    const status = ref('loading')   // loading | success | empty | error
    const appointments = ref([])

    async function load() {
      status.value = 'loading'
      try {
        const res = await fetch('/api/appointments?date=2026-11-20')
        if (!res.ok) throw new Error('HTTP ' + res.status)
        appointments.value = await res.json()
        status.value = appointments.value.length ? 'success' : 'empty'
      } catch {
        status.value = 'error'
      }
    }

    onMounted(load)
    return { status, appointments, load }
  },
  template: \`
    <p v-if="status === 'loading'" data-test="loading">載入中…</p>
    <div v-else-if="status === 'error'" data-test="error">
      <p>讀取失敗</p>
      <button type="button" data-test="retry" @click="load">重試</button>
    </div>
    <p v-else-if="status === 'empty'" data-test="empty">這天沒有預約</p>
    <ul v-else>
      <li v-for="a in appointments" :key="a.id">{{ a.patient }}</li>
    </ul>\`,
}

createApp(AppointmentList).mount('#app')
`,
    solution: `import { createApp, ref, onMounted } from 'vue'

const AppointmentList = {
  setup() {
    const status = ref('idle')   // idle | loading | success | empty | error
    const appointments = ref([])
    const error = ref({ message: '', retryable: false })

    async function load() {
      if (status.value === 'loading') return          // 進行中：不重複送出
      status.value = 'loading'
      let res
      try {
        res = await fetch('/api/appointments?date=2026-11-20')
      } catch {
        error.value = { message: '無法連線，請檢查網路', retryable: true }
        status.value = 'error'
        return
      }
      if (!res.ok) {
        const problem = await res.json().catch(() => ({}))
        error.value = res.status >= 500
          ? { message: '系統暫時無法處理', retryable: true }                       // 5xx：可能是暫時的
          : { message: problem.title || '請求有誤（' + res.status + '）', retryable: false }   // 4xx：重送結果一樣
        status.value = 'error'
        return
      }
      appointments.value = await res.json()
      status.value = appointments.value.length ? 'success' : 'empty'
    }

    onMounted(load)
    return { status, appointments, error, load }
  },
  template: \`
    <p v-if="status === 'loading' || status === 'idle'" data-test="loading">載入中…</p>
    <div v-else-if="status === 'error'" data-test="error">
      <p>{{ error.message }}</p>
      <button v-if="error.retryable" type="button" data-test="retry" @click="load">重試</button>
    </div>
    <p v-else-if="status === 'empty'" data-test="empty">這天沒有預約</p>
    <ul v-else>
      <li v-for="a in appointments" :key="a.id">{{ a.patient }}</li>
    </ul>\`,
}

createApp(AppointmentList).mount('#app')
`,
    tests: [
      { name: '503：給重試，按了回到 loading 再成功', api: "api.get('/api/appointments', [{ status: 503, body: { type: 'about:blank', title: 'Service Unavailable', status: 503 }, delay: 50 }, { body: [{ id: 1, number: 1, patient: '王○明' }], delay: 300 }])", code: "await waitFor(() => $('[data-test=retry]'))\nclick('[data-test=retry]')\nawait waitFor(() => $('[data-test=loading]'))\nawait waitFor(() => $$('li').length === 1)" },
      { name: '網路錯誤：給重試', api: "api.get('/api/appointments', { network: true, delay: 50 })", code: "await waitFor(() => $('[data-test=error]'))\nassert($('[data-test=retry]'), '網路錯誤要給「重試」')" },
      { name: '403：顯示原因，不給重試', api: "api.get('/api/appointments', { status: 403, body: { type: 'about:blank', title: '沒有權限查看這天的預約', status: 403 }, delay: 50 })", code: "await waitFor(() => $('[data-test=error]'))\nassert(text('[data-test=error]').includes('沒有權限查看這天的預約'), '要顯示 Problem Details 的 title：' + text('[data-test=error]'))\nassert(!$('[data-test=retry]'), '403 重試也不會成功，不要給「重試」')" },
      { name: '連按兩下「重試」只送出一次', api: "api.get('/api/appointments', [{ status: 500, body: { type: 'about:blank', title: 'Internal Server Error', status: 500 }, delay: 50 }, { body: [{ id: 1, number: 1, patient: '王○明' }], delay: 200 }])", code: "await waitFor(() => $('[data-test=retry]'))\nconst btn = $('[data-test=retry]')\nbtn.click()\nbtn.click()\nawait waitFor(() => $$('li').length === 1)\nawait wait(250)\nassertEqual(api.calls.length, 2, '請求次數（第一次載入加一次重試）')" },
    ],
    hints: ['錯誤分成「能不能重試」：網路錯誤與 5xx 可能是暫時的；4xx 是請求本身有問題。', '`load()` 開頭檢查狀態已經是 loading 就直接 return。'],
  },
]

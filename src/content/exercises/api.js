// 程式題：呼叫後端（在沙箱 iframe 裡執行，fetch 由假 API 回應，見 src/runtime/fakeApi.js）

// api-errors-retry-1 的測試共用的假伺服器（js 題在 Worker 裡跑，沒有假 API）：依序回應腳本裡的狀態。
// 'net' 是網路錯誤，'hang' 一直不回應、等 signal abort（1.5 秒後自己失敗，避免整個測試卡住），'429:1' 是 429 加 Retry-After: 1
const FAKE_SERVER = `function server(script) {
  const times = []
  const impl = (path, { signal } = {}) => {
    const step = script[Math.min(times.length, script.length - 1)]
    times.push(performance.now())
    if (signal?.aborted) return Promise.reject(signal.reason)
    if (step === 'net') return Promise.reject(new TypeError('Failed to fetch'))
    if (step === 'hang') return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('伺服器一直沒有回應')), 1500)
      signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason) }, { once: true })
    })
    const [status, after] = String(step).split(':')
    const body = status === '200' ? '[]' : JSON.stringify({ title: '錯誤 ' + status, status: Number(status) })
    return Promise.resolve(new Response(body, { status: Number(status), headers: after ? { 'Retry-After': after } : {} }))
  }
  return { impl, times }
}
`
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
  {
    id: 'cancel-race-1', skill: 'cancel-race', kind: 'vue', level: 2,
    title: '切科別切太快：舊的回應不能蓋掉新結果',
    prompt: '預約查詢頁上方有三個科別按鈕，切換就抓 `GET /api/slots?dept=…`。三個科別的回應時間不同（內科 300 ms、骨科 500 ms、眼科 100 ms，示意）：從內科切到骨科再馬上切到眼科，標題寫「眼科的時段」，列出的卻是 500 ms 後才回來的骨科時段。改成：\n\n- 每次請求建一個 `AbortController`，把 `signal` 傳給 `fetch`；在 `watch` 的 callback 裡用 `onWatcherCleanup(() => controller.abort())`（寫在第一個 `await` 之前），條件再變或元件卸載時取消上一個請求\n- 被取消的請求不算錯誤：用 `controller.signal.aborted` 判斷，不改狀態、不顯示 `data-test="error"`\n- 按 `data-test="toggle"` 切到掛號頁（卸載查詢頁）時，還在路上的請求也要取消\n\n科別按鈕是 `<button data-test="dept">`，標題 `data-test="title"`，每個時段一個 `<li>`；`data-test="loading"`、`data-test="error"` 已經寫好。',
    api: "const slots = { 內科: ['09:00', '09:30'], 骨科: ['10:00', '10:30', '11:00'], 眼科: ['14:00'] }\nconst delay = { 內科: 300, 骨科: 500, 眼科: 100 }\napi.get('/api/slots', (req) => ({ body: (slots[req.query.dept] || []).map((time, i) => ({ id: i + 1, time })), delay: delay[req.query.dept] || 100 }))",
    starter: `import { createApp, ref, watch } from 'vue'

const DEPTS = ['內科', '骨科', '眼科']

const SlotSearch = {
  setup() {
    const dept = ref('內科')
    const slots = ref([])
    const status = ref('idle')          // idle | loading | success | error
    watch(dept, async (d) => {
      status.value = 'loading'
      try {
        const res = await fetch('/api/slots?dept=' + encodeURIComponent(d))
        if (!res.ok) throw new Error('HTTP ' + res.status)
        slots.value = await res.json()
        status.value = 'success'
      } catch {
        status.value = 'error'
      }
    }, { immediate: true })
    return { DEPTS, dept, slots, status }
  },
  template: \`
    <nav><button v-for="d in DEPTS" :key="d" type="button" data-test="dept" :aria-pressed="d === dept" @click="dept = d">{{ d }}</button></nav>
    <h2 data-test="title">{{ dept }}的時段</h2>
    <p v-if="status === 'loading'" data-test="loading">載入中…</p>
    <p v-else-if="status === 'error'" data-test="error">讀取失敗</p>
    <ul v-else><li v-for="s in slots" :key="s.id">{{ s.time }}</li></ul>\`,
}

createApp({
  components: { SlotSearch },
  setup() { return { page: ref('search') } },
  template: \`
    <button type="button" data-test="toggle" @click="page = page === 'search' ? 'booking' : 'search'">切換頁面</button>
    <SlotSearch v-if="page === 'search'" />
    <p v-else>掛號頁</p>\`,
}).mount('#app')
`,
    solution: `import { createApp, ref, watch, onWatcherCleanup } from 'vue'

const DEPTS = ['內科', '骨科', '眼科']

const SlotSearch = {
  setup() {
    const dept = ref('內科')
    const slots = ref([])
    const status = ref('idle')          // idle | loading | success | error
    watch(dept, async (d) => {
      const controller = new AbortController()
      onWatcherCleanup(() => controller.abort())   // 換科別或卸載時取消這一個；要在 await 之前
      status.value = 'loading'
      try {
        const res = await fetch('/api/slots?dept=' + encodeURIComponent(d), { signal: controller.signal })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        slots.value = await res.json()
        status.value = 'success'
      } catch {
        if (controller.signal.aborted) return      // 被取消不是錯誤：畫面交給新的那一個請求
        status.value = 'error'
      }
    }, { immediate: true })
    return { DEPTS, dept, slots, status }
  },
  template: \`
    <nav><button v-for="d in DEPTS" :key="d" type="button" data-test="dept" :aria-pressed="d === dept" @click="dept = d">{{ d }}</button></nav>
    <h2 data-test="title">{{ dept }}的時段</h2>
    <p v-if="status === 'loading'" data-test="loading">載入中…</p>
    <p v-else-if="status === 'error'" data-test="error">讀取失敗</p>
    <ul v-else><li v-for="s in slots" :key="s.id">{{ s.time }}</li></ul>\`,
}

createApp({
  components: { SlotSearch },
  setup() { return { page: ref('search') } },
  template: \`
    <button type="button" data-test="toggle" @click="page = page === 'search' ? 'booking' : 'search'">切換頁面</button>
    <SlotSearch v-if="page === 'search'" />
    <p v-else>掛號頁</p>\`,
}).mount('#app')
`,
    tests: [
      { name: '快速切換：畫面只顯示最後選的科別', code: "await waitFor(() => $$('li').length === 2)\nclick($$('[data-test=dept]')[1])\nawait wait(50)\nclick($$('[data-test=dept]')[2])\nawait wait(700)\nassertEqual(text('[data-test=title]'), '眼科的時段')\nassertEqual($$('li').map((li) => li.textContent.trim()), ['14:00'], '眼科的時段清單')" },
      { name: '換科別時取消上一個請求', code: "await waitFor(() => $$('li').length === 2)\nclick($$('[data-test=dept]')[1])\nawait wait(50)\nclick($$('[data-test=dept]')[2])\nawait wait(700)\nconst state = api.calls.map((c) => decodeURIComponent(c.url).split('=')[1] + (c.aborted ? ' 已取消' : ' ' + c.status))\nassertEqual(state, ['內科 200', '骨科 已取消', '眼科 200'], '每個請求的結果')" },
      { name: '被取消的請求不顯示錯誤', code: "await waitFor(() => $$('li').length === 2)\nlet sawError = false\nconst t = setInterval(() => { if ($('[data-test=error]')) sawError = true }, 10)\nfor (const i of [1, 2, 0, 1, 2]) { click($$('[data-test=dept]')[i]); await wait(30) }\nawait wait(600)\nclearInterval(t)\nassert(!sawError, '切換途中出現了「讀取失敗」')\nassertEqual(text('[data-test=title]'), '眼科的時段')\nassertEqual($$('li').map((li) => li.textContent.trim()), ['14:00'], '眼科的時段清單')" },
      { name: '切到掛號頁時取消還在路上的請求', code: "await waitFor(() => api.calls.length === 1)\nclick('[data-test=toggle]')\nawait wait(400)\nassert(api.calls[0].aborted, '卸載時內科的請求還在路上，要取消')" },
    ],
    hints: ['`new AbortController()` 每個請求一個，`fetch(url, { signal: controller.signal })`。', '`onWatcherCleanup(() => controller.abort())` 在下一次 callback 執行前、以及 watcher 停止（元件卸載）時呼叫。', '`catch` 裡先看 `controller.signal.aborted`：是被取消的就直接 `return`。'],
  },
  {
    id: 'pagination-filter-1', skill: 'pagination-filter', kind: 'vue', level: 3,
    title: '「載入更多」與篩選：條件放網址，換條件從第一批開始',
    prompt: '「我的掛號」用 cursor 分頁：`GET /api/appointments?status=…&limit=20&cursor=…` 回傳 `{ items, next_cursor }`，「載入更多」帶上一次的 `next_cursor`。現在篩選條件只存在元件的 ref 裡，按上一頁回不到前一組篩選；載入兩批之後換篩選，新請求還帶著舊的 `cursor`，清單接在舊資料後面。改成：\n\n- 篩選條件放網址的 query：按篩選鈕用 `router.push`，`status=all`（預設值）不寫進網址，例如 `/appointments?status=booked`；列表只 `watch` `route.query`，不另外存一份條件\n- `status` 不在 `all`、`booked`、`checked_in`、`cancelled` 之內（包括沒給）時當成 `all`；請求一律帶解析後的 `status`\n- 條件改變時清空已載入的資料、`cursor` 歸零，從第一批重新抓（請求不帶 `cursor`）\n- `next_cursor` 是 `null` 時隱藏「載入更多」\n\n沙箱裡的 router 用 `createMemoryHistory()`，頁面用 `data-test="path"` 顯示 `route.fullPath`。篩選鈕是 `data-test="status-all"`、`status-booked`、`status-checked_in`、`status-cancelled`，「載入更多」是 `data-test="more"`，上一頁 `data-test="back"`，連到 `/appointments?status=unknown` 的連結是 `data-test="bad-link"`，每筆掛號一個 `<li data-test="row">`。',
    api: "const STATUSES = ['booked', 'checked_in', 'cancelled']\nconst all = Array.from({ length: 45 }, (_, i) => ({ id: i + 1, number: i + 1, status: STATUSES[i % 3] }))\napi.get('/api/appointments', (req) => {\n  const status = req.query.status || 'all'\n  const limit = Number(req.query.limit || 20)\n  const cursor = Number(req.query.cursor || 0)\n  const rows = all.filter((a) => (status === 'all' || a.status === status) && a.id > cursor)\n  const items = rows.slice(0, limit)\n  return { body: { items, next_cursor: rows.length > limit ? items[items.length - 1].id : null }, delay: 30 }\n})",
    starter: `import { createApp, ref, onMounted } from 'vue'
import { createRouter, createMemoryHistory, RouterLink, RouterView, useRoute, useRouter } from 'vue-router'

const FILTERS = { all: '全部', booked: '已掛號', checked_in: '已報到', cancelled: '已取消' }

const AppointmentList = {
  setup() {
    const status = ref('all')
    const items = ref([])
    const nextCursor = ref(null)
    async function load() {
      const q = new URLSearchParams({ status: status.value, limit: '20' })
      if (nextCursor.value) q.set('cursor', nextCursor.value)
      const res = await fetch('/api/appointments?' + q)
      const data = await res.json()
      items.value = [...items.value, ...data.items]
      nextCursor.value = data.next_cursor
    }
    function setStatus(s) {
      status.value = s
      load()
    }
    onMounted(load)
    return { FILTERS, status, items, nextCursor, load, setStatus }
  },
  template: \`
    <nav>
      <button v-for="(label, key) in FILTERS" :key="key" type="button" :data-test="'status-' + key"
              :aria-pressed="status === key" @click="setStatus(key)">{{ label }}</button>
    </nav>
    <ul><li v-for="a in items" :key="a.id" data-test="row">{{ a.number }} 號（{{ FILTERS[a.status] }}）</li></ul>
    <button v-if="nextCursor" type="button" data-test="more" @click="load">載入更多</button>\`,
}

const router = createRouter({
  history: createMemoryHistory(),     // 沙箱的網址是 about:srcdoc
  routes: [
    { path: '/', redirect: '/appointments' },
    { path: '/appointments', component: AppointmentList },
  ],
})

createApp({
  setup() {
    const route = useRoute()
    const r = useRouter()
    return { route, back: () => r.back() }
  },
  template: \`
    <p><span data-test="path">{{ route.fullPath }}</span>
      <button type="button" data-test="back" @click="back">上一頁</button>
      <RouterLink to="/appointments?status=unknown" data-test="bad-link">舊書籤</RouterLink></p>
    <RouterView />\`,
}).use(router).mount('#app')
`,
    solution: `import { createApp, ref, computed, watch, onWatcherCleanup } from 'vue'
import { createRouter, createMemoryHistory, RouterLink, RouterView, useRoute, useRouter } from 'vue-router'

const FILTERS = { all: '全部', booked: '已掛號', checked_in: '已報到', cancelled: '已取消' }

// query 都是字串（或 null、陣列、undefined）：不在允許的值裡就用預設值
const parseStatus = (v) => (typeof v === 'string' && v in FILTERS ? v : 'all')

const AppointmentList = {
  setup() {
    const route = useRoute()
    const router = useRouter()
    const status = computed(() => parseStatus(route.query.status))   // 網址是唯一的來源
    const items = ref([])
    const nextCursor = ref(null)
    let controller = null

    async function load(cursor) {
      controller?.abort()
      controller = new AbortController()
      const q = new URLSearchParams({ status: status.value, limit: '20' })
      if (cursor) q.set('cursor', cursor)
      try {
        const res = await fetch('/api/appointments?' + q, { signal: controller.signal })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const data = await res.json()
        items.value = cursor ? [...items.value, ...data.items] : data.items
        nextCursor.value = data.next_cursor
      } catch (err) {
        if (err.name !== 'AbortError') console.warn('讀取失敗：', err.message)
      }
    }

    // 條件一變：清空、從第一批開始
    watch(status, () => {
      items.value = []
      nextCursor.value = null
      load(null)
      onWatcherCleanup(() => controller?.abort())
    }, { immediate: true })

    function setStatus(s) {
      router.push({ query: s === 'all' ? {} : { status: s } })   // 預設值不寫進網址
    }
    return { FILTERS, status, items, nextCursor, more: () => load(nextCursor.value), setStatus }
  },
  template: \`
    <nav>
      <button v-for="(label, key) in FILTERS" :key="key" type="button" :data-test="'status-' + key"
              :aria-pressed="status === key" @click="setStatus(key)">{{ label }}</button>
    </nav>
    <ul><li v-for="a in items" :key="a.id" data-test="row">{{ a.number }} 號（{{ FILTERS[a.status] }}）</li></ul>
    <button v-if="nextCursor" type="button" data-test="more" @click="more">載入更多</button>\`,
}

const router = createRouter({
  history: createMemoryHistory(),     // 沙箱的網址是 about:srcdoc
  routes: [
    { path: '/', redirect: '/appointments' },
    { path: '/appointments', component: AppointmentList },
  ],
})

createApp({
  setup() {
    const route = useRoute()
    const r = useRouter()
    return { route, back: () => r.back() }
  },
  template: \`
    <p><span data-test="path">{{ route.fullPath }}</span>
      <button type="button" data-test="back" @click="back">上一頁</button>
      <RouterLink to="/appointments?status=unknown" data-test="bad-link">舊書籤</RouterLink></p>
    <RouterView />\`,
}).use(router).mount('#app')
`,
    tests: [
      { name: '第一批 20 筆，載入更多接著拿，沒有下一批就隱藏按鈕', code: "const rows = () => $$('[data-test=row]').length\nawait waitFor(() => rows() === 20)\nclick('[data-test=more]')\nawait waitFor(() => rows() === 40)\nclick('[data-test=more]')\nawait waitFor(() => rows() === 45)\nawait tick()\nassert(!$('[data-test=more]'), '沒有下一批時要隱藏「載入更多」')\nassertEqual(api.calls.map((c) => c.url), ['/api/appointments?status=all&limit=20', '/api/appointments?status=all&limit=20&cursor=20', '/api/appointments?status=all&limit=20&cursor=40'], '請求')" },
      { name: '載入兩批後換篩選：請求不帶 cursor，清單從第一筆開始', code: "await waitFor(() => $$('[data-test=row]').length === 20)\nclick('[data-test=more]')\nawait waitFor(() => $$('[data-test=row]').length === 40)\nclick('[data-test=status-booked]')\nawait wait(150)\nassertEqual(api.calls[api.calls.length - 1].url, '/api/appointments?status=booked&limit=20', '換篩選後的請求')\nconst rows = $$('[data-test=row]').map((li) => li.textContent.trim())\nassertEqual([rows.length, rows[0]], [15, '1 號（已掛號）'], '已掛號的筆數與第一筆')" },
      { name: '篩選寫進網址，預設值不寫', code: "await waitFor(() => $$('[data-test=row]').length === 20)\nclick('[data-test=status-booked]')\nawait wait(100)\nassertEqual(text('[data-test=path]'), '/appointments?status=booked', '按「已掛號」之後的網址')\nclick('[data-test=status-all]')\nawait wait(100)\nassertEqual(text('[data-test=path]'), '/appointments', '按「全部」之後的網址')" },
      { name: '上一頁回到前一組篩選', code: "await waitFor(() => $$('[data-test=row]').length === 20)\nclick('[data-test=status-booked]')\nawait wait(100)\nclick('[data-test=status-cancelled]')\nawait wait(100)\nclick('[data-test=back]')\nawait wait(150)\nassertEqual(text('[data-test=path]'), '/appointments?status=booked', '按上一頁之後的網址')\nassert($$('[data-test=row]').length === 15 && $$('[data-test=row]').every((li) => li.textContent.includes('已掛號')), '清單要是已掛號的 15 筆：' + $$('[data-test=row]').length + ' 筆')" },
      { name: '網址的 status 不合法時當成全部', code: "await waitFor(() => $$('[data-test=row]').length === 20)\nclick('[data-test=status-booked]')\nawait wait(100)\nclick('[data-test=bad-link]')\nawait wait(150)\nassertEqual(api.calls[api.calls.length - 1].url, '/api/appointments?status=all&limit=20', '打開 ?status=unknown 後的請求')\nassertEqual($$('[data-test=row]').length, 20, '筆數')\nassert(!api.calls.some((c) => /undefined|NaN|unknown/.test(c.url)), '請求裡不能有 undefined、NaN 或不合法的 status')" },
    ],
    hints: ['條件的唯一來源是 `route.query`：按鈕只 `router.push({ query })`，列表 `watch` 解析後的條件。', '換條件時先把 `items` 清空、`cursor` 設成 `null`，再抓第一批；「載入更多」才帶 `next_cursor`。', '`route.query.status` 可能是 `undefined`、`null` 或陣列，檢查它是不是允許的字串。'],
  },
  {
    id: 'form-submit-1', skill: 'form-submit', kind: 'vue', level: 3,
    title: '掛號送出：422 對回欄位、409 保留內容、不重複送出',
    prompt: '櫃台的掛號表單送出 `POST /api/sessions/7/appointments`（body `{ patient_id, note }`，`patient_id` 是數字）。現在網路慢時連點會掛兩筆；422 時上方只顯示「Unprocessable Content」；409（額滿）之後表單被清空。改成：\n\n- 送出中按鈕 `disabled`、文字「送出中…」，`submitting` 為 `true` 時忽略再一次的 `submit`\n- 422：依 Problem Details 的 `errors[].field` 把 `message` 放在欄位下方（`patient_id` 對到 `#patient-id`，訊息 `id` 是 `patient-id-error`；`note` 對到 `#note`，訊息 `id` 是 `note-error`），輸入框加 `aria-invalid="true"` 與指向訊息的 `aria-describedby`，焦點移到第一個出錯的欄位；對不到欄位的錯誤顯示在表單上方的 `data-test="form-error"`，不丟掉\n- 409：`data-test="form-error"` 顯示 Problem Details 的 `detail`，表單內容保留\n- 按下送出時產生 `Idempotency-Key`（`crypto.randomUUID()`），網路錯誤後再送沿用同一個；拿到 422 或 409 之後修改再送，換一個新的\n- 201：顯示 `<p data-test="done">掛號成功，號碼 N</p>`，清空表單\n\n送出鈕是 `data-test="submit"`。本站後端的 `errors` 格式是 `[{ field, message }]`，這是擴充欄位，不是 RFC 9457 的標準欄位。',
    api: "window.__keys = []\napi.post('/api/sessions/:id/appointments', (req) => { window.__keys.push(req.headers['idempotency-key'] || null); return { status: 201, body: { id: 501, number: 12, ...req.body }, delay: 300 } })",
    starter: `import { createApp, reactive, ref } from 'vue'

const BookingForm = {
  setup() {
    const form = reactive({ patientId: '', note: '' })
    const formError = ref('')
    const number = ref(null)
    async function submit() {
      formError.value = ''
      const res = await fetch('/api/sessions/7/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: Number(form.patientId), note: form.note }),
      }).catch(() => null)
      if (!res) { formError.value = '無法連線，請再送一次'; return }
      const data = await res.json()
      if (res.ok) number.value = data.number
      else formError.value = data.title
      form.patientId = ''
      form.note = ''
    }
    return { form, formError, number, submit }
  },
  template: \`
    <form novalidate @submit.prevent="submit">
      <p v-if="formError" data-test="form-error" role="alert">{{ formError }}</p>
      <label for="patient-id">病歷號</label>
      <input id="patient-id" v-model.trim="form.patientId" inputmode="numeric">
      <label for="note">備註</label>
      <input id="note" v-model="form.note">
      <button type="submit" data-test="submit">掛號</button>
      <p v-if="number" data-test="done">掛號成功，號碼 {{ number }}</p>
    </form>\`,
}

createApp(BookingForm).mount('#app')
`,
    solution: `import { createApp, reactive, ref, nextTick } from 'vue'

const FIELDS = { patient_id: 'patient-id', note: 'note' }   // 後端的欄位名 → 輸入框的 id

const BookingForm = {
  setup() {
    const form = reactive({ patientId: '', note: '' })
    const fieldErrors = reactive({})            // { patient_id: '訊息' }
    const formError = ref('')
    const number = ref(null)
    const submitting = ref(false)
    let key = null                              // 這一次送出的冪等鍵，網路錯誤後重送沿用

    async function submit() {
      if (submitting.value) return              // 送出中：Enter 或程式再觸發 submit 也不送
      submitting.value = true
      formError.value = ''
      for (const k of Object.keys(fieldErrors)) delete fieldErrors[k]
      key ??= crypto.randomUUID()
      try {
        let res
        try {
          res = await fetch('/api/sessions/7/appointments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
            body: JSON.stringify({ patient_id: Number(form.patientId), note: form.note }),
          })
        } catch {
          formError.value = '無法連線，請再送一次'   // 沒送到：保留 key，重送時後端認得出是同一筆
          return
        }
        const data = await res.json().catch(() => ({}))
        if (res.ok) {
          number.value = data.number
          form.patientId = ''
          form.note = ''
          key = null
          return
        }
        if (res.status === 422 || res.status === 409) key = null   // 這次的內容不會成功：改了再送是新的請求
        if (res.status === 422) {
          const other = []
          for (const e of data.errors ?? []) {
            if (e.field in FIELDS) fieldErrors[e.field] ??= e.message   // 同一欄位只顯示第一則
            else other.push(e.field ? e.field + '：' + e.message : e.message)
          }
          if (other.length || !data.errors?.length) formError.value = other.join('；') || data.detail || '送出的資料有誤'
          const first = Object.keys(FIELDS).find((f) => fieldErrors[f])
          if (first) { await nextTick(); document.getElementById(FIELDS[first]).focus() }
          return
        }
        formError.value = data.detail || data.title || '送出失敗，請再試一次'   // 409 等：內容保留
      } finally {
        submitting.value = false
      }
    }
    return { form, fieldErrors, formError, number, submitting, submit }
  },
  template: \`
    <form novalidate @submit.prevent="submit">
      <p v-if="formError" data-test="form-error" role="alert">{{ formError }}</p>
      <label for="patient-id">病歷號</label>
      <input id="patient-id" v-model.trim="form.patientId" inputmode="numeric"
             :aria-invalid="fieldErrors.patient_id ? 'true' : 'false'" :aria-describedby="fieldErrors.patient_id ? 'patient-id-error' : undefined">
      <p v-if="fieldErrors.patient_id" id="patient-id-error" class="error">{{ fieldErrors.patient_id }}</p>
      <label for="note">備註</label>
      <input id="note" v-model="form.note"
             :aria-invalid="fieldErrors.note ? 'true' : 'false'" :aria-describedby="fieldErrors.note ? 'note-error' : undefined">
      <p v-if="fieldErrors.note" id="note-error" class="error">{{ fieldErrors.note }}</p>
      <button type="submit" data-test="submit" :disabled="submitting">{{ submitting ? '送出中…' : '掛號' }}</button>
      <p v-if="number" data-test="done">掛號成功，號碼 {{ number }}</p>
    </form>\`,
}

createApp(BookingForm).mount('#app')
`,
    tests: [
      { name: '連點、再觸發 submit 都只送一次；送出中按鈕停用', code: "input('#patient-id', '3')\nclick('[data-test=submit]')\nawait tick()\nassert($('[data-test=submit]').disabled, '送出中按鈕要 disabled')\nassertEqual(text('[data-test=submit]'), '送出中…')\nclick('[data-test=submit]')\nsubmit('form')\nawait waitFor(() => $('[data-test=done]'))\nassertEqual(api.calls.filter((c) => c.method === 'POST').length, 1, 'POST 次數')\nassertEqual(text('[data-test=done]'), '掛號成功，號碼 12')" },
      { name: '422：訊息放在欄位下方，aria 連到訊息，焦點移到出錯的欄位', api: "api.post('/api/sessions/:id/appointments', { status: 422, body: { type: 'https://clinic.example/problems/validation-error', title: 'Unprocessable Content', status: 422, errors: [{ field: 'patient_id', message: '病歷號不存在' }] }, delay: 50 })", code: "const focused = []\ndocument.addEventListener('focusin', (e) => focused.push(e.target.id || e.target.tagName))\ninput('#patient-id', '999')\nclick('[data-test=submit]')\nawait waitFor(() => $('#patient-id-error'))\nassertEqual(text('#patient-id-error'), '病歷號不存在', '#patient-id-error')\nassertEqual([$('#patient-id').getAttribute('aria-invalid'), $('#patient-id').getAttribute('aria-describedby')], ['true', 'patient-id-error'], '#patient-id 的 aria-invalid 與 aria-describedby')\nassert(!/Unprocessable/.test(text('form')), '畫面上不要出現 Unprocessable Content')\nassertEqual(focused[focused.length - 1], 'patient-id', '得到焦點的元素 id')\nassertEqual($('#patient-id').value, '999', '欄位內容要保留')" },
      { name: '422 對不到欄位的錯誤顯示在表單上方', api: "api.post('/api/sessions/:id/appointments', { status: 422, body: { title: 'Unprocessable Content', status: 422, errors: [{ field: 'note', message: '備註最多 50 字' }, { field: 'insurance', message: '健保卡已過期' }] }, delay: 50 })", code: "input('#patient-id', '3')\nclick('[data-test=submit]')\nawait waitFor(() => $('#note-error'))\nassertEqual(text('#note-error'), '備註最多 50 字', '#note-error')\nassert((text('[data-test=form-error]') || '').includes('健保卡已過期'), '表單上方要顯示對不到欄位的錯誤：' + text('[data-test=form-error]'))" },
      { name: '409：上方顯示原因，填的內容保留，按鈕恢復', api: "api.post('/api/sessions/:id/appointments', { status: 409, body: { type: 'https://clinic.example/problems/session-full', title: 'Session full', status: 409, detail: '診次 7 名額已滿' }, delay: 50 })", code: "input('#patient-id', '3')\ninput('#note', '下午回診')\nclick('[data-test=submit]')\nawait waitFor(() => $('[data-test=form-error]'))\nassertEqual(text('[data-test=form-error]'), '診次 7 名額已滿', '上方的訊息')\nassertEqual([$('#patient-id').value, $('#note').value], ['3', '下午回診'], '欄位內容')\nassert(!$('[data-test=submit]').disabled, '失敗後按鈕要能再按')" },
      { name: '網路錯誤後再送沿用同一個 Idempotency-Key；422 之後再送換一個', api: "let n = 0\napi.post('/api/sessions/:id/appointments', (req) => {\n  window.__keys.push(req.headers['idempotency-key'] || null)\n  n++\n  if (n === 1) return { network: true, delay: 30 }\n  if (n === 2) return { status: 422, body: { title: 'Unprocessable Content', status: 422, errors: [{ field: 'patient_id', message: '病歷號不存在' }] }, delay: 30 }\n  return { status: 201, body: { id: 501, number: 13 }, delay: 30 }\n})", code: "input('#patient-id', '999')\nclick('[data-test=submit]')\nawait waitFor(() => $('[data-test=form-error]'))\nclick('[data-test=submit]')\nawait waitFor(() => $('#patient-id-error'))\ninput('#patient-id', '3')\nclick('[data-test=submit]')\nawait waitFor(() => $('[data-test=done]'))\nconst k = window.__keys\nassert(k.length === 3 && k.every(Boolean), '每次送出都要帶 Idempotency-Key：' + JSON.stringify(k))\nassert(k[0] === k[1], '網路錯誤後重送要沿用同一個鍵：' + JSON.stringify(k))\nassert(k[2] !== k[1], '422 之後修改再送要換新的鍵：' + JSON.stringify(k))" },
    ],
    hints: ['函式開頭 `if (submitting.value) return`，`finally` 裡設回 `false`；按鈕綁 `:disabled="submitting"`。', '`for (const e of problem.errors ?? [])`：`field` 對得到輸入框就放欄位下方，對不到的收進上方的訊息。', '成功與失敗走不同的路：只有 201 才清空表單。'],
  },
  {
    id: 'auth-frontend-1', skill: 'auth-frontend', kind: 'vue', level: 3,
    title: '401 導去登入並導回原頁，403 顯示沒有權限',
    prompt: '門診系統用 Bearer token：`POST /api/auth/login`（`{ username, password }`）回 `{ access_token }`，之後的請求加 `Authorization: Bearer …`。現在 token 存在 localStorage；token 失效後清單只顯示「讀取失敗」；權限不足的 403 被當成沒登入導去登入頁；登入後的 `redirect` 什麼網址都接受。改成：\n\n- token 只放在 Pinia 的 `auth` store（記憶體），不寫進 localStorage、sessionStorage；重新整理後重新登入\n- `apiFetch(path)` 自動加 `Authorization`；收到 401 時清掉 `auth` store，`router.replace({ path: \'/login\', query: { redirect: 目前的 fullPath } })`\n- 收到 403 時頁面顯示 `data-test="forbidden"`「沒有權限」，登入狀態不動、不導去登入\n- `router.beforeEach` 擋下 `meta.requiresAuth` 的路由，回傳帶 `redirect` 的登入頁位置\n- 登入成功後：`redirect` 是 `/` 開頭、而且不是 `//` 開頭的字串才 `router.replace` 過去，否則回 `/`\n\n沙箱的假 API 在 `api.auth = true` 時，內建路由沒帶有效 token 就回 401；測試用 `api.db.tokens = {}` 讓 token 失效。router 用 `createMemoryHistory()`，頁面用 `data-test="path"` 顯示 `route.fullPath`；頁首是 `data-test="who"`（登入後顯示帳號、沒登入顯示「未登入」），登入鈕 `data-test="login"`（帳號 `desk1`、密碼 `demo-password`），連結 `data-test="to-appointments"`、`to-reports`、`evil-link`（指到 `/login?redirect=//evil.example`），清單頁的重新整理鈕 `data-test="reload"`、每筆 `<li data-test="row">`。',
    api: "api.auth = true\napi.db.appointments.push({ id: 1, session_id: 1, patient_id: 1, number: 1, status: 'booked', created_at: '2026-11-20T01:00:00Z' }, { id: 2, session_id: 2, patient_id: 2, number: 1, status: 'booked', created_at: '2026-11-20T01:10:00Z' })\napi.get('/api/reports', (req) => (/^Bearer fake-/.test(req.headers.authorization || '') ? { status: 403, body: api.problem(403, '只有醫師可以看報表') } : { status: 401, headers: { 'WWW-Authenticate': 'Bearer' }, body: api.problem(401, '請先登入') }))",
    starter: `import { createApp, ref, onMounted } from 'vue'
import { createPinia, defineStore, storeToRefs } from 'pinia'
import { createRouter, createMemoryHistory, RouterLink, RouterView, useRoute, useRouter } from 'vue-router'

const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('token'))
  const username = ref(localStorage.getItem('username'))
  async function login(name, password) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: name, password }),
    })
    if (!res.ok) throw new Error('帳號或密碼錯誤')
    token.value = (await res.json()).access_token
    username.value = name
    localStorage.setItem('token', token.value)
    localStorage.setItem('username', name)
  }
  function logout() {
    token.value = null
    username.value = null
    localStorage.clear()
  }
  return { token, username, login, logout }
})

let router

async function apiFetch(path) {
  const auth = useAuthStore()
  const res = await fetch(path, { headers: auth.token ? { Authorization: 'Bearer ' + auth.token } : {} })
  if (res.status === 401 || res.status === 403) {
    router.replace('/login')
    throw new Error('請先登入')
  }
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

const AppointmentsPage = {
  setup() {
    const rows = ref([])
    const error = ref('')
    async function load() {
      error.value = ''
      try { rows.value = (await apiFetch('/api/appointments')).items } catch { error.value = '讀取失敗' }
    }
    onMounted(load)
    return { rows, error, load }
  },
  template: \`
    <button type="button" data-test="reload" @click="load">重新整理</button>
    <p v-if="error" role="alert">{{ error }}</p>
    <ul><li v-for="a in rows" :key="a.id" data-test="row">{{ a.number }} 號</li></ul>\`,
}

const ReportsPage = {
  setup() {
    const state = ref('loading')
    onMounted(async () => {
      try { await apiFetch('/api/reports'); state.value = 'ok' } catch { state.value = 'error' }
    })
    return { state }
  },
  template: \`<p v-if="state === 'ok'">報表</p><p v-else-if="state === 'error'" role="alert">讀取失敗</p>\`,
}

const LoginPage = {
  setup() {
    const route = useRoute()
    const r = useRouter()
    const auth = useAuthStore()
    async function login() {
      await auth.login('desk1', 'demo-password')
      r.replace(route.query.redirect || '/')
    }
    return { login }
  },
  template: '<button type="button" data-test="login" @click="login">以 desk1 登入</button>',
}

router = createRouter({
  history: createMemoryHistory(),     // 沙箱的網址是 about:srcdoc
  routes: [
    { path: '/', component: { template: '<p>首頁</p>' } },
    { path: '/login', component: LoginPage },
    { path: '/appointments', component: AppointmentsPage, meta: { requiresAuth: true } },
    { path: '/reports', component: ReportsPage, meta: { requiresAuth: true } },
  ],
})

router.beforeEach((to) => {
  if (to.meta.requiresAuth && !useAuthStore().token) return { path: '/login', query: { redirect: to.fullPath } }
})

createApp({
  setup() {
    const route = useRoute()
    const { username } = storeToRefs(useAuthStore())
    return { route, username }
  },
  template: \`
    <header>
      <span data-test="who">{{ username || '未登入' }}</span>
      <RouterLink to="/appointments" data-test="to-appointments">預約</RouterLink>
      <RouterLink to="/reports" data-test="to-reports">報表</RouterLink>
      <RouterLink to="/login?redirect=//evil.example" data-test="evil-link">可疑連結</RouterLink>
      <span data-test="path">{{ route.fullPath }}</span>
    </header>
    <RouterView />\`,
}).use(createPinia()).use(router).mount('#app')
`,
    solution: `import { createApp, ref, onMounted } from 'vue'
import { createPinia, defineStore, storeToRefs } from 'pinia'
import { createRouter, createMemoryHistory, RouterLink, RouterView, useRoute, useRouter } from 'vue-router'

// token 只放在記憶體：重新整理就要重新登入，頁面上的 script 也只能在當下讀到
const useAuthStore = defineStore('auth', () => {
  const token = ref(null)
  const username = ref(null)
  async function login(name, password) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: name, password }),
    })
    if (!res.ok) throw new Error('帳號或密碼錯誤')
    token.value = (await res.json()).access_token
    username.value = name
  }
  function logout() {
    token.value = null
    username.value = null
  }
  return { token, username, login, logout }
})

class ForbiddenError extends Error {}

let router

async function apiFetch(path) {
  const auth = useAuthStore()
  const res = await fetch(path, { headers: auth.token ? { Authorization: 'Bearer ' + auth.token } : {} })
  if (res.status === 401) {                               // 沒登入或過期：清掉狀態，帶著原本的網址去登入
    auth.logout()
    router.replace({ path: '/login', query: { redirect: router.currentRoute.value.fullPath } })
    throw new Error('請先登入')
  }
  if (res.status === 403) throw new ForbiddenError('沒有權限')   // 登入了但不能做：重新登入也一樣
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

const AppointmentsPage = {
  setup() {
    const rows = ref([])
    const error = ref('')
    async function load() {
      error.value = ''
      try { rows.value = (await apiFetch('/api/appointments')).items } catch (e) { if (e.message !== '請先登入') error.value = '讀取失敗' }
    }
    onMounted(load)
    return { rows, error, load }
  },
  template: \`
    <button type="button" data-test="reload" @click="load">重新整理</button>
    <p v-if="error" role="alert">{{ error }}</p>
    <ul><li v-for="a in rows" :key="a.id" data-test="row">{{ a.number }} 號</li></ul>\`,
}

const ReportsPage = {
  setup() {
    const state = ref('loading')
    onMounted(async () => {
      try { await apiFetch('/api/reports'); state.value = 'ok' } catch (e) { state.value = e instanceof ForbiddenError ? 'forbidden' : 'error' }
    })
    return { state }
  },
  template: \`
    <p v-if="state === 'ok'">報表</p>
    <p v-else-if="state === 'forbidden'" data-test="forbidden">沒有權限</p>
    <p v-else-if="state === 'error'" role="alert">讀取失敗</p>\`,
}

// 只接受站內路徑：/ 開頭、不是 //（//evil.example 會被當成另一個網域）
const safeRedirect = (r) => (typeof r === 'string' && r.startsWith('/') && !r.startsWith('//') ? r : '/')

const LoginPage = {
  setup() {
    const route = useRoute()
    const r = useRouter()
    const auth = useAuthStore()
    async function login() {
      await auth.login('desk1', 'demo-password')
      r.replace(safeRedirect(route.query.redirect))
    }
    return { login }
  },
  template: '<button type="button" data-test="login" @click="login">以 desk1 登入</button>',
}

router = createRouter({
  history: createMemoryHistory(),     // 沙箱的網址是 about:srcdoc
  routes: [
    { path: '/', component: { template: '<p>首頁</p>' } },
    { path: '/login', component: LoginPage },
    { path: '/appointments', component: AppointmentsPage, meta: { requiresAuth: true } },
    { path: '/reports', component: ReportsPage, meta: { requiresAuth: true } },
  ],
})

router.beforeEach((to) => {
  if (to.meta.requiresAuth && !useAuthStore().token) return { path: '/login', query: { redirect: to.fullPath } }
})

createApp({
  setup() {
    const route = useRoute()
    const { username } = storeToRefs(useAuthStore())
    return { route, username }
  },
  template: \`
    <header>
      <span data-test="who">{{ username || '未登入' }}</span>
      <RouterLink to="/appointments" data-test="to-appointments">預約</RouterLink>
      <RouterLink to="/reports" data-test="to-reports">報表</RouterLink>
      <RouterLink to="/login?redirect=//evil.example" data-test="evil-link">可疑連結</RouterLink>
      <span data-test="path">{{ route.fullPath }}</span>
    </header>
    <RouterView />\`,
}).use(createPinia()).use(router).mount('#app')
`,
    tests: [
      { name: '登入後清單有資料，token 不寫進 localStorage、sessionStorage', code: "const path = () => decodeURIComponent(text('[data-test=path]'))\nclick('[data-test=to-appointments]')\nawait waitFor(() => $('[data-test=login]'))\nclick('[data-test=login]')\nawait waitFor(() => $$('[data-test=row]').length === 2)\nassertEqual([path(), text('[data-test=who]')], ['/appointments', 'desk1'], '路徑與頁首')\nassertEqual([localStorage.length, sessionStorage.length], [0, 0], 'localStorage 與 sessionStorage 的項目數')" },
      { name: 'token 失效（401）：清掉登入狀態，導到登入頁，登入後回來', code: "const path = () => decodeURIComponent(text('[data-test=path]'))\nclick('[data-test=to-appointments]')\nawait waitFor(() => $('[data-test=login]'))\nclick('[data-test=login]')\nawait waitFor(() => $$('[data-test=row]').length === 2)\napi.db.tokens = {}\nclick('[data-test=reload]')\nawait wait(250)\nassertEqual([path(), text('[data-test=who]')], ['/login?redirect=/appointments', '未登入'], '收到 401 之後的路徑與頁首')\nclick('[data-test=login]')\nawait waitFor(() => $$('[data-test=row]').length === 2)\nassertEqual(path(), '/appointments', '重新登入後的路徑')" },
      { name: '403：顯示沒有權限，不導去登入', code: "const path = () => decodeURIComponent(text('[data-test=path]'))\nclick('[data-test=to-reports]')\nawait waitFor(() => $('[data-test=login]'))\nclick('[data-test=login]')\nawait wait(400)\nassertEqual(path(), '/reports', '收到 403 之後的路徑')\nassertEqual(text('[data-test=forbidden]'), '沒有權限')\nassertEqual(text('[data-test=who]'), 'desk1', '登入狀態不動')" },
      { name: 'redirect 只接受站內路徑', code: "const path = () => decodeURIComponent(text('[data-test=path]'))\nclick('[data-test=evil-link]')\nawait waitFor(() => $('[data-test=login]'))\nclick('[data-test=login]')\nawait wait(300)\nassertEqual(path(), '/', '從 /login?redirect=//evil.example 登入後的路徑')" },
    ],
    hints: ['token 放在 store 的 `ref` 就好；寫進 localStorage 之後，頁面上任何 script 都讀得走，而且一直留到過期。', '401 與 403 分開：401 清掉登入狀態再導去登入，403 只顯示沒有權限。', '`redirect` 來自網址，任何人都改得到：只接受 `/` 開頭、不是 `//` 開頭的字串。'],
  },
  {
    id: 'api-errors-retry-1', skill: 'api-errors-retry', kind: 'js', level: 3,
    title: 'fetchWithRetry：只重試能重試的錯誤，退避、有上限、可以取消',
    prompt: '`fetchWithRetry(fetchImpl, path, options)` 包住 fetch（測試會傳入假的 `fetchImpl`）。現在它不分錯誤一律重試、間隔固定、POST 也重送、使用者取消後還在等下一次重試。改成：\n\n- 只對 `GET`、`HEAD`、`PUT`、`DELETE` 與帶 `Idempotency-Key` 標頭的請求自動重試\n- 可以重試的錯誤：網路錯誤（`fetchImpl` reject）、逾時、502、503、504；最多重試 `retries` 次（預設 2），間隔 `base × 2^n` 再乘上 0.5 到 1 之間的隨機值（`n` 從 0 開始）\n- 每次嘗試各自逾時 `timeout` 毫秒（例如 `AbortSignal.timeout(timeout)`，和 `options.signal` 一起用 `AbortSignal.any`）\n- 429：照 `Retry-After` 的秒數等待後重試（算在 `retries` 裡）；要等超過 `maxWait` 就不等，直接丟錯\n- 其他 4xx 與 500 不重試；失敗時丟出 `ApiError`（`name` 是 `ApiError`，有 `status` 與 Problem Details 的 `title`）\n- `options.signal` 被 abort 時（使用者按取消、元件卸載），等待中的重試也停止，不再呼叫 `fetchImpl`\n\n成功時回傳 `Response`。選項的預設值：`method = \'GET\'`、`retries = 2`、`base = 500`、`timeout = 8000`、`maxWait = 10000`。',
    starter: `class ApiError extends Error {
  constructor(status, problem) {
    super(problem?.title ?? 'HTTP ' + status)
    this.name = 'ApiError'
    this.status = status
    this.title = problem?.title ?? null
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchWithRetry(fetchImpl, path, { method = 'GET', headers, signal, retries = 2, base = 500 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetchImpl(path, { method, headers, signal })
      if (res.ok) return res
      if (attempt >= retries) throw new ApiError(res.status, await res.json().catch(() => null))
    } catch (err) {
      if (attempt >= retries) throw err
    }
    await sleep(base)                       // 失敗就等一下再試
  }
}

// 試跑：假伺服器先回 503 兩次再回 200
const script = [503, 503, 200]
let n = 0
const t0 = Date.now()
const fake = async () => {
  const status = script[Math.min(n++, script.length - 1)]
  console.log(Date.now() - t0, 'ms →', status)
  return new Response(status === 200 ? '[]' : JSON.stringify({ title: '暫停服務', status }), { status })
}
try {
  const res = await fetchWithRetry(fake, '/api/appointments', { base: 50 })
  console.log('結果', res.status)
} catch (err) {
  console.log('失敗', err.name, err.status)
}
`,
    solution: `class ApiError extends Error {
  constructor(status, problem) {
    super(problem?.title ?? 'HTTP ' + status)
    this.name = 'ApiError'
    this.status = status
    this.title = problem?.title ?? null
  }
}

// 等待也要能被取消：signal abort 時立刻結束
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason)
  const t = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason) }, { once: true })
})
const backoff = (attempt, base) => base * 2 ** attempt * (0.5 + Math.random() / 2)   // 指數退避加抖動
function retryAfterMs(value) {
  if (value === null) return null
  if (/^\\d+$/.test(value)) return Number(value) * 1000           // 秒數
  const t = Date.parse(value)                                       // 或 HTTP 日期
  return Number.isNaN(t) ? null : Math.max(0, t - Date.now())
}

async function fetchWithRetry(fetchImpl, path, { method = 'GET', headers, signal, retries = 2, base = 500, timeout = 8000, maxWait = 10_000 } = {}) {
  const h = new Headers(headers)
  const canRetry = ['GET', 'HEAD', 'PUT', 'DELETE'].includes(method) || h.has('Idempotency-Key')   // 冪等的才自動重試
  for (let attempt = 0; ; attempt++) {
    let res
    try {
      const s = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)
      res = await fetchImpl(path, { method, headers: h, signal: s })
    } catch (err) {
      if (signal?.aborted) throw err                               // 使用者取消：不重試
      if (!canRetry || attempt >= retries) throw err               // 網路錯誤或逾時
      await sleep(backoff(attempt, base), signal)
      continue
    }
    if (res.ok) return res
    if (res.status === 429 && canRetry && attempt < retries) {     // 照伺服器說的等
      const wait = retryAfterMs(res.headers.get('Retry-After'))
      if (wait !== null && wait <= maxWait) { await sleep(wait, signal); continue }
    } else if ([502, 503, 504].includes(res.status) && canRetry && attempt < retries) {
      await sleep(backoff(attempt, base), signal)
      continue
    }
    throw new ApiError(res.status, await res.json().catch(() => null))
  }
}

// 試跑：假伺服器先回 503 兩次再回 200
const script = [503, 503, 200]
let n = 0
const t0 = Date.now()
const fake = async () => {
  const status = script[Math.min(n++, script.length - 1)]
  console.log(Date.now() - t0, 'ms →', status)
  return new Response(status === 200 ? '[]' : JSON.stringify({ title: '暫停服務', status }), { status })
}
try {
  const res = await fetchWithRetry(fake, '/api/appointments', { base: 50 })
  console.log('結果', res.status)
} catch (err) {
  console.log('失敗', err.name, err.status)
}
`,
    tests: [
      { name: '503 兩次後成功：回傳 Response', code: FAKE_SERVER + "const s = server([503, 503, 200])\nconst res = await fetchWithRetry(s.impl, '/api/appointments', { base: 20 })\nassertEqual([res.status, s.times.length], [200, 3], '狀態碼與請求次數')" },
      { name: '403 不重試，丟出帶 status 與 title 的 ApiError', code: FAKE_SERVER + "const s = server([403, 200])\nconst err = await fetchWithRetry(s.impl, '/api/appointments', { base: 20 }).catch((e) => e)\nassertEqual(s.times.length, 1, '請求次數')\nassertEqual([err.name, err.status, err.title], ['ApiError', 403, '錯誤 403'], 'name、status、title')" },
      { name: '500 與 422 也不重試', code: FAKE_SERVER + "for (const code of [500, 422]) {\n  const s = server([code, 200])\n  const err = await fetchWithRetry(s.impl, '/api/appointments', { base: 20 }).catch((e) => e)\n  assertEqual([s.times.length, err.status], [1, code], code + ' 的請求次數與錯誤的 status')\n}" },
      { name: 'POST 沒有 Idempotency-Key 不自動重試；帶了才重試', code: FAKE_SERVER + "const a = server([503, 200])\nconst err = await fetchWithRetry(a.impl, '/api/sessions/7/appointments', { method: 'POST', base: 20 }).catch((e) => e)\nassertEqual([a.times.length, err.status], [1, 503], '沒有冪等鍵：請求次數與錯誤的 status')\nconst b = server([503, 200])\nconst res = await fetchWithRetry(b.impl, '/api/sessions/7/appointments', { method: 'POST', headers: { 'Idempotency-Key': 'k-1' }, base: 20 })\nassertEqual([b.times.length, res.status], [2, 200], '帶冪等鍵：請求次數與狀態碼')" },
      { name: '指數退避：間隔一次比一次長，次數有上限', code: FAKE_SERVER + "const s = server([503])\nconst err = await fetchWithRetry(s.impl, '/api/appointments', { base: 40, retries: 3 }).catch((e) => e)\nassertEqual([s.times.length, err.status], [4, 503], '請求次數（1 次加 3 次重試）與最後的錯誤')\nconst gaps = s.times.slice(1).map((t, i) => t - s.times[i])\nconst ok = gaps[0] >= 15 && gaps[0] <= 70 && gaps[1] >= 35 && gaps[1] <= 120 && gaps[2] >= 75 && gaps[2] <= 220\nassert(ok, '間隔應該大約落在 20–40、40–80、80–160 ms：實際是 ' + gaps.map((g) => Math.round(g)).join('、') + ' ms')" },
      { name: '網路錯誤與逾時都會重試', code: FAKE_SERVER + "const a = server(['net', 200])\nassertEqual((await fetchWithRetry(a.impl, '/api/appointments', { base: 20 })).status, 200, '網路錯誤後重試')\nassertEqual(a.times.length, 2, '網路錯誤：請求次數')\nconst b = server(['hang', 200])\nconst t0 = Date.now()\nassertEqual((await fetchWithRetry(b.impl, '/api/appointments', { base: 20, timeout: 100 })).status, 200, '逾時後重試')\nassertEqual(b.times.length, 2, '逾時：請求次數')\nassert(Date.now() - t0 < 1000, '第一次逾時要在 100 ms 左右結束，實際花了 ' + (Date.now() - t0) + ' ms')" },
      { name: '429：照 Retry-After 等；要等太久就直接丟錯', code: FAKE_SERVER + "const a = server(['429:1', 200])\nconst res = await fetchWithRetry(a.impl, '/api/appointments', { base: 20 })\nassertEqual([res.status, a.times.length], [200, 2], '狀態碼與請求次數')\nassert(a.times[1] - a.times[0] >= 950, 'Retry-After: 1 要等 1 秒，實際等了 ' + Math.round(a.times[1] - a.times[0]) + ' ms')\nconst b = server(['429:30', 200])\nconst t0 = Date.now()\nconst err = await fetchWithRetry(b.impl, '/api/appointments', { base: 20 }).catch((e) => e)\nassertEqual([b.times.length, err.status], [1, 429], 'Retry-After: 30 超過 maxWait：請求次數與錯誤的 status')\nassert(Date.now() - t0 < 500, '不等的時候要直接丟錯')" },
      { name: '使用者取消：等待中的重試也停止', code: FAKE_SERVER + "const s = server([503])\nconst c = new AbortController()\nsetTimeout(() => c.abort(), 50)\nconst t0 = Date.now()\nconst err = await fetchWithRetry(s.impl, '/api/appointments', { base: 300, signal: c.signal }).catch((e) => e)\nconst ms = Date.now() - t0\nawait new Promise((r) => setTimeout(r, 400))\nassert(err instanceof Error || err instanceof DOMException, '取消後要丟錯')\nassertEqual(s.times.length, 1, '取消之後的請求次數')\nassert(ms < 200, '取消後要馬上結束，實際花了 ' + ms + ' ms')" },
    ],
    hints: ['先判斷能不能重試：方法是冪等的或帶 `Idempotency-Key`，錯誤是網路、逾時、502、503、504 或 429。', '`base * 2 ** attempt * (0.5 + Math.random() / 2)`：第 0 次重試等 0.5 到 1 倍的 `base`，之後每次加倍。', '等待用的 `sleep` 也收 `signal`：abort 時 `clearTimeout` 並 reject，迴圈就不會再送下一次。'],
  },
  {
    id: 'realtime-frontend-1', skill: 'realtime-frontend', kind: 'vue', level: 2,
    title: '看板輪詢：上一次回來才排下一次，分頁在背景時暫停',
    prompt: '門診看板 `QueueBoard` 每 `POLL_MS` 毫秒（題目設 300 ms）抓一次 `GET /api/queue`。現在用 `setInterval`：伺服器慢的時候同時有好幾個請求在路上；分頁切到背景之後還一直在抓。改成：\n\n- 用 `setTimeout` 串起來：上一次的請求結束（成功或失敗）才排下一次，同一時間最多一個請求在路上\n- 監聽 `document` 的 `visibilitychange`：`document.visibilityState` 是 `hidden` 時清掉計時器、不再排下一次；回到 `visible` 時馬上抓一次，再恢復輪詢\n- 元件卸載時清掉計時器、移除 `visibilitychange` 監聽，並取消還在路上的請求\n\n測試用 `setVisibility(\'hidden\')`、`setVisibility(\'visible\')` 模擬分頁切到背景與回到前景。每個診間一個 `<li>`，`data-test="toggle"` 切換看板與掛號頁。`GET /api/queue` 回傳 `[{ room, current }]`。',
    api: "let n = 0\napi.get('/api/queue', () => ({ body: [{ room: 101, current: 12 + n++ }, { room: 102, current: 5 }], delay: 50 }))",
    starter: `import { createApp, ref, onMounted, onUnmounted } from 'vue'

const POLL_MS = 300   // 題目縮短成 0.3 秒

const QueueBoard = {
  setup() {
    const rooms = ref([])
    let timer = null
    async function load() {
      try {
        const res = await fetch('/api/queue')
        if (res.ok) rooms.value = await res.json()
      } catch (err) {
        console.warn('看板更新失敗：', err.message)
      }
    }
    onMounted(() => {
      load()
      timer = setInterval(load, POLL_MS)
    })
    onUnmounted(() => clearInterval(timer))
    return { rooms }
  },
  template: \`<ul><li v-for="r in rooms" :key="r.room">{{ r.room }} 診：{{ r.current }} 號</li></ul>\`,
}

createApp({
  components: { QueueBoard },
  setup() { return { page: ref('board') } },
  template: \`
    <button type="button" data-test="toggle" @click="page = page === 'board' ? 'booking' : 'board'">切換頁面</button>
    <QueueBoard v-if="page === 'board'" />
    <p v-else>掛號頁</p>\`,
}).mount('#app')
`,
    solution: `import { createApp, ref, onMounted, onUnmounted } from 'vue'

const POLL_MS = 300   // 題目縮短成 0.3 秒

const QueueBoard = {
  setup() {
    const rooms = ref([])
    let timer = null
    let controller = null
    let running = false
    let stopped = false

    async function tick() {
      if (stopped || running) return            // 同一時間只跑一個
      running = true
      controller = new AbortController()
      try {
        const res = await fetch('/api/queue', { signal: controller.signal })
        if (res.ok) rooms.value = await res.json()
      } catch (err) {
        if (err.name !== 'AbortError') console.warn('看板更新失敗：', err.message)
      } finally {
        running = false
      }
      // 上一次結束才排下一次；在背景時不排
      if (!stopped && document.visibilityState === 'visible') timer = setTimeout(tick, POLL_MS)
    }
    function onVisibility() {
      clearTimeout(timer)
      if (document.visibilityState === 'visible') tick()   // 回到前景：馬上抓一次
    }
    onMounted(() => {
      tick()
      document.addEventListener('visibilitychange', onVisibility)
    })
    onUnmounted(() => {
      stopped = true
      clearTimeout(timer)
      controller?.abort()
      document.removeEventListener('visibilitychange', onVisibility)
    })
    return { rooms }
  },
  template: \`<ul><li v-for="r in rooms" :key="r.room">{{ r.room }} 診：{{ r.current }} 號</li></ul>\`,
}

createApp({
  components: { QueueBoard },
  setup() { return { page: ref('board') } },
  template: \`
    <button type="button" data-test="toggle" @click="page = page === 'board' ? 'booking' : 'board'">切換頁面</button>
    <QueueBoard v-if="page === 'board'" />
    <p v-else>掛號頁</p>\`,
}).mount('#app')
`,
    tests: [
      { name: '定時更新看板', code: "await waitFor(() => $$('li').length === 2)\nawait wait(800)\nassert(api.calls.length >= 3, '0.8 秒內只送了 ' + api.calls.length + ' 次請求')\nassert(!text('li').includes('12 號'), '看板要顯示最新的號碼：' + text('li'))" },
      { name: '伺服器慢的時候，同一時間最多一個請求在路上', api: "api.get('/api/queue', { body: [{ room: 101, current: 12 }], delay: 500 })", code: "let most = 0\nconst t = setInterval(() => { most = Math.max(most, api.calls.filter((c) => c.status === null && !c.aborted && !c.network).length) }, 20)\nawait wait(1600)\nclearInterval(t)\nassertEqual(most, 1, '同時在路上的請求數最多')\nassert(api.calls.length >= 2, '慢的時候也要繼續輪詢：1.6 秒內 ' + api.calls.length + ' 次')" },
      { name: '分頁在背景時暫停', code: "await waitFor(() => $$('li').length === 2)\nsetVisibility('hidden')\nawait wait(150)\nconst n = api.calls.length\nawait wait(900)\nassertEqual(api.calls.length, n, '在背景 0.9 秒之後的請求數')" },
      { name: '回到前景時馬上抓一次，之後恢復輪詢', code: "await waitFor(() => $$('li').length === 2)\nsetVisibility('hidden')\nawait wait(500)\nconst n = api.calls.length\nsetVisibility('visible')\nawait wait(60)\nassertEqual(api.calls.length, n + 1, '回到前景 60 ms 內的請求數')\nawait wait(800)\nassert(api.calls.length >= n + 3, '回到前景後要恢復輪詢：0.8 秒內只多了 ' + (api.calls.length - n - 1) + ' 次')" },
      { name: '卸載後不再送請求', code: "await waitFor(() => $$('li').length === 2)\nawait wait(100)\nclick('[data-test=toggle]')\nawait tick()\nconst n = api.calls.length\nawait wait(800)\nassertEqual(api.calls.length, n, '卸載之後的請求數')" },
    ],
    hints: ['`setInterval` 不管上一次回來沒有；改成在 `finally` 之後 `timer = setTimeout(tick, POLL_MS)`。', '`visibilitychange` 時先 `clearTimeout(timer)`；`visible` 就馬上呼叫一次 `tick()`，它結束後會自己排下一次。', '`onUnmounted` 裡清計時器、移除監聽、`controller.abort()`；用一個 `stopped` 旗標擋住已經在路上的那一次排下一次。'],
  },
]

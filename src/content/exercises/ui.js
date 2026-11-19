// 程式題：UI 元件詞彙（vue、html、css 題都在沙箱 iframe 裡執行，fetch 由假 API 回應）
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
  {
    id: 'buttons-inputs-1', skill: 'buttons-inputs', kind: 'html', serial: true, level: 1,
    title: '掛號確認頁：按鈕的 type、label 與立即生效的開關',
    prompt: '掛號確認頁有幾個元件選錯或少了屬性：按「回上一步」會送出掛號；欄位只有 placeholder，沒有 label；手機欄位跳出英文鍵盤；病歷號用 `disabled`，送出時值不見了；「接收簡訊提醒」是用 `span` 做的開關，切完還要按「確認掛號」才儲存；刪除預約的圖示沒有名稱、只有 16×16。改成：\n\n- 「病歷號」「手機」「主訴」都有看得見的 `<label>`（文字分別是這三個詞）；placeholder 只放格式範例\n- 手機是 `type="tel"` 加 `autocomplete="tel"`\n- 病歷號改成 `readonly`：能聚焦、不能改，值會隨表單送出\n- 「回上一步」是 `type="button"` 的 secondary 按鈕（`class="btn secondary"`），只把 `#step` 改成「第 1 步：基本資料」；整個表單只有「確認掛號」一顆 primary，它是送出鈕\n- 「接收簡訊提醒」是立即生效的開關：`<button type="button" role="switch" aria-checked="true">`，點一下切換 `aria-checked`，並立刻送出 `PATCH /api/me/preferences`，body 是 `{ "smsReminder": false }` 這樣的 JSON；不送出表單。用原生 checkbox 做也可以，一樣要立即送出\n- 預約清單的刪除是 Icon button：`<button type="button" aria-label="刪除 11/20 的預約">`，點擊範圍至少 24×24 px，圖示 `aria-hidden="true"`；點了移除那一列',
    api: "api.patch('/api/me/preferences', (req) => ({ body: req.body }))",
    starter: `<form id="booking">
  <h2 id="step">第 2 步：確認資料</h2>
  <input name="chartNo" value="0012345" disabled>
  <input name="phone" placeholder="手機號碼">
  <textarea name="note" placeholder="主訴（200 字以內）" maxlength="200"></textarea>
  <p><span class="switch is-on" id="sms">接收簡訊提醒</span></p>
  <div class="actions">
    <button class="btn primary" id="back">回上一步</button>
    <button class="btn primary">確認掛號</button>
  </div>
</form>
<ul class="appointments">
  <li>11/20 09:30 家醫科 101 診 <span class="icon" id="remove"><svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M5 1h6v2h4v2H1V3h4zM2 6h12l-1 9H3z"/></svg></span></li>
</ul>
<p id="result" role="status"></p>

<style>
  body { font: 16px/1.5 system-ui, sans-serif; }
  #booking { display: grid; gap: 8px; max-width: 360px; }
  .btn { min-height: 44px; padding: 0 16px; border-radius: 8px; font: inherit; }
  .btn.primary { background: #2563eb; color: #fff; border: 0; }
  .btn.secondary { background: transparent; color: #2563eb; border: 1px solid #2563eb; }
  .switch.is-on { font-weight: 700; }
</style>
<script type="module">
  const form = document.querySelector('#booking')
  document.querySelector('#back').addEventListener('click', () => {
    document.querySelector('#step').textContent = '第 1 步：基本資料'
  })
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const data = new FormData(form)
    document.querySelector('#result').textContent = \`已送出：病歷號 \${data.get('chartNo')}\`
  })
  // 切換後要等「確認掛號」才一起儲存
  const sms = document.querySelector('#sms')
  sms.addEventListener('click', () => sms.classList.toggle('is-on'))
  document.querySelector('#remove').addEventListener('click', (event) => event.target.closest('li').remove())
</script>
`,
    solution: `<form id="booking">
  <h2 id="step">第 2 步：確認資料</h2>

  <!-- readonly：能聚焦、會被念出來，值也會隨表單送出；disabled 兩者都不行 -->
  <label for="chart">病歷號</label>
  <input id="chart" name="chartNo" value="0012345" readonly>

  <label for="phone">手機</label>
  <input id="phone" name="phone" type="tel" autocomplete="tel" placeholder="0912345678" aria-describedby="phone-hint">
  <p id="phone-hint" class="hint">09 開頭共 10 碼</p>

  <label for="note">主訴</label>
  <textarea id="note" name="note" maxlength="200" placeholder="例如：咳嗽三天"></textarea>

  <!-- 立即生效的開關：切換就送出，不等「確認掛號」；type="button" 不會送出表單 -->
  <button type="button" id="sms" class="switch" role="switch" aria-checked="true">接收簡訊提醒</button>

  <div class="actions">
    <button type="button" class="btn secondary" id="back">回上一步</button>
    <button type="submit" class="btn primary">確認掛號</button>
  </div>
</form>
<ul class="appointments">
  <li>11/20 09:30 家醫科 101 診
    <button type="button" class="icon-btn" aria-label="刪除 11/20 的預約">
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M5 1h6v2h4v2H1V3h4zM2 6h12l-1 9H3z"/></svg>
    </button>
  </li>
</ul>
<p id="result" role="status"></p>

<style>
  body { font: 16px/1.5 system-ui, sans-serif; }
  #booking { display: grid; gap: 8px; max-width: 360px; }
  .hint { margin: 0; color: #4b5563; }
  .btn { min-height: 44px; padding: 0 16px; border-radius: 8px; font: inherit; }
  .btn.primary { background: #2563eb; color: #fff; border: 0; }
  .btn.secondary { background: transparent; color: #2563eb; border: 1px solid #2563eb; }
  .switch { justify-self: start; font: inherit; }
  .switch[aria-checked="true"] { background: #2563eb; color: #fff; }
  .icon-btn { inline-size: 32px; block-size: 32px; display: inline-grid; place-items: center; padding: 0; }   /* 圖示 16px，點擊範圍 32px */
</style>
<script type="module">
  const form = document.querySelector('#booking')
  document.querySelector('#back').addEventListener('click', () => {
    document.querySelector('#step').textContent = '第 1 步：基本資料'
  })
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const data = new FormData(form)
    document.querySelector('#result').textContent = \`已送出：病歷號 \${data.get('chartNo')}\`
  })

  const sms = document.querySelector('#sms')
  sms.addEventListener('click', async () => {
    const on = sms.getAttribute('aria-checked') !== 'true'
    sms.setAttribute('aria-checked', String(on))
    await fetch('/api/me/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ smsReminder: on }),
    })
  })

  document.querySelector('.appointments').addEventListener('click', (event) => {
    if (event.target.closest('.icon-btn')) event.target.closest('li').remove()
  })
</script>
`,
    tests: [
      { name: '病歷號、手機、主訴都有 label', code: "const field = (name) => $$('label').find((l) => l.textContent.trim().startsWith(name))?.control\nfor (const name of ['病歷號', '手機', '主訴']) assert(field(name), '「' + name + '」沒有用 <label> 對到欄位（for 對 id，或把欄位包在 label 裡）')\nassertEqual([field('病歷號').name, field('手機').name, field('主訴').name], ['chartNo', 'phone', 'note'], '三個 label 對到的欄位 name')" },
      { name: '手機用 tel 與 autocomplete', code: "const phone = $('[name=phone]')\nassertEqual([phone.type, phone.autocomplete], ['tel', 'tel'], '手機欄位的 [type, autocomplete]')" },
      { name: '病歷號 readonly：能聚焦、不能改、會隨表單送出', code: "const chart = $('[name=chartNo]')\nassert(!chart.disabled, '病歷號不能 disabled：拿不到焦點，值也不會送出')\nassert(chart.readOnly, '病歷號要 readonly')\nfocus(chart)\nassertEqual(document.activeElement, chart, '病歷號要能聚焦')\nlet sent = null\ndocument.addEventListener('submit', (e) => { sent = new FormData(e.target).get('chartNo') }, true)\nclick($$('#booking button').find((b) => b.textContent.trim() === '確認掛號'))\nawait tick()\nassertEqual(sent, '0012345', '送出的 chartNo')" },
      { name: '「回上一步」不送出表單，只有一顆 primary', code: "let submits = 0\ndocument.addEventListener('submit', () => submits++, true)\nconst back = $$('#booking button').find((b) => b.textContent.trim() === '回上一步')\nassert(back, '找不到「回上一步」')\nassertEqual(back.type, 'button', '「回上一步」的 type')\nclick(back)\nawait tick()\nassertEqual(submits, 0, '按「回上一步」觸發的 submit 次數')\nassertEqual(text('#step'), '第 1 步：基本資料')\nassert(back.classList.contains('secondary') && !back.classList.contains('primary'), '「回上一步」要是 secondary')\nassertEqual($$('#booking .btn.primary').map((b) => [b.textContent.trim(), b.type]), [['確認掛號', 'submit']], '表單裡的 primary 按鈕')" },
      { name: '簡訊提醒是立即生效的開關', code: "let submits = 0\ndocument.addEventListener('submit', () => submits++, true)\nconst sw = $('[role=switch]') || $$('input[type=checkbox]').find((c) => c.labels && [...c.labels].some((l) => l.textContent.includes('接收簡訊提醒')))\nassert(sw, '找不到「接收簡訊提醒」的開關：<button role=\"switch\">，或有 label 的 checkbox')\nconst state = () => sw.getAttribute('role') === 'switch' ? sw.getAttribute('aria-checked') : String(sw.checked)\nif (sw.getAttribute('role') === 'switch') {\n  assert(sw.tagName === 'BUTTON' || sw.tabIndex >= 0, '開關要能用鍵盤操作（用 <button>）')\n  if (sw.tagName === 'BUTTON') assertEqual(sw.type, 'button', '開關按鈕的 type')\n  assert((sw.getAttribute('aria-label') || sw.textContent).includes('接收簡訊提醒'), '開關的名稱要是「接收簡訊提醒」')\n}\nassertEqual(state(), 'true', '一開始的狀態')\nclick(sw)\nawait waitFor(() => api.calls.some((c) => c.method === 'PATCH'))\nassertEqual(state(), 'false', '點一下之後的狀態')\nconst patch = api.calls.filter((c) => c.method === 'PATCH')\nassertEqual([patch.length, patch[0].url, patch[0].body], [1, '/api/me/preferences', { smsReminder: false }], '[PATCH 次數, 網址, body]')\nassertEqual(submits, 0, '切換開關觸發的 submit 次數')" },
      { name: '刪除是有名稱的 Icon button，點擊範圍至少 24×24', code: "const btn = $('.appointments li button')\nassert(btn, '刪除要用 <button>，不是 span 加 click')\nassertEqual([btn.type, btn.getAttribute('aria-label')], ['button', '刪除 11/20 的預約'], 'Icon button 的 [type, aria-label]')\nconst b = box(btn)\nassert(b.width >= 24 && b.height >= 24, '點擊範圍只有 ' + Math.round(b.width) + '×' + Math.round(b.height) + ' px，至少 24×24')\nconst svg = btn.querySelector('svg')\nassert(!svg || svg.getAttribute('aria-hidden') === 'true', '圖示要 aria-hidden=\"true\"')\nclick(btn)\nawait tick()\nassertEqual($$('.appointments li').length, 0, '點了之後剩下的列數')" },
    ],
    hints: ['`form` 裡沒寫 `type` 的 `button` 是送出鈕；不送出的寫 `type="button"`。', '`readonly` 的欄位拿得到焦點、值會送出；`disabled` 兩者都不行。', '立即生效的開關在 click 裡直接 `fetch`，不等表單送出；只有圖示的按鈕用 `aria-label` 給名稱。'],
  },
  {
    id: 'select-combobox-1', skill: 'select-combobox', kind: 'html', serial: true, level: 3,
    title: '看診醫師的 Combobox：角色、ARIA 與鍵盤操作',
    prompt: '「看診醫師」是可以輸入篩選的下拉清單，現在只寫了滑鼠點擊：沒有角色與 ARIA 屬性、方向鍵沒反應，查無結果時清單直接消失。照 WAI-ARIA APG 的 Combobox 模式改寫（DOM 焦點一直留在輸入框）：\n\n- 「看診醫師」是綁到輸入框 `#doctor` 的 `<label>`；輸入框 `role="combobox"`、`aria-autocomplete="list"`、`aria-controls` 指向清單、`aria-expanded` 跟著清單開關（`"true"`／`"false"`）\n- 清單 `#doctor-list` 是 `role="listbox"`，每個選項 `role="option"`、有不重複的 `id`，不在 Tab 順序裡\n- ↓：清單關著時開啟並反白第一個；開著時移到下一個。↑：移到上一個。反白的選項用輸入框的 `aria-activedescendant` 指出，該選項 `aria-selected="true"`\n- Enter（清單開著、有反白的選項時）：選取並關閉清單，keydown 要 `preventDefault()`，不送出表單\n- Esc：只關閉清單，已選的醫師不變\n- 輸入文字時開啟清單、依姓名篩選；沒有符合的醫師時清單裡不放假的選項，頁面上一直存在的 `role="status"` 元素顯示「沒有符合的醫師」\n- 選到的醫師：輸入框顯示姓名，`name="doctorId"` 的隱藏欄位是醫師的 `id`；滑鼠點選項照樣能選',
    starter: `<form id="booking">
  <p class="label">看診醫師</p>
  <div class="combo">
    <input id="doctor" placeholder="輸入醫師姓名" autocomplete="off">
    <ul id="doctor-list" class="options" hidden></ul>
  </div>
  <input type="hidden" name="doctorId">
  <button>下一步</button>
</form>
<p id="picked"></p>

<style>
  body { font: 16px/1.5 system-ui, sans-serif; }
  .combo { position: relative; width: 280px; }
  .combo input { width: 100%; box-sizing: border-box; font: inherit; }
  .options { position: absolute; inset: 100% 0 auto; margin: 0; padding: 4px 0; list-style: none; background: #fff; border: 1px solid #222; }
  .options li { padding: 4px 8px; cursor: pointer; }
  .options li:hover { background: #dbeafe; }
</style>
<script type="module">
  const DOCTORS = [
    { id: 1, name: '王志明', dept: '家醫科' },
    { id: 2, name: '王美玲', dept: '小兒科' },
    { id: 3, name: '林建宏', dept: '骨科' },
    { id: 4, name: '陳怡君', dept: '眼科' },
  ]
  const input = document.querySelector('#doctor')
  const list = document.querySelector('#doctor-list')
  const hidden = document.querySelector('[name=doctorId]')

  function render() {
    const items = DOCTORS.filter((d) => d.name.includes(input.value.trim()))
    list.innerHTML = items.map((d) => \`<li data-id="\${d.id}">\${d.name}（\${d.dept}）</li>\`).join('')
    list.hidden = items.length === 0          // 沒有結果就把清單收起來
  }
  input.addEventListener('focus', render)
  input.addEventListener('input', render)
  list.addEventListener('click', (event) => {
    const li = event.target.closest('li')
    if (!li) return
    const doctor = DOCTORS.find((d) => d.id === Number(li.dataset.id))
    input.value = doctor.name
    hidden.value = doctor.id
    list.hidden = true
  })
  document.querySelector('#booking').addEventListener('submit', (event) => {
    event.preventDefault()
    document.querySelector('#picked').textContent = '已選 ' + input.value
  })
</script>
`,
    solution: `<form id="booking">
  <label for="doctor">看診醫師</label>
  <div class="combo">
    <input id="doctor" placeholder="輸入醫師姓名" autocomplete="off"
           role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="doctor-list">
    <ul id="doctor-list" class="options" role="listbox" aria-label="醫師" hidden></ul>
  </div>
  <!-- 一直在頁面上，只換文字：查無結果時念出來 -->
  <p role="status" id="doctor-status"></p>
  <input type="hidden" name="doctorId">
  <button>下一步</button>
</form>
<p id="picked"></p>

<style>
  body { font: 16px/1.5 system-ui, sans-serif; }
  .combo { position: relative; width: 280px; }
  .combo input { width: 100%; box-sizing: border-box; font: inherit; }
  .options { position: absolute; inset: 100% 0 auto; margin: 0; padding: 4px 0; list-style: none; background: #fff; border: 1px solid #222; }
  .options li { padding: 4px 8px; cursor: pointer; }
  .options li[aria-selected="true"] { background: #1d4ed8; color: #fff; }   /* 反白：和背景至少 3:1 */
</style>
<script type="module">
  const DOCTORS = [
    { id: 1, name: '王志明', dept: '家醫科' },
    { id: 2, name: '王美玲', dept: '小兒科' },
    { id: 3, name: '林建宏', dept: '骨科' },
    { id: 4, name: '陳怡君', dept: '眼科' },
  ]
  const input = document.querySelector('#doctor')
  const list = document.querySelector('#doctor-list')
  const status = document.querySelector('#doctor-status')
  const hidden = document.querySelector('[name=doctorId]')
  let items = []
  let active = -1          // 反白的選項，-1 表示沒有

  function render() {
    items = DOCTORS.filter((d) => d.name.includes(input.value.trim()))
    list.innerHTML = items.map((d, i) =>
      \`<li id="doctor-opt-\${d.id}" role="option" data-id="\${d.id}" aria-selected="\${i === active}">\${d.name}（\${d.dept}）</li>\`).join('')
    status.textContent = items.length ? '' : '沒有符合的醫師'
    if (active >= 0 && items[active]) input.setAttribute('aria-activedescendant', \`doctor-opt-\${items[active].id}\`)
    else input.removeAttribute('aria-activedescendant')
  }
  function open() {
    list.hidden = false
    input.setAttribute('aria-expanded', 'true')
    render()
  }
  function close() {
    list.hidden = true
    active = -1
    input.setAttribute('aria-expanded', 'false')
    input.removeAttribute('aria-activedescendant')
    status.textContent = ''
  }
  function pick(doctor) {
    input.value = doctor.name
    hidden.value = doctor.id
    close()
  }

  input.addEventListener('input', () => { active = -1; open() })
  input.addEventListener('keydown', (event) => {
    const isOpen = !list.hidden
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!isOpen) { active = 0; open(); return }
      active = Math.min(active + 1, items.length - 1)
      render()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (isOpen) { active = Math.max(active - 1, 0); render() }
    } else if (event.key === 'Enter' && isOpen && items[active]) {
      event.preventDefault()          // 清單開著時 Enter 選取，不送出表單
      pick(items[active])
    } else if (event.key === 'Escape' && isOpen) {
      close()                         // 只關清單，已選的值不變
    }
  })
  // mousedown 先 preventDefault：點選項時輸入框不會失去焦點
  list.addEventListener('mousedown', (event) => event.preventDefault())
  list.addEventListener('click', (event) => {
    const li = event.target.closest('[role=option]')
    if (li) pick(DOCTORS.find((d) => d.id === Number(li.dataset.id)))
  })
  input.addEventListener('blur', close)

  document.querySelector('#booking').addEventListener('submit', (event) => {
    event.preventDefault()
    document.querySelector('#picked').textContent = '已選 ' + input.value
  })
</script>
`,
    tests: [
      { name: '輸入框有名稱與 combobox 的角色', code: "const cb = $('#doctor')\nconst label = $$('label').find((l) => l.textContent.trim() === '看診醫師')\nassert(label && label.control === cb, '「看診醫師」要是綁到 #doctor 的 <label>')\nassertEqual([cb.getAttribute('role'), cb.getAttribute('aria-autocomplete'), cb.getAttribute('aria-expanded')], ['combobox', 'list', 'false'], '輸入框的 [role, aria-autocomplete, aria-expanded]')\nconst list = document.getElementById(cb.getAttribute('aria-controls') || '')\nassert(list, 'aria-controls 要指向清單的 id')\nassertEqual(list.getAttribute('role'), 'listbox', '清單的 role')" },
      { name: '↓ 開啟清單並反白第一個，焦點留在輸入框', code: "const cb = $('#doctor')\nfocus(cb)\npress(cb, 'ArrowDown')\nawait tick()\nassertEqual(cb.getAttribute('aria-expanded'), 'true', '按 ↓ 之後的 aria-expanded')\nconst opts = $$('[role=option]').filter((o) => o.getClientRects().length)\nassertEqual(opts.length, 4, '看得到的選項數')\nconst id = cb.getAttribute('aria-activedescendant')\nassert(id && document.getElementById(id), 'aria-activedescendant 要指向一個存在的選項 id（現在是 ' + id + '）')\nassertEqual(document.getElementById(id), opts[0], '反白的應該是第一個選項')\nassertEqual(opts[0].getAttribute('aria-selected'), 'true', '反白選項的 aria-selected')\nassertEqual(document.activeElement, cb, 'DOM 焦點要留在輸入框')\nassertEqual(new Set(opts.map((o) => o.id)).size, 4, '每個選項要有不重複的 id')" },
      { name: '↓、↑ 移動反白，Enter 選取並關閉清單', code: "const cb = $('#doctor')\nfocus(cb)\nconst current = () => document.getElementById(cb.getAttribute('aria-activedescendant') || '')?.textContent.trim()\nfor (const k of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowUp']) { press(cb, k); await tick() }\nassertEqual(current(), '王美玲（小兒科）', '↓ ↓ ↓ ↑ 之後反白的選項')\nassertEqual($$('[role=option][aria-selected=true]').length, 1, 'aria-selected=\"true\" 的選項數')\nconst ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })\ncb.dispatchEvent(ev)\nawait tick()\nassert(ev.defaultPrevented, '清單開著時按 Enter 要 preventDefault()，否則會送出表單')\nassertEqual([cb.value, $('[name=doctorId]').value, cb.getAttribute('aria-expanded')], ['王美玲', '2', 'false'], 'Enter 之後的 [輸入框, doctorId, aria-expanded]')" },
      { name: 'Esc 只關閉清單，已選的醫師不變', code: "const cb = $('#doctor')\nfocus(cb)\npress(cb, 'ArrowDown'); await tick()\npress(cb, 'Enter'); await tick()\nassertEqual([cb.value, $('[name=doctorId]').value], ['王志明', '1'], '先選第一位醫師')\npress(cb, 'ArrowDown'); await tick()\npress(cb, 'ArrowDown'); await tick()\nassertEqual(cb.getAttribute('aria-expanded'), 'true', '再按 ↓ 要重新開啟清單')\npress(cb, 'Escape'); await tick()\nassertEqual([cb.getAttribute('aria-expanded'), cb.value, $('[name=doctorId]').value], ['false', '王志明', '1'], 'Esc 之後的 [aria-expanded, 輸入框, doctorId]')\nassert(!$$('[role=option]').some((o) => o.getClientRects().length), 'Esc 之後清單要關起來')" },
      { name: '輸入時篩選；沒有符合的醫師用 role="status" 說明', code: "const status = $('[role=status]')\nassert(status, '頁面一開始就要有 role=\"status\" 的元素（訊息和容器同時插入，螢幕閱讀器不會念）')\nconst cb = $('#doctor')\ninput('#doctor', '王')\nawait tick()\nassertEqual(cb.getAttribute('aria-expanded'), 'true', '輸入時要開啟清單')\nassertEqual($$('[role=option]').filter((o) => o.getClientRects().length).map((o) => o.textContent.trim()), ['王志明（家醫科）', '王美玲（小兒科）'], '輸入「王」之後的選項')\ninput('#doctor', '不存在')\nawait tick()\nassertEqual($$('[role=option]').filter((o) => o.getClientRects().length).length, 0, '查無結果時不要放假的選項')\nassertEqual($('[role=status]'), status, 'role=\"status\" 要是同一個元素，只換文字')\nassertEqual(text(status), '沒有符合的醫師', 'role=\"status\" 的文字')" },
      { name: '選項不在 Tab 順序裡，滑鼠點選項照樣能選', code: "const cb = $('#doctor')\ninput('#doctor', '林')\nawait tick()\nconst opt = $$('[role=option]').find((o) => o.textContent.includes('林建宏'))\nassert(opt, '輸入「林」之後找不到林建宏')\nassert($$('[role=option]').every((o) => o.tabIndex < 0), '選項不要 tabindex=\"0\"：焦點留在輸入框，Tab 不走進清單')\nclick(opt)\nawait tick()\nassertEqual([cb.value, $('[name=doctorId]').value, cb.getAttribute('aria-expanded')], ['林建宏', '3', 'false'], '點選項之後的 [輸入框, doctorId, aria-expanded]')" },
    ],
    hints: ['keydown 監聽掛在輸入框上，用 `event.key` 判斷 `ArrowDown`、`ArrowUp`、`Enter`、`Escape`；焦點不移進清單，反白的選項用 `aria-activedescendant` 指出。', '清單開關時同時改 `hidden` 與輸入框的 `aria-expanded`，寫成 `open()`、`close()` 兩個函式比較不會漏。', '`role="status"` 的元素一開始就放在 HTML 裡，查無結果時只換它的文字。'],
  },
  {
    id: 'navigation-ui-1', skill: 'navigation-ui', kind: 'html', serial: true, level: 2,
    title: '門診管理頁：aria-current 與照 APG 的 Tabs',
    prompt: '門診管理頁的 Sidebar 只用 class 標出目前頁；「預約／已報到／已取消」三個分頁是用 `div` 做的，只能用滑鼠點，Tab 鍵到不了。改成：\n\n- Sidebar 是 `<nav aria-label="主要導覽">`，目前頁「門診管理」的連結加 `aria-current="page"`（樣式掛在這個屬性上），整個導覽只有這一個 `aria-current`\n- 分頁列 `role="tablist"`，`aria-label="預約狀態"`；三個分頁是 `<button type="button" role="tab">`，目前的分頁 `aria-selected="true"`、其他 `"false"`\n- 三個內容區塊是 `role="tabpanel"`，用 `aria-labelledby` 指向對應分頁的 `id`；只有目前分頁的 panel 顯示\n- roving tabindex：目前的分頁 `tabindex="0"`，其他 `tabindex="-1"`\n- 焦點在分頁上時：→ 移到下一個並直接切換（最後一個再按回到第一個），← 反過來，Home、End 到第一個與最後一個\n- 點分頁一樣切換\n\n分頁與 panel 的文字不要改。',
    starter: `<div class="layout">
  <nav class="sidebar">
    <a href="#/sessions" class="active">門診管理</a>
    <a href="#/patients">病患</a>
    <a href="#/reports">報表</a>
  </nav>
  <main>
    <h1>門診管理</h1>
    <div class="tabs">
      <div class="tab active" data-tab="booked">預約</div>
      <div class="tab" data-tab="checked-in">已報到</div>
      <div class="tab" data-tab="cancelled">已取消</div>
    </div>
    <section id="panel-booked">預約 12 筆</section>
    <section id="panel-checked-in" hidden>已報到 5 筆</section>
    <section id="panel-cancelled" hidden>已取消 2 筆</section>
  </main>
</div>

<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; }
  .layout { display: grid; grid-template-columns: 160px 1fr; gap: 16px; padding: 16px; }
  .sidebar { display: grid; align-content: start; gap: 4px; }
  .sidebar .active { font-weight: 700; }
  .tabs { display: flex; gap: 4px; border-bottom: 2px solid #222; }
  .tab { padding: 6px 12px; cursor: pointer; }
  .tab.active { border-bottom: 3px solid #2563eb; }
</style>
<script type="module">
  const tabs = document.querySelectorAll('.tab')
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      for (const t of tabs) t.classList.toggle('active', t === tab)
      for (const p of document.querySelectorAll('section')) p.hidden = p.id !== 'panel-' + tab.dataset.tab
    })
  }
</script>
`,
    solution: `<div class="layout">
  <nav class="sidebar" aria-label="主要導覽">
    <a href="#/sessions" aria-current="page">門診管理</a>
    <a href="#/patients">病患</a>
    <a href="#/reports">報表</a>
  </nav>
  <main>
    <h1>門診管理</h1>
    <div class="tabs" role="tablist" aria-label="預約狀態">
      <button type="button" role="tab" id="tab-booked" aria-selected="true" tabindex="0">預約</button>
      <button type="button" role="tab" id="tab-checked-in" aria-selected="false" tabindex="-1">已報到</button>
      <button type="button" role="tab" id="tab-cancelled" aria-selected="false" tabindex="-1">已取消</button>
    </div>
    <section role="tabpanel" id="panel-booked" aria-labelledby="tab-booked" tabindex="0">預約 12 筆</section>
    <section role="tabpanel" id="panel-checked-in" aria-labelledby="tab-checked-in" tabindex="0" hidden>已報到 5 筆</section>
    <section role="tabpanel" id="panel-cancelled" aria-labelledby="tab-cancelled" tabindex="0" hidden>已取消 2 筆</section>
  </main>
</div>

<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; }
  .layout { display: grid; grid-template-columns: 160px 1fr; gap: 16px; padding: 16px; }
  .sidebar { display: grid; align-content: start; gap: 4px; }
  .sidebar [aria-current="page"] { font-weight: 700; }   /* 樣式與輔助科技看同一個屬性 */
  .tabs { display: flex; gap: 4px; border-bottom: 2px solid #222; }
  [role="tab"] { position: relative; padding: 6px 12px; font: inherit; background: none; border: 0; }
  [role="tab"][aria-selected="true"]::after { content: ""; position: absolute; inset: auto 0 0; border-bottom: 3px solid #2563eb; }
</style>
<script type="module">
  const tabs = [...document.querySelectorAll('[role=tab]')]

  function select(tab) {
    for (const t of tabs) {
      const on = t === tab
      t.setAttribute('aria-selected', String(on))
      t.tabIndex = on ? 0 : -1                       // roving tabindex：Tab 鍵只停在目前的分頁
      document.querySelector(\`[aria-labelledby="\${t.id}"]\`).hidden = !on
    }
    tab.focus()
  }

  for (const tab of tabs) tab.addEventListener('click', () => select(tab))
  document.querySelector('[role=tablist]').addEventListener('keydown', (event) => {
    const i = tabs.indexOf(document.activeElement)
    if (i < 0) return
    const next = { ArrowRight: (i + 1) % tabs.length, ArrowLeft: (i - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key]
    if (next === undefined) return
    event.preventDefault()
    select(tabs[next])                               // 選取跟著焦點
  })
</script>
`,
    tests: [
      { name: 'Sidebar 用 nav 與 aria-current 標出目前頁', code: "const nav = $('nav[aria-label=\"主要導覽\"]')\nassert(nav, '找不到 <nav aria-label=\"主要導覽\">')\nconst cur = $$('[aria-current]')\nassertEqual(cur.map((a) => [a.textContent.trim(), a.getAttribute('aria-current')]), [['門診管理', 'page']], '帶 aria-current 的元素')\nassert(nav.contains(cur[0]), 'aria-current 要在 Sidebar 的連結上')" },
      { name: 'Tabs 的角色與關聯', code: "const list = $('[role=tablist]')\nassert(list, '找不到 role=\"tablist\"')\nassertEqual(list.getAttribute('aria-label'), '預約狀態', 'tablist 的 aria-label')\nconst tabs = $$('[role=tab]')\nassertEqual(tabs.map((t) => [t.tagName, t.type, t.textContent.trim()]), [['BUTTON', 'button', '預約'], ['BUTTON', 'button', '已報到'], ['BUTTON', 'button', '已取消']], '分頁的 [標籤, type, 文字]')\nassertEqual(tabs.map((t) => t.getAttribute('aria-selected')), ['true', 'false', 'false'], '分頁的 aria-selected')\nfor (const t of tabs) {\n  assert(t.id, t.textContent.trim() + '：分頁要有 id')\n  const p = $('[role=tabpanel][aria-labelledby=\"' + t.id + '\"]')\n  assert(p, t.textContent.trim() + '：找不到 aria-labelledby 指向它的 role=\"tabpanel\"')\n  assert(p.textContent.includes(t.textContent.trim()), t.textContent.trim() + ' 的 panel 對錯了：' + p.textContent.trim())\n}\nassertEqual($$('[role=tabpanel]').filter((p) => !p.hidden && p.getClientRects().length).map((p) => p.textContent.trim()), ['預約 12 筆'], '顯示中的 panel')" },
      { name: '只有目前的分頁在 Tab 順序裡', code: "assertEqual($$('[role=tab]').map((t) => t.tabIndex), [0, -1, -1], '分頁的 tabIndex')" },
      { name: '方向鍵、Home、End 切換分頁，焦點跟著移動', code: "const tabs = $$('[role=tab]')\nassertEqual(tabs.length, 3, 'role=\"tab\" 的分頁數')\nfocus(tabs[0])\nconst steps = [['ArrowRight', '已報到'], ['ArrowRight', '已取消'], ['ArrowRight', '預約'], ['ArrowLeft', '已取消'], ['Home', '預約'], ['End', '已取消']]\nfor (const [key, want] of steps) {\n  press(document.activeElement, key)\n  await tick()\n  const a = document.activeElement\n  assertEqual(a && a.textContent.trim(), want, '按 ' + key + ' 之後焦點所在的分頁')\n  assertEqual(a.getAttribute('aria-selected'), 'true', want + ' 的 aria-selected')\n  assertEqual($$('[role=tab]').map((t) => t.tabIndex).filter((x) => x === 0).length, 1, 'tabIndex 為 0 的分頁數')\n  assertEqual(a.tabIndex, 0, want + ' 的 tabIndex')\n  assertEqual($$('[role=tabpanel]').filter((p) => !p.hidden && p.getClientRects().length).map((p) => p.textContent.trim().split(' ')[0]), [want], '顯示中的 panel')\n}" },
      { name: '點分頁也會切換', code: "const tab = $$('[role=tab]').find((t) => t.textContent.trim() === '已報到')\nassert(tab, '找不到文字是「已報到」的 role=\"tab\"')\nclick(tab)\nawait tick()\nassertEqual($$('[role=tab]').map((t) => t.getAttribute('aria-selected')), ['false', 'true', 'false'], '點「已報到」之後的 aria-selected')\nassertEqual($$('[role=tabpanel]').filter((p) => !p.hidden && p.getClientRects().length).map((p) => p.textContent.trim()), ['已報到 5 筆'], '顯示中的 panel')" },
    ],
    hints: ['樣式改掛在 `[aria-current="page"]` 與 `[aria-selected="true"]` 上，畫面和輔助科技看的是同一個屬性。', 'keydown 掛在 tablist 上：算出下一個分頁的索引，更新每個分頁的 `aria-selected` 與 `tabindex`，再 `focus()` 新的分頁。', 'panel 用 `hidden` 切換；`aria-labelledby` 指向分頁的 `id`。'],
  },
  {
    id: 'overlays-1', skill: 'overlays', kind: 'html', serial: true, level: 2,
    title: '取消預約的確認視窗改用 <dialog>',
    prompt: '「取消預約」的確認視窗是 `div` 加 `position: fixed` 與 `z-index`：開啟後焦點留在後面那一列，背景還能操作；按 Esc 沒反應；關閉後焦點掉到 `body`。改用原生 `<dialog>`，用 `showModal()` 開啟（或按鈕的 `command="show-modal"` 與 `commandfor`）：\n\n- 開啟時是 modal：背景的連結與按鈕不能聚焦；Dialog 用 `aria-labelledby` 指向標題「取消 11/20 <時間> 的預約？」\n- 開啟時焦點在比較安全的「保留預約」\n- 「保留預約」與 Esc 都關閉 Dialog、不取消預約，焦點回到那一列的「取消預約」\n- 「確定取消」關閉 Dialog、移除那一列，焦點移到清單標題 `#appt-list-title`（它已經有 `tabindex="-1"`）\n\n`<form method="dialog">` 可以用。清單的標記（`.appts`、`li`、`.time`、`.cancel`、`#help-link`）不要改。',
    starter: `<h2 id="appt-list-title" tabindex="-1">11/20 的預約</h2>
<ul class="appts">
  <li><span class="time">09:30</span> 王小明 <button type="button" class="cancel">取消預約</button></li>
  <li><span class="time">10:00</span> 陳美華 <button type="button" class="cancel">取消預約</button></li>
</ul>
<a href="#help" id="help-link">掛號說明</a>

<div class="modal" id="confirm" hidden>
  <h2>取消 <span class="when"></span> 的預約？</h2>
  <p>取消後名額會開放給其他人，無法復原。</p>
  <button type="button" class="keep">保留預約</button>
  <button type="button" class="confirm">確定取消</button>
</div>

<style>
  body { font: 16px/1.5 system-ui, sans-serif; }
  .modal { position: fixed; inset: 20% 10% auto; z-index: 1000; background: #fff; border: 2px solid #222; border-radius: 8px; padding: 16px; }
</style>
<script type="module">
  const modal = document.querySelector('#confirm')
  let row = null
  for (const btn of document.querySelectorAll('.cancel')) {
    btn.addEventListener('click', () => {
      row = btn.closest('li')
      modal.querySelector('.when').textContent = '11/20 ' + row.querySelector('.time').textContent
      modal.hidden = false
    })
  }
  modal.querySelector('.keep').addEventListener('click', () => { modal.hidden = true })
  modal.querySelector('.confirm').addEventListener('click', () => {
    row.remove()
    modal.hidden = true
  })
</script>
`,
    solution: `<h2 id="appt-list-title" tabindex="-1">11/20 的預約</h2>
<ul class="appts">
  <li><span class="time">09:30</span> 王小明 <button type="button" class="cancel">取消預約</button></li>
  <li><span class="time">10:00</span> 陳美華 <button type="button" class="cancel">取消預約</button></li>
</ul>
<a href="#help" id="help-link">掛號說明</a>

<!-- showModal()：背景 inert、放進 top layer、Esc 關閉、關閉後焦點還給開啟前的元素 -->
<dialog id="confirm" aria-labelledby="confirm-title" aria-describedby="confirm-desc">
  <h2 id="confirm-title">取消 <span class="when"></span> 的預約？</h2>
  <p id="confirm-desc">取消後名額會開放給其他人，無法復原。</p>
  <form method="dialog">
    <!-- 「保留預約」是第一個可聚焦的元素，showModal() 會聚焦它（也可以加 autofocus） -->
    <button value="keep">保留預約</button>
    <button value="confirm">確定取消</button>
  </form>
</dialog>

<style>
  body { font: 16px/1.5 system-ui, sans-serif; }
  dialog { border: 2px solid #222; border-radius: 8px; padding: 16px; }
  dialog::backdrop { background: rgb(0 0 0 / 0.5); }
</style>
<script type="module">
  const dialog = document.querySelector('#confirm')
  let row = null

  document.querySelector('.appts').addEventListener('click', (event) => {
    const btn = event.target.closest('.cancel')
    if (!btn) return
    row = btn.closest('li')
    dialog.querySelector('.when').textContent = '11/20 ' + row.querySelector('.time').textContent
    dialog.returnValue = ''          // Esc 關閉時不會改 returnValue，先清掉上一次的值
    dialog.showModal()
  })

  dialog.addEventListener('close', () => {
    if (dialog.returnValue !== 'confirm') return   // Esc 或「保留預約」：焦點已經回到觸發按鈕
    row.remove()                                   // 觸發按鈕跟著消失
    document.querySelector('#appt-list-title').focus()
  })
</script>
`,
    tests: [
      { name: '開啟的是 modal 的 dialog，焦點在「保留預約」', code: "const opener = $$('.cancel')[1]\nfocus(opener)\nclick(opener)\nawait tick()\nconst d = $('dialog')\nassert(d && d.open, '找不到開著的 <dialog>')\nassert(d.matches(':modal'), '<dialog> 要用 showModal() 開啟（show() 與 open 屬性開的不是 modal：背景能操作、Esc 不會關）')\nconst title = document.getElementById(d.getAttribute('aria-labelledby') || '')\nassert(title && d.contains(title), 'aria-labelledby 要指向 Dialog 裡的標題')\nassertEqual(text(title), '取消 11/20 10:00 的預約？', '標題的文字')\nassertEqual(document.activeElement && document.activeElement.textContent.trim(), '保留預約', '開啟後焦點所在的元素')" },
      { name: '開著的時候背景不能操作', code: "focus($$('.cancel')[0])\nclick($$('.cancel')[0])\nawait tick()\nconst d = $('dialog')\nassert(d && d.open, '找不到開著的 <dialog>')\nfor (const sel of ['#help-link', '.appts .cancel']) {\n  $(sel).focus()\n  assert(d.contains(document.activeElement), '背景的 ' + sel + ' 還拿得到焦點：Dialog 開著時其他內容要 inert')\n}" },
      { name: '按「保留預約」關閉，焦點回到那一列的「取消預約」', code: "const opener = $$('.cancel')[1]\nfocus(opener)\nclick(opener)\nawait tick()\nconst d = $('dialog')\nassert(d && d.open, '找不到開著的 <dialog>')\nclick($$('dialog button').find((b) => b.textContent.trim() === '保留預約'))\nawait waitFor(() => !d.open)\nassertEqual($$('.appts li').length, 2, '保留預約之後的列數')\nassertEqual(document.activeElement, opener, '關閉後焦點要回到「取消預約」（現在在 ' + (document.activeElement && document.activeElement.tagName.toLowerCase()) + '）')" },
      { name: 'Esc 關閉，焦點回到觸發按鈕', code: "const opener = $$('.cancel')[0]\nfocus(opener)\nclick(opener)\nawait tick()\nconst d = $('dialog')\nassert(d && d.open && d.matches(':modal'), '找不到用 showModal() 開著的 <dialog>')\nd.requestClose()   // 和按 Esc 相同的 close request：先觸發 cancel，再關閉\nawait waitFor(() => !d.open)\nassertEqual($$('.appts li').length, 2, 'Esc 之後的列數（不能取消預約）')\nassertEqual(document.activeElement, opener, 'Esc 關閉後焦點要回到「取消預約」')" },
      { name: '確定取消：那一列消失，焦點移到清單標題', code: "const opener = $$('.cancel')[0]\nfocus(opener)\nclick(opener)\nawait tick()\nconst d = $('dialog')\nassert(d && d.open, '找不到開著的 <dialog>')\nclick($$('dialog button').find((b) => b.textContent.trim() === '確定取消'))\nawait waitFor(() => !d.open && $$('.appts li').length === 1)\nassert(text('.appts').includes('陳美華'), '要移除的是王小明那一列')\nassertEqual(document.activeElement && document.activeElement.id, 'appt-list-title', '觸發按鈕不在了，焦點要移到清單標題')" },
    ],
    hints: ['`dialog.showModal()` 讓背景 inert、Esc 關閉，關閉後焦點自動回到開啟前的元素；不用自己寫焦點陷阱或 Esc 的 keydown。', '`<form method="dialog">` 裡的按鈕直接關閉 Dialog，按下的按鈕的 `value` 成為 `dialog.returnValue`；在 `close` 事件裡判斷要不要移除那一列。', 'Chromium 會擋跨來源 iframe 載入時的 `autofocus`（Console 出現 `Blocked autofocusing…`），但 `showModal()` 照樣聚焦有 `autofocus` 的元素；沒寫時聚焦第一個可聚焦的元素。'],
  },
  {
    id: 'data-display-1', skill: 'data-display', kind: 'css', level: 2,
    title: '今日預約表格：固定表頭、數字靠右、窄螢幕改成卡片',
    prompt: '今日預約表格直接放在頁面裡：390px 時整頁左右滑；`.table-wrap` 寫了最大高度卻不能捲，表頭的 sticky 沒有作用；候診時間這種數字靠左。改寫 CSS（HTML 不能改）：\n\n- `.table-wrap` 最高 320px，超出時在容器內捲動（`overflow: auto`）\n- 表頭 `thead th` 捲動時固定在 `.table-wrap` 頂端，背景不透明，不讓下面的列透出來\n- 數字欄 `.num` 靠右對齊\n- `.table-wrap` 寬度小於 480px 時（`@container`，或 `@media (max-width: 511px)`），每一列改排成一張卡片：每一格一行、上下排列，格子前面用 `::before` 顯示 `data-label` 的欄名（例如「時間：」），表頭在畫面上藏起來；頁面不能左右捲動',
    html: `<main class="page">
  <div class="table-wrap" role="region" aria-labelledby="appt-caption" tabindex="0">
    <table>
      <caption id="appt-caption">11/20 內科 101 預約</caption>
      <thead>
        <tr><th scope="col">時間</th><th scope="col">病歷號</th><th scope="col">姓名</th><th scope="col" class="num">已候診（分）</th><th scope="col">狀態</th></tr>
      </thead>
      <tbody>
        <tr><td data-label="時間">09:00</td><td data-label="病歷號">0012345</td><td data-label="姓名">王小明</td><td data-label="已候診（分）" class="num">5</td><td data-label="狀態"><span class="badge done">✓ 已報到</span></td></tr>
        <tr><td data-label="時間">09:10</td><td data-label="病歷號">0034567</td><td data-label="姓名">陳美華</td><td data-label="已候診（分）" class="num">18</td><td data-label="狀態"><span class="badge waiting">● 候診</span></td></tr>
        <tr><td data-label="時間">09:20</td><td data-label="病歷號">0045678</td><td data-label="姓名">林志明</td><td data-label="已候診（分）" class="num">32</td><td data-label="狀態"><span class="badge waiting">● 候診</span></td></tr>
        <tr><td data-label="時間">09:30</td><td data-label="病歷號">0056789</td><td data-label="姓名">張雅婷</td><td data-label="已候診（分）" class="num">—</td><td data-label="狀態"><span class="badge cancelled">✕ 已取消</span></td></tr>
        <tr><td data-label="時間">09:40</td><td data-label="病歷號">0067890</td><td data-label="姓名">李宗翰</td><td data-label="已候診（分）" class="num">41</td><td data-label="狀態"><span class="badge waiting">● 候診</span></td></tr>
        <tr><td data-label="時間">09:50</td><td data-label="病歷號">0078901</td><td data-label="姓名">吳佩珊</td><td data-label="已候診（分）" class="num">7</td><td data-label="狀態"><span class="badge done">✓ 已報到</span></td></tr>
        <tr><td data-label="時間">10:00</td><td data-label="病歷號">0089012</td><td data-label="姓名">黃俊傑</td><td data-label="已候診（分）" class="num">120</td><td data-label="狀態"><span class="badge waiting">● 候診</span></td></tr>
        <tr><td data-label="時間">10:10</td><td data-label="病歷號">0090123</td><td data-label="姓名">周怡君</td><td data-label="已候診（分）" class="num">3</td><td data-label="狀態"><span class="badge done">✓ 已報到</span></td></tr>
      </tbody>
    </table>
  </div>
</main>`,
    css: `*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font: 16px/1.5 system-ui, sans-serif; background: #f3f4f6; }
.page { padding: 16px; }
table { width: 100%; border-collapse: collapse; background: #fff; }
caption { text-align: left; font-weight: 700; padding: 8px 0; }
th, td { padding: 8px 12px; border-bottom: 1px solid #d1d5db; text-align: left; white-space: nowrap; }
.badge { border-radius: 999px; padding: 2px 8px; font-size: 14px; }
.badge.done { background: #dcfce7; }
.badge.waiting { background: #fef3c7; }
.badge.cancelled { background: #e5e7eb; }`,
    starter: `.table-wrap {
  max-height: 320px;
}

thead th {
  position: sticky;
  top: 0;
}
`,
    solution: `/* 表格在自己的容器裡捲動；容器也是 container query 的基準 */
.table-wrap {
  max-block-size: 320px;
  overflow: auto;
  container-type: inline-size;
}

thead th {
  position: sticky;
  inset-block-start: 0;
  background: #fff;          /* 沒有背景時，捲過去的列會從表頭底下透出來 */
}

.num { text-align: right; }

/* 容器窄於 480px：每列改排成卡片，欄名用 data-label 顯示 */
@container (max-width: 479px) {
  table, tbody, tr, td { display: block; }
  thead { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); }
  tr { padding: 8px 0; border-block-end: 1px solid #d1d5db; }
  td { border: 0; padding: 2px 12px; white-space: normal; }
  td.num { text-align: left; }
  td[data-label]::before { content: attr(data-label) "："; color: #4b5563; }
}
`,
    tests: [
      { name: '1280px：一列一筆，數字靠右', viewport: 1280, code: "for (const tr of $$('tbody tr')) {\n  const tops = [...tr.cells].map((c) => Math.round(box(c).top))\n  assert(tops.every((t) => t === tops[0]), '同一列的格子要在同一行（top：' + tops.join(', ') + '）')\n}\nfor (const td of $$('td.num').slice(0, 3)) {\n  const r = document.createRange()\n  r.selectNodeContents(td)\n  const gap = box(td).right - parseFloat(css(td, 'padding-right')) - r.getBoundingClientRect().right\n  assert(gap < 1, '數字「' + td.textContent + '」離格子右邊還有 ' + Math.round(gap) + 'px：數字要靠右對齊')\n}" },
      { name: '1280px：在容器內捲動，表頭固定在頂端', viewport: 1280, code: "const wrap = $('.table-wrap')\nassert(box(wrap).height <= 320.5, '.table-wrap 高 ' + Math.round(box(wrap).height) + 'px，最高 320px')\nwrap.scrollTop = 80\nawait tick()\nassert(wrap.scrollTop > 40, '.table-wrap 捲不動：超出的部分要在容器裡捲動')\nconst th = $('thead th')\nassert(Math.abs(box(th).top - box(wrap).top) < 1.5, '捲動後表頭的 top 是 ' + Math.round(box(th).top - box(wrap).top) + 'px（相對 .table-wrap），應該黏在頂端')\nconst b = box(th)\nconst hit = document.elementFromPoint(b.left + 4, b.top + b.height / 2)\nassert(hit && hit.closest('th'), '表頭的位置最上面是 ' + (hit ? hit.tagName.toLowerCase() : 'null') + '：表頭要有不透明的背景、蓋住捲過去的列')\nassert(!/rgba\\(0, 0, 0, 0\\)|transparent/.test(css(th, 'background-color')), '表頭的背景是透明的')" },
      { name: '390px：頁面不能左右捲動', viewport: 390, code: "assert(document.documentElement.scrollWidth <= innerWidth, '頁面出現橫向捲軸（寬 ' + document.documentElement.scrollWidth + 'px）')\nassert(box('.table-wrap').right <= innerWidth, '.table-wrap 超出畫面')" },
      { name: '390px：每一列是一張卡片，格子上下排列', viewport: 390, code: "const wrap = $('.table-wrap')\nassert(wrap.scrollWidth <= wrap.clientWidth + 1, '卡片模式下表格還是比容器寬（' + wrap.scrollWidth + 'px）')\nfor (const tr of $$('tbody tr').slice(0, 3)) {\n  const cells = [...tr.querySelectorAll('td')].map(box)\n  for (let i = 1; i < cells.length; i++) assert(cells[i].top >= cells[i - 1].bottom - 1, '卡片裡的格子要一格一行（第 ' + (i + 1) + ' 格和上一格在同一行）')\n  assert(box(tr).width >= wrap.clientWidth - 2, '卡片寬 ' + Math.round(box(tr).width) + 'px，要撐滿容器（' + wrap.clientWidth + 'px）')\n}" },
      { name: '390px：格子前面顯示欄名，表頭藏起來', viewport: 390, code: "for (const td of $$('tbody tr:first-child td')) {\n  const c = getComputedStyle(td, '::before').content\n  assert(c.includes(td.dataset.label), '「' + td.textContent.trim() + '」前面要顯示欄名 ' + td.dataset.label + '（::before 的 content 現在是 ' + c + '）')\n}\nconst h = $('thead')\nconst b = box(h)\nassert(css(h, 'display') === 'none' || (b.width <= 1 && b.height <= 1), '卡片模式下表頭要藏起來（現在 ' + Math.round(b.width) + '×' + Math.round(b.height) + ' px）')" },
    ],
    hints: ['`overflow: auto` 讓 `.table-wrap` 成為捲動容器，`position: sticky; top: 0` 的表頭就黏在它的頂端。', '`.table-wrap` 加 `container-type: inline-size`，再用 `@container (max-width: 479px)` 寫卡片版；`table, tbody, tr, td` 改成 `display: block`。', '`td::before { content: attr(data-label) "："; }` 顯示欄名。表頭可以用 1px 的視覺隱藏留給螢幕閱讀器，或 `display: none`（每格前面已經有欄名）。'],
  },
  {
    id: 'design-tokens-1', skill: 'design-tokens', kind: 'css', level: 2,
    title: '門診系統的語意 token 與暗色主題',
    prompt: '門診系統的 CSS 到處寫死 hex 色碼，暗色主題只改了 `body` 與 `.card` 的背景：頂端列還是白的、灰字在深色底上看不清楚。主題由程式在 `<html>` 加上 `data-theme="dark"` 切換。改寫 CSS（HTML 不能改）：\n\n- `:root` 定義語意 token（`color-scheme: light`），`[data-theme="dark"]` 只覆寫同一組 token 的值（加上 `color-scheme: dark`）。也可以用 `light-dark()` 寫 token，靠 `color-scheme` 切換\n\n| token | 亮色 | 暗色 |\n|---|---|---|\n| `--color-bg` | `#f3f4f6` | `#111827` |\n| `--color-surface` | `#ffffff` | `#1f2937` |\n| `--color-text` | `#1f2937` | `#f9fafb` |\n| `--color-text-muted` | `#4b5563` | `#9ca3af` |\n| `--color-border` | `#d1d5db` | `#374151` |\n| `--color-primary` | `#2563eb` | `#60a5fa` |\n| `--color-on-primary` | `#ffffff` | `#111827` |\n\n- `body` 用 bg 與 text；`.topbar` 與 `.card` 用 surface 與 border；`.muted` 用 text-muted；`.btn.primary` 用 primary 與 on-primary\n- 元件的規則只用 `var(--color-…)`，不寫 hex、`rgb()` 這類色碼；`[data-theme="dark"]` 的規則裡只有 token 與 `color-scheme`',
    html: `<header class="topbar">門診系統 · 總院區</header>
<main class="page">
  <article class="card">
    <h2>內科 101 診</h2>
    <p class="muted">林醫師 · 候診 3 人</p>
    <button type="button" class="btn primary">叫下一號</button>
  </article>
</main>`,
    starter: `body { margin: 0; background: #f3f4f6; color: #1f2937; font: 16px/1.5 system-ui, sans-serif; }
.topbar { background: #ffffff; border-bottom: 1px solid #d1d5db; padding: 12px 16px; }
.page { padding: 16px; }
.card { background: #ffffff; border: 1px solid #d1d5db; border-radius: 8px; padding: 16px; }
.card h2 { margin: 0 0 4px; }
.muted { color: #6b7280; margin: 0 0 12px; }
.btn { border: 0; border-radius: 6px; padding: 8px 12px; font: inherit; }
.btn.primary { background: #2563eb; color: #ffffff; }

/* 暗色主題 */
[data-theme="dark"] body { background: #111827; color: #f9fafb; }
[data-theme="dark"] .card { background: #1f2937; }
`,
    solution: `/* 語意 token：元件只引用這一組名字 */
:root {
  color-scheme: light;
  --color-bg: #f3f4f6;
  --color-surface: #ffffff;
  --color-text: #1f2937;
  --color-text-muted: #4b5563;
  --color-border: #d1d5db;
  --color-primary: #2563eb;
  --color-on-primary: #ffffff;
}

/* 暗色主題只換值，元件不用動；color-scheme 讓表單元件與捲軸也變暗 */
[data-theme="dark"] {
  color-scheme: dark;
  --color-bg: #111827;
  --color-surface: #1f2937;
  --color-text: #f9fafb;
  --color-text-muted: #9ca3af;
  --color-border: #374151;
  --color-primary: #60a5fa;
  --color-on-primary: #111827;
}

body { margin: 0; background: var(--color-bg); color: var(--color-text); font: 16px/1.5 system-ui, sans-serif; }
.topbar { background: var(--color-surface); border-bottom: 1px solid var(--color-border); padding: 12px 16px; }
.page { padding: 16px; }
.card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 8px; padding: 16px; }
.card h2 { margin: 0 0 4px; }
.muted { color: var(--color-text-muted); margin: 0 0 12px; }
.btn { border: 0; border-radius: 6px; padding: 8px 12px; font: inherit; }
.btn.primary { background: var(--color-primary); color: var(--color-on-primary); }
`,
    tests: [
      { name: '亮色主題的顏色', code: "const got = { body: css('body', 'background-color'), text: css('body', 'color'), topbar: css('.topbar', 'background-color'), card: css('.card', 'background-color'), border: css('.card', 'border-top-color'), muted: css('.muted', 'color'), primary: css('.btn.primary', 'background-color'), onPrimary: css('.btn.primary', 'color'), scheme: css('html', 'color-scheme') }\nassertEqual(got, { body: 'rgb(243, 244, 246)', text: 'rgb(31, 41, 55)', topbar: 'rgb(255, 255, 255)', card: 'rgb(255, 255, 255)', border: 'rgb(209, 213, 219)', muted: 'rgb(75, 85, 99)', primary: 'rgb(37, 99, 235)', onPrimary: 'rgb(255, 255, 255)', scheme: 'light' }, '亮色主題')" },
      { name: '暗色主題：每一塊都換色', code: "document.documentElement.dataset.theme = 'dark'\nconst got = { body: css('body', 'background-color'), text: css('body', 'color'), topbar: css('.topbar', 'background-color'), card: css('.card', 'background-color'), border: css('.card', 'border-top-color'), topbarBorder: css('.topbar', 'border-bottom-color'), muted: css('.muted', 'color'), primary: css('.btn.primary', 'background-color'), onPrimary: css('.btn.primary', 'color'), scheme: css('html', 'color-scheme') }\nassertEqual(got, { body: 'rgb(17, 24, 39)', text: 'rgb(249, 250, 251)', topbar: 'rgb(31, 41, 55)', card: 'rgb(31, 41, 55)', border: 'rgb(55, 65, 81)', topbarBorder: 'rgb(55, 65, 81)', muted: 'rgb(156, 163, 175)', primary: 'rgb(96, 165, 250)', onPrimary: 'rgb(17, 24, 39)', scheme: 'dark' }, '暗色主題')" },
      { name: '兩個主題的文字對比都至少 4.5:1', code: "const lum = (c) => { const [r, g, b] = c.match(/[\\d.]+/g).slice(0, 3).map((v) => { v = v / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }\nconst ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }\nfor (const theme of ['light', 'dark']) {\n  document.documentElement.dataset.theme = theme\n  const pairs = [['卡片文字', css('.card', 'color'), css('.card', 'background-color')], ['次要文字', css('.muted', 'color'), css('.card', 'background-color')], ['主要按鈕', css('.btn.primary', 'color'), css('.btn.primary', 'background-color')], ['頁面文字', css('body', 'color'), css('body', 'background-color')]]\n  for (const [label, fg, bg] of pairs) { const r = ratio(fg, bg); assert(r >= 4.5, theme + ' 主題的' + label + '：' + fg + ' 對 ' + bg + ' 只有 ' + r.toFixed(2) + ':1') }\n}" },
      { name: '元件只用 token，暗色主題只覆寫 token', code: "const sheet = [...document.styleSheets].pop()\nconst bad = []\nconst literal = /#[0-9a-f]{3,8}\\b|\\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\\(/i\nconst walk = (rules) => { for (const r of rules) {\n  if (r.style && r.selectorText) {\n    const decls = r.style.cssText.split(';').map((d) => d.trim()).filter(Boolean)\n    for (const d of decls) {\n      const prop = d.slice(0, d.indexOf(':')).trim()\n      if (prop.startsWith('--')) continue\n      if (/data-theme/.test(r.selectorText) && prop !== 'color-scheme') bad.push(r.selectorText + ' 裡只放 token 與 color-scheme：' + d)\n      else if (literal.test(d)) bad.push(r.selectorText + ' 寫死了顏色：' + d)\n    }\n  }\n  if (r.cssRules) walk(r.cssRules)\n} }\nwalk(sheet.cssRules)\nassert(!bad.length, bad.join('\\n'))\nassert(/var\\(--color-surface\\)/.test(sheet.cssRules && [...sheet.cssRules].map((r) => r.cssText).join('\\n')), '.card 與 .topbar 要用 var(--color-surface)')" },
    ],
    hints: ['`:root { --color-surface: #ffffff; }` 定義，元件寫 `background: var(--color-surface)`。', '`[data-theme="dark"] { --color-surface: #1f2937; }` 只換值：custom property 會繼承，`<html>` 上換了，整頁一起變。', '暗色主題的灰字沿用亮色的值時對比不夠：次要文字在暗色主題要換成較淺的 `#9ca3af`。'],
  },
]

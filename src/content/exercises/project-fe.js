// 程式題：實作路線（門診掛號前端）。每題帶 project: '<階段 id>'，只出現在實作路線的階段頁，不出現在技能頁的驗收區。
// html、css、vue 題在沙箱 iframe 裡執行（fetch 由假 API 回應，見 src/runtime/fakeApi.js），只 import 'vue'；
// config 題的使用者內容成為 source / lines，交給 JS 測試檢查。測試碼一律用 String.raw，裡面不寫反引號與 ${。
// 一個階段接一個階段：後面階段的起始碼帶著前面階段做好的部分，測試只檢查這一階段的新行為。

// 焦點題用：同一題的測試同時在幾個 iframe 裡跑，別的 iframe 拿走焦點時，這個文件的 activeElement 會變成 body。
// focusin 記下最後拿到焦點的元素，文件沒有焦點時用它判斷。
const FOCUS_HELPER = String.raw`
const __focused = []
document.addEventListener('focusin', (e) => __focused.push(e.target), true)
const focusedEl = () => (document.hasFocus() ? document.activeElement : __focused[__focused.length - 1] || document.activeElement)
`

// nginx 用：小型的 nginx 設定直譯器（改寫自 p11-p3.js 的 spa-containers-2）。照 nginx 的規則選 location、處理 try_files
// 與內部轉址、套用 add_header / root 的繼承規則。檔案系統是一份放在 /usr/share/nginx/html/clinic/ 的假 dist。
const NGINX_CLINIC = String.raw`
function tokenize(src) {
  const toks = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === '{' || c === '}' || c === ';') { toks.push({ t: c }); i++; continue }
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++ }
      toks.push({ w: src.slice(i + 1, j) }); i = j + 1; continue
    }
    let j = i
    while (j < src.length && !/[\s{};]/.test(src[j])) j++
    toks.push({ w: src.slice(i, j) }); i = j
  }
  return toks
}
function parseConf(src) {
  const toks = tokenize(src)
  let pos = 0
  function block() {
    const out = []
    while (pos < toks.length && toks[pos].t !== '}') {
      const words = []
      while (pos < toks.length && toks[pos].w !== undefined) words.push(toks[pos++].w)
      const tk = toks[pos]
      if (!tk) { assert(false, '設定沒有結束：最後一個指令少了分號或大括號'); }
      if (tk.t === ';') { pos++; if (words.length) out.push({ name: words[0], args: words.slice(1) }); continue }
      if (tk.t === '{') { pos++; const body = block(); assert(toks[pos] && toks[pos].t === '}', '大括號沒有成對'); pos++; out.push({ name: words[0], args: words.slice(1), block: body }); continue }
      break
    }
    return out
  }
  const top = block()
  assert(pos >= toks.length, '多了一個 }，大括號沒有成對')
  return top
}
function server() {
  const top = parseConf(lines.join('\n'))
  const http = top.find((d) => d.name === 'http')
  const all = (http ? http.block : top).filter((d) => d.name === 'server' && d.block)
  assert(all.length, '找不到 server { … } 區塊')
  return all[0]
}
function locs(level) {
  return (level.block || []).filter((d) => d.name === 'location' && d.block).map((d) => {
    const mod = d.args.length > 1 ? d.args[0] : ''
    return { mod, path: d.args.length > 1 ? d.args[1] : d.args[0], node: d }
  })
}
function pick(list, uri) {
  const exact = list.find((l) => l.mod === '=' && l.path === uri)
  if (exact) return exact
  let best = null
  for (const l of list) if ((l.mod === '' || l.mod === '^~') && uri.startsWith(l.path) && (!best || l.path.length > best.path.length)) best = l
  if (best && best.mod === '^~') return best
  for (const l of list) {
    if (l.mod !== '~' && l.mod !== '~*') continue
    let re = null
    try { re = new RegExp(l.path, l.mod === '~*' ? 'i' : '') } catch (e) { assert(false, 'location 的 regex 寫錯了：' + l.path) }
    if (re.test(uri)) return l
  }
  return best
}
function chainFor(uri) {
  const chain = [server()]
  let level = chain[0]
  for (;;) {
    const l = pick(locs(level), uri)
    if (!l) break
    chain.push(l.node)
    level = l.node
  }
  return chain
}
function own(level, name) { return (level.block || []).filter((d) => d.name === name) }
function inherited(chain, name) {
  for (let i = chain.length - 1; i >= 0; i--) { const d = own(chain[i], name); if (d.length) return d }
  return []
}
function headersOf(chain) {
  let eff = [], mode = 'on'
  for (const level of chain) {
    const m = own(level, 'add_header_inherit')
    if (m.length) mode = m[m.length - 1].args[0]
    const mine = own(level, 'add_header')
    if (mode === 'off') eff = mine
    else if (mine.length) eff = mode === 'merge' ? eff.concat(mine) : mine
  }
  const h = {}
  for (const d of eff) { const k = (d.args[0] || '').toLowerCase(); h[k] = h[k] ? h[k] + ', ' + d.args[1] : d.args[1] }
  return h
}
const FILES = new Set(['/clinic/index.html', '/clinic/config.js', '/clinic/favicon.svg', '/clinic/assets/index-CmXrpQpe.js', '/clinic/assets/vendor-C8Rcc4dC.js', '/clinic/assets/index-D1rQx9aB.css'])
const DIRS = new Set(['/clinic/', '/clinic/assets/'])
const ROOT = '/usr/share/nginx/html'
function handle(uri, depth) {
  depth = depth || 0
  assert(depth < 10, uri + '：內部轉址超過 10 次，try_files 的 fallback 繞成迴圈了')
  const chain = chainFor(uri)
  const loc = chain[chain.length - 1]
  const where = chain.length > 1 ? 'location ' + loc.args.join(' ') : 'server（沒有 location 符合）'
  const headers = headersOf(chain)
  const pp = own(loc, 'proxy_pass')[0]
  if (pp) return { kind: 'proxy', target: pp.args[0], uri, headers, where, chain }
  const ret = own(loc, 'return')[0]
  if (ret) return { kind: 'return', status: Number(ret.args[0]), headers, where, chain }
  const rootD = inherited(chain, 'root')[0]
  const root = rootD ? rootD.args[0].replace(/\/+$/, '') : null
  const isFile = (p) => root === ROOT && FILES.has(p)
  const isDir = (p) => root === ROOT && DIRS.has(p)
  const serveUri = (p) => {
    if (p.endsWith('/')) return isDir(p) ? handle(p + 'index.html', depth + 1) : { kind: 'status', status: 404, headers, where, chain, root }
    return isFile(p) ? { kind: 'file', file: p, status: 200, headers, where, chain, root } : { kind: 'status', status: 404, headers, where, chain, root }
  }
  const tf = inherited(chain, 'try_files')[0]
  if (!tf) return serveUri(uri)
  const args = tf.args
  for (const a of args.slice(0, -1)) {
    const p = a.split('$uri').join(uri)
    if (p.endsWith('/') ? isDir(p) : isFile(p)) return serveUri(p)
  }
  const last = args[args.length - 1] || ''
  if (/^=\d{3}$/.test(last)) return { kind: 'status', status: Number(last.slice(1)), headers, where, chain, root }
  return handle(last.split('$uri').join(uri), depth + 1)
}
function cacheOf(r) { return (r.headers['cache-control'] || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean) }
function describe(r) {
  if (r.kind === 'file') return '由 ' + r.where + ' 送出 ' + r.file + '，Cache-Control: ' + (r.headers['cache-control'] || '（沒有）')
  if (r.kind === 'proxy') return '由 ' + r.where + ' 轉給 ' + r.target
  const why = r.root === null ? '（這個 location 讀不到 root：root 只寫在別的 location 裡，nginx 改用預設的 html 目錄）'
    : r.root && r.root !== ROOT ? '（這裡的 root 是 ' + r.root + '，檔案在 ' + ROOT + '）' : ''
  return '由 ' + r.where + ' 回 ' + r.status + why
}`

export default [

  // ───────────── 1. fe-login ─────────────
  {
    id: 'project-fe-login-1', project: 'fe-login', skill: 'form-submit', kind: 'vue', level: 2,
    title: '登入表單：送出中、401 與 422',
    prompt: `櫃台的登入頁送出 \`POST /api/auth/login\`（body \`{ username, password }\`），假 API 內建這條路由：帳號 \`desk1\`、密碼 \`demo-password\` 回 200；密碼錯回 401，Problem Details 的 \`detail\` 是「帳號或密碼錯誤」；欄位內容不符規則時回 422，\`errors\` 是 \`{ 欄位: ['訊息'] }\`（本站假 API 的格式，不是 Problem Details 的標準欄位）。兩個欄位都加 \`required\`，空白時由瀏覽器擋下，不必送到後端。起始碼把 \`title\`（\`Unauthorized\`、\`Unprocessable Content\`）直接顯示給使用者，送出中也沒有任何變化。改成：

- 送出中：按鈕 \`data-test="submit"\` 設成 \`disabled\`、文字改成「登入中…」；送出中再送出一次（連按、在密碼欄按 Enter）不會送出第二個請求
- 401：表單上方 \`role="alert"\` 的元素顯示回應的 \`detail\`；清空密碼、保留帳號
- 422：每個欄位的第一則訊息放在欄位下方的 \`<p id="username-error">\`、\`<p id="password-error">\`；出錯的輸入框加 \`aria-invalid="true"\` 與指向訊息的 \`aria-describedby\`；焦點移到第一個出錯的欄位；不顯示上方的 alert
- 網路錯誤：\`role="alert"\` 顯示「無法連線，請稍後再試」
- 不管結果如何，送完都要恢復按鈕

成功時顯示 \`<p data-test="welcome">\`「已登入」（token 與換頁是下一題）。`,
    api: 'api.latency = 300',
    starter: `import { createApp, ref } from 'vue'

const LoginForm = {
  setup() {
    const username = ref('')
    const password = ref('')
    const error = ref('')
    const loggedIn = ref(false)

    async function login() {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.value, password: password.value }),
      })
      const data = await res.json()
      if (res.ok) loggedIn.value = true
      else error.value = data.title
    }

    return { username, password, error, loggedIn, login }
  },
  template: \`
    <form data-test="login" @submit.prevent="login">
      <p v-if="error" role="alert">{{ error }}</p>

      <label for="username">帳號</label>
      <input id="username" v-model="username" autocomplete="username">

      <label for="password">密碼</label>
      <input id="password" v-model="password" type="password" autocomplete="current-password">

      <button type="submit" data-test="submit">登入</button>
    </form>
    <p v-if="loggedIn" data-test="welcome">已登入</p>\`,
}

createApp(LoginForm).mount('#app')
`,
    solution: `import { createApp, ref, reactive, nextTick } from 'vue'

const FIELDS = ['username', 'password']   // 表單上的順序：焦點移到第一個出錯的欄位

const LoginForm = {
  setup() {
    const form = reactive({ username: '', password: '' })
    const fieldErrors = ref({})            // { password: '必填' }
    const formError = ref('')              // 表單上方的訊息
    const submitting = ref(false)
    const loggedIn = ref(false)

    async function login() {
      if (submitting.value) return         // 送出中再送一次（Enter、連點）：不理
      submitting.value = true
      fieldErrors.value = {}
      formError.value = ''
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
        if (res.ok) {
          loggedIn.value = true
          return
        }
        const problem = await res.json().catch(() => ({}))
        if (res.status === 422) {
          // 假 API 的 errors 是 { 欄位: ['訊息'] }，每個欄位顯示第一則
          const errors = problem.errors || {}
          fieldErrors.value = Object.fromEntries(FIELDS.filter((k) => errors[k]).map((k) => [k, [].concat(errors[k])[0]]))
          await nextTick()                 // 等 aria-invalid 畫上去再移焦點
          const first = FIELDS.find((k) => fieldErrors.value[k])
          if (first) document.getElementById(first).focus()
        } else if (res.status === 401) {
          formError.value = problem.detail || '帳號或密碼錯誤'
          form.password = ''               // 密碼清掉，帳號留著
        } else {
          formError.value = '系統暫時無法處理，請稍後再試'
        }
      } catch {
        formError.value = '無法連線，請稍後再試'
      } finally {
        submitting.value = false           // 成功、失敗、例外都恢復按鈕
      }
    }

    return { form, fieldErrors, formError, submitting, loggedIn, login }
  },
  template: \`
    <form data-test="login" @submit.prevent="login">
      <p v-if="formError" role="alert">{{ formError }}</p>

      <label for="username">帳號</label>
      <input id="username" v-model.trim="form.username" autocomplete="username" required
             spellcheck="false" autocapitalize="none"
             :aria-invalid="fieldErrors.username ? 'true' : undefined"
             :aria-describedby="fieldErrors.username ? 'username-error' : undefined">
      <p v-if="fieldErrors.username" id="username-error">{{ fieldErrors.username }}</p>

      <label for="password">密碼</label>
      <input id="password" v-model="form.password" type="password" autocomplete="current-password" required
             :aria-invalid="fieldErrors.password ? 'true' : undefined"
             :aria-describedby="fieldErrors.password ? 'password-error' : undefined">
      <p v-if="fieldErrors.password" id="password-error">{{ fieldErrors.password }}</p>

      <button type="submit" data-test="submit" :disabled="submitting">{{ submitting ? '登入中…' : '登入' }}</button>
    </form>
    <p v-if="loggedIn" data-test="welcome">已登入</p>\`,
}

createApp(LoginForm).mount('#app')
`,
    tests: [
      { name: '送出中停用按鈕、顯示「登入中…」', code: String.raw`
input('#username', 'desk1')
input('#password', 'demo-password')
submit('[data-test=login]')
await tick()
assert($('[data-test=submit]').disabled, '送出中按鈕要 disabled')
assertEqual(text('[data-test=submit]'), '登入中…', '送出中的按鈕文字')
await waitFor(() => $('[data-test=welcome]'))
assert(!$('[data-test=submit]').disabled, '送完要恢復按鈕')` },
      { name: '送出中再送一次，只送出一個請求', code: String.raw`
input('#username', 'desk1')
input('#password', 'demo-password')
submit('[data-test=login]')
await tick()
submit('[data-test=login]')
submit('[data-test=login]')
await waitFor(() => $('[data-test=welcome]'))
await wait(100)
assertEqual(api.calls.filter((c) => c.method === 'POST').length, 1, 'POST /api/auth/login 的次數')` },
      { name: '401：顯示 detail、清空密碼、保留帳號', code: String.raw`
input('#username', 'desk1')
input('#password', 'wrong-password')
submit('[data-test=login]')
await waitFor(() => $('[role=alert]'))
assertEqual(text('[role=alert]'), '帳號或密碼錯誤', 'role="alert" 的文字')
assertEqual($('#password').value, '', '密碼欄')
assertEqual($('#username').value, 'desk1', '帳號欄')
assert(!$('[data-test=submit]').disabled, '失敗後按鈕要能再按')` },
      { name: '422：訊息放到欄位下方、aria 與焦點', api: 'api.post(\'/api/auth/login\', { status: 422, body: api.problem(422, \'欄位格式錯誤\', { code: \'validation-error\', errors: { password: [\'密碼至少 8 個字\'] } }) })', code: FOCUS_HELPER + String.raw`
input('#username', 'desk1')
input('#password', 'short')
submit('[data-test=login]')
await waitFor(() => $('#password-error'), { timeout: 2000 })
assertEqual(text('#password-error'), '密碼至少 8 個字', '#password-error 的文字')
assertEqual($('#password').getAttribute('aria-invalid'), 'true', '#password 的 aria-invalid')
assert(($('#password').getAttribute('aria-describedby') || '').split(/\s+/).includes('password-error'), '#password 的 aria-describedby 要指向 password-error（現在是 ' + $('#password').getAttribute('aria-describedby') + '）')
assert(!$('#username').hasAttribute('aria-invalid') || $('#username').getAttribute('aria-invalid') === 'false', '沒出錯的帳號欄不要標 aria-invalid')
assert(!$('[role=alert]'), '422 的訊息放在欄位下方，不用上方的 alert（現在顯示：' + text('[role=alert]') + '）')
assertEqual(focusedEl() && focusedEl().id, 'password', '焦點所在的欄位')` },
      { name: '帳號、密碼是必填，空白時不送出', code: String.raw`
assert($('#username').required && $('#password').required, '帳號與密碼要加 required')
submit('[data-test=login]')
await wait(100)
assertEqual(api.calls.length, 0, '空白時送出的請求數')` },
      { name: '網路錯誤：顯示無法連線、恢復按鈕', api: 'api.post(\'/api/auth/login\', { network: true, delay: 50 })', code: String.raw`
input('#username', 'desk1')
input('#password', 'demo-password')
submit('[data-test=login]')
await waitFor(() => $('[role=alert]'))
assertEqual(text('[role=alert]'), '無法連線，請稍後再試', 'role="alert" 的文字')
assert(!$('[data-test=submit]').disabled, '網路錯誤後按鈕要能再按')` },
    ],
    hints: [
      '用一個 `submitting` ref：處理函式開頭檢查，已經是 `true` 就直接 return；`finally` 裡設回 `false`。',
      '先看 `res.status` 再決定怎麼讀：401 讀 `detail`，422 讀 `errors`；`fetch` 只有網路錯誤會 reject，放在 `try` 裡。',
      '焦點要等 `aria-invalid` 畫上去之後再移：`await nextTick()` 再 `document.getElementById(…).focus()`。',
    ],
  },
  {
    id: 'project-fe-login-2', project: 'fe-login', skill: 'auth-frontend', kind: 'vue', level: 2,
    title: 'token 放記憶體，401 回登入頁、403 留在原頁',
    prompt: `沙箱裡沒有 Vue Router，題目用 \`route\`（\`{ name, query }\`）與 \`go(name, query)\` 代替：頁面有 \`login\`、\`sessions\`（\`data-test="sessions"\`）、\`appointments\`（\`data-test="appointments"\`）。假 API 設了 \`api.auth = true\`：\`GET /api/sessions\`、\`GET /api/appointments\` 沒帶 \`Authorization: Bearer <token>\` 會回 401。登入帳號 \`patient1\`、密碼 \`demo-password\`。

起始碼把 token 存進 \`localStorage\`，所有錯誤都顯示「讀取失敗」。改成：

- token 只放在記憶體（模組裡的 \`ref\`），不寫進 \`localStorage\`、\`sessionStorage\`
- 所有 API 經過 \`apiFetch\`：有 token 時帶 \`Authorization: Bearer <token>\`
- 回應 401（token 過期或無效）：清掉 token，換到登入頁並顯示 \`<p data-test="expired">\`「登入已過期，請重新登入」；重新登入後回到原本那一頁（\`redirect\` 只接受 \`sessions\`、\`appointments\`，其他值一律去 \`sessions\`）
- 回應 403：留在原頁，\`role="alert"\` 顯示「沒有權限查看這個頁面」；不清 token、不回登入頁
- 「登出」\`data-test="logout"\`：清掉 token，回到登入頁`,
    api: String.raw`api.auth = true
api.latency = 50`,
    starter: `import { createApp, ref, reactive, onMounted } from 'vue'

// 代替 Vue Router：目前的頁面與參數
const route = ref({ name: 'login', query: {} })
function go(name, query = {}) { route.value = { name, query } }

async function apiFetch(path) {
  const token = localStorage.getItem('token')
  const headers = new Headers()
  if (token) headers.set('Authorization', 'Bearer ' + token)
  const res = await fetch('/api' + path, { headers })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

const LoginPage = {
  setup() {
    const form = reactive({ username: '', password: '' })
    const error = ref('')
    async function login() {
      error.value = ''
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) { error.value = '帳號或密碼錯誤'; return }
      localStorage.setItem('token', (await res.json()).access_token)
      go('sessions')
    }
    return { form, error, login, route }
  },
  template: \`
    <form data-test="login" @submit.prevent="login">
      <p v-if="error" role="alert">{{ error }}</p>
      <label for="username">帳號</label>
      <input id="username" v-model="form.username" autocomplete="username">
      <label for="password">密碼</label>
      <input id="password" v-model="form.password" type="password" autocomplete="current-password">
      <button type="submit">登入</button>
    </form>\`,
}

const SessionsPage = {
  setup() {
    const sessions = ref([])
    const error = ref('')
    onMounted(async () => {
      try { sessions.value = await apiFetch('/sessions') } catch { error.value = '讀取失敗' }
    })
    return { sessions, error }
  },
  template: \`
    <section data-test="sessions">
      <h1>診次</h1>
      <p v-if="error" role="alert">{{ error }}</p>
      <ul><li v-for="s in sessions" :key="s.id">{{ s.session_date }} {{ s.period }}</li></ul>
    </section>\`,
}

const AppointmentsPage = {
  setup() {
    const items = ref([])
    const error = ref('')
    onMounted(async () => {
      try { items.value = (await apiFetch('/appointments')).items } catch { error.value = '讀取失敗' }
    })
    return { items, error }
  },
  template: \`
    <section data-test="appointments">
      <h1>我的掛號</h1>
      <p v-if="error" role="alert">{{ error }}</p>
      <ul><li v-for="a in items" :key="a.id">第 {{ a.number }} 號</li></ul>
    </section>\`,
}

const App = {
  components: { LoginPage, SessionsPage, AppointmentsPage },
  setup() {
    const pages = { login: 'LoginPage', sessions: 'SessionsPage', appointments: 'AppointmentsPage' }
    function logout() {
      localStorage.removeItem('token')
      go('login')
    }
    return { route, pages, go, logout }
  },
  template: \`
    <nav v-if="route.name !== 'login'">
      <button type="button" data-test="nav-sessions" @click="go('sessions')">診次</button>
      <button type="button" data-test="nav-appointments" @click="go('appointments')">我的掛號</button>
      <button type="button" data-test="logout" @click="logout">登出</button>
    </nav>
    <component :is="pages[route.name]" :key="route.name" />\`,
}

createApp(App).mount('#app')
`,
    solution: `import { createApp, ref, reactive, onMounted } from 'vue'

// 代替 Vue Router：目前的頁面與參數
const route = ref({ name: 'login', query: {} })
function go(name, query = {}) { route.value = { name, query } }
const PAGES = ['sessions', 'appointments']   // 登入後可以回去的頁面：redirect 只接受這幾個

// 登入狀態只放在記憶體：重新整理就要重新登入，頁面上的 script 也不能事後從 storage 讀走
const token = ref(null)

class ApiError extends Error {
  constructor(status, problem) {
    super(problem?.title || 'HTTP ' + status)
    this.status = status
  }
}

// 所有 API 都經過這裡：帶 token、統一處理 401
async function apiFetch(path) {
  const headers = new Headers()
  if (token.value) headers.set('Authorization', 'Bearer ' + token.value)
  const res = await fetch('/api' + path, { headers })
  if (res.status === 401) {
    token.value = null                                         // 過期或無效：清掉
    go('login', { redirect: route.value.name, expired: '1' })  // 記下原本在哪一頁
    throw new ApiError(401)
  }
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null))
  return res.json()
}

const LoginPage = {
  setup() {
    const form = reactive({ username: '', password: '' })
    const error = ref('')
    async function login() {
      error.value = ''
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) { error.value = '帳號或密碼錯誤'; return }
      token.value = (await res.json()).access_token
      const redirect = route.value.query.redirect
      go(PAGES.includes(redirect) ? redirect : 'sessions')
    }
    return { form, error, login, route }
  },
  template: \`
    <form data-test="login" @submit.prevent="login">
      <p v-if="route.query.expired" data-test="expired">登入已過期，請重新登入</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <label for="username">帳號</label>
      <input id="username" v-model="form.username" autocomplete="username">
      <label for="password">密碼</label>
      <input id="password" v-model="form.password" type="password" autocomplete="current-password">
      <button type="submit">登入</button>
    </form>\`,
}

// 403 與其他錯誤：留在原頁顯示原因；401 已經由 apiFetch 換到登入頁，這裡不用處理
function describe(err) {
  if (err.status === 401) return ''
  if (err.status === 403) return '沒有權限查看這個頁面'
  return '讀取失敗'
}

const SessionsPage = {
  setup() {
    const sessions = ref([])
    const error = ref('')
    onMounted(async () => {
      try { sessions.value = await apiFetch('/sessions') } catch (err) { error.value = describe(err) }
    })
    return { sessions, error }
  },
  template: \`
    <section data-test="sessions">
      <h1>診次</h1>
      <p v-if="error" role="alert">{{ error }}</p>
      <ul><li v-for="s in sessions" :key="s.id">{{ s.session_date }} {{ s.period }}</li></ul>
    </section>\`,
}

const AppointmentsPage = {
  setup() {
    const items = ref([])
    const error = ref('')
    onMounted(async () => {
      try { items.value = (await apiFetch('/appointments')).items } catch (err) { error.value = describe(err) }
    })
    return { items, error }
  },
  template: \`
    <section data-test="appointments">
      <h1>我的掛號</h1>
      <p v-if="error" role="alert">{{ error }}</p>
      <ul><li v-for="a in items" :key="a.id">第 {{ a.number }} 號</li></ul>
    </section>\`,
}

const App = {
  components: { LoginPage, SessionsPage, AppointmentsPage },
  setup() {
    const pages = { login: 'LoginPage', sessions: 'SessionsPage', appointments: 'AppointmentsPage' }
    function logout() {
      token.value = null   // 頁面元件跟著換掉，畫面上的資料一起清掉
      go('login')
    }
    return { route, pages, go, logout }
  },
  template: \`
    <nav v-if="route.name !== 'login'">
      <button type="button" data-test="nav-sessions" @click="go('sessions')">診次</button>
      <button type="button" data-test="nav-appointments" @click="go('appointments')">我的掛號</button>
      <button type="button" data-test="logout" @click="logout">登出</button>
    </nav>
    <component :is="pages[route.name]" :key="route.name" />\`,
}

createApp(App).mount('#app')
`,
    tests: [
      { name: '登入後換到診次頁，請求帶著 Bearer token', code: String.raw`
input('#username', 'patient1')
input('#password', 'demo-password')
submit('[data-test=login]')
await waitFor(() => $$('[data-test=sessions] li').length === 3, { timeout: 2000 })
assert(!$('[data-test=sessions] [role=alert]'), '診次頁不應該有錯誤：' + text('[data-test=sessions] [role=alert]'))` },
      { name: 'token 不寫進 localStorage、sessionStorage', code: String.raw`
input('#username', 'patient1')
input('#password', 'demo-password')
submit('[data-test=login]')
await waitFor(() => $('[data-test=sessions]'))
await wait(100)
const stored = []
for (const s of [localStorage, sessionStorage]) for (let i = 0; i < s.length; i++) stored.push(s.key(i) + '=' + s.getItem(s.key(i)))
assertEqual(stored, [], 'storage 裡的內容')` },
      { name: '401：回登入頁、提示過期，重新登入回到原本那一頁', api: String.raw`api.get('/api/appointments', [
  { status: 401, headers: { 'WWW-Authenticate': 'Bearer' }, body: api.problem(401, 'token 已過期') },
  { body: { items: [{ id: 7, session_id: 2, patient_id: 1, number: 4, status: 'booked' }], next_cursor: null } },
])`, code: String.raw`
input('#username', 'patient1')
input('#password', 'demo-password')
submit('[data-test=login]')
await waitFor(() => $('[data-test=sessions]'))
click('[data-test=nav-appointments]')
await waitFor(() => $('[data-test=login]'), { timeout: 2000 })
assertEqual(text('[data-test=expired]'), '登入已過期，請重新登入', '登入頁的提示')
input('#username', 'patient1')
input('#password', 'demo-password')
submit('[data-test=login]')
await waitFor(() => $('[data-test=appointments] li'), { timeout: 2000 })
assertEqual(text('[data-test=appointments] li'), '第 4 號')` },
      { name: '403：留在原頁顯示沒有權限，token 還在', api: 'api.get(\'/api/sessions\', { status: 403, body: api.problem(403, \'這個帳號不能查看診次\') })', code: String.raw`
input('#username', 'patient1')
input('#password', 'demo-password')
submit('[data-test=login]')
await waitFor(() => $('[data-test=sessions] [role=alert]'), { timeout: 2000 })
assertEqual(text('[data-test=sessions] [role=alert]'), '沒有權限查看這個頁面', '403 的訊息')
assert(!$('[data-test=login]'), '403 不要回到登入頁')
click('[data-test=nav-appointments]')
await waitFor(() => $('[data-test=appointments]'))
await wait(200)
assert(!$('[data-test=login]'), '換到其他頁時被導回登入頁：403 之後 token 不應該被清掉')
assert(!$('[data-test=appointments] [role=alert]'), '我的掛號頁不應該有錯誤：' + text('[data-test=appointments] [role=alert]'))` },
      { name: '登出：回到登入頁，之後的請求不帶 token', code: String.raw`
input('#username', 'patient1')
input('#password', 'demo-password')
submit('[data-test=login]')
await waitFor(() => $('[data-test=sessions] li'))
click('[data-test=logout]')
await waitFor(() => $('[data-test=login]'))
const r = await fetch('/api/sessions')
assertEqual(r.status, 401, '登出後不帶 token 的請求')` },
    ],
    hints: [
      '`const token = ref(null)` 放在模組頂層，登入成功時設定，`apiFetch` 從這裡讀。',
      '401 在 `apiFetch` 裡統一處理：清 token、`go(\'login\', { redirect: route.value.name, expired: \'1\' })`；頁面元件只處理 403 與其他錯誤。',
      '登入成功後讀 `route.value.query.redirect`，在允許的清單裡才用它。',
    ],
  },

  // ───────────── 2. fe-sessions ─────────────
  {
    id: 'project-fe-sessions-1', project: 'fe-sessions', skill: 'api-states', kind: 'vue', level: 2,
    title: '診次清單的四種狀態與重新整理',
    prompt: `診次清單呼叫 \`GET /api/sessions?date=2026-11-26\`，回傳 \`[{ id, doctor_id, session_date, period, capacity, remaining }]\`。起始碼只處理成功的情況。改成用一個狀態變數，畫面一次只出現一種：

- 請求進行中：\`data-test="loading"\`
- 成功：每個診次一個 \`<li data-test="session">\`，\`remaining\` 大於 0 顯示「剩 N 名」，等於 0 顯示「額滿」
- 成功但沒有資料：\`data-test="empty"\`，文字「這天沒有門診」
- 失敗（狀態碼不是 2xx，或網路錯誤）：\`role="alert"\` 的區塊，裡面有「重試」\`data-test="retry"\`，按了回到 loading 再請求

另外，「重新整理」\`data-test="refresh"\`：已經有清單時不回到 loading，清單留在畫面上，更新中按鈕 \`disabled\`；更新失敗時清單照樣留著，上方加一個 \`role="alert"\`「更新失敗，以下是先前的資料」。`,
    api: String.raw`window.SESSIONS = [
  { id: 1, doctor_id: 1, session_date: '2026-11-26', period: 'morning', capacity: 2, remaining: 2 },
  { id: 2, doctor_id: 1, session_date: '2026-11-26', period: 'afternoon', capacity: 30, remaining: 0 },
  { id: 3, doctor_id: 2, session_date: '2026-11-26', period: 'morning', capacity: 30, remaining: 12 },
]
api.get('/api/sessions', { body: SESSIONS, delay: 200 })`,
    starter: `import { createApp, ref, onMounted } from 'vue'

const PERIODS = { morning: '上午', afternoon: '下午', evening: '夜間' }

const SessionList = {
  setup() {
    const sessions = ref([])

    async function load() {
      sessions.value = []
      const res = await fetch('/api/sessions?date=2026-11-26')
      sessions.value = await res.json()
    }

    onMounted(load)
    return { sessions, load, PERIODS }
  },
  template: \`
    <h1>11/26 的門診</h1>
    <button type="button" data-test="refresh" @click="load">重新整理</button>
    <p v-if="!sessions.length" data-test="empty">這天沒有門診</p>
    <ul>
      <li v-for="s in sessions" :key="s.id" data-test="session">
        {{ PERIODS[s.period] }}診　剩 {{ s.remaining }} 名
      </li>
    </ul>\`,
}

createApp(SessionList).mount('#app')
`,
    solution: `import { createApp, ref, onMounted } from 'vue'

const PERIODS = { morning: '上午', afternoon: '下午', evening: '夜間' }

const SessionList = {
  setup() {
    const status = ref('loading')     // loading | success | empty | error：畫面一次只處在一種
    const sessions = ref([])
    const refreshing = ref(false)     // 已經有清單時的重新整理
    const refreshFailed = ref(false)

    async function fetchSessions() {
      const res = await fetch('/api/sessions?date=2026-11-26')
      if (!res.ok) throw new Error('HTTP ' + res.status)   // 4xx、5xx 不會讓 fetch reject
      return res.json()
    }

    async function load() {
      status.value = 'loading'
      try {
        sessions.value = await fetchSessions()
        status.value = sessions.value.length ? 'success' : 'empty'
      } catch {
        status.value = 'error'                             // 失敗不能變成空清單
      }
    }

    async function refresh() {
      if (status.value !== 'success') return load()        // 沒有資料時就是重新載入
      if (refreshing.value) return
      refreshing.value = true
      refreshFailed.value = false
      try {
        const data = await fetchSessions()
        sessions.value = data
        status.value = data.length ? 'success' : 'empty'
      } catch {
        refreshFailed.value = true                         // 舊清單留著，只提示更新失敗
      } finally {
        refreshing.value = false
      }
    }

    onMounted(load)
    return { status, sessions, refreshing, refreshFailed, load, refresh, PERIODS }
  },
  template: \`
    <h1>11/26 的門診</h1>
    <button type="button" data-test="refresh" :disabled="status === 'loading' || refreshing" @click="refresh">重新整理</button>

    <p v-if="status === 'loading'" data-test="loading">載入中…</p>
    <div v-else-if="status === 'error'" role="alert">
      <p>讀取失敗</p>
      <button type="button" data-test="retry" @click="load">重試</button>
    </div>
    <p v-else-if="status === 'empty'" data-test="empty">這天沒有門診</p>
    <template v-else>
      <p v-if="refreshFailed" role="alert">更新失敗，以下是先前的資料</p>
      <ul>
        <li v-for="s in sessions" :key="s.id" data-test="session">
          {{ PERIODS[s.period] }}診　{{ s.remaining > 0 ? '剩 ' + s.remaining + ' 名' : '額滿' }}
        </li>
      </ul>
    </template>\`,
}

createApp(SessionList).mount('#app')
`,
    tests: [
      { name: '請求進行中只顯示 loading', code: String.raw`
await waitFor(() => $('[data-test=loading]'))
assert(!$('[data-test=session]') && !$('[data-test=empty]') && !$('[role=alert]'), '載入中不應該出現清單、empty 或錯誤')` },
      { name: '成功：列出診次與剩餘名額', code: String.raw`
await waitFor(() => $$('[data-test=session]').length === 3)
const t = $$('[data-test=session]').map((li) => li.textContent.replace(/\s+/g, ''))
assert(t[0].includes('剩2名'), '第一個診次要顯示「剩 2 名」：' + t[0])
assert(t[1].includes('額滿') && !t[1].includes('剩0名'), 'remaining 是 0 時顯示「額滿」：' + t[1])
assert(!$('[data-test=loading]'), '成功後 loading 要消失')` },
      { name: '空陣列：顯示這天沒有門診', api: 'api.get(\'/api/sessions\', { body: [], delay: 50 })', code: String.raw`
await waitFor(() => $('[data-test=empty]'))
assertEqual(text('[data-test=empty]'), '這天沒有門診')
assert(!$('[data-test=loading]') && !$('[role=alert]'), 'empty 時不應該同時出現 loading 或錯誤')` },
      { name: '失敗後重試：回到 loading 再成功', api: 'api.get(\'/api/sessions\', [{ status: 500, body: api.problem(500), delay: 50 }, { body: SESSIONS, delay: 200 }])', code: String.raw`
await waitFor(() => $('[data-test=retry]'))
assert(!$('[data-test=empty]'), '失敗時不能顯示「這天沒有門診」')
assert($('[data-test=retry]').closest('[role=alert]'), '「重試」要在 role="alert" 的區塊裡')
click('[data-test=retry]')
await waitFor(() => $('[data-test=loading]'))
await waitFor(() => $$('[data-test=session]').length === 3)
assertEqual(api.calls.length, 2, '請求次數')` },
      { name: '重新整理：清單留著、更新中停用按鈕', code: String.raw`
await waitFor(() => $$('[data-test=session]').length === 3)
click('[data-test=refresh]')
await tick()
assertEqual($$('[data-test=session]').length, 3, '重新整理時清單要留在畫面上')
assert(!$('[data-test=loading]'), '已經有資料時不要回到 loading')
assert($('[data-test=refresh]').disabled, '更新中「重新整理」要 disabled')
await waitFor(() => !$('[data-test=refresh]').disabled)
assertEqual(api.calls.length, 2, '請求次數')` },
      { name: '重新整理失敗：保留舊清單並提示', api: 'api.get(\'/api/sessions\', [{ body: SESSIONS, delay: 50 }, { status: 503, body: api.problem(503), delay: 50 }])', code: String.raw`
await waitFor(() => $$('[data-test=session]').length === 3)
click('[data-test=refresh]')
await waitFor(() => $('[role=alert]'))
assertEqual(text('[role=alert]'), '更新失敗，以下是先前的資料', 'role="alert" 的文字')
assertEqual($$('[data-test=session]').length, 3, '更新失敗時舊清單要留著')` },
    ],
    hints: [
      '`status` 只有 `loading`、`success`、`empty`、`error` 四個值，模板用 `v-if`／`v-else-if` 分開。',
      '重新整理另外用一個 `refreshing` 旗標，不要把 `status` 改回 `loading`；失敗時另一個旗標記下「更新失敗」，清單不動。',
    ],
  },
  {
    id: 'project-fe-sessions-2', project: 'fe-sessions', skill: 'pagination-filter', kind: 'vue', level: 2,
    title: '篩選條件放在網址上',
    prompt: `診次清單的日期 \`<input data-test="date">\` 與醫師 \`<select data-test="doctor">\` 只存在元件的 ref 裡，重新整理或把網址傳給同事都會回到預設值。把條件放進網址：

沙箱的文件網址是 \`about:srcdoc\`，題目把 hash 當成 query，和 \`createWebHashHistory\` 的網址一樣（\`#/sessions?date=2026-11-27&doctor_id=2\`）。起始碼附了 \`readQuery()\` 與 \`replaceQuery(query)\`，分別代替 \`route.query\` 與 \`router.replace({ query })\`。沙箱 iframe 的瀏覽紀錄和網站共用，題目一律用 replace。

- 條件只從網址來：用 \`readQuery()\` 讀，解析時檢查：\`date\` 要是 \`YYYY-MM-DD\`，\`doctor_id\` 要是 \`1\` 或 \`2\`；不合法就用預設值（\`DEFAULT_DATE\`、全部醫師）
- 網址上的參數不合法時，用 \`replaceQuery\` 改成解析後的條件；和預設值相同的條件不寫進網址
- 使用者改了日期或醫師：寫回網址，再用新的條件請求 \`GET /api/sessions?date=…&doctor_id=…\`（全部醫師時不帶 \`doctor_id\`）
- 網址從外面改變時（\`hashchange\`，例如按上一頁）：照新的網址重新載入，輸入框跟著變`,
    api: String.raw`window.SESSIONS = [
  { id: 1, doctor_id: 1, session_date: '2026-11-26', period: 'morning', capacity: 2, remaining: 2 },
  { id: 2, doctor_id: 1, session_date: '2026-11-26', period: 'afternoon', capacity: 30, remaining: 0 },
  { id: 3, doctor_id: 2, session_date: '2026-11-26', period: 'morning', capacity: 30, remaining: 12 },
]
window.MORE = [{ id: 4, doctor_id: 2, session_date: '2026-11-27', period: 'afternoon', capacity: 30, remaining: 5 }]
api.get('/api/sessions', (req) => ({
  body: SESSIONS.concat(MORE).filter((s) => s.session_date === req.query.date && (!req.query.doctor_id || s.doctor_id === Number(req.query.doctor_id))),
  delay: 60,
}))`,
    starter: `import { createApp, ref, watch } from 'vue'

// 沙箱裡沒有 Vue Router：網址的 hash 當成 query（和 createWebHashHistory 的網址一樣，#/sessions?date=…）。
// readQuery() 代替 route.query；replaceQuery(query) 代替 router.replace({ query })
function readQuery() {
  return Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''))
}
function replaceQuery(query) {
  const url = new URL(location.href)
  const qs = new URLSearchParams(query).toString()
  url.hash = '/sessions' + (qs ? '?' + qs : '')
  history.replaceState(history.state, '', url)
}

const DEFAULT_DATE = '2026-11-26'
const DOCTORS = [{ id: 1, name: '林醫師' }, { id: 2, name: '張醫師' }]
const PERIODS = { morning: '上午', afternoon: '下午' }

const SessionList = {
  setup() {
    const date = ref(DEFAULT_DATE)
    const doctorId = ref('')          // '' 是全部醫師
    const sessions = ref([])

    async function load() {
      const params = new URLSearchParams({ date: date.value })
      if (doctorId.value) params.set('doctor_id', doctorId.value)
      const res = await fetch('/api/sessions?' + params)
      sessions.value = res.ok ? await res.json() : []
    }

    watch([date, doctorId], load, { immediate: true })
    return { date, doctorId, sessions, DOCTORS, PERIODS }
  },
  template: \`
    <label for="date">日期</label>
    <input id="date" type="date" data-test="date" v-model="date">
    <label for="doctor">醫師</label>
    <select id="doctor" data-test="doctor" v-model="doctorId">
      <option value="">全部醫師</option>
      <option v-for="d in DOCTORS" :key="d.id" :value="String(d.id)">{{ d.name }}</option>
    </select>
    <ul>
      <li v-for="s in sessions" :key="s.id" data-test="session">{{ s.session_date }} {{ PERIODS[s.period] }}</li>
    </ul>\`,
}

createApp(SessionList).mount('#app')
`,
    solution: `import { createApp, ref, computed, onMounted, onUnmounted } from 'vue'

// 沙箱裡沒有 Vue Router：網址的 hash 當成 query（和 createWebHashHistory 的網址一樣，#/sessions?date=…）。
// readQuery() 代替 route.query；replaceQuery(query) 代替 router.replace({ query })
function readQuery() {
  return Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''))
}
function replaceQuery(query) {
  const url = new URL(location.href)
  const qs = new URLSearchParams(query).toString()
  url.hash = '/sessions' + (qs ? '?' + qs : '')
  history.replaceState(history.state, '', url)
}

const DEFAULT_DATE = '2026-11-26'
const DOCTORS = [{ id: 1, name: '林醫師' }, { id: 2, name: '張醫師' }]
const PERIODS = { morning: '上午', afternoon: '下午' }

// 網址參數 → 條件：轉型、檢查、給預設值
function parseQuery(q) {
  return {
    date: /^\\d{4}-\\d{2}-\\d{2}$/.test(q.date || '') ? q.date : DEFAULT_DATE,
    doctorId: DOCTORS.some((d) => String(d.id) === q.doctor_id) ? q.doctor_id : '',
  }
}
// 條件 → 網址參數：和預設值相同的不寫
function toQuery(f) {
  const q = {}
  if (f.date !== DEFAULT_DATE) q.date = f.date
  if (f.doctorId) q.doctor_id = f.doctorId
  return q
}

const SessionList = {
  setup() {
    const query = ref(readQuery())                    // 網址是唯一的來源
    const filters = computed(() => parseQuery(query.value))
    const sessions = ref([])

    async function load() {
      const params = new URLSearchParams({ date: filters.value.date })
      if (filters.value.doctorId) params.set('doctor_id', filters.value.doctorId)
      const res = await fetch('/api/sessions?' + params)
      sessions.value = res.ok ? await res.json() : []
    }

    // 讀網址：不合法的參數改成合法的網址（replace），再載入
    function syncFromUrl() {
      query.value = readQuery()
      const normalized = toQuery(filters.value)
      if (new URLSearchParams(normalized).toString() !== new URLSearchParams(query.value).toString()) {
        replaceQuery(normalized)
        query.value = readQuery()
      }
      load()
    }

    // 輸入框只改網址，畫面跟著網址走
    function setFilter(patch) {
      const next = { ...filters.value, ...patch }
      replaceQuery(toQuery(parseQuery({ date: next.date, doctor_id: next.doctorId })))
      syncFromUrl()
    }

    onMounted(() => {
      syncFromUrl()
      window.addEventListener('hashchange', syncFromUrl)   // 上一頁、下一頁、別人改了網址
    })
    onUnmounted(() => window.removeEventListener('hashchange', syncFromUrl))
    return { filters, sessions, setFilter, DOCTORS, PERIODS }
  },
  template: \`
    <label for="date">日期</label>
    <input id="date" type="date" data-test="date" :value="filters.date"
           @change="setFilter({ date: $event.target.value })">
    <label for="doctor">醫師</label>
    <select id="doctor" data-test="doctor" :value="filters.doctorId" @change="setFilter({ doctorId: $event.target.value })">
      <option value="">全部醫師</option>
      <option v-for="d in DOCTORS" :key="d.id" :value="String(d.id)">{{ d.name }}</option>
    </select>
    <ul>
      <li v-for="s in sessions" :key="s.id" data-test="session">{{ s.session_date }} {{ PERIODS[s.period] }}</li>
    </ul>\`,
}

createApp(SessionList).mount('#app')
`,
    tests: [
      { name: '打開帶條件的網址：用網址上的條件請求', api: 'history.replaceState(null, \'\', \'about:srcdoc#/sessions?date=2026-11-27&doctor_id=2\')', code: String.raw`
await waitFor(() => api.calls.length >= 1)
assertEqual(api.calls[0].url, '/api/sessions?date=2026-11-27&doctor_id=2', '第一個請求')
await waitFor(() => $$('[data-test=session]').length === 1)
assertEqual($('[data-test=doctor]').value, '2', '醫師的選單')
assertEqual($('[data-test=date]').value, '2026-11-27', '日期欄')` },
      { name: '不合法的參數用預設值，網址改成合法的', api: 'history.replaceState(null, \'\', \'about:srcdoc#/sessions?date=11%2F27&doctor_id=abc\')', code: String.raw`
await waitFor(() => api.calls.length >= 1)
assertEqual(api.calls[0].url, '/api/sessions?date=2026-11-26', '第一個請求')
await tick()
const q = new URLSearchParams(location.hash.split('?')[1] || '')
assertEqual([q.get('date'), q.get('doctor_id')], [null, null], '網址上的 date 與 doctor_id（預設值不寫進網址；現在的 hash 是 ' + location.hash + '）')
assertEqual($('[data-test=doctor]').value, '', '醫師的選單要回到全部')` },
      { name: '改條件：寫回網址並重新請求', code: String.raw`
await waitFor(() => $$('[data-test=session]').length === 3)
select('[data-test=doctor]', '1')
await waitFor(() => api.calls.length === 2)
assertEqual(api.calls[1].url, '/api/sessions?date=2026-11-26&doctor_id=1', '改醫師後的請求')
let q = new URLSearchParams(location.hash.split('?')[1] || '')
assertEqual([q.get('date'), q.get('doctor_id')], [null, '1'], '網址上的 date 與 doctor_id（hash 是 ' + location.hash + '）')
input('[data-test=date]', '2026-11-27')
await waitFor(() => api.calls.length === 3)
q = new URLSearchParams(location.hash.split('?')[1] || '')
assertEqual([q.get('date'), q.get('doctor_id')], ['2026-11-27', '1'], '改日期後網址上的 date 與 doctor_id（hash 是 ' + location.hash + '）')
select('[data-test=doctor]', '')
await waitFor(() => api.calls.length === 4)
q = new URLSearchParams(location.hash.split('?')[1] || '')
assertEqual(q.get('doctor_id'), null, '選回全部醫師時網址上的 doctor_id')` },
      { name: '網址從外面改變（上一頁）：跟著重新載入', code: String.raw`
await waitFor(() => $$('[data-test=session]').length === 3)
history.replaceState(null, '', 'about:srcdoc#/sessions?doctor_id=2')
window.dispatchEvent(new HashChangeEvent('hashchange'))
await waitFor(() => api.calls.length === 2)
assertEqual(api.calls[1].url, '/api/sessions?date=2026-11-26&doctor_id=2', '網址改變後的請求')
await waitFor(() => $$('[data-test=session]').length === 1)
assertEqual($('[data-test=doctor]').value, '2', '醫師的選單要跟著網址')` },
    ],
    hints: [
      '寫一個 `parseQuery(query)` 把網址參數轉成條件（檢查格式、給預設值），一個 `toQuery(filters)` 把條件轉回參數（省略預設值）。',
      '輸入框用 `:value` 與 `@change`：改變時只寫網址，再從網址讀回條件、重新請求。不要另外留一份條件的 ref。',
      '`window.addEventListener(\'hashchange\', …)` 在 `onMounted` 加、`onUnmounted` 移除。',
    ],
  },

  // ───────────── 3. fe-booking ─────────────
  {
    id: 'project-fe-booking-1', project: 'fe-booking', skill: 'form-submit', kind: 'vue', level: 2,
    title: '422 對回欄位、409 依 type 顯示',
    prompt: `櫃台替病患掛號：表單 \`data-test="booking"\` 有病歷號 \`#patient-id\` 與備註 \`#note\`，送出 \`POST /api/sessions/2/appointments\`（body \`{ patient_id, note }\`），成功回 201 與新的掛號 \`{ id, number, … }\`。起始碼把所有錯誤都顯示成 \`title\`，而且不管成功失敗都清空表單。改成：

- 422：\`errors\` 是 \`{ 欄位: ['訊息'] }\`。表單上有的欄位（\`patient_id\`、\`note\`）把第一則訊息放在欄位下方的 \`<p id="patient-id-error">\`、\`<p id="note-error">\`，輸入框加 \`aria-invalid="true"\` 與指向訊息的 \`aria-describedby\`；焦點移到表單上第一個出錯的欄位（依表單的順序）。表單上沒有的欄位，訊息寫成「欄位：訊息」放在上方 \`role="alert"\`
- 409：依 \`type\` 在上方 \`role="alert"\` 顯示中文：\`…/session-full\` 是「這個診次已額滿」，\`…/already-booked\` 是「這位病患已經掛過這個診次」，其他 409 用 \`detail\`；同一個區塊裡放「選擇其他診次」按鈕 \`data-test="pick-session"\`
- 失敗時保留使用者輸入的內容，只有成功才清空；每次送出前清掉上一次的錯誤
- 成功：顯示 \`<p data-test="done">\`「掛號成功，第 N 號」`,
    api: 'api.latency = 60',
    starter: `import { createApp, ref, reactive } from 'vue'

const SESSION_ID = 2   // 11/26 下午　林醫師

const BookingForm = {
  setup() {
    const fields = reactive({ patient_id: '', note: '' })
    const error = ref('')
    const done = ref(null)

    async function submit() {
      error.value = ''
      try {
        const res = await fetch('/api/sessions/' + SESSION_ID + '/appointments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patient_id: Number(fields.patient_id), note: fields.note }),
        })
        const data = await res.json()
        if (res.ok) done.value = data
        else error.value = data.title
      } finally {
        fields.patient_id = ''
        fields.note = ''
      }
    }

    return { fields, error, done, submit }
  },
  template: \`
    <form data-test="booking" @submit.prevent="submit">
      <p v-if="error" role="alert">{{ error }}</p>

      <label for="patient-id">病歷號</label>
      <input id="patient-id" v-model="fields.patient_id" inputmode="numeric">

      <label for="note">備註</label>
      <textarea id="note" v-model="fields.note"></textarea>

      <button type="submit">掛號</button>
    </form>
    <p v-if="done" data-test="done">掛號成功，第 {{ done.number }} 號</p>\`,
}

createApp(BookingForm).mount('#app')
`,
    solution: `import { createApp, ref, reactive, nextTick } from 'vue'

const SESSION_ID = 2   // 11/26 下午　林醫師
const FIELDS = ['patient_id', 'note']                      // 表單上的順序
const INPUT_ID = { patient_id: 'patient-id', note: 'note' }  // 後端欄位名稱 → 輸入框的 id
// 409 依 type 對應中文；title 是給開發者看的英文
const CONFLICT_TEXT = {
  'https://clinic.example/problems/session-full': '這個診次已額滿',
  'https://clinic.example/problems/already-booked': '這位病患已經掛過這個診次',
}

const BookingForm = {
  emits: ['pick-session'],   // 上層（診次清單）接手換頁
  setup() {
    const fields = reactive({ patient_id: '', note: '' })
    const fieldErrors = ref({})       // { patient_id: '查無此病歷號' }
    const formError = ref(null)       // { text, pickSession }
    const done = ref(null)

    async function submit() {
      fieldErrors.value = {}          // 每次送出前清掉上一次的錯誤
      formError.value = null
      let res
      try {
        res = await fetch('/api/sessions/' + SESSION_ID + '/appointments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patient_id: Number(fields.patient_id), note: fields.note }),
        })
      } catch {
        formError.value = { text: '無法連線，請檢查網路後再送出一次' }
        return
      }
      const problem = await res.json().catch(() => ({}))
      if (res.status === 201) {
        done.value = problem
        fields.patient_id = ''        // 只有成功才清空
        fields.note = ''
        return
      }
      if (res.status === 422) {
        // 假 API 的 errors 是 { 欄位: ['訊息'] }（本站的約定，不是 Problem Details 的標準欄位）
        const errors = problem.errors || {}
        const mine = {}
        const others = []
        for (const [name, messages] of Object.entries(errors)) {
          const message = [].concat(messages)[0]
          if (FIELDS.includes(name)) mine[name] = message
          else others.push(name + '：' + message)   // 表單上沒有的欄位：放上方，不丟掉
        }
        fieldErrors.value = mine
        if (others.length) formError.value = { text: others.join('；') }
        await nextTick()
        const first = FIELDS.find((k) => mine[k])
        if (first) document.getElementById(INPUT_ID[first]).focus()
        return
      }
      if (res.status === 409) {
        formError.value = { text: CONFLICT_TEXT[problem.type] || problem.detail || '無法完成掛號', pickSession: true }
        return
      }
      formError.value = { text: '系統暫時無法處理，請再送出一次' }
    }

    return { fields, fieldErrors, formError, done, submit }
  },
  template: \`
    <form data-test="booking" @submit.prevent="submit">
      <div v-if="formError" role="alert">
        <p>{{ formError.text }}</p>
        <button v-if="formError.pickSession" type="button" data-test="pick-session" @click="$emit('pick-session')">選擇其他診次</button>
      </div>

      <label for="patient-id">病歷號</label>
      <input id="patient-id" v-model="fields.patient_id" inputmode="numeric"
             :aria-invalid="fieldErrors.patient_id ? 'true' : undefined"
             :aria-describedby="fieldErrors.patient_id ? 'patient-id-error' : undefined">
      <p v-if="fieldErrors.patient_id" id="patient-id-error">{{ fieldErrors.patient_id }}</p>

      <label for="note">備註</label>
      <textarea id="note" v-model="fields.note"
                :aria-invalid="fieldErrors.note ? 'true' : undefined"
                :aria-describedby="fieldErrors.note ? 'note-error' : undefined"></textarea>
      <p v-if="fieldErrors.note" id="note-error">{{ fieldErrors.note }}</p>

      <button type="submit">掛號</button>
    </form>
    <p v-if="done" data-test="done">掛號成功，第 {{ done.number }} 號</p>\`,
}

createApp(BookingForm).mount('#app')
`,
    tests: [
      { name: '422：訊息放到欄位下方，加上 aria', api: 'api.post(\'/api/sessions/:id/appointments\', { status: 422, body: api.problem(422, \'欄位格式錯誤\', { code: \'validation-error\', errors: { patient_id: [\'查無此病歷號\'] } }) })', code: String.raw`
input('#patient-id', '9999999')
submit('[data-test=booking]')
await waitFor(() => $('#patient-id-error'))
assertEqual(text('#patient-id-error'), '查無此病歷號', '#patient-id-error 的文字')
assertEqual($('#patient-id').getAttribute('aria-invalid'), 'true', '#patient-id 的 aria-invalid')
assert(($('#patient-id').getAttribute('aria-describedby') || '').split(/\s+/).includes('patient-id-error'), '#patient-id 的 aria-describedby 要指向 patient-id-error')
assert(!$('[role=alert]'), '對得到欄位的錯誤不用放上方（現在顯示：' + text('[role=alert]') + '）')
assertEqual($('#patient-id').value, '9999999', '失敗後病歷號要保留')` },
      { name: '422：焦點移到表單上第一個出錯的欄位', api: 'api.post(\'/api/sessions/:id/appointments\', { status: 422, body: api.problem(422, \'欄位格式錯誤\', { code: \'validation-error\', errors: { note: [\'備註最多 200 字\'], patient_id: [\'必填\'] } }) })', code: FOCUS_HELPER + String.raw`
input('#note', '需要輪椅')
submit('[data-test=booking]')
await waitFor(() => $('#note-error') && $('#patient-id-error'))
assertEqual([text('#patient-id-error'), text('#note-error')], ['必填', '備註最多 200 字'], '兩個欄位的訊息')
assertEqual(focusedEl() && focusedEl().id, 'patient-id', '焦點要在表單上第一個出錯的欄位（病歷號在備註上面）')` },
      { name: '422：表單上沒有的欄位放在上方', api: 'api.post(\'/api/sessions/:id/appointments\', { status: 422, body: api.problem(422, \'欄位格式錯誤\', { code: \'validation-error\', errors: { session_id: [\'這個診次已停止掛號\'] } }) })', code: String.raw`
input('#patient-id', '1')
submit('[data-test=booking]')
await waitFor(() => $('[role=alert]'))
assert(text('[role=alert]').includes('session_id：這個診次已停止掛號'), 'role="alert" 要顯示「session_id：這個診次已停止掛號」：' + text('[role=alert]'))` },
      { name: '409 session-full：中文訊息、選其他診次、保留輸入', api: 'api.post(\'/api/sessions/:id/appointments\', { status: 409, body: api.problem(409, \'這個門診已經額滿\', { code: \'session-full\', title: \'Session full\' }) })', code: String.raw`
input('#patient-id', '1')
input('#note', '需要輪椅')
submit('[data-test=booking]')
await waitFor(() => $('[role=alert]'))
assert(text('[role=alert]').includes('這個診次已額滿'), 'role="alert" 的文字：' + text('[role=alert]'))
assert($('[role=alert] [data-test=pick-session]'), '「選擇其他診次」要在 role="alert" 的區塊裡')
assertEqual([$('#patient-id').value, $('#note').value], ['1', '需要輪椅'], '409 後表單內容要保留')` },
      { name: '409 already-booked：依 type 換文案', api: 'api.post(\'/api/sessions/:id/appointments\', { status: 409, body: api.problem(409, \'這個門診已經掛過號了\', { code: \'already-booked\', title: \'Already booked\' }) })', code: String.raw`
input('#patient-id', '1')
submit('[data-test=booking]')
await waitFor(() => $('[role=alert]'))
assert(text('[role=alert]').includes('這位病患已經掛過這個診次'), 'role="alert" 的文字：' + text('[role=alert]'))` },
      { name: '改正後再送：清掉舊的錯誤、成功才清空', api: 'api.post(\'/api/sessions/:id/appointments\', [{ status: 422, body: api.problem(422, \'欄位格式錯誤\', { code: \'validation-error\', errors: { patient_id: [\'必填\'] } }) }, { status: 201, body: { id: 9, session_id: 2, patient_id: 3, number: 5, status: \'booked\' } }])', code: String.raw`
submit('[data-test=booking]')
await waitFor(() => $('#patient-id-error'))
input('#patient-id', '3')
submit('[data-test=booking]')
await waitFor(() => $('[data-test=done]'))
assertEqual(text('[data-test=done]'), '掛號成功，第 5 號')
assert(!$('#patient-id-error'), '成功後舊的錯誤訊息要消失')
assert($('#patient-id').getAttribute('aria-invalid') !== 'true', '成功後 aria-invalid 要拿掉')
assertEqual($('#patient-id').value, '', '成功後清空病歷號')` },
    ],
    hints: [
      '把 `errors` 分成兩堆：名稱在表單欄位清單裡的放進 `fieldErrors`，其他的組成「欄位：訊息」放上方。',
      '焦點依表單上的欄位順序找第一個出錯的，不要依 `errors` 物件的順序；`await nextTick()` 之後再 `focus()`。',
      '`type` 是穩定的識別碼，做一張 `type → 中文` 的對照表；`title` 是給開發者看的英文。',
    ],
  },
  {
    id: 'project-fe-booking-2', project: 'fe-booking', skill: 'ui-states', kind: 'vue', level: 2,
    title: '防重複送出、冪等鍵與成功的回饋',
    prompt: `同一個掛號表單（\`data-test="booking"\`，病歷號 \`#patient-id\`），送出 \`POST /api/sessions/2/appointments\`。網路慢時櫃台會再按一次；網路斷掉時重送，後端可能已經建立過這筆掛號。改成：

- 送出中：按鈕 \`data-test="submit"\` 設成 \`disabled\`、文字「送出中…」；送出中再送出（按鈕、Enter）不會送第二個請求
- 每次送出帶 \`Idempotency-Key\` 標頭：按下送出時用 \`crypto.randomUUID()\` 產生；網路錯誤或 5xx 之後重送沿用同一個；收到 201、409、422 之後，下一次送出換新的
- 網路錯誤：\`role="alert"\` 顯示「無法連線，請檢查網路後再送一次」，保留輸入的病歷號
- 成功：\`role="status"\` 的元素顯示「掛號成功：第 N 號」並清空病歷號。這個元素從一開始就在 DOM 裡（內容是空的），之後只改它的文字，螢幕閱讀器才會念出來`,
    api: 'api.latency = 200',
    starter: `import { createApp, ref } from 'vue'

const SESSION_ID = 2

const BookingForm = {
  setup() {
    const patientId = ref('')
    const error = ref('')
    const message = ref('')

    async function submit() {
      error.value = ''
      message.value = ''
      try {
        const res = await fetch('/api/sessions/' + SESSION_ID + '/appointments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patient_id: Number(patientId.value) }),
        })
        const data = await res.json()
        if (res.ok) message.value = '掛號成功：第 ' + data.number + ' 號'
        else error.value = data.detail || '無法完成掛號'
      } catch {
        error.value = '無法連線，請檢查網路後再送一次'
        patientId.value = ''
      }
    }

    return { patientId, error, message, submit }
  },
  template: \`
    <form data-test="booking" @submit.prevent="submit">
      <p v-if="error" role="alert">{{ error }}</p>
      <label for="patient-id">病歷號</label>
      <input id="patient-id" v-model="patientId" inputmode="numeric">
      <button type="submit" data-test="submit">掛號</button>
    </form>
    <p v-if="message" role="status">{{ message }}</p>\`,
}

createApp(BookingForm).mount('#app')
`,
    solution: `import { createApp, ref } from 'vue'

const SESSION_ID = 2

const BookingForm = {
  setup() {
    const patientId = ref('')
    const error = ref('')
    const message = ref('')           // 寫進一直存在的 role="status" 容器
    const submitting = ref(false)
    let idempotencyKey = null         // 同一次送出的重送沿用同一個鍵

    async function submit() {
      if (submitting.value) return    // 送出中：按鈕、Enter 都不再送
      submitting.value = true
      error.value = ''
      message.value = ''
      idempotencyKey ??= crypto.randomUUID()
      try {
        const res = await fetch('/api/sessions/' + SESSION_ID + '/appointments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify({ patient_id: Number(patientId.value) }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.status >= 500) {
          error.value = '系統暫時無法處理，請再送一次'   // 5xx：保留鍵，重送是同一筆
          return
        }
        idempotencyKey = null                           // 201、409、422：這次已經有結果，下一次是新的請求
        if (res.ok) {
          message.value = '掛號成功：第 ' + data.number + ' 號'
          patientId.value = ''
        } else {
          error.value = data.detail || '無法完成掛號'
        }
      } catch {
        error.value = '無法連線，請檢查網路後再送一次'  // 網路錯誤：保留鍵與輸入的內容
      } finally {
        submitting.value = false
      }
    }

    return { patientId, error, message, submitting, submit }
  },
  template: \`
    <form data-test="booking" @submit.prevent="submit">
      <p v-if="error" role="alert">{{ error }}</p>
      <label for="patient-id">病歷號</label>
      <input id="patient-id" v-model="patientId" inputmode="numeric">
      <button type="submit" data-test="submit" :disabled="submitting">{{ submitting ? '送出中…' : '掛號' }}</button>
    </form>
    <p role="status">{{ message }}</p>\`,
}

createApp(BookingForm).mount('#app')
`,
    tests: [
      { name: 'role="status" 一開始就在，內容是空的', code: String.raw`
await tick()
assert($('[role=status]'), '一開始就要有 role="status" 的元素')
assertEqual(text('[role=status]'), '', 'role="status" 一開始的內容')` },
      { name: '送出中停用按鈕，再送出也只有一個請求', code: String.raw`
input('#patient-id', '1')
submit('[data-test=booking]')
await tick()
assert($('[data-test=submit]').disabled, '送出中按鈕要 disabled')
assertEqual(text('[data-test=submit]'), '送出中…', '送出中的按鈕文字')
submit('[data-test=booking]')
await waitFor(() => text('[role=status]'))
await wait(100)
assertEqual(api.calls.filter((c) => c.method === 'POST').length, 1, 'POST 次數')` },
      { name: '網路錯誤後重送，沿用同一個 Idempotency-Key', api: String.raw`window.keys = []
api.post('/api/sessions/:id/appointments', (req) => {
  keys.push(req.headers['idempotency-key'] || null)
  return keys.length === 1 ? { network: true, delay: 50 } : { status: 201, body: { id: 1, session_id: 2, patient_id: 1, number: 3, status: 'booked' }, delay: 50 }
})`, code: String.raw`
input('#patient-id', '1')
submit('[data-test=booking]')
await waitFor(() => $('[role=alert]'))
assertEqual(text('[role=alert]'), '無法連線，請檢查網路後再送一次', 'role="alert" 的文字')
assertEqual($('#patient-id').value, '1', '網路錯誤後病歷號要保留')
submit('[data-test=booking]')
await waitFor(() => text('[role=status]'))
assertEqual(keys.length, 2, '請求次數')
assert(keys[0], '請求要帶 Idempotency-Key 標頭')
assertEqual(keys[1], keys[0], '重送時的 Idempotency-Key')` },
      { name: '成功之後再掛一筆，換新的 Idempotency-Key', api: String.raw`window.keys = []
api.post('/api/sessions/:id/appointments', (req) => {
  keys.push(req.headers['idempotency-key'] || null)
  return { status: 201, body: { id: keys.length, session_id: 2, patient_id: 1, number: keys.length, status: 'booked' }, delay: 50 }
})`, code: String.raw`
input('#patient-id', '1')
submit('[data-test=booking]')
await waitFor(() => text('[role=status]'))
input('#patient-id', '2')
submit('[data-test=booking]')
await waitFor(() => keys.length === 2 && !$('[data-test=submit]').disabled)
assert(keys[0] && keys[1], '每個請求都要帶 Idempotency-Key 標頭')
assert(keys[0] !== keys[1], '兩次不同的送出要用不同的 Idempotency-Key（都是 ' + keys[0] + '）')` },
      { name: '成功：status 顯示號碼、清空病歷號', code: String.raw`
const status = $('[role=status]')
input('#patient-id', '1')
submit('[data-test=booking]')
await waitFor(() => text('[role=status]'))
assertEqual(text('[role=status]'), '掛號成功：第 1 號', 'role="status" 的文字')
assert($('[role=status]') === status, 'role="status" 的元素要一直是同一個，只改文字（不要用 v-if 重新插入）')
assertEqual($('#patient-id').value, '', '成功後清空病歷號')` },
    ],
    hints: [
      '`let idempotencyKey = null`，送出時 `idempotencyKey ??= crypto.randomUUID()`；收到 201、409、422 才把它設回 `null`。',
      '`role="status"` 的 `<p>` 不加 `v-if`，訊息用 `{{ message }}` 放進去。',
    ],
  },

  // ───────────── 4. fe-appointments ─────────────
  {
    id: 'project-fe-appointments-1', project: 'fe-appointments', skill: 'pagination-filter', kind: 'vue', level: 2,
    title: 'cursor 分頁的「載入更多」',
    prompt: `「我的掛號」呼叫 \`GET /api/appointments?limit=5\`，回傳 \`{ items, next_cursor }\`；下一批帶 \`cursor=<next_cursor>\`，\`next_cursor\` 是 \`null\` 代表沒有下一批。這位病患有 12 筆掛號。起始碼每按一次「載入更多」就把清單換成新的一批，失敗時整份清單清空。改成：

- 每筆一個 \`<li data-test="appt">\`，內容是「第 N 號」
- 「載入更多」\`data-test="more"\`：新的一批接在後面；只在 \`next_cursor\` 不是 \`null\` 時出現；載入中按鈕 \`disabled\`，連按也只送一個請求
- 「載入更多」失敗：已載入的保留，\`role="alert"\` 顯示「載入失敗，請再按一次「載入更多」」，按鈕可以再按`,
    api: String.raw`const ITEMS = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, session_id: 2, patient_id: 1, number: i + 1, status: 'booked' }))
window.page = (req) => {
  const cursor = Number(req.query.cursor || 0)
  const limit = Number(req.query.limit || 50)
  const rest = ITEMS.filter((a) => a.id > cursor)
  const items = rest.slice(0, limit)
  return { body: { items, next_cursor: rest.length > limit ? items[items.length - 1].id : null }, delay: 120 }
}
api.get('/api/appointments', page)`,
    starter: `import { createApp, ref, onMounted } from 'vue'

const LIMIT = 5

const MyAppointments = {
  setup() {
    const items = ref([])
    const nextCursor = ref(null)
    const error = ref('')

    async function fetchBatch(cursor) {
      const params = new URLSearchParams({ limit: String(LIMIT) })
      if (cursor) params.set('cursor', cursor)
      const res = await fetch('/api/appointments?' + params)
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.json()   // { items, next_cursor }
    }

    async function loadMore() {
      try {
        const page = await fetchBatch(nextCursor.value)
        items.value = page.items
        nextCursor.value = page.next_cursor
      } catch {
        items.value = []
        error.value = '讀取失敗'
      }
    }

    onMounted(loadMore)
    return { items, error, loadMore }
  },
  template: \`
    <h2>我的掛號</h2>
    <p v-if="error" role="alert">{{ error }}</p>
    <ul>
      <li v-for="a in items" :key="a.id" data-test="appt">第 {{ a.number }} 號</li>
    </ul>
    <button type="button" data-test="more" @click="loadMore">載入更多</button>\`,
}

createApp(MyAppointments).mount('#app')
`,
    solution: `import { createApp, ref, onMounted } from 'vue'

const LIMIT = 5

const MyAppointments = {
  setup() {
    const status = ref('loading')      // 第一批：loading | success | empty | error
    const items = ref([])
    const nextCursor = ref(null)       // null：沒有下一批
    const loadingMore = ref(false)
    const loadMoreFailed = ref(false)

    async function fetchBatch(cursor) {
      const params = new URLSearchParams({ limit: String(LIMIT) })
      if (cursor) params.set('cursor', cursor)
      const res = await fetch('/api/appointments?' + params)
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.json()                // { items, next_cursor }
    }

    async function loadFirst() {
      status.value = 'loading'
      try {
        const page = await fetchBatch(null)
        items.value = page.items
        nextCursor.value = page.next_cursor
        status.value = page.items.length ? 'success' : 'empty'
      } catch {
        status.value = 'error'
      }
    }

    async function loadMore() {
      if (loadingMore.value || !nextCursor.value) return   // 載入中：連按也只送一次
      loadingMore.value = true
      loadMoreFailed.value = false
      try {
        const page = await fetchBatch(nextCursor.value)
        items.value.push(...page.items)                      // 接在後面
        nextCursor.value = page.next_cursor
      } catch {
        loadMoreFailed.value = true                          // 已載入的留著，可以再按一次
      } finally {
        loadingMore.value = false
      }
    }

    onMounted(loadFirst)
    return { status, items, nextCursor, loadingMore, loadMoreFailed, loadFirst, loadMore }
  },
  template: \`
    <h2>我的掛號</h2>
    <p v-if="status === 'loading'">載入中…</p>
    <div v-else-if="status === 'error'" role="alert">
      <p>讀取失敗</p>
      <button type="button" @click="loadFirst">重試</button>
    </div>
    <p v-else-if="status === 'empty'">還沒有掛號</p>
    <template v-else>
      <ul>
        <li v-for="a in items" :key="a.id" data-test="appt">第 {{ a.number }} 號</li>
      </ul>
      <p v-if="loadMoreFailed" role="alert">載入失敗，請再按一次「載入更多」</p>
      <button v-if="nextCursor" type="button" data-test="more" :disabled="loadingMore" @click="loadMore">
        {{ loadingMore ? '載入中…' : '載入更多' }}
      </button>
    </template>\`,
}

createApp(MyAppointments).mount('#app')
`,
    tests: [
      { name: '第一批：limit=5，沒有 cursor', code: String.raw`
await waitFor(() => $$('[data-test=appt]').length === 5)
assertEqual(api.calls[0].url, '/api/appointments?limit=5', '第一個請求')` },
      { name: '「載入更多」接在後面，用 next_cursor', code: String.raw`
await waitFor(() => $('[data-test=more]') && $$('[data-test=appt]').length === 5)
click('[data-test=more]')
await waitFor(() => $$('[data-test=appt]').length === 10)
assertEqual(api.calls[1].url, '/api/appointments?limit=5&cursor=5', '第二個請求')
assertEqual($$('[data-test=appt]').map((li) => li.textContent.trim()), Array.from({ length: 10 }, (_, i) => '第 ' + (i + 1) + ' 號'), '清單內容')` },
      { name: '最後一批之後沒有「載入更多」', code: String.raw`
await waitFor(() => $('[data-test=more]') && $$('[data-test=appt]').length === 5)
click('[data-test=more]')
await waitFor(() => $$('[data-test=appt]').length === 10 && $('[data-test=more]') && !$('[data-test=more]').disabled)
click('[data-test=more]')
await waitFor(() => $$('[data-test=appt]').length === 12)
await tick()
assert(!$('[data-test=more]'), 'next_cursor 是 null 時不要再顯示「載入更多」')` },
      { name: '載入中停用按鈕，連按只送一個請求', code: String.raw`
await waitFor(() => $('[data-test=more]') && $$('[data-test=appt]').length === 5)
const btn = $('[data-test=more]')
btn.click()
btn.click()
await tick()
assert($('[data-test=more]').disabled, '載入中「載入更多」要 disabled')
await waitFor(() => $$('[data-test=appt]').length === 10)
await wait(150)
assertEqual(api.calls.length, 2, '請求次數（第一批加一次載入更多）')` },
      { name: '載入更多失敗：保留已載入的，可以再按', api: String.raw`let n = 0
api.get('/api/appointments', (req) => (++n === 2 ? { status: 503, body: api.problem(503), delay: 60 } : page(req)))`, code: String.raw`
await waitFor(() => $('[data-test=more]') && $$('[data-test=appt]').length === 5)
click('[data-test=more]')
await waitFor(() => $('[role=alert]'))
assertEqual(text('[role=alert]'), '載入失敗，請再按一次「載入更多」', 'role="alert" 的文字')
assertEqual($$('[data-test=appt]').length, 5, '失敗時已載入的 5 筆要留著')
assert($('[data-test=more]') && !$('[data-test=more]').disabled, '失敗後「載入更多」要能再按')
click('[data-test=more]')
await waitFor(() => $$('[data-test=appt]').length === 10)` },
    ],
    hints: [
      '`items.value.push(...page.items)`，不要 `items.value = page.items`；`nextCursor` 跟著換成這一批的 `next_cursor`。',
      '`loadingMore` 旗標：函式開頭檢查，`finally` 設回 `false`；按鈕綁 `:disabled="loadingMore"`。',
      '「載入更多」的失敗和第一批的失敗分開記：前者只多一行提示，清單不動。',
    ],
  },
  {
    id: 'project-fe-appointments-2', project: 'fe-appointments', skill: 'overlays', kind: 'vue', level: 2,
    title: '取消前用 <dialog> 確認',
    prompt: `「我的掛號」的每一列是 \`<li data-test="appt">\`，狀態是 \`booked\` 的列有「取消掛號」\`data-test="cancel"\`。起始碼用 \`confirm()\` 確認，取消後整份清單重抓。改成：

- 按「取消掛號」：用原生 \`<dialog>\` 的 \`showModal()\` 開確認視窗。標題是 \`<h2 id="cancel-title">\`「取消第 N 號的掛號？」，\`<dialog>\` 用 \`aria-labelledby\` 指到它；開啟時焦點在比較安全的「保留掛號」\`data-test="keep"\`（一般的頁面在它身上加 \`autofocus\`；沙箱是跨來源的 iframe，Chromium 會擋下裡面的 \`autofocus\`，這題在 \`showModal()\` 之後自己呼叫 \`focus()\`）
- 「保留掛號」：關閉，不送請求，焦點回到開啟它的「取消掛號」
- 「確定取消」\`data-test="confirm"\`：送 \`POST /api/appointments/{id}/cancel\`，成功後用回應的掛號更新那一列（不重抓整份清單）；那一列的「取消掛號」不見了，焦點移到清單標題 \`<h2 id="list-title" tabindex="-1">\`
- 取消失敗（例如 409）：\`role="alert"\` 顯示回應的 \`detail\`，那一列不變

沙箱會攔下所有表單送出，\`<form method="dialog">\` 在這裡關不掉視窗：兩顆按鈕用 \`type="button"\`，自己呼叫 \`close()\`。`,
    api: String.raw`const ITEMS = [
  { id: 41, session_id: 1, patient_id: 1, number: 3, status: 'booked' },
  { id: 42, session_id: 2, patient_id: 1, number: 7, status: 'booked' },
  { id: 43, session_id: 3, patient_id: 1, number: 2, status: 'cancelled' },
]
api.get('/api/appointments', { body: { items: ITEMS, next_cursor: null }, delay: 50 })
api.post('/api/appointments/:id/cancel', (req) => ({ body: { ...ITEMS.find((a) => a.id === Number(req.params.id)), status: 'cancelled' }, delay: 80 }))`,
    starter: `import { createApp, ref, onMounted } from 'vue'

const STATUS_TEXT = { booked: '已掛號', cancelled: '已取消', checked_in: '已報到' }

const MyAppointments = {
  setup() {
    const items = ref([])
    const error = ref('')

    async function load() {
      const res = await fetch('/api/appointments?limit=20')
      items.value = (await res.json()).items
    }

    async function cancel(a) {
      if (!confirm('確定要取消第 ' + a.number + ' 號的掛號嗎？')) return
      error.value = ''
      const res = await fetch('/api/appointments/' + a.id + '/cancel', { method: 'POST' })
      if (res.ok) await load()            // 取消後整份重抓
      else error.value = '取消失敗'
    }

    onMounted(load)
    return { items, error, cancel, STATUS_TEXT }
  },
  template: \`
    <h2 id="list-title">我的掛號</h2>
    <p v-if="error" role="alert">{{ error }}</p>
    <ul>
      <li v-for="a in items" :key="a.id" data-test="appt">
        第 {{ a.number }} 號　{{ STATUS_TEXT[a.status] }}
        <button v-if="a.status === 'booked'" type="button" data-test="cancel" @click="cancel(a)">取消掛號</button>
      </li>
    </ul>\`,
}

createApp(MyAppointments).mount('#app')
`,
    solution: `import { createApp, ref, onMounted, nextTick, useTemplateRef } from 'vue'

const STATUS_TEXT = { booked: '已掛號', cancelled: '已取消', checked_in: '已報到' }

const MyAppointments = {
  setup() {
    const items = ref([])
    const error = ref('')
    const target = ref(null)                     // 要取消的那一筆
    const dialog = useTemplateRef('dialog')      // Vue 3.5

    async function load() {
      const res = await fetch('/api/appointments?limit=20')
      items.value = (await res.json()).items
    }

    function ask(a) {
      target.value = a
      dialog.value.showModal()                   // 背景變成 inert，開啟前有焦點的元素被記下來
      // 一般的頁面在「保留掛號」加 autofocus 就好；沙箱是跨來源的 iframe，Chromium 擋下裡面的 autofocus，改成自己移
      dialog.value.querySelector('[data-test=keep]').focus()
    }

    function keep() {
      dialog.value.close()                       // 焦點自動回到開啟前的「取消掛號」
    }

    async function confirmCancel() {
      const a = target.value
      dialog.value.close()
      error.value = ''
      const res = await fetch('/api/appointments/' + a.id + '/cancel', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        error.value = body.detail || '取消失敗，請稍後再試'   // 409：那一列不變
        return
      }
      const i = items.value.findIndex((x) => x.id === a.id)
      if (i >= 0) items.value[i] = body           // 用回應更新這一列，不重抓整份清單
      await nextTick()
      document.getElementById('list-title').focus()   // 觸發按鈕跟著消失了：焦點移到清單標題
    }

    onMounted(load)
    return { items, error, target, ask, keep, confirmCancel, STATUS_TEXT }
  },
  template: \`
    <h2 id="list-title" tabindex="-1">我的掛號</h2>
    <p v-if="error" role="alert">{{ error }}</p>
    <ul>
      <li v-for="a in items" :key="a.id" data-test="appt">
        第 {{ a.number }} 號　{{ STATUS_TEXT[a.status] }}
        <button v-if="a.status === 'booked'" type="button" data-test="cancel" @click="ask(a)">取消掛號</button>
      </li>
    </ul>

    <dialog ref="dialog" aria-labelledby="cancel-title" aria-describedby="cancel-desc">
      <h2 id="cancel-title">取消第 {{ target?.number }} 號的掛號？</h2>
      <p id="cancel-desc">取消後名額會開放給其他人，無法復原。</p>
      <button type="button" data-test="keep" @click="keep">保留掛號</button>
      <button type="button" data-test="confirm" @click="confirmCancel">確定取消</button>
    </dialog>\`,
}

createApp(MyAppointments).mount('#app')
`,
    tests: [
      { name: '開啟的是 modal dialog，焦點在「保留掛號」', code: FOCUS_HELPER + String.raw`
await waitFor(() => $('[data-test=cancel]'))
const btn = $('[data-test=cancel]')
btn.focus()
click(btn)
await tick()
const d = $('dialog')
assert(d, '找不到 <dialog>')
assert(d.matches(':modal'), '要用 showModal() 開啟（現在不是 modal）')
const title = document.getElementById(d.getAttribute('aria-labelledby') || '')
assert(title && title.textContent.includes('第 3 號'), '<dialog> 的 aria-labelledby 要指到含「第 3 號」的標題')
assertEqual(focusedEl() && focusedEl().dataset.test, 'keep', '開啟時焦點所在的按鈕')` },
      { name: '「保留掛號」：不送請求，焦點回到觸發按鈕', code: FOCUS_HELPER + String.raw`
await waitFor(() => $('[data-test=cancel]'))
const btn = $('[data-test=cancel]')
btn.focus()
click(btn)
await tick()
click('[data-test=keep]')
await wait(50)
assert(!$('dialog').open, '按「保留掛號」後要關閉')
assertEqual(api.calls.filter((c) => c.method === 'POST').length, 0, 'POST 次數')
assert(focusedEl() === btn, '焦點要回到開啟它的「取消掛號」')` },
      { name: '「確定取消」：一個 POST、更新那一列、焦點到清單標題', code: FOCUS_HELPER + String.raw`
await waitFor(() => $('[data-test=cancel]'))
const row = $$('[data-test=appt]')[0]
row.querySelector('[data-test=cancel]').focus()
click(row.querySelector('[data-test=cancel]'))
await tick()
click('[data-test=confirm]')
await waitFor(() => !$$('[data-test=appt]')[0].querySelector('[data-test=cancel]'))
await tick()
assertEqual(api.calls.filter((c) => c.method === 'POST').map((c) => c.url), ['/api/appointments/41/cancel'], 'POST 請求')
assertEqual(api.calls.filter((c) => c.method === 'GET').length, 1, 'GET 次數（取消後不要整份重抓）')
assert($$('[data-test=appt]')[0].textContent.includes('已取消'), '那一列要顯示已取消：' + $$('[data-test=appt]')[0].textContent.trim())
assertEqual(focusedEl() && focusedEl().id, 'list-title', '焦點所在的元素')` },
      { name: '取消失敗：顯示 detail，那一列不變', api: 'api.post(\'/api/appointments/:id/cancel\', { status: 409, body: api.problem(409, \'已過可取消的時間（看診前 2 小時）\', { code: \'cancel-deadline-passed\' }), delay: 50 })', code: String.raw`
await waitFor(() => $('[data-test=cancel]'))
click('[data-test=cancel]')
await tick()
click('[data-test=confirm]')
await waitFor(() => $('[role=alert]'))
assertEqual(text('[role=alert]'), '已過可取消的時間（看診前 2 小時）', 'role="alert" 的文字')
assert($$('[data-test=appt]')[0].querySelector('[data-test=cancel]'), '取消失敗時那一列要維持原狀')
assert(!$('dialog').open, '視窗要關閉')` },
    ],
    hints: [
      '`const dialog = useTemplateRef(\'dialog\')`，開啟用 `dialog.value.showModal()`，關閉用 `dialog.value.close()`；`showModal()` 會記下開啟前有焦點的元素，`close()` 時還給它。',
      '`showModal()` 之後呼叫「保留掛號」的 `focus()`；焦點在視窗裡，`close()` 時瀏覽器才會把焦點還給開啟前的元素。',
      '更新那一列：`items.value[i] = 回應的掛號`；觸發按鈕跟著消失，`await nextTick()` 後把焦點移到 `#list-title`。',
    ],
  },
  {
    id: 'project-fe-appointments-3', project: 'fe-appointments', skill: 'cancel-race', kind: 'vue', level: 3,
    title: '換篩選時取消舊請求，丟掉舊條件的一批',
    prompt: `「我的掛號」多了狀態篩選 \`<select data-test="status">\`（\`all\`、\`booked\`、\`cancelled\`），請求是 \`GET /api/appointments?limit=5&status=…\`（\`all\` 不帶 \`status\`）。「已取消」的查詢比較慢。快速切換時，慢的舊回應晚到，蓋掉了新條件的清單；「載入更多」還沒回來就換條件，舊條件的一批會接到新清單後面。改成：

- 換篩選：用 \`AbortController\` 取消上一組條件還沒回來的請求；清空已載入的資料與 cursor，從第一批開始
- 被取消的請求不算錯誤，不顯示 \`role="alert"\`
- 「載入更多」等回應的期間換了篩選：那一批屬於舊條件，不接到清單上

每筆一個 \`<li data-test="appt">\`，內容含「第 N 號」與狀態（已掛號、已取消）；「載入更多」是 \`data-test="more"\`。`,
    api: String.raw`const ITEMS = Array.from({ length: 14 }, (_, i) => ({ id: i + 1, session_id: 2, patient_id: 1, number: i + 1, status: i % 2 ? 'cancelled' : 'booked' }))
window.SLOW = { cancelled: 400 }
window.MORE_DELAY = 80
api.get('/api/appointments', (req) => {
  const cursor = Number(req.query.cursor || 0)
  const limit = Number(req.query.limit || 50)
  const rest = ITEMS.filter((a) => a.id > cursor && (!req.query.status || a.status === req.query.status))
  const items = rest.slice(0, limit)
  return { body: { items, next_cursor: rest.length > limit ? items[items.length - 1].id : null }, delay: cursor ? MORE_DELAY : SLOW[req.query.status] || 80 }
})`,
    starter: `import { createApp, ref, watch } from 'vue'

const LIMIT = 5
const STATUS_TEXT = { booked: '已掛號', cancelled: '已取消', checked_in: '已報到' }

const MyAppointments = {
  setup() {
    const status = ref('all')          // 篩選：all | booked | cancelled
    const items = ref([])
    const nextCursor = ref(null)
    const error = ref('')

    async function fetchBatch(cursor) {
      const params = new URLSearchParams({ limit: String(LIMIT) })
      if (status.value !== 'all') params.set('status', status.value)
      if (cursor) params.set('cursor', cursor)
      const res = await fetch('/api/appointments?' + params)
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.json()
    }

    async function load() {
      error.value = ''
      try {
        const page = await fetchBatch(null)
        items.value = page.items
        nextCursor.value = page.next_cursor
      } catch {
        error.value = '讀取失敗'
      }
    }

    async function loadMore() {
      try {
        const page = await fetchBatch(nextCursor.value)
        items.value.push(...page.items)
        nextCursor.value = page.next_cursor
      } catch {
        error.value = '載入失敗'
      }
    }

    watch(status, load, { immediate: true })
    return { status, items, nextCursor, error, loadMore, STATUS_TEXT }
  },
  template: \`
    <h2>我的掛號</h2>
    <select data-test="status" v-model="status" aria-label="狀態">
      <option value="all">全部</option>
      <option value="booked">已掛號</option>
      <option value="cancelled">已取消</option>
    </select>
    <p v-if="error" role="alert">{{ error }}</p>
    <ul>
      <li v-for="a in items" :key="a.id" data-test="appt">第 {{ a.number }} 號　{{ STATUS_TEXT[a.status] }}</li>
    </ul>
    <button v-if="nextCursor" type="button" data-test="more" @click="loadMore">載入更多</button>\`,
}

createApp(MyAppointments).mount('#app')
`,
    solution: `import { createApp, ref, watch, onWatcherCleanup } from 'vue'

const LIMIT = 5
const STATUS_TEXT = { booked: '已掛號', cancelled: '已取消', checked_in: '已報到' }

const MyAppointments = {
  setup() {
    const status = ref('all')          // 篩選：all | booked | cancelled
    const items = ref([])
    const nextCursor = ref(null)
    const error = ref('')
    let controller = null              // 目前這一組條件的請求共用一個 controller

    async function fetchBatch(cursor, signal) {
      const params = new URLSearchParams({ limit: String(LIMIT) })
      if (status.value !== 'all') params.set('status', status.value)
      if (cursor) params.set('cursor', cursor)
      const res = await fetch('/api/appointments?' + params, { signal })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.json()
    }

    watch(status, async () => {
      const c = new AbortController()
      controller = c
      onWatcherCleanup(() => c.abort())   // 條件又變了（或元件卸載）：這一輪的請求都取消；要在第一個 await 之前登記
      items.value = []                    // 換條件：清空、從第一批開始
      nextCursor.value = null
      error.value = ''
      try {
        const page = await fetchBatch(null, c.signal)
        items.value = page.items
        nextCursor.value = page.next_cursor
      } catch {
        if (!c.signal.aborted) error.value = '讀取失敗'   // 被取消不算錯誤
      }
    }, { immediate: true })

    async function loadMore() {
      const c = controller                // 記下這一批屬於哪一組條件
      try {
        const page = await fetchBatch(nextCursor.value, c.signal)
        if (c !== controller) return      // 等待期間換了條件：舊條件的一批，丟掉
        items.value.push(...page.items)
        nextCursor.value = page.next_cursor
      } catch {
        if (!c.signal.aborted) error.value = '載入失敗'
      }
    }

    return { status, items, nextCursor, error, loadMore, STATUS_TEXT }
  },
  template: \`
    <h2>我的掛號</h2>
    <select data-test="status" v-model="status" aria-label="狀態">
      <option value="all">全部</option>
      <option value="booked">已掛號</option>
      <option value="cancelled">已取消</option>
    </select>
    <p v-if="error" role="alert">{{ error }}</p>
    <ul>
      <li v-for="a in items" :key="a.id" data-test="appt">第 {{ a.number }} 號　{{ STATUS_TEXT[a.status] }}</li>
    </ul>
    <button v-if="nextCursor" type="button" data-test="more" @click="loadMore">載入更多</button>\`,
}

createApp(MyAppointments).mount('#app')
`,
    tests: [
      { name: '快速換條件：畫面是最後一次條件的結果', code: String.raw`
await waitFor(() => $$('[data-test=appt]').length === 5)
select('[data-test=status]', 'cancelled')
await wait(30)
select('[data-test=status]', 'booked')
await wait(600)
const t = $$('[data-test=appt]').map((li) => li.textContent)
assert(t.length > 0 && t.every((x) => x.includes('已掛號')), '篩選是「已掛號」，清單卻有其他狀態：' + t.map((x) => x.trim()).join('、'))` },
      { name: '舊條件的請求被取消，不顯示錯誤', code: String.raw`
await waitFor(() => $$('[data-test=appt]').length === 5)
select('[data-test=status]', 'cancelled')
await wait(30)
select('[data-test=status]', 'booked')
await wait(600)
const old = api.calls.find((c) => c.url.includes('status=cancelled'))
assert(old && old.aborted, '「已取消」那個還沒回來的請求要被取消（api.calls：' + api.calls.map((c) => c.url + (c.aborted ? '（已取消）' : '')).join('、') + '）')
assert(!$('[role=alert]'), '被取消不算錯誤：' + text('[role=alert]'))` },
      { name: '換條件從第一批開始', code: String.raw`
await waitFor(() => $('[data-test=more]') && $$('[data-test=appt]').length === 5)
click('[data-test=more]')
await waitFor(() => $$('[data-test=appt]').length === 10)
select('[data-test=status]', 'booked')
await waitFor(() => api.calls.length === 3)
assertEqual(api.calls[2].url, '/api/appointments?limit=5&status=booked', '換條件後的請求')
await waitFor(() => $$('[data-test=appt]').length === 5)` },
      { name: '「載入更多」還沒回來就換條件：那一批不接上去', api: 'window.MORE_DELAY = 400', code: String.raw`
await waitFor(() => $('[data-test=more]') && $$('[data-test=appt]').length === 5)
click('[data-test=more]')
await wait(50)
select('[data-test=status]', 'booked')
await wait(700)
const t = $$('[data-test=appt]').map((li) => li.textContent)
assert(t.length === 5 && t.every((x) => x.includes('已掛號')), '換成「已掛號」後應該只有它的第一批 5 筆：' + t.map((x) => x.trim()).join('、'))` },
    ],
    hints: [
      '`watch(status, async () => { … })` 裡先 `new AbortController()`，接著 `onWatcherCleanup(() => controller.abort())`，要在第一個 `await` 之前登記。',
      '`catch` 裡用 `signal.aborted` 判斷是不是被取消的，被取消就直接 return。',
      '「載入更多」開始時記下目前這組條件的 controller，回來時比對：已經換了就丟掉這一批。',
    ],
  },

  // ───────────── 5. fe-board ─────────────
  {
    id: 'project-fe-board-1', project: 'fe-board', skill: 'realtime-frontend', kind: 'vue', level: 2,
    title: '輪詢不重疊，背景時暫停',
    prompt: `候診區的報到看板輪詢 \`GET /api/board\`（回傳 \`[{ room, doctor, current_no, waiting }]\`），每個診間一個 \`<li data-test="room">\`。\`POLL_MS\` 題目設 200 ms（實際是 10 秒）。起始碼用 \`setInterval\`：回應比間隔慢時請求會疊在一起，切到別的分頁也照樣一直打。按 \`data-test="toggle"\` 會切到別頁、卸載看板。改成：

- 掛載時抓一次；每次回應回來之後才排下一次（\`setTimeout\` 串起來），同一時間只有一個請求在路上
- 卸載時停止，還在路上的請求用 \`AbortController\` 取消
- 頁面隱藏時（\`visibilitychange\` 事件，\`document.visibilityState\` 是 \`'hidden'\`）停止輪詢；回到前景時立刻抓一次，再恢復輪詢`,
    api: String.raw`window.ROOMS = [{ room: '101', doctor: '林醫師', current_no: 12, waiting: 3 }, { room: '102', doctor: '張醫師', current_no: 5, waiting: 8 }]
api.get('/api/board', { body: ROOMS, delay: 40 })
window.setVisibility = (state) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' })
  document.dispatchEvent(new Event('visibilitychange'))
}`,
    starter: `import { createApp, ref, onMounted, onUnmounted } from 'vue'

const POLL_MS = 200   // 題目縮短成 0.2 秒，實際是 10 秒

const CheckinBoard = {
  setup() {
    const rooms = ref([])
    let timer = null

    async function load() {
      try {
        const res = await fetch('/api/board')
        if (res.ok) rooms.value = await res.json()
      } catch {
        // 下一輪再試
      }
    }

    onMounted(() => {
      load()
      timer = setInterval(load, POLL_MS)
    })
    onUnmounted(() => clearInterval(timer))
    return { rooms }
  },
  template: \`
    <ul>
      <li v-for="r in rooms" :key="r.room" data-test="room">{{ r.room }} 診　{{ r.doctor }}　目前 {{ r.current_no }} 號</li>
    </ul>\`,
}

const App = {
  components: { CheckinBoard },
  setup() {
    const page = ref('board')
    return { page }
  },
  template: \`
    <button type="button" data-test="toggle" @click="page = page === 'board' ? 'other' : 'board'">切換頁面</button>
    <CheckinBoard v-if="page === 'board'" />
    <p v-else>掛號頁</p>\`,
}

createApp(App).mount('#app')
`,
    solution: `import { createApp, ref, onMounted, onUnmounted } from 'vue'

const POLL_MS = 200   // 題目縮短成 0.2 秒，實際是 10 秒

const CheckinBoard = {
  setup() {
    const rooms = ref([])
    let timer = null
    let controller = null
    let stopped = false

    async function tick() {
      clearTimeout(timer)
      controller?.abort()                       // 回到前景立刻抓時，可能還有一個在路上
      const c = (controller = new AbortController())
      try {
        const res = await fetch('/api/board', { signal: c.signal })
        if (res.ok) rooms.value = await res.json()
      } catch {
        if (c.signal.aborted) return            // 卸載、切到背景或被新的一輪取代：不排下一輪
      }
      if (c.signal.aborted) return
      // 回來之後才排下一次：同一時間只有一個請求在路上
      if (!stopped && document.visibilityState === 'visible') timer = setTimeout(tick, POLL_MS)
    }

    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        clearTimeout(timer)                     // 背景：停
        controller?.abort()
      } else {
        tick()                                  // 回到前景：馬上抓一次，接著恢復輪詢
      }
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
  template: \`
    <ul>
      <li v-for="r in rooms" :key="r.room" data-test="room">{{ r.room }} 診　{{ r.doctor }}　目前 {{ r.current_no }} 號</li>
    </ul>\`,
}

const App = {
  components: { CheckinBoard },
  setup() {
    const page = ref('board')
    return { page }
  },
  template: \`
    <button type="button" data-test="toggle" @click="page = page === 'board' ? 'other' : 'board'">切換頁面</button>
    <CheckinBoard v-if="page === 'board'" />
    <p v-else>掛號頁</p>\`,
}

createApp(App).mount('#app')
`,
    tests: [
      { name: '掛載後抓一次，之後持續輪詢', code: String.raw`
await waitFor(() => $$('[data-test=room]').length === 2)
await wait(700)
assert(api.calls.length >= 3, '0.7 秒內只送了 ' + api.calls.length + ' 次請求')` },
      { name: '回應比間隔慢時，請求不會疊在一起', api: String.raw`window.flight = { now: 0, max: 0 }
api.get('/api/board', async () => {
  flight.now++
  flight.max = Math.max(flight.max, flight.now)
  await new Promise((r) => setTimeout(r, 450))
  flight.now--
  return { body: ROOMS, delay: 0 }
})`, code: String.raw`
await wait(1400)
assert(api.calls.length >= 2, '1.4 秒內只送了 ' + api.calls.length + ' 次請求：回應回來之後要接著排下一次')
assertEqual(flight.max, 1, '同一時間在路上的請求數最多是')` },
      { name: '頁面隱藏時停止，回到前景立刻抓一次', code: String.raw`
await waitFor(() => $$('[data-test=room]').length === 2)
setVisibility('hidden')
await wait(50)
const n = api.calls.length
await wait(600)
assertEqual(api.calls.length, n, '隱藏期間送出的請求數加上原本的')
setVisibility('visible')
await waitFor(() => api.calls.length === n + 1, { timeout: 150 })
await wait(600)
assert(api.calls.length >= n + 3, '回到前景後要恢復輪詢（0.6 秒內只多了 ' + (api.calls.length - n) + ' 次）')` },
      { name: '卸載後停止，還在路上的請求被取消', api: 'api.get(\'/api/board\', { body: ROOMS, delay: 300 })', code: String.raw`
await waitFor(() => api.calls.length === 1)
click('[data-test=toggle]')
await wait(700)
assertEqual(api.calls.length, 1, '卸載後又送出的請求數加上原本的')
assert(api.calls[0].aborted, '卸載時還在路上的請求要取消')` },
    ],
    hints: [
      '`async function tick() { await 請求; timer = setTimeout(tick, POLL_MS) }`：下一次在這一次回來之後才排。',
      '`document.addEventListener(\'visibilitychange\', …)`：`hidden` 時 `clearTimeout` 並取消請求，`visible` 時直接呼叫 `tick()`。',
      '每次請求建一個 `AbortController`；被取消的那一次不要再排下一輪。',
    ],
  },
  {
    id: 'project-fe-board-2', project: 'fe-board', skill: 'api-errors-retry', kind: 'vue', level: 2,
    title: '失敗時保留舊資料、拉長間隔',
    prompt: `看板已經改成 \`setTimeout\` 串起來的輪詢（\`POLL_MS\` 題目設 100 ms）。後端重啟時，起始碼每 100 ms 打一次、把清單清空。改成：

- 網路錯誤或 5xx：清單留在畫面上，\`role="status"\` 的元素顯示含「更新失敗」的訊息（例如「更新失敗，顯示的是 10:15:30 的資料」）
- 連續失敗時拉長間隔：第 n 次連續失敗後等 \`POLL_MS × 2^n\`，最多 \`MAX_MS\`（題目設 1600 ms），可以乘上 0.5–1 的抖動
- 成功一次：回到 \`POLL_MS\`，\`role="status"\` 的內容清空
- 4xx（例如 403）：重送結果一樣，停止輪詢，\`role="alert"\` 顯示原因

\`role="status"\` 的元素從一開始就在 DOM 裡，之後只改文字。每個診間一個 \`<li data-test="room">\`。`,
    api: String.raw`window.ROOMS = [{ room: '101', doctor: '林醫師', current_no: 12, waiting: 3 }, { room: '102', doctor: '張醫師', current_no: 5, waiting: 8 }]
window.times = []
window.script = ['ok', 'fail', 'fail', 'fail', 'ok', 'ok']
api.get('/api/board', () => {
  const i = times.length
  times.push(performance.now())
  const s = script[Math.min(i, script.length - 1)]
  if (s === 'ok') return { body: ROOMS, delay: 20 }
  if (s === '403') return { status: 403, body: api.problem(403, '這個帳號不能查看看板'), delay: 20 }
  return { status: 503, body: api.problem(503, '伺服器重啟中'), delay: 20 }
})`,
    starter: `import { createApp, ref, onMounted, onUnmounted } from 'vue'

const POLL_MS = 100    // 題目縮短：正常的間隔
const MAX_MS = 1600    // 題目縮短：失敗時最長等多久

const CheckinBoard = {
  setup() {
    const rooms = ref([])
    const error = ref('')
    let timer = null
    let stopped = false

    async function tick() {
      try {
        const res = await fetch('/api/board')
        if (!res.ok) throw new Error('HTTP ' + res.status)
        rooms.value = await res.json()
        error.value = ''
      } catch {
        rooms.value = []
        error.value = '看板暫時無法更新'
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS)
    }

    onMounted(tick)
    onUnmounted(() => { stopped = true; clearTimeout(timer) })
    return { rooms, error }
  },
  template: \`
    <p v-if="error" role="alert">{{ error }}</p>
    <ul>
      <li v-for="r in rooms" :key="r.room" data-test="room">{{ r.room }} 診　目前 {{ r.current_no }} 號</li>
    </ul>\`,
}

createApp(CheckinBoard).mount('#app')
`,
    solution: `import { createApp, ref, onMounted, onUnmounted } from 'vue'

const POLL_MS = 100    // 題目縮短：正常的間隔
const MAX_MS = 1600    // 題目縮短：失敗時最長等多久

// 第 n 次連續失敗後的等待：指數成長、有上限、乘上 0.5–1 的抖動（多台看板不會同時重試）
const backoff = (failures) => Math.min(MAX_MS, POLL_MS * 2 ** failures) * (0.5 + Math.random() / 2)

const CheckinBoard = {
  setup() {
    const rooms = ref([])
    const lastUpdated = ref(null)
    const stale = ref('')       // role="status"：更新失敗、畫面上是舊資料
    const fatal = ref('')       // role="alert"：4xx，不再重試
    let timer = null
    let stopped = false
    let failures = 0

    async function tick() {
      let wait = POLL_MS
      try {
        const res = await fetch('/api/board')
        if (res.status >= 400 && res.status < 500) {
          fatal.value = res.status === 401 || res.status === 403 ? '沒有權限查看看板，請重新登入' : '看板設定有誤（' + res.status + '）'
          return                                 // 4xx：重送結果一樣，停止輪詢
        }
        if (!res.ok) throw new Error('HTTP ' + res.status)
        rooms.value = await res.json()
        lastUpdated.value = new Date()
        failures = 0                             // 成功一次就回到原本的間隔
        stale.value = ''
      } catch {
        failures++                               // 網路錯誤、5xx：舊資料留著，間隔拉長
        wait = backoff(failures)
        const at = lastUpdated.value ? lastUpdated.value.toLocaleTimeString('zh-TW', { hour12: false }) : null
        stale.value = at ? '更新失敗，顯示的是 ' + at + ' 的資料' : '更新失敗，稍後自動重試'
      }
      if (!stopped) timer = setTimeout(tick, wait)
    }

    onMounted(tick)
    onUnmounted(() => { stopped = true; clearTimeout(timer) })
    return { rooms, stale, fatal }
  },
  template: \`
    <p v-if="fatal" role="alert">{{ fatal }}</p>
    <p role="status">{{ stale }}</p>
    <ul>
      <li v-for="r in rooms" :key="r.room" data-test="room">{{ r.room }} 診　目前 {{ r.current_no }} 號</li>
    </ul>\`,
}

createApp(CheckinBoard).mount('#app')
`,
    tests: [
      { name: '失敗時保留舊資料並提示', code: String.raw`
await waitFor(() => $$('[data-test=room]').length === 2)
await waitFor(() => (text('[role=status]') || '').includes('更新失敗'), { timeout: 1000 })
assertEqual($$('[data-test=room]').length, 2, '更新失敗時清單要留著')` },
      { name: '連續失敗時間隔拉長', code: String.raw`
await waitFor(() => times.length >= 5, { timeout: 3000 })
const g1 = times[2] - times[1], g3 = times[4] - times[3]
assert(g3 >= 350, '連續失敗 3 次後只等了 ' + Math.round(g3) + ' ms')
assert(g3 >= 2 * g1, '第 3 次失敗後的等待（' + Math.round(g3) + ' ms）要至少是第 1 次失敗後（' + Math.round(g1) + ' ms）的兩倍')` },
      { name: '成功後回到原本的間隔、清掉提示', code: String.raw`
await waitFor(() => times.length >= 6, { timeout: 3000 })
const g5 = times[5] - times[4]
assert(g5 < 250, '成功後應該回到 POLL_MS，現在等了 ' + Math.round(g5) + ' ms')
await waitFor(() => text('[role=status]') === '', { timeout: 500 })` },
      { name: '一開始就有 role="status"', code: String.raw`
await tick()
assert($('[role=status]'), '一開始就要有 role="status" 的元素')` },
      { name: '403：停止輪詢並顯示原因', api: 'window.script = [\'403\']', code: String.raw`
await waitFor(() => $('[role=alert]'))
await wait(500)
assertEqual(times.length, 1, '403 之後又送出的請求數加上原本的')` },
    ],
    hints: [
      '記一個 `failures` 計數：失敗時加一，等待改成 `Math.min(MAX_MS, POLL_MS * 2 ** failures)`；成功時歸零。',
      '`catch` 裡不要動 `rooms`，只改提示的文字。',
      '4xx 在 `res.status` 判斷，直接 return，不排下一次。',
    ],
  },

  // ───────────── 6. fe-a11y-rwd ─────────────
  {
    id: 'project-fe-a11y-1', project: 'fe-a11y-rwd', skill: 'a11y-basics', kind: 'vue', level: 2,
    title: '鍵盤走得完、換頁移焦點、結果念得出來',
    prompt: `診次清單與掛號頁（題目用 \`page\` 代替兩個路由）只用滑鼠測過。改成鍵盤與螢幕閱讀器也能用：

- 能點的東西都用 \`<button type="button">\`：每個診次的「掛號」\`data-test="book"\` 現在是 \`div\` 加 \`@click\`，Tab 停不到
- 只有圖示的「重新整理」\`data-test="refresh"\` 要有名稱：\`aria-label="重新整理"\`，SVG 加 \`aria-hidden="true"\`
- 額滿的診次不能只靠 class 的顏色：文字要寫「額滿」，「掛號」按鈕 \`disabled\`
- 結果訊息（「共 N 個診次」「已更新，共 N 個診次」）放在一個從一開始就在 DOM 裡的 \`role="status"\` 元素，之後只改文字
- 換頁之後：\`document.title\` 改成「掛號｜門診系統」或「診次清單｜門診系統」，焦點移到新頁面的 \`<h1>\`（加 \`tabindex="-1"\`）`,
    api: String.raw`window.SESSIONS = [
  { id: 1, doctor_id: 1, session_date: '2026-11-26', period: 'morning', capacity: 2, remaining: 2 },
  { id: 2, doctor_id: 1, session_date: '2026-11-26', period: 'afternoon', capacity: 30, remaining: 0 },
  { id: 3, doctor_id: 2, session_date: '2026-11-26', period: 'morning', capacity: 30, remaining: 12 },
]
api.get('/api/sessions', { body: SESSIONS, delay: 80 })`,
    starter: `import { createApp, ref, onMounted } from 'vue'

const PERIODS = { morning: '上午', afternoon: '下午' }

const App = {
  setup() {
    const page = ref('list')          // list | booking（代替 Vue Router 的兩個路由）
    const sessions = ref([])
    const picked = ref(null)
    const message = ref('')

    async function load(refresh = false) {
      const res = await fetch('/api/sessions')
      sessions.value = await res.json()
      message.value = (refresh ? '已更新，' : '') + '共 ' + sessions.value.length + ' 個診次'
    }
    function book(s) { picked.value = s; page.value = 'booking' }
    function back() { page.value = 'list' }

    onMounted(() => load())
    return { page, sessions, picked, message, load, book, back, PERIODS }
  },
  template: \`
    <main v-if="page === 'list'">
      <h1>診次清單</h1>
      <button type="button" data-test="refresh" @click="load(true)">
        <svg viewBox="0 0 16 16" width="16" height="16"><path d="M13 3v4H9" fill="none" stroke="currentColor"/></svg>
      </button>
      <p v-if="message" role="status">{{ message }}</p>
      <ul>
        <li v-for="s in sessions" :key="s.id" data-test="session" :class="{ full: s.remaining === 0 }">
          {{ s.session_date }} {{ PERIODS[s.period] }}
          <span v-if="s.remaining > 0">剩 {{ s.remaining }} 名</span>
          <div class="btn" data-test="book" @click="book(s)">掛號</div>
        </li>
      </ul>
    </main>
    <main v-else>
      <h1>掛號：{{ picked.session_date }} {{ PERIODS[picked.period] }}</h1>
      <button type="button" data-test="back" @click="back">返回診次清單</button>
    </main>\`,
}

createApp(App).mount('#app')
`,
    solution: `import { createApp, ref, onMounted, nextTick } from 'vue'

const PERIODS = { morning: '上午', afternoon: '下午' }
const TITLES = { list: '診次清單｜門診系統', booking: '掛號｜門診系統' }

const App = {
  setup() {
    const page = ref('list')          // list | booking（代替 Vue Router 的兩個路由）
    const sessions = ref([])
    const picked = ref(null)
    const message = ref('')           // 寫進一直存在的 role="status"，螢幕閱讀器才會念

    async function load(refresh = false) {
      const res = await fetch('/api/sessions')
      sessions.value = await res.json()
      message.value = (refresh ? '已更新，' : '') + '共 ' + sessions.value.length + ' 個診次'
    }

    // 換頁之後：更新標題，焦點移到新頁面的 h1（相當於 router.afterEach）
    async function go(name) {
      page.value = name
      document.title = TITLES[name]
      await nextTick()
      document.querySelector('main h1').focus()
    }
    function book(s) { picked.value = s; go('booking') }

    onMounted(() => {
      document.title = TITLES.list
      load()
    })
    return { page, sessions, picked, message, load, book, go, PERIODS }
  },
  template: \`
    <main v-if="page === 'list'">
      <h1 tabindex="-1">診次清單</h1>
      <button type="button" data-test="refresh" aria-label="重新整理" @click="load(true)">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M13 3v4H9" fill="none" stroke="currentColor"/></svg>
      </button>
      <ul>
        <li v-for="s in sessions" :key="s.id" data-test="session" :class="{ full: s.remaining === 0 }">
          {{ s.session_date }} {{ PERIODS[s.period] }}
          <span>{{ s.remaining > 0 ? '剩 ' + s.remaining + ' 名' : '額滿' }}</span>
          <button type="button" data-test="book" :disabled="s.remaining === 0" @click="book(s)">掛號</button>
        </li>
      </ul>
    </main>
    <main v-else>
      <h1 tabindex="-1">掛號：{{ picked.session_date }} {{ PERIODS[picked.period] }}</h1>
      <button type="button" data-test="back" @click="go('list')">返回診次清單</button>
    </main>
    <p role="status" class="sr-status">{{ message }}</p>\`,
}

createApp(App).mount('#app')
`,
    tests: [
      { name: '「掛號」是 button', code: String.raw`
await waitFor(() => $$('[data-test=book]').length === 3)
const tags = $$('[data-test=book]').map((b) => b.tagName.toLowerCase() + (b.type ? '[type=' + b.type + ']' : ''))
assertEqual(tags, ['button[type=button]', 'button[type=button]', 'button[type=button]'], '每個「掛號」的元素')` },
      { name: '圖示按鈕有名稱，圖示不被念出', code: String.raw`
await waitFor(() => $('[data-test=refresh]'))
const b = $('[data-test=refresh]')
const name = (b.getAttribute('aria-label') || b.textContent).trim()
assertEqual(name, '重新整理', '「重新整理」按鈕的名稱')
assertEqual(b.querySelector('svg') && b.querySelector('svg').getAttribute('aria-hidden'), 'true', 'SVG 的 aria-hidden')` },
      { name: '額滿：寫出文字、停用按鈕', code: String.raw`
await waitFor(() => $$('[data-test=session]').length === 3)
const full = $$('[data-test=session]')[1]
assert(full.textContent.includes('額滿'), '額滿的診次要有「額滿」兩個字：' + full.textContent.trim())
assert(full.querySelector('[data-test=book]').disabled, '額滿的「掛號」要 disabled')` },
      { name: 'role="status" 一開始就在，載入與重新整理後更新文字', code: String.raw`
await tick()
const live = $('[role=status]')
assert(live, '一開始就要有 role="status" 的元素')
await waitFor(() => text('[role=status]') === '共 3 個診次')
click('[data-test=refresh]')
await waitFor(() => text('[role=status]') === '已更新，共 3 個診次')
assert($('[role=status]') === live, 'role="status" 的元素要一直是同一個，只改文字')` },
      { name: '換頁：更新標題，焦點移到 h1', code: FOCUS_HELPER + String.raw`
await waitFor(() => $$('[data-test=book]').length === 3)
$$('[data-test=book]')[0].focus()
click($$('[data-test=book]')[0])
await waitFor(() => focusedEl() && focusedEl().tagName === 'H1', { timeout: 500 })
assert(focusedEl().textContent.includes('掛號'), '焦點要在掛號頁的 h1：' + focusedEl().textContent)
assertEqual(document.title, '掛號｜門診系統', '掛號頁的 document.title')
click('[data-test=back]')
await waitFor(() => focusedEl() && focusedEl().tagName === 'H1' && focusedEl().textContent.includes('診次清單'), { timeout: 500 })
assertEqual(document.title, '診次清單｜門診系統', '回到清單的 document.title')` },
    ],
    hints: [
      '`div` 改成 `<button type="button">`，Enter、Space 與 Tab 順序都由瀏覽器處理。',
      '`role="status"` 的元素放在兩個頁面外面，不加 `v-if`。',
      '換頁後 `await nextTick()`，再 `document.querySelector(\'main h1\').focus()`；h1 要有 `tabindex="-1"` 才能被 `focus()`。',
    ],
  },
  {
    id: 'project-fe-rwd-1', project: 'fe-a11y-rwd', skill: 'rwd', kind: 'css', level: 2,
    title: '診次頁在 390 與 1280 的版面',
    prompt: `診次頁的 CSS 只為桌機寫過：固定的兩欄、寫死寬度的三欄卡片，在 390px 會撐出橫向捲軸；按鈕很小，還把焦點外框全部拿掉。改寫 CSS（HTML 不能改），mobile-first，斷點用 \`@media (min-width: 1024px)\`：

- 390px：一欄。篩選 \`.filters\` 在卡片 \`.sessions\` 上面，裡面的輸入框與選單占滿寬度；卡片一張一行；「掛號」\`.book\` 占滿卡片寬度、至少 44px 高（專案的規格；WCAG 2.2 的 2.5.8 要求至少 24×24 CSS px）；頁面不能左右捲動
- 1024px 以上：\`.page\` 是兩欄的 grid，左邊 \`.filters\` 固定 280px、右邊 \`.sessions\`；頁首 \`.top\` 跨兩欄
- 卡片用 \`repeat(auto-fill, minmax(260px, 1fr))\` 排：1280px 時一列三張、寬度相同
- 用鍵盤移到「掛號」時看得到焦點：\`:focus-visible\` 有至少 2px 的外框`,
    html: `<div class="page">
  <header class="top">
    <h1>門診掛號</h1>
    <button type="button" class="account">王小明</button>
  </header>
  <aside class="filters" aria-label="篩選">
    <form>
      <label>日期 <input type="date" value="2026-11-26"></label>
      <label>科別
        <select><option>全部科別</option><option>家醫科</option><option>小兒科</option></select>
      </label>
      <label>醫師 <input type="search" placeholder="醫師姓名"></label>
    </form>
  </aside>
  <main class="sessions">
    <article class="session"><h2>11/26 上午　家醫科</h2><p>林醫師　剩 2 名</p><button type="button" class="book">掛號</button></article>
    <article class="session"><h2>11/26 下午　家醫科</h2><p>林醫師　剩 15 名</p><button type="button" class="book">掛號</button></article>
    <article class="session"><h2>11/26 上午　小兒科</h2><p>張醫師　剩 12 名</p><button type="button" class="book">掛號</button></article>
    <article class="session"><h2>11/26 夜間　小兒科</h2><p>張醫師　剩 4 名</p><button type="button" class="book">掛號</button></article>
    <article class="session"><h2>11/27 上午　家醫科</h2><p>林醫師　剩 30 名</p><button type="button" class="book">掛號</button></article>
    <article class="session"><h2>11/27 下午　皮膚科</h2><p>陳醫師　剩 8 名</p><button type="button" class="book">掛號</button></article>
  </main>
</div>`,
    css: `body { margin: 0; font: 16px/1.5 system-ui, sans-serif; }
.page { padding: 16px; }
.top { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #222; padding-bottom: 8px; }
.top h1 { margin: 0; font-size: 1.25rem; }
.filters form { display: grid; gap: 12px; }
.session { border: 2px solid #222; border-radius: 8px; padding: 12px; }
.session h2 { margin: 0 0 4px; font-size: 1rem; }
.session p { margin: 0 0 8px; }
.book { font: inherit; background: #1d4ed8; color: #fff; border: 0; border-radius: 6px; }
input, select { font: inherit; padding: 6px 8px; }`,
    starter: `.page {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 24px;
}

.top {
  grid-column: 1 / -1;
}

.sessions {
  display: grid;
  grid-template-columns: repeat(3, 300px);
  gap: 16px;
}

.book {
  padding: 2px 8px;
}

*:focus {
  outline: none;
}
`,
    solution: `/* 手機（預設）：一欄，篩選在清單上面 */
.page {
  display: grid;
  gap: 16px;
}

.filters label {
  display: block;
}

.filters input,
.filters select {
  box-sizing: border-box;
  width: 100%;                      /* 欄位占滿寬度 */
}

.sessions {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));   /* 放得下幾張就排幾欄 */
  gap: 16px;
}

.book {
  box-sizing: border-box;
  width: 100%;
  min-height: 44px;                 /* 專案規格：按鈕至少 44px 高 */
}

/* 鍵盤操作時看得到焦點 */
.book:focus-visible,
.filters :focus-visible {
  outline: 3px solid #1d4ed8;
  outline-offset: 2px;
}

/* 1024px 以上：左邊固定寬度的篩選，右邊卡片 */
@media (min-width: 1024px) {
  .page {
    grid-template-columns: 280px 1fr;
    align-items: start;
  }
  .top {
    grid-column: 1 / -1;            /* 頁首跨兩欄 */
  }
}
`,
    tests: [
      { name: '390px：一欄，篩選在卡片上面', viewport: 390, code: String.raw`
const f = box('.filters'), s = box('.sessions')
assert(f.bottom <= s.top + 1, '篩選要在卡片上面（篩選的底在 ' + Math.round(f.bottom) + 'px，卡片從 ' + Math.round(s.top) + 'px 開始）')
const c = $$('.session').map(box)
assert(c.every((b, i) => Math.round(b.left) === Math.round(c[0].left) && (!i || b.top > c[i - 1].top)), '390px 時卡片要一張一行')` },
      { name: '390px：欄位與「掛號」占滿寬度，按鈕至少 44px 高', viewport: 390, code: String.raw`
const form = $('.filters form')
const inner = form.clientWidth
for (const el of $$('.filters input, .filters select')) assert(Math.abs(box(el).width - inner) <= 1, '篩選的欄位要占滿寬度：' + Math.round(box(el).width) + 'px，應該是 ' + inner + 'px')
const card = $('.session'), btn = box('.book')
const cardInner = card.clientWidth - parseFloat(css('.session', 'padding-left')) - parseFloat(css('.session', 'padding-right'))
assert(Math.abs(btn.width - cardInner) <= 1, '「掛號」寬 ' + Math.round(btn.width) + 'px，應該占滿卡片的 ' + cardInner + 'px')
assert(btn.height >= 44, '「掛號」只有 ' + Math.round(btn.height) + 'px 高')` },
      { name: '390px：頁面不能左右捲動', viewport: 390, code: String.raw`assert(document.documentElement.scrollWidth <= innerWidth, '頁面寬 ' + document.documentElement.scrollWidth + 'px，畫面只有 ' + innerWidth + 'px')` },
      { name: '1280px：左邊 280px 的篩選，頁首跨兩欄', viewport: 1280, code: String.raw`
const f = box('.filters'), s = box('.sessions'), top = box('.top')
assertEqual(Math.round(f.width), 280, '篩選的寬度')
assert(f.right <= s.left && Math.abs(f.top - s.top) <= 1, '篩選與卡片要左右並排')
assert(Math.abs(top.left - f.left) <= 1 && Math.abs(top.right - s.right) <= 1, '頁首要跨兩欄（頁首 ' + Math.round(top.left) + '–' + Math.round(top.right) + 'px）')` },
      { name: '1280px：卡片一列三張、寬度相同', viewport: 1280, code: String.raw`
const c = $$('.session').map(box)
const tops = c.map((b) => Math.round(b.top))
assert(tops[0] === tops[1] && tops[1] === tops[2] && tops[3] > tops[2], '1280px 時應該一列三張（top：' + tops.join(', ') + '）')
assert(c.slice(0, 3).every((b) => Math.abs(b.width - c[0].width) < 1), '同一列的卡片寬度不同：' + c.slice(0, 3).map((b) => Math.round(b.width)).join(', '))
assert(c[0].width >= 260, '卡片寬 ' + Math.round(c[0].width) + 'px，比 260px 窄')` },
      { name: '鍵盤焦點看得到', viewport: 1280, code: String.raw`
focus('.book')
assert($('.book').matches(':focus-visible'), '「掛號」沒有拿到焦點')
assert(css('.book', 'outline-style') !== 'none' && parseFloat(css('.book', 'outline-width')) >= 2, '「掛號」的 :focus-visible 要有至少 2px 的外框（現在 outline 是 ' + css('.book', 'outline-style') + ' ' + css('.book', 'outline-width') + '）')` },
    ],
    hints: [
      '先寫沒有 media query 的手機版：`.page` 只要 `display: grid` 與 `gap`，一欄就是預設；`@media (min-width: 1024px)` 再加 `grid-template-columns: 280px 1fr`。',
      '`repeat(auto-fill, minmax(260px, 1fr))` 依寬度決定欄數：390px 時放不下兩張就是一欄。',
      '輸入框與按鈕的 `width: 100%` 搭配 `box-sizing: border-box`，padding 才不會撐出去。',
      '不要 `outline: none`；`:focus-visible` 給一個看得到的外框。',
    ],
  },

  // ───────────── 7. fe-deploy ─────────────
  {
    id: 'project-fe-deploy-1', project: 'fe-deploy', skill: 'spa-deploy', kind: 'config', level: 2, file: 'default.conf',
    title: '部署在 /clinic/ 底下的 nginx 設定',
    prompt: `前端的 \`vite.config.js\` 設了 \`base: '/clinic/'\`，Vue Router 用 \`createWebHistory(import.meta.env.BASE_URL)\`；\`dist/\` 的內容放在 \`/usr/share/nginx/html/clinic/\`（\`index.html\`、\`config.js\`、\`favicon.svg\`、\`assets/\` 底下帶 hash 的 JS 與 CSS）。起始的設定是部署在根目錄時寫的。改寫成：

- \`/clinic/\` 底下的頁面路徑（\`/clinic/\`、重新整理 \`/clinic/appointments/42\`）回 \`/clinic/index.html\`，\`Cache-Control: no-cache\`
- \`/clinic/assets/\` 底下：存在的檔案 \`Cache-Control: public, max-age=31536000, immutable\`；不存在的回 **404**，不能換成 \`index.html\`
- \`/clinic/config.js\`（執行時設定）：\`no-cache\`
- \`/api/\` 照樣轉給 \`http://clinic-api:8000\`，nginx 不替它加 \`Cache-Control\`

檢查器用一份假的 dist 實際走一遍 location 的選擇、\`try_files\` 與內部轉址、\`add_header\` 的繼承規則。`,
    starter: `server {
    listen 8080;
    server_name _;
    root /usr/share/nginx/html;

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache" always;
    }

    location /api/ {
        proxy_pass http://clinic-api:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
`,
    solution: `server {
    listen 8080;
    server_name _;
    root /usr/share/nginx/html;     # dist/ 的內容放在 /usr/share/nginx/html/clinic/

    # 檔名帶 hash：存一年；找不到就 404，不要換成 index.html
    location /clinic/assets/ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    # 頁面路徑找不到檔案時回 /clinic/index.html；index.html 與 config.js 每次都要向伺服器確認
    location /clinic/ {
        try_files $uri $uri/ /clinic/index.html;
        add_header Cache-Control "no-cache" always;
    }

    location /api/ {
        proxy_pass http://clinic-api:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
`,
    tests: [
      { name: '頁面路徑回 /clinic/index.html，no-cache', code: NGINX_CLINIC + String.raw`
for (const uri of ['/clinic/', '/clinic/index.html', '/clinic/appointments/42']) {
  const r = handle(uri)
  assert(r.kind === 'file' && r.file === '/clinic/index.html', uri + ' 應該送出 /clinic/index.html：' + describe(r))
  const cc = cacheOf(r)
  assert(cc.includes('no-cache') && !cc.includes('no-store'), uri + ' 的 Cache-Control 要是 no-cache：' + describe(r))
}` },
      { name: '/clinic/assets/ 底下：長效快取加 immutable', code: NGINX_CLINIC + String.raw`
for (const uri of ['/clinic/assets/index-CmXrpQpe.js', '/clinic/assets/vendor-C8Rcc4dC.js', '/clinic/assets/index-D1rQx9aB.css']) {
  const r = handle(uri)
  assert(r.kind === 'file' && r.file === uri, uri + ' 應該送出檔案本身：' + describe(r))
  const cc = cacheOf(r)
  assert(cc.includes('max-age=31536000') && cc.includes('immutable') && !cc.includes('no-cache'), uri + ' 的 Cache-Control 要是 public, max-age=31536000, immutable：' + describe(r))
}` },
      { name: '/clinic/assets/ 底下找不到的檔案回 404', code: NGINX_CLINIC + String.raw`
const r = handle('/clinic/assets/ReportsView-BiVi8Bpn.js')
assert(r.kind === 'status' && r.status === 404, '部署前的舊 chunk 要回 404，不能換成 index.html（瀏覽器會拿到 text/html 當 JS，Console 出現 MIME type 的錯誤）：' + describe(r))` },
      { name: '/clinic/config.js：no-cache', code: NGINX_CLINIC + String.raw`
const r = handle('/clinic/config.js')
assert(r.kind === 'file' && r.file === '/clinic/config.js', '/clinic/config.js 應該送出檔案本身：' + describe(r))
assert(cacheOf(r).includes('no-cache'), '/clinic/config.js 要 no-cache，改了設定才不會被舊的快取擋住：' + describe(r))` },
      { name: '/api/ 轉給 clinic-api:8000，nginx 不加 Cache-Control', code: NGINX_CLINIC + String.raw`
const r = handle('/api/sessions')
assert(r.kind === 'proxy', '/api/sessions 應該轉給後端：' + describe(r))
assertEqual(r.target, 'http://clinic-api:8000', 'proxy_pass')
assert(!r.headers['cache-control'], '/api/ 的回應不要由 nginx 加 Cache-Control（現在會加上 ' + r.headers['cache-control'] + '）')` },
    ],
    hints: [
      '`location /clinic/assets/ { try_files $uri =404; … }` 放在 `location /clinic/` 之外：nginx 選最長的前綴，資產的請求會落到這裡。',
      '`location /clinic/` 的 `try_files` 最後一項是 `/clinic/index.html`；寫成 `/index.html` 會內部轉址到根目錄，那裡沒有這個檔案。',
      '`config.js` 在 `/clinic/` 底下，跟著 `location /clinic/` 的 `no-cache` 就好。',
    ],
  },
  {
    id: 'project-fe-deploy-2', project: 'fe-deploy', skill: 'env-config', kind: 'vue', level: 2,
    title: '同一份建置，設定在執行時讀',
    prompt: `測試與正式環境要用同一份建置。起始碼把 API 網址、環境名稱、除錯開關寫成建置時的常數（等同 \`import.meta.env.VITE_*\` 在建置時被換成字串），而且 \`SHOW_DEBUG\` 是字串 \`'false'\`，除錯面板一直開著。改成執行時讀設定：\`index.html\` 會在應用程式之前載入 \`/config.js\`，它設定 \`window.__CLINIC_CONFIG__\`（測試會先放好不同的內容）。

- 只在一個 \`readConfig()\` 讀 \`window.__CLINIC_CONFIG__\`；缺的欄位用 \`DEFAULTS\`（\`apiBase: '/api'\`、\`envName: '正式'\`、\`showDebug: false\`），每缺一個欄位 \`console.warn\` 一行含欄位名稱；整個物件不存在時也要能啟動
- 請求用 \`apiBase\` 開頭：\`GET <apiBase>/sessions\`
- \`envName\` 不是「正式」時，上方 \`data-test="env"\` 顯示「<envName>環境」
- \`showDebug\` 只有 \`true\` 或字串 \`'true'\` 才算開啟；開啟時才顯示 \`data-test="debug"\``,
    api: String.raw`window.SESSIONS = [
  { id: 1, doctor_id: 1, session_date: '2026-11-26', period: 'morning', capacity: 2, remaining: 2 },
  { id: 2, doctor_id: 1, session_date: '2026-11-26', period: 'afternoon', capacity: 30, remaining: 0 },
  { id: 3, doctor_id: 2, session_date: '2026-11-26', period: 'morning', capacity: 30, remaining: 12 },
]
api.get('/api/sessions', { body: SESSIONS, delay: 30 })
api.get('/api/v2/sessions', { body: SESSIONS.slice(0, 1), delay: 30 })`,
    starter: `import { createApp, ref, onMounted } from 'vue'

// 建置時的值：用 VITE_ 變數寫死在 bundle 裡，換環境要重新建置
const API_BASE = 'https://api-test.example/api'
const ENV_NAME = '測試'
const SHOW_DEBUG = 'false'

const App = {
  setup() {
    const sessions = ref([])
    onMounted(async () => {
      const res = await fetch(API_BASE + '/sessions')
      if (res.ok) sessions.value = await res.json()
    })
    return { sessions, ENV_NAME, SHOW_DEBUG }
  },
  template: \`
    <p v-if="ENV_NAME !== '正式'" data-test="env">{{ ENV_NAME }}環境</p>
    <h1>診次</h1>
    <ul><li v-for="s in sessions" :key="s.id" data-test="session">{{ s.session_date }}</li></ul>
    <aside v-if="SHOW_DEBUG" data-test="debug">除錯資訊：{{ sessions.length }} 筆</aside>\`,
}

createApp(App).mount('#app')
`,
    solution: `import { createApp, ref, onMounted } from 'vue'

// 執行時設定：index.html 在應用程式之前載入 /config.js，它設定 window.__CLINIC_CONFIG__。
// 同一份建置放到每個環境，只換 config.js
const DEFAULTS = { apiBase: '/api', envName: '正式', showDebug: false }

function readConfig(raw) {
  const cfg = { ...DEFAULTS }
  if (!raw || typeof raw !== 'object') {
    console.warn('[config] 找不到 __CLINIC_CONFIG__，全部使用預設值')
    return cfg
  }
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in raw)) { console.warn('[config] 缺少 ' + key + '，使用預設值 ' + JSON.stringify(DEFAULTS[key])); continue }
    const v = raw[key]
    if (typeof DEFAULTS[key] === 'boolean') cfg[key] = v === true || v === 'true'   // 字串 'false' 不能當成開啟
    else cfg[key] = String(v)
  }
  return cfg
}

// 程式裡只從這裡拿設定，其他地方不直接讀 window.__CLINIC_CONFIG__
const config = Object.freeze(readConfig(window.__CLINIC_CONFIG__))

const App = {
  setup() {
    const sessions = ref([])
    onMounted(async () => {
      const res = await fetch(config.apiBase + '/sessions')
      if (res.ok) sessions.value = await res.json()
    })
    return { sessions, config }
  },
  template: \`
    <p v-if="config.envName !== '正式'" data-test="env">{{ config.envName }}環境</p>
    <h1>診次</h1>
    <ul><li v-for="s in sessions" :key="s.id" data-test="session">{{ s.session_date }}</li></ul>
    <aside v-if="config.showDebug" data-test="debug">除錯資訊：{{ sessions.length }} 筆</aside>\`,
}

createApp(App).mount('#app')
`,
    tests: [
      { name: '請求用 config.js 的 apiBase', api: 'window.__CLINIC_CONFIG__ = { apiBase: \'/api/v2\', envName: \'測試\', showDebug: false }', code: String.raw`
await waitFor(() => api.calls.length >= 1)
assertEqual(api.calls[0].url, '/api/v2/sessions', '請求的網址')
await waitFor(() => $$('[data-test=session]').length === 1)` },
      { name: '測試環境顯示環境名稱', api: 'window.__CLINIC_CONFIG__ = { apiBase: \'/api\', envName: \'測試\', showDebug: false }', code: String.raw`
await waitFor(() => $('[data-test=env]'))
assertEqual(text('[data-test=env]'), '測試環境')` },
      { name: '正式環境不顯示環境名稱', api: 'window.__CLINIC_CONFIG__ = { apiBase: \'/api\', envName: \'正式\', showDebug: false }', code: String.raw`
await waitFor(() => $$('[data-test=session]').length === 3)
assert(!$('[data-test=env]'), '正式環境不顯示環境名稱')` },
      { name: '字串 \'false\' 不會打開除錯面板', api: 'window.__CLINIC_CONFIG__ = { apiBase: \'/api\', envName: \'正式\', showDebug: \'false\' }', code: String.raw`
await waitFor(() => $$('[data-test=session]').length === 3)
assert(!$('[data-test=debug]'), "showDebug 是字串 'false' 時不能顯示除錯面板")` },
      { name: 'true 或 \'true\' 才打開除錯面板', api: 'window.__CLINIC_CONFIG__ = { apiBase: \'/api\', envName: \'測試\', showDebug: \'true\' }', code: String.raw`await waitFor(() => $('[data-test=debug]'))` },
      { name: '缺欄位：用預設值並警告', api: 'window.__CLINIC_CONFIG__ = { envName: \'測試\' }', code: String.raw`
await waitFor(() => api.calls.length >= 1)
assertEqual(api.calls[0].url, '/api/sessions', '缺 apiBase 時用預設的 /api')
await tick()
const warns = logs.filter((l) => l.level === 'warn').map((l) => l.text).join('\n')
assert(warns.includes('apiBase') && warns.includes('showDebug'), '缺的欄位要在 Console 警告（現在的警告：' + (warns || '沒有') + '）')
assert(!$('[data-test=debug]'), '缺 showDebug 時預設不顯示除錯面板')` },
      { name: '沒有載入 config.js 也能啟動', code: String.raw`
await waitFor(() => $$('[data-test=session]').length === 3)
assertEqual(api.calls[0].url, '/api/sessions', '請求的網址')
assert(!$('[data-test=env]') && !$('[data-test=debug]'), '沒有設定時是正式環境、不顯示除錯面板')
assert(logs.some((l) => l.level === 'warn'), '找不到設定時要在 Console 警告')` },
    ],
    hints: [
      '`readConfig(raw)`：先複製一份 `DEFAULTS`，再逐一檢查 `raw` 有沒有這個欄位；布林值用 `v === true || v === \'true\'`。',
      '設定只讀一次：`const config = readConfig(window.__CLINIC_CONFIG__)`，元件從 `config` 拿值。',
    ],
  },
]

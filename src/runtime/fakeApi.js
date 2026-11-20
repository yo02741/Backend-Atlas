/* 沙箱 iframe 裡的假後端：把 window.fetch 換成這裡的路由器，回真的 Response。
   createFakeApi 必須自給自足（不引用模組裡的其他東西）：frame.js 用 Function.prototype.toString 把它塞進 iframe 的 prelude，
   Node 的 scripts/test-sandbox.mjs 則直接 import 來測。

   內建一套門診系統的路由，照 companion/clinic-api/docs/contract.md（和參考專案同一份契約，路徑一樣在 /api 底下）：
     POST /api/auth/login                  { username, password } → { access_token, token_type, expires_in }
     GET  /api/sessions?date=&doctor_id=   兩個都選填 → [{ id, doctor_id, session_date, period, capacity, remaining }]
     POST /api/sessions/:id/appointments   { patient_id?, note? }，選填標頭 Idempotency-Key → 201 { id, session_id, patient_id, number, status, created_at }
     GET  /api/appointments?status=&patient_id=&cursor=&limit=  → { items, next_cursor }
     GET  /api/appointments/:id
     POST /api/appointments/:id/cancel、POST /api/appointments/:id/check-in
     GET  /api/board                       不需要登入 → [{ room, doctor, current_no, waiting }]（今天目前時段的診次；內建資料沒有今天的診次，所以是 []）
   錯誤 body 是 Problem Details（type、title、status、detail；422 的欄位錯誤放 errors: { 欄位: ['訊息'] }，errors 是本站的約定，不是標準欄位）。
   和參考專案不同的地方（密碼固定、token 不過期、沒有限流）列在契約的最後一節。env.clock 可以換掉牆上時間（測試用）。

   題目與測試用 api.get / post / put / patch / delete(path, handler) 蓋過或新增路由（後定義的優先，內建路由最後才比對）：
     handler 是回應物件 { status = 200, body, headers, delay, network }、回應物件的陣列（依序回應，最後一個重複）、
     或 (req) => 回應物件（可以是 async）；req = { method, url, path, query, params, headers, body }。
   api.latency：預設延遲（ms）；api.errorRate：0–1，隨機回 503（Playground 的滑桿用）；api.auth = true 時內建路由要 Bearer token；
   api.scenario：固定情境（Playground 的情境按鈕用，設了就不套用 errorRate，每次重建 iframe 都重播同一組回應）：
     'success' 照常回應；'fail' 每個「方法 + 路徑」第 1 次回 503，之後照常（重試會成功）；
     'empty' 成功的 GET 把陣列 body 換成 []、{ items } 換成空的 items；
     'shuffle' 較早的請求較晚回（第 1、2 個請求另加 600、300 ms），陣列 body 倒序；
   api.calls：[{ method, url, body, status, ms, aborted, network }]；api.db：內建路由的資料；api.problem(status, detail, extra)。 */
export function createFakeApi(env = {}) {
  const G = env.global || globalThis
  const ResponseC = env.Response || G.Response
  const HeadersC = env.Headers || G.Headers
  const DOMExceptionC = env.DOMException || G.DOMException
  const setT = env.setTimeout || ((fn, ms) => G.setTimeout(fn, ms))
  const clearT = env.clearTimeout || ((id) => G.clearTimeout(id))
  const now = env.now || (() => (G.performance ? G.performance.now() : Date.now()))
  const random = env.random || Math.random
  const warn = env.warn || (() => {})
  const onCall = env.onCall || (() => {})
  const baseURI = env.baseURI || 'http://localhost/'

  const PROBLEM_BASE = 'https://clinic.example/problems/'
  const TITLES = { 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 422: 'Unprocessable Content', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' }
  const STATUS_TEXT = { 200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified', ...TITLES }

  const problem = (status, detail, extra = {}) => {
    const { code, title, ...rest } = extra
    const body = { type: code ? PROBLEM_BASE + code : 'about:blank', title: title || TITLES[status] || 'Error', status }
    if (detail) body.detail = detail
    return Object.assign(body, rest)
  }
  const fail = (status, detail, extra) => ({ status, body: problem(status, detail, extra) })

  const clock = env.clock || (() => Date.now())   // 牆上時間（epoch ms）：取消期限、看板的「今天」與時段
  // 日期與時段一律用台北時間（UTC+8，沒有夏令時間），和參考專案一樣，不看瀏覽器的時區
  const taipei = (offsetDays = 0) => new Date(clock() + 8 * 3600000 + offsetDays * 86400000)
  const isoDate = (offsetDays) => taipei(offsetDays).toISOString().slice(0, 10)
  function seed() {
    const day = env.today || isoDate(7)   // 一週後：還在取消期限內
    return {
      users: [
        { username: 'patient1', password: 'demo-password', role: 'patient', patient_id: 1 },
        { username: 'patient2', password: 'demo-password', role: 'patient', patient_id: 2 },
        { username: 'desk1', password: 'demo-password', role: 'desk' },
        { username: 'doctor1', password: 'demo-password', role: 'doctor', doctor_id: 1 },
      ],
      patients: [{ id: 1, name: '王小明' }, { id: 2, name: '陳小華' }, { id: 3, name: '李大同' }],
      doctors: [{ id: 1, name: '林醫師', dept: '家醫科', room: '101' }, { id: 2, name: '張醫師', dept: '小兒科', room: '102' }],
      sessions: [
        { id: 1, doctor_id: 1, session_date: day, period: 'morning', capacity: 2 },
        { id: 2, doctor_id: 1, session_date: day, period: 'afternoon', capacity: 30 },
        { id: 3, doctor_id: 2, session_date: day, period: 'morning', capacity: 30 },
      ],
      appointments: [],
      idempotency: {},   // 使用者 + Idempotency-Key → 第一次成功的回應
      tokens: {},
      seq: 0,
    }
  }

  const api = { latency: 150, errorRate: 0, auth: false, scenario: null, calls: [], db: seed(), problem }
  const routes = []
  const scenarioSeen = {}   // 'fail' 情境：每個「方法 + 路徑」第幾次
  let scenarioN = 0          // 'shuffle' 情境：第幾個請求

  function compile(path) {
    const keys = []
    const parts = String(path).replace(/\/+$/, '').split('/').map((seg) => {
      const m = /^:(\w+)$/.exec(seg) || /^\{(\w+)\}$/.exec(seg)
      if (m) { keys.push(m[1]); return '([^/]+)' }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    return { keys, re: new RegExp('^' + parts.join('/') + '/?$') }
  }
  function route(method, path, handler) {
    const m = String(method).toUpperCase()
    const i = routes.findIndex((r) => r.method === m && r.path === path)
    if (i >= 0) routes.splice(i, 1)
    routes.push({ method: m, path, handler, n: 0, ...compile(path) })
    return api
  }
  api.route = route
  for (const m of ['get', 'post', 'put', 'patch', 'delete']) api[m] = (path, handler) => route(m, path, handler)
  api.reset = () => {
    routes.length = 0; api.calls.length = 0; api.db = seed(); api.latency = 150; api.errorRate = 0; api.auth = false; api.scenario = null
    for (const k of Object.keys(scenarioSeen)) delete scenarioSeen[k]
    scenarioN = 0
  }

  // 固定情境：改寫已經決定好的回應（網路錯誤不動）。回傳 [回應, 額外延遲]
  function applyScenario(res, req, n) {
    const ok = !res.network && (res.status ?? 200) < 400
    const key = req.method + ' ' + req.path
    if (api.scenario === 'fail') {
      scenarioSeen[key] = (scenarioSeen[key] || 0) + 1
      if (scenarioSeen[key] === 1 && !res.network) return [fail(503, '伺服器暫時無法處理（固定情境：第 1 次失敗，重試會成功）'), 0]
      return [res, 0]
    }
    if (api.scenario === 'empty' && ok && req.method === 'GET') {
      const b = res.body
      if (Array.isArray(b)) return [{ ...res, body: [] }, 0]
      if (b && typeof b === 'object' && Array.isArray(b.items)) return [{ ...res, body: { ...b, items: [], next_cursor: null } }, 0]
      return [res, 0]
    }
    if (api.scenario === 'shuffle') {
      const extra = n === 0 ? 600 : n === 1 ? 300 : 0
      return [ok && Array.isArray(res.body) ? { ...res, body: [...res.body].reverse() } : res, extra]
    }
    return [res, 0]
  }

  // ── 內建的門診系統（companion/clinic-api/docs/contract.md）──
  const ACTIVE = ['booked', 'checked_in']
  const DAILY_LIMIT = 3
  const STATUSES = ['booked', 'cancelled', 'checked_in']
  const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,255}$/
  const invalid = (errors) => fail(422, '欄位格式錯誤', { code: 'validation-error', errors })
  const conflict = (code, title, detail) => fail(409, detail, { code, title })
  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  const posInt = (v) => /^[1-9]\d*$/.test(String(v))
  // 鍵排序後的 JSON：同樣的內容、不同的欄位順序算同一個指紋
  const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
    : isObject(v) ? `{${Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',')}}` : JSON.stringify(v ?? null)
  function currentUser(req) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')
    const u = m && api.db.tokens[m[1]]
    if (u) return u
    return api.auth ? null : api.db.users[0]
  }
  function sessionOut(s) {
    const used = api.db.appointments.filter((a) => a.session_id === s.id && ACTIVE.includes(a.status)).length
    const { id, doctor_id, session_date, period, capacity } = s
    return { id, doctor_id, session_date, period, capacity, remaining: Math.max(0, capacity - used) }
  }
  const sessionOf = (a) => api.db.sessions.find((s) => s.id === a.session_id)
  // 病患：自己的；醫師：自己診次的；櫃台：全部
  function visible(user, a) {
    if (user.role === 'desk') return true
    if (user.role === 'patient') return a.patient_id === user.patient_id
    if (user.role === 'doctor') return sessionOf(a)?.doctor_id === user.doctor_id
    return false
  }
  const PERIOD_START = { morning: '08:30', afternoon: '13:30', evening: '18:00' }
  function currentPeriod() {
    const hm = taipei().toISOString().slice(11, 16)
    return hm >= PERIOD_START.evening ? 'evening' : hm >= PERIOD_START.afternoon ? 'afternoon' : 'morning'
  }
  // 取消期限：看診前一日 17:00（台北時間）
  function cancelDeadlinePassed(s) {
    const prev = new Date(Date.parse(`${s.session_date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
    return clock() >= Date.parse(`${prev}T17:00:00+08:00`)
  }
  function board() {
    const today = isoDate(0), period = currentPeriod()
    return api.db.sessions.filter((s) => s.session_date === today && s.period === period).map((s) => {
      const d = api.db.doctors.find((x) => x.id === s.doctor_id) || {}
      const mine = api.db.appointments.filter((a) => a.session_id === s.id)
      return {
        room: d.room ?? String(s.doctor_id),
        doctor: d.name ?? '',
        current_no: Math.max(0, ...mine.filter((a) => a.status === 'checked_in').map((a) => a.number)),
        waiting: mine.filter((a) => a.status === 'booked').length,
      }
    }).sort((a, b) => (a.room < b.room ? -1 : a.room > b.room ? 1 : 0))
  }
  function book(req, user, sessionId) {
    const b = req.body
    if (!isObject(b)) return fail(400, 'body 必須是 JSON 物件')
    const errors = {}
    if (b.patient_id != null && !(Number.isInteger(b.patient_id) && b.patient_id > 0)) errors.patient_id = ['必須是正整數']
    if (b.note != null && (typeof b.note !== 'string' || b.note.length > 200)) errors.note = ['備註最多 200 字']
    const key = req.headers['idempotency-key']
    if (key !== undefined && !IDEMPOTENCY_KEY.test(key)) errors['Idempotency-Key'] = ['必須是 1–255 個可見的 ASCII 字元']
    if (Object.keys(errors).length) return invalid(errors)
    if (user.role === 'desk' && b.patient_id == null) return invalid({ patient_id: ['櫃台掛號必須指定 patient_id'] })
    const pid = b.patient_id ?? user.patient_id
    if (!(user.role === 'desk' || (user.role === 'patient' && pid === user.patient_id))) return fail(403, '這個角色不能替這位病患掛號')

    const slot = key === undefined ? null : `${user.username}\n${key}`   // 鍵屬於使用者
    const fingerprint = req.path + ' ' + canonical(b)
    const stored = slot && api.db.idempotency[slot]
    if (stored) {
      if (stored.fingerprint !== fingerprint) return fail(422, '這個 Idempotency-Key 已經用在內容不同的請求', { code: 'idempotency-key-reused', title: 'Idempotency key reused' })
      return { ...stored.res, headers: { ...stored.res.headers, 'Idempotent-Replayed': 'true' }, body: { ...stored.res.body } }
    }
    const s = api.db.sessions.find((x) => x.id === sessionId)
    if (!s) return fail(404, `診次 ${sessionId} 不存在`)
    if (!api.db.patients.some((p) => p.id === pid)) return fail(404, `病患 ${pid} 不存在`)
    // 順序是規格：重複 → 名額 → 每日上限
    if (api.db.appointments.some((a) => a.session_id === s.id && a.patient_id === pid && ACTIVE.includes(a.status))) return conflict('already-booked', 'Already booked', '這個門診已經掛過號了')
    if (sessionOut(s).remaining <= 0) return conflict('session-full', 'Session full', '這個門診已經額滿')
    const sameDay = api.db.appointments.filter((a) => a.patient_id === pid && ACTIVE.includes(a.status) && sessionOf(a)?.session_date === s.session_date)
    if (sameDay.length >= DAILY_LIMIT) return conflict('daily-limit', 'Daily limit exceeded', `這一天已經掛了 ${DAILY_LIMIT} 診`)
    const number = api.db.appointments.filter((a) => a.session_id === s.id).length + 1   // 含已取消：號碼不回收
    const a = { id: api.db.appointments.length + 1, session_id: s.id, patient_id: pid, number, status: 'booked', created_at: new Date(clock()).toISOString() }
    api.db.appointments.push(a)
    const res = { status: 201, headers: { Location: `/api/appointments/${a.id}` }, body: { ...a } }
    if (slot) api.db.idempotency[slot] = { fingerprint, res }   // 只記住成功的結果
    return { ...res, body: { ...a } }
  }
  function listAppointments(req, user) {
    const q = req.query
    const errors = {}
    if (q.status !== undefined && !STATUSES.includes(q.status)) errors.status = [`必須是 ${STATUSES.join('、')} 其中之一`]
    if (q.patient_id !== undefined && !posInt(q.patient_id)) errors.patient_id = ['必須是正整數']
    if (q.cursor !== undefined && !/^\d+$/.test(q.cursor)) errors.cursor = ['必須是 0 以上的整數']
    if (q.limit !== undefined && !(posInt(q.limit) && Number(q.limit) <= 100)) errors.limit = ['必須是 1 到 100 的整數']
    if (Object.keys(errors).length) return invalid(errors)
    const pid = q.patient_id ? Number(q.patient_id) : null
    const cursor = Number(q.cursor || 0)
    const limit = Number(q.limit || 50)
    const all = api.db.appointments.filter((a) => visible(user, a) && (!pid || a.patient_id === pid) && (!q.status || a.status === q.status) && a.id > cursor)
    const items = all.slice(0, limit).map((a) => ({ ...a }))
    return { body: { items, next_cursor: all.length > limit ? items[items.length - 1].id : null } }
  }
  function clinic(req) {
    const { method, path } = req
    if (path === '/api/auth/login' && method === 'POST') {
      const b = isObject(req.body) ? req.body : {}
      const errors = {}
      if (!b.username) errors.username = ['必填']
      if (!b.password) errors.password = ['必填']
      if (Object.keys(errors).length) return invalid(errors)
      const u = api.db.users.find((x) => x.username === b.username && x.password === b.password)
      if (!u) return fail(401, '帳號或密碼錯誤')
      const token = `fake-${u.username}-${++api.db.seq}`
      api.db.tokens[token] = u
      return { body: { access_token: token, token_type: 'Bearer', expires_in: 3600 } }
    }
    if (path === '/api/board') return method === 'GET' ? { body: board() } : fail(405)   // 不需要登入
    const known = /^\/api\/(auth\/login|sessions|appointments)(\/|$)/.test(path)
    if (!known) return null
    if (path === '/api/auth/login') return fail(405)
    const user = currentUser(req)
    if (!user) return { status: 401, headers: { 'WWW-Authenticate': 'Bearer' }, body: problem(401, '請先登入') }
    let m
    if (path === '/api/sessions') {
      if (method !== 'GET') return fail(405)
      const { doctor_id: doc, date } = req.query
      const errors = {}
      if (doc !== undefined && !posInt(doc)) errors.doctor_id = ['必須是正整數']
      if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.date = ['格式是 YYYY-MM-DD']
      if (Object.keys(errors).length) return invalid(errors)
      const rows = api.db.sessions.filter((s) => (!doc || s.doctor_id === Number(doc)) && (!date || s.session_date === date))
      rows.sort((a, b) => (a.session_date < b.session_date ? -1 : a.session_date > b.session_date ? 1 : a.id - b.id))
      return { body: rows.map(sessionOut) }
    }
    if ((m = /^\/api\/sessions\/(\d+)\/appointments$/.exec(path))) return method === 'POST' ? book(req, user, Number(m[1])) : fail(405)
    if (path === '/api/appointments') return method === 'GET' ? listAppointments(req, user) : fail(405)
    if ((m = /^\/api\/appointments\/([^/]+)(?:\/(cancel|check-in))?$/.exec(path))) {
      const a = /^\d+$/.test(m[1]) && api.db.appointments.find((x) => x.id === Number(m[1]))
      if (!a || !visible(user, a)) return fail(404, '掛號不存在')   // 不存在與看不到回應一樣
      const action = m[2]
      if (!action) return method === 'GET' ? { body: { ...a } } : fail(405)
      if (method !== 'POST') return fail(405)
      if (action === 'cancel') {
        if (user.role === 'doctor') return fail(403, '這個角色不能取消掛號')
        if (cancelDeadlinePassed(sessionOf(a))) return conflict('cancel-deadline-passed', 'Cancel deadline passed', '已過取消期限（看診前一日 17:00）')
        if (a.status !== 'booked') return conflict('invalid-status', 'Invalid status', '只有 booked 狀態的掛號可以取消')
        a.status = 'cancelled'
      } else {
        if (user.role !== 'desk') return fail(403, '只有櫃台可以報到')
        if (a.status !== 'booked') return conflict('invalid-status', 'Invalid status', '只有 booked 狀態的掛號可以報到')
        a.status = 'checked_in'
      }
      return { body: { ...a } }
    }
    return fail(404)
  }

  function headersObject(init) {
    const out = {}
    try { new HeadersC(init || {}).forEach((v, k) => { out[k] = v }) } catch { /* 不合法的標頭：當成沒有 */ }
    return out
  }
  function parseBody(raw) {
    if (typeof raw !== 'string') return raw === undefined ? null : raw   // FormData、URLSearchParams、Blob 保持原樣
    try { return JSON.parse(raw) } catch { return raw }
  }
  function toResponse(res) {
    const status = res.status ?? 200
    const headers = new HeadersC(res.headers || {})
    let body = res.body
    if (body === undefined || body === null || [204, 205, 304].includes(status)) body = null
    else if (typeof body === 'object' && !(G.Blob && body instanceof G.Blob) && !(G.FormData && body instanceof G.FormData) && !(body instanceof ArrayBuffer)) {
      body = JSON.stringify(body)
      if (!headers.has('content-type')) headers.set('content-type', status >= 400 && res.body && 'title' in res.body ? 'application/problem+json' : 'application/json')
    }
    return new ResponseC(body, { status, statusText: res.statusText ?? STATUS_TEXT[status] ?? '', headers })
  }
  async function pick(r, req) {
    let h = r.handler
    if (Array.isArray(h)) { h = h[Math.min(r.n, h.length - 1)]; r.n++ }
    if (typeof h === 'function') h = await h(req)
    return h || {}
  }
  function abortReason(signal) {
    return signal.reason !== undefined ? signal.reason : new DOMExceptionC('The operation was aborted.', 'AbortError')
  }

  api.fetch = function fetch(input, init = {}) {
    return new Promise((resolve, reject) => {
      const isReq = input && typeof input === 'object' && typeof input.clone === 'function' && 'method' in input
      const method = String(init.method || (isReq ? input.method : 'GET')).toUpperCase()
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : isReq ? input.url : String(input)
      const signal = init.signal || (isReq ? input.signal : null) || null
      const url = new URL(raw, baseURI)
      const call = { method, url: url.pathname + url.search, body: null, status: null, ms: 0, aborted: false, network: false }
      api.calls.push(call)
      const n = scenarioN++
      const t0 = now()
      let timer = null
      let settled = false
      const finish = () => { settled = true; call.ms = Math.round(now() - t0); if (signal) signal.removeEventListener('abort', onAbort); onCall(call) }
      const onAbort = () => {
        if (settled) return
        clearT(timer); call.aborted = true; finish()
        reject(abortReason(signal))
      }
      if (signal) {
        if (signal.aborted) { call.aborted = true; finish(); reject(abortReason(signal)); return }
        signal.addEventListener('abort', onAbort)
      }
      ;(async () => {
        const rawBody = init.body !== undefined ? init.body : isReq && input.body ? await input.clone().text() : undefined
        const req = { method, url: call.url, path: url.pathname.replace(/\/+$/, '') || '/', query: Object.fromEntries(url.searchParams), params: {}, headers: headersObject(init.headers || (isReq ? input.headers : null)), body: parseBody(rawBody) }
        call.body = req.body
        let res = null
        for (let i = routes.length - 1; i >= 0 && !res; i--) {
          const r = routes[i]
          if (r.method !== method) continue
          const m = r.re.exec(req.path)
          if (!m) continue
          r.keys.forEach((k, j) => { req.params[k] = decodeURIComponent(m[j + 1]) })
          res = await pick(r, req)
        }
        if (!res) res = clinic(req)
        if (!res) {
          warn(`[假 API] 沒有對應的路由：${method} ${req.path}（用 api.${method.toLowerCase()}('${req.path}', …) 加一條）`)
          res = fail(404, `沒有 ${method} ${req.path} 這個路由`)
        }
        let extraDelay = 0
        if (api.scenario) [res, extraDelay] = applyScenario(res, req, n)
        else if (api.errorRate > 0 && random() < api.errorRate) res = fail(503, '伺服器暫時無法處理（隨機錯誤）')
        if (settled) return
        timer = setT(() => {
          if (settled) return
          if (res.network) {
            call.network = true; finish()
            reject(new TypeError('Failed to fetch'))
            return
          }
          let response
          try { response = toResponse(res) } catch (err) { call.network = true; finish(); reject(err); return }
          call.status = response.status; finish()
          resolve(response)
        }, Math.max(0, Number(res.delay ?? api.latency) || 0) + extraDelay)
      })().catch((err) => { if (!settled) { finish(); reject(err) } })
    })
  }
  return api
}

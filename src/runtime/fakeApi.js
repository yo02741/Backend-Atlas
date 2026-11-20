/* 沙箱 iframe 裡的假後端：把 window.fetch 換成這裡的路由器，回真的 Response。
   createFakeApi 必須自給自足（不引用模組裡的其他東西）：frame.js 用 Function.prototype.toString 把它塞進 iframe 的 prelude，
   Node 的 scripts/test-sandbox.mjs 則直接 import 來測。

   內建一套門診系統的路由（對應 companion/clinic-api，前面加 /api）：
     POST /api/auth/login                  { username, password } → { access_token, token_type, expires_in }
     GET  /api/sessions?doctor_id=&date=   → [{ id, doctor_id, session_date, period, capacity, remaining }]
     POST /api/sessions/:id/appointments   { patient_id? } → 201 { id, session_id, patient_id, number, status, created_at }
     GET  /api/appointments?patient_id=&cursor=&limit=  → { items, next_cursor }
     GET  /api/appointments/:id
     POST /api/appointments/:id/cancel
   錯誤 body 是 Problem Details（type、title、status、detail；欄位錯誤放 errors: { 欄位: ['訊息'] }，errors 是本站的約定，不是標準欄位）。

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

  const pad = (n) => String(n).padStart(2, '0')
  function isoDate(offsetDays) {
    const d = new Date(Date.now() + offsetDays * 86400000)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
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
      doctors: [{ id: 1, name: '林醫師', dept: '家醫科' }, { id: 2, name: '張醫師', dept: '小兒科' }],
      sessions: [
        { id: 1, doctor_id: 1, session_date: day, period: 'morning', capacity: 2 },
        { id: 2, doctor_id: 1, session_date: day, period: 'afternoon', capacity: 30 },
        { id: 3, doctor_id: 2, session_date: day, period: 'morning', capacity: 30 },
      ],
      appointments: [],
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

  // ── 內建的門診系統 ──
  const ACTIVE = ['booked', 'checked_in']
  function currentUser(req) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')
    const u = m && api.db.tokens[m[1]]
    if (u) return u
    return api.auth ? null : api.db.users[0]
  }
  function sessionOut(s) {
    const used = api.db.appointments.filter((a) => a.session_id === s.id && ACTIVE.includes(a.status)).length
    return { ...s, remaining: Math.max(0, s.capacity - used) }
  }
  function visible(user, a) { return user.role !== 'patient' || a.patient_id === user.patient_id }
  function clinic(req) {
    const { method, path } = req
    if (method === 'POST' && path === '/api/auth/login') {
      const b = req.body && typeof req.body === 'object' ? req.body : {}
      const errors = {}
      if (!b.username) errors.username = ['必填']
      if (!b.password) errors.password = ['必填']
      if (Object.keys(errors).length) return fail(422, '欄位格式錯誤', { code: 'validation-error', errors })
      const u = api.db.users.find((x) => x.username === String(b.username).toLowerCase() && x.password === b.password)
      if (!u) return fail(401, '帳號或密碼錯誤')
      const token = `fake-${u.username}-${++api.db.seq}`
      api.db.tokens[token] = u
      return { body: { access_token: token, token_type: 'Bearer', expires_in: 3600 } }
    }
    const known = /^\/api\/(sessions|appointments)(\/|$)/.test(path)
    if (!known) return null
    const user = currentUser(req)
    if (!user) return { status: 401, headers: { 'WWW-Authenticate': 'Bearer' }, body: problem(401, '請先登入') }
    let m
    if (method === 'GET' && path === '/api/sessions') {
      const { doctor_id: doc, date } = req.query
      return { body: api.db.sessions.filter((s) => (!doc || s.doctor_id === Number(doc)) && (!date || s.session_date === date)).map(sessionOut) }
    }
    if (method === 'POST' && (m = /^\/api\/sessions\/(\d+)\/appointments$/.exec(path))) {
      const s = api.db.sessions.find((x) => x.id === Number(m[1]))
      if (!s) return fail(404, `門診 ${m[1]} 不存在`)
      const b = req.body && typeof req.body === 'object' ? req.body : {}
      let pid = user.patient_id
      if (user.role !== 'patient') {
        if (b.patient_id == null) return fail(422, '欄位格式錯誤', { code: 'validation-error', errors: { patient_id: ['櫃台掛號必須指定 patient_id'] } })
        if (!Number.isInteger(b.patient_id) || b.patient_id <= 0) return fail(422, '欄位格式錯誤', { code: 'validation-error', errors: { patient_id: ['必須是正整數'] } })
        pid = b.patient_id
      }
      if (api.db.appointments.some((a) => a.session_id === s.id && a.patient_id === pid && ACTIVE.includes(a.status))) return fail(409, '這個門診已經掛過號了', { code: 'already-booked', title: 'Already booked' })
      if (sessionOut(s).remaining <= 0) return fail(409, '這個門診已經額滿', { code: 'session-full', title: 'Session full' })
      const number = api.db.appointments.filter((a) => a.session_id === s.id).length + 1
      const a = { id: api.db.appointments.length + 1, session_id: s.id, patient_id: pid, number, status: 'booked', created_at: new Date().toISOString() }
      api.db.appointments.push(a)
      return { status: 201, headers: { Location: `/api/appointments/${a.id}` }, body: { ...a } }
    }
    if (method === 'GET' && path === '/api/appointments') {
      const pid = req.query.patient_id ? Number(req.query.patient_id) : null
      const cursor = Number(req.query.cursor || 0)
      const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)))
      const all = api.db.appointments.filter((a) => visible(user, a) && (!pid || a.patient_id === pid) && a.id > cursor)
      const items = all.slice(0, limit).map((a) => ({ ...a }))
      return { body: { items, next_cursor: all.length > limit ? items[items.length - 1].id : null } }
    }
    if ((m = /^\/api\/appointments\/(\d+)(\/cancel)?$/.exec(path))) {
      const a = api.db.appointments.find((x) => x.id === Number(m[1]))
      if (!a || !visible(user, a)) return fail(404, `預約 ${m[1]} 不存在`)
      if (method === 'GET' && !m[2]) return { body: { ...a } }
      if (method === 'POST' && m[2]) {
        if (a.status !== 'booked') return fail(409, `預約狀態是 ${a.status}，不能取消`, { code: 'invalid-status', title: 'Invalid status' })
        a.status = 'cancelled'
        return { body: { ...a } }
      }
    }
    return fail(405)
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

// 程式題：JavaScript 與 TypeScript（JavaScript 在瀏覽器 Worker 裡執行，和後端的 js 題同一個執行環境）
export default [
  {
    id: 'async-js-1', skill: 'async-js', kind: 'js', level: 1,
    title: '病患首頁的三個請求同時送出',
    prompt: '病患首頁進頁時要三份資料：`api.get(\'/api/me\')`、`api.get(\'/api/appointments?status=booked\')`、`api.get(\'/api/notices\')`。三份資料互不相依，現在卻一個等一個，總時間是三者相加。\n\n改寫 `loadHome(api)`：三個請求同時送出，等全部回來後回傳 `{ me, appointments, notices }`，總時間等於最慢的那一個。任何一個失敗，`loadHome` 就失敗。',
    starter: `async function loadHome(api) {
  const me = await api.get('/api/me')
  const appointments = await api.get('/api/appointments?status=booked')
  const notices = await api.get('/api/notices')
  return { me, appointments, notices }
}

// 試跑：三支 API 各要 150、250、100 ms
const wait = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms))
const api = {
  get(path) {
    if (path === '/api/me') return wait(150, { name: '王小明' })
    if (path.startsWith('/api/appointments')) return wait(250, [{ id: 1, dept: '內科' }])
    return wait(100, ['週六上午門診照常'])
  },
}
const t0 = Date.now()
const home = await loadHome(api)
console.log(Date.now() - t0, 'ms', JSON.stringify(home))
`,
    solution: `async function loadHome(api) {
  // 先把三個請求都送出（不 await），再一起等
  const [me, appointments, notices] = await Promise.all([
    api.get('/api/me'),
    api.get('/api/appointments?status=booked'),
    api.get('/api/notices'),
  ])
  return { me, appointments, notices }
}

// 試跑：三支 API 各要 150、250、100 ms
const wait = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms))
const api = {
  get(path) {
    if (path === '/api/me') return wait(150, { name: '王小明' })
    if (path.startsWith('/api/appointments')) return wait(250, [{ id: 1, dept: '內科' }])
    return wait(100, ['週六上午門診照常'])
  },
}
const t0 = Date.now()
const home = await loadHome(api)
console.log(Date.now() - t0, 'ms', JSON.stringify(home))
`,
    tests: [
      { name: '回傳三份資料', code: "const wait = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms))\nconst api = { get: (p) => wait(10, p === '/api/me' ? { name: '王小明' } : p.startsWith('/api/appointments') ? [{ id: 1 }] : ['公告']) }\nassertEqual(await loadHome(api), { me: { name: '王小明' }, appointments: [{ id: 1 }], notices: ['公告'] })" },
      { name: '三個請求同時送出：總時間約等於最慢的那一個', code: "const wait = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms))\nconst delay = { '/api/me': 150, '/api/appointments?status=booked': 250, '/api/notices': 100 }\nconst sent = []\nconst t0 = Date.now()\nconst api = { get: (p) => { sent.push(Date.now() - t0); return wait(delay[p], p) } }\nawait loadHome(api)\nconst ms = Date.now() - t0\nassert(ms < 400, '花了 ' + ms + ' ms：三個請求還是一個等一個')\nassertEqual(sent.length, 3, '請求數')\nassert(sent.every((t) => t < 50), '三個請求要一開始就送出（送出時間：' + sent.join(', ') + ' ms）')" },
      { name: '任何一個失敗，loadHome 就失敗', code: "const wait = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms))\nconst api = { get: (p) => p === '/api/notices' ? wait(20).then(() => { throw new Error('503') }) : wait(30, p) }\nlet err = null\ntry { await loadHome(api) } catch (e) { err = e }\nassertEqual(err && err.message, '503')" },
    ],
    hints: ['`await` 會停在那一行等結果；先呼叫三個 `api.get` 拿到三個 Promise，再一起等。', '`Promise.all([…])` 全部成功才成功，回傳的陣列順序和傳進去的一樣。'],
  },
  {
    id: 'async-js-2', skill: 'async-js', kind: 'js', level: 2,
    title: '部分失敗也要顯示其他區塊',
    prompt: '病患首頁的 `load(state, api)` 要同時抓三份資料，並把結果寫進 `state`：\n\n- 開始時 `state.loading = true`、`state.error = null`；不論成功或失敗，最後 `state.loading = false`\n- 本人資料（`/api/me`）缺一不可：失敗時 `state.error` 設成錯誤的 `message`，不往下顯示\n- 掛號（`/api/appointments?status=booked`）失敗：`state.appointments = null`、`state.apptError = true`，其他照常顯示；成功時 `state.apptError = false`\n- 公告（`/api/notices`）失敗：`state.notices = []`\n- `load` 本身不丟出錯誤；三個請求同時送出',
    starter: `async function load(state, api) {
  state.loading = true
  state.me = await api.get('/api/me')
  state.appointments = await api.get('/api/appointments?status=booked')
  state.notices = await api.get('/api/notices')
  state.loading = false
}

// 試跑：公告服務掛了
const wait = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms))
const api = {
  get(path) {
    if (path === '/api/me') return wait(150, { name: '王小明' })
    if (path.startsWith('/api/appointments')) return wait(250, [{ id: 1, dept: '內科' }])
    return wait(100).then(() => { throw new Error('503 Service Unavailable') })
  },
}
const state = {}
try { await load(state, api) } catch (e) { console.log('load 丟出錯誤：', e.message) }
console.log(JSON.stringify(state))
`,
    solution: `async function load(state, api) {
  state.loading = true
  state.error = null
  try {
    const [meRes, apptRes, noticeRes] = await Promise.allSettled([
      api.get('/api/me'),
      api.get('/api/appointments?status=booked'),
      api.get('/api/notices'),
    ])
    if (meRes.status === 'rejected') throw meRes.reason   // 本人資料缺一不可：整頁錯誤
    state.me = meRes.value
    state.appointments = apptRes.status === 'fulfilled' ? apptRes.value : null
    state.apptError = apptRes.status === 'rejected'        // 只有這個區塊顯示錯誤
    state.notices = noticeRes.status === 'fulfilled' ? noticeRes.value : []
  } catch (err) {
    state.error = err.message
  } finally {
    state.loading = false   // 成功、失敗都會執行
  }
}

// 試跑：公告服務掛了
const wait = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms))
const api = {
  get(path) {
    if (path === '/api/me') return wait(150, { name: '王小明' })
    if (path.startsWith('/api/appointments')) return wait(250, [{ id: 1, dept: '內科' }])
    return wait(100).then(() => { throw new Error('503 Service Unavailable') })
  },
}
const state = {}
try { await load(state, api) } catch (e) { console.log('load 丟出錯誤：', e.message) }
console.log(JSON.stringify(state))
`,
    tests: [
      { name: '全部成功', code: "const wait = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms))\nconst api = { get: (p) => wait(20, p === '/api/me' ? { name: '王小明' } : p.startsWith('/api/appointments') ? [{ id: 1 }] : ['公告']) }\nconst s = {}\nawait load(s, api)\nassertEqual([s.loading, s.error, s.me, s.appointments, s.apptError, s.notices], [false, null, { name: '王小明' }, [{ id: 1 }], false, ['公告']])" },
      { name: '公告失敗：公告是空陣列，其他照常', code: "const wait = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms))\nconst api = { get: (p) => p === '/api/notices' ? wait(10).then(() => { throw new Error('503') }) : wait(20, p === '/api/me' ? { name: '王小明' } : [{ id: 1 }]) }\nconst s = {}\nawait load(s, api)\nassertEqual([s.loading, s.error, s.me, s.appointments, s.notices], [false, null, { name: '王小明' }, [{ id: 1 }], []])" },
      { name: '掛號失敗：只有掛號區塊顯示錯誤', code: "const wait = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms))\nconst api = { get: (p) => p.startsWith('/api/appointments') ? wait(10).then(() => { throw new Error('500') }) : wait(20, p === '/api/me' ? { name: '王小明' } : ['公告']) }\nconst s = {}\nawait load(s, api)\nassertEqual([s.loading, s.error, s.appointments, s.apptError, s.notices], [false, null, null, true, ['公告']])" },
      { name: '本人資料失敗：整頁錯誤，loading 仍然結束，load 不丟錯', code: "const wait = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms))\nconst api = { get: (p) => p === '/api/me' ? wait(10).then(() => { throw new Error('401 Unauthorized') }) : wait(20, []) }\nconst s = {}\nawait load(s, api)\nassertEqual([s.loading, s.error], [false, '401 Unauthorized'])" },
      { name: '三個請求同時送出', code: "const wait = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms))\nconst t0 = Date.now()\nconst api = { get: (p) => wait(150, p === '/api/me' ? {} : []) }\nawait load({}, api)\nconst ms = Date.now() - t0\nassert(ms < 350, '花了 ' + ms + ' ms：三個請求還是一個等一個')" },
    ],
    hints: ['`Promise.allSettled` 等全部結束，每一個都回報 `{ status, value }` 或 `{ status, reason }`，不會因為一個失敗就整個失敗。', '`finally` 裡的程式成功、失敗都會執行，`loading = false` 放這裡。'],
  },
]

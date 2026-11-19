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
  {
    id: 'js-essentials-1', skill: 'js-essentials', kind: 'js', level: 1,
    title: '叫號看板：免掛號費的 0 不能變成「未定」',
    prompt: '叫號看板用 `buildBoard(appointments)` 整理今天的掛號，回傳 `{ lines, totalFee }`。接上資料後看板一片空白；修掉一個錯，下一個才會出現。改成：\n\n- `lines` 依號碼 `number` 由小到大，一筆一行，格式是「3 號 王小明（掛號費 150）」\n- 還沒建檔的病患 `patient` 不存在或是 `null`，姓名寫「姓名未填」\n- `fee` 是 `0`（免掛號費）時照樣寫 0；是 `null` 時寫「未定」\n- `totalFee` 是全部 `fee` 的合計，`null` 當成 0；空陣列回傳 `{ lines: [], totalFee: 0 }`\n- 不改傳進來的陣列：看板與掛號頁共用同一個陣列，掛號頁的順序不能跟著變',
    starter: `function buildBoard(appointments) {
  const lines = appointments
    .sort((a, b) => a.number - b.number)
    .map((a) => {
      \`\${a.number} 號 \${a.patient.name}（掛號費 \${a.fee || '未定'}）\`
    })
  const totalFee = appointments.reduce((sum, a) => sum + a.fee)
  return { lines, totalFee }
}

// 試跑
const today = [
  { id: 501, number: 12, patient: { name: '王小明' }, fee: 150 },
  { id: 502, number: 3, patient: { name: '陳美華' }, fee: 0 },     // 免掛號費
  { id: 503, number: 9, fee: 150 },                                // 還沒建檔
  { id: 504, number: 1, patient: { name: '林志明' }, fee: null },  // 掛號費未定
]
try {
  const board = buildBoard(today)
  board.lines.forEach((line) => console.log(line))
  console.log('合計', board.totalFee)
} catch (err) {
  console.log('錯誤：', err.message)
}
console.log('原陣列的號碼順序：', today.map((a) => a.number).join(','))
`,
    solution: `function buildBoard(appointments) {
  const lines = appointments
    .toSorted((a, b) => a.number - b.number)   // 回傳新陣列，不改原陣列
    .map(({ number, patient, fee }) =>          // 沒有大括號：直接回傳樣板字串
      \`\${number} 號 \${patient?.name ?? '姓名未填'}（掛號費 \${fee ?? '未定'}）\`)
  const totalFee = appointments.reduce((sum, a) => sum + (a.fee ?? 0), 0)   // 初始值 0
  return { lines, totalFee }
}

// 試跑
const today = [
  { id: 501, number: 12, patient: { name: '王小明' }, fee: 150 },
  { id: 502, number: 3, patient: { name: '陳美華' }, fee: 0 },     // 免掛號費
  { id: 503, number: 9, fee: 150 },                                // 還沒建檔
  { id: 504, number: 1, patient: { name: '林志明' }, fee: null },  // 掛號費未定
]
try {
  const board = buildBoard(today)
  board.lines.forEach((line) => console.log(line))
  console.log('合計', board.totalFee)
} catch (err) {
  console.log('錯誤：', err.message)
}
console.log('原陣列的號碼順序：', today.map((a) => a.number).join(','))
`,
    tests: [
      { name: '依號碼由小到大，一筆一行', code: "const list = [\n  { id: 1, number: 12, patient: { name: '王小明' }, fee: 150 },\n  { id: 2, number: 3, patient: { name: '陳美華' }, fee: 200 },\n  { id: 3, number: 9, patient: { name: '林志明' }, fee: 150 },\n]\nassertEqual(buildBoard(list).lines, ['3 號 陳美華（掛號費 200）', '9 號 林志明（掛號費 150）', '12 號 王小明（掛號費 150）'], 'lines')" },
      { name: '沒有 patient 或 patient 是 null：寫「姓名未填」', code: "const list = [\n  { id: 1, number: 2, fee: 150 },\n  { id: 2, number: 1, patient: null, fee: 150 },\n]\nassertEqual(buildBoard(list).lines, ['1 號 姓名未填（掛號費 150）', '2 號 姓名未填（掛號費 150）'], 'lines')" },
      { name: '掛號費 0 寫 0，null 寫「未定」', code: "const list = [\n  { id: 1, number: 1, patient: { name: '陳美華' }, fee: 0 },\n  { id: 2, number: 2, patient: { name: '林志明' }, fee: null },\n]\nassertEqual(buildBoard(list).lines, ['1 號 陳美華（掛號費 0）', '2 號 林志明（掛號費 未定）'], 'lines')" },
      { name: '合計掛號費，null 當成 0；空陣列合計 0', code: "const list = [\n  { id: 1, number: 1, patient: { name: '王小明' }, fee: 150 },\n  { id: 2, number: 2, patient: { name: '陳美華' }, fee: 0 },\n  { id: 3, number: 3, patient: { name: '林志明' }, fee: null },\n  { id: 4, number: 4, patient: { name: '李大同' }, fee: 200 },\n]\nassertEqual(buildBoard(list).totalFee, 350, 'totalFee')\nassertEqual(buildBoard([]), { lines: [], totalFee: 0 }, '空陣列')" },
      { name: '不改傳進來的陣列', code: "const list = [\n  { id: 1, number: 12, patient: { name: '王小明' }, fee: 150 },\n  { id: 2, number: 3, patient: { name: '陳美華' }, fee: 150 },\n  { id: 3, number: 9, patient: { name: '林志明' }, fee: 150 },\n]\nbuildBoard(list)\nassertEqual(list.map((a) => a.number), [12, 3, 9], '呼叫之後原陣列的號碼順序')" },
    ],
    hints: ['箭頭函式加了大括號就是函式本體，要自己寫 `return`；只有一個運算式時拿掉大括號。', '`a.patient?.name ?? \'姓名未填\'` 同時接住 `undefined` 與 `null`；`||` 會把 0 也換掉，`??` 只換 `null`、`undefined`。', '`sort` 直接改原陣列，`toSorted` 回傳新陣列；`reduce` 一律給初始值。'],
  },
  {
    id: 'values-references-1', skill: 'values-references', kind: 'js', level: 2,
    title: '按了取消，清單上的電話不能跟著變',
    prompt: '掛號編輯 Dialog 用三個函式處理資料。現在按「取消」後清單上的電話已經被改掉，儲存後清單的元件沒有更新，報到之後 `date` 變成字串。改寫這三個函式：\n\n- `createDraft(appointment)`：回傳給表單用的複本，改複本的任何一層（例如 `patient.contact.phone`）都不影響原資料；`date` 仍是 `Date`，而且是另一個 `Date` 物件\n- `saveDraft(list, draft)`：回傳新的陣列，`id` 相同的那一筆換成 `draft`；不改傳進來的 `list`，其他筆沿用原本的物件（`===` 相同）\n- `checkIn(list, id)`：回傳新的陣列，那一筆換成 `status` 為 `\'checked_in\'` 的新物件；原本的物件不變，其他筆沿用原本的物件，`date` 仍是 `Date`\n\n每筆掛號是 `{ id, status, date, patient: { name, contact: { phone } } }`。',
    starter: `function createDraft(appointment) {
  return { ...appointment }                 // 複製一份給表單用
}

function saveDraft(list, draft) {
  const i = list.findIndex((a) => a.id === draft.id)
  list[i] = draft
  return list
}

function checkIn(list, id) {
  const next = JSON.parse(JSON.stringify(list))
  next.find((a) => a.id === id).status = 'checked_in'
  return next
}

// 試跑：打開 Dialog 改電話，再按取消
const list = [
  { id: 501, status: 'booked', date: new Date('2026-11-20T09:00:00+08:00'), patient: { name: '王小明', contact: { phone: '0912-000-111' } } },
  { id: 502, status: 'booked', date: new Date('2026-11-20T09:10:00+08:00'), patient: { name: '陳美華', contact: { phone: '0922-000-222' } } },
]
const draft = createDraft(list[0])
draft.patient.contact.phone = '0912-000-999'
console.log('取消之後清單上的電話：', list[0].patient.contact.phone)
const next = checkIn(list, 502)
console.log('報到之後 date 還是 Date 嗎：', next[1].date instanceof Date)
`,
    solution: `function createDraft(appointment) {
  return structuredClone(appointment)       // 每一層都複製；Date 複製成新的 Date
}

function saveDraft(list, draft) {
  return list.map((a) => (a.id === draft.id ? draft : a))   // 新陣列，其他筆沿用原本的物件
}

function checkIn(list, id) {
  return list.map((a) => (a.id === id ? { ...a, status: 'checked_in' } : a))
}

// 試跑：打開 Dialog 改電話，再按取消
const list = [
  { id: 501, status: 'booked', date: new Date('2026-11-20T09:00:00+08:00'), patient: { name: '王小明', contact: { phone: '0912-000-111' } } },
  { id: 502, status: 'booked', date: new Date('2026-11-20T09:10:00+08:00'), patient: { name: '陳美華', contact: { phone: '0922-000-222' } } },
]
const draft = createDraft(list[0])
draft.patient.contact.phone = '0912-000-999'
console.log('取消之後清單上的電話：', list[0].patient.contact.phone)
const next = checkIn(list, 502)
console.log('報到之後 date 還是 Date 嗎：', next[1].date instanceof Date)
`,
    tests: [
      { name: '改草稿的內層欄位，原資料不變', code: "const appt = { id: 1, status: 'booked', date: new Date('2026-11-20T09:00:00+08:00'), patient: { name: '王小明', contact: { phone: '0912-000-111' } } }\nconst d = createDraft(appt)\nd.status = 'cancelled'\nd.patient.name = '王大明'\nd.patient.contact.phone = '0912-000-999'\nassertEqual([appt.status, appt.patient.name, appt.patient.contact.phone], ['booked', '王小明', '0912-000-111'], '原資料的 status、姓名、電話')" },
      { name: '草稿的 date 是另一個 Date', code: "const appt = { id: 1, status: 'booked', date: new Date('2026-11-20T09:00:00+08:00'), patient: { name: '王小明', contact: { phone: '0912-000-111' } } }\nconst d = createDraft(appt)\nassert(d.date instanceof Date, '草稿的 date 是 ' + typeof d.date + '，不是 Date')\nassertEqual(d.date.getTime(), appt.date.getTime(), '時間')\nassert(d.date !== appt.date, '草稿和原資料共用同一個 Date 物件：改草稿的日期會改到原資料')" },
      { name: 'saveDraft 回傳新陣列，不改傳進來的 list', code: "const a = { id: 1, status: 'booked', patient: { name: '王小明' } }\nconst b = { id: 2, status: 'booked', patient: { name: '陳美華' } }\nconst list = [a, b]\nconst draft = { id: 2, status: 'booked', patient: { name: '陳美華（改）' } }\nconst next = saveDraft(list, draft)\nassert(next !== list, '回傳的還是同一個陣列：依參考比較變更的元件看不出有變')\nassert(list[1] === b, '傳進來的 list 被改了')\nassert(next[1] === draft, '新陣列裡 id 2 那一筆要是 draft')\nassert(next[0] === a, '沒改的那一筆要沿用原本的物件')" },
      { name: 'checkIn 只換掉那一筆，Date 還是 Date', code: "const a = { id: 1, status: 'booked', date: new Date('2026-11-20T09:00:00+08:00'), patient: { name: '王小明' } }\nconst b = { id: 2, status: 'booked', date: new Date('2026-11-20T09:10:00+08:00'), patient: { name: '陳美華' } }\nconst list = [a, b]\nconst next = checkIn(list, 2)\nassertEqual([next[1].status, b.status], ['checked_in', 'booked'], '新的那一筆與原本那一筆的 status')\nassert(next[1].date instanceof Date, '報到後 date 變成了 ' + typeof next[1].date)\nassert(next[0] === a, '沒報到的那一筆要沿用原本的物件')\nassert(next !== list, '要回傳新的陣列')" },
    ],
    hints: ['`{ ...obj }` 只複製第一層，`patient` 還是同一個物件；`structuredClone` 每一層都複製，`Date` 也會是新的。', '`list.map((a) => (a.id === id ? 新物件 : a))` 回傳新陣列，沒變的那幾筆沿用原本的參考。', '`JSON.parse(JSON.stringify(x))` 把 `Date` 變成字串，所有物件也都換成新的。'],
  },
  {
    id: 'event-loop-1', skill: 'event-loop', kind: 'js', level: 2,
    title: '月報切段計算：await Promise.resolve() 讓不出主執行緒',
    prompt: '「產生月報」要統計 5 萬筆掛號。`buildReport(appointments, onProgress)` 已經切成每批 1,000 筆，每批做完呼叫 `onProgress(已完成筆數)`，批與批之間用 `await Promise.resolve()`「讓出主執行緒」。實際按下去畫面還是凍住到算完：點擊、計時器、畫面更新都要等整份做完。改成：\n\n- 批與批之間 `await` 一個 task：`await new Promise((r) => setTimeout(r, 0))`；支援 `scheduler.yield()` 的瀏覽器（Chrome 129、Firefox 142 起，Safari 還沒有）可以用它，不支援時退回 `setTimeout`\n- 每批 1,000 筆，`onProgress` 依序收到 1000、2000、…，最後一次是總筆數；空陣列不呼叫 `onProgress`\n- 回傳 `{ byDept, total }`：`byDept` 是各科別的筆數，例如 `{ 內科: 2, 眼科: 1 }`\n\n這裡在 Web Worker 裡執行，順序規則和主執行緒相同；測試在呼叫前先排一個 `setTimeout`，看它能不能在算完之前執行。',
    starter: `const BATCH = 1000

async function buildReport(appointments, onProgress) {
  const byDept = {}
  for (let i = 0; i < appointments.length; i += BATCH) {
    for (const a of appointments.slice(i, i + BATCH)) byDept[a.dept] = (byDept[a.dept] ?? 0) + 1
    onProgress(Math.min(i + BATCH, appointments.length))
    await Promise.resolve()          // 讓出主執行緒
  }
  return { byDept, total: appointments.length }
}

// 試跑：計算前先排一個 0 ms 的計時器，看它什麼時候執行
const depts = ['內科', '眼科', '骨科']
const appts = Array.from({ length: 5000 }, (_, i) => ({ id: i + 1, dept: depts[i % 3] }))
setTimeout(() => console.log('計時器執行了'), 0)
const report = await buildReport(appts, (done) => console.log('已完成', done))
console.log(JSON.stringify(report))
`,
    solution: `const BATCH = 1000

// 讓出主執行緒：等一個 task，計時器、點擊與畫面更新可以先插進來
const yieldToMain = () =>
  globalThis.scheduler?.yield ? scheduler.yield() : new Promise((r) => setTimeout(r, 0))

async function buildReport(appointments, onProgress) {
  const byDept = {}
  for (let i = 0; i < appointments.length; i += BATCH) {
    for (const a of appointments.slice(i, i + BATCH)) byDept[a.dept] = (byDept[a.dept] ?? 0) + 1
    onProgress(Math.min(i + BATCH, appointments.length))
    await yieldToMain()              // await Promise.resolve() 只讓到 microtask，task 要等全部做完
  }
  return { byDept, total: appointments.length }
}

// 試跑：計算前先排一個 0 ms 的計時器，看它什麼時候執行
const depts = ['內科', '眼科', '骨科']
const appts = Array.from({ length: 5000 }, (_, i) => ({ id: i + 1, dept: depts[i % 3] }))
setTimeout(() => console.log('計時器執行了'), 0)
const report = await buildReport(appts, (done) => console.log('已完成', done))
console.log(JSON.stringify(report))
`,
    tests: [
      { name: '統計各科別的筆數', code: "const depts = ['內科', '眼科', '骨科', '內科']\nconst list = Array.from({ length: 2500 }, (_, i) => ({ id: i + 1, dept: depts[i % 4] }))\nassertEqual(await buildReport(list, () => {}), { byDept: { 內科: 1250, 眼科: 625, 骨科: 625 }, total: 2500 })\nassertEqual(await buildReport([], () => {}), { byDept: {}, total: 0 }, '空陣列')" },
      { name: '每 1,000 筆回報一次進度，空陣列不回報', code: "const list = Array.from({ length: 2500 }, (_, i) => ({ id: i + 1, dept: '內科' }))\nconst seen = []\nawait buildReport(list, (done) => seen.push(done))\nassertEqual(seen, [1000, 2000, 2500], 'onProgress 收到的值')\nconst none = []\nawait buildReport([], (done) => none.push(done))\nassertEqual(none, [], '空陣列')" },
      { name: '批與批之間讓出主執行緒：先排好的計時器在算完之前執行', code: "// scheduler.yield() 的接續比其他 task 優先；這裡換成一律等一個 setTimeout，兩種寫法都能檢查\ntry { Object.defineProperty(globalThis, 'scheduler', { value: { yield: () => new Promise((r) => setTimeout(r, 0)) }, configurable: true, writable: true }) } catch {}\nconst list = Array.from({ length: 3000 }, (_, i) => ({ id: i + 1, dept: '內科' }))\nlet timerRan = false\nsetTimeout(() => { timerRan = true }, 0)\nconst seen = []\nawait buildReport(list, (done) => seen.push('完成 ' + done + ' 筆時計時器' + (timerRan ? '已執行' : '還沒執行')))\nassert(seen.length === 3 && seen[2].includes('已執行'), '計時器等到全部算完才執行（' + seen.join('；') + '）：await Promise.resolve() 只讓到 microtask')" },
    ],
    hints: ['microtask queue 要清空才輪到下一個 task；`await Promise.resolve()` 之後的程式排在 microtask，計時器與點擊事件都還在等。', '`await new Promise((r) => setTimeout(r, 0))` 讓這個 task 結束，其他 task 先跑，再接著算下一批。'],
  },
]

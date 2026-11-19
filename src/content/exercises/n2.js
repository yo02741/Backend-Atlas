// 程式題：使用元件庫（Element Plus，vue 題在沙箱 iframe 載入 element-plus 2.14.8）與單元測試（js 題，使用者寫測試）

// ── unit-tests 題共用：迷你 describe / it / expect / vi，用法照 Vitest。起始碼附一份給「執行」試跑，
//    交卷時檢查器用自己的一份（包在函式裡，不受使用者改動影響）拿正確版與改壞的版本各跑一次使用者的 spec。
//    String.raw：裡面的反斜線照原樣進到程式碼；內容不能有反引號與 ${。
const MINI = String.raw`// ── 題目提供：迷你 describe / it / expect / vi（用法照 Vitest；改這裡不影響交卷的評分） ──
async function runSpec(spec, impl) {
  const real = { setTimeout, clearTimeout, setInterval, clearInterval, Date }
  const fmt = (v) => { try { return v instanceof Error ? v.name + ': ' + v.message : JSON.stringify(v) ?? String(v) } catch { return String(v) } }
  const eq = (a, b, strict) => {
    if (Object.is(a, b)) return true
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false
    if (strict && Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false
    const keys = (o) => Object.keys(o).filter((k) => strict || o[k] !== undefined)
    const ka = keys(a), kb = keys(b)
    return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && eq(a[k], b[k], strict))
  }
  // vi：fn、useFakeTimers、advanceTimersByTime、setSystemTime、getTimerCount、useRealTimers
  let clock = null
  const vi = {
    fn(impl) { const f = (...args) => { f.mock.calls.push(args); return impl ? impl(...args) : undefined }; f.mock = { calls: [] }; return f },
    useFakeTimers() {
      if (clock) return vi
      const c = clock = { now: real.Date.now(), seq: 0, timers: new Map() }
      const add = (fn, ms, args, repeat) => { const id = ++c.seq; const d = Math.max(0, Number(ms) || 0); c.timers.set(id, { at: c.now + d, fn, args, every: repeat ? Math.max(1, d) : 0 }); return id }
      globalThis.setTimeout = (fn, ms, ...args) => add(fn, ms, args, false)
      globalThis.setInterval = (fn, ms, ...args) => add(fn, ms, args, true)
      globalThis.clearTimeout = globalThis.clearInterval = (id) => { c.timers.delete(id) }
      globalThis.Date = class extends real.Date { constructor(...a) { super(...(a.length ? a : [c.now])) } static now() { return c.now } }
      return vi
    },
    useRealTimers() { Object.assign(globalThis, real); clock = null; return vi },
    setSystemTime(t) { if (!clock) vi.useFakeTimers(); clock.now = new real.Date(t).getTime(); return vi },
    advanceTimersByTime(ms) {
      if (!clock) throw new Error('先呼叫 vi.useFakeTimers()')
      const end = clock.now + ms
      for (;;) {
        let next = null
        for (const [id, t] of clock.timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t]
        if (!next) break
        const [id, t] = next
        clock.now = t.at
        if (t.every) t.at += t.every; else clock.timers.delete(id)
        t.fn(...t.args)
      }
      clock.now = end
      return vi
    },
    getTimerCount() { return clock ? clock.timers.size : 0 },
  }
  const isMock = (f) => typeof f === 'function' && f.mock && Array.isArray(f.mock.calls)
  const expect = (got) => {
    const fail = (msg) => { throw new Error(msg) }
    const needMock = (name) => { if (!isMock(got)) fail(name + ' 要傳 vi.fn() 建立的函式') }
    const m = {
      toBe: (w) => { if (!Object.is(got, w)) fail('expected ' + fmt(got) + ' to be ' + fmt(w)) },
      toEqual: (w) => { if (!eq(got, w, false)) fail('expected ' + fmt(got) + ' to deeply equal ' + fmt(w)) },
      toStrictEqual: (w) => { if (!eq(got, w, true)) fail('expected ' + fmt(got) + ' to strictly equal ' + fmt(w)) },
      toBeNull: () => { if (got !== null) fail('expected ' + fmt(got) + ' to be null') },
      toThrow: (w) => {
        if (typeof got !== 'function') fail('toThrow 要傳函式：expect(() => f(…)).toThrow()')
        let err = null
        try { got() } catch (e) { err = e instanceof Error ? e : new Error(String(e)) }
        if (!err) fail('expected function to throw an error, but it did not')
        if (typeof w === 'string' && !err.message.includes(w)) fail("expected error to include '" + w + "' but got '" + err.message + "'")
        if (w instanceof RegExp && !w.test(err.message)) fail('expected error to match ' + w + " but got '" + err.message + "'")
        if (typeof w === 'function' && !(err instanceof w)) fail('expected error to be instance of ' + w.name + ', got ' + err.name)
      },
      toHaveBeenCalled: () => { needMock('toHaveBeenCalled'); if (!got.mock.calls.length) fail('expected "vi.fn()" to be called at least once') },
      toHaveBeenCalledTimes: (n) => { needMock('toHaveBeenCalledTimes'); if (got.mock.calls.length !== n) fail('expected "vi.fn()" to be called ' + n + ' times, but got ' + got.mock.calls.length + ' times') },
      toHaveBeenCalledWith: (...args) => { needMock('toHaveBeenCalledWith'); if (!got.mock.calls.some((c) => eq(c, args, false))) fail('expected "vi.fn()" to be called with ' + fmt(args) + ', calls: ' + fmt(got.mock.calls)) },
    }
    m.not = {}
    for (const [k, f] of Object.entries(m)) if (k !== 'not') m.not[k] = (...a) => { let passed = true; try { f(...a) } catch { passed = false } if (passed) fail('expected not.' + k + '(' + a.map(fmt).join(', ') + ') but it passed (got ' + fmt(isMock(got) ? got.mock.calls : got) + ')') }
    return m
  }
  // describe / it / test / it.each / beforeEach / afterEach
  const cases = [], stack = [{ name: null, before: [], after: [] }]
  const describe = (name, fn) => { stack.push({ name, before: [], after: [] }); try { fn() } finally { stack.pop() } }
  const it = (name, fn) => { const frames = [...stack]; cases.push({ name: frames.slice(1).map((f) => f.name).concat(name).join(' > '), fn, frames }) }
  it.each = (rows) => (name, fn) => rows.forEach((row) => it(String(name).replace(/\$(\w+)/g, (_, k) => fmt(row[k])), () => fn(row)))
  const beforeEach = (fn) => { stack[stack.length - 1].before.push(fn) }
  const afterEach = (fn) => { stack[stack.length - 1].after.push(fn) }
  spec({ describe, it, test: it, expect, vi, beforeEach, afterEach }, impl)
  const result = { passed: [], failed: [] }
  for (const c of cases) {
    try {
      for (const f of c.frames) for (const h of f.before) await h()
      await c.fn()
      for (const f of [...c.frames].reverse()) for (const h of f.after) await h()
      result.passed.push(c.name)
    } catch (e) {
      result.failed.push({ name: c.name, error: e && e.message ? e.message : String(e) })
    } finally {
      vi.useRealTimers()
    }
  }
  return result
}`

// 試跑：起始碼與解答的最後一段
const TRY = (fnName) => `// 試跑：用正確版跑一次你的測試（交卷時，檢查器另外拿改壞的版本跑）
const result = await runSpec(spec, ${fnName})
result.passed.forEach((name) => console.log('✓', name))
result.failed.forEach((f) => console.log('✗', f.name, '—', f.error))
`

// 檢查器：正確版要全部通過；每個改壞的版本至少一個測試失敗
const RUN = (impl) => `const __run = (() => {\n${MINI}\nreturn runSpec\n})()
assert(typeof spec === 'function', '找不到 spec 函式：測試寫在 function spec({ describe, it, expect, vi }, …) 裡')
const r = await __run(spec, ${impl})
assert(r.passed.length + r.failed.length > 0, 'spec 裡沒有任何 it()')`
const checkCorrect = (impl) => `${RUN(impl)}
assert(r.failed.length === 0, '正確版也失敗的測試：' + r.failed.map((f) => f.name + '（' + f.error + '）').join('；'))`
const checkMutant = (impl) => `${RUN(impl)}
assert(r.failed.length > 0, '換成這個改壞的版本，你的 ' + r.passed.length + ' 個測試還是全部通過')`

// ── unit-tests-1：候診時間估算（正確版與四個改壞的版本） ──
const WAIT = `function estimateWait(current, mine, minutesPerPatient = 6) {
  if (!Number.isInteger(current) || !Number.isInteger(mine)) throw new TypeError('號碼要是整數')
  if (mine < current) throw new RangeError('已過號')
  const minutes = (mine - current) * minutesPerPatient
  return Math.ceil(minutes / 5) * 5   // 無條件進位到 5 分鐘
}`
const mutate = (src, from, to) => { if (!src.includes(from)) throw new Error('mutant: 找不到 ' + from); return src.replace(from, to) }
const WAIT_MUTANTS = [
  ['輪到自己（mine === current）也當成過號', mutate(WAIT, 'mine < current', 'mine <= current')],
  ['無條件進位改成四捨五入', mutate(WAIT, 'Math.ceil(', 'Math.round(')],
  ['忽略 minutesPerPatient，固定每位 6 分鐘', mutate(WAIT, '(mine - current) * minutesPerPatient', '(mine - current) * 6')],
  ['拿掉整數檢查', mutate(WAIT, "if (!Number.isInteger(current) || !Number.isInteger(mine)) throw new TypeError('號碼要是整數')\n  ", '')],
]

// ── unit-tests-2：debounce（正確版與四個改壞的版本） ──
const DEBOUNCE = `function debounce(fn, ms) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}`
const DEBOUNCE_MUTANTS = [
  ['沒有清掉前一個計時器：每次輸入都會呼叫', mutate(DEBOUNCE, '    clearTimeout(timer)\n', '')],
  ['計時器不重設：第一次輸入後 ms 毫秒就呼叫', `function debounce(fn, ms) {
  let timer = null, last
  return (...args) => {
    last = args
    if (timer) return
    timer = setTimeout(() => { timer = null; fn(...last) }, ms)
  }
}`],
  ['用第一次輸入的參數', `function debounce(fn, ms) {
  let timer, first = null
  return (...args) => {
    first = first || args
    clearTimeout(timer)
    timer = setTimeout(() => { const a = first; first = null; fn(...a) }, ms)
  }
}`],
  ['等待時間只有一半', mutate(DEBOUNCE, '() => fn(...args), ms)', '() => fn(...args), ms / 2)')],
  ['第一次輸入立刻呼叫（leading edge）', `function debounce(fn, ms) {
  let timer = null
  return (...args) => {
    const first = timer === null
    clearTimeout(timer)
    timer = setTimeout(() => { timer = null; if (!first) fn(...args) }, ms)
    if (first) fn(...args)
  }
}`],
]

export default [
  {
    id: 'element-plus-1', skill: 'element-plus', kind: 'vue', level: 2,
    title: '把後端的 422 對回 el-form-item',
    prompt: '櫃台的掛號表單用 Element Plus（沙箱載入 `element-plus` 2.14.8 的瀏覽器建置，樣式自動帶入）。現在有三個問題：前端驗證沒過時 Console 出現未處理的錯誤；後端回 422 時畫面沒有任何訊息；同一個錯誤第二次回來就不顯示了。改成：\n\n- 前端規則：病歷號必填（訊息「請輸入病歷號」）；手機符合 `^09\\d{8}$`（訊息「手機格式是 09 開頭的 10 碼」）。驗證沒過時**不送出請求**，Console 沒有錯誤\n- 送出 `POST /api/registrations`，body 是 `{ patient_no, phone }`；`201` 時用 `ElMessage.success` 顯示「已完成掛號，號碼 A012」（號碼取回應的 `number`）\n- `422` 的 body 是 `{ errors: [{ field, message }] }`，`field` 是後端的欄位名（`patient_no`、`phone`）：訊息放進對應 `el-form-item` 的 `error`；對不到欄位的訊息放在 `data-test="form-error"` 的元素裡\n- 每次送出前清掉上一次的後端錯誤：使用者改了欄位再送、後端回同一則訊息時，訊息要再出現\n\n測試用 `data-test="patientNo"`、`data-test="phone"`（放在 `el-form-item` 上）、`data-test="submit"` 找元素，欄位錯誤讀 `.el-form-item__error`。',
    api: "api.latency = 40\napi.post('/api/registrations', { status: 201, body: { id: 81, number: 'A012' } })",
    starter: `import { createApp, ref, reactive } from 'vue'
import ElementPlus, { ElMessage } from 'element-plus'

const RegistrationForm = {
  setup() {
    const formRef = ref()
    const form = reactive({ patientNo: '', phone: '' })
    const serverErrors = reactive({})
    const formError = ref('')
    const rules = {
      patientNo: [{ required: true, message: '請輸入病歷號', trigger: 'blur' }],
      phone: [{ pattern: /^09\\d{8}$/, message: '手機格式是 09 開頭的 10 碼', trigger: 'blur' }],
    }

    async function onSubmit() {
      await formRef.value.validate()
      const res = await fetch('/api/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_no: form.patientNo, phone: form.phone }),
      })
      const body = await res.json()
      if (res.status === 201) ElMessage.success('已完成掛號，號碼 ' + body.number)
      else if (res.status === 422) for (const e of body.errors) serverErrors[e.field] = e.message
    }
    return { formRef, form, serverErrors, formError, rules, onSubmit }
  },
  template: \`
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="onSubmit">
      <el-form-item label="病歷號" prop="patientNo" :error="serverErrors.patientNo" data-test="patientNo">
        <el-input v-model="form.patientNo" />
      </el-form-item>
      <el-form-item label="手機" prop="phone" :error="serverErrors.phone" data-test="phone">
        <el-input v-model="form.phone" inputmode="tel" />
      </el-form-item>
      <el-alert v-if="formError" type="error" :title="formError" :closable="false" data-test="form-error" />
      <el-button type="primary" native-type="submit" data-test="submit">送出掛號</el-button>
    </el-form>\`,
}

createApp(RegistrationForm).use(ElementPlus).mount('#app')
`,
    solution: `import { createApp, ref, reactive } from 'vue'
import ElementPlus, { ElMessage } from 'element-plus'

// 後端欄位名 → 表單的 prop
const FIELD_MAP = { patient_no: 'patientNo', phone: 'phone' }

const RegistrationForm = {
  setup() {
    const formRef = ref()
    const form = reactive({ patientNo: '', phone: '' })
    const serverErrors = reactive({ patientNo: '', phone: '' })
    const formError = ref('')
    const submitting = ref(false)
    const rules = {
      patientNo: [{ required: true, message: '請輸入病歷號', trigger: 'blur' }],
      phone: [{ pattern: /^09\\d{8}$/, message: '手機格式是 09 開頭的 10 碼', trigger: 'blur' }],
    }

    async function onSubmit() {
      if (submitting.value) return
      // 先清掉上一次的後端錯誤：error prop 的值沒變，el-form-item 不會重新顯示
      for (const k of Object.keys(serverErrors)) serverErrors[k] = ''
      formError.value = ''
      // validate() 沒過時 reject（帶各欄位的錯誤），不接住就是未處理的 Promise 拒絕
      const ok = await formRef.value.validate().catch(() => false)
      if (!ok) return
      submitting.value = true
      try {
        const res = await fetch('/api/registrations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patient_no: form.patientNo, phone: form.phone }),
        })
        const body = await res.json().catch(() => ({}))
        if (res.status === 201) {
          ElMessage.success('已完成掛號，號碼 ' + body.number)
        } else if (res.status === 422) {
          const other = []
          for (const e of body.errors ?? []) {
            const prop = FIELD_MAP[e.field]
            if (prop && !serverErrors[prop]) serverErrors[prop] = e.message
            else if (!prop) other.push(e.message)
          }
          formError.value = other.join('；')
        } else {
          formError.value = body.detail || '送出失敗，請再試一次'
        }
      } catch {
        formError.value = '網路連線失敗，請再試一次'
      } finally {
        submitting.value = false
      }
    }
    return { formRef, form, serverErrors, formError, submitting, rules, onSubmit }
  },
  template: \`
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="onSubmit">
      <el-form-item label="病歷號" prop="patientNo" :error="serverErrors.patientNo" data-test="patientNo">
        <el-input v-model="form.patientNo" />
      </el-form-item>
      <el-form-item label="手機" prop="phone" :error="serverErrors.phone" data-test="phone">
        <el-input v-model="form.phone" inputmode="tel" />
      </el-form-item>
      <el-alert v-if="formError" type="error" :title="formError" :closable="false" data-test="form-error" />
      <el-button type="primary" native-type="submit" :loading="submitting" data-test="submit">送出掛號</el-button>
    </el-form>\`,
}

createApp(RegistrationForm).use(ElementPlus).mount('#app')
`,
    tests: [
      { name: '驗證沒過：兩個欄位都顯示訊息、不送出請求、沒有未處理的錯誤', code: `await waitFor(() => $('[data-test=submit]'))
input('[data-test=phone] input', '0212345678')
click('[data-test=submit]')
await waitFor(() => text('[data-test=patientNo] .el-form-item__error') === '請輸入病歷號')
await waitFor(() => text('[data-test=phone] .el-form-item__error') === '手機格式是 09 開頭的 10 碼')
await wait(50)
assertEqual(api.calls.filter((c) => c.method === 'POST').length, 0, '驗證沒過時送出的請求數')` },
      { name: '201：送出正確的 body，顯示 ElMessage', code: `await waitFor(() => $('[data-test=submit]'))
input('[data-test=patientNo] input', 'P0001')
input('[data-test=phone] input', '0912345678')
click('[data-test=submit]')
await waitFor(() => $('.el-message') && $('.el-message').textContent.includes('已完成掛號，號碼 A012'))
assertEqual(api.calls.find((c) => c.method === 'POST').body, { patient_no: 'P0001', phone: '0912345678' })` },
      { name: '422：病歷號的訊息放在欄位下方，對不到欄位的放在表單上方', api: "api.post('/api/registrations', { status: 422, body: { type: 'https://clinic.example/problems/validation-error', title: 'Unprocessable Content', status: 422, errors: [{ field: 'patient_no', message: '查無此病歷號' }, { field: 'session_id', message: '這個診次已停診' }] } })", code: `await waitFor(() => $('[data-test=submit]'))
input('[data-test=patientNo] input', 'P9999')
input('[data-test=phone] input', '0912345678')
click('[data-test=submit]')
await waitFor(() => text('[data-test=patientNo] .el-form-item__error') === '查無此病歷號', { timeout: 1000 })
await waitFor(() => $('[data-test=form-error]') && $('[data-test=form-error]').textContent.includes('這個診次已停診'), { timeout: 1000 })
assert(!$('[data-test=phone] .el-form-item__error'), '手機欄位不該有錯誤')` },
      { name: '改了欄位再送、後端回同一則訊息：訊息再出現', api: "api.post('/api/registrations', { status: 422, body: { title: 'Unprocessable Content', status: 422, errors: [{ field: 'patient_no', message: '查無此病歷號' }] } })", code: `await waitFor(() => $('[data-test=submit]'))
input('[data-test=patientNo] input', 'P9999')
input('[data-test=phone] input', '0912345678')
click('[data-test=submit]')
await waitFor(() => text('[data-test=patientNo] .el-form-item__error') === '查無此病歷號', { timeout: 1000 })
input('[data-test=patientNo] input', 'P9998')
click('[data-test=submit]')
await waitFor(() => api.calls.filter((c) => c.method === 'POST' && c.status).length === 2)
await wait(500)
assertEqual(text('[data-test=patientNo] .el-form-item__error'), '查無此病歷號', '第二次 422 之後的欄位錯誤')` },
    ],
    hints: [
      '`formRef.value.validate()` 沒過時會 reject，帶著各欄位的錯誤；用 `.catch(() => false)` 或 try／catch 接住，沒過就 return。',
      '後端的 `patient_no` 和表單的 `patientNo` 不同名，要有一張對照表；對不到的放進 `formError`。',
      '`el-form-item` 只在 `error` 的值改變時才重新顯示錯誤；送出前先把每個欄位的後端錯誤設成空字串。',
    ],
  },
  {
    id: 'unit-tests-1', skill: 'unit-tests', kind: 'js', level: 2,
    title: '替候診時間估算寫測試：殺掉四個改壞的版本',
    prompt: '候診看板用 `estimateWait(current, mine, minutesPerPatient = 6)` 估算還要等幾分鐘。規格：\n\n- `current` 是目前看到的號碼、`mine` 是自己的號碼，兩個都要是整數，否則丟 `TypeError`\n- `mine` 比 `current` 小代表已過號，丟 `RangeError`；`mine` 等於 `current` 是輪到自己，回傳 `0`\n- 其他情況回傳 `(mine - current) × minutesPerPatient`，**無條件進位**到 5 的倍數\n\n函式是對的，這題要寫的是**測試**。測試寫在 `spec({ describe, it, test, expect, vi }, estimateWait)` 裡，用法照 Vitest（支援 `toBe`、`toEqual`、`toStrictEqual`、`toThrow`、`.not`、`it.each`）。第二個參數就是受測函式：交卷時檢查器先用正確版跑你的測試（要全部通過），再換成四個改壞的版本各跑一次（每個都要至少一個測試失敗）：\n\n1. 輪到自己（`mine === current`）也當成過號\n2. 無條件進位改成四捨五入\n3. 忽略 `minutesPerPatient`，固定每位 6 分鐘\n4. 拿掉整數檢查\n\n起始碼的兩個測試對正確版是綠的，四個改壞的版本卻一個都抓不到。按「執行」會用正確版試跑。',
    starter: `// 受測函式（正確版，不用改）
${WAIT}

// 測試寫在這裡：第二個參數 estimateWait 就是受測函式（交卷時會被換成改壞的版本）
function spec({ describe, it, test, expect }, estimateWait) {
  describe('estimateWait', () => {
    it('前面 5 位：約 30 分鐘', () => {
      expect(estimateWait(10, 15)).toBe(30)
    })
    it('已過號會丟錯', () => {
      expect(() => estimateWait(12, 10)).toThrow()
    })
  })
}

${TRY('estimateWait')}
${MINI}
`,
    solution: `// 受測函式（正確版，不用改）
${WAIT}

// 每個測試只驗一件事；名稱寫成規格，失敗時一看就知道哪條規則壞了
function spec({ describe, it, test, expect }, estimateWait) {
  describe('estimateWait', () => {
    // 邊界表：輪到自己、一位、剛好整除、要進位
    test.each([
      { current: 10, mine: 10, expected: 0 },    // 輪到自己：殺掉「<= 當成過號」
      { current: 10, mine: 11, expected: 10 },   // 6 分鐘進位到 10：殺掉「四捨五入」（會得到 5）
      { current: 10, mine: 15, expected: 30 },   // 剛好 30
    ])('目前 $current 號、我是 $mine 號：約 $expected 分鐘', ({ current, mine, expected }) => {
      expect(estimateWait(current, mine)).toBe(expected)
    })

    it('每位 3 分鐘、前面 5 位：約 15 分鐘', () => {
      expect(estimateWait(10, 15, 3)).toBe(15)   // 殺掉「固定 6 分鐘」（會得到 30）
    })

    it('已過號丟 RangeError', () => {
      expect(() => estimateWait(12, 10)).toThrow(RangeError)
    })

    it('號碼不是整數丟 TypeError', () => {
      expect(() => estimateWait(10, '15')).toThrow(TypeError)   // 殺掉「拿掉整數檢查」
      expect(() => estimateWait(10.5, 15)).toThrow(TypeError)
    })
  })
}

${TRY('estimateWait')}
${MINI}
`,
    tests: [
      { name: '正確版：你的測試全部通過', code: checkCorrect(WAIT) },
      ...WAIT_MUTANTS.map(([label, src], i) => ({ name: `改壞 ${i + 1}：${label}，你的測試要抓到`, code: checkMutant(src) })),
    ],
    hints: [
      '每條規則各找一個「改壞了就會得到不同答案」的輸入：輪到自己（`mine === current`）、需要進位的值（前面 1 位是 6 分鐘）、不是 6 的 `minutesPerPatient`。',
      '`toThrow()` 不帶參數，丟什麼錯都算通過；`toThrow(TypeError)` 才分得出是哪一種錯。',
      '`test.each([{ current, mine, expected }, …])(\'目前 $current 號…\', ({ … }) => …)` 一次寫好一張邊界表。',
    ],
  },
  {
    id: 'unit-tests-2', skill: 'unit-tests', kind: 'js', level: 2,
    title: '用 fake timers 測 debounce',
    prompt: '病患搜尋框用 `debounce(fn, ms)` 包住查詢：使用者停止輸入 `ms` 毫秒後才呼叫一次 `fn`，參數用**最後一次**輸入的；在那之前每次輸入都重新計時，第一次輸入也不會立刻呼叫。\n\n函式是對的，這題要寫的是**測試**。寫在 `spec({ describe, it, expect, vi, beforeEach, afterEach }, debounce)` 裡，用法照 Vitest：`vi.useFakeTimers()`、`vi.advanceTimersByTime(ms)`、`vi.useRealTimers()`、`vi.fn()`，斷言用 `toHaveBeenCalled`、`toHaveBeenCalledTimes`、`toHaveBeenCalledWith` 與 `.not`。真的等 300 毫秒的測試又慢又不穩，時間一律用 fake timers 推。\n\n交卷時檢查器先用正確版跑你的測試（要全部通過），再換成五個改壞的版本（每個都要至少一個測試失敗）：\n\n1. 沒有清掉前一個計時器：每次輸入都會呼叫\n2. 計時器不重設：第一次輸入後 `ms` 毫秒就呼叫\n3. 用第一次輸入的參數\n4. 等待時間只有一半\n5. 第一次輸入立刻呼叫（leading edge）\n\n起始碼的測試只輸入一次，五個改壞的版本都抓不到。',
    starter: `// 受測函式（正確版，不用改）
${DEBOUNCE}

// 測試寫在這裡：第二個參數 debounce 就是受測函式（交卷時會被換成改壞的版本）
function spec({ describe, it, expect, vi, beforeEach, afterEach }, debounce) {
  describe('debounce', () => {
    it('停止輸入 300ms 後呼叫', () => {
      vi.useFakeTimers()
      const search = vi.fn()
      const onInput = debounce(search, 300)
      onInput('王')
      vi.advanceTimersByTime(300)
      expect(search).toHaveBeenCalledWith('王')
      vi.useRealTimers()
    })
  })
}

${TRY('debounce')}
${MINI}
`,
    solution: `// 受測函式（正確版，不用改）
${DEBOUNCE}

function spec({ describe, it, expect, vi, beforeEach, afterEach }, debounce) {
  describe('debounce', () => {
    let search, onInput
    beforeEach(() => {
      vi.useFakeTimers()            // 每個測試都用假的時鐘
      search = vi.fn()
      onInput = debounce(search, 300)
    })
    afterEach(() => {
      vi.useRealTimers()            // 換回真的計時器，不影響下一個測試
    })

    it('輸入後立刻不呼叫，299ms 也還不呼叫', () => {
      onInput('王')
      expect(search).not.toHaveBeenCalled()           // 殺掉 leading edge
      vi.advanceTimersByTime(299)
      expect(search).not.toHaveBeenCalled()           // 殺掉「只等一半」
      vi.advanceTimersByTime(1)
      expect(search).toHaveBeenCalledTimes(1)
    })

    it('連續輸入只呼叫一次，參數是最後一次的', () => {
      onInput('王')
      vi.advanceTimersByTime(200)
      onInput('王小')
      vi.advanceTimersByTime(200)
      onInput('王小明')
      vi.advanceTimersByTime(300)
      expect(search).toHaveBeenCalledTimes(1)         // 殺掉「沒清掉前一個計時器」
      expect(search).toHaveBeenCalledWith('王小明')   // 殺掉「用第一次的參數」
    })

    it('每次輸入都重新計時', () => {
      onInput('王')
      vi.advanceTimersByTime(200)
      onInput('王小')
      vi.advanceTimersByTime(200)                     // 距離第一次輸入 400ms、距離最後一次 200ms
      expect(search).not.toHaveBeenCalled()           // 殺掉「計時器不重設」
      vi.advanceTimersByTime(100)
      expect(search).toHaveBeenCalledWith('王小')
    })
  })
}

${TRY('debounce')}
${MINI}
`,
    tests: [
      { name: '正確版：你的測試全部通過', code: checkCorrect(DEBOUNCE) },
      ...DEBOUNCE_MUTANTS.map(([label, src], i) => ({ name: `改壞 ${i + 1}：${label}，你的測試要抓到`, code: checkMutant(src) })),
    ],
    hints: [
      '`vi.useFakeTimers()` 之後，`setTimeout` 不會自己觸發，要用 `vi.advanceTimersByTime(ms)` 把時間往前推。',
      '每個改壞的版本找一個會讓它露餡的操作：輸入後立刻檢查、推到 299ms 檢查、連續輸入三次再看次數與參數、第二次輸入後推到「距離第一次夠久、距離最後一次不夠久」。',
      '`expect(search).not.toHaveBeenCalled()` 斷言「還沒呼叫」。',
    ],
  },
]

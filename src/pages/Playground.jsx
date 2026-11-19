import React, { useCallback, useEffect, useState } from 'react'
import { decodePlaygroundCode } from '../playgroundLink.js'
import FramePreview from '../components/FramePreview.jsx'
import CodeEditor from '../components/CodeEditor.jsx'
import { ConsoleOut, ResultTable, PlanTree, RuntimeStatus } from '../components/Output.jsx'
import { runPython, ensurePython } from '../runtime/py.js'
import { runSql, resetSchema, explain, ensureSql, invalidateSchema } from '../runtime/sql.js'
import { runJs } from '../runtime/js.js'
import { SHOP_SCHEMA, SHOP_TABLES } from '../content/schemas.js'

/* Playground：像 CodePen 一樣自由打程式，Python / PostgreSQL / JavaScript 都在瀏覽器裡跑。
   HTML 與 Vue 在沙箱 iframe 裡跑（src/runtime/frame.js，第一次執行時才載入），fetch 由假 API 回應，可以調延遲與錯誤率。 */

const SAMPLES = {
  python: [
    { label: 'Hello + 型別提示', code: `from dataclasses import dataclass

@dataclass
class User:
    id: int
    name: str
    email: str | None = None

u = User(1, "Alice")
print(u)
print(f"{u.name} 的信箱：{u.email or '（未設定）'}")
` },
    { label: 'async 併發', code: `import asyncio, time

async def fetch(i: int, delay: float) -> str:
    await asyncio.sleep(delay)      # 模擬 I/O 等待
    return f"req{i} 完成"

async def main():
    t0 = time.time()
    results = await asyncio.gather(*(fetch(i, 0.3) for i in range(5)))
    print(results)
    print(f"5 個 0.3 秒的 I/O 一起等，總共 {time.time() - t0:.2f} 秒")

await main()
` },
    { label: 'JWT 簽章（hmac）', code: `import base64, hmac, hashlib, json

def b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()

header  = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
payload = b64url(json.dumps({"sub": "user_42", "role": "user"}, separators=(",", ":")).encode())
secret  = b"dev-secret"
sig = b64url(hmac.new(secret, f"{header}.{payload}".encode(), hashlib.sha256).digest())
print(f"{header}.{payload}.{sig}")
` },
    { label: '密碼雜湊（PBKDF2）', code: `import hashlib, hmac, os, time

def pbkdf2_sha256(password: bytes, salt: bytes, iterations: int) -> bytes:
    # 純 Python 版（瀏覽器裡的 Python 沒有 OpenSSL）；正式環境用 argon2 / bcrypt
    mac = hmac.new(password, None, hashlib.sha256)
    def prf(msg):
        m = mac.copy(); m.update(msg); return m.digest()
    u = prf(salt + (1).to_bytes(4, "big"))
    t = int.from_bytes(u, "big")
    for _ in range(iterations - 1):
        u = prf(u); t ^= int.from_bytes(u, "big")
    return t.to_bytes(32, "big")

salt = os.urandom(16)
t0 = time.time()
digest = pbkdf2_sha256(b"hunter2", salt, 20_000)
print("salt   :", salt.hex())
print("digest :", digest.hex())
print(f"耗時 {1000 * (time.time() - t0):.0f} ms —— 故意慢，攻擊者每秒只能試幾千次")
` },
  ],
  sql: [
    { label: 'LEFT JOIN：每人訂單數', code: `SELECT u.name, COUNT(o.id) AS orders, COALESCE(SUM(o.amount), 0) AS total
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
GROUP BY u.id, u.name
ORDER BY total DESC;` },
    { label: 'anti-join：沒下單的人', code: `SELECT u.name
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE o.id IS NULL;` },
    { label: '視窗函數：每人最新一筆', code: `SELECT name, order_id, created_at
FROM (
  SELECT u.name, o.id AS order_id, o.created_at,
         ROW_NUMBER() OVER (PARTITION BY u.id ORDER BY o.created_at DESC) AS rn
  FROM users u JOIN orders o ON o.user_id = u.id
) t
WHERE rn = 1;` },
    { label: 'EXPLAIN：有沒有走索引', code: `-- 先看沒有索引：
EXPLAIN SELECT * FROM orders WHERE user_id = 2;
-- 建索引後再看一次（按「執行」兩次比較）
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
EXPLAIN SELECT * FROM orders WHERE user_id = 2;` },
    { label: '交易：扣庫存不能負', code: `BEGIN;
UPDATE products SET stock = stock - 1 WHERE id = 4 AND stock > 0;
-- 耳機庫存是 0，這句影響 0 列 → 應用層要判斷「沒扣到」
SELECT id, name, stock FROM products WHERE id = 4;
ROLLBACK;` },
  ],
  js: [
    { label: 'fetch 風格的 Promise', code: `const fakeDb = (id) => new Promise((res) => setTimeout(() => res({ id, name: 'user' + id }), 100))

const t0 = Date.now()
const users = await Promise.all([1, 2, 3].map(fakeDb))
console.log(users)
console.log('三個 100ms 的查詢一起等：', Date.now() - t0, 'ms')
` },
    { label: 'LRU cache', code: `class LRU {
  constructor(cap) { this.cap = cap; this.map = new Map() }
  get(k) {
    if (!this.map.has(k)) return undefined
    const v = this.map.get(k); this.map.delete(k); this.map.set(k, v); return v
  }
  set(k, v) {
    if (this.map.has(k)) this.map.delete(k)
    else if (this.map.size >= this.cap) this.map.delete(this.map.keys().next().value)
    this.map.set(k, v)
  }
}
const c = new LRU(2)
c.set('a', 1); c.set('b', 2); c.get('a'); c.set('c', 3)
console.log([...c.map.keys()])  // b 被淘汰
` },
  ],
}

SAMPLES.html = [
  { label: '表單與 Console', code: `<main>
  <h1>預約掛號</h1>
  <form id="f">
    <label for="name">姓名</label>
    <input id="name" name="name" autocomplete="name" required>
    <button type="submit">送出</button>
  </form>
  <p id="msg" role="status"></p>
</main>

<style>
  main { font-family: system-ui, sans-serif; padding: 16px; }
  form { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
</style>

<script>
  document.getElementById('f').addEventListener('submit', (e) => {
    e.preventDefault()   // 不擋的話，表單送出會換頁
    const name = new FormData(e.target).get('name')
    console.log('送出：', name)
    document.getElementById('msg').textContent = name + ' 已送出'
  })
</script>
` },
  { label: 'fetch 假 API：門診時段', code: `<ul id="list"><li>載入中…</li></ul>

<script type="module">
  // 假 API 內建門診系統的路由：GET /api/sessions、POST /api/sessions/:id/appointments…
  const res = await fetch('/api/sessions')
  const list = document.getElementById('list')
  if (!res.ok) {
    const problem = await res.json()   // 錯誤 body 是 Problem Details
    list.innerHTML = '<li>讀取失敗：' + problem.title + '</li>'
  } else {
    const sessions = await res.json()
    list.innerHTML = sessions.map((s) => '<li>' + s.session_date + ' ' + s.period + '，剩 ' + s.remaining + ' 位</li>').join('')
  }
</script>
` },
  { label: 'Flexbox：卡片換行', code: `<div class="cards">
  <article class="card">診間 1</article>
  <article class="card">診間 2</article>
  <article class="card">診間 3</article>
</div>

<style>
  .cards { display: flex; flex-wrap: wrap; gap: 12px; padding: 12px; }
  .card { flex: 1 1 200px; padding: 16px; border: 2px solid #333; border-radius: 8px; }
  @media (max-width: 480px) { .card { flex-basis: 100%; } }
</style>
` },
]
SAMPLES.vue = [
  { label: '計數器（ref）', code: `import { createApp, ref, computed } from 'vue'

const App = {
  setup() {
    const count = ref(0)
    const label = computed(() => (count.value >= 5 ? '候診人數偏多' : '候診人數'))
    return { count, label }
  },
  template: \`
    <p>{{ label }}：{{ count }}</p>
    <button type="button" @click="count++">+1</button>\`,
}

createApp(App).mount('#app')
` },
  { label: '掛號：四種狀態', code: `import { createApp, ref, onMounted } from 'vue'

// 用上方的延遲與錯誤率調整假 API，看 loading、error 的畫面
const App = {
  setup() {
    const status = ref('loading')
    const sessions = ref([])
    async function load() {
      status.value = 'loading'
      try {
        const res = await fetch('/api/sessions')
        if (!res.ok) throw new Error('HTTP ' + res.status)
        sessions.value = await res.json()
        status.value = sessions.value.length ? 'success' : 'empty'
      } catch (e) {
        console.warn('讀取失敗：', e.message)
        status.value = 'error'
      }
    }
    onMounted(load)
    return { status, sessions, load }
  },
  template: \`
    <p v-if="status === 'loading'">載入中…</p>
    <p v-else-if="status === 'error'">讀取失敗 <button type="button" @click="load">重試</button></p>
    <p v-else-if="status === 'empty'">沒有門診</p>
    <ul v-else>
      <li v-for="s in sessions" :key="s.id">{{ s.session_date }} {{ s.period }}，剩 {{ s.remaining }} 位</li>
    </ul>\`,
}

createApp(App).mount('#app')
` },
  { label: 'Pinia 與 Vue Router', code: `import { createApp, ref, computed } from 'vue'
import { createPinia, defineStore, storeToRefs } from 'pinia'
import { createRouter, createMemoryHistory, RouterLink, RouterView, useRoute } from 'vue-router'

// setup store：ref 是 state、computed 是 getter、函式是 action
const useQueueStore = defineStore('queue', () => {
  const current = ref({ 101: 12, 102: 5 })
  const total = computed(() => Object.values(current.value).reduce((a, b) => a + b, 0))
  function next(room) { current.value[room]++ }
  return { current, total, next }
})

const Room = {
  setup() {
    const route = useRoute()                       // /rooms/:room 換診間時元件會被重用，直接讀 route.params
    const queue = useQueueStore()
    const { current } = storeToRefs(queue)         // 解構 state 要用 storeToRefs
    return { route, current, next: queue.next }
  },
  template: \`
    <p>{{ route.params.room }} 診：目前 {{ current[route.params.room] }} 號</p>
    <button type="button" @click="next(route.params.room)">叫下一號</button>\`,
}

// 沙箱的網址是 about:srcdoc，router 用 createMemoryHistory()
const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', redirect: '/rooms/101' },
    { path: '/rooms/:room', component: Room },
  ],
})

const App = {
  setup() {
    const { total } = storeToRefs(useQueueStore())
    return { total }
  },
  template: \`
    <nav><RouterLink to="/rooms/101">101 診</RouterLink> · <RouterLink to="/rooms/102">102 診</RouterLink></nav>
    <RouterView />
    <p>已叫號合計 {{ total }}</p>\`,
}

createApp(App).use(createPinia()).use(router).mount('#app')
` },
  { label: '[Vue warn]：直接改 props', code: `import { createApp } from 'vue'

const Badge = {
  props: { count: Number },
  // 錯：props 是唯讀的，Console 會出現 [Vue warn]
  template: '<button type="button" @click="count++">候診 {{ count }}</button>',
}

createApp({ components: { Badge }, template: '<Badge :count="3" />' }).mount('#app')
` },
]

const LANGS = [
  { id: 'python', label: 'Python' },
  { id: 'sql', label: 'PostgreSQL' },
  { id: 'js', label: 'JavaScript' },
  { id: 'html', label: 'HTML' },
  { id: 'vue', label: 'Vue' },
]
const FRAME_LANGS = ['html', 'vue']

function loadDraft(lang) { try { return localStorage.getItem(`atlas-playground-${lang}`) } catch { return null } }
function saveDraft(lang, code) { try { localStorage.setItem(`atlas-playground-${lang}`, code) } catch { /* ignore */ } }

export default function Playground({ initialLang = 'python', initialCode = '' }) {
  const [lang, setLang] = useState(LANGS.some((l) => l.id === initialLang) ? initialLang : 'python')
  // 從課程的「在 Playground 開啟」進來：載入那段程式碼；使用者改過之前不覆蓋原本的草稿
  const linked = React.useRef(decodePlaygroundCode(initialCode))
  // 課程範例假設資料庫是初始狀態：之前在 Playground 建的表或改的資料不能留著
  useEffect(() => { if (linked.current != null) invalidateSchema() }, [])
  const [code, setCode] = useState(() => linked.current ?? loadDraft(lang) ?? SAMPLES[lang][0].code)
  const [out, setOut] = useState(null)
  const [busy, setBusy] = useState(false)
  const [plan, setPlan] = useState(null)
  const isFrame = FRAME_LANGS.includes(lang)
  const [preview, setPreview] = useState({ key: 0, code: '' })
  const [latency, setLatency] = useState(300)
  const [errorRate, setErrorRate] = useState(0)

  const firstLang = React.useRef(true)
  useEffect(() => {
    if (firstLang.current) { firstLang.current = false; return }
    linked.current = null
    setCode(loadDraft(lang) ?? SAMPLES[lang][0].code); setOut(null); setPlan(null); setPreview({ key: 0, code: '' })
  }, [lang])
  useEffect(() => { if (linked.current === null || code !== linked.current) { linked.current = null; saveDraft(lang, code) } }, [lang, code])
  // 進頁就預載執行環境，按下執行時已經好了
  useEffect(() => { if (lang === 'python') ensurePython(); if (lang === 'sql') ensureSql().catch(() => {}) }, [lang])

  const run = useCallback(async () => {
    if (busy) return
    if (isFrame) { setPreview((p) => ({ key: p.key + 1, code })); return }
    setBusy(true); setPlan(null)
    try {
      if (lang === 'python') setOut(await runPython(code))
      else if (lang === 'js') setOut(await runJs(code))
      else { await resetSchema(SHOP_SCHEMA, 'shop'); setOut(await runSql(code)) }
    } finally { setBusy(false) }
  }, [lang, code, busy, isFrame])

  const doExplain = async () => {
    setBusy(true)
    try { await resetSchema(SHOP_SCHEMA, 'shop'); setPlan(await explain(code.replace(/;\s*$/, ''))) } finally { setBusy(false) }
  }
  const resetDb = async () => { setBusy(true); try { await resetSchema(SHOP_SCHEMA, 'shop', true); setOut({ ok: true, results: [], note: '資料庫已重設為初始資料。' }) } finally { setBusy(false) } }

  return (
    <div className="fade-swap">
      <header className="masthead" style={{ paddingBottom: 18 }}>
        <p className="kicker">PLAYGROUND · 自由練習</p>
        <h1 className="display">Playground</h1>
        <p className="lede">程式碼在瀏覽器裡執行，不會送到伺服器。</p>
      </header>

      <div className="tabs" role="tablist" aria-label="語言">
        {LANGS.map((l) => (
          <button key={l.id} role="tab" aria-selected={lang === l.id} className={lang === l.id ? 'on' : ''} onClick={() => setLang(l.id)}>{l.label}</button>
        ))}
        <span className="spacer" />
        <RuntimeStatus kind={lang} />
      </div>

      <div className="pg-layout">
        <div className="pg-editor">
          <div className="pg-toolbar">
            <button className="btn small" onClick={run} disabled={busy}>{busy ? '執行中…' : '▶ 執行'}<kbd>⌘/Ctrl + Enter</kbd></button>
            {lang === 'sql' && <button className="btn ghost small" onClick={doExplain} disabled={busy}>EXPLAIN</button>}
            {lang === 'sql' && <button className="btn ghost small" onClick={resetDb} disabled={busy}>重設資料庫</button>}
            <span className="spacer" />
            <label className="pg-sample">
              範例
              <select value="" onChange={(e) => { const s = SAMPLES[lang][Number(e.target.value)]; if (s) { setCode(s.code); setOut(null); setPlan(null); if (isFrame) setPreview((p) => ({ key: p.key + 1, code: s.code })) } }}>
                <option value="">載入範例…</option>
                {SAMPLES[lang].map((s, i) => <option key={i} value={i}>{s.label}</option>)}
              </select>
            </label>
          </div>
          <CodeEditor value={code} onChange={setCode} lang={lang} onRun={run} minHeight={320} />
          {lang === 'sql' && (
            <details className="pg-schema">
              <summary>範例資料表</summary>
              <ul>{SHOP_TABLES.map((t) => <li key={t.name}><b>{t.name}</b><span>{t.cols}</span></li>)}</ul>
            </details>
          )}
        </div>

        {isFrame ? (
        <div className="pg-output pg-frame">
          <div className="pg-api" role="group" aria-label="假 API">
            <span className="kicker">假 API</span>
            <label>延遲 <input type="range" min="0" max="3000" step="100" value={latency} onChange={(e) => setLatency(Number(e.target.value))} /> <span className="mono">{latency} ms</span></label>
            <label>錯誤率 <input type="range" min="0" max="100" step="10" value={errorRate} onChange={(e) => setErrorRate(Number(e.target.value))} /> <span className="mono">{errorRate}%</span></label>
          </div>
          <FramePreview kind={lang} code={preview.code} runKey={preview.key} setup={`api.latency = ${latency}; api.errorRate = ${errorRate / 100};`} height={360} />
        </div>
        ) : (
        <div className="pg-output">
          <p className="kicker">輸出</p>
          {!out && !plan && <p className="out-empty">按「執行」看結果。{lang === 'python' ? '第一次會下載 Python 執行環境（約 13 MB）。' : lang === 'sql' ? '第一次會下載 PostgreSQL 執行環境（約 16 MB）。' : ''}</p>}
          {out && lang !== 'sql' && <ConsoleOut output={out.output} error={out.error} />}
          {out && lang === 'sql' && (
            <div className="lab-stack">
              {out.note && <p className="out-empty">{out.note}</p>}
              {out.error && <pre className="out-pre out-err">{out.error}</pre>}
              {out.results?.map((r, i) => <ResultTable key={i} result={r} caption={out.results.length > 1 ? `第 ${i + 1} 句` : undefined} />)}
              {out.ok && out.ms !== undefined && <p className="muted" style={{ fontSize: '0.75rem' }}>{out.ms.toFixed(1)} ms</p>}
            </div>
          )}
          {plan && (plan.ok ? <><p className="kicker" style={{ marginTop: 12 }}>查詢計畫</p><PlanTree plan={plan.plan} /></> : <pre className="out-pre out-err">{plan.error}</pre>)}
        </div>
        )}
      </div>
    </div>
  )
}

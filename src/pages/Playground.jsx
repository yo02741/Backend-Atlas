import React, { useCallback, useEffect, useRef, useState } from 'react'
import { decodePlaygroundCode } from '../playgroundLink.js'
import FramePreview from '../components/FramePreview.jsx'
import CodeEditor from '../components/CodeEditor.jsx'
import { ConsoleOut, ResultTable, PlanTree, RuntimeStatus } from '../components/Output.jsx'
import { TAILWIND_STYLE_RE, ELEMENT_PLUS_RE } from '../runtime/frameStatus.js'
import { runPython, ensurePython } from '../runtime/py.js'
import { runSql, resetSchema, explain, ensureSql, invalidateSchema } from '../runtime/sql.js'
import { runJs } from '../runtime/js.js'
import { SHOP_SCHEMA, SHOP_TABLES } from '../content/schemas.js'

/* Playground：像 CodePen 一樣自由打程式，Python / PostgreSQL / JavaScript 都在瀏覽器裡跑。
   HTML 與 Vue 在沙箱 iframe 裡跑（src/runtime/frame.js，第一次執行時才載入），fetch 由假 API 回應，可以調延遲與錯誤率，
   或用固定情境（成功、失敗、空資料、亂序）重播同一組回應。
   HTML 裡有 <style type="text/tailwindcss"> 時，沙箱另外載入 Tailwind CSS（@tailwindcss/browser）。
   每個模式的草稿、上次載入的範例、上次的輸出（Python、SQL、JS）存在 localStorage（atlas-playground-<lang>、-sample-、-out-），
   讀不到也照常運作。範例的行為：Python、SQL、JS 選了要按執行；HTML、Vue 選了就建立預覽。 */

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

# 型別提示只是註記：傳錯型別照樣建立，執行時不檢查
bad = User("1", 42)
print(bad, "→ id 的型別是", type(bad.id).__name__)
# 靜態檢查（mypy、pyright）會在執行前標出上一行；要在執行時擋下，得自己檢查或用 pydantic 之類的驗證套件
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

    t0 = time.time()
    for i in range(5):
        await fetch(i, 0.3)         # 串行：等完一個才開始下一個
    print(f"同樣 5 個改成一個一個等：{time.time() - t0:.2f} 秒")

await main()
` },
    { label: 'JWT 簽章與驗證（hmac）', code: `import base64, hmac, hashlib, json

def b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()

def b64url_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))

def compact(obj: dict) -> str:
    return b64url(json.dumps(obj, separators=(",", ":")).encode())

def sign(payload: dict, secret: bytes) -> str:
    signing_input = compact({"alg": "HS256", "typ": "JWT"}) + "." + compact(payload)
    sig = b64url(hmac.new(secret, signing_input.encode(), hashlib.sha256).digest())
    return signing_input + "." + sig

def verify(token: str, secret: bytes) -> dict:
    header, body, sig = token.split(".")
    if json.loads(b64url_decode(header)).get("alg") != "HS256":
        raise ValueError("alg 不是 HS256")
    expected = b64url(hmac.new(secret, f"{header}.{body}".encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, expected):     # 固定時間比較，不用 ==
        raise ValueError("簽章不符")
    return json.loads(b64url_decode(body))

secret = b"dev-secret"
token = sign({"sub": "user_42", "role": "user"}, secret)
print(token)

# 驗證端：原 token 通過；payload 被改、或用別把 secret 驗，都要拒絕
header, _, sig = token.split(".")
forged = header + "." + compact({"sub": "user_42", "role": "admin"}) + "." + sig
for name, t, key in [("原 token", token, secret), ("payload 改成 admin", forged, secret), ("換一把 secret", token, b"other-secret")]:
    try:
        print(f"{name}：通過，payload = {verify(t, key)}")
    except ValueError as e:
        print(f"{name}：拒絕（{e}）")
# 這裡只驗簽章；正式的驗證端還要檢查 exp、iss、aud
` },
    { label: '密碼雜湊（PBKDF2）', code: `import hashlib, hmac, os, time

def pbkdf2_sha256(password: bytes, salt: bytes, iterations: int) -> bytes:
    # 純 Python 版（這裡的 Python 沒有 OpenSSL，hashlib.pbkdf2_hmac 不能用）；正式環境用 argon2 / bcrypt
    mac = hmac.new(password, None, hashlib.sha256)
    def prf(msg):
        m = mac.copy(); m.update(msg); return m.digest()
    u = prf(salt + (1).to_bytes(4, "big"))
    t = int.from_bytes(u, "big")
    for _ in range(iterations - 1):
        u = prf(u); t ^= int.from_bytes(u, "big")
    return t.to_bytes(32, "big")

ITERATIONS = 20_000
salt = os.urandom(16)
digest = pbkdf2_sha256(b"hunter2", salt, ITERATIONS)
print("salt   :", salt.hex())
print("digest :", digest.hex())

# 本機量測：同一組參數跑 3 次
times = []
for _ in range(3):
    t0 = time.perf_counter()
    pbkdf2_sha256(b"hunter2", salt, ITERATIONS)
    times.append(1000 * (time.perf_counter() - t0))
print(f"參數：PBKDF2-HMAC-SHA256，{ITERATIONS} 次迭代，salt 16 bytes，輸出 32 bytes")
print("環境：這個分頁裡的 Pyodide，純 Python 實作，單執行緒")
print(f"3 次耗時：{min(times):.0f}–{max(times):.0f} ms")
# 這只是這台機器、這個實作的時間，換不成攻擊者每秒能猜幾次（攻擊者用 GPU 與最佳化的實作）。
# 正式環境的迭代次數，在自己的伺服器上量測後決定。
` },
  ],
  sql: [
    { label: 'LEFT JOIN：每人訂單數', code: `-- 先預測：沒下單的人，orders 與 total 各是多少？把 COUNT(o.id) 換成 COUNT(*) 又會是多少？
SELECT u.name, COUNT(o.id) AS orders, COALESCE(SUM(o.amount), 0) AS total
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
GROUP BY u.id, u.name
ORDER BY total DESC;` },
    { label: 'anti-join：沒下單的人', code: `-- 結果是哪些人有保證；沒寫 ORDER BY 時，列的順序沒有保證（要固定就加 ORDER BY u.name）
SELECT u.name
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE o.id IS NULL;` },
    { label: '視窗函數：每人最新一筆', code: `-- Carol 有兩筆同一時間的訂單（原本的 104 與這裡加的 107）。只用 created_at 排序時，哪筆排第一沒有保證，
-- 所以 ORDER BY 加上決勝鍵 o.id DESC：時間相同時取 id 大的那筆。拿掉 o.id DESC 再跑，結果可能不同，而且不會報錯。
BEGIN;
INSERT INTO orders (id, user_id, status, amount, created_at) VALUES (107, 3, 'paid', 890, '2026-03-08 20:00+08');
SELECT name, order_id, created_at
FROM (
  SELECT u.name, o.id AS order_id, o.created_at,
         ROW_NUMBER() OVER (PARTITION BY u.id ORDER BY o.created_at DESC, o.id DESC) AS rn
  FROM users u JOIN orders o ON o.user_id = u.id
) t
WHERE rn = 1
ORDER BY name;
ROLLBACK;  -- 107 只在這次示範裡存在` },
    { label: 'EXPLAIN：有索引仍可能掃表', code: `-- 整段在交易裡，最後 ROLLBACK 把索引與灌入的資料一起還原，所以可以重跑。
-- 中途出錯或拿掉了 ROLLBACK，先按「重設資料庫」再跑。
BEGIN;

-- 1) 沒有索引：Seq Scan
EXPLAIN SELECT * FROM orders WHERE user_id = 2;

-- 2) 建索引後：orders 只有 6 列，planner 多半仍選 Seq Scan（整張表一頁就讀完，比走索引便宜）
CREATE INDEX idx_orders_user ON orders(user_id);
EXPLAIN SELECT * FROM orders WHERE user_id = 2;

-- 3) 灌入 5 萬列、ANALYZE 更新統計後：user_id = 2 只占極少數，改走索引（Index Scan 或 Bitmap Index Scan）
INSERT INTO orders (id, user_id, status, amount, created_at)
SELECT 1000 + g, 10 + g % 5000, 'paid', 100, '2026-04-01'::timestamptz + g * interval '1 minute'
FROM generate_series(1, 50000) AS g;
ANALYZE orders;
EXPLAIN SELECT * FROM orders WHERE user_id = 2;

ROLLBACK;` },
    { label: '交易：扣庫存不能負', code: `BEGIN;
-- 耳機（id 4）庫存 0：條件 stock > 0 不成立，RETURNING 回 0 列 → 應用層要判斷「沒扣到」
UPDATE products SET stock = stock - 1 WHERE id = 4 AND stock > 0 RETURNING id, stock AS 扣完庫存;
-- 螢幕（id 3）庫存 3：扣到 1 列
UPDATE products SET stock = stock - 1 WHERE id = 3 AND stock > 0 RETURNING id, stock AS 扣完庫存;
SELECT id, name, stock FROM products WHERE id IN (3, 4) ORDER BY id;
ROLLBACK;  -- 還原，重跑結果相同` },
  ],
  js: [
    { label: 'fetch 風格的 Promise', code: `const fakeDb = (id) => new Promise((res) => setTimeout(() => res({ id, name: 'user' + id }), 100))

const t0 = Date.now()
const users = await Promise.all([1, 2, 3].map(fakeDb))
console.log(users)
console.log('三個 100ms 的查詢一起等：', Date.now() - t0, 'ms')

// 其中一筆失敗：Promise.all 整組 reject，拿不到另外兩筆；Promise.allSettled 逐筆回報
const flaky = (id) => (id === 2 ? Promise.reject(new Error('user2 查詢失敗')) : fakeDb(id))
try { await Promise.all([1, 2, 3].map(flaky)) } catch (e) { console.log('Promise.all：', e.message) }
const settled = await Promise.allSettled([1, 2, 3].map(flaky))
console.log('Promise.allSettled：', settled.map((r) => (r.status === 'fulfilled' ? r.value.name : r.reason.message)))
` },
    { label: 'LRU cache', code: `class LRU {
  constructor(cap) { this.cap = cap; this.map = new Map() }   // Map 照插入順序，最前面是最久沒用的
  get(k) {
    if (!this.map.has(k)) return undefined
    const v = this.map.get(k); this.map.delete(k); this.map.set(k, v); return v   // 讀到就移到最後
  }
  set(k, v) {
    if (this.map.has(k)) this.map.delete(k)
    else if (this.map.size >= this.cap) {
      const oldest = this.map.keys().next().value
      this.map.delete(oldest)
      console.log(\`  淘汰 \${oldest}：已滿 \${this.cap} 筆，它最久沒被讀寫\`)
    }
    this.map.set(k, v)
  }
}
const c = new LRU(2)
const step = (label, fn) => { fn(); console.log(label.padEnd(9), '舊 → 新：', [...c.map.keys()].join(' → ')) }
step("set('a')", () => c.set('a', 1))
step("set('b')", () => c.set('b', 2))
step("get('a')", () => c.get('a'))
step("set('c')", () => c.set('c', 3))
// 先預測再加兩步：get('a')、set('d', 4) 之後留下哪兩個？淘汰的是誰？
` },
  ],
}

SAMPLES.html = [
  { label: '表單與 Console', code: `<!-- 只用鍵盤驗收：Tab 到姓名 → 輸入 → Enter 送出，狀態區出現「已送出」；姓名空白時按 Enter，瀏覽器擋下並提示必填 -->
<main>
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
  { label: 'fetch 假 API：門診時段', code: `<!-- 假 API 的固定情境：「失敗」第 1 次回 503，按重試會成功；「空資料」沒有門診；錯誤率拉到 100% 則每次都失敗 -->
<ul id="list"><li>載入中…</li></ul>
<button id="retry" type="button" hidden>重試</button>

<script type="module">
  // 假 API 內建門診系統的路由：GET /api/sessions、POST /api/sessions/:id/appointments…
  const list = document.getElementById('list')
  const retry = document.getElementById('retry')
  async function load() {
    list.innerHTML = '<li>載入中…</li>'
    retry.hidden = true
    const res = await fetch('/api/sessions')
    if (!res.ok) {
      const problem = await res.json()   // 錯誤 body 是 Problem Details
      list.innerHTML = '<li>讀取失敗：' + problem.title + '</li>'
      retry.hidden = false
      return
    }
    const sessions = await res.json()
    list.innerHTML = sessions.length
      ? sessions.map((s) => '<li>' + s.session_date + ' ' + s.period + '，剩 ' + s.remaining + ' 位</li>').join('')
      : '<li>沒有門診</li>'
  }
  retry.addEventListener('click', load)
  load()
</script>
` },
  { label: 'Flexbox：卡片換行', code: `<!-- 預覽寬度切 390、768 看換行；再把「診間 3」改成很長的名稱，看那張卡怎麼撐開 -->
<div class="cards">
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
  { label: 'Tailwind CSS：叫號卡片', code: `<!-- 有 <style type="text/tailwindcss"> 時，沙箱載入 Tailwind CSS（@tailwindcss/browser），在瀏覽器裡掃 class 產生 CSS -->
<!-- 驗收：390、768、1280 與暗色下看文字對比；用 Tab 移到兩個按鈕，焦點框要看得到 -->
<style type="text/tailwindcss">
  @theme {
    --color-clinic: #2f6fd6;
    --color-clinic-strong: #1f4fa8;
  }
  /* dark: 改成看 data-theme，不看系統設定 */
  @custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));
</style>

<main class="mx-auto max-w-4xl p-4 dark:bg-gray-900 dark:text-white" id="page">
  <header class="mb-4 flex items-center justify-between">
    <h1 class="text-xl font-bold">今日叫號</h1>
    <button id="theme" type="button" class="rounded-md border px-3 py-1">切換暗色</button>
  </header>
  <!-- 手機一欄，md:（48rem）起兩欄 -->
  <ul class="grid gap-3 md:grid-cols-2">
    <li class="rounded-lg border p-4"><b>101 診</b> 家醫科・目前 12 號</li>
    <li class="rounded-lg border p-4"><b>102 診</b> 小兒科・目前 8 號</li>
  </ul>
  <button type="button" class="mt-4 h-11 rounded-md bg-clinic px-4 text-white hover:bg-clinic-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clinic disabled:opacity-50">叫下一號</button>
</main>

<script>
  document.getElementById('theme').addEventListener('click', () => {
    const page = document.getElementById('page')
    page.dataset.theme = page.dataset.theme === 'dark' ? 'light' : 'dark'
  })
</script>
` },
]
SAMPLES.vue = [
  { label: '計數器（ref）', code: `import { createApp, ref, computed } from 'vue'

// 先預測：按到第幾下，標籤會變成「候診人數偏多」？再按按鈕驗證 computed 跟著 count 重算
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

// 假 API 的固定情境每次重播同一組回應，不靠錯誤率：
//   成功 → 門診清單；空資料 → 沒有門診；失敗 → 第 1 次 503 顯示錯誤，按「重試」成功；亂序 → 清單倒序
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

// 驗收：101 叫兩號 → 切到 102 → 回 101。叫號數存在 store（還在），診間來自路由參數（跟著換）

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
  { label: '故意寫錯：直接改 props', code: `import { createApp } from 'vue'

// 故意寫錯的範例。按「候診 3」後數字不會變，Console 出現：
//   [Vue warn]: Attempting to mutate prop "count". Props are readonly.
// 修法：子元件 $emit('increment')，父元件改自己的 ref（<Badge :count="n" @increment="n++" />）；改完再按一次，Console 應該是乾淨的
const Badge = {
  props: { count: Number },
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
const LANG_LABEL = Object.fromEntries(LANGS.map((l) => [l.id, l.label]))
const SCENARIOS = [
  { id: 'success', label: '成功', title: '照常回應' },
  { id: 'fail', label: '失敗', title: '每個路徑第 1 次回 503，重試會成功' },
  { id: 'empty', label: '空資料', title: '成功的 GET 回空清單' },
  { id: 'shuffle', label: '亂序', title: '較早的請求較晚回，清單倒序' },
]

// localStorage：讀寫都可能丟例外（私密視窗、封鎖網站資料），失敗就當成沒有
const store = {
  get(k) { try { return localStorage.getItem(k) } catch { return null } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch { /* ignore */ } },
}
const KEY = { draft: (l) => `atlas-playground-${l}`, sample: (l) => `atlas-playground-sample-${l}`, out: (l) => `atlas-playground-out-${l}` }
const MAX_SAVED_OUT = 200_000
function loadSampleIdx(l) { const i = Number(store.get(KEY.sample(l))); return Number.isInteger(i) && SAMPLES[l][i] ? i : 0 }
function loadOut(l) {
  try { const v = JSON.parse(store.get(KEY.out(l)) || 'null'); return v && (v.out || v.plan) ? v : null } catch { return null }
}
function saveOut(l, out, plan) {
  if (!out && !plan) { store.set(KEY.out(l), null); return }
  let s
  try { s = JSON.stringify({ out, plan, at: Date.now() }, (k, v) => (typeof v === 'bigint' ? String(v) : v)) } catch { return }
  store.set(KEY.out(l), s.length <= MAX_SAVED_OUT ? s : null)
}
/* 每一句 SQL 的第一個關鍵字（略過註解與字串）。PGlite 對 BEGIN、ROLLBACK、ANALYZE 這類句子會沿用上一句的影響列數，
   所以只有 INSERT、UPDATE、DELETE、MERGE（與 WITH 開頭的句子）顯示「影響 N 列」；句數對不上時不改 */
function sqlStatementKinds(sql) {
  const kinds = []
  let cur = '', i = 0
  const flush = () => { const w = /^\s*([A-Za-z]+)/.exec(cur); if (w) kinds.push(w[1].toUpperCase()); cur = '' }
  while (i < sql.length) {
    const c = sql[i], two = sql.slice(i, i + 2)
    if (two === '--') { const j = sql.indexOf('\n', i); i = j < 0 ? sql.length : j; continue }
    if (two === '/*') { const j = sql.indexOf('*/', i + 2); i = j < 0 ? sql.length : j + 2; continue }
    if (c === "'" || c === '"') { const j = sql.indexOf(c, i + 1); cur += 'x'; i = j < 0 ? sql.length : j + 1; continue }
    if (c === '$') { const m = /^\$\w*\$/.exec(sql.slice(i)); if (m) { const j = sql.indexOf(m[0], i + m[0].length); cur += 'x'; i = j < 0 ? sql.length : j + m[0].length; continue } }
    if (c === ';') { flush(); i++; continue }
    cur += c; i++
  }
  flush()
  return kinds
}
const DML = ['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'WITH']
function labelSqlResults(sql, r) {
  if (!r?.results?.length) return r
  const kinds = sqlStatementKinds(sql)
  if (kinds.length !== r.results.length) return r
  return { ...r, results: r.results.map((x, i) => (DML.includes(kinds[i]) || x.fields.length ? x : { ...x, affectedRows: 0 })) }
}
const firstLine = (s) => String(s || '').split('\n').find((l) => l.trim()) || ''
const timeText = (at) => { try { return new Date(at).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

export default function Playground({ initialLang = 'python', initialCode = '' }) {
  const startLang = LANGS.some((l) => l.id === initialLang) ? initialLang : 'python'
  const [lang, setLang] = useState(startLang)
  // 從課程的「在 Playground 開啟」進來：載入那段程式碼；使用者改過之前不覆蓋原本的草稿
  const linked = useRef(decodePlaygroundCode(initialCode))
  // 課程範例假設資料庫是初始狀態：之前在 Playground 建的表或改的資料不能留著
  useEffect(() => { if (linked.current != null) invalidateSchema() }, [])
  const initial = useRef(null)
  if (!initial.current) {
    const draft = store.get(KEY.draft(startLang))
    const idx = loadSampleIdx(startLang)
    const saved = linked.current == null ? loadOut(startLang) : null
    initial.current = {
      code: linked.current ?? draft ?? SAMPLES[startLang][idx].code, idx, saved,
      activity: linked.current != null ? { tone: 'info', text: '已載入課程的程式碼' }
        : draft != null || saved ? { tone: 'info', text: `已載回上次的${saved ? '程式與輸出' : '草稿'}${saved ? `（${timeText(saved.at)}）` : ''}` } : null,
    }
  }
  const [code, setCode] = useState(initial.current.code)
  const [sampleIdx, setSampleIdx] = useState(initial.current.idx)
  const [out, setOut] = useState(initial.current.saved?.out ?? null)
  const [plan, setPlan] = useState(initial.current.saved?.plan ?? null)
  const [busy, setBusy] = useState(false)
  const isFrame = FRAME_LANGS.includes(lang)
  const [preview, setPreview] = useState({ key: 0, code: '' })
  const [latency, setLatency] = useState(300)
  const [errorRate, setErrorRate] = useState(0)
  const [scenario, setScenario] = useState(null)
  const [undo, setUndo] = useState(null)        // { prev, out, plan, applied, text }：載入範例前的草稿
  const [activity, setActivity] = useState(initial.current.activity)
  const [alertText, setAlertText] = useState('')
  const alertTimer = useRef(0)
  const resultRef = useRef(null)
  const tabRefs = useRef({})

  const say = (tone, text) => setActivity({ tone, text })
  // 錯誤念出來：同一段文字連續出現兩次也要念，先清空再填
  const announceError = useCallback((msg) => {
    clearTimeout(alertTimer.current)
    setAlertText('')
    alertTimer.current = setTimeout(() => setAlertText(msg), 60)
  }, [])
  useEffect(() => () => clearTimeout(alertTimer.current), [])

  const sample = SAMPLES[lang][sampleIdx] || SAMPLES[lang][0]
  const isSample = code === sample.code
  // 草稿：和目前的範例一樣就不存（重新整理時回到那個範例）
  useEffect(() => {
    if (linked.current !== null && code === linked.current) return
    linked.current = null
    store.set(KEY.draft(lang), code === (SAMPLES[lang][sampleIdx] || SAMPLES[lang][0]).code ? null : code)
  }, [lang, code, sampleIdx])
  useEffect(() => { store.set(KEY.sample(lang), String(sampleIdx)) }, [lang, sampleIdx])
  useEffect(() => { if (!isFrame && !(linked.current !== null && !out && !plan)) saveOut(lang, out, plan) }, [lang, out, plan, isFrame])
  // 進頁就預載執行環境，按下執行時已經好了
  useEffect(() => { if (lang === 'python') ensurePython(); if (lang === 'sql') ensureSql().catch(() => {}) }, [lang])

  function switchLang(id, focus = false) {
    if (id === lang || !SAMPLES[id]) return
    linked.current = null
    const draft = store.get(KEY.draft(id))
    const idx = loadSampleIdx(id)
    const saved = FRAME_LANGS.includes(id) ? null : loadOut(id)
    setLang(id); setSampleIdx(idx); setCode(draft ?? SAMPLES[id][idx].code)
    setOut(saved?.out ?? null); setPlan(saved?.plan ?? null)
    setPreview({ key: 0, code: '' }); setUndo(null); setScenario(null)
    say('info', `已切到 ${LANG_LABEL[id]}：${draft != null ? (saved ? '載回上次的程式與輸出' : '載回上次的草稿') : `範例「${SAMPLES[id][idx].label}」`}`)
    // 重新整理時留在這個模式（replaceState 不觸發 hashchange，頁面不重建）
    try { window.history.replaceState(null, '', `#/playground?lang=${id}`) } catch { /* ignore */ }
    if (focus) setTimeout(() => tabRefs.current[id]?.focus(), 0)
  }
  function onTabKey(e) {
    const i = LANGS.findIndex((l) => l.id === lang)
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: LANGS.length - 1 }[e.key]
    if (to === undefined) return
    e.preventDefault()
    switchLang(LANGS[(to + LANGS.length) % LANGS.length].id, true)
  }

  // 載入範例（或重設成範例）：蓋掉草稿時留下復原
  function applySample(i, verb = '已載入範例') {
    const s = SAMPLES[lang][i]
    if (!s) return
    const chained = undo && code === undo.applied   // 連續換範例：復原回到最早的草稿
    const prev = chained ? undo : { prev: code, out, plan }
    const lost = !SAMPLES[lang].some((x) => x.code === prev.prev)
    setCode(s.code); setSampleIdx(i); setOut(null); setPlan(null)
    setUndo(lost && prev.prev !== s.code ? { prev: prev.prev, out: prev.out, plan: prev.plan, applied: s.code, text: `${verb}「${s.label}」` } : null)
    if (isFrame) { setPreview((p) => ({ key: p.key + 1, code: s.code })); say('busy', `${verb}「${s.label}」，建立預覽中…`) }
    else say('info', `${verb}「${s.label}」，按「執行」看結果`)
  }
  function doUndo() {
    if (!undo) return
    setCode(undo.prev); setOut(undo.out); setPlan(undo.plan); setUndo(null)
    if (isFrame) setPreview((p) => ({ key: p.key + 1, code: undo.prev }))
    say('info', '已復原成原本的程式')
  }

  const run = useCallback(async () => {
    if (busy) return
    if (isFrame) { setPreview((p) => ({ key: p.key + 1, code })); return }
    setBusy(true); setPlan(null); setUndo(null)
    setActivity({ tone: 'busy', text: '執行中…' })
    let r
    try {
      if (lang === 'python') r = await runPython(code)
      else if (lang === 'js') r = await runJs(code)
      else {
        await resetSchema(SHOP_SCHEMA, 'shop')
        r = labelSqlResults(code, await runSql(code))
        // 交易中途出錯會留下 aborted 的交易，下一次執行全部失敗：收掉它（沒有交易時只是警告）
        if (!r.ok) await runSql('ROLLBACK')
      }
    } catch (err) {
      r = { ok: false, error: String(err?.message || err), output: '' }
    } finally { setBusy(false) }
    setOut(r)
    if (r.error) {
      setActivity({ tone: 'error', text: `執行出錯：${firstLine(r.error)}` })
      announceError(`執行出錯：${firstLine(r.error)}`)
    } else {
      const extra = lang === 'sql' ? `，${r.results?.length || 0} 句` : ''
      setActivity({ tone: 'ok', text: `執行完成${typeof r.ms === 'number' ? `（${r.ms.toFixed(0)} ms）` : ''}${extra}` })
    }
  }, [lang, code, busy, isFrame, announceError])

  const onPreviewStatus = useCallback(({ state, errors, warns, lastError, runKey }) => {
    if (!runKey) return
    if (state === 'loading') setActivity((a) => (a?.tone === 'busy' ? a : { tone: 'busy', text: '建立預覽中…' }))
    else if (state === 'error') { setActivity({ tone: 'error', text: '預覽載入失敗' }); announceError('預覽載入失敗') }
    else if (state === 'ready') {
      if (errors) { setActivity({ tone: 'error', text: `預覽就緒，Console 有 ${errors} 個錯誤` }); announceError(`Console 錯誤：${firstLine(lastError)}`) }
      else setActivity({ tone: 'ok', text: warns ? `預覽就緒，Console 有 ${warns} 個警告` : '預覽就緒' })
    }
  }, [announceError])

  const doExplain = async () => {
    setBusy(true); setActivity({ tone: 'busy', text: '取得查詢計畫…' })
    let p
    try { await resetSchema(SHOP_SCHEMA, 'shop'); p = await explain(code.replace(/;\s*$/, '')) } finally { setBusy(false) }
    setPlan(p)
    if (p.ok) setActivity({ tone: 'ok', text: '查詢計畫完成' })
    else { setActivity({ tone: 'error', text: `EXPLAIN 出錯：${firstLine(p.error)}` }); announceError(`EXPLAIN 出錯：${firstLine(p.error)}`) }
  }
  const resetDb = async () => {
    setBusy(true)
    try { await resetSchema(SHOP_SCHEMA, 'shop', true); setOut({ ok: true, results: [], note: '資料庫已重設為初始資料。' }); setPlan(null) } finally { setBusy(false) }
    setActivity({ tone: 'ok', text: '資料庫已重設' })
  }
  const replay = (id) => {
    setScenario(id)
    setPreview((p) => ({ key: p.key + 1, code }))
    setActivity({ tone: 'busy', text: id ? `重播「${SCENARIOS.find((s) => s.id === id).label}」情境…` : '建立預覽中…' })
  }
  const setup = `api.latency = ${latency}; api.errorRate = ${scenario ? 0 : errorRate / 100};${scenario ? ` api.scenario = '${scenario}';` : ''}`
  const showUndo = undo && code === undo.applied

  return (
    <div className="fade-swap pg">
      <header className="masthead" style={{ paddingBottom: 18 }}>
        <p className="kicker">PLAYGROUND · 自由練習</p>
        <h1 className="display">Playground</h1>
        <p className="lede">程式碼在瀏覽器裡執行，不會送到伺服器。</p>
      </header>

      <div className="tabs" role="tablist" aria-label="語言" onKeyDown={onTabKey}>
        {LANGS.map((l) => (
          <button key={l.id} id={`pg-tab-${l.id}`} ref={(el) => { tabRefs.current[l.id] = el }} role="tab" type="button"
            aria-selected={lang === l.id} aria-controls="pg-panel" tabIndex={lang === l.id ? 0 : -1}
            className={lang === l.id ? 'on' : ''} onClick={() => switchLang(l.id)}>{l.label}</button>
        ))}
      </div>
      <div className="pg-statusbar" role="status" aria-live="polite">
        <RuntimeStatus kind={lang} tailwind={lang === 'html' && TAILWIND_STYLE_RE.test(code)} elementPlus={ELEMENT_PLUS_RE.test(code)} activity={activity} />
      </div>
      <p className="pg-sr" aria-live="assertive" aria-atomic="true">{alertText}</p>

      <div className="pg-layout" id="pg-panel" role="tabpanel" aria-labelledby={`pg-tab-${lang}`}>
        <div className="pg-editor">
          <div className="pg-toolbar">
            <button type="button" className="btn small" onClick={run} disabled={busy}>{busy ? '執行中…' : '▶ 執行'}<kbd>⌘/Ctrl + Enter</kbd></button>
            {lang === 'sql' && <button type="button" className="btn ghost small" onClick={doExplain} disabled={busy}>EXPLAIN</button>}
            {lang === 'sql' && <button type="button" className="btn ghost small" onClick={resetDb} disabled={busy}>重設資料庫</button>}
            <button type="button" className="btn ghost small" onClick={() => resultRef.current?.focus()}>跳到結果</button>
            <span className="spacer" />
            <label className="pg-sample">
              範例
              <select value={isSample ? String(sampleIdx) : ''} aria-describedby="pg-sample-note" onChange={(e) => { if (e.target.value !== '') applySample(Number(e.target.value)) }}>
                <option value="">{isSample ? '載入範例…' : '（已修改）載入範例…'}</option>
                {SAMPLES[lang].map((s, i) => <option key={i} value={i}>{s.label}</option>)}
              </select>
            </label>
            <span className="pg-sample-note" id="pg-sample-note">{isFrame ? '選了就建立預覽' : '選了再按「執行」'}</span>
            {!isSample && <button type="button" className="btn ghost small" onClick={() => applySample(sampleIdx, '已重設成範例')}>重設成範例</button>}
          </div>
          {showUndo && (
            <p className="pg-undo">{undo.text}，原本的程式已被取代 <button type="button" className="btn ghost small" onClick={doUndo}>復原</button></p>
          )}
          <CodeEditor value={code} onChange={setCode} lang={lang} onRun={run} minHeight={320} ariaLabel={`${LANG_LABEL[lang]} 程式碼`} describedBy="pg-editor-keys" />
          <p className="pg-keys" id="pg-editor-keys">編輯器裡 Tab 是縮排：先按 <kbd>Esc</kbd> 再按 <kbd>Tab</kbd> 離開編輯器</p>
          {lang === 'sql' && (
            <details className="pg-schema">
              <summary>範例資料表</summary>
              <ul>{SHOP_TABLES.map((t) => <li key={t.name}><b>{t.name}</b><span>{t.cols}</span></li>)}</ul>
            </details>
          )}
        </div>

        {isFrame ? (
        <div className="pg-output pg-frame" ref={resultRef} tabIndex={-1} aria-label="預覽與 Console">
          <div className="pg-api" role="group" aria-label="假 API">
            <span className="kicker">假 API</span>
            <label>延遲 <input type="range" min="0" max="3000" step="100" value={latency} onChange={(e) => setLatency(Number(e.target.value))} /> <span className="mono">{latency} ms</span></label>
            <label title={scenario ? '固定情境不套用錯誤率' : undefined}>錯誤率 <input type="range" min="0" max="100" step="10" value={errorRate} disabled={!!scenario} onChange={(e) => setErrorRate(Number(e.target.value))} /> <span className="mono">{scenario ? '—' : `${errorRate}%`}</span></label>
          </div>
          <div className="pg-scen" role="group" aria-label="固定情境（重播同一組回應）">
            <span className="pg-scen-label">固定情境</span>
            {SCENARIOS.map((s) => (
              <button key={s.id} type="button" className={`chip${scenario === s.id ? ' on' : ''}`} aria-pressed={scenario === s.id} title={s.title} onClick={() => replay(s.id)}>{s.label}</button>
            ))}
            {scenario && <button type="button" className="chip pg-scen-off" onClick={() => replay(null)}>改回滑桿</button>}
          </div>
          <FramePreview key={lang} kind={lang} code={preview.code} runKey={preview.key} setup={setup} height={360} onStatus={onPreviewStatus} />
        </div>
        ) : (
        <div className="pg-output" ref={resultRef} tabIndex={-1} aria-labelledby="pg-out-title">
          <p className="kicker" id="pg-out-title">輸出</p>
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

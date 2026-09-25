import React, { useCallback, useEffect, useState } from 'react'
import CodeEditor from '../components/CodeEditor.jsx'
import { ConsoleOut, ResultTable, PlanTree, RuntimeStatus } from '../components/Output.jsx'
import { runPython, ensurePython } from '../runtime/py.js'
import { runSql, resetSchema, explain, ensureSql } from '../runtime/sql.js'
import { runJs } from '../runtime/js.js'
import { SHOP_SCHEMA, SHOP_TABLES } from '../content/schemas.js'

/* Playground：像 CodePen 一樣自由打程式，Python / PostgreSQL / JavaScript 都在瀏覽器裡跑。 */

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

const LANGS = [
  { id: 'python', label: 'Python' },
  { id: 'sql', label: 'PostgreSQL' },
  { id: 'js', label: 'JavaScript' },
]

function loadDraft(lang) { try { return localStorage.getItem(`atlas-playground-${lang}`) } catch { return null } }
function saveDraft(lang, code) { try { localStorage.setItem(`atlas-playground-${lang}`, code) } catch { /* ignore */ } }

export default function Playground({ initialLang = 'python' }) {
  const [lang, setLang] = useState(LANGS.some((l) => l.id === initialLang) ? initialLang : 'python')
  const [code, setCode] = useState(() => loadDraft(lang) ?? SAMPLES[lang][0].code)
  const [out, setOut] = useState(null)
  const [busy, setBusy] = useState(false)
  const [plan, setPlan] = useState(null)

  useEffect(() => { setCode(loadDraft(lang) ?? SAMPLES[lang][0].code); setOut(null); setPlan(null) }, [lang])
  useEffect(() => { saveDraft(lang, code) }, [lang, code])
  // 進頁就預載執行環境，按下執行時已經好了
  useEffect(() => { if (lang === 'python') ensurePython(); if (lang === 'sql') ensureSql().catch(() => {}) }, [lang])

  const run = useCallback(async () => {
    if (busy) return
    setBusy(true); setPlan(null)
    try {
      if (lang === 'python') setOut(await runPython(code))
      else if (lang === 'js') setOut(await runJs(code))
      else { await resetSchema(SHOP_SCHEMA, 'shop'); setOut(await runSql(code)) }
    } finally { setBusy(false) }
  }, [lang, code, busy])

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
        <p className="lede">真的 Python、真的 PostgreSQL、真的 JavaScript，全部在你的瀏覽器裡跑，不會送到任何伺服器。SQL 有一套電商範例資料可以隨便玩，改壞了按「重設資料庫」就好。</p>
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
              <select value="" onChange={(e) => { const s = SAMPLES[lang][Number(e.target.value)]; if (s) { setCode(s.code); setOut(null); setPlan(null) } }}>
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
      </div>
    </div>
  )
}

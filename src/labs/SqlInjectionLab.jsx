import React, { useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Code, Callout, Status } from './ui.jsx'

/* ============================================================
   SQL Injection：字串拼接 vs 參數化
   - 登入表單 → 組出「真的會送到資料庫」的 SQL → 用迷你 WHERE 解析器逐列評估 users 表
   - 拼接模式：輸入直接接進 SQL 文字（引號能關掉字串、-- 能註解掉後面）
   - 參數化模式：SQL 與值分開送，輸入永遠只是一個字串常值
   - 教學用途：payload 只用兩個經典範例，示範的是「為什麼要防、怎麼防」
   ============================================================ */

const USERS = [
  { id: 1, username: 'admin', password: 'Tr0ub4dor&3', role: 'admin' },
  { id: 2, username: 'alice', password: 'correct-horse', role: 'user' },
  { id: 3, username: 'bob', password: 'hunter2', role: 'user' },
  { id: 4, username: 'carol', password: 'p@ssw0rd!', role: 'user' },
]
const COLS = ['id', 'username', 'password', 'role']

const PRESETS = [
  { key: 'ok', label: '正常帳密', u: 'alice', p: 'correct-horse' },
  { key: 'or', label: "' OR '1'='1", u: 'alice', p: "' OR '1'='1" },
  { key: 'comment', label: "admin'--", u: "admin'--", p: 'whatever' },
]

/* ---- 迷你 SQL WHERE 解析器：=、AND、OR、NOT、括號、'字串'（'' 轉義）、-- 行註解 ---- */
function tokenize(src) {
  const toks = []
  let i = 0, commented = false
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === '-' && src[i + 1] === '-') { commented = true; break }
    if (c === "'") {
      let j = i + 1, v = ''
      for (;;) {
        if (j >= src.length) throw new Error('字串常值沒有結尾引號（引號不平衡）')
        if (src[j] === "'") { if (src[j + 1] === "'") { v += "'"; j += 2; continue } break }
        v += src[j++]
      }
      toks.push({ t: 'str', v }); i = j + 1; continue
    }
    if (c === '=') { toks.push({ t: '=' }); i++; continue }
    if (c === '(' || c === ')') { toks.push({ t: c }); i++; continue }
    const w = /^[A-Za-z_]\w*/.exec(src.slice(i))
    if (w) {
      const up = w[0].toUpperCase()
      if (up === 'AND' || up === 'OR' || up === 'NOT') toks.push({ t: up })
      else if (COLS.includes(w[0].toLowerCase())) toks.push({ t: 'col', v: w[0].toLowerCase() })
      else throw new Error(`沒有 "${w[0]}" 這個欄位`)
      i += w[0].length; continue
    }
    const n = /^\d+/.exec(src.slice(i))
    if (n) { toks.push({ t: 'str', v: n[0] }); i += n[0].length; continue }
    throw new Error(`看不懂的字元 "${c}"`)
  }
  return { toks, commented }
}

function compileWhere(src) {
  const { toks, commented } = tokenize(src)
  let i = 0
  const at = (t) => toks[i]?.t === t
  const expr = () => { let l = term(); while (at('OR')) { i++; const a = l, b = term(); l = (r) => a(r) || b(r) } return l }
  const term = () => { let l = fac(); while (at('AND')) { i++; const a = l, b = fac(); l = (r) => a(r) && b(r) } return l }
  const fac = () => {
    if (at('NOT')) { i++; const f = fac(); return (r) => !f(r) }
    if (at('(')) { i++; const e = expr(); if (!at(')')) throw new Error('缺少右括號'); i++; return e }
    const a = val(); if (!at('=')) throw new Error('預期 = 運算子'); i++; const b = val()
    return (r) => a(r) === b(r)
  }
  const val = () => {
    const tk = toks[i++]
    if (!tk) throw new Error('查詢在這裡意外結束')
    if (tk.t === 'str') return () => tk.v
    if (tk.t === 'col') return (r) => String(r[tk.v])
    throw new Error(`這裡不該出現 ${tk.t}`)
  }
  if (!toks.length) throw new Error('WHERE 後面沒有條件')
  const test = expr()
  if (i < toks.length) throw new Error('條件後面有多餘的內容')
  return { test, commented }
}

/* ---- 拼接模式的 SQL 顯示：把「來自輸入的文字」拆成 資料 / 變成程式碼 / 被註解掉 ---- */
function inputSegs(s) {
  let i = 0
  while (i < s.length) { if (s[i] === "'") { if (s[i + 1] === "'") { i += 2; continue } break } i++ }
  if (i >= s.length) return [{ k: 'input', s, from: true }]
  return [{ k: 'input', s: s.slice(0, i), from: true }, { k: 'code', s: s.slice(i), from: true }]
}
function buildSegments(u, p) {
  const segs = [
    { k: 'kw', s: 'SELECT' }, { k: 'sql', s: ' * ' }, { k: 'kw', s: 'FROM' }, { k: 'sql', s: ' users ' }, { k: 'kw', s: 'WHERE' },
    { k: 'sql', s: ' username = ' }, { k: 'str', s: "'" }, ...inputSegs(u), { k: 'str', s: "'" },
    { k: 'sql', s: ' ' }, { k: 'kw', s: 'AND' }, { k: 'sql', s: ' password = ' }, { k: 'str', s: "'" }, ...inputSegs(p), { k: 'str', s: "'" },
  ]
  // 字串外遇到 -- 之後全部變成註解（追蹤引號開關狀態，'' 轉義會開關兩次抵銷）
  const out = []
  let inside = false, dead = false
  for (const sg of segs) {
    if (dead) { out.push({ ...sg, k: 'cm' }); continue }
    let cut = -1
    for (let i = 0; i < sg.s.length; i++) {
      const c = sg.s[i]
      if (c === "'") { inside = !inside; continue }
      if (!inside && c === '-' && sg.s[i + 1] === '-') { cut = i; break }
    }
    if (cut < 0) { out.push(sg); continue }
    if (cut > 0) out.push({ ...sg, s: sg.s.slice(0, cut) })
    out.push({ ...sg, k: 'cm', s: sg.s.slice(cut) }); dead = true
  }
  return out
}

const PY = `# ✗ 字串拼接：使用者輸入直接接進 SQL 文字
sql = ("SELECT * FROM users "
       f"WHERE username = '{u}' "
       f"AND password = '{p}'")
cursor.execute(sql)

# ✓ 參數化：SQL 與值分開送，驅動程式負責處理
cursor.execute(
    "SELECT * FROM users "
    "WHERE username = %s AND password = %s",
    (u, p),
)

# ORM（SQLAlchemy）產生的查詢預設就是參數化
stmt = select(User).where(User.username == u)`
const PY_MARKS = [
  { line: 3, text: "'{u}'" }, { line: 4, text: "'{p}'" },
  { line: 10, text: 'username = %s AND password = %s', ok: true }, { line: 11, text: '(u, p)', ok: true },
  { line: 15, text: '.where(User.username == u)', ok: true },
]

const EXPLAIN = {
  concat: {
    legit: ['拼接：正常輸入時完全看不出問題', 'f-string 把 username 和 password 直接塞進 SQL 文字。alice / correct-horse 這種乖乖的輸入會組出合法查詢，功能測試全過——問題只在輸入含有引號時才浮現。', '資料庫收到的只是一串文字，它**無法分辨哪些字元來自程式碼、哪些來自使用者**。這就是漏洞的根源。'],
    none: ['帳密錯誤，但這不代表安全', '這次只是剛好沒對上。只要拼接還在，換一個含引號的輸入就能改寫查詢結構——試試上面的兩個範例 payload。'],
    tautology: ['資料變成程式碼：一個引號關掉了字串常值', "輸入的第一個 `'` 提前結束了 password 的字串，接下來的 `OR '1'='1'` 被當成 SQL 條件解析。`'1'='1'` 永遠為真，整個 WHERE 對每一列都成立。", '應用程式通常取第一列當登入者——這裡是 id=1 的 admin。攻擊者不需要知道任何密碼，只需要知道「引號沒被處理」。'],
    comment: ['-- 把後面的密碼檢查整段註解掉', "`admin'` 關掉字串之後，`--` 是 SQL 的行註解：從這裡到行尾的 `AND password = '...'` 全部被忽略。留下的查詢只剩 `username = 'admin'`，密碼根本沒被比對。", '注意：把 SQL 拆成多行不算防禦——換行位置一變，註解攻擊的效果會變，但引號攻擊照樣有效。'],
    inject: ['輸入的引號改寫了查詢結構', '輸入裡的引號讓後面的文字脫離字串常值、變成 SQL 語法的一部分。這次剛好還能解析、也剛好有匹配的列，但查詢的意義已經不是「比對這組帳密」了。'],
    error: ['查詢壞掉了：資料庫回了語法錯誤', "光是多一個 `'` 就讓查詢壞掉（引號不平衡，或後面的文字被當成欄位名）。這正是攻擊者探測注入點的第一步：在每個輸入欄位丟一個引號，看誰噴 500 或 SQL 錯誤。錯誤訊息若原樣回給使用者，還會順便洩漏資料表結構。"],
  },
  param: {
    legit: ['參數化：SQL 與資料分開送', 'alice 用正確密碼登入，行為和拼接版一樣——差別只在遇到惡意輸入時。'],
    none: ['參數化：SQL 與資料分開送', '沒有任何一列的帳密和輸入完全相同，所以 0 列匹配。'],
    blocked: ['參數化：攻擊 payload 現在只是一個怪字串', '剛才的 payload 被拿去和欄位值**精確比對**：引號、OR、`--` 都只是字串內容，0 列匹配。同一個輸入，只是換了傳遞方式，攻擊就失效。'],
  },
}
const PARAM_COMMON = '驅動程式把帶 `%s` 佔位符的 SQL 和值分開送（或在本地安全轉義）。資料庫解析 SQL 結構時參數還不存在，所以無論參數裡有引號、`--` 還是 `OR`，都只能是一個字串常值的內容。注意這裡的 `%s` 不是 Python 的字串格式化，`execute()` 的第二個引數才是值。'
const EXTRA = '同樣的概念在 NoSQL 也有：MongoDB 若直接把請求 JSON 塞進查詢，`{"password": {"$gt": ""}}` 這種運算子注入會讓條件永遠成立——要對輸入做型別檢查（只接受字串）。另外，讓應用程式連線用的資料庫帳號只有最小權限（不能 DROP、不能讀其他 schema），注入成功時災情才有限。'

export default function SqlInjectionLab() {
  const [mode, setMode] = useState('concat')
  const [u, setU] = useState('alice')
  const [p, setP] = useState("' OR '1'='1")

  const result = useMemo(() => {
    if (mode === 'param') {
      const rows = USERS.filter((r) => r.username === u && r.password === p)
      const hostile = /['"\-;]/.test(u + p)
      return { rows, kind: rows.length ? 'legit' : hostile ? 'blocked' : 'none' }
    }
    try {
      const { test, commented } = compileWhere(`username = '${u}' AND password = '${p}'`)
      const rows = USERS.filter(test)
      if (!rows.length) return { rows, kind: 'none' }
      const legit = rows.length === 1 && rows[0].username === u && rows[0].password === p
      return { rows, kind: legit ? 'legit' : commented ? 'comment' : rows.length > 1 ? 'tautology' : 'inject' }
    } catch (e) { return { rows: [], kind: 'error', error: e.message } }
  }, [mode, u, p])

  const segs = useMemo(() => buildSegments(u, p), [u, p])
  const hitIds = new Set(result.rows.map((r) => r.id))
  const first = result.rows[0]
  const [title, ...paras] = EXPLAIN[mode][result.kind]
  const isBad = ['tautology', 'comment', 'inject'].includes(result.kind)

  return (
    <Lab className="sqli" accent="red" kicker="SECURITY LAB" title="SQL Injection：字串拼接 vs 參數化"
         blurb="輸入帳密（或按範例 payload），看真正送到資料庫的 SQL 長什麼樣、哪些列會被匹配。切換模式比較：同一個輸入，拼接會讓「資料」變成「程式碼」，參數化則永遠把它當字串。">
      <LabControls>
        <Seg label="模式" tinted value={mode} onChange={setMode}
             options={[{ value: 'concat', label: '字串拼接（f-string）' }, { value: 'param', label: '參數化查詢' }]} />
        <div className="sqli-presets">
          <span className="seg-label">範例 payload</span>
          {PRESETS.map((pr) => (
            <button key={pr.key} type="button" className="btn ghost small sqli-preset" onClick={() => { setU(pr.u); setP(pr.p) }}>{pr.label}</button>
          ))}
        </div>
      </LabControls>

      <LabGrid>
        <LabStage label="登入表單、組出的 SQL 與 users 表">
          <div className="sqli-form">
            <label>username<input className="sqli-input" value={u} onChange={(e) => setU(e.target.value)} spellCheck={false} /></label>
            <label>password<input className="sqli-input" value={p} onChange={(e) => setP(e.target.value)} spellCheck={false} /></label>
          </div>

          {mode === 'concat' ? (
            <>
              <div className="code sqli-sql">
                <div className="code-head"><span>真正送到資料庫的 SQL（拼接後）</span><span>sql</span></div>
                <pre>{segs.map((sg, i) => <span key={i} className={`sqli-seg-${sg.k}${sg.from ? ' sqli-from' : ''}`}>{sg.s}</span>)}</pre>
              </div>
              <p className="sqli-legend"><span className="sqli-from sqli-seg-input">底線</span> = 來自輸入　<span className="sqli-seg-code">紅底</span> = 逃出字串、變成 SQL 程式碼　<span className="sqli-seg-cm">灰線</span> = 被 -- 註解掉</p>
            </>
          ) : (
            <div className="sqli-param-grid">
              <Code lang="sql" title="送到資料庫的 SQL（含佔位符）"
                    marks={[{ line: 2, text: '%s', ok: true }, { line: 3, text: '%s', ok: true }]}>{`SELECT * FROM users\nWHERE username = %s\n  AND password = %s`}</Code>
              <div className="sqli-params">
                <div className="code-head"><span>參數（另外傳）</span><span>values</span></div>
                <div className="sqli-param"><span className="tag">%s ①</span><code>{JSON.stringify(u)}</code></div>
                <div className="sqli-param"><span className="tag">%s ②</span><code>{JSON.stringify(p)}</code></div>
                <p className="muted">每個參數整個就是一個字串常值，引號也只是字元。</p>
              </div>
            </div>
          )}

          <div className="dtable-wrap">
            <table className="dtable sqli-table">
              <caption>users 表 <span className="muted">（示範用明文；真實系統存的是加鹽雜湊）　匹配 <b>{result.rows.length}</b> 列</span></caption>
              <thead><tr>{COLS.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>
                {USERS.map((r) => (
                  <tr key={r.id} className={hitIds.has(r.id) ? 'hit' : result.rows.length ? 'dim' : ''}>
                    {COLS.map((c) => <td key={c}>{r[c]}{c === 'username' && first?.id === r.id && <span className="tag sqli-first">fetchone()</span>}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="sqli-verdict">
            {result.kind === 'legit' && <Status ok>登入成功：{first.username}（{first.role}）</Status>}
            {isBad && <Status>以 {first.username} 身分登入！{result.rows.length > 1 ? `${result.rows.length} 列匹配，取第一列` : '密碼檢查被繞過'}</Status>}
            {(result.kind === 'none' || result.kind === 'blocked') && <Status warn>帳密錯誤（0 列匹配）</Status>}
            {result.kind === 'error' && <Status warn>SQL 語法錯誤：{result.error}</Status>}
            {result.kind === 'blocked' && <span className="muted">攻擊無效——引號只是字串的一部分</span>}
            {result.kind === 'error' && <span className="muted">錯誤訊息若回給使用者，就是攻擊者的探測線索</span>}
          </div>
        </LabStage>

        <div className="lab-stack">
          <Code lang="python" title="app/auth.py" dim highlight={mode === 'concat' ? [3, 4] : [10, 11, 15]} marks={PY_MARKS}>{PY}</Code>
          <LabExplain title={title}>
            {paras.map((t, i) => <p key={i} dangerouslySetInnerHTML={{ __html: md(t) }} />)}
            {mode === 'param' && <p dangerouslySetInnerHTML={{ __html: md(PARAM_COMMON) }} />}
            <p dangerouslySetInnerHTML={{ __html: md(EXTRA) }} />
          </LabExplain>
          <Callout title="工作上什麼時候用">
            <b>永遠參數化</b>：所有 <code>execute()</code> 都用佔位符＋參數，包含 LIKE 與 IN 的值；ORM 的 <code>.where()</code> / <code>.filter()</code> 也是，只有 <code>text()</code> 或 raw SQL 要特別盯。
            動態的表名、欄位名、ORDER BY 欄位<b>無法參數化</b>——用白名單對照（例如 <code>{'ALLOWED = {"created_at", "name"}'}</code>），對不上就拒絕，不要拼接。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .sqli .lab-grid > * { min-width: 0; }
        .sqli-presets { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .sqli-preset { font-family: var(--mono); font-size: 0.76rem; padding: 4px 10px; }
        .lab-stage .sqli-form { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
        .sqli-form label { display: grid; gap: 4px; font-size: 0.74rem; font-weight: 700; letter-spacing: 0.06em; color: var(--ink-3); }
        .sqli-input { font-family: var(--mono); font-size: 0.86rem; color: var(--ink-1); background: var(--surface-1); border: 1px solid var(--hairline); border-radius: var(--radius); padding: 7px 10px; width: 100%; min-width: 0; }
        .sqli-input:focus { outline: 2px solid var(--lab-accent); outline-offset: 1px; border-color: transparent; }
        @media (max-width: 480px) { .lab-stage .sqli-form { grid-template-columns: 1fr; } }
        .sqli-sql pre { white-space: pre-wrap; word-break: break-all; padding: 10px 14px; font-size: 0.84rem; line-height: 1.7; }
        .sqli-seg-kw { color: var(--c-violet); font-weight: 600; }
        .sqli-seg-str, .sqli-seg-input { color: var(--c-green); }
        .sqli-from { text-decoration: underline dotted var(--lab-accent); text-decoration-thickness: 2px; text-underline-offset: 4px; }
        .sqli-seg-code { background: color-mix(in srgb, var(--c-red) 24%, transparent); color: var(--ink-1); font-weight: 700; border-radius: 2px; padding: 0 1px; }
        .sqli-seg-cm { color: var(--ink-3); font-style: italic; text-decoration: line-through; background: none; font-weight: 400; }
        .sqli-legend { font-family: var(--mono); font-size: 0.72rem; color: var(--ink-3); margin: 8px 0 14px; }
        .sqli-param-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; align-items: start; }
        @media (max-width: 600px) { .sqli-param-grid { grid-template-columns: 1fr; } }
        .sqli-params { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-2); font-size: 0.8rem; }
        .sqli-params .code-head { border-bottom: 1px solid var(--hairline); }
        .sqli-param { display: flex; align-items: center; gap: 10px; padding: 6px 12px; }
        .sqli-param code { font-family: var(--mono); color: var(--c-green); word-break: break-all; }
        .sqli-params .muted { font-size: 0.74rem; padding: 4px 12px 10px; }
        .sqli-table caption b { color: var(--ink-1); font-family: var(--mono); }
        .sqli-first { margin-left: 8px; border-color: var(--lab-accent); color: var(--lab-accent); font-size: 0.64rem; }
        .sqli-verdict { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 12px; font-size: 0.8rem; }
      `}</style>
    </Lab>
  )
}

function md(s) {
  return s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

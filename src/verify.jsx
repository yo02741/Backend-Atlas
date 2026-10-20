import React, { useEffect, useState } from 'react'
import { EXERCISES } from './content/exercises/index.js'
import { grade } from './runtime/check.js'
import { runPython } from './runtime/py.js'
import { runJs } from './runtime/js.js'
import { runSql, resetSchema } from './runtime/sql.js'
import { SHOP_SCHEMA } from './content/schemas.js'
import { parse } from './components/Markdown.jsx'

/* 開發用：?verify=1 依序把每題的「解答」與「起始碼」丟進真實執行環境評分。
   解答必須通過、起始碼應該不通過。結果放在 window.__verify 供 Playwright 讀取。 */
export default function VerifyHarness() {
  const [rows, setRows] = useState([])
  const [done, setDone] = useState(false)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const out = []
      // ?only=id1,id2 只驗指定的題（也可以給技能 id）；平行開發時各自驗自己的題
      const only = new URLSearchParams(location.search).get('only')?.split(',').filter(Boolean)
      for (const ex of EXERCISES.filter((e) => !only || only.includes(e.id) || only.includes(e.skill))) {
        const t0 = performance.now()
        const sol = await grade(ex, ex.solution)
        const st = await grade(ex, ex.starter)
        const row = { id: ex.id, kind: ex.kind, solutionPass: sol.pass, starterPass: st.pass, solutionMsg: sol.message + (sol.error ? ' ' + sol.error : ''), starterMsg: st.message, ms: Math.round(performance.now() - t0),
          failedTests: (sol.results || []).filter((r) => !r.pass).map((r) => `${r.name}: ${r.error}`) }
        out.push(row)
        if (cancelled) return
        setRows([...out])
      }
      window.__verify = { done: true, results: out }
      setDone(true)
    })()
    return () => { cancelled = true }
  }, [])
  return (
    <div className="page" style={{ paddingTop: 20 }}>
      <h1 className="display" style={{ fontSize: '1.6rem' }}>Exercise verify {done ? '（完成）' : '（執行中…）'}</h1>
      <table className="dtable" style={{ marginTop: 12 }}>
        <thead><tr><th>id</th><th>kind</th><th>解答</th><th>起始碼</th><th>ms</th><th>訊息</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.id}</td><td>{r.kind}</td>
              <td style={{ color: r.solutionPass ? 'var(--good)' : 'var(--critical)' }}>{r.solutionPass ? 'PASS' : 'FAIL'}</td>
              <td style={{ color: r.starterPass ? 'var(--critical)' : 'var(--good)' }}>{r.starterPass ? 'PASS(!)' : 'fail'}</td>
              <td>{r.ms}</td>
              <td style={{ whiteSpace: 'normal', maxWidth: 480 }}>{r.solutionPass ? '' : r.solutionMsg + ' ' + r.failedTests.join(' | ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* 開發用：?verify=deep 把每課深入內容裡標 run 的程式碼區塊丟進真實執行環境（跟「在 Playground 開啟」同樣的方式：
   SQL 先重設成電商範例資料庫再執行）。每個區塊都必須執行成功。結果放在 window.__verifyDeep。 */
const DEEP = import.meta.glob('./content/deep/*.md', { query: '?raw', import: 'default', eager: true })
export function DeepVerify() {
  const [rows, setRows] = useState([])
  const [done, setDone] = useState(false)
  useEffect(() => {
    ;(async () => {
      const out = []
      const only = new URLSearchParams(location.search).get('only')?.split(',').filter(Boolean)
      for (const [path, md] of Object.entries(DEEP)) {
        const id = path.replace(/^.*\/|\.md$/g, '')
        if (only && !only.includes(id)) continue
        const blocks = parse(md).filter((b) => b.type === 'code' && b.flags?.includes('run'))
        for (const [n, b] of blocks.entries()) {
          const lang = b.rawLang === 'javascript' ? 'js' : b.rawLang
          let res
          if (lang === 'python') res = await runPython(b.text)
          else if (lang === 'js') res = await runJs(b.text)
          else if (lang === 'sql') { await resetSchema(SHOP_SCHEMA, 'shop', true); res = await runSql(b.text) }
          else res = { ok: false, error: `不支援的語言 ${b.rawLang}` }
          out.push({ id: `${id}#${n + 1}`, lang, ok: !!res.ok, error: res.ok ? '' : String(res.error || (res.timeout ? '逾時' : '失敗')).slice(0, 400) })
          setRows([...out])
        }
      }
      window.__verifyDeep = { done: true, results: out }
      setDone(true)
    })()
  }, [])
  return (
    <div className="page" style={{ paddingTop: 20 }}>
      <h1 className="display" style={{ fontSize: '1.6rem' }}>Deep lesson code verify {done ? '（完成）' : '（執行中…）'}</h1>
      <table className="dtable" style={{ marginTop: 12 }}>
        <thead><tr><th>區塊</th><th>語言</th><th>結果</th><th>錯誤</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td>{r.id}</td><td>{r.lang}</td><td style={{ color: r.ok ? 'var(--good)' : 'var(--critical)' }}>{r.ok ? 'ok' : 'FAIL'}</td><td style={{ whiteSpace: 'pre-wrap', maxWidth: 520 }}>{r.error}</td></tr>)}</tbody>
      </table>
    </div>
  )
}

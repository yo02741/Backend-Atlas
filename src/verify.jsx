import React, { useEffect, useState } from 'react'
import { EXERCISES } from './content/exercises/index.js'
import { grade } from './runtime/check.js'

/* 開發用：?verify=1 依序把每題的「解答」與「起始碼」丟進真實執行環境評分。
   解答必須通過、起始碼應該不通過。結果放在 window.__verify 供 Playwright 讀取。 */
export default function VerifyHarness() {
  const [rows, setRows] = useState([])
  const [done, setDone] = useState(false)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const out = []
      for (const ex of EXERCISES) {
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

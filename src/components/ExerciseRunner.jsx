import React, { useCallback, useEffect, useState } from 'react'
import CodeEditor from './CodeEditor.jsx'
import Md from './Md.jsx'
import { ConsoleOut, ResultTable, PlanTree, TestResults, RuntimeStatus } from './Output.jsx'
import { grade, runOnly } from '../runtime/check.js'
import { explain, resetSchema } from '../runtime/sql.js'
import { ensurePython } from '../runtime/py.js'
import { ensureSql } from '../runtime/sql.js'
import { useProgress } from '../progress.js'
import { KINDS } from '../content/exercises/index.js'
import { LEVELS } from '../content/roadmap.js'

/* 單一程式題：編輯器 + 執行 / 交卷 / 提示 / 解答。
   通過與否寫進 progress（通過後不會被之後的失敗覆蓋）。 */
function loadDraft(id) { try { return localStorage.getItem(`atlas-ex-${id}`) } catch { return null } }
function saveDraft(id, code) { try { localStorage.setItem(`atlas-ex-${id}`, code) } catch { /* ignore */ } }

export default function ExerciseRunner({ exercise: ex, compact = false, showStatusPill = true }) {
  const { exerciseStatus, setExercise } = useProgress()
  const status = exerciseStatus(ex.id)
  const [code, setCode] = useState(() => loadDraft(ex.id) ?? ex.starter)
  const [busy, setBusy] = useState(false)
  const [out, setOut] = useState(null)       // 「執行」的結果
  const [graded, setGraded] = useState(null) // 「交卷」的結果
  const [hints, setHints] = useState(0)
  const [showSolution, setShowSolution] = useState(false)
  const [plan, setPlan] = useState(null)
  const lang = ex.kind === 'js' ? 'js' : ex.kind

  useEffect(() => { saveDraft(ex.id, code) }, [ex.id, code])
  // 編輯器一出現就預載執行環境
  useEffect(() => { if (ex.kind === 'python') ensurePython(); if (ex.kind === 'sql') ensureSql().catch(() => {}) }, [ex.kind])

  const run = useCallback(async () => {
    if (busy) return
    setBusy(true); setGraded(null); setPlan(null)
    try { setOut(await runOnly(ex, code)) } finally { setBusy(false) }
  }, [busy, ex, code])

  const submit = useCallback(async () => {
    if (busy) return
    setBusy(true); setOut(null); setPlan(null)
    try {
      const g = await grade(ex, code)
      setGraded(g)
      setExercise(ex.id, g.pass ? 'pass' : 'fail')
    } finally { setBusy(false) }
  }, [busy, ex, code, setExercise])

  const doExplain = async () => {
    setBusy(true)
    try {
      await resetSchema(ex.setup || '', ex.setupKey || null, true)
      // 先跑使用者的程式（例如 CREATE INDEX），再看題目主查詢的計畫
      const target = ex.explainQuery || code
      if (ex.explainQuery) await runOnly(ex, code)
      setPlan(await explain(target.replace(/;\s*$/, '')))
    } finally { setBusy(false) }
  }

  const reset = () => { setCode(ex.starter); setOut(null); setGraded(null); setPlan(null); setShowSolution(false) }

  return (
    <section className={`ex${compact ? ' compact' : ''}`} id={`ex-${ex.id}`}>
      <header className="ex-head">
        <div>
          <p className="kicker">程式題 · {KINDS[ex.kind]?.label} · {LEVELS[ex.level]}</p>
          <h3 className="ex-title">{ex.title}</h3>
        </div>
        <div className="ex-status">
          {showStatusPill && (
            status === 'pass' ? <span className="status ok">✓ 已通過</span>
            : status === 'fail' ? <span className="status warn">! 尚未通過</span>
            : <span className="pill">未作答</span>
          )}
        </div>
      </header>
      <Md text={ex.prompt} className="ex-prompt" />

      <div className="ex-toolbar">
        <button className="btn small" onClick={run} disabled={busy}>{busy ? '執行中…' : '▶ 執行'}</button>
        <button className="btn small submit" onClick={submit} disabled={busy}>交卷</button>
        {ex.kind === 'sql' && <button className="btn ghost small" onClick={doExplain} disabled={busy}>查詢計畫</button>}
        <button className="btn ghost small" onClick={reset} disabled={busy}>重設</button>
        <span className="spacer" />
        {hints < ex.hints.length && <button className="btn ghost small" onClick={() => setHints((h) => h + 1)}>提示 {hints}/{ex.hints.length}</button>}
        <button className="btn ghost small" onClick={() => setShowSolution((s) => !s)}>{showSolution ? '隱藏解答' : '看解答'}</button>
        <RuntimeStatus kind={ex.kind} />
      </div>

      <CodeEditor value={code} onChange={setCode} lang={lang} onRun={run} minHeight={compact ? 200 : 260} />

      {hints > 0 && (
        <ol className="ex-hints">
          {ex.hints.slice(0, hints).map((h, i) => <li key={i}><Md text={h} /></li>)}
        </ol>
      )}

      {(out || graded || plan) && (
        <div className="ex-out">
          {out && (
            ex.kind === 'sql'
              ? <div className="lab-stack">
                  {out.error && <pre className="out-pre out-err">{out.error}</pre>}
                  {out.results?.map((r, i) => <ResultTable key={i} result={r} caption={out.results.length > 1 ? `第 ${i + 1} 句` : '結果'} />)}
                  {out.ok && out.results?.length === 0 && <p className="out-empty">執行完成，沒有結果集。</p>}
                </div>
              : <ConsoleOut output={out.output} error={out.error} />
          )}
          {graded && (
            <div className="lab-stack">
              <p className={`ex-verdict ${graded.pass ? 'ok' : 'bad'}`}>{graded.pass ? '✓ 通過' : '✕ 未通過'}　<span>{graded.message}</span></p>
              {graded.error && <pre className="out-pre out-err">{graded.error}</pre>}
              {graded.output && <ConsoleOut output={graded.output} />}
              {graded.results && <TestResults results={graded.results} />}
              {ex.kind === 'sql' && !graded.error && (
                <div className="ex-compare">
                  <ResultTable result={graded.got} caption={ex.expect.query ? '驗證查詢的結果' : '你的結果'} highlightRows={graded.badRows} />
                  <ResultTable result={{ fields: graded.expected.fields, rows: graded.expected.rows }} caption="預期結果" />
                </div>
              )}
            </div>
          )}
          {plan && (plan.ok ? <><p className="kicker" style={{ marginTop: 8 }}>查詢計畫</p><PlanTree plan={plan.plan} /></> : <pre className="out-pre out-err">{plan.error}</pre>)}
        </div>
      )}

      {showSolution && (
        <div className="ex-solution">
          <p className="kicker">參考解答</p>
          <CodeEditor value={ex.solution} onChange={() => {}} lang={lang} readOnly minHeight={120} />
        </div>
      )}
    </section>
  )
}

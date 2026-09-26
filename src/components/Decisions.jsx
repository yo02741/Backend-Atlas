import React, { useState } from 'react'
import Md from './Md.jsx'
import { useProgress } from '../progress.js'
import { useCloud } from '../cloud/sync.js'

/* 決策題：每題一個情境變體，從做法裡選一個，可填理由（存在這個瀏覽器，登入時同步到帳號）。全對才通過。 */
export default function Decisions({ scenario }) {
  const { scenarioStatus, setScenario, rationale, setRationale } = useProgress()
  const synced = useCloud().status === 'signed-in'
  const status = scenarioStatus(scenario.id)
  const [picks, setPicks] = useState(() => Object.fromEntries(scenario.decisions.map((d) => [d.id, null])))
  const [submitted, setSubmitted] = useState(false)
  const optName = (id) => scenario.options.find((o) => o.id === id)?.name || id
  const answered = Object.values(picks).filter(Boolean).length
  const total = scenario.decisions.length
  const correct = submitted ? scenario.decisions.filter((d) => picks[d.id] === d.answer).length : 0

  const submit = () => {
    setSubmitted(true)
    const all = scenario.decisions.every((d) => picks[d.id] === d.answer)
    setScenario(scenario.id, all ? 'pass' : 'fail')
  }
  const retry = () => { setSubmitted(false); setPicks(Object.fromEntries(scenario.decisions.map((d) => [d.id, null]))) }

  return (
    <section className="quiz decisions">
      <header className="ex-head">
        <div>
          <p className="kicker">決策題 · {total} 個變體</p>
          <h3 className="ex-title">換個條件，你選哪個做法</h3>
        </div>
        <div className="ex-status">
          {status === 'pass' ? <span className="status ok">✓ 已通過</span>
            : status === 'fail' ? <span className="status warn">! 尚未通過</span>
            : <span className="pill">未作答</span>}
        </div>
      </header>
      <ol className="quiz-list">
        {scenario.decisions.map((d, i) => {
          const picked = picks[d.id]
          const right = submitted && picked === d.answer
          const key = `${scenario.id}:${d.id}`
          return (
            <li key={d.id} className={`quiz-q${submitted ? (right ? ' right' : ' wrong') : ''}`}>
              <p className="dec-no">變體 {i + 1}</p>
              <Md text={d.situation} className="quiz-stem" />
              <div className="quiz-opts" role="radiogroup">
                {d.options.map((oid, oi) => {
                  const cls = ['quiz-opt', picked === oid ? 'picked' : '', submitted && oid === d.answer ? 'correct' : '', submitted && picked === oid && oid !== d.answer ? 'incorrect' : ''].join(' ')
                  return (
                    <label key={oid} className={cls}>
                      <input type="radio" name={`${scenario.id}-${d.id}`} checked={picked === oid} disabled={submitted}
                             onChange={() => setPicks((p) => ({ ...p, [d.id]: oid }))} />
                      <span className="quiz-letter">{String.fromCharCode(65 + oi)}</span>
                      <span>{optName(oid)}</span>
                    </label>
                  )
                })}
              </div>
              <label className="dec-rationale">
                <span className="kicker">你的理由（選填，{synced ? '會同步到你的帳號' : '只存在這個瀏覽器'}）</span>
                <textarea rows={2} maxLength={1000} value={rationale(key)} placeholder="用一兩句話說明你為什麼這樣選——之後回頭看會很有用。"
                          onChange={(e) => setRationale(key, e.target.value)} />
              </label>
              {submitted && (
                <div className={`quiz-explain ${right ? 'ok' : 'bad'}`}>
                  <b>{right ? '一致。' : `這裡選「${optName(d.answer)}」比較合適。`}</b>　<Md text={d.explain} />
                </div>
              )}
            </li>
          )
        })}
      </ol>
      <div className="ex-toolbar">
        {!submitted
          ? <button className="btn small submit" onClick={submit} disabled={answered < total}>交卷{answered < total ? `（還有 ${total - answered} 題沒選）` : ''}</button>
          : <>
              <p className={`ex-verdict ${correct === total ? 'ok' : 'bad'}`}>{correct === total ? '✓ 全部一致，通過' : `✕ ${correct} / ${total} 一致`}</p>
              <button className="btn ghost small" onClick={retry}>再試一次</button>
            </>}
      </div>
    </section>
  )
}

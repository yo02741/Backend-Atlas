import React, { useState } from 'react'
import Md from './Md.jsx'
import { Code } from '../labs/ui.jsx'
import { useProgress } from '../progress.js'

/* 選擇題：全對才算通過；答錯會顯示解析，可重試 */
export default function Quiz({ skillId, questions }) {
  const { quizStatus, setQuiz } = useProgress()
  const status = quizStatus(skillId)
  const [answers, setAnswers] = useState(() => questions.map(() => null))
  const [submitted, setSubmitted] = useState(false)
  const answered = answers.filter((a) => a !== null).length
  const correct = submitted ? answers.filter((a, i) => a === questions[i].answer).length : 0

  const submit = () => {
    setSubmitted(true)
    const all = answers.every((a, i) => a === questions[i].answer)
    setQuiz(skillId, all ? 'pass' : 'fail')
  }
  const retry = () => { setSubmitted(false); setAnswers(questions.map(() => null)) }

  return (
    <section className="quiz">
      <header className="ex-head">
        <div>
          <p className="kicker">選擇題 · {questions.length} 題</p>
          <h3 className="ex-title">觀念驗收</h3>
        </div>
        <div className="ex-status">
          {status === 'pass' ? <span className="status ok">✓ 已通過</span>
            : status === 'fail' ? <span className="status warn">! 尚未通過</span>
            : <span className="pill">未作答</span>}
        </div>
      </header>
      <ol className="quiz-list">
        {questions.map((q, qi) => {
          const picked = answers[qi]
          const isRight = submitted && picked === q.answer
          return (
            <li key={qi} className={`quiz-q${submitted ? (isRight ? ' right' : ' wrong') : ''}`}>
              <Md text={q.q} className="quiz-stem" />
              {q.code && <Code lang={q.lang || 'text'} title="">{q.code}</Code>}
              <div className="quiz-opts" role="radiogroup">
                {q.options.map((opt, oi) => {
                  const cls = ['quiz-opt', picked === oi ? 'picked' : '', submitted && oi === q.answer ? 'correct' : '', submitted && picked === oi && oi !== q.answer ? 'incorrect' : ''].join(' ')
                  return (
                    <label key={oi} className={cls}>
                      <input type="radio" name={`${skillId}-${qi}`} checked={picked === oi} disabled={submitted}
                             onChange={() => setAnswers((a) => a.map((v, i) => (i === qi ? oi : v)))} />
                      <span className="quiz-letter">{String.fromCharCode(65 + oi)}</span>
                      <span>{opt}</span>
                    </label>
                  )
                })}
              </div>
              {submitted && (
                <div className={`quiz-explain ${isRight ? 'ok' : 'bad'}`}>
                  <b>{isRight ? '答對了。' : `答錯了，正解是 ${String.fromCharCode(65 + q.answer)}。`}</b>　<Md text={q.explain} />
                </div>
              )}
            </li>
          )
        })}
      </ol>
      <div className="ex-toolbar">
        {!submitted
          ? <button className="btn small submit" onClick={submit} disabled={answered < questions.length}>交卷{answered < questions.length ? `（還有 ${questions.length - answered} 題沒答）` : ''}</button>
          : <>
              <p className={`ex-verdict ${correct === questions.length ? 'ok' : 'bad'}`}>{correct === questions.length ? '✓ 全對，通過' : `✕ 答對 ${correct} / ${questions.length}`}</p>
              <button className="btn ghost small" onClick={retry}>再試一次</button>
            </>}
      </div>
    </section>
  )
}

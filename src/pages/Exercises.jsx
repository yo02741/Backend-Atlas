import React, { useEffect, useState } from 'react'
import { EXERCISES, KINDS, findExercise } from '../content/exercises/index.js'
import { DOMAINS, LEVELS, findSkill } from '../content/roadmap.js'
import { quizCount, QUIZZES } from '../content/quizzes/index.js'
import { useProgress } from '../progress.js'
import ExerciseRunner from '../components/ExerciseRunner.jsx'
import { Level } from '../components/bits.jsx'

/* 練習題總表：像 LeetCode 一樣一列一題，可依領域 / 類型 / 狀態篩 */
export default function Exercises() {
  const { exerciseStatus, quizzes } = useProgress()
  const [kind, setKind] = useState('')
  const [domain, setDomain] = useState('')
  const [only, setOnly] = useState('') // '' | 'todo' | 'pass'
  const rows = EXERCISES.map((e) => ({ ...e, skillObj: findSkill(e.skill), status: exerciseStatus(e.id) }))
    .filter((r) => (!kind || r.kind === kind) && (!domain || r.skillObj?.domain.id === domain) && (!only || (only === 'pass' ? r.status === 'pass' : r.status !== 'pass')))
  const passed = EXERCISES.filter((e) => exerciseStatus(e.id) === 'pass').length
  const quizSkills = Object.keys(QUIZZES).length
  const quizPassed = Object.values(quizzes || {}).filter((v) => v === 'pass').length

  return (
    <div className="fade-swap">
      <header className="masthead">
        <p className="kicker">EXERCISES · 練習題</p>
        <h1 className="display">動手驗收</h1>
        <p className="lede">程式題在瀏覽器裡真的執行、真的跑測試：SQL 對 PostgreSQL、Python 跑 Pyodide、JavaScript 跑 Worker。每一題都對應一課；選擇題在各課頁面裡。</p>
        <div className="hero-stats" style={{ marginTop: 18 }}>
          <div className="stat"><b>{passed}<span className="muted" style={{ fontSize: '1rem', fontWeight: 500 }}> / {EXERCISES.length}</span></b><span>程式題通過</span></div>
          <div className="stat"><b>{quizPassed}<span className="muted" style={{ fontSize: '1rem', fontWeight: 500 }}> / {quizSkills}</span></b><span>選擇題組通過</span></div>
          <div className="stat"><b>{quizCount()}</b><span>選擇題總數</span></div>
        </div>
      </header>

      <div className="toolbar">
        <button className={`chip${!kind ? ' on' : ''}`} onClick={() => setKind('')}>全部類型</button>
        {Object.entries(KINDS).map(([k, v]) => <button key={k} className={`chip${kind === k ? ' on' : ''}`} onClick={() => setKind(kind === k ? '' : k)}>{v.label}</button>)}
        <span style={{ width: 8 }} />
        {['todo', 'pass'].map((o) => <button key={o} className={`chip${only === o ? ' on' : ''}`} onClick={() => setOnly(only === o ? '' : o)}>{o === 'todo' ? '未通過' : '已通過'}</button>)}
      </div>
      <div className="toolbar" style={{ marginTop: 0 }}>
        <button className={`chip${!domain ? ' on' : ''}`} onClick={() => setDomain('')}>全部領域</button>
        {DOMAINS.filter((d) => EXERCISES.some((e) => findSkill(e.skill)?.domain.id === d.id)).map((d) => (
          <button key={d.id} className={`chip tinted${domain === d.id ? ' on' : ''}`} style={{ '--tint': `var(--c-${d.color})` }} onClick={() => setDomain(domain === d.id ? '' : d.id)}>{d.title}</button>
        ))}
      </div>

      <div className="dtable-wrap" style={{ marginTop: 14 }}>
        <table className="ex-list">
          <thead><tr><th>狀態</th><th>題目</th><th>課程</th><th>類型</th><th>難度</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td>{r.status === 'pass' ? <span className="status ok">✓</span> : r.status === 'fail' ? <span className="status warn">!</span> : <span className="muted">—</span>}</td>
                <td><a href={`#/exercise/${r.id}`} className="ex-link"><span className="ex-no">{String(i + 1).padStart(2, '0')}</span>{r.title}</a></td>
                <td><a href={`#/skill/${r.skill}`} className="muted" style={{ textDecoration: 'none', fontSize: '0.85rem' }}>{r.skillObj?.title}</a></td>
                <td><span className="pill mono">{KINDS[r.kind].label}</span></td>
                <td><Level level={r.level} /></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="muted">沒有符合的題目。</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* 單題獨立頁 */
export function ExercisePage({ id }) {
  const ex = findExercise(id)
  useEffect(() => { window.scrollTo({ top: 0 }) }, [id])
  if (!ex) return <p className="status-msg">找不到題目：{id}</p>
  const skill = findSkill(ex.skill)
  const i = EXERCISES.findIndex((e) => e.id === id)
  const prev = i > 0 ? EXERCISES[i - 1] : null
  const next = i < EXERCISES.length - 1 ? EXERCISES[i + 1] : null
  return (
    <div className="fade-swap" style={{ paddingTop: 24, '--tint': `var(--c-${skill.domain.color})` }}>
      <p className="crumbs"><a href="#/">首頁</a> / <a href="#/exercises">練習題</a> / <a href={`#/skill/${skill.id}`}>{skill.title}</a></p>
      <ExerciseRunner key={ex.id} exercise={ex} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginTop: 18 }}>
        <a className="btn ghost" href={`#/skill/${skill.id}`}>回到課程：{skill.title}</a>
        <span className="muted" style={{ fontSize: '0.85rem' }}>{skill.domain.title} · {LEVELS[ex.level]}</span>
      </div>
      <nav className="lesson-nav">
        {prev ? <a href={`#/exercise/${prev.id}`}><small>上一題</small>← {prev.title}</a> : <span />}
        {next ? <a className="next" href={`#/exercise/${next.id}`}><small>下一題</small>{next.title} →</a> : <span />}
      </nav>
    </div>
  )
}

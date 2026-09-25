import React, { useEffect } from 'react'
import { findSkill, neighbors } from '../content/roadmap.js'
import { useProgress } from '../progress.js'
import { Level, DomainPill, LabEmbed, labTitle } from '../components/bits.jsx'
import { Callout } from '../labs/ui.jsx'
import ExerciseRunner from '../components/ExerciseRunner.jsx'
import Quiz from '../components/Quiz.jsx'
import { assessmentFor } from '../assess.js'

export default function Skill({ id }) {
  const s = findSkill(id)
  const progress = useProgress()
  const { isDone, toggleDone, checks, toggleCheck } = progress
  useEffect(() => { window.scrollTo({ top: 0 }) }, [id])
  if (!s) return <p className="status-msg">找不到這一課：{id}</p>

  const d = s.domain
  const color = `var(--c-${d.color})`
  const done = isDone(s.id)
  const { prev, next } = neighbors(s.id)
  const checkState = checks(s.id, s.checklist.length)
  const checkedN = checkState.filter(Boolean).length
  const assess = assessmentFor(s.id, progress)

  return (
    <article className="lesson fade-swap" style={{ '--tint': color }}>
      <div className="reading">
        <p className="crumbs">
          <a href="#/">首頁</a> / <a href="#/roadmap">技能盤點</a> / <a href={`#/domain/${d.id}`}>{d.title}</a>
        </p>
        <header className="lesson-head">
          <p className="kicker tinted">0{d.no} · {d.en}</p>
          <h1>{s.title}</h1>
          <p className="en">{s.en}</p>
          <div className="lesson-meta">
            <Level level={s.level} />
            <DomainPill domain={d} />
            {s.lab && <a href="#lab" className="pill tint" style={{ '--tint': color }}>互動實驗室</a>}
            {assess.total > 0 && <a href="#assess" className={`pill${assess.complete ? ' assess-ok' : ''}`}>{assess.complete ? '✓ 驗收通過' : `驗收 ${assess.passed}/${assess.total}`}</a>}
            {s.keywords.map((k) => <a key={k} href={`#/roadmap?kw=${encodeURIComponent(k)}`} className="pill mono">{k}</a>)}
          </div>
          <p className="lede">{s.summary}</p>
        </header>

        <div className="why">
          <p className="kicker">為什麼要學</p>
          <p>{s.why}</p>
        </div>

        <div className="example-box">
          <span>範例技術 <b>{s.example.primary}</b></span>
          {s.example.alts?.length > 0 && <span className="alts">也常見：{s.example.alts.join('、')}</span>}
        </div>
      </div>

      <div className="course-bar">
        <nav className="course-toc" aria-label="本課章節">
          {s.lab && <a href="#lab" className="lab-link">▶ 實驗室</a>}
          <a href="#points">重點（{s.points.length}）</a>
          {assess.total > 0 && <a href="#assess">驗收（{assess.passed}/{assess.total}）</a>}
          <a href="#check">自我檢核（{checkedN}/{s.checklist.length}）</a>
          {s.refs?.length > 0 && <a href="#refs">延伸閱讀</a>}
        </nav>
        <button className={`btn small done-btn${done ? ' is-done' : ' ghost'}`} onClick={() => toggleDone(s.id)}>
          {done ? '✓ 已完成' : '標記完成'}
        </button>
      </div>

      {s.lab && (
        <section className="lab-full">
          <h2 id="lab" className="lab-full-title">動手玩：{labTitle(s.lab)}</h2>
          <LabEmbed name={s.lab} />
        </section>
      )}

      <div className="reading">
        <div className="lesson-body">
          <h2 id="points">重點</h2>
          <ul className="points">
            {s.points.map((p, i) => <li key={i}><span><b>{p.b}</b>　<Inline text={p.t} /></span></li>)}
          </ul>

          <h2 id="assess">驗收 <span className="muted" style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)', fontWeight: 500 }}>{assess.total > 0 ? `${assess.passed} / ${assess.total}` : ''}</span></h2>
          {assess.total === 0 && <p className="muted">這一課的驗收題目撰寫中。</p>}
          {assess.exercises.map((ex) => <ExerciseRunner key={ex.id} exercise={ex} compact />)}
          {assess.quiz && <Quiz key={s.id} skillId={s.id} questions={assess.quiz} />}

          <h2 id="check">自我檢核 <span className="muted" style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)', fontWeight: 500 }}>{checkedN} / {s.checklist.length}</span></h2>
          <ul className="checklist">
            {s.checklist.map((c, i) => (
              <li key={i}>
                <label>
                  <input type="checkbox" checked={checkState[i]} onChange={() => toggleCheck(s.id, i, s.checklist.length)} />
                  <span>{c}</span>
                </label>
              </li>
            ))}
          </ul>
          {checkedN === s.checklist.length && !done && (
            <Callout tone="good" title="全部打勾了">可以按上方的「標記完成」把這一站點亮。</Callout>
          )}

          {s.refs?.length > 0 && (
            <>
              <h2 id="refs">延伸閱讀</h2>
              <ul className="refs">
                {s.refs.map((r) => <li key={r.url}><a href={r.url} target="_blank" rel="noreferrer">{r.label} ↗</a></li>)}
              </ul>
            </>
          )}
        </div>

        <nav className="lesson-nav">
          {prev ? <a href={`#/skill/${prev.id}`}><small>上一課</small>← {prev.title}</a> : <span />}
          {next ? <a className="next" href={`#/skill/${next.id}`}><small>下一課</small>{next.title} →</a> : <span />}
        </nav>
      </div>
    </article>
  )
}

/* 重點文字裡的 `code` 轉成 <code> */
function Inline({ text }) {
  const parts = text.split(/(`[^`]+`)/g)
  return <>{parts.map((p, i) => p.startsWith('`') ? <code key={i}>{p.slice(1, -1)}</code> : <React.Fragment key={i}>{p}</React.Fragment>)}</>
}

import React, { Suspense, useEffect } from 'react'
import { PROJECTS, findStage, stagesOf } from '../content/project/stages.js'
import { TRACKS, findTrack } from '../content/tracks.js'
import { withTrack } from '../components/TrackFilter.jsx'
import { readStageDoc } from '../content/project/docs.js'
import { exercisesForStage } from '../content/exercises/index.js'
import { findSkill } from '../content/roadmap.js'
import { useProgress } from '../progress.js'
import Markdown from '../components/Markdown.jsx'
import ExerciseRunner from '../components/ExerciseRunner.jsx'
import { playgroundHref, runLangOf } from '../playgroundLink.js'

/* 實作路線：總覽（#/project?track=<路線>，沒帶時是後端）與單一階段（#/project/<id>，路線由階段推出） */
export default function Project({ id, track = '' }) {
  return id ? <Stage id={id} /> : <Overview track={PROJECTS[track] ? track : 'backend'} />
}

function stageProgress(stage, exerciseStatus) {
  const ex = exercisesForStage(stage.id)
  return { total: ex.length, passed: ex.filter((e) => exerciseStatus(e.id) === 'pass').length }
}

function Overview({ track }) {
  const { exerciseStatus } = useProgress()
  const PROJECT = PROJECTS[track]
  const STAGES = stagesOf(track)
  const tracks = TRACKS.filter((t) => PROJECTS[t.id])
  return (
    <div className="fade-swap">
      <header className="masthead">
        <p className="kicker">PROJECT · 實作路線 · {findTrack(track).title}</p>
        <h1 className="display">{PROJECT.title}</h1>
        <p className="lede">{PROJECT.summary}</p>
      </header>
      <div className="toolbar track-filter" role="group" aria-label="路線">
        {tracks.map((t) => (
          <a key={t.id} href={withTrack('project', t.id)} className={`chip${t.id === track ? ' on' : ''}`} aria-current={t.id === track ? 'true' : undefined}>{t.title}</a>
        ))}
      </div>
      {PROJECT.companion && (
        <p className="proj-companion">
          <strong>參考實作</strong>　{PROJECT.companion.note}
          　<a href={PROJECT.companion.url} target="_blank" rel="noreferrer"><code>companion/clinic-api</code> ↗</a>
        </p>
      )}
      {STAGES.length === 0 && <p className="muted">實作路線撰寫中。</p>}
      <ol className="proj-stages">
        {STAGES.map((s) => {
          const p = stageProgress(s, exerciseStatus)
          const done = p.total > 0 && p.passed === p.total
          return (
            <li key={s.id}>
              <a href={`#/project/${s.id}`} className={`proj-card${done ? ' done' : ''}`}>
                <span className="proj-no">{done ? '✓' : s.no}</span>
                <span className="proj-main">
                  <b>{s.title}</b>
                  <span className="proj-sum">{s.summary}</span>
                  <span className="proj-meta">
                    {p.total > 0 && <span className={`pill${done ? ' assess-ok' : ''}`}>驗收 {p.passed}/{p.total}</span>}
                    {s.lessons.map((l) => findSkill(l)).filter(Boolean).map((sk) => <span key={sk.id} className="pill">{sk.title}</span>)}
                  </span>
                </span>
              </a>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function Stage({ id }) {
  const s = findStage(id)
  const { exerciseStatus } = useProgress()
  useEffect(() => { window.scrollTo({ top: 0 }) }, [id])
  if (!s) return <p className="status-msg">找不到這個階段：{id}　<a href="#/project">回實作路線</a></p>
  const STAGES = stagesOf(s.track)
  const overview = withTrack('project', s.track)
  const i = STAGES.indexOf(s)
  const prev = STAGES[i - 1]
  const next = STAGES[i + 1]
  const exercises = exercisesForStage(s.id)
  const p = stageProgress(s, exerciseStatus)
  const lessons = s.lessons.map((l) => findSkill(l)).filter(Boolean)
  return (
    <article className="lesson fade-swap">
      <div className="reading">
        <p className="crumbs"><a href="#/">首頁</a> / <a href={`#/track/${s.track}`}>{findTrack(s.track).title}</a> / <a href={overview}>實作路線</a></p>
        <header className="lesson-head">
          <p className="kicker tinted">第 {s.no} 階段 · {STAGES.length} 個階段</p>
          <h1>{s.title}</h1>
          <p className="lede">{s.summary}</p>
          <div className="lesson-meta">
            {p.total > 0 && <span className={`pill${p.passed === p.total ? ' assess-ok' : ''}`}>驗收 {p.passed}/{p.total}</span>}
            {lessons.map((sk) => <a key={sk.id} className="pill" href={`#/skill/${sk.id}`}>{sk.title}</a>)}
          </div>
        </header>
        <div className="lesson-body">
          <Suspense fallback={<p className="muted">載入中…</p>}>
            <StageDoc id={s.id} />
          </Suspense>
          {exercises.length > 0 && <h2 id="assess">驗收</h2>}
          {exercises.map((ex) => <ExerciseRunner key={ex.id} exercise={ex} compact />)}
        </div>
        <nav className="lesson-nav">
          {prev ? <a href={`#/project/${prev.id}`}><small>上一階段</small>← {prev.title}</a> : <a href={overview}><small>實作路線</small>← 總覽</a>}
          {next ? <a className="next" href={`#/project/${next.id}`}><small>下一階段</small>{next.title} →</a> : <span />}
        </nav>
      </div>
    </article>
  )
}

function StageDoc({ id }) {
  const text = readStageDoc(id)
  if (!text) return null
  const action = (b) => (runLangOf(b)
    ? <a className="btn ghost small" href={playgroundHref(runLangOf(b), b.text)}>在 Playground 開啟 ↗</a>
    : null)
  return <Markdown text={text} className="deep-body" idFor={(_, slug) => `doc-${slug}`} codeAction={action} />
}

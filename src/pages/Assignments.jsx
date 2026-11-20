import React, { useEffect } from 'react'
import { ASSIGNMENTS, assignmentsOf, findAssignment } from '../content/assignments.js'
import { findSkill } from '../content/roadmap.js'
import { findTrack } from '../content/tracks.js'
import { findStage } from '../content/project/stages.js'
import { findScenario } from '../content/scenarios/index.js'
import TrackFilter, { normTrack, withTrack } from '../components/TrackFilter.jsx'
import Markdown, { inline } from '../components/Markdown.jsx'
import { useLocalChecks } from '../localStore.js'

/* 跨課作業：總覽（?track= 篩選）與單一作業頁。每一步的驗收條件勾選記在這個瀏覽器（src/localStore.js），不進雲端同步。 */
export default function Assignments({ track: rawTrack = '' }) {
  const track = normTrack(rawTrack)
  const list = assignmentsOf(track)
  return (
    <div className="fade-swap">
      <header className="masthead">
        <p className="kicker">ASSIGNMENTS · 跨課作業</p>
        <h1 className="display">跨課作業</h1>
      </header>
      <TrackFilter value={track} hrefFor={(t) => withTrack('assignments', t)} />
      {list.length === 0 && <p className="muted asg-empty">這條路線還沒有跨課作業。</p>}
      <div className="asg-grid">
        {list.map((a) => <AssignmentCard key={a.id} a={a} showTrack={track === 'all'} />)}
      </div>
    </div>
  )
}

function AssignmentCard({ a, showTrack }) {
  const t = findTrack(a.track)
  return (
    <a href={`#/assignment/${a.id}`} className="asg-card" style={{ '--tint': `var(--c-${t.color})` }}>
      {showTrack && <span className="kicker tinted">{t.title}</span>}
      <h3>{a.title}</h3>
      <p>{a.summary}</p>
      <span className="asg-meta">{a.steps.length} 步 · {a.lessons.length} 課</span>
    </a>
  )
}

export function AssignmentPage({ id }) {
  const a = findAssignment(id)
  useEffect(() => { window.scrollTo({ top: 0 }) }, [id])
  if (!a) return <p className="status-msg">找不到作業：{id}</p>
  const t = findTrack(a.track)
  const color = `var(--c-${t.color})`
  const sameTrack = ASSIGNMENTS.filter((x) => x.track === a.track)
  const i = sameTrack.indexOf(a)
  const prev = i > 0 ? sameTrack[i - 1] : null
  const next = i < sameTrack.length - 1 ? sameTrack[i + 1] : null
  const links = [
    ...a.lessons.map((x) => { const s = findSkill(x); return s && { href: `#/skill/${x}`, label: s.title, kind: '課' } }),
    ...(a.stages || []).map((x) => { const s = findStage(x); return s && { href: `#/project/${x}`, label: s.title, kind: '實作' } }),
    ...(a.scenarios || []).map((x) => { const s = findScenario(x); return s && { href: `#/scenario/${x}`, label: s.title, kind: '情境' } }),
  ].filter(Boolean)
  return (
    <article className="lesson fade-swap" style={{ '--tint': color }}>
      <div className="reading">
        <p className="crumbs"><a href="#/">首頁</a> / <a href={`#/track/${t.id}`}>{t.title}</a> / <a href={withTrack('assignments', t.id)}>跨課作業</a></p>
        <header className="lesson-head">
          <p className="kicker tinted">{t.title} · 跨課作業</p>
          <h1>{a.title}</h1>
          <p className="lede">{a.summary}</p>
        </header>
        <ul className="refs asg-links" aria-label="用到的內容">
          {links.map((l) => <li key={l.href}><a href={l.href}><span className="asg-kind">{l.kind}</span>{l.label} →</a></li>)}
        </ul>
        <ol className="asg-steps">
          {a.steps.map((st, k) => <Step key={k} a={a} st={st} k={k} />)}
        </ol>
        {a.twist && (
          <details className="challenge-twist asg-twist">
            <summary>需求變化</summary>
            <Markdown text={a.twist} />
          </details>
        )}
        <nav className="lesson-nav">
          {prev ? <a href={`#/assignment/${prev.id}`}><small>上一份作業</small>← {prev.title}</a> : <span />}
          {next ? <a className="next" href={`#/assignment/${next.id}`}><small>下一份作業</small>{next.title} →</a> : <span />}
        </nav>
      </div>
    </article>
  )
}

function Step({ a, st, k }) {
  const [checked, toggle] = useLocalChecks(`assignment:${a.id}:${k}`, st.check.length)
  const n = checked.filter(Boolean).length
  return (
    <li className="asg-step">
      <header className="ex-head">
        <h2 className="ex-title"><span className="asg-no">{k + 1}</span>{st.title}</h2>
        <div className="ex-status"><span className={n === st.check.length ? 'status ok' : 'pill'}>{n === st.check.length ? '✓ ' : ''}{n} / {st.check.length}</span></div>
      </header>
      <Markdown text={st.do} className="challenge-task" />
      <p className="challenge-deliver"><b>交付</b><span>{inline(st.deliver)}</span></p>
      <ul className="checklist challenge-check" aria-label={`第 ${k + 1} 步的驗收條件`}>
        {st.check.map((x, i) => (
          <li key={i}><label><input type="checkbox" checked={checked[i]} onChange={() => toggle(i)} /><span>{inline(x)}</span></label></li>
        ))}
      </ul>
    </li>
  )
}

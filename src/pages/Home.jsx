import React from 'react'
import { TRACKS } from '../content/tracks.js'
import { skillsOf, stationsOf, plannedDomainsOf } from '../content/roadmap.js'
import { EXERCISES } from '../content/exercises/index.js'
import { useProgress } from '../progress.js'
import { ProgressRing } from '../components/bits.jsx'
import { lastTrack } from '../track.js'

/* 首頁 #/：一句開場，下面三條路線。每張卡：課數、進度、下一站。 */
export default function Home() {
  const { isDone } = useProgress()
  const last = lastTrack()
  return (
    <div className="fade-swap">
      <section className="home-hero">
        <p className="ai-said"><span className="ai-said-ok" aria-hidden="true">✓</span>AI said all good.</p>
        <h1 className="display">但這些，<br /><span className="uksk">u kinda should know</span>。</h1>
        <p className="lede home-three">叫得出名字、說得出要求、驗得出對錯。</p>
      </section>

      <section className="track-cards" aria-label="路線">
        {TRACKS.map((t) => <TrackCard key={t.id} t={t} isDone={isDone} last={last === t.id} />)}
      </section>
    </div>
  )
}

function TrackCard({ t, isDone, last }) {
  const skills = skillsOf(t.id)
  const color = `var(--c-${t.color})`
  if (!skills.length) {
    return (
      <article className="track-card soon" style={{ '--tint': color }}>
        <p className="kicker tinted">{t.en}</p>
        <h2><a href={`#/track/${t.id}`}>{t.title}</a></h2>
        <p className="track-card-tag">{t.tagline}</p>
        <p className="track-card-meta"><span className="pill">撰寫中</span>規劃 {plannedDomainsOf(t.id).length} 個領域</p>
        <div className="track-card-actions"><a className="btn ghost small" href={`#/track/${t.id}`}>看規劃 →</a></div>
      </article>
    )
  }
  const stations = stationsOf(t.id)
  const doneN = skills.filter((s) => isDone(s.id)).length
  const next = stations.find((s) => !isDone(s.id)) || stations[0] || skills[0]
  const labs = skills.filter((s) => s.lab).length
  const ex = EXERCISES.filter((e) => !e.project && skills.some((s) => s.id === e.skill)).length
  return (
    <article className={`track-card${last ? ' last' : ''}`} style={{ '--tint': color }}>
      <div className="track-card-head">
        <p className="kicker tinted">{t.en}{last && <span className="track-card-last">上次在看</span>}</p>
        <ProgressRing value={doneN} total={skills.length} color={color} />
      </div>
      <h2><a href={`#/track/${t.id}`}>{t.title}</a></h2>
      <p className="track-card-tag">{t.tagline}</p>
      <p className="track-card-meta">{skills.length} 課 · {labs} 實驗室 · {ex} 程式題{stations.length > 0 && ` · 路線 ${stations.length} 站`}</p>
      <div className="track-card-actions">
        <a className="btn small" href={`#/skill/${next.id}`}>{doneN ? '繼續' : '第一站'}：{next.label || next.title} →</a>
        <a className="btn ghost small" href={`#/track/${t.id}`}>路線首頁</a>
      </div>
    </article>
  )
}

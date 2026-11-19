import React from 'react'
import { TRACKS } from '../content/tracks.js'
import { skillsOf, stationsOf, plannedDomainsOf } from '../content/roadmap.js'
import { EXERCISES } from '../content/exercises/index.js'
import { useProgress } from '../progress.js'
import { lastTrack } from '../track.js'

/* 首頁 #/：開場（貼紙「AI said all good.」、問號章、標題），下面三條路線的卡片：課數、下一站、進度。 */
export default function Home() {
  const { isDone } = useProgress()
  const last = lastTrack()
  return (
    <div className="fade-swap">
      <section className="home-hero">
        <p className="stk-said"><span className="stk-ok" aria-hidden="true">✓</span>AI said all good.</p>
        <span className="stk-q" aria-hidden="true">?</span>
        <h1 className="display">但這些，<br /><em>u kinda should know.</em></h1>
        <p className="home-three"><span>叫得出名字</span><span>說得出要求</span><span>驗得出對錯</span></p>
      </section>

      <section className="track-cards" aria-label="路線">
        {TRACKS.map((t) => <TrackCard key={t.id} t={t} isDone={isDone} last={last === t.id} />)}
      </section>
    </div>
  )
}

function TrackCard({ t, isDone, last }) {
  const skills = skillsOf(t.id)
  const cls = `track-card st-${t.sticker}`
  if (!skills.length) {
    return (
      <article className={`${cls} soon`}>
        <span className="track-card-tag">撰寫中</span>
        <span className="track-card-n">{plannedDomainsOf(t.id).length}<small>個領域規劃中</small></span>
        <h2><a href={`#/track/${t.id}`}>{t.title}</a></h2>
        <p>{t.tagline}</p>
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
    <article className={cls}>
      {last && <span className="track-card-tag">上次在看</span>}
      <span className="track-card-n">{skills.length}<small>課</small></span>
      <h2><a href={`#/track/${t.id}`}>{t.title}</a></h2>
      <p>{t.tagline}</p>
      <p className="track-card-meta">{[labs && `${labs} 實驗室`, ex && `${ex} 程式題`, stations.length && `路線 ${stations.length} 站`, doneN && `已完成 ${doneN}`].filter(Boolean).join(' · ')}</p>
      <div className="track-card-actions">
        <a className="btn ghost small" href={`#/skill/${next.id}`}>{doneN ? '繼續' : '第一站'}：{next.label || next.title} →</a>
        <a className="btn ghost small" href={`#/track/${t.id}`}>路線首頁</a>
      </div>
    </article>
  )
}

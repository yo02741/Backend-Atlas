import React from 'react'
import { findDomain, domainsOf, displayNo } from '../content/roadmap.js'
import { findTrack } from '../content/tracks.js'
import { useProgress } from '../progress.js'
import { ProgressRing } from '../components/bits.jsx'
import { SkillRow } from './Roadmap.jsx'

export default function Domain({ id }) {
  const d = findDomain(id)
  const progress = useProgress()
  const { isDone } = progress
  if (!d) return <p className="status-msg">找不到領域：{id}</p>
  const doneN = d.skills.filter((s) => isDone(s.id)).length
  // 上一個、下一個領域只在同一條路線內
  const list = domainsOf(d.track)
  const i = list.indexOf(d)
  const prev = i > 0 ? list[i - 1] : null
  const next = i < list.length - 1 ? list[i + 1] : null
  const t = findTrack(d.track)
  const color = `var(--c-${d.color})`

  return (
    <div className="fade-swap" style={{ '--tint': color }}>
      <header className="masthead">
        <p className="crumbs"><a href="#/">首頁</a> / <a href={`#/track/${t.id}`}>{t.title}</a> / {d.title}</p>
        <p className="kicker tinted">{t.title} {displayNo(d)} · {d.en}</p>
        <h1 className="display" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          {d.title}
          <ProgressRing value={doneN} total={d.skills.length} color={color} />
        </h1>
        <p className="lede">{d.tagline}</p>
        <p className="muted" style={{ marginTop: 10, fontSize: '0.85rem' }}>
          {d.skills.length} 個技能 · {d.skills.filter((s) => s.lab).length} 個實驗室 · 讀過 {doneN}
        </p>
      </header>
      <ul className="skill-list" style={{ marginTop: 20 }}>
        {d.skills.map((s) => <SkillRow key={s.id} skill={s} done={isDone(s.id)} progress={progress} />)}
      </ul>
      <nav className="lesson-nav">
        {prev ? <a href={`#/domain/${prev.id}`}><small>上一個領域</small>← {prev.title}</a> : <span />}
        {next ? <a className="next" href={`#/domain/${next.id}`}><small>下一個領域</small>{next.title} →</a> : <span />}
      </nav>
    </div>
  )
}

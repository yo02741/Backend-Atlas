import React from 'react'
import { findDomain, DOMAINS } from '../content/roadmap.js'
import { useProgress } from '../progress.js'
import { ProgressRing } from '../components/bits.jsx'
import { SkillRow } from './Roadmap.jsx'

export default function Domain({ id }) {
  const d = findDomain(id)
  const progress = useProgress()
  const { isDone } = progress
  if (!d) return <p className="status-msg">找不到領域：{id}</p>
  const doneN = d.skills.filter((s) => isDone(s.id)).length
  const i = DOMAINS.indexOf(d)
  const prev = i > 0 ? DOMAINS[i - 1] : null
  const next = i < DOMAINS.length - 1 ? DOMAINS[i + 1] : null
  const color = `var(--c-${d.color})`

  return (
    <div className="fade-swap" style={{ '--tint': color }}>
      <header className="masthead">
        <p className="crumbs"><a href="#/">首頁</a> / <a href="#/roadmap">技能盤點</a> / {d.title}</p>
        <p className="kicker tinted">0{d.no} · {d.en}</p>
        <h1 className="display" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          {d.title}
          <ProgressRing value={doneN} total={d.skills.length} color={color} />
        </h1>
        <p className="lede">{d.desc}</p>
        <p className="muted" style={{ marginTop: 10, fontSize: '0.85rem' }}>
          {d.skills.length} 個技能 · {d.skills.filter((s) => s.lab).length} 個實驗室 · 已完成 {doneN}
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

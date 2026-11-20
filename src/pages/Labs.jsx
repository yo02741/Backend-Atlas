import React, { useEffect } from 'react'
import { LAB_META, LAB_NAMES } from '../labs/index.js'
import { findSkill, domainsOf, displayNo } from '../content/roadmap.js'
import { findTrack } from '../content/tracks.js'
import TrackFilter, { normTrack, withTrack } from '../components/TrackFilter.jsx'
import { LabIcon, LabEmbed } from '../components/bits.jsx'
import { skillsWithLab } from '../counts.js'

/* 實驗室總覽：依路線（?track=）與領域分段 */
export default function Labs({ track: rawTrack = '' }) {
  const track = normTrack(rawTrack)
  return (
    <div className="fade-swap">
      <header className="masthead">
        <p className="kicker">LABS · 互動實驗室</p>
        <h1 className="display">互動實驗室</h1>
      </header>
      <TrackFilter value={track} hrefFor={(t) => withTrack('labs', t)} />
      {domainsOf(track).map((d) => {
        const names = LAB_NAMES.filter((n) => findSkill(LAB_META[n].skill)?.domain.id === d.id)
        if (!names.length) return null
        const color = `var(--c-${d.color})`
        return (
          <section key={d.id} className="domain-block" style={{ '--tint': color }}>
            <div className="domain-block-head">
              <span className="kicker tinted">{track === 'all' && `${findTrack(d.track).title} `}{displayNo(d)}</span>
              <h2>{d.title}</h2>
              <span className="count">{names.length} 個</span>
            </div>
            <div className="labs-grid" style={{ marginTop: 10 }}>
              {names.map((name) => (
                <a key={name} href={`#/lab/${name}`} className="lcard">
                  <div className="lcard-icon"><LabIcon name={name} color={color} /></div>
                  <h4>{LAB_META[name].title}</h4>
                  <p>{LAB_META[name].blurb}</p>
                  <span className="lcard-pills">
                    <span className="pill">{findSkill(LAB_META[name].skill)?.title}</span>
                    {skillsWithLab(name).length > 1 && <span className="pill lab-shared">{skillsWithLab(name).length} 課共用</span>}
                  </span>
                </a>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/* 單一實驗室獨立頁：全寬，附回課程的連結 */
export function LabPage({ name }) {
  const meta = LAB_META[name]
  useEffect(() => { window.scrollTo({ top: 0 }) }, [name])
  if (!meta) return <p className="status-msg">找不到實驗室：{name}</p>
  const skill = findSkill(meta.skill)
  // 多課共用同一個實驗室時，每一課都列出來（主要的那課在前）
  const lessons = [skill, ...skillsWithLab(name).filter((x) => x.id !== skill?.id)].filter(Boolean)
  const i = LAB_NAMES.indexOf(name)
  const prev = i > 0 ? LAB_NAMES[i - 1] : null
  const next = i < LAB_NAMES.length - 1 ? LAB_NAMES[i + 1] : null
  return (
    <div className="fade-swap" style={{ paddingTop: 24 }}>
      <p className="crumbs">
        <a href="#/">首頁</a> / <a href="#/labs">實驗室</a> / {meta.title}
      </p>
      <LabEmbed name={name} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginTop: 18 }}>
        {lessons.map((x, k) => <a key={x.id} className={`btn${k ? ' ghost' : ''}`} href={`#/skill/${x.id}`}>讀這一課：{x.title} →</a>)}
        <span className="muted" style={{ fontSize: '0.85rem' }}>{lessons.length > 1 ? `${lessons.length} 課共用` : skill?.domain.title}</span>
      </div>
      <nav className="lesson-nav">
        {prev ? <a href={`#/lab/${prev}`}><small>上一個實驗室</small>← {LAB_META[prev].title}</a> : <span />}
        {next ? <a className="next" href={`#/lab/${next}`}><small>下一個實驗室</small>{LAB_META[next].title} →</a> : <span />}
      </nav>
    </div>
  )
}

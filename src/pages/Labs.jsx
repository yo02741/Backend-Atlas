import React, { useEffect } from 'react'
import { LAB_META, LAB_NAMES } from '../labs/index.js'
import { findSkill, DOMAINS } from '../content/roadmap.js'
import { LabIcon, LabEmbed } from '../components/bits.jsx'

/* 實驗室總覽 */
export default function Labs() {
  return (
    <div className="fade-swap">
      <header className="masthead">
        <p className="kicker">LABS · 互動實驗室</p>
        <h1 className="display">動手玩的後端</h1>
        <p className="lede">每個實驗室都是一個可以切、拉、點的小教具。文氏圖跟著 JOIN 變、B-tree 跟著查詢走、簽章真的算給你看。全部在瀏覽器裡跑，不需要後端。</p>
      </header>
      {DOMAINS.map((d) => {
        const names = LAB_NAMES.filter((n) => findSkill(LAB_META[n].skill)?.domain.id === d.id)
        if (!names.length) return null
        const color = `var(--c-${d.color})`
        return (
          <section key={d.id} className="domain-block" style={{ '--tint': color }}>
            <div className="domain-block-head">
              <span className="kicker tinted">0{d.no}</span>
              <h2>{d.title}</h2>
              <span className="count">{names.length} 個</span>
            </div>
            <div className="labs-grid" style={{ marginTop: 10 }}>
              {names.map((name) => (
                <a key={name} href={`#/lab/${name}`} className="lcard">
                  <div className="lcard-icon"><LabIcon name={name} color={color} /></div>
                  <h4>{LAB_META[name].title}</h4>
                  <p>{LAB_META[name].blurb}</p>
                  <span className="pill">{findSkill(LAB_META[name].skill)?.title}</span>
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
        {skill && <a className="btn" href={`#/skill/${skill.id}`}>讀這一課：{skill.title} →</a>}
        <span className="muted" style={{ fontSize: '0.85rem' }}>{skill?.domain.title}</span>
      </div>
      <nav className="lesson-nav">
        {prev ? <a href={`#/lab/${prev}`}><small>上一個實驗室</small>← {LAB_META[prev].title}</a> : <span />}
        {next ? <a className="next" href={`#/lab/${next}`}><small>下一個實驗室</small>{LAB_META[next].title} →</a> : <span />}
      </nav>
    </div>
  )
}

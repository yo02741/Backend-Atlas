import React, { useMemo, useState } from 'react'
import { LEVELS, domainsOf, keywordsOf, displayNo } from '../content/roadmap.js'
import { findTrack } from '../content/tracks.js'
import TrackFilter, { normTrack, withTrack } from '../components/TrackFilter.jsx'
import { useProgress } from '../progress.js'
import { Level } from '../components/bits.jsx'

/* 技能盤點：領域 + 技能列表，可依路線 / 關鍵字 / 難度 / 搜尋過濾。路線與關鍵字在網址上（?track=&kw=） */
export default function Roadmap({ initialKw = '', track: rawTrack = '' }) {
  const track = normTrack(rawTrack)
  const DOMAINS = domainsOf(track)
  const KEYWORDS = keywordsOf(track)
  const [kw, setKw] = useState(initialKw)
  const [level, setLevel] = useState(0)
  const [q, setQ] = useState('')
  const progress = useProgress()
  const { isDone } = progress

  const qn = q.trim().toLowerCase()
  const match = (s) =>
    (!kw || s.keywords.includes(kw)) &&
    (!level || s.level === level) &&
    (!qn || [s.title, s.en, s.summary, s.example.primary, ...s.keywords].join(' ').toLowerCase().includes(qn))

  const total = DOMAINS.reduce((n, d) => n + d.skills.length, 0)
  const shown = DOMAINS.reduce((n, d) => n + d.skills.filter(match).length, 0)
  const filtering = kw || level || qn

  return (
    <div className="fade-swap">
      <header className="masthead">
        <p className="kicker">SKILL INVENTORY · 技能盤點</p>
        <h1 className="display">{track === 'all' ? '技能盤點' : `${findTrack(track).title}技能盤點`}</h1>
        <p className="lede">
          每個技能標示一項範例技術與常見替代品、難度、相關關鍵字；有實驗室的可以直接動手。
        </p>
      </header>

      <TrackFilter value={track} hrefFor={(t) => withTrack('roadmap', t, { kw: keywordsOf(t).includes(kw) ? kw : '' })} />

      <div className="toolbar" role="group" aria-label="篩選">
        <button className={`chip${!kw ? ' on' : ''}`} onClick={() => setKw('')}>全部</button>
        {KEYWORDS.map((k) => (
          <button key={k} className={`chip${kw === k ? ' on' : ''}`} onClick={() => setKw(kw === k ? '' : k)}>{k}</button>
        ))}
        <input className="search" type="search" placeholder="搜尋技能…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜尋技能" />
      </div>
      <div className="toolbar" style={{ marginTop: 0 }}>
        <span className="muted" style={{ fontSize: '0.8rem' }}>難度</span>
        {[1, 2, 3].map((l) => (
          <button key={l} className={`chip${level === l ? ' on' : ''}`} onClick={() => setLevel(level === l ? 0 : l)}>{LEVELS[l]}</button>
        ))}
        <span className="muted" style={{ marginLeft: 'auto', fontSize: '0.8rem' }}>
          {filtering ? `符合 ${shown} / ${total}` : `共 ${total} 個技能`}
        </span>
      </div>

      {DOMAINS.map((d) => {
        const list = d.skills.filter(match)
        if (!list.length) return null
        return <DomainBlock key={d.id} domain={d} skills={list} isDone={isDone} kw={kw} progress={progress} showTrack={track === 'all'} />
      })}
      {shown === 0 && <p className="status-msg">沒有符合的技能</p>}
    </div>
  )
}

export function DomainBlock({ domain: d, skills, isDone, kw, showDesc = true, progress, showTrack = false }) {
  const doneN = d.skills.filter((s) => isDone(s.id)).length
  return (
    <section className="domain-block" style={{ '--tint': `var(--c-${d.color})` }}>
      <div className="domain-block-head">
        <span className="kicker tinted">{showTrack && `${findTrack(d.track).title} `}{displayNo(d)}</span>
        <h2><a href={`#/domain/${d.id}`} style={{ textDecoration: 'none' }}>{d.title}</a></h2>
        <span className="en">{d.en}</span>
        <span className="count">讀過 {doneN} / {d.skills.length}</span>
      </div>
      {showDesc && <p className="desc">{d.tagline}</p>}
      <ul className="skill-list">
        {skills.map((s) => <SkillRow key={s.id} skill={s} done={isDone(s.id)} kw={kw} progress={progress} />)}
      </ul>
    </section>
  )
}

export function SkillRow({ skill: s, done, kw, progress }) {
  return (
    <li>
      <a href={`#/skill/${s.id}`} className={`skill-row${done ? ' done' : ''}`}>
        <span className="check" aria-hidden="true" title={done ? '讀過' : undefined}>✓</span>
        <div>
          <h3>{s.title}<span className="en">{s.en}</span></h3>
          <p>{s.summary}</p>
          <p className="example">範例 <b>{s.example.primary}</b>{s.example.alts?.length ? `　也常見：${s.example.alts.join('、')}` : ''}</p>
        </div>
        <div className="aside">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Level level={s.level} />
            {s.lab && <span className="pill tint" style={{ '--tint': 'var(--tint)' }}>實驗室</span>}
            {progress?.quizzes?.[s.id] === 'pass' && <span className="pill assess-ok">✓ 測驗通過</span>}
          </div>
          {s.keywords.length > 0 && (
            <div className="kw">{s.keywords.map((k) => <span key={k} className={k === kw ? 'hit' : ''}>{k}</span>)}</div>
          )}
        </div>
      </a>
    </li>
  )
}

import React, { useMemo, useState } from 'react'
import { DOMAINS, LEVELS, KEYWORDS } from '../content/roadmap.js'
import { useProgress } from '../progress.js'
import { Level } from '../components/bits.jsx'
import { assessmentFor } from '../assess.js'

/* 技能盤點：全部領域 + 技能列表，可依工作關鍵字 / 難度 / 關鍵字搜尋過濾 */
export default function Roadmap({ initialKw = '' }) {
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
        <p className="kicker">SKILL INVENTORY · 後端工程師技能盤點</p>
        <h1 className="display">後端技能盤點</h1>
        <p className="lede">
          依 roadmap.sh 的 Backend Developer 路線整理。每個技能標示一項範例技術與常見替代品、難度、相關關鍵字；有實驗室的可以直接動手。
        </p>
      </header>

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
        return <DomainBlock key={d.id} domain={d} skills={list} isDone={isDone} kw={kw} progress={progress} />
      })}
      {shown === 0 && <p className="status-msg">沒有符合的技能。換個關鍵字試試。</p>}
    </div>
  )
}

export function DomainBlock({ domain: d, skills, isDone, kw, showDesc = true, progress }) {
  const doneN = d.skills.filter((s) => isDone(s.id)).length
  return (
    <section className="domain-block" style={{ '--tint': `var(--c-${d.color})` }}>
      <div className="domain-block-head">
        <span className="kicker tinted">0{d.no}</span>
        <h2><a href={`#/domain/${d.id}`} style={{ textDecoration: 'none' }}>{d.title}</a></h2>
        <span className="en">{d.en}</span>
        <span className="count">{doneN} / {d.skills.length} 完成</span>
      </div>
      {showDesc && <p className="desc">{d.tagline}</p>}
      <ul className="skill-list">
        {skills.map((s) => <SkillRow key={s.id} skill={s} done={isDone(s.id)} kw={kw} progress={progress} />)}
      </ul>
    </section>
  )
}

export function SkillRow({ skill: s, done, kw, progress }) {
  const assess = progress ? assessmentFor(s.id, progress) : null
  return (
    <li>
      <a href={`#/skill/${s.id}`} className={`skill-row${done ? ' done' : ''}`}>
        <span className="check" aria-hidden="true">✓</span>
        <div>
          <h3>{s.title}<span className="en">{s.en}</span></h3>
          <p>{s.summary}</p>
          <p className="example">範例 <b>{s.example.primary}</b>{s.example.alts?.length ? `　也常見：${s.example.alts.join('、')}` : ''}</p>
        </div>
        <div className="aside">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Level level={s.level} />
            {s.lab && <span className="pill tint" style={{ '--tint': 'var(--tint)' }}>實驗室</span>}
            {assess?.complete && <span className="pill assess-ok">✓ 驗收</span>}
          </div>
          {s.keywords.length > 0 && (
            <div className="kw">{s.keywords.map((k) => <span key={k} className={k === kw ? 'hit' : ''}>{k}</span>)}</div>
          )}
        </div>
      </a>
    </li>
  )
}

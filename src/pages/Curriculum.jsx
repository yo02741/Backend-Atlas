import React, { useEffect, useMemo } from 'react'
import Markdown, { toc } from '../components/Markdown.jsx'
import curriculumMd from '../../docs/CURRICULUM.md?raw'
import { SCENARIOS, groupOf } from '../content/scenarios/index.js'

/* 課綱頁：渲染 docs/CURRICULUM.md（獨立盤點的技能樹、差距分析、16 週課綱、驗收設計）。
   每週標題下掛本站對應該週的設計情境（scenario.week）；#/curriculum?week=10 會捲到第 10 週。 */
const WEEK_RE = /^第 (\d+) 週/
const weekOf = (b) => (b.type === 'h' ? WEEK_RE.exec(b.text)?.[1] : null)
const idFor = (b, dflt) => { const w = weekOf(b); return w ? `week-${w}` : dflt }

export default function Curriculum({ week = '' }) {
  const items = useMemo(() => toc(curriculumMd, idFor), [])
  const byWeek = useMemo(() => {
    const m = new Map()
    for (const s of SCENARIOS) if (s.week) m.set(String(s.week), [...(m.get(String(s.week)) || []), s])
    return m
  }, [])
  useEffect(() => {
    if (!week) return
    // 等這一輪 layout 完成再捲（App 的換頁效果先跑）；標題有 scroll-margin-top 讓它不被 topnav 蓋住
    const id = requestAnimationFrame(() => document.getElementById(`week-${week}`)?.scrollIntoView({ block: 'start', behavior: 'instant' }))
    return () => cancelAnimationFrame(id)
  }, [week])
  const after = (b) => {
    const w = weekOf(b)
    const list = w && byWeek.get(w)
    if (!list?.length) return null
    return (
      <div className="curri-week-links">
        <span className="kicker">本週的設計情境</span>
        {list.map((s) => {
          const g = groupOf(s)
          return <a key={s.id} href={`#/scenario/${s.id}`} className="pill tint" style={{ '--tint': `var(--c-${g.color})` }} title={g.title}>{s.title}</a>
        })}
      </div>
    )
  }
  return (
    <div className="fade-swap">
      <header className="masthead">
        <p className="kicker">CURRICULUM · 技能樹與 16 週課綱</p>
        <h1 className="display">課綱</h1>
        <p className="lede">完整的技能樹、16 週課綱（每週有可驗證的目標、動手作業與驗收標準，三個里程碑專案）與驗收方式設計。以已有程式開發經驗、想系統地補後端基礎的工程師為對象。每週標題下列出本站對應那一週的設計情境。</p>
      </header>
      <div className="curri">
        <aside className="curri-toc">
          <p className="kicker">目錄</p>
          <ul>
            {items.map((t) => <li key={t.id} className={`lv${t.level}`}><a href={`#/curriculum#${t.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(t.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>{t.text}</a></li>)}
          </ul>
        </aside>
        <div className="curri-body">
          <Markdown text={curriculumMd} idFor={idFor} after={after} />
        </div>
      </div>
    </div>
  )
}

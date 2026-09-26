import React, { useMemo } from 'react'
import Markdown, { toc } from '../components/Markdown.jsx'
import curriculumMd from '../../docs/CURRICULUM.md?raw'

/* 課綱頁：渲染 docs/CURRICULUM.md（獨立盤點的技能樹、差距分析、16 週課綱、驗收設計） */
export default function Curriculum() {
  const items = useMemo(() => toc(curriculumMd), [])
  return (
    <div className="fade-swap">
      <header className="masthead">
        <p className="kicker">CURRICULUM · 技能樹與 16 週課綱</p>
        <h1 className="display">課綱</h1>
        <p className="lede">完整的技能樹、16 週課綱（每週有可驗證的目標、動手作業與驗收標準，三個里程碑專案）與驗收方式設計。以已有程式開發經驗、想系統地補後端基礎的工程師為對象。</p>
      </header>
      <div className="curri">
        <aside className="curri-toc">
          <p className="kicker">目錄</p>
          <ul>
            {items.map((t) => <li key={t.id} className={`lv${t.level}`}><a href={`#/curriculum#${t.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(t.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>{t.text}</a></li>)}
          </ul>
        </aside>
        <div className="curri-body">
          <Markdown text={curriculumMd} />
        </div>
      </div>
    </div>
  )
}

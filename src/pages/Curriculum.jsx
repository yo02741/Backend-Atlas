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
        <p className="lede">由另一位「資深後端主管」角色獨立盤點的技能樹（9 領域、89 技能）、與本站 8 領域 / 59 技能的差距分析、16 週課綱（含三個里程碑專案與每週驗收標準），以及題庫的量產格式。本站的技能盤點與練習題會持續依它修正。</p>
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

import React, { useEffect, useMemo } from 'react'
import Markdown, { toc } from '../components/Markdown.jsx'
import { SCENARIOS, groupOf } from '../content/scenarios/index.js'
import { TRACKS } from '../content/tracks.js'
import { withTrack } from '../components/TrackFilter.jsx'

/* 課綱頁：每條路線的課綱檔在 tracks.js 的 curriculum（後端與 AI 共用 docs/CURRICULUM.md：技能樹、16 週主線、6 週延伸、
   Docker 到 Kubernetes 專題、驗收設計；前端是 docs/CURRICULUM-frontend.md）。#/curriculum?track=frontend 切換，沒帶時是後端。
   每週標題下掛本站對應該週的設計情境（scenario.week，限同一份課綱的路線）；?week=10 會捲到第 10 週。 */
const FILES = import.meta.glob('../../docs/CURRICULUM*.md', { query: '?raw', import: 'default', eager: true })
// 每份課綱一個選項：名稱是共用它的路線
const BOOKS = [...new Set(TRACKS.map((t) => t.curriculum))]
  .filter((f) => FILES[`../../${f}`])
  .map((f) => ({ file: f, tracks: TRACKS.filter((t) => t.curriculum === f) }))
const WEEK_RE = /^第 (\d+) 週/
const weekOf = (b) => (b.type === 'h' ? WEEK_RE.exec(b.text)?.[1] : null)
const idFor = (b, dflt) => { const w = weekOf(b); return w ? `week-${w}` : dflt }

export default function Curriculum({ week = '', track = '' }) {
  const book = BOOKS.find((b) => b.tracks.some((t) => t.id === track)) || BOOKS.find((b) => b.tracks.some((t) => t.id === 'backend'))
  const curriculumMd = FILES[`../../${book.file}`]
  const items = useMemo(() => toc(curriculumMd, idFor), [curriculumMd])
  const byWeek = useMemo(() => {
    const m = new Map()
    for (const s of SCENARIOS) if (s.week && book.tracks.some((t) => t.id === groupOf(s).track)) m.set(String(s.week), [...(m.get(String(s.week)) || []), s])
    return m
  }, [book])
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
        <p className="kicker">CURRICULUM · 技能樹、主線、延伸與 K8s 專題</p>
        <h1 className="display">課綱</h1>
      </header>
      {BOOKS.length > 1 && (
        <div className="toolbar track-filter" role="group" aria-label="課綱">
          {BOOKS.map((b) => (
            <a key={b.file} href={withTrack('curriculum', b.tracks[0].id)} className={`chip${b === book ? ' on' : ''}`}
               aria-current={b === book ? 'true' : undefined}>{b.tracks.map((t) => t.title).join('、')}</a>
          ))}
        </div>
      )}
      <div className="curri">
        <aside className="curri-toc">
          <p className="kicker">目錄</p>
          <ul>
            {items.map((t) => <li key={t.id} className={`lv${t.level}`}><a href={`${withTrack('curriculum', book.tracks[0].id)}#${t.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(t.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>{t.text}</a></li>)}
          </ul>
        </aside>
        <div className="curri-body">
          <Markdown text={curriculumMd} idFor={idFor} after={after} />
        </div>
      </div>
    </div>
  )
}

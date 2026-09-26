import React, { Suspense, lazy, useEffect, useState, useTransition } from 'react'
import Home from './pages/Home.jsx'
import { findSkill, findDomain } from './content/roadmap.js'
import { findScenario } from './content/scenarios/index.js'
import { findExercise } from './content/exercises/index.js'
import { LAB_META } from './labs/index.js'

/* 首頁以外的頁面都懶載入：CodeMirror、題庫、課綱 markdown 只在真的進到那一頁時才下載。
   換頁走 startTransition：舊頁面留在畫面上直到新 chunk 到齊，不會閃出「載入中」；等待期間頂端顯示進度條。 */
const Roadmap = lazy(() => import('./pages/Roadmap.jsx'))
const Domain = lazy(() => import('./pages/Domain.jsx'))
const Skill = lazy(() => import('./pages/Skill.jsx'))
const Labs = lazy(() => import('./pages/Labs.jsx'))
const LabPage = lazy(() => import('./pages/Labs.jsx').then((m) => ({ default: m.LabPage })))
const Playground = lazy(() => import('./pages/Playground.jsx'))
const Exercises = lazy(() => import('./pages/Exercises.jsx'))
const ExercisePage = lazy(() => import('./pages/Exercises.jsx').then((m) => ({ default: m.ExercisePage })))
const Curriculum = lazy(() => import('./pages/Curriculum.jsx'))
const Scenarios = lazy(() => import('./pages/Scenarios.jsx'))
const ScenarioPage = lazy(() => import('./pages/Scenarios.jsx').then((m) => ({ default: m.ScenarioPage })))

/* hash 路由：#/、#/roadmap（?kw=）、#/domain/:id、#/skill/:id、#/labs、#/lab/:Name */
function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash)
  const [pending, startTransition] = useTransition()
  useEffect(() => {
    const on = () => startTransition(() => setHash(window.location.hash))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return { ...parseHash(hash), pending }
}

function parseHash(hash) {
  const raw = hash.replace(/^#\/?/, '')
  const [path, query = ''] = raw.split('?')
  const params = new URLSearchParams(query)
  const seg = path.split('/').filter(Boolean)
  if (seg.length === 0) return { view: 'home' }
  if (seg[0] === 'roadmap') return { view: 'roadmap', kw: params.get('kw') || '' }
  if (seg[0] === 'domain' && seg[1]) return { view: 'domain', id: seg[1] }
  if (seg[0] === 'skill' && seg[1]) return { view: 'skill', id: seg[1] }
  if (seg[0] === 'labs') return { view: 'labs' }
  if (seg[0] === 'lab' && seg[1]) return { view: 'lab', name: seg[1] }
  if (seg[0] === 'exercises') return { view: 'exercises' }
  if (seg[0] === 'curriculum') return { view: 'curriculum', week: params.get('week') || '' }
  if (seg[0] === 'scenarios') return { view: 'scenarios' }
  if (seg[0] === 'scenario' && seg[1]) return { view: 'scenario', id: seg[1] }
  if (seg[0] === 'exercise' && seg[1]) return { view: 'exercise', id: seg[1] }
  if (seg[0] === 'playground') return { view: 'playground', lang: params.get('lang') || seg[1] || 'python' }
  return { view: 'home' }
}


/* 每頁的瀏覽器分頁標題：書籤與歷史紀錄才分得出是哪一頁 */
const SITE = 'Backend Atlas'
const SECTION_TITLES = { roadmap: '技能盤點', labs: '實驗室', exercises: '練習題', curriculum: '課綱', scenarios: '設計情境', playground: 'Playground' }
function titleFor(route) {
  switch (route.view) {
    case 'skill': return findSkill(route.id)?.title
    case 'domain': return findDomain(route.id)?.title
    case 'lab': return LAB_META[route.name]?.title
    case 'scenario': return findScenario(route.id)?.title
    case 'exercise': return findExercise(route.id)?.title
    default: return SECTION_TITLES[route.view]
  }
}

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('theme')
      if (saved === 'light' || saved === 'dark') return saved
    } catch { /* ignore */ }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem('theme', theme) } catch { /* ignore */ }
  }, [theme])
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))]
}

export default function App() {
  const route = useHashRoute()
  const [theme, toggleTheme] = useTheme()
  useEffect(() => {
    // 技能頁自己處理捲動（要停在頁首）；其他頁換路由回到頂端
    // 課綱帶 ?week= 時由課綱頁自己捲到那一週
    if (!['skill', 'lab', 'exercise', 'scenario'].includes(route.view) && !(route.view === 'curriculum' && route.week)) window.scrollTo({ top: 0 })
    const t = titleFor(route)
    document.title = t ? `${t} · ${SITE}` : `${SITE} · 後端學習地圖`
  }, [route.view, route.id, route.name, route.lang])

  let page
  switch (route.view) {
    case 'roadmap': page = <Roadmap key={route.kw} initialKw={route.kw} />; break
    case 'domain': page = <Domain id={route.id} />; break
    case 'skill': page = <Skill id={route.id} />; break
    case 'labs': page = <Labs />; break
    case 'lab': page = <LabPage name={route.name} />; break
    case 'exercises': page = <Exercises />; break
    case 'curriculum': page = <Curriculum week={route.week} />; break
    case 'scenarios': page = <Scenarios />; break
    case 'scenario': page = <ScenarioPage id={route.id} />; break
    case 'exercise': page = <ExercisePage id={route.id} />; break
    case 'playground': page = <Playground key={route.lang} initialLang={route.lang} />; break
    default: page = <Home />
  }

  return (
    <Shell theme={theme} toggleTheme={toggleTheme} view={route.view} pending={route.pending}>
      <Suspense fallback={<p className="status-msg">載入中…</p>}>{page}</Suspense>
    </Shell>
  )
}

function Shell({ theme, toggleTheme, view, pending, children }) {
  const [open, setOpen] = useState(false)
  useEffect(() => { setOpen(false) }, [view])
  const link = (href, label, active) => (
    <a href={href} className={active ? 'active' : ''}>{label}</a>
  )
  return (
    <div className="page">
      <div className="bg-aurora" aria-hidden="true"><span /><span /><span /></div>
      {pending && <div className="route-progress" role="progressbar" aria-label="載入頁面中" />}
      <nav className="topnav">
        <a href="#/" className="brand" aria-label="Backend Atlas 首頁">
          <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" fill="none" stroke="var(--accent)" strokeWidth="2.5" />
            <circle cx="12" cy="12" r="3" fill="var(--accent)" />
          </svg>
          <span className="brand-name">Backend Atlas</span>
          <span className="brand-sub">後端學習地圖</span>
        </a>
        <div className={`topnav-links${open ? ' open' : ''}`}>
          {link('#/roadmap', '技能盤點', view === 'roadmap' || view === 'domain' || view === 'skill')}
          {link('#/curriculum', '課綱', view === 'curriculum')}
          {link('#/labs', '實驗室', view === 'labs' || view === 'lab')}
          {link('#/scenarios', '設計情境', view === 'scenarios' || view === 'scenario')}
          {link('#/exercises', '練習題', view === 'exercises' || view === 'exercise')}
          {link('#/playground', 'Playground', view === 'playground')}
        </div>
        <div className="topnav-right">
          <button className="theme-btn" onClick={toggleTheme}
                  title={theme === 'dark' ? '切換明亮模式' : '切換暗黑模式'}
                  aria-label={theme === 'dark' ? '切換明亮模式' : '切換暗黑模式'}>
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <button className="nav-toggle" aria-label="選單" aria-expanded={open} onClick={() => setOpen((o) => !o)}>☰</button>
        </div>
      </nav>
      {children}
      <footer className="colophon">
        <span>Backend Atlas — 看得見的後端基礎。進度只存在你的瀏覽器。</span>
        <span><a href="https://github.com/yo02741/Backend-Atlas" target="_blank" rel="noreferrer">GitHub</a> · <a href="https://roadmap.sh/backend" target="_blank" rel="noreferrer">roadmap.sh/backend</a></span>
      </footer>
      <BackToTop />
    </div>
  )
}

function BackToTop() {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const on = () => setVisible(window.scrollY > window.innerHeight)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  if (!visible) return null
  return (
    <button className="back-to-top" aria-label="回到頂部" title="回到頂部"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>↑</button>
  )
}

import React, { useEffect, useState } from 'react'
import Home from './pages/Home.jsx'
import Roadmap from './pages/Roadmap.jsx'
import Domain from './pages/Domain.jsx'
import Skill from './pages/Skill.jsx'
import Labs, { LabPage } from './pages/Labs.jsx'
import Playground from './pages/Playground.jsx'
import Exercises, { ExercisePage } from './pages/Exercises.jsx'
import Curriculum from './pages/Curriculum.jsx'

/* hash 路由：#/、#/roadmap（?kw=）、#/domain/:id、#/skill/:id、#/labs、#/lab/:Name */
function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const on = () => setHash(window.location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
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
  if (seg[0] === 'curriculum') return { view: 'curriculum' }
  if (seg[0] === 'exercise' && seg[1]) return { view: 'exercise', id: seg[1] }
  if (seg[0] === 'playground') return { view: 'playground', lang: params.get('lang') || seg[1] || 'python' }
  return { view: 'home' }
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
    if (!['skill', 'lab', 'exercise'].includes(route.view)) window.scrollTo({ top: 0 })
  }, [route.view, route.id, route.name])

  let page
  switch (route.view) {
    case 'roadmap': page = <Roadmap key={route.kw} initialKw={route.kw} />; break
    case 'domain': page = <Domain id={route.id} />; break
    case 'skill': page = <Skill id={route.id} />; break
    case 'labs': page = <Labs />; break
    case 'lab': page = <LabPage name={route.name} />; break
    case 'exercises': page = <Exercises />; break
    case 'curriculum': page = <Curriculum />; break
    case 'exercise': page = <ExercisePage id={route.id} />; break
    case 'playground': page = <Playground key={route.lang} initialLang={route.lang} />; break
    default: page = <Home />
  }

  return (
    <Shell theme={theme} toggleTheme={toggleTheme} view={route.view}>
      {page}
    </Shell>
  )
}

function Shell({ theme, toggleTheme, view, children }) {
  const [open, setOpen] = useState(false)
  useEffect(() => { setOpen(false) }, [view])
  const link = (href, label, active) => (
    <a href={href} className={active ? 'active' : ''}>{label}</a>
  )
  return (
    <div className="page">
      <div className="bg-aurora" aria-hidden="true"><span /><span /><span /></div>
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

import React, { Suspense, lazy, useEffect, useState, useTransition } from 'react'
import Home from './pages/Home.jsx'
import { findSkill, findDomain, domainsOf } from './content/roadmap.js'
import { TRACKS, SITE as SITE_INFO, findTrack } from './content/tracks.js'
import { trackOfRoute, rememberTrack } from './track.js'
import { withTrack } from './components/TrackFilter.jsx'
import BrandMark from './components/BrandMark.jsx'
import { findScenario } from './content/scenarios/index.js'
import { findExercise } from './content/exercises/index.js'
import { LAB_META } from './labs/index.js'
import { findStage } from './content/project/stages.js'
import Account from './components/Account.jsx'
import { cloudEnabled } from './cloud/config.js'

/* 首頁以外的頁面都懶載入：CodeMirror、題庫、課綱 markdown 只在真的進到那一頁時才下載。
   換頁走 startTransition：舊頁面留在畫面上直到新 chunk 到齊，不會閃出「載入中」；等待期間頂端顯示進度條。 */
const TrackHome = lazy(() => import('./pages/TrackHome.jsx'))
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
const Project = lazy(() => import('./pages/Project.jsx'))
const Review = lazy(() => import('./pages/Review.jsx'))

/* hash 路由：#/（選路線）、#/track/:id（路線首頁）、#/roadmap（?track=&kw=）、#/domain/:id、#/skill/:id、
   #/labs、#/exercises、#/scenarios、#/review（?track=&seed=）、#/curriculum（?track=&week=）、#/lab/:Name …
   列表頁的 ?track= 是路線篩選；單頁的路線由內容推出（src/track.js）。 */
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
  const track = params.get('track') || ''
  if (seg.length === 0) return { view: 'home' }
  if (seg[0] === 'track' && seg[1]) return { view: 'track', id: seg[1] }
  if (seg[0] === 'roadmap') return { view: 'roadmap', kw: params.get('kw') || '', track }
  if (seg[0] === 'domain' && seg[1]) return { view: 'domain', id: seg[1] }
  if (seg[0] === 'skill' && seg[1]) return { view: 'skill', id: seg[1] }
  if (seg[0] === 'labs') return { view: 'labs', track }
  if (seg[0] === 'lab' && seg[1]) return { view: 'lab', name: seg[1] }
  if (seg[0] === 'exercises') return { view: 'exercises', track }
  if (seg[0] === 'curriculum') return { view: 'curriculum', week: params.get('week') || '', track }
  if (seg[0] === 'scenarios') return { view: 'scenarios', track }
  if (seg[0] === 'scenario' && seg[1]) return { view: 'scenario', id: seg[1] }
  if (seg[0] === 'exercise' && seg[1]) return { view: 'exercise', id: seg[1] }
  if (seg[0] === 'project') return { view: 'project', id: seg[1] || '', track }
  if (seg[0] === 'review') return { view: 'review', seed: params.get('seed') || '', track }
  if (seg[0] === 'playground') return { view: 'playground', lang: params.get('lang') || seg[1] || 'python', code: params.get('code') || '' }
  return { view: 'home' }
}


/* 每頁的瀏覽器分頁標題：書籤與歷史紀錄才分得出是哪一頁 */
const SITE = SITE_INFO.name
const SECTION_TITLES = { roadmap: '技能盤點', labs: '實驗室', exercises: '練習題', curriculum: '課綱', scenarios: '設計情境', playground: 'Playground', project: '實作路線', review: '複習' }
function titleFor(route) {
  switch (route.view) {
    case 'track': return findTrack(route.id)?.title
    case 'skill': return findSkill(route.id)?.title
    case 'domain': return findDomain(route.id)?.title
    case 'lab': return LAB_META[route.name]?.title
    case 'scenario': return findScenario(route.id)?.title
    case 'exercise': return findExercise(route.id)?.title
    case 'project': return route.id ? (findStage(route.id)?.title || '實作路線') : '實作路線'
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
  const track = trackOfRoute(route)
  useEffect(() => { if (track) rememberTrack(track) }, [track])
  useEffect(() => {
    // 技能頁自己處理捲動（要停在頁首）；其他頁換路由回到頂端
    // 課綱帶 ?week= 時由課綱頁自己捲到那一週
    if (!['skill', 'lab', 'exercise', 'scenario'].includes(route.view) && !(route.view === 'curriculum' && route.week)) window.scrollTo({ top: 0 })
    const t = titleFor(route)
    document.title = t ? `${t} · ${SITE}` : SITE
  }, [route.view, route.id, route.name, route.lang])

  let page
  switch (route.view) {
    case 'track': page = <TrackHome key={route.id} id={route.id} />; break
    case 'roadmap': page = <Roadmap key={route.kw + route.track} initialKw={route.kw} track={route.track} />; break
    case 'domain': page = <Domain id={route.id} />; break
    case 'skill': page = <Skill id={route.id} />; break
    case 'labs': page = <Labs track={route.track} />; break
    case 'lab': page = <LabPage name={route.name} />; break
    case 'exercises': page = <Exercises key={route.track} track={route.track} />; break
    case 'project': page = <Project key={route.id + route.track} id={route.id} track={route.track} />; break
    case 'review': page = <Review key={route.seed + route.track} seed={route.seed} track={route.track} />; break
    case 'curriculum': page = <Curriculum key={route.track} week={route.week} track={route.track} />; break
    case 'scenarios': page = <Scenarios track={route.track} />; break
    case 'scenario': page = <ScenarioPage id={route.id} />; break
    case 'exercise': page = <ExercisePage id={route.id} />; break
    case 'playground': page = <Playground key={route.lang + route.code} initialLang={route.lang} initialCode={route.code} />; break
    default: page = <Home />
  }

  return (
    <Shell theme={theme} toggleTheme={toggleTheme} view={route.view} track={track} pending={route.pending}>
      <Suspense fallback={<p className="status-msg">載入中…</p>}>{page}</Suspense>
    </Shell>
  )
}

function Shell({ theme, toggleTheme, view, track, pending, children }) {
  const [open, setOpen] = useState(false)
  useEffect(() => { setOpen(false) }, [view, track])
  const link = (href, label, active) => (
    <a href={href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>{label}</a>
  )
  // 功能頁的連結帶上目前的路線（在首頁沒有路線時列全部）
  const scoped = (base) => withTrack(base, track)
  const curTrack = findTrack(track)
  return (
    <div className="page">
      <div className="bg-aurora" aria-hidden="true"><span /><span /><span /></div>
      {pending && <div className="route-progress" role="progressbar" aria-label="載入頁面中" />}
      <nav className="topnav">
        <a href="#/" className="brand" aria-label={`${SITE} 首頁`}>
          <BrandMark className="brand-mark" />
          <span className="brand-name">{SITE}</span>
        </a>
        <div className="track-tabs" role="group" aria-label="路線">
          {TRACKS.map((t) => (
            <a key={t.id} href={`#/track/${t.id}`} style={{ '--tint': `var(--c-${t.color})` }}
               className={`track-tab${track === t.id ? ' on' : ''}${domainsOf(t.id).length ? '' : ' soon'}`}
               aria-current={track === t.id ? 'true' : undefined}>{t.title}</a>
          ))}
        </div>
        <div className={`topnav-links${open ? ' open' : ''}`}>
          {link(scoped('roadmap'), '技能盤點', view === 'roadmap' || view === 'domain' || view === 'skill')}
          {link(withTrack('curriculum', curTrack && curTrack.id), '課綱', view === 'curriculum')}
          {link(scoped('labs'), '實驗室', view === 'labs' || view === 'lab')}
          {link(scoped('scenarios'), '設計情境', view === 'scenarios' || view === 'scenario')}
          {link(scoped('exercises'), '練習題', view === 'exercises' || view === 'exercise')}
          {link('#/playground', 'Playground', view === 'playground')}
        </div>
        <div className="topnav-right">
          <Account />
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
        <span>{SITE}：叫得出名字、說得出要求、驗得出對錯。{cloudEnabled ? '進度存在你的瀏覽器，登入後同步到你的帳號。' : '進度只存在你的瀏覽器。'}</span>
        <span><a href={SITE_INFO.repo} target="_blank" rel="noreferrer">GitHub</a></span>
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

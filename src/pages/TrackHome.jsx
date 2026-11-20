import React from 'react'
import { domainsOf, plannedDomainsOf, keywordsOf, skillsOf, skillsByKeyword, stationsOf, findSkill, displayNo } from '../content/roadmap.js'
import { findTrack, TRACKS } from '../content/tracks.js'
import { LAB_META } from '../labs/index.js'
import { useProgress } from '../progress.js'
import { ProgressRing, LabIcon } from '../components/bits.jsx'
import MetroMap from '../components/MetroMap.jsx'
import HeroArt from '../components/HeroArt.jsx'
import { EXERCISES } from '../content/exercises/index.js'
import { SCENARIOS, groupOf } from '../content/scenarios/index.js'
import { withTrack } from '../components/TrackFilter.jsx'
import { stagesOf } from '../content/project/stages.js'
import { assignmentsOf } from '../content/assignments.js'
import { countsOf } from '../counts.js'

/* 路線首頁 #/track/<id>：hero、學習路線圖、領域、關鍵字、設計情境、精選實驗室。
   還沒有課的路線列出規劃中的領域。 */
export default function TrackHome({ id }) {
  const t = findTrack(id)
  const { done, isDone } = useProgress()
  if (!t) return <p className="status-msg">找不到路線：{id}</p>
  const domains = domainsOf(t.id)
  const skills = skillsOf(t.id)
  const color = `var(--c-${t.color})`
  if (!skills.length) return <TrackSoon t={t} />

  const stations = stationsOf(t.id)
  const doneHere = skills.filter((s) => isDone(s.id)).length
  const nextStation = stations.find((s) => !isDone(s.id)) || stations[0] || skills[0]
  const c = countsOf(t.id)
  const assignments = assignmentsOf(t.id)
  const exCount = EXERCISES.filter((e) => !e.project && skills.some((s) => s.id === e.skill)).length
  const scenarios = SCENARIOS.filter((sc) => groupOf(sc).track === t.id)
  const keywords = keywordsOf(t.id)

  return (
    <div className="fade-swap" style={{ '--tint': color }}>
      <section className={`hero${t.id === 'backend' ? '' : ' hero-solo'}`}>
        <div className="hero-copy">
          <p className="crumbs"><a href="#/">首頁</a> / {t.title}</p>
          <p className="kicker tinted">{t.en}</p>
          <h1 className="display">{t.title}</h1>
          <p className="lede">{t.lede}</p>
          <div className="hero-actions">
            <a className="btn" href={`#/skill/${nextStation.id}`}>
              {doneHere ? `繼續：${nextStation.label || nextStation.title}` : '從第一站開始'} →
            </a>
            <a className="btn ghost" href={withTrack('roadmap', t.id)}>技能盤點</a>
            {stagesOf(t.id).length > 0 && <a className="btn ghost" href={withTrack('project', t.id)}>實作路線</a>}
            {assignments.length > 0 && <a className="btn ghost" href={withTrack('assignments', t.id)}>跨課作業</a>}
          </div>
          <div className="hero-stats">
            {(c.stations > 0 || c.weeks > 0) && (
              <div className="stat-group" role="group" aria-label="主線">
                <span className="stat-group-label">主線</span>
                {c.stations > 0 && <div className="stat"><b>{c.stations}</b><span>路線站</span></div>}
                {c.weeks > 0 && <div className="stat"><b>{c.weeks}</b><span>課綱週</span></div>}
              </div>
            )}
            <div className="stat-group" role="group" aria-label="全部">
              <span className="stat-group-label">全部（主線以外選讀）</span>
              <div className="stat"><b>{skills.length}</b><span>課 · {domains.length} 領域</span></div>
              {c.labs > 0 && <div className="stat"><b>{c.labs}</b><span>實驗室{c.labMounts > c.labs ? `（${c.labMounts} 課掛載）` : ''}</span></div>}
              {exCount > 0 && <div className="stat"><b>{exCount}</b><span>程式題</span></div>}
              {scenarios.length > 0 && <div className="stat"><b>{scenarios.length}</b><span>設計情境</span></div>}
              {assignments.length > 0 && <div className="stat"><b>{assignments.length}</b><span>跨課作業</span></div>}
            </div>
            <div className="stat"><b>{doneHere}</b><span>讀過</span></div>
          </div>
        </div>
        {t.id === 'backend' && <div className="hero-art"><HeroArt /></div>}
      </section>

      {stations.length > 0 && (
        <section className="home-section" id="route">
          <div className="section-head">
            <h2 className="section-title">學習路線</h2>
            <p>主線 {stations.length} 站，其餘 {c.optional} 課選讀。<a href={withTrack('curriculum', t.id)}>完整課綱{c.weeks ? `（${c.weeks} 週）` : ''} →</a>{stagesOf(t.id).length > 0 && <>　<a href={withTrack('project', t.id)}>實作路線 →</a></>}{assignments.length > 0 && <>　<a href={withTrack('assignments', t.id)}>跨課作業 →</a></>}</p>
          </div>
          <MetroMap stations={stations} isDone={isDone} label={`${t.title}學習路線`} />
          <div className="metro-legend">
            {domains.filter((d) => stations.some((s) => s.domain.id === d.id)).map((d) => (
              <span key={d.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <i style={{ width: 8, height: 8, borderRadius: '50%', background: `var(--c-${d.color})`, display: 'inline-block' }} />{d.title}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="home-section">
        <div className="section-head">
          <h2 className="section-title">{domains.length} 個領域</h2>
          {t.domainNote && <p>{t.domainNote}</p>}
        </div>
        <DomainGrid domains={domains} isDone={isDone} />
      </section>

      {keywords.length > 0 && (
        <section className="home-section">
          <div className="section-head"><h2 className="section-title">從技術名詞找課</h2></div>
          <div className="kw-cloud">
            {keywords.map((k) => (
              <a key={k} href={withTrack('roadmap', t.id, { kw: k })}>{k}<small>{skillsByKeyword(k, t.id).length} 課</small></a>
            ))}
          </div>
        </section>
      )}

      {scenarios.length > 0 && (
        <section className="home-section">
          <div className="section-head">
            <h2 className="section-title">設計情境</h2>
            <a href={withTrack('scenarios', t.id)} className="muted" style={{ fontSize: '0.88rem' }}>全部 {scenarios.length} 個 →</a>
          </div>
          <div className="scen-grid">
            {scenarios.slice(0, 6).map((sc) => {
              const g = groupOf(sc)
              return (
                <a key={sc.id} href={`#/scenario/${sc.id}`} className="scen-card" style={{ '--tint': `var(--c-${g.color})` }}>
                  <div className="scen-card-head"><span className="kicker tinted" style={{ '--tint': `var(--c-${g.color})` }}>{g.title}</span></div>
                  <h3>{sc.title}</h3>
                  <p>{sc.summary}</p>
                  <div className="scen-card-opts">{sc.options.map((o) => <span key={o.id}>{o.name}</span>)}</div>
                </a>
              )
            })}
          </div>
        </section>
      )}

      {t.featuredLabs.length > 0 && (
        <section className="home-section">
          <div className="section-head">
            <h2 className="section-title">互動實驗室精選</h2>
            <a href={withTrack('labs', t.id)} className="muted" style={{ fontSize: '0.88rem' }}>全部 {c.labs} 個 →</a>
          </div>
          <div className="lab-strip">
            {t.featuredLabs.map((name) => {
              const meta = LAB_META[name]
              const skill = findSkill(meta.skill)
              const c = `var(--c-${skill.domain.color})`
              return (
                <a key={name} href={`#/lab/${name}`} className="lcard">
                  <div className="lcard-icon"><LabIcon name={name} color={c} /></div>
                  <h4>{meta.title}</h4>
                  <p>{meta.blurb}</p>
                  <span className="pill tint" style={{ '--tint': c }}>{skill.domain.title}</span>
                </a>
              )
            })}
          </div>
        </section>
      )}

      <OtherTracks current={t.id} />
    </div>
  )
}

function DomainGrid({ domains, isDone }) {
  return (
    <div className="domain-grid">
      {domains.map((d) => {
        const doneN = d.skills.filter((s) => isDone(s.id)).length
        const kws = [...new Set(d.skills.flatMap((s) => s.keywords))].slice(0, 4)
        return (
          <a key={d.id} href={`#/domain/${d.id}`} className="dcard" style={{ '--tint': `var(--c-${d.color})` }}>
            <div className="dcard-head">
              <span className="dcard-no">{displayNo(d)}</span>
              <ProgressRing value={doneN} total={d.skills.length} color={`var(--c-${d.color})`} />
            </div>
            <h3>{d.title}</h3>
            <p>{d.tagline}</p>
            <div className="dcard-meta">
              <span>{d.skills.length} 課 · {d.skills.filter((s) => s.lab).length} 實驗室 · 讀過 {doneN}</span>
            </div>
            {kws.length > 0 && <div className="dcard-tags">{kws.map((k) => <span key={k}>{k}</span>)}</div>}
          </a>
        )
      })}
    </div>
  )
}

/* 還沒有課的路線：列出規劃中的領域 */
function TrackSoon({ t }) {
  const planned = plannedDomainsOf(t.id)
  return (
    <div className="fade-swap" style={{ '--tint': `var(--c-${t.color})` }}>
      <header className="masthead">
        <p className="crumbs"><a href="#/">首頁</a> / {t.title}</p>
        <p className="kicker tinted">{t.en} · 撰寫中</p>
        <h1 className="display">{t.title}</h1>
        <p className="lede">{t.tagline}</p>
      </header>
      <section className="home-section">
        <div className="section-head"><h2 className="section-title">規劃中的 {planned.length} 個領域</h2></div>
        <ol className="soon-list">
          {planned.map((d) => (
            <li key={d.id} style={{ '--tint': `var(--c-${d.color})` }}>
              <span className="dcard-no">{displayNo(d)}</span>
              <div><b>{d.title}</b><p>{d.tagline}</p></div>
            </li>
          ))}
        </ol>
      </section>
      <OtherTracks current={t.id} />
    </div>
  )
}

function OtherTracks({ current }) {
  const others = TRACKS.filter((x) => x.id !== current && domainsOf(x.id).length)
  if (!others.length) return null
  return (
    <section className="home-section other-tracks">
      <div className="section-head"><h2 className="section-title">其他路線</h2></div>
      <div className="other-tracks-row">
        {others.map((x) => (
          <a key={x.id} href={`#/track/${x.id}`} className="pill tint" style={{ '--tint': `var(--c-${x.color})` }}>{x.title}：{skillsOf(x.id).length} 課 →</a>
        ))}
      </div>
    </section>
  )
}

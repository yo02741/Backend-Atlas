import React, { useEffect } from 'react'
import { SCENARIOS, SCENARIO_GROUPS, findScenario, scenariosInGroup, groupOf } from '../content/scenarios/index.js'
import { findSkill, LEVELS } from '../content/roadmap.js'
import { findExercise } from '../content/exercises/index.js'
import { useProgress } from '../progress.js'
import { Level, LabEmbed } from '../components/bits.jsx'
import Md from '../components/Md.jsx'
import Decisions from '../components/Decisions.jsx'
import Challenge from '../components/Challenge.jsx'
import { Code } from '../labs/ui.jsx'
import TrackFilter, { normTrack, withTrack } from '../components/TrackFilter.jsx'
import { TRACKS } from '../content/tracks.js'
const TRACK_TITLE = Object.fromEntries(TRACKS.map((t) => [t.id, t.title]))

/* 設計情境總覽：依路線（?track=，由情境分組的 track 決定）與分組分段 */
export default function Scenarios({ track: rawTrack = '' }) {
  const { scenarioStatus } = useProgress()
  const track = normTrack(rawTrack)
  const groups = SCENARIO_GROUPS.filter((g) => track === 'all' || g.track === track)
  const shown = SCENARIOS.filter((s) => groups.includes(groupOf(s)))
  const passed = shown.filter((s) => scenarioStatus(s.id) === 'pass').length
  return (
    <div className="fade-swap">
      <header className="masthead">
        <p className="kicker">SCENARIOS · 設計情境</p>
        <h1 className="display">在限制下做選擇</h1>
        <p className="muted" style={{ marginTop: 10, fontSize: '0.85rem' }}>{shown.length} 個情境 · 已通過 {passed}</p>
      </header>
      <TrackFilter value={track} hrefFor={(t) => withTrack('scenarios', t)} />
      {shown.length === 0 && <p className="status-msg">這條路線還沒有設計情境。</p>}
      {groups.map((g) => {
        const list = scenariosInGroup(g.id)
        if (!list.length) return null
        return (
          <section key={g.id} className="domain-block" style={{ '--tint': `var(--c-${g.color})` }}>
            <div className="domain-block-head">
              <span className="kicker tinted">{g.en}</span>
              <h2>{g.title}</h2>
              <span className="count">{list.length} 個</span>
            </div>
            <p className="desc">{g.blurb}</p>
            <div className="scen-grid">
              {list.map((s) => {
                const st = scenarioStatus(s.id)
                return (
                  <a key={s.id} href={`#/scenario/${s.id}`} className="scen-card">
                    <div className="scen-card-head">
                      <Level level={s.level} />
                      {st === 'pass' ? <span className="status ok">✓</span> : st === 'fail' ? <span className="status warn">!</span> : null}
                    </div>
                    <h3>{s.title}</h3>
                    <p>{s.summary}</p>
                    <div className="scen-card-opts">{s.options.map((o) => <span key={o.id}>{o.name}</span>)}</div>
                  </a>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/* 單一情境頁 */
export function ScenarioPage({ id }) {
  const s = findScenario(id)
  const progress = useProgress()
  useEffect(() => { window.scrollTo({ top: 0 }) }, [id])
  if (!s) return <p className="status-msg">找不到情境：{id}</p>
  const g = groupOf(s)
  const color = `var(--c-${g.color})`
  const status = progress.scenarioStatus(s.id)
  // 上一個、下一個只在同一條路線裡走
  const sameTrack = SCENARIOS.filter((x) => groupOf(x).track === g.track)
  const i = sameTrack.indexOf(s)
  const prev = i > 0 ? sameTrack[i - 1] : null
  const next = i < sameTrack.length - 1 ? sameTrack[i + 1] : null
  // 其他路線的相關情境：自己寫的 related，加上把自己寫進 related 的情境
  const related = SCENARIOS.filter((x) => x !== s && ((s.related || []).includes(x.id) || (x.related || []).includes(s.id)))
  const exercise = s.exercise ? findExercise(s.exercise) : null
  const optName = (oid) => s.options.find((o) => o.id === oid)?.name || oid
  // switchIf 的 then 用 options 的 id 指出改選哪個做法：找出第一個提到的 id，標上做法名稱
  const switchTo = (text) => s.options.find((o) => new RegExp(`(^|[^\\w-])${o.id}($|[^\\w-])`).test(text))
  const hasSwitch = s.switchIf?.length > 0 || s.alternative

  return (
    <article className="lesson fade-swap" style={{ '--tint': color }}>
      <div className="reading">
        <p className="crumbs"><a href="#/">首頁</a> / <a href={`#/track/${g.track}`}>{TRACK_TITLE[g.track]}</a> / <a href={withTrack('scenarios', g.track)}>設計情境</a> / {g.title}</p>
        <header className="lesson-head">
          <p className="kicker tinted">{g.en} · 設計情境</p>
          <h1>{s.title}</h1>
          {s.en && <p className="en">{s.en}</p>}
          <div className="lesson-meta">
            <Level level={s.level} />
            <a href="#/scenarios" className="pill tint" style={{ '--tint': color }}>{g.title}</a>
            {status === 'pass' && <span className="pill assess-ok">✓ 決策題通過</span>}
            {(s.skills || []).map((k) => { const sk = findSkill(k); return sk ? <a key={k} href={`#/skill/${k}`} className="pill">{sk.title}</a> : null })}
            {s.week && <a href={withTrack('curriculum', g.track, { week: s.week })} className="pill mono" title="到課綱的這一週">第 {s.week} 週</a>}
          </div>
          <p className="lede">{s.summary}</p>
        </header>
      </div>

      <div className="course-bar">
        <nav className="course-toc" aria-label="本情境章節">
          <a href="#situation">情境</a>
          {s.lab && <a href="#sim" className="lab-link">▶ 模擬器</a>}
          <a href="#options">做法（{s.options.length}）</a>
          <a href="#tradeoffs">取捨</a>
          <a href="#decide">決策（{s.decisions.length}）</a>
          {hasSwitch && <a href="#switch">換方案</a>}
          {s.challenge && <a href="#challenge">進階驗收</a>}
          {s.implementation?.length > 0 && <a href="#impl">落地</a>}
        </nav>
      </div>

      <div className="reading">
        <section className="scen-situation" id="situation">
          <h2 className="lab-full-title">情境</h2>
          <Md text={s.situation} className="scen-text" />
          <ul className="constraints">
            {s.constraints.map((c, k) => <li key={k}><Md text={c} /></li>)}
          </ul>
        </section>
      </div>

      {s.lab && (
        <section className="lab-full" id="sim">
          <h2 className="lab-full-title">模擬器</h2>
          <LabEmbed name={s.lab} scenario />
        </section>
      )}

      <section className="lab-full" id="options">
        <h2 className="lab-full-title">做法</h2>
        <div className="scen-options">
          {s.options.map((o, k) => (
            <div key={o.id} className="scen-opt">
              <p className="kicker">{String.fromCharCode(65 + k)}</p>
              <h3>{o.name}</h3>
              <Md text={o.summary} className="scen-opt-sum" />
              <ul className="pros">{o.pros.map((p, j) => <li key={j}><Md text={p} /></li>)}</ul>
              <ul className="cons">{o.cons.map((p, j) => <li key={j}><Md text={p} /></li>)}</ul>
            </div>
          ))}
        </div>
      </section>

      <section className="lab-full" id="tradeoffs">
        <h2 className="lab-full-title">取捨</h2>
        <div className="dtable-wrap">
          <table className="md-table tradeoffs">
            <thead><tr><th>做法</th>{s.tradeoffs.axes.map((a) => <th key={a}>{a}</th>)}</tr></thead>
            <tbody>
              {s.tradeoffs.rows.map((r) => (
                <tr key={r.option}><td>{optName(r.option)}</td>{r.cells.map((c, j) => <td key={j} data-label={s.tradeoffs.axes[j]}><Md text={c} /></td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="lab-full" id="decide">
        <h2 className="lab-full-title">決策</h2>
        <Decisions key={s.id} scenario={s} />
      </section>

      {hasSwitch && (
        <section className="lab-full scen-switch" id="switch">
          <h2 className="lab-full-title">哪個條件改變會換方案</h2>
          {s.switchIf?.length > 0 && (
            <ul className="scen-switch-list">
              {s.switchIf.map((x, k) => {
                const to = switchTo(x.then)
                return (
                  <li key={k}>
                    <div className="scen-switch-when"><Md text={x.when} /></div>
                    <div className="scen-switch-then">
                      {to && <span className="pill tint">改選 {to.name}</span>}
                      <Md text={x.then} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          {s.alternative && (
            <div className="scen-alt">
              <p className="kicker">第二方案</p>
              <h3>{optName(s.alternative.option)}</h3>
              <p className="scen-alt-k">成立條件</p>
              <Md text={s.alternative.holdsWhen} />
            </div>
          )}
        </section>
      )}

      {s.challenge && (
        <div className="reading">
          <Challenge challenge={s.challenge} storeKey={`scenario:${s.id}`} />
        </div>
      )}

      {s.implementation?.length > 0 && (
        <section className="lab-full" id="impl">
          <h2 className="lab-full-title">落地</h2>
          <div className="scen-impl">
            {s.implementation.map((c, k) => <Code key={k} lang={c.lang} title={c.title}>{c.code}</Code>)}
          </div>
          {exercise && <p className="scen-exercise"><a className="btn ghost small" href={`#/exercise/${exercise.id}`}>動手練習：{exercise.title} →</a></p>}
        </section>
      )}

      <div className="reading">
        {related.length > 0 && (
          <section className="scen-related" id="related">
            <h2>其他路線的相關情境</h2>
            <ul className="refs">
              {related.map((x) => <li key={x.id}><a href={`#/scenario/${x.id}`}>{TRACK_TITLE[groupOf(x).track]}｜{x.title} →</a></li>)}
            </ul>
          </section>
        )}
        <nav className="lesson-nav">
          {prev ? <a href={`#/scenario/${prev.id}`}><small>上一個情境</small>← {prev.title}</a> : <span />}
          {next ? <a className="next" href={`#/scenario/${next.id}`}><small>下一個情境</small>{next.title} →</a> : <span />}
        </nav>
      </div>
    </article>
  )
}

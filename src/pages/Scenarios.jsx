import React, { useEffect } from 'react'
import { SCENARIOS, SCENARIO_GROUPS, findScenario, scenariosInGroup, groupOf } from '../content/scenarios/index.js'
import { findSkill, LEVELS } from '../content/roadmap.js'
import { findExercise } from '../content/exercises/index.js'
import { useProgress } from '../progress.js'
import { Level, LabEmbed } from '../components/bits.jsx'
import Md from '../components/Md.jsx'
import Decisions from '../components/Decisions.jsx'
import { Code } from '../labs/ui.jsx'

/* 設計情境總覽 */
export default function Scenarios() {
  const { scenarioStatus } = useProgress()
  const passed = SCENARIOS.filter((s) => scenarioStatus(s.id) === 'pass').length
  return (
    <div className="fade-swap">
      <header className="masthead">
        <p className="kicker">SCENARIOS · 設計情境</p>
        <h1 className="display">在限制下做選擇</h1>
        <p className="lede">一個情境、幾條限制、兩到四種做法。先在模擬器裡看每種做法的後果，再對照取捨，最後在換了條件的變體裡做決定。</p>
        <p className="muted" style={{ marginTop: 10, fontSize: '0.85rem' }}>{SCENARIOS.length} 個情境 · 已通過 {passed}</p>
      </header>
      {SCENARIO_GROUPS.map((g) => {
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
  const i = SCENARIOS.indexOf(s)
  const prev = i > 0 ? SCENARIOS[i - 1] : null
  const next = i < SCENARIOS.length - 1 ? SCENARIOS[i + 1] : null
  const exercise = s.exercise ? findExercise(s.exercise) : null
  const optName = (oid) => s.options.find((o) => o.id === oid)?.name || oid

  return (
    <article className="lesson fade-swap" style={{ '--tint': color }}>
      <div className="reading">
        <p className="crumbs"><a href="#/">首頁</a> / <a href="#/scenarios">設計情境</a> / {g.title}</p>
        <header className="lesson-head">
          <p className="kicker tinted">{g.en} · 設計情境</p>
          <h1>{s.title}</h1>
          {s.en && <p className="en">{s.en}</p>}
          <div className="lesson-meta">
            <Level level={s.level} />
            <a href="#/scenarios" className="pill tint" style={{ '--tint': color }}>{g.title}</a>
            {status === 'pass' && <span className="pill assess-ok">✓ 決策題通過</span>}
            {(s.skills || []).map((k) => { const sk = findSkill(k); return sk ? <a key={k} href={`#/skill/${k}`} className="pill">{sk.title}</a> : null })}
            {s.week && <a href={`#/curriculum?week=${s.week}`} className="pill mono" title="到課綱的這一週">第 {s.week} 週</a>}
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
                <tr key={r.option}><td>{optName(r.option)}</td>{r.cells.map((c, j) => <td key={j}><Md text={c} /></td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="lab-full" id="decide">
        <h2 className="lab-full-title">決策</h2>
        <Decisions key={s.id} scenario={s} />
      </section>

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
        <nav className="lesson-nav">
          {prev ? <a href={`#/scenario/${prev.id}`}><small>上一個情境</small>← {prev.title}</a> : <span />}
          {next ? <a className="next" href={`#/scenario/${next.id}`}><small>下一個情境</small>{next.title} →</a> : <span />}
        </nav>
      </div>
    </article>
  )
}

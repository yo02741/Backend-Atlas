import React, { useEffect } from 'react'
import { findSkill, neighbors, displayNo, relatedOf, PATHS } from '../content/roadmap.js'
import { findTrack } from '../content/tracks.js'
import { withTrack } from '../components/TrackFilter.jsx'
import { readSkillBody } from '../content/skillBody.js'
import { readSkillDeep, preloadSkillDeep, hasDeep } from '../content/skillDeep.js'
import Markdown, { countStops } from '../components/Markdown.jsx'
import Challenge from '../components/Challenge.jsx'
import { WEEK_OF } from '../content/curriculum-weeks.js'
import { playgroundHref, runLangOf } from '../playgroundLink.js'
import { useProgress } from '../progress.js'
import { Level, DomainPill, LabEmbed, labTitle } from '../components/bits.jsx'
import { Callout } from '../labs/ui.jsx'
import ExerciseRunner from '../components/ExerciseRunner.jsx'
import Quiz from '../components/Quiz.jsx'
import { assessmentFor } from '../assess.js'
import { scenariosForSkill } from '../content/scenarios/index.js'

export default function Skill({ id }) {
  const s = findSkill(id)
  const progress = useProgress()
  const { isDone, toggleDone, checks, toggleCheck } = progress
  useEffect(() => { window.scrollTo({ top: 0 }) }, [id])
  if (!s) return <p className="status-msg">找不到這一課：{id}</p>

  const d = s.domain
  if (hasDeep(s.id)) preloadSkillDeep(s.id)   // 跟內文一起開始下載，不用等內文到了才發出請求
  const body = readSkillBody(d, s.id)   // 內文另外一個 chunk：沒到就 suspend（換頁時舊頁面留著）
  const color = `var(--c-${d.color})`
  const done = isDone(s.id)
  const { prev, next } = neighbors(s.id)
  const checkState = checks(s.id, body.checklist.length)
  const checkedN = checkState.filter(Boolean).length
  const assess = assessmentFor(s.id, progress)
  const related = scenariosForSkill(s.id)
  const t = findTrack(d.track)
  const crossTrack = relatedOf(s.id)
  const path = PATHS[d.track] || []
  const station = path.findIndex((p) => p.skill === s.id)
  const week = WEEK_OF[s.id]
  const canExplain = body.checklist.length > 0 && checkedN === body.checklist.length
  const quizPassed = assess.quiz && progress.quizStatus(s.id) === 'pass'

  return (
    <article className="lesson fade-swap" style={{ '--tint': color }}>
      <div className="reading">
        <p className="crumbs">
          <a href="#/">首頁</a> / <a href={`#/track/${t.id}`}>{t.title}</a> / <a href={`#/domain/${d.id}`}>{d.title}</a>
        </p>
        <header className="lesson-head">
          <p className="kicker tinted">{t.title} {displayNo(d)} · {d.en}</p>
          <h1>{s.title}</h1>
          <p className="en">{s.en}</p>
          <div className="lesson-meta">
            <Level level={s.level} />
            <DomainPill domain={d} />
            {station >= 0 && <a href={`#/track/${t.id}`} className="pill" title={`${t.title}學習路線`}>學習路線第 {station + 1}／{path.length} 站</a>}
            {week && <a href={withTrack('curriculum', d.track, { week })} className="pill" title="到課綱的這一週">課綱第 {week} 週</a>}
            {s.lab && <a href="#lab" className="pill tint" style={{ '--tint': color }}>互動實驗室</a>}
            {assess.total > 0 && <a href="#assess" className={`pill${assess.complete ? ' assess-ok' : ''}`}>{assess.complete ? '✓ 驗收通過' : `驗收 ${assess.passed}/${assess.total}`}</a>}
            {s.keywords.map((k) => <a key={k} href={withTrack('roadmap', d.track, { kw: k })} className="pill mono">{k}</a>)}
            {s.reviewed && <span className="pill" title="這一課提到的版本、規格或事件會隨時間變動，這是最後一次核對內容的時間">內容核對：{s.reviewed.replace('-', ' 年 ').replace(/^(\d+ 年 )0?(\d+)$/, '$1$2 月')}</span>}
          </div>
          <p className="lede">{s.summary}</p>
        </header>

        <div className="example-box">
          <span>範例技術 <b>{s.example.primary}</b></span>
          {s.example.alts?.length > 0 && <span className="alts">也常見：{s.example.alts.join('、')}</span>}
        </div>
      </div>

      <div className="course-bar">
        <nav className="course-toc" aria-label="本課章節">
          {body.map && <a href="#map">地圖</a>}
          {s.lab && <a href="#lab" className="lab-link">▶ 實驗室</a>}
          <a href="#points">重點（{body.points.length}）</a>
          {hasDeep(s.id) && <a href="#deep">深入</a>}
          {hasDeep(s.id) && <React.Suspense fallback={null}><StopLink id={s.id} /></React.Suspense>}
          {assess.total > 0 && <a href="#assess">驗收（{assess.passed}/{assess.total}）</a>}
          {body.challenge && <a href="#challenge">進階驗收</a>}
          <a href="#check">自我檢核（{checkedN}/{body.checklist.length}）</a>
          {body.refs.length > 0 && <a href="#refs">延伸閱讀</a>}
        </nav>
        <div className="lesson-states" role="group" aria-label="這一課的進度">
          <button className={`btn small done-btn${done ? ' is-done' : ' ghost'}`} aria-pressed={done} onClick={() => toggleDone(s.id)}>
            {done ? '✓ 讀過' : '標記讀過'}
          </button>
          <a href="#check" className={`lesson-state${canExplain ? ' on' : ''}`} title={`自我檢核 ${checkedN} / ${body.checklist.length}`}>{canExplain ? '✓ ' : ''}能自行解釋</a>
          {assess.quiz && <a href="#assess" className={`lesson-state${quizPassed ? ' on' : ''}`} title="選擇題全對">{quizPassed ? '✓ ' : ''}測驗通過</a>}
        </div>
      </div>

      {body.map && <MapLayer map={body.map} />}

      {s.lab && (
        <section className="lab-full">
          <h2 id="lab" className="lab-full-title">動手玩：{labTitle(s.lab)}</h2>
          <LabEmbed name={s.lab} />
        </section>
      )}

      <div className="reading">
        <div className="lesson-body">
          <h2 id="points">重點</h2>
          <ul className="points">
            {body.points.map((p, i) => <li key={i}><span><b><Inline text={p.b} /></b>　<Inline text={p.t} /></span></li>)}
          </ul>

          {hasDeep(s.id) && (
            <React.Suspense fallback={<p className="muted">載入深入內容…</p>}>
              <Deep id={s.id} />
            </React.Suspense>
          )}

          <h2 id="assess">驗收 <span className="muted" style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)', fontWeight: 500 }}>{assess.total > 0 ? `${assess.passed} / ${assess.total}` : ''}</span></h2>
          {assess.total === 0 && <p className="muted">這一課的驗收題目撰寫中。</p>}
          {assess.exercises.map((ex) => <ExerciseRunner key={ex.id} exercise={ex} compact />)}
          {assess.quiz && <Quiz key={s.id} skillId={s.id} questions={assess.quiz} />}
          {body.challenge && <Challenge challenge={body.challenge} storeKey={`challenge:${s.id}`} />}
          {assess.quiz && <p className="rv-after">做完了？<a href={withTrack('review', d.track)}>到複習頁混合練習 →</a></p>}

          <h2 id="check">自我檢核 <span className="muted" style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)', fontWeight: 500 }}>{checkedN} / {body.checklist.length}</span></h2>
          <ul className="checklist">
            {body.checklist.map((c, i) => (
              <li key={i}>
                <label>
                  <input type="checkbox" checked={checkState[i]} onChange={() => toggleCheck(s.id, i, body.checklist.length)} />
                  <span>{c}</span>
                </label>
              </li>
            ))}
          </ul>
          {canExplain && <Callout tone="good" title="✓ 能自行解釋" />}

          {related.length > 0 && (
            <>
              <h2 id="scenarios">相關設計情境</h2>
              <ul className="refs">
                {related.map((sc) => <li key={sc.id}><a href={`#/scenario/${sc.id}`}>{sc.title} →</a></li>)}
              </ul>
            </>
          )}

          {crossTrack.length > 0 && (
            <>
              <h2 id="related">其他路線的相關課</h2>
              <ul className="refs">
                {crossTrack.map((x) => <li key={x.id}><a href={`#/skill/${x.id}`}>{findTrack(x.domain.track).title}｜{x.title} →</a></li>)}
              </ul>
            </>
          )}

          {body.refs.length > 0 && (
            <>
              <h2 id="refs">延伸閱讀</h2>
              <ul className="refs">
                {body.refs.map((r) => <li key={r.url}><a href={r.url} target="_blank" rel="noreferrer">{r.label} ↗</a></li>)}
              </ul>
            </>
          )}
        </div>

        <nav className="lesson-nav">
          {prev ? <a href={`#/skill/${prev.id}`}><small>上一課</small>← {prev.title}</a> : <span />}
          {next ? <a className="next" href={`#/skill/${next.id}`}><small>下一課</small>{next.title} →</a> : <span />}
        </nav>
      </div>
    </article>
  )
}

/* 深入內容：md 的 ## 變成 h3（放在 h2「深入」底下）；標記 run 的 python / sql / js 範例可以在 Playground 開 */
function Deep({ id }) {
  const text = readSkillDeep(id)
  if (!text) return null
  const action = (b) => (runLangOf(b)
    ? <a className="btn ghost small" href={playgroundHref(runLangOf(b), b.text)}>在 Playground 開啟 ↗</a>
    : null)
  return (
    <section className="deep">
      <h2 id="deep">深入</h2>
      <Markdown text={text} className="deep-body" headingOffset={1} idFor={(_, slug) => `deep-${slug}`} codeAction={action} stopId={(n) => `deep-stop-${n}`} />
    </section>
  )
}

/* 課的目錄列：跳到第一個停靠點（深入內容到了才知道有沒有） */
function StopLink({ id }) {
  const n = countStops(readSkillDeep(id))
  return n > 0 ? <a href="#deep-stop-1">停靠點{n > 1 ? `（${n}）` : ''}</a> : null
}

/* 重點文字裡的 `code` 轉成 <code> */
/* 地圖層：每課的基底。叫得出名字（名詞）、說得出要求（描述需求要講清楚的事與一段範例）、驗得出對錯（怎麼檢查）。
   格式見 docs/CONTRIBUTING-lessons.md 的「地圖層」。 */
function MapLayer({ map }) {
  const [copied, setCopied] = React.useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(map.prompt.replace(/`/g, '')); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* 不能寫剪貼簿時不做事 */ }
  }
  return (
    <div className="reading">
      <section className="lesson-body map-layer" aria-labelledby="map">
        <h2 id="map">地圖</h2>
        <div className="map-block">
          <h3>叫得出名字</h3>
          <dl className="map-names">
            {map.names.map((x) => <div key={x.n}><dt><Inline text={x.n} /></dt><dd><Inline text={x.t} /></dd></div>)}
          </dl>
        </div>
        <div className="map-block">
          <h3>說得出要求</h3>
          <ul>{map.ask.map((a, i) => <li key={i}><Inline text={a} /></li>)}</ul>
          {map.prompt && (
            <figure className="map-prompt">
              <figcaption><span>描述範例</span><button type="button" className="btn ghost small" onClick={copy}>{copied ? '已複製' : '複製'}</button></figcaption>
              <p><Inline text={map.prompt} /></p>
            </figure>
          )}
        </div>
        <div className="map-block">
          <h3>驗得出對錯</h3>
          <ul className="map-verify">{map.verify.map((v, i) => <li key={i}><b><Inline text={v.c} /></b>　<Inline text={v.t} /></li>)}</ul>
        </div>
      </section>
    </div>
  )
}

function Inline({ text }) {
  const parts = text.split(/(`[^`]+`)/g)
  return <>{parts.map((p, i) => p.startsWith('`') ? <code key={i}>{p.slice(1, -1)}</code> : <React.Fragment key={i}>{p}</React.Fragment>)}</>
}

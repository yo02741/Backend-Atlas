import React, { useEffect, useMemo, useRef, useState } from 'react'
import Md from '../components/Md.jsx'
import { Code } from '../labs/ui.jsx'
import { DOMAINS, findDomain, domainsOf } from '../content/roadmap.js'
import TrackFilter, { normTrack, withTrack } from '../components/TrackFilter.jsx'
import { QUIZZES } from '../content/quizzes/index.js'
import { useProgress } from '../progress.js'
import { cloudEnabled } from '../cloud/config.js'
import { COUNTS, SCOPES, applyRound, buildPool, grade, loadRecord, mulberry32, parseSeed, randomSeed, sample, saveRecord, scopePool } from '../review.js'

/* 複習頁：跨課的混合測驗。設定（範圍、題數）→ 一次作答 → 交卷看分數、解析、依領域的答對率。
   抽題、計分、錯題紀錄都在 src/review.js（純函式）；題目的呈現沿用 Quiz 的 class（.quiz-q / .quiz-opt / .quiz-explain）。
   這一頁不改各課的選擇題通過狀態；錯題與成績另外存在 localStorage 的 atlas-review-v1，不進雲端同步。 */
// 題庫依路線（?track=）：只抽那條路線的領域；'all' 是全部路線。錯題紀錄三條路線共用一份（題目 id 全站唯一）
const poolFor = (track) => {
  const pool = buildPool(QUIZZES, domainsOf(track))
  return [pool, domainsOf(track).filter((d) => pool.some((it) => it.domain === d.id))]
}
const SCOPE_LABEL = { done: '讀過的課', domains: '選領域', wrong: '上次答錯的題', all: '全部', retry: '重做答錯的' }
const letter = (i) => String.fromCharCode(65 + i)
const fmtTime = (at) => new Date(at).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

export default function Review({ seed = '', track: rawTrack = '' }) {
  const { done } = useProgress()
  const track = normTrack(rawTrack)
  const [POOL, POOL_DOMAINS] = useMemo(() => poolFor(track), [track])
  // 網址帶 ?seed= 就用固定種子（e2e 用）；第 k 輪用 seed + k，同一串操作抽到的題目完全一樣
  const baseSeed = useMemo(() => parseSeed(seed) ?? randomSeed(), [seed])
  const roundNo = useRef(0)
  const [record, setRecord] = useState(() => loadRecord())
  const [scope, setScope] = useState(null)   // null = 還沒選，用預設
  const [domainIds, setDomainIds] = useState([])
  const [count, setCount] = useState(COUNTS[0])
  const [round, setRound] = useState(null)   // { seed, scope, items }
  const [answers, setAnswers] = useState([])
  const [result, setResult] = useState(null)
  const topRef = useRef(null)

  const pools = {
    done: scopePool(POOL, 'done', { done }),
    domains: scopePool(POOL, 'domains', { domains: domainIds }),
    wrong: scopePool(POOL, 'wrong', { wrong: record.wrong }),
    all: POOL,
  }
  const usable = { done: pools.done.length > 0, domains: true, wrong: pools.wrong.length > 0, all: true }
  const active = scope && usable[scope] ? scope : usable.done ? 'done' : 'all'

  // 開始作答、交卷後回到頁首，並把焦點移到新出現的區塊（鍵盤與螢幕報讀器不會留在已消失的按鈕上）
  useEffect(() => {
    if (!round) return
    window.scrollTo({ top: 0 })
    topRef.current?.focus({ preventScroll: true })
  }, [round, result])

  const begin = (items, scopeName, usedSeed) => {
    setRound({ seed: usedSeed, scope: scopeName, items })
    setAnswers(items.map(() => null))
    setResult(null)
  }
  const start = (scopeName = active) => {
    const s = (baseSeed + roundNo.current++) >>> 0
    begin(sample(pools[scopeName], count, mulberry32(s)), scopeName, s)
  }
  const submit = () => {
    const g = grade(round.items, answers, DOMAINS)
    const next = applyRound(record, g.results, { at: Date.now(), scope: round.scope })
    setResult(g)
    setRecord(next)
    saveRecord(next)   // 寫不進去（停用、額滿）也不影響這一輪；紀錄還在這個分頁的記憶體裡
  }
  const toSetup = () => { setRound(null); setResult(null); window.scrollTo({ top: 0 }) }

  if (!round) {
    const avail = pools[active].length
    const take = Math.min(count, avail)
    const doneSkills = new Set(pools.done.map((it) => it.skill)).size
    const desc = {
      done: usable.done ? `${doneSkills} 課，共 ${pools.done.length} 題` : '還沒有標記讀過的課',
      domains: '',
      wrong: usable.wrong ? `${pools.wrong.length} 題，答對就從清單移除` : '沒有答錯紀錄',
      all: `${POOL.length} 題，${POOL_DOMAINS.length} 個領域`,
    }
    const allPicked = domainIds.length === POOL_DOMAINS.length
    return (
      <div className="fade-swap">
        <header className="masthead">
          <p className="kicker">REVIEW · 複習</p>
          <h1 className="display">混合複習</h1>
        </header>
        <TrackFilter value={track} hrefFor={(t) => withTrack('review', t, { seed })} />

        <section className="rv-setup">
          <fieldset className="rv-field">
            <legend>範圍</legend>
            <div className="rv-scopes">
              {SCOPES.map((s) => (
                <label key={s} className={`rv-scope${active === s ? ' on' : ''}${usable[s] ? '' : ' off'}`}>
                  <input type="radio" name="rv-scope" value={s} checked={active === s} disabled={!usable[s]} onChange={() => setScope(s)} />
                  <span className="rv-scope-body"><b>{SCOPE_LABEL[s]}</b>{desc[s] && <span>{desc[s]}</span>}</span>
                </label>
              ))}
            </div>
            {active === 'domains' && (
              <div className="rv-domain-pick" role="group" aria-label="要複習的領域">
                {POOL_DOMAINS.map((d) => {
                  const on = domainIds.includes(d.id)
                  return (
                    <button key={d.id} type="button" className={`chip tinted${on ? ' on' : ''}`} style={{ '--tint': `var(--c-${d.color})` }} aria-pressed={on}
                            onClick={() => setDomainIds((ids) => (on ? ids.filter((x) => x !== d.id) : [...ids, d.id]))}>{d.title}</button>
                  )
                })}
                <button type="button" className="chip rv-pick-all" onClick={() => setDomainIds(allPicked ? [] : POOL_DOMAINS.map((d) => d.id))}>{allPicked ? '全部取消' : '全選'}</button>
              </div>
            )}
          </fieldset>

          <fieldset className="rv-field">
            <legend>題數</legend>
            <div className="rv-counts">
              {COUNTS.map((c) => (
                <label key={c} className={`rv-count${count === c ? ' on' : ''}`}>
                  <input type="radio" name="rv-count" value={c} checked={count === c} onChange={() => setCount(c)} />{c} 題
                </label>
              ))}
            </div>
          </fieldset>

          <div className="rv-start">
            <button className="btn submit rv-start-btn" disabled={avail === 0} onClick={() => start()}>開始{avail > 0 ? `（${take} 題）` : ''}</button>
            <span className="rv-hint">
              {avail === 0 ? '先選至少一個領域。' : avail <= count ? `範圍內共 ${avail} 題，全部都出。` : `從 ${avail} 題裡隨機抽 ${count} 題，不重複。`}
            </span>
          </div>
          <p className="rv-note">錯題與成績只存在這個瀏覽器，不會同步到帳號。</p>
        </section>

        <SyncScope />

        {record.history.length > 0 && (
          <section className="rv-history">
            <h2>最近成績</h2>
            <ol>
              {record.history.map((h, i) => (
                <li key={`${h.at}-${i}`}><time dateTime={new Date(h.at).toISOString()}>{fmtTime(h.at)}</time><span>{SCOPE_LABEL[h.scope] || SCOPE_LABEL.all}</span><b>{h.correct} / {h.total}</b></li>
              ))}
            </ol>
          </section>
        )}
      </div>
    )
  }

  const { items } = round
  const submitted = Boolean(result)
  const answered = answers.filter((a) => a !== null).length
  const wrongItems = submitted ? items.filter((_, i) => !result.results[i].right) : []
  // 再來一輪：同樣的範圍與題數重新抽；重做錯題那一輪回到設定畫面選的範圍
  const againScope = round.scope === 'retry' ? active : round.scope
  const canAgain = pools[againScope].length > 0

  return (
    <div className="fade-swap rv-run">
      <p className="crumbs"><a href="#/">首頁</a> / <a href="#/exercises">練習題</a> / <span>複習</span></p>

      {submitted && (
        <section className="rv-result" ref={topRef} tabIndex={-1} aria-label="這一輪的成績">
          <div className="rv-score">
            <p className="kicker">成績 · {SCOPE_LABEL[round.scope]}</p>
            <p className="rv-score-num"><b>{result.correct}</b> / {result.total}</p>
            <p className={`ex-verdict ${result.correct === result.total ? 'ok' : 'bad'}`}>
              {result.correct === result.total ? '✓ 全對' : `答對率 ${Math.round((result.correct / result.total) * 100)}%`}
            </p>
          </div>
          <div className="rv-domains">
            <p className="kicker">依領域的答對率</p>
            <ul>
              {result.byDomain.map((row) => {
                const d = findDomain(row.id)
                return (
                  <li key={row.id} style={{ '--tint': `var(--c-${d.color})` }}>
                    <span className="rv-dname">{d.title}</span>
                    <span className="rv-bar" aria-hidden="true"><i style={{ width: `${(row.correct / row.total) * 100}%` }} /></span>
                    <span className="rv-dnum">{row.correct} / {row.total}</span>
                  </li>
                )
              })}
            </ul>
          </div>
          <div className="rv-actions">
            <button className="btn small" disabled={!canAgain} onClick={() => start(againScope)}>再來一輪</button>
            {wrongItems.length > 0 && <button className="btn ghost small" onClick={() => begin(wrongItems, 'retry', round.seed)}>只重做答錯的（{wrongItems.length} 題）</button>}
            <button className="btn ghost small" onClick={toSetup}>改範圍</button>
          </div>
          <p className="rv-note">
            {wrongItems.length > 0 ? `答錯的 ${wrongItems.length} 題已記到「上次答錯的題」，之後答對就會移除。` : canAgain ? '這一輪全對，沒有新的錯題。' : '錯題清單已經清空。'}
            紀錄只存在這個瀏覽器。
          </p>
        </section>
      )}

      <section className="quiz rv-quiz" data-seed={round.seed} data-scope={round.scope}>
        <header className="ex-head">
          <div>
            <p className="kicker">{SCOPE_LABEL[round.scope]} · {items.length} 題</p>
            <h1 className="ex-title" ref={submitted ? null : topRef} tabIndex={-1}>{submitted ? '逐題解析' : '混合測驗'}</h1>
          </div>
          <div className="ex-status">
            {submitted ? <span className="pill">答對 {result.correct} / {result.total}</span> : <span className="pill">已答 {answered} / {items.length}</span>}
          </div>
        </header>
        <ol className="quiz-list">
          {items.map((it, qi) => {
            const q = it.q
            const picked = answers[qi]
            const isRight = submitted && picked === q.answer
            const d = findDomain(it.domain)
            return (
              <li key={it.id} data-qid={it.id} className={`quiz-q${submitted ? (isRight ? ' right' : ' wrong') : ''}`}>
                <p className="rv-qno">第 {qi + 1} 題{submitted && <span className={`rv-mark ${isRight ? 'ok' : 'bad'}`}>{isRight ? '✓ 答對' : '✕ 答錯'}</span>}</p>
                <Md text={q.q} className="quiz-stem" />
                {q.code && <Code lang={q.lang || 'text'} title="">{q.code}</Code>}
                <div className="quiz-opts" role="radiogroup" aria-label={`第 ${qi + 1} 題的選項`}>
                  {q.options.map((opt, oi) => {
                    const cls = ['quiz-opt', picked === oi ? 'picked' : '', submitted && oi === q.answer ? 'correct' : '', submitted && picked === oi && oi !== q.answer ? 'incorrect' : ''].join(' ')
                    return (
                      <label key={oi} className={cls}>
                        <input type="radio" name={`rv-${round.seed}-${qi}`} checked={picked === oi} disabled={submitted}
                               onChange={() => setAnswers((a) => a.map((v, i) => (i === qi ? oi : v)))} />
                        <span className="quiz-letter">{letter(oi)}</span>
                        <span>{opt}</span>
                      </label>
                    )
                  })}
                </div>
                {submitted && (
                  <div className={`quiz-explain ${isRight ? 'ok' : 'bad'}`}>
                    <b>{isRight ? '答對了。' : `答錯了，正解是 ${letter(q.answer)}。`}</b>　<Md text={q.explain} />
                  </div>
                )}
                {submitted && (
                  <p className="rv-lesson">
                    <span className="pill tint" style={{ '--tint': `var(--c-${d.color})` }}>{d.title}</span>
                    <a href={`#/skill/${it.skill}`}>回到這一課：{it.skillTitle} →</a>
                  </p>
                )}
              </li>
            )
          })}
        </ol>
        <div className="ex-toolbar">
          {!submitted
            ? <>
                <button className="btn small submit" onClick={submit} disabled={answered < items.length}>交卷{answered < items.length ? `（還有 ${items.length - answered} 題沒答）` : ''}</button>
                <button className="btn ghost small" onClick={toSetup}>改範圍</button>
              </>
            : <>
                <button className="btn small" disabled={!canAgain} onClick={() => start(againScope)}>再來一輪</button>
                <button className="btn ghost small" onClick={() => { window.scrollTo({ top: 0 }); topRef.current?.focus({ preventScroll: true }) }}>回到成績</button>
              </>}
        </div>
      </section>
    </div>
  )
}

/* 哪些紀錄會跨裝置、哪些只在這個瀏覽器（同步範圍見 src/cloud/sync.js 與 progressData.js；只存本機的見 review.js、localStore.js、ExerciseRunner 的草稿） */
const SYNCED = ['讀過（課頁的「標記讀過」）', '自我檢核的勾選（全勾＝能自行解釋）', '選擇題（全對＝測驗通過）、程式題、決策題的通過狀態', '決策題的理由']
const LOCAL_ONLY = ['複習的錯題與成績', '程式題與 Playground 的草稿', '進階驗收與跨課作業的勾選', '實驗室的猜測']
function SyncScope() {
  return (
    <section className="rv-sync" aria-labelledby="rv-sync">
      <h2 id="rv-sync">紀錄存在哪裡</h2>
      {cloudEnabled
        ? (
          <div className="rv-sync-cols">
            <div><h3>登入後跨裝置同步</h3><ul>{SYNCED.map((x) => <li key={x}>{x}</li>)}</ul></div>
            <div><h3>只在這個瀏覽器</h3><ul>{LOCAL_ONLY.map((x) => <li key={x}>{x}</li>)}</ul></div>
          </div>
        )
        : <p className="rv-note">所有紀錄（讀過、能自行解釋、測驗通過、錯題、草稿）都只存在這個瀏覽器；換裝置或清除網站資料就不見。</p>}
    </section>
  )
}

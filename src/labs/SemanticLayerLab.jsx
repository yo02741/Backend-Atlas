import React, { useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Code, Callout, Status, Stats, Stat } from './ui.jsx'

/* ============================================================
   Semantic Layer：agent 看欄位名猜 SQL vs 對到定義好的指標
   - 左：同一個問題，agent 憑欄位名可能寫出 3 種 SQL，算出 3 個不同數字
   - 右：指標定義表，一個問題（不管怎麼問）只對到一個定義、一個數字
   - 定義開關（含 cancelled / 含 no_show）改的是「定義」，兩邊的數字跟著變；但右邊永遠只有一個答案
   - 所有資料為虛構示意，數字由 JS 直接算
   ============================================================ */

const WEEK = ['2026-03-09', '2026-03-15']          // 「本週」：週一到週日
const inWeek = (d) => d >= WEEK[0] && d <= WEEK[1]

const SESSIONS = [
  { id: 1, dept: '內科', doctor: '王醫師', date: '2026-03-02', capacity: 6 },
  { id: 2, dept: '外科', doctor: '林醫師', date: '2026-03-03', capacity: 5 },
  { id: 3, dept: '小兒科', doctor: '陳醫師', date: '2026-03-05', capacity: 6 },
  { id: 4, dept: '骨科', doctor: '張醫師', date: '2026-03-06', capacity: 4 },
  { id: 5, dept: '內科', doctor: '王醫師', date: '2026-03-09', capacity: 6 },
  { id: 6, dept: '內科', doctor: '李醫師', date: '2026-03-10', capacity: 6 },
  { id: 7, dept: '外科', doctor: '林醫師', date: '2026-03-10', capacity: 5 },
  { id: 8, dept: '小兒科', doctor: '陳醫師', date: '2026-03-11', capacity: 6 },
  { id: 9, dept: '骨科', doctor: '張醫師', date: '2026-03-12', capacity: 4 },
  { id: 10, dept: '外科', doctor: '周醫師', date: '2026-03-13', capacity: 5 },
  { id: 11, dept: '小兒科', doctor: '吳醫師', date: '2026-03-14', capacity: 6 },
  { id: 12, dept: '內科', doctor: '王醫師', date: '2026-03-16', capacity: 6 },   // 下週的診，但這週就有人掛
]
// [id, session_id, status, created_at, cancelled_at]
const A = [
  [101, 1, 'completed', '02-25'], [102, 1, 'completed', '02-26'], [103, 1, 'no_show', '02-27'], [104, 1, 'cancelled', '02-28', '03-01'], [105, 1, 'completed', '03-01'],
  [106, 2, 'completed', '02-26'], [107, 2, 'completed', '02-27'], [108, 2, 'cancelled', '03-01', '03-02'],
  [109, 3, 'completed', '02-28'], [110, 3, 'completed', '03-02'], [111, 3, 'no_show', '03-03'], [112, 3, 'completed', '03-04'],
  [113, 4, 'completed', '03-02'], [114, 4, 'cancelled', '03-03', '03-05'],
  [115, 5, 'completed', '03-02'], [116, 5, 'completed', '03-04'], [117, 5, 'cancelled', '03-05', '03-08'], [118, 5, 'no_show', '03-06'], [119, 5, 'completed', '03-07'], [120, 5, 'cancelled', '03-08', '03-09'],
  [121, 6, 'completed', '03-05'], [122, 6, 'completed', '03-08'], [123, 6, 'completed', '03-09'], [124, 6, 'cancelled', '03-09', '03-10'],
  [125, 7, 'completed', '03-03'], [126, 7, 'no_show', '03-06'], [127, 7, 'completed', '03-09'],
  [128, 8, 'completed', '03-04'], [129, 8, 'completed', '03-09'], [130, 8, 'cancelled', '03-09', '03-10'], [131, 8, 'completed', '03-10'], [132, 8, 'completed', '03-10'],
  [133, 9, 'completed', '03-08'], [134, 9, 'cancelled', '03-10', '03-11'], [135, 9, 'completed', '03-11'],
  [136, 10, 'booked', '03-09'], [137, 10, 'booked', '03-10'], [138, 10, 'cancelled', '03-11', '03-12'], [139, 10, 'booked', '03-12'],
  [140, 11, 'booked', '03-10'], [141, 11, 'booked', '03-12'], [142, 11, 'booked', '03-13'],
  [143, 12, 'booked', '03-11'], [144, 12, 'booked', '03-13'], [145, 12, 'cancelled', '03-12', '03-14'],
]
const APPTS = A.map(([id, session_id, status, c, x]) => ({ id, session_id, status, created_at: `2026-${c}`, cancelled_at: x ? `2026-${x}` : null }))
const S_BY_ID = Object.fromEntries(SESSIONS.map((s) => [s.id, s]))
const joined = APPTS.map((a) => ({ ...a, s: S_BY_ID[a.session_id] }))
const weekAppts = joined.filter((a) => inWeek(a.s.date))
const DEPTS = ['內科', '外科', '小兒科', '骨科']
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—')

/* 各科平均候診人數：先算每個診次有幾人（依 keep 規則），再依科別平均 */
function avgByDept(keep) {
  const weekSessions = SESSIONS.filter((s) => inWeek(s.date))
  return DEPTS.map((d) => {
    const ss = weekSessions.filter((s) => s.dept === d)
    const per = ss.map((s) => weekAppts.filter((a) => a.session_id === s.id && keep(a)).length)
    return `${d} ${(per.reduce((x, y) => x + y, 0) / ss.length).toFixed(1)}`
  }).join(' · ')
}
const totalByDept = () => DEPTS.map((d) => `${d} ${weekAppts.filter((a) => a.s.dept === d).length}`).join(' · ')

/* 三個問題：每個有 2–3 種「看欄位名猜」的寫法、同義問法、以及會隨開關改變的正式定義 */
const QUESTIONS = {
  count: {
    label: '本週掛號數', metric: 'weekly_registrations', owner: '掛號組', grain: '週（以 sessions.date 歸週）', filters: 'dept、doctor',
    phrases: ['本週掛號數是多少？', '這週的掛號量？', '本週預約數有幾筆？', '這禮拜總共掛了幾號？'],
    def: (t) => ({ formula: `COUNT(appointments)${t.cancelled ? '' : ' WHERE status ≠ cancelled'}，以診次日期歸週`, key: `session|${t.cancelled}`,
      value: weekAppts.filter((a) => t.cancelled || a.status !== 'cancelled').length }),
    guesses: [
      { name: 'A', key: 'created|true', value: joined.filter((a) => inWeek(a.created_at)).length,
        sql: `SELECT COUNT(*) FROM appointments\nWHERE created_at\n  BETWEEN '${WEEK[0]}' AND '${WEEK[1]}';`,
        why: '「本週」用的是建立時間：下週的診這週掛的算進來、這週的診上週掛的被漏掉；而且取消的也算。' },
      { name: 'B', key: 'session|true', value: weekAppts.length,
        sql: `SELECT COUNT(*) FROM appointments a\nJOIN sessions s ON s.id = a.session_id\nWHERE s.date BETWEEN '${WEEK[0]}' AND '${WEEK[1]}';`,
        why: '以診次日期歸週是對的，但把 cancelled 一起算了——欄位名沒說取消算不算。' },
      { name: 'C', key: 'session|false', value: weekAppts.filter((a) => a.status !== 'cancelled').length,
        sql: `SELECT COUNT(*) FROM appointments a\nJOIN sessions s ON s.id = a.session_id\nWHERE s.date BETWEEN '${WEEK[0]}' AND '${WEEK[1]}'\n  AND a.status <> 'cancelled';`,
        why: '排除了 cancelled，但 no_show 留著——這也是一種假設，只是這次剛好和定義一致。' },
    ],
  },
  cancel: {
    label: '取消率', metric: 'cancel_rate', owner: '品管室', grain: '週（以 sessions.date 歸週）', filters: 'dept',
    phrases: ['本週取消率多少？', '這週有多少比例的人取消？', '掛號後取消的比率？'],
    def: () => ({ formula: 'COUNT(status = cancelled) ÷ COUNT(全部)，兩者都限同週診次', key: 'session|all',
      value: pct(weekAppts.filter((a) => a.status === 'cancelled').length, weekAppts.length) }),
    guesses: [
      { name: 'A', key: 'cancelled_at|everything', value: pct(joined.filter((a) => a.cancelled_at && inWeek(a.cancelled_at)).length, joined.length),
        sql: `SELECT COUNT(cancelled_at) * 1.0 / COUNT(*)\nFROM appointments\nWHERE cancelled_at BETWEEN '${WEEK[0]}' AND '${WEEK[1]}'\n   OR cancelled_at IS NULL;`,
        why: '分子看 cancelled_at 落在本週，分母卻是歷史上所有掛號——分子分母不同期間，比率沒有意義。' },
      { name: 'B', key: 'session|noncancelled', value: pct(weekAppts.filter((a) => a.status === 'cancelled').length, weekAppts.filter((a) => a.status !== 'cancelled').length),
        sql: `SELECT SUM(a.status = 'cancelled') * 1.0\n     / SUM(a.status <> 'cancelled')\nFROM appointments a JOIN sessions s ON s.id = a.session_id\nWHERE s.date BETWEEN '${WEEK[0]}' AND '${WEEK[1]}';`,
        why: '分母漏掉取消的本身，算出來是「取消：未取消」的比值，不是比率，會比定義高。' },
      { name: 'C', key: 'session|all', value: pct(weekAppts.filter((a) => a.status === 'cancelled').length, weekAppts.length),
        sql: `SELECT AVG(a.status = 'cancelled')\nFROM appointments a JOIN sessions s ON s.id = a.session_id\nWHERE s.date BETWEEN '${WEEK[0]}' AND '${WEEK[1]}';`,
        why: '分子分母同一群、同一週。' },
    ],
  },
  wait: {
    label: '各科平均候診人數', metric: 'avg_waiting_per_session', owner: '門診部', grain: '診次 → 科別', filters: 'dept、日期區間',
    phrases: ['各科平均候診人數？', '每個科一診平均看幾個人？', '各科每診的人數平均是多少？'],
    def: (t) => ({ formula: `每診次 COUNT(status ∈ {booked, completed${t.noShow ? ', no_show' : ''}})，再依科別 AVG`, key: `session|${t.noShow ? 'noncancelled' : 'showed'}`,
      value: avgByDept((a) => a.status !== 'cancelled' && (t.noShow || a.status !== 'no_show')) }),
    guesses: [
      { name: 'A', key: 'session|all', value: avgByDept(() => true),
        sql: `SELECT s.dept, AVG(c) FROM (\n  SELECT session_id, COUNT(*) c FROM appointments GROUP BY 1\n) x JOIN sessions s ON s.id = x.session_id\nWHERE s.date BETWEEN '${WEEK[0]}' AND '${WEEK[1]}' GROUP BY s.dept;`,
        why: '粒度對了（先算每診次再平均），但取消的人不會坐在候診區，卻被算進來。' },
      { name: 'B', key: 'dept|all', value: totalByDept(),
        sql: `SELECT s.dept, COUNT(*)\nFROM appointments a JOIN sessions s ON s.id = a.session_id\nWHERE s.date BETWEEN '${WEEK[0]}' AND '${WEEK[1]}'\nGROUP BY s.dept;`,
        why: '粒度錯了：這是各科本週的掛號總數，不是「每診次平均」。看到 dept 欄就 GROUP BY，少了診次這一層。' },
      { name: 'C', key: 'session|showed', value: avgByDept((a) => a.status === 'booked' || a.status === 'completed'),
        sql: `SELECT s.dept, AVG(c) FROM (\n  SELECT session_id, COUNT(*) c FROM appointments\n  WHERE status IN ('booked', 'completed') GROUP BY 1\n) x JOIN sessions s ON s.id = x.session_id\nWHERE s.date BETWEEN '${WEEK[0]}' AND '${WEEK[1]}' GROUP BY s.dept;`,
        why: '把 no_show 排除了。沒來的人要不要算「候診」，欄位名回答不了，得由定義決定。' },
    ],
  },
}
const Q_ORDER = ['count', 'cancel', 'wait']

export default function SemanticLayerLab() {
  const [q, setQ] = useState('count')
  const [cancelled, setCancelled] = useState(false)
  const [noShow, setNoShow] = useState(true)
  const [phraseIdx, setPhraseIdx] = useState(0)
  const [showData, setShowData] = useState(false)
  const toggles = { cancelled, noShow }

  const Q = QUESTIONS[q]
  const def = Q.def(toggles)
  const phrase = Q.phrases[phraseIdx % Q.phrases.length]
  const distinct = (k) => new Set(QUESTIONS[k].guesses.map((g) => String(g.value))).size
  const okCount = Q.guesses.filter((g) => g.key === def.key).length
  const defs = useMemo(() => Q_ORDER.map((k) => ({ k, ...QUESTIONS[k], ...QUESTIONS[k].def(toggles) })), [cancelled, noShow]) // eslint-disable-line

  return (
    <Lab accent="aqua" kicker="DATA LAB" title="Semantic Layer：讓 agent 查資料不用猜欄位"
         blurb="同一個問題，agent 看著欄位名可以寫出好幾種合理的 SQL，每一種算出來的數字都不一樣。Semantic Layer 把「指標怎麼算」先定義好，問法再多，也只對到一個定義、一個數字。切問題、開關定義、換問法，看兩邊怎麼變。">
      <LabControls>
        <Seg label="問題" tinted value={q} onChange={(v) => { setQ(v); setPhraseIdx(0) }}
             options={Q_ORDER.map((k) => ({ value: k, label: QUESTIONS[k].label }))} />
        <span className="spacer" />
        <Toggle label="定義：掛號數含 cancelled" checked={cancelled} onChange={setCancelled} />
        <Toggle label="定義：候診人數含 no_show" checked={noShow} onChange={setNoShow} />
        <button type="button" className="btn ghost small" onClick={() => setPhraseIdx((i) => i + 1)}>換一個問法</button>
      </LabControls>

      <div className="sl-ask">
        <span className="sl-ask-l">使用者問</span>
        <span className="sl-ask-q" key={phrase}>「{phrase}」</span>
      </div>

      <LabGrid variant="even">
        <LabStage label="agent 憑欄位名猜出的 SQL 與數字" caption={`猜法之間 ${distinct(q)} 種不同答案；和目前定義一致的有 ${okCount} 種`}>
          <div className="sl-col-head"><span className="tag b">猜</span> agent 只看得到欄位名</div>
          <div className="sl-guesses">
            {Q.guesses.map((g) => {
              const ok = g.key === def.key
              return (
                <div key={g.name} className={`sl-guess ${ok ? 'ok' : 'bad'}`}>
                  <Code lang="sql" title={`猜法 ${g.name}`}>{g.sql}</Code>
                  <div className="sl-guess-foot">
                    <b className="sl-num" key={String(g.value)}>{g.value}</b>
                    {ok ? <Status ok>和定義一致</Status> : <Status>和定義不一致</Status>}
                  </div>
                  <p className="sl-why">{g.why}</p>
                </div>
              )
            })}
          </div>
        </LabStage>

        <LabStage label="Semantic Layer 的指標定義與解析結果" caption="問法 → 指標 → 定義 → 一個數字；agent 不碰原始欄位">
          <div className="sl-col-head"><span className="tag a">定義</span> 問法先對到指標，再照定義算</div>
          <div className="sl-resolve">
            <span className="sl-chip">「{phrase}」</span>
            <span className="sl-arrow" aria-hidden="true">→</span>
            <code className="sl-metric">{Q.metric}</code>
            <span className="sl-arrow" aria-hidden="true">→</span>
            <b className="sl-num big" key={`${q}-${def.value}`}>{def.value}</b>
          </div>
          <p className="sl-syn">同義問法都對到同一個指標：{Q.phrases.map((p, i) => <span key={p} className={`sl-syn-item${i === phraseIdx % Q.phrases.length ? ' on' : ''}`}>{p}</span>)}</p>
          <div className="sl-metrics" role="group" aria-label="metrics.yml 中的指標">
            {defs.map((d) => (
              <button key={d.k} type="button" className={`sl-mchip${d.k === q ? ' on' : ''}`} onClick={() => { setQ(d.k); setPhraseIdx(0) }}>{d.metric}</button>
            ))}
          </div>
          <div className="dtable-wrap">
            <table className="dtable sl-defs">
              <caption>metrics.yml（指標定義表）· {Q.metric}</caption>
              <tbody key={`${q}-${def.formula}`}>
                {[['指標名', Q.metric], ['公式', def.formula], ['來源', 'appointments ⋈ sessions'], ['粒度', Q.grain], ['允許的篩選', Q.filters], ['負責人', Q.owner], ['同義詞', Q.phrases.length + ' 種問法']].map(([k, v]) => (
                  <tr key={k} className="row-in"><th scope="row">{k}</th><td>{v}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </LabStage>
      </LabGrid>

      <Stats min={150}>
        {Q_ORDER.map((k) => (
          <Stat key={k} label={QUESTIONS[k].label} value={<>{distinct(k)} <small>個答案</small> → 1</>} note="猜：多個 / 定義：一個" tone={k === q ? 'ok' : ''} />
        ))}
        <Stat label="定義開關" value={`${cancelled ? '含' : '不含'} cancel · ${noShow ? '含' : '不含'} no_show`} note="改的是定義，不是查詢" />
      </Stats>

      <LabGrid variant="even">
        <div className="lab-stack">
          <LabExplain title={`${Q.label}：為什麼猜會猜出 ${distinct(q)} 種答案`}>
            <p>{EXPLAIN[q]}</p>
            <p>開關「定義」時，右邊的數字會變，但仍然只有一個；左邊哪個猜法剛好對上也會跟著換——它們本來就不是對或錯，只是沒人說清楚要哪一種。</p>
          </LabExplain>
          <Callout title="什麼時候會真的踩到">
            三種情況最常見：同一個指標在兩份報表裡數字對不起來（各自寫了不同的 WHERE）；agent 回答得頭頭是道、SQL 也合法，但分母選錯了；改一次「取消要不要算」的業務規則，得去翻幾十支查詢。把公式、粒度、允許的篩選、負責人寫進一份定義檔，讓 agent 與報表都只對這份定義查，就是 Semantic Layer 在做的事。
          </Callout>
        </div>
        <div className="lab-stack">
          <button type="button" className="btn ghost small" onClick={() => setShowData((v) => !v)}>{showData ? '收起原始資料' : '看原始資料（兩張表）'}</button>
          {showData && (
            <div className="sl-data">
              <div className="dtable-wrap"><table className="dtable"><caption>sessions（診次）· {SESSIONS.length} 列</caption>
                <thead><tr><th>id</th><th>dept</th><th>doctor</th><th>date</th><th>capacity</th></tr></thead>
                <tbody>{SESSIONS.map((s) => <tr key={s.id} className={inWeek(s.date) ? '' : 'dim'}><td>{s.id}</td><td>{s.dept}</td><td>{s.doctor}</td><td>{s.date}</td><td>{s.capacity}</td></tr>)}</tbody></table></div>
              <div className="dtable-wrap sl-scroll"><table className="dtable"><caption>appointments（掛號）· {APPTS.length} 列（變淡 = 診次不在本週）</caption>
                <thead><tr><th>id</th><th>session_id</th><th>status</th><th>created_at</th><th>cancelled_at</th></tr></thead>
                <tbody>{joined.map((a) => <tr key={a.id} className={inWeek(a.s.date) ? '' : 'dim'}><td>{a.id}</td><td>{a.session_id}</td><td>{a.status}</td><td>{a.created_at}</td><td className={a.cancelled_at ? '' : 'null'}>{a.cancelled_at || 'NULL'}</td></tr>)}</tbody></table></div>
            </div>
          )}
          <p className="sl-note">本週 = {WEEK[0]} ～ {WEEK[1]}。資料與科別皆為虛構示意。</p>
        </div>
      </LabGrid>

      <style>{`
        .sl-ask { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px; margin: 2px 0 12px; }
        .sl-ask-l { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.06em; color: var(--ink-3); text-transform: uppercase; }
        .sl-ask-q { font-size: 1rem; font-weight: 600; color: var(--ink-1); animation: sl-fade 0.35s ease-out both; }
        .sl-col-head { display: flex; align-items: center; gap: 8px; font-size: 0.78rem; color: var(--ink-2); margin-bottom: 10px; }
        .sl-guesses { display: grid; gap: 10px; }
        .sl-guess { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 8px; display: grid; gap: 6px; transition: border-color 0.3s ease; min-width: 0; }
        .sl-guess.ok { border-color: color-mix(in srgb, var(--good) 55%, var(--hairline)); }
        .sl-guess.bad { border-color: color-mix(in srgb, var(--critical) 40%, var(--hairline)); }
        .sl-guess .code { margin: 0; }
        .sl-guess-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; }
        .sl-num { font-family: var(--mono); font-size: 1.05rem; font-weight: 700; color: var(--ink-1); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; animation: sl-fade 0.35s ease-out both; }
        .sl-num.big { font-size: 1.25rem; color: var(--lab-accent); }
        .sl-why { margin: 0; font-size: 0.78rem; line-height: 1.5; color: var(--ink-3); }
        .sl-resolve { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; padding: 10px; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); margin-bottom: 8px; }
        .sl-chip { font-size: 0.82rem; color: var(--ink-1); }
        .sl-arrow { color: var(--ink-3); }
        .sl-metric { font-family: var(--mono); font-size: 0.82rem; color: var(--lab-accent); font-weight: 600; }
        .sl-syn { margin: 0 0 10px; font-size: 0.76rem; line-height: 1.7; color: var(--ink-3); }
        .sl-syn-item { display: inline-block; margin: 0 6px 2px 0; padding: 0 6px; border-radius: 999px; border: 1px solid var(--hairline); transition: all 0.25s ease; }
        .sl-syn-item.on { color: var(--ink-1); border-color: var(--lab-accent); background: color-mix(in srgb, var(--lab-accent) 12%, transparent); }
        .sl-metrics { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
        .sl-mchip { font-family: var(--mono); font-size: 0.74rem; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--hairline); background: var(--surface-1); color: var(--ink-2); cursor: pointer; transition: all 0.2s ease; }
        .sl-mchip.on { color: var(--ink-1); border-color: var(--lab-accent); background: color-mix(in srgb, var(--lab-accent) 14%, transparent); }
        .sl-defs th { width: 7em; vertical-align: top; }
        .sl-defs td { white-space: normal; font-family: var(--sans); line-height: 1.45; }
        .lab-stats + .lab-grid { margin-top: 16px; }
        .sl-data { display: grid; gap: 12px; }
        .sl-scroll { max-height: 260px; overflow-y: auto; }
        .sl-note { margin: 0; font-size: 0.72rem; color: var(--ink-3); }
        @keyframes sl-fade { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .sl-ask-q, .sl-num { animation: none; } }
      `}</style>
    </Lab>
  )
}

const EXPLAIN = {
  count: '「本週」要用掛號建立時間還是診次日期？取消的算不算？欄位名 created_at、status 都在，但沒有一個欄位回答這兩個問題。agent 只能各選一種假設，三種假設三個數字，每一個都「看起來合理」。',
  cancel: '比率最容易錯在分母。分子寫 cancelled 很直覺，但分母是「同一週全部掛號」還是「全部歷史」還是「未取消的」，欄位名完全沒提示。猜法 A 甚至分子分母不同期間，數字看起來很正常，所以更危險。',
  wait: '「平均」是哪一層的平均？看到 dept 就 GROUP BY dept 會得到總數而不是每診次平均（猜法 B）；粒度對了，又要決定取消的、沒來的要不要算（猜法 A、C）。粒度和篩選條件都該寫在定義裡，不該每次查詢重新猜。',
}

import React, { useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Code, Callout, Status, Stats, Stat } from './ui.jsx'

/* ============================================================
   測試品質：覆蓋率 100% 的測試抓不抓得到錯
   - 一段被測函式（能不能取消掛號）+ 兩組測試（AI 第一版 / 補強後），每個測試可開關
   - 「跑突變測試」：8 個突變體（> 換 >=、常數 +1、刪一行條件……），對照表標出哪些測試會紅
   - 殺不死的突變體用紅框標出；兩組覆蓋率都是 100%，殺死率差很多
   - 不真的執行 Python，對照表是預先推好的；程式碼與案例皆為虛構示意
   ============================================================ */

const SRC = `MAX_CANCELS = 2

def can_cancel(appt, now):
    """看診前一日 17:00 前、狀態仍是 booked、取消次數未達上限，才能取消。"""
    deadline = appt.session_date.replace(hour=17, minute=0) - timedelta(days=1)
    if appt.status != "booked":
        return False
    if now > deadline:
        return False
    if appt.cancel_count >= MAX_CANCELS:
        return False
    return True`

/* 突變體：line = 被改的行（1-based）；kills = 預先推好的「哪些測試會紅」 */
const MUTANTS = [
  { id: 'M1', line: 8, from: 'now > deadline', to: 'now >= deadline', what: '邊界：期限當下從「可取消」變「不可」', kills: ['S3'] },
  { id: 'M2', line: 10, from: 'cancel_count >= MAX_CANCELS', to: 'cancel_count > MAX_CANCELS', what: '邊界：剛好達上限的人還能再取消一次', kills: ['S5'] },
  { id: 'M3', line: 1, from: 'MAX_CANCELS = 2', to: 'MAX_CANCELS = 3', what: '常數 +1：上限變 3 次', kills: ['S5'] },
  { id: 'M4', line: 5, from: 'timedelta(days=1)', to: 'timedelta(days=0)', what: '期限晚一天：看診當天 17:00 前還能取消', kills: ['T3', 'S4'] },
  { id: 'M5', line: 5, from: 'hour=17', to: 'hour=18', what: '期限晚一小時', kills: ['T3', 'S4'] },
  { id: 'M6', line: 6, from: 'if appt.status != "booked":', to: '（刪掉這行與它的 return）', what: '刪一行條件：已取消、已完成的都能再取消', kills: ['T2', 'S2'] },
  { id: 'M7', line: 12, from: 'return True', to: 'return False', what: '永遠不可取消', kills: ['T5', 'S1', 'S3', 'S6'] },
  { id: 'M8', line: 6, from: '!= "booked"', to: '== "booked"', what: '條件反向：只有 booked 的不能取消', kills: ['T2', 'T5', 'S1', 'S2', 'S3', 'S6'] },
]

const SUITES = {
  ai: {
    label: 'AI 第一版', tests: [
      { id: 'T1', name: 'test_booked_returns_bool', weak: '斷言太弱：只檢查型別，True / False 都過',
        code: `def test_booked_returns_bool():\n    a = appt(status="booked", days_ahead=5, cancel_count=0)\n    assert isinstance(can_cancel(a, NOW), bool)` },
      { id: 'T2', name: 'test_cancelled_is_false', weak: null,
        code: `def test_cancelled_is_false():\n    a = appt(status="cancelled", days_ahead=5, cancel_count=0)\n    assert can_cancel(a, NOW) is False` },
      { id: 'T3', name: 'test_past_deadline_is_false', weak: null,
        code: `def test_past_deadline_is_false():\n    a = appt(status="booked", days_ahead=5, cancel_count=0)\n    late = deadline_of(a) + timedelta(hours=1)\n    assert can_cancel(a, late) is False` },
      { id: 'T4', name: 'test_at_cancel_limit_no_error', weak: '只測不會拋例外：沒有 assert，回什麼都算過',
        code: `def test_at_cancel_limit_no_error():\n    a = appt(status="booked", days_ahead=5, cancel_count=2)\n    can_cancel(a, NOW)  # 沒有 assert` },
      { id: 'T5', name: 'test_happy_path_snapshot', weak: '把現況當期望值：EXPECTED 是跑一次程式抄下來的，程式若本來就錯，測試也跟著錯',
        code: `def test_happy_path_snapshot():\n    a = appt(status="booked", days_ahead=3, cancel_count=0)\n    EXPECTED = True  # 從目前的輸出抄來的\n    assert can_cancel(a, NOW) == EXPECTED` },
    ],
  },
  fixed: {
    label: '補強後', tests: [
      { id: 'S1', name: 'test_booked_before_deadline_true', weak: null,
        code: `def test_booked_before_deadline_true():\n    a = appt(status="booked", days_ahead=5, cancel_count=0)\n    assert can_cancel(a, deadline_of(a) - timedelta(minutes=1)) is True` },
      { id: 'S2', name: 'test_cancelled_is_false', weak: null,
        code: `def test_cancelled_is_false():\n    a = appt(status="cancelled", days_ahead=5, cancel_count=0)\n    assert can_cancel(a, NOW) is False` },
      { id: 'S3', name: 'test_exactly_at_deadline_true', weak: null,
        code: `def test_exactly_at_deadline_true():\n    a = appt(status="booked", days_ahead=5, cancel_count=0)\n    assert can_cancel(a, deadline_of(a)) is True  # 規格：17:00 整還能取消` },
      { id: 'S4', name: 'test_one_minute_after_deadline_false', weak: null,
        code: `def test_one_minute_after_deadline_false():\n    a = appt(status="booked", days_ahead=5, cancel_count=0)\n    assert can_cancel(a, deadline_of(a) + timedelta(minutes=1)) is False` },
      { id: 'S5', name: 'test_at_cancel_limit_false', weak: null,
        code: `def test_at_cancel_limit_false():\n    a = appt(status="booked", days_ahead=5, cancel_count=2)\n    assert can_cancel(a, NOW) is False` },
      { id: 'S6', name: 'test_below_cancel_limit_true', weak: null,
        code: `def test_below_cancel_limit_true():\n    a = appt(status="booked", days_ahead=5, cancel_count=1)\n    assert can_cancel(a, NOW) is True` },
    ],
  },
}
const SUITE_ORDER = ['ai', 'fixed']
const allOn = (k) => Object.fromEntries(SUITES[k].tests.map((t) => [t.id, true]))
const killRate = (enabledIds) => MUTANTS.filter((m) => m.kills.some((k) => enabledIds.has(k))).length

export default function TestQualityLab() {
  const [suite, setSuite] = useState('ai')
  const [on, setOn] = useState({ ...allOn('ai'), ...allOn('fixed') })
  const [runN, setRun] = useState(0)         // 0 = 還沒跑；之後每按一次 +1 重播進場動畫
  const run = runN > 0
  const [focus, setFocus] = useState(null)   // 滑過的突變體 → 高亮被改的那行

  const S = SUITES[suite]
  const enabled = new Set(S.tests.filter((t) => on[t.id]).map((t) => t.id))
  const rows = useMemo(() => MUTANTS.map((m) => {
    const red = S.tests.filter((t) => enabled.has(t.id) && m.kills.includes(t.id)).map((t) => t.id)
    return { ...m, red, killed: red.length > 0 }
  }), [suite, on]) // eslint-disable-line
  const killed = rows.filter((r) => r.killed).length
  const survived = MUTANTS.length - killed
  const weakOn = S.tests.filter((t) => enabled.has(t.id) && t.weak).length
  const coverage = enabled.size ? 100 : 0
  const compare = SUITE_ORDER.map((k) => ({ k, label: SUITES[k].label, kill: killRate(new Set(SUITES[k].tests.map((t) => t.id))) }))
  const focused = rows.find((r) => r.id === focus)

  return (
    <Lab accent="green" kicker="TESTING LAB" title="測試品質：綠燈越多，品質為什麼沒變好"
         blurb="一段能不能取消掛號的函式，兩組測試都把每一行跑過了，覆蓋率都是 100%。按「跑突變測試」：把程式故意改壞 8 次，看哪幾次測試仍然全綠——那些就是測試其實沒在驗的地方。開關單一測試，看殺死率怎麼掉。">
      <LabControls>
        <Seg label="測試組" tinted value={suite} onChange={(v) => { setSuite(v); setRun(0); setFocus(null) }}
             options={SUITE_ORDER.map((k) => ({ value: k, label: SUITES[k].label }))} />
        <span className="spacer" />
        <button type="button" className="btn small tq-run" onClick={() => setRun((r) => r + 1)}>{run ? '重新跑突變測試' : '▶ 跑突變測試'}</button>
      </LabControls>

      <LabGrid variant="even">
        <div className="lab-stack">
          <Code lang="python" title="被測函式 can_cancel" highlight={focused ? [focused.line] : []} dim={!!focused}
                marks={focused && focused.line !== 6 ? [{ line: focused.line, text: focused.from }] : []}>{SRC}</Code>
          <LabStage plain label="測試清單，每個可開關">
            <div className="tq-tests">
              {S.tests.map((t) => {
                const kills = MUTANTS.filter((m) => m.kills.includes(t.id)).length
                return (
                  <div key={t.id} className={`tq-test${on[t.id] ? '' : ' off'}${t.weak ? ' weak' : ''}`}>
                    <div className="tq-test-head">
                      <Toggle label={<><code>{t.id}</code> {t.name}</>} checked={!!on[t.id]} onChange={(v) => setOn((o) => ({ ...o, [t.id]: v }))} />
                      <span className={`tq-chip ${t.weak ? 'warn' : kills ? 'ok' : ''}`}>{t.weak ? '假綠燈' : `殺 ${kills} 個突變體`}</span>
                    </div>
                    <Code lang="python">{t.code}</Code>
                    {t.weak && <p className="tq-weak">{t.weak}</p>}
                  </div>
                )
              })}
            </div>
          </LabStage>
        </div>

        <div className="lab-stack">
          <LabStage label="突變測試結果對照表" caption={run ? `紅框 = 存活的突變體：改壞了程式，${enabled.size} 個測試照樣全綠` : '按上方「跑突變測試」產生 8 個突變體'}>
            {!run ? (
              <div className="tq-idle">
                <div className="tq-idle-cov"><span>覆蓋率</span><b>100%</b></div>
                <p>每一行都被跑過了。但「跑過」只代表這行執行了，沒說有任何斷言在檢查它的結果。突變測試會把程式改壞 8 次，看測試有沒有反應。</p>
              </div>
            ) : (
              <div className="dtable-wrap" key={runN}>
                <table className="dtable tq-matrix">
                  <caption>8 個突變體 × {S.tests.length} 個測試（✕ = 這個測試會紅）</caption>
                  <thead><tr><th>#</th><th>改了什麼</th>{S.tests.map((t) => <th key={t.id} className={on[t.id] ? '' : 'tq-th-off'}>{t.id}</th>)}<th>結果</th></tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.id} className={`row-in${r.killed ? '' : ' tq-alive'}`} style={{ '--i': i }}
                          onMouseEnter={() => setFocus(r.id)} onMouseLeave={() => setFocus(null)} onClick={() => setFocus(focus === r.id ? null : r.id)}>
                        <td className="tq-mid">{r.id}<small>L{r.line}</small></td>
                        <td><div className="tq-diff"><span className="del">{r.from}</span><span className="ins">{r.to}</span><span className="what">{r.what}</span></div></td>
                        {S.tests.map((t) => {
                          const hit = r.kills.includes(t.id)
                          return <td key={t.id} className={`tq-cell${!on[t.id] ? ' disabled' : hit ? ' red' : ''}`}>{!on[t.id] ? '·' : hit ? '✕' : '✓'}</td>
                        })}
                        <td>{r.killed ? <Status ok>殺死</Status> : <Status>存活</Status>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </LabStage>

          <Stats min={120}>
            <Stat label="行覆蓋率（示意）" value={`${coverage}%`} note="全開時兩組都是 100%" />
            <Stat label="突變體殺死率" value={run ? `${Math.round((killed / MUTANTS.length) * 100)}%` : '—'} note={run ? `${killed} / ${MUTANTS.length}` : '尚未執行'} tone={run ? (killed === MUTANTS.length ? 'ok' : killed >= 5 ? 'warn' : 'bad') : ''} />
            <Stat label="存活的突變體" value={run ? survived : '—'} note={run && survived ? '這些 bug 進了 main 也不會有人知道' : run ? '全部抓到' : ''} tone={run && survived ? 'bad' : ''} />
            <Stat label="假綠燈" value={weakOn} unit={`/ ${enabled.size} 個測試`} note={weakOn ? '會過，但驗不到東西' : '沒有'} tone={weakOn ? 'warn' : ''} />
          </Stats>
          <BarCompare rows={compare} total={MUTANTS.length} />
        </div>
      </LabGrid>

      <LabGrid variant="even">
        <LabExplain title={run ? (survived ? `${S.label}：${survived} 個突變體活著回來` : `${S.label}：8 個突變體全部殺死`) : `${S.label}：先看測試長什麼樣`}>
          {!run && <p>{suite === 'ai' ? '五個測試、綠燈全亮、每一行都跑過。但 T1 只檢查回傳型別，T4 連 assert 都沒有，T5 的期望值是從程式輸出抄來的——三個測試裡只有名字像在測東西。' : '六個測試每一個都寫清楚「給什麼、該回什麼」，而且專挑邊界打：期限當下、期限後一分鐘、剛好達上限、差一次達上限。'}</p>}
          {run && suite === 'ai' && <p>存活的三個全是邊界：<code>&gt;</code> 換成 <code>&gt;=</code>、<code>&gt;=</code> 換成 <code>&gt;</code>、上限 2 改 3。T4 明明用 cancel_count=2 跑過了那一行，卻因為沒有 assert 而什麼都沒驗；期限邊界則根本沒有測試站在那個時間點上。</p>}
          {run && suite === 'fixed' && <p>每個突變體至少被一個測試紅掉。S3 與 S4 分別站在期限的兩側一分鐘內，S5 與 S6 站在上限的兩側——邊界兩邊各放一個測試，<code>&gt;</code> 和 <code>&gt;=</code> 就分得出來。</p>}
          {run && <p>關掉幾個測試再看：殺死率掉了，覆蓋率仍是 100%——只要剩下的測試還是把每行跑過。滑過或點一列，左邊程式碼會標出被改的那行。</p>}
        </LabExplain>
        <div className="lab-stack">
          <Callout tone="warn" title="覆蓋率是跑過，不是驗過">
            行覆蓋率回答的問題是「這行有沒有被執行」，不是「這行算錯了有沒有人發現」。沒有 assert 的測試、只檢查型別的測試、把現況抄成期望值的測試，都能把覆蓋率推到 100%，同時對任何改壞都毫無反應。突變測試量的才是後者：改壞程式，測試應該要紅；還綠著的地方，就是沒有被驗的地方。
          </Callout>
          <Callout title="什麼時候會真的踩到">
            AI 產生的測試最容易出現這三種假綠燈，因為它看著現有程式寫測試，自然會把現在的行為當成正確答案。審查 AI 測試時先問：這個 assert 若程式回傳相反的值會不會紅？邊界的兩側各有一個案例嗎？CI 上掛一支突變測試工具（Python 常見 mutmut、cosmic-ray），把殺死率和覆蓋率一起看。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .tq-run { background: var(--lab-accent); color: var(--page); border-color: transparent; }
        .tq-tests { display: grid; gap: 8px; }
        .tq-test { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 8px; display: grid; gap: 6px; transition: opacity 0.25s ease, border-color 0.25s ease; min-width: 0; }
        .tq-test.weak { border-color: color-mix(in srgb, var(--serious) 45%, var(--hairline)); }
        .tq-test.off { opacity: 0.45; }
        .tq-test .code { margin: 0; }
        .tq-test .code-head { display: none; }
        .tq-test-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 10px; }
        .tq-test-head code { font-family: var(--mono); font-size: 0.78rem; color: var(--lab-accent); font-weight: 700; }
        .tq-test-head .toggle span:last-child { font-family: var(--mono); font-size: 0.78rem; overflow-wrap: anywhere; }
        .tq-chip { font-size: 0.7rem; font-weight: 600; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--hairline); color: var(--ink-3); white-space: nowrap; }
        .tq-chip.warn { color: var(--serious); border-color: color-mix(in srgb, var(--serious) 50%, transparent); }
        .tq-chip.ok { color: var(--good); border-color: color-mix(in srgb, var(--good) 45%, transparent); }
        .tq-weak { margin: 0; font-size: 0.76rem; line-height: 1.5; color: var(--serious); }
        .tq-idle { display: grid; gap: 10px; padding: 6px 2px; font-size: 0.82rem; line-height: 1.6; color: var(--ink-2); }
        .tq-idle p { margin: 0; }
        .tq-idle-cov { display: flex; align-items: baseline; gap: 10px; font-size: 0.74rem; color: var(--ink-3); }
        .tq-idle-cov b { font-family: var(--mono); font-size: 1.6rem; color: var(--good); }
        .tq-matrix td, .tq-matrix th { white-space: normal; }
        .tq-matrix tbody tr { cursor: pointer; }
        .tq-matrix tbody tr.row-in td { animation-delay: calc(var(--i) * 70ms); }
        .tq-matrix tbody tr.tq-alive td { background: color-mix(in srgb, var(--critical) 9%, transparent); }
        .tq-matrix tbody tr.tq-alive td:first-child { box-shadow: inset 3px 0 0 var(--critical); }
        .tq-matrix tbody tr.tq-alive { outline: 2px solid var(--critical); outline-offset: -2px; }
        .dtable .tq-mid { font-weight: 700; color: var(--ink-1); white-space: nowrap !important; }
        .tq-mid small { display: block; font-weight: 400; color: var(--ink-3); font-size: 0.68rem; }
        .tq-diff { display: grid; gap: 2px; min-width: 170px; }
        .tq-diff .del { color: var(--critical); text-decoration: line-through; font-size: 0.74rem; }
        .tq-diff .ins { color: var(--good); font-size: 0.74rem; }
        .tq-diff .what { font-family: var(--sans); font-size: 0.72rem; color: var(--ink-3); line-height: 1.4; }
        @media (max-width: 560px) {
          .tq-diff { min-width: 0; } .tq-diff .what { display: none; }
          .dtable.tq-matrix th, .dtable.tq-matrix td { padding: 4px 3px; }
          .dtable.tq-matrix th, .dtable.tq-matrix .tq-cell, .dtable.tq-matrix .status { white-space: nowrap !important; }
          .tq-matrix .status { font-size: 0.66rem; padding: 1px 5px; }
        }
        .tq-cell { text-align: center; color: var(--ink-3); }
        .tq-cell.red { color: var(--critical); font-weight: 700; }
        .tq-cell.disabled { opacity: 0.4; }
        .tq-th-off { opacity: 0.4; text-decoration: line-through; }
        .tq-bars { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 8px 10px 4px; }
        .tq-bars-head { font-size: 0.74rem; font-weight: 700; color: var(--ink-2); letter-spacing: 0.03em; margin-bottom: 4px; }
        .tq-bar-group { display: grid; grid-template-columns: 5.5em 1fr; gap: 3px 10px; align-items: center; margin: 6px 0 8px; }
        .tq-bar-name { grid-row: span 2; font-size: 0.8rem; color: var(--ink-1); font-weight: 600; }
        .tq-bar-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
        .tq-bar-track { flex: 1; height: 9px; border-radius: 2px; background: var(--surface-2); overflow: hidden; }
        .tq-bar-track i { display: block; height: 100%; border-radius: 2px; animation: tq-grow 0.6s ease-out both; transform-origin: left; }
        .tq-bar-v { font-family: var(--mono); font-size: 0.72rem; color: var(--ink-3); width: 6.5em; flex-shrink: 0; }
        @keyframes tq-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        @media (prefers-reduced-motion: reduce) { .tq-bar-track i { animation: none; } }
      `}</style>
    </Lab>
  )
}

/* 兩組測試並排：覆蓋率（都 100%）vs 殺死率；HTML 長條，寬度隨容器縮放、字級不變 */
function BarCompare({ rows, total }) {
  return (
    <div className="tq-bars" role="img" aria-label="長條圖：兩組測試覆蓋率都是 100%，殺死率不同">
      <div className="tq-bars-head">兩組測試並排：覆蓋率 vs 殺死率（全部測試開啟時）</div>
      {rows.map((r) => {
        const kill = Math.round((r.kill / total) * 100)
        return (
          <div key={r.k} className="tq-bar-group">
            <span className="tq-bar-name">{r.label}</span>
            <div className="tq-bar-row"><span className="tq-bar-track"><i style={{ width: '100%', background: 'color-mix(in srgb, var(--good) 45%, transparent)' }} /></span><span className="tq-bar-v">覆蓋 100%</span></div>
            <div className="tq-bar-row"><span className="tq-bar-track"><i style={{ width: `${kill}%`, background: kill === 100 ? 'var(--good)' : 'var(--critical)' }} /></span><span className="tq-bar-v">殺死 {kill}%</span></div>
          </div>
        )
      })}
    </div>
  )
}

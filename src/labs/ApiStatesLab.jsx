import React, { useEffect, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Stepper, usePlayer, Code, Callout, Caption, useTicker, useWidth, fmtMs } from './ui.jsx'

/* ============================================================
   API 的四種狀態：門診預約清單呼叫假的 API（純前端模擬，時間是示意）
   - 狀態模式：選一種回應 → 狀態機走一次 → 預覽畫面、用到的元件、驗收條件、網路紀錄
   - 競態模式：搜尋 A 慢、B 快，A 晚到蓋掉 B；打開 AbortController 後 A 被取消
   ============================================================ */

const TIMEOUT = 5000
const SLOW_HINT = 1500
const LIST = [
  { id: 501, time: '09:00', name: '王○明', badge: '候診' },
  { id: 502, time: '09:15', name: '陳○華', badge: '已報到' },
  { id: 503, time: '09:30', name: '林○明', badge: '候診' },
]

/* 每種回應：HTTP 狀態、結果、Network 欄顯示、畫面元件、驗收條件、說明 */
const RESP = {
  ok: {
    label: '成功', net: '200', state: 'success', hl: [17, 18, 19],
    parts: ['List', 'Badge（狀態加文字）'],
    checks: ['每筆一列，`key` 用預約 id', 'Network 只有一筆 200', '狀態用 Badge 加文字，不只靠顏色'],
    title: 'success：200，有資料',
    text: ['`res.ok` 為 true，陣列有三筆，每筆一列。', '狀態用 Badge 加文字（候診、已報到），色覺障礙的使用者也分得出來。'],
  },
  empty: {
    label: '空清單', net: '200', state: 'empty', hl: [17, 18, 19],
    parts: ['Empty state', '次要 Button（選其他日期）'],
    checks: ['顯示「這天沒有預約」與下一步', '沒有空白的表頭或表格', '畫面和錯誤狀態不同'],
    title: 'empty：200，空陣列',
    text: ['請求成功，伺服器明確回答「沒有資料」。這是成功的一種，給 Empty state 與下一步，不顯示錯誤。', '和錯誤共用同一個畫面時，網路斷掉也會顯示「這天沒有預約」，櫃台會以為是休診日。'],
  },
  forbidden: {
    label: '403', net: '403', state: 'error', retry: false, hl: [11, 12, 13, 14, 15, 26, 27],
    problem: { title: '沒有權限查看這個診間的預約', detail: '帳號 nurse-07 沒有 102 診間的權限。' },
    parts: ['inline Alert（role="alert"）', 'Problem Details 的 title、detail'],
    checks: ['顯示 Problem Details 的 `title`', '沒有重試按鈕', 'Console 沒有 `Uncaught (in promise)`'],
    title: 'error：403，不能重試',
    text: ['fetch 收到 403 照樣 resolve，`res.ok` 是 false；body 是 Problem Details，畫面顯示 `title` 與 `detail`。', '沒有權限的請求重送幾次結果都一樣，所以不給重試按鈕，改寫下一步。'],
  },
  server: {
    label: '500', net: '500', state: 'error', retry: true, hl: [11, 12, 13, 14, 15, 26, 27],
    problem: { title: '系統暫時無法處理', detail: '請稍後再試。' },
    parts: ['inline Alert（role="alert"）', 'Button（重試）'],
    checks: ['顯示給人看的原因與「重試」', '按重試回到 loading，Network 多一筆', '畫面沒有 `500` 或 JSON 原文'],
    title: 'error：500，可以重試',
    text: ['`res.ok` 為 false，狀態碼在 500 以上：伺服器暫時出錯，重試有機會成功。', '畫面寫給人看的原因，不顯示 `500` 或 stack trace；按重試回到 loading。'],
  },
  timeout: {
    label: '逾時', net: '(canceled)', state: 'error', retry: true, hl: [20, 21, 22, 23, 26, 27],
    problem: { title: '伺服器回應逾時', detail: '等了 5 秒沒有回應。' },
    parts: ['Skeleton 加「仍在載入」', 'inline Alert', 'Button（重試）'],
    checks: ['5 秒後顯示逾時訊息與重試', 'Network 那筆顯示 `(canceled)`', '等待超過 1.5 秒出現「仍在載入」'],
    title: 'error：逾時，可以重試',
    text: ['伺服器一直沒有回應。fetch 沒有 timeout 選項，`AbortSignal.timeout(5000)` 到時間就取消請求，錯誤的 `name` 是 `TimeoutError`。', '取消的請求在 DevTools 的 Network 分頁顯示 `(canceled)`。'],
  },
  offline: {
    label: '斷線', net: '(failed)', state: 'error', retry: true, hl: [20, 21, 22, 23, 26, 27],
    problem: { title: '無法連線，請檢查網路', detail: '' },
    parts: ['inline Alert', 'Button（重試）'],
    checks: ['顯示「無法連線」與重試', 'Network 那筆顯示 `(failed)`', '不是「這天沒有預約」'],
    title: 'error：網路錯誤，可以重試',
    text: ['連不上伺服器時 fetch reject 一個 `TypeError`（Chrome 的訊息是 `Failed to fetch`），沒有狀態碼。', '被 CORS 擋下也是同一個錯誤，要看 Console 才分得出來。'],
  },
}
const RESP_KEYS = Object.keys(RESP)

const IDLE = {
  hl: [1], parts: ['說明文字'], checks: ['還沒送出請求時不顯示「沒有預約」'],
  title: 'idle：還沒有送出請求',
  text: ['還沒有資料，也還沒開始等。多數清單一進頁面就送出請求，idle 只停留一瞬間；要先選條件（例如日期）的畫面才看得到它。'],
}
const LOADING = {
  hl: [7, 9, 10], parts: ['Skeleton × 3', '停用的 Button', '容器 aria-busy="true"'],
  checks: ['立刻出現 3 列 Skeleton，列高和資料列相同', '「送出請求」停用，連點只送一筆', '容器帶 `aria-busy="true"`'],
  title: 'loading：等回應',
  text: ['請求已送出、還沒有回應。Skeleton 佔住清單的位置，資料回來時版面不跳。', `「送出請求」這段時間停用，連點也只送一筆；等超過 ${SLOW_HINT / 1000} 秒加一行「仍在載入」，讓使用者知道沒有當掉。`],
}

const STATES_CODE = `const status = ref('idle')   // 五個值之一
const items = ref([])
const problem = ref(null)
const listUrl = '/api/appointments?date=2026-11-20'

async function load() {
  status.value = 'loading'
  try {
    const res = await fetch(listUrl, {
      signal: AbortSignal.timeout(5000) })
    if (!res.ok) {
      problem.value = await res.json()   // Problem Details
        .catch(() => ({ status: res.status }))
      status.value = 'error'
      return
    }
    items.value = await res.json()
    status.value = items.value.length
      ? 'success' : 'empty'
  } catch (err) {   // 網路錯誤、逾時
    problem.value = { title: err.name === 'TimeoutError'
      ? '伺服器回應逾時' : '無法連線，請檢查網路' }
    status.value = 'error'
  }
}
const canRetry = computed(() =>
  !problem.value?.status || problem.value.status >= 500)`

/* ---- 競態模式：A 在 0 ms 送出、1200 ms 回來；B 在 200 ms 送出、600 ms 回來 ---- */
const RACE = { a: { q: '王', at: 0, back: 1200, rows: ['王○明', '王○同', '王○玲'] }, b: { q: '王小', at: 200, back: 600, rows: ['王○明'] } }
const RACE_T = [0, 200, 600, 1200]
const RACE_LABELS = ['送出 A', '送出 B', 'B 回來', 'A 回來']
const raceCode = (abort) => [
  "const keyword = ref('')",
  'const results = ref([])',
  abort && 'let controller = null',
  '',
  'watch(keyword, async (q) => {',
  abort && '  controller?.abort()   // 取消前一個請求',
  abort && '  controller = new AbortController()',
  '  try {',
  '    const res = await fetch(',
  '      `/api/patients?q=${encodeURIComponent(q)}`' + (abort ? ',' : ')'),
  abort && '      { signal: controller.signal })',
  '    results.value = await res.json()',
  '  } catch (err) {',
  "    if (err.name !== 'AbortError') throw err",
  '  }',
  '})',
].filter((l) => l !== false).join('\n')

function raceView(step, abort) {
  const keyword = step === 0 ? RACE.a.q : RACE.b.q
  let shown = null
  if (step >= 2) shown = 'b'
  if (step >= 3 && !abort) shown = 'a'
  const aState = abort && step >= 1 ? 'canceled' : step >= 3 ? 'done' : 'pending'
  const bState = step < 1 ? 'none' : step >= 2 ? 'done' : 'pending'
  return { keyword, shown, aState, bState, mismatch: shown === 'a' }
}
function raceExplain(step, abort) {
  if (step === 0) return { title: '輸入「王」：送出 A', text: ['A 查「王」，伺服器要 1.2 秒才回（示意）。畫面進入 loading。'] }
  if (step === 1) return abort
    ? { title: '輸入「王小」：先取消 A，再送出 B', text: ['送出 B 之前先 `controller.abort()`：A 在 Network 分頁變成 `(canceled)`，它的 `await` 丟出 `AbortError`，被 `catch` 略過。'] }
    : { title: '輸入「王小」：送出 B', text: ['A 還在路上，B 查「王小」，0.4 秒就回來。兩個請求同時在跑，誰後回來誰決定畫面。'] }
  if (step === 2) return { title: 'B 回來：畫面顯示 1 筆', text: ['`results` 變成「王小」的結果，和搜尋框一致。'] }
  return abort
    ? { title: 'A 已取消：畫面維持 B', text: ['A 在上一步就被取消，不會再改畫面。最後送出的請求決定畫面。'] }
    : { title: 'A 晚到：蓋掉 B', text: ['慢的 A 在 B 之後回來，`results` 被改成「王」的 3 筆。搜尋框寫「王小」，清單卻有王○同：畫面和條件不一致，Console 也沒有任何錯誤。'] }
}

export default function ApiStatesLab() {
  const [mode, setMode] = useState('states')
  const [respKey, setRespKey] = useState('ok')
  const [delay, setDelay] = useState(800)
  const [status, setStatus] = useState('idle')      // idle | loading | success | empty | error
  const [outcome, setOutcome] = useState(null)       // 最後一次回應的 RESP key
  const [edge, setEdge] = useState(null)
  const [startedAt, setStartedAt] = useState(0)
  const [log, setLog] = useState([])
  const [abort, setAbort] = useState(false)
  const timer = useRef(null)
  const seq = useRef(0)
  const race = usePlayer(4, 1500)
  useTicker(status === 'loading', 100)              // loading 時每 0.1 秒重畫，更新已等時間
  useEffect(() => () => clearTimeout(timer.current), [])

  const send = (key = respKey) => {
    clearTimeout(timer.current)
    const id = ++seq.current
    const r = RESP[key]
    const wait = key === 'timeout' ? TIMEOUT : key === 'offline' ? Math.min(delay, 200) : delay
    setEdge((prev) => (status === 'error' ? 'retry' : status === 'success' || status === 'empty' ? 'refresh' : status === 'idle' ? 'send' : prev))
    setStatus('loading')
    setStartedAt(Date.now())
    setLog((l) => [{ id, url: 'GET /api/appointments?date=2026-11-20', net: '…', ms: null }, ...l.map((e) => (e.net === '…' ? { ...e, net: '(canceled)' } : e))].slice(0, 4))
    timer.current = setTimeout(() => {
      setStatus(r.state)
      setOutcome(key)
      setEdge(r.state === 'success' ? 'ok' : r.state === 'empty' ? 'empty' : 'fail')
      setLog((l) => l.map((e) => (e.id === id ? { ...e, net: r.net, ms: wait } : e)))
    }, wait)
  }
  const pickResp = (k) => { setRespKey(k); send(k) }
  const reset = () => { clearTimeout(timer.current); setStatus('idle'); setOutcome(null); setEdge(null); setLog([]) }

  const info = status === 'idle' ? IDLE : status === 'loading' ? LOADING : RESP[outcome]
  const elapsed = status === 'loading' ? Date.now() - startedAt : 0
  const rv = raceView(race.step, abort)
  const rx = raceExplain(race.step, abort)

  return (
    <Lab accent="aqua" kicker="FRONTEND LAB" title="API 的四種狀態"
         blurb="門診預約清單呼叫假的 API：每種回應落在哪個狀態、畫面用哪些元件、要驗收什麼；以及舊回應蓋掉新結果的競態。">
      <LabControls>
        {mode === 'states' && <>
          <Seg label="回應" tinted value={respKey} onChange={pickResp} options={RESP_KEYS.map((k) => ({ value: k, label: RESP[k].label }))} />
          <Slider label="延遲（示意）" min={100} max={3000} step={100} value={delay} onChange={setDelay} format={fmtMs} />
          <button type="button" className="btn small" disabled={status === 'loading'} onClick={() => send()}>送出請求</button>
          {log.length > 0 && <button type="button" className="btn ghost small" onClick={reset}>重設</button>}
        </>}
        {mode === 'race' && <>
          <Toggle label="用 AbortController 取消前一個請求" checked={abort} onChange={setAbort} />
          <Stepper step={race.step} total={4} onStep={race.setStep} playing={race.playing} onPlay={race.toggle} labels={RACE_LABELS} />
        </>}
        <span className="spacer" />
        <Seg label="實驗" value={mode} onChange={setMode}
             options={[{ value: 'states', label: '四種狀態' }, { value: 'race', label: '競態' }]} />
      </LabControls>

      {mode === 'states' ? (
        <LabGrid>
          <div className="lab-stack">
            <LabStage label="狀態機與畫面預覽">
              <div className="asl-top">
                <Machine status={status} edge={edge} />
                <Preview status={status} resp={outcome && RESP[outcome]} elapsed={elapsed} onRetry={() => send()} />
              </div>
              <div className="dtable-wrap asl-net">
                <table className="dtable">
                  <caption>網路</caption>
                  <thead><tr><th>請求</th><th>狀態</th><th>耗時</th></tr></thead>
                  <tbody>
                    {log.length === 0 && <tr><td colSpan={3} className="muted">還沒有請求</td></tr>}
                    {log.map((e) => (
                      <tr key={e.id} className="row-in">
                        <td>{e.url}</td>
                        <td className={`asl-nw${/^\(/.test(e.net) || /^[45]/.test(e.net) ? ' asl-bad' : ''}`}>{e.net}</td>
                        <td className="asl-nw">{e.ms == null ? '' : fmtMs(e.ms)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </LabStage>
            <div className="asl-spec">
              <div>
                <h5>用到的元件</h5>
                <p className="asl-tags">{info.parts.map((p) => <span key={p} className="tag">{p}</span>)}</p>
              </div>
              <div>
                <h5>驗收條件</h5>
                <ul className="asl-checks">{info.checks.map((c) => <li key={c} dangerouslySetInnerHTML={{ __html: md(c) }} />)}</ul>
              </div>
            </div>
            <Caption>純前端模擬，時間是示意；這些請求不會出現在 DevTools 的 Network 分頁，「網路」表模擬它會顯示的狀態。</Caption>
          </div>
          <div className="lab-stack">
            <Code lang="js" title="AppointmentList.vue（script 節錄）" highlight={info.hl}>{STATES_CODE}</Code>
            <LabExplain title={info.title}>
              {info.text.map((t) => <p key={t} dangerouslySetInnerHTML={{ __html: md(t) }} />)}
            </LabExplain>
            <Callout title="工作上什麼時候用">清單、表格、卡片這類要等資料的畫面，動工前先列出每種狀態的畫面與驗收條件；驗收時用 DevTools 的節流、Offline、Block request URL 逐一切過。</Callout>
          </div>
        </LabGrid>
      ) : (
        <LabGrid>
          <div className="lab-stack">
            <LabStage label="兩個搜尋請求的時間線">
              <Timeline step={race.step} view={rv} abort={abort} />
              <div className={`asl-screen${rv.mismatch ? ' bad' : ''}`}>
                <div className="asl-search">搜尋：<b>{rv.keyword}</b>{rv.mismatch && <span className="asl-flag">畫面與條件不一致</span>}</div>
                {rv.shown ? <ul>{RACE[rv.shown].rows.map((n) => <li key={n}>{n}</li>)}</ul> : <p className="muted">載入中…</p>}
              </div>
            </LabStage>
            <Caption>A 慢、B 快是示意；實際上誰先回來取決於伺服器與網路，順序不保證。</Caption>
          </div>
          <div className="lab-stack">
            <Code lang="js" title="PatientSearch.vue（script 節錄）" highlight={abort ? [3, 6, 7, 11, 14] : []}>{raceCode(abort)}</Code>
            <LabExplain title={rx.title}>
              {rx.text.map((t) => <p key={t} dangerouslySetInnerHTML={{ __html: md(t) }} />)}
            </LabExplain>
            <Callout title="工作上什麼時候用">搜尋框即時查詢、切換 Tab 或日期重新抓資料時，條件改得比回應快就會遇到。描述需求時寫明「換條件時取消前一個請求」，驗收時用節流讓請求變慢再快速切換。</Callout>
          </div>
        </LabGrid>
      )}

      <style>{`
        .asl-top { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; align-items: start; }
        .asl-fsm { width: 100%; max-width: 360px; display: block; margin: 0 auto; }
        .asl-fsm .n { fill: var(--surface-1); stroke: var(--hairline); stroke-width: 1.5; transition: stroke 0.25s ease, fill 0.25s ease; }
        .asl-fsm .n.on { stroke: var(--lab-accent); stroke-width: 2.5; fill: color-mix(in srgb, var(--lab-accent) 12%, var(--surface-1)); }
        .asl-fsm .e { fill: none; stroke: color-mix(in srgb, var(--ink-3) 60%, transparent); stroke-width: 1.5; marker-end: url(#asl-arrow); transition: stroke 0.25s ease; }
        .asl-fsm .e.on { stroke: var(--lab-accent); stroke-width: 2.5; marker-end: url(#asl-arrow-on); }
        .asl-fsm .nt { font-family: var(--mono); font-size: 14px; fill: var(--ink-1); }
        .asl-fsm .el { font-family: var(--sans); font-size: 12px; fill: var(--ink-3); }
        .asl-net { margin-top: 14px; }
        .asl-net td.asl-nw, .asl-net th { white-space: nowrap !important; }
        .asl-bad { color: var(--critical) !important; }
        .asl-phone { border: 1px solid var(--hairline); border-radius: 10px; background: var(--surface-1); padding: 12px; min-height: 196px; font-size: 0.86rem; }
        .asl-phone h4 { margin: 0 0 10px; font-size: 0.92rem; display: flex; justify-content: space-between; gap: 8px; }
        .asl-phone h4 span { font-weight: 400; color: var(--ink-3); font-size: 0.78rem; }
        .asl-row { display: grid; grid-template-columns: 3.2rem 1fr auto; gap: 8px; align-items: center; height: 2.4rem; border-bottom: 1px solid var(--hairline); animation: asl-in 0.3s ease-out both; }
        .asl-badge { font-size: 0.72rem; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--c-blue); color: var(--c-blue); }
        .asl-badge.done { border-color: var(--good); color: var(--good); }
        .asl-skel { height: 2.4rem; display: flex; align-items: center; border-bottom: 1px solid var(--hairline); }
        .asl-skel i { display: block; height: 0.8rem; width: 70%; border-radius: 4px; background: var(--surface-2); animation: asl-pulse 1.1s ease-in-out infinite; }
        .asl-slow { margin: 8px 0 0; color: var(--ink-3); font-size: 0.78rem; }
        .asl-empty, .asl-idle { text-align: center; padding: 22px 8px; color: var(--ink-2); }
        .asl-alert { border-left: 3px solid var(--critical); background: color-mix(in srgb, var(--critical) 8%, var(--surface-1)); padding: 10px 12px; border-radius: 0 var(--radius) var(--radius) 0; }
        .asl-alert b { display: block; color: var(--ink-1); }
        .asl-alert p { margin: 4px 0 8px; color: var(--ink-2); font-size: 0.8rem; }
        .asl-spec { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
        .asl-spec h5 { margin: 0 0 6px; font-size: 0.74rem; letter-spacing: 0.08em; color: var(--ink-2); }
        .asl-tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; }
        .asl-checks { margin: 0; padding-left: 1.1rem; font-size: 0.84rem; color: var(--ink-2); line-height: 1.6; }
        .asl-tl { width: 100%; display: block; }
        .asl-tl .bar { transition: width 0.4s ease, opacity 0.3s ease; }
        .asl-tl .now { stroke: var(--lab-accent); stroke-width: 2; transition: transform 0.4s ease; }
        .asl-screen { margin-top: 12px; border: 1px solid var(--hairline); border-radius: 10px; background: var(--surface-1); padding: 10px 12px; transition: border-color 0.3s ease; }
        .asl-screen.bad { border-color: var(--critical); }
        .asl-screen ul { margin: 6px 0 0; padding-left: 1.1rem; }
        .asl-search { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        .asl-flag { font-size: 0.74rem; color: var(--critical); border: 1px solid var(--critical); border-radius: 999px; padding: 0 8px; }
        @keyframes asl-pulse { 50% { opacity: 0.45; } }
        @keyframes asl-in { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .asl-skel i, .asl-row { animation: none; } .asl-tl .bar, .asl-tl .now { transition: none; } }
      `}</style>
    </Lab>
  )
}

function md(s) {
  return s.replace(/`([^`]+)`/g, '<code>$1</code>')
}

/* 狀態機：idle → loading → success / empty / error，error 重試、success / empty 重新整理回到 loading */
const NODES = { idle: [4, 80], loading: [108, 80], success: [220, 14], empty: [220, 80], error: [220, 146] }
const NW = 76, NH = 30
const EDGES = [
  { id: 'send', d: 'M80 95 H106', lx: 93, ly: 124, label: '送出' },
  { id: 'ok', d: 'M184 88 C204 88 200 29 218 29', lx: 186, ly: 50, label: '2xx' },
  { id: 'empty', d: 'M184 95 H218' },
  { id: 'fail', d: 'M184 102 C204 102 200 161 218 161', lx: 184, ly: 146, label: '失敗' },
  { id: 'retry', d: 'M220 172 C176 192 146 160 146 112', lx: 170, ly: 190, label: '重試' },
  { id: 'refresh', d: 'M220 20 C176 4 146 44 146 78', lx: 150, ly: 12, label: '重新整理' },
]
function Machine({ status, edge }) {
  return (
    <svg className="asl-fsm" viewBox="0 0 300 196" role="img" aria-label={`請求的狀態機，目前狀態 ${status}`}>
      <defs>
        <marker id="asl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-3)" /></marker>
        <marker id="asl-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="var(--lab-accent)" /></marker>
      </defs>
      {EDGES.map((e) => (
        <g key={e.id}>
          <path className={`e${edge === e.id ? ' on' : ''}`} d={e.d} />
          {e.label && <text x={e.lx} y={e.ly} textAnchor="middle" className="el">{e.label}</text>}
        </g>
      ))}
      {Object.entries(NODES).map(([k, [x, y]]) => (
        <g key={k}>
          <rect className={`n${status === k ? ' on' : ''}`} x={x} y={y} width={NW} height={NH} rx="6" />
          <text x={x + NW / 2} y={y + 20} textAnchor="middle" className="nt">{k}</text>
        </g>
      ))}
    </svg>
  )
}

/* 畫面預覽：同一個元件在每種狀態下長什麼樣 */
function Preview({ status, resp, elapsed, onRetry }) {
  return (
    <div className="asl-phone" aria-busy={status === 'loading'}>
      <h4>11/20 的預約 <span>內科 101</span></h4>
      {status === 'idle' && <p className="asl-idle">選擇日期後載入預約</p>}
      {status === 'loading' && <>
        {[0, 1, 2].map((i) => <div key={i} className="asl-skel"><i style={{ width: `${70 - i * 12}%` }} /></div>)}
        {elapsed > SLOW_HINT && <p className="asl-slow">仍在載入（已等 {fmtMs(elapsed)}）</p>}
      </>}
      {status === 'success' && LIST.map((a) => (
        <div key={a.id} className="asl-row"><span>{a.time}</span><span>{a.name}</span><span className={`asl-badge${a.badge === '已報到' ? ' done' : ''}`}>{a.badge}</span></div>
      ))}
      {status === 'empty' && (
        <div className="asl-empty">
          <p>這天沒有預約</p>
          <button type="button" className="btn ghost small" onClick={onRetry}>選其他日期</button>
        </div>
      )}
      {status === 'error' && resp && (
        <div className="asl-alert" role="alert">
          <b>{resp.problem.title}</b>
          {resp.problem.detail && <p>{resp.problem.detail}</p>}
          {resp.retry
            ? <button type="button" className="btn small" onClick={onRetry}>重試</button>
            : <p>需要這份資料時，請聯絡系統管理者。</p>}
        </div>
      )}
    </div>
  )
}

/* 競態的時間線：0–1400 ms，A、B 兩條請求，直線標出目前這一步的時間 */
function Timeline({ step, view, abort }) {
  const box = useRef(null)
  const VW = Math.max(280, Math.min(640, Math.round(useWidth(box, 480))))   // viewBox 跟著實際寬度，字不會被縮小
  const X0 = 74, W = VW - X0 - 40
  const x = (t) => X0 + (t / 1400) * W
  const t = RACE_T[step]
  const lane = (key, y) => {
    const r = RACE[key]
    const st = key === 'a' ? view.aState : view.bState
    if (st === 'none') return null
    const end = st === 'canceled' ? RACE.b.at : st === 'done' ? r.back : t
    const color = key === 'a' ? 'var(--c-orange)' : 'var(--c-blue)'
    return (
      <g>
        <rect className="bar" x={x(r.at)} y={y} width={Math.max(2, x(end) - x(r.at))} height="14" rx="3" fill={color} opacity={st === 'canceled' ? 0.35 : 0.85} />
        <text x={x(end) + 6} y={y + 11} className="svg-text small">
          {st === 'canceled' ? '(canceled)' : st === 'done' ? `${r.rows.length} 筆` : '…'}
        </text>
      </g>
    )
  }
  return (
    <div ref={box}>
    <svg className="asl-tl" viewBox={`0 0 ${VW} 112`} role="img" aria-label={`兩個搜尋請求的時間線，第 ${step + 1} 步，${abort ? '有' : '沒有'}取消前一個請求`}>
      <text x="4" y="31" className="svg-text">A「王」</text>
      <text x="4" y="61" className="svg-text">B「王小」</text>
      {lane('a', 20)}
      {lane('b', 50)}
      <line x1={X0} x2={X0 + W} y1="82" y2="82" className="svg-edge" />
      {[0, 200, 600, 1200].map((v) => (
        <text key={v} x={x(v)} y="98" textAnchor="middle" className="svg-text small">{v}</text>
      ))}
      <text x={X0 + W} y="110" textAnchor="end" className="svg-text small">ms</text>
      <line className="now" x1={x(t)} x2={x(t)} y1="12" y2="84" />
    </svg>
    </div>
  )
}

import React, { useEffect, useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Slider, Toggle, Callout, Status, Stats, Stat, Flow, Caption } from '../ui.jsx'

/* 驗證放哪裡情境模擬器：
   同一張掛號表單、同一組七筆測試資料，切換四種做法，看每筆資料在哪一層被擋下，或沒有被擋。
   「後端最近的規則變更」模擬規格改了、只有後端那份（或 schema 來源）被更新的情況。
   網路來回 400 ms 是示意值。 */

const MODES = [
  { value: 'front', label: '只前端' },
  { value: 'back', label: '只後端' },
  { value: 'both', label: '兩邊各寫' },
  { value: 'shared', label: '共用 schema' },
]
const DRIFTS = [
  { value: 'none', label: '沒有變更' },
  { value: 'tighten', label: '備註上限 200 → 100' },
  { value: 'loosen', label: '手機也收 +886' },
]
const RTT = 400
const BASE = { chart: '10234567', phone: '0912345678', note: 40, full: false, curl: false }
const CASES = [
  { id: 'good', label: '資料都對', v: {} },
  { id: 'empty', label: '漏填病歷號', v: { chart: '' } },
  { id: 'short', label: '手機少一碼', v: { phone: '091234567' } },
  { id: 'note', label: '備註 150 字', v: { note: 150 } },
  { id: 'intl', label: '手機寫成 +886', v: { phone: '+886912345678' } },
  { id: 'full', label: '診次已額滿', v: { full: true } },
  { id: 'curl', label: 'curl 直接打 API、病歷號空白', v: { chart: '', curl: true } },
]
const KIND = {
  ok: { short: '成功', cls: 'ok' },
  front: { short: '前端擋', cls: 'ok' },
  back422: { short: '422', cls: 'wait' },
  back409: { short: '409', cls: 'wait' },
  db: { short: '進資料庫', cls: 'bad' },
  blocked: { short: '送不出', cls: 'bad' },
}

const rulesFor = (drift) => ({ noteMax: drift === 'tighten' ? 100 : 200, intl: drift === 'loosen' })
/* 格式類規則：前端、後端都檢查得了 */
function formatErrors(v, r) {
  const e = {}
  if (!v.chart.trim()) e.chart = '請填病歷號'
  else if (!/^\d{8}$/.test(v.chart)) e.chart = '病歷號是 8 位數字'
  const phoneOk = /^09\d{8}$/.test(v.phone) || (r.intl && /^\+8869\d{8}$/.test(v.phone))
  if (!phoneOk) e.phone = r.intl ? '手機是 09 或 +8869 開頭' : '手機是 09 開頭的 10 碼'
  if (v.note > r.noteMax) e.note = `備註最多 ${r.noteMax} 字`
  return e
}
/* 一筆資料在某種做法下的下場 */
function outcome(mode, v, drift) {
  const spec = rulesFor(drift)                                  // 規格（後端或 schema 來源那份）
  const frontRules = mode === 'both' ? rulesFor('none') : spec   // 兩邊各寫：前端那份沒跟上
  const front = mode !== 'back' && !v.curl
  const back = mode !== 'front'
  const fe = front ? formatErrors(v, frontRules) : {}
  const be = formatErrors(v, spec)
  const n = (o) => Object.keys(o).length
  if (n(fe)) return { kind: n(be) ? 'front' : 'blocked', stop: 1, errors: fe, from: 'front' }
  if (back && n(be)) return { kind: 'back422', stop: 3, errors: be, from: 'back' }
  if (back && v.full) return { kind: 'back409', stop: 3, errors: {}, form: '診次 7 名額已滿，請選其他診次', from: 'back' }
  if (!back && (n(be) || v.full)) return { kind: 'db', stop: 4, errors: {}, form: v.full ? '超收：第 31 號掛進 30 人的診次' : '空白病歷號寫進資料庫' }
  return { kind: 'ok', stop: 4, errors: {} }
}

const EXPLAIN = {
  front: { title: '只前端：表單擋得住，API 擋不住', body: ['格式錯的資料在輸入框旁邊就被攔下，不用等網路。規則只存在瀏覽器裡：用 curl、排程程式或舊版 App 直接打 API，什麼都不檢查。', '名額、病歷號存在這類要查資料庫的規則，前端做不到，結果是超收。'] },
  back: { title: '只後端：每個錯都要等一次來回', body: ['後端的 model 是唯一的規則，所有呼叫端都擋得住，規則改了部署後端就生效。', '代價是使用者要按下送出、等伺服器回 422，才知道哪一欄錯；改一欄再送一次，長表單要來回好幾輪。422 的 errors 要對回欄位，否則只看到一行「Unprocessable Content」。'] },
  both: { title: '兩邊各寫：平常最好用，規則一改就漂移', body: ['前端照規格書寫一份給即時回饋，後端那份才算數。', '規則變更切到「備註上限 200 → 100」：150 字的備註過得了前端，送出後才被 422 退回。切到「手機也收 +886」更糟：後端已經接受，前端還擋著，合法的資料送不出去，也沒有後端可以兜底。'] },
  shared: { title: '共用 schema：一份規則跑在兩邊', body: ['後端的 model 產生 OpenAPI，前端建置前從它產生 zod schema。規則改了，前端下一次建置就跟上，兩種規則變更都不會漂移。', '名額這類要查資料庫的規則仍只在後端，409 的處理照樣要寫；已經開著的舊頁面也還是舊規則，後端的驗證不能省。'] },
}

export default function ValidationPlacementScenarioLab() {
  const [mode, setMode] = useState('both')
  const [drift, setDrift] = useState('tighten')
  const [v, setV] = useState({ ...BASE, note: 150 })
  const [caseId, setCaseId] = useState('note')
  const [run, setRun] = useState(null)               // { out, phase }：送出後的動畫
  const set = (patch) => { setV((x) => ({ ...x, ...patch })); setCaseId(null); setRun(null) }
  const load = (c) => { setV({ ...BASE, ...c.v }); setCaseId(c.id); setRun(null) }
  useEffect(() => { setRun(null) }, [mode, drift])

  const out = outcome(mode, v, drift)
  const liveFront = mode !== 'back' && !v.curl ? formatErrors(v, mode === 'both' ? rulesFor('none') : rulesFor(drift)) : {}
  const submit = () => setRun({ out, phase: 0, key: Date.now() })
  useEffect(() => {
    if (!run || run.phase >= run.out.stop) return
    const t = setTimeout(() => setRun((r) => r && { ...r, phase: r.phase + 1 }), run.phase === 2 ? RTT / 2 : 260)
    return () => clearTimeout(t)
  }, [run])
  const done = run && run.phase >= run.out.stop
  const shownErrors = done && run.out.from === 'back' ? run.out.errors : liveFront

  const matrix = useMemo(() => CASES.map((c) => ({ c, res: Object.fromEntries(MODES.map((m) => [m.value, outcome(m.value, { ...BASE, ...c.v }, drift)])) })), [drift])
  const count = (k) => matrix.filter((r) => r.res[mode].kind === k).length
  const ex = EXPLAIN[mode]

  const step = (i, label, value, bad) => ({ label, value: i === 0 || (run && run.phase >= i) ? value : '…', hot: !!run && run.phase >= i, bad: done && run.out.stop === i && bad })
  const frontVal = mode === 'back' ? '沒有這一層' : v.curl ? '被繞過' : out.from === 'front' ? `擋下 ${Object.keys(out.errors).length} 欄` : '通過'
  const backVal = mode === 'front' ? '沒有這一層' : out.kind === 'back422' ? `422：${Object.keys(out.errors).length} 欄` : out.kind === 'back409' ? '409：名額已滿' : out.stop < 3 ? '—' : '通過'
  const steps = [
    step(0, v.curl ? 'curl' : '表單', v.curl ? '不經過畫面' : '按下掛號'),
    step(1, '前端驗證', frontVal, out.kind === 'blocked'),
    step(2, '網路', out.stop >= 3 ? `來回 ${RTT} ms` : '沒送出'),
    step(3, '後端驗證', backVal),
    step(4, '資料庫', out.kind === 'db' ? '寫入壞資料' : out.kind === 'ok' ? '寫入 1 筆' : '—', out.kind === 'db'),
  ]

  return (
    <Lab accent="aqua" kicker="SCENARIO LAB" title="同一張掛號表單，七筆資料，四種驗證放法"
         blurb="每筆資料在哪一層被擋下、要等多久才知道錯、有沒有漏進資料庫。">
      <LabControls>
        <Seg label="做法" tinted value={mode} onChange={setMode} options={MODES} />
        <Seg label="後端最近的規則變更" value={drift} onChange={setDrift} options={DRIFTS} />
      </LabControls>
      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabStage label="掛號表單">
            <div className="vp-form">
              {done && run.out.form && <p className={`vp-alert ${run.out.kind === 'db' ? 'bad' : ''}`} role="alert">{run.out.kind === 'db' ? '✕ ' : ''}{run.out.form}</p>}
              <Field id="chart" label="病歷號" err={shownErrors.chart} server={done && run.out.from === 'back'}>
                <input id="vp-chart" value={v.chart} inputMode="numeric" onChange={(e) => set({ chart: e.target.value })} aria-invalid={!!shownErrors.chart} aria-describedby="vp-chart-err" />
              </Field>
              <Field id="phone" label="手機" err={shownErrors.phone} server={done && run.out.from === 'back'}>
                <input id="vp-phone" value={v.phone} inputMode="tel" onChange={(e) => set({ phone: e.target.value })} aria-invalid={!!shownErrors.phone} aria-describedby="vp-phone-err" />
              </Field>
              <Field id="note" label="備註" err={shownErrors.note} server={done && run.out.from === 'back'}>
                <Slider label="備註字數" min={0} max={250} step={10} value={v.note} onChange={(n) => set({ note: n })} format={(n) => `${n} 字`} />
              </Field>
              <div className="vp-row">
                <Toggle label="診次已額滿（只有資料庫知道）" checked={v.full} onChange={(b) => set({ full: b })} />
                <Toggle label="用 curl 繞過表單" checked={v.curl} onChange={(b) => set({ curl: b })} />
              </div>
              <div className="vp-row">
                <button type="button" className="btn small" onClick={submit} disabled={!!run && !done}>{v.curl ? '送出 curl 請求' : '掛號'}</button>
                <span className="spacer" />
                {done && (KIND[run.out.kind].cls === 'bad' ? <Status>{run.out.kind === 'db' ? '壞資料進了資料庫' : '合法資料被前端擋下'}</Status>
                  : run.out.kind === 'ok' ? <Status ok>201 掛號成功</Status>
                  : run.out.from === 'front' ? <Status ok>送出前就知道錯</Status>
                  : <Status warn>等 {RTT} ms 才知道錯</Status>)}
              </div>
              {out.kind === 'blocked' && <p className="vp-note">後端已經接受 +886，前端這份規則還是兩年前的版本。</p>}
            </div>
          </LabStage>
          <Flow title={v.curl ? '這個請求經過的層' : '按下掛號之後'} steps={steps}
                notes={[run ? null : '按下按鈕看資料走到哪一層', `網路來回 ${RTT} ms 為示意值`]} />
          <div className="dtable-wrap">
            <table className="dtable vp-matrix">
              <caption>七筆測試資料 × 四種做法</caption>
              <thead><tr><th scope="col">資料</th>{MODES.map((m) => <th key={m.value} scope="col" className={m.value === mode ? 'cur' : ''}>{m.label}</th>)}</tr></thead>
              <tbody>
                {matrix.map(({ c, res }) => (
                  <tr key={c.id} className={c.id === caseId ? 'hit' : ''}>
                    <th scope="row"><button type="button" className="vp-case" onClick={() => load(c)} aria-pressed={c.id === caseId}>{c.label}</button></th>
                    {MODES.map((m) => <td key={m.value} className={m.value === mode ? 'cur' : ''}><span className={`vp-chip ${KIND[res[m.value].kind].cls}`}>{KIND[res[m.value].kind].short}</span></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Caption>綠：送出前就知道錯，或成功；黃：送出後才被 422 / 409 退回；紅：壞資料進了資料庫，或合法資料送不出去</Caption>
        </div>
        <div className="lab-stack">
          <Stats min={120}>
            <Stat label="壞資料進資料庫" value={count('db')} unit="筆" tone={count('db') ? 'bad' : 'ok'} />
            <Stat label="合法資料送不出去" value={count('blocked')} unit="筆" tone={count('blocked') ? 'bad' : 'ok'} />
            <Stat label="送出後才知道錯" value={count('back422') + count('back409')} unit="筆" tone={count('back422') > 1 ? 'warn' : ''} note="名額那筆每種做法都要等" />
            <Stat label="要維護的規則" value={mode === 'both' ? '2 份' : '1 份'} note={mode === 'shared' ? '加一個產生步驟' : mode === 'both' ? '前端、後端各一' : ''} tone={mode === 'both' ? 'warn' : ''} />
          </Stats>
          <LabExplain title={ex.title}>{ex.body.map((p, i) => <p key={i}>{p}</p>)}</LabExplain>
          <Callout title="什麼時候會踩到">規格書改版、後端調了一個上限、網頁版和 App 各自上線的時候。使用者回報「畫面說可以，送出卻失敗」或「格式明明對，按鈕一直按不下去」，多半是兩份規則對不上。</Callout>
        </div>
      </LabGrid>
      <style>{`
        .vp-form { display: grid; gap: 10px; }
        .vp-field { display: grid; gap: 4px; font-size: 0.84rem; }
        .vp-field > label { font-weight: 700; color: var(--ink-1); }
        .vp-field input:not([type]) { font: inherit; font-family: var(--mono); padding: 7px 10px; border: 1.5px solid var(--ink-3); border-radius: 6px; background: var(--surface-1); color: var(--ink-1); min-width: 0; width: 100%; max-width: 260px; }
        .vp-field input[aria-invalid="true"] { border-color: var(--critical); border-width: 2px; }
        .vp-field input:focus-visible { outline: 2px solid var(--ink-1); outline-offset: 1px; }
        .vp-err { min-height: 1.2em; margin: 0; font-size: 0.78rem; color: var(--critical); font-weight: 600; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
        .vp-src { font-size: 0.66rem; font-weight: 700; padding: 0 6px; border-radius: 999px; border: 1px solid currentColor; }
        .vp-row { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; }
        .vp-row .spacer { flex: 1; }
        .vp-alert { margin: 0; padding: 8px 12px; border: var(--bw) solid var(--line); border-radius: 8px; background: var(--st-yellow); color: var(--on-sticker); font-size: 0.84rem; font-weight: 600; box-shadow: 3px 3px 0 var(--shade); animation: vp-pop 0.25s ease-out both; }
        .vp-alert.bad { background: var(--st-red); }
        .vp-note { margin: 0; font-size: 0.78rem; color: var(--critical); }
        .vp-matrix th.cur, .vp-matrix td.cur { background: color-mix(in srgb, var(--lab-accent) 12%, var(--surface-1)); }
        table.vp-matrix { min-width: 420px !important; }
        table.vp-matrix th[scope="row"] { padding: 3px 6px; background: var(--surface-1); min-width: 7.5em !important; }
        table.vp-matrix td { text-align: center; }
        @media (max-width: 640px) {
          table.vp-matrix { min-width: 0 !important; }
          table.vp-matrix th, table.vp-matrix td { padding-left: 3px !important; padding-right: 3px !important; }
          table.vp-matrix th[scope="row"] { min-width: 5.4em !important; }
          .vp-case { padding: 3px 5px; font-size: 0.74rem; }
          .vp-chip { padding: 1px 5px; font-size: 0.68rem; }
        }
        .vp-case { font: inherit; font-family: var(--sans); font-size: 0.78rem; text-align: left; color: var(--ink-1); background: none; border: 1px dashed var(--hairline); border-radius: 6px; padding: 3px 8px; cursor: pointer; }
        .vp-case[aria-pressed="true"] { border: 1.5px solid var(--line); background: var(--surface-2); font-weight: 700; }
        .vp-case:focus-visible { outline: 2px solid var(--ink-1); outline-offset: 1px; }
        .vp-chip { display: inline-block; font-family: var(--sans); font-size: 0.72rem; font-weight: 700; padding: 1px 8px; border: 1.5px solid var(--line); border-radius: 999px; color: var(--on-sticker); white-space: nowrap; }
        .vp-chip.ok { background: var(--st-mint); }
        .vp-chip.wait { background: var(--st-yellow); }
        .vp-chip.bad { background: var(--st-red); }
        @keyframes vp-pop { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .vp-alert { animation: none; } }
      `}</style>
    </Lab>
  )
}

function Field({ id, label, err, server, children }) {
  return (
    <div className="vp-field">
      {id !== 'note' && <label htmlFor={`vp-${id}`}>{label}</label>}
      {children}
      <p className="vp-err" id={`vp-${id}-err`} aria-live="polite">{err || ''}{err && <span className="vp-src">{server ? '伺服器回的' : '前端'}</span>}</p>
    </div>
  )
}

import React, { useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Code, Callout, Caption } from './ui.jsx'

/* ============================================================
   響應式：門診掛號表單元件 BookingForm 的狀態（ref、reactive、computed、watch）與畫面
   - 改一個值 → 依 Vue 3.5 的規則推算：哪些 watch 觸發（渲染前）、哪些 computed 重算（值有沒有變）、
     BookingForm 與哪些子元件重新渲染（props 沒變的跳過）
   - 兩個錯誤示範：解構 reactive 之後失去響應式、子元件直接改 props
   - 用 React 模擬，不是真的 Vue
   ============================================================ */

const SCHEDULE = [
  { id: 1, dept: '內科', date: '11/20', time: '09:00', left: 3 },
  { id: 2, dept: '內科', date: '11/20', time: '09:30', left: 1 },
  { id: 3, dept: '內科', date: '11/20', time: '10:00', left: 0 },
  { id: 4, dept: '內科', date: '11/21', time: '09:00', left: 5 },
  { id: 5, dept: '骨科', date: '11/20', time: '14:00', left: 2 },
  { id: 6, dept: '骨科', date: '11/21', time: '14:30', left: 4 },
  { id: 7, dept: '眼科', date: '11/20', time: '10:30', left: 1 },
  { id: 8, dept: '眼科', date: '11/21', time: '11:00', left: 3 },
]
const DEPTS = ['內科', '骨科', '眼科']
const DATES = ['11/20', '11/21']
const PHONE = /^09\d{8}$/
const PHONE_MSG = '手機要 09 開頭、共 10 碼'
const INIT = { dept: '內科', date: '11/20', schedule: SCHEDULE, selected: null, name: '', phone: '' }
const MODES = [{ value: 'ok', label: '正確寫法' }, { value: 'destructure', label: '錯誤：解構 reactive' }, { value: 'props', label: '錯誤：直接改 props' }]
const KEYMAP = { dept: 'dept', date: 'date', schedule: 'schedule', selected: 'selected', name: 'form.name', phone: 'form.phone' }
const PARENT_READS = ['dept', 'date', 'selected', 'form.name', 'form.phone']   // BookingForm 的模板直接讀的狀態
const COMP_IDS = ['available', 'phoneError', 'canSubmit']
const OK_DEPS = { available: ['dept', 'date', 'schedule'], phoneError: ['form.phone'], canSubmit: ['form.name', 'form.phone', 'selected'], draft: ['form.name', 'form.phone'] }
const DEPS = { ok: OK_DEPS, props: OK_DEPS, destructure: { ...OK_DEPS, phoneError: [], canSubmit: ['selected'], draft: [] } }
const CHILDREN = [
  { id: 'ClinicPicker', props: (s) => ({ dept: s.dept, date: s.date }) },
  { id: 'SlotList', props: (s, c) => ({ slots: c.available, selected: s.selected }) },
  { id: 'PatientFields', props: (s, c) => ({ name: s.name, phone: s.phone, error: c.phoneError }) },
  { id: 'SubmitBar', props: (s, c) => ({ disabled: !c.canSubmit }) },
]
const WARN = '[Vue warn] Set operation on key "selected" failed: target is readonly.'

const fmtVal = (v) => (v === null ? 'null' : typeof v === 'string' ? `'${v}'` : Array.isArray(v) ? `${v.length} 筆` : String(v))
const timeOf = (id) => SCHEDULE.find((x) => x.id === id)?.time

/* computed 的計算本身；解構模式下 name、phone 是 setup 當下拿到的空字串 */
function computeAll(s, mode) {
  const name = mode === 'destructure' ? '' : s.name
  const phone = mode === 'destructure' ? '' : s.phone
  return {
    available: s.schedule.filter((x) => x.dept === s.dept && x.date === s.date && x.left > 0),
    phoneError: phone && !PHONE.test(phone) ? PHONE_MSG : '',
    canSubmit: name.trim() !== '' && PHONE.test(phone) && s.selected !== null,
  }
}

function initSim(mode) {
  return {
    s: INIT, c: computeAll(INIT, mode), draft: { name: '', phone: '' }, tick: 0, last: null, logs: [], sent: false,
    counts: { available: 1, phoneError: 1, canSubmit: 1, w1: 0, draft: 1, BookingForm: 1, ClinicPicker: 1, SlotList: 1, PatientFields: 1, SubmitBar: 1 },
  }
}

/* 改一個值之後的一輪更新：改值 → pre watcher（渲染前）→ 渲染時重算 computed → props 有變的子元件重新渲染 */
function step(sim, patch, mode, action, meta = {}) {
  const prev = sim.s
  let s = { ...prev, ...patch }
  const events = meta.warn ? [{ k: 'warn', text: meta.warn }] : []
  const changed = new Set()
  for (const f of Object.keys(patch)) {
    if (Object.is(prev[f], s[f])) continue
    changed.add(KEYMAP[f])
    events.push({ k: 'state', key: meta.label || KEYMAP[f], from: meta.from ?? fmtVal(prev[f]), to: meta.to ?? fmtVal(s[f]), via: meta.via })
  }
  const counts = { ...sim.counts }
  const hits = { state: new Set(changed), comp: {}, watch: new Set(), render: new Set() }
  const logs = meta.warn ? [meta.warn, ...sim.logs].slice(0, 3) : sim.logs
  if (!changed.size) return { ...sim, logs, sent: false, tick: sim.tick + 1, last: { action, events: [...events, { k: 'none' }], hits } }

  if (changed.has('dept') || changed.has('date')) {
    counts.w1++; hits.watch.add('w1')
    if (s.selected !== null) {
      events.push({ k: 'watch', id: 'w1', text: `watch([dept, date]) 觸發：selected ${fmtVal(s.selected)} → null` })
      s = { ...s, selected: null }; changed.add('selected'); hits.state.add('selected')
    } else events.push({ k: 'watch', id: 'w1', text: 'watch([dept, date]) 觸發：selected 本來就是 null，指定同一個值不通知任何人' })
  }
  let draft = sim.draft
  if (DEPS[mode].draft.some((d) => changed.has(d))) {
    counts.draft++; hits.watch.add('draft'); draft = { name: s.name, phone: s.phone }
    events.push({ k: 'watch', id: 'draft', text: 'watchEffect 重新執行：saveDraft 存草稿' })
  }
  if (mode === 'destructure' && (changed.has('form.name') || changed.has('form.phone'))) {
    events.push({ k: 'note', text: '`phoneError`、`canSubmit`、`watchEffect` 都沒有讀過 `form`：它們讀的是解構出來的區域變數，這一輪不會被通知' })
  }
  const fresh = computeAll(s, mode)
  const c = { ...sim.c }
  let compChanged = false
  for (const id of COMP_IDS) {
    if (!DEPS[mode][id].some((d) => changed.has(d))) continue
    const same = Object.is(fresh[id], sim.c[id])
    counts[id]++; hits.comp[id] = same ? 'same' : 'changed'; c[id] = fresh[id]
    compChanged ||= !same
    events.push({ k: 'computed', id, from: fmtVal(sim.c[id]), to: fmtVal(fresh[id]), same, arr: Array.isArray(fresh[id]) })
  }
  if (PARENT_READS.some((k) => changed.has(k)) || compChanged) {
    hits.render.add('BookingForm'); counts.BookingForm++
    for (const ch of CHILDREN) {
      const a = ch.props(prev, sim.c), b = ch.props(s, c)
      if (Object.keys(b).some((k) => !Object.is(a[k], b[k]))) { hits.render.add(ch.id); counts[ch.id]++ }
    }
  }
  events.push({ k: 'render', list: [...hits.render], skip: CHILDREN.map((x) => x.id).filter((id) => !hits.render.has(id)) })
  return { s, c, draft, counts, logs, sent: false, tick: sim.tick + 1, last: { action, events, hits } }
}

export default function ReactivityLab() {
  const [mode, setMode] = useState('ok')
  const [sim, setSim] = useState(() => initSim('ok'))
  const { s, c, counts, last } = sim
  const act = (action, patch, meta) => setSim((cur) => step(cur, patch, mode, action, meta))
  const switchMode = (m) => { setMode(m); setSim(initSim(m)) }

  const pick = (slot) => {
    if (mode !== 'props') return act('select', { selected: slot.id }, { via: 'SlotList 的 defineModel 發出 update:selected' })
    // 錯誤示範：props.selected = … 被擋下；slot.left-- 改到父元件的 schedule
    const schedule = s.schedule.map((x) => (x.id === slot.id ? { ...x, left: x.left - 1 } : x))
    act('props', { schedule }, { warn: WARN, label: `schedule 裡 ${slot.time} 的 left`, from: String(slot.left), to: String(slot.left - 1), via: 'SlotList 的 slot.left--' })
  }
  const hitR = (id) => last?.hits.render.has(id)
  const tag = (id) => (
    <span className="rxl-tag"><code>&lt;{id}&gt;</code> 渲染 ×{counts[id]}{hitR(id) && <b key={sim.tick}>重新渲染</b>}</span>
  )
  const flash = (id) => hitR(id) && <i key={sim.tick} className="rxl-flash" aria-hidden="true" />
  const phoneErr = c.phoneError

  const ex = explain(last, mode)
  const codeTags = new Set([...(last ? [...last.hits.state].map((k) => (k.startsWith('form.') ? 'form' : k)) : []), ...Object.keys(last?.hits.comp || {}), ...(last?.hits.watch || [])])
  if (mode === 'destructure' && ['name', 'phone', 'select'].includes(last?.action)) codeTags.add('destructure')
  const parentCode = PARENT_CODE(mode)
  const tplCode = TEMPLATE_CODE(mode)

  return (
    <Lab className="rxl" accent="green" kicker="VUE LAB" title="改一個值，誰跟著動"
         blurb="門診掛號表單元件的 ref、reactive、computed、watch 與畫面：改一個值，看哪些 computed 重算、哪些 watch 觸發、哪個元件重新渲染。">
      <LabControls>
        <Seg label="寫法" tinted value={mode} onChange={switchMode} options={MODES} />
        <span className="spacer" />
        <button type="button" className="btn ghost small" onClick={() => setSim(initSim(mode))}>重設</button>
      </LabControls>

      <LabGrid variant="even">
        <LabStage label="BookingForm 的狀態">
          <div className="rxl-rows">
            <p className="rxl-h">狀態</p>
            {STATE_ROWS.map((r) => (
              <div key={r.id} className={`rxl-row${last?.hits.state.has(r.id) ? ' chg' : ''}`}>
                <span className={`rxl-kind ${r.kind}`}>{r.kind}</span><code className="rxl-name">{r.id}</code>
                <span className="rxl-val">{r.val(s)}</span>
              </div>
            ))}
            {mode === 'destructure' && (
              <div className="rxl-row bad"><span className="rxl-kind let">const</span><code className="rxl-name">{'{ name, phone }'}</code><span className="rxl-val">'' 、''（解構當下的值，不會再變）</span></div>
            )}
            <p className="rxl-h">computed</p>
            {COMP_IDS.map((id) => {
              const h = last?.hits.comp[id]
              const deps = DEPS[mode][id]
              return (
                <div key={id} className={`rxl-row${h === 'changed' ? ' run' : h === 'same' ? ' same' : ''}`}>
                  <span className="rxl-kind computed">computed</span><code className="rxl-name">{id}</code>
                  <span className="rxl-val">{fmtVal(c[id])}</span><span className="rxl-count">算了 ×{counts[id]}</span>
                  <span className="rxl-deps">{deps.length ? `依賴 ${deps.join('、')}` : '沒有依賴：讀的是區域變數'}{h && <b>{h === 'same' ? ' · 重算，值沒變' : ' · 重算，值變了'}</b>}</span>
                </div>
              )
            })}
            <p className="rxl-h">watch</p>
            <div className={`rxl-row${last?.hits.watch.has('w1') ? ' fire' : ''}`}>
              <span className="rxl-kind watch">watch</span><code className="rxl-name">[dept, date]</code>
              <span className="rxl-val">→ selected = null</span><span className="rxl-count">觸發 ×{counts.w1}</span>
            </div>
            <div className={`rxl-row${last?.hits.watch.has('draft') ? ' fire' : ''}`}>
              <span className="rxl-kind watch">watchEffect</span><code className="rxl-name">saveDraft</code>
              <span className="rxl-val">草稿：{fmtVal(sim.draft.name)}、{fmtVal(sim.draft.phone)}</span><span className="rxl-count">執行 ×{counts.draft}</span>
              <span className="rxl-deps">{DEPS[mode].draft.length ? `依賴 ${DEPS[mode].draft.join('、')}` : '沒有依賴：只在建立時執行一次'}</span>
            </div>
          </div>
        </LabStage>

        <LabStage label="畫面">
          <div className={`rxl-form${hitR('BookingForm') ? ' hit' : ''}`}>
            {flash('BookingForm')}{tag('BookingForm')}
            <div className={`rxl-comp${hitR('ClinicPicker') ? ' hit' : ''}`}>
              {flash('ClinicPicker')}{tag('ClinicPicker')}
              <div className="rxl-chips" role="group" aria-label="科別">
                {DEPTS.map((d) => <button key={d} type="button" aria-pressed={s.dept === d} onClick={() => act('dept', { dept: d }, { via: 'ClinicPicker 發出 update:dept' })}>{d}</button>)}
              </div>
              <div className="rxl-chips" role="group" aria-label="日期">
                {DATES.map((d) => <button key={d} type="button" aria-pressed={s.date === d} onClick={() => act('date', { date: d }, { via: 'ClinicPicker 發出 update:date' })}>{d}</button>)}
              </div>
            </div>
            <div className={`rxl-comp${hitR('SlotList') ? ' hit' : ''}`}>
              {flash('SlotList')}{tag('SlotList')}
              {c.available.length ? (
                <div className="rxl-chips" role="group" aria-label="時段">
                  {c.available.map((x) => (
                    <button key={x.id} type="button" aria-pressed={s.selected === x.id} onClick={() => pick(x)}>{x.time}<small>剩 {x.left}</small></button>
                  ))}
                </div>
              ) : <p className="rxl-empty">這天沒有可掛的時段</p>}
            </div>
            <div className={`rxl-comp${hitR('PatientFields') ? ' hit' : ''}`}>
              {flash('PatientFields')}{tag('PatientFields')}
              <div className="rxl-fields">
                <label>姓名<input value={s.name} autoComplete="off" onChange={(e) => act('name', { name: e.target.value }, { via: 'PatientFields 發出 update:name' })} /></label>
                <label>手機<input value={s.phone} inputMode="numeric" maxLength={10} autoComplete="off"
                                aria-invalid={phoneErr ? 'true' : undefined} aria-describedby={phoneErr ? 'rxl-phone-err' : undefined}
                                onChange={(e) => act('phone', { phone: e.target.value }, { via: 'PatientFields 發出 update:phone' })} /></label>
              </div>
              {phoneErr && <p id="rxl-phone-err" className="rxl-err">{phoneErr}</p>}
            </div>
            <div className={`rxl-comp${hitR('SubmitBar') ? ' hit' : ''}`}>
              {flash('SubmitBar')}{tag('SubmitBar')}
              <button type="button" className="btn small" disabled={!c.canSubmit} onClick={() => setSim((cur) => ({ ...cur, sent: true }))}>送出掛號</button>
              {sim.sent && <span className="rxl-sent">已送出（模擬，沒有真的送）</span>}
            </div>
          </div>
          {sim.logs.length > 0 && <div className="rxl-console" role="log" aria-label="Console">{sim.logs.map((l, i) => <code key={i}>{l}</code>)}</div>}
        </LabStage>
      </LabGrid>

      <LabGrid>
        <div className="lab-stack">
          <Code lang="js" title={mode === 'destructure' ? 'BookingForm.vue（錯誤）' : 'BookingForm.vue'} highlight={hl(parentCode, codeTags)}>{parentCode.map((l) => l[0]).join('\n')}</Code>
          {mode === 'props' && <Code lang="js" title="SlotList.vue（錯誤）" highlight={last?.action === 'props' ? hl(CHILD_CODE, new Set(['p'])) : []}>{CHILD_CODE.map((l) => l[0]).join('\n')}</Code>}
          <Code lang="vue" title="BookingForm.vue（模板節錄）" highlight={hl(tplCode, last?.hits.render || new Set())}>{tplCode.map((l) => l[0]).join('\n')}</Code>
        </div>
        <div className="lab-stack">
          <div className="rxl-log">
            <h5>這一次更新</h5>
            {last ? <ol>{last.events.map((e, i) => <li key={i} className={`k-${e.k}`} dangerouslySetInnerHTML={{ __html: md(evText(e)) }} />)}</ol>
              : <p className="rxl-empty">在畫面上點科別、日期、時段，或在欄位裡打字。</p>}
          </div>
          <LabExplain title={ex.title}>
            {ex.text.map((t) => <p key={t} dangerouslySetInnerHTML={{ __html: md(t) }} />)}
          </LabExplain>
          <Callout title="工作上什麼時候用">AI 產出的表單出現「改了值畫面沒變」「按鈕一直是灰的」「名額自己變少」時，用 Vue DevTools 看元件的 state 與 props，對照這張圖找出哪個 computed 沒有依賴、哪個子元件改了 props。描述需求時寫明哪些值是 ref、哪些由 computed 推導、哪些副作用才放進 watch。</Callout>
        </div>
      </LabGrid>
      <Caption>用 React 模擬 Vue 3.5 的依賴追蹤與更新順序，不是真的 Vue。紀錄依 Vue 的規則推算：watch 預設在元件渲染前執行，computed 在被讀到時才重算，值沒變就不通知下游，子元件的 props 沒變就不重新渲染。</Caption>

      <style>{`
        .rxl-rows { display: grid; gap: 4px; font-size: 0.8rem; }
        .rxl-h { margin: 8px 0 2px; font-size: 0.7rem; letter-spacing: 0.08em; color: var(--ink-3); font-weight: 700; }
        .rxl-h:first-child { margin-top: 0; }
        .rxl-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; padding: 4px 8px; border: 1px solid var(--hairline); border-radius: 6px; background: var(--surface-1); transition: background 0.3s ease, border-color 0.3s ease; }
        .rxl-row.chg { border-color: var(--c-yellow); background: color-mix(in srgb, var(--c-yellow) 16%, var(--surface-1)); }
        .rxl-row.run { border-color: var(--lab-accent); background: color-mix(in srgb, var(--lab-accent) 14%, var(--surface-1)); }
        .rxl-row.same { border-color: var(--lab-accent); border-style: dashed; }
        .rxl-row.fire { border-color: var(--c-orange); background: color-mix(in srgb, var(--c-orange) 14%, var(--surface-1)); }
        .rxl-row.bad { border-color: var(--critical); }
        .rxl-kind { font-family: var(--mono); font-size: 0.66rem; padding: 0 6px; border-radius: 3px; border: 1px solid currentColor; }
        .rxl-kind.ref { color: var(--c-blue); } .rxl-kind.reactive { color: var(--c-violet); } .rxl-kind.computed { color: var(--lab-accent); }
        .rxl-kind.watch { color: var(--c-orange); } .rxl-kind.let { color: var(--critical); }
        .rxl-name { font-family: var(--mono); color: var(--ink-1); font-weight: 600; }
        .rxl-val { font-family: var(--mono); color: var(--ink-2); overflow-wrap: anywhere; }
        .rxl-count { margin-left: auto; color: var(--ink-3); font-size: 0.72rem; white-space: nowrap; }
        .rxl-deps { flex-basis: 100%; color: var(--ink-3); font-size: 0.72rem; }
        .rxl-deps b { color: var(--ink-1); }
        .rxl-form, .rxl-comp { position: relative; border: 1px dashed var(--hairline); border-radius: 8px; padding: 22px 10px 10px; transition: border-color 0.3s ease; }
        .rxl-form { display: grid; gap: 10px; background: var(--surface-1); }
        .rxl-comp { background: var(--page); }
        .rxl-form.hit, .rxl-comp.hit { border-style: solid; border-color: var(--lab-accent); }
        .rxl-tag { position: absolute; top: 3px; left: 8px; font-size: 0.68rem; color: var(--ink-3); display: flex; gap: 6px; align-items: center; }
        .rxl-tag code { font-family: var(--mono); color: var(--ink-2); }
        .rxl-tag b { color: var(--lab-accent); animation: rxl-in 0.4s ease-out both; }
        .rxl-flash { position: absolute; inset: 0; border-radius: 8px; pointer-events: none; background: color-mix(in srgb, var(--lab-accent) 18%, transparent); animation: rxl-fade 1.1s ease-out forwards; }
        .rxl-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
        .rxl-chips button { font: inherit; font-size: 0.8rem; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--hairline); background: var(--surface-1); color: var(--ink-1); cursor: pointer; display: inline-flex; gap: 6px; align-items: baseline; }
        .rxl-chips button[aria-pressed="true"] { border-color: var(--lab-accent); background: color-mix(in srgb, var(--lab-accent) 18%, var(--surface-1)); font-weight: 700; }
        .rxl-chips small { color: var(--ink-3); font-size: 0.7rem; }
        .rxl-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; }
        .rxl-fields label { display: grid; gap: 2px; font-size: 0.74rem; color: var(--ink-2); }
        .rxl-fields input { font: inherit; font-size: 0.86rem; padding: 4px 8px; min-width: 0; border: 1px solid var(--hairline); border-radius: 4px; background: var(--surface-1); color: var(--ink-1); }
        .rxl-fields input[aria-invalid="true"] { border-color: var(--critical); }
        .rxl-err { margin: 6px 0 0; color: var(--critical); font-size: 0.76rem; }
        .rxl-empty { margin: 4px 0 0; color: var(--ink-3); font-size: 0.8rem; }
        .rxl-sent { margin-left: 8px; font-size: 0.74rem; color: var(--good); }
        .rxl-console { margin-top: 10px; display: grid; gap: 4px; padding: 8px 10px; border-left: 3px solid var(--warning); background: color-mix(in srgb, var(--warning) 10%, var(--surface-1)); border-radius: 0 6px 6px 0; }
        .rxl-console code { font-family: var(--mono); font-size: 0.72rem; color: var(--ink-1); overflow-wrap: anywhere; }
        .rxl-log h5 { margin: 0 0 6px; font-size: 0.74rem; letter-spacing: 0.08em; color: var(--ink-2); }
        .rxl-log ol { margin: 0; padding-left: 1.2rem; display: grid; gap: 4px; font-size: 0.82rem; color: var(--ink-2); line-height: 1.55; }
        .rxl-log li { animation: rxl-in 0.3s ease-out both; }
        .rxl-log li.k-warn, .rxl-log li.k-none { color: var(--ink-1); }
        .rxl-log li::marker { color: var(--ink-3); }
        @keyframes rxl-fade { from { opacity: 1; } to { opacity: 0; } }
        @keyframes rxl-in { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .rxl-flash { display: none; } .rxl-tag b, .rxl-log li { animation: none; } .rxl-row, .rxl-form, .rxl-comp { transition: none; } }
      `}</style>
    </Lab>
  )
}

const STATE_ROWS = [
  { kind: 'ref', id: 'dept', val: (s) => fmtVal(s.dept) },
  { kind: 'ref', id: 'date', val: (s) => fmtVal(s.date) },
  { kind: 'ref', id: 'schedule', val: (s) => `${s.schedule.length} 個時段，名額共 ${s.schedule.reduce((n, x) => n + x.left, 0)}` },
  { kind: 'ref', id: 'selected', val: (s) => (s.selected === null ? 'null' : `${s.selected}（${timeOf(s.selected)}）`) },
  { kind: 'reactive', id: 'form.name', val: (s) => fmtVal(s.name) },
  { kind: 'reactive', id: 'form.phone', val: (s) => fmtVal(s.phone) },
]

/* 程式碼：每行 [文字, 標籤]，標籤對到這一次更新碰到的東西就高亮 */
function PARENT_CODE(mode) {
  const f = mode === 'destructure' ? '' : 'form.'
  return [
    ['// <script setup>'],
    ["const dept = ref('內科')", 'dept'],
    ["const date = ref('11/20')", 'date'],
    ['const schedule = ref(SCHEDULE)   // API 回來的時段', 'schedule'],
    ['const selected = ref(null)', 'selected'],
    ["const form = reactive({ name: '', phone: '' })", 'form'],
    ...(mode === 'destructure' ? [["const { name, phone } = form   // ✗ 拿到當下的 ''、''", 'destructure']] : []),
    [''],
    ['const available = computed(() => schedule.value.filter((s) =>', 'available'],
    ['  s.dept === dept.value && s.date === date.value && s.left > 0))', 'available'],
    [`const phoneError = computed(() => ${f}phone && !PHONE.test(${f}phone)`, 'phoneError'],
    [`  ? '${PHONE_MSG}' : '')`, 'phoneError'],
    [`const canSubmit = computed(() => ${f}name.trim() !== ''`, 'canSubmit'],
    [`  && PHONE.test(${f}phone) && selected.value !== null)`, 'canSubmit'],
    [''],
    ['watch([dept, date], () => { selected.value = null })', 'w1'],
    [`watchEffect(() => saveDraft(${f}name, ${f}phone))`, 'draft'],
  ]
}
const CHILD_CODE = [
  ["const props = defineProps(['slots', 'selected'])"],
  ['function pick(slot) {'],
  ['  props.selected = slot.id   // ✗ 唯讀：警告並擋下', 'p'],
  ['  slot.left--                // ✗ 改到父元件的 schedule', 'p'],
  ['}'],
  ["// 改成：const selected = defineModel('selected')"],
  ['//       function pick(slot) { selected.value = slot.id }'],
]
function TEMPLATE_CODE(mode) {
  return [
    ['<ClinicPicker v-model:dept="dept" v-model:date="date" />', 'ClinicPicker'],
    [mode === 'props' ? '<SlotList :slots="available" :selected="selected" />' : '<SlotList :slots="available" v-model:selected="selected" />', 'SlotList'],
    ['<PatientFields v-model:name="form.name" v-model:phone="form.phone"', 'PatientFields'],
    ['  :error="phoneError" />', 'PatientFields'],
    ['<SubmitBar :disabled="!canSubmit" />', 'SubmitBar'],
  ]
}
const hl = (lines, tags) => lines.map((l, i) => (l[1] && tags.has(l[1]) ? i + 1 : 0)).filter(Boolean)

function evText(e) {
  if (e.k === 'warn') return `Console：\`${e.text}\``
  if (e.k === 'none') return '值沒變：Vue 用 `Object.is` 比較新舊值，一樣就不通知任何 computed、watch 或元件。'
  if (e.k === 'state') return `改值 \`${e.key}\`：${e.from} → ${e.to}${e.via ? `（${e.via}）` : ''}`
  if (e.k === 'watch' || e.k === 'note') return e.text
  if (e.k === 'computed') return `computed \`${e.id}\` 重算：${e.from} → ${e.to}${e.same ? '，值沒變，不通知下游' : e.arr ? '（`filter` 回傳新陣列，算是變了）' : ''}`
  return e.list.length ? `重新渲染：${e.list.join('、')}${e.skip.length ? `；props 沒變而跳過：${e.skip.join('、')}` : ''}` : '沒有元件需要重新渲染'
}
function md(t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/`([^`]+)`/g, '<code>$1</code>') }

/* 說明：跟著最後一次的動作與寫法 */
function explain(last, mode) {
  if (!last) return { title: '初次掛載', text: ['setup 執行一次：建立 ref 與 reactive，三個 computed 在第一次渲染時各算一次，`watchEffect` 立刻執行一次；`watch` 要等來源改變才執行。', mode === 'destructure' ? '這個寫法在 setup 裡解構了 `form`，打字之後看看 `phoneError` 與 `canSubmit`。' : mode === 'props' ? '這個寫法的 `SlotList` 直接改 props，點一個時段試試。' : '在畫面上改任何一個值，下面列出這一輪誰被通知、誰沒有。'] }
  const ev = last.events
  if (ev.some((e) => e.k === 'none') && last.action !== 'props') return { title: '值沒變，什麼都不會發生', text: ['ref 與 reactive 在指定值時比較新舊值，一樣就不通知任何 effect：computed 不重算、watch 不觸發、元件不重新渲染。'] }
  const comp = (id) => ev.find((e) => e.k === 'computed' && e.id === id)
  const can = comp('canSubmit')
  const canText = can ? (can.same ? '`canSubmit` 重算後還是 `' + can.to + '`，值沒變，SubmitBar 的 `disabled` 不變，不重新渲染。' : '`canSubmit` 從 `' + can.from + '` 變成 `' + can.to + '`，SubmitBar 的 `disabled` 變了，跟著重新渲染。') : ''
  switch (last.action) {
    case 'dept': case 'date': {
      const cleared = ev.some((e) => e.k === 'watch' && e.id === 'w1' && e.text.includes('→ null'))
      return { title: `${last.action} 改了：watch 先跑，computed 在渲染時重算`, text: [
        `\`${last.action}\` 是 ref。\`watch([dept, date])\` 在元件重新渲染之前執行，${cleared ? '把已選的時段清成 `null`，`selected` 也因此改變。' : '但 `selected` 本來就是 `null`，指定同一個值不會再通知任何人。'}`,
        '`available` 依賴它，BookingForm 渲染時讀到而重算；`filter` 每次回傳新陣列，SlotList 的 `slots` prop 變了，跟著重新渲染。',
        '`phoneError` 沒有讀 `dept` 或 `date`，直接用快取；PatientFields 的 props 沒變，跳過。' + (cleared ? ' ' + canText : ''),
      ] }
    }
    case 'name': case 'phone':
      if (mode === 'destructure') return { title: `form.${last.action} 改了，computed 卻沒動`, text: [
        '`const { name, phone } = form` 在 setup 執行時讀了一次，拿到兩個空字串，和 `form` 從此沒有關係。',
        '`phoneError`、`canSubmit` 與 `watchEffect` 讀的是這兩個區域變數，沒有經過 Proxy，Vue 沒有記下它們對 `form` 的依賴：錯誤訊息不會出現，草稿也不會更新。',
        '輸入框還是會變，因為模板直接讀 `form.' + last.action + '`，BookingForm 與 PatientFields 照常重新渲染。送出按鈕一直是灰的，Console 沒有任何錯誤。',
      ] }
      return { title: `form.${last.action} 改了：只有讀過它的被通知`, text: [
        `\`form\` 是 reactive，Vue 記得誰讀過 \`form.${last.action}\`：${last.action === 'phone' ? '`phoneError`、' : ''}\`canSubmit\`、存草稿的 \`watchEffect\`，以及 BookingForm 的模板。`,
        (last.action === 'phone' && comp('phoneError') ? (comp('phoneError').same ? '`phoneError` 重算，結果和上次一樣。' : `\`phoneError\` 從 ${comp('phoneError').from} 變成 ${comp('phoneError').to}，PatientFields 的 \`error\` prop 跟著變。`) + ' ' : '') + canText,
        '`available` 沒有讀 `form`，這一輪連重算都沒有，ClinicPicker 與 SlotList 也跳過。',
      ] }
    case 'select':
      return { title: 'selected 改了：由子元件發事件、父元件改值', text: [
        'SlotList 用 `defineModel(\'selected\')`：寫入時發出 `update:selected`，BookingForm 改自己的 `selected`，再把新值當 prop 傳下去。',
        mode === 'destructure' ? '`canSubmit` 因為 `selected` 改了而重算，但讀到的 `name`、`phone` 仍是解構當下的空字串，結果還是 `false`。' : canText,
        'ClinicPicker 與 PatientFields 的 props 沒變，跳過；`available` 沒有讀 `selected`，用快取。',
      ] }
    case 'props':
      return { title: 'SlotList 直接改 props', text: [
        '`props.selected = slot.id`：props 是唯讀的 Proxy，開發模式警告並擋下，`selected` 沒變，時段選不起來。',
        '`slot.left--`：唯讀只擋第一層，`slot` 是父元件 `schedule` 裡的物件，這一行沒有警告就改到了父元件的資料。`available` 因此重算，畫面上的名額變少，伺服器上的名額沒變。',
        '改成 `defineModel(\'selected\')` 交給父元件決定；名額以 API 回應為準。',
      ] }
    default: return { title: '', text: [] }
  }
}

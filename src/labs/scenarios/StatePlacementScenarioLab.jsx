import React, { useEffect, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Callout, Stats, Stat, Caption } from '../ui.jsx'

/* 狀態放哪裡情境模擬器：門診系統「今日掛號」頁的元件樹。
   選一個狀態（科別、篩選條件、登入的醫師、表單草稿）與一個放法（元件 + props、provide、Pinia、網址），
   按事件（重新整理、貼網址給同事、上一頁、換頁、登出、關掉表單、守衛）看這個值的下場，對照需求。
   結果依各放法的生命週期規則推算，是示意，不是在瀏覽器裡跑 Vue。 */

/* 說明文字裡的 `程式碼` 轉成 <code> */
const ic = (s) => String(s).split(/`([^`]+)`/).map((p, i) => (i % 2 ? <code key={i}>{p}</code> : p))

const TREE = [
  { id: 'App', depth: 0 },
  { id: 'AppHeader', depth: 1 },
  { id: 'RouterView', depth: 1 },
  { id: 'AppointmentsPage', depth: 2 },
  { id: 'DeptTabs', depth: 3 },
  { id: 'FilterBar', depth: 3 },
  { id: 'AppointmentTable', depth: 3 },
  { id: 'AppointmentRow', depth: 4 },
  { id: 'DeptBadge', depth: 5 },
  { id: 'BookingDialog', depth: 3 },
  { id: 'BookingForm', depth: 4 },
]
const PAGE_SUB = ['AppointmentsPage', 'DeptTabs', 'FilterBar', 'AppointmentTable', 'AppointmentRow', 'DeptBadge', 'BookingDialog', 'BookingForm']
const DIALOG_SUB = ['BookingDialog', 'BookingForm']
const ALL = TREE.map((n) => n.id)

const STATES = {
  dept: {
    label: '科別', value: '小兒科', changed: '外科', reset: '內科（預設）',
    writer: 'DeptTabs', readers: ['AppointmentTable', 'DeptBadge', 'BookingForm'], outside: [],
    owner: 'AppointmentsPage', drill: ['AppointmentTable', 'AppointmentRow', 'BookingDialog'], query: 'dept=peds',
    need: { refresh: 'keep', share: 'keep', back: 'prev', nav: 'keep' },
  },
  filter: {
    label: '篩選條件', value: '11/20・已報到・「王」・第 3 頁', changed: '第 4 頁', reset: '今天・全部・第 1 頁',
    writer: 'FilterBar', readers: ['AppointmentTable'], outside: [],
    owner: 'AppointmentsPage', drill: [], query: 'date=2026-11-20&status=checked-in&q=王&page=3',
    need: { refresh: 'keep', share: 'keep', back: 'prev' },
  },
  user: {
    label: '登入的醫師', value: '陳醫師', reset: '（未登入）',
    writer: null, readers: ['AppHeader', 'BookingForm'], outside: ['路由守衛', 'API 攔截器（401）'],
    owner: 'App', drill: ['RouterView', 'AppointmentsPage', 'BookingDialog'], query: 'doctor=chen',
    need: { share: 'reset', nav: 'keep', logout: 'reset', guard: 'yes' },
    risk: '身分寫在網址：改成 ?doctor=lee，畫面就變成李醫師',
  },
  draft: {
    label: '掛號表單草稿', value: '林○○・10:30・「發燒三天」', reset: '空白表單',
    writer: 'BookingForm', readers: ['BookingForm'], outside: [],
    owner: 'BookingForm', provider: 'AppointmentsPage', drill: [], query: 'patient=林○○&slot=10:30&note=發燒三天',
    need: { share: 'reset', logout: 'reset', close: 'reset' },
    risk: '病患姓名與備註進了瀏覽紀錄，重新整理時也送進伺服器的存取紀錄',
  },
}

const EVENTS = [
  { id: 'refresh', label: '重新整理', nodes: ALL },
  { id: 'share', label: '網址貼給同事', nodes: ALL },
  { id: 'back', label: '改了之後按上一頁', nodes: PAGE_SUB },
  { id: 'nav', label: '切到叫號看板再點回來', nodes: PAGE_SUB },
  { id: 'logout', label: '登出，換李醫師登入', nodes: ['AppHeader', ...PAGE_SUB] },
  { id: 'close', label: '按取消關掉表單再打開', nodes: DIALOG_SUB },
  { id: 'guard', label: '路由守衛與攔截器讀得到嗎', nodes: [] },
]
const NEED_LABEL = { keep: '要保留', prev: '回到前一個值', reset: '要清掉', yes: '要讀得到' }

const PLACES = [
  { value: 'local', label: '元件 + props' },
  { value: 'provide', label: 'provide／inject' },
  { value: 'pinia', label: 'Pinia' },
  { value: 'url', label: '網址' },
]

/* 這個放法遇到這個事件，值會怎樣 */
function outcome(sid, pl, ev, resetOnLogout) {
  const s = STATES[sid]
  if (ev === 'guard') return pl === 'pinia' || pl === 'url' ? 'yes' : 'no'
  if (pl === 'url') return { refresh: 'keep', share: 'keep', back: 'prev', nav: 'reset', logout: 'reset', close: 'keep' }[ev]
  if (ev === 'refresh' || ev === 'share') return 'reset'
  if (ev === 'back') return 'leave'
  if (pl === 'pinia') return ev === 'logout' ? (sid === 'user' || resetOnLogout ? 'reset' : 'leak') : 'keep'
  const holder = pl === 'local' ? s.owner : (s.provider || s.owner)
  if (ev === 'nav') return holder === 'App' ? 'keep' : 'reset'
  if (ev === 'logout') return holder === 'App' && sid !== 'user' ? 'leak' : 'reset'
  return holder === 'BookingForm' ? 'reset' : 'keep'   // close
}
function passes(need, got) {
  return (need === 'keep' && got === 'keep') || (need === 'prev' && got === 'prev') || (need === 'reset' && got === 'reset') || (need === 'yes' && got === 'yes')
}
function describe(sid, pl, ev, got) {
  const s = STATES[sid]
  if (ev === 'guard') return got === 'yes' ? '守衛與攔截器都呼叫得到' : 'inject 只能在元件的 setup 裡用，元件外的程式拿不到'
  if (sid === 'user' && ev === 'share') return got === 'keep' ? '網址帶著 doctor=chen，同事的畫面顯示「陳醫師」' : '同事看到的是他自己的登入身分'
  if (sid === 'user' && ev === 'logout') return pl === 'url' ? '導向登入頁時網址換掉了' : 'logout() 把它設成 null'
  if (sid === 'user' && ev === 'nav' && got === 'reset') return '選單連結沒帶 doctor=，回來變成未登入'
  switch (`${ev}:${got}`) {
    case 'refresh:keep': return `重新整理後還是「${s.value}」`
    case 'refresh:reset': return `記憶體清空，變回「${s.reset}」`
    case 'share:keep': return `同事打開看到「${s.value}」`
    case 'share:reset': return `網址裡沒有，同事看到「${s.reset}」`
    case 'back:prev': return `改成「${s.changed}」再按上一頁，回到「${s.value}」`
    case 'back:leave': return '改了沒有進瀏覽紀錄，上一頁直接離開清單頁'
    case 'nav:keep': return `回來還是「${s.value}」`
    case 'nav:reset': return pl === 'url' ? `選單連結沒帶 query，回來變成「${s.reset}」` : `頁面卸載，回來變成「${s.reset}」`
    case 'logout:reset': return '跟著清掉'
    case 'logout:leak': return `李醫師登入後還看到「${s.value}」`
    case 'close:reset': return `再打開是「${s.reset}」`
    case 'close:keep': return `再打開還是「${s.value}」`
    default: return got
  }
}
/* 每個元件身上的標籤：持有、讀、改、轉傳 */
function roleOf(sid, pl, node) {
  const s = STATES[sid]
  const tags = []
  if (pl === 'local') {
    if (node === s.owner) tags.push({ k: 'own', t: '持有 ref' })
    if (s.drill.includes(node)) tags.push({ k: 'drill', t: '轉傳 props' })
    if (s.readers.includes(node) && node !== s.owner) tags.push({ k: 'read', t: '讀 props' })
    if (node === s.writer && node !== s.owner) tags.push({ k: 'read', t: 'emit 改值' })
  } else if (pl === 'provide') {
    const holder = s.provider || s.owner
    if (node === holder) tags.push({ k: 'own', t: 'provide' })
    if ((s.readers.includes(node) || node === s.writer) && node !== holder) tags.push({ k: 'read', t: 'inject' })
  } else {
    const how = pl === 'pinia' ? 'useStore()' : node === s.writer ? 'router.push' : 'useRoute()'
    if (s.readers.includes(node) || node === s.writer) tags.push({ k: 'read', t: how })
  }
  return tags
}

const EXPLAIN = {
  dept: { title: '科別：放網址', body: ['同事要看到同一科、上一頁要回到前一科、重新整理不能變回內科，三個需求都靠網址。第三層的色標直接 `useRoute()` 讀，不必經過表格與列轉傳。', '剩下「換頁再回來」：選單連結要帶上目前的 `dept`，或在換頁時把最後選的科別記在 `sessionStorage` 當預設值。'] },
  filter: { title: '篩選條件：放網址', body: ['條件改了要進瀏覽紀錄，上一頁才回得去；這件事只有網址做得到。放在元件或 Pinia，按上一頁會直接離開清單頁。', '關鍵字輸入框打字時用 `router.replace`，按下搜尋或換頁碼才 `push`，不然每打一個字就多一筆紀錄。'] },
  user: { title: '登入的醫師：放 Pinia', body: ['頁首、表單與元件外的守衛、攔截器都要讀，Pinia 是唯一四處都拿得到、又不放進網址的地方。重新整理後的值用 cookie 呼叫 `GET /api/me` 取回。', '身分不能放網址：網址可以手改、會被分享。provide 在 App 層也能跨頁，但守衛與攔截器拿不到。'] },
  draft: { title: '表單草稿：放表單元件裡', body: ['草稿只有表單自己用，取消就該消失：放在 BookingForm 的 `ref`，Dialog 用 `v-if` 關掉時元件卸載，草稿跟著清掉。', '放 Pinia 或頁面層 provide，取消後再打開還是舊資料；登出時沒清，下一位醫師就看到上一位的病患。要防誤按重新整理，另外寫進 `sessionStorage`，送出與取消時刪掉。'] },
}

export default function StatePlacementScenarioLab() {
  const [sid, setSid] = useState('dept')
  const [pl, setPl] = useState('local')
  const [resetOnLogout, setResetOnLogout] = useState(false)
  const [done, setDone] = useState({})          // 已經跑過的事件
  const [flash, setFlash] = useState(null)      // 正在重建的元件
  const timers = useRef([])
  const s = STATES[sid]
  const events = EVENTS.filter((e) => s.need[e.id])

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = [] }
  useEffect(() => { clearTimers(); setDone({}); setFlash(null) }, [sid, pl, resetOnLogout])
  useEffect(() => clearTimers, [])

  const run = (ev, delay = 0) => {
    timers.current.push(setTimeout(() => setFlash({ ev: ev.id, nodes: new Set(ev.nodes) }), delay))
    timers.current.push(setTimeout(() => { setFlash(null); setDone((d) => ({ ...d, [ev.id]: true })) }, delay + 650))
  }
  const runAll = () => { clearTimers(); setDone({}); events.forEach((ev, i) => run(ev, i * 800)) }

  const rows = events.map((e) => {
    const got = outcome(sid, pl, e.id, resetOnLogout)
    return { e, got, ok: passes(s.need[e.id], got), text: describe(sid, pl, e.id, got) }
  })
  const risk = pl === 'url' ? s.risk : null
  const score = rows.filter((r) => r.ok).length
  const drill = pl === 'local' ? s.drill.length : 0
  const allDone = rows.every((r) => done[r.e.id])
  const ex = EXPLAIN[sid]
  const outsideOk = outcome(sid, pl, 'guard') === 'yes'

  return (
    <Lab accent="green" kicker="SCENARIO LAB" title="同一個值，四種放法：重新整理、分享、上一頁、登出之後還在不在"
         blurb="今日掛號頁的元件樹；結果依各放法的生命週期推算（示意）。">
      <LabControls>
        <Seg label="狀態" value={sid} onChange={setSid} options={Object.entries(STATES).map(([value, x]) => ({ value, label: x.label }))} />
        <Seg label="放在" tinted value={pl} onChange={setPl} options={PLACES} />
        {pl === 'pinia' && sid !== 'user' && <Toggle label="logout() 裡重設這個 store" checked={resetOnLogout} onChange={setResetOnLogout} />}
      </LabControls>
      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabStage label="元件樹與網址列">
            <div className="sp-addr" aria-label="網址列">
              <span className="sp-lock" aria-hidden="true">⌂</span>
              <span>clinic.example/appointments</span>
              {pl === 'url' && <b className={risk ? 'bad' : ''}>?{s.query}</b>}
            </div>
            <div className="sp-top">
              <span className="sp-now">目前：<b>{s.value}</b></span>
              {pl === 'pinia' && <span className="sp-store">Pinia store：{s.label} = {s.value}</span>}
            </div>
            <ul className="sp-tree">
              {TREE.map((n) => {
                const tags = roleOf(sid, pl, n.id)
                const on = flash?.nodes.has(n.id)
                return (
                  <li key={n.id} style={{ '--d': n.depth }} className={`${tags.length ? 'used' : ''}${on ? ' flash' : ''}`}>
                    <span className="sp-name">{n.id}</span>
                    {tags.map((t) => <span key={t.t} className={`sp-tag ${t.k}`}>{t.t}</span>)}
                  </li>
                )
              })}
            </ul>
            {s.outside.length > 0 && (
              <div className={`sp-outside${flash?.ev === 'guard' ? ' flash' : ''}`}>
                <span className="muted">元件外：</span>
                {s.outside.map((o) => <span key={o} className={`sp-tag ${outsideOk ? 'read' : 'drill'}`}>{o} {outsideOk ? '✓' : '✕'}</span>)}
              </div>
            )}
          </LabStage>
          <LabControls>
            {events.map((e) => (
              <button key={e.id} type="button" className="btn ghost small" onClick={() => run(e)} disabled={!!flash}>{e.label}</button>
            ))}
            <span className="spacer" />
            <button type="button" className="btn small" onClick={runAll} disabled={!!flash}>全部跑一遍</button>
          </LabControls>
          <table className="dtable sp-res">
            <thead><tr><th>事件</th><th>需求</th><th>結果</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.e.id} className={done[r.e.id] ? 'row-in' : 'dim'}>
                  <td>{r.e.label}</td>
                  <td>{NEED_LABEL[s.need[r.e.id]]}</td>
                  <td>{done[r.e.id] ? <span className={r.ok ? 'sp-ok' : 'sp-bad'}>{r.ok ? '✓' : '✕'} {r.text}</span> : <span className="muted">（還沒跑）</span>}</td>
                </tr>
              ))}
              {risk && <tr><td>個資與身分</td><td>不能進網址</td><td><span className="sp-bad">✕ {risk}</span></td></tr>}
            </tbody>
          </table>
          <Stats min={130}>
            <Stat label="符合需求" value={allDone ? `${score} / ${rows.length}` : `${rows.filter((r) => done[r.e.id] && r.ok).length} / ${rows.length}`} tone={allDone ? (score === rows.length && !risk ? 'ok' : 'bad') : ''} note={allDone ? '' : '還有事件沒跑'} />
            <Stat label="中間轉傳 props 的元件" value={drill} unit="個" tone={drill > 0 ? 'warn' : ''} note={drill ? s.drill.join('、') : pl === 'local' ? '讀的元件就是直接子元件' : '不經過中間層'} />
            <Stat label="個資或身分進網址" value={risk ? '是' : '否'} tone={risk ? 'bad' : ''} />
          </Stats>
          <Caption>✓ 符合需求、✕ 不符合；只列這個狀態有要求的事件（示意）。</Caption>
        </div>
        <div className="lab-stack">
          <LabExplain title={ex.title}>{ex.body.map((p, i) => <p key={i}>{ic(p)}</p>)}</LabExplain>
          <LabExplain title="這個放法的生命週期">
            {pl === 'local' && <p>值跟著持有它的元件：元件卸載（換頁、Dialog 關掉、重新整理）就沒了。深層元件要用，中間每一層都要宣告 prop 再傳下去。</p>}
            {pl === 'provide' && <p>{ic('值跟著提供者，提供者底下的任何後代都能 `inject`；中間層不用知道。提供者以外的地方拿不到，元件外的程式也拿不到。')}</p>}
            {pl === 'pinia' && <p>{ic('store 在第一次 `useXxxStore()` 時建立，之後一直活到分頁關掉或重新整理。換頁不會清、登出也不會清，要自己在 `logout()` 裡重設。')}</p>}
            {pl === 'url' && <p>值就在網址裡：重新整理、書籤、分享、上一頁都帶著它。讀進來是字串要解析；網址會留在瀏覽紀錄，也會在重新整理時送到伺服器。</p>}
          </LabExplain>
          <Callout title="什麼時候會踩到">同一台電腦輪流登入的櫃台與診間最常見：Pinia 裡的病患清單或草稿沒在登出時清掉，下一位使用者打開就看到。分享網址打不開同一個畫面，則是篩選條件放在元件或 store 裡。</Callout>
        </div>
      </LabGrid>
      <style>{`
        .sp-addr { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; font-family: var(--mono); font-size: 0.76rem; padding: 6px 10px; border: 2px solid var(--line); border-radius: 999px; background: var(--surface-1); overflow-wrap: anywhere; }
        .sp-addr b { color: var(--c-green); font-weight: 700; }
        .sp-addr b.bad { color: var(--critical); }
        .sp-lock { color: var(--ink-3); }
        .sp-top { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; margin: 10px 0 8px; font-size: 0.8rem; color: var(--ink-2); }
        .sp-now b { color: var(--ink-1); }
        .sp-store { font-family: var(--mono); font-size: 0.74rem; padding: 3px 9px; border: 2px solid var(--line); border-radius: 8px; background: var(--st-violet); color: var(--on-sticker); box-shadow: 2px 2px 0 var(--shade); }
        .sp-tree { list-style: none; display: grid; gap: 4px; }
        .sp-tree li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin-left: calc(var(--d) * 14px); padding: 3px 8px; border: 1.5px solid var(--hairline); border-radius: 8px; background: var(--surface-1); min-width: 0; }
        .sp-tree li.used { border-color: var(--line); box-shadow: 2px 2px 0 var(--shade); }
        .sp-name { font-family: var(--mono); font-size: 0.76rem; color: var(--ink-1); overflow-wrap: anywhere; }
        .sp-tag { font-size: 0.68rem; font-weight: 700; padding: 0 7px; border-radius: 999px; border: 1.5px solid var(--line); color: var(--on-sticker); white-space: nowrap; }
        .sp-tag.own { background: var(--st-yellow); }
        .sp-tag.read { background: var(--st-mint); }
        .sp-tag.drill { background: var(--st-red); }
        .sp-outside { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 10px; font-size: 0.78rem; padding: 4px 0; }
        .sp-tree li.flash, .sp-outside.flash { animation: sp-flash 0.65s ease-in-out; }
        @keyframes sp-flash { 0%, 100% { opacity: 1; } 45% { opacity: 0.25; } }
        @media (prefers-reduced-motion: reduce) { .sp-tree li.flash, .sp-outside.flash { animation: none; outline: 2px dashed var(--line); } }
        .sp-res td:first-child { white-space: normal; }
        .sp-res td:last-child { white-space: normal; font-family: var(--sans); }
        .sp-ok { color: var(--good); font-weight: 600; }
        .sp-bad { color: var(--critical); font-weight: 600; }
      `}</style>
    </Lab>
  )
}

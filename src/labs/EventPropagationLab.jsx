import React, { useMemo } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Stepper, usePlayer, Code, Callout, Status } from './ui.jsx'

/* ============================================================
   事件的傳遞：一次點擊從 window 往下（捕獲）、到目標、再往上（冒泡），最後是瀏覽器的預設動作
   - 情境：「我的掛號」清單放在 <form> 裡，點一列打開 Drawer，列裡有沒寫 type 的「取消」按鈕
   - 控制：點哪裡、列的監聽掛在 li 或 ul（委派）、取消鈕呼叫 stopPropagation / preventDefault
   - Stepper 逐站播放；右側的程式碼標出正在執行的監聽，下方記錄 target 與 currentTarget
   - 這是用 React 模擬的傳遞過程，不是真的 DOM 事件
   ============================================================ */

const NODES = {
  window: { tag: 'window', depth: 0 },
  document: { tag: 'document', depth: 1 },
  form: { tag: '<form>', depth: 2 },
  ul: { tag: '<ul>', depth: 3 },
  li: { tag: '<li data-id="12">', depth: 4 },
  button: { tag: '<button>取消</button>', depth: 5 },
  span: { tag: '<span>09:30 王小明</span>', depth: 5 },
}
const TARGETS = {
  button: { label: '「取消」按鈕', path: ['window', 'document', 'form', 'ul', 'li', 'button'] },
  span: { label: '列裡的文字', path: ['window', 'document', 'form', 'ul', 'li', 'span'] },
  ul: { label: '清單的空白處', path: ['window', 'document', 'form', 'ul'] },
}
const MODES = [
  { value: 'li', label: '每個 li 各自監聽' },
  { value: 'ul', label: 'ul 委派' },
  { value: 'ul-check', label: 'ul 委派＋排除按鈕' },
]
const PHASE = { capture: '捕獲', target: '目標', bubble: '冒泡', default: '預設動作' }
const PHASE_NO = { capture: 1, target: 2, bubble: 3 }

/* 程式碼：依設定組出來，每一行帶一個 key，執行中的監聽用 key 找到要標亮的行 */
function codeLines(mode, stop, prevent) {
  const L = [
    ['', '// 分析工具：在捕獲階段記錄每一次點擊'],
    ['log', "document.addEventListener('click', logClick,"],
    ['log', '  { capture: true })'],
    ['', '// 點頁面任何地方就關掉下拉選單'],
    ['menus', "document.addEventListener('click', closeMenus)"],
    ['', ''],
  ]
  if (mode === 'li') L.push(['row', "li.addEventListener('click',"], ['row', '  () => openDetail(12))'])
  else {
    L.push(['row', "ul.addEventListener('click', (e) => {"])
    L.push(['row', "  const row = e.target.closest('li')"])
    L.push(['row', '  if (!row) return   // 點到空白處'])
    if (mode === 'ul-check') L.push(['row', "  if (e.target.closest('button')) return"])
    L.push(['row', '  openDetail(row.dataset.id)'])
    L.push(['row', '})'])
  }
  L.push(['', ''])
  L.push(['', '// <form> 裡、沒寫 type：預設是送出鈕'])
  L.push(['cancel', "cancelBtn.addEventListener('click', (e) => {"])
  if (stop) L.push(['cancel', '  e.stopPropagation()'])
  if (prevent) L.push(['cancel', '  e.preventDefault()'])
  L.push(['cancel', '  cancel(12)'])
  L.push(['cancel', '})'])
  return L
}

/* 依設定模擬一次點擊：回傳每一站（hop）與到那一站為止的結果 */
function simulate(target, mode, stop, prevent) {
  const path = TARGETS[target].path
  const tgt = path[path.length - 1]
  const inRow = ['li', 'button', 'span'].includes(tgt)
  const listeners = [
    { key: 'log', node: 'document', capture: true, label: 'logClick', fn: 'logClick' },
    { key: 'menus', node: 'document', capture: false, label: 'closeMenus', fn: 'closeMenus' },
    { key: 'row', node: mode === 'li' ? 'li' : 'ul', capture: false, label: mode === 'li' ? 'openDetail' : '委派', fn: mode === 'li' ? 'openDetail(12)' : 'ul 的委派監聽' },
    { key: 'cancel', node: 'button', capture: false, label: 'cancel', fn: 'cancel(12)' },
  ]
  const fx = { log: false, menus: false, detail: false, cancel: false, menusMissed: false, submit: null }
  const hops = []
  let stopped = false, prevented = false
  const visit = (node, phase) => {
    const mine = listeners.filter((l) => l.node === node && (phase === 'target' || l.capture === (phase === 'capture')))
    if (stopped) {
      if (mine.some((l) => l.key === 'menus')) fx.menusMissed = true
      hops.push({ node, phase, fired: mine.map((l) => ({ ...l, note: '收不到：傳遞已停止' })), skipped: true, fx: { ...fx } })
      return
    }
    const fired = []
    let stopAfter = false
    for (const l of mine) {
      let note = ''
      if (l.key === 'log') { fx.log = true; note = `記下 target = ${NODES[tgt].tag}` }
      if (l.key === 'menus') { fx.menus = true; note = '關掉下拉選單' }
      if (l.key === 'row' && mode === 'li') { fx.detail = true; note = '打開 Drawer' }
      if (l.key === 'row' && mode !== 'li') {
        if (!inRow) note = "closest('li') 是 null，不處理"
        else if (mode === 'ul-check' && tgt === 'button') note = '點的是按鈕，略過'
        else { fx.detail = true; note = '找到 li#12，打開 Drawer' }
      }
      if (l.key === 'cancel') {
        fx.cancel = true
        note = ['送出取消', stop && 'stopPropagation()', prevent && 'preventDefault()'].filter(Boolean).join('、')
        if (stop) stopAfter = true
        if (prevent) prevented = true
      }
      fired.push({ ...l, note })
    }
    if (stopAfter) stopped = true
    hops.push({ node, phase, fired, skipped: false, fx: { ...fx } })
  }
  for (const n of path.slice(0, -1)) visit(n, 'capture')
  visit(tgt, 'target')
  for (const n of [...path].reverse().slice(1)) visit(n, 'bubble')
  fx.submit = tgt === 'button' ? !prevented : null
  hops.push({ node: tgt, phase: 'default', fired: [], skipped: false, fx: { ...fx } })
  return { hops, tgt, path }
}

function explain(h, ctx) {
  const { tgt, mode, stop, prevent } = ctx
  const T = `\`${NODES[tgt].tag}\``
  const N = `\`${NODES[h.node].tag}\``
  if (h.phase === 'default') {
    if (tgt !== 'button') return ['所有監聽都跑完了。點 `span` 或 `ul` 沒有瀏覽器的預設動作，這次點擊到此結束。', mode === 'li' && tgt === 'ul' ? '監聽掛在每個 `li` 上，點到清單的空白處，沒有任何一列的監聽收到事件。' : '換成點「取消」按鈕，看預設動作那一站。']
    if (prevent) return ['所有監聽跑完後，輪到瀏覽器的預設動作：送出表單。按鈕呼叫過 `preventDefault()`，這個動作被取消，頁面不會重新載入。', '只想讓按鈕不送出表單時，把它寫成 `type="button"` 更直接：它就沒有送出這個預設動作。']
    return ['所有監聽跑完後，輪到瀏覽器的預設動作：`<form>` 裡沒寫 `type` 的 `button` 是送出鈕，表單被送出，頁面重新載入。', stop ? '`stopPropagation()` 只停止往上傳，擋不住預設動作；要再呼叫 `preventDefault()`，或把按鈕寫成 `type="button"`。' : '要取消它，呼叫 `preventDefault()`，或把按鈕寫成 `type="button"`。']
  }
  if (h.skipped) return [`事件已在 \`<button>\` 呼叫 \`stopPropagation()\`，不再傳到 ${N}。`, h.fired.some((l) => l.key === 'menus') ? '`document` 上「點任何地方就關掉下拉選單」的監聽也收不到這次點擊：這是 `stopPropagation()` 常見的副作用，選單會一直開著。' : h.fired.length ? `${N} 上的監聽不會執行。` : '這一站本來就沒有監聽。']
  const ran = h.fired.map((l) => (l.key === 'row' && mode !== 'li' ? l.fn : `\`${l.fn}\``)).join('、')
  if (h.phase === 'capture') {
    if (h.fired.length) return [`捕獲階段：${N} 上有 \`{ capture: true }\` 的監聽，比目標上的監聽更早執行。這時 \`event.target\` 已經是 ${T}，\`currentTarget\` 是 ${N}。`, '分析工具常在 `document` 的捕獲階段記錄點擊：之後目標上的程式就算呼叫了 `stopPropagation()`，這個監聽也已經先執行過了。']
    return [h.node === 'window' ? '捕獲階段從 `window` 開始，一層層往下傳到目標的父元素。`window` 上沒有捕獲階段的監聽，繼續往下。' : `捕獲階段：事件往下經過 ${N}，這裡沒有捕獲階段的監聽，繼續往下。`, `目標是 ${T}，路徑在事件發出時就決定好了（圖上省略 \`html\` 與 \`body\`）。`]
  }
  if (h.phase === 'target') {
    if (tgt === 'button') return [`到達目標 ${T}：執行 ${ran}。${stop ? '接著呼叫 `stopPropagation()`：這個元素上的監聽跑完後，事件不再往上傳。' : ''}${prevent ? '呼叫 `preventDefault()`：預設動作被標記為取消，事件照樣往上傳。' : ''}`, stop || prevent ? '兩個方法各管一件事，結果看最後一站。' : '按鈕沒有阻止任何事，事件會繼續往上冒泡，最後還有瀏覽器的預設動作。']
    if (tgt === 'ul') return [`點到清單的空白處，目標就是 ${T}。${h.fired.length ? `委派的監聽在目標階段執行：\`event.target\` 是 ul 本身，\`closest('li')\` 回傳 \`null\`，所以不處理。` : 'ul 上沒有監聽。'}`, '接下來照樣往上冒泡。']
    return [`到達目標 ${T}，它本身沒有監聽。整趟傳遞中 \`event.target\` 都是這個 span。`, '委派時 `target` 常常是列裡更內層的元素，所以要用 `closest()` 往上找到帶 `data-id` 的那一列。']
  }
  // bubble
  if (!h.fired.length) return [`冒泡階段：事件往上回到 ${N}，這裡沒有冒泡階段的監聽。`, h.node === 'window' ? '回到 `window`，傳遞結束；下一站是瀏覽器的預設動作。' : '繼續往上。']
  const row = h.fired.find((l) => l.key === 'row')
  if (row) {
    if (tgt === 'button' && row.note.includes('Drawer')) return [`冒泡到 ${N}：${ran} 執行了，Drawer 打開。按的明明是「取消」，外層的監聽照樣收到這次點擊。`, mode === 'li' ? '解法一是按鈕呼叫 `stopPropagation()`；解法二是改用 `ul` 委派，並在裡面判斷點的是不是按鈕。' : '在委派的監聽裡加一行 `if (e.target.closest(\'button\')) return`（選「ul 委派＋排除按鈕」），不必動按鈕。']
    if (row.note.includes('略過')) return [`冒泡到 ${N}：委派的監聽用 \`event.target.closest('button')\` 判斷點的是按鈕，直接 return，Drawer 不會打開。`, '這個寫法沒有呼叫 `stopPropagation()`，`document` 上的監聽照樣收得到事件。']
    return [`冒泡到 ${N}：${ran} 執行，${row.note}。`, mode === 'li' ? '每一列各自掛一個監聽；列是動態加入的話，每加一列就要再綁一次。' : `監聽只掛在 \`ul\` 上一個：\`currentTarget\` 是 ul，\`target\` 是 ${T}，用 \`closest()\` 找出是哪一列。`]
  }
  return [`冒泡到 ${N}：${ran} 執行，${h.fired[0].note}。`, '`document` 上的監聽收得到頁面上所有元素冒泡上來的點擊，「點外面關閉選單」靠的就是這個。']
}

export default function EventPropagationLab() {
  const [target, setTarget] = React.useState('button')
  const [mode, setMode] = React.useState('li')
  const [stop, setStop] = React.useState(false)
  const [prevent, setPrevent] = React.useState(false)
  const sim = useMemo(() => simulate(target, mode, stop, prevent), [target, mode, stop, prevent])
  const player = usePlayer(sim.hops.length, 1300)
  const step = Math.min(player.step, sim.hops.length - 1)
  const hop = sim.hops[step]
  const fx = hop.fx
  const toEnd = (fn) => (v) => { fn(v); player.setStep(99) }
  const pickTarget = (v) => { setTarget(v); player.setStep(0) }

  const lines = codeLines(mode, stop, prevent)
  const running = new Set(hop.skipped ? [] : hop.fired.map((l) => l.key))
  const hl = lines.map(([k], i) => (k && running.has(k) ? i + 1 : 0)).filter(Boolean)
  const log = sim.hops.slice(0, step + 1).flatMap((h) => (h.skipped ? [] : h.fired.map((l) => ({ ...l, phase: h.phase, node: h.node }))))
  const text = explain(hop, { tgt: sim.tgt, mode, stop, prevent })
  const last = step === sim.hops.length - 1

  // 每個節點在哪一站被經過：捕獲、目標、冒泡各一格
  const cellState = (node, phase) => {
    const i = sim.hops.findIndex((h) => h.node === node && h.phase === phase)
    if (i < 0) return 'none'
    const h = sim.hops[i]
    if (i === step) return h.skipped ? 'cur skip' : 'cur'
    if (i < step) return h.skipped ? 'skip' : 'past'
    return 'todo'
  }
  const chips = (node, capture) => {
    const tgtHere = node === sim.tgt
    const h = sim.hops.find((x) => x.node === node && x.phase === (tgtHere ? 'target' : capture ? 'capture' : 'bubble'))
    if (!h) return null
    const list = tgtHere && capture ? [] : h.fired.filter((l) => tgtHere || l.capture === capture)
    return list.map((l) => <code key={l.key} className="evp-chip">{l.label}</code>)
  }

  return (
    <Lab className="evp" accent="blue" kicker="BROWSER LAB" title="事件的捕獲、冒泡與預設動作"
         blurb="「我的掛號」清單裡的一次點擊經過哪些元素、每一站執行哪些監聽，stopPropagation 與 preventDefault 各擋下什麼。用 React 模擬，不是真的 DOM 事件。">
      <LabControls>
        <Seg label="點哪裡" tinted value={target} onChange={pickTarget} options={Object.entries(TARGETS).map(([value, t]) => ({ value, label: t.label }))} />
        <Seg label="列的監聽" value={mode} onChange={toEnd(setMode)} options={MODES} />
      </LabControls>
      <LabControls>
        <Toggle label="取消鈕呼叫 stopPropagation()" checked={stop} onChange={toEnd(setStop)} />
        <Toggle label="取消鈕呼叫 preventDefault()" checked={prevent} onChange={toEnd(setPrevent)} />
        <span className="spacer" />
        <Stepper step={step} total={sim.hops.length} onStep={player.setStep} playing={player.playing} onPlay={player.toggle} />
      </LabControls>

      <LabGrid>
        <div className="lab-stack">
          <LabStage label="事件的傳遞路徑" caption="左欄是捕獲階段（往下），右欄是冒泡階段（往上）；省略 html 與 body">
            <div className="evp-path" role="table" aria-label="傳遞路徑上的每個元素與監聽">
              <div className="evp-row evp-head" role="row">
                <span role="columnheader">↓ 捕獲</span><span role="columnheader">元素</span><span role="columnheader">冒泡 ↑</span>
              </div>
              {sim.path.map((n) => {
                const isT = n === sim.tgt
                return (
                  <div key={n} className="evp-row" role="row">
                    <span role="cell" className={`evp-cell ${isT ? 'none' : cellState(n, 'capture')}`}>{!isT && chips(n, true)}</span>
                    <span role="cell" className={`evp-cell evp-node ${isT ? cellState(n, 'target') : ''}${isT ? ' is-target' : ''}`} style={{ '--d': NODES[n].depth }}>
                      <code>{NODES[n].tag}</code>{isT && <em>target</em>}{isT && chips(n, false)}
                    </span>
                    <span role="cell" className={`evp-cell ${isT ? 'none' : cellState(n, 'bubble')}`}>{!isT && chips(n, false)}</span>
                  </div>
                )
              })}
              <div className={`evp-row evp-default ${last ? 'cur' : 'todo'}`} role="row">
                <span role="cell">預設動作：{sim.tgt === 'button' ? (last ? (fx.submit ? '送出表單，頁面重新載入' : '已取消，表單不送出') : '送出表單？') : '沒有'}</span>
              </div>
            </div>
          </LabStage>

          <div className="evp-fx" aria-live="polite">
            {fx.cancel ? <Status ok>cancel(12) 執行了</Status> : <span className="pill">取消：未執行</span>}
            {fx.detail ? (sim.tgt === 'button' ? <Status>Drawer 也打開了</Status> : <Status ok>Drawer 打開</Status>) : <span className="pill">Drawer：沒打開</span>}
            {fx.menusMissed ? <Status warn>closeMenus 沒收到</Status> : fx.menus ? <Status ok>下拉選單關閉</Status> : <span className="pill">closeMenus：還沒執行</span>}
            {sim.tgt === 'button' && last && (fx.submit ? <Status>表單送出，頁面重新載入</Status> : <Status ok>表單沒有送出</Status>)}
          </div>

          <div className="dtable-wrap">
            <table className="dtable evp-log">
              <caption>已執行的監聽（整趟傳遞的 event.target 都是 {NODES[sim.tgt].tag.replace(/>.*$/, '>')}）</caption>
              <colgroup><col className="evp-c1" /><col className="evp-c2" /><col /></colgroup>
              <thead><tr><th>eventPhase</th><th>currentTarget</th><th>監聽</th></tr></thead>
              <tbody>
                {log.length === 0 && <tr><td colSpan={3} className="muted">還沒有監聽執行</td></tr>}
                {log.map((l, i) => (
                  <tr key={i} className="row-in">
                    <td>{PHASE_NO[l.phase]} {PHASE[l.phase]}</td>
                    <td><code>{NODES[l.node].tag.replace(/>.*$/, '>')}</code></td>
                    <td>{l.fn}<span className="evp-note">{l.note}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lab-stack">
          <Code lang="js" title="監聽怎麼掛的" highlight={hl}>{lines.map(([, t]) => t).join('\n')}</Code>
          <LabExplain title={`${step + 1}. ${PHASE[hop.phase]}${hop.phase === 'default' ? '' : `：${NODES[hop.node].tag}`}`}>
            {text.map((t, i) => <p key={i} dangerouslySetInnerHTML={{ __html: md(t) }} />)}
          </LabExplain>
          <Callout title="工作上什麼時候用">
            清單裡的列可以點、列裡又有按鈕時，先決定按鈕被點時外層要不要反應，再選做法：外層委派並用 <code>closest()</code> 排除按鈕，或按鈕加 <code>@click.stop</code>。表單裡只做動作的按鈕一律寫 <code>type="button"</code>，表單送出用 <code>@submit.prevent</code> 接手。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .evp-path { display: grid; gap: 4px; font-size: 0.78rem; }
        .evp-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr) minmax(0, 1fr); gap: 4px; }
        .evp-head span { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.04em; color: var(--ink-3); text-align: center; }
        .evp-head span:nth-child(2) { text-align: left; }
        .evp-cell { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-height: 32px; padding: 4px 6px; border: 1.5px dashed var(--hairline); border-radius: 6px; background: var(--surface-1); transition: background 0.25s ease, border-color 0.25s ease, opacity 0.25s ease; }
        .evp-cell.none { border-color: transparent; background: transparent; }
        .evp-cell.todo { opacity: 0.55; }
        .evp-cell.past { border-style: solid; border-color: color-mix(in srgb, var(--lab-accent) 40%, var(--hairline)); }
        .evp-cell.cur { border-style: solid; border-color: var(--lab-accent); background: color-mix(in srgb, var(--lab-accent) 16%, var(--surface-1)); box-shadow: 0 0 0 2px color-mix(in srgb, var(--lab-accent) 30%, transparent); }
        .evp-cell.skip { opacity: 0.7; border-style: dashed; border-color: var(--serious); background: color-mix(in srgb, var(--serious) 8%, var(--surface-1)); }
        .evp-cell.skip .evp-chip { text-decoration: line-through; }
        .evp-node { padding-left: calc(6px + var(--d) * 8px); border-style: solid; }
        .evp-node code { font-family: var(--mono); font-size: 0.72rem; color: var(--ink-1); overflow-wrap: anywhere; }
        .evp-node em { font-style: normal; font-size: 0.66rem; font-weight: 700; color: var(--lab-accent); }
        .evp-node.is-target { border-color: color-mix(in srgb, var(--lab-accent) 55%, var(--hairline)); }
        .evp-chip { font-family: var(--mono); font-size: 0.68rem; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--lab-accent); color: var(--ink-1); background: var(--page); white-space: nowrap; }
        .evp-row.evp-default { grid-template-columns: minmax(0, 1fr); }
        .evp-default span { padding: 6px 8px; border-radius: 6px; border: 1.5px solid var(--hairline); background: var(--surface-1); font-weight: 600; color: var(--ink-2); transition: background 0.25s ease, border-color 0.25s ease; }
        .evp-default.cur span { border-color: var(--lab-accent); color: var(--ink-1); background: color-mix(in srgb, var(--lab-accent) 16%, var(--surface-1)); }
        .evp-fx { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; font-size: 0.8rem; }
        .evp-log td, .evp-log th { font-size: 0.76rem; }
        .evp-log code { font-family: var(--mono); font-size: 0.72rem; white-space: nowrap; }
        .evp-log td:first-child, .evp-log th { white-space: nowrap; }
        .evp-c1 { width: 30%; } .evp-c2 { width: 33%; }
        @media (max-width: 520px) { .evp-log th { font-size: 0.64rem; letter-spacing: 0; } }
        .evp-note { display: block; color: var(--ink-3); font-size: 0.7rem; }
        @media (max-width: 520px) {
          .evp-row { grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.4fr) minmax(0, 0.9fr); }
          .evp-node { padding-left: calc(4px + var(--d) * 4px); }
          .evp-node code { font-size: 0.66rem; }
          .evp-cell { padding: 4px; }
          .evp-chip { font-size: 0.62rem; padding: 1px 4px; }
        }
        @media (prefers-reduced-motion: reduce) { .evp-cell, .evp-default span { transition: none; } }
      `}</style>
    </Lab>
  )
}

function md(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/`([^`]+)`/g, '<code>$1</code>') }

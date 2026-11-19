import React, { useEffect, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Code, Callout, Caption } from './ui.jsx'

/* ============================================================
   浮層疊在一起：Dialog、Drawer、Popover、Tooltip、Toast
   - 原生：模擬 top layer（照開啟順序疊放）、modal 讓其他部分 inert、Esc 關最上面能關的那個、焦點進出
   - div + z-index：真的 CSS stacking context（main 有 transform 時 9999 蓋不過頁首 10），沒有 inert、沒有 Esc
   - inert 用真的屬性；焦點移動是真的；top layer 用舞台裡的一層模擬（真的 top layer 會蓋住整個網頁）
   - 行為依 HTML 規範與 Chromium 153 實測：showModal() 關掉 auto／hint popover；modal 開著時其他元素 inert，
     包括後開的 manual popover；Esc 不關 manual popover；巢狀 modal 由上往下關
   ============================================================ */

const md = (s) => s.replace(/`([^`]+)`/g, '<code>$1</code>')
const P = ({ children }) => (children ? <p dangerouslySetInnerHTML={{ __html: md(children) }} /> : null)

const OV = {
  dialog: { label: '確認 Dialog', kind: 'modal', tag: 'showModal()', z: 9999, first: '保留預約' },
  drawer: { label: 'Drawer', kind: 'modal', tag: 'showModal()', z: 9000, first: '今日門診' },
  logout: { label: '登出確認', kind: 'modal', tag: 'showModal()', z: 9999, first: '留在系統' },
  popover: { label: '篩選 Popover', kind: 'auto', tag: 'popover="auto"', z: 1000 },
  tooltip: { label: 'Tooltip', kind: 'hint', tag: 'popover="hint"', z: 1100 },
  toast: { label: 'Toast', kind: 'manual', tag: 'popover="manual"', z: 100 },
}

const TXT = {
  init: ['原生做法：確認視窗與 Drawer 用 `showModal()`，篩選用 `popover`，Tooltip 用 `popover="hint"`，Toast 用 `popover="manual"`。', '開啟後都放進 top layer，蓋在頁面所有 `z-index` 之上；top layer 裡照開啟的順序疊放，後開的在上面。'],
  modal: ['`showModal()` 把{x}放進 top layer，後面加一層 `::backdrop`；頁面其他部分變成 inert：不能點、不能聚焦，Tab 走不過去。', '焦點移到裡面有 `autofocus` 的按鈕。開著的 auto popover 會先被關掉（規範的 showModal 步驟，Chromium 153 實測相同），Tooltip 也因為焦點移走而消失。'],
  nested: ['從 Drawer 再開一個 modal：top layer 裡有兩個 Dialog，只有最上面的能操作，Drawer 也變成 inert。', '按 Esc 只關最上面的登出確認，焦點回到 Drawer 裡的「登出」；再按一次才關 Drawer。'],
  popover: ['auto popover 不擋操作：背景照樣能點、能聚焦。開啟時焦點留在「篩選」上；Chromium 從「篩選」按 Tab 會先進到 popover 裡，即使它在 DOM 的最後面。', '點 popover 外面或按 Esc 就關（light dismiss）；開另一個 auto popover 也會把它關掉。'],
  dismiss: ['點了 popover 外面：popover 關閉，被點到的按鈕照樣收到這次 click（Chromium 153 實測）。', '「點外面關閉」不會吃掉使用者的那一下，所以背景的按鈕一按就有反應。'],
  tooltip: ['Tooltip 在 hover 或 focus 時出現，本身拿不到焦點；按 Esc 可以關（WCAG 1.4.13）。', '`popover="hint"` 依 2026-11 的 web-features 資料還不是 Baseline（Chrome 151、Firefox 153 起）；不支援時改用 `popover="manual"` 加自己的顯示與隱藏。'],
  toast: ['`popover="manual"` 的 Toast 放進 top layer；Esc、點外面、開其他 popover 都不會關掉它，要自己計時或按 ✕。', 'Toast 不搶焦點，用 `role="status"` 讓螢幕閱讀器念出內容。'],
  toastInert: ['modal 開著時推播 Toast：Toast 後進 top layer，畫在 Dialog 上面；但文件被 modal 擋住時，最上面那個 Dialog 以外的元素都是 inert。', 'Toast 看得到，「查看」按不到、Tab 也到不了（規範的 blocked by a modal dialog，Chromium 153 實測）。有按鈕的 Toast 要等 Dialog 關了再顯示，或放進 Dialog 裡。'],
  toastUnder: ['Toast 先開、{x}後開：{x}在 top layer 裡排在 Toast 上面，`::backdrop` 蓋住 Toast，Toast 也跟著 inert。', '`showModal()` 不會關掉 manual popover，Toast 一直在，只是被蓋住。'],
  esc: ['Esc 關掉最上面、能用 Esc 關的浮層：{x}。manual 的 Toast 不受 Esc 影響。', '關閉 modal 後焦點回到開啟它的按鈕；規範要求瀏覽器做這件事，自己用 div 做就要自己寫。'],
  escNone: ['沒有能用 Esc 關的浮層：`popover="manual"` 的 Toast 不會被 Esc 關掉。', ''],
  close: ['{x}關閉，焦點回到開啟它的按鈕。', 'top layer 少了一層；下面如果還有 modal，它重新變成可以操作的那一個。'],
  confirm: ['確定取消：那一列變成「已取消」，開啟 Dialog 的「取消預約」不在了，焦點移到清單標題。', '觸發按鈕消失時要自己決定焦點去哪；不處理的話，焦點會掉到 `body`。'],
  tabTrap: ['modal 開著時，Tab 只在最上面的 Dialog 裡移動；背景是 inert，焦點走不過去。', '模擬：在最後一個按鈕再按 Tab 會回到第一個；真的瀏覽器可能把焦點移到網址列這類瀏覽器介面。'],
  tab: ['沒有 modal 時，Tab 照 DOM 順序走過頁首、工具列、清單，最後才是浮層裡的按鈕。', '模擬：舞台外的元素略過，走到最後一個再回到第一個。'],
  reset: ['全部關閉，回到沒有浮層的狀態。', ''],
  zInit: ['div 加 `z-index` 的做法：每個浮層都是 main 裡絕對定位的 `div`，沒有另外寫 JavaScript。', 'main 有 `transform`，自成一個 stacking context：裡面寫 9999 也只在 main 裡比，蓋不過 main 外面 `z-index: 10` 的頁首。'],
  zNoTf: ['main 拿掉 `transform` 之後不再是 stacking context，9999 直接和頁首的 10 比，浮層蓋住頁首。', '換成其他會建立 stacking context 的屬性（`filter`、`opacity` 小於 1、有 `z-index` 的定位元素），問題又回來；top layer 不受這些影響。'],
  zModal: ['{x}（z-index {z}）與遮罩出現了，但背景沒有 inert：遮罩後面的按鈕滑鼠點不到，Tab 卻走得到；焦點也沒有移進去。', '{tf}'],
  zPopover: ['Popover 出現在按鈕下方，但沒有 light dismiss：點外面不會關，要再按一次「篩選」；Esc 也沒有作用。', ''],
  zTooltip: ['Tooltip 用 hover 與 focus 顯示，這部分和原生做法一樣要自己寫；差別在它被關在 main 的 stacking context 裡。', ''],
  zToast: ['Toast（z-index 100）在 main 裡；Dialog 或 Drawer 開著時，遮罩（9998、8999）蓋在 Toast 上面。', ''],
  zEsc: ['沒有寫 `keydown` 的處理，Esc 沒有反應；原生的 `<dialog>` 與 popover 不用寫就有。', ''],
  zClose: ['按鈕跟著{x}一起從 DOM 移除，焦點掉到 `body`；鍵盤使用者下一次 Tab 要從頁面開頭重來。', ''],
  zTab: ['Tab 照 DOM 順序走：先經過被遮住的背景按鈕，最後才到浮層裡的按鈕。', '困住焦點、讓背景 inert 都要自己寫；原生的 `showModal()` 已經做好。'],
}

const HTML = `<button popovertarget="filter">篩選</button>
<div id="filter" popover>…</div>

<button aria-describedby="tip">ⓘ</button>
<div id="tip" role="tooltip"
     popover="hint">…</div>

<dialog id="cancel">…</dialog>
<dialog id="drawer">…</dialog>
<dialog id="logout">…</dialog>
<!-- 開啟：dialog.showModal() -->

<div id="toast" role="status"
     popover="manual">…</div>
<!-- 顯示：toast.showPopover() -->`
const HTML_HL = { popover: [1, 2], tooltip: [4, 5, 6], dialog: [8, 11], drawer: [9, 11], logout: [10, 11], toast: [13, 14, 15] }
const css = (tf) => `.header   { position: sticky; z-index: 10; }
${tf ? `.main     { position: relative; z-index: 1;
            transform: translateZ(0); }
/* ↑ 建立 stacking context */` : `.main     { position: relative;
            /* 沒有 z-index、沒有 transform */ }
/* ↑ 不是 stacking context */`}
.backdrop { position: absolute; z-index: 9998; }
.dialog   { position: absolute; z-index: 9999; }
.drawer   { position: absolute; z-index: 9000; }
.tooltip  { position: absolute; z-index: 1100; }
.popover  { position: absolute; z-index: 1000; }
.toast    { position: absolute; z-index: 100; }`
const CSS_HL = { dialog: [5, 6], logout: [5, 6], drawer: [7], tooltip: [8], popover: [9], toast: [10] }

export default function OverlayLab() {
  const [mode, setMode] = useState('native')
  const [tf, setTf] = useState(true)
  const [open, setOpen] = useState([])
  const [cancelled, setCancelled] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [ev, setEv] = useState({ k: 'init' })
  const [log, setLog] = useState([])
  const [focus, setFocus] = useState('（舞台外）')
  const screenRef = useRef(null)
  const els = useRef({})
  const ret = useRef({})
  const pending = useRef(null)
  const lastEl = useRef(null)
  const seq = useRef(0)

  const native = mode === 'native'
  const modals = open.filter((id) => OV[id].kind === 'modal')
  const topModal = native ? modals[modals.length - 1] : null
  const bgInert = Boolean(topModal)
  const ovInert = (id) => Boolean(topModal) && id !== topModal
  const reg = (name) => (el) => { if (el) els.current[name] = el }
  const note = (text) => setLog((l) => [...l.slice(-5), { id: ++seq.current, text }])
  const say = (k, x = '', z = '') => setEv({ k, x, z })
  const inert = (on) => (on ? { inert: '' } : {})

  useEffect(() => {
    const name = pending.current
    pending.current = null
    if (name && els.current[name]?.isConnected) { els.current[name].focus(); return }
    // 有焦點的按鈕被移除：瀏覽器把焦點交給 body（下一個 frame 再看，等瀏覽器做完 focus fixup）
    const id = requestAnimationFrame(() => {
      const a = document.activeElement
      if (lastEl.current && !lastEl.current.isConnected && (!a || a === document.body || !a.isConnected)) setFocus('body')
    })
    return () => cancelAnimationFrame(id)
  }, [open, cancelled])

  function show(id, trigger) {
    if (open.includes(id)) return
    const o = OV[id]
    let next = open
    if (native && o.kind === 'modal') {
      const gone = next.filter((x) => OV[x].kind === 'auto' || OV[x].kind === 'hint')
      if (gone.length) note(`showModal() 先關掉：${gone.map((x) => OV[x].label).join('、')}`)
      next = next.filter((x) => !gone.includes(x))
      pending.current = o.first
    }
    if (native && o.kind === 'auto') next = next.filter((x) => OV[x].kind !== 'auto' && OV[x].kind !== 'hint')
    if (trigger) ret.current[id] = trigger
    setOpen([...next, id])
    if (id !== 'tooltip') note(`開啟 ${o.label}`)
    if (!native) return say(o.kind === 'modal' ? 'zModal' : id === 'popover' ? 'zPopover' : id === 'tooltip' ? 'zTooltip' : 'zToast', o.label, o.z)
    if (id === 'toast') return say(topModal ? 'toastInert' : 'toast')
    if (o.kind === 'modal') return say(id === 'logout' ? 'nested' : open.includes('toast') ? 'toastUnder' : 'modal', o.label)
    say(id)
  }

  function hide(id, how) {
    if (!open.includes(id)) return
    setOpen((cur) => cur.filter((x) => x !== id))
    const inside = screenRef.current?.querySelector(`[data-ov="${id}"]`)?.contains(document.activeElement)
    if (native && (OV[id].kind === 'modal' || inside)) pending.current = ret.current[id]   // modal 一律、popover 在焦點在裡面時還回去
    if (id !== 'tooltip') note(`${how}：關閉 ${OV[id].label}`)
  }

  function esc() {
    if (!native) { note('Esc：沒有反應'); return say('zEsc') }
    const cand = [...open].reverse().find((x) => OV[x].kind !== 'manual')
    if (!cand) { note('Esc：沒有能關的浮層'); return say('escNone') }
    hide(cand, 'Esc')
    say('esc', OV[cand].label)
  }

  function focusables(scope) {
    return [...scope.querySelectorAll('button, input')].filter((el) => !el.closest('[inert]') && !el.disabled)
  }

  function tab() {
    const root = screenRef.current
    const scope = topModal ? root.querySelector(`[data-ov="${topModal}"]`) : root
    const list = scope ? focusables(scope) : []
    if (!list.length) return
    const i = list.indexOf(lastEl.current)
    if (topModal && i === list.length - 1) note('Tab：回到 Dialog 的第一個按鈕（模擬）')
    list[(i + 1) % list.length].focus()
    say(native ? (topModal ? 'tabTrap' : 'tab') : 'zTab')
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); esc(); return }
    if (e.key !== 'Tab' || !topModal || !screenRef.current.contains(document.activeElement)) return
    const list = focusables(screenRef.current.querySelector(`[data-ov="${topModal}"]`))
    const i = list.indexOf(document.activeElement)
    if (!e.shiftKey && i === list.length - 1) { e.preventDefault(); list[0].focus(); note('Tab：回到 Dialog 的第一個按鈕（模擬）') }
    else if (e.shiftKey && i === 0) { e.preventDefault(); list[list.length - 1].focus() }
  }

  function onPointerDown(e) {
    if (!native || !open.includes('popover')) return
    if (e.target.closest('[data-ov="popover"]') || e.target.closest('[data-name="篩選"]')) return
    hide('popover', '點外面')
    say('dismiss')
  }

  function closeBy(id, how) {
    hide(id, how)
    say(native ? 'close' : 'zClose', OV[id].label)
  }

  function reset() {
    setOpen([]); setCancelled(false); setWaiting(false); note('全部關閉')
    say(native ? 'reset' : tf ? 'zInit' : 'zNoTf')
  }

  const pickMode = (m) => { setMode(m); setOpen([]); setLog([]); setFocus('（舞台外）'); say(m === 'native' ? 'init' : tf ? 'zInit' : 'zNoTf') }
  const pickTf = (v) => { setTf(v); if (!native) say(v ? 'zInit' : 'zNoTf') }

  const onFocusIn = (e) => { lastEl.current = e.target; const n = e.target.dataset?.name; if (n) setFocus(n) }
  const tipOn = () => show('tooltip', 'ⓘ')
  const tipOff = () => { if (open.includes('tooltip')) setOpen((cur) => cur.filter((x) => x !== 'tooltip')) }

  /* 右側：圖層、狀態、說明文字 */
  const rows = []
  if (native) {
    if (open.length) rows.push({ n: 'top layer（後開的在上）', g: true })
    ;[...open].reverse().forEach((id) => {
      rows.push({ n: OV[id].label, t: OV[id].tag, d: 1, inert: ovInert(id) })
      if (OV[id].kind === 'modal') rows.push({ n: '::backdrop', t: '', d: 1, dim: true })
    })
    rows.push({ n: '文件', g: true, inert: bgInert })
    rows.push({ n: '頁首', t: 'sticky · z-index: 10', d: 1, inert: bgInert })
    rows.push({ n: 'main', t: tf ? 'transform（stacking context）' : 'position: relative', d: 1, inert: bgInert })
    rows.push({ n: '清單與按鈕', t: '', d: 2, inert: bgInert })
  } else {
    const zs = open.flatMap((id) => [{ n: OV[id].label, z: OV[id].z, id }, ...(OV[id].kind === 'modal' ? [{ n: '遮罩', z: OV[id].z - 1, dim: true }] : [])])
      .sort((a, b) => b.z - a.z).map((r) => ({ ...r, t: `z-index: ${r.z}`, d: tf ? 2 : 0 }))
    if (tf) rows.push({ n: '頁首', t: 'z-index: 10', d: 0 }, { n: 'main', t: 'z-index: 1 · transform：裡面的 z-index 只在這裡比', d: 0, g: true }, ...zs, { n: '清單與按鈕', t: '', d: 2 })
    else rows.push(...zs, { n: '頁首', t: 'z-index: 10', d: 0 }, { n: 'main', t: '不是 stacking context', d: 0 }, { n: '清單與按鈕', t: '', d: 1 })
  }
  const escTarget = native ? ([...open].reverse().find((x) => OV[x].kind !== 'manual') ?? null) : null
  const bgText = native ? (bgInert ? '不能（inert）' : '可以') : (modals.length ? '可以（沒有 inert）' : '可以')
  const last = open[open.length - 1]
  const tfNote = tf ? '頁首蓋在遮罩上面：main 是 stacking context（`transform`），9999 只在 main 裡比，比不過頁首的 10。' : 'main 沒有 transform，浮層蓋住頁首；打開「main 有 transform」，頁首就會蓋回來。'
  const [t1, t2] = (TXT[ev.k] || TXT.init).map((s) => s.replaceAll('{x}', ev.x).replaceAll('{z}', String(ev.z)).replace('{tf}', tfNote))
  const btn = (name, label, onClick, cls = '') => (
    <button type="button" ref={reg(name)} data-name={name} className={`ovl-b ${cls}`} onClick={onClick}>{label}</button>
  )
  const layerZ = (id) => (native ? { zIndex: open.indexOf(id) * 2 + 2 } : { zIndex: OV[id].z })
  const backZ = (id) => (native ? { zIndex: open.indexOf(id) * 2 + 1 } : { zIndex: OV[id].z - 1 })

  const overlays = (
    <>
      {open.filter((id) => OV[id].kind === 'modal').map((id) => <div key={`b-${id}`} className="ovl-back" style={backZ(id)} {...inert(native && ovInert(id))} />)}
      {open.includes('drawer') && (
        <div data-ov="drawer" role="dialog" aria-label="主要導覽" className="ovl-drawer" style={layerZ('drawer')} {...inert(native && ovInert('drawer'))}>
          <b>門診管理</b>
          {btn('今日門診', '今日門診', () => closeBy('drawer', '換頁'))}
          {btn('登出', '登出', () => show('logout', '登出'))}
          {btn('關閉選單', '✕ 關閉', () => closeBy('drawer', '關閉按鈕'), 'ghost')}
        </div>
      )}
      {open.includes('dialog') && (
        <div data-ov="dialog" role="alertdialog" aria-label="取消 11/20 09:30 的預約？" className="ovl-dlg" style={layerZ('dialog')} {...inert(native && ovInert('dialog'))}>
          <b>取消 11/20 09:30 的預約？</b>
          <div className="ovl-acts">
            {btn('保留預約', '保留預約', () => closeBy('dialog', '保留預約'))}
            {btn('確定取消', '確定取消', () => { hide('dialog', '確定取消'); setCancelled(true); pending.current = native ? '清單標題' : null; say(native ? 'confirm' : 'zClose', OV.dialog.label) }, 'danger')}
          </div>
        </div>
      )}
      {open.includes('logout') && (
        <div data-ov="logout" role="alertdialog" aria-label="確定登出？" className="ovl-dlg small" style={layerZ('logout')}>
          <b>確定登出？</b>
          <div className="ovl-acts">
            {btn('留在系統', '留在系統', () => closeBy('logout', '留在系統'))}
            {btn('確定登出', '登出', () => { setOpen((c) => c.filter((x) => x !== 'logout' && x !== 'drawer')); pending.current = native ? '選單' : null; note('模擬登出：關掉 Drawer 與確認框'); say(native ? 'close' : 'zClose', '登出確認與 Drawer ') }, 'danger')}
          </div>
        </div>
      )}
      {open.includes('popover') && (
        <div data-ov="popover" className="ovl-pop" style={layerZ('popover')} {...inert(native && ovInert('popover'))}>
          <label><input type="checkbox" ref={reg('只看候診')} data-name="只看候診" checked={waiting} onChange={(e) => setWaiting(e.target.checked)} /> 只看候診</label>
        </div>
      )}
      {open.includes('tooltip') && <div role="tooltip" id="ovl-tip" className="ovl-tip" style={layerZ('tooltip')}>週三下午休診</div>}
      {open.includes('toast') && (
        <div data-ov="toast" role="status" className="ovl-toast" style={layerZ('toast')} {...inert(native && bgInert)}>
          <span>新掛號：10:30 林○安</span>
          {btn('查看', '查看', () => closeBy('toast', '查看'))}
          {btn('關閉 Toast', '✕', () => closeBy('toast', '✕'), 'ghost')}
        </div>
      )}
    </>
  )

  return (
    <Lab accent="violet" kicker="UI LAB" title="浮層疊在一起時誰在上面"
         blurb="Dialog、Drawer、Popover、Tooltip、Toast 同時開著時：top layer 與 z-index 的疊放、焦點的位置、Esc 關掉哪一個、背景能不能操作。">
      <div className="ovl-wrap" onKeyDown={onKey}>
      <LabControls>
        <Seg label="做法" tinted value={mode} onChange={pickMode} options={[{ value: 'native', label: '原生（top layer）' }, { value: 'zindex', label: 'div + z-index' }]} />
        <Toggle label="main 有 transform" checked={tf} onChange={pickTf} />
        <span className="spacer" />
        <button type="button" className="btn ghost small" onClick={() => show('toast')}>推播 Toast</button>
        <button type="button" className="btn ghost small" onClick={esc}>按 Esc</button>
        <button type="button" className="btn ghost small" onClick={tab}>按 Tab</button>
        <button type="button" className="btn ghost small" onClick={reset}>全部關閉</button>
      </LabControls>
      <LabGrid>
        <div className="lab-stack">
          <LabStage label="模擬的門診預約頁">
            <div className="ovl-screen" ref={screenRef} onFocusCapture={onFocusIn} onPointerDownCapture={onPointerDown}>
              <div className="ovl-head" {...inert(bgInert)}>
                <span>門診預約</span>
                {btn('選單', '☰ 選單', () => show('drawer', '選單'))}
              </div>
              <div className={`ovl-main${tf ? ' tf' : ''}`}>
                <div className="ovl-tools" {...inert(bgInert)}>
                  {btn('篩選', '篩選 ▾', () => (open.includes('popover') ? (hide('popover', '再按一次'), say(native ? 'close' : 'zPopover', OV.popover.label)) : show('popover', '篩選')))}
                  <span className="ovl-dept">內科
                    <button type="button" ref={reg('ⓘ')} data-name="ⓘ" className="ovl-i" aria-label="內科說明" aria-describedby={open.includes('tooltip') ? 'ovl-tip' : undefined}
                            onMouseEnter={tipOn} onMouseLeave={tipOff} onFocus={tipOn} onBlur={tipOff} onClick={tipOn}>ⓘ</button>
                  </span>
                </div>
                <div className="ovl-list" {...inert(bgInert)}>
                  <h5 ref={reg('清單標題')} data-name="清單標題" tabIndex={-1}>11/20 的預約{waiting ? '（只看候診）' : ''}</h5>
                  <div className="ovl-row"><span>09:30 王○明</span>
                    {cancelled ? <>{btn('還原', '已取消・還原', () => { setCancelled(false); note('還原這一列') }, 'ghost')}</> : btn('取消預約', '取消預約', () => show('dialog', '取消預約'), 'danger')}
                  </div>
                  <div className="ovl-row"><span>10:00 陳○華</span><span className="ovl-muted">已報到</span></div>
                </div>
                {!native && <div className="ovl-zlayer">{overlays}</div>}
              </div>
              {native && <div className="ovl-top">{overlays}</div>}
            </div>
          </LabStage>
          <div className="dtable-wrap">
            <table className="dtable ovl-state">
              <caption>目前的狀態</caption>
              <tbody>
                <tr><th>焦點</th><td>{focus}</td></tr>
                <tr><th>Esc 會關掉</th><td>{native ? (escTarget ? OV[escTarget].label : '沒有') : '沒有（沒寫 keydown）'}</td></tr>
                <tr><th>背景能操作</th><td>{bgText}</td></tr>
                <tr><th>top layer</th><td>{native ? (open.length ? `${open.length} 個元素` : '空的') : '沒有用到'}</td></tr>
              </tbody>
            </table>
          </div>
          <Caption>模擬：top layer 用舞台裡最上面的一層表示（真的 top layer 會蓋住整個網頁）；inert 屬性、焦點移動與 div + z-index 的疊放是真的。</Caption>
        </div>
        <div className="lab-stack">
          <div className="ovl-layers" aria-label="圖層，由上到下">
            <span className="ovl-k">圖層（上 → 下）</span>
            <ol>{rows.map((r, i) => (
              <li key={`${r.n}-${i}`} className={`row-in${r.g ? ' g' : ''}${r.dim ? ' dim' : ''}`} style={{ paddingLeft: `${8 + (r.d || 0) * 14}px` }}>
                <span>{r.n}</span>{r.t && <code>{r.t}</code>}{r.inert && <em>inert</em>}
              </li>
            ))}</ol>
          </div>
          <Code lang={native ? 'html' : 'css'} title={native ? '原生做法' : 'div + z-index'} highlight={(native ? HTML_HL : CSS_HL)[last] || []}>{native ? HTML : css(tf)}</Code>
          <LabExplain title={native ? '原生：top layer' : 'div + z-index'}>
            <P>{t1}</P><P>{t2}</P>
          </LabExplain>
          <div className="ovl-log">
            <span className="ovl-k">紀錄</span>
            {log.length ? <ol>{log.map((l) => <li key={l.id} className="row-in">{l.text}</li>)}</ol> : <p className="muted">還沒有操作</p>}
          </div>
          <Callout title="工作上什麼時候用">規格裡同時有 Dialog、Drawer、Toast 時，寫出每一種擋不擋操作、開啟與關閉時焦點去哪、Esc 關哪一個，以及 Dialog 開著時 Toast 怎麼處理；驗收時在 Elements 分頁看 <code>#top-layer</code>，並只用鍵盤開關一輪。</Callout>
        </div>
      </LabGrid>
      </div>

      <style>{`
        .ovl-screen { position: relative; isolation: isolate; height: 300px; max-width: 420px; margin: 0 auto; overflow: hidden; border: var(--bw) solid var(--line); border-radius: 10px; background: var(--surface-1); color: var(--ink-1); font-size: 0.86rem; }
        .ovl-head { position: sticky; top: 0; z-index: 10; height: 44px; display: flex; align-items: center; justify-content: space-between; padding: 0 10px; background: var(--surface-2); border-bottom: 1px solid var(--hairline); font-weight: 700; }
        .ovl-main { position: relative; height: calc(100% - 44px); }
        .ovl-main.tf { z-index: 1; transform: translateZ(0); }
        .ovl-tools { display: flex; align-items: center; gap: 10px; padding: 8px 10px; }
        .ovl-dept { display: inline-flex; align-items: center; gap: 4px; color: var(--ink-2); }
        .ovl-list { padding: 0 10px; }
        .ovl-list h5 { margin: 4px 0; font-size: 0.86rem; padding: 2px 4px; border-radius: 4px; }
        .ovl-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 7px 2px; border-bottom: 1px solid var(--hairline); }
        .ovl-muted { color: var(--ink-3); font-size: 0.8rem; }
        .ovl-b { font: inherit; font-size: 0.8rem; min-height: 30px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--ink-3); background: var(--surface-1); color: var(--ink-1); cursor: pointer; }
        .ovl-b.danger { border-color: var(--critical); color: var(--critical); font-weight: 700; }
        .ovl-b.ghost { border-style: dashed; }
        .ovl-i { font: inherit; width: 26px; height: 26px; border-radius: 50%; border: 1px solid var(--ink-3); background: var(--surface-1); color: var(--ink-1); cursor: pointer; padding: 0; }
        .ovl-screen :focus-visible, .ovl-list h5:focus { outline: 2px solid var(--lab-accent); outline-offset: 2px; }
        .ovl-top { position: absolute; inset: 0; z-index: 20; pointer-events: none; }
        .ovl-zlayer { position: absolute; top: -44px; left: 0; right: 0; bottom: 0; pointer-events: none; }
        .ovl-top > *, .ovl-zlayer > * { pointer-events: auto; position: absolute; }
        .ovl-back { inset: 0; background: color-mix(in srgb, var(--shade) 45%, transparent); animation: ovl-fade 0.18s ease-out both; }
        .ovl-dlg, .ovl-drawer, .ovl-pop, .ovl-toast, .ovl-tip { background: var(--surface-1); border: var(--bw) solid var(--line); border-radius: 10px; box-shadow: 3px 3px 0 var(--shade); padding: 10px 12px; animation: ovl-pop 0.18s ease-out both; }
        .ovl-dlg { left: 50%; top: 50%; width: min(84%, 260px); transform: translate(-50%, -50%); display: grid; gap: 10px; }
        .ovl-dlg.small { width: min(70%, 210px); }
        .ovl-acts { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
        .ovl-drawer { left: 0; top: 0; bottom: 0; width: min(62%, 220px); border-radius: 0 10px 10px 0; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
        .ovl-pop { left: 10px; top: 82px; }
        .ovl-pop label { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
        .ovl-tip { left: 96px; top: 82px; padding: 4px 8px; font-size: 0.78rem; background: var(--ink-1); color: var(--surface-1); border-color: var(--ink-1); }
        .ovl-toast { right: 8px; bottom: 8px; display: flex; align-items: center; gap: 6px; max-width: calc(100% - 16px); }
        .ovl-state th { width: 6.5rem; }
        .ovl-k { font-size: 0.72rem; letter-spacing: 0.06em; color: var(--ink-3); }
        .ovl-layers ol, .ovl-log ol { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 4px; }
        .ovl-layers li { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 5px 8px; border: 1px solid var(--hairline); border-radius: 6px; background: var(--surface-1); font-size: 0.82rem; color: var(--ink-1); }
        .ovl-layers li.g { background: var(--surface-2); font-weight: 700; }
        .ovl-layers li.dim { color: var(--ink-3); border-style: dashed; }
        .ovl-layers code { font-family: var(--mono); font-size: 0.76rem; color: var(--ink-2); overflow-wrap: anywhere; }
        .ovl-layers em { font-style: normal; font-size: 0.72rem; font-weight: 700; padding: 1px 6px; border-radius: 999px; background: var(--st-red); color: var(--on-sticker); }
        .ovl-log { font-size: 0.82rem; color: var(--ink-2); }
        .ovl-log ol { list-style: decimal; padding-left: 1.3rem; display: block; line-height: 1.6; }
        .ovl-log p { margin: 4px 0 0; }
        @keyframes ovl-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes ovl-pop { from { opacity: 0; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .ovl-back, .ovl-dlg, .ovl-drawer, .ovl-pop, .ovl-toast, .ovl-tip { animation: none; } }
      `}</style>
    </Lab>
  )
}

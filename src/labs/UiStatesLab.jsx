import React, { useEffect, useId, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Code, Callout, Caption } from './ui.jsx'

/* ============================================================
   UI 元件的狀態：按鈕、輸入框、下拉選單（select-only combobox）、Dialog
   - 每個狀態：畫面、CSS 選擇器或屬性、輔助科技讀到的狀態、驗收條件
   - hover、focus-visible、active 用 class 模擬 DevTools 的 :hov 強制狀態；其他狀態是真的屬性
   - 舞台上的元件可以真的操作；「瀏覽器目前判定」是 el.matches() 的實際結果
   - Dialog 用 div 模擬（不標 aria-modal，因為頁面其他部分沒有被擋住），焦點移動是真的
   ============================================================ */

const md = (s) => s.replace(/`([^`]+)`/g, '<code>$1</code>')
const P = ({ children }) => <p dangerouslySetInnerHTML={{ __html: md(children) }} />

/* CSS 用區塊組成，依狀態算出要高亮的行號 */
function build(blocks) {
  const lines = [], map = {}
  for (const [key, ls] of blocks) {
    if (lines.length) lines.push('')
    map[key] = ls.map((_, i) => lines.length + i + 1)
    lines.push(...ls)
  }
  return { code: lines.join('\n'), map }
}

const BTN = build([
  ['default', ['.btn {', '  min-width: 8rem;   /* 換文字時寬度不跳 */', '  background: var(--color-primary);', '  color: var(--color-on-primary);', '}']],
  ['hover', ['@media (hover: hover) {', '  .btn:hover:not(:disabled) {', '    background: var(--color-primary-strong);', '  }', '}']],
  ['focus', ['.btn:focus-visible {', '  outline: 2px solid var(--color-focus);', '  outline-offset: 2px;', '}']],
  ['active', ['.btn:active:not(:disabled) {', '  transform: translateY(1px);', '}']],
  ['disabled', ['.btn:disabled {', '  opacity: 0.6;', '  cursor: not-allowed;', '}']],
  ['loading', ['/* <button class="btn is-loading" disabled> */', '.btn.is-loading .spinner {', '  animation: spin 0.8s linear infinite;', '}']],
])
const INP = build([
  ['default', ['.field input {', '  border: 1px solid var(--color-border-strong);', '  background: var(--color-surface);', '}']],
  ['hover', ['@media (hover: hover) {', '  .field input:hover:not(:disabled):not([readonly]) {', '    border-color: var(--color-text-muted);', '  }', '}']],
  ['focus', ['.field input:focus-visible {', '  outline: 2px solid var(--color-focus);', '  outline-offset: 1px;', '}']],
  ['readonly', ['.field input[readonly] {', '  background: var(--color-surface-muted);', '  border-style: dashed;', '}']],
  ['disabled', ['.field input:disabled {', '  opacity: 0.6;', '  cursor: not-allowed;', '}']],
  ['error', ['.field input[aria-invalid="true"] {', '  border-color: var(--color-danger);', '}', '.field .error { color: var(--color-danger); }']],
])
const SEL = build([
  ['default', ['[role="combobox"] {', '  border: 1px solid var(--color-border-strong);', '}']],
  ['focus', ['[role="combobox"]:focus-visible {', '  outline: 2px solid var(--color-focus);', '}']],
  ['expanded', ['[role="combobox"][aria-expanded="true"] .chevron {', '  transform: rotate(180deg);', '}', '[role="option"][aria-selected="true"] {   /* 反白：選取跟著焦點 */', '  background: var(--color-selected-bg);', '}']],
  ['selected', ['[role="option"].is-current::before {   /* 目前的值 */', '  content: "✓ ";', '}']],
  ['disabled', ['[role="combobox"][aria-disabled="true"] {', '  opacity: 0.6;', '  cursor: not-allowed;', '}']],
  ['error', ['[role="combobox"][aria-invalid="true"] {', '  border-color: var(--color-danger);', '}']],
])
const DLG_CODE = `<button type="button" @click="dialog.showModal()">
  取消預約
</button>

<dialog ref="dialog" role="alertdialog"
        aria-labelledby="t" aria-describedby="d">
  <h2 id="t">取消 11/20 09:30 的預約？</h2>
  <p id="d">取消後名額會開放給其他人。</p>
  <form method="dialog">
    <button value="keep" autofocus>保留預約</button>
    <button value="confirm">確定取消</button>
  </form>
</dialog>

dialog::backdrop { background: rgb(0 0 0 / 0.5); }
body:has(dialog[open]) { overflow: hidden; }`
const DLG_HL = { idle: [1, 2, 3], open: [1, 5, 6, 10, 15], trap: [5, 9, 10, 11], return: [9, 10, 12], gone: [11] }

/* 每個狀態：標籤、選擇器、輔助科技讀到的、驗收條件、說明 */
const COMPS = {
  button: { label: '按鈕', file: 'Button.vue（style 節錄）', css: BTN, states: {
    default: { label: 'default', sel: '.btn', ax: ['button', '確認掛號', '（無）'], checks: ['底色用 `--color-primary`，文字對比至少 4.5:1', '`min-width` 固定，換文字時寬度不跳', 'Accessibility 窗格的 Name 是「確認掛號」'], text: ['平常的樣子。名稱來自按鈕裡的文字，螢幕閱讀器念「確認掛號，按鈕」。', '`min-width` 先留好空間，送出中換成「送出中…」時，旁邊的元素不會被推動。'] },
    hover: { label: 'hover', sel: '.btn:hover:not(:disabled)', ax: ['button', '確認掛號', '（無）'], checks: ['Styles 窗格按 `:hov` 勾 `:hover`，底色加深一階', '停用時沒有 hover 效果', '手機上不需要 hover 也看得到所有資訊'], text: ['滑鼠移上去。寫在 `@media (hover: hover)` 裡，只在主要輸入裝置能 hover 時套用，觸控裝置點完不會停在 hover 樣式。', '`:not(:disabled)` 讓停用的按鈕沒有 hover 效果，不會看起來像能按。'] },
    focus: { label: 'focus-visible', sel: '.btn:focus-visible', ax: ['button', '確認掛號', 'focused'], checks: ['只用 Tab 移到按鈕，外框清楚可見', '外框和背景的對比至少 3:1', '用滑鼠點按鈕時通常不出現外框'], text: ['鍵盤移過來時的外框。`:focus-visible` 由瀏覽器判斷：Tab 移過來時成立，滑鼠點按鈕時通常不成立。', '舞台上的按鈕先用滑鼠點一下，再用 Tab 移過來，比較下方 `:focus` 與 `:focus-visible` 的判定。'] },
    active: { label: 'active', sel: '.btn:active:not(:disabled)', ax: ['button', '確認掛號', '（無）'], checks: ['`:hov` 勾 `:active`，按鈕往下位移 1px', '位移不改變尺寸，旁邊的元素不動'], text: ['按下去的那一瞬間。`transform` 只影響繪製，不改排版，旁邊的元素不會動。', '這個狀態很短，驗收時用 `:hov` 強制勾選才看得清楚。'] },
    disabled: { label: 'disabled', sel: '.btn:disabled（disabled 屬性）', ax: ['button', '確認掛號', 'disabled'], checks: ['Tab 跳過它，點了沒有反應', '旁邊寫出不能按的原因', '要讓人 Tab 到並聽到原因時改用 `aria-disabled="true"`'], text: ['`disabled` 屬性：拿不到焦點、不觸發 `click`、表單裡的值不送出。', '使用者需要知道原因時，在旁邊寫出來，或保持可按、按下後指出缺什麼。'] },
    loading: { label: 'loading', sel: '.btn.is-loading（加 disabled）', ax: ['button', '送出中…', 'disabled'], checks: ['按下後立刻停用，連點只送出一次', '顯示 spinner 與「送出中…」，寬度不變', '用鍵盤送出後，焦點的去向和規格一致'], text: ['送出中：在 `await` 之前把按鈕設成 `disabled` 並換文字，請求回來前的第二次點擊不會觸發。', '用 Tab 移到舞台上的按鈕再按 Enter：按鈕變成 `disabled` 的同時失去焦點（在 Chromium 實測，下方 `:focus` 變成否），焦點回到 `body`。規格要寫出送出後焦點去哪，例如移到結果訊息；要讓按鈕保有焦點就改用 `aria-disabled`，在處理函式裡擋第二次。'] },
  } },
  input: { label: '輸入框', file: 'FormField.vue（style 節錄）', css: INP, states: {
    default: { label: 'default', sel: '.field input', ax: ['textbox', '病歷號', '描述：例如 A00123'], checks: ['Accessibility 窗格的 Name 是 label 的「病歷號」', '說明用 `aria-describedby` 連到欄位', '邊框和背景的對比至少 3:1'], text: ['平常的樣子。名稱來自 `<label for>`，說明「例如 A00123」用 `aria-describedby` 連過來，聚焦時螢幕閱讀器會接著念。'] },
    hover: { label: 'hover', sel: '.field input:hover', ax: ['textbox', '病歷號', '描述：例如 A00123'], checks: ['`:hov` 勾 `:hover`，邊框變深', 'readonly 與 disabled 沒有 hover 效果'], text: ['滑鼠移上去時邊框加深一點，提示這裡可以點。輸入框的 hover 只是輔助，沒有也不影響使用。'] },
    focus: { label: 'focus-visible', sel: '.field input:focus-visible', ax: ['textbox', '病歷號', 'focused'], checks: ['用滑鼠點進欄位，外框也出現', '外框和背景的對比至少 3:1'], text: ['文字輸入框用滑鼠點進去，`:focus-visible` 也會成立，因為接下來要用鍵盤打字；這點和按鈕不同。', '在舞台上的欄位用滑鼠點一下，看下方 `:focus-visible` 的判定。'] },
    readonly: { label: 'readonly', sel: '.field input[readonly]', ax: ['textbox', '病歷號', 'readonly'], checks: ['Tab 拿得到焦點，可以選取、複製', '值會隨表單送出', '外觀和可編輯的欄位分得出來'], text: ['`readonly`：不能改，但拿得到焦點、值會送出，螢幕閱讀器念出唯讀。病歷號這種要給人看、也要送出的值用它。'] },
    disabled: { label: 'disabled', sel: '.field input:disabled', ax: ['textbox', '病歷號', 'disabled'], checks: ['Tab 跳過，點了沒有反應', '值不會隨表單送出', '旁邊說明為什麼不能填'], text: ['`disabled`：拿不到焦點、值不送出。不能改但要送出的值用 `readonly`，不用它。'] },
    error: { label: 'error', sel: '.field input[aria-invalid="true"]', ax: ['textbox', '病歷號', 'invalid；描述：格式不對'], checks: ['紅框之外有圖示與文字訊息', '`aria-describedby` 指到錯誤訊息', '送出後焦點移到第一個錯誤欄位'], text: ['驗證失敗：程式設定 `aria-invalid="true"`，樣式也依這個屬性變色，畫面和輔助科技讀到的狀態來自同一個屬性。', '在舞台上輸入 `A12` 再按 Tab 離開欄位，會進入這個狀態；輸入 `A00123` 則回到 default。'] },
  } },
  select: { label: '下拉選單', file: 'DeptSelect.vue（style 節錄）', css: SEL, states: {
    default: { label: 'default', sel: '[role="combobox"]', ax: ['combobox', '科別', 'collapsed；值：{value}'], checks: ['Tab 拿得到焦點（`tabindex="0"`）', 'Role 是 combobox、Name 是「科別」', '`aria-expanded="false"`'], text: ['自己畫的下拉選單（APG 的 select-only combobox）：外框是 `role="combobox"`，名稱用 `aria-labelledby` 指到「科別」。', '舞台上的版本可以用鍵盤操作：Tab 過去，按 ↓、Enter 或 Space 開啟。'] },
    focus: { label: 'focus-visible', sel: '[role="combobox"]:focus-visible', ax: ['combobox', '科別', 'focused；collapsed；值：{value}'], checks: ['Tab 過來看得到外框', '外框對比至少 3:1'], text: ['取得焦點。`div` 加 `tabindex="0"` 才拿得到焦點；`:focus-visible` 的判斷和按鈕類似，鍵盤移過來時成立。'] },
    expanded: { label: '開啟', sel: '[aria-expanded="true"]、[aria-selected="true"]', ax: ['combobox', '科別', 'expanded；activedescendant：{active}'], checks: ['`aria-expanded` 變成 `true`', '`aria-activedescendant` 指到的 id 存在', 'DOM 焦點仍在 combobox 上'], text: ['清單打開：combobox 的 `aria-expanded="true"`，`aria-activedescendant` 指向反白的選項。', 'DOM 焦點沒有移進清單。↑↓ 移動反白，選取跟著反白（`aria-selected`），Enter 或 Space 確定，Esc 關閉且不改原本的值。'] },
    selected: { label: '已選', sel: '[role="combobox"] 顯示目前的值', ax: ['combobox', '科別', 'collapsed；值：{value}'], checks: ['畫面顯示選到的科別，螢幕閱讀器念出名稱與值', '再打開時反白停在目前的值', 'Esc 關閉清單時值不變'], text: ['選好之後清單關閉，焦點留在 combobox，畫面顯示選的值。', '再次打開時，反白從目前的值開始，不從第一項開始。'] },
    disabled: { label: 'disabled', sel: '[role="combobox"][aria-disabled="true"]', ax: ['combobox', '科別', 'disabled'], checks: ['點擊與按鍵都不會開啟清單', '樣式看得出停用', '旁邊說明原因（例如先選日期）'], text: ['自訂元件沒有 `disabled` 屬性可用，改用 `aria-disabled="true"`：輔助科技念出已停用，開啟清單的處理函式要自己擋。', '下方的 `:disabled` 判定一直是否，因為 `aria-disabled` 不會讓元素符合 `:disabled`。'] },
    error: { label: 'error', sel: '[role="combobox"][aria-invalid="true"]', ax: ['combobox', '科別', 'invalid；描述：請選擇科別'], checks: ['紅框之外有文字訊息', '`aria-describedby` 指到錯誤訊息', '選了值之後錯誤消失'], text: ['必填沒選：`aria-invalid="true"` 加上錯誤訊息，和輸入框的錯誤一樣處理。'] },
  } },
  dialog: { label: 'Dialog', file: 'CancelDialog.vue（節錄）', states: {
    idle: { label: '關閉', sel: 'dialog:not([open])', ax: ['button', '取消預約', 'focused'], focus: 'trigger', checks: ['觸發按鈕是 `<button>`，Tab 拿得到', 'Enter 與 Space 都能開啟', '按鈕文字說出動作'], text: ['Dialog 還沒開。焦點在「取消預約」上，等一下關閉時焦點要回到這裡。', '舞台上的「取消預約」可以點，也可以 Tab 過去按 Enter，焦點紀錄會一步步列出來。'] },
    open: { label: '開啟：焦點移入', sel: 'dialog:modal、::backdrop', ax: ['alertdialog', '取消 11/20 09:30 的預約？', '焦點：保留預約'], focus: 'keep', checks: ['開啟後焦點在「保留預約」上', '背景的元素 Tab 不到、點不到（inert）', 'Accessibility 窗格的 Name 是標題文字'], text: ['`showModal()` 把 Dialog 放進 top layer、讓背景 inert，焦點移到有 `autofocus` 的「保留預約」。', '這是不容易復原的確認，APG 建議焦點先放在比較安全的按鈕，誤按 Enter 也不會取消。'] },
    trap: { label: 'Tab 留在裡面', sel: 'Tab 只在 Dialog 裡循環', ax: ['alertdialog', '取消 11/20 09:30 的預約？', 'Tab 循環：保留預約 ⇄ 確定取消'], focus: 'keep', checks: ['在「確定取消」按 Tab 回到「保留預約」', 'Shift+Tab 從第一個回到最後一個', '焦點走不到後面的清單'], text: ['APG 的 modal Dialog：Tab 與 Shift+Tab 只在 Dialog 裡循環。舞台上的模擬自己處理 Tab。', '原生 `showModal()` 讓背景 inert，焦點不會走到頁面其他元素；在最後一個元素再按 Tab 可能移到瀏覽器的網址列，依瀏覽器而定。'] },
    return: { label: '關閉：焦點回來', sel: 'close 事件、returnValue', ax: ['button', '取消預約', 'focused'], focus: 'trigger', checks: ['按 Esc 或「保留預約」都會關閉', '焦點回到「取消預約」，不是 `body`', 'Console 的 live expression `document.activeElement` 指到那顆按鈕'], text: ['Esc 先觸發 `cancel` 再關閉；`<form method="dialog">` 裡的按鈕直接關閉，按鈕的 `value` 成為 `returnValue`。', 'HTML 規範要求關閉後把焦點還給開啟前的元素，鍵盤使用者接著從原本那一列繼續。'] },
    gone: { label: '觸發按鈕不在了', sel: 'heading[tabindex="-1"]', ax: ['heading', '11/20 的預約', 'focused'], focus: 'heading', checks: ['那一列取消後，焦點移到清單標題', '焦點不會掉到 `body`', '畫面上看得到「已取消」'], text: ['確定取消後，開啟 Dialog 的按鈕跟著那一列消失，焦點沒有地方回去。', '程式把焦點移到接得上工作流程的地方，例如加了 `tabindex="-1"` 的清單標題；APG 的 Dialog 模式寫了這個例外。'] },
  } },
}
const DEPTS = ['內科', '骨科', '眼科', '皮膚科']
const PSEUDO = [['hover', ':hover'], ['focus', ':focus'], ['fv', ':focus-visible'], ['active', ':active'], ['disabled', ':disabled']]
const FORCE = { hover: 'f-hover', focus: 'f-focus', active: 'f-active' }

/* 讀 el.matches() 的結果：指標、焦點、按鍵事件之後的下一個 frame 再讀 */
function usePseudo(wrapRef, targetRef, key) {
  const [p, setP] = useState({})
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    let raf = 0
    const read = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const el = targetRef.current
        if (!el) return
        const next = { hover: el.matches(':hover'), focus: el.matches(':focus'), fv: el.matches(':focus-visible'), active: el.matches(':active'), disabled: el.matches(':disabled') }
        setP((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
      })
    }
    const evs = ['pointerover', 'pointerout', 'pointerdown', 'pointerup', 'focusin', 'focusout', 'keydown', 'keyup']
    evs.forEach((e) => wrap.addEventListener(e, read))
    read()
    return () => { cancelAnimationFrame(raf); evs.forEach((e) => wrap.removeEventListener(e, read)) }
  }, [wrapRef, targetRef, key])
  return p
}

export default function UiStatesLab() {
  const uid = useId().replace(/:/g, '')
  const [comp, setComp] = useState('button')
  const [states, setStates] = useState({ button: 'default', input: 'default', select: 'default', dialog: 'idle' })
  const [sent, setSent] = useState(0)
  const [value, setValue] = useState('')
  const [sel, setSel] = useState(-1)
  const [active, setActive] = useState(0)
  const [cancelled, setCancelled] = useState(false)
  const [log, setLog] = useState([])
  const set = (c, s) => setStates((m) => ({ ...m, [c]: s }))
  const state = states[comp]
  const cfg = COMPS[comp]
  const info = cfg.states[state]

  const wrapRef = useRef(null), targetRef = useRef(null), timer = useRef(null), seq = useRef(0)
  const refs = { trigger: useRef(null), keep: useRef(null), confirm: useRef(null), heading: useRef(null), bg: useRef(null) }
  const pending = useRef(null)
  const pseudo = usePseudo(wrapRef, targetRef, `${comp}-${state}`)
  useEffect(() => () => clearTimeout(timer.current), [])

  const dlgOpen = comp === 'dialog' && (state === 'open' || state === 'trap')
  useEffect(() => { if (refs.bg.current) refs.bg.current.inert = dlgOpen })   // 背景 inert：不能點、不能聚焦
  useEffect(() => {                                                             // 由舞台操作觸發的焦點移動
    const k = pending.current
    pending.current = null
    if (k) refs[k].current?.focus()
  })
  const note = (text) => setLog((l) => [...l, { id: ++seq.current, text }].slice(-6))

  /* 用 Seg 選狀態：只改畫面與屬性，不移動真的焦點（和 DevTools 的 :hov 一樣） */
  const pick = (s) => {
    set(comp, s)
    if (comp === 'input') setValue(s === 'readonly' ? 'A00123' : s === 'error' ? 'A12' : '')
    if (comp === 'select') {
      if (s === 'default' || s === 'focus' || s === 'error') setSel(-1)
      if (s === 'selected' && sel < 0) setSel(1)
      if (s === 'expanded') setActive(sel >= 0 ? sel : 0)
    }
    if (comp === 'dialog') setCancelled(s === 'gone')
  }

  /* 按鈕：送出 1.2 秒 */
  const submit = () => {
    setSent((n) => n + 1)
    set('button', 'loading')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setStates((m) => (m.button === 'loading' ? { ...m, button: 'default' } : m)), 1200)
  }
  /* 輸入框：離開欄位時驗證 */
  const validate = () => {
    if (states.input === 'readonly' || states.input === 'disabled' || !value) return
    set('input', /^[A-Z]\d{5}$/.test(value) ? 'default' : 'error')
  }
  /* 下拉選單：照 APG 的 select-only combobox */
  const selOpen = comp === 'select' && state === 'expanded'
  const selDisabled = state === 'disabled'
  const choose = (i) => { setSel(i); set('select', 'selected') }
  const closeSel = () => set('select', sel >= 0 ? 'selected' : 'default')
  const openSel = (i) => { setActive(i); set('select', 'expanded') }
  const onSelKey = (e) => {
    if (selDisabled) return
    const last = DEPTS.length - 1
    if (!selOpen) {
      const start = { ArrowDown: sel >= 0 ? sel : 0, ArrowUp: sel >= 0 ? sel : 0, Enter: sel >= 0 ? sel : 0, ' ': sel >= 0 ? sel : 0, Home: 0, End: last }[e.key]
      if (start !== undefined) { e.preventDefault(); openSel(start) }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(last, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); setActive(e.key === 'Home' ? 0 : last) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active) }
    else if (e.key === 'Tab') choose(active)
    else if (e.key === 'Escape') { e.preventDefault(); closeSel() }
  }
  /* Dialog：開啟、Tab 循環、Esc、確定取消 */
  const openDlg = () => { pending.current = 'keep'; set('dialog', 'open'); note('開啟 Dialog') }
  const closeDlg = (how) => { pending.current = 'trigger'; set('dialog', 'return'); note(`${how}：關閉`) }
  const confirmDlg = () => { pending.current = 'heading'; setCancelled(true); set('dialog', 'gone'); note('確定取消：這一列已取消') }
  const restore = () => { pending.current = 'trigger'; setCancelled(false); set('dialog', 'idle'); note('還原這一列') }
  const onDlgKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeDlg('Esc') }
    if (e.key !== 'Tab') return
    const first = refs.keep.current, last = refs.confirm.current
    if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); note('Tab 在最後一個：回到第一個'); set('dialog', 'trap'); first.focus() }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); note('Shift+Tab 在第一個：到最後一個'); set('dialog', 'trap'); last.focus() }
  }
  const [live, setLive] = useState(false)   // 舞台裡有真的焦點時，不畫模擬的焦點外框
  const onFocusLog = (e) => { setLive(true); const n = e.target.dataset?.name; if (n) note(`焦點 → ${n}`) }
  const onBlurLog = (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setLive(false) }
  const ring = (k) => (comp === 'dialog' && !live && info.focus === k ? ' f-focus' : '')
  const ax = info.ax.map((x) => x.replace('{active}', DEPTS[active]).replace('{value}', sel >= 0 ? DEPTS[sel] : '請選擇科別'))

  const force = FORCE[state] || ''
  const code = comp === 'dialog' ? DLG_CODE : cfg.css.code
  const hl = comp === 'dialog' ? DLG_HL[state] : cfg.css.map[state] || []

  return (
    <Lab accent="violet" kicker="UI LAB" title="UI 元件的狀態"
         blurb="按鈕、輸入框、下拉選單與 Dialog 的每個狀態：畫面、CSS 選擇器或屬性、輔助科技讀到的狀態與驗收條件。">
      <LabControls>
        <Seg label="元件" tinted value={comp} onChange={setComp} options={Object.entries(COMPS).map(([k, c]) => ({ value: k, label: c.label }))} />
        <Seg label="狀態" value={state} onChange={pick} options={Object.entries(cfg.states).map(([k, s]) => ({ value: k, label: s.label }))} />
      </LabControls>
      <LabGrid>
        <div className="lab-stack">
          <LabStage label={`${cfg.label}的 ${info.label} 狀態`}>
            <p className="uisl-sel"><span>選擇器／屬性</span><code>{info.sel}</code></p>
            <div className="uisl-preview" ref={wrapRef}>
              {comp === 'button' && (
                <button ref={targetRef} type="button" className={`uisl-btn ${force}${state === 'loading' ? ' is-loading' : ''}`}
                        disabled={state === 'disabled' || state === 'loading'} onClick={submit}>
                  {state === 'loading' && <span className="uisl-spin" aria-hidden="true" />}
                  {state === 'loading' ? '送出中…' : '確認掛號'}
                </button>
              )}
              {comp === 'input' && (
                <div className="uisl-field">
                  <label htmlFor={`${uid}-chart`}>病歷號</label>
                  <input ref={targetRef} id={`${uid}-chart`} className={force} value={value} onChange={(e) => setValue(e.target.value.toUpperCase())} onBlur={validate}
                         readOnly={state === 'readonly'} disabled={state === 'disabled'} aria-invalid={state === 'error' ? 'true' : undefined}
                         aria-describedby={`${uid}-hint${state === 'error' ? ` ${uid}-err` : ''}`} autoComplete="off" spellCheck={false} />
                  <span id={`${uid}-hint`} className="uisl-hint">例如 A00123</span>
                  {state === 'error' && <span id={`${uid}-err`} className="uisl-err"><span aria-hidden="true">✕ </span>格式不對：1 個英文字母加 5 位數字</span>}
                </div>
              )}
              {comp === 'select' && (
                <div className="uisl-field">
                  <span id={`${uid}-lbl`}>科別</span>
                  <div ref={targetRef} role="combobox" tabIndex={0} className={`uisl-combo ${force}`} aria-labelledby={`${uid}-lbl`}
                       aria-expanded={selOpen} aria-controls={`${uid}-list`}
                       aria-activedescendant={selOpen ? `${uid}-opt-${active}` : undefined}
                       aria-disabled={selDisabled ? 'true' : undefined} aria-invalid={state === 'error' ? 'true' : undefined}
                       aria-describedby={state === 'error' ? `${uid}-serr` : undefined}
                       onKeyDown={onSelKey} onBlur={() => selOpen && closeSel()}
                       onClick={() => !selDisabled && (selOpen ? closeSel() : openSel(sel >= 0 ? sel : 0))}>
                    <span>{sel >= 0 ? DEPTS[sel] : '請選擇科別'}</span><span className="chev" aria-hidden="true">▾</span>
                  </div>
                  <ul id={`${uid}-list`} role="listbox" aria-labelledby={`${uid}-lbl`} className="uisl-list" hidden={!selOpen}>
                    {DEPTS.map((d, i) => (
                      <li key={d} id={`${uid}-opt-${i}`} role="option" aria-selected={selOpen && i === active}
                          className={i === sel ? 'is-current' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(i)}>{d}</li>
                    ))}
                  </ul>
                  {state === 'error' && <span id={`${uid}-serr`} className="uisl-err"><span aria-hidden="true">✕ </span>請選擇科別</span>}
                </div>
              )}
              {comp === 'dialog' && (
                <div className="uisl-screen" onFocusCapture={onFocusLog} onBlurCapture={onBlurLog}>
                  <div ref={refs.bg} className="uisl-bg">
                    <h5 ref={refs.heading} tabIndex={-1} data-name="清單標題" className={`uisl-h${ring('heading')}`}>11/20 的預約</h5>
                    <div className="uisl-row">
                      <span>09:30 王○明</span>
                      {cancelled
                        ? <><span className="uisl-badge">✕ 已取消</span><button type="button" className="uisl-mini" data-name="還原" onClick={restore}>還原</button></>
                        : <button ref={refs.trigger} type="button" className={`uisl-mini danger${ring('trigger')}`} data-name="取消預約" onClick={openDlg}>取消預約</button>}
                    </div>
                    <div className="uisl-row"><span>10:00 陳○華</span><button type="button" className="uisl-mini" data-name="詳細（背景）">詳細</button></div>
                  </div>
                  {dlgOpen && (
                    <div className="uisl-backdrop">
                      <div role="alertdialog" aria-labelledby={`${uid}-dt`} aria-describedby={`${uid}-dd`} className="uisl-dlg" onKeyDown={onDlgKey}>
                        <h5 id={`${uid}-dt`}>取消 11/20 09:30 的預約？</h5>
                        <p id={`${uid}-dd`}>取消後名額會開放給其他人。</p>
                        <div className="uisl-acts">
                          <button ref={refs.keep} type="button" className={`uisl-mini${ring('keep')}`} data-name="保留預約" onClick={() => closeDlg('保留預約')}>保留預約</button>
                          <button ref={refs.confirm} type="button" className="uisl-mini danger" data-name="確定取消" onClick={confirmDlg}>確定取消</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            {comp === 'button' && <p className="uisl-count">已送出：{sent} 次</p>}
            {comp !== 'dialog' ? (
              <div className="uisl-pseudo" aria-label="瀏覽器目前判定">
                <span className="uisl-k">瀏覽器目前判定</span>
                {PSEUDO.map(([k, name]) => <span key={k} className={`uisl-pill${pseudo[k] ? ' on' : ''}`}>{name} {pseudo[k] ? '✓' : '—'}</span>)}
              </div>
            ) : (
              <div className="uisl-log">
                <span className="uisl-k">焦點紀錄</span>
                {log.length === 0 ? <p className="muted">還沒有操作</p> : <ol>{log.map((l) => <li key={l.id} className="row-in">{l.text}</li>)}</ol>}
              </div>
            )}
            <div className="dtable-wrap uisl-ax">
              <table className="dtable">
                <caption>Accessibility 窗格（示意）</caption>
                <tbody>
                  <tr><th>Role</th><td>{ax[0]}</td></tr>
                  <tr><th>Name</th><td>{ax[1]}</td></tr>
                  <tr><th>狀態</th><td>{ax[2]}</td></tr>
                </tbody>
              </table>
            </div>
          </LabStage>
          <div className="uisl-spec">
            <h5>驗收條件</h5>
            <ul>{info.checks.map((c) => <li key={c} dangerouslySetInnerHTML={{ __html: md(c) }} />)}</ul>
          </div>
          <Caption>模擬：hover、focus-visible、active 用 class 模擬 DevTools 的 :hov 強制狀態，其他狀態是真的屬性；Dialog 用 div 模擬在舞台裡，焦點移動是真的。</Caption>
        </div>
        <div className="lab-stack">
          <Code lang={comp === 'dialog' ? 'html' : 'css'} title={cfg.file} highlight={hl}>{code}</Code>
          <LabExplain title={`${cfg.label}：${info.label}`}>
            {info.text.map((t) => <P key={t}>{t}</P>)}
          </LabExplain>
          <Callout title="工作上什麼時候用">寫元件規格時，替每個元件列出狀態表：每個狀態的選擇器或屬性、外觀與驗收條件；驗收時用 Styles 窗格的 :hov 強制狀態、只用鍵盤走一遍，Dialog 再加上開啟與關閉時焦點的去向。</Callout>
        </div>
      </LabGrid>

      <style>{`
        .uisl-sel { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; margin: 0 0 12px; font-size: 0.8rem; color: var(--ink-3); }
        .uisl-sel code { font-family: var(--mono); font-size: 0.82rem; color: var(--ink-1); background: var(--surface-2); padding: 2px 8px; border-radius: 4px; overflow-wrap: anywhere; }
        .uisl-preview { min-height: 132px; display: grid; place-items: center; padding: 14px 8px; border: 1px dashed var(--hairline); border-radius: 10px; background: var(--page); }
        .uisl-btn { min-width: 8rem; min-height: 44px; padding: 0 18px; border: 0; border-radius: 8px; background: var(--lab-accent); color: var(--surface-1); font-weight: 700; font-size: 0.95rem; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; transition: background 0.15s ease, transform 0.1s ease, opacity 0.15s ease; }
        @media (hover: hover) { .uisl-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--lab-accent) 78%, var(--ink-1)); } }
        .uisl-btn.f-hover:not(:disabled) { background: color-mix(in srgb, var(--lab-accent) 78%, var(--ink-1)); }
        .uisl-btn:focus-visible, .uisl-btn.f-focus { outline: 2px solid var(--ink-1); outline-offset: 2px; }
        .uisl-btn:active:not(:disabled), .uisl-btn.f-active:not(:disabled) { transform: translateY(1px); }
        .uisl-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .uisl-spin { width: 1em; height: 1em; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: uisl-spin 0.8s linear infinite; }
        .uisl-field { display: grid; gap: 6px; width: min(100%, 280px); position: relative; font-size: 0.88rem; color: var(--ink-1); }
        .uisl-field input, .uisl-combo { font: inherit; padding: 9px 10px; border: 1px solid var(--ink-3); border-radius: 6px; background: var(--surface-1); color: var(--ink-1); transition: border-color 0.15s ease, background 0.15s ease; }
        @media (hover: hover) { .uisl-field input:hover:not(:disabled):not([readonly]), .uisl-combo:hover:not([aria-disabled="true"]) { border-color: var(--ink-1); } }
        .uisl-field input.f-hover:not(:disabled):not([readonly]), .uisl-combo.f-hover { border-color: var(--ink-1); }
        .uisl-field input:focus-visible, .uisl-field input.f-focus, .uisl-combo:focus-visible, .uisl-combo.f-focus { outline: 2px solid var(--ink-1); outline-offset: 1px; }
        .uisl-field input[readonly] { background: var(--surface-2); border-style: dashed; }
        .uisl-field input:disabled, .uisl-combo[aria-disabled="true"] { opacity: 0.55; cursor: not-allowed; }
        .uisl-field input[aria-invalid="true"], .uisl-combo[aria-invalid="true"] { border-color: var(--critical); border-width: 2px; }
        .uisl-hint { font-size: 0.78rem; color: var(--ink-3); }
        .uisl-err { font-size: 0.8rem; color: var(--critical); font-weight: 600; }
        .uisl-combo { display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none; }
        .uisl-combo .chev { transition: transform 0.2s ease; }
        .uisl-combo[aria-expanded="true"] .chev { transform: rotate(180deg); }
        .uisl-list { list-style: none; margin: 0; padding: 4px; border: 1px solid var(--ink-3); border-radius: 6px; background: var(--surface-1); }
        .uisl-list li { padding: 7px 10px; border-radius: 4px; cursor: pointer; }
        .uisl-list li.is-current::before { content: "✓ "; }
        .uisl-list li[aria-selected="true"] { background: color-mix(in srgb, var(--lab-accent) 18%, var(--surface-1)); outline: 2px solid var(--lab-accent); outline-offset: -2px; }
        .uisl-count { margin: 8px 0 0; font-size: 0.8rem; color: var(--ink-2); text-align: center; }
        .uisl-pseudo { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 12px; }
        .uisl-k { font-size: 0.72rem; letter-spacing: 0.06em; color: var(--ink-3); margin-right: 4px; }
        .uisl-pill { font-family: var(--mono); font-size: 0.74rem; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--hairline); color: var(--ink-3); transition: background 0.15s ease, color 0.15s ease; }
        .uisl-pill.on { border-color: var(--lab-accent); color: var(--ink-1); background: color-mix(in srgb, var(--lab-accent) 16%, transparent); font-weight: 700; }
        .uisl-log { margin-top: 12px; font-size: 0.82rem; color: var(--ink-2); }
        .uisl-log ol { margin: 4px 0 0; padding-left: 1.3rem; line-height: 1.6; }
        .uisl-log p { margin: 4px 0 0; }
        .uisl-ax { margin-top: 12px; }
        .uisl-ax th { width: 4.5rem; }
        .uisl-screen { position: relative; width: 100%; max-width: 380px; min-height: 196px; border: 1px solid var(--hairline); border-radius: 10px; background: var(--surface-1); padding: 10px 12px; font-size: 0.86rem; color: var(--ink-1); overflow: hidden; }
        .uisl-h { margin: 0 0 8px; font-size: 0.92rem; padding: 2px 4px; border-radius: 4px; }
        .uisl-h:focus-visible, .uisl-h.f-focus { outline: 2px solid var(--ink-1); }
        .uisl-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 8px 4px; border-bottom: 1px solid var(--hairline); }
        .uisl-mini { font: inherit; font-size: 0.8rem; min-height: 32px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--ink-3); background: var(--surface-1); color: var(--ink-1); cursor: pointer; }
        .uisl-mini.danger { border-color: var(--critical); color: var(--critical); font-weight: 700; }
        .uisl-mini:focus-visible, .uisl-mini.f-focus { outline: 2px solid var(--ink-1); outline-offset: 2px; }
        .uisl-badge { margin-left: auto; font-size: 0.76rem; color: var(--ink-2); }
        .uisl-backdrop { position: absolute; inset: 0; display: grid; place-items: center; padding: 10px; background: color-mix(in srgb, var(--shade) 45%, transparent); animation: uisl-fade 0.2s ease-out both; }
        .uisl-dlg { width: min(100%, 300px); background: var(--surface-1); border: var(--bw) solid var(--line); border-radius: 10px; padding: 12px 14px; box-shadow: 4px 4px 0 var(--shade); }
        .uisl-dlg h5 { margin: 0 0 6px; font-size: 0.92rem; }
        .uisl-dlg p { margin: 0 0 12px; color: var(--ink-2); font-size: 0.82rem; }
        .uisl-acts { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
        .uisl-spec h5 { margin: 0 0 6px; font-size: 0.74rem; letter-spacing: 0.08em; color: var(--ink-2); }
        .uisl-spec ul { margin: 0; padding-left: 1.1rem; font-size: 0.84rem; color: var(--ink-2); line-height: 1.6; }
        .uisl-spec code, .uisl-log code { font-family: var(--mono); font-size: 0.85em; }
        @keyframes uisl-spin { to { transform: rotate(360deg); } }
        @keyframes uisl-fade { from { opacity: 0; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .uisl-spin, .uisl-backdrop { animation: none; } .uisl-btn, .uisl-combo .chev { transition: none; } }
      `}</style>
    </Lab>
  )
}

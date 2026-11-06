import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Toggle, Slider, Stepper, usePlayer, Callout, Status, Stats, Stat, Caption, useWidth, fmtN } from './ui.jsx'

/* ============================================================
   Agent 的執行迴圈：thinking → tool_call → tool_result → … → done
   - 腳本化假模型：任務「查某個診次的剩餘名額並回報」，依序產生回應
   - 每一步把內容加進 context（token 累計）；步數上限 / token 預算任一超過 → failed
   - 工具逾時、工具回傳格式錯誤：讓迴圈多繞幾圈，成本與步數跟著漲
   - 中途中斷 → interrupted；從 checkpoint 恢復 = 帶著累積的 context 從停的地方繼續
   token 數為示意
   ============================================================ */

const STATES = {
  thinking: { label: 'thinking', zh: '模型思考' },
  tool_call: { label: 'tool_call', zh: '呼叫工具' },
  tool_result: { label: 'tool_result', zh: '讀工具結果' },
  done: { label: 'done', zh: '完成' },
  failed: { label: 'failed', zh: '失敗' },
  interrupted: { label: 'interrupted', zh: '中斷' },
}

/* 依兩個故障開關組出腳本：每步 { s: 狀態, t: 標題, d: 加進 context 的內容, tok: 示意 token 數 } */
function buildScript({ timeout, badFormat }) {
  const steps = [
    { s: 'thinking', t: '解析任務', d: '任務：「查陳醫師下週三下午診的剩餘名額並回報」。需要先知道 clinic_id，計畫：list_clinics → get_quota → 回答。', tok: 140 },
    { s: 'tool_call', t: 'list_clinics', d: '{ "tool": "list_clinics", "args": { "doctor": "陳", "date": "2026-11-11", "period": "pm" } }', tok: 60 },
    { s: 'tool_result', t: 'list_clinics 回傳', d: '[{ "clinic_id": "C-2031", "doctor": "陳○○", "date": "2026-11-11", "period": "pm" }]', tok: 90 },
    { s: 'thinking', t: '取得 clinic_id', d: '只有一個符合的診次 C-2031，接著查名額。', tok: 70 },
    { s: 'tool_call', t: 'get_quota', d: '{ "tool": "get_quota", "args": { "clinic_id": "C-2031" } }', tok: 50 },
  ]
  if (timeout) {
    steps.push({ s: 'tool_result', t: 'get_quota 逾時', d: '{ "error": "timeout", "elapsed_ms": 8000 }', tok: 40, bad: true })
    steps.push({ s: 'thinking', t: '處理逾時', d: '工具沒有回傳資料。逾時可重試一次；若再失敗就回報「暫時查不到」而不是猜。', tok: 90 })
    steps.push({ s: 'tool_call', t: 'get_quota（重試）', d: '{ "tool": "get_quota", "args": { "clinic_id": "C-2031" }, "retry": 1 }', tok: 55 })
  }
  if (badFormat) {
    steps.push({ s: 'tool_result', t: 'get_quota 回傳格式錯誤', d: '<html><body>Service Temporarily Unavailable</body></html> …（不是約定的 JSON，但整頁內容都進了 context）', tok: 160, bad: true })
    steps.push({ s: 'thinking', t: '偵測格式錯誤', d: '回傳不符合 schema（缺 remaining 欄位），不能拿來回答。再呼叫一次並要求 JSON。', tok: 95 })
    steps.push({ s: 'tool_call', t: 'get_quota（再試）', d: '{ "tool": "get_quota", "args": { "clinic_id": "C-2031", "format": "json" } }', tok: 60 })
  }
  steps.push({ s: 'tool_result', t: 'get_quota 回傳', d: '{ "clinic_id": "C-2031", "capacity": 30, "booked": 27, "remaining": 3 }', tok: 70 })
  steps.push({ s: 'thinking', t: '彙整答案', d: '容量 30、已掛 27，剩 3 名。資料齊了，不需要再呼叫工具，直接回答。', tok: 80 })
  steps.push({ s: 'done', t: '回答使用者', d: '陳醫師 2026-11-11 下午診（C-2031）目前剩餘 3 個名額。', tok: 60 })
  return steps
}

/* 套用步數上限與 token 預算：超過的那一步改成 failed，之後的步驟截掉 */
function applyLimits(script, maxSteps, budget) {
  const out = []
  let used = 0
  for (let i = 0; i < script.length; i++) {
    const st = script[i]
    if (i >= maxSteps) { out.push({ s: 'failed', t: '超過步數上限', d: `已走 ${i} 步仍未完成，harness 強制停止：迴圈可能卡在重試或一直沒收斂。`, tok: 0, used, reason: 'steps' }); return out }
    if (used + st.tok > budget) { out.push({ s: 'failed', t: '超過 token 預算', d: `這一步會把 context 推到 ${fmtN(used + st.tok)}，超過預算 ${fmtN(budget)}；harness 在送出前就擋下。`, tok: 0, used, reason: 'budget' }); return out }
    used += st.tok
    out.push({ ...st, used })
  }
  return out
}

export default function AgentLoopLab() {
  const [maxSteps, setMaxSteps] = useState(10)
  const [budget, setBudget] = useState(1200)
  const [timeout, setTimeout_] = useState(false)
  const [badFormat, setBadFormat] = useState(false)
  const [interruptAt, setInterruptAt] = useState(null)   // 在第幾步之後按了中斷

  const limited = useMemo(() => applyLimits(buildScript({ timeout, badFormat }), maxSteps, budget), [timeout, badFormat, maxSteps, budget])
  const trace = useMemo(() => {
    if (interruptAt === null || interruptAt >= limited.length - 1) return limited
    const base = limited.slice(0, interruptAt + 1)
    return [...base, { s: 'interrupted', t: '中斷', d: `使用者按了中斷。前 ${interruptAt + 1} 步的 context（${fmtN(base[base.length - 1].used)} token）存成 checkpoint，隨時可以從這裡繼續。`, tok: 0, used: base[base.length - 1].used }]
  }, [limited, interruptAt])

  const { step, setStep, playing, toggle } = usePlayer(trace.length, 1100)
  const cur = Math.min(step, trace.length - 1)
  const now = trace[cur]
  const prev = cur > 0 ? trace[cur - 1] : null
  const terminal = ['done', 'failed', 'interrupted'].includes(now.s)
  const toolCalls = trace.slice(0, cur + 1).filter((x) => x.s === 'tool_call').length
  const box = useRef(null)
  const narrow = useWidth(box, 600) < 480

  /* 中斷 / 恢復 */
  const interrupt = () => { if (terminal) return; setInterruptAt(cur); setStep(cur + 1) }
  const resume = () => { const at = interruptAt; setInterruptAt(null); setStep(at + 1) }
  const restart = () => { setInterruptAt(null); setStep(0) }
  useEffect(() => { setInterruptAt(null) }, [timeout, badFormat, maxSteps, budget])   // 改設定就清掉中斷點

  const EX = {
    thinking: ['thinking：模型決定下一步', [
      '模型讀完目前的 context（任務、之前的工具結果），輸出「接下來要做什麼」：可能是呼叫某個工具，也可能是直接回答。這一步的輸出會被加進 context，之後每一輪都會被重送。',
      '迴圈的終止條件就藏在這裡：模型判斷「資料齊了」就輸出最終答案（→ done）；判斷還缺資料就再呼叫工具（→ tool_call）。harness 不信任這個判斷會一定收斂，所以外面要有步數上限與預算。',
    ]],
    tool_call: ['tool_call：模型輸出的是「請求」，不是結果', [
      '模型回傳一段結構化的呼叫（工具名 + 參數），harness 解析後真的去打 API 或查資料庫。模型自己不會執行任何東西；它只是產生一段 JSON。',
      '這裡要做的檢查：工具名在白名單內、參數符合 schema、這個使用者有權限呼叫。參數是模型生成的，要和使用者輸入一樣當成不可信。',
    ]],
    tool_result: [now.bad ? 'tool_result：壞掉的回傳也會進 context' : 'tool_result：把結果塞回 context', [
      now.bad
        ? `這次工具沒有給出可用的資料（${now.t}）。注意 token 還是照算：一整頁錯誤 HTML 進了 context，比正常結果還貴。harness 應該在這裡先驗 schema，不符合就截短或換成明確的錯誤訊息再交給模型。`
        : '工具的回傳被包成一則訊息加進 context，模型下一輪才看得到。回傳越長、之後每一輪的 context 就越大——這是 agent 成本隨步數「加速」上升的原因。',
      '工具回傳的內容也是不可信輸入：裡面若夾帶指令，模型可能照做。',
    ]],
    done: ['done：模型給出最終答案，迴圈結束', [
      `共 ${cur + 1} 步、${toolCalls} 次工具呼叫、累計 ${fmtN(now.used)} token。harness 收到不含 tool_call 的回覆就視為完成，把答案交給使用者。`,
      '完成不代表正確。答案裡的數字來自工具結果，可以回頭對照；若模型在資料不齊時就「推測」出一個數字，done 反而是最危險的狀態。',
    ]],
    failed: [now.reason === 'budget' ? 'failed：token 預算用完' : 'failed：步數用完', [
      now.d,
      '失敗要明確回報「做到哪、為什麼停」，而不是讓模型硬擠一個答案。預算與步數是 harness 的保險絲：寧可停下來，不要無限迴圈燒錢。',
    ]],
    interrupted: ['interrupted：停下來，但 context 還在', [
      now.d,
      '中斷和失敗不同：中斷是外部決定（使用者取消、部署重啟、排程暫停），狀態完整。若每一步的 context 都有存，恢復時不必從頭重跑，直接帶著 checkpoint 繼續下一步。',
    ]],
  }[now.s]

  const budgetPct = Math.min(100, (now.used / budget) * 100)
  const endTone = now.s === 'done' ? 'ok' : now.s === 'failed' ? 'bad' : now.s === 'interrupted' ? 'warn' : ''

  return (
    <Lab accent="aqua" kicker="AGENT LAB" title="Agent 的執行迴圈：工具呼叫、狀態機、預算與中斷"
         blurb="一個腳本化的假模型執行「查某診次剩餘名額並回報」。逐步或自動播放，看狀態機怎麼在 thinking、tool_call、tool_result 之間繞圈；調步數上限與 token 預算、讓工具逾時或回傳壞格式，看迴圈在哪裡被保險絲擋下。">
      <LabControls>
        <Stepper step={cur} total={trace.length} onStep={(s) => setStep(s)} playing={playing} onPlay={toggle} labels={trace.map((x) => x.t)} />
        <span className="spacer" />
        <button type="button" className="btn ghost small" onClick={interrupt} disabled={terminal}>中途中斷</button>
        <button type="button" className="btn ghost small" onClick={resume} disabled={interruptAt === null}>從 checkpoint 恢復</button>
        <button type="button" className="btn ghost small" onClick={restart}>重來</button>
      </LabControls>
      <LabControls>
        <Slider label="步數上限" min={4} max={14} value={maxSteps} onChange={setMaxSteps} format={(v) => `${v} 步`} />
        <Slider label="token 預算" min={300} max={2000} step={50} value={budget} onChange={setBudget} format={(v) => `${fmtN(v)} tok`} />
        <Toggle label="工具逾時一次" checked={timeout} onChange={setTimeout_} />
        <Toggle label="工具回傳格式錯誤" checked={badFormat} onChange={setBadFormat} />
      </LabControls>

      <LabGrid>
        <div className="lab-stack">
          <LabStage label="狀態機" caption={`目前：${STATES[now.s].label}（${STATES[now.s].zh}）· 第 ${cur + 1} / ${trace.length} 步 · ${now.t}`}>
            <div ref={box}><MachineSvg state={now.s} prevState={prev?.s} narrow={narrow} /></div>
          </LabStage>
          <Stats min={120}>
            <Stat label="步數" value={cur + 1} unit={`/ ${maxSteps}`} tone={now.reason === 'steps' ? 'bad' : cur + 1 >= maxSteps - 1 && !terminal ? 'warn' : ''} />
            <Stat label="token 用量" value={fmtN(now.used)} unit={`/ ${fmtN(budget)}`} tone={now.reason === 'budget' ? 'bad' : budgetPct > 80 ? 'warn' : ''} note={`${Math.round(budgetPct)}% 預算`} />
            <Stat label="工具呼叫" value={toolCalls} unit="次" note={timeout || badFormat ? '含重試' : ''} />
            <Stat label="結束狀態" value={terminal ? STATES[now.s].label : '執行中'} tone={endTone} note={terminal ? STATES[now.s].zh : `下一步：${trace[cur + 1]?.t ?? ''}`} />
          </Stats>
        </div>

        <div className="lab-stack">
          <div className="al-budget" aria-label="token 預算條">
            <div className="al-budget-head"><span>context 累積</span><span>{fmtN(now.used)} / {fmtN(budget)} token</span></div>
            <div className="al-track"><div className={`al-fill${now.reason === 'budget' ? ' over' : budgetPct > 80 ? ' warn' : ''}`} style={{ width: `${budgetPct}%` }} /></div>
          </div>
          <ol className="al-ctx" aria-label="context 內容">
            {trace.slice(0, cur + 1).map((x, i) => (
              <li key={i} className={`al-msg ${x.s}${i === cur ? ' now' : ''}`}>
                <div className="al-msg-head"><span className={`al-dot ${x.s}`} />{x.t}<span className="al-tok">{x.tok ? `+${x.tok}` : ''} <small>Σ {fmtN(x.used)}</small></span></div>
                <div className="al-msg-body">{x.d}</div>
              </li>
            ))}
          </ol>
          <LabExplain title={EX[0]}>{EX[1].map((t, i) => <p key={i}>{t}</p>)}</LabExplain>
          <Callout title="實際用在哪裡">
            任何「讓模型自己決定要不要再呼叫工具」的功能都是這個迴圈：客服機器人查訂單、資料分析助手連查幾張表、自動修 CI 的 bot。上線前先把步數上限、token 預算、工具逾時、schema 驗證、可中斷可恢復這五件事做進 harness，再談模型選哪個。
          </Callout>
        </div>
      </LabGrid>
      <Caption>每步的 token 數為示意；真實 agent 的 context 還包含系統提示詞與工具定義，每一輪都會重送，成本比這裡呈現的更陡。</Caption>

      <style>{`
        .al-budget { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 8px 12px; }
        .al-budget-head { display: flex; justify-content: space-between; font-size: 0.74rem; color: var(--ink-3); font-weight: 700; letter-spacing: 0.03em; margin-bottom: 6px; }
        .al-budget-head span:last-child { font-family: var(--mono); font-weight: 500; color: var(--ink-1); }
        .al-track { height: 8px; background: var(--surface-2); border-radius: 4px; overflow: hidden; }
        .al-fill { height: 100%; background: var(--lab-accent); border-radius: 4px; transition: width 0.4s ease, background 0.3s ease; }
        .al-fill.warn { background: var(--serious); }
        .al-fill.over { background: var(--critical); }
        .al-ctx { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; max-height: 300px; overflow-y: auto; }
        .al-msg { border: 1px solid var(--hairline); border-left: 3px solid var(--ink-3); border-radius: var(--radius); background: var(--surface-1); padding: 6px 10px; font-size: 0.76rem; animation: al-in 0.25s ease-out both; }
        .al-msg.thinking { border-left-color: var(--c-violet); }
        .al-msg.tool_call { border-left-color: var(--c-blue); }
        .al-msg.tool_result { border-left-color: var(--c-orange); }
        .al-msg.done { border-left-color: var(--good); }
        .al-msg.failed { border-left-color: var(--critical); }
        .al-msg.interrupted { border-left-color: var(--serious); }
        .al-msg.now { background: color-mix(in srgb, var(--lab-accent) 8%, var(--surface-1)); }
        .al-msg-head { display: flex; align-items: center; gap: 6px; font-weight: 700; color: var(--ink-1); }
        .al-tok { margin-left: auto; font-family: var(--mono); font-weight: 500; color: var(--ink-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
        .al-tok small { color: var(--ink-3); }
        .al-msg-body { font-family: var(--mono); color: var(--ink-2); margin-top: 3px; overflow-wrap: anywhere; line-height: 1.5; }
        .al-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ink-3); flex: none; }
        .al-dot.thinking { background: var(--c-violet); } .al-dot.tool_call { background: var(--c-blue); } .al-dot.tool_result { background: var(--c-orange); }
        .al-dot.done { background: var(--good); } .al-dot.failed { background: var(--critical); } .al-dot.interrupted { background: var(--serious); }
        @keyframes al-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
        .al-fsm { width: 100%; max-width: 620px; margin: 0 auto; }
        .al-fsm .node { fill: var(--surface-1); stroke: var(--hairline); stroke-width: 1.5; transition: stroke 0.25s ease, fill 0.25s ease; }
        .al-fsm .node.on { stroke: var(--c); stroke-width: 2.5; fill: color-mix(in srgb, var(--c) 14%, var(--surface-1)); }
        .al-fsm .nl { font-family: var(--mono); font-size: 13px; font-weight: 700; fill: var(--ink-2); }
        .al-fsm .nl.on { fill: var(--ink-1); }
        .al-fsm .nz { font-family: var(--sans); font-size: 11px; fill: var(--ink-3); }
        .al-fsm .e { fill: none; stroke: color-mix(in srgb, var(--ink-3) 55%, transparent); stroke-width: 1.5; marker-end: url(#al-arrow); transition: stroke 0.25s ease; }
        .al-fsm .e.on { stroke: var(--lab-accent); stroke-width: 2.5; marker-end: url(#al-arrow-on); }
        .al-fsm .el { font-family: var(--sans); font-size: 10.5px; fill: var(--ink-3); }
        .al-fsm.narrow .nl { font-size: 15px; } .al-fsm.narrow .nz { font-size: 13px; } .al-fsm.narrow .el { font-size: 12px; }
        .al-fsm .halo { fill: none; stroke: var(--c); stroke-width: 2; opacity: 0; }
        .al-fsm .node.on + .halo { animation: al-halo 1.2s ease-out infinite; }
        @keyframes al-halo { 0% { opacity: 0.7; transform: scale(1); } 100% { opacity: 0; transform: scale(1.15); } }
        @media (prefers-reduced-motion: reduce) { .al-msg { animation: none; } .al-fill { transition: none; } .al-fsm .node.on + .halo { animation: none; } }
      `}</style>
    </Lab>
  )
}

const NODE_COLOR = { thinking: 'var(--c-violet)', tool_call: 'var(--c-blue)', tool_result: 'var(--c-orange)', done: 'var(--good)', failed: 'var(--critical)', interrupted: 'var(--serious)' }

/* 狀態機圖：寬版三個主要狀態橫排、終止狀態在下排；窄版改直式 */
function MachineSvg({ state, prevState, narrow }) {
  const W = narrow ? 340 : 640, H = narrow ? 300 : 240
  const NW = narrow ? 124 : 132, NH = 46
  /* 寬版：主迴圈橫排在上、終止狀態在下；窄版：主迴圈直排在左、終止狀態在右 */
  const P = narrow
    ? { thinking: [100, 40], tool_call: [100, 150], tool_result: [100, 260], done: [266, 40], interrupted: [266, 150], failed: [266, 260] }
    : { thinking: [96, 80], tool_call: [320, 80], tool_result: [544, 80], done: [96, 200], failed: [320, 200], interrupted: [544, 200] }
  const edges = [
    { from: 'thinking', to: 'tool_call', label: '要呼叫工具' },
    { from: 'tool_call', to: 'tool_result', label: 'harness 執行' },
    { from: 'tool_result', to: 'thinking', label: '結果進 context', back: true },
    { from: 'thinking', to: 'done', label: '資料齊了' },
    { from: 'thinking', to: 'failed', label: '超過上限 / 預算' },
    { from: 'tool_result', to: 'failed', label: '' },
    { from: 'thinking', to: 'interrupted', label: '使用者中斷' },
  ]
  /* 亮起的邊：剛走過的那條；終止狀態若不是從圖上那條邊進來（例如在 tool_call 時中斷），就亮第一條通往它的邊 */
  const exact = edges.some((e) => e.from === prevState && e.to === state)
  const terminalIn = ['done', 'failed', 'interrupted'].includes(state)
  const isOn = (e) => e.to === state && (exact ? e.from === prevState : terminalIn && edges.find((x) => x.to === state) === e)
  const anchor = (k, dx, dy) => {
    const [x, y] = P[k]
    return Math.abs(dx) * NH > Math.abs(dy) * NW ? [x + Math.sign(dx) * NW / 2, y] : [x, y + Math.sign(dy) * NH / 2]
  }
  const geo = (e) => {
    const [x1, y1] = P[e.from], [x2, y2] = P[e.to]
    if (e.back) {
      if (narrow) { const xl = x1 - NW / 2; return { d: `M${xl} ${y1} C${xl - 44} ${y1}, ${xl - 44} ${y2}, ${xl} ${y2}`, lx: xl - 20, ly: (y1 + y2) / 2, vertical: true } }
      return { d: `M${x1} ${y1 - NH / 2} C${x1} ${y1 - 68}, ${x2} ${y2 - 68}, ${x2} ${y2 - NH / 2}`, lx: (x1 + x2) / 2, ly: y1 - 66 }
    }
    const side = narrow && x1 !== x2
    const [ax, ay] = side ? [x1 + NW / 2, y1] : anchor(e.from, x2 - x1, y2 - y1)
    const [bx, by] = side ? [x2 - NW / 2, y2] : anchor(e.to, x1 - x2, y1 - y2)
    const horiz = ay === by
    return { d: `M${ax} ${ay} L${bx} ${by}`, lx: horiz ? (ax + bx) / 2 : ax + (bx - ax) * 0.5 + 6, ly: horiz ? ay - 8 : ay + (by - ay) * 0.5, anchorStart: !horiz }
  }
  const showLabel = (e) => e.label && (!narrow || e.from === 'thinking' && e.to === 'tool_call' || e.from === 'tool_call')
  return (
    <svg className={`al-fsm${narrow ? ' narrow' : ''}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`agent 狀態機，目前狀態 ${state}`}>
      <defs>
        <marker id="al-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-3)" /></marker>
        <marker id="al-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="var(--lab-accent)" /></marker>
      </defs>
      {edges.map((e) => {
        const on = isOn(e), g = geo(e)
        return (
          <g key={e.from + e.to}>
            <path d={g.d} className={`e${on ? ' on' : ''}`} />
            {showLabel(e) && (g.vertical
              ? <text x={g.lx} y={g.ly} textAnchor="middle" className="el" transform={`rotate(-90 ${g.lx} ${g.ly})`}>{e.label}</text>
              : <text x={g.lx} y={g.ly} textAnchor={g.anchorStart ? 'start' : 'middle'} dominantBaseline="middle" className="el">{e.label}</text>)}
          </g>
        )
      })}
      {Object.entries(P).map(([k, [x, y]]) => {
        const on = k === state
        return (
          <g key={k} style={{ '--c': NODE_COLOR[k] }}>
            <rect x={x - NW / 2} y={y - NH / 2} width={NW} height={NH} rx="8" className={`node${on ? ' on' : ''}`} />
            <rect x={x - NW / 2} y={y - NH / 2} width={NW} height={NH} rx="8" className="halo" style={{ transformOrigin: `${x}px ${y}px` }} />
            <text x={x} y={y - 3} textAnchor="middle" className={`nl${on ? ' on' : ''}`}>{STATES[k].label}</text>
            <text x={x} y={y + 13} textAnchor="middle" className="nz">{STATES[k].zh}</text>
          </g>
        )
      })}
    </svg>
  )
}

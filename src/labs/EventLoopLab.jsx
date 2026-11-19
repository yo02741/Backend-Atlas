import React, { useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Stepper, usePlayer, Code, Callout, Caption } from './ui.jsx'

/* ============================================================
   事件迴圈逐步執行（純前端模擬，時間是示意）
   - 每個範例寫成「函式 → 一串操作」：log、排 task、排 microtask、await、rAF、改 DOM、長迴圈
   - simulate() 照 HTML 規範的順序跑：一個 task → 清空 microtask → 渲染時機 → 下一個 task，
     每做一個操作拍一張快照（call stack、兩個 queue、Console、DOM 與畫面、時間線）
   ============================================================ */

const T = {
  log: (op) => ['console.log', `同步執行，Console 馬上印出「${op.log}」。`, 'console'],
  task: () => ['setTimeout：交給計時器', '`setTimeout` 把回呼交給計時器，0 ms 到了就排進 task queue；這一行馬上結束，不會等。task 要等目前的程式跑完、microtask 也清空才輪到。', 'task'],
  then: () => ['Promise.then：排進 microtask queue', 'Promise 已經完成，`then` 的回呼直接排進 microtask queue。目前的程式一跑完就先執行它，比所有 task 都早。', 'micro'],
  queueMicrotask: () => ['queueMicrotask：排進 microtask queue', '直接把回呼排進 microtask queue，排在前面那一個後面（先進先出）。', 'micro'],
  await: () => ['await：函式先暫停', '`await` 的 Promise 已經完成，後面的程式也不會接著跑：它被排進 microtask queue，函式先離開 call stack，呼叫它的地方繼續往下。', 'micro'],
  dom: (op) => ['改 DOM：畫面還沒變', `DOM 已經是「${op.dom}」，但瀏覽器要等這個 task 和 microtask 都跑完、到了渲染時機才會畫出來。`, 'screen'],
}

const EXAMPLES = {
  basic: () => ({
    file: 'order.js',
    code: `console.log('1 同步')
setTimeout(() => {
  console.log('5 timeout A')
  Promise.resolve().then(() => console.log('6 A 的 then'))
}, 0)
setTimeout(() => console.log('7 timeout B'), 0)
Promise.resolve().then(() => console.log('3 then'))
queueMicrotask(() => console.log('4 microtask'))
console.log('2 同步結束')`,
    start: 'script', startLabel: 'script',
    startSay: '瀏覽器把整段 `<script>` 當成一個 task，主程式放上 call stack，一行一行往下跑。',
    fns: {
      script: { name: '主程式（script）', ops: [{ l: 1, log: '1 同步' }, { l: 2, task: 'ta' }, { l: 6, task: 'tb', say: '第二個 `setTimeout` 排在 A 後面。兩個都是 0 ms，仍要等目前的程式跑完、microtask 清空才輪到。' }, { l: 7, micro: 'p1', via: 'then' }, { l: 8, micro: 'm1', via: 'queueMicrotask' }, { l: 9, log: '2 同步結束' }] },
      ta: { name: 'timeout A', ops: [{ l: 3, log: '5 timeout A' }, { l: 4, micro: 'p2', via: 'then', say: 'A 的回呼裡又排了一個 `then`。它在 A 結束後馬上執行，比 timeout B 早：每個 task 跑完都先清 microtask。' }] },
      tb: { name: 'timeout B', ops: [{ l: 6, log: '7 timeout B' }] },
      p1: { name: 'then 回呼', ops: [{ l: 7, log: '3 then' }] },
      m1: { name: 'queueMicrotask 回呼', ops: [{ l: 8, log: '4 microtask' }] },
      p2: { name: 'A 的 then', ops: [{ l: 4, log: '6 A 的 then' }] },
    },
    endSay: 'Console 的順序是 1 到 7：同步的程式先跑完，接著清空 microtask（3、4），然後才輪到 task。A 裡排的 `then`（6）在 A 結束後馬上執行，比 B（7）早。',
  }),
  await: () => ({
    file: 'board.js',
    code: `const fetchBoard = () => Promise.resolve('101 診 12 號')
async function loadBoard() {
  console.log('B loadBoard 開始')
  const board = await fetchBoard()
  console.log('D await 之後：' + board)
}
console.log('A 同步開始')
setTimeout(() => console.log('F setTimeout'), 0)
loadBoard()
Promise.resolve().then(() => console.log('E then'))
console.log('C 同步結束')`,
    start: 'script', startLabel: 'script',
    startSay: '整段 `<script>` 是一個 task。前兩行只是宣告函式，從第 7 行開始執行。',
    fns: {
      script: { name: '主程式（script）', ops: [{ l: 7, log: 'A 同步開始' }, { l: 8, task: 'tf' }, { l: 9, call: 'load' }, { l: 10, micro: 'pe', via: 'then', say: 'loadBoard 已經離開 call stack，主程式繼續往下。這個 `then` 排在 loadBoard 的後半段後面。' }, { l: 11, log: 'C 同步結束' }] },
      load: { name: 'loadBoard()', ops: [{ l: 3, log: 'B loadBoard 開始', say: 'async 函式在第一個 `await` 之前是同步執行的：Console 印出「B loadBoard 開始」。' }, { l: 4, await: 'cont' }] },
      cont: { name: 'loadBoard（await 之後）', ops: [{ l: 5, log: 'D await 之後：101 診 12 號' }] },
      pe: { name: 'then 回呼', ops: [{ l: 10, log: 'E then' }] },
      tf: { name: 'setTimeout 回呼', ops: [{ l: 8, log: 'F setTimeout' }] },
    },
    endSay: '順序是 A、B、C、D、E、F。`await` 之前的程式同步執行；`await` 之後的程式是 microtask，比後來才排進去的 `then`（E）早，也比 `setTimeout`（F）早。',
  }),
  longtask: ({ yieldFirst, ms }) => ({
    file: 'report.js',
    dom: '待命',
    code: yieldFirst ? `button.addEventListener('click', async () => {
  status.textContent = '處理中…'
  // 先讓瀏覽器畫一次：等下一個 frame，再排一個 task
  await new Promise((r) =>
    requestAnimationFrame(() => setTimeout(r)))
  buildReport()           // 同步迴圈，約 ${ms} ms
  status.textContent = '完成'
})` : `button.addEventListener('click', () => {
  status.textContent = '處理中…'
  buildReport()           // 同步迴圈，約 ${ms} ms
  status.textContent = '完成'
})`,
    start: 'click', startLabel: 'click',
    startSay: '使用者按下「產生月報」：click 事件的處理函式是一個 task，放上 call stack。',
    fns: yieldFirst ? {
      click: { name: 'click 處理函式', ops: [{ l: 2, dom: '處理中…' }, { l: 4, raf: 'rafcb', ends: true, title: 'await：等下一次渲染', say: '`requestAnimationFrame` 的回呼排到下一次渲染之前執行。`await` 一個還沒完成的 Promise，函式先離開 call stack，這個 click task 就結束了。' }] },
      rafcb: { name: 'rAF 回呼', ops: [{ task: 'resume' }] },
      resume: { name: 'setTimeout 回呼：r()', ops: [{ l: 5, micro: 'cont', via: 'resolve', title: 'r()：Promise 完成', say: '計時器到了，`r()` 讓 Promise 完成，`await` 之後的程式排進 microtask queue。' }] },
      cont: { name: '處理函式（await 之後）', ops: [{ call: 'build' }, { l: 7, dom: '完成' }] },
      build: { name: 'buildReport()', ops: [{ l: 6, busy: true }] },
    } : {
      click: { name: 'click 處理函式', ops: [{ l: 2, dom: '處理中…' }, { call: 'build' }, { l: 4, dom: '完成' }] },
      build: { name: 'buildReport()', ops: [{ l: 3, busy: true }] },
    },
    endSay: yieldFirst
      ? `「處理中…」在計算開始前畫出來了，代價是多等一個 frame。迴圈本身還是 ${ms} ms 的一段，這段時間點擊與輸入照樣在排隊；要讓計算期間也能回應，再把迴圈切段讓出主執行緒，或搬進 Web Worker。`
      : '畫面從「待命」直接跳到「完成」：「處理中…」改進了 DOM，一次也沒畫出來。改 DOM 和長迴圈在同一個 task 裡，瀏覽器沒有機會在中間渲染。打開「先讓出主執行緒」比較。',
  }),
  vue: () => ({
    file: 'Counter.vue（script 節錄）',
    dom: '0',
    code: `const count = ref(0)
async function addThree() {   // 按鈕的 @click
  count.value++   // Vue 排一次 DOM 更新
  count.value++
  count.value++
  console.log('DOM：' + el.textContent)
  await nextTick()
  console.log('nextTick 之後：' + el.textContent)
}`,
    start: 'click', startLabel: 'click',
    startSay: '按下按鈕：`addThree` 是 click 事件的處理函式，一個 task。',
    fns: {
      click: { name: 'addThree()', ops: [
        { l: 3, micro: 'flush', via: 'vue', title: 'count.value++：Vue 排一次更新', say: '`count` 變成 1。Vue 不會馬上改 DOM，先排一個 microtask，等這一輪的變更都收集好再一次更新。' },
        { l: 4, title: 'count.value++：已經排過了', say: '`count` 變成 2。更新已經在 microtask queue 裡，不會再排第二次。' },
        { l: 5, title: 'count.value++', say: '`count` 變成 3，一樣不再排。DOM 上的數字還是 0。' },
        { l: 6, log: 'DOM：0', say: '同一個 task 裡讀 DOM，拿到的還是 0：Vue 的更新還在 microtask queue 裡等。' },
        { l: 7, await: 'cont', later: true, title: 'await nextTick()', say: '`nextTick()` 的 Promise 要等 Vue 這一輪的更新跑完才完成。`addThree` 先離開 call stack，後半段到那時候才排進 microtask queue。' },
      ] },
      flush: { name: 'Vue：更新 DOM', ops: [
        { dom: '3', title: 'Vue 更新 DOM', say: 'Vue 執行排好的更新：重新渲染，DOM 的數字一次從 0 變成 3，中間的 1、2 不會出現。`onUpdated` 在這時候執行。' },
        { micro: 'cont', via: 'resolve', title: 'nextTick 的 Promise 完成', say: '這一輪的更新跑完，`nextTick()` 的 Promise 完成，`addThree` 的後半段排進 microtask queue。' },
      ] },
      cont: { name: 'addThree（await 之後）', ops: [{ l: 8, log: 'nextTick 之後：3', say: 'DOM 已經是 3，這裡讀得到新的值；畫面還沒畫，要等 microtask 全部清空。' }] },
    },
    endSay: 'Console 先印 0 再印 3，畫面只畫一次，直接顯示 3。改完資料要讀新的 DOM 用 `await nextTick()`；`nextTick` 之後 DOM 是新的，但畫到畫面上還要等 microtask 都跑完。',
  }),
}
const EX_OPTIONS = [
  { value: 'basic', label: '基本順序' },
  { value: 'await', label: 'await' },
  { value: 'longtask', label: '長任務' },
  { value: 'vue', label: 'Vue nextTick' },
]

const join = (a, b) => (a ? `${a} ${b}` : b)

function simulate(p, ms) {
  let uid = 0
  const S = { stack: [], micro: [], tasks: [], rafs: [], logs: [], dom: p.dom ?? null, painted: p.dom ?? null, strip: [] }
  const steps = []
  const entry = (id) => ({ k: ++uid, id, name: p.fns[id].name })
  const snap = (line, title, text, hot) => steps.push({
    line, title, text, hot,
    stack: [...S.stack], micro: [...S.micro], tasks: [...S.tasks], rafs: [...S.rafs], logs: [...S.logs],
    dom: S.dom, painted: S.painted, strip: S.strip.map((x) => ({ ...x })),
  })
  const apply = (op) => {
    let r = ['', '', 'stack']
    if (op.log) { S.logs.push(op.log); r = T.log(op) }
    else if (op.task) { S.tasks.push(entry(op.task)); r = T.task() }
    else if (op.micro) { S.micro.push(entry(op.micro)); r = T[op.via]?.() ?? ['', '', 'micro'] }
    else if (op.await) { if (!op.later) S.micro.push(entry(op.await)); r = T.await() }
    else if (op.raf) { S.rafs.push(entry(op.raf)); r = ['', '', 'screen'] }
    else if (op.dom) { S.dom = op.dom; r = T.dom(op) }
    else if (op.busy) {
      const cur = [...S.strip].reverse().find((x) => x.kind === 'task' || x.kind === 'micro')
      if (cur) cur.ms = ms
      const frames = Math.floor(ms / 16.7)
      r = [`同步迴圈跑了 ${ms} ms`, `\`buildReport()\` 的迴圈佔住主執行緒 ${ms} ms：這段時間沒有任何 task、microtask 或渲染能插進來，點按鈕、打字都在排隊。60 Hz 的螢幕這段時間少畫了約 ${frames} 個 frame。${ms > 50 ? '超過 50 ms，Performance 分頁會把這個 task 標成 long task。' : '不到 50 ms，還不算 long task。'}`, 'stack']
    }
    return [op.title ?? r[0], op.say ?? r[1], r[2]]
  }
  const runFn = (id, lead, leadTitle) => {
    S.stack.push(entry(id))
    for (const op of p.fns[id].ops) {
      if (op.call) { runFn(op.call, join(lead, `呼叫 \`${p.fns[op.call].name}\`，放上 call stack。`), leadTitle); lead = ''; leadTitle = ''; continue }
      const [title, text, hot] = apply(op)
      const suspend = op.await || op.ends   // 函式在這裡暫停、離開 call stack；後半段寫成另一個函式
      if (suspend) S.stack.pop()
      snap(op.l ?? null, leadTitle && !op.busy && !op.title ? leadTitle : title, join(lead, text), hot)
      lead = ''
      leadTitle = ''
      if (suspend) return
    }
    S.stack.pop()
  }

  S.strip.push({ kind: 'task', label: p.startLabel })
  runFn(p.start, p.startSay)
  for (let guard = 0; guard < 40; guard++) {
    let firstMicro = true
    while (S.micro.length) {
      const m = S.micro.shift()
      S.strip.push({ kind: 'micro', label: m.name })
      runFn(m.id, firstMicro ? `call stack 空了。取下一個 task 之前，先清空 microtask queue：取出「${m.name}」。` : `microtask queue 還有東西，繼續取出「${m.name}」；途中新排進的 microtask 也在這一輪跑完。`, `取出 microtask：${m.name}`)
      firstMicro = false
    }
    let rendered = false
    if (S.rafs.length || S.dom !== S.painted) {
      const parts = []
      if (S.rafs.length) {
        for (const r of S.rafs.splice(0)) { S.stack.push(r); p.fns[r.id].ops.forEach(apply); S.stack.pop() }
        parts.push('先執行 `requestAnimationFrame` 的回呼，它排了一個 `setTimeout`')
      }
      parts.push(S.dom !== S.painted ? `再算樣式、版面、繪製，畫面顯示「${S.dom}」` : '畫面沒有變更')
      S.painted = S.dom
      S.strip.push({ kind: 'render', label: '渲染' })
      snap(null, '渲染時機', `microtask queue 清空了，瀏覽器在這裡更新畫面：${parts.join('；')}。`, 'screen')
      rendered = true
    } else S.strip.push({ kind: 'idle', label: '可渲染' })
    if (!S.tasks.length) break
    const t = S.tasks.shift()
    S.strip.push({ kind: 'task', label: t.name })
    runFn(t.id, rendered ? `取出下一個 task：「${t.name}」。` : `microtask 清空了，這裡是渲染時機（這段程式沒改畫面，瀏覽器不必重畫）；接著從 task queue 取出「${t.name}」。`, `取出 task：${t.name}`)
  }
  snap(null, '全部跑完', p.endSay, 'console')
  return steps
}

export default function EventLoopLab() {
  const [exKey, setExKey] = useState('basic')
  const [yieldFirst, setYieldFirst] = useState(false)
  const [ms, setMs] = useState(300)
  const prog = useMemo(() => EXAMPLES[exKey]({ yieldFirst, ms }), [exKey, yieldFirst, ms])
  const steps = useMemo(() => simulate(prog, ms), [prog, ms])
  const player = usePlayer(steps.length, 1700)
  const idx = Math.min(player.step, steps.length - 1)
  const s = steps[idx]
  const pick = (k) => { setExKey(k); player.setStep(0) }

  return (
    <Lab accent="yellow" kicker="FRONTEND LAB" title="事件迴圈逐步執行"
         blurb="同步程式、setTimeout、Promise.then、await、queueMicrotask 一步一步執行：call stack 與兩個 queue 怎麼變、Console 依什麼順序輸出、畫面在什麼時候才更新。">
      <LabControls>
        <Seg label="範例" tinted value={exKey} onChange={pick} options={EX_OPTIONS} />
        {exKey === 'longtask' && <>
          <Toggle label="先讓出主執行緒" checked={yieldFirst} onChange={(v) => { setYieldFirst(v); player.setStep(0) }} />
          <Slider label="迴圈時間（示意）" min={20} max={1000} step={20} value={ms} onChange={setMs} format={(v) => `${v} ms`} />
        </>}
        <span className="spacer" />
        <Stepper step={idx} total={steps.length} onStep={player.setStep} playing={player.playing} onPlay={player.toggle} />
      </LabControls>

      <LabGrid variant="even">
        <div className="lab-stack">
          <Code lang="js" title={prog.file} highlight={s.line ? [s.line] : []}>{prog.code}</Code>
          <LabExplain title={s.title}>
            <p dangerouslySetInnerHTML={{ __html: md(s.text) }} />
          </LabExplain>
        </div>
        <div className="lab-stack">
          <LabStage label="call stack、microtask queue、task queue 與 Console">
            <div className="elb-grid">
              <Box title="call stack" hot={s.hot === 'stack'} empty="空">
                {[...s.stack].reverse().map((f) => <span key={f.k} className="elb-chip f">{f.name}</span>)}
              </Box>
              <Box title="microtask queue" hot={s.hot === 'micro'} empty="空">
                {s.micro.map((m) => <span key={m.k} className="elb-chip m">{m.name}</span>)}
              </Box>
              <Box title="task queue" hot={s.hot === 'task'} empty="空">
                {s.tasks.map((t) => <span key={t.k} className="elb-chip t">{t.name}</span>)}
              </Box>
              <Box title="Console" hot={s.hot === 'console'} empty="還沒有輸出" mono>
                {s.logs.map((l, i) => <span key={i} className={`elb-log${i === s.logs.length - 1 && s.hot === 'console' ? ' new' : ''}`}>{l}</span>)}
              </Box>
            </div>
            {prog.dom != null && (
              <div className={`elb-screen${s.hot === 'screen' ? ' hot' : ''}`}>
                <span className="elb-cap">畫面上</span>
                <b className="elb-painted">{s.painted}</b>
                {s.dom !== s.painted && <span className="elb-pending">DOM 已經是「{s.dom}」，還沒畫出來</span>}
                {s.rafs.map((r) => <span key={r.k} className="elb-chip r">下次渲染前執行：{r.name}</span>)}
              </div>
            )}
            <div className="elb-strip" role="img" aria-label={`主執行緒的時間線：${s.strip.map((x) => x.label).join('、')}`}>
              <span className="elb-cap">主執行緒的時間線</span>
              <div className="elb-row">
                {s.strip.map((x, i) => (
                  <span key={i} className={`elb-seg ${x.kind}${x.ms > 50 ? ' long' : ''}`}>
                    {x.label}{x.ms ? `・${x.ms} ms` : ''}
                  </span>
                ))}
              </div>
            </div>
          </LabStage>
          <Caption>模擬：步驟依 HTML 規範的事件迴圈排出，時間是示意。實際的渲染大約每 16.7 ms（60 Hz）有一次機會，沒有變更時瀏覽器會跳過。</Caption>
          <Callout title="工作上什麼時候用">看到 AI 用 <code>setTimeout(…, 0)</code> 或加延遲修「畫面沒更新」「讀到舊的 DOM」，先說清楚要等哪個時機：DOM 更新用 <code>nextTick</code>，要先畫出來用 <code>requestAnimationFrame</code> 接 <code>setTimeout</code>。按了沒反應、打字卡頓時，用 Performance 分頁找超過 50 ms 的 task，再決定切段、讓出主執行緒或搬進 Web Worker。</Callout>
        </div>
      </LabGrid>

      <style>{`
        .elb-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
        .elb-box { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 8px 10px 10px; min-height: 92px; transition: border-color 0.25s ease, box-shadow 0.25s ease; }
        .elb-box.hot { border-color: var(--line); box-shadow: 3px 3px 0 var(--shade); }
        .elb-cap { display: block; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.06em; color: var(--ink-3); margin-bottom: 6px; }
        .elb-items { display: flex; flex-direction: column; gap: 5px; align-items: flex-start; }
        .elb-items.mono { font-family: var(--mono); font-size: 0.78rem; gap: 2px; }
        .elb-empty { font-size: 0.78rem; color: var(--ink-3); }
        .elb-chip { display: inline-block; max-width: 100%; padding: 2px 8px; border: 1.5px solid var(--line); border-radius: var(--radius); color: var(--on-sticker); font-size: 0.78rem; line-height: 1.4; overflow-wrap: anywhere; animation: elb-pop 0.3s ease-out both; }
        .elb-chip.f { background: var(--st-violet); }
        .elb-chip.m { background: var(--st-blue); }
        .elb-chip.t { background: var(--st-yellow); }
        .elb-chip.r { background: var(--st-mint); }
        .elb-log { color: var(--ink-1); overflow-wrap: anywhere; animation: elb-pop 0.3s ease-out both; }
        .elb-log.new { font-weight: 700; }
        .elb-screen { margin-top: 10px; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 8px 10px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; transition: border-color 0.25s ease, box-shadow 0.25s ease; }
        .elb-screen.hot { border-color: var(--line); box-shadow: 3px 3px 0 var(--shade); }
        .elb-screen .elb-cap { margin: 0; }
        .elb-painted { font-family: var(--serif); font-size: 1.25rem; color: var(--ink-1); }
        .elb-pending { font-size: 0.78rem; color: var(--critical); }
        .elb-strip { margin-top: 10px; }
        .elb-row { display: flex; flex-wrap: wrap; gap: 4px; }
        .elb-seg { font-size: 0.72rem; padding: 2px 6px; border: 1.5px solid var(--line); border-radius: var(--radius); color: var(--on-sticker); animation: elb-pop 0.3s ease-out both; }
        .elb-seg.task { background: var(--st-yellow); }
        .elb-seg.micro { background: var(--st-blue); }
        .elb-seg.render { background: var(--st-mint); }
        .elb-seg.long { background: var(--st-red); }
        .elb-seg.idle { border-style: dashed; border-color: var(--ink-3); color: var(--ink-3); background: transparent; }
        @keyframes elb-pop { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .elb-chip, .elb-log, .elb-seg { animation: none; } .elb-box, .elb-screen { transition: none; } }
      `}</style>
    </Lab>
  )
}

function Box({ title, hot, empty, mono, children }) {
  const has = React.Children.toArray(children).flat().length > 0
  return (
    <div className={`elb-box${hot ? ' hot' : ''}`}>
      <span className="elb-cap">{title}</span>
      <div className={`elb-items${mono ? ' mono' : ''}`}>
        {has ? children : <span className="elb-empty">{empty}</span>}
      </div>
    </div>
  )
}

function md(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/`([^`]+)`/g, '<code>$1</code>')
}

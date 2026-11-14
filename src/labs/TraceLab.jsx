import React, { useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Callout, Stats, Stat, LineChart, Caption, useWidth, fmtN, fmtMs } from './ui.jsx'

/* ============================================================
   可觀測性：用 trace id 把 metrics、trace、log 串起來
   - 情境：一個「建立掛號」請求：api-gateway → appointment-svc → PostgreSQL、notify-svc（全部虛構）
   - metrics：30 分鐘的 p95 延遲與錯誤率；異常情境在 10:17–10:20 有尖峰，點圖表選時間
   - trace：選到尖峰時間就顯示那條慢的 trace，否則顯示一條正常的；瀑布圖每個 span 一條橫條
   - log：結構化 JSON；用 trace id 過濾後，沒帶這個 trace id 的行會掉出來
   trace id 實際是 32 個十六進位字元，這裡只顯示 8 個；所有數字都是示意
   ============================================================ */

const SVC = {
  api: { name: 'api-gateway', color: 'var(--c-blue)' },
  appt: { name: 'appointment-svc', color: 'var(--c-violet)' },
  db: { name: 'PostgreSQL', color: 'var(--c-orange)' },
  notify: { name: 'notify-svc', color: 'var(--c-aqua)' },
}
const MIN = 30, SPIKE = [17, 20], PEAK = 18
const CW = 320, CL = 40          // 折線圖的 viewBox 寬與左邊界（點圖表換算時間用）
const sp = (id, p, svc, name, s, d, more = {}) => ({ id, p, svc, name, s, d, ...more })
/* log：[發生在第幾 ms, 等級, 服務, 訊息, trace（T 這條 / O 斷掉後的另一條 / X 別的請求 / null 沒有）, 對應的 span, 是否屬於這個請求, 其他欄位] */
const BG = [41, 'INFO', 'api', 'request received', 'X', null, false, { path: 'GET /doctors' }]
const JOB = [77, 'INFO', 'appt', 'schedule cache refreshed', null, null, false, { job: 'refresh-schedule' }]

const TRACES = {
  normal: {
    id: '7d3ab1c4',
    spans: [sp('a', null, 'api', 'POST /appointments', 0, 120), sp('b', 'a', 'appt', '建立掛號', 8, 104), sp('c', 'b', 'db', 'SELECT slots', 14, 12, { note: '回傳 1 列' }),
      sp('d', 'b', 'db', 'INSERT appointments', 30, 18), sp('e', 'b', 'appt', '呼叫 notify-svc', 54, 50), sp('f', 'e', 'notify', 'POST /notify', 58, 42), sp('g', 'f', 'notify', '送出簡訊', 62, 34)],
    logs: [[0, 'INFO', 'api', 'request received', 'T', 'a', true, { path: 'POST /appointments' }], [20, 'INFO', 'appt', 'slot available', 'T', 'c', true, { slot_id: 318 }], BG,
      [49, 'INFO', 'appt', 'appointment created', 'T', 'd', true, { appointment_id: 5012 }], JOB, [97, 'INFO', 'notify', 'sms sent', 'T', 'g', true, { channel: 'sms' }],
      [120, 'INFO', 'api', 'request finished', 'T', 'a', true, { status: 201, duration_ms: 120 }]],
  },
  slowdb: {
    id: 'a41c9e07',
    spans: [sp('a', null, 'api', 'POST /appointments', 0, 1948), sp('b', 'a', 'appt', '建立掛號', 8, 1932), sp('c', 'b', 'db', 'SELECT slots', 14, 1840, { note: '掃描 48 萬列，回傳 1 列' }),
      sp('d', 'b', 'db', 'INSERT appointments', 1858, 18), sp('e', 'b', 'appt', '呼叫 notify-svc', 1882, 50), sp('f', 'e', 'notify', 'POST /notify', 1886, 42), sp('g', 'f', 'notify', '送出簡訊', 1890, 34)],
    logs: [[0, 'INFO', 'api', 'request received', 'T', 'a', true, { path: 'POST /appointments' }], BG, JOB,
      [1855, 'WARN', 'appt', 'slow query', 'T', 'c', true, { query: 'SELECT slots', duration_ms: 1840, rows_scanned: 480000 }],
      [1856, 'LOG', 'db', 'duration: 1840.2 ms  statement: SELECT … FROM slots WHERE …', null, 'c', true, {}],
      [1877, 'INFO', 'appt', 'appointment created', 'T', 'd', true, { appointment_id: 5013 }], [1925, 'INFO', 'notify', 'sms sent', 'T', 'g', true, { channel: 'sms' }],
      [1948, 'INFO', 'api', 'request finished', 'T', 'a', true, { status: 201, duration_ms: 1948 }]],
  },
  retry: {
    id: 'c58e02d1',
    spans: [sp('a', null, 'api', 'POST /appointments', 0, 2262), sp('b', 'a', 'appt', '建立掛號', 8, 2246), sp('c', 'b', 'db', 'SELECT slots', 14, 12), sp('d', 'b', 'db', 'INSERT appointments', 30, 18),
      sp('e1', 'b', 'appt', '呼叫 notify-svc（第 1 次）', 54, 1000, { err: '逾時' }), sp('f1', 'e1', 'notify', 'POST /notify', 58, 1090, { note: '等簡訊閘道回應；做完時呼叫端已經放棄' }),
      sp('e2', 'b', 'appt', '呼叫 notify-svc（第 2 次）', 1104, 1000, { err: '逾時' }), sp('f2', 'e2', 'notify', 'POST /notify', 1108, 1090, { note: '等簡訊閘道回應；做完時呼叫端已經放棄' }),
      sp('e3', 'b', 'appt', '呼叫 notify-svc（第 3 次）', 2204, 48), sp('f3', 'e3', 'notify', 'POST /notify', 2208, 40)],
    logs: [[0, 'INFO', 'api', 'request received', 'T', 'a', true, { path: 'POST /appointments' }], BG, [49, 'INFO', 'appt', 'appointment created', 'T', 'd', true, { appointment_id: 5014 }], JOB,
      [1054, 'WARN', 'appt', 'notify timeout, retrying', 'T', 'e1', true, { attempt: 1, timeout_ms: 1000 }], [1148, 'WARN', 'notify', 'sms gateway slow', 'T', 'f1', true, { duration_ms: 1090 }],
      [2104, 'WARN', 'appt', 'notify timeout, retrying', 'T', 'e2', true, { attempt: 2, timeout_ms: 1000 }], [2198, 'WARN', 'notify', 'sms gateway slow', 'T', 'f2', true, { duration_ms: 1090 }],
      [2252, 'INFO', 'appt', 'notify ok', 'T', 'e3', true, { attempt: 3 }], [2262, 'INFO', 'api', 'request finished', 'T', 'a', true, { status: 201, duration_ms: 2262 }]],
  },
  broken: {
    id: 'b7f03a55', orphanId: 'e90f22b7',
    spans: [sp('a', null, 'api', 'POST /appointments', 0, 1512), sp('b', 'a', 'appt', '建立掛號', 8, 1496), sp('c', 'b', 'db', 'SELECT slots', 14, 12), sp('d', 'b', 'db', 'INSERT appointments', 30, 18),
      sp('e', 'b', 'appt', '呼叫 notify-svc', 54, 1440, { note: '送出的請求沒有帶 traceparent 標頭' })],
    orphan: [sp('f', null, 'notify', 'POST /notify', 58, 1432, { note: '沒收到 traceparent，自己開了一條新 trace' }), sp('g', 'f', 'notify', '送出簡訊', 62, 1420, { note: '等簡訊閘道回應' })],
    logs: [[0, 'INFO', 'api', 'request received', 'T', 'a', true, { path: 'POST /appointments' }], BG, [49, 'INFO', 'appt', 'appointment created', 'T', 'd', true, { appointment_id: 5015 }],
      [58, 'INFO', 'notify', 'notify request received', 'O', 'f', true, { channel: 'sms' }], JOB, [1482, 'WARN', 'notify', 'sms gateway slow', 'O', 'g', true, { duration_ms: 1420 }],
      [1490, 'INFO', 'notify', 'sms sent', 'O', 'g', true, { channel: 'sms' }], [1512, 'INFO', 'api', 'request finished', 'T', 'a', true, { status: 201, duration_ms: 1512 }]],
  },
}
const SCENES = [['normal', '正常'], ['slowdb', '資料庫慢查詢'], ['retry', '通知服務逾時重試'], ['broken', '沒傳遞 trace context']]

const pad = (n, w = 2) => String(n).padStart(w, '0')
const md = (s) => s.replace(/`([^`]+)`/g, '<code>$1</code>')
const wob = (i, k) => 0.5 * Math.sin(i * 1.7 + k) + 0.5 * Math.sin(i * 0.6 + 2 * k)          // 固定的小起伏（−1…1）
const bump = (i) => (i < SPIKE[0] || i > SPIKE[1] ? 0 : i === 18 || i === 19 ? 1 : 0.45)
const end = (s) => s.s + s.d
/* 自身耗時：扣掉子 span 落在自己時間範圍內的部分 */
const selfMs = (s, all) => s.d - all.filter((c) => c.p === s.id).reduce((a, c) => a + Math.max(0, Math.min(end(c), end(s)) - c.s), 0)
const depthOf = (s, all) => { let d = 0, p = s.p; while (p) { d++; p = all.find((x) => x.id === p).p } return d }

function explain(sc, hot, tr, at) {
  if (sc === 'normal') return ['正常：7 個 span，一個 trace id 串到底', [
    '「建立掛號」從 api-gateway 進來，掛號服務查號源、寫入掛號，再呼叫通知服務送簡訊。每個 span 是一段有開始與結束時間的工作，子 span 縮排在父 span 底下。',
    '這個請求的每一行 log 都帶著同一個 `trace_id`。用這個 trace id 過濾 log，就只剩這個請求的日誌；別的請求、以及沒有 trace id 的背景排程那一行都會掉出來。',
  ]]
  if (!hot) return ['metrics：p95 在 10:18 前後出現尖峰', [
    `告警從 metrics 來：p95 延遲從 150 ms 上下跳到 ${fmtMs(tr.spans[0].d)}。` + (sc === 'retry' ? '錯誤率也跟著升高。' : '錯誤率沒有動：請求變慢了，但還是成功。'),
    `metrics 是事先聚合的數字，說得出「多慢、從什麼時候開始」，說不出慢在哪一段。點圖上的尖峰，打開那個時間的 trace。目前顯示的是 10:${pad(at)} 的一條正常 trace。`,
  ]]
  return {
    slowdb: ['資料庫慢查詢：時間都花在 SELECT slots', [
      '瀑布圖一眼看得出來：1,948 ms 裡有 1,840 ms 在 `SELECT slots` 這個 span，其他幾段和平常一樣。trace 回答的是「慢在哪一段」。',
      '點那個 span，再用 trace id 過濾 log：掛號服務的 `slow query` 那一行帶著同一個 trace id，寫了掃描的列數。資料庫自己輸出的那一行沒有 trace id，過濾後就掉出來了。',
    ]],
    retry: ['通知服務逾時重試：兩次各等滿 1 秒', [
      '掛號服務呼叫通知服務，等到 1,000 ms 逾時就重試，第 3 次才成功：總耗時 2.3 秒幾乎都花在等。重試全部失敗的請求會回錯誤，所以這段時間錯誤率也升高。',
      '通知服務那邊的 span 比逾時還長：呼叫端放棄的時候，它還在處理。每一行 log 都帶著 trace id，過濾後可以照時間順序看完整個重試過程。',
    ]],
    broken: ['鏈斷掉：呼叫通知服務時沒有帶 traceparent', [
      '瀑布圖只到「呼叫 notify-svc」為止：1,440 ms 花在那裡，裡面發生什麼看不到。通知服務沒收到 `traceparent` 標頭，只好自己開一條新的 trace，變成兩個不相干的 trace。',
      '用 trace id 過濾 log，通知服務的三行都掉出來，因為它們帶的是另一個 trace id。跨服務時 trace 的上下文靠 `traceparent` 標頭傳遞：呼叫下游的那一段要把它帶上，經過訊息佇列時要放進訊息的 metadata。',
    ]],
  }[sc]
}

export default function TraceLab() {
  const [sc, setSc] = useState('slowdb')
  const [at, setAt] = useState(6)        // 圖表上選的時間（10:00 起第幾分鐘）
  const [sel, setSel] = useState(null)   // 選中的 span id
  const [q, setQ] = useState('')         // log 過濾用的 trace id
  const jump = (m) => { setAt(m); setSel(null); setQ('') }
  const hot = sc !== 'normal' && at >= SPIKE[0] && at <= SPIKE[1]
  const tr = hot ? TRACES[sc] : TRACES.normal
  const all = [...tr.spans, ...(tr.orphan || [])]
  const total = tr.spans[0].d
  const slow = tr.spans.reduce((a, s) => (selfMs(s, tr.spans) > selfMs(a, tr.spans) ? s : a))
  const picked = all.find((s) => s.id === sel) || null

  const peak = { normal: 0, slowdb: 1948, retry: 2262, broken: 1512 }[sc]
  const p95 = Array.from({ length: MIN + 1 }, (_, i) => 150 + 18 * wob(i, 1) + (peak ? (peak - 150) * bump(i) : 0))
  const errs = Array.from({ length: MIN + 1 }, (_, i) => 0.3 + 0.12 * wob(i, 4) + (sc === 'retry' ? 3.6 * bump(i) : 0))
  const onChart = (e) => {
    const svg = e.currentTarget.querySelector('svg')
    if (!svg) return
    const b = svg.getBoundingClientRect()   // 換算回 LineChart 的座標：viewBox 寬 CW、左邊界 CL、右邊界 8
    jump(Math.max(0, Math.min(MIN, Math.round(((((e.clientX - b.left) / b.width) * CW - CL) / (CW - CL - 8)) * MIN))))
  }

  const tidOf = (k) => (k === 'T' ? tr.id : k === 'O' ? tr.orphanId : k === 'X' ? '19e6c0aa' : null)
  const logs = tr.logs.map(([ms, level, svc, msg, k, span, mine, extra], i) => {
    const tid = tidOf(k), ts = `2026-11-09T02:${pad(at)}:${pad(40 + Math.floor(ms / 1000))}.${pad(ms % 1000, 3)}Z`
    const json = JSON.stringify({ ts, level, service: SVC[svc].name, msg, ...(tid ? { trace_id: tid } : {}), ...extra })
    return { i, tid, span, mine, json }
  })
  const needle = q.trim().toLowerCase()
  const keep = logs.filter((l) => !needle || (l.tid && l.tid.includes(needle)))
  const drop = logs.filter((l) => !keep.includes(l))
  const mine = logs.filter((l) => l.mine), tagged = mine.filter((l) => l.tid === tr.id)
  const why = (l) => (!l.tid ? '沒有 trace_id' : l.mine ? '同一個請求，但 trace id 不同' : '別的請求')
  const [title, paras] = explain(sc, hot, TRACES[sc], at)
  const line = (l, dropped) => {
    const [head, tail] = l.tid ? l.json.split(`"trace_id":"${l.tid}"`) : [l.json, '']
    return (
      <li key={l.i} className={`${dropped ? 'drop' : ''}${dropped && l.mine ? ' lost' : ''}${!dropped && sel && l.span === sel ? ' hit' : ''}`}>
        {dropped && <span className="trc-why">{why(l)}</span>}
        <code>{head}{l.tid && <b className={l.tid === tr.id ? 'tid' : 'tid other'}>"trace_id":"{l.tid}"</b>}{tail}</code>
      </li>
    )
  }

  return (
    <Lab accent="magenta" className="trc-lab" kicker="OBSERVABILITY LAB" title="可觀測性：用 trace id 把 metrics、trace、log 串起來"
         blurb="一個「建立掛號」請求經過 API、掛號服務、資料庫與通知服務：從 metrics 的尖峰找到慢的 trace 與慢的 span，再用 trace id 撈出同一個請求的 log；沒傳遞 trace context 時這條鏈會斷掉。">
      <LabControls>
        <Seg label="情境" tinted value={sc} onChange={(v) => { setSc(v); jump(6) }} options={SCENES.map(([value, label]) => ({ value, label }))} />
      </LabControls>
      <LabControls>
        <span className="seg-label">排查順序</span>
        <button type="button" className={`btn ghost small${hot ? ' done' : ''}`} onClick={() => jump(PEAK)}>{sc === 'normal' ? '① 選 10:18 的 trace' : '① 跳到 p95 尖峰（10:18）'}</button>
        <button type="button" className={`btn ghost small${sel === slow.id ? ' done' : ''}`} onClick={() => setSel(slow.id)}>② 選最慢的 span</button>
        <button type="button" className={`btn ghost small${needle === tr.id ? ' done' : ''}`} onClick={() => setQ(tr.id)}>③ 用這個 trace id 過濾 log</button>
      </LabControls>

      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabStage label="trace 瀑布圖" caption="每個 span 一條橫條，長度是耗時，子 span 縮排在父 span 底下">
            <div className="trc-head">
              <span>trace <code>{tr.id}</code> · 10:{pad(at)} · {hot ? '尖峰期間的請求' : '正常的請求'}</span>
              <span className="trc-legend">{Object.entries(SVC).map(([k, s]) => <i key={k} style={{ '--c': s.color }}>{s.name}</i>)}</span>
            </div>
            <Waterfall tr={tr} sel={sel} onSel={setSel} />
            <SpanInfo span={picked} tr={tr} all={all} />
          </LabStage>
          <Stats min={130}>
            <Stat label="這個請求總耗時" value={fmtMs(total)} tone={total > 1000 ? 'bad' : 'ok'} note={`trace ${tr.id}`} />
            <Stat label="最慢的 span" value={slow.name.replace(/（.*）/, '')} note={`${SVC[slow.svc].name} · 自身 ${fmtN(selfMs(slow, tr.spans))} ms`} tone={total > 1000 ? 'warn' : ''} />
            <Stat label="span 數" value={tr.spans.length} unit="個" note={tr.orphan ? `另有 ${tr.orphan.length} 個在別條 trace` : '都在同一條 trace'} tone={tr.orphan ? 'bad' : ''} />
            <Stat label="有帶 trace id 的日誌" value={`${Math.round((tagged.length / mine.length) * 100)}%`} note={`這個請求 ${mine.length} 行裡的 ${tagged.length} 行`} tone={tagged.length < mine.length ? (tr.orphan ? 'bad' : 'warn') : 'ok'} />
          </Stats>
          <div className="trc-charts" title="點圖表選時間">
            <div onClick={onChart}>
              <LineChart title="p95 延遲" xMax={MIN} yMax={2400} mark={at} xTicks={[0, 9, 18, 27]} fmtX={(i) => `10:${pad(i)}`} fmtY={(v) => (v ? fmtMs(v) : '0')} width={CW} left={CL}
                         series={[{ key: 'p95', label: 'p95', color: 'var(--lab-accent)', values: p95 }]} ariaLabel={`p95 延遲隨時間變化，${peak ? '10:18 前後有尖峰' : '沒有異常'}`} />
            </div>
            <div onClick={onChart}>
              <LineChart title="錯誤率" xMax={MIN} yMax={6} mark={at} xTicks={[0, 9, 18, 27]} fmtX={(i) => `10:${pad(i)}`} fmtY={(v) => `${v}%`} width={CW} left={CL}
                         series={[{ key: 'err', label: '錯誤率', color: 'var(--critical)', values: errs }]} ariaLabel={`錯誤率隨時間變化，${sc === 'retry' ? '10:18 前後升高' : '沒有異常'}`} />
            </div>
          </div>
          <div className="trc-logs">
            <div className="trc-logbar">
              <label htmlFor="trc-q">log 面板 · trace_id =</label>
              <input id="trc-q" type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="貼上 trace id" spellCheck="false" autoComplete="off" />
              <button type="button" className="btn ghost small" onClick={() => setQ(tr.id)}>用這個 trace id 過濾</button>
              <button type="button" className="btn ghost small" onClick={() => setQ('')} disabled={!q}>清除</button>
            </div>
            <p className="trc-count">{needle ? `符合 ${keep.length} 行，掉出來 ${drop.length} 行` : `10:${pad(at)} 前後的 ${logs.length} 行，各服務、各請求混在一起`}{sel && !needle ? '；粗框 = 選中 span 的 log' : ''}</p>
            <ul>{keep.map((l) => line(l, false))}</ul>
            {needle && drop.length > 0 && <>
              <p className="trc-count">掉出來的（查不到）：</p>
              <ul>{drop.map((l) => line(l, true))}</ul>
            </>}
          </div>
          <Caption>資料全部虛構（示意）。圖表時間是台北時間，log 的 ts 是 UTC；trace id 實際是 32 個十六進位字元，這裡只顯示 8 個。</Caption>
        </div>

        <div className="lab-stack">
          <LabExplain title={title}>{paras.map((t, k) => <p key={k} dangerouslySetInnerHTML={{ __html: md(t) }} />)}</LabExplain>
          <LabExplain title="三種訊號各回答什麼問題">
            <p><strong>metrics</strong>：有多少、多快、現在正常嗎？告警從這裡來。<strong>trace</strong>：一個請求經過哪些服務、每一段花多久？定位用它。<strong>log</strong>：那一次發生了什麼、錯誤細節是什麼？</p>
            <p>三者共用同一個 trace id，才能從一個跳到另一個。看尾端要看 p95、p99：平均值會把少數很慢的請求稀釋掉。</p>
          </LabExplain>
          <Callout title="什麼時候會踩到">
            服務從一個拆成兩三個之後，第一次有人回報「掛號要轉很久」，而每個服務各自的 log 都看不出異常；新加的服務、背景 worker 或訊息佇列沒有接上 trace context，trace 在那裡斷成兩截；平均延遲沒變、p95 卻有尖峰的那個早上。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .trc-lab .btn.done { border-color: var(--lab-accent); color: var(--lab-accent); }
        .trc-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; font-size: 0.78rem; color: var(--ink-2); margin-bottom: 8px; }
        .trc-head code, .trc-info code { font-family: var(--mono); color: var(--ink-1); }
        .trc-legend { display: inline-flex; flex-wrap: wrap; gap: 4px 10px; color: var(--ink-3); }
        .trc-legend i { font-style: normal; display: inline-flex; align-items: center; gap: 4px; }
        .trc-legend i::before { content: ''; width: 10px; height: 10px; border-radius: 2px; background: var(--c); }
        .trc-svg { width: 100%; }
        .trc-svg .row { cursor: pointer; }
        .trc-svg .row .bg { fill: transparent; transition: fill 0.2s ease; }
        .trc-svg .row:hover .bg, .trc-svg .row:focus-visible .bg { fill: color-mix(in srgb, var(--ink-3) 10%, transparent); }
        .trc-svg .row.on .bg { fill: color-mix(in srgb, var(--lab-accent) 14%, transparent); }
        .trc-svg .row { outline: none; }
        .trc-svg .trc-bar { fill: color-mix(in srgb, var(--c) 55%, var(--surface-1)); stroke: var(--c); stroke-width: 1; transition: x 0.4s ease, width 0.4s ease; }
        .trc-svg .row.err .trc-bar { stroke: var(--critical); stroke-width: 2; stroke-dasharray: 4 2; }
        .trc-svg .row.orphan { opacity: 0.8; }
        .trc-svg .nm { font-family: var(--mono); font-size: 11px; fill: var(--ink-1); }
        .trc-svg .row.on .nm { font-weight: 700; }
        .trc-svg .ms { font-family: var(--mono); font-size: 10.5px; fill: var(--ink-2); }
        .trc-svg .row.err .ms, .trc-svg .gap-t { fill: var(--critical); font-weight: 700; }
        .trc-svg .gap-t { font-family: var(--sans); font-size: 11px; }
        .trc-svg .trc-grid { stroke: var(--hairline); stroke-width: 1; }
        .trc-svg .ghost { fill: none; stroke: var(--critical); stroke-width: 1.2; stroke-dasharray: 4 3; }
        .trc-info { margin-top: 10px; padding: 8px 12px; border: 1px solid var(--hairline); border-left: 3px solid var(--lab-accent); border-radius: var(--radius); background: var(--surface-1); font-size: 0.8rem; color: var(--ink-2); }
        .trc-info dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 4px 14px; margin: 0; }
        .trc-info dt { font-size: 0.7rem; color: var(--ink-3); }
        .trc-info dd { margin: 0; color: var(--ink-1); overflow-wrap: anywhere; }
        .trc-charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; }
        .trc-charts .lab-chart svg { cursor: pointer; }
        .trc-logs { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 10px 12px; min-width: 0; }
        .trc-logbar { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; font-size: 0.78rem; font-weight: 700; color: var(--ink-2); }
        .trc-logbar input { flex: 1 1 110px; min-width: 0; width: 110px; font-family: var(--mono); font-size: 0.8rem; padding: 5px 8px; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--page); color: var(--ink-1); }
        .trc-count { font-size: 0.74rem; color: var(--ink-3); margin: 8px 0 4px; }
        .trc-logs ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; }
        .trc-logs li { border-left: 3px solid var(--hairline); padding: 3px 8px; min-width: 0; line-height: 1.45; font-size: 0.7rem; }
        .trc-logs li code { display: block; font-family: var(--mono); font-size: inherit; line-height: inherit; color: var(--ink-2); overflow-wrap: anywhere; word-break: break-all; }
        .trc-logs li.hit { border-left-color: var(--lab-accent); background: color-mix(in srgb, var(--lab-accent) 9%, transparent); box-shadow: inset 0 0 0 1px var(--lab-accent); }
        .trc-logs .tid { color: var(--lab-accent); font-weight: 700; }
        .trc-logs .tid.other { color: var(--ink-3); }
        .trc-logs li.drop { opacity: 0.6; }
        .trc-logs li.lost { opacity: 1; border-left-color: var(--critical); }
        .trc-logs .trc-why { display: block; font-size: 0.7rem; font-weight: 700; color: var(--ink-3); }
        .trc-logs li.lost .trc-why { color: var(--critical); }
        @media (prefers-reduced-motion: reduce) { .trc-svg .trc-bar, .trc-svg .row .bg { transition: none; } }
      `}</style>
    </Lab>
  )
}

/* 瀑布圖：寬版左邊是名稱（依父子縮排）、右邊是時間軸；窄版名稱放在橫條上方，字級不縮 */
function Waterfall({ tr, sel, onSel }) {
  const ref = useRef(null)
  const W = Math.max(300, useWidth(ref, 640))
  const narrow = W < 520
  const main = tr.spans.map((s) => ({ s, depth: depthOf(s, tr.spans) }))
  const rows = tr.orphan
    ? [...main, { ghost: true }, { head: true }, ...tr.orphan.map((s) => ({ s, depth: depthOf(s, tr.orphan), orphan: true }))]
    : main
  const tMax = Math.max(...tr.spans.map(end), ...(tr.orphan || []).map(end))
  const x0 = narrow ? 6 : 214, bw = W - x0 - (narrow ? 84 : 92), RH = narrow ? 38 : 26, top = 20, ind = narrow ? 10 : 14
  const X = (ms) => x0 + (ms / tMax) * bw
  const H = top + rows.length * RH + 4
  const g = tr.orphan && { from: tr.orphan[0].s, to: end(tr.orphan[0]) }
  return (
    <div ref={ref}>
      <svg className="trc-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`trace ${tr.id} 的瀑布圖：${tr.spans.length} 個 span，總耗時 ${fmtMs(tr.spans[0].d)}${tr.orphan ? '，通知服務那一段缺漏' : ''}`}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={X(tMax * f)} x2={X(tMax * f)} y1={top - 4} y2={H} className="trc-grid" />
            <text x={X(tMax * f)} y="11" textAnchor={f === 1 ? 'end' : f ? 'middle' : 'start'} className="svg-text small">{f ? fmtMs(tMax * f) : '0 ms'}</text>
          </g>
        ))}
        {rows.map((r, k) => {
          const y = top + k * RH, by = narrow ? y + 19 : y + 7
          if (r.ghost) return (
            <g key="ghost">
              <rect x={X(g.from)} y={by} width={X(g.to) - X(g.from)} height="12" rx="2" className="ghost" />
              <text x={narrow ? 6 + 3 * ind : 8 + 3 * ind} y={narrow ? y + 13 : y + 17} className="gap-t">缺：notify-svc 的 span</text>
            </g>
          )
          if (r.head) return <text key="head" x="6" y={y + (narrow ? 26 : 18)} className="gap-t">另一條 trace {tr.orphanId}（沒有父 span，接不起來）</text>
          const { s, depth } = r, on = sel === s.id
          return (
            <g key={s.id} className={`row${on ? ' on' : ''}${s.err ? ' err' : ''}${r.orphan ? ' orphan' : ''}`} style={{ '--c': SVC[s.svc].color }}
               tabIndex={0} onClick={() => onSel(on ? null : s.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSel(on ? null : s.id) } }}>
              <title>{SVC[s.svc].name} · {s.name} · {fmtN(s.d)} ms</title>
              <rect x="0" y={y} width={W} height={RH} className="bg" />
              <text x={(narrow ? 6 : 8) + depth * ind} y={narrow ? y + 13 : y + 17} className="nm">{depth ? '└ ' : ''}{s.name}</text>
              <rect x={X(s.s)} y={by} width={Math.max(3, X(end(s)) - X(s.s))} height="12" rx="2" className="trc-bar" />
              <text x={X(end(s)) + 5} y={by + 10} className="ms">{fmtMs(s.d)}{s.err ? ` ${s.err}` : ''}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/* 選中的 span 的屬性（用白話欄位名，不照任何規範的屬性名） */
function SpanInfo({ span, tr, all }) {
  if (!span) return <div className="trc-info">點瀑布圖上的一條 span，看它的屬性。</div>
  const orphan = (tr.orphan || []).includes(span)
  const parent = all.find((s) => s.id === span.p)
  const rows = [
    ['服務', SVC[span.svc].name], ['操作', span.name], ['開始', `第 ${fmtN(span.s)} ms`],
    ['耗時', `${fmtN(span.d)} ms（自身 ${fmtN(selfMs(span, all))} ms）`], ['狀態', span.err || 'OK'],
    ['trace id', orphan ? tr.orphanId : tr.id], ['父 span', parent ? parent.name : orphan ? '無（沒收到 traceparent）' : '無（根 span）'],
    ...(span.note ? [['備註', span.note]] : []),
  ]
  return (
    <div className="trc-info" aria-live="polite">
      <dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{k === 'trace id' ? <code>{v}</code> : v}</dd></div>)}</dl>
    </div>
  )
}

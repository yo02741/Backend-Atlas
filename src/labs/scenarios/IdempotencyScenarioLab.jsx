import React, { useEffect, useMemo, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Stepper, usePlayer, Callout, Status } from '../ui.jsx'

/* 冪等情境模擬器：時序圖（客戶端 / API / DB），純示意、沒有真的後端
   ① 回應在網路上遺失後客戶端重送：DB 多幾筆、扣款幾次、客戶端最後拿到什麼
   ② 連點兩下：兩個請求幾乎同時到，誰真的執行、另一個拿到什麼 */

const KEY = '7f3a…', HASH = 'e91c…'
const C = 'client', A = 'api', D = 'db'
const X = { client: 90, api: 310, db: 530 }
const ROW = 46, TOP = 58

/* 每一步：from → to（同欄＝該欄的註記）、short（畫在圖上）、text（步驟清單）、apply（改表格與計數） */
function buildSteps(approach, exp, { wait, noUnique }) {
  const S = []
  const step = (from, to, short, text, apply = null, extra = {}) => S.push({ from, to, short, text, apply, ...extra })
  const pay = (id) => ({ id, order_id: 1001, amount: 500, status: 'captured' })
  const isHash = approach === 'hash'
  const kname = isHash ? 'request_hashes' : 'idempotency_keys'
  const kval = isHash ? HASH : KEY
  const krow = (status, response) => ({ key: kval, status, response: response || '—', expires_at: '24h 後' })
  const charge = (id, tone) => (s) => { s.payments.push(pay(id)); s.charges++ }
  const got = (...r) => (s) => { s.client.push(...r) }

  if (exp === 'retry') {
    if (approach === 'none') {
      step(C, A, 'POST /payments', 'POST /payments {order_id: 1001, amount: 500}')
      step(A, D, 'INSERT payments → p_1', 'INSERT payments → p_1，扣款 500', charge('p_1'))
      step(A, C, '201 {p_1}', '201 {payment_id: p_1}——回應在網路上遺失，客戶端等不到', null, { lost: true })
      step(C, A, '逾時，重送', '逾時 → App 自動重送同一個 POST（使用者沒有再按）')
      step(A, D, 'INSERT payments → p_2', 'INSERT payments → p_2，再扣 500', charge('p_2'), { tone: 'bad' })
      step(A, C, '201 {p_2}', '201 {payment_id: p_2}。DB 兩筆、扣了 1,000；客戶端只知道 p_2。', got('201 p_2'))
    } else if (approach === 'unique') {
      step(C, A, 'POST /payments', 'POST /payments {order_id: 1001, amount: 500}')
      step(A, D, 'INSERT (order_id=1001) ✓', 'INSERT payments (order_id=1001) → 成功 p_1，扣款 500', charge('p_1'))
      step(A, C, '201 {p_1}', '201 {payment_id: p_1}——回應在網路上遺失', null, { lost: true })
      step(C, A, '逾時，重送', '逾時 → 重送同一個 POST')
      step(A, D, 'INSERT → UNIQUE 違反', 'INSERT payments (order_id=1001) → 違反 UNIQUE；API 改查既有那筆 → p_1', null, { tone: 'ok' })
      step(A, C, '409 {existing: p_1}', '409 Conflict {existing: p_1}。沒有重複扣款，但客戶端拿到的是 409 不是 201，要懂「已經付過，去查」。', got('409 (p_1)'))
    } else {
      step(C, A, isHash ? 'POST（算 hash）' : `POST · Key ${KEY}`, isHash ? `POST /payments；API 對 user_id + body 算 hash = ${HASH}` : `POST /payments，標頭 Idempotency-Key: ${KEY}`)
      step(A, D, `INSERT ${kname} ✓`, `INSERT ${kname} (${kval}, processing) → 成功：這是新的請求`, (s) => { s.keys.push(krow('processing')) })
      step(A, D, 'INSERT payments → p_1', `INSERT payments → p_1，扣款 500；${kname} 改成 done 並存下回應`, (s) => { charge('p_1')(s); s.keys[0] = krow('done', '201 {p_1}') })
      step(A, C, '201 {p_1}', '201 {payment_id: p_1}——回應在網路上遺失', null, { lost: true })
      step(C, A, isHash ? '逾時，重送（同 body）' : '逾時，重送（同 Key）', isHash ? `逾時 → 重送同一個 body → 算出同一個 hash ${HASH}` : `逾時 → 重送，帶同一個 Idempotency-Key: ${KEY}`)
      step(A, D, `INSERT ${kname} → 撞 UNIQUE`, `INSERT ${kname} → 違反 UNIQUE → 讀出 status=done 與存好的回應`, null, { tone: 'ok' })
      step(A, C, '201 {p_1}（存的回應）', isHash ? '201 {payment_id: p_1}，原樣回存的回應。DB 一筆、扣 500。但使用者若真的要再付一筆一模一樣的款，也會被當成重送。' : '201 {payment_id: p_1}，原樣回存的回應。DB 一筆、扣 500，客戶端拿到和第一次一樣的結果。', got('201 p_1'))
    }
  } else if (approach === 'none') {
    step(C, A, 'A、B 相差 5 ms 到達', 'A、B 兩個 POST /payments 相差 5 ms 到達（連點兩下）')
    step(A, D, 'A：INSERT → p_1', 'A：INSERT payments → p_1，扣款 500', charge('p_1'))
    step(A, D, 'B：INSERT → p_2', 'B：INSERT payments → p_2，扣款 500', charge('p_2'), { tone: 'bad' })
    step(A, C, 'A：201 p_1 · B：201 p_2', 'A：201 {p_1}；B：201 {p_2}。兩筆、扣兩次，兩個回應看起來都成功。', got('201 p_1', '201 p_2'))
  } else if (approach === 'unique') {
    step(C, A, 'A、B 同時到達', 'A、B 同時到達，同一個 order_id 1001')
    step(A, D, 'A：INSERT，尚未 commit', 'A：INSERT payments (order_id=1001) → 在 UNIQUE 索引上佔了位子，交易尚未 commit')
    step(A, D, 'B：INSERT，卡住等待', 'B：INSERT payments (order_id=1001) → 撞到 A 佔的索引項，等 A 的交易結束', null, { tone: 'warn' })
    step(A, D, 'A：COMMIT → p_1', 'A：COMMIT → p_1，扣款 500', charge('p_1'))
    step(A, D, 'B：UNIQUE 違反', 'B：A 一 commit 就違反 UNIQUE → 改查既有那筆 → p_1', null, { tone: 'ok' })
    step(A, C, 'A：201 p_1 · B：409', 'A：201 {p_1}；B：409 Conflict {existing: p_1}。資料庫保證只有一筆，不管 API 有幾台。', got('201 p_1', '409 (p_1)'))
  } else if (noUnique) {
    step(C, A, 'A、B 同時到達', `A、B 同時到達，帶同一個 ${isHash ? 'hash' : 'Idempotency-Key'} ${kval}`)
    step(A, D, 'A、B：SELECT → 都沒有', `A：SELECT ${kname} WHERE key = … → 沒有；B：SELECT → 也沒有（都查在對方 INSERT 之前）`, null, { tone: 'warn' })
    step(A, D, 'A：INSERT → p_1，存 key', `A：INSERT payments → p_1，扣款 500；INSERT ${kname}`, (s) => { charge('p_1')(s); s.keys.push(krow('done', '201 {p_1}')) })
    step(A, D, 'B：INSERT → p_2，存 key', `B：INSERT payments → p_2，扣款 500；INSERT ${kname}（第二列）`, (s) => { charge('p_2')(s); s.keys.push(krow('done', '201 {p_2}')) }, { tone: 'bad' })
    step(A, C, 'A：201 p_1 · B：201 p_2', 'A：201 {p_1}；B：201 {p_2}。check-then-act 的競態：查的時候都還沒有，於是都做了。key 欄一定要 UNIQUE。', got('201 p_1', '201 p_2'))
  } else {
    step(C, A, 'A、B 同時到達', `A、B 同時到達，帶同一個 ${isHash ? 'hash' : 'Idempotency-Key'} ${kval}`)
    step(A, D, `A：INSERT ${kname} ✓`, `A：INSERT ${kname} (${kval}, processing) → 成功，A 是第一個`, (s) => { s.keys.push(krow('processing')) })
    step(A, D, `B：INSERT ${kname} 撞 UNIQUE`, `B：INSERT ${kname} → 違反 UNIQUE → 讀到 status=processing：有人正在做`, null, { tone: 'ok' })
    if (wait) step(A, A, 'B：等待 A 完成', 'B：等待 A 完成（輪詢 key 的狀態，或等 A 的交易釋放列鎖）', null, { tone: 'warn' })
    else step(A, C, 'B：409（處理中）', 'B：409 Conflict {error: "request in progress"}；客戶端稍後用同一個 key 重送', got('409 處理中'))
    step(A, D, 'A：INSERT payments → p_1', `A：INSERT payments → p_1，扣款 500；${kname} 改成 done 並存回應`, (s) => { charge('p_1')(s); s.keys[0] = krow('done', '201 {p_1}') })
    step(A, C, 'A：201 {p_1}', wait ? 'A：201 {payment_id: p_1}' : 'A：201 {payment_id: p_1}。一筆、扣一次；B 之後重送就會拿到同一份回應。', got('201 p_1'))
    if (wait) {
      step(A, D, 'B：再讀 key → done', 'B：再讀 key → status=done → 拿出存好的回應')
      step(A, C, 'B：201 {p_1}（同一結果）', 'B：201 {payment_id: p_1}，和 A 一模一樣。一筆、扣一次，兩個請求都收斂到同一個結果。', got('201 p_1'))
    }
  }
  return S
}

const TITLES = { none: '不處理：每個 POST 都是新的一筆', key: 'Idempotency-Key：重送回同一份回應', unique: 'UNIQUE 約束：資料庫擋第二筆', hash: '內容 hash：伺服器自己算 key' }
const EXPLAIN = {
  none: ['回應遺失時伺服器已經扣款，客戶端不知道；App 的自動重試就是第二筆。UI 灰掉按鈕擋得住連點，擋不住網路層的重送。'],
  key: ['客戶端替「一個意圖」產生一個 key，重試之間不換。伺服器第一步不是 SELECT 而是 INSERT：UNIQUE 讓「搶位子」本身是原子的，重送與併發都會撞上同一列。', '撞上之後看狀態：done 就原樣回存的回應；processing 代表第一個還沒做完，回 409 讓客戶端稍後再送，或等它完成再回同一份。'],
  unique: ['payments.order_id 上的 UNIQUE 由資料庫保證，不需要客戶端配合。第二筆 INSERT 在第一筆 commit 前會被擋在索引項上等待，commit 後立刻違反約束。', '代價是語意：重送拿到的是 409，不是 201；而且一張訂單只要允許分兩次付，order_id 就不再唯一，這招就不能用。'],
  hash: ['流程和 Idempotency-Key 一樣，只是 key 由伺服器對 user_id + body 算出來，舊版客戶端不用改。', '它分不出「重送」與「真的再買一次」，只能靠時間視窗猜；body 多一個時間戳、欄位順序不同，hash 就不同，去重就失效。'],
}

export default function IdempotencyScenarioLab() {
  const [approach, setApproach] = useState('none')
  const [exp, setExp] = useState('retry')
  const [wait, setWait] = useState(false)
  const [noUnique, setNoUnique] = useState(false)
  const steps = useMemo(() => buildSteps(approach, exp, { wait, noUnique }), [approach, exp, wait, noUnique])
  const { step, setStep, playing, toggle } = usePlayer(steps.length, 1100)
  useEffect(() => { setStep(0) }, [approach, exp, wait, noUnique, setStep])
  const cur = Math.min(step, steps.length - 1)
  const snap = useMemo(() => {
    const s = { payments: [], keys: [], charges: 0, client: [] }
    steps.slice(0, cur + 1).forEach((st) => st.apply && st.apply(s))
    return s
  }, [steps, cur])
  const keyed = approach === 'key' || approach === 'hash'
  const dup = Math.max(0, snap.charges - 1)
  const consistent = snap.client.length < 2 ? null : snap.client.every((r) => r === snap.client[0]) ? 'same' : snap.client.some((r) => r.includes('處理中')) ? 'retry' : snap.client.every((r) => r.includes('p_1')) ? 'p1' : 'diff'
  const done = cur === steps.length - 1

  return (
    <Lab accent="violet" kicker="SCENARIO LAB" title="同一筆付款送兩次：DB 裡會有幾筆？"
         blurb="回應在網路上遺失後客戶端重送，或使用者連點兩下。切換做法，逐步看 payments 表多出幾筆、扣款幾次、客戶端最後拿到什麼。全部示意。">
      <LabControls>
        <Seg label="做法" tinted value={approach} onChange={setApproach} options={[
          { value: 'none', label: '不處理' }, { value: 'key', label: 'Idempotency-Key' }, { value: 'unique', label: 'UNIQUE 約束' }, { value: 'hash', label: '內容 hash' },
        ]} />
        <Seg label="實驗" value={exp} onChange={setExp} options={[{ value: 'retry', label: '① 回應遺失後重送' }, { value: 'double', label: '② 連點兩下' }]} />
      </LabControls>
      <LabControls>
        {keyed && exp === 'double' && <Toggle label="第二個請求等第一個完成（否則回 409）" checked={wait && !noUnique} onChange={setWait} />}
        {keyed && exp === 'double' && <Toggle label="key 表沒有 UNIQUE（先 SELECT 再 INSERT）" checked={noUnique} onChange={setNoUnique} />}
        <span className="spacer" />
        <Stepper step={cur} total={steps.length} onStep={setStep} playing={playing} onPlay={toggle} />
      </LabControls>

      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabStage label="時序圖" caption="虛線加 ✕＝回應在網路上遺失；綠＝被擋下或回存的回應；紅＝多扣了一次。">
            <SeqSvg steps={steps} cur={cur} />
          </LabStage>
          <ol className="idm-log">
            {steps.map((s, i) => (
              <li key={i} className={i === cur ? 'cur' : i < cur ? 'past' : ''}><span className="n">{i + 1}</span>{s.text}</li>
            ))}
          </ol>
          <div className="idm-tables">
            <div className="dtable-wrap">
              <table className="dtable">
                <caption>payments</caption>
                <thead><tr><th>id</th><th>order_id</th><th>amount</th><th>status</th></tr></thead>
                <tbody>
                  {snap.payments.map((p, i) => <tr key={p.id} className={`row-in${i > 0 ? ' idm-dup' : ''}`}><td>{p.id}</td><td>{p.order_id}</td><td>{p.amount}</td><td>{p.status}</td></tr>)}
                  {!snap.payments.length && <tr><td colSpan={4} className="muted">（空）</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="dtable-wrap">
              <table className="dtable">
                <caption>{keyed ? (approach === 'hash' ? 'request_hashes' : 'idempotency_keys') : '去重表'}</caption>
                <thead><tr><th>{approach === 'hash' ? 'hash' : 'key'}</th><th>status</th><th>response</th><th>expires_at</th></tr></thead>
                <tbody>
                  {snap.keys.map((k, i) => <tr key={i} className="row-in"><td>{k.key}</td><td>{k.status}</td><td>{k.response}</td><td>{k.expires_at}</td></tr>)}
                  {!snap.keys.length && <tr><td colSpan={4} className="muted">{keyed ? '（空）' : '（這個做法沒有去重表）'}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div className="idm-stats">
            <div><span>扣款次數</span><b>{snap.charges}</b></div>
            <div><span>重複扣款</span><b className={dup ? 'bad' : ''}>{dup} 筆</b></div>
            <div><span>客戶端拿到</span><b>{snap.client.length ? snap.client.join(' · ') : '—'}</b></div>
            <div><span>結果一致嗎</span>
              {consistent === null ? <b className="muted">{done ? '只有一個回應' : '…'}</b>
                : consistent === 'same' ? <Status ok>一致</Status> : consistent === 'p1' ? <Status warn>同一筆，狀態碼不同</Status> : consistent === 'retry' ? <Status warn>一個 409，要重送</Status> : <Status>不一致</Status>}
            </div>
          </div>
        </div>
        <div className="lab-stack">
          <LabExplain title={TITLES[approach]}>
            {EXPLAIN[approach].map((t, i) => <p key={i}>{t}</p>)}
            {exp === 'double' && keyed && noUnique && <p>目前關掉了 UNIQUE：兩個請求都先 SELECT、都沒查到、都去 INSERT。這是最常見的「有做冪等但沒擋住」寫法。</p>}
            {exp === 'double' && keyed && !noUnique && <p>第二個請求撞到 processing 的 key：{wait ? '等第一個完成再回同一份回應，客戶端最省事，但要有等待上限。' : '回 409 最簡單，客戶端稍後用同一個 key 重送即可拿到結果。'}</p>}
          </LabExplain>
          <Callout title="什麼時候會真的踩到">
            上線幾週後財務對帳發現有幾十筆金額相同、相差 3 秒的付款——不是使用者按兩次，是 App 的 HTTP client 在逾時後自動重試。任何會產生金錢或不可逆副作用的 POST（付款、寄信、建立訂單、扣庫存）都要在第一版就決定用哪一種去重，事後補要先清歷史重複資料。
          </Callout>
        </div>
      </LabGrid>
      <style>{`
        .idm-log { list-style: none; display: grid; gap: 3px; font-size: 0.8rem; color: var(--ink-3); }
        .idm-log li { display: grid; grid-template-columns: 22px 1fr; gap: 8px; padding: 4px 8px; border-radius: var(--radius); border: 1px solid transparent; line-height: 1.5; }
        .idm-log li.past { color: var(--ink-2); }
        .idm-log li.cur { color: var(--ink-1); border-color: var(--lab-accent); background: color-mix(in srgb, var(--lab-accent) 8%, var(--surface-1)); }
        .idm-log .n { font-family: var(--mono); font-size: 0.7rem; color: var(--ink-3); padding-top: 2px; }
        .idm-tables { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        @media (max-width: 760px) { .idm-tables { grid-template-columns: 1fr; } }
        .idm-tables tr.idm-dup td { background: color-mix(in srgb, var(--critical) 12%, transparent); }
        .idm-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; }
        .idm-stats > div { border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); padding: 8px 12px; display: grid; gap: 4px; align-content: start; }
        .idm-stats span { font-size: 0.72rem; color: var(--ink-3); letter-spacing: 0.04em; }
        .idm-stats b { font-family: var(--mono); font-size: 0.95rem; color: var(--ink-1); font-variant-numeric: tabular-nums; }
        .idm-stats b.bad { color: var(--critical); }
        .idm-svg .lbl { font-family: var(--mono); font-size: 11px; fill: var(--ink-2); }
        .idm-svg .lbl.on { fill: var(--ink-1); font-weight: 700; }
        .idm-svg .lbl.ok { fill: var(--good); } .idm-svg .lbl.bad { fill: var(--critical); } .idm-svg .lbl.warn { fill: var(--serious); }
        .idm-svg .arrow { stroke: var(--ink-3); stroke-width: 1.5; fill: none; }
        .idm-svg .arrow.on { stroke: var(--lab-accent); stroke-width: 2.2; }
        .idm-svg .arrow.bad { stroke: var(--critical); } .idm-svg .arrow.ok { stroke: var(--good); }
        .idm-svg .head { fill: var(--ink-3); stroke: var(--ink-3); }
        .idm-svg .head.on { fill: var(--lab-accent); stroke: var(--lab-accent); }
        .idm-svg .head.bad { fill: var(--critical); stroke: var(--critical); } .idm-svg .head.ok { fill: var(--good); stroke: var(--good); }
        .idm-svg .lost { fill: var(--critical); font-size: 13px; font-weight: 700; }
        .idm-svg .note { fill: color-mix(in srgb, var(--serious) 12%, var(--surface-1)); stroke: var(--serious); }
      `}</style>
    </Lab>
  )
}

function SeqSvg({ steps, cur }) {
  const H = TOP + steps.length * ROW + 8
  const lanes = [{ id: C, name: '客戶端' }, { id: A, name: 'API' }, { id: D, name: 'DB' }]
  return (
    <svg className="idm-svg" viewBox={`0 0 620 ${H}`} width="100%" role="img" aria-label="客戶端、API、DB 的時序圖">
      {lanes.map((l) => (
        <g key={l.id}>
          <rect className="svg-node" x={X[l.id] - 44} y={6} width={88} height={28} rx="5" />
          <text className="svg-text" x={X[l.id]} y={25} textAnchor="middle" fontWeight="700">{l.name}</text>
          <line className="svg-edge svg-dash" x1={X[l.id]} y1={34} x2={X[l.id]} y2={H - 4} style={{ opacity: 0.5 }} />
        </g>
      ))}
      {steps.map((s, i) => {
        if (i > cur) return null
        const y = TOP + i * ROW
        const on = i === cur
        const tone = s.tone || ''
        const cls = `${on ? 'on' : ''} ${tone}`
        if (s.from === s.to) {
          return (
            <g key={i}>
              <rect className="note" x={X[s.from] - 80} y={y - 14} width={160} height={24} rx="4" />
              <text className={`lbl ${cls}`} x={X[s.from]} y={y + 2} textAnchor="middle">{s.short}</text>
            </g>
          )
        }
        const x1 = X[s.from], x2 = X[s.to]
        const dir = x2 > x1 ? 1 : -1
        const xEnd = s.lost ? (x1 + x2) / 2 : x2 - dir * 4
        return (
          <g key={i}>
            <line className={`arrow ${cls}${s.lost ? ' svg-dash' : ''}`} x1={x1} y1={y} x2={xEnd} y2={y} />
            {s.lost
              ? <text className="lost" x={xEnd + dir * 8} y={y + 5} textAnchor="middle">✕</text>
              : <polygon className={`head ${cls}`} points={`${x2},${y} ${x2 - dir * 9},${y - 4} ${x2 - dir * 9},${y + 4}`} />}
            <text className={`lbl ${cls}`} x={(x1 + x2) / 2} y={y - 7} textAnchor="middle">{s.short}</text>
          </g>
        )
      })}
    </svg>
  )
}

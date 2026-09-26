import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Lab, LabControls, LabGrid, LabStage, LabExplain, Seg, Toggle, Slider, Code, Callout, Status, useReducedMotion } from '../ui.jsx'

/* 讀寫分離情境模擬器：
   主庫 + 兩台副本。按「寫入然後立刻重整」跑一次時序：寫到主庫 → WAL 串流 → 使用者 gap ms 後按 F5 →
   依做法決定讀哪台 → 拿到新值還是舊值。第二實驗換成「訂單建立後跳轉」看 404。
   副本 A 落後 = 滑桿值，副本 B 落後 = 一半；讀取隨機挑一台。下方比較表用同樣參數對四種做法算期望值。
   所有毫秒數為示意。 */

const STICKY_S = 5          // primary-read 的 cookie 視窗
const REPL = [{ id: 0, name: '副本 A', ratio: 1 }, { id: 1, name: '副本 B', ratio: 0.5 }]

const MODES = {
  'primary-read': { label: '寫後讀主庫', hl: [4, 5, 6], need: 'cookie 記 last_write_at + middleware', title: '剛寫過的人，5 秒內都讀主庫',
    text: ['寫入成功時 cookie 記 last_write_at；之後 5 秒內該使用者的 GET 全部導到主庫，其他人照走副本。只要「寫後多久讀」小於 5 秒就一定拿到新值。', '代價看計數：每一次寫後讀都算在主庫頭上。視窗 5 秒是猜的——把「寫後多久讀」拉超過 5 秒就回到副本，這時延遲若還沒追上就破功；App 沒有 cookie 也掛不上。'] },
  lsn: { label: '帶 LSN 讀', hl: [7, 8, 9], need: '寫入回傳 LSN、客戶端帶回、讀前查副本 LSN', title: '副本追上就讀副本，沒追上才回主庫',
    text: ['寫入回應帶主庫的 WAL 位置（LSN）。讀取時先看副本重播到哪：追上了就直接讀副本；還差一個版本就改讀主庫。不用猜秒數，主庫只在副本真的落後時才被打。', '把延遲拉到「寫後多久讀」以上再跑幾次：副本 A 落後、副本 B 常常追得上，主庫讀比例會落在中間。代價是每次讀多查一次副本的 LSN，以及客戶端要把版本帶回來。'] },
  eventual: { label: '最終一致', hl: [10], need: '前端樂觀更新（只擋 SPA 內）', title: 'F5 一來，樂觀更新就沒了',
    text: ['讀全走副本。SPA 內用 PATCH 的回應直接渲染，畫面看起來是對的；但整頁重新整理是重新 GET，副本還沒追上就回舊值。延遲 50 ms 時幾乎沒事，尖峰 2 秒時每次都中。', '第二實驗更糟：POST /orders 後跳轉 GET /orders/5001，副本沒這列就是 404。使用者以為沒下單成功，再按一次。'] },
  'all-primary': { label: '關鍵讀全走主庫', hl: [2, 3], need: '無，但要劃清哪些 endpoint 算關鍵', title: '這幾個 endpoint 永遠讀主庫',
    text: ['個人資料、訂單這類「自己的資料」綁死主庫，副本只給列表、搜尋、報表。沒有 cookie、沒有版本號、沒有路由判斷，不會錯。', '代價是主庫讀比例 100%——這個實驗只跑關鍵讀所以看不出痛，實際上這些頁面常常就是最熱的。哪些算關鍵要劃清楚，否則會越劃越多。'] },
}

const EXP = {
  profile: '實驗 ①：PATCH /me 改名字，之後整頁重新整理。讀到舊值不會報錯，使用者只會以為沒改成功、再改一次，所以很難從錯誤日誌發現。',
  order: '實驗 ②：POST /orders 回 201 後前端跳轉 GET /orders/5001。副本沒這一列就是 404——比舊值更糟：使用者以為沒下單而重複下單，錯誤日誌裡則是一堆看似正常的 404。',
}

const CODE = `def read_profile(request, user):
    if ROUTE == "all-primary":               # 關鍵讀
        return primary.query(user.id)
    if ROUTE == "primary-read":
        if now() - request.cookies.last_write_at < 5:
            return primary.query(user.id)
    if ROUTE == "lsn":
        want = request.headers["X-After-LSN"]
        if replica.replay_lsn() < want: return primary.query(user.id)
    return replica.query(user.id)             # eventual / 副本已追上`

/* 一次「寫後 gap ms 讀」的結果 */
function trial(mode, lag, gap) {
  const pick = Math.random() < 0.5 ? 0 : 1
  const rlag = Math.round(lag * REPL[pick].ratio)
  const caught = rlag <= gap
  if (mode === 'all-primary') return { target: 'primary', fresh: true, pick, rlag, why: '關鍵讀固定主庫' }
  if (mode === 'primary-read') {
    if (gap < STICKY_S * 1000) return { target: 'primary', fresh: true, pick, rlag, why: `cookie last_write_at 在 ${STICKY_S} 秒內 → 主庫` }
    return { target: pick, fresh: caught, pick, rlag, why: `已超過 ${STICKY_S} 秒視窗 → 回到 ${REPL[pick].name}` }
  }
  if (mode === 'lsn') return caught
    ? { target: pick, fresh: true, pick, rlag, why: `${REPL[pick].name} 的 LSN 已追上 → 讀副本` }
    : { target: 'primary', fresh: true, pick, rlag, fallback: true, why: `${REPL[pick].name} 的 LSN 落後一版 → 改讀主庫` }
  return { target: pick, fresh: caught, pick, rlag, why: `隨機挑到 ${REPL[pick].name}（落後 ${rlag} ms）` }
}

/* 用同一組參數算四種做法的期望值（比較表用） */
function expected(mode, lag, gap) {
  const pBehind = REPL.reduce((s, r) => s + (Math.round(lag * r.ratio) > gap ? 0.5 : 0), 0)
  if (mode === 'all-primary') return { stale: 0, primary: 1 }
  if (mode === 'primary-read') return gap < STICKY_S * 1000 ? { stale: 0, primary: 1 } : { stale: pBehind, primary: 0 }
  if (mode === 'lsn') return { stale: 0, primary: pBehind }
  return { stale: pBehind, primary: 0 }
}
const pct = (x) => `${Math.round(x * 100)}%`
const STATS0 = { reads: 0, stale: 0, primary: 0, fallback: 0 }

export default function ReplicaConsistencyScenarioLab() {
  const [mode, setMode] = useState('eventual')
  const [exp, setExp] = useState('profile')
  const [lag, setLag] = useState(50)
  const [gap, setGap] = useState(300)
  const [peak, setPeak] = useState(false)
  const [flow, setFlow] = useState(null)         // { step, t }
  const [stats, setStats] = useState(STATS0)
  const [log, setLog] = useState([])
  const [lsn, setLsn] = useState(100)
  const reduced = useReducedMotion()
  const seq = useRef(0)
  const effLag = peak ? 2000 : lag
  const m = MODES[mode]
  const table = useMemo(() => Object.entries(MODES).map(([k, v]) => ({ id: k, label: v.label, need: v.need, ...expected(k, effLag, gap), peak: expected(k, 2000, gap).stale })), [effLag, gap])

  const record = (t, quiet) => {
    setStats((s) => ({ reads: s.reads + 1, stale: s.stale + (t.fresh ? 0 : 1), primary: s.primary + (t.target === 'primary' ? 1 : 0), fallback: s.fallback + (t.fallback ? 1 : 0) }))
    if (!quiet) setLog((l) => [{ id: ++seq.current, ...t }, ...l].slice(0, 5))
  }
  const run = () => { setLsn((n) => n + 1); setFlow({ step: 0, t: trial(mode, effLag, gap) }) }
  const burst = () => {
    const out = []
    for (let i = 0; i < 20; i++) { const t = trial(mode, effLag, gap); out.push(t); record(t, true) }
    setLsn((n) => n + 20)
    setLog((l) => [{ id: ++seq.current, burst: true, stale: out.filter((t) => !t.fresh).length, primary: out.filter((t) => t.target === 'primary').length }, ...l].slice(0, 5))
  }
  const reset = () => { setFlow(null); setStats(STATS0); setLog([]); setLsn(100) }

  /* 時序推進：0 寫入主庫 → 1 WAL 串流 → 2 F5 讀取路由 → 3 結果 */
  useEffect(() => {
    if (!flow) return
    if (flow.step >= 3) { const id = setTimeout(() => { record(flow.t); setFlow(null) }, reduced ? 400 : 1400); return () => clearTimeout(id) }
    const id = setTimeout(() => setFlow((f) => f && { ...f, step: f.step + 1 }), reduced ? 250 : 900)
    return () => clearTimeout(id)
  }, [flow, reduced])  // eslint-disable-line react-hooks/exhaustive-deps

  const t = flow?.t
  const step = flow?.step ?? -1
  const isOrder = exp === 'order'
  const phaseText = !flow ? (stats.reads ? '閒置。再跑一次，或改延遲 / 做法後比較。' : `按「${isOrder ? '下單然後跳轉' : '寫入然後立刻重整'}」開始。`)
    : step === 0 ? (isOrder ? `POST /orders → 主庫 INSERT orders id=5001（LSN ${lsn}）` : `PATCH /me → 主庫 UPDATE name = 'Alicia'（LSN ${lsn}）`)
    : step === 1 ? `主庫 → 副本：WAL 串流中（副本 A 落後 ${effLag} ms、副本 B 落後 ${Math.round(effLag / 2)} ms）`
    : step === 2 ? `${gap} ms 後${isOrder ? '跳轉 GET /orders/5001' : '使用者按 F5：GET /me'} → ${t.why}`
    : t.fresh ? (isOrder ? '200 OK：訂單 5001 在' : "200 OK：name = 'Alicia'（新值）") : (isOrder ? '404 Not Found：副本還沒有這一列' : "200 OK：name = 'Alice'（舊值！）")
  const replLsn = (r) => (step >= 1 && step <= 3 && Math.round(effLag * r.ratio) > gap) ? lsn - 1 : lsn
  const primaryPct = stats.reads ? Math.round((stats.primary / stats.reads) * 100) : 0
  const hl = step === 2 || step === 3 ? m.hl : []

  return (
    <Lab accent="violet" kicker="SCENARIO LAB" title="寫完立刻讀：讀到哪一台、拿到哪個版本"
         blurb="切做法、調副本延遲與「寫後多久讀」，按一次看時序動畫，或連跑 20 次看統計。讀取隨機落在副本 A 或 B；A 的落後等於滑桿值、B 是一半。毫秒數皆為示意。">
      <LabControls>
        <Seg tinted value={mode} onChange={setMode} options={Object.entries(MODES).map(([k, v]) => ({ value: k, label: v.label }))} />
      </LabControls>
      <LabControls>
        <Seg value={exp} onChange={setExp} options={[{ value: 'profile', label: '① 更新個人資料然後立刻重整' }, { value: 'order', label: '② 訂單建立後跳轉' }]} />
        <Slider label="副本延遲" min={0} max={3000} step={50} value={effLag} onChange={setLag} format={(v) => `${v} ms`} />
        <Slider label="寫後多久讀" min={100} max={6000} step={100} value={gap} onChange={setGap} format={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`} />
        <Toggle label="尖峰（延遲固定 2 秒）" checked={peak} onChange={setPeak} />
      </LabControls>
      <LabControls>
        <button type="button" className="btn small" onClick={run} disabled={!!flow}>{isOrder ? '下單然後跳轉' : '寫入然後立刻重整'}</button>
        <button type="button" className="btn ghost small" onClick={burst} disabled={!!flow}>連跑 20 次</button>
        <span className="spacer" />
        <button type="button" className="btn ghost small" onClick={reset} disabled={!!flow}>重來</button>
      </LabControls>

      <LabGrid variant="wide">
        <div className="lab-stack">
          <LabStage label="主庫、兩台副本與讀寫路徑" caption="紫＝寫入與 WAL 串流、橘＝這次讀取走的路、紅框＝被挑到但還沒追上的副本。">
            <svg className="rc-svg" viewBox="0 0 600 230" role="img" aria-label="主庫與兩台副本的讀寫路徑">
              <path d="M96 115 H188" className={`e${step === 0 ? ' on' : ''}`} />
              <path d="M312 105 C 360 105, 380 60, 426 60" className={`e repl${step === 1 ? ' on' : ''}`} />
              <path d="M312 125 C 360 125, 380 170, 426 170" className={`e repl${step === 1 ? ' on' : ''}`} />
              {step >= 2 && t.target === 'primary' && <path d="M96 128 H188" className="e on read" />}
              {step >= 2 && t.target === 0 && <path d="M60 88 C 60 20, 400 20, 480 38" className="e on read" />}
              {step >= 2 && t.target === 1 && <path d="M60 142 C 60 215, 400 215, 480 192" className="e on read" />}
              <g transform="translate(24,88)"><rect width="72" height="54" rx="6" className={`n${step >= 0 ? ' on' : ''}`} /><text x="36" y="24" className="t">使用者</text><text x="36" y="42" className="s">{isOrder ? 'POST → GET' : 'PATCH → F5'}</text></g>
              <g transform="translate(188,78)"><rect width="124" height="74" rx="6" className={`n${step === 0 || (step >= 2 && t.target === 'primary') ? ' on' : ''}`} /><text x="62" y="24" className="t">主庫（寫）</text><text x="62" y="44" className="s">LSN {lsn}</text><text x="62" y="62" className="s">{isOrder ? 'orders: 5001 ✓' : "name = 'Alicia'"}</text></g>
              {REPL.map((r, i) => {
                const behind = replLsn(r) < lsn
                return (
                  <g key={r.id} transform={`translate(426,${i === 0 ? 30 : 140})`}>
                    <rect width="150" height="60" rx="6" className={`n${step >= 2 && t.target === r.id ? ' on' : ''}${behind && step >= 2 && t.pick === r.id ? ' behind' : ''}`} />
                    <text x="75" y="22" className="t">{r.name}（讀）</text>
                    <text x="75" y="40" className={`s${behind ? ' bad' : ''}`}>LSN {replLsn(r)} · 落後 {Math.round(effLag * r.ratio)} ms</text>
                    <text x="75" y="54" className="s">{behind ? (isOrder ? 'orders: 5001 ✗' : "name = 'Alice'") : (isOrder ? 'orders: 5001 ✓' : "name = 'Alicia'")}</text>
                  </g>
                )
              })}
              <text x="142" y="106" className="s">寫入</text><text x="380" y="88" className="s">WAL 串流</text>
              {mode === 'lsn' && step >= 2 && <text x="142" y="160" className="s">X-After-LSN: {lsn}</text>}
              {mode === 'primary-read' && step >= 2 && <text x="142" y="160" className="s">cookie last_write_at</text>}
            </svg>
            <p className={`rc-phase${flow ? ' on' : ''}`}>
              {phaseText}{' '}
              {step === 3 && (t.fresh ? <Status ok>{t.fallback ? '新值（改讀主庫）' : '新值'}</Status> : <Status>{isOrder ? '404' : '舊值'}</Status>)}
            </p>
          </LabStage>
          <div className="rc-stats">
            <span className="pill">讀取 <b>{stats.reads}</b> 次</span>
            <span className={`pill${stats.stale ? ' bad' : ''}`}>{isOrder ? '404' : '讀到舊資料'} <b>{stats.stale}</b> 次{stats.reads ? <i>（{Math.round((stats.stale / stats.reads) * 100)}%）</i> : null}</span>
            <span className="pill">主庫承受的讀 <b>{primaryPct}%</b></span>
            {mode === 'lsn' && <span className="pill">副本沒追上改讀主庫 <b>{stats.fallback}</b> 次</span>}
          </div>
          {log.length > 0 && (
            <ol className="rc-log" aria-label="讀取記錄">
              {log.map((e) => (
                <li key={e.id}>
                  <span className="n">#{e.id}</span>
                  {e.burst
                    ? <><span>連跑 20 次</span>{e.stale ? <Status>{isOrder ? '404' : '舊值'} {e.stale} 次</Status> : <Status ok>全部新值</Status>}<span className="r">主庫讀 {e.primary} 次</span></>
                    : <><span>{e.target === 'primary' ? '讀主庫' : `讀${REPL[e.target].name}（落後 ${e.rlag} ms）`}</span>{e.fresh ? <Status ok>{e.fallback ? '新值 · 改讀主庫' : '新值'}</Status> : <Status>{isOrder ? '404' : '舊值'}</Status>}</>}
                </li>
              ))}
            </ol>
          )}
          <p className="rc-cmp-title">同樣參數下四種做法的期望值（延遲 {effLag} ms、寫後 {gap} ms 讀）</p>
          <div className="dtable-wrap">
            <table className="dtable rc-cmp">
              <thead><tr><th>做法</th><th>{isOrder ? '404 機率' : '讀到舊值機率'}</th><th>尖峰 2 s 時</th><th>寫後讀打到主庫</th><th>需要什麼</th></tr></thead>
              <tbody>
                {table.map((r) => (
                  <tr key={r.id} className={r.id === mode ? 'hit' : ''}>
                    <td>{r.label}</td>
                    <td className={r.stale > 0 ? 'bad' : 'ok'}>{pct(r.stale)}</td>
                    <td className={r.peak > 0 ? 'bad' : 'ok'}>{pct(r.peak)}</td>
                    <td className={r.primary >= 1 ? 'warn' : ''}>{pct(r.primary)}</td>
                    <td className="need">{r.need}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="lab-caption">「尖峰 2 s 時」用同樣的「寫後多久讀」、延遲固定 2 秒重算；「寫後讀打到主庫」只算寫後那一次讀，不是全站讀流量。</p>
        </div>
        <div className="lab-stack">
          <Code lang="python" title="讀取路由（示意）" highlight={hl} dim>{CODE}</Code>
          <LabExplain title={m.title}>
            {m.text.map((p, i) => <p key={i}>{p}</p>)}
            <p>{EXP[exp]}</p>
          </LabExplain>
          <Callout title="什麼時候會真的踩到">
            本機與測試環境沒有副本，延遲是 0，所有做法看起來都對。上線後第一個尖峰：大量寫入 + 副本在跑 VACUUM，延遲從 50 ms 跳到 2 秒，客服開始收到「我改了名字怎麼沒變」「下單後頁面 404 所以我又下了一次」。
          </Callout>
        </div>
      </LabGrid>

      <style>{`
        .rc-svg { width: 100%; }
        .rc-svg .e { stroke: var(--hairline); stroke-width: 2; fill: none; transition: stroke 0.25s ease; }
        .rc-svg .e.repl { stroke-dasharray: 5 5; }
        .rc-svg .e.on { stroke: var(--lab-accent); stroke-width: 3; stroke-dasharray: 7 6; animation: rc-flow 0.7s linear infinite; }
        .rc-svg .e.on.read { stroke: var(--c-orange); }
        @keyframes rc-flow { to { stroke-dashoffset: -26; } }
        .rc-svg .n { fill: var(--surface-1); stroke: var(--hairline); stroke-width: 1.5; transition: stroke 0.25s ease; }
        .rc-svg .n.on { stroke: var(--lab-accent); stroke-width: 2.5; }
        .rc-svg .n.behind { stroke: var(--critical); }
        .rc-svg .t { font-family: var(--sans); font-size: 12.5px; font-weight: 700; fill: var(--ink-1); text-anchor: middle; }
        .rc-svg .s { font-family: var(--mono); font-size: 10px; fill: var(--ink-3); text-anchor: middle; }
        .rc-svg .s.bad { fill: var(--critical); font-weight: 700; }
        .rc-phase { margin-top: 10px; text-align: center; font-size: 0.8rem; color: var(--ink-3); min-height: 1.6em; display: flex; justify-content: center; align-items: center; gap: 8px; flex-wrap: wrap; }
        .rc-phase.on { color: var(--ink-1); font-weight: 600; }
        .rc-stats { display: flex; flex-wrap: wrap; gap: 8px; }
        .rc-stats b { font-family: var(--mono); color: var(--ink-1); font-weight: 600; }
        .rc-stats i { font-style: normal; color: var(--ink-3); }
        .rc-stats .pill.bad { border-color: var(--critical); color: var(--critical); }
        .rc-log { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; font-family: var(--mono); font-size: 0.76rem; color: var(--ink-2); }
        .rc-log li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 5px 10px; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); }
        .rc-log li:first-child { border-color: color-mix(in srgb, var(--lab-accent) 50%, var(--hairline)); }
        .rc-log .n { color: var(--ink-3); }
        .rc-log .r { margin-left: auto; color: var(--ink-3); }
        .rc-log .status { font-size: 0.68rem; padding: 1px 8px; }
        .rc-cmp td.bad { color: var(--critical); font-weight: 700; }
        .rc-cmp td.ok { color: var(--good); }
        .rc-cmp td.warn { color: var(--serious); }
        .rc-cmp-title { font-family: var(--sans); font-size: 0.74rem; font-weight: 700; letter-spacing: 0.08em; color: var(--ink-2); margin: 0; }
        .rc-cmp td.need { white-space: normal; min-width: 220px; font-family: var(--sans); color: var(--ink-2); font-size: 0.76rem; }
        @media (prefers-reduced-motion: reduce) { .rc-svg .e.on { animation: none; } }
      `}</style>
    </Lab>
  )
}
